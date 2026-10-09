// Assembles E1_stress.md from E1_stress.tpl.md + tables.md ({{Tk}} or {{Tk:N}} = table k, first N data rows)
const fs=require('fs');
const tables=fs.readFileSync(__dirname+'/tables.md','utf8');
const sec={};let cur=null;
for(const line of tables.split('\n')){const m=line.match(/^### (T\d+b?) /);if(m){cur=m[1];sec[cur]=[]}if(cur)sec[cur].push(line)}
let tpl=fs.readFileSync(__dirname+'/E1_stress.tpl.md','utf8');
tpl=tpl.replace(/\{\{(T\d+b?)(?::(\d+))?\}\}/g,(_,k,n)=>{
  const lines=sec[k];if(!lines)throw new Error('missing table '+k);
  let out=lines.slice();while(out.length&&out[out.length-1].trim()==='')out.pop();
  if(n){const hi=out.findIndex(l=>/^\|[-:|]+\|$/.test(l.replace(/\s/g,'')));if(hi>=0){out=out.slice(0,hi+1+(+n));out[0]=out[0]+' (first '+n+')';}}
  return out.join('\n');
});
fs.writeFileSync(__dirname+'/E1_stress.md',tpl);
console.log('E1_stress.md lines',tpl.split('\n').length,'chars',tpl.length);
