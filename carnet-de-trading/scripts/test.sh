#!/usr/bin/env bash
# Suite de tests complète (aucune dépendance externe).
#
#   scripts/test.sh              # tous les tests
#   scripts/test.sh test_risk    # un module
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTHON="${PYTHON:-python3}"
export PYTHONPATH="$ROOT/backend:$ROOT/tests${PYTHONPATH:+:$PYTHONPATH}"

if [ $# -ge 1 ]; then
  PATTERN="test_${1#test_}.py"
else
  PATTERN="test_*.py"
fi

echo "Tests : $PATTERN"
start=$(date +%s)
"$PYTHON" -m unittest discover -s tests -p "$PATTERN" -v
echo "Durée : $(( $(date +%s) - start )) s"
