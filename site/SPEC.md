# Le classeur — contrat entre l'interface et le serveur

Site multi-utilisateur (l'utilisateur et ses amis) pour suivre une collection WikiMasters (wiki-masters.com, cartes =
articles de Wikipédia FR) **hors du jeu** : étiquettes personnelles, collections à compléter. Inspiré de
wikimaster-one.vercel.app (« Le classeur »), réécrit avec notre propre code.

**Vocabulaire de l'interface** (à respecter partout) :
- **Collections** : les listes créées par l'utilisateur, surtout par le favori depuis une recherche de la « Collection
  globale » du jeu (source `wm:<recherche>`), à la main dans « Nouvelle collection » (mots-clés, liste d'articles),
  depuis une catégorie de Wikipédia (`wp:<nom>`), depuis les liens d'une page de Wikipédia (`links:<titre>`) ou la
  colonne clé de ses tableaux (`links:<titre>#<colonne>`), et les anciennes ajoutées du catalogue (`catalog:…`) : toutes
  dans « Mes collections ».
- **Catégories** : les catégories de Wikipédia (pages `https://fr.wikipedia.org/wiki/Catégorie:Violet`), une **source**
  d'où créer une collection (« Créer une collection » : source `wp:<nom>`, signalée « depuis la catégorie Wikipédia »),
  pas une liste à part. On ne « suit » pas une catégorie (2026-10-16 : « Suivre », « Mes catégories » et « Ne plus
  suivre » ont disparu ; les anciennes catégories suivies sont des collections comme les autres). La même zone ouvre
  aussi une **page** de Wikipédia (« Liste de noms de couleur », ou toute page dont on colle l'adresse) : les articles
  qu'elle lie sont une autre source (source `links:<titre>`, signalée « depuis la page Wikipédia « … » »), ou, si sa
  liste est en tableaux, les articles d'une **colonne clé** de ses tableaux (source `links:<titre>#<colonne>`, signalée
  « depuis la page Wikipédia « … », colonne « … » »).

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
  600 Ko par envoi, 5 Mo en tout) ; on ne peut rien lire (ni cartes, ni étiquettes, ni collections), ni
  modifier ou supprimer une collection existante, ni toucher au compte. On la régénère (l'ancien favori cesse de
  marcher) et on supprime les collections en trop. **Marché** (2026-10-16, voir « Le marché ») : la clé d'import ouvre
  aussi `POST /api/market/plan`, `POST /api/market/prices`, `POST /api/market/live` et `POST /api/market/fail`
  (2026-10-17 : raison d'un échec de lecture). C'est **sa seule lecture** : le
  plan, soit des identifiants de cartes du jeu (les tiennes à coter) et les titres des cartes qui manquent à tes
  collections (500 au plus, avec leur card_id quand le favori l'a trouvé) ; jamais les étiquettes, les noms des
  collections ni le reste du classeur. Une clé d'import qui fuit permet donc en plus de lire ces titres, d'envoyer de
  fausses cotes (cache commun à tous les classeurs, dans les quotas), de remplacer la lecture du marché de ce
  classeur (ses bonnes affaires et enchères affichées) et d'y afficher un faux « dernier essai » (message de 300
  caractères au plus). **Journal des synchros** (2026-10-17) : elle ouvre aussi `POST /api/sync-log` (le favori y
  signale ses échecs) ; une clé d'import qui fuit permet donc d'y écrire de faux échecs (30 par heure au plus), jamais
  de lire le journal (`GET /api/sync-log` : clé principale).
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
  "category": "chanteuse barbadienne",  // card.category, la « catégorie du jeu » (texte affiché sous le titre, en général la description Wikidata), 500 caractères au plus (coupée), peut être null
  "image": "https://upload.wikimedia.org/…/330px-….png",  // card.image_url, null si absent ou hide_image
  "url": "https://fr.wikipedia.org/wiki/Rihanna",           // card.wikipedia_url
  "count": 1,                    // somme des count des exemplaires
  "shiny": false,                // au moins un exemplaire is_shiny
  "starred": false,              // au moins un exemplaire starred
  "obtained_at": "2026-10-14T16:24:39.011Z",  // plus ancien obtained_at des exemplaires
  "variants": {"L": 1},          // facultatif : exemplaires par rareté d'exemplaire et brillance (voir ci-dessous)
  "gtags": ["Chanteuses", "Musique"],         // facultatif : tags du jeu (posés par le joueur dans wiki-masters.com), voir ci-dessous
  "gtagc": {"Musique": "#94a3b8"},            // facultatif : leur couleur dans le jeu, quand il en donne une
  "tags": ["Musique", "à échanger"]           // étiquettes de l'utilisateur dans le classeur (pas celles du jeu : gtags)
}
```

**Tags du jeu** (`gtags`, 2026-10-18 ; « je parlais [des tags] de wiki-masters, pas ceux en automatique ») : les étiquettes
que le joueur crée lui-même dans le jeu (table `tags` du jeu : `id` UUID, `name`, `color` hexadécimal, par défaut
`#94a3b8` ; noms uniques par joueur sans tenir compte de la casse ; posées sur les entrées de sa collection par
`user_card_tags`). Chaque entrée de `my-collection` porte `tags` = `[{id, name, color, …}]` ; `tagOptions` (stats) = la
liste des étiquettes du joueur (d'après `docs/api.md` de qpautrat/wikimasters-cli, relevés du 9 et 10 octobre ;
**pas encore vu dans une vraie collection** : la seule relevée, le 15/10, n'en avait aucun). Lus de façon tolérante
(favori et serveur, `cards.js` `gameTagsOf`) : le nom d'un objet (`name`, sinon `label`, `title`, `tag`, `value`, un
niveau d'objet en plus : `{tag: {name}}`), une chaîne ; côté serveur aussi un nombre et un identifiant traduit par
`tagOptions` (tableau d'objets `{id|key|value, name|label|…}`, ou objet id → nom) ; un objet sans nom dont l'identifiant
n'est pas connu est ignoré (jamais un identifiant opaque pris pour un nom). Carte : noms nettoyés (espaces), 60
caractères au plus, 30 par carte, **réunis sur tous ses exemplaires** (un tag est posé sur une entrée, pas sur la carte),
sans doublon, triés (ordre binaire), absents s'il n'y en a aucun ; `gtagc` = la couleur de chacun quand le jeu en donne
une valide (`#rgb`, `#rrggbb`, `#rrggbbaa`, en minuscules). Gardés dans `cards.data`, rendus par `GET /api/cards` et
`?since` comme le reste de la carte, **jamais montrés aux autres membres** ; ils ne se mêlent jamais aux tags du classeur
(table `tags`).

`variants` (2026-10-16, pour coter chaque exemplaire, voir « Le marché ») : `{"<rareté>[*]": nombre}`, « * » =
brillant, clés dans l'ordre binaire, somme = `count`. Rareté d'un exemplaire = son `snapshot_rarity` (rareté quand il a
été obtenu, celle des ventes du marché) s'il est dans l'entrée du jeu, sinon `card.rarity` (format de `my-collection`
**pas vérifié** : si le jeu n'y met pas `snapshot_rarity`, toutes les raretés d'exemplaire sont celle de la carte).
Envoyé par le favori dans chaque CarteImport et calculé par le rafraîchissement par cookie ; additionné en SQL à
l'import complet (gardé seulement s'il compte tous les exemplaires de la carte) et en synchro rapide (si l'ancienne carte
et les nouveautés l'ont ; sinon retiré jusqu'à la relecture complète suivante) ; forme invalide (rareté inconnue, somme
fausse) : seulement oublié. Absent (carte importée avant, favori plus ancien) : la cote de la carte est approchée (tous
ses exemplaires dans `rarity`, un seul brillant si `shiny`). `rarity`, `shiny` et la synchro rapide (compteurs
`rarityCounts` comparés à `rarity`) ne changent pas. Jamais montré aux autres membres.

**Tags du jeu dans la page** : fiche d'une carte, « Tags du jeu » en pastilles (couleur du jeu en point, gris
`#94a3b8` sans couleur ; lecture seule : ils se changent dans le jeu), au-dessus de « Tes tags » et à part d'eux ;
« Mes cartes », section « Tags du jeu » du menu de gauche (après « Raccourcis ») : un bouton par tag (sans tenir compte
de la casse) avec son nombre de cartes, les plus portés d'abord, 24 puis « Afficher les N autres » ; clic : ce tag seul
(ou plus aucun), Ctrl/⌘+clic : combiner (toutes les cartes qui les portent tous), combinable avec tes tags du classeur ;
filtre rappelé dans la ligne des résultats (« Jeu : Maladie », retirable ; « Réinitialiser les filtres » le retire
aussi) ; la recherche lit aussi les tags du jeu. Aucun tag du jeu lu : « Aucun tag du jeu lu pour l'instant : ceux que
tu poses sur tes cartes dans wiki-masters.com arrivent avec une mise à jour complète par le favori (celui du 18 octobre
2026 ou plus récent). » Fenêtre « Ajouter par tags du jeu » : voir « Onglet « Collections » ».

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
| `POST /api/account` | `{code, name?}` (`code` = `SIGNUP_CODE`) | `201 {key, user:{id, name}}` ; `409` si le prénom est déjà celui d'un autre classeur (comparé sans casse, accents ni espaces en trop), avec un message qui dit comment retrouver son lien (Réglages d'un appareil où il est ouvert, ou un nouveau lien demandé à la personne qui gère le classeur) ; exception : un classeur de ce prénom qui n'a jamais servi (aucune synchro, pas de favori, aucune carte ni collection) est effacé et remplacé (2026-10-17 : des amis qui avaient perdu leur lien recréaient un second classeur) ; sans prénom, aucun contrôle |
| `GET /api/me` | | `{user:{id, name, created_at}, fetched_at, card_count, next_full, cards_rev, new_ids, shared, shared_targets, last_chat_id, market_at, last_sync, session:{has_cookie, expired, updated_at}}` (`last_chat_id` : numéro du dernier message du chat, supprimé ou non, `0` sans message, lu dans la même requête que le compte, voir « Chat » ; `market_at` (2026-10-17) : heure du dernier envoi du favori au marché — lecture du marché reçue, ou essai fini, réussi ou non —, `null` sans, lue dans la même requête (ligne `market` par sa clé primaire) : la page relit alors l'onglet « Marché », voir « Le marché » ; `cards_rev` : révision de la liste des cartes, voir « Lecture incrémentale » ; `shared` : montre ses cartes aux autres membres, `shared_targets` : et ses collections à compléter, voir « Partage entre membres » ; `card_count` : tenu par les imports dans `sync_state`, sans relire les cartes (classeur importé avant ce compteur : compté une fois, puis gardé là, si `sync_state` n'a pas changé entre-temps) ; `next_full` : la prochaine mise à jour relira toute la collection, voir « Synchro rapide » ; `last_sync` : dernière ligne du journal des synchros, `{at, kind, via, result, message}` ou `null`, gardée dans le compte (aucune requête de plus), voir « Journal des synchros ») |
| `PATCH /api/me` | `{name?, pseudo?, prefs?, shared?, shared_targets?, force_full?}` (`pseudo` : pseudo dans le jeu, 2026-10-18, 40 caractères au plus, sans espace ni « / ? # < > \ », vide = aucun ; rendu dans `user.pseudo` de `GET /api/me`, et aux membres avec qui il partage dans `GET /api/members` : « Entre amis » le montre avec « copier » et un lien vers son profil du jeu, `https://www.wiki-masters.com/profile/<pseudo>` ; ailleurs, la page le montre partout où paraît le prénom d'un de ces membres (2026-10-19, demande de l'utilisateur : « voir le pseudo in game partout où un pseudo est affiché ») : discret à côté du prénom dans les messages du chat (lien vers son profil du jeu), dans les suggestions de « @ » et la liste « Un membre… » des échanges, en info-bulle (prénom souligné en pointillés) sur les mentions, les « qui a quoi », « Chez : … » des fiches et des cases vides et les noms des échanges ; rien de plus du serveur : la page le tire de `GET /api/members` (le chat associe auteur et mentions au membre par le prénom, unique), donc jamais pour un membre qui ne montre pas ses cartes, ni sur tes propres messages ; réglé dans Réglages, « Ton pseudo dans WikiMasters ») (`prefs` : objet JSON ≤ 4 Ko, remplacé en entier, rangé tel quel par le serveur : `hidden_proposals` = catégories proposées retirées (`wp:<nom>`), `hide_proposals` = propositions masquées ; les anciennes `hidden_catalog` (ids du catalogue et `wp:<nom>`) et `hide_catalog` restent acceptées : l'interface les lit, garde les `wp:<nom>`, oublie les ids du catalogue et réécrit le tout au nouveau format à la modification suivante ; `shared` : booléen, sinon `400` ; `shared_targets` : booléen, `true` seulement si l'on montre ses cartes (déjà, ou `shared:true` dans la même requête), sinon `400` ; `shared:false` le remet à `false` ; `force_full: true` : la prochaine mise à jour relira toute la collection, autre valeur `400`) | `{user, prefs, shared, shared_targets}` ; `GET /api/me` renvoie aussi `prefs` (`{}` par défaut) |
| `DELETE /api/me` | | `{ok:true}` : efface tout (cartes, cartes retirées, étiquettes, collections, cookie) et le compte ; ses messages du chat sont vidés et perdent leur auteur (voir « Chat ») |
| `POST /api/import-key` | | `{import_key}` : clé réservée à `/api/import` (celle du favori) ; en crée une nouvelle, l'ancien favori cesse de marcher |
| `GET /api/favori.js` | (sans clé ; 2026-10-18) | le code du favori (`public/assets/bookmarklet.js`), `text/javascript`, `Cache-Control: no-store`, l'adresse du classeur en place et la clé d'import lue dans `window.__classeurCourt.k` : c'est ce que charge le **favori court** (onglet « Mettre à jour », « Sur téléphone : le favori court ») : `javascript:(function(){window.__classeurCourt={k:"<clé d'import>"};` puis une balise `<script src="<classeur>/api/favori.js?t=…">` (moins de 600 caractères, au lieu des ≈ 62 000 du favori complet, qui font planter les navigateurs de téléphone). La clé ne passe jamais dans une adresse ; chaque clic prend la dernière version du favori (il faut le réseau, et ce code vient du classeur à chaque fois). `503` si les fichiers du site ne sont pas liés (`ASSETS`) |
| `GET /api/import-key` | (clé principale) | `{import_key}` : la clé du favori en cours, **la même sur tous les appareils** (le classeur en garde une copie chiffrée, `users.import_key_enc` : AES-GCM de `COOKIE_SECRET`, donnée associée `import-key:<id>`) ; `404` sans favori, ou pour un favori créé avant le 2026-10-18 (sans copie), ou sans `COOKIE_SECRET`. Avant, la clé n'était gardée que dans le navigateur qui l'avait créée : un favori créé ailleurs la rendait périmée et la page reproposait ce favori périmé sans fin (« Favori périmé » à chaque essai) |
| `POST /api/import-key/adopt` | `{import_key}` (clé principale ; 43 caractères `[A-Za-z0-9_-]`, sinon `400`) | `{import_key}` si c'est bien la clé du favori en cours (le classeur en garde alors la copie chiffrée) ; `409` sinon (« Favori périmé » : la page l'oublie, le dit et propose « Créer un nouveau favori »). L'onglet « Mettre à jour » demande d'abord `GET /api/import-key`, puis, sur `404`, propose ainsi la clé gardée dans ce navigateur |
| `POST /api/key/rotate` | | `{key}` : nouvelle clé principale ; l'ancienne (et l'ancien lien) cesse de marcher |
| `GET /api/cards?part=X` | (`part` facultatif : `0` pour la première page, puis le curseur `next_part` renvoyé tel quel ; pages de 1 000 cartes) | `{rev, fetched_at, cards:[Carte], new_ids:[id…], part, next_part}` (`next_part` : curseur opaque, `null` à la dernière page ; `rev` : révision lue avant les cartes, garder celle de la page `0`) ; sans `part` : `{rev, fetched_at, cards, new_ids}`, tout d'un coup (à éviter au-delà de ~3 000 cartes : limite de calcul) |
| `GET /api/cards?since=R` | `R` : entier ≥ 0, la `rev` gardée (sinon `400`, et `400` avec `part`) | `{rev, delta:true, cards:[Carte], gone:[id…], fetched_at, new_ids}` : cartes changées (données ou étiquettes) et cartes retirées depuis `R` ; ou `{rev, delta:false}` : tout recharger (voir « Lecture incrémentale ») |
| `POST /api/import` | **par morceaux** : `{upload_id, part, last, cards:[CarteImport], stats?, last_at?, rows?, copies?, ignored?, stats_end?, started?, reason?, via?, v?, source}` (500 cartes au plus par morceau ; `collection:[entrées brutes]` reste accepté à la place de `cards` ; `rows`, `copies`, `ignored` : entiers ≥ 0, sinon `400`, voir « Synchro rapide » ; `stats_end` : compteurs du jeu relus après la dernière page, objet, sinon `400` ; `started` : l'heure `now` rendue par `state` ; `reason` : pourquoi une lecture complète (`state`, `counts`, `race`, `invalid`, `too_many`, `max_cards`, `gone`, `order`, `sort`, `tags`) ; `via` : `clic`, `relie` ou `script` ; `v` : version du favori ; ces cinq-là, au premier morceau, pour la sûreté et le journal, voir « Synchros sûres » ; `gtags_odd` : forme de tags du jeu que le favori n'a pas reconnue, voir « Journal des synchros ») | morceau intermédiaire : `{ok:true, received, skipped}` (cumulés ; morceaux dans l'ordre, sinon 409) ; dernier (`last:true`) : `{count, new_ids, complete, skipped, removed, kept}` (`complete` = `count` + cartes invalides distinctes = `stats.totalUnique` : `false` = il manque des cartes que le classeur aurait pu ranger, ou la collection a bougé pendant la lecture (`moved:true` en plus) ; `null` sans stats ; `count` = cartes du classeur après l'envoi ; `removed` = cartes retirées, seulement par une lecture vérifiée ; `kept` = cartes du classeur absentes d'une lecture non vérifiée, gardées) ; `{…, superseded:true}` : rien d'écrit, une lecture commencée après celle-ci est déjà appliquée ; `{…, again:true}` : dernier morceau d'un envoi déjà appliqué, renvoyé (réponse perdue) : même résultat ; morceaux manquants (envoi interrompu ou abandonné) : `409`, l'envoi est effacé ; synchro rapide : `{mode:'state'}` → `{quick, last_at, full_at, now, v}` (`now` : heure du serveur, à renvoyer en `started` ; `v` : version la plus récente du favori), `{mode:'delta', cards, stats, rows, copies, last_at, started?, via?, v?, gtags_odd?}` → `{count, new_ids, complete, skipped:0, quick:true}` (`superseded:true` en plus si une lecture commencée après est déjà appliquée : rien d'écrit) ou `{needs_full:true, reason}` (rien d'écrit ; `reason` : `state`, `too_many`, `invalid`, `counts`, `max_cards`, `race`, `tags`) |
| `POST /api/session` | `{cookie}` **ou** `{har:{log:{entries:[{request:{url, headers:[{name,value}]}}]}}}` | `{ok:true}` ; extrait l'en-tête `Cookie` d'une requête vers `www.wiki-masters.com` (de préférence `/api/my-collection`), le chiffre et le garde |
| `DELETE /api/session` | | `{ok:true}` |
| `POST /api/refresh` | `{page?, full?, run?}` (0 au départ ; `full:true` = jamais de synchro rapide ; l'interface l'envoie quand `next_full` ; `run` : le jeton rendu par la page 0, à renvoyer avec les suivantes, texte base64url de 64 caractères au plus, sinon `400`) | `{done:false, next_page, run, fetched, total, skipped}` (`next_page` : première page pas encore lue) puis, à la fin, `{done:true, count, new_ids, complete, skipped, removed, kept}` (comme le dernier morceau d'un import ; `quick:true` à la place de `removed`/`kept` si la synchro rapide a suffi) ; `409` si une autre lecture a commencé entre-temps (autre onglet : `run` différent) ou si les pages d'avant manquent ; `401 {error, needs_session:true}` si pas de cookie ou session expirée ; `429 {error}` si le jeu limite les lectures automatiques |
| `POST /api/tags/set` | `{card_id, tags:[…]}` | `{tags}` |
| `POST /api/tags/bulk` | `{card_ids:[…], add:[…], remove:[…]}` | `{ok:true}` |
| `POST /api/tags/rename` | `{from, to}` (fusionne si `to` existe) | `{ok:true}` |
| `GET /api/targets` | | `{targets:[Collection]}` (avec `auto`, l'ajout automatique, `null` sans règle) |
| `POST /api/targets/save` | `{id?, name, items, source?, auto?, auto_skip?, expect_updated_at?, upload?}` | `{target}` : crée, ou remplace celle de cet `id` ; **sans `id` et avec une source `wp:…` ou `links:…`**, remplace la plus ancienne collection qui a déjà cette source (deux onglets, deux appareils ; comparée en entier : `links:<titre>`, `links:<titre>#<colonne>` et `links:<titre>#<colonne>#§<sections>` sont trois sources, et l'interface fait une collection par choix de colonne et de sections d'une page, 2026-10-19 ; l'ancienne source `links` sans « : » n'est pas concernée). **Taille** (2026-10-19, demande de l'utilisateur : plus de limite à 3 000 éléments ni à 600 Ko par création) : aucun nombre d'éléments maximal ; **1,7 Mo** d'éléments en JSON par collection (une ligne de D1 fait 2 Mo au plus, `auto` compris), **600 Ko par envoi** (au-delà, `400` : 3 000 éléments réalistes coûtent déjà ~2 ms de JS, loin des 10 ms) ; une collection plus lourde arrive **en morceaux** : `upload: {id (8 à 64 caractères [A-Za-z0-9_-], tiré par la page), part (0 à 99), last?}`. Un morceau sans `last` ne porte que ses `items` (non vides) : rangé dans `target_uploads` (sans ses crochets), réponse `{part}` ; trois envois en cours au plus par compte (les plus anciens partent), 1,7 Mo au plus chacun, effacés au bout d'une heure. Le dernier (`last: true`) porte le reste du corps et ses éléments (vides permis) : les morceaux 0 à `part - 1` doivent tous être là (sinon `400`, rien d'écrit), la taille de l'ensemble est contrôlée, puis la collection est écrite **en SQL** (`group_concat` des morceaux dans l'ordre : rien n'est relu en JavaScript) et les morceaux effacés, dans une transaction ; la réponse a alors `target.items = null` (la page garde ceux qu'elle a envoyés). **Ajout automatique** (2026-10-18, voir « Ajout automatique » dans « Onglet « Collections » ») : `auto` **absent = inchangé** (règles et exclusions gardées : « Modifier », « Réorganiser », un intercalaire, une fusion… n'ont rien à renvoyer), `null` = effacé (règles et exclusions), `{rules:[{k, v}], skip?}` = règles remplacées (`k` : `gtag` tag du jeu, `cat` catégorie du jeu, `tag` tag du classeur — `v` = le tag, ou `Catégorie/` pour toute une catégorie de tags — ; `v` nettoyé, 1 à 500 caractères ; 20 règles au plus ; doublons repliés, sans la casse pour `gtag` et `cat` ; liste vide = effacé) et exclusions gardées, sauf `skip` donné (liste de 2 000 titres au plus, qui les remplace) ; `auto_skip: {add?:[titre…], del?:[titre…]}` (20 000 titres au plus chacun, 1 à 300 caractères) : titres ajoutés aux exclusions (à la fin, sans doublon) ou retirés, comparés comme la page (première lettre en majuscule, « _ » en espace, apostrophes et guillemets typographiques ramenés à l'ASCII), appliqué après `auto` et **ignoré s'il ne reste pas de règle** ; au-delà de 2 000 exclusions (ou de 200 Ko pour tout `auto`), les plus anciennes sont oubliées (un retrait ne doit jamais échouer pour ça) ; forme invalide : `400`, rien d'écrit. `auto` compte dans les 5 Mo du compte. **`expect_updated_at`** (texte, 40 caractères au plus, seulement avec un `id`, sinon `400`) : enregistrement conditionnel, seulement si la collection rangée a encore ce `updated_at` (dans la même requête SQL que l'écriture) ; sinon `409 {error, conflict:true, target}` où `target` est la collection telle qu'elle est maintenant (`null` si elle a été supprimée : jamais recréée), et rien n'est écrit. L'ajout automatique de la page s'en sert (deux onglets, deux appareils), ainsi que « Arrêter » ; les autres actions de la page ne l'envoient pas (comportement d'avant) |
| `POST /api/targets/delete` | `{id}` | `{ok:true}` |
| `POST /api/targets/from-game` | (clé principale **ou clé d'import**, CORS du jeu ; celle du favori) `{name, query, items:[{title, rarity, card_id, category?, image?}]}` : `query` = la recherche faite dans la Collection globale du jeu (1 à 100 caractères), au moins une carte (600 Ko au plus : un seul envoi), `rarity` ∈ C, PC, R, SR, UR, L (sinon `400`), `card_id` = `card.id` du jeu (texte, sert à écarter une carte lue deux fois, pas gardé) | `{target:{id, name, source, count, created_at, updated_at}}` (sans les éléments) : crée **toujours** une nouvelle collection (un `id` envoyé est ignoré), `source` = `wm:<query>`, éléments `{title, description: category ou null, image, status:'ok', rarity}` (toutes les images retirées si elles font dépasser 600 Ko : la page retrouve les vignettes sur Wikipédia) ; mêmes validations et quotas que `targets/save` |
| `GET /api/members` | (il faut partager soi-même, sinon `403`) | `{members:[{id, name, pseudo, count, fetched_at, targets}]}` (`pseudo` : son pseudo dans le jeu, ou `null`) : les **autres** membres qui partagent, sauf les classeurs vides (ni carte ni collection) ; `id` = identifiant public, `count` = nombre de cartes différentes, `fetched_at` = dernière synchro, `targets` = `null` s'il ne montre pas ses collections à compléter, sinon `{count, updated_at}` (leur nombre et leur dernier changement) |
| `GET /api/members/<id>/cards?part=X` | (`part` comme pour `GET /api/cards`, absent = `0` ; `403` si l'appelant ne partage pas, `404` si ce membre n'existe pas ou ne partage pas, ou plus) | `{member:{id, name, fetched_at}, cards:[{id, title, rarity, count, shiny, image, url, v?}], part, next_part}` : pages de 1 000 cartes, sans étiquettes ; `v` = la cote de la carte telle que rangée dans le cache commun `prices` (`{"<rareté>[*]": {p, n, w, l, d}}`, voir « Le marché »), seulement quand elle en a une (pas pour `{}`, carte lue sans vente) |
| `GET /api/members/<id>/targets?part=X` | (`part` : `0` ou absent, puis le curseur `next_part` ; `403` si l'appelant ne montre pas ses cartes, `404` si ce membre ne montre pas, ou plus, ses cartes **ou** ses collections) | `{member:{id, name}, targets:[{id, name, kind, items:[{title, qid?, sep?}]}], part, next_part}` : ses collections à compléter (toutes, celles faites d'une catégorie de Wikipédia comprises), réduites au nom, à leur nature (`kind` : `category` pour une collection créée depuis une catégorie de Wikipédia, source `wp:…`, sinon `collection`) et, pour chaque élément vérifié (`status` `ok`), au titre, au qid et à `sep: true` pour un intercalaire ; pages d'au plus 512 Ko d'éléments rangés (plus la collection qui franchit ce seuil) |
| `GET /api/chat` | (clé principale ; `?after=<rev>` ou `?before=<id>` facultatifs, entiers ≥ 0, pas les deux, sinon `400`) | sans paramètre : `{messages:[Message], rev, last_id, older}` = les 100 plus récents, du plus ancien au plus récent (`rev` : curseur de la lecture suivante ; `last_id` : numéro du dernier message, supprimé ou non ; `older` : il y en a de plus anciens) ; `?before=<id>` : `{messages, older}` = les 100 d'avant ce message ; `?after=<rev>` : `{messages, deleted:[id…], rev, last_id, more}` = ce qui a changé depuis cette révision (nouveaux messages, numéros des messages supprimés ; `more:true` : plus de 100 changements, `rev` = celle du dernier rendu) ; `{reset:true, rev, last_id}` si la révision est inconnue (base recréée : tout relire). Voir « Chat » |
| `POST /api/chat` | `{text}` (clé principale ; corps de 8 Ko au plus) | `201 {message:Message}` (liens de collection déjà cités) ; `400` texte vide, de plus de 500 caractères ou contenant un lien personnel (`#cle=…`), ou classeur sans prénom ; `429 {error, retry_after}` (secondes) au-delà de 10 messages par minute ou 300 par 24 h pour ce classeur, ou de 1 000 par 24 h pour tout le salon |
| `DELETE /api/chat/<id>` | (clé principale) | `{ok:true}` (aussi s'il l'avait déjà supprimé) ; `403` message d'un autre, `404` message inexistant ou supprimé |
| `GET /api/chat/last` | (sans clé) | `{last_at}` : heure du dernier message d'un membre (`null` sans message), suppressions sautées ; ni texte, ni auteur, ni numéro. Sert au skill « publier » (voir « Nouveautés ») |
| `POST /api/market/plan` | (clé principale **ou clé d'import**, CORS du jeu ; 1 Ko au plus) `{v?, auto?}` : version du favori (`[A-Za-z0-9._-]`, 20 au plus, sinon ignorée), lecture automatique du mode relié (`true`) ou au clic ; corps vide accepté (favori d'avant le 2026-10-17) | `{cards:[card_id…], stale, fresh, wanted:[titre…], ids:{titre: card_id \| ""}, quota}` : cartes à coter (les tiennes, puis les cartes voulues dont le card_id est connu ; cote absente puis la plus ancienne d'abord, plus de 12 h ; 3 000 au plus), `stale`/`fresh` = à coter / cotées depuis moins de 12 h, `wanted` = titres des cartes qui manquent à tes collections (500 au plus), `ids` = ce que ton favori en a trouvé, `quota` = cotes encore acceptées aujourd'hui ; l'essai est noté (`market.attempt` = `{start, v, auto}`). `auto:true` moins de 5 min après le début du précédent essai de ce classeur (d'où qu'il vienne) : `{skip:true, until}` seulement, rien de lu ni d'écrit. Voir « Le marché » |
| `POST /api/market/prices` | (clé principale **ou clé d'import**, CORS du jeu ; 512 Ko au plus) `{prices:[{id, v:{"<rareté>[*]": {p, n, w, l, d}}}], last?}` : 500 au plus, tout l'envoi refusé (`400`) sur une forme invalide | `{written, quota}` ; `429 {error, quota}` au-delà du quota du jour (rien d'écrit) ; `last:true` : la valeur du jour de ce classeur est recalculée et son essai noté fini (`end`, `ok:true`, raison effacée) |
| `POST /api/market/live` | (clé principale **ou clé d'import**, CORS du jeu ; 320 Ko au plus) `{ids?, deals?, bids?, sales?}` (`deals[].more` : autres enchères intéressantes sur la même carte, entier ≥ 0, 0 s'il manque) | `{ok:true, known}` : remplace la lecture du marché de ce classeur (256 Ko au plus, `413` au-delà ; gardée 7 jours) et ajoute les titres trouvés à `ids` (2 000 au plus) |
| `POST /api/market/fail` | (clé principale **ou clé d'import**, CORS du jeu ; 2 Ko au plus) `{why, v?, auto?}` : `why` = le message d'échec montré par le favori (texte nettoyé, 1 à 300 caractères, sinon `400` ; un morceau qui ressemble à un jeton JWT est remplacé par « [jeton masqué] ») | `{ok:true}` : l'essai de ce classeur est noté raté (`end`, `ok:false`, `why`, `v`, `auto`), montré par la page |
| `GET /api/market` | (clé principale) | `{value:{value, priced, cards, approx}, history:[{date, value, priced, cards}], live:{deals, bids, sales} \| null, live_at, attempt:{start, end?, ok?, why?, v, auto} \| null}` : valeur calculée maintenant (le point du jour mis à jour s'il a changé), 400 jours d'historique au plus, lecture du marché de moins de 7 jours, dernier essai du favori (`null` : jamais) |
| `GET /api/market/prices?part=X` | (clé principale ; `part` comme pour `GET /api/cards`) | `{prices:[{id, v, at, t?}], part, next_part}` : cotes de tes cartes et des cartes voulues dont le card_id est connu (`t` : leur titre dans tes collections), pages de 1 000 |
| `GET /api/sync-log` | (clé principale seulement) | `{entries:[{at, kind, result, message, data}]}` : les 50 dernières synchros au plus, de la plus récente à la plus ancienne, voir « Journal des synchros » |
| `POST /api/sync-log` | (clé principale **ou clé d'import**, CORS du jeu ; 2 Ko au plus, sinon `413`) `{message, kind?, via?, code?, reason?, ms?, read?, total?, v?}` : `message` non vide (sinon `400`), 300 caractères gardés ; `kind` `full` ou `quick` (autre valeur : `400`) ; `ms`, `read`, `total` entiers ≥ 0 (sinon `400`) ; `code` inconnu : `other` ; `via` autre que `clic`, `relie`, `script` : `clic` | `{ok:true}` : un échec vu par le favori lui-même, noté au journal (`result:'error'`, `data.client:true`) ; `429 {error}` au-delà de 30 signalements par heure pour ce classeur |

**Message** (chat) : `{id, author, mine, text, created_at, refs?}` : `id` = numéro (croissant, jamais réutilisé), `author` = nom
**actuel** du classeur de l'auteur (`null` sans prénom), `mine` = c'est le tien, `text` = texte brut. Jamais l'id interne
du compte. `refs` (seulement s'il cite des collections) : le nom de chacune est en clair dans `text`, à la place
`{at, len}` (unités UTF-16) ; `{at, len, name, owner, mine, pid, id}` ou `{at, len, gone:true}`, voir « Chat »,
collections citées.

**Collection à compléter** : `{id, name, items:[{title, description, image, status, qid?, rarity?, sep?}], source, auto, created_at,
updated_at}` (`auto` : l'ajout automatique, `{rules:[{k, v}], skip:[titre…]}` ou `null`, voir `targets/save` et « Ajout
automatique » ; colonne `targets.auto`, jamais montrée aux autres membres) ; `qid` (facultatif, identifiant Wikidata `Q…`) permet de reconnaître une carte possédée même si son titre
diffère (renommage, redirection, homonymie) : l'interface rapproche d'abord par titre, puis par qid
(`site/public/assets/match.js`, qids des cartes résolus dans le navigateur et gardés en cache), `status` = `ok` | `missing` (article introuvable) | `disambiguation` (page d'homonymie). Les `items` sont
vérifiés **par l'interface** sur Wikipédia avant l'envoi ; le serveur ne fait que les ranger (1,7 Mo d'éléments au plus,
50 collections par utilisateur). `source` = `catalog:<id>` pour une collection ajoutée jadis depuis le catalogue
(retiré le 2026-10-16 ; elle reste une collection comme les autres), `wp:<nom de la catégorie>` pour une collection
**créée depuis une catégorie de Wikipédia** (« Créer une collection » dans l'album de la catégorie, ou sur une
proposition de `site/public/assets/propose.js` : catégories des cartes de l'utilisateur dont il possède au moins 5 % et
2 cartes, hors catégories de rangement et de temps ; nom sans « Catégorie: », première lettre en majuscule ; une seule
par catégorie et par compte, voir `targets/save`), `links:<titre de la page>` pour une collection **créée depuis les
liens d'une page de Wikipédia** (« Créer une collection » dans l'album de la page ; titre tel que Wikipédia l'écrit,
redirection suivie, avec ses espaces ; éléments avec leur `qid` et leur description Wikidata ; une seule par page et par
compte, voir `targets/save`), `links:<titre de la page>#<colonne>` (et `…#§<sections>` pour une partie de ses
tableaux, voir « Colonne clé des tableaux d'une page ») pour une collection **créée depuis la colonne clé des
tableaux d'une page** (libellé court de la colonne, « Nom » ; un titre de Wikipédia ne contient jamais « # » ; source
coupée à 200 caractères ; éléments dans l'ordre des lignes, avec `qid` et description ; l'interface la compte comme LA
collection de cette page), `wd` ou `cat` quand
elle vient de la recherche par mots-clés (requête Wikidata ou catégorie de Wikipédia), `wm:<recherche>` quand le favori
l'a créée depuis une recherche de la Collection globale du jeu (`POST /api/targets/from-game`, titres = `wikipedia_title`
du jeu, non revérifiés sur Wikipédia). `rarity` (facultatif, C | PC | R | SR | UR | L, gardé seulement s'il est connu,
aussi par `targets/save` pour qu'une collection modifiée dans la page le garde) = rareté de la carte **dans le jeu**,
relevée par le favori : l'interface l'affiche sans « ≈ » (case vide, fiche de la carte manquante, « Il t'en manque »)
au lieu de la rareté estimée d'après les vues de l'article, qui reste pour les éléments sans `rarity`. `sep` (facultatif,
2026-10-17) : `true` pour un **intercalaire**, un élément qui ouvre une section de la collection (« Sous-continent »
dans « Continents et Sous-continents ») ; c'est une carte comme les autres (elle se possède, compte dans la progression,
la valeur, les échanges). Gardé par `targets/save` seulement s'il vaut exactement `true`, absent sinon (`false`, `"true"`,
`1`… : ignorés) ; montré aux amis avec le titre et le qid (voir « Partage entre membres ») ; affichage : « Onglet
« Collections » », « Intercalaires et collections complètes ».

**CarteImport** (ce qu'envoie le favori, déjà regroupée par carte) : la Carte ci-dessus **sans `tags`**. Le favori
regroupe les exemplaires et ne garde que ces champs : le serveur n'a presque rien à calculer. `gtags` (tableau, **même
vide**) dit que les tags du jeu de la carte ont été lus (favori de version 3, 18 octobre 2026) ; absent (favori plus
ancien, ou autre chose qu'un tableau) : pas lus, ceux du classeur sont gardés tels quels, même par une lecture vérifiée.
`gtagc` : objet nom → couleur, seules les couleurs valides des noms gardés restent.

**Limite de calcul des Workers gratuits (10 ms de CPU par requête)** : aucune requête ne doit traiter plus de
~500 cartes en JavaScript. (Depuis le 2026-10-17, le classeur tourne sur l'abonnement payant des Workers : plus de limite
de 10 ms ni de quota gratuit de lectures. La règle reste : elle ne coûte rien et garde les requêtes courtes. Avant, un
gros classeur pouvait voir sa finalisation coupée net, en « erreur 503 » pour le favori.) Les morceaux d'un import vont dans une table d'attente ; au dernier morceau, la
comparaison avec la collection en place (ajouts, retraits, modifications, `new_ids`) se fait **en SQL dans D1**
(`json_each`, `INSERT … SELECT`, `DELETE … WHERE NOT IN`), pas en JavaScript. Même règle pour `/api/refresh` :
10 pages au plus par appel.

**Import et nouveautés** : une lecture complète (favori ou rafraîchissement) **vérifiée** remplace la collection ; on
n'écrit que les différences (cartes ajoutées, retirées, modifiées). Une lecture **non vérifiée** ajoute les cartes
absentes du classeur, ne retire rien, et ne reprend sur les cartes déjà là que leurs **champs de carte du jeu** (voir
« Synchros sûres »). `new_ids` = cartes présentes après mais
pas avant ; **vide au tout premier import**. Les étiquettes d'une carte qui disparaît sont gardées (elle peut revenir).

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
  pagination instable, collection qui a bougé pendant la lecture…) le classeur ajoute les cartes absentes, ne retire
  rien et ne reprend que les champs de carte du jeu des autres (voir « Synchros sûres »), et `full_at` reste vide : la
  synchro suivante relit tout.
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
- **Lecture commencée trop tôt** : avec `started` (heure `now` rendue par `state`), une synchro rapide partie avant la
  lecture dont le classeur vient (`read_at`) répond `superseded:true`, rien d'écrit (voir « Synchros sûres »).
- **Rareté** : une carte possédée en plusieurs raretés garde la plus haute (C < PC < R < SR < UR < L), à l'import
  complet comme en synchro rapide et dans le favori.
- **Champs de carte du jeu** (2026-10-18) : un nouvel exemplaire d'une carte déjà là lui redonne ses champs de carte du
  jeu, lus à l'instant (`title`, `atk`, `def`, `quality`, `pageviews`, `category`, `image`, `url` : les mêmes dans tous
  ses exemplaires) ; ses exemplaires, brillance, favori, rareté et date sont additionnés comme avant ; ses **tags du jeu**
  (propres à chaque exemplaire) sont réunis avec ceux du nouvel exemplaire, jamais retirés.
- **Tags du jeu** (2026-10-18) : un tag posé ou retiré dans le jeu ne crée aucun exemplaire, la synchro rapide ne le
  verrait pas. Chaque lecture complète d'un client qui lit les tags (favori de version 3, rafraîchissement par cookie)
  garde dans `sync_state.tsig` une signature de `tagOptions` (stats du jeu ; `cards.js` `tagSig` : FNV-1a des éléments,
  ou des clés, triés : l'ordre ne compte pas ; `''` sans `tagOptions`) ; une lecture qui ne lit pas les tags (favori
  plus ancien) garde celle d'avant. Une synchro rapide d'un tel client dont la signature diffère (tag créé, renommé,
  recoloré ou supprimé dans le jeu ; ou tags jamais lus encore : la première synchro du nouveau favori relit donc tout)
  répond `{needs_full:true, reason:'tags'}` (favori : « Tags du jeu changés ou pas encore lus : relecture complète »).
  Favori relié : une écriture de la page vers la base Supabase du jeu dont l'adresse contient « tags » (étiquettes :
  `user_card_tags`, `tags`), ou vers une adresse du jeu finissant par « tag(s) » ou contenant « /tags/ » (chemins
  **supposés** : aucun relevé), est vue comme un tag posé ou retiré (« tag du jeu modifié ») et la synchro qui suit est
  une relecture complète (dans la limite d'une automatique par quart d'heure ; voir le tableau du favori relié).
- **Angles morts** (ce que les compteurs ne montrent pas) : échange 1 contre 1 de deux cartes de **même rareté** quand
  la carte reçue est datée d'avant `last_at` et que la carte donnée n'était pas la plus récente ; carte retirée des
  favoris (`starred`) ou devenue brillante sans nouvelle ligne ; si `total` compte les lignes et qu'aucune pile
  n'existait à la dernière lecture complète (`both`), un exemplaire ajouté à une ligne existante sans changer sa date ;
  catégorie du jeu (ou image, vues…) changée par le jeu sur une carte qui n'a pas reçu d'exemplaire (vue à la lecture
  complète suivante, vérifiée ou non) ; tag du jeu **existant** posé sur une carte ou retiré, quand `tagOptions` ne
  change pas (s'il ne compte pas les cartes de chaque tag) et que le favori relié ne l'a pas vu (autre onglet ou appareil
  non relié, adresse d'écriture que le favori ne reconnaît pas). Remèdes : lecture complète forcée au moins une fois par semaine, et **« La
  prochaine mise à jour relira toute ta collection »** (onglet « Mettre à jour », `PATCH /api/me {force_full:true}`,
  clé principale : `full_at` effacé ; `GET /api/me` renvoie alors `next_full:true` et l'interface envoie `full:true` à
  `/api/refresh`).

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
automatiques : réessaie plus tard », session intacte, et pas de lecture complète derrière. La page 0 tire un **jeton de
lecture** (`run`, gardé dans la page -1 de la table d'attente avec les compteurs et l'heure du début) que l'interface
renvoie avec les pages suivantes : si une autre lecture a commencé entre-temps (un second onglet qui clique
« Rafraîchir »), la première s'arrête en `409` (« Une autre mise à jour a commencé entre-temps (dans un autre onglet ?) :
celle-ci s'arrête, sans rien changer à ton classeur ») au lieu de mélanger leurs pages ; un ancien client sans jeton n'est
pas contrôlé. Une lecture faite en plusieurs appels relit les compteurs du jeu à la fin (une requête de plus) : s'ils ont
changé, elle ne retire rien. Chaque fin de lecture, réussie ou non, laisse une ligne au journal (`via:'cookie'`).

**Limite du cookie collé** : la session du jeu (Supabase) renouvelle son jeton. Si le serveur la renouvelle, le
navigateur du joueur garde l'ancien jeton : le jeu peut le déconnecter, et le rafraîchissement par cookie ne marche
en général qu'environ une heure après le collage. Le favori est donc le chemin principal ; le cookie est un secours. Pause de 250 ms entre deux pages. En-têtes envoyés au jeu : `Cookie`,
`Accept: application/json`, `User-Agent` d'un navigateur courant n'est PAS imité (on garde celui de la plateforme). Un
`Set-Cookie` dans une réponse du jeu met à jour le cookie stocké. 401/403 du jeu (hors limite de lectures
automatiques) → session marquée expirée, `401 {needs_session:true}`.

**Synchros sûres** (2026-10-17, « pas mal de problèmes de synchro ») :

- **Une lecture incomplète n'efface jamais de cartes.** Avant, toute lecture complète remplaçait la collection, même
  quand ses cartes ne collaient pas avec les compteurs du jeu : une page vide passagère, une pagination qui bouge, une
  défausse pendant la lecture pouvaient retirer des centaines de cartes (revenues à la lecture suivante, étiquettes
  gardées, mais marquées « nouvelles »). Maintenant une lecture n'est **vérifiée** que si cartes rangées + cartes
  invalides distinctes = `totalUnique` du jeu, **et** que les compteurs relus après la dernière page (`stats_end`) sont
  ceux d'avant (`total`, `totalUnique`). Vérifiée : la collection est remplacée (cartes retirées comprises, `removed`).
  Sinon (`complete:false`, `moved:true`, ou compteurs absents : `complete:null`) : les cartes absentes du classeur sont
  ajoutées, aucune carte n'est retirée (`kept` = cartes du classeur non vues), la synchro rapide n'est pas armée et la
  suivante relit tout ; le journal et les messages le disent (« Lecture incomplète : 3 650 cartes lues, le jeu en compte
  3 702 : aucune nouvelle carte, 12 cartes déjà là mises à jour (catégorie du jeu, image, vues…), aucune carte retirée
  (52 cartes non vues, gardées). Relance la mise à jour dans un moment. »). **Cartes déjà là** (2026-10-18, « pas bien
  synchronisés ») : seuls leurs **champs de carte du jeu** sont repris de la lecture (`title`, `atk`, `def`, `quality`,
  `pageviews`, `category`, `image`, `url` : propres à la carte, les mêmes dans chacun de ses exemplaires), et seulement
  s'ils ont changé (la carte prend alors la révision suivante) ; leurs **tags du jeu** lus sont réunis avec ceux du
  classeur (jamais retirés : un exemplaire non vu peut porter les autres ; couleurs de la lecture d'abord) ; jamais
  `count`, `variants`, `rarity`, `shiny`, `starred` ni `obtained_at`, qui dépendent des exemplaires lus (une partie a pu
  manquer). Une lecture **vérifiée** qui a lu les tags du jeu (`gtags` en tableau) les remplace ; qui ne les a pas lus
  (favori plus ancien), elle garde ceux du classeur. Avant, une lecture non vérifiée ne
  modifiait rien : la catégorie du jeu, l'image ou les vues d'une carte déjà là n'étaient relues que par une lecture
  vérifiée ; un joueur dont les lectures restaient non vérifiées gardait des catégories anciennes. Si les compteurs du
  jeu différaient toujours un peu de ce que lit le favori pour un joueur, ses cartes parties ne seraient jamais
  retirées : le journal le montrerait (même écart à chaque lecture).
- **Deux synchros en même temps** (deux onglets, favori relié et clic, favori et rafraîchissement) : chaque envoi garde
  ses morceaux (trois envois en cours au plus par classeur ; un quatrième abandonne le plus ancien, dont le dernier
  morceau répond `409` et qui est effacé). Avant, un nouvel envoi effaçait celui en cours, et deux envois croisés
  échouaient tous deux en « Import incomplet ». **Fraîcheur** : `sync_state.read_at` = début de la lecture dont le
  classeur vient (lecture vérifiée ou synchro rapide, heure du serveur : `now` de `state` renvoyé en `started`, ou la
  page 0 du rafraîchissement) ; une lecture commencée avant n'est jamais appliquée par-dessus (`superseded:true`, rien
  d'écrit, « Une synchro plus récente … est déjà passée : ton classeur est à jour »), contrôlé dans la transaction même
  (l'état n'est remplacé que si `read_at` le permet, les cartes ne sont écrites que s'il l'a été). Sans `started` (ancien
  favori) : pas de contrôle, comme avant ; `started` à venir (plus d'une minute) ou de plus de 2 h : ignoré. Une lecture
  non vérifiée ne fait pas avancer `read_at`.
- **Dernier morceau renvoyé** (réponse perdue, nouvel essai du favori) : `sync_state.up` = `upload_id` du dernier envoi
  appliqué ; le même dernier morceau rend le même résultat (`again:true`), rien de plus d'écrit. Refus définitif à la
  finalisation (collection vide ou trop grande) : l'envoi est effacé ; erreur passagère de la base : ses morceaux restent.
- `sync_state` garde aussi `complete` (résultat du contrôle de la dernière lecture complète), `read_at` et `up`.

**Journal des synchros** (`sync_log`, `functions/_lib/synclog.js`) : une ligne par synchro, réussie ou non, pour
diagnostiquer la suivante. `kind` = `full` (lecture complète) | `quick` (synchro rapide) ; `result` = `ok` | `warn`
(lecture non vérifiée : rien retiré) | `error` ; `message` = texte lisible, celui que voit le joueur (« Lecture complète
(les compteurs du jeu ne collaient pas avec les nouveautés) : 1 043 cartes, 2 nouvelles, 1 retirée. », « Synchro
rapide : rien de nouveau (1 043 cartes). », le message d'erreur rendu…) ; `data` = `via` (`clic`, `relie`, `script`,
`cookie` ; absent : favori d'avant le journal), `v` (version du favori), nombres (`count`, `fresh`, `removed`, `kept`,
`updated` (lecture non vérifiée : cartes déjà là dont les champs de carte du jeu ont été repris ou qui ont reçu un tag du
jeu), `read`, `unique`, `total`, `invalid`, `skipped`, `copies`), `gtags_odd` (forme de tags du jeu que le favori n'a
pas reconnue : type, ou noms de clés d'un objet, jamais de valeur, « {id,color} » ; gardée si elle n'a que des lettres,
chiffres, espaces et `{}[](),:._-`, 120 caractères au plus, sinon « autre » ; le message ajoute « Tags du jeu dans un
format inconnu (…) : ils n'ont pas été lus. » ; signalée dans la ligne de la synchro elle-même plutôt que par
`POST /api/sync-log`, qui la marquerait « échec » et ferait dire « Dernière synchro en échec » à la page), `complete`, `moved`, `superseded`, `reason` (pourquoi une
lecture complète), `ms` (durée depuis le début de la synchro), `status` (erreur HTTP rendue), et pour un signalement du
favori `client:true`, `code` (`session`, `limit`, `antibot`, `game`, `network`, `timeout`, `format`, `other`), `read`,
`total`.
- **Écrit par le serveur** : fin de chaque import du favori (lecture complète appliquée, non vérifiée ou remplacée),
  chaque synchro rapide réussie, chaque fin de rafraîchissement par cookie, et **chaque échec** de ces routes (refus,
  morceaux manquants, erreur interne : « Erreur interne du serveur (…) » avec un extrait de l'erreur, visible du seul
  titulaire). Une synchro rapide refusée (`needs_full`) n'est pas notée : la relecture complète qui suit porte sa raison
  (`reason`). Le journal ne fait jamais échouer une synchro (une écriture ratée est seulement notée dans les journaux du
  Worker).
- **Signalé par le favori** (`POST /api/sync-log`, clé d'import) : ses échecs avant ou pendant sa lecture du jeu, quand
  rien n'a pu être envoyé (session du jeu expirée, limite de lectures, protection anti-robots, erreur ou délai du jeu,
  réponse inattendue). Il n'envoie que le message affiché dans son encart et quelques nombres, **jamais de jeton ni de
  cookie du jeu** ; par précaution, le serveur masque dans le message tout ce qui ressemble à un secret (jeton JWT,
  « #cle=… », suite base64 de 32 caractères ou plus). 30 signalements par heure et par classeur au plus.
- **Borné** : une ligne identique à la précédente (même `kind`, `result`, `message`, `via` : « rien de nouveau » toutes
  les minutes en mode relié, même échec répété) ne fait que mettre à jour son heure (`data.repeat`, `data.first`) ; les
  50 plus récentes par classeur, 30 jours au plus (élagage à chaque écriture, par l'index `(user_id, id)`). Effacé avec
  le classeur. `users.last_sync` = résumé de la dernière ligne, rendu par `GET /api/me` (aucune requête de plus).
- **Lu par la page** (onglet « Mettre à jour », panneau « Dernières synchros ») : les 20 plus récentes, chacune avec son
  résultat (« réussie », « incomplète », « échec », en couleur), son chemin et son type (« Favori relié · synchro
  rapide », « Cookie · lecture complète », « Favori » pour un favori d'avant le journal), son heure (« aujourd'hui à
  14:32 », « 3 fois depuis… » pour une ligne répétée) et son message ; lu à l'ouverture de l'onglet, après un
  rafraîchissement par cookie, quand `last_sync` change et sur « Actualiser » ; ancien serveur (`404`) : rien. Si la
  dernière synchro (réussie, incomplète, ou échec signalé) d'un favori ou d'un script n'a pas de version, ou une plus
  ancienne que celle du favori servi (`var VERSION` de `bookmarklet.js`, lue par la page) : « Ta dernière synchro vient
  d'un favori d'avant le 18 octobre 2026 : glisse le nouveau favori … Le nouveau lit aussi les tags que tu poses sur
  tes cartes dans le jeu … » (version 3 le 18 octobre : tags du jeu ; 2 le 17). Sous le résumé des cartes, tant que rien d'autre
  n'y est affiché : « Dernière synchro en échec (Favori · lecture complète, aujourd'hui à 14:32) : <message> » (ou
  « incomplète »), avec « Dernières synchros » qui ouvre l'onglet ; un nouvel échec du favori (`last_sync` relu par
  `GET /api/me`) est annoncé (« La dernière synchro du favori a échoué : … »), et dans la fenêtre « Mettre à jour avec le
  favori » (« Le favori a signalé un échec : … ») ; un envoi incomplet y ajoute le message du journal.

**CORS** : seuls `POST /api/import`, `POST /api/targets/from-game`, `POST /api/market/plan`, `/prices`, `/live`, `/fail` et
`POST /api/sync-log` (et leur `OPTIONS`), les routes du favori, acceptent les origines `https://www.wiki-masters.com` et `https://wiki-masters.com`
(`Access-Control-Allow-Headers: content-type, x-classeur-key`). Le reste est même origine.

**Limites et quotas** (D1 gratuit : 500 Mo, 100 000 lignes écrites par jour, partagés par tous) : `MAX_USERS` comptes
(variable, 50 par défaut) ; 20 000 cartes par utilisateur ; étiquette = texte nettoyé, 60 caractères au plus (2 niveaux au plus dans le nom :
« Catégorie/Sous-catégorie », catégories larges : Pays, Métiers, Lieux, Culture et œuvres, Sciences et nature, Histoire
et événements, Organisations, Autres), 30 par carte, 50 000 par compte, 5 000 couples carte×étiquette par appel `tags/bulk` ; collections à compléter : 50 par
compte, sans nombre d'éléments maximal, 1,7 Mo chacune (600 Ko par envoi, en morceaux au-delà), 5 Mo au total ; import : 500 cartes et 40 morceaux par envoi, 8 Mo en attente, trois envois en
cours au plus par classeur ; journal des synchros : 50 lignes et 30 jours par classeur, 30 signalements du favori par
heure, 2 Ko par signalement ; corps JSON
de 5 Mo au plus (4 Ko pour `/api/account`). Entrées du jeu invalides (sans titre, rareté inconnue, champs trop
longs ; une catégorie du jeu de plus de 500 caractères n'en fait plus une : elle est coupée à 500, par le favori comme
par le serveur, et la carte est rangée, 2026-10-18) : ignorées pareil par le favori et le rafraîchissement, comptées
dans `skipped`, et comptées comme cartes distinctes (quand elles ont un identifiant de carte) pour dire si une lecture
est complète. Quota ou base pleine : `503` avec un message lisible. Marché : 15 000 cotes par classeur et par jour, 150 000 pour tout le site (`429`), voir
« Le marché » (abonnement payant Workers depuis le 2026-10-17 : 50 millions de lignes écrites par mois comprises).

## Partage entre membres

Les membres du classeur (l'utilisateur et ses amis) peuvent se montrer leurs cartes, pour voir qui a celles qui
manquent à leurs collections. **Activé par défaut** (2026-10-16, demande de l'administrateur : un nouveau classeur
partage ses cartes et ses collections dès sa création ; les classeurs existants l'ont reçu une fois, par la migration
`partage-par-defaut-2026-10-16` de db.js, qui ne repasse jamais), chacun peut le couper, **et il est réciproque** : on
ne voit les cartes des autres que si l'on montre les siennes (Réglages, « Montrer mes cartes aux autres membres du classeur », ou le bouton de
l'onglet « Entre amis » ; `PATCH /api/me {shared:true|false}`, clé principale seulement).

- **Ce qui est montré** : le prénom (nom du classeur), le nombre de cartes, la date de la dernière synchro, et pour
  chaque carte `id, title, rarity, count` (exemplaires), `shiny, image, url`, plus sa cote `v` (2026-10-16 : des ventes du
  jeu, communes à tous, liées à aucun joueur ; de quoi calculer la valeur de son classeur dans la page). **Jamais** le
  détail de ses exemplaires (`variants`), les étiquettes, les
  préférences, les clés (principale ou d'import), le cookie du jeu, ni l'id interne du compte ; les collections à
  compléter seulement avec le second réglage ci-dessous. Le serveur n'a pas de qid des cartes (ils sont résolus dans le
  navigateur) : il n'en montre pas.
- **Collections à compléter : second réglage, à part** (Réglages, « et mes collections à compléter », sous le premier et
  seulement quand il est coché ; `PATCH /api/me {shared_targets:true|false}` ; `users.shared_targets` 0/1, désactivé par
  défaut). Il n'existe qu'avec le partage des cartes : `400` sans lui, et couper le partage des cartes le coupe aussi (à
  rechoisir). Ce qui est montré, aux membres qui montrent leurs cartes : toutes ses collections à compléter (ses
  collections, y compris celles faites d'une catégorie ; pas les propositions), leur nom, leur nature (`kind` :
  `category` pour une collection faite d'une catégorie de Wikipédia, `collection` sinon) et, pour chaque élément vérifié, son titre, son qid et s'il est un intercalaire (`sep: true`). **Jamais** leurs descriptions,
  images, statuts, leur source (recherche tapée, nom de la catégorie, id du catalogue), leurs dates ni leur ajout
  automatique (règles et titres exclus : `targets.auto`) ; les éléments
  introuvables ou d'homonymie sont omis (aucune carte ne peut les remplir). `GET /api/members` dit seulement leur nombre
  et la date du dernier changement.
- **Identifiant public** (`users.public_id`) : un membre est désigné par un identifiant aléatoire, tiré à chaque
  activation du partage et effacé à sa désactivation (un ancien identifiant mène alors à `404`) ; l'id interne du compte
  sert aussi de clé du cache des cartes dans le navigateur et n'est jamais montré aux autres. `users.shared` (0/1) dit
  si le membre partage. `DELETE /api/me` efface le compte : il disparaît aussitôt de la liste.
- **Coût** : `GET /api/members` = une requête (au plus `MAX_USERS` lignes, nombre de cartes compté par la clé primaire
  `(user_id, card_id)`). `GET /api/members/<id>/cards` = le membre (index unique `users_by_public_id`) et une page de
  1 000 cartes par clé (`card_id > curseur`), réduites en SQL aux champs montrés (liste blanche, `json_object`), et leur
  cote lue par la clé primaire de `prices` (`LEFT JOIN`), dans la même transaction ; les étiquettes ne sont jamais lues
  (une page de 1 000 cartes toutes cotées : ~300 Ko, < 1 ms de JavaScript, `v` collé au texte JSON de la carte). Aucun JavaScript proportionnel à la taille de la collection.
  `GET /api/members/<id>/targets` = le membre et une page de collections par la clé primaire `(user_id, id)` (`id >
  curseur`) : une somme cumulée (`SUM … OVER`) de leur taille rangée garde celles qui commencent sous 512 Ko (la première
  toujours), chacune réduite en SQL (`json_each`, `json_group_array`) au nom, au titre, au qid et au drapeau `sep` ; une réponse reste sous
  ~2 Mo (une collection fait 1,7 Mo rangés au plus), même pour un compte à 5 Mo de collections.
- **Interface** (onglet « Entre amis ») : liste des membres qui partagent (avec « partage ses collections : N » ou « ne
  partage pas ses collections ») ; « Échanges possibles »
  (résumé, puis sa page, ci-dessous) ; « Pour compléter tes collections » = pour chaque collection, les cases vides qu'au moins un ami peut remplir, avec qui les a et en combien d'exemplaires (en
  double d'abord : les plus faciles à échanger), les collections où les amis remplissent le plus de cases d'abord ;
  « Ce qui pourrait intéresser tes amis » = tes cartes (tes doubles d'abord) qui remplissent une case vide des
  collections qu'ils montrent, résumé par leurs noms (« 3 de tes cartes complètent « A », « B » et « C » · 2 que tu as en
  double », les plus complétées d'abord ; au-delà de trois, « … et 2 autres ») ; le résumé de l'onglet nomme de même les
  amis et tes collections les plus concernés (« 4 de tes cartes peuvent compléter les collections de Paul ; 6 de leurs
  cartes peuvent compléter « Planètes » et « Couleurs ». ») ; **rien pour un ami qui ne les montre pas** (« Rien pour Léa, qui ne partage pas ses
  collections » ; plus d'estimation par le catalogue) ; classeur d'un ami en lecture seule (filtre « Me manquent »,
  recherche, tri, et « Ses collections », ci-dessous). Dans un album, une case vide qu'un ami
  peut remplir porte un badge (« chez Paul ×2 », « +1 » s'il y en a d'autres) ; sa fiche dit « Chez : Paul (×2), Léa ».
  Rapprochement carte ↔ élément comme pour les tiennes : titre, puis qid (`match.js` ; les titres des cartes des amis que
  tu n'as pas, et ceux des éléments sans qid des collections qu'ils montrent et qui leur manquent — 2 000 au plus par
  lecture —, sont résolus dans le même cache).
- **« Ses collections »** (classeur d'un ami, avant ses cartes) : s'il les partage, toutes ses collections dans une seule
  liste, de A à Z (le serveur les rend dans l'ordre de leurs ids), celles tirées d'une catégorie de Wikipédia (`kind:
  'category'`) signalées discrètement (« depuis la catégorie Wikipédia »), chacune
  comme une ligne de tes collections (éventail de ses cartes, « 12 sur 40 », barre des raretés, %), progression calculée
  avec **ses** cartes (titre puis qid), et « Tu peux l'aider : 4, dont 3 en double » (ses cases vides que tes cartes
  remplissent) ; sinon une phrase : « Léa ne partage pas ses collections. ». Une ligne ouvre l'**album de sa collection**,
  en lecture seule, avec l'allure des tiens : ses cartes (« Tu l'as », estompée, ou « Te manque » ; mise en avant, avec
  sous la carte les noms de tes collections, si elle remplirait une de leurs cases vides) et ses cases vides (« tu l'as »,
  « ×2 en double » si ta carte la remplit : celles que tu pourrais lui donner ; rareté de ta carte, sinon estimée d'après
  les vues) ; ses intercalaires et sa collection complète comme les tiens (cadre, sections, tour doré : voir « Intercalaires
  et collections complètes ») ; numéros, sauf pour une collection tirée d'une catégorie (A → Z) ; « Il lui en manque N », « Tu peux l'aider : N cartes
  dont M en double » ; filtres « Toutes / Il les a / Lui manquent / Tu peux l'aider », tris par rareté et par prix
  (« Prix ↑ », « Prix ↓ », voir « Le marché ») ; « ← Retour au
  classeur de Paul » (et « ← Échanges possibles », filtre gardé, quand on vient de là). Une carte ou une case ouvre une
  fiche en lecture seule (qui l'a, rareté, vues, ses autres collections et les tiennes où elle figure, « Copier le nom »,
  Wikipédia), sans tags ni sélection. Rien ne modifie sa collection ; « Créer la même collection chez moi » en fait une
  **à toi** (`POST /api/targets/save {name, items}` : même nom, ses articles tels qu'il les montre, titre, qid et
  intercalaires, `status: 'ok'`, sans source ni requête à Wikipédia : une liste d'articles, sans lien avec la sienne ensuite), puis « Ouvrir ma
  collection » (une des tiennes de même nom, sans source et d'autant d'articles compte comme cette copie : pas de
  doublon d'une visite à l'autre). Vues sur 30 jours
  (et vignettes) demandées seulement pour les cases que ni lui ni toi n'avez, dans la même file et le même cache que tes
  albums. Dans « Échanges possibles » et « Ce qui pourrait intéresser tes amis », le nom d'une collection d'un ami ouvre
  son album (ta carte reste un bouton à part : jamais un bouton dans un autre).
- **Page « Échanges possibles »** (sous-page de l'onglet) : « telle carte de X pourrait compléter telle collection de
  Z », X et Z parmi toi et les amis dont les cartes sont lues (X ≠ Z). Collections de Z : les tiennes comme dans « Pour
  compléter tes collections » ; celles qu'un ami montre ; aucune pour un ami qui ne les montre pas (on ne sait pas ce
  qui lui manque : « Léa ne partage pas ses collections : impossible de savoir ce qui lui manque », ses cartes comptent
  quand même pour les autres). Une ligne par carte et par couple : rareté, titre, « ×n » si X l'a en double, puis les
  collections de Z qu'elle complète (un même article dans deux
  collections de Z : une seule ligne). Groupées par couple « X → Z » avec « Paul peut compléter 5 cases chez Léa, dont 3
  en double » ; ordre : les couples qui ont le plus de doubles, puis le plus de cases (toi d'abord à égalité) ; dans un couple, les doubles d'abord (les
  plus faciles à donner), puis les cartes qui remplissent le plus de collections, puis la rareté. Filtres : « Tout le
  monde » (par défaut : peu d'échanges pour l'instant, demande de l'utilisateur du 2026-10-16), « Ce qui me concerne » (tu
  donnes ou tu reçois), ou un membre (il donne ou il reçoit). Une ligne de
  ta carte ouvre sa fiche ; une ligne pour toi ouvre la fiche de la case vide ; entre deux amis, rien à ouvrir (sauf,
  comme sur toute ligne pour un ami, le nom de ses collections : son album). Calcul
  dans le navigateur (`trades`, propriété calculée : refait quand les cartes, les collections ou les qids changent ;
  ~120 ms pour 6 personnes de 5 000 cartes et 30 000 éléments de collection), filtre à part.
- **Chargement** : à la demande (ouverture de l'onglet, d'un album ou d'une case vide, si tu partages), par pages de
  1 000, gardé en mémoire le temps de la visite, **jamais dans IndexedDB** ; la liste des membres est relue à chaque
  ouverture de l'onglet (sinon au plus toutes les 10 min) et les cartes d'un ami ne le sont que si sa synchro ou son
  nombre de cartes a changé ; ses collections (après ses cartes) seulement s'il les montre et si leur nombre ou leur
  dernier changement a bougé. Pendant la résolution des qids des amis, les recalculs sont limités à un par seconde.
- **Valeur du classeur d'un ami** (2026-10-16, calculée dans la page) : ses cartes telles qu'il les montre (rareté,
  exemplaires, brillance : tous ses exemplaires comptés dans la rareté de sa carte, un seul brillant s'il l'est, comme une
  carte « approchée » du marché) × les cotes fiables venues avec ses cartes (`v`). Sur sa ligne (« valeur 12 500W · 205
  cartes cotées sur 1 048 »), en haut de son classeur (« Valeur : 12 500W, 205 cartes cotées sur 1 048 », avec la règle),
  pour chacune de ses collections (ligne et album : ses cartes qui la remplissent, chacune une fois). **Choix : dans la
  page plutôt que la dernière valeur de `value_history`** : elle n'utilise que ce qu'il montre (`value_history` est
  calculée avec ses `variants`, jamais montrés), elle suit les cotes du moment (son dernier point peut dater, ou manquer),
  elle donne aussi la valeur de chacune de ses collections, et elle ne coûte aucune requête de plus (la cote arrive avec
  ses cartes, par la clé primaire). Limites : elle peut différer un peu de la valeur qu'il voit chez lui (ses exemplaires
  de rareté plus basse comptés dans la plus haute), et ses cotes restent celles de la lecture de ses cartes pendant la
  visite (relues quand sa synchro change, ou au rechargement de la page). Seulement pour un membre qui montre ses cartes
  (sinon `404`, comme ses cartes) ; rien pour un ami dont aucune carte n'est cotée.
- **Règles du jeu** : le classeur ne fait que montrer qui a quoi. Les échanges se font dans le jeu, par les joueurs ;
  rien n'est automatisé vers le jeu.

## Chat

Un seul salon pour **tous les classeurs du site** (onglet « Chat », demande de l'utilisateur du 2026-10-16 : « où tout le
monde peut parler »), lisible par tous les membres, qu'ils partagent leurs cartes ou non ; l'onglet le dit (« Visible par
tous les membres du classeur »). Code : `site/functions/_lib/chat.js`, table `chat_messages`.

- **Messages** : texte brut, 500 caractères au plus (unités UTF-16, comme le `maxlength` du champ), retours à la ligne
  gardés ; le serveur unifie les fins de ligne, change les tabulations en espaces, retire les caractères de contrôle et
  les forçages de sens d'écriture (U+202A–202E, U+2066–2069), les espaces de fin de ligne et les bords, et réduit trois
  lignes vides ou plus à une. **Jamais de HTML** : le texte passe tel quel à Vue (échappé) ; seuls les liens
  `http(s)://` deviennent des liens (`target=_blank`, `rel="noopener noreferrer nofollow ugc"`, ponctuation finale hors
  du lien sauf une parenthèse qui en ferme une du lien : `…/Mercure_(planète)`). **Cartes citées** (demande de
  l'utilisateur du 2026-10-17 : « linker des cartes dans le chat ») : `[[Titre de la carte]]` dans le texte (1 à 300
  caractères sans `[ ] { } | # < >` ni retour à la ligne ; première lettre mise en majuscule, `_` en espaces ; un lien
  `http(s)` entre crochets reste un lien) ; le serveur range le texte tel quel (rien de plus à valider, les crochets
  comptent dans les 500 caractères) et la page le montre en pastille, voir « Interface ». **Mentions** (demande de
  l'utilisateur du 2026-10-19 : « pouvoir ping un utilisateur ») : `@` suivi du **prénom** (`users.name`) d'un membre, tel
  quel dans le texte ; le serveur n'en sait rien (aucune table, aucun champ de plus) : c'est la page qui les reconnaît,
  voir « Interface ». Un prénom changé ne désigne plus les anciennes mentions (choix : les membres sont peu nombreux,
  avec des prénoms différents ; deux prénoms identiques seraient mentionnés ensemble). **Collections citées** (demande de
  l'utilisateur du 2026-10-20 : « Bravo Tiff pour la fin de ta collection <lien> ») : à l'envoi, un lien du site (même
  hôte que la requête) vers une collection, `#/ami/<id public>/<id>` (paramètres de la vue compris) ou, la sienne,
  `#/collections/<id>`, est rangé sous une **forme stable**, `U+E000c:<id du compte>/<id de la collection>U+E001` (l'id
  public change à chaque réactivation du partage : un lien gardé tel quel mourrait). Seulement une collection que l'auteur
  voit : la sienne (même s'il ne la montre pas), ou celle d'un membre qui montre ses collections ; sinon (inconnue, autre
  site, membre qui ne les montre pas) le lien reste du texte. 5 par message au plus (les suivantes restent des liens).
  Les deux bornes (U+E000, U+E001) sont retirées du texte envoyé : seul le serveur les écrit. À chaque lecture, une
  requête de plus, seulement si les messages lus en citent (clés primaires de `users` et `targets`, 2 lignes par
  collection), rend pour **celui qui lit** chaque collection : son nom en clair **dans le texte** (« collection non
  partagée » pour `gone`), jamais les bornes rangées. Une page d'avant cette fonction (app ouverte depuis la veille, sans
  rechargement) montre donc le nom tel quel ; retour de l'utilisateur du 2026-10-20 : les bornes envoyées telles quelles
  s'affichaient « no glyph 0 no glyph » sur téléphone. Et à part, dans `refs`, dans l'ordre du texte :
  `{at, len, name, owner, mine, pid, id}` = sa place dans le texte, nom actuel
  de la collection et prénom actuel de son propriétaire, **lisibles par tout le salon** (choix de l'utilisateur du
  2026-10-20 : « nom et propriétaire », même pour qui ne montre pas ses cartes) ; `pid` (son id public) et `id` seulement
  si le lecteur montre ses cartes (réciprocité : de quoi ouvrir `#/ami/<pid>/<id>`), ou `mine` et `id` pour la sienne ;
  `{at, len, gone:true}` si elle est effacée, ou que son propriétaire ne montre plus ses collections (sauf pour lui). L'id interne
  ne sort jamais du serveur ; `GET /api/chat/last` ne rend rien de tout cela. La console D1 montre la forme rangée.
  **Membres cités** (demande de l'utilisateur du 2026-10-20 : « l'intégration d'un user du classeur ») : de même, un lien
  du site vers le classeur d'un membre qui montre ses cartes, `#/ami/<id public>` (sans collection, paramètres compris),
  le sien compris, est rangé `U+E000u:<id du compte>U+E001` ; sinon (membre qui ne montre pas ses cartes, inconnu, autre
  site) il reste du texte. Les 5 citations par message comptent collections et membres ensemble, dans l'ordre du texte.
  À la lecture, une requête de plus s'il y en a (clé primaire de `users`, une ligne par membre) : son **prénom actuel**
  en clair dans le texte (« membre sans prénom » sans prénom, « classeur supprimé » si le compte n'existe plus), et à
  part, dans **`members`** (pas dans `refs` : une page d'avant cette fonction n'y voit que le prénom, en texte),
  `{at, len, name, mine, pid, pseudo}` : `pid` (son id public) et `pseudo` (son pseudo dans le jeu) seulement s'il
  montre ses cartes et que le lecteur montre les siennes (comme `GET /api/members`), jamais pour soi ; ou
  `{at, len, gone:true}`. Les chiffres de l'aperçu ne viennent pas du serveur : la page les tire de ce qu'elle a déjà lu
  (voir « Interface »).
  Un message qui contient un lien
  personnel (`#cle=…`) est refusé (`400`, et par la page avant l'envoi). Écrire demande un prénom (`400` sinon : c'est lui
  que les autres voient ; la page propose « Choisir mon prénom »). L'auteur affiché est le **nom actuel** du classeur, lu
  à chaque lecture (jointure sur `users`) : un renommage vaut pour les anciens messages ; jamais l'id interne du compte
  (seulement `mine`).
- **Suppression** : par son auteur seulement (`403` sinon), après confirmation dans la page. Le texte est vidé aussitôt et
  la ligne reste comme **marque** (`deleted = 1`, nouvelle révision) pour que les pages ouvertes retirent le message à leur
  relecture suivante. Pas de modération par l'administrateur dans la page (console D1, ci-dessous).
- **DELETE /api/me** : les messages du compte sont **effacés**, pas anonymisés : texte vidé, auteur oublié (`user_id =
  ''`), nouvelle révision ; ils disparaissent aussi des pages ouvertes. Il ne reste qu'une ligne vide (numéro, date),
  purgée avec les plus anciennes. Choix : « Supprimer mon classeur » efface tout ; la conversation perd ces messages.
- **Clé** : principale seulement ; la clé d'import du favori n'y a pas accès (`401`) ; même origine (pas de CORS).
- **Limites** (`429 {error, retry_after}`, en secondes) : 10 messages par minute et 300 par 24 h glissantes par classeur
  (les messages supprimés comptent), 1 000 par 24 h pour tout le salon (garde le quota d'écritures de D1, voir « Coût »).
  Contrôlées dans l'`INSERT` même : deux envois simultanés ne passent pas tous deux au-delà.
- **Conservation** : les **2 000** derniers messages (marques comprises). Chaque envoi purge dans le même lot ceux d'au-delà
  (`DELETE … WHERE id <= MAX(id) - 2000`, par la clé primaire : le plus ancien). Les numéros ne sont jamais réutilisés (le
  plus récent n'est jamais effacé).
- **Révisions** : `chat_messages.rev`, unique (index `chat_by_rev`) et croissante, donnée à la création puis à la
  suppression (`MAX(rev) + 1` ; `MAX(rev) + id` pour tous les messages d'un compte supprimé, uniques aussi) ;
  `GET /api/chat?after=<rev>` rend les lignes de révision plus grande : les nouveaux messages et les numéros supprimés.
  Curseur et messages sont lus dans le même lot (transaction) : un changement fait entre les deux revient à la lecture
  suivante.
- **Coût D1** (gratuit : 5 M de lignes lues et 100 000 écrites par jour pour toute l'instance ; plans vérifiés par
  `dev/api.test.mjs`) :
  - relecture d'un chat ouvert sans nouveauté : le compte (1 ligne, index de sa clé), `MAX(rev)` et `MAX(id)` (1 ligne
    chacun : optimisation min/max de SQLite), les changements par l'index `chat_by_rev` (aucune ligne) ≈ **3 lignes
    lues** ; avec k changements, 2k de plus (le message et son auteur, par la clé primaire de `users`) ;
  - `GET /api/me` (toutes les 60 s, page visible) : une ligne de plus (`MAX(id)` dans la même requête que le compte) ;
  - première lecture : au plus 101 messages et leurs auteurs (≈ 200 lignes, plus les marques de suppression traversées),
    une fois par visite, à l'ouverture de l'onglet ou quand `last_chat_id` dépasse le dernier lu ;
  - envoi : limites lues par l'index `chat_by_user` (10 et 300 lignes au plus), limite du salon et `MAX` (1 ligne
    chacune) ; écrit le message et ses deux index (3 lignes), et la purge du plus ancien (3 lignes) une fois les 2 000
    atteints ;
  - ordre de grandeur : 6 personnes, chat ouvert 1 h par jour chacune → 1 800 relectures ≈ 5 400 lignes lues ; 200
    messages par jour ≈ 1 200 lignes écrites (≈ 1 % du quota) ; au pire (limite du salon) 1 000 messages ≈ 6 000 lignes
    écrites (6 %). Requêtes : 300 par heure de chat ouvert et par personne (Workers gratuit : 100 000 par jour) ;
  - JavaScript : moins de 1 ms par requête (100 messages de 500 caractères : 0,2 ms, `dev/api.test.mjs`).
- **Interface** (onglet « Chat ») :
  - fil (`role="log"`) puis champ de saisie ; à l'ouverture, la page défile pour que le bas du chat soit visible. Bulles :
    les tiennes à droite, en émeraude, avec « (toi) » et « Supprimer » ; nom, heure (« 14:32 », « hier, 14:32 », « 15 oct.,
    14:32 ») et date complète en info-bulle ;
  - **Entrée** envoie, **Maj+Entrée** va à la ligne (pas pendant une saisie IME) ; le brouillon reste si l'envoi échoue
    (message du serveur affiché, `429` compris) ; il est vidé à l'envoi réussi, sauf s'il a été modifié entre-temps ;
  - **cartes citées** : chaque `[[Titre]]` d'un message devient une pastille (un `<button>`, titre en texte : jamais de
    HTML) ; ta carte (titre puis qid, comme les albums) : avec sa rareté ; une carte que tu n'as pas : bord en pointillés.
    Un clic ouvre la fiche : celle de ta carte, sinon celle d'une carte qui te manque (ce qu'en disent tes collections,
    puis l'article vérifié sur Wikipédia en une requête `prop=pageprops|description|pageimages|pageviews`, redirection
    suivie : description, homonymie, qid, vignette, vues sur 30 jours et rareté estimée, dans le cache des vues des
    albums ; « Vérification sur Wikipédia… » en attendant ; introuvable : « le titre cité dans le chat est peut-être mal
    écrit » ; une redirection vers une de tes cartes ouvre la tienne, et le qid appris sert aux pastilles). Sous le
    champ, une aide discrète (aussi sur téléphone) : « Pour montrer une carte : `#` puis son titre, `[[Titre de la
    carte]]`, ou « Partager dans le chat » depuis sa fiche. Pour une collection : `#c:` puis son nom, ou colle son lien.
    Pour un membre : `@` puis son prénom pour le mentionner, `#u:` pour montrer son classeur. » ;
  - **collections citées** (2026-10-20) : dans le texte, son **nom** en lien vers elle (`#/collections/<id>`, la tienne,
    ou `#/ami/<pid>/<id>`, ouvert dans la page) ; sans `id` (tu ne montres pas tes cartes) son nom seul, avec « Collection
    de Tiff » en info-bulle ; `{gone}` : « collection non partagée » en italique. **Aperçu** sous le message, pour la
    première : sa ligne, comme dans tes collections (`viewRow`) ou dans le classeur de l'ami (`viewFriendColRow` :
    éventail, « 2 sur 3 » avec SES cartes, valeur, « Tu peux l'aider ») ; un message lu qui cite la collection d'un ami
    lit « Entre amis » (`ensureFriends`, au plus toutes les 10 min). En attendant, ou sans partage : son nom et « Collection
    de Tiff », plus « Lecture de sa progression… » ou « Montre tes cartes (Réglages) pour voir sa progression. » Un autre
    lien vers une vue du classeur (`#/…`, même origine) s'ouvre aussi dans la page, sans nouvel onglet ;
  - **membres cités** (2026-10-20) : dans le texte, son **prénom** en lien vers son classeur (`#/ami/<pid>`, `#/cartes`
    pour toi ; pseudo dans le jeu en info-bulle), sans `pid` son prénom seul, « classeur supprimé » en italique.
    **Aperçu** sous le message, pour le premier (après celui d'une collection citée) : initiale, prénom, pseudo dans le
    jeu (lien vers son profil du jeu) et les chiffres de son classeur : cartes différentes, collections (« collections
    non partagées » s'il ne les montre pas) et combien sont complètes (avec SES cartes, comme `viewFriendColRow`), valeur
    (comme « Entre amis »), tirés d'« Entre amis » (`ensureFriends`, au plus toutes les 10 min) ; pour toi, de ton
    classeur. En attendant ou sans partage : « Lecture de son classeur… », « Montre tes cartes (Réglages) pour voir son
    classeur. » ou « Ne montre pas ses cartes. » ;
  - **autocomplétion du champ** (2026-10-19), sur le modèle de la recherche de catégories (`role="combobox"`, liste
    `role="listbox"` **au-dessus** du champ, à cause du clavier du téléphone) : elle s'ouvre sur le `@` ou le `#` placé
    avant le curseur, en début de mot (pas « a@b.fr », « C#maj »), sur la même ligne, 60 caractères tapés au plus depuis,
    sans espace au début ni deux espaces de suite (un prénom ou un titre peut contenir des espaces). **Flèches** pour
    choisir, **Entrée** ou **Tab** pour insérer (Entrée n'envoie alors rien), **Échap** pour fermer (elle ne revient pas
    tant qu'on continue le même mot après ce `@` ou ce `#`), clic (à la souris : le champ garde le focus) ; quitter le champ la ferme. Rien de choisi : le
    texte reste tel quel et Entrée envoie. 8 suggestions au plus, rangées : le nom tapé en entier, puis le nom commence par
    ce qui est tapé, puis un de ses mots, puis (3 lettres ou plus) il le contient ;
    - `#` suivi d'une **lettre** (« #1 » ne propose rien) : tes cartes (avec leur rareté), les éléments vérifiés de tes
      collections et les cartes des amis déjà lues (« pas dans ton classeur »), et, dès 2 lettres, les **articles de
      Wikipédia** qui commencent par le texte tapé (toute carte du jeu en est un ; retour de l'utilisateur du 2026-10-19 :
      « #Europe » ne proposait pas Europe, absente de son classeur) : `list=prefixsearch` (espace 0, 8 au plus, dans
      l'ordre de Wikipédia), 250 ms après la dernière frappe, dans la file des requêtes à Wikipédia ; une recherche
      périmée est abandonnée ; « Recherche sur Wikipédia… » tant que rien d'autre n'est proposé ; Wikipédia indisponible :
      les cartes connues seules. Une fois par titre ; un article trouvé par une redirection (son titre ne contient pas le
      texte tapé) vient en dernier ; à rang égal, les tiennes d'abord, puis les autres cartes connues (la plus courte
      d'abord), puis les articles dans l'ordre de Wikipédia. Insère `[[Titre]] ` (le texte tapé depuis le `#` est
      remplacé) ;
    - `#c:` (2026-10-20) : des **collections**, pas des cartes : les tiennes (« ta collection »), puis, si tu montres tes
      cartes, celles des amis qui les montrent (« de Tiff », lues avec « Entre amis », qui se charge au premier `#c:`) ;
      `#c:` seul les propose toutes, de A à Z, les tiennes d'abord. Insère le **lien** de la collection
      (`<origine>/#/collections/<id>` ou `<origine>/#/ami/<id public>/<id>`), que le serveur range sous sa forme stable.
      Une des tiennes alors que tu ne montres pas tes collections : avertissement (les autres verront « collection non
      partagée »), le lien est inséré quand même ;
    - `#u:` (2026-10-20) : les **membres qui montrent leurs cartes** (comme `@`, sans toi ; il faut montrer les tiennes),
      avec leur pseudo dans le jeu ; insère le **lien** de son classeur (`<origine>/#/ami/<id public>`), que le serveur
      range sous sa forme stable ;
    - `@` : les **membres qui montrent leurs cartes** (choix de l'utilisateur : seuls eux peuvent être mentionnés), sauf
      toi : les prénoms de « Entre amis » s'ils sont lus, sinon `GET /api/members` seul (sans leurs cartes), à
      l'ouverture du chat ou au premier `@`, au plus toutes les 10 min (`FRIENDS_TTL`). Comme ce point d'accès, il faut
      montrer ses cartes : sinon, sous le champ, « Seuls les membres qui montrent leurs cartes peuvent être mentionnés,
      et il faut montrer les tiennes (Réglages) pour les voir ici. », et aucune lecture. Insère `@Prénom ` ;
  - **mentions dans les messages** : un `@` en début de mot suivi d'un prénom connu (le tien, ceux des membres qui
    montrent leurs cartes, ceux des auteurs des messages lus), sans distinction de casse, puis autre chose qu'une lettre
    ou un chiffre ; le plus long l'emporte (« @Jo Anne » plutôt que « @Jo »). Il devient une pastille (texte, jamais de
    HTML) ; la tienne est surlignée. Un message **des autres** qui te mentionne est mis en avant (bord et fond d'alerte,
    « te mentionne » à côté de l'heure). Il suffit que ton prénom y soit : même tapé à la main, même si tu ne montres pas
    tes cartes ;
  - **pseudo dans le jeu** (2026-10-19) : celui d'un membre qui montre ses cartes (lu avec les prénoms de « @ », voir
    `PATCH /api/me`) paraît en petit à côté de son prénom dans ses messages (« · Pseudo », lien vers son profil du jeu),
    dans sa suggestion de « @ », et en info-bulle sur les mentions de son prénom ; jamais sur tes messages ;
  - **« Partager dans le chat »** : icône à côté de « Copier le nom » dans les fiches (ta carte, carte qui te manque,
    carte d'un ami ; pas pour un article introuvable ou une homonymie) : ajoute `[[Titre]] ` au bout du brouillon du
    chat (sauf s'il y est déjà ; refusé avec un message si le brouillon dépasserait 500 caractères), ferme la fiche,
    ouvre l'onglet Chat et met le curseur à la fin du champ. Rien n'est envoyé : on complète son message, puis Entrée ;
  - relecture `?after=` toutes les **12 s** tant que l'onglet est ouvert et la page visible (30 s après 5 min sans nouveau
    message ni geste dans le chat), tout de suite au retour sur la page ; rien quand l'onglet est fermé ou la page cachée.
    Plus de 100 changements ou révision inconnue : relecture des plus récents ;
  - ailleurs, **badge des non-lus** sur l'onglet (« 3 », « 99+ » au-delà ; texte « 3 messages non lus » pour les lecteurs
    d'écran) : `last_chat_id` de `GET /api/me` (déjà relu toutes les 60 s) ; la page ne lit le chat que s'il a changé
    (chat déjà chargé) ou s'il dépasse le dernier lu. Non lus = messages des **autres** au-delà du dernier lu, parmi ceux
    que la page a lus ; tes propres messages (d'un autre appareil) ne comptent pas. Parmi eux, ceux qui te mentionnent :
    un second badge, en couleur d'alerte, « @2 » à côté du nombre (le texte pour lecteurs d'écran devient « 5 messages
    non lus, dont 2 te mentionnent ») ; rien hors de la page (ni notification du navigateur, ni courriel) ;
  - dernier message lu : `localStorage` `classeur-chat-lu` = `{<id du compte>: numéro}` (accès protégés ; refusé : en
    mémoire seulement ; oublié par « Oublier ce navigateur ») ; il avance quand le chat est sous les yeux ou quand rien de
    nouveau ne vient des autres ; base recréée (`last_chat_id` plus petit) : ramené à `last_chat_id` ;
  - défilement : en bas à l'ouverture, après ton envoi, ou à l'arrivée de messages si tu y étais déjà ; remonté dans le
    fil, il ne bouge pas et « Nouveaux messages ↓ » y ramène. « Charger les messages plus anciens » : 100 de plus, position
    de lecture gardée ;
  - téléphone (390 px) : bulles à 90 % de la largeur, raccourcis clavier masqués, champ en 16 px (pas de zoom sur iPhone).
  - Courses : changement de classeur pendant une lecture ou un envoi : la réponse est écartée (`chatGen`), messages,
    brouillon et dernier lu sont ceux du nouveau classeur.
- **Modération par l'administrateur** (console D1 : `npx wrangler d1 execute <base> --remote --command "…"`) :

  ```sql
  -- les 50 derniers messages, avec leur auteur
  SELECT m.id, u.name, m.created_at, m.text FROM chat_messages AS m LEFT JOIN users AS u ON u.id = m.user_id
    WHERE m.deleted = 0 ORDER BY m.id DESC LIMIT 50;
  -- supprimer le message 42 (il disparaît aussi des pages ouvertes)
  UPDATE chat_messages SET text = '', deleted = 1, rev = (SELECT MAX(rev) FROM chat_messages) + 1
    WHERE id = 42 AND deleted = 0;
  -- supprimer tous les messages d'un classeur, par son prénom
  UPDATE chat_messages SET text = '', deleted = 1, rev = (SELECT MAX(rev) FROM chat_messages) + id
    WHERE deleted = 0 AND user_id IN (SELECT id FROM users WHERE name = 'Paul');
  -- vider tout le salon (les pages ouvertes repartent de zéro)
  DELETE FROM chat_messages;
  ```

  Pas de `DELETE` d'un seul message : une page ouverte ne le verrait pas partir (seule une nouvelle révision le lui dit).

## Nouveautés (journal des versions, messages système du chat)

Demande de l'utilisateur du 2026-10-20 : une page « Nouveautés » qui montre aux membres un journal des changements
clair, concis et facile à lire, et un message système dans le chat qui annonce une nouvelle version. **Aucune
publication automatique** : ce qui fait une version, et quand l'annoncer dans le chat, est à décider plus tard. Cette
section ne fournit que les briques.

**Un fichier statique, `site/public/nouveautes.json`**, publié avec le site comme le reste de `public/` : rien dans la
base, aucun point d'accès, aucun secret. Publier veut dire modifier le fichier, puis pousser `wikimasters`. Le fichier a
deux listes **indépendantes** : ajouter une version n'écrit rien dans le chat, et un message du chat ne s'écrit qu'à la
main.

```json
{
  "versions": [
    { "id": "2026-10-19", "date": "2026-10-19", "title": "facultatif", "intro": "facultatif",
      "sections": [ { "icon": "💬", "title": "Chat",
        "items": [ { "text": "`@` pour mentionner un ami.", "to": "#/chat", "link": "Chat" } ] } ] }
  ],
  "chat": [ { "id": "2026-10-19", "at": "2026-10-19T23:30:00Z", "text": "Nouvelle version du classeur disponible", "version": "2026-10-19" } ]
}
```

- **Version** : `id`, unique, au plus 60 caractères ; `date`, au format `AAAA-MM-JJ`. Les autres champs sont facultatifs :
  `title` (120 caractères), `intro` (600). `sections` est une liste de rubriques `{icon?, title, items}`. `icon` est un
  emoji (8 caractères au plus), `title` en fait 120 au plus. Chaque ligne `{text, to?, link?}` a un `text` de 600
  caractères au plus, en texte brut, où seul `` `code` `` est mis en forme. `to` est un lien **interne**, une adresse
  `#/…` de la section « Adresse de chaque vue » ; tout autre lien est retiré. `link` est le libellé du lien (« Voir » par
  défaut). La page trie les versions de la plus récente à la plus ancienne. Elle écarte une version sans `id` ou sans
  date valide, une rubrique sans ligne, une ligne vide. Au plus 200 versions, 30 rubriques par version, 50 lignes par
  rubrique.
- **Message système** (`chat`) : `id` unique ; `at`, l'heure ISO à laquelle il prend place dans le fil ; `text`, 300
  caractères au plus, en texte brut ; `version` (facultatif), l'`id` d'une version. Au plus 100 messages.
- **Lecture** : `GET /nouveautes.json` (`cache: no-cache`), à l'ouverture du classeur, puis à l'ouverture du chat ou de
  la page, au plus toutes les 10 min. Si la lecture échoue, la page fait un nouvel essai au plus tôt 1 min après.
  Fichier absent ou illisible : ni pastille ni message système, et la page dit « Les nouveautés n'ont pas pu être
  lues. » avec un bouton « Réessayer ».

**Interface** :
- **Lien « Nouveautés »** au bout de la ligne des onglets. C'est une page à part (`#/nouveautes`), pas un onglet : aucun
  onglet n'y est sélectionné, et le premier reste joignable au clavier. Une pastille « nouveau » s'affiche tant que la
  version la plus récente n'a pas été vue **dans ce navigateur** : `localStorage` `classeur-nouveautes-vu` garde l'`id`
  de la dernière version vue, avec des accès protégés, et « Oublier ce navigateur » l'efface.
- **Page** : une version par bloc, la plus récente en haut. La date est à gauche (au-dessus sur téléphone), puis
  viennent une rubrique par thème et une ligne par changement, avec son lien « Chat → ». Les versions que ce navigateur
  n'avait pas encore vues portent l'étiquette « Nouveau » le temps de la visite (la plus récente seule, la première
  fois).
- **Chat** : chaque message système est une ligne discrète, petite, grise et centrée, sans bulle ni auteur : « Nouvelle
  version du classeur disponible · Voir les nouveautés · <heure> ». Le lien mène à `#/nouveautes`. La ligne est placée
  par son heure parmi les messages, et seulement si elle est plus récente que le plus ancien message chargé (toutes les
  lignes s'affichent quand il n'y a pas de messages plus anciens). Elle ne compte pas dans les non-lus, ne se supprime
  pas et n'entre pas dans les limites du salon.

**Publier** (skill du projet `publier`, `.claude/skills/publier/` de la branche `main`) : avant un push de
`wikimasters`, la patchnote des commits poussés est rédigée (skill `patchnote`) et proposée. Si l'utilisateur
l'accepte, elle est ajoutée à `versions`. Il est alors aussi invité à l'annoncer dans le chat, sauf si la dernière
chose du fil en est déjà une : dernière annonce de `chat` plus récente que `GET /api/chat/last`.

## Adresse de chaque vue (interface)

Depuis le 2026-10-20 (demande de l'utilisateur : ne plus perdre la vue au rafraîchissement), chaque vue a son adresse,
dans le **fragment** (`#/…`) : jamais envoyé au serveur, et le Worker ne sert que les fichiers de `public/` (un vrai
chemin, `/collections/…`, y serait un 404 au rafraîchissement). Rien côté serveur.

| Adresse | Vue |
|---|---|
| `/` (fragment vide) | « Collections », liste de tes collections |
| `#/collections/<id>` | une de tes collections |
| `#/categorie/<nom>` (`?sous=1` : sous-catégories comprises) · `#/page/<titre>` | une catégorie, une page de Wikipédia (titres avec « _ » à la place des espaces) |
| `#/cartes` · `#/amis` · `#/marche` · `#/chat` · `#/maj` · `#/reglages` | les onglets |
| `#/nouveautes` | la page « Nouveautés » (hors des onglets, voir « Nouveautés ») |
| `#/amis/echanges` (`?qui=me` ou l'identifiant public d'un membre) | « Échanges possibles » |
| `#/ami/<id public>` · `#/ami/<id public>/<id de sa collection>` (`?depuis=echanges`) | le classeur d'un ami, une de ses collections |

Paramètres, absents à leur valeur par défaut : « Mes cartes » `q`, `tri` (≠ `rarity`), `rarete` (répété), `tag`
(répété, tags du classeur), `jeu` (répété, tags du jeu), `sans-tag=1`, `nouvelles=1` ; album (le tien ou celui d'un ami)
`filtre`, `tri` (≠ `order`) ; classeur d'un ami `q`, `filtre=missing`, `tri` ; partout `carte=<id>` = fiche d'une de
tes cartes (pas les cases vides). Une valeur inconnue revient à la valeur par défaut, une vue inconnue à « Collections ».

- **Le lien personnel d'abord** : `#cle=…` est lu et effacé avant tout (`takeHashKey`) ; une adresse ne contient
  donc jamais la clé, aucun paramètre ne s'appelle `cle`, et les valeurs sont encodées (une recherche « &cle=… » reste
  une recherche). Copier la barre d'adresse à un ami ne lui donne rien d'autre qu'une vue, qu'il n'ouvre que dans son
  propre classeur.
- **L'état est la seule source** : l'adresse est calculée à partir de lui (`routeHash`) ; une adresse lue (chargement,
  Précédent / Suivant, saisie) ouvre la vue par les mêmes fonctions qu'un clic (`applyRoute`), avec leurs effets.
- **Historique** : une nouvelle vue (onglet, collection, ami…) ajoute une entrée ; filtres, tris, recherche et fiche
  remplacent l'entrée courante, regroupés (300 ms : les navigateurs limitent ces appels) ; les corrections de la page
  (adresse appliquée, lien mort, classeur vide ouvert sur « Mettre à jour ») la remplacent aussi.
- **Au chargement**, la vue s'ouvre dès que le compte est lu ; la fiche, une fois les cartes là. Collection ou carte
  disparue : message, puis la vue parente ; ami qui ne partage plus : « Entre amis ». Changer de classeur ou revenir à
  l'accueil efface l'adresse.
- Ne survivent pas au rafraîchissement : les brouillons (réorganisation — le navigateur demande avant de quitter —,
  « Ajouter par tags du jeu », fusion), les fenêtres, la colonne et les sections choisies d'une page de Wikipédia.

## Onglet « Collections » (interface)

Depuis le 2026-10-20 (demande de l'utilisateur : « on peut créer des collections de plusieurs manières différentes et
elles sont accessibles de manières différentes. Il faut complètement uniformiser tout ça »), l'onglet n'a plus qu'**une
zone, « Mes collections »**, et **un seul point d'entrée pour créer** : le bouton principal **« Nouvelle collection »**
(en tête de la zone, ou dans la liste vide), qui ouvre la fenêtre « Nouvelle collection ». La zone « Catégories »
(recherche et propositions sous la liste) a disparu : son contenu est dans la fenêtre.

**Fenêtre « Nouvelle collection »** (`modalEditor`, large, hauteur fixe pour que les onglets ne bougent pas) : un onglet
par façon de créer (`NEW_MODES`, `role=tablist`, ← → en boucle, Début, Fin ; `#newcol-tab-<mode>`, panneau
`#newcol-panel`), chacun commençant par une explication courte (`.newcol-intro`) :

| Onglet | Contenu |
|---|---|
| **Par URL** (`url`, par défaut) | le champ de recherche des catégories et des pages (`#cat-q`, voir 2. ci-dessous) : une adresse de fr.wikipedia.org collée s'ouvre aussitôt, un nom tapé propose catégories et pages « Liste de… ». Le choix **ferme la fenêtre** et ouvre l'aperçu (album de la catégorie ou de la page, colonne clé, sections), d'où « Créer une collection » |
| **Par mots-clés** (`mots`) | la recherche par mots-clés (candidats, aperçu, « Enregistrer »), inchangée |
| **Par liste d'articles** (`liste`) | l'éditeur « un article par ligne », inchangé |
| **Propositions** (`props`, avec leur nombre en pastille) | « Proposées d'après tes cartes » (voir 2. ci-dessous) : « Créer une collection » reste dans la fenêtre ; le nom d'une proposition ferme la fenêtre et ouvre son aperçu ; « Retirer » demande confirmation puis **revient à la fenêtre** (`openConfirm({back:'editor'})`) ; « Masquer / Afficher les propositions » toujours visible, même pendant le calcul |
| **Depuis le jeu** (`jeu`) | comment créer une collection avec le favori depuis la « Collection globale » de wiki-masters.com, et « Installer le favori » (ou « Voir mon favori » s'il l'est déjà) : l'onglet « Mettre à jour » |

`openEditor(null, mode)` ouvre la fenêtre sur un onglet ; changer d'onglet arrête une recherche en cours (mots-clés,
suggestions). « Mes collections » a aussi, quand il y en a, un lien « N propositions d'après tes cartes » qui ouvre la
fenêtre sur « Propositions ». « Modifier » (album d'une collection) garde sa fenêtre à part, « Modifier la collection »
(l'éditeur « Liste d'articles » seul).

1. **« Mes collections »** : TOUTES les collections à compléter (favori depuis la Collection globale du jeu, « Nouvelle
   collection » par URL, mots-clés, liste d'articles ou propositions, anciennes du catalogue). Une collection de source `wp:…` est signalée sur sa ligne et dans son
   album, discrètement : « depuis la catégorie Wikipédia » ; une de source `links:<titre>` : « depuis la page Wikipédia
   « <titre> » » (aussi dans « Entre amis », pour tes collections) ; `links:<titre>#<colonne>` : « depuis la page
   Wikipédia « <titre> », colonne « <colonne> » ». Une collection qui a un **ajout automatique** (voir plus bas) porte sur
   sa ligne une petite marque « ajout automatique » (icône de synchro ; ses règles au survol ; « . Ajout automatique » à
   la fin de l'étiquette lue par les lecteurs d'écran). Leurs articles sont de A à Z, sans numéros (une catégorie n'a pas
   d'ordre, les liens d'une page sont lus de A à Z), comme les anciennes du catalogue sans ordre (`ordered: false` dans
   `catalog.json`, liste reprise dans `app.js`) ; sauf celle faite de la colonne clé des tableaux d'une page : dans
   l'ordre des lignes, numérotée (tri « Ordre »). Son album est celui d'une collection :
   « Ajouter par tags du jeu », « Modifier », « Réorganiser… » (qui explique pourquoi elle reste de A à Z : voir
   « Réorganiser »), « Fusionner avec… », « Supprimer » (confirmation), et « Voir sur
   Wikipédia » (la catégorie, ou la page). Pour le reste (propositions couvertes, fiches « Dans tes collections », amis, échanges), c'est une collection
   comme les autres ; un ami la voit comme une collection (`kind: collection`, sans sa source). Vide : une phrase cite les
   façons d'en créer une, puis « Nouvelle collection » (et le lien vers les propositions s'il y en a).

   **« Ajouter par tags du jeu »** (album de toute collection, avant « Modifier » ; demande de l'utilisateur du
   2026-10-17 : « Alek a une collection maladie et doit avoir plein de cartes avec le tag maladie qui ne sont pas
   dedans », précisée le 2026-10-18 : « je parlais [des tags] de wiki-masters, pas ceux en automatique » ; livrée le 17
   sous le nom « Ajouter par tags » sur les tags du classeur, puis le 18 au matin « Ajouter par catégorie du jeu » ; le
   nom reprend ses mots, les catégories du jeu viennent en second dans la même fenêtre) : une fenêtre propose, calculés
   dans la page sans requête, dans cet ordre :
   - **tes tags du jeu** (`gtags` de tes cartes, voir « Tags du jeu » ; un par nom sans tenir compte de la casse, avec la
     couleur du jeu en pastille) : **ressemblants au nom** de la collection (mots repliés : casse et accents ignorés,
     articles « de, la, des, un… » et possessifs « mes, ses… » écartés, pluriel ramené au singulier « maladies →
     maladie », « animaux → animal », féminin et masculin ramenés à une forme commune sur les mots de 6 lettres au moins
     « chanteuse, chanteur → chanteu », « infectieuse, infectieux → infectieu », « française → français ») : **même nom**
     (« Maladies » ↔ « Maladie »), **cochés d'emblée** ; **plus précis** (tous les mots du nom, et d'autres : « Maladies
     tropicales », les moins longs d'abord) ; **plus larges** (« Maladie » pour « Maladies parasitaires » : « vérifie
     l'aperçu »), jamais cochés d'emblée ; un tag qui ne partage qu'une partie des mots n'est pas proposé ; puis **portés
     par beaucoup de tes cartes de la collection** (2 au moins, et 20 % d'entre elles : « porté par 2 de tes 2 cartes de
     la collection ») ;
   - **les catégories du jeu** (`category` de tes cartes : le texte que le jeu affiche sous leur titre, « maladie »,
     « chanteuse barbadienne » ; les écritures d'une même catégorie, casse, accents, espaces, n'en font qu'une, affichée
     sous sa forme la plus fréquente) : mêmes règles de nom (même nom cochée d'emblée), puis **portées par beaucoup de
     ses éléments** : catégorie de ta carte pour un élément que tu as, sinon description de l'élément (celle du jeu pour
     une collection créée par le favori, celle de Wikidata sinon : en général le même texte), 2 éléments au moins et 20 %
     de ceux qui en ont une (« portée par 2 des 4 éléments de la collection ») ;
   - dans chacune des deux listes, 16 propositions au plus (celles du même nom et choisies à la main en plus ; au-delà :
     « Et N autres … : tape celui que tu veux dans le champ ci-dessous ») ;
   - **un autre tag ou une autre catégorie du jeu**, au choix (champ avec la liste de tes tags du jeu puis des catégories
     de tes cartes, les plus portés d'abord, 2 000 au plus) : nom exact sans la casse ni les accents (tag et catégorie si
     les deux existent), sinon ceux qui ont exactement les mêmes mots repliés (« Maladies infectieuses » → « maladie
     infectieuse ») ; inconnu : « Aucune de tes cartes n'a le tag ou la catégorie du jeu « … » ; ressemblants : « … » »
     (trois au plus, qui contiennent tous ses mots) ;
   - **tes tags du classeur**, en dernier et **repliés** (« Proposer aussi tes tags du classeur (N) », jamais cochés
     d'emblée ; « Masquer » les décoche) : sous-tag du même nom (« Sciences et nature/Maladie » pour « Maladies ») ou
     proche, catégorie de tags de même nom ou proche (tous ses tags), portés par 2 au moins de tes cartes de la
     collection et 20 % d'entre elles. L'utilisateur ne les veut pas comme base (ils viennent pour beaucoup des
     suggestions automatiques) ; ils restent pour qui en a posé à la main.

   Pour chaque proposition : le nombre de tes cartes qui la portent et ne sont **pas encore** dans la collection
   (rapprochement par titre puis qid, comme l'album ; une carte par titre) et combien d'éléments de la collection la
   portent déjà ; celles (même nom, plus précises, plus larges, choisies) dont tout est déjà dedans sont signalées à part
   (« Déjà toutes dans la collection : tes cartes au tag Maladie », « … de catégorie « maladie » »). Rien à proposer : la
   fenêtre le dit pour chaque liste ; **aucun tag du jeu lu** : « Ton favori n'a encore lu aucun tag du jeu : relance une
   mise à jour complète (onglet « Mettre à jour » : « La prochaine mise à jour relira toute ta collection », puis le
   favori sur wiki-masters.com ; il faut celui du 18 octobre 2026 ou plus récent). Si tu n'as posé aucun tag sur tes
   cartes dans le jeu, les catégories du jeu ci-dessous suffisent. » ; aucune catégorie : « relance une mise à jour avec
   le favori ». **Aperçu** des cartes des propositions cochées (de A à Z, avec leur rareté, et leur catégorie du jeu
   quand plusieurs propositions sont cochées ; 120 affichées puis « Afficher les suivantes »), décochables une à une
   (« Tout cocher » / « Tout décocher ») ; **« Ajouter N cartes »** = `POST /api/targets/save {id, name, items, source?}` :
   les éléments existants tels quels, puis les nouveaux à la fin (`{title, description: catégorie du jeu de la carte,
   image: null, status:'ok', qid?}`, qid s'il est connu), sans doublon (titre ou qid revérifiés à l'enregistrement) ;
   limite de `targets.js` contrôlée avant l'envoi (1,7 Mo) ;
   l'erreur du serveur s'affiche telle quelle (5 Mo par compte…). Une collection **faite d'une catégorie ou d'une page
   de Wikipédia** (`wp:` / `links:`) : l'ajout est permis et elle **garde sa source** (comme avec « Modifier », qui le
   permettait déjà ; aucune relecture automatique de la catégorie ne défait l'ajout) ; la fenêtre le dit (« les cartes
   ajoutées viennent en plus de ses articles »). Courses : classeur changé pendant l'enregistrement, la réponse est
   écartée.

   **Intercalaires détectés** (2026-10-18) : à l'ouverture de l'album d'une de tes collections ordonnées, un élément
   dont le titre nomme la nature des éléments qui le suivent est coché comme intercalaire : au moins 2 des 12 suivants
   (jusqu'au prochain intercalaire), dont l'un des 2 premiers, ont une description qui commence par ce titre (mots
   repliés, singulier ; « Continent » puis « continent situé… », « Sous-continent » puis « sous-continent
   nord-américain… »), et la sienne ne commence pas par ce titre. Calcul sur les descriptions gardées, sans requête ; une
   requête `targets/save` pour toute la collection ; le message propose « Annuler ». Un élément déjà décidé n'est jamais
   touché : `sep: true`, ou **`sep: false`**, que le serveur garde désormais (case de la fiche décochée, « # » retiré dans
   l'éditeur, « Annuler » de la détection).

   **Ajout automatique** (2026-10-18, demande de l'utilisateur : « Quand il y a déjà eu un "Ajouter par tags du jeu",
   automatiser pour le faire à chaque synchro. ») :
   - **Dans la fenêtre**, sous l'aperçu, une case **cochée d'emblée** : « Refaire à chaque synchro : les prochaines cartes
     de ces tags iront dans cette collection » (`#tagadd-auto`), avec une note (« Les tags et catégories cochés sont
     gardés … Une carte décochée dans l'aperçu, ou retirée ensuite de la collection, n'est jamais rajoutée (N cartes
     exclues pour l'instant). »). Cochée, l'enregistrement envoie aussi `auto: {rules}` = **les propositions cochées**
     (tags du jeu `{k:'gtag', v:<nom du tag>}`, catégories du jeu `{k:'cat', v:<texte de la catégorie>}`, tes tags du
     classeur dépliés `{k:'tag', v:<tag ou « Catégorie/ »>}`, qu'elles soient proposées ou choisies à la main) et
     `auto_skip` : `add` = les cartes **décochées dans l'aperçu** (pas déjà exclues), `del` = les cartes ajoutées qui
     étaient exclues (recochées : remises à la main). 20 règles au plus : au-delà, « N tags et catégories cochés :
     l'ajout automatique en garde 20 au plus … » et bouton grisé. Décochée : rien de gardé (`auto: null` si la collection
     en avait : l'ajout automatique s'arrête, la note le dit). Message : « 3 cartes ajoutées à « Maladies ». Les prochaines
     cartes de ces tags y seront ajoutées à chaque synchro. ».
   - **Rouverte** sur une collection qui a des règles : **ses règles, et elles seules, sont cochées** (pas les
     propositions du même nom qu'on avait décochées), montrées même sans carte à ajouter (« rien à ajouter ») ou quand plus
     aucune carte ne porte ce tag (libellé de la règle), en tête de leur liste, marquées « · règle de l'ajout
     automatique » (et tes tags du classeur dépliés si une règle en est un) ; dans l'aperçu, les cartes **exclues** sont
     décochées d'emblée, avec « exclue de l'ajout automatique » (les recocher les ajoute et lève leur exclusion). Sans carte
     à ajouter, le bouton devient « Enregistrer les règles » (règles changées, ou cartes décochées à exclure), « Arrêter
     l'ajout automatique » (case décochée), sinon reste grisé (« Ajouter ») ; aperçu vide : « Rien à ajouter pour
     l'instant : tes cartes de ces tags et catégories sont déjà toutes dans la collection. ». Message : « Ajout automatique
     mis à jour pour « … » : … ».
   - **À chaque arrivée de cartes dans la page** (ouverture du classeur, synchro du favori — fenêtre « Mettre à jour »
     ou envoi relié repéré par la relecture des 60 s —, rafraîchissement, relecture `?since` qui change les cartes, y
     compris des tags du classeur posés ailleurs : partout où la page appelle `afterCards`), pour **chaque collection qui a
     des règles** : tes cartes qui répondent à **l'une** de ses règles (tag du jeu ou catégorie du jeu repliés comme dans
     la fenêtre : casse, accents, espaces ; tag du classeur exact, ou toute sa catégorie pour `Catégorie/`), qui ne sont
     **ni déjà dedans** (rapprochement par titre puis qid, comme l'album et la fenêtre ; les qids des cartes à ajouter et
     des éléments sans qid encore sans carte sont d'abord résolus sur Wikipédia, en cache le plus souvent : une carte que
     tu as sous un autre titre n'entre pas une seconde fois) **ni exclues** (`skip`, comparé par titre replié), une par
     titre et par qid, sont ajoutées **à la fin**, de A à Z, avec les champs de la fenêtre (`{title, description:
     catégorie du jeu, image: null, status:'ok', qid?}`), intercalaires et autres éléments intacts : **une requête**
     `POST /api/targets/save {id, name, items, source?, expect_updated_at}` par collection (sans `auto` : règles et
     exclusions inchangées). Puis **un seul message** pour toutes : « 3 cartes ajoutées automatiquement à « Maladies ». »,
     « 4 cartes ajoutées automatiquement : 1 à « Maladies », 2 à « Virus » et 1 à « Grande ». », mis à la suite du
     message encore affiché (« Mis à jour depuis wiki-masters.com : … »). Rien à ajouter : aucune requête (sans
     collection à règles, la page fait exactement les mêmes lectures qu'avant).
   - **Limites** (celles de `targets.js`, vérifiées avant l'envoi) : seulement les cartes qui tiennent (1,7 Mo
     d'éléments en JSON), dans l'ordre de A à Z ; les autres sont dites dans le message (« « Grande » est pleine :
     2 cartes de ses règles d'ajout automatique n'ont pas pu y entrer (1,7 Mo au plus par collection). »), une fois (pas répété à chaque synchro tant que rien ne change) ; une erreur du serveur (5 Mo par
     compte…) : « Ajout automatique à « … » impossible : … », une fois aussi. Rien d'autre n'est touché.
   - **Où et pourquoi** : dans la page, pas dans le serveur à la fin d'un import. Seule la page rapproche les titres par
     qid (résolus sur Wikipédia ; le serveur n'a pas les qids des cartes) et replie tags et catégories exactement comme la
     fenêtre ; `import.js` et `refresh.js` (longs, par morceaux) restent tels quels. Contrepartie : l'ajout se fait quand
     une page du classeur est ouverte (à l'ouverture suivante au plus tard).
   - **Deux onglets, deux appareils** : chaque envoi porte `expect_updated_at` = le `updated_at` de la collection sur
     laquelle il a été calculé ; si un autre enregistrement est passé avant (l'autre onglet vient d'ajouter les mêmes
     cartes, ou une carte vient d'être retirée ailleurs), le serveur répond `409` avec la collection d'aujourd'hui, la page
     la reprend et recalcule (en général : plus rien à ajouter, aucun message), deux fois au plus. Jamais de doublon, et
     jamais une liste périmée écrite par-dessus. Dans une même page, un seul passage à la fois (une arrivée de cartes
     pendant un passage en relance un à la fin) ; changement de classeur : abandonné.
   - **Exclusions** (`skip`) : une carte **décochée dans l'aperçu**, ou **retirée ensuite de la collection** — bouton
     « Retirer de « … » » de la fiche (`auto_skip.add`, message « « Peste » retirée de « Maladies » : elle n'y sera plus
     ajoutée automatiquement. », son « Annuler » la remet et lève l'exclusion : `auto_skip.del`), ou éditeur « Modifier »
     (titres présents à l'ouverture et absents à l'enregistrement : `add`) — n'est jamais rajoutée automatiquement. Une
     carte **remise à la main** (recochée dans la fenêtre, retapée dans l'éditeur, ramenée par « Fusionner avec… »,
     « Annuler » d'un retrait) n'est plus exclue (`del`). Seulement pour une collection qui a des règles (sinon rien n'est
     envoyé, et le serveur ignorerait `auto_skip`).
   - **Visible et réversible** : dans l'album d'une collection qui a des règles, sous ses actions, une ligne « Ajout
     automatique : tag du jeu « Maladie », catégorie du jeu « maladie » » (« tags du jeu « A » et « B » », « tag du
     classeur « Sciences › Maladie » » ; « · 2 cartes exclues » s'il y en a), avec **« Changer les règles »** (la fenêtre,
     règles cochées) et **« Arrêter »** : `targets/save` avec `auto: null` (et `expect_updated_at`, la collection
     d'aujourd'hui reprise sur `409`) ; règles et exclusions effacées, **les cartes déjà ajoutées restent** ; message
     « Ajout automatique arrêté pour « … » : les cartes déjà ajoutées restent. » avec **« Annuler »** (10 s : règles et
     exclusions remises, puis un passage d'ajout automatique). Les autres actions de la collection (« Modifier »,
     « Réorganiser », intercalaire, « Fusionner avec… ») n'envoient pas `auto` : les règles restent.

   **Retirer une carte d'une collection** (2026-10-18) : la fiche d'une carte (possédée ou case vide) ouverte depuis
   l'album d'une de tes collections a, sous la case « Intercalaire », un bouton « Retirer de « <collection> » » : la
   collection est renvoyée sans cet élément (`POST /api/targets/save`), la fiche se ferme, et le message « « <titre> »
   retirée de « <collection> ». » propose **« Annuler »** (10 s) : l'élément est remis à sa place, avec tous ses champs.
   Collection qui a un ajout automatique : la carte est aussi exclue (`auto_skip.add`), le message le dit (« … : elle
   n'y sera plus ajoutée automatiquement. ») et « Annuler » lève l'exclusion (`auto_skip.del`).
   Pas de bouton depuis « Mes cartes », l'album d'une catégorie ou d'une page de Wikipédia, ni celui d'un ami.
   **« Réorganiser »** (2026-10-18, demande de l'utilisateur : « Il faudrait aussi qu'on puisse réorganiser les cartes
   d'une collection à la main. ») : dans l'album d'une de tes collections **qui a un ordre** (à la main, du jeu `wm:`, de
   la colonne clé d'une page `links:<titre>#<colonne>`, `wd`, `cat`… : tout sauf `wp:`, `links:<titre>` sans colonne et les
   anciens thèmes du catalogue sans ordre), après « Modifier », s'il y a 2 éléments au moins. Il passe l'album en **mode
   réorganisation** (tri « Ordre » et filtre « Toutes » remis, sélection vidée, fiche fermée) :
   - **tous les éléments** (pas de « Afficher les suivantes »), dans l'ordre, en **vignettes réduites** (image 4:3 : ta
     carte, sinon l'article ; numéro ; titre sur 2 lignes ; bord de la rareté de ta carte, pointillé pour une case vide,
     bord et onglet gris pour un intercalaire), 4 par ligne à 390 px, plus en large ; jusqu'à 3 000 sans ramer : chaque
     vignette est un petit composant redessiné seulement si son numéro ou son état change, et celles hors de l'écran ne
     sont pas peintes (`content-visibility: auto`) ; mesuré dans Chrome (2026-10-18) : 250 ms pour entrer en mode
     réorganisation avec 3 000 éléments, 70 à 80 ms par déplacement. **Les sections restent visibles** : un intercalaire commence une
     nouvelle ligne, et il bouge comme les autres en gardant son rôle (`sep` suit l'élément) ;
   - **glisser** (pointer events, pas le glisser-déposer HTML5 qui ne marche pas au doigt) : à la souris, toute la
     vignette (après 6 px) ; **au doigt ou au stylet, par sa poignée** (⠿, en haut à droite, 30 px, 36 px sur un écran
     tactile, `touch-action: none`) :
     ailleurs, la page défile normalement. Choix d'une poignée plutôt que d'un appui long : visible, immédiate, sans
     conflit avec le défilement ni avec le menu du système. Pendant le geste : la vignette pâlit, un fantôme suit le
     pointeur, un **repère d'insertion** (barre émeraude) montre où elle ira ; lâchée sur la moitié gauche ou droite d'une
     vignette : avant ou après elle ; avant un intercalaire = à la fin de la section d'avant (le repère va après sa
     dernière vignette) ; dans le trou d'une ligne courte : après la vignette à sa gauche ; la page défile seule près du
     haut et au-dessus de la barre du bas ; Échap annule le geste ;
   - **pour tous, au clavier compris** : « ← » / « → » sous chaque vignette (« « Afrique » : une place avant / après » ;
     aux deux bouts, `aria-disabled` : le focus reste, l'annonce dit « déjà en tête / à la fin ») ; après un déplacement,
     le focus reste sur la flèche de l'élément déplacé. Une vignette **choisie** (clic, toucher, ou focus sur ses flèches)
     apparaît dans la **barre du bas** (fixe, comme la bande de sélection) : « <titre> · 3 sur 20 », « En tête », « À la
     fin », champ « N° » + « Déplacer » (position de 1 à N ; hors bornes : « Position : un nombre entier de 1 à N. ») ;
   - **annonce** pour les lecteurs d'écran (`role=status`, cachée à l'œil) à chaque déplacement : « « Afrique » : position 3
     sur 20. » (« (intercalaire) » pour un intercalaire), « Déplacement annulé. », « … reste à sa place. » ;
   - **« Enregistrer l'ordre »** (grisé tant que l'ordre est celui de la collection ; la barre dit « Ordre modifié, pas
     encore enregistré » / « Ordre inchangé ») : **une seule requête** `POST /api/targets/save {id, name, items, source?}`,
     les éléments tels que rangés (**tous leurs champs** : `qid`, `rarity`, `description`, `image`, `status`, `sep`) dans
     le nouvel ordre ; le mode se referme, l'album montre le nouvel ordre, et le message « Nouvel ordre de « … »
     enregistré. » propose **« Annuler »** (10 s : l'ordre d'avant renvoyé). Échec : erreur dans la barre, brouillon gardé ;
   - **« Annuler »** : rien n'est envoyé, l'album revient comme avant ; s'il y avait des changements, le message « Ordre de
     « … » laissé tel quel : rien n'a été envoyé. » propose **« Reprendre »** (le brouillon revient).
   **Quitter avec des changements non enregistrés** (« ← Toutes les collections », un autre album, un autre onglet) : le
   **brouillon est gardé** (en mémoire, un seul à la fois), un message le dit une fois (« Le nouvel ordre de « … » n'est
   pas encore enregistré : il t'attend dans son album. », **« Y revenir »**), et l'album de cette collection rouvre le mode
   réorganisation avec lui. Recharger ou fermer la page avec un brouillon modifié demande d'abord (`beforeunload`, message
   du navigateur). Sans changement, quitter referme simplement le mode. « Réorganiser » une autre collection pendant qu'un
   brouillon modifié attend : confirmation (« Le nouvel ordre de « … » n'est pas enregistré. L'abandonner pour réorganiser
   « … » ? »). Collection changée entre-temps par la page : le brouillon est reporté sur ses éléments d'aujourd'hui (par
   titre ; disparus retirés, nouveaux à la fin) ; supprimée : brouillon abandonné (message). Changement de classeur :
   brouillon oublié.
   **Collection sans ordre** : « Réorganiser… » (même place) ouvre une explication au lieu du mode. Faite d'une **catégorie
   ou des liens d'une page** (`wp:` / `links:<titre>`) : elle reste LA collection de cette source (une seule par compte :
   `targets/save` remplace au lieu de doubler, « Catégories » propose de l'ouvrir) ; lui retirer sa source pour lui donner un
   ordre casserait ce dédoublonnage (une seconde collection de la même catégorie redeviendrait possible) et son lien
   « Voir sur Wikipédia » : elle ne se réorganise donc pas. Proposé à la place : **« Créer la copie et la réorganiser »**,
   une nouvelle collection « <nom> (mon ordre) » (80 caractères au plus), **sans source**, mêmes éléments (tous leurs
   champs), de A à Z pour commencer, ouverte en mode réorganisation ; l'originale reste telle quelle. **Ancien thème du
   catalogue sans ordre** (`catalog:<id>`) : rien ne dépend de sa source (ni dédoublonnage, ni lien) ; **« Passer en ordre
   manuel »** la renvoie sur place (même `id`, source retirée, éléments dans l'ordre affiché, de A à Z), numérotée, puis
   ouvre le mode réorganisation. Pas de bouton dans l'album d'une catégorie ou d'une page de Wikipédia (pas encore une
   collection), ni dans celui d'un ami.
   **« Fusionner avec… »** (album de toute collection, entre « Modifier » et « Supprimer », seulement si tu as une autre
   collection ; demande de l'utilisateur du 2026-10-18 : « un bouton pour fusionner deux collections ») : la collection
   d'où l'on part **reçoit la fusion** (même `id`, même source, même place dans « Mes collections »). Une fenêtre, calculée
   dans la page sans requête jusqu'à l'enregistrement :
   - **l'autre collection** : tes autres collections, de A à Z, en boutons radio, avec leur taille (« 7 éléments ») et
     leur origine (« depuis la catégorie Wikipédia « … » » / « depuis la page Wikipédia « … » ») ; rien de choisi à
     l'ouverture (bouton « Fusionner » grisé) ;
   - **la fusion** : les éléments de la collection de départ **dans leur ordre**, puis ceux de l'autre qui n'y sont pas
     déjà, dans l'ordre de l'autre ; « déjà là » = même titre (replié comme partout : `Match.normTitle`) **ou** même qid
     (celui de l'élément, sinon celui que la page a résolu pour son titre sur Wikipédia : une redirection compte). Un
     élément déjà là garde sa place et ses champs, et **reçoit ce qui lui manque** de l'autre : `qid`, `description`,
     `image`, `rarity` (rareté du jeu) et, à titre égal, `status: 'ok'` à la place de `missing`/`disambiguation` ; jamais
     de `sep` en plus. Les éléments ajoutés sont recopiés tels quels (`{title, description, image, status, qid?, rarity?,
     sep?}`), **intercalaires compris**. Dans une collection qui a un ordre (pas `wp:`, `links:` ni un ancien thème du
     catalogue sans ordre : en tri « Ordre », un intercalaire commence une ligne), un intercalaire de l'autre **déjà
     présent** passe sa marque à la première carte ajoutée de sa section (la section reste séparée), et une case
     **« Ouvrir la partie ajoutée par un intercalaire »** (décochée d'emblée ; absente si la première carte ajoutée en est
     déjà un, ou s'il n'y a rien à ajouter) fait de la première carte ajoutée un intercalaire : la partie venue de l'autre
     commence une nouvelle ligne. Un intercalaire étant une vraie carte (un article), il ne peut pas porter le nom de
     l'autre collection : c'est la première carte ajoutée qui ouvre la partie ;
   - **aperçu** : « N éléments ajoutés, M déjà présents » (`role=status` ; rien à ajouter : « Rien à ajouter : les M
     éléments de « … » sont déjà dans « … ». », ou « « … » est vide. ») ; « Après la fusion : T éléments, dont K que tu
     as. », éléments déjà présents complétés, intercalaires de la partie ajoutée ; les 30 premiers éléments ajoutés (ta
     rareté si tu as la carte, « intercalaire »), puis « … et N éléments de plus » ;
   - **nom** de la collection fusionnée (80 caractères au plus), par défaut celui de la collection de départ ;
   - **« Supprimer « … » après la fusion »**, **cochée d'emblée** (fusionner, c'est faire une collection de deux, et tous
     les éléments de l'autre sont dans la collection fusionnée : on ne perd que son nom, son ordre et sa source ; le bouton
     le dit : « Fusionner et supprimer « … » ») ; décochée : l'autre reste telle quelle (bouton « Fusionner »). Rien à
     ajouter ni à compléter, même nom : seule la suppression reste (« Supprimer « … » »), décochée le bouton est grisé.

   **Enregistrement** : une seule requête `POST /api/targets/save {id, name, items, source?}` (id et source de la
   collection de départ), sautée s'il n'y a rien à changer (seulement la suppression) ; puis, si la case est cochée,
   `POST /api/targets/delete {id}` de l'autre. La suppression ne vient **qu'après** un enregistrement réussi : un échec de
   l'enregistrement ne touche à rien (erreur dans la fenêtre) ; la fenêtre se ferme dès l'enregistrement réussi ; un
   échec de la suppression laisse l'autre telle quelle, la fusion reste enregistrée et un message d'erreur le dit
   (« Mais « … » n'a pas pu être supprimée (…) : elle est restée telle quelle, supprime-la depuis son album. ») ; s'il n'y
   avait que la suppression, la fenêtre reste ouverte avec l'erreur. Réussite : « « Autre » fusionnée dans
   « Nom » : N éléments ajoutés, M déjà présents ; « Autre » supprimée. ». Classeur changé pendant l'enregistrement : la
   suite est abandonnée. **Limite de `targets.js` vérifiée avant l'envoi** : plus de 1,7 Mo d'éléments en JSON (octets UTF-8) : si les images seules font dépasser, la fusion se fait
   **sans les images** (`image: null` partout, comme `targets/from-game` : la page retrouve les vignettes sur Wikipédia ;
   l'aperçu le dit), sinon « Collection fusionnée trop volumineuse : N Ko (même sans les images), 1,7 Mo au plus. »,
   bouton grisé. Les 5 Mo par compte restent contrôlés par le serveur (erreur affichée telle quelle).

   **Source** : la collection fusionnée garde **celle de la collection de départ** et aucune autre requête ne crée de
   collection : jamais de doublon de source `wp:`/`links:` (une seule collection par catégorie, ou par choix d'une page). Partie
   d'une collection faite d'une catégorie ou d'une page : elle garde sa source et reste de A à Z (la fenêtre le dit, et
   n'offre pas d'intercalaire en tête), comme avec « Ajouter par tags du jeu » ou « Modifier ». L'autre faite d'une catégorie ou
   d'une page et supprimée : sa source disparaît avec elle (la fenêtre le dit) ; la catégorie peut de nouveau être créée
   en collection depuis « Catégories ». Reprendre la source de l'autre changerait l'ordre d'affichage de la collection de
   départ (de A à Z) : pour garder celle de l'autre, partir de l'autre.
2. **Catégories et pages de Wikipédia** (onglets « Par URL » et « Propositions » de « Nouvelle collection » : des sources
   d'où créer une collection, pas une liste à part) :
   - **Recherche avec suggestions** (combobox accessible : ↑ ↓, Entrée, Échap, `aria-activedescendant`) sur toutes les
     catégories de Wikipédia **et les pages « Liste de… »** : 250 ms après la dernière frappe (2 caractères au moins,
     « Catégorie: » retiré), **trois requêtes au plus** :
     1. `action=query&generator=prefixsearch&gpsnamespace=14&gpslimit=20&prop=categoryinfo` (catégories par préfixe,
        avec leur taille) et, dans la même requête (si le texte a un mot de 3 lettres ou plus),
        `list=search|prefixsearch&srsearch=intitle:liste <texte>&srnamespace=0&srlimit=10&pssearch=<texte>&psnamespace=0&pslimit=8`
        : les pages « Liste de… » dont le titre contient tous les mots du texte (au singulier : « races bovines » →
        race, bovine), et les articles par préfixe ;
     2. `action=query&titles=…&redirects=1&prop=categoryinfo|pageprops&ppprop=disambiguation` (titres exacts) :
        `Catégorie:<Texte>` et sa forme au singulier (mots de 5 lettres et plus : « Catégorie:Race bovine »),
        `Catégorie:<nom>` pour les articles par préfixe qui commencent par le texte (sans précision entre parenthèses :
        « Violet (couleur) » → « Catégorie:Violet »), et `Liste de <texte>` / `Liste d'<texte>`, `Liste des <texte>`
        (ou le texte lui-même s'il commence par « Liste ») : le préfixe de Wikipédia classe par popularité et peut
        laisser de côté la catégorie exacte (limite : « viol » ne propose pas « Violet », que ni le préfixe ni les
        titres exacts ne trouvent ; « violet » la met en tête) ;
     3. seulement s'il reste moins de 5 catégories : `generator=search&gsrnamespace=14&gsrlimit=20&prop=categoryinfo`
        (plein texte), dont seules restent les catégories dont le nom a tous les mots du texte (au singulier, accents
        ignorés : « noms de couleur » ramenait « Chanson contre le racisme et la xénophobie »).
     Écartées : catégories cachées (`categoryinfo.hidden`), de maintenance (ébauches, homonymies, pages à…), vides ;
     pages d'homonymie. **Classement** : nom exact (au singulier près, ou titre exact atteint par une redirection),
     puis qui commence par le texte, puis dont un mot commence par le texte, puis le reste (plein texte) ; à rang égal,
     la catégorie qui a le plus d'articles d'abord, les pages dans l'ordre de la recherche. **Deux groupes**, chacun
     sous son titre (`role=group`) : « Catégories » (8 au plus, avec leur nombre d'articles `categoryinfo.pages` et
     leurs sous-catégories) et « Pages de liste » (4 au plus, « liste » à la place de la taille : le nombre de liens
     n'est connu qu'à l'ouverture), 10 suggestions en tout ; le groupe qui a le meilleur rang d'abord (à égalité, les
     catégories) ; « ta collection » si tu en as déjà fait une. **Adresse collée** : une adresse de fr.wikipedia.org
     (`/wiki/…` ou `/w/index.php?title=…`, `fr.m.` aussi, encodée ou non, fragment et paramètres ignorés) ne cherche
     rien : une seule requête titres exacts sur la page elle-même (redirection suivie), une seule suggestion (groupe
     « Catégories » pour une catégorie, « Page Wikipédia » pour toute autre page : liste, article, portail…) ; collée
     (`inputType` `insertFromPaste`), elle s'ouvre aussitôt, tapée il faut Entrée. Page absente : « Cette page n'existe
     pas sur Wikipédia : « … ». » ; adresse d'un autre site (en.wikipedia…) : aucune requête, la page demande une adresse
     de Wikipédia en français. Une seule requête à la fois (file des requêtes Wikipédia de la page, 300 ms d'écart,
     429/5xx : attente de `Retry-After` puis nouvel essai), la recherche précédente abandonnée (`AbortController`),
     réponses gardées en mémoire pendant la visite (60 au plus, texte replié ou titre de l'adresse). En attendant les
     suggestions d'un nouveau texte, celles du précédent restent, estompées ; Entrée ouvre la suggestion active si la
     liste est celle du texte tapé (ou choisie aux flèches), sinon la recherche part aussitôt et sa première suggestion
     s'ouvre à son arrivée, **si l'on est encore dans le champ** : quitter le champ, changer d'onglet, ouvrir ou fermer
     un album oublie cette Entrée. Une suggestion choisie : le focus va au titre de l'album ouvert (`#album-name`,
     `tabindex=-1`).
   - **Album d'une catégorie** (choisie dans les suggestions ou les propositions), badge « catégorie de Wikipédia » :
     ses articles (`list=categorymembers`, espace principal, 20 000 au plus ; « inclure les sous-catégories (1 niveau :
     N) » si elle en a, cochée d'emblée quand on l'ouvre depuis une proposition qui regroupe des sous-catégories), la
     progression avec tes cartes (titre puis qid), la rareté estimée des cases vides d'après les vues, comme les autres
     albums, de A à Z sans numéros ; « Voir sur Wikipédia » ; **« Créer une collection »** = `POST /api/targets/save
     {name, items, source:'wp:<nom>'}` (nommée comme la catégorie ; articles lus, avec ceux des sous-catégories si la
     case est cochée ; impossible au-delà de 20 000 articles, ou si elle dépasse 1,7 Mo) : l'album devient celui de la nouvelle collection (dans
     « Mes collections »). Tu en as déjà une (source `wp:<nom>`) : **« Ouvrir ta collection »** à la place.
     « Créer une collection » de sa proposition en cours : le bouton attend (« Un instant… »), puis l'album passe à la
     collection créée ; jamais deux collections de même source (voir aussi `targets/save`).
   - **Album d'une page** (suggestion « Pages de liste », adresse collée), badge « page de Wikipédia » : les articles
     qu'elle lie (`generator=links&gplnamespace=0&gpllimit=max&redirects=1&prop=pageprops`, liens rouges, pages
     d'homonymie et la page elle-même écartés, 5 000 liens lus au plus), avec leur nature (P31) et leur description
     Wikidata (SPARQL par 200), comme les pages « Liste de… » de « Nouvelle collection » (même lecture, `pageLinks`).
     **Nature dominante** : la nature la plus fréquente, si elle concerne au moins 3 liens et 20 % d'entre eux sans
     les concerner tous ; un article en est s'il a cette nature, une de ses **sous-classes** (une requête SPARQL
     `?c wdt:P279+ wd:<nature>` sur les natures vues : « couleur primaire » pour « couleur ») ou, sinon, une
     **description** Wikidata qui la nomme dans ses quatre premiers mots (« nom de couleur »). Case « ne garder que les
     « <nature> » (N sur M articles liés ; décochée : tous les liens) », cochée d'emblée (les liens déjà lus : sans
     requête) ; sans nature dominante, la page le dit et garde tous les liens. Mesuré le 2026-10-16 : « Liste de noms de
     couleur » lie 247 articles, 181 gardés (103 par la nature « couleur » seule, 134 avec ses sous-classes) ;
     « Liste de races bovines » : 355 sur 589 (330 par la nature seule). Progression, rareté estimée, de A à Z sans
     numéros, « Voir sur Wikipédia » (la page) ; **« Créer une collection »** = `POST /api/targets/save {name, items,
     source:'links:<titre>'}` (nom : le titre sans « Liste de / des / d' », première lettre en majuscule, 80 caractères
     au plus ; éléments `{title, description, image:null, status:'ok', qid}` ; impossible au-delà de 20 000 articles
     gardés) : l'album devient celui de la nouvelle collection ; déjà faite (même source : même page, et même colonne et
     mêmes sections) : **« Ouvrir ta collection »** (« ta collection », ou « N de tes collections », dans les
     suggestions). Une page donne **une collection par choix** (2026-10-19) : tous ses liens, la colonne clé de tous ses
     tableaux, ou de certaines sections ; l'album de la page cite celles déjà faites (« Tes collections de cette page :
     … », chacune s'ouvre d'un clic), et l'album d'une collection faite d'une colonne clé a **« Autres sections de la
     page »**, qui rouvre la page (tableaux et liens déjà lus dans la session : sans requête) pour en faire une autre.
   - **Colonne clé des tableaux d'une page** (2026-10-18, demande de l'utilisateur : « quand on crée une collection en
     partant d'une page de type liste qui contient une liste sous forme d'un ou plusieurs tableaux, l'interface doit
     proposer la colonne à choisir comme clé ») : dans « Liste des pays du monde », « Liste des présidents de la
     République française »…, les liens des autres colonnes (villes, partis, élections) se mêlent aux bons.
     - **Lecture** : avant ses liens, le HTML rendu de la page, une requête
       (`action=parse&page=<titre>&prop=text&redirects=1&disableeditsection=1&disablelimitreport=1&disabletoc=1` : les
       modèles qui font les lignes y sont développés, ce que le wikicode ne donne pas). Il est analysé par `DOMParser`
       dans un document à part, **inerte** (aucun script exécuté, aucun gestionnaire, aucune image chargée ; vérifié dans
       Chrome : un `onerror`, un `<script>`, un `onclick` analysés ne font rien) et **jamais inséré** dans la page : on
       n'en garde que des textes et des titres. Les attributs `style` deviennent `data-style` et les `<style>` sont
       retirés avant l'analyse (le document créé hérite de la CSP de la page, qui signalerait chacun dans la console).
       Échec de cette lecture : la page garde ses liens et le dit (« Tableaux de la page non lus (…) »).
     - **Tableaux** : ceux de classe `wikitable` (repliés compris, pas ceux imbriqués dans un autre), cellules fusionnées
       (`rowspan`, `colspan`) dépliées dans une grille, chacun avec ses intertitres (h2 › h3 › h4 en cours : « Gares
       desservies en 2026 › À l'étranger › Allemagne ») et sa légende.
       En-tête : les premières lignes faites de `<th>` (ou dans `<thead>`), une ligne d'une seule cellule sur toute la
       largeur (titre) mise à part ; **libellé** d'une colonne = ses en-têtes de haut en bas (« Mandat › Début »), sans
       notes (« [1] », « [pas clair] ») ni clés de tri cachées (`display:none`) ; deux colonnes sous une même cellule
       d'en-tête (« Appartenance politique » : couleur et nom) n'en font qu'une ; sans en-tête : « Colonne 1 »… Lignes de
       données : les suivantes, sauf une cellule seule sur toute la largeur (intertitre, commentaire « intérim ») et un
       en-tête répété. Pour chaque ligne et chaque colonne : le **premier lien d'article** de la cellule (lien bleu de
       l'espace principal, `/wiki/…`, dont le texte se voit : ni image seule — drapeau, portrait —, ni note, ni lien
       rouge, interlangue ou externe). Le premier seulement : dans la colonne clé c'est le sujet de la ligne, les liens
       suivants de la même cellule le précisent (nationalité, lieu, parti, « (intérim) ») et ramèneraient ce que la
       colonne clé écarte.
     - **Colonnes proposées** : celles de même libellé (au repli près) dans plusieurs tableaux n'en font qu'une (« Forme
       courte » des 24 tableaux A à Z des pays) ; un lien retrouvé parmi les liens de la page (`pageLinks`, redirection
       suivie, ni lien rouge ni homonymie) donne l'article de la ligne, avec son qid et sa description. Gardées : celles
       qui donnent au moins 2 articles différents, dans l'ordre où elles apparaissent ; nom court (la dernière ligne
       d'en-tête, « Nom » ; le libellé entier si deux colonnes ont le même nom court). **Présélection** : la mieux notée,
       articles différents × (½ + ½ part des liens dont le texte nomme l'article : « Adolphe Thiers » oui, « 1873 » pour
       une élection, « 2 » pour « Présidence de … » non) × 1,5 si son en-tête reprend un mot du titre (« Nom de couleur »)
       × (1 + ¼ part de la nature dominante des liens de la page) × 0,9 par colonne gardée à sa gauche ; à égalité, la plus
       à gauche. Elle est choisie d'emblée si elle donne au moins 3 articles et au moins le quart de ce que donnent les
       liens de la page (nature dominante, ou tous), ou, pour une page dont le titre commence par « Liste », si ses liens
       d'articles sont au moins aussi nombreux dans ses tableaux que dans ses listes à puces (bandeaux, boîtes de
       navigation, infobox, notes et références non comptés) ; sinon la page garde **tous ses liens** (« Aucune »), la
       colonne restant proposée.
     - **Album** : « Colonne clé » (liste déroulante, `#page-key`) : chaque colonne avec son nombre d'articles, puis
       « Aucune : tous les liens de la page (N) » (le mode ci-dessus, nature dominante comprise). Colonne choisie : une
       explication (« Le premier article lié de chaque ligne de la colonne « Nom » des 2 tableaux de la page « … », dans
       l'ordre des lignes : N articles (k lignes sans article : lien rouge, homonymie ou pas de lien). Les autres tableaux
       de la page n'ont aucun article dans une colonne « Nom ». »), et, si la colonne est dans plusieurs tableaux,
       **« Sections et tableaux lus : n sur m »** (repliable, ouvert d'emblée quand ses tableaux ont des intertitres ;
       « Tableaux lus » sinon) : l'arbre des intertitres de ces tableaux (2026-10-19, demande de l'utilisateur : dans
       « Liste des gares desservies par TGV », pouvoir choisir « En France », « À l'étranger »…), une case par section
       (« À l'étranger (48 articles, 8 tableaux) ») qui coche ou décoche tous ses tableaux d'un coup, cochée s'ils le sont
       tous, « mixte » (`indeterminate`) si une partie ; deux intertitres de même nom sous des parents différents (« En
       France » des gares desservies et des gares fermées) restent deux sections. Une case par tableau seulement sous une
       section qui en a plusieurs (ou à côté de sous-sections), et pour les tableaux sans intertitre (« Tableau 2 ·
       <légende> (N articles) »). Rien ne se décoche s'il ne resterait aucun tableau (la case est alors grisée). Articles **dans l'ordre des tableaux et des lignes**,
       chacun une fois (un doublon garde sa première place), **numérotés** (tri « Ordre ») ; tout se recalcule sans
       requête. Sans colonne : la case de la nature dominante, comme avant.
     - **« Créer une collection »** avec une colonne : `POST /api/targets/save {name, items, source:'links:<titre>#<nom
       court de la colonne>'}` (mêmes nom et éléments que ci-dessus, dans l'ordre), message « Collection « … » créée : N
       articles (colonne « Nom » des tableaux de la page, dans l'ordre), dans « Mes collections ». ». Plus de 20 000
       articles : « décoche des tableaux ». **Une partie des tableaux seulement** (2026-10-19, demande de l'utilisateur :
       « une par section, ou tout ensemble ») : source `links:<titre>#<colonne>#§<sections>`, une collection de plus ;
       `<sections>` = les sections entièrement cochées les plus hautes, séparées par « + » (« À l'étranger », « En
       Testlande + Gares fermées »), un intertitre qui a un homonyme dans la page précédé de celui au-dessus (« Gares
       desservies en 2026 › En France »), et les tableaux cochés seuls sous une section en partie cochée (leur légende,
       ou « Tableau N ») ; source de plus de 200 caractères : coupée, avec une empreinte (FNV-1a) du texte entier. Nom :
       celui de la page, « — » et les sections (« Gares desservies par TGV — À l'étranger », 80 caractères au plus) ;
       message « (colonne « Gare » des tableaux de la page, section « À l'étranger », dans l'ordre) » ; ligne de la
       collection : « depuis la page Wikipédia « … », colonne « Gare », section « À l'étranger » ». Tout recoché : la
       source de toute la colonne, celle d'avant.
     - **« Nouvelle collection »** (mots-clés), candidat « Page Wikipédia » : même lecture, même présélection et même
       « Colonne clé » (`#kw-key`, tous les tableaux, sans « Tableaux lus »), aperçu dans l'ordre des lignes (« Colonne
       « Nom » des tableaux de la page « … », dans l'ordre des lignes ») ; la collection y reste enregistrée sans source,
       comme avant (donc numérotée, dans cet ordre).
     - Mesuré le 2026-10-18 sur les vraies pages (Chrome sans fenêtre) : « Liste des éléments chimiques » : « Nom », 118
       éléments dans l'ordre des numéros atomiques ; « Liste des présidents de la République française » : « Titulaire »
       (4 tableaux, 26 présidents ; ses 713 liens n'ont aucune nature dominante) ; « Liste des pays du monde » : « Forme
       courte » (24 tableaux, 197 pays) ; « Liste des plus hauts gratte-ciel du monde » : « Nom » (7 tableaux, 264) ;
       « Liste de races bovines » : « Nom » (23 tableaux, 353) ; « Liste des départements français » : « Nom » (102, et
       pas les arrondissements, nature dominante de ses liens) ; « Liste de noms de couleur » : « Nom de couleur » (189,
       contre 181 par la nature dominante) ; « Liste de fromages français » (aucun tableau) : ses liens, comme avant.
   - **Pendant la lecture** d'une catégorie ou d'une page (une page lit ses tableaux, ses liens, puis leur nature sur Wikidata : 5 à
     15 s mesurés le 2026-10-16 pour « Liste de noms de couleur ») : une ligne d'état avec la roue dit l'étape
     (« Lecture des tableaux de la page sur Wikipédia… », « Lecture des liens de la page sur Wikipédia : N articles
     liés… », « Nature des N articles liés, sur Wikidata (lot k sur n)… » ; catégorie : « … N articles lus… », sous-catégorie k sur n). « Créer une collection » reste
     cliquable, avec la roue (`aria-busy`) : cliqué, il devient « Créée dès la fin de la lecture… » (grisé) et la
     collection est créée dès que la lecture finit, sans second clic. Grisé seulement après une erreur de lecture
     (« Réessayer »), et alors rien n'est créé.
   - **« Proposées d'après tes cartes »** (`propose.js`) : catégories de tes cartes dont tu as au moins 5 % et 2 cartes,
     ni déjà en collection (source `wp:<nom>`) ni retirées, **sans les sous-catégories** d'un thème déjà là (règles
     appliquées à l'affichage, sans requête, `ClasseurPropose.prune`) :
     1. **couverte** : au moins 80 % des cartes qui la rendent proposable (celles comptées pour les 5 % et les 2 cartes)
        sont déjà dans **une même** de tes collections, quelle qu'en soit la source (rapprochement titre puis qid,
        comme les albums) → pas proposée (une collection « Couleurs » qui a tes cartes rouges : « Rouge » n'est pas
        proposée). C'est aussi ce qui écarte les filles d'une catégorie dont tu as une collection **avec ses
        sous-catégories** (leurs articles y sont). Une collection faite d'une catégorie **sans** ses sous-catégories
        n'écarte pas ses filles : sur Wikipédia, un article est rangé dans la catégorie la plus précise, la parente ne le
        contient pas (« Race bovine originaire d'Europe » n'a pas les races d'Italie ni d'Espagne) ;
     2. **hiérarchie** : les catégories parentes visibles de chaque proposition sont relevées au calcul
        (`action=query&prop=categories&clshow=!hidden&cllimit=max` sur les pages de l'espace 14, 50 par requête, même
        file et cache de 14 jours que le reste, `classeur-catparents` ; un incident ici n'empêche pas les propositions) ;
        une catégorie dont une parente est **elle-même proposée** n'est pas proposée à part : la parente seule reste et
        la **regroupe** (d'une chaîne, la plus haute ; catégories parentes les unes des autres, en cycle de 2 ou plus :
        la plus grande, à taille égale la première de A à Z). La parente dit combien elle en regroupe (« Regroupe 3
        sous-catégories proposées : Jaune, Rouge et Vert. La collection est créée sous-catégories comprises. ») et son
        « Créer une collection » prend ses articles, ceux de ses sous-catégories (1 niveau) et ceux des propositions
        regroupées plus bas (petites-filles) ; plus de 20 000 ainsi : ses articles et ceux des seules propositions
        regroupées ; encore trop : refusé (l'ouvrir pour en faire une collection sans ses sous-catégories). Si la
        parente n'est pas proposable (seuils, retirée, couverte, déjà en collection), les filles restent.
     Chaque proposition dit pourquoi elle est là (« Tu as : Coquelicot, Fraise et 3 autres » : les cartes comptées).
     Le nom ouvre l'album, « Créer une collection » (on reste sur la liste, la collection passe dans « Mes
     collections »), « Retirer » (`prefs.hidden_proposals`), « Voir sur Wikipédia » ; « Chercher de nouvelles
     propositions », « Rétablir les propositions retirées », « Masquer les propositions » (`prefs.hide_proposals` : plus
     rien n'est cherché sur Wikipédia tant qu'elles sont masquées ; un calcul en cours s'arrête aussitôt). Catégories
     couvertes : la page le dit, avec la collection qui en couvre le plus (« 2 autres catégories de tes cartes écartées
     car déjà couvertes par « Couleurs ». » ; sans autre proposition : « Pas de nouvelle proposition : 3 catégories de
     tes cartes sont écartées car déjà couvertes par tes collections, surtout « Couleurs » (au moins 80 % de leurs
     cartes y sont déjà). »).
   - **Courses** : changement de classeur pendant une création (lecture des articles, enregistrement) : rien n'est
     enregistré ni montré dans l'autre classeur (garde `cardsGen`), et les propositions de l'ancien (calcul en cours,
     liste, créations en cours) sont oubliées ; une relecture de `GET /api/me` (retour sur l'onglet, minuterie des
     60 s) partie avant ou pendant un changement des préférences ne le défait pas ; la relecture des collections après un
     chargement des cartes ne coupe pas la résolution des qids de l'album ouvert (deux résolutions à part).

**Intercalaires et collections complètes** (2026-10-17, demande de l'utilisateur) :

- **Intercalaire** (élément `sep: true`) : une carte qui ouvre une section (« Continent », « Sous-continent »,
  « Supercontinent » dans « Continents et Sous-continents »), et qui reste une carte comme les autres. Dans les grilles
  d'album (les tiens, et ceux des collections d'un ami, en lecture seule), la carte possédée ou la case vide est posée sur
  un **cadre gris clair à onglet** (`.sep-frame`, 4 px autour, onglet en haut à gauche, derrière la carte : elle passe
  devant quand elle se soulève au survol) ; son nom accessible dit « intercalaire ». En tri « Ordre », **sans filtre**
  (« Toutes ») et pour une collection qui a un ordre, un intercalaire **commence une nouvelle ligne** de la grille (une
  ligne vide de toute la largeur avant lui, `.grid-break`, sauf en tête : l'écart entre deux sections est doublé) ; en tri
  « A → Z », « Rareté », « Prix ↑/↓ » ou avec un filtre, il ne garde que son cadre.
- **Replier une section** (2026-10-19, demande de l'utilisateur) : là où les sections existent (ci-dessus), l'onglet d'un
  intercalaire suivi d'au moins une carte est un **bouton** (`.sec-fold`, chevron, `aria-expanded`, « Replier / Déplier
  la section « … » (N cartes) »). Repliée, la section ne montre plus que son intercalaire, posé sur une **pile** (cadres
  décalés derrière lui) avec « +N » sur l'onglet ; repliée ou non, une section **garde sa ligne**. « Tout
  replier » / « Tout déplier » dans la barre de l'album, dès qu'une section a des cartes. Les cartes repliées ne comptent
  ni dans « Afficher les N suivantes » ni dans la sélection par plage (Maj+clic). Dans tes albums comme dans ceux d'un ami ;
  rien n'est envoyé : les sections repliées sont gardées dans ce navigateur (`localStorage` `classeur-sections` : par
  album, les titres de ses intercalaires repliés). En tri autre que « Ordre » ou avec un filtre, tout reste visible.
- **Le changer** : dans l'éditeur (« Liste d'articles »), une ligne qui commence par « # » (« # Sous-continent », espaces
  après « # » permis ; « # » est interdit dans un titre de Wikipédia, donc sans ambiguïté) est un intercalaire ; à
  l'ouverture, l'éditeur écrit « # » devant les intercalaires ; une explication et le compte (« 20 lignes · 3
  intercalaires ») sous le champ. Deux lignes qui mènent au même article (redirection) : intercalaire si l'une des deux
  l'est. Depuis l'album : la fiche d'une carte ou d'une case vide **ouverte depuis l'album d'une de tes collections** a une
  case « Intercalaire » (« Dans « … », cette carte ouvre une section… ») : cochée ou décochée, la collection est renvoyée
  entière (`POST /api/targets/save {id, name, items, source}`, éléments tels que rangés, seul `sep` de cet élément
  changé), case grisée pendant l'enregistrement, revenue à l'état d'avant et erreur affichée si c'est refusé. Pas de case
  depuis « Mes cartes », l'album d'une catégorie ou d'une page de Wikipédia, ni l'album d'un ami.
- **Le déplacer** : « Réorganiser » (album d'une de tes collections qui a un ordre, voir « Onglet « Collections » ») ; en
  mode réorganisation, les sections restent visibles et un intercalaire déplacé garde son rôle.
- **Collection complète** (toutes ses cartes, au moins une) : sa ligne dans « Mes collections » et l'en-tête de son
  album (titre, « N sur N ») ont un **tour doré et brillant** (bordure en dégradé conique or, lueur dorée ; le reflet fait
  le tour en 8 s, immobile si le système demande moins d'animations, `prefers-reduced-motion`, ou sans `@property`) ;
  « ✓ Complète » en or à la place du pourcentage sur la ligne, en pastille dans l'en-tête, « collection complète » dans
  le nom accessible de la ligne. De même pour les collections complètes d'un ami (« Ses collections », album). Pas pour
  l'album d'une catégorie ou d'une page de Wikipédia (pas encore une collection).

Bandeau : « N collections » = le nombre de collections de « Mes collections » (toutes, celles faites d'une catégorie
comprises ; pas de total à atteindre). Fiches (carte possédée, case vide) : « Dans tes collections » = toutes tes
collections qui contiennent la carte (par titre ou qid), celles faites d'une catégorie comprises.

## Le favori (bookmarklet)

Source commentée : `site/public/assets/bookmarklet.js` ; l'interface la met sur une ligne et y insère l'origine du site et
la clé de l'utilisateur. Sur `www.wiki-masters.com` (utilisateur connecté) : petit encart de progression, état de la
synchro **d'abord** (`mode:'state'`, avant toute lecture du jeu ; `401` = favori périmé : arrêt aussitôt, avec le message
du classeur ; classeur injoignable ou en erreur `5xx` : arrêt aussi, « Le classeur ne répond pas (réseau) / (erreur
500) : réessaie dans un moment », ou le message du classeur pour un `503` (quota du jour de D1, base non liée) — rien
n'est lu dans le jeu ; autre refus après un clic, classeur plus ancien : lecture complète quand même), lecture de
`my-collection/stats`, puis synchro rapide si possible (pages `sort=added` jusqu'à `last_at`, envoi
`mode:'delta'` : « 3 exemplaires obtenus depuis ta dernière synchro, 2 nouvelles cartes », ou « Rien de nouveau ») ;
sinon lecture de toutes les pages `my-collection` (pause de 300 ms), regroupement des exemplaires en **CarteImport**
(rareté la plus haute ; catégorie du jeu coupée à 500 caractères, la carte n'est plus écartée pour elle ; tags du jeu
de tous ses exemplaires, `gtags` et `gtagc`, depuis la version 3 : voir « Tags du jeu » ; une forme de tag non reconnue
est décrite dans `gtags_odd`, au premier morceau et dans la synchro rapide), envoi
`POST <site>/api/import` **par morceaux de 500** (`upload_id`, `part`, `last` ; `stats`,
`last_at`, `rows`, `copies`, `ignored` au premier), puis « 1 043 cartes envoyées au classeur, 12 nouvelles » et un lien
vers le classeur. Une relecture complète après une synchro rapide ratée dit pourquoi (tri par date en erreur ou dans le
désordre, carte la plus récente partie, plus de 500 nouveautés, nouvelle carte invalide, compteurs qui ne collent pas,
autre synchro en même temps). Cartes invalides : « 1 carte ignorée … elle reste dans le jeu, mais le classeur ne peut
pas la ranger » (pas « relance », qui n'y changerait rien) ; « relance le favori dans un moment » seulement si
`complete:false`. Une page sans liste `collection` est une erreur (rien n'est envoyé), pas la fin de la collection.
Ailleurs : « Ouvre wiki-masters.com et connecte-toi ». 401/403 du jeu : « Connecte-toi à WikiMasters (ta session du jeu
a expiré ou n'est pas ouverte dans cette page), recharge la page, puis clique à nouveau ce favori » ; 403 qui n'est pas
du JSON : « WikiMasters a refusé la lecture (protection anti-robots ?) : recharge la page du jeu (passe la vérification si
elle s'affiche) … » ; 403 `automation_limit` (ou 429) : « Le jeu limite les lectures automatiques : réessaie plus tard
(dans une dizaine de minutes) » ; jeu injoignable, en erreur ou muet : « WikiMasters ne répond pas (réseau) / a répondu
500 (souci passager du jeu) / ne répond plus (30 s sans réponse) : réessaie dans un moment ». Chaque message d'échec
finit par « Rien n'a été changé dans ton classeur. » quand c'est le cas.

**Sûreté de la lecture** (2026-10-17, `VERSION = 2` dans `bookmarklet.js`, envoyée en `v`) :
- `state` rend l'heure du serveur (`now`) : renvoyée en `started` avec la synchro rapide et au premier morceau, elle
  empêche une lecture partie plus tôt de passer par-dessus une plus récente (« Une synchro plus récente (autre onglet,
  favori relié ou rafraîchissement) est déjà passée : ton classeur est à jour (1 043 cartes). »). Le favori envoie aussi
  `via` (`clic`, `relie` : synchro automatique, `script` : Tampermonkey) et `reason` (code de la raison d'une relecture
  complète), pour le journal des synchros.
- Lectures du jeu en `cache: "no-store"` (une réponse gardée par le navigateur ferait croire à « Rien de nouveau ») et
  avec un **délai d'attente** (`AbortController` : 30 s pour le jeu, 60 s pour le classeur ; sans `AbortController`,
  comme avant) : une requête qui ne répond plus ne laisse plus le favori, ni ses synchros automatiques, bloqué sur
  « synchro en cours… ».
- **Page courte** (moins de 50 entrées) alors que les exemplaires lus restent sous `total` du jeu : relue une fois après
  une pause d'une seconde (page vide ou tronquée passagère) ; même résultat : fin de la lecture (elle sera non vérifiée).
- **Compteurs relus après la dernière page** (`stats_end`, une requête de plus) : s'ils ont changé, le classeur ne
  retire aucune carte (« Ta collection a bougé pendant la lecture (compteurs du jeu différents avant et après) : aucune
  carte n'a été retirée de ton classeur … Relance le favori dans un moment. »). Lecture incomplète : « Il en manque par
  rapport au total du jeu (…) : aucune carte n'a été retirée de ton classeur (52 cartes non vues, gardées pour
  l'instant). Relance le favori dans un moment. ». Lecture vérifiée : « 1 043 cartes envoyées au classeur, 2 nouvelles,
  1 retirée (plus dans ta collection). ».
- **Limite de lectures du jeu en pleine lecture complète** : une pause (le délai `Retry-After` du jeu, 120 s au plus,
  sinon une minute ; « Le jeu demande de ralentir : reprise de la lecture à 14:32 (1 250 exemplaires lus)… « Arrêter »
  l'annule. »), puis reprise **à la même page** : tout recommencer heurterait la même limite au même endroit (gros
  classeurs). Une seconde limite dans la même synchro arrête tout. La synchro rapide, elle, s'arrête dès la première.
- **Envoi** : un morceau refusé par une panne passagère du classeur (réseau, délai, `5xx` sauf `503`, le quota du jour)
  est renvoyé deux fois (après 2 s, puis 6 s) ; le dernier, déjà appliqué mais dont la réponse s'est perdue, rend le même
  résultat (`again`).
- **Échecs signalés** : un échec vu par le favori lui-même (session, limite, anti-robots, erreur, délai ou format du jeu)
  est envoyé au journal des synchros (`POST /api/sync-log` : `kind`, `via`, `code`, le message affiché, `ms`,
  `read`, `total`, `reason`, `v` ; jamais de jeton ni de cookie du jeu). Un refus ou une panne du classeur n'est pas
  signalé (il l'a noté lui-même, ou ne peut rien recevoir), ni « Arrêter ».
- `state` rend aussi la version la plus récente du favori (`v`) : un favori plus ancien finit ses messages par « Une
  nouvelle version du favori existe : remplace celui-ci (onglet « Mettre à jour » du classeur). ». Le script
  Tampermonkey porte la même version (`@version`).

**Mode relié** (le favori reste dans la page) : après son clic, le favori reste actif dans la page du jeu jusqu'à ce
qu'elle soit rechargée (le jeu est une application Next.js : y naviguer ne la recharge pas) ; sans `URL` ni `fetch`, il
reste ponctuel, comme avant (bouton « Fermer »). Il enveloppe `window.fetch` **pour regarder** les requêtes que la page
fait d'elle-même : la requête part d'abord, telle quelle (mêmes arguments, même `this`), et la page reçoit la promesse
même du `fetch` d'origine ; le favori ne lit que la méthode et l'adresse (jamais le corps de la requête, ni celui de la
réponse : seul son `ok`, une fois reçue), n'ajoute ni ne change aucun en-tête, et avale ses propres erreurs. Ses propres
requêtes (jeu et classeur) passent par le `fetch` d'avant lui : jamais observées, ni par lui ni par un script qui
envelopperait `fetch` après lui. `XMLHttpRequest` n'est pas enveloppé : le code du jeu relevé n'en contient que dans un
polyfill de `fetch`, et les extensions tierces lisent les actions du jeu dans `fetch`. **Une différence reste visible
par la page**, propre à toute observation d'une promesse : pour une requête d'action (tableau ci-dessous, même origine,
ni `GET` ni `HEAD`), le favori attache un gestionnaire d'échec à la promesse rendue à la page ; si la page ne gère pas
elle-même l'échec réseau de cette requête, le navigateur ne le signale plus comme rejet non géré (événement
`unhandledrejection`, console, outil de suivi d'erreurs du jeu). La page reçoit toujours le même rejet ; les autres
requêtes ne sont pas touchées. Ne rien attacher créerait à l'inverse un rejet non géré de plus quand la page gère le sien.

- Une action qui change la collection (tableau ci-dessous, réponse 2xx) programme la **synchro rapide** existante 5 s
  après la dernière action (30 s au plus après la première d'une rafale), jamais moins d'une minute après la fin de la
  précédente, **20 automatiques par heure** au plus. Une relecture complète automatique (compteurs qui ne collent plus
  après une défausse, une mise aux enchères…) a lieu au plus **toutes les 15 minutes** ; sinon elle est reportée et
  annoncée (« Relecture complète prévue à 14:50 (…) : « Synchroniser » la lance tout de suite »). Une action pendant une
  synchro en programme une autre après. Sans action en attente, aucune minuterie : rien n'est lu. Paquet ouvert mais
  « Rien de nouveau » (le jeu n'avait pas encore rangé les cartes tirées) : **une seule vérification de plus**, dans les
  limites habituelles (une minute après au moins ; badge « synchro à 14:36 (vérification après le paquet ; une par
  minute au plus) »), pas une de plus même si elle ne trouve rien.
- **Ces limites valent pour toutes les pages et tous les onglets du jeu de ce navigateur** (un rechargement, le script
  Tampermonkey de chaque page, un second onglet ne les remettent pas à zéro) : `localStorage` de wiki-masters.com, une
  seule clé, `classeur:relie` = `{autos, end, full}` (heures des synchros automatiques de la dernière heure, fin — ou
  début, pendant qu'elle tourne — de la dernière synchro, début de la dernière relecture complète), jamais une clé du
  classeur. Lue avant de programmer une synchro et **relue à son échéance** (un autre onglet a pu passer entre-temps) ;
  une heure à venir est ignorée. Stockage absent ou refusé (navigation privée…) : limites de la page seulement, rien ne
  casse. Les relectures complètes automatiques suivent en plus **`full_at`** de `mode:'state'` (dernière relecture
  complète vérifiée par le classeur, heure du serveur, prise au plus à maintenant si l'horloge de l'ordinateur retarde) :
  une relecture faite il y a moins de 15 minutes, d'un autre navigateur ou d'un clic, reporte aussi l'automatique.
- Encart : messages comme avant, puis réduit en badge 15 s après une synchro réussie lancée d'un clic : « Classeur relié
  · dernière synchro à 14:32 » (ou « synchro dans un instant (paquet ouvert) », « synchro à 14:35 (paquet ouvert ; une
  par minute au plus) », « relecture complète à 14:50 (…) », « synchro en cours… »). Boutons « Synchroniser » (tout de
  suite, hors limites des synchros automatiques), « Mettre à jour les cotes » (voir « Le marché » ; avec, encart déplié,
  un avertissement court des règles du jeu et « Couper les cotes automatiques » / « Réactiver les cotes automatiques » ;
  badge « lecture des cotes… » pendant la lecture ; pendant une synchro, la lecture est faite juste après, « Cotes :
  lecture juste après la synchro en cours »), « Réduire » / « Détails »,
  « Arrêter » (rend `window.fetch` d'origine ;
  si un autre script l'a enveloppé à son tour, il reste en place et l'enveloppe du favori ne fait plus que passer la
  main ; encart retiré ; **la synchro en cours s'arrête aussi** : la requête déjà partie finit seule, puis plus rien n'est
  lu ni envoyé — contrôle avant chaque lecture et chaque envoi, donc entre deux pages ou deux morceaux). L'encart est
  remis dans la page si le jeu l'en retire en se redessinant. **Sur téléphone** (écran de moins de 760 px, 2026-10-20) :
  l'encart se tient au-dessus de la barre du bas du jeu (76 px), déplié sur toute la largeur ; réduit, c'est une
  **pastille** (ligne d'état seule, sans boutons ni ligne des cotes) qu'on touche pour déplier et qu'on fait glisser où
  l'on veut (au-delà de 6 px, c'est un glissement) ; sa place est gardée dans le localStorage de wiki-masters.com
  (`classeur:pastille`, `[x, y]`), ramenée dans l'écran à chaque réduction. Sous la ligne d'état, une ligne « Cotes : … » (voir « Le
  marché », « Cotes automatiques »).
- Erreur d'une synchro automatique : encart déplié avec le message. **Classeur injoignable ou en erreur** : la demande
  d'état échoue, rien n'est lu dans le jeu. Une erreur qui arrête tout (session, limite de lectures automatiques du jeu,
  favori ou script périmé `401`/`403`, quota du jour du classeur `503`) ou **trois de suite** mettent les synchros
  automatiques **en pause** jusqu'à un « Synchroniser » réussi ; seule une synchro réussie remet ce compte à zéro (pas une
  relecture complète reportée). Le badge dit pourquoi : « le classeur ne répond pas, synchros automatiques en pause :
  clique « Synchroniser » » (réseau, `5xx`, `503`), « favori périmé, synchros automatiques en pause » (`401` ; « script
  périmé » en Tampermonkey ; `403` : « refusé par le classeur »), sinon « synchro automatique en pause : clique
  « Synchroniser » ».
- Nouveau clic dans la même page : pendant une synchro, il déplie seulement l'encart ; sinon l'ancien favori est arrêté
  (son `fetch` rendu) et le nouveau repart de zéro avec sa clé (`window.__classeurRelie` = `{show, stop}`, sans la clé).
  Clic pendant que se termine la synchro d'un favori arrêté (ou dont l'encart a été fermé) : « Une synchro se termine :
  clique à nouveau le favori dans un instant (ou recharge la page) », rien n'est lancé.
- **Script Tampermonkey / Violentmonkey** (facultatif ; onglet « Mettre à jour », replié sous le favori) : le même code,
  `"__START__"` remplacé par `"load"`, sous l'en-tête `@match https://www.wiki-masters.com/*` et
  `https://wiki-masters.com/*`, `@grant none` (il doit tourner dans la page pour voir son `fetch`), `@run-at
  document-idle`, `@noframes`. Relié dès le chargement de chaque page du jeu, en badge réduit ; **rien n'est lu avant une
  action** du joueur, et pas de choix sur la Collection globale. Il porte la clé d'import comme le favori (si le
  gestionnaire synchronise ses scripts, la clé part avec) ; régénérer le favori l'arrête aussi : à sa première action,
  la demande d'état est refusée (`401`), rien n'est lu dans le jeu, synchros automatiques en pause, et l'encart dit
  « Script Tampermonkey périmé : … onglet « Mettre à jour », copie le script régénéré (« Sans cliquer à chaque fois ») et
  remplace l'ancien dans Tampermonkey » (pas « remplace le favori de ta barre », le message du classeur pour le favori).

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
| écriture (autre que `GET`) vers la base Supabase du jeu dont l'adresse contient « tags » (`/rest/v1/user_card_tags`, `/rest/v1/tags`), ou vers une adresse du jeu finissant par « tag(s) » ou contenant « /tags/ » (chemin **supposé**, aucun relevé) | tag du jeu posé, retiré, créé, renommé : aucun exemplaire de plus, la synchro rapide ne le verrait pas | relecture complète (« tag du jeu modifié » ; une automatique par quart d'heure au plus) | tables `tags` et `user_card_tags` : `docs/api.md` ; écriture par Supabase : WikiMasters+ (`inject.js`) range les étiquettes avec l'étoile |
| `POST /api/human-check`, `POST /api/achievements/check`, toute lecture (`GET`), Supabase hors étiquettes (`PATCH user_cards` : étoile ; liste de souhaits), statut hors 2xx | aucun sur ce que le classeur garde | rien | `docs/api.md` ; Toolkit (`pack-verification.js`, `ACTIVITY.md`) ; WikiMasters+ (`inject.js`) |

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
avant. La question et les choix ont leur propre place dans l'encart : une synchro automatique (mode relié) ne les efface
pas ; ils disparaissent quand l'un d'eux est pris. « Mettre à jour mon classeur » = la synchro ci-dessus, inchangée. « Créer une collection avec cette recherche
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

## Le marché (cotes, valeur, bonnes affaires)

Demande du 2026-10-16, d'après la description de l'outil d'un ami (Python, Vercel), reprise avec d'autres choix :
**aucune session du jeu sur le serveur** (ni jeton d'accès ni jeton de renouvellement gardés, aucun appel du serveur au
jeu ni à sa base, aucune tâche planifiée). Code : `site/public/assets/bookmarklet.js` (« cotes et marché »),
`functions/_lib/market.js`, onglet « Marché » de `app.js`.

**Qui lit quoi.** Seul le favori lit le marché, dans la page du jeu, **au clic du joueur sur « Mettre à jour les
cotes »** (encart du favori relié, script Tampermonkey compris) et, depuis le 2026-10-17, **sans clic en mode relié**
(voir « Cotes automatiques » ci-dessous : toutes les 20 min tant que l'onglet est visible, et après une enchère, un achat
ou une mise en vente vus dans le jeu) ; jamais pendant une synchro. Il lit directement la base du jeu (Supabase, `https://cyrxjeppjqsxxjayfrur.supabase.co/rest/v1/`, tables
`auctions`, `cards`, `auction_bids`, que la page du jeu lit déjà) avec la clé publique `anon` du jeu (livrée dans le code
de sa page ; embarquée dans le favori : seule, elle n'ouvre rien) et la session que la page a déjà (`apikey` et
`Authorization: Bearer <jeton d'accès>`). **Jamais** les routes `/api/marketplace/…` du site du jeu (30 requêtes par
minute puis `403 automation_limit` pour les ventes d'une carte ; ~3 s et limitée pour une enchère).

- **Jeton** : relu dans la page avant chaque requête (la page renouvelle elle-même sa session : le favori prend le
  nouveau jeton). Candidats (2026-10-17) : le cookie `sb-cyrxjeppjqsxxjayfrur-auth-token` entier, le même découpé en
  `.0`, `.1`… (essayé aussi sans ses derniers morceaux, au cas où un ancien morceau traîne), puis le `localStorage` du
  même nom ; chacun `base64-` puis du JSON en base64url, ou du JSON (encodé pour l'adresse, entre guillemets ou non),
  objet direct, `{currentSession}`, `{session}` ou tableau `[jeton d'accès, …]` (anciens outils de Supabase) :
  `access_token`, `expires_at`, `user.id` (sinon `exp` et `sub` du jeton). **Le jeton valide qui expire le plus tard
  l'emporte** : avant, un vieux cookie entier resté à côté d'un cookie découpé à jour gagnait, et le favori disait « session
  expirée » même après un rechargement. **Pas vérifié sur le jeu** (format relevé dans la description de l'ami). Rien de
  lisible (cookie `HttpOnly`, pas connecté) : « Le favori ne trouve pas ta session du jeu dans cette page : connecte-toi,
  recharge la page du jeu (F5), puis clique « Mettre à jour les cotes ». Rien n'a été lu. », avec, si la collection vient
  de se lire (donc le joueur est connecté), « Ta collection, elle, se lit : si ça continue après un rechargement, le jeu
  cache sans doute sa session au favori (préviens la personne qui gère le classeur). » ; seulement le cookie d'une autre
  base Supabase : « La base du jeu a changé : le favori doit être mis à jour pour lire les cotes (…) ». Jeton expiré (ou à
  moins de 30 s), ou refusé (`401`) en route : « Ta session du jeu a expiré dans cette page : recharge la page du jeu (F5),
  puis clique « Mettre à jour les cotes » (le favori ne la renouvelle jamais lui-même). » ; **jamais de renouvellement** (`POST /auth/v1/token`) : un jeton de renouvellement ne sert qu'une fois,
  le réutiliser fermerait la session du joueur. Le jeton ne va qu'à la base du jeu, en en-tête : ni au classeur, ni dans
  l'encart, ni dans un stockage. L'identifiant du joueur dans le jeu ne sert qu'aux filtres de ses enchères et ventes
  (`bidder_id`, `seller_id`, et pour écarter ses propres enchères des bonnes affaires) : jamais envoyé au classeur.
- **Rythme** : une requête par seconde au plus, **30 par lecture** ; la suivante reprend aux cotes les plus anciennes.
  Arrêt aussitôt, avec la raison, sur `401` (ou clé publique refusée : « le favori doit être mis à jour »), `403`, `429`
  ou `automation_limit` (« Le jeu limite les lectures automatiques : cotes arrêtées, réessaie plus tard. »), sur une autre
  erreur `4xx` ou un format inattendu (« La base du jeu a refusé une lecture (400 : <message de la base>) : … le jeu a
  changé et le favori doit être mis à jour (préviens la personne qui gère le classeur). ») et sur une erreur passagère
  (réseau, `5xx` : « réessaie dans un moment ») ; les cotes déjà lues sont envoyées quand même, la lecture du marché
  aussi si elle était déjà prête (étape 5), sinon pas (la précédente reste). Listes `in.(…)` découpées pour rester sous
  5 000 caractères encodés (titres longs ou accentués : sinon une adresse de plus de 8 Ko, `414`). **Chaque échec est
  envoyé au classeur** (`POST /api/market/fail`, le message affiché) et la page le répète.
- **Une lecture** (au clic ou automatique) : 0. session lisible et valide, sinon le message ci-dessus (rien de lu ; au clic,
  la raison part au classeur) ; 1. `POST /api/market/plan` `{v, auto}` (classeur injoignable : rien n'est lu dans le
  jeu ; quota du jour atteint : « Quota du jour des cotes atteint pour ton classeur (ou pour tout le site) : reprise
  demain. Rien n'a été lu. » ; `skip` : rien n'est lu, « Cotes lues il y a moins de 5 min par un autre onglet ou
  appareil ») ; 2. tes mises (`auction_bids?bidder_id=eq.<toi>`, 14 derniers jours, avec l'enchère et sa carte) et tes
  ventes (`auctions?seller_id=eq.<toi>`, fin dans les 14 derniers jours ou à venir) ; 3. titres des cartes qui te
  manquent → cartes du jeu (`cards?wikipedia_title=in.("…","…")`, 80 titres par requête au plus (moins s'ils sont longs), 320 par lecture ; carte `lang`
  `fr` préférée ; gardés par le classeur, `""` quand aucune carte n'a ce titre) ; 4. enchères en cours sur ces cartes
  (`auctions?status=eq.active&end_at=gt.<maintenant>&card_id=in.(…)&order=end_at`, 100 cartes par requête, 500 cartes au
  plus) ; 5. cotes des cartes de ces enchères et de tes enchères et ventes (relues sauf si cette page les a lues il y a
  moins d'une heure), puis la lecture du marché part (`POST /api/market/live`) ; 6. cotes des cartes du plan
  (les plus anciennes d'abord), par lots de 100 : `auctions?status=eq.settled_sold&settled_at=gte.<il y a 90 jours>&
  card_id=in.(…)&order=card_id,settled_at.desc,id&limit=1000&offset=…` (pages de 1 000 dans un ordre stable ; plafond
  atteint au milieu d'un lot : seules les cartes lues en entier sont gardées), dans la limite du quota du jour ; 7.
  `POST /api/market/prices` par 500 (`last:true` au dernier : fin de l'essai). Message : « Cotes lues : 312 cartes (il en
  reste 736 : la prochaine lecture continue, les plus anciennes d'abord). 4 bonnes affaires, 2 de tes enchères en cours :
  onglet « Marché » du classeur. » et le lien vers le classeur. La lecture du marché tient sous 200 000 caractères
  (sinon sans les images de tes mises et ventes, puis sans les plus anciennes) : le classeur en accepte 256 Ko.
- **Cote**, calculée dans le favori, par carte, **rareté d'exemplaire** (`snapshot_rarity`) et brillance (`is_shiny`) :
  clé `R` ou `R*`, `{p, n, w, l, d}` = médiane des 30 ventes les plus récentes (90 derniers jours), ventes lues, la même
  médiane sur les ventes de plus de 7 jours (3 au moins, sinon `null`), prix et date de la dernière vente. **Fiable à
  partir de 3 ventes** (`n ≥ 3`) ; en dessous, montrée avec « ~ » et jamais comptée. Carte sans vente lue : `{}`, datée
  quand même (pas relue tout de suite). La fenêtre de 90 jours borne le nombre de pages : une carte vendue plus rarement
  n'a pas de cote.
- **Bonnes affaires** (dans le favori, avec les cotes **qu'il vient de lire**, jamais celles du cache commun) : enchère en
  cours sur une carte qui te manque, d'un autre vendeur, avec une cote fiable de la rareté de l'exemplaire, demandée
  (enchère actuelle, sinon prix de départ) à 80 % de la cote au plus, ou « finit bientôt » (sans enchère, moins de 2 h,
  départ ≤ cote) ; **la moins chère par carte** (2026-10-17 : une collection ne demande qu'un exemplaire, de n'importe
  quelle rareté ; `more` = les autres enchères intéressantes sur la même carte, « 1 autre enchère intéressante sur cette
  carte ») ; de la fin la plus proche à la plus lointaine, 50 au plus. La page écarte en plus celles **finies depuis la
  lecture** et celles d'une carte **que tu as maintenant** (« Plus montrées : 1 enchère finie depuis la lecture, 1 carte
  que tu as maintenant. »), et regroupe par carte une lecture d'un ancien favori. **Tes enchères** : regroupées par enchère
  (ta plus haute mise) : `run` (en cours ; `lead` : tu mènes), `won` / `lost` (vendue à toi, à un autre), `off`.
  **Tes ventes** : `run`, `sold`, `unsold` (close sans vente), `off` (annulée). Chacune avec la cote de la rareté de son
  exemplaire (lue à la même lecture).

**Cotes automatiques** (2026-10-17, demande de Cédric : « les bonnes affaires, ça n'a pas l'air de se rafraîchir ») : en
mode relié (favori cliqué, ou script Tampermonkey), la lecture ci-dessus se fait aussi **sans clic** :
- **une minute après** le clic sur le favori (ou le chargement du script), puis **toutes les 20 min tant que l'onglet est
  visible** ; onglet caché : rien, nouvel examen chaque minute (une lecture dans la minute au retour) ;
- **20 s après une enchère, un achat ou une mise en vente vus dans le jeu** (réponse 2xx de la page à `POST
  /api/marketplace/<id>/bid`, `…/buy`, `…/buyout` ou `…/purchase` — chemins d'achat direct supposés, aucun relevé —,
  `POST /api/marketplace`, `DELETE /api/marketplace/<id>` ; 60 s au plus après la première d'une rafale) ;
- **jamais moins de 5 min après la précédente** (au clic ou non), **6 automatiques par heure** au plus, pour tous les
  onglets du jeu de ce navigateur (`localStorage` `classeur:cotes` = `{autos, last, off}` : des heures et le choix
  « coupées », rien d'autre) ; entre navigateurs ou appareils, le classeur refuse une lecture automatique moins de 5 min
  après le début de la précédente (`skip` : la suivante 20 min après celle-là) ;
- même lecture qu'au clic (1 requête/s, 30 au plus, jamais de renouvellement de session), jamais pendant une synchro ;
- **sans session lisible : rien n'est programmé** (aucune minuterie), « Cotes : en attente de ta session du jeu
  (connecte-toi, puis recharge la page) » ; session expirée : rien n'est lu, nouvel examen chaque minute (la page
  renouvelle elle-même sa session), « Cotes : session du jeu expirée, en attente de son renouvellement par la page (sinon
  recharge-la) » ;
- échec passager (réseau, `5xx`) : encart replié, « Cotes : …, dernier essai raté : <raison> » ; une erreur qui arrête tout
  (session refusée, limite du jeu, quota, favori refusé, jeu changé) ou trois échecs de suite : **pause**, encart déplié
  avec le message et « Cotes automatiques en pause : « Mettre à jour les cotes » les relance. » ; un clic réussi les
  relance ;
- « Couper les cotes automatiques » (encart déplié) les arrête pour tout ce navigateur ; « Réactiver… » les relance ;
- ligne sous l'état : « Cotes : lues à 14:32, prochaine vers 14:52 », « Cotes : lecture en cours… », etc.

Coût : une lecture lit au plus 30 pages de la base du jeu ; les cotes des enchères en cours ne sont relues qu'au-delà
d'une heure dans la même page ; les cotes de tes cartes, au plus toutes les 12 h (plan) : après les premières lectures,
une lecture automatique écrit surtout les cotes des enchères (quelques centaines de lignes).

**Où vont les données (le plus simple).** Les cotes vont au **cache commun** `prices` (une ligne par carte, **sans
user_id** : des ventes du marché, liées à aucun joueur, qui servent à tous les membres). La lecture du marché (bonnes
affaires, tes enchères, tes ventes) va aussi au serveur, **une ligne par classeur** (`market.live`), remplacée à chaque
lecture et **oubliée au bout de 7 jours** (plus montrée, puis effacée au passage d'un favori ; 24 h avant le
2026-10-17 : une lecture de la veille disparaissait sans que la page dise pourquoi ; la page dit maintenant son âge) : c'est la plus simple des deux
voies pour avoir un onglet « Marché » complet (fiches, collections concernées, « Copier le nom » : l'encart du favori,
étroit et dans la page du jeu, n'en montre qu'un résumé), pour une ligne écrite par lecture et rien de gardé au-delà ; les
titres trouvés (`market.ids`, 2 000 au plus) évitent de les rechercher à chaque lecture. **Dernier essai**
(`market.attempt`, 2026-10-17) : `{start, v, auto}` au plan, `end` et `ok:true` à la fin (cotes `last:true`), ou
`ok:false` et `why` (`POST /api/market/fail`) ; des heures, la version du favori et le message d'échec, rien du jeu.

**Serveur** (`market.js`, routes dans « Points d'accès ») :
- **Plan** : cartes possédées et cartes voulues dont le card_id est connu, cote absente puis la plus ancienne d'abord,
  sans celles lues depuis moins de 12 h ; cartes voulues = titres des éléments vérifiés des collections absents des
  titres des cartes (en SQL ; le serveur n'a pas les qids : une carte possédée sous un autre titre peut y figurer), des
  collections changées le plus récemment d'abord, 500 au plus.
- **Cotes validées** (`400`, rien d'écrit) : identifiant `[A-Za-z0-9_-]` (100 au plus), clés `C|PC|R|SR|UR|L` + `*`
  (12 au plus), montants de 0 à 10⁹, ventes entières de 1 à 10⁶, date ISO pas dans le futur, une carte une fois par
  envoi, 500 par envoi ; arrondies au centime ; remplacées en entier (`read_at` = maintenant).
- **Quotas du jour** (UTC) : 15 000 cotes par classeur, 150 000 pour tout le site (ligne `market` de user_id `'*'`) :
  une cote = une ligne écrite (et l'index de sa clé primaire) ; abonnement payant Workers depuis le 2026-10-17 (50 millions
  de lignes écrites par mois comprises ; avant, D1 gratuit, 100 000 par jour pour tout, imposait 3 000 et 30 000) ;
  au-delà `429`, à quelques envois simultanés près.
- **Valeur** (`value_history`, un point par classeur et par jour UTC, le dernier calcul du jour remplaçant les
  précédents, 400 jours) : somme, sur les exemplaires (`variants` ; sinon approchés), de la cote fiable de leur rareté et
  brillance × leur nombre ; `priced` = cartes avec au moins un exemplaire coté, `cards` = cartes, `approx` = cartes sans
  détail de leurs exemplaires. Calculée en SQL dans D1 (aucun JavaScript proportionnel aux cartes) et écrite : à la fin
  d'un envoi de cotes de ce classeur (`last:true`) ; après un import ou une synchro rapide (au plus une fois par heure, et
  seulement si des cotes existent) ; à `GET /api/market` si elle a changé (cotes relues par un autre membre). Aucun point
  tant qu'aucune carte n'est cotée.
- `DELETE /api/me` efface la ligne `market` et l'historique du classeur ; les cotes, communes, restent.

**Fausses cotes.** Un membre (ou quiconque a sa clé d'import) peut envoyer des cotes fausses pour n'importe quelle carte,
dans ses quotas : cela fausse chez tous la valeur des classeurs et les cotes des fiches. Cela
ne touche ni les cartes ni les collections de personne, ni les **bonnes affaires** et les écarts de tes enchères, calculés
par ton favori avec ses propres lectures (une cote fausse dans le cache n'y entre pas, et les cartes de ces enchères sont
relues et réécrites à chaque lecture, ou gardées une heure au plus dans la page du favori). Une cote fausse dure jusqu'à
ce qu'un membre la relise (plus de 12 h après) ;
renvoyée sans cesse, elle reste. Contrôle simple fait : bornes, raretés connues, taille, quotas. Pas fait (pas rentable
entre membres invités, et il faudrait garder qui a écrit, contraire à « pas de user_id ») : exiger que deux membres
concordent, garder l'auteur pour effacer ses cotes. Remède : régénérer la clé d'import qui a fuité.

**Interface** : bandeau, tuile « 12 340W · valeur (205 cotées) » quand une carte est cotée ; onglet **« Marché »**
(réorganisé le 2026-10-16) : en haut, la valeur (« 205 cartes cotées sur 1 048 », cartes approchées), graphique de la
valeur dès deux jours (SVG dans la page, une ligne aux couleurs du thème, sombre ou clair ; survol : le jour le plus
proche ; « Voir les valeurs » : le tableau) et **où en est la lecture du marché** (2026-10-17, voir ci-dessous) ; puis,
**côte à côte** (l'une sous l'autre sous 760 px), « Bonnes affaires à acheter » (les bonnes affaires ci-dessus) et
« Bonnes affaires à vendre » ; puis « Mes enchères » (tes mises, tes ventes) et « À savoir » (avertissement des règles du
jeu). « Cartes qui bougent » (écart sur 7 jours de la cote de tes exemplaires) a été **retirée** le 2026-10-17 (demande
de Cédric) ; la médiane d'il y a 7 jours (`w`) reste dans les cotes, pour la fiche (« 7 jours : +33 % »). Ces trois
sections, et « Valeur de ton classeur » (depuis le 2026-10-18, demande de Cédric ; repliée, son titre garde la valeur,
« 1 234W » ; son bouton « Relire » est dans son contenu), sont **repliables** (accordéon : un bouton dans le titre,
`aria-expanded`, contenu rendu seulement ouvert ; ce qu'elles contiennent dit dans le titre, « 2 mises · 1 vente ») :
toutes ouvertes par défaut, **sauf « Mes enchères », fermée** ;
l'état est gardé par classeur dans ce navigateur (`localStorage` `classeur-marche` : `{<id du compte>: {open, min, col, hideCol}}`,
accès protégés, valeurs par défaut sans lui). Chaque liste de l'onglet montre **20 cartes**, puis « Afficher 20 de plus
(N restantes) ».
- **« Bonnes affaires à vendre »** : tes cartes qui ne servent à **aucune** de tes collections (rapprochement titre puis
  qid, comme les albums). Case **« Cacher les cartes de mes collections »**, cochée par défaut (2026-10-18, gardée dans
  ce navigateur avec les autres réglages du Marché, `hideCol`) : décochée, la liste montre aussi les **exemplaires en trop** de celles qui y servent (une collection n'a besoin que d'un
  exemplaire de la carte, quel que soit le nombre de collections : on garde le moins coté, cote peu fiable comprise pour
  en juger, et la ligne dit « 2 en trop ») ; prix d'une ligne = la plus haute cote fiable de ses exemplaires à vendre
  (rareté et brillance de l'exemplaire), au moins le seuil « Valeur minimale : [100]W » (champ nombre, 100 par défaut,
  gardé avec l'état des sections ; vidé, il ne change rien) ; de la plus chère à la moins chère. Une ligne : rareté de
  l'exemplaire, titre (sa fiche), « brillante », « ×3 » ou « 2 en trop », « Copier le nom », cote, ventes, dernière vente.
  Cartes sans cote fiable : « 12 cartes sans cote fiable : ton favori les lit peu à peu, les plus anciennes d'abord, à
  chaque lecture (ou clique « Mettre à jour les cotes » dans son encart, sur wiki-masters.com). »
- **Cartes déjà en vente dans le jeu** (2026-10-18, « à vendre pas à jour ») : une carte mise aux enchères quitte la
  collection du jeu, mais reste dans le classeur tant qu'une lecture complète **vérifiée** ne l'a pas retirée (pendant
  que le joueur joue, les compteurs bougent et la lecture n'est pas vérifiée : rien n'est retiré, voir « Synchros
  sûres »). « Bonnes affaires à vendre » écarte donc, d'après la dernière lecture du marché (`live.sales`), un exemplaire
  (même rareté et brillance si possible) par vente **en cours** (`run`) ou **conclue** (`sold`) ; une carte dont il ne
  reste aucun exemplaire n'est pas proposée, et une ligne le dit (« N cartes déjà en vente dans le jeu… »). Invendue
  ou annulée : la carte est revenue au joueur, elle reste proposée.
- **Lecture du marché** (en haut, sous la valeur ; 2026-10-17) : « Lecture du marché par ton favori : il y a 12 min (17
  octobre, 10:02). » ; au-delà de 2 h, en orange, « Elle date de plus de 2 h : des enchères ont pu finir ou monter. Ouvre
  wiki-masters.com avec ton favori relié : il la refait toutes les 20 minutes (ou clique « Mettre à jour les
  cotes »). » ; jamais d'essai : « Ton favori n'a encore jamais lu le marché. Sur wiki-masters.com, clique-le : une
  minute après, il lit les cotes et les bonnes affaires tout seul, puis toutes les 20 minutes tant que l'onglet du jeu
  reste ouvert. S'il n'a pas de bouton « Mettre à jour les cotes », il date d'avant le 16 octobre : remplace-le (onglet
  « Mettre à jour »). » ; dernier essai raté : « Dernier essai de ton favori, il y a 5 min (lecture automatique) : <le
  message du favori> » ; essai commencé il y a plus de 10 min sans fin : « Une lecture commencée … n'a pas abouti (onglet
  du jeu fermé pendant la lecture, ou favori ancien) » ; essai d'un favori sans version ou plus ancien que celui de la
  page (`FAVORI_VERSION` d'`app.js` = `VERSION` de `bookmarklet.js`, vérifié par le test du favori) : « Ton favori n'est
  pas à jour : le nouveau lit les cotes et les bonnes affaires tout seul, dit pourquoi quand il n'y arrive pas et lit
  aussi tes tags du jeu. Onglet « Mettre à jour » : glisse le nouveau favori dans ta barre à la place de l'ancien (script
  Tampermonkey : recopie-le). ». **Mise à jour de la page** : `GET /api/me`, relu chaque minute (page visible), rend
  `market_at` ; s'il a avancé depuis la dernière lecture de l'onglet (déjà chargé), `GET /api/market` et les cotes sont
  relus, une fois par envoi du favori.
- **Montants** (2026-10-16) : partout (fiches, albums, lignes des collections, bandeau, onglet « Marché », amis), un
  montant s'écrit **collé à son W** (« 738W », « 1 234W », séparateur des milliers gardé : espace insécable ordinaire,
  l'espace fine de fr-FR n'existant pas dans la police des titres) et **en vert** (couleur des liens, celle de « ← Toutes
  les collections » ; classe `w`, `priceTag` dans `app.js`) ; « ~120W » estompé pour une cote peu fiable (moins de 3
  ventes) ; « ~5 100W » pour une somme estimée.
- **Valeur d'une collection** (tes collections, et une catégorie ou une page de Wikipédia ouverte) : tes cartes qui la
  remplissent, comptées comme la valeur du classeur (cote fiable de la rareté de chaque exemplaire × nombre ; une carte
  une fois, même nommée par deux cases) : à côté de « N sur M » dans l'album (« Valeur : 2 340W (18 cartes cotées sur
  25) ») et, discrète, sur sa ligne de « Mes collections » (« valeur 2 340W · pour la compléter ~5 100W », détail au
  survol et pour les lecteurs d'écran). **« Pour la compléter : ~5 100W (12 cartes cotées sur 30 qui manquent, à la moins
  chère de leurs cotes) »** : pour chaque carte qui manque (article vérifié, une fois par titre), **la moins chère de ses
  cotes fiables, toutes raretés d'exemplaire et brillance confondues** (choix : n'importe quel exemplaire remplit la case,
  et la rareté estimée d'après les vues n'est qu'une estimation) ; sans cote fiable, elle n'est pas comptée. Cotes :
  celles déjà lues pour le classeur (`GET /api/market/prices` : tes cartes, et les cartes voulues dont le favori a trouvé
  l'identifiant, rangées par titre `t`), une seule lecture gardée en mémoire (relue au plus une fois par minute, voir
  ci-dessous) : rien de plus n'est demandé pour une collection. Une carte qui manque n'a de cote que si le favori l'a
  trouvée dans le jeu (titres des cartes qui manquent, 500 par plan).
- **Tris par prix** (« Prix ↑ », « Prix ↓ ») : « Mes cartes », albums de tes collections, classeur et albums d'un ami.
  Prix d'une carte = la plus haute cote de ses exemplaires (rareté, brillance ; ceux d'un ami : la rareté de sa carte) ;
  d'une case vide = celui de « Pour la compléter » (la moins chère de ses cotes ; dans l'album d'un ami, celle de ta
  carte si tu l'as). Les cotes peu fiables (« ~ ») viennent **après** les fiables, puis les cartes sans cote, **dans les
  deux sens** ; à égalité, l'ordre habituel de la vue (rareté, ordre de la collection ou A → Z). Le tri choisi reste
  celui de la vue, comme les autres. Pas de tri par prix dans « Échanges possibles » ni dans les listes du « Marché »
  (déjà triées : fin d'enchère, écart, prix).
- Fiche d'une carte possédée : cote de chacun de tes exemplaires (« 2 × Rare 400W · 10 ventes · dernière 399W le 15
  octobre · 7 jours : +33 % », « ~ » sous 3 ventes), total ; fiche d'une carte qui manque : ses cotes connues par rareté ;
  fiche d'une carte d'un ami : sa cote (venue avec ses cartes), sinon celle de ta carte, sinon celle d'une carte qui te
  manque. Relu à l'ouverture, après chaque changement des cartes, à l'ouverture de l'onglet et au retour sur la page (une
  fois par minute au plus, 20 s pour l'onglet ; et à la demande d'un tri par prix), et à chaque nouvel envoi du favori
  (`market_at`). Rien n'est lu dans le jeu depuis
  cette page (CSP, et pas de session).

**Limites** : formats de la base du jeu relevés dans la description de l'ami, **pas vérifiés** (noms des tables et des
colonnes, statuts `active`/`settled_sold`/`cancelled`/`settled_*`, liens `auction:auctions(…)` et `card:cards(…)`) ; un
favori installé avant le 2026-10-16 n'a ni le bouton ni `variants`, un favori d'avant le 2026-10-17 ne lit les cotes qu'au
clic et ne dit pas ses échecs au classeur (le glisser à nouveau) ; le favori fait ~55 000 caractères une fois en adresse
`javascript:` (Firefox refuse un favori au-delà de 65 536 ; `favoriCode` d'`app.js` retire les espaces du code qui ne
séparent pas deux mots, hors chaînes et expressions régulières : 73 200 caractères sans, le 2026-10-17 ; le test du
favori échoue au-delà de 60 000) ; la première relecture
complète après la mise en place réécrit toutes les cartes une fois (`variants` ajouté).

**Pourquoi la plupart des classeurs n'avaient ni lecture du marché ni cotes** (constat du 2026-10-17 : trois membres
sur six sans aucune lecture, les autres d'hier) — ce qui pouvait échouer sans que personne ne le voie, et ce qui a
changé :
- la lecture n'avait lieu qu'au clic sur « Mettre à jour les cotes », replié dans le badge 15 s après une synchro, et
  absent des favoris installés avant le 16 octobre (rien ne le disait dans la page) → lecture automatique, et la page dit
  « jamais lu » / « favori pas à jour » ;
- un échec avant la lecture (session introuvable, quota) s'affichait puis l'encart se repliait au bout de 15 s comme après
  un succès, et le classeur n'en savait rien → l'échec reste affiché (encart déplié), part au classeur
  (`POST /api/market/fail`) et la page le répète ;
- un vieux cookie de session entier, resté à côté du cookie découpé à jour, était pris en premier → « session expirée »
  même après un rechargement ; corrigé (le jeton valide qui expire le plus tard) ;
- un échec en fin de lecture (cotes de tes cartes) jetait toute la lecture du marché, déjà prête → elle part avant ;
- une lecture du marché de plus de 64 Ko (joueur actif : 100 mises, 100 ventes, images) était refusée (`413`) → 256 Ko, et
  le favori allège au besoin ;
- des titres longs et accentués pouvaient faire une adresse de plus de 8 Ko (`414`) → listes découpées à 5 000 caractères ;
- la lecture était effacée au bout de 24 h, sans que la page dise qu'elle avait existé → 7 jours, avec son âge.
Rien de cela n'a pu être vérifié sur le jeu lui-même (inaccessible depuis la machine de développement).

## Règles du jeu

Les règles de WikiMasters interdisent les outils qui jouent ou **interagissent à la place du joueur**. Le classeur ne
fait que **lire** la collection (mêmes requêtes que la page « Collection » du site ; et, sur demande, une recherche de la
« Collection globale » avec les requêtes de cette page, pages de 50, pause de 300 ms) : jamais d'écriture dans le jeu,
jamais d'étiquette posée dans le jeu, jamais de lecture automatique quand il ne se passe rien. Toute lecture du jeu suit
un geste du joueur : le clic sur le favori, « Synchroniser », ou — favori relié — **une action qu'il vient de faire
lui-même dans le jeu** (ouvrir un paquet, défausser, mettre aux enchères ou annuler, échanger, réclamer une récompense) ;
seule exception, depuis le 2026-10-17 : les cotes automatiques (voir ci-dessous).
La synchro qui suit est celle qu'il aurait lancée d'un clic (2 lectures pour la synchro rapide), au plus une par minute
et 20 par heure, une relecture complète au plus tous les quarts d'heure — **toutes pages et onglets du jeu de ce
navigateur confondus** (rechargements et script Tampermonkey compris ; sauf stockage du navigateur refusé : par page),
et pour la relecture complète d'après la dernière vérifiée par le classeur, d'où qu'elle vienne. Classeur injoignable ou
en erreur : rien n'est lu dans le jeu, et les synchros automatiques se mettent en pause. Le favori relié ne joue pas, ne clique rien,
n'envoie au jeu aucune autre requête que ces lectures, et ne modifie ni les requêtes de la page ni leurs réponses. Pas
de lien vers le marché du jeu : il ne lit aucune recherche dans son adresse (sa recherche appelle
`GET /api/marketplace?q=…`) et remplir son champ demanderait un script sur la page du jeu. À la place, « Copier le nom »
(fiche d'une carte, fiche et icône d'une case vide) met le titre dans le presse-papiers ; c'est le joueur qui le colle
dans la recherche du jeu. Toute la case vide ouvre la fiche de la carte manquante (description, rareté estimée, vues,
collections, « Copier le nom » si l'article est vérifié, Wikipédia).

**Ce qui change avec le mode relié** (2026-10-16) : avant, le favori ne faisait plus rien après son message ; il reste
maintenant dans la page, `window.fetch` enveloppé, jusqu'à son rechargement ou « Arrêter ». **Risques** : (1) c'est
visible pour le jeu, et le favori ne s'en cache pas : `window.fetch` n'est plus la fonction native
(`window.fetch.toString()` ne dit plus `[native code]`), le badge est dans la page, la clé `classeur:relie` (des heures,
rien d'autre) est dans le `localStorage` du jeu, et un échec réseau d'une requête d'action que la page ne gère pas
n'est plus signalé comme rejet non géré (voir « Mode relié »). Plusieurs extensions publiques du
jeu (WikiMasters+, Toolbox, Wiki Master Toolkit, Collection+, WikiRemastered…) enveloppent déjà `fetch` de la même façon
pour lire les ouvertures de paquets ; le jeu pourrait détecter ces enveloppes, rien de connu ne dit qu'il le fait. (2) Les
lectures automatiques suivent le rythme du joueur : très actif, il peut atteindre 20 synchros rapides par heure
(≈ 40 lectures, plus une relecture complète par quart d'heure s'il défausse), dans tout le navigateur ; une limite de
lectures automatiques du jeu (`automation_limit`, 429) met le mode relié en pause. Deux navigateurs (ou appareils)
reliés ont chacun leurs limites de synchros rapides ; seules les relectures complètes sont bornées entre eux, par
`full_at` (quand la dernière a été vérifiée complète : sinon `full_at` est vide). (3) Le script Tampermonkey se relie à chaque page du jeu sans clic :
il ne lit rien avant une action, mais il n'y a plus de geste explicite pour le démarrer.

**Ce qui change avec « Mettre à jour les cotes »** (2026-10-16, voir « Le marché ») : le favori lit maintenant aussi,
au clic du joueur (et, depuis le 2026-10-17, sans clic : voir le paragraphe suivant), la base du jeu directement (Supabase : tables `auctions`, `cards`, `auction_bids`), avec la
session que la page du jeu a déjà, à son rythme : une requête par seconde au plus, 30 par lecture, arrêt sur `401`,
`403`, `429` ou `automation_limit`. Jamais d'écriture, jamais de session gardée ni renouvelée ailleurs que
par la page du jeu. **À dire franchement** : l'ami dont l'outil a inspiré cette partie lit la base directement pour
contourner la limite de 30 requêtes par minute de la route des ventes du jeu (`/api/marketplace/cards/<id>/sales`),
une mesure anti-automatisation du jeu ; passer par la base au lieu de ses pages, c'est faire ce que cette limite vise à
empêcher, donc un **risque plus élevé** que la synchro de la collection (qui reprend les requêtes de la page
« Collection »), même si le jeu laisse ces tables lisibles par la session du joueur. On reste bien en dessous de ce que
l'ami fait et de ce que la limite visait : 30 requêtes par lecture au plus, chacune
pour 100 cartes (la route des ventes, elle, sert une carte par requête). Pendant un clic, le rythme d'une requête par
seconde dépasse celui de la route (60 par minute contre 30) pendant une trentaine de secondes ; en moyenne, un clic de
temps en temps reste très en dessous. Le jeu peut voir ces lectures (clé publique, jeton du joueur, en-têtes du
navigateur) et les juger contraires à ses règles. Un avertissement court l'accompagne là où est le bouton (encart du
favori) et dans l'onglet « Marché » (« À savoir »).

**Ce qui change avec les cotes automatiques** (2026-10-17, demande de Cédric) : pour la première fois, le favori lit
quelque chose **sans geste du joueur** : la base du jeu toutes les 20 min tant qu'un onglet du jeu relié est visible
(script Tampermonkey compris : une minute après le chargement d'une page, puis au même rythme pour tout le navigateur).
Le reste suit encore un geste (une enchère, un achat, une mise en vente). **Risques** : le rythme moyen reste bas (au plus
6 lectures automatiques par heure et par navigateur, une par 5 min et par classeur entre appareils, 30 requêtes chacune,
une par seconde), mais c'est une lecture régulière et automatique de la base du jeu, ce que ses règles visent le plus
directement ; le jeu peut la voir (même jeton, mêmes en-têtes, à heures régulières). Pour limiter : rien quand l'onglet est
caché, rien sans session valide (jamais de renouvellement), pause sur toute limite ou refus du jeu, et « Couper les cotes
automatiques » dans l'encart (choix gardé pour tout le navigateur), qui revient à la lecture au clic seulement.
