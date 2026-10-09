// Cross-check S-ABSORB(T=1) against the earlier "card lost from turn 1" metric (fake 'dead-card', model_dead.json).
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const decks = JSON.parse(fs.readFileSync(path.join(__dirname, 'decks.json'), 'utf8')).slice(0, 6);
const ENG = path.join(__dirname, 'engine_stress.js');
const run = (job, out, dead) => {
  const jf = path.join(__dirname, 'job_' + out);
  fs.writeFileSync(jf, JSON.stringify(job));
  execFileSync(process.execPath, [path.join(__dirname, 'run.js'), ENG, jf, path.join(__dirname, out)].concat(dead ? ['--dead'] : []), { stdio: 'inherit' });
  const r = JSON.parse(fs.readFileSync(path.join(__dirname, out), 'utf8'));
  if (r.err) throw new Error(r.err);
  return r.res;
};
// (a) dead-card replica: position p replaced by 'dead-card', STRESS off (model_dead.json)
const deadJob = { decks: [], scenarios: [{ name: 'BASE', stress: null }] };
for (const d of decks) for (let p = 0; p < 4; p++) { const ids = d.ids.slice(); ids[p] = 'dead-card'; deadJob.decks.push({ key: d.key + '#' + p, ids }); }
const deadRes = run(deadJob, 'xc_dead.json', true);
// (b) stress engine variants at T=1
const V = {
  rm_start: { at: 'start', gain: false },
  rmBounty_start: { at: 'start', gain: false, bounty: true },
  gain_start: { at: 'start', gain: true },
  rm_enemy: { gain: false },
  rmKeepProfile_start: { at: 'start', gain: false, keepProfile: true },
  gainFocus_start: { at: 'start', gain: true, absorber: 'focus' },
  gain_enemy: { gain: true },
};
const scen = [{ name: 'BASE', stress: null }];
for (const [k, v] of Object.entries(V)) for (let p = 0; p < 4; p++) scen.push({ name: k + '_p' + p, stress: { absorb: Object.assign({ turn: 1, pos: p }, v) } });
const stRes = run({ decks: decks.map(d => ({ key: d.key, ids: d.ids })), scenarios: scen }, 'xc_stress.json', false);
const out = [];
decks.forEach((d, i) => {
  const s = stRes[i].sc;
  const row = { name: d.name, nums: d.nums, base: s.BASE.score, cards: [] };
  for (let p = 0; p < 4; p++) {
    row.cards.push({ card: d.names[p], dataJson_L: d.L ? d.L[p] : null, deadCard: deadRes[i * 4 + p].sc.BASE.score,
      ...Object.fromEntries(Object.keys(V).map(k => [k, s[k + '_p' + p].score])),
      ttk: { dead: deadRes[i * 4 + p].sc.BASE.ttk, rm_start: s['rm_start_p' + p].ttk, gain_start: s['gain_start_p' + p].ttk },
      sP: { dead: [deadRes[i * 4 + p].sc.BASE.sP1, deadRes[i * 4 + p].sc.BASE.sP2], rm_start: [s['rm_start_p' + p].sP1, s['rm_start_p' + p].sP2], rm_enemy: [s['rm_enemy_p' + p].sP1, s['rm_enemy_p' + p].sP2] } });
  }
  out.push(row);
});
fs.writeFileSync(path.join(__dirname, 'crosscheck.json'), JSON.stringify(out, null, 1));
for (const r of out) { console.log(r.name, r.base); for (const c of r.cards) console.log('  ', c.card.padEnd(28), 'L', c.dataJson_L, 'dead', c.deadCard, '| rm', c.rm_start, 'rm+bounty', c.rmBounty_start, 'gain', c.gain_start, 'gainFocus', c.gainFocus_start, 'keepProf', c.rmKeepProfile_start, '| enemy-timing rm', c.rm_enemy, 'gain', c.gain_enemy, JSON.stringify(c.sP)); }
