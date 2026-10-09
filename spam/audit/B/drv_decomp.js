(()=>{
const DECKS={"chimere":["f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","6598bdc6-b5f4-47a8-be11-761422965f71","3c5cc4d2-1692-4da7-81ae-eb853c91327f","5721ea5f-5978-4328-8874-28abc283f6b8"],"anticrit":["6428d28c-4897-46e4-bcc5-5165484fda2b","6598bdc6-b5f4-47a8-be11-761422965f71","9f744687-461b-493e-9a9a-408906fafbde","5721ea5f-5978-4328-8874-28abc283f6b8"],"zerocrit":["def9a313-f174-4e62-b4b8-1086d28bd09e","feb27db8-e8a5-4ff3-8c30-fc76927965ee","6428d28c-4897-46e4-bcc5-5165484fda2b","e030e28b-0ba3-4c9e-932b-d7c333cadf26"],"alt1":["50807128-85af-472d-b2f7-59737a9a03b4","f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","5721ea5f-5978-4328-8874-28abc283f6b8","6598bdc6-b5f4-47a8-be11-761422965f71"],"alt2":["e030e28b-0ba3-4c9e-932b-d7c333cadf26","76ecb89a-1b3d-4683-b076-5ea3fc20f91a","4dc96cb5-d342-4ef6-8808-fcc79c63690b","6598bdc6-b5f4-47a8-be11-761422965f71"]};
const M=MODELS.x1; const CARD=id=>M.cards.find(c=>c.id===id);
const ent=ids=>ids.map(id=>({card:CARD(id),talent:null}));
const base=o.opponent.dpsByTurn.slice();
function run(ids,label){
  const rows=[];
  for(const prof of d)for(const p of [1,2]){
    const r=q(ent(ids),{opponent:prof,player:p});
    rows.push({prof:prof.id,p,J:J(r),off:r.offense,ehpL:r.ehpLeft,defC:r.defenseCredits,ctl:r.control,eco:r.economy,ttk:r.ttk,deaths:r.ownDeaths,press:r.pressureTaken,dmg:r.dmgTotal,kills:r.kills,hpTot:r.hpTotal,heal:r.heal});
  }
  const avg=k=>rows.reduce((a,x)=>a+x[k],0)/rows.length;
  const res={label};
  for(const k of ['J','off','ehpL','defC','ctl','eco','ttk','deaths','press','dmg','kills','hpTot','heal'])res[k]=Math.round(avg(k)*10)/10;
  res.share={off:Math.round(100*avg('off')/avg('J')),ehp:Math.round(100*0.35*avg('ehpL')/avg('J')),defC:Math.round(100*0.35*avg('defC')/avg('J')),ctl:Math.round(100*0.8*avg('ctl')/avg('J')),eco:Math.round(100*0.5*avg('eco')/avg('J'))};
  res.anyDeathRuns=rows.filter(x=>x.deaths>0).length+'/'+rows.length;
  const rn=q(ent(ids),{opponent:d[0],player:1});
  res.neutralDmgByTurn=rn.dmgByTurn; res.events=rn.events.filter(e=>e.type!=='kill').map(e=>e.turn+':'+e.type+':'+e.card);
  return res;
}
OUT.oppDps=base;
OUT.res={};
for(const mult of [1,2,3]){
  for(let i=0;i<base.length;i++)o.opponent.dpsByTurn[i]=base[i]*mult;
  for(const [name,ids] of Object.entries(DECKS))OUT.res[name+'_x'+mult]=run(ids,name+' dps x'+mult);
}
for(let i=0;i<base.length;i++)o.opponent.dpsByTurn[i]=base[i];
})();
