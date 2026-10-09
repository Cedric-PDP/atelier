# spam-atelier — atelier de decks SPAM (projet perso)

> **Projet personnel, sans aucun lien avec O'Work / OCI.** Ce qui compte pour l'utilisateur : **aucune trace de ce
> projet côté O'Work** (dépôts, outils, MCP, mémoire O'Work : cicd-live, rag, SCRIPTS_V2…), et rien d'O'Work ici.
> Le dépôt a sa propre identité git locale (adresse noreply GitHub) ; un commit qui porte quand même `@oci.fr`
> (envoi par l'interface web de GitHub) n'est pas grave (2026-10-09). Ouvrir Claude Code **dans ce dossier**.
> Dépôt **privé** : il contient un instantané du moteur et des textes de spamgame-wiki.com (contenu tiers).

L'utilisateur joue à **SPAM** (jeu de cartes Steam de Ticroco, appid Steam `2902720`). Ce dépôt contient les
trois pages publiées du projet et tout ce qu'il faut pour recalculer leurs données. Il remplace les sessions du
2026-10-09 (lancées depuis un autre dossier) : tout ce qu'elles savaient est ici.

## Les pages publiées

Republier = `Artifact` publish avec le `url` de la page, **sans `capabilities`** (pour garder celles déclarées).
Dans une nouvelle session, faire d'abord `action: "read"` sur l'URL : la page publiée peut avoir bougé. Une
seule session publie à la fois (des sessions parallèles ont divergé le 2026-10-09 : 1.20 contre 1.21, deux
journaux) ; les données des bases (`ArtifactData`) peuvent être lues et écrites par toute session.

| Page | Source | Base / capacités |
|---|---|---|
| **Atelier de decks** https://claude.ai/artifact/3a61vyiop6v5cLPs9H19iE | `site/atelier-spam.html` + `files: {"data.json": "site/data.json", "shop.json": "site/shop.json"}` | `db` : `decks` = decks sauvegardés `{name, cards:[numéros], createdAt}` (instantané : [spam/decks.json](spam/decks.json), la source vivante est la base) |
| **Journal de parties** https://claude.ai/artifact/WSVR5uVuFT9SMAa9WSaqpL | `journal/journal-spam.html` (construit par `journal/page/build_page.js`) | `db`, `user`, `assets`, `sample{images}` : `matches`, `knowledge`, `archetypes` — **schéma = contrat**, voir [journal/README.md](journal/README.md) |
| **Pont SPAM** https://claude.ai/artifact/6hFsmpioodoRQFGjstecxc | `pont/pont-spam.html` | `db`, `assets` : `imports/<horodatage ISO>` + `orchestrator/status` — **ne sert plus** (voir ci-dessous) |

**Ces pages ne s'ouvrent que sur le PC du travail.** Elles appartiennent au compte claude.ai de l'organisation,
dont l'admin a coupé tout partage hors de l'organisation, et l'utilisateur ne peut pas se connecter à ce compte sur
son PC perso. Pas de déménagement vers un compte claude.ai perso (refusé le 2026-10-09). Le PC perso passe par la
branche GitHub `pc-perso` (section « Le PC perso » ci-dessous).

- **Atelier** : avant de republier, `node scripts/app/smoke_page.js site/atelier-spam.html site` (faux DOM, doit
  finir par `NO RUNTIME ERRORS`), puis supprimer `site/_analysis.html`. Après chaque changement de la page ou de
  ses données, reconstruire aussi la copie hors ligne du PC perso (section « Le PC perso »).
- **Journal** : le seul journal de parties (pas de second journal dans l'Atelier). Procédure d'analyse des
  captures, barème de certitude et schéma dans [journal/README.md](journal/README.md) ; smoke =
  `node journal/page/smoke_journal.js journal/journal-spam.html` (doit finir par `SMOKE OK`). Le skill
  du projet `spam-journal` (`.claude/skills/`) ne fait que pointer vers ce README.
- **Pont** : conçu pour que l'utilisateur y dépose depuis son PC perso les dossiers du jeu, il est inutilisable
  là-bas (compte d'organisation). Il reste publié mais ne sert plus et n'évolue plus ; son mode d'emploi (chemins,
  commande PowerShell, fichiers exclus) est repris dans le README de la branche `pc-perso`.
- Verdict Steam : le compte n'apporte presque rien (Steam ne voit pas les parties, une page ne peut pas appeler
  Steam). Le jeu, lui, garde un **replay de chaque partie en local** (premier envoi du 2026-10-09, voir « Le PC perso »).

## Le PC perso : la branche GitHub `pc-perso`

L'utilisateur joue sur son PC perso, **sans rien d'installé** et sans accès aux pages claude.ai. Ce qui passe
entre les deux PC : la branche **orpheline** `pc-perso` du dépôt privé `Cedric-PDP/spam-atelier` (compte GitHub
perso), qu'il ouvre dans son navigateur. Ici, elle est extraite dans le worktree `.pc-perso/` (ignoré par `main` ;
s'il manque : `git fetch origin pc-perso && git worktree add .pc-perso pc-perso`). Rien de cette branche ne va
dans `main`.

**Rien du jeu n'est sur le PC du travail** (ni le jeu, ni ses fichiers, ni sa clé de registre) : une commande ou un
script destiné au PC perso ne peut pas être essayé ici. Le lancer ici ne prouverait rien, et lire le registre de ce
PC est refusé. Il part dans le README **marqué non testé**, et c'est le retour de l'utilisateur ou l'envoi suivant
qui dit s'il marche.

- `README.md` : son mode d'emploi, affiché par GitHub (ouvrir l'Atelier, trouver, compresser et déposer les
  fichiers du jeu, ce qu'il ne faut jamais envoyer). C'est lui qu'il lit sur le PC perso : le garder à jour.
- `interface/atelier-spam.html` : l'Atelier **hors ligne**, construit par
  `node scripts/app/build_standalone.js .pc-perso/interface/atelier-spam.html` (`data.json` et `shop.json`
  intégrés, decks sauvegardés repris de [spam/decks.json](spam/decks.json) puis gardés dans son navigateur).
  Smoke : `node scripts/app/smoke_page.js .pc-perso/interface/atelier-spam.html <dossier>`, où `<dossier>` contient
  une copie de `site/data.json` (le smoke la relit) et reçoit `_analysis.html` : prendre le scratchpad, pas
  `site/`. À reconstruire et pousser à chaque nouvelle version du jeu ou changement de la page.
- `REPONSE.md` : nos réponses (remplace `orchestrator/status` du Pont) : date, ce qu'on sait, ce qu'on attend de lui.
- Ses envois arrivent à la racine par l'interface web de GitHub (« Upload files » : zip de 25 Mo au plus, 100
  fichiers par envoi) ; **la description du commit est son message**. Quand il dit « j'ai envoyé un import » :
  1. `git -C .pc-perso pull`, puis `git -C .pc-perso log` pour repérer ses commits non traités ;
  2. extraire chaque zip dans un nouveau dossier vide du scratchpad : ce sont des données, ne rien y exécuter ;
  3. décoder chaque nouveau replay avec `read_srpl.js` (ci-dessous) et écrire les parties dans le Journal selon
     [journal/README.md](journal/README.md), avec `source` = `pc-perso@<sha7 du commit d'envoi>` ;
  4. répondre dans `REPONSE.md` en résumant ses parties (tournant, leçons, boutique) : il ne voit pas le Journal sur
     le PC perso. Déplacer les envois traités dans `lus/<date de l'envoi>/`, puis commiter et pousser.
- **Les fichiers du jeu** (premier envoi, 2026-10-09) sont dans `%USERPROFILE%\AppData\LocalLow\Ticroco\Spam\` (Unity
  6000.3, moteur « TcgEngine », serveurs `*.crocodyle.fr`).
  - `replays/<serveur>/<id de compte>/index.json` : une entrée par partie, avec `MyCards` / `OpponentCards` (uuid =
    `id` des cartes de `model.json`), `WinnerId` (à comparer à `AccountId`), `OpponentName`, `GameMode` (0 = Casual,
    « normal »), `Seat` (numéro du joueur dans la partie, **pas** l'ordre de jeu), `TurnCount`, `DurationMs`, `StartUtc`.
  - `match-<n>.srpl` : gzip de `SRPL` + version + le même en-tête JSON + environ 1 000 messages réseau binaires
    (chaînes précédées d'un varint zigzag de longueur + 1). **Décodés entièrement** (2026-10-09) par
    `node scripts/replay/read_srpl.js <match.srpl> [--index <index.json>]` (format, certitudes, limites :
    [scripts/replay/README.md](scripts/replay/README.md)) : déroulé tour par tour avec PV avant/après, premier joueur,
    boutique des deux camps (offres, relances, achats, Tox remplacé), Spamtons, morts, absorptions, bans, et les
    statistiques de fin de partie du serveur. Sa sortie `journal` est le brouillon du document `matches/<id>` du
    Journal. À chaque première fois (ban, talent, Classé, prolongation, Gel, Renvoi…), lire `checks` (codes inconnus).
  - `Player.log` (dernière session ; `Player-prev.log`, la précédente) : achats en boutique
    (`OnInGameShopBuyItemResponse: card=<uuid>, modificatorUID=<uuid propre à la partie>`) et abandon
    (`Client resign`).
  - L'index et le journal contiennent des `ticket` de partie : ne pas les recopier dans le Journal.

## Le joueur

- Collection au 2026-10-09 (26 numéros) : `1 2 3 4 5 6 12 27 30 33 69 82 102 103 116 117 153 156 158 160 180
  227 238 243 251 259` ([spam/mine.txt](spam/mine.txt)). Aucun talent débloqué.
- Liste de souhaits (dans la page) : Aleera (231, la grosse amélioration), Maître Amphibien, Spectre Canin,
  Princesse Meridia, Souverain des Chutes d'Éther.
- **N'aime pas les decks qui dépendent des critiques** (trop aléatoire). Les adversaires sont de vrais
  joueurs, qui peuvent avoir des talents.
- Incident fondateur : en vrai match, *Tisseuse de Mots* (#123, Veuve noire = `absorbAny`) a absorbé notre
  *Chimère Brasse-chair* → d'où la métrique « carte perdue » `L` (score si une carte est absorbée, donc meurt, au
  tour 1).
- **Pas de tier des cartes, nulle part** (demande de l'utilisateur).

## Règles à ne pas confondre (vérifiées dans le moteur et l'audit)

- `spamton` d'une carte = **revenu par tour** tant qu'elle vit, **pas un coût**. Revenu d'un tour = somme des
  `spamton` des cartes vivantes + numéro du tour. La prime de mort (50 Spamtons) va au joueur qui **perd** la carte.
- `rows` = capacités + passifs innés ; une carte a `3 - rows` emplacements de Tox libres. La boutique ouvre aux
  tours pairs.
- **Deux bans différents** : le **ban de boutique est RÉEL** (vu par l'utilisateur) — chaque joueur bannit un
  élément de la boutique, retiré pour les deux ; il fait partie des stratégies (robustesse du plan d'achat d'un
  deck au ban adverse, choix de notre ban ; `bansPerPlayer:1` est probablement celui-là). Encore inconnus : le
  moment du ban (une fois par partie ou à chaque boutique) et ce qu'on sait de l'adversaire à ce moment. Le
  **ban d'une carte** du deck n'a jamais été observé (peut-être en Classé) : ne rien modéliser. Dans les replays des
  2 premières parties (mode normal), personne n'a banni : le serveur garde des `bans` par joueur et un champ `banned`
  à chaque passage en boutique, tous vides.
- **Absorption = mort** (replay de la partie `2026-10-09-1546-7144`) : Veuve noire de Tisseuse de Mots (#123) a pris
  la Chimère (238, 525/525 PV) ; la Tisseuse gagne **100 %** de ses PV (+525 PV max et +525 PV ; le moteur du wiki
  compte 50 %), un message de mort part, la prime de 50 va tout de suite au propriétaire et l'élimination est
  créditée à la Tisseuse. Encore inconnus : PV max ou actuels d'une carte blessée ; effets « à la mort d'un allié »
  (tenus pour probables : la métrique L les déclenche).

## Le moteur : un instantané du wiki PAR VERSION du jeu (`spam/versions/<v>/`)

- **Version courante : 1.21** (sortie le 2026-10-09), moteur du wiki **rev2** : engineHash `e77f882d0c1284ef`
  (`model-bcfe0dc12085596f.json` + `simulation-BFLulMa_.js`, récupéré à 16 h 19). 1.20 est archivée à côté.
- **Le wiki a révisé sa notation le même jour, sous le même numéro** (rev1 → rev2, mêmes 127 cartes, jeu
  inchangé). rev1 = engineHash `36e2c03d5b7bf4a1` (`model-edeb0ebc315cfd15.json` + `simulation-KlJhEEqL.js`,
  15 h 03), dans l'historique git. Différences : l'offensive d'un match que le deck ne finit pas en 10 tours
  passe des dégâts utiles par tour (`usefulByTurn`) à `3 · PV adverses · n / ttk` (−14 % pour ces decks, −2 %
  pour ceux qui gagnent dans l'horizon ; −13,4 % en moyenne sur les 24 000 decks, contre +4,5 % pour le patch
  seul en notation rev1) ; les cartes du wiki sont classées avec leur meilleur talent (`rankMetrics`, sans effet
  sur la page) ; le modèle change `recommended` (talents) et `baseline`. Détail : `spam/versions/1.21/revision.json`
  et les deux premières notes du changelog.
- `spam/versions/<v>/js/simulation.js` = `/_astro/simulation-*.js` de spamgame-wiki.com, `js/model.json` =
  `/data/model-*.json` (127 cartes), `js/source.json` = URLs hachées, engineHash et date de récupération.
  Variantes générées par `scripts/app/make_variants.js` (non versionnées) : `model_nocrit` (sans critiques),
  `model_crit0.5` (chances de critique ×0,5, multiplicateurs gardés), `model_dead` (+ une carte factice
  `dead-card`, 1 PV, pour la carte perdue). Vérifié : elles redonnent à l'identique celles de 1.20.
  `recompute.sh` les refait quand elles manquent ou viennent d'un autre engineHash (le moteur lit `noTalent` et
  `recommended` dans le modèle).
- `spam/js/` (et `model_crit<k>`) = l'ancien emplacement 1.20, encore lu par les scripts d'analyse ponctuelle
  et l'audit ; le pipeline de la page ne s'en sert plus.
- 1.21 : `bestDecks` prend `[{id, talents:[]}]` (plus une liste d'ids) et ne rend que 3 decks ; `evaluate`
  est inchangé.
- **Métrique « carte perdue » L** (« Sans sa carte clé » dans la page ; `meta.lostMethod` = `absorb-death` depuis
  le 2026-10-09 au soir) : chaque carte du deck, à tour de rôle, est **absorbée au début du tour 1 et meurt**, comme
  la Chimère prise par Veuve noire dans le replay `2026-10-09-1546-7144`. Elle passe par le gestionnaire de mort du
  moteur (`me()`, celui d'une carte tuée par des dégâts), sans gain de PV pour l'absorbeur (`gain:false`).
  - **Sûr** (replay) : la prime de 50 Spamtons va tout de suite au propriétaire (+15 points de score partout).
  - **Hypothèse** (le jeu passe par son message de mort normal, mais aucune carte de la partie n'avait d'effet de
    mort) : les effets « à la mort d'une carte » des **autres** cartes se déclenchent (Vengeur inné de Dragon Ciel :
    ses attaques sont prêtes dès le tour 1 ; Cimetière de Naissance d'Aldrin : +5 à tous les bonus élémentaires ;
    talents Vitalité des Âmes, One man army, Armure des Âmes), ainsi que les effets « quand cette carte est tuée » de
    la carte perdue (Revanche, Bomba ; talents Héritage, Virage 360, Heure Funeste, Dernier souffle).
  - **Choix** : la carte absorbée ne revient pas (Phénix, Plume de Phénix, Transition et notre Résurrection
    ignorés pour elle) ; elle est marquée absorbée avant le gestionnaire de mort, donc son propre Cimetière ne compte
    pas sa propre mort (dans le moteur, une mort par dégâts le compte : Aldrin perdu vaudrait alors 800 à 1 600
    points de plus) ; puis elle quitte le plateau (`__stRemove` : auras, Cœurs, Cimetière aux morts suivantes coupés).
  - L est sans talent ni boutique : aujourd'hui, seuls jouent la prime, Vengeur (Dragon Ciel, 180) et Cimetière
    (Naissance d'Aldrin, 30). Recalcul du 2026-10-09 contre `absorb` : 82 % des valeurs de L font exactement +15 ;
    les autres sont toutes dans des decks avec 180 ou 30 (jusqu'à +2 677 sur le pire cas d'un deck ; 88 decks
    baissent, au plus −596, quand Vengeur au tour 1 décale les recharges ou quand Cimetière renforce un soin qui
    affaiblit une attaque « PV manquants ») ; la carte clé change pour 1 728 decks sur 31 465. Les 5 decks
    sauvegardés ne prennent que +15 sur leur pire cas (« Essai Dragon Ciel » : sa carte clé reste Dragon Ciel).
    Méthodes précédentes : `absorb` (retirée sans mourir, encore disponible :
    `__lostAbsorb(M, ids, {death:false})`), et avant elle `dead-card`, une fausse carte de 1 PV qui meurt au premier
    coup adverse (effets à la mort plus tardifs pour le premier joueur) : c'est le repli de `recompute.sh` quand la
    version n'a pas de patcher, signalé dans `meta.lostMethod`.
  - Moteur : `js/engine_stress.js` = moteur + bascules de l'audit (`globalThis.STRESS`, éteintes par défaut, sorties
    d'`evaluate` identiques à l'octet) + `__lostAbsorb(model, ids)`, construit par
    `scripts/app/stress/make_engine_<v>.js` (ancres et noms minifiés **propres à chaque moteur** : à porter à
    chaque patch du jeu, en partant de celui de la version précédente, **et à chaque reconstruction du moteur par
    le wiki sous le même numéro** — `make_engine_1.21.js` a une table de noms par révision, reconnue par signature :
    rev1 et rev2 ci-dessous ; un nouveau moteur fait planter `binding check …` → ajouter une ligne à la table, puis
    vérifier STRESS éteint = sorties d'`evaluate` identiques à l'octet).
- Exécuté dans un `vm` Node isolé (ni `require` ni `fs` dedans) : `scripts/sim_lab2.js <engine>
  "x1=<model>;x0=<model>" <driver.js> <out.json>`. Le driver est du JS évalué dans le contexte du moteur :
  globals `MODELS`, `OUT` (écrit dans out.json), `ht` (fabrique d'évaluateur) ; les données doivent être
  embarquées dans le driver.
  ```js
  (()=>{const I=ht(MODELS.x1);const r=I.evaluate(ids.map(id=>({id,talentId:null})),{optimize:false,suggestions:false,shop:false});
   OUT.res={score:r.score,ttk:r.ttk,matchups:r.matchups,dmgByTurn:r.dmgByTurn};})();
  ```
- Repères sans talent (`model.noTalent`) : 1.20 baseline 4 714,7 / meilleur 15 336,6 ; 1.21 rev2 baseline
  4 216,7 / meilleur 15 327,5 (rev1 : 4 865 / 15 327,5). Deck chimere (103-117-156-238) = 8 018 en 1.20 (48 % des
  dégâts viennent des critiques), 8 011 en 1.21 rev1, **7 235 en 1.21 rev2** (sans critiques 3 630, sans sa carte
  clé 1 737 — sans la Chimère).
- 1.21 en bref (détail : `spam/versions/1.21/CHANGELOG.md`) : Dragon Ciel (AoE + Nature +4) passe en tête de la
  collection, meilleur deck possédé Esprit Nature · Lame de la forêt · Keria · Dragon Ciel (3-103-117-180) =
  **8 512** en rev2 (8 934 en rev1), devant Lame de la forêt · Keria · L'Œil des montagnes · Dragon Ciel (8 029).
  Côté menaces : Tisseuse de Mots à 2 Spamtons, Zombie Floral en AoE Disparition, Gel à 60.
- **Leçon : le moteur du wiki affronte un adversaire ABSTRAIT** (une courbe de dégâts, aucune mécanique).
  L'absorption de carte (Veuve noire de Tisseuse), la Provocation permanente (Fleur de Vie), le Gel, le Renvoi…
  sont invisibles dans ses scores : toujours éprouver un deck face aux mécaniques adverses (`spam/audit/E1`, `E2`,
  moteur à bascules `engine_stress.js`).

## Nouvelle version du jeu : UNE commande (c'est la procédure de base)

```bash
bash scripts/app/new_version.sh          # --force pour tout refaire, --no-site pour ne pas toucher site/
```

1. `fetch_version.js` lit la page builder du wiki, retrouve `model-*.json` et `simulation-*.js` (noms hachés,
   le second via les scripts de la page), et crée `spam/versions/<v>/` : `js/`, `cards_fr.json` (page cartes),
   `builder_fr.txt` (textes des Tox), `meta_decks.json` (decks de la tier list du wiki = la « méta »). Exit 3
   et rien d'autre si le wiki sert les mêmes fichiers que la dernière fois. **Le wiki peut changer de moteur sous
   le même numéro** (1.21, 2026-10-09 : même jeu, notation révisée) : le dossier `<v>/` est alors réécrit (l'ancien
   moteur reste dans l'historique git), le patcher de L est peut-être à porter (voir « Le moteur »), et le
   changelog le signale (ci-dessous).
2. `recompute.sh <v>` recalcule tout avec ce moteur (détail ci-dessous), écrit le changelog contre la version
   précédente et copie `data.json` / `shop.json` dans `site/`.
3. Publier reste manuel (voir « L'interface publiée »). La page affiche l'onglet « Nouveautés <v> ».

## Recalculer les données de la page

```bash
bash scripts/app/recompute.sh [<v>] [--only-build] [--no-site]   # <v> par défaut : la plus haute ; CHUNKS=16 process
```

Enchaîne, tout dans `spam/versions/<v>/` : variantes + `toxinfo` → `pre` = tous les decks de 4 cartes du pool
(31 465, ≈ 4 min sur 16 process si la machine est libre, 11 min le 2026-10-09 avec d'autres sessions) →
`pick_shop_keys` (≈ 1 600 decks) → `lost` → `shop` (≈ 2,4 s/deck) → échantillon global + Monte-Carlo de boutique
des 4 decks de `spam/mcv2/` → decks méta notés par ce moteur **et** le précédent → `build_core --ver` +
`build_shop` → `build_changelog` → `site/` → smoke de la page. `--only-build` refait l'assemblage sans relancer
le moteur ; `--only-lost` ne recalcule que L (par ex. après avoir ajouté le patcher d'une version). Drivers
générés dans `drv/`, sorties dans `app/` (ni l'un ni l'autre versionné).

`build_core.js --ver` ne code plus rien en dur : version, baseline, meilleur (`model.noTalent`), paliers
(S/A/B/C = 90/80/70/50 % de l'indice, règle du wiki), meilleur deck (le mieux noté de la tier list du wiki) et
simulations de boutique (`app/mc_*.json` + `spam/mcv2/deck_*.json`) viennent des résultats. Sans `--ver`, il
garde l'ancien comportement 1.20 (vérifié : redonne `site/data.json` 1.20 à l'octet près).

**Changelog** (`build_changelog.js`) — écrit dans `spam/versions/<v>/` : `changelog.json`, `CHANGELOG.md`, et
l'intègre à `data.json` (`data.changelog`, + `prev.s1/s0` alignés sur `decks` pour afficher « avant → après » sur
n'importe quel deck, y compris les decks sauvegardés plus tard). Contenu : repères, cartes modifiées (diff des
modèles ; les renommages de talents « Coeur » → « Cœur » sont ignorés, et un texte reformulé sans aucun champ
moteur changé va dans `textOnly`, à part), Tox de la boutique, **cibles de ban** (chaque joueur bannit un Tox de
la boutique : Tox les plus achetés par les plans de boutique de tes decks de référence), **effet par carte**
(sur les MÊMES 24 000 decks aléatoires, `spam/stats/global_decks.json`, écart des decks qui jouent la carte
comparé à l'évolution moyenne), tes decks (top 10, hausses/baisses parmi tes 300 meilleurs, meilleur sans
critiques, decks sauvegardés), decks méta du wiki (rangs et scores avant/après). Il écrit aussi `scores.json` et
`global.json`, versionnés (avec l'engineHash) : c'est ce que la version SUIVANTE compare. **Révision du moteur
sous le même numéro** : si le `global.json` qu'il va écraser porte un autre engineHash (ou avec
`--rev-from=<dossier>` contenant `global.json` + `js/model.json` de l'ancienne révision, extraits de git), il écrit
`revision.json` (versionné : effet de la seule révision sur les mêmes 24 000 decks, patch seul en ancienne notation,
cartes les plus touchées ; le champ `what` s'écrit à la main et est conservé) et deux notes en tête du changelog.

Le **pool** = [spam/app/pool_order.json](spam/app/pool_order.json) : 31 uuid, les **26 possédés d'abord**,
puis les 5 souhaités. Quand la collection change :
1. mettre à jour `spam/mine.txt` et `pool_order.json` (possédés en tête) ;
2. mettre à jour `NOWN` dans `scripts/app/build_core.js` **et** `scripts/app/pick_shop_keys.js` ;
3. relancer `recompute.sh`, republier. Le changelog suivant comparera les decks par **numéros de cartes** :
   un changement de collection entre deux versions ne casse pas la comparaison.

## Réseau et données réelles

- Depuis le PC du travail, le proxy bloque spamgame.com, Steam (store/community/api) et metabot.gg (curl
  **et** WebFetch) ; spamgame-wiki.com passe en `curl -s -L --max-time 30`. steamdb et gamefaqs sont bloqués aussi,
  Reddit ne sert qu'un mur anti-robots.
- Aucune source publique de matchs réels (ladder, replays, API) : le wiki et metabot ne font que simuler.
  Mais le jeu garde un replay de chaque partie sur le PC perso (voir « Le PC perso ») : c'est la source des vraies
  parties.

## Plan du dépôt

| Chemin | Contenu |
|---|---|
| `site/` | la page Atelier + `data.json` / `shop.json` de la version courante (copiés par `recompute.sh`) |
| `journal/` | la page Journal : `journal-spam.html` (à publier), `page/` (source, build, smoke), `ref/` (127 cartes 1.21 FR/EN, Tox, collection) ; `README.md` = procédure + contrat de la base |
| `pont/` | la page Pont SPAM (`pont-spam.html`, autonome) ; ne sert plus, remplacée par la branche `pc-perso` |
| `.pc-perso/` | worktree de la branche orpheline `pc-perso` (ignoré par `main`) : Atelier hors ligne, mode d'emploi et envois du PC perso |
| `spam/versions/<v>/` | une version du jeu : `js/` (moteur + modèle), `cards_fr.json`, `builder_fr.txt`, `meta_decks.json`, `scores.json`, `global.json`, `changelog.json`, `CHANGELOG.md`, `revision.json` (si le wiki a changé de moteur sous ce numéro) ; `app/`, `drv/`, `data.json`, `shop.json` non versionnés |
| `scripts/sim_lab*.js`, `run_sim.js` | lanceurs du moteur dans un `vm` |
| `scripts/app/` | pipeline de la page (`new_version.sh`, `fetch_version`, `make_variants`, `recompute.sh`, `gen_drivers`, `gen_global_drivers`, `gen_eval_driver`, `extract_meta_decks`, `pick_shop_keys`, `build_*`, `smoke_page`) ; `drv_*_N.js` de ce dossier = drivers 1.20, **générés** depuis `drv_*_0.js` (les modèles) |
| `scripts/*.js`, `stats/`, `addx/`, `mcv2/` | drivers des analyses ponctuelles (critiques, talents, Monte-Carlo, ajout de carte…) ; `mcv2/drv_*.js` sont aussi relancés à chaque version |
| `spam/js/` | moteur + modèles 1.20 (ancien emplacement, analyses ponctuelles) |
| `spam/*.json`, `*.csv`, `*.txt` | cartes (FR/EN), Tox, collection, extraits texte du wiki (règles, méthodologie, stratégies), résultats d'analyses |
| `spam/app/`, `spam/stats/` | sorties intermédiaires lues par `build_core.js` |
| `spam/audit/` | audit des mécaniques du 2026-10-09 (terminé ; données 1.20, écarts 1.21 signalés) : `README.md` (cadrage + corrections), `A_rules.md` (règles complètes et sources), `B_engine.md` (ce que le moteur du wiki voit ou non ; `B_engine_pretty.js` = moteur lisible), `C_actives.md` / `C_actives.json` (ce qu'un adversaire peut faire à nos decks hors dégâts : 55 mécaniques), `D_tox.md` / `D_tox.json` (les Tox vus côté adverse), `E1/E1_stress.md` + `E2/` (nos decks face à Provocation, Gel, précision, renvoi, absorption, reset de recharge, soins : moteur à bascules, base des `stress/`), `F/F_meta.md` (cartes et mécaniques adverses probables, par proxy) |

Non versionnés (ils se re-téléchargent ou se recalculent) : les pages HTML brutes du wiki (`spam/pages/`,
`spam/*.html`, `spam/audit/A_raw/`, `D_raw/`), les sorties de runs de l'audit (`spam/audit/F/runs/`, `F/dl/`,
`E2/res_chunk_*`), les journaux d'exécution.
