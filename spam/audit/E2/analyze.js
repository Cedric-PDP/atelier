// Merges the run outputs and builds E2_results.json + tables used by E2_stress.md.
const fs = require('fs'), path = require('path');
const D = __dirname, SPAM = path.join(D, '..', '..');
const rd = f => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
const decks = rd('decks.json');
const model = JSON.parse(fs.readFileSync(path.join(SPAM, 'js', 'model.json'), 'utf8'));
const card = new Map(model.cards.map(c => [c.number, c]));
const res = new Map();
let offCheck = { n: 0, max: 0 }, wall = [];
const merge = f => {
  if (!fs.existsSync(path.join(D, f))) return false;
  const r = rd(f); if (r.err) throw new Error(f + ': ' + r.err);
  for (const x of r.res) { const o = res.get(x.key) || {}; Object.assign(o, x.sc); res.set(x.key, o); }
  if (r.offenseRecomputeCheck) { offCheck.n += r.offenseRecomputeCheck.n; offCheck.max = Math.max(offCheck.max, r.offenseRecomputeCheck.max); }
  wall.push([f, r.wallMs]); return true;
};
for (let c = 0; c < 6; c++) merge(`res_chunk_${c}.json`);
for (let c = 0; c < 5; c++) merge(`res2_chunk_${c}.json`);
merge('res2_named.json');
const P = [0, 1, 2, 3], TS = [2, 4, 6, 8];
const r0 = v => Math.round(v), r1 = v => Math.round(v * 10) / 10;
const pct = (x, b) => r1(100 * (1 - x / b));
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const argmin = a => a.reduce((bi, v, i) => v < a[bi] ? i : bi, 0);

// ---- card features (data facts) ----
const feat = n => {
  const c = card.get(n);
  const dmgAb = c.abilities.filter(a => a.options.some(o => o.hits.length));
  const teamAb = c.abilities.filter(a => a.options.some(o => o.effects.some(e => ['team', 'ally', 'randomAlly'].includes(e.scope) && ['base', 'crit', 'critMult', 'prec', 'res', 'hpMax', 'temporality'].includes(e.type))));
  const aoe = c.abilities.some(a => a.options.some(o => o.hits.length && ['aoeEnemy', 'spreadField', 'spreadEnemy'].includes(o.target))) || c.passives.some(p => p.type === 'aoe');
  return {
    hp: c.hp, dmgCdMax: dmgAb.length ? Math.max(...dmgAb.map(a => a.cd)) : 0, nAb: c.abilities.length,
    longCd: c.abilities.filter(a => a.cd >= 3).length, team: teamAb.length > 0 || c.passives.some(p => ['berserk', 'teamRes'].includes(p.type)),
    aoe, heal: c.abilities.some(a => a.options.some(o => o.heals.length)) || c.passives.some(p => ['lifesteal', 'regen'].includes(p.type)),
    gen: c.passives.some(p => ['coeur', 'mimetism', 'punchingBag'].includes(p.type)),
  };
};

const out = [];
for (const d of decks) {
  const sc = res.get(d.key);
  if (!sc || !sc.BASE) continue;
  const b = sc.BASE.score;
  const g = (k, m = 'net') => sc[k] ? sc[k][m] : null;
  const absGrid = {};
  for (const T of TS) absGrid[T] = P.map(p => ({ net: g(`ABS_T${T}_p${p}`), eng: g(`ABS_T${T}_p${p}`, 'score') }));
  const absAllNet = TS.flatMap(T => absGrid[T].map(x => x.net)), absAllEng = TS.flatMap(T => absGrid[T].map(x => x.eng));
  const perCardMeanNet = P.map(p => mean(TS.map(T => absGrid[T][p].net)));
  const perCardMeanEng = P.map(p => mean(TS.map(T => absGrid[T][p].eng)));
  const nat = P.map(p => ({ net: g(`ABS_nat_p${p}`), eng: g(`ABS_nat_p${p}`, 'score') }));
  const natW = argmin(nat.map(x => x.net));
  const cdrNat = P.map(p => g(`CDR_tgt_nat_p${p}`, 'score')), cdrNatW = argmin(cdrNat);
  const cdr5 = P.map(p => g(`CDR_tgt_5_p${p}`, 'score')), cdr5W = argmin(cdr5);
  const set4 = P.map(p => g(`SET_4_p${p}`, 'score')), set4W = argmin(set4);
  const setNatP = P.map(p => g(`SET_nat_p${p}`, 'score'));
  const hasSetNatP = setNatP.every(v => v != null);
  const setNatW = hasSetNatP ? argmin(setNatP) : null;
  const R = {
    ABS_nat_worst: nat[natW].net,
    CDR_tgt_nat_worst: cdrNat[cdrNatW],
    SUS_h32_net: g('SUS_h32'),
    SUS_rev_net: g('SUS_rev'),
    SET_nat_worst: hasSetNatP ? setNatP[setNatW] : g('SET_nat', 'score'),
  };
  const Rraw = Object.assign({}, R);
  for (const k of Object.keys(R)) R[k] = Math.min(R[k], r1(b));
  const Rk = Object.keys(R);
  const worstK = Rk.reduce((a, k) => R[k] < R[a] ? k : a, Rk[0]);
  const fs4 = d.nums.map(feat);
  const rec = {
    name: d.name, nums: d.nums, cards: d.names, rankOwned: d.owned ? d.rankOwned : null, owned: d.owned,
    base: r1(b), base_dataJson_s1: d.s1, nocrit_s0: d.s0, lostT1_dataJson: d.L, baseWins: sc.BASE.wins, baseEnemyHpLeft: sc.BASE.eLeft,
    ABS: {
      grid_net: Object.fromEntries(TS.map(T => [T, absGrid[T].map(x => x.net)])),
      grid_engine: Object.fromEntries(TS.map(T => [T, absGrid[T].map(x => x.eng)])),
      worst_net: Math.min(...absAllNet), mean_net: r1(mean(absAllNet)), worst_engine: Math.min(...absAllEng), mean_engine: r1(mean(absAllEng)),
      worstAt: (() => { const i = argmin(absAllNet); return { T: TS[Math.floor(i / 4)], card: d.names[i % 4] }; })(),
      mostValuable_net: d.names[argmin(perCardMeanNet)], mostValuable_engine: d.names[argmin(perCardMeanEng)],
      perCardMean_net: perCardMeanNet.map(r1), perCardMean_engine: perCardMeanEng.map(r1),
      byT_worst_net: Object.fromEntries(TS.map(T => [T, Math.min(...absGrid[T].map(x => x.net))])),
      byT_mean_net: Object.fromEntries(TS.map(T => [T, r1(mean(absGrid[T].map(x => x.net)))])),
      byT_worst_engine: Object.fromEntries(TS.map(T => [T, Math.min(...absGrid[T].map(x => x.eng))])),
      byT_mean_engine: Object.fromEntries(TS.map(T => [T, r1(mean(absGrid[T].map(x => x.eng)))])),
      byT_worstCard_net: Object.fromEntries(TS.map(T => [T, d.names[argmin(absGrid[T].map(x => x.net))]])),
      byT_worstCard_engine: Object.fromEntries(TS.map(T => [T, d.names[argmin(absGrid[T].map(x => x.eng))]])),
      nat_net: nat.map(x => x.net), nat_engine: nat.map(x => x.eng), nat_noop: P.map(p => sc[`ABS_nat_p${p}`].noop), nat_worst_net: nat[natW].net, nat_worst_card: d.names[natW],
      nat_worst_engine: Math.min(...nat.map(x => x.eng)), nat_mean_net: r1(mean(nat.map(x => x.net))),
      nat_split_P1_P2_worst: [sc[`ABS_nat_p${natW}`].nP1, sc[`ABS_nat_p${natW}`].nP2],
      nat_split_P1_P2_worst_engine: [sc[`ABS_nat_p${natW}`].sP1, sc[`ABS_nat_p${natW}`].sP2],
      nat_enemyHpLeft: P.map(p => sc[`ABS_nat_p${p}`].eLeft), nat_ownHpLeft: P.map(p => sc[`ABS_nat_p${p}`].hpLeft), baseOwnHpLeft: sc.BASE.hpLeft,
    },
    CDR: {
      all_5: g('CDR_all_5', 'score'), all_5_9: g('CDR_all_5_9', 'score'), all_nat: g('CDR_all_nat', 'score'),
      tgt_5: cdr5, tgt_5_worst: cdr5[cdr5W], tgt_5_worst_card: d.names[cdr5W],
      tgt_nat: cdrNat, tgt_nat_worst: cdrNat[cdrNatW], tgt_nat_worst_card: d.names[cdrNatW],
      split_all_5_P1_P2: [sc.CDR_all_5.sP1, sc.CDR_all_5.sP2],
    },
    SUS: {
      h32_engine: g('SUS_h32', 'score'), h32_net: g('SUS_h32'), h80_engine: g('SUS_h80', 'score'), h80_net: g('SUS_h80'),
      rev_engine: g('SUS_rev', 'score'), rev_net: g('SUS_rev'), h32_enemyHpLeft: sc.SUS_h32.eLeft, rev_enemyHpLeft: sc.SUS_rev.eLeft,
    },
    SET: {
      t4_maxhp: g('SET_4', 'score'), t4_target: set4, t4_worst: set4[set4W], t4_worst_card: d.names[set4W],
      nat_maxhp: g('SET_nat', 'score'), nat_target: hasSetNatP ? setNatP : null, nat_worst: R.SET_nat_worst, nat_worst_card: hasSetNatP ? d.names[setNatW] : null,
    },
    realistic: R, realisticUnclamped: Rraw, realisticWorst: R[worstK], realisticWorstScenario: worstK,
    realisticMean: r1(mean(Rk.map(k => R[k]))), realisticMeanDropPct: r1(mean(Rk.map(k => 100 * (1 - R[k] / b)))),
    drops: Object.fromEntries(Rk.map(k => [k, pct(R[k], b)])),
    features: {
      critDepPct: d.s0 && d.s1 ? r1(100 * (1 - d.s0 / d.s1)) : null,
      lossT1MaxPct: d.L ? r1(100 * (1 - Math.min(...d.L) / d.s1)) : null,
      hpSum: fs4.reduce((s, f) => s + f.hp, 0), hpMin: Math.min(...fs4.map(f => f.hp)),
      teamBuffers: fs4.filter(f => f.team).length, aoeCards: fs4.filter(f => f.aoe).length,
      longCdAbilities: fs4.reduce((s, f) => s + f.longCd, 0), healers: fs4.filter(f => f.heal).length,
      hasChimere: d.nums.includes(238) ? 1 : 0,
    },
  };
  // named-deck extras
  if (sc.ABS_nat_rm_p0) {
    rec.ABS.sensitivity = {
      nat_removalOnly_engine: P.map(p => g(`ABS_nat_rm_p${p}`, 'score')),
      nat_focusAbsorber_net: P.map(p => g(`ABS_nat_focus_p${p}`)), nat_focusAbsorber_engine: P.map(p => g(`ABS_nat_focus_p${p}`, 'score')),
      nat_noReplan_net: P.map(p => g(`ABS_nat_keep_p${p}`)),
      grid_removalOnly_engine: Object.fromEntries(TS.map(T => [T, P.map(p => g(`ABS_T${T}_rm_p${p}`, 'score'))])),
    };
  }
  out.push(rec);
}

// ---- rankings ----
const top = out.filter(x => x.owned);
const byWorst = top.slice().sort((a, b) => b.realisticWorst - a.realisticWorst);
const byMean = top.slice().sort((a, b) => b.realisticMean - a.realisticMean);
const byDrop = top.filter(x => x.base >= 6000).sort((a, b) => a.realisticMeanDropPct - b.realisticMeanDropPct);
const rankIn = (arr, x) => arr.indexOf(x) + 1;
for (const x of out) { x.rank_realisticWorst = x.owned ? rankIn(byWorst, x) : null; x.rank_realisticMean = x.owned ? rankIn(byMean, x) : null; x.rank_base = x.rankOwned; }

// ---- feature correlations (Pearson, over owned decks) ----
const pear = (xs, ys) => { const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; } return sxx && syy ? r1(100 * sxy / Math.sqrt(sxx * syy)) / 100 : null; };
const FEAT = ['critDepPct', 'lossT1MaxPct', 'hpSum', 'hpMin', 'teamBuffers', 'aoeCards', 'longCdAbilities', 'healers', 'hasChimere'];
const corr = {};
for (const f of FEAT) {
  corr[f] = {};
  for (const k of [...Object.keys(top[0].drops), 'mean']) {
    const ys = top.map(x => k === 'mean' ? x.realisticMeanDropPct : x.drops[k]);
    corr[f][k] = pear(top.map(x => x.features[f]), ys);
  }
  corr[f].base = pear(top.map(x => x.features[f]), top.map(x => x.base));
}
// ---- card-level: cost when THIS card is the target, and presence effect ----
const cardStats = {};
for (const x of top) x.nums.forEach((n, p) => {
  const cs = cardStats[n] || (cardStats[n] = { name: x.cards[p], decks: 0, absNatDrop: [], absNatDropEng: [], noop: [], setNatDrop: [], cdrNatDrop: [], mostValuable: 0, mostValuableEng: 0, meanDrop: [], absGridMeanDrop: [], absGridMeanDropEng: [] });
  cs.decks++;
  cs.absNatDrop.push(100 * (1 - x.ABS.nat_net[p] / x.base));
  cs.absGridMeanDrop.push(100 * (1 - x.ABS.perCardMean_net[p] / x.base));cs.absGridMeanDropEng.push(100 * (1 - x.ABS.perCardMean_engine[p] / x.base));cs.absNatDropEng.push(100 * (1 - x.ABS.nat_engine[p] / x.base));cs.noop.push(100 * x.ABS.nat_noop[p] / 18);if (x.ABS.mostValuable_engine === x.cards[p]) cs.mostValuableEng++;
  if (x.SET.nat_target) cs.setNatDrop.push(100 * (1 - x.SET.nat_target[p] / x.base));
  cs.cdrNatDrop.push(100 * (1 - x.CDR.tgt_nat[p] / x.base));
  if (x.ABS.mostValuable_net === x.cards[p]) cs.mostValuable++;
  cs.meanDrop.push(x.realisticMeanDropPct);
});
const allMeanDrop = mean(top.map(x => x.realisticMeanDropPct));
const cardTable = Object.entries(cardStats).map(([n, cs]) => ({
  number: +n, name: cs.name, decks: cs.decks, ...feat(+n),
  absorbedDropPct_nat: r1(mean(cs.absNatDrop)), absorbedDropPct_nat_engine: r1(mean(cs.absNatDropEng)), absorbNoopPct_nat: r1(mean(cs.noop)), absorbedDropPct_gridMean: r1(mean(cs.absGridMeanDrop)), absorbedDropPct_gridMean_engine: r1(mean(cs.absGridMeanDropEng)), mostValuableShare_engine: r1(100 * cs.mostValuableEng / cs.decks),
  setHpTargetDropPct_nat: cs.setNatDrop.length ? r1(mean(cs.setNatDrop)) : null, cdResetTargetDropPct_nat: r1(mean(cs.cdrNatDrop)),
  mostValuableShare: r1(100 * cs.mostValuable / cs.decks), decksMeanDropPct: r1(mean(cs.meanDrop)), deltaVsAll: r1(mean(cs.meanDrop) - allMeanDrop),
})).sort((a, b) => b.absorbedDropPct_nat - a.absorbedDropPct_nat);

const above = { n: 0, gt1pct: 0, max: 0, maxWhere: null };
for (const d of decks) { const sc = res.get(d.key); if (!sc) continue; const b = sc.BASE.score; for (const [k, v] of Object.entries(sc)) { if (k === 'BASE') continue; above.n++; const g = 100 * (v.score / b - 1); if (g > 1) above.gt1pct++; if (g > above.max) { above.max = r1(g); above.maxWhere = [d.nums.join('-'), k]; } } }
const xc = fs.existsSync(path.join(D, 'crosscheck.json')) ? rd('crosscheck.json') : null;
const val = rd('validation.json');
const R = {
  meta: {
    engine: 'engine_stress.js = SP/spam/js/simulation.js (wiki engine, game 1.20, engineHash a8193b3d422a54a9) + 10 exact-substring patches + appended __st* helpers (make_engine.js); toggles read from globalThis.STRESS, default off.',
    validation: val, offenseRecomputeCheck: offCheck, sanityStressedAboveBase_engineMetric: above, wallMs: wall,
    crosscheckT1: xc && xc.map(r => ({ name: r.name, base: r.base, cards: r.cards.map(c => ({ card: c.card, deadCard: c.deadCard, absorbT1_removalOnly: c.rm_start, absorbT1_removalPlusDeathBounty: c.rmBounty_start, absorbT1_withHpGain: c.gain_start, absorbT1_enemyTiming: c.gain_enemy })) })),
    scoreKinds: { score: "engine metric J (offense counts gross useful damage)", net: "same J but offense counts useful damage MINUS HP the enemy gained that turn (absorb gain, heal, revive); identical to score when the enemy gains nothing or the match is won within 10 turns" },
    realisticSet: 'ABS_nat_worst (net) | CDR_tgt_nat_worst | SUS_h32 (net) | SUS_rev (net) | SET_nat_worst — natural cooldown timing of the enemy ability, opponent picks our most damaging target',
    decks: out.length, ownedDecks: top.length,
  },
  scenarios: { main: rd('scenarios.json'), extra: fs.existsSync(path.join(D, 'scenarios2.json')) ? rd('scenarios2.json') : null },
  decks: out, rankings: {
    byRealisticWorst: byWorst.slice(0, 30).map(x => [x.nums.join('-'), x.base, x.realisticWorst, x.realisticWorstScenario, x.realisticMean, x.realisticMeanDropPct]),
    byRealisticMean: byMean.slice(0, 30).map(x => [x.nums.join('-'), x.base, x.realisticMean, x.realisticMeanDropPct, x.realisticWorst]),
    byMeanDropPct_base6000: byDrop.slice(0, 30).map(x => [x.nums.join('-'), x.base, x.realisticMeanDropPct, x.realisticWorst]),
  },
  featureCorrelations: corr, cardTable,
};
fs.writeFileSync(path.join(D, 'E2_results.json'), JSON.stringify(R, null, 1));
console.log('decks', out.length, 'owned', top.length, 'offense check', JSON.stringify(offCheck));
const nm = out.slice(0, 6);
const show = x => `${(x.name || x.nums.join('-')).padEnd(16)} base ${x.base} | ABS worst ${x.ABS.worst_net}/${x.ABS.worst_engine} mean ${x.ABS.mean_net}/${x.ABS.mean_engine} MV ${x.ABS.mostValuable_net} | nat ${x.ABS.nat_worst_net} (${x.ABS.nat_worst_card}) | CDR all5 ${x.CDR.all_5} all5_9 ${x.CDR.all_5_9} allnat ${x.CDR.all_nat} tgtnat ${x.CDR.tgt_nat_worst} (${x.CDR.tgt_nat_worst_card}) | SUS h32 ${x.SUS.h32_engine}/${x.SUS.h32_net} h80 ${x.SUS.h80_net} rev ${x.SUS.rev_engine}/${x.SUS.rev_net} | SET4 ${x.SET.t4_maxhp} worst ${x.SET.t4_worst} (${x.SET.t4_worst_card}) nat ${x.SET.nat_maxhp} natW ${x.SET.nat_worst} (${x.SET.nat_worst_card}) | R worst ${x.realisticWorst} ${x.realisticWorstScenario} meanDrop ${x.realisticMeanDropPct}% rankW ${x.rank_realisticWorst}`;
for (const x of nm) console.log(show(x));
console.log('--- top by realistic worst');
for (const x of byWorst.slice(0, 15)) console.log(show(x));
console.log('--- corr'); for (const f of FEAT) console.log(f.padEnd(16), JSON.stringify(corr[f]));
console.log('--- cards'); for (const c of cardTable) console.log(JSON.stringify(c));
