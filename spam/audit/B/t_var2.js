// Crit variance, done right: B() is overridden ONLY for real damage resolution (6th arg a===false, i.e. the call
// from ye()); valuation calls (j(), Se(), pe(), anticipation: a===true) keep the expected value, so ability ordering,
// option choice and ally targeting (K()) are untouched. One crit roll per hit line per cast (shared by all targets
// and by echo repeats -> slightly pessimistic on variance for AoE, optimistic for echo).
(()=>{
const DECKS=__DECKS__;
const M=MODELS.x1; const CARD=id=>M.cards.find(c=>c.id===id);
const ent=ids=>ids.map(id=>({card:CARD(id),talent:null}));
let seed=12345; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const B0=B; let MC=false;
B=function(e,t,n,r,i,a=false,s=null,c=null){
  if(a||!MC) return B0.apply(this,arguments);
  let l=c?[1]:oe(n,e,i), u=e.brut?0:(c?C(i,e,r.element,c):S(i,e,r.element))/100, dd=c?c.hpMax:i.opp.cardHp,
      f=i.team.berserk*(e.randomized?o.imprudentMult:1), p=(r.pctMaxHp?dd*r.min/100:z(e,r,i,s))*f,
      m=F(e,t,i), h=ie(e,t,i);
  let g=(rnd()<m)?I(p*h,u):I(p,u);
  g*=L(e,t,i)*R(l); e.erosion&&(g*=1.1); e.poison&&(g+=e.poison/100*dd*3*l.length*L(e,t,i));
  return g;
};
function score(ids){let s=0,n=0;for(const prof of d)for(const p of [1,2]){s+=J(q(ent(ids),{opponent:prof,player:p}));n++;}return s/n;}
const N=__N__; const out={};
const pc=(a,f)=>a[Math.min(a.length-1,Math.floor(a.length*f))];
for(const [deck,ids] of Object.entries(DECKS)){
  MC=false; const ev=score(ids); const evn=J(q(ent(ids),{opponent:d[0],player:1}));
  MC=true; const xs=[]; for(let k=0;k<N;k++)xs.push(score(ids));
  const ys=[],tt=[]; for(let k=0;k<N*4;k++){const r=q(ent(ids),{opponent:d[0],player:1});ys.push(J(r));tt.push(r.ttk);}
  MC=false;
  xs.sort((a,b)=>a-b); ys.sort((a,b)=>a-b); tt.sort((a,b)=>a-b);
  const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
  const sd=a=>{const m=mean(a);return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length)};
  out[deck]={ev18:Math.round(ev),mc18:{mean:Math.round(mean(xs)),sd:Math.round(sd(xs)),p10:Math.round(pc(xs,.1)),p90:Math.round(pc(xs,.9))},
    neutralP1:{ev:Math.round(evn),mean:Math.round(mean(ys)),sd:Math.round(sd(ys)),p10:Math.round(pc(ys,.1)),p50:Math.round(pc(ys,.5)),p90:Math.round(pc(ys,.9)),ttkP10:pc(tt,.1),ttkP50:pc(tt,.5),ttkP90:pc(tt,.9)}};
}
B=B0;
OUT.mc=out;
})();
