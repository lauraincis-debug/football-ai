"""Configuration statique : environnements, instruments, politique de risque.

Toutes les valeurs numériques de la politique de risque sont des *propositions de
conception* reprises du cahier des charges (section 5) et restent réservées au
propriétaire (section 1.3). Le code ne les modifie jamais seul : chaque
changement passe par ``carnet.policy.PolicyStore`` avec autorisation
propriétaire, journalisation et versionnement.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field, replace
from decimal import Decimal
from pathlib import Path
from typing import Any

from .util import D, ZERO

# --------------------------------------------------------------------------
# Environnements (section 4)
# --------------------------------------------------------------------------
ENV_SIMULATION = "SIMULATION"
ENV_DEMO = "DEMO"
ENV_REAL_SUPERVISED = "REAL_SUPERVISED"
ENV_REAL_AUTO = "REAL_AUTO"

ENVIRONMENTS = (ENV_SIMULATION, ENV_DEMO, ENV_REAL_SUPERVISED, ENV_REAL_AUTO)
REAL_ENVIRONMENTS = (ENV_REAL_SUPERVISED, ENV_REAL_AUTO)
#: Seul environnement autorisé au démarrage, sans action du propriétaire.
DEFAULT_ENV = ENV_SIMULATION

MARKET_FOREX = "forex"
MARKET_CRYPTO = "crypto"

#: Ordre imposé du cycle de vie (section 11).
ORDER_STATES = (
    "CREATED",
    "SUBMITTED",
    "ACCEPTED",
    "PARTIALLY_FILLED",
    "FILLED",
    "CANCEL_PENDING",
    "CANCELLED",
    "REJECTED",
    "EXPIRED",
    "UNKNOWN",
)

TERMINAL_ORDER_STATES = frozenset({"FILLED", "CANCELLED", "REJECTED", "EXPIRED"})


# --------------------------------------------------------------------------
# Instruments
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class SymbolSpec:
    """Spécification de contrat nécessaire au calcul de taille (section 6)."""

    symbol: str
    market: str
    base: str
    quote: str
    price_precision: int
    tick_size: Decimal
    contract_size: Decimal
    min_qty: Decimal
    qty_step: Decimal
    max_qty: Decimal
    leverage: int
    maker_fee_bps: Decimal
    taker_fee_bps: Decimal
    typical_spread_bps: Decimal
    correlation_group: str
    display_name: str = ""
    notes: str = ""
    spot_only: bool = True

    @property
    def qty_precision(self) -> int:
        step = self.qty_step.normalize()
        return max(0, -step.as_tuple().exponent)

    @property
    def is_forex(self) -> bool:
        return self.market == MARKET_FOREX

    def to_dict(self) -> dict[str, Any]:
        from .util import as_number

        return as_number(self.__dict__ | {"qty_precision": self.qty_precision})


def _fx(symbol: str, base: str, quote: str, precision: int, tick: str, spread_bps: str,
        group: str, leverage: int = 30) -> SymbolSpec:
    return SymbolSpec(
        symbol=symbol,
        market=MARKET_FOREX,
        base=base,
        quote=quote,
        price_precision=precision,
        tick_size=D(tick),
        contract_size=D("100000"),
        min_qty=D("0.01"),
        qty_step=D("0.01"),
        max_qty=D("50"),
        leverage=leverage,
        maker_fee_bps=D("0"),
        taker_fee_bps=D("0.35"),
        typical_spread_bps=D(spread_bps),
        correlation_group=group,
        display_name=f"{base}/{quote}",
        notes="Contrat standard 100 000 unités, exécution MT5 (démo).",
        spot_only=False,
    )


def _crypto(symbol: str, base: str, quote: str, precision: int, tick: str, spread_bps: str,
            min_qty: str, step: str) -> SymbolSpec:
    return SymbolSpec(
        symbol=symbol,
        market=MARKET_CRYPTO,
        base=base,
        quote=quote,
        price_precision=precision,
        tick_size=D(tick),
        contract_size=D("1"),
        min_qty=D(min_qty),
        qty_step=D(step),
        max_qty=D("1000000"),
        leverage=1,
        maker_fee_bps=D("10"),
        taker_fee_bps=D("10"),
        typical_spread_bps=D(spread_bps),
        correlation_group="CRYPTO_MAJORS",
        display_name=f"{base}/{quote}",
        notes="Spot uniquement : levier et marge exclus de la V1 (section 10).",
        spot_only=True,
    )


SYMBOLS: dict[str, SymbolSpec] = {
    "EURUSD": _fx("EURUSD", "EUR", "USD", 5, "0.00001", "0.8", "USD_MAJORS"),
    "GBPUSD": _fx("GBPUSD", "GBP", "USD", 5, "0.00001", "1.1", "USD_MAJORS"),
    "USDJPY": _fx("USDJPY", "USD", "JPY", 3, "0.001", "0.9", "USD_MAJORS"),
    "AUDUSD": _fx("AUDUSD", "AUD", "USD", 5, "0.00001", "1.2", "COMMODITY_FX"),
    "USDCAD": _fx("USDCAD", "USD", "CAD", 5, "0.00001", "1.3", "COMMODITY_FX"),
    "BTCUSDT": _crypto("BTCUSDT", "BTC", "USDT", 2, "0.01", "1.5", "0.0001", "0.0001"),
    "ETHUSDT": _crypto("ETHUSDT", "ETH", "USDT", 2, "0.01", "1.8", "0.001", "0.001"),
    "SOLUSDT": _crypto("SOLUSDT", "SOL", "USDT", 3, "0.001", "2.4", "0.01", "0.01"),
}

#: Prix de départ de la simulation (aucune donnée réelle présentée comme telle).
SIMULATION_REFERENCE_PRICES: dict[str, Decimal] = {
    "EURUSD": D("1.08750"),
    "GBPUSD": D("1.26840"),
    "USDJPY": D("151.250"),
    "AUDUSD": D("0.65820"),
    "USDCAD": D("1.36140"),
    "BTCUSDT": D("67250.00"),
    "ETHUSDT": D("3280.00"),
    "SOLUSDT": D("148.500"),
}

#: Volatilité annuelle approximative utilisée par le générateur de marché simulé.
SIMULATION_ANNUAL_VOL: dict[str, float] = {
    "EURUSD": 0.075,
    "GBPUSD": 0.085,
    "USDJPY": 0.095,
    "AUDUSD": 0.100,
    "USDCAD": 0.080,
    "BTCUSDT": 0.550,
    "ETHUSDT": 0.650,
    "SOLUSDT": 0.850,
}

#: Taux de conversion vers la devise de référence de la simulation.
#: La production utilise le cours du moment et enregistre le taux appliqué (5.1).
FX_TO_ACCOUNT: dict[str, Decimal] = {
    "USD": D("1"),
    "USDT": D("1"),
    "EUR": D("1.08750"),
    "GBP": D("1.26840"),
    "AUD": D("0.65820"),
    "CAD": D("0.73450"),
    "JPY": D("0.006612"),
    "CHF": D("1.10400"),
}

CORRELATION_GROUPS: dict[str, tuple[str, ...]] = {
    "USD_MAJORS": ("EURUSD", "GBPUSD", "USDJPY"),
    "COMMODITY_FX": ("AUDUSD", "USDCAD"),
    "CRYPTO_MAJORS": ("BTCUSDT", "ETHUSDT", "SOLUSDT"),
}


# --------------------------------------------------------------------------
# Politique de risque (section 5)
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class RiskPolicy:
    """Politique de risque versionnée. Valeurs initiales du cahier des charges."""

    max_risk_per_trade_pct: Decimal = D("0.5")
    max_daily_loss_pct: Decimal = D("2.0")
    max_weekly_loss_pct: Decimal = D("5.0")
    max_drawdown_pct: Decimal = D("10.0")
    max_open_positions: int = 3
    max_open_risk_pct: Decimal = D("1.5")
    max_group_risk_pct: Decimal = D("1.0")
    min_reward_risk: Decimal = D("1.20")
    freshness_seconds: Decimal = D("3.0")
    max_spread_bps: Decimal = D("25")
    max_slippage_bps: Decimal = D("12")
    reset_hour_ny: int = 17
    currency: str = "USD"
    max_order_notional_pct: Decimal = D("1000")
    max_daily_trades: int = 12
    version: int = 1

    def to_dict(self) -> dict[str, Any]:
        from .util import as_number

        return as_number(self.__dict__)

    def with_changes(self, changes: dict[str, Any]) -> "RiskPolicy":
        unknown = set(changes) - set(self.__dict__)
        if unknown:
            raise ValueError(f"paramètres inconnus: {sorted(unknown)}")
        coerced: dict[str, Any] = {}
        for key, value in changes.items():
            current = getattr(self, key)
            if isinstance(current, Decimal):
                coerced[key] = D(value)
            elif isinstance(current, int):
                coerced[key] = int(value)
            else:
                coerced[key] = value
        return replace(self, **coerced)

    # -- contrôles d'intégrité -------------------------------------------
    def validate(self) -> list[str]:
        errors: list[str] = []
        pct_fields = {
            "max_risk_per_trade_pct": (D("0.01"), D("2")),
            "max_daily_loss_pct": (D("0.1"), D("10")),
            "max_weekly_loss_pct": (D("0.2"), D("25")),
            "max_drawdown_pct": (D("0.5"), D("50")),
            "max_open_risk_pct": (D("0.1"), D("10")),
            "max_group_risk_pct": (D("0.1"), D("10")),
            "max_order_notional_pct": (D("10"), D("3000")),
            "min_reward_risk": (D("0.5"), D("10")),
            "freshness_seconds": (D("0.2"), D("60")),
            "max_spread_bps": (D("0.5"), D("500")),
            "max_slippage_bps": (D("0.5"), D("500")),
        }
        for name, (low, high) in pct_fields.items():
            value = getattr(self, name)
            if not (low <= value <= high):
                errors.append(f"{name} hors bornes [{low}, {high}] : {value}")
        if not (1 <= self.max_open_positions <= 20):
            errors.append("max_open_positions hors bornes [1, 20]")
        if not (1 <= self.max_daily_trades <= 200):
            errors.append("max_daily_trades hors bornes [1, 200]")
        if not (0 <= self.reset_hour_ny <= 23):
            errors.append("reset_hour_ny hors bornes [0, 23]")
        if self.max_open_risk_pct < self.max_risk_per_trade_pct:
            errors.append("max_open_risk_pct inférieur au risque par transaction")
        return errors


DEFAULT_POLICY = RiskPolicy()


# --------------------------------------------------------------------------
# Réglages applicatifs
# --------------------------------------------------------------------------
def _env_path(name: str, default: Path) -> Path:
    raw = os.environ.get(name)
    return Path(raw).expanduser().resolve() if raw else default


def _symbols_from_env() -> tuple[str, ...]:
    """Instruments négociés, restreignables par ``CARNET_SYMBOLS``.

    Utile quand le courtier ne propose qu'une partie des instruments : le moteur
    ne suit alors que ceux qui existent réellement, sans avertissement inutile.
    """
    raw = os.environ.get("CARNET_SYMBOLS", "").strip()
    if not raw:
        return tuple(SYMBOLS)
    names: list[str] = []
    for chunk in raw.replace(";", ",").split(","):
        name = chunk.strip().upper()
        if name and name not in names:
            names.append(name)
    if not names:
        raise ValueError("CARNET_SYMBOLS ne contient aucun instrument")
    unknown = [name for name in names if name not in SYMBOLS]
    if unknown:
        raise ValueError(
            f"CARNET_SYMBOLS : instruments inconnus ({', '.join(unknown)}) ; "
            f"disponibles : {', '.join(SYMBOLS)}")
    return tuple(names)


@dataclass(frozen=True)
class Settings:
    root: Path
    data_dir: Path
    var_dir: Path
    web_dir: Path
    db_path: Path
    backup_dir: Path
    host: str = os.environ.get("CARNET_HOST", "0.0.0.0")
    port: int = int(os.environ.get("CARNET_PORT", "8080"))
    environment: str = os.environ.get("CARNET_ENV", DEFAULT_ENV)
    initial_capital: Decimal = D(os.environ.get("CARNET_INITIAL_CAPITAL", "10000"))
    account_currency: str = os.environ.get("CARNET_ACCOUNT_CURRENCY", "USD")
    engine_tick_seconds: float = float(os.environ.get("CARNET_TICK_SECONDS", "1.0"))
    session_ttl_minutes: int = int(os.environ.get("CARNET_SESSION_TTL_MINUTES", "480"))
    allow_real_trading: bool = os.environ.get("CARNET_ALLOW_REAL", "0") == "1"
    seed: int = int(os.environ.get("CARNET_SEED", "20261101"))
    log_level: str = os.environ.get("CARNET_LOG_LEVEL", "INFO")
    symbols: tuple[str, ...] = field(default_factory=_symbols_from_env)
    demo_mode: bool = os.environ.get("CARNET_DEMO_DATA", "0") == "1"
    #: En SIMULATION uniquement : marché synthétique continu, pour que la
    #: démonstration reste utilisable un week-end. Le calendrier réel reste
    #: implémenté et testé (``carnet.simulator.is_market_open``).
    simulation_24_7: bool = os.environ.get("CARNET_SIM_24_7", "1") == "1"
    #: Accélération de l'horloge de simulation (1 = temps réel).
    simulation_speed: float = float(os.environ.get("CARNET_SIM_SPEED", "300"))

    @property
    def db_file(self) -> Path:
        return self.db_path

    def ensure_dirs(self) -> None:
        for path in (self.data_dir, self.var_dir, self.backup_dir, self.web_dir):
            path.mkdir(parents=True, exist_ok=True)

    def validate(self) -> None:
        if self.environment not in ENVIRONMENTS:
            raise ValueError(f"environnement inconnu: {self.environment}")
        if self.port <= 0 or self.port > 65535:
            raise ValueError("port invalide")
        if self.engine_tick_seconds < 0.1:
            raise ValueError("CARNET_TICK_SECONDS trop petit")


def default_settings(root: Path | None = None) -> Settings:
    base = (root or Path(__file__).resolve().parents[2]).resolve()
    data_dir = _env_path("CARNET_DATA_DIR", base / "data")
    var_dir = _env_path("CARNET_VAR_DIR", base / "var")
    settings = Settings(
        root=base,
        data_dir=data_dir,
        var_dir=var_dir,
        web_dir=_env_path("CARNET_WEB_DIR", base / "web"),
        db_path=_env_path("CARNET_DB_PATH", data_dir / "carnet.sqlite3"),
        backup_dir=_env_path("CARNET_BACKUP_DIR", var_dir / "backups"),
    )
    return settings
