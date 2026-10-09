// Adds the "freeze + thaw by the player" variant to a builder script (1.20 or 1.21 names).
// usage: node thaw_patch.js <builder.js> <castFn> <dmgFn> <hpFn> <healFn>
const fs=require('fs');
const [file,CAST,DMG,HP,HEAL]=process.argv.slice(2);
let b=fs.readFileSync(file,'utf8');
const R=(a,c)=>{const k=b.split(a).length-1;if(k!==1)throw new Error(k+' x '+a);b=b.replace(a,()=>c)};
// 1. frozen check and ice-break skip when thawed this turn
R("  return !!F&&card.idx===F.idx&&__SfrozenNow(s,turn);\n}",
  "  return !!F&&card.idx===F.idx&&__SfrozenNow(s,turn)&&s._thawTurn!==turn;\n}");
R("  var fz=F.smart?(s._frzTurn===turn&&s._frozenNow):F.turns.indexOf(turn)>=0;\n  if(!fz)return;",
  "  var fz=F.smart?(s._frzTurn===turn&&s._frozenNow):F.turns.indexOf(turn)>=0;\n  if(!fz||s._thawTurn===turn)return;");
// 2. thaw helpers (before the end marker of the helper block)
R("/* ===== end E1 hooks ===== */",
`// THAW variant (F.thaw): at the start of our cast phase, a frozen card is freed (and takes F.shatter damage)
//  1) by an ally heal ready on another living card: cast first, its heal forced onto the frozen card;
//  2) otherwise on a shop turn (even turn) by buying a Tox; 3) otherwise it stays frozen this turn.
function __SbreakIce(s,turn,card){
  var keep=card.reflect;card.reflect=0;
  ${DMG}(s,turn,card,s.SX.freeze.shatter);
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
      if(ab.costHp&&${HP}(c)-ab.costHp<.2*c.hpMax)continue;
      if(!ab.options.some(isAllyHeal))continue;
      s._healTo=fc;${CAST}(c,a,s,turn);s._healTo=null;
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
/* ===== end E1 hooks ===== */`);
// 3. engine patches: thaw call at the start of the cast phase, heal redirect in the heal splitter
R("// 12. expose reflect-taken", `// 13. thaw variant: start of our cast phase
rep('s.luckByTurn[e-1]=s.luck;', 's.luckByTurn[e-1]=s.luck;s.SX&&__Sthaw(s,e);');
// 14. heal splitter: during a thaw cast, single-ally / random-ally heals go to the frozen card
rep('else if(n===\`spread\`)for(let t of i)${HEAL}(e,t,r/i.length);', 'else if(n===\`spread\`&&!(e.SX&&e._healTo))for(let t of i)${HEAL}(e,t,r/i.length);');
rep('let t=i.reduce((e,t)=>t.dmgTaken>e.dmgTaken+1e-9?t:e,i[0]);', 'let t=e.SX&&e._healTo&&!e._healTo.dead?e._healTo:i.reduce((e,t)=>t.dmgTaken>e.dmgTaken+1e-9?t:e,i[0]);');

// 12. expose reflect-taken`);
R("frzCount:s._frzCount||0,talents:", "frzCount:s._frzCount||0,thawHeal:s._thawHeal||0,thawTox:s._thawTox||0,talents:");
fs.writeFileSync(file,b);
console.log('thaw variant added to',file);
