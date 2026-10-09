// Builds the core data file for the deck workshop page from precomputed engine outputs.
// Usage: node scripts/app/build_core.js <repoRoot>/spam <out data.json> [--ver=<spam/versions/X.YY>]
//   --ver  : everything comes from the version folder (js/model.json, app/*.json, builder_fr.txt, cards_fr.json) and
//            meta (baseline, best, tiers), bestDeck and the shop simulations are read from the results, not hard-coded.
//   no --ver: legacy 1.20 layout (spam/js, spam/app, spam/stats) with the hard-coded 1.20 meta and sims.
const fs=require('fs'),path=require('path');
const D=process.argv[2],OUT=process.argv[3];
const V=(process.argv.slice(4).find(a=>a.startsWith('--ver='))||'').slice(6)||null;
const JP=p=>JSON.parse(fs.readFileSync(p,'utf8'));const J=f=>JP(path.join(D,f));
const P=V?{model:path.join(V,'js/model.json'),cards:path.join(V,'cards_fr.json'),tox:path.join(V,'app/toxinfo.json'),builder:path.join(V,'builder_fr.txt'),app:path.join(V,'app'),glob:path.join(V,'app')}
  :{model:path.join(D,'js/model_crit1.json'),cards:path.join(D,'cards_fr.json'),tox:path.join(D,'toxinfo.json'),builder:path.join(D,'v2/builder_fr.txt'),app:path.join(D,'app'),glob:path.join(D,'stats')};
const model=JP(P.model),fr=JP(P.cards).cards,tox=JP(P.tox);
const pool=J('app/pool_order.json');const NOWN=26;
const byId={};model.cards.forEach(c=>byId[c.id]=c);const frById={};fr.forEach(c=>frById[c.id]=c);
const ELS=['fire','water','earth','nature','light','shadow'];
const cards=pool.map((id,i)=>{const m=byId[id],f=frById[id];return {n:m.number,name:m.name,el:m.element,rar:m.rarity,hp:m.hp,spt:m.spamton,own:i<NOWN?1:0,
  res:ELS.map(e=>m.res?m.res[e]??0:0),
  ab:m.abilities.map(a=>[a.id,a.name,a.cd,String(a.text||'').replace(/\s*\n\s*/g,' · ')]),
  pa:m.passives.map(p=>[p.id,p.name,p.rarity,p.text])}});
// Tox: French names from the wiki builder page, costs from the engine.
const FAM={Aoe:'AoE',Berserk:'Berserk',Chance:'Chanceur',Cimetiere:'Cimetière',CoeurEau:"Cœur d'eau",CoeurFeu:'Cœur de feu',CoeurLumiere:'Cœur de lumière',CoeurNature:'Cœur de nature',CoeurOmbre:"Cœur d'ombre",CoeurResistance:'Cœur résistance',CoeurTerre:'Cœur de terre',CoeurVital:'Cœur vital',Erosion:'Érosion','Life Steal':'Vampirisme',Phoenix:'Phénix',Poison:'Poison','Primitive heal':'Soin primitif',PunchingBag:'Sac de frappe',Reflect:'Renvoi',Shield:'Bouclier',Spamland:'Spamland',Tenacite:'Ténacité',Brut:'Brut',Inversement:'Inversement',Mimetisme:'Mimétisme',Multiplicator:'Multiplicateur',Mystere:'Mystère',Optimisation:'Optimisation',Revenge:'Revanche',Smoked:'Fumée',Taunt:'Provocation',Bomba:'Bomba',Frozen:'Gel',Immunity:'Immunité',Metamorph:'Métamorphe',Reset:'Reset',Vengeur:'Vengeur',Disparition:'Disparition',Eternity:'Éternité',Temporality:'Temporalité'};
const RW={Commune:'C',Rare:'R','Épique':'E','Légendaire':'L'};
const dec=s=>s.replace(/&#x27;/g,"'").replace(/&quot;/g,'"').replace(/&amp;/g,'&');
const txt={};fs.readFileSync(P.builder,'utf8').split('\n').forEach(l=>{const m=dec(l).match(/^- (.+?) (Commune|Rare|Épique|Légendaire) · [^%]*% (.*)$/);if(m)txt[m[1]+'|'+RW[m[2]]]=m[3].trim()});
const T={};const pools=tox.pools;for(const rar of Object.keys(pools))for(const id of pools[rar]){const fam=id.replace(/_[CREL]$/,''),r=id.slice(-1);const name=FAM[fam]||fam;T[id]=[name,r,tox.tox[id].cost,txt[name+'|'+r]||'']}
// Also passives that exist on cards (ids like Life Steal_E) resolve through T when they are shop Tox.
// Decks: every pre_<i>.json / lost_<i>.json chunk present (6/20 chunks in 1.20, recompute.sh <version> uses N).
const chunks=prefix=>fs.readdirSync(P.app).filter(f=>new RegExp('^'+prefix+'_\\d+\\.json$').test(f)).sort((a,b)=>parseInt(a.slice(prefix.length+1))-parseInt(b.slice(prefix.length+1))).map(f=>path.join(P.app,f));
const preFiles=chunks('pre');if(!preFiles.length)throw new Error('no pre_*.json in '+P.app);
const cols={k:[],s1:[],s0:[],ttk:[],m:[],p1:[],dmg:[],plan:[]};let errs=0;
for(const f of preFiles){const o=JP(f).res;errs+=o.err||0;o.k.forEach((k,j)=>{cols.k.push(k);cols.s1.push(o.s1[j]);cols.s0.push(o.s0[j]);cols.ttk.push(o.ttk[j]);cols.m.push(o.m[j]);cols.p1.push(o.p1[j]);cols.dmg.push(o.dmg[j]);cols.plan.push(o.plan[j])})}
const NP=pool.length,expected=NP*(NP-1)*(NP-2)*(NP-3)/24;
if(errs||cols.k.length!==expected)throw new Error(`pre: ${cols.k.length} decks for ${expected} expected, ${errs} engine errors`);
const order=cols.k.map((_,i)=>i).sort((a,b)=>cols.s1[b]-cols.s1[a]);
const lostBy={};let lostErr=0;for(const p of chunks('lost')){const o=JP(p).res;lostErr+=o.err||0;o.k.forEach((k,j)=>lostBy[k]=o.L[j])}
if(lostErr)throw new Error('lost: '+lostErr+' engine errors');
const missingL=cols.k.filter(k=>!lostBy[k]).length;if(missingL)throw new Error('missing L for '+missingL);
const decks={k:order.map(i=>cols.k[i]).join(''),s1:order.map(i=>cols.s1[i]),s0:order.map(i=>cols.s0[i]),ttk:order.map(i=>cols.ttk[i]),
  m:[].concat(...order.map(i=>cols.m[i])),p1:order.map(i=>cols.p1[i]),dmg:[].concat(...order.map(i=>cols.dmg[i].slice(0,10).concat(Array(10).fill(0)).slice(0,10).map(x=>Math.round(x/10)))),plan:order.map(i=>cols.plan[i]),L:[].concat(...order.map(i=>lostBy[cols.k[i]]))};
// Global random sample (24,000 decks from the 127 cards), sorted scores
const glob=[];for(const f of fs.readdirSync(P.glob).filter(f=>/^g_(res_|old_)?\d+\.json$/.test(f))){JP(path.join(P.glob,f)).rows.forEach(r=>glob.push(Math.round(r[1])))}glob.sort((a,b)=>a-b);
if(!glob.length)throw new Error('no global sample g_*.json in '+P.glob);
// Shop simulations (Monte Carlo, 300 games, up to 2 rerolls) for a few decks: [mean, p10, mean with half crits]
const keyOfIx=ix=>{if(ix.some(x=>x<0))throw new Error('deck not in pool');return ix.slice().sort((a,b)=>a-b).map(x=>x.toString(32)).join('')};
const keyOf=names=>keyOfIx(names.map(n=>cards.findIndex(c=>c.name===n)));
const sims={};let meta;
if(V){
  for(const f of fs.readdirSync(P.app).filter(f=>/^mc_.+\.json$/.test(f))){const name=f.slice(3,-5),deckFile=path.join(D,'mcv2/deck_'+name+'.json');
    if(!fs.existsSync(deckFile))throw new Error('no '+deckFile+' for '+f);const r=JP(path.join(P.app,f)).res.reroll2;
    sims[keyOfIx(JP(deckFile).map(id=>pool.indexOf(id)))]=[r.x1.mean,r.x1.p10,r.x05.mean]}
  // Index 0 % = average random deck (baseline), 100 % = best deck (no talent): S>=90 %, A>=80 %, B>=70 %, C>=50 % (wiki rule).
  const nt=model.noTalent,th=q=>Math.round(nt.baseline+q*(nt.best-nt.baseline));
  // Best deck shown = best of the wiki deck tier list as scored here (meta_eval.json), else the best pool deck.
  let bestDeck;const me=path.join(P.app,'meta_eval.json');const nameOf=n=>(model.cards.find(c=>c.number===n)||{name:'#'+n}).name;
  if(fs.existsSync(me)){const b=JP(me).rows.filter(r=>r.s1!=null).sort((a,b)=>b.s1-a.s1)[0];if(b)bestDeck={names:b.d.map(nameOf),score:Math.round(b.s1)}}
  if(!bestDeck){const i=order[0];bestDeck={names:cols.k[i].split('').map(c=>cards[parseInt(c,32)].name),score:cols.s1[i]}}
  meta={game:model.version,built:new Date().toISOString().slice(0,10),baseline:nt.baseline,best:nt.best,tiers:[['S',th(.9)],['A',th(.8)],['B',th(.7)],['C',th(.5)]],
    // L method: absorb-death (card absorbed at the start of turn 1: it dies, bounty + on-death effects, no revival),
    // absorb (removed without dying, until 2026-10-09) or dead-card (a 1-HP placeholder that dies at the first enemy hit)
    lostMethod:fs.existsSync(path.join(P.app,'lost_method.txt'))?fs.readFileSync(path.join(P.app,'lost_method.txt'),'utf8').trim():'dead-card',
    bestDeck,nOwn:NOWN,mu:['neutral','fragile','tank','anti-fire','anti-water','anti-earth','anti-nature','anti-shadow','anti-light']};
}else{
  sims[keyOf(['Lame de la forêt','Chimère Brasse-chair',"L'Œil des montagnes",'Keria'])]=[9393,8935,8197];
  sims[keyOf(['Hibernatus','Chimère Brasse-chair','Hippocampe Nimbé','Keria'])]=[8644,8137,8378];
  sims[keyOf(['Hibernatus','Chimère Brasse-chair',"L'Œil des montagnes",'Keria'])]=[8576,7953,7979];
  sims[keyOf(['Murmures du Corail Noir','Prisonnière de la Machine','Hibernatus','Scorch, les Lézards Ignés'])]=[8416,7915,8398];
  meta={game:'1.20',built:'2026-10-09',baseline:4714.7,best:15336.6,tiers:[['S',14274],['A',13212],['B',12150],['C',10026]],
    bestDeck:{names:["Souverain des Chutes d'Éther",'Aleera Mange-Cauchemars','Squall, Émissaire des cauchemars','Paguroniyx'],score:15337},nOwn:NOWN,
    mu:['neutral','fragile','tank','anti-fire','anti-water','anti-earth','anti-nature','anti-shadow','anti-light']};
}
const data={meta,cards,tox:T,decks,global:glob,sims};
fs.writeFileSync(OUT,JSON.stringify(data));
console.log('version',meta.game,'cards',cards.length,'tox',Object.keys(T).length,'tox without text',Object.values(T).filter(t=>!t[3]).map(t=>t[0]+t[1]).join(','),'decks',order.length,'global',glob.length,'sims',Object.keys(sims).length,'bytes',fs.statSync(OUT).size);
