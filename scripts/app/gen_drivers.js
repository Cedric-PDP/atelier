// Regenerates the per-chunk drivers (drv_pre_*, drv_lost_*, drv_shop_*) from their chunk-0 template,
// re-embedding the current pool (spam/app/pool_order.json) and shop keys (shop_keys.json).
// Usage: node scripts/app/gen_drivers.js <repoRoot> [pre|lost|lost:lostabs|shop ...] [--out=<dir>] [--keys=<shop_keys.json>] [--chunks=<n>]
//   defaults (1.20 layout): drivers in scripts/app/, keys spam/app/shop_keys.json, chunks pre 6 / lost 20 / shop 20.
//   recompute.sh <version> passes --out=spam/versions/<v>/drv --keys=spam/versions/<v>/app/shop_keys.json --chunks=N.
const fs=require('fs'),path=require('path');
const opt={},pos=[];for(const a of process.argv.slice(2)){const m=a.match(/^--(\w+)=(.*)$/);if(m)opt[m[1]]=m[2];else pos.push(a)}
const [root,...only]=pos;if(!root)throw new Error('usage: gen_drivers.js <repoRoot> [pre|lost|shop] [--out=dir] [--keys=file] [--chunks=n]');
const APP=path.join(root,'scripts/app'),D=path.join(root,'spam/app'),OUTD=opt.out||APP;
const KINDS=opt.chunks?{pre:+opt.chunks,lost:+opt.chunks,shop:+opt.chunks}:{pre:6,lost:20,shop:20};
fs.mkdirSync(OUTD,{recursive:true});
const pool=fs.readFileSync(path.join(D,'pool_order.json'),'utf8').trim();
const keysFile=opt.keys||path.join(D,'shop_keys.json');
// A kind can name its template: "lost:lostabs" writes drv_lost_<i>.js from drv_lostabs_0.js (L by absorb-death).
for(const spec of only.length?only:Object.keys(KINDS)){
  const [kind,tpl=kind]=spec.split(':');
  const n=KINDS[kind];if(!n)throw new Error('unknown kind '+kind);
  let t=fs.readFileSync(path.join(APP,`drv_${tpl}_0.js`),'utf8');
  const swap=(name,json)=>{const re=new RegExp(`const ${name}=\\[[^\\]]*\\];`);if(!re.test(t))throw new Error(`${kind}: no ${name} array`);t=t.replace(re,()=>`const ${name}=${json};`)};
  swap('POOL',pool);
  if(kind==='shop')swap('KEYS',fs.readFileSync(keysFile,'utf8').trim());
  const ch=(t.match(/const CH=0,NCH=\d+/)||[])[0];if(!ch)throw new Error(`${kind}: no "const CH=0,NCH=<n>"`);
  for(let i=0;i<n;i++)fs.writeFileSync(path.join(OUTD,`drv_${kind}_${i}.js`),t.replace(ch,`const CH=${i},NCH=${n}`));
  console.log(kind,n,'drivers',tpl!==kind?'(template '+tpl+')':'');
}
