"""Orchestrateur : marché → signal → risque → ordre → réconciliation.

Circuit imposé par la section 7 du cahier des charges :
``signal → validation des données → calcul du risque → autorisation →
gestionnaire d'ordres → plateforme → confirmation → mise à jour locale``.

Une étape en échec empêche l'envoi d'un nouvel ordre. Le moteur tourne côté
serveur : l'application mobile n'est qu'un client de contrôle.
"""

from __future__ import annotations

import json
import math
import os
import random
import threading
import time
import traceback
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable

from . import APP_NAME, __version__
from .alerts import AlertNotifier
from .backup import BackupManager
from .config import (
    DEFAULT_POLICY,
    ENV_SIMULATION,
    FX_TO_ACCOUNT,
    MARKET_CRYPTO,
    SIMULATION_REFERENCE_PRICES,
    SYMBOLS,
    Settings,
    default_settings,
)
from .connections import Mt5ConnectionStore
from .connectors.base import BrokerConnector, ConnectorError
from .connectors.simulation import SimulationConnector
from .db import Database, ensure_permissions
from .guards import RealModeGuard
from .journal import AuditLog, Journal, Notifications
from .market import CandleSeries, MarketDataStore, Quote, to_float_map
from .orders import OrderManager
from .policy import PolicyStore
from .reconcile import Reconciler
from .risk import (
    OpenPositionRisk,
    RiskAccount,
    RiskContext,
    RiskEngine,
    RiskIntent,
    RiskState,
    RiskStateStore,
    message_for,
    position_risk_amount,
)
from .security import (
    ApiTokenStore,
    OwnerGate,
    SessionStore,
    UserStore,
    generate_totp_secret,
    hash_password,
    otpauth_uri,
)
from .simulator import MarketSimulator, SimulationClock, is_market_open
from .strategies import Signal, StrategyRegistry, STRATEGY_CLASSES
from .util import D, ZERO, iso, new_uuid, now_utc, parse_iso, scrub_mapping, to_utc


class EngineError(Exception):
    pass


class TradingEngine:
    def __init__(self, settings: Settings | None = None, *, start_connector: bool = True,
                 seed_users: bool = True):
        self.settings = settings or default_settings()
        self.settings.ensure_dirs()
        self.db = Database(self.settings.db_path)
        self.db.migrate()
        self.journal = Journal(self.db)
        self.audit = AuditLog(self.db)
        self.notifications = Notifications(self.db, self.journal)
        self.alerts = AlertNotifier(self.settings.var_dir / "alerts.json", self.journal)
        self.owner_gate = OwnerGate(self.settings.var_dir)
        self.guard = RealModeGuard(self.db, self.journal, self.audit, self.owner_gate,
                                   allow_real_setting=self.settings.allow_real_trading)
        self.policy_store = PolicyStore(self.db, self.journal, self.audit, self.owner_gate)
        self.users = UserStore(self.db)
        self.sessions = SessionStore(self.db, self.users, self.settings.session_ttl_minutes)
        self.api_tokens = ApiTokenStore(self.db)
        self.market = MarketDataStore(self.settings.symbols)
        self.simulator = MarketSimulator(self.settings.seed, self.settings.symbols)
        self.clock = SimulationClock(self.settings.simulation_speed)
        # Choix du connecteur au démarrage : pont MT5 démo si l'exploitant l'a
        # activé, sinon simulation interne. Aucune bascule silencieuse.
        self.mt5 = Mt5ConnectionStore(self.settings.var_dir / "mt5_connection.json")
        self.connector: BrokerConnector = self._build_connector()
        self.orders = OrderManager(self.db, self.connector, self.journal, self.notifications)
        self.risk = RiskEngine(self.policy_store.current())
        self.risk_states = RiskStateStore(self.db, self.risk.policy)
        self.strategies = StrategyRegistry()
        self.reconciler = Reconciler(self.db, self.connector, self.journal, self.notifications)
        self.backups = BackupManager(self.db, self.settings.backup_dir, self.journal)
        self._lock = threading.RLock()
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._started_at: float | None = None
        self._last_scan: dict[tuple[str, str], str] = {}
        self._last_signal_at: dict[str, float] = {}
        self._equity_history: list[dict[str, Any]] = []
        self._last_equity_write = 0.0
        self._last_scan_time = 0.0
        self._tick_count = 0
        self._errors: list[dict[str, Any]] = []
        self.entries_enabled = False
        self.state = "STOPPED"
        self.bootstrap_done = False
        self._pending_bootstrap_connector = start_connector
        self._pending_seed_users = seed_users
        self.started_with_connector = start_connector

    # ------------------------------------------------------------------
    # Démarrage
    # ------------------------------------------------------------------
    # ------------------------------------------------------------------
    # Connecteur et flux de marché
    # ------------------------------------------------------------------
    def _build_connector(self) -> BrokerConnector:
        if self.mt5.config.get("enabled") and self.mt5.config.get("bridge_url"):
            return self.mt5.build_connector()
        return SimulationConnector(
            self.settings.initial_capital, self.settings.account_currency, self.settings.seed,
            state_path=self.settings.var_dir / "simulation_state.json")

    @property
    def uses_bridge(self) -> bool:
        return getattr(self.connector, "kind", "simulation") == "mt5"

    def _collect_quotes(self, moment) -> list[Quote]:
        """Cotations du cycle : pont MT5 (démo) ou marché simulé, jamais un mélange."""
        if not self.uses_bridge:
            return self.simulator.tick_all(moment)
        try:
            rows = self.connector.quotes(self.settings.symbols)  # type: ignore[attr-defined]
        except ConnectorError as exc:
            self.journal.error("market", "BRIDGE_QUOTES_FAILED",
                               f"cotations MT5 indisponibles : {exc}")
            return []
        quotes: list[Quote] = []
        for row in rows:
            try:
                symbol = str(row["symbol"]).upper()
                if symbol not in SYMBOLS:
                    continue
                timestamp = to_utc(row.get("timestamp")) or moment
                received = to_utc(row.get("received_at")) or now_utc()
                quotes.append(Quote(
                    symbol=symbol, bid=D(row["bid"]), ask=D(row["ask"]),
                    last=D(row.get("last") or row["bid"]), timestamp=timestamp,
                    source="mt5", volume=D(row["volume"]) if row.get("volume") else None,
                    received_at=received))
            except (KeyError, TypeError, ValueError):
                continue
        if not quotes:
            self.journal.warning(
                "market", "BRIDGE_QUOTES_MISSING",
                "aucune cotation MT5 reçue : aucune décision de marché ce cycle")
        return quotes

    def _reseed_history_from_bridge(self, moment) -> None:
        """Aligne l'historique synthétique sur le prix réel du terminal (une fois)."""
        try:
            rows = self.connector.quotes(self.settings.symbols)  # type: ignore[attr-defined]
        except ConnectorError:
            return
        prices = {}
        for row in rows or []:
            try:
                symbol = str(row["symbol"]).upper()
                if symbol in SYMBOLS:
                    prices[symbol] = D(row.get("last") or row["bid"])
            except (KeyError, TypeError, ValueError):
                continue
        for symbol, price in prices.items():
            self.simulator.set_price(symbol, price)
        # Aucune cotation simulée ne doit survivre à la bascule : le pont est
        # désormais l'unique source de prix.
        self.market.reset_quotes()
        for symbol in prices:
            for timeframe, count in (("1m", 260), ("5m", 240), ("15m", 140)):
                candles = self.simulator.history(symbol, timeframe, count, end=moment)
                self.market.series(symbol, timeframe).load(candles)
        if prices:
            self.journal.info("market", "HISTORY_RESEEDED",
                              f"historique réaligné sur le terminal MT5 ({len(prices)} instruments)")

    def bootstrap(self) -> None:
        self.db.migrate()
        ensure_permissions(self.settings.db_path)
        self.policy_store.bootstrap()
        self.risk.policy = self.policy_store.current()
        self._ensure_accounts()
        if self._pending_seed_users:
            self.seed_users()
        self._warm_market()
        if self._pending_bootstrap_connector:
            try:
                self.connector.connect()
                if self.uses_bridge:
                    account = self.connector.account()
                    self.journal.info(
                        "engine", "MT5_BRIDGE_CONNECTED",
                        f"pont MT5 démo connecté — compte {account.account_id} "
                        f"({account.currency}), ordres "
                        f"{'actifs' if getattr(self.connector, 'allow_orders', False) else 'désactivés'}")
                    self._reseed_history_from_bridge(self.sim_now())
            except ConnectorError as exc:
                self.journal.critical("engine", "CONNECTOR_CONNECT_FAILED",
                                      f"connexion impossible: {exc}")
                if self.uses_bridge:
                    # Pas de bascule silencieuse : le pont est la seule source autorisée.
                    self.journal.critical(
                        "engine", "MT5_BRIDGE_UNAVAILABLE",
                        "pont MT5 demandé mais indisponible : nouvelles entrées bloquées")
        self._register_hooks()
        reconciliation = self.reconciler.run("startup")
        self.entries_enabled = (reconciliation["status"] == "OK"
                                and not self.risk_states.state.suspended
                                and (self.connector.is_connected() or not self.uses_bridge))
        try:
            self._observe_equity(self.connector.account().equity)
        except ConnectorError as exc:
            self.journal.warning("engine", "EQUITY_UNAVAILABLE",
                                 f"équité du courtier indisponible : {exc}")
        self.bootstrap_done = True
        self.journal.info("engine", "ENGINE_READY",
                          f"{APP_NAME} {__version__} prêt en environnement "
                          f"{self.guard.environment}")

    def _ensure_accounts(self) -> None:
        self.db.execute(
            "INSERT OR IGNORE INTO accounts(id, name, market, environment, currency, broker,"
            " is_primary, created_at) VALUES(?,?,?,?,?,?,?,?)",
            ("SIM-0001", "Compte de simulation", "multi", ENV_SIMULATION,
             self.settings.account_currency, self.connector.name, 1, iso(now_utc())))

    def seed_users(self) -> None:
        if self.users.count() > 0:
            return
        admin_password = os.environ.get("CARNET_ADMIN_PASSWORD")
        generated = admin_password is None
        if admin_password is None:
            import secrets as _secrets

            admin_password = _secrets.token_urlsafe(18)
        self.users.create("admin", admin_password, "ADMIN", must_change=False)
        operator_password = os.environ.get("CARNET_OPERATOR_PASSWORD") or _secrets_token(18)
        viewer_password = os.environ.get("CARNET_VIEWER_PASSWORD") or _secrets_token(18)
        self.users.create("operateur", operator_password, "OPERATOR")
        self.users.create("lecture", viewer_password, "VIEWER")
        credentials_path = self.settings.var_dir / "initial_credentials.txt"
        credentials_path.write_text(
            "# Identifiants initiaux — à supprimer après la première connexion.\n"
            "# Changez les mots de passe et activez la MFA depuis l'interface.\n"
            f"admin      {admin_password}\n"
            f"operateur  {operator_password}\n"
            f"lecture    {viewer_password}\n",
            encoding="utf-8")
        try:
            credentials_path.chmod(0o600)
        except OSError:  # pragma: no cover
            pass
        self.audit.record("system", "users.seeded", {"file": str(credentials_path)})
        self.journal.warning(
            "security", "USERS_SEEDED",
            "comptes initiaux créés : mots de passe dans var/initial_credentials.txt (600)")

    def _warm_market(self) -> None:
        """Préchauffe les chandelles pour que les indicateurs soient disponibles."""
        for symbol in self.settings.symbols:
            for timeframe, count in (("1m", 260), ("5m", 240), ("15m", 140)):
                candles = self.simulator.history(symbol, timeframe, count, end=self.sim_now())
                self.market.series(symbol, timeframe).load(candles)
        # Première cotation cohérente avec la dernière chandelle 1m.
        now = self.sim_now()
        for symbol in self.settings.symbols:
            quote = self.simulator.tick(symbol, now, force=True)
            if quote:
                self.market.update_quote(quote)

    def _register_hooks(self) -> None:
        webhook = os.environ.get("CARNET_WEBHOOK_URL")
        if webhook and not self.alerts.config.url:
            # Amorçage par variable d'environnement : la configuration persistée
            # reste prioritaire et les secrets ne sont jamais journalisés.
            try:
                self.alerts.configure(url=webhook, enabled=True,
                                      min_level=os.environ.get("CARNET_WEBHOOK_MIN_LEVEL", "CRITICAL"),
                                      format=os.environ.get("CARNET_WEBHOOK_FORMAT", "auto"))
            except ValueError as exc:
                self.journal.error("notify", "ALERT_CONFIG_INVALID",
                                   f"configuration du canal d'alerte refusée : {exc}")

        def journal_hook(level: str, event: str, message: str, payload: dict[str, Any]) -> None:
            self.notifications.push(level, event, event.replace("_", " ").title(), message)

        self.journal._notifier = journal_hook  # branché explicitement, sans effet de bord
        self.notifications.register_hook(self.alerts.hook)

    # ------------------------------------------------------------------
    # Boucle
    # ------------------------------------------------------------------
    def start(self, background: bool = True) -> None:
        if not self.bootstrap_done:
            self.bootstrap()
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self.state = "RUNNING"
        self._started_at = time.time()
        self.journal.info("engine", "ENGINE_START", "moteur démarré")
        if background:
            self._thread = threading.Thread(target=self._loop, name="carnet-engine", daemon=True)
            self._thread.start()
        else:  # pragma: no cover - utile pour un démarrage manuel
            self._loop()

    def _loop(self) -> None:
        interval = max(0.1, float(self.settings.engine_tick_seconds))
        while not self._stop_event.is_set():
            try:
                self.run_once()
            except Exception as exc:  # pragma: no cover - garde-fou du thread
                self._record_error("engine_loop", exc)
                time.sleep(min(5.0, interval * 2))
                continue
            self._stop_event.wait(interval)

    def shutdown(self) -> None:
        self._stop_event.set()
        if hasattr(self.connector, "save_state"):
            try:
                self.connector.save_state()
            except Exception:  # pragma: no cover - best effort
                pass
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)
        self.state = "STOPPED"
        try:
            self.connector.disconnect()
        except Exception:  # pragma: no cover
            pass
        self.journal.info("engine", "ENGINE_STOP", "moteur arrêté")
        self.db.close()

    # ------------------------------------------------------------------
    # Un cycle complet
    # ------------------------------------------------------------------
    def sim_now(self):
        """Heure de référence : horloge du terminal si le pont est actif, sinon simulée."""
        if self.uses_bridge:
            return now_utc()
        return self.clock.now()

    def is_symbol_open(self, symbol: str, moment=None) -> bool:
        """Calendrier d'ouverture ; en simulation, Marché continu si configuré."""
        moment = moment or self.sim_now()
        if (self.guard.environment == ENV_SIMULATION and self.settings.simulation_24_7
                and not self.uses_bridge):
            return True
        return is_market_open(symbol, moment)

    def run_once(self, now=None, force_scan: bool = False) -> dict[str, Any]:
        moment = now or self.sim_now()
        cycle: dict[str, Any] = {"at": iso(moment), "orders": 0, "signals": 0, "events": 0}
        if not self.bootstrap_done:
            self.bootstrap()
        self._tick_count += 1

        # 1. Marché (pont MT5 démo ou simulation, jamais les deux)
        quotes = self._collect_quotes(moment)
        for quote in quotes:
            self.market.update_quote(quote)

        # 2. Exécution hébergée (stops, objectifs, limites)
        events = self.connector.pump(self.market.quotes()) if hasattr(self.connector, "pump") else []
        self.orders.apply_events(events)
        cycle["events"] = len(events)
        self._resolve_unknown_orders()

        # 3. Comptes et risque courant
        try:
            account = self.connector.account()
        except ConnectorError as exc:
            if not self.uses_bridge:
                raise
            # Pont muet : on continue à tourner (journal, UI) sans décision de marché.
            if not getattr(self, "_bridge_down_logged", False):
                self._bridge_down_logged = True
                self.journal.error("engine", "MT5_BRIDGE_DOWN",
                                   f"compte MT5 indisponible, entrées suspendues : {exc}")
            self.entries_enabled = False
            cycle["bridge"] = "down"
            return cycle
        self._bridge_down_logged = False
        self._observe_equity(account.equity, moment)
        self._monitor_limits(account, moment)

        # 4. Décisions de stratégie
        if self.entries_enabled and not self.risk_states.state.suspended \
                and not self.risk_states.state.kill_switch \
                and (force_scan or (time.time() - self._last_scan_time) >= 3.0):
            self._last_scan_time = time.time()
            signals = self._scan_signals(moment)
            cycle["signals"] = len(signals)
            for signal in signals:
                if self._process_signal(signal, account, moment):
                    cycle["orders"] += 1

        # 5. Persistance périodique
        self._sync_position_marks()
        if time.time() - self._last_equity_write >= 15.0:
            self._write_equity_snapshot(account, moment)
        return cycle

    def _resolve_unknown_orders(self) -> None:
        try:
            pending = self.db.scalar("SELECT COUNT(*) FROM orders WHERE state='UNKNOWN'", default=0)
            if pending:
                self.orders.resolve_unknown(self.connector)
        except Exception as exc:  # pragma: no cover - défensif
            self._record_error("resolve_unknown", exc)

    def _scan_signals(self, moment) -> list[Signal]:
        found: list[Signal] = []
        open_symbols = {p["symbol"] for p in self.orders.open_positions()}
        for symbol in self.settings.symbols:
            if not self.is_symbol_open(symbol, moment):
                continue
            if symbol in open_symbols:
                continue  # une position par instrument à la fois
            series = self.market.series(symbol, self.strategies.scan_timeframe)
            candidates = self.strategies.evaluate_all(symbol, series, moment)
            if candidates:
                candidates.sort(key=lambda s: s.confidence, reverse=True)
                candidates = candidates[:1]
            for signal in candidates:
                key = (signal.strategy, symbol)
                bar = iso(series.last.start) if series.last else iso(moment)
                if self._last_scan.get(key) == bar:
                    continue
                self._last_scan[key] = bar
                self._store_signal(signal)
                found.append(signal)
        return found

    def _store_signal(self, signal: Signal) -> None:
        self.db.execute(
            "INSERT OR IGNORE INTO signals(id, strategy, symbol, side, entry_ref, stop, target,"
            " confidence, reasons, created_at, expires_at, consumed) VALUES(?,?,?,?,?,?,?,?,?,?,?,0)",
            (signal.id, signal.strategy, signal.symbol, signal.side, str(signal.entry_ref),
             str(signal.stop), str(signal.target), str(signal.confidence),
             json.dumps(signal.reasons, ensure_ascii=False), iso(signal.created_at),
             iso(signal.expires_at) if signal.expires_at else None))
        self.journal.info(
            "strategy", "SIGNAL",
            f"signal {signal.strategy} {signal.side} {signal.symbol} @ {signal.entry_ref}",
            payload=signal.to_dict())

    def _process_signal(self, signal: Signal, account, moment) -> bool:
        started = time.perf_counter()
        context = self._risk_context(account, moment, signal.symbol)
        order_environment = (self.connector.environment if self.uses_bridge
                             else self.guard.environment)
        intent = RiskIntent(
            symbol=signal.symbol, side=signal.side, entry=signal.entry_ref,
            stop=signal.stop, target=signal.target, environment=order_environment,
            strategy=signal.strategy, signal_time=signal.created_at, signal_id=signal.id)
        decision = self.risk.evaluate(intent, context)
        latency = (time.perf_counter() - started) * 1000
        self._store_decision(signal, decision, latency)
        if not decision.allowed:
            self.db.execute("UPDATE signals SET rejected=1 WHERE id=?", (signal.id,))
            self.journal.warning(
                "risk", "SIGNAL_BLOCKED",
                f"signal refusé ({decision.code}) : {message_for(decision.code)}",
                payload={"symbol": signal.symbol, "strategy": signal.strategy,
                         "code": decision.code, "reasons": decision.reasons})
            return False
        try:
            order = self.orders.submit(
                symbol=signal.symbol, side=signal.side, qty=decision.qty,
                stop=signal.stop, target=signal.target, entry=signal.entry_ref,
                environment=order_environment, strategy=signal.strategy,
                signal_id=signal.id)
        except Exception as exc:
            self._record_error("submit_order", exc)
            return False
        self.db.execute("UPDATE signals SET consumed=1 WHERE id=?", (signal.id,))
        if order and order.get("state") not in ("REJECTED", "UNKNOWN", "CREATED", "SUBMITTED"):
            self.risk_states.register_trade()
        return True

    def _store_decision(self, signal: Signal, decision, latency_ms: float) -> None:
        self.db.execute(
            "INSERT INTO risk_decisions(id, signal_id, symbol, allowed, code, reasons, sizing,"
            " policy_version, latency_ms, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (new_uuid(), signal.id, signal.symbol, int(decision.allowed), decision.code,
             json.dumps(decision.reasons, ensure_ascii=False),
             json.dumps({"qty": float(decision.qty), "risk": float(decision.risk_amount),
                         "notional": float(decision.notional),
                         "margin": float(decision.margin_required)}, ensure_ascii=False),
             decision.policy_version, latency_ms, iso(now_utc())))

    # ------------------------------------------------------------------
    # Contexte de risque
    # ------------------------------------------------------------------
    def _risk_context(self, account, moment, signal_symbol: str | None = None) -> RiskContext:
        positions = []
        for row in self.orders.open_positions():
            risk_amount = position_risk_amount(
                row["symbol"], D(row["qty"]), D(row["entry_price"]),
                D(row["stop_price"]) if row["stop_price"] is not None else None,
                self.settings.account_currency, FX_TO_ACCOUNT)
            spec = SYMBOLS.get(row["symbol"])
            positions.append(OpenPositionRisk(
                position_id=row["id"], symbol=row["symbol"], qty=D(row["qty"]),
                risk_amount=risk_amount, group=spec.correlation_group if spec else ""))
        state = self.risk_states.state
        quotes = self.market.quotes()
        return RiskContext(
            policy=self.policy_store.current(),
            account=RiskAccount(
                account_id=account.account_id, currency=account.currency,
                balance=account.balance, equity=account.equity,
                free_margin=account.free_margin, margin_used=account.margin_used,
                leverage=account.leverage),
            quotes=quotes,
            open_positions=positions,
            state=state,
            daily_loss_pct=self.risk_states.daily_loss_pct(account.equity),
            weekly_loss_pct=self.risk_states.weekly_loss_pct(account.equity),
            drawdown_pct=self.risk_states.drawdown_pct(account.equity),
            trades_today=state.trades_today,
            market_open=self.is_symbol_open(signal_symbol, moment),
            suspended=state.suspended,
            suspension_reason=state.suspension_reason,
            kill_switch=state.kill_switch,
            conversion_rates=dict(FX_TO_ACCOUNT),
            reference_time=moment,
        )

    # ------------------------------------------------------------------
    # Surveillance des limites
    # ------------------------------------------------------------------
    def _monitor_limits(self, account, moment=None) -> None:
        self.risk_states.roll(moment or self.sim_now())
        policy = self.policy_store.current()
        equity = account.equity
        breaches: list[tuple[str, str]] = []
        if self.risk_states.daily_loss_pct(equity) >= policy.max_daily_loss_pct:
            breaches.append(("DAILY_LOSS_LIMIT",
                             f"perte journalière {self.risk_states.daily_loss_pct(equity):.2f}% "
                             f"≥ {policy.max_daily_loss_pct}%"))
        if self.risk_states.weekly_loss_pct(equity) >= policy.max_weekly_loss_pct:
            breaches.append(("WEEKLY_LOSS_LIMIT",
                             f"perte hebdomadaire {self.risk_states.weekly_loss_pct(equity):.2f}% "
                             f"≥ {policy.max_weekly_loss_pct}%"))
        if self.risk_states.drawdown_pct(equity) >= policy.max_drawdown_pct:
            breaches.append(("DRAWDOWN_LIMIT",
                             f"drawdown {self.risk_states.drawdown_pct(equity):.2f}% "
                             f"≥ {policy.max_drawdown_pct}%"))
        if breaches and not self.risk_states.state.suspended:
            code, detail = breaches[0]
            self.risk_states.suspend(code)
            self.entries_enabled = False
            self.journal.critical("risk", "RISK_LIMIT_BREACH",
                                  f"limite atteinte : {detail} — nouvelles entrées bloquées")
            self.notifications.push(
                "CRITICAL", code, "Limite de risque atteinte",
                f"{detail}. Les positions ouvertes conservent leurs protections.")
        self.entries_enabled = (
            self._last_reconciliation_ok()
            and not self.risk_states.state.suspended
            and not self.risk_states.state.kill_switch
            and self.connector.is_connected()
        )

    def _last_reconciliation_ok(self) -> bool:
        last = self.reconciler.last_result
        if last is None:
            return False
        return last["status"] == "OK"

    def _observe_equity(self, equity: Decimal, moment=None) -> None:
        self.risk_states.observe_equity(equity)

    def _write_equity_snapshot(self, account, moment) -> None:
        self._last_equity_write = time.time()
        self.db.execute(
            "INSERT INTO equity_snapshots(account_id, balance, equity, created_at)"
            " VALUES(?,?,?,?)",
            (account.account_id, str(account.balance), str(account.equity), iso(moment)))
        self._equity_history.append(
            {"at": iso(moment), "equity": float(account.equity),
             "balance": float(account.balance)})
        self._equity_history = self._equity_history[-1440:]

    def _sync_position_marks(self) -> None:
        try:
            reports = {p.platform_position_id: p for p in self.connector.positions()}
        except ConnectorError:
            return
        for position_id, report in reports.items():
            self.db.execute(
                "UPDATE positions SET unrealized_pnl=? WHERE id=?",
                (str(report.unrealized_pnl), position_id))

    # ------------------------------------------------------------------
    # Contrôles (section 19)
    # ------------------------------------------------------------------
    def stop_trading(self, actor: str, reason: str = "arrêt demandé") -> dict[str, Any]:
        with self._lock:
            self.risk_states.suspend("TRADING_SUSPENDED")
            self.entries_enabled = False
            cancelled = self.orders.cancel_pending_entries()
            self.journal.critical("control", "TRADING_SUSPENDED",
                                  f"ARRÊT TRADING par {actor} : {reason}",
                                  payload={"cancelled_orders": len(cancelled)})
            self.notifications.push(
                "CRITICAL", "TRADING_SUSPENDED", "Arrêt trading activé",
                "Nouvelles entrées bloquées. Les stops et objectifs des positions ouvertes restent actifs.")
            self.audit.record(actor, "control.stop_trading", {"reason": reason})
            return {"entries_enabled": False, "cancelled_orders": cancelled,
                    "open_positions": len(self.orders.open_positions())}

    def resume_trading(self, actor: str) -> dict[str, Any]:
        with self._lock:
            if self.risk_states.state.kill_switch:
                raise EngineError("arrêt d'urgence actif : le libérer explicitement avant de reprendre")
            reconciliation = self.reconciler.run("resume")
            if reconciliation["status"] != "OK":
                raise EngineError(
                    "réconciliation incomplète : la reprise est refusée tant que l'état n'est pas cohérent")
            self.risk_states.resume()
            self.entries_enabled = True
            self.journal.warning("control", "TRADING_RESUMED", f"reprise du trading par {actor}")
            self.audit.record(actor, "control.resume", reconciliation["status"])
            return {"entries_enabled": True, "reconciliation": reconciliation["status"]}

    def engage_kill_switch(self, actor: str, reason: str = "arrêt d'urgence") -> dict[str, Any]:
        with self._lock:
            self.risk_states.engage_kill_switch()
            self.entries_enabled = False
            cancelled = self.orders.cancel_pending_entries()
            self.journal.critical("control", "KILL_SWITCH",
                                  f"ARRÊT TRADING d'urgence par {actor} : {reason}",
                                  payload={"cancelled_orders": len(cancelled)})
            self.notifications.push(
                "CRITICAL", "KILL_SWITCH", "Arrêt d'urgence",
                "Entrées bloquées. Les protections des positions ouvertes sont conservées.")
            self.audit.record(actor, "control.kill_switch", {"reason": reason})
            return {"kill_switch": True, "entries_enabled": False,
                    "open_positions": len(self.orders.open_positions())}

    def release_kill_switch(self, actor: str) -> dict[str, Any]:
        with self._lock:
            self.risk_states.release_kill_switch()
            reconciliation = self.reconciler.run("release_kill_switch")
            self.entries_enabled = reconciliation["status"] == "OK" and not self.risk_states.state.suspended
            self.journal.warning("control", "KILL_SWITCH_RELEASED",
                                 f"arrêt d'urgence levé par {actor}")
            self.audit.record(actor, "control.release_kill_switch", reconciliation["status"])
            return {"kill_switch": False, "entries_enabled": self.entries_enabled}

    def liquidate_all(self, actor: str, reason: str = "liquidation d'urgence") -> dict[str, Any]:
        """LIQUIDATION D'URGENCE : demande, puis *vérifie* que tout est fermé."""
        with self._lock:
            self.risk_states.suspend("EMERGENCY_LIQUIDATION")
            self.entries_enabled = False
            self.orders.cancel_pending_entries()
            result: dict[str, Any] = {"requested": True, "closed": [], "remaining": []}
            try:
                if hasattr(self.connector, "force_close_all"):
                    result["closed"] = self.connector.force_close_all(reason)
                    # Les événements de clôture doivent être appliqués immédiatement :
                    # sinon l'état local divergerait de la plateforme.
                    if hasattr(self.connector, "drain_events"):
                        self.orders.apply_events(self.connector.drain_events())
                else:  # pragma: no cover - connecteurs réels non activés
                    for report in self.connector.positions():
                        self.connector.close_position(report.platform_position_id)
            except ConnectorError as exc:
                self.journal.critical("control", "LIQUIDATION_FAILED",
                                      f"liquidation impossible: {exc}")
            # Vérification auprès de la plateforme : une demande n'est pas une confirmation.
            try:
                remaining = self.connector.positions()
            except ConnectorError:  # pragma: no cover
                remaining = []
            result["remaining"] = [p.to_dict() for p in remaining]
            if remaining:
                self.journal.critical(
                    "control", "LIQUIDATION_UNCONFIRMED",
                    f"{len(remaining)} position(s) encore ouverte(s) après liquidation",
                    payload={"remaining": result["remaining"]})
                self.notifications.push(
                    "CRITICAL", "LIQUIDATION_UNCONFIRMED", "Liquidation non confirmée",
                    "Des positions restent ouvertes : intervention du propriétaire requise.")
            else:
                self.risk_states.state.emergency_liquidation_at = iso(now_utc())
                self.risk_states.save()
                self.journal.critical("control", "EMERGENCY_LIQUIDATION",
                                      f"liquidation d'urgence par {actor} : {reason}",
                                      payload={"closed": result["closed"]})
                self.notifications.push(
                    "CRITICAL", "EMERGENCY_LIQUIDATION", "Liquidation d'urgence",
                    "Toutes les positions ont été fermées et vérifiées auprès de la plateforme.")
            self.audit.record(actor, "control.liquidate", {"reason": reason})
            result["positions_open"] = len(remaining)
            return result

    # ------------------------------------------------------------------
    # Divers
    # ------------------------------------------------------------------
    def _record_error(self, where: str, exc: Exception) -> None:
        entry = {"where": where, "error": f"{type(exc).__name__}: {exc}",
                 "at": iso(now_utc()), "trace": traceback.format_exc(limit=3)}
        self._errors.append(entry)
        self._errors = self._errors[-50:]
        self.journal.error("engine", "INTERNAL_ERROR", f"{where}: {exc}")

    def metrics(self) -> dict[str, Any]:
        closed = self.orders.closed_positions(500)
        pnls = [D(p["realized_pnl"]) for p in closed]
        wins = [p for p in pnls if p > ZERO]
        losses = [p for p in pnls if p < ZERO]
        gross_profit = sum(wins, ZERO)
        gross_loss = abs(sum(losses, ZERO))
        total = len(pnls)
        win_rate = (Decimal(len(wins)) / Decimal(total) * 100) if total else ZERO
        profit_factor = (gross_profit / gross_loss) if gross_loss > ZERO else (
            Decimal(999) if gross_profit > ZERO else ZERO)
        expectancy = (sum(pnls, ZERO) / Decimal(total)) if total else ZERO
        equity_values = [float(s["equity"]) for s in self._equity_history]
        max_dd = 0.0
        peak = None
        for value in equity_values:
            peak = value if peak is None else max(peak, value)
            if peak:
                max_dd = max(max_dd, (peak - value) / peak * 100.0)
        returns = [
            (current - previous) / previous
            for previous, current in zip(equity_values, equity_values[1:])
            if previous
        ]
        sharpe = _sharpe(returns)
        fees = sum((D(p["fees"]) for p in closed), ZERO)
        return {
            "trades": total,
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": float(win_rate),
            "profit_factor": float(profit_factor),
            "expectancy": float(expectancy),
            "gross_profit": float(gross_profit),
            "gross_loss": float(gross_loss),
            "net_pnl": float(sum(pnls, ZERO)),
            "fees": float(fees),
            "max_drawdown_pct": round(max_dd, 2),
            "sharpe": round(sharpe, 2),
            "equity_curve": self._equity_history[-240:],
        }

    def performance(self) -> dict[str, Any]:
        account = self.connector.account()
        totals = self.orders.totals()
        policy = self.policy_store.current()
        equity = account.equity
        initial = self.settings.initial_capital
        return {
            "account": account.to_dict(),
            "initial_capital": float(initial),
            "equity": float(equity),
            "balance": float(account.balance),
            "unrealized": float(equity - account.balance),
            "realized_pnl": totals["realized_pnl"],
            "fees": float(D(str(totals["closed_fees"])) + D(str(totals["open_fees"]))),
            "return_pct": float((equity - initial) / initial * 100) if initial else 0.0,
            "open_positions": totals["open_positions"],
            "closed_positions": totals["closed_positions"],
            "wins": totals["wins"],
            "risk": self.risk_states.snapshot(equity),
            "limits": {
                "risk_per_trade_pct": float(policy.max_risk_per_trade_pct),
                "daily_loss_pct": float(policy.max_daily_loss_pct),
                "weekly_loss_pct": float(policy.max_weekly_loss_pct),
                "drawdown_pct": float(policy.max_drawdown_pct),
                "max_open_positions": policy.max_open_positions,
                "max_open_risk_pct": float(policy.max_open_risk_pct),
                "max_group_risk_pct": float(policy.max_group_risk_pct),
            },
        }

    def snapshot(self, user=None) -> dict[str, Any]:
        account = self.connector.account()
        policy = self.policy_store.current()
        positions = self.orders.open_positions()
        risk_state = self.risk_states.state
        open_risk = sum(
            (position_risk_amount(p["symbol"], D(p["qty"]), D(p["entry_price"]),
                                  D(p["stop_price"]) if p["stop_price"] else None,
                                  self.settings.account_currency, FX_TO_ACCOUNT)
             for p in positions), ZERO)
        indicators = {}
        for symbol in self.settings.symbols:
            indicators[symbol] = to_float_map(
                self.strategies.snapshot(self.market.series(symbol, self.strategies.scan_timeframe)))
        return {
            "app": {"name": APP_NAME, "version": __version__, "state": self.state,
                    "simulation_time": iso(self.sim_now()),
                    "simulation_speed": self.clock.speed,
                    "uptime_seconds": round(time.time() - self._started_at, 1) if self._started_at else 0,
                    "tick_count": self._tick_count, "data_mode": "simulation"},
            "environment": self.guard.status(),
            "banner": self._banner(),
            "account": account.to_dict(),
            "market": self._market_snapshot(policy),
            "positions": positions,
            "orders": self.orders.recent_orders(30),
            "signals": self.recent_signals(20),
            "risk": {
                **self.risk_states.snapshot(account.equity),
                "open_risk": float(open_risk),
                "open_risk_pct": float(open_risk / account.equity * 100) if account.equity else 0.0,
                "policy": policy.to_dict(),
                "entries_enabled": self.entries_enabled,
                "suspended": risk_state.suspended,
                "suspension_reason": risk_state.suspension_reason,
                "kill_switch": risk_state.kill_switch,
            },
            "strategies": self.strategies.describe(),
            "connectors": [self.connector.to_dict(), self.connector.health()],
            "reconciliation": self.reconciler.last_result,
            "indicators": indicators,
            "performance": self.performance(),
            "metrics": self.metrics(),
            "notifications": self.notifications.tail(8),
            "unread_notifications": self.notifications.unread_count(),
            "alerts": self.alerts.status(),
            "mt5_connection": self.mt5.public(),
            "journal": self.journal.stats(),
            "errors": self._errors[-5:],
            "server_time": iso(now_utc()),
            "simulation": {"speed": self.clock.speed, "clock": iso(self.sim_now())},
        }

    def _market_snapshot(self, policy) -> list[dict[str, Any]]:
        moment = self.sim_now()
        out = []
        for item in self.market.snapshot(policy, None):
            item["market_open"] = self.is_symbol_open(item["symbol"], moment)
            item["session"] = "continu" if item["symbol"].endswith("USDT") else "forex"
            if not item["market_open"]:
                item["issues"] = list(item.get("issues", [])) + ["MARKET_CLOSED"]
                item["fresh"] = False
            out.append(item)
        return out

    def _banner(self) -> dict[str, Any]:
        environment = self.guard.environment
        if environment.startswith("REAL"):
            return {"level": "REAL", "text": f"COMPTE RÉEL — {environment}",
                    "detail": "Ordres réels : aucune activation possible en V1."}
        if environment == "DEMO":
            return {"level": "DEMO", "text": "COMPTE DÉMO — aucun fonds réel engagé",
                    "detail": "Les données proviennent du broker de démonstration."}
        return {"level": "SIMULATION",
                "text": "DONNÉES DE SIMULATION — aucun ordre réel, aucun fonds engagé",
                "detail": "Marché synthétique déterministe. Toutes les valeurs affichées sont fictives."}

    def recent_signals(self, limit: int = 30) -> list[dict[str, Any]]:
        rows = self.db.query(
            "SELECT s.*, d.allowed, d.code, d.reasons AS decision_reasons FROM signals s"
            " LEFT JOIN risk_decisions d ON d.signal_id = s.id"
            " ORDER BY s.created_at DESC LIMIT ?", (int(limit),))
        out = []
        for row in rows:
            item = dict(row)
            for key in ("entry_ref", "stop", "target", "confidence"):
                if item.get(key) is not None:
                    item[key] = float(D(item[key]))
            item["reasons"] = json.loads(item["reasons"]) if item["reasons"] else []
            item["decision_reasons"] = json.loads(item["decision_reasons"]) if item.get(
                "decision_reasons") else []
            out.append(item)
        return out

    def status(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "environment": self.guard.environment,
            "entries_enabled": self.entries_enabled,
            "connected": self.connector.is_connected(),
            "ticks": self._tick_count,
            "symbols": list(self.settings.symbols),
            "strategies": [s["key"] for s in self.strategies.describe() if s["enabled"]],
            "db": self.db.stats(),
        }

    # -- comptes utilisateurs (interface) --------------------------------
    def user_totp_setup(self, username: str) -> dict[str, Any]:
        secret = generate_totp_secret()
        return {"secret": secret, "uri": otpauth_uri(username, secret),
                "note": "Scannez l'URI dans votre application d'authentification, puis validez un code."}


def _sharpe(returns: list[float]) -> float:
    if len(returns) < 3:
        return 0.0
    mean = sum(returns) / len(returns)
    variance = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1)
    sd = math.sqrt(variance) if variance > 0 else 0.0
    if sd <= 0:
        return 0.0
    return (mean / sd) * math.sqrt(252)


def _secrets_token(length: int) -> str:
    import secrets

    return secrets.token_urlsafe(length)


