// Our own taunt: engine keeps Provocation for exactly ONE opponent phase (de() clears it). Data says duration 2.
// Emulate duration 2 by carrying a fresh taunt over one extra opponent phase.
(()=>{
const DECKS=__DECKS__;
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
