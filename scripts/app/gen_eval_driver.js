// Writes a vm driver that scores a list of decks given as CARD NUMBERS (stable across versions, unlike pool indexes),
// with x1 (normal) and x0 (no crit), no talent, no shop. Used by the changelog for the meta decks and saved decks.
// Output: OUT.rows = [{d:[numbers], s1, s0, ttk, tier, adv} | {d, missing:[numbers]}]
// Usage: node scripts/app/gen_eval_driver.js <decks.json: [[n,n,n,n],...]> <out drv.js>
const fs=require('fs');const [inp,out]=process.argv.slice(2);if(!out)throw new Error('usage: gen_eval_driver.js <decks.json> <drv.js>');
const decks=JSON.parse(fs.readFileSync(inp,'utf8'));
fs.writeFileSync(out,`(()=>{const DECKS=${JSON.stringify(decks)};const byN={};for(const c of MODELS.x1.cards)byN[c.number]=c.id;
const I1=ht(MODELS.x1),I0=ht(MODELS.x0);const o={optimize:false,suggestions:false,shop:false};const R=x=>Math.round(x*10)/10;
OUT.rows=DECKS.map(d=>{const miss=d.filter(n=>!byN[n]);if(miss.length)return {d,missing:miss};const sel=d.map(n=>({id:byN[n],talentId:null}));
 const a=I1.evaluate(sel,o),b=I0.evaluate(sel,o);return {d,s1:R(a.score),s0:R(b.score),ttk:a.ttk,tier:a.tier,adv:R(a.advantage)}});})();`);
console.log('eval driver',decks.length,'decks ->',out);
