// Builds engine_stress.js = the wiki engine (SP/spam/js/simulation.js) + "threat" toggles read from globalThis.STRESS.
// Every patch is an exact-substring replacement asserted to match exactly once; with STRESS unset every
// patched expression evaluates exactly like the original (validated by validate.js).
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', '..', 'js', 'simulation.js');
const OUT = path.join(__dirname, 'engine_stress.js');
let s = fs.readFileSync(SRC, 'utf8');
const patches = [
  // 1. per-match stress state + turn-start hook (phase 0)
  ['for(let e=1;e<=n&&!s.over;e++){if(s.turn=e,',
   's.stress=__stInit(s,t);for(let e=1;e<=n&&!s.over;e++){if(s.stress&&__stTurn(s,e,0),s.turn=e,'],
  // 2. enemy-action hook (phase 1): de() is the abstract opponent's action (start of turn if we play 2nd, end if 1st)
  ['function de(e,t){let n=e.enemies.filter(e=>e.hp>0);',
   'function de(e,t){e.stress&&__stTurn(e,t,1);let n=e.enemies.filter(e=>e.hp>0);'],
  // 3. one-time enemy revive (Phenix / Resurrection) handled like the engine's own perCard phoenix branch
  ['for(let n of l){if(n.phoenix>0){',
   'for(let n of l){if(e.stress&&__stRevive(e,t,n,r,i))continue;if(n.phoenix>0){'],
  // 4. ttk fraction: remaining enemy HP must include HP added by absorb / heal / revive
  ['r=e.perCard?e.hpTurnStart:e.opp.totalHp-e.dmgTurnStart',
   'r=e.perCard?e.hpTurnStart:e.opp.totalHp+(e.stHp||0)-e.dmgTurnStart'],
  // 5. reported ttk estimate when not over (not part of J)
  ['s.opp.totalHp-s.totals.dmg,',
   's.opp.totalHp+(s.stHp||0)-s.totals.dmg,'],
  // 6. our Resurrection cannot bring back an absorbed card
  ['function ve(e,t){let n=e.cards.filter(e=>e.dead);',
   'function ve(e,t){let n=e.cards.filter(e=>e.dead&&!e.absorbed);'],
  // 7-10. the engine keeps DEAD cards as candidates for ally buffs (K), random-ally buffs, ally cooldown
  // reduction (Ce) and on-death passives (le). An ABSORBED card has left the board: skip it there
  // (cards killed by damage keep the engine's original behaviour, so the baseline is unchanged).
  ['if(n.scope===`randomAlly`){for(let t of e.cards)r(t,1/e.cards.length);return}',
   'if(n.scope===`randomAlly`){for(let t of e.cards)t.absorbed||r(t,1/(e.cards.length-(e.stAbs||0)));return}'],
  ['o=null,s=-1/0;for(let t of e.cards){let e=a(t),n=xe.map(e=>t[e]);',
   'o=null,s=-1/0;for(let t of e.cards){if(t.absorbed)continue;let e=a(t),n=xe.map(e=>t[e]);'],
  ['for(let n of e.cards)for(let e of n.abilities){let n=e.nextTurn-t;',
   'for(let n of e.cards)if(!n.absorbed)for(let e of n.abilities){let n=e.nextTurn-t;'],
  ['function le(e,t,n,r){for(let r of e.cards){',
   'function le(e,t,n,r){for(let r of e.cards){if(r.absorbed)continue;'],
];
for (const [a, b] of patches) {
  const n = s.split(a).length - 1;
  if (n !== 1) throw new Error('anchor count ' + n + ' for ' + a);
  s = s.replace(a, () => b);
}
// Helpers appended at the end (function declarations are hoisted; they close over the engine's top-level
// bindings: o = config, D = current HP, ue = enemy-kill bookkeeping).
s += `
/* ===== E2 stress toggles (default OFF: globalThis.STRESS undefined/null) ===== */
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
  // team-wide passives granted at match start by this card leave with it (te(): berserk, teamRes)
  for(const p of c.passives){const r=p.shop?1:c.evolution;
    if(p.type==='berserk')s.team.berserk-=p.pct/100*r;
    if(p.type==='teamRes')s.team.res-=p.value*r;}
  // start-of-match defense credits of this card (immunity, mystery), pro rata of the turns it will miss
  const credit=(c.immune?c.hpMax*g.immunityPerHp:0)+g.mysteryDefense*c.mystery;
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
  // the player adapts: element-generation is now valued against the cards still on the board (as with a
  // deck built without that card); C.keepProfile=true keeps the engine's start-of-match profile instead
  if(!C.keepProfile)s.profile=T(s.cards.filter(c=>!c.absorbed));
  if(C.bounty){// cross-check only: grant what the engine's death handler he() grants on a normal death
    s.totals.spamton+=o.deathBounty;s.spamtonByTurn[turn-1]=(s.spamtonByTurn[turn-1]??0)+o.deathBounty;le(s,turn,null,null);
  }
  if(C.gain!==false){
    // absorber = the living enemy with the most HP (not the one we are focusing), or C.absorber='focus' =
    // the enemy our single-target attacks currently focus (engine order w(): lowest HP first)
    const ab=C.absorber==='focus'?w(s)[0]:en.reduce((b,e)=>(e.hp>b.hp+1e-9||(Math.abs(e.hp-b.hp)<=1e-9&&e.index>b.index))?e:b);
    ab.hp+=gain;ab.hpMax=(ab.hpMax??s.opp.cardHp)+gain;s.stHp+=gain;st.addedByTurn[turn-1]+=gain;
  }
  s.events.push({turn,type:'absorbed',card:tgt.card.name});
}
function __stCdReset(s,turn,phase){
  const C=s.stress.C.cdreset;
  // enemy acts after us in turn T if we play 1st (next own turn T+1), before us if we play 2nd (next own turn T)
  const nextOwn=(phase===0||s.player===2)?turn:turn+1;
  const tg=C.target==null||C.target==='all'?s.cards.filter(c=>!c.dead):s.cards.filter(c=>!c.dead&&c.idx===C.target);
  for(const c of tg)for(const a of c.abilities)a.nextTurn=Math.max(a.nextTurn,nextOwn+a.ab.cd-1);
  if(tg.length)s.stress.info.cdReset++;
}
function __stSetHp(s,turn){
  const C=s.stress.C.sethp,pct=(C.pct??25)/100;
  const alive=s.cards.filter(c=>!c.dead);
  let tg=null;
  if(C.target==null||C.target==='maxhp'){for(const c of alive)if(!tg||D(c)>D(tg)+1e-9||(Math.abs(D(c)-D(tg))<=1e-9&&c.hpMax>tg.hpMax))tg=c}
  else tg=alive.find(c=>c.idx===C.target)||null;
  if(!tg)return;
  const want=pct*tg.hpMax;
  if(D(tg)>want){tg.dmgTaken=tg.hpMax-want;s.stress.info.setHp++;s.events.push({turn,type:'setHp',card:tg.card.name})}
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
  if(C.net)s.usefulByTurn[turn-1]-=healed;
}
function __stRevive(e,t,n,r,i){
  const st=e.stress;
  if(!(st.reviveLeft>0))return false;
  st.reviveLeft--;
  ue(e,t,r,i);--e.enemyDeaths;
  const hp=(st.C.revive.pct??.5)*(n.hpMax??e.opp.cardHp);
  n.hp=hp;e.stHp+=hp;st.info.revived++;st.addedByTurn[t-1]+=hp;
  e.events.push({turn:t,type:'enemyRevive'});
  return true;
}
`;
fs.writeFileSync(OUT, s);
console.log('wrote', OUT, s.length, 'bytes');
