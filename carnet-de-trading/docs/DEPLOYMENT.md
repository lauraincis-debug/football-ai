# Déploiement sur VPS (systemd + reverse proxy TLS)

Ce guide décrit la mise en production de Carnet de Trading sur un VPS Linux
(Debian 12 / Ubuntu 22.04+) : service systemd durci, accès HTTPS par reverse
proxy, connexion éventuelle à un terminal MetaTrader 5 **démo** sur un nœud
Windows, et canal d'alerte sortant.

> **Périmètre inchangé.** La V1 n'envoie aucun ordre réel : le mode réel est
> refusé par construction (garde `RealModeGuard`, `CARNET_ALLOW_REAL=0`), le
> pont MT5 refuse tout compte de type `real` et les ordres démo exigent une
> activation explicite dans l'interface.

---

## 1. Architecture cible

```
                 Internet (443)
                       │
        ┌──────────────▼───────────────┐
        │  nginx ou Caddy (TLS, HSTS)  │   VPS Linux
        │  127.0.0.1:8080 → carnet     │
        └──────────────┬───────────────┘
                       │  (HTTP local, jamais exposé)
        ┌──────────────▼───────────────┐
        │  carnet.service (systemd)    │
        │  /opt/carnet · /var/lib/carnet│
        └───────┬──────────────┬───────┘
                │              │
      SQLite + journaux   webhook HTTPS (Slack, Teams…)
                │
      (option) tunnel SSH / VPN
                │
        ┌───────▼────────────┐
        │ Nœud Windows       │
        │ MT5 démo + agent   │
        │ 127.0.0.1:8787     │
        └────────────────────┘
```

Trois règles d'exploitation :

1. Le service n'écoute **que** sur `127.0.0.1:8080` ; le proxy assure le TLS.
2. Le pont MT5 n'est jamais publié sur Internet : tunnel SSH ou VPN privé.
3. Les fichiers d'état (`/var/lib/carnet`) et de configuration
   (`/etc/carnet/carnet.env`) ne sont lisibles que par le compte de service.

---

## 2. Prérequis

- VPS 2 vCPU / 2 Go RAM / 20 Go disque, Debian 12 ou Ubuntu 22.04.
- Python 3.10+, `systemd`, `rsync`, `curl`.
- Un nom DNS (`carnet.exemple.fr`) pointant sur le VPS pour le certificat.
- Aucune dépendance Python tierce : l'application n'utilise que la
  bibliothèque standard.

Vérification rapide :

```bash
python3 --version        # ≥ 3.10
systemctl --version
```

---

## 3. Installation en une commande

```bash
git clone https://github.com/<compte>/football-ai.git
cd football-ai/carnet-de-trading

sudo ./deploy/install.sh \
  --domain carnet.exemple.fr \
  --tls nginx \
  --email ops@exemple.fr
```

Le script est idempotent et réalise :

| Étape | Détail |
|-------|--------|
| Compte de service | `carnet` (système, sans shell) |
| Application | copiée dans `/opt/carnet` (sans `.git`, `var`, `data`) |
| Environnement Python | `/opt/carnet/venv` (isolé, stdlib uniquement) |
| Configuration | `/etc/carnet/carnet.env` (0640 `root:carnet`) |
| Données | `/var/lib/carnet/{data,var,backups}` (0700) |
| Service | `carnet.service` + timer `carnet-drill.timer` |
| Proxy | vhost nginx ou Caddy pour le domaine demandé |
| Contrôle | `GET /api/health` doit répondre avant la fin du script |

Sans `--domain`, aucun vhost n'est créé : utilisez un tunnel SSH
(`ssh -L 8080:127.0.0.1:8080 ops@vps`) pour accéder à l'interface.

Désinstallation :

```bash
sudo ./deploy/uninstall.sh            # retire le service, conserve les données
sudo ./deploy/uninstall.sh --purge    # supprime aussi données et compte
```

---

## 4. Service systemd

Extrait de `deploy/systemd/carnet.service` :

```ini
ExecStart=/opt/carnet/venv/bin/python -m carnet.server --host 127.0.0.1 --port 8080
EnvironmentFile=/etc/carnet/carnet.env
User=carnet
ProtectSystem=strict
ReadWritePaths=/var/lib/carnet
NoNewPrivileges=yes
MemoryDenyWriteExecute=yes
```

Commandes utiles :

```bash
systemctl status carnet
journalctl -u carnet -f
systemctl restart carnet
systemctl show carnet -p MainPID
```

Le service écrit aussi `var/carnet.pid` et arrête proprement le moteur sur
`SIGTERM` (fermeture de la base, sauvegarde du connecteur, journal).

### Configuration (`/etc/carnet/carnet.env`)

```ini
CARNET_HOST=127.0.0.1
CARNET_PORT=8080
CARNET_ENV=SIMULATION
CARNET_SIM_SPEED=60
CARNET_DATA_DIR=/var/lib/carnet/data
CARNET_VAR_DIR=/var/lib/carnet/var
CARNET_BACKUP_DIR=/var/lib/carnet/backups
CARNET_SESSION_TTL_MINUTES=480
CARNET_ALLOW_REAL=0
CARNET_WEBHOOK_URL=
```

- `CARNET_ADMIN_PASSWORD` : si vide, un mot de passe aléatoire est écrit dans
  `var/initial_credentials.txt` (0600). Changez-le après la première connexion.
- `CARNET_WEBHOOK_URL` : amorce le canal d'alerte si rien n'est configuré dans
  l'interface ; la configuration persistée reste prioritaire.
- `CARNET_SYMBOLS` : restreint les instruments suivis. À utiliser quand le
  courtier ne propose qu'une partie de la liste : le moteur ignore alors les
  autres, sans cotation ni avertissement répété. Un nom inconnu bloque le
  démarrage avec un message explicite.
- `CARNET_ALLOW_REAL` : **laisser à 0**. Même à 1, la V1 refuse le mode réel
  faute de validations et de sélection courtier (section 24/26).

Après modification : `systemctl restart carnet`.

---

## 5. Reverse proxy TLS

### 5.1 nginx

Le fichier `deploy/nginx/carnet.conf` fournit :

- redirection HTTP → HTTPS et challenge ACME ;
- TLS 1.2/1.3 uniquement, HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY` ;
- limitation de débit sur `/api/auth/login` (10 req/min, burst 5) ;
- `proxy_pass http://127.0.0.1:8080` et `client_max_body_size 1m` ;
- en-têtes `X-Forwarded-*` conservés pour l'audit des sessions.

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo sed "s/carnet.exemple.fr/VOTRE_DOMAINE/g" deploy/nginx/carnet.conf \
  | sudo tee /etc/nginx/sites-available/carnet.conf
sudo ln -sf /etc/nginx/sites-available/carnet.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d VOTRE_DOMAINE --email ops@exemple.fr --agree-tos --redirect
```

Le renouvellement est assuré par `certbot.timer` (vérifier avec
`systemctl list-timers | grep certbot`).

### 5.2 Caddy (alternative)

```bash
sudo cp deploy/caddy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i "s/carnet.exemple.fr/VOTRE_DOMAINE/" /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

Caddy gère l'émission et le renouvellement du certificat automatiquement.

### 5.3 Pare-feu

```bash
sudo ufw default deny incoming
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Les ports 8080 (application) et 8787 (agent MT5) ne doivent **jamais** être
ouverts publiquement : `ss -ltnp | grep -E '8080|8787'` doit montrer
`127.0.0.1` uniquement.

---

## 6. Pont MetaTrader 5 démo (nœud Windows)

La bibliothèque officielle `MetaTrader5` ne fonctionne que sous Windows. Le VPS
interroge un **agent** local par HTTP + jeton partagé.

### 6.1 Nœud Windows

1. Installer le terminal MT5 et se connecter à un **compte démo**.
2. Installer Python 3.10+ puis `py -3 -m pip install MetaTrader5`.
3. Depuis le dépôt, en administrateur :

```powershell
.\deploy\windows\install-agent.ps1 -BridgeToken "jeton-de-32-caracteres-minimum" -Port 8787
```

Le script copie l'agent dans `C:\CarnetMt5Agent`, protège le jeton par ACL
(Administrateurs + SYSTEM), crée la tâche planifiée `CarnetMt5Agent` au
démarrage et lance l'agent sur `127.0.0.1:8787`.

4. Vérifier : `Get-ScheduledTask CarnetMt5Agent`, puis
   `Invoke-RestMethod http://127.0.0.1:8787/health -Headers @{ "X-Bridge-Token" = "…" }`.

### 6.2 Tunnel depuis le VPS

```bash
ssh -N -L 8787:127.0.0.1:8787 utilisateur@windows-node
```

Pour un service permanent :

```ini
# /etc/systemd/system/carnet-mt5-tunnel.service
[Unit]
Description=Tunnel SSH vers l'agent MT5
After=network-online.target
Wants=network-online.target

[Service]
User=carnet
ExecStart=/usr/bin/ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -o StrictHostKeyChecking=accept-new -i /var/lib/carnet/.ssh/mt5_tunnel \
  -L 8787:127.0.0.1:8787 utilisateur@windows-node
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Puis `systemctl enable --now carnet-mt5-tunnel`.

### 6.3 Configuration dans l'interface

`Paramètres → Connexion MetaTrader 5 (démo)` :

| Champ | Valeur |
|-------|--------|
| URL de l'agent | `http://127.0.0.1:8787` (via tunnel) ou `https://mt5.exemple.fr` |
| Jeton | le même que `-BridgeToken` |
| Courtier / Serveur / Login | informations du compte démo |
| Suffixe d'instrument | `.a`, `_raw`, … selon le courtier |
| Activer le pont | requis pour que le moteur utilise le terminal |
| Autoriser les ordres démo | désactivé par défaut ; bracket obligatoire |

Le bouton « Tester la connexion » interroge aussi `GET /symbols` de l'agent et
compare les 8 instruments canoniques aux noms réellement proposés par le terminal.
Le résultat (`symbols.matched`, `symbols.missing`) indique exactement quoi corriger :
un instrument manquant n'empêche pas le pont de fonctionner — il est simplement
ignoré par le moteur, sans cotation — mais il vaut mieux aligner la correspondance
avant d'activer les ordres.

Testez d'abord avec « Tester la connexion » (aucun enregistrement), puis
enregistrez et **redémarrez le service** : le moteur charge le pont au
démarrage. L'interface affiche « redémarrage requis » tant que ce n'est pas fait.

Contrôles automatiques côté connecteur :

- `/health` doit être `ok` et `account_type` ≠ `real` → sinon
  `RealTradingForbidden` ;
- ordre sans stop **et** objectif → `OrderRejected` (bracket obligatoire) ;
- `MT5_ORDER_NOT_ENABLED` tant que l'option d'ordres démo n'est pas cochée ;
- délai dépassé ou réponse sans identifiant → `OrderTimeout`, ordre jamais
  renvoyé (reprise par réconciliation, statut inconnu signalé).

### 6.4 Retour à la simulation

`Désactiver le pont` dans l'interface (désarme aussi les ordres), puis
`systemctl restart carnet`. Le fichier `var/mt5_connection.json` (0600) reste
présent mais `enabled=false` ; supprimez-le si vous voulez repartir de zéro.

---

## 7. Canal d'alerte (webhook)

`Paramètres → Canal d'alerte` :

- URL : Slack (`https://hooks.slack.com/services/…`), Discord, Teams ou
  webhook générique ;
- format : détection automatique ou forcée ;
- niveau minimum : `WARNING` (défaut) ou `CRITICAL` ;
- boutons : *Envoyer un test*, *Désactiver*.

Comportement : 3 tentatives avec repli exponentiel, URL masquée dans l'API,
compteurs `sent`/`failures`, dernier résultat horodaté. Les secrets ne sont
jamais renvoyés ni journalisés ; le fichier `var/alerts.json` est en 0600.

Alternative : `CARNET_WEBHOOK_URL` dans `carnet.env` pour amorcer le canal sans
passer par l'interface.

Recommandation : restreindre le webhook au canal d'exploitation et vérifier
qu'il fonctionne après chaque redémarrage (`POST /api/alerts/test`).

---

## 8. Sauvegardes et exercices de restauration

- Sauvegarde interne périodique + CLI : `./scripts/backup.py`.
- `carnet-drill.timer` exécute `backup.py drill` chaque dimanche à 04:30
  (premier dimanche après installation ; `systemctl list-timers`).

```bash
sudo -u carnet /opt/carnet/venv/bin/python /opt/carnet/scripts/backup.py list
sudo -u carnet /opt/carnet/venv/bin/python /opt/carnet/scripts/backup.py drill
```

Copie hors site (exemple) :

```bash
rsync -a --delete /var/lib/carnet/backups/ ops@backup.exemple.fr:/srv/carnet/
```

Voir `docs/OPERATIONS.md` pour la procédure de restauration et la rotation des
identifiants.

---

## 9. Mise à jour

```bash
cd football-ai && git pull
cd carnet-de-trading && sudo ./deploy/install.sh        # réutilise la configuration
```

Le script recopie l'application, conserve `/etc/carnet/carnet.env`, redémarre
le service et vérifie `/api/health`. Les migrations SQLite sont appliquées au
démarrage (`db.migrate()`), sans perte de données.

Avant toute mise à jour :

1. `./scripts/backup.py create --label pre-update`
2. vérifier `./scripts/backup.py verify <chemin>`
3. noter la version affichée dans `À propos`.

---

## 10. Supervision

| Contrôle | Commande / source |
|----------|-------------------|
| Santé HTTP | `curl -fsS http://127.0.0.1:8080/api/health` |
| Santé système | `systemctl status carnet` |
| Erreurs applicatives | `journalctl -u carnet -p warning` |
| Chaîne du journal | `POST /api/journal/verify` (UI : Journal) |
| Réconciliation | statut en pied de page ; `GET /api/state` |
| Pont MT5 | `GET /api/connections/mt5`, `var/mt5_connection.json` |
| Alertes | `GET /api/alerts`, compteur `failures` |

Sonde externe recommandée (Uptime Kuma, Healthchecks) sur
`https://carnet.exemple.fr/api/health` toutes les 60 s. Le canal d'alerte
applicatif complète la supervision mais ne la remplace pas.

---

## 11. Dépannage

| Symptôme | Cause probable | Action |
|----------|----------------|--------|
| `Le service ne répond pas` | port occupé, configuration invalide | `journalctl -u carnet -n 80`, `ss -ltnp \| grep 8080` |
| `502 Bad Gateway` | service arrêté | `systemctl restart carnet` |
| `401` immédiat sur toutes les routes | jeton de session expiré | se reconnecter |
| Pont MT5 « non connecté » | terminal fermé, tunnel rompu | `Get-ScheduledTask`, `systemctl status carnet-mt5-tunnel` |
| `MT5_BRIDGE_UNAUTHORIZED` | jeton différent | recopier le jeton dans l'interface |
| `REAL_TRADING_FORBIDDEN` | compte réel connecté au terminal | reconnecter le terminal sur un compte démo |
| `MT5_ORDER_NOT_ENABLED` | ordres démo non activés | cocher l'option puis redémarrer |
| Alertes non reçues | webhook révoqué | `Envoyer un test`, consulter `failures` |
| Disque plein | sauvegardes accumulées | `./scripts/backup.py list`, purger selon la politique |

En cas d'incident de marché ou de comportement anormal : utiliser
**Arrêt d'urgence** dans l'interface (bloque les entrées et journalise), puis
`systemctl stop carnet` si nécessaire. Aucun ordre réel ne peut être émis.

---

## 12. Liste de contrôle avant ouverture

- [ ] `deploy/install.sh` terminé sans erreur, `/api/health` OK.
- [ ] HTTPS actif, redirection HTTP → HTTPS, HSTS présent.
- [ ] `ufw` actif ; 8080 et 8787 non exposés (`ss -ltnp`).
- [ ] Mot de passe admin changé, MFA activée pour les comptes ADMIN.
- [ ] `CARNET_ALLOW_REAL=0` vérifié.
- [ ] Canal d'alerte testé ; test reçu hors site.
- [ ] Sauvegarde manuelle créée et vérifiée ; timer de drill armé.
- [ ] Pont MT5 (si utilisé) : compte démo, account_type `demo`, tunnel chiffré,
      ordres démo désactivés jusqu'à validation explicite.
- [ ] Superficie d'API relue : `/api/public/info` ne divulgue aucun secret.
