"""Pont MT5 démo : agent Windows (faux terminal), connecteur, magasin et API."""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys
import threading
import unittest.mock
import time
import unittest
from decimal import Decimal
from http.server import ThreadingHTTPServer

from helpers import ApiTestCase, TempProject

_SCRIPTS = pathlib.Path(__file__).resolve().parents[1] / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import mt5_agent  # noqa: E402  (l'agent vit dans scripts/)
from carnet.connections import Mt5ConnectionStore
from carnet.connectors.base import (
    ConnectorError,
    ConnectorUnavailable,
    OrderRejected,
    OrderRequest,
    OrderTimeout,
    RealTradingForbidden,
    UnknownOrderState,
)
from carnet.connectors.mt5_bridge import Mt5BridgeConnector


class FakeMT5:
    """Terminal factice : imite le sous-ensemble de MetaTrader5 utilisé par l'agent."""

    TRADE_ACTION_DEAL = 1
    TRADE_ACTION_PENDING = 5
    TRADE_ACTION_SLTP = 6
    TRADE_ACTION_MODIFY = 7
    TRADE_ACTION_REMOVE = 8
    ORDER_TYPE_BUY = 0
    ORDER_TYPE_SELL = 1
    ORDER_TYPE_BUY_LIMIT = 2
    ORDER_TYPE_SELL_LIMIT = 3
    ORDER_TIME_GTC = 0
    TRADE_RETCODE_DONE = 10009

    def __init__(self, trade_mode=0, connected=True):
        self.trade_mode = trade_mode
        self.connected = connected
        self.orders = []
        self.calls = []
        self._next_ticket = 5000
        self._positions = [
            {"ticket": 777001, "symbol": "EURUSD.a", "type": 0, "volume": 0.1,
             "price_open": 1.0850, "sl": 1.0800, "tp": 1.0950, "profit": 12.5,
             "time": int(time.time()), "comment": "TREND"},
        ]

    # -- lectures --------------------------------------------------------
    def account_info(self):
        return {"login": 5012345, "trade_mode": self.trade_mode, "currency": "USD",
                "balance": 10000.0, "equity": 10042.0, "margin_free": 9800.0,
                "margin": 200.0, "leverage": 100, "company": "BrokerDemo",
                "server": "Broker-Demo"}

    def terminal_info(self):
        return {"build": 4755, "connected": self.connected, "trade_allowed": True}

    def positions_get(self, **kwargs):
        if kwargs.get("ticket"):
            return [p for p in self._positions if p["ticket"] == kwargs["ticket"]]
        return list(self._positions)

    def orders_get(self, **kwargs):
        if kwargs.get("ticket"):
            return [o for o in self.orders if o["ticket"] == kwargs["ticket"]]
        return list(self.orders)

    def history_deals_get(self, *args, **kwargs):
        return []

    def symbol_info_tick(self, symbol):
        prices = {"EURUSD.a": (1.08501, 1.08519), "BTCUSD": (64000.0, 64010.0),
                  "frxEURUSD": (1.08501, 1.08519), "cryBTCUSD": (64000.0, 64010.0)}
        if symbol not in prices:
            return None
        bid, ask = prices[symbol]
        return {"bid": bid, "ask": ask, "last": bid, "volume": 10.0, "time": int(time.time())}

    def symbols_get(self, *args, **kwargs):
        names = ["EURUSD.a", "GBPUSD.a", "USDJPY.a", "AUDUSD.a", "USDCAD.a", "BTCUSD"]
        return [{"name": name, "path": f"Forex\\{name}", "visible": True, "trade_mode": 4}
                for name in names]

    def symbol_info(self, symbol):
        return {"filling_mode": 2, "digits": 5}

    def last_error(self):
        return (0, "ok")

    def order_send(self, request):
        self.calls.append(request)
        if request["action"] == self.TRADE_ACTION_REMOVE:
            self.orders = [o for o in self.orders if o["ticket"] != request["order"]]
            return {"retcode": self.TRADE_RETCODE_DONE, "order": request["order"],
                    "comment": "removed"}
        if request["action"] == self.TRADE_ACTION_DEAL:
            ticket = self._next_ticket
            self._next_ticket += 1
            return {"retcode": self.TRADE_RETCODE_DONE, "order": ticket, "deal": ticket,
                    "comment": "done"}
        return {"retcode": self.TRADE_RETCODE_DONE, "order": request.get("order", 0),
                "comment": "done"}


class AgentHarness:
    """Lance l'agent (BridgeHandler) sur un port éphémère, comme sur le nœud Windows."""

    def __init__(self, terminal: mt5_agent.Terminal, token: str = "jeton-de-test-0123456789"):
        self.token = token
        handler = type("TestHandler", (mt5_agent.BridgeHandler,), {
            "token": token, "terminal": terminal})
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.httpd.daemon_threads = True
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        host, port = self.httpd.server_address
        self.url = f"http://{host}:{port}"

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)


def make_terminal(trade_mode=0, connected=True, suffix=".a"):
    module = FakeMT5(trade_mode=trade_mode, connected=connected)
    return mt5_agent.Terminal(module, suffix), module


class Mt5ConnectorTests(unittest.TestCase):
    def setUp(self):
        self.project = TempProject()
        self.addCleanup(self.project.cleanup)
        self.terminal, self.module = make_terminal()
        self.agent = AgentHarness(self.terminal)
        self.addCleanup(self.agent.close)

    def connector(self, **kwargs):
        kwargs.setdefault("symbol_suffix", ".a")
        return Mt5BridgeConnector(self.agent.url, self.agent.token, **kwargs)

    # -- connexion -------------------------------------------------------
    def test_connect_on_demo_account(self):
        connector = self.connector()
        connector.connect()
        self.assertTrue(connector.is_connected())
        self.assertEqual(connector.account_kind, "demo")
        self.assertEqual(connector.terminal["login"], 5012345)
        connector.disconnect()
        self.assertFalse(connector.is_connected())

    def test_real_account_is_refused(self):
        terminal, _ = make_terminal(trade_mode=2)
        agent = AgentHarness(terminal)
        self.addCleanup(agent.close)
        connector = Mt5BridgeConnector(agent.url, agent.token)
        with self.assertRaises(RealTradingForbidden):
            connector.connect()
        self.assertFalse(connector.is_connected())

    def test_environment_real_is_refused_without_network(self):
        connector = self.connector(environment="REAL")
        with self.assertRaises(RealTradingForbidden):
            connector.connect()

    def test_bad_token_is_refused(self):
        connector = Mt5BridgeConnector(self.agent.url, "mauvais-jeton")
        with self.assertRaises(ConnectorUnavailable) as ctx:
            connector.connect()
        self.assertEqual(ctx.exception.code, "MT5_BRIDGE_UNAUTHORIZED")

    def test_unreachable_bridge(self):
        connector = Mt5BridgeConnector("http://127.0.0.1:1", "jeton")
        with self.assertRaises(ConnectorError):
            connector.connect()
        self.assertFalse(connector.health().get("ok"))

    def test_terminal_disconnected(self):
        terminal, _ = make_terminal(connected=False)
        agent = AgentHarness(terminal)
        self.addCleanup(agent.close)
        connector = Mt5BridgeConnector(agent.url, agent.token)
        with self.assertRaises(ConnectorUnavailable):
            connector.connect()

    # -- lectures --------------------------------------------------------
    def test_read_account_positions_quotes(self):
        connector = self.connector()
        connector.connect()
        account = connector.account()
        self.assertEqual(account.currency, "USD")
        self.assertEqual(float(account.balance), 10000.0)
        positions = connector.positions()
        self.assertEqual(positions[0].symbol, "EURUSD")
        self.assertEqual(float(positions[0].qty), 0.1)
        quotes = connector.quotes(["EURUSD", "BTCUSD"])
        self.assertEqual([q["symbol"] for q in quotes], ["EURUSD"])
        self.assertEqual(float(quotes[0]["ask"]), 1.08519)
        self.assertEqual(connector.open_orders(), [])

    def test_orders_are_disabled_by_default(self):
        connector = self.connector()
        connector.connect()
        with self.assertRaises(ConnectorUnavailable) as ctx:
            connector.place_order(OrderRequest(
                symbol="EURUSD", side="BUY", qty=Decimal("0.1"),
                stop_price=Decimal("1.08"), target_price=Decimal("1.09"),
                environment="DEMO"))
        self.assertEqual(ctx.exception.code, "MT5_ORDER_NOT_ENABLED")
        self.assertEqual(self.module.calls, [])

    def test_bracket_is_mandatory(self):
        connector = self.connector(allow_orders=True)
        connector.connect()
        with self.assertRaises(OrderRejected) as ctx:
            connector.place_order(OrderRequest(symbol="EURUSD", side="BUY",
                                               qty=Decimal("0.1"), environment="DEMO"))
        self.assertIn("bracket", str(ctx.exception).lower())
        self.assertEqual(self.module.calls, [])

    def test_real_environment_order_is_refused(self):
        connector = self.connector(allow_orders=True)
        connector.connect()
        with self.assertRaises(RealTradingForbidden):
            connector.place_order(OrderRequest(
                symbol="EURUSD", side="BUY", qty=Decimal("0.1"),
                stop_price=Decimal("1.08"), target_price=Decimal("1.09"),
                environment="REAL"))

    def test_demo_order_is_forwarded_with_bracket(self):
        connector = self.connector(allow_orders=True)
        connector.connect()
        ack = connector.place_order(OrderRequest(
            symbol="EURUSD", side="SELL", qty=Decimal("0.2"),
            stop_price=Decimal("1.0900"), target_price=Decimal("1.0800"),
            strategy="TREND", environment="DEMO"))
        self.assertTrue(ack.platform_order_id)
        self.assertEqual(ack.state, "FILLED")
        sent = self.module.calls[-1]
        self.assertEqual(sent["symbol"], "EURUSD.a")
        self.assertEqual(sent["sl"], 1.09)
        self.assertEqual(sent["tp"], 1.08)
        self.assertEqual(sent["volume"], 0.2)

    def test_agent_rejects_order_without_bracket(self):
        """Le terminal refuse aussi : double barrière (agent + connecteur)."""
        with self.assertRaises(mt5_agent.TerminalError) as ctx:
            self.terminal.place_order({"symbol": "EURUSD", "side": "BUY", "qty": 0.1})
        self.assertEqual(ctx.exception.code, "MT5_MISSING_BRACKET")

    def test_order_status_unknown(self):
        connector = self.connector()
        connector.connect()
        with self.assertRaises(UnknownOrderState):
            connector.order_status("999999")

    def test_timeout_maps_to_unknown_state(self):
        def transport(method, url, payload, headers, timeout):
            raise TimeoutError("timed out")

        connector = Mt5BridgeConnector("http://127.0.0.1:9", "jeton", transport=transport,
                                       allow_orders=True)
        connector._connected = True
        with self.assertRaises(OrderTimeout):
            connector.place_order(OrderRequest(
                symbol="EURUSD", side="BUY", qty=Decimal("0.1"),
                stop_price=Decimal("1.08"), target_price=Decimal("1.09"),
                environment="DEMO"))

    def test_missing_platform_id_is_timeout(self):
        def transport(method, url, payload, headers, timeout):
            return 200, json.dumps({"state": "ACCEPTED"}).encode()

        connector = Mt5BridgeConnector("http://127.0.0.1:9", "jeton", transport=transport,
                                       allow_orders=True)
        connector._connected = True
        with self.assertRaises(OrderTimeout):
            connector.place_order(OrderRequest(
                symbol="EURUSD", side="BUY", qty=Decimal("0.1"),
                stop_price=Decimal("1.08"), target_price=Decimal("1.09"),
                environment="DEMO"))

    def test_cancel_and_modify(self):
        self.module.orders = [{"ticket": 4242, "symbol": "EURUSD.a", "type": 2,
                               "volume_current": 0.1, "price_open": 1.08}]
        connector = self.connector(allow_orders=True)
        connector.connect()
        self.assertTrue(connector.cancel_order("4242"))
        self.assertEqual(self.module.orders, [])
        self.assertTrue(connector.modify_order("777001", stop_price=Decimal("1.0810")))

    def test_symbol_resolution_reports_missing_instruments(self):
        connector = self.connector()
        connector.connect()
        report = connector.resolve_symbols(["EURUSD", "BTCUSDT", "SOLUSDT"])
        self.assertTrue(report["ok"])
        self.assertEqual(report["available_count"], 6)
        self.assertEqual([row["canonical"] for row in report["matched"]], ["EURUSD"])
        self.assertEqual(report["matched"][0]["platform"], "EURUSD.a")
        self.assertEqual(report["missing"], ["BTCUSDT", "SOLUSDT"])
        self.assertIn("EURUSD.A", report["available_sample"])
        self.assertEqual(len(report["available_sample"]), 6)

    def test_symbol_listing_requires_connection(self):
        connector = self.connector()
        with self.assertRaises(ConnectorUnavailable):
            connector.symbols()

    def test_symbol_map_translates_both_ways(self):
        # Nœud courtier sans suffixe (cas Deriv) : le mapping porte le renommage.
        terminal, module = make_terminal(suffix="")
        agent = AgentHarness(terminal)
        self.addCleanup(agent.close)
        connector = Mt5BridgeConnector(
            agent.url, agent.token, symbol_map={"EURUSD": "frxEURUSD"},
            allow_orders=True)
        connector.connect()
        quotes = connector.quotes(["EURUSD"])
        self.assertEqual([q["symbol"] for q in quotes], ["EURUSD"])
        self.assertEqual(float(quotes[0]["bid"]), 1.08501)
        ack = connector.place_order(OrderRequest(
            symbol="EURUSD", side="BUY", qty=Decimal("0.1"),
            stop_price=Decimal("1.0800"), target_price=Decimal("1.0900"),
            environment="DEMO"))
        self.assertTrue(ack.platform_order_id)
        self.assertEqual(module.calls[-1]["symbol"], "frxEURUSD")

    def test_symbol_map_takes_priority_over_suffix(self):
        connector = Mt5BridgeConnector(
            self.agent.url, self.agent.token, symbol_suffix=".a",
            symbol_map={"EURUSD": "frxEURUSD"})
        self.assertEqual(connector._symbol("EURUSD"), "frxEURUSD")
        self.assertEqual(connector._symbol("GBPUSD"), "GBPUSD.a")
        self.assertEqual(connector._strip_symbol("frxEURUSD"), "EURUSD")
        self.assertEqual(connector._strip_symbol("GBPUSD.a"), "GBPUSD")

    def test_to_dict_never_leaks_token(self):
        connector = self.connector()
        payload = json.dumps(connector.to_dict())
        self.assertNotIn(self.agent.token, payload)


class Mt5StoreTests(unittest.TestCase):
    def setUp(self):
        self.project = TempProject()
        self.addCleanup(self.project.cleanup)
        self.path = self.project.path / "var" / "mt5_connection.json"
        self.store = Mt5ConnectionStore(self.path)

    def test_defaults_are_disabled(self):
        public = self.store.public()
        self.assertFalse(public["enabled"])
        self.assertFalse(public["allow_demo_orders"])
        self.assertEqual(public["orders_notice"], "ordres désactivés (activation explicite requise)")

    def test_configure_persists_with_0600(self):
        import os

        self.store.configure({"bridge_url": "https://vps.exemple.fr:8787", "bridge_token": "x" * 32,
                              "broker": "Broker", "server": "Broker-Demo", "login": "5012345",
                              "symbol_suffix": ".a", "enabled": True})
        self.assertTrue(self.path.exists())
        self.assertEqual(oct(os.stat(self.path).st_mode)[-3:], "600")
        reloaded = Mt5ConnectionStore(self.path)
        self.assertTrue(reloaded.config["enabled"])
        self.assertNotIn("x" * 32, json.dumps(reloaded.public()))

    def test_validation(self):
        with self.assertRaises(ValueError):
            self.store.configure({"bridge_url": "vps.exemple.fr", "bridge_token": "x"})
        with self.assertRaises(ValueError):
            self.store.configure({"bridge_url": "https://vps.exemple.fr"})
        with self.assertRaises(ValueError):
            self.store.configure({"enabled": True})
        with self.assertRaises(ValueError):
            self.store.configure({"allow_demo_orders": True})

    def test_empty_secret_keeps_existing_token(self):
        self.store.configure({"bridge_url": "https://vps.exemple.fr", "bridge_token": "secret-token"})
        self.store.configure({"bridge_url": "https://vps.exemple.fr", "bridge_token": ""})
        self.assertTrue(self.store.config["bridge_token"])

    def test_disable_clears_order_permission(self):
        self.store.configure({"bridge_url": "https://vps.exemple.fr", "bridge_token": "jeton",
                              "enabled": True, "allow_demo_orders": True})
        public = self.store.disable()
        self.assertFalse(public["enabled"])
        self.assertFalse(public["allow_demo_orders"])

    def test_build_connector_and_test(self):
        terminal, _ = make_terminal()
        agent = AgentHarness(terminal)
        self.addCleanup(agent.close)
        self.store.configure({"bridge_url": agent.url, "bridge_token": agent.token,
                              "symbol_suffix": ".a", "enabled": True})
        result = self.store.test()
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["account"]["account_id"], "5012345")
        self.assertEqual(result["positions"], 1)
        self.assertEqual(result["account_kind"], "demo")
        self.assertFalse(result["orders_enabled"])
        self.assertTrue(result["symbols"]["ok"])
        self.assertNotIn("EURUSD", result["symbols"]["missing"])  # suffixe .a appliqué
        self.assertIn("BTCUSDT", result["symbols"]["missing"])
        self.assertEqual(result["symbols"]["available_count"], 6)
        self.assertTrue(self.store.config["last_test"]["ok"])

    def test_test_reports_failure(self):
        self.store.configure({"bridge_url": "http://127.0.0.1:1", "bridge_token": "jeton"})
        result = self.store.test()
        self.assertFalse(result["ok"])
        self.assertTrue(result["code"])

    def test_symbol_map_is_persisted_and_normalised(self):
        self.store.configure({"bridge_url": "https://vps.exemple.fr", "bridge_token": "jeton",
                              "symbol_map": {"eurusd": "frxEURUSD", " BTCUSDT ": "cryBTCUSD"}})
        self.assertEqual(self.store.config["symbol_map"],
                         {"EURUSD": "frxEURUSD", "BTCUSDT": "cryBTCUSD"})
        self.assertEqual(Mt5ConnectionStore(self.path).public()["symbol_map"]["EURUSD"],
                         "frxEURUSD")

    def test_symbol_map_accepts_json_string(self):
        self.store.configure({"bridge_url": "https://vps.exemple.fr", "bridge_token": "jeton",
                              "symbol_map": '{"EURUSD": "frxEURUSD"}'})
        self.assertEqual(self.store.config["symbol_map"], {"EURUSD": "frxEURUSD"})

    def test_symbol_map_validation(self):
        for invalid in ("pas du json", [], {"": "x"}, {"EURUSD": ""}, {str(i): "x" for i in range(70)}):
            with self.assertRaises(ValueError):
                self.store.configure({"symbol_map": invalid})

    def test_test_without_config(self):
        result = self.store.test()
        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], "MT5_BRIDGE_MISSING")


class Mt5ApiTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.token = self.login()
        self.terminal, self.module = make_terminal()
        self.agent = AgentHarness(self.terminal)
        self.addCleanup(self.agent.close)

    def test_symbol_map_roundtrip_through_api(self):
        status, body = self.post("/api/connections/mt5", {
            "bridge_url": self.agent.url, "bridge_token": self.agent.token,
            "symbol_map": {"EURUSD": "frxEURUSD"}, "enabled": True}, self.token)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["mt5"]["symbol_map"], {"EURUSD": "frxEURUSD"})
        self.assertNotIn(self.agent.token, json.dumps(body))

    def test_connections_overview(self):
        status, body = self.get("/api/connections", self.token)
        self.assertEqual(status, 200, body)
        self.assertTrue(body["simulation"]["active"])
        self.assertTrue(body["simulation"]["available"])
        self.assertFalse(body["mt5"]["enabled"])
        self.assertFalse(body["crypto"]["available"])

    def test_admin_configures_tests_and_disables(self):
        status, body = self.post("/api/connections/mt5", {
            "bridge_url": self.agent.url, "bridge_token": self.agent.token,
            "broker": "BrokerDemo", "login": "5012345", "symbol_suffix": ".a",
            "enabled": True}, self.token)
        self.assertEqual(status, 200, body)
        self.assertTrue(body["mt5"]["enabled"])
        self.assertTrue(body["restart_required"])
        self.assertNotIn(self.agent.token, json.dumps(body))

        status, body = self.post("/api/connections/mt5/test", {}, self.token)
        self.assertEqual(status, 200, body)
        self.assertTrue(body["result"]["ok"], body)

        status, body = self.post("/api/connections/mt5/disable", {}, self.token)
        self.assertEqual(status, 200)
        self.assertFalse(body["mt5"]["enabled"])

    def test_test_uses_submitted_values_without_saving(self):
        status, body = self.post("/api/connections/mt5/test", {
            "bridge_url": self.agent.url, "bridge_token": self.agent.token,
            "symbol_suffix": ".a"}, self.token)
        self.assertEqual(status, 200, body)
        self.assertTrue(body["result"]["ok"], body)
        self.assertFalse(self.engine.mt5.config["enabled"])
        self.assertFalse(self.engine.mt5.config["bridge_url"])

    def test_invalid_configuration(self):
        status, body = self.post("/api/connections/mt5", {"bridge_url": "nope",
                                                          "bridge_token": "abc"}, self.token)
        self.assertEqual(status, 400)
        self.assertEqual(body["code"], "MT5_CONFIG_INVALID")

    def test_viewer_cannot_touch_connections(self):
        self.engine.users.create("lecteur-mt5", "Lecteur!Password2026", "VIEWER")
        token, _ = self.engine.sessions.create(self.engine.users.get("lecteur-mt5"),
                                               ip="127.0.0.1")
        status, _ = self.get("/api/connections", token)
        self.assertEqual(status, 403)
        status, _ = self.post("/api/connections/mt5/test", {}, token)
        self.assertEqual(status, 403)

    def test_ugly_agent_payload_stays_auditable(self):
        status, body = self.post("/api/connections/mt5", {
            "bridge_url": self.agent.url, "bridge_token": "y" * 20, "enabled": True},
            self.token)
        self.assertEqual(status, 200)
        blob = json.dumps(self.engine.audit.tail(limit=5))
        self.assertIn("mt5.configure", blob)
        self.assertNotIn("y" * 20, blob)


if __name__ == "__main__":
    unittest.main()


class EngineBridgeTests(unittest.TestCase):
    """Le moteur bascule sur le pont quand l'exploitant l'a activé."""

    def setUp(self):
        self.project = TempProject()
        self.addCleanup(self.project.cleanup)
        self.terminal, self.module = make_terminal()
        self.module._positions = []
        self.agent = AgentHarness(self.terminal)
        self.addCleanup(self.agent.close)

    def store(self, engine):
        return engine.mt5

    def build_engine(self, enabled=True, allow_orders=False, url=None, token=None):
        from carnet.engine import TradingEngine

        settings = self.project.settings(simulation_24_7=True)
        path = settings.var_dir / "mt5_connection.json"
        path.write_text(json.dumps({
            "enabled": enabled, "bridge_url": url or self.agent.url,
            "bridge_token": token or self.agent.token, "broker": "BrokerDemo",
            "server": "Broker-Demo", "login": "5012345", "symbol_suffix": ".a",
            "allow_demo_orders": allow_orders,
        }), encoding="utf-8")
        path.chmod(0o600)
        engine = TradingEngine(settings)
        self.addCleanup(engine.shutdown)
        return engine

    def test_engine_uses_bridge_quotes(self):
        engine = self.build_engine()
        self.assertTrue(engine.uses_bridge)
        engine.bootstrap()
        self.assertTrue(engine.connector.is_connected())
        self.assertTrue(engine.entries_enabled)
        result = engine.run_once(force_scan=True)
        self.assertIsInstance(result, dict)
        quote = engine.market.quote("EURUSD")
        self.assertIsNotNone(quote)
        self.assertEqual(quote.source, "mt5")
        self.assertEqual(float(quote.ask), 1.08519)
        snapshot = engine.snapshot()
        self.assertTrue(snapshot["mt5_connection"]["enabled"])
        self.assertFalse(snapshot["mt5_connection"]["allow_demo_orders"])

    def test_engine_stays_up_when_bridge_is_down(self):
        engine = self.build_engine(url="http://127.0.0.1:1")
        engine.bootstrap()
        self.assertTrue(engine.uses_bridge)
        self.assertFalse(engine.connector.is_connected())
        self.assertFalse(engine.entries_enabled)
        engine.run_once(force_scan=True)  # ne lève pas : aucune cotation
        self.assertEqual(engine.journal.count("CRITICAL") >= 1, True)

    def test_simulation_remains_default(self):
        from carnet.engine import TradingEngine

        settings = self.project.settings()
        engine = TradingEngine(settings)
        self.addCleanup(engine.shutdown)
        engine.bootstrap()
        self.assertFalse(engine.uses_bridge)
        self.assertEqual(engine.connector.kind, "simulation")
        self.assertTrue(engine.entries_enabled)

    def test_orders_remain_locked_without_explicit_enablement(self):
        engine = self.build_engine(allow_orders=False)
        engine.bootstrap()
        request = OrderRequest(
            symbol="EURUSD", side="BUY", qty=Decimal("0.1"),
            stop_price=Decimal("1.0801"), target_price=Decimal("1.0901"),
            environment="DEMO")
        with self.assertRaises(ConnectorUnavailable):
            engine.connector.place_order(request)


class SymbolSelectionTests(unittest.TestCase):
    """CARNET_SYMBOLS restreint les instruments suivis au sous-ensemble du courtier."""

    def test_default_is_all_instruments(self):
        from carnet import config

        with unittest.mock.patch.dict("os.environ", {}, clear=False):
            import os
            os.environ.pop("CARNET_SYMBOLS", None)
            self.assertEqual(config._symbols_from_env(), tuple(config.SYMBOLS))

    def test_subset_is_validated_and_deduplicated(self):
        from carnet import config

        with unittest.mock.patch.dict("os.environ", {"CARNET_SYMBOLS": "eurusd, BTCUSDT;EURUSD"}):
            self.assertEqual(config._symbols_from_env(), ("EURUSD", "BTCUSDT"))

    def test_unknown_instrument_is_rejected(self):
        from carnet import config

        with unittest.mock.patch.dict("os.environ", {"CARNET_SYMBOLS": "EURUSD,DOGEUSDT"}):
            with self.assertRaises(ValueError) as ctx:
                config._symbols_from_env()
        self.assertIn("DOGEUSDT", str(ctx.exception))

    def test_empty_value_is_rejected(self):
        from carnet import config

        with unittest.mock.patch.dict("os.environ", {"CARNET_SYMBOLS": " , "}):
            with self.assertRaises(ValueError):
                config._symbols_from_env()


class SnapshotHygieneTests(unittest.TestCase):
    """L'instantané d'état, lisible par tout compte, ne divulgue aucun secret."""

    def test_bridge_descriptor_has_no_url_or_token(self):
        connector = Mt5BridgeConnector("https://vps.exemple.fr:8787",
                                       "jeton-tres-secret-0123456789",
                                       login="5012345")
        payload = json.dumps(connector.to_dict())
        self.assertNotIn("jeton-tres-secret", payload)
        self.assertNotIn("vps.exemple.fr", payload)
        self.assertTrue(json.loads(payload)["bridge_configured"])
