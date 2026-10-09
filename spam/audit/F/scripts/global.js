// Proxy 1: engine-optimal decks over the FULL 127-card pool (complete collection).
// Search = exhaustive triples (quick score) -> top 5000 triples -> every 4th card -> quads ranked by quick score
// -> top 4000 rescored with the full 18-matchup score X -> (talents) top 1500 re-optimised with Te, like the wiki's bestDecks.
const {runAll,W}=require('./lib.js');const fs=require('fs');
const MODES=['best-one','none'];const NCH=5;
const keyOf=a=>a.slice(0,4).slice().sort((x,y)=>x-y).join(',');
(async()=>{
 const T0=Date.now();
 // 1. triples
 let jobs=[];for(const mode of MODES)for(let c=0;c<NCH;c++)jobs.push({name:`tri_${mode}_${c}`,P:{task:'triples',mode,chunk:c,nch:NCH,keep:6000}});
 // random completeness sample (quick score) in the same batch
 for(const mode of MODES)jobs.push({name:`rnd_${mode}`,P:{task:'random',mode,seed:mode==='none'?777:4242,count:40000}});
 let r=await runAll(jobs,6);
 const tri={},rnd={};
 for(const mode of MODES){tri[mode]=r.filter(x=>x.P.task==='triples'&&x.P.mode===mode).flatMap(x=>x.res).sort((a,b)=>b[3]-a[3]).slice(0,5000);
   rnd[mode]=r.find(x=>x.P.task==='random'&&x.P.mode===mode).res;}
 console.log('triples done',((Date.now()-T0)/1000).toFixed(0)+'s', MODES.map(m=>m+': top '+tri[m][0][3].toFixed(0)+' / 5000th '+tri[m][4999][3].toFixed(0)).join(' | '));
 // 2. quads
 jobs=[];for(const mode of MODES)for(let c=0;c<NCH;c++){const part=tri[mode].filter((_,i)=>i%NCH===c).map(t=>t.slice(0,3));jobs.push({name:`quad_${mode}_${c}`,P:{task:'quads',mode,data:part,keep:30000}});}
 r=await runAll(jobs,6);
 const quads={};
 for(const mode of MODES){const mp=new Map();for(const x of r.filter(x=>x.P.mode===mode))for(const qd of x.res){const k=keyOf(qd);if(!mp.has(k))mp.set(k,qd)}
   quads[mode]=[...mp.values()].sort((a,b)=>b[4]-a[4]);}
 console.log('quads done',((Date.now()-T0)/1000).toFixed(0)+'s',MODES.map(m=>m+': '+quads[m].length+' kept, top '+quads[m][0][4].toFixed(0)+' / 4000th '+quads[m][3999][4].toFixed(0)).join(' | '));
 // completeness check: random quads whose quick score beats the 4000th beam quad but are missing from the beam list
 const check={};for(const mode of MODES){const thr=quads[mode][3999][4];const keys=new Set(quads[mode].map(keyOf));const above=rnd[mode].filter(x=>x[4]>=thr);check[mode]={threshold:thr,randomAbove:above.length,missing:above.filter(x=>!keys.has(keyOf(x))).map(x=>x),randomMax:Math.max(...rnd[mode].map(x=>x[4])),randomMean:rnd[mode].reduce((s,x)=>s+x[4],0)/rnd[mode].length};}
 console.log('check',JSON.stringify(check).slice(0,800));
 // 3. X rescoring of the top 4000 by quick score
 jobs=[];for(const mode of MODES){const top=quads[mode].slice(0,4000);for(let c=0;c<4;c++)jobs.push({name:`X_${mode}_${c}`,P:{task:'X',mode,data:top.filter((_,i)=>i%4===c)}});}
 r=await runAll(jobs,6);
 const xs={};for(const mode of MODES){xs[mode]=r.filter(x=>x.P.mode===mode).flatMap(x=>x.res).sort((a,b)=>b[4]-a[4]);}
 console.log('X done',((Date.now()-T0)/1000).toFixed(0)+'s');
 // 4. Te (talent optimisation) for the top 1500 by X, talents mode only
 jobs=[];{const top=xs['best-one'].slice(0,1500);for(let c=0;c<6;c++)jobs.push({name:`Te_${c}`,P:{task:'Te',mode:'best-one',data:top.filter((_,i)=>i%6===c)}});}
 r=await runAll(jobs,6);
 const te=r.flatMap(x=>x.res).sort((a,b)=>b[4]-a[4]);
 console.log('Te done',((Date.now()-T0)/1000).toFixed(0)+'s');
 fs.writeFileSync(W+'/global_results.json',JSON.stringify({quickTop:{'best-one':quads['best-one'].slice(0,20000),'none':quads['none'].slice(0,20000)},X:xs,Te:te,check,triTop:{'best-one':tri['best-one'].slice(0,200),'none':tri['none'].slice(0,200)}}));
 console.log('ALL DONE',((Date.now()-T0)/1000).toFixed(0)+'s');
})().catch(e=>{console.error(e);process.exit(1)});
