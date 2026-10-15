# Le classeur — contrat entre l'interface et le serveur

Site multi-utilisateur (l'utilisateur et ses amis) pour suivre une collection WikiMasters (wiki-masters.com, cartes =
articles de Wikipédia FR) **hors du jeu** : étiquettes personnelles, collections à compléter. Inspiré de
wikimaster-one.vercel.app (« Le classeur »), réécrit avec notre propre code.

Hébergement : **Cloudflare Pages** (projet à part, branche `wikimasters`, dossier racine `site/`, dossier publié
`public` : seul `site/public/` est servi, jamais `functions/`, `schema.sql` ni ce fichier ; aucune commande de build) + **Pages Functions** (`site/functions/`) + **D1** (lié sous le nom `DB`). Variables d'environnement :
`COOKIE_SECRET` (chiffrement des cookies WikiMasters, AES-GCM), `SIGNUP_CODE` (code d'invitation ; vide = inscription
fermée). Développement local : `node dev/server.mjs` (sert `site/public/`, route `/api/*` vers les fonctions, D1 simulée
avec `node:sqlite`).

## Arborescence et propriétaires

| Chemin | Rôle | Écrit par |
|---|---|---|
| `site/public/index.html`, `site/public/assets/*` | l'interface (Vue 3 depuis cdnjs, pas de build) | agent interface |
| `site/public/catalog.json` | collections proposées (Wikidata), statique | Claude principal |
| `site/public/_headers` | en-têtes de sécurité (CSP) | agent interface |
| `site/functions/api/[[path]].js` + `site/functions/_lib/*` | l'API | agent serveur |
| `site/schema.sql` | schéma D1 (aussi appliqué automatiquement : `CREATE TABLE IF NOT EXISTS` au premier appel) | agent serveur |
| `dev/server.mjs`, `dev/d1.mjs`, `dev/*.test.mjs` | serveur local, D1 simulée, tests | agent serveur |

## Authentification

- Pas de mot de passe. À l'inscription, le serveur génère une **clé** (32 octets aléatoires, base64url) et ne garde
  que son SHA-256. Le client la garde dans `localStorage` (`classeur-key`) et l'envoie dans l'en-tête
  **`X-Classeur-Key`** sur toutes les requêtes (sauf `POST /api/account`).
- Lien personnel : `https://<site>/#cle=<clé>` ; à l'ouverture, l'interface range la clé dans `localStorage` et efface
  le fragment de l'adresse (`history.replaceState`).
- Clé absente ou inconnue → `401 {error}`.
- **Clé d'import** (facultative) : `POST /api/import` accepte la clé principale **ou** la clé d'import ; toutes les
  autres routes exigent la clé principale. Le favori n'embarque que la clé d'import : s'il fuit (il s'exécute dans
  la page du jeu), on ne peut qu'envoyer des cartes, et on la régénère.
- **Lien d'un autre classeur** : l'interface n'écrase jamais une clé gardée sans vérifier la nouvelle (`GET /api/me`)
  et demander confirmation.

## Format des erreurs

Toujours du JSON : `{ "error": "message en français, lisible tel quel" }` avec un statut 4xx/5xx. Champs en plus
possibles : `needs_session: true` (session WikiMasters absente ou expirée). Sans base liée (`env.DB` absent), toute
route sauf `/api/health` répond `503 {error:"Le classeur n'est pas encore configuré : …"}`.

## Carte (forme renvoyée par l'API)

```json
{
  "id": "1ec7770b-…",            // card.id du jeu (= card_id) : identifiant stable de la carte
  "title": "Rihanna",            // card.wikipedia_title
  "rarity": "L",                 // C | PC | R | SR | UR | L
  "atk": 10000, "def": 9044,
  "quality": 84.58,              // card.q_score
  "pageviews": 28785,            // card.pageviews (vues mensuelles relevées par le jeu)
  "category": "chanteuse barbadienne",  // card.category (description Wikidata), peut être null
  "image": "https://upload.wikimedia.org/…/330px-….png",  // card.image_url, null si absent ou hide_image
  "url": "https://fr.wikipedia.org/wiki/Rihanna",           // card.wikipedia_url
  "count": 1,                    // somme des count des exemplaires
  "shiny": false,                // au moins un exemplaire is_shiny
  "starred": false,              // au moins un exemplaire starred
  "obtained_at": "2026-10-14T16:24:39.011Z",  // plus ancien obtained_at des exemplaires
  "tags": ["Musique", "à échanger"]           // étiquettes de l'utilisateur dans le classeur (jamais celles du jeu)
}
```

**Entrée brute du jeu** (réponse `GET https://www.wiki-masters.com/api/my-collection?sort=rarity&page=N&stats=0`,
50 par page, champ `collection`) : `{id, card:{id, atk, def, lang, rarity, q_score, category, image_url, pageviews,
created_at, hide_image, wikipedia_url, wikipedia_title}, tags, count, card_id, starred, user_id, is_shiny,
obtained_at}`. Plusieurs entrées peuvent avoir le même `card_id` (exemplaires) : on les regroupe. Le `user_id` du jeu
n'est jamais stocké. `GET …/api/my-collection/stats?sort=rarity` → `{total, totalUnique, rarityCounts, tagOptions}`
sert à vérifier qu'un export est complet. La dernière page a moins de 50 entrées (ou 0).

## Points d'accès

| Méthode et chemin | Corps | Réponse |
|---|---|---|
| `GET /api/health` | (sans clé) | `{ok, db, cookie_secret, signup_open}` : présence des réglages, jamais leur valeur |
| `POST /api/account` | `{code, name?}` (`code` = `SIGNUP_CODE`) | `201 {key, user:{id, name}}` |
| `GET /api/me` | | `{user:{id, name, created_at}, fetched_at, card_count, new_ids, session:{has_cookie, expired, updated_at}}` |
| `PATCH /api/me` | `{name}` | `{user}` |
| `DELETE /api/me` | | `{ok:true}` : efface tout (cartes, étiquettes, collections, cookie) et le compte |
| `POST /api/import-key` | | `{import_key}` : clé réservée à `/api/import` (celle du favori) ; en crée une nouvelle, l'ancien favori cesse de marcher |
| `POST /api/key/rotate` | | `{key}` : nouvelle clé principale ; l'ancienne (et l'ancien lien) cesse de marcher |
| `GET /api/cards?part=X` | (`part` facultatif : `0` pour la première page, puis le curseur `next_part` renvoyé tel quel ; pages de 1 000 cartes) | `{fetched_at, cards:[Carte], new_ids:[id…], part, next_part}` (`next_part` : curseur opaque, `null` à la dernière page) ; sans `part` : tout d'un coup (à éviter au-delà de ~3 000 cartes : limite de calcul) |
| `POST /api/import` | **par morceaux** : `{upload_id, part, last, cards:[CarteImport], stats?, source}` (500 cartes au plus par morceau ; `collection:[entrées brutes]` reste accepté à la place de `cards`) | morceau intermédiaire : `{ok:true, received, skipped}` (cumulés ; morceaux dans l'ordre, sinon 409) ; dernier (`last:true`) : `{count, new_ids, complete, skipped}` (`complete` = `stats.totalUnique === count`, ou `null` sans stats) |
| `POST /api/session` | `{cookie}` **ou** `{har:{log:{entries:[{request:{url, headers:[{name,value}]}}]}}}` | `{ok:true}` ; extrait l'en-tête `Cookie` d'une requête vers `www.wiki-masters.com` (de préférence `/api/my-collection`), le chiffre et le garde |
| `DELETE /api/session` | | `{ok:true}` |
| `POST /api/refresh` | `{page?}` (0 au départ) | `{done:false, next_page, fetched, total, skipped}` puis, à la fin, `{done:true, count, new_ids, complete, skipped}` ; `401 {error, needs_session:true}` si pas de cookie ou session expirée |
| `POST /api/tags/set` | `{card_id, tags:[…]}` | `{tags}` |
| `POST /api/tags/bulk` | `{card_ids:[…], add:[…], remove:[…]}` | `{ok:true}` |
| `POST /api/tags/rename` | `{from, to}` (fusionne si `to` existe) | `{ok:true}` |
| `GET /api/targets` | | `{targets:[Collection]}` |
| `POST /api/targets/save` | `{id?, name, items, source?}` | `{target}` |
| `POST /api/targets/delete` | `{id}` | `{ok:true}` |

**Collection à compléter** : `{id, name, items:[{title, description, image, status}], source, created_at,
updated_at}`, `status` = `ok` | `missing` (article introuvable) | `disambiguation` (page d'homonymie). Les `items` sont
vérifiés **par l'interface** sur Wikipédia avant l'envoi ; le serveur ne fait que les ranger (au plus 3 000 éléments,
100 collections par utilisateur). `source` = `catalog:<id>` quand elle vient de `catalog.json`.

**CarteImport** (ce qu'envoie le favori, déjà regroupée par carte) : la Carte ci-dessus **sans `tags`**. Le favori
regroupe les exemplaires et ne garde que ces champs : le serveur n'a presque rien à calculer.

**Limite de calcul des Workers gratuits (10 ms de CPU par requête)** : aucune requête ne doit traiter plus de
~500 cartes en JavaScript. Les morceaux d'un import vont dans une table d'attente ; au dernier morceau, la
comparaison avec la collection en place (ajouts, retraits, modifications, `new_ids`) se fait **en SQL dans D1**
(`json_each`, `INSERT … SELECT`, `DELETE … WHERE NOT IN`), pas en JavaScript. Même règle pour `/api/refresh` :
10 pages au plus par appel.

**Import et nouveautés** : un import (favori ou rafraîchissement) remplace la collection ; on n'écrit que les
différences (cartes ajoutées, retirées, modifiées). `new_ids` = cartes présentes après mais pas avant ; **vide au
tout premier import**. Les étiquettes d'une carte qui disparaît sont gardées (elle peut revenir).

**Rafraîchissement par cookie** : `/api/refresh` lit au plus 10 pages par appel (limites de calcul et de sous-requêtes
des Workers gratuits), stocke les pages lues dans une table d'attente, et termine quand une page a moins de 50 entrées ; l'interface
rappelle avec `next_page` jusqu'à `done:true`. Redirections non suivies (une redirection = session expirée) ;
un 403 qui n'est pas du JSON = refus anti-robots, `502` sans expirer la session.

**Limite du cookie collé** : la session du jeu (Supabase) renouvelle son jeton. Si le serveur la renouvelle, le
navigateur du joueur garde l'ancien jeton : le jeu peut le déconnecter, et le rafraîchissement par cookie ne marche
en général qu'environ une heure après le collage. Le favori est donc le chemin principal ; le cookie est un secours. Pause de 250 ms entre deux pages. En-têtes envoyés au jeu : `Cookie`,
`Accept: application/json`, `User-Agent` d'un navigateur courant n'est PAS imité (on garde celui de la plateforme). Un
`Set-Cookie` dans une réponse du jeu met à jour le cookie stocké. 401/403 du jeu → session marquée expirée,
`401 {needs_session:true}`.

**CORS** : seul `POST /api/import` (et son `OPTIONS`) accepte les origines `https://www.wiki-masters.com` et
`https://wiki-masters.com`
(`Access-Control-Allow-Headers: content-type, x-classeur-key`). Le reste est même origine.

**Limites et quotas** (D1 gratuit : 500 Mo, 100 000 lignes écrites par jour, partagés par tous) : `MAX_USERS` comptes
(variable, 50 par défaut) ; 20 000 cartes par utilisateur ; étiquette = texte nettoyé, 40 caractères au plus, 30 par
carte, 50 000 par compte, 5 000 couples carte×étiquette par appel `tags/bulk` ; collections à compléter : 50 par
compte, 600 Ko chacune, 5 Mo au total ; import : 500 cartes et 40 morceaux par envoi, 8 Mo en attente ; corps JSON
de 5 Mo au plus (4 Ko pour `/api/account`). Entrées du jeu invalides (sans titre, rareté inconnue, champs trop
longs) : ignorées pareil par le favori et le rafraîchissement, comptées dans `skipped`. Quota ou base pleine : `503`
avec un message lisible.

## Le favori (bookmarklet)

Source commentée : `site/public/assets/bookmarklet.js` ; l'interface la met sur une ligne et y insère l'origine du site et
la clé de l'utilisateur. Sur `www.wiki-masters.com` (utilisateur connecté) : petit encart de progression, lecture de
`my-collection/stats` puis de toutes les pages `my-collection` (pause de 300 ms), regroupement des exemplaires en
**CarteImport**, envoi `POST <site>/api/import` **par morceaux de 500** (`upload_id`, `part`, `last`, `stats` au
premier), puis « 1 043 cartes envoyées au classeur, 12 nouvelles » et un lien vers le classeur. Ailleurs : « Ouvre
wiki-masters.com et connecte-toi ». 401 du jeu : « Connecte-toi à WikiMasters ».

## Règles du jeu

Les règles de WikiMasters interdisent les outils qui jouent ou **interagissent à la place du joueur**. Le classeur ne
fait que **lire** la collection (mêmes requêtes que la page « Collection » du site) : jamais d'écriture dans le jeu,
jamais d'étiquette posée dans le jeu, pas de rafraîchissement automatique en tâche de fond (toujours un geste de
l'utilisateur).
