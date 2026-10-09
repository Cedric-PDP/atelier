// Generates 24,000 uniformly random 4-card decks (distinct cards, 127-card catalogue, seeded)
// and writes 6 vm drivers (balanced: x1 for all decks, x0 for decks #0..5999).
const fs=require('fs'),path=require('path');
const [modelFile,outDir,drvDir]=process.argv.slice(2);
const model=JSON.parse(fs.readFileSync(modelFile,'utf8'));
const ids=model.cards.map(c=>c.id);
const SEED=20261009, N=24000, NX0=6000, NC=127;
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const rng=mulberry32(SEED);
const decks=[];
for(let i=0;i<N;i++){const s=new Set();while(s.size<4)s.add(Math.floor(rng()*NC));decks.push([...s].sort((a,b)=>a-b))}
const keys=new Set(decks.map(d=>d.join(',')));
fs.writeFileSync(path.join(outDir,'global_decks.json'),JSON.stringify({seed:SEED,rng:'mulberry32',n:N,nx0:NX0,distinct:keys.size,ids,decks}));
// chunks: [from,to) deck ranges, ~5,000 evaluations each
const chunks=[[0,2500],[2500,5000],[5000,9000],[9000,14000],[14000,19000],[19000,24000]];
chunks.forEach(([a,b],c)=>{
  const part=[];for(let i=a;i<b;i++)part.push([i,...decks[i]]);
  const src=`(()=>{const IDS=${JSON.stringify(ids)};const D=${JSON.stringify(part)};const NX0=${NX0};
const I1=ht(MODELS.x1),I0=ht(MODELS.x0);const o={optimize:false,suggestions:false,shop:false};
const rows=[];const t0=Date.now();let n=0;
for(const [k,...q] of D){const sel=q.map(j=>({id:IDS[j],talentId:null}));const a=I1.evaluate(sel,o);n++;
 let s0=null;if(k<NX0){const b=I0.evaluate(sel,o);s0=Math.round(b.score*100)/100;n++}
 rows.push([k,Math.round(a.score*100)/100,a.ttk,s0]);
 if(rows.length%500===0)console.log('chunk ${c}',rows.length,'/',D.length,'evals',n,'ms',Date.now()-t0);}
OUT.chunk=${c};OUT.ms=Date.now()-t0;OUT.evals=n;OUT.rows=rows;})();`;
  fs.writeFileSync(path.join(drvDir,`drv_g_${c}.js`),src);
});
console.log('decks',N,'distinct',keys.size,'chunks',chunks.length);
