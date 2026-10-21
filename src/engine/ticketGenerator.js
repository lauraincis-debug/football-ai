import { computeFullPrediction } from "./predictor.js";

/**
 * 🎰 GÉNÉRATEUR AUTOMATIQUE DES 3 TICKETS IA DU JOUR + SMART MONEY EDGE + EXPORT PNG HD
 * 1) 🛡️ Ticket Sécurité IA (Cote ~1.80 - 2.40, très haute probabilité)
 * 2) ⚖️ Ticket Value Équilibré (Cote ~3.20 - 5.50, meilleur ratio Probabilité × Value)
 * 3) 🚀 Ticket Cote 10+ / Fun (Cote >= 8.50+, grosses opportunités ciblées)
 */

const FALLBACK_SHOWCASE_FIXTURES = [
  { home: "PSG", away: "Marseille", league: "ligue1", timeFr: "21:00" },
  { home: "Real Madrid", away: "Barcelone", league: "liga", timeFr: "21:00" },
  { home: "Arsenal", away: "Liverpool", league: "premier", timeFr: "17:30" },
  { home: "Bayern Munich", away: "Bayer Leverkusen", league: "bundesliga", timeFr: "18:30" },
  { home: "Inter Milan", away: "Naples", league: "seriea", timeFr: "20:45" },
  { home: "Côte d'Ivoire", away: "Maroc", league: "international", timeFr: "20:00" },
];

export function scanSmartMoneyOpportunities(fixtures = [], modelState) {
  const sourceList =
    Array.isArray(fixtures) && fixtures.length >= 2 ? fixtures : FALLBACK_SHOWCASE_FIXTURES;

  const analyzed = sourceList.map((fx) => {
    const pred =
      fx.prediction ||
      computeFullPrediction(fx.home, fx.away, fx.league || "ucl", modelState, fx.liveOdds || null);

    // Extraire les candidats marchés pour chaque profil de ticket
    const safeCandidates = (pred.markets || []).filter((m) => m.pct >= 72 && m.marketOdd >= 1.16);
    const balancedCandidates = (pred.markets || []).filter(
      (m) => m.pct >= 56 && m.pct <= 78 && m.marketOdd >= 1.38
    );
    const highOddCandidates = (pred.markets || []).filter(
      (m) => m.pct >= 38 && m.marketOdd >= 1.95
    );

    const bestSafe =
      safeCandidates.sort((a, b) => b.pct - a.pct)[0] || pred.recommendedMarket;
    const bestBalanced =
      balancedCandidates.sort((a, b) => b.pct * b.marketOdd - a.pct * a.marketOdd)[0] ||
      pred.recommendedMarket;
    const bestHigh =
      highOddCandidates.sort((a, b) => b.pct * Math.sqrt(b.marketOdd) - a.pct * Math.sqrt(a.marketOdd))[0] ||
      pred.markets?.[0] ||
      pred.recommendedMarket;

    // Calcul du Smart Money Edge (écart entre probabilité IA et cote bookmaker réelle si disponible)
    const valBest = pred.valueAnalysis?.bestValue || null;
    const impliedPct = Math.round((100 / Math.max(1.05, bestBalanced.marketOdd)) * 10) / 10;
    const edgePct = valBest?.evPct ?? Math.round((bestBalanced.pct - impliedPct) * 10) / 10;

    return {
      fixture: fx,
      pred,
      bestSafe,
      bestBalanced,
      bestHigh,
      edgePct,
      isSmartValue: edgePct >= 4.5,
    };
  });

  return analyzed;
}

function buildCouponItemsFromPicks(picks) {
  let combinedOdd = 1;
  let combinedProb = 1;
  const items = picks.map((entry, idx) => {
    const mkt = entry.chosenMarket;
    const odd = Number(mkt.bookOdd || mkt.marketOdd || 1.45);
    combinedOdd *= odd;
    combinedProb *= (mkt.pct || 65) / 100;
    return {
      id: Date.now() + idx * 17 + Math.floor(Math.random() * 100),
      home: entry.pred.home,
      away: entry.pred.away,
      league: entry.fixture.league || "ucl",
      probs: entry.pred.probs,
      selectedMarket: {
        ...mkt,
        bookOdd: odd,
      },
    };
  });

  return {
    items,
    totalOdd: Math.round(combinedOdd * 100) / 100,
    winProbPct: Math.max(1, Math.round(combinedProb * 1000) / 10),
  };
}

export function generateThreeDailyTickets(fixtures = [], modelState) {
  const pool = scanSmartMoneyOpportunities(fixtures, modelState);

  // 1. 🛡️ Ticket Sécurité IA (2 à 3 sélections très hautes probabilités)
  const safeSorted = [...pool]
    .sort((a, b) => (b.bestSafe?.pct || 0) - (a.bestSafe?.pct || 0))
    .slice(0, Math.min(3, pool.length))
    .map((x) => ({ ...x, chosenMarket: x.bestSafe }));

  // 2. ⚖️ Ticket Value Équilibré (3 à 4 sélections meilleur EV)
  const balSorted = [...pool]
    .sort((a, b) => b.edgePct - a.edgePct || (b.bestBalanced?.pct || 0) - (a.bestBalanced?.pct || 0))
    .slice(0, Math.min(4, pool.length))
    .map((x) => ({ ...x, chosenMarket: x.bestBalanced }));

  // 3. 🚀 Ticket Cote 10+ / Jackpot (4 à 5 sélections ambitieuses maîtrisées)
  const highSorted = [...pool]
    .sort((a, b) => (b.bestHigh?.marketOdd || 1) * (b.bestHigh?.pct || 40) - (a.bestHigh?.marketOdd || 1) * (a.bestHigh?.pct || 40))
    .slice(0, Math.min(5, pool.length))
    .map((x) => ({ ...x, chosenMarket: x.bestHigh }));

  const safeTicket = buildCouponItemsFromPicks(safeSorted);
  const valueTicket = buildCouponItemsFromPicks(balSorted);
  const jackpotTicket = buildCouponItemsFromPicks(highSorted);

  return [
    {
      id: "safe",
      badge: "🛡️ SÉCURITÉ IA",
      title: "Ticket Bouclier Haute Fiabilité",
      subtitle: "Sélections verrouillées à forte probabilité mathématique",
      recommendedBankrollPct: 4.0,
      accent: "#00e676",
      ...safeTicket,
    },
    {
      id: "value",
      badge: "⚖️ VALUE BET PRO",
      title: "Ticket Équilibré Smart Money",
      subtitle: "Meilleur ratio Probabilité IA × Cote du marché",
      recommendedBankrollPct: 2.5,
      accent: "#00e5ff",
      ...valueTicket,
    },
    {
      id: "jackpot",
      badge: "🚀 COTE BOOST / FUN",
      title: "Ticket Multi-Cote Haute Performance",
      subtitle: "Mise prudente pour viser un gros multiplicateur",
      recommendedBankrollPct: 1.0,
      accent: "#d500f9",
      ...jackpotTicket,
    },
  ];
}

/**
 * 📸 Génère et télécharge une vraie Carte Graphique HD (PNG 1080px) du Ticket Signé Football AI Ultra
 */
export function exportCouponAsPngImage({ coupon, stake, currency, totalOdd, winProbPct, potentialGain }) {
  if (typeof document === "undefined" || !Array.isArray(coupon) || coupon.length === 0) return false;

  const width = 920;
  const rowHeight = 96;
  const height = 340 + coupon.length * rowHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  // Fond sombre néon signature Football AI Ultra
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#080b1f");
  bg.addColorStop(0.5, "#10163b");
  bg.addColorStop(1, "#070919");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Bordure néon
  ctx.strokeStyle = "#00e5ff";
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, width - 36, height - 36);

  // En-tête
  ctx.fillStyle = "#00e5ff";
  ctx.font = "bold 36px system-ui, -apple-system, sans-serif";
  ctx.fillText("⚡ FOOTBALL AI ULTRA v4 • TICKET OFFICIEL", 48, 78);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 20px system-ui, -apple-system, sans-serif";
  ctx.fillText(
    `Généré le ${new Date().toLocaleDateString("fr-FR")} • ${coupon.length} sélection(s) calibrée(s) IA`,
    48,
    114
  );

  // Liste des matchs
  coupon.forEach((item, i) => {
    const y = 145 + i * rowHeight;
    ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
    ctx.fillRect(48, y, width - 96, rowHeight - 14);

    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 24px system-ui, -apple-system, sans-serif";
    ctx.fillText(`${i + 1}. ${item.home}  vs  ${item.away}`, 68, y + 34);

    ctx.fillStyle = "#00e676";
    ctx.font = "bold 21px system-ui, -apple-system, sans-serif";
    ctx.fillText(`🎯 ${item.selectedMarket?.label || "Choix IA"} (${item.selectedMarket?.pct || 70}% IA)`, 68, y + 66);

    ctx.fillStyle = "#fbbf24";
    ctx.font = "bold 28px system-ui, -apple-system, sans-serif";
    const oddTxt = `@${Number(item.selectedMarket?.bookOdd || 1.5).toFixed(2)}`;
    ctx.fillText(oddTxt, width - 175, y + 52);
  });

  // Pied de ticket récapitulatif
  const footerY = 165 + coupon.length * rowHeight;
  ctx.fillStyle = "rgba(0, 229, 255, 0.12)";
  ctx.fillRect(48, footerY, width - 96, 125);

  const fmt = (val) =>
    currency === "EUR"
      ? `${Number(val).toFixed(2)} €`
      : `${Math.round(Number(val)).toLocaleString("fr-FR")} FCFA`;

  ctx.fillStyle = "#e2e8f0";
  ctx.font = "bold 24px system-ui, -apple-system, sans-serif";
  ctx.fillText(`Cote Totale : ${totalOdd.toFixed(2)}   |   Fiabilité IA : ${winProbPct}%`, 68, footerY + 46);

  ctx.fillStyle = "#00e676";
  ctx.font = "bold 32px system-ui, -apple-system, sans-serif";
  ctx.fillText(`Mise ${fmt(stake)}  ➔  Gain Potentiel : ${fmt(potentialGain)}`, 68, footerY + 94);

  const link = document.createElement("a");
  link.download = `ticket-football-ai-${Date.now()}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
  return true;
}
