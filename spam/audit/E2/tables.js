// Renders the markdown tables of E2_stress.md from E2_results.json (+ crosscheck.json, validation.json).
const fs = require('fs'), path = require('path');
const D = __dirname;
const R = JSON.parse(fs.readFileSync(path.join(D, 'E2_results.json'), 'utf8'));
const fmt = v => v == null ? '—' : Math.round(v).toLocaleString('en-US').replace(/,/g, ' ');
const dp = (v, b) => v == null ? '—' : (v >= b ? '+' : '−') + Math.abs(Math.round(100 * (v / b - 1))) + ' %';
const cell = (v, b) => `${fmt(v)} (${dp(v, b)})`;
const short = n => ({ 'Chimère Brasse-chair': 'Chimère', 'Lame de la forêt': 'Lame', "L'Œil des montagnes": 'Œil', 'Keria': 'Keria', 'Hibernatus': 'Hibernatus', 'Hippocampe Nimbé': 'Hippocampe', 'Murmures du Corail Noir': 'Murmures', 'Prisonnière de la Machine': 'Prisonnière', 'Scorch, les Lézards Ignés': 'Scorch', 'Aleera Mange-Cauchemars': 'Aleera', 'Esprit Nature': 'E. Nature', 'Sanglier Doré': 'Sanglier', 'Chouette Polychrome': 'Chouette', 'Esprit Eau': 'E. Eau', 'Esprit Feu': 'E. Feu', 'Esprit Lumière': 'E. Lumière', 'Esprit Terre': 'E. Terre', 'Esprit Ombre': 'E. Ombre', 'Baleine Farceuse': 'Baleine', 'Roi Ombre': 'Roi Ombre', "L'Inventeur": 'Inventeur', 'Vivy': 'Vivy', 'Lapin-Plume': 'Lapin-Plume', 'Dragon Ciel': 'Dragon Ciel', "Naissance d'Aldrin": 'Aldrin', 'Nakyel': 'Nakyel', 'Dragon de la Cité Infernale': 'Dragon Cité' }[n] || n);
const out = [];
const P = s => out.push(s);
const named = R.decks.slice(0, 6);

P('### T1 — cross-check S-ABSORB(T=1) vs "card lost from turn 1" (dead-card)\n');
P('| deck | card removed | dead-card (model_dead) | ABSORB T=1, removal only | + 50-Spamton death bounty | + HP gain to the enemy | engine timing (enemy action of turn 1) |');
P('|---|---|---:|---:|---:|---:|---:|');
for (const d of R.meta.crosscheckT1) for (const c of d.cards)
  P(`| ${d.name} | ${c.card} | ${fmt(c.deadCard)} | ${fmt(c.absorbT1_removalOnly)} | ${fmt(c.absorbT1_removalPlusDeathBounty)} | ${fmt(c.absorbT1_withHpGain)} | ${fmt(c.absorbT1_enemyTiming)} |`);
P('');

P('### T2 — S-ABSORB grid (T = 2, 4, 6, 8 × 4 positions), saved decks + robust alternatives\n');
P('Cells: worst over the 4 positions / mean over the 4 positions, **net** score (engine score in brackets). Baseline in the 2nd column.\n');
P('| deck | baseline | T=2 worst / mean | T=4 worst / mean | T=6 worst / mean | T=8 worst / mean | natural timing (T=7 if we play 1st, 8 if 2nd) worst | most valuable card (net / engine) |');
P('|---|---:|---|---|---|---|---|---|');
for (const d of named) {
  const b = d.base, A = d.ABS;
  const c = T => `${fmt(A.byT_worst_net[T])} / ${fmt(A.byT_mean_net[T])} (${fmt(A.byT_worst_engine[T])} / ${fmt(A.byT_mean_engine[T])}) — ${short(A.byT_worstCard_net[T])}`;
  P(`| ${d.name} [${d.nums.join(',')}] | ${fmt(b)} | ${c(2)} | ${c(4)} | ${c(6)} | ${c(8)} | ${cell(A.nat_worst_net, b)} [eng ${cell(A.nat_worst_engine, b)}] — ${short(A.nat_worst_card)} | ${short(A.mostValuable_net)} / ${short(A.mostValuable_engine)} |`);
}
P('');
P('Per position (mean over T = 2…8, net / engine):\n');
P('| deck | pos 1 | pos 2 | pos 3 | pos 4 |');
P('|---|---|---|---|---|');
for (const d of named) P(`| ${d.name} | ${d.cards.map((n, p) => `${short(n)}: ${fmt(d.ABS.perCardMean_net[p])} / ${fmt(d.ABS.perCardMean_engine[p])}`).join(' | ')} |`);
P('');

P('### T3 — S-ABSORB sensitivity (natural timing), saved decks\n');
P('| deck | absorbed card | net (default) | engine | engine, removal only (no HP gain) | net, absorber = focused enemy | net, AI does not re-plan |');
P('|---|---|---:|---:|---:|---:|---:|');
for (const d of named) d.cards.forEach((n, p) => {
  const s = d.ABS.sensitivity;
  P(`| ${d.name} | ${n} | ${fmt(d.ABS.nat_net[p])} | ${fmt(d.ABS.nat_engine[p])} | ${fmt(s.nat_removalOnly_engine[p])} | ${fmt(s.nat_focusAbsorber_net[p])} | ${fmt(s.nat_noReplan_net[p])} |`);
});
P('');

P('### T4 — other scenarios, saved decks + robust alternatives (score and % vs baseline)\n');
P('| deck | baseline | CDR all cards @5 | CDR all @5+9 | CDR all, natural (4+9 / 5+10) | CDR 1 target, natural, worst target | SUS heal 32/turn engine / net | SUS heal 80/turn net | SUS revive 50 % engine / net | SETHP @4 highest-HP card | SETHP @4 worst target | SETHP natural (6/7), worst target |');
P('|---|---:|---|---|---|---|---|---|---|---|---|---|');
for (const d of named) {
  const b = d.base, C = d.CDR, S = d.SUS, T = d.SET;
  P(`| ${d.name} | ${fmt(b)} | ${cell(C.all_5, b)} | ${cell(C.all_5_9, b)} | ${cell(C.all_nat, b)} | ${cell(C.tgt_nat_worst, b)} ${short(C.tgt_nat_worst_card)} | ${dp(S.h32_engine, b)} / ${cell(S.h32_net, b)} | ${cell(S.h80_net, b)} | ${dp(S.rev_engine, b)} / ${cell(S.rev_net, b)} | ${cell(T.t4_maxhp, b)} | ${cell(T.t4_worst, b)} ${short(T.t4_worst_card)} | ${cell(T.nat_worst, b)} ${short(T.nat_worst_card)} |`);
}
P('');

P('### T5 — realistic set (natural cooldown timing, opponent picks our worst target, net score, clamped at baseline)\n');
P('| deck | baseline | Veuve noire | Rayonnement | heal 32/turn | revive 50 % | Corne 25 | worst | mean drop | rank worst / mean (of 300 owned) |');
P('|---|---:|---|---|---|---|---|---|---:|---|');
for (const d of named) {
  const b = d.base, r = d.realistic;
  P(`| ${d.name} | ${fmt(b)} | ${cell(r.ABS_nat_worst, b)} | ${cell(r.CDR_tgt_nat_worst, b)} | ${cell(r.SUS_h32_net, b)} | ${cell(r.SUS_rev_net, b)} | ${cell(r.SET_nat_worst, b)} | ${fmt(d.realisticWorst)} | ${d.realisticMeanDropPct} % | ${d.rank_realisticWorst ?? 'n/a'} / ${d.rank_realisticMean ?? 'n/a'} |`);
}
P('');

const top = R.decks.filter(x => x.owned);
const line = (x, i) => `| ${i + 1} | ${x.cards.map(short).join(', ')} [${x.nums.join(',')}] | ${fmt(x.base)} (#${x.rankOwned}) | ${fmt(x.realisticWorst)} | ${fmt(x.realisticMean)} | ${x.realisticMeanDropPct} % | ${cell(x.realistic.ABS_nat_worst, x.base)} ${short(x.ABS.nat_worst_card)} | ${dp(x.realistic.CDR_tgt_nat_worst, x.base)} | ${dp(x.realistic.SUS_h32_net, x.base)} | ${dp(x.realistic.SUS_rev_net, x.base)} | ${dp(x.realistic.SET_nat_worst, x.base)} | ${x.features.critDepPct} % |`;
const hdr = '| # | deck | baseline (rank) | realistic worst | realistic mean | mean drop | Veuve noire worst | Rayonnement | heal 32 | revive | Corne 25 | crit share of score |\n|---:|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|';
P('### T6 — top 15 of the 300 owned decks by realistic WORST case\n'); P(hdr);
top.slice().sort((a, b) => b.realisticWorst - a.realisticWorst).slice(0, 15).forEach((x, i) => P(line(x, i))); P('');
P('### T7 — top 15 by realistic MEAN (average of the 5 realistic threats)\n'); P(hdr);
top.slice().sort((a, b) => b.realisticMean - a.realisticMean).slice(0, 15).forEach((x, i) => P(line(x, i))); P('');

P('### T8 — feature correlations (Pearson r over the 300 owned decks; drop % per realistic threat)\n');
const C = R.featureCorrelations;
const lab = { critDepPct: 'crit share of score (1 − nocrit/normal)', lossT1MaxPct: 'single-card dependency (max loss-from-turn-1 %)', hpSum: 'total HP', hpMin: 'lowest card HP', teamBuffers: '# team-buff cards', aoeCards: '# AoE damage cards', longCdAbilities: '# abilities with CD ≥ 3', healers: '# healing cards', hasChimere: 'contains Chimère' };
P('| feature | Veuve noire | Rayonnement | heal 32 | revive | Corne 25 | mean drop | baseline score |');
P('|---|---:|---:|---:|---:|---:|---:|---:|');
for (const [f, l] of Object.entries(lab)) { const c = C[f]; const f2 = v => v == null ? "—" : v.toFixed(2).replace("-", "−"); P(`| ${l} | ${f2(c.ABS_nat_worst)} | ${f2(c.CDR_tgt_nat_worst)} | ${f2(c.SUS_h32_net)} | ${f2(c.SUS_rev_net)} | ${f2(c.SET_nat_worst)} | ${f2(c.mean)} | ${f2(c.base)} |`); }
P('');

P('### T9 — per card (owned cards, over the top-300 decks that contain them)\n');
P('| # | card | HP | decks | absorbed at natural timing: drop net / engine | absorb no-op (card already dead) | "most valuable" share net / engine | Corne 25 target drop | Rayonnement target drop | mean drop of its decks |');
P('|---:|---|---:|---:|---|---:|---|---:|---:|---:|');
for (const c of R.cardTable) P(`| ${c.number} | ${c.name} | ${c.hp} | ${c.decks} | ${c.absorbedDropPct_nat} % / ${c.absorbedDropPct_nat_engine} % | ${c.absorbNoopPct_nat} % | ${c.mostValuableShare} % / ${c.mostValuableShare_engine} % | ${c.setHpTargetDropPct_nat} % | ${c.cdResetTargetDropPct_nat} % | ${c.decksMeanDropPct} % |`);
P('');
fs.writeFileSync(path.join(D, 'tables.md'), out.join('\n'));
console.log('wrote tables.md', out.length, 'lines');
