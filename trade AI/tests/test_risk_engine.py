import pytest
from risk_engine import EtatRisque, Proposition, evaluer_nouveau_trade, risque_du_trade

LIMITES = {
    "capital_alloue": 500.0, "risque_par_trade": 0.005, "perte_max_jour": 0.02,
    "perte_max_semaine": 0.05, "drawdown_max": 0.10, "levier_max": 1.0,
    "pertes_consecutives_max": 3, "trades_max_jour": 3,
}


def etat(**kw):
    base = dict(capital=500.0, day_pnl=0.0, week_pnl=0.0, drawdown=0.0,
                losses_in_row=0, trades_today=0, emergency_stop=False)
    base.update(kw)
    return EtatRisque(**base)


def prop(**kw):
    base = dict(instrument="BTCUSDT", side="long", entry=100.0, stop=99.5, quantity=2.0)
    base.update(kw)
    return Proposition(**base)


def codes(vs):
    return [v.code for v in vs]


def test_trade_acceptable_has_no_violation():
    assert evaluer_nouveau_trade(prop(), etat(), LIMITES) == []


def test_risk_amount_is_stop_distance_times_quantity():
    assert risque_du_trade(prop()) == pytest.approx(1.0)


def test_emergency_stop_is_first_and_http_423():
    vs = evaluer_nouveau_trade(prop(), etat(emergency_stop=True, trades_today=9), LIMITES)
    assert vs[0].code == "arret_urgence" and vs[0].http_status == 423


def test_daily_trade_cap():
    assert "trades_max_jour" in codes(evaluer_nouveau_trade(prop(), etat(trades_today=3), LIMITES))


def test_consecutive_losses_cap():
    assert "pertes_consecutives" in codes(evaluer_nouveau_trade(prop(), etat(losses_in_row=3), LIMITES))


def test_daily_and_weekly_loss_caps():
    vs = codes(evaluer_nouveau_trade(prop(), etat(day_pnl=-10.0, week_pnl=-25.0), LIMITES))
    assert "perte_max_jour" in vs and "perte_max_semaine" in vs


def test_drawdown_cap():
    assert "drawdown_max" in codes(evaluer_nouveau_trade(prop(), etat(drawdown=0.10), LIMITES))


def test_risk_per_trade_cap():
    vs = evaluer_nouveau_trade(prop(stop=90.0, quantity=2.0), etat(), LIMITES)  # risque 20 > 2.5
    assert codes(vs) == ["risque_par_trade"] and vs[0].http_status == 409


def test_leverage_cap():
    # exposition 100*12 = 1200 > capital 500 * levier 1 ; risque 12*0.5 = 6 > 2.5 donc aussi risque
    vs = codes(evaluer_nouveau_trade(prop(quantity=12.0), etat(), LIMITES))
    assert "levier_max" in vs


def test_short_stop_must_be_above_entry():
    vs = evaluer_nouveau_trade(prop(side="short", stop=99.0), etat(), LIMITES)
    assert "stop_invalide" in codes(vs)


def test_instrument_whitelist_when_configured():
    vs = evaluer_nouveau_trade(prop(instrument="DOGEUSDT"), etat(), LIMITES, instruments_autorises=["BTCUSDT"])
    assert codes(vs) == ["instrument_non_autorise"]
    assert evaluer_nouveau_trade(prop(), etat(), LIMITES, instruments_autorises=["btcusdt"]) == []


def test_zero_capital_blocks():
    assert "capital_epuise" in codes(evaluer_nouveau_trade(prop(), etat(capital=0.0), LIMITES))
