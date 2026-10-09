// Assembles SP/spam/audit/v121stress/B_duel_121.json from the B_work/out_*.json runs.
const fs = require('fs');
const path = require('path');
const W = __dirname; const SP = path.resolve(W, '../../../..');
const rd = f => JSON.parse(fs.readFileSync(path.join(W, f), 'utf8')).res;
const model = JSON.parse(fs.readFileSync(path.join(SP, 'spam/v121/model.json'), 'utf8'));
const byNum = {}; for (const c of model.cards) byNum[c.number] = c;
const nm = nums => nums.map(n => byNum[n].name);
const top = JSON.parse(fs.readFileSync(path.join(SP, 'spam/audit/v121check/top_owned_121.json'), 'utf8'));
const keyOf = nums => nums.slice().sort((a, b) => a - b).join('-');
const wikiJ = new Map(top.map(t => [keyOf(t.nums), t.s1]));
const check = rd('out_check_min.json');
const aN = rd('out_duel_none.json').duel, aR = rd('out_duel_rec.json').duel;
const sN = rd('out_sym_none.json').sym, sR = rd('out_sym_rec.json').sym;
const inc = rd('out_incident.json').incident, sens = rd('out_sens.json').sens;
const oppN = rd('out_duel_none.json').oppDmg10, oppR = rd('out_duel_rec.json').oppDmg10;
// opponents (same order as in the driver)
const META = Object.keys(Object.values(aN)[0].vs);
const metaSrc = JSON.parse(fs.readFileSync('C:/Users/cperouseduperrier/perso/spam-atelier/spam/versions/1.21/meta_decks.json', 'utf8')).decks;
const opponents = META.map(k => {
  const nums = k.split('-').map(Number); const idx = metaSrc.findIndex(d => keyOf(d) === k);
  let wa = 0, wr = 0, sa = 0, sr = 0;
  for (const dk of Object.keys(aN)) { for (const g of aN[dk].vs[k]) if (g.o === 'W') wa++; for (const g of aR[dk].vs[k]) if (g.o === 'W') wr++; for (const g of sN[dk].vs[k]) if (g.o === 'W') sa++; for (const g of sR[dk].vs[k]) if (g.o === 'W') sr++; }
  return { key: k, nums, names: nm(nums), source: idx >= 0 ? 'wiki 1.21 tier list, position ' + (idx + 1) : 'F_meta.json topDecks.P1_N #1 (meilleur deck sans talent du moteur)',
    unopposedDmg10: { sansTalent: oppN[k], talentsRecommandes: oppR[k] },
    gamesWonByOurDecks: { asym_sansTalent: wa, asym_talents: wr, sym_sansTalent: sa, sym_talents: sr, outOf: Object.keys(aN).length * 2 } };
});
const decks = Object.keys(aN).map(k => {
  const a = aN[k], ar = aR[k], s = sN[k], sr = sR[k];
  const named = !!inc[k];
  const total = a.wins + ar.wins + s.wins + sr.wins;
  const perOpp = {};
  for (const m of META) perOpp[m] = {
    asym_sansTalent: a.vs[m].map(g => ({ ordre: g.p, J10: g.J, course30: g.o, tourVictoire: g.kill, tourAneanti: g.wipe })),
    asym_talents: ar.vs[m].map(g => ({ ordre: g.p, J10: g.J, course30: g.o, tourVictoire: g.kill, tourAneanti: g.wipe })),
    sym_sansTalent: s.vs[m].map(g => ({ ordre: g.p, course30: g.o, tourNous: g.kA, tourEux: g.kB })),
    sym_talents: sr.vs[m].map(g => ({ ordre: g.p, course30: g.o, tourNous: g.kA, tourEux: g.kB })) };
  return { key: k, label: a.label, nommé: named, nums: a.nums, noms: nm(a.nums), wikiJ18: named ? sens[k].x1.J : (wikiJ.get(k) ?? null),
    victoires: { asym_sansTalent: a.wins, asym_talents: ar.wins, sym_sansTalent: s.wins, sym_talents: sr.wins, total, surParties: 96 },
    défaites: { asym_sansTalent: a.losses, asym_talents: ar.losses, sym_sansTalent: s.losses, sym_talents: sr.losses },
    nulsTimeout: { asym_sansTalent: a.timeouts, asym_talents: ar.timeouts, sym_sansTalent: s.timeouts, sym_talents: sr.timeouts },
    J10moyen: { sansTalent: a.meanJ10, talents: ar.meanJ10, moyenne: Math.round((a.meanJ10 + ar.meanJ10) / 2) },
    miroir: s.mirror.map(m => ({ ordre: m.p, asym: m.asym, sym: m.sym })),
    parAdversaire: perOpp };
});
decks.sort((x, y) => y.victoires.total - x.victoires.total || y.J10moyen.moyenne - x.J10moyen.moyenne);
const classement = decks.map((d, i) => ({ rang: i + 1, label: d.label, nommé: d.nommé, nums: d.nums, noms: d.noms.join(', '), victoiresTotal: d.victoires.total, asym_sansTalent: d.victoires.asym_sansTalent, asym_talents: d.victoires.asym_talents, sym_sansTalent: d.victoires.sym_sansTalent, sym_talents: d.victoires.sym_talents, J10moyen: d.J10moyen.moyenne, wikiJ18: d.wikiJ18 }));
const rankBy = f => decks.slice().sort((x, y) => f(y) - f(x) || y.J10moyen.moyenne - x.J10moyen.moyenne).map((d, i) => ({ rang: i + 1, label: d.label, nums: d.nums, v: f(d) }));
const incident = Object.fromEntries(Object.entries(inc).map(([k, r]) => [r.label, {
  nums: r.nums, noms: nm(r.nums),
  sansEffet: { J10: r.plain.J, victoires30: r.plain.wins, parOrdre: r.plain.byOrder },
  provocationSeule: { J10: r.tauntOnly.J, victoires30: r.tauntOnly.wins, deltaPct: Math.round(1000 * (r.tauntOnly.J - r.plain.J) / r.plain.J) / 10, parOrdre: r.tauntOnly.byOrder },
  absorptionSeule: { cibleLaPirePourNous: r.absorbOnly.target, J10: r.absorbOnly.J, victoires30: r.absorbOnly.wins, deltaPct: Math.round(1000 * (r.absorbOnly.J - r.plain.J) / r.plain.J) / 10, parCible: r.absorbOnly.perTarget, parOrdre: r.absorbOnly.byOrder },
  provocationEtAbsorption: { cibleLaPirePourNous: r.tauntAbsorb.target, J10: r.tauntAbsorb.J, victoires30: r.tauntAbsorb.wins, deltaPct: Math.round(1000 * (r.tauntAbsorb.J - r.plain.J) / r.plain.J) / 10, parCible: r.tauntAbsorb.perTarget, parOrdre: r.tauntAbsorb.byOrder } }]));
const sensibilite = Object.fromEntries(Object.entries(sens).map(([k, r]) => [r.label, {
  nums: r.nums, noms: nm(r.nums),
  x1: { J18: r.x1.J, course30: r.x1.race },
  'x1.5': { J18: r['x1.5'].J, course30: r['x1.5'].race, deltaPct: Math.round(1000 * (r['x1.5'].J - r.x1.J) / r.x1.J) / 10 },
  x2: { J18: r.x2.J, course30: r.x2.race, deltaPct: Math.round(1000 * (r.x2.J - r.x1.J) / r.x1.J) / 10 } }]));
const out = {
  _lisezMoi: [
    'Agent B, vague 2 (1.21). Moteur wiki 1.21 (engineHash 36e2c03d5b7bf4a1, SP/spam/v121/dl/simulation.js), modèle SP/spam/v121/model.json. Nos decks sans talent.',
    'Duel carte par carte = mode « par carte » intégré au moteur : chaque carte adverse inflige sa propre courbe de dégâts (calculée par le moteur en mode potentiel, contre une cible à 0 % de résistance, joueur opposé), soigne, et s\'arrête quand elle meurt.',
    'J10 = score du moteur sur 10 tours (la note du wiki). course30 = W (nous anéantissons les 4 cartes adverses avant de perdre nos 4 cartes), L (l\'inverse) ou T (ni l\'un ni l\'autre en 30 tours). Au-delà du tour 10, les courbes restent à leur valeur du tour 10.',
    'asym = méthode 1.20 portée telle quelle. L\'adversaire y est une courbe SANS attrition : ses dégâts ne baissent que quand une carte meurt, aucun excédent de dégâts n\'est perdu, et ses bonus d\'élément restent ceux d\'une partie sans opposition. Elle est donc pessimiste : un deck ne gagne presque jamais contre lui-même (voir « miroir »). Seul l\'ordre relatif est fiable.',
    'sym = course symétrique. Chaque camp est simulé avec attrition contre les courbes sans attrition de l\'autre. Le camp qui anéantit l\'autre au tour le plus tôt gagne ; à égalité de tour, celui qui joue en premier.',
    'talents = adversaires avec le talent recommandé par le modèle pour chaque carte (model.recommended) ; sansTalent = adversaires sans talent.',
    'Le classement trie sur le total des victoires (4 variantes × 12 adversaires × 2 ordres = 96 parties), puis sur le J10 moyen.',
    'Limite : les adversaires n\'ont que leurs dégâts, leurs soins, leur Phénix et le Brut. Leurs effets (gel, éternité, provocation, absorption, renvoi) ne sont pas joués, sauf dans « incident ».'
  ],
  meta: {
    moteur: '1.21 engineHash 36e2c03d5b7bf4a1', courbeAdverseAbstraite: [113, 130, 146, 163, 179, 196, 212, 229, 245, 262],
    correspondanceNoms121: { match: 'J (1.20 q)', score: 'Y (1.20 J)', phaseAdverse: 'le (1.20 de)', profilElement: 'T', dps: 'xe (1.20 Se)', profils: 'd', parametres: 'o', evaluateur: 'ht' },
    controles: {
      moteurMinifieEgalReindente: true,
      scoreDirect18EgalEvaluate: Object.fromEntries(Object.entries(check.check).map(([k, v]) => [k, { evaluate: Math.round(v.evaluate * 100) / 100, direct: Math.round(v.mine18 * 100) / 100, crochetVideSurPhaseAdverse: Math.round(v.withNoopHook * 100) / 100 }])),
      cloneParCarteDuProfilNeutre: Object.fromEntries(Object.entries(check.check).map(([k, v]) => [k, { abstrait: Math.round(v.neutralAbstract * 100) / 100, parCarte: Math.round(v.neutralPerCardClone * 100) / 100 }])),
      x15_x2_identiquesACheck121: Object.fromEntries(Object.entries(check.check).map(([k, v]) => [k, { 'x1.5': Math.round(v.x15 * 10) / 10, x2: Math.round(v.x2 * 10) / 10 }]))
    },
    sourcesDecks: { nommés: 'SP/spam/audit/v121check/decks.json (18)', top40: 'SP/spam/audit/v121check/top_owned_121.json (40 premiers ; 7 déjà parmi les nommés → 51 decks distincts)', adversaires: 'C:/Users/cperouseduperrier/perso/spam-atelier/spam/versions/1.21/meta_decks.json (11 choisis pour la variété) + F_meta.json topDecks.P1_N #1 ; F_meta.json lui-même porte sur le moteur 1.20 et ne liste pas de decks 1.21' },
    scripts: 'SP/spam/audit/v121stress/B_work/ (gen121.js, t121.js, assemble.js, out_*.json)'
  },
  adversaires: opponents,
  classement,
  classementsParVariante: {
    asym_sansTalent: rankBy(d => d.victoires.asym_sansTalent), asym_talents: rankBy(d => d.victoires.asym_talents),
    sym_sansTalent: rankBy(d => d.victoires.sym_sansTalent), sym_talents: rankBy(d => d.victoires.sym_talents),
    J10moyen: decks.slice().sort((x, y) => y.J10moyen.moyenne - x.J10moyen.moyenne).map((d, i) => ({ rang: i + 1, label: d.label, nums: d.nums, v: d.J10moyen.moyenne }))
  },
  victoiresParDeck: Object.fromEntries(decks.map(d => [d.label, d.victoires])),
  decks,
  incident_18nommes: { _note: 'Adversaire par carte : Tisseuse de Mots (500 PV, aucun dégât, Veuve noire au tour 7 si nous jouons 1er, au tour 8 si nous jouons 2e, tant qu\'elle vit), Fleur de Vie (600 PV, 10 dégâts/tour, provocation permanente : opts.focus) et 2 × 700 PV qui portent la courbe abstraite 1.21. La cible absorbée est la PIRE pour nous parmi nos 4 cartes. J10 = moyenne des deux ordres ; victoires30 sur 2 parties.', ...incident },
  sensibiliteDegats_18nommes: { _note: 'Profils abstraits du moteur (18 matchs), courbe adverse ×1, ×1,5, ×2. J18 = note du wiki ; course30 = victoires/défaites/nuls sur 18 courses de 30 tours.', ...sensibilite }
};
fs.mkdirSync(path.join(SP, 'spam/audit/v121stress'), { recursive: true });
fs.writeFileSync(path.join(SP, 'spam/audit/v121stress/B_duel_121.json'), JSON.stringify(out, null, 1));
console.log('written; decks', decks.length, 'top10:');
for (const c of classement.slice(0, 12)) console.log(c.rang, c.label, c.nums.join(','), 'total', c.victoiresTotal, '(', c.asym_sansTalent, c.asym_talents, c.sym_sansTalent, c.sym_talents, ') J10', c.J10moyen, 'wikiJ', c.wikiJ18);
console.log('named decks:');
for (const c of classement.filter(c => c.nommé)) console.log(c.rang, c.label, c.nums.join(','), 'total', c.victoiresTotal, '(', c.asym_sansTalent, c.asym_talents, c.sym_sansTalent, c.sym_talents, ') J10', c.J10moyen, 'wikiJ', c.wikiJ18);
