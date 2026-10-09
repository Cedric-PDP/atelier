// E1 bench, 1.21 port. Loads the 1.21 wiki engine (original and/or stress copy) in isolated vm contexts.
// node e121_runner.js validate <shard> <nShards> <out.json>
// node e121_runner.js stress   <shard> <nShards> <out.json>
const fs = require('fs'), vm = require('vm'), path = require('path');
const SP = path.resolve(__dirname, '../../../..');
const [mode, shardS, nShardS, outFile] = process.argv.slice(2);
const shard = +shardS, nShards = +nShardS;
const modelTxt = fs.readFileSync(SP + '/spam/v121/model.json', 'utf8');
const decksAll = JSON.parse(fs.readFileSync(__dirname + '/decks121.json', 'utf8'));
const { SCEN121 } = require('./scenarios121.js');

function load(file) {
  const model = JSON.parse(modelTxt);
  const ctx = vm.createContext({ self: { postMessage() {} }, console, Date, fetch: async () => ({ ok: true, json: async () => model }) });
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: path.basename(file) });
  ctx.__model = model;
  return ctx;
}
const sel = ids => ids.map(id => ({ id, talentId: null }));
const OPT = { optimize: false, suggestions: false, shop: false };
const t0 = Date.now();
let evals = 0;
const decks = decksAll.filter((d, i) => i % nShards === shard);
const out = { mode, shard, nShards, decks: [] };

if (mode === 'validate') {
  const A = load(SP + '/spam/v121/dl/simulation.js');
  const B = load(__dirname + '/engine121_stress.js');
  const IA = A.ht(A.__model);
  B.STRESS = undefined; const IB0 = B.ht(B.__model);
  for (const d of decks) {
    const ra = IA.evaluate(sel(d.ids), OPT);
    B.STRESS = undefined; const rb = IB0.evaluate(sel(d.ids), OPT);
    B.STRESS = { on: true }; const IB1 = B.ht(B.__model); const rc = IB1.evaluate(sel(d.ids), OPT);
    evals += 3;
    const ms = r => r.matchups.map(m => m.score);
    const diff = (x, y) => Math.max(Math.abs(x.score - y.score), ...ms(x).map((v, i) => Math.abs(v - ms(y)[i])), Math.abs(x.ttk - y.ttk), Math.abs(x.dmgTotal - y.dmgTotal));
    out.decks.push({ name: d.name, nums: d.nums, orig: ra.score, stressOff: rb.score, stressOnNoToggle: rc.score, s1: d.s1,
      diffOff: diff(ra, rb), diffOnEmpty: diff(ra, rc), identicalJSON: JSON.stringify(ra) === JSON.stringify(rb) });
  }
} else if (mode === 'stress') {
  const B = load(__dirname + '/engine121_stress.js');
  for (const d of decks) out.decks.push({ name: d.name, nums: d.nums, scores: {} });
  for (const sc of SCEN121) {
    B.STRESS = sc.stress ? Object.assign({ on: true }, sc.stress) : undefined;
    const I = B.ht(B.__model); // fresh instance = fresh evaluate() cache per scenario
    decks.forEach((d, k) => { out.decks[k].scores[sc.id] = I.evaluate(sel(d.ids), OPT).score; evals++; });
  }
}
out.evals = evals; out.seconds = (Date.now() - t0) / 1000;
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(mode, 'shard', shard, 'decks', out.decks.length, 'evals', evals, 'sec', out.seconds.toFixed(1));
