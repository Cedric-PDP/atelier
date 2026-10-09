# Journal de parties SPAM

Page : https://claude.ai/artifact/WSVR5uVuFT9SMAa9WSaqpL : **le seul journal de parties** (décision du 2026-10-09).
Capacités : `db`, `user`, `assets`, `sample` avec images. Les parties envoyées depuis le PC perso (replays du jeu,
captures F12 de Steam) y sont aussi écrites, par Claude (voir « Depuis le PC perso ») : **le schéma ci-dessous est
un contrat**. On peut ajouter des champs facultatifs, jamais renommer ni retirer un champ.

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
| `page/smoke_journal.js` | `node journal/page/smoke_journal.js journal/journal-spam.html` : rend les 5 vues sur un faux DOM avec une fausse base, simule une analyse de captures et son enregistrement, une saisie manuelle et l'affichage d'une partie importée (avec son `source`). Il vérifie aussi la consigne d'analyse (statut du savoir, questions sur le ban, absorption, tour 20) et tous les champs de `bans`. Doit finir par `SMOKE OK`. À lancer avant chaque remise du fichier. |

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
3. **Depuis le PC perso** : l'utilisateur envoie les fichiers du jeu (replays) et ses captures sur la branche
   GitHub `pc-perso` ; Claude les passe dans le Journal (section « Depuis le PC perso »), avec la même procédure.

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
- `source` : `captures` = analysée dans la page ; `manuel` = saisie à la main ; `pc-perso@<sha7>` = importée
  depuis le PC perso (`<sha7>` = le commit d'envoi sur la branche `pc-perso`). La page l'affiche
  (« import « … » ») dans la liste et sous la partie.
- `screens` : un id d'asset du Journal, affiché via `/_blob/<id>`. Une valeur qui contient `/` ou `:` est prise
  telle quelle comme URL, au cas où l'ajout d'une capture rendrait une URL (voir « Depuis le PC perso »).
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

## Depuis le PC perso

Les pages claude.ai ne s'ouvrent pas sur le PC perso : le Pont ne sert plus (son schéma `imports/<id>` reste dans
l'historique git, commit `c92c676`). Les envois passent par la branche GitHub `pc-perso`. Le transport (zip, message
du commit, `REPONSE.md`, dossier `lus/`) et le format des fichiers du jeu sont décrits dans le CLAUDE.md du dépôt,
section « Le PC perso ». Ici, seulement ce qui touche le Journal.

1. **Replays** (`LocalLow\Ticroco\Spam\replays\<serveur>\<compte>\index.json`) : une entrée par partie, donc une
   partie du Journal par entrée.
   - Cartes : les uuid de `MyCards` / `OpponentCards` sont les `id` de `spam/versions/<v>/js/model.json` ; le numéro
     est son champ `number`.
   - `result` : `N` si `IsDraw`, sinon `V` si `WinnerId` = `AccountId`, sinon `D`. `opp.name` = `OpponentName`.
     `mode` : `GameMode` 0 (Casual) = `normal`. `turns` = `TurnCount`. `date` = `StartUtc` (ISO). `Seat` n'est pas encore relié à `first`.
   - Id : `AAAA-MM-JJ-HHMM-xxxx`, à l'heure de Paris, `xxxx` = les 4 derniers chiffres du numéro du replay
     (`match-<n>.srpl`).
   - Tant que les `.srpl` ne sont pas décodés : `evidence.coverage` dit « en-tête du replay », et `gaps` couvre
     tous les tours (`how` = replay pas encore décodé).
   - Ne jamais recopier les `ticket` de partie de l'index ou du journal du jeu.
2. **`Player.log`** (dernière session du jeu) : achats en boutique et abandon (`Client resign`), à mettre dans `note`
   tant que le replay n'est pas décodé.
3. **Captures** : Steam les nomme `AAAAMMJJHHMMSS_n.jpg` (copie non compressée : `2902720_AAAAMMJJHHMMSS_n.png`), à
   l'heure **locale** du PC de jeu. Les trier par heure. Une nouvelle partie commence à un écran de tour 1 ou de
   choix du deck, ou après plus de 15 minutes sans capture (seuil indicatif) ; un écran de fin la termine. Les
   rattacher au replay de même heure, s'il existe. Vérifier sur les images.
4. Analyser chaque partie selon la procédure ci-dessus.
5. Ajouter les captures aux assets du Journal : `Artifact` publish avec `url` = le Journal, `asset: true` et
   `file_path` = le fichier extrait. Mettre dans `screens` ce que rend l'envoi : l'id (affiché via `/_blob/<id>`),
   ou sinon l'URL, telle quelle. **À vérifier au premier ajout** : la vignette doit s'afficher dans la page ; noter
   ici la forme exacte.
6. Écrire la partie dans `matches/<id>` : `source` = `pc-perso@<sha7 du commit d'envoi>`, les cartes en **numéros**,
   `evidence.screens` = le nombre de captures. Si la partie existe déjà (importée depuis l'index), la compléter
   avec `update` et `if_version`.
7. Répondre à l'utilisateur dans `REPONSE.md` de la branche `pc-perso` (pas dans la base du Pont).

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
