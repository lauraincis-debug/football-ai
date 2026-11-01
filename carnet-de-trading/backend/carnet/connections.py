"""Connexions aux plateformes d'exécution (sections 9, 10 et 26).

La configuration MT5 (pont, jeton, identifiants) est un secret : elle vit dans
``var/mt5_connection.json`` avec des droits 600, jamais en base, jamais dans le
journal, jamais renvoyée en clair par l'API.

Le connecteur est choisi **au démarrage** : une configuration active remplace le
connecteur de simulation par le pont MT5 démo. Un échec de connexion ne bascule
jamais silencieusement en simulation — le service signale l'erreur et reste
bloqué, ce qui évite toute confusion entre démo réelle et simulation.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .connectors.base import ConnectorError, ConnectorUnavailable
from .connectors.mt5_bridge import Mt5BridgeConnector
from .util import iso, now_utc

FIELDS = ("enabled", "bridge_url", "bridge_token", "broker", "server", "login",
          "password", "symbol_suffix", "allow_demo_orders")
SECRET_FIELDS = ("bridge_token", "password")


class Mt5ConnectionStore:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.config: dict[str, Any] = self.load()

    # -- persistance -----------------------------------------------------
    def load(self) -> dict[str, Any]:
        defaults: dict[str, Any] = {
            "enabled": False, "bridge_url": "", "bridge_token": "", "broker": "",
            "server": "", "login": "", "password": "", "symbol_suffix": "",
            "allow_demo_orders": False, "last_test": None, "updated_at": None,
        }
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return defaults
        if isinstance(data, dict):
            defaults.update({key: data[key] for key in data if key in defaults})
        return defaults

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = dict(self.config)
        payload["updated_at"] = iso(now_utc())
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        try:
            os.chmod(tmp, 0o600)
        except OSError:  # pragma: no cover
            pass
        tmp.replace(self.path)
        self.config = payload

    # -- écriture --------------------------------------------------------
    def configure(self, payload: dict[str, Any], *, activate: bool | None = None) -> dict[str, Any]:
        config = dict(self.config)
        for key in FIELDS:
            if key not in payload or payload[key] is None:
                continue
            value = payload[key]
            if key in SECRET_FIELDS:
                text = str(value).strip()
                if text:  # une chaîne vide conserve le secret existant
                    config[key] = text
                continue
            if key == "enabled":
                config[key] = bool(value)
            elif key == "allow_demo_orders":
                config[key] = bool(value)
            elif key == "login":
                config[key] = str(value).strip()
            else:
                config[key] = str(value).strip()
        if payload.get("clear_secrets"):
            for key in SECRET_FIELDS:
                config[key] = ""

        if config["bridge_url"]:
            lower = config["bridge_url"].lower()
            if not lower.startswith(("http://", "https://")):
                raise ValueError("l'URL du pont doit commencer par http:// ou https://")
            if not config["bridge_token"]:
                raise ValueError("le jeton du pont est requis pour joindre l'agent MT5")
        if config["enabled"] and not config["bridge_url"]:
            raise ValueError("impossible d'activer le pont MT5 sans URL")
        if config["allow_demo_orders"] and not config["enabled"]:
            raise ValueError("les ordres démo exigent un pont MT5 actif")
        if activate is not None:
            config["enabled"] = bool(activate)
        self.config = config
        self.save()
        return self.public()

    def disable(self) -> dict[str, Any]:
        self.config["enabled"] = False
        self.config["allow_demo_orders"] = False
        self.save()
        return self.public()

    def remember_test(self, result: dict[str, Any]) -> None:
        self.config["last_test"] = {
            "ok": bool(result.get("ok")), "at": iso(now_utc()),
            "detail": str(result.get("detail") or result.get("error") or "")[:300],
        }
        self.save()

    # -- lecture ---------------------------------------------------------
    def public(self) -> dict[str, Any]:
        config = self.config
        return {
            "enabled": bool(config.get("enabled")),
            "bridge_url": config.get("bridge_url") or "",
            "bridge_url_masked": self._mask_url(config.get("bridge_url") or ""),
            "has_token": bool(config.get("bridge_token")),
            "has_password": bool(config.get("password")),
            "broker": config.get("broker") or "",
            "server": config.get("server") or "",
            "login": config.get("login") or "",
            "symbol_suffix": config.get("symbol_suffix") or "",
            "allow_demo_orders": bool(config.get("allow_demo_orders")),
            "last_test": config.get("last_test"),
            "updated_at": config.get("updated_at"),
            "orders_notice": ("ordres démo autorisés" if config.get("allow_demo_orders")
                              else "ordres désactivés (activation explicite requise)"),
        }

    @staticmethod
    def _mask_url(url: str) -> str:
        if not url:
            return ""
        from urllib.parse import urlsplit, urlunsplit

        parts = urlsplit(url)
        return urlunsplit((parts.scheme, parts.netloc, parts.path or "/", "", ""))

    # -- construction ----------------------------------------------------
    def build_connector(self) -> Mt5BridgeConnector:
        config = self.config
        if not config.get("bridge_url"):
            raise ValueError("pont MT5 non configuré")
        return Mt5BridgeConnector(
            config["bridge_url"], config.get("bridge_token") or "",
            environment="DEMO", allow_orders=bool(config.get("allow_demo_orders")),
            broker=config.get("broker") or None, login=config.get("login") or None,
            symbol_suffix=config.get("symbol_suffix") or "",
        )

    def test(self) -> dict[str, Any]:
        """Test de bout en bout, sans toucher au moteur en cours d'exécution."""
        if not self.config.get("bridge_url"):
            return {"ok": False, "code": "MT5_BRIDGE_MISSING",
                    "detail": "aucun pont MT5 configuré"}
        connector = self.build_connector()
        try:
            connector.connect()
            account = connector.account()
            positions = connector.positions()
            orders = connector.open_orders()
            quotes = connector.quotes(["EURUSD", "BTCUSDT"])
            result = {
                "ok": True, "detail": "pont joignable et terminal prêt",
                "account": {"account_id": account.account_id, "currency": account.currency,
                            "balance": float(account.balance), "equity": float(account.equity),
                            "leverage": account.leverage, "broker": account.broker},
                "positions": len(positions), "open_orders": len(orders),
                "quotes_received": len(quotes), "orders_enabled": connector.allow_orders,
                "account_kind": connector.account_kind,
                "terminal": connector.terminal,
            }
        except (ConnectorError, ValueError) as exc:
            result = {"ok": False, "code": getattr(exc, "code", "MT5_TEST_FAILED"),
                      "detail": str(exc)}
        finally:
            try:
                connector.disconnect()
            except Exception:  # pragma: no cover - défensif
                pass
        self.remember_test(result)
        return result


__all__ = ["Mt5ConnectionStore", "Mt5BridgeConnector", "ConnectorUnavailable"]
