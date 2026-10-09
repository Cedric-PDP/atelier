// Scenario driver: injects opponent behaviours through the engine's own hook points
// (de = opponent phase, G = damage applied to enemies, g = flat-credit constants).
(()=>{
const DECKS=__DECKS__;
const M=MODELS.x1; const CARD=id=>M.cards.find(c=>c.id===id);
const ent=ids=>ids.map(id=>({card:CARD(id),talent:null}));
const de0=de, G0=G;
let HOOK=null;            // function(st,t) run at the start of every opponent phase
let REFL=null;            // {pct, idx:'all'|number}
de=function(st,t){ if(HOOK) HOOK(st,t); return de0(st,t); };
G=function(st,t,n,card,abil,w){
  if(!REFL||st.opts.potential) return G0.apply(this,arguments);
  const before=st.enemies.map(x=>x.hp);
  const r=G0.apply(this,arguments);
  if(card&&!card.dead){
    let dealt=0;
    st.enemies.forEach((x,i)=>{ if(REFL.idx==='all'||REFL.idx===i) dealt+=Math.max(0,before[i]-Math.max(0,x.hp)); });
    if(dealt>0) H(st,t,card,dealt*REFL.pct*A(card,st,null,false));
  }
  return r;
};
function evalDeck(ids,opts={}){
  let Js=0,deaths=0,n=0,offs=0,ehp=0;
  for(const prof of d)for(const p of [1,2]){
    const r=q(ent(ids),{opponent:prof,player:p,...opts});
    Js+=J(r); deaths+=r.ownDeaths; offs+=r.offense; ehp+=r.ehpLeft; n++;
  }
  return {J:Math.round(Js/n),deaths:Math.round(10*deaths/n)/10,off:Math.round(offs/n),ehpL:Math.round(ehp/n)};
}
const nameOf=id=>CARD(id).name;
const out={};
for(const [deck,ids] of Object.entries(DECKS)){
  const R={};
  HOOK=null;REFL=null;
  R.base=evalDeck(ids);
  // S1 mimetism flat credit removed (opponent that never generates)
  const mim=g.mimetismPerTurn; g.mimetismPerTurn=0; R.mimetism0=evalDeck(ids); g.mimetismPerTurn=mim;
  // S3 absorb (Veuve noire, CD 8): opponent ready turn 7 if it plays 2nd (we are p1), turn 8 if it plays 1st (we are p2)
  R.absorb={};
  for(const cid of ids){
    HOOK=(st,t)=>{ const T=st.player===1?7:8; if(t!==T||st._abs)return; st._abs=1;
      const c=st.cards.find(c=>c.card.id===cid&&!c.dead); if(!c)return;
      const hp=c.hpMax; c.dead=true; c.dmgTaken=c.hpMax;
      const al=st.enemies.filter(e=>e.hp>0); if(al.length){const tg=al.reduce((a,b)=>b.hp>a.hp?b:a); tg.hp+=hp; if(tg.hpMax!=null)tg.hpMax+=hp;} };
    R.absorb[nameOf(cid)]=evalDeck(ids);
  }
  HOOK=null;
  // S4 opponent focuses one of our cards with every single-target hit, from turn 1 (our own taunt still wins)
  R.focus={};
  for(const cid of ids){
    HOOK=(st,t)=>{ if(st.cards.some(c=>!c.dead&&c.taunting))return; const c=st.cards.find(c=>c.card.id===cid&&!c.dead); if(c)c.taunting=true; };
    R.focus[nameOf(cid)]=evalDeck(ids);
  }
  // S5 freeze one of our cards every 3rd opponent phase (t=3,6,9): it skips its next own turn
  R.freeze={};
  for(const cid of ids){
    HOOK=(st,t)=>{ if(t%3!==0)return; const c=st.cards.find(c=>c.card.id===cid&&!c.dead); if(!c)return;
      const skip=st.player===1?t+1:t; for(const a of c.abilities)a.nextTurn=Math.max(a.nextTurn,skip+1); };
    R.freeze[nameOf(cid)]=evalDeck(ids);
  }
  // S7 precision malus -10% on our whole team at t=3 and t=7 (Luminaire Abyssal "Phare", CD 4, stacking)
  HOOK=(st,t)=>{ if(t===3||t===7)st.team.prec-=10; };
  R.precMalus=evalDeck(ids);
  // S8 opponent resets all our cooldowns to max at t=5 and t=10 (Gardien Vert "Rayonnement", CD 5)
  HOOK=(st,t)=>{ if(t!==5&&t!==10)return; const last=st.player===1?t:t-1;
    for(const c of st.cards)for(const a of c.abilities)a.nextTurn=Math.max(a.nextTurn,last+a.ab.cd); };
  R.cdReset=evalDeck(ids);
  HOOK=null;
  // S10 reflect: enemy #0 (our first focus target) holds Reflect_R 50%; all four hold Reflect_C 25%
  REFL={pct:.5,idx:0}; R.reflectR_first=evalDeck(ids);
  REFL={pct:.25,idx:'all'}; R.reflectC_all=evalDeck(ids);
  REFL={pct:1,idx:'all'}; R.reflectL_all=evalDeck(ids);
  REFL=null;
  out[deck]=R;
}
de=de0;G=G0;HOOK=null;
OUT.scen=out;
})();
