"""Utilitaires transverses : temps UTC, Decimal, identifiants, JSON canonique.

Règles du cahier des charges appliquées ici :
- tout horodatage interne est stocké en UTC (section 13.2 et 20.1) ;
- les montants et les quantités utilisent ``Decimal`` pour éviter les erreurs
  d'arrondi binaires dans le moteur de risque (section 6) ;
- le JSON canonique sert au chaînage cryptographique du journal (section 20.1).
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
import math
import re
import uuid
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal, InvalidOperation, localcontext
from typing import Any, Iterable, Mapping

UTC = _dt.timezone.utc
ZERO = Decimal("0")
ONE = Decimal("1")

_NEW_YORK_FALLBACK = _dt.timezone(_dt.timedelta(hours=-5), "America/New_York")


# --------------------------------------------------------------------------
# Temps
# --------------------------------------------------------------------------
def now_utc() -> _dt.datetime:
    """Horodatage courant, conscient du fuseau, en UTC."""
    return _dt.datetime.now(tz=UTC)


def to_utc(value: _dt.datetime | str | int | float | None) -> _dt.datetime | None:
    """Normalise une valeur en datetime UTC.

    Accepte un datetime naïf (interprété comme UTC), un timestamp epoch
    (secondes ou millisecondes) ou une chaîne ISO-8601.
    """
    if value is None:
        return None
    if isinstance(value, _dt.datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    if isinstance(value, (int, float)):
        seconds = float(value)
        if seconds > 1e11:  # millisecondes
            seconds /= 1000.0
        return _dt.datetime.fromtimestamp(seconds, tz=UTC)
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = _dt.datetime.fromisoformat(text)
    except ValueError as exc:  # pragma: no cover - chemin défensif
        raise ValueError(f"horodatage illisible: {value!r}") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def iso(value: _dt.datetime | None) -> str | None:
    """Sérialise un datetime en ISO-8601 UTC avec suffixe ``Z``."""
    if value is None:
        return None
    return to_utc(value).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_iso(value: str | None) -> _dt.datetime | None:
    if not value:
        return None
    return to_utc(value)


def epoch_ms(value: _dt.datetime | None = None) -> int:
    moment = to_utc(value) or now_utc()
    return int(moment.timestamp() * 1000)


def age_seconds(then: _dt.datetime | None, reference: _dt.datetime | None = None) -> float:
    """Âge en secondes d'un horodatage ; ``inf`` si inconnu."""
    then_utc = to_utc(then)
    if then_utc is None:
        return math.inf
    ref = to_utc(reference) or now_utc()
    return max(0.0, (ref - then_utc).total_seconds())


def new_york_tz():
    """Fuseau de New York, avec repli hors ligne si la base tz est absente."""
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo("America/New_York")
    except Exception:  # pragma: no cover - dépend de l'image système
        return _NEW_YORK_FALLBACK


def trading_day(moment: _dt.datetime | None, reset_hour_ny: int = 17) -> _dt.date:
    """Journée de négociation : bascule à 17h00 heure de New York (section 5.1)."""
    moment = to_utc(moment) or now_utc()
    local = moment.astimezone(new_york_tz())
    if local.hour >= reset_hour_ny:
        return local.date()
    return local.date() - _dt.timedelta(days=1)


def trading_week(moment: _dt.datetime | None, reset_hour_ny: int = 17) -> tuple[int, int]:
    """Semaine de négociation ISO alignée sur la remise à zéro quotidienne."""
    day = trading_day(moment, reset_hour_ny)
    iso_year, iso_week, _ = day.isocalendar()
    return iso_year, iso_week


# --------------------------------------------------------------------------
# Décimales
# --------------------------------------------------------------------------
def D(value: Any, default: Decimal | None = None) -> Decimal:
    """Convertit prudemment en Decimal (float via ``str`` pour éviter le bruit)."""
    if isinstance(value, Decimal):
        return value
    if value is None or value == "":
        if default is not None:
            return default
        raise InvalidOperation("valeur numérique absente")
    if isinstance(value, bool):
        raise InvalidOperation("booléen non numérique")
    if isinstance(value, float):
        value = repr(value)
    try:
        result = Decimal(str(value).strip())
    except (InvalidOperation, ValueError) as exc:
        raise InvalidOperation(f"valeur non numérique: {value!r}") from exc
    if not result.is_finite():
        raise InvalidOperation(f"valeur non finie: {value!r}")
    return result


def quantize(value: Decimal | float | str, step: Decimal | float | str) -> Decimal:
    """Arrondit vers le bas au pas autorisé (taille de lot, précision de prix)."""
    val, stp = D(value), D(step)
    if stp <= ZERO:
        return val
    with localcontext() as ctx:
        ctx.prec = 28
        return (val / stp).to_integral_value(rounding=ROUND_DOWN) * stp


def money(value: Decimal | float | str, places: int = 2) -> Decimal:
    q = Decimal(1).scaleb(-places)
    return D(value).quantize(q, rounding=ROUND_HALF_UP)


def dstr(value: Any) -> str:
    """Chaîne stable pour un Decimal (sans zéros inutiles)."""
    dec = D(value)
    text = format(dec.normalize(), "f")
    return text


def as_number(value: Any) -> Any:
    """Convertit récursivement les Decimal en float pour la sérialisation JSON."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, Mapping):
        return {k: as_number(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [as_number(v) for v in value]
    if isinstance(value, _dt.datetime):
        return iso(value)
    if isinstance(value, _dt.date):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


# --------------------------------------------------------------------------
# Identifiants et JSON canonique
# --------------------------------------------------------------------------
def new_uuid() -> str:
    return str(uuid.uuid4())


def new_client_order_id(prefix: str = "cdt") -> str:
    """Identifiant client lisible, unique, accepté par la plupart des APIs."""
    return f"{prefix}-{uuid.uuid4().hex[:20]}"


def canonical_json(payload: Any) -> str:
    return json.dumps(as_number(payload), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_hex(data: str | bytes) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def hmac_sha256(key: str | bytes, message: str | bytes) -> str:
    import hmac

    k = key.encode() if isinstance(key, str) else key
    m = message.encode() if isinstance(message, str) else message
    return hmac.new(k, m, hashlib.sha256).hexdigest()


def chunked(items: Iterable[Any], size: int) -> list[list[Any]]:
    bucket: list[Any] = []
    out: list[list[Any]] = []
    for item in items:
        bucket.append(item)
        if len(bucket) >= size:
            out.append(bucket)
            bucket = []
    if bucket:
        out.append(bucket)
    return out


# --------------------------------------------------------------------------
# Masquage des secrets dans les journaux (section 17.1)
# --------------------------------------------------------------------------
_SECRET_PATTERNS = [
    re.compile(r"(?i)(api[_-]?key|api[_-]?secret|secret|token|password|passwd|authorization|bearer)"
               r"\s*[:=]\s*[\"']?([A-Za-z0-9_\-\.]{6,})"),
    re.compile(r"(?i)(sk-[A-Za-z0-9]{10,})"),
]


def redact(text: Any) -> str:
    """Supprime tout secret potentiel d'une chaîne destinée aux journaux."""
    out = str(text)
    for pattern in _SECRET_PATTERNS:
        if pattern.groups >= 2:
            out = pattern.sub(lambda m: f"{m.group(1)}=***", out)
        else:
            out = pattern.sub("***", out)
    return out


SENSITIVE_KEYS = {
    "password", "password_hash", "secret", "api_key", "api_secret", "token",
    "session_token", "totp_secret", "private_key", "passphrase", "authorization",
}


def scrub_mapping(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Copie d'un dictionnaire sans clé sensible (pour logs et réponses d'audit)."""
    clean: dict[str, Any] = {}
    for key, value in payload.items():
        if str(key).lower() in SENSITIVE_KEYS:
            clean[key] = "***"
        elif isinstance(value, Mapping):
            clean[key] = scrub_mapping(value)
        elif isinstance(value, str):
            clean[key] = redact(value)
        else:
            clean[key] = value
    return clean
