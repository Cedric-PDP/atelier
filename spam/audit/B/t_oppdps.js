// How hard does a real deck hit compared with the abstract opponent? q(...,{potential:true}) = unopposed damage
// output per turn (no incoming damage, no kills/overkill), i.e. exactly what a per-card opponent would deal.
(()=>{
const N2I=__NUM2ID__; const NAMES=__NAMES__;
const M=MODELS.x1; const CARD=id=>M.cards.find(c=>c.id===id);
const rec=M.recommended||{};
const pot=(cards,talents)=>{const out=[];for(const p of [1,2]){const r=q(cards.map((c,i)=>({card:c,talent:talents?talents[i]:null})),{potential:true,player:p});
  const per=Array(10).fill(0);for(const row of r.potential.dmgByCard)row.forEach((v,t)=>per[t]+=v);out.push(per);}
  return out[0].map((v,t)=>Math.round((v+out[1][t])/2));};
const sum=a=>a.reduce((x,y)=>x+y,0);
const res={abstract:o.opponent.dpsByTurn.slice(),abstractSum:sum(o.opponent.dpsByTurn),decks:{},random:null};
for(const [name,nums] of Object.entries(NAMES)){
  const cards=nums.map(n=>CARD(N2I[n]));
  const a=pot(cards,null), b=pot(cards,cards.map(c=>rec[c.id]??null));
  res.decks[name]={nums,noTalent:a,noTalentSum:sum(a),recTalent:b,recTalentSum:sum(b)};
}
let seed=7;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const sums=[];
for(let k=0;k<300;k++){const pick=new Set();while(pick.size<4)pick.add(M.cards[Math.floor(rnd()*M.cards.length)]);sums.push(sum(pot([...pick],null)));}
sums.sort((x,y)=>x-y);
res.random={p10:sums[30],p25:sums[75],p50:sums[150],p75:sums[225],p90:sums[270],max:sums[299]};
OUT.opp=res;
})();
