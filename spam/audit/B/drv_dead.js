// Run the same scenarios on the stock engine and on engine_deadfix.js (dead cards stop their per-turn passives):
// default, opponent dps x1.5 and x2, and absorb of each card at T=7/8.
(()=>{
const DECKS={"chimere":["f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","6598bdc6-b5f4-47a8-be11-761422965f71","3c5cc4d2-1692-4da7-81ae-eb853c91327f","5721ea5f-5978-4328-8874-28abc283f6b8"],"anticrit":["6428d28c-4897-46e4-bcc5-5165484fda2b","6598bdc6-b5f4-47a8-be11-761422965f71","9f744687-461b-493e-9a9a-408906fafbde","5721ea5f-5978-4328-8874-28abc283f6b8"],"zerocrit":["def9a313-f174-4e62-b4b8-1086d28bd09e","feb27db8-e8a5-4ff3-8c30-fc76927965ee","6428d28c-4897-46e4-bcc5-5165484fda2b","e030e28b-0ba3-4c9e-932b-d7c333cadf26"],"alt1":["50807128-85af-472d-b2f7-59737a9a03b4","f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","5721ea5f-5978-4328-8874-28abc283f6b8","6598bdc6-b5f4-47a8-be11-761422965f71"],"alt2":["e030e28b-0ba3-4c9e-932b-d7c333cadf26","76ecb89a-1b3d-4683-b076-5ea3fc20f91a","4dc96cb5-d342-4ef6-8808-fcc79c63690b","6598bdc6-b5f4-47a8-be11-761422965f71"]};
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
