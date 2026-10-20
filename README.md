# FootballAI ⚽

Application d'analyse football assistée par IA : prédictions 1/N/2, calendrier du jour et de demain,
mémoire apprenante (le modèle se corrige à chaque résultat saisi), analyse vidéo, Fantasy, comparateur
face-à-face, tactique, scout et connexion API.

## Lancer en local

```bash
npm install
npm run dev      # http://localhost:5173
```

## Build de production

```bash
npm run build    # génère dist/
npm run preview  # sert le build
```

## Déploiement

Le site est publié automatiquement sur GitHub Pages à chaque push sur `main`
(workflow `.github/workflows/deploy-pages.yml`). Prérequis, une seule fois :
**Settings → Pages → Source : GitHub Actions**.

## Modules

| Module | Contenu |
| --- | --- |
| Dashboard | KPIs du modèle, momentum xG, raccourcis |
| Matchs J/J+1 | Calendrier réel (TheSportsDB / API-Football / Football-Data), pronos auto, mémorisation |
| Prédicteur IA | Probabilités, score exact, xG, facteurs, enregistrement du résultat réel |
| Mémoire IA | Poids appris, leçons, consolidation, calibration, insights, export/import |
| Vidéo IA | Upload + rapport (YOLOv8 simulé) |
| Live Center | Matchs en direct, xG live |
| Fantasy Lab | Draft 11 joueurs, budget, capitaine, auto-complétion |
| Versus | Comparateur joueurs (radar + verdict) |
| Assistant IA | Chat football |
| Tactique | Terrain interactif, formations, heatmap |
| Scout Lab | Base joueurs, radar, recommandations |
| API Connect | Clés API stockées localement |

## Modèle de prédiction

Softmax 1/N/2 à 4 features (rating, forme, xG, avantage terrain) + biais nul.
Apprentissage en ligne (descente de gradient) à chaque résultat enregistré, consolidation batch
avec early stopping, mémoire persistée en `localStorage`.
