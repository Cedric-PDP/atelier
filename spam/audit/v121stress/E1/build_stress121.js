// 1.21 port: builds engine121_stress.js = pretty-printed 1.21 wiki engine (engine121_pretty.js) + the E1 "threat" hooks.
// Renamed engine functions 1.20 -> 1.21: H->de (our card takes damage), D->O (current HP), ge->he (heal split),
// G->K (deal our damage), ye->ve (cast), L->z (precision), W->G (choose option), R->B (sum).
// Every hook is guarded by the per-simulation flag `s.SX` (null unless globalThis.STRESS.on),
// so with STRESS off the arithmetic path is the original one (validated: 301 decks, diff 0).
// Usage: node build_stress.js   (run from SP/spam/audit/E1)
const fs = require('fs');
let src = fs.readFileSync(__dirname + '/engine121_pretty.js', 'utf8');

function rep(anchor, replacement) {
  const n = src.split(anchor).length - 1;
  if (n !== 1) throw new Error('anchor count ' + n + ' for: ' + anchor);
  src = src.replace(anchor, () => replacement);
}

// ---------------------------------------------------------------- helpers (prepended)
const helpers = `
/* ===== E1 stress hooks (audit) — all inert unless globalThis.STRESS.on ===== */
function __Sinit(s){
  var X=(typeof globalThis!=='undefined'&&globalThis.STRESS)||null;
  s.SX=(X&&X.on&&!s.opts.potential&&!s.perCard)?X:null;
  if(!s.SX)return;
  s._rf=0;s._rfPend=0;s._ls=0;s._dc=0;s._st=false;s._reflTaken=0;
  if(X.taunt){
    // last enemy card becomes the taunter (Fleur de Vie-like). Keeps the profile resistances (abstract model).
    var k=s.enemies.length-1;
    s.opp.totalHp=s.opp.totalHp-s.enemies[k].hp+X.taunt.hp;
    s.enemies[k].hp=X.taunt.hp;
    s.enemies[k].taunter=true;
  }
}
// S-TAUNT: single-target attacks (option target enemy/randomEnemy) of a non-Brut card must hit the
// living taunter first. AoE / spread / spreadField / Brut / reflect / bomba are not redirected.
function __Sorder(e,s,att,ab){
  var X=e.SX;
  if(!X.taunt||X.taunt.noForce||!ab||!e._st||!att||att.brut)return s;
  var k=-1;for(var j=0;j<s.length;j++)if(s[j].taunter){k=j;break}
  if(k<=0)return s;
  var out=s.slice();var tt=out.splice(k,1)[0];out.unshift(tt);
  if(X.debug)e.events.push({turn:e.turn,type:'forced',card:att.card.name,v:Math.round(tt.hp),hpBefore:Math.round(s[0].hp)});
  return out;
}
// S-REFLECT: accumulate reflected damage = pct x damage actually taken by each enemy card.
function __Sracc(e,en,o){
  if(!e._dc||!(o>0))return;
  var X=e.SX,p=X.reflect||0;
  if(X.reflectTaunter&&en.taunter)p=Math.max(p,X.reflectTaunter);
  if(X.reflectOne&&en.index===X.reflectOne.idx)p=Math.max(p,X.reflectOne.pct); // a single reflecting enemy card
  if(p>0)e._rf+=o*p;
}
function __SapplyRefl(e,t,att,v){
  if(!(v>0)||!att||att.dead)return;
  var dc=e._dc;e._dc=0;              // reflected damage is never reflected again
  var keep=att.reflect;att.reflect=0; // nor bounced back by our own Renvoi
  e._reflTaken+=v;
  if(e.SX.debug)e.events.push({turn:t,type:'refl',card:att.card.name,v:Math.round(v),hpBefore:Math.round(O(att))});
  de(e,t,att,v);
  att.reflect=keep;e._dc=dc;
  if(att.dead)att._rk=true;           // killed by reflect: skips its remaining casts this turn
}
// called at the end of the hit loop of G()
function __Srefl(e,t,att){
  var v=e._rf;e._rf=0;
  if(!(v>0))return;
  if(e.SX.lsMode){e._rfPend+=v;return}  // resolved in ye() together with the cast's lifesteal
  __SapplyRefl(e,t,att,v);
}
// lsMode 'after': reflected damage lands, then the cast's lifesteal heals.
// lsMode 'net'  : lifesteal and reflect of the same cast cancel out (simultaneous / per-hit).
function __Sresolve(n,turn,card){
  var R=n._rfPend,LS=n._ls;n._rfPend=0;n._ls=0;
  if(n.SX.lsMode==='net'){
    var net=R-LS;
    if(net>0)__SapplyRefl(n,turn,card,net);else if(net<0)he(n,card,'self',-net);
  }else{
    if(R>0)__SapplyRefl(n,turn,card,R);
    if(LS>0)he(n,card,'self',LS);
  }
}
// S-FREEZE: card at deck position F.idx cannot cast on the frozen turns; ice-break damage F.shatter.
//  fixed mode : frozen on F.turns.
//  timed mode (F.smart): an enemy Gel ability of cooldown F.cd, usable from turn F.from, is spent only on a
//  turn where the target has a damaging ability ready (the opponent sees our cooldowns), then recharges.
function __SfrzTarget(s){
  var F=s.SX.freeze;for(var j=0;j<s.cards.length;j++)if(s.cards[j].idx===F.idx)return s.cards[j];return null;
}
function __SfrozenNow(s,turn){
  var F=s.SX.freeze;
  if(!F)return false;
  if(!F.smart)return F.turns.indexOf(turn)>=0;
  if(s._frzTurn!==turn){
    s._frzTurn=turn;s._frozenNow=false;
    if(s._frzNext==null)s._frzNext=F.from;
    var c=__SfrzTarget(s);
    if(c&&!c.dead&&turn>=s._frzNext){
      var dmgAb=function(a){return a.ab.options.some(function(o){return o.hits.length>0})};
      var hasDmg=c.abilities.some(dmgAb); // pure support card: freeze when any of its abilities is ready
      var ready=c.abilities.some(function(a){return a.nextTurn<=turn&&a.uses>0&&(!hasDmg||dmgAb(a))});
      if(ready){s._frozenNow=true;s._frzNext=turn+F.cd;s._frzCount=(s._frzCount||0)+1;}
    }
  }
  return s._frozenNow;
}
function __Sfrz(s,card,turn){
  var F=s.SX.freeze;
  return !!F&&card.idx===F.idx&&__SfrozenNow(s,turn)&&s._thawTurn!==turn;
}
function __Sshat(s,turn){
  var F=s.SX.freeze;
  if(!F||!F.shatter)return;
  var fz=F.smart?(s._frzTurn===turn&&s._frozenNow):F.turns.indexOf(turn)>=0;
  if(!fz||s._thawTurn===turn)return;
  var card=__SfrzTarget(s);
  if(!card||card.dead)return;
  var keep=card.reflect;card.reflect=0;
  de(s,turn,card,F.shatter);
  card.reflect=keep;
}
// Opponent-model sensitivity: enemy focuses our card at position focusIdx (null = engine rule: lowest current HP).
function __Sfocus(e){
  var f=e.SX.focusIdx;
  if(f==null)return null;
  for(var j=0;j<e.cards.length;j++){var c=e.cards[j];if(c.idx===f&&!c.dead)return c}
  return null;
}
// THAW variant (F.thaw): at the start of our cast phase, a frozen card is freed (and takes F.shatter damage)
//  1) by an ally heal ready on another living card: cast first, its heal forced onto the frozen card;
//  2) otherwise on a shop turn (even turn) by buying a Tox; 3) otherwise it stays frozen this turn.
function __SbreakIce(s,turn,card){
  var keep=card.reflect;card.reflect=0;
  de(s,turn,card,s.SX.freeze.shatter);
  card.reflect=keep;
}
function __Sthaw(s,turn){
  var F=s.SX.freeze;
  if(!F||!F.thaw||!__SfrozenNow(s,turn))return;
  var fc=__SfrzTarget(s);
  if(!fc||fc.dead)return;
  var isAllyHeal=function(o){return o.heals.length>0&&(o.target==='ally'||o.target==='allAllies'||o.target==='randomAlly')};
  for(var j=0;j<s.cards.length;j++){
    var c=s.cards[j];
    if(c===fc||c.dead)continue;
    for(var k=0;k<c.abilities.length;k++){
      var a=c.abilities[k],ab=a.ab;
      if(turn<a.nextTurn||a.uses<=0)continue;
      if(ab.cost&&Object.entries(ab.cost).some(function(x){return s.bonus[x[0]]<x[1]}))continue;
      if(ab.costHp&&O(c)-ab.costHp<.2*c.hpMax)continue;
      if(!ab.options.some(isAllyHeal))continue;
      s._healTo=fc;ve(c,a,s,turn);s._healTo=null;
      if(!fc.dead)__SbreakIce(s,turn,fc);
      s._thawTurn=turn;s._thawHeal=(s._thawHeal||0)+1;
      if(s.SX.debug)s.events.push({turn:turn,type:'thawHeal',card:c.card.name});
      return;
    }
  }
  if(turn%2===0){
    __SbreakIce(s,turn,fc);s._thawTurn=turn;s._thawTox=(s._thawTox||0)+1;
    if(s.SX.debug)s.events.push({turn:turn,type:'thawTox',card:fc.card.name});
  }
}
/* ===== end E1 hooks ===== */
`;

// 1. per-simulation init (after deck cards are built)
rep('s.profile=T(e),e.forEach((e,t)=>s.cards.push(E(e,s,t))),s.cards.sort((e,t)=>e.card.number-t.card.number);',
    's.profile=T(e),e.forEach((e,t)=>s.cards.push(E(e,s,t))),s.cards.sort((e,t)=>e.card.number-t.card.number);__Sinit(s);');

// 2. G(): taunt re-ordering of the target list
rep('let s=w(e);\n  if(!s.length)return;\n  let c=B(a),l=[];',
    'let s=w(e);\n  if(!s.length)return;\n  e.SX&&(s=__Sorder(e,s,r,i));\n  let c=B(a),l=[];');

// 3. G(): reflect accumulation per enemy hit, then applied to the attacker after the hit loop
rep('i.hp-=o,e.totals.dmg+=o,e.usefulByTurn[t-1]+=o,i.hp<=0&&l.push(i)\n  }',
    'i.hp-=o,e.totals.dmg+=o,e.usefulByTurn[t-1]+=o,i.hp<=0&&l.push(i),e.SX&&__Sracc(e,i,o)\n  }\n  e.SX&&__Srefl(e,t,r);');

// 4. L(): our precision malus (expected value, like the engine)
rep('return m((t.prec+e.prec+n.team.prec)/100,0,1)',
    'return n.SX&&n.SX.precMalus?m((t.prec+e.prec+n.team.prec-n.SX.precMalus)/100,0,1):m((t.prec+e.prec+n.team.prec)/100,0,1)');

// 5. ye(): with a malus, 100-precision damaging abilities can miss too -> scale gen/buffs like prec<100 ones
rep('d=c.hits.length&&s.prec<100?z(e,s,n):1',
    'd=c.hits.length&&(s.prec<100||n.SX&&n.SX.precMalus>0)?z(e,s,n):1');

// 6. ye(): remember whether the chosen option is single-target (for taunt)
rep('let s=t.ab,c=G(e,s,n);\n  if(!c)return;',
    'let s=t.ab,c=G(e,s,n);\n  if(!c)return;\n  n.SX&&(n._st=(c.target===`enemy`||c.target===`randomEnemy`));');

// 7. ye(): mark the two damage-dealing G() calls (reflect only applies to ability damage)
rep('if(t.resetPending=0,K(n,r,h,e,t,b),t.resetPending){',
    'if(t.resetPending=0,n.SX&&(n._dc=1),K(n,r,h,e,t,b),n.SX&&(n._dc=0),t.resetPending){');
rep('t.resetPending=0,K(n,r,h/u*i,e,t,b)',
    't.resetPending=0,n.SX&&(n._dc=1),K(n,r,h/u*i,e,t,b),n.SX&&(n._dc=0)');

// 8. ye(): lifesteal ordering sensitivity (STRESS.lsMode = 'after' | 'net'); default = engine order (heal before G)
rep('T&&(_+=T,y.push({\n    to:`self`,v:T/u\n  }))', 'T&&(_+=T,y.push({\n    to:`self`,v:T/u,ls:1\n  }))');
rep('for(let t of y)he(n,e,t.to,t.v*u);', 'for(let t of y)n.SX&&n.SX.lsMode&&t.ls?n._ls+=t.v*u:he(n,e,t.to,t.v*u);');
rep('let E=c.hits.length>0,', 'n.SX&&n.SX.lsMode&&__Sresolve(n,r,e);\n  let E=c.hits.length>0,');

// 9. main loop: frozen card cannot cast
rep('if(t.dead||e<n.nextTurn||n.uses<=0)continue;',
    'if(t.dead||e<n.nextTurn||n.uses<=0||s.SX&&__Sfrz(s,t,e))continue;');

// 10. main loop: a card killed by reflect stops casting
rep('t.skip||ve(t.cs,t.a,s,e)', 't.skip||t.cs._rk||ve(t.cs,t.a,s,e)');

// 11. end of our cast phase: ice-break damage on the frozen card
rep('let c=o.turnIncome?e:0;', 's.SX&&!s.over&&__Sshat(s,e);\n    let c=o.turnIncome?e:0;');

// 11b. sensitivity of the opponent model: the enemy's single-target hits go to our card at deck position
//      STRESS.focusIdx (while alive) instead of our lowest-current-HP card (our own taunt still wins).
rep('let s=i-o,c=e.cards.find(e=>!e.dead&&e.taunting);', 'let s=i-o,c=e.cards.find(e=>!e.dead&&e.taunting)||e.SX&&__Sfocus(e);');

// 13. thaw variant: start of our cast phase
rep('s.luckByTurn[e-1]=s.luck;', 's.luckByTurn[e-1]=s.luck;s.SX&&__Sthaw(s,e);');
// 14. heal splitter: during a thaw cast, single-ally / random-ally heals go to the frozen card
rep('else if(n===`spread`)for(let t of i)W(e,t,r/i.length);', 'else if(n===`spread`&&!(e.SX&&e._healTo))for(let t of i)W(e,t,r/i.length);');
rep('let t=i.reduce((e,t)=>t.dmgTaken>e.dmgTaken+1e-9?t:e,i[0]);', 'let t=e.SX&&e._healTo&&!e._healTo.dead?e._healTo:i.reduce((e,t)=>t.dmgTaken>e.dmgTaken+1e-9?t:e,i[0]);');

// 12. expose reflect-taken for diagnostics in q()'s result
rep('kills:s.enemyDeaths,talents:', 'kills:s.enemyDeaths,reflTaken:s._reflTaken||0,frzCount:s._frzCount||0,thawHeal:s._thawHeal||0,thawTox:s._thawTox||0,talents:');

src = helpers + src;
fs.writeFileSync(__dirname + '/engine121_stress.js', src);
new Function(src); // syntax check
console.log('engine121_stress.js written,', src.length, 'chars');
