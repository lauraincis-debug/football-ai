"""Réconciliation locale ↔ plateforme (section 12).

Règle impérative : *en cas de doute, aucune nouvelle entrée*. L'état local n'est
jamais considéré comme la vérité d'une position réelle : la plateforme fait foi.
"""

from __future__ import annotations

import json
import time
from decimal import Decimal
from typing import Any

from .connectors.base import BrokerConnector, ConnectorError
from .db import Database
from .journal import Journal, Notifications
from .util import D, ZERO, iso, new_uuid, now_utc


class Reconciler:
    def __init__(self, db: Database, connector: BrokerConnector, journal: Journal,
                 notifications: Notifications | None = None):
        self.db = db
        self.connector = connector
        self.journal = journal
        self.notifications = notifications
        self.last_result: dict[str, Any] | None = None

    def run(self, reason: str = "startup") -> dict[str, Any]:
        started = time.perf_counter()
        details: dict[str, Any] = {
            "reason": reason, "positions_local": 0, "positions_platform": 0,
            "missing_locally": [], "missing_on_platform": [], "unprotected": [],
            "orders_local": 0, "orders_platform": 0, "duplicates": [], "warnings": [],
        }
        status = "OK"
        try:
            platform_positions = {p.platform_position_id: p for p in self.connector.positions()}
            platform_orders = {o.platform_order_id: o for o in self.connector.open_orders()}
        except ConnectorError as exc:
            details["warnings"].append(f"connecteur indisponible : {exc}")
            status = "INCOMPLETE"
            return self._finish(status, details, started)

        local_positions = {
            row["id"]: row for row in self.db.query("SELECT * FROM positions WHERE status='OPEN'")
        }
        details["positions_local"] = len(local_positions)
        details["positions_platform"] = len(platform_positions)

        for position_id, report in platform_positions.items():
            if position_id not in local_positions:
                details["missing_locally"].append({
                    "position_id": position_id, "symbol": report.symbol, "qty": float(report.qty),
                    "side": report.side, "stop": float(report.stop_price) if report.stop_price else None,
                })
                # Position inconnue localement : enregistrée en ORPHAN, jamais ignorée.
                self.db.execute(
                    "INSERT OR IGNORE INTO positions(id, account_id, symbol, side, qty, entry_price,"
                    " stop_price, target_price, opened_at, status, strategy, protection_ok)"
                    " VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    (position_id, "SIM-0001", report.symbol, report.side, str(report.qty),
                     str(report.entry_price),
                     str(report.stop_price) if report.stop_price else None,
                     str(report.target_price) if report.target_price else None,
                     iso(report.opened_at), "ORPHAN", report.strategy or None,
                     int(report.stop_price is not None and report.target_price is not None)))
                status = "DIVERGENCE"
            if report.stop_price is None or report.target_price is None:
                details["unprotected"].append({"position_id": position_id, "symbol": report.symbol})
                status = "DIVERGENCE"

        for position_id, row in local_positions.items():
            if position_id not in platform_positions:
                details["missing_on_platform"].append({"position_id": position_id, "symbol": row["symbol"]})
                self.db.execute(
                    "UPDATE positions SET status='CLOSED', closed_at=?, close_reason=?"
                    " WHERE id=?", (iso(now_utc()), "RECONCILED_ABSENT", position_id))
                status = "DIVERGENCE"

        local_orders = {
            row["platform_order_id"]: row for row in self.db.query(
                "SELECT * FROM orders WHERE state IN"
                " ('CREATED','SUBMITTED','ACCEPTED','PARTIALLY_FILLED','CANCEL_PENDING','UNKNOWN')"
                " AND platform_order_id IS NOT NULL")
        }
        details["orders_local"] = len(local_orders)
        details["orders_platform"] = len(platform_orders)
        for platform_id in platform_orders:
            if platform_id not in local_orders:
                details["duplicates"].append({"platform_order_id": platform_id})
                status = "DIVERGENCE"
        for platform_id, row in local_orders.items():
            if platform_id not in platform_orders and row["state"] not in ("FILLED", "CANCELLED"):
                details["warnings"].append(
                    f"ordre local {platform_id} absent de la plateforme (état {row['state']})")

        if details["warnings"] and status == "OK":
            status = "DIVERGENCE"

        if status != "OK":
            self.journal.critical(
                "reconcile", "RECONCILIATION_DIVERGENCE",
                f"réconciliation ({reason}) : {status} — nouvelles entrées suspendues",
                payload=details)
            if self.notifications:
                self.notifications.push(
                    "CRITICAL", "RECONCILIATION_DIVERGENCE", "Divergence de réconciliation",
                    "L'état local diffère de la plateforme : nouvelles entrées suspendues.")
        else:
            self.journal.info("reconcile", "RECONCILIATION_OK",
                              f"réconciliation ({reason}) cohérente", payload=details)
        return self._finish(status, details, started)

    def _finish(self, status: str, details: dict[str, Any], started: float) -> dict[str, Any]:
        duration = (time.perf_counter() - started) * 1000
        record = {
            "id": new_uuid(), "status": status, "details": details,
            "duration_ms": round(duration, 2), "created_at": iso(now_utc()),
        }
        self.db.execute(
            "INSERT INTO reconciliations(id, status, details, created_at, duration_ms)"
            " VALUES(?,?,?,?,?)",
            (record["id"], status, json.dumps(details), record["created_at"], record["duration_ms"]))
        self.last_result = record
        return record

    def history(self, limit: int = 20) -> list[dict[str, Any]]:
        rows = self.db.query("SELECT * FROM reconciliations ORDER BY created_at DESC LIMIT ?",
                             (int(limit),))
        out = []
        for row in rows:
            item = dict(row)
            item["details"] = json.loads(item["details"]) if item["details"] else {}
            out.append(item)
        return out
