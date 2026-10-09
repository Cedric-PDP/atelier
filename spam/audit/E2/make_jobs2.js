// Supplementary scenarios. (a) all decks: Corne 25 at its natural CD-7 timing on each target, Rayonnement on all
// cards at its natural CD-5 schedule. (b) the 6 named decks: sensitivity of S-ABSORB (natural timing) to the HP gain
// (removal only), to the absorber choice (focused enemy), to the AI not re-planning after the absorb, and fixed-T grid
// without the HP gain.
const fs = require('fs'), path = require('path');
const decks = JSON.parse(fs.readFileSync(path.join(__dirname, 'decks.json'), 'utf8'));
const P = [0, 1, 2, 3];
const A = [];
for (const p of P) A.push({ name: `SET_nat_p${p}`, stress: { sethp: { turn: 'nat', target: p } } });
A.push({ name: 'CDR_all_nat', stress: { cdreset: { turns: 'nat', target: 'all' } } });
const N = +(process.argv[2] || 5);
for (let c = 0; c < N; c++) {
  const part = decks.filter((_, i) => i % N === c).map(d => ({ key: d.key, ids: d.ids }));
  fs.writeFileSync(path.join(__dirname, `job2_chunk_${c}.json`), JSON.stringify({ decks: part, scenarios: A }));
}
const B = [];
for (const p of P) {
  B.push({ name: `ABS_nat_rm_p${p}`, stress: { absorb: { turn: 'nat', pos: p, gain: false } } });
  B.push({ name: `ABS_nat_focus_p${p}`, stress: { absorb: { turn: 'nat', pos: p, absorber: 'focus' } } });
  B.push({ name: `ABS_nat_keep_p${p}`, stress: { absorb: { turn: 'nat', pos: p, keepProfile: true } } });
  for (const T of [2, 4, 6, 8]) B.push({ name: `ABS_T${T}_rm_p${p}`, stress: { absorb: { turn: T, pos: p, gain: false } } });
}
fs.writeFileSync(path.join(__dirname, 'job2_named.json'), JSON.stringify({ decks: decks.slice(0, 6).map(d => ({ key: d.key, ids: d.ids })), scenarios: B }));
fs.writeFileSync(path.join(__dirname, 'scenarios2.json'), JSON.stringify({ all: A, named: B }, null, 1));
console.log('all-deck extra scenarios', A.length, 'named extra scenarios', B.length);
