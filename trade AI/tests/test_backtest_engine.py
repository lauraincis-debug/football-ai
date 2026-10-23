import pandas as pd
import numpy as np
import pytest
from backtest_engine import validate_ohlcv, sma_cross_signals, BacktestConfig, run_validation
def sample(n=500):
    ts=pd.date_range("2024-01-01",periods=n,freq="h",tz="UTC")
    close=100+np.cumsum(np.sin(np.arange(n)/8)*0.3+0.02)
    op=np.r_[close[0],close[:-1]]
    high=np.maximum(op,close)+0.3
    low=np.minimum(op,close)-0.3
    return pd.DataFrame({"timestamp":ts,"open":op,"high":high,"low":low,"close":close,"volume":np.ones(n)
    *10})
def test_valid_ohlcv():
    assert len(validate_ohlcv(sample()))==500
def test_duplicate_timestamp_rejected():
    d=sample(); d.loc[5,"timestamp"]=d.loc[4,"timestamp"]
    with pytest.raises(ValueError): validate_ohlcv(d)
def test_bad_ohlc_rejected():
    d=sample(); d.loc[10,"high"]=1
    with pytest.raises(ValueError): validate_ohlcv(d)
def test_negative_volume_rejected():
    d=sample(); d.loc[10,"volume"]=-1
    with pytest.raises(ValueError): validate_ohlcv(d)
def test_unsorted_timestamps_rejected():
    d=sample(); d.loc[10,"timestamp"],d.loc[11,"timestamp"]=d.loc[11,"timestamp"],d.loc[10,"timestamp"]
    with pytest.raises(ValueError): validate_ohlcv(d)
def test_signals_are_same_for_truncated_prefix():
    d=sample()
    a=sma_cross_signals(d,10,30)
    b=sma_cross_signals(d.iloc[:200],10,30)
    pd.testing.assert_series_equal(a.iloc[:200].reset_index(drop=True),b.reset_index(drop=True))
def test_walk_forward_report_sections():
    report=run_validation(sample(),BacktestConfig())
    assert report["data"]["data_validation"]=="passed"
    assert "out_of_sample_test" in report
    assert "robustness_nearby_parameters" in report
