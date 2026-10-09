// usage: node threats.js <model.json> -> per mechanic: cards (number name rarity) carrying it innately (ability effect / target / passive) + talents
const fs=require('fs');const m=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const R=c=>c.rarity[0].toUpperCase();const tag=c=>`#${c.number} ${c.name} (${R(c)})`;
const add=(o,k,c)=>{(o[k]=o[k]||new Map()).set(c.number,tag(c))};
const eff={},tgt={},pas={},tal={};const rar={};
for(const c of m.cards){rar[c.rarity]=(rar[c.rarity]||0)+1;
 for(const a of c.abilities||[])for(const o of a.options||[]){add(tgt,o.target,c);for(const e of o.effects||[])add(eff,e.type,c);}
 for(const p of c.passives||[])add(pas,p.type,c);
 for(const t of c.talents||[]){if(t)add(tal,t.name||t.id,c);}}
console.log('rarity counts',JSON.stringify(rar));
const show=(lab,o)=>{for(const k of Object.keys(o).sort())console.log(`${lab} ${k} [${o[k].size}]: ${[...o[k].values()].join('; ')}`)};
show('EFFECT',eff);show('PASSIVE',pas);show('TARGET',tgt);show('TALENT',tal);
