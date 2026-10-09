// Writes the vm drivers that score the FIXED global sample (spam/stats/global_decks.json: 24,000 random 4-card decks,
// seed 20261009, cards as uuids) with a version's engine. The sample never changes between versions, so the
// changelog can compare the same decks before/after a patch (card impact). Cards missing from a model are skipped.
// x1 for every deck, x0 (no crit) for decks #0..nx0-1, like scripts/stats/gen_global.js did for 1.20.
// Output rows per chunk: OUT.rows = [[deckIndex, s1, ttk, s0|null], ...]
// Usage: node scripts/app/gen_global_drivers.js <global_decks.json> <drvDir> <chunks>
const fs=require('fs'),path=require('path');
const [sampleFile,drvDir,nch]=process.argv.slice(2);if(!nch)throw new Error('usage: gen_global_drivers.js <global_decks.json> <drvDir> <chunks>');
const g=JSON.parse(fs.readFileSync(sampleFile,'utf8'));const N=g.decks.length,NC=+nch;fs.mkdirSync(drvDir,{recursive:true});
for(let c=0;c<NC;c++){
  const part=[];for(let i=c;i<N;i+=NC)part.push([i,...g.decks[i]]);
  const src=`(()=>{const IDS=${JSON.stringify(g.ids)};const D=${JSON.stringify(part)};const NX0=${g.nx0};
const I1=ht(MODELS.x1),I0=ht(MODELS.x0);const o={optimize:false,suggestions:false,shop:false};const have=new Set(MODELS.x1.cards.map(c=>c.id));
const rows=[];const t0=Date.now();let n=0,skipped=0;
for(const [k,...q] of D){const ids=q.map(j=>IDS[j]);if(!ids.every(id=>have.has(id))){skipped++;continue}
 const sel=ids.map(id=>({id,talentId:null}));const a=I1.evaluate(sel,o);n++;
 let s0=null;if(k<NX0){const b=I0.evaluate(sel,o);s0=Math.round(b.score*100)/100;n++}
 rows.push([k,Math.round(a.score*100)/100,a.ttk,s0]);}
OUT.chunk=${c};OUT.ms=Date.now()-t0;OUT.evals=n;OUT.skipped=skipped;OUT.rows=rows;})();`;
  fs.writeFileSync(path.join(drvDir,`drv_g_${c}.js`),src);
}
console.log('global sample',N,'decks,',NC,'drivers in',drvDir);
