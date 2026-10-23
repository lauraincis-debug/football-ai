"""Exécute un rapprochement réel : lit le courtier (lecture seule), compare à l'état local, produit un rapport.

Principes fail-closed :
- Toute erreur de lecture courtier (identifiants absents, module MT5 manquant, timeout) donne un rapport en échec.
- Une position locale ne peut pas être vérifiée sur un compte spot (les soldes ne sont pas des positions) : écart.
- Aucune écriture chez le courtier. Aucun ordre n'est émis par ce module.
"""
from __future__ import annotations

from typing import Callable, Optional

import order_ledger
from reconciliation import Ecart, InstantaneCourtier, RapportRapprochement, rapprocher

VENUES = ("mt5", "crypto")


def snapshot_mt5(positions: list[dict]) -> InstantaneCourtier:
    """MT5 : type 0 = achat (long), type 1 = vente (short). Les volumes sont additionnés par symbole."""
    signed: dict[str, float] = {}
    for p in positions or []:
        signe = 1.0 if int(p.get("type", 0)) == 0 else -1.0
        signed[p["symbol"]] = signed.get(p["symbol"], 0.0) + signe * float(p["volume"])
    return InstantaneCourtier(positions={s: q for s, q in signed.items() if abs(q) > 1e-12})


def snapshot_crypto(brut: dict) -> tuple[InstantaneCourtier, Optional[str]]:
    """CCXT : ordres ouverts par id. Positions seulement si la plateforme les expose (dérivés).

    Retourne aussi une note si les positions ne sont pas exposées (spot)."""
    ordres = frozenset(str(o.get("id")) for o in (brut.get("open_orders") or []) if o.get("id") is not None)
    positions_brutes = brut.get("positions")
    if positions_brutes is None:
        return InstantaneCourtier(positions={}, ordres_ouverts=ordres), "positions_non_exposees"
    signed: dict[str, float] = {}
    for p in positions_brutes:
        contrats = float(p.get("contracts") or 0.0)
        signe = -1.0 if str(p.get("side", "long")).lower() == "short" else 1.0
        signed[p["symbol"]] = signed.get(p["symbol"], 0.0) + signe * contrats
    return InstantaneCourtier(positions={s: q for s, q in signed.items() if abs(q) > 1e-12},
                              ordres_ouverts=ordres), None


def lire_courtier_par_defaut(venue: str) -> dict:
    """Lecture réelle, instanciée à la demande. Lève une exception si le courtier n'est pas configuré."""
    if venue == "mt5":
        from mt5_adapter import MetaTrader5Adapter
        return {"positions": MetaTrader5Adapter().reconcile_positions()}
    if venue == "crypto":
        from crypto_adapter import CryptoAdapter
        return CryptoAdapter().reconcile()
    raise ValueError("venue doit être 'mt5' ou 'crypto'.")


def executer(con, venue: str, lire_courtier: Callable[[str], dict] = lire_courtier_par_defaut) -> dict:
    if venue not in VENUES:
        raise ValueError("venue doit être 'mt5' ou 'crypto'.")
    positions_locales = order_ledger.positions_depuis_intentions(con, venue)
    ordres_locaux = order_ledger.ordres_ouverts_locaux(con, venue)
    non_resolues = [i["client_order_id"] for i in order_ledger.intentions_non_resolues(con) if i["venue"] == venue]

    try:
        brut = lire_courtier(venue)
        if venue == "mt5":
            instantane, note = snapshot_mt5(brut["positions"]), None
        else:
            instantane, note = snapshot_crypto(brut)
    except Exception as exc:  # fail-closed : aucune hypothèse sur l'état courtier
        ecarts = (Ecart("courtier_injoignable", venue, f"{type(exc).__name__}: {str(exc)[:200]}"),)
        rapport = RapportRapprochement(ok=False, ecarts=ecarts)
        return {"venue": venue, **rapport.to_dict(), "positions_locales": positions_locales}

    rapport = rapprocher(positions_locales, ordres_locaux, instantane, intentions_non_resolues=non_resolues)
    extra = ()
    if note == "positions_non_exposees" and positions_locales:
        extra = (Ecart("positions_non_verifiables", venue,
                       "La plateforme n'expose pas les positions ; positions locales non vérifiables."),)
    if extra:
        rapport = RapportRapprochement(ok=False, ecarts=rapport.ecarts + extra)
    return {"venue": venue, **rapport.to_dict(), "positions_locales": positions_locales,
            "positions_courtier": dict(instantane.positions), "ordres_ouverts_courtier": sorted(instantane.ordres_ouverts)}
