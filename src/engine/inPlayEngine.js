import { roundProbabilitiesTo100, buildDixonColesMatrix } from "./predictor.js";

/**
 * 🔴 MOTEUR LIVE IN-PLAY (PROCESSUS DE POISSON RÉSIDUEL TEMPS RÉEL)
 * Recalcule instantanément les probabilités 1X2, Prochain But, Over/Under dynamique,
 * Alerte But imminent (80'+) et Conseil Cash-Out selon :
 * - minute actuelle (1 -> 95),
 * - score actuel (liveHomeGoals - liveAwayGoals),
 * - cartons rouges domicile / extérieur,
 * - domination / momentum en direct (-100 à +100) et tirs cadrés.
 */

export function computeLiveInPlayPrediction(preMatchPred, liveState = {}) {
  const minute = Math.min(95, Math.max(1, Number(liveState.minute ?? 60)));
  const scoreH = Math.max(0, Math.floor(Number(liveState.scoreHome ?? 0)));
  const scoreA = Math.max(0, Math.floor(Number(liveState.scoreAway ?? 0)));
  const redH = Math.min(3, Math.max(0, Math.floor(Number(liveState.redCardsHome ?? 0))));
  const redA = Math.min(3, Math.max(0, Math.floor(Number(liveState.redCardsAway ?? 0))));
  const momentum = Math.min(100, Math.max(-100, Number(liveState.momentum ?? 0))); // >0 avantage domicile
  const shotsOnTargetH = Math.max(0, Number(liveState.shotsOnTargetHome ?? 0));
  const shotsOnTargetA = Math.max(0, Number(liveState.shotsOnTargetAway ?? 0));

  // Densité temporelle réaliste du football moderne (plus de buts en 2e mi-temps et dans le money-time 75-95')
  const totalMatchMinutes = 95;
  const rawFractionLeft = Math.max(0.015, (totalMatchMinutes - minute) / totalMatchMinutes);
  // Courbe d'intensité : la dernière demi-heure concentre proportionnellement ~12% de buts supplémentaires par minute
  const intensityCurve = minute >= 75 ? 1.22 : minute >= 46 ? 1.09 : 0.96;

  // Modificateur Cartons Rouges (calibré empiriquement sur les grands championnats européens)
  const redAtkH = Math.pow(0.71, redH) * Math.pow(1.28, redA);
  const redAtkA = Math.pow(0.71, redA) * Math.pow(1.28, redH);

  // Modificateur de Domination & Tirs cadrés observés
  const sotDiff = shotsOnTargetH - shotsOnTargetA;
  const momentumFactorH = 1 + (momentum / 100) * 0.28 + Math.max(-0.18, Math.min(0.18, sotDiff * 0.03));
  const momentumFactorA = 1 - (momentum / 100) * 0.28 - Math.max(-0.18, Math.min(0.18, sotDiff * 0.03));

  // Modificateur d'urgence liée au score ("Game State Effect")
  const goalDiff = scoreH - scoreA;
  let urgencyH = 1.0;
  let urgencyA = 1.0;
  if (goalDiff === -1 && minute >= 55) {
    urgencyH = 1.18; // Domicile mené d'un but pousse fort
    urgencyA = 1.06; // Espaces en contre
  } else if (goalDiff === 1 && minute >= 55) {
    urgencyA = 1.16; // Extérieur mené d'un but se découvre
    urgencyH = 1.07; // Contre-attaques domicile
  } else if (goalDiff <= -2) {
    urgencyH = 1.12;
    urgencyA = 0.92;
  } else if (goalDiff >= 2) {
    urgencyH = 0.90;
    urgencyA = 1.10;
  }

  const baseXgH = preMatchPred?.xg?.home ?? 1.55;
  const baseXgA = preMatchPred?.xg?.away ?? 1.2;

  const remXgH = Math.max(
    0.02,
    Math.min(4.5, baseXgH * rawFractionLeft * intensityCurve * redAtkH * momentumFactorH * urgencyH)
  );
  const remXgA = Math.max(
    0.02,
    Math.min(4.5, baseXgA * rawFractionLeft * intensityCurve * redAtkA * momentumFactorA * urgencyA)
  );

  // Distribution exacte des buts RESTANTS via matrice Dixon-Coles
  const remMatrix = buildDixonColesMatrix(remXgH, remXgA, -0.05);

  let pWinH = 0;
  let pDraw = 0;
  let pWinA = 0;
  let pAtLeastOneMoreGoal = 0;
  let pAtLeastTwoMoreGoals = 0;
  let pBothScoreFromNow = 0;
  const finalScoreCandidates = [];

  for (let addH = 0; addH < remMatrix.length; addH++) {
    for (let addA = 0; addA < remMatrix[addH].length; addA++) {
      const p = remMatrix[addH][addA];
      const finalH = scoreH + addH;
      const finalA = scoreA + addA;

      if (finalH > finalA) pWinH += p;
      else if (finalH === finalA) pDraw += p;
      else pWinA += p;

      if (addH + addA >= 1) pAtLeastOneMoreGoal += p;
      if (addH + addA >= 2) pAtLeastTwoMoreGoals += p;
      if (addH >= 1 && addA >= 1) pBothScoreFromNow += p;

      if (addH <= 4 && addA <= 4) {
        finalScoreCandidates.push({
          score: `${finalH} - ${finalA}`,
          finalH,
          finalA,
          pct: Math.round(p * 1000) / 10,
        });
      }
    }
  }

  finalScoreCandidates.sort((a, b) => b.pct - a.pct);
  const liveProbs = roundProbabilitiesTo100([pWinH * 100, pDraw * 100, pWinA * 100]);

  // Probabilité du PROCHAIN but (Processus de Poisson compétitif)
  const pNoMoreGoal = Math.exp(-(remXgH + remXgA));
  const totalRate = remXgH + remXgA;
  const pNextHome = (1 - pNoMoreGoal) * (totalRate > 0 ? remXgH / totalRate : 0.5);
  const pNextAway = (1 - pNoMoreGoal) * (totalRate > 0 ? remXgA / totalRate : 0.5);
  const nextGoalProbs = roundProbabilitiesTo100([
    pNextHome * 100,
    pNoMoreGoal * 100,
    pNextAway * 100,
  ]);

  // Probabilité d'un but dans les 15 prochaines minutes
  const windowMin = Math.min(15, Math.max(1, totalMatchMinutes - minute));
  const windowShare = windowMin / Math.max(1, totalMatchMinutes - minute);
  const goalNext15Pct = Math.min(
    96,
    Math.max(3, Math.round((1 - Math.exp(-(remXgH + remXgA) * windowShare * 1.08)) * 100))
  );

  const currentTotalGoals = scoreH + scoreA;
  const dynamicLine = currentTotalGoals + 0.5;
  const dynamicLinePlus1 = currentTotalGoals + 1.5;

  const overCurrentPlus05Pct = Math.min(99, Math.max(1, Math.round(pAtLeastOneMoreGoal * 100)));
  const overCurrentPlus15Pct = Math.min(98, Math.max(1, Math.round(pAtLeastTwoMoreGoals * 100)));
  const bttsLivePct =
    scoreH > 0 && scoreA > 0
      ? 100
      : scoreH > 0
        ? Math.min(98, Math.max(2, Math.round((1 - Math.exp(-remXgA)) * 100)))
        : scoreA > 0
          ? Math.min(98, Math.max(2, Math.round((1 - Math.exp(-remXgH)) * 100)))
          : Math.min(98, Math.max(2, Math.round(pBothScoreFromNow * 100)));

  // Conseiller Tactique Cash-Out / Couverture Live
  let liveVerdict = "";
  let alertLevel = "neutral";
  if (goalNext15Pct >= 42 && overCurrentPlus05Pct >= 68) {
    alertLevel = "hot";
    liveVerdict = `🔥 ALERTE BUT IMMINENT : l'intensité offensive projette ${(remXgH + remXgA).toFixed(2)} xG restants (${overCurrentPlus05Pct}% pour +${dynamicLine} buts).`;
  } else if (goalDiff !== 0 && ((goalDiff > 0 && remXgA > remXgH * 1.35) || (goalDiff < 0 && remXgH > remXgA * 1.35))) {
    alertLevel = "warning";
    const pressTeam = goalDiff > 0 ? preMatchPred.away : preMatchPred.home;
    const eqPct = goalDiff > 0 ? liveProbs[1] + liveProbs[2] : liveProbs[1] + liveProbs[0];
    liveVerdict = `⚠️ VIGILANCE CASH-OUT : ${pressTeam} pousse fortement pour revenir (${eqPct}% de chance de ne pas perdre d'ici la 95e). Envisagez un Cash-Out partiel ou une couverture Double Chance.`;
  } else if (minute >= 75 && overCurrentPlus05Pct <= 35) {
    alertLevel = "lock";
    liveVerdict = `🛡️ VERROUILLAGE FIN DE MATCH : rythme fermé (${100 - overCurrentPlus05Pct}% que le score actuel ${scoreH}-${scoreA} reste figé). Le Under ${dynamicLine} buts est solide.`;
  } else {
    const bestIdx = liveProbs.indexOf(Math.max(...liveProbs));
    const labels = [`Victoire ${preMatchPred.home}`, "Match Nul", `Victoire ${preMatchPred.away}`];
    liveVerdict = `⚡ Scénario directeur Live : ${labels[bestIdx]} (${liveProbs[bestIdx]}%), score final n°1 projeté : ${finalScoreCandidates[0]?.score || `${scoreH} - ${scoreA}`}.`;
  }

  return {
    minute,
    scoreHome: scoreH,
    scoreAway: scoreA,
    remainingXg: {
      home: Math.round(remXgH * 100) / 100,
      away: Math.round(remXgA * 100) / 100,
      total: Math.round((remXgH + remXgA) * 100) / 100,
    },
    liveProbs, // [Home%, Draw%, Away%]
    deltaFromPreMatch: [
      liveProbs[0] - preMatchPred.probs[0],
      liveProbs[1] - preMatchPred.probs[1],
      liveProbs[2] - preMatchPred.probs[2],
    ],
    nextGoalProbs, // [NextHome%, NoGoal%, NextAway%]
    goalNext15Pct,
    dynamicLine,
    dynamicLinePlus1,
    overCurrentPlus05Pct,
    overCurrentPlus15Pct,
    underCurrentPlus05Pct: 100 - overCurrentPlus05Pct,
    bttsLivePct,
    topFinalScores: finalScoreCandidates.slice(0, 5),
    fairLiveOdds: liveProbs.map((p) => Math.max(1.02, Math.round((100 / Math.max(1, p)) * 100) / 100)),
    liveVerdict,
    alertLevel,
  };
}
