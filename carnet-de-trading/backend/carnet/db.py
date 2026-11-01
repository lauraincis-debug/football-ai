"""Persistance SQLite en mode WAL (section 20).

Le module expose une petite couche d'accès thread-safe :
- une connexion par opération (SQLite n'aime pas partager une connexion) ;
- WAL, ``synchronous=NORMAL``, ``foreign_keys=ON`` et ``busy_timeout`` ;
- un schéma versionné, migré de façon idempotente ;
- une sauvegarde cohérente via l'API ``sqlite3.Connection.backup`` (jamais une
  copie naïve d'un fichier actif, section 20.2).
"""

from __future__ import annotations

import contextlib
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence

from .util import now_utc, iso

SCHEMA_VERSION = 1

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS schema_meta (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('ADMIN','OPERATOR','VIEWER')),
    totp_secret   TEXT,
    totp_enabled  INTEGER NOT NULL DEFAULT 0,
    failed_count  INTEGER NOT NULL DEFAULT 0,
    locked_until  TEXT,
    must_change   INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    token_hash  TEXT NOT NULL UNIQUE,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    ip          TEXT,
    user_agent  TEXT,
    revoked     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS accounts (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    market         TEXT NOT NULL,
    environment    TEXT NOT NULL,
    currency       TEXT NOT NULL,
    broker         TEXT,
    is_primary     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_versions (
    version     INTEGER PRIMARY KEY,
    payload     TEXT NOT NULL,
    reason      TEXT,
    created_by  TEXT,
    created_at  TEXT NOT NULL,
    prev_hash   TEXT,
    hash        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS signals (
    id           TEXT PRIMARY KEY,
    strategy     TEXT NOT NULL,
    symbol       TEXT NOT NULL,
    side         TEXT NOT NULL,
    entry_ref    TEXT NOT NULL,
    stop         TEXT NOT NULL,
    target       TEXT NOT NULL,
    confidence   TEXT,
    reasons      TEXT,
    created_at   TEXT NOT NULL,
    expires_at   TEXT,
    consumed     INTEGER NOT NULL DEFAULT 0,
    rejected     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS risk_decisions (
    id           TEXT PRIMARY KEY,
    signal_id    TEXT,
    symbol       TEXT NOT NULL,
    allowed      INTEGER NOT NULL,
    code         TEXT NOT NULL,
    reasons      TEXT,
    sizing       TEXT,
    policy_version INTEGER,
    latency_ms   REAL,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id                 TEXT PRIMARY KEY,
    client_order_id    TEXT NOT NULL UNIQUE,
    platform_order_id  TEXT,
    account_id         TEXT NOT NULL,
    symbol             TEXT NOT NULL,
    side               TEXT NOT NULL,
    order_type         TEXT NOT NULL,
    qty                TEXT NOT NULL,
    filled_qty         TEXT NOT NULL DEFAULT '0',
    limit_price        TEXT,
    requested_price    TEXT,
    avg_fill_price     TEXT,
    stop_price         TEXT,
    target_price       TEXT,
    state              TEXT NOT NULL,
    strategy           TEXT,
    signal_id          TEXT,
    environment        TEXT NOT NULL,
    reject_reason      TEXT,
    fees               TEXT NOT NULL DEFAULT '0',
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    submitted_at       TEXT,
    terminal_at        TEXT,
    payload            TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_state ON orders(state);
CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol);

CREATE TABLE IF NOT EXISTS order_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id    TEXT NOT NULL REFERENCES orders(id),
    from_state  TEXT,
    to_state    TEXT NOT NULL,
    reason      TEXT,
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id);

CREATE TABLE IF NOT EXISTS fills (
    id          TEXT PRIMARY KEY,
    order_id    TEXT NOT NULL REFERENCES orders(id),
    qty         TEXT NOT NULL,
    price       TEXT NOT NULL,
    fee         TEXT NOT NULL DEFAULT '0',
    slippage_bps TEXT,
    external_id TEXT,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
    id            TEXT PRIMARY KEY,
    account_id    TEXT NOT NULL,
    symbol        TEXT NOT NULL,
    side          TEXT NOT NULL,
    qty           TEXT NOT NULL,
    entry_price   TEXT NOT NULL,
    stop_price    TEXT,
    target_price  TEXT,
    opened_at     TEXT NOT NULL,
    closed_at     TEXT,
    close_price   TEXT,
    realized_pnl  TEXT NOT NULL DEFAULT '0',
    fees          TEXT NOT NULL DEFAULT '0',
    status        TEXT NOT NULL CHECK (status IN ('OPEN','CLOSED','ORPHAN')),
    order_id      TEXT,
    strategy      TEXT,
    protection_ok INTEGER NOT NULL DEFAULT 0,
    close_reason  TEXT,
    unrealized_pnl TEXT
);

CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);

CREATE TABLE IF NOT EXISTS equity_snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  TEXT NOT NULL,
    balance     TEXT NOT NULL,
    equity      TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS journal (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    level      TEXT NOT NULL,
    module     TEXT NOT NULL,
    event      TEXT NOT NULL,
    message    TEXT NOT NULL,
    order_id   TEXT,
    position_id TEXT,
    payload    TEXT,
    prev_hash  TEXT NOT NULL,
    hash       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_journal_created ON journal(created_at);

CREATE TABLE IF NOT EXISTS notifications (
    id         TEXT PRIMARY KEY,
    level      TEXT NOT NULL,
    code       TEXT NOT NULL,
    title      TEXT NOT NULL,
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read_at    TEXT,
    delivered  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reconciliations (
    id         TEXT PRIMARY KEY,
    status     TEXT NOT NULL,
    details    TEXT,
    created_at TEXT NOT NULL,
    duration_ms REAL
);

CREATE TABLE IF NOT EXISTS backtests (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    status      TEXT NOT NULL,
    config      TEXT NOT NULL,
    metrics     TEXT,
    created_by  TEXT,
    created_at  TEXT NOT NULL,
    finished_at TEXT,
    error       TEXT
);

CREATE TABLE IF NOT EXISTS settings_kv (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    actor      TEXT,
    action     TEXT NOT NULL,
    detail     TEXT,
    ip         TEXT,
    hash       TEXT NOT NULL,
    prev_hash  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_tokens (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    token_hash  TEXT NOT NULL,
    role        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    revoked     INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT
);
"""


class Database:
    """Accès SQLite thread-safe avec WAL et sauvegarde en ligne."""

    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._write_lock = threading.RLock()
        self._closed = False

    # -- connexions ------------------------------------------------------
    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.path), timeout=15.0, isolation_level=None,
                               check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=8000")
        conn.execute("PRAGMA wal_autocheckpoint=512")
        return conn

    @contextlib.contextmanager
    def cursor(self, write: bool = False) -> Iterator[sqlite3.Cursor]:
        gate = self._write_lock if write else contextlib.nullcontext()
        with gate:
            conn = self.connect()
            try:
                yield conn.cursor()
            finally:
                conn.close()

    @contextlib.contextmanager
    def transaction(self) -> Iterator[sqlite3.Cursor]:
        """Transaction explicite en écriture, annulée en cas d'exception."""
        with self._write_lock:
            conn = self.connect()
            try:
                conn.execute("BEGIN IMMEDIATE")
                yield conn
                conn.execute("COMMIT")
            except Exception:
                with contextlib.suppress(Exception):
                    conn.execute("ROLLBACK")
                raise
            finally:
                conn.close()

    # -- helpers ---------------------------------------------------------
    def query(self, sql: str, params: Sequence[Any] = ()) -> list[sqlite3.Row]:
        with self.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()

    def query_one(self, sql: str, params: Sequence[Any] = ()) -> sqlite3.Row | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def execute(self, sql: str, params: Sequence[Any] = ()) -> int:
        with self.cursor(write=True) as cur:
            cur.execute(sql, params)
            return cur.rowcount

    def executemany(self, sql: str, rows: Iterable[Sequence[Any]]) -> int:
        with self.cursor(write=True) as cur:
            cur.executemany(sql, list(rows))
            return cur.rowcount

    def scalar(self, sql: str, params: Sequence[Any] = (), default: Any = None) -> Any:
        row = self.query_one(sql, params)
        if row is None:
            return default
        value = row[0]
        return default if value is None else value

    # -- schéma ----------------------------------------------------------
    def migrate(self) -> int:
        with self._write_lock:
            conn = self.connect()
            try:
                conn.executescript(SCHEMA_SQL)
                current = int(conn.execute(
                    "PRAGMA user_version").fetchone()[0])
                if current < SCHEMA_VERSION:
                    conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
                conn.execute(
                    "INSERT INTO schema_meta(key, value) VALUES('schema_version', ?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (str(SCHEMA_VERSION),),
                )
                conn.execute(
                    "INSERT INTO schema_meta(key, value) VALUES('migrated_at', ?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (iso(now_utc()),),
                )
            finally:
                conn.close()
        return SCHEMA_VERSION

    def schema_version(self) -> int:
        try:
            return int(self.scalar("PRAGMA user_version", default=0) or 0)
        except sqlite3.Error:  # pragma: no cover
            return 0

    # -- sauvegarde ------------------------------------------------------
    def backup_to(self, destination: Path | str) -> Path:
        """Sauvegarde cohérente à chaud via l'API SQLite de sauvegarde."""
        dest = Path(destination)
        dest.parent.mkdir(parents=True, exist_ok=True)
        src = self.connect()
        target = sqlite3.connect(str(dest))
        try:
            src.backup(target)
            target.execute("PRAGMA journal_mode=DELETE")
        finally:
            target.close()
            src.close()
        return dest

    def integrity_check(self) -> str:
        return str(self.scalar("PRAGMA integrity_check", default="unknown"))

    def stats(self) -> dict[str, Any]:
        size = self.path.stat().st_size if self.path.exists() else 0
        wal = self.path.with_suffix(self.path.suffix + "-wal")
        return {
            "path": str(self.path),
            "size_bytes": size,
            "wal_size_bytes": wal.stat().st_size if wal.exists() else 0,
            "journal_mode": self.scalar("PRAGMA journal_mode", default="?"),
            "schema_version": self.schema_version(),
            "integrity": self.integrity_check(),
            "threads": threading.active_count(),
        }

    def wait_ready(self, timeout: float = 10.0) -> bool:
        """Attend que la base réponde (utile au démarrage du service)."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                self.query("SELECT 1")
                return True
            except sqlite3.Error:  # pragma: no cover
                time.sleep(0.1)
        return False

    def close(self) -> None:
        self._closed = True

    # -- utilitaires de test ---------------------------------------------
    def reset(self) -> None:
        """Vide toutes les tables (tests uniquement, jamais exposé par l'API)."""
        tables = [
            "order_events", "fills", "orders", "positions", "signals",
            "risk_decisions", "equity_snapshots", "journal", "notifications",
            "reconciliations", "backtests", "policy_versions", "sessions",
            "api_tokens", "audits", "accounts", "users", "settings_kv",
        ]
        with self._write_lock:
            conn = self.connect()
            try:
                conn.execute("PRAGMA foreign_keys=OFF")
                for table in tables:
                    conn.execute(f"DELETE FROM {table}")
                conn.execute("DELETE FROM sqlite_sequence WHERE name NOT NULL")
                conn.execute("PRAGMA foreign_keys=ON")
            finally:
                conn.close()


def ensure_permissions(path: Path) -> None:
    """Restreint les droits du fichier de base (données d'exécution sensibles)."""
    if path.exists():
        with contextlib.suppress(OSError):
            os.chmod(path, 0o600)
