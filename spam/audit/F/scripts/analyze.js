// Agent F — meta proxy: which opponent cards / disruptive mechanics a real match is likely to show.
// Pure node (no engine). Reads the outputs of global.js (engine top decks), collections.js (workshop on sampled
// collections), the wiki's public lists (tiers 1.20 saved + 1.21 live, strategies combos) and cards_mech.json.
const fs=require('fs');
const SP=require('path').resolve(__dirname,'../../../..'); // repo root
const W=SP+'/spam/audit/F';
const J=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const model=J(SP+'/spam/js/model.json');
const cards=model.cards; const byId=new Map(cards.map(c=>[c.id,c])); const byNum=new Map(cards.map(c=>[c.number,c]));
const mech=new Map(J(W+'/cards_mech.json').map(c=>[c.number,c]));
const pick=(o,re)=>o[Object.keys(o).find(k=>re.test(k))];
const T120=pick(J(W+'/tiers_props.json'),/Rankings/), T121=pick(J(W+'/tiers_live_props.json'),/Rankings/);
const S120=pick(J(W+'/strat_props.json'),/Library/).library, S121=pick(J(W+'/strat_live_props.json'),/Library/).library;
const tierCard120=new Map(T120.cards.map(c=>[c.number,c])), tierCard121=new Map(T121.cards.map(c=>[c.number,c]));

// ---------- mechanics ----------
// key -> {label, test(card number, talentId|null) -> bool}
const inn=(n,t)=>mech.get(n).innate.includes(t);
const tal=(n,tid,tag)=>!!(tid&&mech.get(n).talent[tid]&&mech.get(n).talent[tid].tag===tag);
const MECHS=[
 ['absorbAny','absorbAny (absorbe une carte adverse)',(n)=>inn(n,'absorbAny')],
 ['absorbAlly','absorbAlly (absorbe un de SES propres alliés)',(n)=>inn(n,'absorbAlly')],
 ['vanishAny','vanish OU vanishOnHit (retire le dernier passif)',(n)=>inn(n,'vanish')||inn(n,'vanishOnHit')],
 ['vanish','  vanish (compétence)',(n)=>inn(n,'vanish')],
 ['vanishOnHit','  vanishOnHit (Tox Disparition innée)',(n)=>inn(n,'vanishOnHit')],
 ['setHpPct','setHpPct ≤ 50 % (PV fixés à 25 %)',(n)=>inn(n,'setHpPct')],
 ['freezeAny','freeze OU freezeOnHit',(n)=>inn(n,'freeze')||inn(n,'freezeOnHit')],
 ['freeze','  freeze (compétence, cible adverse ; hors #122 qui gèle son allié)',(n)=>inn(n,'freeze')],
 ['freezeOnHit','  freezeOnHit (Tox Gel innée)',(n)=>inn(n,'freezeOnHit')],
 ['tauntAny','taunt OU tauntOnAttack (Provocation)',(n)=>inn(n,'taunt')||inn(n,'tauntOnAttack')],
 ['tauntPermanent','  Provocation tenable chaque tour (cd ≤ durée, ou tauntOnAttack)',(n)=>inn(n,'tauntPermanent')],
 ['tauntOnAttack','  tauntOnAttack (Tox Provocation innée)',(n)=>inn(n,'tauntOnAttack')],
 ['resetEnemyCd','resetEnemyCd',(n)=>inn(n,'resetEnemyCd')],
 ['enemyPrec','enemyPrec (compétence)',(n)=>inn(n,'enemyPrec')],
 ['smokeAny','smoke (compétence) OU Fumée (Tox innée)',(n)=>inn(n,'smoke')||inn(n,'smokePassive')],
 ['smoke','  smoke (compétence)',(n)=>inn(n,'smoke')],
 ['smokePassive','  Fumée (Tox innée)',(n)=>inn(n,'smokePassive')],
 ['resetEnemySpamton','resetEnemySpamton',(n)=>inn(n,'resetEnemySpamton')],
 ['changeElement','changeElement (change l’élément de SA carte)',(n)=>inn(n,'changeElement')],
 ['resurrect','resurrect',(n)=>inn(n,'resurrect')],
 ['breakTaunt','breakTaunt',(n)=>inn(n,'breakTaunt')],
 ['reflect','reflect (Tox Renvoi innée)',(n)=>inn(n,'reflect')],
 ['immunity','immunity (Tox Immunité innée)',(n)=>inn(n,'immunity')],
 ['eternityAny','eternity (compétence) OU eternityOnHit (hors liste demandée)',(n)=>inn(n,'eternity')||inn(n,'eternityOnHit')],
 ['T_taunt25','talent Focus : 25 %/tour de Provocation (si talent actif)',(n,t)=>tal(n,t,'taunt25pct')],
 ['T_eternity','talent Longueur / Heure funeste : Éternité (si talent actif)',(n,t)=>tal(n,t,'eternity')],
 ['T_enemyPrec','talent Imprécision / Erreur croissante (si talent actif)',(n,t)=>tal(n,t,'enemyPrec')],
 ['T_immunity8','talent Immunité-8 (si talent actif)',(n,t)=>tal(n,t,'immunity')],
];
// union of the mechanics the caller listed (innate only)
const LISTED=['absorbAny','absorbAlly','vanish','vanishOnHit','setHpPct','freeze','freezeOnHit','taunt','tauntOnAttack','resetEnemyCd','enemyPrec','smoke','resetEnemySpamton','changeElement','resurrect','breakTaunt','reflect','immunity'];
MECHS.push(['anyListed','AU MOINS UNE mécanique de la liste demandée (innée)',(n)=>LISTED.some(t=>inn(n,t))]);
MECHS.push(['anyHostile','AU MOINS UNE mécanique de la liste, hors effets sur soi (absorbAlly, changeElement)',(n)=>LISTED.filter(t=>t!=='absorbAlly'&&t!=='changeElement').some(t=>inn(n,t))]);
MECHS.push(['anyHard','absorbAny / vanish* / freeze* / setHpPct / tauntPermanent / resetEnemyCd (les plus « destructrices »)',(n)=>['absorbAny','vanish','vanishOnHit','freeze','freezeOnHit','setHpPct','tauntPermanent','resetEnemyCd'].some(t=>inn(n,t))]);
const MK=MECHS.map(x=>x[0]);
const mechFn=Object.fromEntries(MECHS.map(x=>[x[0],x[2]]));
// precompute innate per card
const cardHas=new Map(cards.map(c=>[c.number,Object.fromEntries(MK.filter(k=>!k.startsWith('T_')).map(k=>[k,mechFn[k](c.number,null)]))]));

// ---------- deck-list proxies ----------
// deck = {n:[4 numbers], t:[4 talentIds|null]|null, w}
function exposure(decks){ // returns {mech: P(deck has >=1)} and per-card share
  let W0=0;const e=Object.fromEntries(MK.map(k=>[k,0]));const cf=new Map();
  for(const d of decks){const w=d.w??1;W0+=w;
    for(const k of MK){let has=false;for(let i=0;i<d.n.length;i++){const n=d.n[i];if(k.startsWith('T_')){if(d.t&&mechFn[k](n,d.t[i])){has=true;break}}else if(cardHas.get(n)[k]){has=true;break}}if(has)e[k]+=w;}
    for(const n of new Set(d.n))cf.set(n,(cf.get(n)||0)+w);}
  for(const k of MK)e[k]/=W0;const card={};for(const [n,v] of cf)card[n]=v/W0;
  return {mech:e,card,nDecks:decks.length};
}
const P={}; // proxy name -> {mech, card, nDecks, desc}
const add=(name,desc,decks)=>{P[name]={...exposure(decks),desc};Object.defineProperty(P[name],'decks',{value:decks,enumerable:false});};

// P1 engine full pool
const G=J(W+'/global_results.json');
const idx2num=i=>cards[i].number;
const teDecks=G.Te.map(r=>({n:r.slice(0,4).map(idx2num),t:r.slice(0,4).map((ci,k)=>r[6][k]==null?null:(cards[ci].talents[r[6][k]]?.id??null)),score:r[4]}));
const ntDecks=G.X.none.map(r=>({n:r.slice(0,4).map(idx2num),t:null,score:r[4]}));
for(const N of [100,500,1000]){add(`P1_T_top${N}`,`moteur wiki, pool complet, talents optimisés (Te), top ${N}`,teDecks.slice(0,N));add(`P1_N_top${N}`,`moteur wiki, pool complet, sans talent (X), top ${N}`,ntDecks.slice(0,N));}

// P3 public wiki lists
function listDecks(T,list,scoreKey){const seen=new Set();const out=[];for(const d of T.decks){if(list&&!d.lists.includes(list))continue;if(seen.has(d.id))continue;seen.add(d.id);
  out.push({n:d.cards.map(c=>byId.get(c.id).number),t:list&&list.startsWith('nt')?null:d.cards.map(c=>c.talentId),score:scoreKey==='nt'?d.noTalent.score:d.score,lists:d.lists,id:d.id});}
  return out;}
const all120=listDecks(T120,'all'),nt120=listDecks(T120,'nt-all'),cat120=listDecks(T120,null),all121=listDecks(T121,'all'),nt121=listDecks(T121,'nt-all'),cat121=listDecks(T121,null);
const low120=listDecks(T120,'low'),ntlow120=listDecks(T120,'nt-low');
add('P3_all_120','wiki 1.20 : tier list decks « All / avec talents » (40, uniforme)',all120);
add('P3_all_120_rank','wiki 1.20 : même liste pondérée 1/rang (attention décroissante)',all120.map((d,i)=>({...d,w:1/(i+1)})));
add('P3_nt_120','wiki 1.20 : tier list « No talent / All » (40)',nt120);
add('P3_low_120','wiki 1.20 : filtre « Accessible » avec talents (34)',low120);
add('P3_ntlow_120','wiki 1.20 : filtre « Accessible » sans talent (29)',ntlow120);
add('P3_cat_120','wiki 1.20 : catalogue complet (205 decks, = listes « Its best decks » des pages cartes)',cat120);
add('P3_all_121','wiki 1.21 (live 09/10 14:30 UTC) : tier list « All / avec talents » (40)',all121);
add('P3_nt_121','wiki 1.21 : tier list « No talent / All » (40)',nt121);
add('P3_cat_121','wiki 1.21 : catalogue complet (187)',cat121);
const combos=(L)=>L.combos.map(c=>({n:c.cards.map(x=>byId.get(x.id).number),t:c.cards.map(x=>x.talentId)}));
add('P3_combo_120','wiki 1.20 : 28 synergies de la page Strategies (combos de 1 à 4 cartes)',combos(S120));
add('P3_combo_121','wiki 1.21 : 28 synergies Strategies',combos(S121));

// P2 accessibility + P1xP2 collection-constrained populations
const COL=J(W+'/collections.json');
let CR=null;try{CR=J(W+'/collections_results.json')}catch(e){}
const tierOverall=n=>tierCard120.get(n).overall;
function rng(seed){return (function(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}})(seed)}
function sampleCollections(sc,count,seed){const r=rng(seed);const out=[];while(out.length<count){const own=[];for(const c of cards){const p=c.number<=6?sc.starter:sc[c.rarity];if(r()<p)own.push(c.number)}if(own.length>=4)out.push(own)}return out}
function comb4(n){return n<4?0:n*(n-1)*(n-2)*(n-3)/24}
function randomDeckExposure(cols){ // exact P(random 4 of the collection has mech), averaged over collections
  const e=Object.fromEntries(MK.filter(k=>!k.startsWith('T_')).map(k=>[k,0]));const card={};let pair=0;
  for(const own of cols){const n=own.length;for(const k in e){const kk=own.filter(x=>cardHas.get(x)[k]).length;e[k]+=1-comb4(n-kk)/comb4(n);}
    for(const x of own)card[x]=(card[x]||0)+4/n;
    if(own.includes(123)&&own.includes(222))pair+=12/(n*(n-1));}
  for(const k in e)e[k]/=cols.length;for(const x in card)card[x]/=cols.length;for(const k of MK)if(k.startsWith('T_'))e[k]=0;return {mech:e,card,nDecks:cols.length,pairObs:pair/cols.length};
}
function greedyDecks(cols){return cols.map(own=>({n:[...own].sort((a,b)=>tierOverall(b)-tierOverall(a)).slice(0,4),t:null}))}
const ownedSet=own=>new Set(own);
function copierDeck(own,catalog,key){const s=ownedSet(own);let best=null;for(const d of catalog){if(d.n.every(x=>s.has(x))){const sc=key==='nt'?d.ntScore:d.tScore;if(!best||sc>best.sc)best={d,sc}}}return best?best.d:null}
// catalog with both scores
const catBoth=(()=>{const seen=new Set();const out=[];for(const d of T120.decks){if(seen.has(d.id))continue;seen.add(d.id);out.push({n:d.cards.map(c=>byId.get(c.id).number),tTal:d.cards.map(c=>c.talentId),tScore:d.score,ntScore:d.noTalent.score,id:d.id})}return out})();
const catBoth121=(()=>{const seen=new Set();const out=[];for(const d of T121.decks){if(seen.has(d.id))continue;seen.add(d.id);out.push({n:d.cards.map(c=>byId.get(c.id).number),tTal:d.cards.map(c=>c.talentId),tScore:d.score,ntScore:d.noTalent.score,id:d.id})}return out})();
const SCN={};
for(const sc of ['U','V']){
  const big=sampleCollections(COL.SCEN[sc],20000,sc==='U'?9001:9002);
  P[`P2_${sc}_random`]={...randomDeckExposure(big),desc:`accessibilité seule : 4 cartes au hasard dans une collection tirée (scénario ${sc}, 20 000 collections)`};
  add(`B_${sc}_greedy`,`collection ${sc} : les 4 cartes possédées les mieux placées au classement public des cartes du wiki 1.20 (20 000 collections)`,greedyDecks(big));
  // copier on big sample (no fallback) — share of players who own at least one catalog deck
  let hit=0;const cdT=[],cdN=[];for(const own of big){const dT=copierDeck(own,catBoth,'t'),dN=copierDeck(own,catBoth,'nt');if(dT){hit++;cdT.push({n:dT.n,t:dT.tTal})}if(dN)cdN.push({n:dN.n,t:null});}
  SCN[sc]={ownsCatalogDeck:hit/big.length,meanSize:big.reduce((a,b)=>a+b.length,0)/big.length};
  if(cdT.length)add(`D_${sc}_copyOnly_T`,`collection ${sc} : meilleur deck du catalogue wiki 1.20 entièrement possédé (seulement les ${(100*hit/big.length).toFixed(1)} % qui en possèdent un)`,cdT);
  if(cdN.length)add(`D_${sc}_copyOnly_N`,`idem, classé par score sans talent`,cdN);
  if(CR&&CR[sc]){
    const res=CR[sc].filter(r=>!r.err);
    add(`C_${sc}_T`,`collection ${sc} : atelier wiki bestDecks(collection), 1er deck AVEC talents (${res.length} collections)`,res.map(r=>({n:r.wt[0].n,t:r.wt[0].t})));
    add(`C_${sc}_N`,`collection ${sc} : atelier wiki bestDecks(collection), 1er deck SANS talent (${res.length} collections)`,res.map(r=>({n:r.nt[0].n,t:null})));
    add(`C_${sc}_T3`,`idem, les 3 decks proposés (poids 1/3)`,res.flatMap(r=>r.wt.map(d=>({n:d.n,t:d.t,w:1/r.wt.length}))));
    add(`C_${sc}_N3`,`idem sans talent, 3 decks (poids 1/3)`,res.flatMap(r=>r.nt.map(d=>({n:d.n,t:null,w:1/r.nt.length}))));
    // copier with fallback to the workshop deck, on the same collections
    const colsSc=COL.cols[sc];const byPid=new Map(colsSc.map(c=>[c.pid,c.cards.map(idx2num)]));
    const dT=[],dN=[];let fb=0;for(const r of res){const own=byPid.get(r.pid);const a=copierDeck(own,catBoth,'t'),b=copierDeck(own,catBoth,'nt');if(!a)fb++;dT.push(a?{n:a.n,t:a.tTal}:{n:r.wt[0].n,t:r.wt[0].t});dN.push(b?{n:b.n,t:null}:{n:r.nt[0].n,t:null});}
    add(`D_${sc}_T`,`collection ${sc} : copie le meilleur deck du catalogue wiki possédé, sinon l'atelier (repli ${(100*fb/res.length).toFixed(0)} %) — talents`,dT);
    add(`D_${sc}_N`,`idem sans talent`,dN);
    {const eT=[],eN=[];let fb2=0;for(const r of res){const own=byPid.get(r.pid);const a=copierDeck(own,catBoth121,'t'),b=copierDeck(own,catBoth121,'nt');if(!a)fb2++;eT.push(a?{n:a.n,t:a.tTal}:{n:r.wt[0].n,t:r.wt[0].t});eN.push(b?{n:b.n,t:null}:{n:r.nt[0].n,t:null});}
     add(`D_${sc}_T_121`,`collection ${sc} : copie le meilleur deck du catalogue wiki 1.21 (live) possédé, sinon l'atelier 1.20 (repli ${(100*fb2/res.length).toFixed(0)} %) — talents`,eT);
     add(`D_${sc}_N_121`,`idem 1.21 sans talent`,eN);SCN[sc].copierFallback121=fb2/res.length;}
    SCN[sc].copierFallback=fb/res.length;
    // the 120/60 engine collections themselves: random + greedy on the same sample (MC check)
    const own=colsSc.map(c=>c.cards.map(idx2num));
    P[`P2_${sc}_random_sameSample`]={...randomDeckExposure(own),desc:`contrôle : P2 sur les ${own.length} mêmes collections que l'atelier`};
  }
}
// F = complete collection
P['P2_F_random']={...randomDeckExposure([cards.map(c=>c.number)]),desc:'référence : 4 cartes au hasard parmi les 127 (collection complète)'};
add('B_F_greedy','collection complète : les 4 premières du classement public des cartes 1.20 (1 seul deck)',greedyDecks([cards.map(c=>c.number)]));

// ---------- blend ----------
// P_blend = Σ_s w_s Σ_type v_type [ τ_s·P(s,type,talents) + (1-τ_s)·P(s,type,no talent) ]
const BL={w:{U:0.5,V:0.35,F:0.15},v:{random:0.25,greedy:0.25,optimizer:0.30,copier:0.20},tau:{U:0.25,V:0.5,F:0.5}};
function comp(sc,type,tal,cv='120'){ // proxy used for each cell (cv = wiki catalog version copied by the copiers)
  if(sc==='F'){return {random:'P2_F_random',greedy:'B_F_greedy',optimizer:tal?'P1_T_top1000':'P1_N_top1000',copier:tal?`P3_all_${cv}`:`P3_nt_${cv}`}[type];}
  const suf=cv==='121'?'_121':'';
  return {random:`P2_${sc}_random`,greedy:`B_${sc}_greedy`,optimizer:tal?`C_${sc}_T`:`C_${sc}_N`,copier:(tal?`D_${sc}_T`:`D_${sc}_N`)+suf}[type];
}
function blend(metric,key,weights=BL){let tot=0,acc=0;
  for(const sc in weights.w)for(const ty in weights.v){const ws=weights.w[sc]*weights.v[ty];if(!ws)continue;for(const tal of [true,false]){const wt=ws*(tal?weights.tau[sc]:1-weights.tau[sc]);const p=P[comp(sc,ty,tal,weights.cv||'120')];if(!p)continue;acc+=wt*((p[metric][key])||0);tot+=wt;}}
  return tot?acc/tot:null;}
const ALT={ // sensitivity weightings
  casual:{w:{U:0.6,V:0.4,F:0},v:{random:0.5,greedy:0.5,optimizer:0,copier:0},tau:{U:0.25,V:0.5,F:0.5}},
  wikiOnly:{w:{U:0.4,V:0.4,F:0.2},v:{random:0,greedy:0,optimizer:0.6,copier:0.4},tau:{U:0.25,V:0.5,F:0.5}},
  veteran:{w:{U:0,V:0.6,F:0.4},v:{random:0.25,greedy:0.25,optimizer:0.30,copier:0.20},tau:{U:0.5,V:0.5,F:0.5}},
  noGreedy:{w:{U:0.5,V:0.35,F:0.15},v:{random:0.35,greedy:0,optimizer:0.40,copier:0.25},tau:{U:0.25,V:0.5,F:0.5}},
  copier121:{w:{U:0.5,V:0.35,F:0.15},v:{random:0.25,greedy:0.25,optimizer:0.30,copier:0.20},tau:{U:0.25,V:0.5,F:0.5},cv:'121'},
};
const cellNames=[];for(const sc of ['U','V','F'])for(const ty of ['random','greedy','optimizer','copier'])for(const tal of [true,false])for(const cv of ['120','121'])cellNames.push(comp(sc,ty,tal,cv));
const uniqCells=[...new Set(cellNames)].filter(n=>P[n]&&n!=='B_F_greedy'); // B_F_greedy = 1 seul deck (0 ou 100 %) : exclu du min–max

// ---------- one-match likelihood check (AZURIAN: #123 + #222 in the same deck) ----------
function pBoth(decksName){const p=P[decksName];return null}
// computed on deck lists where we have decks: probability a deck contains both 123 and 222, or each
function obsLik(decks){let w0=0,a=0,b=0,ab=0;for(const d of decks){const w=d.w??1;w0+=w;const h1=d.n.includes(123),h2=d.n.includes(222);if(h1)a+=w;if(h2)b+=w;if(h1&&h2)ab+=w;}return {p123:a/w0,p222:b/w0,pBoth:ab/w0};}

// ---------- outputs ----------
const mechTable=MECHS.map(([k,label])=>{const row={key:k,label,blend:blend('mech',k)};for(const a in ALT)row['blend_'+a]=blend('mech',k,ALT[a]);
  const vals=uniqCells.map(n=>P[n].mech[k]).filter(v=>v!=null);row.min=Math.min(...vals);row.max=Math.max(...vals);
  row.byProxy=Object.fromEntries(Object.keys(P).map(n=>[n,P[n].mech[k]]));
  row.cards=cards.filter(c=>k.startsWith('T_')?Object.values(mech.get(c.number).talent).some(t=>({T_taunt25:'taunt25pct',T_eternity:'eternity',T_enemyPrec:'enemyPrec',T_immunity8:'immunity'})[k]===t.tag):cardHas.get(c.number)[k]).map(c=>c.number);
  return row;});
const cardRows=cards.map(c=>{const n=c.number;const row={number:n,name:c.name,rarity:c.rarity,element:c.element,spamtonPerTurn:c.spamton,hp:c.hp,
  mechanics:mech.get(n).innate,talentMech:Object.entries(mech.get(n).talent).map(([id,t])=>t.name+'→'+t.tag),blend:blend('card',n)};
  for(const a in ALT)row['blend_'+a]=blend('card',n,ALT[a]);
  row.byProxy=Object.fromEntries(Object.keys(P).map(p=>[p,P[p].card[n]||0]));return row;}).sort((a,b)=>b.blend-a.blend);
const obs={};for(const [name,p] of Object.entries(P)){if(p.decks)obs[name]=obsLik(p.decks);else obs[name]={p123:p.card[123]||0,p222:p.card[222]||0,pBoth:p.pairObs??null};}
// ---------- side channel: disruptive Tox the opponent can BUY in the shop (not a deck card) ----------
const TOX=J(SP+'/spam/toxinfo.json');
const TOXM={reflect:['Reflect_C','Reflect_R','Reflect_E','Reflect_L'],tauntOnAttack:['Taunt_R'],smokePassive:['Smoked_R'],freezeOnHit:['Frozen_E'],immunity:['Immunity_E'],vanishOnHit:['Disparition_L'],eternityOnHit:['Eternity_L']};
// per opening: P(offered) = 1-(1-p)^3 with p = Σ odds[rarity]/|pool[rarity]| (3 independent draws, no reroll, luck = turn).
// "bought" = naive: if offered, picked with prob 1/3 (one purchase among 3 offers).
function toxOffer(ids,turns,buy=1){let pNone=1;for(const t of turns){const od=TOX.odds[String(t)];let p=0;for(const id of ids){const r=TOX.tox[id].rarity;p+=od[r]/TOX.pools[r].length;}pNone*=1-buy*(1-Math.pow(1-p,3));}return 1-pNone;}
const toxSide=Object.fromEntries(Object.entries(TOXM).map(([k,ids])=>[k,{tox:ids,offered_T2_T8:toxOffer(ids,[2,4,6,8]),offered_T2_T10:toxOffer(ids,[2,4,6,8,10]),
  naiveBought_T2_T10:toxOffer(ids,[2,4,6,8,10],1/3)}]));
let completeness=null;try{completeness=J(W+'/completeness_check.json')}catch(e){}
const session=Object.fromEntries(mechTable.map(m=>[m.key,Object.fromEntries([1,5,10,20].map(N=>[N,{mix:1-Math.pow(1-m.blend,N),casual:1-Math.pow(1-m.blend_casual,N),wikiOnly:1-Math.pow(1-m.blend_wikiOnly,N)}]))]));
const result={sessionExposure:session,toxSideChannel:toxSide,meta:{completenessCheck:completeness,generated:new Date().toISOString(),model:'model.json engineHash '+model.engineHash+' v'+model.version,blendWeights:BL,alt:ALT,scenarios:{U:COL.SCEN.U,V:COL.SCEN.V},scenarioStats:SCN,
  globalCheck:G.check?Object.fromEntries(Object.entries(G.check).map(([k,v])=>[k,{threshold:v.threshold,randomAbove:v.randomAbove,missing:v.missing.length,randomMax:v.randomMax,randomMean:v.randomMean}])):null},
  proxies:Object.fromEntries(Object.entries(P).map(([k,v])=>[k,{desc:v.desc,nDecks:v.nDecks}])),mechanics:mechTable,cards:cardRows,observation:obs,
  topDecks:{P1_T:teDecks.slice(0,15),P1_N:ntDecks.slice(0,15)}};
fs.writeFileSync(W+'/F_meta.json',JSON.stringify(result,null,1));
console.log('proxies',Object.keys(P).length,'cells',uniqCells.length);
for(const r of mechTable)console.log(r.key.padEnd(16),'blend',(100*r.blend).toFixed(1).padStart(5),'range',(100*r.min).toFixed(1),'-',(100*r.max).toFixed(1));
