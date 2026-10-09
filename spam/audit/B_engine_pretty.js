const e={
  cardsPerDeck:4,
  turnDurationPerCardAlive:15,
  turnAfterOvertime:20,
  overtimeReducingRatio:.1,
  overtimeScalingRatio:.5,
  frozenOwnerTurns:1,
  talentDraftSeconds:30,
  startLuck:0,
  luckPerTurn:1,
  rerollCost:10,
  itemShopMax:3,
  luckForSkip:0,
  moneyForSkip:10,
  deathBounty:50,
  bansPerPlayer:1,
  skipPerCardAlive:[10,10,10,10]
},
t={
  common:[
    {time:0,value:100,inSlope:0,outSlope:0},
    {time:2,value:100,inSlope:-.067162,outSlope:-.067162},
    {time:4,value:80,inSlope:-15.084803,outSlope:-15.084803},
    {time:6,value:50,inSlope:-12.485646,outSlope:-12.485646},
    {time:10,value:10,inSlope:-2.723492,outSlope:-2.723492},
    {time:11.898575,value:5,inSlope:-2.532998,outSlope:-2.532998},
    {time:14,value:0,inSlope:.020802,outSlope:.020802},
    {time:30,value:0,inSlope:.003486,outSlope:.003486},
    {time:50,value:0,inSlope:.018618,outSlope:.018618},
    {time:100,value:0,inSlope:-.016249,outSlope:-.016249}
  ],
  rare:[
    {time:0,value:0,inSlope:0,outSlope:0},
    {time:2,value:0,inSlope:-0,outSlope:-0},
    {time:4,value:20,inSlope:10.921633,outSlope:10.921633},
    {time:6,value:45,inSlope:3.672301,outSlope:3.672301},
    {time:10,value:50,inSlope:.013722,outSlope:.013722},
    {time:14,value:35,inSlope:-3.881487,outSlope:-3.881487},
    {time:30,value:0,inSlope:-.043959,outSlope:-.043959},
    {time:50,value:0,inSlope:-0,outSlope:-0},
    {time:100,value:0,inSlope:-.018971,outSlope:-.018971}
  ],
  epic:[
    {time:0,value:0,inSlope:0,outSlope:0},
    {time:2,value:0,inSlope:-.004759,outSlope:-.004759},
    {time:4,value:0,inSlope:.018664,outSlope:.018664},
    {time:6,value:5,inSlope:4.621785,outSlope:4.621785},
    {time:10,value:40,inSlope:12.498692,outSlope:12.498692},
    {time:14,value:60,inSlope:-.013768,outSlope:-.013768},
    {time:20,value:50,inSlope:-2.215345,outSlope:-2.215345},
    {time:30,value:30,inSlope:-1.968494,outSlope:-1.968494},
    {time:50,value:0,inSlope:.038897,outSlope:.038897},
    {time:100,value:0,inSlope:.016928,outSlope:.016928}
  ],
  legendary:[
    {time:0,value:0,inSlope:.024763,outSlope:.024763},
    {time:2,value:0,inSlope:-.008026,outSlope:-.008026},
    {time:3,value:0,inSlope:-.025547,outSlope:-.025547},
    {time:4,value:0,inSlope:.039026,outSlope:.039026},
    {time:6,value:0,inSlope:.049538,outSlope:.049538},
    {time:10,value:0,inSlope:.046918,outSlope:.046918},
    {time:14,value:5,inSlope:2.524274,outSlope:2.524274},
    {time:20,value:35,inSlope:4.054379,outSlope:4.054379},
    {time:30,value:70,inSlope:3.165212,outSlope:3.165212},
    {time:50,value:100,inSlope:.032301,outSlope:.032301},
    {time:100,value:100,inSlope:.062129,outSlope:.062129}
  ]
},
n={
  common:[
    `Aoe_C`,
    `Berserk_C`,
    `Chance_C`,
    `Cimetiere_C`,
    `CoeurEau_C`,
    `CoeurFeu_C`,
    `CoeurLumiere_C`,
    `CoeurNature_C`,
    `CoeurOmbre_C`,
    `CoeurResistance_C`,
    `CoeurTerre_C`,
    `CoeurVital_C`,
    `Erosion_C`,
    `Life Steal_C`,
    `Phoenix_C`,
    `Poison_C`,
    `Primitive heal_C`,
    `PunchingBag_C`,
    `Reflect_C`,
    `Shield_C`,
    `Spamland_C`,
    `Tenacite_C`
  ],
  rare:/* @__PURE__ */ `Aoe_R.Berserk_R.Brut_R.Chance_R.Cimetiere_R.CoeurEau_R.CoeurFeu_R.CoeurLumiere_R.CoeurNature_R.CoeurOmbre_R.CoeurResistance_R.CoeurTerre_R.CoeurVital_R.Inversement_R.Life Steal_R.Mimetisme_R.Multiplicator_R.Mystere_R.Optimisation_R.Phoenix_R.Poison_R.Primitive heal_R.PunchingBag_R.Reflect_R.Revenge_R.Shield_R.Smoked_R.Spamland_R.Taunt_R`.split(`.`),
  epic:/* @__PURE__ */ `Aoe_E.Berserk_E.Bomba_E.Chance_E.Cimetiere_E.CoeurEau_E.CoeurFeu_E.CoeurLumiere_E.CoeurNature_E.CoeurOmbre_E.CoeurResistance_E.CoeurTerre_E.CoeurVital_E.Erosion_E.Frozen_E.Immunity_E.Life Steal_E.Metamorph_E.Phoenix_E.Poison_E.Primitive heal_E.PunchingBag_E.Reflect_E.Reset_E.Shield_E.Spamland_E.Vengeur_E`.split(`.`),
  legendary:[
    `Aoe_L`,
    `Berserk_L`,
    `Chance_L`,
    `Cimetiere_L`,
    `CoeurEau_L`,
    `CoeurFeu_L`,
    `CoeurLumiere_L`,
    `CoeurNature_L`,
    `CoeurOmbre_L`,
    `CoeurResistance_L`,
    `CoeurTerre_L`,
    `CoeurVital_L`,
    `Disparition_L`,
    `Eternity_L`,
    `Life Steal_L`,
    `Phoenix_L`,
    `Poison_L`,
    `Primitive heal_L`,
    `PunchingBag_L`,
    `Reflect_L`,
    `Shield_L`,
    `Spamland_L`,
    `Temporality_L`
  ]
},
r={
  Aoe_C:{effect:`Aoe`,value:20,element:null,rarity:`common`,cost:45},
  Aoe_E:{effect:`Aoe`,value:80,element:null,rarity:`epic`,cost:135},
  Aoe_L:{effect:`Aoe`,value:100,element:null,rarity:`legendary`,cost:180},
  Aoe_R:{effect:`Aoe`,value:40,element:null,rarity:`rare`,cost:90},
  AttackMultiColor:{effect:`AttackMultiColor`,value:1,element:null,rarity:null,cost:0},
  Aveuglement:{effect:`Aveuglement`,value:25,element:null,rarity:null,cost:0},
  Berserk_C:{effect:`Berserk`,value:12,element:null,rarity:`common`,cost:30},
  Berserk_E:{effect:`Berserk`,value:50,element:null,rarity:`epic`,cost:100},
  Berserk_L:{effect:`Berserk`,value:100,element:null,rarity:`legendary`,cost:180},
  Berserk_R:{effect:`Berserk`,value:25,element:null,rarity:`rare`,cost:60},
  Bomba_E:{effect:`Bomba`,value:500,element:null,rarity:`epic`,cost:130},
  Brut_R:{effect:`Brut`,value:0,element:null,rarity:`rare`,cost:65},
  Casino:{effect:`Casino`,value:0,element:null,rarity:null,cost:0},
  ChanceVitale:{effect:`ChanceVitale`,value:10,element:null,rarity:null,cost:0},
  Chance_C:{effect:`Chance`,value:.5,element:null,rarity:`common`,cost:5},
  Chance_E:{effect:`Chance`,value:2,element:null,rarity:`epic`,cost:15},
  Chance_L:{effect:`Chance`,value:4,element:null,rarity:`legendary`,cost:20},
  Chance_R:{effect:`Chance`,value:1,element:null,rarity:`rare`,cost:10},
  Changement:{effect:`Changement`,value:0,element:null,rarity:null,cost:0},
  Cimetiere_C:{effect:`Cimetierre`,value:3,element:null,rarity:`common`,cost:20},
  Cimetiere_E:{effect:`Cimetierre`,value:8,element:null,rarity:`epic`,cost:60},
  Cimetiere_L:{effect:`Cimetierre`,value:12,element:null,rarity:`legendary`,cost:80},
  Cimetiere_R:{effect:`Cimetierre`,value:5,element:null,rarity:`rare`,cost:40},
  "Coeur elementaire C":{effect:`CoeurElement`,value:1,element:null,rarity:`common`,cost:20},
  CoeurCorrompu:{effect:`CoeurCorrompu`,value:50,element:null,rarity:`common`,cost:0},
  CoeurEau_C:{effect:`CoeurElement`,value:1,element:`water`,rarity:`common`,cost:15},
  CoeurEau_E:{effect:`CoeurElement`,value:5,element:`water`,rarity:`epic`,cost:60},
  CoeurEau_L:{effect:`CoeurElement`,value:8,element:`water`,rarity:`legendary`,cost:120},
  CoeurEau_R:{effect:`CoeurElement`,value:2,element:`water`,rarity:`rare`,cost:30},
  CoeurFeu_C:{effect:`CoeurElement`,value:1,element:`fire`,rarity:`common`,cost:15},
  CoeurFeu_E:{effect:`CoeurElement`,value:5,element:`fire`,rarity:`epic`,cost:60},
  CoeurFeu_L:{effect:`CoeurElement`,value:8,element:`fire`,rarity:`legendary`,cost:120},
  CoeurFeu_R:{effect:`CoeurElement`,value:2,element:`fire`,rarity:`rare`,cost:30},
  CoeurLumiere_C:{effect:`CoeurElement`,value:1,element:`light`,rarity:`common`,cost:15},
  CoeurLumiere_E:{effect:`CoeurElement`,value:5,element:`light`,rarity:`epic`,cost:60},
  CoeurLumiere_L:{effect:`CoeurElement`,value:8,element:`light`,rarity:`legendary`,cost:120},
  CoeurLumiere_R:{effect:`CoeurElement`,value:2,element:`light`,rarity:`rare`,cost:30},
  CoeurNature_C:{effect:`CoeurElement`,value:1,element:`nature`,rarity:`common`,cost:15},
  CoeurNature_E:{effect:`CoeurElement`,value:5,element:`nature`,rarity:`epic`,cost:60},
  CoeurNature_L:{effect:`CoeurElement`,value:8,element:`nature`,rarity:`legendary`,cost:120},
  CoeurNature_R:{effect:`CoeurElement`,value:2,element:`nature`,rarity:`rare`,cost:30},
  CoeurOmbre_C:{effect:`CoeurElement`,value:1,element:`shadow`,rarity:`common`,cost:15},
  CoeurOmbre_E:{effect:`CoeurElement`,value:5,element:`shadow`,rarity:`epic`,cost:60},
  CoeurOmbre_L:{effect:`CoeurElement`,value:8,element:`shadow`,rarity:`legendary`,cost:120},
  CoeurOmbre_R:{effect:`CoeurElement`,value:2,element:`shadow`,rarity:`rare`,cost:30},
  CoeurResistance_C:{effect:`CoeurResistance`,value:3,element:null,rarity:`common`,cost:10},
  CoeurResistance_E:{effect:`CoeurResistance`,value:10,element:null,rarity:`epic`,cost:70},
  CoeurResistance_L:{effect:`CoeurResistance`,value:15,element:null,rarity:`legendary`,cost:120},
  CoeurResistance_R:{effect:`CoeurResistance`,value:6,element:null,rarity:`rare`,cost:30},
  CoeurTerre_C:{effect:`CoeurElement`,value:1,element:`earth`,rarity:`common`,cost:15},
  CoeurTerre_E:{effect:`CoeurElement`,value:5,element:`earth`,rarity:`epic`,cost:60},
  CoeurTerre_L:{effect:`CoeurElement`,value:8,element:`earth`,rarity:`legendary`,cost:120},
  CoeurTerre_R:{effect:`CoeurElement`,value:2,element:`earth`,rarity:`rare`,cost:30},
  CoeurVital_C:{effect:`CoeurVital`,value:15,element:null,rarity:`common`,cost:10},
  CoeurVital_E:{effect:`CoeurVital`,value:60,element:null,rarity:`epic`,cost:70},
  CoeurVital_L:{effect:`CoeurVital`,value:100,element:null,rarity:`legendary`,cost:150},
  CoeurVital_R:{effect:`CoeurVital`,value:30,element:null,rarity:`rare`,cost:30},
  ContreCoup_C:{effect:`ContreCoup`,value:50,element:null,rarity:`common`,cost:30},
  ContreCoup_R:{effect:`ContreCoup`,value:100,element:null,rarity:`rare`,cost:50},
  "Cœur d’acier":{effect:`CoeurAcier`,value:1,element:null,rarity:null,cost:0},
  Decouverte_E:{effect:`Decouverte`,value:0,element:null,rarity:`epic`,cost:100},
  Disparition_L:{effect:`Disparition`,value:0,element:null,rarity:`legendary`,cost:180},
  Erosion_C:{effect:`Erosion`,value:50,element:null,rarity:`common`,cost:20},
  Erosion_E:{effect:`Erosion`,value:100,element:null,rarity:`epic`,cost:75},
  Eternity_L:{effect:`Eternity`,value:0,element:null,rarity:`legendary`,cost:220},
  Frozen_E:{effect:`Frozen`,value:40,element:null,rarity:`epic`,cost:150},
  Immunity_E:{effect:`ImunityStatus`,value:0,element:null,rarity:`epic`,cost:90},
  InsensibleDisparition:{effect:`InsensibleDisparition`,value:50,element:null,rarity:null,cost:0},
  InsensinleEternite:{effect:`InsensibleEternity`,value:50,element:null,rarity:null,cost:0},
  Inversement_R:{effect:`Inversement`,value:0,element:null,rarity:`rare`,cost:40},
  "Life Steal_C":{effect:`LifeSteal`,value:25,element:null,rarity:`common`,cost:30},
  "Life Steal_E":{effect:`LifeSteal`,value:75,element:null,rarity:`epic`,cost:110},
  "Life Steal_L":{effect:`LifeSteal`,value:100,element:null,rarity:`legendary`,cost:160},
  "Life Steal_R":{effect:`LifeSteal`,value:50,element:null,rarity:`rare`,cost:70},
  MetamorphSimple_C:{effect:`MetamorphSimple`,value:0,element:null,rarity:`epic`,cost:120},
  Metamorph_E:{effect:`Metamorph`,value:0,element:null,rarity:`epic`,cost:120},
  Mimetisme_R:{effect:`Mimetisme`,value:0,element:null,rarity:`rare`,cost:50},
  Multiplicator_R:{effect:`Multiplicator`,value:2,element:null,rarity:`rare`,cost:80},
  Mystere_R:{effect:`Mystere`,value:0,element:null,rarity:`rare`,cost:70},
  Optimisation_R:{effect:`Optimisation`,value:0,element:null,rarity:`rare`,cost:40},
  Paradoxe:{effect:`Paradoxe`,value:0,element:null,rarity:null,cost:0},
  PetitPrix:{effect:`PetitPrix`,value:50,element:null,rarity:null,cost:0},
  Phoenix_C:{effect:`Phoenix`,value:25,element:null,rarity:`common`,cost:100},
  Phoenix_E:{effect:`Phoenix`,value:75,element:null,rarity:`epic`,cost:200},
  Phoenix_L:{effect:`Phoenix`,value:100,element:null,rarity:`legendary`,cost:250},
  Phoenix_R:{effect:`Phoenix`,value:50,element:null,rarity:`rare`,cost:150},
  PlumePhoenix:{effect:`PlumePhoenix`,value:50,element:null,rarity:null,cost:0},
  Poison_C:{effect:`Poisoned`,value:1,element:null,rarity:`common`,cost:10},
  Poison_E:{effect:`Poisoned`,value:6,element:null,rarity:`epic`,cost:100},
  Poison_L:{effect:`Poisoned`,value:8,element:null,rarity:`legendary`,cost:150},
  Poison_R:{effect:`Poisoned`,value:3,element:null,rarity:`rare`,cost:50},
  "Primitive heal_C":{effect:`SoinPrimitif`,value:4,element:null,rarity:`common`,cost:20},
  "Primitive heal_E":{effect:`SoinPrimitif`,value:14,element:null,rarity:`epic`,cost:60},
  "Primitive heal_L":{effect:`SoinPrimitif`,value:19,element:null,rarity:`legendary`,cost:120},
  "Primitive heal_R":{effect:`SoinPrimitif`,value:9,element:null,rarity:`rare`,cost:40},
  PunchingBag_C:{effect:`SacDeFrappe`,value:1,element:null,rarity:`common`,cost:25},
  PunchingBag_E:{effect:`SacDeFrappe`,value:3,element:null,rarity:`epic`,cost:100},
  PunchingBag_L:{effect:`SacDeFrappe`,value:4,element:null,rarity:`legendary`,cost:150},
  PunchingBag_R:{effect:`SacDeFrappe`,value:2,element:null,rarity:`rare`,cost:50},
  Reflect_C:{effect:`Renvoie`,value:25,element:null,rarity:`common`,cost:24},
  Reflect_E:{effect:`Renvoie`,value:75,element:null,rarity:`epic`,cost:72},
  Reflect_L:{effect:`Renvoie`,value:100,element:null,rarity:`legendary`,cost:96},
  Reflect_R:{effect:`Renvoie`,value:50,element:null,rarity:`rare`,cost:48},
  Reset_E:{effect:`Reset`,value:0,element:null,rarity:`epic`,cost:130},
  Revenge_R:{effect:`Revanche`,value:0,element:null,rarity:`rare`,cost:80},
  Roulette:{effect:`Roulette`,value:10,element:null,rarity:null,cost:0},
  Shield_C:{effect:`Shield`,value:25,element:null,rarity:`common`,cost:30},
  Shield_E:{effect:`Shield`,value:75,element:null,rarity:`epic`,cost:120},
  Shield_L:{effect:`Shield`,value:100,element:null,rarity:`legendary`,cost:180},
  Shield_R:{effect:`Shield`,value:50,element:null,rarity:`rare`,cost:60},
  Smoked_R:{effect:`Smoked`,value:0,element:null,rarity:`rare`,cost:50},
  Spamland_C:{effect:`SpamLand`,value:3,element:null,rarity:`common`,cost:6},
  Spamland_E:{effect:`SpamLand`,value:24,element:null,rarity:`epic`,cost:16},
  Spamland_L:{effect:`SpamLand`,value:48,element:null,rarity:`legendary`,cost:24},
  Spamland_R:{effect:`SpamLand`,value:8,element:null,rarity:`rare`,cost:10},
  Stun_L:{effect:`Silenced`,value:0,element:null,rarity:`legendary`,cost:200},
  Taunt_R:{effect:`Protection`,value:0,element:null,rarity:`rare`,cost:70},
  Temporality_L:{effect:`Temporality`,value:0,element:null,rarity:`legendary`,cost:190},
  Tenacite_C:{effect:`Tenacite`,value:0,element:null,rarity:`common`,cost:10},
  ToxChanceux:{effect:`ToxChanceux`,value:50,element:null,rarity:null,cost:0},
  Vengeur_E:{effect:`Vengeur`,value:0,element:null,rarity:`epic`,cost:80},
  Voleur_R:{effect:`StealTox`,value:0,element:null,rarity:`epic`,cost:70}
},
i=[`fire`,`water`,`earth`,`nature`,`shadow`,`light`],
a={common:1,rare:2,epic:3,legendary:4,divine:5},
o={
  deckSize:e.cardsPerDeck,
  bonusPerPoint:.1,
  simTurns:10,
  player:1,
  oneActionPerCardPerTurn:!1,
  talentMode:`best-one`,
  aoeTargets:e.cardsPerDeck,
  allyTargets:e.cardsPerDeck,
  vampirismRatio:.5,
  fullHealValue:.45,
  echoMaxCasts:4,
  echoPity:{step:5,resolutions:8},
  turnIncome:!0,
  deathBounty:e.deathBounty,
  opponent:{
    cards:e.cardsPerDeck,
    cardHp:700,
    totalHp:2800,
    resist:.1,
    dpsByTurn:[108,124,140,156,172,188,204,220,236,253],
    aoeShare:.21
  },
  luckValue:4,
  spamtonValue:.6,
  turn8:8,
  imprudentMult:.6
},
s={offense:1,defense:.35,control:.8,economy:.5},
c={offense:.4,generation:.2,defense:.15,support:.1,control:.08,economy:.07};
i.length;
const l=[{tier:`S`,q:.92},{tier:`A`,q:.75},{tier:`B`,q:.5},{tier:`C`,q:.25},{tier:`D`,q:0}],
u={
  maxRows:3,
  everyTurns:2,
  items:e.itemShopMax,
  onePurchasePerOpening:!0,
  rerollCost:e.rerollCost,
  rerollStep:5,
  skipReward:e.moneyForSkip,
  startLuck:e.startLuck,
  luckPerTurn:e.luckPerTurn,
  canReplace:`any`,
  luckyOdds:{common:.25,rare:.25,epic:.25,legendary:.25},
  pools:n,
  usePrices:!0,
  minRarityOdds:.1,
  maxPlan:6,
  minGainPct:1,
  replaceMinGainPct:3,
  coreMinLossPct:5,
  robustCandidates:6,
  robustTries:8
},
d=[
  {id:`neutral`,cardHp:o.opponent.cardHp,resist:o.opponent.resist*100},
  {id:`fragile`,cardHp:550,resist:5},
  {id:`tank`,cardHp:900,resist:15},
  ...i.map(e=>({id:`anti-${e}`,cardHp:o.opponent.cardHp,resist:o.opponent.resist*100,extra:{[e]:25}}))
],
f={beamPairs:260,beamTriples:260,beamQuads:120,finalTop:40},
p={beamPairs:120,beamTriples:100,beamQuads:400,finalTop:8,decks:3,maxShared:2},
m=(e,t,n)=>Math.max(t,Math.min(n,e)),
h=(e,t)=>(e+t)/2,
g={
  stunPerTargetTurn:60,
  freezePerTarget:70,
  eternityPerTarget:25,
  vanish:40,
  resetEnemyCd:120,
  resetEnemySpamton:60,
  enemyPrecPerPoint:1.2,
  smoke:10,
  breakTaunt:10,
  tauntPerTurnAt700:40,
  immunityPerHp:.3,
  enemyHit:70,
  missingHpFraction:.35,
  setHp25Factor:1.2,
  mysteryDefense:40,
  mimetismPerTurn:1.5,
  hitsTakenPerTurn:.5,
  hitsTakenTaunting:1.2
},
_=/* @__PURE__ */ new Map;
function v(e){
  if(e<=0)return 0;
  let t=Math.round(e*1e3);
  if(_.has(t))return _.get(t);
  let n=e*100,
  r=(100-n)/10,
  {step:i,resolutions:a}=o.echoPity,
  s=/* @__PURE__ */ new Map([[0,1]]),
  c=0;
  for(let e=0;e<a;e++){
    let e=/* @__PURE__ */ new Map,
    t=0;
    for(let[a,o]of s){
      let s=m((n+a)/100,0,1);
      t+=o*s;
      let c=Math.round((a-r)*10)/10,
      l=Math.round((a+i)*10)/10;
      e.set(c,(e.get(c)??0)+o*s),
      e.set(l,(e.get(l)??0)+o*(1-s))
    }
    c+=t,
    s=e
  }
  let l=c/a;
  return _.set(t,l),
  l
}
function y(e=0){
  let t={};
  for(let n of i)t[n]=e;
  return t
}
function b(e=d[0]){
  if(e.cards?.length){
    let t=e.cards.map((e,t)=>({...e,index:t})),
    n={};
    for(let e of i)n[e]=t.reduce((t,n)=>t+(n.res?.[e]??0),0)/t.length;
    let r=t.reduce((e,t)=>e+t.hp,0);
    return{id:e.id??`deck`,cardHp:r/t.length,totalHp:r,res:n,cards:t}
  }
  let t={};
  for(let n of i)t[n]=(e.resist??0)+(e.extra?.[n]??0);
  return{id:e.id??`custom`,cardHp:e.cardHp,totalHp:e.cardHp*o.opponent.cards,res:t}
}
function x(e){
  return i.reduce((t,n)=>t+e.enemy.res[n],0)/i.length
}
function S(e,t,n){
  return(n===`card`||n===`self`)&&(n=t.element),
  !n||n===`random`||!(n in e.enemy.res)?x(e):e.enemy.res[n]
}
function C(e,t,n,r){
  (n===`card`||n===`self`)&&(n=t.element);
  let a=t=>(r.res[t]??0)+e.enemy.res[t]-e.opp.res[t];
  return!n||n===`random`||!(n in e.enemy.res)?i.reduce((e,t)=>e+a(t),0)/i.length:a(n)
}
function w(e){
  let t=e.opts.focus;
  return e.enemies.filter(e=>e.hp>0).sort((e,n)=>(t==null?0:(n.id===t)-(e.id===t))||e.hp-n.hp||e.index-n.index)
}
function T(e){
  let t=y(0);
  for(let{card:n}of e)for(let e of n.abilities){
    let r=e.options.reduce((e,t)=>t.hits.length>(e?.hits.length??-1)?t:e,null);
    if(!r)continue;
    let a=r.target===`aoeEnemy`?o.aoeTargets:1;
    for(let o of r.hits){
      if(o.pctMaxHp||o.pctOwnHp)continue;
      let r=h(o.min,o.max)*a/e.cd,
      s=o.element===`card`||o.element===`self`?n.element:o.element;
      if(s&&i.includes(s))t[s]+=r;
      else if(s===`random`)for(let e of i)t[e]+=r/6
    }
  }
  return t
}
function E(e,t,n){
  let r=e.card;
  return{
    idx:n,
    card:r,
    entry:e,
    element:r.element===`divine`?`random`:r.element,
    crit:0,
    prec:0,
    base:0,
    critMult:0,
    resAdd:0,
    hpMax:r.hp,
    echo:0,
    brut:!1,
    multiplicator:!1,
    inversion:!1,
    immune:!1,
    aoePct:0,
    lifesteal:0,
    recoil:0,
    erosion:!1,
    poison:0,
    freezeOnHit:!1,
    optimisation:!1,
    regenPct:0,
    hpGrowth:0,
    coeur:[],
    luckPerTurn:0,
    cimetiere:0,
    phoenix:0,
    tenacity:!1,
    reset:!1,
    revenge:!1,
    avenger:!1,
    stunOnHit:!1,
    eternityOnHit:!1,
    temporalityOnHit:!1,
    vanishOnHit:!1,
    tauntOnAttack:!1,
    smoke:!1,
    mimetism:!1,
    mystery:0,
    spamland:0,
    bomba:0,
    spamtonGen:0,
    spamtonRamp:0,
    critPerTurn:0,
    incisive:0,
    resOnHit:0,
    corrosion:0,
    enemyPrecOnAttack:0,
    genOnAttack:0,
    racket:0,
    healOnKill:0,
    hpOnDeath:0,
    baseOnDeath:0,
    resOnDeath:0,
    spamtonOnDeath:0,
    counter:!1,
    anticipation:!1,
    eternityAllOnDeath:0,
    temporalityOnDeath:0,
    metamorphOnDeath:!1,
    metamorphOthersOnDeath:!1,
    life8:!1,
    breath8:!1,
    passiveAt8:null,
    fullHealChance:0,
    fullHealLow:!1,
    vitalChance:0,
    focus:0,
    evolution:1,
    phoenixFeather:1,
    dead:!1,
    randomized:!1,
    dmgTaken:0,
    reflect:0,
    shieldPct:0,
    shieldUsed:!1,
    resLowHp:0,
    taunting:!1,
    wasTaunting:!1,
    counterUsed:!1,
    abilities:r.abilities.filter(e=>!(t.opts?.removeAbilities?.[n]??[]).includes(e.id)).map(e=>({ab:e,nextTurn:ee(e.cd,t.player),uses:e.uses||1/0,baseAdd:0,genUses:0,casts:0})),
    passives:r.passives.filter(e=>!(t.opts?.removePassives?.[n]??[]).includes(e.id)),
    talents:[]
  }
}
function ee(e,t){
  return Math.max(1,t===1?e:e-1)
}
function te(e,t,n){
  let r=t.shop?1:e.evolution;
  switch(t.type){
    case`berserk`:n.team.berserk+=t.pct/100*r;
    break;
    case`brut`:e.brut=!0;
    break;
    case`multiplicator`:e.multiplicator=!0;
    break;
    case`inversion`:e.inversion=!0;
    break;
    case`immunity`:e.immune=!0;
    break;
    case`aoe`:e.aoePct=Math.max(e.aoePct,t.pct*r);
    break;
    case`lifesteal`:e.lifesteal=Math.max(e.lifesteal,t.pct/100*r);
    break;
    case`reflect`:e.reflect=Math.max(e.reflect,t.pct/100*r);
    break;
    case`recoil`:e.recoil=t.pct/100;
    break;
    case`erosion`:e.erosion=!0;
    break;
    case`poison`:e.poison=Math.max(e.poison,(t.pct??1)*r);
    break;
    case`freezeOnHit`:e.freezeOnHit=!0;
    break;
    case`shield`:e.shieldPct=Math.min(1,Math.max(e.shieldPct,t.pct/100*r));
    break;
    case`optimisation`:e.optimisation=!0;
    break;
    case`regen`:e.regenPct+=t.pct/100*r;
    break;
    case`hpGrowth`:e.hpGrowth+=t.perTurn*r;
    break;
    case`coeur`:e.coeur.push({element:t.element,perTurn:t.perTurn*r});
    break;
    case`luck`:e.luckPerTurn+=t.perTurn;
    break;
    case`cimetiere`:e.cimetiere+=t.value*r;
    break;
    case`phoenix`:e.phoenix=Math.max(e.phoenix,t.pct/100*r);
    break;
    case`tenacity`:e.tenacity=!0;
    break;
    case`reset`:e.reset=!0;
    break;
    case`revenge`:e.revenge=!0;
    break;
    case`avenger`:e.avenger=!0;
    break;
    case`stunOnHit`:e.stunOnHit=!0;
    break;
    case`eternityOnHit`:e.eternityOnHit=!0;
    break;
    case`temporalityOnHit`:e.temporalityOnHit=!0;
    break;
    case`vanishOnHit`:e.vanishOnHit=!0;
    break;
    case`tauntOnAttack`:e.tauntOnAttack=!0;
    break;
    case`smoke`:e.smoke=!0;
    break;
    case`mimetism`:e.mimetism=!0;
    break;
    case`mystery`:e.mystery+=1;
    break;
    case`spamland`:e.spamland+=t.perTurn;
    break;
    case`bomba`:e.bomba+=t.value;
    break;
    case`teamRes`:n.team.res+=t.value*r
  }
}
function ne(e,t,n){
  switch(e.talents.push(t.name),t.kind){
    case`gen`:if(t.element===`all`)for(let e of i)n.bonus[e]+=t.value;
    else n.bonus[t.element]+=t.value;
    break;
    case`crit`:e.crit+=t.value;
    break;
    case`critMult`:e.critMult+=t.value;
    break;
    case`critPerTurn`:e.critPerTurn+=t.value;
    break;
    case`hpMax`:if(t.scope===`card`)e.hpMax+=t.value;
    else if(t.scope===`others`)for(let r of n.cards)r!==e&&(r.hpMax+=t.value);
    break;
    case`res`:t.scope===`team`?n.team.res+=t.value:e.resAdd+=t.elements===`all`?t.value:t.value*t.elements.length/6;
    break;
    case`resOnHit`:e.resOnHit+=t.value;
    break;
    case`resLowHp`:e.resLowHp+=t.value;
    break;
    case`passive`:e.passives.push(t.passiveObj);
    break;
    case`passiveAt8`:e.passiveAt8=t.passiveObj;
    break;
    case`echoAll`:e.echo+=t.chance;
    break;
    case`eternityStart`:n.startControl+=g.eternityPerTarget*t.value;
    break;
    case`temporalityStart`:n.startTemporality+=t.value;
    break;
    case`hpOnDeath`:e.hpOnDeath+=t.value;
    break;
    case`baseOnDeath`:e.baseOnDeath+=t.value;
    break;
    case`resOnDeath`:e.resOnDeath+=t.value;
    break;
    case`healOnKill`:e.healOnKill=t.pct/100;
    break;
    case`spamtonOnDeath`:e.spamtonOnDeath+=t.value;
    break;
    case`spamton`:n.totals.spamton+=t.value;
    break;
    case`spamtonGen`:e.spamtonGen+=t.value;
    break;
    case`spamtonGenPerTurn`:e.spamtonRamp+=t.value;
    break;
    case`spamtonThreshold`:n.spamtonThreshold+=t.value;
    break;
    case`luck`:n.totals.luck+=t.value,
    n.luck+=t.value;
    break;
    case`debt`:n.totals.spamton+=t.value,
    n.totals.economy-=t.value*o.spamtonValue;
    break;
    case`racket`:e.racket+=t.value;
    break;
    case`enemyPrec`:n.enemy.prec+=t.value,
    n.totals.control+=t.value*g.enemyPrecPerPoint;
    break;
    case`enemyPrecOnAttack`:e.enemyPrecOnAttack+=t.value;
    break;
    case`enemyResOnHitTaken`:e.corrosion+=t.value;
    break;
    case`enemyResPerTurn`:n.enemyResPerTurn+=t.value;
    break;
    case`immuneEternity`:case`immuneVanish`:n.totals.defense+=20;
    break;
    case`incisive`:e.incisive+=t.value;
    break;
    case`focus`:e.focus+=t.chance;
    break;
    case`vitalChance`:e.vitalChance+=t.chance;
    break;
    case`fullHealChance`:e.fullHealChance+=t.chance;
    break;
    case`fullHealLow`:e.fullHealLow=t;
    break;
    case`life8`:e.life8=!0;
    break;
    case`breath8`:e.breath8=!0;
    break;
    case`imprudent`:e.hpMax+=t.hp,
    e.randomized=!0;
    break;
    case`metamorphOnDeath`:e.metamorphOnDeath=!0;
    break;
    case`metamorphOthersOnDeath`:e.metamorphOthersOnDeath=!0;
    break;
    case`evolution`:e.evolution=1.3;
    break;
    case`phoenixFeather`:e.phoenixFeather=1+t.chance;
    break;
    case`counter`:e.counter=!0;
    break;
    case`anticipation`:e.anticipation=!0;
    break;
    case`eternityAllOnDeath`:e.eternityAllOnDeath+=t.value;
    break;
    case`temporalityOnDeath`:e.temporalityOnDeath+=t.value;
    break;
    case`toxLuck`:n.totals.economy+=20;
    break;
    case`paradox`:e.paradox=!0;
    break;
    case`genOnAttack`:e.genOnAttack+=t.value
  }
}
const D=e=>e.hpMax-e.dmgTaken;
function O(e,t,n=null){
  let r=e.paradox?-1:1,
  i=n&&n in e.card.res?e.card.res[n]:n?0:e.card.avgRes,
  a=e.resLowHp&&D(e)<e.hpMax/2?e.resLowHp:0;
  return m(r*i+e.resAdd+t.team.res+a,-60,80)
}
function k(e,t){
  return 1/(1-O(e,t)/100)
}
function A(e,t,n,r){
  if(r)return 1;
  if(!n)return 1-O(e,t)/100;
  let a=0;
  for(let r of i)a+=(n[r]??0)*(1-O(e,t,r)/100);
  return a
}
function j(e,t,n,r){
  let i=0;
  for(let a of n.hits)i+=B(e,t,n,a,r,!0);
  for(let a of n.heals)i+=.6*se(e,t,a,r);
  for(let a of n.gen)i+=N(e,a,r,t);
  for(let t of n.effects)i+=re(t,e,r);
  return i
}
function M(e,t,n,r){
  let i=h(t.min,t.max);
  return t.growth&&(i+=t.growth*(r?.genUses??0)),
  t.cond&&(i*=m((n.crit+e.crit+e.S.team.crit)/100,0,1)),
  i
}
function N(e,t,n,r){
  let a=Math.max(1,n.T-n.turn),
  s=Math.min(a,5),
  c=M(e,t,r,null),
  l=e=>o.bonusPerPoint*n.profile[e]*s*(1-n.enemy.res[e]/100);
  if(t.element===`all`)return c*i.reduce((e,t)=>e+l(t),0);
  if(t.element===`random`)return c/6*i.reduce((e,t)=>e+l(t),0);
  let u=t.element===`self`?e.element:t.element;
  return u===`random`?c/6*i.reduce((e,t)=>e+l(t),0):c*l(u)
}
function re(e,t,n){
  switch(e.type){
    case`stun`:return g.stunPerTargetTurn*e.duration*(e.target===`aoeEnemy`?o.aoeTargets:1);
    case`freeze`:return g.freezePerTarget*(e.target===`aoeEnemy`?o.aoeTargets:1);
    case`eternity`:return g.eternityPerTarget*e.value*(e.target===`aoeEnemy`?o.aoeTargets:1)*(e.cond?.5:1);
    case`temporality`:return e.scope===`team`?40*e.value:e.scope===`field`?0:15*e.value;
    case`taunt`:return g.tauntPerTurnAt700*e.duration*.5;
    case`setHpPct`:return e.value===25?.75*n.opp.cardHp*g.setHp25Factor:.25*t.hpMax*.6;
    case`absorbAny`:return n.opp.cardHp;
    case`resurrect`:return 210;
    case`crit`:return e.value*(e.scope===`team`?6:2);
    case`prec`:return e.value*(e.scope===`team`?3:1);
    case`critMult`:return e.scope===`field`?20:40;
    case`base`:return e.scope===`team`?e.value*12:e.value*4;
    case`res`:return e.scope===`enemy`?-e.value*3:e.value*1.5;
    case`hpMax`:return e.scope===`team`?e.value*1.5:e.value*.5;
    default:return 0
  }
}
function P(e,t,n){
  if((t===`card`||t===`self`)&&(t=e.element),!t)return 0;
  let r;
  return r=t===`random`?i.reduce((e,t)=>e+n.bonus[t],0)/6:n.bonus[t]??0,
  Math.max(0,e.multiplicator?r*2:r)
}
function F(e,t,n){
  return m(t.crit+e.crit+n.team.crit,0,100)/100
}
function ie(e,t,n){
  return t.critMult+e.critMult+n.team.critMult
}
function ae(e,t,n){
  return 1+F(e,t,n)*(ie(e,t,n)-1)
}
const I=(e,t)=>Math.round(Math.round(e)*(1-t));
function L(e,t,n){
  return m((t.prec+e.prec+n.team.prec)/100,0,1)
}
function oe(e,t,n){
  let r=n.enemies?n.enemies.filter(e=>e.hp>0).length:o.opponent.cards,
  i=e=>Math.max(1,Math.min(e,r));
  if(e.target===`spreadField`)return[.5];
  if(e.target===`aoeEnemy`)return Array(i(o.aoeTargets)).fill(1);
  if(e.effects.some(e=>e.type===`aoe2`))return Array(i(2)).fill(1);
  if(t.aoePct){
    let e=t.aoePct/100;
    if(r>=4)return[1,e,e*.5];
    if(r===3)return[1,e];
    if(r===2)return[1,e*.5]
  }
  return[1]
}
const R=e=>e.reduce((e,t)=>e+t,0);
function z(e,t,n,r){
  let i=((e.optimisation?t.max:h(t.min,t.max))+(r?.baseAdd??0)+e.base+n.team.base)*(1+o.bonusPerPoint*P(e,t.element,n));
  if(t.missingPct){
    let r=n.opts.potential?g.missingHpFraction*e.hpMax:Math.max(0,e.dmgTaken);
    i+=r*t.missingPct/100
  }
  return i
}
function B(e,t,n,r,i,a=!1,s=null,c=null){
  let l=c?[1]:oe(n,e,i),
  u=e.brut?0:(c?C(i,e,r.element,c):S(i,e,r.element))/100,
  d=c?c.hpMax:i.opp.cardHp,
  f=i.team.berserk*(e.randomized?o.imprudentMult:1),
  p=(r.pctMaxHp?d*r.min/100:z(e,r,i,s))*f,
  m=F(e,t,i),
  h=ie(e,t,i),
  g=(1-m)*I(p,u)+m*I(p*h,u);
  return g*=L(e,t,i)*R(l),
  e.erosion&&(g*=1.1),
  e.poison&&(g+=e.poison/100*d*3*l.length*L(e,t,i)),
  g
}
function se(e,t,n,r){
  let i;
  return i=n.pctOwnHp?e.hpMax*n.min/100*(n.full?o.fullHealValue:1):n.flat?n.min:((e.optimisation?n.max:h(n.min,n.max))+e.base+r.team.base)*(1+o.bonusPerPoint*P(e,n.element,r))*ae(e,t,r)*r.team.berserk,
  n.target===`allAllies`&&(i*=o.allyTargets),
  i*(e.randomized?o.imprudentMult:1)
}
function ce(e,t,n,r){
  if((n===`card`||n===`self`)&&(n=t.element),n===`random`)for(let t of i)e[t]+=r/6;
  else n in e&&(e[n]+=r)
}
function le(e,t,n,r){
  for(let r of e.cards){
    if(r.cimetiere)for(let t of i)e.bonus[t]+=r.cimetiere;
    if(r.hpOnDeath&&(r.hpMax+=r.hpOnDeath),r.baseOnDeath&&(r.base+=r.baseOnDeath),r.resOnDeath&&(r.resAdd+=r.resOnDeath),r.avenger&&r!==n)for(let e of r.abilities)e.nextTurn=Math.min(e.nextTurn,t)
  }
}
function ue(e,t,n,r){
  e.enemyDeaths+=1,
  e.events.push({turn:t,type:`kill`,card:n?.card.name,ability:r?.ab.name}),
  le(e,t,n,r),
  n&&(n.healOnKill&&U(e,n,n.dmgTaken*n.healOnKill),n.reset&&r&&(r.resetPending=(r.resetPending??0)+1))
}
const V=e=>o.opponent.dpsByTurn[Math.min(e,o.opponent.dpsByTurn.length)-1];
function de(e,t){
  let n=e.enemies.filter(e=>e.hp>0);
  if(!n.length)return;
  let r=Math.max(1,e.cards.length)/o.deckSize,
  i=e.perCard?n.map(e=>({raw:(e.dmg?.[t-1]??0)*r,mix:e.mix??null,brut:!!e.brut,aoe:e.aoe??0})):n.map(()=>({raw:V(t)/o.opponent.cards*r,mix:null,brut:!1,aoe:o.opponent.aoeShare}));
  for(let n of i)n.raw<=0||(e.pressureTaken+=n.raw,fe(e,t,n));
  for(let t of e.cards)t.shieldUsed=!1,
  t.wasTaunting=t.taunting,
  t.taunting=!1
}
function fe(e,t,n){
  let r=Math.max(1,Math.ceil(n.raw/g.enemyHit-1e-9)),
  i=n.raw/r,
  a=(r,i)=>{
    let a=A(r,e,n.mix,n.brut),
    o=H(e,t,r,i*a);
    return a>0?o/a:0
  };
  for(let o=0;o<r;o++){
    let r=e.cards.filter(e=>!e.dead);
    if(!r.length)return;
    let o=i*n.aoe;
    for(let i of r)H(e,t,i,o/r.length*A(i,e,n.mix,n.brut));
    let s=i-o,
    c=e.cards.find(e=>!e.dead&&e.taunting);
    if(c)s=a(c,s);
    else{
      let t=0;
      for(let n of e.cards.filter(e=>!e.dead&&e.focus)){
        let e=s*Math.min(1,n.focus);
        t+=e-a(n,e)
      }
      s-=t
    }
    for(let t=0;s>1e-9&&t<e.cards.length;t++){
      let t=e.cards.filter(e=>!e.dead).sort((e,t)=>D(e)-D(t))[0];
      if(!t)break;
      s=a(t,s)
    }
  }
}
function H(e,t,n,r){
  if(!(r>0))return 0;
  if(n.dead)return r;
  n.vitalChance&&(r*=Math.max(0,1-2*n.vitalChance)),
  n.shieldPct&&!n.shieldUsed&&(r-=Math.min(r,g.enemyHit)*n.shieldPct,n.shieldUsed=!0);
  let i=D(n);
  if(n.dmgTaken+=r,n.reflect&&G(e,t,r*n.reflect,n,null),n.counter&&!n.counterUsed&&i>.25*n.hpMax&&D(n)<=.25*n.hpMax&&(n.counterUsed=!0,pe(e,t,n)),D(n)>0)return 0;
  let a=-D(n);
  if(n.tenacity&&i>1){
    let e=Math.min(a+1,g.enemyHit);
    if(a-=e,a<=0)return n.dmgTaken=n.hpMax-1,
    0
  }
  return n.dmgTaken=n.hpMax,
  he(e,t,n),
  a
}
function U(e,t,n){
  if(!(n>0)||t.dead)return 0;
  e.totals.healOffered+=n;
  let r=Math.min(n,Math.max(0,t.dmgTaken));
  return t.dmgTaken-=r,
  e.totals.heal+=r,
  r
}
function pe(e,t,n){
  let r=0;
  for(let t of n.abilities){
    let i=W(n,t.ab,e);
    if(i)for(let a of i.hits)r+=B(n,t.ab,i,a,e,!0,t)
  }
  G(e,t,r,n,null)
}
function me(e,t){
  let n=e.enemies.filter(e=>e.hp>0),
  r=n.reduce((e,n)=>e+(n.heal?.[t-1]??0),0);
  if(!(r<=0)){
    n.sort((e,t)=>e.hp/e.hpMax-t.hp/t.hpMax||e.index-t.index);
    for(let t of n){
      let n=Math.min(r,t.hpMax-t.hp);
      if(t.hp+=n,r-=n,e.enemyHealed+=n,r<=0)break
    }
  }
}
function he(e,t,n){
  if(n.revenge&&pe(e,t,n),n.bomba&&G(e,t,n.bomba,n,null),o.deathBounty&&(e.totals.spamton+=o.deathBounty,e.spamtonByTurn[t-1]=(e.spamtonByTurn[t-1]??0)+o.deathBounty),n.metamorphOthersOnDeath)for(let t of e.cards)!t.dead&&t!==n&&(t.randomized=!0,U(e,t,t.dmgTaken));
  if(n.spamtonOnDeath&&(e.totals.spamton+=n.spamtonOnDeath),n.eternityAllOnDeath&&(e.totals.control+=g.eternityPerTarget*o.aoeTargets*n.eternityAllOnDeath),n.temporalityOnDeath)for(let r of e.cards)for(let e of r.abilities)e.nextTurn=Math.max(t,e.nextTurn-n.temporalityOnDeath);
  n.phoenix>0?(n.dmgTaken=n.hpMax*(1-Math.min(1,n.phoenix)),n.phoenix=n.phoenixFeather>1?n.phoenix*(n.phoenixFeather-1):0,n.phoenixFeather=1,e.events.push({turn:t,type:`ownRevive`,card:n.card.name})):n.metamorphOnDeath?(n.metamorphOnDeath=!1,n.dmgTaken=0,n.randomized=!0,e.events.push({turn:t,type:`ownRevive`,card:n.card.name})):(n.dead=!0,e.events.push({turn:t,type:`ownDeath`,card:n.card.name})),
  le(e,t,null,null)
}
function W(e,t,n){
  if(!t.options.length)return null;
  if(t.options.length===1)return t.options[0];
  let r=null,
  i=-1/0;
  for(let a of t.options){
    let o=j(e,t,a,n);
    o>i&&(i=o,r=a)
  }
  return r
}
function G(e,t,n,r,i,a=[1]){
  if(n<=0||e.over)return;
  if(e.dmgByTurn[t-1]+=n,e.opts.potential){
    r&&(e.dmgByCard[r.idx][t-1]+=n,a.length>1&&(e.aoeByCard[r.idx]+=n*(1-Math.max(...a)/R(a))));
    return
  }
  let s=w(e);
  if(!s.length)return;
  let c=R(a),
  l=[];
  for(let r=0;r<a.length&&r<s.length;r++){
    let i=s[r],
    o=Math.min(n*a[r]/c,i.hp);
    i.hp-=o,
    e.totals.dmg+=o,
    e.usefulByTurn[t-1]+=o,
    i.hp<=0&&l.push(i)
  }
  for(let n of l){
    if(n.phoenix>0){
      ue(e,t,r,i),
      --e.enemyDeaths,
      n.hp=Math.min(1,n.phoenix)*n.hpMax,
      n.phoenix=0;
      continue
    }
    if(e.ttk==null&&e.enemyDeaths+1===o.opponent.cards){
      let n=e.totals.dmg-e.dmgTurnStart,
      r=e.perCard?e.hpTurnStart:e.opp.totalHp-e.dmgTurnStart;
      e.ttk=t-1+(n>0?m(r/n,.05,1):1)
    }
    ue(e,t,r,i)
  }
  e.enemyDeaths>=o.opponent.cards&&!e.over&&(e.over=!0)
}
function ge(e,t,n,r){
  if(!(r>0))return;
  let i=e.cards.filter(e=>!e.dead);
  if(n===`self`)U(e,t,r);
  else if(n===`all`)for(let t of i)U(e,t,r/o.allyTargets);
  else if(n===`spread`)for(let t of i)U(e,t,r/i.length);
  else{
    let t=i.reduce((e,t)=>t.dmgTaken>e.dmgTaken+1e-9?t:e,i[0]);
    t&&U(e,t,r)
  }
}
function _e(e,t,n){
  if(n===`card`||!n){
    t.taunting=!0;
    return
  }
  let r=e.cards.filter(e=>!e.dead),
  i=r.reduce((t,n)=>D(n)*k(n,e)>D(t)*k(t,e)+1e-9?n:t,r[0]??t);
  i.taunting=!0
}
function ve(e,t){
  let n=e.cards.filter(e=>e.dead);
  if(!n.length)return;
  let r=n.reduce((t,n)=>Se(n,e)>Se(t,e)+1e-9?n:t);
  r.dead=!1,
  r.dmgTaken=r.hpMax*.5,
  e.totals.support+=r.hpMax*.25,
  e.events.push({turn:t,type:`ownRevive`,card:r.card.name})
}
function ye(e,t,n,r,a=null){
  let s=t.ab,
  c=W(e,s,n);
  if(!c)return;
  let l=m(v(s.echo)+e.echo,0,.9),
  u=a??Math.min(o.echoMaxCasts,1/(1-l)),
  d=c.hits.length&&s.prec<100?L(e,s,n):1;
  if(s.cost)for(let[e,t]of Object.entries(s.cost))n.bonus[e]-=t;
  s.costHp&&(e.dmgTaken+=s.costHp*u);
  let f=c.gen.length?c.gen.map(n=>`${n.element===`self`?e.element:n.element}+${Math.round(M(e,n,s,t)*u)}`).join(` `):``;
  for(let r of c.gen){
    let a=M(e,r,s,t)*u*d,
    o=r.element===`self`?e.element:r.element;
    if(o===`all`)for(let e of i)n.bonus[e]+=a,
    n.totals.genByElement[e]+=a;
    else if(o===`random`)for(let e of i)n.bonus[e]+=a/6,
    n.totals.genByElement[e]+=a/6;
    else n.bonus[o]+=a,
    n.totals.genByElement[o]+=a;
    n.totals.genPoints+=a,
    t.genUses+=u
  }
  let p=(c.hits.length+c.heals.length)*u*(c.hits.length?L(e,s,n):1);
  if(e.genOnAttack&&p)for(let t of i)n.bonus[t]+=e.genOnAttack*p,
  n.totals.genByElement[t]+=e.genOnAttack*p;
  let h=0,
  _=0,
  y=[],
  b=oe(c,e,n);
  for(let r of c.hits){
    let i=B(e,s,c,r,n,!1,t);
    h+=i,
    r.pctMaxHp||ce(n.totals.useByElement,e,r.element,i*u)
  }
  if(n.perCard&&c.hits.length&&!e.inversion){
    let r=w(n),
    i=b.slice(0,r.length).map((i,a)=>i*c.hits.reduce((i,o)=>i+B(e,s,c,o,n,!1,t,r[a]),0)),
    a=R(i);
    a>0&&(h=a,b=i)
  }
  for(let t of c.heals){
    let r=se(e,s,t,n);
    _+=r,
    y.push({
      to:t.self||t.target===`self`?`self`:t.target===`allAllies`?`all`:c.target===`randomAlly`||t.target===`randomAlly`?`spread`:`ally`,
      v:r
    }),
    !t.pctOwnHp&&!t.flat&&ce(n.totals.useByElement,e,t.element,r*u)
  }
  let S=0;
  e.inversion&&([h,_]=[_*(1-x(n)/100),h],y.length=0,y.push({to:`ally`,v:_})),
  c.target===`spreadField`&&h>0&&(S+=h),
  h*=u,
  _*=u,
  S*=u;
  let C=c.effects.some(e=>e.type===`vampirism`)?o.vampirismRatio:0,
  T=h*Math.max(C,e.lifesteal);
  T&&(_+=T,y.push({to:`self`,v:T/u})),
  e.recoil&&(S+=h*e.recoil),
  _&&(c.heals.every(e=>e.self)||(n.totals.support+=Math.max(0,_-T)*.5));
  for(let t of y)ge(n,e,t.to,t.v*u);
  if(S>0){
    let t=n.cards.filter(e=>!e.dead);
    if(c.target===`spreadField`)for(let e of t)H(n,r,e,S/t.length*A(e,n,null,!1));
    else H(n,r,e,S*A(e,n,null,!1))
  }
  if(t.resetPending=0,G(n,r,h,e,t,b),t.resetPending){
    let i=Math.min(t.resetPending,1);
    t.resetPending=0,
    G(n,r,h/u*i,e,t,b)
  }
  let E=c.hits.length>0,
  ee=c.heals.some(e=>!e.self)||[`ally`,`allAllies`,`randomAlly`].includes(c.target);
  for(let a of c.effects){
    let l=c.target===`aoeEnemy`?o.aoeTargets:1;
    switch([`team`,`ally`,`randomAlly`,`field`].includes(a.scope)&&[`crit`,`prec`,`base`,`critMult`,`res`,`hpMax`,`temporality`].includes(a.type)&&(n.totals.teamBuff+=re(a,e,n)*u*d),d<1&&[`crit`,`prec`,`base`,`critMult`,`res`,`hpMax`].includes(a.type)&&(a={...a,value:a.value*d}),a.type){
      case`stun`:n.totals.control+=g.stunPerTargetTurn*a.duration*l*L(e,s,n)*u;
      break;
      case`freeze`:n.totals.control+=g.freezePerTarget*l*L(e,s,n)*u;
      break;
      case`eternity`:n.totals.control+=g.eternityPerTarget*a.value*l*(a.cond?m(s.crit+e.crit+n.team.crit,0,100)/100:1)*u;
      break;
      case`temporality`:if(a.scope===`team`)for(let e of n.cards)for(let n of e.abilities)n!==t&&(n.nextTurn=Math.max(r,n.nextTurn-a.value));
      else a.scope===`ally`&&Ce(n,r,a.value);
      break;
      case`taunt`:_e(n,e,a.scope);
      break;
      case`vanish`:n.totals.control+=g.vanish;
      break;
      case`smoke`:n.totals.defense+=g.smoke;
      break;
      case`crit`:K(n,e,a,(e,t=1)=>{
        e.crit+=t*a.value*(a.cond?.5:1)
      },e=>{
        n.team.crit+=e
      });
      break;
      case`prec`:K(n,e,a,(e,t=1)=>{
        e.prec+=t*a.value
      },e=>{
        n.team.prec+=e
      });
      break;
      case`critMult`:a.scope===`field`?n.team.critMult+=a.value*.5:K(n,e,a,(e,t=1)=>{
        e.critMult+=t*a.value
      },e=>{
        n.team.critMult+=e
      });
      break;
      case`base`:a.scope===`ability`?t.baseAdd+=a.value*u:K(n,e,a,(e,t=1)=>{
        e.base+=t*a.value
      },e=>{
        n.team.base+=e
      });
      break;
      case`res`:if(a.scope===`enemy`)for(let e of a.elements===`all`?i:a.elements)n.enemy.res[e]+=a.value*.7;
      else a.scope===`team`?n.team.res+=a.value:K(n,e,a,(e,t=1)=>{
        e.resAdd+=t*(a.elements===`all`?a.value:a.value*a.elements.length/6)
      },e=>{
        n.team.res+=e
      });
      break;
      case`hpMax`:if(a.scope===`team`)for(let e of n.cards)e.hpMax+=a.value;
      else K(n,e,a,(e,t=1)=>{
        e.hpMax+=t*a.value
      },()=>{});
      break;
      case`enemyPrec`:n.enemy.prec+=a.value*l,
      n.totals.control+=a.value*l*g.enemyPrecPerPoint;
      break;
      case`resetEnemyCd`:n.totals.control+=g.resetEnemyCd;
      break;
      case`resetEnemySpamton`:n.totals.economy+=g.resetEnemySpamton;
      break;
      case`resurrect`:ve(n,r);
      break;
      case`absorbAny`:G(n,r,n.opp.cardHp,e,t),
      e.hpMax+=n.opp.cardHp*.5;
      break;
      case`absorbAlly`:break;
      case`setHpPct`:a.value<=50?G(n,r,(1-a.value/100)*n.opp.cardHp*g.setHp25Factor,e,t):U(n,e,a.value/100*e.hpMax-D(e));
      break;
      case`spamtonGen`:e.spamtonGen+=a.value*u;
      break;
      case`breakTaunt`:n.totals.defense+=g.breakTaunt
    }
  }
  if(E){
    let t=c.hits.length*u*L(e,s,n);
    e.stunOnHit&&(n.totals.control+=g.stunPerTargetTurn*L(e,s,n)*u),
    e.freezeOnHit&&(n.totals.control+=g.freezePerTarget*L(e,s,n)*u),
    e.eternityOnHit&&(n.totals.control+=g.eternityPerTarget*u),
    e.vanishOnHit&&(n.totals.control+=g.vanish*.6*u),
    e.tauntOnAttack&&(e.taunting=!0),
    e.enemyPrecOnAttack&&(n.enemy.prec+=e.enemyPrecOnAttack,n.totals.control+=e.enemyPrecOnAttack*g.enemyPrecPerPoint),
    e.racket&&(n.totals.economy+=e.racket*.5*t)
  }
  ee&&e.temporalityOnHit&&Ce(n,r,1),
  e.smoke&&(E||_>0)&&(n.totals.defense+=g.smoke),
  t.nextTurn=r+s.cd,
  --t.uses,
  t.casts+=u,
  n.plan[r-1].push({
    cardId:e.card.id,
    abilityId:s.id??`elemental-breath`,
    card:e.card.name,
    ability:s.name,
    option:s.options.indexOf(c),
    dmg:Math.round(h),
    heal:Math.round(_),
    gen:f
  }),
  n.totals.casts+=1
}
const be=/* @__PURE__ */ new Set([`crit`,`prec`,`critMult`,`base`]),
xe=[`crit`,`prec`,`critMult`,`base`,`resAdd`,`hpMax`];
function Se(e,t){
  let n=0;
  for(let r of e.abilities){
    if(r.uses<=0)continue;
    let i=W(e,r.ab,t);
    if(!i)continue;
    let a=0;
    for(let n of i.hits)a+=B(e,r.ab,i,n,t,!0,r);
    n+=a/r.ab.cd
  }
  return n
}
function K(e,t,n,r,i){
  if(n.scope===`team`||n.scope===`field`){
    i(n.value);
    return
  }
  if(n.scope===`card`){
    r(t);
    return
  }
  if(n.scope===`randomAlly`){
    for(let t of e.cards)r(t,1/e.cards.length);
    return
  }
  let a=be.has(n.type)?t=>Se(t,e):t=>t.hpMax*k(t,e),
  o=null,
  s=-1/0;
  for(let t of e.cards){
    let e=a(t),
    n=xe.map(e=>t[e]);
    r(t);
    let i=a(t)-e;
    xe.forEach((e,r)=>{
      t[e]=n[r]
    }),
    i>s+1e-9&&(s=i,o=t)
  }
  r(o??t)
}
function Ce(e,t,n){
  let r=null,
  i=-1;
  for(let n of e.cards)for(let e of n.abilities){
    let n=e.nextTurn-t;
    n>i&&(i=n,r=e)
  }
  r&&i>0&&(r.nextTurn=Math.max(t,r.nextTurn-n))
}
function q(e,t={}){
  let n=t.turns??o.simTurns,
  r=b(t.opponent??d[0]),
  a=!!r.cards,
  s={
    T:n,
    turn:0,
    player:t.player??o.player,
    opts:t,
    opp:r,
    perCard:a,
    bonus:y(0),
    team:{crit:0,prec:0,base:0,critMult:0,res:0,berserk:1},
    enemy:{res:{...r.res},prec:0},
    totals:{
      dmg:0,
      heal:0,
      healOffered:0,
      control:0,
      economy:0,
      defense:0,
      spamton:0,
      luck:0,
      genPoints:0,
      support:0,
      casts:0,
      teamBuff:0,
      genByElement:y(0),
      useByElement:y(0)
    },
    dmgByTurn:Array(n).fill(0),
    plan:Array.from({length:n},()=>[]),
    events:[],
    enemies:a?r.cards.map(e=>({
      index:e.index,
      id:e.id,
      hp:e.hp,
      hpMax:e.hp,
      res:e.res,
      phoenix:e.phoenix??0,
      dmg:e.dmgByTurn,
      heal:e.healByTurn,
      mix:e.mix??null,
      brut:!!e.brut,
      aoe:e.aoe??o.opponent.aoeShare
    })):Array.from({length:o.opponent.cards},(e,t)=>({index:t,hp:r.cardHp})),
    hpTurnStart:0,
    enemyHealed:0,
    dmgByCard:t.potential?e.map(()=>Array(n).fill(0)):null,
    aoeByCard:t.potential?e.map(()=>0):null,
    healByTurn:Array(n).fill(0),
    pressureTaken:0,
    usefulByTurn:Array(n).fill(0),
    spamtonByTurn:[],
    enemyDeaths:0,
    ttk:null,
    dmgTurnStart:0,
    startControl:0,
    startTemporality:0,
    spamtonThreshold:0,
    enemyResPerTurn:0,
    luck:u.startLuck,
    luckByTurn:[],
    cards:[],
    profile:null
  };
  s.profile=T(e),
  e.forEach((e,t)=>s.cards.push(E(e,s,t))),
  s.cards.sort((e,t)=>e.card.number-t.card.number);
  for(let e of s.cards){
    e.S=s;
    let n=t.talentMode??o.talentMode,
    r=e.card.talents,
    i=t.excludeTalents?.[e.idx]??[];
    n===`all`?r.forEach((t,n)=>{
      i.includes(n)||ne(e,t,s)
    }):n!==`none`&&e.entry.talent!=null&&r[e.entry.talent]&&ne(e,r[e.entry.talent],s);
    for(let n of t.extraPassives?.[e.idx]??[])e.passives.push(n);
    for(let t of e.passives)te(e,t,s);
    e.mystery&&(e.coeur.push({element:e.element,perTurn:.5*e.mystery}),s.totals.defense+=g.mysteryDefense*e.mystery),
    e.immune&&(s.totals.defense+=e.hpMax*g.immunityPerHp)
  }
  let c=s.cards.reduce((e,t)=>e+t.card.spamton+t.spamtonGen+t.spamland,0);
  s.totals.control+=s.startControl,
  s.startTemporality&&Ce(s,1,s.startTemporality);
  let l=t.externalGen??null,
  f=t.potential?e.map((e,t)=>{
    let n=s.cards.find(e=>e.idx===t),
    r=Object.fromEntries(i.map(e=>[e,m((n.paradox?-1:1)*(n.card.res[e]??0)+n.resAdd+s.team.res,-60,80)]));
    return{hp:n.hpMax,res:r,phoenix:n.phoenix*n.phoenixFeather,brut:n.brut}
  }):null,
  p=s.totals.healOffered,
  h=!t.potential&&s.player===2;
  for(let e=1;e<=n&&!s.over;e++){
    if(s.turn=e,h&&(de(s,e),a&&me(s,e)),s.dmgTurnStart=s.totals.dmg,a&&(s.hpTurnStart=s.enemies.reduce((e,t)=>e+Math.max(0,t.hp),0)),s.luck+=u.luckPerTurn,l)for(let e of i)s.bonus[e]+=l[e]??0;
    for(let t of s.cards){
      for(let e of t.coeur){
        if(e.element===`random`||e.element===`divine`)for(let t of i)s.bonus[t]+=e.perTurn/6,
        s.totals.genByElement[t]+=e.perTurn/6;
        else s.bonus[e.element]+=e.perTurn,
        s.totals.genByElement[e.element]+=e.perTurn;
        s.totals.genPoints+=e.perTurn
      }
      if(t.mimetism)for(let e of i)s.bonus[e]+=g.mimetismPerTurn/6;
      t.hpGrowth&&(t.hpMax+=t.hpGrowth),
      t.regenPct&&U(s,t,t.regenPct*t.hpMax),
      t.luckPerTurn&&!t.dead&&(s.totals.luck+=t.luckPerTurn,s.luck+=t.luckPerTurn),
      t.critPerTurn&&(t.crit+=t.critPerTurn),
      t.incisive&&(s.team.crit+=t.incisive,s.team.prec+=t.incisive),
      t.fullHealChance&&U(s,t,t.fullHealChance*t.dmgTaken),
      t.fullHealLow&&!t.dead&&D(t)<=t.fullHealLow.threshold/100*t.hpMax&&(!t.fullHealLow.minSpamton||s.totals.spamton>=t.fullHealLow.minSpamton)&&U(s,t,t.dmgTaken*(t.fullHealLow.minSpamton?.7:1));
      let r=t.wasTaunting?g.hitsTakenTaunting:g.hitsTakenPerTurn;
      if(t.passives.some(e=>e.type===`punchingBag`)){
        if(t.element===`random`)for(let e of i)s.bonus[e]+=r/6;
        else s.bonus[t.element]+=r;
        s.totals.genPoints+=r
      }
      if(t.resOnHit&&(t.resAdd+=t.resOnHit*r),t.corrosion)for(let e of i)s.enemy.res[e]-=t.corrosion*r;
      if(t.focus&&(s.totals.defense+=t.focus*g.tauntPerTurnAt700*((t.hpMax-600)/700)),e===1&&t.anticipation){
        let n=0;
        for(let e of t.abilities){
          let r=W(t,e.ab,s);
          if(r)for(let i of r.hits)n+=B(t,e.ab,r,i,s,!0,e)
        }
        G(s,e,n,t,null)
      }
      if(e===o.turn8){
        if(t.life8&&(t.dmgTaken*=2,t.hpMax*=2),t.passiveAt8){
          let e={immune:t.immune};
          t.passives.push(t.passiveAt8),
          te(t,t.passiveAt8,s);
          let r=(n-o.turn8+1)/n;
          !e.immune&&t.immune&&(s.totals.defense+=t.hpMax*g.immunityPerHp*r)
        }
        t.breath8&&t.abilities.push({
          ab:{
            name:`Souffle élémentaire`,
            cd:1,
            prec:100,
            crit:1,
            critMult:2,
            echo:0,
            uses:0,
            cost:null,
            costHp:0,
            options:[{target:`enemy`,hits:[{min:30,max:30,element:`card`}],heals:[],gen:[],effects:[]}]
          },
          nextTurn:e,
          uses:1/0,
          baseAdd:0,
          genUses:0,
          casts:0
        })
      }
    }
    if(s.enemyResPerTurn)for(let e of i)s.enemy.res[e]-=s.enemyResPerTurn;
    s.luckByTurn[e-1]=s.luck;
    let r=[];
    for(let t of s.cards)for(let n of t.abilities){
      if(t.dead||e<n.nextTurn||n.uses<=0)continue;
      let i=n.ab;
      if(i.cost&&Object.entries(i.cost).some(([e,t])=>s.bonus[e]<t)||i.costHp&&D(t)-i.costHp<.2*t.hpMax)continue;
      let a=W(t,i,s);
      if(!a)continue;
      let o=j(t,i,a,s);
      o<=0&&!a.gen.length&&!a.hits.length&&!a.heals.length&&!a.effects.length||o<=.01&&(a.effects.some(e=>e.type===`absorbAlly`)||i.costHp&&o<i.costHp*.5)||r.push({cs:t,a:n,v:o,hasDmg:a.hits.length>0})
    }
    if(r.sort((e,t)=>e.hasDmg-t.hasDmg||t.v-e.v),o.oneActionPerCardPerTurn||t.oneActionPerCard){
      let e=/* @__PURE__ */ new Set;
      for(let t of r.slice().sort((e,t)=>t.v-e.v))e.has(t.cs)?t.skip=!0:e.add(t.cs)
    }
    for(let t of r){
      if(s.over)break;
      t.skip||ye(t.cs,t.a,s,e)
    }
    let c=o.turnIncome?e:0;
    for(let e of s.cards)e.spamtonRampAcc=(e.spamtonRampAcc??0)+e.spamtonRamp,
    !e.dead&&(c+=e.card.spamton+e.spamtonGen+e.spamland+e.spamtonRampAcc);
    s.totals.spamton+=c,
    s.spamtonByTurn[e-1]=(s.spamtonByTurn[e-1]??0)+c,
    s.spamtonThreshold&&s.totals.spamton>200&&!s.thresholdDone&&(s.totals.spamton+=s.spamtonThreshold,s.thresholdDone=!0),
    s.healByTurn[e-1]=Math.max(0,s.totals.healOffered-p),
    p=s.totals.healOffered,
    !s.over&&!t.potential&&!h&&de(s,e),
    !s.over&&a&&!t.potential&&!h&&me(s,e)
  }
  let _=s.cards.reduce((e,t)=>e+t.hpMax,0),
  v=s.cards.reduce((e,t)=>e+t.hpMax*k(t,s),0),
  S=v+Math.min(s.totals.heal,_*.8)*.8+s.totals.defense,
  C=s.usefulByTurn.reduce((e,t,r)=>e+t*(1.5-.5*(r+1)/n),0),
  w=s.totals.spamton*o.spamtonValue+s.totals.luck*o.luckValue+s.totals.economy,
  ee=a?s.enemies.reduce((e,t)=>e+Math.max(0,t.hp),0):s.opp.totalHp-s.totals.dmg,
  O=a?s.opp.totalHp-ee:s.totals.dmg,
  A=s.ttk??(O>0?n+ee/(O/n):99),
  M=o.opponent.totalHp,
  N=3*(s.over?M*(1+1.5*(n-s.ttk)/n):Math.min(C*(M/s.opp.totalHp),M)),
  re=(a?s.enemies.reduce((e,t)=>e+(t.dmg??[]).slice(0,n).reduce((e,t)=>e+t,0),0):Array.from({length:n},(e,t)=>V(t+1)).reduce((e,t)=>e+t,0))*(Math.max(1,s.cards.length)/o.deckSize),
  P=s.pressureTaken,
  F=Math.max(0,re-P),
  ie=t.potential?{dmgByCard:s.dmgByCard,aoeByCard:s.aoeByCard,healByTurn:s.healByTurn,board:f}:null;
  return{
    opponent:s.opp.id,
    offense:N,
    dmgTotal:s.totals.dmg,
    dmgByTurn:s.dmgByTurn.map(e=>Math.round(e)),
    ttk:Math.round(A*10)/10,
    pressureTaken:P,
    pressureAvoided:F,
    ownDeaths:s.cards.filter(e=>e.dead).length,
    enemyHealed:s.enemyHealed,
    potential:ie,
    hpLeft:s.cards.reduce((e,t)=>e+(t.dead?0:Math.max(0,D(t))),0),
    ehpLeft:s.cards.reduce((e,t)=>e+(t.dead?0:Math.max(0,D(t))*k(t,s)),0),
    defenseCredits:s.totals.defense,
    defense:S,
    ehp:v,
    heal:s.totals.heal,
    hpTotal:_,
    control:s.totals.control,
    economy:w,
    spamton:s.totals.spamton,
    spamtonByTurn:s.spamtonByTurn,
    income:c,
    luckByTurn:s.luckByTurn,
    support:s.totals.support,
    teamBuff:s.totals.teamBuff,
    genPoints:s.totals.genPoints,
    genByElement:Object.fromEntries(i.map(e=>[e,Math.round(s.totals.genByElement[e]*10)/10])),
    bonusFinal:Object.fromEntries(i.map(e=>[e,Math.round(s.bonus[e]*10)/10])),
    useByElement:Object.fromEntries(i.map(e=>[e,Math.round(s.totals.useByElement[e])])),
    teamCrit:Math.round(s.team.crit),
    enemyRes:Math.round(x(s)),
    plan:s.plan,
    events:s.events,
    kills:s.enemyDeaths,
    talents:e.map((e,t)=>s.cards.find(e=>e.idx===t)?.talents[0]??null),
    casts:s.totals.casts
  }
}
function J(e,t=s){
  return e.offense*t.offense+(e.ehpLeft+e.defenseCredits)*t.defense+e.control*t.control+e.economy*t.economy
}
const we=[1,2],
Y=e=>e.reduce((e,t)=>e+t,0)/e.length;
function X(e,t={}){
  let n=t.player?[t.player]:we,
  r=d.flatMap(r=>n.map(n=>{
    let i=q(e,{...t,opponent:r,player:n});
    return{id:r.id,player:n,result:i,score:J(i)}
  })),
  i=r.find(e=>e.id===`neutral`&&e.player===n[0])??r[0],
  a=Y(r.map(e=>e.score)),
  o=e=>Math.round(e*10)/10,
  s=d.map(e=>{
    let t=r.filter(t=>t.id===e.id);
    return{
      id:e.id,
      score:Y(t.map(e=>e.score)),
      ttk:o(Y(t.map(e=>e.result.ttk))),
      kills:o(Y(t.map(e=>e.result.kills))),
      dmgTotal:Math.round(Y(t.map(e=>e.result.dmgTotal)))
    }
  }),
  c=s.find(e=>e.id===`neutral`)??s[0],
  l=s.map(e=>({...e,deltaPct:c.score>0&&Math.round((e.score-c.score)/c.score*1e3)/10||0})),
  u=n.map(e=>{
    let t=r.filter(t=>t.player===e),
    n=Y(t.map(e=>e.score));
    return{player:e,score:n,ttk:o(Y(t.map(e=>e.result.ttk))),deltaPct:a>0&&Math.round((n-a)/a*1e3)/10||0}
  });
  return{score:a,result:i.result,matchups:l,positions:u}
}
function Te(e,t={}){
  let n=t.talentMode??o.talentMode;
  if(n===`all`||n===`none`){
    let n=X(e.map(e=>({card:e,talent:null})),t);
    return{
      result:n.result,
      talents:e.map(()=>null),
      score:n.score,
      matchups:n.matchups,
      positions:n.positions,
      neutralScore:J(n.result)
    }
  }
  let r=t.player?[t.player]:we,
  {talents:i,score:a}=Ee(e,e=>Y(r.map(n=>J(q(e,{...t,player:n}))))),
  s=X(e.map((e,t)=>({card:e,talent:e.talents.length?i[t]:null})),t);
  return{result:s.result,talents:i,score:s.score,matchups:s.matchups,positions:s.positions,neutralScore:a}
}
function Ee(e,t){
  let n=-1/0,
  r=null;
  for(let i of De(e)){
    let a=t(e.map((e,t)=>({card:e,talent:e.talents.length?i[t]:null})));
    a>n&&(n=a,r=i)
  }
  return{talents:r,score:n}
}
function*De(e){
  let t=e.map(e=>Math.max(1,e.talents.length)),
  n=t.reduce((e,t)=>e*t,1);
  for(let r=0;r<n;r++){
    let n=r,
    i=[];
    for(let r=0;r<e.length;r++)i.push(n%t[r]),
    n=Math.floor(n/t[r]);
    yield i
  }
}
const Oe=(e,t)=>(e+t)/2;
function ke(e,t){
  let n=e.length;
  if(!n)return 0;
  let r=0;
  for(let n of e)n<t&&r++;
  return r/n*100
}
function Ae(e){
  for(let t of l)if(e>=t.q*100)return t.tier;
  return`D`
}
const je=e=>t=>t.card.element===e||t.tags.has(`atk:${e}`)||t.tags.has(`gen:${e}`);
function Me(e){
  if(o.talentMode===`all`||!e.talents.length)return null;
  let t=0,
  n=-1/0;
  return e.talents.forEach((r,i)=>{
    let a=J(q([{card:e,talent:i}]));
    a>n&&(n=a,t=i)
  }),
  t
}
function Ne(e){
  let t=new Map(e.map(e=>[e.card.number,J(q([{card:e.card,talent:e.talent}]))]));
  return i.map(n=>e.filter(je(n)).sort((e,n)=>t.get(n.card.number)-t.get(e.card.number)||e.card.number-n.card.number).slice(0,o.deckSize)).filter(e=>e.length>=o.deckSize)
}
function Pe(e,t){
  return e.filter(e=>e.card.number!==t.number).slice(0,o.deckSize-1).map(e=>({card:e.card,talent:e.talent}))
}
function Fe(e,t){
  let n=e.talents.map(()=>0),
  r=0;
  for(let i of t){
    let t=Pe(i,e);
    if(!(t.length<o.deckSize-1)){
      if(r++,o.talentMode===`all`){
        let r=J(q([...t,{card:e,talent:null}]));
        e.talents.forEach((i,a)=>{
          let o=[];
          o[t.length]=[a],
          n[a]+=r-J(q([...t,{card:e,talent:null}],{excludeTalents:o}))
        })
      }else{
        let r=J(q([...t,{card:e,talent:null}]));
        e.talents.forEach((i,a)=>{
          n[a]+=J(q([...t,{card:e,talent:a}]))-r
        })
      }
    }
  }
  return e.talents.map((e,t)=>({name:e.name,kind:e.kind,delta:r?n[t]/r:0}))
}
function Ie(e,t){
  if(o.talentMode===`all`||!e.talents.length)return null;
  let n=0;
  return t.forEach((e,r)=>{
    e.delta>t[n].delta&&(n=r)
  }),
  n
}
function Le(e){
  let t=T([{card:e}]),
  n=i.reduce((e,n)=>e+t[n],0),
  r={};
  for(let e of i)r[e]=n>0?3*t[e]/n:0;
  return n===0&&e.element!==`divine`&&(r[e.element]=3),
  r
}
function Re(e,t){
  let n=/* @__PURE__ */ new Set,
  r=t.atkProfile;
  for(let e of i)r[e]>=8&&n.add(`atk:${e}`),
  (t.genByElement[e]??0)/o.simTurns>=.8&&n.add(`gen:${e}`);
  t.generation/o.simTurns>=3&&n.add(`bigGen`),
  t.generation/o.simTurns>=1&&n.add(`gen`);
  for(let t of e.abilities){
    let e=t.options,
    r=Math.max(...e.map(e=>e.hits.filter(e=>!e.pctMaxHp).reduce((e,t)=>e+Oe(t.min,t.max),0)),0);
    e.some(e=>e.target===`aoeEnemy`&&e.hits.length)&&n.add(`aoe`),
    r>=80&&n.add(`nuke`),
    r>0&&t.cd>=6&&n.add(`longCd`),
    r>0&&t.cd===1&&n.add(`spam`),
    t.cost&&n.add(`cost`),
    t.echo>0&&n.add(`echo`),
    e.some(e=>e.heals.some(e=>!e.self))&&n.add(`heal`),
    e.some(e=>e.heals.some(e=>e.self))&&n.add(`selfheal`),
    e.some(e=>e.heals.some(e=>e.target===`allAllies`))&&n.add(`healAll`),
    e.some(e=>e.hits.some(e=>e.pctMaxHp))&&n.add(`pctHp`),
    e.some(e=>e.target===`randomEnemy`||e.target===`spreadEnemy`)&&n.add(`randomTarget`);
    for(let t of e)for(let e of t.effects)e.type===`stun`&&n.add(`stun`),
    e.type===`eternity`&&n.add(`eternity`),
    e.type===`temporality`&&n.add(e.scope===`team`?`temporalityTeam`:`temporalityAlly`),
    e.type===`taunt`&&n.add(`taunt`),
    (e.type===`absorbAny`||e.type===`setHpPct`&&e.value<=50)&&n.add(`execute`),
    e.type===`resurrect`&&n.add(`resurrect`),
    e.type===`crit`&&e.scope===`team`&&n.add(`critTeam`),
    e.type===`crit`&&e.scope===`card`&&n.add(`critSelf`),
    e.type===`prec`&&[`team`,`ally`,`randomAlly`].includes(e.scope)&&n.add(`precTeam`),
    e.type===`base`&&[`team`,`ally`,`randomAlly`].includes(e.scope)&&n.add(`baseTeam`),
    e.type===`base`&&e.scope===`ability`&&n.add(`baseGrowth`),
    e.type===`hpMax`&&e.scope===`team`&&n.add(`hpTeam`),
    e.type===`res`&&e.scope===`enemy`&&n.add(`enemyRes`),
    e.type===`res`&&e.scope!==`enemy`&&n.add(`resBuff`),
    e.type===`enemyPrec`&&n.add(`enemyPrec`),
    e.type===`resetEnemyCd`&&n.add(`resetEnemyCd`),
    e.type===`resetEnemySpamton`&&n.add(`spamtonAttack`),
    e.type===`vanish`&&n.add(`vanish`),
    e.type===`vampirism`&&n.add(`vampirism`),
    e.type===`critMult`&&n.add(`critMult`);
    for(let t of e)for(let e of t.gen)e.growth&&n.add(`genGrowth`)
  }
  for(let t of e.passives){
    let e={
      reset:`reset`,
      avenger:`avenger`,
      revenge:`revenge`,
      phoenix:`phoenix`,
      berserk:`berserk`,
      multiplicator:`multiplicator`,
      brut:`brut`,
      immunity:`immune`,
      lifesteal:`vampirism`,
      erosion:`erosion`,
      stunOnHit:`stunOnHit`,
      eternityOnHit:`eternityOnHit`,
      temporalityOnHit:`temporalityOnHit`,
      vanishOnHit:`disparition`,
      cimetiere:`cimetiere`,
      coeur:`coeur`,
      punchingBag:`punchingBag`,
      poison:`poison`,
      reflect:`reflect`,
      recoil:`recoil`,
      tenacity:`tenacity`,
      mystery:`mystery`,
      mimetism:`mimetism`,
      smoke:`smoke`,
      tauntOnAttack:`tauntOnAttack`,
      regen:`regen`,
      luck:`luck`,
      teamRes:`resBuff`,
      hpGrowth:`hpGrowth`
    };
    e[t.type]&&n.add(e[t.type])
  }(e.hp>=900||e.avgRes>=20)&&n.add(`tank`),
  e.negRes.length&&n.add(`negRes`),
  e.spamton>=10&&n.add(`highSpamton`),
  e.spamton<=4&&n.add(`lowSpamton`),
  e.abilities.some(e=>e.hasDamage)||n.add(`noDamage`),
  e.rows<3&&n.add(`toxSlot`);
  for(let t of e.talents)n.add(`talent:${t.name}`);
  return n
}
function ze(e,t){
  let n=Le(e),
  r=q([{card:e,talent:t}]),
  i=q([{card:e,talent:t}],{externalGen:n}),
  a={
    card:e,
    talent:t,
    talentName:t==null?null:e.talents[t]?.name??null,
    soloResult:r,
    supportedResult:i,
    offense:i.offense,
    offenseSolo:r.offense,
    generation:r.genPoints,
    genByElement:r.genByElement,
    defense:r.defense,
    support:r.support+r.teamBuff,
    control:r.control,
    economy:r.economy,
    atkProfile:T([{card:e}])
  };
  return a.tags=Re(e,a),
  a
}
const Be={
  offense:`Attaquant`,
  generation:`Générateur`,
  support:`Soutien`,
  defense:`Tank`,
  control:`Contrôle`,
  economy:`Économie`
};
function Ve(e){
  let t={};
  for(let n of Object.keys(Be)){
    let r=e.map(e=>e[n]).filter(e=>e>0).sort((e,t)=>e-t);
    t[n]=r.length?r[Math.floor(r.length/2)]:1/0
  }
  return t
}
function He(e,t){
  let n=[];
  for(let[r,i]of Object.entries(Be))e.pct[r]>=75&&e[r]>=t[r]&&n.push(i);
  return n.length?n:[Object.keys(Be).filter(t=>e.pct[t]>=50).length>=2?`Polyvalent`:`Utilitaire`]
}
function Ue(e){
  let t=Ne(e.map(e=>ze(e,Me(e)))),
  n=e.map(e=>{
    let n=Fe(e,t),
    r=ze(e,Ie(e,n));
    return r.talentDeltas=n,
    r
  }),
  r=[`offense`,`offenseSolo`,`generation`,`defense`,`support`,`control`,`economy`],
  i=Object.fromEntries(r.map(e=>[e,n.map(t=>t[e])]));
  for(let e of n){
    e.pct={};
    for(let t of r)e.pct[t]=ke(i[t],e[t]);
    e.overall=0;
    for(let[t,n]of Object.entries(c))e.overall+=n*e.pct[t]
  }
  let a=n.map(e=>e.overall);
  for(let e of n)e.overallPct=ke(a,e.overall),
  e.tier=Ae(e.overallPct);
  let o=Ve(n);
  for(let e of n)e.roles=He(e,o);
  n.sort((e,t)=>t.overall-e.overall),
  n.forEach((e,t)=>{
    e.rank=t+1
  });
  let s=e.map(e=>ze(e,null)),
  l=Object.fromEntries(r.map(e=>[e,s.map(t=>t[e])]));
  for(let e of s){
    e.pct={};
    for(let t of r)e.pct[t]=ke(l[t],e[t]);
    e.overall=0;
    for(let[t,n]of Object.entries(c))e.overall+=n*e.pct[t]
  }
  let u=s.map(e=>e.overall),
  d=new Map(s.map(e=>[e.card.number,e])),
  f=new Map([...s].sort((e,t)=>t.overall-e.overall||e.card.number-t.card.number).map((e,t)=>[e.card.number,t+1]));
  for(let e of n){
    let t=d.get(e.card.number),
    n=ke(u,t.overall);
    e.noTalent={
      overall:t.overall,
      overallPct:n,
      tier:Ae(n),
      rank:f.get(e.card.number),
      pct:t.pct,
      metrics:{
        offense:t.offense,
        offenseSolo:t.offenseSolo,
        generation:t.generation,
        defense:t.defense,
        support:t.support,
        control:t.control,
        economy:t.economy
      }
    }
  }
  return n
}
const Z=e=>Number(String(e).replace(`,`,`.`)),
We={
  Aoe:(e,t)=>({type:`aoe`,pct:Z(t.match(/(\d+)%/)?.[1]??20)}),
  Berserk:(e,t)=>({type:`berserk`,pct:Z(t.match(/(\d+)%/)?.[1]??12)}),
  Brut:()=>({type:`brut`}),
  Chance:(e,t)=>({type:`luck`,perTurn:Z(t.match(/\(\+?([\d,]+)\)/)?.[1]??.5)}),
  Cimetiere:(e,t)=>({type:`cimetiere`,value:Z(t.match(/\(\+?(\d+)\)/)?.[1]??3)}),
  CoeurEau:(e,t)=>({type:`coeur`,element:`water`,perTurn:Z(t.match(/\(\+?(\d+)\)/)?.[1]??1)}),
  CoeurFeu:(e,t)=>({type:`coeur`,element:`fire`,perTurn:Z(t.match(/\(\+?(\d+)\)/)?.[1]??1)}),
  CoeurLumiere:(e,t)=>({type:`coeur`,element:`light`,perTurn:Z(t.match(/\(\+?(\d+)\)/)?.[1]??1)}),
  CoeurNature:(e,t)=>({type:`coeur`,element:`nature`,perTurn:Z(t.match(/\(\+?(\d+)\)/)?.[1]??1)}),
  CoeurOmbre:(e,t)=>({type:`coeur`,element:`shadow`,perTurn:Z(t.match(/\(\+?(\d+)\)/)?.[1]??1)}),
  CoeurTerre:(e,t)=>({type:`coeur`,element:`earth`,perTurn:Z(t.match(/\(\+?(\d+)\)/)?.[1]??1)}),
  CoeurResistance:(e,t)=>({type:`teamRes`,value:Z(t.match(/\(\+?(\d+)\)/)?.[1]??3)}),
  CoeurVital:(e,t)=>({type:`hpGrowth`,perTurn:Z(t.match(/de (\d+)/)?.[1]??15)}),
  ContreCoup:(e,t)=>({type:`recoil`,pct:Z(t.match(/(\d+)%/)?.[1]??50)}),
  Disparition:()=>({type:`vanishOnHit`}),
  Erosion:(e,t)=>({type:`erosion`,pct:Z(t.match(/(\d+)%/)?.[1]??50)}),
  Eternity:()=>({type:`eternityOnHit`}),
  Immunity:()=>({type:`immunity`}),
  "Life Steal":(e,t)=>({type:`lifesteal`,pct:Z(t.match(/(\d+)%/)?.[1]??25)}),
  Mimetisme:()=>({type:`mimetism`}),
  Multiplicator:()=>({type:`multiplicator`}),
  Mystere:()=>({type:`mystery`}),
  Phoenix:(e,t)=>({type:`phoenix`,pct:Z(t.match(/(\d+)%/)?.[1]??25)}),
  Poison:()=>({type:`poison`,pct:1,turns:3}),
  "Primitive heal":(e,t)=>({type:`regen`,pct:Z(t.match(/(\d+)%/)?.[1]??4)}),
  PunchingBag:()=>({type:`punchingBag`}),
  Reflect:(e,t)=>({type:`reflect`,pct:Z(t.match(/(\d+)%/)?.[1]??25)}),
  Reset:()=>({type:`reset`}),
  Revenge:()=>({type:`revenge`}),
  Smoked:()=>({type:`smoke`}),
  Stun:()=>({type:`stunOnHit`}),
  Taunt:()=>({type:`tauntOnAttack`}),
  Temporality:()=>({type:`temporalityOnHit`}),
  Tenacite:()=>({type:`tenacity`}),
  Vengeur:()=>({type:`avenger`}),
  Spamland:()=>({type:`spamland`,perTurn:3}),
  Bomba:()=>({type:`bomba`,value:500}),
  Inversement:()=>({type:`inversion`}),
  MetamorphSimple:()=>({type:`metamorph`}),
  Metamorph:()=>({type:`metamorph`,choice:!0}),
  CoeurCorrompu:()=>({type:`coeur`,element:`random`,perTurn:2}),
  Frozen:(e,t)=>({type:`freezeOnHit`,value:Z(t.match(/(\d+) dégâts/)?.[1]??40)}),
  Shield:(e,t)=>({type:`shield`,pct:Z(t.match(/(\d+)%/)?.[1]??25)}),
  Optimisation:()=>({type:`optimisation`})
};
function Ge(e,t){
  let n=(e.id??``).replace(/_[CRELD]$/i,``),
  r=We[n],
  i=e.rarity??`common`;
  return r?{id:e.id,name:e.name,rarity:i,text:e.effect,...r(e.id,e.effect??``)}:(t?.warnings.push(`passif inconnu ${e.id}`),{id:e.id,name:e.name,rarity:i,type:`unknown`,text:e.effect})
}
const Ke={
  fr:{fire:`Feu`,water:`Eau`,earth:`Terre`,nature:`Nature`,shadow:`Ombre`,light:`Lumière`},
  en:{fire:`Fire`,water:`Water`,earth:`Earth`,nature:`Nature`,shadow:`Shadow`,light:`Light`}
},
qe=e=>String(e).replace(`.`,`,`),
Je={
  Aoe:{
    fr:[`AoE`,e=>`Attaque et soigne les cibles adjacentes à hauteur de ${e}% des dégâts infligés`],
    en:[`AoE`,e=>`Attacks and heals adjacent targets for ${e}% of the damage dealt.`]
  },
  Berserk:{
    fr:[`Berserk`,e=>`Les dégâts et les soins de toutes vos cartes sont augmentés de ${e}%`],
    en:[`Berserk`,e=>`Damage and healing of all your cards are increased by ${e}%.`]
  },
  Chance:{
    fr:[`Chanceur`,e=>`Augmente votre Chance de (+${qe(e)}) chaque tour`],
    en:[`Lucky`,e=>`Increases your Luck by (+${e}) each turn.`]
  },
  Cimetierre:{
    fr:[`Cimetière`,e=>`Augmente tous vos bonus élémentaires de (+${e}) lorsqu'une carte meurt`],
    en:[`Graveyard`,e=>`Raises all your elemental bonuses by (+${e}) whenever a card dies.`]
  },
  CoeurElement:{
    fr:[`Cœur`,(e,t)=>`Bonus ${Ke.fr[t]??`de l’élément de la carte`} (+${e}) par tour de jeu`],
    en:[`Heart`,(e,t)=>`${Ke.en[t]??`Card element`} bonus (+${e}) each turn.`]
  },
  CoeurResistance:{
    fr:[`Cœur de résistance`,e=>`Cette carte augmente les résistances de toutes les cartes alliées (+${e})`],
    en:[`Heart of Resistance`,e=>`This card raises the resistances of all allied cards (+${e}).`]
  },
  CoeurVital:{
    fr:[`Cœur vital`,e=>`Cette carte augmente ses PV max de ${e} chaque tour`],
    en:[`Vital Heart`,e=>`This card gains ${e} max HP each turn.`]
  },
  Erosion:{
    fr:[`Érosion`,e=>`Réduit les PV max à hauteur de ${e}% des dégâts infligés`],
    en:[`Erosion`,e=>`Reduces max HP by ${e}% of the damage dealt.`]
  },
  LifeSteal:{
    fr:[`Vampirisme`,e=>`Régénère ${e}% des dégâts infligés à la cible`],
    en:[`Lifesteal`,e=>`Heals for ${e}% of the damage dealt to the target.`]
  },
  Poisoned:{
    fr:[`Poison`,e=>`Inflige des dégâts égaux à ${e}% des PV max de la cible au début de chacun de ses tours, pendant 3 tours`],
    en:[`Poison`,e=>`Deals damage equal to ${e}% of the target's max HP at the start of each of its turns, for 3 turns.`]
  },
  SoinPrimitif:{
    fr:[`Soin primitif`,e=>`Au début de chaque tour, la carte récupère ${e}% de ses PV max`],
    en:[`Primitive Heal`,e=>`At the start of each turn, the card recovers ${e}% of its max HP.`]
  },
  SacDeFrappe:{
    fr:[`Sac de frappe`,e=>`Augmente de +${e} l'élément de la carte du lanceur à chaque fois que celle-ci subit une attaque`],
    en:[`Punching Bag`,e=>`Raises the card's element bonus by +${e} each time it is attacked.`]
  },
  Renvoie:{
    fr:[`Renvoi`,e=>`Renvoie ${e}% des dégâts subis à l'attaquant`],
    en:[`Reflect`,e=>`Reflects ${e}% of the damage taken back to the attacker.`]
  },
  Phoenix:{
    fr:[`Phénix`,e=>`Lorsqu’elle est détruite, cette carte revient à la vie avec ${e}% de ses PV max.\nUsage unique`],
    en:[`Phoenix`,e=>`When destroyed, this card comes back to life with ${e}% of its max HP.\nSingle use`]
  },
  Shield:{
    fr:[`Bouclier`,e=>`Le premier coup reçu à chaque tour adverse est réduit de ${e}%`],
    en:[`Shield`,e=>`The first hit taken each enemy turn is reduced by ${e}%.`]
  },
  SpamLand:{
    fr:[`Spamland`,e=>`Génère (+${e}) Spamtons chaque tour`],
    en:[`Spamland`,e=>`Generates (+${e}) Spamtons each turn.`]
  },
  Bomba:{
    fr:[`Bomba`,e=>`Inflige ${e} dégâts bruts à une carte adverse aléatoire quand cette carte meurt`],
    en:[`Bomba`,e=>`Deals ${e} raw damage to a random enemy card when this card dies.`]
  },
  Metamorph:{
    fr:[`Métamorphe`,()=>`Choisissez une carte parmi trois de la même rareté pour remplacer cette carte`],
    en:[`Shapeshifter`,()=>`Choose one of three random cards of the same rarity to replace this card.`]
  },
  MetamorphSimple:{
    fr:[`Métamorphe aléatoire`,()=>`Transforme la carte en une carte aléatoire de la même rareté`],
    en:[`Random shapeshifter`,()=>`Transforms the card into a random card of the same rarity.`]
  },
  Optimisation:{
    fr:[`Optimisation`,()=>`Les valeurs variables des dégâts, des soins et des bonus de cette carte sont toujours au maximum`],
    en:[`Optimisation`,()=>`Variable damage, healing and bonus values of this card always roll their maximum.`]
  },
  Inversement:{
    fr:[`Inversement`,()=>`Les dégâts de cette carte deviennent des soins, ses Éternités des Temporalités, et inversement.`],
    en:[`Inversion`,()=>`This card’s damage becomes healing, its Eternities become Temporalities, and vice versa.`]
  }
};
function Ye(e,t=`fr`){
  let n=r[e],
  i=n&&Je[n.effect];
  if(!i)return null;
  let[a,o]=i[t]??i.fr;
  return{name:a,effect:o(n.value,n.element)}
}
const Xe=e=>e.replace(/_[CRELD]$/i,``),
Q=[`common`,`rare`,`epic`,`legendary`];
function Ze(e,t){
  let n=e.length;
  if(n===1||t<=e[0].time)return e[0].value;
  if(t>=e[n-1].time)return e[n-1].value;
  let r=0,
  i=n-1;
  for(;i-r>1;){
    let n=r+i>>1;
    e[n].time<=t?r=n:i=n
  }
  let a=e[r],
  o=e[r+1],
  s=o.time-a.time;
  if(s<=0)return o.value;
  let c=(t-a.time)/s,
  l=c*c,
  u=l*c;
  return(2*u-3*l+1)*a.value+(u-2*l+c)*s*a.outSlope+(-2*u+3*l)*o.value+(u-l)*s*o.inSlope
}
const Qe=/* @__PURE__ */ new Map;
function $e(e,n=!1){
  if(n)return{...u.luckyOdds};
  let r=Math.round(e*10);
  if(Qe.has(r))return Qe.get(r);
  let i=Object.fromEntries(Q.map(n=>[n,Math.max(0,Ze(t[n],e))])),
  a=Q.reduce((e,t)=>e+i[t],0),
  o={common:0,rare:0,epic:0,legendary:0};
  if(a<=0)o.common=1e3;
  else for(let e=0;e<1e3;e++){
    let t=Math.min(Math.max(e/10,0),a)*a/100;
    t<=i.common?o.common++:t<=i.common+i.rare?o.rare++:t<=i.common+i.rare+i.epic?o.epic++:o.legendary++
  }
  let s=Object.fromEntries(Q.map(e=>[e,o[e]/1e3]));
  return Qe.set(r,s),
  s
}
const et={
  element:[`coeur`,`cimetiere`,`punchingBag`,`multiplicator`,`mimetism`],
  offense:[`aoe`,`berserk`,`erosion`,`poison`,`brut`,`bomba`,`reset`,`avenger`,`revenge`,`recoil`,`optimisation`],
  defense:[`teamRes`,`hpGrowth`,`phoenix`,`reflect`,`regen`,`tenacity`,`lifesteal`,`immunity`,`smoke`,`shield`],
  control:[`tauntOnAttack`,`taunt`,`vanishOnHit`,`vanish`,`eternityOnHit`,`eternity`,`stunOnHit`,`stun`,`temporalityOnHit`,`temporality`,`freezeOnHit`,`freeze`],
  economy:[`luck`,`spamland`,`spamtonGen`],
  special:[`metamorph`,`mystery`,`inversion`]
},
tt=e=>Object.keys(et).find(t=>et[t].includes(e))??`special`,
nt=e=>r[e]?`${r[e].effect}|${r[e].element??``}`:Xe(e),
rt=new Set(Object.values(u.pools).flat());
function it(e){
  let t=/* @__PURE__ */ new Map,
  n=/* @__PURE__ */ new Map;
  for(let r of e)for(let e of r.rawSkills??[])t.has(e.id)||t.set(e.id,e),
  n.has(Xe(e.id))||n.set(Xe(e.id),e.name);
  for(let[e,r]of Object.entries(u.pools))for(let i of r){
    if(t.has(i))continue;
    let r=Ye(i,`fr`);
    r&&t.set(i,{id:i,name:n.get(Xe(i))??r.name,rarity:e,effect:r.effect})
  }
  let i=[];
  for(let e of t.values()){
    let t=Ge({id:e.id,name:e.name,rarity:e.rarity,effect:e.effect},null);
    t.type!==`unknown`&&i.push({
      id:e.id,
      name:e.name,
      rarity:e.rarity,
      text:e.effect,
      family:tt(t.type),
      passive:{...t,shop:!0},
      purchasable:rt.has(e.id),
      cost:r[e.id]?.cost??null
    })
  }
  return i.sort((e,t)=>a[e.rarity]-a[t.rarity]||e.name.localeCompare(t.name,`fr`)||e.id.localeCompare(t.id)),
  i
}
function at(e,t){
  return e.map((e,n)=>({card:e.card,talent:t?t[n]:e.talent}))
}
function ot(e,t,n,r,i){
  let a=new Map(e.map(e=>[e.tox.id,Math.max(0,e.gain)])),
  o=[];
  for(let e of Q){
    let s=n.filter(t=>t.rarity===e&&!r.has(t.id));
    if(s.length&&t[e])for(let n of s)o.push({p:t[e]/s.length,g:u.usePrices&&n.cost!=null&&n.cost>i?0:a.get(n.id)??0})
  }
  let s=o.reduce((e,t)=>e+t.p,0);
  if(!s)return 0;
  o.sort((e,t)=>e.g-t.g);
  let c=0,
  l=0;
  for(let e of o){
    let t=c;
    c+=e.p/s,
    l+=e.g*(c**u.items-t**u.items)
  }
  return l
}
function st(e,t,n,r={}){
  let i=at(e,t),
  s=q(i),
  c=J(s),
  l=n.filter(e=>e.purchasable!==!1),
  d=u.canReplace!==`none`,
  f=u.canReplace===`any`,
  p=e.map(e=>Math.max(0,u.maxRows-e.card.rows)),
  m=e.map(()=>({added:[],removed:[]})),
  h=e.map(e=>new Set(e.card.abilities.map(e=>e.id).filter(Boolean))),
  g=e=>({
    extraPassives:e.map(e=>e.added.map(e=>e.passive)),
    removePassives:e.map((e,t)=>e.removed.filter(e=>!h[t].has(e))),
    removeAbilities:e.map((e,t)=>e.removed.filter(e=>h[t].has(e)))
  }),
  _=e=>J(q(i,g(e))),
  v=e=>X(i,g(e)).score,
  y=v(e.map(()=>({added:[],removed:[]}))),
  b=e=>e.map(e=>({added:[...e.added],removed:[...e.removed]})),
  x=e=>new Set(e.flatMap(e=>[...e.added.map(e=>e.id),...e.removed])),
  S=(e,t)=>p[t]+e[t].removed.length-e[t].added.length>0,
  C=e.map((e,t)=>Object.fromEntries([...e.card.passives.map(e=>[e.id,e]),...e.card.abilities.filter(e=>e.id).map(e=>[e.id,e])].map(([e])=>{
    let n=b(m);
    return n[t].removed.push(e),
    [e,y-v(n)]
  }))),
  w=(e,t)=>(C[e][t]??0)>=u.coreMinLossPct/100*y,
  T=(t,n)=>e[t].card.passives.find(e=>e.id===n),
  E=(e,t,n)=>{
    if(!w(t,n))return!0;
    let r=T(t,n);
    return!!r&&nt(e.id)===nt(r.id)&&(a[e.rarity]??0)>(a[r.rarity]??0)
  },
  ee=(t,n)=>{
    let r=s.plan.map((r,i)=>r.filter(r=>r.cardId===e[t].card.id&&r.abilityId===n).length?i+1:0).filter(Boolean);
    return{
      casts:s.plan.reduce((r,i)=>r+i.filter(r=>r.cardId===e[t].card.id&&r.abilityId===n).length,0),
      firstTurn:r[0]??null
    }
  },
  te=t=>[
    ...e[t].card.passives.map(e=>({id:e.id,name:e.name,kind:`passive`})),
    ...f?e[t].card.abilities.filter(e=>e.id).map(e=>({id:e.id,name:e.name,kind:`ability`})):[]
  ].sort((e,n)=>C[t][e.id]-C[t][n.id]),
  ne=(t,n)=>{
    let r=[],
    i=x(t);
    for(let a of l){
      if(i.has(a.id))continue;
      let o=null;
      for(let r=0;r<e.length;r++){
        let e=[];
        if(S(t,r)&&e.push({replace:null}),d)for(let n of te(r))!t[r].removed.includes(n.id)&&E(a,r,n.id)&&e.push({replace:n});
        for(let i of e){
          let e=b(t);
          i.replace&&e[r].removed.push(i.replace.id),
          e[r].added.push(a);
          let s=_(e)-n;
          (!o||s>o.gain+1e-6)&&(o={tox:a,card:r,replace:i.replace,gain:s,next:e})
        }
      }
      o&&r.push(o)
    }
    return r.sort((e,t)=>t.gain-e.gain),
    r
  },
  D=Math.min(o.simTurns,Math.ceil(s.ttk??o.simTurns)),
  O=e=>Math.round((s.spamtonByTurn??[]).slice(0,e).reduce((e,t)=>e+(t??0),0)),
  k=[];
  for(let e=u.everyTurns;e<=Math.max(u.everyTurns,D);e+=u.everyTurns){
    let t=s.luckByTurn?.[e-1]??e;
    k.push({turn:e,luck:t,odds:$e(t,r.lucky),spamton:O(e)})
  }
  let A=(e,t,n)=>{
    let r=[];
    for(let i of l){
      if(n&&!E(i,t,n))continue;
      let a=b(e);
      n&&a[t].removed.push(n),
      a[t].added.push(i);
      let o=_(a)-c;
      o>0&&r.push({tox:i,next:a,g:o})
    }
    r.sort((e,t)=>t.g-e.g);
    let i=[];
    for(let{tox:e,next:t}of r.slice(0,u.robustCandidates)){
      let n=v(t)-y;
      n>0&&i.push({tox:e.name,id:e.id,rarity:e.rarity,gainPct:100*n/y})
    }
    return i.sort((e,t)=>t.gainPct-e.gainPct)
  },
  j=/* @__PURE__ */ new Map,
  M=e.map((e,t)=>{
    let n=[],
    r=(e,n,r)=>(n[0]?.gainPct??0)>=u.replaceMinGainPct?`remplacer`:e&&w(t,e)?`coeur`:r?`garder`:`fixe`;
    for(let i of e.card.abilities){
      let e=f&&i.id?A(m,t,i.id):[],
      a=i.id?C[t][i.id]:null;
      n.push({
        kind:`ability`,
        id:i.id??null,
        name:i.name,
        text:i.text,
        valuePct:a==null?null:100*a/y,
        core:!!i.id&&w(t,i.id),
        ...ee(t,i.id),
        verdict:r(i.id,e,f),
        candidates:e.filter(e=>e.gainPct>=u.minGainPct).slice(0,6)
      })
    }
    for(let i of e.card.passives){
      let e=C[t][i.id],
      a=d?A(m,t,i.id):[];
      n.push({
        kind:`passive`,
        id:i.id,
        name:i.name,
        rarity:i.rarity,
        text:i.text,
        valuePct:100*e/y,
        core:w(t,i.id),
        verdict:r(i.id,a,d),
        candidates:a.filter(e=>e.gainPct>=u.minGainPct).slice(0,6)
      })
    }
    for(let e=0;e<p[t];e++){
      j.has(t)||j.set(t,A(m,t,null));
      let e=j.get(t);
      n.push({
        kind:`free`,
        name:`Ligne libre`,
        verdict:e.length&&e[0].gainPct>=u.minGainPct?`acheter`:`vide`,
        candidates:e.slice(0,6)
      })
    }
    return{card:e.card.name,cardId:e.card.id,role:e.roles?.[0]??null,free:p[t],lines:n}
  }),
  N=ne(m,c),
  re=k.length?ot(N,k[0].odds,l,x(m),k[0].spamton):0,
  P=[],
  F=b(m),
  ie=c,
  ae=y,
  I=0,
  L=N,
  oe=e=>(e.replace?u.replaceMinGainPct:u.minGainPct)/100*y;
  for(let t of k.slice(0,u.maxPlan)){
    let n=t.spamton-I,
    r=null,
    i=0;
    for(let e of L){
      if(e.gain<=0||t.odds[e.tox.rarity]<u.minRarityOdds||u.usePrices&&e.tox.cost!=null&&e.tox.cost>n)continue;
      if(i++>=u.robustTries)break;
      let a=v(e.next)-ae;
      if(a>=oe(e)){
        r={...e,robustGain:a};
        break
      }
    }
    r&&(F=r.next,ie+=r.gain,ae+=r.robustGain,I+=u.usePrices?r.tox.cost??0:0,P.push({
      step:P.length+1,
      turn:t.turn,
      luck:t.luck,
      rarityOdds:t.odds[r.tox.rarity],
      tox:r.tox.name,
      id:r.tox.id,
      rarity:r.tox.rarity,
      card:e[r.card].card.name,
      cardId:e[r.card].card.id,
      replaces:r.replace?.name??null,
      replacesId:r.replace?.id??null,
      replacesKind:r.replace?.kind??null,
      gain:r.robustGain,
      gainPct:100*r.robustGain/y,
      cumulativePct:100*(ae-y)/y
    }),L=ne(F,ie))
  }
  let R=k[k.length-1],
  z=R?ot(L,R.odds,l,x(F),R.spamton-I):0,
  B=/* @__PURE__ */ new Map;
  for(let e of N)B.set(e.tox.name,Math.max(B.get(e.tox.name)??-1/0,e.gain));
  let se=[...B.entries()].filter(([,e])=>e<=0).map(([e])=>e).sort((e,t)=>e.localeCompare(t,`fr`)),
  ce=[...new Set(l.filter(e=>se.includes(e.name)).map(e=>e.id))],
  le=e.map((e,t)=>{
    let n=k[0]?.odds??$e(u.everyTurns,r.lucky),
    i=0;
    for(let e of Q){
      let r=l.filter(t=>t.rarity===e);
      if(!r.length)continue;
      let a=r.map(e=>{
        let n=N.find(t=>t.tox.id===e.id);
        return n&&n.card===t?Math.max(0,n.gain):0
      });
      i+=n[e]*(a.reduce((e,t)=>e+t,0)/a.length)
    }
    return{card:e.card.name,cardId:e.card.id,free:p[t],evPct:100*i/c}
  }),
  ue=k.map(e=>({
    turn:e.turn,
    spamton:e.spamton,
    luck:e.luck,
    odds:Object.fromEntries(Q.map(t=>[t,Math.round(e.odds[t]*1e3)/10]))
  })),
  V=/* @__PURE__ */ new Map;
  for(let e of l){
    let t=nt(e.id);
    V.has(t)||V.set(t,[]),
    V.get(t).push(e.id)
  }
  let de=k.map(e=>ot(N,e.odds,l,/* @__PURE__ */ new Set,e.spamton)),
  fe=e=>k.some(t=>t.odds[e.tox.rarity]>=u.minRarityOdds&&(!u.usePrices||e.tox.cost==null||e.tox.cost<=t.spamton)),
  H=[...V].map(([e,t])=>{
    let n=l.filter(e=>!t.includes(e.id)),
    r=k.reduce((e,t,r)=>e+de[r]-ot(N,t.odds,n,/* @__PURE__ */ new Set,t.spamton),0),
    i=N.filter(e=>t.includes(e.tox.id)&&fe(e)).reduce((e,t)=>Math.max(e,t.gain),0);
    return{family:e,ids:t,lossPct:100*r/c,bestGainPct:100*i/c}
  }).sort((e,t)=>t.lossPct-e.lossPct||e.family.localeCompare(t.family)),
  U=p.reduce((e,t)=>e+t,0)+(d?e.reduce((e,t)=>e+t.card.passives.length,0):0)+(f?e.reduce((e,t)=>e+t.card.abilities.filter(e=>e.id).length,0):0),
  pe=P.length?P[P.length-1].cumulativePct:0,
  me;
  return me=U===0?`Aucune ligne disponible : la boutique est inutile pour ce deck.`:z/c<u.minGainPct/100?`Une fois ${P.length?`ces ${P.length} Tox posés`:`les meilleurs Tox posés`}, une ouverture ne rapporte plus que +${(100*z/c).toFixed(1)} % : passez et gardez vos Spamtons.`:`Même après ce plan, une ouverture vaut encore +${(100*z/c).toFixed(1)} % : continuez tant qu'une ligne peut accueillir un Tox.`,
  {
    cards:M,
    slots:e.map((e,t)=>({card:e.card.name,free:p[t],rows:e.card.rows})),
    slotsTotal:U,
    plan:P,
    potentialPct:pe,
    avoid:[...new Set(se)],
    avoidIds:ce,
    evNowPct:100*re/c,
    evAfterPct:100*z/c,
    evByCard:le,
    budget:Math.round(s.spamton),
    spent:I,
    openings:k.length,
    everyTurns:u.everyTurns,
    spamtonByOpening:ue,
    familyLoss:H,
    stop:me,
    _firstFull:N.map(t=>({id:t.tox.id,gainPct:100*t.gain/c,card:e[t.card].card.name,role:e[t.card].roles?.[0]??null}))
  }
}
function ct(e,t=o.talentMode){
  return e.map(e=>({card:e.card,talent:t===`none`?null:e.talent}))
}
function lt(e){
  return e.map(e=>e.card.number).sort((e,t)=>e-t).join(`-`)
}
function ut(e,t={}){
  let n={...f,...t.beam??{}},
  r=t.talentMode??o.talentMode,
  i={talentMode:r},
  a=t.constraint??(()=>!0),
  s=t.finalConstraint??(()=>!0),
  c=/* @__PURE__ */ new Set,
  l=[];
  for(let t=0;t<e.length;t++)for(let n=t+1;n<e.length;n++){
    let o=[e[t],e[n]];
    a(o)&&l.push({rows:o,score:J(q(ct(o,r),i))})
  }
  l.sort((e,t)=>t.score-e.score),
  l=l.slice(0,n.beamPairs);
  for(let[t,u]of[[n.beamTriples,3],[n.beamQuads,4]]){
    let n=[];
    c.clear();
    for(let t of l)for(let l of e){
      if(t.rows.includes(l))continue;
      let e=[...t.rows,l];
      if(!a(e)||u===o.deckSize&&!s(e))continue;
      let d=lt(e);
      c.has(d)||(c.add(d),n.push({rows:e,score:J(q(ct(e,r),i))}))
    }
    if(n.sort((e,t)=>t.score-e.score),l=n.slice(0,t),u===o.deckSize)break
  }
  return l
}
function dt(e,t,n=0){
  let r=ft(e,t,n);
  return r>=.9?`S`:r>=.8?`A`:r>=.7?`B`:r>=.5?`C`:`D`
}
function ft(e,t,n=0){
  return t>n?(e-n)/(t-n):0
}
function pt(e,t){
  if(!Array.isArray(e)||e.length!==o.deckSize)throw Error(`Select exactly four cards.`);
  if(new Set(e.map(e=>e?.id)).size!==o.deckSize)throw Error(`Cards must be distinct.`);
  return e.map(e=>{
    let n=t.find(t=>t.id===e?.id);
    if(!n)throw Error(`Unknown card ID.`);
    if(e.talentId==null)return{card:n,talent:null};
    let r=n.talents.findIndex(t=>t.id===e.talentId);
    if(r<0)throw Error(`This talent does not belong to this card.`);
    return{card:n,talent:r}
  })
}
function mt(e,t,n){
  let r=t.map(()=>({added:[],removed:[]}));
  if(!e)return r;
  if(!Array.isArray(e))throw Error(`Invalid Tox loadout.`);
  let i=/* @__PURE__ */ new Set;
  return e.forEach(a=>{
    let o=t.findIndex(e=>e.card.id===a?.cardId);
    if(o<0)throw Error(`Unknown card in Tox loadout.`);
    if(e.filter(e=>e?.cardId===a.cardId).length>1)throw Error(`Duplicate card in Tox loadout.`);
    let s=t[o].card,
    c=new Set([...s.abilities.map(e=>e.id),...s.passives.map(e=>e.id)].filter(Boolean));
    for(let e of a?.removed??[]){
      if(!c.has(e))throw Error(`Unknown card row.`);
      if(u.canReplace===`none`||u.canReplace===`passives`&&s.abilities.some(t=>t.id===e))throw Error(`This row cannot be replaced.`);
      if(r[o].removed.includes(e))throw Error(`Row removed twice.`);
      r[o].removed.push(e)
    }
    for(let e of a?.added??[]){
      let t=n.find(t=>t.id===e);
      if(!t)throw Error(`Unknown Tox.`);
      if(i.has(e))throw Error(`The same Tox cannot be bought twice.`);
      i.add(e),
      r[o].added.push(t)
    }
    if(s.rows-r[o].removed.length+r[o].added.length>u.maxRows)throw Error(`A card cannot hold more than three rows.`)
  }),
  r
}
function ht(e){
  if(e.schema!==1||!Array.isArray(e.cards)||e.cards.length<o.deckSize)throw Error(`Invalid simulation snapshot.`);
  let t=e.recommended?e.cards.map(t=>({card:t,talent:e.recommended[t.id]??null})):Ue(e.cards),
  n=it(e.cards),
  r=/* @__PURE__ */ new Map;
  return{
    evaluate(i,{optimize:a=!0,suggestions:s=!0,shop:c=!0,loadout:l=null,player:u=null}={}){
      let d=pt(i,e.cards);
      if(u!=null&&!we.includes(u))throw Error(`Invalid play order.`);
      let f=u?{player:u}:{},
      p=mt(l,d,n),
      m=p.some(e=>e.added.length||e.removed.length),
      h=m?{
        extraPassives:p.map(e=>e.added.map(e=>e.passive)),
        removePassives:p.map((e,t)=>e.removed.filter(e=>!d[t].card.abilities.some(t=>t.id===e))),
        removeAbilities:p.map((e,t)=>e.removed.filter(e=>d[t].card.abilities.some(t=>t.id===e)))
      }:{},
      g=JSON.stringify({selection:i,optimize:a,suggestions:s,shop:c,loadout:l,player:u});
      if(r.has(g))return r.get(g);
      let _=d.map(e=>t.find(t=>t.card.id===e.card.id)),
      v=a?Te(d.map(e=>e.card),{...h,...f}):X(d,{...h,...f}),
      y=v.result,
      b=a?v.talents:d.map(e=>e.talent),
      x=v.score,
      S=[];
      if(s){
        let e=d.map(e=>!a&&e.talent===null),
        n=e.every(Boolean),
        r=t=>e.map((e,r)=>n||r!==t&&e);
        for(let e=0;e<o.deckSize;e++){
          let i=null;
          for(let r of t){
            if(_.includes(r))continue;
            let t=_.map((t,n)=>n===e?r:t),
            a=J(q(t.map((t,r)=>({card:t.card,talent:r===e?n?null:t.talent:b[r]})),{...m?{}:h,...f}));
            (!i||a>i.score)&&(i={set:t,score:a,candidate:r})
          }
          if(!i)continue;
          let a=r(e),
          o=Te(i.set.map((e,t)=>a[t]?{...e.card,talents:[]}:e.card),f);
          o.score<=x*1.03||S.push({
            replaceId:_[e].card.id,
            withId:i.candidate.card.id,
            gain:(o.score-x)/x*100,
            selection:i.set.map((e,t)=>({id:e.card.id,talentId:a[t]?null:gt(e.card,o.talents[t])}))
          })
        }
      }
      let C=b.every(e=>e===null)&&e.noTalent?e.noTalent:null,
      w={
        score:x,
        ttk:y.ttk,
        dmgTotal:y.dmgTotal,
        ehp:y.ehp,
        heal:y.heal,
        control:y.control,
        spamton:y.spamton,
        income:y.income,
        tier:dt(x,(C??e).best,(C??e).baseline),
        advantage:ft(x,(C??e).best,(C??e).baseline)*100,
        scale:C?`none`:`talents`,
        dmgByTurn:y.dmgByTurn,
        matchups:v.matchups,
        positions:v.positions.map(({player:e,ttk:t,deltaPct:n})=>({player:e,ttk:t,deltaPct:n})),
        selection:d.map((e,t)=>({id:e.card.id,talentId:gt(e.card,b[t])})),
        player:u,
        plan:y.plan.map(e=>e.map(({cardId:e,abilityId:t,option:n,dmg:r,heal:i,gen:a})=>({cardId:e,abilityId:t,option:n,dmg:r,heal:i,gen:a}))),
        suggestions:S.sort((e,t)=>t.gain-e.gain),
        baseScore:m?(a?Te(d.map(e=>e.card),f):X(d,f)).score:x,
        noTalent:(()=>{
          let t=X(d,{...h,...f,talentMode:`none`}),
          n=e.noTalent;
          return{
            score:t.score,
            ttk:t.result.ttk,
            tier:n?dt(t.score,n.best,n.baseline):null,
            advantage:n?ft(t.score,n.best,n.baseline)*100:null
          }
        })(),
        loadout:p.map((e,t)=>({cardId:d[t].card.id,added:e.added.map(e=>e.id),removed:e.removed})),
        shop:c?_t(st(_,b,n)):null
      };
      return r.size>=30&&r.delete(r.keys().next().value),
      r.set(g,w),
      w
    },
    bestDecks(n){
      let i=new Set(Array.isArray(n)?n:[]),
      a=t.filter(e=>i.has(e.card.id));
      if(a.length<o.deckSize)throw Error(`Select at least four known cards.`);
      let s=JSON.stringify({collection:a.map(e=>e.card.id)});
      if(r.has(s))return r.get(s);
      let c=(e,t)=>e.rows.filter(e=>t.rows.includes(e)).length>p.maxShared,
      l=(e,t,n)=>{
        let r=[];
        for(let i of e){
          if(r.length>=n)break;
          r.some(e=>c(t(e),t(i)))||r.push(i)
        }
        return r
      },
      u=(e,t)=>{
        let n=ut(a,{beam:p,talentMode:e}),
        r=[.../* @__PURE__ */ new Set([...n.slice(0,p.finalTop),...l(n,e=>e,p.decks)])].map(t=>({node:t,best:Te(t.rows.map(e=>e.card),{talentMode:e})})).sort((e,t)=>t.best.score-e.best.score);
        return l(r,e=>e.node,p.decks).map(({node:e,best:n})=>({
          cards:e.rows.map((e,t)=>({id:e.card.id,talentId:gt(e.card,n.talents[t])})),
          score:n.score,
          ttk:n.result.ttk,
          tier:t?dt(n.score,t.best,t.baseline):null,
          advantage:t?ft(n.score,t.best,t.baseline)*100:null,
          positions:n.positions.map(({player:e,ttk:t,deltaPct:n})=>({player:e,ttk:t,deltaPct:n}))
        }))
      },
      d={
        cards:a.length,
        withTalents:u(o.talentMode,{best:e.best,baseline:e.baseline}),
        noTalent:u(`none`,e.noTalent??null)
      };
      return r.size>=30&&r.delete(r.keys().next().value),
      r.set(s,d),
      d
    }
  }
}
const gt=(e,t)=>t==null?null:e.talents[t]?.id??null;
function _t(e){
  let t=e=>Math.round(e*10)/10;
  return{
    budget:e.budget,
    openings:e.openings,
    everyTurns:e.everyTurns,
    potentialPct:t(e.potentialPct),
    evNowPct:t(e.evNowPct),
    evAfterPct:t(e.evAfterPct),
    slotsTotal:e.slotsTotal,
    timeline:e.spamtonByOpening.map(e=>({turn:e.turn,luck:t(e.luck),spamton:e.spamton,odds:e.odds})),
    plan:e.plan.map(e=>({
      step:e.step,
      turn:e.turn,
      toxId:e.id,
      rarity:e.rarity,
      cardId:e.cardId,
      replacesId:e.replacesId,
      gainPct:t(e.gainPct),
      cumulativePct:t(e.cumulativePct)
    })),
    cards:e.cards.map(e=>({
      cardId:e.cardId,
      free:e.free,
      lines:e.lines.map(e=>({
        kind:e.kind,
        id:e.id??null,
        rarity:e.rarity??null,
        verdict:e.verdict,
        valuePct:e.valuePct==null?null:t(e.valuePct),
        casts:e.casts??null,
        firstTurn:e.firstTurn??null,
        candidates:e.candidates.map(e=>({toxId:e.id,rarity:e.rarity,gainPct:t(e.gainPct)}))
      }))
    })),
    avoidIds:e.avoidIds
  }
}
let vt=``,
yt=``,
bt=null,
$=null;
async function xt(e,t){
  if(!(bt&&vt===e&&yt===t)&&($&&await $,!(bt&&vt===e&&yt===t))){
    $=(async()=>{
      let n=await fetch(e);
      if(!n.ok)throw Error(`Snapshot unavailable`);
      let r=await n.json();
      if(r.engineHash!==t)throw Error(`Incompatible engine snapshot`);
      bt=ht(r),
      vt=e,
      yt=t
    })();
    try{
      await $
    }finally{
      $=null
    }
  }
}
self.onmessage=async e=>{
  let t=e.data,
  {requestId:n,modelUrl:r,engineHash:i}=t;
  try{
    await xt(r,i);
    let e=bt;
    if(t.kind===`collection`){
      self.postMessage({requestId:n,collection:e.bestDecks(t.cardIds)});
      return
    }
    let{selection:a,optimize:o,loadout:s,player:c}=t;
    self.postMessage({requestId:n,result:e.evaluate(a,{optimize:o,loadout:s??null,player:c??null})})
  }catch{
    self.postMessage({requestId:n,error:`simulation-failed`})
  }
};
