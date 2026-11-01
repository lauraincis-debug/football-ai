"""Authentification, rôles, MFA TOTP, sessions et limitation de débit (section 17).

Aucun secret n'est stocké en clair :
- mots de passe : PBKDF2-HMAC-SHA256, 210 000 itérations, sel aléatoire ;
- sessions et jetons d'API : seul le SHA-256 du jeton est persisté ;
- TOTP : secret Base32, vérification à fenêtre ±1 pas (30 s).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import struct
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable

from .db import Database
from .util import iso, new_uuid, now_utc, parse_iso, sha256_hex

PBKDF2_ITERATIONS = 210_000
ROLES = ("ADMIN", "OPERATOR", "VIEWER")
ROLE_RANK = {"VIEWER": 1, "OPERATOR": 2, "ADMIN": 3}

#: Permissions par rôle (section 18).
PERMISSIONS: dict[str, frozenset[str]] = {
    "VIEWER": frozenset({
        "state:read", "market:read", "positions:read", "orders:read",
        "journal:read", "strategies:read", "backtest:read", "risk:read",
    }),
    "OPERATOR": frozenset({
        "state:read", "market:read", "positions:read", "orders:read",
        "journal:read", "strategies:read", "backtest:read", "backtest:run",
        "risk:read", "control:stop-trading", "control:resume",
        "control:liquidate", "strategies:toggle", "diagnostics:read",
    }),
    "ADMIN": frozenset({
        "state:read", "market:read", "positions:read", "orders:read",
        "journal:read", "journal:verify", "strategies:read", "strategies:toggle",
        "backtest:read", "backtest:run", "risk:read", "risk:write",
        "control:stop-trading", "control:resume", "control:liquidate",
        "diagnostics:read", "settings:write", "users:manage",
        "backup:run", "backup:restore", "policy:write", "owner:decide",
        "connection:manage",
    }),
}


class AuthError(Exception):
    def __init__(self, message: str, code: str = "AUTH_FAILED", status: int = 401):
        super().__init__(message)
        self.code = code
        self.status = status


class PermissionError_(AuthError):
    def __init__(self, permission: str):
        super().__init__(f"permission refusée : {permission}", "FORBIDDEN", 403)
        self.permission = permission


# --------------------------------------------------------------------------
# Mots de passe
# --------------------------------------------------------------------------
def hash_password(password: str, salt: bytes | None = None,
                  iterations: int = PBKDF2_ITERATIONS) -> tuple[str, str]:
    if len(password) < 8:
        raise ValueError("mot de passe trop court (8 caractères minimum)")
    salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return digest.hex(), salt.hex()


def verify_password(password: str, password_hash: str, salt_hex: str,
                    iterations: int = PBKDF2_ITERATIONS) -> bool:
    try:
        salt = bytes.fromhex(salt_hex)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(digest.hex(), password_hash)


def password_strength(password: str) -> dict[str, Any]:
    score = 0
    checks = {
        "length": len(password) >= 12,
        "lower": any(c.islower() for c in password),
        "upper": any(c.isupper() for c in password),
        "digit": any(c.isdigit() for c in password),
        "symbol": any(not c.isalnum() for c in password),
    }
    score = sum(checks.values()) * 20
    return {"score": score, "checks": checks, "ok": len(password) >= 12 and score >= 60}


# --------------------------------------------------------------------------
# TOTP (RFC 6238) — aucune dépendance externe
# --------------------------------------------------------------------------
def generate_totp_secret(length: int = 20) -> str:
    return base64.b32encode(os.urandom(length)).decode("ascii").rstrip("=")


def _totp_code(secret: str, counter: int, digits: int = 6) -> str:
    padded = secret + "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(padded, casefold=True)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(code % (10 ** digits)).zfill(digits)


def totp_now(secret: str, at: float | None = None, period: int = 30, digits: int = 6) -> str:
    counter = int((at if at is not None else time.time()) // period)
    return _totp_code(secret, counter, digits)


def verify_totp(secret: str | None, code: str, window: int = 1,
                at: float | None = None, period: int = 30) -> bool:
    if not secret or not code:
        return False
    code = str(code).strip().replace(" ", "")
    if not code.isdigit():
        return False
    now = at if at is not None else time.time()
    counter = int(now // period)
    for drift in range(-window, window + 1):
        if hmac.compare_digest(_totp_code(secret, counter + drift), code):
            return True
    return False


def otpauth_uri(username: str, secret: str, issuer: str = "Carnet de Trading") -> str:
    label = f"{issuer}:{username}".replace(" ", "%20")
    return (f"otpauth://totp/{label}?secret={secret}&issuer={issuer.replace(' ', '%20')}"
            f"&algorithm=SHA1&digits=6&period=30")


# --------------------------------------------------------------------------
# Limitation de débit
# --------------------------------------------------------------------------
class RateLimiter:
    """Fenêtre glissante simple, en mémoire, par clé (IP ou utilisateur)."""

    def __init__(self, limit: int = 8, window_seconds: int = 300):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, cost: int = 1) -> bool:
        now = time.time()
        with self._lock:
            bucket = [t for t in self._hits.get(key, []) if now - t < self.window]
            if len(bucket) + cost > self.limit:
                self._hits[key] = bucket
                return False
            bucket.extend([now] * cost)
            self._hits[key] = bucket
            return True

    def retry_after(self, key: str) -> int:
        with self._lock:
            bucket = self._hits.get(key, [])
            if not bucket:
                return 0
            return max(0, int(self.window - (time.time() - min(bucket))))

    def reset(self, key: str | None = None) -> None:
        with self._lock:
            if key is None:
                self._hits.clear()
            else:
                self._hits.pop(key, None)


# --------------------------------------------------------------------------
# Utilisateurs
# --------------------------------------------------------------------------
@dataclass
class User:
    id: int
    username: str
    role: str
    totp_enabled: bool
    must_change: bool

    def allows(self, permission: str) -> bool:
        return permission in PERMISSIONS.get(self.role, frozenset())

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "username": self.username, "role": self.role,
            "totp_enabled": self.totp_enabled, "must_change_password": self.must_change,
            "permissions": sorted(PERMISSIONS.get(self.role, frozenset())),
        }


class UserStore:
    def __init__(self, db: Database):
        self.db = db

    def count(self) -> int:
        return int(self.db.scalar("SELECT COUNT(*) FROM users", default=0))

    def create(self, username: str, password: str, role: str = "VIEWER",
               must_change: bool = False) -> User:
        if role not in ROLES:
            raise ValueError(f"rôle inconnu: {role}")
        if not username or len(username) < 3:
            raise ValueError("nom d'utilisateur trop court")
        digest, salt = hash_password(password)
        self.db.execute(
            "INSERT INTO users(username, password_hash, password_salt, role, must_change, created_at)"
            " VALUES(?,?,?,?,?,?)",
            (username, digest, salt, role, int(must_change), iso(now_utc())),
        )
        return self.get(username)  # type: ignore[return-value]

    def get(self, username: str) -> User | None:
        row = self.db.query_one("SELECT * FROM users WHERE username=?", (username,))
        return self._to_user(row) if row else None

    def get_by_id(self, user_id: int) -> User | None:
        row = self.db.query_one("SELECT * FROM users WHERE id=?", (user_id,))
        return self._to_user(row) if row else None

    def list(self) -> list[User]:
        return [self._to_user(r) for r in self.db.query("SELECT * FROM users ORDER BY username")]

    def _to_user(self, row) -> User:
        return User(
            id=row["id"], username=row["username"], role=row["role"],
            totp_enabled=bool(row["totp_enabled"]), must_change=bool(row["must_change"]),
        )

    def authenticate(self, username: str, password: str, code: str | None = None) -> User:
        row = self.db.query_one("SELECT * FROM users WHERE username=?", (username,))
        if not row:
            # Comparaison factice pour garder un temps de réponse constant.
            verify_password(password, "0" * 64, "00" * 16)
            raise AuthError("identifiants invalides", "BAD_CREDENTIALS")
        locked = parse_iso(row["locked_until"])
        if locked and locked > now_utc():
            raise AuthError("compte temporairement verrouillé", "ACCOUNT_LOCKED", 423)
        if not verify_password(password, row["password_hash"], row["password_salt"]):
            self._register_failure(row)
            raise AuthError("identifiants invalides", "BAD_CREDENTIALS")
        if row["totp_enabled"]:
            if not verify_totp(row["totp_secret"], code or ""):
                self._register_failure(row)
                raise AuthError("code MFA invalide", "MFA_REQUIRED")
        self.db.execute(
            "UPDATE users SET failed_count=0, locked_until=NULL, last_login_at=? WHERE id=?",
            (iso(now_utc()), row["id"]),
        )
        return self._to_user(row)

    def _register_failure(self, row) -> None:
        failures = int(row["failed_count"]) + 1
        locked_until = None
        if failures >= 5:
            locked_until = iso(now_utc().replace(microsecond=0))  # placeholder remplacé ci-dessous
            from datetime import timedelta

            locked_until = iso(now_utc() + timedelta(minutes=15))
            failures = 0
        self.db.execute(
            "UPDATE users SET failed_count=?, locked_until=? WHERE id=?",
            (failures, locked_until, row["id"]),
        )

    def set_password(self, username: str, password: str, must_change: bool = False) -> None:
        digest, salt = hash_password(password)
        self.db.execute(
            "UPDATE users SET password_hash=?, password_salt=?, must_change=? WHERE username=?",
            (digest, salt, int(must_change), username),
        )

    def enable_totp(self, username: str, secret: str) -> None:
        self.db.execute("UPDATE users SET totp_secret=?, totp_enabled=1 WHERE username=?",
                        (secret, username))

    def disable_totp(self, username: str) -> None:
        self.db.execute("UPDATE users SET totp_secret=NULL, totp_enabled=0 WHERE username=?", (username,))

    def totp_secret(self, username: str) -> str | None:
        return self.db.scalar("SELECT totp_secret FROM users WHERE username=?", (username,))

    def set_role(self, username: str, role: str) -> None:
        if role not in ROLES:
            raise ValueError("rôle invalide")
        self.db.execute("UPDATE users SET role=? WHERE username=?", (role, username))


# --------------------------------------------------------------------------
# Sessions
# --------------------------------------------------------------------------
@dataclass
class Session:
    id: str
    user: User
    created_at: str
    expires_at: str
    ip: str | None
    user_agent: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "user": self.user.to_dict(), "created_at": self.created_at,
            "expires_at": self.expires_at, "ip": self.ip, "user_agent": self.user_agent,
        }


class SessionStore:
    def __init__(self, db: Database, users: UserStore, ttl_minutes: int = 480):
        self.db = db
        self.users = users
        self.ttl_minutes = ttl_minutes

    def create(self, user: User, ip: str | None = None, user_agent: str | None = None) -> tuple[str, Session]:
        token = secrets.token_urlsafe(32)
        from datetime import timedelta

        created = now_utc()
        expires = created + timedelta(minutes=self.ttl_minutes)
        session_id = new_uuid()
        self.db.execute(
            "INSERT INTO sessions(id, token_hash, user_id, created_at, expires_at, ip, user_agent)"
            " VALUES(?,?,?,?,?,?,?)",
            (session_id, sha256_hex(token), user.id, iso(created), iso(expires), ip, (user_agent or "")[:200]),
        )
        return token, Session(session_id, user, iso(created), iso(expires), ip, user_agent)

    def resolve(self, token: str | None) -> Session | None:
        if not token:
            return None
        row = self.db.query_one(
            "SELECT * FROM sessions WHERE token_hash=? AND revoked=0", (sha256_hex(token),))
        if not row:
            return None
        expires = parse_iso(row["expires_at"])
        if not expires or expires <= now_utc():
            return None
        user = self.users.get_by_id(row["user_id"])
        if not user:
            return None
        return Session(row["id"], user, row["created_at"], row["expires_at"], row["ip"], row["user_agent"])

    def revoke(self, token: str | None = None, session_id: str | None = None) -> int:
        if token:
            return self.db.execute("UPDATE sessions SET revoked=1 WHERE token_hash=?",
                                   (sha256_hex(token),))
        if session_id:
            return self.db.execute("UPDATE sessions SET revoked=1 WHERE id=?", (session_id,))
        return 0

    def revoke_user(self, user_id: int) -> int:
        return self.db.execute("UPDATE sessions SET revoked=1 WHERE user_id=?", (user_id,))

    def purge_expired(self) -> int:
        return self.db.execute("DELETE FROM sessions WHERE expires_at < ?", (iso(now_utc()),))

    def active(self) -> list[dict[str, Any]]:
        rows = self.db.query(
            "SELECT s.*, u.username, u.role FROM sessions s JOIN users u ON u.id=s.user_id"
            " WHERE s.revoked=0 AND s.expires_at >= ? ORDER BY s.created_at DESC",
            (iso(now_utc()),),
        )
        return [dict(r) for r in rows]


# --------------------------------------------------------------------------
# Autorisation propriétaire (décisions réservées, section 1.3)
# --------------------------------------------------------------------------
class OwnerGate:
    """Vérifie qu'une décision réservée au propriétaire est bien autorisée.

    Le jeton propriétaire n'est jamais stocké en base ni journalisé : il est lu
    dans l'environnement ou dans ``var/owner_token`` (droits 600).
    """

    PHRASE = "JE CONFIRME CETTE DECISION PROPRIETAIRE"

    def __init__(self, var_dir, environment_token: str | None = None):
        self.var_dir = var_dir
        self._token = environment_token or os.environ.get("CARNET_OWNER_TOKEN")

    def token(self) -> str | None:
        if self._token:
            return self._token
        path = self.var_dir / "owner_token"
        if path.exists():
            return path.read_text(encoding="utf-8").strip()
        return None

    def configured(self) -> bool:
        return bool(self.token())

    def verify(self, provided: str | None, phrase: str | None = None) -> None:
        expected = self.token()
        if not expected:
            raise AuthError(
                "aucun jeton propriétaire configuré : décision réservée impossible",
                "OWNER_TOKEN_MISSING", 403,
            )
        if not provided or not hmac.compare_digest(str(provided), expected):
            raise AuthError("jeton propriétaire invalide", "OWNER_TOKEN_INVALID", 403)
        if phrase is not None and phrase.strip().upper() != self.PHRASE:
            raise AuthError("phrase de confirmation incorrecte", "OWNER_PHRASE_INVALID", 400)


# --------------------------------------------------------------------------
# Jetons d'API machine à machine (permissions minimales)
# --------------------------------------------------------------------------
class ApiTokenStore:
    def __init__(self, db: Database):
        self.db = db

    def create(self, name: str, role: str = "VIEWER") -> tuple[str, dict[str, Any]]:
        if role not in ROLES:
            raise ValueError("rôle invalide")
        token = f"cdt_{secrets.token_urlsafe(32)}"
        token_id = new_uuid()
        created = iso(now_utc())
        self.db.execute(
            "INSERT INTO api_tokens(id, name, token_hash, role, created_at) VALUES(?,?,?,?,?)",
            (token_id, name, sha256_hex(token), role, created),
        )
        return token, {"id": token_id, "name": name, "role": role, "created_at": created}

    def resolve(self, token: str | None) -> User | None:
        if not token:
            return None
        row = self.db.query_one(
            "SELECT * FROM api_tokens WHERE token_hash=? AND revoked=0", (sha256_hex(token),))
        if not row:
            return None
        self.db.execute("UPDATE api_tokens SET last_used_at=? WHERE id=?",
                        (iso(now_utc()), row["id"]))
        return User(id=-1, username=f"api:{row['name']}", role=row["role"],
                    totp_enabled=False, must_change=False)

    def list(self) -> list[dict[str, Any]]:
        rows = self.db.query("SELECT id, name, role, created_at, revoked, last_used_at FROM api_tokens")
        return [dict(r) for r in rows]

    def revoke(self, token_id: str) -> int:
        return self.db.execute("UPDATE api_tokens SET revoked=1 WHERE id=?", (token_id,))


def require(permission: str) -> Callable[[User], None]:
    def check(user: User) -> None:
        if not user.allows(permission):
            raise PermissionError_(permission)
    return check
