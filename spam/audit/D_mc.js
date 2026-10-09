// Agent D — Monte Carlo of an OPPONENT's Tox shop: P(owns >= 1 copy of Tox X / family F by turn T).
// Shop rules reused from the wiki engine (spam/js/simulation.js): rarity curves `t`, pools `n`, cost map `r`,
// odds function `$e` (copied verbatim below as rarityOdds), shop every 2 turns, 3 offers, 1 purchase per opening,
// reroll 10 then +5, skip +10, luck = startLuck 0 + 1/turn + Chanceur, income = turn number + Σ spamton of living cards.
// Usage: node D_mc.js <N per config> <out.json>
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const C = JSON.parse(fs.readFileSync(path.join(HERE, process.env.CONSTS || 'D_raw/engine_consts_121.json'), 'utf8')); // {e,t,n,r}
const MODEL = JSON.parse(fs.readFileSync(path.join(HERE, process.env.MODEL || 'D_raw/model_121.json'), 'utf8'));
const N = +(process.argv[2] || 20000);
const OUT = process.argv[3] || path.join(HERE, 'D_mc_out.json');

const Q = ['common', 'rare', 'epic', 'legendary'];
// ---- verbatim port of engine Ze (Hermite curve) and $e (rarity odds) ----
function Ze(e, t) { const n = e.length; if (n === 1 || t <= e[0].time) return e[0].value; if (t >= e[n - 1].time) return e[n - 1].value; let r = 0, i = n - 1; for (; i - r > 1;) { const m = r + i >> 1; e[m].time <= t ? r = m : i = m } const a = e[r], o = e[r + 1], s = o.time - a.time; if (s <= 0) return o.value; const c = (t - a.time) / s, l = c * c, u = l * c; return (2 * u - 3 * l + 1) * a.value + (u - 2 * l + c) * s * a.outSlope + (-2 * u + 3 * l) * o.value + (u - l) * s * o.inSlope }
const oddsCache = new Map();
function rarityOdds(luck, lucky) {
  if (lucky) return { common: .25, rare: .25, epic: .25, legendary: .25 };
  const key = Math.round(luck * 10); if (oddsCache.has(key)) return oddsCache.get(key);
  const i = Object.fromEntries(Q.map(q => [q, Math.max(0, Ze(C.t[q], luck))])); const a = Q.reduce((s, q) => s + i[q], 0);
  const o = { common: 0, rare: 0, epic: 0, legendary: 0 };
  if (a <= 0) o.common = 1e3; else for (let e = 0; e < 1e3; e++) { const t = Math.min(Math.max(e / 10, 0), a) * a / 100; t <= i.common ? o.common++ : t <= i.common + i.rare ? o.rare++ : t <= i.common + i.rare + i.epic ? o.epic++ : o.legendary++ }
  const s = Object.fromEntries(Q.map(q => [q, o[q] / 1e3])); oddsCache.set(key, s); return s;
}
// ---- data ----
const POOLS = C.n; const COST = id => C.r[id].cost; const RAR = {};
for (const q of Q) for (const id of POOLS[q]) RAR[id] = q;
const ALL = Q.flatMap(q => POOLS[q]);
const famOf = id => id.replace(/_[CREL]$/, '');
const FAMS = {}; for (const id of ALL) (FAMS[famOf(id)] = FAMS[famOf(id)] || []).push(id);
const LUCKV = { Chance_C: .5, Chance_R: 1, Chance_E: 2, Chance_L: 4 };
const SPAMV = { Spamland_C: 3, Spamland_R: 8, Spamland_E: 24, Spamland_L: 48 }; // real values from the Tox text (engine parses all as 3)
const CARDS = MODEL.cards.map(c => ({ n: c.number, spt: c.spamton, luck: (c.passives || []).filter(p => p.type === 'luck').reduce((s, p) => s + (p.perTurn || 0), 0) }));

// ---- RNG (mulberry32, seeded per config for reproducibility) ----
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
function hashStr(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }

function drawOffer(od, rng) {
  let u = rng(), q = 'legendary';
  if (u < od.common) q = 'common'; else if (u < od.common + od.rare) q = 'rare'; else if (u < od.common + od.rare + od.epic) q = 'epic';
  const pool = POOLS[q]; return pool[Math.floor(rng() * pool.length)];
}
const SHOP_TURNS = [2, 4, 6, 8, 10];
// pol: {buyProb, spend:'random'|'save', reroll:int, lucky:bool, deck:'uniform'|{spt,luck}}
function simulate(targetIds, pol, n, seedKey) {
  const T = new Set(targetIds); const minCost = Math.min(...targetIds.map(COST));
  const rng = mulberry32(hashStr(seedKey));
  const ownedBy = { 2: 0, 4: 0, 6: 0, 8: 0, 10: 0 }; const offeredBy = { 2: 0, 4: 0, 6: 0, 8: 0, 10: 0 };
  let spentOnX = 0, boughtCount = 0;
  for (let s = 0; s < n; s++) {
    let S, luckRate, alive = null;
    if (pol.deck === 'uniform') { // 4 distinct random cards
      const idx = new Set(); while (idx.size < 4) idx.add(Math.floor(rng() * CARDS.length));
      S = 0; luckRate = 1; for (const k of idx) { S += CARDS[k].spt; luckRate += CARDS[k].luck }
      alive = [...idx];
    } else { S = pol.deck.spt; luckRate = 1 + pol.deck.luck }
    let Lacc = 0;
    let B = pol.startSpamton || 0, extraIncome = 0; const boughtLuck = []; let owned = false, offered = false;
    for (let turn = 1; turn <= 10; turn++) {
      // optional: the opponent lost a card during the previous turn -> +50 death bounty to the card's OWNER, its income and luck stop
      if (pol.deaths && alive && pol.deaths.includes(turn) && alive.length > 1) { const j = Math.floor(rng() * alive.length); const k = alive.splice(j, 1)[0]; B += C.e.deathBounty; S -= CARDS[k].spt; luckRate -= CARDS[k].luck }
      Lacc += luckRate; // luck: +1 per turn + innate Chanceur of living cards
      B += turn + S + extraIncome; // income of this turn (engine: turnIncome + Σ card.spamton + spamland)
      if (turn % 2) continue;
      let L = Lacc; for (const b of boughtLuck) L += b.v * (turn - b.k);
      const od = rarityOdds(L, pol.lucky);
      let offers = [drawOffer(od, rng), drawOffer(od, rng), drawOffer(od, rng)];
      let rerolls = 0, done = false;
      while (!done) {
        const tOff = offers.filter(id => T.has(id));
        if (tOff.length) offered = true;
        const tAff = tOff.filter(id => COST(id) <= B);
        if (!owned && tAff.length && rng() < pol.buyProb) {
          tAff.sort((a, b) => COST(b) - COST(a)); const id = tAff[0];
          B -= COST(id); owned = true; spentOnX += COST(id); boughtCount++; done = true; break;
        }
        if (!owned && rerolls < pol.reroll) { const rc = C.e.rerollCost + 5 * rerolls; if (B >= rc + minCost) { B -= rc; rerolls++; offers = [drawOffer(od, rng), drawOffer(od, rng), drawOffer(od, rng)]; continue } }
        // other spending
        if (pol.spend === 'save') { B += C.e.moneyForSkip; done = true; break }
        const aff = offers.filter(id => !T.has(id) && COST(id) <= B);
        if (!aff.length) { B += C.e.moneyForSkip; done = true; break }
        const id = aff[Math.floor(rng() * aff.length)]; B -= COST(id);
        if (LUCKV[id]) boughtLuck.push({ v: LUCKV[id], k: turn });
        if (SPAMV[id]) extraIncome += SPAMV[id];
        done = true;
      }
      if (owned) ownedBy[turn]++;
      if (offered) offeredBy[turn]++;
    }
  }
  const r = x => Math.round(1000 * x / n) / 10; // percent, 1 decimal
  return { owned: Object.fromEntries(SHOP_TURNS.map(t => ['T' + t, r(ownedBy[t])])), offered: Object.fromEntries(SHOP_TURNS.map(t => ['T' + t, r(offeredBy[t])])) };
}
// analytic: P(offered at least once by T) with luck = T, infinite money
function analyticOffered(targetIds, lucky, luckRate = 1) {
  const res = {}; let notYet = 1;
  for (const turn of SHOP_TURNS) {
    const od = rarityOdds(luckRate * turn, lucky); let p = 0; for (const id of targetIds) p += od[RAR[id]] / POOLS[RAR[id]].length;
    notYet *= Math.pow(1 - p, 3); res['T' + turn] = Math.round(1000 * (1 - notYet)) / 10;
  }
  return res;
}

const POLICIES = {
  greedy: { buyProb: 1, spend: 'random', reroll: 0, lucky: false, deck: 'uniform' },
  greedySaver: { buyProb: 1, spend: 'save', reroll: 0, lucky: false, deck: 'uniform' },
  soft: { buyProb: 1 / 3, spend: 'random', reroll: 0, lucky: false, deck: 'uniform' },
  greedyReroll1: { buyProb: 1, spend: 'random', reroll: 1, lucky: false, deck: 'uniform' },
  greedyToxChanceux: { buyProb: 1, spend: 'random', reroll: 0, lucky: true, deck: 'uniform' },
  softToxChanceux: { buyProb: 1 / 3, spend: 'random', reroll: 0, lucky: true, deck: 'uniform' },
  greedyLuck1: { buyProb: 1, spend: 'random', reroll: 0, lucky: false, deck: { spt: 29, luck: 1 } }, // deck with an innate Chanceur R (+1 luck/turn), avg income
};
module.exports = { simulate, analyticOffered, rarityOdds, POLICIES, FAMS, ALL, RAR, COST, CARDS };
if (require.main === module) {
const t0 = Date.now();
const out = { meta: { N, policies: POLICIES, shopTurns: SHOP_TURNS, oddsByLuck: Object.fromEntries([2, 4, 6, 8, 10, 12, 14, 16, 20].map(L => [L, rarityOdds(L, false)])), avgDeckSpamtonPerTurn: 4 * CARDS.reduce((s, c) => s + c.spt, 0) / CARDS.length }, families: {}, ids: {} };
const famList = Object.keys(FAMS).sort();
for (const f of famList) {
  const ids = FAMS[f]; const res = { ids, analyticOffered: analyticOffered(ids, false), analyticOfferedToxChanceux: analyticOffered(ids, true) };
  for (const [pk, pol] of Object.entries(POLICIES)) res[pk] = simulate(ids, pol, N, 'F:' + f + ':' + pk).owned;
  out.families[f] = res;
}
const idPolicies = ['greedy', 'soft', 'greedySaver', 'greedyToxChanceux'];
for (const id of ALL) {
  const res = { rarity: RAR[id], cost: COST(id), analyticOffered: analyticOffered([id], false) };
  for (const pk of idPolicies) res[pk] = simulate([id], POLICIES[pk], Math.max(4000, N >> 1), 'I:' + id + ':' + pk).owned;
  out.ids[id] = res;
}
out.meta.seconds = (Date.now() - t0) / 1000;
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('done in', out.meta.seconds, 's ->', OUT);
}
