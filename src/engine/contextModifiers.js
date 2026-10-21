import { FANTASY_PLAYERS } from "../data/players.js";
import { canonicalTeamName, normalizeKey } from "../data/clubs.js";

/**
 * 🏥 CONTEXTE TACTIQUE PRO : ABSENCES STARS, FATIGUE (<72H) & ENJEU DU MATCH
 * Calcule des multiplicateurs xG et ajustements Elo calibrés selon les absents réels,
 * la fraîcheur physique et le contexte compétitif de la rencontre.
 */

export const FATIGUE_OPTIONS = [
  { id: "fresh", label: "🟢 Fraîcheur normale (5+ j.)", atkMult: 1.0, defConcedeMult: 1.0, eloDelta: 0 },
  { id: "europe72h", label: "🟡 Coupe d'Europe < 72h", atkMult: 0.94, defConcedeMult: 1.08, eloDelta: -22 },
  { id: "heavy", label: "🔴 Enchaînement lourd / Voyage", atkMult: 0.89, defConcedeMult: 1.14, eloDelta: -42 },
];

export const STAKES_OPTIONS = [
  { id: "standard", label: "⚽ Match de championnat standard", tempoMult: 1.0, rhoShift: 0, note: "" },
  {
    id: "derby",
    label: "🔥 Derby / Classique haute tension",
    tempoMult: 0.96,
    rhoShift: -0.03,
    note: "Derby sous haute intensité : duels fermés et prime au mental.",
  },
  {
    id: "knockout",
    label: "🏆 Match décisif / K.O. retour ouvert",
    tempoMult: 1.09,
    rhoShift: 0.02,
    note: "Enjeu qualificatif : espaces accrus en seconde période (+9% rythme xG).",
  },
  {
    id: "rotation",
    label: "🔄 Équipe déjà qualifiée / Rotation",
    tempoMult: 0.95,
    rhoShift: -0.02,
    note: "Gestion d'effectif probable du favori (écart Elo resserré de 20%).",
  },
];

export function getSquadStarsForTeam(teamName) {
  const canon = normalizeKey(canonicalTeamName(teamName));
  const matched = FANTASY_PLAYERS.filter((p) => {
    const pClub = normalizeKey(canonicalTeamName(p.club));
    return pClub === canon || pClub.includes(canon) || canon.includes(pClub);
  });

  if (matched.length > 0) return matched;

  // Profils génériques calibrés si un club hors Top 50 Fantasy est sélectionné
  return [
    { id: `gen-fwd-${canon}`, name: `Buteur n°9 (${teamName})`, club: teamName, pos: "FWD", price: 8.5, xg90: 0.48, xa90: 0.18, form: 8.4 },
    { id: `gen-mid-${canon}`, name: `Meneur créatif (${teamName})`, club: teamName, pos: "MID", price: 7.8, xg90: 0.24, xa90: 0.34, form: 8.3 },
    { id: `gen-def-${canon}`, name: `Patron défensif (${teamName})`, club: teamName, pos: "DEF", price: 6.0, xg90: 0.08, xa90: 0.08, form: 8.3 },
    { id: `gen-gkp-${canon}`, name: `Gardien n°1 (${teamName})`, club: teamName, pos: "GKP", price: 5.5, xg90: 0.0, xa90: 0.01, form: 8.3 },
  ];
}

function computeAbsenceImpact(absentIds = [], teamName) {
  if (!absentIds || absentIds.length === 0) {
    return { atkMult: 1.0, concedeMult: 1.0, eloPenalty: 0, absentNames: [] };
  }
  const squad = getSquadStarsForTeam(teamName);
  const absents = squad.filter((p) => absentIds.includes(p.id));

  let atkLoss = 0;
  let defWeakness = 0;
  let eloPenalty = 0;

  for (const p of absents) {
    if (p.pos === "FWD") {
      const starWeight = Math.min(0.16, 0.06 + (p.xg90 || 0.4) * 0.12);
      atkLoss += starWeight;
      eloPenalty += Math.round(starWeight * 260);
    } else if (p.pos === "MID") {
      const starWeight = Math.min(0.14, 0.05 + ((p.xg90 || 0.2) + (p.xa90 || 0.25)) * 0.09);
      atkLoss += starWeight * 0.85;
      defWeakness += 0.04;
      eloPenalty += Math.round(starWeight * 250);
    } else if (p.pos === "DEF") {
      atkLoss += 0.025;
      defWeakness += 0.085;
      eloPenalty += 24;
    } else if (p.pos === "GKP") {
      defWeakness += 0.115;
      eloPenalty += 30;
    }
  }

  return {
    atkMult: Math.max(0.68, 1 - atkLoss),
    concedeMult: Math.min(1.36, 1 + defWeakness),
    eloPenalty: Math.min(115, eloPenalty),
    absentNames: absents.map((a) => a.name),
  };
}

export function evaluateMatchContextModifiers(homeTeam, awayTeam, context = {}) {
  if (!context) {
    return {
      active: false,
      xgHomeMult: 1,
      xgAwayMult: 1,
      eloDeltaHome: 0,
      eloDeltaAway: 0,
      rhoShift: 0,
      eloCompression: 1,
      notes: [],
    };
  }

  const absH = computeAbsenceImpact(context.absentHomeIds || [], homeTeam);
  const absA = computeAbsenceImpact(context.absentAwayIds || [], awayTeam);

  const fatH = FATIGUE_OPTIONS.find((f) => f.id === context.fatigueHome) || FATIGUE_OPTIONS[0];
  const fatA = FATIGUE_OPTIONS.find((f) => f.id === context.fatigueAway) || FATIGUE_OPTIONS[0];
  const stake = STAKES_OPTIONS.find((s) => s.id === context.stakes) || STAKES_OPTIONS[0];

  const xgHomeMult = absH.atkMult * fatH.atkMult * absA.concedeMult * fatA.defConcedeMult * stake.tempoMult;
  const xgAwayMult = absA.atkMult * fatA.atkMult * absH.concedeMult * fatH.defConcedeMult * stake.tempoMult;
  const eloDeltaHome = -absH.eloPenalty + fatH.eloDelta;
  const eloDeltaAway = -absA.eloPenalty + fatA.eloDelta;

  const notes = [];
  if (absH.absentNames.length > 0) {
    notes.push(`🏥 Absents ${homeTeam} : ${absH.absentNames.join(", ")} (${eloDeltaHome} Elo)`);
  }
  if (absA.absentNames.length > 0) {
    notes.push(`🏥 Absents ${awayTeam} : ${absA.absentNames.join(", ")} (${eloDeltaAway} Elo)`);
  }
  if (fatH.id !== "fresh") notes.push(`⏱️ ${homeTeam} : ${fatH.label}`);
  if (fatA.id !== "fresh") notes.push(`⏱️ ${awayTeam} : ${fatA.label}`);
  if (stake.note) notes.push(stake.note);

  const active =
    absH.absentNames.length > 0 ||
    absA.absentNames.length > 0 ||
    fatH.id !== "fresh" ||
    fatA.id !== "fresh" ||
    stake.id !== "standard";

  return {
    active,
    xgHomeMult: Math.round(xgHomeMult * 1000) / 1000,
    xgAwayMult: Math.round(xgAwayMult * 1000) / 1000,
    eloDeltaHome,
    eloDeltaAway,
    rhoShift: stake.rhoShift,
    eloCompression: stake.id === "rotation" ? 0.8 : 1.0,
    notes,
  };
}
