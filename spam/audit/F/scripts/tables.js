// Render the markdown tables of F_meta.md from F_meta.json (numbers never hand-copied).
const fs=require('fs');
const W=require('path').resolve(__dirname,'..'); // spam/audit/F
const R=JSON.parse(fs.readFileSync(W+'/F_meta.json','utf8'));
const pc=v=>v==null?'–':(100*v).toFixed(v>0&&v<0.01?1:(v<0.1?1:0))+' %';
const p1=v=>v==null?'–':(100*v).toFixed(1);
const short={common:'C',rare:'R',epic:'E',legendary:'L',divine:'D'};
const out=[];
// 0. summary table (written to its own file, used at the top of the report)
{const S=[];const card=n=>R.cards.find(c=>c.number===n);const rk=new Map(R.cards.map((c,i)=>[c.number,i]));
 S.push('| Mécanique (innée) | **P_mix** | casual | wiki-only | sans B | vétéran | plage (min–max) | porteurs les plus probables (P_mix de la carte) |');S.push('|---|---|---|---|---|---|---|---|');
 for(const k of ['freezeAny','vanishAny','tauntAny','tauntPermanent','immunity','smokeAny','breakTaunt','reflect','resetEnemyCd','resurrect','absorbAny','setHpPct','enemyPrec','resetEnemySpamton','absorbAlly','changeElement','eternityAny','anyHostile','anyHard']){
   const m=R.mechanics.find(x=>x.key===k);const top=m.cards.map(card).sort((a,b)=>b.blend-a.blend).slice(0,4).map(c=>`${c.name} #${c.number} (${short[c.rarity]}, ${p1(c.blend)})`).join(' · ');
   S.push(`| ${m.label.trim()} | **${p1(m.blend)}** | ${p1(m.blend_casual)} | ${p1(m.blend_wikiOnly)} | ${p1(m.blend_noGreedy)} | ${p1(m.blend_veteran)} | ${p1(m.min)}–${p1(m.max)} | ${['anyHostile','anyHard'].includes(k)?'—':top} |`);}
 fs.writeFileSync(W+'/tables_summary.md',S.join('\n'));}
// 1. mechanic exposure
const MC=[['P1_T_top1000','P1 T1000'],['P1_N_top1000','P1 N1000'],['P2_U_random','P2 U'],['P2_V_random','P2 V'],['B_U_greedy','B U'],['C_U_N','C U N'],['C_U_T','C U T'],['C_V_N','C V N'],['D_U_N','D U N'],['P3_all_120','P3 all 1.20'],['P3_nt_120','P3 nt 1.20'],['P3_all_121','P3 all 1.21'],['P3_nt_121','P3 nt 1.21'],['P3_cat_120','P3 cat 1.20']];
out.push('### T1 — Exposition par mécanique : P(le deck adverse contient ≥ 1 carte qui la porte), en %\n');
out.push('| Mécanique | '+MC.map(x=>x[1]).join(' | ')+' | **Mélange** | min–max (cellules du mélange, hors B F) | casual | wiki-only | vétéran | copie 1.21 | sans B |');
out.push('|'+'---|'.repeat(MC.length+8));
for(const m of R.mechanics){out.push(`| ${m.label} | `+MC.map(([k])=>p1(m.byProxy[k])).join(' | ')+` | **${p1(m.blend)}** | ${p1(m.min)}–${p1(m.max)} | ${p1(m.blend_casual)} | ${p1(m.blend_wikiOnly)} | ${p1(m.blend_veteran)} | ${p1(m.blend_copier121)} | ${p1(m.blend_noGreedy)} |`);}
out.push('');
out.push('Cartes porteuses (n° FR) : '+R.mechanics.filter(m=>!m.label.startsWith('  ')&&!['anyListed','anyHard'].includes(m.key)).map(m=>`**${m.key}** ${m.cards.join(', ')}`).join(' · ')+'\n');
// 2. top 40 cards (blend)
const CC=[['P1_T_top1000','P1 T1000'],['P1_N_top1000','P1 N1000'],['P2_U_random','P2 U'],['B_U_greedy','B U'],['C_U_N','C U N'],['C_U_T','C U T'],['C_V_N','C V N'],['D_U_N','D U N'],['P3_all_120','P3 all 1.20'],['P3_nt_120','P3 nt 1.20'],['P3_all_121','P3 all 1.21']];
out.push('### T2 — Top 40 cartes adverses : P(la carte est dans le deck adverse), en %, triées par mélange\n');
out.push('| # | n° | Carte | Rar. | Mécaniques perturbatrices (innées) | **Mélange** | casual | wiki-only | copie 1.21 | '+CC.map(x=>x[1]).join(' | ')+' |');
out.push('|'+'---|'.repeat(CC.length+9));
const lab=x=>x==='freezeAlly'?'gel sur SON allié (non perturbant)':x;
R.cards.slice(0,40).forEach((c,i)=>{const mech=c.mechanics.filter(x=>x!=='tauntPermanent').map(lab).join(', ')+(c.mechanics.includes('tauntPermanent')?' (permanente)':'');
  out.push(`| ${i+1} | ${c.number} | ${c.name} | ${short[c.rarity]} | ${mech||'—'} | **${p1(c.blend)}** | ${p1(c.blend_casual)} | ${p1(c.blend_wikiOnly)} | ${p1(c.blend_copier121)} | `+CC.map(([k])=>p1(c.byProxy[k])).join(' | ')+' |');});
out.push('');
// 2b. disruptive cards not in top 40
const dis=R.cards.map((c,i)=>({...c,pos:i+1})).filter(c=>c.mechanics.some(x=>x!=='freezeAlly')&&c.pos>40);
out.push('Cartes perturbatrices hors top 40 (rang du mélange) : '+dis.map(c=>`${c.number} ${c.name} [${short[c.rarity]}, ${c.mechanics.join('/')}] ${p1(c.blend)} % (#${c.pos})`).join(' · ')+'\n');
// 3. proxy 1 top-N frequencies
out.push('### T3 — Proxy 1 : fréquence des cartes dans les N meilleurs decks du moteur (pool complet de 127 cartes), en %\n');
out.push('| n° | Carte | Rar. | Méca. | T100 | T500 | T1000 | N100 | N500 | N1000 |');out.push('|---|---|---|---|---|---|---|---|---|---|');
const p1rows=R.cards.map(c=>({...c,s:Math.max(c.byProxy.P1_T_top1000,c.byProxy.P1_N_top1000)})).sort((a,b)=>b.s-a.s).slice(0,40);
for(const c of p1rows)out.push(`| ${c.number} | ${c.name} | ${short[c.rarity]} | ${c.mechanics.map(lab).join(', ')||'—'} | ${p1(c.byProxy.P1_T_top100)} | ${p1(c.byProxy.P1_T_top500)} | ${p1(c.byProxy.P1_T_top1000)} | ${p1(c.byProxy.P1_N_top100)} | ${p1(c.byProxy.P1_N_top500)} | ${p1(c.byProxy.P1_N_top1000)} |`);
out.push('');
// 4. tox side channel
out.push('### T4 — Canal hors deck : Tox perturbatrices que l\'adversaire peut ACHETER (boutique, chance = tour, 3 offres, sans relance)\n');
out.push('| Mécanique | Tox | P(proposée ≥ 1× T2–T8) | P(proposée ≥ 1× T2–T10) | P(achetée, naïf 1/3 si proposée, T2–T10) |');out.push('|---|---|---|---|---|');
for(const [k,v] of Object.entries(R.toxSideChannel))out.push(`| ${k} | ${v.tox.join(', ')} | ${p1(v.offered_T2_T8)} % | ${p1(v.offered_T2_T10)} % | ${p1(v.naiveBought_T2_T10)} % |`);
out.push('');
// 5. observation
out.push('### T5 — Contrôle sur la seule partie observée (AZURIAN : Tisseuse #123 + Fleur de Vie #222 dans le même deck)\n');
out.push('| Proxy | P(#123 dans le deck) | P(#222) | P(les deux) |');out.push('|---|---|---|---|');
for(const k of ['P1_T_top1000','P1_N_top1000','P3_all_120','P3_nt_120','P3_cat_120','P3_cat_121','P2_U_random','P2_V_random','B_U_greedy','B_V_greedy','C_U_T','C_U_N','C_V_T','C_V_N','D_U_N','D_V_N']){const o=R.observation[k];if(!o)continue;out.push(`| ${k} | ${p1(o.p123)} % | ${p1(o.p222)} % | ${o.pBoth==null?'–':(100*o.pBoth).toFixed(3)+' %'} |`);}
out.push('');
// 5b. per-session exposure
out.push('### T7 — Sur une série de N parties : P(croiser au moins une fois la mécanique), mélange [casual ; wiki-only], indépendance supposée entre parties\n');
out.push('| Mécanique | 1 partie | 5 parties | 10 parties | 20 parties |');out.push('|---|---|---|---|---|');
for(const k of ['freezeAny','vanishAny','tauntAny','tauntPermanent','immunity','smokeAny','reflect','breakTaunt','resetEnemyCd','absorbAny','setHpPct','anyHard']){const r=R.sessionExposure[k];const lab=R.mechanics.find(m=>m.key===k).label.trim();out.push(`| ${lab} | `+[1,5,10,20].map(N=>`${p1(r[N].mix)} [${p1(r[N].casual)} ; ${p1(r[N].wikiOnly)}]`).join(' | ')+' |');}
out.push('');
// 6. proxies legend
out.push('### T6 — Légende des proxies\n');out.push('| Code | Définition | Nb decks |');out.push('|---|---|---|');
for(const [k,v] of Object.entries(R.proxies))out.push(`| ${k} | ${v.desc} | ${v.nDecks} |`);
fs.writeFileSync(W+'/tables.md',out.join('\n'));console.log('tables.md',out.length,'lines');
