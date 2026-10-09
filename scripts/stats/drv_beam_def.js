(()=>{
// Wider beam search than bestDecks() (which uses pairs 120 / triples 100 / quads 400 / finalTop 8),
// using the engine's own top-level beam (ut) and full rescoring (Te), no talents.
const rows=MODELS.x1.cards.map(c=>({card:c,talent:null}));
const beam={beamPairs:260,beamTriples:260,beamQuads:120,finalTop:40};
const t0=Date.now();
const n=ut(rows,{beam,talentMode:'none'});
const t1=Date.now();
const fin=n.slice(0,beam.finalTop).map(node=>({ids:node.rows.map(r=>r.card.id),nums:node.rows.map(r=>r.card.number),beamScore:node.score,score:Te(node.rows.map(r=>r.card),{talentMode:'none'}).score})).sort((a,b)=>b.score-a.score);
OUT.beam=beam;OUT.msBeam=t1-t0;OUT.msFinal=Date.now()-t1;OUT.top=fin.slice(0,15);
})();
