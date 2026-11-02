"""Données de marché : cotations, chandelles, indicateurs, contrôle de fraîcheur.

Le cahier des charges (section 13) impose un contrôle systématique avant
décision : horodatage, fraîcheur, cohérence bid/ask, spread, variation anormale.
Aucune donnée périmée ou incohérente ne peut franchir le moteur de risque.
"""

from __future__ import annotations

import math
import threading
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Iterable, Sequence

from .config import SYMBOLS, SymbolSpec
from .util import D, ZERO, age_seconds, iso, now_utc, to_utc

TIMEFRAMES = ("1m", "5m", "15m", "1h")
TIMEFRAME_SECONDS = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600}


class StaleDataError(Exception):
    pass


@dataclass
class Quote:
    symbol: str
    bid: Decimal
    ask: Decimal
    last: Decimal
    timestamp: Any  # datetime UTC
    source: str = "simulation"
    volume: Decimal | None = None
    sequence: int = 0
    #: Heure de réception locale (horloge réelle) : sert au contrôle de fraîcheur
    #: du flux. ``timestamp`` reste l'heure de marché (horloge simulée).
    received_at: Any = None

    @property
    def mid(self) -> Decimal:
        return (self.bid + self.ask) / 2

    @property
    def spread(self) -> Decimal:
        return self.ask - self.bid

    @property
    def spread_bps(self) -> Decimal:
        mid = self.mid
        if mid <= ZERO:
            return Decimal("999999")
        return (self.spread / mid) * Decimal(10000)

    @property
    def at(self):
        return to_utc(self.timestamp)

    def market_age(self, reference=None) -> float:
        """Âge de la cotation en temps de marché (horloge simulée)."""
        return age_seconds(self.timestamp, reference)

    def age(self, reference=None) -> float:
        """Âge du flux en temps réel : c'est lui qui décide de la fraîcheur."""
        return age_seconds(self.received_at or self.timestamp, reference)

    def is_fresh(self, max_age: Decimal | float) -> bool:
        return self.age() <= float(max_age)

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "bid": float(self.bid),
            "ask": float(self.ask),
            "last": float(self.last),
            "mid": float(self.mid),
            "spread": float(self.spread),
            "spread_bps": float(self.spread_bps),
            "timestamp": iso(self.at),
            "received_at": iso(to_utc(self.received_at)) if self.received_at else None,
            "age_seconds": round(self.age(), 3),
            "market_age_seconds": round(self.market_age(), 3),
            "source": self.source,
            "volume": float(self.volume) if self.volume is not None else None,
        }


@dataclass
class Candle:
    start: Any  # datetime UTC, début de la période
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal = ZERO
    timeframe: str = "1m"

    def to_dict(self) -> dict[str, Any]:
        return {
            "time": iso(self.start),
            "open": float(self.open), "high": float(self.high),
            "low": float(self.low), "close": float(self.close),
            "volume": float(self.volume),
        }

    @property
    def range(self) -> Decimal:
        return max(self.high - self.low, ZERO)


def timeframe_start(moment, timeframe: str):
    moment = to_utc(moment)
    seconds = TIMEFRAME_SECONDS[timeframe]
    epoch = int(moment.timestamp())
    return to_utc(epoch - epoch % seconds)


class CandleSeries:
    """Série OHLC bornée, mise à jour tick par tick."""

    def __init__(self, timeframe: str = "1m", maxlen: int = 1500):
        if timeframe not in TIMEFRAME_SECONDS:
            raise ValueError(f"unité de temps inconnue: {timeframe}")
        self.timeframe = timeframe
        self.maxlen = maxlen
        self.candles: list[Candle] = []
        self._lock = threading.RLock()

    # -- mise à jour -----------------------------------------------------
    def add_tick(self, price: Decimal, when, volume: Decimal = ZERO) -> Candle:
        bucket = timeframe_start(when, self.timeframe)
        with self._lock:
            if self.candles and self.candles[-1].start == bucket:
                candle = self.candles[-1]
                candle.high = max(candle.high, price)
                candle.low = min(candle.low, price)
                candle.close = price
                candle.volume += volume
                return candle
            candle = Candle(bucket, price, price, price, price, volume, self.timeframe)
            self.candles.append(candle)
            if len(self.candles) > self.maxlen:
                del self.candles[: len(self.candles) - self.maxlen]
            return candle

    def add_candle(self, candle: Candle) -> None:
        with self._lock:
            if self.candles and candle.start <= self.candles[-1].start:
                return
            self.candles.append(candle)
            if len(self.candles) > self.maxlen:
                del self.candles[: len(self.candles) - self.maxlen]

    def load(self, candles: Iterable[Candle]) -> None:
        with self._lock:
            self.candles = sorted(candles, key=lambda c: to_utc(c.start))[-self.maxlen:]

    # -- lecture ---------------------------------------------------------
    def __len__(self) -> int:
        return len(self.candles)

    def closes(self, count: int | None = None) -> list[Decimal]:
        data = self.candles if count is None else self.candles[-count:]
        return [c.close for c in data]

    def highs(self, count: int | None = None) -> list[Decimal]:
        data = self.candles if count is None else self.candles[-count:]
        return [c.high for c in data]

    def lows(self, count: int | None = None) -> list[Decimal]:
        data = self.candles if count is None else self.candles[-count:]
        return [c.low for c in data]

    def to_list(self, count: int | None = None) -> list[dict[str, Any]]:
        data = self.candles if count is None else self.candles[-count:]
        return [c.to_dict() for c in data]

    @property
    def last(self) -> Candle | None:
        return self.candles[-1] if self.candles else None


class MarketDataStore:
    """Mémoire de marché : dernière cotation + séries par instrument et unité de temps."""

    def __init__(self, symbols: Sequence[str] | None = None, max_candles: int = 1500):
        self.symbols = tuple(symbols or SYMBOLS)
        self.max_candles = max_candles
        self._quotes: dict[str, Quote] = {}
        self._series: dict[tuple[str, str], CandleSeries] = {}
        self._lock = threading.RLock()
        self._sequence = 0
        self.dropped_out_of_order = 0
        for symbol in self.symbols:
            for tf in ("1m", "5m", "15m"):
                self._series[(symbol, tf)] = CandleSeries(tf, max_candles)

    # -- cotations -------------------------------------------------------
    def update_quote(self, quote: Quote) -> Quote | None:
        """Enregistre une cotation et met à jour toutes les châssis de chandelles."""
        with self._lock:
            previous = self._quotes.get(quote.symbol)
            if previous and quote.at < previous.at:
                self.dropped_out_of_order += 1
                return None
            self._sequence += 1
            quote.sequence = self._sequence
            self._quotes[quote.symbol] = quote
            for tf in ("1m", "5m", "15m"):
                self._series[(quote.symbol, tf)].add_tick(quote.last, quote.at)
        return quote

    def reset_quotes(self) -> None:
        """Vide les cotations (bascule simulation → pont : aucune cotation mixte)."""
        with self._lock:
            self._quotes.clear()

    def quote(self, symbol: str) -> Quote | None:
        return self._quotes.get(symbol)

    def quotes(self) -> dict[str, Quote]:
        return dict(self._quotes)

    def series(self, symbol: str, timeframe: str = "1m") -> CandleSeries:
        key = (symbol, timeframe)
        with self._lock:
            if key not in self._series:
                self._series[key] = CandleSeries(timeframe, self.max_candles)
            return self._series[key]

    def all_candles(self) -> dict[tuple[str, str], CandleSeries]:
        return dict(self._series)

    # -- contrôles -------------------------------------------------------
    def check_quote(self, symbol: str, policy, reference=None) -> tuple[bool, list[str]]:
        """Contrôle de fraîcheur et de cohérence (sections 6 et 13.1)."""
        quote = self.quote(symbol)
        issues: list[str] = []
        if quote is None:
            return False, ["QUOTE_MISSING"]
        if quote.bid <= ZERO or quote.ask <= ZERO:
            issues.append("QUOTE_NON_POSITIVE")
        if quote.ask < quote.bid:
            issues.append("QUOTE_CROSSED")
        age = quote.age(reference)
        if age > float(policy.freshness_seconds):
            issues.append(f"QUOTE_STALE_{age:.1f}s")
        if quote.spread_bps > policy.max_spread_bps:
            issues.append(f"SPREAD_TOO_WIDE_{float(quote.spread_bps):.1f}bps")
        spec: SymbolSpec = SYMBOLS[symbol]
        if quote.spread_bps <= ZERO and spec.typical_spread_bps > ZERO:
            issues.append("SPREAD_ZERO_SUSPICIOUS")
        return (not issues), issues

    def snapshot(self, policy, reference=None) -> list[dict[str, Any]]:
        out = []
        for symbol in self.symbols:
            quote = self.quote(symbol)
            if not quote:
                out.append({"symbol": symbol, "available": False})
                continue
            fresh, issues = self.check_quote(symbol, policy, reference)
            item = quote.to_dict()
            item["age_seconds"] = round(quote.age(reference), 3)
            item.update({"available": True, "fresh": fresh, "issues": issues})
            out.append(item)
        return out


# --------------------------------------------------------------------------
# Indicateurs (implémentation propre, sans dépendance)
# --------------------------------------------------------------------------
def sma(values: Sequence[Decimal], period: int) -> Decimal | None:
    if len(values) < period or period <= 0:
        return None
    window = values[-period:]
    return sum(window) / Decimal(period)


def ema_series(values: Sequence[Decimal], period: int) -> list[Decimal]:
    if period <= 0 or len(values) < period:
        return []
    alpha = Decimal(2) / Decimal(period + 1)
    seed = sum(values[:period]) / Decimal(period)
    out = [seed]
    for value in values[period:]:
        out.append(alpha * value + (1 - alpha) * out[-1])
    return out


def ema(values: Sequence[Decimal], period: int) -> Decimal | None:
    series = ema_series(values, period)
    return series[-1] if series else None


def rsi(values: Sequence[Decimal], period: int = 14) -> Decimal | None:
    if len(values) <= period:
        return None
    gains, losses = [], []
    for previous, current in zip(values[-period - 1:-1], values[-period:]):
        delta = current - previous
        gains.append(max(delta, ZERO))
        losses.append(max(-delta, ZERO))
    avg_gain = sum(gains) / Decimal(period)
    avg_loss = sum(losses) / Decimal(period)
    if avg_loss == ZERO:
        return Decimal(100)
    rs = avg_gain / avg_loss
    return Decimal(100) - (Decimal(100) / (Decimal(1) + rs))


def true_ranges(candles: Sequence[Candle]) -> list[Decimal]:
    out: list[Decimal] = []
    for previous, current in zip(candles[:-1], candles[1:]):
        out.append(max(
            current.high - current.low,
            abs(current.high - previous.close),
            abs(current.low - previous.close),
        ))
    return out


def atr(candles: Sequence[Candle], period: int = 14) -> Decimal | None:
    ranges = true_ranges(candles)
    if len(ranges) < period:
        return None
    return sum(ranges[-period:]) / Decimal(period)


def stdev(values: Sequence[Decimal], period: int) -> Decimal | None:
    if len(values) < period:
        return None
    window = values[-period:]
    mean = sum(window) / Decimal(period)
    variance = sum((v - mean) ** 2 for v in window) / Decimal(period)
    return Decimal(str(math.sqrt(float(variance))))


def bollinger(values: Sequence[Decimal], period: int = 20, mult: Decimal = Decimal(2)):
    middle = sma(values, period)
    sd = stdev(values, period)
    if middle is None or sd is None:
        return None
    return {"middle": middle, "upper": middle + mult * sd, "lower": middle - mult * sd,
            "bandwidth": (2 * mult * sd) / middle if middle else ZERO}


def donchian(candles: Sequence[Candle], period: int = 20):
    if len(candles) < period:
        return None
    window = candles[-period:]
    return {"upper": max(c.high for c in window), "lower": min(c.low for c in window)}


def macd(values: Sequence[Decimal], fast: int = 12, slow: int = 26, signal: int = 9):
    if len(values) < slow + signal:
        return None
    fast_series = ema_series(values, fast)
    slow_series = ema_series(values, slow)
    offset = len(fast_series) - len(slow_series)
    line = [f - s for f, s in zip(fast_series[offset:], slow_series)]
    signal_line = ema_series(line, signal)
    if not signal_line:
        return None
    return {"macd": line[-1], "signal": signal_line[-1], "histogram": line[-1] - signal_line[-1]}


def percentile(values: Sequence[Decimal], q: float) -> Decimal | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round(q * (len(ordered) - 1)))))
    return ordered[index]


def indicator_snapshot(series: CandleSeries) -> dict[str, Any]:
    """Instantané d'indicateurs utilisé par les stratégies et l'interface."""
    closes = series.closes()
    candles = series.candles
    if len(closes) < 30:
        return {"ready": False, "samples": len(closes)}
    snapshot: dict[str, Any] = {"ready": True, "samples": len(closes)}
    snapshot["ema_fast"] = ema(closes, 12)
    snapshot["ema_slow"] = ema(closes, 26)
    snapshot["ema_trend"] = ema(closes, 50)
    snapshot["rsi14"] = rsi(closes, 14)
    snapshot["atr14"] = atr(candles, 14)
    snapshot["bollinger"] = bollinger(closes, 20)
    snapshot["donchian"] = donchian(candles, 20)
    snapshot["macd"] = macd(closes)
    high_20 = max((c.high for c in candles[-20:]), default=None)
    low_20 = min((c.low for c in candles[-20:]), default=None)
    if high_20 is not None and low_20 is not None and high_20 > low_20:
        snapshot["range_position"] = (closes[-1] - low_20) / (high_20 - low_20)
    return snapshot


def to_float_map(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Convertit un instantané d'indicateurs en valeurs JSON."""
    def convert(value):
        if isinstance(value, Decimal):
            return float(value)
        if isinstance(value, dict):
            return {k: convert(v) for k, v in value.items()}
        if isinstance(value, list):
            return [convert(v) for v in value]
        return value

    return convert(snapshot)
