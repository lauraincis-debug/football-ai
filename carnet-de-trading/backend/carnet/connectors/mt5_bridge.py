"""Connecteur MetaTrader 5 via pont HTTP (agent Windows) — section 9.

Pourquoi un pont : la bibliothèque officielle ``MetaTrader5`` n'existe que pour
Windows et doit parler au terminal sur la même machine. Le nœud d'exécution
(Windows) héberge donc un agent minimal (``scripts/mt5_agent.py``) qui expose le
terminal en JSON ; l'application (VPS Linux) le pilote en HTTP avec un jeton.

Garde-fous conservés :
- aucun ordre réel : un compte de type « real » est refusé au branchement ;
- ordres désactivés par défaut (``MT5_ORDER_NOT_ENABLED``) : ils ne s'activent
  que si l'exploitant coche explicitement « ordres démo » ;
- bracket obligatoire (stop + objectif) pour tout ordre transmis ;
- toute réponse ambiguë reste ambiguë : un délai dépassé produit ``OrderTimeout``
  (statut incertain), jamais une réémission.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from decimal import Decimal
from typing import Any

from ..util import D, ZERO, iso, now_utc, to_utc
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
    OrderTimeout,
    PositionReport,
    RealTradingForbidden,
    UnknownOrderState,
)


class Mt5BridgeConnector(BrokerConnector):
    """Pilote un terminal MetaTrader 5 distant par l'agent HTTP dédié."""

    name = "MetaTrader 5 (pont)"
    kind = "mt5"
    supports_bracket = True
    supports_partial_fills = False
    real_capable = True

    def __init__(self, bridge_url: str, token: str, *, environment: str = "DEMO",
                 allow_orders: bool = False, broker: str | None = None,
                 login: int | str | None = None, symbol_suffix: str = "",
                 symbol_map: dict[str, str] | None = None,
                 timeout: float = 8.0, transport=None):
        super().__init__(environment=environment)
        self.bridge_url = (bridge_url or "").rstrip("/")
        self._token = token or ""
        self.allow_orders = bool(allow_orders)
        self.broker = broker or "MetaTrader 5"
        self.login = login
        self.symbol_suffix = symbol_suffix or ""
        self.symbol_map = {str(key).upper(): str(value)
                           for key, value in (symbol_map or {}).items()}
        self.timeout = timeout
        self.transport = transport or self._http
        self.account_kind = "unknown"
        self.terminal: dict[str, Any] = {}
        self._order_map: dict[str, str] = {}

    # -- transport -------------------------------------------------------
    def _http(self, method: str, url: str, payload: bytes | None,
              headers: dict[str, str], timeout: float) -> tuple[int, bytes]:
        request = urllib.request.Request(url, data=payload, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:  # nosec - pont de confiance
                return int(getattr(response, "status", 200)), response.read()
        except urllib.error.HTTPError as exc:
            return int(exc.code), exc.read()

    def _call(self, method: str, path: str, payload: dict[str, Any] | None = None,
              *, timeout: float | None = None) -> Any:
        if not self.bridge_url:
            raise ConnectorUnavailable("pont MT5 non configuré (URL absente)", "MT5_BRIDGE_MISSING")
        url = f"{self.bridge_url}{path}"
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        headers = {"Accept": "application/json", "X-Bridge-Token": self._token,
                   "User-Agent": "CarnetDeTrading/1.0"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        try:
            status, raw = self.transport(method, url, data, headers, timeout or self.timeout)
        except (TimeoutError, urllib.error.URLError) as exc:
            reason = getattr(exc, "reason", exc)
            if "timed out" in str(reason).lower():
                raise OrderTimeout(f"pont MT5 muet sur {path} : statut inconnu") from exc
            raise ConnectorError(f"pont MT5 injoignable : {reason}", "MT5_BRIDGE_UNREACHABLE",
                                 retryable=True) from exc
        body: Any = {}
        if raw:
            try:
                body = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                body = {"error": raw.decode("utf-8", "replace")[:300]}
        if status in (200, 201):
            return body
        message = str(body.get("error") or body.get("message") or f"HTTP {status}")
        code = str(body.get("code") or "MT5_BRIDGE_ERROR")
        if status == 401 or status == 403:
            raise ConnectorUnavailable(
                "pont MT5 : authentification refusée (jeton invalide)", "MT5_BRIDGE_UNAUTHORIZED")
        if status == 404 and path.startswith("/orders/"):
            raise UnknownOrderState(message)
        if status in (400, 409, 422):
            raise OrderRejected(message, code)
        if status in (408, 504):
            raise OrderTimeout(message)
        raise ConnectorError(message, code, retryable=status >= 500)

    # -- cycle de vie ----------------------------------------------------
    def connect(self) -> None:
        if self.environment.startswith("REAL"):
            raise RealTradingForbidden(
                "le pont MT5 refuse tout environnement réel : la V1 n'autorise que la démo")
        health = self._call("GET", "/health")
        if not health.get("ok", False):
            raise ConnectorUnavailable(
                f"terminal MT5 non prêt : {health.get('detail') or 'health non concluant'}",
                "MT5_TERMINAL_NOT_READY")
        self.account_kind = str(health.get("account_type") or "unknown").lower()
        if self.account_kind == "real":
            raise RealTradingForbidden(
                "le compte connecté au pont est un compte réel : connexion refusée (section 9)")
        self.terminal = health
        self._connected = True

    def disconnect(self) -> None:
        self._connected = False

    def health(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "connector": self.name, "connected": self._connected,
            "environment": self.environment, "account_kind": self.account_kind,
            "orders_enabled": self.allow_orders, "bridge": self.bridge_url,
            "terminal": self.terminal,
        }
        try:
            payload["remote"] = self._call("GET", "/health", timeout=3.0)
        except ConnectorError as exc:
            payload["remote"] = {"ok": False, "detail": str(exc)}
        return payload

    def verify_key_permissions(self) -> dict[str, Any]:
        return {"checked": True, "withdraw_enabled": False,
                "note": "MT5 n'expose pas de clé API ; les retraits sont hors périmètre du robot."}

    def _require(self) -> None:
        if not self._connected:
            raise ConnectorUnavailable("pont MT5 non connecté", "MT5_BRIDGE_DISCONNECTED")

    def _symbol(self, symbol: str) -> str:
        """Nom canonique → nom de la plateforme (correspondance explicite prioritaire)."""
        name = str(symbol).strip()
        mapped = self.symbol_map.get(name.upper())
        if mapped:
            return mapped
        return f"{name}{self.symbol_suffix}" if self.symbol_suffix else name

    def _strip_symbol(self, symbol: str) -> str:
        """Nom de la plateforme → nom canonique (ex. ``frxEURUSD`` → ``EURUSD``)."""
        platform = str(symbol)
        by_platform = {str(value).upper(): key for key, value in self.symbol_map.items()}
        if platform.upper() in by_platform:
            return by_platform[platform.upper()]
        if self.symbol_suffix and platform.upper().endswith(self.symbol_suffix.upper()):
            return platform[: -len(self.symbol_suffix)]
        return platform

    # -- compte, positions, ordres --------------------------------------
    def account(self) -> AccountSnapshot:
        self._require()
        data = self._call("GET", "/account")
        return AccountSnapshot(
            account_id=str(data.get("account_id") or self.login or "MT5"),
            currency=str(data.get("currency") or "USD"),
            balance=D(data.get("balance", "0")), equity=D(data.get("equity", "0")),
            free_margin=D(data.get("free_margin", "0")),
            margin_used=D(data.get("margin_used", "0")),
            leverage=int(data.get("leverage") or 1),
            environment=self.environment, broker=str(data.get("broker") or self.broker),
            extra={k: v for k, v in data.items() if k not in
                   {"account_id", "currency", "balance", "equity", "free_margin",
                    "margin_used", "leverage", "broker"}},
        )

    def positions(self) -> list[PositionReport]:
        self._require()
        rows = self._call("GET", "/positions") or []
        out: list[PositionReport] = []
        for row in rows if isinstance(rows, list) else []:
            out.append(PositionReport(
                platform_position_id=str(row["platform_position_id"]),
                symbol=self._strip_symbol(str(row["symbol"])),
                side=str(row.get("side") or "BUY").upper(),
                qty=D(row.get("qty", "0")),
                entry_price=D(row.get("entry_price", "0")),
                stop_price=D(row["stop_price"]) if row.get("stop_price") else None,
                target_price=D(row["target_price"]) if row.get("target_price") else None,
                unrealized_pnl=D(row.get("unrealized_pnl", "0")),
                opened_at=to_utc(row.get("opened_at")) or now_utc(),
                strategy=row.get("strategy") or None,
            ))
        return out

    def open_orders(self) -> list[OpenOrderReport]:
        self._require()
        rows = self._call("GET", "/orders") or []
        out: list[OpenOrderReport] = []
        for row in rows if isinstance(rows, list) else []:
            out.append(OpenOrderReport(
                platform_order_id=str(row["platform_order_id"]),
                symbol=self._strip_symbol(str(row["symbol"])),
                side=str(row.get("side") or "BUY").upper(),
                qty=D(row.get("qty", "0")), filled_qty=D(row.get("filled_qty", "0")),
                order_type=str(row.get("order_type") or "MARKET"),
                price=D(row["price"]) if row.get("price") else None,
                state=str(row.get("state") or "ACCEPTED"),
                client_order_id=row.get("client_order_id"),
            ))
        return out

    def history(self, since=None) -> list[dict[str, Any]]:
        self._require()
        query = f"?since={urllib.parse.quote(iso(since))}" if since else ""
        rows = self._call("GET", f"/history{query}")
        return rows if isinstance(rows, list) else []

    def symbols(self) -> list[dict[str, Any]]:
        """Liste des instruments du terminal (diagnostic des correspondances)."""
        self._require()
        payload = self._call("GET", "/symbols")
        rows = payload.get("symbols") if isinstance(payload, dict) else payload
        return rows if isinstance(rows, list) else []

    def resolve_symbols(self, canonical: list[str]) -> dict[str, Any]:
        """Compare nos noms canoniques aux instruments réellement proposés."""
        try:
            rows = self.symbols()
        except ConnectorError as exc:
            return {"ok": False, "error": str(exc), "checked": list(canonical),
                    "matched": [], "missing": list(canonical), "available_count": 0}
        available = {str(row.get("name", "")).upper(): row for row in rows
                     if isinstance(row, dict)}
        matched: list[dict[str, str]] = []
        missing: list[str] = []
        for name in canonical:
            platform = self._symbol(name)
            if platform.upper() in available:
                matched.append({"canonical": name, "platform": platform})
            else:
                missing.append(name)
        return {
            "ok": True, "checked": list(canonical), "matched": matched,
            "missing": missing, "available_count": len(available),
            "suffix": self.symbol_suffix or None,
            "map": dict(self.symbol_map),
        }

    def quotes(self, symbols) -> list[dict[str, Any]]:
        """Cotations temps réel du terminal (facultatif, voir README §Dialogue MT5)."""
        if not self._connected:
            return []
        payload = self._call("POST", "/quotes", {"symbols": [self._symbol(s) for s in symbols]})
        rows = payload.get("quotes") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            return []
        normalised = []
        for row in rows:
            if isinstance(row, dict) and row.get("symbol"):
                row = {**row, "symbol": self._strip_symbol(str(row["symbol"]))}
            normalised.append(row)
        return normalised

    # -- ordres ----------------------------------------------------------
    def place_order(self, request: OrderRequest) -> OrderAck:
        if request.environment.startswith("REAL"):
            raise RealTradingForbidden(
                "ordre MT5 réel interdit : la V1 n'exécute que sur compte démo")
        self._require()
        if not self.allow_orders:
            raise ConnectorUnavailable(
                "le passage d'ordre MT5 démo n'est pas activé par l'exploitant "
                "(section 9, activation explicite requise)", "MT5_ORDER_NOT_ENABLED")
        if request.stop_price is None or request.target_price is None:
            raise OrderRejected("ordre MT5 sans stop ni objectif : bracket obligatoire",
                                "MISSING_BRACKET")
        payload = {
            "symbol": self._symbol(request.symbol), "side": request.side,
            "qty": str(request.qty), "order_type": request.order_type,
            "client_order_id": request.client_order_id,
            "stop_price": str(request.stop_price), "target_price": str(request.target_price),
            "limit_price": str(request.limit_price) if request.limit_price else None,
            "reference_price": str(request.reference_price) if request.reference_price else None,
            "strategy": request.strategy, "signal_id": request.signal_id,
        }
        data = self._call("POST", "/orders", payload)
        platform_id = str(data.get("platform_order_id") or "")
        if not platform_id:
            raise OrderTimeout("pont MT5 : réponse sans identifiant d'ordre (statut inconnu)")
        self._order_map[request.client_order_id] = platform_id
        return OrderAck(platform_id, str(data.get("state") or "ACCEPTED"),
                        message=str(data.get("message") or "ordre transmis au terminal"))

    def cancel_order(self, platform_order_id: str) -> bool:
        self._require()
        data = self._call("POST", f"/orders/{urllib.parse.quote(platform_order_id)}/cancel", {})
        return bool(data.get("ok", True))

    def order_status(self, platform_order_id: str) -> OrderStatusReport:
        self._require()
        data = self._call("GET", f"/orders/{urllib.parse.quote(platform_order_id)}")
        return OrderStatusReport(
            platform_order_id=str(data.get("platform_order_id") or platform_order_id),
            state=str(data.get("state") or "UNKNOWN"),
            filled_qty=D(data.get("filled_qty", "0")),
            avg_price=D(data["avg_price"]) if data.get("avg_price") else None,
            message=str(data.get("message") or ""),
        )

    def modify_order(self, platform_order_id: str, stop_price: Decimal | None = None,
                     target_price: Decimal | None = None) -> bool:
        self._require()
        payload = {}
        if stop_price is not None:
            payload["stop_price"] = str(stop_price)
        if target_price is not None:
            payload["target_price"] = str(target_price)
        data = self._call("POST", f"/orders/{urllib.parse.quote(platform_order_id)}/modify", payload)
        return bool(data.get("ok", True))

    def close_position(self, platform_position_id: str, reason: str = "MANUAL") -> OrderAck:
        self._require()
        if not self.allow_orders:
            raise ConnectorUnavailable("clôture MT5 non activée (ordres démo désactivés)",
                                       "MT5_ORDER_NOT_ENABLED")
        data = self._call("POST", f"/positions/{urllib.parse.quote(platform_position_id)}/close",
                          {"reason": reason})
        return OrderAck(str(data.get("platform_order_id") or ""),
                        str(data.get("state") or "FILLED"),
                        message=str(data.get("message") or "position clôturée"))

    def to_dict(self) -> dict[str, Any]:
        data = super().to_dict()
        data.update({"bridge_configured": bool(self.bridge_url),
                     "account_kind": self.account_kind,
                     "orders_enabled": self.allow_orders,
                     "login": str(self.login) if self.login else ""})
        return data
