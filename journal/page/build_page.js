// Builds the publishable journal page: page/journal-src.html + ref/cards.json and the shop Tox families inlined
// (a Read rule blocks publishing .json files next to the page). Usage: node build_page.js <out.html>
const fs=require('fs'),path=require('path');
const out=process.argv[2];if(!out)throw new Error('usage: node build_page.js <out.html>');
const REF=path.join(__dirname,'..','ref');
const src=fs.readFileSync(path.join(__dirname,'journal-src.html'),'utf8');
const safe=s=>s.replace(/<\//g,'<\u002f');
const cards=fs.readFileSync(path.join(REF,'cards.json'),'utf8');JSON.parse(cards);
// Tox families keyed by id without rarity suffix ("Berserk"), as stored in bans.mine / bans.theirs / archetypes.ban.tox.
const tox=JSON.parse(fs.readFileSync(path.join(REF,'tox.json'),'utf8'));const fam={};
for(const [id,t] of Object.entries(tox)){const f=id.replace(/_[CREL]$/,'');(fam[f]=fam[f]||{name:t.name,rar:[],text:t.text}).rar.push(id.slice(-1))}
for(const ph of ['<!--CARDS-->','<!--TOX-->'])if(!src.includes(ph))throw new Error('placeholder '+ph+' missing');
const html=src.replace('<!--CARDS-->',()=>'<script type="application/json" id="cards-data">'+safe(cards)+'</script>')
  .replace('<!--TOX-->',()=>'<script type="application/json" id="tox-data">'+safe(JSON.stringify(fam))+'</script>');
fs.writeFileSync(out,html);console.log('built',out,fs.statSync(out).size,'bytes,',Object.keys(fam).length,'Tox families');
