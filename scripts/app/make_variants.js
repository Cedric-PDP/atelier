// Builds the model variants used by the pipeline from a wiki model.json:
//   model_nocrit  = crit chances and crit/critMult buffs at 0 (score without crits)
//   model_crit0.5 = crit chances and crit buffs halved, critMult kept (Monte-Carlo shop "half crits")
//   model_dead    = + the 'dead-card' placeholder (1 HP, nothing) used for the "lost card" metric L
// Usage: node scripts/app/make_variants.js <model.json> <outDir>
// Checked on 1.20: regenerates spam/js/model_nocrit.json and model_crit0.5.json byte for byte.
const fs=require('fs'),path=require('path');
const [src,outDir]=process.argv.slice(2);if(!src||!outDir)throw new Error('usage: make_variants.js <model.json> <outDir>');
const base=JSON.parse(fs.readFileSync(src,'utf8'));
const clone=o=>JSON.parse(JSON.stringify(o));
const critScaled=k=>{const m=clone(base);for(const c of m.cards)for(const a of c.abilities){a.crit=k===0?0:a.crit*k;
  for(const o of a.options)for(const e of o.effects){if(e.type==='crit')e.value=k===0?0:e.value*k;else if(e.type==='critMult'&&k===0)e.value=0}}return m};
const dead=clone(base);const tpl=dead.cards.find(c=>c.number===1);
dead.cards.push({...clone(tpl),id:'dead-card',slug:'dead_card',number:9999,name:'Carte perdue',element:'fire',rarity:'common',spamton:0,hp:1,
  res:{fire:0,water:0,earth:0,nature:0,light:0,shadow:0},warnings:[],avgRes:0,minRes:0,negRes:[],abilities:[],passives:[],rawSkills:[],talents:[],rows:0});
const w=(f,o)=>fs.writeFileSync(path.join(outDir,f),JSON.stringify(o));
w('model_nocrit.json',critScaled(0));w('model_crit0.5.json',critScaled(0.5));w('model_dead.json',dead);
console.log('variants',base.version,base.engineHash,'cards',base.cards.length,'dead cards',dead.cards.length);
