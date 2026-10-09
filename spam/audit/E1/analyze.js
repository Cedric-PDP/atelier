// Merges stress shards, derives per-deck metrics, deck features, rankings -> E1_results.json + tables.md
const fs = require('fs'), vm = require('vm'), path = require('path');
const SP = path.resolve(__dirname, '../../..');
const { SCENARIOS } = require('./scenarios.js');
const model = JSON.parse(fs.readFileSync(SP + '/spam/js/model.json', 'utf8'));
const byNum = new Map(model.cards.map(c => [c.number, c]));
const byId = new Map(model.cards.map(c => [c.id, c]));
const decks = JSON.parse(fs.readFileSync(__dirname + '/decks.json', 'utf8'));
const validation = JSON.parse(fs.readFileSync(__dirname + '/validation.json', 'utf8'));
const shards = fs.readdirSync(__dirname).filter(f => /^(st_\d+|new_R)\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(__dirname + "/" + f, "utf8")));
const scoreByKey = new Map();
for (const s of shards) for (const d of s.decks) { const k = d.label + '|' + d.nums.join(','); scoreByKey.set(k, Object.assign(scoreByKey.get(k) || {}, d.scores)); }
const evalsTotal = shards.reduce((a, s) => a + s.evals, 0), secMax = Math.max(...shards.map(s => s.seconds));

// ---------- deck features from the baseline plan (neutral profile, player 1) + static card data
const ctx = vm.createContext({ self: { postMessage() {} }, console, Date });
vm.runInContext(fs.readFileSync(__dirname + '/engine_stress.js', 'utf8'), ctx);
ctx.STRESS = undefined;
const I = ctx.ht(model);
const plan18 = vm.runInContext('(ids,mdl)=>{const rows=pt(ids.map(id=>({id,talentId:null})),mdl.cards);return d.flatMap(p=>[1,2].map(pl=>q(rows,{opponent:p,player:pl}).plan))}', ctx);
function optionOf(card, abilityId, optIdx) {
  const ab = card.abilities.find(a => a.id === abilityId);
  return ab ? ab.options[optIdx] : null;
}
function features(d) {
  const plans = plan18(d.ids, model);
  const dmgCard = new Map(d.nums.map(n => [n, 0])), healCard = new Map(d.nums.map(n => [n, 0]));
  let aoe = 0, single = 0, total = 0, heal = 0;
  for (const plan of plans) for (const turn of plan) for (const c of turn) {
    const card = byId.get(c.cardId), o = optionOf(card, c.abilityId, c.option);
    dmgCard.set(card.number, dmgCard.get(card.number) + c.dmg); healCard.set(card.number, healCard.get(card.number) + c.heal);
    total += c.dmg; heal += c.heal;
    if (o && c.dmg > 0) { if (o.target === 'aoeEnemy' || o.target === 'spreadField' || o.target === 'spreadEnemy') aoe += c.dmg; else single += c.dmg; }
  }
  const shares = d.nums.map(n => total > 0 ? dmgCard.get(n) / total : 0);
  const cards = d.nums.map(n => byNum.get(n));
  return {
    dmgShare: Object.fromEntries(d.nums.map((n, i) => [n, +shares[i].toFixed(3)])),
    topCardShare: +Math.max(...shares).toFixed(3),
    topCard: d.nums[shares.indexOf(Math.max(...shares))],
    dmgCards: shares.filter(s => s >= 0.05).length,
    aoeShare: total > 0 ? +(aoe / total).toFixed(3) : 0,
    singleShare: total > 0 ? +(single / total).toFixed(3) : 0,
    healPerDmg: total > 0 ? +(heal / total).toFixed(3) : 0,
    healPerMatch: Math.round(heal / plans.length),
    dmgPerMatch: Math.round(total / plans.length),
    lifesteal: cards.some(c => c.passives.some(p => p.type === 'lifesteal')),
    brut: cards.filter(c => c.passives.some(p => p.type === 'brut')).map(c => c.number),
    hasChimere: d.nums.includes(238),
    hpTotal: cards.reduce((a, c) => a + c.hp, 0),
    minHp: Math.min(...cards.map(c => c.hp)),
  };
}

// ---------- metrics
const pct = (s, b) => b > 0 ? +((b - s) / b * 100).toFixed(2) : null; // positive = loss
const out = [];
for (const d of decks) {
  const sc = scoreByKey.get(d.label + '|' + d.nums.join(','));
  if (!sc) throw new Error('missing scores for ' + d.label);
  const base = sc.base;
  const fpos = pre => [0, 1, 2, 3].map(p => ({ pos: p, card: d.nums[p], score: sc[pre + p], drop: pct(sc[pre + p], base) }));
  const worstOf = arr => arr.reduce((a, b) => (b.score < a.score ? b : a));
  const F3 = fpos('F3p'), F2 = fpos('F2p'), F3n = fpos('F3n'), FT3 = fpos('FT3p'), FT2 = fpos('FT2p');
  const m = {
    base,
    T600: sc.T600, T900: sc.T900, T1200: sc.T1200, T600c: sc.T600c, T900c: sc.T900c, T1200c: sc.T1200c,
    F3: F3, F3worst: worstOf(F3), F3avg: F3.reduce((a, x) => a + x.score, 0) / 4,
    F2: F2, F2worst: worstOf(F2), F2avg: F2.reduce((a, x) => a + x.score, 0) / 4,
    F3n: F3n, F3nworst: worstOf(F3n), F3navg: F3n.reduce((a, x) => a + x.score, 0) / 4,
    FT3: FT3, FT3worst: worstOf(FT3), FT3avg: FT3.reduce((a, x) => a + x.score, 0) / 4,
    FT2: FT2, FT2worst: worstOf(FT2), FT2avg: FT2.reduce((a, x) => a + x.score, 0) / 4,
    // worst over fixed AND timed patterns (removes cooldown-alignment luck of a fixed pattern)
    Fz3: worstOf([...F3.map(x => ({ ...x, mode: 'fixed' })), ...FT3.map(x => ({ ...x, mode: 'timed' }))]),
    Fz2: worstOf([...F2.map(x => ({ ...x, mode: 'fixed' })), ...FT2.map(x => ({ ...x, mode: 'timed' }))]),
    P20: sc.P20, RC: sc.RC, RR: sc.RR, RE: sc.RE, RL: sc.RL, RCa: sc.RCa, REa: sc.REa, RCn: sc.RCn, REn: sc.REn, T900RE: sc.T900RE,
    P10: sc.P10, P5: sc.P5, R1E3: sc.R1E3, R1E0: sc.R1E0,
  };
  const drop = {
    T600: pct(m.T600, base), T900: pct(m.T900, base), T1200: pct(m.T1200, base),
    T600force: pct(m.T600, m.T600c), T900force: pct(m.T900, m.T900c), T1200force: pct(m.T1200, m.T1200c),
    F3worst: pct(m.F3worst.score, base), F3avg: pct(m.F3avg, base), F2worst: pct(m.F2worst.score, base), F2avg: pct(m.F2avg, base),
    F3nworst: pct(m.F3nworst.score, base), F3navg: pct(m.F3navg, base),
    FT3worst: pct(m.FT3worst.score, base), FT3avg: pct(m.FT3avg, base), FT2worst: pct(m.FT2worst.score, base), FT2avg: pct(m.FT2avg, base),
    Fz3: pct(m.Fz3.score, base), Fz2: pct(m.Fz2.score, base),
    P20: pct(m.P20, base), RC: pct(m.RC, base), RR: pct(m.RR, base), RE: pct(m.RE, base), RL: pct(m.RL, base),
    RCa: pct(m.RCa, base), REa: pct(m.REa, base), RCn: pct(m.RCn, base), REn: pct(m.REn, base), T900RE: pct(m.T900RE, base),
    P10: pct(m.P10, base), P5: pct(m.P5, base), R1E3: pct(m.R1E3, base), R1E0: pct(m.R1E0, base),
  };
  for (const k of ['P10', 'P5', 'R1E3', 'R1E0']) if (m[k] == null) throw new Error('missing ' + k + ' for ' + d.label);
  const MAIN = ['T600', 'Fz3', 'P20', 'RC'], HARSH = ['T900', 'Fz2', 'P20', 'RE'];
  const scoreOf = k => (m[k] && typeof m[k] === 'object') ? m[k].score : m[k];
  const agg = keys => {
    const ds = keys.map(k => drop[k]); const ss = keys.map(scoreOf);
    const wi = ds.indexOf(Math.max(...ds));
    return { worstDrop: Math.max(...ds), worstScen: keys[wi], meanDrop: +(ds.reduce((a, b) => a + b, 0) / ds.length).toFixed(2), minScore: Math.min(...ss), meanScore: ss.reduce((a, b) => a + b, 0) / ss.length };
  };
  const feat = features(d);
  // opponent-model sensitivity: enemy focuses our top damage card (EFtop) / any card (worst), with and without Renvoi E
  const topPos = d.nums.indexOf(feat.topCard);
  const EF = fpos('EF'), EFRE = fpos('EFRE');
  m.EF = EF; m.EFRE = EFRE; m.EFtop = EF[topPos]; m.EFREtop = EFRE[topPos]; m.EFworst = worstOf(EF); m.EFREworst = worstOf(EFRE);
  drop.EFtop = pct(m.EFtop.score, base); drop.EFREtop = pct(m.EFREtop.score, base); drop.EFworst = pct(m.EFworst.score, base); drop.EFREworst = pct(m.EFREworst.score, base);
  drop.REgivenEFtop = pct(m.EFREtop.score, m.EFtop.score);
  // harsh set where REFLECT E is evaluated under the worst enemy focus (robustness of the ranking to the opponent model)
  const harshF = (() => { const ds = [drop.T900, drop.Fz2, drop.P20, drop.EFREworst], ss = [m.T900, m.Fz2.score, m.P20, m.EFREworst.score]; return { worstDrop: Math.max(...ds), meanDrop: +(ds.reduce((a, b) => a + b, 0) / 4).toFixed(2), minScore: Math.min(...ss) }; })();
  out.push({ label: d.label, nums: d.nums, names: d.names, owned: d.owned, siteScore: d.siteScore, ownedRank: d.rank, m, drop, main: agg(MAIN), harsh: agg(HARSH), harshFocus: harshF, feat });
}

// ---------- rankings (owned decks only)
const owned = out.filter(d => d.owned);
const rank = (arr, key, dir = 1) => arr.slice().sort((a, b) => dir * (key(a) - key(b)));
const rankings = {
  byHarshMinScore: rank(owned, d => d.harsh.minScore, -1).slice(0, 20).map(d => d.label),
  byMainMinScore: rank(owned, d => d.main.minScore, -1).slice(0, 20).map(d => d.label),
  byHarshMeanDrop: rank(owned, d => d.harsh.meanDrop, 1).slice(0, 20).map(d => d.label),
  byHarshWorstDrop: rank(owned, d => d.harsh.worstDrop, 1).slice(0, 20).map(d => d.label),
  byMainWorstDrop: rank(owned, d => d.main.worstDrop, 1).slice(0, 20).map(d => d.label),
  byHarshFocusMinScore: rank(owned, d => d.harshFocus.minScore, -1).slice(0, 20).map(d => d.label),
};
// rank positions under harsh vs harsh-with-enemy-focus (stability of the maximin ranking)
{
  const r1 = rank(owned, d => d.harsh.minScore, -1), r2 = rank(owned, d => d.harshFocus.minScore, -1);
  owned.forEach(d => { d.rankHarsh = r1.indexOf(d) + 1; d.rankHarshFocus = r2.indexOf(d) + 1; });
  const top10 = r1.slice(0, 10);
  rankings.harshTop10RanksUnderFocus = top10.map(d => ({ label: d.label, nums: d.nums, rankHarsh: d.rankHarsh, rankHarshFocus: d.rankHarshFocus }));
}

// ---------- feature correlations over owned decks (Pearson + Spearman)
function pearson(x, y) { const n = x.length, mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0; }
function ranks(v) { const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = Array(v.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; }
const spearman = (x, y) => pearson(ranks(x), ranks(y));
const FEATS = { topCardShare: d => d.feat.topCardShare, aoeShare: d => d.feat.aoeShare, singleShare: d => d.feat.singleShare, healPerDmg: d => d.feat.healPerDmg, hasChimere: d => d.feat.hasChimere ? 1 : 0, lifesteal: d => d.feat.lifesteal ? 1 : 0, minHp: d => d.feat.minHp, hpTotal: d => d.feat.hpTotal, dmgCards: d => d.feat.dmgCards, base: d => d.m.base };
const DROPS = ['T600', 'T900', 'T900force', 'F3worst', 'F3avg', 'F2worst', 'FT3worst', 'FT3avg', 'Fz3', 'Fz2', 'P20', 'RC', 'RE', 'REn', 'EFtop', 'EFREtop'];
const correlations = {};
for (const dk of DROPS) { correlations[dk] = {}; for (const [fk, f] of Object.entries(FEATS)) { const x = owned.map(f), y = owned.map(d => d.drop[dk]); correlations[dk][fk] = { pearson: +pearson(x, y).toFixed(2), spearman: +spearman(x, y).toFixed(2) }; } }

// ---------- per-card freeze cost (F3 / F2, position of that card), over owned decks containing it
const cardFreeze = {};
for (const d of owned) d.nums.forEach((n, p) => { const c = cardFreeze[n] || (cardFreeze[n] = { n, name: byNum.get(n).name, decks: 0, f3: [], f2: [], ft3: [], ft2: [], share: [] }); c.decks++; c.f3.push(d.m.F3[p].drop); c.f2.push(d.m.F2[p].drop); c.ft3.push(d.m.FT3[p].drop); c.ft2.push(d.m.FT2[p].drop); c.share.push(d.feat.dmgShare[n]); });
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const cardFreezeTable = Object.values(cardFreeze).map(c => ({ n: c.n, name: c.name, decks: c.decks, F3drop: +mean(c.f3).toFixed(1), F2drop: +mean(c.f2).toFixed(1), FT3drop: +mean(c.ft3).toFixed(1), FT2drop: +mean(c.ft2).toFixed(1), FT3max: +Math.max(...c.ft3).toFixed(1), dmgShare: +mean(c.share).toFixed(2), F3max: +Math.max(...c.f3).toFixed(1) })).sort((a, b) => b.F3drop - a.F3drop);

// ---------- group means
const grp = (pred, dk) => { const a = owned.filter(pred).map(d => d.drop[dk]); return a.length ? { n: a.length, mean: +mean(a).toFixed(1), min: +Math.min(...a).toFixed(1), max: +Math.max(...a).toFixed(1) } : null; };
const groups = {};
for (const dk of ['T600', 'T900', 'T900force', 'F3worst', 'F2worst', 'FT3worst', 'Fz3', 'Fz2', 'P20', 'RC', 'RE', 'REa', 'REn', 'RL', 'R1E3', 'R1E0', 'EFtop', 'EFREtop']) groups[dk] = { withChimere: grp(d => d.feat.hasChimere, dk), withoutChimere: grp(d => !d.feat.hasChimere, dk), aoeShareGe50: grp(d => d.feat.aoeShare >= 0.5, dk), aoeShareLt50: grp(d => d.feat.aoeShare < 0.5, dk), topShareGe60: grp(d => d.feat.topCardShare >= 0.6, dk), topShareLt45: grp(d => d.feat.topCardShare < 0.45, dk), withBrut: grp(d => d.feat.brut.length > 0, dk) };

const result = {
  meta: {
    agent: 'E1', date: '2026-10-09', game: '1.20', engineHash: model.engineHash,
    engineSha256: validation.engineSha256,
    validation: { decks: validation.n, maxAbsDiff_stressOff: validation.maxAbsDiff_stressOff, maxAbsDiff_stressOnNoToggle: validation.maxAbsDiff_stressOnNoToggle, allEvaluateJSONIdentical: validation.allEvaluateJSONIdentical, maxAbsDiff_original_vs_site_s1: validation.maxAbsDiff_vs_site_s1 },
    compute: { stressEvaluateCalls: evalsTotal, wallSecondsSlowestShard: secMax, shards: shards.length,
      provenance: '45 scenarios (st_0..5.json) ran on engine_stress sha256 df7146aa… which differs from the final engine (validation.json sha) only by the inert `reflectOne` line; the 4 scenarios P5, P10, R1E3, R1E0 (new_R.json) ran on the final engine; spot check: 12 decks x 45 scenarios re-run on the final engine, 540 comparisons, max |diff| = 0' },
    scenarios: SCENARIOS.map(s => ({ id: s.id, title: s.title, stress: s.stress })),
    dropDefinition: 'drop % = (baseline - scenario) / baseline * 100 ; positive = score lost',
    sets: { main: ['T600', 'Fz3', 'P20', 'RC'], harsh: ['T900', 'Fz2', 'P20', 'RE'], note: 'Fz3 = worst card over fixed 1-in-3 (turns 2,5,8) and timed Gel CD 3; Fz2 = worst card over fixed every-other-turn and timed Gel CD 2' },
  },
  decks: out, rankings, correlations, cardFreezeTable, groups,
};
fs.writeFileSync(__dirname + '/E1_results.json', JSON.stringify(result, null, 1));
console.log('decks', out.length, 'owned', owned.length, 'evals', evalsTotal, 'slowest shard s', secMax);
