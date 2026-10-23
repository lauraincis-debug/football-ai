"""Rapprochement pur entre l'état local et l'instantané d'un courtier.

Le module ne contacte aucun courtier : il compare deux états fournis par l'appelant.
Tout écart produit un rapport en échec. Les écarts ne sont jamais corrigés automatiquement.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Mapping


@dataclass(frozen=True)
class InstantaneCourtier:
    positions: Mapping[str, float]  # symbole -> quantité signée (+ long, - short)
    ordres_ouverts: frozenset = field(default_factory=frozenset)  # identifiants d'ordres ouverts chez le courtier


@dataclass(frozen=True)
class Ecart:
    code: str
    cible: str
    detail: str

    def to_dict(self) -> dict:
        return {"code": self.code, "cible": self.cible, "detail": self.detail}


@dataclass(frozen=True)
class RapportRapprochement:
    ok: bool
    ecarts: tuple

    def to_dict(self) -> dict:
        return {"ok": self.ok, "ecarts": [e.to_dict() for e in self.ecarts]}


def rapprocher(
    positions_locales: Mapping[str, float],
    ordres_locaux_ouverts: Iterable[str],
    instantane: InstantaneCourtier,
    tolerance: float = 1e-9,
    intentions_non_resolues: Iterable[str] = (),
) -> RapportRapprochement:
    ecarts: list[Ecart] = []

    symboles = set(positions_locales) | set(instantane.positions)
    for symbole in sorted(symboles):
        local = float(positions_locales.get(symbole, 0.0))
        courtier = float(instantane.positions.get(symbole, 0.0))
        if abs(local - courtier) > tolerance:
            ecarts.append(Ecart(
                "position_ecart", symbole,
                f"local={local} courtier={courtier}",
            ))

    locaux = set(ordres_locaux_ouverts)
    for ordre in sorted(instantane.ordres_ouverts - locaux):
        ecarts.append(Ecart("ordre_inconnu_local", ordre, "Ordre ouvert chez le courtier absent du registre local."))
    for ordre in sorted(locaux - set(instantane.ordres_ouverts)):
        ecarts.append(Ecart("ordre_local_absent_chez_courtier", ordre,
                            "Ordre local ouvert absent chez le courtier (exécuté ou annulé ?)."))

    for cid in sorted(set(intentions_non_resolues)):
        ecarts.append(Ecart("intention_non_resolue", cid, "Intention ambiguë à résoudre manuellement."))

    return RapportRapprochement(ok=not ecarts, ecarts=tuple(ecarts))
