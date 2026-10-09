// Deck-vs-deck through the engine's own per-card opponent mode: the opponent's per-card damage/heal curves come
// from q(oppDeck,{potential:true}) played with the OTHER player order. No opponent effects (still passive cards),
// so this isolates the damage-volume bias (B1). J over 10 turns + 30-turn race (wipe turns).
(()=>{
const DECKS=__DECKS__; const N2I=__NUM2ID__; const OPP=__OPP__;
const M=MODELS.x1; const CARD=id=>M.cards.find(c=>c.id===id);
const ent=ids=>ids.map(id=>({card:CARD(id),talent:null}));
function oppFrom(nums,player,turns){
  const cards=nums.map(n=>CARD(N2I[n]));
  const r=q(cards.map(c=>({card:c,talent:null})),{potential:true,player,turns});
  const P=r.potential; const heal=P.healByTurn.map(v=>v/cards.length);
  return {id:'deck',cards:cards.map((c,i)=>{
    const prof=T([{card:c}]); const tot=Object.values(prof).reduce((a,b)=>a+b,0);
    const mix=tot>0?Object.fromEntries(Object.entries(prof).map(([k,v])=>[k,v/tot])):null;
    const dsum=P.dmgByCard[i].reduce((a,b)=>a+b,0);
    return {id:'o'+i,name:c.name,hp:P.board[i].hp,res:P.board[i].res,phoenix:P.board[i].phoenix,brut:P.board[i].brut,
      dmgByTurn:P.dmgByCard[i],healByTurn:heal,mix,aoe:dsum>0?Math.min(1,P.aoeByCard[i]/dsum):0};})};
}
const out={};
for(const [oname,onums] of Object.entries(OPP)){
  out[oname]={};
  for(const [deck,ids] of Object.entries(DECKS)){
    let Jsum=0; const race=[];
    for(const p of [1,2]){
      const r=q(ent(ids),{opponent:oppFrom(onums,3-p,10),player:p}); Jsum+=J(r);
      const r30=q(ent(ids),{opponent:oppFrom(onums,3-p,30),player:p,turns:30});
      const deaths=r30.events.filter(e=>e.type==='ownDeath').map(e=>e.turn);
      const wipe=deaths.length>=4?deaths[3]:null; const kill=r30.kills>=4?Math.ceil(r30.ttk):null;
      race.push({p,kill,wipe,win:kill!=null&&(wipe==null||kill<=wipe),deaths10:r.ownDeaths,kills10:r.kills});
    }
    out[oname][deck]={J:Math.round(Jsum/2),race};
  }
}
OUT.duel=out;
})();
