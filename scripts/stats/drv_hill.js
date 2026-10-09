(()=>{
// 1-card-swap steepest-ascent local search (full no-talent score via Te) from the wide-beam top 5.
const STARTS=[["1d3d896d-c640-4d88-a1af-059f39546c60","40416045-b820-4d2c-96f9-34f87d99ac25","cd9beb57-00f1-412e-9c75-981ffdd56a38","d27faf84-0a03-4c16-b744-c555cd6f1edc"],["1d3d896d-c640-4d88-a1af-059f39546c60","40416045-b820-4d2c-96f9-34f87d99ac25","3c38bd35-20d2-4369-971c-9216d21da76a","d27faf84-0a03-4c16-b744-c555cd6f1edc"],["1d3d896d-c640-4d88-a1af-059f39546c60","40416045-b820-4d2c-96f9-34f87d99ac25","d27faf84-0a03-4c16-b744-c555cd6f1edc","b42ca72a-df32-43af-b23d-5256525d1665"],["1d3d896d-c640-4d88-a1af-059f39546c60","40416045-b820-4d2c-96f9-34f87d99ac25","d27faf84-0a03-4c16-b744-c555cd6f1edc","059b42d0-2de6-46b1-baab-fc61f0bb2ac3"],["1d3d896d-c640-4d88-a1af-059f39546c60","40416045-b820-4d2c-96f9-34f87d99ac25","d27faf84-0a03-4c16-b744-c555cd6f1edc","9e974935-3da9-4acf-9507-a79cbd80bfb2"]];
const cards=MODELS.x1.cards; const byId=new Map(cards.map(c=>[c.id,c]));
const cache=new Map(); let evals=0;
const score=ids=>{const k=[...ids].sort().join(',');if(cache.has(k))return cache.get(k);evals++;const s=Te(ids.map(id=>byId.get(id)),{talentMode:'none'}).score;cache.set(k,s);return s};
const t0=Date.now(); const runs=[];
for(const start of STARTS){
  let cur=[...start], cs=score(cur), steps=0, path=[cs];
  for(;;){
    let best=null;
    for(let i=0;i<4;i++)for(const c of cards){if(cur.includes(c.id))continue;const cand=cur.map((x,j)=>j===i?c.id:x);const s=score(cand);if(s>cs+1e-9&&(!best||s>best.s))best={ids:cand,s}}
    if(!best)break; cur=best.ids; cs=best.s; steps++; path.push(cs);
  }
  runs.push({start,startScore:path[0],end:cur,endNums:cur.map(id=>byId.get(id).number),endScore:cs,steps,path});
}
const top=[...cache.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,s])=>({ids:k.split(','),nums:k.split(',').map(id=>byId.get(id).number),score:s}));
OUT.ms=Date.now()-t0; OUT.evals=evals; OUT.runs=runs; OUT.top=top;
})();
