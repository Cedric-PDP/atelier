// (1) Crit variance: F() (crit chance used by B()/ae()) replaced by a Bernoulli draw -> Monte-Carlo J distribution.
// (2) Horizon: same decks simulated 20 turns (opponent dps frozen at turn-10 value), race = enemy wipe turn vs own wipe turn.
(()=>{
const DECKS={"chimere":["f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","6598bdc6-b5f4-47a8-be11-761422965f71","3c5cc4d2-1692-4da7-81ae-eb853c91327f","5721ea5f-5978-4328-8874-28abc283f6b8"],"anticrit":["6428d28c-4897-46e4-bcc5-5165484fda2b","6598bdc6-b5f4-47a8-be11-761422965f71","9f744687-461b-493e-9a9a-408906fafbde","5721ea5f-5978-4328-8874-28abc283f6b8"],"zerocrit":["def9a313-f174-4e62-b4b8-1086d28bd09e","feb27db8-e8a5-4ff3-8c30-fc76927965ee","6428d28c-4897-46e4-bcc5-5165484fda2b","e030e28b-0ba3-4c9e-932b-d7c333cadf26"],"alt1":["50807128-85af-472d-b2f7-59737a9a03b4","f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","5721ea5f-5978-4328-8874-28abc283f6b8","6598bdc6-b5f4-47a8-be11-761422965f71"],"alt2":["e030e28b-0ba3-4c9e-932b-d7c333cadf26","76ecb89a-1b3d-4683-b076-5ea3fc20f91a","4dc96cb5-d342-4ef6-8808-fcc79c63690b","6598bdc6-b5f4-47a8-be11-761422965f71"]};
const M=MODELS.x1; const CARD=id=>M.cards.find(c=>c.id===id);
const ent=ids=>ids.map(id=>({card:CARD(id),talent:null}));
let seed=12345; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const F0=F;
function score(ids,opts){let s=0,n=0;for(const prof of d)for(const p of [1,2]){s+=J(q(ent(ids),{opponent:prof,player:p,...opts}));n++;}return s/n;}
const out={mc:{},race:{}};
const N=200;
for(const [deck,ids] of Object.entries(DECKS)){
  F=F0; const ev=score(ids,{});
  F=function(e,t,n){const p=F0(e,t,n);return rnd()<p?1:0;};
  const xs=[]; for(let k=0;k<N;k++)xs.push(score(ids,{}));
  F=F0;
  xs.sort((a,b)=>a-b); const mean=xs.reduce((a,b)=>a+b,0)/N; const sd=Math.sqrt(xs.reduce((a,b)=>a+(b-mean)**2,0)/N);
  // single-match spread (neutral, p1) : the 18-run average hides it
  F=function(e,t,n){const p=F0(e,t,n);return rnd()<p?1:0;};
  const ys=[]; for(let k=0;k<N*4;k++)ys.push(J(q(ent(ids),{opponent:d[0],player:1})));
  F=F0; ys.sort((a,b)=>a-b); const evn=J(q(ent(ids),{opponent:d[0],player:1}));
  const m2=ys.reduce((a,b)=>a+b,0)/ys.length;
  out.mc[deck]={ev:Math.round(ev),mcMean:Math.round(mean),sd18:Math.round(sd),p10_18:Math.round(xs[Math.floor(N*.1)]),p90_18:Math.round(xs[Math.floor(N*.9)]),
    neutralP1:{ev:Math.round(evn),mean:Math.round(m2),p10:Math.round(ys[Math.floor(ys.length*.1)]),p50:Math.round(ys[Math.floor(ys.length*.5)]),p90:Math.round(ys[Math.floor(ys.length*.9)])}};
  // horizon race
  const race={};
  for(const mult of [1,1.5,2]){
    const base=o.opponent.dpsByTurn.slice(); for(let i=0;i<base.length;i++)o.opponent.dpsByTurn[i]=base[i]*mult;
    const rows=[];
    for(const prof of d)for(const p of [1,2]){
      const r=q(ent(ids),{opponent:prof,player:p,turns:30});
      const deaths=r.events.filter(e=>e.type==='ownDeath').map(e=>e.turn);
      const wipe=deaths.length>=4?deaths[3]:null; const kill=r.kills>=4?Math.ceil(r.ttk):null;
      rows.push({prof:prof.id,p,kill,wipe,win:kill!=null&&(wipe==null||kill<=wipe)});
    }
    for(let i=0;i<base.length;i++)o.opponent.dpsByTurn[i]=base[i];
    race['x'+mult]={wins:rows.filter(r=>r.win).length+'/'+rows.length,
      medianKillTurn:(()=>{const k=rows.map(r=>r.kill).filter(x=>x!=null).sort((a,b)=>a-b);return k.length?k[Math.floor(k.length/2)]:null})(),
      medianWipeTurn:(()=>{const k=rows.map(r=>r.wipe).filter(x=>x!=null).sort((a,b)=>a-b);return k.length?k[Math.floor(k.length/2)]:null})(),
      neutral:rows.filter(r=>r.prof==='neutral')};
  }
  out.race[deck]=race;
}
F=F0;
OUT.v=out;
})();
