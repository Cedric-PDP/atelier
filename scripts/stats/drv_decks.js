(()=>{
const MC={"A":["f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","6598bdc6-b5f4-47a8-be11-761422965f71","3c5cc4d2-1692-4da7-81ae-eb853c91327f","5721ea5f-5978-4328-8874-28abc283f6b8"],"B":["def9a313-f174-4e62-b4b8-1086d28bd09e","6598bdc6-b5f4-47a8-be11-761422965f71","edfb6bd4-3ac4-420c-bb25-91c9005dea80","e030e28b-0ba3-4c9e-932b-d7c333cadf26"],"C":["def9a313-f174-4e62-b4b8-1086d28bd09e","6598bdc6-b5f4-47a8-be11-761422965f71","e030e28b-0ba3-4c9e-932b-d7c333cadf26","5721ea5f-5978-4328-8874-28abc283f6b8"],"D":["76ecb89a-1b3d-4683-b076-5ea3fc20f91a","def9a313-f174-4e62-b4b8-1086d28bd09e","6598bdc6-b5f4-47a8-be11-761422965f71","e030e28b-0ba3-4c9e-932b-d7c333cadf26"]};
const DECKS={
 "deck chimere":["f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","6598bdc6-b5f4-47a8-be11-761422965f71","3c5cc4d2-1692-4da7-81ae-eb853c91327f","5721ea5f-5978-4328-8874-28abc283f6b8"],
 "deck Aleera":["40416045-b820-4d2c-96f9-34f87d99ac25","6598bdc6-b5f4-47a8-be11-761422965f71","3c5cc4d2-1692-4da7-81ae-eb853c91327f","5721ea5f-5978-4328-8874-28abc283f6b8"],
 "B":MC.B,
 "C":MC.C,
 "H1":["6428d28c-4897-46e4-bcc5-5165484fda2b","6598bdc6-b5f4-47a8-be11-761422965f71","9f744687-461b-493e-9a9a-408906fafbde","5721ea5f-5978-4328-8874-28abc283f6b8"],
 "H2":["6428d28c-4897-46e4-bcc5-5165484fda2b","6598bdc6-b5f4-47a8-be11-761422965f71","3c5cc4d2-1692-4da7-81ae-eb853c91327f","5721ea5f-5978-4328-8874-28abc283f6b8"],
 "H3":["def9a313-f174-4e62-b4b8-1086d28bd09e","feb27db8-e8a5-4ff3-8c30-fc76927965ee","6428d28c-4897-46e4-bcc5-5165484fda2b","e030e28b-0ba3-4c9e-932b-d7c333cadf26"]
};
const I1=ht(MODELS.x1),I0=ht(MODELS.x0);
const o={optimize:false,suggestions:false,shop:false};
const res={};
for(const [name,ids] of Object.entries(DECKS)){
  const sel=ids.map(id=>({id,talentId:null}));
  const a=I1.evaluate(sel,o),b=I0.evaluate(sel,o);
  res[name]={ids,s1:a.score,ttk:a.ttk,tier:a.tier,advantage:a.advantage,scale:a.scale,s0:b.score,ttk0:b.ttk};
}
res["(sanity) mc A == chimere"]=MC.A.join(",")===DECKS["deck chimere"].join(",");
OUT.decks=res;
})();
