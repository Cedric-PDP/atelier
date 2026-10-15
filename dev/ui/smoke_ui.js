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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ API simulée (contrat SPEC.md), plusieurs comptes
// Clés de 43 caractères comme les vraies ; `api.st` = le premier compte (celui que crée le parcours).
function mockApi() {
  const users = [];
  const calls = [];
  let seq = 0;
  const mk = (p) => (p + '_'.repeat(43)).slice(0, 43);
  const json = (status, body) => ({ status, body });
  function makeUser(name) {
    const u = { id: 'u' + ++seq, key: mk('cle' + seq), importKey: null, name: name || null, cards: [], tags: new Map(), targets: [], fetched_at: null,
      new_ids: [], cookie: false, expired: false, uploads: new Map(), calls };
    users.push(u);
    return u;
  }
  function importCards(st, list, stats) {
    const before = new Set(st.cards.map((c) => c.id));
    const first = st.fetched_at === null;
    st.cards = list;
    st.fetched_at = new Date().toISOString();
    st.new_ids = first ? [] : list.filter((c) => !before.has(c.id)).map((c) => c.id);
    return { count: list.length, new_ids: st.new_ids, complete: stats ? stats.totalUnique === list.length : null };
  }
  return {
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
          has_import_key: !!st.importKey, session: { has_cookie: st.cookie, expired: st.expired, updated_at: st.cookie ? '2026-10-15T10:00:00Z' : null } });
      }
      if (p === '/api/me' && method === 'PATCH') { st.name = body.name; return json(200, { user: { id: st.id, name: st.name } }); }
      if (p === '/api/me' && method === 'DELETE') { users.splice(users.indexOf(st), 1); return json(200, { ok: true }); }
      if (p === '/api/import-key' && method === 'POST') { st.importKey = mk('import' + ++seq); return json(200, { import_key: st.importKey }); }
      if (p === '/api/key/rotate' && method === 'POST') { st.key = mk('tourne' + ++seq); return json(200, { key: st.key }); }
      if (p === '/api/cards' || p.startsWith('/api/cards?')) {
        // Lecture par morceaux comme le vrai serveur, avec un curseur opaque (chaîne) : 400 cartes par morceau ici.
        const q = new URL('http://x' + p).searchParams.get('part');
        const all = st.cards.map(cardOut);
        if (q === null) return json(200, { fetched_at: st.fetched_at, cards: all, new_ids: st.new_ids });
        const n = q === '0' ? 0 : Number(String(q).replace(/^curseur-/, ''));
        if (!Number.isInteger(n)) return json(400, { error: 'curseur invalide' });
        const size = 400, last = Math.max(0, Math.ceil(all.length / size) - 1);
        calls.push('cards part ' + q);
        return json(200, { fetched_at: st.fetched_at, cards: all.slice(n * size, (n + 1) * size), new_ids: st.new_ids, part: q, next_part: n < last ? 'curseur-' + (n + 1) : null });
      }
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
        const list = st.cards.concat([{ id: 'new1', title: 'Nouvelle carte', rarity: 'SR', atk: 5, def: 6, quality: 1, pageviews: 3000, category: 'test', image: null, url: null, count: 1, shiny: true, starred: false, obtained_at: '2026-10-15T09:00:00Z' }]);
        return json(200, { done: true, ...importCards(st, list, { totalUnique: list.length + 1 }), skipped: 2 });
      }
      if (p === '/api/tags/set') { st.tags.set(body.card_id, body.tags); return json(200, { tags: body.tags }); }
      if (p === '/api/tags/bulk') {
        if (body.add.includes('QUOTA')) return json(503, { error: 'La base du classeur est pleine pour aujourd\'hui (quota gratuit atteint) : réessaie demain.' });
        for (const id of body.card_ids) { let t = st.tags.get(id) || []; t = t.filter((x) => !body.remove.includes(x)); for (const a of body.add) if (!t.includes(a)) t.push(a); st.tags.set(id, t); }
        return json(200, { ok: true });
      }
      if (p === '/api/tags/rename') { for (const [id, t] of st.tags) st.tags.set(id, [...new Set(t.map((x) => (x === body.from ? body.to : x)))]); return json(200, { ok: true }); }
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
}

// ------------------------------------------------------------------ Wikipédia et Wikidata simulés
const WIKI = {
  Zeus: { q: 'Q34201', desc: 'dieu grec', thumb: 'https://upload.wikimedia.org/z.jpg', pv: 40000 },
  'Héra': { q: 'Q38012', desc: 'déesse grecque', pv: 3000 },
  'Poséidon': { q: 'Q41127', desc: 'dieu grec de la mer', pv: 800 },
  Mercure: { disamb: true },
  Rihanna: { q: 'Q36844', desc: 'chanteuse barbadienne', pv: 30000 },
  'Abeille domestique': { q: 'Q30034', desc: "espèce d'insectes", pv: 100 },
};
const REDIRECTS = { 'Poseidon': 'Poséidon' };
let wikiCalls = 0;
let pvContinueSeen = false;
function wikiHandle(url) {
  wikiCalls++;
  const u = new URL(url);
  if (u.hostname === 'query.wikidata.org') {
    const q = u.searchParams.get('query');
    if (/P279\+/.test(q)) return { results: { bindings: [] } };
    const b = [];
    const add = (item, p, v, l, f) => b.push({ item: { type: 'uri', value: 'http://www.wikidata.org/entity/' + item }, p: { type: 'uri', value: 'http://www.wikidata.org/prop/direct/' + p }, v: { type: 'uri', value: 'http://www.wikidata.org/entity/' + v }, ...(l ? { l: { type: 'literal', value: l } } : {}), ...(f ? { f: { type: 'literal', value: f } } : {}) });
    if (/Q36844/.test(q)) { add('Q36844', 'P31', 'Q5', 'être humain'); add('Q36844', 'P21', 'Q6581072', 'féminin'); add('Q36844', 'P106', 'Q177220', 'chanteur ou chanteuse', 'chanteuse'); add('Q36844', 'P27', 'Q244', 'Barbade'); }
    if (/Q30034/.test(q)) add('Q30034', 'P31', 'Q16521', 'taxon');
    return { results: { bindings: b } };
  }
  const p = Object.fromEntries(u.searchParams);
  if (p.origin !== '*' || p.format !== 'json' || p.formatversion !== '2') throw new Error('paramètres Wikipédia manquants : ' + url);
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
  const ctx = {
    console: { log: console.log, warn: (...a) => { errors.push('warn: ' + a.join(' ')); }, error: (...a) => { errors.push('error: ' + a.map((x) => (x && x.stack) || x).join(' ')); } },
    document: doc, window: null, navigator: { clipboard: { writeText: async () => {} } },
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
    queueMicrotask,
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.addEventListener = win.addEventListener;
  ctx.removeEventListener = win.removeEventListener;
  ctx.fetch = async (url, init = {}) => {
    const headers = init.headers || {};
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (/^https:\/\/(fr\.wikipedia\.org|query\.wikidata\.org)\//.test(url)) {
      const data = wikiHandle(url);
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => data };
    }
    if (url === '/catalog.json' || url === '/assets/bookmarklet.js') {
      const file = path.join(PUB, url);
      const text = fs.readFileSync(file, 'utf8');
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => JSON.parse(text), text: async () => text };
    }
    if (!url.startsWith('/api/')) throw new Error('adresse inattendue : ' + url);
    if (SERVER) {
      const r = await fetch(SERVER + url, { method, headers, body: init.body });
      const text = await r.text();
      return { ok: r.ok, status: r.status, headers: r.headers, json: async () => JSON.parse(text) };
    }
    const r = api.handle(method, url, headers, body);
    return { ok: r.status < 400, status: r.status, headers: { get: () => null }, json: async () => JSON.parse(JSON.stringify(r.body)) };
  };
  vm.createContext(ctx);

  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  // L'index charge Vue depuis cdnjs (avec SRI) puis /assets/app.js.
  if (!/vue\.runtime\.global\.prod\.min\.js" integrity="sha384-/.test(html)) fail('Vue (runtime) avec SRI absent de index.html');
  for (const id of [...html.matchAll(/<symbol id="([\w-]+)"/g)].map((m) => m[1])) ctx.__symbols = (ctx.__symbols || []).concat(id);
  const app = doc.createElement('div');
  app.setAttribute('id', 'app');
  doc.body.appendChild(app);
  vm.runInContext(fs.readFileSync(VUE, 'utf8'), ctx, { filename: 'vue.js' });
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

  // 2. Classeur vide : invitation à utiliser le favori ou le cookie
  check(has('Ton classeur est vide') && has('Installer le favori') && has('Coller le cookie'), 'invitation du classeur vide absente');
  needButton('Installer le favori').click();
  await settle(60);
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
  const importKey = JSON.parse(ls.get('classeur-import-key') || '{}').key;
  check(importKey && importKey !== ls.get('classeur-key'), "clé d'import non gardée (classeur-import-key)");
  check(bmCode.includes('"' + ORIGIN + '"') && bmCode.includes('"' + importKey + '"'), "clé d'import ou origine absente du favori");
  check(!bmCode.includes(ls.get('classeur-key')), 'la clé principale ne doit jamais être dans le favori');
  try { new vm.Script(bmCode); } catch (e) { fail('favori : code invalide une fois sur une ligne : ' + e.message); }
  check(byId('bm-url') && byId('bm-url').value === href, "texte du favori à copier absent");
  bm.dispatch('click');
  await settle();
  check(has('Pas ici'), 'clic sur le favori dans le classeur non intercepté');
  win.listeners.keydown.forEach((f) => f({ key: 'Escape', preventDefault() {} }));
  await settle(400);
  check(!one('modal'), 'Échap ne ferme pas la fenêtre');

  // 3. Le favori sur wiki-masters.com : lecture simulée, regroupement, envoi par morceaux
  const imports = await runBookmarklet(bmCode, ctx.fetch, importKey);
  if (!SERVER) {
    const ups = [...api.st.uploads.values()];
    check(ups.length === 1, 'un seul envoi attendu');
    check(api.st.lastImportKey === importKey, "l'import n'a pas utilisé la clé d'import");
  }
  console.log(`favori : ${imports.parts} morceaux, ${imports.cards} cartes, message « ${imports.message} »`);
  // Retour sur l'onglet du classeur : il se met à jour tout seul.
  for (const f of doc.listeners.visibilitychange || []) await f();
  await settle(80);
  check(has('Collection mise à jour'), "le retour sur l'onglet ne recharge pas la collection");
  check(cls('sleeve').length === 120, `120 pochettes attendues, ${cls('sleeve').length} affichées`);
  check(has('Afficher plus'), 'bouton Afficher plus absent');
  needButton('Afficher plus').click();
  await settle();
  check(cls('sleeve').length > 120, 'Afficher plus sans effet');

  // 4. Barre d'outils : recherche, rareté, tri
  const q = byId('q');
  type(q, 'rihanna');
  await settle();
  check(cls('sleeve').length === 1 && has('Rihanna'), 'la recherche ne filtre pas');
  type(q, '');
  const pills = cls('rpill');
  check(pills.length === 6 && text(pills[0]).startsWith('L'), 'pastilles de rareté absentes');
  pills[0].dispatch('click', { ctrlKey: true });
  await settle();
  check(cls('sleeve').every((s) => text(s.querySelector('.rar')).startsWith('L')), 'Ctrl+clic sur une rareté ne l\'isole pas');
  needButton('Réinitialiser les filtres').click();
  await settle();
  const sel = all((n) => n.tagName === 'SELECT')[0];
  sel.value = 'title';
  sel.dispatch('change');
  await settle();
  const titles = cls('face').map((f) => text(f.querySelector('.title')));
  check(titles.slice(0, 5).join('|') === titles.slice(0, 5).sort((a, b) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' })).join('|'), 'tri par titre incorrect : ' + titles.slice(0, 5).join(' | '));

  // 5. Sélection (Maj+clic) et bande de sélection
  const picks = all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox');
  picks[0].click();
  await settle();
  picks[4].click({ shiftKey: true });
  await settle();
  check(one('bulk') && text(one('bulk').querySelector('.count')) === '5', 'Maj+clic : 5 cartes attendues, ' + text(one('bulk') && one('bulk').querySelector('.count')));
  type(byId('bulk-tag'), '  À  échanger ');
  needButton('Ajouter').click();
  await settle();
  check(has('« À échanger » ajouté à 5 cartes.'), 'ajout groupé sans confirmation');
  if (!SERVER) check(api.st.calls.some(([m, p, b]) => p === '/api/tags/bulk' && b.card_ids.length === 5 && b.add[0] === 'À échanger'), 'appel tags/bulk incorrect');
  check(all((n) => n.classList.contains('tab') && text(n).includes('À échanger')).length === 1, 'le tag n\'apparaît pas dans le dos');
  // Quota ou base pleine : le 503 du serveur s'affiche tel quel.
  if (!SERVER) {
    type(byId('bulk-tag'), 'QUOTA');
    needButton('Ajouter').click();
    await settle();
    check(has("La base du classeur est pleine pour aujourd'hui (quota gratuit atteint) : réessaie demain."), "le 503 (quota) ne s'affiche pas tel quel");
  }
  needButton('Vider la sélection').click();
  await settle(400);
  check(!one('bulk'), 'la bande de sélection reste');

  // 6. Filtre par tag, renommage
  const tagTab = all((n) => n.classList.contains('tag-row') && text(n).includes('À échanger'))[0];
  tagTab.querySelector('.open').click();
  await settle();
  check(text(all((n) => n.tagName === 'H2' && n.parentNode.classList.contains('titles'))[0]) === 'À échanger' && cls('sleeve').length === 5, 'le filtre par tag ne marche pas');
  tagTab.querySelector('.edit').dispatch('click');
  await settle();
  type(byId('tag-to'), 'Échange');
  all((n) => n.tagName === 'BUTTON' && text(n) === 'Renommer')[0].click();
  await settle();
  check(has('renommé en « Échange »') && cls('sleeve').length === 5, 'renommage du tag incorrect');
  showAlbum: {
    all((n) => n.tagName === 'BUTTON' && text(n).includes("Tout l'album"))[0].dispatch('click');
    await settle();
  }

  // 7. Fiche : tags, suggestions Wikidata (métier au féminin, pays), validation
  type(q, 'rihanna');
  await settle();
  one('face').dispatch('click');
  await settle(120);
  const drawer = one('drawer');
  check(drawer && text(drawer).includes('Rihanna') && text(drawer).includes('Légendaire (L)'), 'fiche absente');
  check(text(drawer).includes('Chanteuse') && text(drawer).includes('Barbade'), 'suggestions Wikidata absentes : ' + text(drawer).slice(-200));
  check(!text(drawer).includes('Être humain'), '« être humain » ne doit pas être suggéré');
  one('drawer').querySelectorAll('button').filter((b) => text(b).includes('Valider les suggestions'))[0].click();
  await settle();
  if (!SERVER) check(JSON.stringify(api.st.tags.get('c0')) === '["Chanteuse","Barbade"]', 'tags/set après validation : ' + JSON.stringify(api.st.tags.get('c0')));
  type(byId('new-tag'), 'Musique');
  all((n) => n.tagName === 'BUTTON' && n.getAttribute('type') === 'submit' && text(n) === 'Ajouter')[0].click();
  await settle();
  check(text(one('drawer')).includes('Musique'), 'ajout de tag dans la fiche sans effet');
  win.listeners.keydown.forEach((f) => f({ key: 'Escape', preventDefault() {} }));
  await settle(500);
  check(!one('drawer'), 'Échap ne ferme pas la fiche');
  type(q, '');

  // 8. Suggestions pour toute la collection (vue Tags)
  needButton('Calculer les suggestions pour toute la collection').click();
  await settle(400);
  check(has('Suggestions : ') && has('sur 1 049 cartes'), 'progression des suggestions absente');
  needButton('Arrêter').click();
  await settle();
  check(has('Calculer les suggestions pour toute la collection'), 'Arrêter sans effet');

  // 9. Catalogue : ajout d'une collection proposée, ouverture, cases vides
  needButton('Collections proposées').click();
  await settle(80);
  check(has('Bêtes et terroir') && has('Races bovines'), 'catalogue non affiché');
  const addBtn = all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Ajouter la collection Planètes du Système solaire')[0];
  check(addBtn, 'bouton Ajouter du catalogue absent');
  addBtn.click();
  await settle(80);
  if (!SERVER) check(api.st.targets.some((t) => t.source === 'catalog:planetes' && t.items.length === 9), 'collection du catalogue mal enregistrée');
  needButton('Ouvrir').click();
  await settle(80);
  check(has('il en manque') && cls('empty').length > 0, 'cases vides absentes');

  // 10. Nouvelle collection : vérification sur Wikipédia (redirection, homonymie, introuvable)
  needButton('Nouvelle collection').click();
  await settle();
  type(byId('ed-name'), "Dieux de l'Olympe");
  type(byId('ed-text'), 'zeus\nPoseidon\nhttps://fr.wikipedia.org/wiki/H%C3%A9ra\nMercure\nInexistant\nRihanna\n');
  needButton('Enregistrer').click();
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
  }
  check(has('1 sur 6 cartes') && has('il en manque 5'), 'en-tête de la collection incorrect');
  for (let i = 0; i < 40 && has('Rareté estimée des cases vides'); i++) await sleep(100);
  check(pvContinueSeen, 'la continuation des vues (pvipcontinue) n\'est pas suivie');
  const ests = cls('est').map(text);
  check(ests.includes('≈L') && ests.includes('≈SR') && ests.includes('≈R'), 'raretés estimées : ' + ests.join(' '));
  check(has("Page d'homonymie : précise le titre") && has('Article introuvable sur Wikipédia'), 'avertissements des cases vides absents');
  check(has('Cases vides · 5'), 'séparateur des cases vides absent');
  await sleep(1600);
  const pvCache = JSON.parse(ls.get('classeur-pv') || '{}');
  check(pvCache.Zeus && pvCache.Zeus[1][0] === 40000, 'cache des vues non écrit');

  // 11. Supprimer la collection (confirmation dans la page)
  all((n) => n.tagName === 'BUTTON' && text(n).trim() === 'Supprimer')[0].click();
  await settle();
  check(has('Supprimer « Dieux de l\'Olympe » ?'), 'confirmation de suppression absente');
  needButton('Supprimer la collection').click();
  await settle(400);
  check(!all((n) => n.classList.contains('set') && text(n).includes('Dieux')).length, 'collection non supprimée');

  // 12. Rafraîchir sans session -> fenêtre « Mettre à jour » (favori d'abord, cookie en secours) ; cookie -> boucle
  needButton('Rafraîchir la collection').click();
  await settle();
  check(byId('cookie-input'), 'la fenêtre Session ne s\'ouvre pas');
  check(has('Le favori, le chemin conseillé') && has('Le jeu renouvelle ta session régulièrement : le rafraîchissement par cookie marche en général environ une heure après le collage, et peut te déconnecter du jeu dans ton navigateur. Le favori n\'a pas ce problème.'),
    'la fenêtre Session ne présente pas le cookie comme un secours, avec son avertissement');
  type(byId('cookie-input'), 'Cookie: sb-a=1; sb-b=2');
  needButton('Enregistrer le cookie et rafraîchir').click();
  for (let i = 0; i < 300 && !(text(doc.body.querySelector('.status')).match(/expir|répond|cartes ·|nouvelle|robot/) && !has('Rafraîchissement…')); i++) await sleep(100);
  for (let i = 0; i < 300 && has('Rafraîchissement…'); i++) await sleep(100);
  await settle(100);
  if (SERVER) { console.log('rafraîchissement par cookie (faux cookie) : ' + text(doc.body.querySelector('.status'))); }
  await settle(200);
  if (!SERVER) {
    check(api.st.lastSession && api.st.lastSession.cookie === 'sb-a=1; sb-b=2', 'cookie mal envoyé : ' + JSON.stringify(api.st.lastSession));
    const pages = api.st.calls.filter(([, p]) => p === '/api/refresh').map(([, , b]) => b.page).join(',');
    check(pages === '0,10,20', 'pages du rafraîchissement : ' + pages);
    check(has('1 nouvelle'), 'résumé du rafraîchissement absent');
    check(has('2 ignorées'), 'entrées ignorées (skipped) du rafraîchissement non affichées');
    check(has('Nouvelles du dernier rafraîchissement'), 'intercalaire des nouvelles absent');
    check(api.st.calls.some((c) => c === 'cards part curseur-1'), 'le curseur opaque next_part n\'est pas renvoyé tel quel');
  }

  // 13. HAR : seuls l'adresse et le cookie des requêtes vers le jeu partent
  if (!SERVER) {
    needButton('Mettre à jour').click();
    await settle();
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
  win.listeners.keydown.forEach((f) => f({ key: 'Escape', preventDefault() {} }));
  await settle(200);

  const openLink = async (key) => {
    ctx.location.hash = '#cle=' + key;
    for (const f of win.listeners.hashchange || []) f();
    for (let i = 0; i < 40; i++) { await settle(25); if (!has('Ouverture du classeur')) break; }
    await settle(100);
  };
  const exactButton = (t) => { const b = all((n) => n.tagName === 'BUTTON' && text(n).trim() === t)[0]; if (!b) fail('bouton absent : ' + t + '\n' + text(doc.body).slice(-600)); return b; };
  const myKey = ls.get('classeur-key');

  // 14. Lien d'un autre classeur : vérifié, puis demandé ; la clé gardée n'est pas écrasée sans accord
  const otherKey = await makeOtherAccount('Bob');
  await openLink(otherKey);
  check(ctx.location.hash === '', 'fragment #cle= non effacé');
  check(has('Ouvrir le classeur de Bob à la place du tien ?'), 'pas de question avant d\'ouvrir un autre classeur');
  check(ls.get('classeur-key') === myKey, 'clé écrasée avant confirmation');
  exactButton('Garder le mien').click();
  await settle(100);
  check(ls.get('classeur-key') === myKey && has('Classeur de Cédric') && !one('modal'), '« Garder le mien » ne garde pas le classeur');
  await openLink(otherKey);
  exactButton('Ouvrir').click();
  for (let i = 0; i < 200 && !text(one('me-block')).includes('Classeur de Bob'); i++) await settle(25);
  check(ls.get('classeur-key') === otherKey && has('Classeur de Bob'), "« Ouvrir » n'ouvre pas l'autre classeur");
  check(JSON.parse(ls.get('classeur-known') || '[]').length === 2, 'liste des classeurs connus incomplète');
  needButton('Changer de classeur').click();
  await settle();
  check(has('Autres classeurs ouverts dans ce navigateur') && has('Classeur de Cédric'), 'retour à son classeur absent des Réglages');
  exactButton('Ouvrir').click();
  for (let i = 0; i < 200 && !text(one('me-block')).includes('Classeur de Cédric'); i++) await settle(25);
  check(ls.get('classeur-key') === myKey && text(one('me-block')).includes('Classeur de Cédric'), 'retour à son classeur impossible');

  // 15. Lien tronqué ou inconnu : refusé avec un message clair, jamais enregistré
  await openLink(myKey.slice(0, 20));
  check(has('incomplet ou abîmé') && ls.get('classeur-key') === myKey, 'lien tronqué mal géré');
  const unknownKey = 'Z'.repeat(43);
  await openLink(unknownKey);
  check(has('ne correspond à aucun classeur') && ls.get('classeur-key') === myKey, 'lien inconnu mal géré');
  check(!(ls.get('classeur-known') || '').includes(unknownKey), 'clé inconnue enregistrée');

  // 16. Changer ma clé : nouveau lien montré, ancienne clé oubliée
  needButton('Réglages').click();
  await settle();
  check(has("Un lien ouvert reste dans l'historique du navigateur"), "l'avertissement sur l'historique manque");
  needButton('Changer ma clé').click();
  await settle();
  check(has('Changer ma clé ?'), 'confirmation de changement de clé absente');
  exactButton('Changer ma clé').click();
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
  needButton('Réglages').click();
  await settle();
  needButton('Régénérer le favori').click();
  await settle();
  exactButton('Régénérer le favori').click();
  await settle(SERVER ? 300 : 80);
  const newImport = JSON.parse(ls.get('classeur-import-key') || '{}').key;
  const bm2 = all((n) => n.tagName === 'A' && n.classList.contains('bookmarklet'))[0];
  check(newImport && newImport !== oldImport && bm2 && decodeURI(bm2.getAttribute('href').slice(11)).includes('"' + newImport + '"'), 'favori non régénéré');
  win.listeners.keydown.forEach((f) => f({ key: 'Escape', preventDefault() {} }));
  await settle(200);

  // 18. Oublier ce navigateur : clé, classeurs connus, clé d'import, caches de Wikipédia
  await sleep(1600);
  check(ls.get('classeur-pv') && ls.get('classeur-sugg'), 'caches attendus avant l\'oubli');
  needButton('Réglages').click();
  await settle();
  needButton('Oublier ce navigateur').click();
  await settle();
  exactButton('Oublier ce navigateur').click();
  await settle(100);
  check(has("J'ai déjà un lien"), "oublier ce navigateur ne ramène pas à l'accueil");
  const left = ['classeur-key', 'classeur-pv', 'classeur-sugg', 'classeur-import-key', 'classeur-known', 'classeur-target'].filter((k) => ls.has(k));
  check(!left.length, 'encore gardé après « Oublier ce navigateur » : ' + left.join(', '));

  // 19. Lien personnel sans clé gardée : vérifié puis adopté sans question, fragment effacé
  await openLink(rotated);
  check(ctx.location.hash === '' && ls.get('classeur-key') === rotated && has("Tout l'album"), 'le lien personnel n\'ouvre pas le classeur');
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
      posts.push(body);
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
