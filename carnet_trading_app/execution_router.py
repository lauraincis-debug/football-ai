"""Unified routing layer for Forex (MT5) and crypto (CCXT)."""
from mt5_adapter import MetaTrader5Adapter
from crypto_adapter import CryptoAdapter
class ExecutionRouter:
    def __init__(self, mt5_adapter=None, crypto_adapter=None):
        self.mt5 = mt5_adapter or MetaTrader5Adapter()
        self.crypto = crypto_adapter or CryptoAdapter()
    def submit(self, venue: str, **order):
        if venue == "mt5":
            return self.mt5.place_market_order(**order)
        if venue == "crypto":
            return self.crypto.place_market_order_with_protection(**order)
        raise ValueError("venue doit être 'mt5' ou 'crypto'.")
    def reconcile(self, venue: str, **kwargs):
        if venue == "mt5":
            return self.mt5.reconcile_positions()
        if venue == "crypto":
            return self.crypto.reconcile(**kwargs)
        raise ValueError("venue doit être 'mt5' ou 'crypto'.")
