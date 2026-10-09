// decks121.json = 18 named decks (v121check/decks.json) + 300 top owned decks (v121check/top_owned_121.json), deduped.
const fs = require('fs'), path = require('path');
const SP = path.resolve(__dirname, '../../../..');
const model = JSON.parse(fs.readFileSync(SP + '/spam/v121/model.json', 'utf8'));
const byNum = new Map(model.cards.map(c => [c.number, c]));
const named = JSON.parse(fs.readFileSync(SP + '/spam/audit/v121check/decks.json', 'utf8')).DECKS;
const top = JSON.parse(fs.readFileSync(SP + '/spam/audit/v121check/top_owned_121.json', 'utf8'));
const key = nums => nums.slice().sort((a, b) => a - b).join('-');
const out = [], byKey = new Map();
for (const [name, nums] of Object.entries(named)) {
  const d = { name, nums, ids: nums.map(n => byNum.get(n).id), topRank: null, s1: null, s0: null };
  out.push(d); byKey.set(key(nums), d);
}
top.forEach((t, i) => {
  const k = key(t.nums);
  if (byKey.has(k)) { const d = byKey.get(k); d.topRank = i + 1; d.s1 = t.s1; d.s0 = t.s0; return; }
  const d = { name: null, nums: t.nums, ids: t.nums.map(n => byNum.get(n).id), topRank: i + 1, s1: t.s1, s0: t.s0 };
  out.push(d); byKey.set(k, d);
});
fs.writeFileSync(__dirname + '/decks121.json', JSON.stringify(out));
console.log('named', Object.keys(named).length, 'top', top.length, 'unique decks', out.length,
  'named in top:', out.filter(d => d.name && d.topRank).map(d => d.name + '#' + d.topRank).join(' '));
