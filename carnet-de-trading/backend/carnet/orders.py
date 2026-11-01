"""Gestionnaire d'ordres : cycle de vie, déduplication, protections, réconciliation.

Sections 11 et 12 :
- machine à états stricte, historique immuable (``order_events``) ;
- aucune nouvelle tentative aveugle : sur timeout, l'ordre passe en ``UNKNOWN``
  puis son état est interrogé auprès de la plateforme ;
- les remplissages partiels sont enregistrés sur la quantité réellement exécutée ;
- toute position sans protection confirmée déclenche la procédure d'urgence.
"""

from __future__ import annotations

import json
import threading
from decimal import Decimal
from typing import Any, Iterable

from .config import SIMULATION_REFERENCE_PRICES, SYMBOLS, TERMINAL_ORDER_STATES
from .connectors.base import (
    BrokerConnector,
    ConnectorError,
    ConnectorUnavailable,
    OrderRejected,
    OrderRequest,
    OrderTimeout,
    UnknownOrderState,
)
from .db import Database
from .journal import Journal, Notifications
from .util import D, ZERO, iso, new_uuid, now_utc

ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    "CREATED": frozenset({"SUBMITTED", "REJECTED", "CANCELLED"}),
    "SUBMITTED": frozenset({"ACCEPTED", "REJECTED", "UNKNOWN", "EXPIRED", "CANCELLED", "FILLED"}),
    "ACCEPTED": frozenset({"PARTIALLY_FILLED", "FILLED", "CANCEL_PENDING", "CANCELLED",
                           "REJECTED", "EXPIRED", "UNKNOWN"}),
    "PARTIALLY_FILLED": frozenset({"PARTIALLY_FILLED", "FILLED", "CANCEL_PENDING",
                                   "CANCELLED", "EXPIRED", "UNKNOWN"}),
    "CANCEL_PENDING": frozenset({"CANCELLED", "PARTIALLY_FILLED", "FILLED", "UNKNOWN"}),
    "UNKNOWN": frozenset({"ACCEPTED", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "REJECTED",
                          "EXPIRED", "UNKNOWN"}),
    "FILLED": frozenset(),
    "CANCELLED": frozenset(),
    "REJECTED": frozenset(),
    "EXPIRED": frozenset(),
}


class StateTransitionError(Exception):
    pass


class OrderManager:
    def __init__(self, db: Database, connector: BrokerConnector, journal: Journal,
                 notifications: Notifications | None = None):
        self.db = db
        self.connector = connector
        self.journal = journal
        self.notifications = notifications
        self._lock = threading.RLock()
        self._protections_alerted: set[str] = set()

    # -- création --------------------------------------------------------
    def submit(self, *, symbol: str, side: str, qty: Decimal, stop: Decimal, target: Decimal,
               entry: Decimal, environment: str, strategy: str | None = None,
               signal_id: str | None = None, order_type: str = "MARKET",
               limit_price: Decimal | None = None,
               account_id: str = "SIM-0001") -> dict[str, Any]:
        with self._lock:
            if signal_id:
                existing = self.db.query_one(
                    "SELECT id, state FROM orders WHERE signal_id=? LIMIT 1", (signal_id,))
                if existing:
                    self.journal.warning(
                        "orders", "DUPLICATE_SIGNAL",
                        f"signal {signal_id} déjà transformé en ordre ({existing['state']})",
                        payload={"signal_id": signal_id, "order_id": existing["id"]})
                    return self.get(existing["id"])  # type: ignore[return-value]
            order_id = new_uuid()
            client_order_id = f"cdt-{order_id[:18]}"
            created = iso(now_utc())
            self.db.execute(
                "INSERT INTO orders(id, client_order_id, account_id, symbol, side, order_type,"
                " qty, filled_qty, limit_price, requested_price, stop_price, target_price, state,"
                " strategy, signal_id, environment, created_at, updated_at)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (order_id, client_order_id, account_id, symbol, side, order_type, str(qty), "0",
                 str(limit_price) if limit_price is not None else None, str(entry),
                 str(stop), str(target), "CREATED", strategy, signal_id, environment,
                 created, created),
            )
            self._event(order_id, None, "CREATED", "ordre créé localement")
            self._transition(order_id, "CREATED", "SUBMITTED", "transmission initiée")
            request = OrderRequest(
                symbol=symbol, side=side, qty=qty, order_type=order_type,
                client_order_id=client_order_id, limit_price=limit_price,
                stop_price=stop, target_price=target, strategy=strategy,
                signal_id=signal_id, environment=environment, reference_price=entry,
            )
            try:
                ack = self.connector.place_order(request)
            except OrderTimeout as exc:
                # Statut incertain : interrogation obligatoire, aucune réémission.
                self._transition(order_id, "SUBMITTED", "UNKNOWN", f"timeout: {exc}")
                self.journal.critical(
                    "orders", "ORDER_TIMEOUT",
                    f"statut incertain pour {client_order_id} : vérification de la plateforme requise",
                    order_id=order_id, payload={"symbol": symbol, "client_order_id": client_order_id})
                if self.notifications:
                    self.notifications.push("CRITICAL", "ORDER_TIMEOUT", "Statut d'ordre incertain",
                                            f"Aucune nouvelle tentative : vérification de {symbol}.")
                return self.get(order_id)  # type: ignore[return-value]
            except OrderRejected as exc:
                self._transition(order_id, "SUBMITTED", "REJECTED", str(exc))
                self.db.execute("UPDATE orders SET reject_reason=?, terminal_at=? WHERE id=?",
                                (str(exc), iso(now_utc()), order_id))
                self.journal.warning("orders", "ORDER_REJECTED",
                                     f"ordre refusé par la plateforme : {exc}",
                                     order_id=order_id, payload={"symbol": symbol})
                return self.get(order_id)  # type: ignore[return-value]
            except (ConnectorUnavailable, ConnectorError) as exc:
                self._transition(order_id, "SUBMITTED", "UNKNOWN", f"erreur connecteur: {exc}")
                self.journal.critical(
                    "orders", "ORDER_STATE_UNKNOWN",
                    f"état inconnu après erreur connecteur : {exc}",
                    order_id=order_id, payload={"symbol": symbol})
                return self.get(order_id)  # type: ignore[return-value]

            state = ack.state if ack.state in ALLOWED_TRANSITIONS["SUBMITTED"] else "ACCEPTED"
            self.db.execute(
                "UPDATE orders SET platform_order_id=?, submitted_at=?, payload=? WHERE id=?",
                (ack.platform_order_id, iso(ack.accepted_at), json.dumps(ack.raw or {}), order_id))
            self._transition(order_id, "SUBMITTED", state, ack.message or "accusé de réception")
            return self.get(order_id)  # type: ignore[return-value]

    # -- transitions -----------------------------------------------------
    def _transition(self, order_id: str, from_state: str | None, to_state: str,
                    reason: str = "") -> None:
        order = self.db.query_one("SELECT state FROM orders WHERE id=?", (order_id,))
        current = order["state"] if order else from_state
        if current and current != to_state:
            allowed = ALLOWED_TRANSITIONS.get(current, frozenset())
            if to_state not in allowed and current != "CREATED":
                raise StateTransitionError(
                    f"transition interdite {current} -> {to_state} pour l'ordre {order_id}")
        stamp = iso(now_utc())
        terminal = to_state in TERMINAL_ORDER_STATES
        self.db.execute(
            "UPDATE orders SET state=?, updated_at=?, terminal_at=CASE WHEN ? THEN ? ELSE terminal_at END"
            " WHERE id=?", (to_state, stamp, int(terminal), stamp, order_id))
        self._event(order_id, current, to_state, reason)
        self.journal.info("orders", f"ORDER_{to_state}", f"ordre {order_id[:8]} : {reason}",
                          order_id=order_id, payload={"from": current, "to": to_state})

    def _event(self, order_id: str, from_state: str | None, to_state: str, reason: str) -> None:
        self.db.execute(
            "INSERT INTO order_events(order_id, from_state, to_state, reason, created_at)"
            " VALUES(?,?,?,?,?)", (order_id, from_state, to_state, reason, iso(now_utc())))

    # -- événements du connecteur ---------------------------------------
    def apply_events(self, events: Iterable[dict[str, Any]]) -> None:
        for event in events:
            kind = event.get("type")
            if kind == "FILL":
                self._apply_fill(event)
            elif kind == "POSITION_OPENED":
                self._apply_position_open(event)
            elif kind == "POSITION_CLOSED":
                self._apply_position_close(event)
            elif kind == "CANCELLED":
                self._apply_cancel(event)

    def _apply_fill(self, event: dict[str, Any]) -> None:
        with self._lock:
            row = self.db.query_one(
                "SELECT * FROM orders WHERE client_order_id=? OR platform_order_id=? LIMIT 1",
                (event.get("client_order_id", ""), event.get("order_id", "")))
            if row is None:
                self.journal.error("orders", "FILL_WITHOUT_ORDER",
                                   "exécution reçue sans ordre local correspondant",
                                   payload=event)
                return
            order_id = row["id"]
            qty = D(event["qty"])
            price = D(event["price"])
            fee = D(event.get("fee", "0"))
            self.db.execute(
                "INSERT INTO fills(id, order_id, qty, price, fee, slippage_bps, external_id, created_at)"
                " VALUES(?,?,?,?,?,?,?,?)",
                (new_uuid(), order_id, str(qty), str(price), str(fee),
                 event.get("slippage_bps"), event.get("external_id"), event.get("at") or iso(now_utc())))
            filled = D(row["filled_qty"]) + qty
            previous_avg = D(row["avg_fill_price"]) if row["avg_fill_price"] else ZERO
            previous_qty = D(row["filled_qty"])
            avg = ((previous_avg * previous_qty) + (price * qty)) / filled if filled > ZERO else price
            state = event.get("state", "PARTIALLY_FILLED")
            self.db.execute(
                "UPDATE orders SET filled_qty=?, avg_fill_price=?, fees=?, updated_at=? WHERE id=?",
                (str(filled), str(avg), str(D(row["fees"]) + fee), iso(now_utc()), order_id))
            if state not in ("FILLED", "PARTIALLY_FILLED"):
                state = "FILLED" if filled >= D(row["qty"]) else "PARTIALLY_FILLED"
            if row["state"] != state:
                self._transition(order_id, row["state"], state,
                                 f"exécution {qty} à {price}")

    def _apply_position_open(self, event: dict[str, Any]) -> None:
        with self._lock:
            position_id = event["position_id"]
            existing = self.db.query_one("SELECT id FROM positions WHERE id=?", (position_id,))
            if existing:
                return
            entry = D(event["entry_price"])
            stop = D(event["stop_price"]) if event.get("stop_price") else None
            target = D(event["target_price"]) if event.get("target_price") else None
            spec = SYMBOLS.get(event["symbol"])
            protected = bool(stop is not None and target is not None and spec is not None)
            self.db.execute(
                "INSERT INTO positions(id, account_id, symbol, side, qty, entry_price, stop_price,"
                " target_price, opened_at, status, order_id, strategy, protection_ok)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (position_id, "SIM-0001", event["symbol"], event["side"], event["qty"],
                 str(entry), str(stop) if stop else None, str(target) if target else None,
                 event.get("at") or iso(now_utc()), "OPEN", event.get("order_id"),
                 event.get("strategy"), int(protected)))
            self.journal.info(
                "orders", "POSITION_OPENED",
                f"position ouverte {event['symbol']} {event['side']} {event['qty']} @ {entry}",
                position_id=position_id,
                payload={"stop": str(stop) if stop else None, "target": str(target) if target else None})
            if self.notifications:
                self.notifications.push(
                    "INFO", "POSITION_OPENED", "Nouvelle position",
                    f"{event['side']} {event['qty']} {event['symbol']} à {entry}")
            if not protected:
                self._protection_alert(position_id, event["symbol"])

    def _protection_alert(self, position_id: str, symbol: str) -> None:
        if position_id in self._protections_alerted:
            return
        self._protections_alerted.add(position_id)
        self.journal.critical(
            "orders", "STOP_LOSS_UNCONFIRMED",
            f"position {symbol} sans protection complète confirmée : procédure d'urgence",
            position_id=position_id, payload={"symbol": symbol})
        if self.notifications:
            self.notifications.push(
                "CRITICAL", "STOP_LOSS_UNCONFIRMED", "Protection non confirmée",
                f"La position {symbol} n'a pas de stop/objectif confirmé. Nouvelles entrées suspendues.")

    def _apply_position_close(self, event: dict[str, Any]) -> None:
        with self._lock:
            position_id = event["position_id"]
            row = self.db.query_one("SELECT * FROM positions WHERE id=?", (position_id,))
            if row is None:
                self.journal.warning("orders", "CLOSE_WITHOUT_POSITION",
                                     "clôture reçue pour une position inconnue", payload=event)
                return
            realized = D(event.get("realized_pnl", "0"))
            fees = D(event.get("fees", "0"))
            self.db.execute(
                "UPDATE positions SET status='CLOSED', closed_at=?, close_price=?, realized_pnl=?,"
                " fees=?, close_reason=?, unrealized_pnl='0' WHERE id=?",
                (event.get("closed_at") or iso(now_utc()), event.get("close_price"),
                 str(realized), str(fees), event.get("reason", "UNKNOWN"), position_id))
            self.journal.info(
                "orders", "POSITION_CLOSED",
                f"position {row['symbol']} clôturée ({event.get('reason')}) : "
                f"P&L réalisé {realized:.2f}",
                position_id=position_id, payload={"realized_pnl": str(realized), "fees": str(fees)})
            if self.notifications:
                self.notifications.push(
                    "INFO" if realized >= ZERO else "WARNING", "POSITION_CLOSED", "Position clôturée",
                    f"{row['symbol']} {event.get('reason')} : P&L {realized:.2f}")

    def _apply_cancel(self, event: dict[str, Any]) -> None:
        row = self.db.query_one("SELECT * FROM orders WHERE platform_order_id=?",
                                (event.get("order_id"),))
        if row and row["state"] not in TERMINAL_ORDER_STATES:
            self._transition(row["id"], row["state"], "CANCELLED", "annulation confirmée par la plateforme")

    # -- résolution des états incertains --------------------------------
    def resolve_unknown(self, connector: BrokerConnector | None = None) -> list[dict[str, Any]]:
        """Interroge la plateforme avant toute nouvelle tentative (section 11.1)."""
        connector = connector or self.connector
        resolved: list[dict[str, Any]] = []
        with self._lock:
            rows = self.db.query("SELECT * FROM orders WHERE state='UNKNOWN'")
            for row in rows:
                platform_id = row["platform_order_id"]
                if not platform_id:
                    # Aucun identifiant plateforme : l'ordre n'a probablement jamais été reçu.
                    self._transition(row["id"], "UNKNOWN", "REJECTED",
                                     "aucun identifiant plateforme : ordre considéré non transmis")
                    resolved.append({"order_id": row["id"], "state": "REJECTED"})
                    continue
                try:
                    report = connector.order_status(platform_id)
                except UnknownOrderState:
                    self._transition(row["id"], "UNKNOWN", "REJECTED",
                                     "statut inconnu confirmé par la plateforme")
                    resolved.append({"order_id": row["id"], "state": "REJECTED"})
                    continue
                except ConnectorError as exc:
                    self.journal.warning("orders", "ORDER_RESOLVE_FAILED",
                                         f"résolution impossible pour {platform_id}: {exc}")
                    continue
                state = report.state if report.state in ALLOWED_TRANSITIONS["UNKNOWN"] else "ACCEPTED"
                self._transition(row["id"], "UNKNOWN", state, "état confirmé par la plateforme")
                resolved.append({"order_id": row["id"], "state": state})
        return resolved

    # -- annulation / urgence -------------------------------------------
    def cancel(self, order_id: str) -> bool:
        row = self.db.query_one("SELECT * FROM orders WHERE id=?", (order_id,))
        if row is None:
            raise ValueError("ordre inconnu")
        if row["state"] in TERMINAL_ORDER_STATES:
            return False
        self._transition(order_id, row["state"], "CANCEL_PENDING", "annulation demandée")
        try:
            ok = self.connector.cancel_order(row["platform_order_id"]) if row["platform_order_id"] else True
        except ConnectorError as exc:
            self.journal.error("orders", "CANCEL_FAILED", f"annulation refusée: {exc}", order_id=order_id)
            return False
        if ok:
            self._transition(order_id, "CANCEL_PENDING", "CANCELLED", "annulation confirmée")
        return ok

    def cancel_pending_entries(self) -> list[str]:
        """ARRÊT TRADING : annule les entrées en attente, conserve les protections."""
        cancelled: list[str] = []
        rows = self.db.query(
            "SELECT id, platform_order_id FROM orders WHERE state IN"
            " ('CREATED','SUBMITTED','ACCEPTED','PARTIALLY_FILLED','CANCEL_PENDING','UNKNOWN')")
        for row in rows:
            try:
                if self.cancel(row["id"]):
                    cancelled.append(row["id"])
            except Exception as exc:  # pragma: no cover - défensif
                self.journal.error("orders", "CANCEL_ERROR", f"annulation impossible: {exc}")
        self.journal.warning("orders", "ENTRIES_CANCELLED",
                             f"{len(cancelled)} ordre(s) d'entrée annulé(s)")
        return cancelled

    # -- lecture ---------------------------------------------------------
    def get(self, order_id: str) -> dict[str, Any] | None:
        row = self.db.query_one("SELECT * FROM orders WHERE id=?", (order_id,))
        if row is None:
            return None
        item = dict(row)
        item["events"] = [dict(e) for e in self.db.query(
            "SELECT * FROM order_events WHERE order_id=? ORDER BY id", (order_id,))]
        item["fills"] = [dict(f) for f in self.db.query(
            "SELECT * FROM fills WHERE order_id=? ORDER BY created_at", (order_id,))]
        return item

    def recent_orders(self, limit: int = 100, state: str | None = None) -> list[dict[str, Any]]:
        if state:
            rows = self.db.query("SELECT * FROM orders WHERE state=? ORDER BY created_at DESC LIMIT ?",
                                 (state, int(limit)))
        else:
            rows = self.db.query("SELECT * FROM orders ORDER BY created_at DESC LIMIT ?", (int(limit),))
        out = []
        for row in rows:
            item = dict(row)
            for key in ("qty", "filled_qty", "fees", "avg_fill_price", "requested_price",
                        "stop_price", "target_price", "limit_price"):
                if item.get(key) is not None:
                    item[key] = float(D(item[key]))
            out.append(item)
        return out

    def open_positions(self) -> list[dict[str, Any]]:
        rows = self.db.query("SELECT * FROM positions WHERE status='OPEN' ORDER BY opened_at DESC")
        return [self._position_dict(r) for r in rows]

    def closed_positions(self, limit: int = 100) -> list[dict[str, Any]]:
        rows = self.db.query(
            "SELECT * FROM positions WHERE status='CLOSED' ORDER BY closed_at DESC LIMIT ?", (int(limit),))
        return [self._position_dict(r) for r in rows]

    def _position_dict(self, row) -> dict[str, Any]:
        item = dict(row)
        for key in ("qty", "entry_price", "stop_price", "target_price", "realized_pnl", "fees",
                    "close_price", "unrealized_pnl"):
            if item.get(key) is not None:
                item[key] = float(D(item[key]))
        item["protection_ok"] = bool(item["protection_ok"])
        return item

    def positions_for_risk(self) -> list[dict[str, Any]]:
        return self.open_positions()

    def realized_pnl_today(self) -> Decimal:
        row = self.db.query_one(
            "SELECT COALESCE(SUM(CAST(realized_pnl AS REAL)), 0) AS total FROM positions"
            " WHERE status='CLOSED' AND closed_at >= ?", (iso(now_utc().replace(
                hour=0, minute=0, second=0, microsecond=0)),))
        return D(row["total"]) if row else ZERO

    def totals(self) -> dict[str, Any]:
        open_rows = self.db.query("SELECT COUNT(*) AS n, COALESCE(SUM(CAST(fees AS REAL)),0) AS fees"
                                  " FROM positions WHERE status='OPEN'")
        closed = self.db.query_one(
            "SELECT COUNT(*) AS n, COALESCE(SUM(CAST(realized_pnl AS REAL)),0) AS pnl,"
            " COALESCE(SUM(CAST(fees AS REAL)),0) AS fees FROM positions WHERE status='CLOSED'")
        wins = self.db.scalar(
            "SELECT COUNT(*) FROM positions WHERE status='CLOSED' AND CAST(realized_pnl AS REAL) > 0",
            default=0)
        return {
            "open_positions": open_rows[0]["n"] if open_rows else 0,
            "open_fees": float(D(open_rows[0]["fees"])) if open_rows else 0.0,
            "closed_positions": closed["n"] if closed else 0,
            "realized_pnl": float(D(closed["pnl"])) if closed else 0.0,
            "closed_fees": float(D(closed["fees"])) if closed else 0.0,
            "wins": int(wins or 0),
        }
