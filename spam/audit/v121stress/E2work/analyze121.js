// Builds SP/spam/audit/v121stress/E2_121.json (compact) from res121_*.json.
const fs = require('fs'), path = require('path');
const W = __dirname, OUTF = path.join(W, '..', 'E2_121.json');
const rd = f => JSON.parse(fs.readFileSync(path.join(W, f), 'utf8'));
const decks = rd('decks121.json');
const model = JSON.parse(fs.readFileSync(path.join(W, '..', '..', '..', 'v121', 'model.json'), 'utf8'));
const card = new Map(model.cards.map(c => [c.number, c]));
const res = new Map(); const chk = { n: 0, max: 0 }; const wall = [];
for (let c = 0; c < 3; c++) { const r = rd(`res121_${c}.json`); if (r.err) throw new Error(r.err); if (!r.dpsRestored) throw new Error('dps not restored ' + c); for (const x of r.res) res.set(x.key, x.sc); chk.n += r.offenseRecomputeCheck.n; chk.max = Math.max(chk.max, r.offenseRecomputeCheck.max); wall.push(r.wallMs); }
const P = [0, 1, 2, 3];
const r0 = Math.round, r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const argmin = a => a.reduce((b, v, i) => v < a[b] ? i : b, 0);
const SC = {
  ABS_nat: 'Veuve noire (Tisseuse de Mots #123, absorbAny, CD 8) at its natural turn (7 if we play 1st, 8 if 2nd) on our worst position: the card leaves play, the living enemy with most HP gains its max HP',
  CDR_nat: 'Rayonnement (Gardien Vert #78, CD 5) resets ONE target card\'s cooldowns to full at turns 4+9 (we 1st) / 5+10 (we 2nd), worst target',
  SUS_h32: 'enemy heals 32 HP per turn (median healer card of the data), split over its damaged living cards',
  SUS_rev: 'the first enemy card killed revives once at 50 % of its max HP (Phénix R / Résurrection)',
  SET_nat: 'Corne 25 (Cornu mythologique #139, CD 7) sets one of our cards to 25 % of max HP at turn 6 (we 1st) / 7 (we 2nd), worst target',
  ABS_T4: 'Veuve noire forced at turn 4, worst position', ABS_T6: 'Veuve noire forced at turn 6, worst position', ABS_T8: 'Veuve noire forced at turn 8, worst position',
  'DPS_x1.5': 'abstract opponent damage o.opponent.dpsByTurn x1.5 (no other threat)', DPS_x2: 'abstract opponent damage o.opponent.dpsByTurn x2 (no other threat)',
};
const POS = ['ABS_nat', 'CDR_nat', 'SET_nat', 'ABS_T4', 'ABS_T6', 'ABS_T8'];
const pname = { ABS_nat: 'ABS_nat_p', CDR_nat: 'CDR_nat_p', SET_nat: 'SET_nat_p', ABS_T4: 'ABS_T4_p', ABS_T6: 'ABS_T6_p', ABS_T8: 'ABS_T8_p' };
const REAL = ['ABS_nat', 'CDR_nat', 'SUS_h32', 'SUS_rev', 'SET_nat'];
const feat = n => {
  const c = card.get(n);
  return { hp: c.hp,
    aoe: c.abilities.some(a => a.options.some(o => o.hits.length && ['aoeEnemy', 'spreadField', 'spreadEnemy'].includes(o.target))) || c.passives.some(p => p.type === 'aoe'),
    team: c.abilities.some(a => a.options.some(o => o.effects.some(e => ['team', 'ally', 'randomAlly'].includes(e.scope) && ['base', 'crit', 'critMult', 'prec', 'res', 'hpMax', 'temporality'].includes(e.type)))) || c.passives.some(p => ['berserk', 'teamRes'].includes(p.type)),
    longCd: c.abilities.filter(a => a.cd >= 3).length,
    heal: c.abilities.some(a => a.options.some(o => o.heals.length)) || c.passives.some(p => ['lifesteal', 'regen'].includes(p.type)) };
};
const out = [], cardAcc = {}; let baseVsS1 = 0;
for (const d of decks) {
  const sc = res.get(d.key); if (!sc) throw new Error('missing ' + d.key);
  const base = sc.BASE.score; if ((d.s1 ?? d.s1top) != null) baseVsS1 = Math.max(baseVsS1, Math.abs(base - (d.s1 ?? d.s1top)));
  const net = {}, engine = {}, tgt = {}, noop = {};
  for (const k of POS) {
    const nv = P.map(p => sc[pname[k] + p].net), ev = P.map(p => sc[pname[k] + p].score), i = argmin(nv);
    net[k] = r0(nv[i]); engine[k] = r0(Math.min(...ev)); tgt[k] = d.nums[i];
    if (k === 'ABS_nat') noop[k] = P.map(p => sc[pname[k] + p].noop);
  }
  for (const k of ['SUS_h32', 'SUS_rev', 'DPS_x1.5', 'DPS_x2']) { net[k] = r0(sc[k].net); engine[k] = r0(sc[k].score); }
  const R = REAL.map(k => Math.min(net[k], base));
  const wi = argmin(R);
  const s1 = d.s1 ?? d.s1top, s0 = d.s0 ?? d.s0top;
  const f4 = d.nums.map(feat);
  const rec = {
    ...(d.name ? { name: d.name } : {}), nums: d.nums, base: r0(base), rankTop: d.topRank, crit: s1 && s0 ? r1(100 * (1 - s0 / s1)) : null,
    net, engine, tgt, worst: r0(R[wi]), worstId: REAL[wi], meanDrop: r1(mean(R.map(v => 100 * (1 - v / base)))),
    _f: { crit: s1 && s0 ? 100 * (1 - s0 / s1) : null, hpSum: f4.reduce((s, f) => s + f.hp, 0), hpMin: Math.min(...f4.map(f => f.hp)), aoe: f4.filter(f => f.aoe).length,
      team: f4.filter(f => f.team).length, longCd: f4.reduce((s, f) => s + f.longCd, 0), heal: f4.filter(f => f.heal).length,
      chimere: d.nums.includes(238) ? 1 : 0, dragonCiel: d.nums.includes(180) ? 1 : 0, depProxy: 100 * (1 - engine.ABS_T4 / base) },
    _wins: sc.BASE.wins,
  };
  out.push(rec);
  // per-card accumulation (card as the absorbed / Corne 25 / Rayonnement target at natural timing)
  d.nums.forEach((n, p) => {
    const a = cardAcc[n] || (cardAcc[n] = { decks: 0, absNet: [], absEng: [], noop: [], set: [], cdr: [], mvNet: 0, mvEng: 0 });
    a.decks++;
    a.absNet.push(100 * (1 - sc['ABS_nat_p' + p].net / base)); a.absEng.push(100 * (1 - sc['ABS_nat_p' + p].score / base));
    a.noop.push(100 * sc['ABS_nat_p' + p].noop / 18); a.set.push(100 * (1 - sc['SET_nat_p' + p].score / base)); a.cdr.push(100 * (1 - sc['CDR_nat_p' + p].score / base));
    if (tgt.ABS_nat === n) a.mvNet++;
    if (argmin(P.map(q => sc['ABS_nat_p' + q].score)) === p) a.mvEng++;
  });
}
// rankings
const line = x => ({ nums: x.nums, name: x.name, base: x.base, worst: x.worst, worstId: x.worstId, meanDrop: x.meanDrop, mean: r0(mean(REAL.map(k => Math.min(x.net[k], x.base)))), dpsX2: x.engine.DPS_x2, crit: x.crit });
const by = (f, n = 20, filt = () => true) => out.filter(filt).slice().sort(f).slice(0, n).map(line);
const meanReal = x => mean(REAL.map(k => Math.min(x.net[k], x.base)));
const rankings = {
  byWorst: by((a, b) => b.worst - a.worst),
  byRealisticMean: by((a, b) => meanReal(b) - meanReal(a)),
  byMeanDrop_base7000: by((a, b) => a.meanDrop - b.meanDrop, 20, x => x.base >= 7000),
  byDpsX2: by((a, b) => b.engine.DPS_x2 - a.engine.DPS_x2),
};
const rk = arr => new Map(arr.map((x, i) => [x, i + 1]));
const rW = rk(out.slice().sort((a, b) => b.worst - a.worst)), rM = rk(out.slice().sort((a, b) => meanReal(b) - meanReal(a))), rB = rk(out.slice().sort((a, b) => b.base - a.base)), rD = rk(out.slice().sort((a, b) => b.engine.DPS_x2 - a.engine.DPS_x2));
for (const x of out) x.ranks = { base: rB.get(x), worst: rW.get(x), mean: rM.get(x), dpsX2: rD.get(x) };
rankings.named = out.filter(x => x.name).map(x => ({ name: x.name, nums: x.nums, base: x.base, worst: x.worst, worstId: x.worstId, meanDrop: x.meanDrop, ranks: x.ranks }));
// correlations (Pearson, 307 decks)
const pear = (xs, ys) => { const ok = xs.map((v, i) => v != null && ys[i] != null); const X = xs.filter((_, i) => ok[i]), Yv = ys.filter((_, i) => ok[i]); const mx = mean(X), my = mean(Yv); let a = 0, b = 0, c = 0; for (let i = 0; i < X.length; i++) { a += (X[i] - mx) * (Yv[i] - my); b += (X[i] - mx) ** 2; c += (Yv[i] - my) ** 2; } return b && c ? r2(a / Math.sqrt(b * c)) : null; };
const drop = (x, k) => 100 * (1 - Math.min(x.net[k], x.base) / x.base);
const targets = { ...Object.fromEntries(REAL.map(k => [k, x => drop(x, k)])), ABS_T4: x => drop(x, 'ABS_T4'), 'DPS_x2': x => 100 * (1 - x.engine.DPS_x2 / x.base), meanDrop: x => x.meanDrop, base: x => x.base };
const correlations = {};
for (const f of ['crit', 'depProxy', 'hpSum', 'hpMin', 'aoe', 'team', 'longCd', 'heal', 'chimere', 'dragonCiel']) {
  correlations[f] = {}; for (const [k, fn] of Object.entries(targets)) correlations[f][k] = pear(out.map(x => x._f[f]), out.map(fn));
}
const cards = Object.entries(cardAcc).map(([n, a]) => ({ n: +n, name: card.get(+n).name, hp: card.get(+n).hp, decks: a.decks,
  absorbedDropNet: r1(mean(a.absNet)), absorbedDropEng: r1(mean(a.absEng)), deadBeforeAbsorbPct: r1(mean(a.noop)),
  corne25DropAsTarget: r1(mean(a.set)), rayonnementDropAsTarget: r1(mean(a.cdr)), worstAbsorbTargetShareNet: r1(100 * a.mvNet / a.decks), worstAbsorbTargetShareEng: r1(100 * a.mvEng / a.decks) }))
  .sort((a, b) => b.decks - a.decks);
// population medians
const med = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const medians = {};
for (const k of Object.keys(SC)) medians[k] = { net: r1(med(out.map(x => 100 * (1 - x.net[k] / x.base)))), engine: r1(med(out.map(x => 100 * (1 - x.engine[k] / x.base)))) };
const val = rd('validation121.json');
const meta = {
  engine: 'SP/spam/v121/dl/simulation.js (v1.21, model engineHash 36e2c03d5b7bf4a1) + 10 exact-substring patches re-applied on the renamed v1.21 anchors (le, _e, se, be; helpers bound to O, ce, se, T, w, g, o) — make_engine121.js; threats via globalThis.STRESS, default off',
  validation: { decks: val.decks, maxAbsDiff: val.maxAbsDiff, note: 'orig v1.21 vs stress engine, threats off: evaluate(), Z(), per-match loop, STRESS={}, x1.5/x2 damage; named decks also equal check121.json (s1, x1.5, x2) exactly' },
  crosscheckT1: { comparedWith: 'v121check/check121.json L (dead-card)', ...val.crosscheckT1, explanation: 'when we play 2nd (same timing for both methods) 63/72 within ±0.5 and 70/72 within ±5 (2 Scorch outliers: the 1-HP fake card soaks turn-1 damage and flips a death). All large gaps are when we play 1st on Dragon Ciel decks: Dragon Ciel has Vengeur (avenger: its abilities become ready when an ally dies); the fake dead-card dies at the END of turn 1, the cross-check variant fired the on-death trigger at the START of turn 1 (one extra early cast). With the trigger at the enemy action instead, Keria/Dragon Ciel positions agree within 2–8 points; the remaining gaps are cards that act in turn 1 before being absorbed.' },
  deadCardBias: { note: 'dead-card loss-from-turn-1 (check121 L) vs a clean removal at the start of turn 1 (no on-death trigger), 18 named decks: Dragon Ciel decks (non-Dragon card removed) get +540 points on average (play 1st +394, 2nd +687, max +1,701) because the fake card dies in turn 1 and triggers Dragon Ciel Vengeur (its abilities become ready); other decks +18 (the 50-Spamton bounty). check121 L therefore overstates Dragon Ciel decks.', dragonCielDecksMeanDiff: -540.3, dragonCielDecksMin: -1701.4, otherDecksMeanDiff: -18 },
  offenseRecomputeCheck: chk, wallMs: wall, baselineVsCoordinatorS1_maxAbsDiff: r2(baseVsS1),
  readings: { engine: 'wiki score J unchanged', net: 'J with offense counted net of the HP the enemy gained that turn (absorb gain, heal, revive), same turn weights, floored at 0 per match; equals engine for CDR, SET, DPS and won matches' },
  worst: 'min over the 5 realistic threats (ABS_nat, CDR_nat, SUS_h32, SUS_rev, SET_nat; net reading; each clamped at base — a threat cannot help a real player)',
  meanDrop: 'mean % drop over the same 5 realistic threats',
  tgt: 'card number at the worst position (net reading) for positional scenarios',
  baselineWins: { decksWithAWin: out.filter(x => x._wins > 0).length, of: out.length, meanWinsPer18: r2(mean(out.map(x => x._wins))) },
  medianDropPct: medians,
};
for (const x of out) { delete x._f; delete x._wins; }
fs.writeFileSync(OUTF, JSON.stringify({ meta, scenarios: SC, decks: out, rankings, correlations, cards }));
console.log('wrote', OUTF, fs.statSync(OUTF).size, 'bytes; decks', out.length, 'offense check', JSON.stringify(chk));
console.log('medians', JSON.stringify(medians));
console.log('wins', JSON.stringify(meta.baselineWins));
for (const x of rankings.named) console.log(JSON.stringify(x));
console.log('--- byWorst'); rankings.byWorst.slice(0, 12).forEach((x, i) => console.log(i + 1, JSON.stringify(x)));
console.log('--- byMean'); rankings.byRealisticMean.slice(0, 12).forEach((x, i) => console.log(i + 1, JSON.stringify(x)));
console.log('--- byMeanDrop base>=7000'); rankings.byMeanDrop_base7000.slice(0, 10).forEach((x, i) => console.log(i + 1, JSON.stringify(x)));
console.log('--- byDpsX2'); rankings.byDpsX2.slice(0, 10).forEach((x, i) => console.log(i + 1, JSON.stringify(x)));
console.log('--- corr'); for (const [f, v] of Object.entries(correlations)) console.log(f.padEnd(11), JSON.stringify(v));
console.log('--- cards'); for (const c of cards) console.log(JSON.stringify(c));
