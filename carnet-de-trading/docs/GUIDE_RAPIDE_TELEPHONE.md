# Guide rapide — 10 minutes sur le téléphone

Objectif : ouvrir l'application, recevoir une alerte sur votre téléphone, puis
laisser tourner et observer. Aucun ordinateur n'est nécessaire.

> Rappel : l'application tourne sur un **marché inventé** avec de l'**argent
> inventé**. Aucun ordre réel, aucun compte Deriv connecté, aucun risque financier.

---

## Étape 1 — Ouvrir l'application (2 min)

1. Dans cette conversation, ouvrez l'**aperçu du service « Carnet de Trading »**
   (bouton d'aperçu à côté du processus en cours). C'est l'adresse du site.
2. Connectez-vous :
   - identifiant : `admin`
   - mot de passe : `Carnet!Demo2026`
3. Vous devez voir le **Tableau de bord**, avec en haut :
   - un bandeau « **DONNÉES DE SIMULATION** » ;
   - le solde virtuel (environ **9 400 $**) ;
   - l'état du moteur : **RUNNING**.
4. Installez l'icône sur l'écran d'accueil :
   - **Android / Chrome** : menu ⋮ → « Ajouter à l'écran d'accueil » ou
     « Installer l'application » ;
   - **iPhone / Safari** : bouton Partager → « Sur l'écran d'accueil » → Ajouter.

**En cas de problème**

| Symptôme | Cause | Solution |
|---|---|---|
| Page blanche / erreur réseau | aperçu fermé ou service arrêté | rouvrir l'aperçu du processus |
| « Identifiants invalides » | mot de passe modifié | utiliser le mot de passe changé, sinon recréer un compte via la console |
| Bandeau « SIMULATION » absent | mauvaise adresse | vérifier l'URL d'aperçu |

---

## Étape 2 — Recevoir les alertes sur le téléphone (5 min)

Le plus simple depuis un téléphone : **Discord** (tout se fait dans l'application).

### 2.1 Créer le canal de réception

1. installer **Discord** sur le téléphone et créer un compte si besoin ;
2. créer un serveur privé (icône **+** → « Créer un serveur » → « Pour moi et mes amis ») ;
3. dans ce serveur : **Paramètres du salon** (⚙ à côté du nom du salon) →
   **Intégrations** → **Webhooks** → **Nouveau webhook** ;
4. nommer le webhook « Carnet », choisir le salon, puis **Copier l'URL du webhook**.
   Elle ressemble à `https://discord.com/api/webhooks/123456/abcdef`.

### 2.2 Brancher l'application

1. dans Carnet : menu **☰** → **Paramètres & sécurité** ;
2. carte **« Canal d'alerte »** :
   - **URL du webhook** : coller l'URL copiée ;
   - **Format** : *Détection automatique* (ou *Discord*) ;
   - **Niveau minimum** : *Critique* (recommandé pour commencer) ;
   - cocher **« Activer l'envoi des alertes »** ;
   - bouton **Enregistrer** ;
3. bouton **« Envoyer un test »** : un message « Test du canal d'alerte » doit
   apparaître dans Discord, avec une notification sur le téléphone ;
4. si le message n'arrive pas : l'URL est probablement incomplète (elle doit finir
   par une longue suite de caractères), ou le webhook a été supprimé.

### 2.3 Ce que vous recevrez

- **Critique** : arrêt d'urgence déclenché, limite de perte atteinte, réconciliation
  rompue (le robot et le courtier ne sont plus d'accord), position sans protection.
- **Avertissement** (si vous abaissez le niveau) : rejets d'ordres, pont indisponible,
  sauvegarde en échec.

Vous pouvez couper à tout moment avec le bouton **Désactiver** (les alertes restent
visibles dans l'application, cloche en haut à droite).

---

## Étape 3 — Laisser tourner 2 jours et observer (aucune action requise)

Le moteur tourne seul. Le marché simulé avance **300 fois plus vite** que la
réalité : en 2 jours réels, il se passe l'équivalent de plusieurs mois de marché.

### Ce qu'il faut regarder une fois par jour (3 minutes)

1. **Tableau de bord** : solde et équité virtuels, nombre de positions ouvertes,
   état du moteur (`RUNNING`).
2. **Positions** : chaque position a-t-elle un **stop** et un **objectif** ? (colonne
   « protégée »)
3. **Journal** : filtrer sur `WARNING` et `ERROR`. Les événements normaux sont
   `SIGNAL`, `ORDER`, `POSITION_OPEN`, `POSITION_CLOSE`, `RECONCILIATION_OK`.
4. **Risque** : les pourcentages de perte du jour et de la semaine restent-ils sous
   les limites (2 % / 5 %) ?
5. **Diagnostics** : réconciliation `OK`, 0 erreur, chaîne du journal intacte.

### Ce qui est normal

- le solde bouge (les stratégies perdent parfois) ;
- des positions s'ouvrent et se ferment seules, souvent par le stop ;
- des signaux sont rejetés par le risque : c'est le garde-fou qui fonctionne ;
- l'heure affichée avance vite (horloge accélérée).

### Ce qui doit vous alerter

- moteur `STOPPED` ou `SUSPENDED` sans raison ;
- réconciliation `BROKEN` ou `MISMATCH` ;
- position **sans** stop ;
- alerte critique reçue sur le téléphone ;
- pourcentage de perte proche des limites.

### Limite à connaître

Le service tourne dans l'environnement d'aperçu de cette conversation. S'il est
arrêté ou suspendu, la simulation s'arrête (les données restent enregistrées et
reprennent au redémarrage). Pour une exécution continue 24/7, il faut un
hébergement dédié — voir `docs/DEPLOYMENT.md` ou l'option « VPS Windows/cloud »
de `docs/PHONE_ONLY.md`.

---

## Étape 4 — Décider ensuite

Après 2 jours, trois options :

| Option | Coût | Ce que ça donne |
|---|---|---|
| **A. Rester en simulation** | 0 € | entraînement, stratégies, alertes — aucun risque |
| **B. Louer un PC Windows dans le cloud** | ~10–25 €/mois | l'app peut trader votre **démo Deriv**, piloté depuis le téléphone |
| **C. Un PC une heure** | 0 € | installation du pont MT5 démo, puis plus rien à refaire |

Le mode **réel** reste verrouillé dans tous les cas : seul un compte démo est
accepté, et les ordres démo exigent une activation explicite.
