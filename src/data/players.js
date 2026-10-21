import { resolveClub, normalizeKey } from "./clubs.js";

// ============================================================
// BASE FANTASY IA — JOUEURS RÉELS & OPTIMISEUR D'ÉQUIPE 100 M€
// Projection dynamique liée aux Expected Goals (xG) & Clean Sheets IA
// ============================================================

export const FANTASY_PLAYERS = [
  // ================= GARDIENS (GKP) =================
  { id: "gkp-1", name: "Gianluigi Donnarumma", club: "Manchester City", league: "premier", pos: "GKP", price: 6.0, xg90: 0.0, xa90: 0.02, saveBonus: 1.35, form: 8.6 },
  { id: "gkp-2", name: "Alisson Becker", club: "Liverpool", league: "premier", pos: "GKP", price: 5.8, xg90: 0.0, xa90: 0.03, saveBonus: 1.3, form: 8.5 },
  { id: "gkp-3", name: "David Raya", club: "Arsenal", league: "premier", pos: "GKP", price: 5.9, xg90: 0.0, xa90: 0.02, saveBonus: 1.25, form: 8.7 },
  { id: "gkp-4", name: "Thibaut Courtois", club: "Real Madrid", league: "liga", pos: "GKP", price: 6.0, xg90: 0.0, xa90: 0.01, saveBonus: 1.4, form: 8.8 },
  { id: "gkp-5", name: "Yann Sommer", club: "Inter Milan", league: "seriea", pos: "GKP", price: 5.5, xg90: 0.0, xa90: 0.01, saveBonus: 1.28, form: 8.3 },
  { id: "gkp-6", name: "Lucas Chevalier", club: "PSG", league: "ligue1", pos: "GKP", price: 5.6, xg90: 0.0, xa90: 0.02, saveBonus: 1.32, form: 8.5 },
  { id: "gkp-7", name: "Mike Maignan", club: "AC Milan", league: "seriea", pos: "GKP", price: 5.4, xg90: 0.0, xa90: 0.05, saveBonus: 1.3, form: 8.1 },
  { id: "gkp-8", name: "Yahia Fofana", club: "Angers", league: "ligue1", pos: "GKP", price: 4.5, xg90: 0.0, xa90: 0.01, saveBonus: 1.55, form: 7.9 },

  // ================= DÉFENSEURS (DEF) =================
  { id: "def-1", name: "Achraf Hakimi", club: "PSG", league: "ligue1", pos: "DEF", price: 7.2, xg90: 0.19, xa90: 0.31, saveBonus: 0.8, form: 9.2 },
  { id: "def-2", name: "Gabriel Magalhães", club: "Arsenal", league: "premier", pos: "DEF", price: 6.6, xg90: 0.16, xa90: 0.06, saveBonus: 0.9, form: 8.9 },
  { id: "def-3", name: "William Saliba", club: "Arsenal", league: "premier", pos: "DEF", price: 6.4, xg90: 0.07, xa90: 0.05, saveBonus: 0.95, form: 8.7 },
  { id: "def-4", name: "Virgil van Dijk", club: "Liverpool", league: "premier", pos: "DEF", price: 6.7, xg90: 0.13, xa90: 0.06, saveBonus: 0.9, form: 8.8 },
  { id: "def-5", name: "Trent Alexander-Arnold", club: "Real Madrid", league: "liga", pos: "DEF", price: 7.0, xg90: 0.12, xa90: 0.34, saveBonus: 0.75, form: 8.6 },
  { id: "def-6", name: "Federico Dimarco", club: "Inter Milan", league: "seriea", pos: "DEF", price: 6.5, xg90: 0.15, xa90: 0.30, saveBonus: 0.8, form: 8.8 },
  { id: "def-7", name: "Nuno Mendes", club: "PSG", league: "ligue1", pos: "DEF", price: 6.2, xg90: 0.09, xa90: 0.24, saveBonus: 0.82, form: 8.5 },
  { id: "def-8", name: "Josko Gvardiol", club: "Manchester City", league: "premier", pos: "DEF", price: 6.3, xg90: 0.15, xa90: 0.11, saveBonus: 0.8, form: 8.4 },
  { id: "def-9", name: "Jules Koundé", club: "FC Barcelone", league: "liga", pos: "DEF", price: 6.1, xg90: 0.08, xa90: 0.18, saveBonus: 0.82, form: 8.5 },
  { id: "def-10", name: "Alphonso Davies", club: "Bayern Munich", league: "bundesliga", pos: "DEF", price: 6.0, xg90: 0.09, xa90: 0.22, saveBonus: 0.78, form: 8.3 },
  { id: "def-11", name: "Evan Ndicka", club: "AS Rome", league: "seriea", pos: "DEF", price: 5.2, xg90: 0.08, xa90: 0.05, saveBonus: 0.85, form: 8.1 },
  { id: "def-12", name: "Odilon Kossounou", club: "Atalanta", league: "seriea", pos: "DEF", price: 5.1, xg90: 0.06, xa90: 0.06, saveBonus: 0.84, form: 8.0 },
  { id: "def-13", name: "Wilfried Singo", club: "Monaco", league: "ligue1", pos: "DEF", price: 5.4, xg90: 0.09, xa90: 0.12, saveBonus: 0.82, form: 8.2 },
  { id: "def-14", name: "Antonee Robinson", club: "Fulham", league: "premier", pos: "DEF", price: 5.0, xg90: 0.04, xa90: 0.23, saveBonus: 0.76, form: 8.0 },

  // ================= MILIEUX (MID) =================
  { id: "mid-1", name: "Mohamed Salah", club: "Liverpool", league: "premier", pos: "MID", price: 13.4, xg90: 0.68, xa90: 0.41, saveBonus: 0.5, form: 9.6 },
  { id: "mid-2", name: "Lamine Yamal", club: "FC Barcelone", league: "liga", pos: "MID", price: 11.8, xg90: 0.42, xa90: 0.52, saveBonus: 0.6, form: 9.5 },
  { id: "mid-3", name: "Cole Palmer", club: "Chelsea", league: "premier", pos: "MID", price: 11.2, xg90: 0.54, xa90: 0.39, saveBonus: 0.55, form: 9.1 },
  { id: "mid-4", name: "Bukayo Saka", club: "Arsenal", league: "premier", pos: "MID", price: 10.8, xg90: 0.46, xa90: 0.44, saveBonus: 0.55, form: 9.2 },
  { id: "mid-5", name: "Jude Bellingham", club: "Real Madrid", league: "liga", pos: "MID", price: 10.6, xg90: 0.45, xa90: 0.29, saveBonus: 0.65, form: 9.0 },
  { id: "mid-6", name: "Jamal Musiala", club: "Bayern Munich", league: "bundesliga", pos: "MID", price: 10.4, xg90: 0.49, xa90: 0.36, saveBonus: 0.6, form: 9.1 },
  { id: "mid-7", name: "Florian Wirtz", club: "Liverpool", league: "premier", pos: "MID", price: 10.2, xg90: 0.41, xa90: 0.45, saveBonus: 0.6, form: 9.0 },
  { id: "mid-8", name: "Ousmane Dembélé", club: "PSG", league: "ligue1", pos: "MID", price: 10.0, xg90: 0.55, xa90: 0.42, saveBonus: 0.55, form: 9.3 },
  { id: "mid-9", name: "Bradley Barcola", club: "PSG", league: "ligue1", pos: "MID", price: 8.6, xg90: 0.48, xa90: 0.31, saveBonus: 0.5, form: 8.8 },
  { id: "mid-10", name: "Vitinha", club: "PSG", league: "ligue1", pos: "MID", price: 7.6, xg90: 0.22, xa90: 0.28, saveBonus: 0.85, form: 8.9 },
  { id: "mid-11", name: "Pedri", club: "FC Barcelone", league: "liga", pos: "MID", price: 8.0, xg90: 0.19, xa90: 0.33, saveBonus: 0.85, form: 8.9 },
  { id: "mid-12", name: "Michael Olise", club: "Bayern Munich", league: "bundesliga", pos: "MID", price: 9.4, xg90: 0.41, xa90: 0.48, saveBonus: 0.6, form: 9.1 },
  { id: "mid-13", name: "Simon Adingra", club: "Sunderland", league: "premier", pos: "MID", price: 6.4, xg90: 0.31, xa90: 0.24, saveBonus: 0.5, form: 8.1 },
  { id: "mid-14", name: "Mason Greenwood", club: "Marseille", league: "ligue1", pos: "MID", price: 8.2, xg90: 0.51, xa90: 0.22, saveBonus: 0.45, form: 8.7 },
  { id: "mid-15", name: "Hakan Çalhanoğlu", club: "Inter Milan", league: "seriea", pos: "MID", price: 7.8, xg90: 0.29, xa90: 0.27, saveBonus: 0.75, form: 8.5 },
  { id: "mid-16", name: "Seko Fofana", club: "Rennes", league: "ligue1", pos: "MID", price: 6.2, xg90: 0.21, xa90: 0.19, saveBonus: 0.72, form: 8.0 },

  // ================= ATTAQUANTS (FWD) =================
  { id: "fwd-1", name: "Kylian Mbappé", club: "Real Madrid", league: "liga", pos: "FWD", price: 14.5, xg90: 0.86, xa90: 0.26, saveBonus: 0.4, form: 9.6 },
  { id: "fwd-2", name: "Erling Haaland", club: "Manchester City", league: "premier", pos: "FWD", price: 14.8, xg90: 0.92, xa90: 0.14, saveBonus: 0.4, form: 9.5 },
  { id: "fwd-3", name: "Harry Kane", club: "Bayern Munich", league: "bundesliga", pos: "FWD", price: 13.2, xg90: 0.85, xa90: 0.25, saveBonus: 0.45, form: 9.4 },
  { id: "fwd-4", name: "Robert Lewandowski", club: "FC Barcelone", league: "liga", pos: "FWD", price: 11.6, xg90: 0.81, xa90: 0.16, saveBonus: 0.4, form: 9.0 },
  { id: "fwd-5", name: "Vinícius Júnior", club: "Real Madrid", league: "liga", pos: "FWD", price: 12.2, xg90: 0.56, xa90: 0.42, saveBonus: 0.45, form: 9.2 },
  { id: "fwd-6", name: "Lautaro Martínez", club: "Inter Milan", league: "seriea", pos: "FWD", price: 10.6, xg90: 0.64, xa90: 0.20, saveBonus: 0.45, form: 8.9 },
  { id: "fwd-7", name: "Serhou Guirassy", club: "Borussia Dortmund", league: "bundesliga", pos: "FWD", price: 9.2, xg90: 0.69, xa90: 0.17, saveBonus: 0.4, form: 8.8 },
  { id: "fwd-8", name: "Alexander Isak", club: "Liverpool", league: "premier", pos: "FWD", price: 9.8, xg90: 0.65, xa90: 0.19, saveBonus: 0.4, form: 8.9 },
  { id: "fwd-9", name: "Ademola Lookman", club: "Atalanta", league: "seriea", pos: "FWD", price: 8.8, xg90: 0.52, xa90: 0.31, saveBonus: 0.45, form: 8.8 },
  { id: "fwd-10", name: "Jonathan David", club: "Juventus", league: "seriea", pos: "FWD", price: 8.4, xg90: 0.56, xa90: 0.18, saveBonus: 0.4, form: 8.5 },
  { id: "fwd-11", name: "Oumar Diakité", club: "Reims", league: "ligue1", pos: "FWD", price: 6.5, xg90: 0.39, xa90: 0.18, saveBonus: 0.4, form: 8.0 },
  { id: "fwd-12", name: "Evann Guessand", club: "Aston Villa", league: "premier", pos: "FWD", price: 6.8, xg90: 0.41, xa90: 0.21, saveBonus: 0.42, form: 8.3 },
];

/**
 * Calcule l'espérance de points Fantasy officielle d'un joueur :
 * - Apparition 90 min : +2 pts
 * - Buts attendus : xG * (GKP/DEF: 6 pts, MID: 5 pts, FWD: 4 pts)
 * - Passes décisives attendues : xA * 3 pts
 * - Probabilité Clean Sheet club : P(CS) * (GKP/DEF: 4 pts, MID: 1 pt)
 * - Bonus BPS & forme + ajustement dynamique selon l'affiche réelle du jour !
 */
export function scoreFantasyPlayers(modelState, liveMatches = []) {
  // Indexer les prochains matchs par club s'il y en a aujourd'hui/demain
  const fixtureByClub = new Map();
  for (const m of liveMatches) {
    if (m.prediction) {
      fixtureByClub.set(normalizeKey(m.prediction.home), {
        opponent: m.prediction.away,
        isHome: true,
        clubXg: m.prediction.xg.home,
        oppXg: m.prediction.xg.away,
      });
      fixtureByClub.set(normalizeKey(m.prediction.away), {
        opponent: m.prediction.home,
        isHome: false,
        clubXg: m.prediction.xg.away,
        oppXg: m.prediction.xg.home,
      });
    }
  }

  return FANTASY_PLAYERS.map((p) => {
    const clubKey = normalizeKey(p.club);
    const teamProfile = modelState?.teams?.[clubKey] || resolveClub(p.club);
    const fix = fixtureByClub.get(clubKey);

    const clubXg = fix
      ? fix.clubXg
      : 1.55 * (teamProfile?.atk ?? 1.0);
    const oppXg = fix
      ? fix.oppXg
      : 1.2 * (teamProfile?.def ?? 1.0);

    const cleanSheetProb = Math.exp(-oppXg);
    const xgMultiplier = clubXg / 1.55;

    const goalPtsFactor = p.pos === "FWD" ? 4 : p.pos === "MID" ? 5 : 6;
    const csPtsFactor = p.pos === "GKP" || p.pos === "DEF" ? 4 : p.pos === "MID" ? 1 : 0;

    const expPts =
      2.0 +
      p.xg90 * xgMultiplier * goalPtsFactor +
      p.xa90 * xgMultiplier * 3.0 +
      cleanSheetProb * csPtsFactor +
      p.saveBonus * (p.form / 9.0);

    const expectedPoints = Math.round(expPts * 10) / 10;
    const valueRatio = Math.round((expectedPoints / p.price) * 100) / 100;

    return {
      ...p,
      expectedPoints,
      valueRatio,
      cleanSheetPct: Math.round(cleanSheetProb * 100),
      fixtureLabel: fix
        ? `${fix.isHome ? "vs" : "@"} ${fix.opponent}`
        : `Elo ${Math.round(teamProfile?.elo || 1750)}`,
    };
  }).sort((a, b) => b.expectedPoints - a.expectedPoints);
}

/**
 * Optimiseur d'équipe 11 titulaire sous contrainte de budget (ex: 100.0 M€)
 * et maximum 3 joueurs par même club (règle officielle FPL / UCL Fantasy).
 */
export function optimizeFantasySquad(scoredPlayers, budget = 100.0, formation = "1-4-3-3") {
  const [, dCount, mCount, fCount] = formation.split("-").map(Number);
  const quotas = { GKP: 1, DEF: dCount, MID: mCount, FWD: fCount };

  // Démarrer avec l'équipe valide la plus économique par rapport qualité/prix
  const selected = [];
  const clubCounts = {};

  const canAdd = (cand, currentList) => {
    if (currentList.some((x) => x.id === cand.id)) return false;
    const cnt = currentList.filter((x) => x.club === cand.club).length;
    return cnt < 3;
  };

  for (const pos of ["GKP", "DEF", "MID", "FWD"]) {
    const cheapPool = scoredPlayers
      .filter((p) => p.pos === pos)
      .sort((a, b) => a.price - b.price);
    for (const p of cheapPool) {
      if (selected.filter((s) => s.pos === pos).length >= quotas[pos]) break;
      if (canAdd(p, selected)) {
        selected.push(p);
        clubCounts[p.club] = (clubCounts[p.club] || 0) + 1;
      }
    }
  }

  // Montée locale gloutonne itérative maximisant le gain marginal d'Expected Points
  let improved = true;
  let guard = 0;
  while (improved && guard < 120) {
    improved = false;
    guard += 1;
    const currentCost = selected.reduce((s, p) => s + p.price, 0);

    let bestSwap = null;
    for (let i = 0; i < selected.length; i++) {
      const cur = selected[i];
      const others = selected.filter((_, idx) => idx !== i);
      const candidates = scoredPlayers.filter((c) => c.pos === cur.pos);

      for (const cand of candidates) {
        if (cand.expectedPoints <= cur.expectedPoints + 0.01) continue;
        if (!canAdd(cand, others)) continue;
        const newCost = currentCost - cur.price + cand.price;
        if (newCost > budget + 1e-6) continue;

        const gain = cand.expectedPoints - cur.expectedPoints;
        const efficiency = gain / Math.max(0.25, cand.price - cur.price + 0.5);
        if (!bestSwap || efficiency > bestSwap.efficiency) {
          bestSwap = { idx: i, cand, efficiency };
        }
      }
    }

    if (bestSwap) {
      selected[bestSwap.idx] = bestSwap.cand;
      improved = true;
    }
  }

  // Désigner automatiquement Capitaine (×2) et Vice-Capitaine
  const sortedByPts = [...selected].sort((a, b) => b.expectedPoints - a.expectedPoints);
  const captainId = sortedByPts[0]?.id || null;
  const viceCaptainId = sortedByPts[1]?.id || null;
  const totalCost = Math.round(selected.reduce((s, p) => s + p.price, 0) * 10) / 10;
  const basePoints = selected.reduce((s, p) => s + p.expectedPoints, 0);
  const totalProjectedPoints =
    Math.round((basePoints + (sortedByPts[0]?.expectedPoints || 0)) * 10) / 10;

  return {
    lineup: selected,
    captainId,
    viceCaptainId,
    totalCost,
    remainingBudget: Math.round((budget - totalCost) * 10) / 10,
    totalProjectedPoints,
  };
}
