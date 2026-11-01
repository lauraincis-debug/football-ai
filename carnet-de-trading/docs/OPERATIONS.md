# Exploitation du service (VPS)

Public : la personne qui installe, surveille et dépanne le service. Toutes les
commandes supposent le répertoire `carnet-de-trading/`.

---

## 1. Prérequis

| Élément | Minimum | Remarque |
|---|---|---|
| Python | 3.10 | aucune dépendance à installer |
| Système | Linux x86-64 | Windows possible pour MT5 (voir `BLOCKERS.md` B1) |
| Disque | 2 Go | base < 50 Mo, sauvegardes compressées |
| RAM | 512 Mo | le service tourne en < 200 Mo |
| Réseau | port HTTP interne | TLS à terminer par un reverse proxy |
| Horloge | NTP actif | la fraîcheur des cotations en dépend |

Vérification rapide :

```bash
python3 -V && date -u && df -h .
```

## 2. Installation

```bash
git clone <dépôt> && cd football-ai/carnet-de-trading
mkdir -p data var/backups && chmod 700 data var
CARNET_ADMIN_PASSWORD='MotDePasse!Solide2026' ./scripts/run.sh
```

Premier démarrage : création de la base, des trois comptes, de la politique
initiale, du marché simulé, puis réconciliation `OK`. Les identifiants initiaux
sont dans `var/initial_credentials.txt` (600) : **les changer immédiatement** via
l'interface (Paramètres → mot de passe), puis supprimer le fichier.

### Service systemd (recommandé)

```ini
# /etc/systemd/system/carnet.service
[Unit]
Description=Carnet de Trading (simulation)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=carnet
Group=carnet
WorkingDirectory=/opt/carnet-de-trading
Environment=CARNET_HOST=127.0.0.1
Environment=CARNET_PORT=8080
Environment=CARNET_ENV=SIMULATION
# Secrets : fichier dédié, droits 600, jamais dans l'unité
EnvironmentFile=/opt/carnet-de-trading/.env
ExecStart=/opt/carnet-de-trading/scripts/run.sh
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/carnet-de-trading/data /opt/carnet-de-trading/var

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now carnet
sudo systemctl status carnet --no-pager
```

Terminer TLS par un reverse proxy (nginx/Caddy) sur `127.0.0.1:8080`, jamais
exposer le port applicatif directement.

## 3. Configuration

Toutes les variables sont documentées dans le `README.md` §5. Fichier `.env`
exemple (droits 600) :

```ini
CARNET_HOST=127.0.0.1
CARNET_PORT=8080
CARNET_ENV=SIMULATION
CARNET_SEED=20261101
CARNET_SIM_SPEED=300
CARNET_TICK_SECONDS=1.0
CARNET_ADMIN_PASSWORD=...
CARNET_OWNER_TOKEN=...            # décisions réservées
CARNET_BACKUP_PASSPHRASE=...      # chiffrement des sauvegardes
CARNET_WEBHOOK_URL=               # alertes sortantes
```

Après modification : `sudo systemctl restart carnet`, puis vérifier `/api/health`.

## 4. Surveillance

| Point | Où | Seuil d'alerte |
|---|---|---|
| Service vivant | `systemctl is-active carnet` | ≠ `active` |
| Santé applicative | `GET /api/health` | `ok != true` ou `db.ok != true` |
| Erreurs internes | `GET /api/diagnostics` → `engine_errors`, `app.errors` | toute nouvelle erreur |
| Réconciliation | `GET /api/reconciliations` | dernier statut ≠ `OK` |
| Fraîcheur des cotations | `GET /api/state` → `market[].age_seconds` | > 3 s |
| Intégrité du journal | `POST /api/journal/verify` | `ok != true` |
| Sauvegardes | `GET /api/backups` | aucune < 24 h |
| Espace disque | `df -h` | < 15 % libre |

Contrôle rapide en ligne de commande :

```bash
TOKEN=$(curl -s -X POST localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"..."}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
curl -s localhost:8080/api/health | python3 -m json.tool
curl -s -H "Authorization: Bearer $TOKEN" localhost:8080/api/diagnostics \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["app"], d["reconciliations"][:1])'
```

## 5. Sauvegardes et restauration

Automatique : toutes les 6 h (`server._backup_loop`), exercice de restauration tous
les 4 cycles, rétention 30 sauvegardes.

Manuel :

```bash
./scripts/backup.py create --label avant-maj
./scripts/backup.py list
./scripts/backup.py verify var/backups/carnet-avant-maj-....sqlite3.gz
./scripts/backup.py drill
```

Restauration (service arrêté obligatoire) :

```bash
sudo systemctl stop carnet
./scripts/restore.sh var/backups/carnet-avant-maj-....sqlite3.gz
sudo systemctl start carnet
curl -s localhost:8080/api/health | python3 -m json.tool
```

Le script vérifie l'archive, conserve l'état courant (`pre-restore-*.sqlite3`) puis
restaure. Une tentative à chaud renvoie 409 : c'est volontaire.

**Objectif de continuité** : sauvegarde < 30 s, restauration vérifiée < 2 min sur le
jeu de données de référence (mesurée par l'exercice `drill`, champ `duration_ms`).

## 6. Checklist après démarrage (5 minutes)

1. `/api/health` : `ok: true`, `db.ok: true`, environnement `SIMULATION`.
2. `/api/state` : `reconciliation.status == "OK"`, `risk.entries_enabled: true`,
   `market[].fresh: true` pour tous les instruments.
3. Interface : bandeau « simulation », date/heure simulée qui avance, graphiques
   avec bougies, positions/ordres cohérents.
4. `POST /api/journal/verify` : `ok: true`.
5. `./scripts/backup.py create --label apres-installation` puis `verify`.
6. Se connecter avec chaque rôle et vérifier qu'un VIEWER n'a pas les boutons
   d'action (et reçoit 403 via l'API).

## 7. Mise à jour et retour arrière

```bash
sudo systemctl stop carnet
./scripts/backup.py create --label avant-maj
git fetch --all && git checkout <version> && git pull
PYTHONPATH=backend:tests python3 -m unittest discover -s tests -p 'test_*.py'
sudo systemctl start carnet
```

Si le contrôle de santé échoue : `systemctl stop`, restaurer la sauvegarde
"avant-maj", revenir au commit précédent, redémarrer. Les migrations de schéma sont
idempotentes et versionnées ; une base plus récente n'est jamais ouverte par un
code plus ancien sans vérification (`schema_meta`).

## 8. Incidents — procédures

### 8.1 Divergence de réconciliation
Symptôme : bandeau rouge, `reconciliation.status != OK`, notifications critiques.
1. **Ne pas** reprendre le trading (la reprise est refusée tant que ce n'est pas `OK`).
2. `GET /api/reconciliations` : lire `missing_locally`, `missing_on_platform`,
   `unprotected`.
3. Si une position existe sur la plateforme mais pas en local : ne rien recréer à la
   main, laisser l'enregistrement `ORPHAN` et traiter la position depuis la
   plateforme.
4. Si une position locale a disparu de la plateforme : vérifier l'historique de la
   plateforme, la clôture locale est déjà marquée `RECONCILED_ABSENT`.
5. `POST /api/reconcile` pour relancer ; ne reprendre (`POST /api/control/resume`)
   qu'après un statut `OK`.

### 8.2 Protection absente sur une position
Symptôme : notification `STOP_LOSS_UNCONFIRMED`.
1. Arrêt trading immédiat (`POST /api/control/stop`).
2. Vérifier la position dans l'interface et sur la plateforme ; poser un stop manuel
   côté plateforme si nécessaire.
3. Si la position ne peut pas être protégée : liquidation d'urgence
   (`POST /api/control/liquidate`, confirmation `LIQUIDER`), qui vérifie ensuite
   que tout est fermé.

### 8.3 Statut d'ordre incertain (timeout)
Symptôme : ordre en `UNKNOWN`, notification `ORDER_TIMEOUT`.
Aucune réémission n'est faite. Le moteur interroge la plateforme
(`OrderManager.resolve_unknown`) ; si l'état reste inconnu, l'ordre est rejeté et
les nouvelles entrées restent bloquées. Vérifier manuellement sur la plateforme
avant toute action.

### 8.4 Journal compromis
Symptôme : `POST /api/journal/verify` renvoie `ok: false`.
1. Considérer l'intégrité de l'application comme compromise : arrêt trading, puis
   arrêt du service.
2. Conserver les fichiers (`data/`, `var/`) pour analyse, restaurer la dernière
   sauvegarde vérifiée, changer tous les mots de passe et le jeton propriétaire.
3. Investiguer l'accès au VPS (clés SSH, comptes, journaux système).

### 8.5 Limite de perte atteinte
Symptôme : suspension automatique (`DAILY_LOSS_LIMIT`, `WEEKLY_LOSS_LIMIT`,
`DRAWDOWN_LIMIT`).
Le trading reste suspendu, y compris après redémarrage. La remise à zéro
quotidienne lève uniquement les suspensions journalières. Une reprise manuelle
exige une réconciliation `OK` ; documenter la décision dans le journal (motif de
reprise).

### 8.6 Sauvegarde en échec
Symptôme : notification `BACKUP_FAILED`.
Vérifier l'espace disque et les permissions (`data/`, `var/` en 700), puis
`./scripts/backup.py create --label manuel`. Si le disque est plein : purger les
sauvegardes anciennes (`manifest.jsonl` + fichiers) après vérification.

### 8.7 Service qui ne démarre pas
Ordre de diagnostic :
1. `journalctl -u carnet -n 100 --no-pager` (ou sortie console).
2. Cause fréquente : port occupé (`ss -ltnp | grep 8080`) — arrêter l'ancien
   processus avant de relancer.
3. Base verrouillée : aucun autre processus ne doit ouvrir `data/carnet.sqlite3`.
4. Permissions : `data/` et `var/` accessibles en écriture par l'utilisateur du
   service.
5. Base corrompue : `PRAGMA integrity_check` via `/api/health` ; restaurer.

## 9. Sécurité opérationnelle

- Reverse proxy TLS obligatoire ; port applicatif en `127.0.0.1`.
- Pare-feu : n'exposer que 443 (et 22 restreint par IP).
- Mots de passe uniques, MFA activée pour ADMIN, sessions révoquées après usage.
- Jeton propriétaire et phrase de passe de sauvegarde conservés hors du serveur
  (gestionnaire de secrets), jamais dans Git.
- Mises à jour système mensuelles ; redémarrage planifié avec sauvegarde préalable.
- Sauvegardes copiées hors site (rsync chiffré), testées par `drill`.
- Rotation des journaux système ; l'application journalise déjà en base.

## 10. Contacts et responsabilités

| Rôle | Responsabilité |
|---|---|
| Propriétaire | décisions réservées, sélection des plateformes, validation du réel |
| Exploitant | service, sauvegardes, surveillance, incidents |
| Auditeur | revue indépendante (§24) |

Toute action sensible (arrêt, liquidation, modification de politique, restauration)
est enregistrée dans le journal et l'audit avec son auteur : c'est la source de
vérité en cas de désaccord.
