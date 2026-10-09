// Build C_actives.json + the per-family tables fragment (C_work/tables.md) from catalog_raw.json
const fs = require('fs');
const SP = process.argv[2];
const W = SP + '/spam/audit/C_work';
const OUT = SP + '/spam/audit';
const E = require(W + '/catalog_raw.json');

const RULES = [
  // [family, regex on mechanic, key, label]
  ['a', /^absorbAny/, 'a1', 'absorbAny — « Absorbe une carte » (n’importe quelle carte, adverse comprise)'],
  ['a', /^setHpPct/, 'a2', 'setHpPct — « La cible se retrouve à X % de ses PV max » (Corne 25 / Corne 75)'],
  ['a', /^vanish —/, 'a3', 'vanish actif — « Applique Disparition » (retire le dernier passif)'],
  ['a', /^vanishOnHit/, 'a4', 'Disparition à chaque coup (passif légendaire de départ)'],
  ['a', /^hit \d+ % des PV max/, 'a5', 'dégâts en % des PV max de la cible (anti-tank)'],
  ['a', /^Bombe-8/, 'a6', 'Bombe-8 (talent) — passif Bomba au tour 8'],
  ['a', /^absorbAlly/, 'a7', 'absorbAlly — « Absorbe une carte alliée » (ne peut PAS nous viser)'],
  ['b', /^freeze —/, 'b1', 'Gel actif (la cible ne peut pas agir jusqu’à la fin du prochain tour adverse)'],
  ['b', /^freezeOnHit/, 'b2', 'Gel à chaque dégât/soin (passif épique de départ)'],
  ['b', /^eternity —/, 'b3', 'Éternité active (toutes les recharges de la cible +1)'],
  ['b', /^eternityOnHit/, 'b4', 'Éternité à chaque coup (passif légendaire de départ)'],
  ['b', /^(Longueur|Heure Funeste)/, 'b5', 'Éternité par talent (Longueur au 1er tour, Heure Funeste à la mort)'],
  ['b', /^resetEnemyCd/, 'b6', 'reset des recharges de la cible au maximum'],
  ['b', /^(enemyPrec|Imprécision|Erreur Croissante)/, 'b7', 'baisse de précision adverse'],
  ['b', /^(smoke|Fumée)/, 'b8', 'Fumée (effet non documenté)'],
  ['c', /^taunt —/, 'c1', 'Provocation active'],
  ['c', /^(tauntOnAttack|Focus)/, 'c2', 'Provocation passive (Provocation R) / talent Focus (25 %/tour)'],
  ['c', /^Brut/, 'c3', 'Brut — ignore NOS provocations et NOS résistances'],
  ['c', /^Immunit/, 'c4', 'Immunité (insensible à tous les effets adverses)'],
  ['c', /^breakTaunt/, 'c5', 'brise une Provocation (camp non encodé)'],
  ['c', /^(Éternisé|Inscrit)/, 'c6', 'insensibilités par talent (Éternisé, Inscrit)'],
  ['d', /^resetEnemySpamton/, 'd1', 'Spamtons de l’adversaire ramenés à 0'],
  ['d', /^vol de bonus/, 'd2', 'vol de bonus élémentaire'],
  ['d', /^(Racket|Dette)/, 'd3', 'Racket / Dette (talents)'],
  ['d', /^Mimétisme/, 'd4', 'Mimétisme — copie nos générations d’éléments'],
  ['e', /^res ennemie/, 'e1', 'baisse de résistance adverse (active)'],
  ['e', /^(Affaiblissement|Corrosion)/, 'e2', 'érosion progressive de nos résistances (talents)'],
  ['e', /^(Érosion|Erosion)/, 'e3', 'Érosion — nos PV max baissent avec les dégâts subis'],
  ['e', /^Paradoxe/, 'e4', 'Paradoxe — ses propres résistances inversées'],
  ['e', /^(changeElement|hit élément)/, 'e5', 'élément aléatoire / changeant'],
  ['f', /^(soin|attaque \+ soin)/, 'f1', 'soins actifs'],
  ['f', /^(vampirism|Vampirisme)/, 'f2', 'vol de vie (Vampirisme)'],
  ['f', /^Soin primitif/, 'f3', 'régénération passive (Soin primitif)'],
  ['f', /^(hpMax|Cœur vital|Baleine bleue|Cavalerie|Vitalité des Âmes|Life-8|Imprudent)/, 'f4', 'croissance / bonus de PV max'],
  ['f', /^(resurrect|Phénix|Nouvelle vie|Plume de Phénix|Transition)/, 'f5', 'retour à la vie (Résurrection, Phénix, Transition)'],
  ['f', /^(Ténacité|Sursaut Vital|Revitalisation|Chance Vitale|Reset ultime)/, 'f6', 'survie conditionnelle / soins totaux'],
  ['f', /^(res alliée|Cœur résistance|Blindage|Durcissement|Résilience|Armure des Âmes|Cœur d’acier)/, 'f7', 'résistances propres (buffs)'],
  ['g', /^(crit \+|Critique —|Boule de Crit|Incisif)/, 'g1', 'buffs de critique'],
  ['g', /^(critMult|Frappe)/, 'g2', 'dégâts critiques +1 (critMult)'],
  ['g', /^critique lourd/, 'g3', 'attaques à critique lourd (×4 à ×6, ≥25 % de base)'],
  ['g', /^(Berserk|Multiplicateur)/, 'g4', 'Berserk / Multiplicateur'],
  ['g', /^(temporality|Temporalité|Dernier souffle|Réducteur)/, 'g5', 'Temporalité (recharges -1)'],
  ['g', /^(écho|Roulette)/, 'g6', 'Écho (chance de relancer)'],
  ['g', /^(base \+|One man army)/, 'g7', 'dégâts/soins de base croissants'],
  ['g', /^(Reset —|Vengeur|Cimetière|Revanche|Contre)/, 'g8', 'cascades sur kill / à la mort / riposte'],
  ['g', /^(hit \+|gros coup|usage limité)/, 'g9', 'gros coups (≥100 de base, % PV manquants, usage limité)'],
  ['g', /^prec \+/, 'g10', 'buffs de précision'],
  ['g', /^(génération|Terrain|Départ multi|Cœur|Coeur|Multicolore|Souffle-8|AOE)/, 'g11', 'rampe élémentaire (génération, Cœurs, Terrains, AoE talents)'],
  ['h', /^(dégâts|aoe2)/, 'h1', 'schémas de ciblage des dégâts (zone, aléatoire, réparti, champ entier)'],
  ['h', /^Poison/, 'h2', 'Poison (dégâts sur la durée)'],
  ['h', /^(Renvoi|Sac de frappe|Contrecoup)/, 'h3', 'punis / nourris par nos attaques (Renvoi, Sac de frappe) ; Contrecoup'],
  ['h', /^(Anticipation|Virage 360|Évolution|Mystère|Inversement)/, 'h4', 'aléatoire & transformations (Anticipation, Métamorphe, Évolution, Mystère, Inversement)'],
  ['h', /^(13e mois|Fortune|Héritage|Petit prix|Pièce magique|Revalorisation|Tox chanceux|À la caisse|Nouveau riche|spamtonGen)/, 'h5', 'économie / chance propres'],
  ['h', /^AoE \(passif\)/, 'h7', 'AoE (passif de départ) — éclaboussure sur les cibles adjacentes'],
  ['h', /^autre/, 'h6', 'options de choix réduites à une attaque simple (et Materia, voir mismatch M13)'],
];
function canon(e) {
  for (const [f, re, k, lab] of RULES) if (f === e.family && re.test(e.mechanic)) return { key: k, label: lab };
  return { key: e.family + '?', label: e.mechanic };
}
const FAMLAB = {
  a: '(a) Retire / absorbe / fait disparaître une de nos cartes ou ses passifs (incl. exécutions)',
  b: '(b) Nie nos actions (Gel, Éternité, reset de recharge, précision, Fumée)',
  c: '(c) Force ou bloque notre ciblage (Provocation, Brut, Immunité)',
  d: '(d) Déni d’économie (Spamtons, bonus élémentaires)',
  e: '(e) Manipulation de résistances / d’élément / de PV max',
  f: '(f) Survie adverse (soins, vol de vie, régén, PV max, résurrection, résistances)',
  g: '(g) Burst / montée en puissance (critique, multiplicateurs, Temporalité, Écho, nukes)',
  h: '(h) Autres (schémas de ciblage, Poison, Renvoi, transformations, économie propre)',
};
const groups = new Map();
for (const e of E) {
  const c = canon(e);
  const k = c.key;
  if (!groups.has(k)) groups.set(k, { family: e.family, familyLabel: FAMLAB[e.family], key: k, mechanic: c.label, cards: [] });
  const ready = (e.kind === 'active' && e.cd) ? { ifOppFirst: Math.max(1, e.cd), ifOppSecond: Math.max(1, e.cd - 1) } : null;
  groups.get(k).cards.push({
    number: e.number, name: e.name, element: e.element, rarity: e.rarity, spamton: e.spamton, hp: e.hp,
    kind: e.kind, ability: e.ability, detail: e.mechanic, cd: e.cd, firstReadyTurn: ready, target: e.target, duration: e.duration, effectDuration: (Array.isArray(e.effects) ? (e.effects.map(x => x && x.duration).filter(Boolean)[0] || null) : null),
    uses: e.uses || 0, echo: e.echo || 0, cost: e.cost || null, costHp: e.costHp || 0, choice: !!e.choice,
    hits: e.hits || '', heals: e.heals || '', gen: e.gen || '', effects: e.effects || (e.params ? [e.params] : []),
    text: e.text, owned: e.owned, v121: e.v121 || null,
  });
}
const order = k => { const f = k[0]; const n = parseInt(k.slice(1)) || 99; return f.charCodeAt(0) * 100 + n; };
const arr = [...groups.values()].sort((x, y) => order(x.key) - order(y.key));
// dedupe identical rows (same card, ability, kind) within a group
for (const g of arr) { const seen = new Set(); g.cards = g.cards.filter(c => { const k = c.number + '|' + c.ability + '|' + c.kind + '|' + c.detail; if (seen.has(k)) return false; seen.add(k); return true; }); g.cards.sort((a, b) => ({ active: 0, passive: 1, talent: 2 }[a.kind] - { active: 0, passive: 1, talent: 2 }[b.kind]) || a.number - b.number); g.distinctCards = new Set(g.cards.map(c => c.number)).size; const r = {}; for (const n of new Set(g.cards.map(c => c.number + ':' + c.rarity))) { const rr = n.split(':')[1]; r[rr] = (r[rr] || 0) + 1; } g.byRarity = r; g.byKind = { active: new Set(g.cards.filter(c => c.kind === 'active').map(c => c.number)).size, passive: new Set(g.cards.filter(c => c.kind === 'passive').map(c => c.number)).size, talent: new Set(g.cards.filter(c => c.kind === 'talent').map(c => c.number)).size }; }

const jsonOut = arr.map(g => ({ family: g.familyLabel, familyKey: g.family, key: g.key, mechanic: g.mechanic, distinctCards: g.distinctCards, byKind: g.byKind, byRarity: g.byRarity, cards: g.cards }));
fs.writeFileSync(OUT + '/C_actives.json', JSON.stringify(jsonOut, null, 1));

// ---------- markdown tables ----------
const RAR = { common: 'C', rare: 'R', epic: 'É', legendary: 'L', divine: 'D' };
const EL = { fire: 'Feu', water: 'Eau', earth: 'Terre', nature: 'Nature', light: 'Lumière', shadow: 'Ombre', divine: 'Divin' };
const esc = s => String(s == null ? '' : s).replace(/\|/g, '/').replace(/\n/g, ' ');
const KIND = { active: 'ACT', passive: 'PAS', talent: 'TAL' };
let md = '';
let curFam = null;
for (const g of arr) {
  if (g.family !== curFam) { curFam = g.family; md += `\n### ${FAMLAB[curFam]}\n`; }
  const rr = Object.entries(g.byRarity).map(([k, v]) => `${v} ${k}`).join(', ');
  md += `\n#### ${g.key} — ${g.mechanic}\n_${g.distinctCards} carte(s) distincte(s) : ${g.byKind.active} via compétence active, ${g.byKind.passive} via passif de départ, ${g.byKind.talent} via talent — rareté : ${rr}._\n\n`;
  const full = 'abcde'.includes(g.family) || ['g5', 'g9', 'f5'].includes(g.key);
  if (full) {
    md += '| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
    for (const c of g.cards) md += `| ${c.number} | ${esc(c.name)} | ${EL[c.element] || c.element}/${RAR[c.rarity] || c.rarity} | ${c.spamton} | ${c.hp} | ${KIND[c.kind]} | ${esc(c.ability)}${c.uses ? ' (usage ' + c.uses + ')' : ''}${c.echo ? ' (écho ' + Math.round(c.echo * 100) + '%)' : ''}${c.cost ? ' (coût ' + esc(JSON.stringify(c.cost)) + ')' : ''}${c.costHp ? ' (coût ' + c.costHp + ' PV)' : ''} | ${c.cd ?? '—'} | ${c.firstReadyTurn ? 'T' + c.firstReadyTurn.ifOppFirst + '/T' + c.firstReadyTurn.ifOppSecond : '—'} | ${c.target ?? '—'} | ${c.kind === 'active' ? ((c.duration || 0) + '/' + ((c.effects || []).map(e => e && e.duration).filter(Boolean).join('+') || '—')) : '—'} | ${esc(c.text)} | ${c.owned ? '**oui**' : 'non'} | ${esc(c.v121 || '')} |\n`;
  } else {
    const byAb = new Map();
    for (const c of g.cards) {
      const k = c.kind + '|' + c.ability.replace(/^TAL\d /, '').replace(/ \(option.*\)$/, '') + '|' + (c.kind === 'active' ? c.cd + '|' + c.text : '');
      if (!byAb.has(k)) byAb.set(k, { c, list: [] });
      byAb.get(k).list.push(c);
    }
    const lines = [];
    for (const { c, list } of byAb.values()) {
      const who = [...new Map(list.map(x => [x.number, x])).values()].map(x => `#${x.number} ${x.name} (${RAR[x.rarity] || x.rarity}, ${x.hp} PV${x.owned ? ', **possédée**' : ''})`).join(', ');
      const v = list.find(x => x.v121);
      lines.push(`- **${KIND[c.kind]} ${esc(c.ability.replace(/^TAL\d /, ''))}**${c.kind === 'active' ? ' [CD ' + c.cd + ', cible ' + c.target + ']' : ''} — « ${esc(c.text)} » — ${who}${v ? ' — 1.21 : ' + esc(v.v121) : ''}`);
    }
    md += lines.join('\n') + '\n';
  }
}
fs.writeFileSync(W + '/tables.md', md);
// summary counts per family
const fam = {};
for (const g of arr) { fam[g.family] = fam[g.family] || { groups: 0, cards: new Set(), act: new Set(), pas: new Set(), tal: new Set(), rar: {} }; const F = fam[g.family]; F.groups++; for (const c of g.cards) { F.cards.add(c.number); (c.kind === 'active' ? F.act : c.kind === 'passive' ? F.pas : F.tal).add(c.number); } }
for (const [k, F] of Object.entries(fam)) console.log(k, 'mechanics', F.groups, 'distinct cards', F.cards.size, 'act', F.act.size, 'pas', F.pas.size, 'tal', F.tal.size);
for (const g of arr) console.log(g.key, g.distinctCards, JSON.stringify(g.byKind), JSON.stringify(g.byRarity), g.mechanic);
