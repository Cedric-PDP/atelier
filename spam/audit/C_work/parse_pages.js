const fs=require('fs'), path=require('path');
const dir=process.argv[2];
function strip(h){
  h=h.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ');
  h=h.replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/section|\/article|\/span)[^>]*>/gi,'\n');
  h=h.replace(/<[^>]+>/g,' ');
  h=h.replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#x27;/g,"'");
  return h.split('\n').map(l=>l.replace(/\s+/g,' ').trim()).filter(Boolean);
}
const out={};
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.html'))){
  const L=strip(fs.readFileSync(path.join(dir,f),'utf8'));
  const slug=f.replace('.html','');
  const hdr=L.find(l=>/^\d[\d,]* (HP|PV) \d+ Spamtons? \/ (turn|tour)$/.test(l));
  const i0=L.indexOf('Abilities')>=0?L.indexOf('Abilities'):L.indexOf('Compétences');
  let i1=L.indexOf('Starting Tox',i0); if(i1<0) i1=L.indexOf('Tox de départ',i0);
  let iT=L.indexOf('Talents',i0); let iR=L.indexOf('Resistances',i0); if(iR<0) iR=L.indexOf('Résistances',i0);
  const end = i1>0? i1 : (iT>0? iT : iR);
  const ab=[]; let cur=null;
  for(let i=i0+1;i<end;i++){
    const l=L[i];
    const m=l.match(/^(\d+) (turns?|tours?)$/);
    if(m){ cur={name:L[i-1],cd:+m[1],text:[]}; ab.push(cur); continue; }
    let a=l.match(/^(Accuracy|Précision) (\d+)\s?%$/); if(a&&cur){cur.prec=+a[2]; continue;}
    a=l.match(/^(Critical|Critique) (\d+)\s?%$/); if(a&&cur){cur.crit=+a[2]; continue;}
    if(cur){ if(L[i+1]&&/^(\d+) (turns?|tours?)$/.test(L[i+1])) continue; cur.text.push(l); }
  }
  const tox=[]; if(i1>0){ for(let i=i1+1;i<(iT>0?iT:iR);i+=3){ tox.push({name:L[i],rarity:L[i+1],text:L[i+2]}); } }
  const tal=[]; if(iT>0){ let i=iT+1; while(i<iR && tal.length<3){ const name=L[i]; let j=i+1; let rec=false; if(/^(Recommended|Conseillé)$/.test(L[j])){rec=true;j++;} const text=[]; while(j<iR && !/^Δ /.test(L[j])){ text.push(L[j]); j++; } tal.push({name,rec,text:text.join(' '),delta:L[j]}); i=j+1; } }
  out[slug]={hdr,abilities:ab.map(a=>({name:a.name,cd:a.cd,text:a.text.join(' | '),prec:a.prec,crit:a.crit})),tox,talents:tal};
}
fs.writeFileSync(process.argv[3],JSON.stringify(out,null,1));
console.log(Object.keys(out).length,'pages');
