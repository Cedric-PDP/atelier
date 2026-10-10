# Ton site SPAM : installation

Un site qui réunit tous tes outils SPAM : **Accueil**, **Atelier** de decks, **Journal** de parties (en lecture
seule), **Nouvelles** (les messages de Claude) et **Envoyer** (comment envoyer tes replays). Il est hébergé
gratuitement par **Cloudflare Pages**, à partir du dossier [`interface/`](interface/) de cette branche, et il est
**privé** : seul ton compte GitHub peut l'ouvrir.

Tout se fait dans le navigateur, rien à installer. Compte environ 20 minutes, une seule fois. Ensuite, Claude met le
site à jour tout seul : tu n'as plus qu'à l'ouvrir.

**Le site reste fermé pendant toute l'installation.** Tant que ses 4 réglages ne sont pas posés (étape 3), il
répond « Site pas encore configuré » à tout le monde, toi compris. C'est normal.

Dans ce guide, `spam-perso` est le nom du projet. Choisis le tien (lettres minuscules, chiffres et tirets) et
remplace-le partout : l'adresse de ton site sera `https://spam-perso.pages.dev`.

## 1. Créer l'application de connexion sur GitHub

C'est elle qui affiche « Se connecter avec GitHub » sur ton site.

1. Connecté à GitHub, ouvre [github.com/settings/applications/new](https://github.com/settings/applications/new)
   (ou : ta photo en haut à droite, **Settings**, **Developer settings**, **OAuth Apps**, **New OAuth App**).
2. Remplis :
   - **Application name** : `SPAM perso` ;
   - **Homepage URL** : `https://spam-perso.pages.dev` ;
   - **Authorization callback URL** : `https://spam-perso.pages.dev/auth/callback` ;
   - laisse **Enable Device Flow** décoché.
3. Clique sur **Register application**.
4. Sur la page de l'application :
   - note le **Client ID** (une suite de lettres et de chiffres) ;
   - clique sur **Generate a new client secret**, et copie tout de suite le secret dans un bloc-notes : GitHub ne
     le montre qu'une fois. **Ne le mets nulle part ailleurs** (ni dans un fichier du dépôt, ni dans un message).
   - Si GitHub propose une option de correspondance générique (*wildcard*) pour l'URL de rappel, laisse-la
     **désactivée**.

Ton numéro de compte GitHub (pas ton nom) : ouvre [api.github.com/users/Cedric-PDP](https://api.github.com/users/Cedric-PDP)
et lis la ligne `"id"`. Ce doit être `171561900`.

## 2. Créer le projet Cloudflare Pages

1. Crée un compte sur [dash.cloudflare.com](https://dash.cloudflare.com/sign-up) (le plan gratuit, *Free*, suffit),
   ou connecte-toi.
2. Menu **Workers & Pages**, puis **Create application**, onglet **Pages**, **Import an existing Git repository**
   (ou **Connect to Git**).
3. Choisis **GitHub**. GitHub te demande d'installer l'application **Cloudflare Workers and Pages** : choisis
   **Only select repositories**, puis le dépôt **spam-atelier**, et valide. Elle lit le dépôt pour publier le site.
4. Sélectionne **spam-atelier**, puis **Begin setup**, et remplis :
   - **Project name** : `spam-perso` (ton nom de projet) ;
   - **Production branch** : `pc-perso` ;
   - **Framework preset** : `None` ;
   - **Build command** : `exit 0` (une commande qui ne fait rien : Cloudflare la recommande pour que la partie
     « connexion » du site soit prise en compte) ;
   - **Build output directory** : laisse vide (si Cloudflare refuse un champ vide, mets `/`) ;
   - **Root directory (advanced)** : `interface`.
5. Clique sur **Save and Deploy**. Au bout d'une minute, Cloudflare donne l'adresse du site.
   - **Vérifie qu'elle est exactement `https://spam-perso.pages.dev`.** Si Cloudflare a ajouté quelque chose au nom
     (nom déjà pris), retourne dans ton application GitHub (étape 1) et corrige **Homepage URL** et
     **Authorization callback URL** avec la vraie adresse, puis **Update application**.
   - Ouvre l'adresse : tu dois voir « **Site pas encore configuré** ». C'est la preuve que le site est fermé.

## 3. Poser les 4 réglages

Dans Cloudflare : **Workers & Pages**, ton projet, **Settings**, **Variables and Secrets**, **Add**. Ajoute les 4,
pour l'environnement **Production** :

| Nom | Type | Valeur |
|---|---|---|
| `GITHUB_CLIENT_ID` | Text | le Client ID de l'étape 1 |
| `GITHUB_CLIENT_SECRET` | **Secret** | le client secret de l'étape 1 |
| `SESSION_SECRET` | **Secret** | une longue suite aléatoire (ci-dessous) |
| `ALLOWED_GITHUB_ID` | Text | `171561900` |

Écris les noms exactement comme ci-dessus (majuscules et `_`), sans espace.

Pour fabriquer `SESSION_SECRET` sans rien installer :

1. Dans ton navigateur, ouvre un nouvel onglet et appuie sur **F12**, puis clique sur l'onglet **Console**.
2. Colle cette ligne et appuie sur Entrée. Si le navigateur refuse de coller, il te demande de taper d'abord une
   phrase d'autorisation (« allow pasting » ou « autoriser le collage ») : tape-la, puis recolle.

   ```js
   Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
   ```

3. La console affiche 64 caractères entre guillemets : copie-les **sans les guillemets**, colle-les comme valeur de
   `SESSION_SECRET`, puis ferme l'onglet. Tu n'as pas besoin de la garder ailleurs.

Clique sur **Save** après chaque réglage.

## 4. Fermer les aperçus et la porte de secours

Deux réglages de Cloudflare, pour que rien ne soit servi sans la connexion :

1. **Settings**, **Builds** (ou **Builds & deployments**), **Branch control** : pour les aperçus (**Preview
   branch** / **Configure Preview deployments**), choisis **None**. Sinon chaque envoi sur une autre branche
   (`main`) créerait une copie du site.
2. **Settings**, **Runtime**, **Fail open / closed** : choisis **Fail closed**. Si un jour le quota gratuit
   quotidien de Cloudflare était épuisé, le site afficherait une erreur au lieu de s'ouvrir sans connexion.

## 5. Relancer un déploiement

Les réglages ne comptent qu'à partir du déploiement suivant. **Deployments**, puis sur le dernier déploiement de
production, le menu **⋯**, **Retry deployment**. Attends qu'il soit vert (*Success*).

## 6. Tester

1. Ouvre `https://spam-perso.pages.dev` : la page **Connexion** s'affiche. Clique sur **Se connecter avec GitHub**.
   La première fois, GitHub demande d'autoriser **SPAM perso** (elle ne lit que ton profil public) : **Authorize**.
2. Tu arrives sur l'**Accueil** de ton site. Essaie la barre du haut : Atelier, Journal, Nouvelles, Envoyer.
3. Ouvre une **fenêtre privée** (dans Edge : Ctrl+Maj+N), sans te connecter à GitHub, et colle
   `https://spam-perso.pages.dev/journal-spam.html` : tu dois voir la page **Connexion**, jamais le Journal.
4. Dans la fenêtre normale, **Se déconnecter** (en haut à droite) te ramène à la page Connexion.

Si l'étape 3 montre le Journal : ne va pas plus loin, et dis-le à Claude.

## Ensuite

- **La connexion dure 30 jours** par navigateur. Ajoute le site à tes favoris.
- **Mises à jour** : Claude reconstruit le site et le pousse sur cette branche après chaque envoi de replays, chaque
  nouvelle réponse et chaque mise à jour de l'Atelier. Cloudflare le republie tout seul en une minute ou deux.
- **Tes decks de l'Atelier** restent dans le navigateur où tu les enregistres, comme avec le fichier téléchargé.
  Ceux que tu avais enregistrés dans l'ancien fichier `atelier-spam.html` ouvert depuis ton disque n'apparaissent
  pas sur le site (ce sont deux adresses différentes pour le navigateur) : réenregistre ceux qui comptent.
- **Déconnecter tous tes appareils** : change la valeur de `SESSION_SECRET` (étape 3), puis relance un déploiement
  (étape 5).
- **Ce qui est protégé** : toutes les pages et tous les fichiers du site passent par le contrôle de connexion (le
  fichier `interface/functions/_middleware.js`). Il n'accepte qu'un compte GitHub, reconnu par son numéro, et ne
  garde aucun accès à ton compte : il lit seulement ton numéro au moment de la connexion. Le dépôt GitHub, lui,
  reste privé comme avant.
