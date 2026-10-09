// Merges the per-process shop analyses into one file keyed by deck key.
const fs=require('fs'),path=require('path');const [dir,out,n]=process.argv.slice(2);
const all={};let errs=0,files=0;for(let i=0;i<+n;i++){const f=path.join(dir,'shop_'+i+'.json');if(!fs.existsSync(f))continue;files++;const o=JSON.parse(fs.readFileSync(f,'utf8')).shop;for(const k in o){if(o[k].err)errs++;all[k]=o[k]}}
fs.writeFileSync(out,JSON.stringify(all));console.log('files',files,'decks',Object.keys(all).length,'errors',errs,'bytes',fs.statSync(out).size);
