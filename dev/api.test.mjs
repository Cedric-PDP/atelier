// Tests de l'API : appelle onRequest directement, D1 simulée en mémoire, jeu simulé (fetch remplacé).
//   node dev/api.test.mjs      → doit finir par « API OK »

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createD1 } from './d1.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const lib = (f) => pathToFileURL(path.join(root, 'site', 'functions', f)).href;
const { onRequest } = await import(lib('api/[[path]].js'));
const { SCHEMA } = await import(lib('_lib/db.js'));
const { decryptCookie } = await import(lib('_lib/session.js'));
const { sha256Hex } = await import(lib('_lib/util.js'));

const realFetch = globalThis.fetch;
const SECRET = 'secret-de-test';
const GAME_USER = 'joueur-du-jeu-0b5e7c';
const owned = JSON.parse(await readFile(path.join(root, 'data', 'owned.json'), 'utf8')).cards;

function makeEnv(extra = {}) {
  return { DB: createD1(':memory:'), COOKIE_SECRET: SECRET, SIGNUP_CODE: 'invitation', ...extra };
}
let env = makeEnv();

async function call(method, route, { body, key, headers = {}, raw, e = env } = {}) {
  const h = new Headers(headers);
  if (key) h.set('x-classeur-key', key);
  let payload = raw;
  if (payload === undefined && body !== undefined) {
    payload = JSON.stringify(body);
    h.set('content-type', 'application/json');
  }
  const request = new Request(`http://localhost:8788/api/${route}`, { method, headers: h, body: payload });
  const res = await onRequest({ request, env: e, params: {}, waitUntil() {} });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
}

const rows = (sql, ...p) => env.DB.sqlite.prepare(sql).all(...p).map((r) => ({ ...r }));

// Écritures sur la table cards, comptées par des déclencheurs (pour vérifier qu'un import n'écrit que les différences).
function countCardWrites(on) {
  const db = env.DB.sqlite;
  if (!on) {
    db.exec('DROP TRIGGER IF EXISTS w_ins; DROP TRIGGER IF EXISTS w_upd; DROP TRIGGER IF EXISTS w_del; DROP TABLE IF EXISTS _w');
    return null;
  }
  db.exec(`CREATE TABLE IF NOT EXISTS _w (n INTEGER);
    CREATE TRIGGER IF NOT EXISTS w_ins AFTER INSERT ON cards BEGIN INSERT INTO _w VALUES (1); END;
    CREATE TRIGGER IF NOT EXISTS w_upd AFTER UPDATE ON cards BEGIN INSERT INTO _w VALUES (1); END;
    CREATE TRIGGER IF NOT EXISTS w_del AFTER DELETE ON cards BEGIN INSERT INTO _w VALUES (1); END;`);
  return () => db.prepare('SELECT COUNT(*) AS n FROM _w').get().n;
}

// Entrée brute au format du jeu, fabriquée depuis une carte de data/owned.json.
function rawEntry(card, extra = {}) {
  return {
    id: `entree-${card.id}`,
    card: {
      id: card.id,
      atk: card.atk,
      def: card.def,
      lang: 'fr',
      rarity: card.r,
      q_score: 40 + (parseInt(card.id.slice(0, 4), 16) % 200) / 4, // stable d'un import à l'autre
      category: card.c,
      image_url: card.img,
      pageviews: card.pv,
      created_at: '2026-01-01T00:00:00.000Z',
      hide_image: false,
      wikipedia_url: `https://fr.wikipedia.org/wiki/${encodeURIComponent(card.t.replace(/ /g, '_'))}`,
      wikipedia_title: card.t,
    },
    tags: [{ id: 't1', name: 'TagDuJeu' }],
    count: card.n,
    card_id: card.id,
    starred: card.f,
    user_id: GAME_USER,
    is_shiny: card.s,
    obtained_at: `${card.at.replace(' ', 'T')}:00.000Z`,
    ...extra,
  };
}
const entriesFor = (cards) => cards.map((c) => rawEntry(c));
const tiny = (i) => ({ id: `e${i}`, card_id: `c${i}`, count: 1, card: { id: `c${i}`, wikipedia_title: `Carte ${i}`, rarity: 'C' } });

// CarteImport (ce qu'envoie le favori, déjà regroupée), depuis une carte de data/owned.json.
const carte = (c, id = c.id) => ({
  id,
  title: c.t,
  rarity: c.r,
  atk: c.atk,
  def: c.def,
  quality: 61.25,
  pageviews: c.pv,
  category: c.c,
  image: c.img,
  url: `https://fr.wikipedia.org/wiki/${encodeURIComponent(c.t.replace(/ /g, '_'))}`,
  count: c.n,
  shiny: c.s,
  starred: c.f,
  obtained_at: `${c.at.replace(' ', 'T')}:00.000Z`,
});
const synth = (n, from = 0) => Array.from({ length: n }, (_, k) => carte(owned[(from + k) % owned.length], `carte-${String(from + k).padStart(5, '0')}`));

// Envoi par morceaux de 500 (comme le favori) ; rend la réponse du dernier morceau.
let uploads = 0;
async function upload(key, cards, { e = env, stats, size = 500 } = {}) {
  const uploadId = `envoi-${++uploads}`;
  const parts = Math.max(1, Math.ceil(cards.length / size));
  let r;
  for (let p = 0; p < parts; p++) {
    const last = p === parts - 1;
    r = await call('POST', 'import', {
      key,
      e,
      body: { upload_id: uploadId, part: p, last, cards: cards.slice(p * size, (p + 1) * size), stats: last ? stats : undefined, source: 'favori' },
    });
    if (!last) assert.deepEqual(r.json, { ok: true, received: (p + 1) * size, skipped: 0 }, JSON.stringify(r.json));
  }
  return r;
}

// CarteImport minimales (~80 octets) : pour les très grandes collections (l'attente d'un import fait 8 Mo au plus).
const mini = (n, from = 0) => Array.from({ length: n }, (_, k) => ({
  id: `mini-${String(from + k).padStart(5, '0')}`, title: `Carte ${from + k}`, rarity: 'C', count: 1,
}));

// Mesure du coût d'un appel. process.cpuUsage() n'avance que par pas de 15,6 ms sous Windows, et le shim
// node:sqlite tourne dans le même fil que le gestionnaire. Donc :
// - SQLite : CPU compté par le shim autour de chaque requête (sqlCpuMs), moyenné sur plusieurs appels réels ;
// - JavaScript du gestionnaire : l'appel réel est enregistré (résultats de chaque requête D1, dans l'ordre), puis
//   rejoué n fois contre une fausse base qui rend ces résultats sans rien calculer ; CPU total / n.
//   Le rejeu compte aussi Request/Response d'undici (natifs dans Workers) et, pour /api/refresh, le jeu simulé.
function recorder(db) {
  const log = [];
  const wrap = (st) => ({
    _st: st,
    bind: (...a) => wrap(st.bind(...a)),
    all: async () => { const r = await st.all(); log.push(r); return r; },
    run: async () => { const r = await st.run(); log.push(r); return r; },
    first: async (c) => { const r = await st.first(c); log.push(r); return r; },
    raw: async () => { const r = await st.raw(); log.push(r); return r; },
  });
  return {
    log,
    db: {
      prepare: (sql) => wrap(db.prepare(sql)),
      batch: async (sts) => { const r = await db.batch(sts.map((s) => s._st)); log.push(...r); return r; },
    },
  };
}

function replayDb(log) {
  let i = 0;
  const next = async () => log[i++];
  const st = { bind: () => st, all: next, run: next, first: next, raw: next };
  return { prepare: () => st, batch: async (sts) => sts.map(() => log[i++]) };
}

async function profile(method, route, { body, key, e = env, n = 20 } = {}) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const make = () => {
    const h = new Headers({ 'content-type': 'application/json' });
    if (key) h.set('x-classeur-key', key);
    return new Request(`http://localhost:8788/api/${route}`, { method, headers: h, body: payload });
  };
  const rec = recorder(e.DB);
  const sql0 = e.DB.sqlCpuMs;
  const res = await onRequest({ request: make(), env: { ...e, DB: rec.db }, params: {}, waitUntil() {} });
  const sql = e.DB.sqlCpuMs - sql0;
  const text = await res.text();
  const requests = Array.from({ length: n }, make);
  const envs = requests.map(() => ({ ...e, DB: replayDb(rec.log) }));
  const cpu0 = process.cpuUsage();
  for (let k = 0; k < n; k++) await onRequest({ request: requests[k], env: envs[k], params: {}, waitUntil() {} });
  const cpu = process.cpuUsage(cpu0);
  return { status: res.status, json: JSON.parse(text), text, size: text.length, js: (cpu.user + cpu.system) / 1000 / n, sql };
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const ms = (x) => `${x.toFixed(1)} ms`;
const report = (label, runs) => {
  const m = (k) => mean(runs.map((r) => r[k]));
  console.log(`    ${label} : JS ${ms(m('js'))} | SQLite ${ms(m('sql'))} (${runs.length} appels réels, ${runs.length * 20} rejeux)`);
};

const results = [];
let cleanups = [];
const after = (fn) => cleanups.push(fn);
async function test(name, fn) {
  try {
    await fn();
  } finally {
    for (const f of cleanups) f();
    cleanups = [];
  }
  results.push(name);
  console.log(`ok  ${name}`);
}

async function signup(name, e = env) {
  const r = await call('POST', 'account', { body: { code: 'invitation', name }, e });
  assert.equal(r.status, 201);
  return r.json;
}

// --- Schéma ---------------------------------------------------------------------------------------------------

await test('schema.sql = schéma appliqué par le code', async () => {
  const sql = await readFile(path.join(root, 'site', 'schema.sql'), 'utf8');
  const norm = (s) => s.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
  const fromFile = sql.replace(/--.*$/gm, '').split(';').map(norm).filter(Boolean);
  assert.deepEqual(fromFile, SCHEMA.map(norm));
});

// --- Configuration ------------------------------------------------------------------------------------------

await test('health et 503 sans base', async () => {
  const noDb = { COOKIE_SECRET: SECRET, SIGNUP_CODE: 'invitation' };
  let r = await call('GET', 'health', { e: noDb });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: false, db: false, cookie_secret: true, signup_open: true });
  assert.ok(!JSON.stringify(r.json).includes(SECRET));
  for (const [m, p] of [['GET', 'me'], ['POST', 'account'], ['POST', 'import'], ['GET', 'nimporte']]) {
    r = await call(m, p, { e: noDb, body: m === 'POST' ? {} : undefined });
    assert.equal(r.status, 503, p);
    assert.equal(r.json.error, "Le classeur n'est pas encore configuré : la base D1 n'est pas liée (variable DB).");
  }
  r = await call('GET', 'health');
  assert.deepEqual(r.json, { ok: true, db: true, cookie_secret: true, signup_open: true });
  r = await call('GET', 'health', { e: { DB: env.DB, SIGNUP_CODE: '  ' } });
  assert.deepEqual(r.json, { ok: true, db: true, cookie_secret: false, signup_open: false });
  assert.equal(r.headers.get('cache-control'), 'no-store');
  // Les noms hérités d'Object ne sont ni des chemins ni des méthodes.
  for (const p of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal((await call('GET', p)).status, 404, p);
  }
  assert.equal((await call('constructor', 'me')).status, 405);
});

await test('erreurs de D1 (base pleine, quota, ligne trop grosse) → 503 lisible', async () => {
  const quiet = console.error;
  console.error = () => {}; // le serveur journalise ces erreurs : pas dans la sortie des tests
  after(() => { console.error = quiet; });
  for (const message of [
    'D1_ERROR: database or disk is full: SQLITE_FULL',
    'D1_ERROR: string or blob too big: SQLITE_TOOBIG',
    'D1_ERROR: Exceeded maximum DB size',
    'D1 DB storage operation exceeded timeout which caused object to be reset.'.replace('timeout', 'quota'),
  ]) {
    const broken = { prepare: (sql) => env.DB.prepare(sql), batch: async () => { throw new Error(message); } };
    const r = await call('GET', 'health', { e: { ...env, DB: broken } });
    assert.equal(r.status, 200);
    const r2 = await call('POST', 'account', { body: { code: 'invitation' }, e: { ...env, DB: broken } });
    assert.equal(r2.status, 503, message);
    assert.match(r2.json.error, /^La base du classeur est pleine ou a atteint son quota du jour/);
  }
  const bug = { prepare: (sql) => env.DB.prepare(sql), batch: async () => { throw new TypeError('x is not a function'); } };
  const r = await call('POST', 'account', { body: { code: 'invitation' }, e: { ...env, DB: bug } });
  assert.equal(r.status, 500);
  assert.equal(r.json.error, 'Erreur interne du serveur.');
});

// --- Inscription et authentification ----------------------------------------------------------------------------

let alice;
await test('inscription : fermée, code faux, code bon', async () => {
  for (const e of [makeEnv({ SIGNUP_CODE: '' }), makeEnv({ SIGNUP_CODE: undefined })]) {
    const r = await call('POST', 'account', { body: { code: '' }, e });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'Les inscriptions sont fermées.');
  }
  let r = await call('POST', 'account', { body: { code: 'invitatio' } });
  assert.equal(r.status, 403);
  assert.match(r.json.error, /incorrect/);
  r = await call('POST', 'account', { body: {} });
  assert.equal(r.status, 403);
  r = await call('POST', 'account', { body: { code: 'invitation', name: '  Alice   L. ' } });
  assert.equal(r.status, 201);
  assert.match(r.json.key, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(Object.keys(r.json.user).sort(), ['id', 'name']);
  assert.equal(r.json.user.name, 'Alice L.');
  alice = r.json;
  const [u] = rows('SELECT * FROM users WHERE id = ?', alice.user.id);
  assert.equal(u.key_hash, await sha256Hex(alice.key));
  assert.ok(!JSON.stringify(rows('SELECT * FROM users')).includes(alice.key), 'clé en clair stockée');
  r = await call('POST', 'account', { body: { code: 'invitation', name: 'x'.repeat(61) } });
  assert.equal(r.status, 400);
  // Corps de 4 Ko au plus.
  r = await call('POST', 'account', { body: { code: 'invitation', name: 'x', pad: 'y'.repeat(4096) } });
  assert.equal(r.status, 413);
  assert.match(r.json.error, /4 Ko/);
  // Nombre de comptes plafonné par MAX_USERS (50 par défaut).
  const small = makeEnv({ MAX_USERS: '2' });
  for (let i = 0; i < 2; i++) assert.equal((await call('POST', 'account', { body: { code: 'invitation' }, e: small })).status, 201);
  r = await call('POST', 'account', { body: { code: 'invitation' }, e: small });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'Le classeur est complet : demande à la personne qui le gère.');
  assert.equal(small.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
  const dflt = makeEnv();
  dflt.DB.sqlite.exec('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, key_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, fetched_at TEXT, new_ids TEXT NOT NULL DEFAULT \'[]\', cookie_enc TEXT, cookie_updated_at TEXT, session_expired INTEGER NOT NULL DEFAULT 0)');
  dflt.DB.sqlite.exec("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 50) INSERT INTO users (id, key_hash, created_at) SELECT 'u' || i, 'h' || i, '2026' FROM n");
  r = await call('POST', 'account', { body: { code: 'invitation' }, e: dflt });
  assert.equal(r.status, 403, '50 comptes par défaut');
  // Base créée par une version précédente (sans import_key_hash) : la colonne est ajoutée au premier appel.
  assert.ok(dflt.DB.sqlite.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'import_key_hash'));
});

await test('authentification et /api/me', async () => {
  let r = await call('GET', 'me');
  assert.equal(r.status, 401);
  assert.ok(r.json.error);
  r = await call('GET', 'me', { key: 'mauvaise-cle' });
  assert.equal(r.status, 401);
  r = await call('GET', 'me', { key: alice.key });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json.user).sort(), ['created_at', 'id', 'name']);
  assert.equal(r.json.card_count, 0);
  assert.equal(r.json.fetched_at, null);
  assert.deepEqual(r.json.new_ids, []);
  assert.deepEqual(r.json.session, { has_cookie: false, expired: false, updated_at: null });
  assert.equal(r.json.has_import_key, false);
  r = await call('PATCH', 'me', { key: alice.key, body: { name: ' Alice ' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.name, 'Alice');
  r = await call('GET', 'nimporte', { key: alice.key });
  assert.equal(r.status, 404);
  r = await call('PUT', 'me', { key: alice.key });
  assert.equal(r.status, 405);
  r = await call('POST', 'import', { key: alice.key, raw: '{pas du json', headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /JSON/);
});

await test("clé d'import (favori) et renouvellement de la clé principale", async () => {
  const hana = await signup('Hana');
  let r = await call('POST', 'import-key', { key: hana.key });
  assert.equal(r.status, 200);
  const first = r.json.import_key;
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await call('GET', 'me', { key: hana.key })).json.has_import_key, true);
  assert.ok(!JSON.stringify(rows('SELECT * FROM users')).includes(first), "clé d'import en clair stockée");
  // La clé d'import ne sert qu'à POST /api/import.
  r = await call('POST', 'import', { key: first, body: { cards: synth(3) } });
  assert.deepEqual(r.json, { count: 3, new_ids: [], complete: null, skipped: 0 });
  for (const [m, p, body] of [['GET', 'me'], ['GET', 'cards'], ['POST', 'import-key', {}], ['POST', 'key/rotate', {}],
    ['POST', 'tags/set', { card_id: synth(1)[0].id, tags: ['x'] }], ['DELETE', 'me'], ['POST', 'session', { cookie: 'a=1' }]]) {
    assert.equal((await call(m, p, { key: first, body })).status, 401, `${m} ${p}`);
  }
  // Une nouvelle clé d'import remplace l'ancienne.
  const second = (await call('POST', 'import-key', { key: hana.key })).json.import_key;
  assert.notEqual(second, first);
  assert.equal((await call('POST', 'import', { key: first, body: { cards: synth(3) } })).status, 401);
  assert.equal((await call('POST', 'import', { key: second, body: { cards: synth(4) } })).status, 200);
  // Nouvelle clé principale : l'ancienne ne marche plus, la clé d'import reste.
  r = await call('POST', 'key/rotate', { key: hana.key });
  assert.match(r.json.key, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await call('GET', 'me', { key: hana.key })).status, 401);
  assert.equal((await call('GET', 'me', { key: r.json.key })).json.card_count, 4);
  assert.equal((await call('POST', 'import', { key: second, body: { cards: synth(2) } })).status, 200);
  assert.equal((await call('DELETE', 'me', { key: r.json.key })).status, 200);
});

// --- Import ---------------------------------------------------------------------------------------------------

const base = owned.slice(0, 150);
const dup = base[5];
const pic = base.find((c, i) => i < 120 && c.img);
const pic2 = base.find((c, i) => i < 120 && c.img && c !== pic);

await test('premier import : regroupement, hide_image, sans user_id, new_ids vide', async () => {
  const entries = entriesFor(base.slice(0, 120));
  entries.find((e) => e.card_id === pic.id).card.hide_image = true;
  entries.push(rawEntry(dup, { id: 'dup-a', count: 2, is_shiny: true, obtained_at: '2026-01-02T10:00:00.000Z' }));
  entries.push(rawEntry(dup, { id: 'dup-b', count: 1, starred: true, obtained_at: '2026-12-31T10:00:00.000Z' }));
  entries.push(rawEntry(base[6])); // même exemplaire vu deux fois : compte une fois
  entries.push({ foo: 1 }, null); // entrées inexploitables : ignorées
  const r = await call('POST', 'import', {
    key: alice.key,
    body: { collection: entries, stats: { total: 123, totalUnique: 120, rarityCounts: {} }, source: 'favori' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { count: 120, new_ids: [], complete: true, skipped: 2 });

  const cards = (await call('GET', 'cards', { key: alice.key })).json;
  assert.equal(cards.cards.length, 120);
  assert.ok(cards.fetched_at);
  const keys = ['id', 'title', 'rarity', 'atk', 'def', 'quality', 'pageviews', 'category', 'image', 'url', 'count',
    'shiny', 'starred', 'obtained_at', 'tags'];
  for (const c of cards.cards) assert.deepEqual(Object.keys(c), keys);
  const byId = new Map(cards.cards.map((c) => [c.id, c]));
  const d = byId.get(dup.id);
  assert.equal(d.count, dup.n + 3);
  assert.equal(d.shiny, true);
  assert.equal(d.starred, true);
  assert.equal(d.obtained_at, '2026-01-02T10:00:00.000Z');
  assert.equal(byId.get(base[6].id).count, base[6].n);
  assert.equal(byId.get(pic.id).image, null);
  assert.equal(byId.get(pic2.id).image, pic2.img);
  const one = byId.get(base[0].id);
  assert.equal(one.title, base[0].t);
  assert.equal(one.rarity, base[0].r);
  assert.equal(one.pageviews, base[0].pv);
  assert.equal(one.category, base[0].c);
  assert.ok(one.url.startsWith('https://fr.wikipedia.org/wiki/'));
  assert.deepEqual(one.tags, []);
  const everything = JSON.stringify(['users', 'cards', 'tags', 'targets', 'refresh_staging'].map((t) => rows(`SELECT * FROM ${t}`)));
  assert.ok(!everything.includes(GAME_USER), 'user_id du jeu stocké');
  assert.ok(!everything.includes('TagDuJeu'), 'étiquette du jeu stockée');
  const me = (await call('GET', 'me', { key: alice.key })).json;
  assert.equal(me.card_count, 120);
});

await test('second import : nouveautés, suppressions, seules les différences écrites', async () => {
  const next = base.slice(10, 130).map((c) => (c === base[20] ? { ...c, n: c.n + 1 } : c));
  const writes = countCardWrites(true);
  const r = await call('POST', 'import', { key: alice.key, body: { collection: entriesFor(next), source: 'favori' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.count, 120);
  assert.equal(r.json.complete, null);
  assert.deepEqual([...r.json.new_ids].sort(), base.slice(120, 130).map((c) => c.id).sort());
  // 10 ajoutées + 1 modifiée + 10 retirées
  assert.equal(writes(), 21);
  countCardWrites(false);
  const cards = (await call('GET', 'cards', { key: alice.key })).json;
  assert.deepEqual([...cards.new_ids].sort(), [...r.json.new_ids].sort());
  const ids = new Set(cards.cards.map((c) => c.id));
  assert.ok(!ids.has(base[0].id) && ids.has(base[125].id));
  assert.equal(cards.cards.find((c) => c.id === base[20].id).count, base[20].n + 1);
  const again = await call('POST', 'import', { key: alice.key, body: { collection: entriesFor(next), stats: { totalUnique: 999 } } });
  assert.deepEqual(again.json, { count: 120, new_ids: [], complete: false, skipped: 0 });
  const bad = await call('POST', 'import', { key: alice.key, body: { collection: 'non' } });
  assert.equal(bad.status, 400);
  const empty = await call('POST', 'import', { key: alice.key, body: { collection: [] } });
  assert.equal(empty.status, 400);
  assert.equal((await call('GET', 'me', { key: alice.key })).json.card_count, 120);
});

// --- Étiquettes -----------------------------------------------------------------------------------------------

await test('étiquettes : set, limites, bulk, rename (fusion)', async () => {
  const [a, b, c, d] = [base[20].id, base[21].id, base[22].id, base[23].id];
  let r = await call('POST', 'tags/set', { key: alice.key, body: { card_id: a, tags: ['Musique', '  à   échanger ', 'Musique', ' '] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.tags, ['Musique', 'à échanger']); // ordre binaire, comme SQLite
  r = await call('POST', 'tags/set', { key: alice.key, body: { card_id: a, tags: ['x'.repeat(41)] } });
  assert.equal(r.status, 400);
  r = await call('POST', 'tags/set', { key: alice.key, body: { card_id: a, tags: Array.from({ length: 31 }, (_, i) => `t${i}`) } });
  assert.equal(r.status, 400);
  r = await call('POST', 'tags/set', { key: alice.key, body: { card_id: 'inconnue', tags: ['x'] } });
  assert.equal(r.status, 404);
  r = await call('POST', 'tags/set', { key: alice.key, body: { card_id: a, tags: 'Musique' } });
  assert.equal(r.status, 400);
  r = await call('POST', 'tags/set', { key: alice.key, body: { card_id: a, tags: ['é'.repeat(40)] } });
  assert.equal(r.status, 200);
  r = await call('POST', 'tags/set', { key: alice.key, body: { card_id: a, tags: ['Musique', 'à échanger'] } });

  r = await call('POST', 'tags/bulk', {
    key: alice.key,
    body: { card_ids: [a, b, c, 'inconnue'], add: ['Lot', ' Musique'], remove: ['à échanger'] },
  });
  assert.deepEqual(r.json, { ok: true });
  const tagsOf = async () => new Map((await call('GET', 'cards', { key: alice.key })).json.cards.map((x) => [x.id, x.tags]));
  let t = await tagsOf();
  assert.deepEqual(t.get(a), ['Lot', 'Musique']);
  assert.deepEqual(t.get(b), ['Lot', 'Musique']);
  assert.deepEqual(t.get(c), ['Lot', 'Musique']);
  assert.equal(rows("SELECT * FROM tags WHERE card_id = 'inconnue'").length, 0);

  await call('POST', 'tags/set', { key: alice.key, body: { card_id: d, tags: Array.from({ length: 29 }, (_, i) => `t${i}`) } });
  r = await call('POST', 'tags/bulk', { key: alice.key, body: { card_ids: [c, d], add: ['n1', 'n2'] } });
  assert.equal(r.status, 400);
  t = await tagsOf();
  assert.deepEqual(t.get(c), ['Lot', 'Musique'], 'bulk refusé : rien ne doit changer');
  assert.equal(t.get(d).length, 29);

  r = await call('POST', 'tags/rename', { key: alice.key, body: { from: 'Lot', to: ' Musique ' } });
  assert.deepEqual(r.json, { ok: true });
  t = await tagsOf();
  assert.deepEqual(t.get(a), ['Musique']);
  r = await call('POST', 'tags/rename', { key: alice.key, body: { from: 'Musique', to: 'Chant' } });
  t = await tagsOf();
  assert.deepEqual([t.get(a), t.get(b), t.get(c)], [['Chant'], ['Chant'], ['Chant']]);
  r = await call('POST', 'tags/rename', { key: alice.key, body: { from: 'Chant', to: '' } });
  assert.equal(r.status, 400);
});

await test('étiquettes gardées quand la carte disparaît puis revient', async () => {
  const gone = base[10];
  await call('POST', 'tags/set', { key: alice.key, body: { card_id: gone.id, tags: ['Garder'] } });
  const without = base.slice(11, 130);
  let r = await call('POST', 'import', { key: alice.key, body: { collection: entriesFor(without) } });
  assert.equal(r.json.count, 119);
  assert.deepEqual(rows('SELECT tag FROM tags WHERE card_id = ?', gone.id), [{ tag: 'Garder' }]);
  let cards = (await call('GET', 'cards', { key: alice.key })).json.cards;
  assert.ok(!cards.some((c) => c.id === gone.id));
  r = await call('POST', 'import', { key: alice.key, body: { collection: entriesFor(base.slice(10, 130)) } });
  assert.deepEqual(r.json.new_ids, [gone.id]);
  cards = (await call('GET', 'cards', { key: alice.key })).json.cards;
  assert.deepEqual(cards.find((c) => c.id === gone.id).tags, ['Garder']);
});

// --- Collections à compléter ----------------------------------------------------------------------------------

await test('collections à compléter : save, mise à jour, limites, liste, suppression', async () => {
  const items = [
    { title: 'Rihanna', description: 'chanteuse barbadienne', image: 'https://upload.wikimedia.org/x.png', status: 'ok' },
    { title: 'Mercure', description: null, image: null, status: 'disambiguation' },
    { title: 'Article inexistant', status: 'missing', extra: 'ignoré' },
  ];
  let r = await call('POST', 'targets/save', { key: alice.key, body: { name: ' Chanteuses ', items, source: 'catalog:chanteuses' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const t = r.json.target;
  assert.match(t.id, /^[A-Za-z0-9_-]{6,}$/);
  assert.equal(t.name, 'Chanteuses');
  assert.equal(t.source, 'catalog:chanteuses');
  assert.deepEqual(t.items[2], { title: 'Article inexistant', description: null, image: null, status: 'missing' });
  await new Promise((res) => setTimeout(res, 5));
  r = await call('POST', 'targets/save', { key: alice.key, body: { id: t.id, name: 'Chanteuses 2', items: items.slice(0, 1) } });
  assert.equal(r.json.target.id, t.id);
  assert.equal(r.json.target.created_at, t.created_at);
  assert.notEqual(r.json.target.updated_at, t.updated_at);
  assert.equal(r.json.target.items.length, 1);
  assert.equal(r.json.target.source, null);

  for (const body of [
    { name: '', items: [] },
    { name: 'x'.repeat(81), items: [] },
    { name: 'ok', items: 'non' },
    { name: 'ok', items: Array.from({ length: 3001 }, (_, i) => ({ title: `A${i}`, status: 'ok' })) },
    { name: 'ok', items: [{ title: 'A', status: 'peut-être' }] },
    { name: 'ok', items: [{ status: 'ok' }] },
    { id: 'pas valide !', name: 'ok', items: [] },
  ]) {
    r = await call('POST', 'targets/save', { key: alice.key, body });
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
  }
  r = await call('POST', 'targets/save', { key: alice.key, body: { name: 'x'.repeat(80), items: Array.from({ length: 3000 }, (_, i) => ({ title: `Article ${i}`, status: 'ok' })) } });
  assert.equal(r.status, 200);
  for (let i = 2; i < 50; i++) {
    r = await call('POST', 'targets/save', { key: alice.key, body: { id: `c${i}`, name: `Collection ${i}`, items: [] } });
    assert.equal(r.status, 200);
  }
  r = await call('POST', 'targets/save', { key: alice.key, body: { name: 'La 51e', items: [] } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /50 collections/);
  r = await call('POST', 'targets/save', { key: alice.key, body: { id: 'c40', name: 'Mise à jour permise', items: [] } });
  assert.equal(r.status, 200);

  r = await call('GET', 'targets', { key: alice.key });
  assert.equal(r.json.targets.length, 50);
  assert.equal(r.json.targets[0].id, t.id);
  for (let i = 2; i < 50; i++) await call('POST', 'targets/delete', { key: alice.key, body: { id: `c${i}` } });
  r = await call('POST', 'targets/delete', { key: alice.key, body: { id: t.id } });
  assert.deepEqual(r.json, { ok: true });
  r = await call('GET', 'targets', { key: alice.key });
  assert.equal(r.json.targets.length, 1);
  assert.equal(r.json.targets[0].items.length, 3000);
});

await test('collections à compléter : 600 Ko par collection, 5 Mo par compte', async () => {
  const ivy = await signup('Ivy');
  // ~560 Ko d'éléments : 1 000 éléments avec une description de 500 caractères.
  const heavy = Array.from({ length: 1000 }, (_, i) => ({ title: `Article ${i}`, description: 'd'.repeat(500), status: 'ok' }));
  let r = await call('POST', 'targets/save', { key: ivy.key, body: { name: 'Trop', items: [...heavy, ...heavy.slice(0, 100)] } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /600 Ko/);
  // Les descriptions sont coupées à 500 caractères, sans séparer un emoji.
  r = await call('POST', 'targets/save', { key: ivy.key, body: { name: 'Coupe', items: [{ title: 'A', description: `${'e'.repeat(499)}😀z` }] } });
  assert.equal(r.json.target.items[0].description, 'e'.repeat(499));
  await call('POST', 'targets/delete', { key: ivy.key, body: { id: r.json.target.id } });
  for (let i = 0; i < 9; i++) {
    r = await call('POST', 'targets/save', { key: ivy.key, body: { id: `lourde${i}`, name: `Lourde ${i}`, items: heavy } });
    assert.equal(r.status, 200, `collection ${i}`);
  }
  r = await call('POST', 'targets/save', { key: ivy.key, body: { id: 'lourde9', name: 'Lourde 9', items: heavy } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /5 Mo/);
  // Remplacer une collection existante ne compte pas deux fois sa taille.
  r = await call('POST', 'targets/save', { key: ivy.key, body: { id: 'lourde3', name: 'Lourde 3 bis', items: heavy } });
  assert.equal(r.status, 200);
  await call('DELETE', 'me', { key: ivy.key });
});

// --- Session WikiMasters --------------------------------------------------------------------------------------

const storedCookie = async (user, e = env) => {
  const [u] = e.DB.sqlite.prepare('SELECT cookie_enc FROM users WHERE id = ?').all(user.user.id);
  return u.cookie_enc ? decryptCookie(e, user.user.id, u.cookie_enc) : null;
};

await test('session : cookie collé, chiffré, COOKIE_SECRET absent, suppression', async () => {
  let r = await call('POST', 'session', { key: alice.key, body: { cookie: 'Cookie: sid=abc123; theme=sombre\n' } });
  assert.deepEqual(r.json, { ok: true });
  const [u] = rows('SELECT cookie_enc, cookie_updated_at FROM users WHERE id = ?', alice.user.id);
  assert.ok(!u.cookie_enc.includes('abc123'));
  assert.ok(Buffer.from(u.cookie_enc, 'base64').length >= 12 + 16 + 'sid=abc123; theme=sombre'.length);
  assert.equal(await storedCookie(alice), 'sid=abc123; theme=sombre');
  let me = (await call('GET', 'me', { key: alice.key })).json;
  assert.equal(me.session.has_cookie, true);
  assert.equal(me.session.expired, false);
  assert.equal(me.session.updated_at, u.cookie_updated_at);
  for (const cookie of ['', 'pas de paire', 'sid=é', 42]) {
    r = await call('POST', 'session', { key: alice.key, body: { cookie } });
    assert.equal(r.status, 400, String(cookie));
  }
  const noSecret = { ...env, COOKIE_SECRET: undefined };
  r = await call('POST', 'session', { key: alice.key, body: { cookie: 'sid=1' }, e: noSecret });
  assert.equal(r.status, 500);
  assert.match(r.json.error, /COOKIE_SECRET n'est pas configuré/);
  r = await call('DELETE', 'session', { key: alice.key });
  assert.deepEqual(r.json, { ok: true });
  me = (await call('GET', 'me', { key: alice.key })).json;
  assert.deepEqual(me.session, { has_cookie: false, expired: false, updated_at: null });
});

await test('session : HAR avec cookie (préférence my-collection, casse, HTTP/2), nettoyé, sans le jeu', async () => {
  const req = (url, headers, cookies) => ({ request: { url, headers, cookies } });
  const har = {
    log: {
      entries: [
        req('https://example.com/', [{ name: 'Cookie', value: 'autre=site' }]),
        req('https://www.wiki-masters.com/api/my-collection?sort=rarity&page=0&stats=0', [
          { name: 'COOKIE', value: 'sid=collection' },
          { name: 'cookie', value: 'prefs=1' },
        ]),
        req('https://www.wiki-masters.com/collection', [{ name: 'Cookie', value: 'sid=page' }]),
        req('https://www.wiki-masters.com/api/me', [{ name: 'cookie', value: 'sid=api' }]),
      ],
    },
  };
  let r = await call('POST', 'session', { key: alice.key, body: { har } });
  assert.deepEqual(r.json, { ok: true });
  assert.equal(await storedCookie(alice), 'sid=collection; prefs=1');
  // Le jeu sans « www » compte aussi.
  r = await call('POST', 'session', { key: alice.key, body: { har: { log: { entries: [req('https://wiki-masters.com/api/my-collection?page=0', [{ name: 'Cookie', value: 'sid=nu' }])] } } } });
  assert.equal(r.status, 200);
  assert.equal(await storedCookie(alice), 'sid=nu');
  // HAR passé en texte, cookie seulement dans request.cookies
  const har2 = { log: { entries: [req('https://www.wiki-masters.com/api/my-collection?page=1', [], [{ name: 'sid', value: 'tableau' }])] } };
  r = await call('POST', 'session', { key: alice.key, body: { har: JSON.stringify(har2) } });
  assert.equal(r.status, 200);
  assert.equal(await storedCookie(alice), 'sid=tableau');

  const cleaned = { log: { entries: [req('https://www.wiki-masters.com/api/my-collection?page=0', [{ name: 'accept', value: '*/*' }], [])] } };
  r = await call('POST', 'session', { key: alice.key, body: { har: cleaned } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /nettoyé/);
  assert.match(r.json.error, /données sensibles/);
  assert.match(r.json.error, /en-tête Cookie/);
  r = await call('POST', 'session', { key: alice.key, body: { har: { log: { entries: [req('https://example.com/', [{ name: 'Cookie', value: 'a=1' }])] } } } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /aucune requête vers wiki-masters\.com/);
  r = await call('POST', 'session', { key: alice.key, body: { har: { pas: 'un har' } } });
  assert.equal(r.status, 400);
  r = await call('POST', 'session', { key: alice.key, body: {} });
  assert.equal(r.status, 400);
  assert.equal(await storedCookie(alice), 'sid=tableau', 'un envoi refusé ne touche pas au cookie gardé');
});

// --- Rafraîchissement par cookie ------------------------------------------------------------------------------

// Jeu simulé : stats + pages de 50 entrées ; options pour Set-Cookie, statuts d'erreur (corps JSON), réponses
// brutes [statut, corps, type] (redirection, page HTML), panne réseau.
function mockGame(entries, { stats, setCookie = {}, status = {}, raw = {}, down = false } = {}) {
  const calls = [];
  const pages = [];
  for (let p = 0; p * 50 <= entries.length; p++) pages.push(JSON.stringify({ collection: entries.slice(p * 50, p * 50 + 50) }));
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const h = new Headers(init.headers);
    calls.push({ url: String(url), cookie: h.get('cookie'), accept: h.get('accept'), redirect: init.redirect, at: performance.now() });
    if (down) throw new TypeError('fetch failed');
    const isStats = u.pathname === '/api/my-collection/stats';
    const page = isStats ? 'stats' : Number(u.searchParams.get('page'));
    const headers = [['content-type', 'application/json']];
    for (const v of setCookie[page] || []) headers.push(['set-cookie', v]);
    if (raw[page]) {
      const [st, body, type] = raw[page];
      headers[0][1] = type;
      if (st >= 300 && st < 400) headers.push(['location', 'https://www.wiki-masters.com/login']);
      return new Response(body, { status: st, headers });
    }
    if (status[page]) return new Response(JSON.stringify({ error: 'non' }), { status: status[page], headers });
    const body = isStats
      ? JSON.stringify(stats ?? { total: entries.length, totalUnique: new Set(entries.map((e) => e.card_id)).size, rarityCounts: {}, tagOptions: ['TagDuJeu'] })
      : (pages[page] ?? '{"collection":[]}');
    return new Response(body, { status: 200, headers });
  };
  return calls;
}

let bob;
await test('refresh : sans cookie → 401 needs_session', async () => {
  bob = await signup('Bob');
  const calls = mockGame([]);
  const r = await call('POST', 'refresh', { key: bob.key, body: { page: 0 } });
  assert.equal(r.status, 401);
  assert.equal(r.json.needs_session, true);
  assert.equal(calls.length, 0);
});

await test('refresh : 3 pages, en-têtes, pause de 250 ms, Set-Cookie fusionné, fin et import', async () => {
  await call('POST', 'session', { key: bob.key, body: { cookie: 'sid=ancien; vieux=x; autre=2' } });
  const entries = entriesFor(base.slice(0, 120));
  const calls = mockGame(entries, {
    setCookie: { 1: ['sid=nouveau; Path=/; HttpOnly; Secure; SameSite=Lax', 'ajout=1; Path=/', 'vieux=; Max-Age=0; Path=/'] },
  });
  const r = await call('POST', 'refresh', { key: bob.key, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { done: true, count: 120, new_ids: [], complete: true, skipped: 0 });
  assert.deepEqual(calls.map((c) => c.url), [
    'https://www.wiki-masters.com/api/my-collection/stats?sort=rarity',
    'https://www.wiki-masters.com/api/my-collection?sort=rarity&page=0&stats=0',
    'https://www.wiki-masters.com/api/my-collection?sort=rarity&page=1&stats=0',
    'https://www.wiki-masters.com/api/my-collection?sort=rarity&page=2&stats=0',
  ]);
  for (const c of calls) {
    assert.equal(c.accept, 'application/json');
    assert.equal(c.redirect, 'manual');
  }
  assert.equal(calls[2].cookie, 'sid=ancien; vieux=x; autre=2');
  assert.equal(calls[3].cookie, 'sid=nouveau; autre=2; ajout=1');
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i].at - calls[i - 1].at >= 240, `pause ${i}`);
  assert.equal(await storedCookie(bob), 'sid=nouveau; autre=2; ajout=1');
  assert.equal(rows('SELECT * FROM refresh_staging').length, 0);
  const cards = (await call('GET', 'cards', { key: bob.key })).json.cards;
  assert.equal(cards.length, 120);
  const everything = JSON.stringify(['users', 'cards', 'tags', 'refresh_staging'].map((t) => rows(`SELECT * FROM ${t}`)));
  assert.ok(!everything.includes(GAME_USER));
});

await test('refresh par appels de 10 pages (42 pages), progression, reprise impossible sans le début', async () => {
  const e2 = makeEnv({ REFRESH_PAUSE_MS: '0' });
  const carol = await signup('Carol', e2);
  await call('POST', 'session', { key: carol.key, body: { cookie: 'sid=carol' }, e: e2 });
  let r = await call('POST', 'refresh', { key: carol.key, body: { page: 10 }, e: e2 });
  assert.equal(r.status, 409);
  r = await call('POST', 'refresh', { key: carol.key, body: { page: 'x' }, e: e2 });
  assert.equal(r.status, 400);

  const entries = Array.from({ length: 41 * 50 + 10 }, (_, i) => tiny(i));
  // Le même exemplaire vu sur deux pages (collection qui bouge pendant la lecture) ne compte qu'une fois ;
  // deux exemplaires d'une même carte sur deux pages sont additionnés.
  entries[50] = { ...entries[49] };
  entries[100] = { ...tiny(99), id: 'autre-exemplaire', count: 2 };
  // Entrées invalides (mêmes règles que le favori) : ignorées et comptées.
  entries[3] = { ...tiny(3), card: { ...tiny(3).card, rarity: 'Z' } };
  entries[620] = { ...tiny(620), card: { ...tiny(620).card, wikipedia_title: 't'.repeat(501) } };
  let calls = mockGame(entries);
  r = await call('POST', 'refresh', { key: carol.key, body: { page: 0 }, e: e2 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { done: false, next_page: 10, fetched: 500, total: 2060, skipped: 1 });
  assert.equal(calls.length, 11); // stats + 10 pages
  const responses = [r.json];
  while (!r.json.done) {
    r = await call('POST', 'refresh', { key: carol.key, body: { page: r.json.next_page }, e: e2 });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    responses.push(r.json);
  }
  assert.equal(responses.length, 5);
  assert.deepEqual(responses.slice(1, 4).map((x) => x.fetched), [1000, 1500, 2000]);
  assert.deepEqual(r.json, { done: true, count: 2056, new_ids: [], complete: false, skipped: 2 });
  assert.equal(calls.length, 43);
  assert.equal(calls.filter((c) => c.url.includes('/stats')).length, 1);
  assert.equal(e2.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM refresh_staging').get().n, 0);
  const cards = (await call('GET', 'cards', { key: carol.key, e: e2 })).json.cards;
  assert.equal(cards.length, 2056);
  assert.ok(!cards.some((c) => c.id === 'c3' || c.id === 'c620'));
  assert.equal(cards.find((c) => c.id === 'c49').count, 1);
  assert.equal(cards.find((c) => c.id === 'c99').count, 3);

  // Un second rafraîchissement donne les nouveautés.
  entries.push(tiny(5000));
  calls = mockGame(entries);
  r = await call('POST', 'refresh', { key: carol.key, body: {}, e: e2 });
  while (!r.json.done) r = await call('POST', 'refresh', { key: carol.key, body: { page: r.json.next_page }, e: e2 });
  assert.deepEqual(r.json, { done: true, count: 2057, new_ids: ['c5000'], complete: false, skipped: 2 });

  // Pages en attente depuis plus d'une heure : effacées, la reprise est refusée.
  r = await call('POST', 'refresh', { key: carol.key, body: {}, e: e2 });
  e2.DB.sqlite.prepare("UPDATE refresh_staging SET created_at = '2000-01-01T00:00:00.000Z'").run();
  r = await call('POST', 'refresh', { key: carol.key, body: { page: 10 }, e: e2 });
  assert.equal(r.status, 409);
  assert.equal(e2.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM refresh_staging').get().n, 0);
});

await test('refresh : 401 du jeu → session expirée ; 5xx et panne → 502 sans expirer', async () => {
  const entries = entriesFor(base.slice(0, 60));
  let calls = mockGame(entries, { status: { 1: 503 } });
  let r = await call('POST', 'refresh', { key: bob.key, body: { page: 0 } });
  assert.equal(r.status, 502);
  assert.ok(r.json.error);
  assert.equal(r.json.needs_session, undefined);
  calls = mockGame(entries, { down: true });
  r = await call('POST', 'refresh', { key: bob.key, body: { page: 0 } });
  assert.equal(r.status, 502);
  assert.equal((await call('GET', 'me', { key: bob.key })).json.session.expired, false);

  calls = mockGame(entries, { status: { 0: 401 }, setCookie: { stats: ['sid=tourne; Path=/'] } });
  r = await call('POST', 'refresh', { key: bob.key, body: { page: 0 } });
  assert.equal(r.status, 401);
  assert.deepEqual(r.json, { error: 'Ta session WikiMasters a expiré : colle un nouveau cookie.', needs_session: true });
  assert.equal(await storedCookie(bob), 'sid=tourne; autre=2; ajout=1', "Set-Cookie gardé même en cas d'échec");
  let me = (await call('GET', 'me', { key: bob.key })).json;
  assert.equal(me.session.expired, true);
  assert.equal(me.session.has_cookie, true);
  const n = calls.length;
  r = await call('POST', 'refresh', { key: bob.key, body: { page: 0 } });
  assert.equal(r.status, 401);
  assert.equal(r.json.needs_session, true);
  assert.equal(calls.length, n, "session expirée : le jeu n'est plus appelé");

  mockGame(entries, { status: { stats: 403 } });
  await call('POST', 'session', { key: bob.key, body: { cookie: 'sid=frais' } });
  me = (await call('GET', 'me', { key: bob.key })).json;
  assert.equal(me.session.expired, false);
  r = await call('POST', 'refresh', { key: bob.key, body: { page: 0 } });
  assert.equal(r.status, 401);
  assert.equal(r.json.needs_session, true);
  globalThis.fetch = realFetch;
});

await test('refresh : redirection = session expirée, 403 non JSON = anti-robots, Set-Cookie filtrés, cookie écrit avant les pages', async () => {
  const entries = entriesFor(base.slice(0, 60));
  const expired = async () => (await call('GET', 'me', { key: bob.key })).json.session.expired;
  // Redirection (vers la page de connexion) : pas suivie, session expirée.
  await call('POST', 'session', { key: bob.key, body: { cookie: 'sid=1' } });
  let calls = mockGame(entries, { raw: { 0: [302, null, 'text/html'] } });
  let r = await call('POST', 'refresh', { key: bob.key, body: { page: 0 } });
  assert.equal(r.status, 401);
  assert.equal(r.json.needs_session, true);
  assert.equal(await expired(), true);
  assert.ok(calls.every((c) => c.redirect === 'manual'));
  // 403 avec une page HTML (protection anti-robots) : 502, la session n'est pas touchée.
  await call('POST', 'session', { key: bob.key, body: { cookie: 'sid=1' } });
  mockGame(entries, { raw: { stats: [403, '<html><title>Just a moment...</title></html>', 'text/html'] } });
  r = await call('POST', 'refresh', { key: bob.key, body: { page: 0 } });
  assert.equal(r.status, 502);
  assert.match(r.json.error, /anti-robots/);
  assert.equal(r.json.needs_session, undefined);
  assert.equal(await expired(), false);
  // 403 en JSON : le jeu refuse la session.
  mockGame(entries, { raw: { 0: [403, '{"error":"Unauthorized"}', 'application/json'] } });
  r = await call('POST', 'refresh', { key: bob.key, body: { page: 0 } });
  assert.equal(r.status, 401);
  assert.equal(await expired(), true);

  // Set-Cookie : seuls ceux du jeu (sans Domain, ou Domain wiki-masters.com) sont gardés.
  await call('POST', 'session', { key: bob.key, body: { cookie: 'sid=1; b=2' } });
  mockGame(entries, {
    setCookie: {
      stats: ['sid=2; Domain=.wiki-masters.com; Path=/', 'pub=1; Domain=ads.example.com', 'b=3; domain=WWW.wiki-masters.com'],
      0: ['autre=x; Domain=wiki-masters.com.evil.example'],
    },
  });
  r = await call('POST', 'refresh', { key: bob.key, body: { page: 0 } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(await storedCookie(bob), 'sid=2; b=3');

  // Écriture des pages en échec (base pleine) : le cookie renouvelé est quand même gardé.
  await call('POST', 'session', { key: bob.key, body: { cookie: 'sid=avant' } });
  mockGame(entries, { setCookie: { stats: ['sid=apres; Path=/'] } });
  const quiet = console.error;
  console.error = () => {};
  after(() => { console.error = quiet; });
  const full = {
    prepare: (sql) => env.DB.prepare(sql),
    batch: async (sts) => {
      if (sts.some((s) => s.sql.includes('INSERT OR REPLACE INTO refresh_staging'))) throw new Error('D1_ERROR: database or disk is full: SQLITE_FULL');
      return env.DB.batch(sts);
    },
  };
  r = await call('POST', 'refresh', { key: bob.key, body: { page: 0 }, e: { ...env, DB: full } });
  assert.equal(r.status, 503);
  assert.equal(await storedCookie(bob), 'sid=apres');
  globalThis.fetch = realFetch;
});

// --- CORS et limites ------------------------------------------------------------------------------------------

await test('CORS de /api/import uniquement pour wiki-masters.com (avec ou sans www)', async () => {
  const origin = { origin: 'https://www.wiki-masters.com' };
  let r = await call('OPTIONS', 'import', {
    headers: { ...origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, x-classeur-key' },
  });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://www.wiki-masters.com');
  assert.equal(r.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal(r.headers.get('access-control-allow-headers'), 'content-type, x-classeur-key');
  assert.ok(Number(r.headers.get('access-control-max-age')) > 0);
  r = await call('OPTIONS', 'import', { headers: { origin: 'https://evil.example' } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  r = await call('POST', 'import', { key: alice.key, headers: origin, body: { collection: entriesFor(base.slice(10, 130)), source: 'favori' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://www.wiki-masters.com');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  r = await call('POST', 'import', { headers: origin, body: { collection: [] } });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://www.wiki-masters.com', 'les erreurs aussi');
  r = await call('POST', 'import', { key: alice.key, headers: { origin: 'https://evil.example' }, body: { collection: entriesFor(base.slice(10, 130)) } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  r = await call('GET', 'me', { key: alice.key, headers: origin });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  r = await call('OPTIONS', 'me', { headers: origin });
  assert.equal(r.status, 405);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  // Le jeu sans « www » : même accord, l'origine est renvoyée telle quelle.
  r = await call('OPTIONS', 'import', { headers: { origin: 'https://wiki-masters.com' } });
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://wiki-masters.com');
  r = await call('OPTIONS', 'import', { headers: { origin: 'http://wiki-masters.com' } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  assert.match(r.headers.get('vary'), /Origin/);
});

await test('import par morceaux (CarteImport) : réponses, stats, nouveautés', async () => {
  const erin = await signup('Erin');
  const cards = synth(1200);
  let r = await upload(erin.key, cards, { stats: { total: 1300, totalUnique: 1200, rarityCounts: {}, tagOptions: ['x'] } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { count: 1200, new_ids: [], complete: true, skipped: 0 });
  let got = (await call('GET', 'cards', { key: erin.key })).json.cards;
  assert.equal(got.length, 1200);
  assert.deepEqual(got[0], { ...cards[0], tags: [] });
  assert.equal(rows('SELECT COUNT(*) AS n FROM import_staging')[0].n, 0);

  // Second envoi : 100 retirées, 50 ajoutées, 1 modifiée ; seules ces lignes sont écrites.
  const next = [...cards.slice(100), ...synth(50, 5000)];
  next[0] = { ...next[0], count: 7 };
  const writes = countCardWrites(true);
  r = await upload(erin.key, next);
  assert.equal(r.json.count, 1150);
  assert.equal(r.json.complete, null);
  assert.deepEqual([...r.json.new_ids].sort(), synth(50, 5000).map((c) => c.id));
  assert.equal(writes(), 151);
  countCardWrites(false);
  got = (await call('GET', 'cards', { key: erin.key })).json.cards;
  assert.equal(got.find((c) => c.id === next[0].id).count, 7);
  assert.ok(!got.some((c) => c.id === cards[0].id));

  // Envoi sans upload_id = un seul morceau (compatibilité).
  r = await call('POST', 'import', { key: erin.key, body: { cards: next.slice(0, 500) } });
  assert.deepEqual(r.json, { count: 500, new_ids: [], complete: null, skipped: 0 });
});

await test('import par morceaux : cartes invalides ignorées, morceaux manquants, un envoi à la fois, quotas, purge', async () => {
  const frank = await signup('Frank');
  const ok = synth(1)[0];
  const bad = [
    { ...ok, id: '' }, { ...ok, id: 42 }, { ...ok, title: '' }, { ...ok, title: 'x'.repeat(501) },
    { ...ok, rarity: 'XL' }, { ...ok, rarity: null }, { ...ok, atk: '12' }, { ...ok, quality: 'beaucoup' },
    { ...ok, image: 'javascript:alert(1)' }, { ...ok, url: 'ftp://x' }, { ...ok, url: `https://x/${'y'.repeat(2000)}` },
    { ...ok, count: 0 }, { ...ok, count: 1.5 }, { ...ok, shiny: 'oui' }, { ...ok, obtained_at: 'hier' },
    { ...ok, category: 12 }, { ...ok, category: 'c'.repeat(501) }, 'texte', null,
  ];
  // Favori (CarteImport) : les cartes invalides sont ignorées et comptées, les autres importées.
  let r = await call('POST', 'import', { key: frank.key, body: { cards: [ok, ...bad, { ...ok, id: 'autre', extra: 'ignoré', tags: ['x'] }] } });
  assert.deepEqual(r.json, { count: 2, new_ids: [], complete: null, skipped: bad.length });
  assert.ok(!rows('SELECT data FROM cards WHERE user_id = ?', frank.user.id).some((x) => x.data.includes('ignoré')));
  // Entrées brutes : mêmes règles (titre, catégorie, adresses, rareté, identifiants d'exemplaire).
  const good = rawEntry(base[0]);
  const rawBad = [
    { ...good, card: { ...good.card, wikipedia_title: 't'.repeat(501) } },
    { ...good, card: { ...good.card, category: 'c'.repeat(501) } },
    { ...good, card: { ...good.card, image_url: `https://x/${'y'.repeat(2000)}` } },
    { ...good, card: { ...good.card, rarity: 'XL' } },
    { ...good, id: 'e'.repeat(101) },
    { foo: 1 },
  ];
  r = await call('POST', 'import', { key: frank.key, body: { collection: [good, ...rawBad] } });
  assert.deepEqual(r.json, { count: 1, new_ids: [base[0].id], complete: null, skipped: rawBad.length });
  r = await call('POST', 'import', { key: frank.key, body: { cards: [ok] } });
  assert.equal(r.status, 200);

  r = await call('POST', 'import', { key: frank.key, body: { cards: synth(501) } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /500 cartes au plus/);
  r = await call('POST', 'import', { key: frank.key, body: { collection: Array.from({ length: 501 }, (_, i) => tiny(i)) } });
  assert.equal(r.status, 400);
  for (const body of [
    { upload_id: 'a b', part: 0, cards: [ok] },
    { upload_id: 'a', part: -1, cards: [ok] },
    { upload_id: 'a', part: 40, cards: [ok] },
    { upload_id: 'a', part: 0, last: 'oui', cards: [ok] },
    { upload_id: 'a', part: 0 },
    { cards: [ok], stats: [1] },
  ]) {
    r = await call('POST', 'import', { key: frank.key, body });
    assert.equal(r.status, 400, JSON.stringify(body));
  }

  // Morceau manquant.
  await call('POST', 'import', { key: frank.key, body: { upload_id: 'trou', part: 0, last: false, cards: synth(10) } });
  r = await call('POST', 'import', { key: frank.key, body: { upload_id: 'trou', part: 2, last: true, cards: synth(10, 20) } });
  assert.equal(r.status, 409);
  // Un nouvel envoi remplace celui en cours.
  await call('POST', 'import', { key: frank.key, body: { upload_id: 'A', part: 0, last: false, cards: synth(10) } });
  r = await call('POST', 'import', { key: frank.key, body: { upload_id: 'B', part: 0, last: false, cards: [...synth(10, 10), null] } });
  assert.deepEqual(r.json, { ok: true, received: 10, skipped: 1 });
  r = await call('POST', 'import', { key: frank.key, body: { upload_id: 'A', part: 1, last: true, cards: synth(10, 20) } });
  assert.equal(r.status, 409);
  // Un morceau renvoyé (nouvel essai) remplace le précédent au lieu de s'ajouter.
  await call('POST', 'import', { key: frank.key, body: { upload_id: 'C', part: 0, last: false, cards: synth(10) } });
  await call('POST', 'import', { key: frank.key, body: { upload_id: 'C', part: 0, last: false, cards: [...synth(10), 'x'] } });
  r = await call('POST', 'import', { key: frank.key, body: { upload_id: 'C', part: 1, last: true, cards: synth(5, 10) } });
  assert.equal(r.json.count, 15);
  assert.equal(r.json.skipped, 1);
  assert.deepEqual([...r.json.new_ids].sort(), synth(14, 1).map((c) => c.id));
  assert.equal((await call('GET', 'cards', { key: frank.key })).json.cards.find((c) => c.id === ok.id).count, ok.count);

  // 8 Mo au plus en attente pour un envoi : des cartes lourdes (catégorie de 450 caractères, ~600 octets en attente)
  // dépassent la limite vers le 28e morceau, bien avant les 40 morceaux permis.
  const big = synth(20_000).map((c) => ({ ...c, category: 'c'.repeat(450) }));
  let status = 200;
  let p = 0;
  for (; p < 40 && status === 200; p++) {
    r = await call('POST', 'import', { key: frank.key, body: { upload_id: 'gros', part: p, last: false, cards: big.slice(p * 500, (p + 1) * 500) } });
    status = r.status;
  }
  assert.equal(status, 413, `morceau ${p - 1}`);
  assert.ok(p - 1 >= 12, `refusé dès le morceau ${p - 1}`);
  assert.match(r.json.error, /8 Mo/);
  const staged = rows("SELECT SUM(length(CAST(cards AS BLOB))) AS b FROM import_staging WHERE upload_id = 'gros'")[0].b;
  assert.ok(staged <= 8 * 1024 * 1024 && staged > 7 * 1024 * 1024, String(staged));

  // Morceaux de plus d'une heure (de n'importe qui) : effacés au premier import venu.
  env.DB.sqlite.prepare("INSERT INTO import_staging (user_id, upload_id, part, cards, created_at) VALUES ('quelqu-un', 'vieux', 0, '[]', '2000-01-01T00:00:00.000Z')").run();
  await call('POST', 'import', { key: frank.key, body: { upload_id: 'D', part: 0, last: false, cards: [ok] } });
  assert.equal(rows("SELECT COUNT(*) AS n FROM import_staging WHERE user_id = 'quelqu-un'")[0].n, 0);
  assert.equal(rows("SELECT COUNT(*) AS n FROM import_staging WHERE upload_id = 'gros'")[0].n, 0, "l'envoi D remplace l'envoi en cours");
});

await test("import par morceaux (entrées brutes) : exemplaires regroupés d'un morceau à l'autre", async () => {
  const gina = await signup('Gina');
  const a = base[0];
  const part0 = [rawEntry(a, { id: 'x1', count: 1, obtained_at: '2026-05-01T00:00:00.000Z' }), rawEntry(base[1])];
  const part1 = [
    rawEntry(a, { id: 'x2', count: 2, is_shiny: true, obtained_at: '2026-02-01T00:00:00.000Z' }),
    rawEntry(a, { id: 'x1', count: 1, obtained_at: '2026-05-01T00:00:00.000Z' }), // même exemplaire, déjà vu
  ];
  let r = await call('POST', 'import', { key: gina.key, body: { upload_id: 'brut', part: 0, last: false, collection: part0 } });
  assert.deepEqual(r.json, { ok: true, received: 2, skipped: 0 });
  r = await call('POST', 'import', { key: gina.key, body: { upload_id: 'brut', part: 1, last: true, collection: part1, stats: { totalUnique: 2 } } });
  assert.deepEqual(r.json, { count: 2, new_ids: [], complete: true, skipped: 0 });
  const card = (await call('GET', 'cards', { key: gina.key })).json.cards.find((c) => c.id === a.id);
  assert.equal(card.count, 3);
  assert.equal(card.shiny, true);
  assert.equal(card.obtained_at, '2026-02-01T00:00:00.000Z');
  assert.ok(!JSON.stringify(rows('SELECT * FROM cards')).includes(GAME_USER));
});

await test('corps trop gros (5 Mo), 20 000 cartes au plus, lecture par pages', async () => {
  const big = JSON.stringify({ collection: [], pad: 'x'.repeat(5 * 1024 * 1024) });
  let r = await call('POST', 'import', { key: alice.key, raw: big, headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 413);
  assert.match(r.json.error, /5 Mo/);
  r = await call('POST', 'import', { key: alice.key, raw: '{}', headers: { 'content-length': String(6 * 1024 * 1024) } });
  assert.equal(r.status, 413);

  // 20 000 cartes : 40 morceaux de 500 (cartes minimales).
  const dave = await signup('Dave');
  r = await upload(dave.key, mini(20_000), { stats: { totalUnique: 20_000 } });
  assert.deepEqual(r.json, { count: 20_000, new_ids: [], complete: true, skipped: 0 });
  const all = (await call('GET', 'cards', { key: dave.key })).json;
  assert.equal(all.cards.length, 20_000);

  // 20 001 cartes : possible seulement par le rafraîchissement (plus de 40 morceaux) ; refusé à la fin.
  const e4 = makeEnv({ REFRESH_PAUSE_MS: '0' });
  const zed = await signup('Zed', e4);
  await call('POST', 'session', { key: zed.key, e: e4, body: { cookie: 'sid=z' } });
  mockGame(Array.from({ length: 20_001 }, (_, i) => tiny(i)));
  r = await call('POST', 'refresh', { key: zed.key, e: e4, body: {} });
  while (r.status === 200 && !r.json.done) r = await call('POST', 'refresh', { key: zed.key, e: e4, body: { page: r.json.next_page } });
  globalThis.fetch = realFetch;
  assert.equal(r.status, 400);
  assert.match(r.json.error, /20 000 cartes/);

  // Lecture par pages de 1 000 (curseur opaque) : mêmes cartes, dans le même ordre, avec leurs étiquettes.
  for (let k = 0; k < 4; k++) {
    r = await call('POST', 'tags/bulk', { key: dave.key, body: { card_ids: mini(5000, k * 5000).map((c) => c.id), add: ['Tout'] } });
    assert.equal(r.status, 200);
  }
  assert.equal(rows("SELECT COUNT(*) AS n FROM tags WHERE tag = 'Tout'")[0].n, 20_000);
  const ids = [];
  let part = '0';
  let pages = 0;
  for (;;) {
    const r2 = await call('GET', `cards?part=${encodeURIComponent(part)}`, { key: dave.key });
    assert.equal(r2.status, 200, JSON.stringify(r2.json));
    assert.equal(r2.json.part, part);
    assert.ok(r2.json.cards.length <= 1000);
    assert.ok(r2.json.cards.every((c) => c.tags.length === 1 && c.tags[0] === 'Tout'));
    for (const c of r2.json.cards) ids.push(c.id);
    pages++;
    if (r2.json.next_part === null) break;
    assert.equal(typeof r2.json.next_part, 'string');
    part = r2.json.next_part;
  }
  assert.equal(pages, 20);
  assert.deepEqual(ids, all.cards.map((c) => c.id));
  assert.equal((await call('GET', 'cards?part=!!', { key: dave.key })).status, 400);
  assert.equal((await call('GET', 'cards?part=-1', { key: dave.key })).status, 400);
  const nobody = await signup('Personne');
  assert.deepEqual((await call('GET', 'cards?part=0', { key: nobody.key })).json, { fetched_at: null, cards: [], new_ids: [], part: '0', next_part: null });
  assert.deepEqual((await call('GET', 'cards?part=', { key: nobody.key })).json.cards, []);
  assert.deepEqual((await call('GET', 'cards', { key: nobody.key })).json, { fetched_at: null, cards: [], new_ids: [] });
  r = await call('DELETE', 'me', { key: dave.key });
  assert.deepEqual(r.json, { ok: true });
  await call('DELETE', 'me', { key: nobody.key });
});

await test('étiquettes : 5 000 changements par appel, 50 000 par compte (orphelines comprises)', async () => {
  const jo = await signup('Jo');
  await upload(jo.key, mini(6000));
  const ids = mini(6000).map((c) => c.id);
  let r = await call('POST', 'tags/bulk', { key: jo.key, body: { card_ids: ids.slice(0, 5001), add: ['a'] } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /5 000 changements/);
  r = await call('POST', 'tags/bulk', { key: jo.key, body: { card_ids: ids.slice(0, 2500), add: ['a'], remove: ['b'] } });
  assert.equal(r.status, 200);
  r = await call('POST', 'tags/bulk', { key: jo.key, body: { card_ids: ids.slice(0, 2501), add: ['a'], remove: ['b'] } });
  assert.equal(r.status, 400);
  // 50 000 étiquettes : on remplit avec des étiquettes de cartes disparues (orphelines), qui comptent aussi.
  env.DB.sqlite.prepare(
    "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 47499) INSERT INTO tags (user_id, card_id, tag) SELECT ?, 'disparue-' || i, 'x' FROM n",
  ).run(jo.user.id);
  const count = () => rows('SELECT COUNT(*) AS n FROM tags WHERE user_id = ?', jo.user.id)[0].n;
  assert.equal(count(), 49_999);
  r = await call('POST', 'tags/set', { key: jo.key, body: { card_id: ids[3000], tags: ['un', 'deux'] } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /50\s000 étiquettes/);
  r = await call('POST', 'tags/set', { key: jo.key, body: { card_id: ids[3000], tags: ['un'] } });
  assert.equal(r.status, 200);
  assert.equal(count(), 50_000);
  r = await call('POST', 'tags/set', { key: jo.key, body: { card_id: ids[3000], tags: ['autre'] } });
  assert.equal(r.status, 200, 'remplacer sans ajouter reste permis');
  r = await call('POST', 'tags/bulk', { key: jo.key, body: { card_ids: [ids[3001]], add: ['b'] } });
  assert.equal(r.status, 400);
  // Retirer et ajouter dans le même appel : le total ne bouge pas.
  r = await call('POST', 'tags/bulk', { key: jo.key, body: { card_ids: ids.slice(0, 10), add: ['c'], remove: ['a'] } });
  assert.equal(r.status, 200);
  assert.equal(count(), 50_000);
  await call('DELETE', 'me', { key: jo.key });
});

await test('mesures de CPU (limite des Workers gratuits : 10 ms)', async () => {
  const e3 = makeEnv({ REFRESH_PAUSE_MS: '0' });
  const runs = {
    part: [], refresh: [], fin1k: [], fin5k: [], fin20k: [], cards1k: [], cards20k: [], cardsPage: [], bulk: [], target: [],
  };
  // Collection à compléter réaliste : 3 000 éléments (titre, description, une image sur deux), un peu d'accents.
  const items = Array.from({ length: 3000 }, (_, i) => ({
    title: i % 7 ? `Article numéro ${i}` : `Élément ${i}`,
    description: i % 3 ? `description courte de l'article ${i}` : `commune française du département ${i % 95}`,
    image: i % 2 ? null : `https://upload.wikimedia.org/x/${i}.jpg`,
    status: i % 50 ? 'ok' : 'missing',
  }));
  mockGame(entriesFor(owned.slice(0, 1043)));
  for (let k = 0; k < 8; k++) {
    // Un morceau intermédiaire de 500 cartes.
    const u = await signup(`Mesure ${k}`, e3);
    runs.part.push(await profile('POST', 'import', { key: u.key, e: e3, body: { upload_id: 'm', part: 0, last: false, cards: synth(500) } }));
    // Un appel de rafraîchissement : stats + 10 pages de 50 entrées.
    await call('POST', 'session', { key: u.key, e: e3, body: { cookie: 'sid=mesure' } });
    const m = await profile('POST', 'refresh', { key: u.key, e: e3, body: { page: 0 } });
    assert.equal(m.json.fetched, 500);
    runs.refresh.push(m);
    // Une collection à compléter de 3 000 éléments.
    const t = await profile('POST', 'targets/save', { key: u.key, e: e3, body: { id: 'mesure', name: 'Mesure', items, source: 'catalog:x' } });
    assert.equal(t.status, 200, JSON.stringify(t.json).slice(0, 200));
    runs.target.push(t);
  }
  globalThis.fetch = realFetch;
  // Finalisations : le dernier morceau est vide, on ne mesure que la finalisation. 20 000 : cartes minimales.
  for (const [n, slot, times, make] of [[1000, 'fin1k', 6, synth], [5000, 'fin5k', 4, synth], [20_000, 'fin20k', 3, mini]]) {
    for (let k = 0; k < times; k++) {
      const v = await signup(`Fin ${n} ${k}`, e3);
      const cards = make(n);
      for (let p = 0; p * 500 < n; p++) {
        await call('POST', 'import', { key: v.key, e: e3, body: { upload_id: 'f', part: p, last: false, cards: cards.slice(p * 500, (p + 1) * 500) } });
      }
      const m = await profile('POST', 'import', { key: v.key, e: e3, body: { upload_id: 'f', part: n / 500 - 1, last: true, cards: cards.slice(n - 500) } });
      assert.equal(m.json.count, n);
      runs[slot].push(m);
      if (n === 1000) runs.cards1k.push(await profile('GET', 'cards', { key: v.key, e: e3 }));
      if (n === 20_000) {
        runs.cards20k.push(await profile('GET', 'cards', { key: v.key, e: e3 }));
        const first = (await call('GET', 'cards?part=0', { key: v.key, e: e3 })).json.next_part;
        runs.cardsPage.push(await profile('GET', `cards?part=${first}`, { key: v.key, e: e3 }));
        runs.bulk.push(await profile('POST', 'tags/bulk', { key: v.key, e: e3, body: { card_ids: cards.slice(0, 5000).map((c) => c.id), add: [`t${k}`] } }));
      }
      await call('DELETE', 'me', { key: v.key, e: e3 });
    }
  }
  report('morceau de 500 cartes', runs.part);
  report('refresh, stats + 10 pages', runs.refresh);
  report('targets/save, 3 000 éléments', runs.target);
  report('dernier morceau + finalisation, 1 000 cartes', runs.fin1k);
  report('dernier morceau + finalisation, 5 000 cartes', runs.fin5k);
  report('dernier morceau + finalisation, 20 000 cartes', runs.fin20k);
  report('GET /api/cards, 1 000 cartes', runs.cards1k);
  report('GET /api/cards, 20 000 cartes (minimales)', runs.cards20k);
  report('GET /api/cards?part=…, une page de 1 000', runs.cardsPage);
  report('tags/bulk, 5 000 cartes', runs.bulk);
  // Décodage par le Worker de la réponse de D1 (absent du rejeu) : ordre de grandeur, en décodant une charge JSON de
  // même taille (les morceaux de la réponse, échappés dans des chaînes).
  const sizes = [runs.cards1k[0].size, runs.cards20k[0].size, runs.cardsPage[0].size];
  const decode = [runs.cards1k[0], runs.cards20k[0], runs.cardsPage[0]].map((r) => {
    const wire = JSON.stringify([{ part: r.text }]);
    const t0 = performance.now();
    for (let k = 0; k < 5; k++) JSON.parse(wire);
    return (performance.now() - t0) / 5;
  });
  console.log(`    (réponses GET /api/cards : ${sizes.map((s) => `${(s / 1e6).toFixed(2)} Mo`).join(', ')} ; décoder autant venant de D1 ~ ${decode.map(ms).join(', ')})`);
  // Aucun chemin de finalisation ne doit faire de JavaScript proportionnel au nombre de cartes.
  const js = (rs) => mean(rs.map((r) => r.js));
  assert.ok(js(runs.fin20k) < js(runs.fin1k) + 2, 'finalisation proportionnelle au nombre de cartes ?');
  assert.ok(js(runs.part) < 10 && js(runs.fin20k) < 10 && js(runs.cardsPage) < 10 && js(runs.target) < 10);
});

await test('DELETE /api/me efface tout', async () => {
  await call('POST', 'session', { key: alice.key, body: { cookie: 'sid=1' } });
  await call('POST', 'import', { key: alice.key, body: { upload_id: 'en-cours', part: 0, last: false, cards: synth(3) } });
  await call('POST', 'targets/save', { key: alice.key, body: { name: 'À effacer', items: [] } });
  const r = await call('DELETE', 'me', { key: alice.key });
  assert.deepEqual(r.json, { ok: true });
  for (const t of ['cards', 'tags', 'targets', 'refresh_staging', 'import_staging']) {
    assert.equal(rows(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`, alice.user.id)[0].n, 0, t);
  }
  assert.equal(rows('SELECT COUNT(*) AS n FROM users WHERE id = ?', alice.user.id)[0].n, 0);
  assert.equal((await call('GET', 'me', { key: alice.key })).status, 401);
  assert.equal((await call('GET', 'me', { key: bob.key })).status, 200, 'les autres comptes restent');
});

globalThis.fetch = realFetch;
console.log(`${results.length} tests`);
console.log('API OK');
