(()=>{const I=ht(MODELS.x1);
 const M=MODELS.x1; const byId=Object.fromEntries(M.cards.map(c=>[c.id,c]));
 const decks={"deck chimere":[103,238,156,117],"zero critique":[102,116,12,69]};
 OUT.res={};
 for(const [name,nums] of Object.entries(decks)){
  const ids=nums.map(n=>M.cards.find(c=>c.number===n).id);
  const r=I.evaluate(ids.map(id=>({id,talentId:null})),{optimize:false,suggestions:false,shop:false});
  const per={}; let tot=0; const byTurn=[];
  r.plan.forEach((turn,ti)=>{ let t=0; for(const a of turn){ const c=byId[a.cardId]; const ab=c.abilities.find(x=>x.id===a.abilityId); const tgt=ab?ab.options[a.option||0].target:'?'; const k=c.number+' '+c.name+' / '+a.abilityId+' ['+tgt+']'; per[k]=per[k]||{dmg:0,heal:0,casts:0}; per[k].dmg+=a.dmg||0; per[k].heal+=a.heal||0; per[k].casts++; tot+=a.dmg||0; t+=a.dmg||0; } byTurn.push(t); });
  OUT.res[name]={score:r.score,dmgTotal:r.dmgTotal,planDmg:tot,byTurn,per};
 }
})();
