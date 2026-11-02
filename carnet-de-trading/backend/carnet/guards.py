"""Verrous de sécurité : environnement actif et interdiction du réel.

Trois couches indépendantes doivent être franchies pour qu'un ordre réel soit
seulement *envisageable*. En pratique la V1 ne dispose d'aucun connecteur réel
validé, donc le chemin s'arrête toujours par un refus explicite et journalisé.

1. ``CARNET_ALLOW_REAL=1`` dans l'environnement du serveur (décision
   d'exploitation, jamais un défaut) ;
2. les trois validations de la section 24 closes (technique, sécurité,
   opérationnelle) ;
3. une activation propriétaire : rôle ADMIN + MFA active + jeton propriétaire +
   phrase de confirmation + choix explicite du compte.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from typing import Any

from .config import DEFAULT_ENV, ENV_SIMULATION, REAL_ENVIRONMENTS, ENVIRONMENTS
from .db import Database
from .journal import AuditLog, Journal
from .security import AuthError, OwnerGate, User
from .util import iso, now_utc


VALIDATIONS = ("technical", "security", "operational")
VALIDATION_LABELS = {
    "technical": "Validation technique interne (fonctionnalités, tests, performances, reprise)",
    "security": "Revue de sécurité indépendante (architecture, secrets, accès, API, VPS, dépendances)",
    "operational": "Validation opérationnelle (broker MT5 et exchange réellement choisis)",
}


@dataclass
class Validation:
    key: str
    closed: bool = False
    evidence: str = ""
    decided_by: str | None = None
    decided_at: str | None = None
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key, "label": VALIDATION_LABELS.get(self.key, self.key),
            "closed": self.closed, "evidence": self.evidence,
            "decided_by": self.decided_by, "decided_at": self.decided_at, "note": self.note,
        }


class RealModeGuard:
    def __init__(self, db: Database, journal: Journal, audit: AuditLog,
                 owner_gate: OwnerGate, allow_real_setting: bool = False):
        self.db = db
        self.journal = journal
        self.audit = audit
        self.owner = owner_gate
        self.allow_real_setting = allow_real_setting
        self._lock = threading.RLock()
        self._environment = self._load_environment()
        self._validations = self._load_validations()

    # -- stockage --------------------------------------------------------
    def _load_environment(self) -> str:
        raw = self.db.scalar("SELECT value FROM settings_kv WHERE key='environment'", default=None)
        if raw and raw in ENVIRONMENTS:
            # Un redémarrage ne doit jamais réactiver un environnement réel (section 4).
            if raw in REAL_ENVIRONMENTS and not self._real_ready_static(raw):
                self.journal.warning(
                    "guard", "REAL_MODE_RESET",
                    f"environnement {raw} détecté au démarrage sans validations complètes : "
                    "retour forcé en SIMULATION")
                self._persist_environment(ENV_SIMULATION)
                return ENV_SIMULATION
            return raw
        self._persist_environment(DEFAULT_ENV)
        return DEFAULT_ENV

    def _real_ready_static(self, requested: str) -> bool:
        return False  # les validations sont vérifiées après chargement complet

    def _load_validations(self) -> dict[str, Validation]:
        raw = self.db.scalar("SELECT value FROM settings_kv WHERE key='validations'", default=None)
        data = json.loads(raw) if raw else {}
        return {
            key: Validation(
                key=key, closed=bool(data.get(key, {}).get("closed", False)),
                evidence=data.get(key, {}).get("evidence", ""),
                decided_by=data.get(key, {}).get("decided_by"),
                decided_at=data.get(key, {}).get("decided_at"),
                note=data.get(key, {}).get("note", ""),
            )
            for key in VALIDATIONS
        }

    def _persist_environment(self, env: str) -> None:
        self.db.execute(
            "INSERT INTO settings_kv(key, value, updated_at) VALUES('environment', ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (env, iso(now_utc())),
        )

    def _persist_validations(self) -> None:
        payload = {key: v.to_dict() for key, v in self._validations.items()}
        self.db.execute(
            "INSERT INTO settings_kv(key, value, updated_at) VALUES('validations', ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (json.dumps(payload, ensure_ascii=False), iso(now_utc())),
        )

    # -- lecture ---------------------------------------------------------
    @property
    def environment(self) -> str:
        return self._environment

    def is_real(self) -> bool:
        return self._environment in REAL_ENVIRONMENTS

    def validations(self) -> dict[str, Any]:
        return {key: v.to_dict() for key, v in self._validations.items()}

    def all_closed(self) -> bool:
        return all(v.closed for v in self._validations.values())

    def status(self) -> dict[str, Any]:
        blockers = []
        if not self.allow_real_setting:
            blockers.append("CARNET_ALLOW_REAL n'est pas activé sur le serveur")
        if not self.owner.configured():
            blockers.append("aucun jeton propriétaire configuré")
        for key, validation in self._validations.items():
            if not validation.closed:
                blockers.append(f"validation manquante : {VALIDATION_LABELS[key]}")
        blockers.append(
            "aucun courtier MT5 ni exchange crypto n'est sélectionné : connecteurs réels non validés")
        return {
            "environment": self._environment,
            "is_real": self.is_real(),
            "real_mode_allowed_by_server": self.allow_real_setting,
            "owner_token_configured": self.owner.configured(),
            "validations": self.validations(),
            "all_validations_closed": self.all_closed(),
            "blockers": blockers,
            "can_activate_real": False,  # V1 : jamais, par construction
        }

    # -- écriture --------------------------------------------------------
    def record_validation(self, key: str, closed: bool, evidence: str, actor: User,
                          note: str = "") -> dict[str, Any]:
        if key not in VALIDATIONS:
            raise AuthError(f"validation inconnue: {key}", "UNKNOWN_VALIDATION", 400)
        if not actor.allows("owner:decide"):
            raise AuthError("décision réservée à un administrateur", "FORBIDDEN", 403)
        if closed and not evidence.strip():
            raise AuthError(
                "une validation ne peut être close sans preuve documentée (section 24)",
                "EVIDENCE_REQUIRED", 400)
        with self._lock:
            self._validations[key] = Validation(
                key=key, closed=closed, evidence=evidence.strip() if closed else "",
                decided_by=actor.username, decided_at=iso(now_utc()), note=note,
            )
            self._persist_validations()
            self.journal.log(
                "WARNING" if closed else "INFO", "guard",
                "VALIDATION_CLOSED" if closed else "VALIDATION_REOPENED",
                f"validation {key} {'close' if closed else 'non close'} par {actor.username}",
                payload={"evidence": evidence, "note": note},
            )
            self.audit.record(actor.username, "validation.record",
                              {"key": key, "closed": closed, "evidence": evidence})
            return self._validations[key].to_dict()

    def request_environment(self, requested: str, actor: User, owner_token: str | None = None,
                            confirmation: str | None = None, account_id: str | None = None,
                            ip: str | None = None) -> dict[str, Any]:
        if requested not in ENVIRONMENTS:
            raise AuthError(f"environnement inconnu: {requested}", "UNKNOWN_ENVIRONMENT", 400)
        with self._lock:
            if requested in REAL_ENVIRONMENTS:
                reasons: list[str] = []
                if not self.allow_real_setting:
                    reasons.append("CARNET_ALLOW_REAL=0 sur le serveur")
                if not self.owner.configured():
                    reasons.append("jeton propriétaire absent")
                if not actor.allows("owner:decide"):
                    reasons.append("rôle insuffisant")
                if not actor.totp_enabled:
                    reasons.append("authentification multifacteur non activée")
                if not self.all_closed():
                    reasons.append("validations de la section 24 incomplètes")
                if not account_id:
                    reasons.append("aucun compte réel sélectionné")
                if reasons:
                    self.journal.critical(
                        "guard", "REAL_MODE_DENIED",
                        "activation réelle refusée : " + " ; ".join(reasons),
                        payload={"requested": requested, "actor": actor.username})
                    raise AuthError(
                        "activation du mode réel refusée : " + " ; ".join(reasons),
                        "REAL_MODE_DENIED", 403)
                # Les trois couches sont franchies : on exige alors la preuve propriétaire.
                self.owner.verify(owner_token, confirmation)
                # En V1, aucun connecteur réel validé n'existe : refus explicite.
                self.journal.critical(
                    "guard", "REAL_MODE_DENIED",
                    "aucun connecteur réel validé : le mode réel reste impossible en V1",
                    payload={"requested": requested})
                raise AuthError(
                    "aucun connecteur réel validé (courtier et exchange non sélectionnés) : "
                    "le mode réel reste impossible en V1", "REAL_CONNECTOR_NOT_READY", 409)
            if requested == self._environment:
                return self.status()
            previous = self._environment
            self._environment = requested
            self._persist_environment(requested)
            self.journal.warning(
                "guard", "ENVIRONMENT_CHANGED",
                f"environnement {previous} -> {requested} par {actor.username}",
                payload={"from": previous, "to": requested, "account_id": account_id})
            self.audit.record(actor.username, "environment.change",
                              {"from": previous, "to": requested}, ip)
            return self.status()

    # -- garde d'exécution ----------------------------------------------
    def assert_order_allowed(self, environment: str) -> None:
        """Appelé par les connecteurs et le gestionnaire d'ordres avant tout envoi."""
        if environment in REAL_ENVIRONMENTS:
            raise PermissionError(
                "ordre réel interdit : aucun connecteur réel validé, validations section 24 non closes")
        if environment not in (ENV_SIMULATION, "DEMO"):
            raise PermissionError(f"environnement inconnu pour un ordre: {environment}")
