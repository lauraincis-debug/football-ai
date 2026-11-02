"""Connecteurs de plateformes (MT5, crypto spot) avec plateformes factices.

Aucun appel réseau réel : les transports et modules sont simulés. Ces tests
prouvent que les connecteurs lisent correctement les réponses attendues et
qu'ils refusent toute capacité dangereuse (retrait, futures, ordre réel).
"""

from __future__ import annotations

import datetime as dt
import unittest
from decimal import Decimal

from helpers import TempProject

from carnet.connectors.base import OrderRequest, RealTradingForbidden
from carnet.connectors.crypto import CryptoSpotConnector
from carnet.connectors.mt5 import Mt5Connector
from carnet.server import build_parser
from carnet.util import D, now_utc


class FakeMt5Module:
    """Module MetaTrader5 minimal, structure des réponses officielles."""

    def __init__(self, connected: bool = True):
        self.connected = connected
        self.shutdown_called = False
        self.orders: list[dict] = []

    def initialize(self, **kwargs):
        self.init_kwargs = kwargs
        return self.connected

    def shutdown(self):
        self.shutdown_called = True
        return True

    def last_error(self):
        return (0, "ok")

    def account_info(self):
        return {"login": 12345678, "currency": "EUR", "balance": 5000.0, "equity": 5100.0,
                "margin_free": 4900.0, "margin": 200.0, "leverage": 30}

    def positions_get(self):
        return [
            {"ticket": 111, "symbol": "EURUSD", "type": 0, "volume": 0.10,
             "price_open": 1.0875, "sl": 1.0825, "tp": 1.0975, "profit": 12.5,
             "time": now_utc() - dt.timedelta(hours=2), "comment": "ema_trend"},
            {"ticket": 112, "symbol": "XAUUSD", "type": 1, "volume": 0.02,
             "price_open": 2400.0, "sl": 0.0, "tp": 0.0, "profit": -4.0,
             "time": now_utc() - dt.timedelta(minutes=30), "comment": ""},
        ]

    def orders_get(self):
        return [{"ticket": 222, "symbol": "EURUSD", "type": 2, "volume": 0.05,
                 "price_open": 1.0800}]

    def history_deals_get(self, start, end):
        return [{"ticket": 333, "profit": 25.0, "symbol": "EURUSD"}]


class Mt5PlatformTests(unittest.TestCase):
    def make(self, **overrides):
        module = overrides.pop("module", FakeMt5Module())
        connector = Mt5Connector(login=12345678, password="secret", server="Broker-Demo",
                                 module=module, **overrides)
        connector.connect()
        return connector, module

    def test_connection_and_health(self):
        connector, module = self.make()
        self.assertTrue(connector.is_connected())
        self.assertEqual(module.init_kwargs["login"], 12345678)
        health = connector.health()
        self.assertTrue(health["connected"])
        self.assertTrue(health["credentials"])
        self.assertEqual(connector.verify_key_permissions()["withdraw_enabled"], None)

    def test_failed_initialisation(self):
        connector = Mt5Connector(login=1, password="x", server="s",
                                 module=FakeMt5Module(connected=False))
        with self.assertRaises(Exception):
            connector.connect()

    def test_account_positions_and_orders(self):
        connector, _ = self.make()
        account = connector.account()
        self.assertEqual(account.currency, "EUR")
        self.assertEqual(account.balance, Decimal("5000.0"))
        self.assertIsNotNone(account.margin_level)

        positions = connector.positions()
        self.assertEqual(len(positions), 2)
        self.assertEqual(positions[0].side, "BUY")
        self.assertEqual(positions[1].side, "SELL")
        self.assertIsNone(positions[1].stop_price)
        self.assertEqual(positions[0].strategy, "ema_trend")

        orders = connector.open_orders()
        self.assertEqual(len(orders), 1)
        self.assertEqual(orders[0].platform_order_id, "222")

        self.assertEqual(len(connector.history()), 1)

    def test_orders_are_refused_until_broker_selection(self):
        connector, _ = self.make()
        request = OrderRequest(symbol="EURUSD", side="BUY", qty=D("0.1"), environment="DEMO")
        with self.assertRaises(Exception) as context:
            connector.place_order(request)
        self.assertEqual(context.exception.code, "MT5_ORDER_NOT_ENABLED")
        with self.assertRaises(Exception):
            connector.cancel_order("222")
        with self.assertRaises(Exception):
            connector.order_status("222")

    def test_real_account_requires_explicit_permission(self):
        with self.assertRaises(RealTradingForbidden):
            Mt5Connector(login=1, password="x", server="Broker-Real",
                         environment="REAL_MANUAL", module=FakeMt5Module()).connect()

    def test_disconnect_calls_shutdown(self):
        connector, module = self.make()
        connector.disconnect()
        self.assertTrue(module.shutdown_called)
        self.assertFalse(connector.is_connected())


class FakeTransport:
    """Transport HTTP factice : réponses par chemin, journal des appels."""

    def __init__(self):
        self.calls: list[tuple[str, str, dict, dict]] = []

    def __call__(self, method, url, params, headers):
        self.calls.append((method, url, params, headers))
        path = url.split("api.example.com")[-1]
        if path.startswith("/sapi/v1/account/apiRestrictions"):
            return {"enableWithdrawals": False, "enableSpotAndMarginTrading": True,
                    "ipRestrict": True}
        if path.startswith("/api/v3/account"):
            return {"accountType": "SPOT",
                    "balances": [{"asset": "USDT", "free": "1500.5", "locked": "0"},
                                 {"asset": "BTC", "free": "0.02", "locked": "0"}]}
        if path.startswith("/api/v3/openOrders"):
            return [{"orderId": 987, "symbol": "BTCUSDT", "side": "BUY", "origQty": "0.001",
                     "executedQty": "0", "type": "LIMIT", "price": "60000",
                     "status": "NEW", "clientOrderId": "cdt-1"}]
        if path.startswith("/api/v3/myTrades"):
            return [{"id": 1, "symbol": "BTCUSDT", "qty": "0.001", "price": "60000"}]
        if path.startswith("/api/v3/order") and method == "POST":
            return {"orderId": 4444, "status": "FILLED"}
        if path.startswith("/api/v3/order"):
            return {"orderId": 4444, "status": "FILLED", "executedQty": "0.001",
                    "cummulativeQuoteQty": "60.0"}
        if path.startswith("/api/v3/klines"):
            return [[1700000000000, "60000", "61000", "59000", "60500", "1.2"]]
        return {}


class CryptoPlatformTests(unittest.TestCase):
    def make(self, **overrides):
        transport = overrides.pop("transport", FakeTransport())
        connector = CryptoSpotConnector(base_url="https://api.example.com", api_key="key",
                                        api_secret="secret", transport=transport, **overrides)
        connector.connect()
        return connector, transport

    def test_permissions_are_checked_at_connection(self):
        connector, transport = self.make()
        self.assertTrue(connector.is_connected())
        self.assertFalse(connector.key_permissions["withdraw_enabled"])
        self.assertTrue(any("apiRestrictions" in call[1] for call in transport.calls))
        self.assertEqual(transport.calls[0][3]["X-MBX-APIKEY"], "key")

    def test_account_reads_balances(self):
        connector, _ = self.make()
        account = connector.account()
        self.assertEqual(account.currency, "USDT")
        self.assertEqual(account.balance, Decimal("1500.5"))
        self.assertEqual(account.leverage, 1)
        self.assertEqual(connector.positions(), [])

    def test_open_orders_and_history(self):
        connector, _ = self.make()
        orders = connector.open_orders()
        self.assertEqual(len(orders), 1)
        self.assertEqual(orders[0].platform_order_id, "987")
        self.assertEqual(orders[0].state, "NEW")
        self.assertEqual(len(connector.history()), 1)

    def test_orders_refused_without_sandbox_validation(self):
        connector, _ = self.make()
        with self.assertRaises(Exception) as context:
            connector.place_order(OrderRequest(symbol="BTCUSDT", side="BUY", qty=D("0.001"),
                                               environment="DEMO"))
        self.assertEqual(context.exception.code, "CRYPTO_ORDER_NOT_ENABLED")

    def test_sandbox_order_with_explicit_permission(self):
        connector, transport = self.make(allow_real=True)
        ack = connector.place_order(OrderRequest(symbol="BTCUSDT", side="BUY", qty=D("0.001"),
                                                 environment="DEMO"))
        self.assertEqual(ack.platform_order_id, "4444")
        status = connector.order_status("4444")
        self.assertEqual(status.state, "FILLED")
        self.assertEqual(status.avg_price, Decimal("60000.000"))
        self.assertTrue(connector.cancel_order("4444"))

    def test_real_environment_requires_permission(self):
        with self.assertRaises(RealTradingForbidden):
            CryptoSpotConnector(base_url="https://api.example.com", api_key="k",
                                api_secret="s", environment="REAL_AUTO",
                                transport=FakeTransport()).connect()

    def test_health_reports_permissions(self):
        connector, _ = self.make()
        health = connector.health()
        self.assertTrue(health["configured"])
        self.assertTrue(health["permissions"]["checked"])


class ServerEntryPointTests(unittest.TestCase):
    def test_parser_defaults_and_options(self):
        parser = build_parser()
        args = parser.parse_args([])
        self.assertIsNone(args.port)
        self.assertFalse(args.no_engine_thread)
        args = parser.parse_args(["--port", "9090", "--no-engine-thread",
                                  "--no-backup-thread", "--env", "DEMO"])
        self.assertEqual(args.port, 9090)
        self.assertTrue(args.no_engine_thread)
        self.assertTrue(args.no_backup_thread)
        self.assertEqual(args.env, "DEMO")


if __name__ == "__main__":
    unittest.main()
