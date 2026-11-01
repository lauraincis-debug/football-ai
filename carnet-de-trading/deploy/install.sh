#!/usr/bin/env bash
# Installation du service Carnet de Trading sur un VPS Debian/Ubuntu.
#
#   sudo ./deploy/install.sh --domain carnet.exemple.fr --tls nginx --email ops@exemple.fr
#
# Le script est idempotent : relancé, il met à jour le code et redémarre le
# service. Aucun secret n'est affiché ni écrit en clair dans les journaux.
set -euo pipefail

SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREFIX="/opt/carnet"
SERVICE_USER="carnet"
ENV_DIR="/etc/carnet"
STATE_DIR="/var/lib/carnet"
DOMAIN=""
EMAIL=""
TLS="none"
START="yes"

usage() {
  cat <<'EOF'
Usage : sudo ./deploy/install.sh [options]

  --source DIR        dépôt à installer (défaut : dossier parent du script)
  --prefix DIR        répertoire d'installation (défaut : /opt/carnet)
  --domain FQDN       nom public servi par le reverse proxy TLS
  --email ADRESSE     adresse ACME (certbot) pour le certificat
  --tls none|nginx|caddy   reverse proxy à configurer (défaut : none)
  --no-start          installe sans démarrer le service
  -h, --help          cette aide

Sans --domain, le service écoute sur 127.0.0.1:8080 et aucun vhost n'est créé :
utilisez un tunnel SSH tant que le domaine n'est pas prêt.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE="${2:?}"; shift 2 ;;
    --prefix) PREFIX="${2:?}"; shift 2 ;;
    --domain) DOMAIN="${2:?}"; shift 2 ;;
    --email) EMAIL="${2:?}"; shift 2 ;;
    --tls) TLS="${2:?}"; shift 2 ;;
    --no-start) START="no"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; usage >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;36m[carnet]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[carnet]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[carnet]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Lancez ce script en root (sudo)."
[[ -f "$SOURCE/backend/carnet/server.py" ]] || die "Dépôt introuvable dans $SOURCE"
case "$TLS" in none|nginx|caddy) ;; *) die "--tls doit valoir none, nginx ou caddy" ;; esac
if [[ "$TLS" != "none" && -z "$DOMAIN" ]]; then
  die "--tls $TLS exige --domain"
fi

command -v python3 >/dev/null || die "python3 est requis"
python3 - <<'PY' || die "Python 3.10+ est requis"
import sys
raise SystemExit(0 if sys.version_info >= (3, 10) else 1)
PY

log "Installation des paquets système (si nécessaire)"
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq python3-venv rsync curl ca-certificates >/dev/null
fi

log "Compte de service $SERVICE_USER"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$PREFIX" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

log "Copie de l'application vers $PREFIX"
install -d -m 0755 "$PREFIX"
rsync -a --delete \
  --exclude '.git' --exclude 'var' --exclude 'data' --exclude '__pycache__' \
  --exclude '*.pyc' --exclude '.venv' --exclude 'node_modules' \
  "$SOURCE/" "$PREFIX/"
chown -R root:"$SERVICE_USER" "$PREFIX"
chmod -R go-w "$PREFIX"

log "Environnement Python isolé"
if [[ ! -x "$PREFIX/venv/bin/python" ]]; then
  python3 -m venv "$PREFIX/venv"
fi
"$PREFIX/venv/bin/python" -m pip install --quiet --upgrade pip >/dev/null
# L'application n'utilise que la bibliothèque standard : aucune dépendance tierce.

install -d -m 0750 -o root -g "$SERVICE_USER" "$ENV_DIR"
install -d -m 0700 -o "$SERVICE_USER" -g "$SERVICE_USER" \
  "$STATE_DIR" "$STATE_DIR/data" "$STATE_DIR/var" "$STATE_DIR/backups"

if [[ ! -f "$ENV_DIR/carnet.env" ]]; then
  log "Création de $ENV_DIR/carnet.env (secrets locaux, 0640)"
  install -m 0640 -o root -g "$SERVICE_USER" \
    "$PREFIX/deploy/carnet.env.example" "$ENV_DIR/carnet.env"
  if [[ -n "$DOMAIN" ]]; then
    sed -i "s/^CARNET_SIM_SPEED=.*/CARNET_SIM_SPEED=60/" "$ENV_DIR/carnet.env"
  fi
else
  log "Conservation de $ENV_DIR/carnet.env existant"
fi

log "Unité systemd"
install -m 0644 "$PREFIX/deploy/systemd/carnet.service" /etc/systemd/system/carnet.service
install -m 0644 "$PREFIX/deploy/systemd/carnet-drill.service" /etc/systemd/system/carnet-drill.service
install -m 0644 "$PREFIX/deploy/systemd/carnet-drill.timer" /etc/systemd/system/carnet-drill.timer
systemctl daemon-reload
systemctl enable carnet.service >/dev/null
systemctl enable --now carnet-drill.timer >/dev/null

if [[ "$START" == "yes" ]]; then
  log "Démarrage du service"
  systemctl restart carnet.service
  for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1; then break; fi
    sleep 1
  done
  curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1 \
    || die "Le service ne répond pas : journalctl -u carnet -n 80"
  log "Service opérationnel (health OK)"
else
  log "Service installé mais non démarré (--no-start)"
fi

if [[ "$TLS" == "nginx" ]]; then
  command -v nginx >/dev/null || die "nginx absent : apt-get install nginx"
  log "Vhost nginx pour $DOMAIN"
  sed "s/carnet\.exemple\.fr/$DOMAIN/g" "$PREFIX/deploy/nginx/carnet.conf" \
    > /etc/nginx/sites-available/carnet.conf
  ln -sf /etc/nginx/sites-available/carnet.conf /etc/nginx/sites-enabled/carnet.conf
  nginx -t
  systemctl reload nginx
  if [[ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
    warn "Certificat absent. Exécutez : certbot --nginx -d $DOMAIN ${EMAIL:+--email $EMAIL -m }"
    warn "puis : systemctl reload nginx"
  fi
elif [[ "$TLS" == "caddy" ]]; then
  command -v caddy >/dev/null || die "caddy absent : voir https://caddyserver.com/docs/install"
  log "Caddyfile pour $DOMAIN"
  sed "s/carnet\.exemple\.fr/$DOMAIN/g" "$PREFIX/deploy/caddy/Caddyfile" > /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  systemctl reload caddy || systemctl restart caddy
fi

cat <<EOF

──────────────────────────────────────────────────────────────────────
 Carnet de Trading installé dans $PREFIX
 Service      systemctl status carnet
 Journaux     journalctl -u carnet -f
 Écoute       127.0.0.1:8080 (jamais exposé directement)
 Données      $STATE_DIR
 Secrets      $ENV_DIR/carnet.env (0640 root:$SERVICE_USER)
 Alertes      canal externe à configurer dans l'interface (Paramètres)
 MT5 démo     onglet Paramètres → « Connexion MetaTrader 5 (démo) »
 Pont MT5     nœud Windows : deploy/windows/install-agent.ps1 + tunnel SSH
 Sauvegardes  systemd timer carnet-drill.timer (exercice hebdomadaire)
 Documentation docs/DEPLOYMENT.md et docs/OPERATIONS.md
──────────────────────────────────────────────────────────────────────
EOF
