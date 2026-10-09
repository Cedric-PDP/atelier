# SPAM v1.20 — full mechanics audit (shared context for every agent)

Personal side project: the user plays SPAM (Steam card battler by Ticroco, v1.20, released 2026-10-07).
So far every deck recommendation came from the fan wiki's own engine (spamgame-wiki.com). That engine
plays OUR deck against ABSTRACT opponents, so it missed a real-game disaster. Goal now: audit ALL game
mechanics ourselves, find every mechanic that can wreck a deck in a real match but is invisible to
the wiki's score, and quantify it.

## The incident that triggered this
Real match, our "deck chimere" vs player AZURIAN. Opponent's **Tisseuse de Mots** (#123, COMMON, 3 Spamtons,
500 HP) used **Veuve noire** (CD 8, effect `absorbAny`, text "Absorbe une carte") around turn 7 and
absorbed our **Chimère Brasse-chair** (525 HP): Chimère vanished and Tisseuse's max HP went 500 -> 1025.
Opponent's **Fleur de Vie** (#222) used **Barrière Florale** (CD 1, `taunt` on self, duration 2) every
turn = permanent Provocation, so our single-target attacks were forced onto it. We lost.
Earlier fix: we measured "score if one card is lost from turn 1" for every deck (deck chimere: 8,018 ->
1,920 without Chimère, -76 %). Now we generalize to EVERY mechanic.

## Paths (SP = root of the spam-atelier repo)
Bash is Git Bash on Windows; `node` (built-ins only, no npm packages) and `curl` are available.
Write ONLY under SP/spam/audit/ (your own files/subdir). Never modify other files.

### Data
- SP/spam/js/model.json — the wiki engine's model, game 1.20, engineHash a8193b3d422a54a9. 127 cards.
  card: {id (uuid), slug, number, name (FR), element, rarity, spamton (cost), hp, res{fire,water,earth,nature,light,shadow} (% damage reduction, can be negative), rows (Tox slots), abilities[], passives[] (= innate Tox), talents[3], ...}
  ability: {id,name,cd,prec,crit,critMult,duration,uses,echo,elements,cost,costHp,choice,options[]}
  option: {hits[{min,max,element}], heals[], gen[{element,min,max,cond}], effects[{type,...}], target, text}
  targets: enemy, randomEnemy, spreadEnemy, aoeEnemy, ally, allAllies, randomAlly, self, none, field, spreadField
  ability effect types (25): taunt eternity crit prec res freeze base temporality vampirism resetEnemyCd enemyPrec absorbAlly resetEnemySpamton critMult absorbAny setHpPct hpMax vanish resurrect aoe2 spamtonGen smoke breakTaunt changeElement
  passive types (30): luck coeur hpGrowth reset brut phoenix eternityOnHit mimetism erosion vanishOnHit punchingBag regen aoe lifesteal freezeOnHit revenge temporalityOnHit multiplicator reflect poison berserk smoke teamRes recoil avenger cimetiere tenacity immunity mystery tauntOnAttack
- SP/spam/audit/cards_compact.txt — readable dump of all 127 cards (ACT = ability + options, PAS = innate passive, TAL = talents).
- SP/spam/audit/tox_fr.json — the 101 shop Tox: id -> [FR name, rarity letter C/R/E/L, cost in Spamtons, FR text].
- SP/spam/toxinfo.json — engine shop data: pools (common 22 / rare 29 / epic 27 / legendary 23 Tox ids), tox map, odds by luck.
- SP/spam/js/simulation.js — the wiki engine (minified, ~80 KB, self-contained worker). Top of file = game constants:
  `{cardsPerDeck:4, turnDurationPerCardAlive:15, turnAfterOvertime:20, overtimeReducingRatio:.1, overtimeScalingRatio:.5, frozenOwnerTurns:1, talentDraftSeconds:30, startLuck:0, luckPerTurn:1, rerollCost:10, itemShopMax:3, luckForSkip:0, moneyForSkip:10, deathBounty:50, bansPerPlayer:1, skipPerCardAlive:[10,10,10,10]}`
  then rarity odds curves (t), Tox pools (n), ... The opponent is ABSTRACT:
  `opponent:{cards:4, cardHp:700, totalHp:2800, resist:.1, dpsByTurn:[108,124,140,156,172,188,204,220,236,253], aoeShare:.21}`
  and 9 profiles (neutral, fragile, tank, anti-fire, anti-water, anti-earth, anti-nature, anti-shadow, anti-light), each played first and second; 10-turn simulation.
  Per-match score J = offense + 0.35*(ehpLeft + defenseCredits) + 0.8*control + 0.5*economy; crit counted as expected value.
- Wiki text pages already downloaded (English): SP/spam/basics.txt (rules primer), methodology.txt, strategies.txt, patch.txt (patch notes), builder.txt (Tox descriptions), deck_ex.txt, card_gerz.txt. FR card pages: SP/spam/pages/*.html (127). Other: cards_full.json, cards_fr.json, spam_db_v1.20.json, names_fr_en.txt.
- Network: only spamgame-wiki.com is reachable, via `curl -s -L --max-time 30` (corporate proxy blocks spamgame.com, Steam, metabot.gg; WebFetch is blocked too).

### Running the wiki engine
Runner: `node SP/scripts/sim_lab2.js <engineFile> "x1=SP/spam/js/model.json;x0=SP/spam/js/model_nocrit.json" <driver.js> <out.json>`
The driver is plain JS evaluated INSIDE the engine's vm context: globals MODELS (parsed models by name), OUT (object written to out.json), console, and the engine's top-level bindings (e.g. `ht`). Example:
```js
(()=>{const I=ht(MODELS.x1);
 const r=I.evaluate(ids.map(id=>({id,talentId:null})),{optimize:false,suggestions:false,shop:false});
 OUT.res={score:r.score,ttk:r.ttk,matchups:r.matchups,dmgByTurn:r.dmgByTurn};})();
```
`ids` = card uuids (model.json `id`). Data must be embedded in the driver (no require/fs inside the vm).
Card loss from turn 1 was simulated by model_dead.json (adds a fake card id 'dead-card', hp 1, no abilities).
Machine note: node processes get little CPU each here; keep each heavy run bounded (<= ~10 min), at most ~6 parallel processes. Measured throughput ~40 evaluate() calls/s overall.

## The player
Collection (26 card numbers, no talents unlocked): 1 Esprit Feu, 2 Esprit Eau, 3 Esprit Nature, 4 Esprit Terre, 5 Esprit Ombre, 6 Esprit Lumière, 12 Hibernatus, 27 Hippocampe Nimbé, 30 Naissance d'Aldrin, 33 Nakyel, 69 Scorch les Lézards Ignés, 82 Baleine Farceuse, 102 Murmures du Corail Noir, 103 Lame de la forêt, 116 Prisonnière de la Machine, 117 Keria, 153 L'Inventeur, 156 L'Œil des montagnes, 158 Lapin-Plume, 160 Sanglier Doré, 180 Dragon Ciel, 227 Chouette Polychrome, 238 Chimère Brasse-chair, 243 Vivy, 251 Roi Ombre, 259 Dragon de la Cité Infernale.
Saved decks (card numbers): deck chimere [103,238,156,117] (wiki score 8,018, 48 % of damage from crits, best owned deck); anti-critiques [12,238,27,117]; zéro critique [102,116,12,69]; deck aleera [231,238,156,117] (231 not owned yet).
Robust alternatives found by the card-loss metric: [3,103,117,238] (score 7,625, worst case 3,672) and [69,160,227,238] (6,077, worst 3,818).
The user dislikes crit-dependent decks (too random). Opponents are real players who MAY have talents unlocked.

## Output
Write your report to SP/spam/audit/<your file>.md (+ optional JSON). Keep FR card and Tox names as in the data.
Separate FACTS (from data/rules, cite file or URL) from INFERENCES (state confidence). Report numbers, not adjectives.
