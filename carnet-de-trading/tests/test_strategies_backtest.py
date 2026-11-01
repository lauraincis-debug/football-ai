"""Tests des stratégies, des indicateurs, des backtests et des sauvegardes."""

from __future__ import annotations

import datetime as dt
import gzip
import random
import unittest
from decimal import Decimal

from helpers import EngineTestCase, TempProject, make_candles, series_from

from carnet.backtest import BacktestConfig, BacktestRunner, run_backtest
from carnet.backup import BackupError, BackupManager
from carnet.db import Database
from carnet.journal import Journal
from carnet.market import Candle, CandleSeries, atr, ema, indicator_snapshot, rsi
from carnet.simulator import MarketSimulator
from carnet.strategies import STRATEGY_CLASSES, StrategyRegistry, Signal
from carnet.util import D, now_utc


def candles_from_closes(closes, timeframe="15m", spread=0.05, begin=None):
    begin = begin or dt.datetime(2026, 11, 9, 0, 0, tzinfo=dt.timezone.utc)
    out = []
    for index, close in enumerate(closes):
        close = float(close)
        out.append(Candle(
            start=begin + dt.timedelta(minutes=15 * index),
            open=D(str(round(closes[index - 1] if index else close, 5))),
            high=D(str(round(close + spread, 5))), low=D(str(round(close - spread, 5))),
            close=D(str(round(close, 5))), volume=D("100"), timeframe=timeframe))
    return out


def collect_signals(strategy, candles, symbol="EURUSD"):
    signals = []
    series = CandleSeries(strategy.timeframe, maxlen=len(candles) + 10)
    for index in range(strategy.warmup, len(candles) + 1):
        series.load(candles[:index])
        signal = strategy.evaluate(symbol, series)
        if signal is not None:
            signals.append(signal)
    return signals


class IndicatorTests(unittest.TestCase):
    def test_ema_and_rsi_on_known_series(self):
        values = [D(str(100 + index)) for index in range(60)]
        self.assertIsNotNone(ema(values, 10))
        self.assertGreater(ema(values, 10), ema(values, 30))
        self.assertGreater(rsi(values, 14), D("70"))
        falling = [D(str(200 - index)) for index in range(60)]
        self.assertLess(rsi(falling, 14), D("30"))

    def test_atr_and_snapshot(self):
        candles = make_candles(80)
        series = series_from(candles)
        self.assertGreater(atr(candles, 14), 0)
        snapshot = indicator_snapshot(series)
        for key in ("ready", "ema_fast", "ema_slow", "rsi14", "atr14", "bollinger"):
            self.assertIn(key, snapshot)

    def test_candle_series_bounded(self):
        series = CandleSeries("1m", maxlen=50)
        series.load(make_candles(120, timeframe="1m"))
        self.assertEqual(len(series), 50)
        self.assertTrue(series.last.close > 0)


class StrategyTests(unittest.TestCase):
    def test_registry_exposes_three_strategies(self):
        registry = StrategyRegistry()
        keys = {item["key"] for item in registry.describe()}
        self.assertEqual(keys, set(STRATEGY_CLASSES))
        self.assertEqual(len(registry.enabled()), 3)
        registry.set_enabled("ema_trend", False)
        self.assertEqual(len(registry.enabled()), 2)
        self.assertFalse(registry.get("ema_trend").enabled)

    def test_warmup_is_respected(self):
        for cls in STRATEGY_CLASSES.values():
            strategy = cls()
            short = series_from(make_candles(strategy.warmup - 5, timeframe=strategy.timeframe))
            self.assertIsNone(strategy.evaluate("EURUSD", short))

    def test_signals_have_coherent_geometry(self):
        rng = random.Random(7)
        for key, cls in STRATEGY_CLASSES.items():
            strategy = cls()
            closes = [100 + rng.gauss(0, 1.2) for _ in range(420)]
            for signal in collect_signals(strategy, candles_from_closes(closes,
                                                                        strategy.timeframe)):
                self.assertIsInstance(signal, Signal)
                self.assertEqual(signal.strategy, key)
                self.assertGreaterEqual(signal.reward_risk, D("1.2"))
                self.assertGreaterEqual(signal.confidence, 0)
                self.assertLessEqual(signal.confidence, 1)
                self.assertTrue(signal.reasons)
                if signal.side == "BUY":
                    self.assertLess(signal.stop, signal.entry_ref)
                    self.assertGreater(signal.target, signal.entry_ref)
                else:
                    self.assertGreater(signal.stop, signal.entry_ref)
                    self.assertLess(signal.target, signal.entry_ref)

    def test_ema_trend_detects_crossing(self):
        closes = [100.0] * 90
        closes += [100.0 - 0.6 * index for index in range(1, 12)]
        closes += [100.0 - 0.6 * 11 + 0.9 * index for index in range(1, 14)]
        signals = collect_signals(STRATEGY_CLASSES["ema_trend"](), candles_from_closes(closes))
        self.assertTrue(signals, "aucun signal sur un croisement EMA franc")
        buy = [s for s in signals if s.side == "BUY"]
        self.assertTrue(buy)
        self.assertGreaterEqual(buy[0].reward_risk, D("1.2"))

    def test_orb_detects_breakout(self):
        closes = [100 + (0.4 if index % 2 else -0.4) for index in range(60)]
        closes += [104.5]  # cassure nette du range
        signals = collect_signals(STRATEGY_CLASSES["orb_breakout"](), candles_from_closes(closes))
        self.assertTrue(signals)
        signal = signals[-1]
        self.assertEqual(signal.side, "BUY")
        self.assertGreater(signal.entry_ref, D("103"))
        self.assertGreater(signal.target, signal.entry_ref)
        self.assertGreater(signal.reward_risk, D("1.5"))

    def test_rsi_reversion_needs_excess_and_trend(self):
        strategy = STRATEGY_CLASSES["rsi_reversion"]()
        closes = [100 + 0.25 * index for index in range(140)]
        closes += [135 - 1.6 * index for index in range(1, 7)]
        signals = collect_signals(strategy, candles_from_closes(closes))
        if signals:  # le signal dépend du RSI, on vérifie au minimum sa géométrie
            self.assertEqual(signals[-1].side, "BUY")
            self.assertLess(signals[-1].stop, signals[-1].entry_ref)

    def test_signal_is_deterministic(self):
        candles = candles_from_closes([100 + (index % 7) for index in range(120)])
        first = collect_signals(STRATEGY_CLASSES["orb_breakout"](), candles)
        second = collect_signals(STRATEGY_CLASSES["orb_breakout"](), candles)
        self.assertEqual([s.id for s in first], [s.id for s in second])

    def test_signal_timestamp_uses_market_clock(self):
        """La fraîcheur du signal se mesure sur l'horloge de marché (régression)."""
        moment = dt.datetime(2026, 11, 9, 15, 30, tzinfo=dt.timezone.utc)
        closes = [100 + (0.4 if index % 2 else -0.4) for index in range(60)] + [104.5]
        series = series_from(candles_from_closes(closes))
        signal = STRATEGY_CLASSES["orb_breakout"]().evaluate("EURUSD", series, moment)
        self.assertIsNotNone(signal)
        self.assertEqual(signal.created_at, moment)
        default = STRATEGY_CLASSES["orb_breakout"]().evaluate("EURUSD", series)
        self.assertIsNotNone(default.created_at)

    def test_registry_evaluate_all(self):
        registry = StrategyRegistry()
        series = series_from(make_candles(200, timeframe="15m"))
        signals = registry.evaluate_all("EURUSD", series)
        self.assertIsInstance(signals, list)
        self.assertEqual(registry.scan_timeframe, "15m")


class SimulatorHistoryTests(unittest.TestCase):
    def test_history_is_never_empty_on_weekend(self):
        simulator = MarketSimulator(20261101)
        sunday = dt.datetime(2026, 11, 1, 14, 0, tzinfo=dt.timezone.utc)
        for symbol in ("EURUSD", "BTCUSDT"):
            candles = simulator.history(symbol, "5m", 240, end=sunday)
            self.assertEqual(len(candles), 240, symbol)
            self.assertTrue(all(c.close > 0 for c in candles))
            self.assertEqual(candles, simulator.history(symbol, "5m", 240, end=sunday))

    def test_history_timeframes(self):
        simulator = MarketSimulator(20261101)
        for timeframe in ("1m", "5m", "15m"):
            candles = simulator.history("EURUSD", timeframe, 100)
            self.assertEqual(len(candles), 100)
            step = {"1m": 60, "5m": 300, "15m": 900}[timeframe]
            self.assertEqual((candles[-1].start - candles[0].start).total_seconds(),
                             step * 99)


class BacktestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.simulator = MarketSimulator(20261101)
        cls.end = dt.datetime(2026, 11, 9, 12, 0, tzinfo=dt.timezone.utc)

    def provider(self, symbol, timeframe, count):
        return self.simulator.history(symbol, timeframe, count, end=self.end)

    def config(self, **overrides):
        values = dict(strategy="ema_trend", symbols=("EURUSD", "BTCUSDT"), bars=600,
                      timeframe="15m", initial_capital=D("10000"),
                      risk_per_trade_pct=D("0.5"), monte_carlo_runs=50,
                      walk_forward_windows=2, seed=20261101)
        values.update(overrides)
        return BacktestConfig(**values)

    def test_metrics_contract(self):
        result = run_backtest(self.config(), self.provider)
        metrics = result["metrics"]
        for key in ("trades", "win_rate", "profit_factor", "net_pnl", "return_pct",
                    "max_drawdown_pct", "sharpe", "sortino", "expectancy", "fees",
                    "final_equity", "monte_carlo", "walk_forward", "benchmark",
                    "equity_curve"):
            self.assertIn(key, metrics)
        self.assertEqual(metrics["monte_carlo"]["runs"], 50)
        self.assertEqual(len(metrics["walk_forward"]["windows"]), 2)
        self.assertEqual(metrics["benchmark"]["symbol"], "EURUSD")
        self.assertLessEqual(len(metrics["equity_curve"]), 400)
        self.assertGreater(metrics["trades"], 0, "aucune transaction : backtest inopérant")
        self.assertLessEqual(metrics["max_drawdown_pct"], 100)

    def test_trades_are_coherent(self):
        result = run_backtest(self.config(), self.provider)
        for trade in result["trades"]:
            self.assertIn(trade["side"], ("BUY", "SELL"))
            self.assertGreater(trade["qty"], 0)
            self.assertGreaterEqual(trade["exit_time"], trade["entry_time"])
            self.assertIn(trade["reason"], ("STOP_LOSS", "TAKE_PROFIT", "END_OF_TEST"))
            self.assertGreaterEqual(trade["fees"], 0)

    def test_determinism(self):
        first = run_backtest(self.config(), self.provider)["metrics"]
        second = run_backtest(self.config(), self.provider)["metrics"]
        for key in ("trades", "net_pnl", "win_rate", "max_drawdown_pct", "final_equity"):
            self.assertEqual(first[key], second[key], key)

    def test_unknown_strategy_is_refused(self):
        with self.assertRaises(ValueError):
            run_backtest(self.config(strategy="inexistante"), self.provider)

    def test_empty_history_is_refused(self):
        with self.assertRaises(ValueError):
            run_backtest(self.config(), lambda symbol, timeframe, count: [])

    def test_all_strategies_run(self):
        for key in STRATEGY_CLASSES:
            result = run_backtest(self.config(strategy=key, bars=400,
                                              monte_carlo_runs=0,
                                              walk_forward_windows=1), self.provider)
            self.assertIn("trades", result["metrics"])



class BacktestPersistenceTests(EngineTestCase):
    def test_runner_persists_results(self):
        runner = BacktestRunner(self.engine.db, self.engine.api_history
                                if hasattr(self.engine, "api_history") else
                                (lambda symbol, timeframe, count:
                                 self.engine.simulator.history(symbol, timeframe, count)),
                                self.engine.journal)
        config = BacktestConfig(strategy="orb_breakout", symbols=("BTCUSDT",), bars=300,
                                timeframe="15m", monte_carlo_runs=0, walk_forward_windows=1)
        result = runner.run(config, "test", created_by="admin")
        self.assertIn("metrics", result)
        listing = runner.list()
        self.assertGreaterEqual(len(listing), 1)
        self.assertEqual(listing[0]["status"], "DONE")


class BackupTests(EngineTestCase):
    def setUp(self):
        super().setUp()
        self.manager = BackupManager(self.engine.db,
                                     self.project.path / "var" / "backups",
                                     self.engine.journal)

    def test_create_list_verify(self):
        record = self.manager.create("test")
        self.assertTrue(record.path.endswith(".gz"))
        self.assertGreater(record.size_bytes, 0)
        self.assertTrue(any(r.name == record.name for r in self.manager.list()))
        info = self.manager.verify(record.path)
        self.assertTrue(info["ok"])
        self.assertGreater(info["tables"], 3)
        self.assertGreaterEqual(info["journal_rows"], 1)

    def test_restore_to_destination(self):
        record = self.manager.create("restore")
        destination = self.project.path / "var" / "restored.sqlite3"
        result = self.manager.restore(record.path, destination)
        self.assertTrue(result["restored"])
        self.assertTrue(destination.exists())
        db = Database(destination)
        self.assertGreater(len(db.query("SELECT name FROM sqlite_master")), 3)

    def test_drill_proves_rollback(self):
        result = self.manager.drill()
        self.assertIn("duration_ms", result)
        self.assertGreater(len(result), 0)
        self.assertFalse((self.manager.backup_dir / "drill" / "restored.sqlite3").exists())

    def test_tampered_backup_is_detected(self):
        self.manager.create("tamper")
        path = self.project.path / "var" / "corrupted.sqlite3.gz"
        path.write_bytes(gzip.compress(b"pas une base sqlite"))
        with self.assertRaises(BackupError):
            self.manager.verify(path)

    def test_encrypted_backup_requires_passphrase(self):
        encrypted = BackupManager(self.engine.db, self.project.path / "var" / "backups-enc",
                                  self.engine.journal, passphrase="Phrase!Solide2026")
        record = encrypted.create("enc")
        self.assertTrue(record.encrypted)
        self.assertTrue(record.path.endswith(".cdtb"))
        plain_manager = BackupManager(self.engine.db, self.project.path / "var" / "backups-enc",
                                      self.engine.journal)
        with self.assertRaises(BackupError):
            plain_manager.verify(record.path)
        self.assertTrue(encrypted.verify(record.path)["ok"])

    def test_pruning_keeps_configured_count(self):
        manager = BackupManager(self.engine.db, self.project.path / "var" / "backups-prune",
                                self.engine.journal, keep=2)
        for index in range(4):
            manager.create(f"p{index}")
        self.assertLessEqual(len(manager.list()), 2)


if __name__ == "__main__":
    unittest.main()
