// Run the same scenarios on the stock engine and on engine_deadfix.js (dead cards stop their per-turn passives):
// default, opponent dps x1.5 and x2, and absorb of each card at T=7/8.
(()=>{
const DECKS=__DECKS__;
const M=MODELS.x1; const CARD=id=>M.cards.find(c=>c.id===id);
const ent=ids=>ids.map(id=>({card:CARD(id),talent:null}));
const de0=de; let HOOK=null;
de=function(st,t){ if(HOOK)HOOK(st,t); return de0(st,t); };
function score(ids){let s=0,n=0;for(const prof of d)for(const p of [1,2]){s+=J(q(ent(ids),{opponent:prof,player:p}));n++;}return Math.round(s/n);}
const base=o.opponent.dpsByTurn.slice();
const out={};
for(const [deck,ids] of Object.entries(DECKS)){
  const R={};
  for(const mult of [1,1.5,2]){for(let i=0;i<10;i++)o.opponent.dpsByTurn[i]=base[i]*mult; R['dps_x'+mult]=score(ids);}
  for(let i=0;i<10;i++)o.opponent.dpsByTurn[i]=base[i];
  for(const cid of ids){
    HOOK=(st,t)=>{ const T=st.player===1?7:8; if(t!==T||st._abs)return; st._abs=1;
      const c=st.cards.find(c=>c.card.id===cid&&!c.dead); if(!c)return; const hp=c.hpMax; c.dead=true; c.dmgTaken=c.hpMax;
      const al=st.enemies.filter(e=>e.hp>0); if(al.length){const tg=al.reduce((a,b)=>b.hp>a.hp?b:a); tg.hp+=hp;} };
    R['absorb_'+CARD(cid).name]=score(ids);
  }
  HOOK=null;
  out[deck]=R;
}
de=de0;
OUT.dead=out;
})();
