"""Rapprochement branché aux adaptateurs : lectures simulées, fail-closed, isolation par venue."""
import sqlite3

import pyotp
import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient

import order_ledger as ol
import reconciliation_runner as rr


@pytest.fixture
def con():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript(ol.SCHEMA)
    yield c
    c.close()


def intention(con, cid, venue, symbol, side, qty, broker_id=None, final=None):
    ol.creer_intention(con, cid, venue, symbol, side, qty, None)
    ol.changer_statut(con, cid, ol.SUBMITTED, broker_order_id=broker_id)
    if final == "filled":
        ol.changer_statut(con, cid, ol.FILLED)


def codes(rep):
    return [e["code"] for e in rep["ecarts"]]


def test_mt5_matching_positions_are_ok(con):
    intention(con, "a", "mt5", "EURUSD", "buy", 0.1, "100", final="filled")
    lecteur = lambda v: {"positions": [{"symbol": "EURUSD", "volume": 0.1, "type": 0}]}
    rep = rr.executer(con, "mt5", lecteur)
    assert rep["ok"] is True and rep["ecarts"] == []


def test_mt5_volume_mismatch_detected(con):
    intention(con, "a", "mt5", "EURUSD", "buy", 0.1, "100", final="filled")
    lecteur = lambda v: {"positions": [{"symbol": "EURUSD", "volume": 0.2, "type": 0}]}
    rep = rr.executer(con, "mt5", lecteur)
    assert rep["ok"] is False and "position_ecart" in codes(rep)


def test_mt5_short_position_is_negative(con):
    intention(con, "s", "mt5", "GBPUSD", "sell", 0.3, final="filled")
    lecteur = lambda v: {"positions": [{"symbol": "GBPUSD", "volume": 0.3, "type": 1}]}
    assert rr.executer(con, "mt5", lecteur)["ok"] is True


def test_unreachable_broker_fails_closed(con):
    def lecteur(v):
        raise ConnectionError("timeout")
    rep = rr.executer(con, "crypto", lecteur)
    assert rep["ok"] is False and codes(rep) == ["courtier_injoignable"]


def test_default_readers_fail_closed_without_credentials(con, monkeypatch):
    for k in ("CRYPTO_EXCHANGE_ID", "CRYPTO_API_KEY", "CRYPTO_API_SECRET"):
        monkeypatch.delenv(k, raising=False)
    assert rr.executer(con, "crypto")["ok"] is False
    rep = rr.executer(con, "mt5")  # MetaTrader5 absent hors Windows
    assert rep["ok"] is False and codes(rep) == ["courtier_injoignable"]


def test_crypto_spot_cannot_verify_local_positions(con):
    intention(con, "c", "crypto", "BTC/USDT", "buy", 0.1, "o-1", final="filled")
    lecteur = lambda v: {"open_orders": [], "balances": {}, "positions": None}
    rep = rr.executer(con, "crypto", lecteur)
    assert rep["ok"] is False and "positions_non_verifiables" in codes(rep)


def test_crypto_open_orders_compared_by_id(con):
    intention(con, "c2", "crypto", "BTC/USDT", "buy", 0.1, "o-42")  # submitted, ouvert côté local
    # Ordre reconnu des deux côtés : aucun écart d'identifiant. Il reste toutefois une intention 'submitted'
    # non résolue, donc le rapport reste en échec (choix conservateur : pas d'état « ouvert » implicite).
    ok = rr.executer(con, "crypto", lambda v: {"open_orders": [{"id": "o-42"}], "positions": None})
    assert not {"ordre_inconnu_local", "ordre_local_absent_chez_courtier"} & set(codes(ok))
    assert "intention_non_resolue" in codes(ok)
    ko = rr.executer(con, "crypto", lambda v: {"open_orders": [{"id": "ghost"}], "positions": None})
    assert ko["ok"] is False and "ordre_inconnu_local" in codes(ko)


def test_venues_are_isolated(con):
    intention(con, "c3", "crypto", "BTC/USDT", "buy", 0.1, "o-9", final="filled")
    rep = rr.executer(con, "mt5", lambda v: {"positions": []})
    assert rep["ok"] is True and rep["positions_locales"] == {}


def test_unresolved_intention_of_venue_blocks_ok(con):
    intention(con, "amb", "mt5", "EURUSD", "buy", 0.1, "7")
    ol.changer_statut(con, "amb", ol.AMBIGUOUS)
    rep = rr.executer(con, "mt5", lambda v: {"positions": []})
    assert rep["ok"] is False and "intention_non_resolue" in codes(rep)


# --- API ---------------------------------------------------------------------------------------
PASSWORD = "test-password-123"
TOTP = "JBSWY3DPEHPK3PXP"


@pytest.fixture
def client(tmp_path, monkeypatch):
    import src_main
    monkeypatch.setattr(src_main, "DB_PATH", str(tmp_path / "r.db"))
    monkeypatch.setattr(src_main, "JWT_SECRET", "x" * 48)
    monkeypatch.setattr(src_main, "TOTP_SECRET", TOTP)
    monkeypatch.setenv("APP_PASSWORD_HASH", PasswordHasher().hash(PASSWORD))
    with TestClient(src_main.app) as c:
        r = c.post("/api/connexion", json={"password": PASSWORD, "totp_code": pyotp.TOTP(TOTP).now()})
        assert r.status_code == 200, r.text
        c.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
        c.src = src_main
        yield c


def test_api_run_persists_report_and_clears_absence_gate(client, monkeypatch):
    monkeypatch.setattr(client.src, "LECTEUR_COURTIER", lambda v: {"positions": []})
    r = client.post("/api/rapprochements/executer", json={"venue": "mt5"})
    assert r.status_code == 200 and r.json()["ok"] is True
    gel = client.get("/api/etat").json()["gel_envois"]
    assert "rapprochement_absent" not in gel
    assert client.get("/api/rapprochements").json()[0]["status"] == "ok"


def test_api_failed_run_keeps_gate_closed(client, monkeypatch):
    def lecteur(v):
        raise RuntimeError("courtier indisponible")
    monkeypatch.setattr(client.src, "LECTEUR_COURTIER", lecteur)
    r = client.post("/api/rapprochements/executer", json={"venue": "crypto"})
    assert r.json()["ok"] is False
    assert "rapprochement_en_echec" in client.get("/api/etat").json()["gel_envois"]


def test_api_rejects_unknown_venue(client):
    assert client.post("/api/rapprochements/executer", json={"venue": "forex"}).status_code == 422


def test_api_real_default_reader_is_fail_closed(client, monkeypatch):
    for k in ("CRYPTO_EXCHANGE_ID", "CRYPTO_API_KEY", "CRYPTO_API_SECRET"):
        monkeypatch.delenv(k, raising=False)
    r = client.post("/api/rapprochements/executer", json={"venue": "crypto"})
    assert r.status_code == 200 and r.json()["ok"] is False
