"""Moteur de risque : calcul de taille et contrôles obligatoires avant ordre.

Sections 5 et 6 du cahier des charges. Le moteur est volontairement pur (aucune
entrée/sortie réseau) : il reçoit un contexte complet et renvoie une décision
traçable. Cela le rend testable exhaustivement (couverture cible ≥ 95 %).

Principe : *en cas de doute, refus*. Une donnée absente, périmée, incohérente
ou non convertible suffit à bloquer l'ordre.
"""

from __future__ import annotations

import json
import math
import threading
import time
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Iterable, Sequence

from .config import (
    CORRELATION_GROUPS,
    DEFAULT_POLICY,
    ENV_SIMULATION,
    SYMBOLS,
    RiskPolicy,
    SymbolSpec,
)
from .db import Database
from .market import Quote
from .util import (
    D,
    ZERO,
    age_seconds,
    iso,
    now_utc,
    quantize,
    trading_day,
    trading_week,
)

# --------------------------------------------------------------------------
# Codes de refus (stables, utilisés par les tests et l'interface)
# --------------------------------------------------------------------------
CODE_MESSAGES: dict[str, str] = {
    "OK": "Ordre autorisé",
    "SYMBOL_UNKNOWN": "Instrument inconnu",
    "SIDE_INVALID": "Sens d'ordre invalide",
    "QUOTE_MISSING": "Cotation absente",
    "QUOTE_STALE": "Cotation périmée (fraîcheur non confirmée)",
    "SIGNAL_STALE": "Signal trop ancien au moment de l'envoi",
    "QUOTE_INCOHERENT": "Cotation incohérente (bid/ask)",
    "SPREAD_TOO_WIDE": "Spread anormalement large",
    "MARKET_CLOSED": "Marché fermé ou instrument suspendu",
    "MISSING_STOP": "Stop-loss absent : ordre refusé",
    "MISSING_TARGET": "Objectif absent : ordre non protégé",
    "INVALID_STOP": "Stop du mauvais côté du prix d'entrée",
    "INVALID_TARGET": "Objectif du mauvais côté du prix d'entrée",
    "STOP_TOO_TIGHT": "Distance de stop inférieure au minimum du broker",
    "REWARD_RISK_TOO_LOW": "Ratio rendement/risque insuffisant",
    "SPEC_INCOMPLETE": "Spécification de contrat incomplète (valeur du point, lot, levier)",
    "ACCOUNT_DATA_MISSING": "Donnée de compte manquante (solde, equity, marge libre)",
    "CONVERSION_MISSING": "Taux de conversion de devise indisponible",
    "SIZE_TOO_SMALL": "Taille calculée sous le minimum négociable",
    "SIZE_ABOVE_MAX": "Taille calculée au-dessus du maximum autorisé",
    "INSUFFICIENT_BALANCE": "Solde insuffisant",
    "INSUFFICIENT_MARGIN": "Marge libre insuffisante",
    "NOTIONAL_LIMIT": "Notionnel supérieur au plafond par ordre",
    "MAX_POSITIONS": "Nombre maximal de positions simultanées atteint",
    "OPEN_RISK_LIMIT": "Risque cumulé ouvert au-delà de la limite",
    "GROUP_RISK_LIMIT": "Risque cumulé sur un groupe corrélé au-delà de la limite",
    "DAILY_LOSS_LIMIT": "Perte journalière maximale atteinte : nouvelles entrées bloquées",
    "WEEKLY_LOSS_LIMIT": "Perte hebdomadaire maximale atteinte : nouvelles entrées bloquées",
    "DRAWDOWN_LIMIT": "Drawdown global maximal atteint : nouvelles entrées bloquées",
    "DAILY_TRADES_LIMIT": "Nombre maximal de transactions par jour atteint",
    "PRICE_DEVIATION": "Prix trop éloigné du signal (slippage au-delà de la tolérance)",
    "TRADING_SUSPENDED": "Trading suspendu (arrêt d'urgence ou limite atteinte)",
    "KILL_SWITCH": "Arrêt d'urgence actif",
    "REAL_MODE_FORBIDDEN": "Mode réel interdit : connecteur non validé",
    "COSTS_EXCEED_RISK": "Frais et spread estimés disproportionnés par rapport au risque",
    "DUPLICATE_SIGNAL": "Signal déjà traité (déduplication)",
}


def message_for(code: str) -> str:
    return CODE_MESSAGES.get(code, code)


# --------------------------------------------------------------------------
# Structures
# --------------------------------------------------------------------------
@dataclass
class RiskAccount:
    account_id: str = "SIM-0001"
    currency: str = "USD"
    balance: Decimal | None = None
    equity: Decimal | None = None
    free_margin: Decimal | None = None
    margin_used: Decimal | None = ZERO
    leverage: int | None = 30


@dataclass
class OpenPositionRisk:
    position_id: str
    symbol: str
    qty: Decimal
    risk_amount: Decimal
    group: str = ""


@dataclass
class RiskState:
    """État de risque persistant (survit aux redémarrages, section 21.2)."""

    day_key: str = ""
    week_key: str = ""
    day_anchor_equity: Decimal | None = None
    week_anchor_equity: Decimal | None = None
    peak_equity: Decimal | None = None
    last_equity: Decimal | None = None
    trades_today: int = 0
    suspended: bool = False
    suspension_reason: str = ""
    kill_switch: bool = False
    kill_switch_at: str | None = None
    emergency_liquidation_at: str | None = None
    updated_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for key, value in self.__dict__.items():
            out[key] = str(value) if isinstance(value, Decimal) else value
        return out


class RiskStateStore:
    """Persiste l'état de risque pour qu'un redémarrage ne réarme jamais les limites."""

    KEY = "risk_state"

    def __init__(self, db: Database, policy: RiskPolicy | None = None):
        self.db = db
        self.policy = policy or DEFAULT_POLICY
        self._lock = threading.RLock()
        self.state = self.load()

    def load(self) -> RiskState:
        raw = self.db.scalar("SELECT value FROM settings_kv WHERE key=?", (self.KEY,), default=None)
        if not raw:
            return RiskState()
        data = json.loads(raw)
        state = RiskState()
        for key, value in data.items():
            if not hasattr(state, key):
                continue
            setattr(state, key, value)
        for key in ("day_anchor_equity", "week_anchor_equity", "peak_equity", "last_equity"):
            value = getattr(state, key)
            if value is not None:
                setattr(state, key, D(value))
        return state

    def save(self) -> None:
        with self._lock:
            self.state.updated_at = iso(now_utc())
            self.db.execute(
                "INSERT INTO settings_kv(key, value, updated_at) VALUES(?,?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                (self.KEY, json.dumps(self.state.to_dict()), iso(now_utc())),
            )

    # -- remises à zéro --------------------------------------------------
    def roll(self, moment=None) -> tuple[bool, bool]:
        """Bascule éventuelle de journée/semaine ; renvoie (jour changé, semaine changée)."""
        moment = moment or now_utc()
        day = trading_day(moment, self.policy.reset_hour_ny).isoformat()
        week = "%04d-W%02d" % trading_week(moment, self.policy.reset_hour_ny)
        with self._lock:
            day_changed = self.state.day_key != day
            week_changed = self.state.week_key != week
            if day_changed:
                self.state.day_key = day
                self.state.day_anchor_equity = self.state.last_equity or self.state.day_anchor_equity
                self.state.trades_today = 0
                if self.state.suspended and self.state.suspension_reason in (
                        "DAILY_LOSS_LIMIT", "DAILY_TRADES_LIMIT"):
                    self.state.suspended = False
                    self.state.suspension_reason = ""
            if week_changed:
                self.state.week_key = week
                self.state.week_anchor_equity = self.state.last_equity or self.state.week_anchor_equity
            if day_changed or week_changed:
                self.save()
        return day_changed, week_changed

    def observe_equity(self, equity: Decimal) -> None:
        with self._lock:
            self.state.last_equity = equity
            if self.state.day_anchor_equity is None:
                self.state.day_anchor_equity = equity
            if self.state.week_anchor_equity is None:
                self.state.week_anchor_equity = equity
            if self.state.peak_equity is None or equity > self.state.peak_equity:
                self.state.peak_equity = equity
            self.save()

    def register_trade(self) -> None:
        with self._lock:
            self.state.trades_today += 1
            self.save()

    def suspend(self, code: str) -> None:
        with self._lock:
            self.state.suspended = True
            self.state.suspension_reason = code
            self.save()

    def resume(self) -> None:
        with self._lock:
            self.state.suspended = False
            self.state.suspension_reason = ""
            self.save()

    def engage_kill_switch(self) -> None:
        with self._lock:
            self.state.kill_switch = True
            self.state.kill_switch_at = iso(now_utc())
            self.save()

    def release_kill_switch(self) -> None:
        with self._lock:
            self.state.kill_switch = False
            self.state.kill_switch_at = None
            self.save()

    # -- indicateurs -----------------------------------------------------
    def daily_loss_pct(self, equity: Decimal | None = None) -> Decimal:
        equity = equity if equity is not None else self.state.last_equity
        anchor = self.state.day_anchor_equity
        if equity is None or anchor is None or anchor <= ZERO:
            return ZERO
        return max(ZERO, (anchor - equity) / anchor * Decimal(100))

    def weekly_loss_pct(self, equity: Decimal | None = None) -> Decimal:
        equity = equity if equity is not None else self.state.last_equity
        anchor = self.state.week_anchor_equity
        if equity is None or anchor is None or anchor <= ZERO:
            return ZERO
        return max(ZERO, (anchor - equity) / anchor * Decimal(100))

    def drawdown_pct(self, equity: Decimal | None = None) -> Decimal:
        equity = equity if equity is not None else self.state.last_equity
        peak = self.state.peak_equity
        if equity is None or peak is None or peak <= ZERO:
            return ZERO
        return max(ZERO, (peak - equity) / peak * Decimal(100))

    def snapshot(self, equity: Decimal | None = None) -> dict[str, Any]:
        return {
            "state": self.state.to_dict(),
            "daily_loss_pct": float(self.daily_loss_pct(equity)),
            "weekly_loss_pct": float(self.weekly_loss_pct(equity)),
            "drawdown_pct": float(self.drawdown_pct(equity)),
        }


@dataclass
class RiskIntent:
    symbol: str
    side: str
    entry: Decimal | None
    stop: Decimal | None
    target: Decimal | None
    qty: Decimal | None = None
    environment: str = ENV_SIMULATION
    strategy: str | None = None
    signal_time: Any = None
    signal_id: str | None = None
    order_type: str = "MARKET"


@dataclass
class Check:
    name: str
    ok: bool
    code: str = "OK"
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "ok": self.ok, "code": self.code, "detail": self.detail}


@dataclass
class RiskDecision:
    allowed: bool
    code: str
    reasons: list[str] = field(default_factory=list)
    checks: list[Check] = field(default_factory=list)
    qty: Decimal = ZERO
    risk_amount: Decimal = ZERO
    notional: Decimal = ZERO
    margin_required: Decimal = ZERO
    reward_risk: Decimal = ZERO
    estimated_costs: Decimal = ZERO
    latency_ms: float = 0.0
    policy_version: int = 1
    equity: Decimal = ZERO

    def to_dict(self) -> dict[str, Any]:
        return {
            "allowed": self.allowed,
            "code": self.code,
            "message": message_for(self.code),
            "reasons": self.reasons,
            "checks": [c.to_dict() for c in self.checks],
            "qty": float(self.qty),
            "risk_amount": float(self.risk_amount),
            "notional": float(self.notional),
            "margin_required": float(self.margin_required),
            "reward_risk": float(self.reward_risk),
            "estimated_costs": float(self.estimated_costs),
            "latency_ms": round(self.latency_ms, 3),
            "policy_version": self.policy_version,
            "equity": float(self.equity),
        }


@dataclass
class RiskContext:
    policy: RiskPolicy
    account: RiskAccount
    quotes: dict[str, Quote]
    open_positions: Sequence[OpenPositionRisk] = ()
    state: RiskState = field(default_factory=RiskState)
    daily_loss_pct: Decimal = ZERO
    weekly_loss_pct: Decimal = ZERO
    drawdown_pct: Decimal = ZERO
    trades_today: int = 0
    market_open: bool = True
    suspended: bool = False
    suspension_reason: str = ""
    kill_switch: bool = False
    conversion_rates: dict[str, Decimal] = field(default_factory=dict)
    reference_time: Any = None


# --------------------------------------------------------------------------
# Moteur
# --------------------------------------------------------------------------
class RiskEngine:
    """Cœur du contrôle pré-ordre (section 6)."""

    def __init__(self, policy: RiskPolicy | None = None):
        self.policy = policy or DEFAULT_POLICY

    # -- helpers ---------------------------------------------------------
    def _rate(self, currency: str, context: RiskContext) -> Decimal | None:
        if currency == context.account.currency:
            return Decimal(1)
        return context.conversion_rates.get(currency.upper())

    def unit_value(self, spec: SymbolSpec, context: RiskContext) -> Decimal | None:
        rate = self._rate(spec.quote, context)
        if rate is None:
            return None
        return spec.contract_size * rate

    def notional(self, spec: SymbolSpec, qty: Decimal, price: Decimal,
                 context: RiskContext) -> Decimal | None:
        rate = self._rate(spec.quote, context)
        if rate is None:
            return None
        if spec.market == "crypto":
            return qty * price * rate
        if spec.quote == context.account.currency:
            return qty * spec.contract_size * price
        if spec.base == context.account.currency:
            return qty * spec.contract_size
        base_rate = self._rate(spec.base, context)
        if base_rate is None:
            return None
        return qty * spec.contract_size * base_rate

    # -- évaluation ------------------------------------------------------
    def evaluate(self, intent: RiskIntent, context: RiskContext) -> RiskDecision:
        started = time.perf_counter()
        policy = context.policy
        checks: list[Check] = []
        reasons: list[str] = []
        decision = RiskDecision(False, "OK", policy_version=policy.version,
                                equity=context.account.equity or ZERO)

        def fail(code: str, name: str, detail: str = "") -> RiskDecision:
            checks.append(Check(name, False, code, detail))
            decision.allowed = False
            decision.code = code
            decision.reasons = reasons + [f"{message_for(code)}{' : ' + detail if detail else ''}"]
            decision.checks = checks
            decision.latency_ms = (time.perf_counter() - started) * 1000
            return decision

        def ok(name: str, detail: str = "") -> None:
            checks.append(Check(name, True, "OK", detail))

        # 1. Environnement et verrous
        if context.kill_switch:
            return fail("KILL_SWITCH", "kill_switch")
        if context.suspended:
            return fail(context.suspension_reason or "TRADING_SUSPENDED", "suspension")
        if str(intent.environment).startswith("REAL"):
            return fail("REAL_MODE_FORBIDDEN", "environment")
        ok("environment", intent.environment)

        # 2. Instrument
        spec = SYMBOLS.get(intent.symbol)
        if spec is None:
            return fail("SYMBOL_UNKNOWN", "symbol", intent.symbol)
        if intent.side not in ("BUY", "SELL"):
            return fail("SIDE_INVALID", "side", str(intent.side))
        ok("symbol", f"{spec.symbol} ({spec.market})")

        # 3. Spécification de contrat complète (valeur du point, lot, levier…)
        if (spec.contract_size is None or spec.contract_size <= ZERO
                or spec.tick_size is None or spec.tick_size <= ZERO
                or spec.min_qty is None or spec.min_qty <= ZERO
                or spec.qty_step is None or spec.qty_step <= ZERO
                or spec.leverage is None or spec.leverage <= 0):
            return fail("SPEC_INCOMPLETE", "contract_spec")
        ok("contract_spec", f"lot mini {spec.min_qty}, pas {spec.qty_step}, levier {spec.leverage}")

        # 4. Données de compte
        account = context.account
        if (account.equity is None or account.balance is None
                or account.free_margin is None):
            return fail("ACCOUNT_DATA_MISSING", "account_data")
        equity = D(account.equity)
        if equity <= ZERO or D(account.balance) <= ZERO:
            return fail("INSUFFICIENT_BALANCE", "balance", f"equity={equity}")
        ok("account_data", f"equity {equity} {account.currency}")

        # 5. Marché ouvert
        if not context.market_open:
            return fail("MARKET_CLOSED", "market_open")
        ok("market_open")

        # 6. Cotation : présence, fraîcheur, cohérence
        quote = context.quotes.get(intent.symbol)
        if quote is None:
            return fail("QUOTE_MISSING", "quote")
        if quote.bid <= ZERO or quote.ask <= ZERO or quote.ask < quote.bid:
            return fail("QUOTE_INCOHERENT", "quote_consistency",
                        f"bid={quote.bid} ask={quote.ask}")
        age = quote.age()
        if math.isinf(age):
            return fail("QUOTE_MISSING", "quote_age")
        if age > float(policy.freshness_seconds):
            return fail("QUOTE_STALE", "quote_freshness",
                        f"{age:.2f}s > {policy.freshness_seconds}s")
        ok("quote_freshness", f"{age:.2f}s")
        if quote.spread_bps > policy.max_spread_bps:
            return fail("SPREAD_TOO_WIDE", "spread",
                        f"{quote.spread_bps:.2f}bps > {policy.max_spread_bps}bps")
        ok("spread", f"{quote.spread_bps:.2f}bps")

        # 6 bis. Fraîcheur du signal lui-même (section 21.2)
        if intent.signal_time is not None and context.reference_time is not None:
            from .util import age_seconds as _age

            signal_age = _age(intent.signal_time, context.reference_time)
            if math.isfinite(signal_age) and signal_age > float(policy.freshness_seconds):
                return fail("SIGNAL_STALE", "signal_freshness", f"{signal_age:.2f}s")
            checks.append(Check("signal_freshness", True, "OK", f"{signal_age:.2f}s"))

        # 7. Prix de référence et protections
        entry = D(intent.entry) if intent.entry is not None else quote.mid
        if entry <= ZERO:
            return fail("QUOTE_INCOHERENT", "entry_price", f"entry={entry}")
        deviation_bps = abs(quote.mid - entry) / entry * Decimal(10000)
        if deviation_bps > policy.max_slippage_bps:
            return fail("PRICE_DEVIATION", "price_deviation",
                        f"{deviation_bps:.1f}bps > {policy.max_slippage_bps}bps")
        ok("price_deviation", f"{deviation_bps:.1f}bps")

        if intent.stop is None:
            return fail("MISSING_STOP", "stop_present")
        stop = D(intent.stop)
        if intent.target is None:
            return fail("MISSING_TARGET", "target_present")
        target = D(intent.target)

        if intent.side == "BUY":
            if stop >= entry:
                return fail("INVALID_STOP", "stop_side", f"stop {stop} >= entrée {entry}")
            if target <= entry:
                return fail("INVALID_TARGET", "target_side", f"objectif {target} <= entrée {entry}")
        else:
            if stop <= entry:
                return fail("INVALID_STOP", "stop_side", f"stop {stop} <= entrée {entry}")
            if target >= entry:
                return fail("INVALID_TARGET", "target_side", f"objectif {target} >= entrée {entry}")
        ok("protection_geometry")

        risk_per_unit = abs(entry - stop)
        reward_per_unit = abs(target - entry)
        if risk_per_unit < spec.tick_size:
            return fail("STOP_TOO_TIGHT", "stop_distance",
                        f"{risk_per_unit} < tick {spec.tick_size}")
        reward_risk = reward_per_unit / risk_per_unit
        decision.reward_risk = reward_risk
        if reward_risk < policy.min_reward_risk:
            return fail("REWARD_RISK_TOO_LOW", "reward_risk",
                        f"{reward_risk:.2f} < {policy.min_reward_risk}")
        ok("reward_risk", f"{reward_risk:.2f}")

        # 8. Conversion et valeur du point
        unit_value = self.unit_value(spec, context)
        if unit_value is None or unit_value <= ZERO:
            return fail("CONVERSION_MISSING", "unit_value", spec.quote)
        ok("unit_value", f"{unit_value}")

        # 9. Taille de position
        risk_budget = equity * policy.max_risk_per_trade_pct / Decimal(100)
        risk_per_lot_unit = risk_per_unit * unit_value
        raw_qty = (risk_budget / risk_per_lot_unit) if risk_per_lot_unit > ZERO else ZERO
        if raw_qty <= ZERO:
            return fail("SIZE_TOO_SMALL", "size", "risque par unité nul")
        qty = quantize(raw_qty, spec.qty_step)
        if intent.qty is not None:
            qty = quantize(D(intent.qty), spec.qty_step)
        if qty < spec.min_qty:
            return fail("SIZE_TOO_SMALL", "size",
                        f"{qty} < minimum {spec.min_qty} (budget de risque {risk_budget:.2f})")
        if qty > spec.max_qty:
            return fail("SIZE_ABOVE_MAX", "size", f"{qty} > {spec.max_qty}")
        risk_amount = qty * risk_per_unit * unit_value
        if risk_amount > risk_budget * Decimal("1.0001"):
            return fail("SIZE_ABOVE_MAX", "size", f"risque {risk_amount:.2f} > budget {risk_budget:.2f}")
        ok("size", f"{qty} unités, risque {risk_amount:.2f} {account.currency}")

        # 10. Notionnel et marge
        notional = self.notional(spec, qty, entry, context)
        if notional is None:
            return fail("CONVERSION_MISSING", "notional")
        decision.notional = notional
        margin_required = notional / Decimal(spec.leverage)
        decision.margin_required = margin_required
        notional_cap = equity * policy.max_order_notional_pct / Decimal(100)
        if notional > notional_cap:
            return fail("NOTIONAL_LIMIT", "notional",
                        f"{notional:.2f} > plafond {notional_cap:.2f}")
        ok("notional", f"{notional:.2f}")
        free_margin = D(account.free_margin)
        if margin_required > free_margin * Decimal("0.95"):
            return fail("INSUFFICIENT_MARGIN", "margin",
                        f"requis {margin_required:.2f} > libre {free_margin:.2f}")
        ok("margin", f"requis {margin_required:.2f} / libre {free_margin:.2f}")

        # 11. Limites de capital (journalière, hebdomadaire, drawdown)
        if context.daily_loss_pct >= policy.max_daily_loss_pct:
            return fail("DAILY_LOSS_LIMIT", "daily_loss", f"{context.daily_loss_pct:.2f}%")
        ok("daily_loss", f"{context.daily_loss_pct:.2f}% / {policy.max_daily_loss_pct}%")
        if context.weekly_loss_pct >= policy.max_weekly_loss_pct:
            return fail("WEEKLY_LOSS_LIMIT", "weekly_loss", f"{context.weekly_loss_pct:.2f}%")
        ok("weekly_loss", f"{context.weekly_loss_pct:.2f}% / {policy.max_weekly_loss_pct}%")
        if context.drawdown_pct >= policy.max_drawdown_pct:
            return fail("DRAWDOWN_LIMIT", "drawdown", f"{context.drawdown_pct:.2f}%")
        ok("drawdown", f"{context.drawdown_pct:.2f}% / {policy.max_drawdown_pct}%")

        # 12. Exposition et positions
        if len(context.open_positions) >= policy.max_open_positions:
            return fail("MAX_POSITIONS", "open_positions",
                        f"{len(context.open_positions)} / {policy.max_open_positions}")
        ok("open_positions", f"{len(context.open_positions)} / {policy.max_open_positions}")

        open_risk = sum((p.risk_amount for p in context.open_positions), ZERO)
        open_risk_cap = equity * policy.max_open_risk_pct / Decimal(100)
        if open_risk + risk_amount > open_risk_cap:
            return fail("OPEN_RISK_LIMIT", "open_risk",
                        f"{open_risk + risk_amount:.2f} > plafond {open_risk_cap:.2f}")
        ok("open_risk", f"{open_risk + risk_amount:.2f} / {open_risk_cap:.2f}")

        group = spec.correlation_group
        group_risk = sum((p.risk_amount for p in context.open_positions if p.group == group), ZERO)
        group_cap = equity * policy.max_group_risk_pct / Decimal(100)
        if group_risk + risk_amount > group_cap:
            return fail("GROUP_RISK_LIMIT", "group_risk",
                        f"groupe {group} : {group_risk + risk_amount:.2f} > plafond {group_cap:.2f}")
        ok("group_risk", f"{group} {group_risk + risk_amount:.2f} / {group_cap:.2f}")

        if context.trades_today >= policy.max_daily_trades:
            return fail("DAILY_TRADES_LIMIT", "daily_trades",
                        f"{context.trades_today} / {policy.max_daily_trades}")
        ok("daily_trades", f"{context.trades_today} / {policy.max_daily_trades}")

        # 13. Coûts prévisionnels
        spread_cost = qty * (quote.spread / Decimal(2)) * unit_value
        fee_cost = notional * spec.taker_fee_bps / Decimal(10000)
        estimated_costs = spread_cost + fee_cost
        decision.estimated_costs = estimated_costs
        if risk_amount > ZERO and estimated_costs > risk_amount:
            return fail("COSTS_EXCEED_RISK", "costs",
                        f"coûts {estimated_costs:.2f} > risque {risk_amount:.2f}")
        ok("costs", f"{estimated_costs:.2f} {account.currency}")

        # 14. Autorisation
        decision.allowed = True
        decision.code = "OK"
        decision.reasons = ["Toutes les vérifications obligatoires sont satisfaites."]
        decision.qty = qty
        decision.risk_amount = risk_amount
        decision.checks = checks
        decision.latency_ms = (time.perf_counter() - started) * 1000
        return decision


# --------------------------------------------------------------------------
# Aide au calcul du risque des positions ouvertes
# --------------------------------------------------------------------------
def position_risk_amount(symbol: str, qty: Decimal, entry: Decimal, stop: Decimal | None,
                         account_currency: str = "USD",
                         rates: dict[str, Decimal] | None = None) -> Decimal:
    """Risque au stop d'une position, en devise du compte (section 5.1)."""
    spec = SYMBOLS.get(symbol)
    if spec is None or stop is None:
        return ZERO
    rates = rates or {}
    quote_rate = Decimal(1) if spec.quote == account_currency else rates.get(spec.quote.upper())
    if quote_rate is None:
        return ZERO
    per_unit = abs(entry - stop) * spec.contract_size * quote_rate
    return per_unit * qty


def correlation_group(symbol: str) -> str:
    for group, members in CORRELATION_GROUPS.items():
        if symbol in members:
            return group
    spec = SYMBOLS.get(symbol)
    return spec.correlation_group if spec else ""
