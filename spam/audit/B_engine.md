# B — What the wiki engine sees, and what it does not (SPAM 1.20, engine a8193b3d422a54a9)

Agent B, 2026-10-09.

- **Readable engine:** `SP/spam/audit/B_engine_pretty.js` (2,550 lines). It was produced from `SP/spam/js/simulation.js` by `SP/spam/audit/B/fmt.js` (a tokenizer-based re-indenter that uses only Node built-ins).
  - The reformat does not change behaviour. Running the same driver on both files gives byte-identical output JSON: deck chimere 8018.22, deck [69,160,227,238] 6077.27.
  - `L1234` in this document means line 1234 of `B_engine_pretty.js`.
- **Numbers:** every measurement below is in `SP/spam/audit/B_engine_numbers.json`.
  - Drivers: `SP/spam/audit/B/t_*.js` (turned into `drv_*.js` by `B/mkdrv.js`).
  - Raw outputs: `B/out_*.json`.
  - Patched engine variant: `B/engine_deadfix.js` (see C11).
- **Tags:**
  - **FACT-code**: read in the code, with the line cited.
  - **FACT-run**: measured by running the engine. "J" is the engine's score, i.e. the mean of 18 matches (9 profiles × 2 play orders), unless stated otherwise.
  - **INF**: my inference, with a confidence level.
- **Decks used:** chimere [103,238,156,117], anticrit [12,238,27,117], zerocrit [102,116,12,69], alt1 [3,103,117,238], alt2 [69,160,227,238]. No talents.

---

## 0. Summary: the main blind spots, ranked by measured impact

1. **The opponent is only a damage curve.**
   - **FACT-code:**
     - The curve is the same for all 9 profiles: 108→253 per turn, 1,801 in total over 10 turns at full strength, multiplied by (living enemies / 4) (L268, L820, L825).
     - The opponent has no abilities, no passives, no talents and no Tox. It never taunts, freezes, absorbs, reflects, heals, debuffs, resets cooldowns, generates elements or chooses a key target.
   - **FACT-run:**
     - Without talents, the wiki's own synergy decks deal 2,677–4,675 unopposed damage over 10 turns. That is 1.5–2.6× the abstract opponent; the abstract opponent sits at about the 80th percentile of 300 random decks.
     - With opponent damage ×2, J falls by 40–76% and the ranking of our decks inverts:
       - At ×1: chimere 8018 > alt1 7625 > anticrit 6989 > zerocrit 6529 > alt2 6077.
       - At ×2: alt1 4094 > alt2 3651 > zerocrit 3312 > anticrit 3140 > chimere 1948.
2. **Our cards almost never die, so every survival tool is valued at about 0.**
   - **FACT-run:**
     - Deck chimere loses no card in any of its 18 matches.
     - Value of each Tox added on Lame de la forêt: Phénix L 0%, Bouclier L 0.1%, Vampirisme L 0.4%, Soin primitif L 0.4%, Ténacité / Revanche / Bomba / Vengeur 0%.
     - By comparison: Cœur d'eau L +46.5%, Berserk L +26.6%.
3. **Injected opponent behaviours cost real score that the engine never shows (FACT-run, chimere):**

   | Injected behaviour | J change |
   |---|---|
   | Absorb (Veuve noire) of Chimère at T7/8 | −43% |
   | Our cooldowns reset at t5/t10 (Gardien Vert) | −30% |
   | Freeze on Chimère every 3rd turn | −27% |
   | Precision −10% at t3 and t7 | −12% |
   | Renvoi L on all enemies | −54% |

   - In the per-card replay of the incident, absorb alone gives −38%.
   - For alt1, taunt alone (+0.4%) and absorb alone (0%, because Tisseuse is killed first) are invisible, but taunt + absorb together give −19%.
4. **Control is never simulated, only credited.**
   - **FACT-code:** freeze = +70 per cast, eternity = +25 per value, vanish = +40, resetEnemyCd = +120, enemyPrec = +1.2 per point × targets (L1063–L1117). The field `enemy.prec` is written but never read.
   - **FACT-run:** this flat credit is 6–13% of J for control decks, and 34% of the solo J of Dragon de la Cité Infernale (#259, owned).
5. **Some valuations are flat or rarity-blind.**
   - Mimétisme = a flat +1.5 element points per turn (L1315). It is worth 6–9% of J in every deck containing Chimère. It disappears if the opponent generates nothing; it would be worth more against a heavy generator.
   - Poison, Spamland and Sac de frappe Tox are rarity-blind: the C, R, E and L versions all give the same gain (FACT-run).
   - Every shop Tox is valued as if owned from turn 1. Bought at T6 instead, Cœur d'eau L is worth 20.5%, not 46.5%.
6. **Crit is counted as an expected value, so per-match spread is hidden.**
   - **FACT-run:** one match of chimere (neutral, P1) has a standard deviation of 902, p10 = 7078, p90 = 9151, and a TTK between 10.4 and 14.8 turns.
   - For comparison, zerocrit has a standard deviation of 159 and alt2 of 146.
7. **J is a 10-turn damage index, not a win measure.**
   - In a 30-turn race against the engine's own opponent: alt2 wins 2/18 and zerocrit 8/18 (FACT-run).
   - In per-card duels against 6 real decks: chimere wins 0/12, alt1 3/12, zerocrit 3/12 (FACT-run). These duels are pessimistic (see C7).

---

## (a) Architecture (all line references are to B_engine_pretty.js)

### a.1 Loading and normalisation
- **Entry point.** `self.onmessage` (L2535) calls `xt()` (L2517). `xt()` fetches the snapshot and refuses it if `engineHash` differs (L2523), then calls `ht(model)` (L2350).
- **The evaluator API.** `ht(model)` exposes `evaluate()` (L2356) and `bestDecks()` (L2436).
  - **Gotcha:** `evaluate()` memoises up to 30 results keyed on (selection, options) (L2367–2368, L2432). A harness that changes globals and then calls `evaluate()` again on the same deck gets a stale cached result. Call `q()` or `X()` directly instead.
- **Cards arrive pre-normalised in model.json.** The text parsing was done offline by the wiki.
  - Each ability holds `options[{target, hits[], heals[], gen[], effects[]}]`.
  - Passives carry a `type`; talents carry a `kind`.
  - The worker parses text only for shop Tox: `We` (L1779–1824) maps each Tox id to a passive using regexes on the French text, `Ge` (L1825) applies it, and `it()` (L1978) builds the 101 purchasable Tox.
- **One parse gap (FACT-data).** L'Inventeur (#153, owned), ability "Materia: Bonus [-8 à +10] dans chaque élément", has empty arrays. The candidate filter (L1377) therefore never casts it.
- **Per-match card state.**
  - `E()` (L409–497) creates one flag per passive or talent.
  - `te()` (L501–574) applies passives (innate passives × 1.3 if the card has the Evolution talent; shop Tox × 1).
  - `ne()` (L575–681) applies talents, only when a talent is selected. `talentId: null` means no talents.

### a.2 Score = mean of 18 matches
- `X()` (L1456) runs `q()` for each of the 9 profiles in `d` × player 1 and 2, then takes the plain mean of `J` (L1463). The profiles (L302–307):
  - neutral: 700 HP, resistance 10%;
  - fragile: 550 HP, 5%;
  - tank: 900 HP, 15%;
  - anti-X ×6: 700 HP, 10% resistance plus 25% in element X.
- `Te()` (L1484) adds talent optimisation, used only when `optimize` is true.
- The deck finder `bestDecks` → `ut()` (L2275) runs its beam search on a **single** match (neutral, player 1) per candidate (L2285, L2297). Only the final shortlist is re-scored on 18 matches (L2453).

### a.3 The match loop `q()` (L1212–1450)

**Setup (L1213–1304):**
- The opponent comes from `b()` (L365). In the normal case it is abstract: 4 enemies `{index, hp}` (L1257). A per-card mode exists when `opponent.cards` is supplied, but `evaluate()` never uses it.
- Our cards are sorted by card number (L1280).
- Then talents, shop Tox as `extraPassives` (L1289), and passives (L1290) are applied.
- Flat credits for Mystère and Immunité are added (L1291–1292).

**Each turn e = 1..10** (the loop stops early when all 4 enemies are dead, `s.over`):
1. If we are player 2, the opponent phase `de()` runs first (L1306). Luck +1.
2. Upkeep for each card (L1307–1366):
   - Cœur generation; Mimétisme +1.5/6 per element; Cœur vital; regeneration; luck;
   - talents: critPerTurn, incisive, fullHeal*;
   - Sac de frappe +0.5 or +1.2; resOnHit / corrosion;
   - focus credit; anticipation; turn-8 talents.
   - **There is no "is the card dead" check here (L1307).**
3. Candidate abilities (L1369–1378): every ready ability of every living card, provided:
   - uses remain;
   - the cost is affordable;
   - costHp leaves at least 20% HP;
   - the ability is not empty.
   Its value `v = j()` (L699).
4. Order (L1379): abilities without damage first, then damage abilities, each group by `v` descending. **Every candidate is cast** (`oneActionPerCardPerTurn = false`, L253) through `ye()` (L987).
5. Income (L1387–1394): turn number + Spamtons of living cards + Spamland + spamtonGen.
6. If we are player 1, the opponent phase `de()` runs now (L1395), followed by enemy heals `me()` (per-card mode only).

**End (L1398–1449):** metrics are computed.

### a.4 Ability selection and the "plan"
- **Option choice.** `W()` (L912) picks the option with the highest `j()`, where `j()` = Σ expected damage `B()` + 0.6 × heal value + generation value `N()` (L713) + effect value `re()` (L723).
  - All 13 multi-option abilities in the data are `choice: true`, so picking the maximum is correct.
- **`j()` never enters the score.** It only chooses options and orders casts.
- **The plan** is the list `s.plan[turn]` filled in `ye()` (L1149–1158).
- **What the heuristic does not do:**
  - it casts whatever is ready at once;
  - it spends costs greedily;
  - it never holds a cooldown for a better moment;
  - it never reacts to the opponent.

### a.5 Targeting
- **Enemy order `w()` (L389–392):** `opts.focus` first (per-card mode only), then **lowest current HP**, then index.
- **Weights `oe()` (L761–774):**

  | Case | Weights |
  |---|---|
  | spreadField | [0.5] |
  | aoeEnemy | [1] × min(4, enemies alive) |
  | effect aoe2 | [1, 1] |
  | AoE Tox with percentage p | [1, p, p/2] if 4+ alive; [1, p] if 3; [1, p/2] if 2 |
  | enemy, randomEnemy, spreadEnemy | [1] (the focus target) |

- **`G()` (L923–957)** splits the cast's **total** damage over those weights and caps each share at the target's remaining HP (L935). **Overkill is lost.** `G()` also handles enemy Phénix (per-card mode, L942–947) and TTK (L949–953).
- **Ally targeting:**
  - heals, `ge()` (L958): "ally" = the most damaged ally; "all" = per-target amount for each card; "spread" = split evenly; "self";
  - buffs, `K()` (L1175): best marginal gain using `Se()` (DPS) or effective HP; randomAlly = 1/n on each card;
  - taunt on an ally, `_e()` (L969): the ally with the highest effective HP;
  - resurrection, `ve()` (L978): the dead card with the best DPS, at 50% HP;
  - Temporalité on an ally, `Ce()` (L1203): the ability with the longest remaining cooldown, on any card, dead ones included.

### a.6 Damage formula: `B()` (L784–797) with `z()` L776, `I()` L757, `F()` L748, `ie()` L751, `L()` L758, `P()` L742, `S()` L380
1. **Base value** `p` = average(min, max), or max with Optimisation; plus the ability's growth (`baseAdd`), the card's base and the team's base (L777).
   - Missing-HP percentage (Aleera) is added (L778–781).
   - "% of max HP" hits use 700, the abstract card HP (L789).
2. **Element bonus:** × (1 + 0.1 × bonus[element]) (L777). Multiplicator doubles the bonus; a negative bonus counts as 0 (L746). "card" / "self" means the card's element; "random" uses the mean of the 6 bonuses.
3. **Berserk:** × team berserk multiplier, and × 0.6 if the card was "randomized" by a talent (L788).
4. **Resistance:** `u` = enemy resistance in that element (mean of the 6 if no element or random; 0 with Brut) (L786).
   - `I(p, u) = round(round(p) · (1 − u))` (L757).
5. **Crit, as an expected value:** `(1 − c) · I(p, u) + c · I(p · m, u)` (L790–792), where
   - `c` = clamp((ability crit + card crit + team crit) / 100, 0, 1);
   - `m` = ability crit multiplier + card multiplier + team multiplier.
6. **Precision and targets:** × precision expected value `L` × number of targets (L793).
7. **Passive modifiers:** Érosion × 1.1 (L794). Poison adds pct% × 700 × 3 turns × targets × L **on every cast** (L795).
8. **In `ye()`:**
   - × echo multiplier `u` = min(4, 1/(1 − l)) (L991–992), with the pity model `v()` (L333);
   - Reset Tox: after a kill, one extra hit of the same damage (L1053–1057).

### a.7 Healing
- **Value `se()` (L798):**
  - % of own HP: a "full heal" is valued at 0.45 × max HP;
  - flat heals at face value;
  - otherwise (base + bonus) × crit expected value × berserk;
  - allAllies × 4.
- **Distribution** by `ge()` (L958). `U()` (L879) caps every heal at the damage taken, so there is no overheal.
- **Vampirisme:**
  - the effect heals 50% of damage (L1042–1044);
  - the passive heals its own percentage.
- **Inversement** swaps damage and heals (L1037).
- **Regeneration** (L1317).
- **Ignored:** the healing part of the AoE Tox.

### a.8 Generation and element bonus
- The bonus pool `s.bonus` belongs to the player and never decays. Costs spend it (L994); it can go negative, and `P()` reads a negative value as 0.
- **Gains:**
  - ability generation `M()` (L707) — "cond" multiplies by the crit chance; "growth" adds growth × previous casts — then × echo × precision (L997–1008);
  - Cœur, Mimétisme and Sac de frappe every turn (L1308–1328);
  - Cimetière on any death (L810);
  - genOnAttack (L1010).
- 1 point = +10% damage and healing (L250).

### a.9 The opponent: `de()` L821, `fe()` L831, `H()` L862, `he()` L906

**Damage volume.**
- Damage per turn = `V(t)` × (living enemies / 4) (L820, L825).
- `V = [108, 124, 140, 156, 172, 188, 204, 220, 236, 253]` (L268). Turns after 10 reuse 253.
- The curve is identical for every profile.

**Distribution over our cards (`fe()`).**
- Each living enemy's share is cut into hits of 70 (L832).
- For each hit:
  - 21% (the AoE share) is spread over all our living cards;
  - 79% is single-target. It goes to our taunter if we have one (L845–846). Otherwise cards with the focus talent take their share, and the rest goes to **our card with the lowest current HP**, with overflow carried to the next card (L855–858).

**Resistance.** Incoming damage is multiplied by (1 − our card's **average** resistance) (`A()` L692, with no element mix). Elemental weaknesses are therefore never exploited.

**`H()` on each hit:**
- the Vital-chance talent;
- Bouclier: first hit of each phase, up to 70 damage (L866);
- Renvoi → `G()`, which sends the damage to our **focus enemy**, not to the attacker (L868);
- the counter talent;
- Ténacité (L870–874);
- death → `he()` (L906–911): Revanche, Bomba, the +50 Spamton death bounty, death talents, Phénix and Métamorphe revivals, then the death cascade `le()` (Cimetière, Vengeur).

**Our taunt.** It is set in `ye()` (L1072, L1140), consumed in `fe()`, and **cleared after one opponent phase** (L827–829).

**Per-card mode (`b()` L365–376, `de()` L825, `me()` L895).** It supports per-card HP and resistance, damage and heal curves, element mix, Brut, Phénix, AoE share and `opts.focus`. `evaluate()` never uses it. A per-card copy of "neutral" reproduces the abstract score exactly (FACT-run: deck chimere, mean of the two play orders against the neutral profile, 8369 = 8369).

### a.10 Scoring `J` (L1451), weights at L276

**J = offense + 0.35 × (ehpLeft + defenseCredits) + 0.8 × control + 0.5 × economy**

- **offense (L1407):**
  - if all 4 enemies die: 3 × 2800 × (1 + 1.5 × (10 − ttk) / 10);
  - otherwise: 3 × min(C × 2800 / enemy total HP, 2800).
  - `C` = Σ useful damage(t) × (1.5 − 0.05·t) (L1401). The weight goes from 1.45 at turn 1 to 1.0 at turn 10. "Useful" means capped at the enemy's HP.
- **ehpLeft (L1424):** remaining HP of living cards / (1 − average resistance). This is the **only** term where survival, healing, tankiness and taunt count.
- **defenseCredits (L1425) and control (L1430):** flat credits only.
- **economy (L1402):** 0.6 × Spamtons earned + 4 × Luck + flat economy credits.
- **Not in J:** `support`, `teamBuff`, and the `defense` field (L1400).
- **FACT-run composition for the user's decks:** offense 88–93%, ehpLeft 5–11%, control 0%, defenseCredits 0%, economy 1–2%.

### a.11 Shop planner `st()` (L2027–2268)
- **Openings:** every 2 turns, until min(10, ceil(ttk)), at most 6 steps (L280–301).
- **Rarity odds:** derived from Luck through Hermite curves (curves at L19–68; `$e` at L1951).
- **Price:** must be ≤ cumulative Spamtons − already spent.
- **Candidate gain:** `J` of **one** match, neutral, player 1 (`_` at L2042). A robust check with `X()` (18 matches) then requires +1% on a free row or +3% for a replacement (L2172–2185).
- **The Tox is injected from turn 1** (L1289), whatever its purchase turn.
- **Not modelled:** rerolls and the skip reward (the fields `rerollCost`, `rerollStep`, `skipReward`, `onePurchasePerOpening` are never read).
- **Expected value of one opening:** best of 3 offers (`ot()` L2008).
- **Replacement suggestions** (L2375–2397): screened with a single match, kept if > +3% on 18 matches.

### a.12 Card tier list `Ue()` (L1720)
Each card gets a solo match. It is ranked by percentile on 6 axes with weights offense 0.4, generation 0.2, defense 0.15, support 0.1, control 0.08, economy 0.07 (L277). **The "Contrôle" axis is made only of flat credits.**

---

## (b) Mechanic table

**Classes.**
- **SIM**: simulated.
- **APPROX**: simulated with a stated simplification.
- **FLAT**: a constant added to a J component; the effect itself never happens.
- **IGN**: no effect at all.

**Opponent column.** With the 9 default profiles the opponent has no abilities, passives, talents or Tox, so **every mechanic below is IGN on the opponent side**. The column only notes a per-card-mode hook when one exists.

### b.1 Ability effect types (25 in the data, plus `stun`, which is coded but no 1.20 card has it)

| Effect (cards) | Our side | How | Opponent / hook | Lines |
|---|---|---|---|---|
| taunt (#12 #58 #72 #94 #101 #116 #222 #262) | APPROX | Flag on the caster (scope card), or on the highest-effective-HP ally (scope ally or randomAlly). It takes all single-target incoming damage for **1 opponent phase** although the data says duration 2. The duration only feeds the `j()` value (40 × duration × 0.5). | IGN / `opts.focus` (per-card) | 1072, 969–977, 845, 827–829, 729 |
| eternity (#21 #23 #34 #35 #51 #64 #88) | FLAT | control += 25 × value × targets (4 if AoE) × (crit chance if "on crit", else 1) × echo. The opponent has no cooldowns to delay. | IGN | 1067, 727 |
| crit | SIM (expected value) | `K()`: card / team / ally (best DPS gain) / randomAlly (1/n each). "On crit" variants are a fixed × 0.5. | IGN | 1078–1083, 1175–1202 |
| prec | SIM (expected value) | `K()` | IGN | 1084–1089 |
| res | SIM | Enemy scope: enemy resistance −0.7 × value per cast, permanent and stacking (#51). Team / card / ally scope: our resistance (incoming damage and effective HP). | IGN | 1102–1108 |
| freeze (#23 #29 #34 #59 #91 #122 #211) | FLAT | control += 70 × targets × precision × echo, **whatever the target** — #122 freezes our own ally and still earns +70. | IGN | 1065, 726 |
| base | SIM | Ability scope: +value to that ability on each cast (growth). Otherwise via `K()`. | IGN | 1096–1101 |
| temporality | SIM / IGN | Team (#47): all other abilities −value, ready next turn at best. Ally (#42): −value on the longest remaining cooldown, dead cards included. Field (#227): ignored. | IGN | 1069–1071, 1203–1211 |
| vampirism (#47 #63 #137) | SIM | Heals itself for 50% of damage dealt. | IGN | 1042–1044 |
| resetEnemyCd (#78) | FLAT | control += 120 | IGN | 1117 |
| enemyPrec (#81) | FLAT | control += 1.2 × value × targets. `enemy.prec` is never read. | IGN | 1114–1116 |
| absorbAlly (#86) | IGN | `break`. The ability is filtered out and never cast. | IGN | 1126, 1377 |
| resetEnemySpamton (#96) | FLAT | economy += 60 | IGN | 1119 |
| critMult | SIM (expected value) | Field (#113): team multiplier + 0.5 × value. Ally (#156): `K()`. | IGN | 1090–1095 |
| absorbAny (#123 Veuve noire) | APPROX | 700 damage to the focus enemy and caster max HP +350. In the real game it removes a whole card and gives +100% of its HP (500 → 1025 in the incident). | **IGN — the incident** | 1123–1125, 731 |
| setHpPct (#139) | APPROX | Value 25: 630 damage to the focus enemy, overkill lost. Value 75: heals itself to 75%. | IGN | 1127, 730 |
| hpMax | SIM | Team: all cards +value. Card / ally: `K()`; for #193 (−100) it picks the ally that loses least. | IGN | 1109–1113 |
| vanish (#174) | FLAT | control += 40. No passive is actually removed. | IGN | 1074 |
| resurrect (#203) | APPROX | Revives the dead card with the best DPS (the text says "le dernier allié détruit") at 50%. | IGN | 1121, 978–986 |
| aoe2 (#245) | SIM | 2 targets at full damage. | IGN | 766 |
| spamtonGen (#260) | SIM | +value Spamtons per turn for the rest of the match, cumulative. | IGN | 1129, 1389 |
| smoke (#261) | FLAT | defenseCredits += 10 | IGN | 1076 |
| breakTaunt (#262) | FLAT | defenseCredits += 10. The attached hpMax / base buff applies even when no taunt exists. | IGN | 1131 |
| changeElement (#265) | IGN | No handler. The ability is cast every turn for nothing. | IGN | — |
| stun (no card) | FLAT | control += 60 × duration × targets × precision | IGN | 1063 |

### b.2 Target types (11)

| Target (options in the data) | Handling | Lines |
|---|---|---|
| enemy (91) | SIM. Focus on the lowest-HP enemy; overkill lost. | 389–392, 923–940 |
| randomEnemy (6) | APPROX. Same as enemy: a deterministic focus, no randomness. | 765–773 |
| spreadEnemy (9) | APPROX. Same as enemy: **all hits of the cast land on one target**, overkill lost. | 764–773 |
| aoeEnemy (17) | SIM. Every living enemy (≤ 4) takes full value. | 765 |
| ally (10) | SIM. Heal → most damaged ally; buff → best ally; taunt → highest effective HP. | 958–968, 1175, 969 |
| allAllies (14) | SIM. The per-target heal is given to every card. | 801, 962 |
| randomAlly (4) | APPROX. Heals split evenly (expected value); buffs 1/n each; **taunt goes to the best ally, not a random one**. | 963, 1184, 969 |
| self (5) / none (64) | SIM | 961 |
| field (1, #113) | APPROX. Crit multiplier × 0.5 for us. | 1090 |
| spreadField (1, #227) | APPROX. 50% to enemies (focus target), and the same amount spread as self-damage over our living cards. | 764, 1038, 1048–1052 |

### b.3 Ability fields

| Field | Handling | Lines |
|---|---|---|
| cd (incl. initial cooldown) | SIM. Next use = cast turn + cd. First use: player 1 at turn cd, player 2 at turn cd − 1 (minimum 1). This matches the wiki primer. | 493, 498–500, 1146 |
| uses | SIM (0 = unlimited) | 493, 1147, 1371 |
| echo | APPROX. Expected number of casts min(4, 1/(1 − l)), with the pity model. | 333–359, 991–992 |
| duration (ability level) | IGN. The effect-level duration only feeds the `j()` value of taunt and stun. | 725, 729 |
| cost | SIM. Skipped if unaffordable; spent greedily. | 994, 1373 |
| costHp | SIM. Self-damage × echo; skipped if it would leave < 20% HP. | 995, 1373 |
| choice | Best option by `j()`. Consistent: every multi-option ability is `choice: true`. | 912–922 |
| prec / crit / critMult | Expected value | 748–760, 790–793 |
| elements (ability level) | IGN | — |

### b.4 Innate passives (30 types). Opponent side: IGN for all.

| Type (cards) | Class | How | Lines |
|---|---|---|---|
| luck (5) | FLAT | +Luck per turn while alive → 2 J per point (via economy) and better shop odds. | 538, 1318, 1402 |
| coeur (12) | SIM | +perTurn element each turn; **keeps running after the card dies**. | 536, 1308–1314 |
| hpGrowth (1) | SIM | +max HP per turn | 534, 1316 |
| reset (5) | APPROX | After a kill, one immediate extra hit of the same damage. | 546, 818, 1053 |
| brut (1) | SIM / partial | Ignores resistance. The taunt-breaking part is moot because the opponent never taunts. | 506, 786 |
| phoenix (3) | SIM | Revives once at pct% of max HP. | 542, 909 |
| eternityOnHit (2) | FLAT | control += 25 per attacking cast | 554, 1138 |
| mimetism (3) | FLAT | +0.25 per element per turn (1.5/turn in total) **whatever the opponent does**; keeps running after death. | 564, 1315, 328 |
| erosion (3) | FLAT | Damage × 1.1. The real effect (max-HP reduction, anti-heal) has no target because the opponent never heals. | 522, 794 |
| vanishOnHit (3) | FLAT | control += 24 per attacking cast | 558, 1139 |
| punchingBag (12) | FLAT | +0.5 element per turn (+1.2 if the card taunted), independent of the hits actually received. The +1…+4 value is ignored. | 1323–1328 |
| regen (4) | SIM | Heals pct% of max HP each turn. | 532, 1317 |
| aoe (3) | APPROX | Adjacent-target weights [1, p, p/2]; healing part ignored. | 514, 767–772 |
| lifesteal (3) | SIM | Heals itself for pct% of its damage. | 516, 1043 |
| freezeOnHit (2) | FLAT | control += 70 × precision per attacking cast. | 526, 1137 |
| revenge (1) | APPROX | On death, all its abilities' damage at once, cooldowns ignored. | 548, 907, 887 |
| temporalityOnHit (2) | APPROX | Only on casts that heal or target an ally: −1 on the longest remaining cooldown. | 556, 1144 |
| multiplicator (4) | SIM | Bonus × 2 for this card. | 508, 746 |
| reflect (1) | APPROX | Reflected damage goes to our focus enemy, not to the attacker. | 518, 868 |
| poison (2) | APPROX | +pct × 700 × 3 **on every cast**; no stacking rule. | 524, 795 |
| berserk (5) | SIM | Team damage and heal multiplier. | 504, 788, 800 |
| smoke (4) | FLAT | defenseCredits += 10 per attack or heal cast. | 562, 1145 |
| teamRes (2) | SIM | Team resistance. | 572, 687 |
| recoil (2) | SIM | Self-damage pct × damage dealt. | 520, 1045, 1051 |
| avenger (2) | APPROX | Its abilities become ready **the next turn**, because the candidate list is fixed at the start of each turn. | 550, 811 |
| cimetiere (2) | SIM | +value on all elements at every death; a dead holder still triggers. | 540, 810 |
| tenacity (3) | APPROX | Survives at 1 HP if the overflow is ≤ 69; re-arms whenever HP > 1. | 544, 870–874 |
| immunity (4) | FLAT | defenseCredits += 0.3 × max HP, only at setup. It protects against nothing, because the opponent has no effects. | 512, 1292 |
| mystery (3) | FLAT | +0.5 of its element per turn and +40 defenseCredits. | 566, 1291 |
| tauntOnAttack (1) | APPROX | Taunts for 1 phase after each attacking cast. | 560, 1140 |

### b.5 Shop Tox (101 ids in the pools; mapping at L1779–1824)

Each Tox is handled like the innate type it maps to (b.4). The figures below are FACT-run: the Tox is placed on a free row of Lame de la forêt in deck chimere, valued from turn 1 as the engine does (`B_engine_numbers.json` → `toxValuationOnLame`).

| Tox | Mapped to | Rarity respected? | Gain on Lame (C / R / E / L) |
|---|---|---|---|
| Cœur d'eau, Cœur de nature | coeur | yes (+1/+2/+5/+8) | Eau +11.6 / 15.7 / 26.8 / 46.5%; Nature +13.7 / 16.7 / 27.8 / 38.3% |
| Berserk | berserk | yes | +9.1 / 12.4 / 20.7 / 26.6% |
| **Spamland** | spamland | **no: fixed +3/turn** (real values 3/8/24/48) | +0.1% each |
| **Poison** | poison | **no: fixed 1%** (real values 1/3/6/8%) | +5.7% each |
| **Sac de frappe** | punchingBag | **no** (flat +0.5/turn) | +10% each |
| **Métamorphe (E)** | metamorph | **no handler** | 0 |
| Gel (E) | freezeOnHit | the 40-damage value is parsed but unused | +6.9% (pure flat credit) |
| Érosion C / E | erosion | % unused | +0.8% each |
| Bouclier | shield | yes, against 70-damage hits | 0 / 0.1 / 0.1 / 0.1% |
| Phénix, Ténacité, Revanche, Bomba, Vengeur | death-triggered | yes | **0%** (our cards don't die) |
| Vampirisme / Soin primitif | lifesteal / regen | yes | 0.2–0.4% / 0.4% |
| Renvoi | reflect | yes | +0.8 / 1.8 / 2.2 / 3.0% |
| Immunité (E) | immunity | flat credit at setup only | +0.9% if owned from turn 1; **0% if bought from turn 2 on** |
| Provocation (R) | tauntOnAttack | — | −1.3% |
| Mimétisme (R) / Mystère (R) | flat | — | +9.4% / +10.2% |
| Inversement (R) | inversion | damage↔heal only; the Éternité↔Temporalité swap is not implemented | +3.9% (chimere) / −8% (alt1) |
| Éternité L / Disparition L / Temporalité L | flat / flat / ally-only | — | +2.5 / +2.4 / +14.1% |

**Purchase-turn bias (FACT-run).** Here the Tox is injected only from turn T, through a `de()` hook. Gains in %:

| Tox | From turn 1 (what the planner uses) | Bought at T2 | T4 | T6 | T8 |
|---|---|---|---|---|---|
| Cœur d'eau L | 46.5 | 37.5 | 25.9 | 20.5 | 11.9 |
| Cœur de nature E | 27.8 | 25.1 | 21.4 | 16.1 | 11.6 |
| Berserk L | 26.6 | 24.9 | 24.9 | 23.2 | 15.8 |
| Cœur de nature R | 16.7 | 16.1 | 14.3 | 11.3 | 5.7 |

### b.6 Talents (`ne()` L575–681)
The user has no talents. Opponent talents are IGN.

- **SIM:** gen, crit, critMult, critPerTurn, hpMax (card / others), res (team / card), resOnHit, resLowHp, passive, passiveAt8, echoAll, hpOnDeath, baseOnDeath, resOnDeath, healOnKill, the Spamton family (spamton, spamtonGen, spamtonGenPerTurn, spamtonThreshold, spamtonOnDeath, debt), luck, enemyResOnHitTaken, enemyResPerTurn, incisive, focus (acts as a partial taunt), vitalChance (incoming × (1 − 2c)), fullHealChance, fullHealLow, life8, breath8, counter, anticipation, paradox, temporalityStart, temporalityOnDeath, genOnAttack.
- **Expected-value approximations:**
  - imprudent: +500 HP, output × 0.6;
  - metamorphOnDeath: full revival, output × 0.6;
  - metamorphOthersOnDeath;
  - evolution: innate passives × 1.3;
  - phoenixFeather.
- **Random-choice passives:** the `alt` field is ignored, so the first passive is always taken ("Nouveau riche", "Nouvelle vie").
- **FLAT:**
  - eternityStart: 25 × value of control;
  - enemyPrec and enemyPrecOnAttack: 1.2 per point;
  - eternityAllOnDeath: 100 × value;
  - immuneEternity / immuneVanish: +20 defense (there is nothing to be immune to);
  - toxLuck: +20;
  - racket.

### b.7 Game constants (L1–18)

| Constant | Used? |
|---|---|
| cardsPerDeck | yes: deck size, number of AoE / ally targets, number of opponent cards |
| turnDurationPerCardAlive | **no** (no time pressure; every ready ability is cast) |
| turnAfterOvertime, overtimeReducingRatio, overtimeScalingRatio | **no** (the 10-turn horizon never reaches overtime at turn 20) |
| frozenOwnerTurns | **no** (freeze is a flat credit) |
| talentDraftSeconds | **no** |
| startLuck, luckPerTurn | yes: shop odds and economy (L288–289, L1306) |
| rerollCost | **no** (copied into `u` at L285, never read; `rerollStep` at L286 is unread too) |
| itemShopMax | yes: expected value of an opening (L2023) |
| luckForSkip | **no** |
| moneyForSkip | **no** (`skipReward` at L287 is unread) |
| deathBounty | yes: +50 Spamtons **for each of our own deaths**, about +15 J each (L907) |
| bansPerPlayer | **no** — see below |
| skipPerCardAlive | **no** |

**bansPerPlayer (INF, low confidence about the rule).** There is no ban phase in the engine. If a ban removes one of our 4 cards before the match, the existing "card lost from turn 1" metric is the right stress test.

**Engine parameters** (`o`, L248–275): `simTurns` 10, `oneActionPerCardPerTurn` false, `vampirismRatio` 0.5, `fullHealValue` 0.45, `echoMaxCasts` 4, `spamtonValue` 0.6, `luckValue` 4, `imprudentMult` 0.6. The flat-credit table `g` is at L312–331.

---

## (c) Structural biases: direction and evidence

### C1. Opponent damage volume is low and identical across profiles
**Direction:** over-rates glass-cannon, back-loaded decks; under-rates survivability.

**FACT-code:** the curve and the scaling by living enemies are at L268, L820 and L825.

**FACT-run: how hard real decks hit, compared with the abstract opponent's 1,801.**

| Deck | Unopposed damage over 10 turns, no talents | With recommended talents |
|---|---|---|
| Codex Maux Ancestraux deck [197,127,244,177] | 4,675 | 4,675 |
| Codex lumineux deck [198,127,81,245] | 4,214 | 4,470 |
| Scorch/Roi Eau deck [69,248,229,260] | 3,940 | 3,940 |
| Gabriel/Roi Nature deck [195,249,45,122] | 2,986 | 3,091 |
| Chouette/Commando Gerz deck [227,188,195,94] | 2,677 | 2,391 |
| Deck chimere | 2,269 | 3,128 |

300 random decks: p10 761, median 1,278, p90 2,164.

**FACT-run: J when the opponent hits harder.**

| Deck | ×1 | ×1.5 | ×2 | ×3 |
|---|---|---|---|---|
| chimere | 8018 | 6952 (−13%) | 1948 (−76%) | 834 |
| alt1 | 7625 | 5681 (−25%) | 4094 (−46%) | 1756 |
| anticrit | 6989 | 3890 (−44%) | 3140 (−55%) | 1769 |
| zerocrit | 6529 | 4338 (−34%) | 3312 (−49%) | 1737 |
| alt2 | 6077 | 4421 (−27%) | 3651 (−40%) | 2399 |

At ×2, all 4 of our cards die in every one of the 18 matches, for every deck.

**INF (high):** a ranked opponent typically hits 1.5–2.6× the abstract curve, i.e. above the ×1.5–×2 crossover, which is exactly where deck chimere collapses.

### C2. Our cards rarely die, so defensive value is invisible
**Direction:** under-rates every survival and death-triggered tool; over-rates fragile engines.

**FACT-run:**
- Runs with at least one own death: chimere 0/18, anticrit 0/18, alt1 2/18, zerocrit 18/18 (Scorch, 350 HP), alt2 18/18.
- Shop gains: see b.5 (Phénix L 0%, Bouclier L 0.1%, Vampirisme L 0.4%).

### C3. The opponent has no active mechanics
**Direction:** over-rates decks that rely on a single carry, on a cooldown rhythm, or on crit/AoE (against Renvoi).

**FACT-run — injected through `de()` / `G()`, 18-match mean, change in J:**

| Scenario | chimere | anticrit | zerocrit | alt1 | alt2 |
|---|---|---|---|---|---|
| Absorb at T7/8, worst card | −43% (Chimère) | −21% (Hippocampe) | −26% (Prisonnière) | −22% (Chimère) | −16% (Sanglier) |
| Freeze worst card every 3rd turn | −27% (Chimère) | −19% (Chimère) | −26% (Murmures) | −21% (Lame) | −11% |
| Cooldowns reset at t5 and t10 | −30% | −25% | −9% | −24% | −13% |
| Precision −10% at t3 and t7 | −12% | −10% | −11% | −12% | −10% |
| Renvoi R on the first focus target | 0% | −2% | −21% | −5% | −6% |
| Renvoi C on all enemies | 0% | −3% | −15% | −5% | −6% |
| Renvoi L on all enemies | −54% | −33% | −40% | −29% | −26% |
| Opponent focuses one card, worst / best | −2% / +1% | −10% / 0% | −31% (Prisonnière) / +9% | −3% / +1.5% | −3% / **+25%** (Sanglier tanks) |

**FACT-run — incident replay in per-card mode** (Tisseuse 500 HP, Fleur de Vie 600 HP + taunt via `opts.focus`, 2 × 700 HP cards carrying the damage):

| Deck | Plain | Taunt only | Absorb only | Taunt + absorb |
|---|---|---|---|---|
| chimere | 9009 | 9123 | 5549 (−38%) | 5597 |
| alt1 | 8416 | 8454 | 8416 (Tisseuse killed at turn 7) | **6844 (−19%)** |
| zerocrit | 7957 | — | — | unaffected (Tisseuse dies at turn 5) |

**INF (high):** taunt alone is nearly harmless in this engine, because the default targeting already focuses one card at a time. Its real cost is that it **protects the key threat** until that threat fires; only taunt + absorb, combined, shows it.

### C4. Control and several passives are flat credits, never consequences
**Direction:** control cards get a fixed value per cast whatever the opponent. That over-rates them against irrelevant targets (for example #122 freezing our own ally) and under-rates them when they deny a decisive cast (freezing Tisseuse before Veuve noire).

**FACT-run:**
- Share of J from flat credits: freeze deck [23,29,59,211] 13%, eternity deck [88,21,64,35] 7%, [78,174,81,96] 6%, owned control decks [33,259,12,116] 11% and [33,259,103,238] 9%.
- Solo cards: #259 Dragon de la Cité Infernale 280 of 816 J (34%), #23 Artisan des Heures 30%, #92 Frost & Glacier 22%.

### C5. Mimétisme is a fixed assumption about the opponent
**Direction:** over-rated against opponents that don't generate; under-rated against heavy generators in our elements.

**FACT-run, J with `g.mimetismPerTurn = 0`:** chimere −9%, alt1 −9%, anticrit −6%, alt2 −6%. The 4 decks containing Chimère owe 6–9% of their score to this one constant.

### C6. Crit as an expected value
**Direction:** hides 3–6× more per-match variance in crit decks. The mean is almost unbiased.

**FACT-run — Monte-Carlo, crit rolled only at damage resolution, 150 × 18 matches and 600 single matches:**

| Deck | 18-match mean vs expected value | Single match (neutral, P1): sd | p10 / p90 | TTK p10 / p90 |
|---|---|---|---|---|
| chimere | 7971 vs 8018 | 902 | 7078 / 9151 | 10.4 / 14.8 |
| alt1 | 7495 vs 7625 | 623 | — | — |
| anticrit | — | 338 | — | — |
| zerocrit | — | 159 | — | — |
| alt2 | — | 146 | — | — |

**Gotcha for harness builders:** randomising `F()` instead of the damage roll also randomises decisions (`Se()` → ally choice in `K()`). The first attempt that did so produced a fake −24% mean.

### C7. J is a 10-turn damage index, not a win measure
**Direction:** a deck can score well and still lose the race; late payoffs are cut off.

**FACT-run — 30-turn race against the engine's own opponent** (`turns: 30`):

| Deck | Wins at ×1 | Wins at ×1.5 | Wins at ×2 |
|---|---|---|---|
| chimere | 18/18 (kill at turn 12) | 14/18 | 0/18 |
| alt1 | 18/18 | 8/18 | 0/18 |
| anticrit | 18/18 | 0/18 | 0/18 |
| zerocrit | 8/18 | 0/18 | 0/18 |
| alt2 | 2/18 | 0/18 | 0/18 |

**FACT-run — per-card duels** against 6 real decks (opponent curves from `q(opp, {potential: true})`) × 2 play orders:

| Deck | Mean J | Wins |
|---|---|---|
| alt1 | 5733 | 3/12 |
| chimere | 5409 | **0/12** (it even loses its own mirror) |
| alt2 | 5293 | 1/12 |
| zerocrit | 5273 | 3/12 |
| anticrit | 4591 | 0/12 |

**INF (medium):** the duels are pessimistic. The opponent's curve is "unopposed", so it ignores the opponent's own loss of synergy and its overkill.

**Horizon effects (FACT-code / FACT-data):**
- The 13 abilities with cooldown ≥ 6 (Veuve noire 8, Résurrection 8, Commando Gerz 10, Mélodie 10, Faerylia 9…) fire 1–2 times.
- The growth abilities (#60, #102, #116, #128, #158, #193, #197, #198) are truncated.
- The turn-10 damage peak of deck chimere (920 at turn 10, neutral P1) explains part of the −30% when its cooldown rhythm shifts by one turn.

### C8. Targeting simplifications
**FACT-code:**
- randomEnemy and spreadEnemy are deterministic focus fire, with all hits lumped on one target and overkill lost.
- Renvoi and Bomba hit our focus target, not the attacker or a random card.
- The opponent's single-target damage always goes to our lowest-HP card.

**FACT-run:** spreading random-target damage evenly (the expected value of random targeting) changes J by +3.1% for alt2, +0.3% for the Chouette/Commando Gerz deck, and **+18.3%** for [101,188,195,94]. In J terms the engine therefore *under*-rates multi-hit spreads, because of lost overkill.

**INF (high):** in a real match those abilities cannot snipe a key enemy (for example Tisseuse before turn 7). That cost is invisible to the engine.

### C9. Our own taunt lasts 1 phase
The data says duration 2. **FACT-run with 2 phases:**
- zerocrit: +16% at ×1, +14% at ×1.5;
- anticrit: −6% at ×1, but **+56%** at ×1.5 (6073 vs 3890).

**INF (medium):** "2 tours" means 2 opponent phases.

### C10. Shop timing and rarity bugs
**Direction:** over-rates late purchases by 1.5–4×; under-rates high-rarity Poison and Spamland; values Métamorphe and late Immunité at 0. Evidence in b.5.

### C11. Dead cards keep their per-turn passives
**FACT-code:** L1307 has no "dead" check (Cœur, Mimétisme, Sac de frappe, critPerTurn, incisive, resOnHit, corrosion, focus). `le()` lets dead Cimetière holders trigger.

**FACT-run, stock engine vs `B/engine_deadfix.js`:**
- anticrit at ×1.5: +14.3% (3890 vs 3404);
- absorb of L'Œil in chimere: +2%;
- everything else ≤ 1%.

### C12. Rule assumptions
- **All ready abilities of all cards are cast every turn** (FACT-code L253). If the real rule were one action per card per turn, J would fall by 5–16% (FACT-run: chimere −10%, freeze deck −16%). INF: the primer implies several casts per turn, low risk.
- **Incoming damage is element-neutral:** the average resistance is used (L692), so Prisonnière's −50% Eau is never punished. The anti-X profiles only change the opponent's resistances.
- **Our own Absorbe (Tisseuse in our deck)** is under-rated: 700 damage + 350 HP, against "removes a card + 100% of its HP" in the real game.
- **L'Inventeur's Materia is never cast** (see a.1).
- **Death bounty:** each of our deaths is worth +15 J.

---

## (d) Where to hook: exact points for an opponent-behaviour harness

**Context: running inside the vm.** `SP/scripts/sim_lab2.js` runs the driver in the engine's own context.
- Top-level `function` declarations are writable globals. Assigning, for example, `de = function(…){…}` from the driver redirects every call site. I verified this with `de`, `G` and `B`.
- `const` bindings (`V`, `D`, `I`, `R`, `Y`, …) can be read but not reassigned.
- The objects `o`, `g`, `d`, `s`, `u` are mutable in place. I verified this with `o.opponent.dpsByTurn`.
- Always restore overrides after use, and do not rely on `evaluate()`: it caches results (see a.1).

### H1. Opponent phase: wrap `de(s, t)` (L821)
`de()` is called at L1306 when we are player 2 (start of turn t, before our casts) and at L1395 when we are player 1 (end of turn t, after our casts).

**Turn mapping for an opponent ability with cooldown c**, following `ee()` (L498): if we are player 1 (opponent second), first use at T = max(1, c − 1); if we are player 2, first use at T = c; then every c turns. For Veuve noire: T = 7 when we play first, 8 when we play second.

**State available inside the wrapper:**
- `s.cards[]`: `dead`, `dmgTaken`, `hpMax`, `taunting`, `abilities[].nextTurn`, `uses`, `crit`, `prec`, `base`, `resAdd`, and the passive flags;
- `s.enemies[]`: `hp`; in per-card mode also `id`, `hpMax`, `res`, `dmg`, `heal`, `phoenix`;
- `s.team`, `s.bonus`, `s.enemy.res`, `s.player`, `s.events`.

**Tested recipes** (`B/t_scen.js`, `B/t_replay.js`):
```js
const de0 = de; let HOOK = null;
de = function(st, t){ if (HOOK) HOOK(st, t); return de0(st, t); };
// absorb (Veuve noire)
//   NB: also clear X.coeur, X.mimetism… because of the dead-card leak (C11), or run on B/engine_deadfix.js
X.dead = true; X.dmgTaken = X.hpMax; tgt.hp += X.hpMax; /* per-card mode: */ tgt.hpMax += X.hpMax;
// freeze / stun X: it skips its next own turn
for (const a of X.abilities) a.nextTurn = Math.max(a.nextTurn, (st.player === 1 ? t + 1 : t) + 1);
// eternity +v on X
for (const a of X.abilities) a.nextTurn += v;
// reset all our cooldowns to their maximum (Gardien Vert)
for (const c of st.cards) for (const a of c.abilities) a.nextTurn = Math.max(a.nextTurn, (st.player === 1 ? t : t - 1) + a.ab.cd);
// precision malus (read by L() at L758)
st.team.prec -= 10;   // or X.prec -= v
// key-card focus: fe() L845 sends all single-target damage to it
if (!st.cards.some(c => !c.dead && c.taunting)) X.taunting = true;
// vanish = undo the flag te() set (L501-574), e.g.
X.mimetism = false; X.lifesteal = 0; X.coeur.pop(); X.phoenix = 0; /* … */
// Tox bought at turn T: inject at T-1 (player 1) or T (player 2)
X.passives.push(p); te(X, p, st);
```

### H2. Enemy taunt
- **Per-card mode:** `q(deck, {opponent: {cards: […]}, focus: '<enemy id>'})`. `w()` (L389–392) puts that enemy first, so it receives every single-target hit and the first weight of the AoE-percentage Tox. aoeEnemy is unaffected.
- **Abstract mode:** override `w()` instead.
- **Brut / Taunt-break:** these need a per-attacker exception. `w()` does not know who is attacking, so wrap `ye()` and clear `opts.focus` when `card.brut` is set.

### H3. Reflect
Wrap `G(e, t, n, r, i, a)` (L923); `r` is our attacking card. Record enemy HP before and after the call, then apply `H(e, t, r, dealt × pct × A(r, e, null, false))` (H at L862, A at L692). FACT-run check: Renvoi L on all enemies gives chimere 3674 (−54%).

### H4. A real opponent deck
Pass `opponent: {id, cards: [{id, hp, res: {6 elements}, phoenix, brut, dmgByTurn: [T], healByTurn: [T], mix: {elem: weight}, aoe}]}` (see `b()` L365–376 and `de()` L825).
- Build it from `q(oppDeck, {potential: true, player: 3 - ourPlayer, turns: T}).potential`, which gives `dmgByCard`, `aoeByCard`, `healByTurn` and `board` (L1298–1302, L1411).
- Get `mix` from `T([{card}])` (L393).
- The arrays must cover all simulated turns: index t − 1, and a missing entry means 0 damage.
- Sanity check: a per-card copy of "neutral" reproduces the abstract score exactly.

### H5. Volume and shape of incoming damage
- `o.opponent.dpsByTurn` (array mutated in place, read through `V()` at L820);
- `o.opponent.aoeShare` (L269);
- `g.enemyHit` (L324: hit size used by Bouclier, Ténacité and the hit count);
- custom profiles can be pushed into `d` (L302–307) as `{id, cardHp, resist, extra}`.

### H6. Crit / precision variance
Override `B` (L784) **only when its 6th argument is false**. That is the real damage resolution from `ye()` (L1017 and L1023). Valuation calls pass `true` (`j()` L701, `Se()` L1170, `pe()` L891, anticipation L1334). Never override `F()` (L748). The working version is in `B/t_var2.js`.

### H7. Horizon
Use `opts.turns` (L1213). `V()` saturates at turn 10, and the offense weights depend on the number of turns (L1401, L1405, L1407), so compare decks by race outcome (`ownDeath` events against `kills` / `ttk`) rather than by J.

### H8. Flat credits and weights
Zero out the `g.*` constants (L312–331), or pass your own weights as `J(result, weights)` (L1451).

### H9. Removing or adding rows
Use `opts.removeAbilities` / `opts.removePassives`, indexed by card (`E()` L493–494), or `opts.extraPassives` (L1289). These are active from turn 1.

### H10. Fixing the dead-card leak
Add `if(t.dead)continue;` at the top of the loop at L1307 (already done in `B/engine_deadfix.js`).

### H11. Our own taunt lasting 2 phases
Carry the `taunting` flag over one extra `de()` call. The recipe is in `B/t_taunt.js`.

### Reference numbers to check other harnesses against
All are deck chimere, 18-match mean J, same driver logic:

| Scenario | J |
|---|---|
| Default | 8018 |
| Opponent damage ×2 | 1948 |
| Absorb Chimère at T7 (player 1) / T8 (player 2) | 4602 |
| Freeze Chimère at t = 3, 6, 9 | 5840 |
| Cooldowns reset at t5 and t10 | 5579 |
| Precision −10 at t3 and t7 | 7059 |
| Renvoi L on all enemies | 3674 |
| Mimétisme set to 0 | 7321 |

Per-card replay (2-match mean): plain 9009, absorb 5549. alt1: taunt + absorb 6844 against 8416 plain.

---

## Appendix: reproducibility
- Formatter: `node SP/spam/audit/B/fmt.js SP/spam/js/simulation.js SP/spam/audit/B_engine_pretty.js`
- Driver build: `node B/mkdrv.js B/t_X.js B/drv_X.js`. This injects the deck ids; `t_var2.js` additionally needs `__N__` replaced.
- Run: `node SP/scripts/sim_lab2.js SP/spam/audit/B_engine_pretty.js "x1=SP/spam/js/model.json" B/drv_X.js B/out_X.json`
- Drivers:

  | Driver | What it measures |
  |---|---|
  | t_decomp | J composition, opponent damage ×1/×2/×3 |
  | t_scen | Injected opponent behaviours |
  | t_replay | Per-card incident replay |
  | t_tox | All shop Tox + purchase timing |
  | t_var | 30-turn race (its crit part is the flawed `F()` version — ignore it) |
  | t_var2 | Crit Monte-Carlo, correct version |
  | t_flat | Flat-credit shares, one-action-per-card rule |
  | t_dead | Dead-card leak, stock vs fixed engine |
  | t_taunt | Our taunt lasting 2 phases |
  | t_oppdps | Real decks' damage output |
  | t_duel | Per-card duels |
  | t_random | Expected value of random targeting |

- Runs are fast: several hundred `q()` matches per second (`t_scen`: about 1,700 matches in 3.5 s).
- Note for Git Bash on Windows: give each command `< /dev/null` so that nothing waits on stdin.
