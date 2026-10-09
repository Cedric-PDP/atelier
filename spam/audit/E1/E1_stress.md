# E1 — Our decks vs four opponent mechanics the wiki engine does not simulate (SPAM 1.20)

Agent E1 · 2026-10-09 · wiki engine `a8193b3d422a54a9` · scope: **S-TAUNT, S-FREEZE, S-PREC, S-REFLECT**
(E2 covers absorption, cooldown reset and enemy sustain). Score = the wiki score (mean of J over 9 opponent
profiles × 2 play orders), no talents (the player has none), no shop Tox. "Change" = (scenario − baseline) /
baseline; **−x %** is a loss.

## 0. Bottom line

- **Validation passed.** With every toggle off, the modified engine returns exactly the original scores on all
  **301** decks studied: max |Δ| = **0** on the score, the 9 profile scores, ttk and damage; the full
  `evaluate()` JSON is byte-identical 301/301. Same with `STRESS={on:true}` and no threat (max |Δ| = 0). The
  original engine reproduces `site/data.json` `s1` exactly (max |Δ| = 0 after rounding; deck chimere 8,018).
- **What hurts deck chimere most is S-REFLECT with Renvoi épique (75 %) on all 4 enemy cards: 8,018 → 3,722
  (−53.6 %).** Chimère dies on turn 7 in 18/18 simulated matches, and damage dealt falls from 2,157 to 842 per match.
  The order in which lifesteal and the reflected damage resolve is unknown. Across the three orders tested, the
  loss stays between −41.5 % and −53.6 %. Among the scenarios the brief made primary, the worst is **Chimère frozen
  1 turn in 3: −24.5 %** (6,052). Next come S-PREC −20 at −15.8 % and the 900-HP taunter at −4.3 %. A 600-HP taunter
  (+2.4 %) and Renvoi commun on all 4 cards (0.0 %) cost nothing.
  The realistic reflect case is **one** Renvoi-E card, for example L'Épine d'Amour #106, whose Renvoi épique is
  innate. Against it, deck chimere does not lose anything (+0.5 % / −0.1 %).
- **Most robust owned deck: robuste A [3,103,117,238].** It has the best worst case over the harsh set:
  **5,441**, against 3,722 for deck chimere. It keeps rank 1 when the enemy focuses our damage card, and loses only
  −14.4 % to Renvoi épique on all 4 cards. Over the mild set it is a close second (5,999, against 6,052 for deck
  chimere). The runners-up are [3,103,156,238] (5,038), [12,103,117,238] (5,009, which also has the smallest
  worst-case drop among decks ≥ 6,000, −19.4 %) and the best deck without Chimère, [2,69,82,102] (4,941).
- **Fragility comes from concentration.** The deck loses most when one card deals most of the damage. Losing that
  card's turns costs −28.3 % (mean of decks whose top card deals ≥ 60 % of the damage) against −16.3 % when the
  top card deals < 45 %. Reflect hits the same decks: −31.2 % against −18.2 % (means). This is worst when that card is
  fragile (Chimère 525 HP, Aleera 500 HP) and its casts grow large: deck chimere's Galop reaches 584–879 expected
  damage per cast by turns 8–10.
- **Taunt barely matters in this model.** Forcing our single-target hits onto the taunter costs a median **+0.4 %**
  (i.e. a gain) at 900 HP. Almost all of the −6.0 % median loss of the 900-HP taunter comes from its +200 HP.
  AoE cards and Brut (Hippocampe Nimbé) ignore taunt. Taunt does punish single-target decks when the taunter also
  carries Renvoi épique: zéro critique −42.0 %, against −4.6 % for deck chimere.
- **Precision loss scales almost linearly.** −20 points cost a median −20.6 % (p10–p90: −16.7 % to −25.7 %);
  −10 points cost −10.4 % and −5 points −5.2 %. Every owned ability has precision 100, so the engine never
  showed this risk.

## 1. Method

### 1.1 Engine copy and hooks (all files in `SP/spam/audit/E1/`)

- `pretty.js`: re-tokenises `SP/spam/js/simulation.js` (sha256 `7dd61f57…`) with Node's internal acorn tokenizer
  and only adds newlines and indentation between tokens. The result is `engine_pretty.js` (2,130 lines).
- `build_stress.js`: applies 16 anchored patches to `engine_pretty.js`; each anchor is asserted to occur exactly
  once. The output is **`engine_stress.js`** (final sha256 `74803e98…`). Every hook reads `globalThis.STRESS` once
  per simulated match (`__Sinit` in `q()`). Hooks are inert when the toggles are absent, and never run in the
  engine's `potential` (shop/suggestion) runs. The patch points are:

| Hook | Engine function (minified name) | Effect when on |
|---|---|---|
| `__Sinit` | `q()` (one match) | taunter: last enemy card gets HP T, `totalHp` updated |
| `__Sorder` | `G()` (deal our damage) | single-target damage: living taunter moved to the head of the target list |
| `__Sracc` / `__Srefl` | `G()` hit loop | reflect = pct × damage actually taken by each enemy card → `H()` on our attacker |
| `__Sresolve` | `ye()` (cast) | lifesteal-vs-reflect ordering sensitivities (`after`, `net`) |
| `L()` patch | precision | `clamp((abilityPrec + cardPrec + teamPrec − malus)/100)` |
| `d` patch | `ye()` | gen/buff effects of damaging abilities scaled by precision, as the engine already does for prec < 100 |
| `__Sfrz` / `__Sshat` | main loop | frozen card casts nothing; 40 ice-break damage after its frozen cast phase |
| `__Sfocus` | `fe()` (enemy hits) | sensitivity only: the enemy focuses a chosen card of ours |
| `_rk` check | main loop | a card killed by reflect stops casting that turn |

- `e1_runner.js` loads an engine in a `vm` context, as `SP/scripts/sim_lab2.js` does. It calls
  `ht(model).evaluate(sel, {optimize:false, suggestions:false, shop:false})` and keeps `score`. A **fresh
  `ht()` instance is built per scenario**, because `evaluate()` memoises its last 30 results keyed on the selection
  only: a cached baseline would otherwise leak into a stress run.

### 1.2 What the engine does where the hooks attach (FACTS, read from `engine_pretty.js`)

- **Opponent.** The opponent is 4 abstract cards per profile: neutral 700 HP and 10 % resistance; fragile 550 / 5 %;
  tank 900 / 15 %; six "anti-X" profiles at 700 HP with +25 % in X (35 % in total). Each living enemy card deals
  `dpsByTurn[t]/4` per turn (108 → 253), cut into hits of ~70 (`fe()`). 21 % of each hit (`aoeShare`) is spread over
  our living cards; the rest lands on our taunter or, failing that, on **our living card with the lowest current
  HP**. The opponent has no precision effect, taunt, freeze, reflect or absorb.
- **Our damage, per hit, as an expected value (`B()`).** It is
  `(1−c)·round(round(p)·(1−res)) + c·round(round(p·mult)·(1−res))`, multiplied by precision
  `L = clamp((abilityPrec+cardPrec+teamPrec)/100, 0, 1)` and by the number of targets.
- **Damage distribution (`G()`).** The total goes to the living enemy cards sorted by **lowest HP, then index**:
  - `aoeEnemy` splits it equally over all of them.
  - `enemy`, `randomEnemy` and `spreadEnemy` put everything on the head of that list.
  - Damage beyond a card's HP is lost.
- **Turn order.** As player 1 we cast and then get hit; as player 2 we get hit first. A card casts all its ready
  abilities each turn (`oneActionPerCardPerTurn:false`): support first, then damage, by heuristic value. The first
  cast happens on turn `cd` as player 1 and on turn `cd−1` as player 2.
- **Score.** `J = offense + 0.35·(EHP left + defense credits) + 0.8·control + 0.5·economy`.
  - If all 4 enemy cards die: offense = `3·2800·(1 + 1.5·(10−ttk)/10)`.
  - Otherwise: offense = `3·min(useful damage weighted by turn · 2800/totalHp, 2800)`.
  - Offense is 91 % of deck chimere's score.
- **Our own Renvoi** (`H()`) is modelled as unresisted damage `G(e,t,dmgTaken·pct)`. S-REFLECT mirrors this convention.

### 1.3 Scenarios and assumptions

| ID | Scenario | Definition / assumption | Source of the numbers |
|---|---|---|---|
| T600 / T900 (T1200 extra) | **S-TAUNT** | The last enemy card is a permanent taunter with 600 HP (variant 900; 1,200 as a sensitivity). It keeps the profile resistances (Fleur has 0 %, so this is slightly pessimistic) and keeps its 1/4 share of the enemy damage. While it lives, the damage of `enemy` / `randomEnemy` options from a non-Brut card goes to it first; this includes the main target of an Aoe-Tox splash. `aoeEnemy`, `spreadEnemy` and `spreadField`, Brut cards, our Renvoi and Bomba are not redirected. **Controls** T600c / T900c / T1200c have the same HP and no forcing, which isolates the forcing effect. | Fleur de Vie #222: 600 HP, Barrière Florale CD 1, taunt on self for 2 turns, so it is renewed every turn (`cards_compact.txt`). Brut_R: "Ignore les résistances et les provocations" (`tox_fr.json`). |
| F3p0–3 / F2p0–3 | **S-FREEZE** (spec) | The card at deck position p casts nothing on turns 2, 5 and 8 (variant: 2, 4, 6, 8, 10). Its ready abilities wait (no cooldown consumed) and its passives keep working. The ice breaks for **40 raw damage** after its frozen cast phase: the enemy's 21 % AoE share hits every card every turn, so the ice nearly always breaks. Thawing by our own heal is not modelled. F3n repeats F3 without the 40 damage. Each of the 4 positions is run; worst and average are reported. | Frozen_E: "…brise la glace et lui inflige 40 dégâts" (`tox_fr.json`). Gel abilities: CD 3 on #23, #59, #91, #211; CD 4 on #29, #34; Gel passive on #92 and #259; Gel epic Tox at 150 Spamtons. |
| FT3p / FT2p | S-FREEZE timed (added) | An enemy Gel of CD 3 (resp. 2), usable from turn 2, is spent only on a turn where the target has a damaging ability ready (any ability for a pure-support card). It then recharges. This removes the cooldown-alignment luck of fixed patterns. **Fz3 / Fz2** = worst over the fixed and timed patterns and over the 4 cards; these are the values used in the ranking sets. | as above |
| P20 (P10, P5) | **S-PREC** | −20 precision points on all our cards for the whole match, as an expected value: `clamp((100 − 20 + buffs)/100)` = ×0.8 on every hit (all owned abilities have precision 100). Gen and buff effects carried by damaging abilities are scaled the same way; heals are unaffected (as in the engine). P10 / P5 are lighter, more common intensities. | Imprécision talent (#27, #188): −20 % on ONE random enemy card ≈ −5 on average → P5. Luminaire Abyssal #81 Phare: −10 % to all, CD 4 → P10. Erreur Croissante: −3 on a random card per attack. Fumée. So −20 on all 4 cards is an upper bound. |
| RC / RE (RR, RL extra) | **S-REFLECT** | Every enemy card has Renvoi. Reflected damage = pct × the damage each enemy card **actually took** (overkill excluded), summed over the cast and applied unresisted to the attacking card through the engine's `H()` (shield, death and Phénix logic). Only ability damage is reflected: not our Renvoi or Bomba, and reflected damage is not reflected again. A card killed by reflect stops casting that turn. Lifesteal resolves before the damage (engine order); **REa** (reflect lands, then lifesteal) and **REn** (lifesteal nets the reflect of the same cast) bracket the unknown order. | Reflect_C 25 %, Reflect_R 50 %, Reflect_E 75 %, Reflect_L 100 % (`tox_fr.json`, engine `r{}` table). |
| R1E3 / R1E0 | realism (added) | **One** enemy card has Renvoi épique: the one our single-target hits reach last (index 3) or first (index 0). | L'Épine d'Amour #106: innate Reflect_E 75 %. |
| T900RE | combo (extra) | 900-HP taunter carrying Renvoi épique; only the taunter reflects. | — |
| EF / EFRE | opponent-model sensitivity | The enemy's single-target hits go to our card at position p instead of our lowest-HP card, without and with Renvoi E on all 4. | — |

### 1.4 Decks

- The 4 saved decks (deck aleera includes #231, which is not owned).
- The 2 robust alternatives.
- The **top 300 decks by baseline** among the 31,465 decks of `site/data.json`, keeping only decks with 4 owned
  cards. Keys are decoded with `parseInt(char, 32)` into `app/pool_order.json`.

5 named decks are inside the top 300, so **301 decks** in total (300 owned). Deck chimere is owned rank 1.

### 1.5 Compute

- Final results: 45 scenarios × 301 decks (`st_0..5.json`, 6 processes, ≤ 238 s each), plus 4 scenarios × 301
  (`new_R.json`, 112 s), for **14,749 `evaluate()` calls**.
- Validation: 903 more calls per pass.
- About 17 min of wall time in total, including two discarded earlier iterations. At most 7 node processes ran at
  once, for under 2 minutes.
- Provenance of the 45-scenario shards: they ran on engine `df7146aa…`. It differs from the final engine only by the
  inert `reflectOne` line. A re-run of 12 decks × 45 scenarios on the final engine matched 540/540 values
  (max |Δ| = 0).

### 1.6 Further checks

- Chimère frozen on turns 2/5/8 casts Galop arctique on turns 3/6/9.
- A debug log shows Murmures and Prisonnière hits redirected onto a 900-HP taunter, while Hippocampe (Brut) is
  never redirected.
- Reflect 25 % on deck chimere (neutral, P1): 579 reflected = 25 % × 2,316 damage dealt.
- The per-match diagnostics (mean over the 18 q() runs) equal `evaluate().score` on 270/270 deck × scenario checks.

## 2. Results — saved decks

### T1 — Saved decks and robust alternatives (score, change vs baseline)

| Deck | Cards | Baseline | S-TAUNT 600 | S-TAUNT 900 | S-FREEZE 1/3 worst (card) | S-FREEZE 1/3 avg | S-FREEZE 1/2 worst (card) | S-PREC −20 | S-REFLECT C 25 % | S-REFLECT E 75 % |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| deck chimere | 103, 238, 156, 117 | 8,018 | 8,207 (+2.4 %) | 7,673 (−4.3 %) | 6,052 (−24.5 %) #238 | 7,015 (−12.5 %) | 6,644 (−17.1 %) #103 | 6,751 (−15.8 %) | 8,020 (+0.0 %) | 3,722 (−53.6 %) |
| anti-critiques | 12, 238, 27, 117 | 6,989 | 6,952 (−0.5 %) | 6,431 (−8.0 %) | 5,309 (−24.0 %) #238 | 6,199 (−11.3 %) | 5,768 (−17.5 %) #27 | 5,205 (−25.5 %) | 6,665 (−4.6 %) | 4,766 (−31.8 %) |
| zéro critique | 102, 116, 12, 69 | 6,529 | 6,823 (+4.5 %) | 6,044 (−7.4 %) | 5,053 (−22.6 %) #102 | 5,342 (−18.2 %) | 4,214 (−35.5 %) #102 | 4,668 (−28.5 %) | 5,476 (−16.1 %) | 4,223 (−35.3 %) |
| deck aleera | 231, 238, 156, 117 | 12,847 | 12,869 (+0.2 %) | 8,997 (−30.0 %) | 6,871 (−46.5 %) #231 | 10,512 (−18.2 %) | 8,440 (−34.3 %) #231 | 9,336 (−27.3 %) | 6,847 (−46.7 %) | 6,934 (−46.0 %) |
| robuste A [3,103,117,238] | 3, 103, 117, 238 | 7,625 | 7,716 (+1.2 %) | 7,146 (−6.3 %) | 5,999 (−21.3 %) #3 | 6,427 (−15.7 %) | 5,441 (−28.6 %) #103 | 6,027 (−21.0 %) | 7,225 (−5.3 %) | 6,528 (−14.4 %) |
| robuste B [69,160,227,238] | 69, 160, 227, 238 | 6,077 | 5,995 (−1.4 %) | 5,882 (−3.2 %) | 5,400 (−11.1 %) #238 | 5,497 (−9.5 %) | 5,339 (−12.2 %) #69 | 4,949 (−18.6 %) | 5,694 (−6.3 %) | 4,590 (−24.5 %) |

### T2 — Saved decks: sensitivities and extras (change vs baseline unless stated)

| Deck | TAUNT 1200 | forcing only 600 / 900 / 1200 (vs same-HP control) | FREEZE 1/3 worst w/o ice-break dmg | FREEZE timed Gel CD 3: worst (card) / avg | FREEZE timed Gel CD 2: worst (card) / avg | REFLECT R 50 % | REFLECT L 100 % | REFLECT E: engine / reflect-then-lifesteal / netted | Taunter 900 + Renvoi E on it |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| deck chimere | −11.7 % | +0.0 % / +0.6 % / +1.2 % | −24.0 % | −20.7 % (#238) / −12.3 % | −20.7 % (#238) / −13.9 % | −28.4 % | −54.3 % | −53.6 % / −50.6 % / −41.5 % | −4.6 % |
| anti-critiques | −15.1 % | −0.3 % / −1.9 % / −1.5 % | −18.9 % | −29.4 % (#238) / −14.2 % | −29.4 % (#238) / −14.2 % | −18.5 % | −33.5 % | −31.8 % / −32.2 % / −31.8 % | −10.5 % |
| zéro critique | −13.2 % | −0.4 % / −1.4 % / +1.1 % | −20.0 % | −22.6 % (#102) / −18.1 % | −35.5 % (#102) / −26.7 % | −30.3 % | −42.8 % | −35.3 % / −35.3 % / −35.3 % | −42.0 % |
| deck aleera | −30.0 % | +0.0 % / +0.0 % / +0.0 % | −35.2 % | −42.6 % (#231) / −16.3 % | −42.6 % (#231) / −16.3 % | −49.4 % | −75.0 % | −46.0 % / −45.8 % / −45.8 % | −44.1 % |
| robuste A [3,103,117,238] | −11.8 % | +0.0 % / −0.7 % / +1.8 % | −17.8 % | −21.3 % (#3) / −15.5 % | −28.6 % (#103) / −19.0 % | −7.7 % | −30.6 % | −14.4 % / −13.2 % / −13.2 % | −16.9 % |
| robuste B [69,160,227,238] | −11.5 % | −0.8 % / +3.6 % / +3.5 % | −8.5 % | −11.6 % (#238) / −9.7 % | −12.2 % (#69) / −10.8 % | −12.2 % | −26.4 % | −24.5 % / −21.8 % / −21.7 % | −7.8 % |

### T2b — Saved decks: weaker, more common intensities (change vs baseline)

| Deck | PREC −5 (one Imprécision talent, EV) | PREC −10 (one Phare, AoE −10 %) | PREC −20 | ONE enemy card with Renvoi E, attacked last | ONE enemy card with Renvoi E, attacked first | Renvoi C on all 4 | Renvoi E on all 4 |
|---|---:|---:|---:|---:|---:|---:|---:|
| deck chimere | −3.5 % | −7.5 % | −15.8 % | +0.5 % | −0.1 % | +0.0 % | −53.6 % |
| anti-critiques | −4.1 % | −7.8 % | −25.5 % | −0.9 % | −3.0 % | −4.6 % | −31.8 % |
| zéro critique | −4.7 % | −17.1 % | −28.5 % | −0.1 % | −29.0 % | −16.1 % | −35.3 % |
| deck aleera | −8.9 % | −22.6 % | −27.3 % | −41.2 % | −41.2 % | −46.7 % | −46.0 % |
| robuste A [3,103,117,238] | −5.9 % | −10.8 % | −21.0 % | −0.4 % | −12.1 % | −5.3 % | −14.4 % |
| robuste B [69,160,227,238] | −5.4 % | −8.4 % | −18.6 % | −0.4 % | −17.2 % | −6.3 % | −24.5 % |

### T3 — Saved decks: S-FREEZE by frozen card (change vs baseline; fixed 1 turn in 3 / fixed every other turn / timed Gel CD 3)

| Deck | pos 1 | pos 2 | pos 3 | pos 4 |
|---|---|---|---|---|
| deck chimere | #103 Lame de la forêt: −10.7 % / −17.1 % / −10.7 % | #238 Chimère Brasse-chair: −24.5 % / −9.8 % / −20.7 % | #156 L'Œil des montagnes: −2.2 % / −3.1 % / −5.1 % | #117 Keria: −12.6 % / −17.0 % / −12.6 % |
| anti-critiques | #12 Hibernatus: −7.7 % / −4.4 % / −6.0 % | #238 Chimère Brasse-chair: −24.0 % / −10.9 % / −29.4 % | #27 Hippocampe Nimbé: −8.8 % / −17.5 % / −16.6 % | #117 Keria: −4.7 % / −8.4 % / −4.7 % |
| zéro critique | #102 Murmures du Corail Noir: −22.6 % / −35.5 % / −22.6 % | #116 Prisonnière de la Machine: −20.4 % / −34.9 % / −20.4 % | #12 Hibernatus: −10.4 % / −14.7 % / −10.1 % | #69 Scorch: −19.3 % / −26.4 % / −19.3 % |
| deck aleera | #231 Aleera Mange-Cauchemars: −46.5 % / −34.3 % / −42.6 % | #238 Chimère Brasse-chair: −12.3 % / −1.0 % / −14.1 % | #156 L'Œil des montagnes: −0.3 % / +1.9 % / +5.0 % | #117 Keria: −13.6 % / −16.0 % / −13.6 % |
| robuste A [3,103,117,238] | #3 Esprit Nature: −21.3 % / −25.4 % / −21.3 % | #103 Lame de la forêt: −18.9 % / −28.6 % / −18.9 % | #117 Keria: −9.1 % / −12.6 % / −9.1 % | #238 Chimère Brasse-chair: −13.6 % / −4.2 % / −12.9 % |
| robuste B [69,160,227,238] | #69 Scorch: −7.7 % / −12.2 % / −7.7 % | #160 Sanglier Doré: −9.2 % / −4.6 % / −9.3 % | #227 Chouette Polychrome: −10.2 % / −4.3 % / −10.2 % | #238 Chimère Brasse-chair: −11.1 % / −4.4 % / −11.6 % |

### T4 — Saved decks: worst case and mean over the scenario sets

Main set = {TAUNT 600, Fz3 = FREEZE 1-in-3 (worst card, worst of fixed turns 2/5/8 and timed Gel CD 3), PREC −20, REFLECT C}. Harsh set = {TAUNT 900, Fz2 = FREEZE every other turn (worst card, worst of fixed and timed Gel CD 2), PREC −20, REFLECT E}.

| Deck | Baseline | main: worst (scenario) | main: mean drop | main: min score | harsh: worst (scenario) | harsh: mean drop | harsh: min score |
|---|---:|---:|---:|---:|---:|---:|---:|
| deck chimere | 8,018 | −24.5 % (Fz3) | −9.5 % | 6,052 | −53.6 % (RE) | −23.6 % | 3,722 |
| anti-critiques | 6,989 | −29.4 % (Fz3) | −15.0 % | 4,936 | −31.8 % (RE) | −23.7 % | 4,766 |
| zéro critique | 6,529 | −28.5 % (P20) | −15.7 % | 4,668 | −35.5 % (Fz2) | −26.7 % | 4,214 |
| deck aleera | 12,847 | −46.7 % (RC) | −30.1 % | 6,847 | −46.0 % (RE) | −36.5 % | 6,934 |
| robuste A [3,103,117,238] | 7,625 | −21.3 % (Fz3) | −11.6 % | 5,999 | −28.6 % (Fz2) | −17.6 % | 5,441 |
| robuste B [69,160,227,238] | 6,077 | −18.6 % (P20) | −9.5 % | 4,949 | −24.5 % (RE) | −14.6 % | 4,590 |

### Reading the saved decks

**deck chimere [103,238,156,117]**: Chimère deals 90.5 % of the damage, and Keria and L'Œil deal none.

- *Freeze.* Losing Chimère's turns is the main risk: −24.5 % with the fixed 1-in-3 pattern, −20.7 % timed. The
  fixed every-other-turn pattern only costs −9.8 %, because Galop arctique (CD 2) is ready on the odd turns for
  player 2 and loses only 1 cast in 5 for player 1. This is alignment luck that a timed Gel removes.
- *Reflect.* 25 % reflect is absorbed: Vampirisme 75 % plus the overheal of two healers soak 539 reflected damage
  per match, so the change is 0.0 %. At 50 % the loss is −28.4 %, at 75 % −53.6 % (Chimère always dies on turn
  7: its 525 HP are the enemy's focus and its casts reach 361 → 584 → 879). At 100 % it is −54.3 %.
- *Kills.* In the baseline the deck kills only 0.94 enemy card per match.
- *Ranking.* Over the harsh set it ranks 232/300 on worst case. Over the mild set it stays #1 (6,052).

**robuste A [3,103,117,238]**: the damage is spread (Chimère 56 %, Lame 27 %, Esprit Nature 17 %), and no
damage boost from L'Œil feeds Chimère's casts.

- *Reflect.* Under Renvoi épique on all 4 cards, Esprit Nature (500 HP, the enemy's focus) dies in 18/18 matches,
  but Chimère only in 2/18, both times on turn 10. The loss is −14.4 %. With the enemy focusing Chimère instead it
  is −16.9 %.
- *Weak spot.* Freezing Lame every other turn costs −28.6 %.

**robuste B [69,160,227,238]** has the smallest mean drops of the named decks (main −9.5 %, harsh −14.6 %),
but a low baseline (6,077).

**zéro critique [102,116,12,69]** is the most exposed to S-PREC (−28.5 %), to freeze every other turn (−35.5 %)
and to a reflecting taunter (−42.0 %). It is a single-target deck, so taunt and Renvoi on the card it attacks
land fully.

**deck aleera** (not owned) loses 46–49 % to reflect at 25–75 % (−75 % at 100 %), −41.2 % even to a single
Renvoi-E card, and 30 % to a 900-HP taunter. Its score depends on finishing kills before turn 10, and Aleera (500 HP, no lifesteal) dies to its own
reflected damage. Even so, its worst case (6,847 / 6,934) remains the highest of all decks studied.

## 3. Robustness ranking (300 owned decks)

Sets used:

- **Main** = {TAUNT 600, Fz3, PREC −20, REFLECT C}
- **Harsh** = {TAUNT 900, Fz2, PREC −20, REFLECT E}

"Min score" is the deck's worst score over the set (maximin). It is what decides a match against an opponent who
brings that mechanic. Which scenario binds the worst case:

- Harsh set: REFLECT E for 127 decks, Fz2 for 100, PREC for 73, TAUNT 900 for none.
- Main set: PREC for 153 decks, Fz3 for 145, REFLECT C for 2.

The median deck keeps 73.6 % of its baseline in its harsh worst case.

### T5 — Owned decks ranked by worst-case score over the HARSH set (maximin) (first 10)

| # | Cards | Owned rank (baseline) | Baseline | harsh min score (worst scen.) | harsh mean drop | main min score | TAUNT 900 | Fz3 (card, mode) | Fz2 (card, mode) | PREC −20 | REFLECT C | REFLECT E |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | #3 Esprit Nature, #103 Lame de la forêt, #117 Keria, #238 Chimère Brasse-chair | 3 | 7,625 | 5,441 (Fz2) | −17.6 % | 5,999 | −6.3 % | −21.3 % #3 fixed | −28.6 % #103 fixed | −21.0 % | −5.3 % | −14.4 % |
| 2 | #3 Esprit Nature, #103 Lame de la forêt, #156 L'Œil des montagnes, #238 Chimère Brasse-chair | 13 | 6,707 | 5,038 (Fz2) | −18.1 % | 5,112 | −5.8 % | −23.8 % #238 fixed | −24.9 % #103 fixed | −19.6 % | −1.2 % | −22.2 % |
| 3 | #12 Hibernatus, #103 Lame de la forêt, #117 Keria, #238 Chimère Brasse-chair | 32 | 6,218 | 5,009 (RE) | −14.9 % | 5,079 | −4.9 % | −17.0 % #238 timed | −17.0 % #238 timed | −18.3 % | −0.5 % | −19.4 % |
| 4 | #2 Esprit Eau, #69 Scorch, #82 Baleine Farceuse, #102 Murmures du Corail Noir | 21 | 6,490 | 4,941 (Fz2) | −14.4 % | 5,373 | −1.7 % | −16.8 % #82 timed | −23.9 % #102 fixed | −17.2 % | −2.4 % | −14.7 % |
| 5 | #69 Scorch, #102 Murmures du Corail Noir, #117 Keria, #238 Chimère Brasse-chair | 4 | 7,165 | 4,937 (Fz2) | −16.6 % | 5,435 | −3.4 % | −24.1 % #102 fixed | −31.1 % #102 fixed | −18.9 % | −3.7 % | −13.1 % |
| 6 | #12 Hibernatus, #69 Scorch, #102 Murmures du Corail Noir, #238 Chimère Brasse-chair | 31 | 6,232 | 4,937 (Fz2) | −13.5 % | 4,958 | −5.0 % | −15.1 % #69 fixed | −20.8 % #102 fixed | −20.4 % | −3.3 % | −7.9 % |
| 7 | #69 Scorch, #102 Murmures du Corail Noir, #160 Sanglier Doré, #238 Chimère Brasse-chair | 33 | 6,210 | 4,878 (P20) | −15.3 % | 4,878 | −7.0 % | −16.7 % #69 fixed | −20.9 % #69 fixed | −21.4 % | −4.0 % | −11.7 % |
| 8 | #12 Hibernatus, #103 Lame de la forêt, #156 L'Œil des montagnes, #238 Chimère Brasse-chair | 65 | 5,978 | 4,877 (P20) | −11.7 % | 4,665 | −5.8 % | −22.0 % #238 fixed | −17.9 % #238 timed | −18.4 % | −1.4 % | −4.6 % |
| 9 | #69 Scorch, #82 Baleine Farceuse, #102 Murmures du Corail Noir, #238 Chimère Brasse-chair | 23 | 6,419 | 4,867 (Fz2) | −16.9 % | 4,945 | −10.9 % | −16.5 % #69 fixed | −24.2 % #69 fixed | −23.0 % | −2.6 % | −9.7 % |
| 10 | #69 Scorch, #82 Baleine Farceuse, #160 Sanglier Doré, #238 Chimère Brasse-chair | 71 | 5,940 | 4,823 (P20) | −13.1 % | 4,823 | −8.3 % | −13.8 % #82 timed | −14.3 % #69 fixed | −18.8 % | −3.6 % | −11.1 % |

### T6 — Owned decks ranked by worst-case score over the MAIN set (maximin) (first 5)

| # | Cards | Owned rank (baseline) | Baseline | harsh min score (worst scen.) | harsh mean drop | main min score | TAUNT 900 | Fz3 (card, mode) | Fz2 (card, mode) | PREC −20 | REFLECT C | REFLECT E |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | #103 Lame de la forêt, #238 Chimère Brasse-chair, #156 L'Œil des montagnes, #117 Keria | 1 | 8,018 | 3,722 (RE) | −23.6 % | 6,052 | −4.3 % | −24.5 % #238 fixed | −20.7 % #238 timed | −15.8 % | +0.0 % | −53.6 % |
| 2 | #3 Esprit Nature, #103 Lame de la forêt, #117 Keria, #238 Chimère Brasse-chair | 3 | 7,625 | 5,441 (Fz2) | −17.6 % | 5,999 | −6.3 % | −21.3 % #3 fixed | −28.6 % #103 fixed | −21.0 % | −5.3 % | −14.4 % |
| 3 | #102 Murmures du Corail Noir, #117 Keria, #156 L'Œil des montagnes, #238 Chimère Brasse-chair | 7 | 6,953 | 4,491 (RE) | −20.4 % | 5,574 | −2.8 % | −19.8 % #238 fixed | −24.6 % #102 fixed | −18.9 % | −5.8 % | −35.4 % |
| 4 | #12 Hibernatus, #117 Keria, #156 L'Œil des montagnes, #238 Chimère Brasse-chair | 8 | 6,939 | 3,854 (RE) | −21.6 % | 5,535 | −4.3 % | −20.2 % #238 fixed | −18.9 % #238 timed | −18.8 % | −1.9 % | −44.5 % |
| 5 | #69 Scorch, #102 Murmures du Corail Noir, #117 Keria, #238 Chimère Brasse-chair | 4 | 7,165 | 4,937 (Fz2) | −16.6 % | 5,435 | −3.4 % | −24.1 % #102 fixed | −31.1 % #102 fixed | −18.9 % | −3.7 % | −13.1 % |

### T7 — Owned decks with baseline ≥ 6,000 ranked by smallest mean drop over the HARSH set (first 10)

| # | Cards | Owned rank (baseline) | Baseline | harsh min score (worst scen.) | harsh mean drop | main min score | TAUNT 900 | Fz3 (card, mode) | Fz2 (card, mode) | PREC −20 | REFLECT C | REFLECT E |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | #12 Hibernatus, #69 Scorch, #102 Murmures du Corail Noir, #238 Chimère Brasse-chair | 31 | 6,232 | 4,937 (Fz2) | −13.5 % | 4,958 | −5.0 % | −15.1 % #69 fixed | −20.8 % #102 fixed | −20.4 % | −3.3 % | −7.9 % |
| 2 | #2 Esprit Eau, #69 Scorch, #82 Baleine Farceuse, #102 Murmures du Corail Noir | 21 | 6,490 | 4,941 (Fz2) | −14.4 % | 5,373 | −1.7 % | −16.8 % #82 timed | −23.9 % #102 fixed | −17.2 % | −2.4 % | −14.7 % |
| 3 | #69 Scorch, #102 Murmures du Corail Noir, #156 L'Œil des montagnes, #238 Chimère Brasse-chair | 50 | 6,081 | 4,404 (Fz2) | −14.4 % | 5,001 | −3.9 % | −17.2 % #102 fixed | −27.6 % #102 fixed | −17.8 % | −0.9 % | −8.5 % |
| 4 | #69 Scorch, #160 Sanglier Doré, #227 Chouette Polychrome, #238 Chimère Brasse-chair | 52 | 6,077 | 4,590 (RE) | −14.6 % | 4,949 | −3.2 % | −11.6 % #238 timed | −12.2 % #69 fixed | −18.6 % | −6.3 % | −24.5 % |
| 5 | #12 Hibernatus, #103 Lame de la forêt, #117 Keria, #238 Chimère Brasse-chair | 32 | 6,218 | 5,009 (RE) | −14.9 % | 5,079 | −4.9 % | −17.0 % #238 timed | −17.0 % #238 timed | −18.3 % | −0.5 % | −19.4 % |
| 6 | #69 Scorch, #82 Baleine Farceuse, #102 Murmures du Corail Noir, #160 Sanglier Doré | 54 | 6,066 | 4,623 (Fz2) | −15.1 % | 4,855 | −4.6 % | −19.8 % #69 fixed | −23.8 % #102 fixed | −20.0 % | −3.5 % | −11.9 % |
| 7 | #69 Scorch, #102 Murmures du Corail Noir, #160 Sanglier Doré, #238 Chimère Brasse-chair | 33 | 6,210 | 4,878 (P20) | −15.3 % | 4,878 | −7.0 % | −16.7 % #69 fixed | −20.9 % #69 fixed | −21.4 % | −4.0 % | −11.7 % |
| 8 | #2 Esprit Eau, #69 Scorch, #102 Murmures du Corail Noir, #238 Chimère Brasse-chair | 17 | 6,523 | 4,821 (Fz2) | −16.2 % | 5,151 | −5.3 % | −19.7 % #102 fixed | −26.1 % #102 fixed | −21.0 % | −2.3 % | −12.3 % |
| 9 | #3 Esprit Nature, #27 Hippocampe Nimbé, #103 Lame de la forêt, #238 Chimère Brasse-chair | 59 | 6,015 | 4,554 (P20) | −16.2 % | 4,554 | −9.4 % | −16.9 % #238 fixed | −20.9 % #3 fixed | −24.3 % | −2.5 % | −10.3 % |
| 10 | #3 Esprit Nature, #12 Hibernatus, #117 Keria, #238 Chimère Brasse-chair | 56 | 6,047 | 4,744 (RE) | −16.4 % | 4,778 | −5.3 % | −18.3 % #238 fixed | −17.7 % #238 timed | −21.0 % | −0.7 % | −21.5 % |

### T14 — Opponent-model sensitivity: the enemy focuses one of our cards instead of our lowest-HP card (change vs baseline)

EF top = enemy single-target hits on our top damage card; worst = worst of the 4 positions. "harsh+focus" = harsh set with REFLECT E evaluated under the worst focus.

| Deck | Baseline | REFLECT E (engine targeting) | EF top (card) | EF top + REFLECT E | EF worst | EF + REFLECT E worst (card) | harsh min score → harsh+focus min score | maximin rank harsh → harsh+focus |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| deck chimere | 8,018 | −53.6 % | +1.2 % (#238) | −53.6 % | −2.0 % | −53.6 % (#238) | 3,722 → 3,722 | 232 → 203 |
| anti-critiques | 6,989 | −31.8 % | +0.0 % (#238) | −31.8 % | −9.6 % | −31.8 % (#238) | 4,766 → 4,766 | 14 → 12 |
| zéro critique | 6,529 | −35.3 % | −30.8 % (#116) | −42.0 % | −30.8 % | −49.5 % (#102) | 4,214 → 3,301 | 128 → 256 |
| deck aleera | 12,847 | −46.0 % | +0.0 % (#231) | −46.0 % | −44.2 % | −55.8 % (#238) | 6,934 → 5,681 | — → — |
| robuste A [3,103,117,238] | 7,625 | −14.4 % | +1.5 % (#238) | −16.9 % | −2.8 % | −16.9 % (#238) | 5,441 → 5,441 | 1 → 1 |
| robuste B [69,160,227,238] | 6,077 | −24.5 % | −3.0 % (#227) | −15.2 % | −3.0 % | −24.5 % (#69) | 4,590 → 4,590 | 36 → 25 |
| 3, 103, 156, 238 | 6,707 | −22.2 % | +1.9 % (#238) | −24.5 % | +0.0 % | −24.5 % (#238) | 5,038 → 5,038 | 2 → 2 |
| 12, 103, 117, 238 | 6,218 | −19.4 % | +0.9 % (#238) | −19.4 % | −1.8 % | −19.4 % (#238) | 5,009 → 5,009 | 3 → 3 |
| 2, 69, 82, 102 | 6,490 | −14.7 % | +7.2 % (#82) | −3.7 % | −9.7 % | −23.0 % (#102) | 4,941 → 4,941 | 4 → 4 |
| 69, 102, 117, 238 | 7,165 | −13.1 % | +10.9 % (#238) | −30.7 % | −11.8 % | −54.5 % (#102) | 4,937 → 3,262 | 5 → 259 |
| 12, 69, 102, 238 | 6,232 | −7.9 % | +4.6 % (#238) | −8.9 % | −2.8 % | −16.1 % (#102) | 4,937 → 4,937 | 6 → 5 |
| 69, 102, 160, 238 | 6,210 | −11.7 % | +15.4 % (#238) | −15.4 % | −3.1 % | −15.4 % (#238) | 4,878 → 4,878 | 7 → 6 |
| 12, 103, 156, 238 | 5,978 | −4.6 % | +0.0 % (#238) | −4.6 % | −2.2 % | −5.6 % (#103) | 4,877 → 4,877 | 8 → 7 |
| 69, 82, 102, 238 | 6,419 | −9.7 % | +14.9 % (#82) | +6.4 % | −6.6 % | −14.5 % (#102) | 4,867 → 4,867 | 9 → 8 |
| 69, 82, 160, 238 | 5,940 | −11.1 % | +14.6 % (#82) | +1.9 % | +0.0 % | −11.1 % (#69) | 4,823 → 4,823 | 10 → 9 |

Over the 300 owned decks: EF top median +1.1 %; EF + REFLECT E worst median −27.6 % (REFLECT E with engine targeting: −22.3 %).

The top-4 maximin decks keep ranks 1–4 when the enemy focuses our damage card (or any card) instead of our
lowest-HP card. [69,102,117,238] falls from 5 to 259 (Murmures focused + Renvoi E: −54.5 %). Focusing Chimère is
usually a *gain* for us (+4.4 % mean, +2.1 % median over the 208 decks with Chimère), because the enemy then pours its damage into a 75 %
lifesteal card.

## 4. What makes a deck fragile or robust, per scenario

### T9 — Distribution of the change over the 300 owned decks (top-300 by baseline + named)

| Scenario | median | p10 (mildest) | p90 (harshest) | best deck | worst deck | decks losing > 20 % |
|---|---:|---:|---:|---:|---:|---:|
| S-TAUNT 600 | +1.9 % | +4.9 % | −1.0 % | +11.1 % | −4.1 % | 0 |
| S-TAUNT 900 | −6.0 % | −2.9 % | −11.9 % | +1.8 % | −20.5 % | 1 |
| S-TAUNT 1200 (extra) | −13.3 % | −10.3 % | −18.2 % | +3.5 % | −25.4 % | 19 |
| forcing only, 900 (vs same-HP control) | +0.4 % | +3.4 % | −5.9 % | +8.6 % | −15.3 % | 0 |
| S-FREEZE 1/3, worst card | −18.5 % | −12.7 % | −31.0 % | −8.8 % | −54.5 % | 126 |
| S-FREEZE 1/3, avg of 4 cards | −11.7 % | −8.2 % | −16.8 % | −4.1 % | −27.1 % | 6 |
| S-FREEZE 1/2, worst card | −18.0 % | −11.4 % | −34.6 % | −4.3 % | −58.6 % | 117 |
| S-FREEZE 1/2, avg of 4 cards | −11.3 % | −7.1 % | −20.4 % | −2.9 % | −36.9 % | 34 |
| S-FREEZE timed Gel CD 3, worst card | −18.9 % | −13.7 % | −35.0 % | −10.4 % | −60.2 % | 128 |
| S-FREEZE timed Gel CD 3, avg of 4 cards | −13.0 % | −9.7 % | −18.8 % | −5.6 % | −28.0 % | 19 |
| S-FREEZE timed Gel CD 2, worst card | −20.8 % | −14.6 % | −39.1 % | −10.5 % | −60.2 % | 166 |
| S-FREEZE timed Gel CD 2, avg of 4 cards | −14.5 % | −10.7 % | −22.8 % | −6.1 % | −36.9 % | 55 |
| Fz3 = worst card, worst of fixed 1/3 and timed CD 3 (main set) | −19.8 % | −13.8 % | −35.0 % | −10.5 % | −60.2 % | 146 |
| Fz2 = worst card, worst of fixed 1/2 and timed CD 2 (harsh set) | −20.8 % | −14.8 % | −39.1 % | −10.5 % | −60.2 % | 167 |
| S-PREC −5 (one Imprécision, EV) | −5.2 % | −3.3 % | −7.9 % | +1.4 % | −20.2 % | 1 |
| S-PREC −10 | −10.4 % | −8.0 % | −14.1 % | −1.9 % | −26.5 % | 2 |
| S-PREC −20 | −20.6 % | −16.7 % | −25.7 % | −11.0 % | −36.6 % | 164 |
| ONE enemy card with Renvoi E, attacked last | −0.3 % | +0.1 % | −10.9 % | +2.1 % | −27.1 % | 4 |
| ONE enemy card with Renvoi E, attacked first | −11.7 % | −3.6 % | −25.1 % | +1.3 % | −52.8 % | 65 |
| S-REFLECT C 25 % | −6.0 % | −1.6 % | −17.8 % | +1.2 % | −40.8 % | 19 |
| S-REFLECT R 50 % (extra) | −14.6 % | −4.6 % | −28.8 % | −1.3 % | −48.7 % | 84 |
| S-REFLECT E 75 % | −22.3 % | −10.7 % | −38.2 % | −4.6 % | −54.4 % | 176 |
| S-REFLECT E, reflect then lifesteal | −20.3 % | −8.6 % | −36.6 % | −2.7 % | −53.4 % | 156 |
| S-REFLECT E, lifesteal netted | −20.0 % | −8.0 % | −36.2 % | −2.0 % | −53.4 % | 150 |
| S-REFLECT L 100 % (extra) | −29.5 % | −16.9 % | −44.9 % | −7.6 % | −64.3 % | 249 |
| taunter 900 + Renvoi E on it (extra) | −15.1 % | −7.3 % | −25.4 % | −3.2 % | −56.3 % | 81 |

### T10 — Which card hurts most when frozen (owned decks containing the card; S-FREEZE on that card)

| Card | decks | mean damage share | fixed 1 turn in 3: mean | worst | fixed every other turn: mean | timed Gel CD 3: mean | worst | timed Gel CD 2: mean |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| #238 Chimère Brasse-chair | 208 | 54 % | −19.3 % | −54.5 % | −8.0 % | −20.2 % | −60.2 % | −20.2 % |
| #102 Murmures du Corail Noir | 83 | 25 % | −18.7 % | −51.5 % | −24.9 % | −18.7 % | −51.5 % | −24.9 % |
| #103 Lame de la forêt | 54 | 16 % | −16.3 % | −33.2 % | −24.5 % | −16.3 % | −33.2 % | −24.5 % |
| #3 Esprit Nature | 44 | 14 % | −15.4 % | −29.3 % | −20.1 % | −15.4 % | −29.3 % | −20.1 % |
| #5 Esprit Ombre | 7 | 5 % | −14.3 % | −17.2 % | −16.0 % | −14.3 % | −17.2 % | −16.0 % |
| #2 Esprit Eau | 63 | 12 % | −13.1 % | −32.8 % | −18.5 % | −13.1 % | −32.8 % | −18.5 % |
| #69 Scorch, les Lézards Ignés | 100 | 0 % | −12.9 % | −35.3 % | −17.7 % | −12.9 % | −35.3 % | −17.7 % |
| #227 Chouette Polychrome | 91 | 46 % | −12.8 % | −27.7 % | −9.8 % | −14.1 % | −35.3 % | −14.1 % |
| #6 Esprit Lumière | 7 | 6 % | −12.5 % | −17.1 % | −14.0 % | −12.5 % | −17.1 % | −14.0 % |
| #160 Sanglier Doré | 74 | 34 % | −11.4 % | −17.9 % | −4.8 % | −11.6 % | −18.5 % | −11.6 % |
| #4 Esprit Terre | 18 | 16 % | −11.0 % | −17.1 % | −14.2 % | −11.0 % | −17.1 % | −14.2 % |
| #1 Esprit Feu | 6 | 6 % | −10.4 % | −15.9 % | −13.4 % | −10.4 % | −15.9 % | −13.4 % |
| #116 Prisonnière de la Machine | 26 | 31 % | −10.2 % | −28.4 % | −15.8 % | −10.2 % | −28.4 % | −15.8 % |
| #12 Hibernatus | 94 | 17 % | −10.0 % | −23.9 % | −7.1 % | −9.0 % | −24.1 % | −9.0 % |
| #117 Keria | 104 | 0 % | −8.9 % | −19.9 % | −11.3 % | −8.9 % | −19.9 % | −8.9 % |
| #259 Dragon de la Cité Infernale | 3 | 15 % | −8.5 % | −10.3 % | −7.5 % | −8.9 % | −11.7 % | −8.9 % |
| #27 Hippocampe Nimbé | 47 | 24 % | −8.1 % | −11.3 % | −15.8 % | −14.8 % | −21.3 % | −14.8 % |
| #153 L'Inventeur | 12 | 25 % | −7.0 % | −10.2 % | −13.0 % | −7.0 % | −10.2 % | −13.0 % |
| #251 Roi Ombre | 12 | 24 % | −6.2 % | −8.9 % | −12.2 % | −11.3 % | −15.3 % | −11.3 % |
| #158 Lapin-Plume | 1 | 34 % | −4.9 % | −4.9 % | −10.8 % | −4.9 % | −4.9 % | −10.8 % |
| #180 Dragon Ciel | 7 | 24 % | −2.2 % | −6.0 % | −4.1 % | −3.2 % | −9.2 % | −4.1 % |
| #156 L'Œil des montagnes | 68 | 0 % | −2.0 % | −10.9 % | −2.8 % | −7.4 % | −27.9 % | −7.4 % |
| #243 Vivy | 8 | 24 % | −0.9 % | −2.9 % | −8.8 % | −7.6 % | −15.6 % | −7.6 % |
| #30 Naissance d'Aldrin | 1 | 10 % | −0.7 % | −0.7 % | −0.4 % | −0.4 % | −0.4 % | −0.4 % |
| #82 Baleine Farceuse | 62 | 43 % | −0.5 % | −4.7 % | −15.5 % | −14.7 % | −36.8 % | −14.7 % |

### T11 — Feature ↔ drop correlation over owned decks (Spearman ρ; positive = the feature goes with a LARGER loss)

| Drop | topCardShare | aoeShare | singleShare | healPerDmg | hasChimere | minHp | hpTotal | dmgCards | base |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| T600 | -0.03 | 0.07 | -0.07 | -0.11 | -0.02 | 0.03 | 0.06 | 0.06 | 0.00 |
| T900 | 0.03 | -0.10 | 0.10 | -0.23 | -0.32 | -0.10 | -0.04 | 0.08 | -0.06 |
| T900force | 0.03 | -0.13 | 0.13 | -0.21 | -0.33 | -0.06 | 0.00 | 0.08 | -0.06 |
| F3worst | 0.59 | 0.06 | -0.06 | 0.55 | -0.06 | 0.28 | -0.04 | -0.48 | 0.28 |
| F3avg | 0.40 | 0.00 | 0.00 | 0.45 | -0.14 | 0.12 | -0.23 | -0.26 | 0.23 |
| F2worst | 0.32 | -0.28 | 0.28 | 0.30 | -0.43 | -0.08 | -0.09 | -0.28 | 0.27 |
| FT3worst | 0.53 | -0.03 | 0.03 | 0.42 | -0.14 | 0.30 | 0.05 | -0.48 | 0.23 |
| FT3avg | 0.33 | -0.18 | 0.18 | 0.26 | -0.29 | 0.07 | -0.01 | -0.30 | 0.26 |
| Fz3 | 0.60 | 0.02 | -0.02 | 0.46 | -0.09 | 0.32 | 0.05 | -0.50 | 0.23 |
| Fz2 | 0.46 | -0.15 | 0.15 | 0.44 | -0.27 | 0.16 | -0.02 | -0.45 | 0.28 |
| P20 | -0.03 | -0.31 | 0.31 | 0.02 | -0.10 | 0.21 | 0.22 | 0.17 | 0.07 |
| RC | -0.03 | 0.13 | -0.13 | -0.28 | -0.09 | 0.23 | 0.09 | 0.11 | -0.06 |
| RE | 0.50 | 0.54 | -0.54 | 0.18 | 0.07 | 0.38 | -0.17 | -0.38 | 0.21 |
| REn | 0.27 | 0.35 | -0.35 | -0.01 | -0.09 | 0.43 | 0.00 | -0.24 | 0.10 |
| EFtop | -0.01 | 0.05 | -0.05 | -0.22 | -0.20 | 0.29 | 0.15 | 0.07 | -0.14 |
| EFREtop | 0.65 | 0.50 | -0.50 | 0.35 | 0.06 | 0.24 | -0.29 | -0.43 | 0.13 |

### T12 — Group means of the change (owned decks)

| Scenario | with Chimère #238 | without | AoE share ≥ 50 % | AoE share < 50 % | top card ≥ 60 % of dmg | top card < 45 % | with a Brut card |
|---|---:|---:|---:|---:|---:|---:|---:|
| T600 | +2.0 % (n=208) | +2.0 % (n=92) | +1.8 % (n=181) | +2.2 % (n=119) | +2.2 % (n=99) | +1.7 % (n=74) | +1.5 % (n=47) |
| T900 | −5.7 % (n=208) | −8.7 % (n=92) | −6.1 % (n=181) | −7.4 % (n=119) | −6.7 % (n=99) | −6.7 % (n=74) | −7.7 % (n=47) |
| T900force | +0.7 % (n=208) | −2.6 % (n=92) | +0.3 % (n=181) | −1.2 % (n=119) | −0.4 % (n=99) | −0.4 % (n=74) | −1.5 % (n=47) |
| F3worst | −20.4 % (n=208) | −21.2 % (n=92) | −21.6 % (n=181) | −19.4 % (n=119) | −26.0 % (n=99) | −14.8 % (n=74) | −19.8 % (n=47) |
| F2worst | −17.7 % (n=208) | −27.5 % (n=92) | −18.6 % (n=181) | −23.9 % (n=119) | −23.5 % (n=99) | −16.2 % (n=74) | −18.8 % (n=47) |
| FT3worst | −21.4 % (n=208) | −22.9 % (n=92) | −22.3 % (n=181) | −21.2 % (n=119) | −26.8 % (n=99) | −16.2 % (n=74) | −21.4 % (n=47) |
| Fz3 | −22.3 % (n=208) | −23.0 % (n=92) | −23.3 % (n=181) | −21.2 % (n=119) | −28.3 % (n=99) | −16.3 % (n=74) | −21.9 % (n=47) |
| Fz2 | −22.5 % (n=208) | −28.3 % (n=92) | −23.5 % (n=181) | −25.4 % (n=119) | −28.7 % (n=99) | −18.1 % (n=74) | −22.6 % (n=47) |
| P20 | −20.7 % (n=208) | −21.5 % (n=92) | −20.2 % (n=181) | −22.2 % (n=119) | −21.4 % (n=99) | −21.2 % (n=74) | −23.7 % (n=47) |
| RC | −8.0 % (n=208) | −8.3 % (n=92) | −9.7 % (n=181) | −5.8 % (n=119) | −10.4 % (n=99) | −7.1 % (n=74) | −7.3 % (n=47) |
| RE | −24.2 % (n=208) | −22.7 % (n=92) | −27.5 % (n=181) | −17.9 % (n=119) | −31.2 % (n=99) | −18.2 % (n=74) | −21.6 % (n=47) |
| REa | −21.0 % (n=208) | −22.7 % (n=92) | −24.1 % (n=181) | −17.5 % (n=119) | −26.2 % (n=99) | −17.6 % (n=74) | −19.7 % (n=47) |
| REn | −20.6 % (n=208) | −22.7 % (n=92) | −23.8 % (n=181) | −17.4 % (n=119) | −25.8 % (n=99) | −17.4 % (n=74) | −19.4 % (n=47) |
| RL | −31.2 % (n=208) | −29.8 % (n=92) | −35.0 % (n=181) | −24.2 % (n=119) | −39.9 % (n=99) | −23.6 % (n=74) | −27.8 % (n=47) |
| R1E3 | −3.2 % (n=208) | +0.0 % (n=92) | −3.3 % (n=181) | −0.7 % (n=119) | −4.7 % (n=99) | −0.9 % (n=74) | −3.4 % (n=47) |
| R1E0 | −11.0 % (n=208) | −18.7 % (n=92) | −14.1 % (n=181) | −12.2 % (n=119) | −14.0 % (n=99) | −12.5 % (n=74) | −10.2 % (n=47) |
| EFtop | +4.4 % (n=208) | −0.2 % (n=92) | +2.3 % (n=181) | +3.9 % (n=119) | +2.4 % (n=99) | +4.0 % (n=74) | +3.8 % (n=47) |
| EFREtop | −25.7 % (n=208) | −23.4 % (n=92) | −30.5 % (n=181) | −16.6 % (n=119) | −36.1 % (n=99) | −14.6 % (n=74) | −23.9 % (n=47) |

- **S-TAUNT.**
  - In this model the cost is the taunter's HP, not the forcing. The engine's enemy cards are identical, and the
    engine already focuses the lowest-HP enemy, which a 600-HP taunter usually is.
  - Forcing only (900 HP against its same-HP control): median +0.4 %, worst −15.3 %. Decks without Chimère lose
    more (−2.6 % against +0.7 %; Spearman ρ = −0.33 with having Chimère). Decks that heal more lose less (ρ = −0.21).
  - Robust features: AoE damage, Brut (#27 Hippocampe Nimbé), self-sustain.
  - Fragile: single-target damage into a taunter that also reflects (T900RE median −15.1 %, worst −56.3 %), and
    decks whose score hinges on completing kills (deck aleera −30.0 % from +200 HP).
- **S-FREEZE.**
  - Fragility follows damage concentration (ρ(Fz3, top-card share) = +0.60; ρ with the number of damage cards
    = −0.50). Top card ≥ 60 % of the damage: Fz3 −28.3 %; top card < 45 %: −16.3 %.
  - Keystone cards (average when that card is frozen, fixed 1-in-3 / timed CD 3):
    - Chimère −19.3 % / −20.2 % (up to −60.2 %)
    - Murmures −18.7 %
    - Lame −16.3 %
    - Esprit Nature −15.4 %
    - Scorch −12.9 %: it deals no damage, but Feau gives +3 fire / water / earth every turn
    - Keria −8.9 %: buffer
  - Cheap to lose: L'Œil −2.0 % / −7.4 %, because its value is passive (Berserk, Cœur d'eau) and survives freezing.
  - The ice-break damage is marginal (deck chimere −24.5 % with it, −24.0 % without).
  - Fixed patterns can miss a card's cooldown cycle: Baleine Farceuse loses −0.5 % with the fixed 1-in-3 pattern
    but −14.7 % with a timed Gel. Hence Fz = the worst of fixed and timed.
- **S-PREC.**
  - Close to proportional: −5 / −10 / −20 points cost −5.2 % / −10.4 % / −20.6 % at the median.
  - Single-target-heavy decks lose slightly more (ρ = +0.31 with the single-target share). So do decks with a Brut
    card (−23.7 %); Brut ignores resistance but not precision.
  - Deck chimere loses less than average (−15.8 %), even though offense is 91 % of its score.
- **S-REFLECT.**
  - Reflect is proportional to damage dealt and lands on the card that dealt it. The danger is one fragile carrier
    whose casts outgrow its HP (ρ(RE, top-card share) = +0.50, ρ(RE, AoE share) = +0.54). In this pool the AoE
    damage is carried by single fragile cards: Chimère 525 HP, Aleera 500 HP.
  - By group: top card ≥ 60 % of the damage −31.2 % against −18.2 % (< 45 %); AoE share ≥ 50 % −27.5 % against
    −17.9 %.
  - Lifesteal (Vampirisme 75 %) and healers neutralise small reflect but not 75 %. Deck chimere: RC 0.0 %, RE −53.6 %.
  - With a **single** Renvoi-E enemy card the median loss is −0.3 % when that card is attacked last and −11.7 %
    when it is attacked first. In the second case AoE-heavy decks lose more at the median (−14.0 % against −9.6 %
    for single-target-heavy decks). The worst deck (−52.8 %) is single-target, [2,102,117,156]: its carrier
    Murmures (#102, 68 % of the damage, 500 HP) hits the reflecting card first.

## 5. Facts vs inferences and limits

- **FACT** (code and data): every number above comes from the validated engine copy plus the stated hooks. The
  mechanics' magnitudes (Renvoi 25/50/75/100 %, Gel's 40 damage, Fleur de Vie 600 HP / CD 1) come from
  `tox_fr.json` and `cards_compact.txt`.
- **INFERENCE (high confidence).** In the wiki's abstract model, a permanent taunt is not what made deck chimere
  lose against AZURIAN:
  - Chimère's AoE ignores taunt, and the only single-target damage is Pinces (5–41 per turn).
  - The deck kills 0.94 enemy card per match on average.
  - So it could not have removed Tisseuse de Mots (500 HP) before its turn-7 absorb with or without taunt.
  - The absorb (E2's scope) and the lack of single-target burst are the problem.
- **INFERENCE (medium).** The model cannot represent "the taunter protects the dangerous card": all enemy cards
  are identical damage dealers. So S-TAUNT here under-states taunt in real matches against heterogeneous decks.
- **INFERENCE (medium).** Renvoi épique on all 4 enemy cards from turn 1 is an upper bound. Four Renvoi need four
  shop purchases (one per opening, openings on even turns), and epics show up from about turn 6. The realistic
  threat to deck chimere is 2+ reflecting cards at 50 %+ (RR on all 4: −28.4 %). One card, as with L'Épine d'Amour,
  costs nothing.
- **UNKNOWN.** Reflect resolution order and rounding are unknown. Per-hit resolution with lifesteal netting is the
  REn bracket. Rounding per hit could punish many small hits (Galop = 8 hits of 10); this is not modelled.
- **UNKNOWN.** The real enemy targeting is unknown. The engine sends enemy hits to our lowest-HP card; T14 shows the
  ranking holds when this is changed.
- **Not modelled:**
  - thawing a frozen ally with our own heal;
  - Brut destroying a taunt when it targets the taunter;
  - talents (opponents may have them);
  - the shop: we could buy Renvoi or Gel ourselves, and opponents could stack these Tox over time rather than from
    turn 1.

### T13 — Saved decks: mechanics behind the scores (mean over the 18 matches)

| Deck | Scenario | score | own deaths | enemy kills | dmg dealt | reflected dmg taken | EHP left | freezes applied |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| deck chimere | base | 8,018 | 0.00 | 0.94 | 2,157 | 0 | 1,834 | 0.00 |
| deck chimere | T900 | 7,673 | 0.00 | 0.17 | 2,194 | 0 | 1,806 | 0.00 |
| deck chimere | F3p0 | 7,160 | 0.83 | 0.11 | 1,897 | 0 | 1,625 | 0.00 |
| deck chimere | F3p1 | 6,052 | 0.00 | 0.11 | 1,535 | 0 | 1,870 | 0.00 |
| deck chimere | F3p2 | 7,845 | 0.44 | 0.83 | 2,112 | 0 | 1,728 | 0.00 |
| deck chimere | F3p3 | 7,004 | 1.00 | 0.11 | 1,833 | 0 | 1,614 | 0.00 |
| deck chimere | FT3p0 | 7,160 | 0.83 | 0.11 | 1,897 | 0 | 1,625 | 3.00 |
| deck chimere | FT3p1 | 6,357 | 0.33 | 0.11 | 1,661 | 0 | 1,787 | 3.00 |
| deck chimere | FT3p2 | 7,611 | 0.00 | 0.22 | 2,034 | 0 | 1,804 | 2.00 |
| deck chimere | FT3p3 | 7,004 | 1.00 | 0.11 | 1,833 | 0 | 1,614 | 2.50 |
| deck chimere | P20 | 6,751 | 0.00 | 0.11 | 1,754 | 0 | 1,803 | 0.00 |
| deck chimere | RC | 8,020 | 0.00 | 0.94 | 2,157 | 539 | 1,840 | 0.00 |
| deck chimere | RE | 3,722 | 1.00 | 0.00 | 842 | 632 | 1,224 | 0.00 |
| deck chimere | REn | 4,693 | 1.00 | 0.00 | 1,126 | 158 | 1,302 | 0.00 |
| deck aleera | base | 12,847 | 0.67 | 3.11 | 2,773 | 0 | 1,516 | 0.00 |
| deck aleera | T900 | 8,997 | 1.22 | 2.39 | 2,906 | 0 | 1,422 | 0.00 |
| deck aleera | F3p0 | 6,871 | 2.00 | 0.00 | 1,726 | 0 | 876 | 0.00 |
| deck aleera | F3p1 | 11,264 | 1.00 | 3.11 | 2,707 | 0 | 1,382 | 0.00 |
| deck aleera | F3p2 | 12,811 | 0.67 | 3.11 | 2,775 | 0 | 1,415 | 0.00 |
| deck aleera | F3p3 | 11,101 | 1.33 | 3.11 | 2,717 | 0 | 1,277 | 0.00 |
| deck aleera | FT3p0 | 7,377 | 2.00 | 0.22 | 1,880 | 0 | 890 | 1.50 |
| deck aleera | FT3p1 | 11,041 | 1.17 | 3.11 | 2,711 | 0 | 1,335 | 2.56 |
| deck aleera | FT3p2 | 13,485 | 0.44 | 3.56 | 2,793 | 0 | 1,560 | 1.22 |
| deck aleera | FT3p3 | 11,101 | 1.33 | 3.11 | 2,717 | 0 | 1,277 | 2.67 |
| deck aleera | P20 | 9,336 | 1.78 | 0.44 | 2,564 | 0 | 976 | 0.00 |
| deck aleera | RC | 6,847 | 2.00 | 0.00 | 1,663 | 416 | 745 | 0.00 |
| deck aleera | RE | 6,934 | 3.00 | 0.00 | 1,690 | 1,267 | 373 | 0.00 |
| deck aleera | REn | 6,968 | 3.00 | 0.00 | 1,690 | 937 | 467 | 0.00 |
| anti-critiques | base | 6,989 | 0.00 | 1.11 | 1,771 | 0 | 2,104 | 0.00 |
| anti-critiques | T900 | 6,431 | 0.00 | 0.22 | 1,731 | 0 | 2,038 | 0.00 |
| anti-critiques | F3p0 | 6,453 | 0.78 | 0.94 | 1,642 | 0 | 1,835 | 0.00 |
| anti-critiques | F3p1 | 5,309 | 1.06 | 0.89 | 1,330 | 0 | 1,514 | 0.00 |
| anti-critiques | F3p2 | 6,373 | 0.00 | 0.94 | 1,588 | 0 | 1,954 | 0.00 |
| anti-critiques | F3p3 | 6,662 | 0.00 | 1.11 | 1,700 | 0 | 1,910 | 0.00 |
| anti-critiques | FT3p0 | 6,567 | 0.33 | 0.94 | 1,679 | 0 | 1,885 | 3.00 |
| anti-critiques | FT3p1 | 4,936 | 1.11 | 0.89 | 1,228 | 0 | 1,453 | 2.56 |
| anti-critiques | FT3p2 | 5,829 | 0.00 | 0.78 | 1,411 | 0 | 2,010 | 1.50 |
| anti-critiques | FT3p3 | 6,662 | 0.00 | 1.11 | 1,700 | 0 | 1,910 | 3.00 |
| anti-critiques | P20 | 5,205 | 0.00 | 0.89 | 1,263 | 0 | 1,899 | 0.00 |
| anti-critiques | RC | 6,665 | 0.22 | 1.11 | 1,725 | 431 | 1,576 | 0.00 |
| anti-critiques | RE | 4,766 | 2.00 | 0.89 | 1,239 | 929 | 600 | 0.00 |
| anti-critiques | REn | 4,766 | 2.00 | 0.89 | 1,239 | 626 | 600 | 0.00 |
| robuste A [3,103,117,238] | base | 7,625 | 0.11 | 1.89 | 1,984 | 0 | 1,917 | 0.00 |
| robuste A [3,103,117,238] | T900 | 7,146 | 0.44 | 1.00 | 1,977 | 0 | 1,791 | 0.00 |
| robuste A [3,103,117,238] | F3p0 | 5,999 | 1.00 | 0.78 | 1,515 | 0 | 1,554 | 0.00 |
| robuste A [3,103,117,238] | F3p1 | 6,186 | 1.00 | 0.83 | 1,592 | 0 | 1,308 | 0.00 |
| robuste A [3,103,117,238] | F3p2 | 6,933 | 0.44 | 1.11 | 1,787 | 0 | 1,667 | 0.00 |
| robuste A [3,103,117,238] | F3p3 | 6,591 | 0.11 | 1.11 | 1,675 | 0 | 1,854 | 0.00 |
| robuste A [3,103,117,238] | FT3p0 | 5,999 | 1.00 | 0.78 | 1,515 | 0 | 1,554 | 2.06 |
| robuste A [3,103,117,238] | FT3p1 | 6,186 | 1.00 | 0.83 | 1,592 | 0 | 1,308 | 3.00 |
| robuste A [3,103,117,238] | FT3p2 | 6,933 | 0.44 | 1.11 | 1,787 | 0 | 1,667 | 3.00 |
| robuste A [3,103,117,238] | FT3p3 | 6,644 | 0.11 | 1.17 | 1,704 | 0 | 1,869 | 3.00 |
| robuste A [3,103,117,238] | P20 | 6,027 | 0.61 | 0.83 | 1,521 | 0 | 1,730 | 0.00 |
| robuste A [3,103,117,238] | RC | 7,225 | 0.56 | 1.56 | 1,889 | 472 | 1,583 | 0.00 |
| robuste A [3,103,117,238] | RE | 6,528 | 1.11 | 1.00 | 1,732 | 1,299 | 884 | 0.00 |
| robuste A [3,103,117,238] | REn | 6,622 | 1.00 | 1.00 | 1,732 | 474 | 1,156 | 0.00 |
| zéro critique | base | 6,529 | 1.17 | 2.06 | 1,747 | 0 | 879 | 0.00 |
| zéro critique | T900 | 6,044 | 1.50 | 1.89 | 1,727 | 0 | 769 | 0.00 |
| zéro critique | F3p0 | 5,053 | 2.00 | 1.39 | 1,306 | 0 | 644 | 0.00 |
| zéro critique | F3p1 | 5,197 | 0.78 | 1.39 | 1,330 | 0 | 1,121 | 0.00 |
| zéro critique | F3p2 | 5,853 | 0.67 | 1.61 | 1,518 | 0 | 960 | 0.00 |
| zéro critique | F3p3 | 5,266 | 1.89 | 1.22 | 1,360 | 0 | 717 | 0.00 |
| zéro critique | FT3p0 | 5,053 | 2.00 | 1.39 | 1,306 | 0 | 644 | 3.00 |
| zéro critique | FT3p1 | 5,197 | 0.78 | 1.39 | 1,330 | 0 | 1,121 | 3.00 |
| zéro critique | FT3p2 | 5,871 | 1.50 | 1.83 | 1,547 | 0 | 762 | 3.00 |
| zéro critique | FT3p3 | 5,266 | 1.89 | 1.22 | 1,360 | 0 | 717 | 1.50 |
| zéro critique | P20 | 4,668 | 1.89 | 1.11 | 1,207 | 0 | 743 | 0.00 |
| zéro critique | RC | 5,476 | 1.89 | 1.39 | 1,431 | 358 | 593 | 0.00 |
| zéro critique | RE | 4,223 | 2.44 | 1.11 | 1,082 | 812 | 231 | 0.00 |
| zéro critique | REn | 4,223 | 2.44 | 1.11 | 1,082 | 812 | 231 | 0.00 |
| robuste B [69,160,227,238] | base | 6,077 | 2.06 | 1.11 | 1,490 | 0 | 1,017 | 0.00 |
| robuste B [69,160,227,238] | T900 | 5,882 | 2.78 | 0.33 | 1,568 | 0 | 809 | 0.00 |
| robuste B [69,160,227,238] | F3p0 | 5,611 | 2.11 | 1.06 | 1,367 | 0 | 993 | 0.00 |
| robuste B [69,160,227,238] | F3p1 | 5,518 | 2.11 | 1.11 | 1,349 | 0 | 798 | 0.00 |
| robuste B [69,160,227,238] | F3p2 | 5,461 | 2.50 | 1.06 | 1,330 | 0 | 990 | 0.00 |
| robuste B [69,160,227,238] | F3p3 | 5,400 | 3.00 | 1.11 | 1,317 | 0 | 785 | 0.00 |
| robuste B [69,160,227,238] | FT3p0 | 5,611 | 2.11 | 1.06 | 1,367 | 0 | 993 | 1.00 |
| robuste B [69,160,227,238] | FT3p1 | 5,515 | 2.11 | 1.11 | 1,356 | 0 | 790 | 3.00 |
| robuste B [69,160,227,238] | FT3p2 | 5,455 | 2.22 | 1.06 | 1,336 | 0 | 1,020 | 2.00 |
| robuste B [69,160,227,238] | FT3p3 | 5,373 | 3.00 | 1.11 | 1,313 | 0 | 788 | 2.94 |
| robuste B [69,160,227,238] | P20 | 4,949 | 2.44 | 0.94 | 1,196 | 0 | 944 | 0.00 |
| robuste B [69,160,227,238] | RC | 5,694 | 2.94 | 1.11 | 1,407 | 343 | 613 | 0.00 |
| robuste B [69,160,227,238] | RE | 4,590 | 3.11 | 0.94 | 1,146 | 860 | 104 | 0.00 |
| robuste B [69,160,227,238] | REn | 4,757 | 3.11 | 0.94 | 1,194 | 617 | 129 | 0.00 |

## 6. Files

- `SP/spam/audit/E1/E1_stress.md`: this report; `tables.md`: all tables.
- `SP/spam/audit/E1/E1_results.json`: per deck: baseline, the 49 scenario scores, the per-position freeze and focus
  results, drops, features, ranks. It also holds the rankings, correlations, card freeze table, group means, and
  meta (validation, hashes, scenario definitions, provenance).
- `engine_stress.js` (modified engine), `build_stress.js` (patches), `engine_pretty.js`, `pretty.js`,
  `e1_runner.js` (validate / stress / diag), `scenarios.js`, `make_decks.js` → `decks.json`, `analyze.js`,
  `report_tables.js`, `validation.json`, `diag.json`, `dbg.js` / `deaths.js` (single-match tracing).

## 7. Addendum (wave 2) — freeze with player thaw

The user clarified the freeze rule. Any damage, heal or new Tox on a frozen card frees it and deals the ice-break
damage (40 in 1.20, 60 in 1.21). The thaw variant works as follows:

- At the start of our turn, an ally heal that is ready on another living card is cast first on the frozen card.
- Otherwise, on a shop turn (even turns), buying a Tox frees it.
- Otherwise, it stays frozen.

It was added to a copy of the 1.20 engine (`v121stress/E1/engine120_thaw.js`). With the toggles off, that copy
matches the original on 60 decks (max |Δ| = 0). **All S-FREEZE figures above are therefore upper bounds.**

| Deck (1.20) | Freeze 1-in-3, no thaw (worst card) | With player thaw (worst card) |
|---|---:|---:|
| deck chimere | −24.5 % (#238) | **−3.8 %** (#117) |
| anti-critiques | −29.4 % (#238) | −11.2 % (#238) |
| zéro critique | −22.6 % (#102) | −13.1 % (#116) |
| deck aleera | −46.5 % (#231) | −40.3 % (#231) |
| robuste A [3,103,117,238] | −21.3 % (#3) | −9.0 % (#117) |
| robuste B [69,160,227,238] | −11.6 % (#238) | −6.2 % (#227) |

The 1.21 re-run of this bench (307 decks, 7 scenarios including the thaw variant) is in
`SP/spam/audit/v121stress/E1_121.json`.
