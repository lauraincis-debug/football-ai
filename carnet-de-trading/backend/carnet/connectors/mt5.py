"""Connecteur MetaTrader 5 — adaptateur encadré (section 9).

La bibliothèque officielle ``MetaTrader5`` n'existe que sous Windows : le
connecteur est donc isolé derrière cette interface et refuse de démarrer s'il
n'est pas disponible, plutôt que de simuler une connexion inexistante.

Règles appliquées :
- aucune connexion réelle n'est tentée sans identifiants fournis par le
  propriétaire et sans validation de la section 24 ;
- un compte réel est refusé par défaut (``allow_real`` explicite) ;
- toute erreur de connexion est remontée, jamais masquée par une donnée fictive.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Any

from ..util import D, ZERO, now_utc, to_utc
from .base import (
    AccountSnapshot,
    BrokerConnector,
    ConnectorUnavailable,
    OpenOrderReport,
    OrderAck,
    OrderRequest,
    OrderStatusReport,
    PositionReport,
    RealTradingForbidden,
)


class Mt5Connector(BrokerConnector):
    name = "MetaTrader 5"
    kind = "mt5"
    real_capable = True

    def __init__(self, login: int | None = None, password: str | None = None,
                 server: str | None = None, path: str | None = None,
                 environment: str = "DEMO", allow_real: bool = False,
                 module: Any | None = None):
        super().__init__(environment=environment)
        self.login = login
        self._password = password
        self.server = server
        self.path = path
        self.allow_real = allow_real
        self._module = module

    # -- disponibilité ---------------------------------------------------
    def module(self):
        if self._module is not None:
            return self._module
        try:  # pragma: no cover - dépend d'une installation Windows
            import MetaTrader5 as mt5  # type: ignore

            self._module = mt5
            return mt5
        except Exception as exc:
            raise ConnectorUnavailable(
                "la bibliothèque MetaTrader5 est indisponible sur ce système "
                "(le paquet officiel est limité à Windows) — voir BLOCKERS.md",
                "MT5_UNAVAILABLE",
            ) from exc

    def credentials_present(self) -> bool:
        return bool(self.login and self._password and self.server)

    def connect(self) -> None:
        if self.environment.startswith("REAL") and not self.allow_real:
            raise RealTradingForbidden(
                "connexion à un compte MT5 réel interdite sans autorisation propriétaire explicite")
        if not self.credentials_present():
            raise ConnectorUnavailable(
                "identifiants MT5 absents : renseigner le courtier, le compte démo et le serveur "
                "dans la configuration propriétaire (section 26)", "MT5_CREDENTIALS_MISSING")
        mt5 = self.module()
        init = getattr(mt5, "initialize", None)
        if init is None:
            raise ConnectorUnavailable("module MetaTrader5 incomplet", "MT5_INVALID_MODULE")
        ok = init(login=self.login, password=self._password, server=self.server,
                  path=self.path or None)
        if not ok:
            raise ConnectorUnavailable(f"initialisation MT5 refusée: {getattr(mt5, 'last_error', lambda: '?')()}")
        self._connected = True

    def disconnect(self) -> None:
        if self._connected:
            shutdown = getattr(self.module(), "shutdown", None)
            if shutdown:
                shutdown()
        self._connected = False

    def health(self) -> dict[str, Any]:
        return {
            "connector": self.name, "connected": self._connected,
            "environment": self.environment, "credentials": self.credentials_present(),
            "note": "connecteur non configuré tant que le courtier n'est pas sélectionné",
        }

    # -- compte ----------------------------------------------------------
    def _require(self) -> Any:
        if not self._connected:
            raise ConnectorUnavailable("connexion MT5 non établie")
        return self.module()

    def account(self) -> AccountSnapshot:
        mt5 = self._require()
        info = mt5.account_info()
        if info is None:
            raise ConnectorUnavailable("informations de compte MT5 indisponibles")
        data = info._asdict() if hasattr(info, "_asdict") else dict(info)
        return AccountSnapshot(
            account_id=str(data.get("login")), currency=str(data.get("currency", "USD")),
            balance=D(data.get("balance", 0)), equity=D(data.get("equity", 0)),
            free_margin=D(data.get("margin_free", 0)), margin_used=D(data.get("margin", 0)),
            leverage=int(data.get("leverage", 1)), environment=self.environment,
            broker=f"{self.server or 'MT5'}", extra=data,
        )

    def positions(self) -> list[PositionReport]:
        mt5 = self._require()
        raw = mt5.positions_get() or []
        out: list[PositionReport] = []
        for item in raw:
            data = item._asdict() if hasattr(item, "_asdict") else dict(item)
            out.append(PositionReport(
                platform_position_id=str(data.get("ticket")), symbol=str(data.get("symbol")),
                side="BUY" if data.get("type") == 0 else "SELL", qty=D(data.get("volume", 0)),
                entry_price=D(data.get("price_open", 0)),
                stop_price=D(data["sl"]) if data.get("sl") else None,
                target_price=D(data["tp"]) if data.get("tp") else None,
                unrealized_pnl=D(data.get("profit", 0)),
                opened_at=to_utc(data.get("time")) or now_utc(),
                strategy=str(data.get("comment")) if data.get("comment") else None,
            ))
        return out

    def open_orders(self) -> list[OpenOrderReport]:
        mt5 = self._require()
        raw = mt5.orders_get() or []
        out: list[OpenOrderReport] = []
        for item in raw:
            data = item._asdict() if hasattr(item, "_asdict") else dict(item)
            out.append(OpenOrderReport(
                platform_order_id=str(data.get("ticket")), symbol=str(data.get("symbol")),
                side="BUY" if data.get("type") == 0 else "SELL", qty=D(data.get("volume", 0)),
                filled_qty=ZERO, order_type=str(data.get("type")), price=D(data.get("price_open", 0)),
                state="ACCEPTED",
            ))
        return out

    def history(self, since: dt.datetime | None = None) -> list[dict[str, Any]]:
        mt5 = self._require()
        start = to_utc(since) or (now_utc() - dt.timedelta(days=30))
        deals = mt5.history_deals_get(start, now_utc()) or []
        return [d._asdict() if hasattr(d, "_asdict") else dict(d) for d in deals]

    # -- ordres ----------------------------------------------------------
    def place_order(self, request: OrderRequest) -> OrderAck:
        if not request.environment.startswith("DEMO") and not self.allow_real:
            raise RealTradingForbidden(
                "ordre MT5 hors démo interdit : la mise en production réelle n'est pas autorisée")
        raise ConnectorUnavailable(
            "le passage d'ordre MT5 n'est activé qu'après sélection du courtier et tests de "
            "compatibilité (sections 9 et 26)", "MT5_ORDER_NOT_ENABLED")

    def cancel_order(self, platform_order_id: str) -> bool:
        raise ConnectorUnavailable("annulation MT5 non activée avant sélection du courtier")

    def order_status(self, platform_order_id: str) -> OrderStatusReport:
        raise ConnectorUnavailable("suivi d'ordre MT5 non activé avant sélection du courtier")

    def verify_key_permissions(self) -> dict[str, Any]:
        return {
            "checked": False,
            "withdraw_enabled": None,
            "note": "MT5 n'utilise pas de clé API ; les retraits ne sont pas exposés au robot.",
        }
