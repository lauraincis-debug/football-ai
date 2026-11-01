"""Politique de risque versionnée et protégée (sections 1.3, 5 et 18.1).

Toute modification :
1. exige le rôle ADMIN **et** le jeton propriétaire + phrase de confirmation ;
2. est validée par ``RiskPolicy.validate()`` avant écriture ;
3. crée une nouvelle version chaînée par hash, avec auteur et motif ;
4. est journalisée et auditée.
"""

from __future__ import annotations

import json
import threading
from typing import Any

from .config import DEFAULT_POLICY, RiskPolicy
from .db import Database
from .journal import AuditLog, Journal
from .security import AuthError, OwnerGate, User
from .util import as_number, canonical_json, iso, now_utc, sha256_hex


class PolicyStore:
    def __init__(self, db: Database, journal: Journal, audit: AuditLog,
                 owner_gate: OwnerGate, initial: RiskPolicy | None = None):
        self.db = db
        self.journal = journal
        self.audit = audit
        self.owner = owner_gate
        self._initial = initial or DEFAULT_POLICY
        self._lock = threading.RLock()
        self._cache: RiskPolicy | None = None

    # -- lecture ---------------------------------------------------------
    def current(self) -> RiskPolicy:
        with self._lock:
            if self._cache is not None:
                return self._cache
            row = self.db.query_one("SELECT * FROM policy_versions ORDER BY version DESC LIMIT 1")
            if row is None:
                self.bootstrap()
                row = self.db.query_one("SELECT * FROM policy_versions ORDER BY version DESC LIMIT 1")
            payload = json.loads(row["payload"])
            policy = self._from_payload(payload)
            self._cache = policy
            return policy

    def _from_payload(self, payload: dict[str, Any]) -> RiskPolicy:
        from decimal import Decimal

        values: dict[str, Any] = {}
        for key, value in payload.items():
            if key in RiskPolicy.__dataclass_fields__:
                field_type = RiskPolicy.__dataclass_fields__[key].type
                if field_type in ("Decimal", Decimal) or isinstance(value, float):
                    values[key] = Decimal(str(value))
                elif isinstance(value, bool):
                    values[key] = value
                else:
                    values[key] = int(value) if isinstance(value, (int, float)) and key in {
                        "max_open_positions", "max_daily_trades", "reset_hour_ny", "version"
                    } else value
        return RiskPolicy(**values)

    def history(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self.db.query("SELECT * FROM policy_versions ORDER BY version DESC LIMIT ?", (int(limit),))
        return [
            {
                "version": r["version"], "payload": json.loads(r["payload"]),
                "reason": r["reason"], "created_by": r["created_by"],
                "created_at": r["created_at"], "hash": r["hash"], "prev_hash": r["prev_hash"],
            }
            for r in rows
        ]

    # -- écriture --------------------------------------------------------
    def bootstrap(self) -> RiskPolicy:
        with self._lock:
            if self.db.query_one("SELECT version FROM policy_versions LIMIT 1"):
                policy = self.current()
                return policy
            payload = self._initial.to_dict()
            prev = "0" * 64
            digest = sha256_hex(prev + canonical_json(payload))
            self.db.execute(
                "INSERT INTO policy_versions(version, payload, reason, created_by, created_at, prev_hash, hash)"
                " VALUES(?,?,?,?,?,?,?)",
                (self._initial.version, canonical_json(payload), "initialisation (valeurs du cahier des charges)",
                 "system", iso(now_utc()), prev, digest),
            )
            self._cache = self._initial
            self.journal.info("policy", "POLICY_INITIALISED",
                              f"politique de risque initialisée en version {self._initial.version}")
            return self._initial

    def update(self, changes: dict[str, Any], actor: User, reason: str,
               owner_token: str | None, confirmation: str | None,
               ip: str | None = None) -> RiskPolicy:
        if not actor.allows("policy:write"):
            raise AuthError("seul un administrateur peut modifier la politique", "FORBIDDEN", 403)
        self.owner.verify(owner_token, confirmation)
        with self._lock:
            current = self.current()
            try:
                candidate = current.with_changes(changes)
            except (ValueError, TypeError) as exc:
                raise AuthError(f"modification invalide: {exc}", "INVALID_POLICY", 400) from exc
            errors = candidate.validate()
            if errors:
                raise AuthError("politique invalide: " + "; ".join(errors), "INVALID_POLICY", 400)
            new_version = current.version + 1
            candidate = candidate.with_changes({"version": new_version})
            payload = candidate.to_dict()
            prev = self.db.scalar("SELECT hash FROM policy_versions ORDER BY version DESC LIMIT 1",
                                  default="0" * 64)
            digest = sha256_hex(prev + canonical_json(payload))
            self.db.execute(
                "INSERT INTO policy_versions(version, payload, reason, created_by, created_at, prev_hash, hash)"
                " VALUES(?,?,?,?,?,?,?)",
                (new_version, canonical_json(payload), reason, actor.username, iso(now_utc()), prev, digest),
            )
            self._cache = candidate
            self.journal.warning(
                "policy", "POLICY_UPDATED",
                f"politique de risque version {new_version} par {actor.username}",
                payload=as_number({"changes": changes, "reason": reason, "version": new_version}),
            )
            self.audit.record(actor.username, "policy.update",
                              {"version": new_version, "changes": changes, "reason": reason}, ip)
            return candidate

    def verify_chain(self) -> bool:
        expected = "0" * 64
        for row in self.db.query("SELECT * FROM policy_versions ORDER BY version"):
            digest = sha256_hex(expected + row["payload"])
            if row["prev_hash"] != expected or row["hash"] != digest:
                return False
            expected = digest
        return True
