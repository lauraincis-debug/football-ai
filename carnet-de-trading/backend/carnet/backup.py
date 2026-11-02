"""Sauvegardes chiffrées, vérification d'intégrité et test de restauration (section 20.2).

Contraintes du cahier des charges :
- sauvegarde cohérente via l'API SQLite (jamais une copie naïve d'un fichier WAL) ;
- chiffrement au repos et copie hors du serveur principal ;
- 30 sauvegardes quotidiennes par défaut, avec vérification d'intégrité ;
- test de restauration réel, exécuté périodiquement (RPO 5 min, RTO 30 min).

Chiffrement. En l'absence de GPG sur l'hôte, le module applique un chiffrement
authentifié maison, construit uniquement sur des primitives standard :
HKDF-like dérivation (PBKDF2-HMAC-SHA256), flot de chiffrement HMAC-SHA256 en
mode compteur (encrypt-then-MAC). Le format est versionné ; GPG reste
recommandé en production et documenté dans ``docs/OPERATIONS.md``.
"""

from __future__ import annotations

import gzip
import hashlib
import hmac
import json
import os
import shutil
import sqlite3
import struct
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .db import Database
from .journal import Journal
from .util import iso, now_utc, sha256_hex

MAGIC = b"CDTB1"
SALT_LEN = 16
NONCE_LEN = 16
MAC_LEN = 32
PBKDF2_ROUNDS = 200_000


class BackupError(Exception):
    pass


def _derive_keys(passphrase: str, salt: bytes) -> tuple[bytes, bytes]:
    material = hashlib.pbkdf2_hmac("sha256", passphrase.encode(), salt, PBKDF2_ROUNDS, dklen=64)
    return material[:32], material[32:]


def _keystream(key: bytes, nonce: bytes, length: int) -> bytes:
    chunks = []
    counter = 0
    while sum(len(c) for c in chunks) < length:
        chunks.append(hmac.new(key, nonce + struct.pack(">Q", counter), hashlib.sha256).digest())
        counter += 1
    return b"".join(chunks)[:length]


def encrypt_blob(plaintext: bytes, passphrase: str) -> bytes:
    salt = os.urandom(SALT_LEN)
    nonce = os.urandom(NONCE_LEN)
    enc_key, mac_key = _derive_keys(passphrase, salt)
    stream = _keystream(enc_key, nonce, len(plaintext))
    ciphertext = bytes(a ^ b for a, b in zip(plaintext, stream))
    mac = hmac.new(mac_key, salt + nonce + ciphertext, hashlib.sha256).digest()
    return MAGIC + salt + nonce + mac + ciphertext


def decrypt_blob(blob: bytes, passphrase: str) -> bytes:
    if not blob.startswith(MAGIC):
        raise BackupError("format de sauvegarde inconnu")
    body = blob[len(MAGIC):]
    salt, nonce, mac, ciphertext = (
        body[:SALT_LEN], body[SALT_LEN:SALT_LEN + NONCE_LEN],
        body[SALT_LEN + NONCE_LEN:SALT_LEN + NONCE_LEN + MAC_LEN],
        body[SALT_LEN + NONCE_LEN + MAC_LEN:],
    )
    enc_key, mac_key = _derive_keys(passphrase, salt)
    expected = hmac.new(mac_key, salt + nonce + ciphertext, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, mac):
        raise BackupError("authentification de la sauvegarde échouée (mot de passe ou altération)")
    stream = _keystream(enc_key, nonce, len(ciphertext))
    return bytes(a ^ b for a, b in zip(ciphertext, stream))


@dataclass
class BackupRecord:
    name: str
    path: str
    size_bytes: int
    created_at: str
    encrypted: bool
    sha256: str

    def to_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


class BackupManager:
    def __init__(self, db: Database, backup_dir: Path, journal: Journal | None = None,
                 keep: int = 30, passphrase: str | None = None):
        self.db = db
        self.backup_dir = Path(backup_dir)
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        self.journal = journal
        self.keep = keep
        self._lock = threading.Lock()
        self._passphrase = passphrase or os.environ.get("CARNET_BACKUP_PASSPHRASE") or None

    # -- création --------------------------------------------------------
    def create(self, label: str = "daily") -> BackupRecord:
        with self._lock:
            stamp = now_utc().strftime("%Y%m%dT%H%M%SZ")
            name = f"carnet-{label}-{stamp}"
            raw_path = self.backup_dir / f"{name}.sqlite3"
            self.db.backup_to(raw_path)
            self._verify_sqlite(raw_path)
            payload = raw_path.read_bytes()
            raw_path.unlink(missing_ok=True)
            digest = sha256_hex(payload)
            encrypted = bool(self._passphrase)
            if encrypted:
                data = encrypt_blob(gzip.compress(payload, compresslevel=6), self._passphrase or "")
                path = self.backup_dir / f"{name}.cdtb"
            else:
                data = gzip.compress(payload, compresslevel=6)
                path = self.backup_dir / f"{name}.sqlite3.gz"
            path.write_bytes(data)
            try:
                path.chmod(0o600)
            except OSError:  # pragma: no cover
                pass
            manifest = self.backup_dir / "manifest.jsonl"
            record = BackupRecord(
                name=name, path=str(path), size_bytes=len(data),
                created_at=iso(now_utc()), encrypted=encrypted, sha256=digest)
            with manifest.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record.to_dict(), ensure_ascii=False) + "\n")
            self._prune()
            if self.journal:
                self.journal.info(
                    "backup", "BACKUP_CREATED",
                    f"sauvegarde {name} créée ({len(data)} octets, chiffrée={encrypted})",
                    payload=record.to_dict())
            return record

    def _verify_sqlite(self, path: Path) -> None:
        try:
            conn = sqlite3.connect(str(path))
            try:
                result = conn.execute("PRAGMA integrity_check").fetchone()[0]
            finally:
                conn.close()
        except sqlite3.Error as exc:
            raise BackupError(f"sauvegarde illisible : {exc}") from exc
        if result != "ok":
            raise BackupError(f"sauvegarde corrompue : integrity_check={result}")

    def _prune(self) -> None:
        records = self.list()
        for record in records[self.keep:]:
            Path(record.path).unlink(missing_ok=True)

    # -- lecture ---------------------------------------------------------
    def list(self) -> list[BackupRecord]:
        manifest = self.backup_dir / "manifest.jsonl"
        records: list[BackupRecord] = []
        if manifest.exists():
            for line in manifest.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    record = BackupRecord(**data)
                except (json.JSONDecodeError, TypeError):
                    continue
                if Path(record.path).exists():
                    records.append(record)
        records.sort(key=lambda r: r.created_at, reverse=True)
        return records

    # -- restauration ----------------------------------------------------
    def verify(self, path: str | Path) -> dict[str, Any]:
        target = Path(path)
        try:
            blob = target.read_bytes()
        except OSError as exc:
            raise BackupError(f"sauvegarde introuvable : {exc}") from exc
        try:
            if blob.startswith(MAGIC):
                if not self._passphrase:
                    raise BackupError("sauvegarde chiffrée : phrase de passe absente")
                payload = decrypt_blob(blob, self._passphrase)
                plain = gzip.decompress(payload)
            else:
                plain = gzip.decompress(blob)
        except BackupError:
            raise
        except Exception as exc:  # déchiffrement ou décompression invalide
            raise BackupError(f"sauvegarde illisible ou altérée : {exc}") from exc
        tmp = self.backup_dir / f".verify-{os.getpid()}.sqlite3"
        tmp.write_bytes(plain)
        try:
            self._verify_sqlite(tmp)
            conn = sqlite3.connect(str(tmp))
            try:
                tables = conn.execute(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
                journal_rows = conn.execute("SELECT COUNT(*) FROM journal").fetchone()[0]
            finally:
                conn.close()
        finally:
            tmp.unlink(missing_ok=True)
        return {"ok": True, "tables": tables, "journal_rows": journal_rows,
                "sha256": sha256_hex(plain), "size_bytes": len(plain)}

    def restore(self, path: str | Path, destination: str | Path | None = None) -> dict[str, Any]:
        """Restaure une sauvegarde vérifiée, dans un fichier cible ou en production."""
        target = Path(path)
        info = self.verify(target)
        blob = target.read_bytes()
        plain = (gzip.decompress(decrypt_blob(blob, self._passphrase or ""))
                 if blob.startswith(MAGIC) else gzip.decompress(blob))
        destination = Path(destination) if destination else Path(self.db.path)
        tmp = destination.with_suffix(".restore-tmp")
        tmp.write_bytes(plain)
        self._verify_sqlite(tmp)
        if self.journal:
            self.journal.warning("backup", "RESTORE_STARTED",
                                 f"restauration de {target.name} vers {destination}")
        shutil.move(str(tmp), str(destination))
        try:
            destination.chmod(0o600)
        except OSError:  # pragma: no cover
            pass
        if self.journal:
            self.journal.warning("backup", "RESTORE_DONE", "restauration terminée et vérifiée",
                                 payload=info)
        return {"restored": True, "destination": str(destination), **info}

    def drill(self, temporary_dir: str | Path | None = None) -> dict[str, Any]:
        """Exercice de restauration : prouve le RTO sans toucher la base active."""
        started = time.perf_counter()
        directory = Path(temporary_dir) if temporary_dir else self.backup_dir / "drill"
        directory.mkdir(parents=True, exist_ok=True)
        record = self.create(label="drill")
        destination = directory / "restored.sqlite3"
        info = self.restore(record.path, destination)
        size = destination.stat().st_size
        destination.unlink(missing_ok=True)
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        if self.journal:
            self.journal.info(
                "backup", "BACKUP_DRILL_OK",
                f"exercice de restauration réussi en {duration_ms} ms",
                payload={"backup": record.name, "restored_bytes": size,
                         "duration_ms": duration_ms})
        return {"ok": True, "backup": record.name, "restored_bytes": size,
                "duration_ms": duration_ms, **info}
