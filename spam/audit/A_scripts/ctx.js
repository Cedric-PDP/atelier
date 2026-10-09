// usage: node ctx.js <file> <regex> [radius=200] [max=20]
const fs=require('fs');const [,,f,re,rad='200',max='20']=process.argv;
const s=fs.readFileSync(f,'utf8');const r=new RegExp(re,'g');let m,n=0;
while((m=r.exec(s))&&n<+max){n++;const a=Math.max(0,m.index-+rad),b=Math.min(s.length,m.index+m[0].length+ +rad);
console.log(`--- @${m.index}\n`+s.slice(a,b));}
