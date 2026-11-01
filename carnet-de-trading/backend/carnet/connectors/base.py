"""Interfaces abstraites des connecteurs (section 7).

Le moteur de stratégie ne parle jamais directement à une plateforme : il passe
par le gestionnaire d'ordres, qui parle au connecteur via ces interfaces. Les
implémentations réelles restent bloquées tant que le courtier et l'exchange ne
sont pas sélectionnés (section 26) et que les validations de la section 24 ne
sont pas closes.
"""

from __future__ import annotations

import abc
import datetime as dt
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from ..util import D, ZERO, iso, new_uuid, now_utc


class ConnectorError(Exception):
    code = "CONNECTOR_ERROR"

    def __init__(self, message: str, code: str | None = None, retryable: bool = False):
        super().__init__(message)
        if code:
            self.code = code
        self.retryable = retryable


class ConnectorUnavailable(ConnectorError):
    code = "CONNECTOR_UNAVAILABLE"


class RealTradingForbidden(ConnectorError):
    code = "REAL_TRADING_FORBIDDEN"


class OrderRejected(ConnectorError):
    code = "ORDER_REJECTED"


class OrderTimeout(ConnectorError):
    code = "ORDER_TIMEOUT"

    def __init__(self, message: str = "délai dépassé sans confirmation"):
        super().__init__(message, retryable=False)


class UnknownOrderState(ConnectorError):
    code = "ORDER_STATE_UNKNOWN"


SIDE_BUY = "BUY"
SIDE_SELL = "SELL"
ORDER_MARKET = "MARKET"
ORDER_LIMIT = "LIMIT"
ORDER_STOP = "STOP"


@dataclass
class OrderRequest:
    symbol: str
    side: str
    qty: Decimal
    order_type: str = ORDER_MARKET
    client_order_id: str = field(default_factory=new_uuid)
    limit_price: Decimal | None = None
    stop_price: Decimal | None = None
    target_price: Decimal | None = None
    strategy: str | None = None
    signal_id: str | None = None
    environment: str = "SIMULATION"
    reference_price: Decimal | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: dt.datetime = field(default_factory=now_utc)

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol, "side": self.side, "qty": str(self.qty),
            "order_type": self.order_type, "client_order_id": self.client_order_id,
            "limit_price": str(self.limit_price) if self.limit_price is not None else None,
            "stop_price": str(self.stop_price) if self.stop_price is not None else None,
            "target_price": str(self.target_price) if self.target_price is not None else None,
            "strategy": self.strategy, "signal_id": self.signal_id,
            "environment": self.environment, "created_at": iso(self.created_at),
        }


@dataclass
class OrderAck:
    platform_order_id: str
    state: str
    accepted_at: dt.datetime = field(default_factory=now_utc)
    message: str = ""
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class FillReport:
    qty: Decimal
    price: Decimal
    fee: Decimal = ZERO
    slippage_bps: Decimal = ZERO
    external_id: str | None = None
    at: dt.datetime = field(default_factory=now_utc)


@dataclass
class OrderStatusReport:
    platform_order_id: str
    state: str
    filled_qty: Decimal = ZERO
    avg_price: Decimal | None = None
    fills: list[FillReport] = field(default_factory=list)
    message: str = ""
    updated_at: dt.datetime = field(default_factory=now_utc)


@dataclass
class AccountSnapshot:
    account_id: str
    currency: str
    balance: Decimal
    equity: Decimal
    free_margin: Decimal
    margin_used: Decimal
    leverage: int
    environment: str
    broker: str
    at: dt.datetime = field(default_factory=now_utc)
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def margin_level(self) -> Decimal | None:
        if self.margin_used <= ZERO:
            return None
        return (self.equity / self.margin_used) * Decimal(100)

    def to_dict(self) -> dict[str, Any]:
        return {
            "account_id": self.account_id, "currency": self.currency,
            "balance": float(self.balance), "equity": float(self.equity),
            "free_margin": float(self.free_margin), "margin_used": float(self.margin_used),
            "margin_level": float(self.margin_level) if self.margin_level is not None else None,
            "leverage": self.leverage, "environment": self.environment,
            "broker": self.broker, "at": iso(self.at),
        }


@dataclass
class PositionReport:
    platform_position_id: str
    symbol: str
    side: str
    qty: Decimal
    entry_price: Decimal
    stop_price: Decimal | None
    target_price: Decimal | None
    unrealized_pnl: Decimal = ZERO
    opened_at: dt.datetime = field(default_factory=now_utc)
    strategy: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "platform_position_id": self.platform_position_id, "symbol": self.symbol,
            "side": self.side, "qty": float(self.qty), "entry_price": float(self.entry_price),
            "stop_price": float(self.stop_price) if self.stop_price is not None else None,
            "target_price": float(self.target_price) if self.target_price is not None else None,
            "unrealized_pnl": float(self.unrealized_pnl), "opened_at": iso(self.opened_at),
            "strategy": self.strategy,
        }


@dataclass
class OpenOrderReport:
    platform_order_id: str
    symbol: str
    side: str
    qty: Decimal
    filled_qty: Decimal
    order_type: str
    price: Decimal | None
    state: str
    client_order_id: str | None = None
    created_at: dt.datetime = field(default_factory=now_utc)


class BrokerConnector(abc.ABC):
    """Contrat commun Forex / crypto."""

    name: str = "abstract"
    kind: str = "abstract"
    supports_bracket: bool = True
    supports_partial_fills: bool = True
    real_capable: bool = False

    def __init__(self, environment: str = "SIMULATION"):
        self.environment = environment
        self._connected = False

    # -- cycle de vie ----------------------------------------------------
    @abc.abstractmethod
    def connect(self) -> None: ...

    @abc.abstractmethod
    def disconnect(self) -> None: ...

    def is_connected(self) -> bool:
        return self._connected

    @abc.abstractmethod
    def health(self) -> dict[str, Any]: ...

    # -- compte et positions --------------------------------------------
    @abc.abstractmethod
    def account(self) -> AccountSnapshot: ...

    @abc.abstractmethod
    def positions(self) -> list[PositionReport]: ...

    @abc.abstractmethod
    def open_orders(self) -> list[OpenOrderReport]: ...

    @abc.abstractmethod
    def history(self, since: dt.datetime | None = None) -> list[dict[str, Any]]: ...

    # -- ordres ----------------------------------------------------------
    @abc.abstractmethod
    def place_order(self, request: OrderRequest) -> OrderAck: ...

    @abc.abstractmethod
    def cancel_order(self, platform_order_id: str) -> bool: ...

    @abc.abstractmethod
    def order_status(self, platform_order_id: str) -> OrderStatusReport: ...

    def modify_order(self, platform_order_id: str, stop_price: Decimal | None = None,
                     target_price: Decimal | None = None) -> bool:
        raise ConnectorUnavailable(f"{self.name} ne permet pas la modification d'ordre")

    def close_position(self, platform_position_id: str) -> OrderAck:
        raise ConnectorUnavailable(f"{self.name} ne permet pas la clôture directe")

    # -- protection ------------------------------------------------------
    def verify_key_permissions(self) -> dict[str, Any]:
        """Vérifie l'absence de permission de retrait (section 10 et 17.2)."""
        return {"checked": False, "withdraw_enabled": None}

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name, "kind": self.kind, "environment": self.environment,
            "connected": self.is_connected(), "real_capable": self.real_capable,
            "supports_bracket": self.supports_bracket,
            "supports_partial_fills": self.supports_partial_fills,
        }
