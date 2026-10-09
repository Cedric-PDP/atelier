const fs=require('fs');
const m=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const cnt=(map,k)=>{map[k]=(map[k]||0)+1};
const eff={},effFields={},targets={},hitFields={},healFields={},genFields={},pas={},pasFields={},tal={},talFields={},abFields={},cardFields={},effScopes={},abCd={},optFields={};
const effCards={};
for(const c of m.cards){
  for(const k of Object.keys(c))cnt(cardFields,k);
  for(const a of c.abilities){
    for(const k of Object.keys(a))cnt(abFields,k);
    cnt(abCd,a.cd);
    for(const o of a.options){
      for(const k of Object.keys(o))cnt(optFields,k);
      cnt(targets,o.target);
      for(const h of o.hits)for(const k of Object.keys(h))cnt(hitFields,k+(k==='element'?':'+h.element:''));
      for(const h of o.heals)for(const k of Object.keys(h))cnt(healFields,k+(k==='target'?':'+h.target:'')+(k==='element'?':'+h.element:''));
      for(const h of o.gen)for(const k of Object.keys(h))cnt(genFields,k+(k==='element'?':'+h.element:''));
      for(const e of o.effects){cnt(eff,e.type);(effCards[e.type]=effCards[e.type]||new Set()).add('#'+c.number);
        for(const k of Object.keys(e))cnt(effFields,e.type+'.'+k);
        cnt(effScopes,e.type+':scope='+e.scope+':target='+e.target);}
    }
  }
  for(const p of c.passives){cnt(pas,p.type);for(const k of Object.keys(p))cnt(pasFields,p.type+'.'+k)}
  for(const t of c.talents){cnt(tal,t.kind);for(const k of Object.keys(t))cnt(talFields,t.kind+'.'+k)}
}
const show=(n,o)=>console.log('== '+n+'\n'+JSON.stringify(o));
show('cardFields',cardFields);show('abFields',abFields);show('abCd',abCd);show('optFields',optFields);show('targets',targets);show('hitFields',hitFields);show('healFields',healFields);show('genFields',genFields);
show('effects',eff);show('effFields',effFields);show('effScopes',effScopes);
show('effCards',Object.fromEntries(Object.entries(effCards).map(([k,v])=>[k,[...v].join(' ')])));
show('passives',pas);show('pasFields',pasFields);show('talents',tal);show('talFields',talFields);
