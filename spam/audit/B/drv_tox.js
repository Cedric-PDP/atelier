// Tox valuation checks: every purchasable Tox on a free row of one card (as the shop planner values it, i.e. active
// from turn 1), then the same Tox injected only from its purchase turn T (de() hook calling te()).
(()=>{
const DECKS={"chimere":["f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","6598bdc6-b5f4-47a8-be11-761422965f71","3c5cc4d2-1692-4da7-81ae-eb853c91327f","5721ea5f-5978-4328-8874-28abc283f6b8"],"anticrit":["6428d28c-4897-46e4-bcc5-5165484fda2b","6598bdc6-b5f4-47a8-be11-761422965f71","9f744687-461b-493e-9a9a-408906fafbde","5721ea5f-5978-4328-8874-28abc283f6b8"],"zerocrit":["def9a313-f174-4e62-b4b8-1086d28bd09e","feb27db8-e8a5-4ff3-8c30-fc76927965ee","6428d28c-4897-46e4-bcc5-5165484fda2b","e030e28b-0ba3-4c9e-932b-d7c333cadf26"],"alt1":["50807128-85af-472d-b2f7-59737a9a03b4","f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","5721ea5f-5978-4328-8874-28abc283f6b8","6598bdc6-b5f4-47a8-be11-761422965f71"],"alt2":["e030e28b-0ba3-4c9e-932b-d7c333cadf26","76ecb89a-1b3d-4683-b076-5ea3fc20f91a","4dc96cb5-d342-4ef6-8808-fcc79c63690b","6598bdc6-b5f4-47a8-be11-761422965f71"]};
const M=MODELS.x1; const CARD=id=>M.cards.find(c=>c.id===id);
const ent=ids=>ids.map(id=>({card:CARD(id),talent:null}));
const shop=it(M.cards).filter(t=>t.purchasable);
const de0=de; let HOOK=null;
de=function(st,t){ if(HOOK)HOOK(st,t); return de0(st,t); };
function score(ids,opts){let s=0,n=0;for(const prof of d)for(const p of [1,2]){s+=J(q(ent(ids),{opponent:prof,player:p,...opts}));n++;}return s/n;}
const out={};
for(const [deck,holderNum] of [['chimere',0],['alt1',1]]){
  const ids=DECKS[deck]; const holder=ids[holderNum]; // Lame de la foret in both decks
  const idx=ids.indexOf(holder);
  const base=score(ids,{});
  const rows=[];
  for(const t of shop){
    const extra=ids.map((x,i)=>i===idx?[t.passive]:[]);
    const sc=score(ids,{extraPassives:extra});
    rows.push({id:t.id,name:t.name,rarity:t.rarity,type:t.passive.type,gainPct:Math.round(1000*(sc-base)/base)/10});
  }
  rows.sort((a,b)=>b.gainPct-a.gainPct);
  // timing: inject at purchase turn T instead of turn 1
  const timing=[];
  for(const r of rows.slice(0,10).concat(rows.filter(r=>/Phoenix_E|Shield_E|Reflect_E|Immunity_E/.test(r.id)))){
    const t=shop.find(x=>x.id===r.id); const res={id:r.id,fromT1:r.gainPct};
    for(const T of [2,4,6,8]){
      HOOK=(st,tt)=>{ const at=st.player===1?T-1:T; if(tt!==at||st._tox)return; st._tox=1;
        const c=st.cards.find(c=>c.card.id===holder); if(!c)return; const pobj={...t.passive}; c.passives.push(pobj); te(c,pobj,st); };
      const sc=score(ids,{}); HOOK=null;
      res['T'+T]=Math.round(1000*(sc-base)/base)/10;
    }
    timing.push(res);
  }
  out[deck]={holder:CARD(holder).name,base:Math.round(base),rows,timing};
}
de=de0;
OUT.tox=out;
})();
