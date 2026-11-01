"""Point d'entrée du serveur : API + interface web + moteur de trading.

Usage :
    python3 -m carnet.server --port 8080

Le service démarre toujours en environnement SIMULATION. Le moteur tourne dans
un thread séparé ; l'API et l'interface sont servies par le même processus
(le VPS reste la seule source d'exécution, section 8).
"""

from __future__ import annotations

import argparse
import os
import signal
import sys
import threading
import time
from pathlib import Path

from .api import ApiServer
from .config import DEFAULT_ENV, default_settings
from .engine import TradingEngine
from .journal import Notifications
from .util import iso, now_utc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Carnet de Trading — service")
    parser.add_argument("--host", default=None, help="adresse d'écoute (0.0.0.0 par défaut)")
    parser.add_argument("--port", type=int, default=None, help="port HTTP")
    parser.add_argument("--env", default=os.environ.get("CARNET_ENV", DEFAULT_ENV),
                        help="environnement : SIMULATION (défaut) ou DEMO")
    parser.add_argument("--seed", type=int, default=None, help="graine du marché simulé")
    parser.add_argument("--no-engine-thread", action="store_true",
                        help="démarre sans boucle de trading (diagnostic uniquement)")
    parser.add_argument("--no-backup-thread", action="store_true",
                        help="désactive les sauvegardes périodiques")
    return parser


def _backup_loop(engine: TradingEngine, interval_seconds: float = 6 * 3600,
                 drill_every: int = 4) -> None:
    """Sauvegarde périodique hors du chemin critique, avec exercice de restauration."""
    counter = 0
    while True:
        time.sleep(interval_seconds)
        try:
            engine.backups.create(label="auto")
            counter += 1
            if drill_every and counter % drill_every == 0:
                engine.backups.drill()
        except Exception as exc:  # pragma: no cover - dépend du disque
            engine.journal.critical("backup", "BACKUP_FAILED", f"sauvegarde échouée: {exc}")
            engine.notifications.push("CRITICAL", "BACKUP_FAILED", "Sauvegarde échouée",
                                      "Vérifiez l'espace disque et les permissions.")


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = default_settings()
    if args.env:
        settings = settings.__class__(**{**settings.__dict__, "environment": args.env})
    if args.seed is not None:
        settings = settings.__class__(**{**settings.__dict__, "seed": args.seed})
    settings.validate()
    settings.ensure_dirs()

    engine = TradingEngine(settings)
    engine.bootstrap()
    if not args.no_engine_thread:
        engine.start(background=True)

    api = ApiServer(engine, host=args.host or settings.host, port=args.port or settings.port)
    httpd = api.build()

    if not args.no_backup_thread:
        threading.Thread(target=_backup_loop, args=(engine,), name="carnet-backup",
                         daemon=True).start()

    pid_file = settings.var_dir / "carnet.pid"
    pid_file.write_text(str(os.getpid()), encoding="utf-8")

    stop_event = threading.Event()

    def shutdown(signum, frame):  # pragma: no cover - signal handler
        print(f"\n[carnet] arrêt demandé (signal {signum})", flush=True)
        stop_event.set()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    host, port = httpd.server_address[:2]
    print(f"""
╔══════════════════════════════════════════════════════════════════════╗
║  CARNET DE TRADING — plateforme de suivi et d'exécution contrôlée    ║
╠══════════════════════════════════════════════════════════════════════╣
║  Interface   http://{host}:{port}
║  Environnement {engine.guard.environment} — aucun ordre réel possible
║  Données      marché synthétique déterministe (seed {settings.seed})
║  Identifiants var/initial_credentials.txt (créés au premier démarrage)
╚══════════════════════════════════════════════════════════════════════╝
""", flush=True)
    engine.journal.info("server", "SERVER_START",
                        f"API disponible sur http://{host}:{port}",
                        payload={"environment": engine.guard.environment})

    try:
        httpd.serve_forever(poll_interval=0.5)
    finally:
        api.stop()
        engine.shutdown()
        pid_file.unlink(missing_ok=True)
        print("[carnet] service arrêté proprement", flush=True)
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
