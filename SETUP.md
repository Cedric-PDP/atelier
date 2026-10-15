# Le classeur : mise en ligne

Le site de suivi de collection WikiMasters, pour toi et tes amis. Il est hébergé gratuitement par **Cloudflare**
(un **Worker**, à partir du dossier [`site/`](site/) de la branche `wikimasters`), avec une petite base de données
**D1** (gratuite aussi). Tout se fait dans le navigateur, une seule fois, en 10 minutes environ. Ensuite, Claude met
le site à jour en poussant sur la branche : Cloudflare republie tout seul.

Dans ce guide, `classeur-wm` est le nom du Worker. Si tu en choisis un autre, il doit être **le même** que la
ligne `"name"` de [`site/wrangler.jsonc`](site/wrangler.jsonc) (dis-le à Claude). L'adresse du site sera
`https://classeur-wm.<ton-sous-domaine>.workers.dev`.

**Le site est fermé aux inconnus** : on ne peut créer un classeur qu'avec le **code d'invitation** que tu choisis à
l'étape 4 et que tu donnes à tes amis. Chaque personne reçoit ensuite un **lien personnel** : c'est la clé de son
classeur, sans mot de passe.

## 1. Créer la base de données

1. Connecte-toi à [dash.cloudflare.com](https://dash.cloudflare.com) (le compte de ton site SPAM convient).
2. Menu **Storage & Databases** (ou **Workers & Pages**), **D1 SQL Database**, **Create database**.
3. Nom : `classeur`. Laisse le reste par défaut, **Create**. Les tables se créent toutes seules au premier usage.

## 2. Donner l'identifiant de la base

Sur la page de la base `classeur` (**Storage & Databases**, **D1**), copie son **Database ID** (une suite comme
`3f2b9c1e-…`) et donne-le à Claude : il l'écrit dans [`site/wrangler.jsonc`](site/wrangler.jsonc) et pousse. Ce n'est
pas un secret. (Ou modifie toi-même la ligne `database_id` de ce fichier sur GitHub.)

## 3. Créer le Worker relié au dépôt

1. **Workers & Pages**, **Create application**, **Import a repository** (ou **Connect to Git**).
2. Choisis **GitHub**, puis le dépôt **spam-atelier** (Cloudflare y a déjà accès depuis ton site SPAM ; sinon, ajoute
   le dépôt à l'application **Cloudflare Workers and Pages** sur GitHub, en *Only select repositories*).
3. Remplis :
   - **Project name** (nom du Worker) : `classeur-wm` ;
   - **Build command** : laisse vide ;
   - **Deploy command** : `npx wrangler deploy` ;
   - **Advanced settings**, **Path** (ou **Root directory**) : `site` (c'est là que sont `wrangler.jsonc` et les
     pages ; sans ce réglage, Cloudflare cherche à la racine du dépôt et répond « Could not detect a directory
     containing static files »).
4. **Create and deploy**.

**Si le Worker existe déjà** (créé sans le bon dossier) : ouvre-le, **Settings**, **Build**, et corrige :
**Root directory** (ou **Path**) `site`, **Build command** vide, **Deploy command** `npx wrangler deploy`,
**Branch control**, branche de production `wikimasters`. Puis **Deployments**, **Retry** sur le dernier
déploiement (ou attends le prochain envoi de Claude).

## 4. Branches et réglages

Dans le Worker `classeur-wm`, **Settings** :

1. **Build**, **Branch control** : branche de production `wikimasters` ; **décoche** les déploiements des autres
   branches (*non-production branch builds*) : le dépôt contient aussi tes branches SPAM.
2. **Variables and Secrets**, **Add** :

| Nom | Type | Valeur |
|---|---|---|
| `COOKIE_SECRET` | **Secret** | une longue suite aléatoire (ci-dessous) : elle chiffre les cookies WikiMasters gardés par le serveur |
| `SIGNUP_CODE` | **Secret** | le code d'invitation que tu donneras à tes amis : **long et aléatoire** (fabrique-le comme `COOKIE_SECRET` ci-dessous, ou prends 4 ou 5 mots au hasard), pas un mot qu'on devine |
| `MAX_USERS` | Text | facultatif : nombre maximal de classeurs (50 par défaut) |

La base `DB` n'est **pas** à ajouter ici : elle est déclarée dans `site/wrangler.jsonc` (étape 2).

Pour fabriquer `COOKIE_SECRET` sans rien installer : dans un nouvel onglet, **F12**, onglet **Console**, colle cette
ligne puis Entrée (si le navigateur refuse de coller, tape d'abord la phrase d'autorisation qu'il demande), et copie
le résultat :

```js
[...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('')
```

**Ne change plus `COOKIE_SECRET` ensuite** : les cookies déjà gardés deviendraient illisibles (il suffirait de les
recoller). Pour fermer les inscriptions, vide `SIGNUP_CODE`. Les secrets s'appliquent tout de suite, sans
redéployer.

**Projet Pages plutôt que Worker ?** Ça marche aussi : dossier racine `site`, commande de build `exit 0`, dossier de
sortie `public`, et la base liée dans les réglages sous le nom `DB` (le fichier `wrangler.jsonc` est alors ignoré).

## 5. Créer ton classeur

1. Ouvre l'adresse du Worker (`https://classeur-wm.<ton-sous-domaine>.workers.dev`, affichée sur sa page),
   **Créer mon classeur**, entre le code d'invitation.
2. **Garde ton lien personnel** (ajoute-le à tes favoris) : il ouvre ton classeur sur n'importe quel appareil.
   Quiconque l'a peut voir et modifier ton classeur : ne le partage pas.
3. Installe ton **favori « Rafraîchir »** (le site t'explique comment) : sur wiki-masters.com, connecté, un clic
   envoie ta collection au classeur. Tu peux aussi coller ton cookie WikiMasters pour rafraîchir depuis le classeur.

Pour tes amis : donne-leur l'adresse du site et le code d'invitation. Chacun crée son propre classeur.

## À savoir

- Le classeur ne fait que **lire** ta collection (les mêmes requêtes que la page Collection du jeu) ; il n'écrit
  jamais dans le jeu. Les règles de WikiMasters interdisent les outils qui jouent ou interagissent à ta place : lire
  sa propre collection en est la forme la plus légère, mais le jeu ne l'autorise pas noir sur blanc.
- **Préfère le favori au cookie collé.** Le jeu renouvelle ta session régulièrement : le rafraîchissement par
  cookie marche en général environ une heure après le collage, et peut te déconnecter du jeu dans ton navigateur.
  Le favori lit ta collection dans ton propre onglet et n'a pas ce problème.
- Un cookie collé reste chiffré sur le serveur ; **Oublier ma session** (dans le classeur) l'efface. Une session
  WikiMasters expire au bout d'un moment : le classeur te demandera d'en coller une nouvelle.
- Quotas gratuits de Cloudflare (D1 : 5 millions de lectures et 100 000 écritures par jour ; Functions : 100 000
  requêtes par jour, **partagées avec ton site SPAM**) : largement assez pour une bande d'amis. Le classeur plafonne
  ce que chaque compte peut stocker. Pour te protéger d'un inconnu qui martèlerait le site, tu peux ajouter une règle
  de limitation de débit : **Security**, **WAF**, **Rate limiting rules**, chemin commençant par `/api/`, 60 requêtes
  par minute et par IP (facultatif).
- **Ton lien personnel** reste dans l'historique du navigateur : sur un ordinateur partagé, efface-le, ou utilise
  **Changer ma clé** dans les réglages du classeur. Ton favori n'a qu'une clé d'import (il ne peut qu'envoyer des
  cartes) : **Régénérer le favori** l'invalide si besoin.
