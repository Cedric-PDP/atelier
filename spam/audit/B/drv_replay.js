// Incident replay through the engine's built-in per-card opponent mode (b() with opponent.cards) +
// opts.focus (taunt) + de() wrapper (absorb at T). Also a sanity check: per-card clone of "neutral".
(()=>{
const DECKS={"chimere":["f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","6598bdc6-b5f4-47a8-be11-761422965f71","3c5cc4d2-1692-4da7-81ae-eb853c91327f","5721ea5f-5978-4328-8874-28abc283f6b8"],"anticrit":["6428d28c-4897-46e4-bcc5-5165484fda2b","6598bdc6-b5f4-47a8-be11-761422965f71","9f744687-461b-493e-9a9a-408906fafbde","5721ea5f-5978-4328-8874-28abc283f6b8"],"zerocrit":["def9a313-f174-4e62-b4b8-1086d28bd09e","feb27db8-e8a5-4ff3-8c30-fc76927965ee","6428d28c-4897-46e4-bcc5-5165484fda2b","e030e28b-0ba3-4c9e-932b-d7c333cadf26"],"alt1":["50807128-85af-472d-b2f7-59737a9a03b4","f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","5721ea5f-5978-4328-8874-28abc283f6b8","6598bdc6-b5f4-47a8-be11-761422965f71"],"alt2":["e030e28b-0ba3-4c9e-932b-d7c333cadf26","76ecb89a-1b3d-4683-b076-5ea3fc20f91a","4dc96cb5-d342-4ef6-8808-fcc79c63690b","6598bdc6-b5f4-47a8-be11-761422965f71"]};
const M=MODELS.x1; const CARD=id=>M.cards.find(c=>c.id===id);
const ent=ids=>ids.map(id=>({card:CARD(id),talent:null}));
const V10=o.opponent.dpsByTurn.slice();
const all=v=>({fire:v,water:v,earth:v,nature:v,shadow:v,light:v});
const flat=(f)=>V10.map((v,i)=>f(v,i));
function neutralClone(){return {id:'neutral-clone',cards:[0,1,2,3].map(i=>({id:'n'+i,hp:700,res:all(10),dmgByTurn:flat(v=>v/4),aoe:o.opponent.aoeShare}))};}
function azurian(){
  const T=CARD('75491473-57fa-4b8f-aced-9d61d0404e65'), F=CARD('9a5c316d-6a42-4353-8f1a-5c3dc7703538');
  return {id:'azurian',cards:[
    {id:'tisseuse',hp:T.hp,res:{...T.res},dmgByTurn:flat(()=>0),aoe:0},
    {id:'fleur',hp:F.hp,res:{...F.res},dmgByTurn:flat(()=>10),aoe:0},
    {id:'x1',hp:700,res:all(10),dmgByTurn:flat(v=>(v-10)/2),aoe:o.opponent.aoeShare},
    {id:'x2',hp:700,res:all(10),dmgByTurn:flat(v=>(v-10)/2),aoe:o.opponent.aoeShare}]};
}
const de0=de; let HOOK=null;
de=function(st,t){ if(HOOK)HOOK(st,t); return de0(st,t); };
function run(ids,opp,opts={}){
  const rows=[];
  for(const p of [1,2]){const r=q(ent(ids),{opponent:opp,player:p,...opts});rows.push({J:J(r),ttk:r.ttk,deaths:r.ownDeaths,kills:r.kills,ev:r.events.map(e=>e.turn+':'+e.type+':'+(e.card||'')).join(' ')});}
  return {J:Math.round((rows[0].J+rows[1].J)/2),p1:rows[0],p2:rows[1]};
}
const out={};
for(const [deck,ids] of Object.entries(DECKS)){
  const R={};
  HOOK=null;
  // sanity: abstract neutral vs per-card clone of neutral (same HP/res/dps)
  R.abstractNeutral=run(ids,d[0]);
  R.cloneNeutral=run(ids,neutralClone());
  R.azurian_plain=run(ids,azurian());
  R.azurian_taunt=run(ids,azurian(),{focus:'fleur'});
  // absorb: best card of ours (highest Se-like value is not known -> pick the one named in the incident when present, else the max-HP-loss one)
  const target=ids.includes('6598bdc6-b5f4-47a8-be11-761422965f71')?'6598bdc6-b5f4-47a8-be11-761422965f71':null;
  const mkAbs=(cid)=>(st,t)=>{ const T=st.player===1?7:8; if(t!==T||st._abs)return; st._abs=1;
      const tis=st.enemies.find(e=>e.id==='tisseuse'&&e.hp>0); if(!tis)return;
      let c=cid?st.cards.find(c=>c.card.id===cid&&!c.dead):null;
      if(!c){const al=st.cards.filter(c=>!c.dead);c=al.reduce((a,b)=>Se(b,st)>Se(a,st)?b:a,al[0]);}
      if(!c)return; const hp=c.hpMax; c.dead=true;c.dmgTaken=c.hpMax; tis.hp+=hp; tis.hpMax+=hp; st.events.push({turn:t,type:'absorbed',card:c.card.name}); };
  HOOK=mkAbs(target); R.azurian_absorb=run(ids,azurian());
  R.azurian_taunt_absorb=run(ids,azurian(),{focus:'fleur'});
  HOOK=null;
  out[deck]=R;
}
de=de0;
OUT.replay=out;
})();
