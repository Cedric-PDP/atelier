// usage: node exposure.js <model.json>  -> static exposure of saved/alternative decks to real-game mechanics (v1.21 data)
const fs=require('fs');const m=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const byN=new Map(m.cards.map(c=>[c.number,c]));
const decks={'deck chimere':[103,238,156,117],'anti-critiques':[12,238,27,117],'zéro critique':[102,116,12,69],'deck aleera':[231,238,156,117],'robuste A':[3,103,117,238],'robuste B':[69,160,227,238]};
const avg=h=>((h.min??0)+(h.max??h.min??0))/2;
for(const [name,nums] of Object.entries(decks)){let hp=0,inc=0,st=0,aoe=0,rnd=0,fld=0;const pas=[],brut=[],notes=[];
 for(const n of nums){const c=byN.get(n);hp+=c.hp;inc+=c.spamton;
  for(const p of c.passives||[]){pas.push(`${c.name.split(' ')[0]}:${p.name}`);if(p.type==='brut')brut.push(c.name)}
  for(const a of c.abilities){const o=a.options[0];const d=(o.hits||[]).reduce((s,h)=>s+avg(h),0);if(!d)continue;const per=d/a.cd;
   const t=o.target;if(t==='enemy')st+=per;else if(t==='aoeEnemy')aoe+=per*4;else if(t==='randomEnemy'||t==='spreadEnemy')rnd+=per;else if(t==='spreadField')fld+=per;}
 }
 const tot=st+aoe+rnd+fld;
 console.log(`${name} [${nums.join(',')}]: PV ${hp} | Spamtons/tour ${inc} | dégâts de base/tour (sans bonus, AoE x4 cibles): cible unique ${st.toFixed(1)} (${(100*st/tot).toFixed(0)}%), AoE ${aoe.toFixed(1)} (${(100*aoe/tot).toFixed(0)}%), aléatoire ${rnd.toFixed(1)}, terrain ${fld.toFixed(1)} | Brut: ${brut.join(',')||'aucun'} | passifs innés (ordre): ${pas.join(' ; ')||'-'}`);}
