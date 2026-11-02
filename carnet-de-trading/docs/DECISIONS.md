# Décisions d'architecture et arbitrages

Chaque décision indique le contexte, le choix, les alternatives écartées et la
conséquence. Elles expliquent *pourquoi* le code est ainsi ; le cahier des charges
n'imposait pas la technique.

---

## D1 — Backend Python sans aucune dépendance tierce

**Contexte** : cahier des charges exigeant, VPS unique, budget d'exploitation
contraint, auditabilité du code.
**Choix** : Python 3.10+, bibliothèque standard uniquement (`http.server`,
`sqlite3`, `hashlib`, `hmac`, `decimal`, `threading`), interface HTML/CSS/JS native.
**Écarté** : FastAPI/Flask + React (dépendances, chaîne de build, surface d'attaque),
Node.js (double runtime), framework ORM (opacité des requêtes).
**Conséquences** : installation instantanée, aucune vulnérabilité transitive, code
lisible ligne à ligne ; en contrepartie, le serveur HTTP et le routeur sont écrits
à la main (≈500 lignes) et couverts par des tests.

## D2 — SQLite en mode WAL comme unique base

**Contexte** : un seul processus, volumes faibles (quelques dizaines de milliers de
lignes), besoin de sauvegardes atomiques et de restauration simple.
**Choix** : SQLite WAL, 19 tables, migrations idempotentes, `integrity_check`.
**Écarté** : PostgreSQL (service supplémentaire, sauvegardes plus lourdes),
fichiers plats (pas de transactions).
**Conséquences** : sauvegarde = copie cohérente d'un fichier, restauration en
secondes ; verrou d'écriture unique acceptable au débit visé.

## D3 — Simulation d'abord, réel impossible par construction

**Contexte** : §1.4 interdit tout ordre réel en V1, alors que les connecteurs réels
doivent être prêts.
**Choix** : trois couches d'interdiction — (1) `SimulationConnector` refuse tout
`environment != SIMULATION`, (2) `RealModeGuard.can_activate_real = False`,
(3) connecteurs réels refusent les ordres sans validation explicite.
**Écarté** : drapeau d'environnement unique (une erreur de configuration suffirait à
envoyer un ordre réel).
**Conséquences** : un bug de configuration ne peut pas créer d'ordre réel ; les
tests vérifient ces refus.

## D4 — Connecteur de simulation avec carnet d'ordres complet

**Contexte** : sans plateforme réelle, il faut néanmoins éprouver les scénarios
critiques (partiels, timeouts, stops touchés, réconciliation).
**Choix** : `SimulationConnector` maintient ordres, positions, fills, frais,
slippage, marques, et expose des leviers de test (`request_partial_fill`,
`force_close_all`, pannes du simulateur).
**Conséquences** : les scénarios §21 sont reproductibles, déterministes (graine) et
exécutables en CI sans réseau.

## D5 — Persistance de l'état du connecteur (`var/simulation_state.json`)

**Contexte** : bug constaté en exploitation — au redémarrage, les positions locales
existaient encore mais la plateforme simulée repartait vide, provoquant des
clôtures `RECONCILED_ABSENT` et des écarts d'équité.
**Choix** : export/import JSON de l'état simulé (solde, positions, ordres, marques,
historique clos), écriture atomique (fichier temporaire + `replace`), sauvegarde
après chaque cycle et à l'arrêt.
**Écarté** : reconstruire l'état depuis la base locale (contredit la règle « la
plateforme fait foi »).
**Conséquences** : un redémarrage conserve positions et solde ; la réconciliation
reste `OK`. La persistance est volontairement non bloquante : une erreur d'écriture
ne doit jamais interrompre la négociation (défaut corrigé et testé).

## D6 — Historique de marché continu, filtre de séance pour le live uniquement

**Contexte** : un dimanche, l'historique synthétique filtré par calendrier renvoyait
0 bougie pour le Forex ⇒ indicateurs vides, backtests en erreur 500, application
inutilisable le week-end.
**Choix** : `MarketSimulator.history` génère toujours `count` bougies ; le filtre de
séance (`is_market_open`) ne s'applique qu'aux cotations live.
**Conséquences** : indicateurs et backtests disponibles en permanence ; les règles
de marché restent appliquées à l'exécution (contrôle `MARKET_CLOSED`).
**Compromis assumé** : les graphiques Forex affichent des données continues, ce qui
est cohérent avec un environnement de simulation explicitement signalé.

## D7 — Authentification par session porteuse, pas de JWT

**Contexte** : application mono-utilisateur à quelques comptes, besoin de révocation
immédiate et de simplicité d'audit.
**Choix** : jetons opaques (`secrets.token_urlsafe`) stockés hachés en base, TTL,
révocation par session, liste des sessions actives.
**Écarté** : JWT (révocation complexe, signature à gérer), cookies (CSRF).
**Conséquences** : révocation instantanée, aucune donnée sensible dans le jeton ;
l'interface stocke le jeton en mémoire + `sessionStorage` et l'envoie en en-tête.

## D8 — Permissions vérifiées par route, rôles fixes

**Contexte** : §17 exige un moindre privilège et une trace des actions.
**Choix** : trois rôles (VIEWER, OPERATOR, ADMIN), permissions déclaratives sur
chaque route du routeur, refus 403 testé, double contrôle sur les actions sensibles
(ex. reprise : rôle + réconciliation).
**Écarté** : permissions stockées en base (complexité inutile en V1), contrôle
uniquement dans l'interface (contournable).
**Conséquences** : aucun accès en écriture pour un lecteur, même via l'API directe.

## D9 — Jeton propriétaire hors base pour les décisions réservées

**Contexte** : §1.3 réserve certaines décisions au propriétaire (politique de risque,
passage au réel).
**Choix** : `OwnerGate` lit le jeton dans l'environnement ou `var/owner_token`
(droits 600), jamais en base ni dans le journal, comparaison en temps constant, plus
une phrase de confirmation.
**Conséquences** : même un administrateur compromis ne peut pas modifier la
politique sans le secret détenu hors application.

## D10 — Journal chaîné plutôt que simple table de logs

**Contexte** : §20 exige la détection d'une altération manuelle.
**Choix** : chaque entrée contient le hachage de l'entrée précédente ; vérification
à la demande, rupture = alerte critique + notification.
**Conséquences** : altération détectable sans infrastructure externe ; coût
négligeable (SHA-256 sur quelques centaines d'octets).

## D11 — Politique de risque versionnée et chaînée

**Contexte** : les limites doivent être auditables dans le temps et non modifiables
silencieusement.
**Choix** : table `policy_versions` chaînée, validation stricte (bornes), version
incrémentée, motif et auteur enregistrés.
**Conséquences** : historique complet, refus des valeurs absurdes, possibilité de
comparer les décisions à la version en vigueur.

## D12 — Suspension persistante, reprise conditionnée

**Contexte** : §21.2 exige que la limite journalière survive à un redémarrage.
**Choix** : l'état de risque (suspension, kill switch, ancres d'équité) est stocké
dans `settings_kv` et rechargé au démarrage ; la reprise exige une réconciliation
`OK` et l'absence de kill switch.
**Conséquences** : redémarrer ne réarme jamais les limites ; la reprise est un
choix explicite, jamais automatique.

## D13 — Backtest avec coûts réalistes et analyses de robustesse

**Contexte** : §16 exige walk-forward et Monte-Carlo, §15 les coûts.
**Choix** : coûts = demi-spread + commission + slippage, appliqués à l'entrée et à
la sortie ; Monte-Carlo par bootstrap des transactions ; walk-forward par fenêtres
indépendantes ; référence « achat et conservation ».
**Conséquences** : résultats reproductibles (graine) et honnêtes ; Monte-Carlo
explicitement présenté comme mesure de robustesse, pas comme prédiction.

## D14 — Interface sans framework, servie par la même origine

**Contexte** : §8 (le VPS exécute), §18.3 (direction artistique), pas de chaîne de
build.
**Choix** : HTML/CSS/JS natifs, rendu par fonctions idempotentes, graphiques SVG,
manifeste PWA + service worker.
**Écarté** : SPA React (build, dépendances), site statique séparé (CORS, secrets).
**Conséquences** : une seule origine, aucun CORS, chargement immédiat, déploiement
= copie de fichiers ; en contrepartie, le code d'interface est explicite et testé
par audit statique.

## D15 — Sauvegardes chiffrées optionnelles et restauration à froid

**Contexte** : §17.1 (protection des données) et §20.2 (continuité).
**Choix** : sauvegarde vérifiée (intégrité SQLite avant écriture), gzip, chiffrement
AES-256-CBC + HMAC-SHA256 si phrase de passe, manifeste, rétention, exercice de
restauration ; restauration en production refusée à chaud (HTTP 409) et réservée à
`scripts/restore.sh` service arrêté.
**Conséquences** : pas de corruption possible par restauration concurrente ; RTO
mesuré par l'exercice automatique.

## D16 — Tests sans dépendance, seuils de couverture mesurés

**Contexte** : §21.3 impose 80 % global et 95 % sur le risque et les ordres.
**Choix** : `unittest` uniquement, base temporaire par test, aucun réseau ;
couverture mesurée avec `coverage` installé **hors du dépôt** (venv jetable).
**Conséquences** : 349 tests, 89 % global (5 379 instructions, 565 non couvertes),
98 % risque et ordres ; la suite tourne sur n'importe quelle machine sans
installation.

## D17 — Pont MT5 sur nœud Windows plutôt que bibliothèque embarquée

**Contexte** : §9 exige MT5 en démo d'abord ; `MetaTrader5` n'existe que pour
Windows, alors que le VPS d'exécution est Linux.
**Choix** : un agent HTTP autonome (`scripts/mt5_agent.py`, stdlib + paquet
officiel) tourne sur le nœud Windows, écoute sur `127.0.0.1` et expose `/health`,
`/account`, `/positions`, `/orders`, `/quotes`, `/orders` (POST), `/history`. Le
VPS le joint par tunnel SSH/VPN ou TLS avec un jeton partagé comparé en temps
constant. Côté moteur, `Mt5ConnectionStore` persiste la configuration dans
`var/mt5_connection.json` (0600) et `Mt5BridgeConnector` implémente l'interface
`BrokerConnector`.
**Conséquences** : aucune bibliothèque propriétaire sur le VPS, surface d'attaque
limitée à la boucle locale ; en contrepartie un second système à superviser.
Garde-fous : compte `real` refusé à la connexion, ordres démo désactivés par
défaut, bracket obligatoire, timeout ⇒ statut inconnu sans renvoi, et aucune
bascule silencieuse vers la simulation (pont indisponible ⇒ entrées bloquées,
journal critique).

## D18 — Canal d'alerte par webhook, formats multiples, secret jamais exposé

**Contexte** : §19.2 demande des notifications exploitables hors application.
**Choix** : un seul mécanisme (webhook HTTPS) avec adaptation de charge utile
(Slack, Discord, Teams, générique), détection du format depuis l'URL, niveau
minimum, trois tentatives et repli exponentiel. L'URL est stockée dans
`var/alerts.json` (0600) et n'est renvoyée que masquée ; l'API expose
`GET/POST /api/alerts`, `/test`, `/disable`, réservées à `connection:manage` et
auditées.
**Conséquences** : aucun SMTP ni dépendance tierce côté serveur ; un webhook
révoqué se détecte via le compteur d'échecs et le dernier résultat. Le canal
complète la supervision, il ne la remplace pas.

## D19 — Déploiement systemd durci + reverse proxy TLS fourni tel quel

**Contexte** : §8 place l'exécution sur le VPS ; la mise en ligne doit être
reproductible et sans exposition directe du service.
**Choix** : unité `carnet.service` (utilisateur système, `ProtectSystem=strict`,
`NoNewPrivileges`, `MemoryDenyWriteExecute`, `ReadWritePaths=/var/lib/carnet`),
configuration dans `/etc/carnet/carnet.env` (0640), vhosts nginx et Caddy avec
HSTS et limitation de débit sur la connexion, script `install.sh` idempotent,
`uninstall.sh` avec purge optionnelle, installation de l'agent Windows par
tâche planifiée (jeton protégé par ACL). Un timer hebdomadaire exécute
`backup.py drill`.
**Conséquences** : le port applicatif reste sur `127.0.0.1:8080` ; le TLS et les
en-têtes de sécurité sont assurés par le proxy ; les mises à jour réutilisent la
configuration existante. Les fichiers sont versionnés et testés statiquement
(`tests/test_deploy_kit.py`) : aucune exécution de systemd/nginx dans la suite.

## D20 — Correspondance d'instruments explicite plutôt qu'heuristique de préfixes

**Contexte** : les courtiers renomment les symboles (Deriv : `frxEURUSD`,
`cryBTCUSD`, `Volatility 100 Index` ; Exness : suffixes `.a`/`m` ; d'autres :
`EURUSD_raw`). Le moteur, lui, raisonne sur des noms canoniques (`EURUSD`,
`BTCUSDT`) liés à une fiche instrument (pip, contrat, marge).
**Choix** : un suffixe global (`symbol_suffix`) pour les cas simples **et** une
correspondance explicite `canonique → plateforme` stockée dans
`var/mt5_connection.json`, appliquée dans les deux sens (cotations remontées en
canonique, ordres transmis en nom plateforme). Aucune heuristique de préfixe
implicite : un nom non déclaré est utilisé tel quel, ce qui échoue visiblement au
lieu de trader un instrument inattendu.
**Conséquences** : un courtier supplémentaire ne demande aucune modification de
code, seulement une ligne de configuration ; en cas d'erreur de nom, le pont
signale l'instrument inconnu côté terminal (`MT5_QUOTE_MISSING` /
`MT5_UNKNOWN_SYMBOL`) sans ordre implicite. L'agent expose `GET /symbols` et le test
de connexion renvoie `symbols.matched` / `symbols.missing`, ce qui permet de régler
la correspondance sans deviner les noms. Enfin, ``CARNET_SYMBOLS`` permet de
restreindre les instruments suivis à ceux que le courtier propose réellement —
sans modifier le code ni la base.

## D-14 — Formatage de l'interface : jamais d'exception de rendu

**Contexte** : le tableau de bord s'arrêtait après la carte « Equity ». `signed()`
recevait la devise (`"USD"`) à la place du nombre de décimales ; `Intl.NumberFormat`
levait un `RangeError` et toutes les cartes suivantes (P&L, risque, marge, courbe,
limites, positions) restaient vides, alors que l'API renvoyait des valeurs correctes.

**Décision** :
1. corriger l'appel (`signed(valeur, 2, devise)`) ;
2. durcir `num()` : toute décimale non entière ou hors bornes retombe sur 2, afin
   qu'une erreur d'appel ne puisse plus interrompre le rendu ;
3. ajouter des tests statiques (arguments des appels `money`/`signed`) et un test
   d'exécution Node qui vérifie que le formatage produit du texte au lieu de lever.

**Conséquences** : 5 tests de plus (333 au total), rendu du tableau de bord non
bloquant. Leçon : les tests d'identifiants HTML ne suffisent pas, il faut aussi
tester le comportement des fonctions de formatage.

## D-15 — Canal d'alerte : URL validée, disjoncteur, configuration par environnement

**Contexte** : le formulaire réaffichait l'URL masquée (« … ») ; « Enregistrer »
l'envoyait au serveur, qui l'acceptait. Chaque envoi échouait alors en
`UnicodeEncodeError: 'ascii' codec can't encode character '\u2026'`, avec jusqu'à
3 000 échecs et 3 200 événements de journal en quelques minutes sur l'instance de
production — au point de dégrader la base pour une simple URL tronquée.

**Décision** :
1. **Validation serveur** (`validate_url`) : refus explicite du masque `…`, des
   espaces, des caractères non ASCII et des hôtes manquants ;
2. **Interface** : le champ ne contient jamais le masque (affiché en indication
   grisée) ; l'URL n'est envoyée que si l'utilisateur l'a réellement saisie ;
   refus côté client d'une URL contenant `…` ;
3. **Disjoncteur** : 5 échecs consécutifs désactivent le canal, journalisent une
   seule fois `ALERT_CHANNEL_DISABLED` et arrêtent les tentatives automatiques ;
4. **Environnement prioritaire** : `CARNET_WEBHOOK_URL` & co. s'appliquent au
   démarrage et écrasent le fichier — indispensable sur disque éphémère.

**Conséquences** : 16 tests supplémentaires (349 au total), plus aucun échec
silencieux, canal reconfigurable sans ressaisie sur Render gratuit.
