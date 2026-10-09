// Tag every card of model.json with the disruptive mechanics it carries (innate: abilities + starting Tox; optional: talents).
const fs=require('fs');
const [modelFile,outFile]=process.argv.slice(2);
const m=JSON.parse(fs.readFileSync(modelFile,'utf8'));
const EFF=['absorbAny','absorbAlly','vanish','setHpPct','freeze','taunt','resetEnemyCd','enemyPrec','smoke','resetEnemySpamton','changeElement','resurrect','breakTaunt','eternity'];
const PAS=['tauntOnAttack','freezeOnHit','reflect','immunity','vanishOnHit','eternityOnHit','smoke'];
const out=[];
for(const c of m.cards){
  const innate=new Set(),detail=[],talent={};
  for(const a of c.abilities){for(const o of a.options){for(const e of o.effects){
    if(!EFF.includes(e.type))continue;
    let tag=e.type;
    if(e.type==='freeze'&&(e.target==='ally'||o.target==='ally')){innate.add('freezeAlly');detail.push(`${a.name} (cd ${a.cd}) freeze on OWN ally (not disruptive)`);continue;}
    if(e.type==='setHpPct'&&!(e.value<=50))continue;           // value 75 = self heal to 75 %, not disruptive
    innate.add(tag);
    if(e.type==='taunt'){const dur=e.duration??a.duration??0; if(a.cd<=dur) innate.add('tauntPermanent');}
    detail.push(`${a.name} (cd ${a.cd}) ${e.type}${e.value!=null?' '+e.value:''} tgt=${o.target}`);
  }}}
  for(const p of c.passives){ if(PAS.includes(p.type)){ innate.add(p.type==='smoke'?'smokePassive':p.type); detail.push(`Tox ${p.name} (${p.type})`);} }
  if(innate.has('tauntOnAttack')) innate.add('tauntPermanent');
  for(const t of c.talents){
    const k=t.kind; let tag=null;
    if(k==='focus')tag='taunt25pct'; else if(k==='eternityStart'||k==='eternityAllOnDeath')tag='eternity';
    else if(k==='enemyPrec'||k==='enemyPrecOnAttack')tag='enemyPrec';
    else if(k==='passiveAt8'&&t.passiveObj&&t.passiveObj.type==='immunity')tag='immunity';
    if(tag) talent[t.id]={tag,slot:t.slot,name:t.name};
  }
  out.push({number:c.number,id:c.id,name:c.name,rarity:c.rarity,element:c.element,spamton:c.spamton,hp:c.hp,innate:[...innate].sort(),detail,talent});
}
fs.writeFileSync(outFile,JSON.stringify(out,null,0));
const cnt={};for(const c of out)for(const t of c.innate)cnt[t]=(cnt[t]||0)+1;console.log(cnt);
