// Scenario catalogue + 6 job chunks for the full run (node run.js engine_stress.js job_chunk_i.json res_chunk_i.json).
const fs = require('fs'), path = require('path');
const decks = JSON.parse(fs.readFileSync(path.join(__dirname, 'decks.json'), 'utf8'));
const P = [0, 1, 2, 3];
const S = [];
const add = (name, stress) => S.push({ name, stress });
add('BASE', null);
// S-ABSORB: Tisseuse de Mots "Veuve noire" (absorbAny, CD 8). Card at deck position p removed at turn T; the
// living enemy with the most HP gains the absorbed card's max HP. Fires at the enemy's action in turn T.
for (const T of [2, 4, 6, 8]) for (const p of P) add(`ABS_T${T}_p${p}`, { absorb: { turn: T, pos: p } });
// natural timing of a CD-8 ability: turn 7 if we play first (enemy = 2nd player, cd-1), turn 8 if we play second
for (const p of P) add(`ABS_nat_p${p}`, { absorb: { turn: 'nat', pos: p } });
// S-CDRESET: Gardien Vert "Rayonnement" (resetEnemyCd, CD 5, single target: "The target's cooldowns are reset to maximum")
add('CDR_all_5', { cdreset: { turns: [5], target: 'all' } });          // task wording: all our cards, once at turn 5
add('CDR_all_5_9', { cdreset: { turns: [5, 9], target: 'all' } });     // every 4 turns
for (const p of P) add(`CDR_tgt_5_p${p}`, { cdreset: { turns: [5], target: p } });       // data: one target
for (const p of P) add(`CDR_tgt_nat_p${p}`, { cdreset: { turns: 'nat', target: p } });   // CD-5 schedule: 4,9 / 5,10
// S-SUSTAIN
// every scenario is scored twice by the driver: 'score' (engine metric) and 'net' (offense net of enemy HP gains)
add('SUS_h32', { heal: { perTurn: 32 } });               // median healer card of the data (Soin multiple 40x4/CD5)
add('SUS_h80', { heal: { perTurn: 80 } });               // strong dedicated healer (~P80 of the 23 healer cards)
add('SUS_rev', { revive: { pct: 0.5, count: 1 } });      // first enemy killed comes back once at 50 % HP
// S-SETHP: Cornu mythologique "Corne 25" (setHpPct 25, CD 7)
add('SET_4', { sethp: { turn: 4, target: 'maxhp' } });   // task wording: our highest-HP card at turn 4
for (const p of P) add(`SET_4_p${p}`, { sethp: { turn: 4, target: p } });
add('SET_nat', { sethp: { turn: 'nat', target: 'maxhp' } }); // CD-7 schedule: turn 6 / 7
fs.writeFileSync(path.join(__dirname, 'scenarios.json'), JSON.stringify(S, null, 1));
const N = +(process.argv[2] || 6);
for (let c = 0; c < N; c++) {
  const part = decks.filter((_, i) => i % N === c).map(d => ({ key: d.key, ids: d.ids }));
  fs.writeFileSync(path.join(__dirname, `job_chunk_${c}.json`), JSON.stringify({ decks: part, scenarios: S }));
}
console.log('scenarios', S.length, 'decks', decks.length, 'chunks', N, 'q() calls', S.length * decks.length * 18);
