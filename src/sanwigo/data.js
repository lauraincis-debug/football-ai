// ============================================================================
// SanwiGo — Données locales d'Aboisso (Sud-Comoé, Côte d'Ivoire)
// Reconstruction fonctionnelle "clean-room" inspirée des usages VTC publics
// (aucun code, logo ou actif propriétaire d'un tiers n'est réutilisé).
// Les coordonnées sont approximatives (démo) : à affiner avec un relevé GPS
// terrain avant la mise en production.
// ============================================================================

// Points d'intérêt / REPERES locaux d'Aboisso.
// AMELIORATION vs VTC classique : à Aboisso beaucoup de lieux n'ont pas
// d'adresse formelle -> chaque lieu a un "repere" parlé (comme on explique
// au téléphone) + un point de rendez-vous sûr.
export const POIS = [
  { id: "gare", nom: "Gare routière d'Aboisso", quartier: "Commerce", repere: "Devant le portail principal de la gare, côté taxis", lat: 5.469, lon: -3.209, x: 46, y: 52, icon: "🚌", populaire: true },
  { id: "marche", nom: "Grand Marché d'Aboisso", quartier: "Commerce", repere: "Entrée du marché, devant la Pharmacie du Marché", lat: 5.467, lon: -3.206, x: 54, y: 48, icon: "🧺", populaire: true },
  { id: "chr", nom: "CHR d'Aboisso (Hôpital régional)", quartier: "Route d'Assouba", repere: "Portail des urgences du CHR", lat: 5.485, lon: -3.198, x: 66, y: 26, icon: "🏥", populaire: true },
  { id: "mairie", nom: "Mairie & Préfecture d'Aboisso", quartier: "Plateau administratif", repere: "Devant la grille de la Mairie", lat: 5.466, lon: -3.212, x: 38, y: 46, icon: "🏛️", populaire: true },
  { id: "commerce", nom: "Quartier Commerce (centre-ville)", quartier: "Commerce", repere: "Carrefour de la boulangerie, route d'Ayamé", lat: 5.468, lon: -3.2075, x: 50, y: 49, icon: "🏙️", populaire: true },
  { id: "lycee", nom: "Lycée Moderne d'Aboisso", quartier: "TP", repere: "Devant le portail du lycée", lat: 5.476, lon: -3.215, x: 32, y: 34, icon: "🎓" },
  { id: "commissariat", nom: "Commissariat de Police", quartier: "Plateau administratif", repere: "Face au commissariat, point sécurisé nuit", lat: 5.4655, lon: -3.213, x: 35, y: 50, icon: "🛡️" },
  { id: "pont", nom: "Pont sur le Soumié / Rive gauche", quartier: "Rive gauche", repere: "Tête du pont, côté maquis", lat: 5.46, lon: -3.203, x: 58, y: 62, icon: "🌉" },
  { id: "tp", nom: "Quartier TP", quartier: "TP", repere: "Carrefour TP, devant la station", lat: 5.478, lon: -3.208, x: 48, y: 30, icon: "🏘️" },
  { id: "sokoura", nom: "Quartier Sokoura", quartier: "Sokoura", repere: "Mosquée de Sokoura", lat: 5.462, lon: -3.217, x: 26, y: 56, icon: "🕌" },
  { id: "eboue", nom: "Eboué (village, route de Krinjabo)", quartier: "Périphérie Sud", repere: "Carrefour d'Eboué, arrêt des taxis brousse", lat: 5.43, lon: -3.195, x: 68, y: 80, icon: "🌴", piste: true },
  { id: "assouba", nom: "Assouba", quartier: "Route d'Ayamé", repere: "Carrefour Assouba, devant l'école primaire", lat: 5.505, lon: -3.185, x: 78, y: 12, icon: "🌴" },
  { id: "krinjabo", nom: "Krinjabo (capitale du royaume Sanwi)", quartier: "Route de Noé", repere: "Cour royale de Krinjabo", lat: 5.39, lon: -3.22, x: 42, y: 92, icon: "👑", piste: true },
];

// Destinations inter-villes (forfaits voiture privée, aller simple).
export const INTERCITY = [
  { id: "ayame", nom: "Ayamé", distanceKm: 18, dureeMin: 35, forfaitEco: 6000, note: "Barrage & lac d'Ayamé" },
  { id: "mafere", nom: "Maféré", distanceKm: 30, dureeMin: 45, forfaitEco: 8000, note: "Route de Noé" },
  { id: "adiake", nom: "Adiaké", distanceKm: 40, dureeMin: 55, forfaitEco: 10000, note: "Lagune Aby" },
  { id: "noe", nom: "Noé (frontière Ghana)", distanceKm: 55, dureeMin: 70, forfaitEco: 14000, note: "Poste frontière — prévoir pièce d'identité" },
  { id: "bonoua", nom: "Bonoua", distanceKm: 55, dureeMin: 65, forfaitEco: 14000, note: "Popo Carnaval" },
  { id: "bassam", nom: "Grand-Bassam", distanceKm: 85, dureeMin: 95, forfaitEco: 20000, note: "Quartier France, plages" },
  { id: "abidjan", nom: "Abidjan — Treichville / Plateau", distanceKm: 116, dureeMin: 130, forfaitEco: 30000, note: "Via autoroute de Grand-Bassam, péage inclus ? à confirmer" },
  { id: "aeroport", nom: "Abidjan — Aéroport Félix Houphouët-Boigny", distanceKm: 105, dureeMin: 115, forfaitEco: 28000, note: "Prise en charge vols : indiquer n° de vol en commentaire" },
];

// Classes PASSAGERS : voitures uniquement (choix du porteur de projet).
// La moto, le tricycle et le camion sont réservés à la LIVRAISON.
export const PASSENGER_CLASSES = [
  { id: "partage", nom: "Wôrô Partagé", icon: "👥", desc: "Course partagée, le moins cher", places: "1 place", base: 150, parKm: 80, parMin: 10, minimum: 300, clim: false, exemples: "Taxi communal partagé" },
  { id: "eco", nom: "Éco", icon: "🚗", desc: "Le plus abordable, voiture récente", places: "4 places", base: 250, parKm: 110, parMin: 20, minimum: 500, clim: false, exemples: "Suzuki Alto, S-Presso…" },
  { id: "confort", nom: "Confort", icon: "🚘", desc: "Climatisée, chauffeurs les mieux notés", places: "4 places", base: 350, parKm: 150, parMin: 30, minimum: 700, clim: true, exemples: "Toyota Yaris, Suzuki Dzire…" },
  { id: "confortplus", nom: "Confort+", icon: "🛋️", desc: "Plus d'espace jambes & coffre", places: "4-5 places", base: 500, parKm: 190, parMin: 35, minimum: 1000, clim: true, exemples: "Toyota Corolla, Hyundai Elantra…" },
  { id: "royal", nom: "Sanwi Royal", icon: "👑", desc: "Premium : mariages, autorités, affaires", places: "4 places", base: 1000, parKm: 300, parMin: 60, minimum: 2500, clim: true, exemples: "Berline/SUV premium, eau offerte" },
  { id: "piste", nom: "Villages & Pistes", icon: "🚙", desc: "Véhicule haut pour villages & saison des pluies", places: "5-7 places", base: 600, parKm: 220, parMin: 40, minimum: 1500, clim: true, exemples: "4x4 / pick-up double cabine" },
];

// Classes LIVRAISON uniquement (jamais de passager sur moto/tricycle).
export const DELIVERY_CLASSES = [
  { id: "moto", nom: "Moto Colis", icon: "🛵", desc: "Petit colis, documents, repas — rapide", base: 200, parKm: 70, parMin: 10, minimum: 300, charges: "Jusqu'à 10 kg" },
  { id: "tricycle", nom: "Tricycle Marché", icon: "🛺", desc: "Achats du marché, vivriers, petits déménagements", base: 600, parKm: 150, parMin: 25, minimum: 1000, charges: "Jusqu'à 400 kg" },
  { id: "camionnette", nom: "Camionnette", icon: "🚐", desc: "Meubles, matériaux légers, stock boutique", base: 2500, parKm: 300, parMin: 50, minimum: 5000, charges: "Jusqu'à 1,5 t" },
  { id: "camion", nom: "Camion", icon: "🚚", desc: "Déménagement complet, récoltes, chantier (sur devis confirmé)", base: 8000, parKm: 500, parMin: 80, minimum: 15000, charges: "3 t et +" },
];

export const PAYMENT_METHODS = [
  { id: "especes", nom: "Espèces", icon: "💵", desc: "Payer au chauffeur" },
  { id: "wave", nom: "Wave", icon: "🌊", desc: "Mobile Money — sans frais client" },
  { id: "orange", nom: "Orange Money", icon: "🟧", desc: "Mobile Money" },
  { id: "mtn", nom: "MTN MoMo", icon: "🟨", desc: "Mobile Money" },
];

export const PROMOS = {
  BIENVENUE30: { code: "BIENVENUE30", remisePct: 30, plafond: 650, desc: "-30% (max 650 FCFA) — nouveaux clients" },
  SANWI10: { code: "SANWI10", remisePct: 10, plafond: 500, desc: "-10% (max 500 FCFA)" },
  MARCHE: { code: "MARCHE", remisePct: 15, plafond: 400, desc: "-15% (max 400 FCFA) — jours de marché" },
};

// Chauffeurs partenaires de démonstration (noms fictifs).
// "fileDepuisMin" = ancienneté dans la file d'attente (équité à la gare).
export const DRIVERS_SEED = [
  { id: "d1", nom: "Aka Jean-Marc", tel: "07 07 •• •• 12", note: 4.92, courses: 1240, vehicule: "Suzuki S-Presso — Blanc", plaque: "2841 JK 01", classes: ["eco", "partage"], poiId: "gare", enLigne: true, fileDepuisMin: 22, gainsJour: 18500, docs: { permis: true, carteGrise: true, assurance: true, visite: true, cni: true } },
  { id: "d2", nom: "N'Guessan Aya Clarisse", tel: "05 05 •• •• 48", note: 4.98, courses: 860, vehicule: "Toyota Yaris — Gris", plaque: "9917 LT 01", classes: ["confort", "eco"], poiId: "marche", enLigne: true, fileDepuisMin: 6, gainsJour: 24000, docs: { permis: true, carteGrise: true, assurance: true, visite: true, cni: true } },
  { id: "d3", nom: "Ettien Koffi Armand", tel: "01 41 •• •• 90", note: 4.85, courses: 2105, vehicule: "Toyota Corolla — Noir", plaque: "5520 HG 01", classes: ["confort", "confortplus"], poiId: "mairie", enLigne: true, fileDepuisMin: 14, gainsJour: 31500, docs: { permis: true, carteGrise: true, assurance: true, visite: true, cni: true } },
  { id: "d4", nom: "Amalé Brou Roger", tel: "07 47 •• •• 33", note: 4.9, courses: 640, vehicule: "Toyota RAV4 — Vert", plaque: "7782 PQ 01", classes: ["piste", "confortplus", "royal"], poiId: "tp", enLigne: true, fileDepuisMin: 31, gainsJour: 27000, docs: { permis: true, carteGrise: true, assurance: true, visite: false, cni: true } },
  { id: "d5", nom: "Amani Yao Serges", tel: "05 66 •• •• 21", note: 4.78, courses: 430, vehicule: "Suzuki Alto — Jaune", plaque: "1104 CD 01", classes: ["partage", "eco"], poiId: "commerce", enLigne: true, fileDepuisMin: 3, gainsJour: 12000, docs: { permis: true, carteGrise: true, assurance: true, visite: true, cni: true } },
  { id: "d6", nom: "Ahoua N'Da Patricia", tel: "07 57 •• •• 77", note: 4.95, courses: 980, vehicule: "Hyundai Elantra — Blanc", plaque: "6603 RS 01", classes: ["confortplus", "royal", "confort"], poiId: "chr", enLigne: true, fileDepuisMin: 11, gainsJour: 29000, docs: { permis: true, carteGrise: true, assurance: true, visite: true, cni: true } },
  { id: "d7", nom: "Kouadio Adjoua Mamadou", tel: "01 51 •• •• 05", note: 4.82, courses: 310, vehicule: "Moto Haojin + caisse colis", plaque: "M-4412 CI", classes: ["moto"], poiId: "marche", enLigne: true, fileDepuisMin: 8, gainsJour: 8500, docs: { permis: true, carteGrise: true, assurance: true, visite: true, cni: true } },
  { id: "d8", nom: "Ehui Assi Benoît", tel: "05 04 •• •• 64", note: 4.88, courses: 520, vehicule: "Tricycle APSONIC cargo", plaque: "T-2098 CI", classes: ["tricycle"], poiId: "gare", enLigne: true, fileDepuisMin: 18, gainsJour: 14000, docs: { permis: true, carteGrise: true, assurance: false, visite: true, cni: true } },
  { id: "d9", nom: "Allou Yao Christian Rodrigue", tel: "07 98 •• •• 19", note: 4.86, courses: 275, vehicule: "Camionnette Kia K2700", plaque: "8845 UV 01", classes: ["camionnette", "camion"], poiId: "pont", enLigne: false, fileDepuisMin: 0, gainsJour: 0, docs: { permis: true, carteGrise: true, assurance: true, visite: true, cni: true } },
];

// Demande par zone (heatmap chauffeur) — démo, à brancher sur le réel.
export const DEMAND_ZONES = [
  { poiId: "gare", niveau: "Très forte", coef: 1.3, conseil: "Arrivées des cars d'Abidjan & de Noé" },
  { poiId: "marche", niveau: "Forte", coef: 1.2, conseil: "Sortie de marché, tricycle demandé" },
  { poiId: "chr", niveau: "Forte", coef: 1.15, conseil: "Sorties de consultation 10h-13h" },
  { poiId: "commerce", niveau: "Moyenne", coef: 1.0, conseil: "Courses courtes centre-ville" },
  { poiId: "mairie", niveau: "Moyenne", coef: 1.0, conseil: "Administrations 7h30-16h30" },
  { poiId: "lycee", niveau: "Pic 6h45 & 18h", coef: 1.2, conseil: "Élèves & enseignants — courses partagées" },
];

export const DEFAULT_SETTINGS = {
  // AMELIORATION N°1 : commission divisée par ~2 vs les 18-23% reprochés
  // aux plateformes internationales (voir SANWIGO.md, faille F1).
  commissionEcoPct: 10,
  commissionConfortPct: 12,
  commissionLivraisonPct: 10,
  // AMELIORATION N°2 : majoration heure de pointe PLAFONNÉE et affichée.
  plafondPointe: 1.3,
  // Attente : 3 min gratuites puis tarif affiché (comme les standards VTC).
  attenteGratuiteMin: 3,
  attenteParMin: 50,
  // Annulation gratuite pendant 2 min après acceptation.
  annulationGratuiteMin: 2,
  fraisAnnulation: 300,
  // Bonus course courte payé au chauffeur par la plateforme (anti-refus).
  bonusCourseCourte: 150,
};

export const SUPPORT = {
  agence: "Agence SanwiGo — Gare routière d'Aboisso, boutique n°4",
  telAffiche: "27 21 30 00 00", // fictif démo — remplacer avant lancement
  whatsappAffiche: "07 00 00 00 00", // fictif démo
  urgence: "Commissariat d'Aboisso / Pompiers : 180 / Police : 170",
};
