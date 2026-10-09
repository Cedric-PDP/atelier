// SPAM 1.21 stress driver (engine 36e2c03d5b7bf4a1). 1.21 minified names (checked by content):
//   J = one match (1.20 q), Y = score (1.20 J), le = opponent phase (1.20 de), T = element profile,
//   xe = card DPS (1.20 Se), d = 9 profiles, o = params (o.opponent.dpsByTurn), ht = evaluator.
// MODE: 'check' | 'duel:none' | 'duel:rec' | 'incident' | 'sens'
(()=>{
const MODE=__MODE__;
const OUR=__OUR__;
const META=__META__;
const IDS=__IDS__;
const M=MODELS.x1; const byId=new Map(M.cards.map(c=>[c.id,c]));
const CARD=id=>{const c=byId.get(id); if(!c) throw new Error('unknown card '+id); return c;};
const ent=ids=>ids.map(id=>({card:CARD(id),talent:null}));
const rec=M.recommended||{};
const MATCH=J, SCORE=Y;
if(typeof MATCH!=='function'||typeof SCORE!=='function'||typeof le!=='function'||typeof T!=='function'||typeof xe!=='function'||!Array.isArray(d)||!o.opponent) throw new Error('1.21 name mapping failed');
const LE0=le; let HOOK=null;
le=function(st,t){ if(HOOK) HOOK(st,t); return LE0(st,t); };
const ZERO={id:'zero',cardHp:700,resist:0};
const BASEDPS=o.opponent.dpsByTurn.slice();
const setDps=f=>{for(let i=0;i<BASEDPS.length;i++)o.opponent.dpsByTurn[i]=BASEDPS[i]*f;};
const V=t=>o.opponent.dpsByTurn[Math.min(t,o.opponent.dpsByTurn.length)-1];
const all=v=>({fire:v,water:v,earth:v,nature:v,shadow:v,light:v});

// ---- outcome of a 30-turn race: W = our kill of the 4 enemies first, L = our 4 cards dead first, T = neither
function race(r){
  const alive=new Map(r.events.filter(e=>e.type==='ownDeath'||e.type==='ownRevive').map(e=>[e.card,true]));
  let wipe=null; const dead=new Set();
  for(const e of r.events){
    if(e.type==='ownDeath'){dead.add(e.card);} else if(e.type==='ownRevive'){dead.delete(e.card);}
    if(e.type==='ownDeath'&&dead.size>=4&&wipe==null) wipe=e.turn;
  }
  const kill=r.kills>=4&&r.ttk!=null?Math.ceil(r.ttk-1e-9):null;
  const out=kill!=null&&(wipe==null||kill<=wipe)?'W':(wipe!=null?'L':'T');
  return {o:out,kill,wipe};
}
// ---- per-card opponent from a real deck: unopposed per-card curves (potential mode vs a 0-resistance target)
const OPPCACHE=new Map();
function oppFromDeck(ids,player,turns,talents){
  const key=ids.join(',')+'|'+player+'|'+turns+'|'+talents;
  if(OPPCACHE.has(key)) return OPPCACHE.get(key);
  const cards=ids.map(CARD);
  const r=MATCH(cards.map(c=>({card:c,talent:talents?(rec[c.id]??null):null})),{potential:true,player,turns,opponent:ZERO});
  const P=r.potential; const n=cards.length; const heal=P.healByTurn.map(v=>v/n);
  const opp={id:'deck',cards:cards.map((c,i)=>{
    const prof=T([{card:c}]); const tot=Object.values(prof).reduce((a,b)=>a+b,0);
    const mix=tot>0?Object.fromEntries(Object.entries(prof).map(([k,v])=>[k,v/tot])):null;
    const dsum=P.dmgByCard[i].reduce((a,b)=>a+b,0);
    return {id:'o'+i,name:c.name,hp:P.board[i].hp,res:P.board[i].res,phoenix:P.board[i].phoenix,brut:P.board[i].brut,
      dmgByTurn:P.dmgByCard[i],healByTurn:heal,mix,aoe:dsum>0?Math.min(1,P.aoeByCard[i]/dsum):0};
  })};
  opp.dmg10=Math.round(P.dmgByCard.reduce((a,row)=>a+row.slice(0,10).reduce((x,y)=>x+y,0),0));
  OPPCACHE.set(key,opp); return opp;
}
function score18(ids,opts={}){let s=0,n=0;for(const prof of d)for(const p of [1,2]){s+=SCORE(MATCH(ent(ids),{opponent:prof,player:p,...opts}));n++;}return s/n;}
function race18(ids){let w=0,l=0,t=0;for(const prof of d)for(const p of [1,2]){const x=race(MATCH(ent(ids),{opponent:prof,player:p,turns:30}));x.o==='W'?w++:x.o==='L'?l++:t++;}return {w,l,t};}
// ---- incident opponent (per-card): Tisseuse (no damage, absorbs), Fleur de Vie (10/turn, permanent taunt), 2 x 700 HP carrying the curve
function azurian(turns){
  const Tis=CARD(IDS.tisseuse), Fl=CARD(IDS.fleur);
  const arr=f=>Array.from({length:turns},(_,i)=>f(V(i+1)));
  return {id:'azurian',cards:[
    {id:'tisseuse',hp:Tis.hp,res:{...Tis.res},dmgByTurn:arr(()=>0),aoe:0},
    {id:'fleur',hp:Fl.hp,res:{...Fl.res},dmgByTurn:arr(()=>10),aoe:0},
    {id:'x1',hp:700,res:all(10),dmgByTurn:arr(v=>(v-10)/2),aoe:o.opponent.aoeShare},
    {id:'x2',hp:700,res:all(10),dmgByTurn:arr(v=>(v-10)/2),aoe:o.opponent.aoeShare}]};
}
// absorb (Veuve noire, CD 8): ready at turn 7 if the opponent plays second (we are P1), turn 8 if it plays first (we are P2)
function absorbHook(targetId){
  return (st,t)=>{ const T0=st.player===1?7:8; if(t!==T0||st._abs) return; st._abs=1;
    const tis=st.enemies.find(e=>e.id==='tisseuse'&&e.hp>0); if(!tis) return;
    const X=st.cards.find(c=>c.card.id===targetId&&!c.dead); if(!X) return;
    const hp=X.hpMax; X.dead=true; X.dmgTaken=X.hpMax;
    // the card leaves the board: stop its per-turn passives too (engine would keep them, see B_engine.md C11)
    X.coeur=[]; X.mimetism=false; X.incisive=0; X.critPerTurn=0; X.resOnHit=0; X.corrosion=0; X.focus=0; X.hpGrowth=0; X.regenPct=0; X.luckPerTurn=0; X.cimetiere=0;
    X.passives=X.passives.filter(p=>p.type!=='punchingBag');
    tis.hp+=hp; tis.hpMax+=hp; st.events.push({turn:t,type:'absorbed',card:X.card.name}); };
}
function incidentRun(ids,{taunt,absorbId}){
  const rows=[];
  for(const p of [1,2]){
    HOOK=absorbId?absorbHook(absorbId):null;
    const r10=MATCH(ent(ids),{opponent:azurian(10),player:p,...(taunt?{focus:'fleur'}:{})});
    HOOK=absorbId?absorbHook(absorbId):null;
    const r30=MATCH(ent(ids),{opponent:azurian(30),player:p,turns:30,...(taunt?{focus:'fleur'}:{})});
    HOOK=null;
    rows.push({p,J:Math.round(SCORE(r10)),...race(r30),absorbed:r10.events.some(e=>e.type==='absorbed')});
  }
  return {J:Math.round((rows[0].J+rows[1].J)/2),wins:rows.filter(x=>x.o==='W').length,byOrder:rows};
}

const out={mode:MODE};
if(MODE==='check'){
  const pickD=['chimere','robA','anticrit','zerocrit','dc1'];
  out.check={};
  for(const lab of pickD){
    const D=OUR.find(x=>x.label===lab);
    const I=ht(M); const ev=I.evaluate(D.ids.map(id=>({id,talentId:null})),{optimize:false,suggestions:false,shop:false}).score;
    const mine=score18(D.ids);
    HOOK=(st,t)=>{}; const hooked=score18(D.ids); HOOK=null;
    let nA=0,nC=0; for(const p of [1,2]){nA+=SCORE(MATCH(ent(D.ids),{opponent:d[0],player:p}));
      nC+=SCORE(MATCH(ent(D.ids),{opponent:{id:'clone',cards:[0,1,2,3].map(i=>({id:'n'+i,hp:700,res:all(10),dmgByTurn:BASEDPS.map(v=>v/4),aoe:o.opponent.aoeShare}))},player:p}));}
    setDps(1.5); const x15=score18(D.ids); setDps(2); const x2=score18(D.ids); setDps(1);
    out.check[lab]={evaluate:ev,mine18:mine,withNoopHook:hooked,neutralAbstract:nA/2,neutralPerCardClone:nC/2,x15,x2};
  }
  out.oppDmg10={};
  for(const m of META){out.oppDmg10[m.key]={none:oppFromDeck(m.ids,2,10,false).dmg10,rec:oppFromDeck(m.ids,2,10,true).dmg10};}
  out.abstractDmg10=BASEDPS.reduce((a,b)=>a+b,0);
}
if(MODE.startsWith('duel:')){
  const tal=MODE==='duel:rec';
  out.duel={};
  for(const D of OUR){
    const R={label:D.label,nums:D.nums,vs:{}};
    let wins=0,losses=0,timeouts=0,Jsum=0,n=0;
    for(const m of META){
      const per=[];
      for(const p of [1,2]){
        const opp10=oppFromDeck(m.ids,3-p,10,tal), opp30=oppFromDeck(m.ids,3-p,30,tal);
        const r10=MATCH(ent(D.ids),{opponent:opp10,player:p});
        const r30=MATCH(ent(D.ids),{opponent:opp30,player:p,turns:30});
        const rc=race(r30);
        per.push({p,J:Math.round(SCORE(r10)),o:rc.o,kill:rc.kill,wipe:rc.wipe,deaths10:r10.ownDeaths,kills10:r10.kills});
        Jsum+=SCORE(r10); n++; rc.o==='W'?wins++:rc.o==='L'?losses++:timeouts++;
      }
      R.vs[m.key]=per;
    }
    Object.assign(R,{wins,losses,timeouts,games:n,meanJ10:Math.round(Jsum/n)});
    out.duel[D.key]=R;
  }
  out.oppDmg10=Object.fromEntries(META.map(m=>[m.key,oppFromDeck(m.ids,2,10,tal).dmg10]));
}
if(MODE.startsWith('sym:')){
  // Symmetric race: both sides get the same treatment (simulated with attrition against the other's unopposed curves).
  // A wins if it wipes B on an earlier turn than B wipes A (same turn: the side that plays first in the turn wins).
  const tal=MODE==='sym:rec';
  const entT=(ids,t)=>ids.map(id=>({card:CARD(id),talent:t?(rec[id]??null):null}));
  out.sym={};
  for(const D of OUR){
    const R={label:D.label,nums:D.nums,vs:{}}; let w=0,l=0,t=0;
    for(const m of META){
      const per=[];
      for(const p of [1,2]){
        const kA=race(MATCH(ent(D.ids),{opponent:oppFromDeck(m.ids,3-p,30,tal),player:p,turns:30})).kill;
        const kB=race(MATCH(entT(m.ids,tal),{opponent:oppFromDeck(D.ids,p,30,false),player:3-p,turns:30})).kill;
        let r='T';
        if(kA!=null&&(kB==null||kA<kB||(kA===kB&&p===1))) r='W'; else if(kB!=null&&(kA==null||kB<kA||(kA===kB&&p===2))) r='L';
        per.push({p,kA,kB,o:r}); r==='W'?w++:r==='L'?l++:t++;
      }
      R.vs[m.key]=per;
    }
    // calibration: mirror (our deck against its own curves), asymmetric and symmetric
    const mir=[];
    for(const p of [1,2]){
      const asym=race(MATCH(ent(D.ids),{opponent:oppFromDeck(D.ids,3-p,30,false),player:p,turns:30}));
      const kB=race(MATCH(ent(D.ids),{opponent:oppFromDeck(D.ids,p,30,false),player:3-p,turns:30})).kill;
      let r='T'; if(asym.kill!=null&&(kB==null||asym.kill<kB||(asym.kill===kB&&p===1))) r='W'; else if(kB!=null&&(asym.kill==null||kB<asym.kill||(asym.kill===kB&&p===2))) r='L';
      mir.push({p,asym:asym.o,sym:r,kA:asym.kill,kB});
    }
    Object.assign(R,{wins:w,losses:l,timeouts:t,games:w+l+t,mirror:mir});
    out.sym[D.key]=R;
  }
}
if(MODE==='incident'){
  out.incident={};
  for(const D of OUR.filter(x=>x.named)){
    const R={label:D.label,nums:D.nums};
    R.plain=incidentRun(D.ids,{taunt:false});
    R.tauntOnly=incidentRun(D.ids,{taunt:true});
    const absBy={}, bothBy={};
    for(const id of D.ids){absBy[CARD(id).name]=incidentRun(D.ids,{taunt:false,absorbId:id}); bothBy[CARD(id).name]=incidentRun(D.ids,{taunt:true,absorbId:id});}
    const worst=o=>Object.entries(o).reduce((a,[k,v])=>(!a||v.J<a.v.J)?{k,v}:a,null);
    const wa=worst(absBy), wb=worst(bothBy);
    R.absorbOnly={target:wa.k,...wa.v,perTarget:Object.fromEntries(Object.entries(absBy).map(([k,v])=>[k,{J:v.J,wins:v.wins}]))};
    R.tauntAbsorb={target:wb.k,...wb.v,perTarget:Object.fromEntries(Object.entries(bothBy).map(([k,v])=>[k,{J:v.J,wins:v.wins}]))};
    out.incident[D.key]=R;
  }
}
if(MODE==='sens'){
  out.sens={};
  for(const D of OUR.filter(x=>x.named)){
    const R={label:D.label,nums:D.nums};
    for(const f of [1,1.5,2]){ setDps(f); R['x'+f]={J:Math.round(score18(D.ids)),race:race18(D.ids)}; }
    setDps(1);
    out.sens[D.key]=R;
  }
}
le=LE0; HOOK=null; setDps(1);
OUT.res=out;
})();
