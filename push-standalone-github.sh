#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# 📦 Initialisation & Envoi vers un NOUVEAU dépôt GitHub séparé (football-ai)
# À exécuter dans Google Cloud Shell ou votre terminal local :
#   ./push-standalone-github.sh [nom-du-repo]
# ==============================================================================

REPO_NAME="${1:-football-ai}"
cd "$(dirname "$0")"

if [ ! -d ".git" ]; then
  git init -b main
fi

git add .
git commit -m "⚡ Football AI Ultra v2 — Application complète prête pour Firebase Hosting" || true

if command -v gh >/dev/null 2>&1; then
  if ! gh auth status >/dev/null 2>&1; then
    gh auth login
  fi
  gh repo create "$REPO_NAME" --public --source=. --remote=origin --push
  echo "✅ Nouveau dépôt GitHub séparé créé et publié avec succès !"
else
  echo "👉 Créez un dépôt vide sur https://github.com/new nommé '${REPO_NAME}', puis lancez :"
  echo "   git remote add origin https://github.com/lauraincis-debug/${REPO_NAME}.git"
  echo "   git push -u origin main"
fi
