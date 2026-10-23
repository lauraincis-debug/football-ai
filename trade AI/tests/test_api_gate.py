"""Intégration API : gel des envois, résolution manuelle, blocage du réel maintenu."""
import pyotp
import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient

import src_main
from src_main import app
import order_ledger as ol
import reconciliation as rec

PASSWORD = "test-password-123"
TOTP = "JBSWY3DPEHPK3PXP"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(src_main, "DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setattr(src_main, "JWT_SECRET", "x" * 48)
    monkeypatch.setattr(src_main, "TOTP_SECRET", TOTP)
    monkeypatch.setenv("APP_PASSWORD_HASH", PasswordHasher().hash(PASSWORD))
    with TestClient(app) as c:
        code = pyotp.TOTP(TOTP).now()
        r = c.post("/api/connexion", json={"password": PASSWORD, "totp_code": code})
        assert r.status_code == 200, r.text
        c.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
        yield c


def test_fresh_state_is_frozen_until_reconciliation(client):
    etat = client.get("/api/etat").json()
    assert "rapprochement_absent" in etat["gel_envois"]
    assert etat["dernier_rapprochement"] is None


def test_emergency_stop_blocks_paper_trade_with_423(client):
    assert client.post("/api/arret-urgence", json={"confirmation": "ARRETER"}).status_code == 200
    r = client.post("/api/transactions", json={"instrument": "btcusdt", "side": "long", "entry": 100,
                                               "stop": 99.5, "quantity": 1})
    assert r.status_code == 423
    assert "arret_urgence" in client.get("/api/etat").json()["gel_envois"]


def test_paper_trade_still_works_and_risk_violation_is_409(client):
    ok = client.post("/api/transactions", json={"instrument": "btcusdt", "side": "long", "entry": 100,
                                                "stop": 99.5, "quantity": 2})
    assert ok.status_code == 200 and ok.json()["risk_usd"] == 1.0
    bad = client.post("/api/transactions", json={"instrument": "btcusdt", "side": "long", "entry": 100,
                                                 "stop": 90, "quantity": 2})
    assert bad.status_code == 409


def test_ambiguous_intention_freezes_and_manual_resolution_unfreezes(client, tmp_path):
    with src_main.db() as c:
        ol.creer_intention(c, "cid-amb", "crypto", "BTC/USDT", "buy", 0.1, 60000.0)
        ol.changer_statut(c, "cid-amb", ol.SUBMITTED)
        ol.changer_statut(c, "cid-amb", ol.AMBIGUOUS, erreur="timeout réseau")
        ol.enregistrer_rapport(c, True, {"ecarts": []})
    etat = client.get("/api/etat").json()
    assert any(r.startswith("intentions_non_resolues") for r in etat["gel_envois"])
    assert [i["client_order_id"] for i in etat["intentions_non_resolues"]] == ["cid-amb"]

    # Confirmation absente ou fausse : refusée
    assert client.post("/api/intentions/cid-amb/resoudre",
                       json={"issue": "filled", "confirmation": "oui"}).status_code == 400
    r = client.post("/api/intentions/cid-amb/resoudre",
                    json={"issue": "filled", "confirmation": "RESOUDRE", "note": "vérifié chez le courtier"})
    assert r.status_code == 200 and r.json()["statut"] == "resolved_filled"
    assert client.post("/api/intentions/cid-amb/resoudre",
                       json={"issue": "filled", "confirmation": "RESOUDRE"}).status_code == 409
    assert client.post("/api/intentions/inconnu/resoudre",
                       json={"issue": "filled", "confirmation": "RESOUDRE"}).status_code == 404
    gel = client.get("/api/etat").json()["gel_envois"]
    assert not any(r.startswith("intentions_non_resolues") for r in gel)
    assert gel == []


def test_real_order_endpoint_remains_locked_503(client):
    with src_main.db() as c:
        ol.enregistrer_rapport(c, True, {"ecarts": []})
    r = client.post("/api/live/order", json={"symbol": "BTC/USDT", "side": "buy", "amount": 0.1,
                                             "price": 1, "stop_price": 0.9})
    assert r.status_code == 503


def test_intentions_and_reports_are_listed(client):
    with src_main.db() as c:
        ol.enregistrer_rapport(c, False, rec.rapprocher({"A": 1.0}, [], rec.InstantaneCourtier({})).to_dict())
    rapports = client.get("/api/rapprochements").json()
    assert rapports[0]["status"] == "echec"
    assert rapports[0]["details"]["ecarts"][0]["code"] == "position_ecart"
    assert client.get("/api/intentions").json() == []
