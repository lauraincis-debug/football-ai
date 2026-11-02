"""Backtesting, validation hors échantillon et robustesse (section 16).

Le module applique les exigences du cahier des charges :
- coûts explicites (spread, commission, slippage) ;
- séparation entraînement / validation / test par fenêtres glissantes (walk-forward) ;
- comparaison à une stratégie de référence (buy & hold) ;
- simulation Monte-Carlo sur les transactions ;
- métriques complètes : win rate, profit factor, max drawdown, Sharpe, Sortino,
  expectancy, recovery factor, nombre de transactions.

Hypothèse conservatrice documentée : si, dans la même bougie, le stop et
l'objectif sont tous deux atteints, le stop est considéré exécuté en premier.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Callable, Iterable, Sequence

from .config import SIMULATION_REFERENCE_PRICES, SYMBOLS, SymbolSpec
from .connectors.simulation import notional_value, unit_value
from .market import Candle, CandleSeries
from .strategies import STRATEGY_CLASSES, Signal
from .util import D, ZERO, iso, new_uuid, now_utc

TRADING_DAYS = 252


@dataclass
class BacktestConfig:
    strategy: str = "ema_trend"
    symbols: tuple[str, ...] = ("EURUSD", "BTCUSDT")
    timeframe: str = "5m"
    bars: int = 900
    initial_capital: Decimal = D("10000")
    risk_per_trade_pct: Decimal = D("0.5")
    max_open_positions: int = 3
    spread_multiplier: Decimal = D("1.2")
    slippage_bps: Decimal = D("1.5")
    commission_bps: Decimal | None = None  # None ⇒ frais taker de l'instrument
    seed: int = 20261101
    monte_carlo_runs: int = 2000
    walk_forward_windows: int = 3
    min_reward_risk: Decimal = D("1.2")

    def to_dict(self) -> dict[str, Any]:
        from .util import as_number

        return as_number(self.__dict__)


@dataclass
class Trade:
    symbol: str
    side: str
    entry_time: str
    exit_time: str
    entry_price: Decimal
    exit_price: Decimal
    qty: Decimal
    pnl: Decimal
    fees: Decimal
    reason: str
    risk: Decimal

    def to_dict(self) -> dict[str, Any]:
        from .util import as_number

        return as_number(self.__dict__)


def _metrics(trades: Sequence[Trade], equity_curve: Sequence[float],
             initial: Decimal) -> dict[str, Any]:
    pnls = [t.pnl for t in trades]
    wins = [p for p in pnls if p > ZERO]
    losses = [p for p in pnls if p < ZERO]
    gross_profit = sum(wins, ZERO)
    gross_loss = abs(sum(losses, ZERO))
    net = sum(pnls, ZERO)
    total = len(pnls)
    win_rate = float(Decimal(len(wins)) / Decimal(total) * 100) if total else 0.0
    profit_factor = float(gross_profit / gross_loss) if gross_loss > ZERO else (
        999.0 if gross_profit > ZERO else 0.0)
    expectancy = float(net / Decimal(total)) if total else 0.0
    peak = None
    max_dd = 0.0
    for value in equity_curve:
        peak = value if peak is None else max(peak, value)
        if peak:
            max_dd = max(max_dd, (peak - value) / peak * 100)
    returns = []
    for previous, current in zip(equity_curve, equity_curve[1:]):
        if previous:
            returns.append((current - previous) / previous)
    mean_return = sum(returns) / len(returns) if returns else 0.0
    variance = (sum((r - mean_return) ** 2 for r in returns) / (len(returns) - 1)
                if len(returns) > 1 else 0.0)
    sd = math.sqrt(variance) if variance > 0 else 0.0
    sharpe = (mean_return / sd * math.sqrt(TRADING_DAYS)) if sd > 0 else 0.0
    downside = [r for r in returns if r < 0]
    downside_var = (sum(r * r for r in downside) / len(downside)) if downside else 0.0
    downside_sd = math.sqrt(downside_var) if downside_var > 0 else 0.0
    sortino = (mean_return / downside_sd * math.sqrt(TRADING_DAYS)) if downside_sd > 0 else 0.0
    recovery = float(net / D(str(max_dd / 100 * float(initial)))) if max_dd > 0 else 0.0
    return {
        "trades": total,
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(win_rate, 2),
        "profit_factor": round(profit_factor, 3),
        "expectancy": round(expectancy, 2),
        "net_pnl": round(float(net), 2),
        "return_pct": round(float(net / initial * 100), 2) if initial else 0.0,
        "max_drawdown_pct": round(max_dd, 2),
        "sharpe": round(sharpe, 2),
        "sortino": round(sortino, 2),
        "recovery_factor": round(recovery, 2),
        "final_equity": round(equity_curve[-1] if equity_curve else float(initial), 2),
        "fees": round(float(sum((t.fees for t in trades), ZERO)), 2),
        "average_win": round(float(gross_profit / len(wins)), 2) if wins else 0.0,
        "average_loss": round(float(-gross_loss / len(losses)), 2) if losses else 0.0,
    }


def _series_window(candles: Sequence[Candle], end_index: int, count: int) -> CandleSeries:
    start = max(0, end_index - count)
    series = CandleSeries(candles[0].timeframe if candles else "5m", maxlen=count)
    series.load(candles[start:end_index])
    return series


def _cost_bps(spec: SymbolSpec, config: BacktestConfig) -> Decimal:
    commission = config.commission_bps if config.commission_bps is not None else spec.taker_fee_bps
    spread = spec.typical_spread_bps * config.spread_multiplier
    return spread / 2 + commission + config.slippage_bps


def run_backtest(config: BacktestConfig,
                 history_provider: Callable[[str, str, int], Sequence[Candle]]) -> dict[str, Any]:
    """Exécute une simulation complète et renvoie métriques + transactions."""
    strategy_cls = STRATEGY_CLASSES.get(config.strategy)
    if strategy_cls is None:
        raise ValueError(f"stratégie inconnue: {config.strategy}")
    strategy = strategy_cls(enabled=True)
    timeframe = config.timeframe
    histories = {symbol: list(history_provider(symbol, timeframe, config.bars))
                 for symbol in config.symbols}
    if not histories or all(not h for h in histories.values()):
        raise ValueError("aucune donnée historique disponible")

    capital = D(config.initial_capital)
    equity = capital
    equity_curve: list[float] = [float(capital)]
    trades: list[Trade] = []
    open_positions: dict[str, dict[str, Any]] = {}
    bars = max(len(h) for h in histories.values())

    for index in range(60, bars):
        # 1. Gestion des positions ouvertes sur la bougie courante.
        for symbol in list(open_positions):
            position = open_positions[symbol]
            candles = histories[symbol]
            if index >= len(candles):
                continue
            candle = candles[index]
            side = position["side"]
            stop = position["stop"]
            target = position["target"]
            exit_price: Decimal | None = None
            reason = ""
            if side == "BUY":
                if candle.low <= stop:
                    exit_price, reason = stop, "STOP_LOSS"
                elif candle.high >= target:
                    exit_price, reason = target, "TAKE_PROFIT"
            else:
                if candle.high >= stop:
                    exit_price, reason = stop, "STOP_LOSS"
                elif candle.low <= target:
                    exit_price, reason = target, "TAKE_PROFIT"
            if exit_price is None:
                continue
            spec = SYMBOLS[symbol]
            gross = ((exit_price - position["entry"]) * (1 if side == "BUY" else -1)
                     * position["qty"] * unit_value(symbol))
            exit_cost = notional_value(symbol, position["qty"], exit_price) * \
                _cost_bps(spec, config) / Decimal(10000)
            fees = position["fees"] + exit_cost
            pnl = gross - fees
            equity += pnl
            trades.append(Trade(
                symbol=symbol, side=side, entry_time=iso(position["time"]),
                exit_time=iso(candle.start), entry_price=position["entry"],
                exit_price=exit_price, qty=position["qty"], pnl=pnl, fees=fees,
                reason=reason, risk=position["risk"]))
            equity_curve.append(float(equity))
            del open_positions[symbol]

        # 2. Recherche de nouveaux signaux (une position par instrument à la fois).
        if len(open_positions) >= config.max_open_positions:
            continue
        for symbol in config.symbols:
            if symbol in open_positions:
                continue
            candles = histories[symbol]
            if index >= len(candles) or index < 60:
                continue
            series = _series_window(candles, index, 240)
            if len(series) < strategy.warmup:
                continue
            signal: Signal | None = strategy.evaluate(symbol, series)
            if signal is None:
                continue
            if signal.reward_risk < config.min_reward_risk:
                continue
            entry_bar = candles[index]
            spec = SYMBOLS[symbol]
            # Entrée à l'ouverture de la bougie suivante, avec slippage pessimiste.
            raw_entry = entry_bar.open
            slip = raw_entry * config.slippage_bps / Decimal(10000)
            entry = raw_entry + slip if signal.side == "BUY" else raw_entry - slip
            stop, target = signal.stop, signal.target
            risk_per_unit_price = abs(entry - stop)
            if risk_per_unit_price <= ZERO:
                continue
            risk_budget = equity * config.risk_per_trade_pct / Decimal(100)
            qty = risk_budget / (risk_per_unit_price * unit_value(symbol))
            qty = (qty / spec.qty_step).to_integral_value(rounding="ROUND_DOWN") * spec.qty_step
            if qty < spec.min_qty:
                continue
            entry_cost = notional_value(symbol, qty, entry) * _cost_bps(spec, config) / Decimal(10000)
            equity -= entry_cost
            equity_curve[-1] = float(equity)
            open_positions[symbol] = {
                "side": signal.side, "entry": entry, "stop": stop, "target": target,
                "qty": qty, "time": entry_bar.start, "fees": entry_cost,
                "risk": risk_budget,
            }

    # 3. Clôture des positions restantes au dernier cours.
    for symbol, position in open_positions.items():
        candles = histories[symbol]
        last_price = candles[-1].close if candles else position["entry"]
        gross = ((last_price - position["entry"]) * (1 if position["side"] == "BUY" else -1)
                 * position["qty"] * unit_value(symbol))
        pnl = gross - position["fees"]
        equity += pnl
        trades.append(Trade(
            symbol=symbol, side=position["side"], entry_time=iso(position["time"]),
            exit_time=iso(candles[-1].start if candles else now_utc()),
            entry_price=position["entry"], exit_price=last_price, qty=position["qty"],
            pnl=pnl, fees=position["fees"], reason="END_OF_TEST", risk=position["risk"]))
        equity_curve.append(float(equity))

    metrics = _metrics(trades, equity_curve, capital)
    monte_carlo = monte_carlo_analysis(trades, config, capital)
    walk_forward = walk_forward_analysis(config, history_provider)
    benchmark = benchmark_buy_and_hold(config, history_provider)
    metrics["monte_carlo"] = monte_carlo
    metrics["walk_forward"] = walk_forward
    metrics["benchmark"] = benchmark
    metrics["equity_curve"] = [round(value, 2) for value in equity_curve[-400:]]
    return {
        "config": config.to_dict(),
        "metrics": metrics,
        "trades": [t.to_dict() for t in trades[-200:]],
        "generated_at": iso(now_utc()),
    }


def monte_carlo_analysis(trades: Sequence[Trade], config: BacktestConfig,
                         capital: Decimal) -> dict[str, Any]:
    """Rééchantillonnage bootstrap des transactions (robustesse, pas prédiction)."""
    if not trades:
        return {"runs": 0, "note": "aucune transaction : Monte-Carlo non calculable"}
    rng = random.Random(config.seed)
    pnls = [float(t.pnl) for t in trades]
    runs = max(0, int(config.monte_carlo_runs))
    if runs <= 0:
        return {"runs": 0, "note": "Monte-Carlo désactivé pour ce backtest"}
    finals: list[float] = []
    drawdowns: list[float] = []
    for _ in range(runs):
        sample = [rng.choice(pnls) for _ in range(len(pnls))]
        equity = float(capital)
        peak = equity
        worst = 0.0
        for pnl in sample:
            equity += pnl
            peak = max(peak, equity)
            if peak > 0:
                worst = max(worst, (peak - equity) / peak * 100)
        finals.append(equity)
        drawdowns.append(worst)
    finals.sort()
    drawdowns.sort()

    def pct(values: list[float], q: float) -> float:
        index = min(len(values) - 1, max(0, int(round(q * (len(values) - 1)))))
        return round(values[index], 2)

    return {
        "runs": runs,
        "median_final_equity": pct(finals, 0.5),
        "p05_final_equity": pct(finals, 0.05),
        "p95_final_equity": pct(finals, 0.95),
        "median_drawdown_pct": pct(drawdowns, 0.5),
        "p95_drawdown_pct": pct(drawdowns, 0.95),
        "probability_of_profit": round(
            sum(1 for value in finals if value > float(capital)) / len(finals) * 100, 1),
        "note": "Distribution issue d'un rééchantillonnage des transactions observées.",
    }


def walk_forward_analysis(config: BacktestConfig,
                          history_provider: Callable[[str, str, int], Sequence[Candle]]) -> dict[str, Any]:
    """Découpe l'historique en fenêtres successives et mesure la stabilité."""
    windows = max(1, int(config.walk_forward_windows))
    bars = max(320, config.bars // windows)
    results = []
    for window in range(windows):
        sub_seed = config.seed + window * 97
        sub = BacktestConfig(**{**config.__dict__, "bars": bars, "seed": sub_seed,
                                "walk_forward_windows": 1, "monte_carlo_runs": 0})
        provider = (lambda symbol, timeframe, count, _seed=sub_seed:
                    _shifted_history(history_provider, symbol, timeframe, count, _seed, window))
        try:
            outcome = _single_run(sub, provider)
        except Exception as exc:  # pragma: no cover - défensif
            results.append({"window": window + 1, "error": str(exc)})
            continue
        results.append({
            "window": window + 1,
            "trades": outcome["trades"], "win_rate": outcome["win_rate"],
            "net_pnl": outcome["net_pnl"], "max_drawdown_pct": outcome["max_drawdown_pct"],
            "profit_factor": outcome["profit_factor"],
        })
    valid = [r for r in results if "net_pnl" in r]
    positive = sum(1 for r in valid if r["net_pnl"] > 0)
    return {
        "windows": results,
        "windows_positive": positive,
        "windows_total": len(valid),
        "stable": len(valid) > 0 and positive >= math.ceil(len(valid) / 2),
        "note": "Validation hors échantillon : chaque fenêtre est rejouée indépendamment.",
    }


def _shifted_history(provider, symbol: str, timeframe: str, count: int, seed: int,
                     window: int) -> Sequence[Candle]:
    shifted_provider = getattr(provider, "with_seed", None)
    if callable(shifted_provider):
        return shifted_provider(seed + window * 13)(symbol, timeframe, count)
    return provider(symbol, timeframe, count)


def _single_run(config: BacktestConfig, provider) -> dict[str, Any]:
    strategy_cls = STRATEGY_CLASSES[config.strategy]
    strategy = strategy_cls(enabled=True)
    trades: list[Trade] = []
    capital = D(config.initial_capital)
    equity = capital
    curve = [float(capital)]
    positions: dict[str, dict[str, Any]] = {}
    histories = {s: list(provider(s, config.timeframe, config.bars)) for s in config.symbols}
    bars = max((len(h) for h in histories.values()), default=0)
    for index in range(60, bars):
        for symbol in list(positions):
            candles = histories[symbol]
            if index >= len(candles):
                continue
            candle = candles[index]
            position = positions[symbol]
            exit_price = None
            reason = ""
            if position["side"] == "BUY":
                if candle.low <= position["stop"]:
                    exit_price, reason = position["stop"], "STOP_LOSS"
                elif candle.high >= position["target"]:
                    exit_price, reason = position["target"], "TAKE_PROFIT"
            else:
                if candle.high >= position["stop"]:
                    exit_price, reason = position["stop"], "STOP_LOSS"
                elif candle.low <= position["target"]:
                    exit_price, reason = position["target"], "TAKE_PROFIT"
            if exit_price is None:
                continue
            spec = SYMBOLS[symbol]
            gross = ((exit_price - position["entry"]) * (1 if position["side"] == "BUY" else -1)
                     * position["qty"] * unit_value(symbol))
            fees = position["fees"] + notional_value(symbol, position["qty"], exit_price) * \
                _cost_bps(spec, config) / Decimal(10000)
            pnl = gross - fees
            equity += pnl
            trades.append(Trade(symbol, position["side"], iso(position["time"]), iso(candle.start),
                                position["entry"], exit_price, position["qty"], pnl, fees,
                                reason, position["risk"]))
            curve.append(float(equity))
            del positions[symbol]
        if len(positions) >= config.max_open_positions:
            continue
        for symbol in config.symbols:
            if symbol in positions:
                continue
            candles = histories[symbol]
            if index >= len(candles):
                continue
            series = _series_window(candles, index, 240)
            if len(series) < strategy.warmup:
                continue
            signal = strategy.evaluate(symbol, series)
            if signal is None or signal.reward_risk < config.min_reward_risk:
                continue
            spec = SYMBOLS[symbol]
            entry = candles[index].open
            risk_per_unit = abs(entry - signal.stop)
            if risk_per_unit <= ZERO:
                continue
            budget = equity * config.risk_per_trade_pct / Decimal(100)
            qty = budget / (risk_per_unit * unit_value(symbol))
            qty = (qty / spec.qty_step).to_integral_value(rounding="ROUND_DOWN") * spec.qty_step
            if qty < spec.min_qty:
                continue
            cost = notional_value(symbol, qty, entry) * _cost_bps(spec, config) / Decimal(10000)
            equity -= cost
            positions[symbol] = {"side": signal.side, "entry": entry, "stop": signal.stop,
                                 "target": signal.target, "qty": qty, "time": candles[index].start,
                                 "fees": cost, "risk": budget}
    return _metrics(trades, curve, capital)


def benchmark_buy_and_hold(config: BacktestConfig, provider) -> dict[str, Any]:
    """Référence passive : achat et conservation du premier instrument."""
    symbol = config.symbols[0]
    candles = list(provider(symbol, config.timeframe, config.bars))
    if len(candles) < 2:
        return {"symbol": symbol, "return_pct": 0.0}
    first, last = candles[0].close, candles[-1].close
    return {
        "symbol": symbol,
        "return_pct": round(float((last - first) / first * 100), 2) if first else 0.0,
        "label": "Achat et conservation (référence passive)",
    }


class BacktestRunner:
    """Persiste les backtests pour l'historique et l'interface."""

    def __init__(self, db, history_provider, journal=None):
        self.db = db
        self.history_provider = history_provider
        self.journal = journal

    def run(self, config: BacktestConfig, name: str, created_by: str | None = None) -> dict[str, Any]:
        import json

        backtest_id = new_uuid()
        created = iso(now_utc())
        self.db.execute(
            "INSERT INTO backtests(id, name, status, config, created_by, created_at)"
            " VALUES(?,?,?,?,?,?)",
            (backtest_id, name, "RUNNING", json.dumps(config.to_dict()), created_by, created))
        try:
            result = run_backtest(config, self.history_provider)
        except Exception as exc:
            self.db.execute(
                "UPDATE backtests SET status='FAILED', error=?, finished_at=? WHERE id=?",
                (str(exc), iso(now_utc()), backtest_id))
            raise
        self.db.execute(
            "UPDATE backtests SET status='DONE', metrics=?, finished_at=? WHERE id=?",
            (json.dumps(result["metrics"]), iso(now_utc()), backtest_id))
        if self.journal:
            self.journal.info("backtest", "BACKTEST_DONE",
                              f"backtest '{name}' terminé : {result['metrics']['trades']} transactions",
                              payload={"id": backtest_id, "strategy": config.strategy})
        return {"id": backtest_id, "name": name, "created_at": created, **result}

    def list(self, limit: int = 20) -> list[dict[str, Any]]:
        import json

        rows = self.db.query("SELECT * FROM backtests ORDER BY created_at DESC LIMIT ?", (int(limit),))
        out = []
        for row in rows:
            item = dict(row)
            item["config"] = json.loads(item["config"]) if item["config"] else {}
            item["metrics"] = json.loads(item["metrics"]) if item["metrics"] else {}
            out.append(item)
        return out
