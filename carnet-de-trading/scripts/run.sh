#!/usr/bin/env bash
# Démarrage du service Carnet de Trading (section 8 : le VPS est la seule source d'exécution).
#
# Usage :
#   scripts/run.sh                 # port 8080, écoute 0.0.0.0
#   PORT=9000 scripts/run.sh       # autre port
#   scripts/run.sh --no-engine-thread   # diagnostic : API seule, aucun cycle de trading
#
# Aucune dépendance externe : Python 3.10+ suffit (bibliothèque standard uniquement).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTHON="${PYTHON:-python3}"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "ERREUR : $PYTHON introuvable. Installez Python 3.10 ou supérieur." >&2
  exit 1
fi

VERSION="$("$PYTHON" - <<'PY'
import sys
print("%d.%d" % sys.version_info[:2])
PY
)"
echo "Python $VERSION — $(pwd)"

# Répertoires d'exécution (jamais versionnés).
mkdir -p data var/backups
chmod 700 data var 2>/dev/null || true

# Fichier d'environnement optionnel (variables CARNET_*).
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  echo "Environnement chargé depuis .env"
fi

export PYTHONPATH="$ROOT/backend${PYTHONPATH:+:$PYTHONPATH}"
export CARNET_HOST="${CARNET_HOST:-0.0.0.0}"
export CARNET_PORT="${CARNET_PORT:-${PORT:-8080}}"
export CARNET_ENV="${CARNET_ENV:-SIMULATION}"

if [ "$CARNET_ENV" != "SIMULATION" ]; then
  echo "Mode demandé : $CARNET_ENV (le mode réel reste bloqué par construction)."
fi

echo "Démarrage sur http://${CARNET_HOST}:${CARNET_PORT} (environnement ${CARNET_ENV})"
echo "Identifiants initiaux : var/initial_credentials.txt (supprimer après la première connexion)."

exec "$PYTHON" -m carnet.server --host "$CARNET_HOST" --port "$CARNET_PORT" "$@"
