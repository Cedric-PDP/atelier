// Extract and deserialize Astro island props (Rankings component) from an HTML file.
const fs=require('fs');
const [file,out]=process.argv.slice(2);
const h=fs.readFileSync(file,'utf8');
const re=/<astro-island[^>]*component-url="([^"]*)"[^>]*props="([^"]*)"/g;
const unesc=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function de(v){ // astro serialized value
  if(!Array.isArray(v)) { if(v&&typeof v==='object'){const o={};for(const k in v)o[k]=de(v[k]);return o;} return v; }
  const [t,val]=v;
  if(t===0){ if(val&&typeof val==='object'&&!Array.isArray(val)){const o={};for(const k in val)o[k]=de(val[k]);return o;} return val; }
  if(t===1) return val.map(de);
  if(t===4) return new Map(val.map(([k,x])=>[de(k),de(x)]));
  if(t===5) return val.map(de);
  return val;
}
const res={};let m;
while((m=re.exec(h))){const url=m[1];const p=JSON.parse(unesc(m[2]));const o={};for(const k in p)o[k]=de(p[k]);res[url]=o;}
fs.writeFileSync(out,JSON.stringify(res));
for(const u in res){console.log(u,Object.keys(res[u]).map(k=>k+':'+(Array.isArray(res[u][k])?'arr'+res[u][k].length:typeof res[u][k])).join(' '));}
