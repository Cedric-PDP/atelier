// Agent D — exposure to SETS of threat Tox (any of the set) per player deck, our own odds to be offered counters,
// and deck-level priors for innate carriers (opponent picks 4 cards). Usage: node D_mc_sets.js <N> <out.json>
const fs = require('fs'); const path = require('path');
const M = require('./D_mc.js');
const N = +(process.argv[2] || 40000); const OUT = process.argv[3] || path.join(__dirname, 'D_mc_sets_out.json');
const F = M.FAMS;
const fam = (...fs) => fs.flatMap(f => F[f]);
const sets = {
  // deck chimere [103,238,156,117]: AoE multi-hit + lifesteal sustain + passive-reliant Chimère + all cards <= 650 HP
  chimere_core: fam('PunchingBag', 'Reflect', 'Erosion', 'Frozen', 'Bomba', 'Disparition'),
  chimere_core_plus: fam('PunchingBag', 'Reflect', 'Erosion', 'Frozen', 'Bomba', 'Disparition', 'Taunt', 'Primitive heal', 'Eternity', 'Reset', 'Revenge'),
  // zéro critique [102,116,12,69]: generator engine + single-target + big growing hits + HP-cost Explosion + Scorch 350 HP
  zero_core: fam('Mimetisme', 'Taunt', 'Reflect', 'Shield', 'Bomba', 'Disparition'),
  zero_core_plus: fam('Mimetisme', 'Taunt', 'Reflect', 'Shield', 'Bomba', 'Disparition', 'Brut', 'Tenacite', 'Phoenix', 'Reset', 'Aoe'),
  any_epic_control: fam('Frozen', 'Immunity', 'Bomba', 'Metamorph', 'Reset', 'Vengeur'),
};
const pols = { greedy: M.POLICIES.greedy, soft: M.POLICIES.soft, greedyToxChanceux: M.POLICIES.greedyToxChanceux };
const out = { meta: { N, note: 'opponent = 4 uniform random cards; greedy buys any member of the set when offered & affordable' }, sets: {}, ourCounters: {}, carriers: {} };
for (const [k, ids] of Object.entries(sets)) { out.sets[k] = { families: [...new Set(ids.map(i => i.replace(/_[CREL]$/, '')))] }; for (const [pk, p] of Object.entries(pols)) out.sets[k][pk] = M.simulate(ids, p, N, 'S:' + k + ':' + pk).owned; }
// our own odds of being offered/buying a counter (player decks, 1.21 data: chimere Σspamton 5+5+6+8=24, luck 1/turn; zero 2+3+12+7=24, luck 1.5/turn (Hibernatus Chanceur C))
const decks = { chimere: { spt: 24, luck: 0 }, zero: { spt: 24, luck: 0.5 } }; // 1.21: Murmures spamton 7->2
const counters = { Brut: F.Brut, Immunity: F.Immunity, Frozen: F.Frozen, Tenacite: F.Tenacite, Phoenix: F.Phoenix, Shield: F.Shield };
for (const [dk, d] of Object.entries(decks)) {
  out.ourCounters[dk] = {};
  for (const [ck, ids] of Object.entries(counters)) {
    out.ourCounters[dk][ck] = {
      buyWhenOffered: M.simulate(ids, { buyProb: 1, spend: 'random', reroll: 0, lucky: false, deck: d }, N, 'C:' + dk + ':' + ck + ':0').owned,
      buyWhenOffered_save: M.simulate(ids, { buyProb: 1, spend: 'save', reroll: 0, lucky: false, deck: d }, N, 'C:' + dk + ':' + ck + ':s').owned,
      hunt_1reroll_save: M.simulate(ids, { buyProb: 1, spend: 'save', reroll: 1, lucky: false, deck: d }, N, 'C:' + dk + ':' + ck + ':r1').owned,
      hunt_3rerolls_save: M.simulate(ids, { buyProb: 1, spend: 'save', reroll: 3, lucky: false, deck: d }, N, 'C:' + dk + ':' + ck + ':r3').owned,
    };
  }
}
// carriers: P(opponent deck of 4 distinct uniformly drawn cards contains >= 1 carrier) — card popularity unknown, so uniform only
const model = JSON.parse(fs.readFileSync(path.join(__dirname, 'D_raw/model_121.json'), 'utf8'));
const cards = model.cards.map(c => ({ n: c.number, name: c.name, pas: (c.passives || []).map(p => p.id.replace(/_[CREL]$/, '')) }));
const carrierFams = {}; for (const c of cards) for (const f of new Set(c.pas)) (carrierFams[f] = carrierFams[f] || []).push(c.n);
function comb(n, k) { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r }
for (const [f, list] of Object.entries(carrierFams)) {
  const k = list.length; const pu = 1 - comb(127 - k, 4) / comb(127, 4);
  out.carriers[f] = { cards: list, k, pUniform: Math.round(1000 * pu) / 10 };
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1)); console.log('ok', OUT);
