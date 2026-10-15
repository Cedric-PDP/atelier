// Relève les vues sur 30 jours des cartes manquantes (data/reference.json) dans cache/pv.json.
// Lent par construction : Wikipédia limite le débit (réponse 429 + Retry-After) ; le script attend ce qu'on lui
// demande, ralentit après chaque refus et reprend où il en était. Les thèmes passent avant les natures.
// Usage : node scripts/pageviews.js [--max-minutes=N]   puis build_reference.js + build_page.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UA = 'WikiMastersCollections/0.1 (outil personnel de suivi de collection, faible volume)';
const PV = path.join(ROOT, 'cache', 'pv.json');
const maxMin = Number((process.argv.find((a) => a.startsWith('--max-minutes=')) || '=0').split('=')[1]) || 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const ref = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'reference.json'), 'utf8'));
  const pv = fs.existsSync(PV) ? JSON.parse(fs.readFileSync(PV, 'utf8')) : {};
  const order = [];
  const seen = new Set();
  for (const list of [...ref.themes.map((t) => t.members), ...(ref.fine || []).map((a) => a.members), ...ref.natures.map((n) => n.members || [])]) {
    for (const [t, , v] of list) {
      // v === null et absent du cache : manquante et jamais relevée (les possédées ont leurs vues dans la carte).
      if (!seen.has(t) && (!(t in pv) || pv[t] === null) && v === null && !ref.tags[t]) { seen.add(t); order.push(t); }
    }
  }
  console.log(`${order.length} articles à relever`);
  const t0 = Date.now();
  let gap = 2000;
  let done = 0;
  for (let i = 0; i < order.length; ) {
    if (maxMin && Date.now() - t0 > maxMin * 60000) break;
    const batch = order.slice(i, i + 50);
    // L'API rend les vues par morceaux (pvipcontinue) : on suit la continuation jusqu'au bout du lot.
    const got = {};
    let cont = {};
    let refused = false;
    for (let guard = 0; guard < 30; guard++) {
      const url = 'https://fr.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'query', prop: 'pageviews', pvipdays: '30', titles: batch.join('|'), redirects: '1', format: 'json', formatversion: '2', ...cont });
      let res;
      try { res = await fetch(url, { headers: { 'User-Agent': UA } }); } catch (e) { refused = true; await sleep(15000); break; }
      if (res.status === 429 || res.status >= 500) {
        const wait = (Number(res.headers.get('retry-after')) || 30) * 1000 + 1000;
        gap = Math.min(Math.round(gap * 1.5), 35000);
        await sleep(wait);
        guard--;
        continue;
      }
      const j = await res.json();
      const q = j.query || {};
      const alias = {};
      for (const n of q.normalized || []) alias[n.to] = n.from;
      for (const r of q.redirects || []) alias[r.to] = alias[r.from] || r.from;
      for (const p of q.pages || []) {
        if (!p.pageviews) continue;
        const src = alias[p.title] || p.title;
        got[src] = (got[src] || 0) + Object.values(p.pageviews).reduce((s, x) => s + (x || 0), 0);
      }
      if (!j.continue) break;
      cont = j.continue;
      await sleep(gap);
    }
    if (refused) continue;
    for (const t of batch) pv[t] = t in got ? got[t] : null;
    fs.writeFileSync(PV, JSON.stringify(pv));
    i += batch.length;
    done += batch.length;
    gap = Math.max(2000, Math.round(gap * 0.9));
    console.log(`${done}/${order.length} (pause ${Math.round(gap / 1000)} s)`);
    await sleep(gap);
  }
  console.log(`FIN : ${done} relevés`);
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
