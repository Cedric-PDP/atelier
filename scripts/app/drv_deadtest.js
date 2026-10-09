(()=>{try{const I=ht(MODELS.x1);const by=n=>MODELS.x1.cards.find(c=>c.number===n).id;
const deck=[103,238,156,117].map(by);const ev=ids=>{const r=I.evaluate(ids.map(id=>({id,talentId:null})),{optimize:false,suggestions:false,shop:false});return {s:Math.round(r.score),ttk:r.ttk,dmg:r.dmgByTurn.map(Math.round)}};
OUT.full=ev(deck);OUT.lost=deck.map((id,i)=>{const d=deck.slice();d[i]='dead-card';return Object.assign({lost:MODELS.x1.cards.find(c=>c.id===id).name},ev(d))});}catch(e){OUT.err=String(e.stack||e).slice(0,600)}})();
