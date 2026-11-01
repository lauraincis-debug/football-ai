"""Journal en ajout seul avec chaînage cryptographique (section 20.1).

Chaque entrée contient le hash de la précédente : toute modification ou
suppression manuelle d'une ligne casse la chaîne et devient détectable par
``verify_chain()``. Les secrets sont masqués avant écriture.
"""

from __future__ import annotations

import sqlite3
import threading
from typing import Any, Iterable

from .db import Database
from .util import canonical_json, iso, new_uuid, now_utc, redact, scrub_mapping, sha256_hex

LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")
LEVEL_RANK = {name: rank for rank, name in enumerate(LEVELS)}

GENESIS = "0" * 64

CRITICAL_EVENTS = frozenset({
    "RISK_LIMIT_BREACH",
    "TRADING_SUSPENDED",
    "STOP_LOSS_UNCONFIRMED",
    "RECONCILIATION_DIVERGENCE",
    "CONNECTION_LOST",
    "KILL_SWITCH",
    "EMERGENCY_LIQUIDATION",
    "REAL_MODE_DENIED",
    "BACKUP_FAILED",
    "JOURNAL_INTEGRITY",
    "API_KEY_PERMISSION_DENIED",
})


class Journal:
    def __init__(self, db: Database):
        self.db = db
        self._lock = threading.RLock()
        self._notifier = None

    # -- écriture --------------------------------------------------------
    def log(
        self,
        level: str,
        module: str,
        event: str,
        message: str,
        *,
        order_id: str | None = None,
        position_id: str | None = None,
        payload: dict[str, Any] | None = None,
        notify=None,
    ) -> dict[str, Any]:
        level = level.upper()
        if level not in LEVEL_RANK:
            level = "INFO"
        notify = notify or self._notifier
        clean_payload = scrub_mapping(payload or {})
        created = now_utc()
        with self._lock:
            prev = self.db.scalar("SELECT hash FROM journal ORDER BY seq DESC LIMIT 1", default=GENESIS)
            body = {
                "created_at": iso(created),
                "level": level,
                "module": module,
                "event": event,
                "message": redact(message),
                "order_id": order_id,
                "position_id": position_id,
                "payload": clean_payload,
                "prev_hash": prev,
            }
            digest = sha256_hex(canonical_json(body))
            self.db.execute(
                "INSERT INTO journal(created_at, level, module, event, message, order_id,"
                " position_id, payload, prev_hash, hash) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (
                    body["created_at"], level, module, event, redact(message), order_id,
                    position_id, canonical_json(clean_payload), prev, digest,
                ),
            )
            entry = body | {"hash": digest}
        if notify and level in ("WARNING", "ERROR", "CRITICAL"):
            notify(level, event, message, clean_payload)
        return entry

    def debug(self, module: str, event: str, message: str, **kw) -> dict[str, Any]:
        return self.log("DEBUG", module, event, message, **kw)

    def info(self, module: str, event: str, message: str, **kw) -> dict[str, Any]:
        return self.log("INFO", module, event, message, **kw)

    def warning(self, module: str, event: str, message: str, **kw) -> dict[str, Any]:
        return self.log("WARNING", module, event, message, **kw)

    def error(self, module: str, event: str, message: str, **kw) -> dict[str, Any]:
        return self.log("ERROR", module, event, message, **kw)

    def critical(self, module: str, event: str, message: str, **kw) -> dict[str, Any]:
        return self.log("CRITICAL", module, event, message, **kw)

    # -- lecture ---------------------------------------------------------
    def tail(self, limit: int = 200, level: str | None = None,
             module: str | None = None, event: str | None = None) -> list[dict[str, Any]]:
        clauses, params = [], []
        if level:
            minimum = LEVEL_RANK.get(level.upper(), 0)
            allowed = [name for name, rank in LEVEL_RANK.items() if rank >= minimum]
            clauses.append("level IN (%s)" % ",".join("?" * len(allowed)))
            params.extend(allowed)
        if module:
            clauses.append("module = ?")
            params.append(module)
        if event:
            clauses.append("event = ?")
            params.append(event)
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        rows = self.db.query(
            f"SELECT * FROM journal{where} ORDER BY seq DESC LIMIT ?", (*params, int(limit))
        )
        import json

        out = []
        for row in rows:
            item = dict(row)
            item["payload"] = json.loads(item["payload"]) if item["payload"] else {}
            out.append(item)
        return out

    def count(self, level: str | None = None) -> int:
        if level:
            return int(self.db.scalar("SELECT COUNT(*) FROM journal WHERE level=?", (level,), default=0))
        return int(self.db.scalar("SELECT COUNT(*) FROM journal", default=0))

    def stats(self) -> dict[str, Any]:
        rows = self.db.query("SELECT level, COUNT(*) AS n FROM journal GROUP BY level")
        return {"total": self.count(), "by_level": {r["level"]: r["n"] for r in rows}}

    # -- intégrité -------------------------------------------------------
    def verify_chain(self, limit: int | None = None) -> dict[str, Any]:
        """Recalcule la chaîne complète et pointe la première rupture."""
        sql = "SELECT seq, created_at, level, module, event, message, order_id, position_id," \
              " payload, prev_hash, hash FROM journal ORDER BY seq"
        rows: Iterable[sqlite3.Row] = self.db.query(sql)
        expected_prev = GENESIS
        checked = 0
        for row in rows:
            body = {
                "created_at": row["created_at"],
                "level": row["level"],
                "module": row["module"],
                "event": row["event"],
                "message": row["message"],
                "order_id": row["order_id"],
                "position_id": row["position_id"],
                "payload": __import__("json").loads(row["payload"]) if row["payload"] else {},
                "prev_hash": row["prev_hash"],
            }
            digest = sha256_hex(canonical_json(body))
            if row["prev_hash"] != expected_prev or digest != row["hash"]:
                return {
                    "ok": False,
                    "checked": checked,
                    "broken_at": row["seq"],
                    "expected_prev": expected_prev,
                    "found_prev": row["prev_hash"],
                    "expected_hash": digest,
                    "found_hash": row["hash"],
                }
            expected_prev = row["hash"]
            checked += 1
            if limit and checked >= limit:
                break
        return {"ok": True, "checked": checked, "head": expected_prev}


class AuditLog:
    """Piste d'audit des actions sensibles (qui, quoi, quand, depuis où)."""

    def __init__(self, db: Database):
        self.db = db
        self._lock = threading.RLock()

    def record(self, actor: str | None, action: str, detail: dict[str, Any] | str | None = None,
               ip: str | None = None) -> None:
        created = iso(now_utc())
        payload = detail if isinstance(detail, str) else canonical_json(detail or {})
        with self._lock:
            prev = self.db.scalar("SELECT hash FROM audits ORDER BY id DESC LIMIT 1", default=GENESIS)
            digest = sha256_hex(f"{prev}|{created}|{actor}|{action}|{payload}|{ip}")
            self.db.execute(
                "INSERT INTO audits(created_at, actor, action, detail, ip, hash, prev_hash)"
                " VALUES(?,?,?,?,?,?,?)",
                (created, actor, action, payload, ip, digest, prev),
            )

    def tail(self, limit: int = 100) -> list[dict[str, Any]]:
        rows = self.db.query("SELECT * FROM audits ORDER BY id DESC LIMIT ?", (int(limit),))
        return [dict(r) for r in rows]

    def verify(self) -> bool:
        expected = GENESIS
        for row in self.db.query("SELECT * FROM audits ORDER BY id"):
            digest = sha256_hex(
                f"{expected}|{row['created_at']}|{row['actor']}|{row['action']}|"
                f"{row['detail']}|{row['ip']}"
            )
            if digest != row["hash"] or row["prev_hash"] != expected:
                return False
            expected = digest
        return True


class Notifications:
    """Centre de notifications interne, indépendant du processus de l'interface."""

    def __init__(self, db: Database, journal: Journal | None = None):
        self.db = db
        self.journal = journal
        self._lock = threading.Lock()
        self._external_hooks: list[Any] = []

    def register_hook(self, hook) -> None:
        """Branche un canal externe (webhook, e-mail) exécuté hors requête."""
        self._external_hooks.append(hook)

    def push(self, level: str, code: str, title: str, message: str,
             payload: dict[str, Any] | None = None) -> dict[str, Any]:
        notification_id = new_uuid()
        created = iso(now_utc())
        with self._lock:
            self.db.execute(
                "INSERT INTO notifications(id, level, code, title, message, created_at)"
                " VALUES(?,?,?,?,?,?)",
                (notification_id, level.upper(), code, title, message, created),
            )
        record = {
            "id": notification_id, "level": level.upper(), "code": code,
            "title": title, "message": message, "created_at": created, "payload": payload or {},
        }
        for hook in list(self._external_hooks):
            try:
                hook(record)
            except Exception as exc:  # pragma: no cover - un canal ne bloque jamais
                if self.journal:
                    self.journal.error("notify", "HOOK_FAILED", f"canal externe en échec: {exc}")
        return record

    def tail(self, limit: int = 50, unread_only: bool = False) -> list[dict[str, Any]]:
        where = " WHERE read_at IS NULL" if unread_only else ""
        rows = self.db.query(
            f"SELECT * FROM notifications{where} ORDER BY created_at DESC LIMIT ?", (int(limit),)
        )
        return [dict(r) for r in rows]

    def unread_count(self) -> int:
        return int(self.db.scalar(
            "SELECT COUNT(*) FROM notifications WHERE read_at IS NULL", default=0))

    def mark_read(self, notification_id: str | None = None) -> int:
        if notification_id:
            return self.db.execute(
                "UPDATE notifications SET read_at=? WHERE id=? AND read_at IS NULL",
                (iso(now_utc()), notification_id),
            )
        return self.db.execute(
            "UPDATE notifications SET read_at=? WHERE read_at IS NULL", (iso(now_utc()),))
