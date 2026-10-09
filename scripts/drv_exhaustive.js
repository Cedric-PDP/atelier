(()=>{
const t0=Date.now();const ids=IDS;const res=[];
for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++)for(let c=b+1;c<ids.length;c++)for(let d=c+1;d<ids.length;d++){
  const sel=[ids[a],ids[b],ids[c],ids[d]].map(id=>({id,talentId:null}));
  const r=bt.evaluate(sel,{optimize:false,suggestions:false,shop:false});
  res.push({ids:[ids[a],ids[b],ids[c],ids[d]],score:r.score??r.result?.score??null,keys:res.length?undefined:Object.keys(r)});
}
OUT.ms=Date.now()-t0;OUT.n=res.length;OUT.sampleKeys=res[0].keys;
res.sort((x,y)=>(y.score??0)-(x.score??0));OUT.top=res.slice(0,40);
})();
