# Le classeur — contrat entre l'interface et le serveur

Site multi-utilisateur (l'utilisateur et ses amis) pour suivre une collection WikiMasters (wiki-masters.com, cartes =
articles de Wikipédia FR) **hors du jeu** : étiquettes personnelles, collections à compléter. Inspiré de
wikimaster-one.vercel.app (« Le classeur »), réécrit avec notre propre code.

**Vocabulaire de l'interface** (à respecter partout) :
- **Collections** : les listes créées par l'utilisateur, surtout depuis « Depuis le jeu » (une recherche dans les cartes du jeu,
  faite par le serveur ; source `wm:<recherche>`), à la main dans « Nouvelle collection » (mots-clés, liste d'articles),
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

Hébergement : **Worker Cloudflare** (Workers Builds, branche `wikimasters`, dossier racine `site/`, `npx wrangler deploy` avec
`site/wrangler.jsonc` et `site/worker.js`, qui porte aussi les **déclencheurs planifiés** des lectures automatiques) ou, au choix, projet **Pages**
(dossier publié `public`, Pages Functions dans `site/functions/` : **sans lectures automatiques**, `worker.js` y est ignoré). Dans les deux cas
seul `site/public/` est servi, jamais `functions/`, `schema.sql` ni ce fichier. Base **D1** liée sous le nom `DB`. Variables d'environnement :
`COOKIE_SECRET` (chiffrement de la session du jeu gardée par le serveur, AES-GCM), `SIGNUP_CODE` (code d'invitation ; vide = inscription
fermée), `MAX_USERS` (facultatif, 50 par défaut), `SYNC_PAUSED` (facultatif : suspend toutes les lectures automatiques, voir « Lectures
automatiques »), `REFRESH_PAUSE_MS` (tests : remplace toutes les attentes). Développement local : `node dev/server.mjs` (sert `site/public/`, route
`/api/*` vers les fonctions, D1 simulée avec `node:sqlite` ; `--cron` fait tourner les lectures automatiques, `FAUX_JEU=1` simule la base du jeu avec
`dev/supabase.mjs`, voir le README).

## Arborescence et propriétaires

| Chemin | Rôle | Écrit par |
|---|---|---|
| `site/public/index.html`, `site/public/assets/*` | l'interface (Vue 3 depuis cdnjs, pas de build), dont `assets/relier.js` (le favori « Relier ») | agent interface |
| `site/public/_headers` | en-têtes de sécurité (CSP) | agent interface |
| `site/functions/api/[[path]].js` + `site/functions/_lib/*` | l'API | agent serveur |
| `site/schema.sql` | schéma D1 (aussi appliqué automatiquement : `CREATE TABLE IF NOT EXISTS` au premier appel) | agent serveur |
| `site/worker.js`, `site/wrangler.jsonc`, `wrangler.jsonc` | point d'entrée Worker (`fetch` et `scheduled`), liaisons, Cron Triggers | agent serveur |
| `dev/server.mjs`, `dev/d1.mjs`, `dev/supabase.mjs`, `dev/cron.mjs`, `dev/*.test.mjs`, `dev/ui/` | serveur local, D1 simulée, faux jeu (Supabase), lancement d'un cron à la main, tests | agent serveur |

## Authentification

- Pas de mot de passe. À l'inscription, le serveur génère une **clé** (32 octets aléatoires, base64url) et ne garde
  que son SHA-256. Le client la garde dans `localStorage` (`classeur-key`) et l'envoie dans l'en-tête
  **`X-Classeur-Key`** sur toutes les requêtes (sauf `POST /api/account`).
- Lien personnel : `https://<site>/#cle=<clé>` ; à l'ouverture, l'interface range la clé dans `localStorage` et efface
  le fragment de l'adresse (`history.replaceState`).
- Clé absente ou inconnue → `401 {error}`.
- **Une seule clé** : toutes les routes qui exigent une clé demandent la clé principale (`401` sinon). Le favori « Relier » n'en embarque aucune :
  il porte un **jeton de liaison** à usage unique (30 minutes), qui ne sert qu'à **déposer** une session du jeu, que le jeu doit reconnaître ; il
  n'ouvre jamais le classeur (voir « Liaison par favori « Relier » »). Avant le 2026-10-22, un favori de synchro embarquait une « clé d'import » :
  elle et ses routes n'existent plus, et la migration `session-serveur-2026-10-22` a effacé les clés d'import et les cookies collés gardés.
- **Lien d'un autre classeur** : l'interface n'écrase jamais une clé gardée sans vérifier la nouvelle (`GET /api/me`)
  et demander confirmation.

## Format des erreurs

Toujours du JSON : `{ "error": "message en français, lisible tel quel" }` avec un statut 4xx/5xx. Champs en plus possibles : `needs_link: true`
(aucun compte du jeu relié, ou session du jeu qui ne sert plus : l'interface propose de relier, voir « Session du jeu »), `retry_after` (`429`,
en **secondes**), `limited: true` (`429` : le jeu limite les lectures automatiques), `quota` (`429` : cotes encore acceptées aujourd'hui),
`conflict: true` avec `target` (`409` de `targets/save`). Sans base liée (`env.DB` absent), toute route sauf `/api/health` répond
`503 {error:"Le classeur n'est pas encore configuré : …"}`.

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

**Tags du jeu** (`gtags`, 2026-10-18 ; « je parlais [des tags] de wiki-masters, pas ceux en automatique ») : les étiquettes que le joueur
crée lui-même dans le jeu (table `tags` du jeu : `id` UUID, `name`, `color` hexadécimal, par défaut `#94a3b8` ; noms uniques par joueur sans
tenir compte de la casse ; posées sur les entrées de sa collection par `user_card_tags`). Le serveur les lit avec chaque exemplaire, par la jointure
`tags:user_card_tags(tag:tags(id,name,color))` de la lecture de la collection : chaque exemplaire porte `tags` = `[{id, name, color}]`
(`toEntry`). Lus de façon tolérante (`cards.js` `gameTagsOf`) : le nom d'un objet (`name`, sinon `label`, `title`, `tag`, `value`, un niveau
d'objet en plus : `{tag: {name}}`), une chaîne, un nombre ; un objet sans nom est ignoré (jamais un identifiant opaque pris pour un nom). **Format
pas encore vu dans une vraie collection** (la seule relevée, le 15/10, n'en avait aucun). Carte : noms nettoyés (espaces), 60 caractères au plus,
30 par carte, **réunis sur tous ses exemplaires** (un tag est posé sur un exemplaire, pas sur la carte), sans doublon, triés (ordre binaire), absents
s'il n'y en a aucun ; `gtagc` = la couleur de chacun quand le jeu en donne une valide (`#rgb`, `#rrggbb`, `#rrggbbaa`, en minuscules). Gardés dans
`cards.data`, rendus par `GET /api/cards` et `?since` comme le reste de la carte, **jamais montrés aux autres membres** ; ils ne se mêlent jamais
aux tags du classeur (table `tags`).

`variants` (2026-10-16, pour coter chaque exemplaire, voir « Le marché ») : `{"<rareté>[*]": nombre}`, « * » = brillant, clés dans l'ordre
binaire, somme = `count`. Rareté d'un exemplaire = son `snapshot_rarity` (rareté quand il a été obtenu, celle des ventes du marché) s'il est dans la
ligne du jeu, sinon `card.rarity`. Calculé par la lecture (`entryToCard`) et additionné en SQL à la finalisation (gardé seulement s'il compte tous les
exemplaires de la carte) ; forme invalide (rareté inconnue, somme fausse) : seulement oublié. Absent (carte rangée avant lui) : la cote de la carte est
approchée (tous ses exemplaires dans `rarity`, un seul brillant si `shiny`). Une lecture **non vérifiée** ne le change pas (voir « Lecture de la
collection »). Jamais montré aux autres membres.

**Tags du jeu dans la page** : fiche d'une carte, « Tags du jeu » en pastilles (couleur du jeu en point, gris
`#94a3b8` sans couleur ; lecture seule : ils se changent dans le jeu), au-dessus de « Tes tags » et à part d'eux ;
« Mes cartes », section « Tags du jeu » du menu de gauche (après « Raccourcis ») : un bouton par tag (sans tenir compte
de la casse) avec son nombre de cartes, les plus portés d'abord, 24 puis « Afficher les N autres » ; clic : ce tag seul
(ou plus aucun), Ctrl/⌘+clic : combiner (toutes les cartes qui les portent tous), combinable avec tes tags du classeur ;
filtre rappelé dans la ligne des résultats (« Jeu : Maladie », retirable ; « Réinitialiser les filtres » le retire
aussi) ; la recherche lit aussi les tags du jeu. Aucun tag du jeu lu : « Aucun tag du jeu lu pour l'instant : ceux que
tu poses sur tes cartes dans wiki-masters.com arrivent avec la prochaine lecture de ta collection (onglet « Synchro »). » Fenêtre « Ajouter par tags du jeu » : voir « Onglet « Collections » ».

**Ligne brute du jeu** (réponse de `GET <supabase>/rest/v1/user_cards?select=…`, voir « Lecture de la collection ») : `{id, card_id, user_id,
count, starred, is_shiny, obtained_at, snapshot_rarity, snapshot_atk, snapshot_def, card:{id, wikipedia_title, wikipedia_url, image_url, hide_image,
rarity, atk, def, q_score, pageviews, category, lang}, tags:[{tag:{id, name, color}}]}`. Plusieurs lignes peuvent avoir le même `card_id` (exemplaires) :
on les regroupe. Le `user_id` du jeu n'est jamais stocké. `toEntry` (`refresh.js`) la ramène à la forme de l'ancienne entrée `my-collection` du jeu
(`{id, card, tags, count, card_id, starred, is_shiny, obtained_at, snapshot_rarity}`), que lit `entryToCard` (`cards.js`) : les `snapshot_*` non nuls
remplacent rareté (si elle est connue), attaque et défense de la carte. **Noms des colonnes relevés dans l'ancien favori (retiré le 2026-10-22) et dans le projet de
référence, pas vérifiés par ce Worker sur la vraie base.**

**Recherche dans les cartes du jeu** (« Depuis le jeu ») : `GET <supabase>/rest/v1/cards?select=id,wikipedia_title,rarity,category,image_url,hide_image,lang
&wikipedia_title=ilike.*<texte>*&order=wikipedia_title,id&limit=201`, avec la session reliée du membre (voir `GET /api/game/cards`) : lignes **à plat** de la
table `cards` du jeu (`rarity` = rareté actuelle de la carte dans le jeu). Aucune recherche de la « Collection globale » du site du jeu (`/api/cards`) n'est
plus faite.

## Points d'accès

| Méthode et chemin | Corps | Réponse |
|---|---|---|
| `GET /api/health` | (sans clé) | `{ok, db, cookie_secret, signup_open, sync_paused, cron}` : présence des réglages, jamais leur valeur ; `sync_paused` : `SYNC_PAUSED` est posé (toutes les lectures automatiques suspendues, voir « Lectures automatiques ») ; `cron` : `{collection:{last_at, last_result}, market:{last_at, last_result}}`, la dernière passe de chaque déclencheur (`null` tant qu'il n'a rien fait), ou `null` si la table `cron_state` n'existe pas encore (la santé répond avant la création du schéma) ; `ok` vaut `false` sans base liée |
| `POST /api/account` | `{code, name?}` (`code` = `SIGNUP_CODE`) | `201 {key, user:{id, name}}` ; `409` si le prénom est déjà celui d'un autre classeur (comparé sans casse, accents ni espaces en trop), avec un message qui dit comment retrouver son lien (Réglages d'un appareil où il est ouvert, ou un nouveau lien demandé à la personne qui gère le classeur) ; exception : un classeur de ce prénom qui n'a jamais servi (aucune lecture, aucun compte du jeu relié, aucune carte ni collection) est effacé et remplacé (2026-10-17 : des amis qui avaient perdu leur lien recréaient un second classeur) ; sans prénom, aucun contrôle |
| `GET /api/me` | | `{user:{id, name, created_at, pseudo}, fetched_at, card_count, cards_rev, new_ids, prefs, shared, shared_targets, public_id, last_chat_id, market_at, last_sync, wikibidous, wish_mode, auto_wish, wish, session:{linked, lost, at, auto_sync, paused, fails, checked_at, full_at}}` (`auto_wish`, `wish` (2026-10-24) : l’indicateur interne de souhaits à gérer et sa dernière passe, ou `null`, voir « Liste de souhaits du jeu » ; `wikibidous` (2026-10-23) : son solde de wikibidous lu dans le jeu à la dernière synchro, `{n, at}`, ou `null` s'il n'a jamais été lu, voir « Lecture de la collection » ; `session` (2026-10-22) : l'état du compte du jeu relié, **jamais** son contenu : `linked` = session présente et utilisable, `lost` = `null` ou pourquoi elle ne sert plus (« révoquée ») : le membre est « à relier », `at` = liaison ou dernier renouvellement, `auto_sync` = réglage « Synchro automatique », `paused` = `fails` ≥ 3 : les lectures automatiques sont en pause, `fails` = échecs d'affilée, `checked_at` = dernière vérification légère ou lecture, `full_at` = dernière lecture **vérifiée** complète, voir « Lecture de la collection » ; `public_id` (2026-10-20) : son propre identifiant public tant qu'il montre ses cartes, `null` sinon, pour se citer dans le chat (« #u: ») ; `last_chat_id` : numéro du dernier message du chat, supprimé ou non, `0` sans message, lu dans la même requête que le compte, voir « Chat » ; `market_at` (2026-10-17) : heure de la dernière lecture du marché reçue ou du dernier essai fini, réussi ou non, `null` sans, lue dans la même requête (ligne `market` par sa clé primaire) : la page relit alors l'onglet « Marché », voir « Le marché » ; `cards_rev` : révision de la liste des cartes, voir « Lecture incrémentale » ; `shared` : montre ses cartes aux autres membres, `shared_targets` : et ses collections à compléter, voir « Partage entre membres » ; `card_count` : tenu par les lectures dans `sync_state`, sans relire les cartes (classeur lu avant ce compteur : compté une fois, puis gardé là, si `sync_state` n'a pas changé entre-temps) ; `last_sync` : dernière ligne du journal des synchros, `{at, kind, via, result, message}` ou `null`, gardée dans le compte (aucune requête de plus), voir « Journal des synchros »). `next_full` et `has_import_key` (d'avant le 2026-10-22) n'existent plus |
| `PATCH /api/me` | `{name?, pseudo?, prefs?, shared?, shared_targets?, auto_sync?, fast_sync?, auto_friend?, wish_mode?, auto_wish?}` (`pseudo` : pseudo dans le jeu, 2026-10-18, 40 caractères au plus, sans espace ni « / ? # < > \ », vide = aucun ; rendu dans `user.pseudo` de `GET /api/me`, et aux membres avec qui il partage dans `GET /api/members` : « Entre amis » le montre avec « copier » et un lien vers son profil du jeu, `https://www.wiki-masters.com/profile/<pseudo>` ; ailleurs, la page le montre partout où paraît le prénom d'un de ces membres (2026-10-19, demande de l'utilisateur : « voir le pseudo in game partout où un pseudo est affiché ») : discret à côté du prénom dans les messages du chat (lien vers son profil du jeu), dans les suggestions de « @ » et la liste « Un membre… » des échanges, en info-bulle (prénom souligné en pointillés) sur les mentions, les « qui a quoi », « Chez : … » des fiches et des cases vides et les noms des échanges ; rien de plus du serveur : la page le tire de `GET /api/members` (le chat associe auteur et mentions au membre par le prénom, unique), donc jamais pour un membre qui ne montre pas ses cartes, ni sur tes propres messages ; réglé dans Réglages, « Ton pseudo dans WikiMasters ») (`prefs` : objet JSON ≤ 16 Ko (4 Ko avant le 2026-10-24), remplacé en entier, rangé tel quel par le serveur : `hidden_proposals` = catégories proposées retirées (`wp:<nom>`), `hide_proposals` = propositions masquées ; `deal_filter` et `deal_presets` (2026-10-24) = filtres de « Bonnes affaires à acheter », en cours et enregistrés (voir « Le marché ») ; les anciennes `hidden_catalog` (ids du catalogue et `wp:<nom>`) et `hide_catalog` restent acceptées : l'interface les lit, garde les `wp:<nom>`, oublie les ids du catalogue et réécrit le tout au nouveau format à la modification suivante ; `shared` : booléen, sinon `400` ; `shared_targets` : booléen, `true` seulement si l'on montre ses cartes (déjà, ou `shared:true` dans la même requête), sinon `400` ; `shared:false` le remet à `false` ; `auto_sync` : booléen, le réglage « Synchro automatique » (`true` par défaut : le serveur lit la collection et le marché tout seul, voir « Lectures automatiques » ; `false` : seulement au clic), sinon `400` ; `fast_sync` : booléen, le réglage « Synchro rapide du marché » (`false` par défaut, voir « Rythme » du marché ; aussi rendu par `GET /api/me`), sinon `400` ; `auto_friend` (2026-10-24) : booléen, le réglage « Envoyer une demande d'ami aux membres du classeur » (`false` par défaut, voir « Amis dans le jeu » ; aussi rendu par `GET /api/me`), sinon `400` ; `auto_wish` : ancien réglage global, conservé pour les pages déjà ouvertes ; sélectionne/désélectionne toutes les collections existantes. Le choix actuel passe par `targets.wish_sync` (voir « Liste de souhaits du jeu »), sinon `400`) | `{user, prefs, shared, shared_targets, public_id, auto_sync, fast_sync, auto_friend, wish_mode, auto_wish}` (`public_id` : comme `GET /api/me`, après la modification) ; `GET /api/me` renvoie aussi `prefs` (`{}` par défaut) |
| `DELETE /api/me` | | `{ok:true}` : efface tout (cartes, cartes retirées, étiquettes, collections, lecture en attente, marché et valeur, journal des synchros, **session du jeu chiffrée**) et le compte ; ses messages du chat sont vidés et perdent leur auteur (voir « Chat »). La session n'est pas déconnectée côté jeu |
| `GET /api/favori.js` | (sans clé) | le code du favori « Relier » (`public/assets/relier.js`, où `__SITE__` devient l'origine du classeur), `text/javascript`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` : c'est ce que charge le favori (voir « Liaison par favori « Relier » »). `503` sans les fichiers du site (`ASSETS`), `404` si `relier.js` manque |
| `POST /api/key/rotate` | | `{key}` : nouvelle clé principale ; l'ancienne (et l'ancien lien) cesse de marcher |
| `GET /api/cards?part=X` | (`part` facultatif : `0` pour la première page, puis le curseur `next_part` renvoyé tel quel ; pages de 1 000 cartes) | `{rev, fetched_at, cards:[Carte], new_ids:[id…], part, next_part}` (`next_part` : curseur opaque, `null` à la dernière page ; `rev` : révision lue avant les cartes, garder celle de la page `0`) ; sans `part` : `{rev, fetched_at, cards, new_ids}`, tout d'un coup (à éviter au-delà de ~3 000 cartes : limite de calcul) |
| `GET /api/cards?since=R` | `R` : entier ≥ 0, la `rev` gardée (sinon `400`, et `400` avec `part`) | `{rev, delta:true, cards:[Carte], gone:[id…], fetched_at, new_ids}` : cartes changées (données ou étiquettes) et cartes retirées depuis `R` ; ou `{rev, delta:false}` : tout recharger (voir « Lecture incrémentale ») |
| `POST /api/session` | `{cookie}` **ou** `{har:{log:{entries:[{request:{url, headers:[{name,value}]}}]}}}` : l'en-tête `Cookie` (16 384 caractères au plus) d'une page du jeu, **copié depuis une fenêtre privée** où le membre est connecté, ou un HAR dont le serveur extrait l'en-tête `Cookie` d'une requête vers `www.wiki-masters.com` (de préférence `/api/my-collection`) | `{ok:true, pseudo, session}` (`pseudo` : son pseudo dans le jeu, ou `null` ; `session` : comme dans `GET /api/me`) : relie le compte du jeu de cette session au classeur après l'avoir **vérifiée auprès du jeu** (`auth/v1/user`, `profiles`), voir « Session du jeu ». `400` ni cookie ni HAR, pas de session `sb-…-auth-token` lisible, HAR sans requête vers le jeu ou sans cookie ; `401 {error}` session que le jeu ne reconnaît pas (expirée, ou copiée hors d'une fenêtre privée) ; `409` compte du jeu déjà relié à un autre classeur ; `429 {limited:true}` le jeu limite les lectures automatiques ; `502` base du jeu injoignable ; `500` sans `COOKIE_SECRET` |
| `DELETE /api/session` | | `{ok:true}` : le classeur oublie la session du jeu (chiffrée, `game_uid`, état « à relier », bail, échecs d'affilée) ; le compte du jeu n'est pas déconnecté ; cartes, étiquettes et collections restent |
| `POST /api/refresh` | `{}` | `{count, fresh, new_ids, complete, skipped, removed, kept}` : « Rafraîchir », une **lecture complète** de la collection par le serveur (voir « Lecture de la collection »). `count` = cartes du classeur après la lecture ; `fresh` = cartes nouvelles ; `new_ids` = pastilles « nouvelle » (remplacées seulement si la lecture apporte une carte nouvelle) ; `complete` = `true` (lecture vérifiée), `false` (non vérifiée : rien n'est retiré, `moved:true` en plus si la collection a bougé pendant la lecture) ou `null` (pas de compte exact) ; `skipped` = entrées du jeu ignorées (invalides) ; `removed` = cartes retirées, seulement par une lecture vérifiée ; `kept` = cartes du classeur non vues, gardées. `{…, superseded:true}` : rien d'écrit, une lecture commencée après celle-ci est déjà appliquée. `{count:0, empty:true}` : collection vide dans le jeu, rien n'a changé. Un succès remet `sync_fails` à 0. Erreurs : `401 {error, needs_link:true}` aucun compte relié, ou session « à relier » ; `409` une lecture de ce compte est déjà en cours (cron, autre appareil) ; `429 {error, retry_after}` (**secondes**, 60 au plus) moins d'une minute après le clic précédent, tous appareils confondus ; `429 {error, limited:true}` le jeu limite les lectures automatiques ; `502` base du jeu injoignable ou réponse inattendue ; `400` plus de 50 000 exemplaires ou 20 000 cartes. Les refus `409` et `429 retry_after` (avant toute lecture) ne sont pas notés au journal ; les autres échecs le sont |
| `POST /api/link` | `{}` | `{token, until}` : un **jeton de liaison à usage unique**, valable 30 minutes (`until` = son échéance, ISO), pour le favori « Relier » ; le serveur n'en garde que le SHA-256, un nouveau jeton remplace l'ancien ; il n'ouvre jamais le classeur (voir « Liaison par favori « Relier » ») |
| `POST /api/link/session` | **sans clé** ; CORS : seulement `https://www.wiki-masters.com` et `https://wiki-masters.com` (`OPTIONS` répond `204`) ; 20 Ko au plus. `{token, cookie}` : le jeton de liaison et le cookie de session de la page du jeu | `{ok:true, pseudo}` : dépose et lie la session (mêmes vérifications que `POST /api/session`, `via:'relier'` au journal). `401` jeton inconnu, périmé ou déjà utilisé (« Lien de liaison périmé ou déjà utilisé… ») ou session non valable ; `400` cookie illisible (**le jeton n'est pas consommé**) ; `409` compte du jeu déjà relié à un autre classeur ; `429`, `502` comme ci-dessus. Le jeton est consommé avant la vérification auprès du jeu : un `401` de session, un `409` ou un `429` le consomment |
| `POST /api/tags/set` | `{card_id, tags:[…]}` | `{tags}` |
| `POST /api/tags/bulk` | `{card_ids:[…], add:[…], remove:[…]}` | `{ok:true}` |
| `POST /api/tags/rename` | `{from, to}` (fusionne si `to` existe) | `{ok:true}` |
| `GET /api/targets` | | `{targets:[Collection]}` (avec `auto`, l'ajout automatique, `null` sans règle) |
| `POST /api/targets/save` | `{id?, name, items, source?, wish_sync?, auto?, auto_skip?, expect_updated_at?, upload?}` | `{target}` : crée, ou remplace celle de cet `id` ; **sans `id` et avec une source `wp:…` ou `links:…`**, remplace la plus ancienne collection qui a déjà cette source (deux onglets, deux appareils ; comparée en entier : `links:<titre>`, `links:<titre>#<colonne>` et `links:<titre>#<colonne>#§<sections>` sont trois sources, et l'interface fait une collection par choix de colonne et de sections d'une page, 2026-10-19 ; l'ancienne source `links` sans « : » n'est pas concernée). **Taille** (2026-10-19, demande de l'utilisateur : plus de limite à 3 000 éléments ni à 600 Ko par création) : aucun nombre d'éléments maximal ; **1,7 Mo** d'éléments en JSON par collection (une ligne de D1 fait 2 Mo au plus, `auto` compris), **600 Ko par envoi** (au-delà, `400` : 3 000 éléments réalistes coûtent déjà ~2 ms de JS, loin des 10 ms) ; une collection plus lourde arrive **en morceaux** : `upload: {id (8 à 64 caractères [A-Za-z0-9_-], tiré par la page), part (0 à 99), last?}`. Un morceau sans `last` ne porte que ses `items` (non vides) : rangé dans `target_uploads` (sans ses crochets), réponse `{part}` ; trois envois en cours au plus par compte (les plus anciens partent), 1,7 Mo au plus chacun, effacés au bout d'une heure. Le dernier (`last: true`) porte le reste du corps et ses éléments (vides permis) : les morceaux 0 à `part - 1` doivent tous être là (sinon `400`, rien d'écrit), la taille de l'ensemble est contrôlée, puis la collection est écrite **en SQL** (`group_concat` des morceaux dans l'ordre : rien n'est relu en JavaScript) et les morceaux effacés, dans une transaction ; la réponse a alors `target.items = null` (la page garde ceux qu'elle a envoyés). **Ajout automatique** (2026-10-18, voir « Ajout automatique » dans « Onglet « Collections » ») : `auto` **absent = inchangé** (règles et exclusions gardées : « Modifier », « Réorganiser », un intercalaire, une fusion… n'ont rien à renvoyer), `null` = effacé (règles et exclusions), `{rules:[{k, v}], skip?}` = règles remplacées (`k` : `gtag` tag du jeu, `cat` catégorie du jeu, `tag` tag du classeur — `v` = le tag, ou `Catégorie/` pour toute une catégorie de tags — ; `v` nettoyé, 1 à 500 caractères ; 20 règles au plus ; doublons repliés, sans la casse pour `gtag` et `cat` ; liste vide = effacé) et exclusions gardées, sauf `skip` donné (liste de 2 000 titres au plus, qui les remplace) ; `auto_skip: {add?:[titre…], del?:[titre…]}` (20 000 titres au plus chacun, 1 à 300 caractères) : titres ajoutés aux exclusions (à la fin, sans doublon) ou retirés, comparés comme la page (première lettre en majuscule, « _ » en espace, apostrophes et guillemets typographiques ramenés à l'ASCII), appliqué après `auto` et **ignoré s'il ne reste pas de règle** ; au-delà de 2 000 exclusions (ou de 200 Ko pour tout `auto`), les plus anciennes sont oubliées (un retrait ne doit jamais échouer pour ça) ; forme invalide : `400`, rien d'écrit. `auto` compte dans les 5 Mo du compte. **`expect_updated_at`** (texte, 40 caractères au plus, seulement avec un `id`, sinon `400`) : enregistrement conditionnel, seulement si la collection rangée a encore ce `updated_at` (dans la même requête SQL que l'écriture) ; sinon `409 {error, conflict:true, target}` où `target` est la collection telle qu'elle est maintenant (`null` si elle a été supprimée : jamais recréée), et rien n'est écrit. L'ajout automatique de la page s'en sert (deux onglets, deux appareils), ainsi que « Arrêter » ; les autres actions de la page ne l'envoient pas (comportement d'avant) |
| `POST /api/targets/delete` | `{id}` | `{ok:true}` |
| `POST /api/targets/order` | `{ids}` (2026-10-24 ; identifiants des collections dans l'ordre voulu, sans doublon, 200 au plus ; un id inconnu ou d'un autre compte est ignoré) | `{ok:true}` : « Réorganiser » de « Mes collections » (colonne `targets.pos`) ; une collection du compte absente de `ids` perd sa place. Ni les éléments ni `updated_at` ne changent. `GET /api/targets` rend les collections dans cet ordre, puis celles sans place (créées depuis, ou jamais rangées) de la plus ancienne à la plus récente ; un enregistrement (`targets/save`, fusion comprise) garde la place. Les amis voient toujours ses collections dans leur ordre à eux (`GET /api/members/<id>/targets` n'en tient pas compte) |
| `GET /api/members` | (il faut partager soi-même, sinon `403`) | `{members:[{id, name, pseudo, count, fetched_at, targets, wikibidous}]}` (`pseudo` : son pseudo dans le jeu, ou `null` ; `wikibidous` (2026-10-23) : son solde de wikibidous lu à sa dernière synchro, `{n, at}`, ou `null`, pour en demander dans « Proposer un échange ») : les **autres** membres qui partagent, sauf les classeurs vides (ni carte ni collection) ; `id` = identifiant public, `count` = nombre de cartes différentes, `fetched_at` = dernière synchro, `targets` = `null` s'il ne montre pas ses collections à compléter, sinon `{count, updated_at}` (leur nombre et leur dernier changement) |
| `GET /api/members/<id>/cards?part=X` | (`part` comme pour `GET /api/cards`, absent = `0` ; `403` si l'appelant ne partage pas, `404` si ce membre n'existe pas ou ne partage pas, ou plus) | `{member:{id, name, fetched_at}, cards:[{id, title, rarity, count, shiny, image, url, v?}], part, next_part}` : pages de 1 000 cartes, sans étiquettes ; `v` = la cote de la carte telle que rangée dans le cache commun `prices` (`{"<rareté>[*]": {p, n, w, l, d}}`, voir « Le marché »), seulement quand elle en a une (pas pour `{}`, carte lue sans vente) |
| `GET /api/members/<id>/targets?part=X` | (`part` : `0` ou absent, puis le curseur `next_part` ; `403` si l'appelant ne montre pas ses cartes, `404` si ce membre ne montre pas, ou plus, ses cartes **ou** ses collections) | `{member:{id, name}, targets:[{id, name, kind, items:[{title, qid?, sep?}]}], part, next_part}` : ses collections à compléter (toutes, celles faites d'une catégorie de Wikipédia comprises), réduites au nom, à leur nature (`kind` : `category` pour une collection créée depuis une catégorie de Wikipédia, source `wp:…`, sinon `collection`) et, pour chaque élément vérifié (`status` `ok`), au titre, au qid et à `sep: true` pour un intercalaire ; pages d'au plus 512 Ko d'éléments rangés (plus la collection qui franchit ce seuil) |
| `GET /api/chat` | (clé principale ; `?after=<rev>` ou `?before=<id>` facultatifs, entiers ≥ 0, pas les deux, sinon `400`) | sans paramètre : `{messages:[Message], rev, last_id, older}` = les 100 plus récents, du plus ancien au plus récent (`rev` : curseur de la lecture suivante ; `last_id` : numéro du dernier message, supprimé ou non ; `older` : il y en a de plus anciens) ; `?before=<id>` : `{messages, older}` = les 100 d'avant ce message ; `?after=<rev>` : `{messages, deleted:[id…], rev, last_id, more}` = ce qui a changé depuis cette révision (nouveaux messages, numéros des messages supprimés ; `more:true` : plus de 100 changements, `rev` = celle du dernier rendu) ; `{reset:true, rev, last_id}` si la révision est inconnue (base recréée : tout relire). Voir « Chat » |
| `POST /api/chat` | `{text, reply_to?}` (clé principale ; corps de 8 Ko au plus ; `reply_to` (2026-10-23) : numéro du message auquel il répond) | `201 {message:Message}` (liens de collection déjà cités) ; `400` texte vide, de plus de 500 caractères ou contenant un lien personnel (`#cle=…`), classeur sans prénom, ou `reply_to` qui n'est pas un entier > 0 ; `404` le message auquel il répond n'existe plus (supprimé, purgé) ; `429 {error, retry_after}` (secondes) au-delà de 10 messages par minute ou 300 par 24 h pour ce classeur, ou de 1 000 par 24 h pour tout le salon |
| `DELETE /api/chat/<id>` | (clé principale) | `{ok:true}` (aussi s'il l'avait déjà supprimé) ; `403` message d'un autre, `404` message inexistant ou supprimé |
| `POST /api/chat/<id>/react` | `{emoji, on}` (clé principale ; 2026-10-24 ; 1 Ko ; `emoji` parmi 👍 ❤️ 😂 😮 😢 🎉 🔥 👀, `on` : `true` mettre, `false` retirer) | `{id, reactions:[Reaction]}` : les réactions du message après le changement (`[]` sans) ; déjà mise ou déjà retirée : rien ne change. `400` emoji hors de la liste, `on` qui n'est pas un booléen, classeur sans prénom ; `404` message inexistant, supprimé ou purgé ; `429 {error, retry_after}` au-delà de 30 réactions mises ou retirées par minute ou 500 par 24 h pour ce classeur. Voir « Chat », réactions |
| `GET /api/chat/last` | (sans clé) | `{last_at}` : heure du dernier message d'un membre (`null` sans message), suppressions sautées ; ni texte, ni auteur, ni numéro. Sert au skill « publier » (voir « Nouveautés ») |
| `GET /api/market` | (clé principale) | `{value:{value, priced, cards, approx}, history:[{date, value, priced, cards}], live:{deals, bids, sales} \| null, live_at, attempt:{start, end?, ok?, why?, v, auto} \| null}` : valeur calculée maintenant (le point du jour mis à jour s'il a changé), 400 jours d'historique au plus, lecture du marché de moins de 7 jours, dernier essai de lecture (`v` : `'serveur'` ; `null` : jamais) |
| `GET /api/market/card?id=<card_id>` ou `?title=<titre>` | (clé principale ; 2026-10-22) | `{card_id, at, auctions:[{a, r, s, ask, bid, cur, base, end, atk, def, lead, mine, n}], more, sales:[{d, p, k}], v}` : le **marché d'une carte**, lu à l'ouverture de sa fiche dans la base du jeu (voir « Le marché », « Marché d'une carte ») ; `card_id: null` : aucune carte du jeu n'a ce titre. `400` paramètres mal formés ; `401 {needs_link:true}` aucun compte relié ; `429 {retry_after}` plus de 12 fiches lues dans la minute ; `429 {limited:true}` / `502` comme une passe |
| `GET /api/market/auction?id=<id de l'enchère>` | (clé principale ; 2026-10-22) | `{a, gone, status, bids, bidders, leader, seller, leading, selling, my_bid, cur}` : le **détail d'une enchère**, lu sur le site du jeu (`/api/marketplace/<id>`) ; `{a, gone:true}` : le jeu ne la connaît plus. `429 {retry_after}` plus de 20 détails dans la minute ; `429 {limited:true, retry_after}` le jeu limite : détails en pause 10 min pour ce membre ; `409` session à renouveler pendant qu'une lecture tient le bail ; `401`, `502` |
| `GET /api/market/prices?part=X` | (clé principale ; `part` comme pour `GET /api/cards`) | `{prices:[{id, v, at, t?}], part, next_part}` : cotes de tes cartes et des cartes voulues dont le card_id est connu (`t` : leur titre dans tes collections), pages de 1 000 |
| `POST /api/market/refresh` | `{}` | `{ok:true, read, left, deals, running, light:true}` : « Actualiser le marché », une **passe légère de lecture du marché** par le serveur avec la session reliée (2026-10-23 : tes enchères, tes ventes, les bonnes affaires et leurs cotes, **sans les cotes du plan**, laissées aux lectures automatiques ; voir « Le marché ») : `read` = cotes lues, `left` = cotes du plan à relire (par les lectures automatiques), `deals` = bonnes affaires, `running` = tes mises en cours. `401 {error, needs_link:true}` aucun compte relié ou session « à relier » ; `409` une passe, ou une lecture de la collection, est déjà en cours ; `429 {error, retry_after}` (**secondes**, 60 au plus) la dernière passe de ce classeur a commencé il y a moins de 60 s, **même finie**, d'où qu'elle vienne ; `429 {error, quota:0}` quota du jour des cotes atteint (rien n'est lu) ; `429 {error, limited:true}` le jeu limite les lectures ; `502`. Un échec en cours de passe garde les cotes déjà lues et note sa raison dans `attempt.why` |
| `GET /api/game/cards?q=` | (clé principale) `q` : 1 à 100 caractères (sinon `400`) | `{cards:[{card_id, title, rarity, category, image}], more}` : les cartes du jeu dont le **titre contient** `q` (une requête `cards?wikipedia_title=ilike.*q*` avec la session reliée), dans l'ordre des titres, 200 au plus (`more:true` : il y en a d'autres) ; la version française d'un même titre l'emporte, une rareté inconnue est écartée, `image` = `null` si la carte la cache. `401 {error, needs_link:true}`, `429 {limited:true}`, `502`. Sert « Depuis le jeu » (voir « Onglet « Collections » »). **Non vérifié sur la vraie base** : le filtre `ilike` sur `wikipedia_title`, et ce que la sécurité par rangée du jeu laisse voir à un joueur (la recherche pourrait rendre moins que la « Collection globale » du jeu) |
| `POST /api/trades/create` | (clé principale) `{member, give?, get?, give_wb?, get_wb?}` : `member` = identifiant public de l'ami, `give` / `get` = ids de cartes du jeu (tes cartes, les siennes), 40 au plus ; `give_wb` / `get_wb` (2026-10-23) = wikibidous que tu donnes / que tu demandes, entiers de 0 à 100 000 000 (absents : 0, sinon `400`) ; au moins une carte ou des wikibidous ; 8 Ko | `{trade:{id, status}, given:[{id, title}], received:[{id, title}], given_wb, received_wb, url}` : la proposition d'échange **créée dans le jeu** (en attente : l'ami l'accepte dans le jeu), voir « Proposer un échange ». `403` sans partage ; `404` ami inconnu ou qui ne partage pas ; `401 needs_link` sans compte relié ; `409` carte absente du jeu (titres nommés), ami introuvable dans le jeu, bail pris, ou refus du jeu (son message repris) ; `502` panne ou réponse inattendue du jeu (« regarde dans le jeu s'il a été créé ») ; `429` limite du jeu |
| `GET /api/friends[?fresh=1]` | (clé principale ; 2026-10-24) | `{linked, at, members:{<identifiant public>: st}, list:[{id, name, pseudo, st}], can_request, auto_friend, error?}` : pour chaque autre membre qui montre ses cartes, ton amitié avec lui **dans le jeu** (`st` : `friends` amis, `sent` ta demande attend, `received` sa demande t'attend, `none` rien ou demande refusée, `unknown` sans compte relié, liste illisible, ou membre ni relié ni avec pseudo), d'après ta liste d'amis du site du jeu gardée (`at`), relue si elle a plus d'une minute ou avec `fresh=1` ; une lecture impossible garde l'ancienne et dit pourquoi (`error`). `can_request` : le classeur envoie les demandes d'ami (interrupteur `FRIEND_ROUTE.known`). Voir « Amis dans le jeu » |
| `POST /api/friends/request` | (clé principale ; 2026-10-24) `{member}` (identifiant public) ; 1 Ko | `{status}` : `sent` (demande d'ami **créée dans le jeu**, à ton nom), ou `friends` / `sent` / `received` si vous êtes déjà amis ou qu'une demande attend (rien n'est envoyé). `400`, `404` membre inconnu ou qui ne partage pas, `401 needs_link`, `503` envoi coupé (`FRIEND_ROUTE.known`, « envoie-la dans le jeu »), `409` refus du jeu (son message repris) ou membre introuvable dans le jeu, `429 {limited:true}`, `502` panne (« regarde dans le jeu si elle est partie ») |
| `POST /api/wishlist/sync` | (clé principale) `{}` ; 1 Ko | `{wish:{at, via, rev, size, added, removed, left, none, error?}}` : synchronise les collections choisies et termine les retraits. Une fois par minute ; `401 needs_link`, `409` lecture en cours/refus du jeu, `429` limite, `503` interrupteur, `502` |
| `GET /api/wishlist/missing` | (clé principale) | `{items:[{title, collections:[{id,name}]}], revision}` : titres recherchés sans résultat, encore manquants dans les collections synchronisées |
| `POST /api/wishlist/missing` | (clé principale) `{revision, all:true}` ou `{revision, titles:[...]}` | `{removed, collections, skipped}` : retire les titres admissibles des collections synchronisées ; `409` si la liste a changé ou si une synchronisation est en cours |
| `POST /api/friends/request-all` | (clé principale ; 2026-10-24) `{members:[identifiants publics]}`, 1 à 20 ; 4 Ko | `{results:[{id, status} \| {id, error}], limited?}` : plusieurs demandes d'ami d'un coup (« Ajouter les membres pas encore amis »). Une lecture de la liste d'amis, puis une demande à chacun de ceux qui ne sont ni amis ni en attente, 1 s entre deux ; `status` comme ci-dessus ; une limite du jeu arrête les envois (`limited`, les suivants en `error`). `400`, `401 needs_link`, `503` envoi coupé |
| `GET /api/market/sell?id=<card_id>` | (clé principale ; 2026-10-23) | `{card_id, copies:[{k, n, fav}], selling, max}` : **tes exemplaires** de la carte dans le jeu par rareté d'exemplaire et brillance (`k` : « R », « R* » ; `n` exemplaires, `fav` dont favoris), lus dans sa base, et **tes enchères actives** sur leur plafond (`selling` / `max`, lus sur le site du jeu, `GET /api/marketplace/mine` ; `null` s'il ne les donne pas). Voir « Le marché », « Vendre ». `400` ; `401 {needs_link:true}` ; `429 {retry_after}` / `429 {limited:true}` comme le détail d'une enchère ; `409`, `502` |
| `POST /api/market/sell` | (clé principale ; 2026-10-23) `{id, k, base, minutes}` : `id` = la carte, `k` = rareté d'exemplaire à vendre, `base` = mise de départ (entier, 1 à 10 000 000 W), `minutes` = 10, 30, 60, 180, 360 ou 720 ; 2 Ko | `{auction:{a, k, base, minutes, end}, url}` : l'enchère **créée dans le jeu** (`end` : fin estimée), ajoutée aussitôt à « Tes ventes » de la dernière lecture du marché. `400` corps mal formé ; `401 needs_link` ; `409` plus d'exemplaire de cette rareté dans le jeu, refus du jeu (son message repris : plafond d'enchères actives…) ou `409 {verify:true}` le jeu demande une vérification anti-robot (la vente se fait alors dans le jeu) ; `429 {limited:true}` le jeu limite (pause de 10 min) ou `429 {retry_after}` plafond par minute ; `502` panne ou réponse inattendue (« regarde dans le jeu si elle a été créée ») |
| `POST /api/market/cancel` | (clé principale ; 2026-10-23) `{a}` : l'id de l'enchère ; 2 Ko | `{a, status:"cancelled"}` : ta vente **retirée du marché du jeu**, marquée terminée (`off`) dans « Tes ventes ». Seulement **tant que personne n'a misé** : `409 {has_bid:true}` sinon ; `409 {gone:true}` vente inconnue du jeu ou terminée ; `403` la vente d'un autre ; `400`, `401`, `429`, `502` comme ci-dessus |
| `POST /api/market/bid` | (clé principale ; 2026-10-26) `{a, amount}` : l'id de l'enchère et ta mise (entier, 1 à 10 000 000 W) ; 1 Ko | `{a, amount, cur, balance, url}` : ta **mise faite dans le jeu** (`cur` : enchère actuelle, `balance` : ton solde de wikibidous rendu par le jeu, rangé dans le compte, ou `null`) ; la dernière lecture du marché la prend aussitôt (« Tes mises », bonne affaire « tu mènes »). L'enchère est **relue d'abord** sur le site du jeu : `409 {min, cur}` mise trop basse (sans mise : au moins le prix de départ ; après une mise : au moins un W de plus que l'enchère actuelle) ; `409 {lead:true}` tu mènes déjà ; `409 {gone:true}` enchère finie ou inconnue du jeu ; `403` ta propre vente ; `409` refus du jeu (son message repris : solde…) ou `409 {verify:true}` vérification anti-robot ; `400`, `401 needs_link`, `429`, `502` (« regarde dans le jeu si elle est passée ») comme une mise en vente. Voir « Le marché », « Miser » |
| `GET /api/sync-log` | (clé principale) | `{entries:[{at, kind, result, message, data}]}` : les 50 dernières lectures au plus, de la plus récente à la plus ancienne, voir « Journal des synchros » |

**Message** (chat) : `{id, author, mine, text, created_at, refs?, members?, reply?, reactions?}` : `id` = numéro (croissant, jamais réutilisé), `author` = nom
**actuel** du classeur de l'auteur (`null` sans prénom), `mine` = c'est le tien, `text` = texte brut. Jamais l'id interne
du compte. `refs` (seulement s'il cite des collections) : le nom de chacune est en clair dans `text`, à la place
`{at, len}` (unités UTF-16) ; `{at, len, name, owner, mine, pid, id}` ou `{at, len, gone:true}`, voir « Chat »,
collections citées. `reply` (seulement s'il répond à un message) : `{id, author, mine, text}` (`text` = extrait) ou
`{id, gone:true}`, voir « Chat », réponses. `reactions` (seulement s'il en a) : `[Reaction]`, **Reaction** = `{emoji, n,
mine, who}` (`n` membres l'ont mise, dont toi si `mine` ; `who` = prénoms actuels des **autres**), chaque emoji dans
l'ordre où il a été mis la première fois, voir « Chat », réactions.

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
elle vient de la recherche par mots-clés (requête Wikidata ou catégorie de Wikipédia), `wm:<recherche>` quand elle a été
créée par « Depuis le jeu » (`POST /api/targets/save` avec `source: 'wm:<recherche>'`, titres = `wikipedia_title` du jeu, non
revérifiés sur Wikipédia). `rarity` (facultatif, C | PC | R | SR | UR | L, gardé seulement s'il est connu,
aussi par `targets/save` pour qu'une collection modifiée dans la page le garde) = rareté de la carte **dans le jeu**,
relevée par la recherche « Depuis le jeu » : l'interface l'affiche sans « ≈ » (case vide, fiche de la carte manquante, « Il t'en manque »)
au lieu de la rareté estimée d'après les vues de l'article, qui reste pour les éléments sans `rarity`. `sep` (facultatif,
2026-10-17) : `true` pour un **intercalaire**, un élément qui ouvre une section de la collection (« Sous-continent »
dans « Continents et Sous-continents ») ; c'est une carte comme les autres (elle se possède, compte dans la progression,
la valeur, les échanges). Gardé par `targets/save` seulement s'il vaut exactement `true`, absent sinon (`false`, `"true"`,
`1`… : ignorés) ; montré aux amis avec le titre et le qid (voir « Partage entre membres ») ; affichage : « Onglet
« Collections » », « Intercalaires et collections complètes ».

**Carte lue** (ce que `entryToCard` tire d'une ligne du jeu, rangé dans la lecture en attente avant la finalisation) : la Carte ci-dessus **sans
`tags`**, par exemplaire (regroupé par carte en SQL). `gtags` est toujours un tableau (**même vide**) : les tags du jeu de l'exemplaire ont été lus ;
absent (cartes rangées avant leur lecture) : ceux du classeur sont gardés tels quels, même par une lecture vérifiée. `gtagc` : objet nom → couleur,
seules les couleurs valides des noms gardés restent.

**Lecture et nouveautés** : une lecture complète **vérifiée** remplace la collection du classeur ; on n'écrit que les différences (cartes ajoutées,
retirées, modifiées). Une lecture **non vérifiée** ajoute les cartes absentes du classeur, ne retire rien, et ne reprend sur les cartes déjà là que
leurs **champs de carte du jeu** (voir « Lecture de la collection »). `new_ids` = cartes présentes après mais pas avant ; **vide à la toute
première lecture** ; remplacé seulement si la lecture apporte au moins une carte nouvelle. Les étiquettes d'une carte qui disparaît sont gardées
(elle peut revenir).

**Lecture incrémentale** (ne relire que ce qui a changé) : `users.cards_rev` = révision de la liste des cartes du
classeur, +1 par opération qui la change : lecture complète de la collection (« Rafraîchir » ou lecture automatique),
`tags/set`, `tags/bulk`, `tags/rename` sur des cartes présentes. Une opération qui ne change rien (même collection,
mêmes étiquettes) ne la fait pas avancer. Chaque carte garde la révision de son dernier
changement (`cards.rev`, données ou étiquettes) ; une carte retirée par un import laisse une trace (`cards_gone`, avec
la révision du retrait), effacée si elle revient. L'interface garde la `rev` de la première page de sa lecture
complète (lue **avant** les cartes : un changement fait pendant la lecture revient au delta suivant), surveille
`cards_rev` dans `GET /api/me` (au retour sur l'onglet, puis toutes les 60 s tant qu'il reste visible ; rien quand il
est caché ; l'onglet « Synchro » le relit en plus toutes les 4 s tant qu'un jeton de liaison vaut ; `GET /api/me` = une
requête SQL, une ligne lue : le compte, par l'index unique de sa clé ; une lecture (automatique) finie pendant que l'onglet est visible
s'annonce « Mis à jour depuis wiki-masters.com : 3 nouvelles cartes (1 053 cartes). »), et quand elle change appelle
`GET /api/cards?since=<rev gardée>` : `cards` = cartes
dont `rev > R` (au format Carte, avec leurs étiquettes : à remplacer ou ajouter), `gone` = cartes retirées depuis
(à enlever), puis elle garde la nouvelle `rev`. Réponse `{rev, delta:false}` (tout recharger) si `R > rev` (révision
inconnue : base recréée), si `R` est sous le plancher des retraits connus (`users.cards_gone_floor`) ou s'il y a plus
de 1 000 changements (cartes changées + retirées). Seuls les retraits des révisions les plus récentes sont gardés,
1 000 au plus : un plus ancien ne servirait qu'à un delta de plus de 1 000 changements, refusé de toute façon ; une
lecture qui retire plus de 1 000 cartes d'un coup n'en écrit donc aucun (une seule marque de débordement, effacée dans
la même transaction) : la révision avance et le plancher monte jusqu'à elle. Lecture par l'index `(user_id, rev)`,
1 001 lignes au plus : le coût ne dépend pas de la taille de la collection. Révision, plancher, `fetched_at`, `new_ids`
et changements sont lus dans la même requête ; les cartes arrivent en morceaux d'environ 1 Mo (une ligne D1 fait 2 Mo
au plus).

## Session du jeu

Depuis le 2026-10-22, le classeur lit la collection et le marché **directement dans la base du jeu** (Supabase, projet
`cyrxjeppjqsxxjayfrur` : Auth et PostgREST), avec **une session du jeu par membre gardée par le serveur** (`game.js`,
`session.js`, `link.js`). Écritures dans le jeu au clic du membre : la **proposition d'un échange** à un ami
(`POST /api/trades/create`, `trades.js`, voir « Proposer un échange »), et depuis le 2026-10-23 la **mise en vente** d'une de ses
cartes et l'**annulation** d'une de ses ventes sans mise (`POST /api/market/sell`, `POST /api/market/cancel`, `sell.js`, voir « Le
marché », « Vendre »), et depuis le 2026-10-26 une **mise** sur une enchère (`POST /api/market/bid`, `bid.js`, voir « Miser ») ; plus les
demandes d'ami et la liste de souhaits (voir « Règles du jeu »).

**Pourquoi une session dédiée, née en fenêtre privée.** Le jeu n'a qu'une connexion par e-mail et mot de passe, derrière un
captcha (relevé du 2026-10-22 : `GET /auth/v1/settings` ne donne que `external.email: true` ; `POST
/auth/v1/token?grant_type=password` sans jeton de captcha → `captcha_failed`) : le serveur ne peut pas ouvrir de session
lui-même, toute session naît dans une page du jeu. Supabase renouvelle ses sessions **par rotation** : un jeton de
renouvellement ne sert qu'une fois (au plus quelques secondes de tolérance), et le réutiliser ferme toute la session. Une
session partagée entre le navigateur du joueur et le serveur se casse donc des deux côtés (c'était la cause de l'ancien
rafraîchissement par cookie, avant le 2026-10-22, qui ne marchait qu'environ une heure). La session du classeur doit être
**une session que personne d'autre n'utilise** : celle d'une **fenêtre privée** où le membre se connecte au jeu, qu'il
ferme ensuite **sans se déconnecter** ; la fenêtre privée est obligatoire pour les trois chemins de liaison. Conséquence
assumée : une déconnexion du jeu, sur n'importe quel appareil, ferme aussi la session du classeur (la déconnexion de
Supabase est globale par défaut ; **non vérifié sur ce jeu**) : le membre est alors « à relier ».

**Trois chemins pour lier** (tous déposent une session que le serveur vérifie avant de la garder) :

| Chemin | Route | Où |
|---|---|---|
| Favori « Relier » (à privilégier : marche sur téléphone) | `POST /api/link` puis `POST /api/link/session` (voir « Liaison par favori « Relier » ») | Synchro › « Relier mon compte » |
| Cookie de session à coller | `POST /api/session {cookie}` | Synchro › « En secours » |
| Fichier HAR | `POST /api/session {har}` | Synchro › « En secours » |

**Le cookie de session** du jeu s'appelle `sb-cyrxjeppjqsxxjayfrur-auth-token`, découpé en `….0`, `….1`… au-delà d'une certaine
taille ; sa valeur est `base64-` suivi du JSON en base64url, ou (anciennes versions) le JSON encodé pour l'adresse.
`authFromCookie` recolle les morceaux dans l'ordre de leur indice, décode, et ne garde que `{access_token,
refresh_token, expires_at}` : le reste du cookie (dont `user`) n'est jamais lu, ni gardé. `cleanCookie` accepte un texte ASCII visible
de 16 384 caractères au plus, avec au moins une paire `nom=valeur` (un préfixe `Cookie:` est toléré). Pour un **HAR**
(`cookieFromHar`) : l'en-tête `Cookie` d'une requête vers `www.wiki-masters.com` ou `wiki-masters.com`, de préférence vers
`/api/my-collection`, puis vers un autre `/api/…`, puis n'importe quelle page, la plus récente à rang égal ; un HAR
« nettoyé » (sans cookies, réglage par défaut de Chrome et d'Edge) est refusé avec le moyen de l'exporter autrement
(`400`). L'interface n'envoie du HAR que l'adresse et l'en-tête `Cookie` des requêtes vers le jeu (20 au plus) ; le reste ne
quitte pas le navigateur.

**Vérification** (`verifySession`, avant toute écriture) : le serveur demande au jeu **à qui est la session** :
`GET auth/v1/user` → `id` (jamais l'identifiant lu dans le cookie, que n'importe qui peut écrire), puis
`GET rest/v1/profiles?select=username&id=eq.<id>` → le pseudo (facultatif : sa lecture peut échouer sans empêcher la
liaison). Un jeton qui expire dans moins de 120 s est renouvelé d'abord. Refus du jeu (`401`/`403`) : `401` « Cette session
du jeu n'est pas valable (expirée, ou copiée hors d'une fenêtre privée) ». **Unicité** : un compte du jeu (`game_uid`, index
unique `users_by_game_uid`) ne se lie qu'à un classeur ; déjà lié à un autre : `409` « Ce compte du jeu est déjà relié à un
autre classeur. ». Le pseudo du jeu remplit `game_pseudo` **s'il est vide** (un pseudo déjà donné n'est jamais écrasé). La
liaison remet `sync_fails` à 0, vide `game_session_lost`, efface la lecture en attente de ce membre, incrémente
`game_session_v` et ajoute une ligne `kind:'session'` au journal (`via` `clic` pour `POST /api/session`, `relier` pour le
favori « Relier »). Elle ne lance pas de lecture : l'interface lance « Rafraîchir » dès qu'elle voit la liaison (`GET /api/me` relu
toutes les 4 s tant que le jeton vaut), sinon la lecture automatique suivante (au plus 10 min) s'en charge.

**Stockage.** `users.game_session_enc` = `{access_token, refresh_token, expires_at, uid}` en JSON, chiffré AES-GCM avec une
clé dérivée de `COOKIE_SECRET` (HKDF-SHA-256, sel `classeur`, info `cookie-wikimasters-v1`), IV de 12 octets tiré à chaque
écriture, **donnée associée `game-session:<id du compte>`** (le chiffré ne se lit ni pour un autre compte ni pour un autre
usage). Jamais renvoyée au navigateur : `GET /api/me` n'en donne que l'état (`session`). Autres colonnes : `game_uid`,
`game_session_v` (version), `game_session_at` (liaison ou dernier renouvellement), `game_session_lost`. Changer
`COOKIE_SECRET` rend toutes les sessions illisibles : les membres sont « à relier » (`401 needs_link`, « Ta session du jeu
n'est plus lisible (secret du serveur changé) »). Sans `COOKIE_SECRET`, la liaison est refusée (`500`) et l'interface la
désactive (`GET /api/health` : `cookie_secret:false`).

**Ce que le serveur envoie au jeu.** `GET`/`POST` vers `…/auth/v1/…` et `…/rest/v1/…` seulement, avec `apikey: <clé publique
« anon » du jeu>` (livrée dans le code de sa page, rôle `anon` : seule, elle n'ouvre rien) et `Authorization: Bearer <jeton
d'accès du membre>`, `Accept: application/json`. **Aucun en-tête n'imite un navigateur** (`User-Agent` de la plateforme
Cloudflare : le jeu peut donc reconnaître un client automatique, c'est un choix assumé). Une erreur réseau ou `5xx` est
retentée deux fois (1 s, puis 2 s) ; ensuite `502` « La base du jeu ne répond pas ». **Seule exception** : la proposition
d'échange passe par les routes du site du jeu (`https://www.wiki-masters.com/api/…`), qui n'acceptent que le cookie de
session de ses pages (voir « Proposer un échange »).

**Renouvellement** (`renewSession`). Le jeton d'accès est renouvelé **d'avance** quand il expire dans moins de 120 s
(`freshAuth`, avant chaque lecture, collection ou marché, cron compris ; une lecture de recherche ne le fait qu'au premier
`401`, qui provoque **un** renouvellement puis **un seul** nouvel essai) : `POST auth/v1/token?grant_type=refresh_token`
`{refresh_token}`. Ainsi, tant que le cron passe (toutes les 10 min), le jeton de renouvellement ne vieillit pas. **Sous
verrou** : `game_session_v` est comparé et incrémenté dans la même requête (`UPDATE … WHERE game_session_v = ?`) ; la
session renouvelée est chiffrée et écrite par cette même requête. Qui perd la course relit la ligne et **prend la session la
plus récente** (`takeLatest`). Un **bail par membre** (`users.sync_lock`, instant ISO jusqu'auquel une lecture tient la
session ; `LEASE_MS` = 10 min ; pris par `UPDATE … WHERE sync_lock IS NULL OR sync_lock < maintenant RETURNING`) empêche deux
lectures en même temps avec la même session (collection, marché, clic ou cron) : la seconde est refusée en `409` (clic) ou
sautée sans échec (cron). C'est le bail qui rend la course de renouvellement rare ; la version n'est que la ceinture.
Résiduel : si un bail expire au milieu d'une lecture longue, deux renouvellements du même jeton peuvent se suivre ; dans la
fenêtre de réutilisation de Supabase la réponse est la même session, au-delà la session est révoquée.

**Révocation.** Le jeu refuse le renouvellement (`400`/`403`) : la session est morte (déconnexion du jeu, ou jeton réutilisé
ailleurs). Le serveur pose `game_session_lost = 'révoquée'` (et incrémente la version) **une seule fois** (compare-et-échange),
écrit une ligne d'échec au journal (`kind:'session'`) et répond `401 {needs_link:true}` ; la session chiffrée reste en place
mais n'est plus utilisée : le membre sort des lectures automatiques et l'interface affiche « À relier : révoquée ». Lier à
nouveau efface cet état. Réponse `429` ou `automation_limit` du jeu au renouvellement : `429 {limited:true}`, la session reste
valable. Toute autre réponse : `502` (« le jeu a peut-être changé »).

**Oubli** : `DELETE /api/session` efface la session chiffrée, `game_uid`, `game_session_at`, `game_session_lost`, le bail et
`sync_fails`, incrémente la version et vide la lecture en attente. **Le classeur n'appelle pas la déconnexion du jeu** : le
compte du jeu n'est pas touché (un `scope=local` existe chez GoTrue ; à ajouter plus tard si l'on veut que « Oublier la
liaison » révoque aussi la session côté jeu). Les cartes, étiquettes et collections restent.

**Membres éligibles aux lectures automatiques** (`eligibleMembers`) : session présente (`game_session_enc`), pas perdue
(`game_session_lost` vide), « Synchro automatique » active (`auto_sync = 1`) et moins de 3 échecs d'affilée (`sync_fails <
FAILS_MAX`). Un membre qui n'est plus éligible n'est plus lu sans clic jusqu'à ce qu'il se relie, réactive la case ou réussisse un
« Rafraîchir ». **Un membre en pause ou sans session peut perdre sa session** : la durée d'inactivité au bout de laquelle le jeu
ferme un jeton de renouvellement n'est pas connue.

## Liaison par favori « Relier »

Le favori « Relier » est le seul favori du classeur : **court** (≈ 250 caractères, donc utilisable sur téléphone), il ne sert qu'à **déposer**
la session d'une fenêtre privée. Code : `site/public/assets/relier.js`, servi par `GET /api/favori.js` ; routes `POST /api/link` et
`POST /api/link/session` (`link.js`).

1. **Jeton de liaison** : « Relier mon compte » appelle `POST /api/link` (clé principale) : jeton aléatoire de 24 octets, **valable
   30 minutes et une seule fois** ; le serveur n'en garde que le SHA-256 (`users.link_hash`) et l'échéance (`link_until`). Un
   nouveau jeton remplace l'ancien. Il **n'ouvre jamais le classeur** : il ne permet que de déposer une session que le jeu doit
   reconnaître. Un favori « Relier » qui fuit ne sert donc plus à rien après 30 minutes (ou dès son premier usage).
2. **Favori « Relier »** : l'interface construit `javascript:(function(){window.__classeurLien={t:"<jeton>"};var s=document.createElement("script");
   s.src="<classeur>/api/favori.js";s.async=true;document.documentElement.appendChild(s)})();`. Le jeton va dans
   `window.__classeurLien` et **jamais dans l'adresse** du script (journaux). Le membre clique le favori « Relier » sur
   `wiki-masters.com`, **dans une fenêtre privée où il est connecté** (son adresse se copie aussi dans la barre d'adresse d'un téléphone).
3. **`GET /api/favori.js`** (sans clé) rend `relier.js` avec l'origine du classeur à la place de `__SITE__` (`Cache-Control:
   no-store` : chaque clic prend la dernière version ; `503` sans la liaison `ASSETS`, `404` si le fichier manque).
4. **`relier.js`**, exécuté dans la page du jeu : lit et efface `window.__classeurLien`, vérifie le nom d'hôte
   (`wiki-masters.com` ou `www.wiki-masters.com`), cherche un cookie `sb-…-auth-token(.N)` dans `document.cookie`, puis fait
   `POST <classeur>/api/link/session` `{token, cookie}` (`credentials: omit`, `mode: cors`). Il n'écrit rien dans le jeu et ne lit
   rien d'autre ; il affiche le résultat dans un encart (« Compte du jeu relié (pseudo). Tu peux fermer cette fenêtre privée sans te
   déconnecter. »).
5. **`POST /api/link/session`** : **sans clé**, seule route qui accepte les origines du jeu (voir « CORS »), corps de 20 Ko au plus.
   Le jeton, de forme `[A-Za-z0-9_-]{20,64}`, est comparé par son SHA-256 et **consommé avant la vérification auprès du
   jeu**, même si la liaison échoue ensuite (un jeton ne sert qu'une fois) ; **sauf** si le cookie est illisible (`400`) : le
   jeton n'est alors pas consommé. Jeton inconnu, périmé ou déjà utilisé : `401` « Lien de liaison périmé ou déjà utilisé :
   refais « Relier mon compte »… ». Ensuite, comme `POST /api/session` : `401` session non valable, `409` compte du jeu déjà
   lié (le jeton est consommé), `429`, `502`. Réponse : `{ok:true, pseudo}`.

**Risque** : la page du jeu doit continuer d'accepter un `<script src>` et un `fetch` vers le classeur (c'est le cas aujourd'hui) ;
sinon il reste le cookie à coller et le HAR.

## Lecture de la collection

Le serveur lit la collection du membre dans la base du jeu avec sa session reliée (`refresh.js`, `import.js`). Il y a **deux
lectures**, toutes deux de `GET rest/v1/user_cards` filtré sur le `uid` du jeu de la session (`user_id=eq.<uid>`), triées
`order=obtained_at.desc,id.asc` :

- **Vérification légère** (`checkCollection`) : `user_cards?select=obtained_at&…&limit=1` avec `Prefer: count=exact` : **une
  requête** donne le **compte exact des exemplaires** (en-tête `content-range`) et l'`obtained_at` du plus récent.
- **Lecture complète** (`readCollection`) : pages de **1 000 exemplaires** (`limit=1000&offset=<1000 × page>`, 250 ms entre deux pages,
  50 pages au plus : au-delà, `400` « Collection trop grande : 50 000 exemplaires au plus »), avec `select=` :
  `id,card_id,user_id,count,starred,is_shiny,obtained_at,snapshot_rarity,snapshot_atk,snapshot_def,
  card:cards(id,wikipedia_title,wikipedia_url,image_url,hide_image,rarity,atk,def,q_score,pageviews,category,lang),
  tags:user_card_tags(tag:tags(id,name,color))` (`ENTRY_FIELDS`) : la carte et les tags du jeu de l'exemplaire arrivent dans la même
  réponse. La page 0 demande aussi `count=exact` : c'est le compte **avant**. Une ligne de la lecture (`toEntry`) est ramenée à la
  forme de l'ancienne entrée `my-collection` (`snapshot_rarity`, `snapshot_atk`, `snapshot_def` non nuls remplacent rareté
  — si elle est connue —, attaque et défense de la carte ; `user_id` jamais gardé) puis traitée par `entryToCard` /
  `badCard` (cards.js) : une entrée invalide (sans titre, rareté inconnue, champs trop longs) est ignorée et comptée dans
  `skipped`, mais reste comptée comme carte distincte quand elle a un identifiant de carte.
- Après la dernière page, une **vérification légère de plus** donne le compte **après** et l'`obtained_at` le plus récent
  d'après.
- Puis le **solde de wikibidous** (2026-10-23, `readBalance`) : `POST rest/v1/rpc/get_my_profile` `{}` (la fonction que la page du jeu
  appelle pour son propre profil, relevée dans les HAR du 2026-10-15 et du 2026-10-23 ; une lecture, malgré le `POST`) →
  `wikibidous_balance`, rangé dans `users.wikibidous` avec l'heure (`wikibidous_at`) dans le lot final de la lecture. Facultatif :
  un échec (autre qu'une limite du jeu, `429`, qui remonte) ou un solde illisible laisse l'ancien solde, sans faire échouer la
  lecture. Le solde bouge sans la collection (ventes, achats, échanges) : la vérification du cron le relit aussi (« Lectures
  automatiques »). Rendu par `GET /api/me` et, aux membres avec qui il partage ses cartes, par `GET /api/members`.

**Rangement.** Chaque page de 1 000 exemplaires est rangée en **deux lignes de 500** dans `refresh_staging` (`page` 2p et 2p + 1 ;
une ligne D1 fait 2 Mo au plus, et 500 cartes tiennent même dans le pire cas de `validCard`), clé `(user_id, page)` : une seule lecture
en attente par membre, effacée au début de chaque lecture, à sa fin, et au bout d'une heure (`purgeStaging`). La
finalisation (`finalizeImport`, `collectionCte`) se fait **en SQL dans D1** (`json_each`, `INSERT … SELECT`) à partir de cette
table : JavaScript ne touche jamais toute la collection, la mémoire reste bornée.

**Vérification par les comptes exacts** (`finalizeImport`) :
- `complete` = exemplaires lus (dédoublonnés par `id` d'exemplaire, invalides compris) **égaux** au compte exact lu **avant**
  (`null` si le compte n'a pas pu être lu) ;
- `moved` = compte **ou** `obtained_at` du plus récent **différents après** (la collection a bougé pendant la lecture) ;
- **vérifiée** (`verified`) = `complete` et pas `moved`.

Lecture **vérifiée** : la collection du classeur **est remplacée** par la lecture, retraits compris (`removed` ; les étiquettes des
cartes retirées restent). Lecture **non vérifiée** : les cartes absentes du classeur sont **ajoutées** (`fresh`), **aucune carte n'est
retirée** (`kept` = cartes du classeur non vues), et une carte déjà là ne reprend que ses **champs de carte du jeu** (`title`,
`atk`, `def`, `quality`, `pageviews`, `category`, `image`, `url` : les mêmes dans tous ses exemplaires), seulement s'ils ont changé ;
ses **tags du jeu** lus sont réunis avec ceux déjà gardés (jamais retirés, couleurs de la lecture d'abord), mais jamais `count`,
`variants`, `rarity`, `shiny`, `starred` ni `obtained_at`, qui dépendent des exemplaires lus. **Une lecture incomplète n'efface
donc jamais de cartes.** Une carte possédée en plusieurs raretés garde la plus haute (C < PC < R < SR < UR < L) ; ses exemplaires
par rareté d'exemplaire et brillance (`variants`) sont additionnés, et gardés seulement s'ils les comptent tous ; ses tags du jeu
sont réunis sur tous ses exemplaires. Collection vide dans le jeu (compte 0, ou page 0 vide) : rien n'est changé, une ligne
`warn` « Collection vide dans le jeu : rien n'a été changé. » est écrite, la réponse est `{count:0, empty:true}` ; plus de 20 000
cartes : `400`.

**État de la lecture** : `users.sync_state` (JSON, réécrit par chaque finalisation ; `$.count` aussi par `GET /api/me` pour un classeur
d'avant ce compteur) :

| Champ | Sens |
|---|---|
| `count` | cartes du classeur (lu par `GET /api/me`, sans compter les lignes) |
| `rows` | compte exact des exemplaires dans le jeu à la dernière lecture (`null` : inconnu) |
| `last_at` | `obtained_at` du plus récent exemplaire |
| `full_at` | date de la dernière lecture **vérifiée** complète |
| `checked_at` | date de la dernière vérification (lecture complète, ou vérification légère du cron) |
| `read_at` | début de la lecture vérifiée dont le classeur vient (`null` : inconnu) : une lecture **commencée avant** n'est plus appliquée (`superseded:true`, rien d'écrit) ; une lecture non vérifiée ne le fait pas avancer |
| `tok` | jeton tiré à chaque écriture : les cartes ne sont écrites que si l'état vient d'être remplacé par celui-ci (comparer-échanger, dans la même transaction) |
| `complete` | résultat du contrôle de la dernière lecture (`true`, `false`, ou `null` sans compte exact) |

**Pastilles « nouvelles cartes »** : `users.new_ids` = cartes présentes après mais pas avant ; vide à la toute première lecture ;
**remplacé seulement si la lecture apporte au moins une carte nouvelle** (une relecture sans nouveauté, toutes les 6 h par le
cron, ne fait pas disparaître des pastilles que le membre n'a pas encore vues). La finalisation recalcule aussi la valeur du jour
du classeur (`valueAfterCards`, au plus une fois par heure, seulement si des cotes existent).

**« Rafraîchir » au clic** (`POST /api/refresh`, `refresh`) :
- **une fois par minute au plus**, tous appareils confondus : le créneau (`users.sync_click_at`) est pris par un
  `UPDATE … RETURNING` avant tout le reste ; trop tôt : `429 {error, retry_after}` (secondes, 60 au plus) ; le créneau est donc
  pris même si la lecture échoue ensuite (`401`, `502`…) ;
- **bail** (`sync_lock`) : une lecture est déjà en cours (cron, autre appareil) : `409` « Une lecture de ta collection est déjà en
  cours… » ;
- `401 {needs_link:true}` : pas de compte relié ou session perdue ; `429 {limited:true}` : le jeu limite les lectures
  automatiques (réponse `429`, ou `403` du jeu avec `code: "automation_limit"`) ; `502` : base du jeu injoignable, ou
  réponse inattendue (« le jeu a peut-être changé ») ;
- **un succès au clic remet `sync_fails` à 0** (dans la transaction de la finalisation) : c'est ce qui sort un membre de la pause ;
- réponse : `{count, fresh, new_ids, complete, skipped, removed, kept}` (`complete` : `false` si non vérifiée ; `moved:true` en
  plus si la collection a bougé ; `superseded:true` si une lecture commencée après est déjà appliquée : rien d'écrit) ; ou
  `{count:0, empty:true}`.

**Ce qui est noté au journal** : chaque fin de lecture appliquée, et chaque échec, **sauf les refus d'avant la lecture** (`429
retry_after`, `409` bail pris), qui ne sont pas notés (voir « Journal des synchros »).

**Format de la base du jeu : non vérifié par ce Worker.** Les noms des tables et des colonnes (`user_cards`, `cards`,
`user_card_tags`, `tags`, `profiles`, `auctions`, `auction_bids`) viennent du code de l'ancien favori (retiré le 2026-10-22) et du projet de référence (Python),
qui marchent ; le faux jeu de `dev/supabase.mjs` ne prouve rien sur la vraie base. Première passe réelle à faire avant d'annoncer :
`node dev/cron.mjs collection` contre la vraie base avec un compte relié. Si le jeu a un autre format, la lecture s'arrête avec « le jeu a peut-être changé » (journal et page).

## Journal des synchros

`sync_log` (`functions/_lib/synclog.js`) : une ligne par **lecture de la collection** (réussie ou non) et par **événement de la session**
du jeu (reliée, révoquée), pour comprendre après coup ce qui s'est passé. Écrit par le serveur seul, lu par `GET /api/sync-log`
(clé principale) : `{entries:[{at, kind, result, message, data}]}`, les 50 dernières, de la plus récente à la plus ancienne.

- **`kind`** : `full` (lecture complète de la collection) | `session` (compte du jeu relié, ou session révoquée). `quick` (l'ancienne
  synchro rapide) n'existe plus que dans les lignes d'avant le 2026-10-22, que l'interface sait encore lire.
- **`result`** : `ok` | `warn` (lecture non vérifiée : rien retiré ; collection vide) | `error`.
- **`data.via`** : `clic` (« Rafraîchir », ou liaison par `POST /api/session`) | `cron` (lecture automatique) | `relier` (favori « Relier »).
  Une ligne d'avant le 2026-10-22 peut avoir un autre `via` (`cookie`, `relie`, `script`, rien) : l'interface l'affiche « Synchro ».
- **`message`** : le texte lisible que voit le membre (« Lecture complète : 1 043 cartes, 2 nouvelles, 1 retirée. », « Lecture
  incomplète : 3 650 exemplaires lus, le jeu en compte 3 702 : … aucune carte retirée (52 cartes non vues, gardées). Rafraîchis dans un
  moment. », le message d'erreur rendu…), 300 caractères au plus ; ce qui ressemble à un secret (jeton JWT, `#cle=…`, suite
  base64 de 32 caractères ou plus) est masqué.
- **`data`** : `via`, nombres (`count`, `fresh`, `removed`, `kept`, `updated` — cartes déjà là mises à jour par une lecture non
  vérifiée —, `read`, `exact` — le compte du jeu avant —, `invalid`, `skipped`), `complete`, `moved`, `superseded`, `ms` (durée),
  `status` (erreur HTTP rendue).
- **Ce qui est noté** : toute lecture complète appliquée, y compris « rien de nouveau » ; toute erreur d'une lecture (au clic ou
  automatique) ; la liaison ; la révocation. **Ne sont pas notés** : une **vérification légère sans changement** (le cron met
  seulement `checked_at` à jour) ; les refus d'avant la lecture au clic (`429`, `409`) ; une passe du **marché** (sa raison vit dans
  `market.attempt.why`, voir « Le marché »).
- **Borné** : une ligne identique à la précédente (même `kind`, `result`, `message`, `via` : « Lecture complète : 1 043 cartes, aucune
  nouvelle, aucune retirée. » toutes les 6 h, même échec répété) **ne fait que mettre à jour son heure** (`data.repeat`, `data.first`) ;
  les 50 plus récentes par classeur, 30 jours au plus (élagage à chaque écriture). `users.last_sync` garde le résumé de la dernière ligne
  (`{at, kind, via, result, message}`), rendu par `GET /api/me`. Effacé avec le classeur. Le journal ne fait **jamais** échouer une
  lecture : une écriture ratée est seulement notée dans les journaux du Worker.
- **Interface** (onglet « Synchro », panneau « Dernières synchros ») : les 20 plus récentes, chacune avec son résultat (« réussie »,
  « incomplète », « échec »), son chemin et son type (« Clic · lecture complète », « Automatique · lecture complète », « Liaison ·
  compte »), son heure (« aujourd'hui à 14:32 », « 3 fois depuis… ») et son message ; lu à l'ouverture de l'onglet, après un
  rafraîchissement, quand `last_sync` change et sur « Actualiser ». Sous le résumé des cartes, tant que rien d'autre n'y est affiché :
  « Dernière synchro en échec (… ) : <message> » (ou « incomplète »), avec « Dernières synchros » ; un nouvel échec **automatique**
  (relu par `GET /api/me`) est annoncé une fois par message (« La dernière synchro a échoué : … »).

## Lectures automatiques

Les lectures sans geste du membre sont lancées par les **déclencheurs planifiés (Cron Triggers)** de Cloudflare, déclarés dans
`site/wrangler.jsonc` (`triggers.crons`) et dans `wrangler.jsonc` à la racine (les deux fichiers restent identiques), servis par
`scheduled()` de `site/worker.js` → `runCron` (`functions/_lib/cron.js`). **Un projet Pages ne les a pas** (`worker.js` y est ignoré).
Elles sont décrites honnêtement, avec leurs risques, dans « Règles du jeu ».

| Déclencheur | Expression | Ce qu'il fait |
|---|---|---|
| Collection | `*/10 * * * *` (`COLLECTION_CRON`) | vérifie la collection de chaque membre éligible, la relit si besoin |
| Marché | `5-59/20 * * * *` (`MARKET_CRON`) | une passe de marché par membre éligible (décalé de 5 min : les deux ne tombent pas à la même minute) |

Constantes (module `cron.js` et `refresh.js`, une constante par rythme) : `FULL_EVERY_MS` 6 h, `MARKET_EVERY_MS` 20 min,
`CRON_BUDGET_MS` 10 min, `LEASE_MS` 10 min, `CLICK_GAP_MS` 60 s, `FAILS_MAX` 3, `SKIP_AFTER_LIMIT_MS` 15 min (collection) et 25 min
(marché), `SUPA_MAX` 30 et `SUPA_GAP_MS` 1 s pour le marché.

**Cadre commun** (`runCron`) : rien si `env.DB` manque ou si `SYNC_PAUSED` est posé. Sinon `ensureSchema`, puis **un bail par déclencheur**
(`cron_state.running_until`, posé pour `LEASE_MS + CRON_BUDGET_MS` = 20 min par un `UPDATE … RETURNING` : deux invocations ne se chevauchent
pas) et un **saut** (`cron_state.skip_until`) : passe précédente encore en cours ou saut en cours = rien n'est fait (`last_at` ne bouge
pas). La passe finie, `last_at` et `last_result` (texte court : « 12 membres vérifiés, 1 relu, 0 échec », « limite du jeu (…) », « erreur : … »)
sont notés dans `cron_state` : c'est ce que montre `GET /api/health` (`cron.collection`, `cron.market`). Un membre n'est lu que s'il est
**éligible** (voir « Session du jeu ») ; la passe s'arrête quand elle a duré `CRON_BUDGET_MS` (les membres restants passent au tour suivant).

**Passe « collection »** : membres triés par **vérification la plus ancienne d'abord** (`sync_state.checked_at`, jamais vérifiés en
premier). Pour chacun, sous son bail (un membre dont la session est déjà utilisée est **sauté sans échec**) : session renouvelée d'avance si
besoin, puis **une vérification légère** (1 requête). Relecture complète **seulement si** le compte exact ou l'`obtained_at` du plus
récent ont changé depuis la dernière lecture, **ou** qu'il n'y a pas encore de lecture vérifiée (`full_at` vide), **ou** que la dernière
vérifiée a plus de 6 h. Sinon seuls `checked_at` et le solde de wikibidous (une requête de plus, 250 ms après, voir « Lecture de la collection ») sont mis à jour : **rien n'est écrit au journal**. (Un membre dont la collection est vide
dans le jeu, ou dont les lectures ne sont jamais vérifiées, est donc relu à chaque passage : une ligne d'avertissement regroupée au journal.)
Succès : `sync_fails` remis à 0.

**Passe « marché »** : membres triés par **début de leur dernière passe complète** (`market.attempt.start`, ou `attempt.full` après une passe
légère au clic ; les plus anciennes — et jamais lues — d'abord) ; **sauté** si une passe complète de ce membre a commencé il y a moins de 20 min
(**un clic ne compte pas** depuis le 2026-10-23 : il ne relit pas les cotes du plan), si une autre lecture tient sa session
(`409`), ou si son **quota du jour des cotes** est atteint (sauté **sans échec**, la raison est dans `attempt.why`). Une passe fait au plus
30 requêtes à une par seconde : environ 30 s par membre, donc une vingtaine de membres au plus tiennent dans `CRON_BUDGET_MS` ; l'ordre fait
tourner les autres. **Rien n'est écrit au `sync_log` pour le marché.** Succès : `sync_fails` remis à 0 ; échec (hors limite du jeu, quota, bail pris, session à relier) : un échec de plus.

**Garde-fous.**
- **Limite du jeu** (`429`, ou `automation_limit`) : la passe **s'arrête aussitôt** (aucun autre membre n'est lu), `skip_until` saute les
  passes suivantes — collection : 15 min (la passe qui tombe 10 min après est sautée, la suivante reprend) ; marché : 25 min (la passe à
  +20 min est sautée, la reprise est à +40 min) — et la limite n'est **pas comptée comme un échec du membre**. `last_result` :
  « limite du jeu (…) ». Pour la collection, la limite est notée au journal du membre qui l'a vue.
- **Trois échecs d'affilée** (`sync_fails` ≥ 3, collection **ou** marché) : le membre est **en pause** ; l'interface le dit (« Synchro automatique
  en pause après N échecs d'affilée ») et le journal ajoute « Lectures automatiques en pause après 3 échecs ». Un « Rafraîchir »
  **réussi**, ou une nouvelle liaison, le sort de la pause. Un membre « à relier » (`needs_link`) n'est pas compté comme un échec : il n'est
  simplement plus éligible.
- **« Synchro automatique »** : case de l'onglet « Synchro » (`PATCH /api/me {auto_sync}`, cochée par défaut) : décochée, rien n'est lu sans
  clic pour ce membre (collection comme marché).
- **`SYNC_PAUSED`** (variable, `1`, `true`, `oui` ou `yes`, sans tenir compte de la casse) : **tous** les déclencheurs sont suspendus ;
  « Rafraîchir » et « Actualiser le marché » fonctionnent toujours. `GET /api/health` : `sync_paused:true`. À poser dans le tableau
  de bord Cloudflare (`keep_vars`), sans redéployer.
- **Un seul membre à la fois** (un par déclencheur), une requête par seconde pour le marché, jamais d'écriture dans le jeu.

**Coût et limites de la plateforme.** Les Cron Triggers sont compris dans l'abonnement payant de Workers (le classeur y est depuis le
2026-10-17) ; Cloudflare documente 30 s de CPU par invocation pour une expression de moins d'une heure, les attentes réseau ne comptant
pas. Le code ne mesure ni le CPU ni le nombre de sous-requêtes d'une invocation (la limite par invocation du plan payant est de 1 000) :
**à surveiller dans les journaux du Worker** quand le nombre de membres augmente (jusqu'à ~4 500 requêtes par heure vers le jeu pour 50
membres reliés, voir « Règles du jeu »).

**En local** : `node dev/cron.mjs collection|market` lance un déclencheur à la main contre la base locale (affiche le résultat de
`cron_state`) ; `node dev/server.mjs --cron` les fait tourner toutes les 10 et 20 minutes.

## Onglet « Synchro » (interface)

Onglet `maj` (adresse `#/maj`, libellé « Synchro », dans la feuille « Plus » sur téléphone). Un classeur **sans carte** s'ouvre dessus
(« Ton classeur est vide : relie ton compte du jeu dans « Synchro ». »). Trois panneaux, tous tirés de `session` (`GET /api/me`) :

1. **« Ton compte du jeu »** : l'état (« Compte du jeu relié (pseudo) » avec « dernière vérification il y a 3 min · dernière lecture complète il y a 2 h »
   ou « pas encore de lecture complète vérifiée » ; « À relier : révoquée » avec la raison pour laquelle le jeu a fermé la session, et le rappel qu'une
   déconnexion du jeu, sur n'importe quel appareil, la ferme aussi ; « Aucun compte du jeu relié »). Relié : **« Rafraîchir maintenant »**
   (`POST /api/refresh`, son message à côté : « 1 053 cartes · 2 nouvelles · aucune retirée » ; lecture non vérifiée : « … aucune carte retirée (52 non vues,
   gardées), rafraîchis dans un moment » ; `429` : « … (encore 40 s) »), la case **« Synchro automatique »** (`PATCH /api/me {auto_sync}`) avec sa
   phrase (« Toutes les 10 minutes, le classeur vérifie ta collection … ; les cotes toutes les 20 minutes. Décoche pour ne lire qu'au clic. »), l'avis
   « Synchro automatique en pause après N échecs d'affilée : « Rafraîchir maintenant » la relance » quand `paused`, et **« Oublier la liaison »**
   (`DELETE /api/session`, sans te déconnecter du jeu).
2. **« Relier mon compte du jeu »** (« Relier à nouveau » si déjà relié) : le bouton « Relier mon compte » (`POST /api/link`) donne le favori **« Relier au
   classeur »** (à glisser dans la barre de favoris, ou son adresse à copier, pour un téléphone) et trois étapes : fenêtre privée connectée au jeu, clic
   sur le favori, fermer la fenêtre privée sans se déconnecter. Le favori « Relier » vaut 30 minutes (« Ce favori a expiré : refais-en un », bouton « Refaire le
   favori ») ; tant qu'il vaut, la page relit `GET /api/me` **toutes les 4 s** (onglet visible) : dès que `session.at` change, « Compte du jeu relié :
   lecture de ta collection… » et un « Rafraîchir » part tout seul. **En secours** (repliable) : coller l'en-tête `Cookie` d'une requête vers le jeu, ou
   déposer un export HAR (`POST /api/session`), toujours depuis une fenêtre privée ; désactivé si le serveur n'a pas `COOKIE_SECRET`. Dans l'app installée,
   une note explique qu'il faut une fenêtre privée du navigateur.
3. **« Dernières synchros »** : le journal (voir « Journal des synchros »).

Ailleurs : le bandeau a le bouton « Rafraîchir la collection » (« Relier mon compte » sans compte relié : il ouvre « Synchro »). « Actualiser le marché » ouvre aussi
« Synchro » quand le compte n'est pas relié, et « Depuis le jeu » y envoie par son bouton « Relier mon compte » ; un `401 needs_link` relit `GET /api/me`.

## CORS et limites

**CORS** : seul `POST /api/link/session` (et son `OPTIONS`, `204`), la route du favori « Relier », accepte les origines `https://www.wiki-masters.com`
et `https://wiki-masters.com` (`Access-Control-Allow-Methods: POST, OPTIONS`, `Access-Control-Allow-Headers: content-type`,
`Access-Control-Max-Age: 86400`, `Vary: Origin`). Le favori « Relier » n'envoie pas de clé ni de cookie du classeur (`credentials: omit`). Le reste est même origine.

**Limites et quotas** (D1 : 500 Mo, 100 000 lignes écrites par jour en gratuit ; le classeur est sur l'abonnement payant des Workers depuis le 2026-10-17,
50 millions de lignes écrites par mois comprises) : `MAX_USERS` comptes (variable, 50 par défaut) ; 20 000 cartes et 50 000 exemplaires par lecture ;
étiquette = texte nettoyé, 60 caractères au plus (2 niveaux au plus dans le nom : « Catégorie/Sous-catégorie », catégories larges : Pays,
Métiers, Lieux, Culture et œuvres, Sciences et nature, Histoire et événements, Organisations, Autres), 30 par carte, 50 000 par compte, 5 000
couples carte×étiquette par appel `tags/bulk` ; collections à compléter : 50 par compte, sans nombre d'éléments maximal, 1,7 Mo chacune (600 Ko
par envoi, en morceaux au-delà), 5 Mo au total ; lecture de la collection : une page de 1 000 exemplaires rangée en deux lignes de 500, une
seule lecture en attente par membre ; journal des synchros : 50 lignes et 30 jours par classeur ; corps JSON de 5 Mo au plus (4 Ko pour
`/api/account`, 8 Ko pour le chat, 20 Ko pour `/api/link/session`). Entrées du jeu invalides (sans titre, rareté inconnue, champs trop longs ; une
catégorie du jeu de plus de 500 caractères n'en fait pas une : elle est coupée à 500 et la carte est rangée) : ignorées, comptées dans `skipped`, et comptées
comme cartes distinctes (quand elles ont un identifiant de carte) pour dire si une lecture est complète. Quota ou base pleine : `503` avec un message
lisible. Marché : 15 000 cotes par classeur et par jour, 150 000 pour tout le site (`429`), voir « Le marché ».

**Limite de calcul des requêtes** : l'abonnement payant des Workers a levé la limite de 10 ms de CPU des Workers gratuits ; la règle est gardée,
parce qu'elle ne coûte rien et garde les requêtes courtes : aucune requête ne traite plus de ~500 cartes en JavaScript. La finalisation d'une lecture
se fait **en SQL dans D1** (ajouts, retraits, modifications, `new_ids`), et le temps SQL ne compte pas. `dev/api.test.mjs` mesure le JavaScript de chaque chemin.

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
  préférences, la clé, la session du jeu, ni l'id interne du compte ; les collections à
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
  quand même pour les autres). **Jamais une carte qui casserait une collection de X** (2026-10-26, demande de
  l'utilisateur) : une carte que X n'a qu'en un exemplaire et qui remplit une case d'une de ses collections n'est pas
  proposée (en double, elle l'est : il en garde une) ; pour un ami qui ne montre pas ses collections, on ne peut pas le
  savoir : ses cartes restent proposées. Vaut aussi pour « Ce qui pourrait intéresser tes amis » et pour la fenêtre
  « Proposer un échange », qui reprennent ce calcul. Une ligne par carte et par couple : rareté, titre, « ×n » si X l'a en double, puis les
  collections de Z qu'elle complète (un même article dans deux
  collections de Z : une seule ligne). Groupées par couple « X → Z » avec « Paul peut compléter 5 cases chez Léa, dont 3
  en double » ; **un bloc par paire de membres** (2026-10-24, demande d'un membre : « Toi → Paul » et « Paul → Toi » étaient deux blocs
  séparés, on ne s'y retrouvait pas) : « Toi ⇄ Paul », avec ses deux sens l'un sous l'autre (ce que tu donnes, puis ce que
  tu reçois ; entre deux amis, de A à Z : « Léa ⇄ Paul », « Léa → Paul » puis « Paul → Léa ») ; ordre des blocs : ceux qui ont le plus de doubles (les deux sens
  comptés), puis le plus de cases (toi d'abord à égalité) ; dans un couple, les doubles d'abord (les
  plus faciles à donner), puis les cartes qui remplissent le plus de collections, puis la rareté. Filtres : « Tout le
  monde » (par défaut : peu d'échanges pour l'instant, demande de l'utilisateur du 2026-10-16), « Ce qui me concerne » (tu
  donnes ou tu reçois), ou un membre (il donne ou il reçoit). Une ligne de
  ta carte ouvre sa fiche ; une ligne pour toi ouvre la fiche de la case vide ; entre deux amis, rien à ouvrir (sauf,
  comme sur toute ligne pour un ami, le nom de ses collections : son album). Calcul
  dans le navigateur (`trades`, propriété calculée : refait quand les cartes, les collections ou les qids changent ;
  ~120 ms pour 6 personnes de 5 000 cartes et 30 000 éléments de collection), filtre à part.
- **Proposer un échange** (2026-10-22) : un bouton « Proposer un échange à Paul » sur chaque bloc entre toi et un ami
  (« Toi ⇄ Paul », un seul bouton depuis le 2026-10-24). La fenêtre reprend ces deux couples, **toutes** les cartes (pas seulement les
  doubles) : « Tu donnes » (tes cartes qui complètent ses collections) et « Tu reçois » (les siennes qui complètent les
  tiennes), cases à cocher, **doubles cochés d'avance**, « Tout cocher · Rien · Les doubles » par colonne, le résumé
  « Tu donnes 2 cartes, tu reçois 1 carte. », 40 cartes au plus. Sous chaque colonne (2026-10-23) : « Et des wikibidous »,
  un montant (entier, vide = 0) et le solde de celui qui paie lu à sa dernière synchro (« Ton solde : 120W (lu il y a 5 min) »,
  « Solde de Paul : 40W », ou « pas encore lu ») ; le montant est **plafonné à ce solde** (2026-10-23, demande de
  l'utilisateur : bloquer plutôt qu'avertir) : le champ a ce `max`, un montant tapé au-dessus est ramené au solde, un solde
  à 0 désactive le champ, et un solde relu plus bas qu'un montant déjà tapé bloque l'envoi (« pas assez, baisse le
  montant »). Solde pas encore lu : pas de plafond, le jeu vérifie. Un montant invalide bloque aussi l'envoi. Des wikibidous seuls, sans carte, suffisent ; le résumé les ajoute (« Tu donnes 1 carte et 5W, tu reçois 1 carte. »). Sans compte du jeu relié : avertissement, envoi
  désactivé et « Relier mon compte ». **Pas amis dans le jeu** (2026-10-24) : le jeu n'accepte un échange qu'entre amis ;
  à l'ouverture, la fenêtre lit l'amitié (`GET /api/friends?fresh=1`, « Vérification de ton amitié avec Paul dans le
  jeu… ») et, si Paul n'est pas ton ami (`none`, `sent`, `received`), **remplace les cartes** par « Paul n'est pas ton ami
  dans le jeu. Le jeu n'accepte les échanges qu'entre amis. » et la suite : `none` → « Envoyer une demande d'ami à Paul »
  (`POST /api/friends/request`), ou, si l'envoi est coupé (`can_request: false`), la marche à suivre et les liens « Son
  profil dans le jeu ↗ » (s'il a donné son pseudo) et « Mes amis dans le jeu ↗ » ; `sent` → « Ta demande d'ami est partie »
  et « Vérifier à nouveau » ; `received` → « Paul t'a envoyé une demande d'ami : accepte-la dans le jeu » ; « Vérifier à
  nouveau » relit l'amitié et rouvre le formulaire une fois amis. `unknown` (liste illisible, ami ni relié ni avec pseudo) :
  le formulaire comme avant, le jeu tranche. « Proposer l'échange dans le jeu » appelle `POST /api/trades/create` ; une erreur
  reste dans la fenêtre ; une réussite dit ce qui part et ce qui arrive, et donne le lien vers les échanges du jeu. Le
  serveur, avec la session reliée du membre, sous son bail (2 min) s'il est libre. Une lecture automatique peut tenir ce
  bail plusieurs minutes : il ne sert qu'à éviter deux renouvellements de la session en même temps, donc l'échange part
  **sans bail** si la session vaut encore plus de 5 min (aucun renouvellement, ni d'avance ni sur un `401` ; le jeton
  d'accès reste valable même si la lecture renouvelle la session). Sans bail et session à renouveler : `409` « réessaie
  dans quelques minutes » (2026-10-22 : un second échange tombait sur une lecture automatique en cours) :
  1. l'ami dans le jeu : le compte qu'il a relié (`game_uid`), sinon son pseudo (`profiles?username=eq.…`) ; ni l'un ni
     l'autre : `409` ;
  2. le jeton d'accès renouvelé d'avance s'il expire dans moins de **5 min** (le jeu, lui, renouvelle à 90 s : il n'a
     jamais à le faire pendant l'appel ; un jeton de renouvellement ne sert qu'une fois) ;
  3. un exemplaire de chaque carte : `user_cards?select=id,card_id,count,starred,is_shiny,obtained_at&user_id=eq.…&card_id=in.(…)`
     pour les tiennes ; pour les siennes, la même lecture, et si la base du jeu n'en rend aucune (RLS, **non vérifié**),
     la page de profil du jeu, `GET /api/profile/<pseudo>/collection?q=<titre>&pending=1` (une par carte, 300 ms entre
     deux ; exemplaires de `pendingTradeCardIds` écartés). Exemplaire choisi : ni étoilé ni brillant si possible, puis le
     plus gros paquet, puis le plus récent. Une carte introuvable d'un côté : `409` qui la nomme, rien n'est envoyé ;
  4. `POST https://www.wiki-masters.com/api/trades` `{recipient_id, items:[{user_card_id, card_id, offered_by}],
     initiator_wikibidous, recipient_wikibidous}` → `201 {trade:{id, status:"pending", …}}` (relevé dans un HAR du
     2026-10-22 ; `initiator_wikibidous` = ceux que donne celui qui propose, `give_wb`, `recipient_wikibidous` = ceux que donne
     l'ami, `get_wb` : d'après un échange reçu du même HAR, `initiator_wikibidous: 5`). En-têtes : `Cookie` = le cookie de session des pages du jeu **refait** depuis la session gardée
     (`sb-…-auth-token=base64-` + JSON `{access_token, token_type, expires_in, expires_at, refresh_token, user:{id}}`),
     `Origin` et `Referer` du jeu, `Accept`, `Content-Type` ; jamais d'en-tête de navigateur. **Une seule tentative**
     (une écriture ne se rejoue pas) : panne ou `5xx` → `502` « regarde dans le jeu s'il a été créé ». `401`/`403` ou
     redirection : `502` (« propose-le dans le jeu ») sans déclarer la session perdue. Autre refus : `409` avec le message
     du jeu (300 caractères au plus). Un `Set-Cookie` de la session du jeu dans la réponse (renouvellement fait par le jeu)
     est **gardé** (version comparée et incrémentée, comme un renouvellement), sinon la rotation fermerait la session.
  Rien n'est écrit au journal des synchros (ce n'est pas une synchro ; l'échange se voit dans le jeu). **Non vérifié sur
  le jeu** : que sa route accepte ce cookie refait (en particulier `user` réduit à `{id}`), et la lecture des exemplaires
  d'un autre joueur dans sa base ; un échange avec des wikibidous (le format vient d'échanges lus, aucun n'a encore été créé ainsi) ni ce que le
  jeu répond à un solde insuffisant. Pas d'acceptation ni d'annulation depuis le classeur.
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
- **Règles du jeu** : le classeur montre qui a quoi. Il peut **proposer** un échange dans le jeu, au nom du membre qui le
  demande (« Proposer un échange ») ; l'accepter, le refuser ou l'annuler se fait dans le jeu, par les joueurs.

## Amis dans le jeu

Le jeu n'accepte un échange qu'entre **amis du jeu** (2026-10-24, demande de l'utilisateur). Le classeur lit la liste
d'amis de chaque membre sur le site du jeu et peut envoyer des demandes d'ami (`friends.js`).

- **Lecture** : `GET https://www.wiki-masters.com/api/friends` (relevé dans le HAR du 2026-10-22), cookie de session refait
  comme pour l'échange → `{friendships:[{id, status, requester_id, addressee_id, requester:{id, username}, addressee:{id,
  username}, created_at, updated_at}]}` (`status` : `accepted`, `pending` ; d'autres états possibles, tenus pour « rien »).
  Rangée vue du membre dans `users.game_friends` (`{at, list:[{uid, name, st, out}]}`, `out` : c'est lui qui a demandé).
  Un membre du classeur y est reconnu par son compte relié (`game_uid`), sinon par son pseudo (sans casse). Au clic, compte
  dans le plafond par minute des routes du site (`site`, 20) et respecte sa pause de 10 min.
- **Envoi** : `POST https://www.wiki-masters.com/api/friends {addressee_id}` → `201 {friendship:{id, requester_id,
  addressee_id, status:"pending", created_at, updated_at}}` (relevé dans le HAR du 2026-10-24 ; mêmes en-têtes que
  l'échange : cookie de session refait, `Origin`, `Referer` `/friends`, `Content-Type`), une seule tentative. Compte visé :
  son `game_uid`, sinon son pseudo (`profiles?username=eq.…`, comme l'échange ; le jeu a aussi `GET /api/friends/search?q=`
  → `{users:[{id, username}]}`, non utilisé). Interrupteur `FRIEND_ROUTE.known` (`friends.js`) : à `false`, plus aucune
  demande ne part (`503` au clic, rien au cron), si le jeu change sa route. Avant d'envoyer, la liste est relue : rien ne
  part si vous êtes déjà amis ou si une demande attend, dans un sens ou dans l'autre.
- **Demandes automatiques** (case « Envoyer une demande d'ami aux membres du classeur », Réglages, section « Amis dans le
  jeu », `users.auto_friend`, **coupée par défaut**) : pendant la vérification de la collection par le cron (toutes les 10
  min, membres éligibles aux lectures automatiques, sous leur bail), pour un membre qui l'a cochée, une demande à chaque
  autre membre **relié au jeu** (qui a un `game_uid`) à qui il n'a encore rien demandé : un nouveau membre la reçoit à la
  passe qui suit sa liaison, les membres déjà là à la première passe après la case cochée. 5 demandes au plus par membre
  et par passe, 1 s entre deux. Chaque compte visé n'est traité qu'**une fois** (`friend_requests`, clé `(user_id,
  target_uid)` : `sent`, `friends`, `pending` si une demande attendait déjà, `error` retentée après un jour ; aussi notée
  au clic). Sans personne de nouveau, **aucun appel au jeu**. Un échec n'est pas celui de la lecture ; une limite du jeu
  arrête la passe et saute la suivante, comme pour la collection. Le résultat de la passe compte les demandes envoyées
  (« …, 1 demande d'ami envoyée »). Jamais d'acceptation, de refus ni de retrait de demande.
- **Rattrapage** (« Ajouter les membres pas encore amis », 2026-10-24, demande de l'utilisateur) : une fenêtre, ouverte en
  **cochant la case** (« C'est coché : chaque membre qui reliera son compte du jeu recevra une demande d'ami de ta part. Et
  ceux qui sont déjà là ? ») ou par le bouton « Ajouter les membres pas encore amis… » de la même section (compte relié).
  Elle relit la liste d'amis (`GET /api/friends?fresh=1`, `list`) : « Pas encore tes amis dans le jeu », cochés d'avance
  (un membre ni relié ni avec pseudo : non cochable, dit pourquoi), « En attente : … » (ta demande attend, ou la sienne :
  « accepte-la dans le jeu »), « Déjà tes amis : … ». « Envoyer N demandes d'ami » → `POST /api/friends/request-all`, par
  paquets de 20 ; le résultat de chacun s'affiche à sa ligne. Sans attendre les lectures automatiques (5 par passe).
- **Ce qui est montré** : à toi seul, ton amitié avec chaque membre qui partage (statut), jamais ta liste d'amis du jeu ni
  celle d'un autre membre. « Supprimer mon classeur » efface ses demandes notées.

## Auto-tag dans le jeu

Demande du 2026-10-25 : dans chaque collection, un tag existant du jeu peut être synchronisé **dans les deux sens**.
Code : `functions/_lib/autotag.js`, appelé par `readCollection` sous son verrou, uniquement sur une lecture complète
vérifiée (nombre de lignes exact, exemplaires distincts, compte avant/après et dernier exemplaire stables, aucune carte
ignorée ; forme et propriétaire des lignes et des tags vérifiés). L'ancienne lecture seule par règles reste inchangée
quand l'auto-tag est désactivé ; ses règles sont conservées mais suspendues pour l'album tant que l'auto-tag est actif.

- **Configuration** : `POST /api/targets/autotag {id, tag, enabled}` (clé principale, 2 Ko) → `{target}`. `tag` : nom
  existant, nettoyé, 1–200 caractères ; `enabled` booléen. Aucun choix par défaut (ni premier tag ni ancienne règle).
  L'activation sans tag est refusée (400), côté serveur comme dans l'interface. Un tag vide avec `enabled:false`
  efface la configuration. Collection absente : 404 ; conflit : 409. Un tag ne pilote
  qu'une collection par compte (index unique sur la clé repliée ; le moteur vérifie aussi l'id réel si le nom change).
  `GET /api/targets` et les réponses d'enregistrement incluent `auto_tag:{tag,key,enabled}|null` et
  `auto_tag_state:{at,added,removed,cards_added,cards_removed,left,error?}|null`. Jamais partagés avec les amis.
  `auto_tag_id` et `auto_tag_baseline` restent privés. Les modifications ordinaires et les envois en morceaux conservent
  cette configuration. Désactiver ou supprimer l'album ne retire pas ses tags ; réactiver repart de l'union des deux côtés.
- **Écritures observées** : requêtes communiquées par l'utilisateur :
  `POST rest/v1/user_card_tags {user_card_id,tag_id}` → 201 ;
  `DELETE rest/v1/user_card_tags?user_card_id=eq.<exemplaire>&tag_id=eq.<tag>` → 204. Chaque ajout est un objet unique,
  aucune écriture en lot supposée. Session du joueur, `supaWrite`, renouvellement sur 401, arrêt sur refus ou limite.
  Le tag est retrouvé parmi les tags des exemplaires lus avec la collection, puis son id est conservé (même s'il n'est
  plus posé sur aucune carte). Aucun tag créé. Pour la première liaison, il doit déjà être posé sur une carte possédée.
- **Première passe** : union des cartes de l'album et des cartes possédées portant ce tag. Les cases manquantes restent
  dans l'album ; une carte nouvellement obtenue les remplit et reçoit le tag. Rapprochement par titre normalisé, avec les
  alias déjà connus de `game_titles` ; pas de nouvelle résolution Wikidata côté serveur.
- **Passes suivantes** : une carte retirée de l'album perd le tag. Un tag retiré dans le jeu retire la carte de l'album.
  Un tag ajouté dans le jeu ajoute la carte à l'album. Un seul exemplaire tagué suffit ; en ajouter ne modifie pas les
  autres exemplaires. Un retrait enlève les associations de tous ses exemplaires encore tagués. Une vente/cession de
  l'exemplaire tagué est distinguée d'un retrait de tag : s'il reste un exemplaire, il reçoit le tag et l'album est conservé.
  Si le dernier exemplaire disparaît, la case reste dans l'album et redevient non obtenue par l'import des possessions.
  Récupérer la carte remplit la même case et lui redonne le tag. Même si le compte devient entièrement vide, deux lectures
  exactes à zéro permettent ce rafraîchissement pour un compte avec auto-tag actif (`allowEmpty` interne, refusé sans
  confirmation exacte). Une réponse vide non vérifiée ne supprime jamais les possessions.
- **Conflits et reprise** : le dernier état conserve les ids des exemplaires tagués. Une modification de l'album a priorité
  si les deux côtés ont changé avant la passe. Les écritures de l'album sont conditionnelles (`updated_at`, configuration
  inchangée). Une intention est persistée avant les POST pour qu'un retrait concurrent ne réapparaisse pas après succès
  du POST. Les erreurs et opérations restantes sont reprises à la prochaine synchro ; jamais de réessai aveugle.
- **Déclencheurs** : « Rafraîchir » et cron collection (10 min, synchro automatique active). Avec un auto-tag actif, le
  cron relit entièrement les exemplaires même si leur nombre/date n'a pas changé : un simple changement de tag doit être
  détecté, y compris navigateur fermé. Au plus 30 écritures de tag par passe et une seconde entre écritures (tous albums
  confondus). Après des écritures confirmées, les pages modifiées sont réimportées avant la réponse : les tags affichés
  sont à jour dès la même synchro, et les albums sont relus dans l'interface avant ses anciens ajouts automatiques.
- **Bouton dans l'album** : « Synchroniser maintenant », sous l'option auto-tag, déclenche le même rafraîchissement
  manuel (`POST /api/refresh`) et applique les auto-tags actifs. Nécessite un tag choisi, l'option activée et un compte
  du jeu relié ; désactivé pendant une synchro. Les erreurs et la limite d'une minute apparaissent dans l'album.
- **Journal** : la ligne de lecture complète inclut « Auto-tag réussi / partiel / en échec » et les nombres de tags
  ajoutés et retirés, même zéro. Une passe partielle ou refusée rend la ligne `warn` si l'import a réussi. Le détail
  `data.auto_tag` contient `{result:ok|partial|error,added,removed,left,cards_added,cards_removed,error?}` ; le message
  d'erreur est nettoyé avant stockage. Sans auto-tag actif, le journal conserve son format habituel.
- **Limites** : tailles des collections inchangées (1,7 Mo par album et 5 Mo d'éléments/règles par compte), contrôle du
  volume de l'état supplémentaire pour rester sous la limite de ligne D1. Une erreur d'auto-tag ne bloque pas l'import
  des cartes : bilan dans l'album et avertissement au clic. Une limite du jeu suspend la suite du cron comme les autres
  actions. Les tests utilisent le jeu simulé ; validation finale sur un compte réel encore à faire.

## Liste de souhaits du jeu

Depuis le 2026-10-25, Réglages propose deux modes (`users.wish_mode`, rendu par `GET /api/me` et modifié par
`PATCH /api/me {wish_mode}`) : `all` (« Toutes mes collections », albums existants et futurs) et `selected`
(« Collection par collection », valeur par défaut). Tout autre mode, ou un corps mêlant `wish_mode` et l'ancien
`auto_wish`, est refusé (400). Le mode individuel utilise les cases « Synchroniser cette collection avec ma liste de
souhaits du jeu » des albums. Changer de mode ne modifie jamais ces cases. En mode complet, le bloc de souhaits est
masqué dans l'album (réglage et bilan restent dans Réglages), et l'auto-tag occupe toute la largeur. Sinon, souhaits et
auto-tag sont côte à côte sur ordinateur et empilés sous 760 px. Une nouvelle collection
a sa case décochée, mais participe quand même en mode complet. Bouton manuel et bilan disponibles aux deux endroits.

- **Contrat** : `POST /api/targets/save` accepte `wish_sync?: boolean`. Absent, le choix existant est préservé,
  y compris lors des envois en morceaux, modifications, tris et ajouts automatiques. La réponse et `GET /api/targets`
  rendent `target.wish_sync`. Ce choix n'est pas partagé avec les amis.
- **Traitement** (`functions/_lib/wishlist.js`) : lit `wishlist_items` avec la session reliée ; retire les cartes suivies
  qui sont possédées ou ne sont plus demandées, puis ajoute les cartes manquantes des collections cochées (`status: ok`).
  Rapprochement par titre puis identifiant du jeu, carte française préférée, cache commun `game_titles`.
- **Retraits** : `wish_managed {user_id, card_id, title}` mémorise les cartes prises en charge, y compris un souhait déjà
  présent correspondant à une collection cochée. Décocher, supprimer une collection ou retirer un élément provoque le
  retrait des souhaits qui ne sont plus demandés. Une carte commune à plusieurs collections cochées reste. Les souhaits
  sans rapport avec les collections choisies sont préservés, même possédés. Suivi enregistré avant l'ajout au jeu pour
  reprendre après erreur ou modification simultanée.
- **Déclencheurs** : après enregistrement/suppression d'une collection et « Rafraîchir », en arrière-plan (`waitUntil`),
  au clic sur « Synchroniser les souhaits maintenant », et par le cron collection si la synchro automatique est active.
  Une minute entre deux passes après un geste/au clic ; sinon le cron reprend toutes les 10 minutes. En local : `--cron`.
  Une vérification est aussi due après 6 h ; après erreur, une heure d'attente sauf changement.
- **Reprise** : `users.auto_wish` devient un indicateur interne (mode complet **ou** collection cochée **ou** cartes suivies à nettoyer).
  Après la dernière désactivation, il reste actif jusqu'à la fin des retraits. `wish_dirty` marque les changements,
  `wish_state` conserve `{at, via, rev, size, added, removed, left, none, error?}`, rendu par `GET /api/me`.
  `left` inclut les ajouts, recherches et retraits en attente. Le bilan affiché dans chaque album est commun aux collections.
- **Limites conservées** : verrou commun avec les lectures du compte, 1 requête/seconde, 15 requêtes après un geste,
  20 au clic, 30 au cron ; ajouts/retraits par 100, 5 000 titres manquants examinés par passe, 10 pages de 1 000 souhaits.
  Les retraits protègent tous les titres sélectionnés, sans la limite de recherche. Un refus du jeu arrête la passe et
  apparaît dans son bilan. La lecture réelle de `wishlist_items` et les écritures par lots restent à valider sur un
  compte réel ; les tests utilisent le faux jeu.
- **Titres sans cartes** (2026-10-26) : le bilan propose « Voir les titres sans cartes » si `none > 0`.
  La page `#/souhaits-sans-cartes` couvre toutes les collections synchronisées, même ouverte depuis un album.
  Chaque titre indique ses collections et propose de copier son nom pour une vérification manuelle ; cases à cocher,
  suppression des titres sélectionnés ou suppression complète, après confirmation. Affichage par tranches de 100 titres.
  `wish_missing (user_id, title)` conserve les résultats négatifs de la dernière passe ayant terminé la résolution,
  en transaction avec le bilan (`missing_checked`). Aucun titre encore à rechercher n'y entre. Un ancien bilan est
  lisible grâce au cache négatif existant. La liste exclut les résultats expirés (7 jours), les cartes obtenues,
  les titres résolus depuis et les collections désynchronisées. Les retraits revérifient la révision de la liste,
  le mode, le contenu des albums et le cache ; une édition concurrente est conservée (`skipped`), jamais écrasée.
  Ils marquent `wish_dirty`, actualisent `none` et ne suppriment aucune carte du jeu. La suppression du compte efface
  aussi `wish_missing`.
- **Migration** : ancien réglage global actif → mode `all` et collections existantes cochées ; sinon mode `selected`
  et cases décochées. Une base déjà passée au choix par collection reste en mode `selected`, sans réinterpréter
  l'indicateur interne `auto_wish` comme un ancien réglage. Cartes connues dans le cache
  de ces anciennes collections reprises dans `wish_managed`. Trois migrations uniques préservent les choix ultérieurs.
  L'ancien `PATCH /api/me {auto_wish}` reste accepté pour les pages déjà ouvertes : il sélectionne/désélectionne toutes
  les collections existantes. L'interface actuelle n'utilise plus cette commande.


## Chat

Un seul salon pour **tous les classeurs du site** (onglet « Chat », demande de l'utilisateur du 2026-10-16 : « où tout le
monde peut parler »), lisible par tous les membres, qu'ils partagent leurs cartes ou non ; l'onglet le dit (« Visible par
tous les membres du classeur »). Code : `site/functions/_lib/chat.js`, tables `chat_messages` et `chat_reactions`.

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
  **Réponses** (demande de l'utilisateur du 2026-10-23 : « pouvoir répondre à un message ») : `POST /api/chat` accepte
  `reply_to`, le numéro du message auquel il répond (colonne `chat_messages.reply_to`) ; le serveur vérifie qu'il existe
  et n'est pas supprimé (`404` sinon : une ligne lue, clé primaire), rien de plus (on peut répondre à son propre message,
  ou à une réponse : pas de fil imbriqué, chaque réponse ne cite que son message). À chaque lecture, une requête de plus,
  seulement si les messages lus répondent à d'autres (clé primaire de `chat_messages`, puis l'auteur, 2 lignes par message
  cité ; ses collections et membres cités partent dans la requête de citations des messages lus), rend `reply` :
  `{id, author, mine, text}` = numéro, **prénom actuel** de son auteur, c'est le tien, et un **extrait** de son texte
  (citations rendues en clair, cartes citées sans leurs crochets, espaces et retours à la ligne réduits à un espace,
  140 caractères au plus, coupé au mot près, avec « … ») ; `{id, gone:true}` s'il a été supprimé ou purgé depuis
  (`DELETE /api/me` compris). Sans réponse, pas de champ `reply` : une page d'avant cette fonction montre la réponse comme un
  message ordinaire.
  **Réactions** (demande de l'utilisateur du 2026-10-24 : « les réactions sur les messages dans le chat ») : chaque membre
  met ou retire sur n'importe quel message (le sien compris) un ou plusieurs emojis d'une liste fixe, 👍 ❤️ 😂 😮 😢 🎉 🔥
  👀 (`CHAT_REACTIONS` de `chat.js`, même liste dans la page) : `POST /api/chat/<id>/react {emoji, on}`, explicite
  (`on`) plutôt qu'une bascule, pour qu'un double clic ou deux onglets ne la retirent pas. Table `chat_reactions` (une
  ligne par message, membre et emoji, sans `rowid`) ; `chat_messages.reacts` tient leur nombre. Comme écrire, il faut un
  prénom (c'est lui que les autres voient). Chaque changement donne au message une **nouvelle révision** : la relecture
  `?after=` le rend de nouveau, et la page le remplace dans le fil (un message plus ancien que ceux affichés n'y est pas
  ajouté ; une page d'avant cette fonction l'ajoute à sa place, sans les réactions, jusqu'à son rechargement).
  `last_chat_id` ne bouge pas : une réaction ne fait pas de non-lu. À la lecture, `reactions` (voir **Message**) : qui
  a mis chaque emoji est lisible par tout le salon (prénom actuel, comme l'auteur d'un message), jamais l'id interne. Un
  message supprimé (par son auteur, la purge, `DELETE /api/me`) perd ses réactions ; `DELETE /api/me` retire aussi
  celles du compte, et les messages qui en avaient reçoivent une nouvelle révision (ils changent aussi dans les pages
  ouvertes). Limites (`429 {error, retry_after}`) : 30 réactions mises ou retirées par minute et 500 par 24 h par
  classeur, dans des fenêtres fixes tenues dans sa ligne de `users` (`react_min`, `react_min_at`, `react_day`,
  `react_day_at` : une écriture, pas de journal), contrôlées et comptées dans la même requête.
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
- **Clé** : la clé principale ; même origine (pas de CORS).
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
  - réactions : à la lecture, une requête de plus, seulement si un message lu en a (`reacts` > 0) : par la clé primaire
    de `chat_reactions`, une ligne par réaction et son auteur (clé primaire de `users`) ; aucune pour une relecture sans
    changement. Mettre ou retirer : le message (1 ligne), la limite (1 ligne de `users`, écrite), la réaction (1 ligne
    écrite) et la nouvelle révision du message (la ligne et l'index `chat_by_rev`) ≈ 5 lignes écrites ; rien de plus si
    elle était déjà mise ou retirée. Au pire (500 par jour pour un classeur) ≈ 2 500 lignes écrites (2,5 % du quota) ;
  - JavaScript : moins de 1 ms par requête (100 messages de 500 caractères : 0,2 ms, `dev/api.test.mjs`).
- **Interface** (onglet « Chat ») :
  - fil (`role="log"`) puis champ de saisie ; à l'ouverture, la page défile pour que le bas du chat soit visible. Bulles :
    les tiennes à droite, en émeraude, avec « (toi) » et « Supprimer » ; nom, heure (« 14:32 », « hier, 14:32 », « 15 oct.,
    14:32 ») et date complète en info-bulle ;
  - **Répondre** (2026-10-23) : bouton à côté de l'heure de chaque bulle (icône seule sur téléphone), les tiennes comprises ;
    il ouvre au-dessus du champ un bandeau « Réponse à Noa » avec l'extrait du message et × pour l'annuler (ou **Échap**
    dans le champ, quand aucune suggestion n'est ouverte), et met le curseur dans le champ (placeholder « Ta réponse… ») ;
    le brouillon est gardé. L'envoi porte `reply_to` ; réussi, le bandeau disparaît. Dans le fil, une réponse montre
    au-dessus de son texte le message cité (prénom, « (toi) » pour les tiens, extrait sur deux lignes) : un clic le fait
    défiler au milieu du fil et clignoter un instant (contour fixe si les animations sont réduites), ou, plus ancien que
    ceux affichés, le dit (« Charger les messages plus anciens ») ; supprimé : « En réponse à un message supprimé », sans
    lien. Une suppression vue par la relecture `?after=` (ou la tienne) change aussitôt les citations du message en
    « supprimé » ; si ton brouillon y répondait, le bandeau part avec un avertissement sous le champ. Une réponse **des
    autres** à un de tes messages est mise en avant comme une mention (« te répond ») et compte dans le second badge, dont
    le texte pour lecteurs d'écran devient « dont 2 s'adressent à toi » ;
  - **Réagir** (2026-10-24) : bouton (icône de sourire, « Réagir » sauf sur téléphone) avant « Répondre » sur chaque
    bulle ; il ouvre sous l'en-tête le choix des 8 emojis (`role="group"`, le premier prêt au clavier, flèches gauche et
    droite, **Échap** ou un clic ailleurs le ferment ; ceux que tu as déjà mis sont marqués et les choisir les retire).
    Sous la bulle, une **pastille** par emoji (emoji et nombre ; la tienne surlignée, `aria-pressed`), qui l'a mise en
    info-bulle (« Ben, Cléo et toi ») et pour les lecteurs d'écran ; un clic met ou retire la tienne. La page change la
    pastille tout de suite, puis prend ce que rend le serveur (les réactions des autres arrivées entre-temps comprises) ;
    refusée (`429`…) : remise comme avant, avec le message du serveur ; message disparu (`404`) : retiré du fil. Les
    réactions des autres arrivent par la relecture `?after=` (12 s) : pas de « Nouveaux messages ↓ » ni de non-lu ;
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
    - `#u:` (2026-10-20) : **toi** d'abord (« toi : ton classeur », pour partager ta page ; demande de l'utilisateur du
      2026-10-20), puis les **membres qui montrent leurs cartes** (comme `@`), avec leur pseudo dans le jeu ; il faut
      montrer les tiennes (ton identifiant public vient de `GET /api/me`). Insère le **lien** du classeur
      (`<origine>/#/ami/<id public>`), que le serveur range sous sa forme stable. Ce lien ouvert par toi-même (ton
      propre id public) mène à « Mes cartes » (`#/ami/<ton id>/<collection>` : ta collection), au lieu d'un lien mort ;
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
    que la page a lus ; tes propres messages (d'un autre appareil) ne comptent pas. Parmi eux, ceux qui te mentionnent ou
    répondent à un de tes messages : un second badge, en couleur d'alerte, « @2 » à côté du nombre (le texte pour lecteurs
    d'écran devient « 5 messages non lus, dont 2 s'adressent à toi ») ; rien hors de la page (ni notification du navigateur, ni courriel) ;
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
  UPDATE chat_messages SET text = '', deleted = 1, reacts = 0, rev = (SELECT MAX(rev) FROM chat_messages) + 1
    WHERE id = 42 AND deleted = 0;
  DELETE FROM chat_reactions WHERE message_id = 42;
  -- supprimer tous les messages d'un classeur, par son prénom
  UPDATE chat_messages SET text = '', deleted = 1, rev = (SELECT MAX(rev) FROM chat_messages) + id
    WHERE deleted = 0 AND user_id IN (SELECT id FROM users WHERE name = 'Paul');
  -- vider tout le salon (les pages ouvertes repartent de zéro)
  DELETE FROM chat_messages;
  DELETE FROM chat_reactions;
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
  (adresse appliquée, lien mort, classeur vide ouvert sur « Synchro ») la remplacent aussi.
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
| **Depuis le jeu** (`jeu`) | une **recherche dans les cartes du jeu** (`GET /api/game/cards?q=`, faite par le serveur avec le compte relié) : « Chercher », la liste des cartes trouvées avec leur rareté dans le jeu (200 au plus, « Les 200 premières : précise ta recherche pour voir les autres »), puis « Créer la collection « <recherche> » (N cartes) » = `POST /api/targets/save {name, source:'wm:<recherche>', items:[{title, description: catégorie du jeu, image, status:'ok', rarity}]}`. Sans compte relié (ou « à relier ») : « Pour chercher dans le jeu, le classeur a besoin de ton compte du jeu : relie-le une fois, dans l'onglet « Synchro ». » et « Relier mon compte » |

`openEditor(null, mode)` ouvre la fenêtre sur un onglet ; changer d'onglet arrête une recherche en cours (mots-clés,
suggestions). « Mes collections » a aussi, quand il y en a, un lien « N propositions d'après tes cartes » qui ouvre la
fenêtre sur « Propositions ». « Modifier » (album d'une collection) garde sa fenêtre à part, « Modifier la collection »
(l'éditeur « Liste d'articles » seul).

1. **« Mes collections »** : TOUTES les collections à compléter (« Nouvelle
   collection » par URL, mots-clés, liste d'articles, propositions ou « Depuis le jeu », anciennes du catalogue). Une collection de source `wp:…` est signalée sur sa ligne et dans son
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

   **« Réorganiser »** (en tête de « Mes collections », avant « Nouvelle collection », à partir de 2 collections ; demande
   de l'utilisateur du 2026-10-24 : « pouvoir réorganiser les collections ») : la liste passe en mode réorganisation
   (`S.colOrder`, badge « Réorganisation ») : une ligne compacte par collection (poignée ⠿, numéro, éventail, nom, « 12 sur
   40 » ; sous 560 px, poignée, nom et boutons seulement), qu'on **glisse** (pointer events : à la souris toute la ligne
   après 6 px, au doigt ou au stylet par sa poignée seulement ; repère d'insertion horizontal ; lâchée au-dessus ou
   au-dessous de la moitié d'une ligne : avant ou après elle ; Échap annule le geste ; la page défile près des bords), ou
   qu'on déplace par ses boutons **« En tête », « ↑ », « ↓ », « À la fin »** (aux bouts, `aria-disabled` : le focus reste,
   l'annonce dit « déjà en tête / à la fin » ; après un déplacement, le focus reste sur le même bouton de la collection).
   Annonce pour les lecteurs d'écran (`role=status`) : « « Alpha » : position 2 sur 4. ». **« Enregistrer l'ordre »**
   (grisé tant que l'ordre est celui de la liste ; « Ordre modifié, pas encore enregistré » / « Ordre inchangé ») : une
   seule requête `POST /api/targets/order {ids}`, puis le message « Nouvel ordre des collections enregistré. » avec
   **« Annuler »** (10 s : l'ordre d'avant renvoyé). **« Annuler »** du mode : rien n'est envoyé, « Reprendre » rend le
   brouillon. Le brouillon survit à un changement d'onglet ; recharger la page avec un ordre modifié le demande d'abord
   (`beforeunload`) ; une collection créée ou supprimée entre-temps est ajoutée à la fin ou retirée. Changement de
   classeur : brouillon oublié.

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
     une collection créée « Depuis le jeu », celle de Wikidata sinon : en général le même texte), 2 éléments au moins et 20 %
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
   fenêtre le dit pour chaque liste ; **aucun tag du jeu lu** : « Aucun tag du jeu lu pour l'instant : ils arrivent avec chaque
   lecture de ta collection (onglet « Synchro », « Rafraîchir maintenant »). Si tu n'as posé aucun tag sur tes cartes
   dans le jeu, les catégories du jeu ci-dessous suffisent. ». **Aperçu** des cartes des propositions cochées (de A à Z, avec leur rareté, et leur catégorie du jeu
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
   - **À chaque arrivée de cartes dans la page** (ouverture du classeur, lecture de la collection — « Rafraîchir »
     ou lecture automatique repérée par la relecture des 60 s —, relecture `?since` qui change les cartes, y
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
   **sans les images** (`image: null` partout, comme pour une création « Depuis le jeu » : la page retrouve les vignettes sur Wikipédia ;
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
  ligne vide de toute la largeur avant lui, `.grid-break`, sauf en tête : l'écart entre deux sections est doublé). Les
  cartes d'avant le premier intercalaire (hors de toute section, « non triées ») sont montrées **après** les sections, sur
  leur propre ligne (2026-10-26, demande de l'utilisateur : les intercalaires toujours au-dessus des cartes non triées) ;
  seulement à l'affichage (album à toi ou d'un ami) : la collection garde son ordre, et « Réorganiser » montre l'ordre
  rangé. En tri
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

## Le marché (cotes, valeur, bonnes affaires)

Demande du 2026-10-16, d'après la description de l'outil d'un ami (Python, Vercel). Avant le 2026-10-22, un favori lisait le marché dans la page du jeu, sans
aucune session sur le serveur ; **depuis le 2026-10-22, c'est le serveur qui lit**, avec la session du jeu reliée du membre (voir
« Session du jeu »). Code : `functions/_lib/marketread.js` (la passe de lecture, `POST /api/market/refresh`, `GET /api/game/cards`),
`functions/_lib/market.js` (plan, quotas, cotes, valeur, lecture rangée, `GET /api/market`), `functions/_lib/cron.js` (la passe
automatique), onglet « Marché » de `app.js`.

**Qui lit quoi.** Le serveur, **au clic** du membre sur « Actualiser le marché » (`POST /api/market/refresh`) et **sans clic**, **une passe
par membre toutes les 20 minutes** (déclencheur marché, « Lectures automatiques »). **Depuis le 2026-10-23, la passe du clic est légère**
(demande de l'utilisateur : rafraîchir vite ses infos perso, laisser le reste au cron) : étapes 0 à 5 ci-dessous, réponse dès la lecture du
marché rangée, sans l'étape 6 (cotes du plan) : 5 à 12 requêtes, soit 5 à 12 s au lieu d'environ 30. Les cotes du plan ne sont relues que
par les passes automatiques, **complètes**. Il lit directement la base du jeu
(`https://cyrxjeppjqsxxjayfrur.supabase.co/rest/v1/`, tables `auctions`, `auction_bids`, `cards`) avec la clé publique `anon` du jeu et le
jeton d'accès de la session reliée (`apikey` et `Authorization: Bearer`). **Jamais** les routes `/api/marketplace/…` du site du jeu
(30 requêtes par minute puis `403 automation_limit` pour les ventes d'une carte). **Sans session reliée** (« à relier ») : rien n'est lu,
`401 {needs_link:true}` au clic, et la raison est notée dans le dernier essai (`attempt.why`).

**Rythme.** **Une requête par seconde au plus, 30 par passe** (`SUPA_MAX`, `SUPA_GAP_MS` ; les renouvellements de session et les nouveaux
essais après une erreur passagère ne comptent pas) ; la passe suivante reprend aux cotes les plus anciennes. **Essai (2026-10-22)** : un membre qui coche
« Lire le marché plus vite (essai) » (Réglages, « Synchro rapide du marché » ; `users.fast_sync`, `PATCH /api/me {fast_sync}`, **coupée
par défaut**) lit **une requête toutes les 250 ms, 60 par passe**, sur un plan de 6 000 cartes (`FAST_GAP_MS`, `FAST_MAX`, deux fois
`PLAN_CARDS`) : lui seul prend le risque d'être vu ou limité par le jeu (la page le dit) ; les autres ne changent pas. Jamais moins de 5 min entre
deux passes complètes d'un classeur quand la seconde est automatique (`AUTO_GAP` ; une passe légère ne compte pas), jamais deux passes en même temps pour un membre (bail `sync_lock`, `409`). Au clic,
**une passe par minute au plus**, d'où qu'elle vienne : `429 {error, retry_after}` (secondes) dès que la **dernière passe a commencé il y
a moins de 60 s, même finie** ; `409` si une passe (ou une lecture de la collection) est en cours ; `429 {quota:0}` si le quota du jour
des cotes est atteint (rien n'est lu). Arrêt aussitôt, avec la raison, sur `429`/`automation_limit` (« Le jeu limite les lectures
automatiques : réessaie plus tard. », `429 {limited:true}` ; la passe automatique suivante est sautée), sur une autre erreur
`4xx` ou un format inattendu (« La base du jeu a refusé une lecture (400) : … le jeu a peut-être changé ») et sur une erreur passagère
(`502`) ; **les cotes déjà lues sont gardées**, la lecture du marché aussi si elle était déjà rangée, et l'échec est noté (`attempt.why`,
avec « N cotes lues avant l'arrêt ont été gardées »).

**Une passe** (`marketPass`), dans l'ordre :
0. **bail** et **session** (renouvelée d'avance si elle expire dans moins de 120 s) ; plan du classeur (`planFor` : l'essai est noté,
   `{start, v:'serveur', auto}`) ;
1. **tes mises** : `auction_bids?select=…,auction:auctions(…,card:cards(…))&bidder_id=eq.<uid>&placed_at=gte.<il y a 14 jours>&order=placed_at.desc&limit=200` ;
2. **tes ventes** : `auctions?seller_id=eq.<uid>&end_at=gte.<il y a 14 jours>&order=end_at.desc&limit=100` ;
3. **titres → cartes du jeu** : `cards?select=id,wikipedia_title,lang&wikipedia_title=in.("…","…")` (80 titres par requête au plus, 320
   par passe ; carte `lang` `fr` préférée ; `""` quand aucune carte n'a ce titre ; seulement les titres dont le card_id n'est pas encore connu) ;
4. **enchères en cours sur les cartes qui manquent aux collections** : `auctions?status=eq.active&end_at=gt.<maintenant>&card_id=in.(…)&order=end_at&limit=1000`
   (100 cartes par requête, 500 cartes au plus), moins celles du membre lui-même ;
5. **cotes des cartes de ces enchères et de tes mises et ventes** (300 cartes au plus, relues à chaque passe) puis rangement de la
   **lecture du marché** (`market.live`) ;
6. **cotes des cartes du plan** (les plus anciennes d'abord), par lots de 100 : `auctions?status=eq.settled_sold&settled_at=gte.<il y a 90
   jours>&card_id=in.(…)&order=card_id,settled_at.desc,id&limit=1000&offset=…` (pages de 1 000 dans un ordre stable ; plafond atteint au milieu d'un
   lot : seules les cartes lues en entier sont gardées), dans la limite du quota du jour ;
7. **rangement des cotes** par 500, le dernier lot (`last`) recalcule la valeur du jour et note l'essai fini (`end`, `ok:true`).
Les listes `in.(…)` sont découpées pour rester sous 5 000 caractères encodés (une adresse trop longue serait refusée, `414`). Réponse :
`{ok:true, read, left, deals, running}` : cotes lues, cotes du plan restant à lire (`stale` moins celles lues), bonnes affaires, mises en cours. Un
échec renvoie l'erreur avec sa raison (la même que `attempt.why`).

**Plan** (`planFor`, en SQL) : cartes possédées et cartes voulues dont le card_id est connu (`market.ids`), cote **absente puis la plus
ancienne d'abord**, sans celles lues depuis moins de 12 h (`FRESH_MS`), 3 000 au plus ; cartes voulues = titres des éléments vérifiés des
collections absents des titres des cartes (en SQL ; le serveur n'a pas les qids : une carte possédée sous un autre titre peut y figurer),
des collections changées le plus récemment d'abord, 500 au plus. Le cache commun amortit donc entre membres : une cote lue par l'un
n'est pas relue par un autre pendant 12 h.

**Cote** (`cotes`, calculée par le serveur), par carte, **rareté d'exemplaire** (`snapshot_rarity`) et brillance (`is_shiny`) : clé `R` ou `R*`,
`{p, n, w, l, d}` = médiane des 30 ventes les plus récentes (90 derniers jours), ventes lues, la même médiane sur les ventes de plus de 7
jours (3 au moins, sinon `null`), prix et date de la dernière vente. **Fiable à partir de 3 ventes** (`n ≥ 3`) ; en dessous, montrée avec
« ~ » et jamais comptée. Carte sans vente lue : `{}`, datée quand même (pas relue tout de suite). La fenêtre de 90 jours borne le nombre
de pages : une carte vendue plus rarement n'a pas de cote.

**Bonnes affaires** (avec les cotes **lues pendant cette passe**, jamais celles du cache commun) : enchère en cours sur une carte qui te
manque, d'un autre vendeur, avec une cote fiable de la rareté de l'exemplaire, demandée (enchère actuelle, sinon prix de départ) **au plus
à la cote** (2026-10-24 ; avant : à 80 % de la cote au plus, ou « finit bientôt » : sans enchère, moins de 2 h, départ ≤ cote) ; **la moins
chère par carte** (`more` = les autres enchères intéressantes sur la même carte) ; les **150 meilleures remises** (prix demandé / cote ;
`DEALS_MAX`, 50 avant, coupées alors par heure de fin), rangées de la fin la plus proche à la plus lointaine. Aucune requête de plus vers le
jeu : les enchères étaient déjà lues, le serveur en garde plus. **Les filtres de la page** choisissent lesquelles montrer (voir
« Interface ») ; par défaut, les mêmes qu'avant. La page écarte en plus celles **finies depuis la lecture** et celles d'une carte **que tu
as maintenant**. **Tes enchères** : regroupées par enchère (ta plus haute mise, 100 au plus) :
`run` (en cours ; `lead` : tu mènes), `won` / `lost` (vendue à toi, à un autre), `off`. **Tes ventes** : `run`, `sold`, `unsold` (close sans vente),
`off` (annulée). Chacune avec la cote de la rareté de son exemplaire. La lecture tient sous 200 000 caractères (sinon sans les images de
tes mises et ventes, puis sans les plus anciennes) ; `writeLive` en accepte 256 Ko (`413` au-delà).

**Où vont les données.** Les cotes vont au **cache commun** `prices` (une ligne par carte, **sans user_id** : des ventes du marché, liées à
aucun joueur, qui servent à tous les membres ; dernier écrivain gagne). La lecture du marché (bonnes affaires, tes enchères, tes ventes)
va au serveur, **une ligne par classeur** (`market.live`, jamais l'identifiant du joueur dans le jeu ni celui des enchérisseurs), remplacée à
chaque passe et **oubliée au bout de 7 jours** (la page dit son âge) ; les titres trouvés (`market.ids`, 2 000 au plus) évitent de les
rechercher à chaque passe. **Dernier essai** (`market.attempt`) : `{start, v, auto}` au plan (passe légère : en plus `light:true` et `full`, le début de la dernière
passe complète, `null` sans, gardés par un échec ; `fullStart` et `FULL_START_SQL` dans `market.js`), `end` et `ok:true` à la fin, ou `ok:false` et `why`
(le message d'échec, 300 caractères au plus, un texte qui ressemble à un jeton JWT remplacé par « [jeton masqué] ») ; **`v` vaut `'serveur'`**
(les essais d'avant le 2026-10-22 gardent la version de leur favori) ; des heures et un message, rien du jeu. `auto:true` pour une passe du cron.

**Serveur** (`market.js`) :
- **Cotes validées** avant écriture (`400`, rien d'écrit) : identifiant `[A-Za-z0-9_-]` (100 au plus), clés `C|PC|R|SR|UR|L` + `*` (12 au
  plus), montants de 0 à 10⁹, ventes entières de 1 à 10⁶, date ISO pas dans le futur, une carte une fois par envoi, 500 par envoi ; arrondies
  au centime ; remplacées en entier (`read_at` = maintenant).
- **Quotas du jour** (UTC) : 15 000 cotes par classeur, 150 000 pour tout le site (ligne `market` de user_id `'*'`) : une cote = une ligne
  écrite (et l'index de sa clé primaire) ; abonnement payant Workers depuis le 2026-10-17 (50 millions de lignes écrites par mois comprises) ;
  au-delà `429 {quota}`, à quelques envois simultanés près. Avec 50 membres, `QUOTA_ALL` et le volume de requêtes vers le jeu (jusqu'à ~4 500
  par heure) sont à surveiller : les rythmes sont des constantes.
- **Valeur** (`value_history`, un point par classeur et par jour UTC, le dernier calcul du jour remplaçant les précédents, 400 jours) :
  somme, sur les exemplaires (`variants` ; sinon approchés), de la cote fiable de leur rareté et brillance × leur nombre ; `priced` = cartes avec
  au moins un exemplaire coté, `cards` = cartes, `approx` = cartes sans détail de leurs exemplaires. Calculée en SQL dans D1 et écrite : à la fin
  d'une passe de ce classeur ; après une lecture complète de la collection (au plus une fois par heure, et seulement si des cotes existent) ; à
  `GET /api/market` si elle a changé (cotes relues par un autre membre). Aucun point tant qu'aucune carte n'est cotée.
- `DELETE /api/me` efface la ligne `market` et l'historique du classeur ; les cotes, communes, restent.

**Fausses cotes.** Aucune route n'accepte plus de cotes envoyées par un client : seul le serveur écrit `prices`, d'après ce que lit la
session d'un membre dans la base du jeu. (Avant le 2026-10-22, une clé d'import qui fuyait permettait d'envoyer de fausses cotes.) Une cote
fausse venant du jeu lui-même durerait jusqu'à ce qu'un membre la relise (plus de 12 h après).

**Interface** : bandeau, tuile « 12 340W · valeur (205 cotées) » quand une carte est cotée ; onglet **« Marché »** : en haut, la valeur
(« 205 cartes cotées sur 1 048 », cartes approchées), graphique de la valeur dès deux jours (SVG dans la page, survol : le jour le plus
proche ; « Voir les valeurs » : le tableau), le bouton **« Actualiser le marché »** (message « Marché relu : 4 bonnes affaires · 2 enchères en cours · 12 cotes
relues (736 autres à relire : le classeur s'en charge toutes les 20 minutes) ») et **où en est la lecture du marché** (voir ci-dessous) ; puis, **côte à côte** (l'une sous l'autre
sous 760 px), après « Mes ventes en cours » (2026-10-23, ci-dessous), « Bonnes affaires à acheter » et « Bonnes affaires à vendre » ; puis « Mes enchères » (tes mises, tes ventes) et « À savoir »
(avertissement des règles du jeu : le classeur lit le marché dans la base du jeu, ce qui est plus risqué que sa synchro de la collection ; si
le jeu limite les lectures, la passe s'arrête et la suivante est sautée). Ces sections, et « Valeur de ton classeur » (repliée, son titre garde
la valeur), sont **repliables** (accordéon : `aria-expanded`, contenu rendu seulement ouvert) : toutes ouvertes par défaut, **sauf « Mes
enchères », fermée** ; l'état est gardé par classeur dans ce navigateur (`localStorage` `classeur-marche` : `{<id du compte>: {open, min, col,
hideCol}}`, accès protégés ; `open.filtres` : le panneau des filtres de « à acheter » ; `col` : la collection choisie avant le 2026-10-24,
reprise dans les filtres tant qu'aucun n'est gardé au compte). Chaque liste montre **20 cartes**, puis « Afficher 20 de plus (N restantes) ».
- **Filtres de « Bonnes affaires à acheter »** (2026-10-24, demande de l'utilisateur : « n'afficher que les affaires sous un certain %, un
  prix… ») : une barre avec la **collection** (« Toutes les collections (N) », comptées après les filtres), le **tri** (« Fin la plus proche »
  par défaut, « Meilleure remise » = prix / cote, « Plus grosse économie » = cote − prix, « Prix croissant ») et le bouton **« Filtres »**
  (« Filtres · 3 » avec trois filtres actifs), qui ouvre un panneau : **au plus [80] % de la cote** (champ, puces 30 / 50 / 70 / 80 / 100 %),
  case « Montrer aussi celles qui finissent bientôt sans mise (moins de 2 h, au plus à la cote) » (cochée par défaut), **prix** de … à … W,
  **économie** d'au moins … W, **rareté** (puces L à C ; aucune = toutes), **brillante** (peu importe, seulement, exclure), **enchère** (toutes,
  avec mise, sans mise, tu mènes), **fin** (toutes, < 1 h, < 6 h, < 24 h), **cote** (3, 5 ou 10 ventes et plus). Avec des filtres actifs, une
  ligne « 4 affaires sur 47 · ≤ 50 % de la cote, UR, L. Effacer les filtres » (la collection et le tri restent) ; le nombre du titre de la
  section compte les affaires montrées ; « Aucune bonne affaire ne passe ces filtres. » ; chaque ligne dit aussi l'économie (cote − prix).
  **Gardés avec le compte** (pas dans le navigateur : les mêmes sur le téléphone et l'ordinateur), dans `prefs` (`PATCH /api/me`) :
  `deal_filter` = `{pct, soon, min, max, save, r:[raretés], shiny:''|'only'|'no', bid:''|'bid'|'nobid'|'lead', end:0|1|6|24, n:3|5|10, col, sort}`
  (défaut : `{pct:80, soon:true, min:null, max:null, save:null, r:[], shiny:'', bid:'', end:0, n:3, col:'', sort:'end'}`, normalisé à la
  lecture), enregistré tout de suite au clic et 0,8 s après la frappe dans un champ (une relecture de `GET /api/me` entre-temps ne le défait
  pas). **Filtres enregistrés** : « Enregistrer ces filtres… » (dans le panneau) demande un nom (40 caractères ; un nom déjà pris, sans tenir
  compte des majuscules, est remplacé) et garde le filtre en cours avec sa collection et son tri, 12 au plus (`deal_presets` =
  `[{name, f}]`) ; ils s'affichent en puces sous la barre (la puce du filtre en cours mise en avant ; un clic l'applique, « × » le supprime,
  sans confirmation).
- **« Bonnes affaires à vendre »** : tes cartes qui ne servent à **aucune** de tes collections (rapprochement titre puis qid, comme les albums).
  Case **« Cacher les cartes de mes collections »**, cochée par défaut (gardée dans ce navigateur, `hideCol`) : décochée, la liste montre aussi
  les **exemplaires en trop** de celles qui y servent (une collection n'a besoin que d'un exemplaire de la carte : on garde le moins coté, et la
  ligne dit « 2 en trop ») ; prix d'une ligne = la plus haute cote fiable de ses exemplaires à vendre, au moins le seuil « Valeur minimale :
  [100]W » (gardé avec l'état des sections) ; de la plus chère à la moins chère. Une ligne : rareté de l'exemplaire, titre (sa fiche),
  « brillante », « ×3 » ou « 2 en trop », « Copier le nom », cote, ventes, dernière vente. Cartes sans cote fiable : « 12 cartes sans cote fiable :
  le classeur les lit peu à peu, les plus anciennes d'abord, à chaque lecture automatique (toutes les 20 minutes). »
- **Cartes déjà en vente dans le jeu** : une carte mise aux enchères quitte la collection du jeu, mais reste dans le classeur tant qu'une
  lecture complète **vérifiée** ne l'a pas retirée (pendant que le joueur joue, les compteurs bougent et la lecture n'est pas vérifiée : rien
  n'est retiré, voir « Lecture de la collection »). « Bonnes affaires à vendre » écarte donc, d'après la dernière lecture du marché
  (`live.sales`), un exemplaire (même rareté et brillance si possible) par vente **en cours** (`run`) ou **conclue** (`sold`) ; une carte dont il
  ne reste aucun exemplaire n'est pas proposée, et une ligne le dit. Invendue ou annulée : la carte est revenue au joueur, elle reste proposée.
- **Vendre** (2026-10-23, `sell.js`, routes relevées dans un HAR du jeu du 2026-10-23 et dans le code de sa page) : « Mettre en vente dans le jeu »
  dans la fiche d'une de tes cartes, et « Mettre en vente » sur chaque ligne de « Bonnes affaires à vendre » (avec la rareté de la ligne). La
  fenêtre « Mettre en vente « … » » (large ; le formulaire à gauche, le marché à droite, l'un sous l'autre sous 760 px) :
  - **Exemplaire** : une puce par rareté d'exemplaire et brillance de tes exemplaires **dans le jeu** (`GET /api/market/sell`, lu à l'ouverture ;
    avant, ceux du classeur), « ×2 », « favori » ; par défaut, la rareté de la ligne, sinon celle qui a la plus haute cote fiable.
  - **Ce que le classeur sait du marché de la carte**, pour cette rareté : cote (« ~ » sous 3 ventes) et nombre de ventes, dernière vente, écart sur
    7 jours, enchères en cours (combien, la moins chère, avec ou sans mise ; tes ventes à part), ventes conclues, tes enchères actives sur leur
    plafond ; « Tes ventes de cette carte » (14 derniers jours, dernière lecture du marché) ; puis tout le « Marché dans le jeu » de la fiche
    (enchères en cours avec leur détail, courbe des prix de vente, qui suit la rareté choisie). Ce marché est lu comme à l'ouverture d'une fiche
    (`GET /api/market/card`, gardé 60 s : déjà lu si la fiche est ouverte dessous).
  - **Mise de départ** (W, entier, 1 au moins), proposée à la cote de la rareté (elle suit la rareté tant qu'on ne l'a pas changée) ; puces
    « la cote · 505W », « sous la moins chère en vente · 59W », « la dernière vente · 504W ». **Durée** : 10 min, 30 min, 1 h (par défaut, comme
    le jeu), 3 h, 6 h, 12 h.
  - **Avertissements** : plafond d'enchères actives atteint (envoi désactivé), plus d'exemplaire dans le jeu (désactivé), départ à moins de 70 % ou
    plus de 150 % de la cote fiable, enchères de cette rareté déjà moins chères, ton seul exemplaire alors qu'il sert à tes collections, exemplaire
    favori dans le jeu. Résumé « Commune · départ 300W · 3 h ».
  - « Mettre en vente dans le jeu » → `POST /api/market/sell`. Réussite : « « … » est en vente dans le jeu. Commune, départ 300W, fin vers … », lien
    « Ouvrir dans le jeu ↗ » et **« Annuler la vente »** ; l'enchère rejoint aussitôt la liste de la fiche (« ta vente ») et « Mes enchères »
    (le serveur l'ajoute à la dernière lecture du marché, sans changer son heure), et la carte quitte « Bonnes affaires à vendre ». Vérification
    anti-robot demandée par le jeu : le message et « Ouvrir ma collection dans le jeu ↗ ». Toute erreur reste dans la fenêtre.
  - **Annuler une vente** : depuis la fenêtre après la vente, depuis « Mes ventes en cours » et « Mes enchères » (« Annuler la vente » sur une vente
    en cours sans enchère reçue) et depuis la liste des enchères d'une fiche (« Annuler ma vente » sur la tienne, sans mise) ; hors de la fenêtre, une confirmation
    d'abord. Le jeu n'annule plus une vente dès qu'une mise existe : le serveur relit l'enchère juste avant et refuse (`409 {has_bid:true}`, « Quelqu'un
    a déjà misé sur cette vente : le jeu ne permet plus de l'annuler. »). Pas de baisse du prix de départ depuis le classeur (le jeu la permet une
    fois, après la moitié du temps sans mise) : elle se fait dans le jeu.
  - **Côté serveur.** Session de la route du site (comme le détail d'une enchère : renouvelée avant sous bail si elle expire dans moins de 5 min),
    chaque appel au site compté dans le plafond de **20 par minute** des routes du marché, et la **pause de 10 min** posée quand le jeu limite
    (`429`/`automation_limit`) s'applique aussi. Exemplaires : `user_cards?select=id,card_id,count,starred,is_shiny,obtained_at,snapshot_rarity,card:cards(rarity)`
    (rareté d'exemplaire : `snapshot_rarity`, sinon celle de la carte) ; exemplaire vendu : ni favori ni brillant si possible, puis le plus gros paquet,
    puis le plus récent (comme un échange). Vente : `POST https://www.wiki-masters.com/api/marketplace` `{card_id: <id de l'exemplaire>, base_amount,
    duration_minutes}` → `201 {auction_id}` (le champ `card_id` du jeu est l'id de l'**exemplaire**, `user_cards.id`) ; plafond :
    `GET /api/marketplace/mine` → `{sellingCount, maxConcurrentAuctions}` (5, 10 en Pro) ; annulation : `GET /api/marketplace/<id>` (vendeur,
    `status`, `current_bidder_id`, `bids`) puis `DELETE /api/marketplace/<id>` → `{status:"cancelled"}`. Cookie de session refait, `Origin` et
    `Referer` du jeu, **une seule tentative**, `Set-Cookie` gardé, refus du jeu repris (300 caractères), comme « Proposer un échange ».
    `human_verification_required` (le jeu ouvre alors un captcha) → `409 {verify:true}`. **Non vérifié sur le jeu** : la vente avec ce cookie refait
    depuis une adresse Cloudflare (la proposition d'échange marche ainsi), et quand le jeu demande la vérification anti-robot.
- **Miser** (2026-10-26, `bid.js`, route relevée dans un HAR du jeu du 2026-10-26 : `POST /api/marketplace/<id>/bid` `{amount}` → `200
  {auction_id, current_bid, bidder_balance}`, le solde **déjà débité** de la mise) : bouton **« Miser »** sur chaque ligne de « Bonnes affaires à
  acheter » (sauf celle que tu mènes) et sur chaque enchère en cours de la fiche d'une carte (sauf ta vente, celle que tu mènes, une enchère finie
  ou que le jeu ne connaît plus ; pas dans la fenêtre « Mettre en vente »), seulement avec un compte relié. La fenêtre « Miser sur « … » » (par-dessus
  la fiche, qui reste ouverte) : exemplaire, enchère actuelle ou prix de départ (« aucune mise »), cote (« ~ » sous 3 ventes), fin, ton solde lu à la
  dernière synchro ; **ta mise** (W, entier) proposée au minimum, puces « minimum · 50W » et « la cote · 100W » (si plus haute) ; avertissements :
  sous le minimum (envoi désactivé), au-dessus de la cote, plus que ton solde. **Minimum** : sans mise, le prix de départ ; après une mise, un W de
  plus que l'enchère actuelle (dans la fiche, celle lue sur le site du jeu si elle est plus haute) : le pas réel du jeu n'est pas connu, son
  refus est montré tel quel. « Miser 56W dans le jeu » → `POST /api/market/bid` ; refus `409 {min, cur}` (quelqu'un a misé entre-temps) : le
  minimum et l'enchère actuelle suivent, et le champ s'il était au minimum. Réussite : « Mise faite : tu mènes. Ta mise : 56W · ton solde dans le
  jeu : 944W. », « Ouvrir dans le jeu ↗ » ; la fiche la montre aussitôt « tu mènes », le marché est relu (la ligne passe « tu mènes », sans
  « Miser »). **Côté serveur** : comme « Vendre » (session de la route du site, deux appels comptés dans les 20 par minute, pause de 10 min,
  cookie refait, une seule tentative, `human_verification_required` → `409 {verify:true}`) ; relecture `GET /api/marketplace/<id>` (statut, fin,
  vendeur, meneur, `effective_bid` ou `base_amount` sans mise, `current_bid` sinon), puis la mise ; le solde rendu va dans `users.wikibidous`, et
  la dernière lecture du marché est corrigée sans changer son heure (`patchLive` : bonne affaire `ask`/`bid`/`lead`, ligne de « Tes mises » en
  tête, `st:"run"`). **Non vérifié sur le jeu** : la mise depuis une adresse Cloudflare, le pas minimal après une mise, ce que devient la mise
  d'un enchérisseur dépassé.
- **« Mes ventes en cours »** (2026-10-23 ; section pleine largeur sous la valeur, **ouverte par défaut**, `open.ventes`) : tes ventes pas encore
  finies (`live.sales` en `run` dont la fin n'est pas passée, y compris celles faites depuis le classeur, ajoutées par le serveur), la fin la plus
  proche d'abord, 20 puis « Afficher 20 de plus ». Une ligne : rareté, titre (sa fiche), « brillante », départ, enchère actuelle et écart à la cote,
  « sans enchère » ou « 2 mises » et « mène : <pseudo> », temps restant, « Ouvrir dans le jeu ↗ », et **« Annuler la vente »** (confirmation, voir
  « Vendre ») tant qu'il n'y a aucune mise, sinon « plus annulable ». Section ouverte dans l'onglet affiché : les mises des 10 premières sont
  **relues sur le site du jeu** (`GET /api/market/auction`, deux à la fois, gardées 2 min ; la lecture du marché peut dater de 20 min) ;
  « Relire les mises » les relit ; une vente que le jeu ne montre plus en cours : « terminée ou retirée ». Une vente annulée quitte la section.
- **Lecture du marché** (en haut, sous la valeur) : « Lecture du marché par le classeur : il y a 12 min (17 octobre, 10:02). » ; au-delà de 2 h,
  en orange, « Elle date de plus de 2 h : des enchères ont pu finir ou monter. Clique « Actualiser le marché » (le classeur la refait toutes les
  20 minutes quand la synchro automatique est active). » ; jamais d'essai : « Le classeur n'a pas encore lu le marché : relie ton compte (onglet
  « Synchro ») ou clique « Actualiser le marché ». » ; cotes lues mais pas la lecture du marché : « Cotes lues par le classeur il y a 5 min ;
  sa lecture du marché (bonnes affaires, tes enchères) n'est pas arrivée : clique « Actualiser le marché ». » ; dernier essai raté : « Dernier
  essai, il y a 5 min (automatique) : <la raison> » ; essai commencé il y a plus de 10 min sans fin : « Une lecture commencée … n'a pas abouti :
  réessaie « Actualiser le marché ». ». **Mise à jour de la page** : `GET /api/me`, relu chaque minute (page visible), rend `market_at` ; s'il a
  avancé depuis la dernière lecture de l'onglet (déjà chargé), `GET /api/market` et les cotes sont relus.
- **Montants** : partout (fiches, albums, lignes des collections, bandeau, onglet « Marché », amis), un montant s'écrit **collé à son W**
  (« 738W », « 1 234W », séparateur des milliers : espace insécable ordinaire) et **en vert** (classe `w`, `priceTag` dans `app.js`) ; « ~120W »
  estompé pour une cote peu fiable (moins de 3 ventes) ; « ~5 100W » pour une somme estimée.
- **Valeur d'une collection** (tes collections, et une catégorie ou une page de Wikipédia ouverte) : tes cartes qui la remplissent, comptées comme
  la valeur du classeur (cote fiable de la rareté de chaque exemplaire × nombre ; une carte une fois, même nommée par deux cases) : à côté de « N
  sur M » dans l'album (« Valeur : 2 340W (18 cartes cotées sur 25) ») et, discrète, sur sa ligne de « Mes collections » (« valeur 2 340W · pour la
  compléter ~5 100W »). **« Pour la compléter : ~5 100W (12 cartes cotées sur 30 qui manquent, à la moins chère de leurs cotes) »** : pour chaque
  carte qui manque (article vérifié, une fois par titre), **la moins chère de ses cotes fiables, toutes raretés d'exemplaire et brillance confondues** ;
  sans cote fiable, elle n'est pas comptée. Cotes : celles déjà lues pour le classeur (`GET /api/market/prices` : tes cartes, et les cartes voulues dont
  le classeur a trouvé l'identifiant, rangées par titre `t`), une seule lecture gardée en mémoire (relue au plus une fois par minute) : rien de plus
  n'est demandé pour une collection. Une carte qui manque n'a de cote que si le classeur l'a trouvée dans le jeu (titres des cartes qui manquent, 500 par plan).
- **Tris par prix** (« Prix ↑ », « Prix ↓ ») : « Mes cartes », albums de tes collections, classeur et albums d'un ami. Prix d'une carte = la plus haute cote
  de ses exemplaires (rareté, brillance ; ceux d'un ami : la rareté de sa carte) ; d'une case vide = celui de « Pour la compléter ». Les cotes peu fiables
  (« ~ ») viennent **après** les fiables, puis les cartes sans cote, **dans les deux sens** ; à égalité, l'ordre habituel de la vue. Pas de tri par prix
  dans « Échanges possibles » ni dans les listes du « Marché ».
- Fiche d'une carte possédée : cote de chacun de tes exemplaires (« 2 × Rare 400W · 10 ventes · dernière 399W le 15 octobre · 7 jours : +33 % »,
  « ~ » sous 3 ventes), total ; fiche d'une carte qui manque : ses cotes connues par rareté ; fiche d'une carte d'un ami : sa cote (venue avec ses cartes),
  sinon celle de ta carte, sinon celle d'une carte qui te manque. Relu à l'ouverture, après chaque changement des cartes, à l'ouverture de l'onglet et au
  retour sur la page (une fois par minute au plus, 20 s pour l'onglet ; et à la demande d'un tri par prix), et quand `market_at` avance. Rien n'est lu dans le
  jeu depuis cette page (CSP, et pas de session côté navigateur) : c'est le serveur qui lit.

**Marché d'une carte** (2026-10-22, demande de l'utilisateur : « suivre les enchères de plus près », comme le projet de référence de l'ami) : à
l'ouverture d'une fiche (ta carte, une carte qui te manque dont l'article est vérifié, la carte d'un ami), **au clic seulement**, la page lit son marché
par le serveur. Code : `functions/_lib/cardmarket.js`, `viewCardMarket` de `app.js`.
- `GET /api/market/card` : deux requêtes à la base du jeu, trois avec un titre (`cards?…wikipedia_title=eq.<titre>`, la version française d'abord) :
  `auctions?select=*&status=eq.active&end_at=gt.<maintenant>&card_id=eq.<id>&order=end_at&limit=101` (enchères en cours, 100 rendues, `more` au-delà ;
  `select=*` : un nombre de mises rangé dans l'enchère, s'il existe, est pris : `n`, colonnes `bid_count`, `bids_count`, `nb_bids` ou `num_bids` — on ne
  connaît pas le schéma) et `auctions?select=snapshot_rarity,final_price,settled_at,is_shiny&status=eq.settled_sold&card_id=eq.<id>&order=settled_at.desc,id&limit=1000`
  (les 1 000 ventes les plus récentes). Une enchère : `a` son id, `r`/`s` rareté et brillance de l'exemplaire, `ask` le prix à battre (enchère actuelle,
  sinon prix de départ), `bid` quelqu'un a misé, `cur`, `base`, `end`, `atk`/`def` de l'exemplaire, `lead` tu mènes, `mine` ta vente ; **jamais** l'identifiant
  du vendeur ni de l'enchérisseur. `v` : cotes recalculées de ces ventes (90 jours, comme une passe), rangées dans le cache commun (une cote du quota du
  jour ; quota atteint : montrée quand même), `null` si les 1 000 ventes ne couvrent pas les 90 jours.
- `GET /api/market/auction` : la seule source du nombre de mises, du meneur et du vendeur (la table `auction_bids` ne montre que tes mises) est la
  **route du site du jeu** `https://www.wiki-masters.com/api/marketplace/<id>`, avec le cookie de session refait (comme « Proposer un échange » ;
  jamais avec un jeton qui expire dans moins de 5 min : renouvelé avant, sous bail, `409` si une lecture le tient). Forme lue (relevée par le projet de
  référence, **pas vérifiée par ce Worker**) : `{auction: {status, current_bid, current_bidder_id, seller_id, current_bidder: {username}, seller:
  {username}}, bids: [{bidder_id, amount}]}`. Rendu : `bids` mises, `bidders` enchérisseurs différents, `leader` / `seller` leurs pseudos (montrés, **jamais
  gardés**), `leading`, `selling`, `my_bid` ta plus haute mise, `cur` l'enchère actuelle vue par le site ; `404` du site → `{gone:true}`.
- **Garde-fous** (table `game_reads`, une ligne par membre et par sorte, remise à zéro à chaque minute) : 12 fiches et 20 détails par minute et par
  membre (`429 {retry_after}`) ; le site du jeu limite (`429` ou `automation_limit`) : **pause de 10 minutes des détails pour ce membre**, sans plus rien
  envoyer au site (`429 {limited:true}`), les fiches restent lisibles. La page ne demande le détail que des **10 enchères les moins chères** d'une fiche,
  **trois à la fois**, et garde chaque détail 2 minutes, chaque fiche 1 minute (rouvrir une fiche ne relit rien) ; un refus `429` arrête les détails de
  la fiche, avec son message. `DELETE /api/me` efface ses lignes.
- **Interface** (fiche, sous la cote) : « Enchères en cours » (« 3, de la moins chère à la plus chère · lues il y a 2 min », « Relire ») ; une ligne par
  enchère, la moins chère d'abord : prix à battre (le plus haut de la base et du site), écart à la cote **fiable** de la rareté de l'exemplaire (« −40 % vs
  cote », vert à −10 % ou moins, rouge à +10 % ou plus ; cote peu fiable : « cote ~260W », sans écart ; aucune : « pas de cote »), rareté, « brillante »,
  temps restant (en orange sous 1 h, relu toutes les 30 s), « aucune mise, prix de départ » ou « enchère en cours », ATK et DEF, puis « 4 mises de 2
  joueurs », « mène : <pseudo> », « vendeur : <pseudo> », « tu mènes », « dépassée · ta mise 90W » (ta mise : le site, sinon la dernière lecture du
  marché), « ta vente » ; bord vert si tu mènes, doré pour ta vente ; lien **« Ouvrir dans le jeu ↗ »** (`https://www.wiki-masters.com/marketplace/<id>`,
  nouvel onglet). 10 enchères, puis « Afficher les N enchères ». Puis « Prix de vente » : une puce par rareté d'exemplaire (et brillance) vendue au
  moins deux fois (« Super rare · 12 »), celle de ton exemplaire par défaut, sinon la plus vendue ; courbe de la médiane des 30 dernières ventes à
  chaque vente, ventes en points, survol : médiane, vente et jour ; « Dernières ventes » (les 8 plus récentes). Sans compte relié : « Relie ton compte du
  jeu… » et un lien vers l'onglet « Synchro ».
- **Onglet « Marché »** : chaque bonne affaire, chaque mise et chaque vente **en cours** de « Mes enchères » a aussi son lien « Ouvrir dans le jeu ↗ ».

**Limites** : formats de la base du jeu relevés dans la description de l'ami et dans le favori d'avant le 2026-10-22, **pas vérifiés par ce Worker** (noms des tables et des
colonnes, statuts `active`/`settled_sold`/`cancelled`/`settled_*`, liens `auction:auctions(…)` et `card:cards(…)`) ; `automation_limit` vu sur les routes
`/api/marketplace/…` du jeu, **on ne sait pas si Supabase lui-même le renvoie** (le garde-fou traite `429` et `automation_limit` pareil). La première
relecture complète après le 2026-10-22 réécrit toutes les cartes si leur forme a changé.

**Historique** : avant le 2026-10-22, le marché était lu par un favori. En octobre, trois membres sur six n'avaient aucune lecture du marché (rien ne
disait que ce favori était ancien, un échec passait inaperçu, les lectures étaient effacées après 24 h). Depuis le 2026-10-22, ce favori, ses cotes
automatiques « tant que l'onglet est visible », sa clé d'import et ses routes (`POST /api/market/plan`, `prices`, `live`, `fail`) n'existent plus :
le serveur lit. La page garde les messages d'échec, l'âge de la lecture et le dernier essai.

## Règles du jeu

Les règles de WikiMasters (« Règles de la communauté » §3, CGU §6) interdisent les outils qui jouent ou **interagissent à la place du
joueur**. Le classeur ne joue pas, ne clique rien et ne pose jamais d'étiquette dans le jeu ; il n'y écrit, au clic du membre, que la
**proposition d'un échange** (depuis le 2026-10-22) et la **mise en vente** d'une carte ou l'**annulation** d'une vente sans mise (depuis le
2026-10-23) (ci-dessous). **Mais, depuis le
2026-10-22, il lit la base du jeu régulièrement et automatiquement, sans geste du joueur**, ce qu'il ne faisait pas avant : c'est un choix
assumé de l'utilisateur, décrit ici tel qu'il est.

**Ce qui se passe, exactement.**
- Les lectures partent **des adresses Cloudflare** (celles des Workers : le jeu voit des requêtes qui ne viennent ni du navigateur du
  joueur ni de son adresse), avec **une session du jeu par membre**, née dans une **fenêtre privée** puis gardée chiffrée par le serveur
  (voir « Session du jeu »). Aucune session n'est partagée avec le navigateur du joueur.
- **Collection** : toutes les **10 minutes**, le serveur vérifie la collection de chaque membre relié (une requête, `count=exact`) ; il la
  relit en entier (pages de 1 000 exemplaires, 250 ms entre deux pages) **si quelque chose a changé, et au moins toutes les 6 h** ; chaque
  vérification et chaque lecture relisent aussi son solde de wikibidous (une requête, `rpc/get_my_profile`).
- **Marché** : toutes les **20 minutes**, une passe par membre relié (cotes, enchères du membre, ventes, bonnes affaires) : **30 requêtes au plus, à
  une par seconde**, par passe.
- **Renouvellement** de la session : à chaque passage, un jeton qui expire dans moins de 2 minutes est renouvelé (`auth/v1/token`).
- Au clic du membre (« Rafraîchir », « Actualiser le marché », « Depuis le jeu »), les mêmes lectures partent aussitôt (une par minute au plus
  pour les deux premières).
- **À l'ouverture d'une fiche** (2026-10-22) : ses enchères en cours et ses ventes dans la base (2 ou 3 requêtes, 12 fiches par minute au plus), puis le
  détail des 10 enchères les moins chères sur la **route du marché du site du jeu** (`/api/marketplace/<id>`, cookie de session refait, 20 par minute au
  plus) : voir « Le marché », « Marché d'une carte ».
- **Une seule écriture, au clic** : « Proposer l'échange dans le jeu » (voir « Partage entre membres », « Proposer un échange ») crée une
  proposition en attente au nom du membre (cartes et wikibidous, d'un côté ou de l'autre), par la route du site du jeu (`POST /api/trades`) avec son cookie de session refait par le serveur. C'est
  exactement ce que ferait le joueur dans l'écran d'échange du jeu, mais **depuis le serveur, à sa place** : c'est ce que ces règles visent (« interagir
  à la place du joueur ») ; choix assumé de l'utilisateur (2026-10-22). Jamais sans clic, jamais d'acceptation, de refus ni d'annulation.
- **Demandes d'ami** (2026-10-24, choix assumé de l'utilisateur) : au clic (« Envoyer une demande d'ami », fenêtre d'échange)
  et, **sans clic**, pour un membre qui a coché « Envoyer une demande d'ami aux membres du classeur » (coupée par défaut) :
  une demande à chaque membre relié, une seule fois, pendant les lectures automatiques (voir « Amis dans le jeu »). C'est
  la **première écriture sans geste du joueur** : le jeu voit, depuis des adresses Cloudflare, une demande d'ami que le
  joueur n'a pas faite lui-même au moment où elle part. Jamais d'acceptation ni de refus. La liste d'amis est aussi lue (site du jeu, `GET /api/friends`) à l'ouverture de la
  fenêtre d'échange et avant chaque demande.
- **Liste de souhaits** (2026-10-24, demande de l'utilisateur) : pour un membre qui a coché « Mettre dans ma liste de souhaits du jeu
  les cartes qui manquent à mes collections » (coupée par défaut), le serveur **ajoute et retire des cartes de sa liste de souhaits
  du jeu sans clic** (table `wishlist_items` de la base du jeu, comme le bouton d'une carte du jeu), après un enregistrement de
  collection, une synchro ou pendant les lectures automatiques : jusqu'à des centaines de cartes par passe, en lots de 100 (voir
  « Liste de souhaits du jeu »). Seconde écriture sans geste du joueur, plus visible que les demandes d'ami (en nombre).
- **Vendre, au clic** (2026-10-23, choix assumé de l'utilisateur) : « Mettre en vente dans le jeu » met un exemplaire aux enchères au nom du membre
  (`POST /api/marketplace` du site du jeu), et « Annuler la vente » retire une de ses ventes tant que personne n'a misé (`DELETE
  /api/marketplace/<id>`, après une relecture de l'enchère). Même chemin que l'échange (cookie refait, depuis le serveur, une seule tentative),
  donc la même exposition à ces règles ; ces routes du marché du site sont celles qui renvoient `automation_limit`, et le jeu peut aussi demander
  une vérification anti-robot (la vente se fait alors dans le jeu). Jamais sans clic, jamais de baisse de prix.
- **Miser, au clic** (2026-10-26, demande de l'utilisateur) : « Miser … dans le jeu » place une mise au nom du membre (`POST
  /api/marketplace/<id>/bid` du site du jeu, après une relecture de l'enchère), comme dans l'écran d'une enchère du jeu. Même chemin et même
  exposition que « Vendre ». Une mise engage le membre (il achète si personne ne surenchérit) et le jeu retient le montant sur son solde.
  Jamais sans clic, une mise par clic, jamais de surenchère automatique.
- **Aucune imitation de navigateur** : pour les lectures, les en-têtes sont `apikey` (clé publique du jeu), `Authorization: Bearer` (la session du
  membre) et `Accept` ; le `User-Agent` est celui de la plateforme, pas celui d'un navigateur.
- Pour 50 membres reliés, c'est au plus de l'ordre de 4 500 requêtes par heure vers le jeu pour le marché, plus une vérification par membre toutes
  les 10 minutes pour la collection.

**Ce que le jeu peut voir.** Des requêtes régulières à heures fixes (toutes les 10 et 20 minutes), venant d'adresses de centre de données, avec le
jeton de chaque membre relié ; des lectures de ses tables (`user_cards`, `cards`, `user_card_tags`, `tags`, `profiles`, `auctions`, `auction_bids`) par
la clé publique et la session du joueur, **y compris quand le joueur ne joue pas**. Il peut y voir un outil automatique et le juger contraire à ses
règles : la session d'un membre peut être fermée, ou son compte sanctionné. Le marché est le plus exposé : lire la base au lieu des pages du
site, c'est contourner la limite de 30 requêtes par minute de la route des ventes (`/api/marketplace/cards/<id>/sales`), qui est une mesure anti-
automatisation ; on reste très en dessous de ce qu'un client direct pourrait faire (30 requêtes par passe, chacune pour 100 cartes), mais c'est une lecture
régulière et automatique, ce que ces règles visent le plus directement. Le détail des enchères d'une fiche (2026-10-22, choix de l'utilisateur) passe,
lui, **par cette route du site** (`/api/marketplace/<id>`), depuis des adresses Cloudflare, jusqu'à 10 lectures par fiche ouverte : c'est elle qui
renvoie `automation_limit` ; le classeur se met alors en pause 10 minutes pour ce membre.

**Ce que ça change par rapport à la règle d'avant.** Avant le 2026-10-22, toute lecture du jeu suivait un geste du joueur (le clic sur l'ancien favori de
synchro, « Synchroniser », une action vue dans le jeu), avec une seule exception depuis le 2026-10-17 : les cotes automatiques de l'ancien favori, tant
qu'un onglet du jeu relié était visible (6 par heure au plus). Le classeur lisait **dans la page du joueur, avec la session qu'elle avait déjà**, et ne
gardait aucune session du jeu sur le serveur. Le 2026-10-22, l'utilisateur a choisi la lecture par le serveur, avec session gardée, sans geste : depuis
cette date, plus de favori de synchro, de clé d'import ni de script Tampermonkey.

**Garde-fous** (voir « Lectures automatiques » pour les détails) :
- **Limite du jeu** (`429`, ou `automation_limit`) : la passe s'arrête aussitôt (aucun autre membre n'est lu) et la passe suivante est sautée
  (15 min pour la collection, 25 min pour le marché) ; ce n'est pas un échec du membre.
- **Trois échecs d'affilée** : le membre est mis en pause, jusqu'à un « Rafraîchir » réussi ou une nouvelle liaison.
- **Session révoquée** (déconnexion du jeu, jeton réutilisé ailleurs) : le membre est « à relier » et n'est plus lu.
- **« Synchro automatique »**, case par membre (cochée par défaut) : décochée, plus rien n'est lu sans clic.
- **`SYNC_PAUSED`**, variable du Worker : suspend **tous** les déclencheurs d'un coup (voir SETUP.md, « Si le jeu limite les lectures »).
- Un seul bail par membre : jamais deux lectures en même temps avec la même session ; une lecture non vérifiée n'efface jamais de cartes.
- Ne sont lus que : la propre collection du membre et son profil (pseudo), ses mises et ses ventes, les cartes qui manquent à ses collections, les
  ventes conclues et les enchères en cours sur les cartes qui le concernent (données publiques du marché : le classeur ne garde ni vendeur ni
  enchérisseur ; le pseudo du vendeur et du meneur d'une enchère, que montre la page du jeu, est montré dans la fiche sans être gardé) ; jamais le
  profil ni la collection d'un autre joueur.

**Ce qui n'a pas changé.** Les étiquettes et les collections vivent dans le classeur. Aucun champ rempli à la place du joueur : « Copier le nom »
(fiche d'une carte, fiche et icône d'une case vide) met le titre dans le presse-papiers, et c'est le joueur qui le colle dans la recherche du jeu.
Depuis le 2026-10-22 (choix de l'utilisateur), une enchère en cours (fiche, onglet « Marché ») a un **lien** « Ouvrir dans le jeu ↗ » vers sa page du
jeu : un simple lien, que le joueur suit ; il mise ou achète là-bas. Toute la case vide ouvre la fiche de la carte manquante (description, rareté estimée, vues, collections,
« Copier le nom » si l'article est vérifié, Wikipédia). Mises et achats se font dans le jeu, par le joueur ; seules la mise en vente et son
annulation partent du classeur, au clic (ci-dessus).
