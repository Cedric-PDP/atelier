// Agent D — sensitivity: the opponent loses a card at the end of turns 5 and 8 (death bounty +50 each to the OWNER,
// that card's income/luck stop). Merges greedyDeaths/softDeaths into D_mc_out.json families. Usage: node D_mc_deaths.js <N>
const fs = require('fs'); const path = require('path'); const M = require('./D_mc.js');
const N = +(process.argv[2] || 40000); const f = path.join(__dirname, 'D_mc_out.json'); const out = JSON.parse(fs.readFileSync(f, 'utf8'));
const G = { ...M.POLICIES.greedy, deaths: [6, 9] }, S = { ...M.POLICIES.soft, deaths: [6, 9] };
for (const fam of Object.keys(out.families)) { const ids = out.families[fam].ids; out.families[fam].greedyDeaths = M.simulate(ids, G, N, 'D:' + fam + ':g').owned; out.families[fam].softDeaths = M.simulate(ids, S, N, 'D:' + fam + ':s').owned; }
out.meta.policies.greedyDeaths = G; out.meta.policies.softDeaths = S;
fs.writeFileSync(f, JSON.stringify(out, null, 1)); console.log('merged');
