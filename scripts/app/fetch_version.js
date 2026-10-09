// Downloads the current game version from spamgame-wiki.com into spam/versions/<version>/:
//   js/simulation.js + js/model.json (the wiki engine and its model, hashed asset names read from the builder page),
//   js/source.json (asset URLs, engineHash, date), cards_fr.json (cards page props), builder_fr.txt (Tox texts),
//   meta_decks.json (the wiki deck tier list, see extract_meta_decks.js).
// curl, not Node's https: it is the client that gets through the network here (see CLAUDE.md « Réseau »).
// Prints the version on the last line; exit 0 = downloaded (new or changed), 3 = already there with the same hashes.
// Usage: node scripts/app/fetch_version.js <repoRoot> [--force]
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const [root,...flags]=process.argv.slice(2);if(!root)throw new Error('usage: fetch_version.js <repoRoot> [--force]');
const SITE='https://spamgame-wiki.com';
const get=u=>execFileSync('curl',['-s','-L','--fail','--max-time','60',u],{maxBuffer:64<<20}).toString('utf8');
const tmp=fs.mkdtempSync(path.join(require('os').tmpdir(),'spamver-'));
const builder=get(SITE+'/fr/builder/');
const modelUrl=(builder.match(/\/data\/model-[A-Za-z0-9_-]+\.json/)||[])[0];if(!modelUrl)throw new Error('no /data/model-*.json in the builder page');
// The simulation worker is referenced from one of the page's own scripts (DeckBuilder.*.js in 1.21).
let simUrl=(builder.match(/\/_astro\/simulation[A-Za-z0-9_.-]*\.js/)||[])[0];
if(!simUrl)for(const js of [...new Set(builder.match(/\/_astro\/[A-Za-z0-9_.-]+\.js/g)||[])]){const m=get(SITE+js).match(/\/_astro\/simulation[A-Za-z0-9_.-]*\.js/);if(m){simUrl=m[0];break}}
if(!simUrl)throw new Error('simulation-*.js not found from the builder page scripts');
const modelTxt=get(SITE+modelUrl),model=JSON.parse(modelTxt),sim=get(SITE+simUrl);
if(!model.version||!Array.isArray(model.cards))throw new Error('unexpected model: '+Object.keys(model));
const V=path.join(root,'spam/versions',model.version),J=path.join(V,'js');
const srcFile=path.join(J,'source.json');
if(fs.existsSync(srcFile)&&!flags.includes('--force')){const s=JSON.parse(fs.readFileSync(srcFile,'utf8'));
  if(s.model===modelUrl&&s.simulation===simUrl){console.log('déjà à jour',model.version,model.engineHash);console.log(model.version);process.exit(3)}
  console.log('même version, assets changés :',s.model,'->',modelUrl,'/',s.simulation,'->',simUrl)}
fs.mkdirSync(J,{recursive:true});
fs.writeFileSync(path.join(J,'model.json'),modelTxt);fs.writeFileSync(path.join(J,'simulation.js'),sim);
// Cards (with the wiki's own tiers) and Tox texts, through the existing extractors.
fs.writeFileSync(path.join(tmp,'cards.html'),get(SITE+'/fr/cards/'));fs.writeFileSync(path.join(tmp,'builder.html'),builder);
execFileSync('node',[path.join(root,'scripts/parse_spam.js'),path.join(tmp,'cards.html'),path.join(V,'cards_fr.json')],{stdio:['ignore','ignore','ignore']});
execFileSync('node',[path.join(root,'scripts/totext.js'),path.join(tmp,'builder.html'),path.join(V,'builder_fr.txt')],{stdio:'ignore'});
// The wiki deck tier list = the « méta » decks the changelog follows.
fs.writeFileSync(path.join(tmp,'tiers.html'),get(SITE+'/fr/tiers/'));
execFileSync('node',[path.join(root,'scripts/app/extract_meta_decks.js'),path.join(tmp,'tiers.html'),path.join(V,'meta_decks.json'),
  'spamgame-wiki.com/fr/tiers/ ('+new Date().toISOString().slice(0,10)+')'],{stdio:'ignore'});
fs.writeFileSync(srcFile,JSON.stringify({version:model.version,engineHash:model.engineHash,model:modelUrl,simulation:simUrl,fetched:new Date().toISOString(),
  noTalent:model.noTalent,cards:model.cards.length},null,1));
fs.rmSync(tmp,{recursive:true,force:true});
console.log('téléchargé',model.version,model.engineHash,modelUrl,simUrl,'cartes',model.cards.length);console.log(model.version);
