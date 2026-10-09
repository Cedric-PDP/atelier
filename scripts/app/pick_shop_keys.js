// Picks the decks that get a shop analysis (spam/app/shop_keys.json) from the exhaustive pre_*.json results:
// top 1200 owned decks by score, top 500 owned by no-crit score, top 400 overall (wishlist cards included).
// Usage: node scripts/app/pick_shop_keys.js <repoRoot>/spam   — NOWN = number of owned cards at the head of pool_order.json.
const fs=require('fs');const NOWN=26;const rows=[];for(let i=0;i<6;i++){const o=require(process.argv[2]+'/app/pre_'+i+'.json').res;o.k.forEach((k,j)=>rows.push({k,s1:o.s1[j],s0:o.s0[j]}))}
const idx=k=>k.split('').map(c=>parseInt(c,32));const owned=r=>idx(r.k).every(i=>i<NOWN);const pick=new Set();const add=(arr,n)=>arr.slice(0,n).forEach(r=>pick.add(r.k));
const own=rows.filter(owned);add(own.slice().sort((a,b)=>b.s1-a.s1),1200);add(own.slice().sort((a,b)=>b.s0-a.s0),500);add(rows.slice().sort((a,b)=>b.s1-a.s1),400);
const keys=[...pick];fs.writeFileSync(process.argv[2]+'/app/shop_keys.json',JSON.stringify(keys));console.log('shop decks',keys.length);
