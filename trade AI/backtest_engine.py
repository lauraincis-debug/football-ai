"""Backtest event-driven with OHLC validation, fees, slippage, chronological holdout and robustness diagnostics.
Research tool only: a passing test suite does not prove profitability or certify production readiness.
"""
from __future__ import annotations
import math
from dataclasses import dataclass, asdict
from typing import Iterable
import numpy as np
import pandas as pd
REQUIRED = ("open", "high", "low", "close", "volume")
@dataclass
class BacktestConfig:
    initial_capital: float = 10_000.0
    risk_fraction: float = 0.005
    fee_rate: float = 0.001
    slippage_rate: float = 0.0005
    spread_rate: float = 0.0002
    stop_atr_multiple: float = 2.0
    reward_risk: float = 2.0
    fast_window: int = 10
    slow_window: int = 30
    train_fraction: float = 0.60
    validation_fraction: float = 0.20
    max_leverage: float = 1.0
def validate_ohlcv(df: pd.DataFrame, max_gap_multiple: float = 3.0) -> pd.DataFrame:
    """Rejects malformed OHLCV, duplicate/out-of-order timestamps, invalid prices and bad volumes."""
    if not isinstance(df, pd.DataFrame) or len(df) < 100:
        raise ValueError("Au moins 100 bougies sont requises pour un test de recherche.")
    frame=df.copy()
    frame.columns=[str(c).strip().lower() for c in frame.columns]
    missing=set(REQUIRED)-set(frame.columns)
    if missing: raise ValueError(f"Colonnes manquantes: {sorted(missing)}")
    if "timestamp" not in frame.columns:
        raise ValueError("La colonne timestamp est obligatoire pour contrôler la chronologie.")
    frame["timestamp"]=pd.to_datetime(frame["timestamp"], utc=True, errors="coerce")
    if frame["timestamp"].isna().any(): raise ValueError("Timestamp invalide.")
    frame=frame.sort_values("timestamp",kind="stable").reset_index(drop=True)
    if frame["timestamp"].duplicated().any(): raise ValueError("Timestamps dupliqués.")
    # Reject original non-chronological input rather than silently repairing it.
    original=pd.to_datetime(df["timestamp"],utc=True,errors="coerce")
    if not original.is_monotonic_increasing: raise ValueError("Les données doivent déjà être triées par timestamp croissant.")
    for col in ("open","high","low","close","volume"):
        frame[col]=pd.to_numeric(frame[col],errors="coerce")
        if frame[col].isna().any() or not np.isfinite(frame[col].to_numpy()).all():
            raise ValueError(f"Valeurs nulles ou non finies dans {col}.")
    if (frame[["open","high","low","close"]]<=0).any().any(): raise ValueError("Les prix doivent être strictement positifs.")
    if (frame["volume"]<0).any(): raise ValueError("Le volume ne peut pas être négatif.")
    if (frame["high"] < frame[["open","close","low"]].max(axis=1)).any(): raise ValueError("Incohérence OHLC: high trop bas.")
    if (frame["low"] > frame[["open","close","high"]].min(axis=1)).any(): raise ValueError("Incohérence OHLC: low trop haut.")
    deltas=frame["timestamp"].diff().dropna()
    if len(deltas) and (deltas<=pd.Timedelta(0)).any(): raise ValueError("Chronologie invalide.")
    # Data gaps are reported and rejected by default to prevent accidental fabricated bars.
    if len(deltas):
        typical=deltas.median()
        if typical>pd.Timedelta(0) and (deltas>typical*max_gap_multiple).any():
            raise ValueError("Trous temporels anormaux détectés. Corrigez ou documentez les données avantbacktest.")
    return frame
def _atr(frame: pd.DataFrame, window: int=14) -> pd.Series:
    prev=frame["close"].shift(1)
    tr=pd.concat([frame["high"]-frame["low"],(frame["high"]-prev).abs(),(frame["low"]-prev).abs()],axis=1
    ).max(axis=1)
    return tr.rolling(window,min_periods=window).mean()
def sma_cross_signals(frame: pd.DataFrame, fast: int, slow: int) -> pd.Series:
    """Signals use only fully closed bars; execution is at the next bar open."""
    if fast<2 or slow<=fast: raise ValueError("Paramètres SMA invalides: slow doit être supérieur à fast >= 2.")
    close=frame["close"]
    f=close.rolling(fast,min_periods=fast).mean()

    s=close.rolling(slow,min_periods=slow).mean()
    prev_gap=(f-s).shift(1)
    gap=f-s
    signal=pd.Series(0,index=frame.index,dtype=int)
    signal[(gap>0)&(prev_gap<=0)]=1
    signal[(gap<0)&(prev_gap>=0)]=-1
    return signal.fillna(0).astype(int)
def _simulate(frame: pd.DataFrame, cfg: BacktestConfig) -> dict:
    frame=frame.reset_index(drop=True).copy()
    signals=sma_cross_signals(frame,cfg.fast_window,cfg.slow_window)
    atr=_atr(frame)
    equity=cfg.initial_capital
    peak=equity
    max_dd=0.0
    pos=None
    trades=[]
    equity_curve=[]
    # signal generated at close i-1 can enter no earlier than open i.
    for i in range(1,len(frame)):
        bar=frame.iloc[i]
        # Stops/targets are evaluated before any new entry. If both touched, conservative stop-first.
        if pos:
            exit_price=None; reason=None
            if pos["side"]==1:
                if bar.low<=pos["stop"]: exit_price=pos["stop"]; reason="stop"
                elif bar.high>=pos["target"]: exit_price=pos["target"]; reason="target"
            else:
                if bar.high>=pos["stop"]: exit_price=pos["stop"]; reason="stop"
                elif bar.low<=pos["target"]: exit_price=pos["target"]; reason="target"
            if exit_price is not None:
                # adverse slippage on exit and fees on notional at entry+exit
                exit_exec=exit_price*(1-cfg.slippage_rate if pos["side"]==1 else 1+cfg.slippage_rate)
                gross=(exit_exec-pos["entry_exec"])*pos["qty"]*pos["side"]
                fees=cfg.fee_rate*pos["qty"]*(pos["entry_exec"]+exit_exec)
                net=gross-fees
                equity+=net
                trades.append({"entry_time":pos["entry_time"],"exit_time":bar.timestamp.isoformat(),
                    "side":"long" if pos["side"]==1 else "short","entry":pos["entry_exec"],
                    "exit":exit_exec,"quantity":pos["qty"],"gross_pnl":gross,"fees":fees,"pnl":net,
                    "R":net/pos["risk_cash"] if pos["risk_cash"] else None,"exit_reason":reason})
                pos=None
        # Use previous candle's signal and ATR; no current-bar close leakage.
        sig=int(signals.iloc[i-1])
        prev_atr=float(atr.iloc[i-1]) if pd.notna(atr.iloc[i-1]) else math.nan
        if pos is None and sig and math.isfinite(prev_atr) and prev_atr>0 and equity>0:
            raw_entry=float(bar.open)
            side=sig
            entry_exec=raw_entry*(1+cfg.slippage_rate+cfg.spread_rate/2 if side==1 else 1-cfg.slippage_rate-cfg.spread_rate/2)
            stop_dist=cfg.stop_atr_multiple*prev_atr
            stop=entry_exec-stop_dist if side==1 else entry_exec+stop_dist
            target=entry_exec+cfg.reward_risk*stop_dist if side==1 else entry_exec-cfg.reward_risk*stop_dist
            risk_cash=equity*cfg.risk_fraction
            qty=risk_cash/stop_dist
            notional=qty*entry_exec
            if qty>0 and notional<=equity*cfg.max_leverage:
                pos={"side":side,"entry":entry_exec,"entry_exec":entry_exec,"entry_time":bar.timestamp.isoformat(),
                     "qty":qty,"stop":stop,"target":target,"risk_cash":risk_cash}
        peak=max(peak,equity)
        max_dd=max(max_dd,(peak-equity)/peak if peak else 0)
        equity_curve.append({"timestamp":bar.timestamp.isoformat(),"equity":equity})
    # Close remaining position at final close, explicitly marked as forced close.
    if pos:
        last=frame.iloc[-1]; exit_exec=float(last.close)*(1-cfg.slippage_rate if pos["side"]==1 else 1+cfg.slippage_rate)
        gross=(exit_exec-pos["entry_exec"])*pos["qty"]*pos["side"]
        fees=cfg.fee_rate*pos["qty"]*(pos["entry_exec"]+exit_exec); net=gross-fees; equity+=net
        trades.append({"entry_time":pos["entry_time"],"exit_time":last.timestamp.isoformat(),
          "side":"long" if pos["side"]==1 else "short","entry":pos["entry_exec"],"exit":exit_exec,
          "quantity":pos["qty"],"gross_pnl":gross,"fees":fees,"pnl":net,
          "R":net/pos["risk_cash"] if pos["risk_cash"] else None,"exit_reason":"end_of_data"})
    return {"initial_capital":cfg.initial_capital,"final_equity":equity,"net_pnl":equity-cfg.initial_capital,
      "return_pct":(equity/cfg.initial_capital-1)*100,"max_drawdown_pct":max_dd*100,
      "trades":trades,"equity_curve":equity_curve}
def metrics(result: dict) -> dict:
    trades=result["trades"]; pnls=np.array([t["pnl"] for t in trades],dtype=float)
    wins=pnls[pnls>0]; losses=pnls[pnls<0]
    gross_win=float(wins.sum()); gross_loss=float(abs(losses.sum()))
    rvals=[t["R"] for t in trades if t["R"] is not None and math.isfinite(t["R"])]
    # Daily equity returns approximated from closed trades: not a Sharpe ratio unless daily sampling is used.
    return {"initial_capital":round(result["initial_capital"],2),"final_equity":round(result["final_equity"],2),

      "net_pnl":round(result["net_pnl"],2),"return_pct":round(result["return_pct"],4),
      "trade_count":len(trades),"win_rate_pct":round(100*len(wins)/len(trades),3) if trades else 0,
      "profit_factor":round(gross_win/gross_loss,4) if gross_loss>0 else None,
      "expectancy_per_trade":round(float(pnls.mean()),4) if len(pnls) else None,
      "expectancy_R":round(float(np.mean(rvals)),4) if rvals else None,
      "max_drawdown_pct":round(result["max_drawdown_pct"],4),
      "gross_wins":round(gross_win,2),"gross_losses":round(gross_loss,2),
      "fees_total":round(sum(t["fees"] for t in trades),2),
      "warning":"Résultats historiques, sensibles à la qualité des données et aux hypothèses de frais/slippage; ne prédisent pas les résultats futurs."}
def run_validation(raw: pd.DataFrame, cfg: BacktestConfig|None=None) -> dict:
    cfg=cfg or BacktestConfig()
    if cfg.initial_capital<=0 or not 0<cfg.risk_fraction<=0.02: raise ValueError("Capital ou risque invalide.")
    if min(cfg.fee_rate,cfg.slippage_rate,cfg.spread_rate)<0: raise ValueError("Frais, spread et slippagedoivent être >= 0.")
    if cfg.max_leverage<=0 or cfg.max_leverage>2: raise ValueError("Levier max doit être >0 et <=2.")
    if cfg.fast_window<2 or cfg.slow_window<=cfg.fast_window: raise ValueError("Fenêtres SMA invalides.")
    frame=validate_ohlcv(raw)
    n=len(frame); train_end=int(n*cfg.train_fraction); val_end=int(n*(cfg.train_fraction+cfg.validation_fraction))
    if not (cfg.slow_window+20 < train_end < val_end < n):
        raise ValueError("Données insuffisantes pour train/validation/test chronologiques.")
    # Strict chronological splits. Parameters are fixed here; no tuning on test data.
    train=frame.iloc[:train_end].copy()
    validation=frame.iloc[train_end:val_end].copy()
    test=frame.iloc[val_end:].copy()
    # Warm-up history is used only for indicators; scored period starts at the split boundary.
    def segment(segment_frame, history):
        combined=pd.concat([history.tail(cfg.slow_window+20),segment_frame],ignore_index=True)
        res=_simulate(combined,cfg)
        # Since trades can originate in warm-up, report only those whose entry is in the scored segment.
        start=segment_frame.iloc[0].timestamp
        res["trades"]=[t for t in res["trades"] if pd.Timestamp(t["entry_time"])>=start]
        # Recompute score from retained trades rather than falsely claim continuity accounting.
        pnl=sum(t["pnl"] for t in res["trades"])
        res["net_pnl"]=pnl; res["final_equity"]=cfg.initial_capital+pnl
        res["return_pct"]=(res["final_equity"]/cfg.initial_capital-1)*100
        return metrics(res)
    train_result=segment(train,train.iloc[:0])
    val_result=segment(validation,train)
    test_result=segment(test,pd.concat([train,validation]))
    # Robustness grid: predeclared nearby parameters, all costs kept in place; diagnostic not a guarantee.
    robustness=[]
    for fast,slow in [(max(2,cfg.fast_window-2),cfg.slow_window),
                      (cfg.fast_window,cfg.slow_window+5),
                      (cfg.fast_window+2,cfg.slow_window+10)]:
        if fast>=slow: continue
        alt=BacktestConfig(**{**asdict(cfg),"fast_window":fast,"slow_window":slow})
        rr=_simulate(frame,alt)
        robustness.append({"fast":fast,"slow":slow,**metrics(rr)})
    return {"data":{"bars":n,"start":frame.timestamp.iloc[0].isoformat(),"end":frame.timestamp.iloc[-1].isoformat(),
                    "chronological":True,"data_validation":"passed"},
      "assumptions":{"fees_rate":cfg.fee_rate,"slippage_rate":cfg.slippage_rate,"spread_rate":cfg.spread_rate,
          "risk_fraction":cfg.risk_fraction,"max_leverage":cfg.max_leverage,"stop":"ATR précédent × multiple",
          "entry":"open de la bougie suivant le signal clôturé","intrabar_tie":"stop prioritaire si stop et cible touchés"},
      "train":train_result,"validation":val_result,"out_of_sample_test":test_result,
      "robustness_nearby_parameters":robustness,
      "limitations":["Le modèle n'inclut pas les funding rates, emprunt, liquidations, règles fiscales, latence ou profondeur de carnet.",
          "Le traitement des positions aux frontières des segments et l'exécution réelle doivent être audités pour chaque marché.",
          "Ne pas sélectionner une stratégie sur la base du seul résultat test; exiger walk-forward répété et paper trading prolongé."]}
