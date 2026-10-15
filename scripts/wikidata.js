// Relie chaque carte possédée à Wikidata : élément (Q…), nature (P31) et nombre de Wikipédias (popularité).
// Usage : node scripts/wikidata.js   (lit data/owned.json, complète cache/wd.json, n'interroge que ce qui manque)
const fs = require('fs');
const path = require('path');
const { sparql, wikiApi, qid, chunks } = require('../lib/net.js');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'cache', 'wd.json');
const load = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const save = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o)); };

async function main() {
  const owned = load(path.join(ROOT, 'data', 'owned.json'), null);
  if (!owned) throw new Error('data/owned.json manquant : lancer scripts/extract_har.js');
  const cache = load(CACHE, { titles: {}, items: {}, labels: {} });

  // 1. Titre -> élément Wikidata (suit les renommages de pages).
  const todo = owned.cards.map((c) => c.t).filter((t) => !(t in cache.titles));
  for (const batch of chunks(todo, 50)) {
    const j = await wikiApi({ action: 'query', titles: batch.join('|'), redirects: '1', prop: 'pageprops', ppprop: 'wikibase_item' });
    const q = j.query || {};
    const alias = {};
    for (const n of q.normalized || []) alias[n.from] = n.to;
    for (const r of q.redirects || []) alias[r.from] = r.to;
    const byTitle = {};
    for (const p of q.pages || []) byTitle[p.title] = p.pageprops?.wikibase_item || null;
    for (const t of batch) {
      let cur = t;
      for (let i = 0; i < 3 && alias[cur]; i++) cur = alias[cur];
      cache.titles[t] = byTitle[cur] ?? null;
    }
    save(CACHE, cache);
    process.stdout.write(`titres ${Object.keys(cache.titles).length}/${owned.cards.length}\r`);
  }
  console.log();

  // 2. Élément -> natures (P31), description, nombre de Wikipédias.
  const ids = [...new Set(Object.values(cache.titles).filter(Boolean))].filter((id) => !cache.items[id]);
  for (const batch of chunks(ids, 200)) {
    const rows = await sparql(`SELECT ?item ?class ?sl WHERE {
      VALUES ?item { ${batch.map((id) => 'wd:' + id).join(' ')} }
      OPTIONAL { ?item wdt:P31 ?class }
      OPTIONAL { ?item wikibase:sitelinks ?sl }
    }`);
    for (const id of batch) cache.items[id] = { p31: [], sl: 0 };
    for (const r of rows) {
      const it = cache.items[qid(r.item.value)];
      if (r.class) { const c = qid(r.class.value); if (!it.p31.includes(c)) it.p31.push(c); }
      if (r.sl) it.sl = Number(r.sl.value);
    }
    save(CACHE, cache);
    process.stdout.write(`éléments ${Object.keys(cache.items).length}\r`);
  }
  console.log();

  // 3. Libellés français des natures rencontrées.
  const classes = [...new Set(Object.values(cache.items).flatMap((i) => i.p31))].filter((c) => !(c in cache.labels));
  for (const batch of chunks(classes, 300)) {
    const rows = await sparql(`SELECT ?c ?l WHERE { VALUES ?c { ${batch.map((id) => 'wd:' + id).join(' ')} }
      OPTIONAL { ?c rdfs:label ?l FILTER(LANG(?l) = "fr") } }`);
    for (const id of batch) cache.labels[id] = cache.labels[id] || null;
    for (const r of rows) if (r.l) cache.labels[qid(r.c.value)] = r.l.value;
    save(CACHE, cache);
  }

  const missing = owned.cards.filter((c) => !cache.titles[c.t]).map((c) => c.t);
  console.log(`${owned.cards.length - missing.length} cartes reliées à Wikidata, ${missing.length} sans élément`);
  if (missing.length) console.log('sans élément :', missing.slice(0, 20).join(' | '));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
