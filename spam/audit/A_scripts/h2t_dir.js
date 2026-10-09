// usage: node h2t_dir.js <inDir> <outDir>  (convert every .html in inDir to .txt in outDir, one process)
const fs=require('fs'),path=require('path');const [,,inD,outD]=process.argv;fs.mkdirSync(outD,{recursive:true});
const ent={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',rsquo:'\u2019',lsquo:'\u2018',ldquo:'\u201c',rdquo:'\u201d',hellip:'\u2026',middot:'\u00b7',laquo:'\u00ab',raquo:'\u00bb',times:'\u00d7',minus:'\u2212',ndash:'\u2013',mdash:'\u2014'};
function conv(h){h=h.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<svg[\s\S]*?<\/svg>/gi,' ');
h=h.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/header|\/footer|\/summary|\/details|\/dt|\/dd|hr)[^>]*>/gi,'\n');
h=h.replace(/<h([1-6])[^>]*>/gi,(m,l)=>'\n'+'#'.repeat(+l)+' ').replace(/<li[^>]*>/gi,'\n- ').replace(/<[^>]+>/g,' ');
h=h.replace(/&#x([0-9a-f]+);/gi,(m,x)=>String.fromCodePoint(parseInt(x,16))).replace(/&#(\d+);/g,(m,d)=>String.fromCodePoint(+d)).replace(/&([a-z]+);/gi,(m,e)=>ent[e]!==undefined?ent[e]:m);
return h.split('\n').map(l=>l.replace(/[ \t\r]+/g,' ').trim()).filter(l=>l.length).join('\n');}
let n=0;for(const f of fs.readdirSync(inD)){if(!f.endsWith('.html'))continue;fs.writeFileSync(path.join(outD,f.replace(/\.html$/,'.txt')),conv(fs.readFileSync(path.join(inD,f),'utf8')));n++}console.log('converted',n);
