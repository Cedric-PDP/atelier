// Share of J coming from flat credits (control, defenseCredits, economy) for control-flavoured decks,
// plus per-card solo flat credits (what the card tier list's "Contrôle" axis is made of).
(()=>{
const N2I=__NUM2ID__;
const M=MODELS.x1; const CARD=id=>M.cards.find(c=>c.id===id);
const entN=nums=>nums.map(n=>({card:CARD(N2I[n]),talent:null}));
const decks={freeze:[23,29,59,211],eternity:[88,21,64,35],misc:[78,174,81,96],owned_ctl:[33,259,12,116],owned_ctl2:[33,259,103,238],chimere:[103,238,156,117]};
const out={decks:{},solo:[],oneAction:{}};
for(const [k,nums] of Object.entries(decks)){
  let acc={J:0,off:0,ehp:0,defC:0,ctl:0,eco:0},n=0,acc1={J:0};
  for(const prof of d)for(const p of [1,2]){const r=q(entN(nums),{opponent:prof,player:p});acc.J+=J(r);acc.off+=r.offense;acc.ehp+=.35*r.ehpLeft;acc.defC+=.35*r.defenseCredits;acc.ctl+=.8*r.control;acc.eco+=.5*r.economy;n++;
    const r1=q(entN(nums),{opponent:prof,player:p,oneActionPerCard:true});acc1.J+=J(r1);}
  for(const x in acc)acc[x]=Math.round(acc[x]/n);
  acc.flatPct=Math.round(100*(acc.defC+acc.ctl)/acc.J); acc.oneActionPerCardJ=Math.round(acc1.J/n); acc.cards=nums.map(x=>CARD(N2I[x]).name).join(', ');
  out.decks[k]=acc;
}
for(const c of M.cards){const r=q([{card:c,talent:null}],{opponent:d[0],player:1});
  if(r.control>0||r.defenseCredits>0)out.solo.push({n:c.number,name:c.name,control:Math.round(r.control),defC:Math.round(r.defenseCredits),off:Math.round(r.offense),J:Math.round(J(r))});}
out.solo.sort((a,b)=>(b.control*.8+b.defC*.35)-(a.control*.8+a.defC*.35));
OUT.flat=out;
})();
