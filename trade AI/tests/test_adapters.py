import os
from types import SimpleNamespace
import pytest
from mt5_adapter import MetaTrader5Adapter, BrokerError
from crypto_adapter import CryptoAdapter, CryptoBrokerError
class FakeMT5:
    TRADE_ACTION_DEAL=1; ORDER_TYPE_BUY=0; ORDER_TYPE_SELL=1; ORDER_TIME_GTC=0
    ORDER_FILLING_IOC=1; TRADE_RETCODE_DONE=10009; TRADE_RETCODE_DONE_PARTIAL=10010
    ACCOUNT_TRADE_MODE_DEMO=0
    def __init__(self): self.request=None
    def initialize(self, **kwargs): return True
    def shutdown(self): pass
    def account_info(self): return SimpleNamespace(trade_mode=0)
    def symbol_select(self, symbol, enabled): return True
    def symbol_info(self, symbol): return SimpleNamespace(volume_step=0.01,volume_min=0.01,volume_max=100
    ,digits=5,filling_mode=1)
    def symbol_info_tick(self, symbol): return SimpleNamespace(ask=1.1000,bid=1.0998)
    def order_check(self, req): return SimpleNamespace(retcode=0,comment="ok")
    def order_send(self, req):
        self.request=req
        return SimpleNamespace(retcode=10009,order=123,deal=456,comment="done")
    def positions_get(self, **kwargs): return [SimpleNamespace(ticket=123,symbol="EURUSD",type=0,volume=0.1,price_open=1.1,sl=1.09,tp=1.12,profit=0,magic=620261,comment="CarnetTrading")]
    def last_error(self): return (0,"ok")
def set_live_env(monkeypatch, prefix=None):

    for k,v in {"LIVE_TRADING_ENABLED":"true","LIVE_ORDER_CONFIRMATION":"I_ACCEPT_REAL_FINANCIAL_RISK","REAL_TRADING_REVIEWED":"true","MT5_LIVE_ENABLED":"true","CRYPTO_LIVE_ENABLED":"true"}.items(): monkeypatch.setenv(k,v)
def test_mt5_requires_live_gates(monkeypatch):
    monkeypatch.setenv("LIVE_TRADING_ENABLED","false")
    with pytest.raises(BrokerError): MetaTrader5Adapter(FakeMT5()).place_market_order("EURUSD","buy",0.1,
    1.09)
def test_mt5_sends_native_sl_tp_and_reconciles(monkeypatch):
    set_live_env(monkeypatch)
    fake=FakeMT5(); result=MetaTrader5Adapter(fake).place_market_order("EURUSD","buy",0.1,1.09,1.12)
    assert fake.request["sl"] == 1.09 and fake.request["tp"] == 1.12
    assert result["status"] == "accepted_protected"
def test_mt5_rejects_bad_stop(monkeypatch):
    set_live_env(monkeypatch)
    with pytest.raises(ValueError): MetaTrader5Adapter(FakeMT5()).place_market_order("EURUSD","buy",0.1,1.11)
class FakeCrypto:
    has={"fetchOpenOrders":True,"fetchPositions":False}
    def __init__(self, supports=True): self.supports=supports; self.params=None
    def load_markets(self): pass
    def market(self,symbol): return {"active":True}
    def feature_value(self,symbol,method,feature): return self.supports
    def amount_to_precision(self,symbol,amount): return str(amount)
    def price_to_precision(self,symbol,price): return str(price)
    def create_order(self,*args): self.params=args[-1]; return {"id":"abc"}
    def close(self): pass
    def fetch_open_orders(self,symbol=None): return []
    def fetch_balance(self): return {"USDT":{"free":100}}
def test_crypto_requires_attached_stop_support(monkeypatch):
    set_live_env(monkeypatch)
    with pytest.raises(CryptoBrokerError): CryptoAdapter(FakeCrypto(False)).place_market_order_with_protection("BTC/USDT","buy",0.01,60000)
def test_crypto_uses_attached_protection(monkeypatch):
    set_live_env(monkeypatch)
    fake=FakeCrypto(True)
    out=CryptoAdapter(fake).place_market_order_with_protection("BTC/USDT","buy",0.01,60000,70000)
    assert out["status"] == "submitted_with_attached_protection"
    assert fake.params["stopLoss"]["triggerPrice"] == 60000
    assert fake.params["takeProfit"]["triggerPrice"] == 70000
def test_crypto_does_not_retry_or_fallback_unprotected(monkeypatch):
    set_live_env(monkeypatch)
    class Broken(FakeCrypto):
        def create_order(self,*args): raise TimeoutError("ambiguous")
    with pytest.raises(CryptoBrokerError, match="ambigu"):
        CryptoAdapter(Broken(True)).place_market_order_with_protection("BTC/USDT","buy",0.01,60000)
