# Utilisation depuis un téléphone uniquement

Guide pour exploiter Carnet de Trading **sans ordinateur** : ce qui fonctionne
immédiatement, comment installer l'application sur l'écran d'accueil, comment
recevoir les alertes sur le téléphone, et ce qui reste impossible sans une
machine Windows — avec les solutions possibles.

---

## 1. Ce qui fonctionne dès maintenant, depuis le téléphone

| Fonction | État | Accès |
|---|---|---|
| Tableau de bord, marché, graphiques | ✅ | onglet **Marché** |
| Positions, ordres, historique | ✅ | onglets dédiés |
| Stratégies (activation, backtests) | ✅ | onglet **Stratégies** |
| Politique de risque (jeton propriétaire) | ✅ | **Risque** |
| Journal, diagnostics, vérification de chaîne | ✅ | **Journal** / **Diagnostics** |
| Arrêt d'urgence, liquidation | ✅ | en-tête |
| Sauvegardes (création, vérification) | ✅ | **Paramètres** |
| Canal d'alerte (Slack/Discord/Teams/webhook) | ✅ | **Paramètres → Canal d'alerte** |
| Simulation (marché synthétique déterministe) | ✅ | permanente |
| **Pont MT5** (terminal MetaTrader 5) | ❌ | nécessite un PC Windows (voir §4) |

L'interface est responsive : menu ☰ en haut à gauche, formulaires empilés, tableaux
défilants horizontalement.

---

## 2. Installer l'application sur l'écran d'accueil

### Android (Chrome)

1. ouvrir l'adresse du service (HTTPS) ;
2. menu ⋮ → **Ajouter à l'écran d'accueil** / **Installer l'application** ;
3. l'icône « Carnet » apparaît ; l'ouverture se fait en plein écran.

### iPhone (Safari)

1. ouvrir l'adresse dans **Safari** (pas Chrome) ;
2. bouton **Partager** → **Sur l'écran d'accueil** → **Ajouter** ;
3. iOS utilise l'icône dédiée `apple-touch-icon.png`.

Le service worker met en cache la coquille (HTML/CSS/JS) pour un démarrage rapide.
**Aucune donnée de trading n'est mise en cache** : sans réseau, l'application
affiche l'interface mais pas l'état, et aucune action n'est possible.

---

## 3. Recevoir les alertes sur le téléphone

Le canal d'alerte sort par webhook ; le plus simple depuis un téléphone est
**Discord** (création d'un serveur et d'un webhook entièrement dans l'app mobile) :

1. app Discord → créer un serveur privé « Carnet » ;
2. **Paramètres du salon → Intégrations → Webhooks → Nouveau webhook** → copier l'URL ;
3. dans Carnet → **Paramètres → Canal d'alerte** : coller l'URL, format *Discord*,
   niveau **Critique**, cocher **Activer** → **Enregistrer** ;
4. **Envoyer un test** : le message doit apparaître dans Discord (notification push
   selon vos réglages).

Équivalents : Slack (webhook d'application), Microsoft Teams (connecteur de salon),
ou tout service acceptant un POST JSON. Alternative sans application : un service
comme ntfy/Healthchecks peut recevoir le webhook générique.

Rappels : 3 tentatives avec repli exponentiel ; l'URL est stockée en 0600 et n'est
jamais réaffichée en clair ; le compteur `failures` signale un webhook révoqué.

---

## 4. Le pont MT5 sans ordinateur : pourquoi c'est bloqué

Le paquet officiel `MetaTrader5` est une bibliothèque **Windows** qui pilote un
**terminal installé localement**. Un téléphone (Android/iOS) ne peut ni l'installer
ni l'exécuter, et le terminal web de Deriv n'expose aucune API locale. Le pont ne
peut donc pas être hébergé depuis un téléphone.

Trois options, par ordre de simplicité :

### Option A — rester en simulation (aucun coût, immédiat)

Toutes les fonctions de la V1 restent utilisables ; les alertes préviennent sur le
téléphone. C'est l'état actuel du service : `SIMULATION`, aucun ordre ne sort.

### Option B — louer un VPS Windows et l'administrer depuis le téléphone

C'est la voie recommandée si vous voulez le pont **sans posséder de PC** :

1. souscrire un VPS **Windows Server** (2 vCPU / 4 Go suffisent ; offres courantes
   entre ~10 et 25 €/mois selon le fournisseur) ;
2. installer l'application **Microsoft Remote Desktop** sur le téléphone (Android/iOS)
   et s'y connecter ;
3. dans le VPS : installer Deriv MT5, se connecter au compte **démo**
   (`32467355` / serveur `Deriv-Demo`), installer Python + `MetaTrader5`,
   puis exécuter `deploy\windows\install-agent.ps1` (voir `docs/DEPLOYMENT.md` §6) ;
4. relier le VPS Linux (qui héberge Carnet) au VPS Windows par un **tunnel SSH**
   inverse (`carnet-mt5-tunnel.service`, §6.2 du guide de déploiement) ;
5. dans Carnet : URL `http://127.0.0.1:8787`, jeton, **Tester** → **Enregistrer** →
   redémarrer le service.

Avantages : le pont tourne 24/7, indépendamment d'un PC personnel, et seuls deux
hôtes se parlent (SSH, jeton). Inconvénient : coût mensuel et administration via
un écran de téléphone (utilisable, mais fastidieux).

### Option C — attendre l'accès à un PC Windows

L'installation locale prend ~15 minutes et ne demande qu'un accès ponctuel :
terminal MT5 desktop + agent + tunnel. Rien d'autre n'est à refaire ensuite.

> Dans tous les cas, le mode **réel** reste verrouillé : seul un compte démo est
> accepté, et les ordres démo exigent une activation explicite.

---

## 5. Valeurs à préparer pour le jour J (Deriv)

| Champ Carnet | Valeur |
|---|---|
| URL de l'agent | `http://127.0.0.1:8787` (via tunnel) |
| Jeton du pont | celui généré par `install-agent.ps1` |
| Courtier / serveur | `Deriv` / `Deriv-Demo` |
| Login | `32467355` (compte démo) |
| Mot de passe | **jamais** dans Carnet : il ne sert qu'au terminal |
| Suffixe | vide chez Deriv |
| Correspondance | à relever via **Tester** (`symbols.available_sample`) |

Le bouton **Tester la connexion** liste les instruments reconnus, manquants et les
noms réellement proposés par le terminal : c'est cet écran qui donne la
correspondance exacte (`BTCUSDT=BTCUSD`, etc.). Ne mappez jamais un instrument vers
un actif différent.

---

## 6. Bonnes pratiques sur téléphone

- **Verrouillez l'écran** : une session ouverte donne accès aux commandes d'urgence.
- Activez la **MFA (TOTP)** depuis Paramètres ; conservez le secret hors du téléphone.
- Utilisez **HTTPS** (reverse proxy du kit de déploiement), jamais `http://` en clair.
- Évitez les réseaux Wi-Fi publics pour les actions sensibles (liquidation, politique).
- Révoquez les sessions inutilisées (Paramètres → Sessions actives) après un prêt
  d'appareil.
- Les sauvegardes se vérifient depuis l'interface ; la **restauration** reste une
  opération de service (à froid), pas une action mobile.

---

## 7. Limites connues

- Les graphiques sont allégés sur petit écran ; les tableaux larges défilent.
- La configuration MT5 (formulaire long, jetons) est utilisable mais plus confortable
  sur un grand écran.
- Aucun test end-to-end en navigateur réel n'est exécuté dans l'environnement de
  développement (voir `BLOCKERS.md` B7) ; l'interface est vérifiée par tests
  statiques (`tests/test_web_ui.py`) et par les parcours API.
