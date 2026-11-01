# Blocages, options et recommandations

Aucun blocage n'empêche l'utilisation de la V1 en simulation. Les éléments
ci-dessous conditionnent uniquement le passage à une exécution réelle ou à des
vérifications externes. Chaque point suit le format : constat → impact → options
→ recommandation. Le travail continue en parallèle : rien n'attend une réponse.

---

## B1 — Aucun courtier MT5 sélectionné (ni identifiants)

**Constat** : §26 exige le courtier, le serveur, le compte démo et le mot de passe
investisseur. Aucun n'a été fourni. De plus, le paquet officiel `MetaTrader5`
n'existe que pour Windows (et, en pratique, uniquement en architecture x64) ; il
est absent de l'environnement Linux de développement.
**Impact** : le connecteur est écrit, testé contre un module factice (95 % de
couverture) et refuse tout ordre (`MT5_ORDER_NOT_ENABLED`). Flux réel, exécution
réelle et vérification des protections côté courtier restent non validés.
**Options**
1. VPS Windows Server + terminal MT5 + paquet officiel — conforme au §9, coût
   licence Windows, maintenance plus lourde.
2. Passerelle externe (bridge REST maison ou fournisseur) — resterait à auditer,
   ajoute une dépendance tierce et un point de défaillance.
3. Courtier proposant une API REST native — simplifierait l'intégration mais
   changerait le choix de courtier du propriétaire.
**Recommandation** : option 1 (VPS Windows dédié, compte démo d'abord, 4 semaines
d'observation), car c'est la seule voie qui respecte §9 sans intermédiaire
supplémentaire. Décision propriétaire requise sur le courtier.

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
**Impact** : l'interface est vérifiée par audit statique (164 identifiants HTML,
134 références JS, 0 manquante ; 7 vues ↔ 7 entrées de navigation ↔ 7 rendus) et
par les tests API, mais aucune capture automatisée de régression visuelle.
**Options**
1. Ajouter Playwright sur le VPS (ou en CI GitHub Actions) et un test de fumée.
2. Poursuivre l'audit statique + tests manuels guidés.
**Recommandation** : option 1 dès la mise en place de la CI ; d'ici là, la checklist
manuelle de `docs/OPERATIONS.md` §6 couvre les parcours critiques.

## B8 — Notifications sortantes limitées au webhook générique

**Constat** : §19.2 impose des notifications ; le webhook est implémenté, mais aucun
canal (e-mail, SMS, Telegram) n'a été fourni.
**Impact** : les alertes restent visibles dans l'application et dans le webhook si
configuré ; pas d'alerte hors application sans intégration.
**Options**
1. Webhook vers un service existant du propriétaire (Slack, Discord, n8n).
2. Envoi SMTP direct (nécessite un serveur et des identifiants).
**Recommandation** : option 1 immédiatement (aucun secret supplémentaire dans
l'application), option 2 si le propriétaire fournit un relais SMTP.

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
