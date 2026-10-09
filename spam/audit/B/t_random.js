// randomEnemy / spreadEnemy are resolved by the engine exactly like `enemy` (perfect focus on the lowest-HP enemy).
// EV of random targeting instead: spread the cast's damage evenly over the living enemies (G weights = 1 each).
(()=>{
const N2I=__NUM2ID__;
const M=MODELS.x1; const CARD=id=>M.cards.find(c=>c.id===id);
const entN=nums=>nums.map(n=>({card:CARD(N2I[n]),talent:null}));
const G0=G; let ON=false;
G=function(st,t,n,card,abil,w){
  if(ON&&abil&&abil.ab&&abil.ab.options&&abil.ab.options.length===1&&['randomEnemy','spreadEnemy'].includes(abil.ab.options[0].target)&&(!w||w.length===1)){
    const alive=st.enemies.filter(e=>e.hp>0).length||1; return G0.call(this,st,t,n,card,abil,Array(alive).fill(1));
  }
  return G0.apply(this,arguments);
};
function score(nums){let s=0,k=0,tt=0;for(const prof of d)for(const p of [1,2]){const r=q(entN(nums),{opponent:prof,player:p});s+=J(r);tt+=r.ttk;k++;}return {J:Math.round(s/k),ttk:Math.round(10*tt/k)/10};}
const decks={alt2:[69,160,227,238],owlGerz:[227,188,195,94],zaydGerz_neilla:[101,188,195,94],codexLight:[198,127,81,245]};
const out={};
for(const [k,nums] of Object.entries(decks)){ON=false;const a=score(nums);ON=true;const b=score(nums);ON=false;out[k]={focus:a,randomEV:b,deltaPct:Math.round(1000*(b.J-a.J)/a.J)/10};}
G=G0;
OUT.random=out;
})();
