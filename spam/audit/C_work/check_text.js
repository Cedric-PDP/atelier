// Text vs structured-data cross-check (v1.20 model FR texts + EN v1.20 page texts + v1.21 live model)
const fs = require('fs');
const SP = process.argv[2];
const W = SP + '/spam/audit/C_work';
const m = require(SP + '/spam/js/model.json');
const m21 = require(W + '/model_v121.json');
const pages = require(W + '/pages_en_parsed.json');
const c21 = Object.fromEntries(m21.cards.map(c => [c.number, c]));
const flags = [];
const F = (c, where, kind, msg) => flags.push({ number: c.number, name: c.name, where, kind, msg });

const numsIn = t => (t.match(/-?\d+(?:[.,]\d+)?/g) || []).map(x => Math.abs(parseFloat(x.replace(',', '.'))));
const KW = [
  [/Gel\b/i, o => o.effects.some(e => e.type === 'freeze'), 'Gel'],
  [/Provocation/i, o => o.effects.some(e => e.type === 'taunt' || e.type === 'breakTaunt'), 'Provocation'],
  [/Éternité/i, o => o.effects.some(e => e.type === 'eternity'), 'Éternité'],
  [/Temporalité/i, o => o.effects.some(e => e.type === 'temporality'), 'Temporalité'],
  [/Disparition/i, o => o.effects.some(e => e.type === 'vanish'), 'Disparition'],
  [/Absorbe/i, o => o.effects.some(e => /absorb/.test(e.type)), 'Absorbe'],
  [/Fumée/i, o => o.effects.some(e => e.type === 'smoke'), 'Fumée'],
  [/Vampirisme/i, o => o.effects.some(e => e.type === 'vampirism'), 'Vampirisme'],
  [/Ressuscite/i, o => o.effects.some(e => e.type === 'resurrect'), 'Ressuscite'],
  [/Dégâts critiques/i, o => o.effects.some(e => e.type === 'critMult'), 'Dégâts critiques'],
  [/Précision \(-/i, o => o.effects.some(e => e.type === 'enemyPrec'), 'Précision (-)'],
  [/Précision \(\+|Précision et Critique/i, o => o.effects.some(e => e.type === 'prec'), 'Précision (+)'],
  [/Critique (du lanceur|\(\+|de toutes|et|aléatoirement)|Précision et Critique|Critique \(\+/i, o => o.effects.some(e => e.type === 'crit'), 'Critique (+)'],
  [/Résistance|résistance/i, o => o.effects.some(e => e.type === 'res'), 'Résistance'],
  [/PV max/i, o => o.effects.some(e => ['hpMax','setHpPct'].includes(e.type)) || o.hits.some(h => h.pctMaxHp) || o.heals.some(h => h.pctOwnHp) || o.effects.some(e=>e.type==='resurrect'), 'PV max'],
  [/Spamton/i, o => o.effects.some(e => /spamton/i.test(e.type)), 'Spamton'],
  [/Vole /i, o => o.gen.some(g => g.steal) || o.effects.some(e => e.type === 'hpMax' && e.value < 0), 'Vole'],
  [/Brise une Provocation/i, o => o.effects.some(e => e.type === 'breakTaunt'), 'Brise Provocation'],
  [/élément de votre carte/i, o => o.effects.some(e => e.type === 'changeElement'), 'Change élément'],
  [/\bAoE\b/, o => o.effects.some(e => e.type === 'aoe2'), 'AoE'],
  [/Bonus/i, o => o.gen.length > 0, 'Bonus (génération)'],
  [/Soigne|soigne/i, o => o.heals.length > 0, 'Soin'],
  [/Attaque/i, o => o.hits.length > 0, 'Attaque'],
  [/valeur de base|dégâts de base|valeurs de base/i, o => o.effects.some(e => e.type === 'base') || o.gen.some(g => g.growth), 'Base'],
];
const EFF_KW = { freeze: /Gel/i, taunt: /Provocation/i, eternity: /Éternité/i, temporality: /Temporalité/i, vanish: /Disparition/i, absorbAny: /Absorbe/i, absorbAlly: /Absorbe/i, smoke: /Fumée/i, vampirism: /Vampirisme/i, resurrect: /Ressuscite/i, critMult: /critiques/i, enemyPrec: /Précision/i, prec: /Précision/i, crit: /Critique/i, res: /[Rr]ésistance/i, hpMax: /PV max/i, setHpPct: /PV max/i, resetEnemySpamton: /Spamton/i, spamtonGen: /Spamton/i, resetEnemyCd: /recharge/i, breakTaunt: /Provocation/i, changeElement: /élément/i, aoe2: /AoE/i, base: /base/i };

for (const c of m.cards) {
  const slug = c.slug; const pg = pages[slug];
  c.abilities.forEach((a, ai) => {
    const where = `${a.name}`;
    // ability-level structural checks
    for (const [oi, o] of a.options.entries()) {
      const t = o.text; const w = where + (a.options.length > 1 ? ` opt${oi + 1}` : '');
      // numbers
      const S = new Set();
      const addN = v => { if (v === undefined || v === null || isNaN(v)) return; S.add(Math.abs(+v)); S.add(Math.abs(+v) * 100); S.add(Math.round(Math.abs(+v) * 100) / 100); };
      o.hits.forEach(h => { addN(h.min); addN(h.max); addN(h.missingPct); }); addN(o.hits.length);
      o.heals.forEach(h => { addN(h.min); addN(h.max); }); addN(o.heals.length);
      o.gen.forEach(g => { addN(g.min); addN(g.max); addN(g.growth); });
      o.effects.forEach(e => { addN(e.value); addN(e.duration); addN(e.pct); });
      [a.cd, a.duration, a.uses, a.echo, a.costHp, a.crit, a.prec].forEach(addN);
      if (a.cost) Object.values(a.cost).forEach(addN);
      const tn = numsIn(t.replace(/\[Usage Limité 1\/1\]/, '').replace(/X(\d+)/, (x, n) => ' ' + n + ' '));
      const missing = tn.filter(n => !S.has(n));
      if (missing.length) F(c, w, 'nombre', `texte « ${t} » contient ${missing.join(', ')} absent(s) des champs structurés`);
      // keywords in text but no structured counterpart
      for (const [re, has, lab] of KW) if (re.test(t) && !has(o)) {
        if (lab === 'Bonus (génération)' && /Bonus/.test(t) && o.gen.length === 0) F(c, w, 'effet manquant', `texte « ${t} » annonce un Bonus mais gen=[]`);
        else if (lab !== 'Bonus (génération)') F(c, w, 'effet manquant', `texte « ${t} » mentionne « ${lab} » sans champ structuré correspondant`);
      }
      // structured effects absent from text
      for (const e of o.effects) { const re = EFF_KW[e.type]; if (re && !re.test(t)) F(c, w, 'effet non décrit', `effet ${JSON.stringify(e)} absent du texte « ${t} »`); }
      // aléatoire
      if (/aléatoire/i.test(t)) {
        const rnd = /random|spread/.test(o.target) || o.hits.some(h => h.element === 'random') || o.gen.some(g => g.element === 'random') || o.effects.some(e => /random/.test(e.scope || '') || e.type === 'changeElement');
        if (!rnd) F(c, w, 'aléatoire', `texte « ${t} » dit « aléatoire » mais aucun champ aléatoire (cible ${o.target}, effets ${JSON.stringify(o.effects)})`);
      }
      // conditionals
      if (/en cas de (coup )?critique/i.test(t)) { const cond = o.effects.some(e => e.cond) || o.gen.some(g => g.cond); if (!cond) F(c, w, 'condition', `texte conditionnel « ${t} » sans cond:true`); }
      for (const e of o.effects) if (e.cond && !/en cas de|critique/i.test(t)) F(c, w, 'condition', `effet cond:true ${JSON.stringify(e)} sans condition dans le texte`);
      // durations
      const dm = t.match(/pendant (\d+) tours?/i);
      if (dm) { const d = +dm[1]; const eff = o.effects.find(e => e.duration); if (!eff || eff.duration !== d || (a.duration && a.duration !== d)) F(c, w, 'durée', `texte « ${t} » (durée ${d}) vs ability.duration=${a.duration}, effet.duration=${eff ? eff.duration : '-'}`); }
      for (const e of o.effects) if (e.duration && a.duration !== e.duration) F(c, w, 'durée', `ability.duration=${a.duration} ≠ effet ${e.type}.duration=${e.duration} (texte « ${t} »)`);
      if (a.duration && !o.effects.some(e => e.duration)) F(c, w, 'durée', `ability.duration=${a.duration} mais aucun effet n'a de durée (effets ${JSON.stringify(o.effects.map(e => e.type))}) — durée de quoi ? (texte « ${t} »)`);
      // echo / uses / cost text
      const em = t.match(/Echo \((\d+)%\)/i); if (em && Math.round(a.echo * 100) !== +em[1]) F(c, w, 'écho', `texte écho ${em[1]} % vs ability.echo=${a.echo}`); if (!em && a.echo > 0) F(c, w, 'écho', `ability.echo=${a.echo} non mentionné dans « ${t} »`);
      if (/Usage Limité/i.test(t) !== (a.uses > 0)) F(c, w, 'usages', `uses=${a.uses} vs texte « ${t} »`);
      if (/\[Coût/i.test(t) !== !!(a.cost || a.costHp)) F(c, w, 'coût', `cost=${JSON.stringify(a.cost)} costHp=${a.costHp} vs texte « ${t} »`);
      // multiplicity
      const xm = t.match(/X(\d+)/); if (xm) { const n = +xm[1]; if (n !== o.hits.length && n !== o.heals.length) F(c, w, 'multiplicité', `texte X${n} vs ${o.hits.length} hits / ${o.heals.length} soins`); }
      // targets
      if (o.target === 'none' && o.effects.some(e => ['eternity', 'freeze', 'setHpPct', 'absorbAny', 'absorbAlly', 'vanish', 'resetEnemyCd', 'breakTaunt'].includes(e.type))) F(c, w, 'cible', `cible « none » pour un effet ciblé ${JSON.stringify(o.effects.map(e => e.type))} (texte « ${t} ») : qui est visé n'est pas encodé`);
      if (['allAllies'].includes(o.target) && o.hits.length) F(c, w, 'cible', `cible allAllies avec des dégâts (${o.hits.length} hits) : le coup vise-t-il un ennemi ? (texte « ${t} »)`);
      if (o.target === 'self' && o.effects.some(e => e.scope === 'card') === false && o.effects.length && !o.heals.length) {/* ok */}
      if (o.effects.some(e => e.type === 'freeze' && e.target === 'ally')) F(c, w, 'cible', `Gel sur un ALLIÉ (cible ${o.target}) — le lanceur gèle la carte qu'il soigne ? (texte « ${t} »)`);
      if (o.effects.some(e => e.type === 'taunt' && e.scope === 'ally') && o.target === 'allAllies') F(c, w, 'cible', `Provocation portée « ally » mais cible « allAllies » : un allié ou toute l'équipe ? (texte « ${t} »)`);
    }
    // EN page comparison
    if (pg && pg.abilities[ai]) {
      const p = pg.abilities[ai];
      if (p.cd !== a.cd) F(c, where, 'page EN', `CD page EN ${p.cd} vs modèle ${a.cd}`);
      if (p.prec !== undefined && p.prec !== a.prec) F(c, where, 'page EN', `Précision page EN ${p.prec} vs modèle ${a.prec}`);
      if (p.crit !== undefined && p.crit !== a.crit) F(c, where, 'page EN', `Critique page EN ${p.crit} vs modèle ${a.crit}`);
      const fr = numsIn(a.text.replace(/\[Usage Limité 1\/1\]/, '')).sort((x, y) => x - y).join(',');
      const en = numsIn(p.text.replace(/\[Limited Use 1\/1\]/i, '').replace(/Limited use 1\/1/i, '')).sort((x, y) => x - y).join(',');
      if (fr !== en) F(c, where, 'page EN', `nombres FR [${fr}] ≠ EN [${en}] — FR « ${a.text.replace(/\n/g, ' | ')} » / EN « ${p.text} »`);
    } else if (pg) F(c, where, 'page EN', `compétence absente de la page EN (page: ${pg.abilities.map(x => x.name).join(', ')})`);
  });
  // passives: v1.21 text changes that alter meaning
  const n = c21[c.number];
  c.passives.forEach(p => { const q = n.passives.find(x => x.id === p.id); if (q && q.text.replace(/[\s  ]/g, '') !== p.text.replace(/[\s  ]/g, '')) F(c, 'PAS ' + p.name, 'texte 1.21', `« ${p.text} » → « ${q.text} » (champs: ${JSON.stringify(Object.fromEntries(Object.entries(q).filter(([k]) => !['id','name','rarity','text'].includes(k))))})`); });
  // talents: params not in text
  c.talents.forEach(t => {
    const tn = new Set(numsIn(t.text));
    for (const [k, v] of Object.entries(t)) { if (['slot', 'name', 'text', 'id', 'kind', 'passive', 'passiveObj', 'alt', 'scope', 'elements', 'element'].includes(k)) continue; const nv = Math.abs(typeof v === 'number' ? v : NaN); if (!isNaN(nv) && !tn.has(nv) && !tn.has(Math.round(nv * 100))) F(c, 'TAL ' + t.name, 'talent', `paramètre ${k}=${v} absent du texte « ${t.text} »`); }
    if (t.passiveObj && t.passiveObj.text && !/Cœur|Coeur/.test(t.name)) F(c, 'TAL ' + t.name, 'talent', `passif donné « ${t.passiveObj.name} » (${t.passiveObj.rarity}) — texte interne « ${t.passiveObj.text} » vs texte affiché « ${t.text} »${t.alt ? ' ; alternative ' + t.alt : ''}`);
  });
  // EN page talents count / text numbers
  if (pg) pg.talents.forEach((pt, i) => { const t = c.talents[i]; if (!t) return; const a1 = numsIn(t.text).sort().join(','), b1 = numsIn(pt.text).sort().join(','); if (a1 !== b1) F(c, 'TAL ' + t.name, 'page EN', `nombres FR [${a1}] ≠ EN [${b1}] — « ${t.text} » / « ${pt.text} »`); });
}
fs.writeFileSync(W + '/mismatch_auto.json', JSON.stringify(flags, null, 1));
const by = {}; for (const f of flags) by[f.kind] = (by[f.kind] || 0) + 1;
console.log(flags.length, by);
for (const f of flags) console.log(`#${f.number} ${f.name} | ${f.where} | ${f.kind} | ${f.msg}`);
