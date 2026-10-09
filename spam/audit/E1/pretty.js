// Pretty-printer using node's internal acorn tokenizer (run with --expose-internals).
// Only inserts whitespace (newlines + indentation) between tokens: semantics preserved
// except for restricted productions, which we never split (we only break after ; { and before/after }).
const fs=require('fs');
const acorn=require('internal/deps/acorn/acorn/dist/acorn');
const [inF,outF]=process.argv.slice(2);
const src=fs.readFileSync(inF,'utf8');
const toks=[...acorn.tokenizer(src,{ecmaVersion:'latest',sourceType:'script'})];
let out='',depth=0,paren=0,prevEnd=0,atLineStart=true;
const tt=acorn.tokTypes;
const parenStack=[];
function nl(){out+='\n'+'  '.repeat(Math.max(0,depth));atLineStart=true;}
for(let i=0;i<toks.length;i++){
  const t=toks[i];
  const gap=src.slice(prevEnd,t.start);
  // keep original gap (whitespace/comments) unless we just emitted a newline
  if(!atLineStart) out+=gap; else out+=gap.replace(/^\s+/,'');
  const text=src.slice(t.start,t.end);
  if(t.type===tt.braceR){depth--; if(!atLineStart) nl(); out+=text; atLineStart=false;
    const nx=toks[i+1];
    if(nx && paren===0 && !(nx.type===tt.parenR||nx.type===tt.comma||nx.type===tt.semi||nx.type===tt.bracketR||nx.type===tt.parenL||nx.type===tt.dot||nx.type===tt.braceR||nx.type===tt.backQuote||nx.type===tt.template||nx.type===tt._else||nx.type===tt._catch||nx.type===tt._finally||nx.type===tt._while||nx.type===tt.colon||nx.type===tt.question||nx.type===tt.eof) ) nl();
  }
  else if(t.type===tt.braceL||t.type===tt.dollarBraceL){out+=text;depth++; if(t.type===tt.braceL) nl(); else atLineStart=false;}
  else if(t.type===tt.parenL){out+=text;paren++;atLineStart=false;}
  else if(t.type===tt.parenR){out+=text;paren--;atLineStart=false;}
  else if(t.type===tt.semi){out+=text; if(paren<=0) nl(); else atLineStart=false;}
  else {out+=text;atLineStart=false;}
  prevEnd=t.end;
}
fs.writeFileSync(outF,out);
console.log('tokens',toks.length,'lines',out.split('\n').length);
