// Rebuilds ref/cards.json + ref/cards_fr.txt from a spamgame-wiki model-*.json (all cards, FR names).
// Inputs kept in ref/: names_fr_en.txt (n|fr|en|...), collection.txt (owned card numbers).
// Usage: node build_ref.js <model.json> [builder_fr.txt]  — the optional builder page text refreshes ref/tox.json texts.
const fs=require('fs'),path=require('path');
const REF=path.join(__dirname,'..','ref');const model=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const own=new Set(fs.readFileSync(path.join(REF,'collection.txt'),'utf8').trim().split(/\s+/).map(Number));
const en={};fs.readFileSync(path.join(REF,'names_fr_en.txt'),'utf8').trim().split('\n').forEach(l=>{const p=l.trim().split('|');en[+p[0]]=p[2]});
const ELS=['fire','water','earth','nature','light','shadow'];
const clean=s=>String(s||'').replace(/\s*\n\s*/g,' · ').trim();
const cards=model.cards.map(c=>({n:c.number,name:c.name,en:en[c.number]||'',el:c.element,rar:c.rarity,hp:c.hp,spt:c.spamton,own:own.has(c.number)?1:0,
  res:ELS.map(e=>c.res?c.res[e]??0:0),ab:c.abilities.map(a=>[a.name,a.cd,clean(a.text),a.crit?a.critMult:0]),
  pa:c.passives.map(p=>[p.name,p.rarity,clean(p.text)]),tal:(c.talents||[]).map(t=>[t.slot,t.name,clean(t.text)])})).sort((a,b)=>a.n-b.n);
fs.writeFileSync(path.join(REF,'cards.json'),JSON.stringify({game:model.version,built:new Date().toISOString().slice(0,10),els:ELS,cards}));
const EL={fire:'Feu',water:'Eau',earth:'Terre',nature:'Nature',light:'Lumière',shadow:'Ombre',divine:'Divin'};
fs.writeFileSync(path.join(REF,'cards_fr.txt'),cards.map(c=>`#${c.n} ${c.name} (${c.en}) — ${EL[c.el]||c.el} ${c.rar}, ${c.hp} PV, ${c.spt} Sp/tour${c.own?' [À MOI]':''}\n  rés ${ELS.map((e,i)=>EL[e]+' '+c.res[i]).join(' / ')}\n`+
  c.ab.map(a=>`  ACT ${a[0]} (recharge ${a[1]}${a[3]?', crit x'+a[3]:''}) : ${a[2]}`).join('\n')+(c.pa.length?'\n'+c.pa.map(p=>`  PAS ${p[0]} (${p[1]}) : ${p[2]}`).join('\n'):'')+
  (c.tal.length?'\n'+c.tal.map(t=>`  TAL${t[0]} ${t[1]} : ${t[2]}`).join('\n'):'')).join('\n\n')+'\n');
console.log('version',model.version,'cards',cards.length,'owned',cards.filter(c=>c.own).length,'missing EN',cards.filter(c=>!c.en).length);

// Optional: refresh Tox texts (ids and costs unchanged) from the wiki builder page of the same version.
if(process.argv[3]){
  const t=JSON.parse(fs.readFileSync(path.join(REF,'tox.json'),'utf8'));
  const RW={Commune:'C',Rare:'R','Épique':'E','Légendaire':'L'};const dec=s=>s.replace(/&#x27;/g,"'").replace(/&quot;/g,'"').replace(/&amp;/g,'&');
  const txt={};fs.readFileSync(process.argv[3],'utf8').split('\n').forEach(l=>{const m=dec(l).match(/^- (.+?) (Commune|Rare|Épique|Légendaire) · [^%]*% (.*)$/);if(m)txt[m[1]+'|'+RW[m[2]]]=m[3].trim()});
  let changed=0;const missing=[];for(const [id,x] of Object.entries(t)){const k=x.name+'|'+x.rar;if(!txt[k]){missing.push(id);continue}if(txt[k]!==x.text){x.text=txt[k];changed++}}
  fs.writeFileSync(path.join(REF,'tox.json'),JSON.stringify(t,null,1));
  console.log('tox texts changed',changed,'missing',missing.join(',')||'none');
}
