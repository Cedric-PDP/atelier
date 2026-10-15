// Test « élargir » : les catégories Wikipédia de tes cartes (des ensembles faits par des humains : « Métal
// alcalin », « Race bovine originaire de France »…), puis leurs catégories parentes, avec la part que tu en possèdes.
// Usage : node scripts/categories.js [--seuil=0.1] [--min=10] [--parents]
//   --seuil : part minimale possédée (0,1 = 10 %) ; --min : taille minimale d'une catégorie (sinon 1 carte sur 3 suffit) ;
//   --parents : remonte d'un niveau (catégories parentes, taille comptée sur un niveau de sous-catégories).
// Écrit data/categories_test.json ; cache dans cache/cats.json.
const fs = require('fs');
const path = require('path');
const { wikiApiAll, chunks } = require('../lib/net.js');

const ROOT = path.join(__dirname, '..');
const arg = (name, d) => { const a = process.argv.find((x) => x.startsWith('--' + name + '=')); return a ? Number(a.split('=')[1]) : d; };
const SEUIL = arg('seuil', 0.1);
const MIN = arg('min', 10);
const PARENTS = process.argv.includes('--parents');
const CACHE = path.join(ROOT, 'cache', 'cats.json');
const load = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const save = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o)); };
const NS = 'Catégorie:';
// Catégories de rangement plutôt que de contenu : pas des collections.
const NOISE = /^Catégorie:(Naissance|Décès|Page |Article |Portail|Wikipédia|Projet|Ébauche|Homonymie|Liste |Catégorie |Personnalité |Personnes? |\d)/;

function aliasMap(q) {
  const alias = {};
  for (const n of q.normalized || []) alias[n.to] = n.from;
  for (const r of q.redirects || []) alias[r.to] = alias[r.from] || r.from;
  return alias;
}

async function categoriesOf(titles, store, label) {
  const todo = titles.filter((t) => !(t in store));
  let done = 0;
  for (const batch of chunks(todo, 50)) {
    const got = {};
    await wikiApiAll({ action: 'query', prop: 'categories', clshow: '!hidden', cllimit: 'max', titles: batch.join('|'), redirects: '1' }, (j) => {
      const q = j.query || {};
      const alias = aliasMap(q);
      for (const p of q.pages || []) {
        const src = alias[p.title] || p.title;
        for (const c of p.categories || []) (got[src] ||= new Set()).add(c.title);
      }
    });
    for (const t of batch) store[t] = got[t] ? [...got[t]] : [];
    done += batch.length;
    process.stdout.write(`${label} ${done}/${todo.length}\r`);
  }
  if (todo.length) console.log();
}

async function infoOf(cats, info) {
  const todo = cats.filter((c) => !(c in info));
  let done = 0;
  for (const batch of chunks(todo, 50)) {
    await wikiApiAll({ action: 'query', prop: 'categoryinfo', titles: batch.join('|') }, (j) => {
      for (const p of (j.query || {}).pages || []) info[p.title] = { pages: p.categoryinfo ? p.categoryinfo.pages : 0, subcats: p.categoryinfo ? p.categoryinfo.subcats : 0 };
    });
    for (const c of batch) if (!(c in info)) info[c] = { pages: 0, subcats: 0 };
    done += batch.length;
    process.stdout.write(`tailles ${done}/${todo.length}\r`);
  }
  if (todo.length) console.log();
}

async function main() {
  const owned = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'owned.json'), 'utf8'));
  const cache = load(CACHE, { art: {}, info: {}, parents: {}, subs: {} });
  const titles = owned.cards.map((c) => c.t);

  // 1. Catégories de chaque carte, et leur taille (nombre d'articles directement dedans).
  await categoriesOf(titles, cache.art, 'cartes');
  save(CACHE, cache);
  const members = {};
  for (const t of titles) for (const c of cache.art[t] || []) if (!NOISE.test(c)) (members[c] ||= []).push(t);
  const l1 = Object.keys(members);
  await infoOf(l1, cache.info);
  save(CACHE, cache);

  const rows = l1.map((c) => ({ cat: c.slice(NS.length), owned: members[c].length, size: Math.max(cache.info[c].pages, members[c].length), cards: members[c] }))
    .map((r) => ({ ...r, ratio: r.owned / r.size }));
  const pick = (list) => list.filter((r) => r.size >= MIN && r.ratio >= SEUIL).sort((a, b) => b.ratio - a.ratio || b.owned - a.owned);
  const n1 = pick(rows);
  console.log(`\nNIVEAU 1 : ${l1.length} catégories touchées par tes cartes ; ${n1.length} de ${MIN} articles ou plus où tu en as au moins ${Math.round(SEUIL * 100)} %`);
  for (const [lo, hi] of [[0.1, 1.01], [0.05, 0.1], [0.02, 0.05], [0.01, 0.02]]) {
    console.log(`  ${Math.round(lo * 100)} % à ${hi > 1 ? '100' : Math.round(hi * 100)} % : ${rows.filter((r) => r.size >= MIN && r.ratio >= lo && r.ratio < hi).length} catégories`);
  }
  const multi = rows.filter((r) => r.owned >= 2).sort((a, b) => b.ratio - a.ratio);
  console.log(`  dont avec au moins 2 de tes cartes : ${pick(multi).length}`);

  const result = { seuil: SEUIL, min: MIN, level1: n1, level1multi: multi.slice(0, 60) };

  // 2. Élargir : catégories parentes. Taille = articles directs + articles de ses sous-catégories (un niveau).
  if (PARENTS) {
    await categoriesOf(l1, cache.parents, 'parents');
    save(CACHE, cache);
    const under = {};
    for (const c of l1) for (const p of cache.parents[c] || []) if (!NOISE.test(p)) for (const t of members[c]) (under[p] ||= new Set()).add(t);
    // Candidats : au moins 2 de tes cartes en dessous (sinon c'est le niveau 1 en plus grand).
    const cand = Object.keys(under).filter((p) => under[p].size >= 2);
    console.log(`\nNIVEAU 2 : ${Object.keys(under).length} catégories parentes, ${cand.length} avec au moins 2 de tes cartes`);
    let k = 0;
    for (const p of cand) {
      if (!cache.subs[p]) {
        const subs = [];
        await wikiApiAll({ action: 'query', list: 'categorymembers', cmtitle: p, cmtype: 'subcat', cmlimit: 'max' }, (j) => { for (const m of (j.query || {}).categorymembers || []) subs.push(m.title); });
        cache.subs[p] = subs;
        if (++k % 20 === 0) save(CACHE, cache);
      }
    }
    save(CACHE, cache);
    await infoOf([...new Set([...cand, ...cand.flatMap((p) => cache.subs[p] || [])])], cache.info);
    save(CACHE, cache);
    const rows2 = cand.map((p) => {
      const size = (cache.info[p] ? cache.info[p].pages : 0) + (cache.subs[p] || []).reduce((s, c) => s + (cache.info[c] ? cache.info[c].pages : 0), 0);
      const own = under[p].size;
      return { cat: p.slice(NS.length), owned: own, size: Math.max(size, own), subcats: (cache.subs[p] || []).length, cards: [...under[p]] };
    }).map((r) => ({ ...r, ratio: r.owned / r.size }));
    const n2 = pick(rows2);
    console.log(`  ${n2.length} catégories parentes où tu as au moins ${Math.round(SEUIL * 100)} %`);
    for (const [lo, hi] of [[0.1, 1.01], [0.05, 0.1], [0.02, 0.05], [0.01, 0.02]]) {
      console.log(`  ${Math.round(lo * 100)} % à ${hi > 1 ? '100' : Math.round(hi * 100)} % : ${rows2.filter((r) => r.size >= MIN && r.ratio >= lo && r.ratio < hi).length}`);
    }
    result.level2 = n2;
    result.level2near = rows2.filter((r) => r.size >= MIN && r.ratio >= 0.03 && r.ratio < SEUIL).sort((a, b) => b.ratio - a.ratio).slice(0, 60);
  }
  save(path.join(ROOT, 'data', 'categories_test.json'), result);
  console.log('-> data/categories_test.json');
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
