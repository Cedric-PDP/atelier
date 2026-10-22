# Le classeur : mise en ligne

Le site de suivi de collection WikiMasters, pour toi et tes amis. Il est hébergé par **Cloudflare**
(un **Worker**, à partir du dossier [`site/`](site/) de la branche `wikimasters`), avec une petite base de données
**D1**. Tout se fait dans le navigateur, une seule fois, en 10 minutes environ. Ensuite, Claude met
le site à jour en poussant sur la branche : Cloudflare republie tout seul.

**Abonnement Workers payant** : depuis le 2026-10-22, le classeur lit lui-même la collection et le marché des membres dans la base du
jeu, toutes les 10 et 20 minutes (« Cron Triggers » du Worker, voir l'étape 6). Une passe dépasse les 10 ms de CPU du plan gratuit, et les cotes
écrivent beaucoup dans D1 : le site tourne sur l'abonnement payant des Workers (depuis le 2026-10-17). Sur le plan
gratuit, le site marcherait seulement au clic.

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
   - **Advanced settings**, **Path** (ou **Root directory**) : `site`, ou laisse vide : la branche a une
     configuration `wrangler.jsonc` à sa racine **et** dans `site/`, les deux marchent. (Sans aucune configuration,
     Cloudflare répondait « Could not detect a directory containing static files ».)
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
| `COOKIE_SECRET` | **Secret** | une longue suite aléatoire (ci-dessous) : elle chiffre les sessions du jeu gardées par le serveur |
| `SIGNUP_CODE` | **Secret** | le code d'invitation que tu donneras à tes amis : **long et aléatoire** (fabrique-le comme `COOKIE_SECRET` ci-dessous, ou prends 4 ou 5 mots au hasard), pas un mot qu'on devine |
| `MAX_USERS` | Text | facultatif : nombre maximal de classeurs (50 par défaut) |
| `SYNC_PAUSED` | Text | facultatif : `1` suspend **toutes** les lectures automatiques (voir l'étape 6) ; à retirer ou à vider pour les relancer |

La base `DB` n'est **pas** à ajouter ici : elle est déclarée dans `site/wrangler.jsonc` (étape 2).

Pour fabriquer `COOKIE_SECRET` sans rien installer : dans un nouvel onglet, **F12**, onglet **Console**, colle cette
ligne puis Entrée (si le navigateur refuse de coller, tape d'abord la phrase d'autorisation qu'il demande), et copie
le résultat :

```js
[...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('')
```

**Ne change plus `COOKIE_SECRET` ensuite** : les sessions du jeu déjà gardées deviendraient illisibles (chaque membre devrait
relier à nouveau son compte). Pour fermer les inscriptions, vide `SIGNUP_CODE`. Les secrets s'appliquent tout de suite, sans
redéployer.

**Projet Pages plutôt que Worker ?** Ça marche aussi : dossier racine `site`, commande de build `exit 0`, dossier de
sortie `public`, et la base liée dans les réglages sous le nom `DB` (le fichier `wrangler.jsonc` est alors ignoré). **Sans lectures
automatiques** : un projet Pages n'a pas de Cron Triggers, la collection et les cotes ne se lisent qu'au clic.

## 5. Créer ton classeur

1. Ouvre l'adresse du Worker (`https://classeur-wm.<ton-sous-domaine>.workers.dev`, affichée sur sa page),
   **Créer mon classeur**, entre le code d'invitation.
2. **Garde ton lien personnel** (ajoute-le à tes signets) : il ouvre ton classeur sur n'importe quel appareil.
   Quiconque l'a peut voir et modifier ton classeur : ne le partage pas.
3. **Relie ton compte du jeu** (onglet « Synchro », « Relier mon compte »), une seule fois : le site te fait un favori « Relier »
   à cliquer sur wiki-masters.com **dans une fenêtre privée** où tu es connecté (le site t'explique les étapes ; tu fermes ensuite la
   fenêtre privée **sans te déconnecter**). Ensuite, le classeur lit ta collection et le marché tout seul, sur n'importe quel appareil.

Pour tes amis : donne-leur l'adresse du site et le code d'invitation. Chacun crée son propre classeur, puis relie son propre compte du jeu.

## 6. Lectures automatiques (Cron Triggers)

Le classeur lit la base du jeu sans que personne clique : la **collection toutes les 10 minutes** (relue en entier si elle a changé, et au
moins toutes les 6 heures), le **marché toutes les 20 minutes**. Ces déclencheurs sont déclarés dans `site/wrangler.jsonc` (`triggers.crons` :
`*/10 * * * *` et `5-59/20 * * * *`, et la même ligne dans `wrangler.jsonc` à la racine) : **ils se déploient avec `wrangler deploy`**,
rien à créer à la main.

- **Vérifier après un push** : dans le tableau de bord, le Worker `classeur-wm`, **Settings** (ou **Triggers**), **Cron Triggers** : les deux
  expressions doivent y figurer. Puis ouvre `https://classeur-wm.<ton-sous-domaine>.workers.dev/api/health` : `cron.collection.last_at` et
  `cron.market.last_at` avancent (au plus 10 et 20 minutes après), `last_result` dit ce que la dernière passe a fait, et `sync_paused` vaut `false`.
  Tant qu'aucun membre n'a relié son compte, une passe lit « 0 membre vérifié ».
- **Si le jeu limite les lectures** (un membre voit « Le jeu limite les lectures automatiques » ; `last_result` « limite du jeu (…) ») : le classeur
  arrête de lui-même la passe et saute la suivante (15 minutes pour la collection, 25 pour le marché). Si ça continue : **pose `SYNC_PAUSED` à `1`**
  (**Settings**, **Variables and Secrets**, **Add**, type **Text** ; elle survit aux déploiements, `keep_vars`), attends, puis retire-la. Les
  boutons « Rafraîchir » et « Mettre à jour les cotes » restent utilisables. Chaque membre peut aussi décocher « Synchro automatique » dans
  l'onglet « Synchro ».
- **Un membre dont la synchro est en pause** (trois échecs d'affilée) ou « à relier » (session fermée par le jeu : une déconnexion du jeu, sur
  n'importe quel appareil, la ferme aussi) le voit dans « Synchro » ; « Rafraîchir » ou une nouvelle liaison le relance. Il n'y a rien à faire
  côté Cloudflare.
- **À surveiller** : les journaux du Worker (observabilité activée) pour les erreurs d'une passe, et, quand le nombre de membres augmente, la limite
  de sous-requêtes d'une invocation (le code ne la mesure pas).
- **En local** : `node dev/cron.mjs collection` (ou `market`) lance une passe à la main contre la base locale ; `node dev/server.mjs --cron` les fait tourner
  toutes les 10 et 20 minutes ; `FAUX_JEU=1` simule la base du jeu.

## À savoir

- Le classeur ne fait que **lire** (ta collection, tes mises et ventes, les cotes du marché) dans la base du jeu ; il n'écrit jamais dans le
  jeu. Les règles de WikiMasters interdisent les outils qui jouent ou interagissent à ta place : lire sa propre collection en est la forme la plus
  légère, mais **le jeu ne l'autorise pas noir sur blanc**, et lire **sans clic**, à heures régulières, depuis des adresses Cloudflare, est plus
  visible qu'avant le 2026-10-22 (voir [`site/SPEC.md`](site/SPEC.md), « Règles du jeu »). Le jeu pourrait fermer une session, voire sanctionner
  un compte : c'est un choix assumé, avec ses garde-fous (étape 6).
- **Fenêtre privée obligatoire pour relier** : le jeu renouvelle sa session par rotation, et une session partagée entre ton navigateur et le classeur
  se ferme des deux côtés. La session du classeur est celle de la fenêtre privée, que personne d'autre n'utilise ; elle est **chiffrée sur le
  serveur** (`COOKIE_SECRET`) et jamais renvoyée au navigateur. **Oublier la liaison** (dans « Synchro ») l'efface, sans te déconnecter du jeu.
- Le premier jour, **tout le monde est « à relier »** (les anciens cookies collés et clés d'import ont été effacés par le déploiement) : prévenir
  les membres, l'annonce du chat le dit.
- Quotas de Cloudflare (D1 : 50 millions de lignes écrites par mois comprises dans l'abonnement payant ; Functions : requêtes **partagées avec ton
  site SPAM**) : largement assez pour une bande d'amis. Le classeur plafonne ce que chaque compte peut stocker et le nombre de cotes lues par jour
  (15 000 par classeur, 150 000 pour tout le site). Pour te protéger d'un inconnu qui martèlerait le site, tu peux ajouter une règle de limitation
  de débit : **Security**, **WAF**, **Rate limiting rules**, chemin commençant par `/api/`, 60 requêtes par minute et par IP (facultatif).
- **Ton lien personnel** reste dans l'historique du navigateur : sur un ordinateur partagé, efface-le, ou utilise **Changer ma clé** dans les
  réglages du classeur. Le favori « Relier » n'a qu'un jeton de 30 minutes à usage unique (il ne peut que déposer une session) : un favori qui
  fuit ne sert plus à rien ensuite.
