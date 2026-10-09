(()=>{const ids=["6428d28c-4897-46e4-bcc5-5165484fda2b","6598bdc6-b5f4-47a8-be11-761422965f71","3c5cc4d2-1692-4da7-81ae-eb853c91327f","5721ea5f-5978-4328-8874-28abc283f6b8"];const I1=ht(MODELS.x1),I05=ht(MODELS.x05);const sel=ids.map(id=>({id,talentId:null}));
const base=I1.evaluate(sel,{optimize:false,suggestions:false,shop:true});const tl=base.shop.timeline;
const y1=base.score,y05=I05.evaluate(sel,{optimize:false,suggestions:false,shop:false}).score;
const rows={},lines={};base.shop.cards.forEach(c=>{const nf=c.lines.filter(l=>l.kind!=='free');rows[c.cardId]=nf.length;lines[c.cardId]=nf.map(l=>l.id)});
const ALL=[].concat(n.common,n.rare,n.epic,n.legendary);const c1=new Map(),c05=new Map();
const ex=(I,c,lo)=>{const key=JSON.stringify(lo);if(c.has(key))return c.get(key);let v=null;try{v=I.evaluate(sel,{optimize:false,suggestions:false,shop:false,loadout:lo}).score}catch(e){}c.set(key,v);return v};
const G=[];for(const id of ids){const pl=(rows[id]<3?[null]:[]).concat(lines[id]);for(const rm of pl)for(const t of ALL){const lo=[{cardId:id,added:[t],removed:rm?[rm]:[]}];const a=ex(I1,c1,lo);if(a==null)continue;const b=ex(I05,c05,lo);G.push({card:id,rem:rm,t,a1:a-y1,a05:(b??y05)-y05})}}
let seed=1;const rnd=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
const offer=odds=>{const got=[];let g=0;while(got.length<3&&g++<60){const tot=Object.values(odds).reduce((a,b)=>a+b,0);const u=rnd()*tot;let acc=0,rar='common';for(const q of ['common','rare','epic','legendary']){acc+=odds[q]||0;if(u<acc){rar=q;break}}const p=n[rar];const t=p[Math.floor(rnd()*p.length)];if(!got.includes(t))got.push(t)}return got};
const pick=(st,offered,budget)=>{let best=null;for(const x of G){if(!offered.includes(x.t)||st.bought.has(x.t)||r[x.t].cost>budget)continue;const used=rows[x.card]-st.rem[x.card].length+st.add[x.card].length;if(x.rem==null&&used>=3)continue;if(x.rem!=null&&st.rem[x.card].includes(x.rem))continue;const v=x.a1/y1;if(v<(x.rem?0.03:0.01))continue;if(!best||v>best.v)best={...x,v}}return best};
const lo=st=>ids.filter(id=>st.add[id].length||st.rem[id].length).map(id=>({cardId:id,added:st.add[id].slice().sort(),removed:st.rem[id].slice().sort()}));
OUT.res={};const TR=300;
for(const rr of [0,2]){seed=777;const f1=[],f05=[];const buys={};let nb=0;
  for(let tr=0;tr<TR;tr++){const st={bought:new Set(),add:{},rem:{}};ids.forEach(id=>{st.add[id]=[];st.rem[id]=[]});let spent=0,bonus=0,acc1=y1,acc05=y05,p1=y1,p05=y05;
    for(const op of tl){let budget=op.spamton+bonus-spent;let offered=offer(op.odds);let p=pick(st,offered,budget);let cost=10;
      for(let i=0;i<rr&&!p&&budget>=cost+15;i++){spent+=cost;budget-=cost;cost+=5;offered=offer(op.odds);p=pick(st,offered,budget)}
      if(p){st.bought.add(p.t);st.add[p.card].push(p.t);if(p.rem)st.rem[p.card].push(p.rem);spent+=r[p.t].cost;nb++;const fam=p.t.replace(/_[CREL]$/,'');buys[fam]=(buys[fam]||0)+1;
        const w=Math.max(0,(11-op.turn)/10);const L=lo(st);const s1=ex(I1,c1,L),s05=ex(I05,c05,L);if(s1!=null){acc1+=(s1-p1)*w;p1=s1}if(s05!=null){acc05+=(s05-p05)*w;p05=s05}}else bonus+=10}
    f1.push(acc1);f05.push(acc05)}
  const st=a=>{a.sort((x,y)=>x-y);return {mean:Math.round(a.reduce((x,y)=>x+y,0)/a.length),p10:Math.round(a[Math.floor(.1*a.length)])}};
  OUT.res['reroll'+rr]={x1:st(f1),x05:st(f05),buys:+(nb/TR).toFixed(2),fams:Object.entries(buys).sort((a,b)=>b[1]-a[1]).slice(0,7).map(([f,v])=>f+':'+Math.round(100*v/TR)+'%')}}
OUT.y={y1:Math.round(y1),y05:Math.round(y05)};OUT.timeline=tl;OUT.ttk=base.ttk;
const top={};G.forEach(x=>{const key=x.card+'|'+x.rem;(top[key]=top[key]||[]).push(x)});OUT.slots=Object.entries(top).map(([k,xs])=>({k,top:xs.sort((a,b)=>b.a1-a.a1).slice(0,8).map(x=>[x.t,+(100*x.a1/y1).toFixed(1),+(100*x.a05/y05).toFixed(1)])}));
})();
