#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# 🚀 LANCEUR 100% AUTOMATIQUE : FOOTBALL AI ULTRA v3 + LIAISON AUTO CLOÉ + GITHUB
# ZÉRO ÉDITION DE CODE MANUELLE :
# 1) Déploie automatiquement Football AI Ultra v3 + /cloe-bridge.js sur football-ai-43e33.web.app
# 2) Détecte et connecte automatiquement tout projet/site Firebase de Cloé (Cloud Shell + Firebase)
# 3) Synchronise automatiquement https://github.com/lauraincis-debug/football-ai.git
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "⚡ Automatisation intégrale en cours (Football AI Ultra v3 + Pont Cloé + GitHub)..."
rm -rf /tmp/football_ai_gh_code.json /tmp/football_ai_gh_status.txt

if [ "$SCRIPT_DIR" != "$HOME/football-ai" ]; then
  rm -rf "$HOME/football-ai"
  cp -a "$SCRIPT_DIR" "$HOME/football-ai"
fi
rm -rf "$HOME/f" /tmp/_extract "$HOME/football-ai/football-ai-firebase-ready.zip"

cd "$HOME/football-ai"
chmod +x deploy-firebase.sh push-standalone-github.sh go.sh \
  scripts/cloudshell-direct-deploy.mjs \
  scripts/github-background-push.mjs \
  scripts/auto-bridge-cloe.mjs

rm -rf .git
git init -b main >/dev/null
git config user.name "lauraincis-debug"
git config user.email "lauraincis@gmail.com"
git remote add origin https://github.com/lauraincis-debug/football-ai.git
git add -A
git commit -m "⚡ Football AI Ultra v3.1 — Pont IA Auto Cloé + Matchs Live + Vidéo IA + Fantasy 100M€ + Mémoire Auto-Évolutive" >/dev/null

# Lancer la synchro GitHub en arrière-plan
nohup node "$HOME/football-ai/scripts/github-background-push.mjs" > "$HOME/football-ai-github.log" 2>&1 </dev/null &

GH_CODE=""
GH_DONE=""
for _ in 1 2 3 4 5 6; do
  if [ -f /tmp/football_ai_gh_status.txt ] && grep -q "PUSH_SUCCESS" /tmp/football_ai_gh_status.txt 2>/dev/null; then
    GH_DONE="1"
    break
  fi
  if [ -f /tmp/football_ai_gh_code.json ]; then
    GH_CODE=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync("/tmp/football_ai_gh_code.json","utf8")).user_code||"")}catch{}')
    if [ -n "$GH_CODE" ]; then break; fi
  fi
  sleep 0.5
done

# 1. Déployer automatiquement Football AI Ultra v3 sur https://football-ai-43e33.web.app
node "$HOME/football-ai/scripts/cloudshell-direct-deploy.mjs" football-ai-43e33

# 2. Scanner et relier automatiquement Cloé (dossiers Cloud Shell + sites Firebase actifs)
node "$HOME/football-ai/scripts/auto-bridge-cloe.mjs"

if [ "$GH_DONE" = "1" ] || ( [ -f /tmp/football_ai_gh_status.txt ] && grep -q "PUSH_SUCCESS" /tmp/football_ai_gh_status.txt 2>/dev/null ); then
  echo "✅ Dépôt GitHub https://github.com/lauraincis-debug/football-ai mis à jour automatiquement !"
elif [ -n "$GH_CODE" ]; then
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  🐙 DERNIÈRE FOIS POUR MÉMORISER GITHUB DÉFINITIVEMENT :      ║"
  echo "║  Ouvrez https://github.com/login/device -> Code : ${GH_CODE}    ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
fi
