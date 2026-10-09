// Builds engine_stress121.js = wiki engine v1.21 (SP/spam/v121/dl/simulation.js) + the E2 "threat" toggles
// (globalThis.STRESS, default off). Same 10 patches as the v1.20 bench (SP/spam/audit/E2/make_engine.js), applied
// to the renamed v1.21 anchors; the appended helpers are rebound to the v1.21 minified names (asserted below).
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', '..', '..', 'v121', 'dl', 'simulation.js');
const OUT = path.join(__dirname, 'engine_stress121.js');
let s = fs.readFileSync(SRC, 'utf8');
// v1.20 -> v1.21 names of the engine bindings the helpers use
const N = { curHp: 'O', enemyKill: 'ce', onDeath: 'se', profile: 'T', focus: 'w', consts: 'g', cfg: 'o' };
const defs = [
  [`const ${N.curHp}=e=>e.hpMax-e.dmgTaken;`],
  [`function ${N.enemyKill}(e,t,n,r){e.enemyDeaths+=1,`],
  [`function ${N.onDeath}(e,t,n,r){for(let r of e.cards){if(r.cimetiere)`],
  [`function ${N.profile}(e){let t=y(0);for(let{card:n}of e)`],
  [`function ${N.focus}(e){let t=e.opts.focus;return e.enemies.filter(e=>e.hp>0)`],
  [`,${N.consts}={stunPerTargetTurn:60,`],
  [`,${N.cfg}={deckSize:e.cardsPerDeck,`],
];
for (const [d] of defs) { const n = s.split(d).length - 1; if (n !== 1) throw new Error('binding check ' + n + ' for ' + d); }
for (const k of ['immunityPerHp:', 'mysteryDefense:', 'deathBounty:e.deathBounty']) if (!s.includes(k)) throw new Error('missing ' + k);
const patches = [
  // 1. per-match stress state + turn-start hook (phase 0) — match function J() in v1.21 (q() in v1.20)
  ['for(let e=1;e<=n&&!s.over;e++){if(s.turn=e,',
   's.stress=__stInit(s,t);for(let e=1;e<=n&&!s.over;e++){if(s.stress&&__stTurn(s,e,0),s.turn=e,'],
  // 2. enemy-action hook (phase 1): le() in v1.21 (de() in v1.20)
  ['function le(e,t){let n=e.enemies.filter(e=>e.hp>0);',
   'function le(e,t){e.stress&&__stTurn(e,t,1);let n=e.enemies.filter(e=>e.hp>0);'],
  // 3. one-time enemy revive in the kill loop of K() (G() in v1.20)
  ['for(let n of l){if(n.phoenix>0){',
   'for(let n of l){if(e.stress&&__stRevive(e,t,n,r,i))continue;if(n.phoenix>0){'],
  // 4-5. remaining enemy HP includes HP added by absorb / heal / revive
  ['r=e.perCard?e.hpTurnStart:e.opp.totalHp-e.dmgTurnStart',
   'r=e.perCard?e.hpTurnStart:e.opp.totalHp+(e.stHp||0)-e.dmgTurnStart'],
  ['s.opp.totalHp-s.totals.dmg,',
   's.opp.totalHp+(s.stHp||0)-s.totals.dmg,'],
  // 6. our Resurrection _e() (ve() in v1.20) cannot bring back an absorbed card
  ['function _e(e,t){let n=e.cards.filter(e=>e.dead);',
   'function _e(e,t){let n=e.cards.filter(e=>e.dead&&!e.absorbed);'],
  // 7-10. absorbed card is no longer a candidate for ally buffs, random-ally buffs, ally cooldown cuts (Se,
  // Ce in v1.20) and on-death passives (se, le in v1.20)
  ['if(n.scope===`randomAlly`){for(let t of e.cards)r(t,1/e.cards.length);return}',
   'if(n.scope===`randomAlly`){for(let t of e.cards)t.absorbed||r(t,1/(e.cards.length-(e.stAbs||0)));return}'],
  ['o=null,s=-1/0;for(let t of e.cards){let e=a(t),n=be.map(e=>t[e]);',
   'o=null,s=-1/0;for(let t of e.cards){if(t.absorbed)continue;let e=a(t),n=be.map(e=>t[e]);'],
  ['for(let n of e.cards)for(let e of n.abilities){let n=e.nextTurn-t;',
   'for(let n of e.cards)if(!n.absorbed)for(let e of n.abilities){let n=e.nextTurn-t;'],
  ['function se(e,t,n,r){for(let r of e.cards){',
   'function se(e,t,n,r){for(let r of e.cards){if(r.absorbed)continue;'],
];
for (const [a, b] of patches) {
  const n = s.split(a).length - 1;
  if (n !== 1) throw new Error('anchor count ' + n + ' for ' + a);
  s = s.replace(a, () => b);
}
s += `
/* ===== E2 stress toggles, v1.21 port (default OFF: globalThis.STRESS undefined/null) ===== */
function __stInit(s,t){
  const C=globalThis.STRESS;
  if(!C||t.potential)return null;
  const nat=(cd,rep)=>{const r=[];for(let x=(s.player===1?cd-1:cd);x<=s.T;x+=cd){r.push(x);if(!rep)break}return r};
  const st={C,absorbDone:false,reviveLeft:C.revive?(C.revive.count??1):0,info:{absorbed:0,absorbNoop:0,cdReset:0,setHp:0,healed:0,revived:0}};
  st.absorbTurns=C.absorb?(C.absorb.turn==='nat'?nat(8,false):[].concat(C.absorb.turn)):[];
  st.cdTurns=C.cdreset?(C.cdreset.turns==='nat'?nat(5,true):[].concat(C.cdreset.turns)):[];
  st.setTurns=C.sethp?(C.sethp.turn==='nat'?nat(7,false):[].concat(C.sethp.turn)):[];
  if(!s.perCard)for(const en of s.enemies)if(en.hpMax==null)en.hpMax=s.opp.cardHp;
  s.stHp=0;st.s=s;st.addedByTurn=Array(s.T).fill(0);globalThis.__stLast=st;
  return st;
}
function __stTurn(s,turn,phase){
  const st=s.stress,C=st.C;
  const ph=ev=>(ev&&ev.at==='start')?0:1;
  if(C.absorb&&!st.absorbDone&&phase===ph(C.absorb)&&st.absorbTurns.includes(turn))__stAbsorb(s,turn);
  if(C.cdreset&&phase===ph(C.cdreset)&&st.cdTurns.includes(turn))__stCdReset(s,turn,phase);
  if(C.sethp&&phase===ph(C.sethp)&&st.setTurns.includes(turn))__stSetHp(s,turn);
  if(C.heal&&phase===1)__stHeal(s,turn);
}
function __stRemove(s,c,turn){
  for(const p of c.passives){const r=p.shop?1:c.evolution;
    if(p.type==='berserk')s.team.berserk-=p.pct/100*r;
    if(p.type==='teamRes')s.team.res-=p.value*r;}
  const credit=(c.immune?c.hpMax*${N.consts}.immunityPerHp:0)+${N.consts}.mysteryDefense*c.mystery;
  if(credit)s.totals.defense-=credit*(s.T-turn+1)/s.T;
  c.dead=true;c.absorbed=true;c.taunting=false;c.wasTaunting=false;
  c.coeur=[];c.mimetism=false;c.hpGrowth=0;c.regenPct=0;c.luckPerTurn=0;c.critPerTurn=0;c.incisive=0;
  c.fullHealChance=0;c.fullHealLow=false;c.resOnHit=0;c.corrosion=0;c.focus=0;c.anticipation=false;
  c.life8=false;c.passiveAt8=null;c.breath8=false;
  c.passives=c.passives.filter(p=>p.type!=='punchingBag');
}
function __stAbsorb(s,turn){
  const st=s.stress,C=st.C.absorb;st.absorbDone=true;
  const tgt=s.cards.find(c=>c.idx===C.pos);
  if(!tgt||tgt.dead){st.info.absorbNoop++;return}
  const en=s.enemies.filter(e=>e.hp>0);
  if(!en.length)return;
  const gain=tgt.hpMax;
  __stRemove(s,tgt,turn);st.info.absorbed++;s.stAbs=(s.stAbs||0)+1;
  if(!C.keepProfile)s.profile=${N.profile}(s.cards.filter(c=>!c.absorbed));
  if(C.bounty){s.totals.spamton+=${N.cfg}.deathBounty;s.spamtonByTurn[turn-1]=(s.spamtonByTurn[turn-1]??0)+${N.cfg}.deathBounty;${N.onDeath}(s,turn,null,null);}
  if(C.gain!==false){
    const ab=C.absorber==='focus'?${N.focus}(s)[0]:en.reduce((b,e)=>(e.hp>b.hp+1e-9||(Math.abs(e.hp-b.hp)<=1e-9&&e.index>b.index))?e:b);
    ab.hp+=gain;ab.hpMax=(ab.hpMax??s.opp.cardHp)+gain;s.stHp+=gain;st.addedByTurn[turn-1]+=gain;
  }
  s.events.push({turn,type:'absorbed',card:tgt.card.name});
}
function __stCdReset(s,turn,phase){
  const C=s.stress.C.cdreset;
  const nextOwn=(phase===0||s.player===2)?turn:turn+1;
  const tg=C.target==null||C.target==='all'?s.cards.filter(c=>!c.dead):s.cards.filter(c=>!c.dead&&c.idx===C.target);
  for(const c of tg)for(const a of c.abilities)a.nextTurn=Math.max(a.nextTurn,nextOwn+a.ab.cd-1);
  if(tg.length)s.stress.info.cdReset++;
}
function __stSetHp(s,turn){
  const C=s.stress.C.sethp,pct=(C.pct??25)/100;
  const alive=s.cards.filter(c=>!c.dead);
  let tg=null;
  if(C.target==null||C.target==='maxhp'){for(const c of alive)if(!tg||${N.curHp}(c)>${N.curHp}(tg)+1e-9||(Math.abs(${N.curHp}(c)-${N.curHp}(tg))<=1e-9&&c.hpMax>tg.hpMax))tg=c}
  else tg=alive.find(c=>c.idx===C.target)||null;
  if(!tg)return;
  const want=pct*tg.hpMax;
  if(${N.curHp}(tg)>want){tg.dmgTaken=tg.hpMax-want;s.stress.info.setHp++;s.events.push({turn,type:'setHp',card:tg.card.name})}
}
function __stHeal(s,turn){
  const C=s.stress.C.heal;let pool=C.perTurn,healed=0;
  const alive=s.enemies.filter(e=>e.hp>0);
  for(let it=0;it<6&&pool>1e-9;it++){
    const cand=alive.filter(e=>e.hp<e.hpMax-1e-9);
    if(!cand.length)break;
    const share=pool/cand.length;
    for(const e of cand){const h=Math.min(share,e.hpMax-e.hp);e.hp+=h;pool-=h;healed+=h}
  }
  s.stHp+=healed;s.enemyHealed+=healed;s.stress.info.healed+=healed;s.stress.addedByTurn[turn-1]+=healed;
}
function __stRevive(e,t,n,r,i){
  const st=e.stress;
  if(!(st.reviveLeft>0))return false;
  st.reviveLeft--;
  ${N.enemyKill}(e,t,r,i);--e.enemyDeaths;
  const hp=(st.C.revive.pct??.5)*(n.hpMax??e.opp.cardHp);
  n.hp=hp;e.stHp+=hp;st.info.revived++;st.addedByTurn[t-1]+=hp;
  e.events.push({turn:t,type:'enemyRevive'});
  return true;
}
`;
fs.writeFileSync(OUT, s);
console.log('wrote', OUT, s.length, 'bytes');
