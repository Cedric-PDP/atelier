// Picks the decks that get a shop analysis (shop_keys.json) from the exhaustive pre_*.json results:
// top 1200 owned decks by score, top 500 owned by no-crit score, top 400 overall (wishlist cards included).
// Usage: node scripts/app/pick_shop_keys.js <repoRoot>/spam [--app=<dir with pre_*.json>]   (default app dir: spam/app)
// NOWN = number of owned cards at the head of pool_order.json.
const fs=require('fs'),path=require('path');const NOWN=26;
const app=(process.argv.slice(3).find(a=>a.startsWith('--app='))||'').slice(6)||path.join(process.argv[2],'app');
const files=fs.readdirSync(app).filter(f=>/^pre_\d+\.json$/.test(f)).sort((a,b)=>parseInt(a.slice(4))-parseInt(b.slice(4)));if(!files.length)throw new Error('no pre_*.json in '+app);
const rows=[];for(const f of files){const o=JSON.parse(fs.readFileSync(path.join(app,f),'utf8')).res;o.k.forEach((k,j)=>rows.push({k,s1:o.s1[j],s0:o.s0[j]}))}
const idx=k=>k.split('').map(c=>parseInt(c,32));const owned=r=>idx(r.k).every(i=>i<NOWN);const pick=new Set();const add=(arr,n)=>arr.slice(0,n).forEach(r=>pick.add(r.k));
const own=rows.filter(owned);add(own.slice().sort((a,b)=>b.s1-a.s1),1200);add(own.slice().sort((a,b)=>b.s0-a.s0),500);add(rows.slice().sort((a,b)=>b.s1-a.s1),400);
const keys=[...pick];fs.writeFileSync(path.join(app,'shop_keys.json'),JSON.stringify(keys));console.log('shop decks',keys.length,'from',files.length,'pre files');
