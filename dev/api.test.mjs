// Tests de l'API : appelle onRequest directement, D1 simulée en mémoire, jeu simulé (fetch remplacé).
//   node dev/api.test.mjs      → doit finir par « API OK »

import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
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

// Les tests reprennent les mêmes prénoms (Ana, Ben…) et l'inscription refuse un prénom déjà pris (2026-10-17) : l'ancien
// compte de ce nom est renommé avant.
async function signup(name, e = env) {
  if (name && e.DB && e.DB.sqlite) {
    try { e.DB.sqlite.prepare("UPDATE users SET name = name || ' #' || id WHERE name = ?").run(name); } catch (x) { /* base neuve : pas encore de table */ }
  }
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
  const columns = dflt.DB.sqlite.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  assert.ok(columns.includes('import_key_hash') && columns.includes('prefs'), columns.join(','));
});

await test('inscription : prénom déjà pris refusé, classeur jamais utilisé remplacé', async () => {
  const e = makeEnv();
  const first = await signup('Trykh4r', e);
  // Même prénom (casse, accents, espaces) d'un classeur jamais utilisé : remplacé, l'ancienne clé ne marche plus.
  const second = await signup('  trykh4r ', e);
  assert.equal((await call('GET', 'me', { key: first.key, e })).status, 401);
  assert.equal((await call('GET', 'me', { key: second.key, e })).status, 200);
  assert.equal(e.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  // Utilisé (une collection) : refusé, avec le moyen de retrouver son lien.
  await call('POST', 'targets/save', { key: second.key, body: { name: 'Continents', items: [{ title: 'Europe', status: 'ok' }] }, e });
  let r = await call('POST', 'account', { body: { code: 'invitation', name: 'TRYKH4R' }, e });
  assert.equal(r.status, 409);
  assert.match(r.json.error, /Il existe déjà un classeur « trykh4r »\..*lien personnel.*Réglages/);
  assert.equal((await call('GET', 'me', { key: second.key, e })).status, 200, 'le classeur existant ne doit pas bouger');
  // Accents : « Cléo » = « cleo » ; un favori créé suffit à dire le classeur utilisé.
  const cleo = await signup('Cléo', e);
  await call('POST', 'import-key', { key: cleo.key, e });
  r = await call('POST', 'account', { body: { code: 'invitation', name: 'cleo' }, e });
  assert.equal(r.status, 409);
  // Sans prénom, ou un autre prénom : pas de contrôle.
  assert.equal((await call('POST', 'account', { body: { code: 'invitation' }, e })).status, 201);
  assert.equal((await call('POST', 'account', { body: { code: 'invitation' }, e })).status, 201);
  assert.equal((await call('POST', 'account', { body: { code: 'invitation', name: 'Trykh4r bis' }, e })).status, 201);
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
  assert.equal(r.json.cards_rev, 0);
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

await test('préférences : {} par défaut, remplacement entier, 4 Ko, objet seulement, par compte', async () => {
  const kim = await signup('Kim');
  const lea = await signup('Léa');
  let r = await call('GET', 'me', { key: kim.key });
  assert.deepEqual(r.json.prefs, {});
  const prefs = { hidden_catalog: ['chiens', 'chats'], hide_catalog: true, autre: { n: 1 } };
  r = await call('PATCH', 'me', { key: kim.key, body: { prefs } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.prefs, prefs);
  assert.equal(r.json.user.name, 'Kim', 'le nom ne bouge pas');
  r = await call('GET', 'me', { key: kim.key });
  assert.deepEqual(r.json.prefs, prefs);
  assert.equal(r.json.user.name, 'Kim');
  // Remplacement entier (pas de fusion), et le nom seul ne touche pas aux préférences.
  r = await call('PATCH', 'me', { key: kim.key, body: { prefs: { hide_catalog: false } } });
  assert.deepEqual(r.json.prefs, { hide_catalog: false });
  r = await call('PATCH', 'me', { key: kim.key, body: { name: 'Kim B.' } });
  assert.equal(r.json.user.name, 'Kim B.');
  assert.deepEqual((await call('GET', 'me', { key: kim.key })).json.prefs, { hide_catalog: false });
  r = await call('PATCH', 'me', { key: kim.key, body: { name: 'Kim', prefs: {} } });
  assert.deepEqual([r.json.user.name, r.json.prefs], ['Kim', {}]);
  // Forme et taille.
  for (const bad of [[], null, 'texte', 3, true, ['a']]) {
    r = await call('PATCH', 'me', { key: kim.key, body: { prefs: bad } });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  r = await call('PATCH', 'me', { key: kim.key, body: { prefs: { x: 'y'.repeat(4096) } } });
  assert.equal(r.status, 413);
  assert.match(r.json.error, /4 Ko/);
  r = await call('PATCH', 'me', { key: kim.key, body: { prefs: { x: 'é'.repeat(2050) } } }); // 4 108 octets, 2 058 caractères
  assert.equal(r.status, 413);
  r = await call('PATCH', 'me', { key: kim.key, body: { prefs: { x: 'y'.repeat(4000) } } });
  assert.equal(r.status, 200);
  r = await call('PATCH', 'me', { key: kim.key, body: {} });
  assert.equal(r.status, 400);
  // Chaque compte a les siennes ; la clé d'import ne peut ni les lire ni les écrire.
  assert.deepEqual((await call('GET', 'me', { key: lea.key })).json.prefs, {});
  await call('PATCH', 'me', { key: lea.key, body: { prefs: { hide_catalog: true } } });
  assert.equal((await call('GET', 'me', { key: kim.key })).json.prefs.x.length, 4000);
  const importKey = (await call('POST', 'import-key', { key: kim.key })).json.import_key;
  assert.equal((await call('PATCH', 'me', { key: importKey, body: { prefs: { pirate: true } } })).status, 401);
  assert.equal((await call('GET', 'me', { key: importKey })).status, 401);
  assert.equal((await call('GET', 'me', { key: kim.key })).json.prefs.pirate, undefined);
  await call('DELETE', 'me', { key: kim.key });
  await call('DELETE', 'me', { key: lea.key });
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
    'shiny', 'starred', 'obtained_at', 'variants', 'tags'];
  for (const c of cards.cards) assert.deepEqual(Object.keys(c), keys);
  const byId = new Map(cards.cards.map((c) => [c.id, c]));
  const d = byId.get(dup.id);
  assert.equal(d.count, dup.n + 3);
  // Exemplaires par rareté et brillance (marché) : additionnés sur les trois entrées, clés dans l'ordre binaire.
  const want = {};
  for (const [k, n] of [[dup.r + (dup.s ? '*' : ''), dup.n], [dup.r + '*', 2], [dup.r, 1]]) want[k] = (want[k] || 0) + n;
  assert.deepEqual(d.variants, Object.fromEntries(Object.entries(want).sort()));
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
  r = await call('POST', 'tags/set', { key: alice.key, body: { card_id: a, tags: ['x'.repeat(61)] } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /dépasse 60 caractères/);
  r = await call('POST', 'tags/bulk', { key: alice.key, body: { card_ids: [a], add: ['x'.repeat(61)] } });
  assert.equal(r.status, 400);
  r = await call('POST', 'tags/rename', { key: alice.key, body: { from: 'Musique', to: 'x'.repeat(61) } });
  assert.equal(r.status, 400);
  r = await call('POST', 'tags/set', { key: alice.key, body: { card_id: a, tags: Array.from({ length: 31 }, (_, i) => `t${i}`) } });
  assert.equal(r.status, 400);
  r = await call('POST', 'tags/set', { key: alice.key, body: { card_id: 'inconnue', tags: ['x'] } });
  assert.equal(r.status, 404);
  r = await call('POST', 'tags/set', { key: alice.key, body: { card_id: a, tags: 'Musique' } });
  assert.equal(r.status, 400);
  r = await call('POST', 'tags/set', { key: alice.key, body: { card_id: a, tags: ['é'.repeat(60)] } });
  assert.equal(r.status, 200);
  // Étiquette à deux niveaux (« thème/sous-thème »), jusqu'à 60 caractères.
  const twoLevels = 'Culture et œuvres/Groupe de musique de rock alternatif fran';
  assert.equal(twoLevels.length, 59);
  r = await call('POST', 'tags/set', { key: alice.key, body: { card_id: a, tags: [twoLevels] } });
  assert.deepEqual(r.json.tags, [twoLevels]);
  r = await call('POST', 'tags/rename', { key: alice.key, body: { from: twoLevels, to: `${twoLevels}s` } });
  assert.equal(r.status, 200);
  r = await call('POST', 'tags/bulk', { key: alice.key, body: { card_ids: [b], add: [`${twoLevels}s`] } });
  assert.equal(r.status, 200);
  assert.equal(rows('SELECT COUNT(*) AS n FROM tags WHERE tag = ?', `${twoLevels}s`)[0].n, 2);
  await call('POST', 'tags/set', { key: alice.key, body: { card_id: b, tags: [] } });
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

  // Identifiant Wikidata facultatif : gardé s'il est valide, ignoré sinon, renvoyé par GET /api/targets.
  const withQid = [
    { title: 'Rihanna', status: 'ok', qid: 'Q36844' },
    { title: 'Mercure (planète)', status: 'ok', qid: 'Q308' },
    ...['Q0', 'q36844', 'Q', 'Q1234567890123', 'P31', ' Q42', 'Q42 ', 42, null].map((qid, i) => ({ title: `Mauvais ${i}`, qid })),
  ];
  r = await call('POST', 'targets/save', { key: alice.key, body: { id: 'qids', name: 'Avec Wikidata', items: withQid } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.target.items.slice(0, 2).map((x) => x.qid), ['Q36844', 'Q308']);
  assert.ok(r.json.target.items.slice(2).every((x) => !('qid' in x)));
  const listed = (await call('GET', 'targets', { key: alice.key })).json.targets.find((x) => x.id === 'qids');
  assert.deepEqual(listed.items[0], { title: 'Rihanna', description: null, image: null, status: 'ok', qid: 'Q36844' });
  assert.equal(listed.items.filter((x) => x.qid).length, 2);
  await call('POST', 'targets/delete', { key: alice.key, body: { id: 'qids' } });
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

await test('collections à compléter : une seule collection par catégorie de Wikipédia (source wp:)', async () => {
  const wes = await signup('Wes');
  const items = [{ title: 'Charolaise', status: 'ok' }];
  let r = await call('POST', 'targets/save', { key: wes.key, body: { name: 'Race bovine', items, source: 'wp:Race bovine' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const first = r.json.target;
  await new Promise((res) => setTimeout(res, 5));
  // Créée une seconde fois, sans id (deux onglets, deux appareils) : la même collection, remplacée.
  r = await call('POST', 'targets/save', { key: wes.key, body: { name: 'Races bovines', items: [...items, { title: 'Salers', status: 'ok' }], source: 'wp:Race bovine' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.target.id, first.id);
  assert.equal(r.json.target.created_at, first.created_at);
  assert.equal(r.json.target.name, 'Races bovines');
  assert.equal(r.json.target.items.length, 2);
  let list = (await call('GET', 'targets', { key: wes.key })).json.targets;
  assert.deepEqual(list.map((t) => [t.id, t.source]), [[first.id, 'wp:Race bovine']]);
  // Une autre catégorie : une autre collection ; les autres sources (wm:, catalog:, aucune) ne sont pas regroupées.
  r = await call('POST', 'targets/save', { key: wes.key, body: { name: 'Race bovine originaire de France', items, source: 'wp:Race bovine originaire de France' } });
  assert.notEqual(r.json.target.id, first.id);
  for (let i = 0; i < 2; i++) assert.equal((await call('POST', 'targets/save', { key: wes.key, body: { name: 'Vaches', items, source: 'wm:vache' } })).status, 200);
  for (let i = 0; i < 2; i++) assert.equal((await call('POST', 'targets/save', { key: wes.key, body: { name: 'Sans source', items } })).status, 200);
  // Un id envoyé reste la règle (création ou remplacement de celle-là).
  r = await call('POST', 'targets/save', { key: wes.key, body: { id: 'autre-rb', name: 'Race bovine bis', items, source: 'wp:Race bovine' } });
  assert.equal(r.json.target.id, 'autre-rb');
  // La même catégorie suivie par un autre compte : sa collection à lui.
  const zoe = await signup('Zoé');
  r = await call('POST', 'targets/save', { key: zoe.key, body: { name: 'Race bovine', items, source: 'wp:Race bovine' } });
  assert.notEqual(r.json.target.id, first.id);
  list = (await call('GET', 'targets', { key: wes.key })).json.targets;
  assert.equal(list.length, 7);
  assert.equal(list.filter((t) => t.source === 'wm:vache').length, 2);
  assert.equal(list.find((t) => t.id === first.id).name, 'Races bovines');
  // Sans id, c'est la plus ancienne de cette source qui est remplacée (ici la première, pas « autre-rb »).
  r = await call('POST', 'targets/save', { key: wes.key, body: { name: 'Race bovine', items, source: 'wp:Race bovine' } });
  assert.equal(r.json.target.id, first.id);
});

await test('collections à compléter : une seule collection par page de Wikipédia (source links:)', async () => {
  const yan = await signup('Yan');
  const items = [{ title: 'Rouge', status: 'ok', qid: 'Q900304', description: 'couleur primaire' }];
  let r = await call('POST', 'targets/save', { key: yan.key, body: { name: 'Noms de couleur', items, source: 'links:Liste de noms de couleur' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const first = r.json.target;
  assert.equal(first.source, 'links:Liste de noms de couleur');
  assert.deepEqual(first.items, [{ title: 'Rouge', description: 'couleur primaire', image: null, status: 'ok', qid: 'Q900304' }]);
  await new Promise((res) => setTimeout(res, 5));
  // Créée une seconde fois sans id (deux onglets) : la même, remplacée.
  r = await call('POST', 'targets/save', { key: yan.key, body: { name: 'Couleurs', items: [...items, { title: 'Bleu marine', status: 'ok' }], source: 'links:Liste de noms de couleur' } });
  assert.equal(r.json.target.id, first.id);
  assert.equal(r.json.target.created_at, first.created_at);
  assert.equal(r.json.target.items.length, 2);
  // Une autre page : une autre collection ; l'ancienne source « links » (sans « : », jadis le catalogue) n'est pas regroupée.
  r = await call('POST', 'targets/save', { key: yan.key, body: { name: 'Races bovines', items, source: 'links:Liste de races bovines' } });
  assert.notEqual(r.json.target.id, first.id);
  for (let i = 0; i < 2; i++) assert.equal((await call('POST', 'targets/save', { key: yan.key, body: { name: 'Ancienne', items, source: 'links' } })).status, 200);
  const list = (await call('GET', 'targets', { key: yan.key })).json.targets;
  // Ordre de la liste non garanti entre collections créées dans la même milliseconde : on compare les sources triées.
  assert.deepEqual(list.map((t) => t.source).sort(), ['links', 'links', 'links:Liste de noms de couleur', 'links:Liste de races bovines']);
  await call('DELETE', 'me', { key: yan.key });
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

await test("collection depuis une recherche du jeu (favori) : clé d'import sur cette route seulement, CORS, validation, rareté, quotas", async () => {
  const gus = await signup('Gus');
  const importKey = (await call('POST', 'import-key', { key: gus.key })).json.import_key;
  const game = { origin: 'https://www.wiki-masters.com' };
  const items = [
    { title: 'Vache', rarity: 'R', card_id: 'c-vache', category: 'mammifère domestique', image: 'https://upload.wikimedia.org/vache.jpg' },
    { title: 'Vache Highland', rarity: 'UR', card_id: 'c-highland', category: null, image: null },
    { title: 'Vache', rarity: 'R', card_id: 'c-vache' }, // relue (pages qui se chevauchent) : gardée une fois
    { title: 'Vache folle', rarity: 'C', card_id: 'c-folle', image: 'javascript:alert(1)', extra: 'ignoré' },
  ];
  // Clé d'import, depuis le jeu : collection créée, rareté du jeu gardée, catégorie en description, source wm:<recherche>.
  let r = await call('POST', 'targets/from-game', { key: importKey, headers: game, body: { name: ' Vaches ', query: 'vache', items } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://www.wiki-masters.com');
  const t = r.json.target;
  assert.deepEqual([t.name, t.source, t.count], ['Vaches', 'wm:vache', 3]);
  assert.ok(!('items' in t), 'réponse compacte (sans les éléments)');
  const listed = (await call('GET', 'targets', { key: gus.key })).json.targets.find((x) => x.id === t.id);
  assert.deepEqual(listed.items, [
    { title: 'Vache', description: 'mammifère domestique', image: 'https://upload.wikimedia.org/vache.jpg', status: 'ok', rarity: 'R' },
    { title: 'Vache Highland', description: null, image: null, status: 'ok', rarity: 'UR' },
    { title: 'Vache folle', description: null, image: null, status: 'ok', rarity: 'C' },
  ]);
  // La clé principale marche aussi ; toujours une nouvelle collection (un id envoyé est ignoré : rien n'est remplacé).
  r = await call('POST', 'targets/from-game', { key: gus.key, body: { id: t.id, name: 'Vaches 2', query: 'vache', items: items.slice(0, 1) } });
  assert.equal(r.status, 200);
  assert.notEqual(r.json.target.id, t.id);
  assert.equal((await call('GET', 'targets', { key: gus.key })).json.targets.length, 2);
  // La rareté passe aussi par targets/save (la page la garde quand on modifie la collection) ; inconnue = ignorée.
  r = await call('POST', 'targets/save', { key: gus.key, body: { id: t.id, name: 'Vaches', source: 'wm:vache',
    items: [{ title: 'Vache', status: 'ok', rarity: 'R' }, { title: 'Bœuf', status: 'ok', rarity: 'X' }] } });
  assert.deepEqual(r.json.target.items.map((x) => x.rarity ?? null), ['R', null]);
  // La clé d'import ne sert qu'à créer : ni lire, ni modifier, ni supprimer une collection (et pas de CORS ailleurs).
  for (const [m, p, body] of [['GET', 'targets'], ['POST', 'targets/save', { id: t.id, name: 'Pirate', items: [] }], ['POST', 'targets/delete', { id: t.id }]]) {
    r = await call(m, p, { key: importKey, body, headers: game });
    assert.equal(r.status, 401, `${m} ${p}`);
    assert.equal(r.headers.get('access-control-allow-origin'), null, `pas de CORS sur ${p}`);
  }
  assert.equal((await call('GET', 'targets', { key: gus.key })).json.targets.find((x) => x.id === t.id).name, 'Vaches');
  // CORS : préflight du jeu (avec ou sans www), pas pour un autre site ; les erreurs aussi.
  r = await call('OPTIONS', 'targets/from-game', { headers: { ...game, 'access-control-request-method': 'POST' } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://www.wiki-masters.com');
  assert.equal(r.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal(r.headers.get('access-control-allow-headers'), 'content-type, x-classeur-key');
  assert.match(r.headers.get('vary'), /Origin/);
  r = await call('OPTIONS', 'targets/from-game', { headers: { origin: 'https://wiki-masters.com' } });
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://wiki-masters.com');
  for (const origin of ['https://evil.example', 'http://wiki-masters.com']) {
    r = await call('OPTIONS', 'targets/from-game', { headers: { origin } });
    assert.equal(r.headers.get('access-control-allow-origin'), null, origin);
  }
  r = await call('POST', 'targets/from-game', { key: importKey, headers: { origin: 'https://evil.example' }, body: { name: 'X', query: 'x', items: [] } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  r = await call('POST', 'targets/from-game', { headers: game, body: { name: 'X', query: 'x', items: [] } });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://www.wiki-masters.com', 'les erreurs aussi');
  r = await call('OPTIONS', 'targets/save', { headers: game });
  assert.equal(r.status, 405);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  // Validation : 400 lisible, rien d'écrit.
  const ok = { title: 'A', rarity: 'C', card_id: 'a' };
  for (const [body, re] of [
    [{ name: 'X', query: '', items: [ok] }, /recherche/],
    [{ name: 'X', query: 'q'.repeat(101), items: [ok] }, /recherche/],
    [{ name: 'X', items: [ok] }, /recherche/],
    [{ name: '', query: 'x', items: [ok] }, /nom/],
    [{ name: 'x'.repeat(81), query: 'x', items: [ok] }, /nom/],
    [{ name: 'X', query: 'x', items: 'non' }, /liste/],
    [{ name: 'X', query: 'x', items: [] }, /Aucune carte/],
    [{ name: 'X', query: 'x', items: [{ ...ok, rarity: 'X' }] }, /rareté inconnue/],
    [{ name: 'X', query: 'x', items: [{ ...ok, rarity: undefined }] }, /rareté inconnue/],
    [{ name: 'X', query: 'x', items: [{ ...ok, card_id: 12 }] }, /card_id/],
    [{ name: 'X', query: 'x', items: [{ ...ok, title: '' }] }, /titre/],
    [{ name: 'X', query: 'x', items: [null] }, /invalide/],
    [{ name: 'X', query: 'x', items: Array.from({ length: 3001 }, (_, i) => ({ ...ok, card_id: `c${i}` })) }, /3000/],
  ]) {
    r = await call('POST', 'targets/from-game', { key: importKey, body });
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
    assert.match(r.json.error, re);
  }
  assert.equal((await call('GET', 'targets', { key: gus.key })).json.targets.length, 2);
  // Quotas de saveTarget : 3 000 cartes permises, 600 Ko par collection, 50 collections, 5 Mo en tout.
  const big = Array.from({ length: 3000 }, (_, i) => ({ title: `Article ${i}`, rarity: 'C', card_id: `c${i}` }));
  r = await call('POST', 'targets/from-game', { key: importKey, body: { name: 'Grande', query: 'article', items: big } });
  assert.deepEqual([r.status, r.json.target.count], [200, 3000]);
  // 3 000 cartes avec leurs images dépassent 600 Ko : rangées sans les images (la page retrouve les vignettes).
  const pictured = big.map((x) => ({ ...x, image: `https://upload.wikimedia.org/wikipedia/commons/thumb/${'x'.repeat(200)}/${x.card_id}.jpg` }));
  r = await call('POST', 'targets/from-game', { key: importKey, body: { name: 'Avec images', query: 'article', items: pictured } });
  assert.deepEqual([r.status, r.json.target.count], [200, 3000], JSON.stringify(r.json));
  const stored = (await call('GET', 'targets', { key: gus.key })).json.targets.find((x) => x.id === r.json.target.id);
  assert.ok(stored.items.every((x) => x.image === null && x.rarity === 'C'));
  await call('POST', 'targets/delete', { key: gus.key, body: { id: r.json.target.id } });
  const heavy = big.slice(0, 1000).map((x) => ({ ...x, category: 'd'.repeat(500) }));
  r = await call('POST', 'targets/from-game', { key: importKey, body: { name: 'Trop', query: 'article', items: [...heavy, ...big.slice(1000, 1100).map((x) => ({ ...x, category: 'd'.repeat(500) }))] } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /600 Ko/);
  for (let i = 3; i < 50; i++) {
    r = await call('POST', 'targets/from-game', { key: importKey, body: { name: `C${i}`, query: 'x', items: [ok] } });
    assert.equal(r.status, 200, `collection ${i}`);
  }
  r = await call('POST', 'targets/from-game', { key: importKey, body: { name: 'La 51e', query: 'x', items: [ok] } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /50 collections/);
  await call('DELETE', 'me', { key: gus.key });
  const hal = await signup('Hal');
  for (let i = 0; i < 9; i++) {
    r = await call('POST', 'targets/from-game', { key: hal.key, body: { name: `Lourde ${i}`, query: 'article', items: heavy } });
    assert.equal(r.status, 200, `collection lourde ${i}`);
  }
  r = await call('POST', 'targets/from-game', { key: hal.key, body: { name: 'Lourde 9', query: 'article', items: heavy } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /5 Mo/);
  await call('DELETE', 'me', { key: hal.key });
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

// Jeu simulé : stats + pages de 50 entrées (sort=added : de la plus récente à la plus ancienne) ; options pour
// Set-Cookie, statuts d'erreur (corps JSON), réponses brutes [statut, corps, type] (redirection, page HTML), panne réseau.
function mockGame(entries, { stats, setCookie = {}, status = {}, raw = {}, down = false } = {}) {
  const calls = [];
  const pages = [];
  const added = [];
  const recent = [...entries].sort((a, b) => (a.obtained_at < b.obtained_at ? 1 : a.obtained_at > b.obtained_at ? -1 : 0));
  for (let p = 0; p * 50 <= entries.length; p++) {
    pages.push(JSON.stringify({ collection: entries.slice(p * 50, p * 50 + 50) }));
    added.push(JSON.stringify({ collection: recent.slice(p * 50, p * 50 + 50) }));
  }
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
      : ((u.searchParams.get('sort') === 'added' ? added : pages)[page] ?? '{"collection":[]}');
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
  // complete : les 2 cartes qui manquent par rapport à totalUnique sont les 2 invalides (le jeu les compte, le classeur
  // ne peut pas les ranger) : relancer n'y changerait rien.
  assert.deepEqual(r.json, { done: true, count: 2056, new_ids: [], complete: true, skipped: 2 });
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
  assert.deepEqual(r.json, { done: true, count: 2057, new_ids: ['c5000'], complete: true, skipped: 2 });

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
  r = await call('POST', 'refresh', { key: bob.key, body: { page: 0, full: true }, e: { ...env, DB: full } });
  assert.equal(r.status, 503);
  assert.equal(await storedCookie(bob), 'sid=apres');
  globalThis.fetch = realFetch;
});

// --- Synchro rapide (seulement les nouveautés) ------------------------------------------------------------------

await test('import : synchro rapide du favori (state, delta additionné, compteurs du jeu contrôlés, needs_full et sa raison)', async () => {
  const dave = await signup('Dave');
  const state = async () => (await call('POST', 'import', { key: dave.key, body: { mode: 'state' } })).json;
  const syncRow = () => JSON.parse(rows('SELECT sync_state FROM users WHERE id = ?', dave.user.id)[0].sync_state);
  assert.deepEqual(await state(), { quick: false, last_at: null, full_at: null });
  // Sans lecture complète d'abord : pas de synchro rapide.
  let r = await call('POST', 'import', { key: dave.key, body: { mode: 'delta', cards: [], stats: { total: 0, totalUnique: 0 }, rows: 0, copies: 0 } });
  assert.deepEqual(r.json, { needs_full: true, reason: 'state' });
  // Lecture complète : 30 cartes (un exemplaire chacune), compteurs, exemplaires lus et date du plus récent gardés.
  const base30 = synth(30);
  const rc = (cards) => cards.reduce((o, c) => ({ ...o, [c.rarity]: (o[c.rarity] || 0) + c.count }), {});
  r = await call('POST', 'import', { key: dave.key, body: { upload_id: 'complet', part: 0, last: true, cards: base30, stats: { total: 30, totalUnique: 30, rarityCounts: rc(base30) }, rows: 30, copies: 30, last_at: '2026-10-15T09:00:00.000Z', source: 'favori' } });
  assert.deepEqual([r.json.count, r.json.complete], [30, true]);
  let st = await state();
  assert.equal(st.quick, true);
  assert.equal(st.last_at, '2026-10-15T09:00:00.000Z');
  assert.deepEqual([syncRow().unit, syncRow().count, syncRow().invalid], ['both', 30, 0], 'autant de lignes que d\'exemplaires : unité ambiguë');
  // Deux nouveautés : une carte nouvelle, un exemplaire (brillant) de plus d'une carte déjà là.
  const before = (await call('GET', 'cards', { key: dave.key })).json.cards.find((c) => c.id === base30[0].id);
  const fresh = [{ ...carte(owned[40], 'nouvelle-carte'), count: 1, obtained_at: '2026-10-15T10:00:00.000Z' },
    { ...base30[0], count: 1, shiny: true, obtained_at: '2026-10-15T10:00:00.000Z' }];
  let game = { total: 32, totalUnique: 31, rarityCounts: rc([...base30, ...fresh]) };
  const writes = countCardWrites(true);
  r = await call('POST', 'import', { key: dave.key, body: { mode: 'delta', cards: fresh, stats: game, rows: 2, copies: 2, last_at: '2026-10-15T10:00:00.000Z' } });
  assert.deepEqual(r.json, { count: 31, new_ids: ['nouvelle-carte'], complete: true, skipped: 0, quick: true });
  assert.equal(writes(), 2, 'deux écritures seulement');
  countCardWrites(false);
  const cards = (await call('GET', 'cards', { key: dave.key })).json.cards;
  const after = cards.find((c) => c.id === base30[0].id);
  assert.equal(after.count, before.count + 1);
  assert.equal(after.shiny, true);
  assert.equal(after.obtained_at, before.obtained_at, 'la plus ancienne date reste');
  assert.equal(after.title, before.title);
  const added = cards.find((c) => c.id === 'nouvelle-carte');
  assert.equal(added.count, 1);
  assert.equal(added.starred, owned[40].f);
  st = await state();
  assert.equal(st.last_at, '2026-10-15T10:00:00.000Z');
  assert.equal((await call('GET', 'me', { key: dave.key })).json.card_count, 31, 'nombre de cartes tenu à jour par la synchro');
  // Rien de nouveau, compteurs inchangés : rien d'écrit dans les cartes, synchro datée.
  r = await call('POST', 'import', { key: dave.key, body: { mode: 'delta', cards: [], stats: game, rows: 0, copies: 0 } });
  assert.deepEqual(r.json, { count: 31, new_ids: [], complete: true, skipped: 0, quick: true });
  assert.equal((await state()).last_at, '2026-10-15T10:00:00.000Z', 'last_at ne recule pas');
  const snapshot = JSON.stringify(rows('SELECT * FROM cards WHERE user_id = ? ORDER BY card_id', dave.user.id));
  const refused = async (body, reason, label) => {
    const res = await call('POST', 'import', { key: dave.key, body: { mode: 'delta', cards: [], rows: 0, copies: 0, ...body } });
    assert.deepEqual(res.json, { needs_full: true, reason }, label);
  };
  // Une carte partie (vente, enchère) : les compteurs ne collent plus.
  await refused({ stats: { ...game, total: 31, totalUnique: 30 } }, 'counts', 'carte partie');
  // Une vente et un achat de même rareté : total inchangé, mais une nouveauté lue.
  const other = { ...carte(owned[41], 'autre-carte'), count: 1 };
  await refused({ cards: [other], rows: 1, copies: 1, stats: game }, 'counts', 'vente + achat');
  // Un exemplaire ajouté à une carte déjà là sans nouvelle entrée (total +1, rien lu).
  await refused({ stats: { ...game, total: 33, rarityCounts: rc([...base30, ...fresh, base30[1]]) } }, 'counts', 'pile sans nouvelle entrée');
  // Échange 1 contre 1 entre raretés différentes, la carte reçue datée d'avant la dernière synchro (rien de nouveau à
  // lire) : total et totalUnique inchangés, mais rarityCounts a bougé (une C de moins, une R de plus).
  const swapped = { ...game.rarityCounts, C: game.rarityCounts.C - 1, R: (game.rarityCounts.R || 0) + 1 };
  await refused({ stats: { ...game, rarityCounts: swapped } }, 'counts', 'échange entre raretés');
  // rarityCounts qui ne somme pas à total (le jeu compterait autre chose) : pas comparé.
  r = await call('POST', 'import', { key: dave.key, body: { mode: 'delta', cards: [], rows: 0, copies: 0, stats: { ...game, rarityCounts: { C: 1 } } } });
  assert.equal(r.json.quick, true);
  game = { ...game, rarityCounts: { C: 1 } };
  // Unité ambiguë (autant de lignes que d'exemplaires à la lecture complète) : une ligne de 2 exemplaires est refusée.
  await refused({ cards: [{ ...other, count: 2 }], rows: 1, copies: 2, stats: { ...game, total: 34, totalUnique: 32 } }, 'counts', 'pile en unité ambiguë');
  // Carte invalide parmi les nouveautés, ou écartée par le favori (copies ≠ celles reçues, ignored > 0).
  await refused({ cards: [{ id: 'x', title: '', rarity: 'C', count: 1 }], rows: 1, copies: 1, stats: { ...game, total: 33, totalUnique: 32 } }, 'invalid', 'carte invalide');
  await refused({ cards: [other], rows: 2, copies: 2, stats: { ...game, total: 34, totalUnique: 33 } }, 'invalid', 'entrée écartée par un ancien favori');
  await refused({ cards: [other], rows: 1, copies: 1, ignored: 1, stats: { ...game, total: 33, totalUnique: 32 } }, 'invalid', 'ignored');
  // Au-delà de 20 000 cartes, la synchro rapide ne passe pas (la relecture complète refusera le classeur).
  const real = rows('SELECT sync_state FROM users WHERE id = ?', dave.user.id)[0].sync_state;
  env.DB.sqlite.prepare("UPDATE users SET sync_state = json_set(sync_state, '$.count', 20000) WHERE id = ?").run(dave.user.id);
  await refused({ cards: [other], rows: 1, copies: 1, stats: { ...game, total: 33, totalUnique: 20001 } }, 'max_cards', '20 000 cartes');
  env.DB.sqlite.prepare('UPDATE users SET sync_state = ? WHERE id = ?').run(real, dave.user.id);
  assert.equal(JSON.stringify(rows('SELECT * FROM cards WHERE user_id = ? ORDER BY card_id', dave.user.id)), snapshot, 'rien d\'écrit');
  // Compteurs du jeu donnés en texte : lus comme des nombres.
  r = await call('POST', 'import', { key: dave.key, body: { mode: 'delta', cards: [], rows: 0, copies: 0, stats: { total: '32', totalUnique: ' 31 ', rarityCounts: { C: '1' } } } });
  assert.equal(r.json.quick, true);
  // Requêtes mal formées.
  for (const body of [{ mode: 'autre' }, { mode: 'delta', stats: {}, rows: 0, copies: 0 }, { mode: 'delta', cards: [], rows: -1, copies: 0 },
    { mode: 'delta', cards: [], rows: 0, copies: 0, last_at: 'hier' }, { cards: [], last_at: 12 }, { cards: [], rows: 'x' }, { cards: [], ignored: -1 }]) {
    r = await call('POST', 'import', { key: dave.key, body });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  // La clé d'import du favori suffit (state et delta passent par /api/import).
  const imp = (await call('POST', 'import-key', { key: dave.key })).json.import_key;
  r = await call('POST', 'import', { key: imp, body: { mode: 'state' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.quick, true);
  // Deux synchros rapides en même temps (deux onglets, favori + rafraîchissement), avec la latence d'un aller-retour D1
  // entre la lecture de l'état et l'écriture : une seule passe, l'autre demande une relecture complète.
  const slow = { ...env, DB: { prepare: (sql) => env.DB.prepare(sql), batch: async (sts) => { await new Promise((ok) => setTimeout(ok, 5)); return env.DB.batch(sts); } } };
  const twin = { mode: 'delta', cards: [{ ...other, obtained_at: '2026-10-15T11:00:00.000Z' }], rows: 1, copies: 1, last_at: '2026-10-15T11:00:00.000Z', stats: { ...game, total: 33, totalUnique: 32 } };
  const pair = await Promise.all([0, 1].map(() => call('POST', 'import', { key: imp, body: twin, e: slow })));
  assert.deepEqual(pair.map((x) => x.json.quick === true ? 'ok' : x.json.reason).sort(), ['ok', 'race'], JSON.stringify(pair.map((x) => x.json)));
  assert.equal((await call('GET', 'cards', { key: dave.key })).json.cards.find((c) => c.id === 'autre-carte').count, 1, 'nouveauté comptée une fois');
  assert.equal(syncRow().count, 32);
  // Relecture complète demandée (PATCH /api/me {force_full}, clé principale) : la synchro rapide n'est plus armée.
  assert.equal((await call('GET', 'me', { key: dave.key })).json.next_full, false);
  assert.equal((await call('PATCH', 'me', { key: imp, body: { force_full: true } })).status, 401, 'pas avec la clé du favori');
  assert.equal((await call('PATCH', 'me', { key: dave.key, body: { force_full: 1 } })).status, 400);
  r = await call('PATCH', 'me', { key: dave.key, body: { force_full: true } });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', 'me', { key: dave.key })).json.next_full, true);
  assert.equal((await state()).quick, false);
  await refused({ stats: { ...game, total: 33, totalUnique: 32 } }, 'state', 'relecture complète demandée');
  // Plus d'une semaine sans lecture complète : synchro rapide refusée.
  env.DB.sqlite.prepare("UPDATE users SET sync_state = json_set(sync_state, '$.full_at', '2026-01-01T00:00:00.000Z') WHERE id = ?").run(dave.user.id);
  assert.equal((await state()).quick, false);
  await refused({ stats: { ...game, total: 33, totalUnique: 32 } }, 'state', 'plus d\'une semaine');
});

await test('import complet : synchro rapide armée seulement si la lecture est complète, unité de total apprise, rareté la plus haute', async () => {
  const fay = await signup('Fay');
  const quick = async () => (await call('POST', 'import', { key: fay.key, body: { mode: 'state' } })).json.quick;
  const unit = () => JSON.parse(rows('SELECT sync_state FROM users WHERE id = ?', fay.user.id)[0].sync_state).unit;
  const full = (cards, extra) => call('POST', 'import', { key: fay.key, body: { upload_id: `u${++uploads}`, part: 0, last: true, cards, last_at: '2026-10-15T09:00:00.000Z', ...extra } });
  const cards = synth(40);
  // Lecture tronquée (une page vide passagère) : le classeur est remplacé par ce qui a été lu, mais rien n'arme la
  // synchro rapide, et la suivante relit tout.
  let r = await full(cards.slice(0, 30), { stats: { total: 40, totalUnique: 40 }, rows: 30, copies: 30 });
  assert.deepEqual([r.json.count, r.json.complete], [30, false]);
  assert.equal(await quick(), false);
  // Même nombre de lignes, mais une carte lue deux fois et une jamais (pagination instable) : incomplète aussi.
  r = await full(cards.slice(0, 39), { stats: { total: 40, totalUnique: 40 }, rows: 40, copies: 40 });
  assert.deepEqual([r.json.complete, await quick()], [false, false]);
  // Complète, avec 2 cartes que le favori n'a pas pu lire (ignored) et une que le serveur refuse : elles comptent dans
  // totalUnique, la lecture est complète et armée (relancer n'y changerait rien).
  r = await full([...cards.slice(0, 37), { ...cards[37], obtained_at: 'hier' }], { stats: { total: 40, totalUnique: 40 }, rows: 40, copies: 40, ignored: 2 });
  assert.deepEqual([r.json.count, r.json.complete, r.json.skipped, await quick(), unit()], [37, true, 1, true, 'both']);
  // total = exemplaires (une pile de 3) : unité « copies », une ligne de 2 exemplaires passe en synchro rapide.
  const piled = [{ ...cards[0], count: 3 }, ...cards.slice(1, 40)];
  r = await full(piled, { stats: { total: 42, totalUnique: 40 }, rows: 40, copies: 42 });
  assert.deepEqual([r.json.complete, await quick(), unit()], [true, true, 'copies']);
  r = await call('POST', 'import', { key: fay.key, body: { mode: 'delta', cards: [{ ...cards[1], count: 2, obtained_at: '2026-10-16T00:00:00.000Z' }], rows: 1, copies: 2, stats: { total: 44, totalUnique: 40 } } });
  assert.equal(r.json.quick, true, JSON.stringify(r.json));
  assert.equal((await call('GET', 'cards', { key: fay.key })).json.cards.find((c) => c.id === cards[1].id).count, 3);
  // Unité « copies » : un exemplaire ajouté à une pile, date inchangée (rien à lire) → refusé ; avec la date remise à
  // neuf (la ligne relue avec ses 2 exemplaires, total +1) → refusé aussi (pas d'addition fausse).
  r = await call('POST', 'import', { key: fay.key, body: { mode: 'delta', cards: [], rows: 0, copies: 0, stats: { total: 45, totalUnique: 40 } } });
  assert.deepEqual(r.json, { needs_full: true, reason: 'counts' });
  r = await call('POST', 'import', { key: fay.key, body: { mode: 'delta', cards: [{ ...cards[2], count: 2, obtained_at: '2026-10-17T00:00:00.000Z' }], rows: 1, copies: 2, stats: { total: 45, totalUnique: 40 } } });
  assert.deepEqual(r.json, { needs_full: true, reason: 'counts' });
  // total = lignes alors que des piles existent : la synchro rapide ne verrait pas un exemplaire ajouté à une pile.
  r = await full(piled, { stats: { total: 40, totalUnique: 40 }, rows: 40, copies: 42 });
  assert.deepEqual([r.json.complete, await quick(), unit()], [true, false, 'rows']);
  // Ni l'un ni l'autre : pas armée.
  r = await full(piled, { stats: { total: 41, totalUnique: 40 }, rows: 40, copies: 42 });
  assert.deepEqual([r.json.complete, await quick(), unit()], [true, false, null]);
  // Sans exemplaires lus envoyés (cartes regroupées d'un autre client) : comptés sur les cartes reçues.
  r = await full(cards, { stats: { total: 40, totalUnique: 40 } });
  assert.deepEqual([await quick(), unit()], [true, 'both']);

  // Rareté d'une carte possédée en plusieurs raretés : la plus haute (C < PC < R < SR < UR < L), pas la plus grande
  // en texte (« R » > « L »), à l'import complet comme en synchro rapide.
  const one = (id, rarity, eid, at) => ({ id: eid, card_id: id, count: 1, obtained_at: at, card: { id, wikipedia_title: `Carte ${id}`, rarity } });
  r = await call('POST', 'import', { key: fay.key, body: { collection: [one('m1', 'L', 'a', '2026-10-01T00:00:00.000Z'), one('m1', 'R', 'b', '2026-10-01T00:00:00.000Z'),
    one('m2', 'UR', 'c', '2026-10-01T00:00:00.000Z'), one('m2', 'L', 'd', '2026-10-01T00:00:00.000Z'), one('m3', 'R', 'e', '2026-10-02T00:00:00.000Z')],
  stats: { total: 5, totalUnique: 3, rarityCounts: { L: 2, R: 2, UR: 1 } } } });
  assert.deepEqual([r.json.count, r.json.complete, await quick(), unit()], [3, true, true, 'both']);
  let got = Object.fromEntries((await call('GET', 'cards', { key: fay.key })).json.cards.map((c) => [c.id, c.rarity]));
  assert.deepEqual(got, { m1: 'L', m2: 'L', m3: 'R' });
  r = await call('POST', 'import', { key: fay.key, body: { mode: 'delta', cards: [{ id: 'm3', title: 'Carte m3', rarity: 'SR', count: 1, obtained_at: '2026-10-03T00:00:00.000Z' }], rows: 1, copies: 1, stats: { total: 6, totalUnique: 3, rarityCounts: { L: 2, R: 2, UR: 1, SR: 1 } } } });
  assert.equal(r.json.quick, true, JSON.stringify(r.json));
  r = await call('POST', 'import', { key: fay.key, body: { mode: 'delta', cards: [{ id: 'm1', title: 'Carte m1', rarity: 'C', count: 1, obtained_at: '2026-10-04T00:00:00.000Z' }], rows: 1, copies: 1, stats: { total: 7, totalUnique: 3, rarityCounts: { L: 2, R: 2, UR: 1, SR: 1, C: 1 } } } });
  assert.equal(r.json.quick, true, JSON.stringify(r.json));
  got = Object.fromEntries((await call('GET', 'cards', { key: fay.key })).json.cards.map((c) => [c.id, [c.rarity, c.count]]));
  assert.deepEqual(got, { m1: ['L', 3], m2: ['L', 2], m3: ['SR', 2] });
  await call('DELETE', 'me', { key: fay.key });
});

await test('synchro rapide : plan de SQLite (jamais toute la collection : ni COUNT(*), ni NOT IN sur les cartes du compte)', async () => {
  const gus = await signup('Gus');
  await call('POST', 'import', { key: gus.key, body: { cards: mini(50), stats: { total: 50, totalUnique: 50 }, rows: 50, copies: 50, last_at: '2026-10-15T09:00:00.000Z' } });
  const seen = [];
  const spy = { ...env, DB: { prepare: (sql) => { seen.push(sql); return env.DB.prepare(sql); }, batch: (s) => env.DB.batch(s) } };
  const r = await call('POST', 'import', { e: spy, key: gus.key, body: { mode: 'delta', cards: mini(2, 50), rows: 2, copies: 2, stats: { total: 52, totalUnique: 52 }, last_at: '2026-10-16T09:00:00.000Z' } });
  assert.equal(r.json.quick, true, JSON.stringify(r.json));
  await call('GET', 'me', { e: spy, key: gus.key });
  // Une recherche des cartes du compte sans card_id ni rev = un parcours de toute la collection (une ligne lue par carte).
  const scans = seen.filter((sql) => /^\s*(SELECT|WITH|UPDATE|INSERT|DELETE)\b/i.test(sql)).flatMap((sql) => env.DB.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((x) => x.detail))
    .filter((l) => /^(SCAN|SEARCH) (cards|c)\b/.test(l) && !/card_id=\?|rev[=>]\?/.test(l));
  assert.deepEqual(scans, [], seen.join('\n---\n'));
  assert.ok(!seen.some((s) => /COUNT\(\*\) AS n FROM cards/.test(s)), 'GET /api/me ne compte plus les cartes');
  await call('DELETE', 'me', { key: gus.key });
});

await test('refresh : synchro rapide (sort=added, arrêt à la dernière synchro), relecture complète si une carte est partie', async () => {
  const e3 = makeEnv({ REFRESH_PAUSE_MS: '0' });
  const erin = await signup('Erin', e3);
  await call('POST', 'session', { key: erin.key, body: { cookie: 'sid=erin' }, e: e3 });
  const at = (i) => `2026-10-${String(1 + Math.floor(i / 24)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00.000Z`;
  const entries = base.slice(0, 120).map((c, i) => rawEntry(c, { obtained_at: at(i) }));
  // Première fois : lecture complète (aucune synchro connue).
  const rev = async () => (await call('GET', 'me', { key: erin.key, e: e3 })).json.cards_rev;
  let calls = mockGame(entries);
  let r = await call('POST', 'refresh', { key: erin.key, body: {}, e: e3 });
  assert.equal(r.json.done, true);
  assert.equal(r.json.count, 120);
  assert.ok(!calls.some((c) => c.url.includes('sort=added')));
  assert.equal(await rev(), 1);
  // Trois nouveautés : deux cartes nouvelles, un exemplaire de plus d'une carte déjà là (entrée à part).
  const more = [...entries,
    rawEntry(base[120], { obtained_at: '2026-10-20T10:00:00.000Z' }),
    rawEntry(base[121], { obtained_at: '2026-10-20T11:00:00.000Z' }),
    rawEntry(base[5], { id: 'second-exemplaire', count: 1, obtained_at: '2026-10-20T12:00:00.000Z' })];
  calls = mockGame(more);
  r = await call('POST', 'refresh', { key: erin.key, body: {}, e: e3 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.quick, true);
  assert.equal(r.json.count, 122);
  assert.deepEqual([...r.json.new_ids].sort(), [base[120].id, base[121].id].sort());
  assert.deepEqual(calls.map((c) => c.url), [
    'https://www.wiki-masters.com/api/my-collection/stats?sort=rarity',
    'https://www.wiki-masters.com/api/my-collection?sort=added&page=0&stats=0',
  ]);
  const five = (await call('GET', 'cards', { key: erin.key, e: e3 })).json.cards.find((c) => c.id === base[5].id);
  assert.equal(five.count, base[5].n + 1);
  assert.equal(await rev(), 2);
  // Une carte vendue entre-temps : contrôle des compteurs en échec → relecture complète dans le même appel.
  const sold = more.filter((e) => e.card_id !== base[7].id);
  calls = mockGame(sold);
  r = await call('POST', 'refresh', { key: erin.key, body: {}, e: e3 });
  assert.equal(r.json.done, true);
  assert.equal(r.json.quick, undefined);
  assert.equal(r.json.count, 121);
  assert.ok(calls.some((c) => c.url.includes('sort=added')) && calls.some((c) => c.url.includes('sort=rarity&page=0')));
  assert.equal(await rev(), 3);
  const d = (await call('GET', 'cards?since=2', { key: erin.key, e: e3 })).json;
  assert.deepEqual([d.delta, d.cards, d.gone], [true, [], [base[7].id]]);
  // full: true → jamais de synchro rapide. Même collection : la révision ne bouge pas.
  calls = mockGame(sold);
  r = await call('POST', 'refresh', { key: erin.key, body: { full: true }, e: e3 });
  assert.equal(r.json.count, 121);
  assert.ok(!calls.some((c) => c.url.includes('sort=added')));
  assert.equal(await rev(), 3);
  // Un tri que le jeu ne respecterait pas (ordre croissant) : refusé, relecture complète.
  const late = [...sold, rawEntry(base[122], { obtained_at: '2026-10-21T10:00:00.000Z' })];
  calls = mockGame(late);
  const realMock = globalThis.fetch;
  globalThis.fetch = async (url, init) => realMock(String(url).replace('sort=added', 'sort=rarity'), init);
  r = await call('POST', 'refresh', { key: erin.key, body: {}, e: e3 });
  assert.equal(r.json.count, 122);
  assert.equal(r.json.quick, undefined);
  globalThis.fetch = realFetch;
  assert.equal(await rev(), 4);
});

await test('refresh : synchro rapide ratée → lecture complète dans le même appel (pages comptées), carte la plus récente partie, last_at, limite de lectures, course avec le favori', async () => {
  const e5 = makeEnv({ REFRESH_PAUSE_MS: '0' });
  const hal = await signup('Hal', e5);
  await call('POST', 'session', { key: hal.key, body: { cookie: 'sid=hal' }, e: e5 });
  const at = (i) => new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString();
  const entry = (i, extra = {}) => ({ ...tiny(i), obtained_at: at(i), ...extra });
  const state = () => JSON.parse(e5.DB.sqlite.prepare('SELECT sync_state FROM users WHERE id = ?').get(hal.user.id).sync_state);
  const expired = async () => (await call('GET', 'me', { key: hal.key, e: e5 })).json.session.expired;
  const cardOf = async (id) => (await call('GET', 'cards', { key: hal.key, e: e5 })).json.cards.find((c) => c.id === id);
  const run = async (body = {}) => {
    let r = await call('POST', 'refresh', { key: hal.key, body, e: e5 });
    while (r.status === 200 && !r.json.done) r = await call('POST', 'refresh', { key: hal.key, body: { page: r.json.next_page }, e: e5 });
    return r;
  };
  let entries = Array.from({ length: 120 }, (_, i) => entry(i));
  let calls = mockGame(entries);
  let r = await run();
  assert.deepEqual([r.json.count, r.json.complete, state().unit, state().last_at], [120, true, 'both', at(119)]);

  // Le tri « added » en erreur (400) ou sans JSON : relecture complète dans le même appel, session intacte.
  entries = [...entries, entry(500)];
  for (const [status, body, type] of [[400, '{"error":"tri inconnu"}', 'application/json'], [200, '<html></html>', 'text/html']]) {
    calls = mockGame(entries);
    const inner = globalThis.fetch;
    globalThis.fetch = async (url, init) => (String(url).includes('sort=added')
      ? new Response(body, { status, headers: { 'content-type': type } }) : inner(url, init));
    r = await run();
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.done, r.json.quick, r.json.count], [true, undefined, 121]);
  }
  assert.equal(await expired(), false);
  assert.equal(state().last_at, at(500));

  // Échange 1 contre 1 de même rareté, la carte reçue datée d'avant la dernière synchro : les compteurs ne bougent pas,
  // mais la carte donnée était la plus récente de la dernière synchro (last_at) : introuvable → relecture complète.
  entries = [...entries.filter((e) => e.card_id !== 'c500'), entry(700, { obtained_at: at(5) })];
  calls = mockGame(entries);
  r = await run();
  assert.deepEqual([r.json.quick, r.json.count, r.json.new_ids], [undefined, 121, ['c700']]);
  assert.ok(calls.some((c) => c.url.includes('sort=rarity')));
  assert.equal(await cardOf('c500'), undefined);

  // Le plus récent exemplaire est invalide (rareté inconnue) : last_at le prend quand même ; la synchro suivante, sans
  // nouveauté, est rapide (2 requêtes au jeu) au lieu de tout relire à chaque fois.
  entries = [...entries, entry(600, { card: { id: 'c600', wikipedia_title: 'Rareté inconnue', rarity: 'M' } })];
  mockGame(entries);
  r = await run();
  assert.deepEqual([r.json.quick, r.json.skipped, r.json.complete, state().last_at, state().invalid], [undefined, 1, true, at(600), 1]);
  calls = mockGame(entries);
  r = await run();
  assert.deepEqual([r.json.quick, r.json.count, calls.length], [true, 121, 2]);

  // Plus de 450 nouveautés : la synchro rapide lit 9 pages, échoue, et l'appel ne lit qu'une page de la lecture complète
  // (10 pages décodées au plus par appel) ; next_page = la page suivante réellement.
  for (let i = 0; i < 460; i++) entries.push(entry(1000 + i));
  calls = mockGame(entries);
  r = await call('POST', 'refresh', { key: hal.key, body: {}, e: e5 });
  assert.deepEqual([r.json.done, r.json.next_page, r.json.fetched], [false, 1, 50]);
  assert.deepEqual([calls.length, calls.filter((c) => c.url.includes('sort=added')).length], [11, 9]);
  while (!r.json.done) r = await call('POST', 'refresh', { key: hal.key, body: { page: r.json.next_page }, e: e5 });
  assert.deepEqual([r.json.count, r.json.complete], [581, true]);

  // 403 en JSON avec code « automation_limit » (limite de lectures automatiques du jeu) : message à part, 429, la session
  // n'est pas marquée expirée ; pendant la synchro rapide, tout s'arrête aussi (pas de relecture complète derrière).
  for (const [page, n] of [[1, null], [0, 2]]) {
    calls = mockGame(entries, { raw: { [page]: [403, '{"code":"automation_limit","error":"Trop de requêtes automatisées"}', 'application/json'] } });
    r = await call('POST', 'refresh', { key: hal.key, body: { full: page === 1 }, e: e5 });
    assert.deepEqual([r.status, r.json], [429, { error: 'Le jeu limite les lectures automatiques : réessaie plus tard.' }]);
    if (n !== null) assert.equal(calls.length, n);
    assert.equal(await expired(), false);
  }

  // Le favori fait sa synchro rapide pendant que le rafraîchissement lit le jeu (après son authentification) : la
  // nouveauté ne doit compter qu'une fois. Le rafraîchissement voit que l'état a changé et relit tout.
  entries = [...entries, entry(3, { id: 'e3-bis', obtained_at: at(5000) })];
  const stats = { total: entries.length, totalUnique: new Set(entries.map((e) => e.card_id)).size };
  mockGame(entries);
  const inner = globalThis.fetch;
  let favori = null;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('sort=added') && !favori) {
      favori = (await call('POST', 'import', { key: hal.key, e: e5, body: { mode: 'delta', cards: [{ id: 'c3', title: 'Carte 3', rarity: 'C', count: 1, obtained_at: at(5000) }], rows: 1, copies: 1, stats, last_at: at(5000) } })).json;
    }
    return inner(url, init);
  };
  r = await run();
  assert.equal(favori.quick, true, JSON.stringify(favori));
  assert.deepEqual([r.json.done, r.json.quick, r.json.count], [true, undefined, 581]);
  assert.equal((await cardOf('c3')).count, 2, 'exemplaire compté une seule fois');
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
  assert.deepEqual((await call('GET', 'cards?part=0', { key: nobody.key })).json, { rev: 0, fetched_at: null, cards: [], new_ids: [], part: '0', next_part: null });
  assert.deepEqual((await call('GET', 'cards?part=', { key: nobody.key })).json.cards, []);
  assert.deepEqual((await call('GET', 'cards', { key: nobody.key })).json, { rev: 0, fetched_at: null, cards: [], new_ids: [] });
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

// --- Lecture incrémentale (GET /api/cards?since=…) ----------------------------------------------------------------

const idsOf = (cards) => cards.map((c) => c.id);

await test('lecture incrémentale : import complet puis delta (nouvelle, modifiée, retirée puis revenue), synchro rapide', async () => {
  const lou = await signup('Lou');
  const rev = async () => (await call('GET', 'me', { key: lou.key })).json.cards_rev;
  const since = async (r) => (await call('GET', `cards?since=${r}`, { key: lou.key })).json;
  assert.equal(await rev(), 0);
  assert.deepEqual(await since(0), { rev: 0, delta: true, cards: [], gone: [], fetched_at: null, new_ids: [] });
  // Premier import complet : révision 1 ; depuis 0, toutes les cartes, au même format que GET /api/cards.
  const first = synth(30);
  let r = await call('POST', 'import', { key: lou.key, body: { cards: first } });
  assert.equal(r.json.count, 30);
  assert.equal(await rev(), 1);
  const all = (await call('GET', 'cards', { key: lou.key })).json;
  assert.equal(all.rev, 1);
  let d = await since(0);
  assert.deepEqual(Object.keys(d), ['rev', 'delta', 'cards', 'gone', 'fetched_at', 'new_ids']);
  assert.deepEqual([d.rev, d.delta, d.gone, d.fetched_at], [1, true, [], all.fetched_at]);
  assert.deepEqual(d.cards, all.cards);
  // Second import : une carte retirée (first[0]), une modifiée (first[5]), une nouvelle ; le reste identique.
  const fresh = synth(1, 30)[0];
  const second = [...first.slice(1).map((c) => (c === first[5] ? { ...c, count: c.count + 1 } : c)), fresh];
  r = await call('POST', 'import', { key: lou.key, body: { cards: second } });
  assert.deepEqual(r.json.new_ids, [fresh.id]);
  assert.equal(await rev(), 2);
  d = await since(1);
  assert.equal(d.rev, 2);
  assert.deepEqual(idsOf(d.cards), [first[5].id, fresh.id]);
  assert.equal(d.cards[0].count, first[5].count + 1);
  assert.deepEqual(d.cards[0], (await call('GET', 'cards', { key: lou.key })).json.cards.find((c) => c.id === first[5].id));
  assert.deepEqual(d.gone, [first[0].id]);
  assert.deepEqual(d.new_ids, [fresh.id]);
  assert.deepEqual(await since(2), { rev: 2, delta: true, cards: [], gone: [], fetched_at: d.fetched_at, new_ids: [fresh.id] });
  // La même collection une deuxième fois : rien d'écrit, la révision ne bouge pas.
  await call('POST', 'import', { key: lou.key, body: { cards: second } });
  assert.equal(await rev(), 2);
  // La carte retirée revient : révision 3, renvoyée depuis 2 comme depuis 1, et plus du tout dans `gone`.
  await call('POST', 'import', { key: lou.key, body: { cards: [first[0], ...second] } });
  assert.equal(await rev(), 3);
  d = await since(2);
  assert.deepEqual([idsOf(d.cards), d.gone], [[first[0].id], []]);
  d = await since(1);
  assert.deepEqual([idsOf(d.cards), d.gone], [[first[0].id, first[5].id, fresh.id], []]);
  assert.equal(rows('SELECT COUNT(*) AS n FROM cards_gone WHERE user_id = ?', lou.user.id)[0].n, 0);

  // Synchro rapide : une lecture complète avec les compteurs du jeu (total = exemplaires : une carte en a 2 ; identique :
  // révision inchangée), puis les
  // nouveautés (une carte nouvelle, un exemplaire de plus d'une carte déjà là) → une révision.
  const current = async () => (await call('GET', 'cards', { key: lou.key })).json.cards;
  r = await call('POST', 'import', { key: lou.key, body: { cards: await current(), stats: { total: 32, totalUnique: 31 }, rows: 31, copies: 32, last_at: '2026-10-15T09:00:00.000Z' } });
  assert.equal(r.json.count, 31);
  assert.equal(await rev(), 3);
  const quick = (cards, stats, n) => call('POST', 'import', { key: lou.key, body: { mode: 'delta', cards, stats, rows: n, copies: n } });
  const nouvelle = { ...carte(owned[40], 'nouvelle'), count: 1 };
  r = await quick([nouvelle, { ...first[1], count: 1 }], { total: 34, totalUnique: 32 }, 2);
  assert.equal(r.json.quick, true);
  assert.equal(await rev(), 4);
  d = await since(3);
  assert.deepEqual([idsOf(d.cards), d.gone], [[first[1].id, 'nouvelle'], []]);
  assert.equal(d.cards[0].count, first[1].count + 1);
  r = await quick([], { total: 34, totalUnique: 32 }, 0);
  assert.equal(r.json.quick, true);
  assert.equal(await rev(), 4, 'rien de nouveau : révision inchangée');
  // Une carte retirée par une lecture complète, puis revenue par une synchro rapide : plus retirée.
  r = await call('POST', 'import', { key: lou.key, body: { cards: (await current()).filter((c) => c.id !== first[2].id), stats: { total: 33, totalUnique: 31 } } });
  assert.equal(await rev(), 5);
  d = await since(4);
  assert.deepEqual([d.cards, d.gone], [[], [first[2].id]]);
  r = await quick([{ ...first[2], obtained_at: '2026-10-16T09:00:00.000Z' }], { total: 34, totalUnique: 32 }, 1);
  assert.equal(r.json.quick, true);
  assert.equal(await rev(), 6);
  for (const from of [5, 4]) {
    d = await since(from);
    assert.deepEqual([idsOf(d.cards), d.gone], [[first[2].id], []], `depuis ${from}`);
  }
  assert.equal(rows('SELECT COUNT(*) AS n FROM cards_gone WHERE user_id = ?', lou.user.id)[0].n, 0);
  await call('DELETE', 'me', { key: lou.key });
});

await test('lecture incrémentale : étiquettes (set, bulk, rename) → révision et cartes renvoyées', async () => {
  const mo = await signup('Mo');
  const ten = synth(10);
  await upload(mo.key, ten);
  const [a, b, c] = idsOf(ten);
  const rev = async () => (await call('GET', 'me', { key: mo.key })).json.cards_rev;
  const changed = async (r) => (await call('GET', `cards?since=${r}`, { key: mo.key })).json.cards.map((x) => [x.id, x.tags]);
  const post = async (route, body) => assert.equal((await call('POST', route, { key: mo.key, body })).status, 200);
  assert.equal(await rev(), 1);
  // tags/set : la carte change ; les mêmes étiquettes (dans un autre ordre, en double) ne changent rien.
  await post('tags/set', { card_id: a, tags: ['Rouge', 'Bleu'] });
  assert.equal(await rev(), 2);
  assert.deepEqual(await changed(1), [[a, ['Bleu', 'Rouge']]]);
  await post('tags/set', { card_id: a, tags: ['Rouge', 'Bleu', 'Rouge'] });
  assert.equal(await rev(), 2);
  await post('tags/set', { card_id: c, tags: ['X'] });
  await post('tags/set', { card_id: c, tags: [] });
  assert.equal(await rev(), 4);
  assert.deepEqual(await changed(3), [[c, []]]);
  // tags/bulk : seules les cartes qui changent (a a déjà « Rouge », « inconnue » n'est pas au classeur).
  await post('tags/bulk', { card_ids: [a, b, 'inconnue'], add: ['Rouge'] });
  assert.equal(await rev(), 5);
  assert.deepEqual(await changed(4), [[b, ['Rouge']]]);
  await post('tags/bulk', { card_ids: [a, b], add: ['Rouge'], remove: ['Absente'] });
  await post('tags/bulk', { card_ids: [a], add: ['Rouge'], remove: ['Rouge'] }); // retirée puis remise
  assert.equal(await rev(), 5, 'rien ne change : révision inchangée');
  await post('tags/bulk', { card_ids: [a, b], remove: ['Bleu'] });
  assert.equal(await rev(), 6);
  assert.deepEqual(await changed(5), [[a, ['Rouge']]]);
  // tags/rename : les cartes qui portent l'étiquette ; une étiquette absente ne change rien.
  await post('tags/rename', { from: 'Rouge', to: 'Vert' });
  assert.equal(await rev(), 7);
  assert.deepEqual(await changed(6), [[a, ['Vert']], [b, ['Vert']]]);
  await post('tags/rename', { from: 'Absente', to: 'Autre' });
  assert.equal(await rev(), 7);
  assert.deepEqual((await changed(1)).map(([id]) => id), [a, b, c]);
  // Étiquette d'une carte retirée (gardée) renommée : seules les cartes du classeur changent ; la carte revenue
  // arrive avec ses étiquettes à jour.
  await upload(mo.key, ten.slice(1));
  assert.equal(await rev(), 8);
  await post('tags/rename', { from: 'Vert', to: 'Jaune' });
  assert.equal(await rev(), 9);
  let d = (await call('GET', 'cards?since=8', { key: mo.key })).json;
  assert.deepEqual([d.cards.map((x) => [x.id, x.tags]), d.gone], [[[b, ['Jaune']]], []]);
  await upload(mo.key, ten);
  d = (await call('GET', 'cards?since=9', { key: mo.key })).json;
  assert.deepEqual([d.rev, d.cards.map((x) => [x.id, x.tags]), d.gone], [10, [[a, ['Jaune']]], []]);
  await call('DELETE', 'me', { key: mo.key });
});

await test('lecture incrémentale : since invalide (400), delta:false (révision inconnue, plancher, plus de 1 000 changements), élagage', async () => {
  const ned = await signup('Ned');
  const since = async (r) => (await call('GET', `cards?since=${r}`, { key: ned.key })).json;
  for (const bad of ['', 'abc', '-1', '1.5', '1e3', '+1', ' 1', '0x10', '1234567890123456']) {
    const r = await call('GET', `cards?since=${encodeURIComponent(bad)}`, { key: ned.key });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.match(r.json.error, /since/);
  }
  const both = await call('GET', 'cards?since=0&part=0', { key: ned.key });
  assert.equal(both.status, 400);
  // Révision inconnue (plus grande que celle du classeur : base recréée, autre classeur).
  assert.deepEqual(await since(5), { rev: 0, delta: false });
  // 1 000 cartes changées au plus.
  await upload(ned.key, mini(3000));
  assert.equal((await call('POST', 'tags/bulk', { key: ned.key, body: { card_ids: idsOf(mini(1000)), add: ['Mille'] } })).status, 200);
  let d = await since(1);
  assert.deepEqual([d.rev, d.delta, d.cards.length, d.gone.length], [2, true, 1000, 0]);
  assert.ok(d.cards.every((c) => c.tags.length === 1 && c.tags[0] === 'Mille'));
  await call('POST', 'tags/bulk', { key: ned.key, body: { card_ids: idsOf(mini(1001)), add: ['Encore'] } });
  assert.deepEqual(await since(2), { rev: 3, delta: false });
  assert.deepEqual(await since(0), { rev: 3, delta: false });
  // Les retraits comptent aussi : 1 000 retirées → delta, gardées toutes.
  const gone = () => rows('SELECT COUNT(*) AS n FROM cards_gone WHERE user_id = ?', ned.user.id)[0].n;
  const floor = () => rows('SELECT cards_gone_floor AS f FROM users WHERE id = ?', ned.user.id)[0].f;
  await upload(ned.key, mini(2000));
  d = await since(3);
  assert.deepEqual([d.rev, d.delta, d.cards.length, d.gone.length], [4, true, 0, 1000]);
  assert.deepEqual([gone(), floor()], [1000, 0]);
  // Une de plus : 1 001 retraits, les plus anciens (révision 4) sont élagués, le plancher monte à 4.
  await upload(ned.key, mini(1999));
  assert.deepEqual([gone(), floor()], [1, 4]);
  assert.deepEqual(await since(3), { rev: 5, delta: false });
  d = await since(4);
  assert.deepEqual([d.delta, d.cards, d.gone], [true, [], ['mini-01999']]);
  // Deux fois 600 retraits : la révision 6 est élaguée à son tour (seule la 7, la plus récente, reste).
  await upload(ned.key, mini(1399));
  assert.deepEqual([gone(), floor()], [601, 4]);
  await upload(ned.key, mini(799));
  assert.deepEqual([gone(), floor()], [600, 6]);
  assert.deepEqual(await since(5), { rev: 7, delta: false });
  d = await since(6);
  assert.deepEqual([d.delta, d.cards.length, d.gone.length], [true, 0, 600]);
  // Une carte retirée qui revient n'est plus dans `gone`.
  await upload(ned.key, mini(800));
  d = await since(6);
  assert.deepEqual([d.rev, idsOf(d.cards), d.gone.length, d.gone.includes('mini-00799')], [8, ['mini-00799'], 599, false]);
  // Une opération qui ne fait que retirer plus de 1 000 cartes : aucune marque de retrait une à une (l'élagage les
  // effacerait aussitôt : deux écritures par carte pour rien), une seule marque de débordement ; la révision avance quand
  // même, et le plancher monte jusqu'à elle.
  await upload(ned.key, mini(2500));
  env.DB.sqlite.exec('CREATE TABLE _g (n INTEGER); CREATE TRIGGER g_ins AFTER INSERT ON cards_gone BEGIN INSERT INTO _g VALUES (1); END;');
  await upload(ned.key, mini(10));
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM _g').get().n, 1, 'une seule marque (débordement)');
  env.DB.sqlite.exec('DROP TRIGGER g_ins; DROP TABLE _g');
  assert.equal(rows('SELECT COUNT(*) AS n FROM cards WHERE user_id = ?', ned.user.id)[0].n, 10);
  assert.equal((await call('GET', 'me', { key: ned.key })).json.cards_rev, 10);
  assert.deepEqual([gone(), floor()], [0, 10]);
  assert.deepEqual(await since(9), { rev: 10, delta: false });
  assert.deepEqual([(await since(10)).delta, (await since(10)).gone], [true, []]);
  await call('DELETE', 'me', { key: ned.key });
  assert.deepEqual([gone()], [0]);
});

await test('lecture incrémentale : rev lue avant les cartes (première page, lecture d\'un coup), base existante migrée', async () => {
  const oz = await signup('Oz');
  await upload(oz.key, mini(2500));
  // Base qui pose une étiquette juste avant de lire les cartes d'une requête (après l'authentification).
  const during = (marker, cardId, tag) => {
    let fired = false;
    const wrap = (st, sql) => ({
      _st: st,
      bind: (...a) => wrap(st.bind(...a), sql),
      all: async () => {
        if (!fired && sql.includes(marker)) {
          fired = true;
          assert.equal((await call('POST', 'tags/set', { key: oz.key, body: { card_id: cardId, tags: [tag] } })).status, 200);
        }
        return st.all();
      },
      first: (col) => st.first(col),
      run: () => st.run(),
      raw: () => st.raw(),
    });
    return { ...env, DB: { prepare: (sql) => wrap(env.DB.prepare(sql), sql), batch: (sts) => env.DB.batch(sts.map((s) => s._st)) } };
  };
  // Première page : rev = 1 (lue avant le changement), la page voit déjà la carte changée ; since=1 la renvoie.
  let r = await call('GET', 'cards?part=0', { key: oz.key, e: during('WITH page AS', 'mini-00001', 'Pendant') });
  assert.equal(r.json.rev, 1);
  assert.deepEqual(r.json.cards.find((c) => c.id === 'mini-00001').tags, ['Pendant']);
  // Deuxième page : une carte de la première (déjà lue) change pendant sa lecture. La page garde la rev de la première.
  r = await call('GET', `cards?part=${r.json.next_part}`, { key: oz.key, e: during('WITH page AS', 'mini-00002', 'Après') });
  assert.equal(r.json.rev, 2);
  r = await call('GET', `cards?part=${r.json.next_part}`, { key: oz.key });
  assert.deepEqual([r.json.rev, r.json.next_part], [3, null]);
  let d = (await call('GET', 'cards?since=1', { key: oz.key })).json;
  assert.deepEqual(d.cards.map((c) => [c.id, c.tags]), [['mini-00001', ['Pendant']], ['mini-00002', ['Après']]]);
  // Lecture d'un coup : même règle.
  r = await call('GET', 'cards', { key: oz.key, e: during('AS grp', 'mini-00003', 'Pendant') });
  assert.equal(r.json.rev, 3);
  assert.equal(r.json.cards.length, 2500);
  d = (await call('GET', 'cards?since=3', { key: oz.key })).json;
  assert.deepEqual(idsOf(d.cards), ['mini-00003']);
  await call('DELETE', 'me', { key: oz.key });

  // Base créée avant la lecture incrémentale : colonnes, table et index ajoutés au premier appel, révision 0.
  const old = makeEnv();
  old.DB.sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, key_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
      fetched_at TEXT, new_ids TEXT NOT NULL DEFAULT '[]', cookie_enc TEXT, cookie_updated_at TEXT, session_expired INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE cards (user_id TEXT NOT NULL, card_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (user_id, card_id));`);
  old.DB.sqlite.prepare("INSERT INTO users (id, key_hash, created_at, fetched_at) VALUES ('ancien', ?, '2026-10-01', '2026-10-01T00:00:00.000Z')")
    .run(await sha256Hex('cle-ancienne'));
  old.DB.sqlite.prepare("INSERT INTO cards VALUES ('ancien', 'c1', ?)").run(JSON.stringify({ id: 'c1', title: 'Ancienne', rarity: 'C', count: 1 }));
  const k = 'cle-ancienne';
  r = await call('GET', 'me', { key: k, e: old });
  assert.deepEqual([r.status, r.json.cards_rev, r.json.card_count], [200, 0, 1]);
  const cols = (t) => old.DB.sqlite.prepare(`PRAGMA table_info(${t})`).all().map((x) => x.name);
  assert.ok(cols('users').includes('cards_rev') && cols('users').includes('cards_gone_floor') && cols('cards').includes('rev'));
  assert.deepEqual(cols('cards_gone'), ['user_id', 'card_id', 'rev']);
  const indexes = old.DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((x) => x.name);
  assert.ok(indexes.includes('cards_by_rev') && indexes.includes('cards_gone_by_rev'), indexes.join(','));
  r = await call('GET', 'cards', { key: k, e: old });
  assert.deepEqual([r.json.rev, r.json.cards], [0, [{ id: 'c1', title: 'Ancienne', rarity: 'C', count: 1, tags: [] }]]);
  assert.deepEqual((await call('GET', 'cards?since=0', { key: k, e: old })).json.cards, []);
  await call('POST', 'tags/set', { key: k, e: old, body: { card_id: 'c1', tags: ['Ancien'] } });
  assert.deepEqual((await call('GET', 'cards?since=0', { key: k, e: old })).json.cards.map((c) => c.tags), [['Ancien']]);
  await call('POST', 'import', { key: k, e: old, body: { cards: mini(2) } });
  d = (await call('GET', 'cards?since=1', { key: k, e: old })).json;
  assert.deepEqual([d.rev, idsOf(d.cards), d.gone], [2, ['mini-00000', 'mini-00001'], ['c1']]);
});

await test('lecture incrémentale : réponse ?since en morceaux d\'environ 1 Mo (une ligne D1 fait 2 Mo au plus), fetched_at et new_ids lus avec', async () => {
  const ivy = await signup('Ivy');
  // 1 000 cartes de ~4,5 Ko (catégorie, adresse et image longues, permises) : ~4,5 Mo de changements.
  const heavy = mini(1000).map((c, i) => ({ ...c, category: 'c'.repeat(500), url: `https://fr.wikipedia.org/wiki/${'u'.repeat(1900)}${i}`,
    image: `https://upload.wikimedia.org/${'i'.repeat(1900)}${i}` }));
  await upload(ivy.key, heavy);
  const parts = [];
  const spy = { ...env, DB: { prepare: (sql) => {
    const st = env.DB.prepare(sql);
    if (!sql.includes('cards_gone AS g')) return st;
    return { bind: (...a) => { const b = st.bind(...a); return { all: async () => { const r = await b.all(); parts.push(...r.results.slice(1).map((x) => x.part.length)); return r; } }; } };
  }, batch: (s) => env.DB.batch(s) } };
  const d = (await call('GET', 'cards?since=0', { key: ivy.key, e: spy })).json;
  assert.deepEqual([d.delta, d.cards.length], [true, 1000]);
  assert.deepEqual(idsOf(d.cards), idsOf(heavy));
  assert.ok(['category', 'url', 'image'].every((f) => d.cards[7][f] === heavy[7][f]) && d.cards[7].tags.length === 0, 'carte recollée telle quelle');
  assert.ok(parts.length >= 4 && parts.every((n) => n < 1_100_000), JSON.stringify(parts));
  const me = (await call('GET', 'me', { key: ivy.key })).json;
  assert.deepEqual([d.fetched_at, d.new_ids], [me.fetched_at, me.new_ids]);
  await call('DELETE', 'me', { key: ivy.key });
});

await test('lecture incrémentale : plan de SQLite (index par révision, jamais toute la collection ni toutes les étiquettes)', async () => {
  const pat = await signup('Pat');
  await upload(pat.key, mini(3));
  await call('POST', 'tags/set', { key: pat.key, body: { card_id: 'mini-00000', tags: ['a'] } });
  const seen = [];
  const spy = { ...env, DB: { prepare: (sql) => { seen.push(sql); return env.DB.prepare(sql); }, batch: (s) => env.DB.batch(s) } };
  const d = (await call('GET', 'cards?since=1', { key: pat.key, e: spy })).json;
  assert.deepEqual(idsOf(d.cards), ['mini-00000']);
  const sql = seen.find((s) => s.includes('cards_gone AS g'));
  const plan = env.DB.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail);
  assert.ok(plan.some((l) => /^SEARCH cards USING INDEX cards_by_rev \(user_id=\? AND rev>\?\)/.test(l)), plan.join('\n'));
  assert.ok(plan.some((l) => /^SEARCH g USING INDEX cards_gone_by_rev \(user_id=\? AND rev>\?\)/.test(l)), plan.join('\n'));
  assert.ok(plan.some((l) => /^SEARCH tags USING .*\(user_id=\? AND card_id=\?\)/.test(l)), plan.join('\n'));
  // Seules les tables intermédiaires (≤ 1 001 lignes, k = les mêmes cartes découpées en morceaux) sont parcourues.
  assert.ok(plan.filter((l) => l.startsWith('SCAN ')).every((l) => /^SCAN (ch|gn|t|k|\(subquery-\d+\))$/.test(l)), plan.join('\n'));
  await call('DELETE', 'me', { key: pat.key });
});

await test('GET /api/me (relu toutes les minutes par la page visible) : une requête, une ligne (le compte, par sa clé) ; ancien classeur sans compteur : compté une seule fois', async () => {
  const kim = await signup('Kim');
  await upload(kim.key, mini(40));
  const seen = [];
  let during = null; // écriture faite pendant le COUNT (import concurrent simulé)
  const spy = { ...env, DB: { prepare: (sql) => { seen.push(sql); if (during && /COUNT\(\*\)/.test(sql)) { during(); during = null; } return env.DB.prepare(sql); }, batch: (s) => env.DB.batch(s) } };
  const me = async () => { seen.length = 0; return (await call('GET', 'me', { key: kim.key, e: spy })).json; };
  await me(); // schéma appliqué une fois par base et par instance (ensureSchema), pas à chaque appel
  assert.equal((await me()).card_count, 40);
  assert.equal(seen.length, 1, seen.join('\n'));
  const plan = env.DB.sqlite.prepare(`EXPLAIN QUERY PLAN ${seen[0]}`).all().map((r) => r.detail);
  // Le compte par sa clé, et le dernier numéro du chat (badge des non-lus) : MAX sur la clé primaire, une ligne.
  assert.deepEqual(plan.length, 3, plan.join('\n'));
  assert.match(plan[0], /^SEARCH users USING INDEX sqlite_autoindex_users_\d \(key_hash=\?\)$/);
  assert.deepEqual(plan.slice(1), ['SCALAR SUBQUERY 1', 'SEARCH chat_messages'], plan.join('\n'));
  // Classeur importé avant le compteur (sync_state absent, ou ancien format sans unit, invalid ni count) : compté une
  // fois, puis gardé ; le reste de l'état est intact et la synchro rapide reste coupée (relecture complète).
  const setState = (v) => env.DB.sqlite.prepare('UPDATE users SET sync_state = ? WHERE id = ?').run(v, kim.user.id);
  const stateOf = () => rows('SELECT sync_state FROM users WHERE id = ?', kim.user.id)[0].sync_state;
  const old = JSON.stringify({ stats: { total: 40, totalUnique: 40, rarityCounts: null }, last_at: '2026-10-01T00:00:00.000Z', full_at: new Date().toISOString() });
  for (const before of [null, old]) {
    setState(before);
    let m = await me();
    assert.deepEqual([m.card_count, m.next_full], [40, true]);
    assert.ok(seen.some((s) => /COUNT\(\*\)/.test(s)), 'compté une fois');
    m = await me();
    assert.deepEqual([m.card_count, m.next_full, seen.length], [40, true, 1], 'compteur gardé : plus de COUNT');
    const st = JSON.parse(stateOf());
    assert.equal(st.count, 40);
    if (before) assert.deepEqual({ ...st, count: undefined }, { ...JSON.parse(before), count: undefined });
    assert.equal((await call('POST', 'import', { key: kim.key, body: { mode: 'state' } })).json.quick, false);
  }
  // Un import fini pendant le COUNT a écrit son état : il n'est pas écrasé (comparer-échanger).
  setState(null);
  during = () => setState('{"tok":"import-concurrent"}');
  assert.equal((await me()).card_count, 40);
  assert.equal(stateOf(), '{"tok":"import-concurrent"}');
  await call('DELETE', 'me', { key: kim.key });
});

await test('mesures de CPU (limite des Workers gratuits : 10 ms)', async () => {
  const e3 = makeEnv({ REFRESH_PAUSE_MS: '0' });
  const runs = {
    part: [], refresh: [], fin1k: [], fin5k: [], fin20k: [], cards1k: [], cards20k: [], cardsPage: [], bulk: [], target: [],
    since1k: [], since20k: [], sinceNo: [], delta: [], quickFail: [],
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
      // Lecture incrémentale : 1 000 cartes changées (étiquette ajoutée), le plus qu'elle renvoie.
      const touch = (list, tag) => call('POST', 'tags/bulk', { key: v.key, e: e3, body: { card_ids: list.map((c) => c.id), add: [tag] } });
      if (n === 1000) {
        runs.cards1k.push(await profile('GET', 'cards', { key: v.key, e: e3 }));
        await touch(cards, 's');
        const s = await profile('GET', 'cards?since=1', { key: v.key, e: e3 });
        assert.deepEqual([s.json.delta, s.json.cards.length], [true, 1000]);
        runs.since1k.push(s);
      }
      if (n === 20_000) {
        runs.cards20k.push(await profile('GET', 'cards', { key: v.key, e: e3 }));
        const first = (await call('GET', 'cards?part=0', { key: v.key, e: e3 })).json.next_part;
        runs.cardsPage.push(await profile('GET', `cards?part=${first}`, { key: v.key, e: e3 }));
        runs.bulk.push(await profile('POST', 'tags/bulk', { key: v.key, e: e3, body: { card_ids: cards.slice(0, 5000).map((c) => c.id), add: [`t${k}`] } }));
        await touch(cards.slice(10_000, 11_000), 's');
        const s = await profile('GET', 'cards?since=2', { key: v.key, e: e3 });
        assert.deepEqual([s.json.delta, s.json.cards.length], [true, 1000]);
        runs.since20k.push(s);
        const no = await profile('GET', 'cards?since=1', { key: v.key, e: e3 });
        assert.deepEqual(no.json, { rev: 3, delta: false });
        runs.sinceNo.push(no);
      }
      await call('DELETE', 'me', { key: v.key, e: e3 });
    }
  }
  // Synchro rapide : 500 nouveautés (le plus qu'un envoi du favori accepte) sur un classeur de 1 000 cartes ; et
  // rafraîchissement page 0 dont la synchro rapide échoue (plus de 450 nouveautés) : stats + 9 pages triées par date +
  // 1 page de la lecture complète, jamais plus de 10 pages décodées dans l'appel.
  const olds = entriesFor(owned.slice(0, 600));
  const late = owned.slice(0, 460).map((c, i) => rawEntry(c, { id: `n${i}`, obtained_at: `2027-01-01T0${Math.floor(i / 60) % 10}:${String(i % 60).padStart(2, '0')}:00.000Z` }));
  for (let k = 0; k < 4; k++) {
    const u = await signup(`Rapide ${k}`, e3);
    const cards = synth(1000);
    await call('POST', 'import', { key: u.key, e: e3, body: { upload_id: 'r', part: 0, last: false, cards: cards.slice(0, 500), stats: { total: 1000, totalUnique: 1000 }, rows: 1000, copies: 1000, last_at: '2026-10-15T09:00:00.000Z' } });
    await call('POST', 'import', { key: u.key, e: e3, body: { upload_id: 'r', part: 1, last: true, cards: cards.slice(500) } });
    const m = await profile('POST', 'import', { key: u.key, e: e3, body: { mode: 'delta', cards: synth(500, 5000), rows: 500, copies: 500, stats: { total: 1500, totalUnique: 1500 }, last_at: '2026-10-16T09:00:00.000Z' } });
    assert.equal(m.json.quick, true, JSON.stringify(m.json));
    runs.delta.push(m);
    const w = await signup(`Ratée ${k}`, e3);
    await call('POST', 'session', { key: w.key, e: e3, body: { cookie: 'sid=r' } });
    mockGame(olds);
    let r = await call('POST', 'refresh', { key: w.key, e: e3, body: {} });
    while (!r.json.done) r = await call('POST', 'refresh', { key: w.key, e: e3, body: { page: r.json.next_page } });
    mockGame([...olds, ...late]);
    const q = await profile('POST', 'refresh', { key: w.key, e: e3, body: { page: 0 } });
    assert.deepEqual([q.json.done, q.json.next_page, q.json.fetched], [false, 1, 50], JSON.stringify(q.json));
    runs.quickFail.push(q);
  }
  globalThis.fetch = realFetch;
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
  report('GET /api/cards?since=…, 1 000 changées sur 1 000', runs.since1k);
  report('GET /api/cards?since=…, 1 000 changées sur 20 000', runs.since20k);
  report('GET /api/cards?since=…, plus de 1 000 changées sur 20 000 (delta:false)', runs.sinceNo);
  report('synchro rapide (import mode delta), 500 nouveautés sur 1 000 cartes', runs.delta);
  report('refresh page 0, synchro rapide ratée (stats + 9 pages par date + 1 page)', runs.quickFail);
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
  // Seuil absolu (10 ms) : seulement signalé, les temps varient du simple au double selon la charge de la machine.
  for (const [label, rs] of [['morceau', runs.part], ['refresh', runs.refresh], ['targets/save', runs.target], ['page de cartes', runs.cardsPage],
    ['lecture incrémentale', runs.since20k], ['synchro rapide', runs.delta], ['synchro rapide ratée', runs.quickFail]]) {
    if (js(rs) >= 10) console.log(`    ATTENTION : ${label} à ${ms(js(rs))} de JS sur cette machine (limite des Workers gratuits : 10 ms)`);
  }
});

// --- Partage entre membres ---------------------------------------------------------------------------------------

await test('partage entre membres : consentement (403/404), réciprocité, identifiant public, aucune fuite, pages, suppression', async () => {
  const ana = await signup('Ana');
  const ben = await signup('Ben');
  const cleo = await signup('Cléo');
  const me = async (u) => (await call('GET', 'me', { key: u.key })).json;
  const share = (u, shared) => call('PATCH', 'me', { key: u.key, body: { shared } });
  const members = (u) => call('GET', 'members', { key: u.key });
  const pageOf = (u, id, part) => call('GET', `members/${id}/cards${part === undefined ? '' : `?part=${encodeURIComponent(part)}`}`, { key: u.key });
  const pubOf = (u) => rows('SELECT public_id FROM users WHERE id = ?', u.user.id)[0].public_id;

  // Ben : des cartes, des étiquettes, une collection à compléter, des préférences, une session du jeu, une clé d'import.
  const benCards = synth(12, 200);
  await upload(ben.key, benCards);
  const dupe = benCards[3];
  await call('POST', 'tags/set', { key: ben.key, body: { card_id: dupe.id, tags: ['Étiquette-secrète'] } });
  await call('POST', 'targets/save', { key: ben.key, body: { name: 'Collection-secrète', items: [{ title: 'Article-secret', status: 'ok' }] } });
  await call('PATCH', 'me', { key: ben.key, body: { prefs: { note: 'préférence-secrète' } } });
  await call('POST', 'session', { key: ben.key, body: { cookie: 'sb-auth=cookie-secret' } });
  const benImport = (await call('POST', 'import-key', { key: ben.key })).json.import_key;

  // Activé par défaut à la création (2026-10-16), cartes et collections ; ce test part de comptes qui l'ont coupé.
  for (const u of [ana, ben, cleo]) {
    const m = await me(u);
    assert.equal(m.shared, true);
    assert.equal(m.shared_targets, true);
    assert.equal((await share(u, false)).status, 200);
  }
  // Les comptes des tests précédents partagent aussi par défaut : coupés ici, pour ne voir que ceux de ce test.
  env.DB.sqlite.prepare('UPDATE users SET shared = 0, shared_targets = 0, public_id = NULL').run();
  // Sans partager soi-même : 403 partout (réciprocité), même avec un identifiant connu.
  assert.equal((await me(ana)).shared, false);
  for (const r of [await members(ana), await pageOf(ana, 'nimporte'), await pageOf(ana, 'nimporte', '0')]) {
    assert.equal(r.status, 403, JSON.stringify(r.json));
    assert.match(r.json.error, /montre d'abord les tiennes/);
  }
  assert.equal(rows('SELECT shared, public_id FROM users WHERE id = ?', ana.user.id)[0].shared, 0);

  // Activation : PATCH /api/me {shared:true} (booléen seulement), identifiant public tiré au hasard (pas l'id interne).
  for (const bad of ['oui', 1, null, {}]) assert.equal((await share(ana, bad)).status, 400, JSON.stringify(bad));
  let r = await share(ana, true);
  assert.deepEqual([r.status, r.json.shared, r.json.user.name], [200, true, 'Ana']);
  assert.equal((await me(ana)).shared, true);
  const anaPub = pubOf(ana);
  assert.match(anaPub, /^[A-Za-z0-9_-]{12}$/);
  assert.notEqual(anaPub, ana.user.id);
  r = await share(ana, true);
  assert.equal(pubOf(ana), anaPub, 'réactiver sans avoir coupé garde le même identifiant');
  assert.equal((await me(ana)).user.name, 'Ana', 'le nom ne bouge pas');
  // Personne d'autre ne partage encore : liste vide (jamais soi-même).
  r = await members(ana);
  assert.deepEqual([r.status, r.json], [200, { members: [] }]);

  // Ben partage : Ana le voit (et lui la voit) ; Cléo, qui ne partage pas, n'apparaît pas et ne voit rien.
  await share(ben, true);
  const benPub = pubOf(ben);
  r = await members(ana);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.members, [{ id: benPub, name: 'Ben', count: 12, fetched_at: (await me(ben)).fetched_at, targets: null }]);
  // Classeur vide (ni carte ni collection) : absent de la liste ; Ana y apparaît avec sa première collection.
  assert.deepEqual((await members(ben)).json.members, [], 'un classeur vide ne doit pas être listé');
  await call('POST', 'targets/save', { key: ana.key, body: { name: 'Première', items: [{ title: 'Article premier', status: 'ok' }] } });
  assert.deepEqual((await members(ben)).json.members.map((m) => [m.id, m.name, m.count]), [[anaPub, 'Ana', 0]]);
  assert.equal((await members(cleo)).status, 403);
  assert.equal((await pageOf(cleo, benPub)).status, 403);
  // La clé d'import (favori) ne lit ni n'active rien.
  assert.equal((await call('GET', 'members', { key: benImport })).status, 401);
  assert.equal((await call('PATCH', 'me', { key: benImport, body: { shared: false } })).status, 401);
  assert.equal((await call('GET', `members/${anaPub}/cards`, { key: benImport })).status, 401);

  // Les cartes de Ben vues par Ana : liste blanche de champs, sans étiquettes ; même ordre que GET /api/cards.
  r = await pageOf(ana, benPub, '0');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json), ['member', 'cards', 'part', 'next_part']);
  assert.deepEqual(r.json.member, { id: benPub, name: 'Ben', fetched_at: (await me(ben)).fetched_at });
  assert.deepEqual([r.json.part, r.json.next_part, r.json.cards.length], ['0', null, 12]);
  const own = (await call('GET', 'cards', { key: ben.key })).json.cards;
  assert.deepEqual(r.json.cards, own.map((c) => ({ id: c.id, title: c.title, rarity: c.rarity, count: c.count, shiny: c.shiny, image: c.image ?? null, url: c.url ?? null })));
  assert.deepEqual(r.json.cards.map((c) => Object.keys(c).join(',')), own.map(() => 'id,title,rarity,count,shiny,image,url'));
  assert.deepEqual((await pageOf(ana, benPub)).json, r.json, 'sans part : la première page');
  // Avec la cote de la carte (cache commun des ventes, pour la valeur de son classeur dans la page) : `v` tel que rangé,
  // seulement pour une carte qui en a une (rien pour une carte lue sans vente, `{}`, ni pour une carte jamais cotée).
  {
    const sale = { p: 120, n: 4, w: null, l: 118, d: '2026-10-15T10:00:00.000Z' };
    const v0 = { [own[0].rarity]: sale, [own[0].rarity + '*']: { ...sale, p: 900, n: 1 } };
    const sent = await call('POST', 'market/prices', { key: benImport, body: { prices: [{ id: own[0].id, v: v0 }, { id: own[1].id, v: {} }] } });
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    const priced = await pageOf(ana, benPub, '0');
    assert.deepEqual(priced.json.cards[0], { ...r.json.cards[0], v: v0 });
    assert.deepEqual(priced.json.cards.slice(1), r.json.cards.slice(1), 'sans cote (ou sans vente) : pas de « v »');
    env.DB.sqlite.prepare('DELETE FROM prices').run();
    env.DB.sqlite.prepare("DELETE FROM market WHERE user_id = '*'").run();
  }
  // Rien de personnel dans les réponses : ni étiquettes, ni collections, ni préférences, ni clés, ni session, ni id interne.
  const text = JSON.stringify([r.json, (await members(ana)).json, (await members(ben)).json]);
  const [benRow] = rows('SELECT * FROM users WHERE id = ?', ben.user.id);
  for (const secret of ['Étiquette-secrète', 'Collection-secrète', 'Article-secret', 'préférence-secrète', 'cookie-secret', ben.key, benImport,
    benRow.key_hash, benRow.import_key_hash, benRow.cookie_enc, ben.user.id, ana.user.id, '"tags"', '"starred"', '"obtained_at"', '"atk"', '"quality"', 'sync_state']) {
    assert.ok(!text.includes(secret), `fuite : ${secret}`);
  }
  assert.ok(benRow.cookie_enc && benRow.import_key_hash, 'la session et la clé d\'import existent bien');

  // 404 : identifiant inconnu, mal formé, ou d'un membre qui ne partage pas ; route inconnue sous members/.
  const cleoPub = 'x'.repeat(12);
  for (const id of [cleoPub, 'a.b', '%27--', 'a'.repeat(65)]) assert.equal((await pageOf(ana, id)).status, 404, id);
  // Un identifiant public resté sur un compte qui ne partage pas (shared = 0) : refusé aussi.
  env.DB.sqlite.prepare("UPDATE users SET public_id = 'pub-de-cleo' WHERE id = ?").run(cleo.user.id);
  assert.equal((await pageOf(ana, 'pub-de-cleo')).status, 404);
  assert.ok(!(await members(ana)).json.members.some((m) => m.name === 'Cléo'));
  assert.equal((await call('GET', `members/${benPub}`, { key: ana.key })).status, 404);
  assert.equal((await call('GET', `members/${benPub}/tags`, { key: ana.key })).status, 404);
  assert.equal((await call('POST', `members/${benPub}/cards`, { key: ana.key, body: {} })).status, 405);
  assert.equal((await pageOf(ana, benPub, 'pas un curseur!')).status, 400);

  // Ben coupe le partage : il disparaît, son ancien identifiant ne mène plus à rien, et lui ne voit plus personne.
  r = await share(ben, false);
  assert.deepEqual([r.status, r.json.shared], [200, false]);
  assert.equal(pubOf(ben), null);
  assert.deepEqual((await members(ana)).json.members, []);
  assert.equal((await pageOf(ana, benPub)).status, 404);
  assert.equal((await members(ben)).status, 403);
  // Il le réactive : nouvel identifiant, l'ancien reste mort.
  await share(ben, true);
  const benPub2 = pubOf(ben);
  assert.ok(benPub2 && benPub2 !== benPub);
  assert.equal((await pageOf(ana, benPub)).status, 404);
  assert.equal((await pageOf(ana, benPub2)).status, 200);

  // Pages de 1 000 par clé : 2 500 cartes → 1 000, 1 000, 500 ; curseur opaque rendu tel quel.
  const dan = await signup('Dan');
  await upload(dan.key, mini(2500));
  await share(dan, true);
  const danPub = pubOf(dan);
  const got = [];
  let part = '0';
  const sizes = [];
  for (let guard = 0; guard < 5; guard++) {
    r = await pageOf(ana, danPub, part);
    assert.equal(r.status, 200);
    sizes.push(r.json.cards.length);
    got.push(...r.json.cards.map((c) => c.id));
    if (r.json.next_part === null) break;
    part = r.json.next_part;
  }
  assert.deepEqual(sizes, [1000, 1000, 500]);
  assert.deepEqual(got, mini(2500).map((c) => c.id));
  // Plan : la page est lue par la clé primaire (user_id, card_id), le membre par son identifiant public ; pas de
  // parcours de toute la table des cartes ni des étiquettes.
  const seen = [];
  const spy = { ...env, DB: { prepare: (sql) => { seen.push(sql); return env.DB.prepare(sql); }, batch: (s) => env.DB.batch(s) } };
  await call('GET', `members/${danPub}/cards?part=0`, { key: ana.key, e: spy });
  const sql = seen.find((s) => s.includes("json_object(\n    'id', c.card_id"));
  const plan = env.DB.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((x) => x.detail);
  assert.ok(plan.some((l) => /^SEARCH c USING (INDEX|PRIMARY KEY) .*\(user_id=\? AND card_id>\?\)/.test(l)), plan.join('\n'));
  assert.ok(plan.some((l) => /^SEARCH users USING INDEX users_by_public_id \(public_id=\?\)/.test(l)), plan.join('\n'));
  assert.ok(plan.some((l) => /^SEARCH p USING (INDEX sqlite_autoindex_prices_1|PRIMARY KEY) \(card_id=\?\)/.test(l)), plan.join('\n'));
  assert.ok(!plan.some((l) => /^SCAN (c|cards|tags|p|prices)\b/.test(l)) && !/\btags\b/.test(sql), plan.join('\n'));
  // Coût : JavaScript d'une page de 1 000 cartes (rejouée), toutes cotées, et de la liste des membres.
  const danImport = (await call('POST', 'import-key', { key: dan.key })).json.import_key;
  const danSale = { p: 50, n: 3, w: 40, l: 49, d: '2026-10-15T10:00:00.000Z' };
  for (let k = 0; k < 2; k++) {
    const prices = mini(2500).slice(k * 500, (k + 1) * 500).map((c) => ({ id: c.id, v: { C: danSale, R: { ...danSale, p: 300 }, 'C*': { ...danSale, n: 1 } } }));
    assert.equal((await call('POST', 'market/prices', { key: danImport, body: { prices } })).status, 200);
  }
  assert.equal((await pageOf(ana, danPub, '0')).json.cards.filter((c) => c.v).length, 1000);
  const p = await profile('GET', `members/${danPub}/cards?part=0`, { key: ana.key });
  env.DB.sqlite.prepare('DELETE FROM prices').run();
  env.DB.sqlite.prepare("DELETE FROM market WHERE user_id = '*'").run();
  const l = await profile('GET', 'members', { key: ana.key });
  console.log(`    GET /api/members/<id>/cards, une page de 1 000 cartes cotées (${Math.round(p.size / 1024)} Ko) : JS ${ms(p.js)} | GET /api/members : JS ${ms(l.js)}`);
  assert.ok(p.js < 10 && l.js < 10, 'trop de JavaScript');

  // DELETE /api/me : le membre disparaît de la liste et de ses pages.
  await call('DELETE', 'me', { key: dan.key });
  assert.ok(!(await members(ana)).json.members.some((m) => m.id === danPub));
  assert.equal((await pageOf(ana, danPub)).status, 404);
  for (const u of [ana, ben, cleo]) await call('DELETE', 'me', { key: u.key });
});

await test('partage entre membres : collections à compléter (réglage à part, 403/404, liste blanche, pages bornées, suppression)', async () => {
  const ana = await signup('Ana');
  const ben = await signup('Ben');
  const cleo = await signup('Cléo');
  const me = async (u) => (await call('GET', 'me', { key: u.key })).json;
  const patch = (u, body) => call('PATCH', 'me', { key: u.key, body });
  const members = (u) => call('GET', 'members', { key: u.key });
  const targetsOf = (u, id, part) => call('GET', `members/${id}/targets${part === undefined ? '' : `?part=${encodeURIComponent(part)}`}`, { key: u.key });
  const pubOf = (u) => rows('SELECT public_id FROM users WHERE id = ?', u.user.id)[0].public_id;
  const save = (u, body) => call('POST', 'targets/save', { key: u.key, body });

  // Ben : des cartes, des étiquettes, deux collections (une à lui, une ajoutée du catalogue), des préférences, une session.
  await upload(ben.key, synth(6, 300));
  await upload(ana.key, synth(2, 900)); // Ana : deux cartes (un classeur vide n'est pas listé)
  await call('POST', 'tags/set', { key: ben.key, body: { card_id: synth(1, 300)[0].id, tags: ['Étiquette-secrète'] } });
  const planets = (await save(ben, { name: 'Planètes', source: 'wp:Catégorie-secrète', items: [
    { title: 'Mars (planète)', description: 'description-secrète', image: 'https://upload.wikimedia.org/image-secrete.jpg', status: 'ok', qid: 'Q111' },
    { title: 'Vénus (planète)', status: 'ok' },
    { title: 'Mercure (homonymie)', status: 'disambiguation' },
    { title: 'Article-introuvable', status: 'missing' },
  ] })).json.target;
  const cat = (await save(ben, { name: 'Dieux grecs', source: 'catalog:dieux-grecs', items: [{ title: 'Zeus', qid: 'Q34201', status: 'ok' }, { title: 'Héra', status: 'ok' }] })).json.target;
  await patch(ben, { prefs: { note: 'préférence-secrète' } });
  await call('POST', 'session', { key: ben.key, body: { cookie: 'sb-auth=cookie-secret' } });
  const benImport = (await call('POST', 'import-key', { key: ben.key })).json.import_key;

  // Partage activé par défaut depuis 2026-10-16 (cartes et collections) : ce test part de comptes qui l'ont coupé.
  assert.equal((await me(ben)).shared_targets, true);
  env.DB.sqlite.prepare('UPDATE users SET shared = 0, shared_targets = 0, public_id = NULL').run();
  // Réglage à part, et seulement si l'on montre ses cartes (dans la même requête ou déjà).
  assert.equal((await me(ben)).shared_targets, false);
  let r = await patch(ben, { shared_targets: true });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /montre d'abord tes cartes/);
  for (const bad of ['oui', 1, null]) assert.equal((await patch(ben, { shared: true, shared_targets: bad })).status, 400, JSON.stringify(bad));
  assert.equal(rows('SELECT shared, shared_targets FROM users WHERE id = ?', ben.user.id)[0].shared, 0, 'requête refusée : rien d\'écrit');
  assert.equal((await patch(ben, { shared: false, shared_targets: true })).status, 400);
  // Ben montre ses cartes seulement : ses collections restent privées (404), il apparaît avec targets: null.
  await patch(ana, { shared: true });
  r = await patch(ben, { shared: true });
  assert.deepEqual([r.status, r.json.shared, r.json.shared_targets], [200, true, false]);
  const benPub = pubOf(ben);
  assert.deepEqual((await members(ana)).json.members.map((m) => [m.name, m.targets]), [['Ben', null]]);
  r = await targetsOf(ana, benPub);
  assert.equal(r.status, 404);
  assert.match(r.json.error, /collections à compléter/);
  // Cléo ne montre pas ses cartes : 403, même pour les collections (réciprocité) ; clé d'import : 401.
  r = await targetsOf(cleo, benPub);
  assert.equal(r.status, 403);
  assert.match(r.json.error, /montre d'abord les tiennes/);
  assert.equal((await call('GET', `members/${benPub}/targets`, { key: benImport })).status, 401);
  assert.equal((await call('PATCH', 'me', { key: benImport, body: { shared_targets: true } })).status, 401);

  // Ben montre aussi ses collections : GET /api/members donne leur nombre et leur dernier changement.
  r = await patch(ben, { shared_targets: true });
  assert.deepEqual([r.status, r.json.shared, r.json.shared_targets], [200, true, true]);
  assert.equal((await me(ben)).shared_targets, true);
  assert.equal(pubOf(ben), benPub, 'l\'identifiant public ne change pas');
  const lastChange = [planets.updated_at, cat.updated_at].sort().pop();
  assert.deepEqual((await members(ana)).json.members, [{ id: benPub, name: 'Ben', count: 6, fetched_at: (await me(ben)).fetched_at, targets: { count: 2, updated_at: lastChange } }]);
  assert.deepEqual((await members(ben)).json.members.map((m) => [m.name, m.targets]), [['Ana', null]], 'Ana ne montre pas ses collections');
  assert.equal((await targetsOf(ben, pubOf(ana))).status, 404);

  // Ce qu'Ana voit : le nom de chaque collection (y compris celle du catalogue), sa nature (catégorie de Wikipédia
  // suivie ou collection) et, pour chaque élément vérifié, son titre et son qid ; ni description, ni image, ni statut,
  // ni source, ni dates ; les éléments introuvables ou d'homonymie sont omis (aucune carte ne peut les remplir).
  r = await targetsOf(ana, benPub, '0');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json), ['member', 'targets', 'part', 'next_part']);
  assert.deepEqual([r.json.member, r.json.part, r.json.next_part], [{ id: benPub, name: 'Ben' }, '0', null]);
  const expected = [
    { id: planets.id, name: 'Planètes', kind: 'category', items: [{ title: 'Mars (planète)', qid: 'Q111' }, { title: 'Vénus (planète)' }] },
    { id: cat.id, name: 'Dieux grecs', kind: 'collection', items: [{ title: 'Zeus', qid: 'Q34201' }, { title: 'Héra' }] },
  ].sort((a, b) => (a.id < b.id ? -1 : 1));
  assert.deepEqual(r.json.targets, expected);
  assert.deepEqual((await targetsOf(ana, benPub)).json, r.json, 'sans part : la première page');
  const text = JSON.stringify([r.json, (await members(ana)).json, (await members(ben)).json]);
  const [benRow] = rows('SELECT * FROM users WHERE id = ?', ben.user.id);
  for (const secret of ['description-secrète', 'image-secrete', 'Catégorie-secrète', 'catalog:', 'Mercure (homonymie)', 'Article-introuvable', 'Étiquette-secrète',
    'préférence-secrète', 'cookie-secret', ben.key, benImport, benRow.key_hash, benRow.import_key_hash, benRow.cookie_enc, ben.user.id, ana.user.id,
    '"source"', '"description"', '"image"', '"status"', '"created_at"', '"tags"', 'wp:', 'sync_state']) {
    assert.ok(!text.includes(secret), `fuite : ${secret}`);
  }
  // Mauvais identifiant ou curseur, autre méthode.
  for (const id of ['x'.repeat(12), 'a.b', 'a'.repeat(65)]) assert.equal((await targetsOf(ana, id)).status, 404, id);
  assert.equal((await targetsOf(ana, benPub, 'pas un curseur!')).status, 400);
  assert.equal((await call('POST', `members/${benPub}/targets`, { key: ana.key, body: {} })).status, 405);

  // Ben coupe le partage des collections seulement : 404, targets: null, ses cartes restent visibles.
  await patch(ben, { shared_targets: false });
  assert.equal((await targetsOf(ana, benPub)).status, 404);
  assert.deepEqual((await members(ana)).json.members.map((m) => m.targets), [null]);
  assert.equal((await call('GET', `members/${benPub}/cards`, { key: ana.key })).status, 200);
  // Il les remontre, puis coupe tout : le partage des collections tombe avec celui des cartes et n'est pas rétabli
  // par une nouvelle activation des cartes (à rechoisir).
  await patch(ben, { shared_targets: true });
  r = await patch(ben, { shared: false });
  assert.deepEqual([r.json.shared, r.json.shared_targets], [false, false]);
  assert.deepEqual(rows('SELECT shared, shared_targets FROM users WHERE id = ?', ben.user.id)[0], { shared: 0, shared_targets: 0 });
  await patch(ben, { shared: true });
  assert.equal((await me(ben)).shared_targets, false);
  assert.equal((await targetsOf(ana, pubOf(ben))).status, 404);
  // Les deux d'un coup.
  r = await patch(ben, { shared: true, shared_targets: true });
  assert.deepEqual([r.status, r.json.shared_targets], [200, true]);

  // Taille bornée : Dan a 8 grandes collections (~550 Ko rangés chacune, 4,4 Mo en tout) et 3 petites. Pages de
  // 512 Ko rangés (plus la collection qui franchit le seuil) : chaque réponse reste sous 1 Mo, tout arrive dans l'ordre.
  const dan = await signup('Dan');
  await patch(dan, { shared: true, shared_targets: true });
  const danPub = pubOf(dan);
  const big = (k) => Array.from({ length: 2500 }, (_, i) => ({ title: `Article ${k}-${String(i).padStart(4, '0')} ${'t'.repeat(30)}`,
    description: 'd'.repeat(120), status: 'ok', ...(i % 2 ? { qid: `Q${k * 10000 + i + 1}` } : {}) }));
  const ids = [];
  for (let k = 0; k < 11; k++) {
    const items = k < 8 ? big(k) : [{ title: `Petite ${k}`, status: 'ok' }];
    const s = await save(dan, { name: `Collection ${k}`, items });
    assert.equal(s.status, 200, JSON.stringify(s.json));
    ids.push(s.json.target.id);
  }
  const stored = rows('SELECT id, length(CAST(items AS BLOB)) AS n FROM targets WHERE user_id = ? ORDER BY id', dan.user.id);
  assert.ok(stored.reduce((a, x) => a + x.n, 0) > 4e6, 'plus de 4 Mo rangés');
  const got = [];
  const sizes = [];
  let part = '0';
  for (let guard = 0; guard < 20; guard++) {
    const p = await profile('GET', `members/${danPub}/targets?part=${encodeURIComponent(part)}`, { key: ana.key, n: 5 });
    assert.equal(p.status, 200);
    assert.ok(p.size < 1024 * 1024, `page de ${p.size} octets`);
    assert.ok(p.js < 10, `page des collections : ${ms(p.js)} de JavaScript`);
    sizes.push(p.size);
    got.push(...p.json.targets);
    if (p.json.next_part === null) break;
    part = p.json.next_part;
  }
  assert.deepEqual(got.map((t) => t.id), stored.map((x) => x.id), 'toutes les collections, par identifiant');
  assert.deepEqual(got.map((t) => t.items.length).sort((a, b) => a - b), [1, 1, 1, 2500, 2500, 2500, 2500, 2500, 2500, 2500, 2500]);
  assert.ok(sizes.length >= 8, `${sizes.length} pages`);
  const one = got.find((t) => t.name === 'Collection 3');
  assert.deepEqual([one.items[0], one.items[1]], [{ title: `Article 3-0000 ${'t'.repeat(30)}` }, { title: `Article 3-0001 ${'t'.repeat(30)}`, qid: 'Q30002' }]);
  console.log(`    GET /api/members/<id>/targets : ${sizes.length} pages, ${sizes.map((s) => `${Math.round(s / 1024)} Ko`).join(', ')}`);
  // Plan : collections lues par la clé primaire (user_id, id), membre par son identifiant public.
  const seen = [];
  const spy = { ...env, DB: { prepare: (sql) => { seen.push(sql); return env.DB.prepare(sql); }, batch: (s) => env.DB.batch(s) } };
  await call('GET', `members/${danPub}/targets`, { key: ana.key, e: spy });
  const sql = seen.find((s) => s.includes('json_group_array'));
  const plan = env.DB.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all({ '?1': danPub, '?2': '', '?3': 1 }).map((x) => x.detail);
  assert.ok(plan.some((l) => /^SEARCH t USING (INDEX|PRIMARY KEY) .*\(user_id=\? AND id>\?\)/.test(l)), plan.join('\n'));
  assert.ok(plan.some((l) => /^SEARCH users USING INDEX users_by_public_id \(public_id=\?\)/.test(l)), plan.join('\n'));
  assert.ok(!plan.some((l) => /^SCAN (t|targets|users)\b/.test(l)), plan.join('\n'));

  // DELETE /api/me : Dan disparaît, ses collections aussi.
  await call('DELETE', 'me', { key: dan.key });
  assert.equal((await targetsOf(ana, danPub)).status, 404);
  assert.ok(!(await members(ana)).json.members.some((m) => m.id === danPub));
  assert.equal(rows('SELECT COUNT(*) AS n FROM targets WHERE user_id = ?', dan.user.id)[0].n, 0);
  for (const u of [ana, ben, cleo]) await call('DELETE', 'me', { key: u.key });
});

await test('partage entre membres : base existante (colonnes ajoutées, index unique, partage activé une seule fois)', async () => {
  // Base dans un fichier : une deuxième instance du serveur peut l'ouvrir (la migration ne doit passer qu'une fois).
  const file = path.join(os.tmpdir(), `classeur-migration-${process.pid}-${Date.now()}.sqlite`);
  const old = { ...makeEnv(), DB: createD1(file) };
  old.DB.sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, key_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
      fetched_at TEXT, new_ids TEXT NOT NULL DEFAULT '[]', cookie_enc TEXT, cookie_updated_at TEXT, session_expired INTEGER NOT NULL DEFAULT 0)`);
  old.DB.sqlite.prepare("INSERT INTO users (id, key_hash, created_at) VALUES ('ancien', ?, '2026-10-01')").run(await sha256Hex('cle-ancienne'));
  let r = await call('GET', 'me', { key: 'cle-ancienne', e: old });
  // Migration du 2026-10-16 : un classeur existant partage ses cartes et ses collections, avec un identifiant public.
  assert.deepEqual([r.status, r.json.shared, r.json.shared_targets], [200, true, true]);
  assert.match(old.DB.sqlite.prepare("SELECT public_id FROM users WHERE id = 'ancien'").get().public_id, /^[0-9a-f]{18}$/);
  assert.equal(old.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM migrations WHERE name = 'partage-par-defaut-2026-10-16'").get().n, 1);
  const cols = old.DB.sqlite.prepare('PRAGMA table_info(users)').all().map((x) => x.name);
  assert.ok(cols.includes('shared') && cols.includes('public_id') && cols.includes('shared_targets'), cols.join(','));
  const idx = old.DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((x) => x.name);
  assert.ok(idx.includes('users_by_public_id'), idx.join(','));
  r = await call('PATCH', 'me', { key: 'cle-ancienne', e: old, body: { shared: true } });
  assert.equal(r.json.shared, true);
  r = await call('GET', 'members', { key: 'cle-ancienne', e: old });
  assert.deepEqual([r.status, r.json], [200, { members: [] }]);
  // Coupé ensuite, il le reste : une autre instance qui démarre sur la même base ne refait pas la migration.
  r = await call('PATCH', 'me', { key: 'cle-ancienne', e: old, body: { shared: false } });
  assert.equal(r.json.shared, false);
  const again = { ...old, DB: createD1(file) };
  r = await call('GET', 'me', { key: 'cle-ancienne', e: again });
  assert.deepEqual([r.status, r.json.shared, r.json.shared_targets], [200, false, false]);
  assert.equal(again.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM migrations').get().n, 1);
  old.DB.close();
  again.DB.close();
  await rm(file, { force: true });
});

// --- Chat (un salon pour tous les classeurs) ------------------------------------------------------------------------

// Chaque test du chat a sa propre base (le salon est commun à tous les comptes d'une base).
function chatEnv() {
  const e = makeEnv();
  const q = (sql, ...p) => e.DB.sqlite.prepare(sql).all(...p).map((r) => ({ ...r }));
  const say = (key, text) => call('POST', 'chat', { key, e, body: { text } });
  const read = (key, qs = '') => call('GET', 'chat' + qs, { key, e });
  const del = (key, id) => call('DELETE', `chat/${id}`, { key, e });
  // Messages en vrac, écrits directement en base (au-delà des limites d'envoi) : n lignes de `user`, datées `at`.
  const bulk = (n, user, at, size = 0) => e.DB.sqlite.exec(`WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < ${n})
    INSERT INTO chat_messages (user_id, text, created_at, deleted, rev)
    SELECT '${user}', 'vrac ' || i || substr(printf('%.${size}c', 'x'), 1, ${size}), '${at}', 0, (SELECT COALESCE(MAX(rev), 0) FROM chat_messages) + i FROM k`);
  return { e, q, say, read, del, bulk };
}
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();

await test('chat : envoi, lecture (100 plus récents, ?after, ?before), auteur = nom actuel du classeur, texte nettoyé, 400', async () => {
  const { e, q, say, read } = chatEnv();
  const ana = await signup('Ana', e);
  const ben = await signup('Ben', e);
  let r = await read(ben.key);
  assert.deepEqual([r.status, r.json], [200, { messages: [], rev: 0, last_id: 0, older: false }]);
  r = await say(ana.key, '  Bonjour\r\n\r\n\r\n\r\nça\tva ?  \nhttps://fr.wikipedia.org/wiki/Mercure_(planète) ‮abc  ');
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const m1 = r.json.message;
  assert.deepEqual({ ...m1, id: 0, created_at: 0 }, { id: 0, author: 'Ana', mine: true, text: 'Bonjour\n\nça va ?\nhttps://fr.wikipedia.org/wiki/Mercure_(planète) abc', created_at: 0 });
  assert.ok(Number.isInteger(m1.id) && m1.id > 0 && !Number.isNaN(Date.parse(m1.created_at)));
  r = await read(ben.key);
  assert.deepEqual(r.json.messages, [{ ...m1, mine: false }]);
  assert.deepEqual([r.json.rev, r.json.last_id, r.json.older], [1, m1.id, false]);
  assert.ok(!JSON.stringify(r.json).includes(ana.user.id), "jamais l'id interne de l'auteur");
  // Le nom est lu à chaque lecture : un classeur renommé l'est aussi dans ses anciens messages.
  await call('PATCH', 'me', { key: ana.key, e, body: { name: 'Anaïs' } });
  r = await read(ben.key);
  assert.equal(r.json.messages[0].author, 'Anaïs');
  const rev = r.json.rev;
  // ?after : seulement ce qui a changé depuis.
  assert.deepEqual((await read(ben.key, `?after=${rev}`)).json, { messages: [], deleted: [], rev, last_id: m1.id, more: false });
  const head = 'Salut 👋 (500 car. pile) ';
  const m2 = (await say(ben.key, head + 'x'.repeat(500 - head.length))).json.message;
  assert.equal(m2.text.length, 500);
  r = await read(ana.key, `?after=${rev}`);
  assert.deepEqual(r.json, { messages: [{ ...m2, mine: false }], deleted: [], rev: rev + 1, last_id: m2.id, more: false });
  // GET /api/me : numéro du dernier message (badge des non-lus).
  assert.equal((await call('GET', 'me', { key: ana.key, e })).json.last_chat_id, m2.id);
  // Révision inconnue (base recréée) : tout relire.
  assert.deepEqual((await read(ana.key, '?after=999')).json, { reset: true, rev: rev + 1, last_id: m2.id });
  // ?before : les plus anciens, par pages de 100, du plus ancien au plus récent.
  for (let i = 0; i < 120; i++) e.DB.sqlite.prepare("INSERT INTO chat_messages (user_id, text, created_at, deleted, rev) VALUES (?, ?, ?, 0, (SELECT MAX(rev) FROM chat_messages) + 1)")
    .run(ben.user.id, `n° ${i}`, hoursAgo(30));
  r = await read(ana.key);
  assert.equal(r.json.messages.length, 100);
  assert.equal(r.json.older, true);
  assert.deepEqual(r.json.messages.map((m) => m.id), [...r.json.messages.map((m) => m.id)].sort((a, b) => a - b), 'du plus ancien au plus récent');
  assert.equal(r.json.messages.at(-1).text, 'n° 119');
  const first = r.json.messages[0].id;
  r = await read(ana.key, `?before=${first}`);
  assert.deepEqual([r.json.messages.length, r.json.older, r.json.messages.at(-1).id < first], [22, false, true]);
  assert.deepEqual(Object.keys(r.json), ['messages', 'older']);
  // Plus de 100 changements : more, et la révision du dernier rendu.
  r = await read(ana.key, '?after=0');
  assert.deepEqual([r.json.messages.length, r.json.more, r.json.rev], [100, true, 100]);
  // Requêtes invalides.
  for (const qs of ['?after=abc', '?after=-1', '?after=1.5', '?before=x', '?after=1&before=2', '?after=1234567890123456']) {
    assert.equal((await read(ana.key, qs)).status, 400, qs);
  }
  for (const [body, re] of [[{}, /un texte/], [{ text: 42 }, /un texte/], [{ text: ' \n\t ' }, /vide/], [{ text: 'y'.repeat(501) }, /500 caractères au plus/],
    [{ text: 'mon lien https://classeur.example/#cle=' + 'A'.repeat(43) }, /lien personnel/]]) {
    r = await call('POST', 'chat', { key: ana.key, e, body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.json.error, re);
  }
  assert.equal((await call('POST', 'chat', { key: ana.key, e, raw: JSON.stringify({ text: 'z'.repeat(9000) }), headers: { 'content-type': 'application/json' } })).status, 413);
  // Classeur sans prénom : il faut en donner un (c'est lui que les autres voient).
  const anon = await signup(undefined, e);
  r = await say(anon.key, 'Coucou');
  assert.equal(r.status, 400);
  assert.match(r.json.error, /prénom/);
  assert.equal(q('SELECT COUNT(*) AS n FROM chat_messages WHERE user_id = ?', anon.user.id)[0].n, 0);
  e.DB.close();
});

await test("chat : suppression par l'auteur seulement (403 sur celui d'un autre, 404), propagée aux pages ouvertes par ?after", async () => {
  const { e, q, say, read, del } = chatEnv();
  const ana = await signup('Ana', e);
  const ben = await signup('Ben', e);
  const a1 = (await say(ana.key, 'Message 1')).json.message;
  const a2 = (await say(ana.key, 'Message 2')).json.message;
  const b1 = (await say(ben.key, 'Réponse')).json.message;
  const { rev } = (await read(ben.key)).json;
  let r = await del(ben.key, a1.id);
  assert.deepEqual([r.status, r.json.error], [403, 'Tu ne peux supprimer que tes propres messages.']);
  r = await del(ana.key, a1.id);
  assert.deepEqual([r.status, r.json], [200, { ok: true }]);
  assert.deepEqual((await del(ana.key, a1.id)).json, { ok: true }, 'déjà supprimé par son auteur : ok');
  assert.equal((await del(ben.key, a1.id)).status, 404, 'supprimé : 404 pour les autres');
  assert.equal((await del(ana.key, 999)).status, 404);
  // Le texte est effacé aussitôt ; la marque fait disparaître le message des pages ouvertes.
  assert.deepEqual(q('SELECT text, deleted FROM chat_messages WHERE id = ?', a1.id), [{ text: '', deleted: 1 }]);
  r = await read(ben.key, `?after=${rev}`);
  assert.deepEqual(r.json, { messages: [], deleted: [a1.id], rev: rev + 1, last_id: b1.id, more: false });
  assert.deepEqual((await read(ben.key)).json.messages.map((m) => m.id), [a2.id, b1.id]);
  // Chemins et méthodes.
  assert.equal((await call('DELETE', 'chat/abc', { key: ana.key, e })).status, 404);
  assert.equal((await call('DELETE', 'chat', { key: ana.key, e })).status, 405);
  assert.equal((await call('GET', `chat/${a2.id}`, { key: ana.key, e })).status, 405);
  assert.equal((await call('POST', `chat/${a2.id}`, { key: ana.key, e, body: {} })).status, 405);
  e.DB.close();
});

await test("chat : clé principale seulement (la clé d'import du favori n'y a pas accès), même origine", async () => {
  const { e, say, read, del } = chatEnv();
  const ana = await signup('Ana', e);
  const m = (await say(ana.key, 'Privé')).json.message;
  const imp = (await call('POST', 'import-key', { key: ana.key, e })).json.import_key;
  for (const r of [await read(imp), await say(imp, 'Depuis le favori'), await del(imp, m.id), await read(undefined), await say(undefined, 'x')]) {
    assert.equal(r.status, 401, JSON.stringify(r.json));
    assert.ok(!JSON.stringify(r.json).includes('Privé'));
  }
  assert.equal((await read(ana.key)).json.messages.length, 1, 'rien envoyé ni supprimé avec la clé du favori');
  const r = await call('GET', 'chat', { key: ana.key, e, headers: { origin: 'https://www.wiki-masters.com' } });
  assert.equal(r.headers.get('access-control-allow-origin'), null, 'pas de CORS pour le jeu');
  e.DB.close();
});

await test('chat : limites (10 par minute, 300 par 24 h et par classeur, 1 000 pour le salon), 429 lisible ; une suppression ne rend rien', async () => {
  const { e, q, say, del, bulk } = chatEnv();
  const ana = await signup('Ana', e);
  const ben = await signup('Ben', e);
  const sent = [];
  for (let i = 0; i < 10; i++) {
    const r = await say(ana.key, `n° ${i}`);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    sent.push(r.json.message.id);
  }
  let r = await say(ana.key, 'un de trop');
  assert.equal(r.status, 429);
  assert.match(r.json.error, /^Doucement : 10 messages par minute au plus\. Réessaie dans \d+ s\.$/);
  assert.ok(r.json.retry_after >= 1 && r.json.retry_after <= 60, String(r.json.retry_after));
  for (const id of sent) await del(ana.key, id);
  assert.equal((await say(ana.key, 'après suppression')).status, 429, 'supprimer ne rend pas de message');
  assert.equal((await say(ben.key, 'Ben, lui, peut')).status, 201, 'limite par classeur');
  // 300 en 24 h (les dix de la dernière minute vieillis de 2 minutes, 290 de plus il y a 3 heures).
  e.DB.sqlite.prepare('UPDATE chat_messages SET created_at = ? WHERE user_id = ?').run(hoursAgo(0.04), ana.user.id);
  bulk(290, ana.user.id, hoursAgo(3));
  r = await say(ana.key, 'trois cent unième');
  assert.equal(r.status, 429);
  assert.match(r.json.error, /300 messages en 24 heures/);
  assert.ok(r.json.retry_after > 20 * 3600, String(r.json.retry_after));
  // Vieillis de plus de 24 h : de nouveau permis.
  e.DB.sqlite.prepare('UPDATE chat_messages SET created_at = ? WHERE user_id = ?').run(hoursAgo(25), ana.user.id);
  assert.equal((await say(ana.key, 'le lendemain')).status, 201);
  // Salon : 1 000 messages en 24 h, toutes personnes confondues.
  bulk(1000, 'quelqu-un', hoursAgo(1));
  r = await say(ben.key, 'salon plein');
  assert.equal(r.status, 429);
  assert.match(r.json.error, /Le chat a reçu 1\s000 messages en 24 heures/);
  e.DB.sqlite.prepare("UPDATE chat_messages SET created_at = ? WHERE user_id = 'quelqu-un'").run(hoursAgo(25));
  assert.equal((await say(ben.key, 'de nouveau')).status, 201);
  assert.equal(q("SELECT COUNT(*) AS n FROM chat_messages WHERE text LIKE '%de trop%' OR text = 'salon plein'")[0].n, 0, 'rien écrit pour un envoi refusé');
  e.DB.close();
});

await test('chat : purge (les 2 000 plus récents gardés, à chaque envoi), numéros jamais réutilisés', async () => {
  const { e, q, say, read, bulk } = chatEnv();
  const ana = await signup('Ana', e);
  bulk(1995, 'ancien', hoursAgo(48));
  const ids = [];
  for (let i = 0; i < 8; i++) ids.push((await say(ana.key, `récent ${i}`)).json.message.id);
  const [{ n, lo, hi }] = q('SELECT COUNT(*) AS n, MIN(id) AS lo, MAX(id) AS hi FROM chat_messages');
  assert.deepEqual([n, hi - lo + 1, hi], [2000, 2000, 2003]);
  assert.deepEqual(ids, [1996, 1997, 1998, 1999, 2000, 2001, 2002, 2003]);
  assert.equal(q("SELECT COUNT(*) AS n FROM chat_messages WHERE text IN ('vrac 1', 'vrac 2', 'vrac 3')")[0].n, 0, 'les plus anciens sont partis');
  // Le plus récent n'est jamais effacé : le numéro suivant ne revient pas en arrière.
  const r = await read(ana.key);
  assert.deepEqual([r.json.last_id, r.json.messages.at(-1).text, r.json.older], [2003, 'récent 7', true]);
  e.DB.close();
});

await test("chat : DELETE /api/me vide ses messages et oublie l'auteur (retirés des pages ouvertes), ceux des autres restent", async () => {
  const { e, q, say, read } = chatEnv();
  const ana = await signup('Ana', e);
  const cleo = await signup('Cléo', e);
  const c1 = (await say(cleo.key, 'Je pars bientôt')).json.message;
  const a1 = (await say(ana.key, 'Dommage !')).json.message;
  const c2 = (await say(cleo.key, 'Au revoir')).json.message;
  const { rev } = (await read(ana.key)).json;
  assert.deepEqual((await call('DELETE', 'me', { key: cleo.key, e })).json, { ok: true });
  assert.deepEqual(q('SELECT id, user_id, text, deleted FROM chat_messages ORDER BY id'), [
    { id: c1.id, user_id: '', text: '', deleted: 1 }, { id: a1.id, user_id: ana.user.id, text: 'Dommage !', deleted: 0 }, { id: c2.id, user_id: '', text: '', deleted: 1 }]);
  const r = (await read(ana.key, `?after=${rev}`)).json;
  assert.deepEqual([r.messages, r.deleted.sort((x, y) => x - y), r.more], [[], [c1.id, c2.id], false]);
  assert.equal(new Set(q('SELECT rev FROM chat_messages').map((x) => x.rev)).size, 3, 'révisions uniques');
  assert.deepEqual((await read(ana.key)).json.messages.map((m) => m.text), ['Dommage !']);
  e.DB.close();
});

await test('chat : coût (index chat_by_rev pour ?after, MAX en une ligne, limites par chat_by_user, purge par la clé primaire, CPU)', async () => {
  const { e, say, read, bulk } = chatEnv();
  const ana = await signup('Ana', e);
  const ben = await signup('Ben', e);
  bulk(1890, ben.user.id, hoursAgo(48));
  bulk(100, ana.user.id, hoursAgo(47), 490); // la page la plus lourde : 100 messages de ~500 caractères
  for (let i = 0; i < 5; i++) await say(ana.key, 'x'.repeat(480) + i);
  const { rev } = (await read(ben.key)).json;
  const seen = [];
  const spy = { ...e, DB: { prepare: (sql) => { seen.push(sql); return e.DB.prepare(sql); }, batch: (s) => e.DB.batch(s) } };
  const planOf = (sql) => e.DB.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((x) => x.detail);
  await call('GET', 'me', { key: ben.key, e: spy }); // schéma appliqué une fois pour cette base espionnée
  seen.length = 0;
  // Relecture d'une page ouverte (toutes les 12 s) : le compte, puis MAX(rev), MAX(id) et les changements par l'index.
  await call('GET', `chat?after=${rev}`, { key: ben.key, e: spy });
  assert.equal(seen.length, 3, seen.join('\n'));
  assert.deepEqual(planOf(seen[1]), ['SCAN CONSTANT ROW', 'SCALAR SUBQUERY 1', 'SEARCH chat_messages USING COVERING INDEX chat_by_rev', 'SCALAR SUBQUERY 2', 'SEARCH chat_messages']);
  const after = planOf(seen[2]);
  assert.match(after[0], /^SEARCH m USING INDEX chat_by_rev \(rev>\?\)$/, after.join('\n'));
  assert.match(after[1], /^SEARCH u USING INDEX sqlite_autoindex_users_1 \(id=\?\)( LEFT-JOIN)?$/, after.join('\n'));
  assert.equal(after.length, 2, after.join('\n'));
  // Première lecture : les plus récents dans l'ordre de la clé primaire (sans tri), arrêt après 101.
  seen.length = 0;
  await call('GET', 'chat', { key: ben.key, e: spy });
  const latest = planOf(seen[2]);
  assert.deepEqual(latest.map((l) => l.replace(/ \(.*$/, '')), ['SCAN m', 'SEARCH u USING INDEX sqlite_autoindex_users_1'], latest.join('\n'));
  seen.length = 0;
  await call('GET', 'chat?before=500', { key: ben.key, e: spy });
  assert.match(planOf(seen[1])[0], /^SEARCH m USING INTEGER PRIMARY KEY \(rowid<\?\)$/);
  // Envoi : limites par l'index (user_id, created_at), rien de parcouru en entier ; purge par la clé primaire.
  seen.length = 0;
  await call('POST', 'chat', { key: ana.key, e: spy, body: { text: 'mesure' } });
  const ins = planOf(seen.find((s) => s.startsWith('INSERT INTO chat_messages')));
  assert.ok(ins.filter((l) => /chat_messages/.test(l)).every((l) => /^SEARCH chat_messages USING (COVERING INDEX chat_by_(user|rev)\b|INTEGER PRIMARY KEY )|^SEARCH chat_messages$/.test(l)), ins.join('\n'));
  assert.ok(ins.some((l) => /COVERING INDEX chat_by_user \(user_id=\? AND created_at>\?\)/.test(l)), ins.join('\n'));
  const purge = planOf(seen.find((s) => s.startsWith('DELETE FROM chat_messages')));
  assert.ok(purge.some((l) => /^SEARCH chat_messages USING INTEGER PRIMARY KEY \(rowid<\?\)$/.test(l)), purge.join('\n'));
  // Seuls parcours : la ligne constante du SELECT et les sous-requêtes bornées par leur LIMIT (10 et 300 lignes au plus).
  assert.ok(!purge.concat(ins).some((l) => /^SCAN (?!CONSTANT ROW$|\(subquery-\d+\)$)/.test(l)), 'aucun parcours complet : ' + ins.join(' / '));
  // Effacement des messages d'un compte (DELETE /api/me) : par l'index de l'auteur.
  assert.ok(planOf("UPDATE chat_messages SET text = '' WHERE user_id = ?1").some((l) => /USING INDEX chat_by_user \(user_id=\?\)/.test(l)));
  // JavaScript : rejeu des appels enregistrés (voir profile).
  const poll = await profile('GET', `chat?after=${rev}`, { key: ben.key, e, n: 200 });
  const first = await profile('GET', 'chat', { key: ben.key, e, n: 200 });
  const post = await profile('POST', 'chat', { key: ben.key, e, body: { text: 'y'.repeat(500) }, n: 200 });
  const me = await profile('GET', 'me', { key: ben.key, e, n: 200 });
  assert.deepEqual([poll.status, first.status, post.status, me.status], [200, 200, 201, 200]);
  assert.equal(first.json.messages.length, 100);
  console.log(`    chat : relecture ?after JS ${ms(poll.js)} | 100 messages JS ${ms(first.js)} (${Math.round(first.size / 1024)} Ko) | envoi JS ${ms(post.js)} | GET /api/me JS ${ms(me.js)}`);
  assert.ok(poll.js < 10 && first.js < 10 && post.js < 10 && me.js < 10, 'trop de JavaScript');
  e.DB.close();
});

// --- Marché : cotes (cache commun), plan du favori, valeur jour par jour, lecture du marché -----------------------

// Compte neuf dans une base à part (e), avec sa clé d'import.
async function marketAccount(e, name) {
  const u = (await call('POST', 'account', { body: { code: 'invitation', name }, e })).json;
  u.importKey = (await call('POST', 'import-key', { key: u.key, e })).json.import_key;
  return u;
}
const gameOrigin = { origin: 'https://www.wiki-masters.com' };
const cote = (p, n, extra = {}) => ({ p, n, w: null, l: p, d: '2026-10-15T10:00:00.000Z', ...extra });
const mcard = (id, title, rarity, count, extra = {}) => ({ id, title, rarity, count, ...extra });
const todayUtc = () => new Date().toISOString().slice(0, 10);

await test('marché : exemplaires par rareté et brillance (variants) gardés à l\'import, additionnés en synchro rapide', async () => {
  const e = makeEnv();
  const q = (sql, ...p) => e.DB.sqlite.prepare(sql).all(...p).map((r) => ({ ...r }));
  const u = await marketAccount(e, 'Vic');
  const data = (id) => JSON.parse(q('SELECT data FROM cards WHERE user_id = ? AND card_id = ?', u.user.id, id)[0].data);
  // CarteImport du favori : variants rangé (clés dans l'ordre binaire) ; somme fausse ou rareté inconnue : oublié, la carte reste.
  let r = await call('POST', 'import', { key: u.importKey, e, body: { cards: [
    mcard('a', 'Alpha', 'R', 3, { variants: { R: 2, 'C*': 1 } }),
    mcard('b', 'Bêta', 'C', 2, { variants: { C: 1 } }),
    mcard('c', 'Gamma', 'C', 1, { variants: { X: 1 } }),
    mcard('d', 'Delta', 'L', 1),
  ], stats: { total: 7, totalUnique: 4 }, rows: 7, copies: 7, last_at: '2026-10-15T09:00:00.000Z' } });
  assert.equal(r.json.count, 4);
  assert.deepEqual(data('a').variants, { 'C*': 1, R: 2 });
  assert.deepEqual(Object.keys(data('a')).slice(-1), ['variants'], 'variants en dernier');
  for (const id of ['b', 'c', 'd']) assert.equal('variants' in data(id), false, id);
  // Synchro rapide : additionnés quand les deux côtés les ont ; sinon la carte n'en a plus (jamais « variants: null »).
  r = await call('POST', 'import', { key: u.importKey, e, body: { mode: 'delta', rows: 3, copies: 3, stats: { total: 10, totalUnique: 5 }, last_at: '2026-10-16T09:00:00.000Z', cards: [
    mcard('a', 'Alpha', 'R', 1, { variants: { 'R*': 1 } }), mcard('d', 'Delta', 'L', 1, { variants: { L: 1 } }), mcard('e', 'Epsilon', 'SR', 1, { variants: { SR: 1 } }),
  ] } });
  assert.equal(r.json.quick, true, JSON.stringify(r.json));
  assert.deepEqual(data('a').variants, { 'C*': 1, R: 2, 'R*': 1 });
  assert.equal(data('a').count, 4);
  assert.equal('variants' in data('d'), false, 'une carte sans détail ne le reçoit pas à moitié');
  assert.equal(data('d').count, 2);
  assert.deepEqual(data('e').variants, { SR: 1 });
  // Entrées brutes (rafraîchissement par cookie, ancien favori) : la rareté de l'exemplaire est son snapshot_rarity.
  const rawE = (id, n, extra, card = {}) => ({ id, card_id: 'z', count: n, is_shiny: false, obtained_at: '2026-10-01T00:00:00.000Z', ...extra,
    card: { id: 'z', wikipedia_title: 'Zêta', rarity: 'UR', ...card } });
  r = await call('POST', 'import', { key: u.key, e, body: { collection: [rawE('z1', 2, { snapshot_rarity: 'R' }), rawE('z2', 1, { is_shiny: true }), rawE('z3', 1, { snapshot_rarity: 'X' })] } });
  assert.equal(r.json.count, 1);
  assert.deepEqual(data('z').variants, { R: 2, UR: 1, 'UR*': 1 });
  assert.equal(data('z').rarity, 'UR');
  e.DB.close();
});

await test('marché : cotes validées, sans user_id, clé d\'import (CORS du jeu), quotas du jour par classeur et pour le site', async () => {
  const e = makeEnv();
  const q = (sql, ...p) => e.DB.sqlite.prepare(sql).all(...p).map((r) => ({ ...r }));
  const u = await marketAccount(e, 'Mia');
  const post = (body, key = u.importKey, headers = gameOrigin) => call('POST', 'market/prices', { key, e, body, headers });
  // Membres seulement : sans clé ou clé inconnue, 401 ; la clé d'import n'ouvre ni la valeur ni les cotes du classeur.
  for (const [m, p, key] of [['POST', 'market/prices', null], ['POST', 'market/prices', 'x'.repeat(43)], ['POST', 'market/plan', null], ['POST', 'market/live', null],
    ['GET', 'market', null], ['GET', 'market', u.importKey], ['GET', 'market/prices', u.importKey], ['GET', 'market/prices', null]]) {
    assert.equal((await call(m, p, { key, e, body: m === 'POST' ? { prices: [] } : undefined })).status, 401, `${m} ${p} ${key ? 'clé' : 'sans clé'}`);
  }
  // Formes refusées en entier (400, rien d'écrit).
  const ok = { id: 'carte-1', v: { R: cote(120, 5), 'R*': cote(800, 1) } };
  for (const [why, prices] of [
    ['rareté inconnue', [{ id: 'carte-1', v: { X: cote(1, 3) } }]],
    ['montant négatif', [{ id: 'carte-1', v: { R: cote(-1, 3) } }]],
    ['montant démesuré', [{ id: 'carte-1', v: { R: cote(2e9, 3) } }]],
    ['aucune vente', [{ id: 'carte-1', v: { R: cote(5, 0) } }]],
    ['ventes non entières', [{ id: 'carte-1', v: { R: cote(5, 2.5) } }]],
    ['date', [{ id: 'carte-1', v: { R: cote(5, 3, { d: 'hier' }) } }]],
    ['date à venir', [{ id: 'carte-1', v: { R: cote(5, 3, { d: '2099-01-01T00:00:00.000Z' }) } }]],
    ['identifiant', [{ id: 'a b', v: {} }]],
    ['deux fois', [ok, ok]],
    ['trop', Array.from({ length: 501 }, (_, i) => ({ id: `m${i}`, v: {} }))],
    ['trop de raretés', [{ id: 'carte-1', v: Object.fromEntries(['C', 'PC', 'R', 'SR', 'UR', 'L'].flatMap((x) => [[x, cote(1, 3)], [x + '*', cote(1, 3)], [x + '**', cote(1, 3)]])) }]],
  ]) {
    const r = await post({ prices });
    assert.equal(r.status, 400, why);
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://www.wiki-masters.com', `CORS sur l'erreur (${why})`);
  }
  assert.equal(q('SELECT COUNT(*) AS n FROM prices')[0].n, 0);
  let r = await post({ prices: [ok, { id: 'carte-2', v: {} }] });
  assert.deepEqual([r.status, r.json.written], [200, 2], JSON.stringify(r.json));
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://www.wiki-masters.com');
  r = await call('OPTIONS', 'market/prices', { e, headers: { ...gameOrigin, 'access-control-request-method': 'POST' } });
  assert.deepEqual([r.status, r.headers.get('access-control-allow-origin')], [204, 'https://www.wiki-masters.com']);
  r = await call('OPTIONS', 'market/plan', { e, headers: { origin: 'https://evil.example' } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  // Une cote n'est liée à aucun classeur : pas de user_id, rien de l'utilisateur dans la table.
  assert.deepEqual(Object.keys(q('SELECT * FROM prices')[0]), ['card_id', 'data', 'read_at']);
  assert.ok(!JSON.stringify(q('SELECT * FROM prices')).includes(u.user.id));
  assert.deepEqual(JSON.parse(q("SELECT data FROM prices WHERE card_id = 'carte-1'")[0].data), { R: cote(120, 5), 'R*': cote(800, 1) });
  // Quota du classeur : 3 000 cotes par jour (2 déjà) ; au-delà 429, rien d'écrit pour cet envoi.
  for (let k = 0; k < 5; k++) {
    r = await post({ prices: Array.from({ length: 500 }, (_, i) => ({ id: `q${k}-${i}`, v: {} })) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  assert.equal(r.json.quota, 498);
  r = await post({ prices: Array.from({ length: 499 }, (_, i) => ({ id: `q9-${i}`, v: {} })) });
  assert.equal(r.status, 429);
  assert.match(r.json.error, /Quota du jour des cotes atteint/);
  assert.equal(q("SELECT COUNT(*) AS n FROM prices WHERE card_id LIKE 'q9-%'")[0].n, 0);
  assert.equal((await post({ prices: Array.from({ length: 498 }, (_, i) => ({ id: `q9-${i}`, v: {} })) })).status, 200);
  assert.equal((await post({ prices: [{ id: 'encore', v: {} }] })).status, 429);
  // Le lendemain, le compte repart de zéro.
  e.DB.sqlite.prepare("UPDATE market SET quota_day = '2000-01-01'").run();
  assert.equal((await post({ prices: [{ id: 'lendemain', v: {} }] })).status, 200);
  // Quota du site (tous les classeurs) : un autre classeur est refusé aussi quand il est atteint.
  const v = await marketAccount(e, 'Noé');
  e.DB.sqlite.prepare("UPDATE market SET quota_n = 29999, quota_day = ? WHERE user_id = '*'").run(todayUtc());
  assert.equal((await post({ prices: [{ id: 'n1', v: {} }, { id: 'n2', v: {} }] }, v.importKey)).status, 429);
  assert.equal((await post({ prices: [{ id: 'n1', v: {} }] }, v.importKey)).status, 200);
  // La clé principale marche aussi (comme pour /api/import).
  e.DB.sqlite.prepare('UPDATE market SET quota_n = 0').run();
  assert.equal((await post({ prices: [{ id: 'n3', v: {} }] }, v.key, {})).status, 200);
  e.DB.close();
});

await test('marché : plan du favori (cotes les plus anciennes d\'abord, cartes voulues d\'après les collections)', async () => {
  const e = makeEnv();
  const u = await marketAccount(e, 'Paz');
  await call('POST', 'import', { key: u.key, e, body: { cards: [mcard('own-a', 'Alpha', 'C', 1), mcard('own-b', 'Bêta', 'C', 1), mcard('own-c', 'Gamma', 'C', 1), mcard('own-d', 'Delta', 'C', 1)] } });
  const item = (title, status = 'ok') => ({ title, description: null, image: null, status });
  await call('POST', 'targets/save', { key: u.key, e, body: { name: 'Ancienne', items: [item('Alpha'), item('Omega'), item('Introuvable', 'missing')] } });
  await call('POST', 'targets/save', { key: u.key, e, body: { name: 'Récente', items: [item('Psi'), item('Bêta'), item('Omega'), item('Chi')] } });
  e.DB.sqlite.prepare("UPDATE targets SET updated_at = '2026-01-01T00:00:00.000Z' WHERE name = 'Ancienne'").run();
  // Cotes : own-a fraîche (pas relue), own-b de plus de 12 h, own-c lue il y a très longtemps, own-d jamais.
  await call('POST', 'market/prices', { key: u.importKey, e, body: { prices: ['own-a', 'own-b', 'own-c'].map((id) => ({ id, v: {} })) } });
  e.DB.sqlite.prepare("UPDATE prices SET read_at = '2026-10-15T00:00:00.000Z' WHERE card_id = 'own-b'").run();
  e.DB.sqlite.prepare("UPDATE prices SET read_at = '2026-09-01T00:00:00.000Z' WHERE card_id = 'own-c'").run();
  let r = await call('POST', 'market/plan', { key: u.importKey, e, body: {}, headers: gameOrigin });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://www.wiki-masters.com');
  assert.deepEqual(r.json, { cards: ['own-d', 'own-c', 'own-b'], stale: 3, fresh: 1, wanted: ['Psi', 'Omega', 'Chi'], ids: {}, quota: 3000 - 3 });
  // Titres résolus par le favori (live) : les voulus connus entrent au plan (après les possédées à égalité).
  r = await call('POST', 'market/live', { key: u.importKey, e, headers: gameOrigin, body: { ids: { Psi: 'w-psi', Chi: '', Ailleurs: 'w-x' } } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = await call('POST', 'market/plan', { key: u.importKey, e, body: {} });
  assert.deepEqual([r.json.cards, r.json.ids], [['own-d', 'w-psi', 'w-x', 'own-c', 'own-b'], { Psi: 'w-psi', Chi: '' }]);
  // La clé d'import ne lit que ce plan : rien d'autre du classeur (ni noms des collections, ni titres des cartes possédées).
  assert.ok(!JSON.stringify(r.json).includes('Ancienne') && !JSON.stringify(r.json).includes('Alpha'));
  e.DB.close();
});

await test('marché : valeur du classeur (cotes fiables × exemplaires, un point par jour), après les cotes et les imports', async () => {
  const e = makeEnv();
  const q = (sql, ...p) => e.DB.sqlite.prepare(sql).all(...p).map((r) => ({ ...r }));
  const u = await marketAccount(e, 'Rui');
  const market = async () => (await call('GET', 'market', { key: u.key, e })).json;
  // Sans cote : valeur 0, aucun point écrit.
  await call('POST', 'import', { key: u.key, e, body: { cards: [
    mcard('a', 'Alpha', 'R', 3, { variants: { R: 2, 'R*': 1 } }),
    mcard('b', 'Bêta', 'C', 2, { shiny: true }), // sans détail : approchée (1 brillante, le reste dans sa rareté)
    mcard('c', 'Gamma', 'L', 1, { variants: { L: 1 } }), // pas encore cotée
  ] } });
  let m = await market();
  assert.deepEqual([m.value, m.history, m.live], [{ value: 0, priced: 0, cards: 3, approx: 1 }, [], null]);
  assert.equal(q('SELECT COUNT(*) AS n FROM value_history')[0].n, 0);
  // Cotes : R* n'a que 2 ventes (pas fiable, hors valeur).
  const r = await call('POST', 'market/prices', { key: u.importKey, e, body: { last: true, prices: [
    { id: 'a', v: { R: cote(100, 5), 'R*': cote(500, 2) } }, { id: 'b', v: { C: cote(10, 3), 'C*': cote(50, 4) } },
  ] } });
  assert.equal(r.status, 200);
  const points = () => q('SELECT date, value, priced, cards, at FROM value_history WHERE user_id = ?', u.user.id);
  const todayPoint = () => points().find((p) => p.date === todayUtc());
  assert.deepEqual(points().map(({ at, ...p }) => p), [{ date: todayUtc(), value: 2 * 100 + 10 + 50, priced: 2, cards: 3 }]);
  m = await market();
  assert.deepEqual(m.value, { value: 260, priced: 2, cards: 3, approx: 1 });
  assert.equal(m.history.length, 1);
  // Le dernier calcul du jour remplace le précédent (un point par jour) ; un jour passé reste.
  e.DB.sqlite.prepare("INSERT INTO value_history (user_id, date, value, priced, cards, at) VALUES (?, '2026-10-10', 111, 1, 3, '2026-10-10T20:00:00.000Z')").run(u.user.id);
  await call('POST', 'market/prices', { key: u.importKey, e, body: { last: true, prices: [{ id: 'c', v: { L: cote(1000, 3) } }] } });
  m = await market();
  assert.deepEqual(m.history.map((p) => [p.date, p.value]), [['2026-10-10', 111], [todayUtc(), 1260]]);
  assert.equal(points().length, 2);
  // Cotes relues par un autre membre : GET /api/market recalcule et met le point du jour à jour.
  const v = await marketAccount(e, 'Sol');
  await call('POST', 'market/prices', { key: v.importKey, e, body: { prices: [{ id: 'a', v: { R: cote(200, 5) } }] } });
  m = await market();
  assert.equal(m.value.value, 2 * 200 + 60 + 1000);
  assert.equal(todayPoint().value, 1460);
  // Après un import : recalculée au plus une fois par heure.
  const at0 = todayPoint().at;
  await call('POST', 'import', { key: u.key, e, body: { cards: [mcard('a', 'Alpha', 'R', 4, { variants: { R: 4 } }), mcard('c', 'Gamma', 'L', 1, { variants: { L: 1 } })] } });
  assert.equal(todayPoint().at, at0, "moins d'une heure : pas recalculée");
  e.DB.sqlite.prepare("UPDATE value_history SET at = '2026-01-01T00:00:00.000Z' WHERE date <> '2026-10-10'").run();
  await call('POST', 'import', { key: u.key, e, body: { cards: [mcard('a', 'Alpha', 'R', 5, { variants: { R: 5 } }), mcard('c', 'Gamma', 'L', 1, { variants: { L: 1 } })] } });
  assert.deepEqual([todayPoint().value, todayPoint().cards], [5 * 200 + 1000, 2]);
  e.DB.close();
});

await test('marché : lecture du marché du favori (validée, montrée par GET /api/market, oubliée au bout de 24 h)', async () => {
  const e = makeEnv();
  const q = (sql, ...p) => e.DB.sqlite.prepare(sql).all(...p).map((r) => ({ ...r }));
  const u = await marketAccount(e, 'Tom');
  const base = { a: 'enchere-1', id: 'carte-9', t: 'Neuf', r: 'SR', s: false, img: 'https://upload.wikimedia.org/x.jpg', end: '2026-10-16T12:00:00.000Z', cote: 300, n: 7 };
  const live = {
    deals: [{ ...base, ask: 200, bid: true, lead: false }],
    bids: [{ ...base, a: 'enchere-2', mine: 150, cur: 180, lead: false, st: 'run' }],
    sales: [{ ...base, a: 'enchere-3', img: null, cote: null, n: null, base: 100, cur: null, bid: false, st: 'unsold' }],
  };
  let r = await call('POST', 'market/live', { key: u.importKey, e, headers: gameOrigin, body: live });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  let m = (await call('GET', 'market', { key: u.key, e })).json;
  assert.deepEqual(m.live, live);
  assert.ok(m.live_at);
  for (const [why, body] of [
    ['état inconnu', { bids: [{ ...live.bids[0], st: 'gagné' }] }],
    ['image non https', { deals: [{ ...live.deals[0], img: 'javascript:alert(1)' }] }],
    ['montant', { deals: [{ ...live.deals[0], ask: -5 }] }],
    ['trop', { deals: Array.from({ length: 51 }, () => live.deals[0]) }],
    ['ids', { ids: { Titre: 'a b' } }],
  ]) {
    assert.equal((await call('POST', 'market/live', { key: u.importKey, e, body })).status, 400, why);
  }
  // Rien de l'identité du joueur dans le jeu : les champs inconnus sont oubliés.
  await call('POST', 'market/live', { key: u.importKey, e, body: { bids: [{ ...live.bids[0], bidder_id: GAME_USER }] } });
  assert.ok(!q('SELECT live FROM market')[0].live.includes(GAME_USER));
  // Plus de 24 h : plus montrée, et effacée au passage d'un autre favori.
  e.DB.sqlite.prepare("UPDATE market SET live_at = '2026-01-01T00:00:00.000Z' WHERE user_id = ?").run(u.user.id);
  m = (await call('GET', 'market', { key: u.key, e })).json;
  assert.equal(m.live, null);
  const v = await marketAccount(e, 'Ugo');
  await call('POST', 'market/live', { key: v.importKey, e, body: {} });
  assert.deepEqual(q('SELECT live, live_at FROM market WHERE user_id = ?', u.user.id), [{ live: null, live_at: null }]);
  // Supprimer son classeur efface sa lecture du marché et sa valeur ; les cotes (communes) restent.
  await call('POST', 'market/prices', { key: u.importKey, e, body: { prices: [{ id: 'carte-9', v: { SR: cote(300, 7) } }] } });
  e.DB.sqlite.prepare("INSERT INTO value_history (user_id, date, value, priced, cards, at) VALUES (?, '2026-10-10', 1, 1, 1, 'x')").run(u.user.id);
  await call('DELETE', 'me', { key: u.key, e });
  for (const t of ['market', 'value_history']) assert.equal(q(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`, u.user.id)[0].n, 0, t);
  assert.equal(q("SELECT COUNT(*) AS n FROM prices WHERE card_id = 'carte-9'")[0].n, 1);
  e.DB.close();
});

await test('marché : GET /api/market/prices (cotes de mes cartes et des cartes voulues, par pages) et mesures de CPU', async () => {
  const e = makeEnv();
  const u = await marketAccount(e, 'Val');
  const cards = mini(1500);
  for (let p = 0; p * 500 < cards.length; p++) {
    await call('POST', 'import', { key: u.key, e, body: { upload_id: 'v', part: p, last: (p + 1) * 500 >= cards.length, cards: cards.slice(p * 500, (p + 1) * 500) } });
  }
  const entries = (list) => list.map((c, i) => ({ id: c.id, v: i % 3 ? { C: cote(10 + i, 5, { w: 9 }), 'C*': cote(99, 1) } : {} }));
  const runs = [];
  for (let p = 0; p < 3; p++) runs.push(await profile('POST', 'market/prices', { key: u.importKey, e, body: { prices: entries(cards.slice(p * 500, (p + 1) * 500)), last: p === 2 } }));
  await call('POST', 'market/live', { key: u.importKey, e, body: { ids: { 'Voulue 1': 'voulue-1', 'Voulue 2': 'voulue-2' } } });
  await call('POST', 'market/prices', { key: u.importKey, e, body: { prices: [{ id: 'voulue-1', v: { R: cote(70, 4) } }] } });
  const all = [];
  const pages = [];
  let part = '0';
  for (let guard = 0; guard < 10 && part !== null; guard++) {
    const r = await profile('GET', `market/prices?part=${encodeURIComponent(part)}`, { key: u.key, e });
    assert.equal(r.status, 200, r.text.slice(0, 200));
    pages.push(r);
    all.push(...r.json.prices);
    part = r.json.next_part;
  }
  assert.equal(pages.length, 2);
  assert.equal(all.length, 1501);
  const w = all.find((x) => x.id === 'voulue-1');
  assert.deepEqual(w, { id: 'voulue-1', v: { R: cote(70, 4) }, at: w.at, t: 'Voulue 1' });
  assert.deepEqual(all.find((x) => x.id === cards[1].id).v, { C: cote(11, 5, { w: 9 }), 'C*': cote(99, 1) });
  const plan = await profile('POST', 'market/plan', { key: u.importKey, e, body: {} });
  const value = await profile('GET', 'market', { key: u.key, e });
  assert.equal(value.json.value.cards, 1500);
  const js = (list) => mean(list.map((x) => x.js));
  console.log(`    marché : 500 cotes JS ${ms(js(runs))} | page de 1 000 cotes JS ${ms(pages[0].js)} | plan JS ${ms(plan.js)} | valeur JS ${ms(value.js)} (SQLite ${ms(value.sql)})`);
  assert.ok(js(runs) < 10 && pages[0].js < 10 && plan.js < 10 && value.js < 10, 'trop de JavaScript');
  e.DB.close();
});

await test('DELETE /api/me efface tout', async () => {
  await call('POST', 'session', { key: alice.key, body: { cookie: 'sid=1' } });
  await call('POST', 'import', { key: alice.key, body: { upload_id: 'en-cours', part: 0, last: false, cards: synth(3) } });
  await call('POST', 'targets/save', { key: alice.key, body: { name: 'À effacer', items: [] } });
  assert.ok(rows('SELECT COUNT(*) AS n FROM cards_gone WHERE user_id = ?', alice.user.id)[0].n > 0, 'des cartes retirées à effacer');
  const r = await call('DELETE', 'me', { key: alice.key });
  assert.deepEqual(r.json, { ok: true });
  for (const t of ['cards', 'cards_gone', 'tags', 'targets', 'refresh_staging', 'import_staging']) {
    assert.equal(rows(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`, alice.user.id)[0].n, 0, t);
  }
  assert.equal(rows('SELECT COUNT(*) AS n FROM users WHERE id = ?', alice.user.id)[0].n, 0);
  assert.equal((await call('GET', 'me', { key: alice.key })).status, 401);
  assert.equal((await call('GET', 'me', { key: bob.key })).status, 200, 'les autres comptes restent');
});

globalThis.fetch = realFetch;
console.log(`${results.length} tests`);
console.log('API OK');
