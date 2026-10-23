"""
Carnet de Trading — MVP local en simulation uniquement.
Les ordres réels sont volontairement absents. Ne pas exposer directement sur Internet.
"""
from __future__ import annotations
import os, sqlite3, secrets, hashlib, hmac, json, math
from datetime import datetime, timezone, date, timedelta
from pathlib import Path
from typing import Optional, Literal
from fastapi import FastAPI, HTTPException, Depends, Header, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
import pyotp
from jose import jwt, JWTError
BASE = Path(__file__).resolve().parent
DB_PATH = os.getenv("DATABASE_PATH", str(BASE / "carnet.db"))
JWT_SECRET = os.getenv("JWT_SECRET", "")
TOTP_SECRET = os.getenv("TOTP_SECRET", "")
REAL_TRADING_ENABLED = os.getenv("REAL_TRADING_ENABLED", "false").lower() == "true"
JWT_ALG = "HS256"
JWT_MINUTES = 30
ph = PasswordHasher()
app = FastAPI(title="Carnet de Trading", version="1.1.0")
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")
DEFAULT_LIMITS = {
    "capital_alloue": 500.0, "risque_par_trade": 0.005,
    "perte_max_jour": 0.02, "perte_max_semaine": 0.05,
    "drawdown_max": 0.10, "levier_max": 1.0,
    "pertes_consecutives_max": 3, "trades_max_jour": 3,
}
ABSOLUTE = {
    "capital_alloue": (100.0, 1_000_000_000.0),
    "risque_par_trade": (0.0001, 0.02), "perte_max_jour": (0.0, 0.05),
    "perte_max_semaine": (0.0, 0.10), "drawdown_max": (0.0, 0.20),
    "levier_max": (0.0, 2.0), "pertes_consecutives_max": (1, 4),
    "trades_max_jour": (1, 5),
}
def utcnow():
    return datetime.now(timezone.utc).isoformat()
def db():
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con
def init_db():
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL,
          closed_at TEXT, instrument TEXT NOT NULL, side TEXT NOT NULL,
          entry REAL NOT NULL, stop REAL NOT NULL, target REAL,
          quantity REAL NOT NULL, status TEXT NOT NULL, exit_price REAL,
          pnl REAL NOT NULL DEFAULT 0, r_multiple REAL, note TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL,
          event_type TEXT NOT NULL, details TEXT NOT NULL, previous_hash TEXT,
          event_hash TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pending_limits (
          id INTEGER PRIMARY KEY CHECK(id=1), requested_at TEXT NOT NULL,
          apply_at TEXT NOT NULL, payload TEXT NOT NULL
        );
        """)
        for k,v in DEFAULT_LIMITS.items():
            c.execute("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", (k,json.dumps(v)))
        c.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('emergency_stop','false')")
        c.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('peak_equity','500.0')")
        c.commit()

def log_event(kind, details):
    with db() as c:
        last = c.execute("SELECT event_hash FROM events ORDER BY id DESC LIMIT 1").fetchone()
        prev = last["event_hash"] if last else "GENESIS"
        body = json.dumps({"at":utcnow(),"type":kind,"details":details,"previous":prev}, sort_keys=True)
        digest = hashlib.sha256(body.encode()).hexdigest()
        c.execute("INSERT INTO events(created_at,event_type,details,previous_hash,event_hash) VALUES(?,?,?,?,?)",
                  (utcnow(),kind,json.dumps(details),prev,digest))
        c.commit()
def get_setting(key):
    with db() as c:
        row = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return json.loads(row["value"]) if row else None
def set_setting(key, value):
    with db() as c:
        c.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                  (key,json.dumps(value)))
        c.commit()
def validate_limits(payload):
    out = {}
    for k,(lo,hi) in ABSOLUTE.items():
        if k not in payload: raise HTTPException(422, f"Limite manquante: {k}")
        val = payload[k]
        if isinstance(val,bool) or not isinstance(val,(int,float)) or not math.isfinite(val) or val < lo or val > hi:
            raise HTTPException(422, f"{k} doit être compris entre {lo} et {hi}")
        if k in ("pertes_consecutives_max","trades_max_jour") and int(val) != val:
            raise HTTPException(422, f"{k} doit être entier")
        out[k] = int(val) if k in ("pertes_consecutives_max","trades_max_jour") else float(val)
    if out["capital_alloue"] < 100: raise HTTPException(422, "Capital minimum: 100 USD")
    return out
def current_trades():
    with db() as c:
        return [dict(r) for r in c.execute("SELECT * FROM trades ORDER BY id DESC LIMIT 500")]
def closed_trades():
    return [t for t in current_trades() if t["status"] == "closed"]
def risk_state():
    limits = {k:get_setting(k) for k in DEFAULT_LIMITS}
    trades = closed_trades()
    now = datetime.now(timezone.utc)
    today = now.date()
    week_start = today - timedelta(days=today.weekday())
    day_pnl = week_pnl = 0.0
    losses_in_row = 0
    for t in trades:
        d = datetime.fromisoformat(t["closed_at"]).date()
        if d == today: day_pnl += t["pnl"]
        if d >= week_start: week_pnl += t["pnl"]
    for t in trades:
        if t["pnl"] < 0: losses_in_row += 1
        else: break
    capital = limits["capital_alloue"] + sum(t["pnl"] for t in trades)
    peak = max(float(get_setting("peak_equity") or capital), capital)
    set_setting("peak_equity", peak)
    dd = max(0.0, (peak-capital)/peak) if peak else 0.0
    return {"limits":limits, "capital":round(capital,2), "peak_equity":round(peak,2),
            "day_pnl":round(day_pnl,2), "week_pnl":round(week_pnl,2),
            "drawdown":round(dd,4), "losses_in_row":losses_in_row,
            "trades_today":sum(1 for t in trades if datetime.fromisoformat(t["closed_at"]).date()==today)
    }
def auth_required(authorization: Optional[str] = Header(default=None)):
    if not JWT_SECRET or len(JWT_SECRET) < 32:
        raise HTTPException(503, "Configuration requise: JWT_SECRET d'au moins 32 caractères.")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authentification requise")
    token = authorization[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        if payload.get("sub") != "local-admin": raise JWTError("subject")
    except JWTError:
        raise HTTPException(401, "Jeton invalide ou expiré")
    return True
class LoginIn(BaseModel):
    password: str = Field(min_length=1, max_length=256)
    totp_code: str = Field(pattern=r"^\d{6}$")
class LimitsIn(BaseModel):
    capital_alloue: float

    risque_par_trade: float
    perte_max_jour: float
    perte_max_semaine: float
    drawdown_max: float
    levier_max: float
    pertes_consecutives_max: int
    trades_max_jour: int
class TradeIn(BaseModel):
    instrument: str = Field(min_length=1, max_length=30)
    side: Literal["long","short"]
    entry: float = Field(gt=0)
    stop: float = Field(gt=0)
    target: Optional[float] = Field(default=None, gt=0)
    quantity: float = Field(gt=0)
    note: str = Field(default="", max_length=500)
    @model_validator(mode="after")
    def prices_make_sense(self):
        if self.side == "long" and self.stop >= self.entry: raise ValueError("Pour un long, le stop doit être sous l'entrée.")
        if self.side == "short" and self.stop <= self.entry: raise ValueError("Pour un short, le stop doit être au-dessus de l'entrée.")
        if self.target is not None:
            if self.side == "long" and self.target <= self.entry: raise ValueError("Cible long au-dessus de l'entrée requise.")
            if self.side == "short" and self.target >= self.entry: raise ValueError("Cible short sous l'entrée requise.")
        return self
class CloseIn(BaseModel):
    exit_price: float = Field(gt=0)
@app.on_event("startup")
def startup():
    # Fail closed: no app start without mandatory auth configuration.
    if not JWT_SECRET or len(JWT_SECRET) < 32:
        raise RuntimeError("JWT_SECRET absent ou trop court (32 caractères minimum).")
    if not os.getenv("APP_PASSWORD_HASH", "").startswith("$argon2"):
        raise RuntimeError("APP_PASSWORD_HASH Argon2id manquant ou invalide.")
    if not TOTP_SECRET:
        raise RuntimeError("TOTP_SECRET manquant.")
    try:
        pyotp.TOTP(TOTP_SECRET)
    except Exception as exc:
        raise RuntimeError("TOTP_SECRET invalide.") from exc
    init_db()
@app.get("/", response_class=HTMLResponse)
def index():
    return FileResponse(BASE / "static" / "index.html")
@app.get("/api/health")
def health():
    return {"status":"ok","mode":"simulation","real_trading_enabled":False}
@app.post("/api/connexion")
def login(data: LoginIn, request: Request):
    if not JWT_SECRET or len(JWT_SECRET) < 32: raise HTTPException(503,"JWT_SECRET non configuré.")
    password_hash = os.getenv("APP_PASSWORD_HASH","")
    if not password_hash: raise HTTPException(503,"APP_PASSWORD_HASH non configuré.")
    try:
        ph.verify(password_hash, data.password)
    except (VerifyMismatchError, Exception):
        log_event("login_failed", {"client": request.client.host if request.client else "unknown"})
        raise HTTPException(401,"Identifiants invalides")
    if not TOTP_SECRET or not pyotp.TOTP(TOTP_SECRET).verify(data.totp_code, valid_window=1):
        log_event("totp_failed", {"client": request.client.host if request.client else "unknown"})
        raise HTTPException(401,"Code 2FA invalide")
    token = jwt.encode({"sub":"local-admin","exp":datetime.now(timezone.utc)+timedelta(minutes=JWT_MINUTES),
                        "jti":secrets.token_urlsafe(16)}, JWT_SECRET, algorithm=JWT_ALG)
    log_event("login_success", {})
    return {"access_token":token,"token_type":"bearer","expires_in":JWT_MINUTES*60}
@app.get("/api/etat", dependencies=[Depends(auth_required)])
def state():
    rs = risk_state()
    return {"mode":"simulation","arret_urgence":get_setting("emergency_stop"),
            "capital":rs["capital"],"etat_risque":rs,"transactions":current_trades(),
            "pending_limits":get_pending()}
def get_pending():
    with db() as c:
        r=c.execute("SELECT * FROM pending_limits WHERE id=1").fetchone()
    return dict(r) if r else None
@app.get("/api/transactions", dependencies=[Depends(auth_required)])
def transactions():

    return current_trades()
@app.put("/api/limites", dependencies=[Depends(auth_required)])
def update_limits(data: LimitsIn):
    new=validate_limits(data.model_dump())
    old={k:get_setting(k) for k in DEFAULT_LIMITS}
    if any(new[k] > old[k] for k in new):
        requested=datetime.now(timezone.utc)
        apply=requested+timedelta(hours=24)
        with db() as c:
            c.execute("INSERT INTO pending_limits(id,requested_at,apply_at,payload) VALUES(1,?,?,?) "
                      "ON CONFLICT(id) DO UPDATE SET requested_at=excluded.requested_at,apply_at=excluded.apply_at,payload=excluded.payload",
                      (requested.isoformat(),apply.isoformat(),json.dumps(new)))
            c.commit()
        log_event("limits_pending", {"old":old,"new":new,"apply_at":apply.isoformat()})
        return {"status":"pending","apply_at":apply.isoformat(),"message":"Toute hausse est différée de 24 heures."}
    for k,v in new.items(): set_setting(k,v)
    log_event("limits_updated", {"old":old,"new":new,"effective":"immediate"})
    return {"status":"applied","limits":new}
def apply_pending_if_due():
    p=get_pending()
    if p and datetime.now(timezone.utc) >= datetime.fromisoformat(p["apply_at"]):
        new=validate_limits(json.loads(p["payload"]))
        for k,v in new.items(): set_setting(k,v)
        with db() as c: c.execute("DELETE FROM pending_limits WHERE id=1"); c.commit()
        log_event("limits_applied", {"limits":new})
@app.post("/api/arret-urgence", dependencies=[Depends(auth_required)])
def emergency_stop(confirmation: dict):
    if confirmation.get("confirmation") != "ARRETER": raise HTTPException(400,"Tapez exactement ARRETER."
    )
    set_setting("emergency_stop", True); log_event("emergency_stop",{})
    return {"status":"stopped"}
@app.post("/api/reactiver", dependencies=[Depends(auth_required)])
def reactivate(confirmation: dict):
    if confirmation.get("confirmation") != "REACTIVER": raise HTTPException(400,"Tapez exactement REACTIVER.")
    set_setting("emergency_stop", False); log_event("reactivated",{})
    return {"status":"active"}
@app.post("/api/transactions", dependencies=[Depends(auth_required)])
def open_trade(data: TradeIn):
    apply_pending_if_due()
    if get_setting("emergency_stop"): raise HTTPException(423,"Arrêt d'urgence actif.")
    rs=risk_state(); lim=rs["limits"]
    if rs["trades_today"] >= lim["trades_max_jour"]: raise HTTPException(409,"Plafond de trades quotidiens atteint.")
    if rs["losses_in_row"] >= lim["pertes_consecutives_max"]: raise HTTPException(409,"Plafond de pertes consécutives atteint.")
    if rs["day_pnl"] <= -lim["capital_alloue"]*lim["perte_max_jour"]: raise HTTPException(409,"Limite de perte journalière atteinte.")
    if rs["week_pnl"] <= -lim["capital_alloue"]*lim["perte_max_semaine"]: raise HTTPException(409,"Limitede perte hebdomadaire atteinte.")
    if rs["drawdown"] >= lim["drawdown_max"]: raise HTTPException(409,"Drawdown maximal atteint.")
    if data.side=="long" and data.stop>=data.entry: raise HTTPException(422,"Stop long invalide.")
    risk=abs(data.entry-data.stop)*data.quantity
    max_risk=rs["capital"]*lim["risque_par_trade"]
    if risk > max_risk + 1e-9: raise HTTPException(409,f"Risque du trade ({risk:.2f}) supérieur au plafond ({max_risk:.2f}).")
    exposure=data.entry*data.quantity
    if rs["capital"] and exposure/rs["capital"] > lim["levier_max"]+1e-9:
        raise HTTPException(409,"Levier/exposition supérieur à la limite.")
    with db() as c:
        cur=c.execute("INSERT INTO trades(created_at,instrument,side,entry,stop,target,quantity,status,note) VALUES(?,?,?,?,?,?,?,'open',?)",
          (utcnow(),data.instrument.upper(),data.side,data.entry,data.stop,data.target,data.quantity,data
    .note))
        trade_id=cur.lastrowid; c.commit()
    log_event("paper_trade_opened", {"trade_id":trade_id,"risk":risk})
    return {"id":trade_id,"status":"open","risk_usd":round(risk,2),"mode":"simulation"}
@app.post("/api/transactions/{trade_id}/cloturer", dependencies=[Depends(auth_required)])
def close_trade(trade_id: int, data: CloseIn):
    with db() as c:
        row=c.execute("SELECT * FROM trades WHERE id=? AND status='open'",(trade_id,)).fetchone()
        if not row: raise HTTPException(404,"Trade ouvert introuvable.")
        t=dict(row)
        pnl=((data.exit_price-t["entry"]) if t["side"]=="long" else (t["entry"]-data.exit_price))*t["quantity"]
        initial_risk=abs(t["entry"]-t["stop"])*t["quantity"]
        r=pnl/initial_risk if initial_risk else None
        c.execute("UPDATE trades SET status='closed',closed_at=?,exit_price=?,pnl=?,r_multiple=? WHERE id=?",
                  (utcnow(),data.exit_price,pnl,r,trade_id)); c.commit()
    log_event("paper_trade_closed", {"trade_id":trade_id,"exit_price":data.exit_price,"pnl":round(pnl,2)}

    )
    return {"id":trade_id,"pnl":round(pnl,2),"r_multiple":round(r,3) if r is not None else None}
@app.get("/api/evenements", dependencies=[Depends(auth_required)])
def events():
    with db() as c:
        rows=c.execute("SELECT id,created_at,event_type,details,previous_hash,event_hash FROM events ORDER BY id DESC LIMIT 200").fetchall()
    return [dict(r) for r in rows]
@app.post("/api/backtest", dependencies=[Depends(auth_required)])
def backtest(payload: dict):
    """Validated historical backtest with chronological train/validation/OOS split."""
    import pandas as pd
    from backtest_engine import BacktestConfig, run_validation
    candles=payload.get("candles")
    if not isinstance(candles,list) or len(candles)<100:
        raise HTTPException(422,"Fournir au moins 100 bougies OHLCV avec timestamp.")
    try:
        frame=pd.DataFrame(candles)
        cfg=BacktestConfig(
            initial_capital=float(payload.get("initial_capital",10000)),
            risk_fraction=float(payload.get("risk_fraction",0.005)),
            fee_rate=float(payload.get("fee_rate",0.001)),
            slippage_rate=float(payload.get("slippage_rate",0.0005)),
            spread_rate=float(payload.get("spread_rate",0.0002)),
            stop_atr_multiple=float(payload.get("stop_atr_multiple",2.0)),
            reward_risk=float(payload.get("reward_risk",2.0)),
            fast_window=int(payload.get("fast_window",10)),
            slow_window=int(payload.get("slow_window",30)),
            train_fraction=float(payload.get("train_fraction",0.60)),
            validation_fraction=float(payload.get("validation_fraction",0.20)),
            max_leverage=float(payload.get("max_leverage",1.0)),
        )
        return run_validation(frame,cfg)
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(422,f"Backtest refusé : {exc}") from exc
@app.post("/api/live/order", dependencies=[Depends(auth_required)])
def live_order(payload: dict):
    """Explicitly gated CCXT limit order. Venue-specific protective stops are not yet certified."""
    # Safety gate: the generic CCXT adapter does not guarantee an exchange-native
    # protective stop linked to a filled entry. Never send a live order until a
    # platform-specific implementation and tests replace this guard.
    raise HTTPException(503, "Trading réel verrouillé : sélectionnez la plateforme et implémentez/testez son stop protecteur natif avant toute transmission.")
    from live_broker import place_limit_order
    try:
        symbol=str(payload.get("symbol",""))
        side=str(payload.get("side",""))
        amount=float(payload.get("amount",0))
        price=float(payload.get("price",0))
        # independent, mandatory risk cap; no leverage beyond configured account risk
        rs=risk_state()
        limits=rs["limits"]
        if get_setting("emergency_stop"): raise HTTPException(423,"Arrêt d'urgence actif.")
        if amount*price > rs["capital"]*limits["levier_max"]:
            raise HTTPException(409,"Valeur de l'ordre supérieure au plafond d'exposition.")
        if amount*abs(price-float(payload.get("stop_price",0))) > rs["capital"]*limits["risque_par_trade"
    ]:
            raise HTTPException(409,"Risque estimé supérieur au plafond. Fournir un stop_price valide.")
        if float(payload.get("stop_price",0)) <= 0: raise HTTPException(422,"stop_price obligatoire.")
        result=place_limit_order(symbol,side,amount,price)
        log_event("live_order_submitted", {"symbol":symbol,"side":side,"amount":amount,
                   "price":price,"exchange_order_id":result.get("id")})
        return {"status":"submitted","exchange_order_id":result.get("id"),
                "warning":"Ordre transmis; vérifiez l'état sur la plateforme. Le stop protecteur doit être géré par un adaptateur propre à cette plateforme."}
    except HTTPException: raise
    except Exception as exc:
        log_event("live_order_error", {"error_type":type(exc).__name__})
        raise HTTPException(409, f"Ordre réel refusé : {type(exc).__name__}: {exc}") from exc
@app.get("/api/app.js")
def app_js():
    return FileResponse(BASE/"static"/"app.js", media_type="application/javascript")
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response=await call_next(request)
    response.headers["Content-Security-Policy"]="default-src 'self'; script-src 'self'; style-src 'self';img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    response.headers["X-Frame-Options"]="DENY"
    response.headers["X-Content-Type-Options"]="nosniff"
    response.headers["Referrer-Policy"]="strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"]="camera=(), microphone=(), geolocation=()"
    return response
