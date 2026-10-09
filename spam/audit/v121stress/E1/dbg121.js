// single-match tracer on the 1.21 stress engine: node dbg121.js "nums" player profile 'STRESSjson'
const fs=require('fs'),vm=require('vm'),path=require('path');
const SP=path.resolve(__dirname,'../../../..');
const model=JSON.parse(fs.readFileSync(SP+'/spam/v121/model.json','utf8'));
const ctx=vm.createContext({self:{postMessage(){}},console,Date});
vm.runInContext(fs.readFileSync(__dirname+'/engine121_stress.js','utf8'),ctx);ctx.__model=model;
const byNum=new Map(model.cards.map(c=>[c.number,c]));
const run=vm.runInContext('(ids,pl,prof)=>{const rows=pt(ids.map(id=>({id,talentId:null})),__model.cards);const r=J(rows,{opponent:d.find(x=>x.id===prof),player:pl});return {S:Y(r),r}}',ctx);
const deck=process.argv[2].split(',').map(Number),pl=+(process.argv[3]||1),prof=process.argv[4]||'neutral',S=JSON.parse(process.argv[5]||'null');
ctx.STRESS=S?Object.assign({on:true},S):undefined;
const {S:score,r}=run(deck.map(n=>byNum.get(n).id),pl,prof);
console.log(JSON.stringify(S),'J',score.toFixed(1),'ttk',r.ttk,'dmg',r.dmgTotal.toFixed(0),'kills',r.kills,'deaths',r.ownDeaths,'refl',r.reflTaken.toFixed(0),'frz',r.frzCount,'thawHeal',r.thawHeal,'thawTox',r.thawTox,'ehp',r.ehpLeft.toFixed(0));
if(process.argv[6])console.log('events',r.events.map(e=>'T'+e.turn+':'+e.type+':'+(e.card||'').split(' ')[0]).join(' '));if(process.argv[6])r.plan.forEach((p,i)=>console.log('T'+(i+1),p.map(x=>x.card.split(' ')[0]+':'+x.ability+'('+x.dmg+')').join(' | ')));
