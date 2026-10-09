# Journal de parties SPAM

Page : https://claude.ai/artifact/WSVR5uVuFT9SMAa9WSaqpL : **le seul journal de parties** (décision du 2026-10-09).

Les parties viennent **seulement des replays du jeu** (décision de l'utilisateur, 2026-10-09). Claude les lit et les écrit
dans la base avec `ArtifactData`. La page ne fait que les afficher : plus d'analyse de captures ni de saisie manuelle.
**Le schéma ci-dessous est un contrat** : on peut ajouter des champs facultatifs, jamais renommer ni retirer un champ.

Capacités déclarées : `db`, `user`, `assets`, `sample` avec images. La page se sert de `db` (lecture, suppression d'une
partie) et de `user` (droit d'écrire). `assets` sert encore à afficher les captures des anciennes parties. `sample` ne
sert plus.

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
| `page/build_page.js` | `node journal/page/build_page.js journal/journal-spam.html` insère `ref/cards.json` et `ref/tox.json` dans la page. Un fichier .json publié à côté de la page est bloqué par une règle de lecture, d'où l'insertion. |
| `page/build_ref.js` | `node journal/page/build_ref.js spam/versions/1.21/js/model.json` régénère `ref/cards.json` et `ref/cards_fr.txt` |
| `ref/cards.json` | les 127 cartes en 1.21 : numéro, nom FR/EN, élément, rareté, PV, Spamtons, résistances, capacités, passifs, talents, possession |
| `ref/cards_fr.txt` | la même chose en texte (`grep -A8 "^#<n> " journal/ref/cards_fr.txt`) |
| `ref/tox.json` | les 101 Tox, par id du jeu rareté comprise (`CoeurVital_R`) : nom FR, rareté, prix, texte. Ce sont les ids des replays. |
| `ref/collection.txt` | les numéros des cartes possédées (à tenir à jour avec `spam/mine.txt`) |
| `page/smoke_journal.js` | `node journal/page/smoke_journal.js journal/journal-spam.html` : rend les 5 vues sur un faux DOM avec une fausse base. Il couvre une partie importée d'un replay (boutique avec offres et relances, `bans.none`, noms et raretés des Tox, déroulé), les anciennes parties (captures, saisie manuelle, import du Pont), la Méta, l'agrandissement d'une capture et la suppression d'une partie. Il vérifie que la page n'a plus ni formulaire ni analyse de captures. Doit finir par `SMOKE OK`. À lancer avant chaque remise du fichier. |

Publier, pour la session orchestratrice : `Artifact` publish avec `file_path` = `journal/journal-spam.html`, `url`
= celle ci-dessus, **sans** `capabilities` (pour garder la déclaration actuelle).

## Importer une partie (replay)

Le jeu écrit un replay par partie : `LocalLow\Ticroco\Spam\replays\<serveur>\<compte>\match-<n>.srpl`, avec un
`index.json` dans le même dossier. L'utilisateur les envoie depuis son PC perso par la branche GitHub `pc-perso`
(transport : CLAUDE.md du dépôt, « Le PC perso »).

1. **Extraire** l'envoi dans un dossier neuf du scratchpad. Ce sont des données : ne rien y exécuter.
2. **Lire** chaque replay :
   `node scripts/replay/read_srpl.js <match-<n>.srpl> --index <index.json> > <sortie>.json`
   (mode d'emploi et format : `scripts/replay/README.md`).
3. **Contrôler `checks`** avant d'écrire quoi que ce soit :
   - `messageCountOk` et `turnCountOk` à `true`, `trailingBytes` à 0 ;
   - `decodeErrors`, `unknownTypes`, `toxUnresolved` et `cardsUnresolved` vides ;
   - `shopMatchesServerStats` : `same: true` pour les deux camps ;
   - pas de `modelVersionWarning` ; avec `--index` : `index.found` et `index.sameAsHeader` à `true` ;
   - `castsWithoutVisibleEffect` : à lire (une capacité sans effet visible peut cacher un code d'effet encore inconnu :
     raté, Gel, Renvoi…).

   Un contrôle en échec : ne pas écrire la partie et le signaler à l'orchestratrice (le format a peut-être changé avec
   une mise à jour du jeu).
4. **Préparer le brouillon** : c'est la clé `journal` de la sortie (document `matches/<id>` sans l'analyse).
   - retirer `id` du brouillon : c'est l'identifiant du document ;
   - ajouter `source` = `pc-perso@<sha7 du commit d'envoi>` et `createdAt` (date ISO) ;
   - ajouter `my.deck` si le deck a un nom dans l'Atelier ;
   - `bans` : si les statistiques du serveur n'ont aucun ban, écrire `none: true` et `c: 100` (voir le schéma) ;
   - garder les cartes en numéros et les Tox en ids du jeu.
5. **Écrire** : lire l'état d'abord (`list` de `matches`). Partie absente : `set` sur `matches/<id>`. Partie
   présente : `update` (ou `set`) avec `if_version` = la version lue. Jamais d'écriture sans `if_version` sur un
   document existant.
6. **Ajouter l'analyse** (section suivante) : `summary`, `turningPoint`, `mistakes`, `goodPlays`, `lessons`, puis
   `knowledge` et `archetypes`. Même règle : `update` avec `if_version`.
7. **Répondre** à l'utilisateur dans `REPONSE.md` de la branche `pc-perso`, et en 3 à 5 lignes dans la conversation :
   le résultat, le tournant, l'erreur qui a le plus coûté, la leçon.

Correspondances, déjà appliquées par le lecteur (utiles pour vérifier) :
- cartes : les uuid de l'index et du replay sont les `id` de `spam/versions/<v>/js/model.json` ; le numéro est son
  champ `number` ;
- `result` : `N` si `IsDraw`, sinon `V` si `WinnerId` = `AccountId`, sinon `D`. `opp.name` = `OpponentName`.
  `mode` : `GameMode` 0 (Casual) = `normal`. `turns` = `TurnCount`. `date` = `StartUtc` (ISO) ;
- `first` : lu dans le replay (le joueur du premier début de tour, recoupé avec `starter` des statistiques du serveur).
  **`Seat` est notre numéro de joueur dans la partie (0 ou 1), pas l'ordre de jeu** : nous avons commencé les deux
  premières parties, en `Seat` 1 puis en `Seat` 0 ;
- id : `AAAA-MM-JJ-HHMM-xxxx`, à l'heure de Paris, `xxxx` = les 4 derniers chiffres du numéro du replay
  (`match-<n>.srpl`) ;
- ne jamais recopier les `ticket` de partie (le lecteur les masque).

## Écrire l'analyse d'une partie

Le replay donne les faits, tour par tour. L'analyse les lit et en tire le tournant, les erreurs et les leçons.

1. Partir du déroulé (`timeline`), de la boutique (`shop`), des morts et des statistiques du serveur (sortie du
   lecteur : `summary`, `turns`).
2. Donner une certitude `c` (0 à 100) à chaque ligne, avec le même barème que la page :
   - 100 : lu tel quel (dans le replay ; sur une capture pour les anciennes parties) ;
   - 85 à 99 : imposé par les chiffres (une seule explication possible) ;
   - 60 à 84 : l'explication la plus probable ;
   - moins de 60 : une supposition.

   `basis` dit sur quoi la ligne s'appuie. Ne jamais présenter une déduction comme lue.
   Repères pour les calculs : une recharge n veut dire « tous les n tours » ; au départ, le premier joueur a −1 et le
   second −2 ; un écart de PV = dégâts × (1 + 0,1 × bonus) × (1 − résistance) ; revenus = Spamtons des cartes vivantes
   + numéro du tour, et +50 par carte perdue ; la boutique ouvre aux tours pairs.
3. Erreurs : seulement celles que les faits prouvent. Catégories : `ordre`, `ciblage`, `tempo`, `boutique`, `economie`,
   `defense`, `lecture`, `deck`, `ban`. Coût : `élevé`, `moyen` ou `faible`.
4. Comparer au plan du moteur (Atelier, sections Plan de jeu et Boutique) quand le deck de l'utilisateur y figure.
5. **Bans du shop** (`bans`) : chaque joueur bannit 1 élément du shop (une Tox), retiré du shop pour les deux. Aucun ban
   n'a encore été vu dans un replay : le format d'un ban dans le flux est inconnu. À la première partie avec un ban, le
   lecteur le signalera (`checks`, et `summary.bans` lu dans les statistiques du serveur). Il faudra alors compléter le
   lecteur, remplir `mine`, `theirs`, `rarity` et les règles encore inconnues, et prévenir l'orchestratrice :
   - une fois par partie ou à chaque boutique (`phase`) ;
   - les deux bans sont-ils simultanés (`order`) ;
   - voyait-on déjà les 4 cartes adverses au moment de bannir (`sawOpp`) ;
   - la Tox bannie revient-elle plus tard (`lasts`), et ses autres raretés restent-elles proposées (`rarity`) ;
   - ce que le replay montre du ban (`seen`).

   Le ban d'une **carte** du deck n'a jamais été observé (peut-être réservé au Classé) : l'ignorer, et le signaler à
   l'orchestratrice s'il apparaît.
6. Relever aussi les autres règles inconnues, dans la `note` de la partie et dans `knowledge` :
   - **absorption** (Veuve noire de Tisseuse de Mots, #123 ; Avalement de Régent des Abysses, #86, sur un allié) : les
     PV de la carte absorbée et de la Tisseuse juste avant et juste après, la prime de 50 Spamtons et qui la reçoit, les
     effets « à la mort d'un allié » (Cimetière, Vengeur…) ;
   - **prolongation** : ce qui change à partir du tour 20, et à quel tour exactement.
7. Ensuite, un fait nouveau va dans `knowledge` en `hypothèse`, avec `evidence:[matchId]`. Une hypothèse vue dans au
   moins 2 parties devient `confirmé` ; une hypothèse contredite devient `réfuté`. Deux fiches sur le même sujet : les
   fondre (ajouter la partie à `evidence`, changer le statut si besoin), puis supprimer le doublon.
8. Archétypes : quand un cœur de cartes adverse hors archétype revient au moins 2 fois, créer un archétype `émergent`.
   À partir de 5 parties, il passe `établi`. Dès qu'un archétype a été croisé 3 fois, calculer ses `bestAnswers`
   (voir Contre-méta).

Une partie que l'utilisateur raconte, sans replay : l'analyser dans la conversation avec la même méthode, sans
l'écrire dans le Journal. Elle y entrera avec son replay.

## Schéma de la base (contrat)

`matches/<AAAA-MM-JJ-HHMM-xxxx>` :
```
date (ISO), mode ("classé"|"normal"|"défi"|"inconnu"), result ("V"|"D"|"N"|null), resultCertainty, first (bool|null),
firstCertainty, turns, source, createdAt,
my {deck, cards:[n°], unknown:[noms]}, opp {name, cards:[n°], unknown:[noms], archetype:<id>|null, certainty},
timeline [{t, me, opp, note, inferred, c, basis}], gaps [{turns, how, c}],
shop [{t, who:"me"|"opp", tox, pass, on:n°|null, replaced, c}],
turningPoint, summary, mistakes [{t, cat, what, better, cost, c}], goodPlays [{t, what}], lessons [texte],
screens [ids d'assets ou URL], screensRead [{i, turn, shows}], evidence {screens, coverage, confidence},
note, my.notes                                    ← FACULTATIFS
bans {mine, theirs, c, phase, order}              ← FACULTATIF (ajouté le 2026-10-09, absent des documents plus anciens)
bans {rarity {mine, theirs}, sawOpp, lasts, seen} ← FACULTATIFS (ajoutés le 2026-10-09, second lot)
shop[] {cost, rerolls, rerollSpent, offers}       ← FACULTATIFS (ajoutés le 2026-10-09, replays)
bans {none}                                       ← FACULTATIF (ajouté le 2026-10-09, replays)
```
- `source` : `pc-perso@<sha7>` = partie lue dans un replay envoyé depuis le PC perso (`<sha7>` = le commit d'envoi sur
  la branche `pc-perso`). C'est la seule source depuis le 2026-10-09 ; la page affiche « Replay du jeu · envoi
  <sha7> » sous la partie. Anciennes valeurs, toujours affichées : `captures` (analysée dans la page), `manuel`
  (saisie à la main), un horodatage (import du Pont, « import « … » » dans la liste).
- `createdAt` : la date d'écriture, en ISO. Les 2 premières parties ont un nombre (ms depuis 1970). La page ne
  l'affiche pas.
- `first` : `true` si j'ai joué en premier. Avec un replay, il est lu (voir « Importer une partie »). Dans le déroulé,
  la page met le demi-tour du premier joueur en premier.
- `timeline` : une ligne par tour (`t` = numéro de tour commun aux deux joueurs) ; `me` et `opp` = ce que chaque camp a
  fait. Le lecteur des replays écrit `[<n> Spamtons, Chance <x>] Action. Action. passifs : …`. La page met l'état
  entre crochets à part, une ligne par action (coupure sur « . », sauf le « crit. » d'un coup critique), l'acteur
  (avant « : ») en gras, les passifs en gris et les morts (« retirée du jeu ») en gras. Garder ce format dans un texte
  écrit à la main. Un `c` ou un `basis` identique sur tous les tours n'est affiché qu'une fois.
- `shop` : un passage en boutique par joueur et par tour pair. `tox` = l'achat, `on` = la carte, `replaced` = le Tox
  remplacé (ou le nom d'une capacité), `pass: true` = boutique passée (+10 Spamtons). Avec un replay, `tox`,
  `replaced` et `offers` sont des **ids du jeu, rareté comprise** (`CoeurVital_R`, `Life Steal_C`,
  `Primitive heal_E` : les clés de `ref/tox.json`) ; la page affiche le nom français et la rareté. Une ancienne partie
  peut avoir un id de famille (`Berserk`) ou un nom lu tel quel, affiché tel quel. Champs des replays :
  - `cost` : le prix payé pour l'achat, en Spamtons (0 pour une passe) ;
  - `rerolls` : le nombre de relances ; `rerollSpent` : les Spamtons payés en relances (10, puis +5 par relance dans
    la même boutique) ;
  - `offers` : les offres vues, dans l'ordre : `offers[0]` = l'offre d'ouverture, puis une liste par relance. Chaque
    liste = les ids des 3 Tox proposés. L'achat est dans la dernière liste.

  La page affiche le coût, les relances, un total par camp et, repliables, les offres (l'achat coché, le prix de
  chaque offre lu dans `ref/tox.json`).
- `screens` : (anciennes parties) un id d'asset du Journal, affiché via `/_blob/<id>`. Une valeur qui contient `/` ou
  `:` est prise telle quelle comme URL.
- `note` : un texte libre sur la partie. Avec un replay : le fichier lu, la version du lecteur, ce qui sort de
  l'ordinaire. Une ancienne partie saisie à la main n'a que lui, sans `timeline` ni `evidence`, et `opp` n'y a que
  `cards` et `unknown`.
- `my.notes` : un commentaire sur mon deck, affiché sous ses cartes.

`bans` : seuls les champs connus sont écrits ; un champ absent, `null` ou une chaîne vide veut dire « inconnu ».
- `none` : `true` = **aucun ban dans la partie**, établi. Avec un replay : `bans: []` pour les deux joueurs dans les
  statistiques de fin de partie du serveur, et aucun Tox banni à chaque passage en boutique. `mine` et `theirs` sont
  alors `null`, `c` vaut 100 et `seen` dit sur quoi ça s'appuie. La page affiche « Aucun ban dans cette partie », et la
  Méta compte ces parties. Absent : des bans ont eu lieu, ou on ne sait pas.
- `mine` / `theirs` : la famille de Tox bannie, par son id sans suffixe de rareté (`Multiplicator`, `Berserk`,
  `Tenacite`… : les clés de `ref/tox.json` sans `_C/_R/_E/_L`), ou le nom lu tel quel si la famille n'a pas été
  reconnue. `null` si inconnu.
- `c` : la certitude sur ces deux Tox (ou sur l'absence de ban).
- `rarity` : `{mine, theirs}`, chacun `C`, `R`, `E`, `L` ou `null`. 21 des 40 familles existent en plusieurs
  raretés, et l'on ne sait pas encore si le ban vise toute la famille ou une seule rareté : la famille reste dans
  `mine` / `theirs`, la rareté va ici. Absent si aucune rareté n'est connue.
- `phase` : le moment du ban, en texte (`une fois, avant le tour 1`, `une fois, à la première boutique`,
  `à chaque boutique`…).
- `order` : `simultané`, `moi d'abord` ou `l'adversaire d'abord`.
- `sawOpp` : `true` si les 4 cartes adverses étaient visibles au moment de bannir, `false` sinon.
- `lasts` : la durée du ban, `toute la partie` ou `la boutique en cours seulement`.
- `seen` : ce que la source montre du ban (ou de son absence). La page l'affiche sous les bans.

`knowledge/<id>` : `kind` (mécanique|économie|carte|tox|adversaire|méta|jeu), `subject`, `text`,
`status` (confirmé|hypothèse|réfuté), `source`, `evidence:[ids de parties]`, et deux champs facultatifs :
`cards:[n°]` (absent ou vide sur la plupart des fiches de règles) et `createdAt` (ISO ; écrit par l'ancienne analyse
de captures de la page, avec `source: "analyse de captures"`).

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
   attendue avant d'avoir des parties réelles. Les replays donnent la vraie : cartes adverses croisées et archétypes,
   onglet Méta de la page.
