# Journal de parties SPAM

Page : https://claude.ai/artifact/WSVR5uVuFT9SMAa9WSaqpL : **le seul journal de parties** (décision du 2026-10-09).
Capacités : `db`, `user`, `assets`, `sample` avec images. Une page « pont » (import depuis le PC perso : fichiers du
jeu, captures F12 de Steam) y écrit aussi : **le schéma ci-dessous est un contrat**. On peut ajouter des champs
facultatifs, jamais renommer ni retirer un champ.

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
| `page/smoke_journal.js` | `node journal/page/smoke_journal.js journal/journal-spam.html` : rend les 5 vues sur un faux DOM avec une fausse base, simule une analyse de captures et son enregistrement, et doit finir par `SMOKE OK`. À lancer avant chaque remise du fichier. |

Publier, pour la session orchestratrice : `Artifact` publish avec `file_path` = `journal/journal-spam.html`, `url`
= celle ci-dessus, **sans** `capabilities` (pour garder la déclaration actuelle).

## Deux façons d'analyser une partie

1. **Dans la page** (onglet Parties, « Analyser une partie ») : l'utilisateur dépose ses captures. La page appelle
   Claude avec `sample` (tier `complex`, images) et la fiche des 127 cartes, puis affiche un brouillon avec une
   certitude par tour. L'utilisateur corrige et enregistre : les captures vont dans `assets` et leurs ids dans
   `screens`.
2. **Dans Claude Code** (analyse approfondie des captures collées dans le chat) : suivre la procédure ci-dessous,
   puis écrire avec `ArtifactData` (`set` sur `matches/<id>`, puis `knowledge` et `archetypes`). Toujours lire
   l'état d'abord (`list` des 3 collections) et passer `if_version` sur tout document existant.

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
   Relever les **bans du shop** : chaque joueur bannit 1 élément du shop (une Tox), retiré du shop pour les deux.
   Noter, quand une capture le montre, le moment du ban (`phase`) et s'il est simultané (`order`) : ce sont encore
   des inconnues, à signaler à la session orchestratrice. Le ban d'une **carte** du deck n'a jamais été observé
   (peut-être réservé au Classé) : l'ignorer, et le signaler à l'orchestratrice si une capture en montre un.
6. Écrire la partie. Ensuite, un fait nouveau va dans `knowledge` en `hypothèse`, avec `evidence:[matchId]`. Une
   hypothèse vue dans au moins 2 parties devient `confirmé` ; une hypothèse contredite devient `réfuté`.
7. Archétypes : quand un cœur de cartes adverse hors archétype revient au moins 2 fois, créer un archétype
   `émergent`. À partir de 5 parties, il passe `établi`. Dès qu'un archétype a été croisé 3 fois, calculer ses
   `bestAnswers` (voir Contre-méta).
8. Rendre à l'utilisateur 3 à 5 lignes : le résultat, le tournant, l'erreur qui a le plus coûté, la leçon, le lien.

## Schéma de la base (contrat)

`matches/<AAAA-MM-JJ-HHMM-xxxx>` :
```
date (ISO), mode ("classé"|"normal"|"défi"|"inconnu"), result ("V"|"D"|"N"|null), resultCertainty, first (bool|null),
firstCertainty, turns, source ("captures"|"manuel"|<import>), createdAt,
my {deck, cards:[n°], unknown:[noms]}, opp {name, cards:[n°], unknown:[noms], archetype:<id>|null, certainty},
timeline [{t, me, opp, note, inferred, c, basis}], gaps [{turns, how, c}],
shop [{t, who:"me"|"opp", tox, pass, on:n°|null, replaced, c}],
turningPoint, summary, mistakes [{t, cat, what, better, cost, c}], goodPlays [{t, what}], lessons [texte],
screens [ids d'assets, affichés via "/_blob/<id>"], screensRead [{i, turn, shows}], evidence {screens, coverage, confidence},
bans {mine, theirs, c, phase, order}   ← FACULTATIF (ajouté le 2026-10-09, absent des documents plus anciens)
```
`bans.mine` / `bans.theirs` : la famille de Tox bannie, par son id sans suffixe de rareté (`Multiplicator`,
`Berserk`, `Tenacite`… : les clés de `ref/tox.json` sans `_C/_R/_E/_L`), ou le nom lu tel quel si la famille n'a
pas été reconnue. `null` si inconnu.
`knowledge/<id>` : `kind` (mécanique|économie|carte|tox|adversaire|méta|jeu), `subject`, `text`,
`status` (confirmé|hypothèse|réfuté), `source`, `cards:[n°]`, `evidence:[ids de parties]`.

`archetypes/<id>` : `name`, `status` (théorique|émergent|établi), `core:[n°]` (au moins 2 cartes en commun suffisent
pour rattacher un adversaire), `flex:[n°]`, `plan`, `counters:[texte]`, `bestAnswers:[{cards:[n°], why}]`, `source`,
`updatedAt`, et facultatif `ban: {tox, why, status}` (l'élément du shop à lui bannir en priorité ; `tox` = id de
famille comme ci-dessus, `status` = `hypothèse` tant que de vraies parties ne l'ont pas confirmé).

Les cartes sont toujours des **numéros** (le `n` de `ref/cards.json`).

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
