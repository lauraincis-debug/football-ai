#!/usr/bin/env bash
# Désinstallation du service Carnet de Trading.
#
#   sudo ./deploy/uninstall.sh            # arrête et retire le service, garde les données
#   sudo ./deploy/uninstall.sh --purge    # supprime aussi /opt/carnet, /etc/carnet et les données
set -euo pipefail

PREFIX="/opt/carnet"
ENV_DIR="/etc/carnet"
STATE_DIR="/var/lib/carnet"
SERVICE_USER="carnet"
PURGE="no"

for arg in "$@"; do
  case "$arg" in
    --purge) PURGE="yes" ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "Option inconnue : $arg" >&2; exit 2 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Lancez ce script en root (sudo)." >&2; exit 1; }

echo "[carnet] arrêt du service"
systemctl disable --now carnet-drill.timer 2>/dev/null || true
systemctl disable --now carnet.service 2>/dev/null || true

echo "[carnet] suppression des unités systemd"
rm -f /etc/systemd/system/carnet.service \
      /etc/systemd/system/carnet-drill.service \
      /etc/systemd/system/carnet-drill.timer
systemctl daemon-reload
systemctl reset-failed carnet.service 2>/dev/null || true

for proxy_file in /etc/nginx/sites-enabled/carnet.conf /etc/nginx/sites-available/carnet.conf; do
  [[ -e "$proxy_file" ]] && rm -f "$proxy_file"
done
if command -v nginx >/dev/null; then
  nginx -t && systemctl reload nginx || true
fi

if [[ "$PURGE" == "yes" ]]; then
  read -r -p "Supprimer définitivement $PREFIX, $ENV_DIR et $STATE_DIR ? [oui/NON] " answer
  if [[ "${answer,,}" == "oui" ]]; then
    rm -rf "$PREFIX" "$ENV_DIR" "$STATE_DIR"
    if id "$SERVICE_USER" >/dev/null 2>&1; then
      userdel "$SERVICE_USER" 2>/dev/null || true
    fi
    echo "[carnet] données et compte de service supprimés"
  else
    echo "[carnet] purge annulée : données conservées"
  fi
else
  echo "[carnet] service retiré ; données conservées dans $STATE_DIR et $ENV_DIR"
fi
echo "[carnet] terminé"
