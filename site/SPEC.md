# Le classeur — contrat entre l'interface et le serveur

Site multi-utilisateur (l'utilisateur et ses amis) pour suivre une collection WikiMasters (wiki-masters.com, cartes =
articles de Wikipédia FR) **hors du jeu** : étiquettes personnelles, collections à compléter. Inspiré de
wikimaster-one.vercel.app (« Le classeur »), réécrit avec notre propre code.

**Vocabulaire de l'interface** (à respecter partout) :
- **Collections** : les listes créées par l'utilisateur, surtout par le favori depuis une recherche de la « Collection
  globale » du jeu (source `wm:<recherche>`), ou à la main dans « Nouvelle collection » (mots-clés, liste d'articles),
  et les anciennes ajoutées du catalogue (`catalog:…`) : toutes dans « Mes collections ».
- **Catégories** : les catégories de Wikipédia (pages `https://fr.wikipedia.org/wiki/Catégorie:Violet`). Une catégorie
  **suivie** est une collection à compléter de source `wp:<nom>`, rangée dans « Mes catégories » (jamais dans « Mes
  collections »).

Le catalogue de collections proposées tirées de Wikidata (`catalog.json`, 59 thèmes) a été **retiré** le 2026-10-16 :
l'interface ne le demande plus, et il n'est plus servi.

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
| `GET /api/me` | | `{user:{id, name, created_at}, fetched_at, card_count, next_full, cards_rev, new_ids, shared, shared_targets, session:{has_cookie, expired, updated_at}}` (`cards_rev` : révision de la liste des cartes, voir « Lecture incrémentale » ; `shared` : montre ses cartes aux autres membres, `shared_targets` : et ses collections à compléter, voir « Partage entre membres » ; `card_count` : tenu par les imports dans `sync_state`, sans relire les cartes (classeur importé avant ce compteur : compté une fois, puis gardé là, si `sync_state` n'a pas changé entre-temps) ; `next_full` : la prochaine mise à jour relira toute la collection, voir « Synchro rapide ») |
| `PATCH /api/me` | `{name?, prefs?, shared?, shared_targets?, force_full?}` (`prefs` : objet JSON ≤ 4 Ko, remplacé en entier, rangé tel quel par le serveur : `hidden_proposals` = catégories proposées retirées (`wp:<nom>`), `hide_proposals` = propositions masquées ; les anciennes `hidden_catalog` (ids du catalogue et `wp:<nom>`) et `hide_catalog` restent acceptées : l'interface les lit, garde les `wp:<nom>`, oublie les ids du catalogue et réécrit le tout au nouveau format à la modification suivante ; `shared` : booléen, sinon `400` ; `shared_targets` : booléen, `true` seulement si l'on montre ses cartes (déjà, ou `shared:true` dans la même requête), sinon `400` ; `shared:false` le remet à `false` ; `force_full: true` : la prochaine mise à jour relira toute la collection, autre valeur `400`) | `{user, prefs, shared, shared_targets}` ; `GET /api/me` renvoie aussi `prefs` (`{}` par défaut) |
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
| `GET /api/members` | (il faut partager soi-même, sinon `403`) | `{members:[{id, name, count, fetched_at, targets}]}` : les **autres** membres qui partagent ; `id` = identifiant public, `count` = nombre de cartes différentes, `fetched_at` = dernière synchro, `targets` = `null` s'il ne montre pas ses collections à compléter, sinon `{count, updated_at}` (leur nombre et leur dernier changement) |
| `GET /api/members/<id>/cards?part=X` | (`part` comme pour `GET /api/cards`, absent = `0` ; `403` si l'appelant ne partage pas, `404` si ce membre n'existe pas ou ne partage pas, ou plus) | `{member:{id, name, fetched_at}, cards:[{id, title, rarity, count, shiny, image, url}], part, next_part}` : pages de 1 000 cartes, sans étiquettes |
| `GET /api/members/<id>/targets?part=X` | (`part` : `0` ou absent, puis le curseur `next_part` ; `403` si l'appelant ne montre pas ses cartes, `404` si ce membre ne montre pas, ou plus, ses cartes **ou** ses collections) | `{member:{id, name}, targets:[{id, name, kind, items:[{title, qid?}]}], part, next_part}` : ses collections à compléter (ses collections et ses catégories suivies), réduites au nom, à leur nature (`kind` : `category` pour une catégorie de Wikipédia suivie, source `wp:…`, sinon `collection`) et, pour chaque élément vérifié (`status` `ok`), au titre et au qid ; pages d'au plus 512 Ko d'éléments rangés (plus la collection qui franchit ce seuil) |

**Collection à compléter** : `{id, name, items:[{title, description, image, status, qid?, rarity?}], source, created_at,
updated_at}` ; `qid` (facultatif, identifiant Wikidata `Q…`) permet de reconnaître une carte possédée même si son titre
diffère (renommage, redirection, homonymie) : l'interface rapproche d'abord par titre, puis par qid
(`site/public/assets/match.js`, qids des cartes résolus dans le navigateur et gardés en cache), `status` = `ok` | `missing` (article introuvable) | `disambiguation` (page d'homonymie). Les `items` sont
vérifiés **par l'interface** sur Wikipédia avant l'envoi ; le serveur ne fait que les ranger (au plus 3 000 éléments,
100 collections par utilisateur). `source` = `catalog:<id>` pour une collection ajoutée jadis depuis le catalogue
(retiré le 2026-10-16 ; elle reste une collection comme les autres), `wp:<nom de la catégorie>` pour une **catégorie de
Wikipédia suivie** (« Suivre cette catégorie » dans son album, ou « Suivre » une proposition de
`site/public/assets/propose.js` : catégories des cartes de l'utilisateur dont il possède au moins 5 % et 2 cartes, hors
catégories de rangement et de temps ; nom sans « Catégorie: », première lettre en majuscule), `wd` ou `cat` quand
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
`cards_rev` dans `GET /api/me` (au retour sur l'onglet, puis toutes les 60 s tant qu'il reste visible ; rien quand il
est caché ni pendant la fenêtre « Mettre à jour avec le favori », qui relit déjà toutes les 4 s ; `GET /api/me` = une
requête SQL, une ligne lue : le compte, par l'index unique de sa clé ; un envoi arrivé pendant que l'onglet est visible
s'annonce « Mis à jour depuis wiki-masters.com : 3 nouvelles cartes (1 053 cartes). »), et quand elle change appelle
`GET /api/cards?since=<rev gardée>` : `cards` = cartes
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
  chaque carte `id, title, rarity, count` (exemplaires), `shiny, image, url`. **Jamais** les étiquettes, les
  préférences, les clés (principale ou d'import), le cookie du jeu, ni l'id interne du compte ; les collections à
  compléter seulement avec le second réglage ci-dessous. Le serveur n'a pas de qid des cartes (ils sont résolus dans le
  navigateur) : il n'en montre pas.
- **Collections à compléter : second réglage, à part** (Réglages, « et mes collections à compléter », sous le premier et
  seulement quand il est coché ; `PATCH /api/me {shared_targets:true|false}` ; `users.shared_targets` 0/1, désactivé par
  défaut). Il n'existe qu'avec le partage des cartes : `400` sans lui, et couper le partage des cartes le coupe aussi (à
  rechoisir). Ce qui est montré, aux membres qui montrent leurs cartes : toutes ses collections à compléter (ses
  collections et ses catégories suivies ; pas les propositions qu'il ne suit pas), leur nom, leur nature (catégorie de
  Wikipédia ou collection, `kind`) et, pour chaque élément vérifié, son titre et son qid. **Jamais** leurs descriptions,
  images, statuts, leur source (recherche tapée, nom de la catégorie, id du catalogue) ni leurs dates ; les éléments
  introuvables ou d'homonymie sont omis (aucune carte ne peut les remplir). `GET /api/members` dit seulement leur nombre
  et la date du dernier changement.
- **Identifiant public** (`users.public_id`) : un membre est désigné par un identifiant aléatoire, tiré à chaque
  activation du partage et effacé à sa désactivation (un ancien identifiant mène alors à `404`) ; l'id interne du compte
  sert aussi de clé du cache des cartes dans le navigateur et n'est jamais montré aux autres. `users.shared` (0/1) dit
  si le membre partage. `DELETE /api/me` efface le compte : il disparaît aussitôt de la liste.
- **Coût** : `GET /api/members` = une requête (au plus `MAX_USERS` lignes, nombre de cartes compté par la clé primaire
  `(user_id, card_id)`). `GET /api/members/<id>/cards` = le membre (index unique `users_by_public_id`) et une page de
  1 000 cartes par clé (`card_id > curseur`), réduites en SQL aux champs montrés (liste blanche, `json_object`), dans la
  même transaction ; les étiquettes ne sont jamais lues. Aucun JavaScript proportionnel à la taille de la collection.
  `GET /api/members/<id>/targets` = le membre et une page de collections par la clé primaire `(user_id, id)` (`id >
  curseur`) : une somme cumulée (`SUM … OVER`) de leur taille rangée garde celles qui commencent sous 512 Ko (la première
  toujours), chacune réduite en SQL (`json_each`, `json_group_array`) au nom, au titre et au qid ; une réponse reste sous
  ~1 Mo (une collection fait 600 Ko rangés au plus), même pour un compte à 5 Mo de collections.
- **Interface** (onglet « Entre amis ») : liste des membres qui partagent (avec « partage ses collections : N » ou « ne
  partage pas ses collections », et le nombre de catégories parmi elles une fois lues) ; « Échanges possibles »
  (résumé, puis sa page, ci-dessous) ; « Pour compléter tes collections » = pour chaque collection et catégorie suivie
  (badge « catégorie »), les cases vides qu'au moins un ami peut remplir, avec qui les a et en combien d'exemplaires (en
  double d'abord : les plus faciles à échanger), les collections où les amis remplissent le plus de cases d'abord ;
  « Ce qui pourrait intéresser tes amis » = tes cartes (tes doubles d'abord) qui remplissent une case vide des
  collections qu'ils montrent ; **rien pour un ami qui ne les montre pas** (« Rien pour Léa, qui ne partage pas ses
  collections » ; plus d'estimation par le catalogue) ; classeur d'un ami en lecture seule (filtre « Me manquent »,
  recherche, tri). Dans un album, une case vide qu'un ami
  peut remplir porte un badge (« chez Paul ×2 », « +1 » s'il y en a d'autres) ; sa fiche dit « Chez : Paul (×2), Léa ».
  Rapprochement carte ↔ élément comme pour les tiennes : titre, puis qid (`match.js` ; les titres des cartes des amis que
  tu n'as pas, et ceux des éléments sans qid des collections qu'ils montrent et qui leur manquent — 2 000 au plus par
  lecture —, sont résolus dans le même cache).
- **Page « Échanges possibles »** (sous-page de l'onglet) : « telle carte de X pourrait compléter telle collection de
  Z », X et Z parmi toi et les amis dont les cartes sont lues (X ≠ Z). Collections de Z : les tiennes comme dans « Pour
  compléter tes collections » ; celles qu'un ami montre ; aucune pour un ami qui ne les montre pas (on ne sait pas ce
  qui lui manque : « Léa ne partage pas ses collections : impossible de savoir ce qui lui manque », ses cartes comptent
  quand même pour les autres). Une ligne par carte et par couple : rareté, titre, « ×n » si X l'a en double, puis les
  collections de Z qu'elle complète, chaque catégorie suivie suivie de « (catégorie) » (un même article dans deux
  collections de Z : une seule ligne). Groupées par couple « X → Z » avec « Paul peut compléter 5 cases chez Léa, dont 3
  en double » ; ordre : les couples qui ont le plus de doubles, puis le plus de cases (toi d'abord à égalité) ; dans un couple, les doubles d'abord (les
  plus faciles à donner), puis les cartes qui remplissent le plus de collections, puis la rareté. Filtres : « Ce qui me
  concerne » (tu donnes ou tu reçois, par défaut), « Tout le monde », ou un membre (il donne ou il reçoit). Une ligne de
  ta carte ouvre sa fiche ; une ligne pour toi ouvre la fiche de la case vide ; entre deux amis, rien à ouvrir. Calcul
  dans le navigateur (`trades`, propriété calculée : refait quand les cartes, les collections ou les qids changent ;
  ~120 ms pour 6 personnes de 5 000 cartes et 30 000 éléments de collection), filtre à part.
- **Chargement** : à la demande (ouverture de l'onglet, d'un album ou d'une case vide, si tu partages), par pages de
  1 000, gardé en mémoire le temps de la visite, **jamais dans IndexedDB** ; la liste des membres est relue à chaque
  ouverture de l'onglet (sinon au plus toutes les 10 min) et les cartes d'un ami ne le sont que si sa synchro ou son
  nombre de cartes a changé ; ses collections (après ses cartes) seulement s'il les montre et si leur nombre ou leur
  dernier changement a bougé. Pendant la résolution des qids des amis, les recalculs sont limités à un par seconde.
- **Règles du jeu** : le classeur ne fait que montrer qui a quoi. Les échanges se font dans le jeu, par les joueurs ;
  rien n'est automatisé vers le jeu.

## Onglet « Collections » (interface)

Deux zones, dans cet ordre :

1. **« Mes collections »** : les collections à compléter dont la source ne commence pas par `wp:` (favori depuis la
   Collection globale du jeu, « Nouvelle collection » par mots-clés ou liste d'articles, anciennes du catalogue), avec
   « Nouvelle collection ». Vide : une phrase explique comment en créer une avec le favori (recherche dans la
   « Collection globale », puis le favori), et « Installer le favori » s'il n'y en a pas encore.
2. **« Catégories »** (catégories de Wikipédia) :
   - **Recherche avec suggestions** (combobox accessible : ↑ ↓, Entrée, Échap, `aria-activedescendant`) sur toutes les
     catégories de Wikipédia : 250 ms après la dernière frappe (2 caractères au moins, « Catégorie: » retiré), une
     requête `action=query&generator=prefixsearch&gpsnamespace=14&gpslimit=20&prop=categoryinfo` (préfixe et taille
     dans la même réponse), complétée par `generator=search&gsrnamespace=14&gsrlimit=20&prop=categoryinfo` (plein
     texte) quand le préfixe donne moins de 5 catégories utiles ; écartées : catégories cachées (`categoryinfo.hidden`),
     de maintenance (ébauches, homonymies, pages à…), vides ; **8 suggestions au plus**, chacune avec son nombre
     d'articles (`categoryinfo.pages`), ses sous-catégories, « suivie » si c'est le cas. Une seule requête à la fois
     (file des requêtes Wikipédia de la page, 300 ms d'écart, 429/5xx : attente de `Retry-After` puis nouvel essai), la
     recherche précédente abandonnée (`AbortController`), réponses gardées en mémoire pendant la visite (60 au plus).
     En attendant les suggestions d'un nouveau texte, celles du précédent restent, estompées ; Entrée ouvre la
     suggestion active si la liste est celle du texte tapé (ou choisie aux flèches), sinon la recherche part aussitôt et
     sa première suggestion s'ouvre à son arrivée.
   - **Album d'une catégorie** (choisie dans les suggestions ou les propositions ; déjà suivie : l'album de la
     catégorie suivie) : ses articles (`list=categorymembers`, espace principal, 3 000 au plus ; « inclure les
     sous-catégories (1 niveau : N) » si elle en a), la progression avec tes cartes (titre puis qid), la rareté estimée
     des cases vides d'après les vues, comme les autres albums, de A à Z sans numéros ; « Voir sur Wikipédia » ;
     **« Suivre cette catégorie »** = `POST /api/targets/save {name, items, source:'wp:<nom>'}` (articles lus, avec ceux
     des sous-catégories si la case est cochée ; impossible au-delà de 3 000 articles). Suivie : badge « catégorie
     suivie », **« Ne plus suivre »** (`POST /api/targets/delete`) ; l'album reste ouvert comme une catégorie non suivie,
     d'où « Suivre » la reprend.
   - **« Mes catégories »** : les catégories suivies (source `wp:…`), mêmes lignes que les collections.
   - **« Proposées d'après tes cartes »** (`propose.js`) : catégories de tes cartes dont tu as au moins 5 % et 2 cartes,
     ni suivies ni retirées, **sans les sous-catégories** d'un thème déjà là (règles appliquées à l'affichage, sans
     requête, `ClasseurPropose.prune`) :
     1. **couverte** : au moins 80 % des cartes qui la rendent proposable (celles comptées pour les 5 % et les 2 cartes)
        sont déjà dans **une même** de tes collections ou catégories suivies (rapprochement titre puis qid, comme les
        albums) → pas proposée (une collection « Couleurs » qui a tes cartes rouges : « Rouge » n'est pas proposée) ;
     2. **hiérarchie** : les catégories parentes visibles de chaque proposition sont relevées au calcul
        (`action=query&prop=categories&clshow=!hidden&cllimit=max` sur les pages de l'espace 14, 50 par requête, même
        file et cache de 14 jours que le reste, `classeur-catparents` ; un incident ici n'empêche pas les propositions) ;
        une catégorie dont une parente est **suivie** n'est pas proposée ; une catégorie dont une parente est **elle-même
        proposée** non plus (la parente seule reste ; d'une chaîne, la plus haute ; deux catégories parentes l'une de
        l'autre : la plus grande) ; si la parente n'est pas proposable (seuils, retirée, couverte), les filles restent.
     Chaque proposition dit pourquoi elle est là (« Tu as : Coquelicot, Fraise et 3 autres » : les cartes comptées).
     Le nom ouvre l'album, « Suivre » (on reste sur la liste, elle passe dans « Mes catégories »), « Retirer »
     (`prefs.hidden_proposals`), « Voir sur Wikipédia » ; « Chercher de nouvelles propositions », « Rétablir les
     propositions retirées », « Masquer les propositions » (`prefs.hide_proposals` : plus rien n'est cherché sur
     Wikipédia tant qu'elles sont masquées).

Bandeau : « N collections » = le nombre de collections de « Mes collections » (sans les catégories suivies, sans
total à atteindre). Fiches (carte possédée, case vide) : « Dans tes collections » et « Dans tes catégories » (catégories suivies
qui contiennent la carte, par titre ou qid).

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

**Mode relié** (le favori reste dans la page) : après son clic, le favori reste actif dans la page du jeu jusqu'à ce
qu'elle soit rechargée (le jeu est une application Next.js : y naviguer ne la recharge pas) ; sans `URL` ni `fetch`, il
reste ponctuel, comme avant (bouton « Fermer »). Il enveloppe `window.fetch` **pour regarder** les requêtes que la page
fait d'elle-même : la requête part d'abord, telle quelle (mêmes arguments, même `this`), et la page reçoit la promesse
même du `fetch` d'origine ; le favori ne lit que la méthode et l'adresse (jamais le corps de la requête, ni celui de la
réponse : seul son `ok`, une fois reçue), n'ajoute ni ne change aucun en-tête, et avale ses propres erreurs. Ses propres
requêtes (jeu et classeur) passent par le `fetch` d'avant lui : jamais observées. `XMLHttpRequest` n'est pas enveloppé :
le code du jeu relevé n'en contient que dans un polyfill de `fetch`, et les extensions tierces lisent les actions du jeu
dans `fetch`.

- Une action qui change la collection (tableau ci-dessous, réponse 2xx) programme la **synchro rapide** existante 5 s
  après la dernière action (30 s au plus après la première d'une rafale), jamais moins d'une minute après la fin de la
  précédente, **20 automatiques par heure** au plus. Une relecture complète automatique (compteurs qui ne collent plus
  après une défausse, une mise aux enchères…) a lieu au plus **toutes les 15 minutes** ; sinon elle est reportée et
  annoncée (« Relecture complète prévue à 14:50 (…) : « Synchroniser » la lance tout de suite »). Une action pendant une
  synchro en programme une autre après. Sans action en attente, aucune minuterie : rien n'est lu.
- Encart : messages comme avant, puis réduit en badge 15 s après une synchro réussie lancée d'un clic : « Classeur relié
  · dernière synchro à 14:32 » (ou « synchro dans un instant (paquet ouvert) », « synchro à 14:35 (paquet ouvert ; une
  par minute au plus) », « relecture complète à 14:50 (…) », « synchro en cours… »). Boutons « Synchroniser » (tout de
  suite, hors limites des synchros automatiques), « Réduire » / « Détails », « Arrêter » (rend `window.fetch` d'origine ;
  si un autre script l'a enveloppé à son tour, il reste en place et l'enveloppe du favori ne fait plus que passer la
  main ; encart retiré). L'encart est remis dans la page si le jeu l'en retire en se redessinant.
- Erreur d'une synchro automatique : encart déplié avec le message. Une erreur qui arrête tout (session, limite de
  lectures automatiques du jeu, favori périmé) ou trois de suite mettent les synchros automatiques **en pause** jusqu'à
  un « Synchroniser » réussi.
- Nouveau clic dans la même page : pendant une synchro, il déplie seulement l'encart ; sinon l'ancien favori est arrêté
  (son `fetch` rendu) et le nouveau repart de zéro avec sa clé (`window.__classeurRelie` = `{show, stop}`, sans la clé).
- **Script Tampermonkey / Violentmonkey** (facultatif ; onglet « Mettre à jour », replié sous le favori) : le même code,
  `"__START__"` remplacé par `"load"`, sous l'en-tête `@match https://www.wiki-masters.com/*` et
  `https://wiki-masters.com/*`, `@grant none` (il doit tourner dans la page pour voir son `fetch`), `@run-at
  document-idle`, `@noframes`. Relié dès le chargement de chaque page du jeu, en badge réduit ; **rien n'est lu avant une
  action** du joueur, et pas de choix sur la Collection globale. Il porte la clé d'import comme le favori (si le
  gestionnaire synchronise ses scripts, la clé part avec) ; régénérer le favori l'arrête aussi.

**Actions observées** (méthode et chemin d'une requête de la page vers l'API du jeu, même origine, réponse 2xx), d'après
des sources tierces lues sans rien exécuter — `docs/api.md` du client qpautrat/wikimasters-cli et le code d'extensions
du Chrome Web Store — et **pas vérifiées sur le jeu** :

| Requête de la page | Effet sur la collection | Favori relié | Sources |
|---|---|---|---|
| `POST /api/packs/open` (et `/api/packs/special`, `/pro-daily`, `/grace` : tout `POST /api/packs/…`) | ajoute les cartes tirées : lignes neuves datées de l'ouverture ; réponse `{cards, packs_remaining, packs_last_regen_at, owned_copies}` | synchro rapide | WikiMasters+ (`inject.js`, les 4 chemins), WikiMasters Toolbox (`network.js`), WikiRemastered (`pack-cards.js`, `network.js`), Wiki Master Toolkit (`bridge/core.js`) |
| `POST /api/user-cards/bulk-discard` `{card_ids: [user_cards.id]}` → `{balance, discarded_count, failed}` | retire les exemplaires défaussés (HTTP 200 même si tout est refusé) | synchro rapide, puis relecture complète (compteurs) | `docs/api.md` ; WikiMasters QoL (`api.js`), Toolkit (`discard.js`), WikiRemastered (`api.js`), Pulls Monitor (`collection.js`) |
| `POST /api/user-cards/<id>/discard` | retire un exemplaire | idem | WikiSpeeder (`content.js`), WikiRemastered (`api.js`), Collection+ (`review-*.js`) |
| `POST /api/marketplace` `{card_id: user_cards.id, base_amount, duration_minutes}` → `{auction_id}` | mise aux enchères : la ligne de l'exemplaire est supprimée | idem | `docs/api.md` |
| `DELETE /api/marketplace/<id d'enchère>` → `{status: "cancelled"}` | annulation : la carte revient, nouvelle ligne datée de l'annulation | synchro rapide (simple nouveauté) | `docs/api.md` |
| toute requête d'écriture vers `/api/trades` ou `/api/trades/…` | échange : cartes données et reçues ; chemins d'écriture **inconnus** (seul `GET /api/trades` est relevé) | synchro rapide (relecture complète si une carte part) | `GET /api/trades` : Toolkit, Toolbox, WikiRemastered ; écritures : Collection+ les range sous « trade » sans les nommer |
| `POST /api/achievements/claim` `{achievement_id}` | récompense : des wikibidous d'après les sources ; une carte ou un paquet, pas exclu | synchro rapide (« Rien de nouveau » si rien n'a bougé) | QoL (`api.js`), Toolkit (`ACTIVITY.md`, `activity.js`) |
| `POST /api/marketplace/<id>/bid` | aucun : une enchère gagnée n'arrive qu'à sa clôture, côté serveur | rien | `docs/api.md` |
| `POST /api/human-check`, `POST /api/achievements/check`, toute lecture (`GET`), Supabase (`PATCH user_cards` : étoile ; étiquettes ; liste de souhaits), statut hors 2xx | aucun sur ce que le classeur garde | rien | `docs/api.md` ; Toolkit (`pack-verification.js`, `ACTIVITY.md`) ; WikiMasters+ (`inject.js`) |

**Ce qu'il ne voit pas** (rattrapé par un clic, la relecture complète hebdomadaire ou « Tout relire ») : une enchère
gagnée (la carte arrive à la clôture, sans requête du joueur à ce moment) ; un échange accepté par l'autre joueur ; ce
qui se passe dans un autre onglet ou appareil non relié ; une action faite par une extension qui garde le `fetch` d'avant
le favori, ou par une « server action » Next.js (`POST` sur une page, non observé) ; une requête que le jeu ferait avec
une référence à `fetch` prise avant le clic (à vérifier dans le jeu : le badge doit annoncer « synchro dans un instant
(paquet ouvert) » après une ouverture de paquet) ; une étoile ou une brillance changée (angle mort de la synchro rapide).

**Retraits, plus économes ?** La défausse (`card_ids` = ids d'exemplaires, `discarded_count`, `failed`) et la mise aux
enchères (`card_id` = id d'exemplaire) disent exactement quels exemplaires partent, mais le classeur ne garde que les
cartes (`card.id`) et leurs totaux, pas les ids d'exemplaires. Il faudrait les apprendre dans les réponses `my-collection`
que la page affiche (donc lire leurs corps) et un mode « retraits » de la synchro rapide côté serveur (compteurs ; carte
encore possédée dans une autre rareté, brillante ou plus ancienne : rareté, brillance et date inconnues ; exemplaire de
`last_at` parti). Pas fait : la relecture complète automatique bornée (une par quart d'heure) suffit tant que les
défausses restent occasionnelles.

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
jamais d'étiquette posée dans le jeu, jamais de lecture automatique quand il ne se passe rien. Toute lecture du jeu suit
un geste du joueur : le clic sur le favori, « Synchroniser », ou — favori relié — **une action qu'il vient de faire
lui-même dans le jeu** (ouvrir un paquet, défausser, mettre aux enchères ou annuler, échanger, réclamer une récompense).
La synchro qui suit est celle qu'il aurait lancée d'un clic (2 lectures pour la synchro rapide), au plus une par minute
et 20 par heure, une relecture complète au plus tous les quarts d'heure. Le favori relié ne joue pas, ne clique rien,
n'envoie au jeu aucune autre requête que ces lectures, et ne modifie ni les requêtes de la page ni leurs réponses. Pas
de lien vers le marché du jeu : il ne lit aucune recherche dans son adresse (sa recherche appelle
`GET /api/marketplace?q=…`) et remplir son champ demanderait un script sur la page du jeu. À la place, « Copier le nom »
(fiche d'une carte, fiche et icône d'une case vide) met le titre dans le presse-papiers ; c'est le joueur qui le colle
dans la recherche du jeu. Toute la case vide ouvre la fiche de la carte manquante (description, rareté estimée, vues,
collections, « Copier le nom » si l'article est vérifié, Wikipédia).

**Ce qui change avec le mode relié** (2026-10-16) : avant, le favori ne faisait plus rien après son message ; il reste
maintenant dans la page, `window.fetch` enveloppé, jusqu'à son rechargement ou « Arrêter ». **Risques** : (1) c'est
visible pour le jeu, et le favori ne s'en cache pas : `window.fetch` n'est plus la fonction native
(`window.fetch.toString()` ne dit plus `[native code]`) et le badge est dans la page. Plusieurs extensions publiques du
jeu (WikiMasters+, Toolbox, Wiki Master Toolkit, Collection+, WikiRemastered…) enveloppent déjà `fetch` de la même façon
pour lire les ouvertures de paquets ; le jeu pourrait détecter ces enveloppes, rien de connu ne dit qu'il le fait. (2) Les
lectures automatiques suivent le rythme du joueur : très actif, il peut atteindre 20 synchros rapides par heure
(≈ 40 lectures, plus une relecture complète par quart d'heure s'il défausse) ; une limite de lectures automatiques du jeu
(`automation_limit`, 429) met le mode relié en pause. (3) Le script Tampermonkey se relie à chaque page du jeu sans clic :
il ne lit rien avant une action, mais il n'y a plus de geste explicite pour le démarrer.
