"""Registre persistant des intentions d'ordre, historique des rapprochements et gel des envois.

Règles :
- Chaque intention a un `client_order_id` unique (idempotence) : une même intention ne peut être créée deux fois.
- Les transitions d'état sont contrôlées. Un résultat ambigu passe en `ambiguous`.
- Aucune transition automatique depuis `ambiguous` : seule une résolution manuelle (après contrôle chez le courtier)
  peut la clore. Il n'y a jamais de renvoi automatique d'un ordre.
- Les envois sont gelés tant qu'il existe une intention non résolue, un arrêt d'urgence, ou si le dernier
  rapprochement n'est pas réussi (ou n'existe pas).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS order_intents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_order_id TEXT NOT NULL UNIQUE,
  venue TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  price REAL,
  status TEXT NOT NULL,
  broker_order_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  details TEXT NOT NULL
);
"""

PENDING = "pending"
SUBMITTED = "submitted"
AMBIGUOUS = "ambiguous"
FILLED = "filled"
REJECTED = "rejected"
RESOLVED_FILLED = "resolved_filled"
RESOLVED_REJECTED = "resolved_rejected"

UNRESOLVED = (PENDING, SUBMITTED, AMBIGUOUS)

TRANSITIONS = {
    PENDING: {SUBMITTED, REJECTED, AMBIGUOUS},
    SUBMITTED: {FILLED, REJECTED, AMBIGUOUS},
    AMBIGUOUS: {RESOLVED_FILLED, RESOLVED_REJECTED},
    # Résolution manuelle possible depuis les états non résolus (après contrôle chez le courtier).
}
TRANSITIONS[PENDING] |= {RESOLVED_FILLED, RESOLVED_REJECTED}
TRANSITIONS[SUBMITTED] |= {RESOLVED_FILLED, RESOLVED_REJECTED}

MANUAL_OUTCOMES = {"filled": RESOLVED_FILLED, "rejected": RESOLVED_REJECTED}


class DuplicateIntentError(ValueError):
    pass


class InvalidTransitionError(ValueError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def creer_intention(con, client_order_id: str, venue: str, symbol: str, side: str,
                    quantity: float, price: Optional[float]) -> None:
    if not client_order_id or venue not in ("mt5", "crypto") or side not in ("buy", "sell"):
        raise ValueError("Intention invalide : client_order_id, venue (mt5|crypto) et side (buy|sell) requis.")
    if quantity <= 0:
        raise ValueError("Quantité d'intention doit être positive.")
    now = _now()
    try:
        with con:
            con.execute(
                "INSERT INTO order_intents(client_order_id,venue,symbol,side,quantity,price,status,created_at,updated_at)"
                " VALUES(?,?,?,?,?,?,?,?,?)",
                (client_order_id, venue, symbol, side, quantity, price, PENDING, now, now),
            )
    except Exception as exc:  # sqlite3.IntegrityError sur client_order_id dupliqué
        if "UNIQUE" in str(exc):
            raise DuplicateIntentError(f"Intention déjà enregistrée : {client_order_id}") from exc
        raise


def _statut(con, client_order_id: str) -> str:
    row = con.execute("SELECT status FROM order_intents WHERE client_order_id=?", (client_order_id,)).fetchone()
    if row is None:
        raise KeyError(f"Intention inconnue : {client_order_id}")
    return row["status"]


def changer_statut(con, client_order_id: str, nouveau: str, broker_order_id: Optional[str] = None,
                   erreur: Optional[str] = None) -> None:
    actuel = _statut(con, client_order_id)
    if nouveau not in TRANSITIONS.get(actuel, set()):
        raise InvalidTransitionError(f"Transition interdite : {actuel} → {nouveau}")
    with con:
        con.execute(
            "UPDATE order_intents SET status=?, broker_order_id=COALESCE(?,broker_order_id),"
            " last_error=COALESCE(?,last_error), updated_at=? WHERE client_order_id=?",
            (nouveau, broker_order_id, erreur, _now(), client_order_id),
        )


def resoudre_manuellement(con, client_order_id: str, issue: str, note: str = "") -> str:
    """Clôt une intention non résolue après contrôle humain chez le courtier. issue ∈ {filled, rejected}."""
    if issue not in MANUAL_OUTCOMES:
        raise ValueError("Issue invalide : filled ou rejected.")
    cible = MANUAL_OUTCOMES[issue]
    actuel = _statut(con, client_order_id)
    if actuel not in UNRESOLVED:
        raise InvalidTransitionError(f"Intention déjà résolue ou clôturée : {actuel}")
    changer_statut(con, client_order_id, cible, erreur=note or None)
    return cible


def lister_intentions(con, limite: int = 200) -> list[dict]:
    rows = con.execute("SELECT * FROM order_intents ORDER BY id DESC LIMIT ?", (limite,)).fetchall()
    return [dict(r) for r in rows]


def intentions_non_resolues(con) -> list[dict]:
    marks = ",".join("?" * len(UNRESOLVED))
    rows = con.execute(f"SELECT * FROM order_intents WHERE status IN ({marks}) ORDER BY id", UNRESOLVED).fetchall()
    return [dict(r) for r in rows]


def enregistrer_rapport(con, ok: bool, details: dict) -> int:
    with con:
        cur = con.execute(
            "INSERT INTO reconciliation_runs(created_at,status,details) VALUES(?,?,?)",
            (_now(), "ok" if ok else "echec", json.dumps(details, ensure_ascii=False, sort_keys=True)),
        )
    return cur.lastrowid


def dernier_rapport(con) -> Optional[dict]:
    row = con.execute("SELECT * FROM reconciliation_runs ORDER BY id DESC LIMIT 1").fetchone()
    if row is None:
        return None
    d = dict(row)
    d["details"] = json.loads(d["details"])
    return d


def lister_rapports(con, limite: int = 50) -> list[dict]:
    rows = con.execute("SELECT * FROM reconciliation_runs ORDER BY id DESC LIMIT ?", (limite,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["details"] = json.loads(d["details"])
        out.append(d)
    return out


def raisons_gel(con, arret_urgence: bool) -> list[str]:
    """Liste des raisons qui empêchent tout nouvel envoi d'ordre réel. Liste vide = envois possibles."""
    raisons: list[str] = []
    if arret_urgence:
        raisons.append("arret_urgence")
    n = len(intentions_non_resolues(con))
    if n:
        raisons.append(f"intentions_non_resolues:{n}")
    rapport = dernier_rapport(con)
    if rapport is None:
        raisons.append("rapprochement_absent")
    elif rapport["status"] != "ok":
        raisons.append("rapprochement_en_echec")
    return raisons
