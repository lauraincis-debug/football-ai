"""Tests des fondations : utilitaires, base, journal, sécurité, politique, verrous."""

from __future__ import annotations

import datetime as dt
import json
import unittest
from decimal import Decimal
from pathlib import Path

from helpers import EngineTestCase, TempProject, make_candles, series_from

from carnet.config import DEFAULT_POLICY, RiskPolicy, SYMBOLS
from carnet.db import Database
from carnet.guards import VALIDATIONS
from carnet.journal import AuditLog, Journal, Notifications
from carnet.market import (
    CandleSeries,
    Quote,
    MarketDataStore,
    atr,
    bollinger,
    donchian,
    ema,
    indicator_snapshot,
    macd,
    rsi,
    sma,
    stdev,
    timeframe_start,
)
from carnet.policy import PolicyStore
from carnet.security import (
    AuthError,
    OwnerGate,
    RateLimiter,
    SessionStore,
    UserStore,
    generate_totp_secret,
    hash_password,
    password_strength,
    totp_now,
    verify_password,
    verify_totp,
)
from carnet.simulator import MarketSimulator, SimulationClock, is_market_open
from carnet.util import (
    D,
    age_seconds,
    canonical_json,
    iso,
    new_uuid,
    now_utc,
    quantize,
    redact,
    scrub_mapping,
    sha256_hex,
    trading_day,
    trading_week,
)


class UtilTests(unittest.TestCase):
    def test_decimal_conversion_and_quantize(self):
        self.assertEqual(D("1.50"), Decimal("1.50"))
        self.assertEqual(D(0.1), Decimal("0.1"))
        self.assertEqual(quantize("0.1666", "0.01"), Decimal("0.16"))
        self.assertEqual(quantize("1.234567", "0.00001"), Decimal("1.23456"))

    def test_decimal_rejects_invalid(self):
        with self.assertRaises(Exception):
            D("abc")
        with self.assertRaises(Exception):
            D(None)
        with self.assertRaises(Exception):
            D(float("nan"))

    def test_iso_roundtrip(self):
        moment = now_utc()
        self.assertTrue(iso(moment).endswith("Z"))
        self.assertLessEqual(abs((now_utc() - moment).total_seconds()), 5)

    def test_age_seconds(self):
        moment = now_utc() - dt.timedelta(seconds=4)
        self.assertGreaterEqual(age_seconds(moment), 3.9)
        self.assertEqual(age_seconds(None), float("inf"))

    def test_trading_day_rolls_at_17_new_york(self):
        # 2026-11-02 21:30 UTC = 16:30 New York → journée du 1er
        before = dt.datetime(2026, 11, 2, 21, 30, tzinfo=dt.timezone.utc)
        after = dt.datetime(2026, 11, 2, 22, 30, tzinfo=dt.timezone.utc)  # 17:30 NY
        self.assertEqual(trading_day(before).isoformat(), "2026-11-01")
        self.assertEqual(trading_day(after).isoformat(), "2026-11-02")

    def test_trading_week_changes_with_reset(self):
        sunday = dt.datetime(2026, 11, 8, 23, 0, tzinfo=dt.timezone.utc)
        monday = dt.datetime(2026, 11, 9, 23, 0, tzinfo=dt.timezone.utc)
        self.assertEqual(trading_week(sunday), (2026, 45))
        self.assertEqual(trading_week(monday), (2026, 46))

    def test_redaction_masks_secrets(self):
        text = redact("api_key=abcdef123456 token: supersecretvalue")
        self.assertNotIn("abcdef123456", text)
        self.assertNotIn("supersecretvalue", text)

    def test_scrub_mapping(self):
        cleaned = scrub_mapping({"password": "x", "nested": {"api_secret": "y"}, "ok": 1})
        self.assertEqual(cleaned["password"], "***")
        self.assertEqual(cleaned["nested"]["api_secret"], "***")
        self.assertEqual(cleaned["ok"], 1)

    def test_canonical_json_is_stable(self):
        self.assertEqual(canonical_json({"b": 1, "a": 2}), '{"a":2,"b":1}')
        self.assertEqual(len(sha256_hex("x")), 64)
        self.assertNotEqual(new_uuid(), new_uuid())


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.project = TempProject()
        self.addCleanup(self.project.cleanup)
        self.db = Database(self.project.path / "data" / "test.sqlite3")
        self.db.migrate()

    def test_schema_and_wal(self):
        self.assertEqual(self.db.scalar("PRAGMA journal_mode"), "wal")
        self.assertEqual(self.db.integrity_check(), "ok")
        self.assertEqual(self.db.schema_version(), 1)

    def test_crud_and_transaction_rollback(self):
        self.db.execute("INSERT INTO settings_kv(key, value, updated_at) VALUES('k','v',?)",
                        (iso(now_utc()),))
        self.assertEqual(self.db.scalar("SELECT value FROM settings_kv WHERE key='k'"), "v")
        with self.assertRaises(RuntimeError):
            with self.db.transaction() as connection:
                connection.execute("INSERT INTO settings_kv(key, value, updated_at) VALUES('k2','v2','x')")
                raise RuntimeError("rollback")
        self.assertIsNone(self.db.scalar("SELECT value FROM settings_kv WHERE key='k2'"))

    def test_backup_is_consistent(self):
        self.db.execute("INSERT INTO settings_kv(key, value, updated_at) VALUES('a','b',?)",
                        (iso(now_utc()),))
        target = self.project.path / "backup.sqlite3"
        self.db.backup_to(target)
        copy = Database(target)
        self.assertEqual(copy.scalar("SELECT value FROM settings_kv WHERE key='a'"), "b")
        self.assertEqual(copy.integrity_check(), "ok")

    def test_stats(self):
        stats = self.db.stats()
        self.assertTrue(stats["path"].endswith(".sqlite3"))
        self.assertEqual(stats["schema_version"], 1)


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.project = TempProject()
        self.addCleanup(self.project.cleanup)
        self.db = Database(self.project.path / "j.sqlite3")
        self.db.migrate()
        self.journal = Journal(self.db)

    def test_chain_is_valid_and_detects_tampering(self):
        self.journal.info("test", "START", "démarrage")
        self.journal.warning("test", "WARN", "avertissement", payload={"token": "abc123456"})
        self.journal.error("test", "ERR", "erreur")
        result = self.journal.verify_chain()
        self.assertTrue(result["ok"])
        self.assertEqual(result["checked"], 3)
        # Altération manuelle d'une ligne : la chaîne doit casser.
        self.db.execute("UPDATE journal SET message='modifié' WHERE seq=2")
        broken = self.journal.verify_chain()
        self.assertFalse(broken["ok"])
        self.assertEqual(broken["broken_at"], 2)

    def test_secret_is_not_stored_in_clear(self):
        self.journal.warning("security", "LOGIN", "api_key=abcdef123456")
        rows = self.journal.tail(5)
        self.assertNotIn("abcdef123456", rows[0]["message"])

    def test_levels_and_filters(self):
        self.journal.debug("m", "D", "debug")
        self.journal.info("m", "I", "info")
        self.journal.critical("m", "C", "critique")
        self.assertEqual(len(self.journal.tail(10, level="WARNING")), 1)
        stats = self.journal.stats()
        self.assertEqual(stats["total"], 3)
        self.assertEqual(stats["by_level"]["CRITICAL"], 1)

    def test_audit_chain(self):
        audit = AuditLog(self.db)
        audit.record("admin", "test.action", {"a": 1})
        audit.record("admin", "test.action2", {"b": 2})
        self.assertTrue(audit.verify())
        self.assertEqual(len(audit.tail()), 2)
        self.db.execute("UPDATE audits SET action='pirate' WHERE id=1")
        self.assertFalse(audit.verify())

    def test_notifications(self):
        notifications = Notifications(self.db, self.journal)
        notifications.push("CRITICAL", "TEST", "Titre", "Message")
        self.assertEqual(notifications.unread_count(), 1)
        self.assertEqual(len(notifications.tail()), 1)
        self.assertEqual(notifications.mark_read(), 1)
        self.assertEqual(notifications.unread_count(), 0)


class SecurityTests(unittest.TestCase):
    def test_password_hash_and_verify(self):
        digest, salt = hash_password("CorrectHorse2026!")
        self.assertTrue(verify_password("CorrectHorse2026!", digest, salt))
        self.assertFalse(verify_password("wrong", digest, salt))
        with self.assertRaises(ValueError):
            hash_password("short")

    def test_password_strength(self):
        self.assertTrue(password_strength("Abcdefgh123!xyz")["ok"])
        self.assertFalse(password_strength("abc")["ok"])

    def test_totp(self):
        secret = generate_totp_secret()
        code = totp_now(secret)
        self.assertTrue(verify_totp(secret, code))
        self.assertFalse(verify_totp(secret, "000000" if code != "000000" else "111111"))
        self.assertTrue(verify_totp(secret, totp_now(secret, at=1000000.0), at=1000000.0))
        self.assertFalse(verify_totp(None, code))
        self.assertFalse(verify_totp(secret, "abc"))

    def test_rate_limiter(self):
        limiter = RateLimiter(limit=2, window_seconds=60)
        self.assertTrue(limiter.allow("ip"))
        self.assertTrue(limiter.allow("ip"))
        self.assertFalse(limiter.allow("ip"))
        limiter.reset("ip")
        self.assertTrue(limiter.allow("ip"))

    def test_users_and_sessions(self):
        project = TempProject()
        self.addCleanup(project.cleanup)
        db = Database(project.path / "u.sqlite3")
        db.migrate()
        users = UserStore(db)
        admin = users.create("admin", "Admin!Passw0rd2026", "ADMIN")
        self.assertTrue(admin.allows("policy:write"))
        session_store = SessionStore(db, users, ttl_minutes=5)
        with self.assertRaises(AuthError):
            users.authenticate("admin", "mauvais")
        token, session = session_store.create(admin)
        self.assertEqual(session_store.resolve(token).user.username, "admin")
        session_store.revoke(token=token)
        self.assertIsNone(session_store.resolve(token))
        self.assertFalse(users.get("admin").allows("inconnue"))

    def test_account_locks_after_failures(self):
        project = TempProject()
        self.addCleanup(project.cleanup)
        db = Database(project.path / "l.sqlite3")
        db.migrate()
        users = UserStore(db)
        users.create("bob", "Bob!Passw0rd2026", "VIEWER")
        for _ in range(5):
            with self.assertRaises(AuthError):
                users.authenticate("bob", "faux")
        with self.assertRaises(AuthError) as context:
            users.authenticate("bob", "Bob!Passw0rd2026")
        self.assertEqual(context.exception.code, "ACCOUNT_LOCKED")

    def test_owner_gate(self):
        project = TempProject()
        self.addCleanup(project.cleanup)
        project.path.joinpath("var").mkdir(exist_ok=True)
        gate = OwnerGate(project.path / "var", environment_token=None)
        self.assertFalse(gate.configured())
        with self.assertRaises(AuthError):
            gate.verify("x")
        path = project.path / "var" / "owner_token"
        path.write_text("secret-token")
        gate = OwnerGate(project.path / "var", environment_token=None)
        self.assertTrue(gate.configured())
        gate.verify("secret-token", OwnerGate.PHRASE)
        with self.assertRaises(AuthError):
            gate.verify("mauvais", OwnerGate.PHRASE)
        with self.assertRaises(AuthError):
            gate.verify("secret-token", "phrase fausse")


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.project = TempProject()
        self.addCleanup(self.project.cleanup)
        self.db = Database(self.project.path / "p.sqlite3")
        self.db.migrate()
        self.journal = Journal(self.db)
        self.audit = AuditLog(self.db)
        self.owner = OwnerGate(self.project.path / "var", environment_token="owner-secret")
        self.users = UserStore(self.db)
        self.admin = self.users.create("admin", "Admin!Passw0rd2026", "ADMIN")
        self.viewer = self.users.create("viewer", "Viewer!Passw0rd2026", "VIEWER")

    def test_defaults_match_specifications(self):
        policy = DEFAULT_POLICY
        self.assertEqual(policy.max_risk_per_trade_pct, Decimal("0.5"))
        self.assertEqual(policy.max_daily_loss_pct, Decimal("2.0"))
        self.assertEqual(policy.max_weekly_loss_pct, Decimal("5.0"))
        self.assertEqual(policy.max_drawdown_pct, Decimal("10.0"))
        self.assertEqual(policy.max_open_positions, 3)
        self.assertEqual(policy.max_open_risk_pct, Decimal("1.5"))

    def test_bootstrap_and_versioning(self):
        store = PolicyStore(self.db, self.journal, self.audit, self.owner)
        policy = store.bootstrap()
        self.assertEqual(policy.version, 1)
        updated = store.update({"max_open_positions": 4}, self.admin, "test",
                               "owner-secret", OwnerGate.PHRASE)
        self.assertEqual(updated.version, 2)
        self.assertEqual(store.current().max_open_positions, 4)
        self.assertTrue(store.verify_chain())
        self.assertEqual(len(store.history()), 2)

    def test_update_requires_owner_token_and_role(self):
        store = PolicyStore(self.db, self.journal, self.audit, self.owner)
        store.bootstrap()
        with self.assertRaises(AuthError):
            store.update({"max_open_positions": 2}, self.viewer, "test",
                         "owner-secret", OwnerGate.PHRASE)
        with self.assertRaises(AuthError):
            store.update({"max_open_positions": 2}, self.admin, "test", "mauvais", OwnerGate.PHRASE)
        with self.assertRaises(AuthError):
            store.update({"max_open_positions": 2}, self.admin, "test", "owner-secret", "nope")

    def test_invalid_values_rejected(self):
        store = PolicyStore(self.db, self.journal, self.audit, self.owner)
        store.bootstrap()
        with self.assertRaises(AuthError):
            store.update({"max_risk_per_trade_pct": "50"}, self.admin, "t",
                         "owner-secret", OwnerGate.PHRASE)
        with self.assertRaises(AuthError):
            store.update({"inconnu": 1}, self.admin, "t", "owner-secret", OwnerGate.PHRASE)

    def test_validate_detects_incoherence(self):
        policy = DEFAULT_POLICY.with_changes({"max_open_risk_pct": "0.2"})
        self.assertTrue(policy.validate())


class GuardTests(EngineTestCase):
    def test_startup_is_always_simulation(self):
        status = self.engine.guard.status()
        self.assertEqual(status["environment"], "SIMULATION")
        self.assertFalse(status["is_real"])
        self.assertFalse(status["can_activate_real"])
        self.assertFalse(status["all_validations_closed"])

    def test_real_mode_is_refused(self):
        admin = self.engine.users.get("admin")
        status, payload = 0, None
        with self.assertRaises(AuthError) as context:
            self.engine.guard.request_environment("REAL_AUTO", admin, "token", "phrase")
        self.assertEqual(context.exception.code, "REAL_MODE_DENIED")
        self.assertIn("refusée", str(context.exception))

    def test_demo_switch_is_allowed_and_reversible(self):
        admin = self.engine.users.get("admin")
        status = self.engine.guard.request_environment("DEMO", admin)
        self.assertEqual(status["environment"], "DEMO")
        status = self.engine.guard.request_environment("SIMULATION", admin)
        self.assertEqual(status["environment"], "SIMULATION")

    def test_validations_require_evidence(self):
        admin = self.engine.users.get("admin")
        with self.assertRaises(AuthError):
            self.engine.guard.record_validation("technical", True, "  ", admin)
        result = self.engine.guard.record_validation("technical", True, "rapport T-2026-11", admin)
        self.assertTrue(result["closed"])
        self.assertTrue(self.engine.guard.validations()["technical"]["closed"])

    def test_order_allowed_only_outside_real(self):
        self.engine.guard.assert_order_allowed("SIMULATION")
        with self.assertRaises(PermissionError):
            self.engine.guard.assert_order_allowed("REAL_AUTO")


class MarketTests(unittest.TestCase):
    def test_indicators_on_regular_series(self):
        candles = make_candles(120, start=100.0, step=0.5)
        series = series_from(candles)
        closes = series.closes()
        self.assertIsNotNone(sma(closes, 20))
        self.assertEqual(ema(closes, 10), ema(closes, 10))
        self.assertGreater(rsi(closes, 14), Decimal("50"))
        self.assertIsNotNone(atr(candles, 14))
        self.assertIsNotNone(stdev(closes, 20))
        bands = bollinger(closes, 20)
        self.assertGreater(bands["upper"], bands["middle"])
        self.assertIsNotNone(donchian(candles, 20))
        self.assertIsNotNone(macd(closes))
        snapshot = indicator_snapshot(series)
        self.assertTrue(snapshot["ready"])

    def test_indicators_return_none_when_insufficient(self):
        self.assertIsNone(sma([Decimal(1)], 5))
        self.assertIsNone(ema([Decimal(1)], 5))
        self.assertIsNone(rsi([Decimal(1), Decimal(2)], 14))
        self.assertIsNone(atr([], 14))

    def test_candle_series_updates_current_bucket(self):
        series = CandleSeries("1m")
        moment = dt.datetime(2026, 11, 9, 12, 0, 5, tzinfo=dt.timezone.utc)
        series.add_tick(Decimal("100"), moment)
        series.add_tick(Decimal("102"), moment + dt.timedelta(seconds=10))
        self.assertEqual(len(series), 1)
        self.assertEqual(series.last.high, Decimal("102"))
        series.add_tick(Decimal("99"), moment + dt.timedelta(minutes=2))
        self.assertEqual(len(series), 2)

    def test_timeframe_start(self):
        moment = dt.datetime(2026, 11, 1, 12, 7, 30, tzinfo=dt.timezone.utc)
        self.assertEqual(timeframe_start(moment, "5m").minute, 5)
        self.assertEqual(timeframe_start(moment, "15m").minute, 0)

    def test_store_tracks_quotes_and_freshness(self):
        store = MarketDataStore(("EURUSD",))
        store.update_quote(Quote(symbol="EURUSD", bid=Decimal("1.1"), ask=Decimal("1.1002"),
                                 last=Decimal("1.1001"), timestamp=now_utc(),
                                 received_at=now_utc()))
        fresh, issues = store.check_quote("EURUSD", DEFAULT_POLICY)
        self.assertTrue(fresh, issues)
        stale_store = MarketDataStore(("EURUSD",))
        stale_store.update_quote(Quote(symbol="EURUSD", bid=Decimal("1.1"), ask=Decimal("1.1002"),
                                       last=Decimal("1.1001"),
                                       timestamp=now_utc() - dt.timedelta(seconds=10),
                                       received_at=now_utc() - dt.timedelta(seconds=10)))
        fresh, issues = stale_store.check_quote("EURUSD", DEFAULT_POLICY)
        self.assertFalse(fresh)
        self.assertTrue(any(issue.startswith("QUOTE_STALE") for issue in issues))

    def test_store_rejects_out_of_order_quotes(self):
        store = MarketDataStore(("EURUSD",))
        newest = Quote(symbol="EURUSD", bid=Decimal("1.1"), ask=Decimal("1.1002"),
                       last=Decimal("1.1001"), timestamp=now_utc(), received_at=now_utc())
        store.update_quote(newest)
        older = Quote(symbol="EURUSD", bid=Decimal("1.0"), ask=Decimal("1.0002"),
                      last=Decimal("1.0001"), timestamp=now_utc() - dt.timedelta(minutes=5),
                      received_at=now_utc())
        self.assertIsNone(store.update_quote(older))
        self.assertEqual(store.dropped_out_of_order, 1)


class SimulatorTests(unittest.TestCase):
    def test_deterministic_history(self):
        first = MarketSimulator(seed=7).history("EURUSD", "5m", 50)
        second = MarketSimulator(seed=7).history("EURUSD", "5m", 50)
        self.assertEqual([float(c.close) for c in first], [float(c.close) for c in second])

    def test_ticks_have_spread_and_positive_prices(self):
        simulator = MarketSimulator(seed=3)
        monday = dt.datetime(2026, 11, 9, 12, 0, tzinfo=dt.timezone.utc)
        quotes = simulator.tick_all(monday)
        self.assertEqual(len(quotes), len(SYMBOLS))
        for quote in quotes:
            self.assertGreater(quote.ask, quote.bid)
            self.assertGreater(quote.last, Decimal("0"))

    def test_fault_injection(self):
        simulator = MarketSimulator(seed=3)
        monday = dt.datetime(2026, 11, 9, 12, 0, tzinfo=dt.timezone.utc)
        simulator.inject("EURUSD", missing_quote=True)
        self.assertIsNone(simulator.tick("EURUSD", monday))
        simulator.clear_faults("EURUSD")
        self.assertIsNotNone(simulator.tick("EURUSD", monday))
        simulator.inject("EURUSD", wide_spread_bps=Decimal("900"))
        quote = simulator.tick("EURUSD", monday + dt.timedelta(seconds=5))
        self.assertGreater(quote.spread_bps, Decimal("100"))

    def test_calendar(self):
        saturday = dt.datetime(2026, 11, 7, 12, 0, tzinfo=dt.timezone.utc)
        monday = dt.datetime(2026, 11, 9, 12, 0, tzinfo=dt.timezone.utc)
        self.assertFalse(is_market_open("EURUSD", saturday))
        self.assertTrue(is_market_open("EURUSD", monday))
        self.assertTrue(is_market_open("BTCUSDT", saturday))

    def test_clock_speed(self):
        clock = SimulationClock(speed=300, base=dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc))
        instant = clock.now(real_time=clock._base_real + 10)
        self.assertEqual(instant, dt.datetime(2026, 1, 1, 0, 50, tzinfo=dt.timezone.utc))


if __name__ == "__main__":
    unittest.main()
