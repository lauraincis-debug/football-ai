#!/usr/bin/env bash
# Restauration contrôlée d'une sauvegarde (section 17.3).
#
# La restauration n'est autorisée que service arrêté : ce script refuse de
# réécrire une base utilisée, prend une sauvegarde de sécurité de l'état
# courant, puis vérifie la sauvegarde AVANT de restaurer.
#
# Usage :
#   scripts/restore.sh var/backups/carnet-manuel-20261101T120000Z.sqlite3.gz
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ $# -lt 1 ]; then
  echo "Usage : $0 <chemin-de-sauvegarde>" >&2
  exit 64
fi

ARCHIVE="$1"
PYTHON="${PYTHON:-python3}"
export PYTHONPATH="$ROOT/backend${PYTHONPATH:+:$PYTHONPATH}"

if [ ! -f "$ARCHIVE" ]; then
  echo "ERREUR : sauvegarde introuvable : $ARCHIVE" >&2
  exit 66
fi

# 1. Aucun service ne doit détenir la base.
if command -v pgrep >/dev/null 2>&1 && pgrep -f "carnet[.]server" >/dev/null 2>&1; then
  echo "ERREUR : le service tourne encore (carnet.server). Arrêtez-le avant de restaurer." >&2
  echo "        Une restauration à chaud corromprait la base active." >&2
  exit 75
fi

# 2. Vérification de l'archive (intégrité SQLite + journal lisible).
echo "Vérification de l'archive…"
"$PYTHON" scripts/backup.py verify "$ARCHIVE"

# 3. Sauvegarde de sécurité de l'état courant avant écrasement.
if [ -f data/carnet.sqlite3 ]; then
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p var/backups
  cp -p data/carnet.sqlite3 "var/backups/pre-restore-${STAMP}.sqlite3"
  echo "État courant conservé : var/backups/pre-restore-${STAMP}.sqlite3"
fi

# 4. Restauration (le script vérifie à nouveau et pose des permissions 600).
"$PYTHON" scripts/backup.py restore "$ARCHIVE" --force

echo "Restauration terminée. Redémarrez avec scripts/run.sh, puis vérifiez :"
echo "  - GET /api/health (integrity_check ok)"
echo "  - réconciliation OK dans l'interface (aucune nouvelle entrée si divergence)"
