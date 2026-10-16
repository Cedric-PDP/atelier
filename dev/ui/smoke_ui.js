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
  // Chat : un salon pour tous les comptes ; révision (rev) à la création puis à la suppression (marque vide gardée),
  // comme le serveur. `chatLimit` : le prochain envoi est refusé (429).
  const chat = { msgs: [], rev: 0, id: 0 };
  const chatOut = (st, m) => ({ id: m.id, author: (users.find((u) => u.id === m.user) || {}).name || null, mine: m.user === st.id, text: m.text, created_at: m.at });
  const chatDrop = (m) => { if (!m.deleted) { m.deleted = true; m.text = ''; m.rev = ++chat.rev; } };
  function chatRoute(st, method, p, body) {
    const dm = p.match(/^\/api\/chat\/(\d+)$/);
    if (dm) {
      if (method !== 'DELETE') return json(405, { error: 'Méthode non autorisée.' });
      const m = chat.msgs.find((x) => x.id === Number(dm[1]));
      if (m && m.user === st.id) { chatDrop(m); return json(200, { ok: true }); }
      if (!m || m.deleted) return json(404, { error: "Ce message n'existe plus." });
      return json(403, { error: 'Tu ne peux supprimer que tes propres messages.' });
    }
    if (method === 'POST') {
      const text = typeof body.text === 'string' ? body.text.replace(/\r\n?/g, '\n').trim() : '';
      if (!text) return json(400, { error: "Message vide : écris quelque chose avant d'envoyer." });
      if (text.length > 500) return json(400, { error: 'Message trop long : 500 caractères au plus.' });
      if (!st.name) return json(400, { error: "Donne d'abord un prénom à ton classeur (Réglages, « Ton prénom ») : c'est lui que les autres membres verront." });
      if (self.chatLimit) return json(429, { error: 'Doucement : 10 messages par minute au plus. Réessaie dans 42 s.', retry_after: 42 });
      const m = { id: ++chat.id, user: st.id, text, at: new Date().toISOString(), deleted: false, rev: ++chat.rev };
      chat.msgs.push(m);
      return json(201, { message: chatOut(st, m) });
    }
    if (method !== 'GET') return json(405, { error: 'Méthode non autorisée.' });
    const sp = new URL('http://x' + p).searchParams;
    const live = chat.msgs.filter((m) => !m.deleted);
    if (sp.has('before')) {
      const older = live.filter((m) => m.id < Number(sp.get('before')));
      return json(200, { messages: older.slice(-100).map((m) => chatOut(st, m)), older: older.length > 100 });
    }
    if (sp.has('after')) {
      const a = Number(sp.get('after'));
      if (a > chat.rev) return json(200, { reset: true, rev: chat.rev, last_id: chat.id });
      const changed = chat.msgs.filter((m) => m.rev > a).sort((x, y) => x.rev - y.rev);
      const kept = changed.slice(0, 100);
      return json(200, { messages: kept.filter((m) => !m.deleted).map((m) => chatOut(st, m)), deleted: kept.filter((m) => m.deleted).map((m) => m.id),
        rev: changed.length > 100 ? kept[99].rev : chat.rev, last_id: chat.id, more: changed.length > 100 });
    }
    return json(200, { messages: live.slice(-100).map((m) => chatOut(st, m)), rev: chat.rev, last_id: chat.id, older: live.length > 100 });
  }
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
          shared: !!st.shared, shared_targets: !!(st.shared && st.sharedTargets), ...(self.noRev ? {} : { cards_rev: st.rev }), last_chat_id: chat.id });
      }
      if (p === '/api/me' && method === 'PATCH') {
        if ('prefs' in body) {
          if (!body.prefs || typeof body.prefs !== 'object' || JSON.stringify(body.prefs).length > 4096) return json(400, { error: 'Préférences invalides.' });
          st.prefs = body.prefs;
        }
        if ('shared' in body) {
          // Partage entre membres : identifiant public tiré à chaque activation, effacé à la désactivation.
          if (typeof body.shared !== 'boolean') return json(400, { error: 'Le partage (shared) vaut true ou false.' });
          if (!body.shared) { st.shared = false; st.pub = null; st.sharedTargets = false; } else if (!st.shared) { st.shared = true; st.pub = 'pub' + ++seq; }
        }
        if ('shared_targets' in body) {
          // Second réglage : montrer aussi ses collections, seulement si l'on montre ses cartes.
          if (typeof body.shared_targets !== 'boolean') return json(400, { error: 'Le partage des collections (shared_targets) vaut true ou false.' });
          if (body.shared_targets && !st.shared) return json(400, { error: "Pour montrer tes collections à compléter, montre d'abord tes cartes." });
          st.sharedTargets = body.shared_targets;
        }
        if ('name' in body) st.name = body.name;
        return json(200, { user: { id: st.id, name: st.name }, prefs: st.prefs || {}, shared: !!st.shared, shared_targets: !!(st.shared && st.sharedTargets) });
      }
      // Partage entre membres : 403 sans partager soi-même, 404 pour un membre qui ne partage pas ; cartes par pages
      // de 2 ici (curseur opaque), sans étiquettes, champs montrés seulement.
      if (p === '/api/members' || p.startsWith('/api/members/')) {
        if (method !== 'GET') return json(405, { error: 'Méthode non autorisée.' });
        if (!st.shared) return json(403, { error: "Pour voir les cartes des autres membres, montre d'abord les tiennes : Réglages, « Partage entre membres »." });
        if (p === '/api/members') {
          return json(200, { members: users.filter((u) => u !== st && u.shared && u.pub).map((u) => ({ id: u.pub, name: u.name, count: u.cards.length, fetched_at: u.fetched_at,
            targets: u.sharedTargets ? { count: u.targets.length, updated_at: 'r' + (u.targetsRev || 0) } : null })) });
        }
        // Collections d'un membre qui les montre : une par page ici, réduites à leur nature (kind) et au titre et au qid des
        // éléments vérifiés.
        const mt = p.match(/^\/api\/members\/([^/?]+)\/targets(?:\?part=(.*))?$/);
        if (mt) {
          const u = users.find((x) => x.shared && x.pub === mt[1]);
          if (!u) return json(404, { error: 'Ce membre ne montre pas (ou plus) ses cartes.' });
          if (!u.sharedTargets) return json(404, { error: 'Ce membre ne montre pas (ou plus) ses collections à compléter.' });
          const part = mt[2] === undefined ? '0' : decodeURIComponent(mt[2]);
          const n = part === '0' ? 0 : Number(part.replace(/^tpage-/, ''));
          const page = u.targets.slice(n, n + 1).map((t) => ({ id: t.id, name: t.name, kind: String(t.source || '').startsWith('wp:') ? 'category' : 'collection',
            items: t.items.filter((i) => (i.status || 'ok') === 'ok').map((i) => (i.qid ? { title: i.title, qid: i.qid } : { title: i.title })) }));
          return json(200, { member: { id: u.pub, name: u.name }, targets: page, part, next_part: n + 1 < u.targets.length ? 'tpage-' + (n + 1) : null });
        }
        const m = p.match(/^\/api\/members\/([^/?]+)\/cards(?:\?part=(.*))?$/);
        const u = m && users.find((x) => x.shared && x.pub === m[1]);
        if (!u) return json(404, { error: 'Ce membre ne montre pas (ou plus) ses cartes.' });
        const part = m[2] === undefined ? '0' : decodeURIComponent(m[2]);
        const n = part === '0' ? 0 : Number(part.replace(/^page-/, ''));
        const sorted = u.cards.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const page = sorted.slice(n * 2, n * 2 + 2).map((c) => ({ id: c.id, title: c.title, rarity: c.rarity, count: c.count, shiny: !!c.shiny, image: c.image ?? null, url: c.url ?? null }));
        return json(200, { member: { id: u.pub, name: u.name, fetched_at: u.fetched_at }, cards: page, part, next_part: (n + 1) * 2 < sorted.length ? 'page-' + (n + 1) : null });
      }
      if (p === '/api/me' && method === 'DELETE') {
        for (const m of chat.msgs) if (m.user === st.id) { chatDrop(m); m.user = ''; } // ses messages du chat : vidés, sans auteur
        users.splice(users.indexOf(st), 1);
        return json(200, { ok: true });
      }
      if (p === '/api/chat' || p.startsWith('/api/chat?') || p.startsWith('/api/chat/')) return chatRoute(st, method, p, body || {});
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
        st.targetsRev = (st.targetsRev || 0) + 1; // dernier changement, vu par les autres membres (GET /api/members)
        return json(200, { target: t });
      }
      if (p === '/api/targets/delete') { st.targets = st.targets.filter((x) => x.id !== body.id); st.targetsRev = (st.targetsRev || 0) + 1; return json(200, { ok: true }); }
      // Marché (SPEC.md, « Le marché ») : st.market = {value, history, live, live_at, prices} posé par le test ; cotes par
      // pages de 2 (curseur opaque), comme GET /api/market/prices.
      if (p === '/api/market' && method === 'GET') {
        const m = st.market || {};
        return json(200, { value: m.value || { value: 0, priced: 0, cards: st.cards.length, approx: 0 }, history: m.history || [], live: m.live || null, live_at: m.live_at || null });
      }
      if (p.startsWith('/api/market/prices') && method === 'GET') {
        const part = new URL('http://x' + p).searchParams.get('part') || '0';
        const n = part === '0' ? 0 : Number(part.replace(/^cotes-/, ''));
        const list = (st.market && st.market.prices) || [];
        return json(200, { prices: list.slice(n * 2, n * 2 + 2), part, next_part: (n + 1) * 2 < list.length ? 'cotes-' + (n + 1) : null });
      }
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
  'Hydrogène': { q: 'Q556' }, // article de la catégorie « Élément chimique » : même élément que la carte « Hydrogène (élément) »
  Neptune: { q: 'Q332' }, // carte de Léa (Entre amis) : même élément que « Neptune (planète) » de la catégorie suivie
  'Neptune (planète)': { q: 'Q332' },
  'Hélium': { q: 'Q560', pv: 3000, thumb: 'https://upload.wikimedia.org/he.jpg' }, // catégorie « Élément chimique » que Paul suit (case vide, rareté estimée)
  'Néon': { q: 'Q654' }, // article de la catégorie « Gaz noble » : même élément que la carte « Néon (gaz) » de Léo
  'Néon (gaz)': { q: 'Q654' },
  'Liste de races bovines': { q: 'Q900100' },
  'Liste des races bovines de France': { q: 'Q900110' },
  'Liste de noms de couleur': { q: 'Q900300' },
  'Liste de couleurs (pigments)': { q: 'Q900310' },
  'Tableau périodique des éléments': { q: 'Q10693' },
};
// Liens de « Liste de races bovines » : 3 races, 2 lieux, un lien rouge et une homonymie (écartés).
const LINKS = { 'Charolaise': 'Q900101', 'Limousine (race bovine)': 'Q900102', 'Salers (race bovine)': 'Q900103', France: 'Q142', 'Massif central': 'Q900104' };
// Liens de « Liste de noms de couleur » : [qid, natures (P31), description]. Gardés : 3 « couleur » (Q1075), Rouge
// (« couleur primaire », sous-classe de couleur) et « Vert d'eau » (sans nature, décrit « nom de couleur ») ; écartés :
// Imprimerie et une linguiste. « Article 3 » est une carte du classeur.
const COLOR_LINKS = { 'Article 3': ['Q900301', ['Q1075'], 'couleur'], 'Bleu marine': ['Q900302', ['Q1075'], 'couleur'], 'Mauve (couleur)': ['Q900303', ['Q1075'], 'couleur'],
  Rouge: ['Q900304', ['Q166902'], 'couleur primaire'], "Vert d'eau": ['Q900305', [], 'nom de couleur'], Imprimerie: ['Q900306', ['Q900399'], 'technique d\'impression'],
  'Annie Mollard-Desfour': ['Q900307', ['Q5'], 'linguiste française'] };
const COLOR_BY_Q = Object.fromEntries(Object.values(COLOR_LINKS).map(([q, c, d]) => [q, { c, d }]));
const SUBCLASSES = { Q1075: ['Q166902'] }; // sous-classes (P279+) connues d'une nature
const linkCalls = []; // pages dont les liens ont été lus (generator=links)
const REDIRECTS = { 'Poseidon': 'Poséidon', 'Tableau périodique': 'Tableau périodique des éléments' };
// Pages « Liste de… » trouvées par la recherche intitle:liste (ou des articles, écartés par l'interface).
const listSearch = (s) => (/bovin/i.test(s) ? [{ title: 'Liste de races bovines' }, { title: 'Charolaise' }, { title: 'Liste des races bovines de France' }]
  : /couleur/i.test(s) ? [{ title: 'Liste de noms de couleur' }, { title: 'Couleur' }, { title: 'Liste de couleurs (pigments)' }] : []);
// Articles par préfixe (espace 0) : leurs noms, sans précision entre parenthèses, sont essayés comme catégories.
const ARTICLE_PREFIX = { viol: ['Violence', 'Violet (couleur)', 'Viola Davis'], couleur: ['Couleur', 'Couleur primaire'] };
// Catégories de Wikipédia (onglet Collections, zone « Catégories ») : taille (categoryinfo), articles et sous-catégories
// (categorymembers). Pour « viol » : par préfixe Violence, Violet, Violoniste français (une homonymie, une catégorie
// cachée et une vide écartées), Viol par son titre exact seulement (noPrefix : le préfixe de Wikipédia classe par
// popularité), puis Nuance de violet par la recherche plein texte ; « peintre » : 12 par préfixe ; « races bovines » :
// Race bovine par le singulier, Race bovine originaire de France par la recherche plein texte.
const CATS = {
  'Catégorie:Viol': { pages: 42, subcats: 5, noPrefix: true },
  'Catégorie:Race bovine': { pages: 25, subcats: 2, noPrefix: true },
  'Catégorie:Race bovine originaire de France': { pages: 60, subcats: 0, noPrefix: true },
  'Catégorie:Violet': { pages: 4, subcats: 1, page: ['Article 3', 'Violet (couleur)', 'Améthyste', 'Lavande'], subcat: ['Catégorie:Nuance de violet'] },
  'Catégorie:Nuance de violet': { pages: 2, subcats: 0, page: ['Mauve', 'Article 8'] },
  'Catégorie:Violence': { pages: 120, subcats: 6 },
  'Catégorie:Violoniste français': { pages: 310, subcats: 0 },
  'Catégorie:Violence (homonymie)': { pages: 3, subcats: 0 },
  'Catégorie:Violation du droit d’auteur': { pages: 50, subcats: 0, hidden: true },
  'Catégorie:Viole vide': { pages: 0, subcats: 0 },
  'Catégorie:Élément chimique': { pages: 4, subcats: 0, page: ['Hydrogène', 'Hélium', 'Lithium', 'Mercure (chimie)'] },
  'Catégorie:Gaz noble': { pages: 3, subcats: 0, page: ['Néon', 'Argon', 'Krypton'] }, // qids de l'album (Léo)
  // Couleurs (propositions : sous-catégories écartées) : Rouge, Vert et Jaune sont des sous-catégories de Couleur.
  'Catégorie:Couleur': { pages: 40, subcats: 3, page: ['Arc-en-ciel', 'Spectre visible'], subcat: ['Catégorie:Rouge', 'Catégorie:Vert', 'Catégorie:Jaune'] },
  'Catégorie:Rouge': { pages: 20, subcats: 0, page: ['Coquelicot', 'Fraise'] },
  'Catégorie:Vert': { pages: 20, subcats: 0, page: ['Pomme verte', 'Menthe'] },
  'Catégorie:Jaune': { pages: 20, subcats: 0, page: ['Citron', 'Banane'] },
  'Catégorie:Planète du Système solaire': { pages: 9, subcats: 0, page: ['Mercure (planète)', 'Vénus (planète)', 'Terre', 'Théia (impacteur)', 'Jupiter (planète)',
    'Uranus (planète)', 'Neptune (planète)', 'Mars (planète)', 'Saturne (planète)'] },
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['Catégorie:Peintre ' + String(i + 1).padStart(2, '0'), { pages: 10 + i, subcats: 0 }])),
};
// Catégories des cartes d'Iris (couleurs) et catégories parentes des catégories (prop=categories sur l'espace 14).
const CARD_CATS = { Coquelicot: ['Rouge'], Fraise: ['Rouge'], 'Pomme verte': ['Vert'], Menthe: ['Vert'], Citron: ['Jaune'], Banane: ['Jaune'],
  'Arc-en-ciel': ['Couleur'], 'Spectre visible': ['Couleur'] };
const CAT_PARENTS = { 'Catégorie:Rouge': ['Couleur'], 'Catégorie:Vert': ['Couleur'], 'Catégorie:Jaune': ['Couleur'], 'Catégorie:Couleur': ['Optique'],
  'Catégorie:Autre essai': ['Essais'] };
const parentCalls = []; // titres des catégories dont les parentes ont été demandées
const foldT = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const catInfo = (t) => { const c = CATS[t]; return c ? { size: c.pages + c.subcats, pages: c.pages, files: 0, subcats: c.subcats, ...(c.hidden ? { hidden: true } : {}) } : null; };
const catSuggest = []; // requêtes de suggestions de catégories : ['prefix' | 'search', texte]
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
const pvAsked = []; // titres dont les vues (prop=pageviews) ont été demandées, dans l'ordre
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
      return { results: { bindings: ids.flatMap((id) => {
        const col = COLOR_BY_Q[id];
        if (col) return col.c.length ? col.c.map((c) => ({ item: uri(id), c: uri(c), desc: lit(col.d) })) : [{ item: uri(id), desc: lit(col.d) }];
        return [Number(id.slice(1)) >= 900101 && Number(id.slice(1)) <= 900103
          ? { item: uri(id), c: uri('Q12045585'), desc: lit('race bovine française') } : { item: uri(id), c: uri(id === 'Q142' ? 'Q6256' : 'Q1620908') }];
      }) } };
    }
    if (/wd:Q12045585 rdfs:label/.test(q)) return { results: { bindings: [{ l: lit('race bovine') }] } };
    if (/wd:Q1075 rdfs:label/.test(q)) return { results: { bindings: [{ l: lit('couleur') }] } };
    {
      // Sous-classes de la nature dominante parmi celles vues (liens d'une page).
      const m = q.match(/^SELECT \?c WHERE \{ VALUES \?c \{ ([^}]*) \} \?c wdt:P279\+ wd:(Q\d+) \. \}$/);
      if (m) {
        const asked = [...m[1].matchAll(/wd:(Q\d+)/g)].map((x) => x[1]);
        return { results: { bindings: asked.filter((c) => (SUBCLASSES[m[2]] || []).includes(c)).map((c) => ({ c: uri(c) })) } };
      }
    }
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
  // Suggestions de catégories : par préfixe (et, dans la même requête, les pages « Liste de… » et les articles par
  // préfixe), puis plein texte, avec leur taille (categoryinfo) dans la même réponse ; pages rendues dans le désordre
  // (l'interface les range par index). Plein texte : « races » trouve « race » (racine, comme CirrusSearch).
  if (p.generator === 'prefixsearch' || (p.generator === 'search' && p.gsrnamespace === '14')) {
    const prefix = p.generator === 'prefixsearch';
    if ((prefix ? p.gpsnamespace : p.gsrnamespace) !== '14' || p.prop !== 'categoryinfo') throw new Error('suggestions de catégories incorrectes : ' + url);
    const q = foldT(prefix ? p.gpssearch : p.gsrsearch);
    catSuggest.push([prefix ? 'prefix' : 'search', prefix ? p.gpssearch : p.gsrsearch]);
    const stem = (w) => (w.length >= 5 ? w.replace(/s$/, '') : w);
    const titles = Object.keys(CATS).sort().filter((t) => (prefix ? !CATS[t].noPrefix && foldT(t.slice(10)).startsWith(q) : q.split(/\s+/).every((w) => foldT(t.slice(10)).includes(stem(w)))))
      .slice(0, Number(prefix ? p.gpslimit : p.gsrlimit) || 10);
    const query = { pages: titles.map((title, i) => ({ ns: 14, title, index: i + 1, categoryinfo: catInfo(title) })).reverse() };
    if (p.list) {
      if (!prefix || p.list !== 'search|prefixsearch' || p.srnamespace !== '0' || p.psnamespace !== '0' || !/^intitle:liste /.test(p.srsearch) || p.pssearch !== p.gpssearch) {
        throw new Error('suggestions : pages de liste ou articles par préfixe incorrects : ' + url);
      }
      query.search = listSearch(p.srsearch).map((r) => ({ ns: 0, ...r }));
      query.prefixsearch = (ARTICLE_PREFIX[foldT(p.pssearch)] || []).map((title) => ({ ns: 0, title }));
    }
    return { batchcomplete: true, query };
  }
  // Titres exacts (suggestions, adresse collée) : catégories avec leur taille, pages avec leurs pageprops ; normalisation
  // (majuscule) et redirections comme Wikipédia.
  if (p.prop === 'categoryinfo|pageprops') {
    if (p.redirects !== '1' || p.ppprop !== 'disambiguation') throw new Error('titres exacts : redirections ou homonymies non demandées : ' + url);
    catSuggest.push(['exact', p.titles]);
    const normalized = [];
    const redirects = [];
    const pages = [];
    for (const t of p.titles.split('|')) {
      let cur = t.replace(/^Category:/, 'Catégorie:');
      cur = cur.startsWith('Catégorie:') ? 'Catégorie:' + cur.charAt(10).toUpperCase() + cur.slice(11) : cur.charAt(0).toUpperCase() + cur.slice(1);
      if (cur !== t) normalized.push({ from: t, to: cur });
      if (REDIRECTS[cur]) { redirects.push({ from: cur, to: REDIRECTS[cur] }); cur = REDIRECTS[cur]; }
      if (pages.some((x) => x.title === cur)) continue;
      if (cur.startsWith('Spécial:')) pages.push({ ns: -1, title: cur, special: true, missing: true });
      else if (CATS[cur]) pages.push({ ns: 14, title: cur, categoryinfo: catInfo(cur) });
      else if (cur.startsWith('Catégorie:')) pages.push({ ns: 14, title: cur, missing: true });
      else if (WIKI[cur]) pages.push({ ns: 0, title: cur, pageprops: WIKI[cur].disamb ? { disambiguation: '' } : {} });
      else pages.push({ ns: 0, title: cur, missing: true });
    }
    return { batchcomplete: true, query: { normalized, redirects, pages } };
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
    return { query: { search: listSearch(p.srsearch) } };
  }
  if (p.generator === 'links') {
    if (!['Liste de races bovines', 'Liste de noms de couleur', 'Tableau périodique des éléments'].includes(p.titles) || p.gplnamespace !== '0' || p.redirects !== '1') throw new Error('liens demandés incorrects : ' + url);
    linkCalls.push(p.titles);
    if (p.titles === 'Liste de noms de couleur') {
      const pages = Object.entries(COLOR_LINKS).map(([title, [q]]) => ({ title, pageprops: { wikibase_item: q } }));
      pages.push({ title: 'Couleur (homonymie)', pageprops: { disambiguation: '', wikibase_item: 'Q900308' } });
      return { batchcomplete: true, query: { pages } };
    }
    if (p.titles === 'Tableau périodique des éléments') return { batchcomplete: true, query: { pages: [{ title: 'Hydrogène', pageprops: { wikibase_item: 'Q556' } }, { title: 'Hélium', pageprops: { wikibase_item: 'Q560' } }] } };
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
    const m = M[p.cmtitle] || (CATS[p.cmtitle] ? { page: CATS[p.cmtitle].page || [], subcat: CATS[p.cmtitle].subcat || [] } : { page: [], subcat: [] });
    if (p.cmtype === 'page' && p.cmnamespace !== '0') throw new Error('membres hors de l\'espace principal');
    return { query: { categorymembers: (m[p.cmtype] || []).map((title) => ({ title })) } };
  }
  if (p.prop === 'categories') {
    if (p.clshow !== '!hidden') throw new Error('catégories cachées demandées : ' + url);
    const titles = p.titles.split('|');
    if (titles.every((t) => t.startsWith('Catégorie:'))) {
      // Catégories parentes des propositions.
      parentCalls.push(...titles);
      return { query: { pages: titles.map((title) => ({ ns: 14, title, categories: (CAT_PARENTS[title] || []).map((c) => ({ ns: 14, title: 'Catégorie:' + c })) })) } };
    }
    propose.categories++;
    return { query: { pages: titles.map((title) => {
      const n = Number((title.match(/^Article (\d+)$/) || [])[1]);
      const cat = n >= 1 && n <= 10 ? 'Catégorie:Exemples de test' : n >= 41 && n <= 45 ? 'Catégorie:Autre essai' : null;
      const cats = CARD_CATS[title] ? CARD_CATS[title].map((c) => 'Catégorie:' + c) : cat ? [cat] : [];
      return { title, categories: cats.map((c) => ({ title: c })) };
    }) } };
  }
  if (p.prop === 'categoryinfo') {
    const I = { 'Catégorie:Footballeur international français': { pages: 3, subcats: 1 }, 'Catégorie:Footballeur français': { pages: 12000, subcats: 40 },
      'Catégorie:Exemples de test': { pages: 40, subcats: 0 }, 'Catégorie:Autre essai': { pages: 50, subcats: 0 } };
    return { query: { pages: p.titles.split('|').map((title) => ({ title, categoryinfo: I[title] || catInfo(title) || { pages: 0, subcats: 0 } })) } };
  }
  const titles = p.titles.split('|');
  if (/pageviews/.test(p.prop || '') && !p.pvipcontinue) pvAsked.push(...titles);
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
  const apiKeyLog = []; // les mêmes, avec la clé envoyée et l'heure : {call, key, at}
  const catalogFetches = []; // demandes de /catalog.json (aucune attendue)
  // Contexte d'une page du classeur ; toutes les pages sont dans le même navigateur (localStorage, IndexedDB, API).
  // opts.idb : 'absent' (pas d'IndexedDB) ou 'refusé' (son accès lève une erreur, comme un stockage bloqué) ;
  // opts.hold(url) : promesse attendue avant de répondre à un appel de l'API ; opts.wikiHold(url) : de même pour
  // Wikipédia et Wikidata (une réponse abandonnée pendant l'attente est rejetée) ; opts.hash : fragment de l'adresse
  // (« #cle=… ») ; opts.speed : horloge de la page (minuteries et Date) accélérée d'autant, pour les longues attentes.
  function makeCtx(doc, win, opts = {}) {
    const ctx = {
      console: { log: console.log, warn: (...a) => { errors.push('warn: ' + a.join(' ')); }, error: (...a) => { errors.push('error: ' + a.map((x) => (x && x.stack) || x).join(' ')); } },
      document: doc, window: null, navigator: { clipboard: { writeText: async (t) => { copied.push(t); } } },
      location: { origin: ORIGIN, pathname: '/', search: '', hash: opts.hash || '', hostname: 'classeur.example' },
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
    if (opts.speed) {
      const k = opts.speed;
      const t0 = Date.now();
      const now = () => t0 + (Date.now() - t0) * k;
      ctx.setTimeout = (f, ms, ...a) => setTimeout(f, (Number(ms) || 0) / k, ...a);
      ctx.setInterval = (f, ms, ...a) => setInterval(f, (Number(ms) || 0) / k, ...a);
      ctx.Date = class extends Date { constructor(...a) { super(...(a.length ? a : [now()])); } static now() { return now(); } };
    }
    // Minuteries répétées d'une minute ou plus (relecture de GET /api/me toutes les 60 s, onglet visible) : jamais lancées
    // d'elles-mêmes, pour ne pas tomber au hasard au milieu d'un autre test ; rangées dans opts.longTimers (id → fonction)
    // et déclenchées à la main (openPage(…).live()).
    const longs = opts.longTimers || new Map();
    const shortInterval = ctx.setInterval;
    let longId = 0;
    ctx.setInterval = (f, ms, ...a) => {
      if ((Number(ms) || 0) < 60000) return shortInterval(f, ms, ...a);
      longId += 1;
      longs.set('long-' + longId, () => f(...a));
      return 'long-' + longId;
    };
    ctx.clearInterval = (id) => (longs.delete(id) ? undefined : clearInterval(id));
    ctx.addEventListener = win.addEventListener;
    ctx.removeEventListener = win.removeEventListener;
    ctx.fetch = async (url, init = {}) => {
      const headers = init.headers || {};
      const method = init.method || 'GET';
      const body = init.body ? JSON.parse(init.body) : undefined;
      if (/^https:\/\/(fr\.wikipedia\.org|query\.wikidata\.org|www\.wikidata\.org)\//.test(url)) {
        if (init.signal && init.signal.aborted) { const e = new Error('abandon'); e.name = 'AbortError'; throw e; }
        const data = wikiHandle(url);
        if (opts.wikiHold) { // réponse de Wikipédia rendue plus tard (réseau lent) ; abandonnée entre-temps : rejetée
          await opts.wikiHold(url);
          if (init.signal && init.signal.aborted) { const e = new Error('abandon'); e.name = 'AbortError'; throw e; }
        }
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => data };
      }
      // Le catalogue Wikidata a été retiré de l'interface (2026-10-16) : il ne doit plus jamais être demandé.
      if (/catalog\.json/.test(String(url))) { catalogFetches.push(url); throw new Error('catalogue demandé : ' + url); }
      if (url === '/assets/bookmarklet.js') {
        const file = path.join(PUB, url);
        const text = fs.readFileSync(file, 'utf8');
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => JSON.parse(text), text: async () => text };
      }
      if (!url.startsWith('/api/')) throw new Error('adresse inattendue : ' + url);
      apiLog.push(method + ' ' + url);
      apiKeyLog.push({ call: method + ' ' + url, key: headers['X-Classeur-Key'] || '', at: Date.now() });
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

  check0(!fs.existsSync(path.join(PUB, 'catalog.json')), 'site/public/catalog.json ne doit plus exister (catalogue retiré)');
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
  // Tuile « N collections » du bandeau : le nombre de « Mes collections » (sans les catégories suivies, sans total).
  const colFigure = () => { const f = cls('figure').find((n) => /^collections?$/.test(text(n.querySelector('span')))); return f ? text(f.querySelector('b')) + ' ' + text(f.querySelector('span')) : null; };
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
  // Le classeur rouvert dans une autre page du même navigateur (localStorage, IndexedDB et API partagés). live() :
  // déclenche ses minuteries d'une minute ou plus (relecture périodique), longTimers : celles en place.
  const openPage = (opts) => {
    const p = makeDom();
    const longTimers = new Map();
    const c = makeCtx(p.doc, p.win, { ...opts, longTimers });
    const box = p.doc.createElement('div');
    box.setAttribute('id', 'app');
    p.doc.body.appendChild(box);
    for (const file of [VUE, ...['match.js', 'propose.js', 'app.js'].map((m) => path.join(PUB, 'assets', m))]) vm.runInContext(fs.readFileSync(file, 'utf8'), c, { filename: path.basename(file) });
    return { doc: p.doc, count: () => countIn(p.doc), visible: async () => { for (const f of p.doc.listeners.visibilitychange || []) await f(); },
      longTimers, live: async () => { for (const f of [...longTimers.values()]) await f(); } };
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
  // Script Tampermonkey (replié sous le favori) : en-tête du gestionnaire, puis le même code en mode « load », avec la
  // clé d'import seulement.
  {
    const us = byId('us-code') && byId('us-code').value;
    check(us && us.startsWith('// ==UserScript==\n') && us.includes('\n// @match        https://www.wiki-masters.com/*\n') && us.includes('\n// @grant        none\n'), 'script Tampermonkey absent ou sans en-tête : ' + String(us).slice(0, 80));
    check(us.includes('"load"') && !us.includes('"__START__"') && us.includes('"' + importKey + '"') && !us.includes(ls.get('classeur-key')), 'script Tampermonkey : mode « load » ou clé incorrects');
    check(us.split('\n').filter((l) => l && !l.startsWith('//')).join('') === bmCode.replace(/%23/g, '#').replace('"__START__"', '"load"'), 'script Tampermonkey : code différent du favori');
    try { new vm.Script(us); } catch (e) { fail('script Tampermonkey : code invalide : ' + e.message); }
  }
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
  check(has('cartes différentes') && colFigure() === '0 collection' && !has('commencées') && cls('track').length === 1, 'tuiles de chiffres ou barre de répartition absentes : ' + colFigure());
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
  check(!cls('cell__tags').length && !cls('cardgrid')[0].querySelectorAll('.tag').length, 'les tags ne doivent plus être affichés sous les cartes (seulement dans la fiche)');
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
  check(!cls('cardgrid')[0].querySelectorAll('.tag').length, 'aucun tag sous les cartes (seulement dans la fiche)');
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
    const b = fiche().querySelectorAll('button').filter((x) => x.getAttribute('aria-label') === 'Copier le nom « Rihanna »')[0];
    check(b && b.classList.contains('copy-name') && b.parentNode.classList.contains('fiche__title'), 'icône « Copier le nom » absente à côté du titre de la fiche');
    const n = copied.length;
    b.click();
    await settle();
    check(copied.length === n + 1 && copied[n] === 'Rihanna', 'le nom n\'est pas copié : ' + JSON.stringify(copied.slice(n)));
    check(fiche() && fiche().querySelectorAll('button').some((x) => x.getAttribute('aria-label') === 'Nom « Rihanna » copié'), 'pas de « Nom copié » après la copie (ou fiche fermée)');
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

  // 9. Onglet Collections : « Mes collections » (toutes : favori depuis la Collection globale du jeu, à la main, depuis
  // une catégorie de Wikipédia), puis « Catégories » : recherche d'une catégorie de Wikipédia avec suggestions au fil de
  // la frappe, album d'une catégorie, « Créer une collection ». Ni catalogue, ni « Mes catégories » (plus de suivi).
  await goTab('collections');
  check(has('Mes collections') && has('Catégories') && has("Proposées d'après tes cartes"), 'zones de l\'onglet Collections absentes');
  check(!has('Mes catégories') && !byId('h-mycats') && !has('Suivre') && !has('suivie'), '« Mes catégories » et le vocabulaire du suivi doivent avoir disparu');
  check(!has('Collections proposées') && !has('Parcourir tout le catalogue') && !has('Pharaons') && !byId('prop-q'), 'le catalogue doit avoir disparu');
  check(has('Collection globale') && has('depuis une catégorie de Wikipédia (plus bas)'), 'texte de la liste vide (favori, catégories) absent');
  const mineSection = () => byId('h-mine').parentNode.parentNode;
  // Lignes de « Mes collections » faites d'une catégorie : « depuis la catégorie Wikipédia ».
  const fromCat = (name) => { const r = mineSection().querySelectorAll('.row').find((n) => text(n.querySelector('.name')) === name); return !!r && !!r.querySelector('.row-kind') && text(r.querySelector('.row-kind')) === 'depuis la catégorie Wikipédia'; };
  const rowNames = (box) => box.querySelectorAll('.row').map((n) => text(n.querySelector('.name')));
  const opts = () => all((n) => n.getAttribute && n.getAttribute('role') === 'option');
  const at = () => (one('album-title') ? text(one('album-title')) : '');
  {
    const cq = byId('cat-q');
    check(cq && cq.getAttribute('role') === 'combobox' && cq.getAttribute('aria-controls') === 'cat-list' && cq.getAttribute('aria-autocomplete') === 'list',
      'champ de recherche des catégories (combobox) absent');
    // Frappe rapide : une seule recherche, 250 ms après la dernière touche ; préfixe (avec les pages de liste et les
    // articles), titres exacts, puis plein texte (peu de catégories) : trois requêtes au plus.
    const n0 = catSuggest.length;
    for (const v of ['v', 'vi', 'vio', 'viol']) type(cq, v);
    check(await waitFor(() => opts().length > 0), 'suggestions absentes pour « viol » : ' + text(one('prop-search')));
    check(JSON.stringify(catSuggest.slice(n0).map((x) => x[0])) === '["prefix","exact","search"]' && catSuggest[n0][1] === 'viol' && catSuggest[n0 + 2][1] === 'viol'
      && catSuggest[n0 + 1][1].split('|').includes('Catégorie:Viol') && catSuggest[n0 + 1][1].split('|').includes('Catégorie:Viola Davis')
      && !catSuggest[n0 + 1][1].split('|').includes('Catégorie:Violence'), 'requêtes de suggestions : ' + JSON.stringify(catSuggest.slice(n0)));
    const names = () => opts().map((o) => text(o.querySelector('.prop-list__name')));
    // Classement : Viol (titre exact, absent du préfixe) d'abord, puis celles qui commencent par « viol » de la plus grande
    // à la plus petite, puis Nuance de violet (un mot commence par « viol ») ; homonymie, cachée et vide écartées.
    check(names().join('|') === 'Viol|Violoniste français|Violence|Violet|Nuance de violet', 'suggestions (exact, commence par, taille) : ' + names().join(' | '));
    check(text(opts()[0]).includes('42 articles') && text(opts()[0]).includes('5 sous-catégories') && text(opts()[3]).includes('4 articles') && text(opts()[3]).includes('1 sous-catégorie')
      && text(opts()[1]).includes('310 articles'), 'tailles des suggestions : ' + opts().map(text).join(' / '));
    check(cls('prop-list__group').map(text).join('|') === 'Catégories', 'un seul groupe (pas de page de liste pour « viol ») : ' + cls('prop-list__group').map(text).join('|'));
    check(cq.getAttribute('aria-expanded') === 'true' && cq.getAttribute('aria-activedescendant') === 'cat-opt-0' && byId('cat-list').getAttribute('role') === 'listbox', 'combobox : liste ouverte et option active attendues');
    cq.dispatch('keydown', { key: 'ArrowDown' });
    await settle();
    check(cq.getAttribute('aria-activedescendant') === 'cat-opt-1' && opts()[1].getAttribute('aria-selected') === 'true', 'flèche bas sans effet');
    cq.dispatch('keydown', { key: 'ArrowDown' });
    await settle();
    cq.dispatch('keydown', { key: 'ArrowUp' });
    await settle();
    check(cq.getAttribute('aria-activedescendant') === 'cat-opt-1', 'flèche haut sans effet');
    // Échap ferme la liste ; la même recherche reprise ne redemande rien à Wikipédia (réponse gardée).
    cq.dispatch('keydown', { key: 'Escape' });
    await settle();
    check(!opts().length && cq.getAttribute('aria-expanded') === 'false', 'Échap ne ferme pas la liste');
    const n1 = catSuggest.length;
    type(cq, 'viol');
    await sleep(400);
    check(opts().length === 5, 'suggestions reprises absentes');
    check(catSuggest.length === n1, 'même recherche : réponse gardée attendue, ' + JSON.stringify(catSuggest.slice(n1)));
    // Au plus 8 catégories (la plus grande d'abord, à rang égal) ; une recherche sans résultat le dit.
    type(cq, 'peintre');
    check(await waitFor(() => opts().length && text(opts()[0]).includes('Peintre 12')), 'suggestions « peintre » absentes : ' + opts().map(text).join(' / '));
    check(opts().length === 8 && JSON.stringify(catSuggest.slice(-2).map((x) => x[0])) === '["prefix","exact"]', '8 suggestions au plus, sans plein texte quand le préfixe suffit : ' + opts().length + ' ' + JSON.stringify(catSuggest.slice(-2)));
    type(cq, 'zzzz');
    check(await waitFor(() => has('Aucune catégorie ni page de liste de Wikipédia ne correspond.')), 'recherche sans résultat');
    // Catégories et pages « Liste de… » mêlées, en deux groupes, chacun avec sa taille : « couleur » (la catégorie
    // exacte d'abord, puis les pages ; « Couleurs (pigments) » commence par le texte, « Noms de couleur » non).
    type(cq, 'couleur');
    check(await waitFor(() => opts().length === 3 && !one('prop-list--stale')), 'suggestions « couleur » : ' + opts().map(text).join(' / '));
    check(cls('prop-list__group').map(text).join('|') === 'Catégories|Pages de liste' && names().join('|') === 'Couleur|Liste de couleurs (pigments)|Liste de noms de couleur'
      && text(opts()[0]).includes('40 articles') && text(opts()[1]).includes('liste') && byId('cat-list').querySelectorAll('[role="group"]').length === 2,
      'groupes « Catégories » / « Pages de liste » : ' + cls('prop-list__group').map(text).join('|') + ' — ' + opts().map(text).join(' / '));
    // « noms de couleur » : la page exacte (« Liste de noms de couleur ») seule, son groupe en tête.
    type(cq, 'noms de couleur');
    check(await waitFor(() => opts().length === 1 && !one('prop-list--stale')), 'suggestions « noms de couleur » : ' + opts().map(text).join(' / '));
    check(cls('prop-list__group').map(text).join('|') === 'Pages de liste' && names()[0] === 'Liste de noms de couleur', 'page exacte : ' + opts().map(text).join(' / '));
    // Le titre de la page tapé en entier : demandé tel quel parmi les titres exacts.
    {
      const n2 = catSuggest.length;
      type(cq, 'Liste de noms de couleur');
      await settle();
      check(await waitFor(() => catSuggest.slice(n2).some((x) => x[0] === 'exact') && opts().length === 1 && !one('prop-list--stale')), 'titre tapé en entier : ' + opts().map(text).join(' / '));
      const ex = catSuggest.slice(n2).find((x) => x[0] === 'exact');
      check(names()[0] === 'Liste de noms de couleur' && ex && ex[1].split('|').includes('Liste de noms de couleur'), 'titre exact demandé : ' + JSON.stringify(catSuggest.slice(n2)));
    }
    // « races bovines » : la catégorie au singulier (titre exact) avant la recherche plein texte, plus grande ; puis les pages.
    type(cq, 'races bovines');
    check(await waitFor(() => opts().length === 4 && !one('prop-list--stale')), 'suggestions « races bovines » : ' + opts().map(text).join(' / '));
    check(names().join('|') === 'Race bovine|Race bovine originaire de France|Liste de races bovines|Liste des races bovines de France', 'races bovines : ' + names().join(' | '));
    type(cq, 'viol');
    check(await waitFor(() => opts().length === 5 && !one('prop-list--stale')), 'suggestions « viol » absentes');
    for (let k = 0; k < 3; k++) { cq.dispatch('keydown', { key: 'ArrowDown' }); await settle(); }
    cq.dispatch('keydown', { key: 'Enter' });
    check(await waitFor(() => at().includes('Violet') && cls('slot').length === 3), "Entrée n'ouvre pas l'album de la catégorie : " + at());
    // Le champ de recherche disparaît avec la liste : le focus va au titre de l'album (pas sur <body>).
    await settle();
    const focused = doc.activeElement && doc.activeElement.getAttribute ? doc.activeElement.getAttribute('id') : null;
    check(focused === 'album-name' && byId('album-name').getAttribute('tabindex') === '-1', 'focus après le choix d\'une suggestion : ' + focused);
  }
  // Album d'une catégorie : ses articles, la progression, la rareté estimée ; sous-catégories (1 niveau) ; « Créer une
  // collection ».
  check(at().includes('1 sur 4') && at().includes('catégorie de Wikipédia') && cls('cell').length === 1 && has('Créer une collection') && !has('Modifier'), 'album de la catégorie : ' + at());
  check(all((n) => n.tagName === 'A' && text(n).includes('Voir sur Wikipédia')).some((a) => a.getAttribute('href') === 'https://fr.wikipedia.org/wiki/Cat%C3%A9gorie:Violet'), 'lien vers la catégorie absent');
  {
    const subBox = all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox' && n.parentNode.classList.contains('check'))[0];
    check(subBox && text(subBox.parentNode).includes('inclure les sous-catégories (1 niveau : 1)'), 'case des sous-catégories absente');
    subBox.dispatch('change');
    check(await waitFor(() => at().includes('2 sur 6') && cls('slot').length === 4), 'avec les sous-catégories : 2 sur 6 attendu, ' + at());
  }
  needButton('Créer une collection').click();
  check(await waitFor(() => has('Modifier') && has('Supprimer')), '« Créer une collection » sans effet');
  if (!SERVER) check(api.st.targets.some((t) => t.source === 'wp:Violet' && t.name === 'Violet' && t.items.length === 6), 'collection de la catégorie mal enregistrée : ' + JSON.stringify(api.st.targets.map((t) => [t.name, t.source, t.items.length])));
  check(at().includes('depuis la catégorie Wikipédia') && at().includes('2 sur 6') && has('Collection « Violet » créée : 6 articles, sous-catégories comprises, dans « Mes collections ».')
    && !has('Créer une collection') && !has('Ne plus suivre'), 'album de la collection créée (devenu une collection comme les autres) : ' + at());
  // Fiches : « Dans tes collections » (carte possédée, puis case vide), la collection faite de la catégorie comprise.
  {
    one('cell').querySelector('.card').dispatch('click');
    await settle(120);
    check(fiche() && text(fiche()).includes('Dans tes collections') && fiche().querySelector('.memberships') && text(fiche().querySelector('.memberships')).includes('Violet')
      && !text(fiche()).includes('Dans tes catégories') && !text(fiche()).includes('collections proposées'), 'fiche : « Dans tes collections » attendu : ' + (fiche() ? text(fiche()).slice(-300) : 'absente'));
    win.listeners.keydown.forEach((f) => f({ key: 'Escape', preventDefault() {} }));
    await settle(500);
    cls('slot__open').filter((b) => (b.getAttribute('aria-label') || '').startsWith('Lavande : '))[0].click();
    await settle(120);
    const f = one('fiche--missing');
    check(f && text(f).includes('Dans tes collections') && text(f.querySelector('.memberships')).includes('Violet') && !text(f).includes('Dans tes catégories'),
      'fiche d\'une case vide : « Dans tes collections » attendu : ' + (f ? text(f).slice(-300) : 'absente'));
    f.querySelector('.close').click();
    await settle(500);
  }
  needButton('← Toutes les collections').click();
  await settle();
  check(rowNames(mineSection()).includes('Violet') && fromCat('Violet'), 'Violet doit être dans « Mes collections », « depuis la catégorie Wikipédia » : ' + rowNames(mineSection()).join(', '));
  {
    const n = rowNames(mineSection()).length;
    check(colFigure() === `${n} ${n > 1 ? 'collections' : 'collection'}`, 'tuile du bandeau : la collection faite d\'une catégorie compte, ' + colFigure() + ' pour ' + n);
  }
  check(byId('cat-q') && byId('cat-q').value === '', 'le champ de recherche doit être vidé après le choix');
  // La catégorie se rouvre depuis la recherche (« ta collection ») : son album propose « Ouvrir ta collection » ; la
  // collection se supprime comme les autres, après confirmation.
  type(byId('cat-q'), 'viol');
  check(await waitFor(() => opts().length === 5 && text(opts()[3]).includes('ta collection')), 'suggestion d\'une catégorie déjà en collection : ' + opts().map(text).join(' / '));
  opts()[3].dispatch('mousedown');
  check(await waitFor(() => at().includes('Violet') && at().includes('catégorie de Wikipédia') && !!buttonByText('Ouvrir ta collection') && !buttonByText('Créer une collection')),
    'catégorie déjà en collection : « Ouvrir ta collection » attendu, ' + at());
  needButton('Ouvrir ta collection').click();
  check(await waitFor(() => at().includes('depuis la catégorie Wikipédia') && at().includes('2 sur 6') && has('Supprimer')), '« Ouvrir ta collection » : ' + at());
  needButton('Supprimer').click();
  await settle();
  check(has('Supprimer « Violet » ?'), 'confirmation de suppression de la collection faite d\'une catégorie absente');
  if (!SERVER) check(api.st.targets.some((t) => t.source === 'wp:Violet'), 'collection supprimée avant la confirmation');
  modalBtn('Supprimer la collection').click();
  check(await waitFor(() => !one('album-title') && !rowNames(mineSection()).includes('Violet')), 'collection « Violet » non supprimée');
  if (!SERVER) check(!api.st.targets.some((t) => t.source === 'wp:Violet'), 'la collection « Violet » existe encore');

  // 9 ter. Rapprochement par identifiant Wikidata : la carte « Hydrogène (élément) » compte pour « Hydrogène » (même qid).
  // Entrée pressée avant l'arrivée des suggestions de « élément » (celles de « viol », estompées, sont encore là) : ce
  // n'est pas « Viol » qui s'ouvre, mais la première suggestion de « élément », à son arrivée.
  type(byId('cat-q'), 'viol');
  check(await waitFor(() => opts().length === 5 && !one('prop-list--stale')), 'suggestions « viol » absentes');
  type(byId('cat-q'), 'élément');
  await settle(); // rendu fait, recherche pas encore partie (250 ms)
  check(opts().length === 5 && one('prop-list--stale'), 'les suggestions du texte précédent doivent rester, estompées, en attendant');
  byId('cat-q').dispatch('keydown', { key: 'Enter' });
  check(await waitFor(() => at().includes('Élément chimique') && at().includes('1 sur 4'), 15000), 'la carte « Hydrogène (élément) » doit compter pour « Hydrogène » (qid) : ' + at());
  check(cls('cell').length === 1 && cls('slot').length === 3 && text(cls('cell')[0]).includes('Hydrogène (élément)'), "l'album doit montrer la carte à la place de « Hydrogène »");
  needButton('← Toutes les collections').click();
  await settle();

  // 9 quater. « Proposées d'après tes cartes » : catégories de tes cartes dont tu as au moins 5 % (et 2 cartes) ; ouvrir,
  // Retirer, Créer une collection (sans quitter la liste), masquer, rétablir.
  for (let i = 0; i < 150 && !has('Exemples de test'); i++) await sleep(100);
  check(has('Exemples de test') && has('Autre essai'), 'propositions d\'après les catégories absentes');
  check(propose.categories > 0, 'propose.js n\'a pas interrogé Wikipédia');
  const wpRow = (name) => all((n) => n.classList.contains('row') && n.classList.contains('wp') && text(n.querySelector('.name')) === name)[0];
  check(text(wpRow('Exemples de test')).includes('7 sur 40') && text(wpRow('Exemples de test')).includes('Voir sur Wikipédia'), 'ligne de proposition incorrecte : ' + text(wpRow('Exemples de test')));
  wpRow('Exemples de test').querySelector('.row-open').click();
  check(await waitFor(() => at().includes('Exemples de test') && at().includes('37 sur 40') && has('Créer une collection')), 'le nom d\'une proposition doit ouvrir son album : ' + at());
  needButton('← Toutes les collections').click();
  await settle();
  all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Retirer « Autre essai » des propositions')[0].click();
  await settle();
  modalBtn('Retirer des propositions').click();
  await settle(100);
  if (!SERVER) check(JSON.stringify(api.st.prefs.hidden_proposals) === '["wp:Autre essai"]' && !('hidden_catalog' in api.st.prefs), 'retrait de la proposition non enregistré : ' + JSON.stringify(api.st.prefs));
  check(!wpRow('Autre essai'), 'la proposition retirée reste affichée');
  all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Créer une collection « Exemples de test »')[0].click();
  check(await waitFor(() => has('Collection « Exemples de test » créée : 40 articles, dans « Mes collections ».')), 'proposition : collection non créée');
  if (!SERVER) check(api.st.targets.some((t) => t.source === 'wp:Exemples de test' && t.items.length === 40 && t.name === 'Exemples de test'), 'proposition mal enregistrée');
  check(!one('album-title') && !wpRow('Exemples de test') && rowNames(mineSection()).includes('Exemples de test') && fromCat('Exemples de test'),
    'la collection créée d\'une proposition doit passer dans « Mes collections », sans quitter la liste');
  // Masquer les propositions, puis les afficher ; rétablir la proposition retirée.
  needButton('Masquer les propositions').click();
  await settle(100);
  check(has('Propositions masquées.') && !wpRow('Exemples de test') && !wpRow('Autre essai'), 'les propositions ne sont pas masquées');
  if (!SERVER) check(api.st.prefs.hide_proposals === true, 'masquage non enregistré : ' + JSON.stringify(api.st.prefs));
  needButton('Afficher les propositions').click();
  await settle(100);
  needButton('Rétablir la proposition retirée').click();
  check(await waitFor(() => !!wpRow('Autre essai')), 'la proposition rétablie n\'est pas revenue');
  if (!SERVER) check(api.st.prefs.hide_proposals === false && api.st.prefs.hidden_proposals.length === 0, 'rétablissement non enregistré : ' + JSON.stringify(api.st.prefs));
  // Pour « Entre amis » : une collection « Planète du Système solaire » (Entrée sur la première suggestion).
  type(byId('cat-q'), 'planète');
  byId('cat-q').dispatch('keydown', { key: 'Enter' }); // tout de suite, sans attendre les suggestions
  check(await waitFor(() => at().includes('Planète du Système solaire') && at().includes('1 sur 9')), 'album des planètes : ' + at());
  needButton('Créer une collection').click();
  check(await waitFor(() => has('Modifier') && at().includes('depuis la catégorie Wikipédia')), 'planètes : collection non créée');
  needButton('← Toutes les collections').click();
  await settle();
  check(rowNames(mineSection()).join('|') === 'Exemples de test|Planète du Système solaire' && fromCat('Planète du Système solaire'), 'Mes collections : ' + rowNames(mineSection()).join(' | '));

  // 9 quater bis. Adresse collée dans la recherche des catégories : une catégorie (adresse mobile, encodée) ouvre son
  // album ; une page de liste, l'album des articles qu'elle lie (nature dominante, ou tous), « Créer une collection »
  // (source links:<titre>), « depuis la page Wikipédia « … » » ; collée de nouveau : « Ouvrir ta collection ». Une autre
  // page (redirection suivie) : ses liens aussi ; l'adresse d'un autre site ou d'une page absente : rien à ouvrir.
  {
    const paste = (v) => { const cq = byId('cat-q'); cq.value = v; cq.dispatch('input', { inputType: 'insertFromPaste' }); };
    let n0 = catSuggest.length;
    paste('https://fr.m.wikipedia.org/wiki/Cat%C3%A9gorie:Violet');
    check(await waitFor(() => at().includes('Violet') && at().includes('catégorie de Wikipédia') && cls('slot').length === 3), "adresse d'une catégorie collée : son album attendu, " + at());
    check(JSON.stringify(catSuggest.slice(n0)) === '[["exact","Catégorie:Violet"]]', 'adresse collée : une seule requête attendue, ' + JSON.stringify(catSuggest.slice(n0)));
    needButton('← Toutes les collections').click();
    await settle();
    const n1 = linkCalls.length;
    paste('https://fr.wikipedia.org/wiki/Liste_de_noms_de_couleur#Rouge');
    check(await waitFor(() => at().includes('Noms de couleur') && at().includes('1 sur 5'), 5000), "adresse d'une page de liste collée : album de ses liens attendu, " + at());
    check(at().includes('page de Wikipédia') && has('ne garder que les « couleur » (5 sur 7 articles liés') && cls('cell').length === 1 && cls('slot').length === 4
      && has('Créer une collection') && !has('Modifier'), 'album de la page : nature dominante, sous-classe et description gardées, ' + at() + ' / ' + cls('slot').map((s) => text(s.querySelector('h3'))).join(', '));
    check(all((n) => n.tagName === 'A' && text(n).includes('Voir sur Wikipédia')).some((a) => a.getAttribute('href') === 'https://fr.wikipedia.org/wiki/Liste_de_noms_de_couleur'), 'lien vers la page absent');
    const box = () => all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox' && n.parentNode.classList.contains('check'))[0];
    box().dispatch('change');
    check(await waitFor(() => at().includes('1 sur 7')), 'tous les liens : 1 sur 7 attendu, ' + at());
    box().dispatch('change');
    check(await waitFor(() => at().includes('1 sur 5')), 'retour à la nature dominante : ' + at());
    check(linkCalls.length === n1 + 1, 'liens de la page lus une seule fois : ' + JSON.stringify(linkCalls.slice(n1)));
    needButton('Créer une collection').click();
    check(await waitFor(() => has('Modifier') && has('Supprimer')), '« Créer une collection » (page) sans effet');
    if (!SERVER) {
      const t = api.st.targets.find((x) => x.source === 'links:Liste de noms de couleur');
      check(t && t.name === 'Noms de couleur' && t.items.length === 5 && t.items.every((i) => i.status === 'ok' && /^Q9003\d\d$/.test(i.qid)) && t.items.find((i) => i.title === 'Rouge').description === 'couleur primaire',
        'collection de la page mal enregistrée : ' + JSON.stringify(t));
    }
    check(at().includes('depuis la page Wikipédia « Liste de noms de couleur »') && has('Collection « Noms de couleur » créée : 5 articles (les « couleur » de la page), dans « Mes collections ».'),
      'album de la collection créée depuis la page : ' + at());
    {
      const sortBtn = all((n) => n.tagName === 'BUTTON' && ['Ordre', 'A → Z'].includes(text(n).trim()))[0];
      check(sortBtn && text(sortBtn).trim() === 'A → Z' && !cls('slot__no').length, 'collection faite d\'une page : de A à Z, sans numéros');
    }
    // Fiche de la carte « Article 3 » : « Dans tes collections » la cite.
    one('cell').querySelector('.card').dispatch('click');
    await settle(120);
    check(fiche() && fiche().querySelector('.memberships') && text(fiche().querySelector('.memberships')).includes('Noms de couleur'), 'fiche : « Noms de couleur » attendue dans « Dans tes collections »');
    win.listeners.keydown.forEach((f) => f({ key: 'Escape', preventDefault() {} }));
    await settle(500);
    needButton('← Toutes les collections').click();
    await settle();
    {
      const r = mineSection().querySelectorAll('.row').find((n) => text(n.querySelector('.name')) === 'Noms de couleur');
      check(r && r.querySelector('.row-kind') && text(r.querySelector('.row-kind')) === 'depuis la page Wikipédia « Liste de noms de couleur »', 'ligne de la collection faite d\'une page : ' + (r ? text(r) : 'absente'));
    }
    // Les suggestions la disent déjà faite ; collée de nouveau (adresse mobile) : « Ouvrir ta collection », sans requête.
    type(byId('cat-q'), 'noms de couleur');
    check(await waitFor(() => opts().length === 1 && text(opts()[0]).includes('ta collection')), 'suggestion d\'une page déjà en collection : ' + opts().map(text).join(' / '));
    n0 = catSuggest.length;
    paste('https://fr.m.wikipedia.org/wiki/Liste_de_noms_de_couleur');
    check(await waitFor(() => at().includes('Noms de couleur') && !!buttonByText('Ouvrir ta collection') && !buttonByText('Créer une collection')), 'page déjà en collection : « Ouvrir ta collection » attendu, ' + at());
    check(catSuggest.length === n0, 'adresse déjà lue : réponse gardée attendue, ' + JSON.stringify(catSuggest.slice(n0)));
    needButton('Ouvrir ta collection').click();
    check(await waitFor(() => at().includes('depuis la page Wikipédia') && has('Supprimer')), '« Ouvrir ta collection » (page) : ' + at());
    needButton('Supprimer').click();
    await settle();
    modalBtn('Supprimer la collection').click();
    check(await waitFor(() => !one('album-title') && !rowNames(mineSection()).includes('Noms de couleur')), 'collection « Noms de couleur » non supprimée');
    // Autre page, par /w/index.php?title=… (redirection suivie) : ses liens, sans nature dominante à filtrer.
    paste('https://fr.wikipedia.org/w/index.php?title=Tableau_p%C3%A9riodique&action=history');
    check(await waitFor(() => at().includes('Tableau périodique des éléments') && at().includes('page de Wikipédia') && cls('slot').length + cls('cell').length === 2, 5000), 'autre page collée : ' + at());
    check(has('sans nature dominante à filtrer') && !all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox' && n.parentNode.classList.contains('check')).length, 'page sans nature dominante : ' + at());
    needButton('← Toutes les collections').click();
    await settle();
    // Adresse d'un autre site : rien n'est demandé à Wikipédia ; page absente : la recherche le dit.
    n0 = catSuggest.length;
    type(byId('cat-q'), 'https://en.wikipedia.org/wiki/Color');
    check(await waitFor(() => has("Colle l'adresse d'une page de Wikipédia en français")), 'adresse d\'un autre site : message attendu');
    check(catSuggest.length === n0, 'adresse d\'un autre site : aucune requête attendue');
    paste('https://fr.wikipedia.org/wiki/Page_inexistante_zz');
    check(await waitFor(() => has("Cette page n'existe pas sur Wikipédia : « Page inexistante zz ».")) && !one('album-title'), 'page absente : message attendu');
    type(byId('cat-q'), '');
    await settle();
  }

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
    const m = f.querySelectorAll('button').filter((b) => /^(Copier le nom|Nom) « Zeus »/.test(b.getAttribute('aria-label') || '') && b.classList.contains('copy-name'))[0];
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
      && !g.querySelectorAll('button').some((b) => (b.getAttribute('aria-label') || '').startsWith('Copier le nom')), 'fiche d\'une homonymie : ' + text(g).slice(0, 300));
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
  // Bandeau : les 6 collections de « Mes collections », les 2 faites d'une catégorie de Wikipédia comprises.
  check(colFigure() === '6 collections' && cls('group')[0].querySelectorAll('.row').length === 6, 'tuile des collections : ' + colFigure());

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
    check(cls('cell').length === 1, 'le tag posé sur un autre appareil n\'est pas arrivé');

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
  const left = ['classeur-key', 'classeur-pv', 'classeur-sugg', 'classeur-import-key', 'classeur-known', 'classeur-target', 'classeur-qid', 'classeur-cats', 'classeur-catinfo', 'classeur-catparents', 'classeur-propose-at', 'classeur-natgroup', 'classeur-tagcats'].filter((k) => ls.has(k));
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

  // 25 à 27 : plusieurs classeurs dans ce navigateur (pages à part ; localStorage remis comme avant à la fin).
  {
    const savedLs = ['classeur-key', 'classeur-known', 'classeur-import-key'].map((k) => [k, ls.get(k)]);
    const mkCards = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: prefix + i, title: prefix.toUpperCase() + ' carte ' + i, rarity: 'C', atk: 1, def: 1, quality: 1,
      pageviews: 10, category: 'x', image: null, url: null, count: 1, shiny: false, starred: false, obtained_at: '2026-10-01T00:00:00Z' }));
    const tabOf = (d) => { const t = d.querySelectorAll('button').find((n) => (n.getAttribute('id') || '').startsWith('tab-') && n.getAttribute('aria-selected') === 'true'); return t ? t.getAttribute('id') : null; };
    const bmIn = (d) => d.querySelectorAll('a').find((n) => n.classList.contains('bookmarklet')) || null;
    const bmHas = (d, k) => { const b = bmIn(d); return !!b && decodeURI(b.getAttribute('href').slice(11)).includes('"' + k + '"') && !text(d.body).includes('Créer un nouveau favori'); };
    const modalBtnIn = (d, t) => { const m = d.querySelectorAll('.modal')[0]; return (m && m.querySelectorAll('button').filter((n) => text(n).trim() === t).pop()) || null; };
    const keyA = await makeOtherAccount('Alice');
    const keyB = await makeOtherAccount('Bob');
    await sendImport(keyA, mkCards('a', 500));
    await sendImport(keyB, mkCards('b', 30));
    await rawApi('POST', '/api/targets/save', keyA, { name: 'Rangement Alice', items: [{ title: 'Zeus', status: 'ok' }] });
    const idA = (await rawApi('GET', '/api/me', keyA)).body.user.id;
    const idB = (await rawApi('GET', '/api/me', keyB)).body.user.id;
    const fav = { [idA]: (await rawApi('POST', '/api/import-key', keyA)).body.import_key, [idB]: (await rawApi('POST', '/api/import-key', keyB)).body.import_key };

    // 25. Changement de classeur pendant le chargement du premier : lien du classeur de Bob ouvert dans un navigateur qui
    // garde celui d'Alice, « Ouvrir » cliqué avant que les cartes d'Alice soient lues. La fin du premier chargement ne
    // touche pas au classeur de Bob : ni l'onglet (« Mettre à jour », celui d'un classeur vide), ni le favori (clé d'import
    // lue sans compte : « Créer un nouveau favori »), ni les collections (celles d'Alice, arrivées après coup).
    for (const when of ['cartes', 'santé', 'collections']) {
      ls.set('classeur-import-key', JSON.stringify(fav));
      ls.set('classeur-key', keyA);
      ls.set('classeur-known', JSON.stringify([{ key: keyA, name: 'Alice' }]));
      // Réponses retenues : les cartes ; GET /api/health du second chargement (« santé ») ; les collections d'Alice.
      const gate = { cards: [], health: [], targets: [] };
      const hold = { cards: true, health: false, targets: when === 'collections' };
      const p = openPage({ idb: 'absent', hash: '#cle=' + keyB, hold: (url) => {
        const k = url.startsWith('/api/cards') ? 'cards' : url === '/api/health' ? 'health' : url === '/api/targets' ? 'targets' : null;
        if (!k || !hold[k]) return null;
        if (k === 'targets') hold.targets = false;
        return new Promise((r) => gate[k].push(r));
      } });
      check(await waitFor(() => text(p.doc.body).includes('Ouvrir le classeur de Bob à la place du tien ?') && gate.cards.length === 1),
        `changement pendant le chargement (${when}) : question et lecture des cartes d'Alice attendues`);
      if (when === 'santé') hold.health = true;
      modalBtnIn(p.doc, 'Ouvrir').click();
      if (when === 'santé') {
        check(await waitFor(() => gate.health.length === 1), 'changement pendant le chargement (santé) : second chargement attendu sur GET /api/health');
        gate.cards[0](); // cartes d'Alice, arrivées pendant le second chargement
        await settle(60);
        hold.health = false;
        gate.health[0]();
      }
      check(await waitFor(() => gate.cards.length === 2), `changement pendant le chargement (${when}) : lecture des cartes de Bob attendue`);
      if (when !== 'santé') { gate.cards[0](); await settle(60); }
      hold.cards = false;
      gate.cards[1]();
      check(await waitFor(() => p.count() === 30), `changement pendant le chargement (${when}) : cartes de Bob absentes (${p.count()})`);
      if (when === 'collections') gate.targets[0]();
      await settle(200);
      const h = text(p.doc.querySelector('h1'));
      check(h === 'Le classeur de Bob' && tabOf(p.doc) === 'tab-collections' && p.count() === 30,
        `changement pendant le chargement (${when}) : classeur de Bob sur « Mes collections » attendu, ${h} / ${tabOf(p.doc)} / ${p.count()} cartes`);
      check(!text(p.doc.body).includes('Rangement Alice'), `changement pendant le chargement (${when}) : une collection d'Alice est arrivée dans le classeur de Bob`);
      p.doc.getElementById('tab-maj').click();
      await settle(100);
      check(bmHas(p.doc, fav[idB]), `changement pendant le chargement (${when}) : le favori de Bob (clé gardée) doit être prêt`);
    }

    // 26. « Supprimer mon classeur » : seule la clé du favori du classeur supprimé est oubliée ; celles des autres
    // classeurs de ce navigateur restent, comme eux (sinon leur favori, toujours installé, serait à recréer).
    {
      ls.set('classeur-import-key', JSON.stringify(fav));
      ls.set('classeur-key', keyB);
      ls.set('classeur-known', JSON.stringify([{ key: keyA, name: 'Alice' }, { key: keyB, name: 'Bob' }]));
      const p = openPage({ idb: 'absent' });
      check(await waitFor(() => p.count() === 30), 'suppression : classeur de Bob non ouvert');
      p.doc.getElementById('tab-reglages').click();
      await settle();
      p.doc.querySelectorAll('button').find((n) => text(n).trim() === 'Supprimer mon classeur').click();
      await settle();
      modalBtnIn(p.doc, 'Supprimer mon classeur').click();
      check(await waitFor(() => !ls.has('classeur-key')) && text(p.doc.body).includes("J'ai déjà un lien"), 'suppression : classeur de Bob non supprimé');
      check(ls.get('classeur-import-key') === JSON.stringify({ [idA]: fav[idA] }), 'suppression : clés de favori gardées ' + ls.get('classeur-import-key') + ", au lieu de celle d'Alice seule");
      check(ls.get('classeur-known') === JSON.stringify([{ key: keyA, name: 'Alice' }]), 'suppression : classeurs connus ' + ls.get('classeur-known'));
      ls.set('classeur-key', keyA);
      const p2 = openPage({ idb: 'absent' });
      check(await waitFor(() => p2.count() === 500), "suppression : classeur d'Alice non rouvert");
      p2.doc.getElementById('tab-maj').click();
      await settle(100);
      check(bmHas(p2.doc, fav[idA]), "suppression : le favori d'Alice doit rester prêt");
    }

    // 27. Fenêtre « Mettre à jour avec le favori » : les autres classeurs connus ne sont relus (GET /api/me, qui compte
    // les cartes du compte sur le serveur) qu'à son ouverture, puis toutes les 30 s pendant 3 min ; le classeur ouvert,
    // toutes les 4 s. Un envoi arrivé dans l'un d'eux est quand même signalé. Horloge de la page accélérée (×100).
    if (!SERVER) {
      const SPEED = 100;
      const keyD = await makeOtherAccount('Dora');
      const keyE = await makeOtherAccount('Eva');
      const keyF = await makeOtherAccount('Fred');
      for (const [k, n] of [[keyD, 'd'], [keyE, 'e'], [keyF, 'f']]) await sendImport(k, mkCards(n, 3));
      ls.set('classeur-key', keyD);
      ls.set('classeur-known', JSON.stringify([keyD, keyE, keyF].map((key) => ({ key, name: '' }))));
      const p = openPage({ idb: 'absent', speed: SPEED });
      check(await waitFor(() => p.count() === 3), 'fenêtre du favori : classeur de Dora non ouvert');
      const openSyncIn = () => p.doc.querySelectorAll('button').find((n) => text(n).includes('Mettre à jour avec le favori')).click();
      // Heures (secondes de la page, depuis t0) des GET /api/me faits avec la clé k depuis la position `from` du journal.
      const meAt = (k, from, t0) => apiKeyLog.slice(from).filter((x) => x.call === 'GET /api/me' && x.key === k).map((x) => (x.at - t0) * SPEED / 1000);
      const fmtS = (s) => s.map((x) => Math.round(x) + ' s').join(', ');
      let from = apiKeyLog.length;
      let t0 = Date.now();
      openSyncIn();
      await sleep(240 * 1000 / SPEED); // 4 min de la page, sans envoi
      for (const k of [keyE, keyF]) {
        const s = meAt(k, from, t0);
        check(s.length >= 4 && s.length <= 7 && s[0] < 5 && s.every((x, i) => !i || x - s[i - 1] >= 25) && s[s.length - 1] <= 190,
          `fenêtre du favori : autre classeur relu ${s.length} fois en 4 min (${fmtS(s)}) ; attendu : à l'ouverture, puis toutes les 30 s pendant 3 min`);
      }
      const own = meAt(keyD, from, t0);
      check(own.length >= 30, `fenêtre du favori : le classeur ouvert doit être relu toutes les 4 s (${own.length} fois en 4 min)`);
      modalBtnIn(p.doc, 'Fermer').click();
      await settle();
      // Le favori a envoyé dans le classeur d'Eva : signalé à la première relecture (30 s).
      from = apiKeyLog.length;
      t0 = Date.now();
      openSyncIn();
      await sleep(50);
      await sendImport(keyE, mkCards('e', 4));
      check(await waitFor(() => text(p.doc.body).includes("Tes cartes sont arrivées dans le classeur de Eva, pas dans celui ouvert ici.")),
        "fenêtre du favori : envoi dans le classeur d'Eva non signalé");
      const s = meAt(keyE, from, t0);
      check(s.length === 2 && s[1] >= 25 && s[1] <= 45, `fenêtre du favori : classeur d'Eva relu à ${fmtS(s)} (attendu : à l'ouverture, puis à 30 s)`);
      modalBtnIn(p.doc, 'Fermer').click();
      await settle();
    }

    // 27 bis. Onglet du classeur visible : GET /api/me toutes les 60 s (minuterie déclenchée à la main ici), et les
    // cartes (?since) seulement si cards_rev a bougé — envoi du favori relié à la page du jeu —, avec « Mis à jour depuis
    // wiki-masters.com ». Onglet caché : minuterie arrêtée, rien n'est lu ; de nouveau visible : relu aussitôt, minuterie
    // relancée.
    {
      const keyG = await makeOtherAccount('Gil');
      await sendImport(keyG, mkCards('g', 3));
      ls.set('classeur-key', keyG);
      const p = openPage({ idb: 'absent' });
      check(await waitFor(() => p.count() === 3), 'relecture périodique : classeur de Gil non ouvert');
      await settle(60);
      check(p.longTimers.size === 1, `relecture périodique : une minuterie d'une minute attendue, ${p.longTimers.size}`);
      const reads = (from) => apiKeyLog.slice(from).filter((x) => x.key === keyG && /^GET \/api\/(me|cards)\b/.test(x.call)).map((x) => x.call);
      let from = apiKeyLog.length;
      await p.live();
      await settle(60);
      check(reads(from).join(', ') === 'GET /api/me', 'relecture périodique sans changement : seul GET /api/me attendu, ' + reads(from).join(', '));
      await sendImport(keyG, mkCards('g', 5));
      from = apiKeyLog.length;
      await p.live();
      check(await waitFor(() => p.count() === 5), `relecture périodique : nouvelles cartes absentes (${p.count()})`);
      const got = reads(from);
      check(got.length === 2 && got[0] === 'GET /api/me' && /^GET \/api\/cards\?since=\d+$/.test(got[1]), 'relecture périodique après un envoi : ' + got.join(', '));
      check(text(p.doc.body).includes('Mis à jour depuis wiki-masters.com : 2 nouvelles cartes (5 cartes).'), 'message « Mis à jour depuis wiki-masters.com » absent');
      p.doc.visibilityState = 'hidden';
      await p.visible();
      check(p.longTimers.size === 0, 'onglet caché : la minuterie doit être arrêtée');
      from = apiKeyLog.length;
      await sendImport(keyG, mkCards('g', 6));
      await p.live();
      await settle(60);
      check(reads(from).length === 0, 'onglet caché : aucune lecture attendue, ' + reads(from).join(', '));
      p.doc.visibilityState = 'visible';
      await p.visible();
      check(await waitFor(() => p.count() === 6) && p.longTimers.size === 1, `retour sur l'onglet : ${p.count()} cartes, ${p.longTimers.size} minuterie`);
    }
    for (const [k, v] of savedLs) if (v == null) ls.delete(k); else ls.set(k, v);
  }

  // 28. Entre amis : partage choisi et réciproque ; deux amis (Paul, Léa), Zoé qui ne partage pas ; mise en avant des
  // cases vides que les amis remplissent (doubles d'abord, rapprochement par qid), badge d'une case vide, fiche,
  // classeur d'un ami en lecture seule (« Me manquent »), l'inverse (tes cartes pour leurs collections), désactivation.
  // Sur la page principale (classeur de Cédric).
  {
    const myKey3 = ls.get('classeur-key');
    const fc = (id, title, rarity, count, extra) => ({ id, title, rarity, atk: 10, def: 10, quality: 50, pageviews: 100, category: 'test', image: null,
      url: 'https://fr.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')), count, shiny: false, starred: false, obtained_at: '2026-10-01T10:00:00Z', ...extra });
    const paulKey = await makeOtherAccount('Paul');
    const leaKey = await makeOtherAccount('Léa');
    const zoeKey = await makeOtherAccount('Zoé');
    await sendImport(paulKey, [fc('p-mars', 'Mars (planète)', 'UR', 2), fc('p-jup', 'Jupiter (planète)', 'UR', 1), fc('p-a5', 'Article 5', 'C', 1),
      fc('p-pluton', 'Pluton', 'R', 1, { shiny: true }), fc('p-a1', 'Article 1', 'PC', 3)]);
    await sendImport(leaKey, [fc('l-jup', 'Jupiter (planète)', 'UR', 1), fc('l-sat', 'Saturne (planète)', 'SR', 3), fc('l-nep', 'Neptune', 'SR', 1), fc('l-a7', 'Article 7', 'C', 1)]);
    await sendImport(zoeKey, [fc('z-mars', 'Mars (planète)', 'UR', 5)]);
    for (const k of [paulKey, leaKey]) check((await rawApi('PATCH', '/api/me', k, { shared: true })).status === 200, 'partage des amis refusé');
    // Sans partager soi-même : 403 (réciprocité), et l'onglet invite à partager sans rien lire des autres.
    check((await rawApi('GET', '/api/members', myKey3)).status === 403, 'sans partage, GET /api/members doit répondre 403');
    mark = apiLog.length;
    await goTab('amis');
    check(tabBtn('amis') && text(tabBtn('amis')) === 'Entre amis', 'onglet « Entre amis » absent');
    check(has('Montrer mes cartes aux autres membres') && has('Le partage est réciproque') && has('Jamais tes tags'), 'Entre amis : invitation au partage absente');
    check(!apiLog.slice(mark).some((x) => x.includes('/api/members')), 'sans partage, la page ne doit pas lire les membres : ' + apiLog.slice(mark).join(', '));
    needButton('Montrer mes cartes aux autres membres').click();
    const fcol = (name) => cls('fcol').find((n) => text(n.querySelector('.fcol__name')) === name) || null;
    const titlesIn = (n) => n.querySelectorAll('.fitem__title').map(text);
    check(await waitFor(() => has('Paul') && has('Léa') && fcol('Planète du Système solaire'), 5000), 'Entre amis : membres ou mise en avant absents');
    check(fcol('Planète du Système solaire').querySelector('.row-kind') && text(fcol('Planète du Système solaire').querySelector('.row-kind')) === 'depuis la catégorie Wikipédia', 'collection tirée de la catégorie : mention discrète attendue');
    check(apiLog.slice(mark).includes('PATCH /api/me') && !has('Zoé') && !has('Bob'), 'seuls les membres qui partagent doivent apparaître');
    if (!SERVER) {
      // Cartes lues par pages (2 par page dans l'API simulée) : Paul 5 cartes = 3 pages, Léa 4 = 2 pages ; jamais Zoé.
      const reads = apiLog.slice(mark).filter((x) => x.startsWith('GET /api/members/'));
      check(reads.length === 5 && reads.every((x) => /\/cards\?part=/.test(x)), 'cartes des amis : 5 pages attendues, ' + reads.join(', '));
    }
    // Neptune (titre différent, même qid Q332) : reconnu une fois les qids des cartes des amis résolus.
    check(await waitFor(() => fcol('Planète du Système solaire') && titlesIn(fcol('Planète du Système solaire')).includes('Neptune (planète)'), 10000),
      'mise en avant : « Neptune » de Léa doit compter pour « Neptune (planète) » (qid) : ' + text(fcol('Planète du Système solaire')));
    {
      const col = fcol('Planète du Système solaire');
      check(titlesIn(col).join(' | ') === 'Saturne (planète) | Mars (planète) | Jupiter (planète) | Neptune (planète)', 'ordre : doubles d\'abord, ' + titlesIn(col).join(' | '));
      check(text(col).includes('4 cases à remplir chez tes amis') && text(col).includes('2 en double'), 'résumé de la collection : ' + text(col));
      check(cls('fcol')[0] === col, 'la collection où les amis remplissent le plus de cases vient en premier');
      const jup = col.querySelectorAll('.fitem').find((n) => text(n).includes('Jupiter'));
      check(jup.querySelectorAll('.holder').map(text).join(',') === 'Léa,Paul' && text(col.querySelectorAll('.fitem')[0]).includes('Léa ×3'), 'qui a quoi : ' + text(col));
      check(fcol('Exemples de test') && titlesIn(fcol('Exemples de test')).join() === 'Article 5', 'Exemples de test : Article 5 (chez Paul) attendu');
    }
    // Membres : nombre de cartes et cartes qui me manquent.
    const paulRow = cls('member').find((n) => text(n).includes('Paul'));
    check(paulRow && text(paulRow).includes('5 cartes') && text(paulRow).includes('4 cartes que tu n\'as pas') && text(paulRow).includes('1 en double'), 'ligne de Paul : ' + text(paulRow));
    // L'inverse : personne ne partage encore ses collections, donc rien à leur proposer (plus d'estimation par le catalogue).
    check(await waitFor(() => has('Aucun de tes amis ne partage ses collections : impossible de savoir ce qui leur manque.')) && !fcol('Paul') && !fcol('Léa')
      && !cls('badge').some((b) => text(b) === 'estimation'), 'tes cartes pour tes amis : rien sans leurs collections, ' + text(doc.body).slice(-400));
    // Rien des amis dans IndexedDB (le cache ne garde que mon classeur).
    await sleep(1600);
    check(!JSON.stringify(cachedCards()).includes('p-mars') && !JSON.stringify(cachedCards()).includes('Pluton'), 'les cartes des amis ne doivent pas aller dans IndexedDB');

    // Album : badge discret sur les cases vides qu'un ami peut remplir ; fiche de la case vide : « Chez : … ».
    fcol('Planète du Système solaire').querySelector('.fcol__name').click();
    await settle(80);
    check(has("Il t'en manque") && tabBtn('collections').getAttribute('aria-selected') === 'true', 'le nom de la collection doit ouvrir son album');
    const slotOf = (t) => cls('slot').find((n) => text(n.querySelector('h3')) === t);
    const badge = (t) => { const s = slotOf(t); const b = s && s.querySelector('.slot__friends'); return b ? text(b) : null; };
    check(badge('Mars (planète)') === 'chez Paul ×2' && badge('Saturne (planète)') === 'chez Léa ×3' && badge('Jupiter (planète)') === 'chez Léa +1'
      && badge('Neptune (planète)') === 'chez Léa' && badge('Mercure (planète)') === null,
      'badges des cases vides : ' + ['Mars', 'Saturne', 'Jupiter', 'Neptune', 'Mercure'].map((p) => p + '=' + badge(p + ' (planète)')).join(', '));
    check(slotOf('Mars (planète)').querySelector('.slot__friends').classList.contains('dup'), 'un double doit ressortir');
    slotOf('Jupiter (planète)').querySelector('.slot__open').click();
    await settle();
    check(one('fiche--missing') && text(one('fiche--missing')).includes('Chez : Léa, Paul'), 'fiche de la case vide : « Chez : Léa, Paul » attendu : ' + text(one('fiche--missing')));
    one('fiche--missing').querySelector('.close').click();
    await settle();
    slotOf('Mars (planète)').querySelector('.slot__open').click();
    await settle();
    check(text(one('fiche--missing')).includes('Chez : Paul (×2)'), 'fiche : « Chez : Paul (×2) » attendu');
    one('fiche--missing').querySelector('.close').click();
    await settle();

    // Classeur de Paul en lecture seule : toutes ses cartes, puis « Me manquent », recherche.
    mark = apiLog.length;
    await goTab('amis');
    if (!SERVER) check(apiLog.slice(mark).filter((x) => x.startsWith('GET /api/members/')).length === 0, 'cartes des amis relues sans changement : ' + apiLog.slice(mark).join(', '));
    all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Parcourir le classeur de Paul')[0].click();
    await settle();
    check(has('Le classeur de Paul') && has('lecture seule') && cls('card--friend').length === 5, 'classeur de Paul : 5 cartes attendues, ' + cls('card--friend').length);
    check(cls('card--friend').filter((n) => n.classList.contains('have')).map((n) => text(n.querySelector('.card__title'))).join() === 'Article 1', 'seule « Article 1 » est déjà à moi');
    check(!cls('card--friend').some((n) => n.getAttribute('role') === 'button' || n.parentNode.querySelector('input')), 'cartes d\'un ami : ni fiche ni sélection');
    exactButton('Me manquent').click();
    await settle();
    check(cls('card--friend').length === 4 && !cls('card--friend').some((n) => n.classList.contains('have')), '« Me manquent » : 4 cartes attendues');
    type(byId('fq'), 'pluton');
    await settle();
    check(cls('card--friend').length === 1 && cls('card--friend')[0].classList.contains('shiny'), 'recherche dans le classeur d\'un ami');
    needButton('← Entre amis').click();
    await settle();
    check(has('Pour compléter tes collections'), 'retour à la vue d\'ensemble');

    // 29. Échanges possibles : Paul montre aussi ses collections (deux), Léa non (estimation d'après le catalogue), Zoé
    // ne montre rien. Une ligne « carte de X → collection(s) de Z » par carte, groupées par couple ; vraies collections
    // avant les estimations, puis doubles, puis nombre de cases ; filtres « Ce qui me concerne » (défaut), « Tout le
    // monde », par membre ; « Ce qui pourrait intéresser tes amis » sur les vraies collections de Paul ; second réglage.
    {
      // Paul : « Article 1 », « Mars » et « Pluton » sont à lui ; « Neptune (planète) » (qid Q332) = « Neptune » de Léa ;
      // « Article 7 » est dans ses deux collections ; des éléments que personne n'a, ou introuvables.
      for (const t of [
        { name: 'Les préférées de Paul', items: [
          { title: 'Terre', description: 'planète', image: null, status: 'ok', qid: 'Q2' }, { title: 'Rihanna', description: null, image: null, status: 'ok' },
          { title: 'Article 60', description: null, image: null, status: 'ok' }, { title: 'Saturne (planète)', description: null, image: null, status: 'ok' },
          { title: 'Neptune (planète)', description: null, image: null, status: 'ok', qid: 'Q332' }, { title: 'Article 7', description: null, image: null, status: 'ok' },
          { title: 'Livre introuvable', description: null, image: null, status: 'ok' }, { title: 'Article 1', description: null, image: null, status: 'ok' },
          { title: 'Mars (planète)', description: null, image: null, status: 'ok' }, { title: 'Article 40', description: null, image: null, status: 'missing' },
        ] },
        { name: 'Exemples de Paul', items: [{ title: 'Article 7', description: null, image: null, status: 'ok' }, { title: 'Pluton', description: null, image: null, status: 'ok' }] },
      ]) check((await rawApi('POST', '/api/targets/save', paulKey, t)).status === 200, 'collection de Paul refusée');
      const pubOf = async (name, key) => ((await rawApi('GET', '/api/members', key)).body.members.find((m) => m.name === name) || {}).id;
      const paulPub = await pubOf('Paul', myKey3);
      check((await rawApi('GET', '/api/members/' + paulPub + '/targets', myKey3)).status === 404, 'collections de Paul visibles sans son accord');
      check((await rawApi('PATCH', '/api/me', paulKey, { shared_targets: 'oui' })).status === 400, 'shared_targets non booléen accepté');
      check((await rawApi('PATCH', '/api/me', zoeKey, { shared_targets: true })).status === 400, 'Zoé ne montre pas ses cartes : ses collections non plus (400)');
      check((await rawApi('PATCH', '/api/me', paulKey, { shared_targets: true })).body.shared_targets === true, 'Paul : partage des collections refusé');
      check((await rawApi('GET', '/api/members/' + paulPub + '/targets', zoeKey)).status === 403, 'Zoé ne montre pas ses cartes : 403 attendu');
      {
        const r = await rawApi('GET', '/api/members/' + paulPub + '/targets', myKey3);
        const s = JSON.stringify(r.body);
        check(r.status === 200 && s.includes('Les préférées de Paul') && !s.includes('"description"') && !s.includes('Article 40') && !s.includes('"status"'),
          'collections de Paul vues par l\'API : ' + s.slice(0, 300));
      }
      mark = apiLog.length;
      needButton('Actualiser').click();
      const row = (name) => cls('member').find((n) => text(n.querySelector('.name')) === name);
      check(await waitFor(() => row('Paul') && text(row('Paul')).includes('partage ses collections : 2'), 5000), 'ligne de Paul : ' + text(row('Paul')));
      check(text(row('Léa')).includes('ne partage pas ses collections'), 'ligne de Léa : ' + text(row('Léa')));
      const tsum = () => (one('trade-sum') ? text(one('trade-sum')) : '');
      check(await waitFor(() => tsum().includes('4 de tes cartes peuvent compléter les collections de tes amis ; 6 de leurs cartes peuvent compléter les tiennes. Entre eux : 3.'), 8000),
        'résumé des échanges : ' + tsum());
      if (!SERVER) {
        const reads = apiLog.slice(mark).filter((x) => x.startsWith('GET /api/members/'));
        check(reads.length === 2 && reads.every((x) => x.startsWith('GET /api/members/' + paulPub + '/targets?part=')), 'collections lues : celles de Paul seulement, 2 pages : ' + reads.join(', '));
      }
      check(has('Léa ne partage pas ses collections') && has('Tes amis ne voient pas tes collections'), 'notes des échanges absentes');
      // « Ce qui pourrait intéresser tes amis » : les collections que Paul montre ; rien pour Léa, qui ne les montre pas.
      check(fcol('Paul') && titlesIn(fcol('Paul')).join(' | ') === 'Article 7 | Rihanna | Terre | Article 60' && !fcol('Paul').querySelector('.badge'),
        'tes cartes pour Paul (ses collections) : ' + (fcol('Paul') ? text(fcol('Paul')) : 'absent'));
      check(!fcol('Léa') && has('Rien pour Léa, qui ne partage pas ses collections.'), 'tes cartes pour Léa : rien attendu (elle ne partage pas ses collections)');
      // La page : « Tout le monde » par défaut (demande de l'utilisateur, 2026-10-16), puis « Ce qui me concerne ».
      needButton('Voir les échanges possibles').click();
      await settle();
      const pairs = () => cls('trade').map((n) => text(n.querySelector('.fcol__name')).replace(' pour ', ''));
      const pair = (name) => cls('trade').find((n) => text(n.querySelector('.fcol__name')).replace(' pour ', '') === name) || null;
      const pressed = () => one('seg') ? one('seg').querySelectorAll('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map(text).join() : '';
      check(has('Échanges possibles') && pressed() === 'Tout le monde', 'page des échanges : filtre par défaut ' + pressed());
      // « Seulement les cartes en double », cochée par défaut : chaque ligne montrée est un double (×n) de celui qui donne.
      check(byId('trade-dup') && byId('trade-dup').checked === true, 'case « Seulement les cartes en double » absente ou décochée par défaut');
      {
        const shown = cls('trade');
        const rowsOf = (n) => n.querySelectorAll('.fitem__title').length;
        check(shown.length > 0 && shown.every((n) => rowsOf(n) > 0 && n.querySelectorAll('.holder.dup').length === rowsOf(n)),
          'doubles seulement : ' + shown.map((n) => text(n.querySelector('.fcol__name')) + ' ' + rowsOf(n) + '/' + n.querySelectorAll('.holder.dup').length).join(' ; '));
      }
      byId('trade-dup').dispatch('change');
      await settle();
      check(pairs().join(' | ') === 'Toi → Paul | Léa → Toi | Léa → Paul | Paul → Toi', 'couples (tout le monde, tous les exemplaires) : ' + pairs().join(' | '));
      exactButton('Ce qui me concerne').click();
      await settle();
      check(pressed() === 'Ce qui me concerne' && pairs().join(' | ') === 'Toi → Paul | Léa → Toi | Paul → Toi', 'couples (ce qui me concerne) : ' + pairs().join(' | '));
      {
        const p = pair('Toi → Paul');
        check(titlesIn(p).join(' | ') === 'Article 7 | Rihanna | Terre | Article 60', 'Toi → Paul : ' + titlesIn(p).join(' | '));
        check(text(p).includes('Tu peux compléter 4 cases chez Paul, dont 3 en double'), 'résumé Toi → Paul : ' + text(p.querySelector('.fcol__sum')));
        const a7 = p.querySelectorAll('.fitem')[0];
        check(text(a7).includes('×2') && text(a7).includes('Les préférées de Paul') && text(a7).includes('Exemples de Paul'), 'Article 7 : ses deux collections attendues : ' + text(a7));
        check(!text(p.querySelectorAll('.fitem')[3]).includes('×'), 'Article 60 : un seul exemplaire, pas de ×');
        check(titlesIn(pair('Léa → Toi')).join(' | ') === 'Saturne (planète) | Jupiter (planète) | Neptune' && text(pair('Léa → Toi')).includes('Léa peut compléter 3 cases chez toi, dont 1 en double'),
          'Léa → Toi : ' + text(pair('Léa → Toi')));
        check(titlesIn(pair('Paul → Toi')).join(' | ') === 'Mars (planète) | Jupiter (planète) | Article 5', 'Paul → Toi : ' + text(pair('Paul → Toi')));
        // Plus de « (catégorie) » : une collection faite d'une catégorie est une collection comme les autres.
        check(text(pair('Paul → Toi').querySelectorAll('.fitem')[0]).includes('Planète du Système solaire') && !text(pair('Paul → Toi')).includes('(catégorie)') && !text(a7).includes('(catégorie)'),
          'nature des collections dans les échanges : ' + text(pair('Paul → Toi').querySelectorAll('.fitem')[0]));
        check(!pair('Toi → Léa') && !cls('trade').some((n) => n.querySelector('.badge')), "plus d'estimation pour Léa, qui ne partage pas ses collections");
        // Ta carte : sa fiche ; une case vide chez toi : la fiche de la carte manquante. Une ligne pour un ami : deux boutons
        // côte à côte (ta carte, et chaque collection de l'ami, qui ouvre son album), jamais l'un dans l'autre.
        check(a7.tagName === 'DIV' && a7.querySelector('.fitem__main') && a7.querySelectorAll('.fitem__col').map(text).join(' | ') === 'Les préférées de Paul | Exemples de Paul'
          && !a7.querySelector('.fitem__main').querySelector('button'), 'Article 7 : la carte et les collections de Paul, en boutons distincts : ' + text(a7));
        a7.querySelector('.fitem__main').click();
        await settle();
        check(fiche() && text(fiche()).includes('Article 7') && !one('fiche--missing'), 'clic sur ta carte : sa fiche attendue');
        fiche().querySelector('.close').click();
        await settle();
        pair('Paul → Toi').querySelectorAll('.fitem')[0].click();
        await settle();
        check(one('fiche--missing') && text(one('fiche--missing')).includes('Mars (planète)'), 'clic sur une carte de Paul pour toi : fiche de la case vide attendue');
        one('fiche--missing').querySelector('.close').click();
        await settle();
      }
      exactButton('Tout le monde').click();
      await settle();
      check(pairs().join(' | ') === 'Toi → Paul | Léa → Toi | Léa → Paul | Paul → Toi', 'couples (tout le monde) : ' + pairs().join(' | '));
      {
        const p = pair('Léa → Paul');
        check(titlesIn(p).join(' | ') === 'Saturne (planète) | Article 7 | Neptune' && text(p).includes('Léa peut compléter 3 cases chez Paul, dont 1 en double'), 'Léa → Paul : ' + text(p));
        check(!p.querySelectorAll('.fitem').some((n) => n.tagName === 'BUTTON'), 'entre deux amis : rien à ouvrir');
      }
      const sel = byId('trade-member');
      sel.value = paulPub;
      sel.dispatch('change');
      await settle();
      check(pairs().join(' | ') === 'Toi → Paul | Léa → Paul | Paul → Toi' && pressed() === '', 'couples (Paul) : ' + pairs().join(' | ') + ' / ' + pressed());
      // « Un membre… » : retour au filtre par défaut, « Tout le monde ».
      sel.value = '';
      sel.dispatch('change');
      await settle();
      check(pressed() === 'Tout le monde' && pairs().length === 4, '« Un membre… » : « Tout le monde » attendu, ' + pressed());
      exactButton('Ce qui me concerne').click();
      await settle();
      check(pairs().length === 3 && byId('trade-member').value === '', 'retour à « Ce qui me concerne »');
      // Rien des amis dans IndexedDB ; rien de relu en revenant sur l'onglet quand rien n'a changé.
      await sleep(1600);
      check(!JSON.stringify(cachedCards()).includes('Les préférées de Paul'), 'les collections des amis ne doivent pas aller dans IndexedDB');
      needButton('← Entre amis').click();
      await settle();
      mark = apiLog.length;
      await goTab('collections');
      await goTab('amis');
      if (!SERVER) check(apiLog.slice(mark).filter((x) => x.startsWith('GET /api/members/')).length === 0, 'collections de Paul relues sans changement : ' + apiLog.slice(mark).join(', '));
      // Second réglage, seulement quand on montre ses cartes : Paul voit alors mes collections (titres et qids seulement).
      await goTab('reglages');
      const cbt = byId('set-shared-targets');
      check(cbt && !cbt.checked && has('et mes collections à compléter'), 'second réglage absent ou coché');
      cbt.checked = true;
      cbt.dispatch('change');
      await settle(80);
      check(byId('set-shared-targets').checked && has('Tes collections à compléter sont montrées'), 'partage des collections sans effet');
      {
        const mine = (await rawApi('GET', '/api/members', paulKey)).body.members.find((m) => m.name === 'Cédric');
        check(mine && mine.targets && mine.targets.count === 6, 'Paul doit voir que je montre mes 6 collections : ' + JSON.stringify(mine));
        const r = await rawApi('GET', '/api/members/' + mine.id + '/targets', paulKey);
        const all2 = [];
        let part = '0';
        for (let g = 0; g < 10; g++) {
          const x = await rawApi('GET', '/api/members/' + mine.id + '/targets?part=' + encodeURIComponent(part), paulKey);
          all2.push(...x.body.targets);
          if (!x.body.next_part) break;
          part = x.body.next_part;
        }
        check(r.status === 200 && all2.some((t) => t.name === 'Planète du Système solaire' && t.kind === 'category') && all2.some((t) => t.name === 'Maladies' && t.kind === 'collection')
          && !JSON.stringify(all2).includes('"description"') && !JSON.stringify(all2).includes('wp:'), 'mes collections vues par Paul : ' + JSON.stringify(all2).slice(0, 300));
      }
      await goTab('amis');
      check(!has('Tes amis ne voient pas tes collections'), 'la note « Tes amis ne voient pas tes collections » doit disparaître');

      // 30. Les collections des amis : « Ses collections » dans le classeur de Paul (une liste, celles tirées d'une catégorie
      // de Wikipédia signalées ; progression avec SES cartes), album d'une de ses collections en lecture seule (« tu l'as »,
      // « ×2 en double », ses cartes qui manquent à mes collections, filtres, fiche sans action, « Copier le nom », retours),
      // ouvert aussi depuis « Échanges possibles » et « Ce qui pourrait intéresser tes amis », « Créer la même collection
      // chez moi » ; Léa, qui ne partage pas ses collections ; rien dans IndexedDB ; vues demandées à Wikipédia seulement
      // pour les cases que ni Paul ni moi n'avons.
      {
        // Paul a aussi deux collections tirées de catégories : « Planète du Système solaire » (j'en ai une aussi) et
        // « Élément chimique » (pas moi).
        const its = (list) => list.map((title) => ({ title, description: null, image: null, status: 'ok' }));
        for (const t of [
          { name: 'Planète du Système solaire', source: 'wp:Planète du Système solaire', items: its(['Mars (planète)', 'Jupiter (planète)', 'Terre', 'Saturne (planète)']) },
          { name: 'Élément chimique', source: 'wp:Élément chimique', items: its(['Hydrogène', 'Hélium', 'Lithium']) },
        ]) check((await rawApi('POST', '/api/targets/save', paulKey, t)).status === 200, 'catégorie de Paul refusée');
        needButton('Actualiser').click();
        check(await waitFor(() => row('Paul') && text(row('Paul')).includes('partage ses collections : 4'), 5000), 'ligne de Paul (4 collections) : ' + text(row('Paul')));
        const openBinder = async (name) => { all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Parcourir le classeur de ' + name)[0].click(); await settle(); };
        const sect = (id) => all((n) => n.tagName === 'SECTION' && n.getAttribute('aria-labelledby') === id)[0] || null;
        const colRow = (name) => cls('row').find((n) => n.querySelector('.name') && text(n.querySelector('.name')) === name) || null;
        const cr = (name) => text(colRow(name));
        const rowNamesIn = (n) => (n ? n.querySelectorAll('.row').map((r) => text(r.querySelector('.name'))) : []);
        const KIND = 'depuis la catégorie Wikipédia';
        await openBinder('Paul');
        check(sect('h-fcols') && text(sect('h-fcols')).includes('Ses collections') && sect('h-fcards') && !has('Ses catégories'),
          '« Ses collections » absente du classeur de Paul : ' + text(doc.body).slice(-800));
        {
          // Une seule liste, de A à Z ; celles tirées d'une catégorie le disent ; progression avec SES cartes ; ce que je
          // peux lui donner.
          check(rowNamesIn(sect('h-fcols')).join(' | ') === 'Élément chimique | Exemples de Paul | Les préférées de Paul | Planète du Système solaire',
            'ses collections : ' + rowNamesIn(sect('h-fcols')).join(' | '));
          check(sect('h-fcols').querySelectorAll('.row').filter((r) => r.querySelector('.row-kind') && text(r.querySelector('.row-kind')) === KIND).map((r) => text(r.querySelector('.name'))).join(' | ')
            === 'Élément chimique | Planète du Système solaire', 'collections tirées d\'une catégorie : signalées');
          check(cr('Les préférées de Paul').includes('2 sur 9') && cr('Les préférées de Paul').includes('22 %') && cr('Les préférées de Paul').includes("Tu peux l'aider : 4, dont 3 en double")
            && colRow('Les préférées de Paul').querySelectorAll('.mini').length === 2, 'progression des préférées de Paul : ' + cr('Les préférées de Paul'));
          check(cr('Exemples de Paul').includes('1 sur 2') && cr('Exemples de Paul').includes('50 %') && cr('Exemples de Paul').includes("Tu peux l'aider : 1, dont 1 en double"), 'Exemples de Paul : ' + cr('Exemples de Paul'));
          check(cr('Planète du Système solaire').includes('2 sur 4') && cr('Planète du Système solaire').includes("Tu peux l'aider : 1, dont 1 en double"), 'catégorie de Paul : ' + cr('Planète du Système solaire'));
          // Hydrogène : ma carte « Hydrogène (élément) » (même qid).
          check(await waitFor(() => cr('Élément chimique').includes('0 sur 3') && cr('Élément chimique').includes("Tu peux l'aider : 1"), 8000) && colRow('Élément chimique').classList.contains('zero'),
            'Élément chimique (Paul) : ' + cr('Élément chimique'));
        }
        // Album des préférées de Paul : ses cartes et ses cases vides, dans l'ordre de sa collection.
        const atitle = () => (one('album-title') ? text(one('album-title')) : '');
        const grid = () => cls('cardgrid')[0] || null;
        const shownTitles = () => (grid() ? grid().childNodes.filter((n) => n.nodeType === 1).map((n) => text(n.querySelector('h3'))) : []);
        const fslot = (t) => cls('slot').find((n) => n.querySelector('h3') && text(n.querySelector('h3')) === t) || null;
        const fcard = (t) => cls('card--fa').find((n) => text(n.querySelector('.card__title')) === t) || null;
        const gives = (t) => { const s = fslot(t); return s ? s.querySelectorAll('.slot__friends').map(text) : null; };
        const pvMark = pvAsked.length;
        colRow('Les préférées de Paul').click();
        await settle(80);
        check(atitle().includes('Les préférées de Paul') && atitle().includes('Paul en a 2 sur 9') && atitle().includes('lecture seule') && !atitle().includes('catégorie'), 'album de Paul : ' + atitle());
        check(shownTitles().join(' | ') === 'Terre | Rihanna | Article 60 | Saturne (planète) | Neptune (planète) | Article 7 | Livre introuvable | Article 1 | Mars (planète)'
          && cls('card--fa').length === 2 && cls('slot').length === 7, 'album de Paul, ordre et cases : ' + shownTitles().join(' | '));
        check(text(fslot('Terre').querySelector('.slot__no')) === '1' && one('bar') && one('give-sum') && text(one('give-sum')).includes("Tu peux l'aider : 4 cartes dont 3 en double")
          && text(one('give-sum')).includes('1 de ses cartes manque à tes collections'), 'en-tête de l\'album : ' + (one('give-sum') ? text(one('give-sum')) : 'absent'));
        // Cases vides que je remplis : « tu l'as », et « ×2 en double » pour mes doubles ; rareté de ma carte (sans ≈).
        check(gives('Terre').join() === "tu l'as,×2 en double" && gives('Rihanna').join() === "tu l'as,×2 en double" && gives('Article 60').join() === "tu l'as"
          && gives('Article 7').join() === "tu l'as,×2 en double" && gives('Saturne (planète)').length === 0 && gives('Livre introuvable').length === 0,
          'badges « tu l\'as » : ' + ['Terre', 'Rihanna', 'Article 60', 'Article 7', 'Saturne (planète)'].map((t) => t + '=' + gives(t)).join(', '));
        check(fslot('Terre').classList.contains('can') && !fslot('Saturne (planète)').classList.contains('can') && !fslot('Terre').querySelector('.pill').classList.contains('est'),
          'cases que je remplis : à part, rareté de ma carte');
        // Ses cartes : Mars me manque et remplirait ma collection des planètes ; Article 1, je l'ai.
        check(fcard('Mars (planète)') && fcard('Mars (planète)').classList.contains('want') && text(fcard('Mars (planète)').querySelector('.card__mark')) === 'Te manque'
          && text(fcard('Mars (planète)').parentNode.querySelector('.cell__want')).startsWith('→ Planète du Système solaire'), 'Mars chez Paul : ' + text(fcard('Mars (planète)').parentNode));
        check(fcard('Article 1').classList.contains('have') && text(fcard('Article 1').querySelector('.card__mark')) === "Tu l'as" && !fcard('Article 1').parentNode.querySelector('.cell__want'), 'Article 1 chez Paul');
        // Vues sur Wikipédia : seulement pour les cases que ni Paul ni moi n'avons (Saturne et Neptune sont déjà en cache).
        check(await waitFor(() => fslot('Livre introuvable') && text(fslot('Livre introuvable')).includes('vues inconnues'), 5000), 'vues de « Livre introuvable » : ' + text(fslot('Livre introuvable')));
        {
          const asked = pvAsked.slice(pvMark);
          check(asked.includes('Livre introuvable') && asked.every((t) => ['Saturne (planète)', 'Neptune (planète)', 'Livre introuvable'].includes(t)), 'vues demandées pour l\'album de Paul : ' + asked.join(', '));
        }
        // Filtres : Toutes / Il les a / Lui manquent / Tu peux l'aider ; tri par rareté.
        exactButton('Il les a').click();
        await settle();
        check(shownTitles().join(' | ') === 'Article 1 | Mars (planète)', '« Il les a » : ' + shownTitles().join(' | '));
        exactButton('Lui manquent').click();
        await settle();
        check(shownTitles().length === 7 && !cls('card--fa').length, '« Lui manquent » : ' + shownTitles().join(' | '));
        exactButton("Tu peux l'aider").click();
        await settle();
        check(shownTitles().join(' | ') === 'Terre | Rihanna | Article 60 | Article 7', '« Tu peux l\'aider » : ' + shownTitles().join(' | '));
        exactButton('Rareté').click();
        await settle();
        check(shownTitles()[0] === 'Rihanna' && shownTitles().length === 4, 'tri par rareté : ' + shownTitles().join(' | '));
        exactButton('Ordre').click();
        exactButton('Toutes').click();
        await settle();
        check(shownTitles().length === 9, '« Toutes » : ' + shownTitles().length);
        // « Copier le nom » sur une case vide.
        {
          const n0 = copied.length;
          fslot('Article 60').querySelector('.slot__copy').click();
          await settle();
          check(copied[n0] === 'Article 60', 'copier le nom d\'une case de Paul : ' + JSON.stringify(copied.slice(n0)));
        }
        // Fiche d'une case vide que je remplis : en lecture seule, sans rien qui touche à mon classeur.
        const fs = () => one('fiche--friend');
        fslot('Terre').querySelector('.slot__open').click();
        await settle();
        check(fs() && text(fs()).includes('Manque à Paul') && text(fs()).includes("Tu l'as : ×2, en double") && text(fs()).includes('Tu pourrais la lui donner'), 'fiche de Terre (case vide de Paul) : ' + text(fs()));
        check(!fs().querySelectorAll('input, textarea, select').length && !fs().querySelectorAll('button').some((b) => /Ajouter|Suivre|Modifier|Supprimer|Valider/.test(text(b))),
          'fiche d\'un ami : aucune action sur un classeur');
        {
          const lists = fs().querySelectorAll('.memberships').map((m) => m.querySelectorAll('button').map(text));
          check(text(fs()).includes('Dans les collections de Paul') && lists.length === 2 && lists[0].some((t) => t.startsWith('Les préférées de Paul'))
            && lists[0].some((t) => t.startsWith('Planète du Système solaire')) && text(fs()).includes('Dans tes collections') && lists[1].some((t) => t.startsWith('Planète du Système solaire')),
          'fiche de Terre : collections de Paul et les miennes : ' + text(fs()));
        }
        {
          const n0 = copied.length;
          fs().querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'Copier le nom « Terre »').click();
          await settle();
          check(copied[n0] === 'Terre', 'copier le nom (fiche d\'un ami) : ' + JSON.stringify(copied.slice(n0)));
        }
        fs().querySelector('.close').click();
        await settle();
        // Fiche d'une de ses cartes qui me manque.
        fcard('Mars (planète)').click();
        await settle();
        check(fs() && text(fs()).includes('Chez Paul : ×2') && text(fs()).includes('Pas encore dans ta collection') && text(fs()).includes('Rareté dans le jeu')
          && text(fs()).includes('Dans tes collections') && !fiche().querySelector('#new-tag'), 'fiche de Mars (carte de Paul) : ' + text(fs()));
        fs().querySelector('.close').click();
        await settle();
        needButton('← Retour au classeur de Paul').click();
        await settle();
        check(has('Le classeur de Paul') && sect('h-fcols') && !one('card--fa'), 'retour au classeur de Paul');
        // Sa collection tirée d'une catégorie : de A à Z, sans numéros, signalée.
        colRow('Planète du Système solaire').click();
        await settle(80);
        check(atitle().includes('Planète du Système solaire') && atitle().includes(KIND) && atitle().includes('Paul en a 2 sur 4')
          && shownTitles().join(' | ') === 'Jupiter (planète) | Mars (planète) | Saturne (planète) | Terre' && !cls('slot__no').length && !has('Suivre aussi'),
          'catégorie de Paul : ' + atitle() + ' / ' + shownTitles().join(' | '));
        needButton('← Retour au classeur de Paul').click();
        await settle();
        // Celle que je n'ai pas : Hydrogène (qid), Hélium (rareté estimée, vignette) ; « Créer la même collection chez moi »
        // (sa liste d'articles, recopiée telle quelle, sans requête à Wikipédia).
        colRow('Élément chimique').click();
        await settle(80);
        check(await waitFor(() => gives('Hydrogène') && gives('Hydrogène')[0] === "tu l'as", 8000), 'Hydrogène (ma carte, même qid) : ' + JSON.stringify(gives('Hydrogène')));
        check(await waitFor(() => fslot('Hélium') && text(fslot('Hélium').querySelector('.pill')) === '≈ SR' && fslot('Hélium').querySelector('.slot__bg')), 'Hélium : rareté estimée et vignette : ' + text(fslot('Hélium')));
        {
          needButton('Créer la même collection chez moi').click();
          check(await waitFor(() => buttonByText('Ouvrir ma collection'), 5000) && has('Collection « Élément chimique » créée dans ton classeur : 3 articles.') && !buttonByText('Créer la même collection'),
            'Créer la même collection chez moi : sans effet');
          const mineT = ((await rawApi('GET', '/api/targets', myKey3)).body.targets || []).find((x) => x.name === 'Élément chimique');
          check(mineT && mineT.items.map((i) => i.title + ':' + i.status).join() === 'Hydrogène:ok,Hélium:ok,Lithium:ok' && !mineT.source, 'collection copiée de Paul : ' + JSON.stringify(mineT));
        }
        needButton('Ouvrir ma collection').click();
        await settle(80);
        check(tabBtn('collections').getAttribute('aria-selected') === 'true' && atitle().includes('Élément chimique') && !atitle().includes('lecture seule'), 'ma collection : ' + atitle());
        await goTab('amis');
        needButton('← Retour au classeur de Paul').click();
        await settle();
        needButton('← Entre amis').click();
        await settle();
        // Depuis « Ce qui pourrait intéresser tes amis » : le nom d'une collection de Paul ouvre son album.
        fcol('Paul').querySelectorAll('.fitem__col')[0].click();
        await settle(80);
        check(atitle().includes('Paul en a') && buttonByText('← Retour au classeur de Paul') && !buttonByText('← Échanges possibles'), 'album depuis « Ce qui pourrait intéresser tes amis » : ' + atitle());
        needButton('← Retour au classeur de Paul').click();
        await settle();
        needButton('← Entre amis').click();
        await settle();
        // Depuis « Échanges possibles » : le nom d'une collection de Paul ouvre son album ; un lien ramène aux échanges, filtre gardé.
        needButton('Voir les échanges possibles').click();
        await settle();
        exactButton('Ce qui me concerne').click(); // un filtre autre que celui par défaut : il doit être gardé au retour
        await settle();
        const a7row = () => (pair('Toi → Paul') ? pair('Toi → Paul').querySelectorAll('.fitem').find((n) => text(n.querySelector('.fitem__title')) === 'Article 7') || null : null);
        check(a7row(), 'échanges : Article 7 pour Paul absent');
        a7row().querySelectorAll('.fitem__col').find((b) => text(b) === 'Exemples de Paul').click();
        await settle(80);
        check(atitle().includes('Exemples de Paul') && atitle().includes('Paul en a 1 sur 2') && buttonByText('← Échanges possibles') && buttonByText('← Retour au classeur de Paul')
          && gives('Article 7').join() === "tu l'as,×2 en double", 'album depuis les échanges : ' + atitle());
        needButton('← Échanges possibles').click();
        await settle();
        check(has('Échanges possibles') && pressed() === 'Ce qui me concerne' && a7row(), 'retour aux échanges : filtre gardé, ' + pressed());
        a7row().querySelectorAll('.fitem__col').find((b) => text(b) === 'Les préférées de Paul').click();
        await settle(80);
        needButton('← Retour au classeur de Paul').click();
        await settle();
        check(has('Le classeur de Paul') && sect('h-fcols'), 'retour au classeur de Paul (depuis les échanges)');
        needButton('← Entre amis').click();
        await settle();
        // Léa ne partage pas ses collections.
        await openBinder('Léa');
        check(sect('h-fcols') && text(sect('h-fcols')).includes('Léa ne partage pas ses collections.') && !sect('h-fcols').querySelector('.row') && cls('card--friend').length === 4,
          'classeur de Léa : ' + (sect('h-fcols') ? text(sect('h-fcols')) : 'absent'));
        needButton('← Entre amis').click();
        await settle();
        // Rien des collections des amis dans IndexedDB ni dans localStorage.
        await sleep(1600);
        const kept = JSON.stringify(cachedCards());
        check(!kept.includes('Les préférées de Paul') && !kept.includes('Livre introuvable') && !kept.includes('p-mars'), 'les collections des amis ne doivent pas aller dans IndexedDB');
        check(![...ls.values()].some((v) => String(v).includes('Les préférées de Paul') || String(v).includes('Exemples de Paul')), 'les collections des amis ne doivent pas aller dans localStorage');
      }
    }

    // Désactivation dans les Réglages : l'onglet invite de nouveau à partager ; Paul ne me voit plus.
    check((await rawApi('GET', '/api/members', paulKey)).body.members.some((m) => m.name === 'Cédric'), 'Paul doit me voir');
    await goTab('reglages');
    const cb = byId('set-shared');
    check(has('Partage entre membres') && cb && cb.checked, 'réglage du partage absent ou décoché');
    cb.checked = false;
    cb.dispatch('change');
    await settle(80);
    check(!byId('set-shared').checked && has('ne sont plus montrées'), 'désactivation du partage sans effet');
    // Le partage des collections tombe avec celui des cartes (à rechoisir) : le second réglage disparaît.
    check(!byId('set-shared-targets') && (await rawApi('GET', '/api/me', myKey3)).body.shared_targets === false, 'partage des collections encore actif après la désactivation');
    check(!(await rawApi('GET', '/api/members', paulKey)).body.members.some((m) => m.name === 'Cédric'), 'Paul me voit encore après la désactivation');
    await goTab('amis');
    check(has('Montrer mes cartes aux autres membres') && !cls('fcol').length && !has('Pour compléter tes collections'), 'après désactivation : invitation au partage attendue');
    await goTab('collections');
  }

  // Collection créée par le favori depuis une recherche de la Collection globale du jeu (source wm:…) : la rareté du jeu
  // s'affiche sans « ≈ » (case vide, fiche de la carte manquante, « Il t'en manque ») ; l'estimation reste pour les autres.
  {
    const keyG = await makeOtherAccount('Gaston');
    await sendImport(keyG, [{ id: 'g1', title: 'Vache normande', rarity: 'PC', atk: 1, def: 1, quality: 1, pageviews: 10, category: 'race bovine', image: null, url: null,
      count: 1, shiny: false, starred: false, obtained_at: '2026-10-01T00:00:00Z' }]);
    await rawApi('POST', '/api/targets/save', keyG, { name: 'Vaches', source: 'wm:vache', items: [
      { title: 'Vache', description: 'mammifère domestique', image: null, status: 'ok', rarity: 'R' },
      { title: 'Vache Highland', description: null, image: null, status: 'ok', rarity: 'UR' },
      { title: 'Vache normande', description: 'race bovine', image: null, status: 'ok', rarity: 'PC' },
      { title: 'Zeus', description: 'dieu grec', image: null, status: 'ok' }, // sans rareté du jeu : estimée (vues gardées en cache)
    ] });
    // Préférences d'avant le retrait du catalogue (hidden_catalog, hide_catalog) : encore lues, puis réécrites au format
    // actuel (hidden_proposals, hide_proposals), les ids du catalogue oubliés, le reste gardé.
    check((await rawApi('PATCH', '/api/me', keyG, { prefs: { hidden_catalog: ['vaches', 'wp:Autre essai'], hide_catalog: true, autre: 1 } })).status === 200, 'anciennes préférences refusées');
    ls.set('classeur-key', keyG);
    ls.set('classeur-known', JSON.stringify([{ key: keyG, name: 'Gaston' }]));
    const p = openPage({ idb: 'absent' });
    check(await waitFor(() => p.count() === 1), 'collection du jeu : classeur de Gaston non ouvert');
    p.doc.getElementById('tab-collections').click();
    await settle();
    {
      check(text(p.doc.body).includes('Propositions masquées.'), 'anciennes préférences : hide_catalog doit masquer les propositions');
      p.doc.querySelectorAll('button').find((b) => text(b) === 'Afficher les propositions').click();
      await settle(100);
      const prefs = (await rawApi('GET', '/api/me', keyG)).body.prefs;
      check(JSON.stringify(prefs) === JSON.stringify({ autre: 1, hidden_proposals: ['wp:Autre essai'], hide_proposals: false }), 'anciennes préférences mal reprises : ' + JSON.stringify(prefs));
    }
    const row = p.doc.querySelectorAll('.row').find((n) => (n.getAttribute('aria-label') || '').startsWith('Vaches'));
    check(row, 'collection du jeu : « Vaches » absente de « Mes collections »');
    row.click();
    await settle(80);
    const slotOf = (t) => p.doc.querySelectorAll('.slot').find((s) => s.querySelector('h3') && text(s.querySelector('h3')) === t);
    const pillOf = (t) => { const s = slotOf(t); return s && s.querySelector('.pill') ? text(s.querySelector('.pill')) : null; };
    check(await waitFor(() => pillOf('Zeus') === '≈ L'), 'collection du jeu : rareté estimée de « Zeus » attendue, ' + pillOf('Zeus'));
    check(pillOf('Vache') === 'R' && pillOf('Vache Highland') === 'UR', 'collection du jeu : raretés du jeu sans « ≈ » attendues, ' + pillOf('Vache') + ' / ' + pillOf('Vache Highland'));
    check(!slotOf('Vache').querySelector('.pill').classList.contains('est'), 'collection du jeu : pastille estimée pour une rareté du jeu');
    const missBox = p.doc.querySelectorAll('.missing-sum').find((n) => text(n).includes("Il t'en manque 3 :"));
    const missPills = missBox ? missBox.querySelectorAll('.pill').map(text) : [];
    check(missPills.join(',') === 'UR,R,≈ L' && text(missBox).includes('Tu en as') === false,
      "collection du jeu : « Il t'en manque » : " + p.doc.querySelectorAll('.missing-sum').map(text).join(' | '));
    check(await waitFor(() => text(p.doc.body).includes('Sans « ≈ » : rareté relevée dans le jeu.')), 'collection du jeu : explication des pastilles sans « ≈ » absente');
    slotOf('Vache').querySelector('.slot__open').click();
    await settle(120);
    const f = p.doc.querySelectorAll('.fiche--missing')[0];
    const ft = f ? text(f) : '';
    check(ft.includes('Rareté dans le jeu') && ft.includes('Rare') && !ft.includes('≈') && ft.includes('mammifère domestique') && text(f.querySelector('.pill')) === 'R',
      'collection du jeu : fiche de la carte manquante : ' + ft.slice(0, 300));
    f.querySelector('.close').click();
    await settle(400);
  }

  // Propositions d'après les cartes, sans les sous-catégories (Iris : 8 cartes de couleurs). Rouge, Vert et Jaune sont
  // des sous-catégories de Couleur, toutes proposables (2 cartes chacune, au moins 5 %).
  {
    const keyI = await makeOtherAccount('Iris');
    const mk1 = (id, title) => ({ id, title, rarity: 'C', atk: 1, def: 1, quality: 1, pageviews: 10, category: 'couleur', image: null, url: null, count: 1, shiny: false, starred: false, obtained_at: '2026-10-01T00:00:00Z' });
    await sendImport(keyI, Object.keys(CARD_CATS).map((t, i) => mk1('i' + i, t)));
    ls.set('classeur-key', keyI);
    ls.set('classeur-known', JSON.stringify([{ key: keyI, name: 'Iris' }]));
    const proposedIn = (d) => d.querySelectorAll('.row').filter((n) => n.classList.contains('wp')).map((n) => text(n.querySelector('.name')));
    const openIris = async () => {
      const pg = openPage({ idb: 'absent' });
      check(await waitFor(() => pg.count() === 8), 'propositions : classeur d\'Iris non ouvert');
      pg.doc.getElementById('tab-collections').click();
      await settle();
      return pg;
    };
    const pt = (d) => text(d.body);
    const btnIn = (d, t) => d.querySelectorAll('button').find((b) => text(b).trim() === t) || null;
    const ariaBtn = (d, t) => d.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === t) || null;
    const atIn = (d) => (d.querySelectorAll('.album-title').length ? text(d.querySelectorAll('.album-title')[0]) : '');
    const coveredIn = (d) => { const n = d.querySelectorAll('.wp-covered')[0]; return n ? text(n) : ''; };
    const targetsOf = async (key) => (await rawApi('GET', '/api/targets', key)).body.targets;
    const searchCat = (d, q) => { const cq = d.getElementById('cat-q'); cq.value = q; cq.dispatch('input'); cq.dispatch('keydown', { key: 'Enter' }); };
    const ready = (d) => !d.querySelectorAll('.wp-progress').length;
    // 1. Couleur est proposée : ses sous-catégories, proposables aussi, ne le sont pas une à une ; Couleur les regroupe
    // (« Regroupe 3 sous-catégories proposées ») et son album s'ouvre sous-catégories comprises.
    let p = await openIris();
    check(await waitFor(() => proposedIn(p.doc).length > 0 && ready(p.doc), 8000), 'propositions d\'Iris absentes');
    check(proposedIn(p.doc).join('|') === 'Couleur', 'parente proposée : seule « Couleur » attendue, ' + proposedIn(p.doc).join(' | '));
    check(['Rouge', 'Vert', 'Jaune', 'Couleur'].every((c) => parentCalls.includes('Catégorie:' + c)), 'catégories parentes non demandées : ' + parentCalls.join(', '));
    check(text(p.doc.querySelectorAll('.row-why')[0]) === 'Tu as : Arc-en-ciel et Spectre visible', 'pourquoi la catégorie est proposée : ' + text(p.doc.querySelectorAll('.row-why')[0]));
    {
      const line = p.doc.querySelectorAll('.row-subs')[0];
      check(line && text(line) === 'Regroupe 3 sous-catégories proposées : Jaune, Rouge et Vert. La collection est créée sous-catégories comprises.',
        'sous-catégories regroupées sous « Couleur » : ' + (line ? text(line) : 'absent'));
    }
    p.doc.querySelectorAll('.row-open')[0].click();
    check(await waitFor(() => atIn(p.doc).includes('Couleur') && atIn(p.doc).includes('8 sur 8')), 'album de « Couleur » ouvert depuis la proposition : sous-catégories comprises attendues, ' + atIn(p.doc));
    {
      const box = p.doc.querySelectorAll('input').find((n) => n.getAttribute('type') === 'checkbox' && n.parentNode.classList.contains('check'));
      check(box && box.checked === true, 'album de « Couleur » : case des sous-catégories cochée attendue');
    }
    btnIn(p.doc, '← Toutes les collections').click();
    await settle();
    // « Créer une collection » sur la proposition : ses 2 articles et les 6 de ses sous-catégories ; plus rien n'est
    // proposé, et la page dit pourquoi (les 3 sous-catégories sont couvertes par la nouvelle collection).
    ariaBtn(p.doc, 'Créer une collection « Couleur »').click();
    check(await waitFor(() => pt(p.doc).includes('Collection « Couleur » créée : 8 articles, sous-catégories comprises, dans « Mes collections ».')), 'collection « Couleur » (proposition) non créée');
    {
      const tc = (await targetsOf(keyI)).find((t) => t.source === 'wp:Couleur');
      check(tc && tc.items.map((i) => i.title).sort().join('|') === Object.keys(CARD_CATS).sort().join('|'), 'collection « Couleur » : ses articles et ceux de ses sous-catégories attendus, ' + JSON.stringify(tc && tc.items.map((i) => i.title)));
      check(await waitFor(() => !proposedIn(p.doc).length && coveredIn(p.doc) === 'Pas de nouvelle proposition : 3 catégories de tes cartes sont écartées car déjà couvertes par « Couleur » (au moins 80 % de leurs cartes y sont déjà).')
        && !pt(p.doc).includes('Pas de proposition pour l\'instant'), 'propositions couvertes : message attendu, ' + coveredIn(p.doc) + ' / ' + proposedIn(p.doc).join(' | '));
      check((await rawApi('POST', '/api/targets/delete', keyI, { id: tc.id })).status === 200, 'suppression de « Couleur » refusée');
    }
    // 2. Couleur retirée : elle n'est plus proposée, ses sous-catégories le sont.
    p = await openIris();
    check(await waitFor(() => proposedIn(p.doc).join('|') === 'Couleur' && ready(p.doc), 8000), 'collection supprimée : « Couleur » de nouveau proposée attendue, ' + proposedIn(p.doc).join(' | '));
    p.doc.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'Retirer « Couleur » des propositions').click();
    await settle();
    p.doc.querySelectorAll('.modal')[0].querySelectorAll('button').filter((b) => text(b).trim() === 'Retirer des propositions')[0].click();
    check(await waitFor(() => proposedIn(p.doc).join('|') === 'Jaune|Rouge|Vert'), 'parente retirée : ses sous-catégories attendues, ' + proposedIn(p.doc).join(' | '));
    check(!p.doc.querySelectorAll('.row-subs').length, 'parente retirée : plus rien de regroupé');
    // 3. Une collection « Couleurs » contient déjà mes cartes rouges et vertes, et une des deux jaunes : Rouge et Vert sont
    // « couvertes » (100 %), pas Jaune (50 % < 80 %) ; la page le dit.
    check((await rawApi('POST', '/api/targets/save', keyI, { name: 'Couleurs', items: ['Coquelicot', 'Fraise', 'Pomme verte', 'Menthe', 'Citron']
      .map((title) => ({ title, description: null, image: null, status: 'ok' })) })).status === 200, 'collection « Couleurs » refusée');
    p = await openIris();
    check(await waitFor(() => proposedIn(p.doc).length > 0 && ready(p.doc), 8000) && proposedIn(p.doc).join('|') === 'Jaune',
      'couvertes par « Couleurs » : seule « Jaune » attendue, ' + proposedIn(p.doc).join(' | '));
    check(coveredIn(p.doc) === '2 autres catégories de tes cartes écartées car déjà couvertes par « Couleurs ».', 'couvertes : message attendu, ' + coveredIn(p.doc));
    // 4. Une collection faite de « Catégorie:Couleur » SANS ses sous-catégories n'a pas les articles de Jaune (sur
    // Wikipédia, un article est rangé dans la catégorie la plus précise) : Jaune reste proposée.
    searchCat(p.doc, 'couleur');
    check(await waitFor(() => atIn(p.doc).includes('Couleur') && atIn(p.doc).includes('2 sur 2')), 'album de « Couleur » (recherche, sans sous-catégories) : ' + atIn(p.doc));
    check(await waitFor(() => p.doc.querySelectorAll('button').some((b) => text(b).includes('Créer une collection') && !b.disabled)), '« Créer une collection » indisponible');
    p.doc.querySelectorAll('button').find((b) => text(b).includes('Créer une collection')).click();
    check(await waitFor(() => atIn(p.doc).includes('depuis la catégorie Wikipédia') && !!btnIn(p.doc, 'Supprimer')), 'collection « Couleur » non créée : ' + atIn(p.doc));
    if (!SERVER) check(api.users.find((u) => u.key === keyI).targets.some((t) => t.source === 'wp:Couleur' && t.items.length === 2), 'collection « Couleur » (2 articles) mal enregistrée');
    btnIn(p.doc, '← Toutes les collections').click();
    await settle();
    check(proposedIn(p.doc).join('|') === 'Jaune', 'parente en collection sans ses sous-catégories : « Jaune » doit rester proposée, ' + proposedIn(p.doc).join(' | '));
    // 5. Supprimée (confirmation), puis refaite AVEC ses sous-catégories : Jaune est couverte, plus rien n'est proposé.
    p.doc.querySelectorAll('.row').find((n) => (n.getAttribute('aria-label') || '').startsWith('Couleur :')).click();
    await settle(80);
    btnIn(p.doc, 'Supprimer').click();
    await settle();
    btnIn(p.doc.querySelectorAll('.modal')[0], 'Supprimer la collection').click();
    check(await waitFor(() => !atIn(p.doc) && !p.doc.querySelectorAll('.row').some((n) => (n.getAttribute('aria-label') || '').startsWith('Couleur :'))), 'collection « Couleur » non supprimée');
    searchCat(p.doc, 'couleur');
    check(await waitFor(() => atIn(p.doc).includes('2 sur 2') && !!btnIn(p.doc, 'Créer une collection')), 'album de « Couleur » : ' + atIn(p.doc));
    p.doc.querySelectorAll('input').find((n) => n.getAttribute('type') === 'checkbox' && n.parentNode.classList.contains('check')).dispatch('change');
    check(await waitFor(() => atIn(p.doc).includes('8 sur 8')), 'avec ses sous-catégories : 8 sur 8 attendu, ' + atIn(p.doc));
    btnIn(p.doc, 'Créer une collection').click();
    check(await waitFor(() => atIn(p.doc).includes('depuis la catégorie Wikipédia')), 'collection « Couleur » (sous-catégories comprises) non créée');
    btnIn(p.doc, '← Toutes les collections').click();
    await settle();
    check(!proposedIn(p.doc).length && coveredIn(p.doc) === 'Pas de nouvelle proposition : 3 catégories de tes cartes sont écartées car déjà couvertes par tes collections, surtout « Couleurs » (au moins 80 % de leurs cartes y sont déjà).',
      'parente en collection avec ses sous-catégories : rien de proposé attendu, ' + proposedIn(p.doc).join(' | ') + ' / ' + coveredIn(p.doc));

    // Courses (Jade : cartes rouges et jaunes, Rouge et Jaune proposées ; Kim : cartes vertes), réponses de Wikipédia
    // (wikiHold) ou de GET /api/me (hold) retenues.
    const keyJ = await makeOtherAccount('Jade');
    const keyK = await makeOtherAccount('Kim');
    await sendImport(keyJ, ['Coquelicot', 'Fraise', 'Citron', 'Banane'].map((t, i) => mk1('j' + i, t)));
    await sendImport(keyK, ['Pomme verte', 'Menthe'].map((t, i) => mk1('k' + i, t)));
    const known = JSON.stringify([{ key: keyJ, name: 'Jade' }, { key: keyK, name: 'Kim' }]);
    const gates = [];
    const wikiSeen = [];
    let holdIf = null; // (adresse décodée) => vrai : réponse de Wikipédia retenue jusqu'à release()
    const wikiHold = (url) => { const u = decodeURIComponent(url); wikiSeen.push(u); return holdIf && holdIf(u) ? new Promise((r) => gates.push(r)) : null; };
    const release = () => { holdIf = null; while (gates.length) gates.shift()(); };
    let meHold = false;
    const meGates = [];
    const hold = (url) => (meHold && url === '/api/me' ? new Promise((r) => meGates.push(r)) : null);
    const tabIn = (d) => { const t = d.querySelectorAll('button').find((n) => (n.getAttribute('id') || '').startsWith('tab-') && n.getAttribute('aria-selected') === 'true'); return t ? t.getAttribute('id') : null; };
    const openJade = async (wantProposals = true) => {
      ls.set('classeur-key', keyJ);
      ls.set('classeur-known', known);
      const pg = openPage({ idb: 'absent', wikiHold, hold });
      check(await waitFor(() => pg.count() === 4), 'classeur de Jade non ouvert');
      pg.doc.getElementById('tab-collections').click();
      await settle();
      if (wantProposals) check(await waitFor(() => proposedIn(pg.doc).length > 0 && ready(pg.doc), 8000), 'propositions de Jade absentes');
      return pg;
    };
    // A. « Créer une collection », puis changement de classeur pendant la lecture des articles : rien n'est enregistré
    // (ni chez Kim, où la page est passée, ni chez Jade), et le classeur de Kim n'a que ses propositions.
    let pj = await openJade();
    check(proposedIn(pj.doc).join('|') === 'Jaune|Rouge', 'propositions de Jade : ' + proposedIn(pj.doc).join(' | '));
    holdIf = (u) => u.includes('list=categorymembers') && u.includes('Catégorie:Rouge');
    ariaBtn(pj.doc, 'Créer une collection « Rouge »').click();
    check(await waitFor(() => gates.length === 1), 'lecture des articles de « Rouge » attendue');
    pj.doc.getElementById('tab-reglages').click();
    await settle();
    btnIn(pj.doc, 'Ouvrir').click();
    check(await waitFor(() => text(pj.doc.querySelector('h1')) === 'Le classeur de Kim' && pj.count() === 2), 'classeur de Kim non ouvert : ' + text(pj.doc.querySelector('h1')));
    release();
    await settle(200);
    check(!(await targetsOf(keyK)).some((t) => t.source === 'wp:Rouge') && !(await targetsOf(keyJ)).some((t) => t.source === 'wp:Rouge'),
      'collection créée dans le classeur de Jade, enregistrée après le changement de classeur : ' + JSON.stringify((await targetsOf(keyK)).map((t) => t.source)));
    pj.doc.getElementById('tab-collections').click();
    check(await waitFor(() => proposedIn(pj.doc).join('|') === 'Vert' && ready(pj.doc)), 'classeur de Kim : seule « Vert » attendue, ' + proposedIn(pj.doc).join(' | '));
    // E. « Masquer les propositions » pendant un calcul (caches vidés : il doit tout redemander) : il s'arrête, plus rien
    // n'est demandé à Wikipédia ; « Afficher » le relance.
    for (const k of ['classeur-cats', 'classeur-catinfo', 'classeur-catparents']) ls.delete(k);
    holdIf = (u) => u.includes('prop=categories') && !u.includes('titles=Catégorie:');
    const pe = await openJade(false);
    check(await waitFor(() => gates.length === 1 && pe.doc.querySelectorAll('.wp-progress').length === 1), 'calcul des propositions en cours attendu');
    const mark = wikiSeen.length;
    btnIn(pe.doc, 'Masquer les propositions').click();
    await settle(100);
    release();
    await settle(300);
    const after = wikiSeen.slice(mark).filter((u) => /prop=categor/.test(u));
    check(!after.length && pt(pe.doc).includes('Propositions masquées.'), 'masquées pendant le calcul : Wikipédia encore interrogé, ' + after.join(' ; '));
    const mark2 = wikiSeen.length;
    btnIn(pe.doc, 'Afficher les propositions').click();
    check(await waitFor(() => ready(pe.doc) && wikiSeen.slice(mark2).some((u) => u.includes('prop=categories') && !u.includes('titles=Catégorie:'))), 'propositions affichées : le calcul doit reprendre');
    // B. « Créer une collection » sur la proposition, puis son album ouvert pendant la lecture : le bouton de l'album
    // attend (« Un instant… »), puis l'album devient celui de la collection ; une seule collection de source wp:Rouge.
    pj = await openJade();
    holdIf = (u) => u.includes('list=categorymembers') && u.includes('Catégorie:Rouge') && u.includes('cmnamespace=0&cmlimit=500'); // propose.js seul
    ariaBtn(pj.doc, 'Créer une collection « Rouge »').click();
    check(await waitFor(() => gates.length === 1), 'lecture des articles de « Rouge » (proposition) attendue');
    pj.doc.querySelectorAll('.row-open').find((b) => text(b) === 'Rouge').click();
    check(await waitFor(() => atIn(pj.doc).includes('Rouge') && atIn(pj.doc).includes('2 sur 2')), 'album de « Rouge » pendant la création : ' + atIn(pj.doc));
    {
      const b = pj.doc.querySelectorAll('button').find((n) => /Créer une collection|Un instant/.test(text(n)) && !n.getAttribute('aria-label'));
      check(b && text(b).includes('Un instant…') && b.disabled, 'album pendant la création depuis la proposition : bouton en attente attendu, ' + (b ? text(b) + (b.disabled ? ' (désactivé)' : '') : 'absent'));
      b.click(); // désactivé : sans effet
    }
    release();
    check(await waitFor(() => atIn(pj.doc).includes('Rouge') && atIn(pj.doc).includes('depuis la catégorie Wikipédia')), 'l\'album doit passer à la collection créée : ' + atIn(pj.doc));
    check((await targetsOf(keyJ)).filter((t) => t.source === 'wp:Rouge').length === 1, 'deux collections de source wp:Rouge');
    btnIn(pj.doc, '← Toutes les collections').click();
    await settle();
    // C. Entrée avant l'arrivée des suggestions, puis on passe à « Mes cartes » (ou on quitte le champ) : à leur arrivée,
    // aucune catégorie ne s'ouvre.
    for (const [how, q] of [['onglet', 'rouge'], ['champ quitté', 'jaune']]) {
      holdIf = (u) => u.includes('generator=prefixsearch');
      searchCat(pj.doc, q);
      check(await waitFor(() => gates.length === 1), `Entrée (${how}) : recherche partie tout de suite attendue`);
      if (how === 'onglet') pj.doc.getElementById('tab-cartes').click(); else pj.doc.getElementById('cat-q').dispatch('blur');
      await settle();
      release();
      await settle(300);
      check(!atIn(pj.doc) && tabIn(pj.doc) === (how === 'onglet' ? 'tab-cartes' : 'tab-collections'), `Entrée en attente (${how}) : aucune catégorie ne doit s'ouvrir, ${atIn(pj.doc)} / ${tabIn(pj.doc)}`);
      if (how === 'onglet') { pj.doc.getElementById('tab-collections').click(); await settle(); }
    }
    // D. Relecture de GET /api/me (retour sur l'onglet) partie avant « Retirer » et revenue après : le retrait reste.
    meHold = true;
    pj.visible();
    check(await waitFor(() => meGates.length === 1), 'GET /api/me retenue attendue');
    meHold = false;
    ariaBtn(pj.doc, 'Retirer « Jaune » des propositions').click();
    await settle();
    btnIn(pj.doc.querySelectorAll('.modal')[0], 'Retirer des propositions').click();
    check(await waitFor(() => !proposedIn(pj.doc).includes('Jaune') && !!btnIn(pj.doc, 'Rétablir la proposition retirée')), 'proposition « Jaune » non retirée');
    meGates.shift()();
    await settle(200);
    check(!!btnIn(pj.doc, 'Rétablir la proposition retirée') && !proposedIn(pj.doc).includes('Jaune'), 'GET /api/me revenue après « Retirer » : le retrait a été défait');
    check(JSON.stringify((await rawApi('GET', '/api/me', keyJ)).body.prefs.hidden_proposals) === '["wp:Jaune"]', 'retrait de « Jaune » non enregistré');
    // F. Anciennes collections du catalogue : « vaches » n'avait pas d'ordre (de A à Z, sans numéros), « planetes » oui.
    const it = (l) => l.map((title) => ({ title, description: null, image: null, status: 'ok' }));
    await rawApi('POST', '/api/targets/save', keyJ, { name: 'Vaches du catalogue', source: 'catalog:vaches', items: it(['Salers', 'Aubrac', 'Charolaise']) });
    await rawApi('POST', '/api/targets/save', keyJ, { name: 'Planètes du catalogue', source: 'catalog:planetes', items: it(['Mercure (planète)', 'Vénus (planète)', 'Terre']) });
    const pf = await openJade(false);
    for (const [name, ordered] of [['Vaches du catalogue', false], ['Planètes du catalogue', true]]) {
      pf.doc.querySelectorAll('.row').find((n) => (n.getAttribute('aria-label') || '').startsWith(name + ' :')).click();
      await settle(80);
      const sortBtn = pf.doc.querySelectorAll('button').find((b) => ['Ordre', 'A → Z'].includes(text(b).trim()));
      check(sortBtn && text(sortBtn).trim() === (ordered ? 'Ordre' : 'A → Z') && !!pf.doc.querySelectorAll('.slot__no').length === ordered,
        `${name} : ${ordered ? 'dans l\'ordre, numérotée' : 'de A à Z, sans numéros'} attendue, ${sortBtn ? text(sortBtn) : '?'} / ${pf.doc.querySelectorAll('.slot__no').length} numéros`);
      btnIn(pf.doc, '← Toutes les collections').click();
      await settle();
    }
    // G. Relecture périodique (60 s) pendant la résolution des qids de l'album ouvert : elle ne la coupe pas. Léo a la
    // carte « Néon (gaz) », même élément que « Néon » de la catégorie « Gaz noble » ; sa collection « Inconnus » a des
    // titres dont le qid n'est pas encore connu (résolus après chaque chargement des cartes).
    {
      const keyL = await makeOtherAccount('Léo');
      await sendImport(keyL, [mk1('l0', 'Néon (gaz)')]);
      await rawApi('POST', '/api/targets/save', keyL, { name: 'Inconnus', items: it(['Inconnu 1', 'Inconnu 2']) });
      ls.set('classeur-key', keyL);
      ls.set('classeur-known', JSON.stringify([{ key: keyL, name: 'Léo' }]));
      holdIf = (u) => u.includes('ppprop=wikibase_item'); // toutes les résolutions de qids attendent
      const pl = openPage({ idb: 'absent', wikiHold, hold });
      check(await waitFor(() => pl.count() === 1), 'classeur de Léo non ouvert');
      pl.doc.getElementById('tab-collections').click();
      await settle();
      searchCat(pl.doc, 'gaz noble');
      check(await waitFor(() => atIn(pl.doc).includes('Gaz noble') && atIn(pl.doc).includes('0 sur 3')), 'album « Gaz noble » : ' + atIn(pl.doc));
      await rawApi('POST', '/api/tags/set', keyL, { card_id: 'l0', tags: ['Gaz'] }); // cards_rev avance : la relecture recharge
      await pl.live();
      await settle(100);
      release();
      check(await waitFor(() => atIn(pl.doc).includes('1 sur 3'), 5000), 'qids de l\'album coupés par la relecture périodique : « Néon » doit compter pour « Néon (gaz) », ' + atIn(pl.doc));
    }
  }

  // 30. Chat : un salon pour tous les classeurs. Maëlle (une page du classeur) et Noa (un autre compte, par l'API) :
  // badge des non-lus (GET /api/me au retour sur la page), ouverture (auteur, heure, lien cliquable), Entrée envoie et
  // Maj+Entrée va à la ligne, « (toi) », lien personnel refusé avant l'envoi, suppression de son message seulement
  // (confirmation), propagée aux autres pages par la relecture, 429 lisible, messages plus anciens, relecture minutée.
  {
    const keyM = await makeOtherAccount('Maëlle');
    const keyN = await makeOtherAccount('Noa');
    const meM = (await rawApi('GET', '/api/me', keyM)).body.user.id;
    ls.set('classeur-key', keyM);
    ls.set('classeur-known', JSON.stringify([{ key: keyM, name: 'Maëlle' }]));
    const pc = openPage({ idb: 'absent' });
    const d = pc.doc;
    const hasIn = (t) => text(d.body).includes(t);
    const tab = (id) => d.getElementById('tab-' + id);
    const msgs = () => d.querySelectorAll('.chat-msg');
    const badgeOf = (doc) => { const t = doc.getElementById('tab-chat'); const b = t && t.querySelector('.tab-badge'); return b ? text(b) : ''; };
    const badge = () => badgeOf(d);
    const field = () => d.getElementById('chat-input');
    const chatCalls = (from) => apiLog.slice(from).filter((x) => /^(GET|POST|DELETE) \/api\/chat\b/.test(x));
    check(await waitFor(() => tab('chat') && hasIn('Le classeur de Maëlle')), 'classeur de Maëlle non ouvert');
    check(text(tab('chat')) === 'Chat' && badge() === '', 'onglet « Chat » absent, ou badge sans message : ' + text(tab('chat')));
    // Noa écrit pendant que Maëlle est ailleurs : au retour sur la page, GET /api/me annonce un message, la page le lit.
    const n1 = await rawApi('POST', '/api/chat', keyN, { text: 'Salut tout le monde ! Ma liste : https://fr.wikipedia.org/wiki/Mercure_(planète).' });
    check(n1.status === 201, 'envoi de Noa refusé : ' + JSON.stringify(n1.body));
    let from = apiLog.length;
    await pc.visible();
    check(await waitFor(() => badge() === '1 message non lu'), 'badge des non-lus absent : « ' + badge() + ' » / ' + apiLog.slice(from).join(', '));
    check(chatCalls(from).join() === 'GET /api/chat', 'une lecture du chat attendue pour le badge : ' + chatCalls(from).join(', '));
    // Rien de nouveau : la relecture de GET /api/me (toutes les 60 s) ne relit pas le chat.
    from = apiLog.length;
    await pc.live();
    await settle(60);
    check(apiLog.slice(from).includes('GET /api/me') && !chatCalls(from).length, 'chat relu sans nouveau message : ' + apiLog.slice(from).join(', '));
    // Ouverture : message de Noa (auteur, heure, lien cliquable), sans bouton Supprimer ; badge parti, dernier lu gardé.
    tab('chat').click();
    await settle();
    check(hasIn('Visible par tous les membres du classeur'), 'mention « Visible par tous les membres du classeur » absente');
    check(await waitFor(() => msgs().length === 1), 'message de Noa absent');
    const m0 = msgs()[0];
    check(text(m0.querySelector('.chat-msg__who')) === 'Noa' && !m0.classList.contains('mine') && !m0.querySelector('.chat-msg__me'), 'auteur du message de Noa : ' + text(m0));
    check(/^\d{2}:\d{2}$/.test(text(m0.querySelector('time'))), 'heure du message : ' + text(m0.querySelector('time')));
    const link = m0.querySelector('a');
    check(link && link.getAttribute('href') === 'https://fr.wikipedia.org/wiki/Mercure_(plan%C3%A8te)' && text(link) === 'https://fr.wikipedia.org/wiki/Mercure_(planète)'
      && /\bnoopener\b/.test(link.getAttribute('rel') || '') && link.getAttribute('target') === '_blank', 'lien du message : ' + (link && link.getAttribute('href')));
    check(text(m0.querySelector('.chat-msg__text')).endsWith('Mercure_(planète).') && !m0.querySelector('.chat-msg__del'), "point final hors du lien ; pas de suppression du message d'un autre");
    check(badge() === '', 'badge encore affiché, onglet ouvert');
    check(JSON.parse(ls.get('classeur-chat-lu') || '{}')[meM] === n1.body.message.id, 'dernier lu non gardé : ' + ls.get('classeur-chat-lu'));
    // Maj+Entrée : pas d'envoi (le navigateur va à la ligne) ; Entrée : envoi, « (toi) », retours à la ligne gardés, champ vidé.
    check(field() && field().getAttribute('maxlength') === '500', 'champ du message absent, ou sans limite de 500');
    type(field(), 'Bonjour Noa');
    from = apiLog.length;
    let ev = field().dispatch('keydown', { key: 'Enter', shiftKey: true });
    await settle();
    check(!ev.defaultPrevented && !chatCalls(from).some((x) => x.startsWith('POST')), 'Maj+Entrée ne doit rien envoyer');
    type(field(), 'Bonjour Noa\nça va ?');
    ev = field().dispatch('keydown', { key: 'Enter' });
    check(ev.defaultPrevented, 'Entrée doit envoyer, sans aller à la ligne');
    check(await waitFor(() => msgs().length === 2), "mon message n'apparaît pas");
    const mine = msgs()[1];
    check(mine.classList.contains('mine') && text(mine.querySelector('.chat-msg__who')) === 'Maëlle' && text(mine.querySelector('.chat-msg__me')) === '(toi)', 'mention « (toi) » absente : ' + text(mine));
    check(text(mine.querySelector('.chat-msg__text')) === 'Bonjour Noa\nça va ?' && field().value === '', 'retour à la ligne perdu, ou champ non vidé');
    check(chatCalls(from).filter((x) => x === 'POST /api/chat').length === 1, 'un seul envoi attendu : ' + chatCalls(from).join(', '));
    // Champ vide : Entrée n'envoie rien ; lien personnel : refusé avant tout envoi.
    from = apiLog.length;
    field().dispatch('keydown', { key: 'Enter' });
    type(field(), 'mon lien ' + ORIGIN + '/#cle=' + keyM);
    field().dispatch('keydown', { key: 'Enter' });
    await settle();
    check(hasIn('lien personnel de classeur') && !chatCalls(from).some((x) => x.startsWith('POST')), 'champ vide ou lien personnel : rien ne doit partir');
    type(field(), '');
    // Chez Noa : mon message, sans « (toi) » ; elle ne peut pas le supprimer (403). Elle supprime le sien : il disparaît de
    // la page de Maëlle à la relecture suivante (retour sur la page, chat ouvert).
    const seenByN = (await rawApi('GET', '/api/chat', keyN)).body.messages.find((m) => m.text.startsWith('Bonjour Noa'));
    check(seenByN && seenByN.author === 'Maëlle' && seenByN.mine === false, 'mon message vu par Noa : ' + JSON.stringify(seenByN));
    check((await rawApi('DELETE', '/api/chat/' + seenByN.id, keyN)).status === 403, 'Noa ne doit pas pouvoir supprimer mon message');
    check((await rawApi('DELETE', '/api/chat/' + n1.body.message.id, keyN)).status === 200, 'suppression du message de Noa refusée');
    await pc.visible();
    check(await waitFor(() => msgs().length === 1 && !hasIn('Salut tout le monde')), 'message supprimé par Noa encore affiché');
    // Suppression du mien, avec confirmation.
    msgs()[0].querySelector('.chat-msg__del').click();
    await settle();
    const modal = d.querySelectorAll('.modal')[0];
    check(modal && text(modal).includes('disparaîtra du chat pour tout le monde'), 'confirmation de suppression absente');
    modal.querySelectorAll('button').find((b) => text(b).trim() === 'Supprimer').click();
    check(await waitFor(() => !msgs().length && hasIn("Aucun message pour l'instant")), 'mon message supprimé reste affiché');
    check(!(await rawApi('GET', '/api/chat', keyN)).body.messages.length, 'suppression non faite côté serveur');
    // Ailleurs : mon propre message (autre appareil) ne compte pas ; un message de Noa → badge ; onglet ouvert → lu.
    tab('cartes').click();
    await settle();
    await rawApi('POST', '/api/chat', keyM, { text: 'Depuis mon téléphone' });
    from = apiLog.length;
    await pc.visible();
    check(await waitFor(() => chatCalls(from).length > 0), 'nouveau message annoncé par GET /api/me : le chat doit être relu');
    await settle(60);
    check(badge() === '', 'mon propre message ne doit pas compter comme non lu : ' + badge());
    await rawApi('POST', '/api/chat', keyN, { text: 'Tu es là ?' });
    await pc.live();
    check(await waitFor(() => badge() === '1 message non lu'), 'badge après un nouveau message de Noa : « ' + badge() + ' »');
    tab('chat').click();
    check(await waitFor(() => badge() === '' && hasIn('Tu es là ?') && hasIn('Depuis mon téléphone')), "messages à l'ouverture, ou badge resté");
    if (!SERVER) {
      // 429 : message lisible, brouillon gardé.
      api.chatLimit = true;
      type(field(), 'Encore un');
      field().dispatch('keydown', { key: 'Enter' });
      check(await waitFor(() => hasIn('Doucement : 10 messages par minute au plus')), 'refus 429 non affiché');
      check(field().value === 'Encore un', 'brouillon perdu après un refus');
      api.chatLimit = false;
      type(field(), '');
      // 130 messages de plus : une page rouverte affiche « 99+ » non lus, lit les 100 plus récents, puis les autres à la
      // demande ; chat ouvert, la relecture minutée (horloge accélérée) apporte un nouveau message sans autre geste.
      for (let i = 0; i < 130; i++) await rawApi('POST', '/api/chat', keyN, { text: 'Message ' + i });
      tab('collections').click(); // la première page quitte le chat : sa minuterie s'arrête
      await settle();
      const p2 = openPage({ idb: 'absent', speed: 50 });
      const m2 = () => p2.doc.querySelectorAll('.chat-msg');
      check(await waitFor(() => badgeOf(p2.doc) === '99+ messages non lus'), 'badge « 99+ » attendu : « ' + badgeOf(p2.doc) + ' »');
      p2.doc.getElementById('tab-chat').click();
      check(await waitFor(() => m2().length === 100), '100 messages attendus, ' + m2().length);
      const olderBtn = () => p2.doc.querySelectorAll('button').find((b) => text(b).trim() === 'Charger les messages plus anciens');
      check(olderBtn(), '« Charger les messages plus anciens » absent');
      olderBtn().click();
      check(await waitFor(() => m2().length === 132), 'messages plus anciens non chargés : ' + m2().length);
      check(text(m2()[0].querySelector('.chat-msg__text')) === 'Depuis mon téléphone' && !olderBtn(), 'ordre des messages, ou bouton des plus anciens resté');
      from = apiLog.length;
      await rawApi('POST', '/api/chat', keyN, { text: 'En direct' });
      check(await waitFor(() => text(p2.doc.body).includes('En direct')), 'chat ouvert : la relecture minutée doit apporter le nouveau message');
      check(chatCalls(from).some((x) => /^GET \/api\/chat\?after=\d+$/.test(x)), 'relecture par ?after attendue : ' + chatCalls(from).join(', '));
      p2.doc.getElementById('tab-collections').click();
      await settle(100);
      from = apiLog.length;
      await sleep(800); // ≈ 40 s à l'horloge de la page : plus aucune relecture du chat
      check(!chatCalls(from).length, 'chat relu alors que son onglet est fermé : ' + chatCalls(from).join(', '));
    } else {
      tab('collections').click();
      await settle();
    }
    console.log(`chat : ${apiLog.filter((x) => /^(GET|POST|DELETE) \/api\/chat\b/.test(x)).length} appels de /api/chat par les pages, dont ${apiLog.filter((x) => /^GET \/api\/chat\?after=/.test(x)).length} relectures ?after`);
  }

  // Marché : valeur dans le bandeau, onglet « Marché » (graphique, bonnes affaires, cartes qui bougent, mes enchères et
  // ventes, règles), cotes dans les fiches (carte possédée : par exemplaire, « ~ » sous 3 ventes ; carte qui manque : par
  // rareté). Données posées dans l'API simulée (le favori les enverrait).
  if (!SERVER) {
    const keyM = await makeOtherAccount('Mona');
    const um = api.users.find((u) => u.key === keyM);
    const mc = (id, title, rarity, count, extra = {}) => ({ id, title, rarity, atk: 1, def: 1, quality: 1, pageviews: 10, category: 'essai', image: null, url: null, count, shiny: false, starred: false, obtained_at: '2026-10-01T00:00:00Z', ...extra });
    await sendImport(keyM, [mc('m1', 'Marché 1', 'R', 3, { shiny: true, variants: { R: 2, 'R*': 1 } }), mc('m2', 'Marché 2', 'C', 1), mc('m3', 'Marché 3', 'C', 1, { variants: { C: 1 } })]);
    const it = (title) => ({ title, description: null, image: null, status: 'ok' });
    await rawApi('POST', '/api/targets/save', keyM, { name: 'Envies', items: [it('Voulue A'), it('Marché 1')] });
    const soon = new Date(Date.now() + 3600_000).toISOString();
    const q = (p, n, w = null) => ({ p, n, w, l: p - 1, d: '2026-10-15T10:00:00.000Z' });
    um.market = {
      value: { value: 1234, priced: 2, cards: 3, approx: 1 },
      history: [{ date: '2026-10-14', value: 1000, priced: 2, cards: 3 }, { date: '2026-10-15', value: 1100, priced: 2, cards: 3 }, { date: '2026-10-16', value: 1234, priced: 2, cards: 3 }],
      live_at: new Date().toISOString(),
      live: {
        deals: [{ a: 'a1', id: 'w1', t: 'Voulue A', r: 'SR', s: false, img: null, end: soon, cote: 100, n: 5, ask: 50, bid: false, lead: false }],
        bids: [{ a: 'b1', id: 'm3', t: 'Marché 3', r: 'C', s: false, img: null, end: soon, cote: 10, n: 4, mine: 8, cur: 9, lead: false, st: 'run' },
          { a: 'b2', id: 'x9', t: 'Ailleurs', r: 'L', s: true, img: null, end: '2026-10-15T08:00:00.000Z', cote: null, n: null, mine: 300, cur: 300, lead: false, st: 'won' }],
        sales: [{ a: 's1', id: 'm2', t: 'Marché 2', r: 'C', s: false, img: null, end: '2026-10-15T09:00:00.000Z', cote: 20, n: 5, base: 5, cur: 12, bid: true, st: 'sold' }],
      },
      prices: [
        { id: 'm1', v: { R: q(400, 10, 300), 'R*': q(900, 2) }, at: '2026-10-16T08:00:00.000Z' },
        { id: 'm2', v: { C: q(20, 5, 25) }, at: '2026-10-16T08:00:00.000Z' },
        { id: 'w1', v: { SR: q(100, 5), 'SR*': q(260, 1) }, at: '2026-10-16T08:00:00.000Z', t: 'Voulue A' },
      ],
    };
    ls.set('classeur-key', keyM);
    ls.set('classeur-known', JSON.stringify([{ key: keyM, name: 'Mona' }]));
    const pm = openPage({ idb: 'absent' });
    const d = pm.doc;
    const body = () => text(d.body);
    const btn = (t) => d.querySelectorAll('button').find((b) => text(b).trim() === t) || null;
    check(await waitFor(() => pm.count() === 3), 'classeur de Mona non ouvert');
    check(await waitFor(() => body().includes('1 234 W') && body().includes('valeur (2 cotées)')), 'valeur absente du bandeau : ' + body().slice(0, 400));
    d.getElementById('tab-marche').click();
    await settle(80);
    const panel = () => text(d.getElementById('panel-marche'));
    check(/Valeur de ton classeur/.test(panel()) && panel().includes('1 234 W · 2 cartes cotées sur 3') && panel().includes('Dont 1 carte comptée dans sa plus haute rareté'), 'valeur de l\'onglet Marché : ' + panel().slice(0, 300));
    // Graphique : une ligne de 3 points, lisible sans couleur (valeur et date au-dessus, tableau des valeurs).
    const svg = d.querySelectorAll('svg').find((n) => n.classList.contains('chart__svg'));
    check(svg && svg.querySelectorAll('polyline').length === 1 && svg.querySelectorAll('circle').length === 3 && /Valeur du classeur, un point par jour/.test(svg.getAttribute('aria-label') || ''), 'graphique de la valeur absent');
    check(d.querySelectorAll('.chart__table')[0].querySelectorAll('tr').length === 4 && panel().includes('Voir les valeurs'), 'tableau des valeurs absent');
    // Bonnes affaires : carte qui manque, prix demandé, écart à la cote, « finit bientôt », collection qu'elle complète.
    check(panel().includes('Voulue A') && panel().includes('50 W (prix de départ, sans enchère) · cote 100 W (−50 %)') && panel().includes('finit bientôt') && panel().includes('pour « Envies »'), 'bonnes affaires : ' + panel());
    // Cartes qui bougent : m1 (2 rares de 300 à 400 : +200 ; la brillante n'a que 2 ventes), m2 (de 25 à 20 : −5).
    const movers = d.querySelectorAll('.movers').map(text);
    check(movers.length === 2 && movers[0].includes('Marché 1') && movers[0].includes('+200 W') && movers[0].includes('+33 %') && movers[1].includes('Marché 2') && movers[1].includes('−5 W'), 'cartes qui bougent : ' + movers.join(' | '));
    // Mes enchères et mes ventes.
    check(panel().includes('ta mise 8 W · enchère actuelle 9 W · cote 10 W (−10 %)') && panel().includes('dépassée') && panel().includes('gagnée') && panel().includes('pas de cote'), 'mes enchères : ' + panel());
    check(panel().includes('départ 5 W · vendue 12 W · cote 20 W (−40 %)'), 'mes ventes : ' + panel());
    check(panel().includes('lit directement la base du jeu avec ta session, à ton clic seulement') && panel().includes('à utiliser avec modération'), 'avertissement des règles absent');
    // Fiche d'une carte possédée (depuis « Cartes qui bougent ») : cote de chaque exemplaire.
    d.querySelectorAll('.movers')[0].querySelectorAll('button')[0].click();
    await settle(60);
    const fiche = () => text(d.querySelectorAll('.fiche')[0]);
    check(/Cote/.test(fiche()) && fiche().includes('2 × Rare400 W10 ventes · dernière 399 W le 15 octobre · 7 jours : +33 %') && fiche().includes('Rare, brillante~ 900 W2 ventes'), 'cote de la fiche : ' + fiche());
    check(fiche().includes('Tes exemplaires cotés : 800 W'), 'total des exemplaires : ' + fiche());
    d.querySelectorAll('.fiche')[0].querySelectorAll('button.close')[0].click();
    await settle(40);
    // Carte sans détail de ses exemplaires : approchée, dite.
    d.getElementById('tab-cartes').click();
    await settle(60);
    d.querySelectorAll('.cell').find((n) => text(n).includes('Marché 2')).querySelector('.card').dispatch('click');
    await settle(60);
    check(fiche().includes('Commune20 W') && fiche().includes('Rareté de tes exemplaires pas encore connue'), 'fiche approchée : ' + fiche());
    d.querySelectorAll('.fiche')[0].querySelectorAll('button.close')[0].click();
    await settle(40);
    // Fiche d'une carte qui manque (depuis une bonne affaire) : ses cotes par rareté.
    d.getElementById('tab-marche').click();
    await settle(40);
    d.querySelectorAll('.lot__title').flatMap((n) => n.querySelectorAll('button')).find((b) => text(b) === 'Voulue A').click();
    await settle(60);
    check(fiche().includes('Cote dans le jeu') && fiche().includes('Super rare100 W5 ventes') && fiche().includes('Super rare, brillante~ 260 W1 vente'), 'cote d\'une carte qui manque : ' + fiche());
    d.querySelectorAll('.fiche')[0].querySelectorAll('button.close')[0].click();
    await settle(40);
    // Classeur sans cote : l'onglet dit comment en avoir, sans valeur dans le bandeau.
    um.market = null;
    btn('Relire').click();
    await settle(80);
    check(panel().includes('Pas encore de cote : sur wiki-masters.com, clique « Mettre à jour les cotes »') && panel().includes('Pas de lecture récente du marché') && !body().includes('valeur ('), 'classeur sans cote : ' + panel().slice(0, 400));
  }

  // Icônes : toutes celles utilisées existent dans le sprite.
  const missing = [...new Set(usedIcons())].filter((i) => !ctx.__symbols.includes(i));
  check(!missing.length, 'icônes absentes du sprite : ' + missing.join(', '));
  check(!catalogFetches.length, 'le catalogue a été demandé : ' + catalogFetches.join(', '));
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
      if (keys !== 'atk,category,count,def,id,image,obtained_at,pageviews,quality,rarity,shiny,starred,title,url,variants') fail('favori : champs de CarteImport ' + keys);
      // Exemplaires par rareté et brillance (marché) : leur somme fait count.
      if (Object.values(c.variants).reduce((x, y) => x + y, 0) !== c.count) fail('favori : variants ne compte pas tous les exemplaires de ' + c.id);
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
