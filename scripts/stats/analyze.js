// Aggregates the global random sample (g_res_*.json), the exhaustive collection (all_v2.json)
// and the 7 proposed decks (decks_eval.json) into stats.json + histogram.txt.
// Plain node, reads JSON only (does not load the engine).
const fs = require('fs'), path = require('path');
const SP = process.argv[2];
const P = (...p) => path.join(SP, ...p);
const rd = p => JSON.parse(fs.readFileSync(P(p), 'utf8'));
const exists = p => fs.existsSync(P(p));

const model = rd('spam/js/model_crit1.json');
const NT = model.noTalent;                       // {best, baseline} used when no talent is set
const WT = { best: model.best, baseline: model.baseline };
const frCards = rd('spam/cards_fr.json').cards;
const frById = new Map(frCards.map(c => [c.id, c]));

// ---------- global random sample ----------
const gd = rd('spam/stats/global_decks.json');
let grows = [];
for (let c = 0; c < 6; c++) grows.push(...rd(`spam/stats/g_res_${c}.json`).rows);
grows.sort((a, b) => a[0] - b[0]);
if (grows.length !== gd.n || grows.some((r, i) => r[0] !== i)) throw Error('global rows incomplete');
const g1 = grows.map(r => r[1]);
const gPairs = grows.filter(r => r[3] !== null).map(r => ({ s1: r[1], s0: r[3] }));
if (gPairs.length !== gd.nx0) throw Error('x0 rows count mismatch');

// ---------- collection (exhaustive) ----------
const coll = rd('spam/all_v2.json');
const c1 = coll.map(r => r.s1);
const cPairs = coll.map(r => ({ s1: r.s1, s0: r.s0 }));

// ---------- helpers ----------
const PCTS = [1, 5, 10, 25, 50, 75, 90, 95, 99, 99.9];
const sortNum = a => [...a].sort((x, y) => x - y);
function quant(s, p) { const h = (s.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h); return s[lo] + (h - lo) * (s[hi] - s[lo]); }
function describe(arr) {
  const s = sortNum(arr), n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const o = { n, mean, sd, min: s[0] };
  for (const p of PCTS) o['p' + p] = quant(s, p / 100);
  o.max = s[n - 1];
  return o;
}
function critShare(pairs) {
  const cs = pairs.map(p => 1 - p.s0 / p.s1);
  const d = describe(cs);
  const S1 = pairs.reduce((a, p) => a + p.s1, 0), S0 = pairs.reduce((a, p) => a + p.s0, 0);
  return { n: d.n, mean: d.mean, sd: d.sd, p10: d.p10, p25: d.p25, median: d.p50, p75: d.p75, p90: d.p90, max: d.max,
    pooled: 1 - S0 / S1, negative: cs.filter(x => x < 0).length };
}
function histogram(arr, w = 500) {
  const s = sortNum(arr); const lo = Math.floor(s[0] / w) * w, hi = Math.floor(s[s.length - 1] / w) * w;
  const bins = []; for (let b = lo; b <= hi; b += w) bins.push({ from: b, to: b + w, count: 0 });
  for (const v of s) bins[Math.floor(v / w) - lo / w].count++;
  return bins;
}
function place(sorted, x) {
  let below = 0, ties = 0; for (const v of sorted) { if (v < x) below++; else if (v === x) ties++; }
  const n = sorted.length, atLeast = n - below, above = atLeast - ties;
  return { n, below, ties, above, atLeast, pct: 100 * (below + 0.5 * ties) / n, rank: above + 1,
    oneIn: atLeast > 0 ? n / atLeast : null, oneInUpper95: atLeast === 0 ? n / 3 : null };
}
// exact Poisson 95% CI for a count k (bisection on the CDF), used for "1 deck sur N" with few hits
function poisCdf(k, m) { let t = Math.exp(-m), s = t; for (let i = 1; i <= k; i++) { t *= m / i; s += t; } return s; }
function poisCI(k) {
  const bis = (f, lo, hi) => { for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (f(mid)) hi = mid; else lo = mid; } return (lo + hi) / 2; };
  const lower = k === 0 ? 0 : bis(m => 1 - poisCdf(k - 1, m) >= 0.025, 0, 10 * k + 10);
  const upper = bis(m => poisCdf(k, m) <= 0.025, 0, 10 * k + 20);
  return { lower, upper };
}
const idx = (s, nt = NT) => 100 * (s - nt.baseline) / (nt.best - nt.baseline);
const tierOf = i => i >= 90 ? 'S' : i >= 80 ? 'A' : i >= 70 ? 'B' : i >= 50 ? 'C' : 'D';
const r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100;
const roundObj = (o, f = r1) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? f(v) : v]));

// ---------- distributions ----------
const gSorted = sortNum(g1), cSorted = sortNum(c1);
const global = {
  source: `uniform random 4-card decks among the ${gd.ids.length} cards, no talents, no shop, seed ${gd.seed} (${gd.rng}), i.i.d. draws (${gd.distinct} distinct of ${gd.n})`,
  scores: roundObj(describe(g1)),
  critShare: roundObj(critShare(gPairs), x => Math.round(x * 1e4) / 1e4),
  critShareSample: `first ${gd.nx0} decks (x0 = model_crit0)`,
  scoresX0: roundObj(describe(gPairs.map(p => p.s0))),
  histogram500: histogram(g1),
};
const collection = {
  source: 'all_v2.json: every 4-card deck of the 26-card collection (exhaustive), no talents, no shop',
  scores: roundObj(describe(c1)),
  critShare: roundObj(critShare(cPairs), x => Math.round(x * 1e4) / 1e4),
  scoresX0: roundObj(describe(cPairs.map(p => p.s0))),
  histogram500: histogram(c1),
};

// ---------- wiki tiers ----------
const tierQ = { S: 0.9, A: 0.8, B: 0.7, C: 0.5 };
const tiers = {
  rule: 'index = (score - baseline)/(best - baseline); S>=90%, A>=80%, B>=70%, C>=50%, else D',
  modelFields: { baseline: model.baseline, best: model.best, noTalent: NT },
  pairUsedNoTalent: NT,
  thresholds: Object.fromEntries(Object.entries(tierQ).map(([t, q]) => {
    const s = NT.baseline + q * (NT.best - NT.baseline);
    const g = place(gSorted, s), c = place(cSorted, s);
    return [t, { minIndex: q * 100, minScore: r1(s), globalShareAtOrAbove: g.atLeast / g.n, globalCountAtOrAbove: g.atLeast,
      collectionShareAtOrAbove: c.atLeast / c.n, collectionCountAtOrAbove: c.atLeast }];
  })),
  index0Score: NT.baseline, index100Score: NT.best,
  globalMeanVsBaseline: { sampleMean: r1(global.scores.mean), wikiBaseline: NT.baseline, sampleIndexOfMean: r2(idx(describe(g1).mean)) },
  withTalentPairForReference: WT,
};
// share of the global sample / collection per tier
for (const [name, arr] of [['global', g1], ['collection', c1]]) {
  const cnt = { S: 0, A: 0, B: 0, C: 0, D: 0 }; for (const v of arr) cnt[tierOf(idx(v))]++;
  tiers['tierCounts_' + name] = cnt;
}

// best no-talent decks found
const best = {};
const nm = id => { const c = frById.get(id); return c ? `${c.number}:${c.name}` : id; };
if (exists('spam/stats/bestdecks.json')) {
  const b = rd('spam/stats/bestdecks.json');
  best.bestDecks = { method: 'I.bestDecks(all 127 ids): engine beam (pairs120/triples100/quads400/finalTop8)', ms: b.ms,
    noTalent: b.best.noTalent.map(d => ({ score: r1(d.score), tier: d.tier, advantage: r2(d.advantage), cards: d.cards.map(c => nm(c.id)) })),
    withTalents: b.best.withTalents.map(d => ({ score: r1(d.score), tier: d.tier, advantage: r2(d.advantage), cards: d.cards.map(c => nm(c.id) + (c.talentId ? ' [talent]' : '')) })) };
}
for (const f of ['beam_def', 'beam_wide', 'hill']) {
  if (!exists(`spam/stats/${f}.json`)) continue;
  const b = rd(`spam/stats/${f}.json`);
  best[f] = { beam: b.beam, msBeam: b.msBeam, ms: b.ms, top: (b.top || []).slice(0, 5).map(d => ({ score: r1(d.score), index: r2(idx(d.score)), tier: tierOf(idx(d.score)), cards: d.ids.map(nm) })) };
}

if (best.beam_wide && best.beam_wide.top.length) best.wikiBestReproduced = { wikiNoTalentBest: NT.best, found: best.beam_wide.top[0].score, deck: best.beam_wide.top[0].cards,
  localOptimum1Swap: best.hill ? best.hill.top[0].score === best.beam_wide.top[0].score : null };
// ---------- the 7 proposed decks ----------
const de = rd('spam/stats/decks_eval.json').decks;
const collByKey = new Map(coll.map(r => [r.k.split(',').sort().join(','), r]));
const decks = {};
const gCritSorted = sortNum(gPairs.map(p => 1 - p.s0 / p.s1)), cCritSorted = sortNum(cPairs.map(p => 1 - p.s0 / p.s1));
const gS0Sorted = sortNum(gPairs.map(p => p.s0)), cS0Sorted = sortNum(cPairs.map(p => p.s0));
const G = describe(g1);
for (const [name, d] of Object.entries(de)) {
  if (typeof d !== 'object') continue;
  const g = place(gSorted, r2(d.s1));
  const cr = collByKey.get([...d.ids].sort().join(','));
  const c = place(cSorted, Math.round(d.s1));
  const formulaIdx = idx(d.s1), talentPairIdx = idx(d.s1, WT);
  decks[name] = {
    cards: d.ids.map(nm), inCollection: !!cr,
    s1: r1(d.s1), s0: r1(d.s0), ttk: d.ttk, critShare: Math.round((1 - d.s0 / d.s1) * 1e4) / 1e4,
    allV2: cr ? { s1: cr.s1, s0: cr.s0, match: Math.round(d.s1) === cr.s1 && Math.round(d.s0) === cr.s0 } : null,
    global: { pct: r2(g.pct), atLeast: g.atLeast, n: g.n, oneIn: g.oneIn ? r1(g.oneIn) : null, oneInUpper95: g.oneInUpper95,
      oneIn95CI: g.atLeast < 30 ? (ci => [Math.round(g.n / ci.upper), ci.lower > 0 ? Math.round(g.n / ci.lower) : null])(poisCI(g.atLeast)) : null,
      sdAboveMean: r2((d.s1 - G.mean) / G.sd) },
    critSharePct: { global6000: r2(place(gCritSorted, 1 - d.s0 / d.s1).pct), collection: r2(place(cCritSorted, 1 - d.s0 / d.s1).pct) },
    x0World: { globalPct6000: r2(place(gS0Sorted, r2(d.s0)).pct), collectionPct: r2(place(cS0Sorted, Math.round(d.s0)).pct), collectionRank: place(cS0Sorted, Math.round(d.s0)).rank },
    collection: { pct: r2(c.pct), rank: c.rank, above: c.above, ties: c.ties, n: c.n, oneIn: c.oneIn ? r1(c.oneIn) : null },
    wiki: { evaluateTier: d.tier, evaluateAdvantage: r2(d.advantage), formulaIndexNoTalentPair: r2(formulaIdx), formulaTier: tierOf(formulaIdx),
      indexIfTalentPair: r2(talentPairIdx), reproduces: Math.abs(formulaIdx - d.advantage) < 1e-6 && tierOf(formulaIdx) === d.tier },
  };
}

// ---------- ASCII histograms ----------
const fmt = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const MARK = Object.entries(decks).map(([name, d]) => ({ name, s: d.s1, bin: Math.floor(d.s1 / 500) * 500 }));
function render(title, bins, n, width = 40, markAll = true, onlyIn = null) {
  const lines = [title];
  const maxC = Math.max(...bins.map(b => b.count));
  const markBins = MARK.map(m => m.bin);
  let lo = bins[0].from, hi = bins[bins.length - 1].from;
  for (const b of markBins) { lo = Math.min(lo, b); hi = Math.max(hi, b); }
  const byFrom = new Map(bins.map(b => [b.from, b]));
  let emptyRun = 0;
  for (let f = lo; f <= hi; f += 500) {
    const b = byFrom.get(f) || { from: f, to: f + 500, count: 0 };
    const ms = MARK.filter(m => m.bin === f);
    if (b.count === 0 && ms.length === 0) { emptyRun++; continue; }
    if (emptyRun) { lines.push(`        ...      |   (${emptyRun} classe(s) vide(s))`); emptyRun = 0; }
    const len = Math.round(b.count / maxC * width);
    const bar = (len === 0 && b.count > 0 ? '.' : '#'.repeat(len)).padEnd(width);
    const pc = (100 * b.count / n).toFixed(1).replace('.', ',').padStart(5) + ' %';
    const lab = `${fmt(b.from).padStart(6)}-${fmt(b.to - 1).padStart(6)}`;
    const mk = ms.length ? ' <- ' + ms.map(m => `${m.name} (${fmt(m.s)})` + (onlyIn && !decks[m.name].inCollection ? ' hors coll.' : '')).join(', ') : '';
    lines.push(`${lab} |${bar}| ${pc}${mk}`);
  }
  return lines.join('\n');
}
// compact side-by-side version for the report: tails merged so that it fits in <= 25 rows
function sideBySide(gBins, cBins, gN, cN, loCut, hiCut, width = 16) {
  const acc = (bins, from, to) => bins.filter(b => b.from >= from && b.from < to).reduce((a, b) => a + b.count, 0);
  const rows = [];
  rows.push({ lab: `< ${fmt(loCut)}`, from: -Infinity, to: loCut });
  for (let f = loCut; f < hiCut; f += 500) rows.push({ lab: `${fmt(f)}-${fmt(f + 499)}`, from: f, to: f + 500 });
  rows.push({ lab: `>= ${fmt(hiCut)}`, from: hiCut, to: Infinity });
  // each histogram scaled to its own tallest row (shapes comparable, % gives the absolute share)
  const gm = Math.max(...rows.map(r => acc(gBins, r.from, r.to) / gN)), cm = Math.max(...rows.map(r => acc(cBins, r.from, r.to) / cN));
  const bar = (p, m) => { const l = Math.round(p / m * width); return (l === 0 && p > 0 ? '.' : '#'.repeat(l)).padEnd(width); };
  const pc = p => (100 * p).toFixed(1).replace('.', ',').padStart(4);
  const out = [`${'score'.padEnd(12)}| ${('global (' + fmt(gN) + ')').padEnd(width + 7)}| ${('collection (' + fmt(cN) + ')').padEnd(width + 7)}| decks`];
  for (const r of rows) {
    const gp = acc(gBins, r.from, r.to) / gN, cp = acc(cBins, r.from, r.to) / cN;
    const ms = MARK.filter(x => x.s >= r.from && x.s < r.to).sort((a, b) => a.s - b.s);
    const mk = ms.map(x => `${x.name.replace('deck ', '')} ${fmt(x.s)}`).join(' · ');
    out.push(`${r.lab.padEnd(12)}|${bar(gp, gm)} ${pc(gp)} % |${bar(cp, cm)} ${pc(cp)} % | ${mk}`.trimEnd());
  }
  return out.join('\n');
}

const gHistTxt = render(`Distribution GLOBALE : ${fmt(gd.n)} decks aléatoires de 4 cartes parmi 127 (sans talent, sans boutique Tox), classes de 500 pts. Barre = effectif relatif, % = part des decks.`, global.histogram500, gd.n);
const cHistTxt = render(`Distribution COLLECTION : les ${fmt(coll.length)} decks de 4 cartes constructibles avec les 26 cartes possédées (exhaustif), classes de 500 pts.`, collection.histogram500, coll.length, 40, true, true);
// choose cuts for the compact version
const loCut = 2000, hiCut = 10000;
const sbs = sideBySide(global.histogram500, collection.histogram500, gd.n, coll.length, loCut, hiCut);

const legend = 'Marqueurs : ' + Object.entries(decks).map(([k, d]) => `${k} = ${fmt(d.s1)}`).join(' · ') + '\n' +
  `Paliers wiki (sans talent) : C >= ${fmt(tiers.thresholds.C.minScore)} · B >= ${fmt(tiers.thresholds.B.minScore)} · A >= ${fmt(tiers.thresholds.A.minScore)} · S >= ${fmt(tiers.thresholds.S.minScore)} ; indice 0 % = ${fmt(NT.baseline)} (deck aléatoire moyen), 100 % = ${fmt(NT.best)}.`;
fs.writeFileSync(P('spam/stats/histogram.txt'), [gHistTxt, '', cHistTxt, '', "Version compacte côte à côte (classes de 500, queues < 2 000 et >= 10 000 regroupées ; chaque colonne est à l'échelle de sa propre distribution, le % donne la part des decks) :", sbs, '', legend, ''].join('\n'));

const out = {
  generated: new Date().toISOString(), gameVersion: model.version, engineHash: model.engineHash,
  notes: [
    'Scores = modèle théorique du wiki (simulation.js), SANS talent, SANS boutique Tox (evaluate optimize:false, suggestions:false, shop:false).',
    'x1 = model_crit1.json (normal) ; x0 = model_crit0.json (toutes chances/buffs de critique à 0). critShare = 1 - s0/s1.',
    'Les scores avec boutique simulée (ex. 9 393 pour le deck chimere) ne sont PAS comparables à ces scores de base.',
  ],
  global, collection, tiers, bestNoTalent: best, decks,
};
fs.writeFileSync(P('spam/stats/stats.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ global: global.scores, gCrit: global.critShare, collection: collection.scores, cCrit: collection.critShare }, null, 0));
console.log(JSON.stringify(tiers.thresholds), JSON.stringify(tiers.globalMeanVsBaseline), JSON.stringify(tiers.tierCounts_global), JSON.stringify(tiers.tierCounts_collection));
for (const [k, d] of Object.entries(decks)) console.log(k.padEnd(13), d.s1, d.s0, 'crit', (100 * d.critShare).toFixed(1), 'G', JSON.stringify(d.global), 'C', JSON.stringify(d.collection), 'W', JSON.stringify(d.wiki), 'allV2', JSON.stringify(d.allV2), 'critPct', JSON.stringify(d.critSharePct), 'x0', JSON.stringify(d.x0World));
console.log(JSON.stringify(best, null, 0));
