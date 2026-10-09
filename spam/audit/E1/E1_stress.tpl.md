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

{{T1}}

{{T2}}

{{T2b}}

{{T3}}

{{T4}}

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

{{T5:10}}

{{T6:5}}

{{T7:10}}

{{T14}}

The top-4 maximin decks keep ranks 1–4 when the enemy focuses our damage card (or any card) instead of our
lowest-HP card. [69,102,117,238] falls from 5 to 259 (Murmures focused + Renvoi E: −54.5 %). Focusing Chimère is
usually a *gain* for us (+4.4 % mean, +2.1 % median over the 208 decks with Chimère), because the enemy then pours its damage into a 75 %
lifesteal card.

## 4. What makes a deck fragile or robust, per scenario

{{T9}}

{{T10}}

{{T11}}

{{T12}}

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

{{T13}}

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
