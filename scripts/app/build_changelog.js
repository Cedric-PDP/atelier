// Changelog of a game version against the previous one, for the player's decks and the meta, from the engine outputs.
// Writes in spam/versions/<ver>/:
//   scores.json    every pool deck of this version (card numbers + s1/s0): what the NEXT version compares against
//   global.json    the fixed 24,000-deck global sample scored by this version (s1 by sample index)
//   changelog.json what changed (cards, Tox, references, card impact, player's decks, wiki meta decks, notes)
//   CHANGELOG.md   the same, readable in the repo
//   revision.json  only when the wiki changed its ENGINE under the same game version (1.21 on 2026-10-09: same cards, new
//                  scoring): that revision's own effect on the same 24,000 decks, explained first in the notes, since
//                  every « prev → ver » gap then mixes the game patch and the new scoring. Versioned, so reruns keep it.
// and embeds the changelog in spam/versions/<ver>/data.json as data.changelog (+ prev scores aligned on data.decks so
// the page can show « 1.20 → 1.21 » on any deck). Without <prev> it only writes scores.json and global.json.
// Usage: node scripts/app/build_changelog.js <repoRoot>/spam <ver> [<prev>] [--rev-from=<dir>]
//   --rev-from  the previous engine revision of <ver>: <dir>/global.json + <dir>/js/model.json (e.g. `git show` of the
//               archived files). Without it, a revision is detected when the global.json about to be overwritten
//               carries another engineHash (archives carry it from 2026-10-09 on).
const fs=require('fs'),path=require('path');
const ARGS=process.argv.slice(2),[D,VER,PREV]=ARGS.filter(a=>!a.startsWith('--'));if(!VER)throw new Error('usage: build_changelog.js <spamDir> <ver> [<prev>] [--rev-from=<dir>]');
const REV_FROM=(ARGS.find(a=>a.startsWith('--rev-from='))||'').slice('--rev-from='.length);
const JP=p=>JSON.parse(fs.readFileSync(p,'utf8'));const W=(p,o)=>fs.writeFileSync(p,typeof o==='string'?o:JSON.stringify(o));
const V=path.join(D,'versions',VER),PV=PREV?path.join(D,'versions',PREV):null;
const data=JP(path.join(V,'data.json'));
const mCur=JP(path.join(V,'js/model.json')),HASH=mCur.engineHash;
const dkey=d=>d.slice().sort((a,b)=>a-b).join('-');
const poolNums=data.cards.map(c=>c.n);
const decksOf=dt=>{const k=dt.decks.k,n=k.length/4,out=new Array(n);for(let i=0;i<n;i++)out[i]=[0,1,2,3].map(j=>dt.cards[parseInt(k[4*i+j],32)].n);return out};
// ---- previous engine revision of this same version (read before the archives below are overwritten) ----
const gF=path.join(V,'global.json');let revFrom=null;
if(REV_FROM)revFrom={g:JP(path.join(REV_FROM,'global.json')).s1,m:JP(path.join(REV_FROM,'js/model.json'))};
else if(fs.existsSync(gF)){const g=JP(gF);if(g.engineHash&&g.engineHash!==HASH)revFrom={g:g.s1,m:{engineHash:g.engineHash,noTalent:g.noTalent}}}
if(revFrom&&revFrom.m.engineHash===HASH)throw new Error('--rev-from has the same engineHash as '+VER+': '+HASH);
// ---- this version's archives (always) ----
const newDecks=decksOf(data);
W(path.join(V,'scores.json'),{version:VER,engineHash:HASH,lostMethod:data.meta.lostMethod||'dead-card',d:newDecks.map(dkey),s1:data.decks.s1,s0:data.decks.s0});
const globalRows=dir=>{const s=[];for(const f of fs.readdirSync(dir).filter(f=>/^g_(res_|old_)?\d+\.json$/.test(f)))for(const r of JP(path.join(dir,f)).rows)s[r[0]]=r[1];return s};
const gNew=globalRows(path.join(V,'app'));W(gF,{version:VER,engineHash:HASH,noTalent:mCur.noTalent,s1:gNew});
if(!PREV){console.log('scores + global written for',VER,'(no previous version: no changelog)');process.exit(0)}

// ---- inputs of the previous version ----
const prevScores=JP(path.join(PV,'scores.json')),gOld=JP(path.join(PV,'global.json')).s1;
const prevBy=new Map();prevScores.d.forEach((k,i)=>prevBy.set(k,i));
const mNew=mCur,mOld=JP(path.join(PV,'js/model.json'));
const metaNew=JP(path.join(V,'app/meta_eval.json')).rows,metaOld=JP(path.join(V,'app/meta_eval_prev.json')).rows;
const listNew=JP(path.join(V,'meta_decks.json')).decks.map(dkey),listOld=fs.existsSync(path.join(PV,'meta_decks.json'))?JP(path.join(PV,'meta_decks.json')).decks.map(dkey):[];
const NOWN=data.meta.nOwn,own=new Set(poolNums.slice(0,NOWN)),wish=new Set(poolNums.slice(NOWN));
const byNum=m=>{const o={};m.cards.forEach(c=>o[c.number]=c);return o};const cNew=byNum(mNew),cOld=byNum(mOld);
const nameOf=n=>(cNew[n]||cOld[n]||{name:'#'+n}).name;const names=d=>d.map(nameOf);
const fmt=x=>Math.round(x).toLocaleString('fr-FR').replace(/ | /g,' ');
const pct=(a,b)=>a?100*(b-a)/a:0;const sp=x=>(x>=0?'+':'')+x.toFixed(1).replace('.',',')+' %';
const R1=x=>Math.round(x*10)/10;const ord=k=>k===1?'1er':k+'e';

// ---- cards: what really changed. Talent renames (« Coeur » → « Cœur ») are ignored; a text that changes while every
// engine field stays the same (rewording, e.g. « subit une attaque » → « subit une attaque adverse ») goes to textOnly.
const t=s=>String(s||'').replace(/\s*\n\s*/g,' · ').trim();
const sem=o=>JSON.stringify(o,(k,v)=>/^(text|name|desc|description|rawText|label)$/i.test(k)?undefined:v);
const cardChanges=[],textOnly=[];
for(const n of Object.keys(cNew).map(Number).sort((a,b)=>a-b)){const a=cOld[n],b=cNew[n];if(!a){cardChanges.push({n,name:b.name,added:true,changes:['nouvelle carte']});continue}
  const ch=[],tx=[];if(a.hp!==b.hp)ch.push(`PV ${fmt(a.hp)} → ${fmt(b.hp)}`);if(a.spamton!==b.spamton)ch.push(`Spamtons ${a.spamton} → ${b.spamton}`);
  for(const e of Object.keys(b.res||{}))if((a.res||{})[e]!==b.res[e])ch.push(`résistance ${e} ${(a.res||{})[e]??0} → ${b.res[e]} %`);
  const nab=Math.max(a.abilities.length,b.abilities.length);for(let i=0;i<nab;i++){const x=a.abilities[i],y=b.abilities[i];
    if(!x){ch.push(`nouvelle compétence ${y.name} : « ${t(y.text)} »`);continue}if(!y){ch.push(`compétence ${x.name} retirée`);continue}
    if(x.id!==y.id||x.name!==y.name)ch.push(`compétence ${x.name} remplacée par ${y.name} : « ${t(y.text)} » (avant : « ${t(x.text)} »)`);
    else if(t(x.text)!==t(y.text))(sem(x)!==sem(y)?ch:tx).push(`${y.name} : « ${t(x.text)} » → « ${t(y.text)} »`);
    if(x.cd!==y.cd)ch.push(`${y.name} : recharge ${x.cd} → ${y.cd}`);
    if(x.crit!==y.crit)ch.push(`${y.name} : chance de critique de base ${x.crit} % → ${y.crit} %`);
    if(JSON.stringify(x.cost||null)!==JSON.stringify(y.cost||null)&&t(x.text)===t(y.text))ch.push(`${y.name} : coût ${JSON.stringify(x.cost||null)} → ${JSON.stringify(y.cost||null)}`)}
  const npa=Math.max(a.passives.length,b.passives.length);for(let i=0;i<npa;i++){const x=a.passives[i],y=b.passives[i];
    if(!x){ch.push(`nouveau Tox de départ ${y.name}`);continue}if(!y){ch.push(`Tox de départ ${x.name} retiré`);continue}
    if(x.id!==y.id)ch.push(`Tox de départ ${x.name} remplacé par ${y.name} : « ${t(y.text)} »`);
    else if(x.value!==y.value)ch.push(`Tox de départ ${y.name} : valeur ${x.value} → ${y.value}`);
    else if(t(x.text)!==t(y.text))(sem(x)!==sem(y)?ch:tx).push(`Tox de départ ${y.name} : « ${t(x.text)} » → « ${t(y.text)} »`)}
  if(ch.length)cardChanges.push({n,name:b.name,own:own.has(n),wish:wish.has(n),changes:ch.concat(tx.map(x=>x+' (texte seulement)'))});
  else if(tx.length)textOnly.push({n,name:b.name,own:own.has(n),wish:wish.has(n),changes:tx})}
for(const n of Object.keys(cOld).map(Number))if(!cNew[n])cardChanges.push({n,name:cOld[n].name,removed:true,changes:['carte retirée']});

// ---- Tox (shop) ----
const toxNew=JP(path.join(V,'app/toxinfo.json')).tox,toxOldF=path.join(PV,'app/toxinfo.json');
const toxChanges=[];if(fs.existsSync(toxOldF)){const toxOld=JP(toxOldF).tox;for(const id of Object.keys(toxNew)){const a=toxOld[id],b=toxNew[id];const nm=(data.tox[id]||[id])[0]+' '+id.slice(-1);
  if(!a){toxChanges.push({id,name:nm,changes:['nouveau Tox']});continue}const ch=[];if(a.cost!==b.cost)ch.push(`coût ${a.cost} → ${b.cost}`);if(a.value!==b.value)ch.push(`valeur ${a.value} → ${b.value}`);if(ch.length)toxChanges.push({id,name:nm,changes:ch})}
  for(const id of Object.keys(toxOld))if(!toxNew[id])toxChanges.push({id,name:id,changes:['Tox retiré']})}

// ---- global sample: overall shift and card impact (same 24,000 decks before/after) ----
const gd=JP(path.join(D,'stats/global_decks.json'));const idNum={};mNew.cards.concat(mOld.cards).forEach(c=>idNum[c.id]=c.number);
const sorted=a=>a.filter(x=>x!=null).sort((x,y)=>x-y);const q=(s,p)=>s[Math.floor(p*(s.length-1))];
const so=sorted(gOld),sn=sorted(gNew);
// mean relative shift of the sample, and per card: mean shift of the decks playing it minus the overall mean
const shift=(gA,gB)=>{let sum=0,n=0;const per={};
  gd.decks.forEach((d,i)=>{const a=gA[i],b=gB[i];if(a==null||b==null||a<=0)return;const r=b/a-1;sum+=r;n++;
    for(const j of d){const k=idNum[gd.ids[j]];(per[k]=per[k]||{s:0,n:0});per[k].s+=r;per[k].n++}});
  const mean=sum/n;
  return {mean,impact:Object.entries(per).map(([k,o])=>({n:+k,name:nameOf(+k),own:own.has(+k),wish:wish.has(+k),d:R1(100*(o.s/o.n-mean)),decks:o.n})).sort((a,b)=>b.d-a.d)}};
const {mean:meanAll,impact}=shift(gOld,gNew);

// ---- wiki engine revision under the same version: its own effect (same decks, same cards, old → new scoring) ----
const revF=path.join(V,'revision.json');let revision=null;
if(revFrom){const s=shift(revFrom.g,gNew),p=shift(gOld,revFrom.g),sp0=sorted(revFrom.g),old=fs.existsSync(revF)?JP(revF):{};
  const src=fs.existsSync(path.join(V,'js/source.json'))?JP(path.join(V,'js/source.json')):{};
  const pick=x=>({n:x.n,name:x.name,d:x.d});
  // the owned card the patch moved most, to show how the new scoring rescales the per-card effect
  const ex=p.impact.filter(x=>x.own).sort((a,b)=>Math.abs(b.d)-Math.abs(a.d))[0];
  revision={version:VER,date:(src.fetched||new Date().toISOString()).slice(0,10),
    // `what` (what the wiki changed, read in the engine diff) is written by hand and kept across reruns
    what:old.from&&old.from.engineHash===revFrom.m.engineHash&&old.to&&old.to.engineHash===HASH?old.what:undefined,
    from:{engineHash:revFrom.m.engineHash,...revFrom.m.noTalent},to:{engineHash:HASH,...mCur.noTalent},
    meanDeltaPct:R1(100*s.mean),median:[q(sp0,.5),q(sn,.5)],
    patchOnlyPct:R1(100*p.mean),patchOnlyExample:ex?pick(ex):null,
    up:s.impact.slice(0,5).map(pick),down:s.impact.slice(-5).reverse().map(pick)};
  W(revF,JSON.stringify(revision,null,1))}
else if(fs.existsSync(revF)){const r=JP(revF);if(r.to&&r.to.engineHash===HASH)revision=r}

// ---- the player's decks (pool decks scored by both versions) ----
const rows=newDecks.map((d,i)=>{const j=prevBy.get(dkey(d));return {d,i,s1:data.decks.s1[i],s0:data.decks.s0[i],o1:j==null?null:prevScores.s1[j],o0:j==null?null:prevScores.s0[j]}});
const ownedRows=rows.filter(r=>r.d.every(n=>own.has(n)));ownedRows.forEach((r,k)=>r.ro=k);
const rankOld=new Map();ownedRows.filter(r=>r.o1!=null).slice().sort((a,b)=>b.o1-a.o1).forEach((r,k)=>rankOld.set(r.i,k+1));
const deckOut=(r,k)=>({d:r.d,names:names(r.d),s1:r.s1,o1:r.o1,s0:r.s0,o0:r.o0,rank:k==null?undefined:k+1,rankOld:rankOld.get(r.i)});
const top=ownedRows.slice(0,10).map(deckOut);
const bestOldRow=ownedRows.filter(r=>r.o1!=null).sort((a,b)=>b.o1-a.o1)[0];
const relevant=ownedRows.filter(r=>r.o1!=null&&(rankOld.get(r.i)<=300||r.ro<300));
const moves=relevant.map(r=>({...deckOut(r,r.ro),dp:R1(pct(r.o1,r.s1))}));
const risers=moves.slice().sort((a,b)=>b.dp-a.dp).slice(0,6),fallers=moves.slice().sort((a,b)=>a.dp-b.dp).slice(0,6);
const lowCritNew=ownedRows.slice().sort((a,b)=>b.s0-a.s0)[0],lowCritOld=ownedRows.filter(r=>r.o0!=null).sort((a,b)=>b.o0-a.o0)[0];
const savedF=path.join(D,'decks.json');const saved=[];
if(fs.existsSync(savedF)){const sv=JP(savedF);for(const s of (Array.isArray(sv)?sv:sv.decks||Object.values(sv))){const d=(s.cards||[]).map(Number);if(d.length!==4)continue;
  const r=rows.find(x=>dkey(x.d)===dkey(d));if(r)saved.push({name:s.name,...deckOut(r,r.ro??null)})}}

// ---- ban targets: the shop Tox the player's decks lean on most (each player bans one shop item, both see it) ----
// Reference decks = top 10 owned + top 5 owned without crits + saved decks, when shop.json has their plan.
// avg/max = score gained by the planned purchases of that Tox family (% of score, shop plan of build_shop), avg over
// ALL reference decks; an upper bound of the loss if the opponent bans it, since another Tox can partly fill the slot.
const shopF=path.join(V,'shop.json');let ban=null;
if(fs.existsSync(shopF)){const shop=JP(shopF);const refs=new Set();
  ownedRows.slice(0,10).forEach(r=>refs.add(r.i));ownedRows.slice().sort((a,b)=>b.s0-a.s0).slice(0,5).forEach(r=>refs.add(r.i));
  saved.forEach(s=>{const r=rows.find(x=>dkey(x.d)===dkey(s.d));if(r)refs.add(r.i)});
  const fam={};let n=0;
  for(const i of refs){const rec=shop[data.decks.k.substr(4*i,4)];if(!rec||rec.err||!rec.plan)continue;n++;const seen=new Set();
    for(const [turn,tid,,,g] of rec.plan){const f=tid.replace(/_[CREL]$/,'');const o=fam[f]=fam[f]||{f,name:(data.tox[tid]||[f])[0],decks:0,sum:0,max:0,first:[]};
      o.sum+=g||0;o.max=Math.max(o.max,g||0);if(!seen.has(f)){seen.add(f);o.decks++;o.first.push(turn)}}}
  const list=Object.values(fam).map(o=>({f:o.f,name:o.name,decks:o.decks,avg:R1(o.sum/n),max:R1(o.max),turn:Math.min(...o.first)})).sort((a,b)=>b.avg-a.avg);
  if(n)ban={decks:n,list:list.slice(0,8)}}

// ---- wiki meta decks, scored by both engines ----
const evN=new Map(metaNew.map(r=>[dkey(r.d),r])),evO=new Map(metaOld.map(r=>[dkey(r.d),r]));
const meta=[...new Set(listNew.concat(listOld))].map(k=>{const a=evO.get(k),b=evN.get(k),d=k.split('-').map(Number);
  return {d,names:names(d),rankNew:listNew.indexOf(k)+1||null,rankOld:listOld.indexOf(k)+1||null,o1:a&&a.s1!=null?a.s1:null,s1:b&&b.s1!=null?b.s1:null,
    o0:a&&a.s0!=null?a.s0:null,s0:b&&b.s0!=null?b.s0:null,owned:d.filter(n=>own.has(n)).length,dp:a&&b&&a.s1&&b.s1!=null?R1(pct(a.s1,b.s1)):null}}).sort((x,y)=>(y.s1??0)-(x.s1??0));
const metaMoves=meta.filter(m=>m.dp!=null);const metaTop=metaMoves.slice().sort((a,b)=>b.dp-a.dp)[0];

// ---- notes: the few things worth reading first ----
const nt0=mOld.noTalent,nt1=mNew.noTalent;const dn=d=>d.map(nameOf).join(' · ');
const notes=[];
if(revision){const r=revision,f=r.from,t=r.to,cards=a=>a.map(x=>`${x.name} (${sp(x.d)})`).join(', ');
  const day=new Date(r.date+'T12:00:00Z').toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'});
  notes.push(`Le wiki a révisé sa notation le ${day} sans que le jeu change (toujours la ${VER}, mêmes cartes)${r.what?` : ${r.what}`:''}. À elle seule, cette révision fait ${sp(r.meanDeltaPct)} en moyenne sur les mêmes 24 000 decks (deck moyen ${fmt(f.baseline)} → ${fmt(t.baseline)}, meilleur deck ${f.best===t.best?`inchangé à ${fmt(t.best)}`:`${fmt(f.best)} → ${fmt(t.best)}`}). Les écarts ${PREV} → ${VER} de cette page (repères, tes decks, méta, effet par carte) mêlent donc le patch du jeu et cette révision ; le patch seul, mesuré avec l'ancienne notation, faisait ${sp(r.patchOnlyPct)} sur ces mêmes decks (deck moyen ${fmt(nt0.baseline)} → ${fmt(f.baseline)}).`);
  // per-card effect: still the patch's when the revision alone hardly moves any card around the mean
  const maxAbs=Math.max(Math.abs(r.up[0]?.d??0),Math.abs(r.down[0]?.d??0)),ex=r.patchOnlyExample,exNow=ex&&impact.find(x=>x.n===ex.n);
  notes.push(maxAbs<=5?`Effet par carte : à jeu égal, la nouvelle notation ne déplace aucune carte de plus de ${maxAbs.toFixed(1).replace('.',',')} % autour de la moyenne (${[r.down[0],r.up[0]].map(x=>`${x.name} ${sp(x.d)}`).join(', ')}). L'« effet » affiché reste donc celui du patch, seulement réduit avec l'ensemble des scores${exNow?` (${ex.name} : ${sp(exNow.d)}, contre ${sp(ex.d)} avec l'ancienne notation)`:''}.`
    :`Effet par carte : à jeu égal, la nouvelle notation déplace aussi les cartes (en hausse ${cards(r.up.slice(0,3))} ; en baisse ${cards(r.down.slice(0,3))}) : l'« effet » affiché mêle le patch et la révision.`)}
notes.push(`Repères du modèle (sans talent) : deck moyen ${fmt(nt0.baseline)} → ${fmt(nt1.baseline)} (${sp(pct(nt0.baseline,nt1.baseline))}), meilleur deck ${fmt(nt0.best)} → ${fmt(nt1.best)} (${sp(pct(nt0.best,nt1.best))}). Les paliers S/A/B/C bougent avec eux.`);
notes.push(`Sur les mêmes 24 000 decks aléatoires, le score moyen évolue de ${sp(100*meanAll)} (médiane ${fmt(q(so,.5))} → ${fmt(q(sn,.5))}).`);
const ownChanged=cardChanges.filter(c=>c.own);if(ownChanged.length)notes.push(`${ownChanged.length} carte${ownChanged.length>1?'s':''} de ta collection modifiée${ownChanged.length>1?'s':''} : ${ownChanged.map(c=>{const im=impact.find(x=>x.n===c.n);return c.name+(im?` (${sp(im.d)})`:'')}).join(', ')} — entre parenthèses, l'effet moyen sur les decks qui la jouent, comparé au reste du jeu.`);
if(bestOldRow){const b=ownedRows[0];notes.push(dkey(b.d)===dkey(bestOldRow.d)?`Ton meilleur deck reste ${dn(b.d)} : ${fmt(b.o1)} → ${fmt(b.s1)}.`
  :`Ton meilleur deck change : ${dn(b.d)} (${fmt(b.s1)}, ${rankOld.get(b.i)?ord(rankOld.get(b.i))+' avant':'nouveau'}) passe devant ${dn(bestOldRow.d)} (${fmt(bestOldRow.o1)} → ${fmt(bestOldRow.s1)}).`)}
if(lowCritNew&&lowCritOld)notes.push(dkey(lowCritNew.d)===dkey(lowCritOld.d)?`Sans critiques, ton meilleur deck reste ${dn(lowCritNew.d)} : ${fmt(lowCritNew.o0)} → ${fmt(lowCritNew.s0)}.`
  :`Sans critiques, ton meilleur deck devient ${dn(lowCritNew.d)} (${fmt(lowCritNew.s0)}), devant ${dn(lowCritOld.d)} (${fmt(lowCritOld.o0)} → ${fmt(lowCritOld.s0)}).`);
for(const s of saved)notes.push(`Deck sauvegardé « ${s.name} » : ${fmt(s.o1)} → ${fmt(s.s1)} (${sp(pct(s.o1,s.s1))})${s.rankOld&&s.rank?`, ${ord(s.rankOld)} → ${ord(s.rank)} de ta collection`:''}.`);
if(risers[0]&&risers[0].dp>0)notes.push(`Plus forte hausse parmi tes bons decks : ${risers[0].names.join(' · ')} (${sp(risers[0].dp)}).`);
const entered=meta.filter(m=>m.rankNew&&!m.rankOld).length,left=meta.filter(m=>m.rankOld&&!m.rankNew).length;
notes.push(`Méta du wiki : ${listNew.length} decks dans la tier list ${VER}, dont ${entered} nouveaux ; ${left} decks de la ${PREV} en sortent.${metaTop&&metaTop.dp>0?` Plus forte hausse : ${dn(metaTop.d)} (${sp(metaTop.dp)}).`:''}`);
// How the « sans sa carte clé » score (L, meta.lostMethod) is measured, said once when it differs from the previous version's.
const lmOld=prevScores.lostMethod||'dead-card',lmNew=data.meta.lostMethod||'dead-card';
const LOST_NOTE={
  'absorb-death':`Mesure « sans sa carte clé » : la carte est absorbée au tour 1 et elle meurt, comme dans le replay du 9 octobre. Tu touches donc la prime de 50 Spamtons et les effets à la mort de tes autres cartes se déclenchent (Vengeur de Dragon Ciel, Cimetière), mais la carte ne revient pas (ni Phénix, ni Résurrection).`,
  'absorb':`Mesure « sans sa carte clé » : la carte est retirée au tour 1 sans mourir (ni prime de 50 Spamtons, ni effets à la mort).`,
  'dead-card':`Mesure « sans sa carte clé » : une fausse carte de 1 PV joue à la place de la carte et meurt au premier coup adverse (pas de moteur d'absorption pour la ${VER}) ; les effets à la mort (Vengeur, Cimetière) arrivent donc un peu plus tard que pour une absorption au tour 1.`};
if(lmOld!==lmNew)notes.push(LOST_NOTE[lmNew]||`Mesure « sans sa carte clé » : méthode ${lmNew}.`);
if(toxChanges.length)notes.push(`Boutique : ${toxChanges.map(x=>x.name+' ('+x.changes.join(', ')+')').join(' ; ')}.`);
if(ban)notes.push(`Tox que l'adversaire a intérêt à bannir contre toi : ${ban.list.slice(0,3).map(x=>`${x.name} (acheté dans ${x.decks} de tes ${ban.decks} decks de référence, jusqu'à +${String(x.max).replace('.',',')} % de score)`).join(', ')}.`);

const changelog={from:PREV,to:VER,built:new Date().toISOString().slice(0,10),
  refs:{baseline:[nt0.baseline,nt1.baseline],best:[nt0.best,nt1.best]},
  global:{median:[q(so,.5),q(sn,.5)],p90:[q(so,.9),q(sn,.9)],meanDeltaPct:R1(100*meanAll)},
  revision,notes,cards:cardChanges,textOnly,tox:toxChanges,impact,ban,
  mine:{top,risers,fallers,saved,lowCrit:lowCritNew?{new:deckOut(lowCritNew,lowCritNew.ro),old:lowCritOld?deckOut(lowCritOld,lowCritOld.ro):null}:null},
  meta};
W(path.join(V,'changelog.json'),JSON.stringify(changelog,null,1));
data.changelog={...changelog,prev:{s1:rows.map(r=>r.o1),s0:rows.map(r=>r.o0)}};W(path.join(V,'data.json'),data);

// ---- CHANGELOG.md ----
const L=[];const deckLine=r=>`${r.names.join(' · ')} — ${r.o1!=null?fmt(r.o1)+' → ':''}${fmt(r.s1)}${r.o1!=null?` (${sp(pct(r.o1,r.s1))})`:''}`;
L.push(`# SPAM ${PREV} → ${VER}`,'',`Calculé le ${changelog.built} avec le moteur du wiki (scores sans talent, sans boutique).`,'','## À retenir','',...notes.map(n=>'- '+n),'');
L.push('## Tes decks','','Top 10 de ta collection en '+VER+' :','',...top.map(r=>`${r.rank}. ${deckLine(r)}${r.rankOld?` — ${ord(r.rankOld)} avant`:''}`),'');
if(risers.length)L.push('Plus fortes hausses (parmi tes 300 meilleurs decks) :','',...risers.map(r=>'- '+deckLine(r)),'');
if(fallers.length)L.push('Plus fortes baisses :','',...fallers.map(r=>'- '+deckLine(r)),'');
L.push('## Cartes modifiées','',...cardChanges.map(c=>`- **${c.name}** (#${c.n})${c.own?' — dans ta collection':c.wish?' — dans ta liste de souhaits':''} : ${c.changes.join(' ; ')}`),'');
if(textOnly.length)L.push(`Textes reformulés, sans changement dans le moteur (${textOnly.length} cartes) : ${textOnly.map(c=>c.name+(c.own?' (à toi)':'')).join(', ')}. Exemple : ${textOnly[0].changes[0]}.`,'');
if(toxChanges.length)L.push('## Tox','',...toxChanges.map(x=>`- ${x.name} : ${x.changes.join(', ')}`),'');
if(ban)L.push('## Cibles de ban (boutique)','',`Chaque joueur bannit un Tox de la boutique. Tox dont dépendent tes ${ban.decks} decks de référence (top 10, top 5 sans critiques, decks sauvegardés). Gain = part du score apportée par ses achats dans le plan de boutique, en moyenne sur ces ${ban.decks} decks : c'est un maximum, un autre Tox peut en compenser une partie s'il est banni.`,'',
  '| Tox | Decks qui l\'achètent | Gain moyen | Gain max | 1er achat |','|---|---|---|---|---|',...ban.list.map(x=>`| ${x.name} | ${x.decks}/${ban.decks} | +${x.avg} % | +${x.max} % | tour ${x.turn} |`),'');
L.push('## Impact par carte','',`Écart moyen des decks qui jouent la carte, comparé à l'évolution moyenne (${sp(100*meanAll)}), sur les mêmes 24 000 decks aléatoires.`,'',
  'Hausses : '+impact.slice(0,8).map(x=>`${x.name} ${sp(x.d)}`).join(', ')+'.','','Baisses : '+impact.slice(-8).reverse().map(x=>`${x.name} ${sp(x.d)}`).join(', ')+'.','');
L.push('## Méta (tier list du wiki)','','| Deck | Rang '+PREV+' | Rang '+VER+' | Score '+PREV+' | Score '+VER+' | Tes cartes |','|---|---|---|---|---|---|',
  ...meta.map(m=>`| ${m.names.join(' · ')} | ${m.rankOld||'—'} | ${m.rankNew||'—'} | ${m.o1!=null?fmt(m.o1):'—'} | ${m.s1!=null?fmt(m.s1):'—'} | ${m.owned}/4 |`),'');
W(path.join(V,'CHANGELOG.md'),L.join('\n'));
console.log('changelog',PREV,'->',VER,'cards',cardChanges.length,'tox',toxChanges.length,'meta',meta.length,'notes',notes.length,'data.json',fs.statSync(path.join(V,'data.json')).size);
