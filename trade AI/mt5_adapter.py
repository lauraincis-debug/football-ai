"""MetaTrader 5 adapter. Requires Windows + installed MT5 terminal + demo account testing.
Real trading is fail-closed and requires multiple explicit gates. Never auto-retry ambiguous orders.
"""
from __future__ import annotations
import os
from typing import Any
class BrokerError(RuntimeError):
    pass
class MetaTrader5Adapter:
    def __init__(self, mt5_module=None):
        if mt5_module is None:
            try:
                import MetaTrader5 as mt5_module
            except ImportError as exc:
                raise BrokerError("Installer MetaTrader5 sur Windows avec le terminal MT5 installé.") from exc
        self.mt5 = mt5_module
    @staticmethod
    def _live_gate():
        if os.getenv("LIVE_TRADING_ENABLED", "false").lower() != "true":
            raise BrokerError("Trading réel désactivé.")
        if os.getenv("LIVE_ORDER_CONFIRMATION") != "I_ACCEPT_REAL_FINANCIAL_RISK":
            raise BrokerError("Confirmation de risque absente.")
        if os.getenv("REAL_TRADING_REVIEWED") != "true":
            raise BrokerError("Revue humaine documentée requise.")
        if os.getenv("MT5_LIVE_ENABLED", "false").lower() != "true":
            raise BrokerError("MT5 réel désactivé par défaut.")
    def connect(self):
        kwargs = {}
        if os.getenv("MT5_TERMINAL_PATH"):
            kwargs["path"] = os.environ["MT5_TERMINAL_PATH"]
        login = os.getenv("MT5_LOGIN", "").strip()
        password = os.getenv("MT5_PASSWORD", "")
        server = os.getenv("MT5_SERVER", "").strip()
        if login:
            kwargs["login"] = int(login)
        if password:
            kwargs["password"] = password
        if server:
            kwargs["server"] = server
        if not self.mt5.initialize(**kwargs):
            raise BrokerError(f"Initialisation MT5 échouée: {self.mt5.last_error()}")
        account = self.mt5.account_info()
        if account is None:
            self.mt5.shutdown()
            raise BrokerError("Compte MT5 indisponible.")
        # Demo accounts only unless an additional explicit production gate is set.
        demo_mode = getattr(self.mt5, "ACCOUNT_TRADE_MODE_DEMO", 0)
        if getattr(account, "trade_mode", None) != demo_mode:
            if os.getenv("MT5_ALLOW_REAL_ACCOUNT", "false").lower() != "true":
                self.mt5.shutdown()
                raise BrokerError("Compte non démo : MT5_ALLOW_REAL_ACCOUNT=true est requis après revue indépendante.")
            self._live_gate()
        return account
    def close(self):
        self.mt5.shutdown()
    def place_market_order(self, symbol: str, side: str, volume: float, stop_loss: float, take_profit: float | None = None, *, magic: int = 620261):
        """Market order with SL and optional TP included in the native MT5 request."""
        self._live_gate()
        if side not in ("buy", "sell") or not symbol or volume <= 0 or stop_loss <= 0:
            raise ValueError("Symbole, sens, volume et stop-loss valides requis.")
        account = self.connect()
        try:
            if not self.mt5.symbol_select(symbol, True):
                raise BrokerError(f"Symbole indisponible: {symbol}")
            info = self.mt5.symbol_info(symbol)
            tick = self.mt5.symbol_info_tick(symbol)
            if info is None or tick is None:
                raise BrokerError("Informations de marché MT5 indisponibles.")

            step = float(getattr(info, "volume_step", 0) or 0)
            minvol = float(getattr(info, "volume_min", 0) or 0)
            maxvol = float(getattr(info, "volume_max", 0) or 0)
            if step <= 0 or volume < minvol or volume > maxvol:
                raise ValueError("Volume hors limites MT5.")
            steps = round(volume / step)
            normalized = round(steps * step, 8)
            if abs(normalized - volume) > max(1e-8, step * 1e-6):
                raise ValueError("Volume non conforme au pas du symbole.")
            order_type = self.mt5.ORDER_TYPE_BUY if side == "buy" else self.mt5.ORDER_TYPE_SELL
            price = float(tick.ask if side == "buy" else tick.bid)
            digits = int(getattr(info, "digits", 5))
            sl, tp = round(float(stop_loss), digits), (round(float(take_profit), digits) if take_profit else 0.0)
            if side == "buy" and (sl >= price or (tp and tp <= price)):
                raise ValueError("Pour un achat, SL < prix courant et TP > prix courant.")
            if side == "sell" and (sl <= price or (tp and tp >= price)):
                raise ValueError("Pour une vente, SL > prix courant et TP < prix courant.")
            filling = getattr(info, "filling_mode", getattr(self.mt5, "ORDER_FILLING_IOC", 1))
            request = {
                "action": self.mt5.TRADE_ACTION_DEAL, "symbol": symbol, "volume": normalized,
                "type": order_type, "price": price, "sl": sl, "tp": tp,
                "deviation": int(os.getenv("MT5_MAX_DEVIATION_POINTS", "20")),
                "magic": magic, "comment": "CarnetTrading", "type_time": self.mt5.ORDER_TIME_GTC,
                "type_filling": filling,
            }
            check = self.mt5.order_check(request)
            if check is None or getattr(check, "retcode", None) not in (0, getattr(self.mt5, "TRADE_RETCODE_DONE", 10009)):
                raise BrokerError(f"MT5 order_check refusé: {getattr(check, 'comment', None)}")
            result = self.mt5.order_send(request)
            accepted = {getattr(self.mt5, "TRADE_RETCODE_DONE", 10009), getattr(self.mt5, "TRADE_RETCODE_DONE_PARTIAL", 10010)}
            if result is None or getattr(result, "retcode", None) not in accepted:
                raise BrokerError(f"MT5 ordre refusé ou résultat ambigu: {getattr(result, 'comment', None)}; ne pas réessayer automatiquement.")
            # Reconcile with broker positions; require native SL to be visible before declaring protected.
            positions = self.mt5.positions_get(symbol=symbol)
            matching = [p for p in (positions or []) if getattr(p, "magic", None) == magic and getattr(p,
     "comment", "") == "CarnetTrading"]
            if not matching or any(float(getattr(p, "sl", 0) or 0) <= 0 for p in matching):
                raise BrokerError("État non rapproché ou stop-loss absent côté courtier : intervention manuelle immédiate requise; aucun retry.")
            return {"venue":"mt5","status":"accepted_protected","order":getattr(result,"order",None),"deal":getattr(result,"deal",None),"volume":normalized,"positions":[self._position_dict(p) for p in matching]}
        finally:
            self.close()
    @staticmethod
    def _position_dict(p):
        return {"ticket":getattr(p,"ticket",None),"symbol":getattr(p,"symbol",None),"type":getattr(p,"type",None),"volume":getattr(p,"volume",None),"price_open":getattr(p,"price_open",None),"sl":getattr(p,"sl",None),"tp":getattr(p,"tp",None),"profit":getattr(p,"profit",None),"magic":getattr(p,"magic",None)
    }
    def reconcile_positions(self):
        self.connect()
        try:
            positions = self.mt5.positions_get()
            if positions is None:
                raise BrokerError(f"Rapprochement MT5 impossible: {self.mt5.last_error()}")
            return [self._position_dict(p) for p in positions]
        finally:
            self.close()
