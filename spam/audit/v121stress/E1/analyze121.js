// Merges the 1.21 stress shards into the compact SP/spam/audit/v121stress/E1_121.json (+ a markdown digest).
const fs = require('fs'), path = require('path');
const SP = path.resolve(__dirname, '../../../..');
const { SCEN121, DESC, SHATTER } = require('./scenarios121.js');
const model = JSON.parse(fs.readFileSync(SP + '/spam/v121/model.json', 'utf8'));
const byNum = new Map(model.cards.map(c => [c.number, c]));
const decks = JSON.parse(fs.readFileSync(__dirname + '/decks121.json', 'utf8'));
const val = JSON.parse(fs.readFileSync(__dirname + '/validation121.json', 'utf8'));
const shards = fs.readdirSync(__dirname).filter(f => /^st121_\d+\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(__dirname + '/' + f, 'utf8')));
const sc = new Map();
for (const s of shards) for (const d of s.decks) sc.set(d.nums.join(','), d.scores);
const r0 = x => Math.round(x), r1 = x => Math.round(x * 10) / 10;
const pct = (s, b) => r1((s - b) / b * 100); // negative = loss

// static: ally heals in the deck (option with heals and target ally/allAllies/randomAlly)
const allyHealers = nums => nums.filter(n => byNum.get(n).abilities.some(a => a.options.some(o => o.heals.length > 0 && ['ally', 'allAllies', 'randomAlly'].includes(o.target))));

const REAL = ['R1E', 'R1L', 'Fz3d', 'P20', 'T900'], UB = ['R1E', 'R1L', 'RE4', 'Fz3', 'P20', 'T900'];
const out = [];
for (const d of decks) {
  const s = sc.get(d.nums.join(','));
  if (!s) throw new Error('missing ' + d.nums);
  const base = s.base;
  const worstOf = (pres) => { let best = null; for (const pre of pres) for (let p = 0; p < 4; p++) { const v = s[pre.id + p]; if (best == null || v < best.v) best = { v, card: d.nums[p], mode: pre.mode }; } return best; };
  const fz = worstOf([{ id: 'F3p', mode: 'fixe' }, { id: 'FT3p', mode: 'minuté' }]);
  const fzd = worstOf([{ id: 'FD3p', mode: 'fixe' }, { id: 'FDT3p', mode: 'minuté' }]);
  const scores = { R1E: s.R1E, R1L: s.R1L, RE4: s.RE4, Fz3: fz.v, Fz3d: fzd.v, P20: s.P20, T900: s.T900 };
  const scen = {}; for (const [k, v] of Object.entries(scores)) scen[k] = [r0(v), pct(v, base)];
  const agg = keys => { let w = null; for (const k of keys) if (!w || scores[k] < scores[w]) w = k; return { worst: [w, r0(scores[w]), pct(scores[w], base)], meanDrop: r1(keys.reduce((a, k) => a + (scores[k] - base) / base * 100, 0) / keys.length) }; };
  const A = agg(REAL), U = agg(UB);
  const healers = allyHealers(d.nums);
  out.push({ nums: d.nums, ...(d.name ? { name: d.name } : {}), topRank: d.topRank, base: r0(base), scen,
    fz: { Fz3: [fz.card, fz.mode], Fz3d: [fzd.card, fzd.mode] }, allyHeal: healers.length ? healers : false,
    worst: A.worst, meanDrop: A.meanDrop, worstUB: U.worst, meanDropUB: U.meanDrop });
}

// ranks
const rankBy = (key, dir) => out.slice().sort((a, b) => dir * (key(a) - key(b)));
const set = (arr, n) => arr.slice(0, n).map(d => ({ nums: d.nums, ...(d.name ? { name: d.name } : {}), base: d.base, worst: d.worst, meanDrop: d.meanDrop, worstUB: d.worstUB, meanDropUB: d.meanDropUB }));
const byBase = rankBy(d => d.base, -1), byWorst = rankBy(d => d.worst[1], -1), byWorstUB = rankBy(d => d.worstUB[1], -1), byMean = rankBy(d => d.meanDrop, -1);
out.forEach(d => { d.rk = { base: byBase.indexOf(d) + 1, worst: byWorst.indexOf(d) + 1, worstUB: byWorstUB.indexOf(d) + 1, meanDrop: byMean.indexOf(d) + 1 }; });
const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const scenStats = {};
for (const k of ['R1E', 'R1L', 'RE4', 'Fz3', 'Fz3d', 'P20', 'T900']) { const a = out.map(d => d.scen[k][1]); scenStats[k] = { medianPct: r1(median(a)), worstPct: Math.min(...a), decksLosingMoreThan20pct: a.filter(x => x < -20).length }; }
const withHeal = out.filter(d => d.allyHeal), noHeal = out.filter(d => !d.allyHeal);
const meanOf = (arr, f) => r1(arr.reduce((a, d) => a + f(d), 0) / arr.length);
const withDC = out.filter(d => d.nums.includes(180)), noDC = out.filter(d => !d.nums.includes(180));

const result = {
  meta: {
    agent: 'E1', wave: 2, game: '1.21', engineHash: model.engineHash, date: '2026-10-09',
    validation: { decks: val.decks, maxAbsDiff_stressOff: val.maxAbsDiff_stressOff, maxAbsDiff_stressOnNoToggle: val.maxAbsDiff_stressOnNoToggle, evaluateJSONIdentical: val.allEvaluateJSONIdentical, vsTopOwnedS1: val.vsTopOwnedS1, vsCheck121: val.vsCheck121, sha256: val.engineSha256 },
    compute: { evaluateCalls: shards.reduce((a, s) => a + s.evals, 0), processes: shards.length, slowestShardSec: Math.max(...shards.map(s => s.seconds)) },
    notes: [
      '1.21: patches E1 réappliqués sur les noms minifiés 1.21 (H→de, D→O, ge→he, G→K, ye→ve, L→z, W→G, R→B), 19 ancres uniques.',
      '1.21: bris de glace du Gel = ' + SHATTER + ' (Frozen_E value 60), adversaire abstrait dpsByTurn 113→262 (+~5 % vs 1.20).',
      'Score = score wiki (moyenne de J sur 9 profils × 2 positions), sans talents, sans boutique. pct < 0 = perte.',
    ],
    legend: 'scen.X = [score, % vs base]; worst = [scénario, score, %] et meanDrop = moyenne des % sur le jeu RÉALISTE {R1E,R1L,Fz3d,P20,T900}; worstUB/meanDropUB = jeu BORNE HAUTE {R1E,R1L,RE4,Fz3,P20,T900}; fz = carte gelée la plus coûteuse et schéma; allyHeal = cartes du deck ayant un soin d\'allié (false = aucun : le dégel ne passe que par la boutique, tours pairs); rk = rangs sur les ' + out.length + ' decks (1 = meilleur).',
  },
  thaw120: (() => { const t = JSON.parse(fs.readFileSync(__dirname + '/thaw120.json', 'utf8')); return { note: '1.20 (bris de glace 40), même variante dégel, moteur 1.20 + hooks validé sur ' + t.validation.decks + ' decks (écart max ' + t.validation.maxAbsDiff + ')', decks: t.decks.map(d => ({ label: d.label, nums: d.nums, base: Math.round(d.base), Fz3: [d.Fz3.card, d.Fz3pct], Fz3d: [d.Fz3d.card, d.Fz3dpct] })) }; })(),
  scenarios: Object.fromEntries(['R1E', 'R1L', 'RE4', 'Fz3', 'Fz3d', 'P20', 'T900'].map(k => [k, DESC[k]])),
  sets: { realiste: REAL, borneHaute: UB },
  scenStats,
  decks: out,
  rankings: {
    byBase: set(byBase, 10),
    byWorstRealiste: set(byWorst, 20),
    byWorstBorneHaute: set(byWorstUB, 20),
    byMeanDropRealiste: set(byMean, 20),
    named: out.filter(d => d.name).map(d => ({ name: d.name, nums: d.nums, base: d.base, worst: d.worst, meanDrop: d.meanDrop, worstUB: d.worstUB, rk: d.rk, allyHeal: d.allyHeal })).sort((a, b) => b.worst[1] - a.worst[1]),
    noAllyHeal: { count: noHeal.length, of: out.length, meanFz3dPct: { withAllyHeal: meanOf(withHeal, d => d.scen.Fz3d[1]), noAllyHeal: meanOf(noHeal, d => d.scen.Fz3d[1]) }, meanFz3Pct: { withAllyHeal: meanOf(withHeal, d => d.scen.Fz3[1]), noAllyHeal: meanOf(noHeal, d => d.scen.Fz3[1]) },
      topByBase: noHeal.sort((a, b) => b.base - a.base).slice(0, 15).map(d => ({ nums: d.nums, ...(d.name ? { name: d.name } : {}), base: d.base, Fz3: d.scen.Fz3, Fz3d: d.scen.Fz3d, worst: d.worst })) },
    dragonCiel: { withCount: withDC.length, without: noDC.length, meanPct: Object.fromEntries(['R1E', 'R1L', 'RE4', 'Fz3', 'Fz3d', 'P20', 'T900'].map(k => [k, { with180: meanOf(withDC, d => d.scen[k][1]), without180: meanOf(noDC, d => d.scen[k][1]) }])) },
  },
};
fs.writeFileSync(path.resolve(__dirname, '..', 'E1_121.json'), JSON.stringify(result));
console.log('E1_121.json written,', out.length, 'decks,', JSON.stringify(result).length, 'chars');
console.log('scenStats', JSON.stringify(scenStats));
console.log('noAllyHeal', JSON.stringify({ count: noHeal.length, fz3d: result.rankings.noAllyHeal.meanFz3dPct, fz3: result.rankings.noAllyHeal.meanFz3Pct }));
console.log('dragonCiel', JSON.stringify(result.rankings.dragonCiel));
for (const d of result.rankings.byWorstRealiste.slice(0, 8)) console.log('W', d.nums.join(','), d.name || '', d.base, JSON.stringify(d.worst), d.meanDrop, JSON.stringify(d.worstUB));
for (const d of result.rankings.byWorstBorneHaute.slice(0, 5)) console.log('U', d.nums.join(','), d.name || '', d.base, JSON.stringify(d.worstUB), d.meanDropUB);
for (const d of result.rankings.named) console.log('N', d.name.padEnd(9), d.nums.join(','), d.base, JSON.stringify(d.worst), d.meanDrop, JSON.stringify(d.worstUB), JSON.stringify(d.rk), d.allyHeal);
