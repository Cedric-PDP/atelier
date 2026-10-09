// Extracts the decks of the wiki deck tier list (the « méta » players see and copy) from a saved tiers page:
// every /decks/<n>-<n>-<n>-<n>/ link, card numbers, in order of first appearance (= the page's ranking).
// Usage: node scripts/app/extract_meta_decks.js <tiers.html> <out meta_decks.json> [source label]
const fs=require('fs');const [html,out,label]=process.argv.slice(2);if(!out)throw new Error('usage: extract_meta_decks.js <tiers.html> <out.json> [label]');
const h=fs.readFileSync(html,'utf8');const seen=new Set(),decks=[];
for(const m of h.matchAll(/\/decks\/(\d+)-(\d+)-(\d+)-(\d+)\//g)){const d=m.slice(1,5).map(Number).sort((a,b)=>a-b),k=d.join('-');if(!seen.has(k)){seen.add(k);decks.push(d)}}
if(!decks.length)throw new Error('no /decks/<a-b-c-d>/ link in '+html);
const ver=(h.match(/v(\d+\.\d+)/)||[])[1]||null;
fs.writeFileSync(out,JSON.stringify({source:label||'spamgame-wiki.com/fr/tiers/',pageVersion:ver,decks},null,1));
console.log('meta decks',decks.length,'page version',ver);
