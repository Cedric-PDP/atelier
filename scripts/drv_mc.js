(()=>{
const DECKS={"A":["f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","6598bdc6-b5f4-47a8-be11-761422965f71","3c5cc4d2-1692-4da7-81ae-eb853c91327f","5721ea5f-5978-4328-8874-28abc283f6b8"],"B":["def9a313-f174-4e62-b4b8-1086d28bd09e","6598bdc6-b5f4-47a8-be11-761422965f71","edfb6bd4-3ac4-420c-bb25-91c9005dea80","e030e28b-0ba3-4c9e-932b-d7c333cadf26"],"C":["def9a313-f174-4e62-b4b8-1086d28bd09e","6598bdc6-b5f4-47a8-be11-761422965f71","e030e28b-0ba3-4c9e-932b-d7c333cadf26","5721ea5f-5978-4328-8874-28abc283f6b8"],"D":["76ecb89a-1b3d-4683-b076-5ea3fc20f91a","def9a313-f174-4e62-b4b8-1086d28bd09e","6598bdc6-b5f4-47a8-be11-761422965f71","e030e28b-0ba3-4c9e-932b-d7c333cadf26"]};const TRIALS=300;
let seed=12345;const rnd=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
const fam=id=>id.replace(/_[CREL]$/,'');
OUT.res={};
for(const [dk,ids] of Object.entries(DECKS)){
  const sel=ids.map(id=>({id,talentId:null}));
  const base=bt.evaluate(sel,{optimize:false,suggestions:false,shop:true});
  const y=base.score;const tl=base.shop.timeline;const planSteps=base.shop.plan;
  const rows={},repl={};base.shop.cards.forEach(c=>{repl[c.cardId]=c.lines.filter(l=>l.verdict==='remplacer').map(l=>l.id)});
  ids.forEach(id=>{const c=base.shop.cards.find(x=>x.cardId===id);rows[id]=c.lines.filter(l=>l.kind!=='free').length});
  const cache=new Map();
  const score=st=>{const lo=ids.filter(id=>st[id].added.length||st[id].removed.length).map(id=>({cardId:id,added:st[id].added.slice(),removed:st[id].removed.slice()}));const k=JSON.stringify(lo);if(cache.has(k))return cache.get(k);let v;try{v=bt.evaluate(sel,{optimize:false,suggestions:false,shop:false,loadout:lo}).score}catch(e){v=null}cache.set(k,v);return v};
  const fresh=()=>{const s={};ids.forEach(id=>s[id]={added:[],removed:[]});return s};
  const clone=s=>JSON.parse(JSON.stringify(s));
  const placements=(st,tox)=>{const out=[];if(ids.some(id=>st[id].added.includes(tox)))return out;
    for(const id of ids){const used=rows[id]-st[id].removed.length+st[id].added.length;
      if(used<3){const n=clone(st);n[id].added.push(tox);out.push({st:n,replace:false,card:id,rem:null})}
      for(const r of repl[id]){if(st[id].removed.includes(r))continue;const n=clone(st);n[id].removed.push(r);n[id].added.push(tox);out.push({st:n,replace:true,card:id,rem:r})}}
    return out};
  const offer=odds=>{const got=[];let guard=0;while(got.length<3&&guard++<50){const u=rnd();let acc=0,rar='common';for(const k of ['common','rare','epic','legendary']){acc+=odds[k]||0;if(u<acc){rar=k;break}}const p=n[rar];const t=p[Math.floor(rnd()*p.length)];if(!got.includes(t))got.push(t)}return got};
  const policies={
    rigid:(st,cur,offered)=>{for(const ps of planSteps){if(!offered.includes(ps.toxId))continue;const nst=clone(st);if(nst[ps.cardId].added.includes(ps.toxId))continue;if(ps.replacesId){if(nst[ps.cardId].removed.includes(ps.replacesId))continue;nst[ps.cardId].removed.push(ps.replacesId)}nst[ps.cardId].added.push(ps.toxId);const v=score(nst);if(v!=null)return {st:nst,tox:ps.toxId,gain:v-cur}}return null},
    family:(st,cur,offered)=>{let best=null;for(const ps of planSteps){for(const t of offered){if(fam(t)!==fam(ps.toxId))continue;const nst=clone(st);if(ids.some(id=>nst[id].added.includes(t)))continue;if(ps.replacesId){if(nst[ps.cardId].removed.includes(ps.replacesId))continue;nst[ps.cardId].removed.push(ps.replacesId)}if(rows[ps.cardId]-nst[ps.cardId].removed.length+nst[ps.cardId].added.length>=3)continue;nst[ps.cardId].added.push(t);const v=score(nst);if(v!=null&&(!best||v-cur>best.gain))best={st:nst,tox:t,gain:v-cur}}}return best},
    adaptive:(st,cur,offered,budget)=>{let best=null;for(const t of offered){if(r[t].cost>budget)continue;for(const p of placements(st,t)){const v=score(p.st);if(v==null)continue;const g=v-cur;const thr=(p.replace?0.03:0.01)*y;if(g>=thr&&(!best||g>best.gain))best={st:p.st,tox:t,gain:g}}}return best}
  };
  OUT.res[dk]={base:y,ideal:base.shop.potentialPct,plan:planSteps.map(p=>p.toxId+'@T'+p.turn),pol:{}};
  for(const pol of ['rigid','family','adaptive','adaptive_reroll']){
    seed=777;const finals=[];const buys={};let nb=0;
    for(let tr=0;tr<TRIALS;tr++){let st=fresh(),cur=y,spent=0,bonus=0;
      for(const op of tl){let budget=op.spamton+bonus-spent;let offered=offer(op.odds);
        const f=policies[pol==='adaptive_reroll'?'adaptive':pol];
        let pick=f(st,cur,offered,budget);
        if(!pick&&pol==='adaptive_reroll'&&budget>=10+15){spent+=10;budget-=10;offered=offer(op.odds);pick=f(st,cur,offered,budget)}
        if(pick&&(pol.startsWith('adaptive')||r[pick.tox].cost<=budget)){st=pick.st;cur+=pick.gain;spent+=r[pick.tox].cost;buys[pick.tox]=(buys[pick.tox]||0)+1;nb++}else bonus+=10}
      finals.push(cur)}
    finals.sort((a,b)=>a-b);const mean=finals.reduce((a,b)=>a+b,0)/finals.length;
    OUT.res[dk].pol[pol]={mean:Math.round(mean),p10:Math.round(finals[Math.floor(.1*TRIALS)]),p50:Math.round(finals[Math.floor(.5*TRIALS)]),p90:Math.round(finals[Math.floor(.9*TRIALS)]),buysPerGame:+(nb/TRIALS).toFixed(2),topBuys:Object.entries(buys).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>k+':'+Math.round(100*v/TRIALS)+'%')};
  }
  OUT.res[dk].cacheSize=cache.size;
}})();
