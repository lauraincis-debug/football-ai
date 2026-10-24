import assert from "node:assert/strict";
import { POIS, INTERCITY, DRIVERS_SEED, DEFAULT_SETTINGS, PASSENGER_CLASSES, DELIVERY_CLASSES } from "../src/sanwigo/data.js";
import {
  haversineKm, roadDistanceKm, computeFare, applyPromo, matchDriver,
  surgeForHour, roundTo50, generateRidePin, simulateDriverIncome, cancellationFee,
} from "../src/sanwigo/engine.js";

const byId = (id) => POIS.find((p) => p.id === id);
const S = DEFAULT_SETTINGS;
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log("  ✅", msg); };

console.log("👑 SanwiGo — vérification du moteur\n");

// Distances / arrondis
ok(haversineKm(byId("commerce"), byId("chr")) > 1 && haversineKm(byId("commerce"), byId("chr")) < 4, "Distance Commerce→CHR réaliste (1-4 km)");
ok(roadDistanceKm(byId("commerce"), byId("commerce")) === 0.8, "Distance routière minimum 0,8 km");
ok(roundTo50(731) === 750 && roundTo50(724) === 700, "Arrondi espèces à 50 FCFA");

// Prix minimum 300 FCFA (partagé / moto colis) — promesse commerciale
const courte = computeFare({ from: byId("gare"), to: byId("marche"), classId: "partage", settings: S, hour: 10 });
ok(courte.total >= 300 && courte.minimumApplique, `Wôrô Partagé course courte au minimum (${courte.total} FCFA >= 300)`);
const moto = computeFare({ from: byId("marche"), to: byId("tp"), classId: "moto", settings: S, hour: 10 });
ok(moto.total >= 300, `Livraison moto dès 300 FCFA (${moto.total})`);

// Prix détaillé cohérent + commission réduite
const eco = computeFare({ from: byId("commerce"), to: byId("chr"), classId: "eco", settings: S, hour: 10 });
ok(eco.total > 0 && eco.distanceKm > 0 && eco.durationMin >= 3, `Course Éco Commerce→CHR : ${eco.total} FCFA, ${eco.distanceKm} km`);
ok(eco.commissionPct === 10 && eco.netChauffeur === eco.total - eco.commission + (eco.bonusCourseCourte || 0), "Commission Éco 10% et net chauffeur cohérent");
const confort = computeFare({ from: byId("commerce"), to: byId("chr"), classId: "confort", settings: S, hour: 10 });
ok(confort.total > eco.total && confort.commissionPct === 12, "Confort plus cher que Éco, commission 12%");

// Heure de pointe plafonnée et jamais appliquée au partagé
ok(surgeForHour(8, S.plafondPointe) <= 1.3 && surgeForHour(18, 1.2) === 1.2, "Majoration de pointe toujours plafonnée");
const partagePointe = computeFare({ from: byId("gare"), to: byId("lycee"), classId: "partage", settings: S, hour: 7 });
ok(partagePointe.surgeCoef === 1, "Aucune majoration sur le Wôrô Partagé (prix social stable)");

// Promos
ok(applyPromo(2000, "BIENVENUE30").remise === 600, "BIENVENUE30 = -30%");
ok(applyPromo(5000, "BIENVENUE30").remise === 650, "BIENVENUE30 plafonnée à 650 FCFA");
ok(applyPromo(1000, "FAUXCODE").ok === false, "Code promo inconnu rejeté proprement");
const avecPromo = computeFare({ from: byId("commerce"), to: byId("chr"), classId: "eco", settings: S, promoCode: "SANWI10", hour: 10 });
ok(avecPromo.total === avecPromo.sousTotal - avecPromo.remise && avecPromo.remise > 0, "Promo déduite du total client");

// Multi-arrêt plus long que direct
const direct = computeFare({ from: byId("gare"), to: byId("chr"), classId: "eco", settings: S, hour: 10 });
const via = computeFare({ from: byId("gare"), to: byId("chr"), stops: [byId("pont")], classId: "eco", settings: S, hour: 10 });
ok(via.distanceKm >= direct.distanceKm, "L'arrêt supplémentaire allonge bien le trajet");

// Inter-villes forfaitaires
const abidjan = INTERCITY.find((i) => i.id === "abidjan");
const inter = computeFare({ from: byId("gare"), to: byId("gare"), classId: "eco", settings: S, intercity: abidjan, hour: 8 });
ok(inter.total === abidjan.forfaitEco && inter.surgeCoef === 1, `Aboisso→Abidjan forfait ${inter.total} FCFA sans surge`);
const interPartage = computeFare({ from: byId("gare"), to: byId("gare"), classId: "partage", settings: S, intercity: abidjan });
ok(interPartage.total < inter.total, "Inter-villes partagé (par place) moins cher que la voiture privée");

// Matching : classe, documents, équité file d'attente
const m1 = matchDriver(DRIVERS_SEED, "eco", byId("gare"), POIS);
ok(m1 && m1.driver.classes.includes("eco") && m1.etaMin >= 2, `Matching Éco à la gare → ${m1.driver.nom} (${m1.etaMin} min)`);
const mCamion = matchDriver(DRIVERS_SEED, "camion", byId("gare"), POIS);
ok(mCamion === null, "Camion : aucun chauffeur en ligne -> null propre (message client géré)");
const sansAssurance = DRIVERS_SEED.map((d) => d.id === "d8" ? { ...d, enLigne: true } : d);
const mTri = matchDriver(sansAssurance, "tricycle", byId("gare"), POIS);
ok(mTri === null || mTri.driver.docs.assurance, "Un chauffeur sans assurance n'est jamais apparié");
ok(!PASSENGER_CLASSES.some((c) => ["moto", "tricycle", "camion"].includes(c.id)) && DELIVERY_CLASSES.length === 4, "Moto/tricycle/camion = livraison uniquement, passagers = voitures uniquement");

// PIN + annulation + simulateur chauffeur
ok(/^\d{4}$/.test(generateRidePin(() => 0.42)), "PIN de course à 4 chiffres");
ok(cancellationFee(1, S) === 0 && cancellationFee(5, S) === S.fraisAnnulation, "Annulation gratuite 2 min puis frais affichés");
const rev10 = simulateDriverIncome({ coursesParJour: 12, prixMoyen: 1200, commissionPct: 10 });
const rev20 = simulateDriverIncome({ coursesParJour: 12, prixMoyen: 1200, commissionPct: 20 });
ok(rev10.netMois > rev20.netMois + 30000, `Commission 10% vs 20% : +${Math.round(rev10.netMois - rev20.netMois).toLocaleString("fr-FR")} FCFA/mois pour le chauffeur`);

console.log(`\n🎉 ${n} vérifications SanwiGo réussies.`);
