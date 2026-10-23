"""CCXT live adapter. Live orders are impossible unless explicitly enabled and all guardrails pass.
Venue-specific stop-order semantics vary; this adapter deliberately supports limit entries only and does
not claim to place a linked protective stop. Do not use live mode until venue-specific protection is implemented.
"""
from __future__ import annotations
import os
from decimal import Decimal
import ccxt
def create_exchange():
    exchange_id=os.getenv("EXCHANGE_ID","").strip()
    api_key=os.getenv("EXCHANGE_API_KEY","").strip()
    secret=os.getenv("EXCHANGE_API_SECRET","").strip()
    if not exchange_id or not api_key or not secret:
        raise RuntimeError("EXCHANGE_ID, EXCHANGE_API_KEY et EXCHANGE_API_SECRET sont obligatoires.")
    if not hasattr(ccxt,exchange_id):
        raise RuntimeError(f"Exchange CCXT non reconnu: {exchange_id}")
    cls=getattr(ccxt,exchange_id)
    opts={"apiKey":api_key,"secret":secret,"enableRateLimit":True,
          "timeout":15000,"options":{"defaultType":os.getenv("EXCHANGE_MARKET_TYPE","spot")}}
    if os.getenv("EXCHANGE_PASSWORD"): opts["password"]=os.environ["EXCHANGE_PASSWORD"]
    ex=cls(opts)
    if os.getenv("EXCHANGE_SANDBOX","true").lower()=="true":
        if not ex.has.get("setSandboxMode"): raise RuntimeError("Cette plateforme ne déclare pas le mode sandbox CCXT.")
        ex.set_sandbox_mode(True)
    return ex
def validate_live_switch():
    if os.getenv("LIVE_TRADING_ENABLED","false").lower()!="true":
        raise RuntimeError("Trading réel désactivé. Définir LIVE_TRADING_ENABLED=true uniquement après audit.")
    if os.getenv("LIVE_ORDER_CONFIRMATION")!="I_ACCEPT_REAL_FINANCIAL_RISK":
        raise RuntimeError("LIVE_ORDER_CONFIRMATION incorrecte.")
    if os.getenv("EXCHANGE_SANDBOX","true").lower()!="false":
        raise RuntimeError("Le mode sandbox est actif; configurez et testez le bac à sable avant la production.")
    if os.getenv("REAL_TRADING_REVIEWED")!="true":
        raise RuntimeError("Le déploiement réel exige REAL_TRADING_REVIEWED=true après revue humaine documentée.")
def place_limit_order(symbol: str, side: str, amount: float, price: float):
    """No blind retry: a network timeout can mean the exchange accepted the order."""
    validate_live_switch()
    if side not in ("buy","sell"): raise ValueError("side doit être buy ou sell")
    if not symbol or "/" not in symbol: raise ValueError("Symbole CCXT attendu, ex. BTC/USDT")
    if not (amount>0 and price>0): raise ValueError("Quantité et prix doivent être positifs")
    ex=create_exchange()
    try:
        ex.load_markets()
        market=ex.market(symbol)
        if market.get("active") is False: raise RuntimeError("Marché inactif.")
        amount=float(ex.amount_to_precision(symbol,amount))
        price=float(ex.price_to_precision(symbol,price))
        if amount<=0 or price<=0: raise ValueError("Quantité/prix arrondi à zéro.")
        limits=market.get("limits") or {}
        min_amount=(limits.get("amount") or {}).get("min")
        min_cost=(limits.get("cost") or {}).get("min")
        if min_amount and amount<float(min_amount): raise ValueError("Quantité sous le minimum du marché.")
        if min_cost and amount*price<float(min_cost): raise ValueError("Valeur notionnelle sous le minimum du marché.")
        # Limit order only. No automatic retry after ambiguous network failures.
        return ex.create_order(symbol,"limit",side,amount,price,{"clientOrderId":os.urandom(12).hex()})
    finally:
        try: ex.close()
        except Exception: pass
