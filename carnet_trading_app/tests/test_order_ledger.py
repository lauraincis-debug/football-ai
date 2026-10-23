import sqlite3
import pytest
import order_ledger as ol


@pytest.fixture
def con():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript(ol.SCHEMA)
    yield c
    c.close()


def test_intention_is_idempotent(con):
    ol.creer_intention(con, "cid-1", "crypto", "BTC/USDT", "buy", 0.1, 60000.0)
    with pytest.raises(ol.DuplicateIntentError):
        ol.creer_intention(con, "cid-1", "crypto", "BTC/USDT", "buy", 0.1, 60000.0)


def test_ambiguous_is_never_auto_resolved(con):
    ol.creer_intention(con, "cid-2", "mt5", "EURUSD", "buy", 0.1, None)
    ol.changer_statut(con, "cid-2", ol.SUBMITTED)
    ol.changer_statut(con, "cid-2", ol.AMBIGUOUS, erreur="timeout")
    # Pas de retour automatique vers submitted/filled depuis ambiguous
    with pytest.raises(ol.InvalidTransitionError):
        ol.changer_statut(con, "cid-2", ol.SUBMITTED)
    with pytest.raises(ol.InvalidTransitionError):
        ol.changer_statut(con, "cid-2", ol.FILLED)
    assert [i["client_order_id"] for i in ol.intentions_non_resolues(con)] == ["cid-2"]


def test_manual_resolution_closes_once(con):
    ol.creer_intention(con, "cid-3", "mt5", "EURUSD", "buy", 0.1, None)
    ol.changer_statut(con, "cid-3", ol.SUBMITTED)
    ol.changer_statut(con, "cid-3", ol.AMBIGUOUS)
    assert ol.resoudre_manuellement(con, "cid-3", "filled", "vu chez le courtier") == ol.RESOLVED_FILLED
    assert ol.intentions_non_resolues(con) == []
    with pytest.raises(ol.InvalidTransitionError):
        ol.resoudre_manuellement(con, "cid-3", "rejected")


def test_invalid_intention_rejected(con):
    with pytest.raises(ValueError):
        ol.creer_intention(con, "cid-4", "forex", "EURUSD", "buy", 0.1, None)
    with pytest.raises(ValueError):
        ol.creer_intention(con, "cid-5", "mt5", "EURUSD", "buy", 0, None)


def test_gate_reasons(con):
    assert ol.raisons_gel(con, False) == ["rapprochement_absent"]
    assert ol.raisons_gel(con, True)[0] == "arret_urgence"
    ol.enregistrer_rapport(con, True, {"ecarts": []})
    assert ol.raisons_gel(con, False) == []
    ol.enregistrer_rapport(con, False, {"ecarts": [{"code": "x"}]})
    assert ol.raisons_gel(con, False) == ["rapprochement_en_echec"]
    ol.creer_intention(con, "cid-6", "crypto", "BTC/USDT", "sell", 0.1, None)
    assert any(r.startswith("intentions_non_resolues") for r in ol.raisons_gel(con, False))
