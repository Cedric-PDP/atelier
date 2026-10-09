// Validation of the v1.21 port: with all threats off the stress engine must return exactly the original v1.21
// engine's score (evaluate(), Z(), driver loop, STRESS={}), incl. the x1.5 / x2 opponent-damage variants; the named
// decks are also compared with SP/spam/audit/v121check/check121.json (s1, x1.5, x2 computed independently with
// fresh ht() instances). Then the T=1 absorb cross-check against the dead-card metric (check121 L).
// Runs one child node process at a time (<= 2 node processes in total).
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const W = __dirname, V121 = path.join(W, '..', '..', '..', 'v121');
const decks = JSON.parse(fs.readFileSync(path.join(W, 'decks121.json'), 'utf8'));
const pool = JSON.parse(fs.readFileSync(path.join(W, '..', '..', '..', 'app', 'pool_order.json'), 'utf8'));
let seed = 4242; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const sample = decks.slice(0, 58).map(d => ({ key: d.key, ids: d.ids }));   // 18 named + 40 top owned
while (sample.length < 88) { const s = new Set(); while (s.size < 4) s.add(pool[Math.floor(rnd() * pool.length)]); sample.push({ key: 'rnd' + sample.length, ids: [...s] }); }
const scen = [{ name: 'BASE', stress: null, exact: true }, { name: 'EMPTY', stress: {}, exact: true },
  { name: 'DPS15', stress: null, dps: 1.5, exact: true }, { name: 'DPS2', stress: null, dps: 2, exact: true }];
const jf = path.join(W, 'job_val121.json');
fs.writeFileSync(jf, JSON.stringify({ checkX: true, decks: sample, scenarios: scen }));
const run = (eng, out, job = jf, dead = false) => { execFileSync(process.execPath, [path.join(W, 'run121.js'), eng, job, out].concat(dead ? ['--dead'] : []), { stdio: 'inherit' }); const r = JSON.parse(fs.readFileSync(out, 'utf8')); if (r.err) throw new Error(r.err); return r; };
const A = run(path.join(V121, 'dl', 'simulation.js'), path.join(W, 'val121_orig.json'));
const B = run(path.join(W, 'engine_stress121.js'), path.join(W, 'val121_stress.json'));
const mx = { evaluate: 0, Z: 0, loopBase: 0, loopDps15: 0, loopDps2: 0, loopVsZvsEval: 0, emptyVsOff: 0, check121_s1: 0, check121_x15: 0, check121_x2: 0 };
const up = (k, v) => { mx[k] = Math.max(mx[k], Math.abs(v)); };
A.res.forEach((a, i) => {
  const b = B.res[i];
  up('evaluate', a.evalScore - b.evalScore); up('Z', a.zScore - b.zScore);
  up('loopBase', a.sc.BASE.exact - b.sc.BASE.exact); up('loopDps15', a.sc.DPS15.exact - b.sc.DPS15.exact); up('loopDps2', a.sc.DPS2.exact - b.sc.DPS2.exact);
  up('loopVsZvsEval', b.sc.BASE.exact - b.zScore); up('loopVsZvsEval', b.zScore - b.evalScore);
  up('emptyVsOff', b.sc.EMPTY.exact - b.sc.BASE.exact);
  const d = decks[i];
  if (i < 18 && d.s1 != null) { up('check121_s1', b.evalScore - d.s1); up('check121_x15', b.sc.DPS15.exact - d.x15); up('check121_x2', b.sc.DPS2.exact - d.x2); }
});
// T=1 cross-check on the 18 named decks: absorb at the very start of turn 1, removal only, + the 50-Spamton death
// bounty that the fake dead-card collects -> should reproduce check121 L (dead-card) within a few points
const xs = [];
for (let p = 0; p < 4; p++) xs.push({ name: 'T1rmB_p' + p, stress: { absorb: { turn: 1, pos: p, at: 'start', gain: false, bounty: true } } });
const jx = path.join(W, 'job_xc121.json');
fs.writeFileSync(jx, JSON.stringify({ decks: decks.slice(0, 18).map(d => ({ key: d.key, ids: d.ids })), scenarios: xs }));
const X1 = run(path.join(W, 'engine_stress121.js'), path.join(W, 'xc121.json'), jx);
const diffs = [];
X1.res.forEach((r, i) => decks[i].L.forEach((L, p) => diffs.push({ deck: decks[i].name, card: decks[i].names[p], deadCard: Math.round(L * 10) / 10, absorbT1: r.sc['T1rmB_p' + p].score, diff: Math.round((r.sc['T1rmB_p' + p].score - L) * 10) / 10 })));
const absd = diffs.map(x => Math.abs(x.diff)).sort((a, b) => a - b);
const rep = { decks: A.res.length, maxAbsDiff: mx, dpsRestored: [A.dpsRestored, B.dpsRestored],
  crosscheckT1: { n: diffs.length, within0_5: absd.filter(v => v <= 0.5).length, within5: absd.filter(v => v <= 5).length, maxAbs: absd[absd.length - 1], largest: diffs.slice().sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 5) },
  wallMs: { orig: A.wallMs, stress: B.wallMs } };
fs.writeFileSync(path.join(W, 'validation121.json'), JSON.stringify(rep, null, 1));
console.log(JSON.stringify(rep, null, 1));
