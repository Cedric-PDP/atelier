// E1 runner: loads the wiki engine(s) in isolated vm contexts and evaluates decks.
// node e1_runner.js validate <shard> <nShards> <out.json> [maxDecks]
// node e1_runner.js stress   <shard> <nShards> <out.json> [maxDecks]
// node e1_runner.js diag     <shard> <nShards> <out.json>        (named decks, 18-matchup diagnostics)
const fs = require('fs'), vm = require('vm'), path = require('path');
const SP = path.resolve(__dirname, '../../..');
const [mode, shardS, nShardS, outFile, maxS, onlyS] = process.argv.slice(2);
const shard = +shardS, nShards = +nShardS, maxDecks = maxS ? +maxS : Infinity;
const modelTxt = fs.readFileSync(SP + '/spam/js/model.json', 'utf8');
const decksAll = JSON.parse(fs.readFileSync(__dirname + '/decks.json', 'utf8'));
const { SCENARIOS: ALL_SCEN } = require('./scenarios.js');
const SCENARIOS = onlyS ? ALL_SCEN.filter(s => onlyS.split(',').includes(s.id)) : ALL_SCEN;

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
const decks = decksAll.filter((d, i) => i % nShards === shard).slice(0, maxDecks);
const out = { mode, shard, nShards, decks: [] };

if (mode === 'validate') {
  const A = load(SP + '/spam/js/simulation.js');
  const B = load(__dirname + '/engine_stress.js');
  const IA = A.ht(A.__model);
  B.STRESS = undefined; const IB0 = B.ht(B.__model);
  for (const d of decks) {
    const ra = IA.evaluate(sel(d.ids), OPT);
    B.STRESS = undefined; const rb = IB0.evaluate(sel(d.ids), OPT);
    B.STRESS = { on: true }; const IB1 = B.ht(B.__model); const rc = IB1.evaluate(sel(d.ids), OPT);
    evals += 3;
    const ms = r => r.matchups.map(m => m.score);
    const diffB = Math.max(Math.abs(ra.score - rb.score), ...ms(ra).map((v, i) => Math.abs(v - ms(rb)[i])), Math.abs(ra.ttk - rb.ttk), Math.abs(ra.dmgTotal - rb.dmgTotal));
    const diffC = Math.max(Math.abs(ra.score - rc.score), ...ms(ra).map((v, i) => Math.abs(v - ms(rc)[i])), Math.abs(ra.ttk - rc.ttk), Math.abs(ra.dmgTotal - rc.dmgTotal));
    out.decks.push({ label: d.label, nums: d.nums, orig: ra.score, stressOff: rb.score, stressOnNoToggle: rc.score, site: d.siteScore, diffOff: diffB, diffOnEmpty: diffC, identicalJSON: JSON.stringify(ra) === JSON.stringify(rb) });
  }
} else if (mode === 'stress') {
  const B = load(__dirname + '/engine_stress.js');
  for (const d of decks) out.decks.push({ label: d.label, nums: d.nums, scores: {} });
  for (const sc of SCENARIOS) {
    B.STRESS = sc.stress ? Object.assign({ on: true }, sc.stress) : undefined;
    const I = B.ht(B.__model); // fresh instance = fresh evaluate() cache per scenario
    decks.forEach((d, k) => {
      const r = I.evaluate(sel(d.ids), OPT); evals++;
      out.decks[k].scores[sc.id] = r.score;
    });
  }
} else if (mode === 'diag') {
  const B = load(__dirname + '/engine_stress.js');
  const run18 = vm.runInContext('(ids)=>{const rows=pt(ids.map(id=>({id,talentId:null})),__model.cards);return d.flatMap(p=>[1,2].map(pl=>{const r=q(rows,{opponent:p,player:pl});return{p:p.id,pl,score:J(r),offense:r.offense,ttk:r.ttk,ownDeaths:r.ownDeaths,reflTaken:r.reflTaken,dmgTotal:r.dmgTotal,ehpLeft:r.ehpLeft,kills:r.kills,hpLeft:r.hpLeft,frzCount:r.frzCount}}))}', B);
  const named = decksAll.filter(d => !d.label.startsWith('top#'));
  for (const d of named.filter((x, i) => i % nShards === shard)) {
    const rec = { label: d.label, nums: d.nums, names: d.names, scen: {} };
    for (const sc of SCENARIOS) {
      B.STRESS = sc.stress ? Object.assign({ on: true }, sc.stress) : undefined;
      const rs = run18(d.ids); evals += 0.5;
      const avg = k => rs.reduce((a, r) => a + r[k], 0) / rs.length;
      rec.scen[sc.id] = { score: avg('score'), offense: avg('offense'), ttk: avg('ttk'), ownDeaths: avg('ownDeaths'), reflTaken: avg('reflTaken'), dmgTotal: avg('dmgTotal'), ehpLeft: avg('ehpLeft'), kills: avg('kills'), frzCount: avg('frzCount'), winRate: rs.filter(r => r.kills >= 4).length / rs.length };
    }
    out.decks.push(rec);
  }
}
out.evals = evals; out.seconds = (Date.now() - t0) / 1000;
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(mode, 'shard', shard, 'decks', out.decks.length, 'evals', evals, 'sec', out.seconds.toFixed(1));
