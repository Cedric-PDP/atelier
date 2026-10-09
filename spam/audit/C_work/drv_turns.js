(()=>{const I=ht(MODELS.x1);
 const M=MODELS.x1; const byId=Object.fromEntries(M.cards.map(c=>[c.id,c]));
 const decks={"deck chimere":[103,238,156,117],"zero critique":[102,116,12,69]};
 OUT.res={};
 for(const [name,nums] of Object.entries(decks)){
  for(const player of [1,2]){
  const ids=nums.map(n=>M.cards.find(c=>c.number===n).id);
  const r=I.evaluate(ids.map(id=>({id,talentId:null})),{optimize:false,suggestions:false,shop:false,player});
  OUT.res[name+' p'+player]={score:r.score,turns:r.plan.map((turn,ti)=>turn.filter(a=>a.dmg||a.heal).map(a=>byId[a.cardId].number+':'+a.abilityId+'='+Math.round(a.dmg||0)+(a.heal?'/h'+Math.round(a.heal):'')).join(' ; '))};
 }}
})();
