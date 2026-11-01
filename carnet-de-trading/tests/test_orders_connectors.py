"""Tests du gestionnaire d'ordres, des connecteurs et de la réconciliation."""

from __future__ import annotations

import dataclasses
import datetime as dt
import unittest
from decimal import Decimal

from helpers import EngineTestCase, TempProject

from carnet.connectors.base import (
    ConnectorError,
    ConnectorUnavailable,
    UnknownOrderState,
    OrderRejected,
    OrderTimeout,
    RealTradingForbidden,
)
from carnet.connectors.crypto import CryptoSpotConnector
from carnet.connectors.mt5 import Mt5Connector
from carnet.connectors.simulation import SimulationConnector, notional_value, unit_value
from carnet.db import Database
from carnet.journal import Journal, Notifications
from carnet.orders import ALLOWED_TRANSITIONS, OrderManager, StateTransitionError
from carnet.reconcile import Reconciler
from carnet.util import D, now_utc


class ConnectorTestBase(EngineTestCase):
    def setUp(self):
        super().setUp()
        self.monday = dt.datetime(2026, 11, 9, 14, 0, tzinfo=dt.timezone.utc)
        for symbol in ("EURUSD", "BTCUSDT", "GBPUSD"):
            quote = self.engine.simulator.tick(symbol, self.monday, force=True)
            if quote:
                self.engine.market.update_quote(quote)
        self.engine.connector.pump(self.engine.market.quotes())


class SimulationConnectorTests(ConnectorTestBase):
    def test_account_and_marks(self):
        account = self.engine.connector.account()
        self.assertEqual(account.currency, "USD")
        self.assertEqual(account.equity, Decimal("10000"))
        self.assertEqual(account.leverage, 30)

    def test_market_order_creates_position_and_fills(self):
        connector = self.engine.connector
        quote = self.engine.market.quote("EURUSD")
        request = self._request("EURUSD", "BUY", "0.10", quote.mid, "1.0800", "1.1000")
        ack = connector.place_order(request)
        self.assertIn(ack.state, ("FILLED", "PARTIALLY_FILLED"))
        positions = connector.positions()
        self.assertEqual(len(positions), 1)
        self.assertEqual(positions[0].symbol, "EURUSD")
        self.assertIsNotNone(positions[0].stop_price)
        events = connector.pump({"EURUSD": quote})
        self.assertTrue(any(event["type"] == "FILL" for event in events))
        self.assertTrue(any(event["type"] == "POSITION_OPENED" for event in events))

    def test_qty_below_minimum_is_rejected(self):
        with self.assertRaises(OrderRejected):
            self.engine.connector.place_order(
                self._request("EURUSD", "BUY", "0.001", Decimal("1.0875"), "1.0800", "1.1000"))

    def test_invalid_stop_side_is_rejected(self):
        with self.assertRaises(OrderRejected):
            self.engine.connector.place_order(
                self._request("EURUSD", "BUY", "0.10", Decimal("1.0875"), "1.0900", "1.1000"))

    def test_duplicate_client_order_is_not_executed_twice(self):
        connector = self.engine.connector
        request = self._request("EURUSD", "BUY", "0.10", Decimal("1.0875"), "1.0800", "1.1000")
        first = connector.place_order(request)
        second = connector.place_order(request)
        self.assertEqual(first.platform_order_id, second.platform_order_id)
        self.assertEqual(len(connector.positions()), 1)
        self.assertEqual(len(connector.open_orders()), 0)

    def test_partial_fill_then_completion(self):
        connector = self.engine.connector
        connector.request_partial_fill(Decimal("0.4"))
        ack = connector.place_order(
            self._request("EURUSD", "BUY", "0.10", Decimal("1.0875"), "1.0800", "1.1000"))
        self.assertEqual(ack.state, "PARTIALLY_FILLED")
        status = connector.order_status(ack.platform_order_id)
        self.assertLess(status.filled_qty, Decimal("0.10"))
        connector.pump(self.engine.market.quotes())
        connector.pump(self.engine.market.quotes())
        status = connector.order_status(ack.platform_order_id)
        self.assertEqual(status.state, "FILLED")
        self.assertAlmostEqual(float(status.filled_qty), 0.10, places=6)

    def test_stop_loss_closes_position(self):
        connector = self.engine.connector
        quote = self.engine.market.quote("EURUSD")
        entry = quote.mid
        connector.place_order(self._request("EURUSD", "BUY", "0.10", entry,
                                            str(entry - Decimal("0.0050")),
                                            str(entry + Decimal("0.0100"))))
        connector.pump({"EURUSD": quote})
        crash = dataclasses.replace(self.engine.market.quote("EURUSD"),
                                    bid=entry - Decimal("0.02"), ask=entry - Decimal("0.0199"),
                                    last=entry - Decimal("0.02"), timestamp=now_utc(),
                                    received_at=now_utc())
        events = connector.pump({"EURUSD": crash})
        closed = [event for event in events if event["type"] == "POSITION_CLOSED"]
        self.assertEqual(len(closed), 1)
        self.assertEqual(closed[0]["reason"], "STOP_LOSS")
        self.assertEqual(len(connector.positions()), 0)

    def test_take_profit_closes_position(self):
        connector = self.engine.connector
        quote = self.engine.market.quote("EURUSD")
        entry = quote.mid
        connector.place_order(self._request("EURUSD", "BUY", "0.10", entry,
                                            str(entry - Decimal("0.0050")),
                                            str(entry + Decimal("0.0100"))))
        connector.pump({"EURUSD": quote})
        rally = dataclasses.replace(quote, bid=entry + Decimal("0.02"),
                                    ask=entry + Decimal("0.0201"), last=entry + Decimal("0.02"),
                                    timestamp=now_utc(), received_at=now_utc())
        events = connector.pump({"EURUSD": rally})
        closed = [event for event in events if event["type"] == "POSITION_CLOSED"]
        self.assertEqual(len(closed), 1)
        self.assertEqual(closed[0]["reason"], "TAKE_PROFIT")
        self.assertGreater(float(closed[0]["realized_pnl"]), 0)

    def test_force_close_all(self):
        connector = self.engine.connector
        quote = self.engine.market.quote("EURUSD")
        connector.place_order(self._request("EURUSD", "BUY", "0.10", quote.mid,
                                            str(quote.mid - Decimal("0.005")),
                                            str(quote.mid + Decimal("0.01"))))
        connector.pump({"EURUSD": quote})
        closed = connector.force_close_all()
        self.assertEqual(len(closed), 1)
        self.assertEqual(connector.positions(), [])

    def test_state_survives_export_import(self):
        connector = self.engine.connector
        quote = self.engine.market.quote("EURUSD")
        connector.place_order(self._request("EURUSD", "BUY", "0.10", quote.mid,
                                            str(quote.mid - Decimal("0.005")),
                                            str(quote.mid + Decimal("0.01"))))
        connector.pump({"EURUSD": quote})
        payload = connector.export_state()
        clone = SimulationConnector(state_path=None)
        self.assertTrue(clone.import_state(payload))
        self.assertEqual(len(clone.positions()), 1)
        self.assertEqual(clone.balance, connector.balance)

    def test_real_environment_is_refused(self):
        request = self._request("EURUSD", "BUY", "0.10", Decimal("1.0875"), "1.0800", "1.1000")
        request.environment = "REAL_AUTO"
        with self.assertRaises(RealTradingForbidden):
            self.engine.connector.place_order(request)

    def test_helpers(self):
        self.assertEqual(unit_value("EURUSD"), Decimal("100000"))
        self.assertEqual(notional_value("EURUSD", D("0.1"), D("1.1")), Decimal("11000.000"))

    def _request(self, symbol, side, qty, entry, stop, target):
        from carnet.connectors.base import OrderRequest

        return OrderRequest(symbol=symbol, side=side, qty=D(qty), stop_price=D(stop),
                            target_price=D(target), reference_price=D(entry),
                            environment="SIMULATION", strategy="test")


class TimeoutConnector(SimulationConnector):
    """Connecteur dont le premier envoi dépasse le délai (scénario 21.1)."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fail_next = True

    def place_order(self, request):  # noqa: D401
        if self.fail_next:
            self.fail_next = False
            raise OrderTimeout("délai dépassé (test)")
        return super().place_order(request)


class OrderManagerTests(ConnectorTestBase):
    def setUp(self):
        super().setUp()
        self.project = TempProject()
        self.addCleanup(self.project.cleanup)
        self.db = Database(self.project.path / "orders.sqlite3")
        self.db.migrate()
        self.journal = Journal(self.db)
        self.notifications = Notifications(self.db, self.journal)

    def make_manager(self, connector=None):
        connector = connector or self.engine.connector
        return OrderManager(self.db, connector, self.journal, self.notifications)

    def test_full_lifecycle(self):
        manager = self.make_manager()
        order = manager.submit(symbol="EURUSD", side="BUY", qty=D("0.10"),
                               stop=D("1.0800"), target=D("1.1000"), entry=D("1.0875"),
                               environment="SIMULATION", strategy="test")
        self.assertEqual(order["state"], "FILLED")
        self.assertEqual(len(order["events"]), 3)  # CREATED, SUBMITTED, FILLED
        manager.apply_events(self.engine.connector.pump(self.engine.market.quotes()))
        positions = manager.open_positions()
        self.assertEqual(len(positions), 1)
        self.assertTrue(positions[0]["protection_ok"])

    def test_signal_deduplication(self):
        manager = self.make_manager()
        first = manager.submit(symbol="EURUSD", side="BUY", qty=D("0.10"), stop=D("1.0800"),
                               target=D("1.1000"), entry=D("1.0875"),
                               environment="SIMULATION", signal_id="sig-1")
        second = manager.submit(symbol="EURUSD", side="BUY", qty=D("0.10"), stop=D("1.0800"),
                                target=D("1.1000"), entry=D("1.0875"),
                                environment="SIMULATION", signal_id="sig-1")
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(manager.recent_orders()), 1)

    def test_timeout_leads_to_unknown_then_rejected_without_platform_id(self):
        connector = TimeoutConnector()
        connector.connect()
        manager = self.make_manager(connector)
        order = manager.submit(symbol="EURUSD", side="BUY", qty=D("0.10"), stop=D("1.0800"),
                               target=D("1.1000"), entry=D("1.0875"), environment="SIMULATION")
        self.assertEqual(order["state"], "UNKNOWN")
        resolved = manager.resolve_unknown(connector)
        self.assertEqual(resolved[0]["state"], "REJECTED")

    def test_invalid_transition_is_refused(self):
        manager = self.make_manager()
        order = manager.submit(symbol="EURUSD", side="BUY", qty=D("0.10"), stop=D("1.0800"),
                               target=D("1.1000"), entry=D("1.0875"), environment="SIMULATION")
        with self.assertRaises(StateTransitionError):
            manager._transition(order["id"], "FILLED", "SUBMITTED", "retour arrière interdit")

    def test_all_states_are_declared(self):
        from carnet.config import ORDER_STATES

        self.assertEqual(set(ORDER_STATES), set(ALLOWED_TRANSITIONS))

    def test_cancel_pending_orders(self):
        connector = self.engine.connector
        manager = self.make_manager(connector)
        from carnet.connectors.base import OrderRequest

        quote = self.engine.market.quote("EURUSD")
        ack = connector.place_order(OrderRequest(
            symbol="EURUSD", side="BUY", qty=D("0.10"), order_type="LIMIT",
            limit_price=quote.mid - Decimal("0.01"), stop_price=quote.mid - Decimal("0.02"),
            target_price=quote.mid + Decimal("0.02"), environment="SIMULATION"))
        order_id = manager.submit(symbol="EURUSD", side="BUY", qty=D("0.10"), stop=D("1.0800"),
                                  target=D("1.1000"), entry=D("1.0875"), environment="SIMULATION")["id"]
        self.assertTrue(order_id)
        cancelled = manager.cancel_pending_entries()
        self.assertIsInstance(cancelled, list)
        self.assertTrue(ack.platform_order_id)

    def test_totals_and_metrics(self):
        manager = self.make_manager()
        manager.submit(symbol="EURUSD", side="BUY", qty=D("0.10"), stop=D("1.0800"),
                       target=D("1.1000"), entry=D("1.0875"), environment="SIMULATION")
        manager.apply_events(self.engine.connector.pump(self.engine.market.quotes()))
        totals = manager.totals()
        self.assertEqual(totals["open_positions"], 1)
        self.assertEqual(totals["closed_positions"], 0)


class Mt5ConnectorTests(unittest.TestCase):
    def test_missing_credentials(self):
        connector = Mt5Connector()
        with self.assertRaises(ConnectorUnavailable) as context:
            connector.connect()
        self.assertEqual(context.exception.code, "MT5_CREDENTIALS_MISSING")

    def test_missing_library(self):
        connector = Mt5Connector(login=1, password="x", server="demo", module=None)
        connector._module = None
        with self.assertRaises(ConnectorUnavailable):
            connector.connect()

    def test_connect_with_stub_module_and_refuse_orders(self):
        class StubModule:
            @staticmethod
            def initialize(**kwargs):
                return True

            @staticmethod
            def shutdown():
                return True

        connector = Mt5Connector(login=1, password="x", server="demo", module=StubModule())
        connector.connect()
        self.assertTrue(connector.is_connected())
        with self.assertRaises(ConnectorUnavailable) as context:
            connector.place_order(self._request())
        self.assertEqual(context.exception.code, "MT5_ORDER_NOT_ENABLED")
        self.assertIn("withdraw_enabled", connector.verify_key_permissions())

    def test_real_environment_requires_allow_real(self):
        connector = Mt5Connector(login=1, password="x", server="real", environment="REAL_AUTO")
        with self.assertRaises(RealTradingForbidden):
            connector.connect()

    def _request(self):
        from carnet.connectors.base import OrderRequest

        return OrderRequest(symbol="EURUSD", side="BUY", qty=D("0.1"), environment="DEMO")


class CryptoConnectorTests(unittest.TestCase):
    def _transport(self, payload):
        def transport(method, url, params, headers):
            return payload

        return transport

    def test_not_configured(self):
        connector = CryptoSpotConnector()
        with self.assertRaises(ConnectorUnavailable):
            connector.connect()

    def test_withdraw_permission_blocks_connection(self):
        connector = CryptoSpotConnector(
            base_url="https://api.example.com", api_key="key", api_secret="secret",
            transport=self._transport({"enableWithdrawals": True, "enableSpotAndMarginTrading": True}))
        with self.assertRaises(ConnectorUnavailable) as context:
            connector.connect()
        self.assertEqual(context.exception.code, "API_KEY_WITHDRAW_FORBIDDEN")

    def test_futures_permission_blocks_connection(self):
        connector = CryptoSpotConnector(
            base_url="https://api.example.com", api_key="key", api_secret="secret",
            transport=self._transport({"enableWithdrawals": False, "enableFutures": True}))
        with self.assertRaises(ConnectorUnavailable):
            connector.connect()

    def test_permissions_ok_and_orders_refused(self):
        connector = CryptoSpotConnector(
            base_url="https://api.example.com", api_key="key", api_secret="secret",
            transport=self._transport({"enableWithdrawals": False, "enableSpotAndMarginTrading": True}))
        connector.connect()
        self.assertTrue(connector.is_connected())
        self.assertFalse(connector.key_permissions["withdraw_enabled"])
        from carnet.connectors.base import OrderRequest

        with self.assertRaises(ConnectorUnavailable):
            connector.place_order(OrderRequest(symbol="BTCUSDT", side="BUY", qty=D("0.01"),
                                               environment="DEMO"))

    def test_signature_is_deterministic(self):
        connector = CryptoSpotConnector(base_url="https://x", api_key="k", api_secret="s")
        self.assertEqual(connector._sign("a=1&b=2"), connector._sign("a=1&b=2"))
        self.assertNotEqual(connector._sign("a=1"), connector._sign("a=2"))


class ReconcilerTests(ConnectorTestBase):
    def test_clean_reconciliation(self):
        reconciler = Reconciler(self.engine.db, self.engine.connector, self.engine.journal,
                                self.engine.notifications)
        result = reconciler.run("test")
        self.assertEqual(result["status"], "OK")
        self.assertTrue(reconciler.history())

    def test_local_position_missing_on_platform_is_closed(self):
        connector = self.engine.connector
        quote = self.engine.market.quote("EURUSD")
        from carnet.connectors.base import OrderRequest

        connector.place_order(OrderRequest(
            symbol="EURUSD", side="BUY", qty=D("0.10"), stop_price=quote.mid - Decimal("0.005"),
            target_price=quote.mid + Decimal("0.01"), reference_price=quote.mid,
            environment="SIMULATION"))
        self.engine.orders.apply_events(connector.pump({"EURUSD": quote}))
        self.assertEqual(len(self.engine.orders.open_positions()), 1)
        # La plateforme ne connaît plus la position (simulation d'une clôture manuelle).
        connector.force_close_all("MANUAL_ON_PLATFORM")
        reconciler = Reconciler(self.engine.db, connector, self.engine.journal,
                                self.engine.notifications)
        result = reconciler.run("test-divergence")
        self.assertEqual(result["status"], "DIVERGENCE")
        self.assertEqual(len(self.engine.orders.open_positions()), 0)
        closed = self.engine.orders.closed_positions()
        self.assertEqual(closed[0]["close_reason"], "RECONCILED_ABSENT")

    def test_unknown_platform_position_is_flagged_orphan(self):
        connector = self.engine.connector
        quote = self.engine.market.quote("EURUSD")
        from carnet.connectors.base import OrderRequest

        connector.place_order(OrderRequest(symbol="EURUSD", side="BUY", qty=D("0.10"),
                                           stop_price=quote.mid - Decimal("0.005"),
                                           target_price=quote.mid + Decimal("0.01"),
                                           reference_price=quote.mid, environment="SIMULATION"))
        connector.pump({"EURUSD": quote})
        reconciler = Reconciler(self.engine.db, connector, self.engine.journal,
                                self.engine.notifications)
        result = reconciler.run("test-orphan")
        self.assertEqual(result["status"], "DIVERGENCE")
        rows = self.engine.db.query("SELECT status FROM positions WHERE status='ORPHAN'")
        self.assertEqual(len(rows), 1)


if __name__ == "__main__":
    unittest.main()


class UnknownStateConnector(SimulationConnector):
    """Connecteur qui ne sait plus répondre sur un ordre (scénario 21.1)."""

    def order_status(self, platform_order_id):
        raise UnknownOrderState("statut introuvable")


class OrderEdgeTests(ConnectorTestBase):
    def setUp(self):
        super().setUp()
        from carnet.db import Database
        from carnet.journal import Journal, Notifications
        from carnet.orders import OrderManager

        self.project = TempProject()
        self.addCleanup(self.project.cleanup)
        self.db = Database(self.project.path / "orders-edge.sqlite3")
        self.db.migrate()
        self.journal = Journal(self.db)
        self.notifications = Notifications(self.db, self.journal)
        self.manager = OrderManager(self.db, self.engine.connector, self.journal,
                                    self.notifications)

    def open_position(self, stop=True, target=True):
        from carnet.connectors.base import OrderRequest

        quote = self.engine.market.quote("EURUSD")
        self.engine.connector.place_order(OrderRequest(
            symbol="EURUSD", side="BUY", qty=D("0.10"),
            stop_price=quote.mid - Decimal("0.005") if stop else None,
            target_price=quote.mid + Decimal("0.010") if target else None,
            reference_price=quote.mid, environment="SIMULATION"))
        self.manager.apply_events(self.engine.connector.pump(self.engine.market.quotes()))
        return self.manager.open_positions()[0] if self.manager.open_positions() else None

    def events(self):
        return [row["event"] for row in self.db.query("SELECT event FROM journal")]

    def test_rejected_order_keeps_reason(self):
        order = self.manager.submit(symbol="EURUSD", side="BUY", qty=D("0.001"),
                                   stop=D("1.0800"), target=D("1.1000"), entry=D("1.0875"),
                                   environment="SIMULATION")
        self.assertEqual(order["state"], "REJECTED")
        self.assertIsNotNone(order["reject_reason"])
        self.assertIn("ORDER_REJECTED", self.events())

    def test_connector_unavailable_leads_to_unknown(self):
        self.engine.connector.halted = True
        try:
            order = self.manager.submit(symbol="EURUSD", side="BUY", qty=D("0.10"),
                                        stop=D("1.0800"), target=D("1.1000"),
                                        entry=D("1.0875"), environment="SIMULATION")
        finally:
            self.engine.connector.halted = False
        self.assertEqual(order["state"], "UNKNOWN")
        self.assertIn("ORDER_STATE_UNKNOWN", self.events())

    def test_resolve_unknown_with_platform_id(self):
        quote = self.engine.market.quote("EURUSD")
        order = self.manager.submit(symbol="EURUSD", side="BUY", qty=D("0.10"),
                                    stop=D("1.0800"), target=D("1.1000"), entry=D("1.0875"),
                                    environment="SIMULATION", order_type="LIMIT",
                                    limit_price=quote.mid - Decimal("0.02"))
        self.assertEqual(order["state"], "ACCEPTED")
        self.db.execute("UPDATE orders SET state='UNKNOWN' WHERE id=?", (order["id"],))
        resolved = self.manager.resolve_unknown(self.engine.connector)
        self.assertEqual(len(resolved), 1)
        self.assertIn(resolved[0]["state"], ("ACCEPTED", "FILLED", "PARTIALLY_FILLED"))

    def test_unknown_platform_state_is_rejected(self):
        from carnet.orders import OrderManager

        connector = UnknownStateConnector(state_path=None)
        connector.connect()
        quote = self.engine.market.quote("EURUSD")
        connector.pump({"EURUSD": quote})
        manager = OrderManager(self.db, connector, self.journal, self.notifications)
        order = manager.submit(symbol="EURUSD", side="BUY", qty=D("0.10"), stop=D("1.0800"),
                               target=D("1.1000"), entry=D("1.0875"), environment="SIMULATION",
                               order_type="LIMIT", limit_price=quote.mid - Decimal("0.02"))
        self.db.execute("UPDATE orders SET state='UNKNOWN' WHERE id=?", (order["id"],))
        resolved = manager.resolve_unknown(connector)
        self.assertEqual(resolved[0]["state"], "REJECTED")

    def test_unmatched_events_are_journaled(self):
        self.manager.apply_events([
            {"type": "FILL", "client_order_id": "inconnu", "order_id": "inconnu",
             "qty": "1", "price": "1"},
            {"type": "POSITION_CLOSED", "position_id": "inconnue", "realized_pnl": "0"},
            {"type": "TYPE_INCONNU"},
        ])
        events = self.events()
        self.assertIn("FILL_WITHOUT_ORDER", events)
        self.assertIn("CLOSE_WITHOUT_POSITION", events)

    def test_unprotected_position_raises_one_alert(self):
        position = self.open_position(stop=False, target=False)
        self.assertIsNotNone(position)
        self.assertFalse(position["protection_ok"])
        self.manager.apply_events(self.engine.connector.drain_events())
        events = self.events()
        self.assertEqual(events.count("STOP_LOSS_UNCONFIRMED"), 1)
        self.assertGreaterEqual(self.notifications.unread_count(), 1)

    def test_cancel_paths(self):
        quote = self.engine.market.quote("EURUSD")
        order = self.manager.submit(symbol="EURUSD", side="BUY", qty=D("0.10"),
                                    stop=D("1.0800"), target=D("1.1000"), entry=D("1.0875"),
                                    environment="SIMULATION", order_type="LIMIT",
                                    limit_price=quote.mid - Decimal("0.02"))
        self.assertTrue(self.manager.cancel(order["id"]))
        self.assertFalse(self.manager.cancel(order["id"]))  # déjà terminal
        with self.assertRaises(ValueError):
            self.manager.cancel("identifiant-inconnu")

        second = self.manager.submit(symbol="EURUSD", side="BUY", qty=D("0.10"),
                                     stop=D("1.0800"), target=D("1.1000"), entry=D("1.0875"),
                                     environment="SIMULATION", order_type="LIMIT",
                                     limit_price=quote.mid - Decimal("0.02"))
        connector = self.engine.connector
        original = connector.cancel_order

        def failing_cancel(platform_order_id):
            raise ConnectorError("plateforme indisponible")

        connector.cancel_order = failing_cancel
        try:
            self.assertFalse(self.manager.cancel(second["id"]))
        finally:
            connector.cancel_order = original
        self.assertIn("CANCEL_FAILED", self.events())

    def test_platform_cancel_event_closes_pending_order(self):
        quote = self.engine.market.quote("EURUSD")
        order = self.manager.submit(symbol="EURUSD", side="BUY", qty=D("0.10"),
                                    stop=D("1.0800"), target=D("1.1000"), entry=D("1.0875"),
                                    environment="SIMULATION", order_type="LIMIT",
                                    limit_price=quote.mid - Decimal("0.02"))
        self.manager.apply_events([{"type": "CANCELLED",
                                    "order_id": order["platform_order_id"]}])
        self.assertEqual(self.manager.get(order["id"])["state"], "CANCELLED")
        # Un événement d'annulation pour un ordre inconnu est ignoré sans erreur.
        self.manager.apply_events([{"type": "CANCELLED", "order_id": "AUCUN"}])

    def test_partial_fill_normalises_state(self):
        quote = self.engine.market.quote("EURUSD")
        order = self.manager.submit(symbol="EURUSD", side="BUY", qty=D("0.10"),
                                    stop=D("1.0800"), target=D("1.1000"), entry=D("1.0875"),
                                    environment="SIMULATION", order_type="LIMIT",
                                    limit_price=quote.mid - Decimal("0.02"))
        self.manager.apply_events([{
            "type": "FILL", "order_id": order["platform_order_id"],
            "client_order_id": order["client_order_id"], "qty": "0.04",
            "price": "1.0800", "fee": "0.01", "state": "ACCEPTED",
            "external_id": "F-TEST", "at": now_utc().isoformat(),
        }])
        updated = self.manager.get(order["id"])
        self.assertEqual(updated["state"], "PARTIALLY_FILLED")
        self.assertAlmostEqual(float(updated["filled_qty"]), 0.04, places=6)

    def test_duplicate_position_event_is_ignored(self):
        position = self.open_position()
        self.assertIsNotNone(position)
        event = {"type": "POSITION_OPENED", "position_id": position["id"],
                 "symbol": "EURUSD", "side": "BUY", "qty": "0.10",
                 "entry_price": "1.0875", "stop_price": "1.0800",
                 "target_price": "1.1000", "protected": True}
        self.manager.apply_events([event])
        self.assertEqual(len(self.manager.open_positions()), 1)

    def test_protection_alert_is_deduplicated(self):
        self.manager._protection_alert("pos-test", "EURUSD")
        self.manager._protection_alert("pos-test", "EURUSD")
        events = self.events()
        self.assertEqual(events.count("STOP_LOSS_UNCONFIRMED"), 1)

    def test_cancel_pending_entries_handles_errors(self):
        quote = self.engine.market.quote("EURUSD")
        self.manager.submit(symbol="EURUSD", side="BUY", qty=D("0.10"), stop=D("1.0800"),
                            target=D("1.1000"), entry=D("1.0875"), environment="SIMULATION",
                            order_type="LIMIT", limit_price=quote.mid - Decimal("0.02"))
        connector = self.engine.connector
        original = connector.cancel_order

        def failing_cancel(platform_order_id):
            raise ConnectorError("panne réseau simulée")

        connector.cancel_order = failing_cancel
        try:
            cancelled = self.manager.cancel_pending_entries()
        finally:
            connector.cancel_order = original
        self.assertEqual(cancelled, [])
        self.assertIn("CANCEL_FAILED", self.events())

    def test_listing_filters_and_helpers(self):
        self.assertIsNone(self.manager.get("inconnu"))
        self.open_position()
        self.assertEqual(len(self.manager.positions_for_risk()), 1)
        filled = self.manager.recent_orders(state="FILLED")
        self.assertTrue(all(order["state"] == "FILLED" for order in filled))

    def test_realized_pnl_and_totals_after_close(self):
        position = self.open_position()
        self.manager.apply_events([{
            "type": "POSITION_CLOSED", "position_id": position["id"],
            "reason": "TAKE_PROFIT", "realized_pnl": "12.5", "fees": "0.4",
            "close_price": "1.0950", "closed_at": now_utc().isoformat(),
        }])
        self.assertGreaterEqual(self.manager.realized_pnl_today(), Decimal("12.5"))
        totals = self.manager.totals()
        self.assertEqual(totals["closed_positions"], 1)
        self.assertAlmostEqual(float(totals["realized_pnl"]), 12.5, places=4)
