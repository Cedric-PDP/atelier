// usage: node diffmodel.js <old model.json> <new model.json> [owned numbers csv]
const fs=require('fs');const [,,fa,fb,own]=process.argv;
const A=JSON.parse(fs.readFileSync(fa,'utf8')),B=JSON.parse(fs.readFileSync(fb,'utf8'));
const owned=new Set((own||'').split(',').filter(Boolean).map(Number));
const ab=c=>(c.abilities||[]).map(a=>`${a.name}[cd${a.cd}${a.uses?' u'+a.uses:''}${a.echo?' e'+a.echo:''}${a.duration?' d'+a.duration:''}${a.costHp?' hp'+a.costHp:''}${a.cost?' c'+JSON.stringify(a.cost):''}] `+(a.options||[]).map(o=>o.target+':'+o.text).join(' / ')).join(' || ');
const pa=c=>(c.passives||[]).map(p=>p.id).join(',');
const ta=c=>(c.talents||[]).map(t=>t&&(t.name||t.id)).join(',');
const byId=new Map(A.cards.map(c=>[c.number,c]));
for(const b of B.cards){const a=byId.get(b.number);if(!a){console.log('NEW',b.number,b.name);continue}
const d=[];for(const k of ['hp','spamton','rows','rarity','element'])if(JSON.stringify(a[k])!==JSON.stringify(b[k]))d.push(`${k}: ${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])}`);
if(JSON.stringify(a.res)!==JSON.stringify(b.res))d.push(`res: ${JSON.stringify(a.res)} -> ${JSON.stringify(b.res)}`);
if(ab(a)!==ab(b))d.push(`abilities:\n      OLD ${ab(a)}\n      NEW ${ab(b)}`);
if(pa(a)!==pa(b))d.push(`passives: ${pa(a)} -> ${pa(b)}`);
if(ta(a)!==ta(b))d.push(`talents: ${ta(a)} -> ${ta(b)}`);
if(d.length)console.log(`${owned.has(b.number)?'[OWNED] ':''}#${b.number} ${b.name}\n    `+d.join('\n    '));}
