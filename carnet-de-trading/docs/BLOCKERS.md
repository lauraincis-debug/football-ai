# Blocages, options et recommandations

Aucun blocage n'empêche l'utilisation de la V1 en simulation. Les éléments
ci-dessous conditionnent uniquement le passage à une exécution réelle ou à des
vérifications externes. Chaque point suit le format : constat → impact → options
→ recommandation. Le travail continue en parallèle : rien n'attend une réponse.

---

## B1 — Pont MT5 démo prêt, aucun compte démo raccordé

**Constat** : §26 exige le courtier, le serveur, le compte démo et le jeton du
pont. Aucun n'a été fourni. Le paquet officiel `MetaTrader5` n'existe que pour
Windows : l'intégration passe désormais par un agent dédié
(`scripts/mt5_agent.py`) que le VPS joint en HTTP + jeton (`X-Bridge-Token`),
derrière un tunnel SSH ou un reverse proxy TLS.
**État** : le pont est **implémenté et testé de bout en bout** — agent Windows
(terminal factice), connecteur HTTP, magasin de connexion chiffré par permissions
(`var/mt5_connection.json`, 0600), routes API et panneau d'interface.
Garde-fous vérifiés par les tests : `account_type: real` ⇒
`REAL_TRADING_FORBIDDEN` ; ordres refusés tant que l'option démo n'est pas cochée
(`MT5_ORDER_NOT_ENABLED`) ; bracket obligatoire ; délai dépassé ⇒ statut inconnu,
jamais de renvoi ; jeton absent ou invalide ⇒ `MT5_BRIDGE_UNAUTHORIZED`.
**Impact restant** : aucun flux réel de courtier n'a encore été observé — latence,
qualité de remplissage, arrondis, suffixes d'instruments, comportement des
protections côté courtier (stop/objectif) restent à valider sur un compte démo.
Le propriétaire travaille actuellement **sans ordinateur** : l'agent Windows ne peut
être installé ni sur Android ni sur iOS. Options documentées dans
`docs/PHONE_ONLY.md` §4 : rester en simulation, louer un VPS Windows administré via
Remote Desktop depuis le téléphone, ou attendre un accès ponctuel à un PC.
**Options**
1. Nœud Windows dédié (ou VM Windows) + terminal MT5 + agent maison — conforme au
   §9, aucune dépendance tierce, mais maintenance Windows à assurer.
2. Passerelle fournisseur — ajouterait un intermédiaire à auditer et un point de
   défaillance supplémentaire.
3. Courtier à API REST native — simplifierait l'exploitation mais changerait le
   choix de courtier du propriétaire.
**Recommandation** : option 1 avec un compte démo, 4 semaines d'observation et un
pont limité aux ordres démo. Procédure : `docs/DEPLOYMENT.md` §6. Décision
propriétaire requise sur le courtier et le nœud Windows.

## B2 — Aucun exchange crypto sélectionné (ni clés API)

**Constat** : §10 impose une plateforme spot, sans marge ni futures, avec clé API
sans droit de retrait. Aucun exchange ni clé fournis.
**Impact** : le connecteur spot est complet et testé (transport factice, refus des
clés à retrait/futures, 85 % de couverture), mais aucun flux réel n'est validé ;
les règles de arrondi/pas de quantité de l'exchange cible restent à confirmer.
**Options**
1. Exchange majeur avec API REST publique documentée, clé restreinte IP +
   spot uniquement.
2. Exchange « sandbox » officiel pour valider les ordres avant production.
3. Attendre la sélection du propriétaire, rester en simulation.
**Recommandation** : option 1 + 2 combinées : sandbox d'abord, puis clé restreinte
en production. Vérifier contractuellement l'interdiction de marge/futures sur le
compte utilisé.

## B3 — Mode réel interdit par construction (V1)

**Constat** : §1.4 interdit tout ordre réel. Le code applique trois verrous et
`can_activate_real` vaut `false`.
**Impact** : voulu. Aucun chemin de code ne peut envoyer un ordre réel aujourd'hui,
y compris en cas d'erreur de configuration ou de compromission d'un administrateur
(jeton propriétaire requis).
**Options**
1. Conserver l'interdiction jusqu'à l'audit indépendant (§24).
2. Ouvrir un environnement DEMO réel (compte démo du courtier), sans argent réel.
3. Ouvrir le réel — exclu en l'état.
**Recommandation** : option 2 dès que B1/B2 sont résolus, puis option 1 jusqu'à la
clôture des validations technique, sécurité et opérationnelle.

## B4 — Validations propriétaire non signées

**Constat** : `guards.py` exige trois validations (technique, sécurité,
opérationnelle) avec preuve, plus un jeton propriétaire. Aucune n'est fournie.
**Impact** : l'environnement réel reste impossible ; l'interface affiche les
blocages dans la carte « Plateformes & connexions ».
**Options**
1. Le propriétaire enregistre chaque validation via `POST /api/validations`
   (ADMIN + jeton propriétaire) avec un lien de preuve.
2. Validation par un tiers (auditeur) puis enregistrement par le propriétaire.
**Recommandation** : option 2 pour la sécurité, option 1 pour les deux autres.

## B5 — Conformité réglementaire et juridiction non tranchées

**Constat** : §22 exige de vérifier les conditions d'accès du courtier et de
l'exchange pour le pays de résidence, les règles de marge, les restrictions API et
la fiscalité.
**Impact** : aucune incidence en simulation ; bloquant avant tout compte réel.
**Options**
1. Revue juridique locale (recommandée) avant ouverture d'un compte réel.
2. Rester en démo indéfiniment (aucune obligation d'exécution).
**Recommandation** : option 1, en parallèle de B1/B2. Le pays de résidence et la
taille du compte sont nécessaires pour instruire le point.

## B6 — Audit indépendant et revue de sécurité non réalisés

**Constat** : §24 exige un audit externe avant production. Il ne peut pas être
auto-réalisé.
**Impact** : pas de mise en production réelle ; la V1 reste exploitable en
simulation.
**Options**
1. Prestataire externe (revue de code + test d'intrusion applicatif).
2. Revue croisée par un pair compétent, documentée, avant un audit formel.
**Recommandation** : option 2 immédiatement (coût nul, détecte l'essentiel), puis
option 1 avant toute ouverture réelle.

## B7 — Pas de test d'interface en navigateur réel dans cet environnement

**Constat** : aucun binaire de navigateur n'est disponible ; il n'est donc pas
possible d'exécuter un test end-to-end (Playwright) ici.
**Impact** : l'interface est vérifiée par audit statique automatisé
(`tests/test_web_ui.py` : 194 identifiants HTML, sélecteurs JS résolus sans
manquant, 7 vues ↔ navigation, liaisons des panneaux MT5/alertes, routes du
client présentes dans l'API, absence de gestionnaire inline) et par les tests API,
mais aucune capture automatisée de régression visuelle.
**Options**
1. Ajouter Playwright sur le VPS (ou en CI GitHub Actions) et un test de fumée.
2. Poursuivre l'audit statique + tests manuels guidés.
**Recommandation** : option 1 dès la mise en place de la CI ; d'ici là, la checklist
manuelle de `docs/OPERATIONS.md` §6 couvre les parcours critiques.

## B9 — Indices synthétiques (Deriv Volatility, Boom/Crash) non configurés

**Constat** : le propriétaire détient un compte **Deriv** et a créé un **compte démo
Deriv MT5** (serveur `Deriv-Demo`, terminal web affichant `AAVUSD` en H1). Deriv
propose deux familles :
- **Deriv Trader / options** (Rise/Fall, durations en ticks, paiement fixe) : produit
  à expiration, sans stop ni objectif, incompatible avec le moteur à bracket ;
- **Deriv MT5** (Standard / swap-free) : compte démo MT5 classique, avec forex
  (`frxEURUSD`), crypto (`cryBTCUSD`) et indices synthétiques (`Volatility 100 Index`,
  `Boom/Crash`, `Step`), compatible avec le pont actuel après correspondance des noms.
**Impact** : les 8 instruments actuels (5 FX + 3 crypto) peuvent être raccordés à un
compte Deriv MT5 démo via la correspondance d'instruments. Les indices synthétiques
ne sont **pas** dans `SYMBOLS` : pas de fiche instrument (tick, contrat, marge, lot
minimum 0,001), donc ni calcul de risque ni backtest fiables.
**Options**
1. Rester sur FX/crypto du compte Deriv MT5 démo — aucun développement, validation
   immédiate du pont.
2. Ajouter un profil d'instrument synthétique (Volatility 100) avec specs minimales
   et plafonds prudents (0,001 lot, 1 position) — développement court, mais le
   backtest devra être refait (volatilité constante, pas de sessions).
3. Connecter l'API WebSocket Deriv aux options Rise/Fall — hors périmètre : modèle
   de règlement différent (paiement fixe, expiration en ticks), pas de stop/objectif,
   réglementation variable selon les juridictions.
**Recommandation** : option 1 pour valider le pont, puis option 2 si le propriétaire
veut tester les synthétiques **en démo uniquement**. L'option 3 n'est pas retenue
pour la V1 : elle exigerait un moteur de contrats distinct.

## B8 — Canal d'alerte prêt, aucune destination fournie

**Constat** : §19.2 impose des notifications hors application. Le canal est
désormais implémenté (`backend/carnet/alerts.py`) avec quatre formats — Slack,
Discord, Teams, webhook générique JSON — détection automatique depuis l'URL,
niveau minimum configurable, trois tentatives avec repli exponentiel, compteurs
d'envoi/échec et URL masquée dans toutes les réponses. L'interface permet de
configurer, tester et désactiver le canal.
**Impact restant** : aucune URL de webhook n'a été fournie ; le canal est donc
« non configuré » et les alertes restent internes à l'application. Aucune
notification e-mail/SMS n'est prévue.
**Options**
1. Webhook Slack/Teams du propriétaire (recommandé : zéro secret supplémentaire,
   sortie d'alerte immédiate).
2. Relais n8n/Zapier déjà en place chez le propriétaire.
3. SMTP direct — exigerait un serveur et des identifiants, hors périmètre V1.
**Recommandation** : option 1 ou 2 ; créer une URL dédiée au canal d'exploitation,
la tester via `POST /api/alerts/test`, puis vérifier après chaque redémarrage.

---

## Paramètres attendus du propriétaire (§26)

| Paramètre | Utilisé pour | Blocage |
|---|---|---|
| Courtier MT5 (nom, serveur, compte démo, mot de passe investisseur) | connexion MT5 | B1 |
| Exchange crypto (nom, clés API spot sans retrait, restriction IP) | connexion crypto | B2 |
| Pays de résidence et taille de compte prévue | conformité, calibrage | B5 |
| Tolérance au risque (confirmation des 0,5 % / 2 % / 5 % / 10 %) | politique | — (valeurs par défaut appliquées) |
| Jeton propriétaire et phrase de confirmation | décisions réservées | B4 |
| Phrase de passe des sauvegardes | chiffrement au repos | — (optionnelle) |
| Adresse du VPS, nom de domaine, certificat TLS | mise en ligne | — (HTTP interne en attendant) |
| Canal d'alerte (webhook ou SMTP) | notifications | B8 |

## Ce qui n'est pas un blocage

- Absence de données de marché réelles : la simulation est déterministe et
  documentée ; le mode DEMO prendra le relais dès B1/B2.
- Absence de compte de trading : inutile en V1 par construction.
- Absence de fournisseur cloud : le service tourne sur un seul VPS.
