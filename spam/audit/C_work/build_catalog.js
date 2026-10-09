// Agent C — catalog of ACTIVE abilities + TALENTS (+ innate passives as context) seen from the victim side.
// Usage: node build_catalog.js <SP>
const fs = require('fs');
const SP = process.argv[2];
const W = SP + '/spam/audit/C_work';
const m = require(SP + '/spam/js/model.json');
const m21 = require(W + '/model_v121.json');
const pages = require(W + '/pages_en_parsed.json');
const OWNED = new Set([1,2,3,4,5,6,12,27,30,33,69,82,102,103,116,117,153,156,158,160,180,227,238,243,251,259]);
const c21 = Object.fromEntries(m21.cards.map(c => [c.number, c]));

const FAM = {
  a: '(a) retire / absorbe / fait disparaître une de nos cartes (ou son passif)',
  b: '(b) nie nos actions (gel, éternité, reset CD, précision, fumée)',
  c: '(c) force ou bloque notre ciblage (provocation, immunité, brut)',
  d: "(d) déni d'économie (Spamtons, bonus élémentaires)",
  e: '(e) manipulation résistances / élément / PV max',
  f: '(f) survie adverse (soins, régén, résurrection, PV max, vol de vie)',
  g: '(g) burst / montée en puissance (critique, multiplicateurs, temporalité, écho)',
  h: '(h) autres (ciblage aléatoire/zone, champ entier, économie propre, métamorphe...)',
};

const entries = [];
function base(c) {
  return { number: c.number, name: c.name, element: c.element, rarity: c.rarity, spamton: c.spamton, hp: c.hp, owned: OWNED.has(c.number) };
}
function v121note(c, abName) {
  const n = c21[c.number]; const notes = [];
  if (!n) return null;
  if (n.hp !== c.hp) notes.push(`PV ${c.hp}→${n.hp}`);
  if (n.spamton !== c.spamton) notes.push(`Spamtons/tour ${c.spamton}→${n.spamton}`);
  if (abName) {
    const a0 = c.abilities.find(a => a.name === abName); const a1 = n.abilities.find(a => a.id === (a0 && a0.id));
    if (a0 && !a1) { const rep = n.abilities.find(a => !c.abilities.some(b => b.id === a.id)); notes.push(`compétence remplacée par « ${rep ? rep.name : '?'} »${rep ? ' : ' + rep.options.map(o => o.text).join(' / ') + ' (CD ' + rep.cd + ')' : ''}`); }
    else if (a0 && a1 && JSON.stringify(a0) !== JSON.stringify(a1)) {
      for (const k of ['cd','crit','prec','critMult','duration','uses','echo','costHp']) if (a0[k] !== a1[k]) notes.push(`${k} ${a0[k]}→${a1[k]}`);
      if (JSON.stringify(a0.cost) !== JSON.stringify(a1.cost)) notes.push(`coût ${JSON.stringify(a0.cost)}→${JSON.stringify(a1.cost)}`);
      a0.options.forEach((o, i) => { const p = a1.options[i]; if (p && o.text.replace(/\s/g,'') !== p.text.replace(/\s/g,'')) notes.push(`texte → « ${p.text} »`); else if (p && (JSON.stringify(o.effects)!==JSON.stringify(p.effects)||o.target!==p.target||JSON.stringify(o.hits)!==JSON.stringify(p.hits)||JSON.stringify(o.gen)!==JSON.stringify(p.gen))) notes.push(`données modifiées (cible ${o.target}→${p.target}, effets ${JSON.stringify(o.effects)}→${JSON.stringify(p.effects)}, gen ${JSON.stringify(o.gen)}→${JSON.stringify(p.gen)})`); });
    }
  }
  return notes.length ? notes.join(' ; ') : null;
}
function add(fam, mech, kind, c, extra) {
  entries.push(Object.assign({ family: fam, familyLabel: FAM[fam], mechanic: mech, kind }, base(c), extra));
}

// ---------- ACTIVE abilities ----------
let qualifying = 0, totalAb = 0;
for (const c of m.cards) {
  for (const a of c.abilities) {
    totalAb++;
    a.options.forEach((o, oi) => {
      const plain = !(a.echo>0||a.uses>0||a.cost||a.costHp||a.choice) && o.target === 'enemy' && o.effects.length === 0 && o.hits.every(h => !h.pctMaxHp && !h.missingPct && !['random','self',null].includes(h.element)) && o.heals.length === 0 && o.gen.every(g => !g.steal);
      const ext = {
        ability: a.name + (a.options.length > 1 ? ` (option ${oi + 1}/${a.options.length})` : ''),
        cd: a.cd, target: o.target, duration: a.duration, uses: a.uses, echo: a.echo, cost: a.cost, costHp: a.costHp,
        choice: a.choice, prec: a.prec, crit: a.crit, critMult: a.critMult,
        effects: o.effects, hits: o.hits.length ? o.hits.map(h => `${h.min === h.max ? h.min : h.min + '-' + h.max}${h.pctMaxHp ? '%PVmax' : ''}${h.missingPct ? '+' + h.missingPct + '%PVmanquants' : ''} ${h.element}`).join(', ') : '',
        heals: o.heals.length ? o.heals.map(h => `${h.full ? 'total' : (h.pctOwnHp ? h.min + '%PVmax' : (h.min === h.max ? h.min : h.min + '-' + h.max))}${h.flat ? '(fixe)' : ''} ${h.element || ''}→${h.target}`).join(', ') : '',
        gen: o.gen.length ? o.gen.map(g => `${g.steal ? 'VOL ' : ''}${g.min === g.max ? g.min : g.min + '..' + g.max} ${g.element}${g.cond ? ' (si crit)' : ''}${g.growth ? ' (+' + g.growth + '/usage)' : ''}`).join(', ') : '',
        text: o.text, v121: v121note(c, a.name),
      };
      if (plain) return;
      qualifying++;
      let tagged = false;
      const T = (fam, mech) => { add(fam, mech, 'active', c, ext); tagged = true; };
      for (const e of o.effects) {
        switch (e.type) {
          case 'absorbAny': T('a', 'absorbAny — absorbe une carte (cible libre)'); break;
          case 'absorbAlly': T('a', 'absorbAlly — absorbe une carte ALLIÉE (pas nous)'); break;
          case 'setHpPct': T('a', `setHpPct — met la cible à ${e.value} % de ses PV max`); break;
          case 'vanish': T('a', 'vanish — Disparition (retire le dernier passif)'); break;
          case 'freeze': T('b', `freeze — Gel (cible ${e.target})`); break;
          case 'eternity': T('b', `eternity — Éternité (CD +${e.value})${e.cond ? ' sur critique' : ''}`); break;
          case 'resetEnemyCd': T('b', 'resetEnemyCd — recharges remises au maximum'); break;
          case 'enemyPrec': T('b', `enemyPrec — précision adverse -${e.value} %`); break;
          case 'smoke': T('b', 'smoke — Fumée (effet non documenté)'); break;
          case 'taunt': T('c', `taunt — Provocation (portée ${e.scope}, durée ${e.duration})`); break;
          case 'breakTaunt': T('c', 'breakTaunt — brise une Provocation'); break;
          case 'resetEnemySpamton': T('d', "resetEnemySpamton — Spamtons de l'adversaire à 0"); break;
          case 'res': if (e.scope === 'enemy' || e.value < 0) T('e', `res ennemie ${e.value} % (${[].concat(e.elements).join('/')})`); else T('f', `res alliée +${e.value} (${[].concat(e.elements).join('/')}, portée ${e.scope})`); break;
          case 'changeElement': T('e', "changeElement — change l'élément du lanceur"); break;
          case 'vampirism': T('f', 'vampirism — vol de vie (50 % des dégâts dans le moteur)'); break;
          case 'hpMax': T('f', `hpMax ${e.value > 0 ? '+' : ''}${e.value} (portée ${e.scope})`); break;
          case 'resurrect': T('f', `resurrect — ressuscite le dernier allié détruit à ${e.pct} %`); break;
          case 'critMult': T('g', `critMult +${e.value} (portée ${e.scope})`); break;
          case 'crit': T('g', `crit +${e.value} % (portée ${e.scope})${e.cond ? ' sur critique' : ''}`); break;
          case 'prec': T('g', `prec +${e.value} % (portée ${e.scope})`); break;
          case 'base': T('g', `base +${e.value} (portée ${e.scope})`); break;
          case 'temporality': T('g', `temporality — Temporalité ×${e.value} (portée ${e.scope})${e.cond ? ' sur critique' : ''}`); break;
          case 'spamtonGen': T('h', `spamtonGen +${e.value} (économie propre)`); break;
          case 'aoe2': T('h', 'aoe2 — touche 2 cibles'); break;
          default: T('h', 'effet ' + e.type);
        }
      }
      for (const h of o.hits) {
        if (h.pctMaxHp) T('a', `hit ${h.min} % des PV max de la cible`);
        if (h.missingPct) T('g', `hit +${h.missingPct} % des PV manquants du lanceur`);
        if (h.element === 'random' || h.element === 'self') T('e', `hit élément ${h.element === 'random' ? 'aléatoire' : 'du lanceur'}`);
      }
      for (const g of o.gen) if (g.steal) T('d', `vol de bonus élémentaire (${g.min} ${g.element})`);
      if (o.heals.length && !o.effects.some(e => e.type === 'vampirism')) {
        const full = o.heals.some(h => h.full); const pct = o.heals.some(h => h.pctOwnHp && !h.full);
        T('f', full ? 'soin total (lanceur)' : pct ? 'soin % PV max (lanceur)' : o.heals.every(h => h.self) ? 'soin du lanceur' : (o.target==='enemy'? "attaque + soin d'un allié" : `soin allié (${o.target})`));
      }
      if (o.hits.length && ['aoeEnemy','randomEnemy','spreadEnemy','spreadField'].includes(o.target)) {
        const tot = o.hits.reduce((s, h) => s + (h.min + h.max) / 2, 0);
        T('h', o.target === 'spreadField' ? 'dégâts répartis sur TOUT le terrain (les deux camps)' : o.target === 'aoeEnemy' ? 'dégâts de zone (toutes nos cartes)' : o.target === 'randomEnemy' ? 'dégâts sur 1 cible aléatoire' : 'dégâts répartis aléatoirement');
      }
      if (a.echo > 0) T('g', `écho ${Math.round(a.echo * 100)} %`);
      if (a.uses > 0) T('g', `usage limité (${a.uses}×/partie)`);
      { const tot = o.hits.filter(h=>!h.pctMaxHp).reduce((s2, h) => s2 + (h.min + h.max) / 2, 0); if (tot >= 100) T('g', 'gros coup (≥100 dégâts de base par lancer)'); }
      if (a.critMult >= 4 && a.crit >= 25 && o.hits.length) T('g', `critique lourd (×${a.critMult}, ${a.crit} % de base)`);
      if (o.gen.length && !o.gen.some(g=>g.steal) && !o.hits.length && !o.heals.length && !o.effects.length) T('g', 'génération élémentaire pure (rampe)');
      if (o.target === 'field') {/* covered by critMult field */}
      if (!tagged) T('h', 'autre (gen/none)');
    });
  }
}

// ---------- Innate passives (context, kind=passive) ----------
const PASMAP = {
  vanishOnHit: ['a', 'vanishOnHit — Disparition à chaque coup (retire notre dernier passif)'],
  freezeOnHit: ['b', 'freezeOnHit — Gel à chaque dégât/soin'],
  eternityOnHit: ['b', 'eternityOnHit — Éternité (CD +1) à chaque coup'],
  smoke: ['b', 'Fumée — enfume le terrain allié après attaque/soin (effet non documenté)'],
  tauntOnAttack: ['c', 'tauntOnAttack — chaque attaque force toutes nos attaques du tour suivant sur elle'],
  immunity: ['c', 'Immunité — insensible à tous les effets adverses'],
  brut: ['c', 'Brut — ignore nos résistances et nos provocations, détruit nos provocations si ciblé'],
  mimetism: ['d', 'Mimétisme — copie +1 de chaque élément que nous générons'],
  erosion: ['e', 'Érosion — nos PV max baissent de 50 % des dégâts subis'],
  lifesteal: ['f', 'Vampirisme (passif) — vol de vie'],
  regen: ['f', 'Soin primitif — régén % PV max / tour'],
  phoenix: ['f', 'Phénix — revient une fois à X % PV'],
  tenacity: ['f', 'Ténacité — 1re attaque fatale laisse à 1 PV'],
  hpGrowth: ['f', 'Cœur vital — PV max +15/tour'],
  teamRes: ['f', 'Cœur résistance — résistances de toute l\'équipe'],
  berserk: ['g', 'Berserk — dégâts et soins de toute l\'équipe +X %'],
  multiplicator: ['g', 'Multiplicateur — bonus élémentaires doublés pour cette carte'],
  temporalityOnHit: ['g', 'Temporalité (passif) — CD -1 à chaque coup'],
  reset: ['g', 'Reset — attaque reste disponible après un kill'],
  avenger: ['g', 'Vengeur — récupère toutes ses attaques quand une carte meurt'],
  cimetiere: ['g', 'Cimetière — bonus élémentaires +X à chaque mort'],
  revenge: ['g', 'Revanche — à sa mort, inflige toutes ses attaques'],
  poison: ['h', 'Poison — 1 % PV max/tour pendant 3 tours'],
  reflect: ['h', 'Renvoi — renvoie X % des dégâts subis à l\'attaquant'],
  punchingBag: ['h', 'Sac de frappe — +1 élément à chaque attaque subie (nourri par nos coups)'],
  mystery: ['h', 'Mystère — passif aléatoire au départ'],
  aoe: ['h', 'AoE (passif) — éclaboussure sur cibles adjacentes'],
  recoil: ['h', 'Contrecoup — subit 50 % des dégâts infligés (auto-dégâts)'],
};
for (const c of m.cards) for (const p of c.passives) {
  const mp = PASMAP[p.type]; if (!mp) continue;
  add(mp[0], mp[1], 'passive', c, { ability: 'PAS ' + p.name + ' (' + p.rarity + ')', cd: null, target: null, duration: null, params: Object.fromEntries(Object.entries(p).filter(([k]) => !['id','name','rarity','text','type'].includes(k))), text: p.text, v121: (() => { const n = c21[c.number]; const q = n && n.passives.find(x => x.id === p.id); if (!q) { const r = n && n.passives.filter(x => !c.passives.some(y => y.id === x.id)).map(x => x.name + ' ' + x.rarity).join(','); return 'passif remplacé en 1.21 par ' + r; } return q.text.replace(/\s/g,'') !== p.text.replace(/\s/g,'') ? 'texte 1.21 : « ' + q.text + ' »' : null; })() });
}

// ---------- Talents ----------
const TALMAP = t => {
  switch (t.kind) {
    case 'passiveAt8': return t.passive === 'Bomba_E' ? ['a', 'Bombe-8 — passif Bomba au tour 8 (500 dégâts bruts à une carte adverse aléatoire à sa mort)'] : ['c', 'Immunité-8 — passif Immunité au tour 8'];
    case 'eternityStart': return ['b', 'Longueur — Éternité sur une de nos cartes au hasard au 1er tour'];
    case 'eternityAllOnDeath': return ['b', 'Heure Funeste — Éternité sur TOUTES nos cartes à sa mort'];
    case 'enemyPrec': return ['b', 'Imprécision — -20 % précision sur une de nos cartes au hasard'];
    case 'enemyPrecOnAttack': return ['b', 'Erreur Croissante — -3 % précision à une de nos cartes à chaque attaque'];
    case 'focus': return ['c', 'Focus — 25 %/tour de gagner Provocation'];
    case 'immuneEternity': return ['c', 'Éternisé — insensible aux Éternités'];
    case 'immuneVanish': return ['c', 'Inscrit — insensible aux Disparitions'];
    case 'racket': return ['d', 'Racket — nous perdons 5 Spamtons à chaque dégât infligé'];
    case 'debt': return ['d', 'Dette — les DEUX joueurs commencent à -20 Spamtons'];
    case 'enemyResPerTurn': return ['e', 'Affaiblissement — nos résistances -1 %/tour'];
    case 'enemyResOnHitTaken': return ['e', 'Corrosion — notre attaquant perd -1 % de résistances à chaque coup porté'];
    case 'paradox': return ['e', 'Paradoxe — ses propres résistances inversées'];
    case 'fullHealLow': return ['f', 'Sursaut Vital — soin total si PV < 10 % en début de tour'];
    case 'fullHealChance': return ['f', 'Revitalisation — 5 %/tour de soin total'];
    case 'vitalChance': return ['f', 'Chance Vitale — 10 % de se soigner au lieu de subir'];
    case 'healOnKill': return ['f', 'Reset ultime — soin à 100 % si son attaque tue'];
    case 'life8': return ['f', 'Life-8 — PV et PV max doublés au tour 8'];
    case 'hpOnDeath': return ['f', 'Vitalité des Âmes — +300 PV/PV max à chaque mort sur le terrain'];
    case 'hpMax': return ['f', t.scope === 'others' ? 'Cavalerie — +150 PV max aux autres alliés' : 'Baleine bleue — +200 PV'];
    case 'imprudent': return ['f', 'Imprudent — +500 PV mais Métamorphe aléatoire'];
    case 'phoenixFeather': return ['f', 'Plume de Phénix — 50 % de récupérer Phénix'];
    case 'metamorphOnDeath': return ['f', 'Transition — revient à la vie (Métamorphe aléatoire) à sa mort définitive'];
    case 'res': return ['f', `${t.name} — résistances +${t.value} (${[].concat(t.elements).join('/')}${t.scope === 'team' ? ', toute l’équipe' : ''})`];
    case 'resLowHp': return ['f', 'Résilience — +25 % res sous 50 % PV'];
    case 'resOnDeath': return ['f', 'Armure des Âmes — +10 % res à chaque mort'];
    case 'resOnHit': return ['f', 'Cœur d’acier — +1 % res par coup subi'];
    case 'critMult': return ['g', 'Frappe — dégâts critiques +1'];
    case 'crit': return ['g', 'Critique — +10 % critique'];
    case 'critPerTurn': return ['g', 'Boule de Crit — +2 % critique/tour'];
    case 'incisive': return ['g', 'Incisif — +1 % crit et précision/tour à toute l’équipe'];
    case 'echoAll': return ['g', 'Roulette — Écho 10 % sur toutes ses compétences'];
    case 'baseOnDeath': return ['g', 'One man army — +5 dégâts/soins de base à chaque mort'];
    case 'temporalityOnDeath': return ['g', 'Dernier souffle — Temporalité à toute son équipe à sa mort'];
    case 'temporalityStart': return ['g', 'Réducteur — Temporalité à un allié au 1er tour'];
    case 'genOnAttack': return ['g', 'Multicolore — +1 tous éléments par attaque'];
    case 'gen': return ['g', `${t.name} — bonus de départ (+${t.value} ${t.element})`];
    case 'breath8': return ['g', 'Souffle-8 — récupère Souffle élémentaire au tour 8'];
    case 'counter': return ['g', 'Contre — 1×/partie sous 25 % PV, lance toutes ses compétences sur son attaquant'];
    case 'passive': {
      const p = t.passive || '';
      if (p === 'Brut_R') return ['c', 'Brut (talent) — ignore nos résistances et provocations'];
      if (p === 'Erosion_C') return ['e', 'Erosion (talent) — nos PV max -50 % des dégâts subis'];
      if (p === 'Mimetisme_R') return ['d', 'Mimétisme (talent) — copie nos générations'];
      if (p === 'Inversement_R') return ['h', 'Inversement — ses dégâts↔soins et Éternités↔Temporalités inversés'];
      if (p.startsWith('Aoe')) return ['g', `${t.name} — passif AoE (${t.passiveObj && t.passiveObj.pct}% éclaboussure)`];
      if (p === 'Phoenix_C') return ['f', 'Nouvelle vie — Phénix 25 % OU Cimetière'];
      if (p === 'Mystere_R') return ['h', 'Mystère (talent) — passif aléatoire'];
      if (p === 'PunchingBag_C') return ['h', 'Sac de frappe (talent)'];
      if (p === 'Spamland_C') return ['h', 'Nouveau riche — Spamland (+3 Spamtons/tour) OU Chanceur'];
      return ['g', `${t.name} — passif ${p} (génération)`];
    }
    case 'anticipation': return ['h', 'Anticipation — lance TOUTES ses compétences au début, cibles uniques = une même carte adverse aléatoire'];
    case 'metamorphOthersOnDeath': return ['h', 'Virage 360 — Métamorphe aléatoire sur ses autres cartes à sa mort'];
    case 'evolution': return ['h', 'Évolution — rareté des passifs d’origine monte quand ses PV baissent'];
    default: return ['h', `${t.name} — ${t.kind} (économie/chance propre)`];
  }
};
for (const c of m.cards) for (const t of c.talents) {
  const [fam, mech] = TALMAP(t);
  add(fam, mech, 'talent', c, { ability: `TAL${t.slot} ${t.name}`, cd: null, target: null, duration: null, params: Object.fromEntries(Object.entries(t).filter(([k]) => !['slot','name','text','id','kind','passiveObj'].includes(k))), text: t.text, v121: (() => { const n = c21[c.number]; const q = n && n.talents.find(x => x.slot === t.slot); return q && q.text.replace(/\s/g,'') !== t.text.replace(/\s/g,'') && q.text.replace(/[\s  ]/g,'') !== t.text.replace(/[\s  ]/g,'') ? 'texte 1.21 : « ' + q.text + ' »' : null; })() });
}

fs.writeFileSync(W + '/catalog_raw.json', JSON.stringify(entries, null, 1));
console.log('abilities', totalAb, 'qualifying options', qualifying, 'entries', entries.length);
const cnt = {}; for (const e of entries) { const k = e.family + ' | ' + e.kind; cnt[k] = (cnt[k] || 0) + 1; }
console.log(cnt);
