// Minimal string/template/regex-aware pretty printer (node built-ins only). Output is for READING only.
const fs=require('fs');
const src=fs.readFileSync(process.argv[2],'utf8');
let out='',ind=0,i=0;const N=src.length;
const BS=String.fromCharCode(92);
const tstack=[]; // template nesting: brace depth at which a ${ was opened
let braceDepth=0;
const parenStack=[]; // paren depth per brace level
let paren=0;
let lastSig='';
function nl(){out+='\n'+'  '.repeat(Math.max(0,ind));}
while(i<N){
  const c=src[i];
  if(c==='"'||c==="'"){let j=i+1;while(j<N&&src[j]!==c){if(src[j]===BS)j++;j++;}out+=src.slice(i,j+1);i=j+1;lastSig='a';continue;}
  if(c==='`'||(c==='}'&&tstack.length&&tstack[tstack.length-1]===braceDepth)){
    if(c==='}'){tstack.pop();}
    let j=i+1;
    while(j<N){if(src[j]===BS){j+=2;continue;}if(src[j]==='`'){break;}if(src[j]==='$'&&src[j+1]==='{'){break;}j++;}
    if(src[j]==='`'){out+=src.slice(i,j+1);i=j+1;lastSig='a';continue;}
    out+=src.slice(i,j+2);i=j+2;tstack.push(braceDepth);lastSig='(';continue;
  }
  if(c==='/'&&src[i+1]==='*'){const j=src.indexOf('*/',i+2);out+=src.slice(i,j+2);i=j+2;continue;}
  if(c==='/'&&src[i+1]==='/'){const j=src.indexOf('\n',i);out+=src.slice(i,j<0?N:j);i=j<0?N:j;continue;}
  if(c==='/'&&('(,=:[!&|?{};+-*%<>~^'.includes(lastSig)||lastSig==='')){
    let j=i+1,inClass=false;
    while(j<N){if(src[j]===BS){j+=2;continue;}if(src[j]==='['){inClass=true}else if(src[j]===']'){inClass=false}else if(src[j]==='/'&&!inClass)break;j++;}
    j++;while(j<N&&/[a-z]/i.test(src[j]))j++;
    out+=src.slice(i,j);i=j;lastSig='a';continue;
  }
  if(c==='('){paren++;out+=c;i++;lastSig='(';continue;}
  if(c===')'){paren--;out+=c;i++;lastSig='a';continue;}
  if(c==='{'){braceDepth++;parenStack.push(paren);paren=0;out+='{';ind++;nl();i++;lastSig='{';continue;}
  if(c==='}'){braceDepth--;paren=parenStack.pop()||0;ind--;nl();out+='}';i++;lastSig='}';continue;}
  if(c===';'){out+=';';if(paren===0)nl();i++;lastSig=';';continue;}
  out+=c;if(!/\s/.test(c))lastSig=/[A-Za-z0-9_$\]]/.test(c)?'a':c;i++;
}
fs.writeFileSync(process.argv[3],out);
console.log('lines',out.split('\n').length);
