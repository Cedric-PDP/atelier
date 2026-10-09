// Decode the Astro island props of the wiki /tox/ page into plain JSON.
const fs=require("fs");
function dec(v){ // astro serialization: [type, value]
  if(!Array.isArray(v)) { if(v&&typeof v==="object"){const o={};for(const k in v)o[k]=dec(v[k]);return o;} return v; }
  const [t,val]=v;
  if(t===0){ if(val&&typeof val==="object"&&!Array.isArray(val)){const o={};for(const k in val)o[k]=dec(val[k]);return o;} return val; }
  if(t===1) return val.map(dec);
  return val;
}
for(const lang of ["en","fr"]){
  const s=fs.readFileSync(process.argv[2]+"/tox_"+lang+".html","utf8");
  const re=/<astro-island[^>]*component-url="[^"]*ToxBrowser[^"]*"[^>]*props="([^"]*)"/;
  const m=s.match(re); if(!m){console.log("no island",lang);continue;}
  const raw=m[1].replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");
  const props=JSON.parse(raw); const o={}; for(const k in props) o[k]=dec(props[k]);
  fs.writeFileSync(process.argv[2]+"/tox_"+lang+"_props.json",JSON.stringify(o,null,1));
  console.log(lang,Object.keys(o),o.tox.length);
}
