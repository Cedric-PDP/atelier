// Builds the publishable journal page: page/journal-src.html + ref/cards.json and ref/tox.json inlined
// (a Read rule blocks publishing .json files next to the page). Usage: node build_page.js <out.html>
const fs=require('fs'),path=require('path');
const out=process.argv[2];if(!out)throw new Error('usage: node build_page.js <out.html>');
const REF=path.join(__dirname,'..','ref');
const src=fs.readFileSync(path.join(__dirname,'journal-src.html'),'utf8');
const safe=s=>s.replace(/<\//g,'<\u002f');
const cards=fs.readFileSync(path.join(REF,'cards.json'),'utf8');JSON.parse(cards);
// The 101 Tox keyed by game id with rarity ("CoeurVital_R": {name, rar, cost, text}), the ids the replays write in
// shop[].tox / replaced / offers. The page derives the families ("CoeurVital") used by bans.mine / bans.theirs / archetypes.ban.tox.
const tox=JSON.parse(fs.readFileSync(path.join(REF,'tox.json'),'utf8'));
for(const [id,t] of Object.entries(tox))if(!/_[CREL]$/.test(id)||t.rar!==id.slice(-1)||!t.name)throw new Error('tox.json: unexpected entry '+id);
const fams=new Set(Object.keys(tox).map(id=>id.replace(/_[CREL]$/,'')));
for(const ph of ['<!--CARDS-->','<!--TOX-->'])if(!src.includes(ph))throw new Error('placeholder '+ph+' missing');
const html=src.replace('<!--CARDS-->',()=>'<script type="application/json" id="cards-data">'+safe(cards)+'</script>')
  .replace('<!--TOX-->',()=>'<script type="application/json" id="tox-data">'+safe(JSON.stringify(tox))+'</script>');
fs.writeFileSync(out,html);console.log('built',out,fs.statSync(out).size,'bytes,',Object.keys(tox).length,'Tox in',fams.size,'families');
