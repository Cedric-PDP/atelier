// Tox valuation checks: every purchasable Tox on a free row of one card (as the shop planner values it, i.e. active
// from turn 1), then the same Tox injected only from its purchase turn T (de() hook calling te()).
(()=>{
const DECKS=__DECKS__;
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
