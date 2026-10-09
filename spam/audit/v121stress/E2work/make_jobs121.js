// v1.21 scenario catalogue (coordinator's wave 2) + 3 job chunks (max 3 node processes in parallel).
const fs = require('fs'), path = require('path');
const decks = JSON.parse(fs.readFileSync(path.join(__dirname, 'decks121.json'), 'utf8'));
const P = [0, 1, 2, 3];
const S = [{ name: 'BASE', stress: null }];
for (const p of P) S.push({ name: `ABS_nat_p${p}`, stress: { absorb: { turn: 'nat', pos: p } } });       // Veuve noire, CD 8: turn 7 (we 1st) / 8 (we 2nd)
for (const p of P) S.push({ name: `CDR_nat_p${p}`, stress: { cdreset: { turns: 'nat', target: p } } });  // Rayonnement, CD 5: 4+9 / 5+10, one target
S.push({ name: 'SUS_h32', stress: { heal: { perTurn: 32 } } });                                       // median healer card
S.push({ name: 'SUS_rev', stress: { revive: { pct: 0.5, count: 1 } } });                              // first enemy killed revives at 50 %
for (const p of P) S.push({ name: `SET_nat_p${p}`, stress: { sethp: { turn: 'nat', target: p } } });    // Corne 25, CD 7: turn 6 / 7
for (const T of [4, 6, 8]) for (const p of P) S.push({ name: `ABS_T${T}_p${p}`, stress: { absorb: { turn: T, pos: p } } });
S.push({ name: 'DPS_x1.5', stress: null, dps: 1.5 });                                                 // o.opponent.dpsByTurn x1.5
S.push({ name: 'DPS_x2', stress: null, dps: 2 });
fs.writeFileSync(path.join(__dirname, 'scenarios121.json'), JSON.stringify(S, null, 1));
const N = 3;
for (let c = 0; c < N; c++) fs.writeFileSync(path.join(__dirname, `job121_${c}.json`), JSON.stringify({ decks: decks.filter((_, i) => i % N === c).map(d => ({ key: d.key, ids: d.ids })), scenarios: S }));
console.log('scenarios', S.length, 'decks', decks.length, 'matches', S.length * decks.length * 18);
