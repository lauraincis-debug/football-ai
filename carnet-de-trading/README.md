# Carnet de Trading — copilote de trading discipliné (V1, simulation)

Application complète, autonome et auditable, construite à partir du cahier des charges
(§1 à §27). Elle **n'exécute aucun ordre réel** : la V1 est un environnement de
simulation à haut réalisme, avec tous les garde-fous du mode réel déjà en place,
testés et bloquants par construction.

- Interface web (français) : tableau de bord, marché, positions, ordres, risque,
  stratégies, backtests, journal, diagnostics, contrôles d'urgence, administration.
- API HTTP JSON avec authentification par session, rôles et permissions.
- Moteur de trading en boucle : marché simulé → stratégies → contrôles de risque →
  ordres → positions protégées → réconciliation → journal chaîné.
- Aucune dépendance tierce : **Python 3.10+ (stdlib seulement)**, HTML/CSS/JS natifs.

---

## 1. Démarrage rapide

```bash
cd carnet-de-trading
./scripts/run.sh                     # http://0.0.0.0:8080
```

Au premier démarrage, trois comptes sont créés et les mots de passe sont écrits dans
`var/initial_credentials.txt` (droits 600) :

| Compte      | Rôle     | Usage |
|-------------|----------|-------|
| `admin`     | ADMIN    | politique de risque, utilisateurs, sauvegardes |
| `operateur` | OPERATOR | arrêt/reprise, liquidation, backtests |
| `lecture`   | VIEWER   | consultation seule |

Pour fixer le mot de passe administrateur avant le premier lancement :

```bash
CARNET_ADMIN_PASSWORD='MotDePasse!Solide2026' ./scripts/run.sh
```

L'interface est servie par le même processus que l'API (§8 : le VPS est la seule
source d'exécution, rien ne dépend du poste de l'utilisateur).

## 2. Tests

```bash
./scripts/test.sh                    # 222 tests, ~50 s
./scripts/test.sh risk               # un seul module
```

Couverture mesurée : 88 % global, 98 % sur le risque et les ordres (seuils du §21.3 : 80 % / 95 %).

Couverture fonctionnelle : utilitaires, base, journal chaîné, sécurité, politique,
garde-fous, marché, simulateur, risque (37 cas), ordres, connecteurs, réconciliation,
moteur (redémarrage, suspension persistante, liquidation vérifiée), API HTTP
(authentification, rôles, contrôles, sauvegardes), stratégies, backtests, sauvegardes.

## 3. Architecture

```
carnet-de-trading/
├── backend/carnet/          moteur + API (stdlib)
│   ├── server.py            point d'entrée (API + web + boucle + sauvegardes)
│   ├── engine.py            orchestration, contrôles, instantané d'état
│   ├── market.py            cotations, chandelles, indicateurs
│   ├── simulator.py         marché synthétique reproductible + pannes injectables
│   ├── strategies.py        ema_trend, orb_breakout, rsi_reversion
│   ├── risk.py              moteur de risque + état persistant des limites
│   ├── orders.py            machine à états des ordres + positions
│   ├── connectors/          simulation (actif), MT5, crypto spot, base commune
│   ├── reconcile.py         réconciliation local ↔ plateforme
│   ├── guards.py            garde du mode réel + validations propriétaire
│   ├── policy.py            politique de risque versionnée et chaînée
│   ├── security.py          mots de passe, sessions, rôles, TOTP, jetons API
│   ├── journal.py           journal chaîné SHA-256 + notifications
│   ├── db.py                SQLite (WAL), migrations, intégrité
│   ├── backtest.py          backtest, Monte-Carlo, walk-forward, référence
│   ├── backup.py            sauvegardes vérifiées, chiffrées, exercices
│   └── api.py               routeur, permissions, fichiers statiques, en-têtes
├── web/                     interface (aucune dépendance, hors ligne)
├── tests/                   222 tests (stdlib unittest)
├── scripts/                 run.sh, test.sh, backup.py, restore.sh
└── docs/                    cahier des charges, décisions, blocages, opérations
```

Flux d'un cycle (simulation) :

```
simulateur → cotations → chandelles/indicateurs → stratégies → signaux
   → contrôles de risque (§6, 30+ codes de refus) → ordres (machine à états)
   → exécution connecteur → positions protégées → événements → base + journal
   → marquage, limites quotidiennes/hebdo, réconciliation, notifications
```

## 4. Modes et environnements

| Environnement | État | Condition |
|---------------|------|-----------|
| `SIMULATION`  | **actif** | défaut, aucun ordre réel possible |
| `DEMO`        | prêt | identifiants courtier/exchange requis, ordres réels refusés |
| `REAL_*`      | **bloqué** | §1.4 : jamais activable dans cette livraison |

Le passage au réel exige : sélection du courtier/exchange (§26), validations
technique/sécurité/opérationnelle signées, jeton propriétaire, et revue d'audit
indépendante (§24). Ces verrous sont dans `guards.py` et vérifiés par les tests ;
voir `docs/BLOCKERS.md`.

## 5. Configuration (variables d'environnement)

| Variable | Défaut | Rôle |
|----------|--------|------|
| `CARNET_HOST` / `CARNET_PORT` | `0.0.0.0` / `8080` | écoute HTTP |
| `CARNET_ENV` | `SIMULATION` | environnement (§4) |
| `CARNET_SEED` | `20261101` | graine du marché simulé (déterminisme) |
| `CARNET_SIM_SPEED` | `300` | accélération de l'horloge simulée |
| `CARNET_SIM_24_7` | `1` | marché simulé continu (démo utilisable le week-end) |
| `CARNET_TICK_SECONDS` | `1.0` | période de la boucle réelle |
| `CARNET_INITIAL_CAPITAL` | `10000` | capital initial simulé |
| `CARNET_DATA_DIR` / `CARNET_VAR_DIR` | `data/` / `var/` | base et état d'exécution |
| `CARNET_ALLOW_REAL` | `0` | autorisation serveur du mode réel (insuffisante seule) |
| `CARNET_OWNER_TOKEN` | — | jeton propriétaire (décisions réservées) |
| `CARNET_BACKUP_PASSPHRASE` | — | chiffrement des sauvegardes |
| `CARNET_ADMIN_PASSWORD` etc. | aléatoire | mots de passe initiaux |
| `CARNET_WEBHOOK_URL` | — | notifications sortantes |
| `CARNET_LOG_LEVEL` | `INFO` | verbosité |

## 6. Sécurité (résumé, §17)

- Mots de passe hachés (PBKDF2-HMAC-SHA256, sel unique), verrouillage après échecs,
  limitation de débit sur la connexion.
- Sessions porteuses avec expiration, révocation individuelle, liste des sessions.
- Trois rôles et permissions explicites vérifiées **par route** (refus 403 testés).
- MFA TOTP disponible (QR `otpauth://`), activation/désactivation auditée.
- Jeton propriétaire pour les décisions réservées (politique, mode réel) : jamais
  stocké en base ni journalisé, lu dans `var/owner_token` (600) ou l'environnement.
- Journal chaîné SHA-256 (vérification à la demande, rupture = alerte critique).
- En-têtes de sécurité, corps limité à 256 Ko, pas de traversée de répertoire.
- Connecteur crypto : clé avec droit de retrait ou futures ⇒ **connexion refusée**.

## 7. Données et sauvegardes (§20)

- SQLite en mode WAL, 19 tables, `PRAGMA integrity_check` exposé par `/api/health`.
- Sauvegarde périodique (toutes les 6 h) + exercice de restauration automatique.
- CLI : `scripts/backup.py create|list|verify|drill|restore`, `scripts/restore.sh`.
- Restauration en production refusée à chaud (409) : procédure à froid documentée.

## 8. Documentation

| Fichier | Contenu |
|---------|---------|
| `docs/CAHIER_DES_CHARGES.md` | traçabilité section par section (exigence → code → test) |
| `docs/DECISIONS.md` | décisions d'architecture et arbitrages |
| `docs/BLOCKERS.md` | blocages réels, options, recommandation |
| `docs/OPERATIONS.md` | exploitation VPS, incidents, sauvegardes, mises à jour |
| `docs/REPORT_SOURCES.md` | sources utilisées et vérifications |

## 9. Limites assumées de la V1

- Aucun ordre réel, aucun courtier ni exchange sélectionné : voir blocages B1–B3.
- MT5 : la bibliothèque officielle est Windows-only ; le connecteur est écrit et
  testé avec un module factice, l'activation dépend du VPS Windows (§9).
- L'interface est une application web autonome ; pas d'application mobile native
  (hors périmètre §3.3).
- Les résultats de backtest ne constituent pas une promesse de performance (§22).

## 10. État de livraison

- Tests : **222 / 222 OK** (≈50 s).
- Couverture : **88 %** global, **98 %** risque et ordres.
- Démarrage vérifié : API, interface, boucle moteur, réconciliation `OK`.
- Environnement livré : `SIMULATION`, capital 10 000, 6 instruments, 3 stratégies.
