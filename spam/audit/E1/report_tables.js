// Renders markdown tables from E1_results.json (+ diag.json if present) -> tables.md
const fs = require('fs');
const R = JSON.parse(fs.readFileSync(__dirname + '/E1_results.json', 'utf8'));
const model = JSON.parse(fs.readFileSync(__dirname + '/../../js/model.json', 'utf8'));
const byNum = new Map(model.cards.map(c => [c.number, c]));
const nm = n => byNum.get(n).name.replace(/,.*$/, '');
const f0 = x => Math.round(x).toLocaleString('en-US');
const dp = x => (x > 0 ? '−' : '+') + Math.abs(x).toFixed(1) + ' %'; // drop>0 means loss
const cell = (s, d) => `${f0(s)} (${dp(d)})`;
const L = [];
const named = R.decks.filter(d => !d.label.startsWith('top#'));
const owned = R.decks.filter(d => d.owned);

L.push('### T1 — Saved decks and robust alternatives (score, change vs baseline)\n');
L.push('| Deck | Cards | Baseline | S-TAUNT 600 | S-TAUNT 900 | S-FREEZE 1/3 worst (card) | S-FREEZE 1/3 avg | S-FREEZE 1/2 worst (card) | S-PREC −20 | S-REFLECT C 25 % | S-REFLECT E 75 % |');
L.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const d of named) {
  L.push(`| ${d.label} | ${d.nums.join(', ')} | ${f0(d.m.base)} | ${cell(d.m.T600, d.drop.T600)} | ${cell(d.m.T900, d.drop.T900)} | ${cell(d.m.F3worst.score, d.drop.F3worst)} #${d.m.F3worst.card} | ${cell(d.m.F3avg, d.drop.F3avg)} | ${cell(d.m.F2worst.score, d.drop.F2worst)} #${d.m.F2worst.card} | ${cell(d.m.P20, d.drop.P20)} | ${cell(d.m.RC, d.drop.RC)} | ${cell(d.m.RE, d.drop.RE)} |`);
}
L.push('');
L.push('### T2 — Saved decks: sensitivities and extras (change vs baseline unless stated)\n');
L.push('| Deck | TAUNT 1200 | forcing only 600 / 900 / 1200 (vs same-HP control) | FREEZE 1/3 worst w/o ice-break dmg | FREEZE timed Gel CD 3: worst (card) / avg | FREEZE timed Gel CD 2: worst (card) / avg | REFLECT R 50 % | REFLECT L 100 % | REFLECT E: engine / reflect-then-lifesteal / netted | Taunter 900 + Renvoi E on it |');
L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const d of named) {
  L.push(`| ${d.label} | ${dp(d.drop.T1200)} | ${dp(d.drop.T600force)} / ${dp(d.drop.T900force)} / ${dp(d.drop.T1200force)} | ${dp(d.drop.F3nworst)} | ${dp(d.drop.FT3worst)} (#${d.m.FT3worst.card}) / ${dp(d.drop.FT3avg)} | ${dp(d.drop.FT2worst)} (#${d.m.FT2worst.card}) / ${dp(d.drop.FT2avg)} | ${dp(d.drop.RR)} | ${dp(d.drop.RL)} | ${dp(d.drop.RE)} / ${dp(d.drop.REa)} / ${dp(d.drop.REn)} | ${dp(d.drop.T900RE)} |`);
}
L.push('');
L.push('### T2b — Saved decks: weaker, more common intensities (change vs baseline)\n');
L.push('| Deck | PREC −5 (one Imprécision talent, EV) | PREC −10 (one Phare, AoE −10 %) | PREC −20 | ONE enemy card with Renvoi E, attacked last | ONE enemy card with Renvoi E, attacked first | Renvoi C on all 4 | Renvoi E on all 4 |');
L.push('|---|---:|---:|---:|---:|---:|---:|---:|');
for (const d of named) L.push(`| ${d.label} | ${dp(d.drop.P5)} | ${dp(d.drop.P10)} | ${dp(d.drop.P20)} | ${dp(d.drop.R1E3)} | ${dp(d.drop.R1E0)} | ${dp(d.drop.RC)} | ${dp(d.drop.RE)} |`);
L.push('');
L.push('### T3 — Saved decks: S-FREEZE by frozen card (change vs baseline; fixed 1 turn in 3 / fixed every other turn / timed Gel CD 3)\n');
L.push('| Deck | pos 1 | pos 2 | pos 3 | pos 4 |');
L.push('|---|---|---|---|---|');
for (const d of named) L.push(`| ${d.label} | ${d.m.F3.map((x, i) => `#${x.card} ${nm(x.card)}: ${dp(x.drop)} / ${dp(d.m.F2[i].drop)} / ${dp(d.m.FT3[i].drop)}`).join(' | ')} |`);
L.push('');
L.push('### T4 — Saved decks: worst case and mean over the scenario sets\n');
L.push('Main set = {TAUNT 600, Fz3 = FREEZE 1-in-3 (worst card, worst of fixed turns 2/5/8 and timed Gel CD 3), PREC −20, REFLECT C}. Harsh set = {TAUNT 900, Fz2 = FREEZE every other turn (worst card, worst of fixed and timed Gel CD 2), PREC −20, REFLECT E}.\n');
L.push('| Deck | Baseline | main: worst (scenario) | main: mean drop | main: min score | harsh: worst (scenario) | harsh: mean drop | harsh: min score |');
L.push('|---|---:|---:|---:|---:|---:|---:|---:|');
for (const d of named) L.push(`| ${d.label} | ${f0(d.m.base)} | ${dp(d.main.worstDrop)} (${d.main.worstScen}) | ${dp(d.main.meanDrop)} | ${f0(d.main.minScore)} | ${dp(d.harsh.worstDrop)} (${d.harsh.worstScen}) | ${dp(d.harsh.meanDrop)} | ${f0(d.harsh.minScore)} |`);
L.push('');

function topTable(title, arr, n) {
  L.push(title + '\n');
  L.push('| # | Cards | Owned rank (baseline) | Baseline | harsh min score (worst scen.) | harsh mean drop | main min score | TAUNT 900 | Fz3 (card, mode) | Fz2 (card, mode) | PREC −20 | REFLECT C | REFLECT E |');
  L.push('|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  arr.slice(0, n).forEach((d, i) => L.push(`| ${i + 1} | ${d.nums.map(x => '#' + x + ' ' + nm(x)).join(', ')} | ${d.ownedRank ?? '—'} | ${f0(d.m.base)} | ${f0(d.harsh.minScore)} (${d.harsh.worstScen}) | ${dp(d.harsh.meanDrop)} | ${f0(d.main.minScore)} | ${dp(d.drop.T900)} | ${dp(d.drop.Fz3)} #${d.m.Fz3.card} ${d.m.Fz3.mode} | ${dp(d.drop.Fz2)} #${d.m.Fz2.card} ${d.m.Fz2.mode} | ${dp(d.drop.P20)} | ${dp(d.drop.RC)} | ${dp(d.drop.RE)} |`));
  L.push('');
}
const byMaximin = owned.slice().sort((a, b) => b.harsh.minScore - a.harsh.minScore);
topTable('### T5 — Owned decks ranked by worst-case score over the HARSH set (maximin)', byMaximin, 20);
const byMainMaximin = owned.slice().sort((a, b) => b.main.minScore - a.main.minScore);
topTable('### T6 — Owned decks ranked by worst-case score over the MAIN set (maximin)', byMainMaximin, 15);
const byMeanDrop = owned.filter(d => d.m.base >= 6000).sort((a, b) => a.harsh.meanDrop - b.harsh.meanDrop);
topTable('### T7 — Owned decks with baseline ≥ 6,000 ranked by smallest mean drop over the HARSH set', byMeanDrop, 15);
const byWorstDrop = owned.filter(d => d.m.base >= 6000).sort((a, b) => a.harsh.worstDrop - b.harsh.worstDrop);
topTable('### T8 — Owned decks with baseline ≥ 6,000 ranked by smallest worst-case drop over the HARSH set', byWorstDrop, 10);

L.push('### T9 — Distribution of the change over the ' + owned.length + ' owned decks (top-300 by baseline + named)\n');
L.push('| Scenario | median | p10 (mildest) | p90 (harshest) | best deck | worst deck | decks losing > 20 % |');
L.push('|---|---:|---:|---:|---:|---:|---:|');
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const SC = [['T600', 'S-TAUNT 600'], ['T900', 'S-TAUNT 900'], ['T1200', 'S-TAUNT 1200 (extra)'], ['T900force', 'forcing only, 900 (vs same-HP control)'],
  ['F3worst', 'S-FREEZE 1/3, worst card'], ['F3avg', 'S-FREEZE 1/3, avg of 4 cards'], ['F2worst', 'S-FREEZE 1/2, worst card'], ['F2avg', 'S-FREEZE 1/2, avg of 4 cards'],
  ['FT3worst', 'S-FREEZE timed Gel CD 3, worst card'], ['FT3avg', 'S-FREEZE timed Gel CD 3, avg of 4 cards'], ['FT2worst', 'S-FREEZE timed Gel CD 2, worst card'], ['FT2avg', 'S-FREEZE timed Gel CD 2, avg of 4 cards'], ['Fz3', 'Fz3 = worst card, worst of fixed 1/3 and timed CD 3 (main set)'], ['Fz2', 'Fz2 = worst card, worst of fixed 1/2 and timed CD 2 (harsh set)'],
  ['P5', 'S-PREC −5 (one Imprécision, EV)'], ['P10', 'S-PREC −10'], ['P20', 'S-PREC −20'], ['R1E3', 'ONE enemy card with Renvoi E, attacked last'], ['R1E0', 'ONE enemy card with Renvoi E, attacked first'], ['RC', 'S-REFLECT C 25 %'], ['RR', 'S-REFLECT R 50 % (extra)'], ['RE', 'S-REFLECT E 75 %'], ['REa', 'S-REFLECT E, reflect then lifesteal'], ['REn', 'S-REFLECT E, lifesteal netted'], ['RL', 'S-REFLECT L 100 % (extra)'], ['T900RE', 'taunter 900 + Renvoi E on it (extra)']];
for (const [k, t] of SC) { const a = owned.map(d => d.drop[k]); L.push(`| ${t} | ${dp(q(a, 0.5))} | ${dp(q(a, 0.1))} | ${dp(q(a, 0.9))} | ${dp(Math.min(...a))} | ${dp(Math.max(...a))} | ${a.filter(x => x > 20).length} |`); }
L.push('');

L.push('### T10 — Which card hurts most when frozen (owned decks containing the card; S-FREEZE on that card)\n');
L.push('| Card | decks | mean damage share | fixed 1 turn in 3: mean | worst | fixed every other turn: mean | timed Gel CD 3: mean | worst | timed Gel CD 2: mean |');
L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const c of R.cardFreezeTable) L.push(`| #${c.n} ${c.name} | ${c.decks} | ${(c.dmgShare * 100).toFixed(0)} % | ${dp(c.F3drop)} | ${dp(c.F3max)} | ${dp(c.F2drop)} | ${dp(c.FT3drop)} | ${dp(c.FT3max)} | ${dp(c.FT2drop)} |`);
L.push('');

L.push('### T11 — Feature ↔ drop correlation over owned decks (Spearman ρ; positive = the feature goes with a LARGER loss)\n');
const FE = ['topCardShare', 'aoeShare', 'singleShare', 'healPerDmg', 'hasChimere', 'minHp', 'hpTotal', 'dmgCards', 'base'];
L.push('| Drop | ' + FE.join(' | ') + ' |');
L.push('|---|' + FE.map(() => '---:').join('|') + '|');
for (const [dk, row] of Object.entries(R.correlations)) L.push(`| ${dk} | ${FE.map(f => row[f].spearman.toFixed(2)).join(' | ')} |`);
L.push('');

L.push('### T12 — Group means of the change (owned decks)\n');
L.push('| Scenario | with Chimère #238 | without | AoE share ≥ 50 % | AoE share < 50 % | top card ≥ 60 % of dmg | top card < 45 % | with a Brut card |');
L.push('|---|---:|---:|---:|---:|---:|---:|---:|');
const g = x => x ? `${dp(x.mean)} (n=${x.n})` : '—';
for (const [dk, row] of Object.entries(R.groups)) L.push(`| ${dk} | ${g(row.withChimere)} | ${g(row.withoutChimere)} | ${g(row.aoeShareGe50)} | ${g(row.aoeShareLt50)} | ${g(row.topShareGe60)} | ${g(row.topShareLt45)} | ${g(row.withBrut)} |`);
L.push('');

L.push('### T14 — Opponent-model sensitivity: the enemy focuses one of our cards instead of our lowest-HP card (change vs baseline)\n');
L.push('EF top = enemy single-target hits on our top damage card; worst = worst of the 4 positions. "harsh+focus" = harsh set with REFLECT E evaluated under the worst focus.\n');
L.push('| Deck | Baseline | REFLECT E (engine targeting) | EF top (card) | EF top + REFLECT E | EF worst | EF + REFLECT E worst (card) | harsh min score → harsh+focus min score | maximin rank harsh → harsh+focus |');
L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
const tsens = [...named, ...owned.slice().sort((a, b) => b.harsh.minScore - a.harsh.minScore).slice(0, 10).filter(d => d.label.startsWith('top#'))];
for (const d of tsens) L.push(`| ${d.label.startsWith('top#') ? d.nums.join(', ') : d.label} | ${f0(d.m.base)} | ${dp(d.drop.RE)} | ${dp(d.drop.EFtop)} (#${d.m.EFtop.card}) | ${dp(d.drop.EFREtop)} | ${dp(d.drop.EFworst)} | ${dp(d.drop.EFREworst)} (#${d.m.EFREworst.card}) | ${f0(d.harsh.minScore)} → ${f0(d.harshFocus.minScore)} | ${d.rankHarsh ?? '—'} → ${d.rankHarshFocus ?? '—'} |`);
L.push('');
{
  const a = owned.map(d => d.drop.EFREworst), b = owned.map(d => d.drop.EFtop);
  L.push(`Over the ${owned.length} owned decks: EF top median ${dp(q(b, 0.5))}; EF + REFLECT E worst median ${dp(q(a, 0.5))} (REFLECT E with engine targeting: ${dp(q(owned.map(d => d.drop.RE), 0.5))}).\n`);
}

if (fs.existsSync(__dirname + '/diag.json')) {
  const D = JSON.parse(fs.readFileSync(__dirname + '/diag.json', 'utf8'));
  L.push('### T13 — Saved decks: mechanics behind the scores (mean over the 18 matches)\n');
  L.push('| Deck | Scenario | score | own deaths | enemy kills | dmg dealt | reflected dmg taken | EHP left | freezes applied |');
  L.push('|---|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const d of D.decks) for (const s of ['base', 'T900', 'F3p0', 'F3p1', 'F3p2', 'F3p3', 'FT3p0', 'FT3p1', 'FT3p2', 'FT3p3', 'P20', 'RC', 'RE', 'REn']) {
    const x = d.scen[s]; if (!x) continue;
    L.push(`| ${d.label} | ${s} | ${f0(x.score)} | ${x.ownDeaths.toFixed(2)} | ${x.kills.toFixed(2)} | ${f0(x.dmgTotal)} | ${f0(x.reflTaken)} | ${f0(x.ehpLeft)} | ${(x.frzCount ?? 0).toFixed(2)} |`);
  }
  L.push('');
}
fs.writeFileSync(__dirname + '/tables.md', L.join('\n'));
console.log('tables.md lines', L.length);
