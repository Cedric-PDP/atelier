(()=>{
const M=MODELS.x1;
const rows=M.cards.map(c=>({card:c,talent:M.recommended[c.id]??null}));
let seed=12345;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff};
const pick=()=>{const s=new Set();while(s.size<4)s.add(Math.floor(rnd()*rows.length));return [...s].map(i=>rows[i])};
const quads=[];for(let i=0;i<600;i++)quads.push(pick());
let t0=Date.now();let acc=0;
for(const qd of quads){acc+=J(q(ct(qd,'best-one'),{talentMode:'best-one'}))}
OUT.q_bestone_ms_per=(Date.now()-t0)/quads.length;
t0=Date.now();
for(const qd of quads){acc+=J(q(ct(qd,'none'),{talentMode:'none'}))}
OUT.q_none_ms_per=(Date.now()-t0)/quads.length;
t0=Date.now();
for(const qd of quads.slice(0,40)){acc+=X(qd.map(r=>({card:r.card,talent:r.talent})),{}).score}
OUT.X_ms_per=(Date.now()-t0)/40;
t0=Date.now();
for(const qd of quads.slice(0,10)){acc+=Te(qd.map(r=>r.card),{talentMode:'best-one'}).score}
OUT.Te_ms_per=(Date.now()-t0)/10;
// check consistency with evaluate
const I=ht(M);const sel=quads[0].map(r=>({id:r.card.id,talentId:r.talent==null?null:r.card.talents[r.talent].id}));
const ev=I.evaluate(sel,{optimize:false,suggestions:false,shop:false});
OUT.check={evaluate:ev.score,X:X(quads[0].map(r=>({card:r.card,talent:r.talent})),{}).score};
OUT.profiles=d.map(p=>p.id);OUT.acc=acc;
})();
