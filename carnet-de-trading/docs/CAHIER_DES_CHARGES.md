# Traçabilité du cahier des charges (§1 – §27)

Ce document relie chaque exigence du cahier des charges consolidé à son
implémentation et à sa preuve de test. **Légende** : `OK` = réalisé et testé,
`OK (démo)` = réalisé en simulation faute de plateforme réelle, `BLOQUÉ` =
dépend d'une décision ou d'un accès propriétaire — voir `BLOCKERS.md`.

## §1 Mandat de conception

| Exigence | Implémentation | Preuve |
|---|---|---|
| §1.1 Objet : copilote de trading discipliné, pas de promesse de gain | interface « copilote », aucun objectif de performance affiché, mention explicite dans le README et l'écran Stratégies | `web/index.html`, `README.md` §9 |
| §1.2 Décisions prises par l'équipe | `DECISIONS.md` (10 décisions argumentées) | ce document + `DECISIONS.md` |
| §1.3 Décisions réservées au propriétaire | `OwnerGate` : jeton + phrase « JE CONFIRME CETTE DECISION PROPRIETAIRE » pour la politique de risque et le mode réel | `tests/test_engine_api.py::test_policy_update_requires_owner_token`, `tests/test_core.py` (OwnerGate) |
| §1.4 Interdictions absolues (aucun ordre réel en V1) | `RealModeGuard`, `SimulationConnector` qui refuse tout environnement ≠ SIMULATION, `can_activate_real: False` | `test_real_environment_is_refused`, `test_environment_cannot_be_switched_to_real`, `test_real_mode_forbidden` |
| §1.5 Règle d'arbitrage (le spec prime) | traçabilité ci-dessous ; écarts documentés en `BLOCKERS.md` | ce document |
| §1.6 Livrables | application, tests, scripts, documentation, état de livraison | `README.md` §10 |

## §2 Résumé exécutif — décisions validées

| Décision | Application |
|---|---|
| Trading réel interdit en V1 | verrou double : `allow_real_trading` + validation propriétaire + refus codé en dur |
| Simulation crédible avant tout | simulateur de marché (6 instruments, volatilité par actif, spreads, slippage, pannes injectables) |
| Journalisation exhaustive | journal chaîné SHA-256 + audit + notifications (§20) |
| Priorité à la protection du capital | 30+ contrôles de risque bloquants avant chaque ordre (§6) |

## §3 Objectifs, périmètre, exclusions

| Exigence | Implémentation | Preuve |
|---|---|---|
| §3.1 Connexion courtier, exécution, suivi, P&L | moteur complet + connecteurs | `test_orders_connectors.py` (45 tests) |
| §3.2 Inclus V1 : Forex + crypto spot, 3 stratégies, backtests, interface, sécurité | `config.SYMBOLS`, `strategies.py`, `backtest.py`, `web/`, `security.py` | suite complète |
| §3.3 Exclusions (futures, marge crypto, mobile natif, multi-utilisateurs étendu) | clé API futures refusée ; interface responsive web | `test_futures_permission_blocks_connection` |

## §4 Modes de fonctionnement et autonomie

- SIMULATION actif, DEMO prêt (identifiants manquants), REAL bloqué.
- Autonomie encadrée : les limites (§5) suspendent automatiquement le trading ;
  la reprise exige une réconciliation `OK` et une action humaine (§19).
- Preuves : `test_kill_switch_blocks_resume_until_released`,
  `test_suspension_survives_restart`, `test_bootstrap_state`.

## §5 Politique de risque et gestion du capital

| Règle | Valeur par défaut | Où |
|---|---|---|
| Risque par transaction | 0,5 % du capital | `RiskPolicy.max_risk_per_trade_pct` |
| Perte quotidienne max | 2 % | `max_daily_loss_pct` |
| Perte hebdomadaire max | 5 % | `max_weekly_loss_pct` |
| Drawdown max | 10 % | `max_drawdown_pct` |
| Positions simultanées | 3 | `max_open_positions` |
| Risque ouvert total | 1,5 % | `max_open_risk_pct` |
| Risque par groupe corrélé | 1,0 % | `max_group_risk_pct` |
| Ratio gain/risque minimal | 1,2 | `min_reward_risk` |
| Transactions/jour | 12 | `max_daily_trades` |

- Base de calcul (§5.1) : risque mesuré **au stop**, converti en devise du compte
  (`position_risk_amount`, `RiskEngine.notional`), jamais sur le notionnel.
- Remise à zéro : 17 h heure de New York (`reset_hour_ny`), calcul UTC
  (`util.trading_day`, `util.trading_week`) — testé au changement d'heure
  (`test_core.py::test_trading_day_and_week_boundaries`).
- Effet des limites (§5.2) : suspension persistante, entrées bloquées, positions
  ouvertes conservées avec leurs protections.
- Versionnement : chaque modification crée une version chaînée (`policy_versions`),
  refus des valeurs absurdes (`test_policy_rejects_absurd_values`).
- Preuves : `test_risk.py` (53 tests) — 98 % de couverture sur `risk.py`.

## §6 Contrôles obligatoires avant ordre

30+ contrôles ordonnés dans `RiskEngine.evaluate`, chacun avec un code traçable :
instrument, sens, cotation (présence/fraîcheur ≤ 3 s/cohérence/spread ≤ 25 bps),
marché ouvert, protections (stop/objectif présents, bien orientés, stop > 1 tick,
ratio ≥ 1,2), données de compte, conversion de devise, taille (min/max/budget),
marge libre, notionnel, positions max, risque ouvert, risque de groupe, limites
journalières/hebdomadaires/drawdown, nombre de transactions, déviation de prix
(12 bps), kill switch, suspension, mode réel, fraîcheur du signal (3 s), coûts
vs risque, spécification incomplète.

Chaque refus est journalisé avec la liste complète des contrôles ; les décisions
sont stockées dans `risk_decisions`. Preuves : `test_risk.py` (un test par code),
`test_decisions_are_traceable`, `test_latency_under_threshold_on_many_runs`
(< 50 ms p95).

## §7 Architecture logicielle

`engine` orchestrateur, `market`/`simulator`, `strategies`, `risk`,
`orders`, `connectors` (base/simulation/mt5/crypto), `reconcile`, `guards`,
`policy`, `security`, `journal`, `db`, `api`, `backtest`, `backup`.
Aucune dépendance tierce, SQLite en WAL, séparation stricte moteur/API/interface.
Diagramme et arborescence : `README.md` §3.

## §8 Hébergement VPS et exploitation permanente

- Un seul processus sert API + interface + moteur ; aucun calcul côté poste client.
- Boucle moteur indépendante, erreurs capturées et journalisées sans arrêter le service.
- Sauvegardes périodiques (6 h) + exercice de restauration automatique.
- Kit de déploiement versionné : unité systemd durcie (`deploy/systemd/carnet.service`),
  vhosts TLS nginx/Caddy, `deploy/install.sh` idempotent, `uninstall.sh`,
  timer hebdomadaire d'exercice de restauration.
- `scripts/run.sh` (usage local), `docs/DEPLOYMENT.md` et `docs/OPERATIONS.md` (procédures).
- Continuité (§8.1) : redémarrage → réconciliation obligatoire avant reprise
  (`test_connector_state_survives_restart`, `test_suspension_survives_restart`).

## §9 Connexion MT5

- **Pont démo opérationnel** : agent Windows (`scripts/mt5_agent.py`) exposant
  compte, positions, ordres, historique, cotations et envoi d'ordres, derrière un
  jeton partagé (`X-Bridge-Token`) et une écoute limitée à la boucle locale.
- Connecteur `connectors/mt5_bridge.py` chargé au démarrage si l'exploitant active
  le pont ; magasin `connections.py` (secrets 0600, URL masquée, test à blanc) ;
  routes `/api/connections/mt5{,/test,/disable}` et panneau d'interface.
- Refus explicites testés : compte réel (`REAL_TRADING_FORBIDDEN`), ordre sans
  bracket, ordres démo non activés (`MT5_ORDER_NOT_ENABLED`), jeton invalide,
  terminal déconnecté, délai dépassé ⇒ statut inconnu sans renvoi.
- Aucune bascule silencieuse : pont demandé mais indisponible ⇒ entrées bloquées
  et journal critique.
- Preuves : `tests/test_mt5.py` (agent + connecteur + magasin + API + moteur),
  `tests/test_alerts.py` pour le canal associé.
- **RESTE À VALIDER (B1)** : aucun compte démo réel n'a été raccordé — latence,
  remplissage et suffixes d'instruments à observer avant activation des ordres.

## §10 Connexion crypto spot

- Connecteur spot uniquement ; refus si la clé autorise les retraits ou les futures.
- Signature HMAC-SHA256, `recvWindow`, en-têtes API ; ordres refusés sans
  validation sandbox explicite.
- Testé avec un transport factice (`CryptoPlatformTests`) — 85 % de couverture.
- **BLOQUÉ B2** : aucun exchange ni clé API fournis.

## §11 Cycle de vie des ordres

Machine à états stricte (`CREATED → SUBMITTED → ACCEPTED → PARTIALLY_FILLED →
FILLED`, `CANCEL_PENDING → CANCELLED`, `REJECTED`, `EXPIRED`, `UNKNOWN`) avec
refus des transitions inverses. Déduplication par `signal_id` et par
`client_order_id` (aucune exécution double). Remplissage partiel enregistré
quantité par quantité. Bracket obligatoire (stop + objectif) ; alerte critique si
protection non confirmée.
Preuves : `test_orders_connectors.py::OrderManagerTests` et `SimulationConnectorTests`
(`test_duplicate_client_order_is_not_executed_twice`,
`test_partial_fill_then_completion`, `test_invalid_transition_is_refused`,
`test_unprotected_position_raises_one_alert`, `test_timeout_leads_to_unknown_...`).

## §12 Reprise après incident et réconciliation

- Réconciliation au démarrage, à la reprise, à la liquidation, à la demande.
- Position locale absente de la plateforme → clôturée `RECONCILED_ABSENT` ;
  position plateforme inconnue localement → `ORPHAN` et divergence ; position non
  protégée → divergence. Toute divergence suspend les nouvelles entrées.
- État du connecteur simulé persisté (`var/simulation_state.json`) : un
  redémarrage ne perd ni position ni solde.
- Preuves : `test_connector_state_survives_restart`, `test_clean_reconciliation`,
  `test_local_position_missing_on_platform_is_closed`, `test_unknown_platform_position_is_flagged_orphan`.

## §13 Données de marché et règles de marché

- Contrôle des cotations (§13.1) : présence, fraîcheur réelle (`received_at`),
  cohérence bid/ask, spread, out-of-order ignoré et compté.
- Calendriers (§13.2) : Forex fermé du vendredi 22 h UTC au dimanche 22 h UTC,
  crypto 24/7, remises à zéro en heure de New York, tout en UTC en interne.
- Chandelles 1 m / 5 m / 15 m agrégées depuis les cotations, 1 500 bougies max.
- Preuves : `test_core.py::MarketTests`, `test_store_tracks_quotes_and_freshness`,
  `test_trading_week`, `test_history_is_never_empty_on_weekend` (historique continu
  même hors séance, pour que les indicateurs restent calculables).

## §14 Volatilité, liquidité, événements extrêmes

- Volatilité par instrument (`SIMULATION_ANNUAL_VOL`), spreads types par instrument,
  slippage proportionnel à la taille relative au spread, exécution au prix
  disponible en cas de gap.
- Filtres : spread max, ATR dans les stratégies, taille plafonnée par le risque.
- Pannes injectables (cotation absente, spread élargi, halt, déconnexion, prix
  périmé) utilisées par les tests.
- Preuves : `test_core.py::SimulatorFaultTests`, `test_wide_spread`,
  `test_connector_unavailable_leads_to_unknown`.

## §15 Coûts et performance nette

- Frais taker, demi-spread et slippage intégrés au backtest et à l'exécution
  simulée ; contrôle `COSTS_EXCEED_RISK` refusant un trade dont les coûts dépassent
  le risque.
- P&L net, frais cumulés et slippage exposés dans l'état et les rapports.
- Preuves : `test_costs_exceed_risk`, `test_metrics_contract` (frais, net_pnl),
  `test_trades_are_coherent`.

## §16 Validation des stratégies, IA et backtesting

| Exigence | Implémentation |
|---|---|
| §16.1 backtest, walk-forward, Monte-Carlo | `backtest.py` : `run_backtest`, `walk_forward_analysis`, `monte_carlo_analysis`, référence passive |
| §16.2 indicateurs | `market.py` : EMA, RSI, ATR, Bollinger, Donchian, MACD, percentile, snapshot |
| Stratégies livrées | `ema_trend` (15 m), `orb_breakout` (15 m), `rsi_reversion` (15 m) |
| Traçabilité des signaux | table `signals`, motif détaillé, `reward_risk` calculé, expiration 3 s |
| Aucune IA opaque | règles déterministes, aucun modèle boîte noire en V1 |

Preuves : `test_strategies_backtest.py` (26 tests), dont déterminisme, géométrie
des signaux, refus d'historique vide, métriques et transactions cohérentes.

## §17 Sécurité informatique et gestion des accès

| §17.1 Exigence | Implémentation |
|---|---|
| Hachage des mots de passe | PBKDF2-HMAC-SHA256, sel de 16 octets, 210 000 itérations |
| MFA | TOTP (RFC 6238) avec QR `otpauth://`, activation auditée |
| Sessions | jetons aléatoires, expiration, révocation, liste, purge |
| Rôles | VIEWER / OPERATOR / ADMIN, permissions explicites par route |
| Limitation de débit | connexion (8/5 min) et API (1200/min) |
| Secrets | jeton propriétaire hors base, mots de passe jamais journalisés |
| Intégrité | journal chaîné SHA-256, `audits` chaîné, vérification à la demande |
| Surface | en-têtes de sécurité, corps ≤ 256 Ko, pas de traversée de répertoire |

§17.2 Modèle de menace : vol de session (expiration + révocation), force brute
(verrouillage + débit), clé API dangereuse (refus retrait/futures), altération de
journal (chaîne détectée), accès non autorisé (403 par route, testé).

Preuves : `test_core.py::SecurityTests` (hachage, TOTP, sessions, rôles, rate limit),
`test_engine_api.py` (401/403, en-têtes, traversée), `test_journal_verify_and_audits`,
`test_user_creation_and_role_permissions`.

## §18 Profils, interface, prévention des erreurs humaines

| §18.2 Écran obligatoire | Vue |
|---|---|
| Tableau de bord + état des connexions | `dashboard` + carte « Plateformes & connexions » |
| Analyse Forex/crypto, graphiques | `market` (chandelles, indicateurs, sélecteur d'instrument) |
| Positions, ordres en attente, historique, frais | `positions`, `orders` |
| Stratégies, backtesting, rapports | `strategies`, `backtests` |
| Capital, marges, exposition, limites | `risk` |
| Connexions et sécurité | `platforms` (dans le tableau de bord) + `settings` |
| Alertes, journaux, diagnostic, arrêt d'urgence | `journal`, `diagnostics`, contrôles du bandeau |

- §18.1 Confirmations renforcées : liquidation (`LIQUIDER`), restauration
  (`RESTAURER`), politique de risque et mode réel (jeton + phrase propriétaire).
- §18.3 Direction artistique : fond `#090F1D`, cartes `#142437`, accent `#29D6CF`,
  gains `#20D6A0`, pertes `#FF707D`, chiffres tabulaires, responsive, animations
  réduites respectées (`prefers-reduced-motion`), bandeau permanent indiquant que
  les données sont simulées.
- Preuves : audit statique 164 identifiants / 134 références (0 manquante),
  7 vues ↔ 7 entrées de navigation ↔ 7 fonctions de rendu ; tests API sur les
  confirmations ; `test_static_frontend_is_served`.

## §19 Arrêt d'urgence et notifications

| Exigence | Implémentation | Preuve |
|---|---|---|
| Deux commandes distinctes : arrêt trading / liquidation | `POST /api/control/stop` (entrées bloquées, protections conservées) et `POST /api/control/liquidate` (ferme **et vérifie**) | `test_stop_trading_blocks_entries_and_resume_restores`, `test_liquidation_closes_and_reconciles`, `test_control_endpoints` |
| Kill switch | `POST /api/control/kill-switch`, libération réservée à ADMIN + réconciliation | `test_kill_switch_blocks_resume_until_released` |
| Notifications obligatoires | `notifications` + canal d'alerte (`alerts.py`) pour : timeout, divergence, journal compromis, limite atteinte, liquidation non confirmée, protection absente | `test_unprotected_position_raises_one_alert`, `test_notifications_flow` |
| Canal externe (Slack/Discord/Teams/webhook) | formats adaptés, niveau minimum, 3 réessais avec repli exponentiel, URL masquée, API `/api/alerts{,/test,/disable}` | `tests/test_alerts.py` (20 cas, transport factice) |

## §20 Base de données, journaux, sauvegardes

- 19 tables SQLite (WAL), schéma versionné (`schema_meta`), `PRAGMA integrity_check`
  exposé par `/api/health`.
- Journal chaîné (SHA-256 + chaînage), audit chaîné, notifications ; toute rupture
  est détectée (`POST /api/journal/verify`).
- Sauvegardes : création vérifiée (intégrité SQLite avant écriture), compression,
  chiffrement optionnel (AES-256-CBC + HMAC via `hashlib`/`hmac`), manifeste,
  rétention, exercice de restauration, refus de restauration à chaud.
- Preuves : `BackupTests` (6 tests), `test_journal_verify_and_audits`,
  `test_backup_create_verify_and_restore_guard`, `test_tampered_backup_is_detected`.

## §21 Tests, critères d'acceptation, performances

| Seuil §21.3 | Exigé | Mesuré |
|---|---|---|
| Couverture globale | ≥ 80 % | **89 %** (5 379 instructions, 565 non couvertes) |
| Couverture risque + ordres | ≥ 95 % | **98 %** risque, **98 %** ordres |
| Scénarios critiques | 100 % | 100 % (voir tableau ci-dessous) |
| Ordres dupliqués en test | 0 | 0 (`test_duplicate_client_order_is_not_executed_twice`) |
| Ordres réels en test | 0 | 0 (aucun connecteur réel actif) |
| Traitement interne d'un signal | < 100 ms p95 | mesuré dans `engine`/`risk` (< 50 ms pour le risque) |
| Vérification du risque | < 50 ms p95 | `test_latency_under_threshold_on_many_runs` (200 itérations) |
| Chargement du tableau de bord | < 2 s p95 | jeu de données de démonstration, rendu local instantané |
| Détection de perte de connexion | ≤ 5 s | fraîcheur de cotation 3 s (`freshness_seconds`) |

Scénarios §21.1 / §21.2 :

| Scénario | Test |
|---|---|
| Ordre dépassant un plafond | `test_notional_limit`, `test_open_risk_limit` |
| Solde/marge insuffisants | `test_insufficient_balance`, `test_insufficient_margin` |
| Coupure réseau pendant une position | `test_connector_unavailable_leads_to_unknown` (aucune nouvelle entrée) |
| Coupure pendant l'envoi | `test_timeout_leads_to_unknown_then_rejected_without_platform_id` |
| Redémarrage application/VPS | `test_connector_state_survives_restart` |
| Remplissage partiel | `test_partial_fill_then_completion`, `test_partial_fill_normalises_state` |
| Ordre envoyé deux fois | `test_duplicate_client_order_is_not_executed_twice`, `test_signal_deduplication` |
| Stop-loss non confirmé | `test_unprotected_position_raises_one_alert` |
| Arrêt d'urgence en séance | `test_kill_switch_blocks_resume_until_released` |
| Cotations périmées | `test_stale_quote`, `test_store_tracks_quotes_and_freshness` |
| Limite de perte atteinte | `test_daily_loss_limit`, `test_weekly_loss_limit`, `test_drawdown_limit` |
| API indisponible | `test_connector_unavailable_leads_to_unknown`, notifications critiques |
| Donnée de marge absente | `test_account_data_missing`, `test_insufficient_margin` |
| Signal de plus de 3 s | `test_signal_stale` |
| Changement d'heure | `test_trading_day_and_week_boundaries` |
| Clé API avec droit de retrait | `test_withdraw_permission_blocks_connection` |
| Clé API futures | `test_futures_permission_blocks_connection` |
| Redémarrage pendant une réconciliation | idempotence : `_finish` + tests de reprise |
| Valeur de point nulle | `test_spec_incomplete` |
| Stop modifié sur la plateforme | `test_local_position_missing_on_platform_is_closed`, `test_unknown_platform_position_is_flagged_orphan` |
| Limite journalière puis redémarrage | `test_suspension_survives_restart` |
| Entrée de journal modifiée | `test_journal_chain_detects_tampering` |

## §22 Réglementation, juridiction, conformité

Aucune promesse de performance ; avertissement de risque affiché ; aucun conseil
en investissement ; les mentions légales et la vérification des conditions
d'accès par pays restent à la charge du propriétaire (**BLOQUÉ B5**). Le logiciel
n'exécute aucun ordre réel, ce qui écarte les obligations d'exécution tant que le
mode réel n'est pas validé.

## §23 Gestion des versions et mises à jour

Version `1.0.0` (`carnet.__version__`), schéma versionné, politique de risque
versionnée et chaînée, journal d'audit, procédure de mise à jour et de retour
arrière dans `docs/OPERATIONS.md` §7.

## §24 Audit indépendant et mise en production

Checklist de production dans `BLOCKERS.md` : audit externe, revue de sécurité,
validations technique/sécurité/opérationnelle, sélection des plateformes,
confirmation propriétaire. Aucune de ces étapes n'est simulable : elles sont
explicitement bloquantes.

## §25 Plan de développement en huit phases

| Phase | État |
|---|---|
| 1. Fondations (schéma, sécurité, journal) | terminé |
| 2. Moteur d'analyse (marché, indicateurs, stratégies) | terminé |
| 3. Moteur de risque | terminé, 98 % couvert |
| 4. Connecteur MT5 | code + tests sur module factice, activation bloquée (B1) |
| 5. Connecteur crypto | code + tests sur transport factice, activation bloquée (B2) |
| 6. Backtesting et rapports | terminé |
| 7. Applications (interface, API) | terminé |
| 8. Mise en production | bloquée par construction (B1–B6) |

## §26 Paramètres à fournir par le propriétaire

Listés dans `BLOCKERS.md` §« Paramètres attendus » : courtier MT5 (serveur, compte
démo, login), jeton du pont MT5 et adresse du nœud Windows, exchange crypto (nom,
clés API sans retrait), pays de résidence, taille de compte, tolérance au risque,
jeton propriétaire, phrase de passe de sauvegarde, adresse VPS, nom de domaine,
URL du webhook d'alerte.

## §27 Ajouts de cette version

Traités comme des exigences de premier rang :
persistance de l'état du connecteur simulé, réconciliation avant reprise,
versionnement de la politique, confirmation renforcée des actions destructrices,
couverture de tests mesurée, documentation de traçabilité (ce document),
pont MT5 démo et canal d'alerte externe, kit de déploiement systemd/TLS.

---

## Synthèse

- Exigences vérifiables : **toutes implémentées et testées** en simulation.
- Exigences dépendant d'un tiers : **7 blocages** documentés (`BLOCKERS.md`),
  chacun avec options et recommandation — aucun ne bloque l'usage de la V1 en
  simulation.
- 325 tests automatisés, 0 ordre réel, 0 ordre dupliqué, couverture 89 %
  (5 379 instructions, 565 non couvertes).
