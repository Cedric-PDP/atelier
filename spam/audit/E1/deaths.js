// Which of our cards die, per matchup, under a STRESS payload (diagnostic for the report)
const fs=require('fs'),vm=require('vm'),path=require('path');
const SP=path.resolve(__dirname,'../../..');
const model=JSON.parse(fs.readFileSync(SP+'/spam/js/model.json','utf8'));
const ctx=vm.createContext({self:{postMessage(){}},console,Date});
vm.runInContext(fs.readFileSync(__dirname+'/engine_stress.js','utf8'),ctx);ctx.__model=model;
const byNum=new Map(model.cards.map(c=>[c.number,c]));
const run=vm.runInContext('(ids)=>{const rows=pt(ids.map(id=>({id,talentId:null})),__model.cards);return d.flatMap(p=>[1,2].map(pl=>{const r=q(rows,{opponent:p,player:pl});return{p:p.id,pl,J:J(r),offense:r.offense,deaths:r.events.filter(e=>e.type===`ownDeath`).map(e=>e.card+"@T"+e.turn),kills:r.kills}}))}',ctx);
for(const [label,deck] of [['deck chimere',[103,238,156,117]],['robuste A',[3,103,117,238]],['deck aleera',[231,238,156,117]]]){
 for(const S of [null,{reflect:0.75},{reflect:0.25}]){
  ctx.STRESS=S?Object.assign({on:true},S):undefined;
  const rs=run(deck.map(n=>byNum.get(n).id));
  const cnt={};for(const r of rs)for(const d of r.deaths){const c=d.split('@')[0];cnt[c]=(cnt[c]||0)+1}
  const offShare=rs.reduce((a,r)=>a+r.offense,0)/rs.reduce((a,r)=>a+r.J,0);
  const turns=rs.flatMap(r=>r.deaths.filter(d=>d.startsWith('Chim')).map(d=>+d.split('@T')[1]));
  console.log(label.padEnd(12),JSON.stringify(S),'deaths by card over 18 matches',JSON.stringify(cnt),'offense share of score',offShare.toFixed(2),'Chimère death turns',turns.length?('min '+Math.min(...turns)+' max '+Math.max(...turns)+' mean '+(turns.reduce((a,b)=>a+b,0)/turns.length).toFixed(1)):'-');
 }
}
