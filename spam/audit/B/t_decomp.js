(()=>{
const DECKS=__DECKS__;
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
