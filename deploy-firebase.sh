#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# ⚡ FOOTBALL AI ULTRA — Script de Déploiement Google Cloud Shell -> Firebase
# Usage :
#   ./deploy-firebase.sh                      (mode interactif)
#   ./deploy-firebase.sh mon-projet-firebase  (ID projet Firebase direct)
# ==============================================================================

cd "$(dirname "$0")"

echo "========================================================"
echo " ⚡ FOOTBALL AI ULTRA — Déploiement Firebase Hosting"
echo "========================================================"

# 1. Utiliser firebase global s'il existe, sinon npx firebase-tools
if command -v firebase >/dev/null 2>&1; then
  FB_CMD="firebase"
else
  echo "📦 Chargement de Firebase CLI via npx..."
  FB_CMD="npx -y firebase-tools"
fi

# 2. Reconstruction fraîche du bundle de production vers ./www
if [ ! -d "www" ] || [ -f "package.json" ]; then
  echo "🔨 Construction complète de l'application (Vite -> ./www)..."
  npm install --no-audit --no-fund
  npm run build
fi

# 3. Vérifier la connexion au compte Google / Firebase
echo "🔐 Vérification de la session Firebase..."
if ! $FB_CMD projects:list >/dev/null 2>&1; then
  echo "👉 Connexion requise : suivez le lien affiché ci-dessous et collez le code d'autorisation :"
  $FB_CMD login --no-localhost
fi

# 4. Déterminer l'ID du projet Firebase cible
PROJECT_ID="${1:-}"
if [ -z "$PROJECT_ID" ] && [ -f ".firebaserc" ]; then
  CURRENT_ID=$(node -e 'try{const c=require("./.firebaserc");console.log(c.projects?.default||"")}catch{}')
  if [ -n "$CURRENT_ID" ] && [ "$CURRENT_ID" != "REMPLACER_PAR_ID_PROJET_FIREBASE" ]; then
    PROJECT_ID="$CURRENT_ID"
  fi
fi

if [ -z "$PROJECT_ID" ]; then
  echo ""
  echo "📋 Vos projets Firebase existants :"
  $FB_CMD projects:list || true
  echo ""
  read -r -p "Entrez l'ID de votre projet Firebase (ex: football-ai-2026) : " PROJECT_ID
fi

if [ -z "$PROJECT_ID" ]; then
  echo "❌ Aucun Project ID fourni. Opération annulée."
  exit 1
fi

cat > .firebaserc <<EOF
{
  "projects": {
    "default": "${PROJECT_ID}"
  }
}
EOF

echo "🚀 Mise en ligne sur Firebase Hosting (Projet : ${PROJECT_ID})..."
$FB_CMD deploy --only hosting --project "$PROJECT_ID"

echo ""
echo "✅ APPLICATION EN LIGNE AVEC SUCCÈS !"
echo "🌐 URL publique : https://${PROJECT_ID}.web.app"
