const fs=require('fs'),path=require('path');
const dir=process.argv[2];
const unesc=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#x27;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const decode=v=>{if(!Array.isArray(v))return v;const[t,x]=v;if(t===0){if(x&&typeof x==='object'&&!Array.isArray(x)){const o={};for(const k in x)o[k]=decode(x[k]);return o}return x}if(t===1)return x.map(decode);return x};
const out=[];
for(const f of fs.readdirSync(dir)){
  const h=fs.readFileSync(path.join(dir,f),'utf8');const re=/props="([^"]*)"/g;let m,best=null;
  while((m=re.exec(h))){if(m[1].includes('&quot;card&quot;')&&(!best||m[1].length>best.length))best=m[1]}
  const p=JSON.parse(unesc(best));out.push(decode(p.card));
}
fs.writeFileSync(process.argv[3],JSON.stringify(out,null,1));
console.log(out.length,'cards; keys:',Object.keys(out[0]).join(','));
