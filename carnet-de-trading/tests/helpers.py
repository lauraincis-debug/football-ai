"""Outils partagés par les tests (aucune dépendance externe).

Chaque test construit une plateforme complète dans un répertoire temporaire :
base SQLite isolée, marché simulé déterministe, connecteur de simulation.
Aucun ordre réel n'est possible : le connecteur refuse tout environnement autre
que SIMULATION.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import json
import os
import shutil
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from dataclasses import replace
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from carnet.config import Settings, default_settings, SYMBOLS  # noqa: E402
from carnet.engine import TradingEngine  # noqa: E402
from carnet.market import Candle, CandleSeries, Quote  # noqa: E402
from carnet.util import D, iso, now_utc  # noqa: E402

TEST_PASSWORD = "Test!Password2026"
ADMIN_PASSWORD = "Admin!Password2026"


class TempProject:
    """Répertoire de travail jetable."""

    def __init__(self) -> None:
        self.path = Path(tempfile.mkdtemp(prefix="carnet-test-"))

    def cleanup(self) -> None:
        shutil.rmtree(self.path, ignore_errors=True)

    def settings(self, **overrides) -> Settings:
        base = default_settings(self.path)
        values = {
            "data_dir": self.path / "data",
            "var_dir": self.path / "var",
            "backup_dir": self.path / "var" / "backups",
            "web_dir": ROOT / "web",
            "db_path": self.path / "data" / "carnet.sqlite3",
            "port": 0,
            "host": "127.0.0.1",
            "environment": "SIMULATION",
            "initial_capital": D("10000"),
            "engine_tick_seconds": 0.05,
            "seed": 20261101,
            "simulation_speed": 1.0,
            "allow_real_trading": False,
            "session_ttl_minutes": 60,
        }
        values.update(overrides)
        settings = Settings(**{**base.__dict__, **values})
        settings.ensure_dirs()
        return settings


class EngineTestCase(unittest.TestCase):
    """Base de test : plateforme complète prête à l'emploi."""

    settings_overrides: dict = {}

    def setUp(self) -> None:
        self.project = TempProject()
        self.addCleanup(self.project.cleanup)
        os.environ.setdefault("CARNET_ADMIN_PASSWORD", ADMIN_PASSWORD)
        self.engine = self.make_engine()
        self.engine.bootstrap()

    def make_engine(self, **overrides) -> TradingEngine:
        options = {**self.settings_overrides, **overrides}
        settings = self.project.settings(**options)
        engine = TradingEngine(settings)
        self.addCleanup(_safe_shutdown, engine)
        return engine

    # -- helpers ---------------------------------------------------------
    @staticmethod
    def quote(symbol: str, mid: float, spread_bps: float = 1.0, age_seconds: float = 0.0) -> Quote:
        mid_decimal = D(str(mid))
        half = mid_decimal * D(str(spread_bps)) / Decimal(20000)
        return Quote(
            symbol=symbol, bid=mid_decimal - half, ask=mid_decimal + half, last=mid_decimal,
            timestamp=now_utc() - dt.timedelta(seconds=age_seconds),
            received_at=now_utc() - dt.timedelta(seconds=age_seconds),
            source="test",
        )

    def push_quote(self, symbol: str, mid: float, spread_bps: float = 1.0,
                   age_seconds: float = 0.0) -> Quote:
        quote = self.quote(symbol, mid, spread_bps, age_seconds)
        self.engine.market.update_quote(quote)
        self.engine.connector.pump({symbol: quote})
        return quote

    def run_cycles(self, count: int = 1, step_seconds: int = 300, force_scan: bool = True):
        base = self.engine.sim_now()
        results = []
        for index in range(count):
            results.append(self.engine.run_once(
                now=base + dt.timedelta(seconds=step_seconds * (index + 1)),
                force_scan=force_scan))
        return results

    def login(self, username: str = "admin", password: str | None = None) -> str:
        user = self.engine.users.authenticate(username, password or ADMIN_PASSWORD)
        token, _ = self.engine.sessions.create(user, ip="127.0.0.1")
        return token


def _safe_shutdown(engine: TradingEngine) -> None:
    with contextlib.suppress(Exception):
        engine.shutdown()


class ApiTestCase(EngineTestCase):
    """Démarre l'API HTTP sur un port éphémère."""

    def setUp(self) -> None:
        super().setUp()
        from carnet.api import ApiServer

        self.engine.start(background=True)
        self.api = ApiServer(self.engine, host="127.0.0.1", port=0, web_dir=ROOT / "web")
        self.httpd = self.api.build()
        self.api.start_background()
        self.addCleanup(self.api.stop)
        self.port = self.httpd.server_address[1]

    def request(self, method: str, path: str, body=None, token: str | None = None,
                timeout: float = 20.0):
        url = f"http://127.0.0.1:{self.port}{path}"
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(url, data=data, method=method)
        request.add_header("Accept", "application/json")
        if data:
            request.add_header("Content-Type", "application/json")
        if token:
            request.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status, json.loads(response.read().decode() or "{}")
        except urllib.error.HTTPError as error:
            payload = error.read().decode()
            try:
                decoded = json.loads(payload or "{}")
            except json.JSONDecodeError:
                decoded = {"error": payload}
            return error.code, decoded

    def get(self, path: str, token: str | None = None):
        return self.request("GET", path, token=token)

    def post(self, path: str, body=None, token: str | None = None):
        return self.request("POST", path, body or {}, token=token)


def make_candles(count: int, start: float = 100.0, step: float = 0.1,
                 timeframe: str = "5m", begin=None) -> list[Candle]:
    """Série de bougies haussière régulière, utile aux tests d'indicateurs."""
    moment = begin or (now_utc() - dt.timedelta(minutes=5 * count))
    candles = []
    price = start
    for index in range(count):
        close = start + step * index
        candles.append(Candle(
            start=moment + dt.timedelta(minutes=5 * index),
            open=D(str(price)), high=D(str(max(price, close) + 0.05)),
            low=D(str(min(price, close) - 0.05)), close=D(str(close)),
            volume=D("100"), timeframe=timeframe))
        price = close
    return candles


def series_from(candles: list[Candle], timeframe: str = "5m") -> CandleSeries:
    series = CandleSeries(timeframe)
    series.load(candles)
    return series
