from reconciliation import InstantaneCourtier, rapprocher


def test_identical_states_are_ok():
    rep = rapprocher({"EURUSD": 0.1}, ["o1"], InstantaneCourtier({"EURUSD": 0.1}, frozenset({"o1"})))
    assert rep.ok and rep.ecarts == ()


def test_position_mismatch_detected():
    rep = rapprocher({"EURUSD": 0.1}, [], InstantaneCourtier({"EURUSD": 0.2}))
    assert not rep.ok and rep.ecarts[0].code == "position_ecart"


def test_unknown_broker_order_detected():
    rep = rapprocher({}, [], InstantaneCourtier({}, frozenset({"ghost"})))
    assert [e.code for e in rep.ecarts] == ["ordre_inconnu_local"]


def test_local_order_missing_at_broker_detected():
    rep = rapprocher({}, ["o2"], InstantaneCourtier({}))
    assert [e.code for e in rep.ecarts] == ["ordre_local_absent_chez_courtier"]


def test_unresolved_intentions_block_ok():
    rep = rapprocher({}, [], InstantaneCourtier({}), intentions_non_resolues=["cid-9"])
    assert not rep.ok and rep.ecarts[0].code == "intention_non_resolue"
    assert rep.to_dict()["ok"] is False
