(()=>{
const CH=["f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","6598bdc6-b5f4-47a8-be11-761422965f71","3c5cc4d2-1692-4da7-81ae-eb853c91327f","5721ea5f-5978-4328-8874-28abc283f6b8"], AL=["40416045-b820-4d2c-96f9-34f87d99ac25","6598bdc6-b5f4-47a8-be11-761422965f71","3c5cc4d2-1692-4da7-81ae-eb853c91327f","5721ea5f-5978-4328-8874-28abc283f6b8"];
const I1=ht(MODELS.x1), I0=ht(MODELS.x0);
const ev=(I,ids)=>I.evaluate(ids.map(id=>({id,talentId:null})),{optimize:false,suggestions:false,shop:false});
const t0=Date.now();
const a=ev(I1,CH); const t1=Date.now();
const perms=[CH,[CH[3],CH[2],CH[1],CH[0]],[CH[1],CH[3],CH[0],CH[2]]];
const res={};
res.timingMs=t1-t0;
res.orders=perms.map(p=>{const r=ev(I1,p);return {score:r.score,ttk:r.ttk,tier:r.tier,adv:r.advantage,scale:r.scale,ntScore:r.noTalent.score,ntTier:r.noTalent.tier,ntAdv:r.noTalent.advantage}});
const b=ev(I1,AL); res.aleera={score:b.score,ttk:b.ttk,tier:b.tier,adv:b.advantage,scale:b.scale};
const c=ev(I0,CH); res.chimere0={score:c.score,tier:c.tier,adv:c.advantage};
const d=ev(I0,AL); res.aleera0={score:d.score,tier:d.tier,adv:d.advantage};
// timing of 20 evals of different decks
const ids=MODELS.x1.cards.map(c=>c.id);
const t2=Date.now(); for(let k=0;k<20;k++){ev(I1,[ids[k],ids[k+20],ids[k+40],ids[k+60]]);} res.ms20=Date.now()-t2;
res.topKeysType=typeof ut;
OUT.res=res;
})();
