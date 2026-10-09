(()=>{const ids=["def9a313-f174-4e62-b4b8-1086d28bd09e","6598bdc6-b5f4-47a8-be11-761422965f71","edfb6bd4-3ac4-420c-bb25-91c9005dea80","e030e28b-0ba3-4c9e-932b-d7c333cadf26"];const sel=ids.map(id=>({id,talentId:null}));
const base=bt.evaluate(sel,{optimize:false,suggestions:false,shop:true});const y=base.score;
const ALL=[].concat(n.common,n.rare,n.epic,n.legendary);const out=[];
for(const c of base.shop.cards){const pl=[];const rows=c.lines.filter(l=>l.kind!=='free').length;if(rows<3)pl.push(null);c.lines.filter(l=>l.verdict==='remplacer').forEach(l=>pl.push(l.id));
 for(const rm of pl){const g=[];for(const t of ALL){let v=null;try{v=bt.evaluate(sel,{optimize:false,suggestions:false,shop:false,loadout:[{cardId:c.cardId,added:[t],removed:rm?[rm]:[]}]}).score}catch(e){}if(v!=null)g.push([t,+(100*(v-y)/y).toFixed(1),r[t].cost])}
 g.sort((a,b)=>b[1]-a[1]);out.push({card:c.cardId,rem:rm,top:g.filter(x=>x[1]>=3).slice(0,40)})}}
OUT.slots=out;OUT.y=y;})();
