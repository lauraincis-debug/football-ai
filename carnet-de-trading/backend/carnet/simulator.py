"""Marché simulé déterministe (aucune donnée réelle, aucun ordre réel).

Le générateur alimente toute la plateforme en environnement SIMULATION :
- marche aléatoire géométrique calibrée par volatilité annuelle ;
- spreads réalistes par instrument, micro-bruit de cotation ;
- calendrier Forex (fermeture du vendredi 21h UTC au dimanche 22h UTC),
  crypto 24/7 ;
- historique synthétique reproductible (même graine ⇒ même série), utilisé
  pour le préchauffage des indicateurs et le backtesting ;
- injection de pannes contrôlée, réservée aux tests.
"""

from __future__ import annotations

import datetime as dt
import math
import random
import threading
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Iterable

from .config import (
    MARKET_CRYPTO,
    SIMULATION_ANNUAL_VOL,
    SIMULATION_REFERENCE_PRICES,
    SYMBOLS,
    SymbolSpec,
)
from .market import Candle, Quote, timeframe_start
from .util import D, ZERO, new_york_tz, now_utc, to_utc

SECONDS_PER_YEAR = 365 * 24 * 3600


class SimulationClock:
    """Horloge accélérée de la simulation.

    En production (démo ou réel), la vitesse vaut 1 : le temps est le temps.
    En simulation, une vitesse de 60 fait avancer le marché simulé d'une minute
    par seconde réelle, ce qui rend la démonstration observable sans jamais
    présenter une donnée fictive comme réelle. La vitesse est affichée dans
    l'interface et journalisée au démarrage.
    """

    def __init__(self, speed: float = 1.0, base=None):
        self.speed = max(0.0, float(speed))
        self._base_real = time.time()
        self._base_sim = to_utc(base) or now_utc()

    def now(self, real_time: float | None = None):
        real = real_time if real_time is not None else time.time()
        return self._base_sim + dt.timedelta(seconds=(real - self._base_real) * self.speed)

    def reset(self, speed: float | None = None, base=None) -> None:
        if speed is not None:
            self.speed = max(0.0, float(speed))
        self._base_real = time.time()
        self._base_sim = to_utc(base) or now_utc()


def is_market_open(symbol: str, when) -> bool:
    """Calendrier simplifié mais explicite (section 13.2)."""
    spec: SymbolSpec = SYMBOLS[symbol]
    moment = to_utc(when)
    if spec.market == MARKET_CRYPTO:
        return True
    local = moment.astimezone(new_york_tz())
    weekday = local.weekday()  # 0 = lundi
    if weekday == 5:  # samedi
        return False
    if weekday == 4 and local.hour >= 17:  # vendredi soir New York
        return False
    if weekday == 6 and local.hour < 17:  # dimanche avant 17h New York
        return False
    return True


@dataclass
class FaultInjection:
    """Pannes contrôlées utilisées par les tests et la démonstration."""

    missing_quote: bool = False
    stale_seconds: float = 0.0
    wide_spread_bps: Decimal | None = None
    spike_pct: Decimal | None = None
    halt: bool = False
    reject_next_order: bool = False
    timeout_next_order: bool = False
    partial_fill_ratio: Decimal | None = None
    disconnect: bool = False


class MarketSimulator:
    def __init__(self, seed: int = 20261101, symbols: Iterable[str] | None = None):
        self.seed = seed
        self.symbols = tuple(symbols or SYMBOLS)
        self._lock = threading.RLock()
        self._rng = {s: random.Random(f"{seed}:{s}") for s in self.symbols}
        self._prices: dict[str, Decimal] = dict(SIMULATION_REFERENCE_PRICES)
        self._last_tick: dict[str, dt.datetime] = {}
        self.faults: dict[str, FaultInjection] = {s: FaultInjection() for s in self.symbols}
        self._drift_bias: dict[str, Decimal] = {s: ZERO for s in self.symbols}

    # -- helpers ---------------------------------------------------------
    def price(self, symbol: str) -> Decimal:
        return self._prices[symbol]

    def set_price(self, symbol: str, value: Decimal | str) -> None:
        self._prices[symbol] = D(value)

    def inject(self, symbol: str, **kwargs: Any) -> None:
        fault = self.faults[symbol]
        for key, value in kwargs.items():
            if not hasattr(fault, key):
                raise ValueError(f"panne inconnue: {key}")
            setattr(fault, key, value)

    def clear_faults(self, symbol: str | None = None) -> None:
        targets = [symbol] if symbol else list(self.symbols)
        for target in targets:
            self.faults[target] = FaultInjection()

    def bias(self, symbol: str, drift: Decimal | str) -> None:
        """Biais directionnel de test (par seconde, en fraction du prix)."""
        self._drift_bias[symbol] = D(drift)

    # -- génération live -------------------------------------------------
    def tick(self, symbol: str, when=None, force: bool = False) -> Quote | None:
        moment = to_utc(when) or now_utc()
        spec = SYMBOLS[symbol]
        fault = self.faults[symbol]
        with self._lock:
            if fault.missing_quote or fault.halt or fault.disconnect:
                return None
            if not force and not is_market_open(symbol, moment):
                return None
            last = self._last_tick.get(symbol)
            if last is None:
                elapsed = 1.0
            else:
                elapsed = max(0.0, (moment - last).total_seconds())
            if elapsed <= 0:
                elapsed = 1.0
            if elapsed > 120:
                elapsed = 120.0
            self._last_tick[symbol] = moment

            price = self._prices[symbol]
            annual_vol = SIMULATION_ANNUAL_VOL.get(symbol, 0.12)
            sigma = annual_vol / math.sqrt(SECONDS_PER_YEAR) * math.sqrt(elapsed)
            rng = self._rng[symbol]
            shock = rng.gauss(0.0, 1.0) * sigma
            drift = float(self._drift_bias[symbol]) * elapsed
            new_price = float(price) * math.exp(drift + shock)
            # Bruit de microstructure (arrondi au tick).
            tick_size = float(spec.tick_size)
            new_price = round(new_price / tick_size) * tick_size
            if new_price <= 0:
                new_price = float(price)
            new_price_dec = Decimal(str(new_price)).quantize(spec.tick_size)
            self._prices[symbol] = new_price_dec

            spread_bps = spec.typical_spread_bps * D(str(1 + abs(rng.gauss(0, 0.25))))
            if fault.wide_spread_bps is not None:
                spread_bps = fault.wide_spread_bps
            half = new_price_dec * spread_bps / Decimal(20000)
            bid = (new_price_dec - half).quantize(spec.tick_size)
            ask = (new_price_dec + half).quantize(spec.tick_size)
            if ask <= bid:
                ask = bid + spec.tick_size
            if fault.spike_pct is not None:
                mult = Decimal(1) + fault.spike_pct / Decimal(100)
                bid = (bid * mult).quantize(spec.tick_size)
                ask = (ask * mult).quantize(spec.tick_size)
                new_price_dec = (new_price_dec * mult).quantize(spec.tick_size)
            stamp = moment
            if fault.stale_seconds:
                stamp = moment - dt.timedelta(seconds=fault.stale_seconds)
            return Quote(
                symbol=symbol, bid=bid, ask=ask, last=new_price_dec,
                timestamp=stamp, source="simulation",
                volume=Decimal(str(round(abs(rng.gauss(1000, 250)), 2))),
            )

    def tick_all(self, when=None) -> list[Quote]:
        out = []
        for symbol in self.symbols:
            quote = self.tick(symbol, when)
            if quote:
                out.append(quote)
        return out

    # -- historique synthétique -----------------------------------------
    def history(self, symbol: str, timeframe: str = "5m", count: int = 400,
                end=None, seed: int | None = None) -> list[Candle]:
        """Série OHLC reproductible, cohérente avec le prix courant."""
        seconds = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600}[timeframe]
        end_moment = timeframe_start(end or now_utc(), timeframe)
        rng = random.Random(f"{seed if seed is not None else self.seed}:{symbol}:{timeframe}:{count}")
        spec = SYMBOLS[symbol]
        annual_vol = SIMULATION_ANNUAL_VOL.get(symbol, 0.12)
        step_sigma = annual_vol / math.sqrt(SECONDS_PER_YEAR) * math.sqrt(seconds)
        price = float(SIMULATION_REFERENCE_PRICES[symbol])
        candles: list[Candle] = []
        start = end_moment - dt.timedelta(seconds=seconds * count)
        # On converge vers le prix courant pour rester cohérent avec le live.
        target = float(self._prices.get(symbol, SIMULATION_REFERENCE_PRICES[symbol]))
        for index in range(count):
            moment = start + dt.timedelta(seconds=seconds * index)
            # L'historique est continu : le filtre de séance ne s'applique qu'aux
            # cotations live (sinon aucune donnée un week-end, et l'app serait vide).
            open_price = price
            drift = (target / price - 1) / max(1, count - index) if price > 0 else 0
            moves = [rng.gauss(drift, step_sigma) for _ in range(6)]
            high = open_price
            low = open_price
            for move in moves:
                price *= (1 + move)
                high = max(high, price)
                low = min(low, price)
            close_price = price
            # Mèches réalistes.
            high *= 1 + abs(rng.gauss(0, step_sigma * 0.35))
            low *= 1 - abs(rng.gauss(0, step_sigma * 0.35))
            tick = float(spec.tick_size)
            quant = Decimal(str(tick))
            candles.append(Candle(
                start=moment,
                open=Decimal(str(round(open_price / tick) * tick)).quantize(quant),
                high=Decimal(str(round(high / tick) * tick)).quantize(quant),
                low=Decimal(str(round(low / tick) * tick)).quantize(quant),
                close=Decimal(str(round(close_price / tick) * tick)).quantize(quant),
                volume=Decimal(str(round(abs(rng.gauss(1200, 400)), 2))),
                timeframe=timeframe,
            ))
        return candles

    def warmup(self, store, timeframes: Iterable[str] = ("1m", "5m", "15m"),
               count: int = 220) -> None:
        """Préchauffe les séries internes avec un historique synthétique."""
        for symbol in self.symbols:
            for timeframe in timeframes:
                candles = self.history(symbol, timeframe, count)
                series = store.series(symbol, timeframe)
                series.load(candles)
                if candles:
                    store.set_reference_price(symbol, candles[-1].close) if hasattr(
                        store, "set_reference_price") else None
