// usage: node effects.js <model.json>  -> list every ability effect type with card + ability + text, and every passive type
const fs=require('fs');const m=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const cards=m.cards||m;const by={};const pas={};
for(const c of cards){for(const a of c.abilities||[]){for(const o of a.options||[]){for(const e of o.effects||[]){(by[e.type]=by[e.type]||[]).push(`#${c.number} ${c.name} / ${a.name} [cd${a.cd}${a.uses?' uses'+a.uses:''}${a.echo?' echo'+a.echo:''}${a.duration?' dur'+a.duration:''}${a.costHp?' costHp'+a.costHp:''}${a.cost?' cost'+JSON.stringify(a.cost):''}${a.choice?' choice':''}] t=${o.target} :: ${o.text} || ${JSON.stringify(e)}`)}}}
for(const p of c.passives||[]){(pas[p.type]=pas[p.type]||[]).push(`#${c.number} ${c.name} :: ${p.name} ${p.rarity} ${JSON.stringify(p)}`)}}
for(const k of Object.keys(by).sort()){console.log(`=== EFFECT ${k} (${by[k].length})`);for(const l of by[k])console.log('  '+l)}
for(const k of Object.keys(pas).sort()){console.log(`=== PASSIVE ${k} (${pas[k].length})`);for(const l of pas[k])console.log('  '+l)}
