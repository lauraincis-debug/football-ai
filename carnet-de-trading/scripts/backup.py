#!/usr/bin/env python3
"""Sauvegardes et restaurations en ligne de commande (section 17.3).

Exemples :
    python3 scripts/backup.py create --label manuel
    python3 scripts/backup.py list
    python3 scripts/backup.py verify var/backups/carnet-manuel-....sqlite3.gz
    python3 scripts/backup.py drill
    python3 scripts/backup.py restore var/backups/carnet-manuel-....sqlite3.gz --force

La restauration en production est réservée aux arrêts de service : le script
refuse de réécrire la base si un serveur carnet.server est actif (utiliser
scripts/restore.sh, qui contrôle et sauvegarde l'état courant).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from carnet.backup import BackupError, BackupManager  # noqa: E402
from carnet.config import default_settings  # noqa: E402
from carnet.db import Database  # noqa: E402
from carnet.journal import Journal  # noqa: E402


def manager(settings=None) -> BackupManager:
    settings = settings or default_settings()
    settings.ensure_dirs()
    db = Database(settings.db_path)
    db.migrate()
    return BackupManager(db, settings.backup_dir, Journal(db))


def cmd_create(args) -> int:
    record = manager().create(args.label)
    print(f"Sauvegarde créée : {record.path}")
    print(f"  taille   : {record.size_bytes} octets")
    print(f"  chiffrée : {record.encrypted}")
    print(f"  sha256   : {record.sha256}")
    return 0


def cmd_list(_args) -> int:
    records = manager().list()
    if not records:
        print("Aucune sauvegarde enregistrée.")
        return 0
    for record in records:
        flag = "chiffrée" if record.encrypted else "claire"
        print(f"{record.created_at}  {record.size_bytes:>10} o  {flag:8}  {record.path}")
    return 0


def cmd_verify(args) -> int:
    try:
        info = manager().verify(args.path)
    except BackupError as exc:
        print(f"ÉCHEC : {exc}", file=sys.stderr)
        return 2
    print("Sauvegarde valide.")
    for key, value in info.items():
        print(f"  {key:12}: {value}")
    return 0


def cmd_drill(_args) -> int:
    result = manager().drill()
    print("Exercice de restauration réussi.")
    for key, value in result.items():
        print(f"  {key:16}: {value}")
    return 0


def cmd_restore(args) -> int:
    if not args.force:
        print("Restauration refusée : ajoutez --force après avoir arrêté le service "
              "(scripts/restore.sh).", file=sys.stderr)
        return 3
    settings = default_settings()
    backup_manager = manager(settings)
    print(f"Restauration de {args.path} vers {settings.db_path}")
    result = backup_manager.restore(args.path, args.destination)
    print("Restauration terminée et vérifiée.")
    for key, value in result.items():
        print(f"  {key:12}: {value}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sauvegardes Carnet de Trading")
    sub = parser.add_subparsers(dest="command", required=True)

    create = sub.add_parser("create", help="créer une sauvegarde")
    create.add_argument("--label", default="manuel")
    create.set_defaults(func=cmd_create)

    listing = sub.add_parser("list", help="lister les sauvegardes")
    listing.set_defaults(func=cmd_list)

    verify = sub.add_parser("verify", help="vérifier une sauvegarde")
    verify.add_argument("path")
    verify.set_defaults(func=cmd_verify)

    drill = sub.add_parser("drill", help="exercice de restauration (sans toucher la prod)")
    drill.set_defaults(func=cmd_drill)

    restore = sub.add_parser("restore", help="restaurer une sauvegarde")
    restore.add_argument("path")
    restore.add_argument("--destination", default=None)
    restore.add_argument("--force", action="store_true")
    restore.set_defaults(func=cmd_restore)

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except BackupError as exc:
        print(f"ÉCHEC : {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
