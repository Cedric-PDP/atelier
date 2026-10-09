// Regenerates the per-chunk drivers (drv_pre_*, drv_lost_*, drv_shop_*) from their chunk-0 template,
// re-embedding the current pool (spam/app/pool_order.json) and shop keys (spam/app/shop_keys.json).
// Usage: node scripts/app/gen_drivers.js <repoRoot> [pre|lost|shop ...]   (default: all three)
const fs=require('fs'),path=require('path');
const [root,...only]=process.argv.slice(2);if(!root)throw new Error('usage: gen_drivers.js <repoRoot> [pre|lost|shop]');
const APP=path.join(root,'scripts/app'),D=path.join(root,'spam/app');
const KINDS={pre:6,lost:20,shop:20};
const pool=fs.readFileSync(path.join(D,'pool_order.json'),'utf8').trim();
const keysFile=path.join(D,'shop_keys.json');
for(const kind of only.length?only:Object.keys(KINDS)){
  const n=KINDS[kind];if(!n)throw new Error('unknown kind '+kind);
  let t=fs.readFileSync(path.join(APP,`drv_${kind}_0.js`),'utf8');
  const swap=(name,json)=>{const re=new RegExp(`const ${name}=\\[[^\\]]*\\];`);if(!re.test(t))throw new Error(`${kind}: no ${name} array`);t=t.replace(re,()=>`const ${name}=${json};`)};
  swap('POOL',pool);
  if(kind==='shop')swap('KEYS',fs.readFileSync(keysFile,'utf8').trim());
  const ch=`const CH=0,NCH=${n}`;if(!t.includes(ch))throw new Error(`${kind}: no "${ch}"`);
  for(let i=0;i<n;i++)fs.writeFileSync(path.join(APP,`drv_${kind}_${i}.js`),t.replace(ch,`const CH=${i},NCH=${n}`));
  console.log(kind,n,'drivers');
}
