"""Tests d'intégration du moteur et de l'API HTTP (sections 5 à 8, 19, 24)."""

from __future__ import annotations

import datetime as dt
import json
import unittest
import urllib.request
from decimal import Decimal

from helpers import ADMIN_PASSWORD, ROOT, ApiTestCase, EngineTestCase

from carnet.config import ENV_SIMULATION
from carnet.util import D

SNAPSHOT_KEYS = {
    "account", "app", "banner", "connectors", "environment", "indicators", "journal",
    "market", "metrics", "notifications", "orders", "performance", "positions",
    "reconciliation", "risk", "server_time", "signals", "simulation", "strategies",
    "unread_notifications",
}


class EngineBootstrapTests(EngineTestCase):
    def test_default_policy_matches_specification(self):
        policy = self.engine.policy_store.current()
        self.assertEqual(policy.max_risk_per_trade_pct, Decimal("0.5"))
        self.assertEqual(policy.max_daily_loss_pct, Decimal("2.0"))
        self.assertEqual(policy.max_weekly_loss_pct, Decimal("5.0"))
        self.assertEqual(policy.max_drawdown_pct, Decimal("10.0"))
        self.assertEqual(policy.max_open_positions, 3)
        self.assertEqual(policy.max_open_risk_pct, Decimal("1.5"))

    def test_bootstrap_state(self):
        engine = self.engine
        self.assertTrue(engine.bootstrap_done)
        self.assertEqual(engine.guard.environment, ENV_SIMULATION)
        self.assertEqual(engine.state, "STOPPED")
        self.assertTrue(engine.entries_enabled)
        self.assertEqual(engine.reconciler.last_result["status"], "OK")
        self.assertGreaterEqual(engine.users.count(), 3)
        self.assertTrue((self.project.path / "var" / "initial_credentials.txt").exists())
        self.assertEqual(engine.connector.account().equity, Decimal("10000.0"))

    def test_market_warmed_with_candles_and_quotes(self):
        for symbol in self.engine.settings.symbols:
            self.assertGreaterEqual(len(self.engine.market.series(symbol, "5m")), 200)
            self.assertIsNotNone(self.engine.market.quote(symbol))
        fresh, issues = self.engine.market.check_quote("EURUSD", self.engine.risk.policy)
        self.assertTrue(fresh, issues)

    def test_start_stop_lifecycle(self):
        self.engine.start(background=True)
        self.assertEqual(self.engine.state, "RUNNING")
        self.engine.shutdown()
        self.assertEqual(self.engine.state, "STOPPED")
        self.assertFalse(self.engine._thread and self.engine._thread.is_alive())

    def test_snapshot_contract(self):
        token = self.login()
        snapshot = self.engine.snapshot(self.engine.sessions.resolve(token).user)
        self.assertTrue(SNAPSHOT_KEYS.issubset(snapshot))
        self.assertEqual(snapshot["app"]["data_mode"], "simulation")
        self.assertIn("equity", snapshot["account"])
        self.assertFalse(snapshot["environment"]["can_activate_real"])
        self.assertIn("blockers", snapshot["environment"])


class EngineRunTests(EngineTestCase):
    def test_cycles_run_without_engine_errors(self):
        results = self.run_cycles(4, step_seconds=300)
        self.assertEqual(len(results), 4)
        # Régression : la persistance de l'état du connecteur ne doit jamais
        # interrompre un cycle (pump/save_state).
        self.assertEqual(self.engine._errors, [])
        self.assertGreater(self.engine._tick_count, 0)
        self.assertTrue(self.engine.journal.verify_chain()["ok"])

    def test_signals_are_not_stale_with_advanced_market_clock(self):
        """Régression : la fraîcheur se mesure sur l'horloge de marché, pas la réelle."""
        from carnet.strategies import Signal

        engine = self.engine
        moment = engine.sim_now() + dt.timedelta(hours=3)
        quote = engine.market.quote("EURUSD")
        signal = Signal(strategy="test", symbol="EURUSD", side="BUY",
                        entry_ref=quote.mid, stop=quote.mid - Decimal("0.003"),
                        target=quote.mid + Decimal("0.006"), confidence=Decimal("0.6"),
                        reasons=["test horloge de marché"], created_at=moment)
        engine._store_signal(signal)
        self.assertTrue(engine._process_signal(signal, engine.connector.account(), moment))
        rows = engine.db.query("SELECT code FROM risk_decisions WHERE signal_id=?", (signal.id,))
        self.assertEqual([row["code"] for row in rows], ["OK"])

        stale = Signal(strategy="test", symbol="EURUSD", side="BUY",
                       entry_ref=quote.mid, stop=quote.mid - Decimal("0.003"),
                       target=quote.mid + Decimal("0.006"), confidence=Decimal("0.6"),
                       reasons=["signal périmé"], created_at=moment - dt.timedelta(seconds=30))
        engine._store_signal(stale)
        self.assertFalse(engine._process_signal(stale, engine.connector.account(), moment))
        rows = engine.db.query("SELECT code FROM risk_decisions WHERE signal_id=?", (stale.id,))
        self.assertEqual([row["code"] for row in rows], ["SIGNAL_STALE"])

    def test_market_store_updates_on_cycles(self):
        series = self.engine.market.series("EURUSD", "1m")
        before = len(series)
        self.run_cycles(3, step_seconds=60)
        self.assertGreaterEqual(len(series), before)

    def test_order_flow_updates_positions_and_equity(self):
        self.push_quote("EURUSD", 1.0875)
        quote = self.engine.market.quote("EURUSD")
        manager = self.engine.orders
        order = manager.submit(symbol="EURUSD", side="BUY", qty=D("0.10"),
                               stop=quote.mid - Decimal("0.005"), target=quote.mid + Decimal("0.010"),
                               entry=quote.mid, environment="SIMULATION", strategy="test")
        self.assertEqual(order["state"], "FILLED")
        manager.apply_events(self.engine.connector.pump(self.engine.market.quotes()))
        positions = manager.open_positions()
        self.assertEqual(len(positions), 1)
        self.assertTrue(positions[0]["protection_ok"])
        self.run_cycles(1, step_seconds=5)
        account = self.engine.connector.account()
        self.assertNotEqual(account.equity, Decimal("10000.0"))

    def test_stop_trading_blocks_entries_and_resume_restores(self):
        engine = self.engine
        result = engine.stop_trading("test", "test unitaire")
        self.assertFalse(result["entries_enabled"])
        self.assertFalse(engine.entries_enabled)
        self.assertTrue(engine.risk_states.state.suspended)
        resumed = engine.resume_trading("test")
        self.assertTrue(resumed["entries_enabled"])
        self.assertTrue(engine.entries_enabled)

    def test_kill_switch_blocks_resume_until_released(self):
        engine = self.engine
        engine.engage_kill_switch("test", "incident simulé")
        self.assertTrue(engine.risk_states.state.kill_switch)
        with self.assertRaises(Exception):
            engine.resume_trading("test")
        released = engine.release_kill_switch("test")
        self.assertFalse(released["kill_switch"])

    def test_liquidation_closes_and_reconciles(self):
        engine = self.engine
        self.push_quote("EURUSD", 1.0875)
        quote = engine.market.quote("EURUSD")
        engine.orders.submit(symbol="EURUSD", side="BUY", qty=D("0.10"),
                             stop=quote.mid - Decimal("0.005"), target=quote.mid + Decimal("0.010"),
                             entry=quote.mid, environment="SIMULATION")
        engine.orders.apply_events(engine.connector.pump(engine.market.quotes()))
        self.assertEqual(len(engine.orders.open_positions()), 1)
        result = engine.liquidate_all("test", "exercice")
        self.assertEqual(result["positions_open"], 0)
        self.assertEqual(engine.connector.positions(), [])
        self.assertEqual(engine.orders.open_positions(), [])
        self.assertEqual(engine.reconciler.run("after-liquidation")["status"], "OK")

    def test_connector_state_survives_restart(self):
        engine = self.engine
        self.push_quote("EURUSD", 1.0875)
        quote = engine.market.quote("EURUSD")
        engine.orders.submit(symbol="EURUSD", side="BUY", qty=D("0.10"),
                             stop=quote.mid - Decimal("0.005"), target=quote.mid + Decimal("0.010"),
                             entry=quote.mid, environment="SIMULATION")
        engine.orders.apply_events(engine.connector.pump(engine.market.quotes()))
        balance = engine.connector.balance
        position_ids = {p["id"] for p in engine.orders.open_positions()}
        engine.shutdown()

        restarted = self.make_engine()
        restarted.bootstrap()
        self.assertEqual({p["id"] for p in restarted.orders.open_positions()}, position_ids)
        self.assertEqual(restarted.connector.balance, balance)
        self.assertEqual(restarted.reconciler.last_result["status"], "OK")

    def test_suspension_survives_restart(self):
        self.engine.risk_states.suspend("DAILY_LOSS_LIMIT")
        self.engine.shutdown()
        restarted = self.make_engine()
        restarted.bootstrap()
        self.assertTrue(restarted.risk_states.state.suspended)
        self.assertEqual(restarted.risk_states.state.suspension_reason, "DAILY_LOSS_LIMIT")
        self.assertFalse(restarted.entries_enabled)

    def test_observer_records_equity_snapshots(self):
        before = len(self.engine.db.query("SELECT id FROM equity_snapshots"))
        self.run_cycles(2, step_seconds=900)
        after = len(self.engine.db.query("SELECT id FROM equity_snapshots"))
        self.assertGreater(after, before)

    def test_recent_signals_and_strategy_descriptions(self):
        self.run_cycles(6, step_seconds=300)
        self.assertIsInstance(self.engine.recent_signals(5), list)
        descriptions = self.engine.strategies.describe()
        self.assertGreaterEqual(len(descriptions), 3)
        for item in descriptions:
            self.assertIn("key", item)
            self.assertIn("enabled", item)


class ApiTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.token = self.login()

    def auth(self):
        return {"Authorization": f"Bearer {self.token}"}

    # -- authentification ------------------------------------------------
    def test_public_info_without_token(self):
        status, body = self.get("/api/public/info")
        self.assertEqual(status, 200)
        self.assertTrue(body["simulation"])
        self.assertEqual(body["environment"], ENV_SIMULATION)

    def test_state_requires_token(self):
        status, body = self.get("/api/state")
        self.assertEqual(status, 401)
        self.assertIn("error", body)

    def test_login_success_and_failure(self):
        status, body = self.post("/api/auth/login",
                                 {"username": "admin", "password": ADMIN_PASSWORD})
        self.assertEqual(status, 200)
        self.assertIn("token", body)
        self.assertEqual(body["user"]["role"], "ADMIN")
        status, body = self.post("/api/auth/login",
                                 {"username": "admin", "password": "mauvais"})
        self.assertEqual(status, 401)

    def test_me_and_logout(self):
        status, body = self.get("/api/auth/me", self.token)
        self.assertEqual(status, 200)
        self.assertEqual(body["user"]["username"], "admin")
        status, _ = self.post("/api/auth/logout", {}, self.token)
        self.assertEqual(status, 200)
        status, _ = self.get("/api/auth/me", self.token)
        self.assertEqual(status, 401)

    def test_invalid_token_rejected(self):
        status, _ = self.get("/api/state", "jeton-invalide")
        self.assertEqual(status, 401)

    # -- lecture ---------------------------------------------------------
    def test_state_contract(self):
        status, body = self.get("/api/state", self.token)
        self.assertEqual(status, 200)
        self.assertTrue(SNAPSHOT_KEYS.issubset(body))
        self.assertTrue(body["risk"]["entries_enabled"] or not body["banner"]["level"] == "INFO")

    def test_health_symbols_candles_indicators(self):
        status, health = self.get("/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(health["ok"])
        self.assertEqual(health["environment"], ENV_SIMULATION)

        status, symbols = self.get("/api/symbols", self.token)
        self.assertEqual(status, 200)
        self.assertTrue(any(s["symbol"] == "EURUSD" for s in symbols["symbols"]))

        status, candles = self.get("/api/market/EURUSD/candles?tf=5m&limit=50", self.token)
        self.assertEqual(status, 200)
        self.assertLessEqual(len(candles["candles"]), 50)

        status, indicators = self.get("/api/market/EURUSD/indicators", self.token)
        self.assertEqual(status, 200)
        self.assertIn("indicators", indicators)

        status, _ = self.get("/api/market/INCONNU/candles", self.token)
        self.assertEqual(status, 404)

    def test_lists_orders_positions_signals_strategies(self):
        for path in ("/api/orders", "/api/positions", "/api/positions/history",
                     "/api/signals", "/api/strategies", "/api/risk/policy", "/api/risk/status",
                     "/api/journal", "/api/diagnostics", "/api/notifications",
                     "/api/reconciliations", "/api/backups", "/api/users", "/api/sessions",
                     "/api/environment", "/api/validations", "/api/backtests", "/api/audits"):
            status, body = self.get(path, self.token)
            self.assertEqual(status, 200, f"{path} -> {status} {body}")
            self.assertIsInstance(body, dict)

    def test_unknown_route_returns_404(self):
        status, _ = self.get("/api/inexistant", self.token)
        self.assertEqual(status, 404)

    # -- écriture --------------------------------------------------------
    def test_policy_update_requires_owner_token(self):
        status, body = self.post("/api/risk/policy",
                                 {"changes": {"max_risk_per_trade_pct": 0.4}}, self.token)
        self.assertEqual(status, 403)
        self.assertIn(body["code"], ("OWNER_TOKEN_MISSING", "OWNER_TOKEN_INVALID"))

        self.engine.owner_gate._token = "jeton-de-test"
        status, body = self.post("/api/risk/policy", {
            "changes": {"max_risk_per_trade_pct": 0.4}, "owner_token": "jeton-de-test",
            "confirmation": "JE CONFIRME CETTE DECISION PROPRIETAIRE",
            "reason": "test unitaire"}, self.token)
        self.assertEqual(status, 200)
        self.assertEqual(Decimal(str(body["policy"]["max_risk_per_trade_pct"])), Decimal("0.4"))

        status, history = self.get("/api/risk/history", self.token)
        self.assertGreaterEqual(len(history["versions"]), 2)

    def test_policy_rejects_absurd_values(self):
        self.engine.owner_gate._token = "jeton-de-test"
        status, body = self.post("/api/risk/policy", {
            "changes": {"max_risk_per_trade_pct": 99}, "owner_token": "jeton-de-test",
            "confirmation": "JE CONFIRME CETTE DECISION PROPRIETAIRE"}, self.token)
        self.assertEqual(status, 400)
        self.assertEqual(body["code"], "INVALID_POLICY")

    def test_control_endpoints(self):
        status, body = self.post("/api/control/stop", {"reason": "test"}, self.token)
        self.assertEqual(status, 200)
        self.assertFalse(body["entries_enabled"])
        status, body = self.post("/api/control/resume", {}, self.token)
        self.assertEqual(status, 200)
        self.assertTrue(body["entries_enabled"])

        status, body = self.post("/api/control/liquidate", {}, self.token)
        self.assertEqual(status, 400)
        self.assertEqual(body["code"], "CONFIRMATION_REQUIRED")
        status, body = self.post("/api/control/liquidate", {"confirmation": "LIQUIDER"}, self.token)
        self.assertEqual(status, 200)
        self.assertEqual(body["positions_open"], 0)

        status, body = self.post("/api/control/kill-switch", {"reason": "test"}, self.token)
        self.assertEqual(status, 200)
        self.assertTrue(body["kill_switch"])
        status, body = self.post("/api/control/release-kill-switch", {}, self.token)
        self.assertEqual(status, 200)
        self.assertFalse(body["kill_switch"])

    def test_journal_verify_and_audits(self):
        status, body = self.post("/api/journal/verify", {}, self.token)
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        status, audits = self.get("/api/audits", self.token)
        self.assertEqual(status, 200)
        self.assertTrue(audits["chain_ok"])

    def test_strategy_toggle(self):
        status, strategies = self.get("/api/strategies", self.token)
        key = strategies["strategies"][0]["key"]
        status, body = self.post(f"/api/strategies/{key}/toggle", {"enabled": False}, self.token)
        self.assertEqual(status, 200)
        self.assertFalse(body["strategy"]["enabled"])
        status, body = self.post("/api/strategies/inconnue/toggle", {"enabled": True}, self.token)
        self.assertEqual(status, 404)

    def test_backtest_run_and_list(self):
        status, body = self.post("/api/backtest", {
            "strategy": "ema_trend", "symbols": ["EURUSD"], "bars": 260, "timeframe": "5m",
            "monte_carlo_runs": 20, "walk_forward_windows": 2}, self.token)
        self.assertEqual(status, 200, body)
        self.assertIn("metrics", body)
        self.assertIn("trades", body["metrics"])
        status, listing = self.get("/api/backtests", self.token)
        self.assertGreaterEqual(len(listing["backtests"]), 1)

    def test_backup_create_verify_and_restore_guard(self):
        status, body = self.post("/api/backups", {"label": "test"}, self.token)
        self.assertEqual(status, 200)
        path = body["backup"]["path"]
        status, verified = self.post("/api/backups/verify", {"path": path}, self.token)
        self.assertEqual(status, 200)
        self.assertTrue(verified["ok"])
        status, body = self.post("/api/backups/restore", {"path": path}, self.token)
        self.assertEqual(status, 400)
        status, body = self.post("/api/backups/restore",
                                 {"path": path, "confirmation": "RESTAURER"}, self.token)
        self.assertEqual(status, 409)
        self.assertFalse(body["restored"])

    def test_environment_cannot_be_switched_to_real(self):
        status, body = self.post("/api/environment",
                                 {"environment": "REAL_AUTO"}, self.token)
        self.assertIn(status, (403, 409))
        self.assertEqual(self.engine.guard.environment, ENV_SIMULATION)

    def test_notifications_flow(self):
        self.engine.stop_trading("test", "test notifications")
        status, body = self.get("/api/notifications", self.token)
        self.assertEqual(status, 200)
        self.assertGreaterEqual(body["unread"], 1)
        status, body = self.post("/api/notifications/read", {}, self.token)
        self.assertEqual(status, 200)

    def test_user_creation_and_role_permissions(self):
        status, body = self.post("/api/users", {
            "username": "lecteur2", "password": "Lecteur!Password2026", "role": "VIEWER"},
            self.token)
        self.assertEqual(status, 200, body)
        token, _ = self.engine.sessions.create(
            self.engine.users.get("lecteur2"), ip="127.0.0.1")

        status, _ = self.get("/api/state", token)
        self.assertEqual(status, 200)
        status, body = self.post("/api/control/stop", {}, token)
        self.assertEqual(status, 403)
        status, _ = self.get("/api/users", token)
        self.assertEqual(status, 403)
        status, _ = self.post("/api/risk/policy", {"changes": {"max_risk_per_trade_pct": 0.4}}, token)
        self.assertEqual(status, 403)

        status, body = self.post("/api/users", {"username": "x", "password": "faible"},
                                 self.token)
        self.assertEqual(status, 400)
        self.assertEqual(body["code"], "WEAK_PASSWORD")

    def test_static_frontend_is_served(self):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/", timeout=10) as response:
            html = response.read().decode()
        self.assertEqual(response.status, 200)
        self.assertIn("<title>", html)
        self.assertIn("app.js", html)
        with urllib.request.urlopen(
                f"http://127.0.0.1:{self.port}/js/app.js", timeout=10) as response:
            script = response.read().decode()
        self.assertIn("function", script)
        try:
            with urllib.request.urlopen(
                    f"http://127.0.0.1:{self.port}/../backend/carnet/db.py", timeout=10) as response:
                leaked = response.read().decode(errors="ignore")
        except urllib.error.HTTPError as error:
            self.assertIn(error.code, (403, 404))
        else:
            self.assertNotIn("class Database", leaked)

    def test_security_headers(self):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/api/public/info",
                                    timeout=10) as response:
            headers = {key.lower(): value for key, value in response.headers.items()}
        self.assertIn("x-content-type-options", headers)
        self.assertEqual(headers["x-content-type-options"], "nosniff")
        self.assertIn("frame-ancestors", headers.get("content-security-policy", ""))


if __name__ == "__main__":
    unittest.main()
