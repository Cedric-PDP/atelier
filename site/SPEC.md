# Le classeur — contrat entre l'interface et le serveur

Site multi-utilisateur (l'utilisateur et ses amis) pour suivre une collection WikiMasters (wiki-masters.com, cartes =
articles de Wikipédia FR) **hors du jeu** : étiquettes personnelles, collections à compléter. Inspiré de
wikimaster-one.vercel.app (« Le classeur »), réécrit avec notre propre code.

Hébergement : **Worker Cloudflare** (Workers Builds, branche `wikimasters`, dossier racine `site/`, `npx wrangler
deploy` avec `site/wrangler.jsonc` et `site/worker.js`) ou, au choix, projet **Pages** (dossier publié `public`, Pages
Functions dans `site/functions/`). Dans les deux cas seul `site/public/` est servi, jamais `functions/`, `schema.sql` ni
ce fichier. Base **D1** liée sous le nom `DB`. Variables d'environnement :
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
- **Clé d'import** (facultative) : `POST /api/import` et `POST /api/targets/from-game` acceptent la clé principale
  **ou** la clé d'import ; toutes les autres routes exigent la clé principale. Le favori n'embarque que la clé
  d'import : s'il fuit (il s'exécute dans la page du jeu), on ne peut qu'envoyer des cartes (remplacer la liste des
  cartes du classeur, comme un import) et **créer** des collections à compléter, dans les quotas (50 collections,
  600 Ko chacune, 5 Mo en tout, 3 000 éléments) ; on ne peut rien lire (ni cartes, ni étiquettes, ni collections), ni
  modifier ou supprimer une collection existante, ni toucher au compte. On la régénère (l'ancien favori cesse de
  marcher) et on supprime les collections en trop.
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
  "rarity": "L",                 // C | PC | R | SR | UR | L : la plus haute des exemplaires (C < PC < R < SR < UR < L)
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

**Recherche de la Collection globale du jeu** (page `/global-collection`, lue par le favori seulement) :
`GET https://www.wiki-masters.com/api/cards?page=N&q=<texte>&sort=name` (`page` depuis 0 ; la page envoie aussi
`sort=rarity|name|atk|def`, un `rarity` par filtre, `wishlist=1`, que le favori ne reprend pas) →
`{cards:[…], total, searchHasMore, rarityCounts, ownedCardIds, wishlistCardIds, friendOwners, friendPendingOfferKeys}`,
50 cartes par page au plus ; chaque carte = la ligne `cards` du jeu, **à plat** : `{id, wikipedia_title, rarity,
category, image_url, hide_image, wikipedia_url, atk, def, q_score, pageviews…}` (`rarity` = rareté actuelle de la carte
dans le jeu) ; avec un texte, `total` vaut `null` et `rarityCounts` `{}` : seul `searchHasMore` dit s'il y a une page
de plus ; `pageCapped:true` au-delà des pages permises ; `limit` > 50 → `403 {code:'automation_limit'}`. **Format non
documenté par le jeu, pas vérifié par nous** : relevé dans `docs/api.md` d'un client tiers et dans le code d'extensions
tierces (cartes lues à plat, `wikipedia_title`, `rarity`, `searchHasMore`). Le favori le contrôle et s'arrête sur tout
autre format (voir « Le favori »).

## Points d'accès

| Méthode et chemin | Corps | Réponse |
|---|---|---|
| `GET /api/health` | (sans clé) | `{ok, db, cookie_secret, signup_open}` : présence des réglages, jamais leur valeur |
| `POST /api/account` | `{code, name?}` (`code` = `SIGNUP_CODE`) | `201 {key, user:{id, name}}` |
| `GET /api/me` | | `{user:{id, name, created_at}, fetched_at, card_count, next_full, cards_rev, new_ids, shared, session:{has_cookie, expired, updated_at}}` (`cards_rev` : révision de la liste des cartes, voir « Lecture incrémentale » ; `shared` : montre ses cartes aux autres membres, voir « Partage entre membres » ; `card_count` : tenu par les imports dans `sync_state`, sans relire les cartes ; `next_full` : la prochaine mise à jour relira toute la collection, voir « Synchro rapide ») |
| `PATCH /api/me` | `{name?, prefs?, shared?, force_full?}` (`prefs` : objet JSON ≤ 4 Ko, remplacé en entier : `hidden_catalog` = ids du catalogue retirés, `hide_catalog` = propositions masquées ; `shared` : booléen, sinon `400` ; `force_full: true` : la prochaine mise à jour relira toute la collection, autre valeur `400`) | `{user, prefs, shared}` ; `GET /api/me` renvoie aussi `prefs` (`{}` par défaut) |
| `DELETE /api/me` | | `{ok:true}` : efface tout (cartes, cartes retirées, étiquettes, collections, cookie) et le compte |
| `POST /api/import-key` | | `{import_key}` : clé réservée à `/api/import` (celle du favori) ; en crée une nouvelle, l'ancien favori cesse de marcher |
| `POST /api/key/rotate` | | `{key}` : nouvelle clé principale ; l'ancienne (et l'ancien lien) cesse de marcher |
| `GET /api/cards?part=X` | (`part` facultatif : `0` pour la première page, puis le curseur `next_part` renvoyé tel quel ; pages de 1 000 cartes) | `{rev, fetched_at, cards:[Carte], new_ids:[id…], part, next_part}` (`next_part` : curseur opaque, `null` à la dernière page ; `rev` : révision lue avant les cartes, garder celle de la page `0`) ; sans `part` : `{rev, fetched_at, cards, new_ids}`, tout d'un coup (à éviter au-delà de ~3 000 cartes : limite de calcul) |
| `GET /api/cards?since=R` | `R` : entier ≥ 0, la `rev` gardée (sinon `400`, et `400` avec `part`) | `{rev, delta:true, cards:[Carte], gone:[id…], fetched_at, new_ids}` : cartes changées (données ou étiquettes) et cartes retirées depuis `R` ; ou `{rev, delta:false}` : tout recharger (voir « Lecture incrémentale ») |
| `POST /api/import` | **par morceaux** : `{upload_id, part, last, cards:[CarteImport], stats?, last_at?, rows?, copies?, ignored?, source}` (500 cartes au plus par morceau ; `collection:[entrées brutes]` reste accepté à la place de `cards` ; `rows`, `copies`, `ignored` : entiers ≥ 0, sinon `400`, voir « Synchro rapide ») | morceau intermédiaire : `{ok:true, received, skipped}` (cumulés ; morceaux dans l'ordre, sinon 409) ; dernier (`last:true`) : `{count, new_ids, complete, skipped}` (`complete` = `count` + cartes invalides distinctes = `stats.totalUnique` : `false` = il manque des cartes que le classeur aurait pu ranger ; `null` sans stats) ; synchro rapide : `{mode:'state'}` → `{quick, last_at, full_at}`, `{mode:'delta', cards, stats, rows, copies, last_at}` → `{count, new_ids, complete, skipped:0, quick:true}` ou `{needs_full:true, reason}` (rien d'écrit ; `reason` : `state`, `too_many`, `invalid`, `counts`, `max_cards`, `race`) |
| `POST /api/session` | `{cookie}` **ou** `{har:{log:{entries:[{request:{url, headers:[{name,value}]}}]}}}` | `{ok:true}` ; extrait l'en-tête `Cookie` d'une requête vers `www.wiki-masters.com` (de préférence `/api/my-collection`), le chiffre et le garde |
| `DELETE /api/session` | | `{ok:true}` |
| `POST /api/refresh` | `{page?, full?}` (0 au départ ; `full:true` = jamais de synchro rapide ; l'interface l'envoie quand `next_full`) | `{done:false, next_page, fetched, total, skipped}` (`next_page` : première page pas encore lue) puis, à la fin, `{done:true, count, new_ids, complete, skipped}` (`quick:true` en plus si la synchro rapide a suffi) ; `401 {error, needs_session:true}` si pas de cookie ou session expirée ; `429 {error}` si le jeu limite les lectures automatiques |
| `POST /api/tags/set` | `{card_id, tags:[…]}` | `{tags}` |
| `POST /api/tags/bulk` | `{card_ids:[…], add:[…], remove:[…]}` | `{ok:true}` |
| `POST /api/tags/rename` | `{from, to}` (fusionne si `to` existe) | `{ok:true}` |
| `GET /api/targets` | | `{targets:[Collection]}` |
| `POST /api/targets/save` | `{id?, name, items, source?}` | `{target}` |
| `POST /api/targets/delete` | `{id}` | `{ok:true}` |
| `POST /api/targets/from-game` | (clé principale **ou clé d'import**, CORS du jeu ; celle du favori) `{name, query, items:[{title, rarity, card_id, category?, image?}]}` : `query` = la recherche faite dans la Collection globale du jeu (1 à 100 caractères), 1 à 3 000 cartes, `rarity` ∈ C, PC, R, SR, UR, L (sinon `400`), `card_id` = `card.id` du jeu (texte, sert à écarter une carte lue deux fois, pas gardé) | `{target:{id, name, source, count, created_at, updated_at}}` (sans les éléments) : crée **toujours** une nouvelle collection (un `id` envoyé est ignoré), `source` = `wm:<query>`, éléments `{title, description: category ou null, image, status:'ok', rarity}` (toutes les images retirées si elles font dépasser 600 Ko : la page retrouve les vignettes sur Wikipédia) ; mêmes validations et quotas que `targets/save` |
| `GET /api/members` | (il faut partager soi-même, sinon `403`) | `{members:[{id, name, count, fetched_at}]}` : les **autres** membres qui partagent ; `id` = identifiant public, `count` = nombre de cartes différentes, `fetched_at` = dernière synchro |
| `GET /api/members/<id>/cards?part=X` | (`part` comme pour `GET /api/cards`, absent = `0` ; `403` si l'appelant ne partage pas, `404` si ce membre n'existe pas ou ne partage pas, ou plus) | `{member:{id, name, fetched_at}, cards:[{id, title, rarity, count, shiny, image, url}], part, next_part}` : pages de 1 000 cartes, sans étiquettes |

**Collection à compléter** : `{id, name, items:[{title, description, image, status, qid?, rarity?}], source, created_at,
updated_at}` ; `qid` (facultatif, identifiant Wikidata `Q…`) permet de reconnaître une carte possédée même si son titre
diffère (renommage, redirection, homonymie) : l'interface rapproche d'abord par titre, puis par qid
(`site/public/assets/match.js`, qids des cartes résolus dans le navigateur et gardés en cache), `status` = `ok` | `missing` (article introuvable) | `disambiguation` (page d'homonymie). Les `items` sont
vérifiés **par l'interface** sur Wikipédia avant l'envoi ; le serveur ne fait que les ranger (au plus 3 000 éléments,
100 collections par utilisateur). `source` = `catalog:<id>` quand elle vient de `catalog.json`, `wp:<nom de la
catégorie>` quand elle vient d'une catégorie de Wikipédia proposée (`site/public/assets/propose.js` : catégories des cartes
de l'utilisateur dont il possède au moins 5 % et 2 cartes, hors catégories de rangement et de temps), `wd` ou `cat` quand
elle vient de la recherche par mots-clés (requête Wikidata ou catégorie de Wikipédia), `wm:<recherche>` quand le favori
l'a créée depuis une recherche de la Collection globale du jeu (`POST /api/targets/from-game`, titres = `wikipedia_title`
du jeu, non revérifiés sur Wikipédia). `rarity` (facultatif, C | PC | R | SR | UR | L, gardé seulement s'il est connu,
aussi par `targets/save` pour qu'une collection modifiée dans la page le garde) = rareté de la carte **dans le jeu**,
relevée par le favori : l'interface l'affiche sans « ≈ » (case vide, fiche de la carte manquante, « Il t'en manque »)
au lieu de la rareté estimée d'après les vues de l'article, qui reste pour les éléments sans `rarity`.

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

**Lecture incrémentale** (ne relire que ce qui a changé) : `users.cards_rev` = révision de la liste des cartes du
classeur, +1 par opération qui la change : import complet (favori ou fin de `/api/refresh`), synchro rapide,
`tags/set`, `tags/bulk`, `tags/rename` sur des cartes présentes. Une opération qui ne change rien (même collection,
mêmes étiquettes, synchro rapide sans nouveauté) ne la fait pas avancer. Chaque carte garde la révision de son dernier
changement (`cards.rev`, données ou étiquettes) ; une carte retirée par un import laisse une trace (`cards_gone`, avec
la révision du retrait), effacée si elle revient. L'interface garde la `rev` de la première page de sa lecture
complète (lue **avant** les cartes : un changement fait pendant la lecture revient au delta suivant), surveille
`cards_rev` dans `GET /api/me`, et quand elle change appelle `GET /api/cards?since=<rev gardée>` : `cards` = cartes
dont `rev > R` (au format Carte, avec leurs étiquettes : à remplacer ou ajouter), `gone` = cartes retirées depuis
(à enlever), puis elle garde la nouvelle `rev`. Réponse `{rev, delta:false}` (tout recharger) si `R > rev` (révision
inconnue : base recréée), si `R` est sous le plancher des retraits connus (`users.cards_gone_floor`) ou s'il y a plus
de 1 000 changements (cartes changées + retirées). Seuls les retraits des révisions les plus récentes sont gardés,
1 000 au plus : un plus ancien ne servirait qu'à un delta de plus de 1 000 changements, refusé de toute façon ; un
import qui retire plus de 1 000 cartes d'un coup n'en écrit donc aucun (une seule marque de débordement, effacée dans
la même transaction) : la révision avance et le plancher monte jusqu'à elle. Lecture par l'index `(user_id, rev)`,
1 001 lignes au plus : le coût ne dépend pas de la taille de la collection. Révision, plancher, `fetched_at`, `new_ids`
et changements sont lus dans la même requête ; les cartes arrivent en morceaux d'environ 1 Mo (une ligne D1 fait 2 Mo
au plus).

**Synchro rapide (seulement les nouveautés)** : chaque import complet et chaque synchro rapide écrivent
`users.sync_state` : compteurs du jeu (`total`, `totalUnique`, `rarityCounts`), `obtained_at` du plus récent exemplaire
lu, **valide ou non** (`last_at`, envoyé par le favori ou pris dans les exemplaires lus), date de la dernière lecture
complète **vérifiée** (`full_at`), ce que compte `total` (`unit`), cartes invalides distinctes (`invalid`), nombre de
cartes du classeur (`count`) et un jeton tiré à chaque écriture. Ensuite, le favori (et `/api/refresh` à la page 0) lit
`my-collection?sort=added` (tri « Ajout » du jeu, du plus récent au plus ancien), s'arrête au premier exemplaire d'au
plus `last_at`, et n'envoie que les nouveautés : 2 requêtes au jeu au lieu d'une par tranche de 50 exemplaires.

- **Armée seulement par une lecture complète vérifiée** : cartes rangées + cartes invalides distinctes = `totalUnique`
  (le favori envoie au premier morceau `rows` / `copies` = exemplaires lus et leur nombre total, invalides compris, et
  `ignored` = cartes distinctes qu'il a écartées ; le rafraîchissement les compte dans sa table d'attente, où les
  entrées invalides gardent une marque), et `total` correspond aux exemplaires lus. Sinon (page vide passagère,
  pagination instable…) le classeur prend ce qui a été lu mais `full_at` reste vide : la synchro suivante relit tout.
- **Unité de `total`, apprise à chaque lecture complète** : `copies` si `total` = Σ `count` lus ; `both` (ambiguë) si
  les lignes lues = les exemplaires lus = `total` ; `rows` si `total` = lignes lues alors que des piles (`count` > 1)
  existent : la synchro rapide ne verrait pas un exemplaire ajouté à une pile, elle est **coupée** (toujours une
  lecture complète) ; aucune des deux : lecture incomplète, pas armée. On ne suppose pas qu'il y a une ligne par
  exemplaire, ni ce que compte `total`.
- **Contrôles d'une synchro rapide** (sinon `needs_full` avec sa raison, rien d'écrit, relecture complète aussitôt) :
  aucune nouveauté invalide (`invalid`) ; `total` = précédent + exemplaires lus dans l'unité apprise (`both` exige en plus
  une ligne par exemplaire) — le précédent vient d'une lecture complète vérifiée puis de synchros contrôlées pareil,
  c'est donc aussi celui du classeur ; `rarityCounts`, rareté par rareté, quand ses valeurs somment à `total` (même
  unité) : voit un échange 1 contre 1 entre raretés différentes ; et en **absolu** : cartes du classeur + cartes
  nouvelles + cartes invalides connues = `totalUnique` (`counts`) ; 20 000 cartes au plus (`max_cards`) ; plus de 500
  nouveautés (`too_many`).
- **Comparer-échanger** : l'état n'est remplacé que s'il est encore celui lu au début de la requête, et les cartes ne
  sont écrites que dans ce cas (même transaction) : deux synchros en même temps (deux onglets, favori et
  rafraîchissement, import complet fini entre-temps) n'additionnent pas deux fois les mêmes exemplaires (`race`, le
  rafraîchissement passe alors à la lecture complète).
- **Exemplaire de la dernière synchro** : le premier exemplaire d'au plus `last_at` doit être daté de `last_at` (c'est
  le plus récent de la dernière synchro) ; sinon il est parti (vendu, échangé) et tout est relu. L'ordre des dates est
  contrôlé sur toute la page lue, au-delà de l'arrêt.
- **Rareté** : une carte possédée en plusieurs raretés garde la plus haute (C < PC < R < SR < UR < L), à l'import
  complet comme en synchro rapide et dans le favori.
- **Angles morts** (ce que les compteurs ne montrent pas) : échange 1 contre 1 de deux cartes de **même rareté** quand
  la carte reçue est datée d'avant `last_at` et que la carte donnée n'était pas la plus récente ; carte retirée des
  favoris (`starred`) ou devenue brillante sans nouvelle ligne ; si `total` compte les lignes et qu'aucune pile
  n'existait à la dernière lecture complète (`both`), un exemplaire ajouté à une ligne existante sans changer sa date.
  Remèdes : lecture complète forcée au moins une fois par semaine, et **« La prochaine mise à jour relira toute ta
  collection »** (onglet « Mettre à jour », `PATCH /api/me {force_full:true}`, clé principale : `full_at` effacé ;
  `GET /api/me` renvoie alors `next_full:true` et l'interface envoie `full:true` à `/api/refresh`).

Le tri `added` vient de la page profil du jeu (`rarity`, `name`, `added`). S'il n'était pas respecté (ignoré,
croissant), la vérification de l'ordre des dates le détecte dès la première page, sauf si l'ordre rendu tombait
décroissant par hasard : les compteurs (qui ne collent pas avec des « nouveautés » déjà comptées) puis la lecture
complète hebdomadaire rattrapent ce cas. Le favori affiche la raison de chaque relecture complète.

**Rafraîchissement par cookie** : `/api/refresh` lit au plus 10 pages par appel (limites de calcul et de sous-requêtes
des Workers gratuits), stocke les pages lues dans une table d'attente, et termine quand une page a moins de 50 entrées ; l'interface
rappelle avec `next_page` jusqu'à `done:true`. À la page 0, la synchro rapide lit au plus 9 pages triées par date ; si
elle échoue (erreur ou réponse sans JSON du tri `added`, ordre, exemplaire de la dernière synchro introuvable, trop
de nouveautés, compteurs, course), la lecture complète commence dans le même appel avec les pages restantes (10 pages
décodées au plus par appel, `next_page` = la page suivante réellement). Redirections non suivies (une redirection =
session expirée) ; un 403 qui n'est pas du JSON = refus anti-robots, `502` sans expirer la session ; un 403 JSON avec
`code: "automation_limit"` (ou un 429) = le jeu limite les lectures automatiques : `429` « Le jeu limite les lectures
automatiques : réessaie plus tard », session intacte, et pas de lecture complète derrière.

**Limite du cookie collé** : la session du jeu (Supabase) renouvelle son jeton. Si le serveur la renouvelle, le
navigateur du joueur garde l'ancien jeton : le jeu peut le déconnecter, et le rafraîchissement par cookie ne marche
en général qu'environ une heure après le collage. Le favori est donc le chemin principal ; le cookie est un secours. Pause de 250 ms entre deux pages. En-têtes envoyés au jeu : `Cookie`,
`Accept: application/json`, `User-Agent` d'un navigateur courant n'est PAS imité (on garde celui de la plateforme). Un
`Set-Cookie` dans une réponse du jeu met à jour le cookie stocké. 401/403 du jeu (hors limite de lectures
automatiques) → session marquée expirée, `401 {needs_session:true}`.

**CORS** : seuls `POST /api/import` et `POST /api/targets/from-game` (et leur `OPTIONS`), les deux routes du favori,
acceptent les origines `https://www.wiki-masters.com` et `https://wiki-masters.com`
(`Access-Control-Allow-Headers: content-type, x-classeur-key`). Le reste est même origine.

**Limites et quotas** (D1 gratuit : 500 Mo, 100 000 lignes écrites par jour, partagés par tous) : `MAX_USERS` comptes
(variable, 50 par défaut) ; 20 000 cartes par utilisateur ; étiquette = texte nettoyé, 60 caractères au plus (2 niveaux au plus dans le nom :
« Catégorie/Sous-catégorie », catégories larges : Pays, Métiers, Lieux, Culture et œuvres, Sciences et nature, Histoire
et événements, Organisations, Autres), 30 par carte, 50 000 par compte, 5 000 couples carte×étiquette par appel `tags/bulk` ; collections à compléter : 50 par
compte, 600 Ko chacune, 5 Mo au total ; import : 500 cartes et 40 morceaux par envoi, 8 Mo en attente ; corps JSON
de 5 Mo au plus (4 Ko pour `/api/account`). Entrées du jeu invalides (sans titre, rareté inconnue, champs trop
longs) : ignorées pareil par le favori et le rafraîchissement, comptées dans `skipped`, et comptées comme cartes
distinctes (quand elles ont un identifiant de carte) pour dire si une lecture est complète. Quota ou base pleine :
`503` avec un message lisible.

## Partage entre membres

Les membres du classeur (l'utilisateur et ses amis) peuvent se montrer leurs cartes, pour voir qui a celles qui
manquent à leurs collections. **C'est un choix, désactivé par défaut, et il est réciproque** : on ne voit les cartes des
autres que si l'on montre les siennes (Réglages, « Montrer mes cartes aux autres membres du classeur », ou le bouton de
l'onglet « Entre amis » ; `PATCH /api/me {shared:true|false}`, clé principale seulement).

- **Ce qui est montré** : le prénom (nom du classeur), le nombre de cartes, la date de la dernière synchro, et pour
  chaque carte `id, title, rarity, count` (exemplaires), `shiny, image, url`. **Jamais** les étiquettes, les collections
  à compléter, les préférences, les clés (principale ou d'import), le cookie du jeu, ni l'id interne du compte. Le
  serveur n'a pas de qid des cartes (ils sont résolus dans le navigateur) : il n'en montre pas.
- **Identifiant public** (`users.public_id`) : un membre est désigné par un identifiant aléatoire, tiré à chaque
  activation du partage et effacé à sa désactivation (un ancien identifiant mène alors à `404`) ; l'id interne du compte
  sert aussi de clé du cache des cartes dans le navigateur et n'est jamais montré aux autres. `users.shared` (0/1) dit
  si le membre partage. `DELETE /api/me` efface le compte : il disparaît aussitôt de la liste.
- **Coût** : `GET /api/members` = une requête (au plus `MAX_USERS` lignes, nombre de cartes compté par la clé primaire
  `(user_id, card_id)`). `GET /api/members/<id>/cards` = le membre (index unique `users_by_public_id`) et une page de
  1 000 cartes par clé (`card_id > curseur`), réduites en SQL aux champs montrés (liste blanche, `json_object`), dans la
  même transaction ; les étiquettes ne sont jamais lues. Aucun JavaScript proportionnel à la taille de la collection.
- **Interface** (onglet « Entre amis ») : liste des membres qui partagent ; « Pour compléter tes collections » = pour
  chaque collection (les tiennes et les proposées affichées), les cases vides qu'au moins un ami peut remplir, avec qui
  les a et en combien d'exemplaires (en double d'abord : les plus faciles à échanger), les collections où les amis
  remplissent le plus de cases d'abord ; « Ce qui pourrait intéresser tes amis » = tes cartes (tes doubles d'abord) qui
  remplissent une case vide des **collections du catalogue** qu'un ami a commencées (au moins 5 %, comme ses
  propositions) — ses propres collections à compléter ne sont pas partagées ; classeur d'un ami en lecture seule (filtre
  « Me manquent », recherche, tri). Dans un album, une case vide qu'un ami peut remplir porte un badge (« chez Paul ×2 »,
  « +1 » s'il y en a d'autres) ; sa fiche dit « Chez : Paul (×2), Léa ». Rapprochement carte ↔ élément comme pour les
  tiennes : titre, puis qid (`match.js` ; les titres des cartes des amis que tu n'as pas sont résolus dans le même cache).
- **Chargement** : à la demande (ouverture de l'onglet, d'un album ou d'une case vide, si tu partages), par pages de
  1 000, gardé en mémoire le temps de la visite, **jamais dans IndexedDB** ; la liste des membres est relue à chaque
  ouverture de l'onglet (sinon au plus toutes les 10 min) et les cartes d'un ami ne le sont que si sa synchro ou son
  nombre de cartes a changé.
- **Règles du jeu** : le classeur ne fait que montrer qui a quoi. Les échanges se font dans le jeu, par les joueurs ;
  rien n'est automatisé vers le jeu.

## Le favori (bookmarklet)

Source commentée : `site/public/assets/bookmarklet.js` ; l'interface la met sur une ligne et y insère l'origine du site et
la clé de l'utilisateur. Sur `www.wiki-masters.com` (utilisateur connecté) : petit encart de progression, lecture de
`my-collection/stats`, état de la synchro (`mode:'state'` ; `401` = favori périmé : arrêt aussitôt, avec le message du
classeur, sans lire la collection), puis synchro rapide si possible (pages `sort=added` jusqu'à `last_at`, envoi
`mode:'delta'` : « 3 exemplaires obtenus depuis ta dernière synchro, 2 nouvelles cartes », ou « Rien de nouveau ») ;
sinon lecture de toutes les pages `my-collection` (pause de 300 ms), regroupement des exemplaires en **CarteImport**
(rareté la plus haute), envoi `POST <site>/api/import` **par morceaux de 500** (`upload_id`, `part`, `last` ; `stats`,
`last_at`, `rows`, `copies`, `ignored` au premier), puis « 1 043 cartes envoyées au classeur, 12 nouvelles » et un lien
vers le classeur. Une relecture complète après une synchro rapide ratée dit pourquoi (tri par date en erreur ou dans le
désordre, carte la plus récente partie, plus de 500 nouveautés, nouvelle carte invalide, compteurs qui ne collent pas,
autre synchro en même temps). Cartes invalides : « 1 carte ignorée … elle reste dans le jeu, mais le classeur ne peut
pas la ranger » (pas « relance », qui n'y changerait rien) ; « relance le favori dans un moment » seulement si
`complete:false`. Une page sans liste `collection` est une erreur (rien n'est envoyé), pas la fin de la collection.
Ailleurs : « Ouvre wiki-masters.com et connecte-toi ». 401/403 du jeu : « Connecte-toi à WikiMasters » ; 403
`automation_limit` (ou 429) : « Le jeu limite les lectures automatiques : réessaie plus tard ».

**Sur la page « Collection globale »** (`/global-collection`, même favori) : l'encart propose deux choix, rien n'est lu
avant. « Mettre à jour mon classeur » = la synchro ci-dessus, inchangée. « Créer une collection avec cette recherche
(« vache ») » : la recherche est lue dans l'adresse si la page l'y met (`q`, `search`, `query` ou `recherche`), sinon
dans son champ (`input` dont le placeholder commence par « Rechercher par titre », celui des pages Collection du jeu) ;
à défaut le bouton dit « … avec une recherche… » et la recherche est demandée (`prompt()`, prérempli avec un autre champ
de recherche de la page s'il y en a un). 2 à 100 caractères. Lecture de `GET /api/cards?page=N&q=…&sort=name` (ordre
des noms), pause de 300 ms entre deux pages, jusqu'à `searchHasMore:false` (ou une page vide), **20 pages et 3 000
cartes au plus** (au-delà : « Trop de résultats … : précise ta recherche », rien n'est envoyé ; avec 50 cartes par page,
20 pages = 1 000 cartes). Aucune carte : « Aucune carte ne correspond à « … » ». Puis le nom est demandé (`prompt()`
« 87 cartes trouvées pour « vache ». Nom de la collection dans ton classeur : », prérempli « Vache » ; annuler = rien
d'envoyé) et la collection part à `POST <site>/api/targets/from-game` : « Collection « Vache » créée dans ton classeur :
87 cartes, avec leur rareté dans le jeu. » et le lien vers le classeur. Contrôle du format : réponse sans liste `cards`,
carte sans `id` ou sans `wikipedia_title`, aucune rareté connue, page suivante identique → « La Collection globale du jeu
a répondu dans un format inattendu (…). Rien n'a été envoyé au classeur. » ; une carte d'une rareté inconnue est
seulement écartée (« 1 carte écartée (rareté inconnue du classeur) »). Envoyé par carte : `{card_id, title, rarity,
category, image}` (image `null` si `hide_image`), rien d'autre. Ailleurs dans le jeu, la synchro part aussitôt, comme
avant.

## Règles du jeu

Les règles de WikiMasters interdisent les outils qui jouent ou **interagissent à la place du joueur**. Le classeur ne
fait que **lire** la collection (mêmes requêtes que la page « Collection » du site ; et, sur demande, une recherche de la
« Collection globale » avec les requêtes de cette page, pages de 50, pause de 300 ms) : jamais d'écriture dans le jeu,
jamais d'étiquette posée dans le jeu, pas de rafraîchissement automatique en tâche de fond (toujours un geste de
l'utilisateur). Pas de lien vers le marché du jeu : il ne lit aucune recherche dans son adresse (sa recherche
appelle `GET /api/marketplace?q=…`) et remplir son champ demanderait un script sur la page du jeu. À la place,
« Copier le nom » (fiche d'une carte, fiche et icône d'une case vide) met le titre dans le presse-papiers ; c'est le
joueur qui le colle dans la recherche du jeu. Toute la case vide ouvre la fiche de la carte manquante (description,
rareté estimée, vues, collections, « Copier le nom » si l'article est vérifié, Wikipédia).
