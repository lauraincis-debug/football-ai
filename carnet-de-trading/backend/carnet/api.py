"""API HTTP et service des fichiers statiques (section 7).

Serveur standard library : aucune dépendance tierce, surface d'attaque réduite.
- authentification par jeton de session (en-tête ``Authorization: Bearer``) ;
- autorisations par permission (rôle) sur chaque route ;
- limitation de débit sur la connexion et sur l'API ;
- en-têtes de sécurité, aucune journalisation de secret ;
- fichiers statiques servis depuis ``web/``, sans traversée de répertoire.
"""

from __future__ import annotations

import json
import mimetypes
import os
import posixpath
import threading
import time
import urllib.parse
import traceback
from decimal import Decimal
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

from . import APP_NAME, __version__
from .backtest import BacktestConfig, BacktestRunner
from .config import ENV_SIMULATION, SYMBOLS
from .engine import TradingEngine
from .security import (
    AuthError,
    PermissionError_,
    RateLimiter,
    Session,
    password_strength,
    verify_totp,
)
from .util import D, as_number, iso, now_utc

JSON_CT = "application/json; charset=utf-8"
MAX_BODY_BYTES = 256 * 1024


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "BAD_REQUEST"):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


class Router:
    """Routes déclaratives : (méthode, motif, permission, handler)."""

    def __init__(self, api: "ApiApplication"):
        self.api = api
        self.routes: list[tuple[str, tuple[str, ...], str | None, Callable]] = []

    def add(self, method: str, pattern: str, permission: str | None, handler: Callable) -> None:
        parts = tuple(p for p in pattern.strip("/").split("/") if p)
        self.routes.append((method.upper(), parts, permission, handler))

    def match(self, method: str, path: str) -> tuple[Callable | None, dict[str, str], str | None]:
        segments = tuple(p for p in path.strip("/").split("/") if p)
        for route_method, parts, permission, handler in self.routes:
            if route_method != method.upper() or len(parts) != len(segments):
                continue
            params: dict[str, str] = {}
            matched = True
            for expected, actual in zip(parts, segments):
                if expected.startswith("{"):
                    params[expected[1:-1]] = urllib.parse.unquote(actual)
                elif expected != actual:
                    matched = False
                    break
            if matched:
                return handler, params, permission
        return None, {}, None


class ApiApplication:
    def __init__(self, engine: TradingEngine, web_dir: Path):
        self.engine = engine
        self.web_dir = Path(web_dir).resolve()
        self.router = Router(self)
        self.login_limiter = RateLimiter(limit=8, window_seconds=300)
        self.api_limiter = RateLimiter(limit=1200, window_seconds=60)
        self.started_at = time.time()
        self.request_count = 0
        self.error_count = 0
        self.backtests = BacktestRunner(engine.db, self._history_provider, engine.journal)
        self._register_routes()

    # ------------------------------------------------------------------
    # Routes
    # ------------------------------------------------------------------
    def _register_routes(self) -> None:
        r = self.router
        r.add("GET", "/api/public/info", None, self.public_info)
        r.add("POST", "/api/auth/login", None, self.login)
        r.add("POST", "/api/auth/logout", None, self.logout)
        r.add("GET", "/api/auth/me", None, self.me)
        r.add("POST", "/api/auth/password", None, self.change_password)
        r.add("POST", "/api/auth/totp/setup", None, self.totp_setup)
        r.add("POST", "/api/auth/totp/enable", None, self.totp_enable)
        r.add("POST", "/api/auth/totp/disable", None, self.totp_disable)

        r.add("GET", "/api/state", "state:read", self.state)
        r.add("GET", "/api/health", None, self.health)
        r.add("GET", "/api/symbols", "market:read", self.symbols)
        r.add("GET", "/api/market/{symbol}/candles", "market:read", self.candles)
        r.add("GET", "/api/market/{symbol}/indicators", "market:read", self.indicators)

        r.add("GET", "/api/orders", "orders:read", self.orders_list)
        r.add("GET", "/api/orders/{order_id}", "orders:read", self.order_detail)
        r.add("POST", "/api/orders/{order_id}/cancel", "control:stop-trading", self.order_cancel)
        r.add("GET", "/api/positions", "positions:read", self.positions)
        r.add("GET", "/api/positions/history", "positions:read", self.positions_history)
        r.add("GET", "/api/signals", "strategies:read", self.signals)

        r.add("GET", "/api/risk/policy", "risk:read", self.policy_get)
        r.add("POST", "/api/risk/policy", "risk:write", self.policy_update)
        r.add("GET", "/api/risk/status", "risk:read", self.risk_status)
        r.add("GET", "/api/risk/history", "risk:read", self.policy_history)

        r.add("GET", "/api/strategies", "strategies:read", self.strategies_list)
        r.add("POST", "/api/strategies/{key}/toggle", "strategies:toggle", self.strategy_toggle)
        r.add("POST", "/api/backtest", "backtest:run", self.backtest_run)
        r.add("GET", "/api/backtests", "backtest:read", self.backtests_list)

        r.add("GET", "/api/journal", "journal:read", self.journal_tail)
        r.add("POST", "/api/journal/verify", "journal:verify", self.journal_verify)
        r.add("GET", "/api/audits", "journal:read", self.audits)
        r.add("GET", "/api/diagnostics", "diagnostics:read", self.diagnostics)

        r.add("POST", "/api/control/stop", "control:stop-trading", self.control_stop)
        r.add("POST", "/api/control/resume", "control:resume", self.control_resume)
        r.add("POST", "/api/control/liquidate", "control:liquidate", self.control_liquidate)
        r.add("POST", "/api/control/kill-switch", "control:liquidate", self.control_kill)
        r.add("POST", "/api/control/release-kill-switch", "control:resume", self.control_release_kill)

        r.add("GET", "/api/environment", "state:read", self.environment_get)
        r.add("POST", "/api/environment", "settings:write", self.environment_set)
        r.add("GET", "/api/validations", "state:read", self.validations_get)
        r.add("POST", "/api/validations", "owner:decide", self.validations_set)

        r.add("GET", "/api/notifications", "state:read", self.notifications_list)
        r.add("POST", "/api/notifications/read", "state:read", self.notifications_read)
        r.add("GET", "/api/reconciliations", "diagnostics:read", self.reconciliations)
        r.add("POST", "/api/reconcile", "diagnostics:read", self.reconcile_now)

        r.add("GET", "/api/backups", "backup:run", self.backups_list)
        r.add("POST", "/api/backups", "backup:run", self.backup_create)
        r.add("POST", "/api/backups/verify", "backup:run", self.backup_verify)
        r.add("POST", "/api/backups/drill", "backup:restore", self.backup_drill)
        r.add("POST", "/api/backups/restore", "backup:restore", self.backup_restore)

        r.add("GET", "/api/users", "users:manage", self.users_list)
        r.add("POST", "/api/users", "users:manage", self.users_create)
        r.add("GET", "/api/sessions", "users:manage", self.sessions_list)
        r.add("DELETE", "/api/sessions/{session_id}", "users:manage", self.session_revoke)

    # ------------------------------------------------------------------
    # Contexte et helpers
    # ------------------------------------------------------------------
    def _history_provider(self, symbol: str, timeframe: str, count: int):
        return self.engine.simulator.history(symbol, timeframe, count)

    def _client_ip(self, handler) -> str:
        forwarded = handler.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return handler.client_address[0] if handler.client_address else "unknown"

    def _session(self, handler) -> Session | None:
        header = handler.headers.get("Authorization", "")
        token = None
        if header.lower().startswith("bearer "):
            token = header[7:].strip()
        if not token:
            token = handler.headers.get("X-Session-Token")
        return self.engine.sessions.resolve(token)

    def _require(self, handler, permission: str | None) -> Session:
        session = self._session(handler)
        if session is None:
            raise AuthError("authentification requise", "AUTH_REQUIRED", 401)
        if permission and not session.user.allows(permission):
            raise PermissionError_(permission)
        return session

    # ------------------------------------------------------------------
    # Routes publiques
    # ------------------------------------------------------------------
    def public_info(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        return 200, {
            "app": {"name": APP_NAME, "version": __version__},
            "environment": self.engine.guard.environment,
            "banner": self.engine._banner(),
            "simulation": True,
            "mfa_available": True,
            "server_time": iso(now_utc()),
        }

    def login(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        ip = self._client_ip(handler)
        if not self.login_limiter.allow(f"login:{ip}"):
            raise AuthError("trop de tentatives : réessayez plus tard", "RATE_LIMITED", 429)
        username = (body.get("username") or "").strip()
        password = body.get("password") or ""
        code = body.get("code")
        if not username or not password:
            raise ApiError("identifiant et mot de passe requis", 400, "MISSING_CREDENTIALS")
        user = self.engine.users.authenticate(username, password, code)
        token, session_obj = self.engine.sessions.create(
            user, ip=ip, user_agent=handler.headers.get("User-Agent"))
        self.engine.audit.record(user.username, "auth.login", {"ip": ip}, ip)
        self.engine.journal.info("security", "LOGIN", f"connexion de {user.username} depuis {ip}")
        return 200, {"token": token, "user": user.to_dict(), "session": session_obj.to_dict()}

    def logout(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        header = handler.headers.get("Authorization", "")
        token = header[7:].strip() if header.lower().startswith("bearer ") else None
        if token:
            self.engine.sessions.revoke(token=token)
        return 200, {"ok": True}

    def me(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        if session is None:
            raise AuthError("authentification requise", "AUTH_REQUIRED", 401)
        return 200, {"user": session.user.to_dict(), "session": session.to_dict()}

    def change_password(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        session = self._require(handler, None)
        current = body.get("current_password") or ""
        new = body.get("new_password") or ""
        user = self.engine.users.authenticate(session.user.username, current,
                                              body.get("code"))
        strength = password_strength(new)
        if not strength["ok"]:
            raise ApiError("mot de passe trop faible : 12 caractères minimum avec majuscule, "
                           "minuscule, chiffre et symbole", 400, "WEAK_PASSWORD")
        self.engine.users.set_password(user.username, new)
        self.engine.sessions.revoke_user(user.id)
        self.engine.audit.record(user.username, "auth.password_changed", {})
        self.engine.journal.warning("security", "PASSWORD_CHANGED",
                                    f"mot de passe modifié pour {user.username}")
        token, _ = self.engine.sessions.create(user, ip=self._client_ip(handler))
        return 200, {"ok": True, "token": token}

    def totp_setup(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        session = self._require(handler, None)
        return 200, self.engine.user_totp_setup(session.user.username)

    def totp_enable(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        session = self._require(handler, None)
        secret = (body.get("secret") or "").strip()
        code = (body.get("code") or "").strip()
        if not verify_totp(secret, code):
            raise ApiError("code MFA invalide", 400, "MFA_INVALID")
        self.engine.users.enable_totp(session.user.username, secret)
        self.engine.journal.warning("security", "MFA_ENABLED",
                                    f"MFA activée pour {session.user.username}")
        self.engine.audit.record(session.user.username, "auth.mfa_enabled", {})
        return 200, {"ok": True}

    def totp_disable(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        session = self._require(handler, None)
        password = body.get("password") or ""
        self.engine.users.authenticate(session.user.username, password, body.get("code"))
        self.engine.users.disable_totp(session.user.username)
        self.engine.audit.record(session.user.username, "auth.mfa_disabled", {})
        return 200, {"ok": True}

    # ------------------------------------------------------------------
    # État
    # ------------------------------------------------------------------
    def state(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        return 200, self.engine.snapshot(session.user)

    def health(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        return 200, {
            "ok": self.engine.state in ("RUNNING", "STOPPED"),
            "state": self.engine.state,
            "environment": self.engine.guard.environment,
            "uptime_seconds": round(time.time() - self.started_at, 1),
            "requests": self.request_count,
            "errors": self.error_count,
            "db": self.engine.db.integrity_check(),
            "version": __version__,
            "server_time": iso(now_utc()),
        }

    def symbols(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        return 200, {"symbols": [spec.to_dict() for spec in SYMBOLS.values()]}

    def candles(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        symbol = params["symbol"].upper()
        if symbol not in SYMBOLS:
            raise ApiError("instrument inconnu", 404, "SYMBOL_UNKNOWN")
        timeframe = (query.get("tf") or ["5m"])[0]
        limit = min(600, max(10, int((query.get("limit") or ["200"])[0])))
        series = self.engine.market.series(symbol, timeframe)
        return 200, {
            "symbol": symbol,
            "timeframe": timeframe,
            "candles": series.to_list(limit),
            "quote": (self.engine.market.quote(symbol).to_dict()
                      if self.engine.market.quote(symbol) else None),
        }

    def indicators(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        symbol = params["symbol"].upper()
        if symbol not in SYMBOLS:
            raise ApiError("instrument inconnu", 404, "SYMBOL_UNKNOWN")
        snapshot = self.engine.strategies.snapshot(self.engine.market.series(symbol, "5m"))
        from .market import to_float_map

        return 200, {"symbol": symbol, "indicators": to_float_map(snapshot)}

    # ------------------------------------------------------------------
    # Ordres et positions
    # ------------------------------------------------------------------
    def orders_list(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        state = (query.get("state") or [None])[0]
        limit = min(500, int((query.get("limit") or ["100"])[0]))
        return 200, {"orders": self.engine.orders.recent_orders(limit, state)}

    def order_detail(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        order = self.engine.orders.get(params["order_id"])
        if order is None:
            raise ApiError("ordre inconnu", 404, "ORDER_NOT_FOUND")
        return 200, {"order": order}

    def order_cancel(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        ok = self.engine.orders.cancel(params["order_id"])
        self.engine.audit.record(session.user.username, "order.cancel", {"order_id": params["order_id"]})
        return 200, {"ok": ok}

    def positions(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        return 200, {"positions": self.engine.orders.open_positions(),
                     "totals": self.engine.orders.totals()}

    def positions_history(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        limit = min(500, int((query.get("limit") or ["100"])[0]))
        return 200, {"positions": self.engine.orders.closed_positions(limit),
                     "metrics": self.engine.metrics()}

    def signals(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        limit = min(200, int((query.get("limit") or ["50"])[0]))
        return 200, {"signals": self.engine.recent_signals(limit)}

    # ------------------------------------------------------------------
    # Risque
    # ------------------------------------------------------------------
    def policy_get(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        return 200, {"policy": self.engine.policy_store.current().to_dict(),
                     "version_chain_ok": self.engine.policy_store.verify_chain()}

    def policy_update(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        changes = body.get("changes") or {}
        policy = self.engine.policy_store.update(
            changes, session.user, body.get("reason") or "modification propriétaire",
            body.get("owner_token"), body.get("confirmation"), self._client_ip(handler))
        self.engine.risk.policy = policy
        self.engine.risk_states.policy = policy
        return 200, {"policy": policy.to_dict()}

    def risk_status(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        account = self.engine.connector.account()
        return 200, {
            "risk": self.engine.risk_states.snapshot(account.equity),
            "account": account.to_dict(),
            "entries_enabled": self.engine.entries_enabled,
            "guard": self.engine.guard.status(),
            "policy": self.engine.policy_store.current().to_dict(),
        }

    def policy_history(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        return 200, {"versions": self.engine.policy_store.history()}

    # ------------------------------------------------------------------
    # Stratégies et backtests
    # ------------------------------------------------------------------
    def strategies_list(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        return 200, {"strategies": self.engine.strategies.describe()}

    def strategy_toggle(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        key = params["key"]
        if key not in self.engine.strategies.strategies:
            raise ApiError("stratégie inconnue", 404, "STRATEGY_UNKNOWN")
        enabled = bool(body.get("enabled", True))
        strategy = self.engine.strategies.set_enabled(key, enabled)
        self.engine.journal.warning("strategy", "STRATEGY_TOGGLED",
                                    f"stratégie {key} {'activée' if enabled else 'désactivée'} "
                                    f"par {session.user.username}")
        self.engine.audit.record(session.user.username, "strategy.toggle",
                                 {"strategy": key, "enabled": enabled})
        return 200, {"strategy": strategy.info()}

    def backtest_run(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        strategy = body.get("strategy") or "ema_trend"
        if strategy not in self.engine.strategies.strategies:
            raise ApiError("stratégie inconnue", 400, "STRATEGY_UNKNOWN")
        symbols = tuple(body.get("symbols") or ["EURUSD", "BTCUSDT"])
        for symbol in symbols:
            if symbol not in SYMBOLS:
                raise ApiError(f"instrument inconnu: {symbol}", 400, "SYMBOL_UNKNOWN")
        bars = min(3000, max(200, int(body.get("bars") or 800)))
        config = BacktestConfig(
            strategy=strategy, symbols=symbols, bars=bars,
            timeframe=body.get("timeframe") or "5m",
            initial_capital=D(body.get("initial_capital") or "10000"),
            risk_per_trade_pct=D(body.get("risk_per_trade_pct") or "0.5"),
            monte_carlo_runs=min(5000, max(0, int(body.get("monte_carlo_runs") or 1000))),
            walk_forward_windows=min(6, max(1, int(body.get("walk_forward_windows") or 3))),
            seed=int(body.get("seed") or 20261101),
        )
        result = self.backtests.run(config, body.get("name") or f"{strategy} / {', '.join(symbols)}",
                                    created_by=session.user.username)
        self.engine.audit.record(session.user.username, "backtest.run",
                                 {"strategy": strategy, "symbols": list(symbols), "bars": bars})
        return 200, result

    def backtests_list(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        return 200, {"backtests": self.backtests.list()}

    # ------------------------------------------------------------------
    # Journal et diagnostic
    # ------------------------------------------------------------------
    def journal_tail(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        limit = min(1000, int((query.get("limit") or ["200"])[0]))
        level = (query.get("level") or [None])[0]
        module = (query.get("module") or [None])[0]
        return 200, {"entries": self.engine.journal.tail(limit, level, module),
                     "stats": self.engine.journal.stats()}

    def journal_verify(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        result = self.engine.journal.verify_chain()
        if not result["ok"]:
            self.engine.journal.critical("journal", "JOURNAL_INTEGRITY",
                                         f"rupture de chaîne détectée à l'entrée {result.get('broken_at')}",
                                         payload=result)
            self.engine.notifications.push(
                "CRITICAL", "JOURNAL_INTEGRITY", "Intégrité du journal compromise",
                "Une rupture de chaîne a été détectée : investigation requise.")
        return 200, result

    def audits(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        return 200, {"audits": self.engine.audit.tail(200),
                     "chain_ok": self.engine.audit.verify()}

    def diagnostics(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        engine = self.engine
        return 200, {
            "app": {"name": APP_NAME, "version": __version__, "state": engine.state,
                    "uptime_seconds": round(time.time() - self.started_at, 1),
                    "requests": self.request_count, "errors": self.error_count},
            "db": engine.db.stats(),
            "journal": engine.journal.stats(),
            "connectors": [engine.connector.to_dict(), engine.connector.health()],
            "reconciliations": engine.reconciler.history(5),
            "guard": engine.guard.status(),
            "environment": engine.guard.environment,
            "engine_errors": engine._errors[-10:],
            "server": {"host": engine.settings.host, "port": engine.settings.port,
                       "tick_seconds": engine.settings.engine_tick_seconds},
            "backups": [r.to_dict() for r in engine.backups.list()[:5]],
            "python": os.sys.version.split()[0] if hasattr(os, "sys") else "3",
        }

    def reconciliations(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        return 200, {"reconciliations": self.engine.reconciler.history(20),
                     "last": self.engine.reconciler.last_result}

    def reconcile_now(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        result = self.engine.reconciler.run("manual")
        self.engine.entries_enabled = (result["status"] == "OK"
                                       and not self.engine.risk_states.state.suspended
                                       and not self.engine.risk_states.state.kill_switch)
        return 200, result

    # ------------------------------------------------------------------
    # Contrôles
    # ------------------------------------------------------------------
    def control_stop(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        if session.user.role not in ("ADMIN", "OPERATOR"):
            raise PermissionError_("control:stop-trading")
        return 200, self.engine.stop_trading(session.user.username, body.get("reason") or "")

    def control_resume(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        try:
            return 200, self.engine.resume_trading(session.user.username)
        except Exception as exc:
            raise ApiError(str(exc), 409, "RESUME_REFUSED") from exc

    def control_liquidate(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        if (body.get("confirmation") or "").strip().upper() != "LIQUIDER":
            raise ApiError("confirmation explicite requise (LIQUIDER)", 400, "CONFIRMATION_REQUIRED")
        return 200, self.engine.liquidate_all(session.user.username,
                                              body.get("reason") or "liquidation d'urgence")

    def control_kill(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        return 200, self.engine.engage_kill_switch(session.user.username,
                                                   body.get("reason") or "arrêt d'urgence")

    def control_release_kill(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        if session.user.role != "ADMIN":
            raise PermissionError_("control:resume")
        return 200, self.engine.release_kill_switch(session.user.username)

    # ------------------------------------------------------------------
    # Environnement, validations, notifications
    # ------------------------------------------------------------------
    def environment_get(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        return 200, self.engine.guard.status()

    def environment_set(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        status = self.engine.guard.request_environment(
            body.get("environment") or ENV_SIMULATION, session.user,
            body.get("owner_token"), body.get("confirmation"), body.get("account_id"),
            self._client_ip(handler))
        self.engine.entries_enabled = (not self.engine.risk_states.state.suspended
                                       and not self.engine.risk_states.state.kill_switch)
        return 200, status

    def validations_get(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        return 200, {"validations": self.engine.guard.validations(),
                     "all_closed": self.engine.guard.all_closed()}

    def validations_set(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        result = self.engine.guard.record_validation(
            body.get("key") or "", bool(body.get("closed")), body.get("evidence") or "",
            session.user, body.get("note") or "")
        return 200, {"validation": result}

    def notifications_list(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        return 200, {"notifications": self.engine.notifications.tail(50),
                     "unread": self.engine.notifications.unread_count()}

    def notifications_read(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        count = self.engine.notifications.mark_read(body.get("id"))
        return 200, {"marked": count, "unread": self.engine.notifications.unread_count()}

    # ------------------------------------------------------------------
    # Sauvegardes
    # ------------------------------------------------------------------
    def backups_list(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        return 200, {"backups": [r.to_dict() for r in self.engine.backups.list()]}

    def backup_create(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        record = self.engine.backups.create(label=body.get("label") or "manual")
        self.engine.audit.record(session.user.username, "backup.create", record.to_dict())
        return 200, {"backup": record.to_dict()}

    def backup_verify(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        path = body.get("path") or ""
        if not path:
            raise ApiError("chemin de sauvegarde requis", 400, "MISSING_PATH")
        return 200, self.engine.backups.verify(path)

    def backup_drill(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        result = self.engine.backups.drill()
        self.engine.audit.record(session.user.username, "backup.drill", result)
        return 200, result

    def backup_restore(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        if (body.get("confirmation") or "").strip().upper() != "RESTAURER":
            raise ApiError("confirmation explicite requise (RESTAURER)", 400, "CONFIRMATION_REQUIRED")
        path = body.get("path") or ""
        info = self.engine.backups.verify(path)
        self.engine.audit.record(session.user.username, "backup.restore_requested",
                                 {"path": path, "info": info})
        return 409, {
            "restored": False,
            "reason": "La restauration en production est bloquée pendant l'exécution du service. "
                      "Utilisez scripts/restore.sh à l'arrêt du moteur (procédure documentée).",
            "verification": info,
        }

    # ------------------------------------------------------------------
    # Utilisateurs et sessions
    # ------------------------------------------------------------------
    def users_list(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        return 200, {"users": [u.to_dict() for u in self.engine.users.list()],
                     "sessions": self.engine.sessions.active()}

    def users_create(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        username = (body.get("username") or "").strip()
        password = body.get("password") or ""
        role = body.get("role") or "VIEWER"
        strength = password_strength(password)
        if not strength["ok"]:
            raise ApiError("mot de passe trop faible (12 caractères, majuscule, minuscule, "
                           "chiffre, symbole)", 400, "WEAK_PASSWORD")
        user = self.engine.users.create(username, password, role, must_change=True)
        self.engine.audit.record(session.user.username, "user.create",
                                 {"username": username, "role": role})
        return 200, {"user": user.to_dict()}

    def sessions_list(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        return 200, {"sessions": self.engine.sessions.active()}

    def session_revoke(self, handler, params, session, body, query) -> tuple[int, dict[str, Any]]:
        count = self.engine.sessions.revoke(session_id=params["session_id"])
        self.engine.audit.record(session.user.username, "session.revoke",
                                 {"session_id": params["session_id"]})
        return 200, {"revoked": count}

    # ------------------------------------------------------------------
    # Dispatch
    # ------------------------------------------------------------------
    def handle_api(self, handler, method: str, path: str, query: dict[str, list[str]],
                   body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        self.request_count += 1
        if not self.api_limiter.allow(f"api:{self._client_ip(handler)}"):
            raise AuthError("limite de débit atteinte", "RATE_LIMITED", 429)
        route, params, permission = self.router.match(method, path)
        if route is None:
            raise ApiError("route inconnue", 404, "NOT_FOUND")
        session = self._require(handler, permission) if permission else self._session(handler)
        return route(handler, params, session, body, query)


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "CarnetDeTrading/1.0"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    # -- log -------------------------------------------------------------
    def log_message(self, fmt: str, *args: Any) -> None:
        app: ApiApplication = self.server.app  # type: ignore[attr-defined]
        if app.engine.settings.log_level == "DEBUG":
            app.engine.journal.debug("http", "REQUEST", fmt % args)

    # -- helpers ---------------------------------------------------------
    def _send(self, status: int, payload: bytes, content_type: str,
              extra_headers: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
                         "script-src 'self'; connect-src 'self'; frame-ancestors *; base-uri 'self'")
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(as_number(payload), ensure_ascii=False, default=str).encode("utf-8")
        self._send(status, data, JSON_CT)

    def _read_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > MAX_BODY_BYTES:
            raise ApiError("corps de requête trop volumineux", 413, "BODY_TOO_LARGE")
        raw = self.rfile.read(length)
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ApiError("JSON invalide", 400, "INVALID_JSON") from exc
        if not isinstance(parsed, dict):
            raise ApiError("objet JSON attendu", 400, "INVALID_JSON")
        return parsed

    # -- méthodes HTTP ---------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802
        self._dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch("POST")

    def do_DELETE(self) -> None:  # noqa: N802
        self._dispatch("DELETE")

    def do_HEAD(self) -> None:  # noqa: N802
        self._dispatch("HEAD")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Allow", "GET, POST, DELETE, HEAD, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _dispatch(self, method: str) -> None:
        app: ApiApplication = self.server.app  # type: ignore[attr-defined]
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        query = urllib.parse.parse_qs(parsed.query)
        try:
            if path.startswith("/api/"):
                body = self._read_body() if method in ("POST", "DELETE") else {}
                status, payload = app.handle_api(self, method, path, query, body)
                self._json(status, payload)
            else:
                self._serve_static(path)
        except AuthError as exc:
            app.error_count += 1
            self._json(exc.status, {"error": str(exc), "code": exc.code})
        except ApiError as exc:
            app.error_count += 1
            self._json(exc.status, {"error": exc.message, "code": exc.code})
        except PermissionError_ as exc:  # pragma: no cover - sous-classe d'AuthError
            app.error_count += 1
            self._json(403, {"error": str(exc), "code": exc.code})
        except BrokenPipeError:  # pragma: no cover
            pass
        except Exception as exc:
            app.error_count += 1
            app.engine.journal.error("api", "UNHANDLED_ERROR",
                                     f"{method} {path}: {type(exc).__name__}: {exc}")
            self._json(500, {"error": "erreur interne", "code": "INTERNAL_ERROR",
                             "detail": f"{type(exc).__name__}"})

    # -- fichiers statiques ---------------------------------------------
    def _serve_static(self, path: str) -> None:
        app: ApiApplication = self.server.app  # type: ignore[attr-defined]
        web_dir = app.web_dir
        requested = path.lstrip("/") or "index.html"
        if requested.endswith("/"):
            requested += "index.html"
        safe = posixpath.normpath("/" + requested).lstrip("/")
        target = (web_dir / safe).resolve()
        if not str(target).startswith(str(web_dir)) or not target.is_file():
            target = web_dir / "index.html"
        if not target.is_file():  # pragma: no cover
            self._send(404, b"Not found", "text/plain; charset=utf-8")
            return
        content_type, _ = mimetypes.guess_type(str(target))
        content_type = content_type or "application/octet-stream"
        if content_type.startswith("text/") or content_type in (
                "application/javascript", "application/manifest+json", "image/svg+xml"):
            content_type += "; charset=utf-8"
        payload = target.read_bytes()
        cache = "no-cache" if target.name in ("index.html", "sw.js") else "public, max-age=300"
        self._send(200, payload, content_type, {"Cache-Control": cache})


class ApiServer:
    def __init__(self, engine: TradingEngine, host: str | None = None, port: int | None = None,
                 web_dir: Path | None = None):
        self.engine = engine
        self.app = ApiApplication(engine, web_dir or engine.settings.web_dir)
        self.host = host or engine.settings.host
        self.port = port or engine.settings.port
        self.httpd: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    def build(self) -> ThreadingHTTPServer:
        httpd = ThreadingHTTPServer((self.host, self.port), RequestHandler)
        httpd.daemon_threads = True
        httpd.allow_reuse_address = True
        httpd.app = self.app  # type: ignore[attr-defined]
        self.httpd = httpd
        return httpd

    def serve_forever(self) -> None:  # pragma: no cover - lancé par server.py
        httpd = self.httpd or self.build()
        httpd.serve_forever(poll_interval=0.5)

    def start_background(self) -> ThreadingHTTPServer:
        httpd = self.httpd or self.build()
        self._thread = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.5},
                                        name="carnet-api", daemon=True)
        self._thread.start()
        return httpd

    def stop(self) -> None:
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
        if self._thread:
            self._thread.join(timeout=3)
