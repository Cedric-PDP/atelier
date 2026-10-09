// Shared helpers: build engine drivers with embedded data, run them in parallel (<= 6 node processes).
const fs=require('fs'),path=require('path'),cp=require('child_process');
const SP=require('path').resolve(__dirname,'../../../..'); // repo root
const W=SP+'/spam/audit/F';
const ENGINE=SP+'/spam/js/simulation.js', MODEL=SP+'/spam/js/model.json', RUNNER=SP+'/scripts/sim_lab2.js';
// Body evaluated inside the engine vm. Engine bindings used: q (one sim vs one opponent), J (score), ct (talent mode filter), X (18-sim score), Te (talent optimisation), ht (public API).
const BODY=`
const M=MODELS.x1;
const ROWS=M.cards.map(c=>({card:c,talent:M.recommended[c.id]??null}));
const quick=(idx)=>J(q(ct(idx.map(i=>ROWS[i]),P.mode),{talentMode:P.mode}));
const key=(idx)=>idx.map(i=>ROWS[i].card.number).sort((a,b)=>a-b).join('-');
const topK=(arr,k)=>{arr.sort((a,b)=>b[b.length-1]-a[a.length-1]);return arr.slice(0,k)};
const t0=Date.now();let res=[];
if(P.task==='triples'){ // all C(n,3) triples, this chunk = every NCH-th
  const n=ROWS.length;let c=0;
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)for(let k=j+1;k<n;k++){ if((c++)%P.nch!==P.chunk)continue; res.push([i,j,k,quick([i,j,k])]); if(res.length>4*P.keep){res=topK(res,P.keep)} }
  res=topK(res,P.keep);
}else if(P.task==='quads'){ // expand given triples by every 4th card
  const seen=new Set();const n=ROWS.length;
  for(const t of P.data){ for(let l=0;l<n;l++){ if(t.includes(l))continue; const qd=[...t.slice(0,3),l]; const k=key(qd); if(seen.has(k))continue; seen.add(k); res.push([...qd.sort((a,b)=>a-b),quick(qd)]); if(res.length>4*P.keep){res=topK(res,P.keep)} } }
  res=topK(res,P.keep); OUT.distinct=seen.size;
}else if(P.task==='random'){ // random quads, quick score
  const rnd=(function(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}})(P.seed);const n=ROWS.length;
  for(let r=0;r<P.count;r++){const st=new Set();while(st.size<4)st.add(Math.floor(rnd()*n));const qd=[...st].sort((a,b)=>a-b);res.push([...qd,quick(qd)])}
}else if(P.task==='X'){ // full 18-matchup score, talents per mode (recommended or none)
  for(const qd of P.data){ const sel=qd.slice(0,4).map(i=>({card:ROWS[i].card,talent:P.mode==='none'?null:ROWS[i].talent})); const r=X(sel,{}); res.push([...qd.slice(0,4),r.score,r.result.ttk]); }
}else if(P.task==='Te'){ // talent optimisation (best single talent per card), as the wiki's bestDecks re-ranking
  for(const qd of P.data){ const cards=qd.slice(0,4).map(i=>ROWS[i].card); const r=Te(cards,{talentMode:'best-one'}); res.push([...qd.slice(0,4),r.score,r.result.ttk,r.talents]); }
}else if(P.task==='collections'){ // the wiki's own "best decks for my collection" (bestDecks) on sampled collections
  const I=ht(M);
  for(const col of P.data){ const ids=col.cards.map(i=>ROWS[i].card.id); let b; try{b=I.bestDecks(ids)}catch(e){res.push({pid:col.pid,err:String(e)});continue}
    const pack=l=>l.map(d=>({n:d.cards.map(c=>M.cards.find(x=>x.id===c.id).number),t:d.cards.map(c=>c.talentId),s:Math.round(d.score)}));
    res.push({pid:col.pid,size:ids.length,wt:pack(b.withTalents),nt:pack(b.noTalent)}); }
}
OUT.res=res;OUT.ms=Date.now()-t0;OUT.P={task:P.task,mode:P.mode,chunk:P.chunk,nch:P.nch};
`;
function writeDriver(file,P){fs.writeFileSync(file,'(()=>{const P='+JSON.stringify(P)+';'+BODY+'})();');}
function runOne(drv,out){return new Promise((res,rej)=>{const p=cp.spawn(process.execPath,[RUNNER,ENGINE,'x1='+MODEL,drv,out],{stdio:['ignore','pipe','pipe']});let err='';p.stderr.on('data',d=>err+=d);p.on('close',code=>code===0?res(JSON.parse(fs.readFileSync(out,'utf8'))):rej(new Error(drv+' exit '+code+' '+err.slice(0,500))));});}
async function runAll(jobs,conc=6){ // jobs: [{P, name}]
  const dir=W+'/runs';fs.mkdirSync(dir,{recursive:true});const results=new Array(jobs.length);let next=0;
  const worker=async()=>{while(next<jobs.length){const k=next++;const j=jobs[k];const drv=dir+'/'+j.name+'.drv.js',out=dir+'/'+j.name+'.out.json';
    if(fs.existsSync(out)&&!j.force){results[k]=JSON.parse(fs.readFileSync(out,'utf8'));continue}
    writeDriver(drv,j.P);const t=Date.now();results[k]=await runOne(drv,out);console.log(new Date().toISOString().slice(11,19),'done',j.name,((Date.now()-t)/1000).toFixed(1)+'s');}};
  await Promise.all(Array.from({length:Math.min(conc,jobs.length)},worker));return results;}
module.exports={SP,W,writeDriver,runAll,MODEL};
