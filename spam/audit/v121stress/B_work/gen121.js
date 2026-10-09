// Builds the 1.21 drivers: node gen121.js <template> <out.js> <MODE>
// Embeds: our decks (18 named + top 40 owned, deduped), a dozen varied meta decks, Tisseuse/Fleur ids.
const fs = require('fs');
const path = require('path');
const [tpl, out, mode] = process.argv.slice(2);
const SP = path.resolve(__dirname, '../../../..');
const model = JSON.parse(fs.readFileSync(path.join(SP, 'spam/v121/model.json'), 'utf8'));
const byNum = {}; for (const c of model.cards) byNum[c.number] = c;
const named = JSON.parse(fs.readFileSync(path.join(SP, 'spam/audit/v121check/decks.json'), 'utf8')).DECKS;
const top = JSON.parse(fs.readFileSync(path.join(SP, 'spam/audit/v121check/top_owned_121.json'), 'utf8')).slice(0, 40);
const keyOf = nums => nums.slice().sort((a, b) => a - b).join('-');
const OUR = []; const seen = new Map();
for (const [label, nums] of Object.entries(named)) { const k = keyOf(nums); seen.set(k, OUR.length); OUR.push({ key: k, label, named: true, nums, ids: nums.map(n => byNum[n].id) }); }
top.forEach((t, i) => {
  const k = keyOf(t.nums); const lab = 'top' + String(i + 1).padStart(2, '0');
  if (seen.has(k)) { OUR[seen.get(k)].topRank = i + 1; return; }
  seen.set(k, OUR.length); OUR.push({ key: k, label: lab, named: false, topRank: i + 1, nums: t.nums, ids: t.nums.map(n => byNum[n].id) });
});
// a dozen varied meta decks: 11 from the wiki 1.21 tier list (index = position in that list) + F's best no-talent engine deck
const metaList = JSON.parse(fs.readFileSync('C:/Users/cperouseduperrier/perso/spam-atelier/spam/versions/1.21/meta_decks.json', 'utf8')).decks;
const pick = [[44,136,188,231],[127,136,231,263],[177,197,231,236],[69,136,156,229],[69,97,117,236],[4,17,85,188],[3,45,106,180],[2,178,226,260],[72,174,206,262],[122,174,195,211],[36,96,188,227]];
const META = pick.map(nums => { const idx = metaList.findIndex(d => keyOf(d) === keyOf(nums)); if (idx < 0) throw new Error('not in tier list ' + nums); return { key: keyOf(nums), src: 'tier121#' + (idx + 1), nums, ids: nums.map(n => byNum[n].id), names: nums.map(n => byNum[n].name) }; });
META.push({ key: keyOf([136,142,231,263]), src: 'F_meta.topDecks.P1_N#1', nums: [136,142,231,263], ids: [136,142,231,263].map(n => byNum[n].id), names: [136,142,231,263].map(n => byNum[n].name) });
const IDS = { tisseuse: byNum[123].id, fleur: byNum[222].id };
let s = fs.readFileSync(tpl, 'utf8')
  .replace('__MODE__', JSON.stringify(mode))
  .replace('__OUR__', JSON.stringify(OUR))
  .replace('__META__', JSON.stringify(META))
  .replace('__IDS__', JSON.stringify(IDS));
fs.writeFileSync(out, s);
console.log('our decks', OUR.length, '(named', OUR.filter(d => d.named).length + ')', 'meta', META.length, 'mode', mode);
