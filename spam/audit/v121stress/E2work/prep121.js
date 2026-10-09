// decks121.json: the 18 named decks (v121check/decks.json, positions as given) + the 300 top owned v1.21 decks
// (v121check/top_owned_121.json: nums, s1, s0), de-duplicated by card set.
const fs = require('fs'), path = require('path');
const A = path.join(__dirname, '..', '..');            // SP/spam/audit
const V121 = path.join(A, '..', 'v121');
const model = JSON.parse(fs.readFileSync(path.join(V121, 'model.json'), 'utf8'));
const byNum = new Map(model.cards.map(c => [c.number, c]));
const named = JSON.parse(fs.readFileSync(path.join(A, 'v121check', 'decks.json'), 'utf8'));
const top = JSON.parse(fs.readFileSync(path.join(A, 'v121check', 'top_owned_121.json'), 'utf8'));
const chk = JSON.parse(fs.readFileSync(path.join(A, 'v121check', 'check121.json'), 'utf8')).res;
const key = nums => nums.slice().sort((a, b) => a - b).join('-');
const out = [], seen = new Map();
for (const [name, nums] of Object.entries(named.DECKS)) {
  const c = chk[name] || {};
  const rec = { key: key(nums), name, nums, ids: nums.map(n => byNum.get(n).id), names: nums.map(n => byNum.get(n).name),
    s1: c.s1 ?? null, s0: c.s0 ?? null, L: c.L ?? null, x15: c['x1.5'] ?? null, x2: c.x2 ?? null, topRank: null };
  out.push(rec); seen.set(rec.key, rec);
}
top.forEach((t, i) => {
  const k = key(t.nums);
  if (seen.has(k)) { const r = seen.get(k); r.topRank = i + 1; r.s1top = t.s1; r.s0top = t.s0; return; }
  const rec = { key: k, name: null, nums: t.nums, ids: t.nums.map(n => byNum.get(n).id), names: t.nums.map(n => byNum.get(n).name), s1: t.s1, s0: t.s0, topRank: i + 1 };
  out.push(rec); seen.set(k, rec);
});
fs.writeFileSync(path.join(__dirname, 'decks121.json'), JSON.stringify(out));
console.log('named', Object.keys(named.DECKS).length, 'top', top.length, 'unique decks', out.length, 'named in top300', out.filter(d => d.name && d.topRank).map(d => d.name + '#' + d.topRank).join(' '));
