// Proxy 1x2: sample player collections by rarity ownership rates, then run the wiki's own
// "best decks for my collection" (bestDecks) on each — what a workshop user would be told to play.
const {runAll,W,MODEL}=require('./lib.js');const fs=require('fs');
const m=JSON.parse(fs.readFileSync(MODEL,'utf8'));
// Ownership rates. U = anchored on the user's own 26-card collection (19/66 commons incl. the 6 Esprit starters,
// 6/30 rares, 1/18 epics, 0/12 legendaries, 0/1 divine). V = "veteran" sensitivity scenario (assumed, x2-3).
const SCEN={
 U:{starter:1,common:13/60,rare:6/30,epic:1/18,legendary:0.5/13,divine:0.5/13,n:120,seed:101},
 V:{starter:1,common:0.6,rare:0.5,epic:0.25,legendary:0.15,divine:0.15,n:40,seed:202},
};
const mulberry=(function(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}});let rnd;
const cols={};
for(const [k,sc] of Object.entries(SCEN)){rnd=mulberry(sc.seed);cols[k]=[];
  for(let pid=0;pid<sc.n;pid++){const cards=[];m.cards.forEach((c,i)=>{const p=(c.number<=6)?sc.starter:sc[c.rarity];if(rnd()<p)cards.push(i)});
    if(cards.length<4){pid--;continue}cols[k].push({pid,cards});}}
fs.writeFileSync(W+'/collections.json',JSON.stringify({SCEN,cols}));
for(const k in cols){const sz=cols[k].map(c=>c.cards.length);console.log(k,'n',sz.length,'mean size',(sz.reduce((a,b)=>a+b,0)/sz.length).toFixed(1),'min',Math.min(...sz),'max',Math.max(...sz));}
if(process.argv[2]!=='run')process.exit(0);
(async()=>{const T0=Date.now();const jobs=[];
 // split: U in 6 chunks of 20, V in 12 chunks of 5 (bigger collections are slower)
 for(let c=0;c<6;c++)jobs.push({name:`colU_${c}`,P:{task:'collections',mode:'best-one',data:cols.U.filter((_,i)=>i%6===c)}});
 for(let c=0;c<8;c++)jobs.push({name:`colV_${c}`,P:{task:'collections',mode:'best-one',data:cols.V.filter((_,i)=>i%8===c)}});
 jobs.sort((a,b)=>(a.name<b.name?1:-1)); // V first (longer)
 // proper-RNG completeness check of the global beam (quick score), appended last
 for(const mode of ['best-one','none'])jobs.push({name:`rnd2_${mode}`,P:{task:'random',mode,seed:mode==='none'?777:4242,count:40000}});
 const r=await runAll(jobs,6);
 const out={U:[],V:[]};for(const x of r){const sc=x.P?null:null;}
 for(let i=0;i<jobs.length;i++){if(!jobs[i].name.startsWith('col'))continue;const sc=jobs[i].name[3];out[sc].push(...r[i].res);}
 for(const k in out)out[k].sort((a,b)=>a.pid-b.pid);
 fs.writeFileSync(W+'/collections_results.json',JSON.stringify(out));
 console.log('ALL DONE',((Date.now()-T0)/1000).toFixed(0)+'s');
})().catch(e=>{console.error(e);process.exit(1)});
