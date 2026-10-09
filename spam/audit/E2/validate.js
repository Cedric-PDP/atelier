// Step 2 validation: with STRESS off, the patched engine must return exactly the original engine's score.
// Runs the original simulation.js and engine_stress.js on the same 80 decks (6 named + 34 top owned + 40 random
// decks from the whole 31-card pool incl. non-owned cards), via the public evaluate() AND the X()/q() paths.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const SPAM = path.join(__dirname, '..', '..');
const decks = JSON.parse(fs.readFileSync(path.join(__dirname, 'decks.json'), 'utf8'));
const pool = JSON.parse(fs.readFileSync(path.join(SPAM, 'app', 'pool_order.json'), 'utf8'));
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const sample = decks.slice(0, 40).map(d => ({ key: d.key, ids: d.ids }));
while (sample.length < 80) {
  const s = new Set(); while (s.size < 4) s.add(pool[Math.floor(rnd() * pool.length)]);
  sample.push({ key: 'rnd' + sample.length, ids: [...s] });
}
const job = { checkX: true, decks: sample, scenarios: [{ name: 'BASE', stress: null, exact: true }, { name: 'EMPTY', stress: {}, exact: true }] };
const jf = path.join(__dirname, 'job_validate.json');
fs.writeFileSync(jf, JSON.stringify(job));
const run = (eng, out) => { execFileSync(process.execPath, [path.join(__dirname, 'run.js'), eng, jf, out], { stdio: 'inherit' }); return JSON.parse(fs.readFileSync(out, 'utf8')); };
const A = run(path.join(SPAM, 'js', 'simulation.js'), path.join(__dirname, 'val_orig.json'));
const B = run(path.join(__dirname, 'engine_stress.js'), path.join(__dirname, 'val_stress.json'));
if (A.err || B.err) throw new Error(A.err || B.err);
let maxEval = 0, maxX = 0, maxLoopVsX = 0, maxEmpty = 0, maxLoop = 0;
for (let i = 0; i < A.res.length; i++) {
  const a = A.res[i], b = B.res[i];
  maxEval = Math.max(maxEval, Math.abs(a.evalScore - b.evalScore));
  maxX = Math.max(maxX, Math.abs(a.xScore - b.xScore));
  maxLoop = Math.max(maxLoop, Math.abs(a.sc.BASE.exact - b.sc.BASE.exact));
  maxLoopVsX = Math.max(maxLoopVsX, Math.abs(b.sc.BASE.exact - b.xScore), Math.abs(b.xScore - b.evalScore));
  maxEmpty = Math.max(maxEmpty, Math.abs(b.sc.EMPTY.exact - b.sc.BASE.exact));
}
const named = decks.slice(0, 6).map((d, i) => ({ name: d.name, nums: d.nums, orig: A.res[i].evalScore, stress: B.res[i].evalScore, dataJson_s1: d.s1 }));
const rep = { decks: A.res.length, maxAbsDiff_evaluate_orig_vs_stress: maxEval, maxAbsDiff_X_orig_vs_stress: maxX,
  maxAbsDiff_driverLoop_orig_vs_stress: maxLoop, maxAbsDiff_driverLoop_vs_X_vs_evaluate: maxLoopVsX,
  maxAbsDiff_STRESS_emptyObject_vs_off: maxEmpty, named, wallMs: { orig: A.wallMs, stress: B.wallMs } };
fs.writeFileSync(path.join(__dirname, 'validation.json'), JSON.stringify(rep, null, 1));
console.log(JSON.stringify(rep, null, 1));
