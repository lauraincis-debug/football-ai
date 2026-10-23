from fastapi.testclient import TestClient
import os, tempfile

os.environ["JWT_SECRET"]="x"*48
os.environ["APP_PASSWORD_HASH"]="$argon2id$v=19$m=65536,t=3,p=4$not-a-real-hash"
os.environ["TOTP_SECRET"]="JBSWY3DPEHPK3PXP"
from src_main import app, validate_limits, DEFAULT_LIMITS, ABSOLUTE
from fastapi import HTTPException
import pytest
def test_default_limits_inside_absolute_bounds():
    for key, value in DEFAULT_LIMITS.items():
        lo, hi = ABSOLUTE[key]
        assert lo <= value <= hi
def test_risk_limit_rejects_excess():
    bad = dict(DEFAULT_LIMITS)
    bad["risque_par_trade"] = 0.5
    with pytest.raises(HTTPException):
        validate_limits(bad)
def test_daily_trade_limit_cannot_exceed_absolute():
    bad = dict(DEFAULT_LIMITS)
    bad["trades_max_jour"] = 6
    with pytest.raises(HTTPException):
        validate_limits(bad)
