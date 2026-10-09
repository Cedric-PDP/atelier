// Builds spam/versions/1.21/js/engine_stress.js = the wiki engine 1.21 + the "threat" toggles of the mechanics audit
// (globalThis.STRESS, default OFF: identical scores) + __lostAbsorb(model, ids), used by recompute.sh for the
// "lost card" metric L (meta.lostMethod = "absorb-death"): each card in turn is ABSORBED at the start of turn 1, and an
// absorption is a DEATH (replay 2026-10-09-1546-7144: death message, 50-Spamton bounty paid at once to the card's owner,
// kill credited to the absorber). So the card goes through the engine's own death handler (ownDeath below): its "when
// killed" effects (Revanche, Bomba, talents Héritage, Virage 360, Heure Funeste, Dernier souffle), the bounty, then the
// on-death cascade of the OTHER cards (Cimetière, Vengeur, Vitalité des Âmes, One man army, Armure des Âmes) — without
// any way back (Phénix and Transition cleared first, our Résurrection skips absorbed cards), and without its own
// Cimetière counting its own death; then it leaves the board (__stRemove: its auras, Cœurs and other per-turn passives
// stop). No HP is given to the enemy (gain:false). Details and hypotheses: see __stAbsorb.
// Before 2026-10-09 evening L removed the card WITHOUT death ("absorb", still available: __lostAbsorb(M, ids, {death:false})),
// and before that it put a 1-HP 'dead-card' in its place ("dead-card", recompute.sh's fallback without a patcher).
// Ported from the audit session's make_engine121.js. The anchors use the engine's MINIFIED names, which change with
// every rebuild of the wiki: a new game version needs its own make_engine_<v>.js (recompute.sh falls back to
// dead-card, flagged, when there is none), and the wiki may also rebuild the engine under the SAME game version.
// 1.21 has two engine revisions; the patcher recognises which one it is given by signature (every binding below must
// be defined exactly once, for exactly one revision) and applies that revision's names:
//   rev1  engineHash 36e2c03d5b7bf4a1, /_astro/simulation-KlJhEEqL.js (game 1.21 release, 2026-10-09 15:03)
//   rev2  engineHash e77f882d0c1284ef, /_astro/simulation-BFLulMa_.js (wiki scoring revision, 2026-10-09 16:19:
//         offense of an unfinished match = 3·enemy HP·n/ttk instead of usefulByTurn; cards ranked with their best
//         talent). Renamed: enemyKill ce→le, onDeath se→ce, enemyAct le→ue; everything the patches touch is otherwise
//         byte-identical.
// To port a new revision: run it, read which binding check fails, find the renamed function (same body), add a row.
// Usage: node scripts/app/stress/make_engine_1.21.js <simulation.js> <out engine_stress.js>
const fs = require('fs');
const [SRC, OUT] = process.argv.slice(2); if (!OUT) throw new Error('usage: make_engine_1.21.js <simulation.js> <out.js>');
let s = fs.readFileSync(SRC, 'utf8');
// Minified names per engine revision. curHp, profile, focus, consts, cfg, ownDeath: bindings the appended helpers call
// (ownDeath = the death handler of OUR cards, called by the damage function when a card's HP reach 0);
// enemyKill/onDeath/enemyAct/resurrect/allyKeys: patched functions; match/score/mean/profiles/entries: API of __lostAbsorb.
const base = { curHp: 'O', profile: 'T', focus: 'w', consts: 'g', cfg: 'o', ownDeath: 'me', resurrect: '_e', allyKeys: 'be',
  match: 'J', score: 'Y', mean: 'X', profiles: 'd', entries: 'pt' };
const REVS = {
  rev1: { ...base, enemyKill: 'ce', onDeath: 'se', enemyAct: 'le' },
  rev2: { ...base, enemyKill: 'le', onDeath: 'ce', enemyAct: 'ue' },
};
const defsOf = N => [
  `const ${N.curHp}=e=>e.hpMax-e.dmgTaken;`,
  `function ${N.enemyKill}(e,t,n,r){e.enemyDeaths+=1,`,
  `function ${N.onDeath}(e,t,n,r){for(let r of e.cards){if(r.cimetiere)`,
  `function ${N.ownDeath}(e,t,n){if(n.revenge&&`,
  `return n.dmgTaken=n.hpMax,${N.ownDeath}(e,t,n),a}`,
  `n.phoenix>0?(n.dmgTaken=n.hpMax*(1-Math.min(1,n.phoenix))`,
  `:n.metamorphOnDeath?(n.metamorphOnDeath=!1,n.dmgTaken=0,`,
  `function ${N.profile}(e){let t=y(0);for(let{card:n}of e)`,
  `function ${N.focus}(e){let t=e.opts.focus;return e.enemies.filter(e=>e.hp>0)`,
  `,${N.consts}={stunPerTargetTurn:60,`,
  `,${N.cfg}={deckSize:e.cardsPerDeck,`,
  `function ${N.enemyAct}(e,t){let n=e.enemies.filter(e=>e.hp>0);`,
  `function ${N.resurrect}(e,t){let n=e.cards.filter(e=>e.dead);`,
  `o=null,s=-1/0;for(let t of e.cards){let e=a(t),n=${N.allyKeys}.map(e=>t[e]);`,
  `function ${N.match}(e,t={}){`,
  `function ${N.score}(e,t=s){return e.offense*`,
  `,${N.mean}=e=>e.reduce(`,
  `,${N.profiles}=[{id:\`neutral\``,
  `function ${N.entries}(e,t){if(!Array.isArray(e)||e.length!==o.deckSize)`,
];
const count = d => s.split(d).length - 1;
const fails = Object.fromEntries(Object.entries(REVS).map(([k, N]) => [k, defsOf(N).filter(d => count(d) !== 1)]));
const ok = Object.keys(REVS).filter(k => !fails[k].length);
if (ok.length !== 1) {
  for (const [k, f] of Object.entries(fails)) console.error(k + ': ' + (f.length ? f.map(d => 'binding check ' + count(d) + ' for ' + d).join('\n  ') : 'ok'));
  throw new Error(ok.length ? 'ambiguous engine revision: ' + ok.join(', ') : 'unknown engine revision (port the names, see the header)');
}
const REV = ok[0], N = REVS[REV];
for (const k of ['immunityPerHp:', 'mysteryDefense:', 'deathBounty:e.deathBounty']) if (!s.includes(k)) throw new Error('missing ' + k);
const patches = [
  // 1. per-match stress state + turn-start hook (phase 0) — match function J()
  ['for(let e=1;e<=n&&!s.over;e++){if(s.turn=e,',
   's.stress=__stInit(s,t);for(let e=1;e<=n&&!s.over;e++){if(s.stress&&__stTurn(s,e,0),s.turn=e,'],
  // 2. enemy-action hook (phase 1)
  [`function ${N.enemyAct}(e,t){let n=e.enemies.filter(e=>e.hp>0);`,
   `function ${N.enemyAct}(e,t){e.stress&&__stTurn(e,t,1);let n=e.enemies.filter(e=>e.hp>0);`],
  // 3. one-time enemy revive in the kill loop of K() (t = turn, r/i = our card/ability: the function's params)
  ['for(let n of l){if(n.phoenix>0){',
   'for(let n of l){if(e.stress&&__stRevive(e,t,n,r,i))continue;if(n.phoenix>0){'],
  // 4-5. remaining enemy HP includes HP added by absorb / heal / revive
  ['r=e.perCard?e.hpTurnStart:e.opp.totalHp-e.dmgTurnStart',
   'r=e.perCard?e.hpTurnStart:e.opp.totalHp+(e.stHp||0)-e.dmgTurnStart'],
  ['s.opp.totalHp-s.totals.dmg,',
   's.opp.totalHp+(s.stHp||0)-s.totals.dmg,'],
  // 6. our Resurrection cannot bring back an absorbed card
  [`function ${N.resurrect}(e,t){let n=e.cards.filter(e=>e.dead);`,
   `function ${N.resurrect}(e,t){let n=e.cards.filter(e=>e.dead&&!e.absorbed);`],
  // 7-10. absorbed card is no longer a candidate for ally buffs, random-ally buffs, ally cooldown cuts (Se) and
  // on-death passives
  ['if(n.scope===`randomAlly`){for(let t of e.cards)r(t,1/e.cards.length);return}',
   'if(n.scope===`randomAlly`){for(let t of e.cards)t.absorbed||r(t,1/(e.cards.length-(e.stAbs||0)));return}'],
  [`o=null,s=-1/0;for(let t of e.cards){let e=a(t),n=${N.allyKeys}.map(e=>t[e]);`,
   `o=null,s=-1/0;for(let t of e.cards){if(t.absorbed)continue;let e=a(t),n=${N.allyKeys}.map(e=>t[e]);`],
  ['for(let n of e.cards)for(let e of n.abilities){let n=e.nextTurn-t;',
   'for(let n of e.cards)if(!n.absorbed)for(let e of n.abilities){let n=e.nextTurn-t;'],
  [`function ${N.onDeath}(e,t,n,r){for(let r of e.cards){`,
   `function ${N.onDeath}(e,t,n,r){for(let r of e.cards){if(r.absorbed)continue;`],
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
  // death:true = an absorption is a death (replay 2026-10-09-1546-7144). The card dies through the engine's own death
  // handler, as when its HP reach 0 (HP set to 0 first): Revanche, Bomba, the bounty to its owner, its "when killed"
  // talents (Héritage, Virage 360, Heure Funeste, Dernier souffle), then the on-death loop of the OTHER cards (Cimetière,
  // Vengeur, Vitalité des Âmes, One man army, Armure des Âmes). Two departures from a death by damage, both because the
  // card is taken: no way back (Phénix, Plume de Phénix and Transition cleared; our Résurrection skips absorbed cards,
  // patch 6), and it is flagged absorbed BEFORE the handler, so the on-death loop skips its own passives (patch 10): its
  // own Cimetière does not count its own death (a death by damage does, in the engine). The removal below then takes the
  // card off the board: none of its passives play afterwards (Cœurs, auras, Cimetière on later deaths).
  if(C.death){tgt.phoenix=0;tgt.metamorphOnDeath=false;tgt.dmgTaken=tgt.hpMax;tgt.absorbed=true;${N.ownDeath}(s,turn,tgt);st.info.died=(st.info.died||0)+1;}
  __stRemove(s,tgt,turn);st.info.absorbed++;s.stAbs=(s.stAbs||0)+1;
  if(!C.keepProfile)s.profile=${N.profile}(s.cards.filter(c=>!c.absorbed));
  // bounty:true (audit cross-check, superseded by death:true) = only the bounty + the cascade of the OTHER cards
  if(C.bounty&&!C.death){s.totals.spamton+=${N.cfg}.deathBounty;s.spamtonByTurn[turn-1]=(s.spamtonByTurn[turn-1]??0)+${N.cfg}.deathBounty;${N.onDeath}(s,turn,null,null);}
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
const { match: J, score: Y, mean: X, profiles: d, entries: pt } = N;
s += `
/* ===== lost-card metric L: card p is absorbed at the start of turn 1 and DIES (death:true, the default: bounty, on-death
   effects, no revival), or with {death:false} is only removed (the "absorb" method used until 2026-10-09 evening) ===== */
globalThis.__lostAbsorb=function(M,ids,o){const death=!(o&&o.death===false);const entries=${pt}(ids.map(id=>({id,talentId:null})),M.cards);const out=[];
  for(let p=0;p<ids.length;p++){globalThis.STRESS={absorb:{turn:1,pos:p,at:'start',gain:false,death}};const ms=[];
    try{for(const prof of ${d})for(const pl of [1,2])ms.push(${Y}(${J}(entries,{opponent:prof,player:pl})))}finally{globalThis.STRESS=null}
    out.push(${X}(ms))}
  return out};
globalThis.__plainScore=function(M,ids){const entries=${pt}(ids.map(id=>({id,talentId:null})),M.cards);const ms=[];
  for(const prof of ${d})for(const pl of [1,2])ms.push(${Y}(${J}(entries,{opponent:prof,player:pl})));return ${X}(ms)};
`;
fs.writeFileSync(OUT, s);
console.log('wrote', OUT, s.length, 'bytes, engine', REV);
