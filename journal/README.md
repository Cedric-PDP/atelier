# Journal de parties SPAM

Page : https://claude.ai/artifact/WSVR5uVuFT9SMAa9WSaqpL : **le seul journal de parties** (décision du 2026-10-09).
Capacités : `db`, `user`, `assets`, `sample` avec images. Les parties envoyées par la page Pont (fichiers du jeu,
captures F12 de Steam) y sont aussi écrites, par Claude (voir « Depuis le Pont ») : **le schéma ci-dessous est un
contrat**. On peut ajouter des champs facultatifs, jamais renommer ni retirer un champ.

- Pas de tier des cartes, nulle part (demande de l'utilisateur).
- L'utilisateur préfère les decks réguliers, peu dépendants des critiques.
- **Publication : seule la session orchestratrice publie les pages SPAM.** Les autres sessions construisent
  `journal/journal-spam.html` et lui envoient le chemin, avec 3 lignes sur ce qui change. Les données (`db`)
  ne sont pas concernées : toute session peut lire et écrire les parties avec `ArtifactData`.

## Fichiers

| Chemin | Rôle |
|---|---|
| `journal-spam.html` | page prête à publier (sortie de `page/build_page.js`) |
| `page/journal-src.html` | source de la page, avec `<!--CARDS-->` et `<!--TOX-->` à la place des données |
| `page/build_page.js` | `node journal/page/build_page.js journal/journal-spam.html` insère `ref/cards.json` et les 40 familles de Tox du shop (tirées de `ref/tox.json`) dans la page. Un fichier .json publié à côté de la page est bloqué par une règle de lecture, d'où l'insertion. |
| `page/build_ref.js` | `node journal/page/build_ref.js spam/versions/1.21/js/model.json` régénère `ref/cards.json` et `ref/cards_fr.txt` |
| `ref/cards.json` | les 127 cartes en 1.21 : numéro, nom FR/EN, élément, rareté, PV, Spamtons, résistances, capacités, passifs, talents, possession |
| `ref/cards_fr.txt` | la même chose en texte, pour lire les captures (`grep -A8 "^#<n> " journal/ref/cards_fr.txt`) |
| `ref/tox.json` | les 101 Tox (nom FR, rareté, coût, texte) |
| `ref/collection.txt` | les numéros des cartes possédées (à tenir à jour avec `spam/mine.txt`) |
| `page/smoke_journal.js` | `node journal/page/smoke_journal.js journal/journal-spam.html` : rend les 5 vues sur un faux DOM avec une fausse base, simule une analyse de captures et son enregistrement, une saisie manuelle et l'affichage d'une partie importée du Pont. Il vérifie aussi la consigne d'analyse (statut du savoir, questions sur le ban, absorption, tour 20) et tous les champs de `bans`. Doit finir par `SMOKE OK`. À lancer avant chaque remise du fichier. |

Publier, pour la session orchestratrice : `Artifact` publish avec `file_path` = `journal/journal-spam.html`, `url`
= celle ci-dessus, **sans** `capabilities` (pour garder la déclaration actuelle).

## Trois façons d'analyser une partie

1. **Dans la page** (onglet Parties, « Analyser une partie ») : l'utilisateur dépose ses captures. La page appelle
   Claude avec `sample` (tier `complex`, images) et la fiche des 127 cartes, puis affiche un brouillon avec une
   certitude par tour. L'utilisateur corrige et enregistre : les captures vont dans `assets` et leurs ids dans
   `screens`.
2. **Dans Claude Code** (analyse approfondie des captures collées dans le chat) : suivre la procédure ci-dessous,
   puis écrire avec `ArtifactData` (`set` sur `matches/<id>`, puis `knowledge` et `archetypes`). Toujours lire
   l'état d'abord (`list` des 3 collections) et passer `if_version` sur tout document existant.
3. **Depuis le Pont** : l'utilisateur envoie ses fichiers et ses captures sur la page Pont ; Claude les passe dans
   le Journal (section « Depuis le Pont »), avec la même procédure.

La consigne envoyée par la page (`buildPrompt` dans `page/journal-src.html`) reprend cette procédure. Elle joint
toutes les fiches `knowledge` non réfutées (sauf `jeu`), chacune précédée de son statut : une `hypothèse` y est
présentée comme à vérifier, jamais comme un fait.

## Procédure d'analyse

1. Lire chaque capture : le tour, les 4 cartes de chaque camp, les PV, les recharges, les bonus élémentaires, les
   Spamtons, l'offre de boutique, l'écran de fin. Identifier les cartes dans `ref/cards_fr.txt`. Une carte illisible
   va dans `unknown`, jamais sous un numéro deviné.
2. Combler les trous entre les captures par le calcul :
   - une recharge n veut dire « tous les n tours » ; au départ, le premier joueur a −1 et le second −2 ;
   - un écart de PV = dégâts × (1 + 0,1 × bonus) × (1 − résistance) ;
   - les revenus = les Spamtons des cartes vivantes + le numéro du tour, et +50 par carte perdue ;
   - la boutique ouvre aux tours pairs.
3. Donner une certitude `c` (0 à 100) à chaque ligne déduite, avec le même barème que la page :
   - 100 : lu sur une capture ;
   - 85 à 99 : imposé par les chiffres (une seule explication possible) ;
   - 60 à 84 : l'explication la plus probable ;
   - moins de 60 : une supposition.

   `basis` dit sur quoi la ligne s'appuie. Ne jamais présenter une déduction comme vue.
4. Erreurs : seulement celles que les captures ou les chiffres prouvent. Catégories : `ordre`, `ciblage`, `tempo`,
   `boutique`, `economie`, `defense`, `lecture`, `deck`, `ban`. Coût : `élevé`, `moyen` ou `faible`.
5. Comparer au plan du moteur (Atelier, sections Plan de jeu et Boutique) quand le deck de l'utilisateur y figure.
6. Relever les **bans du shop** dans `bans` : chaque joueur bannit 1 élément du shop (une Tox), retiré du shop pour
   les deux. Noter la Tox de chaque camp, et sa rareté si elle se lit. Plusieurs règles du ban sont encore
   inconnues ; les relever dès qu'une capture les montre, et les signaler à la session orchestratrice :
   - une fois par partie ou à chaque boutique (`phase`) ;
   - les deux bans sont-ils simultanés (`order`) ;
   - voyait-on déjà les 4 cartes adverses au moment de bannir (`sawOpp`) ;
   - la Tox bannie revient-elle plus tard (`lasts`), et ses autres raretés restent-elles proposées (`rarity`) ;
   - ce que montrent l'écran de ban (liste proposée), le ban adverse juste après et la boutique suivante (`seen`).

   Le ban d'une **carte** du deck n'a jamais été observé (peut-être réservé au Classé) : l'ignorer, et le signaler
   à l'orchestratrice si une capture en montre un.
7. Relever aussi, quand une capture les montre, les autres règles inconnues (dans la `note` du tour et dans
   `knowledge`) :
   - **absorption** (Veuve noire de Tisseuse de Mots, #123 ; Avalement de Régent des Abysses, #86, sur un allié) :
     les PV de la carte absorbée et de la Tisseuse juste avant et juste après, si la prime de 50 Spamtons a été
     versée et à qui, si Cimetière, Vengeur ou un effet « à la mort d'un allié » a réagi ;
   - **prolongation** : ce qui change à partir du tour 20, et à quel tour exactement.
8. Écrire la partie. Ensuite, un fait nouveau va dans `knowledge` en `hypothèse`, avec `evidence:[matchId]`. Une
   hypothèse vue dans au moins 2 parties devient `confirmé` ; une hypothèse contredite devient `réfuté`.
   L'analyse de la page peut créer une fiche au même titre (`subject`) qu'une hypothèse existante, avec un texte
   qui commence par « Appuie : » ou « Contredit : ». La fondre dans la fiche d'origine (ajouter la partie à
   `evidence`, changer le statut si besoin), puis supprimer le doublon.
9. Archétypes : quand un cœur de cartes adverse hors archétype revient au moins 2 fois, créer un archétype
   `émergent`. À partir de 5 parties, il passe `établi`. Dès qu'un archétype a été croisé 3 fois, calculer ses
   `bestAnswers` (voir Contre-méta).
10. Rendre à l'utilisateur 3 à 5 lignes : le résultat, le tournant, l'erreur qui a le plus coûté, la leçon, le lien.

## Schéma de la base (contrat)

`matches/<AAAA-MM-JJ-HHMM-xxxx>` :
```
date (ISO), mode ("classé"|"normal"|"défi"|"inconnu"), result ("V"|"D"|"N"|null), resultCertainty, first (bool|null),
firstCertainty, turns, source ("captures"|"manuel"|<nom de l'import>), createdAt,
my {deck, cards:[n°], unknown:[noms]}, opp {name, cards:[n°], unknown:[noms], archetype:<id>|null, certainty},
timeline [{t, me, opp, note, inferred, c, basis}], gaps [{turns, how, c}],
shop [{t, who:"me"|"opp", tox, pass, on:n°|null, replaced, c}],
turningPoint, summary, mistakes [{t, cat, what, better, cost, c}], goodPlays [{t, what}], lessons [texte],
screens [ids d'assets ou URL], screensRead [{i, turn, shows}], evidence {screens, coverage, confidence},
note, my.notes                                   ← FACULTATIFS
bans {mine, theirs, c, phase, order}             ← FACULTATIF (ajouté le 2026-10-09, absent des documents plus anciens)
bans {rarity {mine, theirs}, sawOpp, lasts, seen} ← FACULTATIFS (ajoutés le 2026-10-09, second lot)
```
- `source` : `captures` = analysée dans la page ; `manuel` = saisie à la main ; sinon le nom de l'import du Pont,
  c'est-à-dire l'id du document `imports/<id>` (ex. `2026-10-09T18-24-00-123Z`). La page l'affiche
  (« import « … » ») dans la liste et sous la partie.
- `screens` : un id d'asset du Journal, affiché via `/_blob/<id>`. Une valeur qui contient `/` ou `:` est prise
  telle quelle comme URL : c'est pour l'URL rendue par une copie côté serveur (voir « Depuis le Pont »).
- `note` : le texte libre de la saisie manuelle (« Ce qui s'est passé »). Une partie saisie à la main n'a ni
  `timeline` ni `evidence`, et `opp` n'y a que `cards` et `unknown`.
- `my.notes` : un commentaire sur mon deck, affiché sous ses cartes. La page ne l'écrit pas.

`bans` : seuls les champs connus sont écrits ; un champ absent, `null` ou une chaîne vide veut dire « inconnu ».
- `mine` / `theirs` : la famille de Tox bannie, par son id sans suffixe de rareté (`Multiplicator`, `Berserk`,
  `Tenacite`… : les clés de `ref/tox.json` sans `_C/_R/_E/_L`), ou le nom lu tel quel si la famille n'a pas été
  reconnue. `null` si inconnu.
- `c` : la certitude sur ces deux Tox (100 en saisie manuelle dès qu'une Tox est choisie).
- `rarity` : `{mine, theirs}`, chacun `C`, `R`, `E`, `L` ou `null`. 21 des 40 familles existent en plusieurs
  raretés, et l'on ne sait pas encore si le ban vise toute la famille ou une seule rareté : la famille reste dans
  `mine` / `theirs`, la rareté lue va ici. Absent si aucune rareté n'a été lue.
- `phase` : le moment du ban, en texte (`une fois, avant le tour 1`, `une fois, à la première boutique`,
  `à chaque boutique`…).
- `order` : `simultané`, `moi d'abord` ou `l'adversaire d'abord`.
- `sawOpp` : `true` si les 4 cartes adverses étaient visibles au moment de bannir, `false` sinon.
- `lasts` : la durée du ban, `toute la partie` ou `la boutique en cours seulement`.
- `seen` : ce que les captures montrent du ban (écran de ban et liste proposée, ban adverse, boutique suivante),
  avec leurs numéros. Écrit par l'analyse.

`knowledge/<id>` : `kind` (mécanique|économie|carte|tox|adversaire|méta|jeu), `subject`, `text`,
`status` (confirmé|hypothèse|réfuté), `source`, `evidence:[ids de parties]`, et deux champs facultatifs :
`cards:[n°]` (absent ou vide sur la plupart des fiches de règles : 20 des 23 premières fiches n'en ont pas) et
`createdAt` (ISO, écrit par la page sur les fiches tirées d'une analyse, avec `source: "analyse de captures"`).

`archetypes/<id>` : `name`, `status` (théorique|émergent|établi), `core:[n°]` (au moins 2 cartes en commun suffisent
pour rattacher un adversaire), `flex:[n°]`, `plan`, `counters:[texte]`, `bestAnswers:[{cards:[n°], why}]`, `source`,
`updatedAt`, et facultatif `ban: {tox, why, status}` (l'élément du shop à lui bannir en priorité ; `tox` = id de
famille comme ci-dessus, `status` = `hypothèse` tant que de vraies parties ne l'ont pas confirmé).

Les cartes sont toujours des **numéros** (le `n` de `ref/cards.json`).

## Depuis le Pont

Le Pont (https://claude.ai/artifact/6hFsmpioodoRQFGjstecxc, source `pont/pont-spam.html`) a **sa propre base**,
séparée de celle du Journal. L'utilisateur y dépose des dossiers de son PC de jeu. La page envoie les fichiers
cochés dans ses `assets` et écrit un inventaire dans `imports/<id>`. Rien ne passe seul dans le Journal : c'est
Claude qui le fait, selon cette section. Le Pont évolue : en cas de doute, `buildDoc` et `uploadOne` dans
`pont/pont-spam.html` font foi (état décrit ici : 2026-10-09).

### Un document `imports/<id>`

L'id est l'heure d'envoi en ISO, avec `:` et `.` remplacés par `-` (ex. `2026-10-09T18-24-00-123Z`). C'est le
« nom de l'import », repris dans `source` des parties.

| Champ | Contenu |
|---|---|
| `createdAt` | l'heure d'envoi (ISO) |
| `note` | le mot de l'utilisateur pour Claude (4 000 caractères au plus) |
| `roots` | les dossiers déposés : premier élément des chemins, 20 au plus |
| `engine` | les moteurs reconnus dans l'installation : `Unity`, `Unity (IL2CPP)`, `Godot`, `Electron`, `Unreal` |
| `counts` | `{files, relevant, sent, failed}` : fichiers lus, utiles, envoyés, en échec |
| `steam` | `{appid: "2902720", accounts, manifest, screenshots}` |
| `steam.accounts` | par numéro de dossier `userdata` : `{playtimeMin, playtime2wksMin, lastPlayed}` (`lastPlayed` en ms). Lu sur place dans `localconfig.vdf`, qui ne part jamais |
| `steam.manifest` | `{buildid, lastUpdated, sizeOnDisk, installdir}`, tiré de `appmanifest_2902720.acf`, ou `null` |
| `steam.screenshots` | le nombre de captures F12 de SPAM trouvées (pas forcément envoyées) |
| `pastedPaths` | les chemins `C:\…` collés depuis la commande PowerShell de la page (200 au plus) |
| `files` | les fichiers utiles, cochés ou envoyés (500 au plus), voir ci-dessous |
| `status` | `à lire` à l'envoi |
| `truncated` | `true` si l'inventaire dépassait 240 000 caractères : `files` ne garde alors que les fichiers envoyés, sans `sig` |
| `readAt` | posé par Claude après lecture ; la page affiche alors « lu par Claude » |

Un élément de `files` : `{path, size, mtime, kind, why}`, plus selon le cas `assetId`, `sentAs`, `error`, `sig`,
`reg` et `shotAt`.
- `path` : le chemin depuis le dossier déposé, avec des `/`. `mtime` : la date de modification, en ms (UTC).
- `kind` : `capture` (F12 de SPAM : sous `760/remote/2902720/screenshots/` hors vignettes, ou reconnue au nom
  que lui donne Steam, ou image choisie à la main), `image`, `texte`, `json`, `sqlite`, `leveldb`, `binaire`,
  `registre` (export `.reg`), `steam` (lu sur place), `exclu` (fichier sensible, jamais lu), `vide`, `non lu`,
  `illisible`.
- `shotAt` (captures) : l'heure tirée du nom Steam, `AAAA-MM-JJTHH:MM:SS`, heure **locale** du PC, sans fuseau.
- `reg` (registre) : `{keys, values, names, masked}`, les clés, le nombre de valeurs, leurs noms et le nombre de
  valeurs de connexion masquées avant l'envoi.
- `why` : une seule chaîne, raisons séparées par ` · `.
- `assetId` : l'id de l'asset dans la base du Pont, si le fichier est parti. `sentAs` : son type à l'envoi.
  `error` : le code d'erreur, si l'envoi a échoué.
- `sig` (binaires, SQLite, LevelDB) : `{head, strings}`, les 32 premiers octets en hexadécimal et jusqu'à 12
  chaînes lisibles qui contiennent un mot de partie (deck, carte, rang…).

Ce que contient un asset envoyé :
- capture ou image : l'image telle quelle (`image/jpeg`, `image/png`…) ;
- texte ou registre : le texte réencodé en UTF-8, en `text/plain`, `application/json`, `text/csv` ou
  `text/markdown` (registre : valeurs de connexion masquées) ;
- SQLite : la base **convertie en JSON** `{source: "sqlite", tables: {<table>: {columns, rows}}}`, 5 000 lignes
  par table au plus, chaque BLOB remplacé par `{blobBytes}`. Si la conversion échoue, le fichier part comme un
  binaire ;
- binaire ou LevelDB : le contenu **en base64**, sous `text/plain` (14 Mo au plus avant encodage). Le décoder
  avant toute lecture.

Lire un asset depuis Claude Code : `Artifact` `read` avec `url` = le Pont et `path` = l'`assetId` (32 caractères
hexadécimaux). Le fichier est enregistré en local.

### Passer un import dans le Journal

1. Lire l'import (`ArtifactData` `get` sur `imports/<id>`, base du Pont), puis les assets utiles. Si un fichier du
   jeu contient l'historique des parties, c'est la meilleure source : une partie par entrée. Quand son format sera
   connu, ajouter un lecteur au Pont.
2. Regrouper les captures en parties. Steam les nomme `AAAAMMJJHHMMSS_n.jpg` (copie non compressée :
   `2902720_AAAAMMJJHHMMSS_n.png`), à l'heure **locale** du PC de jeu, reprise dans `shotAt` ; `mtime`, en UTC,
   donne le fuseau. Les trier par heure. Une nouvelle partie commence à un écran de tour 1 ou de
   choix du deck, ou après plus de 15 minutes sans capture (seuil indicatif) ; un écran de fin la termine.
   Vérifier sur les images.
3. Analyser chaque partie selon la procédure ci-dessus. `date` = l'heure de la première capture, en ISO.
4. Copier les captures de la partie dans le Journal, côté serveur : `Artifact` publish avec `url` = le Journal,
   `asset: true`, `from_url` = le Pont et `asset_ids` = leurs `assetId` (10 par appel au plus). Mettre dans
   `screens` ce que rend la copie : l'id de la copie (la page l'affiche via `/_blob/<id>`), ou sinon l'URL rendue,
   telle quelle. **À vérifier à la première copie** : la vignette doit s'afficher dans la page ; noter ici la
   forme exacte.
5. Écrire la partie dans `matches/<AAAA-MM-JJ-HHMM-pxxxx>` : `source` = l'id de l'import, les cartes en
   **numéros**, `evidence.screens` = le nombre de captures.
6. Dans la base du Pont : poser `readAt` (ISO) sur l'import (`update`, avec `if_version`), puis répondre dans
   `orchestrator/status` : `{updatedAt, headline, points[], asks[]}`, affiché en haut du Pont.

## Contre-méta

1. Partir de la collection (`ref/collection.txt`, à tenir à jour avec `spam/mine.txt`).
2. Construire le profil de l'archétype adverse : PV moyens, résistances par élément, éléments d'attaque, et le
   tour de son pic (d'après les recharges de ses grosses capacités).
3. Retenir les decks qui :
   - frappent dans ses résistances faibles ;
   - résistent à ses éléments ;
   - battent son pic : un deck rapide contre un moteur lent, Brut contre Provocation, Gel ou Éternité contre une
     grosse recharge (sauf sur les cartes à Immunité) ;
   - dépendent peu des critiques.
4. Le moteur du wiki note un deck face à des profils `{cardHp, resist, extra}` (mode d'emploi dans le CLAUDE.md du
   dépôt). Utiliser la version du jeu en cours : `spam/versions/<v>/js/` (`simulation.js` + `model.json`, créés par
   `node scripts/app/fetch_version.js <racine du dépôt>`), pas l'instantané 1.20 de `spam/js/`.
5. `spam/versions/<v>/meta_decks.json` donne les decks les mieux classés par le wiki (en numéros) : la méta
   attendue avant d'avoir des parties réelles.
