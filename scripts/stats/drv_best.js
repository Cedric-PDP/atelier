(()=>{
const I=ht(MODELS.x1);
const ids=MODELS.x1.cards.map(c=>c.id);
const t0=Date.now();
const r=I.bestDecks(ids);
OUT.ms=Date.now()-t0;
OUT.best=r;
// re-evaluate the no-talent winners through evaluate() in x1 and x0 for consistency
const I0=ht(MODELS.x0);
const ev=(J,d)=>J.evaluate(d.map(id=>({id,talentId:null})),{optimize:false,suggestions:false,shop:false});
OUT.noTalentCheck=(r.noTalent||[]).map(d=>{const ids4=d.cards.map(c=>c.id);const a=ev(I,ids4),b=ev(I0,ids4);return {ids:ids4,s1:a.score,s0:b.score,tier:a.tier,adv:a.advantage}});
})();
