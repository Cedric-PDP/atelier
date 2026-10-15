# Le classeur : mise en ligne

Le site de suivi de collection WikiMasters, pour toi et tes amis. Il est hébergé gratuitement par **Cloudflare
Pages**, à partir du dossier [`site/`](site/) de la branche `wikimasters`, avec une petite base de données
**D1** (gratuite aussi). Tout se fait dans le navigateur, une seule fois, en 10 minutes environ. Ensuite, Claude met
le site à jour en poussant sur la branche : Cloudflare republie tout seul.

Dans ce guide, `classeur-wm` est le nom du projet. Choisis le tien (minuscules, chiffres et tirets) et remplace-le
partout : l'adresse du site sera `https://classeur-wm.pages.dev`.

**Le site est fermé aux inconnus** : on ne peut créer un classeur qu'avec le **code d'invitation** que tu choisis à
l'étape 4 et que tu donnes à tes amis. Chaque personne reçoit ensuite un **lien personnel** : c'est la clé de son
classeur, sans mot de passe.

## 1. Créer la base de données

1. Connecte-toi à [dash.cloudflare.com](https://dash.cloudflare.com) (le compte de ton site SPAM convient).
2. Menu **Storage & Databases** (ou **Workers & Pages**), **D1 SQL Database**, **Create database**.
3. Nom : `classeur`. Laisse le reste par défaut, **Create**. Les tables se créent toutes seules au premier usage.

## 2. Créer le projet Cloudflare Pages

1. **Workers & Pages**, **Create application**, onglet **Pages**, **Import an existing Git repository**.
2. Choisis **GitHub**, puis le dépôt **spam-atelier** (Cloudflare y a déjà accès depuis ton site SPAM ; sinon, ajoute
   le dépôt à l'application **Cloudflare Workers and Pages** sur GitHub, en *Only select repositories*).
3. **Begin setup**, et remplis :
   - **Project name** : `classeur-wm` ;
   - **Production branch** : `wikimasters` ;
   - **Framework preset** : `None` ;
   - **Build command** : `exit 0` ;
   - **Build output directory** : `public` (seules les pages publiques sont servies, jamais le code du serveur) ;
   - **Root directory (advanced)** : `site`.
4. **Save and Deploy**. Au bout d'une minute, Cloudflare donne l'adresse du site. À ce stade il répond
   « Le classeur n'est pas encore configuré » : c'est normal.

## 3. Désactiver les aperçus des autres branches

Le dépôt contient aussi tes branches SPAM. Pour qu'elles ne soient jamais publiées par ce projet : **Settings**,
**Builds** (ou **Builds & deployments**), **Branch control**, **Preview branch** : **None**, puis **Save**.

## 4. Brancher la base et poser les 2 réglages

Dans le projet `classeur-wm`, **Settings** :

1. **Bindings**, **Add**, **D1 database** : **Variable name** `DB`, **D1 database** `classeur`, **Save**.
2. **Variables and Secrets**, **Add**, pour l'environnement **Production** :

| Nom | Type | Valeur |
|---|---|---|
| `COOKIE_SECRET` | **Secret** | une longue suite aléatoire (ci-dessous) : elle chiffre les cookies WikiMasters gardés par le serveur |
| `SIGNUP_CODE` | **Secret** | le code d'invitation que tu donneras à tes amis (une phrase facile à dicter suffit) |

Pour fabriquer `COOKIE_SECRET` sans rien installer : dans un nouvel onglet, **F12**, onglet **Console**, colle cette
ligne puis Entrée (si le navigateur refuse de coller, tape d'abord la phrase d'autorisation qu'il demande), et copie
le résultat :

```js
[...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('')
```

**Ne change plus `COOKIE_SECRET` ensuite** : les cookies déjà gardés deviendraient illisibles (il suffirait de les
recoller). Pour fermer les inscriptions, vide `SIGNUP_CODE`.

3. Les réglages ne s'appliquent qu'au déploiement suivant : **Deployments**, sur la dernière ligne **⋯**, **Retry
   deployment**.

## 5. Créer ton classeur

1. Ouvre `https://classeur-wm.pages.dev`, **Créer mon classeur**, entre le code d'invitation.
2. **Garde ton lien personnel** (ajoute-le à tes favoris) : il ouvre ton classeur sur n'importe quel appareil.
   Quiconque l'a peut voir et modifier ton classeur : ne le partage pas.
3. Installe ton **favori « Rafraîchir »** (le site t'explique comment) : sur wiki-masters.com, connecté, un clic
   envoie ta collection au classeur. Tu peux aussi coller ton cookie WikiMasters pour rafraîchir depuis le classeur.

Pour tes amis : donne-leur l'adresse du site et le code d'invitation. Chacun crée son propre classeur.

## À savoir

- Le classeur ne fait que **lire** ta collection (les mêmes requêtes que la page Collection du jeu) ; il n'écrit
  jamais dans le jeu. Les règles de WikiMasters interdisent les outils qui jouent ou interagissent à ta place : lire
  sa propre collection en est la forme la plus légère, mais le jeu ne l'autorise pas noir sur blanc.
- Un cookie collé reste chiffré sur le serveur ; **Oublier ma session** (dans le classeur) l'efface. Une session
  WikiMasters expire au bout d'un moment : le classeur te demandera d'en coller une nouvelle.
- Quotas gratuits de Cloudflare (D1 : 5 millions de lectures et 100 000 écritures par jour) : largement assez pour
  une bande d'amis.
