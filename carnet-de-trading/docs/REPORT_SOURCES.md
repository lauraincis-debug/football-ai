# Sources, vérifications et provenance des éléments du livrable

Ce document recense ce qui a servi à construire l'application, ce qui a été
vérifié localement, et ce qui reste déclaratif faute d'accès externe. Il permet à
un auditeur de refaire les vérifications.

---

## 1. Source principale : cahier des charges consolidé V1

- **Document** : « Carnet de Trading — Cahier des charges consolidé V1 — 1er
  novembre 2026 », sections §1 à §27 + annexes A (glossaire), B (checklist de
  livraison), C (dépôts GitHub et licences).
- **Usage** : chaque section a été traduite en exigences vérifiables ; la
  traçabilité est dans `docs/CAHIER_DES_CHARGES.md`.
- **Vérification** : les valeurs chiffrées du §5 (0,5 % / 2 % / 5 % / 10 % / 3
  positions / 1,5 % de risque ouvert / ratio 1,2 / spread 25 bps / fraîcheur 3 s /
  déviation 12 bps) sont codées en constantes et **assertées par les tests**
  (`test_default_policy_matches_specification`), pas seulement commentées.

## 2. Compétences « day-trader » (pack de skills)

- **Dépôt** : `Jakeschincariol/day-trader-skill` (GitHub), installé localement dans
  `~/.claude/skills/` — hors du dépôt applicatif, conformément à la consigne.
- **Contenu utilisé** : vocabulaire du domaine et enchaînement de pipeline
  (`scanner → news → entry → exit → timemachine → budget → risk → broker`),
  priorité au « paper-first ». Aucun code du pack n'a été copié : l'application est
  écrite à partir du cahier des charges ; le pack a servi de référence de
  vocabulaire et de méthode.
- **Vérification** : installation confirmée (11 skills, 315 tests du pack passés
  dans son propre environnement). Le dépôt `football-ai` n'a pas été modifié par
  cette installation.

## 3. Références techniques consultées (documentation publique)

| Sujet | Référence | Ce qui en a été retenu |
|---|---|---|
| MT5 Python | documentation officielle `MetaTrader5` (MQL5.com) | disponibilité Windows uniquement, fonctions `initialize/account_info/positions_get/orders_get/history_deals_get`, champs `ticket/volume/sl/tp/profit` |
| Crypto spot | documentation API type Binance Spot | signature HMAC-SHA256 de la query string, `X-MBX-APIKEY`, `recvWindow`, `apiRestrictions` (dont `enableWithdrawals`, `enableFutures`) |
| TOTP | RFC 6238 / RFC 4226 | HMAC-SHA1, période 30 s, 6 chiffres, fenêtre ±1 |
| Mots de passe | recommandations OWASP (2023) | PBKDF2-HMAC-SHA256, sel unique ≥ 16 octets, itérations élevées |
| SQLite | documentation officielle | mode WAL, `PRAGMA integrity_check`, backup API |
| HTTP | RFC 7235 / 9110 | `Authorization: Bearer`, codes 400/401/403/404/409/429 |
| Convertisseur | conventions de marché | pips vs points, lots vs unités, valeur du point par instrument |
| systemd | `systemd.exec(5)` / `systemd.service(5)` | directives de durcissement (`ProtectSystem`, `NoNewPrivileges`, `StateDirectory`, `ReadWritePaths`) |
| Reverse proxy | documentation nginx (`ngx_http_proxy_module`, `ngx_http_ssl_module`) et Caddy (`reverse_proxy`) | TLS 1.2/1.3, HSTS, `proxy_pass` vers la boucle locale, limitation de débit |

**Important** : aucune de ces sources n'a été utilisée pour copier du code ; elles
ont servi à valider les structures de données et les protocoles. Les implémentations
sont originales et testées contre des doublures locales.

## 4. Vérifications exécutées localement

| Vérification | Méthode | Résultat |
|---|---|---|
| Suite de tests | `PYTHONPATH=backend:tests python3 -m unittest discover -s tests -p 'test_*.py'` | **308 tests OK** |
| Couverture | `coverage run` (venv jetable hors dépôt) puis `coverage report` | **89 % global**, risque 98 %, ordres 98 % |
| Compilation | `python3 -m compileall backend/carnet` | aucune erreur |
| Cohérence interface | script d'audit : identifiants HTML vs références JS, vues vs navigation vs rendus | 164 identifiants, 134 références, **0 manquante**, 7/7/7 |
| Démarrage service | `scripts/run.sh` puis `GET /api/health`, `/api/state` | `ok: true`, réconciliation `OK`, cotations fraîches |
| Sauvegarde/restauration | `scripts/backup.py create/verify/drill` | création et exercice de restauration réussis |
| Journal chaîné | `POST /api/journal/verify` | `ok: true` |
| Pont MT5 démo | agent réel + terminal factice, `tests/test_mt5.py` (35 cas) | compte réel refusé, bracket obligatoire, timeout ⇒ statut inconnu |
| Canal d'alerte | `tests/test_alerts.py` (20 cas, transport factice) | formats Slack/Discord/Teams/générique, 3 réessais, URL masquée |
| Kit de déploiement | `tests/test_deploy_kit.py` (19 cas) + `bash -n` | unité durcie, TLS moderne, scripts idempotents |

## 5. Éléments déclaratifs (non vérifiables ici)

| Élément | Pourquoi | Où c'est signalé |
|---|---|---|
| Connexion MT5 réelle | pas de courtier, pas de Windows | `BLOCKERS.md` B1 |
| Connexion exchange réelle | pas d'exchange ni de clé | `BLOCKERS.md` B2 |
| Test end-to-end navigateur | aucun navigateur dans l'environnement | `BLOCKERS.md` B7 |
| Conformité réglementaire | dépend du pays et du compte | `BLOCKERS.md` B5 |
| Audit indépendant | prestation externe | `BLOCKERS.md` B6 |
| Performances de marché | aucune promesse ; backtests = simulation | `README.md` §9, `CAHIER_DES_CHARGES.md` §22 |

## 6. Reproductibilité

- Marché simulé déterministe : graine `CARNET_SEED=20261101`, volatilités et prix
  de référence fixés dans `config.py`.
- Tests : base temporaire par test, aucun réseau, aucune horloge murale
  indispensable (les dates de marché sont injectées).
- Backtests : résultats identiques à graine et configuration égales, vérifié par
  `test_determinism`.
- Sauvegardes : empreinte SHA-256 consignée dans le manifeste et vérifiable.

## 7. Licences et conformité des dépôts

- Aucun code tiers n'est inclus dans le livrable : pas d'obligation de licence
  virale (GPL/AGPL) à respecter.
- Les documents de référence (cahier des charges, pack de skills) restent la
  propriété de leurs auteurs ; ils ne sont pas redistribués dans ce dépôt.
- Le livrable ne contient ni secret, ni identifiant, ni clé API.
