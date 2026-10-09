// Builds decks.json: the 4 saved decks + 2 robust alternatives + top-300 owned decks of site/data.json (by s1).
const fs = require('fs'), path = require('path');
const SP = path.resolve(__dirname, '../../..');
const model = JSON.parse(fs.readFileSync(SP + '/spam/js/model.json', 'utf8'));
const pool = JSON.parse(fs.readFileSync(SP + '/spam/app/pool_order.json', 'utf8'));
const data = JSON.parse(fs.readFileSync(SP + '/site/data.json', 'utf8'));
const byNum = new Map(model.cards.map(c => [c.number, c]));
const byId = new Map(model.cards.map(c => [c.id, c]));
const OWNED = [1,2,3,4,5,6,12,27,30,33,69,82,102,103,116,117,153,156,158,160,180,227,238,243,251,259];
const ownedSet = new Set(OWNED);
const named = [
  ['deck chimere', [103,238,156,117]],
  ['anti-critiques', [12,238,27,117]],
  ['zéro critique', [102,116,12,69]],
  ['deck aleera', [231,238,156,117]],
  ['robuste A [3,103,117,238]', [3,103,117,238]],
  ['robuste B [69,160,227,238]', [69,160,227,238]],
];
const out = [];
const seen = new Set();
const keyOf = nums => nums.slice().sort((a, b) => a - b).join('-');
for (const [label, nums] of named) {
  out.push({ label, nums, ids: nums.map(n => byNum.get(n).id), names: nums.map(n => byNum.get(n).name), owned: nums.every(n => ownedSet.has(n)), siteScore: null, rank: null });
  seen.add(keyOf(nums));
}
const K = data.decks.k, S1 = data.decks.s1;
let taken = 0, rankOwned = 0;
const top = [];
for (let i = 0; i < S1.length && taken < 300; i++) {
  const idx = [...K.slice(4 * i, 4 * i + 4)].map(ch => parseInt(ch, 32));
  const nums = idx.map(j => byId.get(pool[j]).number);
  if (!nums.every(n => ownedSet.has(n))) continue;
  rankOwned++;
  taken++;
  const key = keyOf(nums);
  // site s1 for named decks too
  for (const d of out) if (keyOf(d.nums) === key) { d.siteScore = S1[i]; d.rank = rankOwned; }
  if (seen.has(key)) continue;
  seen.add(key);
  top.push({ label: 'top#' + rankOwned, nums, ids: nums.map(n => byNum.get(n).id), names: nums.map(n => byNum.get(n).name), owned: true, siteScore: S1[i], rank: rankOwned });
}
// site scores of named decks outside the top 300
for (const d of out) if (d.siteScore == null) {
  for (let i = 0; i < S1.length; i++) {
    const nums = [...K.slice(4 * i, 4 * i + 4)].map(ch => byId.get(pool[parseInt(ch, 32)]).number);
    if (keyOf(nums) === keyOf(d.nums)) { d.siteScore = S1[i]; break; }
  }
}
const all = out.concat(top);
fs.writeFileSync(__dirname + '/decks.json', JSON.stringify(all, null, 1));
console.log('named', out.map(d => d.label + ' site=' + d.siteScore + ' rank=' + d.rank).join(' | '));
console.log('top owned taken', taken, 'unique added', top.length, 'total decks', all.length, 'last top s1', top[top.length - 1].siteScore);
