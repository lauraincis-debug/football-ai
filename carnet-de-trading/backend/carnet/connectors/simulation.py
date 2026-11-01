"""Connecteur de simulation : exécution complète, sans aucun compte réel.

Il reproduit ce que le cahier des charges exige d'un broker : acceptation,
rejet, exécution partielle, protections hébergées (stop/objectif), frais,
slippage, déduplication par identifiant client et états incertains.
"""

from __future__ import annotations

import datetime as dt
import json
import threading
import uuid
from pathlib import Path
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from ..config import FX_TO_ACCOUNT, MARKET_CRYPTO, SYMBOLS, SymbolSpec
from ..market import Quote
from ..util import D, ZERO, iso, new_uuid, now_utc, to_utc
from .base import (
    SIDE_BUY,
    ORDER_LIMIT,
    ORDER_MARKET,
    AccountSnapshot,
    BrokerConnector,
    ConnectorError,
    ConnectorUnavailable,
    FillReport,
    OpenOrderReport,
    OrderAck,
    OrderRejected,
    OrderRequest,
    OrderStatusReport,
    OrderTimeout,
    PositionReport,
    RealTradingForbidden,
)


def fx_rate(currency: str) -> Decimal:
    return FX_TO_ACCOUNT.get(currency.upper(), D("1"))


def unit_value(symbol: str, account_currency: str = "USD") -> Decimal:
    """Valeur en devise du compte d'une variation de 1,0 de prix pour 1 unité."""
    spec: SymbolSpec = SYMBOLS[symbol]
    quote_rate = fx_rate(spec.quote) / fx_rate(account_currency)
    return spec.contract_size * quote_rate


def notional_value(symbol: str, qty: Decimal, price: Decimal, account_currency: str = "USD") -> Decimal:
    spec: SymbolSpec = SYMBOLS[symbol]
    if spec.market == MARKET_CRYPTO:
        return qty * price * fx_rate(spec.quote) / fx_rate(account_currency)
    # Forex : notionnel en devise de base, converti vers la devise du compte.
    if spec.quote == account_currency:
        return qty * spec.contract_size * price
    if spec.base == account_currency:
        return qty * spec.contract_size
    return qty * spec.contract_size * price * fx_rate(spec.quote) / fx_rate(account_currency)


@dataclass
class SimOrder:
    platform_order_id: str
    request: OrderRequest
    state: str = "ACCEPTED"
    filled_qty: Decimal = ZERO
    avg_price: Decimal | None = None
    fills: list[FillReport] = field(default_factory=list)
    fees: Decimal = ZERO
    created_at: dt.datetime = field(default_factory=now_utc)
    updated_at: dt.datetime = field(default_factory=now_utc)
    reject_reason: str | None = None
    pending_remaining: Decimal = ZERO
    stop_price: Decimal | None = None
    target_price: Decimal | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "platform_order_id": self.platform_order_id, "state": self.state,
            "symbol": self.request.symbol, "side": self.request.side,
            "qty": float(self.request.qty), "filled_qty": float(self.filled_qty),
            "avg_price": float(self.avg_price) if self.avg_price else None,
            "fees": float(self.fees), "created_at": iso(self.created_at),
            "reject_reason": self.reject_reason,
        }


@dataclass
class SimPosition:
    platform_position_id: str
    symbol: str
    side: str
    qty: Decimal
    entry_price: Decimal
    stop_price: Decimal | None
    target_price: Decimal | None
    order_id: str
    strategy: str | None = None
    opened_at: dt.datetime = field(default_factory=now_utc)
    unrealized_pnl: Decimal = ZERO
    entry_fee: Decimal = ZERO
    close_reason: str | None = None

    @property
    def protected(self) -> bool:
        return self.stop_price is not None and self.target_price is not None

    def to_dict(self, mark: Decimal | None = None) -> dict[str, Any]:
        return {
            "platform_position_id": self.platform_position_id, "symbol": self.symbol,
            "side": self.side, "qty": float(self.qty), "entry_price": float(self.entry_price),
            "stop_price": float(self.stop_price) if self.stop_price is not None else None,
            "target_price": float(self.target_price) if self.target_price is not None else None,
            "mark": float(mark) if mark is not None else None,
            "unrealized_pnl": float(self.unrealized_pnl),
            "opened_at": iso(self.opened_at), "strategy": self.strategy,
            "order_id": self.order_id, "protected": self.protected,
        }


class SimulationConnector(BrokerConnector):
    """Broker simulé avec carnet d'ordres complet (aucun ordre réel possible)."""

    name = "Simulation Broker"
    kind = "simulation"
    supports_bracket = True
    supports_partial_fills = True
    real_capable = False

    def __init__(self, initial_balance: Decimal | str = "10000", currency: str = "USD",
                 seed: int = 20261101, state_path=None):
        super().__init__(environment="SIMULATION")
        self.initial_balance = D(initial_balance)
        self.balance = D(initial_balance)
        self.currency = currency
        self._seed = seed
        self._orders: dict[str, SimOrder] = {}
        self._by_client_id: dict[str, str] = {}
        self._positions: dict[str, SimPosition] = {}
        self._closed: list[dict[str, Any]] = []
        self._events: list[dict[str, Any]] = []
        self._marks: dict[str, Quote] = {}
        self._lock = threading.RLock()
        self._fills_count = 0
        self.halted = False
        self.realised_fees = ZERO
        self._partial_ratio: Decimal | None = None
        self.state_path = state_path

    # -- cycle de vie ----------------------------------------------------
    def connect(self) -> None:
        self._connected = True
        self.load_state()

    def disconnect(self) -> None:
        self._connected = False

    def health(self) -> dict[str, Any]:
        return {
            "connector": self.name, "connected": self._connected,
            "environment": "SIMULATION", "open_orders": len(self.open_orders()),
            "positions": len(self._positions), "fills": self._fills_count,
        }

    # -- compte ----------------------------------------------------------
    def _quote_or_raise(self, symbol: str) -> Quote:
        quote = self._marks.get(symbol)
        if quote is None:
            raise ConnectorUnavailable(f"aucune cotation disponible pour {symbol}")
        return quote

    def _mark_price(self, symbol: str) -> Decimal:
        quote = self._marks.get(symbol)
        if quote is None:
            spec = SYMBOLS[symbol]
            from ..config import SIMULATION_REFERENCE_PRICES

            return SIMULATION_REFERENCE_PRICES.get(symbol, spec.tick_size)
        return quote.mid

    def _position_pnl(self, position: SimPosition, price: Decimal) -> Decimal:
        direction = Decimal(1) if position.side == SIDE_BUY else Decimal(-1)
        delta = (price - position.entry_price) * direction
        return delta * position.qty * unit_value(position.symbol, self.currency)

    def account(self) -> AccountSnapshot:
        with self._lock:
            unrealized = sum(
                (self._position_pnl(p, self._mark_price(p.symbol)) for p in self._positions.values()),
                ZERO,
            )
            equity = self.balance + unrealized
            used = sum(
                (notional_value(p.symbol, p.qty, p.entry_price, self.currency) /
                 Decimal(SYMBOLS[p.symbol].leverage) for p in self._positions.values()),
                ZERO,
            )
            return AccountSnapshot(
                account_id="SIM-0001", currency=self.currency, balance=self.balance,
                equity=equity, free_margin=max(equity - used, ZERO), margin_used=used,
                leverage=max(SYMBOLS[s].leverage for s in SYMBOLS), environment="SIMULATION",
                broker=self.name, extra={"open_positions": len(self._positions)},
            )

    def positions(self) -> list[PositionReport]:
        with self._lock:
            return [
                PositionReport(
                    platform_position_id=p.platform_position_id, symbol=p.symbol, side=p.side,
                    qty=p.qty, entry_price=p.entry_price, stop_price=p.stop_price,
                    target_price=p.target_price,
                    unrealized_pnl=self._position_pnl(p, self._mark_price(p.symbol)),
                    opened_at=p.opened_at, strategy=p.strategy,
                )
                for p in self._positions.values()
            ]

    def open_orders(self) -> list[OpenOrderReport]:
        with self._lock:
            return [
                OpenOrderReport(
                    platform_order_id=o.platform_order_id, symbol=o.request.symbol,
                    side=o.request.side, qty=o.request.qty, filled_qty=o.filled_qty,
                    order_type=o.request.order_type,
                    price=o.request.limit_price, state=o.state,
                    client_order_id=o.request.client_order_id, created_at=o.created_at,
                )
                for o in self._orders.values()
                if o.state in ("ACCEPTED", "PARTIALLY_FILLED", "SUBMITTED")
            ]

    def history(self, since: dt.datetime | None = None) -> list[dict[str, Any]]:
        with self._lock:
            items = [c for c in self._closed if not since or to_utc(c["closed_at"]) >= to_utc(since)]
            return sorted(items, key=lambda c: c["closed_at"], reverse=True)

    # -- ordres ----------------------------------------------------------
    def place_order(self, request: OrderRequest) -> OrderAck:
        if request.environment != "SIMULATION":
            raise RealTradingForbidden(
                "le connecteur de simulation refuse tout ordre hors environnement SIMULATION")
        with self._lock:
            if not self._connected:
                raise ConnectorUnavailable("connecteur non connecté")
            if self.halted:
                raise ConnectorUnavailable("négociation interrompue (halt)")
            existing_id = self._by_client_id.get(request.client_order_id)
            if existing_id:
                # Déduplication : on renvoie l'état connu, sans nouvelle exécution.
                order = self._orders[existing_id]
                return OrderAck(order.platform_order_id, order.state,
                                message="ordre déjà connu (déduplication)")
            spec = SYMBOLS.get(request.symbol)
            if spec is None:
                raise OrderRejected(f"instrument inconnu: {request.symbol}", "UNKNOWN_SYMBOL")
            qty = D(request.qty)
            if qty < spec.min_qty:
                raise OrderRejected(
                    f"quantité sous le minimum {spec.min_qty}", "QTY_BELOW_MINIMUM")
            if qty > spec.max_qty:
                raise OrderRejected(f"quantité au-dessus du maximum {spec.max_qty}", "QTY_ABOVE_MAX")
            if request.side not in (SIDE_BUY, "SELL"):
                raise OrderRejected("sens d'ordre invalide", "INVALID_SIDE")
            if request.stop_price is not None and D(request.stop_price) <= ZERO:
                raise OrderRejected("stop invalide", "INVALID_STOP")
            quote = self._quote_or_raise(request.symbol)
            reference = D(request.reference_price) if request.reference_price else quote.mid
            if request.order_type == ORDER_MARKET:
                fill_price = quote.ask if request.side == SIDE_BUY else quote.bid
                if request.side == SIDE_BUY and request.stop_price is not None:
                    if D(request.stop_price) >= fill_price:
                        raise OrderRejected("stop au-dessus du prix d'entrée (achat)", "INVALID_STOP")
                if request.side == "SELL" and request.stop_price is not None:
                    if D(request.stop_price) <= fill_price:
                        raise OrderRejected("stop sous le prix d'entrée (vente)", "INVALID_STOP")
                platform_id = f"SIM-{uuid.uuid4().hex[:16].upper()}"
                order = SimOrder(platform_order_id=platform_id, request=request, state="ACCEPTED",
                                 stop_price=D(request.stop_price) if request.stop_price else None,
                                 target_price=D(request.target_price) if request.target_price else None)
                self._orders[platform_id] = order
                self._by_client_id[request.client_order_id] = platform_id
                ratio = self._partial_ratio
                self._partial_ratio = None
                self._execute(order, fill_price, reference, quote,
                              partial=ratio is not None, ratio=ratio)
                return OrderAck(platform_id, order.state,
                                message="exécution partielle (simulation)" if ratio else
                                "exécuté (simulation)")
            if request.order_type == ORDER_LIMIT:
                if request.limit_price is None:
                    raise OrderRejected("prix limite absent", "MISSING_LIMIT_PRICE")
                platform_id = f"SIM-{uuid.uuid4().hex[:16].upper()}"
                order = SimOrder(platform_order_id=platform_id, request=request, state="ACCEPTED",
                                 stop_price=D(request.stop_price) if request.stop_price else None,
                                 target_price=D(request.target_price) if request.target_price else None)
                self._orders[platform_id] = order
                self._by_client_id[request.client_order_id] = platform_id
                return OrderAck(platform_id, "ACCEPTED", message="ordre limite en attente")
            raise OrderRejected(f"type d'ordre non pris en charge: {request.order_type}",
                                "UNSUPPORTED_ORDER_TYPE")

    def _execute(self, order: SimOrder, price: Decimal, reference: Decimal, quote: Quote,
                 partial: bool, ratio: Decimal | None = None) -> None:
        remaining = order.request.qty - order.filled_qty
        qty = remaining if not partial or ratio is None else (remaining * ratio)
        spec = SYMBOLS[order.request.symbol]
        qty = (qty / spec.qty_step).to_integral_value(rounding="ROUND_DOWN") * spec.qty_step
        if qty <= ZERO:
            return
        # Slippage de marché proportionnel à la taille relative au spread.
        impact = (quote.spread / Decimal(2)) * min(Decimal(1), qty / max(spec.min_qty * 10, spec.qty_step))
        if order.request.side == SIDE_BUY:
            exec_price = price + impact
        else:
            exec_price = price - impact
        exec_price = (exec_price / spec.tick_size).to_integral_value(rounding="ROUND_HALF_UP") * spec.tick_size
        notional = notional_value(order.request.symbol, qty, exec_price, self.currency)
        fee = notional * spec.taker_fee_bps / Decimal(10000)
        slippage_bps = ((exec_price - reference) / reference * Decimal(10000)) if reference else ZERO
        fill = FillReport(qty=qty, price=exec_price, fee=fee, slippage_bps=slippage_bps,
                          external_id=f"F-{uuid.uuid4().hex[:12]}", at=now_utc())
        order.fills.append(fill)
        order.fees += fee
        total_cost = (order.avg_price or ZERO) * order.filled_qty + exec_price * qty
        order.filled_qty += qty
        order.avg_price = total_cost / order.filled_qty if order.filled_qty else exec_price
        order.state = "FILLED" if order.filled_qty >= order.request.qty else "PARTIALLY_FILLED"
        order.updated_at = now_utc()
        self._fills_count += 1
        self.realised_fees += fee
        self.balance -= fee
        self._events.append({
            "type": "FILL", "order_id": order.platform_order_id,
            "client_order_id": order.request.client_order_id,
            "symbol": order.request.symbol, "side": order.request.side,
            "qty": str(qty), "price": str(exec_price), "fee": str(fee),
            "slippage_bps": str(slippage_bps.quantize(Decimal("0.01"))),
            "state": order.state, "at": iso(fill.at), "external_id": fill.external_id,
            "filled_qty": str(order.filled_qty), "requested_qty": str(order.request.qty),
        })
        position = self._position_for_order(order)
        if position is None:
            position = SimPosition(
                platform_position_id=f"POS-{uuid.uuid4().hex[:12].upper()}",
                symbol=order.request.symbol, side=order.request.side, qty=qty,
                entry_price=exec_price, stop_price=order.stop_price,
                target_price=order.target_price, order_id=order.platform_order_id,
                strategy=order.request.strategy, entry_fee=fee,
            )
            self._positions[position.platform_position_id] = position
            self._events.append({
                "type": "POSITION_OPENED", "position_id": position.platform_position_id,
                "symbol": position.symbol, "side": position.side, "qty": str(position.qty),
                "entry_price": str(position.entry_price),
                "stop_price": str(position.stop_price) if position.stop_price else None,
                "target_price": str(position.target_price) if position.target_price else None,
                "protected": position.protected, "order_id": order.platform_order_id,
                "at": iso(fill.at), "strategy": position.strategy,
            })
        else:
            total = position.qty + qty
            if total > ZERO:
                position.entry_price = (
                    position.entry_price * position.qty + exec_price * qty) / total
            position.qty = total
            position.entry_fee += fee
        if order.state == "PARTIALLY_FILLED":
            order.pending_remaining = order.request.qty - order.filled_qty

    def _position_for_order(self, order: SimOrder) -> SimPosition | None:
        for position in self._positions.values():
            if position.order_id == order.platform_order_id:
                return position
        return None

    def cancel_order(self, platform_order_id: str) -> bool:
        with self._lock:
            order = self._orders.get(platform_order_id)
            if order is None:
                raise OrderRejected("ordre inconnu", "UNKNOWN_ORDER")
            if order.state in ("FILLED", "CANCELLED", "REJECTED", "EXPIRED"):
                return False
            order.state = "CANCELLED"
            order.updated_at = now_utc()
            self._events.append({"type": "CANCELLED", "order_id": platform_order_id,
                                 "at": iso(order.updated_at)})
            return True

    def order_status(self, platform_order_id: str) -> OrderStatusReport:
        with self._lock:
            order = self._orders.get(platform_order_id)
            if order is None:
                raise OrderRejected("ordre inconnu", "UNKNOWN_ORDER")
            return OrderStatusReport(
                platform_order_id=platform_order_id, state=order.state,
                filled_qty=order.filled_qty, avg_price=order.avg_price,
                fills=list(order.fills), updated_at=order.updated_at,
            )

    def modify_order(self, platform_order_id: str, stop_price: Decimal | None = None,
                     target_price: Decimal | None = None) -> bool:
        with self._lock:
            order = self._orders.get(platform_order_id)
            if order is None:
                raise OrderRejected("ordre inconnu", "UNKNOWN_ORDER")
            if stop_price is not None:
                order.stop_price = D(stop_price)
            if target_price is not None:
                order.target_price = D(target_price)
            for position in self._positions.values():
                if position.order_id == platform_order_id:
                    if stop_price is not None:
                        position.stop_price = D(stop_price)
                    if target_price is not None:
                        position.target_price = D(target_price)
            order.updated_at = now_utc()
            return True

    def close_position(self, platform_position_id: str, reason: str = "MANUAL") -> OrderAck:
        with self._lock:
            position = self._positions.get(platform_position_id)
            if position is None:
                raise OrderRejected("position inconnue", "UNKNOWN_POSITION")
            quote = self._quote_or_raise(position.symbol)
            price = quote.bid if position.side == SIDE_BUY else quote.ask
            self._close(position, price, reason)
            return OrderAck(platform_position_id, "FILLED", message=f"position clôturée ({reason})")

    def _close(self, position: SimPosition, price: Decimal, reason: str,
               at: dt.datetime | None = None) -> None:
        spec = SYMBOLS[position.symbol]
        pnl = self._position_pnl(position, price)
        notional = notional_value(position.symbol, position.qty, price, self.currency)
        fee = notional * spec.taker_fee_bps / Decimal(10000)
        self.balance += pnl - fee
        self.realised_fees += fee
        closed_at = at or now_utc()
        record = {
            "position_id": position.platform_position_id, "symbol": position.symbol,
            "side": position.side, "qty": str(position.qty), "entry_price": str(position.entry_price),
            "close_price": str(price), "realized_pnl": str(pnl - position.entry_fee - fee),
            "fees": str(position.entry_fee + fee), "reason": reason,
            "opened_at": iso(position.opened_at), "closed_at": iso(closed_at),
            "strategy": position.strategy, "order_id": position.order_id,
        }
        self._closed.append(record)
        del self._positions[position.platform_position_id]
        self._events.append({"type": "POSITION_CLOSED", "at": iso(closed_at), **record})

    def force_close_all(self, reason: str = "EMERGENCY") -> list[dict[str, Any]]:
        with self._lock:
            closed = []
            for position in list(self._positions.values()):
                quote = self._marks.get(position.symbol)
                if quote is None:
                    continue
                price = quote.bid if position.side == SIDE_BUY else quote.ask
                self._close(position, price, reason)
                closed.append({"position_id": position.platform_position_id,
                               "symbol": position.symbol, "price": str(price)})
            for order in self._orders.values():
                if order.state in ("ACCEPTED", "PARTIALLY_FILLED", "SUBMITTED"):
                    order.state = "CANCELLED"
        self.save_state()
        return closed

    # -- moteur de marché ------------------------------------------------
    def pump(self, quotes: dict[str, Quote]) -> list[dict[str, Any]]:
        """Met à jour les marks, exécute limites, stops et objectifs hébergés."""
        with self._lock:
            self._marks.update(quotes)
            for order in list(self._orders.values()):
                if order.state in ("ACCEPTED", "PARTIALLY_FILLED") and order.request.order_type == ORDER_LIMIT:
                    quote = quotes.get(order.request.symbol)
                    if quote is None or order.request.limit_price is None:
                        continue
                    limit = D(order.request.limit_price)
                    touched = (quote.ask <= limit) if order.request.side == SIDE_BUY else (quote.bid >= limit)
                    if touched:
                        price = quote.ask if order.request.side == SIDE_BUY else quote.bid
                        self._execute(order, price, limit, quote, partial=False)
                elif order.state == "PARTIALLY_FILLED" and order.pending_remaining > ZERO:
                    quote = quotes.get(order.request.symbol)
                    if quote is None:
                        continue
                    # Le solde de l'exécution partielle se complète aux ticks suivants.
                    self._execute(order, quote.ask if order.request.side == SIDE_BUY else quote.bid,
                                  quote.mid, quote, partial=False)
            for position in list(self._positions.values()):
                quote = quotes.get(position.symbol)
                if quote is None:
                    continue
                mark = quote.mid
                position.unrealized_pnl = self._position_pnl(position, mark)
                if position.stop_price is not None:
                    hit = (quote.bid <= position.stop_price) if position.side == SIDE_BUY \
                        else (quote.ask >= position.stop_price)
                    if hit:
                        # Un stop peut être dépassé (gap) : on exécute au prix disponible.
                        fill = quote.bid if position.side == SIDE_BUY else quote.ask
                        if position.side == SIDE_BUY:
                            fill = min(fill, position.stop_price)
                        else:
                            fill = max(fill, position.stop_price)
                        self._close(position, fill, "STOP_LOSS")
                        continue
                if position.target_price is not None:
                    hit = (quote.bid >= position.target_price) if position.side == SIDE_BUY \
                        else (quote.ask <= position.target_price)
                    if hit:
                        self._close(position, position.target_price, "TAKE_PROFIT")
                        continue
                # Ordre d'entrée en attente devenu inutile si la position a disparu
            events = self.drain_events()
        self.save_state()
        return events

    def drain_events(self) -> list[dict[str, Any]]:
        with self._lock:
            events, self._events = self._events, []
            return events

    def request_partial_fill(self, ratio: Decimal) -> None:
        """Active une exécution partielle sur le prochain ordre (tests, scénario 21.1)."""
        self._partial_ratio = ratio

    # -- persistance de l'état simulé ------------------------------------
    def export_state(self) -> dict[str, Any]:
        """État complet, sérialisable, pour survivre à un redémarrage."""
        with self._lock:
            return {
                "version": 1,
                "balance": str(self.balance),
                "currency": self.currency,
                "realised_fees": str(self.realised_fees),
                "fills_count": self._fills_count,
                "marks": [
                    {"symbol": q.symbol, "bid": str(q.bid), "ask": str(q.ask),
                     "last": str(q.last), "timestamp": iso(q.at),
                     "received_at": iso(to_utc(q.received_at)) if q.received_at else None,
                     "source": q.source}
                    for q in self._marks.values()
                ],
                "positions": [
                    {
                        "platform_position_id": p.platform_position_id, "symbol": p.symbol,
                        "side": p.side, "qty": str(p.qty), "entry_price": str(p.entry_price),
                        "stop_price": str(p.stop_price) if p.stop_price is not None else None,
                        "target_price": str(p.target_price) if p.target_price is not None else None,
                        "order_id": p.order_id, "strategy": p.strategy,
                        "opened_at": iso(p.opened_at), "entry_fee": str(p.entry_fee),
                        "unrealized_pnl": str(p.unrealized_pnl),
                    }
                    for p in self._positions.values()
                ],
                "orders": [
                    {
                        "platform_order_id": o.platform_order_id,
                        "client_order_id": o.request.client_order_id,
                        "symbol": o.request.symbol, "side": o.request.side,
                        "qty": str(o.request.qty), "order_type": o.request.order_type,
                        "limit_price": str(o.request.limit_price) if o.request.limit_price else None,
                        "stop_price": str(o.request.stop_price) if o.request.stop_price else None,
                        "target_price": str(o.request.target_price) if o.request.target_price else None,
                        "strategy": o.request.strategy, "signal_id": o.request.signal_id,
                        "state": o.state, "filled_qty": str(o.filled_qty),
                        "avg_price": str(o.avg_price) if o.avg_price else None,
                        "fees": str(o.fees), "created_at": iso(o.created_at),
                        "stop": str(o.stop_price) if o.stop_price else None,
                        "target": str(o.target_price) if o.target_price else None,
                        "pending_remaining": str(o.pending_remaining),
                    }
                    for o in self._orders.values()
                ],
                "closed": self._closed[-500:],
            }

    def import_state(self, payload: dict[str, Any]) -> bool:
        if not payload or payload.get("version") != 1:
            return False
        with self._lock:
            self.balance = D(payload.get("balance", self.balance))
            self.realised_fees = D(payload.get("realised_fees", ZERO))
            self._fills_count = int(payload.get("fills_count", 0))
            from ..market import Quote

            self._marks = {}
            for item in payload.get("marks") or []:
                moment = to_utc(item.get("timestamp")) or now_utc()
                self._marks[item["symbol"]] = Quote(
                    symbol=item["symbol"], bid=D(item["bid"]), ask=D(item["ask"]),
                    last=D(item["last"]), timestamp=moment,
                    source=item.get("source", "simulation"),
                    received_at=to_utc(item.get("received_at")) or moment)
            self._positions = {}
            for item in payload.get("positions") or []:
                position = SimPosition(
                    platform_position_id=item["platform_position_id"], symbol=item["symbol"],
                    side=item["side"], qty=D(item["qty"]), entry_price=D(item["entry_price"]),
                    stop_price=D(item["stop_price"]) if item.get("stop_price") else None,
                    target_price=D(item["target_price"]) if item.get("target_price") else None,
                    order_id=item["order_id"], strategy=item.get("strategy"),
                    opened_at=to_utc(item.get("opened_at")) or now_utc(),
                    unrealized_pnl=D(item.get("unrealized_pnl", ZERO)),
                    entry_fee=D(item.get("entry_fee", ZERO)),
                )
                self._positions[position.platform_position_id] = position
            self._orders = {}
            self._by_client_id = {}
            for item in payload.get("orders") or []:
                request = OrderRequest(
                    symbol=item["symbol"], side=item["side"], qty=D(item["qty"]),
                    order_type=item.get("order_type", ORDER_MARKET),
                    client_order_id=item["client_order_id"],
                    limit_price=D(item["limit_price"]) if item.get("limit_price") else None,
                    stop_price=D(item["stop_price"]) if item.get("stop_price") else None,
                    target_price=D(item["target_price"]) if item.get("target_price") else None,
                    strategy=item.get("strategy"), signal_id=item.get("signal_id"),
                    environment="SIMULATION",
                    created_at=to_utc(item.get("created_at")) or now_utc(),
                )
                order = SimOrder(
                    platform_order_id=item["platform_order_id"], request=request,
                    state=item.get("state", "ACCEPTED"), filled_qty=D(item.get("filled_qty", ZERO)),
                    avg_price=D(item["avg_price"]) if item.get("avg_price") else None,
                    fees=D(item.get("fees", ZERO)),
                    created_at=to_utc(item.get("created_at")) or now_utc(),
                    stop_price=D(item["stop"]) if item.get("stop") else None,
                    target_price=D(item["target"]) if item.get("target") else None,
                    pending_remaining=D(item.get("pending_remaining", ZERO)),
                )
                self._orders[order.platform_order_id] = order
                self._by_client_id[request.client_order_id] = order.platform_order_id
            self._closed = list(payload.get("closed") or [])
            return True

    def load_state(self) -> bool:
        if not self.state_path:
            return False
        path = Path(self.state_path)
        if not path.exists():
            return False
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            return self.import_state(payload)
        except (OSError, json.JSONDecodeError, KeyError, TypeError):
            return False

    def save_state(self) -> None:
        if not self.state_path:
            return
        path = Path(self.state_path)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.export_state(), ensure_ascii=False), encoding="utf-8")
            tmp.replace(path)
        except (OSError, TypeError, ValueError):
            # La persistance ne doit jamais interrompre la négociation.
            pass

    # -- introspection ---------------------------------------------------
    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "orders": [o.to_dict() for o in self._orders.values()],
                "positions": [p.to_dict(self._mark_price(p.symbol)) for p in self._positions.values()],
                "closed": self._closed[-50:],
                "balance": float(self.balance),
                "fees": float(self.realised_fees),
            }
