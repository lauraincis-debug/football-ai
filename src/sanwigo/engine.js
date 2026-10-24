// ============================================================================
// SanwiGo — Moteur : distances, tarification TRANSPARENTE, appariement
// chauffeur (matching équitable), gains chauffeur.
// Fonctions pures, testées par scripts/verify-sanwigo.mjs (même patron que
// scripts/verify-model.mjs du projet Football AI existant).
// ============================================================================
import { PASSENGER_CLASSES, DELIVERY_CLASSES, PROMOS } from "./data.js";

export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Distance routière estimée : vol d'oiseau x coefficient de détour urbain. */
export function roadDistanceKm(from, to, stops = []) {
  const pts = [from, ...stops, to].filter(Boolean);
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += haversineKm(pts[i], pts[i + 1]);
  // Minimum 0,8 km facturable (course très courte centre-ville).
  return Math.max(0.8, total * 1.35);
}

export function estimateDurationMin(distanceKm, interville = false) {
  const vitesse = interville ? 62 : 24; // km/h réalistes Aboisso / A100
  return Math.max(3, Math.round((distanceKm / vitesse) * 60));
}

/**
 * Majoration d'heure de pointe PLAFONNÉE (faille Yango F2 : tarification
 * dynamique opaque). Ici : le coefficient est calculé, plafonné par le
 * réglage admin et TOUJOURS affiché au client avant commande.
 */
export function surgeForHour(hour, plafond = 1.3) {
  let coef = 1;
  if (hour >= 6 && hour < 9) coef = 1.25;       // départ travail/école
  else if (hour >= 11 && hour < 14) coef = 1.1; // marché / CHR / pause
  else if (hour >= 17 && hour < 20) coef = 1.3; // retour du soir
  else if (hour >= 22 || hour < 5) coef = 1.15; // nuit : peu de chauffeurs
  return Math.min(coef, plafond);
}

export function roundTo50(n) {
  // Arrondi au billet/pièce pratique en espèces (50 FCFA).
  return Math.round(n / 50) * 50;
}

export function formatFCFA(n) {
  return `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;
}

export function getClassById(classId) {
  return (
    PASSENGER_CLASSES.find((c) => c.id === classId) ||
    DELIVERY_CLASSES.find((c) => c.id === classId) ||
    null
  );
}

export function commissionPctFor(classId, settings) {
  if (DELIVERY_CLASSES.some((c) => c.id === classId)) return settings.commissionLivraisonPct;
  if (["confort", "confortplus", "royal"].includes(classId)) return settings.commissionConfortPct;
  return settings.commissionEcoPct;
}

/**
 * Calcul complet et DÉTAILLÉ ligne par ligne (prix fixe garanti).
 * Le client voit : prise en charge + km + minutes + pointe + promo = total.
 * Le chauffeur voit AVANT d'accepter : total, commission, net (faille F6).
 */
export function computeFare({ from, to, stops = [], classId, settings, promoCode = "", hour = new Date().getHours(), intercity = null }) {
  const cls = getClassById(classId);
  if (!cls || !from || !to) return null;

  // --- Inter-villes : forfait affiché, multiplié selon la classe -----------
  if (intercity) {
    const mult = { partage: 0.35, eco: 1, confort: 1.35, confortplus: 1.6, royal: 2.4, piste: 1.8 }[classId] || 1;
    const brut = roundTo50(intercity.forfaitEco * mult);
    const promo = applyPromo(brut, promoCode);
    const total = brut - promo.remise;
    const pct = commissionPctFor(classId, settings);
    const commission = Math.round((total * pct) / 100);
    return {
      mode: "interville",
      classId, distanceKm: intercity.distanceKm, durationMin: intercity.dureeMin,
      base: brut, distCost: 0, timeCost: 0, surgeCoef: 1, surgeMontant: 0,
      sousTotal: brut, remise: promo.remise, promoAppliquee: promo.ok ? promo.code : null,
      promoRefusee: promoCode && !promo.ok ? promoCode.toUpperCase() : null,
      total, commissionPct: pct, commission, netChauffeur: total - commission,
      minimumApplique: false,
    };
  }

  // --- Ville / livraison -----------------------------------------------------
  const distanceKm = roadDistanceKm(from, to, stops);
  const durationMin = estimateDurationMin(distanceKm);
  const isPartage = classId === "partage";
  // Le partagé mutualise : pas de majoration de pointe (prix social stable).
  const surgeCoef = isPartage ? 1 : surgeForHour(hour, settings.plafondPointe);

  const distCost = distanceKm * cls.parKm;
  const timeCost = durationMin * cls.parMin;
  const avantPointe = cls.base + distCost + timeCost;
  const surgeMontant = avantPointe * (surgeCoef - 1);
  let sousTotal = avantPointe + surgeMontant;
  const minimumApplique = sousTotal < cls.minimum;
  if (minimumApplique) sousTotal = cls.minimum;
  sousTotal = roundTo50(sousTotal);

  const promo = applyPromo(sousTotal, promoCode);
  const total = Math.max(0, sousTotal - promo.remise);
  const pct = commissionPctFor(classId, settings);
  const commission = Math.round((total * pct) / 100);
  // Bonus course courte (plateforme -> chauffeur) pour éviter les refus.
  const bonus = distanceKm <= 2 && !isPartage ? settings.bonusCourseCourte : 0;

  return {
    mode: "ville",
    classId,
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMin,
    base: cls.base,
    distCost: Math.round(distCost),
    timeCost: Math.round(timeCost),
    surgeCoef, surgeMontant: Math.round(surgeMontant),
    sousTotal, remise: promo.remise,
    promoAppliquee: promo.ok ? promo.code : null,
    promoRefusee: promoCode && !promo.ok ? promoCode.toUpperCase() : null,
    total, commissionPct: pct, commission,
    netChauffeur: total - commission + bonus,
    bonusCourseCourte: bonus,
    minimumApplique,
  };
}

export function applyPromo(montant, code) {
  if (!code) return { ok: false, remise: 0, code: null };
  const p = PROMOS[code.trim().toUpperCase()];
  if (!p) return { ok: false, remise: 0, code: null };
  return { ok: true, code: p.code, remise: Math.min(p.plafond, Math.round((montant * p.remisePct) / 100)) };
}

/**
 * Appariement ÉQUITABLE (failles F3/F6) : score = proximité (60%)
 * + note (20%) + temps d'attente dans la file (20%) pour que le chauffeur
 * de la gare qui attend depuis 30 min ne soit pas toujours doublé.
 * Seuls les chauffeurs en ligne, de la bonne classe et aux documents
 * complets (permis + assurance au minimum) sont éligibles.
 */
export function matchDriver(drivers, classId, fromPoi, pois) {
  const poiById = Object.fromEntries(pois.map((p) => [p.id, p]));
  const candidats = drivers
    .filter((d) => d.enLigne && d.classes.includes(classId) && d.docs.permis && d.docs.assurance)
    .map((d) => {
      const pos = poiById[d.poiId] || fromPoi;
      const distKm = haversineKm(pos, fromPoi) * 1.3;
      const etaMin = Math.max(2, Math.round((distKm / 22) * 60));
      const scoreProximite = Math.max(0, 100 - distKm * 18);
      const scoreNote = (d.note - 4) * 20; // 4,0->0 ; 5,0->20
      const scoreFile = Math.min(20, (d.fileDepuisMin / 30) * 20);
      return { driver: d, distKm: Math.round(distKm * 10) / 10, etaMin, score: scoreProximite * 0.6 + scoreNote + scoreFile };
    })
    .sort((a, b) => b.score - a.score);
  return candidats[0] || null;
}

/** Code PIN de course (sécurité : le client le donne au chauffeur au départ). */
export function generateRidePin(rng = Math.random) {
  return Math.floor(1000 + rng() * 9000).toString();
}

/** Simulation de revenu chauffeur (vue chauffeur + dossier business). */
export function simulateDriverIncome({ coursesParJour, prixMoyen, commissionPct, joursParSemaine = 6, carburantParJour = 4000 }) {
  const brutJour = coursesParJour * prixMoyen;
  const netJour = brutJour * (1 - commissionPct / 100) - carburantParJour;
  return {
    brutJour,
    netJour,
    netSemaine: netJour * joursParSemaine,
    netMois: netJour * joursParSemaine * 4.33,
  };
}

/** Frais d'annulation selon le délai après acceptation (règle affichée). */
export function cancellationFee(minutesSinceAccept, settings) {
  return minutesSinceAccept <= settings.annulationGratuiteMin ? 0 : settings.fraisAnnulation;
}
