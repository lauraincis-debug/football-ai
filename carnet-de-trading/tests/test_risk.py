"""Tests exhaustifs du moteur de risque (section 6) — refus et dimensionnement."""

from __future__ import annotations

import datetime as dt
import unittest
from decimal import Decimal

from helpers import EngineTestCase

from carnet.config import DEFAULT_POLICY, FX_TO_ACCOUNT
from carnet.market import Quote
from carnet.risk import (
    OpenPositionRisk,
    RiskAccount,
    RiskContext,
    RiskEngine,
    RiskIntent,
    position_risk_amount,
)
from carnet.util import D, ZERO, now_utc


def quote(symbol: str, mid: str, spread_bps: str = "1", age: float = 0.0,
          crossed: bool = False) -> Quote:
    mid_decimal = D(mid)
    half = mid_decimal * D(spread_bps) / Decimal(20000)
    bid = mid_decimal - half
    ask = mid_decimal + half
    if crossed:
        bid, ask = ask, bid
    moment = now_utc() - dt.timedelta(seconds=age)
    return Quote(symbol=symbol, bid=bid, ask=ask, last=mid_decimal,
                 timestamp=moment, received_at=moment, source="test")


def context(**overrides) -> RiskContext:
    values = dict(
        policy=DEFAULT_POLICY,
        account=RiskAccount(currency="USD", balance=D("10000"), equity=D("10000"),
                            free_margin=D("10000"), margin_used=D("0"), leverage=30),
        quotes={
            "EURUSD": quote("EURUSD", "1.08750"),
            "BTCUSDT": quote("BTCUSDT", "67000"),
        },
        open_positions=(),
        daily_loss_pct=Decimal("0"),
        weekly_loss_pct=Decimal("0"),
        drawdown_pct=Decimal("0"),
        trades_today=0,
        market_open=True,
        suspended=False,
        kill_switch=False,
        conversion_rates=dict(FX_TO_ACCOUNT),
        reference_time=now_utc(),
    )
    values.update(overrides)
    return RiskContext(**values)


def intent(**overrides) -> RiskIntent:
    values = dict(symbol="EURUSD", side="BUY", entry=D("1.08750"), stop=D("1.08450"),
                  target=D("1.09350"), environment="SIMULATION")
    values.update(overrides)
    return RiskIntent(**values)


class RiskEngineTests(unittest.TestCase):
    def setUp(self):
        self.engine = RiskEngine()

    def evaluate(self, risk_intent=None, risk_context=None):
        return self.engine.evaluate(risk_intent or intent(), risk_context or context())

    # -- cas nominal -----------------------------------------------------
    def test_valid_order_is_sized_correctly(self):
        decision = self.evaluate()
        self.assertTrue(decision.allowed, decision.reasons)
        self.assertEqual(decision.code, "OK")
        # 0,5 % de 10 000 = 50 USD de risque ; 30 pips × 100 000 = 300 USD/lot
        self.assertEqual(decision.qty, Decimal("0.16"))
        self.assertEqual(decision.reward_risk, Decimal("2"))
        self.assertGreater(decision.notional, Decimal("17000"))
        self.assertLess(decision.margin_required, Decimal("1000"))
        self.assertLess(decision.latency_ms, 50)  # seuil du cahier des charges
        self.assertTrue(all(check["ok"] for check in [c.to_dict() for c in decision.checks]))

    def test_sell_order_is_accepted(self):
        decision = self.evaluate(intent(side="SELL", entry=D("1.08750"), stop=D("1.09050"),
                                        target=D("1.08150")))
        self.assertTrue(decision.allowed, decision.reasons)

    def test_crypto_spot_sizing_uses_full_notional_margin(self):
        decision = self.evaluate(intent(symbol="BTCUSDT", entry=D("67000"), stop=D("66000"),
                                        target=D("69000")))
        self.assertTrue(decision.allowed, decision.reasons)
        self.assertEqual(decision.margin_required, decision.notional)

    # -- refus -----------------------------------------------------------
    def test_unknown_symbol(self):
        self.assertEqual(self.evaluate(intent(symbol="XXXYYY")).code, "SYMBOL_UNKNOWN")

    def test_invalid_side(self):
        self.assertEqual(self.evaluate(intent(side="HOLD")).code, "SIDE_INVALID")

    def test_missing_quote(self):
        self.assertEqual(self.evaluate(intent(symbol="GBPUSD")).code, "QUOTE_MISSING")

    def test_stale_quote(self):
        decision = self.evaluate(risk_context=context(
            quotes={"EURUSD": quote("EURUSD", "1.08750", age=10)}))
        self.assertEqual(decision.code, "QUOTE_STALE")

    def test_crossed_quote(self):
        decision = self.evaluate(risk_context=context(
            quotes={"EURUSD": quote("EURUSD", "1.08750", crossed=True)}))
        self.assertEqual(decision.code, "QUOTE_INCOHERENT")

    def test_wide_spread(self):
        decision = self.evaluate(risk_context=context(
            quotes={"EURUSD": quote("EURUSD", "1.08750", spread_bps="40")}))
        self.assertEqual(decision.code, "SPREAD_TOO_WIDE")

    def test_market_closed(self):
        self.assertEqual(self.evaluate(risk_context=context(market_open=False)).code, "MARKET_CLOSED")

    def test_missing_stop_and_target(self):
        self.assertEqual(self.evaluate(intent(stop=None)).code, "MISSING_STOP")
        self.assertEqual(self.evaluate(intent(target=None)).code, "MISSING_TARGET")

    def test_invalid_stop_and_target(self):
        self.assertEqual(self.evaluate(intent(stop=D("1.09000"))).code, "INVALID_STOP")
        self.assertEqual(self.evaluate(intent(target=D("1.08000"))).code, "INVALID_TARGET")
        self.assertEqual(
            self.evaluate(intent(side="SELL", stop=D("1.08000"), target=D("1.09000"))).code,
            "INVALID_STOP")

    def test_stop_too_tight(self):
        decision = self.evaluate(intent(stop=D("1.087495"), target=D("1.09000")))
        self.assertEqual(decision.code, "STOP_TOO_TIGHT")

    def test_reward_risk_too_low(self):
        decision = self.evaluate(intent(stop=D("1.08450"), target=D("1.08800")))
        self.assertEqual(decision.code, "REWARD_RISK_TOO_LOW")

    def test_account_data_missing(self):
        decision = self.evaluate(risk_context=context(
            account=RiskAccount(currency="USD", balance=None, equity=None, free_margin=None)))
        self.assertEqual(decision.code, "ACCOUNT_DATA_MISSING")

    def test_conversion_missing(self):
        decision = self.evaluate(
            intent(symbol="USDJPY", entry=D("151.250"), stop=D("150.250"), target=D("153.250")),
            context(conversion_rates={},
                    quotes={"USDJPY": quote("USDJPY", "151.250")}))
        self.assertEqual(decision.code, "CONVERSION_MISSING")

    def test_size_too_small(self):
        decision = self.evaluate(risk_context=context(
            account=RiskAccount(currency="USD", balance=D("20"), equity=D("20"),
                                free_margin=D("20"))))
        self.assertEqual(decision.code, "SIZE_TOO_SMALL")

    def test_insufficient_margin(self):
        decision = self.evaluate(risk_context=context(
            account=RiskAccount(currency="USD", balance=D("10000"), equity=D("10000"),
                                free_margin=D("100"))))
        self.assertEqual(decision.code, "INSUFFICIENT_MARGIN")

    def test_notional_limit(self):
        policy = DEFAULT_POLICY.with_changes({"max_order_notional_pct": D("50")})
        decision = self.evaluate(risk_context=context(policy=policy))
        self.assertEqual(decision.code, "NOTIONAL_LIMIT")

    def test_max_positions(self):
        positions = tuple(OpenPositionRisk(f"P{i}", "EURUSD", D("0.1"), D("10"), "USD_MAJORS")
                          for i in range(3))
        decision = self.evaluate(risk_context=context(open_positions=positions))
        self.assertEqual(decision.code, "MAX_POSITIONS")

    def test_open_risk_limit(self):
        positions = (OpenPositionRisk("P1", "EURUSD", D("0.1"), D("140"), "USD_MAJORS"),)
        decision = self.evaluate(risk_context=context(open_positions=positions))
        self.assertEqual(decision.code, "OPEN_RISK_LIMIT")

    def test_group_risk_limit(self):
        positions = (OpenPositionRisk("P1", "GBPUSD", D("0.1"), D("90"), "USD_MAJORS"),)
        decision = self.evaluate(risk_context=context(open_positions=positions))
        self.assertEqual(decision.code, "GROUP_RISK_LIMIT")

    def test_daily_loss_limit(self):
        decision = self.evaluate(risk_context=context(daily_loss_pct=Decimal("2.5")))
        self.assertEqual(decision.code, "DAILY_LOSS_LIMIT")

    def test_weekly_loss_limit(self):
        decision = self.evaluate(risk_context=context(weekly_loss_pct=Decimal("5.5")))
        self.assertEqual(decision.code, "WEEKLY_LOSS_LIMIT")

    def test_drawdown_limit(self):
        decision = self.evaluate(risk_context=context(drawdown_pct=Decimal("11")))
        self.assertEqual(decision.code, "DRAWDOWN_LIMIT")

    def test_daily_trades_limit(self):
        decision = self.evaluate(risk_context=context(trades_today=12))
        self.assertEqual(decision.code, "DAILY_TRADES_LIMIT")

    def test_price_deviation(self):
        decision = self.evaluate(
            intent(entry=D("1.08000"), stop=D("1.07700"), target=D("1.08600")))
        self.assertEqual(decision.code, "PRICE_DEVIATION")

    def test_kill_switch_and_suspension(self):
        self.assertEqual(self.evaluate(risk_context=context(kill_switch=True)).code, "KILL_SWITCH")
        self.assertEqual(
            self.evaluate(risk_context=context(suspended=True)).code, "TRADING_SUSPENDED")
        self.assertEqual(
            self.evaluate(risk_context=context(suspended=True, suspension_reason="DAILY_LOSS_LIMIT")).code,
            "DAILY_LOSS_LIMIT")

    def test_real_mode_forbidden(self):
        self.assertEqual(self.evaluate(intent(environment="REAL_AUTO")).code, "REAL_MODE_FORBIDDEN")

    def test_signal_stale(self):
        old = now_utc() - dt.timedelta(seconds=30)
        decision = self.evaluate(intent(signal_time=old))
        self.assertEqual(decision.code, "SIGNAL_STALE")

    def test_costs_exceed_risk(self):
        policy = DEFAULT_POLICY.with_changes({"max_order_notional_pct": D("3000")})
        decision = self.evaluate(
            risk_context=context(policy=policy,
                                 quotes={"EURUSD": quote("EURUSD", "1.08750", spread_bps="24")}),
            risk_intent=intent(stop=D("1.08650"), target=D("1.08950")))
        self.assertEqual(decision.code, "COSTS_EXCEED_RISK")

    def test_spec_incomplete(self):
        from carnet import config

        spec = config.SYMBOLS["EURUSD"]
        broken = type(spec)(**{**spec.__dict__, "tick_size": Decimal("0")})
        original = config.SYMBOLS["EURUSD"]
        config.SYMBOLS["EURUSD"] = broken
        try:
            decision = self.evaluate()
            self.assertEqual(decision.code, "SPEC_INCOMPLETE")
        finally:
            config.SYMBOLS["EURUSD"] = original

    def test_policy_shapes_sizing(self):
        policy = DEFAULT_POLICY.with_changes({"max_risk_per_trade_pct": D("0.25")})
        decision = self.evaluate(risk_context=context(policy=policy))
        self.assertTrue(decision.allowed)
        self.assertEqual(decision.qty, Decimal("0.08"))

    def test_decisions_are_traceable(self):
        decision = self.evaluate()
        dumped = decision.to_dict()
        self.assertIn("checks", dumped)
        self.assertGreater(len(dumped["checks"]), 10)
        self.assertIn("message", dumped)

    def test_latency_under_threshold_on_many_runs(self):
        for _ in range(200):
            decision = self.evaluate()
            self.assertLess(decision.latency_ms, 50)


class PositionRiskTests(unittest.TestCase):
    def test_position_risk_amount(self):
        amount = position_risk_amount("EURUSD", D("0.5"), D("1.0875"), D("1.0825"), "USD", FX_TO_ACCOUNT)
        self.assertEqual(amount, Decimal("250.00"))

    def test_position_risk_without_stop(self):
        self.assertEqual(position_risk_amount("EURUSD", D("0.5"), D("1.0875"), None), Decimal("0"))


if __name__ == "__main__":
    unittest.main()


class RiskStateStoreTests(unittest.TestCase):
    """État de risque persistant : aucune limite ne se réarme au redémarrage."""

    def setUp(self):
        from helpers import TempProject

        from carnet.db import Database
        from carnet.risk import RiskStateStore

        self.project = TempProject()
        self.addCleanup(self.project.cleanup)
        self.db = Database(self.project.path / "risk.sqlite3")
        self.db.migrate()
        self.store = RiskStateStore(self.db, DEFAULT_POLICY)

    def test_load_ignores_unknown_keys(self):
        import json

        from carnet.risk import RiskStateStore

        self.db.execute(
            "INSERT INTO settings_kv(key, value, updated_at) VALUES(?,?,?)",
            (RiskStateStore.KEY, json.dumps({"cle_inconnue": 1, "trades_today": 4,
                                             "day_anchor_equity": "10000"}), "2026-11-01T00:00:00Z"))
        store = RiskStateStore(self.db, DEFAULT_POLICY)
        self.assertEqual(store.state.trades_today, 4)
        self.assertEqual(store.state.day_anchor_equity, D("10000"))
        self.assertFalse(hasattr(store.state, "cle_inconnue"))

    def test_equity_observation_and_percentages(self):
        self.store.observe_equity(D("10000"))
        self.store.observe_equity(D("9800"))
        self.assertEqual(self.store.state.peak_equity, D("10000"))
        self.assertEqual(self.store.state.day_anchor_equity, D("10000"))
        self.assertEqual(self.store.daily_loss_pct(), D("2"))
        self.assertEqual(self.store.drawdown_pct(), D("2"))

    def test_percentages_are_zero_without_data(self):
        from carnet.risk import RiskStateStore

        empty = RiskStateStore(self.db, DEFAULT_POLICY).state
        empty.last_equity = None
        empty.day_anchor_equity = None
        empty.week_anchor_equity = None
        empty.peak_equity = None
        self.assertEqual(self.store.daily_loss_pct(None), ZERO)
        self.assertEqual(self.store.weekly_loss_pct(None), ZERO)
        self.assertEqual(self.store.drawdown_pct(None), ZERO)

    def test_daily_roll_clears_daily_suspension_only(self):
        self.store.observe_equity(D("10000"))
        self.store.suspend("DAILY_LOSS_LIMIT")
        self.store.state.day_key = "2000-01-01"
        changed, _ = self.store.roll(now_utc())
        self.assertTrue(changed)
        self.assertFalse(self.store.state.suspended)
        self.assertEqual(self.store.state.suspension_reason, "")
        self.assertEqual(self.store.state.trades_today, 0)

    def test_daily_roll_keeps_kill_switch(self):
        self.store.observe_equity(D("10000"))
        self.store.suspend("KILL_SWITCH")
        self.store.engage_kill_switch()
        self.store.state.day_key = "2000-01-01"
        self.store.roll(now_utc())
        self.assertTrue(self.store.state.suspended)
        self.assertTrue(self.store.state.kill_switch)

    def test_kill_switch_persistence(self):
        from carnet.risk import RiskStateStore

        self.store.engage_kill_switch()
        self.assertIsNotNone(self.store.state.kill_switch_at)
        reloaded = RiskStateStore(self.db, DEFAULT_POLICY)
        self.assertTrue(reloaded.state.kill_switch)
        reloaded.release_kill_switch()
        self.assertFalse(RiskStateStore(self.db, DEFAULT_POLICY).state.kill_switch)

    def test_register_trade_and_snapshot(self):
        self.store.observe_equity(D("10000"))
        self.store.register_trade()
        self.store.register_trade()
        self.assertEqual(self.store.state.trades_today, 2)
        snapshot = self.store.snapshot(D("10000"))
        for key in ("state", "daily_loss_pct", "weekly_loss_pct", "drawdown_pct"):
            self.assertIn(key, snapshot)
        self.assertEqual(snapshot["state"]["trades_today"], 2)


class RiskEditionTests(unittest.TestCase):
    """Compléments : branches de refus restantes et cas limites."""

    def setUp(self):
        self.engine = RiskEngine()

    def evaluate(self, risk_intent=None, risk_context=None):
        return self.engine.evaluate(risk_intent or intent(), risk_context or context())

    def test_insufficient_balance(self):
        decision = self.evaluate(risk_context=context(
            account=RiskAccount(currency="USD", balance=ZERO, equity=ZERO, free_margin=ZERO)))
        self.assertEqual(decision.code, "INSUFFICIENT_BALANCE")

    def test_quote_without_timestamp_is_missing(self):
        broken = Quote(symbol="EURUSD", bid=D("1.0874"), ask=D("1.0876"), last=D("1.0875"),
                       timestamp=None, received_at=None)
        decision = self.evaluate(risk_context=context(quotes={"EURUSD": broken}))
        self.assertEqual(decision.code, "QUOTE_MISSING")

    def test_fresh_signal_passes(self):
        decision = self.evaluate(intent(signal_time=now_utc(), signal_id="sig-frais"))
        self.assertTrue(decision.allowed, decision.reasons)

    def test_zero_entry_is_refused(self):
        decision = self.evaluate(intent(entry=ZERO))
        self.assertIn(decision.code, ("QUOTE_INCOHERENT", "INVALID_STOP"))

    def test_sell_invalid_target(self):
        decision = self.evaluate(intent(side="SELL", stop=D("1.09050"), target=D("1.09000")))
        self.assertEqual(decision.code, "INVALID_TARGET")

    def test_explicit_quantity_is_quantized_and_bounded(self):
        decision = self.evaluate(intent(qty=D("0.05")))
        self.assertTrue(decision.allowed, decision.reasons)
        self.assertEqual(decision.qty, Decimal("0.05"))
        too_big = self.evaluate(intent(qty=D("99")))
        self.assertEqual(too_big.code, "SIZE_ABOVE_MAX")
        over_budget = self.evaluate(intent(qty=D("0.50")))
        self.assertEqual(over_budget.code, "SIZE_ABOVE_MAX")

    def test_usd_base_symbol_is_notional_in_account_currency(self):
        decision = self.evaluate(
            intent(symbol="USDJPY", entry=D("151.250"), stop=D("150.250"), target=D("155.000")),
            context(conversion_rates={"JPY": D("0.0067")},
                    quotes={"USDJPY": quote("USDJPY", "151.250")}))
        self.assertTrue(decision.allowed, decision.reasons)
        self.assertGreater(decision.notional, ZERO)

    def test_correlation_groups(self):
        from carnet.risk import correlation_group

        self.assertTrue(correlation_group("EURUSD"))
        self.assertEqual(correlation_group("EURUSD"), correlation_group("GBPUSD"))
        self.assertEqual(correlation_group("INCONNU"), "")

    def test_position_risk_unknown_symbol(self):
        self.assertEqual(position_risk_amount("INCONNU", D("1"), D("1"), D("0.9")), ZERO)
