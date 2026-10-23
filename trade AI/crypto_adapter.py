"""CCXT crypto adapter: only exchanges advertising attached SL/TP are eligible.
Sandbox is mandatory by default. Never retry order submissions after ambiguous network errors.
"""
from __future__ import annotations
import os
class CryptoBrokerError(RuntimeError):
    pass
class CryptoAdapter:
    def __init__(self, exchange=None):
        self.exchange = exchange
    @staticmethod
    def _live_gate():
        if os.getenv("LIVE_TRADING_ENABLED", "false").lower() != "true":
            raise CryptoBrokerError("Trading réel désactivé.")
        if os.getenv("LIVE_ORDER_CONFIRMATION") != "I_ACCEPT_REAL_FINANCIAL_RISK":
            raise CryptoBrokerError("Confirmation de risque absente.")
        if os.getenv("REAL_TRADING_REVIEWED") != "true":
            raise CryptoBrokerError("Revue humaine documentée requise.")
        if os.getenv("CRYPTO_LIVE_ENABLED", "false").lower() != "true":
            raise CryptoBrokerError("Trading crypto réel désactivé par défaut.")
    def _create_exchange(self):
        try:
            import ccxt
        except ImportError as exc:
            raise CryptoBrokerError("Installer ccxt pour utiliser le connecteur crypto.") from exc
        exchange_id = os.getenv("CRYPTO_EXCHANGE_ID", "").strip()
        key, secret = os.getenv("CRYPTO_API_KEY", "").strip(), os.getenv("CRYPTO_API_SECRET", "").strip()
        if not exchange_id or not key or not secret or not hasattr(ccxt, exchange_id):
            raise CryptoBrokerError("CRYPTO_EXCHANGE_ID, CRYPTO_API_KEY et CRYPTO_API_SECRET valides requis.")
        cls = getattr(ccxt, exchange_id)
        ex = cls({"apiKey": key, "secret": secret, "enableRateLimit": True, "timeout": 15000})
        sandbox = os.getenv("CRYPTO_SANDBOX", "true").lower() == "true"
        if sandbox:
            if not ex.has.get("setSandboxMode"):
                raise CryptoBrokerError("Cette plateforme ne déclare pas de sandbox CCXT.")
            ex.set_sandbox_mode(True)
        return ex
    def place_market_order_with_protection(self, symbol: str, side: str, amount: float, stop_loss: float,
     take_profit: float | None = None):
        self._live_gate()
        if side not in ("buy", "sell") or not symbol or amount <= 0 or stop_loss <= 0:
            raise ValueError("Symbole, sens, quantité et stop-loss valides requis.")
        ex = self.exchange or self._create_exchange()
        owns = self.exchange is None
        try:
            ex.load_markets()
            market = ex.market(symbol)
            if market.get("active") is False:
                raise CryptoBrokerError("Marché inactif.")
            # CCXT explicitly warns that attached protective orders are exchange-specific.
            try:
                sl_supported = ex.feature_value(symbol, "createOrder", "stopLoss")
                tp_supported = (take_profit is None) or ex.feature_value(symbol, "createOrder", "takeProfit")
            except Exception:
                sl_supported, tp_supported = False, False
            if not sl_supported or not tp_supported:
                raise CryptoBrokerError("La plateforme ne confirme pas le support des SL/TP attachés via CCXT; ordre non envoyé.")
            amount = float(ex.amount_to_precision(symbol, amount))
            stop_loss = float(ex.price_to_precision(symbol, stop_loss))
            if amount <= 0:
                raise ValueError("Quantité arrondie à zéro.")
            params = {"stopLoss": {"triggerPrice": stop_loss}}
            if take_profit is not None:
                params["takeProfit"] = {"triggerPrice": float(ex.price_to_precision(symbol, take_profit))
    }
            # A single entry request with attached protective orders; never send unprotected entry.
            order = ex.create_order(symbol, "market", side, amount, None, params)
            return {"venue":"crypto","status":"submitted_with_attached_protection","order":order}
        except (CryptoBrokerError, ValueError):

            raise
        except Exception as exc:
            # Submission outcome may be ambiguous; caller must reconcile, never retry blindly.
            raise CryptoBrokerError(f"Résultat de soumission ambigu/échec: {type(exc).__name__}; rapprocher ordres et soldes avant toute action.") from exc
        finally:
            if owns:
                try: ex.close()
                except Exception: pass
    def reconcile(self, symbol: str | None = None):
        ex = self.exchange or self._create_exchange()
        owns = self.exchange is None
        try:
            ex.load_markets()
            result = {"venue":"crypto","open_orders":ex.fetch_open_orders(symbol) if ex.has.get("fetchOpenOrders") else None,
                      "balances":ex.fetch_balance()}
            if ex.has.get("fetchPositions"):
                result["positions"] = ex.fetch_positions([symbol] if symbol else None)
            else:
                result["positions"] = None  # Spot holdings are balances, not standardized positions.
            return result
        finally:
            if owns:
                try: ex.close()
                except Exception: pass
