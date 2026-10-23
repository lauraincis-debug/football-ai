# Addendum d'implémentation — Forex MT5 et cryptomonnaies

**Version de l'addendum : 1.3 — 23 octobre 2026**

## 1. Décision d'architecture

Le compte applicatif Carnet de Trading peut suivre deux connecteurs distincts :

1. **Forex / MetaTrader 5** — pont Python `MetaTrader5`, terminal MT5 installé sur Windows, compte démo recommandé pour l'intégration.
2. **Cryptomonnaies / CCXT** — connecteur crypto indépendant, plateforme choisie par configuration, testnet activé par défaut.

Le fait de les afficher dans une même application ne fusionne pas les soldes ni les risques. Chaque compte garde sa propre devise, marge, exposition, frais et règles d'exécution. Une vue consolidée doit convertir les valeurs au moyen d'un taux horodaté et garder les valeurs d'origine.

## 2. Modules livrés

- `mt5_adapter.py` : connexion, vérification compte / symbole / volume, `order_check`, envoi avec SL et TP natifs inclus, rapprochement avec `positions_get`, refus d'un résultat non rapproché.
- `crypto_adapter.py` : CCXT, sandbox par défaut, vérification explicite des fonctionnalités `stopLoss` et `takeProfit`, envoi d'une seule entrée avec protections attachées, aucun retry automatique après résultat ambigu, lecture soldes / ordres / positions si la plateforme les expose.
- `execution_router.py` : API Python unifiée `submit(venue=...)` et `reconcile(venue=...)`.
- `tests/test_adapters.py` : tests simulés de refus, paramètres SL / TP, garde-fous et absence de retry aveugle.

## 3. Règles MT5

Le connecteur inclut le stop-loss dans la requête `TRADE_ACTION_DEAL`, avec un take-profit optionnel. Il vérifie le symbole, le tick, les limites et le pas de volume, les directions SL / TP, puis utilise `order_check` avant `order_send`. Après envoi, il lit les positions et refuse de déclarer l'ordre protégé si une position correspondante ou un SL côté courtier n'est pas visible.

Le comportement dépend encore du courtier : mode netting / hedging, types de remplissage, stop level, volume minimum, glissement et codes de retour. Les règles exactes doivent être validées sur le compte démo du courtier cible. L'installation Python MT5 est prévue sur Windows avec le terminal approprié.

## 4. Règles crypto

Les plateformes n'implémentent pas toutes les protections de la même manière. Le connecteur refuse l'ordre si CCXT ne confirme pas explicitement le support des SL / TP attachés pour le marché choisi. Il ne tente pas de substituer une entrée non protégée. La compatibilité doit être testée pour l'exchange, le symbole, spot ou dérivés, et la version de CCXT.

Pour un compte spot, les actifs sont principalement rapprochés via soldes, ordres et trades ; la notion de position n'est pas standardisée comme pour les dérivés. Pour les dérivés, `fetch_positions` est utilisé seulement si l'exchange déclare cette capacité. La gestion des positions courtes, `reduceOnly`, du mode hedge, de la marge isolée / croisée et des OCO doit être vérifiée par plateforme avant extension.

## 5. Verrous de sécurité

Les deux connecteurs exigent plusieurs drapeaux explicites avant l'envoi. Les valeurs par défaut maintiennent le réel désactivé. Les clés API doivent être conservées côté serveur, jamais dans le navigateur ou le dépôt. Pour les clés crypto, désactiver les retraits et limiter les permissions au minimum.

Aucun envoi n'est automatiquement rejoué après timeout : le serveur distant peut avoir accepté l'ordre malgré l'absence de réponse. La procédure est alors : geler les nouveaux envois, consulter les ordres et transactions chez le courtier, rapprocher les positions et protections, puis résoudre manuellement l'état ambigu.

## 6. Pourquoi l'API web reste bloquée

L'endpoint `/api/live/order` reste bloqué par HTTP 503. Les adaptateurs et tests constituent l'intégration technique initiale, mais le moteur web ne possède pas encore de rapprochement complet et persistant de l'équité réelle, de la marge, des positions, des fills partiels, des ordres annulés, des protections modifiées, des pertes journalières et du kill switch pour chaque courtier. Autoriser les ordres via l'interface sans ces contrôles serait dangereux.

Avant déverrouillage : connecter le gestionnaire de risque à l'état courtier, imposer une liste d'instruments autorisés, gérer l'idempotence et les états d'ordre, vérifier les SL / TP après chaque fill, gérer les reconnexions et le kill switch, effectuer des tests démo / testnet prolongés et commander un audit indépendant.

## 7. Tests et état

Les tests automatiques locaux utilisent des faux courtiers et ne communiquent pas avec un serveur MT5 ni avec un testnet crypto. Dans l'environnement de génération, **13 tests des adaptateurs et du moteur de backtest ont passé**. Cela ne signifie pas que les tests complets de l'application passent : certaines dépendances n'étaient pas installées dans cet environnement. Installer `requirements.txt` puis lancer `PYTHONPATH=. pytest -q` dans un environnement propre.

## 8. Statut de conformité

Ce projet **n'est pas audité, certifié ni prêt pour le trading réel**. L'implémentation peut contenir des défauts, les ordres peuvent subir du slippage ou des gaps, et les stops ne garantissent pas le prix d'exécution. Aucun backtest ne garantit de gains. Une revue indépendante du code, de la sécurité, des données et des opérations est requise.

## 9. Références techniques

- MetaTrader 5 Python — `order_send` : https://www.mql5.com/en/docs/python_metatrader5/mt5ordersend_py
- MetaTrader 5 Python — `positions_get` : https://www.mql5.com/en/docs/python_metatrader5/mt5positionsget_py
- Manuel CCXT — ordres stop, take-profit et protections attachées : https://docs.ccxt.com/fr/docs/manual
