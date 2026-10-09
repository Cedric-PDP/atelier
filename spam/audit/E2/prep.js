// Builds decks.json: the 6 named decks + the top-300 owned decks of the collection by baseline (site/data.json s1).
const fs = require('fs'), path = require('path');
const SPAM = path.join(__dirname, '..', '..');
const SP = path.join(SPAM, '..');
const model = JSON.parse(fs.readFileSync(path.join(SPAM, 'js', 'model.json'), 'utf8'));
const pool = JSON.parse(fs.readFileSync(path.join(SPAM, 'app', 'pool_order.json'), 'utf8'));
const data = JSON.parse(fs.readFileSync(path.join(SP, 'site', 'data.json'), 'utf8'));
const OWNED = [1,2,3,4,5,6,12,27,30,33,69,82,102,103,116,117,153,156,158,160,180,227,238,243,251,259];
const byId = new Map(model.cards.map(c => [c.id, c]));
const byNum = new Map(model.cards.map(c => [c.number, c]));
const poolNum = pool.map(id => byId.get(id).number);
const D = data.decks;
const nDecks = D.s1.length;
if (D.k.length !== 4 * nDecks) throw new Error('k length');
const keyOf = nums => nums.slice().sort((a, b) => a - b).join('-');
const index = new Map();
const all = [];
for (let i = 0; i < nDecks; i++) {
  const pidx = [...D.k.slice(4 * i, 4 * i + 4)].map(ch => parseInt(ch, 32));
  const nums = pidx.map(p => poolNum[p]);
  const rec = { i, nums, s1: D.s1[i], s0: D.s0[i], L: D.L.slice(4 * i, 4 * i + 4), owned: nums.every(n => OWNED.includes(n)) };
  index.set(keyOf(nums), rec);
  all.push(rec);
}
// sanity: s1 sorted descending
for (let i = 1; i < nDecks; i++) if (D.s1[i] > D.s1[i - 1]) throw new Error('s1 not sorted at ' + i);
const ownedDecks = all.filter(r => r.owned);
const NAMED = [
  ['deck chimere', [103, 238, 156, 117]],
  ['anti-critiques', [12, 238, 27, 117]],
  ['zéro critique', [102, 116, 12, 69]],
  ['deck aleera', [231, 238, 156, 117]],
  ['robuste A', [3, 103, 117, 238]],
  ['robuste B', [69, 160, 227, 238]],
];
const out = [];
const seen = new Set();
for (const [name, nums] of NAMED) {
  const r = index.get(keyOf(nums));
  out.push({ key: keyOf(nums), name, nums, ids: nums.map(n => byNum.get(n).id), names: nums.map(n => byNum.get(n).name),
    s1: r ? r.s1 : null, s0: r ? r.s0 : null, L: r ? nums.map(n => r.L[r.nums.indexOf(n)]) : null,
    rankOwned: r ? ownedDecks.indexOf(r) + 1 : null, owned: nums.every(n => OWNED.includes(n)) });
  seen.add(keyOf(nums));
}
let added = 0;
for (const r of ownedDecks) {
  if (added >= 300) break;
  added++;
  const k = keyOf(r.nums);
  if (seen.has(k)) { out.find(d => d.key === k).top300 = true; continue; }
  seen.add(k);
  out.push({ key: k, name: null, nums: r.nums, ids: r.nums.map(n => byNum.get(n).id), names: r.nums.map(n => byNum.get(n).name),
    s1: r.s1, s0: r.s0, L: r.L, rankOwned: ownedDecks.indexOf(r) + 1, owned: true, top300: true });
}
fs.writeFileSync(path.join(__dirname, 'decks.json'), JSON.stringify(out));
console.log('owned decks', ownedDecks.length, 'top300 cutoff s1', ownedDecks[299].s1, 'total decks to run', out.length);
for (const d of out.slice(0, 8)) console.log(d.name, d.nums.join(','), d.s1, d.s0, JSON.stringify(d.L), 'rank', d.rankOwned);
