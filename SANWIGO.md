# 👑 SanwiGo — Yango démonté dans les moindres détails, reconstruit et amélioré pour Aboisso

> **Principe juridique (important).** Le code source de Yango est propriétaire et fermé :
> personne ne peut légalement le copier, et ce projet ne contient **aucun** code, logo,
> nom, visuel ou base de données de Yango/Yandex. Ce qui est légal — et ce qui a été fait
> ici — c'est une **reconstruction « clean-room »** : on observe les *fonctions publiques*
> (commander, payer, suivre, noter…), on les réécrit à partir de zéro avec **notre propre
> marque (SanwiGo)**, notre propre identité (or Sanwi + vert Comoé, pas le rouge Yango)
> et le code déjà présent dans ce dépôt (React + Vite + PWA, patron multi-apps de Cloé).
> Les idées fonctionnelles d'un service de VTC ne sont pas « volées » quand on les
> ré-implémente proprement ; la marque, le design déposé et le code, si.

---

## 1. Yango démonté : comment l'application fonctionne vraiment

Yango est la déclinaison internationale du service de VTC issu de Yandex, présent
notamment en Côte d'Ivoire (Abidjan), au Ghana, au Cameroun, au Sénégal et en Zambie.
À Abidjan il fait partie, avec Uber et Heetch, des plateformes VTC autorisées au titre
du décret n°2021-860 du 15 décembre 2021 (rappelé par l'ARTI).

### 1.1 Les 3 applications cachées derrière « une » app
| Côté | Nom chez Yango | Rôle | Équivalent SanwiGo (ce dépôt) |
|---|---|---|---|
| Passager | Yango (client) | géolocaliser, commander, payer, suivre, noter | Onglet **🧍 Client** |
| Chauffeur | Yango Pro | recevoir des courses, naviguer, gagner, documents | Onglet **🚖 Chauffeur Pro** |
| Plateforme | back-office interne (invisible) | tarifs, commissions, dispatch, promos, litiges, flottes | Onglet **🛠️ Admin** |

### 1.2 Le parcours client, écran par écran
1. **Inscription par numéro de téléphone** (+ code SMS).
2. **Carte plein écran** : position GPS, voitures autour, champ « Où allez-vous ? ».
3. **Recherche de destination** : adresses suggérées (domicile, travail, historique),
   possibilité d'**arrêts multiples** sur un même trajet.
4. **Choix de la classe** avec prix et temps d'attente par classe :
   *Éco* (la moins chère), *Confort* (clim, voitures récentes), *Confort+* (plus d'espace),
   *Goya* (premium lancé à Abidjan en février 2025), plus *Livraison à moto* et
   *Express Cargo*. À Abidjan : Suzuki Alto/S-Presso en Éco, Yaris/Dzire en Confort,
   Corolla/Elantra au-dessus.
5. **Paiement** choisi avant la course : espèces, carte bancaire ou Yango Pay ;
   réduction de bienvenue (p. ex. jusqu'à 20 %, max 650 FCFA, sur les 3 premières courses).
6. **Dispatch** : l'algorithme propose la course au(x) chauffeur(s) — proximité,
   classe du véhicule, note et taux d'acceptation entrent dans le choix.
7. **Suivi en direct** : chauffeur (nom, photo, note, voiture, plaque), arrivée estimée,
   appel/message masqué, fonctions de sécurité (partage de trajet, urgence).
8. **Fin de course** : prix final, notation du chauffeur, pourboire, reçu, historique.

### 1.3 La machine à prix (tarification officielle Abidjan, Éco)
D'après la grille publique Yango pour Abidjan (tarif « Éco », 24 h/24) :
- **minimum 550 FCFA** (incluant 6 min et 1,5 km) ;
- ensuite **≤ 130 FCFA/km + ≤ 35 FCFA/min** en ville (≤ 260 FCFA/km hors ville) ;
- **attente gratuite 3 min**, puis ≤ 70 FCFA/min ;
- prix pouvant **augmenter avec la tarification dynamique** (« surge ») aux heures de
  pointe — à Abidjan une course de 5 km se situe vers 1 200-2 500 FCFA selon l'heure.

### 1.4 Le côté chauffeur (Yango Pro)
- Inscription avec **permis, carte grise, assurance, CNI**, validation sous 48-72 h ;
  travail souvent via des **flottes/partenaires** propriétaires des voitures.
- Bouton en ligne/hors ligne, réception des demandes, navigation intégrée, gains.
- **Commission : 18 % en Éco et 23 % en Confort** (chiffres confirmés côté Yango CI),
  environ 20 % en moyenne, contre ~10 % aux débuts.
- Paiement des chauffeurs de manière périodique (souvent hebdomadaire) via Mobile Money.

### 1.5 Le moteur invisible
Serveurs de dispatch temps réel (positions GPS toutes les quelques secondes),
moteur de tarification dynamique, anti-fraude (faux GPS, comptes multiples),
système de promos subventionnées pour conquérir le marché, support intégré,
et — côté commerce — partenariats flottes, télécom (p. ex. MTN) et employeurs.

---

## 2. Les failles de Yango (F1→F10) et ce que SanwiGo corrige, concrètement

| # | Faille constatée chez les gros VTC | Correction SanwiGo **implémentée dans ce code** |
|---|---|---|
| F1 | **Commission 18-23 %** qui étrangle les chauffeurs (grèves, plaintes récurrentes) | **10 % Éco / 12 % Confort / 10 % livraison**, réglables en Admin, **paiement quotidien** Wave/Orange Money. Simulateur chauffeur intégré : à 12 courses × 1 200 FCFA/jour, passer de 20 % à 10 % ≈ **+37 000 FCFA/mois** pour le chauffeur (testé). |
| F2 | **Tarification dynamique opaque** : le prix « explose » sans explication aux heures de pointe | **Prix fixe garanti avant commande**, détaillé ligne par ligne (prise en charge + km + minutes + pointe), **plafond x1,3** affiché et réglable ; **aucun surge sur le Wôrô Partagé**. |
| F3 | **Adresses introuvables** hors grands axes : le GPS pose un point « au milieu de nulle part » | **Repères parlés d'Aboisso** pour chaque lieu (« devant la Pharmacie du Marché », « carrefour TP »…) + précision libre (« pagne orange ») + appel/message rapide. |
| F4 | **Pensé pour Abidjan**, absent des villes secondaires ; minimum 550 FCFA trop cher pour Aboisso | **Dès 300 FCFA** (Wôrô Partagé, moto-colis), classes adaptées : **Villages & Pistes** (saison des pluies), **Inter-villes** Sud-Comoé (Ayamé, Maféré, Adiaké, Noé/frontière Ghana, Bonoua, Grand-Bassam, Abidjan, aéroport). |
| F5 | **Paiement par carte mis en avant**, peu adapté aux usages ivoiriens | **Wave, Orange Money, MTN MoMo d'abord** + espèces avec **arrondi à 50 FCFA** pour éviter les problèmes de monnaie. |
| F6 | **Chauffeur « aveugle »** : destination/net parfois découverts après acceptation → annulations et refus des petites courses | Le chauffeur SanwiGo voit **destination, distance, prix client et son net avant de rouler** ; **bonus course courte 150 FCFA** payé par la plateforme ; **annulation** : gratuite 2 min puis frais affichés (règle la même pour tous). |
| F7 | **File d'attente injuste** : le plus proche rafle tout, les anciens de la gare attendent | Algorithme d'appariement **60 % proximité + 20 % note + 20 % temps d'attente dans la file** (`engine.matchDriver`, testé) — esprit « tour de rôle » de la gare routière. |
| F8 | **Sécurité perfectible** : se tromper de voiture, faux chauffeurs | **PIN de course à 4 chiffres obligatoire** pour démarrer, plaque en gros, **SOS** (support + contact d'urgence + rappel 170/180), partage de trajet WhatsApp, points sûrs la nuit (commissariat, gare, CHR), chauffeur sans permis/assurance **jamais apparié**. |
| F9 | **Application lourde, réseau obligatoire** ; rien pour les téléphones basiques ni les aînés | **Carte vectorielle hors-ligne** (aucun appel Google Maps), commande par **appel / WhatsApp / USSD** affichée dans l'app, **commander pour un proche**, agence physique à la gare, gros boutons. |
| F10 | **Livraison pensée « petits colis urbains »** seulement | **Tricycle Marché** (vivriers jusqu'à 400 kg) et **camionnette/camion** (déménagement, récoltes, matériaux) ; **moto/tricycle/camion = colis uniquement, jamais de passager** (votre choix sécurité) + code de remise au destinataire. |

**Idées manquantes ajoutées en plus** : réservation programmée, points fidélité
« Sanwi », heatmap de demande pour chauffeurs (gare, marché, CHR, lycée 6h45/18h),
classes premium locales (**Sanwi Royal** pour mariages/autorités à Krinjabo),
transparence Admin en temps réel (toute modification de commission impacte
instantanément le prix client), accueil en clin d'œil local (« Akwaba »).

---

## 3. Grille tarifaire SanwiGo proposée pour Aboisso (réglable en Admin)

| Classe | Prise en charge | FCFA/km | FCFA/min | Minimum | Commission |
|---|---|---|---|---|---|
| 👥 Wôrô Partagé | 150 | 80 | 10 | **300** | 10 % |
| 🚗 Éco | 250 | 110 | 20 | 500 | 10 % |
| 🚘 Confort (clim) | 350 | 150 | 30 | 700 | 12 % |
| 🛋️ Confort+ | 500 | 190 | 35 | 1 000 | 12 % |
| 👑 Sanwi Royal | 1 000 | 300 | 60 | 2 500 | 12 % |
| 🚙 Villages & Pistes | 600 | 220 | 40 | 1 500 | 10 % |
| 🛵 Moto Colis *(livraison)* | 200 | 70 | 10 | **300** | 10 % |
| 🛺 Tricycle Marché *(livraison)* | 600 | 150 | 25 | 1 000 | 10 % |
| 🚐 Camionnette *(livraison)* | 2 500 | 300 | 50 | 5 000 | 10 % |
| 🚚 Camion *(livraison)* | 8 000 | 500 | 80 | 15 000 | 10 % |

Attente : 3 min gratuites puis 50 FCFA/min. Exemples ville (heure normale) :
Commerce → CHR (~2,5 km route) ≈ 650-750 FCFA en Éco ; Gare → Marché en partagé = 300 FCFA.
Inter-villes (voiture privée Éco) : Ayamé 6 000 · Maféré 8 000 · Noé 14 000 · Bonoua 14 000 ·
Grand-Bassam 20 000 · **Abidjan 30 000** · Aéroport 28 000 (partagé = prix par place à 35 %).
*À valider par une enquête terrain auprès des taxis d'Aboisso avant lancement.*

**Écolabel économique plateforme (ordre de grandeur)** : 20 chauffeurs × 12 courses ×
1 000 FCFA × 10 % ≈ 24 000 FCFA/jour de revenu plateforme au démarrage — il faut donc
aussi vendre : livraison commerçants (abonnements boutiques du marché), inter-villes
(marge plus forte), partenariats (hôtels, CHR, cérémonies) et publicité locale.

---

## 4. Ce qui a été construit dans ce dépôt (en réutilisant votre code)

Même patron que **Cloé** (votre 2ᵉ app existante) — **Football AI n'est pas touché**
(juste un lien « 👑 SanwiGo Aboisso 🚖 » ajouté dans son en-tête) :

```
sanwigo-index.html            entrée HTML (patron cloe-index.html)
vite.sanwigo.config.js        build autonome -> sanwigo-www/ (patron vite.cloe-app.config.js)
src/sanwigo/main.jsx          bootstrap React (patron src/main.jsx + PWA)
src/sanwigo/data.js           POI/repères d'Aboisso, classes, tarifs, chauffeurs démo
src/sanwigo/engine.js         prix transparent, matching équitable, PIN, gains (pur, testé)
src/sanwigo/MapView.jsx       carte SVG hors-ligne d'Aboisso (Soumié River, A100, Ayamé…)
src/sanwigo/SanwiGoApp.jsx    Client + Chauffeur Pro + Admin reliés en temps réel
src/sanwigo/styles.css        identité SanwiGo (or + vert), mobile-first
public/sanwigo.svg            icône (couronne Sanwi)
scripts/verify-sanwigo.mjs    tests moteur (patron scripts/verify-model.mjs)
```

Commandes :
```bash
npm install
npm run test:sanwigo     # ✅ 24 vérifications du moteur tarifaire/matching
npm run dev:sanwigo      # développement (port 5174, ouvre sanwigo-index.html)
npm run build:sanwigo    # production -> sanwigo-www/index.html
npm run dev              # Football AI reste sur 5173 ; SanwiGo : /sanwigo-index.html
```

**Scénario de démo complet sur un seul téléphone** : onglet *Client* → choisir
départ/destination/classe (le prix détaillé s'affiche) → *Commander* → le chauffeur
arrive sur la carte → un **PIN** apparaît → onglet *Chauffeur Pro* (compte du chauffeur
assigné) → saisir le PIN → course en cours → arrivée → notation/pourboire côté client →
les gains du chauffeur et les KPI *Admin* se mettent à jour. Changez la commission en
*Admin* : le prix client et le net chauffeur bougent immédiatement.

---

## 5. Honnêteté technique : prototype ≠ service en production

Ce livrable est un **prototype fonctionnel complet** (parcours, tarifs, rôles,
règles métier) avec données simulées. Pour transporter de vrais passagers à Aboisso,
il reste — par ordre :

1. **Juridique** : autorisation VTC **ARTI** (décret n°2021-860 — aujourd'hui seuls
   Uber, Yango et Heetch sont autorisés nationalement ; un dossier local est à déposer),
   RCCM/NCC/patente, assurance RC pro, contrats chauffeurs, dépôt de marque **OAPI**,
   conformité données personnelles (ARTCI).
2. **Backend réel** : comptes par SMS/OTP, base de données, positions GPS temps réel
   (WebSocket), files de dispatch multi-chauffeurs, notifications push, anti-fraude
   (faux GPS), journalisation des courses. Votre Firebase existant (`football-ai-43e33`)
   peut servir de base de départ (Auth + Firestore + Functions).
3. **Cartes de production** : tuiles OpenStreetMap/Leaflet (sans clé payante) +
   géocodage des repères d'Aboisso relevés sur le terrain ; conserver la carte SVG
   actuelle comme **mode hors-ligne de secours**.
4. **Paiements réels** : comptes marchands **Wave / Orange Money / MTN** et/ou
   agrégateur (CinetPay, PayDunya…), reversements chauffeurs quotidiens automatisés,
   réconciliation comptable.
5. **Exploitation** : recruter/valider 15-30 chauffeurs de départ à Aboisso
   (permis, assurance, visite technique, casier, essai de conduite), agence à la gare,
   support WhatsApp 6h-23h, accords CHR/hôtels/gare, campagne de lancement
   (1ʳᵉ course -30 % `BIENVENUE30` déjà dans le code).
6. **Publication** : PWA installable d'abord (zéro friction), puis Android via
   Play Store ; iOS quand le volume le justifie.

---

## 6. Sources publiques utilisées pour le « démontage »

- Yango CI — page Abidjan & classes de service : yango.com/fr_ci/city/abidjan/
- Yango — grille tarifaire Éco Abidjan : yango.com/fr_int/abidjan/tariff/
- Digital Mag CI — commissions chauffeurs 18 %/23 % et comparatif VTC CI (2025)
- AIP — lancement du service premium « Goya » à Abidjan (20/02/2025)
- Régulation ARTI / décret n°2021-860 — plateformes VTC autorisées en Côte d'Ivoire
- CHR d'Aboisso, commune d'Aboisso (capitale régionale du Sud-Comoé, ~116 km d'Abidjan)

*Toutes les personnes, plaques, numéros et statistiques de la démo sont fictifs.*
