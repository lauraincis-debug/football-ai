# ⚡ FOOTBALL AI ULTRA v3

🌐 **Application en production :** **[https://football-ai-43e33.web.app](https://football-ai-43e33.web.app)**

[![Ouvrir dans Google Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)](https://console.cloud.google.com/cloudshell/open?git_repo=https://github.com/lauraincis-debug/football-ai.git&tutorial=CLOUD_SHELL_GUIDE.md&page=shell)

Application web & PWA installable d'analyse tactique, de prédiction footballistique hybride et d'auto-apprentissage continu, pré-compilée dans `www/` et déployée sur **Firebase Hosting (`football-ai-43e33`)**.

---

## 🚀 Les 8 Modules de Football AI Ultra v3

1. **📡 `Matchs Live` (`Hier` · `Aujourd'hui` · `Demain` · `J+2`) + Vraies APIs Football** (`src/services/liveMatchesApi.js`) :
   - Récupération temps réel sans clé requise (Ligue 1, Premier League, LaLiga, Serie A, Bundesliga, Champions League, Europa League, CAN / FIFA).
   - Connecteur officiel **`API-Football v3`** (`v3.football.api-sports.io`) + importateur **`Opta / FBref xG`** (CSV, JSON ou *Pack Opta Top Clubs* en 1 clic).
2. **⚽ `Prédire`** (`src/engine/predictor.js`) :
   - +110 clubs & sélections internationales, **Poisson Bivarié + Correction de Dixon-Coles** (`8×8`), **Elo Dynamique (Margin-of-Victory)**, **10 marchés cohérents**, **Value Bet + Critère de Kelly ¼**.
3. **⚔️ `Face-à-Face`** (`src/components/HeadToHeadTab.jsx`) :
   - Radar SVG interactif sur **6 axes**, option terrain neutre et **10 000 simulations Monte-Carlo** en direct.
4. **🎥 `Vidéo IA`** (`src/engine/videoAnalyzer.js` & `src/components/VideoAnalysisTab.jsx`) :
   - Upload vidéo local (`.mp4`, `.webm`, `.mov`) analysé image par image sur Canvas 2D : détection pelouse, **heatmap tactique 3 zones**, **indice de pressing haut**, **vitesse de transition** et modificateurs xG injectables dans le prédicteur.
5. **👑 `Fantasy IA`** (`src/data/players.js` & `src/components/FantasyTab.jsx`) :
   - Base de **50 stars mondiales** notées dynamiquement selon les vrais matchs du jour/lendemain et optimiseur de **11 titulaire optimal sous budget `100 M€`** (`4-3-3`, `4-4-2`, `3-4-3`, `3-5-2` + Capitaine `×2`).
6. **🎯 `Coupon`** : Simulateur de combiné multi-matchs (`FCFA` / `€`), EV mathématique et partage direct WhatsApp / Telegram.
7. **📋 `Historique`** : Saisie des scores réels et synchronisation Cloud Firebase temps réel.
8. **📊 `Modèle` (Mémoire Ultra-Développée & Auto-Amélioration Continue)** :
   - Absorption automatique des matchs terminés (`FT`), **Journal d'Autopsie Post-Mortem des Erreurs**, ajustement individuel des clubs et **Auto-Évolution Multi-Époques** (*Brier Score : `0.640` → `0.407` → `0.385`*).

---

## ⚡ Mise à jour en 1 commande via Google Cloud Shell

```bash
rm -rf ~/f && git clone -b arena/4139cd07-operation-shadow --depth 1 https://github.com/lauraincis-debug/operation-shadow.git ~/f && bash ~/f/football-ai/go.sh
```

---

## 🛠️ Développement local

```bash
npm install          # Installer les dépendances
npm run dev          # Lancer le serveur de développement
npm run test:model   # Lancer les tests mathématiques & le benchmark v3
npm run build        # Recompiler la production vers ./www
npm run deploy       # Déployer sur Firebase Hosting
```
