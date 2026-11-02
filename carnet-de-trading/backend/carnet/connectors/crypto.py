"""Connecteur crypto Spot (section 10) — adaptateur générique, sans exchange figé.

L'exchange reste à sélectionner (section 26). Ce module fournit :
- la signature HMAC d'une API de type « Binance compatible » ;
- la vérification des permissions de clé (retrait interdit, section 17.2) ;
- un transport injectable, ce qui rend le connecteur testable hors ligne ;
- un refus explicite de tout ordre réel tant que la production n'est pas validée.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import json
import time
import urllib.parse
import urllib.request
from decimal import Decimal
from typing import Any, Callable

from ..util import D, ZERO, now_utc, to_utc
from .base import (
    AccountSnapshot,
    BrokerConnector,
    ConnectorError,
    ConnectorUnavailable,
    OpenOrderReport,
    OrderAck,
    OrderRejected,
    OrderRequest,
    OrderStatusReport,
    PositionReport,
    RealTradingForbidden,
)

Transport = Callable[[str, str, dict[str, Any], dict[str, str]], dict[str, Any]]


def http_transport(method: str, url: str, params: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
    """Transport HTTP réel, volontairement isolé et remplaçable (tests hors ligne)."""
    query = urllib.parse.urlencode(params)
    data = None
    target = url
    if method == "GET" and query:
        target = f"{url}?{query}"
    elif method != "GET":
        data = query.encode()
    request = urllib.request.Request(target, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=10) as response:  # nosec - URL fixée par config
        payload = response.read().decode("utf-8")
    return json.loads(payload or "{}")


class CryptoSpotConnector(BrokerConnector):
    """Spot uniquement : ni marge, ni futures, ni levier (section 10)."""

    name = "Crypto Spot (exchange à sélectionner)"
    kind = "crypto"
    real_capable = True

    def __init__(self, base_url: str | None = None, api_key: str | None = None,
                 api_secret: str | None = None, environment: str = "DEMO",
                 allow_real: bool = False, transport: Transport | None = None,
                 recv_window: int = 5000):
        super().__init__(environment=environment)
        self.base_url = (base_url or "").rstrip("/")
        self.api_key = api_key
        self._api_secret = api_secret
        self.allow_real = allow_real
        self.transport = transport or http_transport
        self.recv_window = recv_window
        self.key_permissions: dict[str, Any] = {"checked": False, "withdraw_enabled": None}

    # -- disponibilité ---------------------------------------------------
    def configured(self) -> bool:
        return bool(self.base_url and self.api_key and self._api_secret)

    def connect(self) -> None:
        if self.environment.startswith("REAL") and not self.allow_real:
            raise RealTradingForbidden(
                "connexion à un exchange réel interdite sans autorisation propriétaire explicite")
        if not self.configured():
            raise ConnectorUnavailable(
                "exchange non configuré : sélection et clés API à fournir par le propriétaire "
                "(section 26)", "CRYPTO_NOT_CONFIGURED")
        permissions = self.verify_key_permissions()
        if permissions.get("withdraw_enabled"):
            raise ConnectorUnavailable(
                "clé API disposant de la permission de retrait : connexion refusée "
                "(sections 10 et 17.2)", "API_KEY_WITHDRAW_FORBIDDEN")
        self._connected = True

    def disconnect(self) -> None:
        self._connected = False

    def health(self) -> dict[str, Any]:
        return {
            "connector": self.name, "connected": self._connected,
            "environment": self.environment, "configured": self.configured(),
            "permissions": self.key_permissions,
        }

    # -- signature -------------------------------------------------------
    def _sign(self, query: str) -> str:
        if not self._api_secret:
            raise ConnectorUnavailable("secret API absent")
        return hmac.new(self._api_secret.encode(), query.encode(), hashlib.sha256).hexdigest()

    def _request(self, method: str, path: str, params: dict[str, Any] | None = None,
                 signed: bool = True) -> dict[str, Any]:
        if not self.base_url:
            raise ConnectorUnavailable("URL d'exchange absente")
        payload: dict[str, Any] = dict(params or {})
        headers = {"Accept": "application/json", "User-Agent": "CarnetDeTrading/1.0"}
        if signed:
            payload["timestamp"] = int(time.time() * 1000)
            payload["recvWindow"] = self.recv_window
            query = urllib.parse.urlencode(payload, doseq=True)
            payload["signature"] = self._sign(query)
            headers["X-MBX-APIKEY"] = self.api_key or ""
        try:
            return self.transport(method, f"{self.base_url}{path}", payload, headers)
        except Exception as exc:  # pragma: no cover - dépend du réseau
            raise ConnectorError(f"appel API en échec: {exc}", "CRYPTO_HTTP_ERROR", retryable=True) from exc

    # -- permissions -----------------------------------------------------
    def verify_key_permissions(self) -> dict[str, Any]:
        """Refuse toute clé capable de retirer des fonds."""
        data = self._request("GET", "/sapi/v1/account/apiRestrictions")
        withdraw = bool(data.get("enableWithdrawals", False))
        self.key_permissions = {
            "checked": True,
            "withdraw_enabled": withdraw,
            "spot_trading": bool(data.get("enableSpotAndMarginTrading", data.get("canTrade", True))),
            "futures": bool(data.get("enableFutures", False)),
            "ip_restricted": bool(data.get("ipRestrict", True)),
            "raw": {k: v for k, v in data.items() if k.startswith("enable") or k == "ipRestrict"},
        }
        if self.key_permissions["futures"]:
            raise ConnectorUnavailable(
                "clé API autorisant les futures : hors périmètre V1 (Spot uniquement)",
                "API_KEY_FUTURES_FORBIDDEN")
        return self.key_permissions

    # -- compte ----------------------------------------------------------
    def _require(self) -> None:
        if not self._connected:
            raise ConnectorUnavailable("connecteur crypto non connecté")

    def account(self) -> AccountSnapshot:
        self._require()
        data = self._request("GET", "/api/v3/account")
        balances = {b["asset"]: D(b["free"]) + D(b["locked"]) for b in data.get("balances", [])}
        quote = D(balances.get("USDT", balances.get("USD", ZERO)))
        return AccountSnapshot(
            account_id=str(data.get("accountType", "SPOT")), currency="USDT",
            balance=quote, equity=quote, free_margin=quote, margin_used=ZERO,
            leverage=1, environment=self.environment, broker=self.base_url,
            extra={"assets": {k: float(v) for k, v in balances.items() if v > ZERO}},
        )

    def positions(self) -> list[PositionReport]:
        self._require()
        # En Spot, une « position » est un solde d'actif ; le suivi fin est local.
        return []

    def open_orders(self) -> list[OpenOrderReport]:
        self._require()
        rows = self._request("GET", "/api/v3/openOrders")
        out = []
        for row in rows if isinstance(rows, list) else []:
            out.append(OpenOrderReport(
                platform_order_id=str(row.get("orderId")), symbol=str(row.get("symbol")),
                side=str(row.get("side")), qty=D(row.get("origQty", 0)),
                filled_qty=D(row.get("executedQty", 0)), order_type=str(row.get("type")),
                price=D(row["price"]) if row.get("price") else None,
                state=str(row.get("status")), client_order_id=row.get("clientOrderId"),
            ))
        return out

    def history(self, since: dt.datetime | None = None) -> list[dict[str, Any]]:
        self._require()
        params = {"startTime": int((to_utc(since) or now_utc()).timestamp() * 1000)}
        data = self._request("GET", "/api/v3/myTrades", params)
        return data if isinstance(data, list) else []

    # -- ordres ----------------------------------------------------------
    def place_order(self, request: OrderRequest) -> OrderAck:
        if not request.environment.startswith("DEMO") and not self.allow_real:
            raise RealTradingForbidden(
                "ordre crypto hors sandbox interdit : la production réelle n'est pas autorisée")
        self._require()
        if not self.allow_real:
            raise ConnectorUnavailable(
                "passage d'ordre crypto non activé : exchange non sélectionné et sandbox non validé "
                "(sections 10 et 26)", "CRYPTO_ORDER_NOT_ENABLED")
        payload = {
            "symbol": request.symbol,
            "side": request.side,
            "type": request.order_type,
            "newClientOrderId": request.client_order_id,
            "quantity": str(request.qty),
        }
        if request.order_type == "LIMIT":
            payload["price"] = str(request.limit_price)
            payload["timeInForce"] = "GTC"
        data = self._request("POST", "/api/v3/order", payload)
        return OrderAck(str(data.get("orderId")), str(data.get("status", "ACCEPTED")),
                        message="ordre transmis (sandbox)")

    def cancel_order(self, platform_order_id: str) -> bool:
        self._require()
        self._request("DELETE", "/api/v3/order", {"orderId": platform_order_id})
        return True

    def order_status(self, platform_order_id: str) -> OrderStatusReport:
        self._require()
        data = self._request("GET", "/api/v3/order", {"orderId": platform_order_id})
        return OrderStatusReport(
            platform_order_id=platform_order_id,
            state=str(data.get("status", "UNKNOWN")),
            filled_qty=D(data.get("executedQty", 0)),
            avg_price=D(data["cummulativeQuoteQty"]) / D(data["executedQty"])
            if data.get("executedQty") and D(data["executedQty"]) > ZERO else None,
        )
