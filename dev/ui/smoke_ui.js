// Fait tourner l'interface du classeur (site/public) dans un faux DOM avec la vraie version d'exécution de Vue,
// une API simulée (ou le serveur local avec --server=http://localhost:8788) et Wikipédia/Wikidata simulés.
// Usage : node smoke_ui.js <site/public> <vue.runtime.global.prod.min.js> [--server=URL]   -> doit finir par UI OK
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeDom } = require('./fakedom.js');

const PUB = process.argv[2];
const VUE = process.argv[3];
const SERVER = (process.argv.find((a) => a.startsWith('--server=')) || '').slice(9) || null;
const ORIGIN = 'https://classeur.example';
const fail = (m) => { console.error('ÉCHEC :', m); process.exit(1); };
const check0 = (c, m) => { if (!c) fail(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ API simulée (contrat SPEC.md), plusieurs comptes
// Clés de 43 caractères comme les vraies ; `api.st` = le premier compte (celui que crée le parcours).
// Révision des cartes par compte (`rev`, `changed` : carte -> révision de son dernier changement, retrait compris) :
// GET /api/cards?since=R, `rev` des pages, `cards_rev` de GET /api/me. `api.noRev = true` : ancien serveur (sans rien de cela).
function mockApi() {
  const users = [];
  const calls = [];
  let seq = 0;
  const mk = (p) => (p + '_'.repeat(43)).slice(0, 43);
  const json = (status, body) => ({ status, body });
  function makeUser(name) {
    const u = { id: 'u' + ++seq, key: mk('cle' + seq), importKey: null, name: name || null, cards: [], tags: new Map(), targets: [], fetched_at: null,
      new_ids: [], cookie: false, expired: false, uploads: new Map(), calls, rev: 1, changed: new Map() };
    users.push(u);
    return u;
  }
  // Comme le serveur : la révision n'avance que si une carte change (un envoi identique ne change que fetched_at).
  const bump = (st, ids) => { if (!ids.length) return; st.rev++; for (const id of ids) st.changed.set(id, st.rev); };
  function importCards(st, list, stats) {
    const before = new Map(st.cards.map((c) => [c.id, JSON.stringify(c)]));
    const first = st.fetched_at === null;
    const now = new Set(list.map((c) => c.id));
    bump(st, [...list.filter((c) => before.get(c.id) !== JSON.stringify(c)).map((c) => c.id), ...[...before.keys()].filter((id) => !now.has(id))]);
    st.cards = list;
    st.fetched_at = new Date().toISOString();
    st.new_ids = first ? [] : list.filter((c) => !before.has(c.id)).map((c) => c.id);
    return { count: list.length, new_ids: st.new_ids, complete: stats ? stats.totalUnique === list.length : null };
  }
  const self = {
    noRev: false,
    calls,
    get st() { return users[0]; },
    users,
    makeUser,
    handle(method, p, headers, body) {
      calls.push([method, p, body]);
      if (p === '/api/health') return json(200, { ok: true, db: true, cookie_secret: true, signup_open: true });
      if (p === '/api/account' && method === 'POST') {
        if (body.code !== 'dev') return json(403, { error: "Code d'invitation incorrect." });
        const u = makeUser(body.name);
        return json(201, { key: u.key, user: { id: u.id, name: u.name } });
      }
      const key = headers['X-Classeur-Key'];
      let st = users.find((u) => u.key === key);
      // Seul /api/import accepte aussi la clé d'import (celle du favori).
      if (!st && p === '/api/import') st = users.find((u) => u.importKey && u.importKey === key);
      if (!st) return json(401, { error: key ? 'Clé inconnue : ce classeur a peut-être été supprimé.' : 'Clé absente : ouvre ton lien personnel du classeur.' });
      const cardOut = (c) => ({ ...c, tags: st.tags.get(c.id) || [] });
      if (p === '/api/me' && method === 'GET') {
        return json(200, { user: { id: st.id, name: st.name, created_at: 'x' }, fetched_at: st.fetched_at, card_count: st.cards.length, new_ids: st.new_ids,
          has_import_key: !!st.importKey, prefs: st.prefs || {}, session: { has_cookie: st.cookie, expired: st.expired, updated_at: st.cookie ? '2026-10-15T10:00:00Z' : null },
          ...(self.noRev ? {} : { cards_rev: st.rev }) });
      }
      if (p === '/api/me' && method === 'PATCH') {
        if ('prefs' in body) {
          if (!body.prefs || typeof body.prefs !== 'object' || JSON.stringify(body.prefs).length > 4096) return json(400, { error: 'Préférences invalides.' });
          st.prefs = body.prefs;
        }
        if ('name' in body) st.name = body.name;
        return json(200, { user: { id: st.id, name: st.name }, prefs: st.prefs || {} });
      }
      if (p === '/api/me' && method === 'DELETE') { users.splice(users.indexOf(st), 1); return json(200, { ok: true }); }
      if (p === '/api/import-key' && method === 'POST') { st.importKey = mk('import' + ++seq); return json(200, { import_key: st.importKey }); }
      if (p === '/api/key/rotate' && method === 'POST') { st.key = mk('tourne' + ++seq); return json(200, { key: st.key }); }
      if (p === '/api/cards' || p.startsWith('/api/cards?')) {
        // Lecture par morceaux comme le vrai serveur, avec un curseur opaque (chaîne) : 400 cartes par morceau ici.
        const sp = new URL('http://x' + p).searchParams;
        const q = sp.get('part');
        const rev = self.noRev ? {} : { rev: st.rev };
        const since = self.noRev ? null : sp.get('since');
        if (since !== null) {
          // Ce qui a changé depuis R ; delta:false si R est inconnue (plus grande que la révision : base recréée) ou s'il
          // y a plus de 1 000 changements.
          if (!/^\d+$/.test(since)) return json(400, { error: 'Révision invalide.' });
          const R = Number(since);
          if (R > st.rev) return json(200, { rev: st.rev, delta: false });
          const ids = [...st.changed].filter(([, r]) => r > R).map(([id]) => id);
          if (ids.length > 1000) return json(200, { rev: st.rev, delta: false });
          const present = new Map(st.cards.map((c) => [c.id, c]));
          return json(200, { rev: st.rev, delta: true, cards: ids.filter((id) => present.has(id)).map((id) => cardOut(present.get(id))),
            gone: ids.filter((id) => !present.has(id)), fetched_at: st.fetched_at, new_ids: st.new_ids });
        }
        const all = st.cards.map(cardOut);
        if (q === null) return json(200, { ...rev, fetched_at: st.fetched_at, cards: all, new_ids: st.new_ids });
        const n = q === '0' ? 0 : Number(String(q).replace(/^curseur-/, ''));
        if (!Number.isInteger(n)) return json(400, { error: 'curseur invalide' });
        const size = 400, last = Math.max(0, Math.ceil(all.length / size) - 1);
        calls.push('cards part ' + q);
        return json(200, { ...rev, fetched_at: st.fetched_at, cards: all.slice(n * size, (n + 1) * size), new_ids: st.new_ids, part: q, next_part: n < last ? 'curseur-' + (n + 1) : null });
      }
      if (p === '/api/import' && body.mode === 'state') return json(200, { quick: false, last_at: null, full_at: null });
      if (p === '/api/import') {
        const u = st.uploads.get(body.upload_id) || { parts: [], stats: null };
        st.uploads.set(body.upload_id, u);
        u.parts[body.part] = body.cards;
        if (body.stats) u.stats = body.stats;
        st.lastImportKey = key;
        if (!body.last) return json(200, { ok: true, received: u.parts.flat().length });
        return json(200, importCards(st, u.parts.flat(), u.stats));
      }
      if (p === '/api/session' && method === 'POST') { if (!body.cookie && !body.har) return json(400, { error: 'Cookie manquant.' }); st.cookie = true; st.expired = false; st.lastSession = body; return json(200, { ok: true }); }
      if (p === '/api/session' && method === 'DELETE') { st.cookie = false; return json(200, { ok: true }); }
      if (p === '/api/refresh') {
        if (!st.cookie) return json(401, { error: "Aucune session WikiMasters : colle d'abord ton cookie.", needs_session: true });
        if (body.page < 20) return json(200, { done: false, next_page: body.page + 10, fetched: (body.page + 10) * 50, total: 1500 });
        const list = st.cards.filter((c) => c.id !== 'new1').concat([{ id: 'new1', title: 'Nouvelle carte', rarity: 'SR', atk: 5, def: 6, quality: 1, pageviews: 3000, category: 'test', image: null, url: null, count: 1, shiny: true, starred: false, obtained_at: '2026-10-15T09:00:00Z' }]);
        return json(200, { done: true, ...importCards(st, list, { totalUnique: list.length + 1 }), skipped: 2 });
      }
      if (p === '/api/tags/set') { st.tags.set(body.card_id, body.tags); bump(st, [body.card_id]); return json(200, { tags: body.tags }); }
      if (p === '/api/tags/bulk') {
        if (body.add.includes('QUOTA')) return json(503, { error: 'La base du classeur est pleine pour aujourd\'hui (quota gratuit atteint) : réessaie demain.' });
        for (const id of body.card_ids) { let t = st.tags.get(id) || []; t = t.filter((x) => !body.remove.includes(x)); for (const a of body.add) if (!t.includes(a)) t.push(a); st.tags.set(id, t); }
        bump(st, body.card_ids);
        return json(200, { ok: true });
      }
      if (p === '/api/tags/rename') {
        const ids = [...st.tags].filter(([, t]) => t.includes(body.from)).map(([id]) => id);
        for (const [id, t] of st.tags) st.tags.set(id, [...new Set(t.map((x) => (x === body.from ? body.to : x)))]);
        bump(st, ids);
        return json(200, { ok: true });
      }
      if (p === '/api/targets') return json(200, { targets: st.targets });
      if (p === '/api/targets/save') {
        if (!Array.isArray(body.items) || !body.items.every((i) => typeof i.title === 'string' && ['ok', 'missing', 'disambiguation'].includes(i.status))) return json(400, { error: 'items invalides' });
        let t = body.id ? st.targets.find((x) => x.id === body.id) : null;
        if (!t) { t = { id: 't' + (st.targets.length + 1), created_at: 'x' }; st.targets.push(t); }
        Object.assign(t, { name: body.name, items: body.items, source: body.source || null, updated_at: 'y' });
        return json(200, { target: t });
      }
      if (p === '/api/targets/delete') { st.targets = st.targets.filter((x) => x.id !== body.id); return json(200, { ok: true }); }
      return json(404, { error: 'introuvable' });
    },
  };
  return self;
}

// ------------------------------------------------------------------ IndexedDB simulé (ce que lit le cache des cartes)
// Un seul pour tout le test : les pages ouvertes l'une après l'autre sont celles d'un même navigateur. Valeurs copiées
// comme par le vrai (structuredClone), requêtes et fin de transaction asynchrones, dans l'ordre de création.
function fakeIndexedDB() {
  const dbs = new Map();
  const later = (f) => setTimeout(f, 0);
  function makeDb(d) {
    return {
      createObjectStore(n) { if (!d.stores.has(n)) d.stores.set(n, new Map()); return {}; },
      close() {},
      transaction(name, mode) {
        const store = d.stores.get(name);
        if (!store) throw new Error('NotFoundError : ' + name);
        const tx = { oncomplete: null, onerror: null, onabort: null };
        let pending = 0;
        let ended = false;
        const end = () => later(() => { if (!pending && !ended) { ended = true; if (tx.oncomplete) tx.oncomplete({ target: tx }); } });
        const op = (write, fn) => {
          if (ended) throw new Error('TransactionInactiveError');
          if (write && mode !== 'readwrite') throw new Error('ReadOnlyError');
          const rq = { result: undefined, onsuccess: null, onerror: null };
          pending++;
          later(() => { rq.result = fn(); if (rq.onsuccess) rq.onsuccess({ target: rq }); pending--; end(); });
          return rq;
        };
        tx.objectStore = () => ({
          get: (k) => op(false, () => (store.has(k) ? structuredClone(store.get(k)) : undefined)),
          getAll: () => op(false, () => [...store.values()].map((v) => structuredClone(v))),
          put: (v, k) => { const c = structuredClone(v); return op(true, () => { store.set(k, c); return k; }); },
          delete: (k) => op(true, () => { store.delete(k); }),
          clear: () => op(true, () => { store.clear(); }),
        });
        end();
        return tx;
      },
    };
  }
  return {
    open(name, version) {
      const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      later(() => {
        let d = dbs.get(name);
        if (!d) { d = { version: 0, stores: new Map() }; dbs.set(name, d); }
        req.result = makeDb(d);
        if ((version || 1) > d.version) { d.version = version || 1; if (req.onupgradeneeded) req.onupgradeneeded({ target: req }); }
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
    // Pour les vérifications : les enregistrements du magasin `store` (copie), ou null.
    dump(name, store) { const d = dbs.get(name); return d && d.stores.get(store) ? new Map(d.stores.get(store)) : null; },
    wipe(name, store, key) { const d = dbs.get(name); if (d && d.stores.get(store)) d.stores.get(store).delete(key); },
  };
}

// ------------------------------------------------------------------ Wikipédia et Wikidata simulés
const WIKI = {
  Zeus: { q: 'Q34201', desc: 'dieu grec', thumb: 'https://upload.wikimedia.org/z.jpg', pv: 40000 },
  'Héra': { q: 'Q38012', desc: 'déesse grecque', pv: 3000 },
  'Poséidon': { q: 'Q41127', desc: 'dieu grec de la mer', pv: 800 },
  Mercure: { disamb: true },
  Rihanna: { q: 'Q36844', desc: 'chanteuse barbadienne', pv: 30000 },
  'Abeille domestique': { q: 'Q30034', desc: "espèce d'insectes", pv: 100 },
  'Hydrogène (élément)': { q: 'Q556' },
  'Liste de races bovines': { q: 'Q900100' },
  'Liste des races bovines de France': { q: 'Q900110' },
};
// Liens de « Liste de races bovines » : 3 races, 2 lieux, un lien rouge et une homonymie (écartés).
const LINKS = { 'Charolaise': 'Q900101', 'Limousine (race bovine)': 'Q900102', 'Salers (race bovine)': 'Q900103', France: 'Q142', 'Massif central': 'Q900104' };
const REDIRECTS = { 'Poseidon': 'Poséidon' };
// « Définition Wikipédia » : articles qui citent « est une maladie » (texte d'ouverture de l'index, bandeaux compris).
// Gardés : Grippe (après l'infobox), Phtiriase (après un bandeau), Malabsorption du fructose (sans texte : description).
// Écartés : Freddie Mercury (formule plus loin), Plèvre (sa définition dit « membrane »), une homonymie.
const DEF_MALADIE = [
  { title: 'Freddie Mercury', open: 'Pour les articles homonymes, voir Mercury. Freddie Mercury, né le 5 septembre 1946 à Stone Town, est un chanteur britannique. Pour lui, l’amour est une maladie.', q: 'Q15869' },
  { title: 'Grippe', open: 'Grippe Virus de la grippe. Mise en garde médicale modifier - modifier le code - voir Wikidata (aide) La grippe ou l\'influenza est une maladie infectieuse et contagieuse fréquente.', desc: 'maladie infectieuse', q: 'Q2840' },
  { title: 'Hépatite (homonymie)', open: 'L’hépatite est une maladie du foie. Hépatite peut désigner :', disamb: true },
  { title: 'Malabsorption du fructose', open: '', desc: 'maladie intestinale', q: 'Q1047897' },
  { title: 'Phtiriase', open: 'Cet article est une ébauche concernant la médecine. Vous pouvez partager vos connaissances en l’améliorant. La phtiriase (ou phthiriase) est une maladie infectieuse de la peau due au pou du pubis.', q: 'Q1474' },
  { title: 'Plèvre', open: 'En anatomie, la plèvre est une membrane séreuse. Le cancer de la plèvre est une maladie grave.', desc: 'membrane séreuse', q: 'Q193266' },
];
const defCalls = [];
let wikiCalls = 0;
const propose = { categories: 0 };
const wdSearches = [];
let lastProbe = '';
let pvContinueSeen = false;
function wikiHandle(url) {
  wikiCalls++;
  const u = new URL(url);
  const uri = (id) => ({ type: 'uri', value: 'http://www.wikidata.org/entity/' + id });
  const lit = (v) => ({ type: 'literal', value: String(v) });
  const bool = (v) => ({ type: 'literal', datatype: 'http://www.w3.org/2001/XMLSchema#boolean', value: v ? 'true' : 'false' });
  if (u.hostname === 'www.wikidata.org') {
    const p = Object.fromEntries(u.searchParams);
    if (p.action !== 'wbsearchentities' || p.origin !== '*' || p.language !== 'fr') throw new Error('appel Wikidata inattendu : ' + url);
    const S2 = { footballeur: [{ id: 'Q937857', label: 'footballeur' }], musique: [{ id: 'Q638', label: 'musique' }] };
    wdSearches.push(p.search);
    return { search: S2[p.search.toLowerCase()] || [] };
  }
  if (u.hostname === 'query.wikidata.org') {
    const q = u.searchParams.get('query');
    if (/SELECT \?item \?c \?desc/.test(q)) {
      const ids = [...q.matchAll(/wd:(Q\d+)/g)].map((m) => m[1]);
      return { results: { bindings: ids.map((id) => (Number(id.slice(1)) >= 900101 && Number(id.slice(1)) <= 900103
        ? { item: uri(id), c: uri('Q12045585'), desc: lit('race bovine française') } : { item: uri(id), c: uri(id === 'Q142' ? 'Q6256' : 'Q1620908') })) } };
    }
    if (/wd:Q12045585 rdfs:label/.test(q)) return { results: { bindings: [{ l: lit('race bovine') }] } };
    if (/P279\+/.test(q)) return { results: { bindings: [] } };
    if (/P1549/.test(q)) return { results: { bindings: q.includes('fr[aàâä]n[cç]') ? [{ c: uri('Q142'), cl: lit('France'), isCountry: bool(true) }] : [] } };
    if (/AS \?country\)/.test(q)) {
      const kinds = { Q937857: { occ: true, cls: true }, Q142: { country: true, cls: false }, Q638: { cls: true } };
      const ids = [...q.matchAll(/wd:(Q\d+)/g)].map((m) => m[1]).filter((id) => kinds[id]);
      return { results: { bindings: [...new Set(ids)].map((id) => ({ c: uri(id), country: bool(kinds[id].country), occ: bool(kinds[id].occ), cls: bool(kinds[id].cls), human: bool(false) })) } };
    }
    if (/wdt:P279\* \?g/.test(q)) return { results: { bindings: /wd:Q638\b/.test(q) ? [{ c: uri('Q638'), g: uri('Q17537576') }] : [] } };
    if (/wdt:P106 wd:Q937857/.test(q)) {
      lastProbe = q;
      const n = /LIMIT 3001/.test(q) ? 3001 : Number((q.match(/LIMIT (\d+)/) || [])[1]) || 0;
      if (/LIMIT 3001/.test(q) && !/wdt:P27 wd:Q142/.test(q)) throw new Error('nationalité absente de la requête : ' + q);
      if (!/LIMIT 3001/.test(q) && !/ORDER BY DESC\(\?sl\)/.test(q)) throw new Error('les plus connus doivent être triés par sitelinks');
      return { results: { bindings: Array.from({ length: n }, (_, i) => ({ item: uri('Q' + (900000 + i)), title: lit('Joueur ' + (i + 1)), desc: lit('footballeur français') })) } };
    }
    const b = [];
    const add = (item, p, v, l, f) => b.push({ item: { type: 'uri', value: 'http://www.wikidata.org/entity/' + item }, p: { type: 'uri', value: 'http://www.wikidata.org/prop/direct/' + p }, v: { type: 'uri', value: 'http://www.wikidata.org/entity/' + v }, ...(l ? { l: { type: 'literal', value: l } } : {}), ...(f ? { f: { type: 'literal', value: f } } : {}) });
    if (/Q36844/.test(q)) { add('Q36844', 'P31', 'Q5', 'être humain'); add('Q36844', 'P21', 'Q6581072', 'féminin'); add('Q36844', 'P106', 'Q177220', 'chanteur ou chanteuse', 'chanteuse'); add('Q36844', 'P27', 'Q244', 'Barbade'); }
    if (/Q30034/.test(q)) add('Q30034', 'P31', 'Q16521', 'taxon');
    return { results: { bindings: b } };
  }
  const p = Object.fromEntries(u.searchParams);
  if (p.origin !== '*' || p.format !== 'json' || p.formatversion !== '2') throw new Error('paramètres Wikipédia manquants : ' + url);
  if (p.list === 'search' && p.srnamespace === '0' && /^"est un /.test(p.srsearch)) {
    // Recherche de la formule (« Définition Wikipédia ») : seulement son nombre d'articles et quelques extraits.
    if (p.srsearch.length > 300 || p.srinfo !== 'totalhits') throw new Error('recherche de la formule incorrecte : ' + p.srsearch);
    const hl = (s) => s.replace(/\b(est|une|maladie|cathédrale)\b/g, '<span class="searchmatch">$1</span>');
    if (p.srsearch.includes('"est une maladie"~1') && p.srsearch.includes('"sont des maladies"~1')) {
      return { query: { searchinfo: { totalhits: DEF_MALADIE.length }, search: [{ title: 'Grippe', snippet: hl('La grippe ou l&#039;influenza est une maladie infectieuse et contagieuse') }] } };
    }
    if (p.srsearch.includes('"est une cathédrale"~1')) return { query: { searchinfo: { totalhits: 4200 }, search: [{ title: 'Cathédrale 1', snippet: hl('La cathédrale 1 est une cathédrale gothique') }] } };
    return { query: { searchinfo: { totalhits: 0 }, search: [] } };
  }
  if (p.generator === 'search') {
    if (p.gsrnamespace !== '0' || p.prop !== 'cirrusdoc|description|pageprops' || p.cdincludes !== 'opening_text' || !/wikibase_item/.test(p.ppprop) || !/disambiguation/.test(p.ppprop)) throw new Error('lecture des définitions incorrecte : ' + url);
    defCalls.push({ q: p.gsrsearch, sort: p.gsrsort, offset: Number(p.gsroffset), limit: Number(p.gsrlimit) });
    const page = (d, i) => ({ title: d.title, index: i + 1, ...(d.desc ? { description: d.desc } : {}), pageprops: { ...(d.q ? { wikibase_item: d.q } : {}), ...(d.disamb ? { disambiguation: '' } : {}) },
      cirrusdoc: [{ index: 'frwiki_content', id: String(i + 1), source: d.open ? { opening_text: d.open } : {} }] });
    if (p.gsrsearch.includes('"est une maladie"~1')) {
      if (p.gsrsort !== 'title_natural_asc') throw new Error('tous les articles : tri par titre attendu (pages stables)');
      return { batchcomplete: true, query: { pages: DEF_MALADIE.map(page).reverse() } }; // dans le désordre : l'interface trie par index
    }
    if (p.gsrsearch.includes('"est une cathédrale"~1')) {
      if (p.gsrsort !== 'incoming_links_desc') throw new Error('les plus connus : tri par liens entrants attendu');
      const from = Number(p.gsroffset) || 0;
      const to = Math.min(4200, from + Number(p.gsrlimit));
      const docs = [];
      for (let i = from; i < to; i++) docs.push(i % 4 === 3 ? { title: `Ville ${i + 1}`, open: `Ville ${i + 1} est une ville de France.`, q: 'Q' + (950000 + i) }
        : { title: `Cathédrale ${i + 1}`, open: `La cathédrale ${i + 1} est une cathédrale gothique.`, desc: 'cathédrale', q: 'Q' + (950000 + i) });
      return { ...(to < 4200 ? { continue: { gsroffset: to, continue: 'gsroffset||' } } : {}), query: { pages: docs.map((d, k) => page(d, from + k)) } };
    }
    throw new Error('formule inattendue : ' + p.gsrsearch);
  }
  if (p.list === 'search' && p.srnamespace === '0') {
    if (!/^intitle:liste /.test(p.srsearch)) throw new Error('recherche de listes sans intitle : ' + p.srsearch);
    return { query: { search: /bovin/i.test(p.srsearch) ? [{ title: 'Liste de races bovines' }, { title: 'Charolaise' }, { title: 'Liste des races bovines de France' }] : [] } };
  }
  if (p.generator === 'links') {
    if (p.titles !== 'Liste de races bovines' || p.gplnamespace !== '0' || p.redirects !== '1') throw new Error('liens demandés incorrects : ' + url);
    const pages = Object.entries(LINKS).map(([title, q]) => ({ title, pageprops: { wikibase_item: q } }));
    pages.push({ title: 'Race inconnue', missing: true }, { title: 'Salers', pageprops: { disambiguation: '', wikibase_item: 'Q900105' } });
    return { batchcomplete: true, query: { pages } };
  }
  if (p.list === 'search') {
    if (p.srnamespace !== '14') throw new Error('recherche hors des catégories');
    return { query: { search: /footballeur/i.test(p.srsearch) ? [{ title: 'Catégorie:Footballeur international français' }, { title: 'Catégorie:Footballeur français' }] : [] } };
  }
  if (p.list === 'categorymembers') {
    const M = { 'Catégorie:Exemples de test': { page: Array.from({ length: 40 }, (_, i) => 'Article ' + (i + 1)), subcat: [] },
      'Catégorie:Footballeur international français': { page: ['Zinédine Zidane', 'Thierry Henry', 'Kylian Mbappé'], subcat: ['Catégorie:Footballeur international français espoir'] },
      'Catégorie:Footballeur international français espoir': { page: ['Jeune Espoir', 'Thierry Henry'], subcat: [] } };
    const m = M[p.cmtitle] || { page: [], subcat: [] };
    if (p.cmtype === 'page' && p.cmnamespace !== '0') throw new Error('membres hors de l\'espace principal');
    return { query: { categorymembers: (m[p.cmtype] || []).map((title) => ({ title })) } };
  }
  if (p.prop === 'categories') {
    propose.categories++;
    return { query: { pages: p.titles.split('|').map((title) => {
      const n = Number((title.match(/^Article (\d+)$/) || [])[1]);
      const cat = n >= 1 && n <= 10 ? 'Catégorie:Exemples de test' : n >= 11 && n <= 15 ? 'Catégorie:Autre essai' : null;
      return { title, categories: cat ? [{ title: cat }] : [] };
    }) } };
  }
  if (p.prop === 'categoryinfo') {
    const I = { 'Catégorie:Footballeur international français': { pages: 3, subcats: 1 }, 'Catégorie:Footballeur français': { pages: 12000, subcats: 40 },
      'Catégorie:Exemples de test': { pages: 40, subcats: 0 }, 'Catégorie:Autre essai': { pages: 50, subcats: 0 } };
    return { query: { pages: p.titles.split('|').map((title) => ({ title, categoryinfo: I[title] || { pages: 0, subcats: 0 } })) } };
  }
  const titles = p.titles.split('|');
  const normalized = [];
  const redirects = [];
  const pages = [];
  for (const t of titles) {
    let cur = t;
    const n = t.charAt(0).toUpperCase() + t.slice(1);
    if (n !== t) { normalized.push({ from: t, to: n }); cur = n; }
    if (REDIRECTS[cur]) { redirects.push({ from: cur, to: REDIRECTS[cur] }); cur = REDIRECTS[cur]; }
    const w = WIKI[cur];
    if (!w) { pages.push({ title: cur, missing: true }); continue; }
    const page = { title: cur };
    if (/pageprops/.test(p.prop)) page.pageprops = w.disamb ? { disambiguation: '' } : { wikibase_item: w.q };
    if (/description/.test(p.prop) && w.desc) page.description = w.desc;
    if (/pageimages/.test(p.prop) && w.thumb) page.thumbnail = { source: w.thumb };
    if (/pageviews/.test(p.prop) && w.pv) {
      // Première réponse sans les vues, avec une continuation : l'interface doit la suivre.
      if (!p.pvipcontinue) { pvContinueSeen = false; return { continue: { pvipcontinue: '1', continue: '||' }, query: { normalized, redirects, pages: titles.map((x) => ({ title: x })) } }; }
      pvContinueSeen = true;
      page.pageviews = { '2026-10-01': Math.floor(w.pv / 2), '2026-10-02': w.pv - Math.floor(w.pv / 2), '2026-10-03': null };
    }
    pages.push(page);
  }
  return { batchcomplete: true, query: { normalized, redirects, pages } };
}

// ------------------------------------------------------------------ montage
async function main() {
  const { doc, win, walk } = makeDom();
  const api = SERVER ? null : mockApi();
  const errors = [];
  const ls = new Map();
  const copied = [];
  const idb = fakeIndexedDB();
  const apiLog = []; // appels à /api/ de toutes les pages, « GET /api/cards?since=3 »
  // Contexte d'une page du classeur ; toutes les pages sont dans le même navigateur (localStorage, IndexedDB, API).
  // opts.idb : 'absent' (pas d'IndexedDB) ou 'refusé' (son accès lève une erreur, comme un stockage bloqué) ;
  // opts.hold(url) : promesse attendue avant de répondre à un appel de l'API.
  function makeCtx(doc, win, opts = {}) {
    const ctx = {
      console: { log: console.log, warn: (...a) => { errors.push('warn: ' + a.join(' ')); }, error: (...a) => { errors.push('error: ' + a.map((x) => (x && x.stack) || x).join(' ')); } },
      document: doc, window: null, navigator: { clipboard: { writeText: async (t) => { copied.push(t); } } },
      location: { origin: ORIGIN, pathname: '/', search: '', hash: '', hostname: 'classeur.example' },
      history: { replaceState: (a, b, url) => { ctx.location.hash = ''; ctx.lastReplace = url; } },
      localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
      setTimeout, clearTimeout, setInterval, clearInterval, Promise, Date, Math, JSON, Map, Set, WeakMap, WeakSet, Symbol, Proxy, Reflect, Object, Array, Number, String, Boolean, RegExp, Error, TypeError, SyntaxError,
      Intl, URL, URLSearchParams, encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, isNaN, parseInt, parseFloat, Infinity, NaN, undefined,
      requestAnimationFrame: (f) => setTimeout(f, 0), getComputedStyle: () => ({}),
      matchMedia: () => ({ matches: false }),
      scrollTo: () => {},
      SVGElement: function SVGElement() {},
      Element: function Element() {},
      Node: function Node() {},
      queueMicrotask, AbortController,
    };
    ctx.window = ctx;
    ctx.self = ctx;
    ctx.addEventListener = win.addEventListener;
    ctx.removeEventListener = win.removeEventListener;
    ctx.fetch = async (url, init = {}) => {
      const headers = init.headers || {};
      const method = init.method || 'GET';
      const body = init.body ? JSON.parse(init.body) : undefined;
      if (/^https:\/\/(fr\.wikipedia\.org|query\.wikidata\.org|www\.wikidata\.org)\//.test(url)) {
        if (init.signal && init.signal.aborted) { const e = new Error('abandon'); e.name = 'AbortError'; throw e; }
        const data = wikiHandle(url);
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => data };
      }
      if (url === '/catalog.json' || url === '/assets/bookmarklet.js') {
        const file = path.join(PUB, url);
        const text = fs.readFileSync(file, 'utf8');
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => JSON.parse(text), text: async () => text };
      }
      if (!url.startsWith('/api/')) throw new Error('adresse inattendue : ' + url);
      apiLog.push(method + ' ' + url);
      if (SERVER) {
        if (opts.hold) await opts.hold(url);
        const r = await fetch(SERVER + url, { method, headers, body: init.body });
        const text = await r.text();
        return { ok: r.ok, status: r.status, headers: r.headers, json: async () => JSON.parse(text) };
      }
      const r = api.handle(method, url, headers, body);
      if (opts.hold) await opts.hold(url); // réponse calculée à l'appel, rendue plus tard (réseau lent)
      return { ok: r.status < 400, status: r.status, headers: { get: () => null }, json: async () => JSON.parse(JSON.stringify(r.body)) };
    };
    if (opts.idb === 'refusé') Object.defineProperty(ctx, 'indexedDB', { get() { throw new Error('SecurityError : stockage refusé'); } });
    else if (opts.idb !== 'absent') ctx.indexedDB = idb;
    vm.createContext(ctx);
    return ctx;
  }
  const mainOpts = {};
  const ctx = makeCtx(doc, win, mainOpts);

  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  // L'index charge Vue depuis cdnjs (avec SRI) puis /assets/app.js.
  if (!/vue\.runtime\.global\.prod\.min\.js" integrity="sha384-/.test(html)) fail('Vue (runtime) avec SRI absent de index.html');
  for (const id of [...html.matchAll(/<symbol id="([\w-]+)"/g)].map((m) => m[1])) ctx.__symbols = (ctx.__symbols || []).concat(id);
  const app = doc.createElement('div');
  app.setAttribute('id', 'app');
  doc.body.appendChild(app);
  vm.runInContext(fs.readFileSync(VUE, 'utf8'), ctx, { filename: 'vue.js' });
  for (const m of ['match.js', 'propose.js']) vm.runInContext(fs.readFileSync(path.join(PUB, 'assets', m), 'utf8'), ctx, { filename: m });
  check0(/assets\/match\.js[\s\S]*assets\/propose\.js[\s\S]*assets\/app\.js/.test(html), 'match.js et propose.js doivent être chargés avant app.js');
  vm.runInContext(fs.readFileSync(path.join(PUB, 'assets', 'app.js'), 'utf8'), ctx, { filename: 'app.js' });

  const settle = async (ms = 30) => { const t = SERVER ? Math.max(ms, 250) : ms; for (let i = 0; i < 6; i++) await sleep(t / 6); };
  const all = (pred) => { const out = []; walk(doc.documentElement, (n) => { if (n.nodeType === 1 && pred(n)) out.push(n); }); return out; };
  const text = (n) => (n ? n.textContent.replace(/[  ]/g, ' ') : '');
  const cls = (c) => all((n) => n.classList.contains(c));
  const one = (c) => cls(c)[0] || null;
  const buttonByText = (t) => all((n) => n.tagName === 'BUTTON' && text(n).includes(t))[0] || null;
  const needButton = (t) => { const b = buttonByText(t); if (!b) fail('bouton absent : ' + t + '\n' + text(doc.body).slice(0, 600)); return b; };
  const type = (input, v) => { input.value = v; input.dispatch('input'); };
  const byId = (id) => doc.getElementById(id);
  const has = (t) => text(doc.body).includes(t);
  const check = (cond, m) => { if (!cond) fail(m + '\n--- page ---\n' + text(doc.body).slice(0, 1200)); };
  const usedIcons = () => all((n) => n.localName === 'use').map((n) => n.getAttribute('href').slice(1));
  // Appel direct de l'API (hors interface), simulée ou réelle.
  const rawApi = async (method, p, key, body) => {
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['X-Classeur-Key'] = key;
    if (SERVER) { const r = await fetch(SERVER + p, { method, headers, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; }
    return api.handle(method, p, headers, body || {});
  };
  const makeOtherAccount = async (name) => {
    const r = await rawApi('POST', '/api/account', null, { code: SERVER ? (process.env.SIGNUP_CODE || 'dev') : 'dev', name });
    if (r.status !== 201) fail('second compte : ' + JSON.stringify(r.body));
    return r.body.key;
  };
  // Lectures des cartes (GET /api/cards…) faites par les pages depuis `mark` (position dans apiLog).
  const cardCalls = (mark) => apiLog.slice(mark).filter((x) => x.startsWith('GET /api/cards'));
  // Nombre de cartes du bandeau d'une page (« 1 050 cartes différentes »), ou null s'il n'est pas affiché.
  const countIn = (d) => {
    const f = d.querySelectorAll('.figure').find((n) => text(n).includes('cartes différentes'));
    return f ? Number(text(f.querySelector('b')).replace(/\D/g, '')) : null;
  };
  const waitFor = async (cond, ms = 3000) => { for (let t = 0; t < ms && !cond(); t += 25) await sleep(25); return cond(); };
  // Envoi du favori simulé (CarteImport : les cartes sans leurs tags), par morceaux de 500.
  const sendImport = async (key, list) => {
    const up = 'favori-' + Math.random().toString(36).slice(2);
    const rows = list.map(({ tags, ...c }) => c);
    for (let i = 0, part = 0; i < rows.length || part === 0; i += 500, part++) {
      await rawApi('POST', '/api/import', key, { upload_id: up, part, last: i + 500 >= rows.length, cards: rows.slice(i, i + 500), source: 'bookmarklet' });
    }
  };
  // Le classeur rouvert dans une autre page du même navigateur (localStorage, IndexedDB et API partagés).
  const openPage = (opts) => {
    const p = makeDom();
    const c = makeCtx(p.doc, p.win, opts);
    const box = p.doc.createElement('div');
    box.setAttribute('id', 'app');
    p.doc.body.appendChild(box);
    for (const file of [VUE, ...['match.js', 'propose.js', 'app.js'].map((m) => path.join(PUB, 'assets', m))]) vm.runInContext(fs.readFileSync(file, 'utf8'), c, { filename: path.basename(file) });
    return { doc: p.doc, count: () => countIn(p.doc), visible: async () => { for (const f of p.doc.listeners.visibilitychange || []) await f(); } };
  };
  const cachedCards = () => { const m = idb.dump('classeur', 'cards'); return m ? [...m.values()] : []; };

  await settle(60);
  // 1. Accueil
  check(has('Créer mon classeur') && has("J'ai déjà un lien"), "l'accueil ne s'affiche pas");
  const codeInput = all((n) => n.tagName === 'INPUT' && n.getAttribute('autocomplete') === 'off' && n.getAttribute('required') !== null)[0];
  check(codeInput, 'champ du code absent');
  const nameInput = all((n) => n.getAttribute && n.getAttribute('autocomplete') === 'given-name')[0];
  type(nameInput, 'Cédric');
  type(codeInput, 'mauvais');
  needButton('Créer mon classeur').click();
  await settle(SERVER ? 300 : 30);
  check(has("Code d'invitation incorrect."), "l'erreur de l'API ne s'affiche pas telle quelle");
  type(codeInput, SERVER ? (process.env.SIGNUP_CODE || 'dev') : 'dev');
  needButton('Créer mon classeur').click();
  await settle(SERVER ? 300 : 30);
  check(has('Ton classeur est prêt, Cédric.'), 'pas de lien personnel après création');
  const linkInput = byId('new-link');
  check(linkInput && /^https:\/\/classeur\.example\/#cle=[A-Za-z0-9_-]{20,}$/.test(linkInput.value), 'lien personnel mal formé : ' + (linkInput && linkInput.value));
  check(ls.get('classeur-key'), 'clé non rangée dans localStorage');
  needButton("C'est noté").click();
  await settle(60);

  // 2. Classeur vide : bandeau, onglets, et l'onglet « Mettre à jour » ouvert sur le favori
  const h1 = () => text(doc.body.querySelector('h1'));
  const tabBtn = (id) => byId('tab-' + id);
  const goTab = async (id) => { tabBtn(id).click(); await settle(); };
  check(h1() === 'Le classeur de Cédric' && has('Collections WikiMasters'), 'bandeau absent');
  check(has('Ton classeur est vide'), 'le bandeau ne dit pas que le classeur est vide');
  check(tabBtn('maj') && tabBtn('maj').getAttribute('aria-selected') === 'true', "un classeur vide doit s'ouvrir sur « Mettre à jour »");
  check(has('Le favori, le chemin conseillé') && has('En secours'), "l'onglet Mettre à jour ne présente pas le favori d'abord");
  // Le favori n'a pas encore de clé d'import : il faut la créer (POST /api/import-key).
  check(!all((n) => n.tagName === 'A' && n.classList.contains('bookmarklet')).length && has("clé d'import"), "le favori ne passe pas par une clé d'import");
  needButton('Créer mon favori').click();
  await settle(SERVER ? 300 : 60);
  const bm = all((n) => n.tagName === 'A' && n.classList.contains('bookmarklet'))[0];
  check(bm, 'bouton du favori absent');
  const href = bm.getAttribute('href') || bm.href;
  check(href && href.startsWith('javascript:'), 'favori sans adresse javascript:');
  check(!/[\s#"<>]/.test(href.slice(11)), 'adresse du favori mal échappée');
  const bmCode = decodeURI(href.slice(11));
  const importKey = Object.values(JSON.parse(ls.get('classeur-import-key') || '{}'))[0];
  check(importKey && importKey !== ls.get('classeur-key'), "clé d'import non gardée (classeur-import-key)");
  check(bmCode.includes('"' + ORIGIN + '"') && bmCode.includes('"' + importKey + '"'), "clé d'import ou origine absente du favori");
  check(!bmCode.includes(ls.get('classeur-key')), 'la clé principale ne doit jamais être dans le favori');
  try { new vm.Script(bmCode); } catch (e) { fail('favori : code invalide une fois sur une ligne : ' + e.message); }
  check(byId('bm-url') && byId('bm-url').value === href, 'texte du favori à copier absent');
  bm.dispatch('click');
  await settle();
  check(has('Pas ici'), 'clic sur le favori dans le classeur non intercepté');

  // 3. Le favori sur wiki-masters.com : lecture simulée, regroupement, envoi par morceaux
  const imports = await runBookmarklet(bmCode, ctx.fetch, importKey);
  if (!SERVER) {
    const ups = [...api.st.uploads.values()];
    check(ups.length === 1, 'un seul envoi attendu');
    check(api.st.lastImportKey === importKey, "l'import n'a pas utilisé la clé d'import");
  }
  console.log(`favori : ${imports.parts} morceaux, ${imports.cards} cartes, message « ${imports.message} »`);
  // Retour sur l'onglet du classeur : il se met à jour tout seul. Plus de 1 000 changements depuis la révision lue à
  // l'ouverture : le serveur répond delta:false à ?since, et la page relit tout, par morceaux.
  let mark = apiLog.length;
  for (const f of doc.listeners.visibilitychange || []) await f();
  await settle(80);
  check(has('Collection mise à jour'), "le retour sur l'onglet ne recharge pas la collection");
  {
    const got = cardCalls(mark);
    check(got.length >= 2 && /^GET \/api\/cards\?since=\d+$/.test(got[0]) && got[1] === 'GET /api/cards?part=0' && got.slice(1).every((x) => x.includes('?part=')),
      'delta:false : ?since puis relecture complète attendus : ' + got.join(', '));
  }
  check(has('cartes différentes') && has('collections commencées') && cls('track').length === 1, 'tuiles de chiffres ou barre de répartition absentes');
  await goTab('cartes');
  check(cls('cell').length === 120 && cls('card').length === 120, `120 cartes attendues, ${cls('cell').length} affichées`);
  needButton('Afficher plus').click();
  await settle();
  check(cls('cell').length > 120, 'Afficher plus sans effet');

  // 4. Mes cartes : recherche, rareté, tri
  const q = byId('q');
  type(q, 'rihanna');
  await settle();
  check(cls('cell').length === 1 && has('Rihanna'), 'la recherche ne filtre pas');
  check(cls('card__sheen').length === 1 && cls('card__star').length === 0, 'légendaire sans brillance');
  type(q, '');
  const rp = cls('rpill');
  check(rp.length === 6 && text(rp[0]).startsWith('C'), 'pastilles de rareté absentes');
  rp.find((b) => text(b).includes('Légendaire')).dispatch('click', { ctrlKey: true });
  await settle();
  check(cls('cell').length === 1 && cls('cell').every((c) => text(c.querySelector('.pill')) === 'L'), 'Ctrl+clic sur une rareté ne l\'isole pas');
  needButton('Réinitialiser les filtres').click();
  await settle();
  const sel = byId('sort');
  sel.value = 'title';
  sel.dispatch('change');
  await settle();
  const titles = cls('card__title').map(text);
  check(titles.slice(0, 5).join('|') === titles.slice(0, 5).sort((a, b) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' })).join('|'), 'tri par titre incorrect : ' + titles.slice(0, 5).join(' | '));

  const modalBtn = (t) => { const m = one('modal'); const x = m && m.querySelectorAll('button').filter((n) => text(n).trim() === t)[0]; if (!x) fail('bouton absent de la fenêtre : ' + t + ' / ' + text(m).slice(0, 400)); return x; };
  // 5. Sélection (Maj+clic) et bande de sélection ; tags à deux niveaux (catégorie facultative)
  const picks = all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox');
  picks[0].click();
  await settle();
  picks[4].click({ shiftKey: true });
  await settle();
  check(one('bulk') && text(one('bulk').querySelector('.count')) === '5', 'Maj+clic : 5 cartes attendues, ' + text(one('bulk') && one('bulk').querySelector('.count')));
  check(one('cardgrid').classList.contains('selecting'), 'mode sélection non signalé à la grille');
  type(byId('bulk-tag'), '  À  échanger ');
  needButton('Ajouter').click();
  await settle();
  check(has('« À échanger » ajouté à 5 cartes.'), 'ajout groupé sans confirmation');
  if (!SERVER) check(api.st.calls.some(([m, p, b]) => p === '/api/tags/bulk' && b.card_ids.length === 5 && b.add[0] === 'À échanger'), 'appel tags/bulk incorrect');
  check(cls('cell__tags').filter((t) => text(t).includes('À échanger')).length === 5, 'les tags ne sont pas affichés sous les cartes');
  // Une étiquette sans « / » est rangée dans « Autres », catégorie repliée par défaut.
  const catChip = (name) => cls('tagcat').map((n) => n.querySelector('.chip')).find((b) => b && text(b.querySelector('.chip__label')) === name);
  const subChip = (name) => all((n) => n.tagName === 'BUTTON' && n.classList.contains('chip') && n.parentNode.classList.contains('tagcat__subs') && text(n.querySelector('.chip__label')) === name)[0];
  const unfold = async (cat) => { const b = all((n) => n.classList.contains('fold') && n.getAttribute('aria-label') === 'Déplier ' + cat)[0]; if (b) { b.click(); await settle(); } };
  check(catChip('Autres') && text(catChip('Autres').querySelector('.n')) === '5' && !subChip('À échanger'), 'catégorie « Autres » (repliée, 5 cartes) absente');
  // Catégorie choisie dans la bande : « Brésil » + Pays -> « Pays/Brésil » ; la carte n'affiche que « Brésil ».
  picks[0].click();
  await settle();
  type(byId('bulk-tag'), 'Brésil');
  byId('bulk-cat').value = 'Pays';
  byId('bulk-cat').dispatch('change');
  needButton('Ajouter').click();
  await settle();
  if (!SERVER) check(api.st.calls.some(([m, p, b]) => p === '/api/tags/bulk' && b.add[0] === 'Pays/Brésil' && b.card_ids.length === 4), 'tag rangé mal envoyé');
  const bresil = all((n) => n.classList.contains('tag') && text(n) === 'Brésil');
  check(bresil.length === 4 && bresil[0].getAttribute('title') === 'Pays › Brésil', 'la sous-catégorie seule (catégorie en info-bulle) attendue sous les cartes');
  check(catChip('Pays') && text(catChip('Pays').querySelector('.n')) === '4', 'catégorie « Pays » absente du menu');
  // Quota ou base pleine : le 503 du serveur s'affiche tel quel.
  if (!SERVER) {
    type(byId('bulk-tag'), 'QUOTA');
    byId('bulk-cat').value = '';
    byId('bulk-cat').dispatch('change');
    needButton('Ajouter').click();
    await settle();
    check(has("La base du classeur est pleine pour aujourd'hui (quota gratuit atteint) : réessaie demain."), "le 503 (quota) ne s'affiche pas tel quel");
  }
  needButton('Vider la sélection').click();
  await settle(400);
  check(!one('bulk'), 'la bande de sélection reste');

  // 6. Menu à deux niveaux : filtre par catégorie (union), par sous-catégorie, renommage
  catChip('Pays').click();
  await settle();
  check(cls('cell').length === 4 && text(one('count-line')).includes('Pays (toute la catégorie)'), 'le filtre par catégorie ne marche pas');
  needButton('Réinitialiser les filtres').click();
  await settle();
  await unfold('Autres');
  check(subChip('À échanger'), 'sous-catégorie absente une fois la catégorie dépliée');
  check(JSON.parse(ls.get('classeur-tagcats') || '[]').includes('Autres'), 'état des catégories dépliées non gardé');
  subChip('À échanger').click();
  await settle();
  check(cls('cell').length === 5 && text(one('count-line')).includes('5 cartes'), 'le filtre par tag ne marche pas');
  needButton('Renommer ou supprimer « À échanger »').click();
  await settle();
  check(byId('tag-cat') && byId('tag-cat').value === 'Autres', 'liste des catégories absente de la fenêtre du tag');
  type(byId('tag-to'), 'Échange');
  all((n) => n.tagName === 'BUTTON' && text(n) === 'Renommer')[0].click();
  await settle();
  check(has('renommé en « Échange »') && cls('cell').length === 5, 'renommage du tag incorrect');
  needButton('Réinitialiser les filtres').click();
  await settle();

  // 7. Fiche : tags, suggestions Wikidata (métier au féminin, pays) rangées, validation
  type(q, 'rihanna');
  await settle();
  one('card').dispatch('click');
  await settle(120);
  const fiche = () => one('fiche');
  check(fiche() && text(fiche()).includes('Rihanna') && text(fiche()).includes('Légendaire') && text(fiche()).includes('Vues par mois'), 'fiche absente');
  check(fiche().querySelector('.card') && fiche().querySelector('.card').classList.contains('big'), 'grande carte absente de la fiche');
  check(text(fiche()).includes('Métiers › Chanteuse') && text(fiche()).includes('Pays › Barbade'), 'suggestions rangées absentes : ' + text(fiche()).slice(-220));
  check(!text(fiche()).includes('Être humain'), '« être humain » ne doit pas être suggéré');
  fiche().querySelectorAll('button').filter((b) => text(b).includes('Valider les suggestions'))[0].click();
  await settle();
  if (!SERVER) check(JSON.stringify(api.st.tags.get('c0')) === '["Métiers/Chanteuse","Pays/Barbade"]', 'tags/set après validation : ' + JSON.stringify(api.st.tags.get('c0')));
  check(fiche().querySelectorAll('.tag.own').map(text).join('|') === 'Chanteuse|Barbade', 'la fiche doit afficher les sous-catégories seules');
  type(byId('new-tag'), 'Musique');
  all((n) => n.tagName === 'BUTTON' && n.getAttribute('type') === 'submit' && text(n) === 'Ajouter')[0].click();
  await settle();
  check(text(fiche()).includes('Musique'), 'ajout de tag dans la fiche sans effet');
  // « Copier le nom » : le titre de la carte dans le presse-papiers (plus de lien vers le marché du jeu).
  {
    check(!fiche().querySelectorAll('a').some((a) => /marketplace/.test(a.getAttribute('href') || '')), 'la fiche ne doit plus mener au marché');
    const b = fiche().querySelectorAll('button').filter((x) => text(x).includes('Copier le nom'))[0];
    check(b, 'bouton « Copier le nom » absent de la fiche');
    const n = copied.length;
    b.click();
    await settle();
    check(copied.length === n + 1 && copied[n] === 'Rihanna', 'le nom n\'est pas copié : ' + JSON.stringify(copied.slice(n)));
    check(fiche() && fiche().querySelectorAll('button').some((x) => text(x).includes('Nom copié')), 'pas de « Nom copié » après la copie (ou fiche fermée)');
  }
  win.listeners.keydown.forEach((f) => f({ key: 'Escape', preventDefault() {} }));
  await settle(500);
  check(!fiche(), 'Échap ne ferme pas la fiche');
  type(q, '');
  check(text(catChip('Pays').querySelector('.n')) === '5' && catChip('Métiers'), 'les suggestions validées ne sont pas rangées dans le menu');

  // 8. Suggestions pour toute la collection (colonne des tags)
  needButton('Calculer les suggestions pour toute la collection').click();
  await settle(400);
  check(has('Suggestions : ') && has('sur 1 049 cartes'), 'progression des suggestions absente');
  needButton('Arrêter').click();
  await settle();
  check(has('Calculer les suggestions pour toute la collection'), 'Arrêter sans effet');

  // 8 bis. « Ranger mes tags » : aperçu (catégorie modifiable), puis application ; déplacer un tag à la main
  needButton('Ranger mes tags').click();
  for (let i = 0; i < 300 && (!one('arrange') || has('Analyse de tes tags') || has('Recherche sur Wikidata') || has('Lecture des cartes')); i++) await sleep(50);
  await settle();
  const arrRows = () => cls('arrange')[0].childNodes.filter((n) => n.nodeType === 1);
  const rowOf = (name) => arrRows().find((li) => text(li.querySelector('.from')).startsWith(name));
  // Un mot libre trouvé seulement sur Wikidata n'est plus rangé d'office (« Musique » pouvait finir en événements) :
  // il reste dans Autres avec un « peut-être… », et c'est l'utilisateur qui choisit.
  check(rowOf('Musique') && rowOf('Musique').querySelector('select').value === 'Autres' && text(rowOf('Musique')).includes('peut-être'), 'aperçu : Musique devrait rester dans Autres avec une suggestion');
  rowOf('Musique').querySelector('select').value = 'Culture et œuvres';
  rowOf('Musique').querySelector('select').dispatch('change');
  await settle();
  check(rowOf('Échange') && rowOf('Échange').querySelector('select').value === 'Autres' && text(rowOf('Échange')).includes('reste dans Autres'), 'aperçu : Échange devrait rester dans Autres');
  check(!rowOf('Brésil') && !rowOf('Chanteuse'), 'les tags déjà rangés ne doivent pas être proposés');
  if (!SERVER) check(wdSearches.includes('Musique') && wdSearches.includes('Échange'), 'Wikidata non interrogé sur les libellés : ' + wdSearches.join(', '));
  needButton('Appliquer (1 tag)').click();
  await settle(200);
  if (!SERVER) check(api.st.calls.some(([m, p, b]) => p === '/api/tags/rename' && b.from === 'Musique' && b.to === 'Culture et œuvres/Musique'), 'renommage du rangement mal envoyé');
  check(!one('arrange') && catChip('Culture et œuvres') && has('Tags rangés : 1'), 'rangement non appliqué');
  await unfold('Autres');
  subChip('Échange').click();
  await settle();
  needButton('Renommer ou supprimer « Échange »').click();
  await settle();
  byId('tag-cat').value = 'Organisations';
  byId('tag-cat').dispatch('change');
  all((n) => n.tagName === 'BUTTON' && text(n) === 'Renommer')[0].click();
  await settle();
  if (!SERVER) check(api.st.calls.some(([m, p, b]) => p === '/api/tags/rename' && b.from === 'Échange' && b.to === 'Organisations/Échange'), 'déplacement à la main mal envoyé');
  check(catChip('Organisations') && !catChip('Autres'), 'le tag déplacé n\'a pas changé de catégorie');
  needButton('Réinitialiser les filtres').click();
  await settle();
  const cats = cls('tagcat').map((n) => text(n.querySelector('.chip__label')));
  check(cats.join('|') === 'Pays|Métiers|Culture et œuvres|Organisations', 'ordre des catégories : ' + cats.join(' | '));

  // 9. Collections : propositions à 5 % au moins, catalogue complet derrière un lien, retrait, masquage
  await goTab('collections');
  check(has('Mes collections') && has('Collections proposées'), 'vue d\'ensemble des collections absente');
  check(!has('Races bovines'), 'une proposition à moins de 5 % est affichée');
  const planetRow = all((n) => n.classList.contains('row') && (n.getAttribute('aria-label') || '').startsWith('Planètes du Système solaire'))[0];
  check(planetRow && text(planetRow).includes('1 sur 9'), 'les Planètes (1 sur 9, plus de 5 %) devraient être proposées');
  needButton('Parcourir tout le catalogue').click();
  await settle();
  check(has('Bêtes et terroir') && has('Races bovines'), 'le lien « Parcourir tout le catalogue » n\'affiche pas le reste');
  check(cls('row').length > 10 && cls('fan').length === cls('row').length, 'lignes de collections (éventail) absentes');
  // Retirer une proposition (confirmation dans la page), puis la rétablir dans les Réglages.
  all((n) => n.classList.contains('row') && (n.getAttribute('aria-label') || '').startsWith('Races bovines'))[0].click();
  await settle(80);
  needButton('Retirer des propositions').click();
  await settle();
  check(has('Retirer « Races bovines » des propositions ?'), 'confirmation du retrait absente');
  modalBtn('Retirer des propositions').click();
  await settle(100);
  if (!SERVER) check(api.st.prefs && api.st.prefs.hidden_catalog.includes('vaches'), 'retrait non enregistré dans prefs : ' + JSON.stringify(api.st.prefs));
  check(has('Mes collections') && !all((n) => n.classList.contains('row') && text(n).includes('Races bovines')).length, 'la proposition retirée reste affichée');
  // Masquer toutes les propositions, puis les réafficher.
  needButton('Masquer toutes les propositions').click();
  await settle(100);
  check(has('Propositions masquées') && !has('Planètes du Système solaire') && !cls('subgroup').length, 'les propositions ne sont pas masquées');
  if (!SERVER) check(api.st.prefs.hide_catalog === true, 'masquage non enregistré');
  await goTab('reglages');
  check(has('Collections proposées : masquées') && has('Rétablir la proposition retirée'), 'réglage des propositions absent');
  needButton('Rétablir la proposition retirée').click();
  await settle();
  needButton('Afficher les propositions').click();
  await settle();
  if (!SERVER) check(api.st.prefs.hide_catalog === false && api.st.prefs.hidden_catalog.length === 0, 'rétablissement non enregistré : ' + JSON.stringify(api.st.prefs));
  await goTab('collections');
  all((n) => n.classList.contains('row') && (n.getAttribute('aria-label') || '').startsWith('Planètes du Système solaire'))[0].click();
  await settle(80);
  check(has('proposée') && has("Il t'en manque") && cls('slot').length === 8 && cls('cell').length === 1, "l'album d'une collection proposée ne s'ouvre pas");
  needButton('Ajouter à mes collections').click();
  await settle(80);
  if (!SERVER) check(api.st.targets.some((t) => t.source === 'catalog:planetes' && t.items.length === 9), 'collection du catalogue mal enregistrée');
  check(has('Modifier') && !has('Ajouter à mes collections'), "l'album ne passe pas à la collection ajoutée");
  needButton('← Toutes les collections').click();
  await settle();
  check(all((n) => n.classList.contains('row') && text(n).includes('Planètes')).length === 1, 'collection ajoutée en double ou absente');

  // 9 ter. Rapprochement par identifiant Wikidata : « Hydrogène (élément) » compte pour « Hydrogène » (même qid)
  for (let i = 0; i < 100 && !(ls.get('classeur-qid') || '').includes('Q556'); i++) await sleep(100);
  if (buttonByText('Parcourir tout le catalogue')) { needButton('Parcourir tout le catalogue').click(); await settle(); }
  const elemRow = () => all((n) => n.classList.contains('row') && (n.getAttribute('aria-label') || '').startsWith('Éléments chimiques'))[0];
  for (let i = 0; i < 40 && !(elemRow() && text(elemRow()).includes('1 sur 118')); i++) await sleep(100);
  check(elemRow() && text(elemRow()).includes('1 sur 118'), 'la carte « Hydrogène (élément) » doit compter pour « Hydrogène » (qid) : ' + (elemRow() ? text(elemRow()) : 'ligne absente'));
  elemRow().click();
  await settle(80);
  check(cls('cell').length === 1 && cls('slot').length === 117 && text(cls('cell')[0]).includes('Hydrogène (élément)'), "l'album doit montrer la carte à la place de « Hydrogène »");
  needButton('← Toutes les collections').click();
  await settle();
  if (buttonByText('Ne montrer que celles dont tu as au moins 5 %')) { needButton('Ne montrer que celles dont tu as au moins 5 %').click(); await settle(); }

  // 9 quater. Propositions d'après les catégories Wikipédia de tes cartes (au moins 5 % et 2 cartes)
  for (let i = 0; i < 150 && !has('Exemples de test'); i++) await sleep(100);
  check(has("D'après tes cartes (catégories Wikipédia)") && has('Exemples de test') && has('Autre essai'), 'propositions d\'après les catégories absentes');
  check(propose.categories > 0, 'propose.js n\'a pas interrogé Wikipédia');
  const wpRow = (name) => all((n) => n.classList.contains('row') && n.classList.contains('wp') && text(n.querySelector('.name')) === name)[0];
  check(text(wpRow('Exemples de test')).includes('7 sur 40') && text(wpRow('Exemples de test')).includes('Catégorie Wikipédia'), 'ligne de proposition incorrecte : ' + text(wpRow('Exemples de test')));
  all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Retirer « Autre essai » des propositions')[0].click();
  await settle();
  modalBtn('Retirer des propositions').click();
  await settle(100);
  if (!SERVER) check(api.st.prefs.hidden_catalog.includes('wp:Autre essai'), 'retrait de la proposition non enregistré : ' + JSON.stringify(api.st.prefs));
  check(!wpRow('Autre essai'), 'la proposition retirée reste affichée');
  all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Ajouter « Exemples de test » à mes collections')[0].click();
  for (let i = 0; i < 60 && !has('ajoutée à tes collections : 40 articles'); i++) await sleep(50);
  if (!SERVER) check(api.st.targets.some((t) => t.source === 'wp:Exemples de test' && t.items.length === 40 && t.name === 'Exemples de test'), 'proposition mal enregistrée');
  check(text(one('album-title')).includes('Exemples de test') && text(one('album-title')).includes('7 sur 40'), "l'album de la proposition ajoutée ne s'ouvre pas");
  needButton('← Toutes les collections').click();
  await settle();
  check(!wpRow('Exemples de test'), 'la proposition ajoutée reste proposée');

  // 9 bis. Nouvelle collection par mots-clés : catégories Wikipédia et requête Wikidata
  needButton('Nouvelle collection').click();
  await settle();
  check(byId('kw') && all((n) => n.getAttribute('role') === 'tab' && n.getAttribute('aria-selected') === 'true').some((t) => text(t) === 'Par mots-clés'), 'la recherche par mots-clés doit être l\'onglet par défaut');
  type(byId('kw'), 'footballeur français');
  for (let i = 0; i < 100 && !(has('Interprétation') && !has('Recherche…')); i++) await sleep(50);
  await settle();
  check(has('Interprétation : Métier : footballeur · Nationalité : France'), 'interprétation Wikidata absente : ' + text(one('modal')).slice(0, 400));
  const candTexts = cls('cand').map(text);
  check(candTexts.length === 3, 'trois candidats attendus : ' + candTexts.join(' / '));
  check(candTexts[0].includes('Footballeur français') && candTexts[0].includes('plus de 3 000 articles · Wikidata') && candTexts[0].includes('Garder les plus connus'), 'candidat Wikidata incorrect : ' + candTexts[0]);
  check(candTexts.some((t) => t.includes('Footballeur international français') && t.includes('3 articles · 1 sous-catégories · Catégorie Wikipédia')), 'candidat catégorie absent');
  check(cls('cand').some((c) => c.classList.contains('disabled') && text(c).includes('trop grande : précise ta recherche')), 'la catégorie trop grande doit être grisée');
  all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Garder les 100 plus connus')[0].click();
  for (let i = 0; i < 60 && !cls('preview').length; i++) await sleep(50);
  check(byId('kw-name') && byId('kw-name').value === 'Footballeur français (les 100 plus connus)' && cls('preview')[0].querySelectorAll('li').length === 20 && has('… et 80 autres'),
    'aperçu des plus connus incorrect');
  if (!SERVER) check(/ORDER BY DESC\(\?sl\)/.test(lastProbe) && /LIMIT 100/.test(lastProbe), 'requête des plus connus incorrecte');
  type(byId('kw-name'), 'Footballeurs français célèbres');
  modalBtn('Enregistrer').click();
  for (let i = 0; i < 60 && !has('enregistrée : 100 articles'); i++) await sleep(50);
  if (!SERVER) {
    const t = api.st.targets.find((x) => x.name === 'Footballeurs français célèbres');
    check(t && t.items.length === 100 && t.items[0].title === 'Joueur 1' && t.items[0].qid === 'Q900000' && t.items[0].status === 'ok', 'collection Wikidata mal enregistrée');
  }
  check(text(one('album-title')).includes('Footballeurs français célèbres'), 'l\'album de la nouvelle collection ne s\'ouvre pas');
  needButton('← Toutes les collections').click();
  await settle();
  needButton('Nouvelle collection').click();
  await settle();
  type(byId('kw'), 'footballeur français');
  byId('kw').dispatch('keydown', { key: 'Enter' });
  for (let i = 0; i < 100 && cls('cand').length < 3; i++) await sleep(50);
  all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Choisir Footballeur international français')[0].click();
  for (let i = 0; i < 60 && !cls('preview').length; i++) await sleep(50);
  check(cls('preview')[0].querySelectorAll('li').length === 3, 'membres de la catégorie absents');
  all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox' && n.parentNode.classList.contains('check'))[0].dispatch('change');
  for (let i = 0; i < 60 && cls('preview')[0].querySelectorAll('li').length !== 4; i++) await sleep(50);
  check(cls('preview')[0].querySelectorAll('li').map(text).join('|') === 'Zinédine Zidane|Thierry Henry|Kylian Mbappé|Jeune Espoir', 'sous-catégories mal fusionnées : ' + cls('preview')[0].querySelectorAll('li').map(text).join('|'));
  modalBtn('Enregistrer').click();
  for (let i = 0; i < 60 && !has('enregistrée : 4 articles'); i++) await sleep(50);
  if (!SERVER) check(api.st.targets.some((x) => x.name === 'Footballeur international français' && x.items.length === 4), 'collection de catégorie mal enregistrée');
  needButton('← Toutes les collections').click();
  await settle();

  // 9 ter. Nouvelle collection d'après les liens d'une page « Liste de… » : la nature dominante seulement, ou tous les liens
  needButton('Nouvelle collection').click();
  await settle();
  type(byId('kw'), 'Races_bovines');
  byId('kw').dispatch('keydown', { key: 'Enter' });
  for (let i = 0; i < 100 && !(has('Interprétation') && !has('Recherche…')); i++) await sleep(50);
  await settle();
  const pageCands = cls('cand').map(text);
  check(pageCands.length === 2 && pageCands[0].includes('Races bovines') && pageCands[0].includes('Page Wikipédia') && pageCands[1].includes('Races bovines de France'),
    'pages « Liste de… » absentes : ' + pageCands.join(' / '));
  all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Choisir Races bovines')[0].click();
  for (let i = 0; i < 100 && !cls('preview').length; i++) await sleep(50);
  const linkPreview = () => cls('preview')[0].querySelectorAll('li').map(text).join('|');
  const linkBox = () => all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox' && n.parentNode.classList.contains('check'))[0];
  check(linkPreview() === 'Charolaise|Limousine (race bovine)|Salers (race bovine)' && has('ne garder que les « race bovine » (3 sur 5 articles liés'), 'liens de la page mal filtrés : ' + linkPreview());
  linkBox().dispatch('change');
  for (let i = 0; i < 60 && cls('preview')[0].querySelectorAll('li').length !== 5; i++) await sleep(50);
  check(linkPreview() === 'Charolaise|France|Limousine (race bovine)|Massif central|Salers (race bovine)', 'tous les liens : ' + linkPreview());
  linkBox().dispatch('change');
  for (let i = 0; i < 60 && cls('preview')[0].querySelectorAll('li').length !== 3; i++) await sleep(50);
  modalBtn('Enregistrer').click();
  for (let i = 0; i < 60 && !has('enregistrée : 3 articles'); i++) await sleep(50);
  if (!SERVER) {
    const t = api.st.targets.find((x) => x.name === 'Races bovines');
    check(t && t.items.length === 3 && t.items[0].qid === 'Q900101' && t.items[0].description === 'race bovine française', 'collection de liens mal enregistrée');
  }
  needButton('← Toutes les collections').click();
  await settle();
  needButton('Nouvelle collection').click();
  await settle();
  type(byId('kw'), 'https://fr.wikipedia.org/wiki/Liste_des_races_bovines_de_France');
  byId('kw').dispatch('keydown', { key: 'Enter' });
  for (let i = 0; i < 100 && !(cls('cand').length && !has('Recherche…')); i++) await sleep(50);
  await settle();
  check(cls('cand').length === 1 && text(cls('cand')[0]).includes('Races bovines de France'), 'adresse collée : ' + cls('cand').map(text).join(' / '));
  modalBtn('Annuler').click();
  await settle();

  // 9 quinquies. « Définition Wikipédia » : les articles dont la première phrase dit « … est une maladie … » (formule
  // cherchée dans Wikipédia, puis début de chaque article lu : bandeaux et infobox sautés, homonymies écartées)
  needButton('Nouvelle collection').click();
  await settle();
  type(byId('kw'), 'maladie');
  byId('kw').dispatch('keydown', { key: 'Enter' });
  for (let i = 0; i < 100 && !(has('Interprétation') && !has('Recherche…')); i++) await sleep(50);
  await settle();
  const defCands = cls('cand').map(text);
  check(defCands.length === 1 && defCands[0].includes('Maladies') && defCands[0].includes('6 articles citent la formule, triés à l\'ouverture · Définition Wikipédia')
    && defCands[0].includes('Articles dont la première phrase dit « … est une maladie … »'), 'candidat « Définition » : ' + defCands.join(' / '));
  all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Choisir Maladies')[0].click();
  for (let i = 0; i < 100 && !cls('preview').length; i++) await sleep(50);
  const defPreview = () => cls('preview')[0].querySelectorAll('li').map(text).join('|');
  check(defPreview() === 'Grippe|Malabsorption du fructose|Phtiriase', 'définitions mal triées : ' + defPreview());
  check(has('Définition Wikipédia · articles dont la première phrase dit « … est une maladie … »') && has('3 retenus sur 6 articles lus, par ordre alphabétique'),
    'note de l\'aperçu des définitions : ' + text(one('modal')).slice(0, 500));
  check(byId('kw-name').value === 'Maladies', 'nom proposé pour les définitions : ' + byId('kw-name').value);
  modalBtn('Enregistrer').click();
  for (let i = 0; i < 60 && !has('« Maladies » enregistrée : 3 articles'); i++) await sleep(50);
  await settle();
  if (!SERVER) {
    const t = api.st.targets.find((x) => x.name === 'Maladies');
    check(t && t.items.length === 3 && t.items[0].title === 'Grippe' && t.items[0].qid === 'Q2840' && t.items[0].description === 'maladie infectieuse'
      && t.items[1].qid === 'Q1047897' && t.items.every((i) => i.status === 'ok'), 'collection « Définition » mal enregistrée : ' + JSON.stringify(t && t.items));
  }
  needButton('← Toutes les collections').click();
  await settle();
  // Trop d'articles pour tous les lire : seulement les plus liés depuis Wikipédia, lus jusqu'à en avoir assez.
  needButton('Nouvelle collection').click();
  await settle();
  type(byId('kw'), 'cathédrales');
  byId('kw').dispatch('keydown', { key: 'Enter' });
  for (let i = 0; i < 100 && !(has('Interprétation') && !has('Recherche…')); i++) await sleep(50);
  await settle();
  const bigDef = cls('cand').filter((c) => text(c).includes('Définition Wikipédia'))[0];
  check(bigDef && text(bigDef).includes('plus de 3 000 articles (4 200 citent la formule)') && text(bigDef).includes('Garder les plus connus') && !text(bigDef).includes('Choisir'),
    'grand candidat « Définition » : ' + (bigDef ? text(bigDef) : cls('cand').map(text).join(' / ')));
  bigDef.querySelectorAll('button').filter((b) => b.getAttribute('aria-label') === 'Garder les 100 plus connus')[0].click();
  for (let i = 0; i < 100 && !cls('preview').length; i++) await sleep(50);
  const bigItems = cls('preview')[0].querySelectorAll('li').map(text);
  check(byId('kw-name').value === 'Cathédrales (les 100 plus connus)' && bigItems.length === 20 && has('… et 80 autres') && bigItems[0] === 'Cathédrale 1' && !bigItems.some((x) => x.startsWith('Ville')),
    'plus connus de la définition : ' + text(one('modal')).slice(0, 500));
  check(has('100 retenus sur 180 articles lus, les plus liés depuis Wikipédia d\'abord'), 'note des plus connus : ' + text(one('modal')).slice(0, 600));
  const linked = defCalls.filter((x) => x.sort === 'incoming_links_desc');
  check(linked.length === 2 && linked[0].limit === 130 && linked[1].offset === 130 && linked[1].limit === 50, 'lecture des plus connus : ' + JSON.stringify(linked));
  modalBtn('Annuler').click();
  await settle();

  // 10. Nouvelle collection (liste d'articles) : vérification sur Wikipédia (redirection, homonymie, introuvable)
  needButton('Nouvelle collection').click();
  await settle();
  all((n) => n.getAttribute('role') === 'tab' && text(n) === "Liste d'articles")[0].click();
  await settle();
  type(byId('ed-name'), "Dieux de l'Olympe");
  type(byId('ed-text'), 'zeus\nPoseidon\nhttps://fr.wikipedia.org/wiki/H%C3%A9ra\nMercure\nInexistant\nRihanna\n');
  modalBtn('Enregistrer').click();
  for (let i = 0; i < 100 && !has('posent problème'); i++) await sleep(50);
  await settle(200);
  check(has('2 articles posent problème') && has('Mercure') && has('Inexistant'), "les problèmes de vérification ne s'affichent pas");
  needButton('Enregistrer quand même').click();
  for (let i = 0; i < 100 && !has('Collection enregistrée'); i++) await sleep(50);
  await settle(200);
  if (!SERVER) {
    const t = api.st.targets.find((x) => x.name === "Dieux de l'Olympe");
    check(t && t.items.map((i) => i.title + ':' + i.status).join(',') === 'Zeus:ok,Poséidon:ok,Héra:ok,Mercure:disambiguation,Inexistant:missing,Rihanna:ok', 'items enregistrés : ' + (t && JSON.stringify(t.items)));
    check(t.items[0].image === 'https://upload.wikimedia.org/z.jpg' && t.items[0].description === 'dieu grec', 'description ou vignette perdue');
    check(t.items[0].qid === 'Q34201' && !('qid' in t.items[4]), "qid de la vérification sur Wikipédia non envoyé");
  }
  check(text(one('album-title')).includes('1 sur 6') && has("Il t'en manque 5") && has('Tu en as 1 :'), 'en-tête de la collection incorrect');
  for (let i = 0; i < 40 && has('Rareté estimée des cases vides'); i++) await sleep(100);
  check(pvContinueSeen, 'la continuation des vues (pvipcontinue) n\'est pas suivie');
  const ests = cls('slot').map((s) => text(s.querySelector('.pill')));
  check(ests.includes('≈ L') && ests.includes('≈ SR') && ests.includes('≈ R'), 'raretés estimées : ' + ests.join(' '));
  check(has("Page d'homonymie : précise le titre") && has('Article introuvable sur Wikipédia'), 'avertissements des cases vides absents');
  check(cls('slot').length === 5 && cls('slot__no').length === 5 && cls('cell').length === 1, 'cases vides numérotées absentes');
  // Cases vides : bouton « Copier le nom » sur les articles vérifiés (ni homonymie ni article introuvable).
  {
    const buttons = cls('slot__copy');
    check(buttons.length === 3 && buttons.every((b) => b.tagName === 'BUTTON' && b.getAttribute('type') === 'button') && !cls('slot__market').length,
      'boutons « Copier le nom » des cases vides : ' + buttons.length);
    const zeus = buttons.filter((b) => (b.getAttribute('aria-label') || '').includes('« Zeus »'))[0];
    check(zeus, 'bouton « Copier le nom » de « Zeus » sans nom accessible');
    zeus.click();
    await settle();
    check(copied[copied.length - 1] === 'Zeus', 'le nom de la case vide n\'est pas copié');
    check(cls('slot__copy').some((b) => b.getAttribute('aria-label') === 'Nom « Zeus » copié'), 'pas de confirmation sur le bouton de la case');
  }
  check(has('40 000 vues / 30 j') || has('40 000 vues / 30 j'), 'vues sur 30 jours absentes des cases vides');
  // Toute la case vide ouvre la fiche de la carte manquante (bouton étendu, frère de la loupe) : description, rareté
  // estimée, vues, collections, marché et Wikipédia ; sans marché pour une homonymie ou un article introuvable.
  {
    const opener = (t) => cls('slot__open').filter((b) => (b.getAttribute('aria-label') || '').startsWith(t + ' : '))[0];
    check(cls('slot__open').length === 5 && cls('slot__open').every((b) => b.tagName === 'BUTTON' && b.getAttribute('type') === 'button' && !b.querySelector('a, button')),
      'boutons d\'ouverture des cases vides : ' + cls('slot__open').length);
    check(cls('slot').every((s) => s.querySelectorAll('h3').every((t) => !t.querySelector('a'))), 'le titre d\'une case vide ne doit plus être un lien (la case entière ouvre la fiche)');
    const zeusBtn = opener('Zeus');
    check(zeusBtn, 'bouton d\'ouverture de « Zeus » absent');
    zeusBtn.focus();
    zeusBtn.click();
    await settle(120);
    const f = one('fiche');
    check(f && f.classList.contains('fiche--missing') && text(f.querySelector('h2')) === 'Zeus', 'la case vide n\'ouvre pas la fiche de la carte manquante');
    const ft = text(f);
    check(ft.includes('Pas encore dans ta collection') && ft.includes('dieu grec') && ft.includes('≈ Légendaire') && ft.includes('40 000'),
      'contenu de la fiche manquante : ' + ft.slice(0, 400));
    check(f.querySelector('.slot__bg') && f.querySelector('.slot__bg').getAttribute('src') === 'https://upload.wikimedia.org/z.jpg', 'vignette absente de la fiche manquante');
    check(ft.includes('Dans tes collections') && f.querySelector('.memberships') && f.querySelector('.memberships').querySelectorAll('button').some((b) => text(b).includes("Dieux de l'Olympe")), 'collections de la carte manquante absentes');
    const wp = f.querySelectorAll('a').filter((a) => text(a).includes("Lire l'article sur Wikipédia"))[0];
    check(wp && wp.getAttribute('href') === 'https://fr.wikipedia.org/wiki/Zeus' && wp.getAttribute('target') === '_blank', 'lien Wikipédia absent de la fiche manquante');
    const m = f.querySelectorAll('button').filter((b) => text(b).includes('Copier le nom') || text(b).includes('Nom copié'))[0];
    check(m && !f.querySelectorAll('a').some((a) => /marketplace/.test(a.getAttribute('href') || '')), 'bouton « Copier le nom » absent de la fiche manquante (ou lien du marché resté)');
    const n = copied.length;
    m.click();
    await settle();
    check(copied.length === n + 1 && copied[n] === 'Zeus' && one('fiche'), 'la fiche manquante ne copie pas le nom (ou se ferme)');
    win.listeners.keydown.forEach((fn) => fn({ key: 'Escape', preventDefault() {} }));
    await settle(500);
    check(!one('fiche'), 'Échap ne ferme pas la fiche de la carte manquante');
    check(doc.activeElement === opener('Zeus'), 'le focus ne revient pas sur la case vide après la fiche');
    // Homonymie : la fiche s'ouvre, avec l'avertissement et Wikipédia, sans « Copier le nom ».
    opener('Mercure').click();
    await settle(120);
    const g = one('fiche');
    check(g && text(g.querySelector('h2')) === 'Mercure' && text(g).includes("Page d'homonymie") && text(g).includes("Lire l'article sur Wikipédia")
      && !g.querySelectorAll('button').some((b) => text(b).includes('Copier le nom')), 'fiche d\'une homonymie : ' + text(g).slice(0, 300));
    g.querySelector('.close').click();
    await settle(500);
    check(!one('fiche'), 'le bouton Fermer ne ferme pas la fiche de la carte manquante');
  }
  await sleep(1600);
  const pvCache = JSON.parse(ls.get('classeur-pv') || '{}');
  check(pvCache.Zeus && pvCache.Zeus[1][0] === 40000, 'cache des vues non écrit');
  all((n) => n.tagName === 'BUTTON' && text(n).trim() === 'Rareté')[0].click();
  await settle();
  { const g = cls('cardgrid')[0].childNodes.filter((n) => n.nodeType === 1); check(text(g[0]).includes('Zeus') && text(g[1]).includes('Rihanna') && text(g[2]).includes('Héra'), 'tri par rareté : ' + g.slice(0, 3).map((n) => text(n).slice(0, 20)).join(' | ')); }
  all((n) => n.tagName === 'BUTTON' && text(n).trim() === 'Manquantes')[0].click();
  await settle();
  check(cls('cell').length === 0 && cls('slot').length === 5, 'filtre Manquantes incorrect');

  // 11. Supprimer la collection (confirmation dans la page)
  all((n) => n.tagName === 'BUTTON' && text(n).trim() === 'Supprimer')[0].click();
  await settle();
  check(has('Supprimer « Dieux de l\'Olympe » ?'), 'confirmation de suppression absente');
  needButton('Supprimer la collection').click();
  await settle(400);
  check(has('Mes collections') && !cls('group')[0].querySelectorAll('.row').some((n) => text(n).includes('Dieux')), 'collection non supprimée');

  // 12. Sans session, le bouton devient « Mettre à jour avec le favori » : fenêtre guidée qui attend l'envoi du favori
  // et recharge la collection toute seule quand il arrive ; puis le cookie en secours, depuis « Mettre à jour ».
  needButton('Mettre à jour avec le favori').click();
  await settle();
  check(has('Mettre à jour ta collection') && has('En attente de ton favori'), 'fenêtre « Mettre à jour avec le favori » absente');
  check(all((n) => n.tagName === 'A' && text(n).includes('Ouvrir wiki-masters.com')).length === 1, 'lien « Ouvrir wiki-masters.com » absent');
  mark = apiLog.length;
  {
    // Le favori envoie la collection avec une carte de plus (simulé, comme depuis wiki-masters.com).
    const key = ls.get('classeur-key');
    const cur = (await rawApi('GET', '/api/cards', key)).body.cards.map(({ tags, ...c }) => c);
    const extra = { ...cur[0], id: 'carte-du-favori', title: 'Carte du favori', count: 1 };
    const all2 = [...cur, extra];
    const up = 'favori-' + Date.now();
    for (let i = 0, part = 0; i < all2.length; i += 500, part++) {
      await rawApi('POST', '/api/import', key, { upload_id: up, part, last: i + 500 >= all2.length, cards: all2.slice(i, i + 500), source: 'bookmarklet' });
    }
  }
  for (let i = 0; i < 120 && !has('Collection mise à jour :'); i++) await sleep(100);
  check(has('Collection mise à jour :') && has('1 nouvelle'), 'la fenêtre n\'a pas vu l\'envoi du favori');
  // Seulement ce qui a changé depuis l'ouverture (la carte du favori, les tags posés ici) : ?since, aucune page part=.
  check(cardCalls(mark).length === 1 && /\?since=\d+$/.test(cardCalls(mark)[0]) && countIn(doc) === 1051,
    'envoi vu par la fenêtre : un seul ?since attendu, ' + cardCalls(mark).join(', ') + ' ; ' + countIn(doc) + ' cartes');
  needButton('Fermer').click();
  await settle();
  // Le cookie, en secours : « Mettre à jour » (favori d'abord), puis l'enregistrement et la boucle de rafraîchissement.
  goTab('maj');
  await settle();
  check(byId('cookie-input') && tabBtn('maj').getAttribute('aria-selected') === 'true', 'sans session, Rafraîchir doit mener à « Mettre à jour »');
  check(has('Le favori, le chemin conseillé') && has('Le jeu renouvelle ta session régulièrement : le rafraîchissement par cookie marche en général environ une heure après le collage, et peut te déconnecter du jeu dans ton navigateur. Le favori n\'a pas ce problème.'),
    'la page ne présente pas le cookie comme un secours, avec son avertissement');
  type(byId('cookie-input'), 'Cookie: sb-a=1; sb-b=2');
  mark = apiLog.length;
  needButton('Enregistrer le cookie et rafraîchir').click();
  for (let i = 0; i < 300 && !(text(doc.body.querySelector('.refresh-line')).match(/expir|répond|cartes ·|nouvelle|robot/) && !has('Rafraîchissement…')); i++) await sleep(100);
  for (let i = 0; i < 300 && has('Rafraîchissement…'); i++) await sleep(100);
  await settle(100);
  if (SERVER) console.log('rafraîchissement par cookie (faux cookie) : ' + text(doc.body.querySelector('.refresh-line')));
  await settle(200);
  if (!SERVER) {
    check(api.st.lastSession && api.st.lastSession.cookie === 'sb-a=1; sb-b=2', 'cookie mal envoyé : ' + JSON.stringify(api.st.lastSession));
    const pages = api.st.calls.filter(([, p]) => p === '/api/refresh').map(([, , b]) => b.page).join(',');
    check(pages === '0,10,20', 'pages du rafraîchissement : ' + pages);
    check(has('1 nouvelle'), 'résumé du rafraîchissement absent');
    check(has('2 ignorées'), 'entrées ignorées (skipped) du rafraîchissement non affichées');
    check(api.st.calls.some((c) => c === 'cards part curseur-1'), 'le curseur opaque next_part n\'est pas renvoyé tel quel');
    check(cardCalls(mark).length === 1 && /\?since=\d+$/.test(cardCalls(mark)[0]), 'après le rafraîchissement : un seul ?since attendu, ' + cardCalls(mark).join(', '));
    await goTab('cartes');
    check(has('Nouvelles du dernier rafraîchissement'), 'raccourci des nouvelles absent');
    all((n) => n.tagName === 'BUTTON' && n.classList.contains('chip') && text(n).includes('Nouvelles du dernier rafraîchissement'))[0].click();
    await settle();
    check(cls('cell').length === 1 && cls('card__new').length === 1 && has('Nouvelle carte'), 'ruban « Nouvelle » ou raccourci des nouvelles incorrect');
    needButton('Réinitialiser les filtres').click();
    await settle();

    // 12 bis. Envoi sans deux cartes (retirées du jeu) et tags changés sur un autre appareil : au retour sur l'onglet,
    // seul ?since est lu ; les cartes retirées disparaissent, avec la fiche ouverte et la sélection qui les montraient.
    const key = ls.get('classeur-key');
    type(q, 'mirna');
    await settle();
    check(cls('cell').length === 1, 'carte « (11194) Mirna » introuvable');
    all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox')[0].click();
    await settle();
    one('card').dispatch('click');
    await settle(120);
    check(one('fiche') && one('bulk'), 'fiche ou sélection absente avant le retrait');
    const cur = (await rawApi('GET', '/api/cards', key)).body.cards;
    await rawApi('POST', '/api/tags/set', key, { card_id: 'c10', tags: [...cur.find((c) => c.id === 'c10').tags, 'Ailleurs'] });
    await sendImport(key, cur.filter((c) => c.id !== 'c2' && c.id !== 'c1000'));
    mark = apiLog.length;
    for (const f of doc.listeners.visibilitychange || []) await f();
    await settle(500);
    check(cardCalls(mark).length === 1 && /\?since=\d+$/.test(cardCalls(mark)[0]), 'retour sur l\'onglet : un seul ?since attendu, ' + cardCalls(mark).join(', '));
    check(!one('fiche') && !one('bulk'), 'la carte retirée reste ouverte ou sélectionnée');
    check(has('Collection mise à jour : 1 050 cartes.') && countIn(doc) === 1050, 'cartes retirées : 1 050 cartes attendues, ' + countIn(doc));
    check(cls('cell').length === 0, 'la carte retirée reste affichée');
    type(q, 'ailleurs');
    await settle();
    check(cls('cell').length === 1 && text(one('cell')).includes('Ailleurs'), 'le tag posé sur un autre appareil n\'est pas arrivé');

    // 12 ter. Tags changés ailleurs, sans envoi : cards_rev le dit, ?since les rapporte. Un tag posé ici pendant cette
    // lecture n'est pas écrasé par sa réponse, calculée avant lui ; la lecture suivante rapporte l'état du serveur.
    type(q, 'terre');
    await settle();
    check(cls('cell').length === 1, 'carte « Terre » introuvable');
    one('card').dispatch('click');
    await settle(120);
    const ficheTags = () => one('fiche').querySelectorAll('.tag.own').map(text).join('|');
    const expected = [ficheTags(), 'Local'].filter(Boolean).join('|');
    await rawApi('POST', '/api/tags/set', key, { card_id: 'c5', tags: ['Distant'] });
    let release = null;
    mainOpts.hold = (url) => (url.startsWith('/api/cards') ? new Promise((r) => { release = r; }) : null);
    mark = apiLog.length;
    const back = Promise.all([...(doc.listeners.visibilitychange || [])].map((f) => f()));
    check(await waitFor(() => !!release), 'tags changés ailleurs : ?since non demandé au retour sur l\'onglet');
    mainOpts.hold = null;
    type(byId('new-tag'), 'Local');
    all((n) => n.tagName === 'BUTTON' && n.getAttribute('type') === 'submit' && text(n) === 'Ajouter')[0].click();
    await settle();
    release();
    await back;
    await settle();
    check(cardCalls(mark).length === 1 && /\?since=\d+$/.test(cardCalls(mark)[0]), 'tags changés ailleurs : un seul ?since attendu, ' + cardCalls(mark).join(', '));
    check(ficheTags() === expected, 'tag posé pendant la lecture écrasé par sa réponse : ' + ficheTags() + ' au lieu de ' + expected);
    mark = apiLog.length;
    for (const f of doc.listeners.visibilitychange || []) await f();
    await settle();
    check(cardCalls(mark).length === 1 && ficheTags() === expected && api.st.tags.get('c5').includes('Local') && !api.st.tags.get('c5').includes('Distant'),'lecture suivante : ' + ficheTags() + ', ' + cardCalls(mark).join(', '));
    win.listeners.keydown.forEach((fn) => fn({ key: 'Escape', preventDefault() {} }));
    await settle(500);
    type(q, '');
    await settle();
  }

  // 13. HAR : seuls l'adresse et le cookie des requêtes vers le jeu partent
  if (!SERVER) {
    await goTab('maj');
    const fileInput = all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'file')[0];
    const har = { log: { entries: [
      { request: { url: 'https://www.wiki-masters.com/api/my-collection?page=0', headers: [{ name: 'cookie', value: 'sb=har' }, { name: 'authorization', value: 'secret' }] }, response: { content: { text: 'PRIVÉ' } } },
      { request: { url: 'https://autre.example/', headers: [{ name: 'Cookie', value: 'autre=1' }] } },
    ] } };
    fileInput.files = [{ text: async () => JSON.stringify(har) }];
    fileInput.dispatch('change');
    await settle(200);
    const sent = JSON.stringify(api.st.lastSession);
    check(sent === '{"har":{"log":{"entries":[{"request":{"url":"https://www.wiki-masters.com/api/my-collection?page=0","headers":[{"name":"Cookie","value":"sb=har"}]}}]}}}', 'HAR envoyé : ' + sent);
  }
  await settle(200);

  const openLink = async (key) => {
    ctx.location.hash = '#cle=' + key;
    for (const f of win.listeners.hashchange || []) f();
    for (let i = 0; i < 40; i++) { await settle(25); if (!has('Ouverture du classeur')) break; }
    await settle(100);
  };
  const exactButton = (t) => { const b = all((n) => n.tagName === 'BUTTON' && text(n).trim() === t)[0]; if (!b) fail('bouton absent : ' + t + '\n' + text(doc.body).slice(-600)); return b; };
  const modalButton = (t) => { const m = one('modal'); const b = m && m.querySelectorAll('button').filter((n) => text(n).trim() === t)[0]; if (!b) fail('bouton absent de la fenêtre : ' + t); return b; };
  const waitH1 = async (name) => { for (let i = 0; i < 200 && !h1().includes(name); i++) await settle(25); };
  const myKey = ls.get('classeur-key');

  // 14. Lien d'un autre classeur : vérifié, puis demandé ; la clé gardée n'est pas écrasée sans accord
  const otherKey = await makeOtherAccount('Bob');
  await openLink(otherKey);
  check(ctx.location.hash === '', 'fragment #cle= non effacé');
  check(has('Ouvrir le classeur de Bob à la place du tien ?'), 'pas de question avant d\'ouvrir un autre classeur');
  check(ls.get('classeur-key') === myKey, 'clé écrasée avant confirmation');
  exactButton('Garder le mien').click();
  await settle(100);
  check(ls.get('classeur-key') === myKey && h1().includes('Cédric') && !one('modal'), '« Garder le mien » ne garde pas le classeur');
  await openLink(otherKey);
  modalButton('Ouvrir').click();
  await waitH1('Bob');
  check(ls.get('classeur-key') === otherKey && h1() === 'Le classeur de Bob', "« Ouvrir » n'ouvre pas l'autre classeur");
  check(JSON.parse(ls.get('classeur-known') || '[]').length === 2, 'liste des classeurs connus incomplète');
  await goTab('reglages');
  check(has('Autres classeurs ouverts dans ce navigateur') && has('Classeur de Cédric'), 'retour à son classeur absent des Réglages');
  mark = apiLog.length;
  exactButton('Ouvrir').click();
  await waitH1('Cédric');
  check(ls.get('classeur-key') === myKey && h1().includes('Cédric'), 'retour à son classeur impossible');
  {
    // Ses cartes, gardées dans ce navigateur au changement de classeur, sont à jour (même cards_rev) : rien à relire.
    await settle(100);
    const n = (await rawApi('GET', '/api/cards', myKey)).body.cards.length;
    check(countIn(doc) === n && !cardCalls(mark).length, 'retour à son classeur : cartes du cache sans lecture attendues, ' + countIn(doc) + ' cartes, ' + cardCalls(mark).join(', '));
    check(cachedCards().length === 2 && cachedCards().every((r) => r.v === 1 && Number.isInteger(r.rev) && Array.isArray(r.cards) && !('_k' in (r.cards[0] || {}))),
      'cache : un enregistrement par classeur, cartes telles que l\'API les renvoie');
  }

  // 15. Lien tronqué ou inconnu : refusé avec un message clair, jamais enregistré
  await openLink(myKey.slice(0, 20));
  check(has('incomplet ou abîmé') && ls.get('classeur-key') === myKey, 'lien tronqué mal géré');
  const unknownKey = 'Z'.repeat(43);
  await openLink(unknownKey);
  check(has('ne correspond à aucun classeur') && ls.get('classeur-key') === myKey, 'lien inconnu mal géré');
  check(!(ls.get('classeur-known') || '').includes(unknownKey), 'clé inconnue enregistrée');

  // 16. Changer ma clé : nouveau lien montré, ancienne clé oubliée
  await goTab('reglages');
  check(has("Un lien ouvert reste dans l'historique du navigateur"), "l'avertissement sur l'historique manque");
  needButton('Changer ma clé').click();
  await settle();
  check(has('Changer ma clé ?'), 'confirmation de changement de clé absente');
  modalButton('Changer ma clé').click();
  await settle(SERVER ? 300 : 80);
  const rotated = ls.get('classeur-key');
  check(rotated && rotated !== myKey && byId('new-key-link') && byId('new-key-link').value === ORIGIN + '/#cle=' + rotated, 'nouveau lien absent après changement de clé');
  check(!(ls.get('classeur-known') || '').includes(myKey), 'ancienne clé encore connue');
  exactButton("C'est noté").click();
  await settle();
  const st1 = await rawApi('GET', '/api/me', myKey);
  check(st1.status === 401, "l'ancienne clé marche encore (" + st1.status + ')');

  // 17. Régénérer le favori : nouvelle clé d'import, nouveau favori
  const oldImport = importKey;
  needButton('Régénérer le favori').click();
  await settle();
  modalButton('Régénérer le favori').click();
  await settle(SERVER ? 300 : 80);
  const newImport = Object.values(JSON.parse(ls.get('classeur-import-key') || '{}'))[0];
  const bm2 = all((n) => n.tagName === 'A' && n.classList.contains('bookmarklet'))[0];
  check(newImport && newImport !== oldImport && bm2 && decodeURI(bm2.getAttribute('href').slice(11)).includes('"' + newImport + '"'), 'favori non régénéré');
  check(tabBtn('maj').getAttribute('aria-selected') === 'true', "après régénération, l'onglet du favori doit s'ouvrir");

  // 18. Oublier ce navigateur : clé, classeurs connus, clé d'import, caches de Wikipédia
  await sleep(1600);
  check(ls.get('classeur-pv') && ls.get('classeur-sugg'), 'caches attendus avant l\'oubli');
  await goTab('reglages');
  needButton('Oublier ce navigateur').click();
  await settle();
  modalButton('Oublier ce navigateur').click();
  await settle(100);
  check(has("J'ai déjà un lien"), "oublier ce navigateur ne ramène pas à l'accueil");
  const left = ['classeur-key', 'classeur-pv', 'classeur-sugg', 'classeur-import-key', 'classeur-known', 'classeur-target', 'classeur-qid', 'classeur-cats', 'classeur-catinfo', 'classeur-propose-at', 'classeur-natgroup', 'classeur-tagcats'].filter((k) => ls.has(k));
  check(!left.length, 'encore gardé après « Oublier ce navigateur » : ' + left.join(', '));
  await sleep(1700);
  check(!cachedCards().length, 'cartes encore gardées (IndexedDB) après « Oublier ce navigateur » : ' + cachedCards().length);

  // 19. Lien personnel sans clé gardée : vérifié puis adopté sans question, fragment effacé
  mark = apiLog.length;
  await openLink(rotated);
  await waitH1('Cédric');
  check(ctx.location.hash === '' && ls.get('classeur-key') === rotated && h1() === 'Le classeur de Cédric' && has('Mes collections'), 'le lien personnel n\'ouvre pas le classeur');
  check(cardCalls(mark)[0] === 'GET /api/cards?part=0', 'sans cache, relecture complète attendue : ' + cardCalls(mark).join(', '));

  // 20. Le classeur rouvert dans une autre page (même navigateur) : cartes du cache affichées avant toute réponse de
  // /api/cards, puis seulement ce qui a changé entre-temps (une carte retirée, un tag posé ailleurs).
  {
    await sleep(1700); // écriture du cache (regroupée)
    const key = ls.get('classeur-key');
    const me = (await rawApi('GET', '/api/me', key)).body;
    const cur = (await rawApi('GET', '/api/cards', key)).body.cards;
    const n0 = cur.length;
    const rec = cachedCards().find((r) => r.user === me.user.id);
    check(rec && rec.rev === me.cards_rev && rec.cards.length === n0, 'cache non écrit après la relecture : ' + (rec ? rec.rev + ' / ' + me.cards_rev + ', ' + rec.cards.length + ' / ' + n0 : 'absent'));
    await rawApi('POST', '/api/tags/set', key, { card_id: 'c11', tags: ['Vu ailleurs'] });
    await sendImport(key, cur.filter((c) => c.id !== 'c12'));
    let open = null;
    const gate = new Promise((r) => { open = r; });
    mark = apiLog.length;
    const p2 = openPage({ hold: (url) => (url.startsWith('/api/cards') ? gate : null) });
    check(await waitFor(() => p2.count() === n0), 'deuxième page : les cartes du cache ne s\'affichent pas avant la réponse de /api/cards (' + p2.count() + ')');
    check(cardCalls(mark).length === 1 && cardCalls(mark)[0] === 'GET /api/cards?since=' + rec.rev, 'deuxième page : ?since=' + rec.rev + ' attendu, ' + cardCalls(mark).join(', '));
    open();
    check(await waitFor(() => p2.count() === n0 - 1), 'deuxième page : la carte retirée reste (' + p2.count() + ')');
    await settle(100);
    check(cardCalls(mark).length === 1, 'deuxième page : lectures en trop, ' + cardCalls(mark).join(', '));
    p2.doc.getElementById('tab-cartes').click();
    await settle();
    const q2 = p2.doc.getElementById('q');
    q2.value = 'vu ailleurs';
    q2.dispatch('input');
    await settle();
    check(p2.doc.querySelectorAll('.cell').length === 1, 'deuxième page : le tag posé ailleurs n\'est pas arrivé');

    // 21. Rien n'a changé depuis : aucune lecture des cartes, tout vient du cache.
    await sleep(1700);
    mark = apiLog.length;
    const p3 = openPage();
    check(await waitFor(() => p3.count() === n0 - 1), 'troisième page : cartes du cache absentes (' + p3.count() + ')');
    await settle(200);
    check(!cardCalls(mark).length, 'troisième page : rien n\'a changé, aucune lecture attendue : ' + cardCalls(mark).join(', '));

    // 22. Base recréée (cards_rev plus petit que la révision gardée) : cache ignoré et effacé, relecture complète.
    if (!SERVER) {
      api.st.rev = 1;
      api.st.changed = new Map();
      mark = apiLog.length;
      const p4 = openPage({ hold: (url) => (url.startsWith('/api/cards') ? sleep(300) : null) });
      await sleep(150);
      check(p4.count() === null, 'base recréée : les cartes du cache ne doivent pas s\'afficher (' + p4.count() + ')');
      check(await waitFor(() => p4.count() === n0 - 1) && cardCalls(mark)[0] === 'GET /api/cards?part=0' && !cardCalls(mark).some((x) => x.includes('since')),
        'base recréée : relecture complète attendue, ' + cardCalls(mark).join(', '));
      check(await waitFor(() => (cachedCards().find((r) => r.user === api.st.id) || {}).rev === 1), 'base recréée : cache non réécrit avec la nouvelle révision');
    }

    // 23. IndexedDB absent ou refusé (navigation privée, stockage bloqué) : la page lit tout au serveur, comme avant.
    for (const mode of ['absent', 'refusé']) {
      mark = apiLog.length;
      const p = openPage({ idb: mode });
      check(await waitFor(() => p.count() === n0 - 1) && cardCalls(mark)[0] === 'GET /api/cards?part=0', `IndexedDB ${mode} : relecture complète attendue, ` + cardCalls(mark).join(', '));
    }

    // 24. Ancien serveur (ni rev ni cards_rev) : pas de cache ni de ?since ; un nouvel envoi (fetched_at) au retour sur
    // l'onglet relit tout, comme avant.
    if (!SERVER) {
      api.noRev = true;
      mark = apiLog.length;
      const p5 = openPage();
      check(await waitFor(() => p5.count() === n0 - 1) && cardCalls(mark).every((x) => x.includes('?part=')) && cardCalls(mark).length === 3, 'ancien serveur : relecture complète attendue, ' + cardCalls(mark).join(', '));
      const cur2 = (await rawApi('GET', '/api/cards', key)).body.cards;
      await sendImport(key, [...cur2, { ...cur2[0], id: 'ancien-serveur', title: 'Carte de l\'ancien serveur' }]);
      mark = apiLog.length;
      await p5.visible();
      check(await waitFor(() => p5.count() === n0) && cardCalls(mark)[0] === 'GET /api/cards?part=0' && !cardCalls(mark).some((x) => x.includes('since')),
        'ancien serveur : un nouvel envoi doit tout relire, ' + cardCalls(mark).join(', '));
      api.noRev = false;
    }
  }

  // Icônes : toutes celles utilisées existent dans le sprite.
  const missing = [...new Set(usedIcons())].filter((i) => !ctx.__symbols.includes(i));
  check(!missing.length, 'icônes absentes du sprite : ' + missing.join(', '));
  if (errors.length) fail('erreurs pendant le rendu :\n' + errors.join('\n'));
  noVue();
  console.log(`appels Wikimedia simulés : ${wikiCalls}`);
  console.log('UI OK');
  process.exit(0);
}

// Sans Vue (cdnjs bloqué) : le fragment #cle= est quand même effacé, et la page le dit.
function noVue() {
  const { doc } = makeDom();
  const box = doc.createElement('div');
  box.setAttribute('id', 'app');
  doc.body.appendChild(box);
  const ctx = { document: doc, location: { hash: '#cle=' + 'Q'.repeat(43), pathname: '/', search: '' }, console };
  ctx.history = { replaceState: () => { ctx.location.hash = ''; } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(PUB, 'assets', 'app.js'), 'utf8'), ctx, { filename: 'app.js' });
  if (ctx.location.hash !== '') fail('sans Vue, le fragment #cle= reste dans la barre d\'adresse');
  if (!/Vue/.test(box.textContent)) fail('sans Vue, aucun message : ' + box.textContent);
}

// Exécute le favori dans une fausse page wiki-masters.com : 1 100 exemplaires (1 050 cartes), envoi par morceaux.
async function runBookmarklet(code, classeurFetch, key) {
  const { doc } = makeDom();
  const posts = [];
  const entries = [];
  for (let i = 0; i < 1100; i++) {
    const id = i < 1050 ? 'c' + i : 'c' + (i - 1050);
    const special = id === 'c0' ? { title: 'Rihanna', rarity: 'L', cat: 'chanteuse barbadienne' } : null;
    entries.push({ id: 'e' + i, card_id: id, user_id: 'SECRET', tags: [{ name: 'jeu' }], count: 1, is_shiny: i === 1060, starred: false, obtained_at: `2026-10-${String(10 + (i % 5)).padStart(2, '0')}T10:00:00Z`,
      card: { id, atk: 100 + i, def: 50, lang: 'fr', rarity: special ? special.rarity : ['C', 'PC', 'R', 'SR', 'UR'][i % 5], q_score: 12.5, category: special ? special.cat : 'catégorie ' + (i % 7), image_url: i % 3 ? null : 'https://upload.wikimedia.org/x' + i + '.jpg', pageviews: i * 3, created_at: 'x', hide_image: i === 3, wikipedia_url: 'https://fr.wikipedia.org/wiki/A' + i, wikipedia_title: special ? special.title : (i < 1050 ? 'Article ' + i : 'Article ' + (i - 1050)) } });
  }
  entries[2].card.wikipedia_title = '(11194) Mirna';
  entries[5].card.wikipedia_title = 'Terre';
  entries[6].card.wikipedia_title = 'Hydrogène (élément)';
  // Exemplaires relus (même entry.id) : comptés une seule fois. Entrées inexploitables : ignorées et annoncées.
  for (let i = 0; i < 5; i++) entries.push(JSON.parse(JSON.stringify(entries[i])));
  entries.push({ id: 'x1', card_id: 'bad1', count: 1, card: { id: 'bad1', wikipedia_title: '', rarity: 'C' } });
  entries.push({ id: 'x2', card_id: 'bad2', count: 1, card: { id: 'bad2', wikipedia_title: 'Truc', rarity: 'X' } });
  entries.push({ id: 'x3', count: 1 });
  const pageFetch = async (url, init = {}) => {
    if (url === '/api/my-collection/stats?sort=rarity') return { ok: true, status: 200, json: async () => ({ total: 1100, totalUnique: 1050, rarityCounts: {}, tagOptions: [] }) };
    const m = url.match(/^\/api\/my-collection\?sort=rarity&page=(\d+)&stats=0$/);
    if (m) { const p = Number(m[1]); return { ok: true, status: 200, json: async () => ({ collection: JSON.parse(JSON.stringify(entries.slice(p * 50, p * 50 + 50))) }) }; }
    if (url === ORIGIN + '/api/import') {
      if (init.headers['X-Classeur-Key'] !== key) throw new Error('clé absente');
      const body = JSON.parse(init.body);
      // Demande d'état de la synchro (mode state) : pas un morceau d'import.
      if (body.mode !== 'state') posts.push(body);
      return classeurFetch('/api/import', init);
    }
    throw new Error('favori : adresse inattendue ' + url);
  };
  const realSet = setTimeout;
  const ctx = { document: doc, location: { hostname: 'wiki-masters.com' }, fetch: pageFetch, setTimeout: (f) => realSet(f, 0), Promise, JSON, Math, Date, Number, String, Array, Error, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  for (let i = 0; i < 300 && !/envoyées|répondu|Connecte|n'a pas/.test(doc.getElementById('classeur-favori').textContent); i++) await new Promise((r) => realSet(r, 5));
  const box = doc.getElementById('classeur-favori').textContent;
  const flat = box.replace(/[  ]/g, ' ');
  if (!/1 050 cartes envoyées au classeur/.test(flat)) fail('favori : message final inattendu : ' + box);
  if (!/3 cartes ignorées/.test(flat)) fail('favori : entrées ignorées non annoncées : ' + box);
  if (posts.length !== 3) fail('favori : 3 morceaux attendus, ' + posts.length);
  const ids = new Set();
  posts.forEach((b, i) => {
    if (b.part !== i || b.last !== (i === 2) || b.source !== 'bookmarklet' || typeof b.upload_id !== 'string' || b.upload_id !== posts[0].upload_id) fail('favori : en-tête de morceau incorrect ' + JSON.stringify({ ...b, cards: b.cards.length }));
    if (i === 0 ? !b.stats || b.stats.totalUnique !== 1050 : b.stats) fail('favori : stats au premier morceau seulement');
    if (b.cards.length > 500) fail('favori : morceau trop gros');
    for (const c of b.cards) {
      ids.add(c.id);
      const keys = Object.keys(c).sort().join(',');
      if (keys !== 'atk,category,count,def,id,image,obtained_at,pageviews,quality,rarity,shiny,starred,title,url') fail('favori : champs de CarteImport ' + keys);
    }
  });
  const all = posts.flatMap((b) => b.cards);
  if (ids.size !== 1050 || all.length !== 1050) fail('favori : regroupement par carte incorrect');
  if (JSON.stringify(posts).includes('SECRET') || JSON.stringify(posts).includes('"jeu"')) fail('favori : user_id ou tags du jeu envoyés');
  const c0 = all.find((c) => c.id === 'c0');
  if (c0.count !== 2 || c0.obtained_at !== '2026-10-10T10:00:00Z' || c0.title !== 'Rihanna') fail('favori : exemplaires mal regroupés ' + JSON.stringify(c0));
  if (!all.find((c) => c.id === 'c10').shiny) fail('favori : brillante perdue');
  if (all.find((c) => c.id === 'c3').image !== null) fail('favori : hide_image ignoré');
  if (all.find((c) => c.id === 'c0').image !== 'https://upload.wikimedia.org/x0.jpg') fail('favori : image perdue');
  // Hors du jeu : le message demande d'ouvrir wiki-masters.com.
  const other = makeDom();
  const ctx2 = { document: other.doc, location: { hostname: 'exemple.fr' }, fetch: () => { throw new Error('ne doit rien lire'); }, setTimeout, Promise, JSON, Math, Date, Number, String, Array, Error, console };
  ctx2.window = ctx2;
  vm.createContext(ctx2);
  vm.runInContext(code, ctx2);
  if (!/Ouvre wiki-masters\.com/.test(other.doc.getElementById('classeur-favori').textContent)) fail('favori : message hors du jeu absent');
  return { parts: posts.length, cards: all.length, message: box };
}

main().catch((e) => fail(e.stack || e.message));
