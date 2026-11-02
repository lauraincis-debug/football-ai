"""Moteur de stratégie : indicateurs, règles, signaux (section 7).

Une stratégie produit un *signal* ; elle ne parle jamais à un connecteur et ne
peut pas contourner le moteur de risque. Chaque signal porte son stop et son
objectif, une confiance et les raisons lisibles de la décision.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Iterable

from .config import SYMBOLS, SymbolSpec
from .market import CandleSeries, atr, donchian, ema, indicator_snapshot, rsi
from .util import D, ZERO, iso, new_uuid, now_utc, quantize

SIDE_BUY = "BUY"
SIDE_SELL = "SELL"


@dataclass
class Signal:
    strategy: str
    symbol: str
    side: str
    entry_ref: Decimal
    stop: Decimal
    target: Decimal
    confidence: Decimal
    reasons: list[str]
    timeframe: str = "5m"
    created_at: Any = field(default_factory=now_utc)
    expires_at: Any = None
    id: str = ""
    meta: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.id:
            fingerprint = (
                f"{self.strategy}|{self.symbol}|{self.side}|{self.entry_ref}|"
                f"{self.stop}|{self.target}|{iso(self.created_at)}"
            )
            self.id = hashlib.sha256(fingerprint.encode()).hexdigest()[:24]

    @property
    def reward_risk(self) -> Decimal:
        risk = abs(self.entry_ref - self.stop)
        if risk <= ZERO:
            return ZERO
        return abs(self.target - self.entry_ref) / risk

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "strategy": self.strategy, "symbol": self.symbol,
            "side": self.side, "entry_ref": float(self.entry_ref),
            "stop": float(self.stop), "target": float(self.target),
            "confidence": float(self.confidence), "reasons": self.reasons,
            "timeframe": self.timeframe, "created_at": iso(self.created_at),
            "expires_at": iso(self.expires_at) if self.expires_at else None,
            "reward_risk": float(self.reward_risk), "meta": self.meta,
        }


class Strategy:
    """Contrat commun à toutes les stratégies."""

    key = "base"
    label = "Stratégie de base"
    description = ""
    timeframe = "5m"
    warmup = 60
    default_params: dict[str, Any] = {}

    def __init__(self, enabled: bool = True, params: dict[str, Any] | None = None):
        self.enabled = enabled
        self.params = {**self.default_params, **(params or {})}

    # -- helpers ---------------------------------------------------------
    def _quantize(self, symbol: str, value: Decimal) -> Decimal:
        return quantize(value, SYMBOLS[symbol].tick_size)

    def info(self) -> dict[str, Any]:
        return {
            "key": self.key, "label": self.label, "description": self.description,
            "timeframe": self.timeframe, "enabled": self.enabled, "params": self.params,
            "warmup": self.warmup,
        }

    # -- évaluation ------------------------------------------------------
    def evaluate(self, symbol: str, series: CandleSeries, moment=None) -> Signal | None:
        raise NotImplementedError

    def _signal(self, symbol: str, side: str, entry: Decimal, stop: Decimal, target: Decimal,
                confidence: Decimal, reasons: list[str], meta: dict[str, Any] | None = None,
                moment=None) -> Signal:
        return Signal(
            strategy=self.key, symbol=symbol, side=side,
            entry_ref=self._quantize(symbol, entry),
            stop=self._quantize(symbol, stop),
            target=self._quantize(symbol, target),
            confidence=max(ZERO, min(Decimal(1), confidence)),
            reasons=reasons, timeframe=self.timeframe, meta=meta or {},
            # Horodatage en temps de marché : la fraîcheur du signal doit être
            # comparée à l'horloge de marché, jamais à l'horloge réelle.
            created_at=moment if moment is not None else now_utc(),
        )


class EmaTrendStrategy(Strategy):
    key = "ema_trend"
    label = "Suivi de tendance EMA"
    description = ("Croisement EMA rapide/lente confirmé par la tendance de fond ; stop à "
                   "2 ATR, objectif à 3 ATR (ratio minimal 1,2 respecté).")
    timeframe = "15m"
    warmup = 80
    default_params = {
        "fast": 12, "slow": 26, "trend": 50, "atr_period": 14,
        "atr_stop_mult": 2.0, "atr_target_mult": 3.0,
    }

    def evaluate(self, symbol: str, series: CandleSeries,
                 moment=None) -> Signal | None:
        if not self.enabled or len(series) < self.warmup:
            return None
        closes = series.closes()
        fast_now = ema(closes, int(self.params["fast"]))
        slow_now = ema(closes, int(self.params["slow"]))
        fast_prev = ema(closes[:-1], int(self.params["fast"]))
        slow_prev = ema(closes[:-1], int(self.params["slow"]))
        trend = ema(closes, int(self.params["trend"]))
        volatility = atr(series.candles, int(self.params["atr_period"]))
        if None in (fast_now, slow_now, fast_prev, slow_prev, trend, volatility) or volatility <= ZERO:
            return None
        price = closes[-1]
        crossed_up = fast_prev <= slow_prev and fast_now > slow_now
        crossed_down = fast_prev >= slow_prev and fast_now < slow_now
        stop_mult = D(str(self.params["atr_stop_mult"]))
        target_mult = D(str(self.params["atr_target_mult"]))
        if crossed_up and price > trend:
            stop = price - volatility * stop_mult
            target = price + volatility * target_mult
            separation = min(abs(fast_now - slow_now) / volatility, Decimal(1))
            return self._signal(
                symbol, SIDE_BUY, price, stop, target,
                Decimal("0.55") + separation / Decimal(4),
                [f"EMA{self.params['fast']} croise au-dessus d'EMA{self.params['slow']}",
                 f"Prix au-dessus de l'EMA{self.params['trend']} (tendance de fond haussière)",
                 f"Stop à {stop_mult} ATR, objectif à {target_mult} ATR"],
                {"atr": str(volatility), "ema_fast": str(fast_now), "ema_slow": str(slow_now)},
                moment=moment,
            )
        if crossed_down and price < trend:
            stop = price + volatility * stop_mult
            target = price - volatility * target_mult
            separation = min(abs(fast_now - slow_now) / volatility, Decimal(1))
            return self._signal(
                symbol, SIDE_SELL, price, stop, target,
                Decimal("0.55") + separation / Decimal(4),
                [f"EMA{self.params['fast']} croise sous EMA{self.params['slow']}",
                 f"Prix sous l'EMA{self.params['trend']} (tendance de fond baissière)",
                 f"Stop à {stop_mult} ATR, objectif à {target_mult} ATR"],
                {"atr": str(volatility), "ema_fast": str(fast_now), "ema_slow": str(slow_now)},
                moment=moment,
            )
        return None


class OpeningRangeBreakoutStrategy(Strategy):
    key = "orb_breakout"
    label = "Rupture de range d'ouverture"
    description = ("Cassure du plus haut / plus bas des 20 dernières bougies, stop au milieu "
                   "du range, objectif à 1,8 fois le risque.")
    timeframe = "15m"
    warmup = 40
    default_params = {"lookback": 20, "buffer_atr": "0.15", "target_rr": "1.8"}

    def evaluate(self, symbol: str, series: CandleSeries,
                 moment=None) -> Signal | None:
        if not self.enabled or len(series) < self.warmup:
            return None
        candles = series.candles[:-1]
        if len(candles) < int(self.params["lookback"]) + 1:
            return None
        window = candles[-int(self.params["lookback"]):]
        high = max(c.high for c in window)
        low = min(c.low for c in window)
        volatility = atr(candles, 14)
        if volatility is None or volatility <= ZERO:
            return None
        last = series.candles[-1]
        price = last.close
        buffer_value = volatility * D(str(self.params["buffer_atr"]))
        target_rr = D(str(self.params["target_rr"]))
        width = high - low
        if width <= ZERO:
            return None
        if price > high + buffer_value:
            stop = (high + low) / 2
            risk = price - stop
            if risk <= ZERO:
                return None
            return self._signal(
                symbol, SIDE_BUY, price, stop, price + risk * target_rr, Decimal("0.62"),
                [f"Clôture {price} au-dessus du plus haut de range {high}",
                 f"Range de {int(self.params['lookback'])} bougies large de {width:.5f}",
                 "Stop au milieu du range, objectif à 1,8 fois le risque"],
                {"range_high": str(high), "range_low": str(low)},
                moment=moment,
            )
        if price < low - buffer_value:
            stop = (high + low) / 2
            risk = stop - price
            if risk <= ZERO:
                return None
            return self._signal(
                symbol, SIDE_SELL, price, stop, price - risk * target_rr, Decimal("0.62"),
                [f"Clôture {price} sous le plus bas de range {low}",
                 f"Range de {int(self.params['lookback'])} bougies large de {width:.5f}",
                 "Stop au milieu du range, objectif à 1,8 fois le risque"],
                {"range_high": str(high), "range_low": str(low)},
                moment=moment,
            )
        return None


class RsiReversionStrategy(Strategy):
    key = "rsi_reversion"
    label = "Retour à la moyenne (RSI)"
    description = ("Excès de RSI avec rejet de prix ; stop sous le plus bas récent, objectif à "
                   "1,6 fois le risque, uniquement dans le sens de la tendance de fond.")
    timeframe = "15m"
    warmup = 70
    default_params = {"rsi_period": 14, "oversold": 30, "overbought": 70,
                      "atr_stop_mult": "0.6", "target_rr": "1.6"}

    def evaluate(self, symbol: str, series: CandleSeries,
                 moment=None) -> Signal | None:
        if not self.enabled or len(series) < self.warmup:
            return None
        closes = series.closes()
        value = rsi(closes, int(self.params["rsi_period"]))
        trend = ema(closes, 50)
        volatility = atr(series.candles, 14)
        if value is None or trend is None or volatility is None or volatility <= ZERO:
            return None
        price = closes[-1]
        stop_mult = D(str(self.params["atr_stop_mult"]))
        target_rr = D(str(self.params["target_rr"]))
        if value <= D(str(self.params["oversold"])) and price > trend:
            stop = min(series.lows(6)) - volatility * stop_mult
            risk = price - stop
            if risk <= ZERO:
                return None
            confidence = Decimal("0.5") + (D(str(self.params["oversold"])) - value) / Decimal(100)
            return self._signal(
                symbol, SIDE_BUY, price, stop, price + risk * target_rr, confidence,
                [f"RSI {value:.1f} en survente", "Prix au-dessus de l'EMA50 (tendance haussière)",
                 "Stop sous le plus bas des 6 dernières bougies"],
                {"rsi": str(value), "atr": str(volatility)},
                moment=moment,
            )
        if value >= D(str(self.params["overbought"])) and price < trend:
            stop = max(series.highs(6)) + volatility * stop_mult
            risk = stop - price
            if risk <= ZERO:
                return None
            confidence = Decimal("0.5") + (value - D(str(self.params["overbought"]))) / Decimal(100)
            return self._signal(
                symbol, SIDE_SELL, price, stop, price - risk * target_rr, confidence,
                [f"RSI {value:.1f} en surachat", "Prix sous l'EMA50 (tendance baissière)",
                 "Stop au-dessus du plus haut des 6 dernières bougies"],
                {"rsi": str(value), "atr": str(volatility)},
                moment=moment,
            )
        return None


STRATEGY_CLASSES = {
    EmaTrendStrategy.key: EmaTrendStrategy,
    OpeningRangeBreakoutStrategy.key: OpeningRangeBreakoutStrategy,
    RsiReversionStrategy.key: RsiReversionStrategy,
}


class StrategyRegistry:
    def __init__(self, enabled_keys: Iterable[str] | None = None):
        keys = list(enabled_keys) if enabled_keys is not None else list(STRATEGY_CLASSES)
        self.strategies: dict[str, Strategy] = {
            key: cls(enabled=True) for key, cls in STRATEGY_CLASSES.items() if key in keys
        }
        for key, cls in STRATEGY_CLASSES.items():
            if key not in self.strategies:
                self.strategies[key] = cls(enabled=False)

    def get(self, key: str) -> Strategy | None:
        return self.strategies.get(key)

    @property
    def scan_timeframe(self) -> str:
        timeframes = {s.timeframe for s in self.enabled()}
        return sorted(timeframes)[-1] if timeframes else "15m"

    def enabled(self) -> list[Strategy]:
        return [s for s in self.strategies.values() if s.enabled]

    def set_enabled(self, key: str, enabled: bool) -> Strategy:
        strategy = self.strategies[key]
        strategy.enabled = enabled
        return strategy

    def evaluate_all(self, symbol: str, series: CandleSeries,
                     moment=None) -> list[Signal]:
        signals = []
        for strategy in self.enabled():
            signal = strategy.evaluate(symbol, series, moment)
            if signal is not None:
                signals.append(signal)
        return signals

    def describe(self) -> list[dict[str, Any]]:
        return [s.info() for s in self.strategies.values()]

    def snapshot(self, series: CandleSeries) -> dict[str, Any]:
        data = indicator_snapshot(series)
        return {k: (str(v) if isinstance(v, Decimal) else v) for k, v in data.items()}
