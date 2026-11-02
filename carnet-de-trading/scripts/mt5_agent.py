#!/usr/bin/env python3
"""Agent MT5 (nœud Windows) — pont JSON entre le terminal MetaTrader 5 et le VPS.

À exécuter **sur la machine Windows** où le terminal MT5 est installé et connecté
à un compte **démo**. Le VPS Linux ne peut pas charger la bibliothèque officielle
``MetaTrader5`` (Windows uniquement) : il interroge cet agent via HTTPS/VPN avec
un jeton partagé.

    py -3 scripts\\mt5_agent.py --token "jeton-long-et-aleatoire" --port 8787

Sécurité :
- écoute sur 127.0.0.1 par défaut : exposer uniquement derrière un tunnel SSH,
  un VPN ou un reverse proxy TLS avec authentification ;
- toutes les routes exigent l'en-tête ``X-Bridge-Token`` (comparaison constante) ;
- aucun mot de passe de compte n'est manipulé ici : le terminal est déjà connecté ;
- refus explicite d'un compte réel (``--allow-real`` est volontairement absent).

Routes (JSON) :
    GET  /health                         état du terminal et type de compte
    GET  /account                        solde, équité, marge
    GET  /symbols                        instruments proposés par le terminal
    GET  /positions                      positions ouvertes
    GET  /orders                         ordres en attente
    GET  /orders/<ticket>                état d'un ordre
    POST /orders/<ticket>/cancel         annulation
    POST /orders/<ticket>/modify         stop/objectif
    POST /positions/<ticket>/close       clôture au marché
    GET  /history?since=ISO              historique des deals
    POST /quotes                         cotations bid/ask pour une liste d'instruments
    POST /orders                         envoi d'un ordre bracket (démo uniquement)
"""

from __future__ import annotations

import argparse
import datetime as dt
import hmac
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit

try:  # pragma: no cover - dépend de Windows et du terminal
    import MetaTrader5 as mt5  # type: ignore
except Exception:  # pragma: no cover
    mt5 = None

MAGIC = 20261101
DEVIATION = 20
ACCOUNT_TYPES = {0: "demo", 1: "contest", 2: "real"}


def iso(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return dt.datetime.fromtimestamp(float(value), tz=dt.timezone.utc).isoformat()
    return str(value)


def dec(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


class TerminalError(Exception):
    def __init__(self, message: str, code: str = "MT5_ERROR", status: int = 400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


class Terminal:
    """Façade minimale autour de MetaTrader5, testable avec un module factice."""

    def __init__(self, module=None, symbol_suffix: str = "", magic: int = MAGIC):
        self.module = module if module is not None else mt5
        self.symbol_suffix = symbol_suffix
        self.magic = magic

    # -- utilitaires -----------------------------------------------------
    def require(self):
        if self.module is None:
            raise TerminalError(
                "bibliothèque MetaTrader5 indisponible : exécutez cet agent sur Windows "
                "avec le terminal installé", "MT5_UNAVAILABLE", 503)
        return self.module

    def symbol(self, name: str) -> str:
        raw = str(name).strip()
        if self.symbol_suffix and not raw.upper().endswith(self.symbol_suffix.upper()):
            return f"{raw}{self.symbol_suffix}"
        return raw

    def strip(self, name: str) -> str:
        upper = (name or "").upper()
        if self.symbol_suffix and upper.endswith(self.symbol_suffix.upper()):
            return upper[: -len(self.symbol_suffix)]
        return upper

    def account_type(self) -> str:
        info = self.require().account_info()
        if info is None:
            return "unknown"
        data = info._asdict() if hasattr(info, "_asdict") else dict(info)
        return ACCOUNT_TYPES.get(int(data.get("trade_mode", -1)), "unknown")

    # -- lecture ---------------------------------------------------------
    def health(self) -> dict[str, Any]:
        module = self.require()
        info = module.account_info()
        terminal = module.terminal_info()
        if info is None or terminal is None:
            raise TerminalError("terminal non connecté au courtier", "MT5_NOT_CONNECTED", 503)
        acc = info._asdict() if hasattr(info, "_asdict") else dict(info)
        term = terminal._asdict() if hasattr(terminal, "_asdict") else dict(terminal)
        return {
            "ok": bool(term.get("connected", True)),
            "account_type": ACCOUNT_TYPES.get(int(acc.get("trade_mode", -1)), "unknown"),
            "login": acc.get("login"), "server": acc.get("server"),
            "currency": acc.get("currency"), "broker": acc.get("company") or acc.get("server"),
            "terminal": {"build": term.get("build"), "connected": term.get("connected"),
                         "trade_allowed": term.get("trade_allowed")},
            "detail": "" if term.get("connected") else "terminal déconnecté du courtier",
        }

    def account(self) -> dict[str, Any]:
        info = self.require().account_info()
        if info is None:
            raise TerminalError("informations de compte indisponibles", "MT5_NO_ACCOUNT", 503)
        data = info._asdict() if hasattr(info, "_asdict") else dict(info)
        return {
            "account_id": str(data.get("login")), "currency": data.get("currency") or "USD",
            "balance": dec(data.get("balance")), "equity": dec(data.get("equity")),
            "free_margin": dec(data.get("margin_free")), "margin_used": dec(data.get("margin")),
            "leverage": int(dec(data.get("leverage")) or 1),
            "broker": data.get("company") or data.get("server"),
            "account_type": ACCOUNT_TYPES.get(int(data.get("trade_mode", -1)), "unknown"),
        }

    def positions(self) -> list[dict[str, Any]]:
        rows = self.require().positions_get() or []
        out = []
        for item in rows:
            data = item._asdict() if hasattr(item, "_asdict") else dict(item)
            out.append({
                "platform_position_id": str(data.get("ticket")),
                "symbol": self.strip(str(data.get("symbol"))),
                "side": "BUY" if int(data.get("type", 0)) == 0 else "SELL",
                "qty": dec(data.get("volume")), "entry_price": dec(data.get("price_open")),
                "stop_price": dec(data.get("sl")) or None,
                "target_price": dec(data.get("tp")) or None,
                "unrealized_pnl": dec(data.get("profit")),
                "opened_at": iso(data.get("time")),
                "strategy": (data.get("comment") or None),
            })
        return out

    def orders(self) -> list[dict[str, Any]]:
        rows = self.require().orders_get() or []
        out = []
        for item in rows:
            data = item._asdict() if hasattr(item, "_asdict") else dict(item)
            out.append({
                "platform_order_id": str(data.get("ticket")),
                "symbol": self.strip(str(data.get("symbol"))),
                "side": "BUY" if int(data.get("type", 0)) in (0, 2) else "SELL",
                "qty": dec(data.get("volume_current") or data.get("volume_initial")),
                "filled_qty": 0.0, "order_type": "LIMIT",
                "price": dec(data.get("price_open")) or None,
                "state": "ACCEPTED",
                "client_order_id": None,
            })
        return out

    def history(self, since: str | None) -> list[dict[str, Any]]:
        start = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=30)
        if since:
            try:
                start = dt.datetime.fromisoformat(since.replace("Z", "+00:00"))
            except ValueError:
                pass
        rows = self.require().history_deals_get(start, dt.datetime.now(dt.timezone.utc)) or []
        return [d._asdict() if hasattr(d, "_asdict") else dict(d) for d in rows]

    def symbols(self) -> list[dict[str, Any]]:
        """Instruments proposés par le terminal (pour diagnostiquer les noms)."""
        rows = self.require().symbols_get() or []
        out = []
        for item in rows:
            data = item._asdict() if hasattr(item, "_asdict") else dict(item)
            out.append({
                "name": str(data.get("name") or ""),
                "path": str(data.get("path") or ""),
                "visible": bool(data.get("visible", False)),
                "trade_mode": int(data.get("trade_mode", 0) or 0),
            })
        return out

    def quotes(self, symbols: list[str]) -> list[dict[str, Any]]:
        module = self.require()
        out = []
        for name in symbols:
            tick = module.symbol_info_tick(self.symbol(name))
            if tick is None:
                continue
            data = tick._asdict() if hasattr(tick, "_asdict") else dict(tick)
            bid, ask = dec(data.get("bid")), dec(data.get("ask"))
            if bid <= 0 or ask <= 0:
                continue
            out.append({
                "symbol": self.strip(self.symbol(name)), "bid": bid, "ask": ask,
                "last": dec(data.get("last")) or bid, "volume": dec(data.get("volume")),
                "timestamp": iso(data.get("time")),
            })
        return out

    # -- écriture --------------------------------------------------------
    def _filling_mode(self, symbol: str) -> int:
        module = self.require()
        info = module.symbol_info(self.symbol(symbol))
        if info is None:
            raise TerminalError(f"instrument inconnu du terminal : {symbol}", "MT5_UNKNOWN_SYMBOL")
        data = info._asdict() if hasattr(info, "_asdict") else dict(info)
        mode = int(data.get("filling_mode", 1))
        # 1 = FOK, 2 = IOC, 4 = RETURN : on privilégie IOC puis FOK.
        return 2 if mode & 2 else 1

    def place_order(self, payload: dict[str, Any]) -> dict[str, Any]:
        module = self.require()
        if self.account_type() != "demo":
            raise TerminalError("seul un compte démo est autorisé par cet agent",
                                "MT5_REAL_FORBIDDEN", 403)
        symbol = self.symbol(str(payload.get("symbol") or ""))
        side = str(payload.get("side") or "BUY").upper()
        qty = dec(payload.get("qty"))
        if qty <= 0:
            raise TerminalError("quantité invalide", "MT5_INVALID_QTY")
        if not payload.get("stop_price") or not payload.get("target_price"):
            raise TerminalError("bracket obligatoire (stop et objectif)",
                                "MT5_MISSING_BRACKET")
        tick = module.symbol_info_tick(symbol)
        if tick is None:
            raise TerminalError(f"aucune cotation pour {symbol}", "MT5_NO_QUOTE", 503)
        data = tick._asdict() if hasattr(tick, "_asdict") else dict(tick)
        order_type = str(payload.get("order_type") or "MARKET").upper()
        price = dec(data.get("ask")) if side == "BUY" else dec(data.get("bid"))
        request = {
            "action": module.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": float(qty),
            "type": module.ORDER_TYPE_BUY if side == "BUY" else module.ORDER_TYPE_SELL,
            "price": float(price),
            "sl": float(dec(payload.get("stop_price"))),
            "tp": float(dec(payload.get("target_price"))),
            "deviation": DEVIATION,
            "magic": self.magic,
            "comment": str(payload.get("strategy") or "carnet")[:31],
            "type_time": module.ORDER_TIME_GTC,
            "type_filling": self._filling_mode(symbol),
        }
        if order_type == "LIMIT":
            limit = dec(payload.get("limit_price"))
            if limit <= 0:
                raise TerminalError("prix limite absent", "MT5_MISSING_LIMIT")
            request.update({
                "action": module.TRADE_ACTION_PENDING,
                "type": module.ORDER_TYPE_BUY_LIMIT if side == "BUY" else module.ORDER_TYPE_SELL_LIMIT,
                "price": float(limit),
            })
        result = module.order_send(request)
        if result is None:
            raise TerminalError(f"order_send a échoué : {module.last_error()}",
                                "MT5_ORDER_SEND_FAILED", 502)
        result_data = result._asdict() if hasattr(result, "_asdict") else dict(result)
        if int(result_data.get("retcode", 0)) != getattr(module, "TRADE_RETCODE_DONE", 10009):
            raise TerminalError(
                f"refus du terminal ({result_data.get('retcode')}) : {result_data.get('comment')}",
                "MT5_ORDER_REJECTED", 409)
        return {
            "platform_order_id": str(result_data.get("order") or result_data.get("deal") or ""),
            "state": "FILLED" if order_type == "MARKET" else "ACCEPTED",
            "message": str(result_data.get("comment") or "ordre accepté"),
        }

    def order_status(self, ticket: str) -> dict[str, Any]:
        module = self.require()
        try:
            number = int(ticket)
        except ValueError as exc:
            raise TerminalError("identifiant d'ordre invalide", "MT5_INVALID_ID") from exc
        pending = module.orders_get(ticket=number) or []
        if pending:
            data = pending[0]._asdict() if hasattr(pending[0], "_asdict") else dict(pending[0])
            return {"platform_order_id": str(number), "state": "ACCEPTED",
                    "filled_qty": 0.0, "avg_price": dec(data.get("price_open")) or None}
        deals = module.history_deals_get(position=number) or []
        if deals:
            filled = sum(dec((d._asdict() if hasattr(d, "_asdict") else dict(d)).get("volume"))
                         for d in deals)
            last = deals[-1]
            last_data = last._asdict() if hasattr(last, "_asdict") else dict(last)
            return {"platform_order_id": str(number), "state": "FILLED",
                    "filled_qty": filled, "avg_price": dec(last_data.get("price")) or None}
        raise TerminalError("ordre introuvable", "MT5_UNKNOWN_ORDER", 404)

    def cancel(self, ticket: str) -> dict[str, Any]:
        module = self.require()
        result = module.order_send({"action": module.TRADE_ACTION_REMOVE, "order": int(ticket)})
        data = result._asdict() if hasattr(result, "_asdict") else dict(result or {})
        if int(data.get("retcode", 0)) != getattr(module, "TRADE_RETCODE_DONE", 10009):
            raise TerminalError(f"annulation refusée ({data.get('retcode')})",
                                "MT5_CANCEL_REJECTED", 409)
        return {"ok": True}

    def modify(self, ticket: str, payload: dict[str, Any]) -> dict[str, Any]:
        module = self.require()
        request = {"action": module.TRADE_ACTION_SLTP, "position": int(ticket)}
        order_type = str(payload.get("order_type") or "POSITION")
        if order_type == "PENDING":
            request = {"action": module.TRADE_ACTION_MODIFY, "order": int(ticket),
                       "price": float(dec(payload.get("limit_price")) or 0.0),
                       "type_time": module.ORDER_TIME_GTC}
            request["type_filling"] = self._filling_mode(str(payload.get("symbol") or ""))
        if payload.get("stop_price") is not None:
            request["sl"] = float(dec(payload.get("stop_price")))
        if payload.get("target_price") is not None:
            request["tp"] = float(dec(payload.get("target_price")))
        result = module.order_send(request)
        data = result._asdict() if hasattr(result, "_asdict") else dict(result or {})
        if int(data.get("retcode", 0)) != getattr(module, "TRADE_RETCODE_DONE", 10009):
            raise TerminalError(f"modification refusée ({data.get('retcode')})",
                                "MT5_MODIFY_REJECTED", 409)
        return {"ok": True}

    def close_position(self, ticket: str) -> dict[str, Any]:
        module = self.require()
        rows = module.positions_get(ticket=int(ticket)) or []
        if not rows:
            raise TerminalError("position introuvable", "MT5_UNKNOWN_POSITION", 404)
        data = rows[0]._asdict() if hasattr(rows[0], "_asdict") else dict(rows[0])
        symbol = str(data.get("symbol"))
        side = "SELL" if int(data.get("type", 0)) == 0 else "BUY"
        tick = module.symbol_info_tick(symbol)
        tick_data = tick._asdict() if hasattr(tick, "_asdict") else dict(tick or {})
        price = dec(tick_data.get("bid")) if side == "SELL" else dec(tick_data.get("ask"))
        result = module.order_send({
            "action": module.TRADE_ACTION_DEAL, "symbol": symbol,
            "volume": dec(data.get("volume")),
            "type": module.ORDER_TYPE_SELL if side == "SELL" else module.ORDER_TYPE_BUY,
            "position": int(ticket), "price": float(price), "deviation": DEVIATION,
            "magic": self.magic, "comment": "carnet-close",
            "type_time": module.ORDER_TIME_GTC,
            "type_filling": self._filling_mode(symbol),
        })
        out = result._asdict() if hasattr(result, "_asdict") else dict(result or {})
        if int(out.get("retcode", 0)) != getattr(module, "TRADE_RETCODE_DONE", 10009):
            raise TerminalError(f"clôture refusée ({out.get('retcode')})",
                                "MT5_CLOSE_REJECTED", 409)
        return {"platform_order_id": str(out.get("order") or ticket), "state": "FILLED",
                "message": "position clôturée"}


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "CarnetMt5Agent/1.0"
    protocol_version = "HTTP/1.1"
    token: str = ""
    terminal: Terminal = None  # type: ignore[assignment]

    # -- helpers ---------------------------------------------------------
    def log_message(self, fmt: str, *args: Any) -> None:  # silence par défaut
        if getattr(self.server, "verbose", False):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _auth(self) -> bool:
        provided = self.headers.get("X-Bridge-Token", "")
        return bool(self.token) and hmac.compare_digest(provided, self.token)

    def _body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > 65536:
            raise TerminalError("corps trop volumineux", "BODY_TOO_LARGE", 413)
        try:
            return json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except json.JSONDecodeError as exc:
            raise TerminalError("JSON invalide", "INVALID_JSON") from exc

    # -- routes ----------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802
        self._dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch("POST")

    def _dispatch(self, method: str) -> None:
        if not self._auth():
            self._send(401, {"error": "jeton du pont invalide", "code": "MT5_BRIDGE_UNAUTHORIZED"})
            return
        parts = urlsplit(self.path)
        segments = [unquote(part) for part in parts.path.strip("/").split("/") if part]
        try:
            result = self._route(method, segments, parse_qs(parts.query))
        except TerminalError as exc:
            self._send(exc.status, {"error": exc.message, "code": exc.code})
            return
        except Exception as exc:  # pragma: no cover - défensif
            self._send(500, {"error": f"erreur interne de l'agent : {exc}", "code": "AGENT_ERROR"})
            return
        self._send(200, result)

    def _route(self, method: str, segments: list[str], query: dict[str, list[str]]):
        terminal = self.terminal
        if method == "GET" and segments == ["health"]:
            return terminal.health()
        if method == "GET" and segments == ["account"]:
            return terminal.account()
        if method == "GET" and segments == ["positions"]:
            return terminal.positions()
        if method == "GET" and segments == ["orders"]:
            return terminal.orders()
        if method == "GET" and segments == ["symbols"]:
            return {"symbols": terminal.symbols()}
        if method == "GET" and segments == ["history"]:
            since = (query.get("since") or [None])[0]
            return terminal.history(since)
        if method == "POST" and segments == ["quotes"]:
            symbols = self._body().get("symbols") or []
            return {"quotes": terminal.quotes([str(s) for s in symbols])}
        if method == "POST" and segments == ["orders"]:
            return terminal.place_order(self._body())
        if len(segments) == 2 and segments[0] == "orders" and method == "GET":
            return terminal.order_status(segments[1])
        if len(segments) == 3 and segments[0] == "orders" and method == "POST":
            if segments[2] == "cancel":
                return terminal.cancel(segments[1])
            if segments[2] == "modify":
                return terminal.modify(segments[1], self._body())
        if len(segments) == 3 and segments[0] == "positions" and segments[2] == "close" \
                and method == "POST":
            return terminal.close_position(segments[1])
        raise TerminalError("route inconnue", "NOT_FOUND", 404)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Agent MT5 (pont JSON pour Carnet de Trading)")
    parser.add_argument("--host", default="127.0.0.1",
                        help="adresse d'écoute (127.0.0.1 par défaut : tunnel/VPN requis)")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--token", required=True, help="jeton partagé (32+ caractères)")
    parser.add_argument("--symbol-suffix", default="", help="suffixe courtier, ex. .a ou _raw")
    parser.add_argument("--magic", type=int, default=MAGIC)
    parser.add_argument("--verbose", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if len(args.token) < 16:
        print("ERREUR : le jeton doit contenir au moins 16 caractères.", file=sys.stderr)
        return 2
    if mt5 is None:
        print("ERREUR : bibliothèque MetaTrader5 introuvable. Installez-la sur Windows :\n"
              "  py -3 -m pip install MetaTrader5\n"
              "et démarrez le terminal MT5 connecté à un compte démo.", file=sys.stderr)
        return 3
    if not mt5.initialize():
        print(f"ERREUR : initialisation MT5 refusée ({mt5.last_error()}).", file=sys.stderr)
        return 4
    try:
        BridgeHandler.token = args.token
        BridgeHandler.terminal = Terminal(mt5, args.symbol_suffix, args.magic)
        httpd = ThreadingHTTPServer((args.host, args.port), BridgeHandler)
        httpd.daemon_threads = True
        httpd.verbose = args.verbose  # type: ignore[attr-defined]
        account = BridgeHandler.terminal.account()
        print(f"Agent MT5 prêt sur http://{args.host}:{args.port} — compte {account['account_id']} "
              f"({account['account_type']}, {account['currency']})")
        print("Rappel : seuls les comptes démo sont acceptés ; aucun ordre réel n'est possible.")
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("Arrêt demandé.")
    finally:
        mt5.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
