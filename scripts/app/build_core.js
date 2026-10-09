// Builds the core data file for the deck workshop page from precomputed engine outputs.
const fs=require('fs'),path=require('path');
const D=process.argv[2],OUT=process.argv[3];
const J=f=>JSON.parse(fs.readFileSync(path.join(D,f),'utf8'));
const model=J('js/model_crit1.json'),fr=J('cards_fr.json').cards,tox=J('toxinfo.json');
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
const txt={};fs.readFileSync(path.join(D,'v2/builder_fr.txt'),'utf8').split('\n').forEach(l=>{const m=dec(l).match(/^- (.+?) (Commune|Rare|Épique|Légendaire) · [^%]*% (.*)$/);if(m)txt[m[1]+'|'+RW[m[2]]]=m[3].trim()});
const T={};const pools=tox.pools;for(const rar of Object.keys(pools))for(const id of pools[rar]){const fam=id.replace(/_[CREL]$/,''),r=id.slice(-1);const name=FAM[fam]||fam;T[id]=[name,r,tox.tox[id].cost,txt[name+'|'+r]||'']}
// Also passives that exist on cards (ids like Life Steal_E) resolve through T when they are shop Tox.
// Decks
const cols={k:[],s1:[],s0:[],ttk:[],m:[],p1:[],dmg:[],plan:[]};
for(let i=0;i<6;i++){const o=J('app/pre_'+i+'.json').res;o.k.forEach((k,j)=>{cols.k.push(k);cols.s1.push(o.s1[j]);cols.s0.push(o.s0[j]);cols.ttk.push(o.ttk[j]);cols.m.push(o.m[j]);cols.p1.push(o.p1[j]);cols.dmg.push(o.dmg[j]);cols.plan.push(o.plan[j])})}
const order=cols.k.map((_,i)=>i).sort((a,b)=>cols.s1[b]-cols.s1[a]);
const lostBy={};for(let i=0;i<20;i++){const p=path.join(D,'app/lost_'+i+'.json');if(!fs.existsSync(p))throw new Error('missing '+p);const o=JSON.parse(fs.readFileSync(p,'utf8')).res;o.k.forEach((k,j)=>lostBy[k]=o.L[j])}
const missingL=cols.k.filter(k=>!lostBy[k]).length;if(missingL)throw new Error('missing L for '+missingL);
const decks={k:order.map(i=>cols.k[i]).join(''),s1:order.map(i=>cols.s1[i]),s0:order.map(i=>cols.s0[i]),ttk:order.map(i=>cols.ttk[i]),
  m:[].concat(...order.map(i=>cols.m[i])),p1:order.map(i=>cols.p1[i]),dmg:[].concat(...order.map(i=>cols.dmg[i].slice(0,10).concat(Array(10).fill(0)).slice(0,10).map(x=>Math.round(x/10)))),plan:order.map(i=>cols.plan[i]),L:[].concat(...order.map(i=>lostBy[cols.k[i]]))};
// Global random sample (24,000 decks from the 127 cards), sorted scores
const glob=[];for(let i=0;i<6;i++){const o=J('stats/g_res_'+i+'.json');o.rows.forEach(r=>glob.push(Math.round(r[1])))}glob.sort((a,b)=>a-b);
// Shop simulations (Monte Carlo, 300 games, up to 2 rerolls) for a few decks
const keyOf=names=>{const ix=names.map(n=>cards.findIndex(c=>c.name===n));if(ix.some(x=>x<0))throw new Error('missing '+names);return ix.sort((a,b)=>a-b).map(x=>x.toString(32)).join('')};
const sims={};
sims[keyOf(['Lame de la forêt','Chimère Brasse-chair',"L'Œil des montagnes",'Keria'])]=[9393,8935,8197];
sims[keyOf(['Hibernatus','Chimère Brasse-chair','Hippocampe Nimbé','Keria'])]=[8644,8137,8378];
sims[keyOf(['Hibernatus','Chimère Brasse-chair',"L'Œil des montagnes",'Keria'])]=[8576,7953,7979];
sims[keyOf(['Murmures du Corail Noir','Prisonnière de la Machine','Hibernatus','Scorch, les Lézards Ignés'])]=[8416,7915,8398];
const data={meta:{game:'1.20',built:'2026-10-09',baseline:4714.7,best:15336.6,tiers:[['S',14274],['A',13212],['B',12150],['C',10026]],
  bestDeck:{names:["Souverain des Chutes d'Éther",'Aleera Mange-Cauchemars','Squall, Émissaire des cauchemars','Paguroniyx'],score:15337},nOwn:NOWN,
  mu:['neutral','fragile','tank','anti-fire','anti-water','anti-earth','anti-nature','anti-shadow','anti-light']},cards,tox:T,decks,global:glob,sims};
fs.writeFileSync(OUT,JSON.stringify(data));
console.log('cards',cards.length,'tox',Object.keys(T).length,'tox without text',Object.values(T).filter(t=>!t[3]).map(t=>t[0]+t[1]).join(','),'decks',order.length,'global',glob.length,'bytes',fs.statSync(OUT).size);
