const a=require(process.argv[2]), b=require(process.argv[3]);
const norm=s=>String(JSON.stringify(s)).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\s\u00a0\u202f]/g,'').replace(/[’']/g,"'").toLowerCase();
const byNum=m=>Object.fromEntries(m.cards.map(c=>[c.number,c]));
const A=byNum(a), B=byNum(b);
const out=[];
function cmp(path,x,y,d){
  if(norm(x)===norm(y)) return;
  if(x&&y&&typeof x==='object'&&typeof y==='object'&&!Array.isArray(x)&&!Array.isArray(y)){ for(const k of new Set([...Object.keys(x),...Object.keys(y)])) cmp(path+'.'+k,x[k],y[k],d); return; }
  if(Array.isArray(x)&&Array.isArray(y)&&x.length===y.length){ x.forEach((v,i)=>cmp(path+'['+i+']',v,y[i],d)); return; }
  d.push(`${path}: ${JSON.stringify(x)} -> ${JSON.stringify(y)}`);
}
for(const n of Object.keys(A).map(Number).sort((x,y)=>x-y)){
  const x=JSON.parse(JSON.stringify(A[n])), y=JSON.parse(JSON.stringify(B[n]));
  for(const z of [x,y]){ delete z.artwork; delete z.lore; delete z.rawSkills; delete z.warnings; }
  const d=[]; cmp('',x,y,d);
  if(d.length) out.push(`#${n} ${A[n].name}\n   `+d.join('\n   '));
}
console.log(out.join('\n'));
