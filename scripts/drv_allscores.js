(()=>{const ids=IDS;const res={};
for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++)for(let c=b+1;c<ids.length;c++)for(let d=c+1;d<ids.length;d++){
  const k=[ids[a],ids[b],ids[c],ids[d]];const r=bt.evaluate(k.map(id=>({id,talentId:null})),{optimize:false,suggestions:false,shop:false});
  res[k.join(',')]=[Math.round(r.score),r.ttk];}
OUT.scores=res;})();
