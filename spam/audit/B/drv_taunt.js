// Our own taunt: engine keeps Provocation for exactly ONE opponent phase (de() clears it). Data says duration 2.
// Emulate duration 2 by carrying a fresh taunt over one extra opponent phase.
(()=>{
const DECKS={"chimere":["f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","6598bdc6-b5f4-47a8-be11-761422965f71","3c5cc4d2-1692-4da7-81ae-eb853c91327f","5721ea5f-5978-4328-8874-28abc283f6b8"],"anticrit":["6428d28c-4897-46e4-bcc5-5165484fda2b","6598bdc6-b5f4-47a8-be11-761422965f71","9f744687-461b-493e-9a9a-408906fafbde","5721ea5f-5978-4328-8874-28abc283f6b8"],"zerocrit":["def9a313-f174-4e62-b4b8-1086d28bd09e","feb27db8-e8a5-4ff3-8c30-fc76927965ee","6428d28c-4897-46e4-bcc5-5165484fda2b","e030e28b-0ba3-4c9e-932b-d7c333cadf26"],"alt1":["50807128-85af-472d-b2f7-59737a9a03b4","f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","5721ea5f-5978-4328-8874-28abc283f6b8","6598bdc6-b5f4-47a8-be11-761422965f71"],"alt2":["e030e28b-0ba3-4c9e-932b-d7c333cadf26","76ecb89a-1b3d-4683-b076-5ea3fc20f91a","4dc96cb5-d342-4ef6-8808-fcc79c63690b","6598bdc6-b5f4-47a8-be11-761422965f71"]};
const M=MODELS.x1; const CARD=id=>M.cards.find(c=>c.id===id);
const ent=ids=>ids.map(id=>({card:CARD(id),talent:null}));
const de0=de; let DUR2=false;
de=function(st,t){
  if(DUR2) for(const c of st.cards){ if(c.taunting&&!c._carry) c._left=1; }
  const r=de0(st,t);
  if(DUR2) for(const c of st.cards){ if(!c.dead&&c._left>0){c.taunting=true;c._carry=true;c._left--;} else c._carry=false; }
  return r;
};
function score(ids){let s=0,n=0,dd=0;for(const prof of d)for(const p of [1,2]){const r=q(ent(ids),{opponent:prof,player:p});s+=J(r);dd+=r.ownDeaths;n++;}return {J:Math.round(s/n),deaths:Math.round(10*dd/n)/10};}
const base=o.opponent.dpsByTurn.slice();
const out={};
for(const deck of ['anticrit','zerocrit']){
  const ids=DECKS[deck]; const R={};
  for(const mult of [1,1.5]){
    for(let i=0;i<10;i++)o.opponent.dpsByTurn[i]=base[i]*mult;
    DUR2=false; R['x'+mult+'_dur1(engine)']=score(ids);
    DUR2=true;  R['x'+mult+'_dur2']=score(ids);
  }
  for(let i=0;i<10;i++)o.opponent.dpsByTurn[i]=base[i];
  DUR2=false; out[deck]=R;
}
de=de0;
OUT.taunt=out;
})();
