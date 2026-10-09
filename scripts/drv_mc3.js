(()=>{
const DECKS={"A":["f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","6598bdc6-b5f4-47a8-be11-761422965f71","3c5cc4d2-1692-4da7-81ae-eb853c91327f","5721ea5f-5978-4328-8874-28abc283f6b8"],"B":["def9a313-f174-4e62-b4b8-1086d28bd09e","6598bdc6-b5f4-47a8-be11-761422965f71","edfb6bd4-3ac4-420c-bb25-91c9005dea80","e030e28b-0ba3-4c9e-932b-d7c333cadf26"],"C":["def9a313-f174-4e62-b4b8-1086d28bd09e","6598bdc6-b5f4-47a8-be11-761422965f71","e030e28b-0ba3-4c9e-932b-d7c333cadf26","5721ea5f-5978-4328-8874-28abc283f6b8"],"D":["76ecb89a-1b3d-4683-b076-5ea3fc20f91a","def9a313-f174-4e62-b4b8-1086d28bd09e","6598bdc6-b5f4-47a8-be11-761422965f71","e030e28b-0ba3-4c9e-932b-d7c333cadf26"]};const TRIALS=300;
let seed=1;const rnd=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
const fam=id=>id.replace(/_[CREL]$/,'');const ALL=[].concat(n.common,n.rare,n.epic,n.legendary);
OUT.res={};
for(const [dk,ids] of Object.entries(DECKS)){
  const sel=ids.map(id=>({id,talentId:null}));
  const base=bt.evaluate(sel,{optimize:false,suggestions:false,shop:true});
  const y=base.score,tl=base.shop.timeline,plan=base.shop.plan;
  const rows={},repl={};base.shop.cards.forEach(c=>{repl[c.cardId]=c.lines.filter(l=>l.verdict==='remplacer').map(l=>l.id);rows[c.cardId]=c.lines.filter(l=>l.kind!=='free').length});
  const cache=new Map();
  const exact=lo=>{const k=JSON.stringify(lo);if(cache.has(k))return cache.get(k);let v=null;try{v=bt.evaluate(sel,{optimize:false,suggestions:false,shop:false,loadout:lo}).score}catch(e){}cache.set(k,v);return v};
  // single-Tox gain table from the empty state
  const G=[];
  for(const t of ALL)for(const id of ids){
    if(rows[id]<3){const v=exact([{cardId:id,added:[t],removed:[]}]);if(v!=null)G.push({t,card:id,rem:null,g:v-y})}
    for(const rm of repl[id]){const v=exact([{cardId:id,added:[t],removed:[rm]}]);if(v!=null)G.push({t,card:id,rem:rm,g:v-y})}}
  const good=G.filter(x=>x.g>=0.05*y);const famBest={};good.forEach(x=>{const f=fam(x.t);if(!famBest[f]||x.g>famBest[f].g)famBest[f]=x});
  const famList=Object.values(famBest).sort((a,b)=>b.g-a.g).map(x=>({fam:fam(x.t),bestRarity:x.t,card:x.card,rem:x.rem,pct:+(100*x.g/y).toFixed(1)}));
  const famRar={};G.forEach(x=>{const k=fam(x.t)+'|'+x.t.slice(-1);famRar[k]=Math.max(famRar[k]??-1e9,x.g)});
  const offer=odds=>{const got=[];let guard=0;while(got.length<3&&guard++<60){const tot=Object.values(odds).reduce((a,b)=>a+b,0);const u=rnd()*tot;let acc=0,rar="common";for(const k of ['common','rare','epic','legendary']){acc+=odds[k]||0;if(u<acc){rar=k;break}}const p=n[rar];const t=p[Math.floor(rnd()*p.length)];if(!got.includes(t))got.push(t)}return got};
  const planFam=new Set(plan.map(p=>fam(p.toxId)));const planIds=new Set(plan.map(p=>p.toxId));
  const pick=(pol,st,offered,budget)=>{let best=null;for(const x of G){if(!offered.includes(x.t)||st.bought.has(x.t)||r[x.t].cost>budget)continue;
      if(pol==='rigid'&&!plan.some(p=>p.toxId===x.t&&p.cardId===x.card&&(p.replacesId||null)===x.rem))continue;
      if(pol==='family'&&!plan.some(p=>fam(p.toxId)===fam(x.t)&&p.cardId===x.card&&(p.replacesId||null)===x.rem))continue;
      const used=rows[x.card]-st.rem[x.card].length+st.add[x.card].length;
      if(x.rem==null&&used>=3)continue;if(x.rem!=null&&st.rem[x.card].includes(x.rem))continue;
      if(x.g<(x.rem?0.03:0.01)*y)continue;if(!best||x.g>best.g)best=x}return best};
  OUT.res[dk]={base:Math.round(y),idealPct:base.shop.potentialPct,plan:plan.map(p=>p.toxId+'@T'+p.turn),famList,pol:{},
    hitGood:tl.map(op=>{let h=0;seed=99;for(let i=0;i<2000;i++){const o=offer(op.odds);if(o.some(t=>good.some(x=>x.t===t)))h++}return {turn:op.turn,pct:Math.round(h/20)}})};
  for(const pol of ['none','rigid','family','adaptive','adaptive_reroll']){
    seed=777;const finals=[];let nb=0;const buys={};
    for(let tr=0;tr<TRIALS;tr++){const st={bought:new Set(),add:{},rem:{}};ids.forEach(id=>{st.add[id]=[];st.rem[id]=[]});let spent=0,bonus=0,acc=y,prev=y;
      for(const op of tl){if(pol==='none'){bonus+=10;continue}let budget=op.spamton+bonus-spent;let offered=offer(op.odds);
        let p=pick(pol==='adaptive_reroll'?'adaptive':pol,st,offered,budget);
        if(!p&&pol==='adaptive_reroll'&&budget>=25){spent+=10;budget-=10;offered=offer(op.odds);p=pick('adaptive',st,offered,budget)}
        if(p){st.bought.add(p.t);st.add[p.card].push(p.t);if(p.rem)st.rem[p.card].push(p.rem);spent+=r[p.t].cost;nb++;{const lo2=ids.filter(id=>st.add[id].length||st.rem[id].length).map(id=>({cardId:id,added:st.add[id].slice().sort(),removed:st.rem[id].slice().sort()}));const cur=exact(lo2);if(cur!=null){acc+=(cur-prev)*Math.max(0,(11-op.turn)/10);prev=cur}}buys[fam(p.t)]=(buys[fam(p.t)]||0)+1}else bonus+=10}
      const lo=ids.filter(id=>st.add[id].length||st.rem[id].length).map(id=>({cardId:id,added:st.add[id].slice().sort(),removed:st.rem[id].slice().sort()}));
      finals.push(acc)}
    const f=finals.filter(v=>v!=null).sort((a,b)=>a-b);const m=f.reduce((a,b)=>a+b,0)/f.length;
    OUT.res[dk].pol[pol]={mean:Math.round(m),pct:+(100*(m/y-1)).toFixed(1),p10:Math.round(f[Math.floor(.1*f.length)]),p90:Math.round(f[Math.floor(.9*f.length)]),buys:+(nb/TRIALS).toFixed(2),fams:Object.entries(buys).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>k+':'+Math.round(100*v/TRIALS)+'%')};
  }
}})();
