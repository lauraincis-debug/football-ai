# Carnet de Trading — version renforcée 1.2

## Statut honnête

Ce dépôt est une base de développement renforcée, **pas une application auditée ni certifiée pour la production**. Les tests automatisés sont des contrôles techniques et ne remplacent pas un audit indépendant, un examen de sécurité, des essais de marché ni une validation juridique ou réglementaire. Aucun résultat de backtest ne garantit des gains.

## Fonctionnalités

- FastAPI + SQLite, interface web responsive.
- Configuration d'authentification obligatoire au démarrage : secret JWT long, hash Argon2id et secret TOTP.
- Trades papier, clôture, limites de risque, arrêt d'urgence, journal d'événements à empreintes chaînées.
- Moteur de backtest séparé : validation OHLCV, horodatages, doublons, chronologie, trous temporels, frais, spread, slippage, sizing par risque, stops ATR, coûts, découpage train / validation / test chronologique et robustesse de paramètres.
- Adaptateur CCXT préparé pour des ordres limite réels, protégé par plusieurs drapeaux d'environnement.

## Attention : passage d'ordres réels

Le connecteur CCXT ne suffit pas à garantir une protection de position. Les ordres stop conditionnels et leur association à l'ordre d'entrée diffèrent selon les plateformes. **Ne pas activer la production avant d'avoir choisi une plateforme précise et implémenté puis testé son adaptateur de stops protecteurs, sa gestion des ordres partiellement exécutés, ses idempotency keys, la réconciliation des positions et un kill switch testé.**

L'endpoint d'ordre réel renvoie volontairement HTTP 503 tant que l'adaptateur spécifique avec stop protecteur n'a pas été développé et audité. Le formulaire n'envoie donc actuellement aucun ordre réel.

## Installation

Python 3.11+ recommandé :

```bash
python -m venv .venv
# Windows : .venv\Scripts\activate
# Linux/macOS : source .venv/bin/activate
pip install -r requirements.txt
```

## Secrets obligatoires avant le démarrage

Copier `.env.example` vers `.env` et générer les secrets. Ne pas committer `.env`.

```bash
python -c "from argon2 import PasswordHasher; print(PasswordHasher().hash(input('Mot de passe: ')))"
python -c "import secrets; print(secrets.token_urlsafe(48))"
python -c "import pyotp; print(pyotp.random_base32())"
```

Définir ensuite `JWT_SECRET`, `APP_PASSWORD_HASH`, `TOTP_SECRET` et `DATABASE_PATH` dans l'environnement de l'application. Le démarrage échoue volontairement si la configuration d'authentification manque.

Exemple Linux/macOS :

```bash
export JWT_SECRET='SECRET_ALEATOIRE_LONG'
export APP_PASSWORD_HASH='HASH_ARGON2ID'
export TOTP_SECRET='SECRET_TOTP_BASE32'
export REAL_TRADING_ENABLED=false
uvicorn src_main:app --host 127.0.0.1 --port 8000
```

Ouvrir `http://127.0.0.1:8000`. L'hôte `127.0.0.1` limite l'accès à la machine locale. Configurer l'application d'authentification TOTP avec le secret indiqué ; le parcours d'enrôlement par QR code n'est pas encore inclus.

## Trading réel : configuration bloquée par défaut

Avant même d'envisager un ordre réel, choisir la plateforme et le type de marché. Les paramètres attendus par l'adaptateur sont `EXCHANGE_ID`, `EXCHANGE_API_KEY`, `EXCHANGE_API_SECRET`, `EXCHANGE_MARKET_TYPE`, `EXCHANGE_SANDBOX`, `LIVE_TRADING_ENABLED`, `LIVE_ORDER_CONFIRMATION` et `REAL_TRADING_REVIEWED`. Les clés API doivent avoir les permissions minimales nécessaires ; **désactiver les retraits** et, si possible, restreindre l'IP. Ne jamais mettre ces secrets dans le navigateur, dans un PDF ou dans Git.

Le connecteur exige `LIVE_TRADING_ENABLED=true`, `EXCHANGE_SANDBOX=false`, `LIVE_ORDER_CONFIRMATION=I_ACCEPT_REAL_FINANCIAL_RISK` et `REAL_TRADING_REVIEWED=true`. Ces drapeaux ne constituent pas un audit et ne doivent pas être activés tant que les protections spécifiques à la plateforme ne sont pas terminées. Le code actuel ne garantit pas la création d'un stop-loss lié à l'ordre : garder le mode réel désactivé.

## Backtest : données requises

CSV avec en-têtes `timestamp,open,high,low,close,volume` ; minimum 100 bougies, timestamps UTC croissants, sans doublons, sans trous temporels anormaux, valeurs OHLC cohérentes, prix strictement positifs et volumes non négatifs. Le rapport produit des sections train / validation / test chronologiques et des variations de paramètres prédéfinies. Les coûts sont des hypothèses que l'utilisateur doit calibrer au marché et à la plateforme.

La stratégie SMA / ATR intégrée est un exemple de pipeline de validation, pas une stratégie recommandée. Aucun verdict « stratégie rentable » ne doit être produit automatiquement. Exiger des données provenant de sources vérifiables, des splits chronologiques répétés, du walk-forward, des frais réalistes, un test de sensibilité, du paper trading prolongé et une revue indépendante.

## Tests

```bash
PYTHONPATH=. pytest -q
```

Les tests fournis couvrent des contrôles critiques de données et de limites, mais ils ne sont pas exhaustifs. La production nécessite davantage de tests d'intégration avec la sandbox de la plateforme choisie et des tests de sécurité indépendants.

## Connecteurs MT5 Forex et crypto

### Forex — MetaTrader 5

- Module `mt5_adapter.py`, exécuté sur **Windows** avec le terminal MetaTrader 5 installé et connecté à un compte de démonstration.
- Envoie un ordre marché avec `sl` et `tp` inclus dans la requête native MT5 ; effectue `order_check`, contrôle le volume, puis vérifie les positions retournées par `positions_get`.
- Le compte réel est refusé par défaut. Pour un compte non démo, plusieurs drapeaux explicites sont requis ; ils ne doivent pas être activés avant revue humaine documentée.
- Le résultat d'un ordre ambigu n'est jamais rejoué automatiquement. En cas d'écart de rapprochement ou de SL manquant, l'adaptateur lève une erreur urgente.
- Un compte de démonstration MT5 n'est pas une sandbox identique à tous les courtiers : les règles de volume, de remplissage, de stop level, de couverture / netting et de disponibilité doivent être testées chez le courtier cible.

### Cryptomonnaies — CCXT

- Module `crypto_adapter.py`, configuré indépendamment de MT5 via `CRYPTO_EXCHANGE_ID`, `CRYPTO_API_KEY` et `CRYPTO_API_SECRET`.
- Sandbox / testnet activé par défaut ; le code refuse d'envoyer une entrée si la plateforme ne déclare pas le support des SL / TP attachés pour le marché demandé.
- La prise en charge réelle dépend de l'exchange, du marché spot / dérivés et de la version de CCXT. Les tests doivent être exécutés sur le testnet de l'exchange choisi. Les comptes spot n'ont pas de notion universelle de « position » : rapprochement par soldes et ordres, tandis que les dérivés peuvent exposer `fetch_positions`.
- Aucun retry automatique après timeout : le résultat peut être ambigu. Il faut rapprocher ordres, trades, soldes et protections avant toute action.

### Routage unifié

`execution_router.py` expose `submit(venue="mt5"|"crypto", ...)` et `reconcile(...)`. Cela ne signifie pas que les capitaux des deux comptes sont fusionnés : les soldes et risques doivent rester isolés par courtier et devise, puis être convertis explicitement pour un tableau consolidé.

### Blocage volontaire de l'API de trading réel

L'endpoint `/api/live/order` reste bloqué par HTTP 503. Les adaptateurs sont disponibles pour des tests contrôlés, mais l'application web n'a pas encore de gestionnaire de risque relié de façon fiable aux fonds propres, marges, positions et pertes réellement constatés sur chaque courtier, ni de cycle complet de gestion des ordres partiellement exécutés, des annulations, des stops modifiés et des reconnexions. Ne pas supprimer ce blocage avant d'avoir implémenté ces contrôles, testé sur démo / testnet et fait réaliser un audit indépendant.

### Tests et portée des résultats

Les tests `tests/test_adapters.py` utilisent des faux courtiers : ils testent les contrats et les garde-fous, pas les serveurs de MT5 ni d'exchange. Ils ne constituent donc pas un test sandbox réel. L'environnement de génération peut ne pas contenir `MetaTrader5`, `ccxt` ou toutes les dépendances ; installer `requirements.txt` dans un environnement dédié avant de lancer `PYTHONPATH=. pytest -q`.

Sources techniques officielles consultées :
- [MetaTrader 5 Python — order_send](https://www.mql5.com/en/docs/python_metatrader5/mt5ordersend_py)
- [MetaTrader 5 Python — positions_get](https://www.mql5.com/en/docs/python_metatrader5/mt5positionsget_py)
- [Manuel CCXT — ordres stop et take-profit attachés](https://docs.ccxt.com/fr/docs/manual)

Documentation complémentaire : `INTEGRATION_MT5_CRYPTO.md` et `docs/Carnet_Trading_Addendum_MT5_Crypto.pdf`.

L'application n'est ni auditée indépendamment, ni certifiée, ni déclarée prête pour la production.
