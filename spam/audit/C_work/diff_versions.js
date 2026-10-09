const a=require(process.argv[2]), b=require(process.argv[3]);
const byNum=m=>Object.fromEntries(m.cards.map(c=>[c.number,c]));
const A=byNum(a), B=byNum(b);
const out=[];
const strip=o=>{const x=JSON.parse(JSON.stringify(o)); return x;};
for(const n of Object.keys(A).map(Number).sort((x,y)=>x-y)){
  const x=A[n], y=B[n]; if(!y){out.push(`#${n} MISSING in v1.21`);continue;}
  const d=[];
  for(const k of ['name','element','rarity','spamton','hp','rows']) if(JSON.stringify(x[k])!==JSON.stringify(y[k])) d.push(`${k}: ${JSON.stringify(x[k])} -> ${JSON.stringify(y[k])}`);
  if(JSON.stringify(x.res)!==JSON.stringify(y.res)) d.push(`res: ${JSON.stringify(x.res)} -> ${JSON.stringify(y.res)}`);
  const an=x.abilities.map(z=>z.name).join(','), bn=y.abilities.map(z=>z.name).join(',');
  if(an!==bn) d.push(`abilities: [${an}] -> [${bn}]`);
  for(const ab of x.abilities){ const ob=y.abilities.find(z=>z.id===ab.id||z.name===ab.name); if(!ob) continue;
    const fa=JSON.parse(JSON.stringify(ab)), fb=JSON.parse(JSON.stringify(ob));
    for(const k of Object.keys(Object.assign({},fa,fb))){ if(k==='options') continue; if(JSON.stringify(fa[k])!==JSON.stringify(fb[k])) d.push(`  ab ${ab.name}.${k}: ${JSON.stringify(fa[k])} -> ${JSON.stringify(fb[k])}`); }
    const oa=fa.options||[], obo=fb.options||[];
    for(let i=0;i<Math.max(oa.length,obo.length);i++){ const p=oa[i]||{}, q=obo[i]||{}; for(const k of Object.keys(Object.assign({},p,q))) if(JSON.stringify(p[k])!==JSON.stringify(q[k])) d.push(`  ab ${ab.name}.opt${i}.${k}: ${JSON.stringify(p[k])} -> ${JSON.stringify(q[k])}`);}
  }
  for(const ab of y.abilities){ if(!x.abilities.find(z=>z.id===ab.id||z.name===ab.name)) d.push(`  NEW ab ${ab.name}: cd=${ab.cd} ${JSON.stringify(ab.options.map(o=>({t:o.target,h:o.hits,he:o.heals,g:o.gen,e:o.effects,txt:o.text})))}`); }
  const pa=x.passives.map(p=>p.id+':'+p.text).join(' ; '), pb=y.passives.map(p=>p.id+':'+p.text).join(' ; ');
  if(pa!==pb) d.push(`passives: ${pa} -> ${pb}`);
  for(let i=0;i<3;i++){ const p=x.talents[i]||{}, q=y.talents[i]||{}; if(JSON.stringify(p)!==JSON.stringify(q)) d.push(`  talent${i+1}: ${JSON.stringify(p)} -> ${JSON.stringify(q)}`);}
  if(d.length) out.push(`#${n} ${x.name}\n  `+d.join('\n  '));
}
console.log(out.join('\n'));
