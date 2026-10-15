// Construit data/reference.json : collections thématiques, natures de tes cartes, étiquettes automatiques,
// seuils de rareté et fréquentation des cartes qui te manquent.
// Usage : node scripts/build_reference.js [--refresh]   (sans --refresh, réutilise cache/ et n'interroge que ce qui manque)
const fs = require('fs');
const path = require('path');
const { sparql, wikiApi, qid, chunks } = require('../lib/net.js');

const ROOT = path.join(__dirname, '..');
const REFRESH = process.argv.includes('--refresh');
const load = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const save = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o)); };
const log = (...a) => console.log(...a);

const RARITIES = ['C', 'PC', 'R', 'SR', 'UR', 'L'];
const FR = '?a schema:about ?item ; schema:isPartOf <https://fr.wikipedia.org/> ; schema:name ?title .';
const DESC = 'OPTIONAL { ?item schema:description ?desc FILTER(LANG(?desc) = "fr") }';

// Liste des membres d'une définition SPARQL (un titre par élément ; l'ordre garde la plus petite valeur).
async function members(where, ord) {
  const rows = await sparql(`SELECT ?item ?title ?desc ?ord WHERE { ${where} ${FR} ${DESC} ${ord || ''} }`);
  const by = new Map();
  for (const r of rows) {
    const id = qid(r.item.value);
    const o = r.ord ? r.ord.value : null;
    const cur = by.get(id);
    if (!cur) by.set(id, { q: id, t: r.title.value, d: r.desc ? r.desc.value : null, o });
    else if (o !== null && (cur.o === null || o < cur.o)) cur.o = o;
  }
  return [...by.values()];
}

function sortMembers(list, ordered) {
  const num = (o) => (o !== null && /^-?[\d.]+(e[+-]?\d+)?$/i.test(o) ? Number(o) : null);
  if (ordered) {
    list.sort((a, b) => {
      if (a.o === null && b.o === null) return a.t.localeCompare(b.t, 'fr');
      if (a.o === null) return 1;
      if (b.o === null) return -1;
      const na = num(a.o), nb = num(b.o);
      return na !== null && nb !== null ? na - nb : String(a.o).localeCompare(String(b.o));
    });
  } else list.sort((a, b) => a.t.localeCompare(b.t, 'fr'));
  return list;
}

async function main() {
  const owned = load(path.join(ROOT, 'data', 'owned.json'), null);
  const wd = load(path.join(ROOT, 'cache', 'wd.json'), null);
  if (!owned || !wd) throw new Error('lancer d\'abord scripts/extract_har.js puis scripts/wikidata.js');
  const cfg = load(path.join(ROOT, 'config', 'themes.json'), null);
  const themeCache = load(path.join(ROOT, 'cache', 'themes.json'), {});
  const pvCache = load(path.join(ROOT, 'cache', 'pv.json'), {});
  const ownedTitles = new Set(owned.cards.map((c) => c.t));

  // 1. Collections thématiques.
  const themes = [];
  for (const th of cfg.themes) {
    const key = th.where + '|' + (th.ord || '');
    if (REFRESH || !themeCache[th.id] || themeCache[th.id].key !== key) {
      themeCache[th.id] = { key, at: new Date().toISOString(), list: await members(th.where, th.ord) };
      save(path.join(ROOT, 'cache', 'themes.json'), themeCache);
    }
    const list = sortMembers(themeCache[th.id].list.map((m) => ({ ...m })), !!th.ord);
    themes.push({ id: th.id, name: th.name, group: th.group, ordered: !!th.ord, list });
    log(`thème ${th.name} : ${list.length} articles, ${list.filter((m) => ownedTitles.has(m.t)).length} possédés`);
  }

  // 2. Métiers et pays des cartes possédées (étiquettes automatiques).
  const ownedIds = [...new Set(owned.cards.map((c) => wd.titles[c.t]).filter(Boolean))];
  const needFacets = ownedIds.filter((id) => REFRESH || !wd.items[id].facets);
  for (const batch of chunks(needFacets, 150)) {
    const rows = await sparql(`SELECT ?item ?p ?v WHERE {
      VALUES ?item { ${batch.map((id) => 'wd:' + id).join(' ')} }
      VALUES ?p { wdt:P106 wdt:P27 wdt:P17 }
      ?item ?p ?v . }`);
    for (const id of batch) wd.items[id].facets = { P106: [], P27: [], P17: [] };
    for (const r of rows) {
      const f = wd.items[qid(r.item.value)].facets;
      const p = qid(r.p.value);
      const v = qid(r.v.value);
      if (f[p] && !f[p].includes(v)) f[p].push(v);
    }
    save(path.join(ROOT, 'cache', 'wd.json'), wd);
  }
  const facetIds = [...new Set(ownedIds.flatMap((id) => Object.values(wd.items[id].facets || {}).flat()))].filter((id) => !(id in wd.labels));
  for (const batch of chunks(facetIds, 300)) {
    const rows = await sparql(`SELECT ?c ?l ?lm WHERE { VALUES ?c { ${batch.map((id) => 'wd:' + id).join(' ')} }
      OPTIONAL { ?c rdfs:label ?l FILTER(LANG(?l) = "fr") }
      OPTIONAL { ?c wdt:P2521 ?lm FILTER(LANG(?lm) = "fr") } }`);
    for (const id of batch) wd.labels[id] = wd.labels[id] || null;
    for (const r of rows) {
      const id = qid(r.c.value);
      if (r.l && !wd.labels[id]) wd.labels[id] = r.l.value;
      // Libellé féminin d'un métier (P2521), pour « actrice », « chanteuse »…
      if (r.lm) (wd.fem ||= {})[id] = r.lm.value;
    }
    save(path.join(ROOT, 'cache', 'wd.json'), wd);
  }

  // 3. Natures des cartes (P31). Compter une grande nature coûte une minute à Wikidata : on demande au plus
  // LIMIT+1 articles. S'il en revient moins, c'est la liste complète (un album) ; sinon la nature est « grande »
  // et son total exact n'est connu que s'il a déjà été compté (wd.natTotals).
  const skip = new Set(cfg.naturesSkip);
  const LIMIT = cfg.naturesFullLimit;
  const natCount = {};
  for (const c of owned.cards) {
    const id = wd.titles[c.t];
    if (!id) continue;
    for (const k of wd.items[id].p31) natCount[k] = (natCount[k] || 0) + 1;
  }
  wd.natTotals ||= {};
  const natures = [];
  for (const [k, n] of Object.entries(natCount).sort((a, b) => b[1] - a[1])) {
    if (n < 2 || skip.has(k)) continue;
    const ck = 'nature:' + k;
    const known = wd.natTotals[k];
    if (typeof known !== 'number' || known <= LIMIT) {
      if (REFRESH || !themeCache[ck]) {
        let list = null;
        try {
          const rows = await sparql(`SELECT ?item ?title ?desc WHERE { { SELECT ?item ?title WHERE { ?item wdt:P31 wd:${k} . ${FR} } LIMIT ${LIMIT + 1} } ${DESC} }`);
          const by = new Map();
          for (const r of rows) { const id = qid(r.item.value); if (!by.has(id)) by.set(id, { q: id, t: r.title.value, d: r.desc ? r.desc.value : null, o: null }); }
          list = [...by.values()];
        } catch (e) {
          list = null;
        }
        themeCache[ck] = { key: k, at: new Date().toISOString(), list, big: !!list && list.length > LIMIT };
        save(path.join(ROOT, 'cache', 'themes.json'), themeCache);
      }
    }
    const cached = themeCache[ck];
    const big = typeof known === 'number' ? known > LIMIT : !cached || !cached.list || cached.big;
    const nat = { id: k, name: wd.labels[k] || k, owned: n, total: typeof known === 'number' ? known : big ? null : cached.list.length };
    if (!big) nat.list = sortMembers(cached.list.map((m) => ({ ...m })), false);
    natures.push(nat);
    log(`nature ${nat.name} : ${n} possédées sur ${nat.total ?? 'plus de ' + LIMIT}${nat.list ? ' (album)' : ''}`);
  }

  // 4. Fréquentation sur 30 jours des articles qui te manquent : lue dans cache/pv.json, que remplit
  // scripts/pageviews.js (lent : Wikipédia limite le débit). Sans elle, la rareté estimée reste « ? ».
  let wanted = 0, known = 0;
  for (const list of [...themes.map((t) => t.list), ...natures.map((n) => n.list || [])]) {
    for (const m of list) if (!ownedTitles.has(m.t)) { wanted++; if (typeof pvCache[m.t] === 'number') known++; }
  }
  log(`fréquentation connue pour ${known} des ${wanted} cartes manquantes (scripts/pageviews.js pour compléter)`);

  // 5. Seuils de rareté, déduits de tes cartes (vues mensuelles enregistrées par le jeu).
  const byR = {};
  for (const c of owned.cards) if (c.pv !== null && c.r) (byR[c.r] ||= []).push(c.pv);
  const calibration = {};
  for (const r of RARITIES) {
    const v = (byR[r] || []).sort((a, b) => a - b);
    calibration[r] = v.length ? { n: v.length, min: v[0], med: v[Math.floor(v.length / 2)], max: v[v.length - 1] } : { n: 0 };
  }
  // Seuils retenus : nombres ronds compatibles avec tes cartes (à revoir quand la collection grandit).
  const thresholds = { PC: 50, R: 250, SR: 1000, UR: 5000, L: 20000 };

  // 6. Étiquettes automatiques des cartes possédées.
  const fem = wd.fem || {};
  const label = (id) => wd.labels[id];
  const tags = {};
  for (const c of owned.cards) {
    const id = wd.titles[c.t];
    if (!id) continue;
    const it = wd.items[id];
    const f = it.facets || {};
    const isHuman = it.p31.includes('Q5');
    const desc = (c.c || '').toLowerCase();
    const female = isHuman && /^(une |la )?[a-zéèêàç-]+(euse|rice|ienne|ète|ère|esse|ive|ante|ine|enne)\b/.test(desc);
    tags[c.t] = {
      q: id,
      n: [...new Set(it.p31.map(label).filter(Boolean))],
      m: [...new Set((f.P106 || []).map((m) => (female && fem[m]) || label(m)).filter(Boolean))].slice(0, 4),
      p: [...new Set([...(f.P27 || []), ...(f.P17 || [])].map(label).filter(Boolean))].slice(0, 3),
      sl: it.sl || 0,
    };
  }

  // 7. Catégories fines (scripts/refine.js) : natures sans leurs superclasses, groupes d'espèces, genres, lieux,
  // et petits albums construits autour des cartes possédées (films d'un réalisateur, communes d'un département…).
  const refined = load(path.join(ROOT, 'data', 'refined.json'), null);
  if (refined) {
    for (const [t, r] of Object.entries(refined.tags || {})) {
      if (!tags[t]) continue;
      if (Array.isArray(r.n) && r.n.length) tags[t].n = r.n;
      if (Array.isArray(r.g) && r.g.length) tags[t].g = r.g;
      if (Array.isArray(r.l) && r.l.length) tags[t].l = r.l;
    }
  }
  const fine = refined && Array.isArray(refined.albums) ? refined.albums : [];

  const pack = (list) => list.map((m) => [m.t, m.d, ownedTitles.has(m.t) ? null : pvCache[m.t] ?? null]);
  const ref = {
    builtAt: new Date().toISOString(),
    ownedAt: owned.extractedAt,
    thresholds,
    calibration,
    groups: cfg.groups,
    themes: themes.map((th) => ({ id: th.id, name: th.name, group: th.group, ordered: th.ordered, members: pack(th.list) })),
    natures: natures.map((n) => ({ id: n.id, name: n.name, total: n.total, members: n.list ? pack(n.list) : null })),
    fine: fine.map((a) => ({ id: a.id, name: a.name, basis: a.basis, members: pack(a.members.map(([t, d]) => ({ t, d }))) })),
    tags,
  };
  save(path.join(ROOT, 'data', 'reference.json'), ref);
  const size = fs.statSync(path.join(ROOT, 'data', 'reference.json')).size;
  log(`data/reference.json : ${themes.length} thèmes, ${natures.length} natures, ${Object.keys(tags).length} cartes étiquetées, ${(size / 1024).toFixed(0)} Ko`);
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
