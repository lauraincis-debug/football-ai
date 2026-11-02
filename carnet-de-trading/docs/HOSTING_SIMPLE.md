# Hébergement permanent « simple » (depuis un téléphone)

Objectif : obtenir une **adresse HTTPS stable**, ouvrable depuis le téléphone à
tout moment, sans ordinateur et sans carte bancaire.

> ⚠️ **Ce que cela permet — et ne permet pas.**
> ✅ Utiliser la simulation (marché et argent fictifs) à toute heure.
> ✅ Configurer les alertes vers Discord/Slack, suivre le journal, les stratégies.
> ❌ **Ne débloque pas Deriv/MT5** : le pont MT5 exige un programme Windows avec le
> terminal installé. Un hébergement Linux, même permanent, n'y change rien.
> ❌ Aucun ordre réel : `CARNET_ALLOW_REAL=0` et le code refuse le mode réel.

---

## Option 1 — Render (recommandé, gratuit)

Render héberge l'application dans un conteneur et fournit une URL
`https://carnet-de-trading.onrender.com`. Tout se fait depuis le navigateur du
téléphone.

### Préparation (une fois)

Le dépôt contient déjà ce qu'il faut :

- `carnet-de-trading/Dockerfile` — image minimale (stdlib Python) ;
- `render.yaml` à la racine du dépôt — description du service.

### Mise en ligne

1. ouvrir **https://render.com** → **Get Started** → se connecter **avec GitHub** ;
2. autoriser Render à voir le dépôt `football-ai` ;
3. tableau de bord → **New +** → **Blueprint** ;
4. sélectionner le dépôt `football-ai` (branche `main`) → **Connect** ;
5. Render détecte `render.yaml` et propose le service **carnet-de-trading** →
   **Apply** / **Create** ;
6. attendre la fin du déploiement (3 à 6 minutes la première fois) ;
7. l'URL apparaît en haut du service : `https://carnet-de-trading.onrender.com`.

### Première connexion

1. Render → service → onglet **Environment** → copier la valeur de
   `CARNET_ADMIN_PASSWORD` (générée automatiquement) ;
2. ouvrir l'URL → se connecter avec `admin` + ce mot de passe ;
3. **Paramètres → mot de passe** : le changer immédiatement ;
4. **Paramètres → Canal d'alerte** : coller l'URL du webhook Discord → *Envoyer un test* ;
5. ajouter la page à l'écran d'accueil (Chrome/Safari).

### Limites de l'offre gratuite (à connaître)

| Limite | Effet | Contournement |
|---|---|---|
| Mise en veille après ~15 min sans visite | premier chargement lent (~1 min) | ouvrir l'URL une fois avant d'en avoir besoin ; offre payante (~7 $/mois) |
| Disque éphémère | base réinitialisée à chaque redéploiement/redémarrage | disque persistant (payant) ; exporter avec `scripts/backup.py` |
| 512 Mo de RAM | suffisant pour la simulation | — |
| Une seule instance | pas de haute disponibilité | — |

Les données de trading sont donc **de démonstration** : ne considérez pas cette
instance gratuite comme un journal durable.

---

## Option 2 — Docker, n'importe où

Sur un serveur ou un NAS disposant de Docker :

```bash
docker build -t carnet:latest carnet-de-trading
docker run -d --name carnet -p 8080:8080 \
  -e CARNET_ADMIN_PASSWORD='MotDePasse!Solide2026' \
  -v carnet-data:/app/data -v carnet-var:/app/var \
  carnet:latest
```

Puis un reverse proxy TLS devant (voir `docs/DEPLOYMENT.md`, nginx ou Caddy).
Cette voie demande un terminal : peu pratique depuis un téléphone.

---

## Option 3 — VPS Linux complet (systemd)

Voir `docs/DEPLOYMENT.md` : installation par script, unité systemd durcie, TLS,
sauvegardes. Recommandé si vous voulez aussi conserver les données et faire tourner
le service 24/7 sans mise en veille. Coût typique : 4 à 8 €/mois.

---

## Rappel sur Deriv

| Besoin | Hébergement Linux | PC Windows |
|---|---|---|
| Simulation 24/7 | ✅ | ✅ |
| Alertes Discord/Slack | ✅ | ✅ |
| **Pont MT5 Deriv démo** | ❌ | ✅ (terminal + agent) |
| Ordre réel | ❌ (bloqué par conception) | ❌ (bloqué par conception) |

Pour Deriv, la seule voie sans ordinateur personnel reste un **VPS Windows**
piloté par « Bureau à distance » depuis le téléphone — voir
`docs/PHONE_ONLY.md` §4.
