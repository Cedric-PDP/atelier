const fs=require('fs');const [a,b]=process.argv.slice(2);
const norm=s=>s.replace(/(^|[^.\w$])([A-Za-z_$][\w$]{0,2})(?![\w$])/g,(m,p,id)=>{const kw=new Set(['let','var','new','for','if','in','of','do','try','NaN']);return p+(kw.has(id)?id:'§')});
fs.writeFileSync(b,fs.readFileSync(a,'utf8').split('\n').map(norm).join('\n'));
