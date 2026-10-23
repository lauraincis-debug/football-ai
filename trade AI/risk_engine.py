"""Moteur de risque pur : évalue une proposition de trade contre l'état de risque et les limites.

Aucune dépendance à SQLite, FastAPI ou à un courtier : les fonctions sont déterministes et testables.
Le moteur ne transmet jamais d'ordre. Il renvoie la liste des violations (vide = proposition acceptable).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Mapping, Optional


@dataclass(frozen=True)
class Proposition:
    instrument: str
    side: str  # "long" ou "short"
    entry: float
    stop: float
    quantity: float


@dataclass(frozen=True)
class EtatRisque:
    capital: float
    day_pnl: float
    week_pnl: float
    drawdown: float
    losses_in_row: int
    trades_today: int
    emergency_stop: bool = False


@dataclass(frozen=True)
class Violation:
    code: str
    message: str
    http_status: int

    def to_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "http_status": self.http_status}


def risque_du_trade(p: Proposition) -> float:
    """Perte maximale en devise si le stop est touché."""
    return abs(p.entry - p.stop) * p.quantity


def evaluer_nouveau_trade(
    p: Proposition,
    etat: EtatRisque,
    limites: Mapping[str, float],
    instruments_autorises: Optional[Iterable[str]] = None,
) -> list[Violation]:
    """Retourne les violations dans l'ordre de priorité (la première est bloquante en premier)."""
    v: list[Violation] = []

    if etat.emergency_stop:
        v.append(Violation("arret_urgence", "Arrêt d'urgence actif.", 423))

    if instruments_autorises is not None and p.instrument.upper() not in {i.upper() for i in instruments_autorises}:
        v.append(Violation("instrument_non_autorise", f"Instrument non autorisé : {p.instrument}.", 422))

    if etat.trades_today >= limites["trades_max_jour"]:
        v.append(Violation("trades_max_jour", "Plafond de trades quotidiens atteint.", 409))

    if etat.losses_in_row >= limites["pertes_consecutives_max"]:
        v.append(Violation("pertes_consecutives", "Plafond de pertes consécutives atteint.", 409))

    if etat.day_pnl <= -limites["capital_alloue"] * limites["perte_max_jour"]:
        v.append(Violation("perte_max_jour", "Limite de perte journalière atteinte.", 409))

    if etat.week_pnl <= -limites["capital_alloue"] * limites["perte_max_semaine"]:
        v.append(Violation("perte_max_semaine", "Limite de perte hebdomadaire atteinte.", 409))

    if etat.drawdown >= limites["drawdown_max"]:
        v.append(Violation("drawdown_max", "Drawdown maximal atteint.", 409))

    if p.side == "long" and p.stop >= p.entry:
        v.append(Violation("stop_invalide", "Stop long invalide : il doit être sous l'entrée.", 422))
    if p.side == "short" and p.stop <= p.entry:
        v.append(Violation("stop_invalide", "Stop short invalide : il doit être au-dessus de l'entrée.", 422))

    if etat.capital <= 0:
        v.append(Violation("capital_epuise", "Capital disponible nul ou négatif.", 409))
        return v

    risque = risque_du_trade(p)
    risque_max = etat.capital * limites["risque_par_trade"]
    if risque > risque_max + 1e-9:
        v.append(Violation(
            "risque_par_trade",
            f"Risque du trade ({risque:.2f}) supérieur au plafond ({risque_max:.2f}).",
            409,
        ))

    exposition = p.entry * p.quantity
    if exposition / etat.capital > limites["levier_max"] + 1e-9:
        v.append(Violation("levier_max", "Levier/exposition supérieur à la limite.", 409))

    return v
