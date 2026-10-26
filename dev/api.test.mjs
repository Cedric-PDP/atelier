// Tests de l'API : appelle onRequest directement, D1 simulée en mémoire, base du jeu simulée (dev/supabase.mjs).
//   node dev/api.test.mjs      → doit finir par « API OK »

import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createD1 } from './d1.mjs';
import { ANON, mockSupabase, rowOf } from './supabase.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const lib = (f) => pathToFileURL(path.join(root, 'site', 'functions', f)).href;
const { onRequest } = await import(lib('api/[[path]].js'));
const { SCHEMA, ensureSchema } = await import(lib('_lib/db.js'));
const { decryptCookie } = await import(lib('_lib/session.js'));
const { openSession, renewSession, sealSession, sessionOf } = await import(lib('_lib/game.js'));
const { REFRESH_SOURCE, finalizeImport } = await import(lib('_lib/import.js'));
const { sha256Hex } = await import(lib('_lib/util.js'));
const { COLLECTION_CRON, MARKET_CRON, runCron } = await import(lib('_lib/cron.js'));
const { marketPass } = await import(lib('_lib/marketread.js'));
const { FRIEND_ROUTE } = await import(lib('_lib/friends.js'));
const { WISH_ROUTE, wishPass } = await import(lib('_lib/wishlist.js'));
const { syncAutoTags, autoTagLinks } = await import(lib('_lib/autotag.js'));

const SECRET = 'secret-de-test';
const GAME_USER = 'joueur-du-jeu-0b5e7c';
const owned = JSON.parse(await readFile(path.join(root, 'data', 'owned.json'), 'utf8')).cards;
const supa = mockSupabase();

function makeEnv(extra = {}) {
  return { DB: createD1(':memory:'), COOKIE_SECRET: SECRET, SIGNUP_CODE: 'invitation', REFRESH_PAUSE_MS: '0', ...extra };
}
let env = makeEnv();

// waits : tableau qui reçoit ce que la route lance après sa réponse (waitUntil), à attendre par le test.
async function call(method, route, { body, key, headers = {}, raw, e = env, waits = null } = {}) {
  const h = new Headers(headers);
  if (key) h.set('x-classeur-key', key);
  let payload = raw;
  if (payload === undefined && body !== undefined) {
    payload = JSON.stringify(body);
    h.set('content-type', 'application/json');
  }
  const request = new Request(`http://localhost:8788/api/${route}`, { method, headers: h, body: payload });
  const res = await onRequest({ request, env: e, params: {}, waitUntil(p) { if (waits) waits.push(p); } });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
}

const rows = (sql, ...p) => env.DB.sqlite.prepare(sql).all(...p).map((r) => ({ ...r }));
const userRow = (id, e = env) => ({ ...e.DB.sqlite.prepare('SELECT * FROM users WHERE id = ?').get(id) });

// Écritures sur la table cards, comptées par des déclencheurs (pour vérifier qu'une lecture n'écrit que les différences).
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

// Ligne user_cards de la base du jeu (carte et tags embarqués), fabriquée depuis une carte de data/owned.json.
function rawEntry(card, extra = {}) {
  return {
    id: `entree-${card.id}`,
    card: {
      id: card.id,
      atk: card.atk,
      def: card.def,
      lang: 'fr',
      rarity: card.r,
      q_score: 40 + (parseInt(card.id.slice(0, 4), 16) % 200) / 4, // stable d'une lecture à l'autre
      category: card.c,
      image_url: card.img,
      pageviews: card.pv,
      hide_image: false,
      wikipedia_url: `https://fr.wikipedia.org/wiki/${encodeURIComponent(card.t.replace(/ /g, '_'))}`,
      wikipedia_title: card.t,
    },
    tags: [{ tag: { id: 't1', name: 'TagDuJeu', color: null } }],
    count: card.n,
    card_id: card.id,
    starred: card.f,
    user_id: GAME_USER,
    is_shiny: card.s,
    obtained_at: `${card.at.replace(' ', 'T')}:00.000Z`,
    snapshot_rarity: null,
    snapshot_atk: null,
    snapshot_def: null,
    ...extra,
  };
}
const entriesFor = (cards) => cards.map((c) => rawEntry(c));

// Carte des tests (forme d'une carte du classeur), depuis une carte de data/owned.json ; rowOf (dev/supabase.mjs) en fait
// une ligne du jeu.
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

// Cartes minimales : pour les très grandes collections.
const mini = (n, from = 0) => Array.from({ length: n }, (_, k) => ({
  id: `mini-${String(from + k).padStart(5, '0')}`, title: `Carte ${from + k}`, rarity: 'C', count: 1,
}));

// Cotes (cache commun des ventes) : rangées directement dans la base.
const cote = (p, n, extra = {}) => ({ p, n, w: null, l: p, d: '2026-10-15T10:00:00.000Z', ...extra });
const putPrice = (e, id, v) => e.DB.sqlite.prepare('INSERT OR REPLACE INTO prices (card_id, data, read_at) VALUES (?, ?, ?)').run(id, JSON.stringify(v), new Date().toISOString());

// Compte du jeu d'un classeur dans les tests : tiré de sa clé (stable), sauf celui d'Alice (GAME_USER).
const uidOf = (key) => 'uid-' + key.slice(0, 12);
// Relie le compte du jeu `uid` au classeur (POST /api/session, cookie copié d'une fenêtre privée).
async function linkGame(key, { e = env, uid = uidOf(key), ...cookie } = {}) {
  supa.player(uid);
  return call('POST', 'session', { key, e, body: { cookie: supa.sessionCookie({ uid, ...cookie }) } });
}
// « Rafraîchir », sans la limite d'un clic par minute (les tests en enchaînent).
async function refreshNow(key, e = env) {
  e.DB.sqlite.prepare('UPDATE users SET sync_click_at = NULL WHERE key_hash = ?').run(await sha256Hex(key));
  return call('POST', 'refresh', { key, e, body: {} });
}
// Pose la collection dans le jeu (cartes des tests, ou lignes user_cards), relie le compte s'il ne l'est pas, puis
// rafraîchit : lecture vérifiée (le compte exact du jeu est celui des lignes).
async function setGameCards(key, cards, { e = env, uid } = {}) {
  const linked = e.DB.sqlite.prepare('SELECT game_session_enc AS s, game_uid AS uid FROM users WHERE key_hash = ?').get(await sha256Hex(key));
  const who = uid ?? (linked && linked.s ? linked.uid : uidOf(key));
  supa.player(who).cards = cards.map((c) => (c && c.card !== undefined ? { ...c, user_id: who } : rowOf(c, { uid: who })));
  if (!linked || !linked.s) assert.equal((await linkGame(key, { e, uid: who })).status, 200);
  return who;
}
async function seedCards(key, cards, opts = {}) {
  await setGameCards(key, cards, opts);
  const r = await refreshNow(key, opts.e);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r;
}

// Mesure du coût d'un appel. process.cpuUsage() n'avance que par pas de 15,6 ms sous Windows, et le shim
// node:sqlite tourne dans le même fil que le gestionnaire. Donc :
// - SQLite : CPU compté par le shim autour de chaque requête (sqlCpuMs), moyenné sur plusieurs appels réels ;
// - JavaScript du gestionnaire : l'appel réel est enregistré (résultats de chaque requête D1, dans l'ordre), puis
//   rejoué n fois contre une fausse base qui rend ces résultats sans rien calculer ; CPU total / n.
//   Le rejeu compte aussi Request/Response d'undici (natifs dans Workers) et, pour /api/refresh, le faux Supabase
//   (réponses JSON fabriquées puis décodées).
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
  return m('js');
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

await test('souhaits : migration du réglage global et des cartes déjà prises en charge', async () => {
  const file = path.join(os.tmpdir(), `classeur-wish-migration-${process.pid}-${Date.now()}.sqlite`);
  const db = createD1(file);
  for (const sql of SCHEMA.filter(sql => !sql.includes('CREATE TABLE IF NOT EXISTS wish_managed'))) {
    db.sqlite.exec(sql.replace('wish_sync INTEGER NOT NULL DEFAULT 0,', '').replace("wish_mode TEXT NOT NULL DEFAULT 'selected',", ''));
  }
  db.sqlite.exec(`INSERT INTO users (id, key_hash, created_at, auto_wish) VALUES ('a', 'hash-a', '2026-10-01', 1), ('b', 'hash-b', '2026-10-01', 0);
    INSERT INTO targets (user_id, id, name, items, created_at, updated_at) VALUES
      ('a', 'album', 'Album', '[{"title":"Mars"}]', '2026-10-01', '2026-10-01'),
      ('a', 'categorie', 'Catégorie', '[{"title":"Mars"}]', '2026-10-01', '2026-10-01'),
      ('b', 'album', 'Album', '[{"title":"Mars"}]', '2026-10-01', '2026-10-01'),
      ('b', 'categorie', 'Catégorie', '[{"title":"Mars"}]', '2026-10-01', '2026-10-01');
    UPDATE targets SET source = 'wp:Planètes' WHERE id = 'categorie';
    INSERT INTO game_titles (title, card_id, at) VALUES ('Mars', 'g-mars', '2026-10-01');`);
  await ensureSchema(db);
  assert.deepEqual(db.sqlite.prepare('SELECT wish_mode FROM users ORDER BY id').all().map(r => r.wish_mode), ['all', 'selected']);
  assert.deepEqual(db.sqlite.prepare('SELECT user_id, id, wish_sync FROM targets ORDER BY user_id, id').all().map(r => [r.user_id, r.id, r.wish_sync]),
    [['a', 'album', 1], ['a', 'categorie', 1], ['b', 'album', 0], ['b', 'categorie', 0]]);
  assert.deepEqual(db.sqlite.prepare('SELECT user_id, card_id FROM wish_managed').all().map(r => [r.user_id, r.card_id]), [['a', 'g-mars']]);
  db.sqlite.exec("UPDATE targets SET wish_sync = 0 WHERE user_id = 'a'");
  db.sqlite.exec("UPDATE targets SET wish_sync = 1 WHERE user_id = 'b' AND id = 'categorie'");
  const again = createD1(file);
  await ensureSchema(again);
  assert.deepEqual(again.sqlite.prepare('SELECT wish_sync FROM targets ORDER BY user_id, id').all().map(r => r.wish_sync), [0, 0, 0, 1],
    'les choix par collection faits après migration restent inchangés au redémarrage');
  // Base déjà passée au choix par collection avant l'ajout des modes : auto_wish est un indicateur interne.
  again.sqlite.exec("DELETE FROM migrations WHERE name = 'mode-souhaits-2026-10-25'; UPDATE users SET wish_mode = 'selected', auto_wish = 1 WHERE id = 'a'");
  const withModes = createD1(file);
  await ensureSchema(withModes);
  assert.equal(withModes.sqlite.prepare("SELECT wish_mode FROM users WHERE id = 'a'").get().wish_mode, 'selected');
  db.close(); again.close(); withModes.close(); await rm(file, { force: true });
});

await test('migration des souhaits : cache volumineux, recherche par index et migrations terminées ignorées', async () => {
  const db = createD1(':memory:');
  for (const sql of SCHEMA) db.sqlite.exec(sql);
  db.sqlite.exec(`INSERT INTO users (id, key_hash, created_at, auto_wish) VALUES
    ('actif', 'hash-actif', '2026-10-01', 1), ('inactif', 'hash-inactif', '2026-10-01', 0)`);
  const items = Array.from({ length: 4000 }, (_, i) => ({ title: 'Titre ' + i }));
  items.push({ title: 'Sans résultat' }, { title: 'Jamais recherché' });
  const album = db.sqlite.prepare('INSERT INTO targets (user_id, id, name, items, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (const uid of ['actif', 'inactif']) album.run(uid, 'album', 'Album', JSON.stringify(items), '2026-10-01', '2026-10-01');
  const cache = db.sqlite.prepare('INSERT INTO game_titles (title, card_id, at) VALUES (?, ?, ?)');
  db.sqlite.exec('BEGIN');
  for (let i = 0; i < 10000; i++) cache.run('Titre ' + i, 'carte-' + i, '2026-10-01');
  cache.run('Sans résultat', '', '2026-10-01');
  db.sqlite.exec('COMMIT');
  const writes = [];
  const freshInstance = () => ({ prepare: (sql) => db.prepare(sql), batch: (statements) => {
    writes.push(...statements);
    return db.batch(statements);
  } });
  await ensureSchema(freshInstance());
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM wish_managed WHERE user_id = 'actif'").get().n, 4000);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM wish_managed WHERE user_id = 'inactif'").get().n, 0);
  const migration = writes.find(s => s.sql.includes('INSERT OR IGNORE INTO wish_managed'));
  assert.ok(migration, 'la migration initiale est exécutée');
  const plan = db.sqlite.prepare('EXPLAIN QUERY PLAN ' + migration.sql)
    .all(Object.fromEntries(migration.params.map((p, i) => ['?' + (i + 1), p]))).map(r => r.detail).join('\n');
  assert.match(plan, /SEARCH g USING INDEX.*\(title=\?\)/, plan);
  assert.doesNotMatch(plan, /SCAN g\b/, 'le cache ne doit pas être parcouru avant chaque album :\n' + plan);
  writes.length = 0;
  await ensureSchema(freshInstance());
  assert.ok(!writes.some(s => s.sql.includes('INSERT OR IGNORE INTO migrations')), 'une nouvelle instance ignore les migrations déjà appliquées');
  assert.ok(!writes.some(s => s.sql.includes('INSERT OR IGNORE INTO wish_managed')), 'aucune nouvelle jointure sur les titres au redémarrage');
  db.close();
});

await test('health et 503 sans base', async () => {
  const noDb = { COOKIE_SECRET: SECRET, SIGNUP_CODE: 'invitation' };
  let r = await call('GET', 'health', { e: noDb });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: false, db: false, cookie_secret: true, signup_open: true, sync_paused: false });
  assert.ok(!JSON.stringify(r.json).includes(SECRET));
  for (const [m, p] of [['GET', 'me'], ['POST', 'account'], ['POST', 'refresh'], ['GET', 'nimporte']]) {
    r = await call(m, p, { e: noDb, body: m === 'POST' ? {} : undefined });
    assert.equal(r.status, 503, p);
    assert.equal(r.json.error, "Le classeur n'est pas encore configuré : la base D1 n'est pas liée (variable DB).");
  }
  r = await call('GET', 'health');
  assert.deepEqual(r.json, { ok: true, db: true, cookie_secret: true, signup_open: true, sync_paused: false, cron: null });
  r = await call('GET', 'health', { e: { DB: env.DB, SIGNUP_CODE: '  ' } });
  assert.deepEqual(r.json, { ok: true, db: true, cookie_secret: false, signup_open: false, sync_paused: false, cron: null });
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
  assert.equal(r.json.error, 'Erreur interne du serveur (x is not a function).');
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
  // Accents : « Cléo » = « cleo » ; un compte du jeu relié suffit à dire le classeur utilisé.
  const cleo = await signup('Cléo', e);
  assert.equal((await linkGame(cleo.key, { e })).status, 200);
  r = await call('POST', 'account', { body: { code: 'invitation', name: 'cleo' }, e });
  assert.equal(r.status, 409);
  // Sans prénom, ou un autre prénom : pas de contrôle.
  assert.equal((await call('POST', 'account', { body: { code: 'invitation' }, e })).status, 201);
  assert.equal((await call('POST', 'account', { body: { code: 'invitation' }, e })).status, 201);
  assert.equal((await call('POST', 'account', { body: { code: 'invitation', name: 'Trykh4r bis' }, e })).status, 201);
});

await test('pseudo dans le jeu : réglé par PATCH /api/me, rendu par /api/me et aux membres qui partagent', async () => {
  const e = makeEnv();
  const a = await signup('Aude', e);
  const b = await signup('Basile', e);
  const patchMe = (u, body) => call('PATCH', 'me', { key: u.key, e, body });
  for (const bad of [42, 'a b', 'x/y', 'x?y', 'x#y', '<x>', 'y'.repeat(41)]) assert.equal((await patchMe(a, { pseudo: bad })).status, 400, JSON.stringify(bad));
  let r = await patchMe(a, { pseudo: '  Aude_42 ' });
  assert.deepEqual([r.status, r.json.user.pseudo], [200, 'Aude_42']);
  assert.equal((await call('GET', 'me', { key: a.key, e })).json.user.pseudo, 'Aude_42');
  // Les autres réglages ne l'effacent pas ; une chaîne vide le retire.
  await patchMe(a, { name: 'Aude' });
  assert.equal((await call('GET', 'me', { key: a.key, e })).json.user.pseudo, 'Aude_42');
  // Basile (qui partage, comme Aude, par défaut) le voit dans la liste des membres ; Aude, une carte pour être listée.
  await seedCards(a.key, synth(1, 700), { e });
  r = await call('GET', 'members', { key: b.key, e });
  assert.deepEqual(r.json.members.map((m) => [m.name, m.pseudo]), [['Aude', 'Aude_42']]);
  r = await patchMe(a, { pseudo: '' });
  assert.equal(r.json.user.pseudo, null);
  assert.deepEqual((await call('GET', 'members', { key: b.key, e })).json.members.map((m) => m.pseudo), [null]);
});

await test('GET /api/favori.js : relier.js servi sans __SITE__, sans clé, jamais en cache', async () => {
  const code = await readFile(path.join(root, 'site', 'public', 'assets', 'relier.js'), 'utf8');
  assert.ok(code.includes('__SITE__'));
  const e = makeEnv({ ASSETS: { fetch: async (req) => new URL(req.url).pathname === '/assets/relier.js' ? new Response(code) : new Response('', { status: 404 }) } });
  let res = await onRequest({ request: new Request('https://classeur.example/api/favori.js'), env: e, params: {}, waitUntil() {} });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('__classeurLien') && text.includes('"https://classeur.example"') && !text.includes('__SITE__'));
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  new Function(text); // syntaxe valide
  res = await onRequest({ request: new Request('https://classeur.example/api/favori.js', { method: 'POST' }), env: e, params: {}, waitUntil() {} });
  assert.equal(res.status, 405);
});

await test('liaison par favori : jeton à usage unique (30 min), dépôt de session avec CORS du jeu', async () => {
  const e = makeEnv();
  const u = await signup('Lia', e);
  const GAME = 'https://www.wiki-masters.com';
  const deposit = (token, cookie, headers = { origin: GAME }) => call('POST', 'link/session', { e, headers, body: { token, cookie } });
  const uid = 'uid-lien-1';
  supa.addPlayer(uid, { username: 'Lia_7' });

  assert.equal((await call('POST', 'link', { e })).status, 401, 'créer un jeton demande la clé');
  let r = await call('POST', 'link', { key: u.key, e });
  assert.equal(r.status, 200);
  const { token, until } = r.json;
  assert.match(token, /^[A-Za-z0-9_-]{20,64}$/);
  let row = userRow(u.user.id, e);
  assert.equal(row.link_hash, await sha256Hex(token));
  assert.equal(row.link_until, until);
  assert.ok(Math.abs(Date.parse(until) - Date.now() - 30 * 60 * 1000) < 5000);
  // Un nouveau jeton remplace l'ancien.
  const second = (await call('POST', 'link', { key: u.key, e })).json.token;
  assert.equal((await deposit(token, supa.sessionCookie({ uid }))).status, 401, 'ancien jeton remplacé');

  // OPTIONS : 204 avec les en-têtes du jeu ; une autre origine n'en reçoit pas.
  r = await call('OPTIONS', 'link/session', { e, headers: { origin: GAME } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), GAME);
  assert.equal(r.headers.get('access-control-allow-headers'), 'content-type');
  r = await call('OPTIONS', 'link/session', { e, headers: { origin: 'https://autre.example' } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);

  // Dépôt : sans clé, la session vérifiée auprès du jeu est gardée, le jeton consommé.
  r = await deposit(second, supa.sessionCookie({ uid }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.ok, r.json.pseudo], [true, 'Lia_7']);
  assert.equal(r.headers.get('access-control-allow-origin'), GAME);
  row = userRow(u.user.id, e);
  assert.deepEqual([row.game_uid, row.link_hash, row.link_until], [uid, null, null]);
  const [line] = (await call('GET', 'sync-log', { key: u.key, e })).json.entries;
  assert.deepEqual([line.kind, line.data.via], ['session', 'relier']);
  assert.equal((await deposit(second, supa.sessionCookie({ uid }))).status, 401, 'second dépôt avec le même jeton');
  assert.match((await deposit(second, supa.sessionCookie({ uid }))).json.error, /périmé ou déjà utilisé/);

  // Autre origine : la réponse reste, sans en-tête CORS (c'est le navigateur qui bloque).
  const third = (await call('POST', 'link', { key: u.key, e })).json.token;
  r = await deposit(third, supa.sessionCookie({ uid }), { origin: 'https://autre.example' });
  assert.deepEqual([r.status, r.headers.get('access-control-allow-origin')], [200, null]);

  // Jeton expiré, inconnu ou mal formé : 401, la session n'est pas lue.
  const fourth = (await call('POST', 'link', { key: u.key, e })).json.token;
  e.DB.sqlite.prepare('UPDATE users SET link_until = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), u.user.id);
  const n0 = supa.calls.length;
  for (const t of [fourth, 'inconnu-inconnu-inconnu-inconnu', 'court', '', undefined, 42]) {
    r = await deposit(t, supa.sessionCookie({ uid }));
    assert.equal(r.status, 401, String(t));
  }
  assert.equal(supa.calls.length, n0);

  // Cookie sans session du jeu : 400 (le jeton n'est pas consommé : rien n'a été tenté).
  const fifth = (await call('POST', 'link', { key: u.key, e })).json.token;
  assert.equal((await deposit(fifth, 'theme=sombre; autre=1')).status, 400);
  assert.equal((await deposit(fifth, 12)).status, 400);

  // Compte du jeu déjà relié à un autre classeur : 409, jeton consommé quand même.
  const v = await signup('Victor', e);
  r = await deposit(fifth, supa.sessionCookie({ uid }));
  assert.equal(r.status, 200, 'le même classeur peut relier à nouveau son propre compte');
  const vt = (await call('POST', 'link', { key: v.key, e })).json.token;
  r = await deposit(vt, supa.sessionCookie({ uid }));
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.match(r.json.error, /déjà relié/);
  assert.equal(userRow(v.user.id, e).link_hash, null, 'jeton consommé');
  assert.equal(userRow(v.user.id, e).game_uid, null);
  assert.equal((await deposit(vt, supa.sessionCookie({ uid }))).status, 401);

  // Corps trop gros : 20 Ko au plus.
  r = await deposit(vt, 'a=' + 'x'.repeat(21 * 1024));
  assert.equal(r.status, 413);
  e.DB.close();
});

await test('authentification et /api/me', async () => {
  let r = await call('GET', 'me');
  assert.equal(r.status, 401);
  assert.ok(r.json.error);
  r = await call('GET', 'me', { key: 'mauvaise-cle' });
  assert.equal(r.status, 401);
  r = await call('GET', 'me', { key: alice.key });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json.user).sort(), ['created_at', 'id', 'name', 'pseudo']);
  assert.equal(r.json.user.pseudo, null);
  assert.equal(r.json.card_count, 0);
  assert.equal(r.json.cards_rev, 0);
  assert.equal(r.json.fetched_at, null);
  assert.deepEqual(r.json.new_ids, []);
  assert.deepEqual(r.json.session, { linked: false, lost: null, at: null, auto_sync: true, paused: false, fails: 0, checked_at: null, full_at: null });
  assert.ok(!('has_import_key' in r.json) && !('next_full' in r.json));
  // Réglage « Synchro automatique » (booléen seulement) ; force_full n'existe plus.
  for (const bad of ['oui', 1, null]) assert.equal((await call('PATCH', 'me', { key: alice.key, body: { auto_sync: bad } })).status, 400, JSON.stringify(bad));
  assert.equal((await call('PATCH', 'me', { key: alice.key, body: { force_full: true } })).status, 400);
  r = await call('PATCH', 'me', { key: alice.key, body: { auto_sync: false } });
  assert.deepEqual([r.status, r.json.auto_sync], [200, false]);
  assert.equal((await call('GET', 'me', { key: alice.key })).json.session.auto_sync, false);
  await call('PATCH', 'me', { key: alice.key, body: { name: 'Alice' } });
  assert.equal((await call('GET', 'me', { key: alice.key })).json.session.auto_sync, false, 'les autres réglages ne le touchent pas');
  await call('PATCH', 'me', { key: alice.key, body: { auto_sync: true } });
  r = await call('PATCH', 'me', { key: alice.key, body: { name: ' Alice ' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.name, 'Alice');
  r = await call('GET', 'nimporte', { key: alice.key });
  assert.equal(r.status, 404);
  r = await call('PUT', 'me', { key: alice.key });
  assert.equal(r.status, 405);
  r = await call('POST', 'session', { key: alice.key, raw: '{pas du json', headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /JSON/);
});

await test('renouvellement de la clé principale ; routes de l\'ancien favori retirées', async () => {
  const hana = await signup('Hana');
  await seedCards(hana.key, synth(4));
  const r = await call('POST', 'key/rotate', { key: hana.key });
  assert.match(r.json.key, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await call('GET', 'me', { key: hana.key })).status, 401);
  assert.equal((await call('GET', 'me', { key: r.json.key })).json.card_count, 4);
  for (const p of ['import', 'import-key', 'import-key/adopt', 'targets/from-game', 'market/plan', 'market/live', 'market/fail']) {
    assert.equal((await call('POST', p, { key: r.json.key, body: {} })).status, 404, p);
  }
  for (const p of ['market/prices', 'sync-log']) assert.equal((await call('POST', p, { key: r.json.key, body: {} })).status, 405, p);
  assert.equal((await call('DELETE', 'me', { key: r.json.key })).status, 200);
});

await test('préférences : {} par défaut, remplacement entier, 16 Ko, objet seulement, par compte', async () => {
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
  r = await call('PATCH', 'me', { key: kim.key, body: { prefs: { x: 'y'.repeat(16384) } } });
  assert.equal(r.status, 413);
  assert.match(r.json.error, /16 Ko/);
  r = await call('PATCH', 'me', { key: kim.key, body: { prefs: { x: 'é'.repeat(8194) } } }); // 16 396 octets, 8 202 caractères
  assert.equal(r.status, 413);
  r = await call('PATCH', 'me', { key: kim.key, body: { prefs: { x: 'y'.repeat(16000) } } });
  assert.equal(r.status, 200);
  r = await call('PATCH', 'me', { key: kim.key, body: {} });
  assert.equal(r.status, 400);
  // Chaque compte a les siennes.
  assert.deepEqual((await call('GET', 'me', { key: lea.key })).json.prefs, {});
  await call('PATCH', 'me', { key: lea.key, body: { prefs: { hide_catalog: true } } });
  assert.equal((await call('GET', 'me', { key: kim.key })).json.prefs.x.length, 16000);
  await call('DELETE', 'me', { key: kim.key });
  await call('DELETE', 'me', { key: lea.key });
});

// --- Lecture de la collection --------------------------------------------------------------------------------

const base = owned.slice(0, 150);
const dup = base[5];
const pic = base.find((c, i) => i < 120 && c.img);
const pic2 = base.find((c, i) => i < 120 && c.img && c !== pic);

await test('première lecture : regroupement, hide_image, entrées invalides, sans user_id du jeu, new_ids vide', async () => {
  const entries = entriesFor(base.slice(0, 120));
  entries.find((e) => e.card_id === pic.id).card.hide_image = true;
  entries.push(rawEntry(dup, { id: 'dup-a', count: 2, is_shiny: true, obtained_at: '2026-01-02T10:00:00.000Z' }));
  entries.push(rawEntry(dup, { id: 'dup-b', count: 1, starred: true, obtained_at: '2026-12-31T10:00:00.000Z' }));
  // Entrées inexploitables : ignorées, mais comptées comme exemplaires lus (la lecture reste vérifiée).
  entries.push({ id: 'sans-carte', card_id: null, count: 1, card: null, tags: [], obtained_at: '2026-01-03T00:00:00.000Z' });
  entries.push(rawEntry(base[140], { id: 'rarete-inconnue', card: { ...rawEntry(base[140]).card, rarity: 'X' } }));
  const r = await seedCards(alice.key, entries, { uid: GAME_USER });
  assert.deepEqual(r.json, { count: 120, fresh: 120, new_ids: [], complete: true, skipped: 2, removed: 0, kept: 0 });

  const cards = (await call('GET', 'cards', { key: alice.key })).json;
  assert.equal(cards.cards.length, 120);
  assert.ok(cards.fetched_at);
  const keys = ['id', 'title', 'rarity', 'atk', 'def', 'quality', 'pageviews', 'category', 'image', 'url', 'count',
    'shiny', 'starred', 'obtained_at', 'variants', 'gtags', 'tags'];
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
  // Tags posés dans le jeu (user_card_tags, objets {id, name, color}) : gardés dans la carte (gtags), jamais parmi les tags
  // du classeur.
  assert.deepEqual(one.gtags, ['TagDuJeu']);
  const everything = JSON.stringify(['cards', 'tags', 'targets', 'refresh_staging'].map((t) => rows(`SELECT * FROM ${t}`)));
  assert.ok(!everything.includes(GAME_USER), 'user_id du jeu stocké avec les cartes');
  assert.ok(!JSON.stringify(rows('SELECT * FROM tags')).includes('TagDuJeu'), 'tag du jeu mêlé aux tags du classeur');
  const me = (await call('GET', 'me', { key: alice.key })).json;
  assert.equal(me.card_count, 120);
  assert.ok(me.session.full_at && me.session.checked_at === me.session.full_at, JSON.stringify(me.session));
});

await test('lecture suivante : nouveautés, retraits (lecture vérifiée seulement), seules les différences écrites ; incomplète, sans compte, collection qui bouge, vide : rien de retiré', async () => {
  const alicePlayer = supa.player(GAME_USER);
  const next = base.slice(10, 130).map((c) => (c === base[20] ? { ...c, n: c.n + 1 } : c));
  const writes = countCardWrites(true);
  const r = await seedCards(alice.key, entriesFor(next));
  assert.deepEqual([r.json.count, r.json.fresh, r.json.complete, r.json.removed, r.json.kept], [120, 10, true, 10, 0]);
  assert.deepEqual([...r.json.new_ids].sort(), base.slice(120, 130).map((c) => c.id).sort());
  // 10 ajoutées + 1 modifiée + 10 retirées
  assert.equal(writes(), 21);
  countCardWrites(false);
  const cards = (await call('GET', 'cards', { key: alice.key })).json;
  assert.deepEqual([...cards.new_ids].sort(), [...r.json.new_ids].sort());
  const ids = new Set(cards.cards.map((c) => c.id));
  assert.ok(!ids.has(base[0].id) && ids.has(base[125].id));
  assert.equal(cards.cards.find((c) => c.id === base[20].id).count, base[20].n + 1);
  // Relue sans nouveauté : rien d'écrit, les nouvelles cartes de la lecture précédente restent marquées.
  const again = await refreshNow(alice.key);
  assert.deepEqual([again.json.count, again.json.fresh, again.json.complete, again.json.removed], [120, 0, true, 0]);
  assert.deepEqual([...again.json.new_ids].sort(), [...r.json.new_ids].sort());
  assert.deepEqual([...(await call('GET', 'me', { key: alice.key })).json.new_ids].sort(), [...r.json.new_ids].sort());
  // Lecture incomplète (la moitié des exemplaires, plus une carte nouvelle) : le jeu en compte 121, 61 lus. Rien n'est
  // retiré ni modifié (base[20] lue avec un exemplaire de moins garde les siens) ; seule la carte absente du classeur entre.
  const half = [...entriesFor(next.slice(0, 60).map((c) => (c === next[10] ? { ...c, n: 1 } : c))), rawEntry(base[130])];
  await setGameCards(alice.key, half);
  alicePlayer.phantom = 60;
  const cut = await refreshNow(alice.key);
  alicePlayer.phantom = 0;
  assert.deepEqual(cut.json, { count: 121, fresh: 1, new_ids: [base[130].id], complete: false, skipped: 0, removed: 0, kept: 60 });
  let now = (await call('GET', 'cards', { key: alice.key })).json.cards;
  assert.equal(now.length, 121);
  assert.equal(now.find((c) => c.id === base[20].id).count, base[20].n + 1, 'carte déjà là : pas modifiée par une lecture incomplète');
  assert.equal((await call('GET', 'me', { key: alice.key })).json.card_count, 121);
  let st = JSON.parse(rows('SELECT sync_state FROM users WHERE id = ?', alice.user.id)[0].sync_state);
  assert.deepEqual([st.rows, st.complete, st.full_at < st.checked_at], [121, false, true], 'full_at : dernière lecture vérifiée seulement');
  // Sans compte exact du jeu (lecture non vérifiable) : rien n'est retiré non plus.
  await setGameCards(alice.key, entriesFor(base.slice(0, 5)));
  supa.noCount = true;
  const blind = await refreshNow(alice.key);
  supa.noCount = false;
  assert.deepEqual([blind.json.count, blind.json.complete, blind.json.removed, blind.json.kept], [126, null, 0, 121]);
  // Compte différent avant et après la lecture (une carte obtenue pendant) : rien n'est retiré, même si elle colle.
  await setGameCards(alice.key, entriesFor(next));
  const rest0 = supa.rest().length;
  supa.after = (n) => { if (n === rest0 + 1) alicePlayer.cards.push({ ...rawEntry(base[140]), user_id: GAME_USER, obtained_at: '2020-01-01T00:00:00.000Z' }); };
  after(() => { supa.after = null; });
  const moved = await refreshNow(alice.key);
  supa.after = null;
  assert.deepEqual([moved.json.count, moved.json.complete, moved.json.moved, moved.json.removed, moved.json.kept], [126, false, true, 0, 6]);
  // Une lecture vérifiée remet tout d'aplomb.
  const fix = await seedCards(alice.key, entriesFor(next));
  assert.deepEqual([fix.json.count, fix.json.complete, fix.json.removed], [120, true, 6]);
  now = (await call('GET', 'cards', { key: alice.key })).json.cards;
  assert.ok(!now.some((c) => c.id === base[130].id || c.id === base[0].id));
  // Collection vide dans le jeu : rien n'est changé, une ligne « warn » au journal.
  await setGameCards(alice.key, []);
  const empty = await refreshNow(alice.key);
  assert.deepEqual([empty.status, empty.json], [200, { count: 0, empty: true }]);
  const [line] = (await call('GET', 'sync-log', { key: alice.key })).json.entries;
  assert.deepEqual([line.kind, line.result, line.message], ['full', 'warn', "Collection vide dans le jeu : rien n'a été changé."]);
  assert.equal((await call('GET', 'me', { key: alice.key })).json.card_count, 120);
  assert.equal(rows('SELECT sync_lock FROM users WHERE id = ?', alice.user.id)[0].sync_lock, null);
  await setGameCards(alice.key, entriesFor(next));
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
  let r = await seedCards(alice.key, entriesFor(without));
  assert.equal(r.json.count, 119);
  assert.deepEqual(rows('SELECT tag FROM tags WHERE card_id = ?', gone.id), [{ tag: 'Garder' }]);
  let cards = (await call('GET', 'cards', { key: alice.key })).json.cards;
  assert.ok(!cards.some((c) => c.id === gone.id));
  r = await seedCards(alice.key, entriesFor(base.slice(10, 130)));
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
  // Intercalaire (carte qui ouvre une section, qui compte comme les autres) : gardé seulement s'il vaut true (absent
  // sinon), renvoyé par GET /api/targets, avec les autres champs.
  r = await call('POST', 'targets/save', { key: alice.key, body: { id: 'seps', name: 'Continents', items: [
    { title: 'Continent', status: 'ok', sep: true },
    { title: 'Afrique', status: 'ok' },
    { title: 'Sous-continent', status: 'ok', qid: 'Q855697', rarity: 'R', sep: true },
    ...[false, 'true', 1, null, {}, []].map((sep, i) => ({ title: `Pas un intercalaire ${i}`, status: 'ok', sep })),
  ] } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  // sep: false (décoché par le joueur) est gardé aussi : la détection automatique de la page ne le recoche jamais.
  assert.deepEqual(r.json.target.items.map((x) => ('sep' in x ? x.sep : '-')), [true, '-', true, false, '-', '-', '-', '-', '-']);
  const seps = (await call('GET', 'targets', { key: alice.key })).json.targets.find((x) => x.id === 'seps');
  assert.deepEqual(seps.items.slice(0, 3), [
    { title: 'Continent', description: null, image: null, status: 'ok', sep: true },
    { title: 'Afrique', description: null, image: null, status: 'ok' },
    { title: 'Sous-continent', description: null, image: null, status: 'ok', qid: 'Q855697', rarity: 'R', sep: true },
  ]);
  // Retiré à la sauvegarde suivante (la page renvoie la collection sans le drapeau).
  r = await call('POST', 'targets/save', { key: alice.key, body: { id: 'seps', name: 'Continents', items: seps.items.map(({ sep, ...it }) => it) } });
  assert.ok(r.json.target.items.every((x) => !('sep' in x)));
  await call('POST', 'targets/delete', { key: alice.key, body: { id: 'seps' } });
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
    { name: 'ok', items: [{ title: 'A', status: 'peut-être' }] },
    { name: 'ok', items: [{ status: 'ok' }] },
    { id: 'pas valide !', name: 'ok', items: [] },
  ]) {
    r = await call('POST', 'targets/save', { key: alice.key, body });
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
  }
  // Plus de limite à 3 000 éléments (2026-10-19) : seulement leur taille.
  r = await call('POST', 'targets/save', { key: alice.key, body: { name: 'x'.repeat(80), items: Array.from({ length: 5000 }, (_, i) => ({ title: `Article ${i}`, status: 'ok' })) } });
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 200));
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
  assert.equal(r.json.targets[0].items.length, 5000);
});

await test("targets/order : l'ordre de « Mes collections », sans toucher aux éléments ni à updated_at", async () => {
  const ana = await signup('Ana');
  const ids = [];
  for (const n of ['A', 'B', 'C']) {
    const r = await call('POST', 'targets/save', { key: ana.key, body: { name: n, items: [{ title: n, status: 'ok' }] } });
    ids.push(r.json.target.id);
    await new Promise((res) => setTimeout(res, 3)); // created_at à la milliseconde : sinon l'ordre de départ tient aux ids, tirés au hasard
  }
  const names = async () => (await call('GET', 'targets', { key: ana.key })).json.targets.map((t) => t.name).join('');
  assert.equal(await names(), 'ABC');
  const before = (await call('GET', 'targets', { key: ana.key })).json.targets.find((t) => t.name === 'A').updated_at;
  let r = await call('POST', 'targets/order', { key: ana.key, body: { ids: [ids[2], ids[0], ids[1]] } });
  assert.deepEqual(r.json, { ok: true });
  assert.equal(await names(), 'CAB');
  const a = (await call('GET', 'targets', { key: ana.key })).json.targets.find((t) => t.name === 'A');
  assert.equal(a.updated_at, before);
  assert.equal(a.items.length, 1);
  // Une collection enregistrée garde sa place ; une nouvelle vient après celles qui en ont une.
  await call('POST', 'targets/save', { key: ana.key, body: { id: ids[0], name: 'A', items: [] } });
  await call('POST', 'targets/save', { key: ana.key, body: { name: 'D', items: [] } });
  assert.equal(await names(), 'CABD');
  // Absente de la liste (créée ailleurs entre-temps) : après les autres.
  await call('POST', 'targets/order', { key: ana.key, body: { ids: [ids[1], ids[0]] } });
  assert.equal(await names(), 'BACD');
  // Les collections d'un autre compte ne bougent pas ; un id inconnu est ignoré.
  const ben = await signup('Ben');
  await call('POST', 'targets/save', { key: ben.key, body: { id: ids[2], name: 'X', items: [] } });
  await call('POST', 'targets/save', { key: ben.key, body: { name: 'Y', items: [] } });
  r = await call('POST', 'targets/order', { key: ben.key, body: { ids: ['inconnu', ids[0]] } });
  assert.equal(r.status, 200);
  assert.equal(await names(), 'BACD');
  for (const body of [{}, { ids: 'x' }, { ids: [1] }, { ids: ['a b'] }, { ids: [ids[0], ids[0]] }, { ids: Array.from({ length: 201 }, (_, i) => 'x' + i) }]) {
    r = await call('POST', 'targets/order', { key: ana.key, body });
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
  }
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

await test('collections à compléter : 600 Ko par envoi, 1,7 Mo par collection (en morceaux), 5 Mo par compte', async () => {
  const ivy = await signup('Ivy');
  // ~560 Ko d'éléments : 1 000 éléments avec une description de 500 caractères.
  const heavy = Array.from({ length: 1000 }, (_, i) => ({ title: `Article ${i}`, description: 'd'.repeat(500), status: 'ok' }));
  let r = await call('POST', 'targets/save', { key: ivy.key, body: { name: 'Trop', items: [...heavy, ...heavy.slice(0, 100)] } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /600 Ko/);
  // En morceaux : deux de ~575 Ko et un de ~290 Ko (le dernier porte le reste du corps), assemblés dans l'ordre en SQL ; réponse sans
  // les éléments ; plus rien en attente ensuite.
  const parts = [0, 1, 2].map((k) => heavy.slice(0, k < 2 ? 1000 : 500).map((x, i) => ({ ...x, title: `Morceau ${k} n° ${i}` })));
  const staged = () => env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM target_uploads').get().n;
  const send = (k, last, extra = {}, id = 'envoi-ivy-1') => call('POST', 'targets/save', { key: ivy.key,
    body: { items: parts[k], upload: { id, part: k, ...(last ? { last: true } : {}) }, ...(last ? { name: 'Grande', source: 'links:Grande page' } : {}), ...extra } });
  r = await send(0, false);
  assert.deepEqual([r.status, r.json], [200, { part: 0 }]);
  r = await send(1, false);
  assert.deepEqual([r.status, r.json], [200, { part: 1 }]);
  assert.equal(staged(), 2);
  r = await send(2, true);
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 200));
  assert.equal(r.json.target.items, null);
  assert.equal(r.json.target.source, 'links:Grande page');
  assert.equal(staged(), 0);
  const big = (await call('GET', 'targets', { key: ivy.key })).json.targets.find((x) => x.id === r.json.target.id);
  assert.equal(big.items.length, 2500);
  assert.deepEqual(big.items.map((x) => x.title), parts.flat().map((x) => x.title));
  assert.deepEqual(big.items[1500], { title: 'Morceau 1 n° 500', description: 'd'.repeat(500), image: null, status: 'ok' });
  // Remplacée en morceaux, conditionnellement (expect_updated_at), avec un dernier morceau vide.
  r = await send(0, false, {}, 'envoi-ivy-2');
  r = await call('POST', 'targets/save', { key: ivy.key, body: { id: big.id, name: 'Grande bis', items: [], upload: { id: 'envoi-ivy-2', part: 1, last: true }, expect_updated_at: big.updated_at } });
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 200));
  const bis = (await call('GET', 'targets', { key: ivy.key })).json.targets.find((x) => x.id === big.id);
  assert.deepEqual([bis.name, bis.items.length, bis.items[0].title], ['Grande bis', 1000, 'Morceau 0 n° 0']);
  // Un morceau manquant : rien n'est écrit.
  r = await send(1, true, {}, 'envoi-ivy-3');
  assert.equal(r.status, 400);
  assert.match(r.json.error, /manquent/);
  // Plus de 1,7 Mo en tout : refusé au morceau qui dépasse.
  for (const k of [0, 1, 2]) await send(k, false, {}, 'envoi-ivy-4');
  r = await call('POST', 'targets/save', { key: ivy.key, body: { items: heavy, upload: { id: 'envoi-ivy-4', part: 3 } } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /1,7 Mo/);
  r = await call('POST', 'targets/save', { key: ivy.key, body: { name: 'X', items: heavy, upload: { id: 'envoi-ivy-4', part: 3, last: true } } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /1,7 Mo/);
  for (const upload of ['x', { id: 'court', part: 0 }, { id: 'envoi-ivy-5', part: -1 }, { id: 'envoi-ivy-5', part: 1.5 }]) {
    r = await call('POST', 'targets/save', { key: ivy.key, body: { name: 'X', items: [], upload } });
    assert.equal(r.status, 400, JSON.stringify(upload));
    assert.match(r.json.error, /upload/);
  }
  // Trois envois en cours au plus : le plus ancien part.
  for (const n of [5, 6, 7]) await call('POST', 'targets/save', { key: ivy.key, body: { items: heavy.slice(0, 1), upload: { id: `envoi-ivy-${n}`, part: 0 } } });
  assert.deepEqual(env.DB.sqlite.prepare("SELECT DISTINCT upload_id AS u FROM target_uploads WHERE user_id = ? ORDER BY u").all(ivy.user.id).map((x) => x.u),
    ['envoi-ivy-5', 'envoi-ivy-6', 'envoi-ivy-7']);
  await call('POST', 'targets/delete', { key: ivy.key, body: { id: big.id } });
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

await test('collections à compléter : ajout automatique (règles, exclusions, enregistrement conditionnel), jamais montré aux amis', async () => {
  const ada = await signup('Ada');
  const it = (title) => ({ title, status: 'ok' });
  const save = (body) => call('POST', 'targets/save', { key: ada.key, body: { id: 'mal', name: 'Maladies', ...body } });
  const stored = async () => (await call('GET', 'targets', { key: ada.key })).json.targets.find((t) => t.id === 'mal') || null;
  // Sans règle : auto = null, dans la réponse et dans GET /api/targets.
  let r = await save({ items: [it('Grippe')] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.target.auto, null);
  assert.equal((await stored()).auto, null);
  // Règles posées (textes nettoyés, doublons repliés : tags et catégories du jeu sans la casse), première exclusion.
  r = await save({ items: [it('Grippe'), it('Peste')],
    auto: { rules: [{ k: 'gtag', v: ' Maladie ' }, { k: 'cat', v: 'maladie' }, { k: 'gtag', v: 'MALADIE' }, { k: 'tag', v: 'Sciences/' }, { k: 'tag', v: 'sciences/' }] },
    auto_skip: { add: ['Rougeole'] } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const rules = [{ k: 'gtag', v: 'Maladie' }, { k: 'cat', v: 'maladie' }, { k: 'tag', v: 'Sciences/' }, { k: 'tag', v: 'sciences/' }];
  assert.deepEqual(r.json.target.auto, { rules, skip: ['Rougeole'] });
  assert.deepEqual((await stored()).auto, { rules, skip: ['Rougeole'] });
  // Un enregistrement sans `auto` (Modifier, Réorganiser, intercalaire, fusion…) garde règles et exclusions.
  r = await save({ items: [it('Peste'), it('Grippe')] });
  assert.deepEqual(r.json.target.auto, { rules, skip: ['Rougeole'] });
  assert.deepEqual(r.json.target.items.map((x) => x.title), ['Peste', 'Grippe']);
  // auto_skip : ajoutés à la fin sans doublon (titres comparés comme la page : première lettre, « _ », apostrophe
  // typographique), puis retirés.
  r = await save({ items: [it('Peste')], auto_skip: { add: ['Grippe', 'rougeole', 'Fièvre d’Ebola'] } });
  assert.deepEqual(r.json.target.auto.skip, ['Rougeole', 'Grippe', 'Fièvre d’Ebola']);
  r = await save({ items: [it('Peste'), it('Grippe')], auto_skip: { del: ['grippe', "Fièvre_d'Ebola"] } });
  assert.deepEqual(r.json.target.auto.skip, ['Rougeole']);
  // auto {rules} sans skip : règles remplacées, exclusions gardées ; avec skip : remplacées aussi.
  r = await save({ items: [it('Peste')], auto: { rules: [{ k: 'cat', v: 'maladie' }] } });
  assert.deepEqual(r.json.target.auto, { rules: [{ k: 'cat', v: 'maladie' }], skip: ['Rougeole'] });
  r = await save({ items: [it('Peste')], auto: { rules: [{ k: 'cat', v: 'maladie' }], skip: ['Lèpre', 'lèpre'] } });
  assert.deepEqual(r.json.target.auto, { rules: [{ k: 'cat', v: 'maladie' }], skip: ['Lèpre'] });
  // 2 000 exclusions au plus : au-delà, les plus anciennes sont oubliées (une suppression ne doit jamais échouer pour ça).
  r = await save({ items: [it('Peste')], auto_skip: { add: Array.from({ length: 2100 }, (_, i) => `Titre ${i}`) } });
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 200));
  assert.equal(r.json.target.auto.skip.length, 2000);
  assert.deepEqual([r.json.target.auto.skip[0], r.json.target.auto.skip[1999]], ['Titre 100', 'Titre 2099']);
  // 20 règles au plus (20 passent).
  r = await save({ items: [it('Peste')], auto: { rules: Array.from({ length: 20 }, (_, i) => ({ k: 'gtag', v: `Tag ${i}` })), skip: [] } });
  assert.equal(r.status, 200);
  assert.equal(r.json.target.auto.rules.length, 20);
  // Validation : 400 lisible, rien d'écrit (ni les éléments, ni l'ajout automatique).
  const keep = await stored();
  for (const body of [
    { auto: 'oui' }, { auto: [] }, { auto: { rules: 'x' } }, { auto: { rules: [{ k: 'autre', v: 'x' }] } }, { auto: { rules: [{ k: 'gtag', v: '' }] } },
    { auto: { rules: [{ k: 'gtag', v: 42 }] } }, { auto: { rules: [{ k: 'cat', v: 'x'.repeat(501) }] } },
    { auto: { rules: Array.from({ length: 21 }, (_, i) => ({ k: 'gtag', v: `T${i}` })) } },
    { auto: { rules: [{ k: 'gtag', v: 'x' }], skip: Array.from({ length: 2001 }, (_, i) => `S${i}`) } }, { auto: { rules: [{ k: 'gtag', v: 'x' }], skip: [''] } },
    { auto: { rules: [{ k: 'gtag', v: 'x' }], skip: 'Peste' } },
    { auto_skip: [] }, { auto_skip: 'Peste' }, { auto_skip: { add: 'x' } }, { auto_skip: { del: ['y'.repeat(301)] } }, { auto_skip: { add: [null] } },
    { expect_updated_at: 42 }, { expect_updated_at: '' }, { expect_updated_at: 'x'.repeat(41) },
  ]) {
    r = await save({ items: [it('Autre')], ...body });
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(typeof r.json.error, 'string');
  }
  r = await call('POST', 'targets/save', { key: ada.key, body: { name: 'Sans id', items: [], expect_updated_at: keep.updated_at } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /id/);
  assert.deepEqual(await stored(), keep);
  // auto: null efface règles et exclusions ; auto_skip sans règle : ignoré ; rules vide = effacé.
  r = await save({ items: [it('Peste')], auto: null });
  assert.equal(r.json.target.auto, null);
  r = await save({ items: [it('Peste')], auto_skip: { add: ['Grippe'] } });
  assert.equal(r.json.target.auto, null);
  r = await save({ items: [it('Peste')], auto: { rules: [{ k: 'gtag', v: 'Maladie' }] } });
  assert.deepEqual(r.json.target.auto, { rules: [{ k: 'gtag', v: 'Maladie' }], skip: [] });
  r = await save({ items: [it('Peste')], auto: { rules: [] } });
  assert.equal(r.json.target.auto, null);
  r = await save({ items: [it('Grippe')], auto: { rules: [{ k: 'gtag', v: 'Maladie' }] }, auto_skip: { add: ['Rougeole'] } });

  // Enregistrement conditionnel (expect_updated_at) : le bon updated_at -> écrit ; périmé (un autre onglet est passé) ->
  // 409 avec la collection d'aujourd'hui, rien d'écrit ; supprimée -> 409, target null, jamais recréée.
  const base = await stored();
  await new Promise((res) => setTimeout(res, 5));
  r = await save({ items: [...base.items, it('Choléra')], expect_updated_at: base.updated_at });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.notEqual(r.json.target.updated_at, base.updated_at);
  assert.deepEqual(r.json.target.auto, base.auto, 'auto absent : gardé');
  const now = r.json.target;
  r = await save({ items: [...base.items, it('Typhus')], expect_updated_at: base.updated_at, auto: null });
  assert.equal(r.status, 409);
  assert.equal(r.json.conflict, true);
  assert.match(r.json.error, /changé entre-temps/);
  assert.deepEqual(r.json.target.items.map((x) => x.title), ['Grippe', 'Choléra']);
  assert.deepEqual([r.json.target.updated_at, r.json.target.auto], [now.updated_at, base.auto]);
  assert.deepEqual((await stored()).items.map((x) => x.title), ['Grippe', 'Choléra']);
  assert.deepEqual((await stored()).auto, base.auto, 'refusé : auto non effacé');
  await call('POST', 'targets/delete', { key: ada.key, body: { id: 'mal' } });
  r = await save({ items: [it('Grippe')], expect_updated_at: now.updated_at });
  assert.deepEqual([r.status, r.json.conflict, r.json.target], [409, true, null]);
  assert.equal(await stored(), null, 'jamais recréée');

  // Jamais montré aux autres membres (partage activé par défaut), ni dans GET /api/members.
  r = await save({ items: [it('Grippe')], auto: { rules: [{ k: 'gtag', v: 'Règle-secrète' }] }, auto_skip: { add: ['Exclue-secrète'] } });
  assert.equal(r.status, 200);
  const bea = await signup('Béa');
  const adaPub = rows('SELECT public_id FROM users WHERE id = ?', ada.user.id)[0].public_id;
  r = await call('GET', `members/${adaPub}/targets`, { key: bea.key });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.targets.map((t) => t.name), ['Maladies']);
  const seen = JSON.stringify(r.json) + JSON.stringify((await call('GET', 'members', { key: bea.key })).json);
  for (const secret of ['Règle-secrète', 'Exclue-secrète', 'rules', 'skip', '"auto"']) assert.ok(!seen.includes(secret), secret);
  // Compté dans les 5 Mo du compte, effacé avec le compte.
  await call('DELETE', 'me', { key: ada.key });
  await call('DELETE', 'me', { key: bea.key });
  assert.equal(rows("SELECT COUNT(*) AS n FROM targets WHERE auto LIKE '%Règle-secrète%'")[0].n, 0);
});

// --- Session du jeu (reliée au classeur) et lecture de la collection ---------------------------------------------

let bob;
await test('refresh : sans compte du jeu relié → 401 needs_link, rien demandé au jeu', async () => {
  bob = await signup('Bob');
  const n0 = supa.calls.length;
  const r = await call('POST', 'refresh', { key: bob.key, body: {} });
  assert.deepEqual([r.status, r.json.needs_link, supa.calls.length], [401, true, n0]);
  const [e] = (await call('GET', 'sync-log', { key: bob.key })).json.entries;
  assert.deepEqual([e.kind, e.result, e.data.status, e.data.via], ['full', 'error', 401, 'clic']);
});

const harOf = (cookie, url = 'https://www.wiki-masters.com/api/my-collection?page=0') => ({ log: { entries: [{ request: { url, headers: [{ name: 'Cookie', value: cookie }] } }] } });

await test('session : cookie collé (entier, en morceaux, sans préfixe) ou HAR, vérifiée auprès du jeu, chiffrée ; GET /api/me ; oubli', async () => {
  const e = makeEnv();
  const u = await signup('Sam', e);
  const uid = 'uid-sam';
  supa.addPlayer(uid, { username: 'Sam_42' });
  let me = (await call('GET', 'me', { key: u.key, e })).json;
  assert.deepEqual(me.session, { linked: false, lost: null, at: null, auto_sync: true, paused: false, fails: 0, checked_at: null, full_at: null });
  assert.ok(!('next_full' in me) && !('has_import_key' in me));
  // Refus : rien à lire, cookie sans session du jeu, cookie invalide ou illisible, HAR sans requête du jeu.
  for (const [body, re] of [[{}, /fenêtre privée/], [{ cookie: 'theme=sombre; autre=1' }, /sb-…-auth-token/], [{ cookie: 'pas un cookie' }, /Cookie invalide/],
    [{ cookie: 'sb-cyrxjeppjqsxxjayfrur-auth-token=base64-!!!' }, /sb-…-auth-token/], [{ har: { log: { entries: [] } } }, /aucune requête/]]) {
    const r = await call('POST', 'session', { key: u.key, e, body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.json.error, re);
  }
  const calls0 = supa.calls.length;
  let r = await call('POST', 'session', { key: u.key, e, body: { cookie: supa.sessionCookie({ uid }) } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.ok, r.json.pseudo, r.json.session.linked, r.json.session.lost], [true, 'Sam_42', true, null]);
  assert.deepEqual(supa.calls.slice(calls0).map((c) => c.path), ['/auth/v1/user', '/rest/v1/profiles'], 'vérifiée, pas renouvelée (jeton frais)');
  let row = userRow(u.user.id, e);
  assert.deepEqual([row.game_uid, row.game_session_v, row.game_pseudo], [uid, 1, 'Sam_42'], 'pseudo vide : rempli par celui du jeu');
  const p = supa.players.get(uid);
  assert.ok(!JSON.stringify(row).includes(p.access) && !JSON.stringify(row).includes(p.refresh), 'jetons du jeu stockés en clair');
  assert.deepEqual(await openSession(e, u.user.id, row.game_session_enc), { access_token: p.access, refresh_token: p.refresh, expires_at: p.expires_at, uid });
  await assert.rejects(decryptCookie(e, 'game-session:autre', row.game_session_enc), 'chiffré pour ce compte seulement');
  me = (await call('GET', 'me', { key: u.key, e })).json;
  assert.deepEqual([me.session.linked, me.session.at, me.user.pseudo], [true, row.game_session_at, 'Sam_42']);
  const [line] = (await call('GET', 'sync-log', { key: u.key, e })).json.entries;
  assert.deepEqual([line.kind, line.result, line.message, line.data.via], ['session', 'ok', 'Compte du jeu relié (Sam_42).', 'clic']);
  // Morceaux .0, .1… (dans le désordre), forme sans préfixe, HAR (objet ou texte) : le même compte, version +1 à chaque fois.
  const chunked = supa.sessionCookie({ uid, chunk: 100 }).split('; ');
  assert.ok(chunked.length > 3);
  for (const body of [{ cookie: [chunked[0], ...chunked.slice(1).reverse()].join('; ') }, { cookie: supa.sessionCookie({ uid, prefix: false }) },
    { har: harOf(supa.sessionCookie({ uid, chunk: 3180 })) }, { har: JSON.stringify(harOf(supa.sessionCookie({ uid }))) }]) {
    r = await call('POST', 'session', { key: u.key, e, body });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  assert.equal(userRow(u.user.id, e).game_session_v, 5);
  // Le pseudo réglé par le membre n'est pas remplacé.
  await call('PATCH', 'me', { key: u.key, e, body: { pseudo: 'Autre' } });
  await call('POST', 'session', { key: u.key, e, body: { cookie: supa.sessionCookie({ uid }) } });
  assert.equal(userRow(u.user.id, e).game_pseudo, 'Autre');
  // Sans COOKIE_SECRET : 500, rien de gardé.
  const e2 = makeEnv({ COOKIE_SECRET: '' });
  const v = await signup('Sans secret', e2);
  r = await call('POST', 'session', { key: v.key, e: e2, body: { cookie: supa.sessionCookie({ uid: 'uid-sans-secret' }) } });
  assert.equal(r.status, 500);
  assert.match(r.json.error, /COOKIE_SECRET/);
  assert.equal(userRow(v.user.id, e2).game_session_enc, null);
  // Oubli : session, compte du jeu et lecture en attente effacés ; le jeu n'est pas appelé (pas de déconnexion).
  e.DB.sqlite.prepare("INSERT INTO refresh_staging (user_id, page, entries, created_at) VALUES (?, 0, '[]', ?)").run(u.user.id, new Date().toISOString());
  const calls1 = supa.calls.length;
  r = await call('DELETE', 'session', { key: u.key, e });
  assert.deepEqual(r.json, { ok: true });
  assert.equal(supa.calls.length, calls1);
  row = userRow(u.user.id, e);
  assert.deepEqual([row.game_session_enc, row.game_uid, row.game_session_at, row.game_session_v], [null, null, null, 7]);
  assert.equal(e.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM refresh_staging WHERE user_id = ?').get(u.user.id).n, 0);
  assert.equal((await call('GET', 'me', { key: u.key, e })).json.session.linked, false);
  r = await call('POST', 'refresh', { key: u.key, e, body: {} });
  assert.deepEqual([r.status, r.json.needs_link], [401, true]);
  assert.match(r.json.error, /Aucun compte du jeu relié/);
});

await test('session : compte pris dans le jeu (auth/v1/user, jamais le cookie), déjà relié ailleurs → 409, refusée par le jeu → 401, jeton presque expiré renouvelé d\'abord', async () => {
  const e = makeEnv();
  const a = await signup('Ada', e);
  const b = await signup('Bea', e);
  supa.addPlayer('uid-ada', { username: 'ada' });
  supa.addPlayer('uid-bea');
  // Cookie d'Ada qui prétend être Bea : le classeur relie Ada, celle que le jeu reconnaît.
  let r = await call('POST', 'session', { key: a.key, e, body: { cookie: supa.sessionCookie({ uid: 'uid-ada', claim: 'uid-bea' }) } });
  assert.equal(r.status, 200);
  assert.equal(userRow(a.user.id, e).game_uid, 'uid-ada');
  // Le même compte du jeu ne se relie pas à un second classeur.
  r = await call('POST', 'session', { key: b.key, e, body: { cookie: supa.sessionCookie({ uid: 'uid-ada' }) } });
  assert.equal(r.status, 409);
  assert.match(r.json.error, /déjà relié à un autre classeur/);
  assert.equal(userRow(b.user.id, e).game_session_enc, null);
  // Bea n'a pas de pseudo dans le jeu : le sien reste vide.
  r = await call('POST', 'session', { key: b.key, e, body: { cookie: supa.sessionCookie({ uid: 'uid-bea' }) } });
  assert.deepEqual([r.status, r.json.pseudo, userRow(b.user.id, e).game_pseudo], [200, null, null]);
  // Session refusée par le jeu (jeton d'accès qu'il ne reconnaît plus) : 401, rien de gardé.
  const c = await signup('Cyd', e);
  const p = supa.addPlayer('uid-cyd');
  const cookie = supa.sessionCookie({ uid: 'uid-cyd' });
  p.access = 'jeton-que-le-jeu-ne-connait-plus';
  r = await call('POST', 'session', { key: c.key, e, body: { cookie } });
  assert.equal(r.status, 401);
  assert.match(r.json.error, /fenêtre privée/);
  assert.equal(userRow(c.user.id, e).game_session_enc, null);
  // Jeton qui expire dans moins de 2 min : renouvelé d'abord (un POST token), la session gardée est la nouvelle.
  const q = supa.addPlayer('uid-cyd2', { expiresIn: 60 });
  const old = q.refresh;
  const t0 = supa.tokens().length;
  r = await call('POST', 'session', { key: c.key, e, body: { cookie: supa.sessionCookie({ uid: 'uid-cyd2' }) } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(supa.tokens().length, t0 + 1);
  const s = await openSession(e, c.user.id, userRow(c.user.id, e).game_session_enc);
  assert.deepEqual([s.refresh_token === old, s.refresh_token, s.uid], [false, q.refresh, 'uid-cyd2']);
});

await test('refresh : 3 000 exemplaires = 4 pages + 1 contrôle (5 lectures PostgREST), aucun renouvellement, pages rangées par 500', async () => {
  const e = makeEnv();
  const u = await signup('Tess', e);
  assert.equal((await linkGame(u.key, { e })).status, 200);
  const uid = uidOf(u.key);
  supa.player(uid).cards = mini(3000).map((c, i) => rowOf(c, { uid, obtained_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString() }));
  const staged = [];
  supa.after = () => { staged.push(e.DB.sqlite.prepare('SELECT page, json_array_length(entries) AS n FROM refresh_staging WHERE user_id = ? ORDER BY page').all(u.user.id).map((x) => [x.page, x.n])); };
  after(() => { supa.after = null; });
  const rest0 = supa.rest().length;
  const tok0 = supa.tokens().length;
  const r = await call('POST', 'refresh', { key: u.key, e, body: {} });
  supa.after = null;
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.count, r.json.fresh, r.json.complete, r.json.removed, r.json.skipped], [3000, 3000, true, 0, 0]);
  const calls = supa.rest().slice(rest0);
  assert.equal(calls.length, 5);
  assert.equal(supa.tokens().length, tok0, 'jeton de plus de 2 min : aucun POST token');
  const q = calls.map((c) => new URL(c.url).searchParams);
  assert.deepEqual(q.map((s) => s.get('offset')), ['0', '1000', '2000', '3000', null]);
  assert.ok(q.slice(0, 4).every((s) => s.get('limit') === '1000' && s.get('order') === 'obtained_at.desc,id.asc' && s.get('user_id') === 'eq.' + uid
    && s.get('select').startsWith('id,card_id,') && s.get('select').includes('tags:user_card_tags(tag:tags(id,name,color))')));
  assert.deepEqual([q[4].get('select'), q[4].get('limit'), q[4].get('user_id')], ['obtained_at', '1', 'eq.' + uid]);
  assert.deepEqual(calls.map((c) => c.headers.prefer || null), ['count=exact', null, null, null, 'count=exact']);
  for (const c of calls) assert.deepEqual([c.headers.apikey, c.headers.authorization], [ANON, 'Bearer ' + supa.player(uid).access]);
  // Pendant la lecture : chaque page de 1 000 rangée en deux lignes de 500 ; tout effacé à la fin.
  assert.deepEqual(staged[3], [[0, 500], [1, 500], [2, 500], [3, 500], [4, 500], [5, 500]]);
  assert.equal(e.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM refresh_staging').get().n, 0);
  const row = userRow(u.user.id, e);
  const st = JSON.parse(row.sync_state);
  assert.deepEqual([st.count, st.rows, st.complete, st.last_at, st.full_at === st.checked_at], [3000, 3000, true, supa.player(uid).cards[2999].obtained_at, true]);
  assert.deepEqual([row.sync_lock, row.game_session_v], [null, 1], 'bail rendu, session inchangée');
  const me = (await call('GET', 'me', { key: u.key, e })).json;
  assert.deepEqual([me.card_count, me.session.full_at, me.session.checked_at], [3000, st.full_at, st.checked_at]);
});

await test('refresh : jeton renouvelé avant expiration (version +1), 401 → un renouvellement puis nouvel essai ; révoquée → à relier, ligne au journal', async () => {
  const e = makeEnv();
  const u = await signup('Ugo', e);
  const uid = uidOf(u.key);
  assert.equal((await linkGame(u.key, { e })).status, 200);
  const p = supa.player(uid);
  p.cards = synth(5).map((c) => rowOf(c, { uid }));
  // Session gardée qui expire dans 60 s : un POST token avant de lire.
  const s0 = await openSession(e, u.user.id, userRow(u.user.id, e).game_session_enc);
  e.DB.sqlite.prepare('UPDATE users SET game_session_enc = ? WHERE id = ?')
    .run(await sealSession(e, u.user.id, { ...s0, expires_at: Math.floor(Date.now() / 1000) + 60 }), u.user.id);
  const v0 = userRow(u.user.id, e).game_session_v;
  let t0 = supa.tokens().length;
  let r = await refreshNow(u.key, e);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(supa.tokens().length, t0 + 1);
  assert.deepEqual(JSON.parse(supa.tokens().at(-1).body), { refresh_token: s0.refresh_token });
  let row = userRow(u.user.id, e);
  assert.equal(row.game_session_v, v0 + 1);
  let s = await openSession(e, u.user.id, row.game_session_enc);
  assert.deepEqual([s.access_token, s.refresh_token, s.uid], [p.access, p.refresh, uid]);
  assert.ok(s.expires_at * 1000 > Date.now() + 3000_000);
  // Jeton d'accès refusé par PostgREST (401) : renouvelé une fois, la lecture reprend.
  p.access = 'acces-change-par-le-jeu';
  t0 = supa.tokens().length;
  const rest0 = supa.rest().length;
  r = await refreshNow(u.key, e);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(supa.tokens().length, t0 + 1);
  assert.deepEqual(supa.rest().slice(rest0).map((c) => c.headers.authorization === 'Bearer ' + p.access), [false, true, true]);
  assert.equal(userRow(u.user.id, e).game_session_v, v0 + 2);
  // Révoquée (déconnexion du jeu) : 401 needs_link, session perdue, ligne « session » au journal ; plus aucun appel au jeu.
  p.access = 'autre';
  p.refresh = null;
  p.prev = null;
  r = await refreshNow(u.key, e);
  assert.deepEqual([r.status, r.json.needs_link], [401, true]);
  assert.match(r.json.error, /révoquée/);
  assert.equal(userRow(u.user.id, e).game_session_lost, 'révoquée');
  const log = (await call('GET', 'sync-log', { key: u.key, e })).json.entries;
  assert.deepEqual(log.slice(0, 2).map((x) => [x.kind, x.result, x.data.via]), [['full', 'error', 'clic'], ['session', 'error', 'clic']]);
  assert.match(log[1].message, /^Session du jeu révoquée/);
  assert.ok(!JSON.stringify(log).includes('cookie'), 'les messages parlent de relier, jamais de cookie');
  const me = (await call('GET', 'me', { key: u.key, e })).json.session;
  assert.deepEqual([me.linked, me.lost], [false, 'révoquée']);
  const n0 = supa.calls.length;
  r = await refreshNow(u.key, e);
  assert.deepEqual([r.status, r.json.needs_link, supa.calls.length], [401, true, n0]);
  assert.match(r.json.error, /n'est plus valable \(révoquée\) : relie ton compte/);
  // Relier à nouveau répare tout.
  supa.mint(p);
  assert.equal((await linkGame(u.key, { e })).status, 200);
  assert.equal(userRow(u.user.id, e).game_session_lost, null);
  assert.equal((await refreshNow(u.key, e)).status, 200);
  // Secret du serveur changé : session illisible, à relier.
  r = await refreshNow(u.key, { ...e, COOKIE_SECRET: 'un-autre-secret' });
  assert.deepEqual([r.status, r.json.needs_link], [401, true]);
  assert.match(r.json.error, /plus lisible/);
});

await test('renouvellement : deux en même temps → une seule rotation, l\'autre reprend la session la plus récente (version comparée)', async () => {
  const e = makeEnv();
  const u = await signup('Rae', e);
  assert.equal((await linkGame(u.key, { e })).status, 200);
  const p = supa.player(uidOf(u.key));
  const user = userRow(u.user.id, e);
  const first = p.refresh;
  const [a, b] = [await sessionOf(e, user), await sessionOf(e, user)];
  const t0 = supa.tokens().length;
  await Promise.all([renewSession(e, user, a), renewSession(e, user, b)]);
  assert.equal(supa.tokens().length, t0 + 2);
  assert.equal(p.prev.refresh, first, 'une seule rotation');
  assert.deepEqual([a.auth.refresh_token, b.auth.refresh_token, a.v, b.v], [p.refresh, p.refresh, user.game_session_v + 1, user.game_session_v + 1]);
  const row = userRow(u.user.id, e);
  assert.deepEqual([row.game_session_v, row.game_session_lost], [user.game_session_v + 1, null]);
  assert.equal((await openSession(e, u.user.id, row.game_session_enc)).refresh_token, p.refresh);
  // Une session gardée renouvelée ailleurs pendant qu'on tenait l'ancienne (jeton refusé, 400) : la plus récente est
  // reprise, le membre n'est pas « à relier ».
  const stale = { auth: { ...a.auth, refresh_token: first }, v: user.game_session_v, uid: a.uid };
  p.prev.at = Date.now() - 60_000;
  await renewSession(e, user, stale);
  assert.deepEqual([stale.v, stale.auth.refresh_token, userRow(u.user.id, e).game_session_lost], [row.game_session_v, a.auth.refresh_token, null]);
});

await test('refresh : une lecture à la fois par compte (bail : 409), « Rafraîchir » une fois par minute (429 retry_after), limites et pannes du jeu', async () => {
  const e = makeEnv();
  const u = await signup('Lino', e);
  await seedCards(u.key, synth(3), { e });
  const log = async () => (await call('GET', 'sync-log', { key: u.key, e })).json.entries;
  let inner = null;
  supa.after = async () => { if (inner === null) inner = await refreshNow(u.key, e); };
  after(() => { supa.after = null; supa.limit = null; supa.fail = null; });
  let r = await refreshNow(u.key, e);
  supa.after = null;
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(inner.status, 409);
  assert.match(inner.json.error, /déjà en cours/);
  // Un clic de plus dans la minute : 429, rien lu ; ni l'un ni l'autre refus n'est noté au journal.
  const rest0 = supa.rest().length;
  r = await call('POST', 'refresh', { key: u.key, e, body: {} });
  assert.equal(r.status, 429);
  assert.ok(Number.isInteger(r.json.retry_after) && r.json.retry_after >= 1 && r.json.retry_after <= 60, JSON.stringify(r.json));
  assert.match(r.json.error, /moins d'une minute/);
  assert.equal(supa.rest().length, rest0);
  assert.deepEqual((await log()).slice(0, 1).map((x) => [x.kind, x.result]), [['full', 'ok']]);
  // Un bail échu (lecture interrompue) ne bloque plus.
  e.DB.sqlite.prepare("UPDATE users SET sync_lock = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(u.user.id);
  assert.equal((await refreshNow(u.key, e)).status, 200);
  // Limite du jeu (429, ou 403 automation_limit) : 429 {limited}, bail rendu, ligne au journal.
  for (const limit of [429, 'automation_limit']) {
    supa.limit = limit;
    r = await refreshNow(u.key, e);
    supa.limit = null;
    assert.deepEqual([r.status, r.json.limited, r.json.error], [429, true, 'Le jeu limite les lectures automatiques : réessaie plus tard.']);
    assert.equal(userRow(u.user.id, e).sync_lock, null);
    assert.deepEqual((await log())[0].message, r.json.error);
  }
  // Base du jeu en panne (5xx, réseau) : deux nouveaux essais, puis 502 ; autre refus (4xx) : 502 aussitôt.
  for (const [fail, tries, re] of [[{ status: 503 }, 3, /ne répond pas/], [{ network: true }, 3, /ne répond pas/], [{ status: 404, body: { message: 'x' } }, 1, /refusé une lecture \(404\)/]]) {
    const n0 = supa.calls.length;
    supa.fail = (url) => (url.includes('/rest/') ? fail : null);
    r = await refreshNow(u.key, e);
    supa.fail = null;
    assert.equal(r.status, 502);
    assert.match(r.json.error, re);
    assert.equal(supa.calls.length - n0, tries);
    assert.equal(userRow(u.user.id, e).sync_lock, null);
  }
  assert.equal((await refreshNow(u.key, e)).status, 200);
});

await test('migration : ancien cookie et clé d\'import vidés, colonnes de la session du jeu ajoutées à une base existante', async () => {
  const old = makeEnv();
  old.DB.sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, key_hash TEXT NOT NULL UNIQUE, import_key_hash TEXT, created_at TEXT NOT NULL,
    fetched_at TEXT, new_ids TEXT NOT NULL DEFAULT '[]', cookie_enc TEXT, cookie_updated_at TEXT, session_expired INTEGER NOT NULL DEFAULT 0, import_key_enc TEXT)`);
  old.DB.sqlite.prepare(`INSERT INTO users (id, key_hash, import_key_hash, created_at, cookie_enc, cookie_updated_at, session_expired, import_key_enc)
    VALUES ('ancien', ?, 'hash-import', '2026-10-01', 'cookie-chiffre', '2026-10-20T00:00:00.000Z', 1, 'cle-chiffree')`).run(await sha256Hex('cle-ancienne'));
  const r = await call('GET', 'me', { key: 'cle-ancienne', e: old });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.session, { linked: false, lost: null, at: null, auto_sync: true, paused: false, fails: 0, checked_at: null, full_at: null });
  const row = { ...old.DB.sqlite.prepare("SELECT * FROM users WHERE id = 'ancien'").get() };
  assert.deepEqual([row.cookie_enc, row.cookie_updated_at, row.session_expired, row.import_key_hash, row.import_key_enc], [null, null, 0, null, null]);
  assert.deepEqual([row.game_session_v, row.auto_sync, row.sync_fails, row.game_session_enc], [0, 1, 0, null]);
  assert.equal(old.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM migrations WHERE name = 'session-serveur-2026-10-22'").get().n, 1);
  const indexes = old.DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((x) => x.name);
  assert.ok(indexes.includes('users_by_game_uid') && indexes.includes('users_by_link'), indexes.join(','));
  assert.deepEqual(old.DB.sqlite.prepare('PRAGMA table_info(cron_state)').all().map((c) => c.name), ['name', 'running_until', 'skip_until', 'last_at', 'last_result']);
  // Relier un classeur existant marche aussitôt.
  supa.addPlayer('uid-ancien');
  assert.equal((await linkGame('cle-ancienne', { e: old, uid: 'uid-ancien' })).status, 200);
});

await test('corps trop gros (5 Mo), 20 000 cartes au plus, lecture par pages', async () => {
  const big = JSON.stringify({ cookie: 'a=1', pad: 'x'.repeat(5 * 1024 * 1024) });
  let r = await call('POST', 'session', { key: alice.key, raw: big, headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 413);
  assert.match(r.json.error, /5 Mo/);
  r = await call('POST', 'session', { key: alice.key, raw: '{}', headers: { 'content-length': String(6 * 1024 * 1024) } });
  assert.equal(r.status, 413);

  // 20 000 cartes (cartes minimales) : 20 pages du jeu.
  const dave = await signup('Dave');
  r = await seedCards(dave.key, mini(20_000));
  assert.deepEqual(r.json, { count: 20_000, fresh: 20_000, new_ids: [], complete: true, skipped: 0, removed: 0, kept: 0 });
  const all = (await call('GET', 'cards', { key: dave.key })).json;
  assert.equal(all.cards.length, 20_000);

  // 20 001 cartes : refusé à la fin, rien d'écrit.
  const zed = await signup('Zed');
  await setGameCards(zed.key, mini(20_001));
  r = await refreshNow(zed.key);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /20 000 cartes/);
  assert.equal((await call('GET', 'me', { key: zed.key })).json.card_count, 0);
  supa.player(uidOf(zed.key)).cards = [];

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
  supa.player(uidOf(dave.key)).cards = [];
});

await test('étiquettes : 5 000 changements par appel, 50 000 par compte (orphelines comprises)', async () => {
  const jo = await signup('Jo');
  await seedCards(jo.key, mini(6000));
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

await test('lecture incrémentale : lecture complète puis delta (nouvelle, modifiée, retirée puis revenue)', async () => {
  const lou = await signup('Lou');
  const rev = async () => (await call('GET', 'me', { key: lou.key })).json.cards_rev;
  const since = async (r) => (await call('GET', `cards?since=${r}`, { key: lou.key })).json;
  assert.equal(await rev(), 0);
  assert.deepEqual(await since(0), { rev: 0, delta: true, cards: [], gone: [], fetched_at: null, new_ids: [] });
  // Première lecture : révision 1 ; depuis 0, toutes les cartes, au même format que GET /api/cards.
  const first = synth(30);
  let r = await seedCards(lou.key, first);
  assert.equal(r.json.count, 30);
  assert.equal(await rev(), 1);
  const all = (await call('GET', 'cards', { key: lou.key })).json;
  assert.equal(all.rev, 1);
  let d = await since(0);
  assert.deepEqual(Object.keys(d), ['rev', 'delta', 'cards', 'gone', 'fetched_at', 'new_ids']);
  assert.deepEqual([d.rev, d.delta, d.gone, d.fetched_at], [1, true, [], all.fetched_at]);
  assert.deepEqual(d.cards, all.cards);
  // Seconde lecture : une carte retirée (first[0]), une modifiée (first[5]), une nouvelle ; le reste identique.
  const fresh = synth(1, 30)[0];
  const second = [...first.slice(1).map((c) => (c === first[5] ? { ...c, count: c.count + 1 } : c)), fresh];
  r = await seedCards(lou.key, second);
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
  await seedCards(lou.key, second);
  assert.equal(await rev(), 2);
  // La carte retirée revient : révision 3, renvoyée depuis 2 comme depuis 1, et plus du tout dans `gone`.
  await seedCards(lou.key, [first[0], ...second]);
  assert.equal(await rev(), 3);
  d = await since(2);
  assert.deepEqual([idsOf(d.cards), d.gone], [[first[0].id], []]);
  d = await since(1);
  assert.deepEqual([idsOf(d.cards), d.gone], [[first[0].id, first[5].id, fresh.id], []]);
  assert.equal(rows('SELECT COUNT(*) AS n FROM cards_gone WHERE user_id = ?', lou.user.id)[0].n, 0);
  await call('DELETE', 'me', { key: lou.key });
});

await test('lecture incrémentale : étiquettes (set, bulk, rename) → révision et cartes renvoyées', async () => {
  const mo = await signup('Mo');
  const ten = synth(10);
  await seedCards(mo.key, ten);
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
  await seedCards(mo.key, ten.slice(1));
  assert.equal(await rev(), 8);
  await post('tags/rename', { from: 'Vert', to: 'Jaune' });
  assert.equal(await rev(), 9);
  let d = (await call('GET', 'cards?since=8', { key: mo.key })).json;
  assert.deepEqual([d.cards.map((x) => [x.id, x.tags]), d.gone], [[[b, ['Jaune']]], []]);
  await seedCards(mo.key, ten);
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
  await seedCards(ned.key, mini(3000));
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
  await seedCards(ned.key, mini(2000));
  d = await since(3);
  assert.deepEqual([d.rev, d.delta, d.cards.length, d.gone.length], [4, true, 0, 1000]);
  assert.deepEqual([gone(), floor()], [1000, 0]);
  // Une de plus : 1 001 retraits, les plus anciens (révision 4) sont élagués, le plancher monte à 4.
  await seedCards(ned.key, mini(1999));
  assert.deepEqual([gone(), floor()], [1, 4]);
  assert.deepEqual(await since(3), { rev: 5, delta: false });
  d = await since(4);
  assert.deepEqual([d.delta, d.cards, d.gone], [true, [], ['mini-01999']]);
  // Deux fois 600 retraits : la révision 6 est élaguée à son tour (seule la 7, la plus récente, reste).
  await seedCards(ned.key, mini(1399));
  assert.deepEqual([gone(), floor()], [601, 4]);
  await seedCards(ned.key, mini(799));
  assert.deepEqual([gone(), floor()], [600, 6]);
  assert.deepEqual(await since(5), { rev: 7, delta: false });
  d = await since(6);
  assert.deepEqual([d.delta, d.cards.length, d.gone.length], [true, 0, 600]);
  // Une carte retirée qui revient n'est plus dans `gone`.
  await seedCards(ned.key, mini(800));
  d = await since(6);
  assert.deepEqual([d.rev, idsOf(d.cards), d.gone.length, d.gone.includes('mini-00799')], [8, ['mini-00799'], 599, false]);
  // Une opération qui ne fait que retirer plus de 1 000 cartes : aucune marque de retrait une à une (l'élagage les
  // effacerait aussitôt : deux écritures par carte pour rien), une seule marque de débordement ; la révision avance quand
  // même, et le plancher monte jusqu'à elle.
  await seedCards(ned.key, mini(2500));
  env.DB.sqlite.exec('CREATE TABLE _g (n INTEGER); CREATE TRIGGER g_ins AFTER INSERT ON cards_gone BEGIN INSERT INTO _g VALUES (1); END;');
  await seedCards(ned.key, mini(10));
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
  await seedCards(oz.key, mini(2500));
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
  await seedCards(k, mini(2), { e: old });
  d = (await call('GET', 'cards?since=1', { key: k, e: old })).json;
  assert.deepEqual([d.rev, idsOf(d.cards), d.gone], [2, ['mini-00000', 'mini-00001'], ['c1']]);
});

await test('lecture incrémentale : réponse ?since en morceaux d\'environ 1 Mo (une ligne D1 fait 2 Mo au plus), fetched_at et new_ids lus avec', async () => {
  const ivy = await signup('Ivy');
  // 1 000 cartes de ~4,5 Ko (catégorie, adresse et image longues, permises) : ~4,5 Mo de changements.
  const heavy = mini(1000).map((c, i) => ({ ...c, category: 'c'.repeat(500), url: `https://fr.wikipedia.org/wiki/${'u'.repeat(1900)}${i}`,
    image: `https://upload.wikimedia.org/${'i'.repeat(1900)}${i}` }));
  await seedCards(ivy.key, heavy);
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
  await seedCards(pat.key, mini(3));
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
  await seedCards(kim.key, mini(40));
  const seen = [];
  let during = null; // écriture faite pendant le COUNT (lecture concurrente simulée)
  const spy = { ...env, DB: { prepare: (sql) => { seen.push(sql); if (during && /COUNT\(\*\)/.test(sql)) { during(); during = null; } return env.DB.prepare(sql); }, batch: (s) => env.DB.batch(s) } };
  const me = async () => { seen.length = 0; return (await call('GET', 'me', { key: kim.key, e: spy })).json; };
  await me(); // schéma appliqué une fois par base et par instance (ensureSchema), pas à chaque appel
  assert.equal((await me()).card_count, 40);
  assert.equal(seen.length, 1, seen.join('\n'));
  const plan = env.DB.sqlite.prepare(`EXPLAIN QUERY PLAN ${seen[0]}`).all().map((r) => r.detail);
  // Le compte par sa clé, le dernier numéro du chat (badge des non-lus) : MAX sur la clé primaire, une ligne ; l'heure
  // de la dernière lecture du marché (market_at) : sa ligne de market, par sa clé primaire.
  assert.deepEqual(plan.length, 5, plan.join('\n'));
  assert.match(plan[0], /^SEARCH users USING INDEX sqlite_autoindex_users_\d \(key_hash=\?\)$/);
  assert.deepEqual(plan.slice(1, 3), ['SCALAR SUBQUERY 1', 'SEARCH chat_messages'], plan.join('\n'));
  assert.match(plan[3], /^CORRELATED SCALAR SUBQUERY \d$/, plan.join('\n'));
  assert.match(plan[4], /^SEARCH m USING INDEX sqlite_autoindex_market_1 \(user_id=\?\)$/, plan.join('\n'));
  // Classeur d'avant le compteur (sync_state absent, ou ancien format sans count) : compté une fois, puis gardé ; le reste
  // de l'état est intact.
  const setState = (v) => env.DB.sqlite.prepare('UPDATE users SET sync_state = ? WHERE id = ?').run(v, kim.user.id);
  const stateOf = () => rows('SELECT sync_state FROM users WHERE id = ?', kim.user.id)[0].sync_state;
  const old = JSON.stringify({ stats: { total: 40, totalUnique: 40, rarityCounts: null }, last_at: '2026-10-01T00:00:00.000Z', full_at: new Date().toISOString() });
  for (const before of [null, old]) {
    setState(before);
    let m = await me();
    assert.equal(m.card_count, 40);
    assert.ok(seen.some((s) => /COUNT\(\*\)/.test(s)), 'compté une fois');
    m = await me();
    assert.deepEqual([m.card_count, seen.length], [40, 1], 'compteur gardé : plus de COUNT');
    const st = JSON.parse(stateOf());
    assert.equal(st.count, 40);
    if (before) assert.deepEqual({ ...st, count: undefined }, { ...JSON.parse(before), count: undefined });
  }
  // Une lecture finie pendant le COUNT a écrit son état : il n'est pas écrasé (comparer-échanger).
  setState(null);
  during = () => setState('{"tok":"import-concurrent"}');
  assert.equal((await me()).card_count, 40);
  assert.equal(stateOf(), '{"tok":"import-concurrent"}');
  await call('DELETE', 'me', { key: kim.key });
});

await test('mesures de CPU (refresh de 3 000 exemplaires, finalisation, lectures du classeur)', async () => {
  const e3 = makeEnv();
  const runs = { refresh: [], fin1k: [], fin5k: [], fin20k: [], cards1k: [], cards20k: [], cardsPage: [], bulk: [], target: [], since1k: [], since20k: [], sinceNo: [] };
  // Collection à compléter réaliste : 3 000 éléments (titre, description, une image sur deux), un peu d'accents.
  const items = Array.from({ length: 3000 }, (_, i) => ({
    title: i % 7 ? `Article numéro ${i}` : `Élément ${i}`,
    description: i % 3 ? `description courte de l'article ${i}` : `commune française du département ${i % 95}`,
    image: i % 2 ? null : `https://upload.wikimedia.org/x/${i}.jpg`,
    status: i % 50 ? 'ok' : 'missing',
  }));
  for (let k = 0; k < 6; k++) {
    // Un « Rafraîchir » de 3 000 exemplaires réalistes (cartes de data/owned.json, avec un tag du jeu) : 4 pages + contrôle.
    const u = await signup(`Mesure ${k}`, e3);
    const uid = await setGameCards(u.key, [], { e: e3 });
    supa.player(uid).cards = synth(3000).map((c, i) => rowOf(c, { uid, obtained_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(), tags: ['Favori'] }));
    const rest0 = supa.rest().length;
    const m = await profile('POST', 'refresh', { key: u.key, e: e3, body: {} });
    assert.deepEqual([m.status, m.json.count, m.json.complete], [200, 3000, true], m.text.slice(0, 200));
    assert.equal(supa.rest().length - rest0, 5 * 21, '5 lectures PostgREST par appel (rejeux compris)');
    runs.refresh.push(m);
    const t = await profile('POST', 'targets/save', { key: u.key, e: e3, body: { id: 'mesure', name: 'Mesure', items, source: 'catalog:x' } });
    assert.equal(t.status, 200, JSON.stringify(t.json).slice(0, 200));
    runs.target.push(t);
    supa.player(uid).cards = [];
  }
  // Finalisations seules (table d'attente déjà remplie, comme par une lecture) : 20 000 = cartes minimales.
  const finalize = async (user, n, cards) => {
    const now = new Date().toISOString();
    const ins = e3.DB.sqlite.prepare('INSERT INTO refresh_staging (user_id, page, entries, skipped, created_at) VALUES (?, ?, ?, 0, ?)');
    for (let p = 0; p * 500 < n; p++) ins.run(user.id, p, JSON.stringify(cards.slice(p * 500, (p + 1) * 500)), now);
    const opts = (db) => ({ source: REFRESH_SOURCE, key: 0, exact: { before: n, after: n, lastBefore: null, lastAfter: null }, started: now,
      clear: [db.prepare('DELETE FROM refresh_staging WHERE user_id = ?1').bind(user.id)] });
    const rec = recorder(e3.DB);
    const sql0 = e3.DB.sqlCpuMs;
    const res = await finalizeImport(rec.db, user, opts(rec.db));
    const sql = e3.DB.sqlCpuMs - sql0;
    const dbs = Array.from({ length: 20 }, () => replayDb(rec.log));
    const cpu0 = process.cpuUsage();
    for (const db of dbs) await finalizeImport(db, user, opts(db));
    const cpu = process.cpuUsage(cpu0);
    return { res, js: (cpu.user + cpu.system) / 1000 / 20, sql };
  };
  for (const [n, slot, times, make] of [[1000, 'fin1k', 6, synth], [5000, 'fin5k', 4, synth], [20_000, 'fin20k', 3, mini]]) {
    for (let k = 0; k < times; k++) {
      const v = await signup(`Fin ${n} ${k}`, e3);
      const cards = make(n);
      const m = await finalize({ id: v.user.id, sync_state: null }, n, cards);
      assert.equal(m.res.count, n);
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
  const refreshJs = report('refresh, 3 000 exemplaires (4 pages + contrôle, faux Supabase compris)', runs.refresh);
  report('targets/save, 3 000 éléments', runs.target);
  report('finalisation seule, 1 000 cartes', runs.fin1k);
  report('finalisation seule, 5 000 cartes', runs.fin5k);
  report('finalisation seule, 20 000 cartes', runs.fin20k);
  report('GET /api/cards, 1 000 cartes', runs.cards1k);
  report('GET /api/cards, 20 000 cartes (minimales)', runs.cards20k);
  report('GET /api/cards?part=…, une page de 1 000', runs.cardsPage);
  report('tags/bulk, 5 000 cartes', runs.bulk);
  report('GET /api/cards?since=…, 1 000 changées sur 1 000', runs.since1k);
  report('GET /api/cards?since=…, 1 000 changées sur 20 000', runs.since20k);
  report('GET /api/cards?since=…, plus de 1 000 changées sur 20 000 (delta:false)', runs.sinceNo);
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
  // Seuils absolus : seulement signalés, les temps varient du simple au double selon la charge de la machine. Une
  // lecture planifiée a 30 s de CPU ; un appel de la page, 30 s aussi (abonnement payant), 10 ms visés quand même hors refresh.
  if (refreshJs >= 1000) console.log(`    ATTENTION : refresh de 3 000 exemplaires à ${ms(refreshJs)} de JS sur cette machine`);
  for (const [label, rs] of [['targets/save', runs.target], ['page de cartes', runs.cardsPage], ['lecture incrémentale', runs.since20k]]) {
    if (js(rs) >= 10) console.log(`    ATTENTION : ${label} à ${ms(js(rs))} de JS sur cette machine (10 ms visés)`);
  }
});

// --- Journal des synchros et lectures en même temps ------------------------------------------------------------

await test('journal des synchros : une ligne par lecture (complète, incomplète, échec), relecture sans nouveauté regroupée, bornée, résumée dans /api/me', async () => {
  const uma = await signup('Uma');
  const log = async () => (await call('GET', 'sync-log', { key: uma.key })).json.entries;
  assert.deepEqual(await log(), []);
  assert.equal((await call('GET', 'me', { key: uma.key })).json.last_sync, null);
  after(() => { supa.fail = null; supa.limit = null; });
  const cards = synth(30);
  await seedCards(uma.key, cards);
  let list = await log();
  assert.deepEqual(list.map((x) => x.kind), ['full', 'session'], 'liaison puis lecture');
  let [e] = list;
  assert.deepEqual([e.kind, e.result, e.data.via, e.data.count, e.data.fresh, e.data.removed, e.data.complete, e.data.read, e.data.exact],
    ['full', 'ok', 'clic', 30, 30, 0, true, 30, 30]);
  assert.equal(e.message, 'Lecture complète : 30 cartes, 30 nouvelles, aucune retirée.');
  assert.ok(Number.isInteger(e.data.ms) && e.data.ms >= 0, JSON.stringify(e.data));
  // Relue sans nouveauté, deux fois de suite : une seule ligne, répétée.
  await refreshNow(uma.key);
  await refreshNow(uma.key);
  list = await log();
  assert.equal(list.length, 3);
  assert.deepEqual([list[0].result, list[0].message, list[0].data.via, list[0].data.repeat], ['ok', 'Lecture complète : 30 cartes, aucune nouvelle, aucune retirée.', 'clic', 2]);
  assert.ok(list[0].data.first <= list[0].at);
  // Lecture incomplète (le jeu compte 31 exemplaires, 20 lus) : une ligne « warn » qui dit ce qui manque et que rien n'a
  // été retiré.
  const p = supa.player(await setGameCards(uma.key, cards.slice(0, 20)));
  p.phantom = 11;
  let r = await refreshNow(uma.key);
  p.phantom = 0;
  assert.deepEqual([r.json.complete, r.json.removed, r.json.kept], [false, 0, 10]);
  [e] = await log();
  assert.equal(e.result, 'warn');
  assert.equal(e.message, 'Lecture incomplète : 20 exemplaires lus, le jeu en compte 31 : aucune nouvelle carte, aucune carte retirée (10 cartes non vues, gardées). Rafraîchis dans un moment.');
  // Un échec : ligne « error » avec le message rendu.
  supa.fail = (url) => (url.includes('/rest/') ? { status: 400, body: { message: 'x' } } : null);
  r = await refreshNow(uma.key);
  supa.fail = null;
  assert.equal(r.status, 502);
  [e] = await log();
  assert.deepEqual([e.kind, e.result, e.message, e.data.status, e.data.via], ['full', 'error', r.json.error, 502, 'clic']);
  const me = (await call('GET', 'me', { key: uma.key })).json;
  assert.deepEqual(me.last_sync, { at: e.at, kind: 'full', via: 'clic', result: 'error', message: e.message });
  // Borné : les 50 plus récentes, 30 jours au plus (élagage à chaque écriture).
  const ins = env.DB.sqlite.prepare("INSERT INTO sync_log (user_id, at, kind, result, message, data) VALUES (?, ?, 'full', 'ok', ?, '{}')");
  for (let i = 0; i < 60; i++) ins.run(uma.user.id, new Date(Date.now() - (60 - i) * 1000).toISOString(), `ligne ${i}`);
  ins.run(uma.user.id, '2026-01-01T00:00:00.000Z', 'très ancienne');
  supa.limit = 429;
  r = await refreshNow(uma.key);
  supa.limit = null;
  // Les 50 plus récentes sont gardées, sauf celle de plus de 30 jours : 49.
  list = await log();
  assert.equal(list.length, 49);
  assert.deepEqual([list[0].message, list.at(-1).message], [r.json.error, 'ligne 12']);
  assert.ok(!list.some((x) => x.message === 'très ancienne'));
  assert.equal(rows('SELECT COUNT(*) AS n FROM sync_log WHERE user_id = ?', uma.user.id)[0].n, 49);
  // Effacé avec le classeur.
  await call('DELETE', 'me', { key: uma.key });
  assert.equal(rows('SELECT COUNT(*) AS n FROM sync_log WHERE user_id = ?', uma.user.id)[0].n, 0);
});

await test('lectures en même temps : une lecture commencée avant celle déjà appliquée ne passe jamais par-dessus (superseded), contrôlé dans la transaction', async () => {
  const wes = await signup('Wes');
  const ids = async () => new Set((await call('GET', 'cards', { key: wes.key })).json.cards.map((c) => c.id));
  const A = synth(20);
  await seedCards(wes.key, A);
  const B = [...synth(19, 1), ...synth(1, 100)]; // carte-00000 partie, carte-00100 arrivée
  await setGameCards(wes.key, B);
  // Une lecture plus récente est appliquée entre les comptes et l'écriture (lecture automatique, autre appareil) : rien
  // d'écrit (sinon carte-00000 disparaîtrait et carte-00100 arriverait par-dessus une lecture plus récente).
  const sneaky = { ...env, DB: { sqlite: env.DB.sqlite, prepare: (sql) => env.DB.prepare(sql), batch: async (sts) => {
    if (sts.some((x) => x.sql.includes('INSERT INTO cards ('))) {
      env.DB.sqlite.prepare("UPDATE users SET sync_state = json_set(sync_state, '$.read_at', ?) WHERE id = ?").run(new Date(Date.now() + 1000).toISOString(), wes.user.id);
    }
    return env.DB.batch(sts);
  } } };
  const writes = countCardWrites(true);
  const r = await refreshNow(wes.key, sneaky);
  assert.deepEqual([r.status, r.json.superseded, r.json.count, writes()], [200, true, 20, 0], JSON.stringify(r.json));
  countCardWrites(false);
  const now = await ids();
  assert.ok(now.has('carte-00000') && !now.has('carte-00100'), 'aucune carte écrite ni retirée');
  const [e] = (await call('GET', 'sync-log', { key: wes.key })).json.entries;
  assert.deepEqual([e.kind, e.result, e.data.superseded, e.data.via], ['full', 'ok', true, 'clic']);
  assert.match(e.message, /^Lecture remplacée : une lecture plus récente/);
  assert.deepEqual([rows('SELECT sync_lock FROM users WHERE id = ?', wes.user.id)[0].sync_lock, rows('SELECT COUNT(*) AS n FROM refresh_staging WHERE user_id = ?', wes.user.id)[0].n],
    [null, 0], 'bail rendu et attente vidée dans la même transaction');
  await call('DELETE', 'me', { key: wes.key });
});

await test('catégorie du jeu (et autres champs de la carte) : relue par une lecture non vérifiée, sans toucher aux exemplaires ; catégorie trop longue coupée, la carte gardée', async () => {
  const gaby = await signup('Gaby');
  const mine = async () => new Map((await call('GET', 'cards', { key: gaby.key })).json.cards.map((c) => [c.id, c]));
  const rev = async () => (await call('GET', 'me', { key: gaby.key })).json.cards_rev;
  const five = synth(5).map((c, i) => ({ ...c, rarity: 'R', count: i === 1 ? 3 : 1, category: `catégorie ${i}` }));
  let r = await seedCards(gaby.key, five);
  assert.deepEqual([r.json.count, r.json.complete], [5, true]);
  const before = (await mine()).get('carte-00000');
  const r0 = await rev();
  // Lecture non vérifiée (le jeu compte deux exemplaires de plus) : carte-00000 a changé de catégorie, d'image et de vues ;
  // carte-00001 n'est lue qu'en partie (1 exemplaire sur 3, rareté plus basse) et sa catégorie a changé ; carte-00002 a une
  // catégorie de 600 caractères (coupée à 500, la carte gardée) ; les autres sont inchangées (même révision).
  const image = 'https://upload.wikimedia.org/neuve.jpg';
  const partial = five.map((c, i) => (i === 0 ? { ...c, category: 'maladie infectieuse', image, pageviews: 4321 }
    : i === 1 ? { ...c, count: 1, rarity: 'C', category: 'maladie' } : i === 2 ? { ...c, category: 'x'.repeat(600) } : c));
  const p = supa.player(await setGameCards(gaby.key, partial));
  p.phantom = 2;
  r = await refreshNow(gaby.key);
  assert.deepEqual([r.json.count, r.json.complete, r.json.removed, r.json.kept, r.json.skipped], [5, false, 0, 0, 0], JSON.stringify(r.json));
  const all = await mine();
  const zero = all.get('carte-00000');
  assert.deepEqual([zero.category, zero.image, zero.pageviews, zero.count, zero.obtained_at, zero.rarity, zero.title],
    ['maladie infectieuse', image, 4321, before.count, before.obtained_at, 'R', before.title], 'champs de la carte repris, exemplaires gardés');
  const one = all.get('carte-00001');
  assert.deepEqual([one.category, one.count, one.rarity], ['maladie', 3, 'R'], 'catégorie reprise ; exemplaires et rareté gardés');
  assert.equal(all.get('carte-00002').category, 'x'.repeat(500));
  const changed = (await call('GET', `cards?since=${r0}`, { key: gaby.key })).json.cards.map((c) => c.id).sort();
  assert.deepEqual(changed, ['carte-00000', 'carte-00001', 'carte-00002'], 'seules les cartes dont un champ a changé prennent une nouvelle révision');
  const [e] = (await call('GET', 'sync-log', { key: gaby.key })).json.entries;
  assert.deepEqual([e.result, e.data.updated], ['warn', 3]);
  assert.match(e.message, /^Lecture incomplète : 5 exemplaires lus, le jeu en compte 7 : aucune nouvelle carte, 3 cartes déjà là mises à jour \(catégorie du jeu, image, vues…\), aucune carte retirée\./);
  // Relue telle quelle : rien ne change (pas de nouvelle révision).
  const r1 = await rev();
  await refreshNow(gaby.key);
  p.phantom = 0;
  assert.equal(await rev(), r1, 'une relecture identique ne change rien');
  // Coupe au milieu d'une paire de substitution (émoji au 500e caractère) : la moitié restante est retirée.
  await seedCards(gaby.key, five.map((c, i) => (i === 4 ? { ...c, category: 'z'.repeat(499) + '😀' } : c)));
  assert.equal((await mine()).get('carte-00004').category, 'z'.repeat(499));
  await call('DELETE', 'me', { key: gaby.key });
});

await test('tags du jeu (gtags) : lus avec leur couleur, nettoyés, 30 au plus ; réunis par une lecture non vérifiée, remplacés par une lecture vérifiée ; jamais mêlés aux étiquettes du classeur', async () => {
  const hugo = await signup('Hugo');
  const mine = async () => new Map((await call('GET', 'cards', { key: hugo.key })).json.cards.map((c) => [c.id, c]));
  const uid = uidOf(hugo.key);
  const four = synth(4).map((c) => ({ ...c, rarity: 'C', count: 1 }));
  const many = Array.from({ length: 35 }, (_, i) => ({ id: `m${i}`, name: `Tag ${String(i).padStart(2, '0')} ${'x'.repeat(i === 0 ? 70 : 0)}`, color: null }));
  const tagged = (c, tags, eid) => rowOf(c, { uid, tags, eid });
  let r = await seedCards(hugo.key, [
    tagged(four[0], [{ id: 'u1', name: 'Maladie', color: '#EF4444' }, { id: 'u2', name: '  Fléau  ', color: 'rouge' }, { id: 'u3', name: 'Maladie', color: null }, { id: 'u4', color: '#000' }]),
    tagged(four[1], []), tagged(four[2], []), tagged(four[3], many),
  ]);
  assert.deepEqual([r.json.count, r.json.complete], [4, true], JSON.stringify(r.json));
  let all = await mine();
  // Nettoyés (espaces, doublons, objet sans nom), triés ; couleur valide seulement, en minuscules ; aucun : pas de clé.
  assert.deepEqual([all.get('carte-00000').gtags, all.get('carte-00000').gtagc], [['Fléau', 'Maladie'], { Maladie: '#ef4444' }]);
  assert.ok(!('gtags' in all.get('carte-00001')) && !('gtags' in all.get('carte-00002')) && !('gtagc' in all.get('carte-00001')));
  assert.equal(all.get('carte-00003').gtags.length, 30);
  assert.ok(all.get('carte-00003').gtags.every((t) => t.length <= 60), 'tags du jeu de 60 caractères au plus');
  assert.ok(!JSON.stringify(rows('SELECT * FROM tags')).includes('Maladie'), 'tags du jeu mêlés aux tags du classeur');
  // Lecture non vérifiée (un exemplaire compté en plus) : un exemplaire de carte-00001 avec un tag, carte-00000 sans : réunis
  // (jamais retirés).
  const p = supa.player(await setGameCards(hugo.key, [tagged(four[0], []), tagged(four[1], ['Virus']), tagged(four[2], []), tagged(four[3], [])]));
  p.phantom = 1;
  r = await refreshNow(hugo.key);
  p.phantom = 0;
  assert.deepEqual([r.json.complete, r.json.removed], [false, 0]);
  all = await mine();
  assert.deepEqual([all.get('carte-00001').gtags, all.get('carte-00000').gtags, all.get('carte-00000').gtagc, all.get('carte-00003').gtags.length],
    [['Virus'], ['Fléau', 'Maladie'], { Maladie: '#ef4444' }, 30]);
  let [e] = (await call('GET', 'sync-log', { key: hugo.key })).json.entries;
  assert.deepEqual([e.result, e.data.updated], ['warn', 1]);
  // Lecture vérifiée : ses tags remplacent ceux du classeur (Fléau retiré dans le jeu ; un second exemplaire de carte-00000
  // porte Peste ; les autres n'en ont plus).
  r = await seedCards(hugo.key, [tagged(four[0], [{ id: 'u1', name: 'Maladie', color: '#ef4444' }]), tagged(four[0], ['Peste'], 'ex-bis'), tagged(four[1], []),
    tagged(four[2], []), tagged(four[3], [])]);
  assert.equal(r.json.complete, true);
  all = await mine();
  assert.deepEqual([all.get('carte-00000').gtags, all.get('carte-00000').gtagc, all.get('carte-00000').count, all.get('carte-00001').gtags, all.get('carte-00003').gtags],
    [['Maladie', 'Peste'], { Maladie: '#ef4444' }, 2, undefined, undefined]);
  await call('DELETE', 'me', { key: hugo.key });
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

  // Ben : des cartes (et une session du jeu reliée), des étiquettes, une collection à compléter, des préférences.
  const benCards = synth(12, 200);
  await seedCards(ben.key, benCards);
  const dupe = benCards[3];
  await call('POST', 'tags/set', { key: ben.key, body: { card_id: dupe.id, tags: ['Étiquette-secrète'] } });
  await call('POST', 'targets/save', { key: ben.key, body: { name: 'Collection-secrète', items: [{ title: 'Article-secret', status: 'ok' }] } });
  await call('PATCH', 'me', { key: ben.key, body: { prefs: { note: 'préférence-secrète' } } });

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
  const benMe = await me(ben);
  assert.deepEqual(benMe.wikibidous && benMe.wikibidous.n, 0, 'solde lu à la synchro, rendu par /api/me');
  assert.deepEqual(r.json.members, [{ id: benPub, name: 'Ben', pseudo: null, count: 12, fetched_at: benMe.fetched_at, targets: null,
    wikibidous: benMe.wikibidous }]);
  // Classeur vide (ni carte ni collection) : absent de la liste ; Ana y apparaît avec sa première collection.
  assert.deepEqual((await members(ben)).json.members, [], 'un classeur vide ne doit pas être listé');
  await call('POST', 'targets/save', { key: ana.key, body: { name: 'Première', items: [{ title: 'Article premier', status: 'ok' }] } });
  assert.deepEqual((await members(ben)).json.members.map((m) => [m.id, m.name, m.count]), [[anaPub, 'Ana', 0]]);
  assert.equal((await members(cleo)).status, 403);
  assert.equal((await pageOf(cleo, benPub)).status, 403);

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
    putPrice(env, own[0].id, v0);
    putPrice(env, own[1].id, {});
    const priced = await pageOf(ana, benPub, '0');
    assert.deepEqual(priced.json.cards[0], { ...r.json.cards[0], v: v0 });
    assert.deepEqual(priced.json.cards.slice(1), r.json.cards.slice(1), 'sans cote (ou sans vente) : pas de « v »');
    env.DB.sqlite.prepare('DELETE FROM prices').run();
    env.DB.sqlite.prepare("DELETE FROM market WHERE user_id = '*'").run();
  }
  // Rien de personnel dans les réponses : ni étiquettes, ni collections, ni préférences, ni clés, ni session, ni id interne.
  const text = JSON.stringify([r.json, (await members(ana)).json, (await members(ben)).json]);
  const [benRow] = rows('SELECT * FROM users WHERE id = ?', ben.user.id);
  const benGame = supa.player(benRow.game_uid);
  for (const secret of ['Étiquette-secrète', 'Collection-secrète', 'Article-secret', 'préférence-secrète', ben.key, benRow.key_hash,
    benRow.game_session_enc, benRow.game_uid, benGame.access, benGame.refresh, ben.user.id, ana.user.id, '"tags"', '"starred"', '"obtained_at"', '"atk"', '"quality"', 'sync_state']) {
    assert.ok(!text.includes(secret), `fuite : ${secret}`);
  }
  assert.ok(benRow.game_session_enc && benRow.game_uid, 'la session du jeu existe bien');

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
  await seedCards(dan.key, mini(2500));
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
  const danSale = { p: 50, n: 3, w: 40, l: 49, d: '2026-10-15T10:00:00.000Z' };
  for (let k = 0; k < 2; k++) {
    for (const c of mini(2500).slice(k * 500, (k + 1) * 500)) putPrice(env, c.id, { C: danSale, R: { ...danSale, p: 300 }, 'C*': { ...danSale, n: 1 } });
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
  await seedCards(ben.key, synth(6, 300));
  await seedCards(ana.key, synth(2, 900)); // Ana : deux cartes (un classeur vide n'est pas listé)
  await call('POST', 'tags/set', { key: ben.key, body: { card_id: synth(1, 300)[0].id, tags: ['Étiquette-secrète'] } });
  const planets = (await save(ben, { name: 'Planètes', source: 'wp:Catégorie-secrète', items: [
    { title: 'Mars (planète)', description: 'description-secrète', image: 'https://upload.wikimedia.org/image-secrete.jpg', status: 'ok', qid: 'Q111' },
    { title: 'Vénus (planète)', status: 'ok', sep: true },
    { title: 'Mercure (homonymie)', status: 'disambiguation' },
    { title: 'Article-introuvable', status: 'missing', sep: true },
  ] })).json.target;
  const cat = (await save(ben, { name: 'Dieux grecs', source: 'catalog:dieux-grecs', items: [{ title: 'Zeus', qid: 'Q34201', status: 'ok', sep: true }, { title: 'Héra', status: 'ok' }] })).json.target;
  await patch(ben, { prefs: { note: 'préférence-secrète' } });

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
  // Cléo ne montre pas ses cartes : 403, même pour les collections (réciprocité).
  r = await targetsOf(cleo, benPub);
  assert.equal(r.status, 403);
  assert.match(r.json.error, /montre d'abord les tiennes/);

  // Ben montre aussi ses collections : GET /api/members donne leur nombre et leur dernier changement.
  r = await patch(ben, { shared_targets: true });
  assert.deepEqual([r.status, r.json.shared, r.json.shared_targets], [200, true, true]);
  assert.equal((await me(ben)).shared_targets, true);
  assert.equal(pubOf(ben), benPub, 'l\'identifiant public ne change pas');
  const lastChange = [planets.updated_at, cat.updated_at].sort().pop();
  const benMe = await me(ben);
  assert.deepEqual((await members(ana)).json.members, [{ id: benPub, name: 'Ben', pseudo: null, count: 6, fetched_at: benMe.fetched_at, targets: { count: 2, updated_at: lastChange },
    wikibidous: benMe.wikibidous }]);
  assert.deepEqual((await members(ben)).json.members.map((m) => [m.name, m.targets]), [['Ana', null]], 'Ana ne montre pas ses collections');
  assert.equal((await targetsOf(ben, pubOf(ana))).status, 404);

  // Ce qu'Ana voit : le nom de chaque collection (y compris celle du catalogue), sa nature (catégorie de Wikipédia
  // suivie ou collection) et, pour chaque élément vérifié, son titre, son qid et s'il est un intercalaire (sep: true,
  // avec ou sans qid) ; ni description, ni image, ni statut, ni source, ni dates ; les éléments introuvables ou
  // d'homonymie sont omis (aucune carte ne peut les remplir), intercalaires compris.
  r = await targetsOf(ana, benPub, '0');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json), ['member', 'targets', 'part', 'next_part']);
  assert.deepEqual([r.json.member, r.json.part, r.json.next_part], [{ id: benPub, name: 'Ben' }, '0', null]);
  const expected = [
    { id: planets.id, name: 'Planètes', kind: 'category', items: [{ title: 'Mars (planète)', qid: 'Q111' }, { title: 'Vénus (planète)', sep: true }] },
    { id: cat.id, name: 'Dieux grecs', kind: 'collection', items: [{ title: 'Zeus', qid: 'Q34201', sep: true }, { title: 'Héra' }] },
  ].sort((a, b) => (a.id < b.id ? -1 : 1));
  assert.deepEqual(r.json.targets, expected);
  assert.deepEqual((await targetsOf(ana, benPub)).json, r.json, 'sans part : la première page');
  const text = JSON.stringify([r.json, (await members(ana)).json, (await members(ben)).json]);
  const [benRow] = rows('SELECT * FROM users WHERE id = ?', ben.user.id);
  for (const secret of ['description-secrète', 'image-secrete', 'Catégorie-secrète', 'catalog:', 'Mercure (homonymie)', 'Article-introuvable', 'Étiquette-secrète',
    'préférence-secrète', ben.key, benRow.key_hash, benRow.game_session_enc, benRow.game_uid, ben.user.id, ana.user.id,
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
  assert.equal(again.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM migrations').get().n, 5, 'chaque migration une seule fois');
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
  // Cartes citées ([[Titre]], montrées en pastilles par la page) : le texte est rangé et relu tel quel, crochets compris.
  const cited = 'Regarde [[Grippe]] et [[Mercure (planète)]], [[L’Œil — « essai »]] !';
  r = await say(ben.key, cited);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.message.text, cited);
  assert.equal((await read(ana.key)).json.messages.at(-1).text, cited);
  e.DB.close();
});

await test('chat : GET /api/chat/last, sans clé, rend seulement l\'heure du dernier message (suppressions sautées)', async () => {
  const { e, say, del } = chatEnv();
  const last = () => call('GET', 'chat/last', { e });
  let r = await last();
  assert.deepEqual([r.status, r.json], [200, { last_at: null }]);
  const ana = await signup('Ana', e);
  const a1 = (await say(ana.key, 'Premier')).json.message;
  const a2 = (await say(ana.key, 'Second, secret')).json.message;
  r = await last();
  assert.deepEqual(r.json, { last_at: a2.created_at }, 'rien d\'autre que l\'heure');
  await del(ana.key, a2.id);
  assert.deepEqual((await last()).json, { last_at: a1.created_at }, 'message supprimé sauté');
  assert.equal((await call('POST', 'chat/last', { e, body: {} })).status, 405);
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

await test('chat : clé principale seulement, même origine', async () => {
  const { e, say, read, del } = chatEnv();
  const ana = await signup('Ana', e);
  const m = (await say(ana.key, 'Privé')).json.message;
  for (const r of [await read('cle-inconnue'), await say('cle-inconnue', 'Pirate'), await del('cle-inconnue', m.id), await read(undefined), await say(undefined, 'x')]) {
    assert.equal(r.status, 401, JSON.stringify(r.json));
    assert.ok(!JSON.stringify(r.json).includes('Privé'));
  }
  assert.equal((await read(ana.key)).json.messages.length, 1, 'rien envoyé ni supprimé sans la clé');
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

await test('chat : collections citées (lien du site rangé sous une forme stable, retraduit pour chaque lecteur)', async () => {
  const { e, q, say, read } = chatEnv();
  const ana = await signup('Ana', e);
  const ben = await signup('Ben', e);
  const cleo = await signup('Cléo', e);
  const save = (u, name) => call('POST', 'targets/save', { key: u.key, e, body: { name, items: [{ title: 'Luffy', status: 'ok' }] } }).then((r) => r.json.target.id);
  const pidOf = (u) => q('SELECT public_id AS p FROM users WHERE id = ?', u.user.id)[0].p;
  const patch = (u, body) => call('PATCH', 'me', { key: u.key, e, body });
  const tid = await save(ben, 'Mugiwara');
  const cleoTid = await save(cleo, 'Secrète');
  await patch(cleo, { shared: false }); // Cléo ne montre rien
  const site = 'http://localhost:8788/';
  // Collections citées d'un message lu, sans leur place dans le texte (vérifiée à part).
  const refsOf = (msg) => msg.refs && msg.refs.map(({ at, len, ...x }) => x);

  // Lien vers la collection de Ben (avec les paramètres de la vue) : rangé avec l'id du compte, jamais rendu tel quel ;
  // rendu avec le nom de la collection en clair dans le texte (une page d'avant cette fonction le montre tel quel) et sa
  // place (at, len).
  let r = await say(ana.key, `Bravo Ben ${site}#/ami/${pidOf(ben)}/${tid}?filtre=missing&tri=title. Et ${site}#/ami/${pidOf(ben)}/inconnue !`);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const m = r.json.message;
  assert.deepEqual([m.text, m.refs], [`Bravo Ben Mugiwara. Et ${site}#/ami/${pidOf(ben)}/inconnue !`,
    [{ at: 10, len: 8, name: 'Mugiwara', owner: 'Ben', mine: false, pid: pidOf(ben), id: tid }]]);
  assert.ok(!/[\uE000\uE001]/.test(JSON.stringify((await read(ana.key)).json)), 'jamais les bornes rangées');
  assert.equal(q('SELECT text FROM chat_messages WHERE id = ?', m.id)[0].text.slice(10, 10 + 3 + ben.user.id.length), `\uE000c:${ben.user.id}`);
  // Ben : la sienne. Cléo (ne montre pas ses cartes) : nom et propriétaire, rien pour l'ouvrir. Jamais l'id interne.
  r = await read(ben.key);
  assert.deepEqual(refsOf(r.json.messages[0]), [{ name: 'Mugiwara', owner: 'Ben', mine: true, pid: null, id: tid }]);
  r = await read(cleo.key);
  assert.deepEqual(refsOf(r.json.messages[0]), [{ name: 'Mugiwara', owner: 'Ben', mine: false, pid: null, id: null }]);
  for (const u of [ana, ben, cleo]) assert.ok(!JSON.stringify((await read(u.key)).json).includes(ben.user.id), "jamais l'id interne du propriétaire");
  // Partage coupé puis remis : nouvel id public, le message suit ; collection renommée : le nom suit aussi.
  await patch(ben, { shared: false });
  await patch(ben, { shared: true, shared_targets: true });
  await call('POST', 'targets/save', { key: ben.key, e, body: { id: tid, name: 'Équipage', items: [] } });
  r = await read(ana.key, '?before=999');
  assert.deepEqual([r.json.messages[0].text.slice(0, 20), r.json.messages[0].refs], ['Bravo Ben Équipage. ',
    [{ at: 10, len: 8, name: 'Équipage', owner: 'Ben', mine: false, pid: pidOf(ben), id: tid }]]);
  // Ben ne montre plus ses collections : non partagée pour les autres, toujours la sienne pour lui.
  await patch(ben, { shared_targets: false });
  r = await read(ana.key);
  assert.deepEqual([r.json.messages[0].text.slice(0, 33), r.json.messages[0].refs], ['Bravo Ben collection non partagée', [{ at: 10, len: 23, gone: true }]]);
  assert.equal((await read(ben.key)).json.messages[0].refs[0].mine, true);
  // Effacée : non partagée pour tous.
  await call('POST', 'targets/delete', { key: ben.key, e, body: { id: tid } });
  assert.deepEqual(refsOf((await read(ben.key)).json.messages[0]), [{ gone: true }]);

  // Sa propre collection (#/collections/<id>, l'adresse de sa vue), même sans la montrer : rangée ; les autres la voient
  // « non partagée ». Une collection d'un membre qui ne les montre pas, un autre site, un id inconnu : restent des liens.
  r = await say(cleo.key, `Ma liste ${site}#/collections/${cleoTid}`);
  assert.deepEqual([r.json.message.text, r.json.message.refs], ['Ma liste Secrète', [{ at: 9, len: 7, name: 'Secrète', owner: 'Cléo', mine: true, pid: null, id: cleoTid }]]);
  assert.deepEqual(refsOf((await read(ana.key)).json.messages.at(-1)), [{ gone: true }]);
  const plain = [`https://autre.example/#/collections/${cleoTid}`, `${site}#/collections/inconnue`, `${site}#/ami/${pidOf(cleo) || 'x'}/${cleoTid}`, `${site}#/ami/${pidOf(ana)}/${cleoTid}`];
  r = await say(ana.key, plain.join(' '));
  assert.deepEqual([r.json.message.text, r.json.message.refs], [plain.join(' '), undefined]);
  // Les bornes rangées par le serveur ne se tapent pas : retirées du texte envoyé.
  r = await say(ana.key, `\uE000c:${cleo.user.id}/${cleoTid}\uE001 coucou`);
  assert.deepEqual([r.json.message.text, r.json.message.refs], [`c:${cleo.user.id}/${cleoTid} coucou`, undefined]);
  // 5 collections citées par message au plus : la 6e reste un lien.
  const anaTid = await save(ana, 'Six');
  const link = `${site}#/collections/${anaTid}`;
  r = await say(ana.key, Array(6).fill(link).join(' '));
  assert.deepEqual([r.json.message.refs.map((x) => x.at), r.json.message.text], [[0, 4, 8, 12, 16], 'Six Six Six Six Six ' + link]);
  e.DB.close();
});

await test('chat : membres cités (lien vers son classeur rangé sous une forme stable, prénom en clair, pseudo et lien pour qui partage)', async () => {
  const { e, q, say, read } = chatEnv();
  const ana = await signup('Ana', e);
  const ben = await signup('Ben', e);
  const cleo = await signup('Cléo', e);
  const pidOf = (u) => q('SELECT public_id AS p FROM users WHERE id = ?', u.user.id)[0].p;
  const patch = (u, body) => call('PATCH', 'me', { key: u.key, e, body });
  await patch(ben, { pseudo: 'Mugi' });
  await patch(cleo, { shared: false }); // Cléo ne montre rien
  const site = 'http://localhost:8788/';
  const tid = (await call('POST', 'targets/save', { key: ben.key, e, body: { name: 'Équipage', items: [{ title: 'Luffy', status: 'ok' }] } })).json.target.id;
  const membersOf = (msg) => msg.members && msg.members.map(({ at, len, ...x }) => x);
  // Son propre id public (pour se citer) : rendu par GET et PATCH /api/me tant qu'on partage, null sinon.
  assert.deepEqual([(await call('GET', 'me', { key: ana.key, e })).json.public_id, (await call('GET', 'me', { key: cleo.key, e })).json.public_id], [pidOf(ana), null]);
  assert.equal((await patch(cleo, { shared: true })).json.public_id, pidOf(cleo));
  assert.equal((await patch(cleo, { shared: false })).json.public_id, null);

  // Lien vers le classeur de Ben (paramètres compris), suivi d'un lien vers sa collection : les deux rangés, dans l'ordre ;
  // le prénom en clair dans le texte, à part dans `members` (jamais dans `refs`, qu'une page d'avant prendrait pour une
  // collection).
  let r = await say(ana.key, `Salut ${site}#/ami/${pidOf(ben)}?q=luffy, bravo pour ${site}#/ami/${pidOf(ben)}/${tid} !`);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  let m = r.json.message;
  assert.deepEqual([m.text, m.members, m.refs.map((x) => x.at)], ['Salut Ben, bravo pour Équipage !',
    [{ at: 6, len: 3, name: 'Ben', mine: false, pid: pidOf(ben), pseudo: 'Mugi' }], [22]]);
  assert.equal(q('SELECT text FROM chat_messages WHERE id = ?', m.id)[0].text.slice(6, 6 + 3 + ben.user.id.length + 1), `u:${ben.user.id}`);
  // Ben : lui-même (ni lien ni pseudo : sa page sait qui il est). Cléo (ne montre pas ses cartes) : le prénom seul.
  assert.deepEqual(membersOf((await read(ben.key)).json.messages[0]), [{ name: 'Ben', mine: true, pid: null, pseudo: null }]);
  assert.deepEqual(membersOf((await read(cleo.key)).json.messages[0]), [{ name: 'Ben', mine: false, pid: null, pseudo: null }]);
  for (const u of [ana, ben, cleo]) assert.ok(!JSON.stringify((await read(u.key)).json).includes(ben.user.id), "jamais l'id interne");
  // Partage coupé puis remis (nouvel id public) et renommé : le message suit. Partage coupé : le prénom seul.
  await patch(ben, { shared: false });
  assert.deepEqual(membersOf((await read(ana.key)).json.messages[0]), [{ name: 'Ben', mine: false, pid: null, pseudo: null }]);
  await patch(ben, { shared: true, name: 'Benoît' });
  r = await read(ana.key);
  assert.deepEqual([r.json.messages[0].text.slice(0, 12), membersOf(r.json.messages[0])], ['Salut Benoît', [{ name: 'Benoît', mine: false, pid: pidOf(ben), pseudo: 'Mugi' }]]);
  // Un membre qui ne montre pas ses cartes, un autre site, un id inconnu : restent des liens. Le sien : rangé.
  const plain = [`${site}#/ami/x${pidOf(ana)}`, `https://autre.example/#/ami/${pidOf(ben)}`, `${site}#/ami/inconnu`];
  r = await say(ana.key, plain.join(' '));
  assert.deepEqual([r.json.message.text, r.json.message.members], [plain.join(' '), undefined]);
  r = await say(ana.key, `Moi : ${site}#/ami/${pidOf(ana)}`);
  assert.deepEqual([r.json.message.text, membersOf(r.json.message)], ['Moi : Ana', [{ name: 'Ana', mine: true, pid: null, pseudo: null }]]);
  // Classeur supprimé : « classeur supprimé » pour tous.
  await call('DELETE', 'me', { key: ben.key, e });
  r = await read(ana.key);
  const first = r.json.messages.find((x) => x.text.startsWith('Salut'));
  assert.deepEqual([first.text, first.members], ['Salut classeur supprimé, bravo pour collection non partagée !', [{ at: 6, len: 17, gone: true }]]);
  // 5 citations par message au plus, membres et collections confondus.
  r = await say(ana.key, Array(6).fill(`${site}#/ami/${pidOf(ana)}`).join(' '));
  assert.deepEqual([r.json.message.members.length, r.json.message.text.endsWith(pidOf(ana))], [5, true]);
  e.DB.close();
});

await test('chat : réponses (reply_to vérifié, extrait du message cité pour chaque lecteur, gone après suppression)', async () => {
  const { e, q, say, read, del } = chatEnv();
  const ana = await signup('Ana', e);
  const ben = await signup('Ben', e);
  const answer = (key, text, reply_to) => call('POST', 'chat', { key, e, body: { text, reply_to } });
  const site = 'http://localhost:8788/';
  const pid = q('SELECT public_id AS p FROM users WHERE id = ?', ben.user.id)[0].p;
  const a1 = (await say(ana.key, `Qui a   [[Mercure (planète)]] ?\nDemande à ${site}#/ami/${pid}`)).json.message;
  // Réponse : l'extrait du message cité (citations en clair, crochets des cartes retirés, espaces réduits).
  let r = await answer(ben.key, 'Moi !', a1.id);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const b1 = r.json.message;
  assert.deepEqual(b1.reply, { id: a1.id, author: 'Ana', mine: false, text: 'Qui a Mercure (planète) ? Demande à Ben' });
  // Pour Ana, le message cité est le sien (`mine`), et l'auteur reste celui de la réponse.
  r = await read(ana.key);
  assert.deepEqual(r.json.messages.map((m) => [m.id, m.reply || null]), [[a1.id, null], [b1.id, { ...b1.reply, mine: true }]]);
  assert.ok(!JSON.stringify(r.json).includes(ana.user.id), "jamais l'id interne de l'auteur");
  // Extrait coupé au mot près à 140 caractères.
  const long = (await say(ana.key, 'mot '.repeat(60) + 'fin')).json.message;
  const cut = (await answer(ben.key, 'ok', long.id)).json.message.reply.text;
  assert.ok(cut.endsWith('mot…') && Array.from(cut).length <= 141, cut);
  // Numéro invalide : 400 ; message inexistant ou supprimé : 404, rien d'écrit.
  const before = q('SELECT COUNT(*) AS n FROM chat_messages')[0].n;
  for (const bad of ['3', 0, -1, 1.5]) assert.equal((await answer(ben.key, 'x', bad)).status, 400, String(bad));
  assert.equal((await answer(ben.key, 'x', 99999)).status, 404);
  await del(ana.key, long.id);
  r = await answer(ben.key, 'x', long.id);
  assert.deepEqual([r.status, r.json.error], [404, "Le message auquel tu réponds n'existe plus (supprimé par son auteur ?)."]);
  assert.equal(q('SELECT COUNT(*) AS n FROM chat_messages')[0].n, before);
  // Supprimé après coup : la réponse reste, le message cité devient `gone` (lecture complète et ?after).
  const rev = (await read(ana.key)).json.rev;
  await del(ana.key, a1.id);
  r = await read(ben.key);
  assert.deepEqual(r.json.messages.find((m) => m.id === b1.id).reply, { id: a1.id, gone: true });
  const b2 = (await answer(ben.key, 'encore', b1.id)).json.message;
  r = await read(ana.key, `?after=${rev}`);
  assert.deepEqual([r.json.deleted, r.json.messages.map((m) => [m.id, m.reply])], [[a1.id], [[b2.id, { id: b1.id, author: 'Ben', mine: false, text: 'Moi !' }]]]);
  // Sans réponse : pas de champ `reply` (une page d'avant n'y voit rien de plus).
  assert.ok(!('reply' in (await say(ana.key, 'seul')).json.message));
  // Lecture : une requête de plus, seulement s'il y a des réponses, par la clé primaire.
  const plan = e.DB.sqlite.prepare(`EXPLAIN QUERY PLAN SELECT m.id FROM json_each('[1]') AS r JOIN chat_messages AS m ON m.id = r.value AND m.deleted = 0`).all().map((x) => x.detail);
  assert.ok(plan.some((l) => /^SEARCH m USING INTEGER PRIMARY KEY \(rowid=\?\)$/.test(l)), plan.join('\n'));
});

await test('chat : réactions (mettre, retirer, sans double compte, prénoms des autres, révision nouvelle pour ?after, 400, 404, 429)', async () => {
  const { e, q, say, read, del } = chatEnv();
  const ana = await signup('Ana', e);
  const ben = await signup('Ben', e);
  const cleo = await signup('Cléo', e);
  const react = (key, id, emoji, on = true) => call('POST', `chat/${id}/react`, { key, e, body: { emoji, on } });
  const a1 = (await say(ana.key, 'Regardez ma nouvelle carte !')).json.message;
  const a2 = (await say(ana.key, 'Et celle-ci')).json.message;
  assert.ok(!('reactions' in a1), 'sans réaction : pas de champ');
  const { rev } = (await read(ben.key)).json;
  let r = await react(ben.key, a1.id, '🎉');
  assert.deepEqual([r.status, r.json], [200, { id: a1.id, reactions: [{ emoji: '🎉', n: 1, mine: true, who: [] }] }]);
  // Déjà mise : rien ne change (un double clic ne la retire pas), pas de nouvelle révision.
  const rev1 = q('SELECT rev FROM chat_messages WHERE id = ?', a1.id)[0].rev;
  r = await react(ben.key, a1.id, '🎉');
  assert.equal(r.json.reactions[0].n, 1);
  assert.equal(q('SELECT rev FROM chat_messages WHERE id = ?', a1.id)[0].rev, rev1);
  await react(cleo.key, a1.id, '🎉');
  await react(cleo.key, a1.id, '❤️');
  await react(ana.key, a1.id, '❤️');
  assert.deepEqual(q('SELECT reacts FROM chat_messages WHERE id = ?', a1.id), [{ reacts: 4 }]);
  // Heures distinctes (des appels dans la même milliseconde se départagent par l'id du compte, tiré au hasard).
  [[ben, '🎉'], [cleo, '🎉'], [cleo, '❤️'], [ana, '❤️']].forEach(([who, emoji], i) =>
    e.DB.sqlite.prepare('UPDATE chat_reactions SET created_at = ? WHERE user_id = ? AND emoji = ?').run(`2026-10-24T10:00:0${i}.000Z`, who.user.id, emoji));
  // Chaque lecteur : `mine` pour la sienne, prénoms actuels des autres ; ordre : le premier emoji mis d'abord.
  r = await read(ana.key);
  assert.deepEqual(r.json.messages.map((m) => m.reactions || null), [
    [{ emoji: '🎉', n: 2, mine: false, who: ['Ben', 'Cléo'] }, { emoji: '❤️', n: 2, mine: true, who: ['Cléo'] }], null]);
  assert.ok(!JSON.stringify(r.json).includes(ben.user.id), "jamais l'id interne de qui réagit");
  // Une page ouverte les reçoit par ?after (le message revient, une seule fois), sans rien de nouveau dans last_id.
  r = await read(ben.key, `?after=${rev}`);
  assert.deepEqual([r.json.messages.map((m) => m.id), r.json.deleted, r.json.last_id], [[a1.id], [], a2.id]);
  assert.deepEqual(r.json.messages[0].reactions[1], { emoji: '❤️', n: 2, mine: false, who: ['Cléo', 'Ana'] });
  // Retirer ; déjà retirée : rien ne change.
  r = await react(cleo.key, a1.id, '🎉', false);
  assert.deepEqual(r.json.reactions.map((x) => [x.emoji, x.n, x.mine]), [['🎉', 1, false], ['❤️', 2, true]]);
  assert.equal((await react(cleo.key, a1.id, '🎉', false)).status, 200);
  assert.deepEqual(q('SELECT reacts FROM chat_messages WHERE id = ?', a1.id), [{ reacts: 3 }]);
  // 400 : emoji hors de la liste, `on` manquant, classeur sans prénom ; 404 : message inexistant ou supprimé.
  for (const body of [{ emoji: '💩', on: true }, { emoji: '👍' }, { emoji: '👍', on: 'oui' }, { emoji: ['👍'], on: true }]) {
    assert.equal((await call('POST', `chat/${a1.id}/react`, { key: ben.key, e, body })).status, 400, JSON.stringify(body));
  }
  e.DB.sqlite.prepare('UPDATE users SET name = NULL WHERE id = ?').run(cleo.user.id);
  assert.equal((await react(cleo.key, a1.id, '👍')).status, 400);
  assert.equal((await react(ben.key, 99999, '👍')).status, 404);
  assert.equal((await call('POST', `chat/${a1.id}/react`, { key: 'inconnue-'.repeat(4), e, body: { emoji: '👍', on: true } })).status, 401);
  // Message supprimé : 404, et ses réactions partent avec lui.
  await react(ben.key, a2.id, '👀');
  await del(ana.key, a2.id);
  assert.equal((await react(ben.key, a2.id, '👀')).status, 404);
  assert.deepEqual(q('SELECT COUNT(*) AS n FROM chat_reactions WHERE message_id = ?', a2.id), [{ n: 0 }]);
  // Limites : 30 par minute (mises ou retirées), puis 500 par 24 h ; 429 lisible, rien d'écrit.
  e.DB.sqlite.prepare('UPDATE users SET react_min = 30, react_min_at = ? WHERE id = ?').run(new Date(Date.now() - 20_000).toISOString(), ben.user.id);
  r = await react(ben.key, a1.id, '🔥');
  assert.deepEqual([r.status, r.json.retry_after > 30 && r.json.retry_after <= 40], [429, true], JSON.stringify(r.json));
  assert.match(r.json.error, /30 réactions par minute/);
  e.DB.sqlite.prepare('UPDATE users SET react_min_at = ?, react_day = 500, react_day_at = ? WHERE id = ?').run(hoursAgo(0.1), hoursAgo(20), ben.user.id);
  r = await react(ben.key, a1.id, '🔥');
  assert.deepEqual([r.status, Math.round(r.json.retry_after / 3600)], [429, 4]);
  assert.equal(q("SELECT COUNT(*) AS n FROM chat_reactions WHERE emoji = '🔥'")[0].n, 0);
  // Fenêtres passées : de nouveau permis, compteurs repartis à 1.
  e.DB.sqlite.prepare('UPDATE users SET react_day_at = ? WHERE id = ?').run(hoursAgo(25), ben.user.id);
  assert.equal((await react(ben.key, a1.id, '🔥')).status, 200);
  assert.deepEqual(q('SELECT react_min, react_day FROM users WHERE id = ?', ben.user.id), [{ react_min: 1, react_day: 1 }]);
  e.DB.close();
});

await test('chat : réactions effacées avec leur message (purge) et avec le classeur de leur auteur (pages ouvertes mises à jour)', async () => {
  const { e, q, say, read, bulk } = chatEnv();
  const ana = await signup('Ana', e);
  const ben = await signup('Ben', e);
  const react = (key, id, emoji) => call('POST', `chat/${id}/react`, { key, e, body: { emoji, on: true } });
  const a1 = (await say(ana.key, 'Salut')).json.message;
  const b1 = (await say(ben.key, 'Coucou')).json.message;
  await react(ben.key, a1.id, '👍');
  await react(ana.key, a1.id, '😂');
  await react(ana.key, b1.id, '❤️');
  const { rev } = (await read(ana.key)).json;
  assert.deepEqual((await call('DELETE', 'me', { key: ben.key, e })).json, { ok: true });
  // Ses réactions retirées (le message d'Ana revient par ?after avec ce qui reste), ses messages et leurs réactions partis.
  const r = (await read(ana.key, `?after=${rev}`)).json;
  assert.deepEqual([r.deleted, r.messages.map((m) => [m.id, m.reactions])], [[b1.id], [[a1.id, [{ emoji: '😂', n: 1, mine: true, who: [] }]]]]);
  assert.deepEqual(q('SELECT message_id, emoji FROM chat_reactions'), [{ message_id: a1.id, emoji: '😂' }]);
  assert.deepEqual(q('SELECT reacts FROM chat_messages WHERE id = ?', a1.id), [{ reacts: 1 }]);
  assert.equal(new Set(q('SELECT rev FROM chat_messages').map((x) => x.rev)).size, 2, 'révisions uniques');
  // Purge : les réactions des messages purgés partent dans le même lot.
  bulk(2000, ana.user.id, hoursAgo(48));
  await say(ana.key, 'dernier');
  assert.deepEqual(q('SELECT COUNT(*) AS n FROM chat_reactions'), [{ n: 0 }]);
  e.DB.close();
});

await test('chat : coût des réactions (lues seulement pour les messages qui en ont, par la clé primaire ; écriture bornée)', async () => {
  const { e, say } = chatEnv();
  const ana = await signup('Ana', e);
  const ben = await signup('Ben', e);
  const a1 = (await say(ana.key, 'un')).json.message;
  await say(ana.key, 'deux');
  const seen = [];
  const spy = { ...e, DB: { prepare: (sql) => { seen.push(sql); return e.DB.prepare(sql); }, batch: (s) => e.DB.batch(s) } };
  const planOf = (sql) => e.DB.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((x) => x.detail);
  await call('GET', 'me', { key: ben.key, e: spy });
  seen.length = 0;
  await call('GET', 'chat', { key: ben.key, e: spy });
  assert.ok(!seen.some((s) => /chat_reactions/.test(s)), 'aucune réaction : aucune requête de plus');
  await call('POST', `chat/${a1.id}/react`, { key: ben.key, e: spy, body: { emoji: '👍', on: true } });
  const writes = seen.filter((s) => /^(INSERT|UPDATE|DELETE)/.test(s.trim()));
  for (const s of writes) {
    const plan = planOf(s);
    assert.ok(!plan.some((l) => /^SCAN (?!CONSTANT ROW$|\(subquery-\d+\)$|j$)/.test(l)), s + '\n' + plan.join('\n'));
  }
  seen.length = 0;
  const r = await call('GET', 'chat', { key: ben.key, e: spy });
  assert.equal(r.json.messages[0].reactions[0].n, 1);
  const reads = seen.filter((s) => /chat_reactions/.test(s));
  assert.equal(reads.length, 1);
  const plan = planOf(reads[0]);
  assert.ok(plan.some((l) => /^SEARCH r USING PRIMARY KEY \(message_id=\?\)$/.test(l)), plan.join('\n'));
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

// --- Lectures automatiques (cron) --------------------------------------------------------------------------------

// Membre relié dont la collection vient d'être lue (lecture vérifiée), prêt pour une passe de cron.
async function cronMember(name, e, cards = mini(3)) {
  const u = await signup(name, e);
  const uid = await setGameCards(u.key, cards, { e });
  assert.equal((await refreshNow(u.key, e)).status, 200);
  return { u, uid, cards, id: u.user.id, log: async () => (await call('GET', 'sync-log', { key: u.key, e })).json.entries };
}
const stateOf = (id, e) => JSON.parse(userRow(id, e).sync_state);

await test('cron collection : vérification sans changement → une requête, checked_at posé, rien au journal ; changement ou 6 h → relecture via cron', async () => {
  const e = makeEnv();
  const m = await cronMember('Cron1', e);
  e.DB.sqlite.prepare("UPDATE users SET sync_state = json_set(sync_state, '$.checked_at', '2020-01-01T00:00:00.000Z') WHERE id = ?").run(m.id);
  const lines = (await m.log()).length;
  const n0 = supa.rest().length;
  assert.equal(await runCron(e, COLLECTION_CRON), '1 membre vérifié, 0 relu, 0 échec');
  const calls = supa.rest().slice(n0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /limit=1(&|$)/);
  assert.ok(stateOf(m.id, e).checked_at > '2021', 'checked_at posé');
  assert.equal((await m.log()).length, lines, 'une vérification sans changement ne laisse rien au journal');
  assert.equal(userRow(m.id, e).sync_lock, null);
  // Un exemplaire de plus dans le jeu : relecture complète, notée via cron.
  supa.player(m.uid).cards.push(rowOf(mini(1, 50)[0], { uid: m.uid }));
  assert.equal(await runCron(e, COLLECTION_CRON), '1 membre vérifié, 1 relu, 0 échec');
  let [line] = await m.log();
  assert.deepEqual([line.kind, line.result, line.data.via, line.data.fresh], ['full', 'ok', 'cron', 1]);
  assert.equal(userRow(m.id, e).sync_lock, null);
  // Dernière lecture vérifiée vieille de 7 h : relue même sans changement.
  e.DB.sqlite.prepare("UPDATE users SET sync_state = json_set(sync_state, '$.full_at', ?) WHERE id = ?").run(new Date(Date.now() - 7 * 3600_000).toISOString(), m.id);
  const n1 = supa.rest().length;
  assert.equal(await runCron(e, COLLECTION_CRON), '1 membre vérifié, 1 relu, 0 échec');
  assert.ok(supa.rest().length - n1 > 1);
  [line] = await m.log();
  assert.equal(line.data.via, 'cron');
  assert.ok(Date.now() - Date.parse(stateOf(m.id, e).full_at) < 60_000);
  e.DB.close();
});

await test('cron collection : synchro automatique coupée, membre en pause, SYNC_PAUSED, session à relier → aucun appel au jeu', async () => {
  const e = makeEnv();
  const a = await cronMember('Cron2a', e);
  const b = await cronMember('Cron2b', e);
  const c = await cronMember('Cron2c', e);
  e.DB.sqlite.prepare('UPDATE users SET auto_sync = 0 WHERE id = ?').run(a.id);
  e.DB.sqlite.prepare('UPDATE users SET sync_fails = 3 WHERE id = ?').run(b.id);
  e.DB.sqlite.prepare("UPDATE users SET game_session_lost = 'révoquée' WHERE id = ?").run(c.id);
  const n0 = supa.calls.length;
  assert.equal(await runCron(e, COLLECTION_CRON), '0 membre vérifié, 0 relu, 0 échec');
  assert.equal(supa.calls.length, n0);
  await cronMember('Cron2d', e);
  const paused = makeEnv({ SYNC_PAUSED: '1' });
  paused.DB = e.DB;
  const n1 = supa.calls.length;
  assert.equal(await runCron(paused, COLLECTION_CRON), null);
  assert.equal(supa.calls.length, n1);
  assert.equal(e.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM cron_state WHERE last_at IS NOT NULL").get().n, 1, 'la passe suspendue ne note rien');
  assert.equal(await runCron(e, COLLECTION_CRON), '1 membre vérifié, 0 relu, 0 échec');
  e.DB.close();
});

await test('cron collection : limite du jeu (429) → passe arrêtée, journal, passe suivante sautée, celle d\'après passe', async () => {
  const e = makeEnv();
  const a = await cronMember('Cron3a', e);
  const b = await cronMember('Cron3b', e);
  supa.limit = 429;
  after(() => { supa.limit = null; });
  const n0 = supa.rest().length;
  assert.match(await runCron(e, COLLECTION_CRON), /^limite du jeu/);
  assert.equal(supa.rest().length - n0, 1, 'arrêtée au premier membre');
  const logged = [];
  for (const m of [a, b]) logged.push(...(await m.log()).filter((l) => l.result === 'error'));
  assert.equal(logged.length, 1);
  assert.deepEqual([logged[0].data.via, logged[0].data.status], ['cron', 429]);
  assert.equal([a, b].filter((m) => userRow(m.id, e).sync_fails > 0).length, 0, 'une limite n\'est pas un échec du membre');
  const skip = e.DB.sqlite.prepare("SELECT skip_until, running_until FROM cron_state WHERE name = 'collection'").get();
  assert.ok(Date.parse(skip.skip_until) > Date.now() + 14 * 60_000);
  assert.equal(skip.running_until, null);
  supa.limit = null;
  const n1 = supa.calls.length;
  assert.equal(await runCron(e, COLLECTION_CRON), null, 'passe suivante sautée');
  assert.equal(supa.calls.length, n1);
  assert.equal(await runCron(e, COLLECTION_CRON, { now: Date.now() + 16 * 60_000 }), '2 membres vérifiés, 0 relu, 0 échec');
  e.DB.close();
});

await test('cron collection : trois échecs → pause avec son message ; un « Rafraîchir » réussi la lève', async () => {
  const e = makeEnv();
  const m = await cronMember('Cron4', e);
  supa.fail = (url) => (url.includes('/rest/') ? { status: 502 } : null);
  after(() => { supa.fail = null; });
  for (let k = 1; k <= 3; k++) {
    assert.equal(await runCron(e, COLLECTION_CRON), `0 membre vérifié, 0 relu, 1 échec`);
    assert.equal(userRow(m.id, e).sync_fails, k);
  }
  const [last, before] = await m.log();
  assert.deepEqual([last.result, last.data.via, last.data.status], ['error', 'cron', 502]);
  assert.match(last.message, /Lectures automatiques en pause après 3 échecs : « Rafraîchir »/);
  assert.doesNotMatch(before.message, /en pause/);
  assert.equal((await call('GET', 'me', { key: m.u.key, e })).json.session.paused, true);
  const n0 = supa.calls.length;
  assert.equal(await runCron(e, COLLECTION_CRON), '0 membre vérifié, 0 relu, 0 échec');
  assert.equal(supa.calls.length, n0, 'membre en pause : sauté');
  supa.fail = null;
  const r = await refreshNow(m.u.key, e);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(userRow(m.id, e).sync_fails, 0);
  assert.equal((await call('GET', 'me', { key: m.u.key, e })).json.session.paused, false);
  e.DB.close();
});

await test('cron collection : deux passes en même temps → une seule travaille (bail de cron)', async () => {
  const e = makeEnv();
  await cronMember('Cron5', e);
  const n0 = supa.rest().length;
  const out = await Promise.all([runCron(e, COLLECTION_CRON), runCron(e, COLLECTION_CRON)]);
  assert.deepEqual(out.filter((x) => x !== null), ['1 membre vérifié, 0 relu, 0 échec']);
  assert.equal(supa.rest().length - n0, 1);
  const row = e.DB.sqlite.prepare("SELECT running_until, last_at, last_result FROM cron_state WHERE name = 'collection'").get();
  assert.deepEqual([row.running_until, !!row.last_at, row.last_result], [null, true, out.find((x) => x !== null)]);
  e.DB.close();
});

await test('cron collection : membre dont un clic lit déjà la collection → sauté sans échec ; réglage auto_sync et GET /api/health', async () => {
  const e = makeEnv();
  const m = await cronMember('Cron6', e);
  e.DB.sqlite.prepare('UPDATE users SET sync_lock = ? WHERE id = ?').run(new Date(Date.now() + 60_000).toISOString(), m.id);
  const n0 = supa.calls.length;
  assert.equal(await runCron(e, COLLECTION_CRON), '0 membre vérifié, 0 relu, 0 échec');
  assert.deepEqual([supa.calls.length, userRow(m.id, e).sync_fails], [n0, 0]);
  e.DB.sqlite.prepare('UPDATE users SET sync_lock = NULL WHERE id = ?').run(m.id);
  let r = await call('PATCH', 'me', { key: m.u.key, e, body: { auto_sync: false } });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', 'me', { key: m.u.key, e })).json.session.auto_sync, false);
  assert.equal(await runCron(e, COLLECTION_CRON), '0 membre vérifié, 0 relu, 0 échec');
  r = await call('PATCH', 'me', { key: m.u.key, e, body: { auto_sync: 'oui' } });
  assert.equal(r.status, 400);
  const h = (await call('GET', 'health', { e })).json;
  assert.equal(h.sync_paused, false);
  assert.equal(h.cron.collection.last_result, '0 membre vérifié, 0 relu, 0 échec');
  assert.ok(h.cron.collection.last_at);
  assert.deepEqual(h.cron.market, { last_at: null, last_result: null });
  assert.equal((await call('GET', 'health', { e: { ...e, SYNC_PAUSED: 'oui' } })).json.sync_paused, true);
  e.DB.close();
});

// --- Marché : cotes (cache commun), valeur jour par jour ------------------------------------------------------------

const todayUtc = () => new Date().toISOString().slice(0, 10);

await test('marché : exemplaires par rareté et brillance (variants) lus dans le jeu (snapshot_rarity, brillance), rareté la plus haute', async () => {
  const e = makeEnv();
  const q = (sql, ...p) => e.DB.sqlite.prepare(sql).all(...p).map((r) => ({ ...r }));
  const u = await signup('Vic', e);
  const uid = uidOf(u.key);
  const data = (id) => JSON.parse(q('SELECT data FROM cards WHERE user_id = ? AND card_id = ?', u.user.id, id)[0].data);
  // La rareté d'un exemplaire est son snapshot_rarity (celle des ventes du marché) ; inconnu : celle de la carte.
  const z = { id: 'z', title: 'Zêta', rarity: 'UR', count: 1 };
  const r = await seedCards(u.key, [
    rowOf({ ...z, count: 2 }, { uid, eid: 'z1', snapshot_rarity: 'R' }),
    rowOf({ ...z, shiny: true }, { uid, eid: 'z2' }),
    rowOf(z, { uid, eid: 'z3', snapshot_rarity: 'X' }),
    rowOf({ id: 'a', title: 'Alpha', rarity: 'C', count: 1 }, { uid, eid: 'a1', snapshot_rarity: 'SR' }),
  ], { e });
  assert.deepEqual([r.json.count, r.json.complete, r.json.skipped], [2, true, 0]);
  assert.deepEqual(data('z').variants, { R: 2, UR: 1, 'UR*': 1 });
  assert.deepEqual(Object.keys(data('z')).slice(-1), ['variants'], 'variants en dernier');
  assert.deepEqual([data('z').rarity, data('z').count, data('z').shiny], ['UR', 4, true]);
  assert.deepEqual([data('a').rarity, data('a').variants], ['SR', { SR: 1 }]);
  e.DB.close();
});

await test('marché : valeur du classeur (cotes fiables × exemplaires, un point par jour), après les cotes et les lectures', async () => {
  const e = makeEnv();
  const q = (sql, ...p) => e.DB.sqlite.prepare(sql).all(...p).map((r) => ({ ...r }));
  const u = await signup('Rui', e);
  const uid = uidOf(u.key);
  const market = async () => (await call('GET', 'market', { key: u.key, e })).json;
  const alpha = { id: 'a', title: 'Alpha', rarity: 'R' };
  const gamma = { id: 'c', title: 'Gamma', rarity: 'L', count: 1 };
  // Sans cote : valeur 0, aucun point écrit.
  await seedCards(u.key, [
    rowOf({ ...alpha, count: 2 }, { uid, eid: 'a1' }), rowOf({ ...alpha, count: 1, shiny: true }, { uid, eid: 'a2' }),
    rowOf({ id: 'b', title: 'Bêta', rarity: 'C', count: 1 }, { uid, eid: 'b1' }), rowOf({ id: 'b', title: 'Bêta', rarity: 'C', count: 1, shiny: true }, { uid, eid: 'b2' }),
    rowOf(gamma, { uid, eid: 'c1' }), // pas encore cotée
  ], { e });
  let m = await market();
  assert.deepEqual([m.value, m.history, m.live], [{ value: 0, priced: 0, cards: 3, approx: 0 }, [], null]);
  assert.equal(q('SELECT COUNT(*) AS n FROM value_history')[0].n, 0);
  // Cotes (R* n'a que 2 ventes : pas fiable, hors valeur) : GET /api/market recalcule et écrit le point du jour.
  putPrice(e, 'a', { R: cote(100, 5), 'R*': cote(500, 2) });
  putPrice(e, 'b', { C: cote(10, 3), 'C*': cote(50, 4) });
  const points = () => q('SELECT date, value, priced, cards, at FROM value_history WHERE user_id = ?', u.user.id);
  const todayPoint = () => points().find((p) => p.date === todayUtc());
  m = await market();
  assert.deepEqual(m.value, { value: 2 * 100 + 10 + 50, priced: 2, cards: 3, approx: 0 });
  assert.deepEqual(points().map(({ at, ...p }) => p), [{ date: todayUtc(), value: 260, priced: 2, cards: 3 }]);
  // Le dernier calcul du jour remplace le précédent (un point par jour) ; un jour passé reste.
  e.DB.sqlite.prepare("INSERT INTO value_history (user_id, date, value, priced, cards, at) VALUES (?, '2026-10-10', 111, 1, 3, '2026-10-10T20:00:00.000Z')").run(u.user.id);
  putPrice(e, 'c', { L: cote(1000, 3) });
  m = await market();
  assert.deepEqual(m.history.map((p) => [p.date, p.value]), [['2026-10-10', 111], [todayUtc(), 1260]]);
  assert.equal(points().length, 2);
  // Après une lecture : recalculée au plus une fois par heure.
  const at0 = todayPoint().at;
  await seedCards(u.key, [rowOf({ ...alpha, count: 4 }, { uid, eid: 'a1' }), rowOf(gamma, { uid, eid: 'c1' })], { e });
  assert.equal(todayPoint().at, at0, "moins d'une heure : pas recalculée");
  e.DB.sqlite.prepare("UPDATE value_history SET at = '2026-01-01T00:00:00.000Z' WHERE date <> '2026-10-10'").run();
  await seedCards(u.key, [rowOf({ ...alpha, count: 5 }, { uid, eid: 'a1' }), rowOf(gamma, { uid, eid: 'c1' })], { e });
  assert.deepEqual([todayPoint().value, todayPoint().cards], [5 * 100 + 1000, 2]);
  e.DB.close();
});

await test('marché : GET /api/market/prices (cotes de mes cartes et des cartes voulues, par pages) et mesures de CPU', async () => {
  const e = makeEnv();
  const u = await signup('Val', e);
  const cards = mini(1500);
  await seedCards(u.key, cards, { e });
  cards.forEach((c, i) => { if (i % 3) putPrice(e, c.id, { C: cote(10 + i, 5, { w: 9 }), 'C*': cote(99, 1) }); else putPrice(e, c.id, {}); });
  e.DB.sqlite.prepare('INSERT INTO market (user_id, ids) VALUES (?, ?)').run(u.user.id, JSON.stringify({ 'Voulue 1': 'voulue-1', 'Voulue 2': 'voulue-2' }));
  putPrice(e, 'voulue-1', { R: cote(70, 4) });
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
  const value = await profile('GET', 'market', { key: u.key, e });
  assert.equal(value.json.value.cards, 1500);
  console.log(`    marché : page de 1 000 cotes JS ${ms(pages[0].js)} | valeur JS ${ms(value.js)} (SQLite ${ms(value.sql)})`);
  assert.ok(pages[0].js < 10 && value.js < 10, 'trop de JavaScript');
  e.DB.close();
});

// --- Marché : passes de lecture dans la base du jeu (simulée) ------------------------------------------------------

const H = 3600_000;
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();
const restPaths = (from) => supa.rest().slice(from).map((c) => decodeURIComponent(c.url.slice('https://cyrxjeppjqsxxjayfrur.supabase.co/rest/v1/'.length)));
// Vente conclue (cache des cotes) et enchère en cours, rangées dans le jeu par un vendeur tiers.
const seller = () => supa.player('vendeur-tiers');
const sale = (card, rarity, price, ageMs, shiny = false) => ({ id: `v${seller().auctions.length}`, card_id: card, status: 'settled_sold', snapshot_rarity: rarity, is_shiny: shiny,
  final_price: price, settled_at: isoAgo(ageMs), end_at: isoAgo(ageMs + 1000), seller_id: 'vendeur', winner_id: 'acheteur' });
const addAuctions = (...xs) => seller().auctions.push(...xs);
const clearMarketGame = () => {
  seller().auctions = [];
  supa.cards = [];
};
// Cartes possédées c0…c(n-1), titrées « Carte i », rareté C.
const ownCards = (uid, n, extra = {}) => Array.from({ length: n }, (_, i) => rowOf({ id: `c${i}`, title: `Carte ${i}`, rarity: 'C', count: 1 }, { uid, eid: `e${i}`, ...(extra[i] || {}) }));
async function marketMember(name, e, cards = (uid) => ownCards(uid, 3)) {
  const u = await signup(name, e);
  const uid = uidOf(u.key);
  await seedCards(u.key, cards(uid), { e });
  const market = async () => (await call('GET', 'market', { key: u.key, e })).json;
  // « Mettre à jour les cotes », sans la limite d'une passe par minute (les tests en enchaînent).
  const press = () => {
    e.DB.sqlite.prepare("UPDATE market SET attempt = json_set(attempt, '$.start', ?) WHERE user_id = ? AND json_valid(attempt)").run(isoAgo(10 * 60_000), u.user.id);
    return call('POST', 'market/refresh', { key: u.key, e, body: {} });
  };
  // Passe complète (celle des lectures automatiques, avec les cotes du plan), sans passer par le cron ; rendue comme une
  // réponse de l'API.
  const full = async () => {
    try {
      return { status: 200, json: await marketPass(e, userRow(u.user.id, e), { via: 'clic' }) };
    } catch (err) {
      return { status: err.status || 500, json: { error: err.message, ...(err.extra || {}) } };
    }
  };
  return { u, uid, id: u.user.id, market, press, full };
}
const priceOf = (e, id) => {
  const row = e.DB.sqlite.prepare('SELECT data FROM prices WHERE card_id = ?').get(id);
  return row ? JSON.parse(row.data) : undefined;
};

await test('marché : une passe (cotes : médiane des 30 ventes, 7 jours, brillance et rareté à part ; bonnes affaires, enchères, ventes ; titres résolus ; une requête par seconde)', async () => {
  const e = makeEnv({ REFRESH_PAUSE_MS: '15' });
  clearMarketGame();
  const m = await marketMember('Mia', e, (uid) => ownCards(uid, 60, { 4: { snapshot_rarity: 'R' } }));
  const { uid } = m;
  const item = (title) => ({ title, description: null, image: null, status: 'ok' });
  const odd = 'Avec, virgule (et "guillemets")';
  assert.equal((await call('POST', 'targets/save', { key: m.u.key, e, body: { name: 'Envies', items: ['Voulue 1', 'Voulue 2', odd, 'Carte 3', 'Inconnue'].map(item) } })).status, 200);
  supa.cards = [{ id: 'w1', wikipedia_title: 'Voulue 1', lang: 'fr' }, { id: 'w2-en', wikipedia_title: 'Voulue 2', lang: 'en' }, { id: 'w2', wikipedia_title: 'Voulue 2', lang: 'fr' },
    { id: 'w3', wikipedia_title: odd, lang: 'fr' }, { id: 'c3', wikipedia_title: 'Carte 3', lang: 'fr' }];
  // Ventes : c0 en R (40, dont 12 de plus de 7 jours), en R brillante (3), en C (2 : pas fiable) ; c2 : une seule, de plus
  // de 90 jours (pas lue) ; les cartes voulues w1 (R), w2 (SR), w3 (C).
  for (let i = 0; i < 40; i++) addAuctions(sale('c0', 'R', i + 1, (i * 6 + 1) * H));
  addAuctions(sale('c0', 'R', 999, 2 * H, true), sale('c0', 'R', 100, 3 * H, true), sale('c0', 'R', 200, 4 * H, true));
  addAuctions(sale('c0', 'C', 5, H), sale('c0', 'C', 7, 2 * H), sale('c2', 'C', 50, 100 * 24 * H));
  for (let i = 0; i < 5; i++) addAuctions(sale('w1', 'R', 100, i * H), sale('w2', 'SR', 100, i * H));
  for (let i = 0; i < 3; i++) addAuctions(sale('w3', 'C', 100, i * H));
  const card = (t) => ({ wikipedia_title: t, image_url: 'https://upload.wikimedia.org/' + t.length + '.jpg', hide_image: false });
  const soon = (ms) => new Date(Date.now() + ms).toISOString();
  const active = (id, cardId, rarity, extra) => ({ id, card_id: cardId, status: 'active', snapshot_rarity: rarity, is_shiny: false, seller_id: 'vendeur', current_bid: null,
    current_bidder_id: null, base_amount: 10, card: card('Titre du jeu ' + cardId), ...extra });
  addAuctions(
    active('a1', 'w1', 'R', { base_amount: 50, end_at: soon(H) }), // sans enchère, 50 % de la cote
    active('a1b', 'w1', 'R', { base_amount: 90, end_at: soon(1.5 * H) }), // sans enchère, finit dans moins de 2 h, départ ≤ cote
    active('a2', 'w2', 'SR', { current_bid: 70, current_bidder_id: 'quelqu-un', base_amount: 20, end_at: soon(5 * H) }), // 70 % de la cote
    active('a3', 'w3', 'C', { current_bid: 95, current_bidder_id: 'quelqu-un', end_at: soon(3 * H) }), // 95 % : gardée (la page filtre), mais pas la moins chère
    active('a3b', 'w3', 'C', { base_amount: 90, end_at: soon(3 * H) }), // sans enchère, 90 %
    active('a4', 'w1', 'R', { seller_id: uid, base_amount: 1, end_at: soon(H) }), // la mienne
    active('a5', 'w1', 'R', { is_shiny: true, base_amount: 1, end_at: soon(H) }), // brillante : pas de cote
    active('a6', 'w3', 'C', { current_bid: 85, current_bidder_id: uid, end_at: soon(4 * H) }), // j'y mène, 85 % : la moins chère de w3
    // Mes ventes : en cours avec une enchère, vendue, invendue, trop ancienne.
    active('s1', 'c5', 'C', { seller_id: uid, base_amount: 30, current_bid: 35, current_bidder_id: 'x', end_at: soon(2 * H) }),
    { ...active('s2', 'c6', 'C', { seller_id: uid, base_amount: 30, end_at: isoAgo(30 * H) }), status: 'settled_sold', final_price: 70 },
    { ...active('s3', 'c7', 'C', { seller_id: uid, base_amount: 30, end_at: isoAgo(40 * H) }), status: 'settled_unsold' },
    { ...active('s4', 'c8', 'C', { seller_id: uid, base_amount: 30, end_at: isoAgo(20 * 24 * H) }), status: 'settled_sold', final_price: 1 },
    { ...active('a7', 'c9', 'C', { end_at: isoAgo(5 * H) }), status: 'settled_sold', final_price: 80, winner_id: uid },
    { ...active('a8', 'c9', 'C', { end_at: isoAgo(6 * H) }), status: 'settled_sold', final_price: 120, winner_id: 'autre' },
  );
  const auctionOf = (id) => seller().auctions.find((a) => a.id === id);
  const bid = (auction, amount, ageMs) => ({ bidder_id: uid, amount, placed_at: isoAgo(ageMs), auction: auctionOf(auction) });
  supa.player(uid).bids = [bid('a6', 85, H), bid('a6', 40, 2 * H), bid('a7', 80, 6 * H), bid('a8', 110, 7 * H), bid('a8', 5, 30 * 24 * H)];
  for (let i = 5; i < 10; i++) addAuctions(sale(`c${i}`, 'C', 40, i * H), sale(`c${i}`, 'C', 50, i * H), sale(`c${i}`, 'C', 60, i * H));
  const t0 = Date.now();
  const n0 = supa.rest().length;
  const r = await m.full();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { ok: true, read: 63, left: 0, deals: 3, running: 1 });
  // Rythme et plafond : 30 requêtes au plus, une pause d'une seconde (ici REFRESH_PAUSE_MS) avant chacune sauf la première.
  const calls = supa.rest().slice(n0);
  assert.equal(calls.length, 6);
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i].at - calls[i - 1].at >= 14, `requêtes ${i} et ${i + 1} sans pause`);
  const paths = restPaths(n0);
  assert.ok(paths[0].startsWith('auction_bids?') && paths[0].includes(`bidder_id=eq.${uid}`), 'mes enchères d\'abord');
  assert.ok(paths[1].startsWith('auctions?') && paths[1].includes(`seller_id=eq.${uid}`), 'puis mes ventes');
  assert.ok(paths[2].startsWith('cards?') && paths[2].includes('wikipedia_title=in.("Voulue 1","Voulue 2","Avec, virgule (et \\"guillemets\\")","Inconnue")'), 'titres entre guillemets');
  assert.ok(paths[3].includes('status=eq.active') && paths[3].includes('card_id=in.("w1","w2","w3")') && paths[3].includes('order=end_at'), 'enchères en cours des cartes voulues');
  assert.ok(paths[4].includes('card_id=in.("w1","w3","w2","c9","c5")'), 'cotes des enchères (les miennes comprises) avant celles du plan : ' + paths[4]);
  assert.ok(paths.filter((p) => p.includes('status=eq.settled_sold')).every((p) => p.includes('order=card_id,settled_at.desc,id&limit=1000&offset=')), 'ventes : ordre stable, pages de 1 000');
  // Les cotes rangées (cache commun).
  assert.deepEqual(priceOf(e, 'c0').R, { p: 15.5, n: 40, w: 34.5, l: 1, d: seller().auctions[0].settled_at });
  assert.ok(Date.parse(priceOf(e, 'c0').R.d) <= t0 - H + 50);
  assert.deepEqual(priceOf(e, 'c0')['R*'], { p: 200, n: 3, w: null, l: 999, d: seller().auctions[40].settled_at }, 'brillantes à part');
  assert.deepEqual(priceOf(e, 'c0').C, { p: 6, n: 2, w: null, l: 5, d: seller().auctions[43].settled_at }, 'rareté d\'exemplaire à part (2 ventes : pas fiable)');
  assert.deepEqual([priceOf(e, 'c1'), priceOf(e, 'c2')], [{}, {}], 'sans vente sur 90 jours : datée, sans cote');
  assert.equal(priceOf(e, 'c5').C.p, 50);
  // La lecture du marché, montrée par la page ; l'essai noté réussi, lu par le serveur.
  const mk = await m.market();
  assert.deepEqual(mk.live.deals.map((d) => [d.a, d.ask, d.bid, d.lead, d.cote, d.t]), [['a1', 50, false, false, 100, 'Voulue 1'], ['a6', 85, true, true, 100, odd], ['a2', 70, true, false, 100, 'Voulue 2']],
    'au plus à la cote (2026-10-24), de la fin la plus proche à la plus lointaine');
  assert.deepEqual(mk.live.deals.map((d) => d.more), [1, 2, 0], 'la moins chère par carte, les autres comptées (a1b ; a3, a3b)');
  assert.deepEqual(mk.live.bids.map((b) => [b.a, b.st, b.mine, b.cur, b.lead, b.cote]), [['a6', 'run', 85, 85, true, 100], ['a7', 'won', 80, 80, false, 50], ['a8', 'lost', 110, 120, false, 50]]);
  assert.deepEqual(mk.live.sales.map((x) => [x.a, x.st, x.base, x.cur, x.bid]), [['s1', 'run', 30, 35, true], ['a4', 'run', 1, null, false], ['s2', 'sold', 30, 70, false], ['s3', 'unsold', 30, null, false]]);
  assert.equal(mk.live.deals[0].img, 'https://upload.wikimedia.org/' + 'Titre du jeu w1'.length + '.jpg');
  assert.ok(!JSON.stringify(mk.live).includes(uid) && !JSON.stringify(mk.live).includes('quelqu-un'), 'identifiants du jeu dans la lecture du marché');
  assert.deepEqual([mk.attempt.ok, mk.attempt.v, mk.attempt.auto, 'why' in mk.attempt], [true, 'serveur', false, false]);
  assert.deepEqual(mk.value, { value: 250, priced: 5, cards: 60, approx: 0 });
  assert.equal((await call('GET', 'me', { key: m.u.key, e })).json.market_at, mk.attempt.end > mk.live_at ? mk.attempt.end : mk.live_at);
  // Titres -> cartes gardés, "" compris (aucune carte de ce titre), jamais l'identifiant du joueur.
  const ids = JSON.parse(e.DB.sqlite.prepare('SELECT ids FROM market WHERE user_id = ?').get(m.id).ids);
  assert.deepEqual(ids, { 'Voulue 1': 'w1', 'Voulue 2': 'w2', [odd]: 'w3', Inconnue: '' });
  assert.ok(!JSON.stringify(e.DB.sqlite.prepare('SELECT * FROM market WHERE user_id = ?').get(m.id)).includes(uid));
  // Passe suivante : titres déjà résolus pas recherchés, cotes fraîches (moins de 12 h) pas relues ; les cartes des
  // enchères, elles, le sont toujours.
  const n1 = supa.rest().length;
  const again = await m.full();
  assert.deepEqual([again.status, again.json.left], [200, 0]);
  const p1 = restPaths(n1);
  assert.ok(!p1.some((p) => p.startsWith('cards?')), 'titres déjà résolus redemandés');
  assert.ok(!p1.some((p) => p.includes('status=eq.settled_sold') && p.includes('"c1"')), 'cote fraîche relue');
  assert.ok(p1.some((p) => p.includes('status=eq.settled_sold') && p.includes('"w1"')), 'cote d\'une enchère en cours toujours relue');
  clearMarketGame();
  e.DB.close();
});

await test('marché : bonnes affaires, les 150 meilleures remises (prix demandé / cote), puis par fin', async () => {
  const e = makeEnv({ REFRESH_PAUSE_MS: '1' });
  clearMarketGame();
  const m = await marketMember('Rem', e);
  const N = 220;
  const t = (i) => `Remise ${i}`;
  const item = (title) => ({ title, description: null, image: null, status: 'ok' });
  assert.equal((await call('POST', 'targets/save', { key: m.u.key, e, body: { name: 'Remises', items: Array.from({ length: N }, (_, i) => item(t(i))) } })).status, 200);
  supa.cards = Array.from({ length: N }, (_, i) => ({ id: `r${i}`, wikipedia_title: t(i), lang: 'fr' }));
  // Cote 100 pour chacune ; r<i> demandée à 1 + i/2 W (r0 : 1 %, r199 : 100 %), r200 à r219 au-dessus de la cote ; la fin
  // la plus proche pour les plus chères : un tri par fin garderait les mauvaises.
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < 3; k++) addAuctions(sale(`r${i}`, 'C', 100, (k + 1) * H));
    addAuctions({ id: `x${i}`, card_id: `r${i}`, status: 'active', snapshot_rarity: 'C', is_shiny: false, seller_id: 'vendeur', current_bid: null, current_bidder_id: null,
      base_amount: i < 200 ? 1 + Math.floor(i / 2) : 101 + i, end_at: new Date(Date.now() + (N - i) * 60_000).toISOString(), card: { wikipedia_title: t(i), image_url: null, hide_image: false } });
  }
  const r = await m.full();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.deals, 150, 'au-dessus de la cote : écartées ; 150 au plus');
  const deals = (await m.market()).live.deals;
  assert.ok(deals.every((d) => d.ask <= d.cote), 'au plus à la cote');
  assert.deepEqual(deals.map((d) => d.a), Array.from({ length: 150 }, (_, i) => `x${149 - i}`), 'les 150 meilleures remises, de la fin la plus proche à la plus lointaine');
  clearMarketGame();
  e.DB.close();
});

await test('marché : plan (cotes les plus anciennes d\'abord), 30 requêtes au plus par passe, la suivante reprend, quota du jour', async () => {
  const e = makeEnv();
  clearMarketGame();
  // Plan : own-a fraîche (pas relue), own-b de plus de 12 h, own-c très ancienne, own-d jamais lue.
  const p = await marketMember('Paz', e, (uid) => ['a', 'b', 'c', 'd'].map((x) => rowOf({ id: `own-${x}`, title: `Titre ${x}`, rarity: 'C', count: 1 }, { uid })));
  putPrice(e, 'own-a', {});
  for (const [id, at] of [['own-b', '2026-10-15T00:00:00.000Z'], ['own-c', '2026-09-01T00:00:00.000Z']]) {
    putPrice(e, id, {});
    e.DB.sqlite.prepare('UPDATE prices SET read_at = ? WHERE card_id = ?').run(at, id);
  }
  let n0 = supa.rest().length;
  let r = await p.full();
  assert.deepEqual([r.status, r.json.read, r.json.left], [200, 3, 0], JSON.stringify(r.json));
  assert.ok(restPaths(n0).some((x) => x.includes('card_id=in.("own-d","own-c","own-b")')), restPaths(n0).join('\n'));
  // 2 950 cartes : 2 requêtes (enchères, ventes) + 28 de cotes ; la première carte a 1 200 ventes (deux pages).
  const m = await marketMember('Pio', e, (uid) => Array.from({ length: 2950 }, (_, i) => rowOf({ id: `p${String(i).padStart(4, '0')}`, title: `P ${i}`, rarity: 'C', count: 1 }, { uid })));
  for (let i = 0; i < 1200; i++) addAuctions(sale('p0000', 'C', 10 + (i % 7), (i + 1) * 60_000));
  n0 = supa.rest().length;
  r = await m.full();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(supa.rest().length - n0, 30, 'plafond de 30 requêtes');
  assert.deepEqual([r.json.read, r.json.left], [2700, 250]);
  const paths = restPaths(n0);
  assert.deepEqual(paths.filter((x) => x.includes('"p0000"')).map((x) => x.match(/offset=(\d+)/)[1]), ['0', '1000'], 'deux pages, dans le même ordre');
  assert.equal(priceOf(e, 'p0000').C.n, 1200);
  const asked = (list) => list.filter((x) => x.includes('settled_sold')).flatMap((x) => x.match(/card_id=in\.\(([^)]*)\)/)[1].split(',').map((s) => s.replace(/"/g, '')));
  const before = new Set(asked(paths));
  n0 = supa.rest().length;
  r = await m.full();
  assert.deepEqual([r.status, r.json.read, r.json.left], [200, 250, 0]);
  const now = asked(restPaths(n0));
  assert.equal(new Set(now).size, 250);
  assert.ok(now.every((id) => !before.has(id)), 'la passe suivante reprend là où la première s\'est arrêtée');
  // Quota du classeur atteint : rien n'est lu, 429, la raison notée dans l'essai.
  e.DB.sqlite.prepare("UPDATE market SET quota_n = 15000, quota_day = ? WHERE user_id = ?").run(todayUtc(), m.id);
  n0 = supa.calls.length;
  r = await m.press();
  assert.deepEqual([r.status, r.json.quota], [429, 0]);
  assert.match(r.json.error, /^Quota du jour des cotes atteint pour ton classeur \(ou pour tout le site\) : reprise demain\. Rien n'a été lu\.$/);
  assert.equal(supa.calls.length, n0);
  const a = (await m.market()).attempt;
  assert.deepEqual([a.ok, a.why, a.v], [false, r.json.error, 'serveur']);
  clearMarketGame();
  e.DB.close();
});

await test('marché : « Synchro rapide du marché » (fast_sync), 60 requêtes par passe pour qui l\'a cochée seulement', async () => {
  const e = makeEnv();
  clearMarketGame();
  const many = (p) => (uid) => Array.from({ length: 6000 }, (_, i) => rowOf({ id: `${p}${String(i).padStart(4, '0')}`, title: `${p} ${i}`, rarity: 'C', count: 1 }, { uid }));
  const fast = await marketMember('Rapide', e, many('f'));
  const slow = await marketMember('Lent', e, many('s'));
  assert.equal((await call('GET', 'me', { key: fast.u.key, e })).json.fast_sync, false, 'coupée par défaut');
  for (const bad of ['oui', 1, null]) assert.equal((await call('PATCH', 'me', { key: fast.u.key, e, body: { fast_sync: bad } })).status, 400, JSON.stringify(bad));
  let r = await call('PATCH', 'me', { key: fast.u.key, e, body: { fast_sync: true } });
  assert.deepEqual([r.status, r.json.fast_sync, r.json.auto_sync], [200, true, true]);
  assert.equal((await call('GET', 'me', { key: fast.u.key, e })).json.fast_sync, true);
  let n0 = supa.rest().length;
  r = await fast.full();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(supa.rest().length - n0, 60, 'plafond de 60 requêtes avec la case cochée');
  n0 = supa.rest().length;
  r = await slow.full();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(supa.rest().length - n0, 30, 'les autres gardent 30 requêtes');
  clearMarketGame();
  e.DB.close();
});

await test('marché : lot partiel au plafond (seules les cartes lues en entier gardées)', async () => {
  const e = makeEnv();
  clearMarketGame();
  // 30 requêtes : enchères, ventes, puis le premier lot de 100 cartes dont la première a 28 000 ventes (28 pages pleines) :
  // le plafond tombe au milieu, aucune carte de ce lot n'est lue en entier sauf celles d'avant la dernière vue.
  const m = await marketMember('Lou', e, (uid) => Array.from({ length: 100 }, (_, i) => rowOf({ id: `k${String(i).padStart(3, '0')}`, title: `K ${i}`, rarity: 'C', count: 1 }, { uid })));
  for (let i = 0; i < 27_500; i++) addAuctions(sale('k000', 'C', 10, (i + 1) * 1000));
  for (let i = 0; i < 600; i++) addAuctions(sale('k001', 'C', 20, (i + 1) * 1000));
  const r = await m.full();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  // 28 pages lues : k000 entière (27 500), puis 500 de k001 : k001 coupée (dernière vue) n'est pas gardée, ni les autres.
  assert.deepEqual([r.json.read, r.json.left], [1, 99]);
  assert.equal(priceOf(e, 'k000').C.n, 27_500);
  assert.equal(priceOf(e, 'k001'), undefined);
  clearMarketGame();
  e.DB.close();
});

await test('marché : « Actualiser le marché » au clic = passe légère (sans les cotes du plan), qui ne repousse pas la passe complète du cron', async () => {
  const e = makeEnv();
  clearMarketGame();
  const m = await marketMember('Lea', e, (uid) => Array.from({ length: 500 }, (_, i) => rowOf({ id: `l${String(i).padStart(3, '0')}`, title: `L ${i}`, rarity: 'C', count: 1 }, { uid })));
  const soon = new Date(Date.now() + H).toISOString();
  addAuctions({ id: 'ls1', card_id: 'l001', status: 'active', snapshot_rarity: 'C', is_shiny: false, seller_id: m.uid, base_amount: 30, current_bid: null, current_bidder_id: null, end_at: soon },
    sale('l001', 'C', 40, H), sale('l001', 'C', 50, H), sale('l001', 'C', 60, H));
  // Avant tout clic : une passe complète (cron), notée sans light.
  assert.equal(await runCron(e, MARKET_CRON), '1 membre lu, 0 échec');
  assert.equal((await m.market()).attempt.light, undefined);
  // Clic (press recule de 10 min le début de la passe du cron, pour passer la limite d'un clic par minute) : mes enchères, mes ventes, puis les cotes de la carte en vente ; aucune cote du plan.
  const n0 = supa.rest().length;
  const r = await m.press();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { ok: true, read: 1, left: 0, deals: 0, running: 0, light: true });
  const paths = restPaths(n0);
  assert.equal(paths.length, 3, paths.join('\n'));
  assert.ok(paths[2].includes('card_id=in.("l001")'), paths[2]);
  assert.equal(priceOf(e, 'l001').C.p, 50);
  const mk = await m.market();
  assert.deepEqual([mk.attempt.ok, mk.attempt.light, mk.attempt.auto], [true, true, false]);
  assert.ok(Date.parse(mk.attempt.full) < Date.parse(mk.attempt.start) - 9 * 60_000, 'full : début de la passe du cron, gardé : ' + JSON.stringify(mk.attempt));
  assert.deepEqual(mk.live.sales.map((x) => [x.a, x.st]), [['ls1', 'run']]);
  // Le cron regarde la dernière passe complète : récente, il saute ; 25 min plus tard, il relit, même juste après un clic.
  assert.equal(await runCron(e, MARKET_CRON), '0 membre lu, 0 échec');
  e.DB.sqlite.prepare("UPDATE market SET attempt = json_set(attempt, '$.full', ?) WHERE user_id = ?").run(isoAgo(25 * 60_000), m.id);
  assert.equal((await m.press()).status, 200);
  assert.equal(await runCron(e, MARKET_CRON), '1 membre lu, 0 échec');
  const after = (await m.market()).attempt;
  assert.deepEqual([after.light, after.auto, 'full' in after], [undefined, true, false]);
  // Échec d'une passe légère : light et full gardés.
  supa.fail = (url) => (url.includes('/rest/') ? { status: 502 } : null);
  assert.equal((await m.press()).status, 502);
  supa.fail = null;
  const failed = (await m.market()).attempt;
  assert.deepEqual([failed.ok, failed.light], [false, true]);
  assert.ok(Date.parse(failed.full) < Date.parse(failed.start) - 9 * 60_000, 'full gardé : ' + JSON.stringify(failed));
  clearMarketGame();
  e.DB.close();
});

await test('marché : limite du jeu (429, automation_limit) au milieu → cotes déjà lues gardées, essai raté avec sa raison ; session à relier ; une passe à la fois ; une par minute', async () => {
  const e = makeEnv();
  clearMarketGame();
  const m = await marketMember('Max', e, (uid) => Array.from({ length: 450 }, (_, i) => rowOf({ id: `q${String(i).padStart(3, '0')}`, title: `Q ${i}`, rarity: 'C', count: 1 }, { uid })));
  for (const [status, body] of [[429, { message: 'Too Many Requests' }], [403, { code: 'automation_limit', message: 'Trop de requêtes' }]]) {
    e.DB.sqlite.prepare("UPDATE prices SET read_at = '2000-01-01T00:00:00.000Z'").run();
    seller().auctions = [sale('q000', 'C', 10, H), sale('q000', 'C', 12, H), sale('q000', 'C', 14, H)];
    // Requêtes : mes enchères, mes ventes, puis les lots de 100 ; la 5e (3e lot) est refusée : la lecture du marché était
    // déjà rangée.
    const base = supa.calls.length;
    supa.fail = (url, n) => (n === base + 5 ? { status, body } : null);
    const r = await m.full();
    supa.fail = null;
    assert.deepEqual([r.status, r.json.limited], [429, true], JSON.stringify(r.json));
    assert.equal(r.json.error, 'Le jeu limite les lectures automatiques : réessaie plus tard. 200 cotes lues avant l\'arrêt ont été gardées, avec les bonnes affaires et tes enchères.');
    assert.equal(supa.calls.length - base, 5, 'plus rien après le refus');
    assert.equal(priceOf(e, 'q000').C.p, 12);
    const mk = await m.market();
    assert.deepEqual([mk.attempt.ok, mk.attempt.why, mk.attempt.v], [false, r.json.error, 'serveur']);
    assert.ok(mk.live, 'lecture du marché rangée avant le refus');
  }
  // Refus dès la première requête : rien de lu, la raison seule.
  let base = supa.calls.length;
  supa.fail = (url, n) => (n === base + 1 ? { status: 429, body: {} } : null);
  let r = await m.press();
  supa.fail = null;
  assert.deepEqual([r.status, r.json.error], [429, 'Le jeu limite les lectures automatiques : réessaie plus tard.']);
  // Une passe à la fois par compte (bail partagé avec la lecture de la collection) : 409, rien demandé au jeu.
  e.DB.sqlite.prepare('UPDATE users SET sync_lock = ? WHERE id = ?').run(new Date(Date.now() + 60_000).toISOString(), m.id);
  base = supa.calls.length;
  r = await m.press();
  assert.equal(r.status, 409);
  assert.equal(supa.calls.length, base);
  e.DB.sqlite.prepare('UPDATE users SET sync_lock = NULL WHERE id = ?').run(m.id);
  // Une par minute : moins d'une minute après le début de la précédente, 429 retry_after.
  assert.equal((await m.press()).status, 200);
  r = await call('POST', 'market/refresh', { key: m.u.key, e, body: {} });
  assert.equal(r.status, 429);
  assert.ok(r.json.retry_after >= 1 && r.json.retry_after <= 60, JSON.stringify(r.json));
  assert.equal(userRow(m.id, e).sync_lock, null, 'bail rendu');
  // Session à relier : 401 needs_link, l'essai noté raté avec la raison.
  e.DB.sqlite.prepare("UPDATE users SET game_session_lost = 'révoquée' WHERE id = ?").run(m.id);
  base = supa.calls.length;
  r = await m.press();
  assert.deepEqual([r.status, r.json.needs_link], [401, true]);
  assert.equal(supa.calls.length, base);
  const a = (await m.market()).attempt;
  assert.deepEqual([a.ok, /relie ton compte/.test(a.why)], [false, true]);
  assert.equal(userRow(m.id, e).sync_lock, null, 'bail rendu');
  // Sans compte du jeu relié.
  const v = await signup('Nil', e);
  r = await call('POST', 'market/refresh', { key: v.key, e, body: {} });
  assert.deepEqual([r.status, r.json.needs_link], [401, true]);
  clearMarketGame();
  e.DB.close();
});

await test('cron marché : membres éligibles, lus il y a moins de 20 min sautés, limite du jeu → passe arrêtée et suivante sautée', async () => {
  const e = makeEnv();
  clearMarketGame();
  const a = await marketMember('Mka', e);
  const b = await marketMember('Mkb', e);
  const c = await marketMember('Mkc', e);
  e.DB.sqlite.prepare('UPDATE users SET auto_sync = 0 WHERE id = ?').run(c.id);
  // b : relu au clic (passe légère) : pas sauté, le cron fait sa passe complète.
  assert.equal((await b.press()).status, 200);
  let n0 = supa.rest().length;
  assert.equal(await runCron(e, MARKET_CRON), '2 membres lus, 0 échec');
  assert.ok(supa.rest().length > n0);
  let at = (await a.market()).attempt;
  assert.deepEqual([at.ok, at.auto, at.v], [true, true, 'serveur']);
  assert.equal((await c.market()).attempt, null, 'synchro automatique coupée');
  // Tout le monde lu il y a moins de 20 min : rien.
  n0 = supa.calls.length;
  assert.equal(await runCron(e, MARKET_CRON), '0 membre lu, 0 échec');
  assert.equal(supa.calls.length, n0);
  // 25 min plus tard, limite du jeu : passe arrêtée au premier membre, la suivante sautée, celle d'après passe.
  e.DB.sqlite.prepare("UPDATE market SET attempt = json_set(attempt, '$.start', ?) WHERE json_valid(attempt)").run(isoAgo(25 * 60_000));
  supa.limit = 'automation_limit';
  after(() => { supa.limit = null; });
  n0 = supa.rest().length;
  assert.equal(await runCron(e, MARKET_CRON), 'limite du jeu (0 membre lu, 1 échec)');
  assert.equal(supa.rest().length - n0, 1);
  assert.equal([a, b].filter((x) => userRow(x.id, e).sync_fails > 0).length, 0, 'une limite n\'est pas un échec du membre');
  const skip = e.DB.sqlite.prepare("SELECT skip_until, running_until FROM cron_state WHERE name = 'market'").get();
  assert.ok(Date.parse(skip.skip_until) > Date.now() + 24 * 60_000);
  assert.equal(skip.running_until, null);
  supa.limit = null;
  assert.equal(await runCron(e, MARKET_CRON), null, 'passe suivante sautée');
  e.DB.sqlite.prepare("UPDATE market SET attempt = json_set(attempt, '$.start', ?) WHERE json_valid(attempt)").run(isoAgo(60 * 60_000));
  assert.equal(await runCron(e, MARKET_CRON, { now: Date.now() + 26 * 60_000 }), '2 membres lus, 0 échec');
  // Trois échecs d'affilée → membre en pause (le même compteur que la collection).
  supa.fail = (url) => (url.includes('/rest/') ? { status: 502 } : null);
  after(() => { supa.fail = null; });
  e.DB.sqlite.prepare('UPDATE users SET auto_sync = 0 WHERE id = ?').run(b.id);
  for (let k = 1; k <= 3; k++) {
    e.DB.sqlite.prepare("UPDATE market SET attempt = json_set(attempt, '$.start', ?) WHERE json_valid(attempt)").run(isoAgo(60 * 60_000));
    e.DB.sqlite.prepare('UPDATE cron_state SET skip_until = NULL').run();
    assert.equal(await runCron(e, MARKET_CRON), '0 membre lu, 1 échec');
    assert.equal(userRow(a.id, e).sync_fails, k);
  }
  at = (await a.market()).attempt;
  assert.deepEqual([at.ok, /^La base du jeu ne répond pas/.test(at.why)], [false, true]);
  assert.equal((await call('GET', 'me', { key: a.u.key, e })).json.session.paused, true);
  e.DB.sqlite.prepare("UPDATE market SET attempt = json_set(attempt, '$.start', ?) WHERE json_valid(attempt)").run(isoAgo(60 * 60_000));
  n0 = supa.calls.length;
  assert.equal(await runCron(e, MARKET_CRON), '0 membre lu, 0 échec');
  assert.equal(supa.calls.length, n0, 'membre en pause : sauté');
  clearMarketGame();
  e.DB.close();
});

await test('GET /api/game/cards?q= : recherche ilike (q échappé), version française d\'un même titre, rareté inconnue écartée, 200 au plus', async () => {
  const e = makeEnv();
  clearMarketGame();
  const m = await marketMember('Gus', e);
  const c = (id, t, extra = {}) => ({ id, wikipedia_title: t, rarity: 'R', category: 'Animaux', image_url: `https://img.example/${id}.jpg`, hide_image: false, lang: 'fr', ...extra });
  supa.cards = [c(10, 'Vache', { lang: 'en' }), c(11, 'Vache'), c(12, 'La vache qui rit', { hide_image: true }), c(13, 'Taureau'), c(14, 'Vache (homonymie)', { rarity: 'X' }),
    c(15, '100% vache'), c(16, '1000 vaches'), c(17, 'Vache_folle')];
  const search = (q, key = m.u.key) => call('GET', `game/cards?q=${encodeURIComponent(q)}`, { key, e });
  const n0 = supa.rest().length;
  let r = await search('vache');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.cards.map((x) => [x.card_id, x.title]), [['15', '100% vache'], ['16', '1000 vaches'], ['12', 'La vache qui rit'], ['11', 'Vache'], ['17', 'Vache_folle']]);
  assert.deepEqual(r.json.cards.find((x) => x.card_id === '12'), { card_id: '12', title: 'La vache qui rit', rarity: 'R', category: 'Animaux', image: null });
  assert.equal(r.json.cards.find((x) => x.card_id === '11').image, 'https://img.example/11.jpg');
  assert.equal(r.json.more, false);
  const [one] = supa.rest().slice(n0);
  assert.equal(supa.rest().length - n0, 1);
  assert.match(one.url, /cards\?select=id,wikipedia_title,rarity,category,image_url,hide_image,lang&wikipedia_title=ilike\.\*vache\*&order=wikipedia_title,id&limit=201$/);
  // Jokers de LIKE pris à la lettre ; virgules et parenthèses encodées.
  r = await search('100%');
  assert.deepEqual(r.json.cards.map((x) => x.card_id), ['15']);
  r = await search('e_f');
  assert.deepEqual(r.json.cards.map((x) => x.card_id), ['17']);
  const last = supa.rest().at(-1).url;
  assert.ok(last.includes('ilike.*e%5C_f*'), last);
  await search('a,b(c)');
  assert.ok(supa.rest().at(-1).url.includes('ilike.*a%2Cb%28c%29*'), supa.rest().at(-1).url);
  // Plus de 200 : more.
  supa.cards = Array.from({ length: 250 }, (_, i) => c(1000 + i, `Vache ${String(i).padStart(3, '0')}`));
  r = await search('vache');
  assert.deepEqual([r.json.cards.length, r.json.more], [200, true]);
  for (const q of ['', '   ', 'x'.repeat(101)]) assert.equal((await search(q)).status, 400, JSON.stringify(q));
  assert.equal((await call('GET', 'game/cards?q=vache', { e })).status, 401);
  const v = await signup('Ned', e);
  r = await search('vache', v.key);
  assert.deepEqual([r.status, r.json.needs_link], [401, true]);
  clearMarketGame();
  e.DB.close();
});

await test('wikibidous : solde lu à chaque synchro (clic, lecture complète et vérification du cron), gardé si le jeu ne le rend pas', async () => {
  const e = makeEnv();
  supa.reset();
  const u = await signup('Wiki', e);
  await seedCards(u.key, synth(3, 970), { e });
  const uid = uidOf(u.key);
  const me = async () => (await call('GET', 'me', { key: u.key, e })).json;
  let m = await me();
  assert.equal(m.wikibidous.n, 0);
  assert.deepEqual(supa.rpcs().map((c) => [c.method, c.path, c.body]).at(-1), ['POST', '/rest/v1/rpc/get_my_profile', '{}']);
  // Le solde bouge sans la collection : la vérification du cron le relit, sans relire la collection.
  supa.player(uid).wikibidous = 1234;
  e.DB.sqlite.prepare("UPDATE users SET sync_state = json_set(sync_state, '$.full_at', ?) WHERE id = ?").run(new Date().toISOString(), u.user.id);
  const fetched = (await me()).fetched_at;
  await runCron(e, COLLECTION_CRON);
  m = await me();
  assert.deepEqual([m.wikibidous.n, m.fetched_at], [1234, fetched], 'solde relu, collection pas relue');
  // Le jeu ne rend pas de solde lisible : la lecture réussit, l'ancien solde reste.
  const fail = supa.fail;
  supa.fail = (url) => (url.includes('/rpc/get_my_profile') ? { status: 404, body: { message: 'not found' } } : null);
  supa.player(uid).cards.push(rowOf(synth(1, 990)[0], { uid }));
  const r = await refreshNow(u.key, e);
  supa.fail = fail;
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await me()).wikibidous.n, 1234);
});

await test('échange : POST /api/trades/create propose un échange dans le jeu (exemplaires lus, cookie refait, repli par le profil, refus)', async () => {
  const e = makeEnv();
  supa.reset();
  const ana = await signup('Ana', e);
  const ben = await signup('Ben', e);
  const anaCards = synth(4, 900);
  const benCards = synth(4, 950);
  await seedCards(ana.key, anaCards, { e });
  await seedCards(ben.key, benCards, { e });
  const anaUid = uidOf(ana.key);
  const benUid = uidOf(ben.key);
  supa.player(benUid).username = 'BenJeu';
  assert.equal((await call('PATCH', 'me', { key: ben.key, e, body: { pseudo: 'BenJeu' } })).status, 200);
  const pub = (u) => e.DB.sqlite.prepare('SELECT public_id FROM users WHERE id = ?').get(u.user.id).public_id;
  const create = (body, u = ana) => call('POST', 'trades/create', { key: u.key, e, body });
  const site = () => supa.calls.filter((c) => c.url.startsWith('https://www.wiki-masters.com/'));

  // Corps mal formés, ami inconnu.
  for (const bad of [{}, { member: 'x y', give: [anaCards[0].id] }, { member: pub(ben) }, { member: pub(ben), give: 'x' }, { member: pub(ben), give: ['a b'] },
    { member: pub(ben), give: Array.from({ length: 41 }, (_, i) => 'c' + i) }]) {
    assert.equal((await create(bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await create({ member: 'inconnu', give: [anaCards[0].id] })).status, 404);
  assert.equal(supa.trades.length, 0);

  // La base du jeu ne laisse pas lire les exemplaires de Ben : repli par sa page de profil (son pseudo), une recherche par titre.
  supa.calls = [];
  let r = await create({ member: pub(ben), give: [anaCards[0].id, anaCards[1].id], get: [benCards[2].id] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.trade, { id: 'echange-1', status: 'pending' });
  assert.deepEqual(r.json.given.map((c) => c.title), [anaCards[0].title, anaCards[1].title]);
  assert.deepEqual(r.json.received.map((c) => c.title), [benCards[2].title]);
  assert.equal(r.json.url, 'https://www.wiki-masters.com/trades');
  const t1 = supa.trades[0];
  assert.deepEqual([t1.initiator_id, t1.recipient_id, t1.initiator_wikibidous, t1.recipient_wikibidous], [anaUid, benUid, 0, 0]);
  assert.deepEqual(t1.items, [
    { user_card_id: `ex-${anaCards[0].id}`, card_id: anaCards[0].id, offered_by: anaUid },
    { user_card_id: `ex-${anaCards[1].id}`, card_id: anaCards[1].id, offered_by: anaUid },
    { user_card_id: `ex-${benCards[2].id}`, card_id: benCards[2].id, offered_by: benUid },
  ]);
  assert.deepEqual(site().map((c) => c.method + ' ' + c.path), ['GET /api/profile/BenJeu/collection', 'POST /api/trades']);
  assert.equal(new URL(site()[0].url).searchParams.get('q'), benCards[2].title);
  // Rien de la session dans la réponse ; le cookie refait ne part qu'au jeu.
  for (const tok of [supa.player(anaUid).access, supa.player(anaUid).refresh]) assert.ok(!JSON.stringify(r.json).includes(tok), 'jeton absent de la réponse');
  assert.ok(site()[1].headers.cookie.startsWith('sb-cyrxjeppjqsxxjayfrur-auth-token=base64-'));
  assert.equal(userRow(ana.user.id, e).sync_lock, null, 'bail rendu');

  // Exemplaires lisibles dans la base du jeu : pas de lecture du profil ; l'exemplaire donné est le moins précieux.
  supa.readOthers = true;
  supa.player(anaUid).cards.push(rowOf(anaCards[3], { uid: anaUid, eid: 'ex-brillant' }));
  supa.player(anaUid).cards.find((x) => x.id === `ex-${anaCards[3].id}`).starred = true;
  supa.player(anaUid).cards.find((x) => x.id === 'ex-brillant').is_shiny = true;
  supa.player(anaUid).cards.push(rowOf(anaCards[3], { uid: anaUid, eid: 'ex-simple' }));
  supa.calls = [];
  r = await create({ member: pub(ben), give: [anaCards[3].id], get: [] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(supa.trades[1].items, [{ user_card_id: 'ex-simple', card_id: anaCards[3].id, offered_by: anaUid }]);
  assert.deepEqual(site().map((c) => c.path), ['/api/trades']);
  r = await create({ member: pub(ben), get: [benCards[0].id] });
  assert.equal(r.status, 200);
  assert.deepEqual(site().map((c) => c.path), ['/api/trades', '/api/trades'], 'cartes de Ben lues dans la base');

  // Wikibidous d'un côté ou de l'autre (initiator_wikibidous = ceux d'Ana, recipient_wikibidous = ceux de Ben), seuls ou
  // avec des cartes ; mal formés : 400 sans rien envoyer ; plus que le solde : refus du jeu repris.
  supa.player(anaUid).wikibidous = 100;
  supa.player(benUid).wikibidous = 30;
  for (const bad of [{ give_wb: -1 }, { give_wb: 1.5 }, { get_wb: '10' }, { get_wb: 100_000_001 }, { give_wb: 0, get_wb: 0 }]) {
    const k = supa.trades.length;
    assert.equal((await create({ member: pub(ben), ...bad })).status, 400, JSON.stringify(bad));
    assert.equal(supa.trades.length, k);
  }
  r = await create({ member: pub(ben), give: [anaCards[0].id], get_wb: 25 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.given_wb, r.json.received_wb], [0, 25]);
  assert.deepEqual([supa.trades.at(-1).initiator_wikibidous, supa.trades.at(-1).recipient_wikibidous], [0, 25]);
  r = await create({ member: pub(ben), give_wb: 40 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([supa.trades.at(-1).items, supa.trades.at(-1).initiator_wikibidous, supa.trades.at(-1).recipient_wikibidous], [[], 40, 0]);
  r = await create({ member: pub(ben), get: [benCards[0].id], give_wb: 101 });
  assert.deepEqual([r.status, r.json.error], [409, "Le jeu a refusé l'échange : « Solde de wikibidous insuffisant »."]);

  // Une carte qui n'est plus dans le jeu : rien n'est envoyé.
  const n = supa.trades.length;
  supa.player(anaUid).cards = supa.player(anaUid).cards.filter((x) => x.card_id !== anaCards[2].id);
  r = await create({ member: pub(ben), give: [anaCards[2].id] });
  assert.deepEqual([r.status, r.json.error.includes(anaCards[2].title)], [409, true], JSON.stringify(r.json));
  supa.player(benUid).cards = supa.player(benUid).cards.filter((x) => x.card_id !== benCards[1].id);
  r = await create({ member: pub(ben), get: [benCards[1].id] });
  assert.deepEqual([r.status, r.json.error.includes(benCards[1].title)], [409, true], JSON.stringify(r.json));
  assert.equal(supa.trades.length, n);

  // Refus du jeu (message repris), panne (on ne sait pas : vérifier dans le jeu), session refusée.
  supa.tradeReply = () => ({ status: 400, body: { error: 'Carte déjà engagée dans un échange' } });
  r = await create({ member: pub(ben), give: [anaCards[0].id] });
  assert.deepEqual([r.status, r.json.error], [409, "Le jeu a refusé l'échange : « Carte déjà engagée dans un échange »."]);
  supa.tradeReply = () => ({ network: true });
  r = await create({ member: pub(ben), give: [anaCards[0].id] });
  assert.deepEqual([r.status, /regarde dans le jeu/.test(r.json.error)], [502, true]);
  supa.tradeReply = () => ({ status: 500, body: {} });
  assert.equal((await create({ member: pub(ben), give: [anaCards[0].id] })).status, 502);
  supa.tradeReply = () => ({ status: 401, body: { error: 'Non authentifié' } });
  r = await create({ member: pub(ben), give: [anaCards[0].id] });
  assert.equal(r.status, 502);
  assert.equal(userRow(ana.user.id, e).game_session_lost, null, 'session pas déclarée perdue');

  // Le jeu renouvelle la session pendant l'appel (Set-Cookie) : la nouvelle est gardée.
  const pa = supa.player(anaUid);
  supa.tradeReply = () => {
    supa.mint(pa);
    const v = /sb-cyrxjeppjqsxxjayfrur-auth-token=[^;]+/.exec(supa.sessionCookie({ uid: anaUid }))[0];
    return { status: 201, body: { trade: { id: 'echange-renouvele', status: 'pending' } }, setCookie: v + '; Path=/; HttpOnly; Secure; SameSite=Lax' };
  };
  r = await create({ member: pub(ben), give: [anaCards[0].id] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  supa.tradeReply = null;
  assert.equal((await sessionOf(e, userRow(ana.user.id, e))).auth.refresh_token, pa.refresh, 'session renouvelée gardée');
  assert.equal((await refreshNow(ana.key, e)).status, 200, 'la session gardée sert encore');

  // Session presque expirée : renouvelée avant l'appel au jeu (le jeu n'a jamais à le faire).
  pa.expires_at = Math.floor(Date.now() / 1000) + 200;
  const s0 = await sessionOf(e, userRow(ana.user.id, e));
  e.DB.sqlite.prepare('UPDATE users SET game_session_enc = ? WHERE id = ?').run(await sealSession(e, ana.user.id, { ...s0.auth, expires_at: pa.expires_at }), ana.user.id);
  supa.calls = [];
  assert.equal((await create({ member: pub(ben), give: [anaCards[0].id] })).status, 200);
  assert.equal(supa.tokens().length, 1, 'un renouvellement avant l\'appel');

  // Ben sans compte relié : son pseudo suffit (profil du jeu) ; ni l'un ni l'autre : impossible.
  e.DB.sqlite.prepare('UPDATE users SET game_uid = NULL WHERE id = ?').run(ben.user.id);
  r = await create({ member: pub(ben), give: [anaCards[0].id] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(supa.trades[supa.trades.length - 1].recipient_id, benUid);
  e.DB.sqlite.prepare('UPDATE users SET game_pseudo = NULL WHERE id = ?').run(ben.user.id);
  r = await create({ member: pub(ben), give: [anaCards[0].id] });
  assert.deepEqual([r.status, /ni relié son compte du jeu ni donné son pseudo/.test(r.json.error)], [409, true]);

  // Bail pris par une lecture en cours ; compte du jeu pas relié ; partage coupé.
  e.DB.sqlite.prepare('UPDATE users SET game_uid = ? WHERE id = ?').run(benUid, ben.user.id);
  // Bail pris par une lecture automatique (elle peut le tenir plusieurs minutes) : session fraîche → l'échange part quand même,
  // sans renouvellement et sans toucher au bail ; session à renouveler → 409, rien d'envoyé.
  const held = new Date(Date.now() + 60_000).toISOString();
  e.DB.sqlite.prepare('UPDATE users SET sync_lock = ? WHERE id = ?').run(held, ana.user.id);
  supa.calls = [];
  const before = supa.trades.length;
  r = await create({ member: pub(ben), give: [anaCards[0].id] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([supa.trades.length, supa.tokens().length, userRow(ana.user.id, e).sync_lock], [before + 1, 0, held]);
  const s1 = await sessionOf(e, userRow(ana.user.id, e));
  pa.expires_at = Math.floor(Date.now() / 1000) + 200;
  e.DB.sqlite.prepare('UPDATE users SET game_session_enc = ? WHERE id = ?').run(await sealSession(e, ana.user.id, { ...s1.auth, expires_at: pa.expires_at }), ana.user.id);
  r = await create({ member: pub(ben), give: [anaCards[0].id] });
  assert.deepEqual([r.status, /réessaie dans quelques minutes/.test(r.json.error), supa.trades.length, supa.tokens().length], [409, true, before + 1, 0]);
  e.DB.sqlite.prepare('UPDATE users SET sync_lock = NULL WHERE id = ?').run(ana.user.id);
  const cleo = await signup('Cléo', e);
  r = await create({ member: pub(ben), give: [anaCards[0].id] }, cleo);
  assert.deepEqual([r.status, r.json.needs_link], [401, true]);
  await call('PATCH', 'me', { key: ana.key, e, body: { shared: false } });
  assert.equal((await create({ member: pub(ben), give: [anaCards[0].id] })).status, 403);
  supa.reset();
  e.DB.close();
});

await test('amis du jeu : GET /api/friends (statut par membre, liste gardée, relue après une minute ou avec fresh=1), POST /api/friends/request', async () => {
  const e = makeEnv();
  supa.reset();
  const ana = await signup('Ana', e);
  const ben = await signup('Ben', e);
  const cleo = await signup('Cleo', e);
  const dan = await signup('Dan', e);
  const anaUid = await setGameCards(ana.key, mini(2), { e });
  const benUid = await setGameCards(ben.key, mini(2, 10), { e });
  const cleoUid = 'uid-cleo-du-jeu';
  supa.player(cleoUid).username = 'CleoJeu'; // Cléo n'a pas relié son compte, mais a donné son pseudo
  assert.equal((await call('PATCH', 'me', { key: cleo.key, e, body: { pseudo: 'cleojeu' } })).status, 200);
  const pub = (u) => e.DB.sqlite.prepare('SELECT public_id FROM users WHERE id = ?').get(u.user.id).public_id;
  const friends = (u = ana, q = '') => call('GET', 'friends' + q, { key: u.key, e });
  const ask = (u, body) => call('POST', 'friends/request', { key: u.key, e, body });
  const site = () => supa.calls.filter((c) => c.url.startsWith('https://www.wiki-masters.com/')).map((c) => c.method + ' ' + c.path);

  supa.befriend(benUid, anaUid);
  supa.calls = [];
  let r = await friends();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.members, { [pub(ben)]: 'friends', [pub(cleo)]: 'none', [pub(dan)]: 'unknown' });
  assert.deepEqual([r.json.linked, r.json.can_request, r.json.auto_friend, !!r.json.at], [true, true, false, true]);
  assert.deepEqual(site(), ['GET /api/friends']);
  assert.ok(supa.calls[0].headers.cookie.startsWith('sb-cyrxjeppjqsxxjayfrur-auth-token=base64-'), 'cookie de session refait');
  // Gardée une minute : pas de nouvel appel ; fresh=1 la relit. Demande reçue de Cléo (par son pseudo, sans casse).
  supa.befriend(cleoUid, anaUid, 'pending');
  r = await friends();
  assert.equal(r.json.members[pub(cleo)], 'none');
  assert.equal(site().length, 1);
  r = await friends(ana, '?fresh=1');
  assert.equal(r.json.members[pub(cleo)], 'received');
  assert.equal(site().length, 2);
  e.DB.sqlite.prepare("UPDATE users SET game_friends = json_set(game_friends, '$.at', '2020-01-01T00:00:00.000Z') WHERE id = ?").run(ana.user.id);
  await friends();
  assert.equal(site().length, 3, 'relue après une minute');
  // Ben voit Ana en ami (la même amitié, vue de l'autre côté) ; Dan, sans compte relié : tout inconnu, aucun appel.
  r = await friends(ben);
  assert.equal(r.json.members[pub(ana)], 'friends');
  supa.calls = [];
  r = await friends(dan);
  assert.deepEqual([r.json.linked, Object.values(r.json.members).every((x) => x === 'unknown'), site().length], [false, true, 0]);
  // Le jeu limite : l'ancienne liste reste, avec l'erreur.
  supa.siteLimit = 'friends';
  r = await friends(ana, '?fresh=1');
  assert.deepEqual([r.status, r.json.members[pub(ben)], /limite/.test(r.json.error)], [200, 'friends', true]);
  supa.siteLimit = null;
  e.DB.sqlite.prepare('DELETE FROM game_reads').run();

  // Demande d'ami : corps mal formé, membre inconnu, sans compte relié.
  assert.equal((await ask(ana, {})).status, 400);
  assert.equal((await ask(ana, { member: 'inconnu' })).status, 404);
  assert.equal((await ask(dan, { member: pub(ana) })).status, 401);
  // Déjà amis, ou demande reçue : rien ne part, même sans route d'envoi (interrupteur FRIEND_ROUTE.known coupé).
  FRIEND_ROUTE.known = false;
  cleanups.push(() => { FRIEND_ROUTE.known = true; });
  supa.calls = [];
  assert.deepEqual((await ask(ana, { member: pub(ben) })).json, { status: 'friends' });
  assert.deepEqual((await ask(ana, { member: pub(cleo) })).json, { status: 'received' });
  assert.deepEqual(site(), ['GET /api/friends', 'GET /api/friends']);
  // Interrupteur coupé : 503, rien n'est envoyé.
  const dave = await signup('Dave', e);
  const daveUid = await setGameCards(dave.key, mini(1, 30), { e });
  r = await ask(ana, { member: pub(dave) });
  assert.deepEqual([r.status, /dans le jeu/.test(r.json.error)], [503, true]);
  assert.equal(supa.friendships.length, 2);

  FRIEND_ROUTE.known = true;
  supa.calls = [];
  r = await ask(ana, { member: pub(dave) });
  assert.deepEqual([r.status, r.json], [200, { status: 'sent' }], JSON.stringify(r.json));
  assert.deepEqual(supa.friendships.at(-1), { id: 'amitie-3', requester_id: anaUid, addressee_id: daveUid, status: 'pending' });
  assert.deepEqual(site(), ['GET /api/friends', 'POST /api/friends', 'GET /api/friends']);
  assert.deepEqual(JSON.parse(supa.calls[1].body), { addressee_id: daveUid });
  assert.deepEqual(e.DB.sqlite.prepare('SELECT target_uid, via, result FROM friend_requests WHERE user_id = ?').all(ana.user.id).map((x) => ({ ...x })),
    [{ target_uid: daveUid, via: 'clic', result: 'sent' }]);
  assert.equal((await friends()).json.members[pub(dave)], 'sent');
  assert.deepEqual((await ask(ana, { member: pub(dave) })).json, { status: 'sent' }, 'pas deux fois');
  assert.equal(supa.friendships.length, 3);
  // Refus du jeu (message repris), panne, limite.
  supa.friendReply = () => ({ status: 400, body: { error: 'Ce joueur refuse les demandes' } });
  r = await ask(dave, { member: pub(ben) });
  assert.deepEqual([r.status, r.json.error], [409, "Le jeu a refusé la demande d'ami : « Ce joueur refuse les demandes »."]);
  supa.friendReply = () => ({ network: true });
  r = await ask(dave, { member: pub(ben) });
  assert.deepEqual([r.status, /regarde dans le jeu/.test(r.json.error)], [502, true]);
  supa.friendReply = () => ({ status: 403, body: { code: 'automation_limit' } });
  r = await ask(dave, { member: pub(ben) });
  assert.deepEqual([r.status, r.json.limited], [429, true]);
  supa.friendReply = null;
  // Plusieurs demandes d'un coup (POST /api/friends/request-all) : une lecture de la liste, une demande par membre ni ami
  // ni en attente ; la liste de GET /api/friends donne prénoms et pseudos.
  const eve = await signup('Eve', e);
  const eveUid = await setGameCards(eve.key, mini(1, 40), { e });
  const fay = await signup('Fay', e);
  const fayUid = await setGameCards(fay.key, mini(1, 41), { e });
  const bulk = (u, members) => call('POST', 'friends/request-all', { key: u.key, e, body: { members } });
  for (const bad of [{}, [], ['x y'], Array.from({ length: 21 }, (_, i) => 'm' + i)]) {
    assert.equal((await call('POST', 'friends/request-all', { key: ana.key, e, body: Array.isArray(bad) ? { members: bad } : bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await bulk(dan, [pub(eve)])).status, 401);
  r = await friends(ana, '?fresh=1');
  assert.deepEqual(r.json.list.map((m) => [m.name, m.st]).sort((x, y) => x[0].localeCompare(y[0])), [['Ben', 'friends'], ['Cleo', 'received'], ['Dan', 'unknown'], ['Dave', 'sent'], ['Eve', 'none'], ['Fay', 'none']]);
  assert.equal(r.json.list.find((m) => m.name === 'Cleo').pseudo, 'cleojeu');
  supa.calls = [];
  r = await bulk(ana, [pub(eve), pub(ben), pub(dan), pub(fay), 'inconnu']);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.results.map((x) => [x.id, x.status || 'error']), [[pub(eve), 'sent'], [pub(ben), 'friends'], [pub(dan), 'error'], [pub(fay), 'sent'], ['inconnu', 'error']]);
  assert.deepEqual(site(), ['GET /api/friends', 'POST /api/friends', 'POST /api/friends', 'GET /api/friends']);
  assert.deepEqual(supa.friendships.slice(-2).map((f) => [f.requester_id, f.addressee_id]), [[anaUid, eveUid], [anaUid, fayUid]]);
  r = await bulk(ana, [pub(eve)]);
  assert.deepEqual(r.json.results, [{ id: pub(eve), status: 'sent' }], 'pas deux fois');
  // Le jeu limite : arrêt, les suivants pas envoyés.
  supa.friendReply = () => ({ status: 403, body: { code: 'automation_limit' } });
  r = await bulk(eve, [pub(ben), pub(fay)]);
  assert.deepEqual([r.status, r.json.limited, r.json.results.every((x) => x.error)], [200, true, true]);
  supa.friendReply = null;
  e.DB.sqlite.prepare('DELETE FROM game_reads').run();
  // Le réglage « Demandes d'ami automatiques » : PATCH /api/me, rendu par GET /api/me.
  r = await call('PATCH', 'me', { key: ana.key, e, body: { auto_friend: 'oui' } });
  assert.equal(r.status, 400);
  r = await call('PATCH', 'me', { key: ana.key, e, body: { auto_friend: true } });
  assert.deepEqual([r.status, r.json.auto_friend], [200, true]);
  assert.equal((await call('GET', 'me', { key: ana.key, e })).json.auto_friend, true);
  e.DB.close();
});

await test("amis du jeu : demandes automatiques pendant le cron (case cochée, une fois par membre visé, aucun appel sans nouveau membre)", async () => {
  const e = makeEnv();
  supa.reset();
  const a = await cronMember('Auto1', e);
  const b = await cronMember('Auto2', e, mini(3, 20));
  const site = () => supa.calls.filter((c) => c.url.startsWith('https://www.wiki-masters.com/')).map((c) => c.method + ' ' + c.path);
  // Case coupée : rien.
  supa.calls = [];
  assert.equal(await runCron(e, COLLECTION_CRON), '2 membres vérifiés, 0 relu, 0 échec');
  assert.deepEqual(site(), []);
  // Case cochée chez Auto1 : une demande à Auto2.
  assert.equal((await call('PATCH', 'me', { key: a.u.key, e, body: { auto_friend: true } })).status, 200);
  assert.equal(await runCron(e, COLLECTION_CRON), "2 membres vérifiés, 0 relu, 0 échec, 1 demande d'ami envoyée");
  assert.deepEqual(site(), ['GET /api/friends', 'POST /api/friends']);
  assert.deepEqual(supa.friendships.map((f) => [f.requester_id, f.addressee_id, f.status]), [[a.uid, b.uid, 'pending']]);
  assert.equal(userRow(a.id, e).sync_lock, null, 'bail rendu');
  // Passe suivante : personne de nouveau, aucun appel au jeu.
  supa.calls = [];
  assert.equal(await runCron(e, COLLECTION_CRON), '2 membres vérifiés, 0 relu, 0 échec');
  assert.deepEqual(site(), []);
  // Un nouveau membre relie son compte : demandé à la passe suivante ; un déjà ami est seulement noté.
  const c = await cronMember('Auto3', e, mini(2, 40));
  const d = await cronMember('Auto4', e, mini(2, 50));
  supa.befriend(d.uid, a.uid);
  supa.calls = [];
  assert.equal(await runCron(e, COLLECTION_CRON), "4 membres vérifiés, 0 relu, 0 échec, 1 demande d'ami envoyée");
  assert.deepEqual(site(), ['GET /api/friends', 'POST /api/friends']);
  assert.deepEqual(e.DB.sqlite.prepare('SELECT target_uid, via, result FROM friend_requests WHERE user_id = ? ORDER BY target_uid').all(a.id).map((x) => [x.target_uid, x.via, x.result]),
    [[b.uid, c.uid, d.uid].sort().map((u) => [u, 'auto', u === d.uid ? 'friends' : 'sent'])].flat());
  // Un refus est noté en échec, retenté après un jour ; une limite du jeu arrête la passe et saute la suivante.
  const f = await cronMember('Auto5', e, mini(2, 60));
  supa.friendReply = () => ({ status: 400, body: { error: 'non' } });
  assert.equal(await runCron(e, COLLECTION_CRON), '5 membres vérifiés, 0 relu, 0 échec');
  assert.equal(e.DB.sqlite.prepare('SELECT result FROM friend_requests WHERE user_id = ? AND target_uid = ?').get(a.id, f.uid).result, 'error');
  supa.calls = [];
  assert.equal(await runCron(e, COLLECTION_CRON), '5 membres vérifiés, 0 relu, 0 échec');
  assert.deepEqual(site(), [], 'pas retentée avant un jour');
  e.DB.sqlite.prepare("UPDATE friend_requests SET at = '2020-01-01T00:00:00.000Z' WHERE result = 'error'").run();
  supa.friendReply = () => ({ status: 403, body: { code: 'automation_limit' } });
  assert.match(await runCron(e, COLLECTION_CRON), /^limite du jeu/);
  assert.equal(await runCron(e, COLLECTION_CRON), null, 'passe suivante sautée');
  supa.friendReply = null;
  // Effacer son classeur efface ses demandes notées.
  assert.equal((await call('DELETE', 'me', { key: a.u.key, e })).status, 200);
  assert.equal(e.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM friend_requests WHERE user_id = ?').get(a.id).n, 0);
  e.DB.close();
});

// --- Auto-tag dans le jeu ---------------------------------------------------------------------------------------
const PLANET_TAG = { id: 'tag-planetes', name: 'Planètes', color: '#34d399' };
const hasGameTag = row => (row.tags || []).some(t => t.tag.id === PLANET_TAG.id);
const albumOf = async (m, e) => (await call('GET', 'targets', { key: m.u.key, e })).json.targets.find(t => t.id === 'planetes');
async function tagFixture(name) {
  const e = makeEnv(); supa.reset();
  const list = mini(3).map((c, i) => ({ ...c, title: ['Terre', 'Mars', 'Vénus'][i] }));
  const m = await cronMember(name, e, list);
  const p = supa.player(m.uid);
  p.cards[0].tags = [{ tag: { ...PLANET_TAG } }];
  p.cards.push({ ...p.cards[1], id: 'deuxieme-mars', tags: [] });
  await call('POST', 'targets/save', { key: m.u.key, e, body: { id: 'planetes', name: 'Planètes', items: [{ title: 'Mars' }, { title: 'Neptune' }] } });
  const link = await call('POST', 'targets/autotag', { key: m.u.key, e, body: { id: 'planetes', tag: PLANET_TAG.name, enabled: true } });
  assert.equal(link.status, 200, JSON.stringify(link.json));
  const full = async () => {
    e.DB.sqlite.prepare('UPDATE users SET sync_click_at = NULL WHERE id = ?').run(m.id);
    return call('POST', 'refresh', { key: m.u.key, e, body: {} });
  };
  return { e, m, p, full };
}

await test('auto-favoris : option indépendante, exemplaire unique, reprise et conservation', async () => {
  const { e, m, p, full } = await tagFixture('AutoFavorite');
  const opt = enabled => call('POST', 'targets/favorite', { key: m.u.key, e, body: { id: 'planetes', enabled } });
  assert.equal((await albumOf(m, e)).auto_favorite, false);
  assert.equal((await opt('oui')).status, 400);
  assert.equal((await call('POST', 'targets/favorite', { key: m.u.key, e, body: { id: 'absent', enabled: true } })).status, 404);
  assert.equal((await call('POST', 'targets/favorite', { key: bob.key, e, body: { id: 'planetes', enabled: true } })).status, 401);
  await call('POST', 'targets/autotag', { key: m.u.key, e, body: { id: 'planetes', tag: '', enabled: false } });
  assert.equal((await opt(true)).json.target.auto_favorite, true);
  let r = await full();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.auto_favorite.error, undefined);
  assert.equal(r.json.auto_favorite.added, 1);
  assert.equal(p.cards.filter(c => c.starred).length, 1);
  assert.equal((await albumOf(m, e)).auto_favorite_state.added, 1);
  assert.match((await m.log())[0].message, /Auto-favoris réussi : 1/);
  r = await full();
  assert.equal(r.json.auto_favorite.added, 0, 'idempotent');
  p.cards.find(c => c.starred).starred = false;
  supa.favoriteReply = () => ({ status: 503, body: { message: 'refus-favori' } });
  r = await full();
  assert.ok(r.json.auto_favorite.error);
  assert.equal(p.cards.filter(c => c.starred).length, 0);
  assert.equal((await m.log())[0].result, 'warn');
  supa.favoriteReply = null;
  r = await full();
  assert.equal(r.json.auto_favorite.added, 1, 'écriture reprise');
  p.cards = p.cards.filter(c => !c.starred);
  r = await full();
  assert.equal(r.json.auto_favorite.added, 1, 'autre exemplaire protégé si le favori disparaît');
  let t = await albumOf(m, e);
  await call('POST', 'targets/save', { key: m.u.key, e, body: { id: t.id, name: t.name, items: [] } });
  assert.equal((await albumOf(m, e)).auto_favorite, true, 'enregistrement préserve le réglage');
  await full();
  await opt(false);
  await full();
  assert.equal(p.cards.filter(c => c.starred).length, 1, 'retrait et désactivation conservent les favoris');
  e.DB.close();
});

await test('auto-favoris : lots, limite par passe, refus et protection contre les changements concurrents', async () => {
  const { syncAutoFavorites, autoFavoriteLinks } = await import('../site/functions/_lib/autofavorite.js');
  const { e, m, p } = await tagFixture('AutoFavoriteLots');
  const many = mini(205);
  p.cards = many.map(c => rowOf(c, { uid: m.uid }));
  const save = items => call('POST', 'targets/save', { key: m.u.key, e, body: { id: 'planetes', name: 'Planètes', items } });
  await save(many.map(c => ({ title: c.title })));
  await call('POST', 'targets/favorite', { key: m.u.key, e, body: { id: 'planetes', enabled: true } });
  const session = await sessionOf(e, userRow(m.id, e));
  const pass = async () => syncAutoFavorites(e, { id: m.id }, session, JSON.parse(JSON.stringify(p.cards)), await autoFavoriteLinks(e.DB, m.id), { gap: 0, maxWrites: 1 });
  let r = await pass();
  assert.deepEqual([r.added, r.left, r.error], [100, 105, undefined]);
  r = await pass(); assert.deepEqual([r.added, r.left], [100, 5]);
  r = await pass(); assert.deepEqual([r.added, r.left], [5, 0]);
  assert.equal(p.cards.filter(c => c.starred).length, 205);
  p.cards.forEach(c => { c.starred = false; });
  const old = await autoFavoriteLinks(e.DB, m.id);
  await save([]);
  r = await syncAutoFavorites(e, { id: m.id }, session, p.cards, old, { gap: 0 });
  assert.match(r.error, /modifiées/);
  assert.equal(p.cards.filter(c => c.starred).length, 0);
  e.DB.close();
});

await test('auto-favoris : auto-tag partagé, lecture vérifiée et cron sans nouvel achat', async () => {
  const { e, m, p, full } = await tagFixture('AutoFavoriteCron');
  const other = await signup('AutreFavori', e);
  assert.equal((await call('POST', 'targets/favorite', { key: other.key, e, body: { id: 'planetes', enabled: true } })).status, 404);
  await call('POST', 'targets/favorite', { key: m.u.key, e, body: { id: 'planetes', enabled: true } });
  supa.noCount = true;
  let r = await full();
  assert.match(r.json.auto_favorite.error, /non vérifiée/);
  assert.equal(p.cards.filter(c => c.starred).length, 0);
  supa.noCount = false;
  r = await full();
  assert.equal(r.json.auto_favorite.added, 2, 'Mars et Terre importée par le tag');
  const mars = p.cards.filter(c => c.card_id === m.cards[1].id);
  assert.equal(mars.filter(c => c.starred).length, 1);
  assert.ok(hasGameTag(mars.find(c => c.starred)), 'favori sur le même exemplaire que le tag');
  const cards = (await call('GET', 'cards', { key: m.u.key, e })).json.cards;
  assert.ok(cards.find(c => c.title === 'Mars').starred, 'import reflète les favoris immédiatement');
  await call('POST', 'targets/autotag', { key: m.u.key, e, body: { id: 'planetes', tag: '', enabled: false } });
  p.cards.forEach(c => { c.starred = false; });
  assert.match(await runCron(e, COLLECTION_CRON), /1 relu/);
  assert.equal(p.cards.filter(c => c.starred).length, 2, 'favoris seuls : lecture forcée sans nouvel achat');
  e.DB.close();
});

await test('auto-tag : union initiale, un seul exemplaire, ajout/retrait dans les deux sens et arrêt', async () => {
  const { e, m, p, full } = await tagFixture('AutoTag1');
  let r = await full();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.auto_tag.error, undefined);
  assert.deepEqual((await albumOf(m, e)).items.map(i => i.title), ['Mars', 'Neptune', 'Terre']);
  let log = (await m.log())[0];
  assert.equal(log.result, 'ok');
  assert.match(log.message, /Auto-tag réussi : 1 tag ajouté, 0 retiré/);
  assert.deepEqual([log.data.auto_tag.result, log.data.auto_tag.added, log.data.auto_tag.removed], ['ok', 1, 0]);
  assert.equal(p.cards.filter(c => c.card_id === m.cards[1].id && hasGameTag(c)).length, 1);
  const imported = (await call('GET', 'cards', { key: m.u.key, e })).json.cards;
  assert.ok(imported.find(c => c.title === 'Mars').gtags.includes('Planètes'), 'écriture du tag visible après la même synchro');
  // Enlever Terre de l'album : retirer son tag, sans enlever les cartes manquantes (Neptune).
  let t = await albumOf(m, e);
  await call('POST', 'targets/save', { key: m.u.key, e, body: { id: t.id, name: t.name, items: t.items.filter(i => i.title !== 'Terre') } });
  await full(); assert.equal(hasGameTag(p.cards[0]), false);
  log = (await m.log())[0];
  assert.match(log.message, /Auto-tag réussi : 0 tag ajouté, 1 retiré/);
  await full(); assert.ok(!(await albumOf(m, e)).items.some(i => i.title === 'Terre'), 'pas de réajout en boucle');
  // Tag ajouté directement dans le jeu : ajouter Vénus à l'album.
  p.cards.find(c => c.card_id === m.cards[2].id).tags = [{ tag: { ...PLANET_TAG } }];
  await full(); assert.ok((await albumOf(m, e)).items.some(i => i.title === 'Vénus'));
  // Tag retiré directement : retirer Mars de l'album.
  for (const c of p.cards.filter(c => c.card_id === m.cards[1].id)) c.tags = [];
  await full(); assert.ok(!(await albumOf(m, e)).items.some(i => i.title === 'Mars'));
  await full(); assert.equal(p.cards.filter(c => c.card_id === m.cards[1].id && hasGameTag(c)).length, 0);
  // Carte nouvellement obtenue appartenant à l'album : tag automatiquement posé.
  const neptune = { ...mini(1, 100)[0], title: 'Neptune' };
  p.cards.push(rowOf(neptune, { uid: m.uid }));
  await full(); assert.ok(hasGameTag(p.cards.find(c => c.card_id === neptune.id)));
  await call('POST', 'targets/autotag', { key: m.u.key, e, body: { id: 'planetes', tag: PLANET_TAG.name, enabled: false } });
  p.cards[0].tags = [{ tag: { ...PLANET_TAG } }];
  r = await full(); assert.equal(r.json.auto_tag, undefined);
  assert.ok(!(await albumOf(m, e)).items.some(i => i.title === 'Terre'), 'arrêt : aucune propagation');
  assert.equal(userRow(m.id, e).sync_lock, null);
  r = await call('POST', 'targets/autotag', { key: m.u.key, e, body: { id: 'planetes', tag: '', enabled: true } });
  assert.equal(r.status, 400, 'aucune activation sans tag, même en appel direct');
  r = await call('POST', 'targets/autotag', { key: m.u.key, e, body: { id: 'planetes', tag: '', enabled: false } });
  assert.equal(r.status, 200);
  assert.equal(r.json.target.auto_tag, null, 'le choix peut être vidé après désactivation');
  e.DB.close();
});

await test('auto-tag : cron détecte un changement de tag sans nouvelle carte ; exemplaire vendu', async () => {
  const { e, m, p, full } = await tagFixture('AutoTagCron');
  await full();
  p.cards[2].tags = [{ tag: { ...PLANET_TAG } }];
  assert.match(await runCron(e, COLLECTION_CRON), /1 relu/);
  assert.ok((await albumOf(m, e)).items.some(i => i.title === 'Vénus'));
  const taggedMars = p.cards.find(c => c.card_id === m.cards[1].id && hasGameTag(c));
  p.cards.splice(p.cards.indexOf(taggedMars), 1);
  const r = await full();
  assert.equal(r.json.auto_tag.error, undefined);
  assert.ok((await albumOf(m, e)).items.some(i => i.title === 'Mars'), 'vendre un exemplaire ne supprime pas la collection');
  assert.ok(hasGameTag(p.cards.find(c => c.card_id === m.cards[1].id)), 'tag transféré à l’exemplaire restant');
  e.DB.close();
});

await test('auto-tag : vente du dernier exemplaire → carte conservée mais non obtenue, même si le compte devient vide', async () => {
  const { e, m, p, full } = await tagFixture('AutoTagVente');
  await full();
  const album = await albumOf(m, e);
  p.cards = p.cards.filter(c => c.card_id !== m.cards[1].id);
  let r = await full();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.auto_tag.cards_removed, 0);
  assert.deepEqual((await albumOf(m, e)).items, album.items, 'vente : les cases et leurs métadonnées restent');
  let owned = (await call('GET', 'cards', { key: m.u.key, e })).json.cards;
  assert.ok(!owned.some(c => c.id === m.cards[1].id), 'Mars est non obtenue dans l’album');
  // Vente de toutes les autres cartes : deux lectures confirment zéro, sans effacer les albums.
  p.cards = [];
  r = await full();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.count, 0);
  assert.equal(r.json.complete, true);
  assert.deepEqual((await albumOf(m, e)).items, album.items);
  owned = (await call('GET', 'cards', { key: m.u.key, e })).json.cards;
  assert.deepEqual(owned, [], 'toutes les cases sont non obtenues');
  // Récupérer Mars remplit sa case et rétablit le tag, sans ajouter un second élément.
  p.cards = [rowOf(m.cards[1], { uid: m.uid, eid: 'nouveau-mars' })];
  r = await full();
  assert.equal(r.json.auto_tag.error, undefined);
  assert.ok(hasGameTag(p.cards[0]));
  assert.deepEqual((await albumOf(m, e)).items, album.items);
  e.DB.close();
});

await test('auto-tag : permissions, tag unique, métadonnées conservées, lecture incomplète et refus du jeu', async () => {
  const { e, m, p, full } = await tagFixture('AutoTagErreurs');
  const other = await signup('AutoTagAutre', e);
  assert.equal((await call('POST', 'targets/autotag', { key: other.key, e, body: { id: 'planetes', tag: 'Planètes', enabled: true } })).status, 404);
  assert.equal((await call('POST', 'targets/autotag', { key: m.u.key, e, body: { id: 'planetes', tag: 'Planètes', enabled: 'oui' } })).status, 400);
  await call('POST', 'targets/save', { key: m.u.key, e, body: { id: 'autre', name: 'Autre', items: [] } });
  assert.equal((await call('POST', 'targets/autotag', { key: m.u.key, e, body: { id: 'autre', tag: 'PLANÈTES', enabled: true } })).status, 409);
  let t = await albumOf(m, e);
  await call('POST', 'targets/save', { key: m.u.key, e, body: { id: t.id, name: 'Renommée', items: t.items } });
  assert.equal((await albumOf(m, e)).auto_tag.enabled, true);
  p.phantom = 1;
  let r = await full(); assert.ok(r.json.auto_tag.error);
  assert.equal(supa.calls.filter(c => c.method !== 'GET' && c.path.endsWith('/user_card_tags')).length, 0);
  p.phantom = 0;
  supa.tagReply = () => ({ status: 403, body: { message: 'refus-test' } });
  r = await full(); assert.match(r.json.auto_tag.error, /refus-test/);
  const failedLog = (await m.log())[0];
  assert.equal(failedLog.result, 'warn', 'lecture réussie, auto-tag en échec');
  assert.match(failedLog.message, /Auto-tag en échec : 0 tag ajouté, 0 retiré/);
  assert.match(failedLog.data.auto_tag.error, /refus-test/);
  assert.equal((await albumOf(m, e)).auto_tag_state.error, r.json.auto_tag.error);
  assert.equal(userRow(m.id, e).sync_lock, null);
  supa.tagReply = null;
  r = await full(); assert.equal(r.json.auto_tag.error, undefined);
  assert.equal(p.cards.filter(c => c.card_id === m.cards[1].id && hasGameTag(c)).length, 1);
  const n = supa.calls.length;
  await full();
  assert.equal(supa.calls.slice(n).filter(c => c.method !== 'GET' && c.path.endsWith('/user_card_tags')).length, 0, 'passe suivante idempotente');
  e.DB.close();
});

await test('auto-tag : journal partiel avec compteurs puis succès à la reprise', async () => {
  const { e, m, p, full } = await tagFixture('AutoTagJournal');
  const more = mini(35, 200);
  p.cards.push(...more.map(c => rowOf(c, { uid: m.uid })));
  await call('POST', 'targets/save', { key: m.u.key, e, body: { id: 'planetes', name: 'Planètes', items: more.map(c => ({ title: c.title })) } });
  let r = await full();
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.auto_tag.added, r.json.auto_tag.left], [30, 5]);
  let log = (await m.log())[0];
  assert.equal(log.result, 'warn');
  assert.match(log.message, /Auto-tag partiel : 30 tags ajoutés, 0 retiré ; 5 en attente/);
  assert.equal(log.data.auto_tag.result, 'partial');
  r = await full();
  assert.deepEqual([r.json.auto_tag.added, r.json.auto_tag.left], [5, 0]);
  log = (await m.log())[0];
  assert.equal(log.result, 'ok');
  assert.match(log.message, /Auto-tag réussi : 5 tags ajoutés, 0 retiré/);
  e.DB.close();
});

await test('auto-tag : reprise par lots et modification concurrente pendant un POST', async () => {
  const { e, m, p } = await tagFixture('AutoTagReprise');
  const user = userRow(m.id, e);
  const session = await sessionOf(e, user);
  const readRows = () => JSON.parse(JSON.stringify(p.cards));
  let r = await syncAutoTags(e, user, session, readRows(), await autoTagLinks(e.DB, m.id), { maxWrites: 0, gap: 0 });
  assert.equal(r.left, 1); assert.equal(r.added, 0);
  let changed = false;
  supa.tagReply = method => {
    if (method === 'POST' && !changed) {
      changed = true;
      e.DB.sqlite.prepare("UPDATE targets SET items = '[{\"title\":\"Neptune\"}]', updated_at = '2099-01-01' WHERE user_id = ? AND id = 'planetes'").run(m.id);
    }
    return null;
  };
  await syncAutoTags(e, user, session, readRows(), await autoTagLinks(e.DB, m.id), { gap: 0 });
  supa.tagReply = null;
  r = await syncAutoTags(e, user, session, readRows(), await autoTagLinks(e.DB, m.id), { gap: 0 });
  assert.equal(r.error, undefined);
  assert.deepEqual((await albumOf(m, e)).items.map(i => i.title), ['Neptune']);
  assert.equal(p.cards.filter(hasGameTag).length, 0, 'le POST concurrent ne ressuscite pas les cartes retirées');
  e.DB.close();
});

// --- Liste de souhaits du jeu (wishlist_items) ---------------------------------------------------------------------

// Cartes du jeu (table cards) des titres des tests : `Manque A` → g-a…, et les cartes possédées sous leur titre.
const gameCard = (id, title, lang = 'fr') => ({ id, wikipedia_title: title, lang });
const wishCalls = (from) => supa.calls.slice(from).filter((c) => /\/rest\/v1\/(wishlist_items|cards\?)/.test(c.url))
  .map((c) => `${c.method} ${decodeURIComponent(c.url.slice('https://cyrxjeppjqsxxjayfrur.supabase.co/rest/v1/'.length)).replace(/(select|order|limit|offset)=[^&]*&?/g, '').replace(/[?&]$/, '')}`);
const wishOf = (id, e) => JSON.parse(userRow(id, e).wish_state || 'null');
const oldWish = (id, e) => e.DB.sqlite.prepare("UPDATE users SET wish_state = json_set(wish_state, '$.at', '2020-01-01T00:00:00.000Z') WHERE id = ?").run(id);

await test('souhaits par collection : sélection, chevauchement, désactivation, acquisition et suppression', async () => {
  const e = makeEnv(); supa.reset();
  const m = await cronMember('Souhait1', e, mini(3));
  supa.cards = [gameCard('g-a', 'Manque A'), gameCard('g-b', 'Manque B'), gameCard('g-c', 'Manque C')];
  // Souhaits manuels sans rapport : le possédé doit sortir, le non possédé doit rester.
  supa.wishlist = [{ user_id: m.uid, card_id: 'g-x' }, { user_id: m.uid, card_id: 'mini-00001' }];
  const save = (id, titles, wish_sync, waits = null) => call('POST', 'targets/save', { key: m.u.key, e, waits,
    body: { id, name: id, items: titles.map(title => ({ title })), ...(wish_sync === undefined ? {} : { wish_sync }) } });
  const sync = async () => { oldWish(m.id, e); const r = await call('POST', 'wishlist/sync', { key: m.u.key, e, body: {} }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r; };
  const wishes = () => supa.wishes(m.uid);
  let r = await save('a', ['Manque A', 'Manque B'], true);
  assert.equal(r.status, 200); assert.equal(r.json.target.wish_sync, true);
  await save('b', ['Manque B', 'Manque C'], false);
  assert.equal((await save('bad', [], 'oui')).status, 400);
  await sync();
  assert.deepEqual(wishes(), ['g-a', 'g-b', 'g-x']);
  // Le choix est préservé quand un autre enregistrement ne porte pas ce champ.
  r = await save('a', ['Manque A', 'Manque B']);
  assert.equal(r.json.target.wish_sync, true);
  r = await call('GET', 'targets', { key: m.u.key, e });
  assert.deepEqual(r.json.targets.map(t => [t.id, t.wish_sync]).sort(), [['a', true], ['b', false]]);
  await save('b', ['Manque B', 'Manque C'], true); await sync();
  await save('a', ['Manque A', 'Manque B'], false); r = await sync();
  assert.equal(r.json.wish.removed, 1);
  assert.deepEqual(wishes(), ['g-b', 'g-c', 'g-x']);
  // Acquisition détectée par Rafraîchir : retire B ; le souhait manuel non possédé reste.
  supa.wishlist.push({ user_id: m.uid, card_id: 'mini-00002' }); // déjà possédée, mais jamais suivie par le classeur
  supa.player(m.uid).cards.push(rowOf({ id: 'g-b', title: 'Manque B', rarity: 'R', count: 1 }, { uid: m.uid }));
  oldWish(m.id, e); const waits = [];
  e.DB.sqlite.prepare('UPDATE users SET sync_click_at = NULL WHERE id = ?').run(m.id);
  await call('POST', 'refresh', { key: m.u.key, e, body: {}, waits }); await Promise.all(waits);
  assert.deepEqual(wishes(), ['g-c', 'g-x']);
  assert.equal(wishOf(m.id, e).removed, 2, 'retire la carte acquise et le souhait manuel déjà possédé');
  // Suppression de la dernière collection : nettoyage en arrière-plan.
  oldWish(m.id, e); const cleanup = [];
  await call('POST', 'targets/delete', { key: m.u.key, e, body: { id: 'b' }, waits: cleanup }); await Promise.all(cleanup);
  assert.deepEqual(wishes(), ['g-x']);
  assert.equal(userRow(m.id, e).auto_wish, 0);
  assert.equal(e.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM wish_managed WHERE user_id = ?').get(m.id).n, 0);
  const other = await signup('Souhait2', e);
  await call('POST', 'targets/save', { key: other.key, e, body: { id: 'a', name: 'Autre', items: [], wish_sync: true } });
  assert.equal(e.DB.sqlite.prepare('SELECT wish_sync FROM targets WHERE user_id = ? AND id = ?').get(m.id, 'a').wish_sync, 0);
  e.DB.close();
});

await test('souhaits stricts : tous les possédés retirés, souhaits manuels non possédés conservés, lots et reprise après refus', async () => {
  const e = makeEnv(); supa.reset();
  const m = await cronMember('SouhaitStrict', e, mini(205));
  const other = await signup('SouhaitStrictAutre', e);
  e.DB.sqlite.prepare('INSERT INTO cards (user_id, card_id, data) VALUES (?, ?, ?)')
    .run(other.user.id, 'other-owned', JSON.stringify({ title: 'Carte de l’autre', count: 1, rarity: 'C' }));
  supa.wishlist = [...m.cards.map(c => c.id), 'manual', 'other-owned'].map(card_id => ({ user_id: m.uid, card_id }));
  const session = await sessionOf(e, userRow(m.id, e));
  // Aucun album synchronisé : le clic peut quand même nettoyer les souhaits possédés.
  let r = await wishPass(e, userRow(m.id, e), session, { via: 'clic', max: 2, gap: 0 });
  assert.deepEqual([r.removed, r.left], [100, 105]);
  assert.equal(e.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM wish_managed WHERE user_id = ?').get(m.id).n, 105);
  assert.equal(userRow(m.id, e).auto_wish, 1, 'poursuivre les retraits possédés, même sans album sélectionné');
  supa.wishReply = () => ({ status: 400, body: { message: 'refus test' } });
  await assert.rejects(wishPass(e, userRow(m.id, e), session, { via: 'cron', gap: 0 }), /refus test/);
  assert.equal(userRow(m.id, e).auto_wish, 1);
  assert.equal(e.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM wish_managed WHERE user_id = ?').get(m.id).n, 105, 'échec : les retraits restent mémorisés');
  supa.wishReply = null; oldWish(m.id, e);
  r = await call('POST', 'wishlist/sync', { key: m.u.key, e, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.wish.removed, r.json.wish.left], [105, 0]);
  assert.deepEqual(supa.wishes(m.uid), ['manual', 'other-owned'], 'les souhaits non possédés restent, même si une autre personne les possède');
  assert.equal(userRow(m.id, e).auto_wish, 0);
  assert.equal(e.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM wish_managed WHERE user_id = ?').get(m.id).n, 0);
  e.DB.close(); supa.reset();
});

await test('souhaits : 4 000 souhaits suivis, alias conservés et retraits après modification sans parcours répétés', async () => {
  const e = makeEnv(); supa.reset();
  const m = await cronMember('SouhaitStrictVolume', e);
  const at = new Date().toISOString();
  const items = Array.from({ length: 4000 }, (_, i) => ({ title: 'Titre souhaité ' + i }));
  const cache = e.DB.sqlite.prepare('INSERT INTO game_titles (title, card_id, at) VALUES (?, ?, ?)');
  const managed = e.DB.sqlite.prepare('INSERT INTO wish_managed (user_id, card_id, title) VALUES (?, ?, ?)');
  e.DB.sqlite.exec('BEGIN');
  e.DB.sqlite.prepare('INSERT INTO targets (user_id, id, name, items, wish_sync, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
    .run(m.id, 'grand', 'Collection', JSON.stringify(items), at, at);
  for (let i = 0; i < 4000; i++) {
    cache.run(items[i].title, 'wish-' + i, at);
    managed.run(m.id, 'wish-' + i, 'Ancien titre ' + i);
  }
  e.DB.sqlite.prepare('UPDATE users SET auto_wish = 1 WHERE id = ?').run(m.id);
  e.DB.sqlite.exec('COMMIT');
  supa.wishlist = [...items.map((_, i) => 'wish-' + i), 'manual'].map(card_id => ({ user_id: m.uid, card_id }));
  const observed = [];
  const prepare = e.DB.prepare.bind(e.DB);
  e.DB.prepare = (sql) => {
    const st = prepare(sql), bind = st.bind.bind(st);
    st.bind = (...args) => { const bound = bind(...args); observed.push(bound); return bound; };
    return st;
  };
  const session = await sessionOf(e, userRow(m.id, e));
  let r = await wishPass(e, userRow(m.id, e), session, { via: 'cron', gap: 0 });
  assert.deepEqual([r.removed, r.added, r.left], [0, 0, 0], 'les alias demandés par la collection restent souhaités');
  const st = observed.find(s => s.sql.startsWith('WITH selected AS MATERIALIZED'));
  const plan = e.DB.sqlite.prepare('EXPLAIN QUERY PLAN ' + st.sql)
    .all(Object.fromEntries(st.params.map((p, i) => ['?' + (i + 1), p])));
  assert.equal(plan.filter(p => /SCAN i VIRTUAL TABLE/.test(p.detail)).length, 1, 'un seul parcours des éléments de collection');
  assert.match(plan.map(p => p.detail).join('\n'), /SEARCH g USING INDEX.*\(title=\?\)/);
  e.DB.sqlite.prepare('UPDATE targets SET items = ? WHERE user_id = ? AND id = ?').run(JSON.stringify(items.slice(500)), m.id, 'grand');
  r = await wishPass(e, userRow(m.id, e), session, { via: 'cron', gap: 0 });
  assert.deepEqual([r.removed, r.added, r.left], [500, 0, 0]);
  assert.equal(supa.wishes(m.uid).length, 3501);
  assert.ok(supa.wishes(m.uid).includes('manual'));
  e.DB.close(); supa.reset();
});

await test('titres sans cartes : bilan, portée, sélection, suppression complète et résultats périmés', async () => {
  const e = makeEnv(); supa.reset();
  const m = await cronMember('SansCartes', e, mini(3));
  supa.cards = [gameCard('existe', 'Existe')];
  const req = (method, route, body) => call(method, route, { key: m.u.key, e, body });
  const save = (id, titles, wish_sync = true) => req('POST', 'targets/save', {
    id, name: id, wish_sync, items: titles.map(title => ({ title, status: 'ok' })),
  });
  await save('a', ['Absent A', 'Absent B', 'Existe']);
  await save('b', ['Absent A', 'Absent B']);
  await save('off', ['Absent A', 'Absent C'], false);
  oldWish(m.id, e);
  let r = await req('POST', 'wishlist/sync', {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.wish.none, 2);
  assert.equal(e.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM wish_missing WHERE user_id = ?').get(m.id).n, 2);
  let list = (await req('GET', 'wishlist/missing')).json;
  assert.deepEqual(list.items.map(i => i.title), ['Absent A', 'Absent B']);
  assert.deepEqual(list.items[0].collections.map(c => c.id).sort(), ['a', 'b']);
  assert.equal((await req('POST', 'wishlist/missing', { titles: [], revision: list.revision })).status, 400);
  const other = await signup('SansCartesAutre', e);
  assert.deepEqual((await call('GET', 'wishlist/missing', { key: other.key, e })).json.items, []);
  // Un titre résolu depuis l'affichage rend la demande périmée ; aucun retrait.
  e.DB.sqlite.prepare("UPDATE game_titles SET card_id = 'apparu' WHERE title = 'Absent B'").run();
  assert.equal((await req('POST', 'wishlist/missing', { all: true, revision: list.revision })).status, 409);
  list = (await req('GET', 'wishlist/missing')).json;
  r = await req('POST', 'wishlist/missing', { titles: ['Absent A', 'Existe', 'Absent C'], revision: list.revision });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.removed, 1);
  const albums = () => e.DB.sqlite.prepare('SELECT id, items FROM targets WHERE user_id = ? ORDER BY id').all(m.id)
    .map(t => [t.id, JSON.parse(t.items).map(i => i.title)]);
  assert.deepEqual(albums(), [['a', ['Absent B', 'Existe']], ['b', ['Absent B']], ['off', ['Absent A', 'Absent C']]]);
  // Mode complet : inclut les albums décochés après une nouvelle passe, et conserve les titres trouvés.
  await req('PATCH', 'me', { wish_mode: 'all' }); oldWish(m.id, e);
  r = await req('POST', 'wishlist/sync', {}); assert.equal(r.status, 200);
  list = (await req('GET', 'wishlist/missing')).json;
  assert.deepEqual(list.items.map(i => i.title), ['Absent A', 'Absent C']);
  await save('a', ['Absent B', 'Existe', 'Nouveau']);
  assert.equal((await req('POST', 'wishlist/missing', { all: true, revision: list.revision })).status, 409);
  list = (await req('GET', 'wishlist/missing')).json;
  assert.ok(!list.items.some(i => i.title === 'Nouveau'), 'un titre non recherché ne peut pas être supprimé');
  r = await req('POST', 'wishlist/missing', { all: true, revision: list.revision });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.removed, 2);
  assert.deepEqual(albums(), [['a', ['Absent B', 'Existe', 'Nouveau']], ['b', ['Absent B']], ['off', []]]);
  assert.equal(wishOf(m.id, e).none, 0);
  // Ancien bilan sans liste persistée : compatibilité avec les résultats négatifs encore frais.
  await save('off', ['Absent C']);
  e.DB.sqlite.prepare('UPDATE users SET wish_state = ? WHERE id = ?').run(JSON.stringify({ at: new Date().toISOString(), none: 1 }), m.id);
  assert.deepEqual((await req('GET', 'wishlist/missing')).json.items.map(i => i.title), ['Absent C']);
  e.DB.sqlite.prepare("UPDATE game_titles SET at = '2020-01-01' WHERE title = 'Absent C'").run();
  assert.deepEqual((await req('GET', 'wishlist/missing')).json.items, []);
  await req('DELETE', 'me');
  assert.equal(e.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM wish_missing WHERE user_id = ?').get(m.id).n, 0);
  e.DB.close(); supa.reset();
});

await test('titres sans cartes : 5 000 retraits, 15 000 cartes, albums communs et plans sans parcours répétés', async () => {
  const e = makeEnv();
  const u = await signup('SansCartesVolume', e), uid = u.user.id;
  const at = new Date().toISOString();
  const missing = Array.from({ length: 5000 }, (_, i) => 'Sans carte ' + String(i).padStart(4, '0'));
  const keep = Array.from({ length: 1200 }, (_, i) => ({ title: 'Possédée ' + i, status: 'ok', description: 'À conserver', sep: i === 0 }));
  const items = [...missing.map(title => ({ title, status: 'ok', image: null })), ...keep];
  const insertTarget = e.DB.sqlite.prepare('INSERT INTO targets (user_id, id, name, items, created_at, updated_at, wish_sync) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertCard = e.DB.sqlite.prepare('INSERT INTO cards (user_id, card_id, data) VALUES (?, ?, ?)');
  const insertTitle = e.DB.sqlite.prepare('INSERT INTO game_titles (title, card_id, at) VALUES (?, ?, ?)');
  const insertMissing = e.DB.sqlite.prepare('INSERT INTO wish_missing (user_id, title) VALUES (?, ?)');
  e.DB.sqlite.exec('BEGIN');
  insertTarget.run(uid, 'grand', 'Lepidoptera', JSON.stringify(items), at, at, 1);
  insertTarget.run(uid, 'commun', 'Titres communs', JSON.stringify([...items.slice(0, 1500), keep[0]]), at, at, 1);
  insertTarget.run(uid, 'off', 'Non synchronisée', JSON.stringify(items), at, at, 0);
  for (let i = 0; i < 15000; i++) insertCard.run(uid, 'owned-' + i, JSON.stringify({ title: 'Possédée ' + i, count: 1, rarity: 'C' }));
  for (const title of missing) { insertTitle.run(title, '', at); insertMissing.run(uid, title); }
  for (let i = 0; i < 15000; i++) insertTitle.run('Possédée ' + i, 'owned-' + i, at);
  e.DB.sqlite.prepare('UPDATE users SET wish_state = ? WHERE id = ?').run(JSON.stringify({ at, none: 5000, missing_checked: true }), uid);
  e.DB.sqlite.exec('COMMIT');
  const observed = [];
  const prepare = e.DB.prepare.bind(e.DB);
  e.DB.prepare = (sql) => {
    const st = prepare(sql), bind = st.bind.bind(st);
    st.bind = (...args) => { const bound = bind(...args); observed.push(bound); return bound; };
    return st;
  };
  const req = (method, body) => call(method, 'wishlist/missing', { key: u.key, e, body });
  const sqlStart = e.DB.sqlMs;
  let r = await req('GET');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.items.length, 5000);
  assert.deepEqual(r.json.items[0].collections.map(c => c.id).sort(), ['commun', 'grand']);
  const selected = missing.slice(0, 1200);
  r = await req('POST', { titles: selected, revision: r.json.revision });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { removed: 1200, collections: 2, skipped: 0 });
  let list = (await req('GET')).json;
  assert.equal(list.items.length, 3800);
  // Évolution depuis l'affichage : protéger titre résolu, obtenu, et cache expiré même en grande quantité.
  e.DB.sqlite.prepare("UPDATE game_titles SET card_id = 'apparue' WHERE title = ?").run(missing[2000]);
  insertCard.run(uid, 'nouvelle', JSON.stringify({ title: missing[2001], count: 1, rarity: 'C' }));
  e.DB.sqlite.prepare("UPDATE game_titles SET at = '2020-01-01' WHERE title = ?").run(missing[2002]);
  assert.equal((await req('POST', { all: true, revision: list.revision })).status, 409);
  list = (await req('GET')).json;
  assert.equal(list.items.length, 3797);
  r = await req('POST', { all: true, revision: list.revision });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { removed: 3797, collections: 2, skipped: 0 });
  const album = id => JSON.parse(e.DB.sqlite.prepare('SELECT items FROM targets WHERE user_id = ? AND id = ?').get(uid, id).items);
  assert.deepEqual(album('grand'), [...items.slice(2000, 2003), ...keep], 'tous les champs et titres protégés sont conservés dans leur ordre');
  assert.deepEqual(album('commun'), [keep[0]]);
  assert.deepEqual(album('off'), items, 'les albums non synchronisés sont intacts');
  assert.equal((await req('GET')).json.items.length, 0);
  const listQuery = observed.find(s => s.sql.startsWith('WITH entries AS MATERIALIZED'));
  const deleteQuery = observed.find(s => s.sql.startsWith('WITH missing AS MATERIALIZED'));
  for (const st of [listQuery, deleteQuery]) {
    assert.ok(st, 'requête observée');
    const plan = e.DB.sqlite.prepare('EXPLAIN QUERY PLAN ' + st.sql)
      .all(Object.fromEntries(st.params.map((p, i) => ['?' + (i + 1), p])));
    const text = plan.map(p => p.detail).join('\n');
    assert.match(text, /SEARCH g USING INDEX.*\(title=\?\)/, text);
    assert.equal(plan.filter(p => /SCAN i VIRTUAL TABLE/.test(p.detail)).length, 1, text);
    for (const p of plan.filter(p => /SEARCH cards /.test(p.detail))) {
      assert.match(plan.find(parent => parent.id === p.parent).detail, /LIST SUBQUERY/, 'les cartes sont regroupées une fois, sans recherche corrélée par titre :\n' + text);
    }
  }
  console.log(`    titres sans cartes, 5 000 titres + 15 000 cartes : SQLite ${(e.DB.sqlMs - sqlStart).toFixed(1)} ms pour l'ensemble du scénario`);
  e.DB.close();
});

await test('souhaits par collection : arrière-plan, cron, dernière sélection et reprise après erreur', async () => {
  const e = makeEnv(); supa.reset();
  const m = await cronMember('Souhait3', e, mini(3));
  supa.cards = [gameCard('g-a', 'Manque A'), gameCard('g-b', 'Manque B')];
  let waits = [];
  const body = { id: 'liste', name: 'Manques', items: [{ title: 'Manque A' }, { title: 'Pas dans le jeu' }], wish_sync: true };
  let r = await call('POST', 'targets/save', { key: m.u.key, e, body, waits }); await Promise.all(waits);
  assert.equal(r.status, 200); assert.deepEqual(supa.wishes(m.uid), ['g-a']); assert.equal(wishOf(m.id, e).none, 1);
  waits = []; body.items.push({ title: 'Manque B' });
  await call('POST', 'targets/save', { key: m.u.key, e, body, waits }); await Promise.all(waits);
  assert.deepEqual(supa.wishes(m.uid), ['g-a']); assert.equal(userRow(m.id, e).wish_dirty, 1);
  assert.match(await runCron(e, COLLECTION_CRON), /1 carte de liste de souhaits/);
  assert.deepEqual(supa.wishes(m.uid), ['g-a', 'g-b']);
  await call('POST', 'targets/save', { key: m.u.key, e, body: { ...body, wish_sync: false } });
  assert.equal(userRow(m.id, e).auto_wish, 1, 'retraits en attente après la dernière désactivation');
  supa.wishReply = () => ({ status: 403, body: { code: 'automation_limit' } });
  assert.match(await runCron(e, COLLECTION_CRON), /^limite du jeu/); assert.equal(await runCron(e, COLLECTION_CRON), null);
  assert.ok(wishOf(m.id, e).error); supa.wishReply = null; oldWish(m.id, e);
  r = await call('POST', 'wishlist/sync', { key: m.u.key, e, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.wish.removed, 2);
  assert.deepEqual(supa.wishes(m.uid), []); assert.equal(userRow(m.id, e).auto_wish, 0);
  assert.equal((await call('POST', 'wishlist/sync', { key: m.u.key, e, body: {} })).status, 429);
  WISH_ROUTE.known = false; after(() => { WISH_ROUTE.known = true; });
  assert.equal((await call('POST', 'wishlist/sync', { key: m.u.key, e, body: {} })).status, 503);
  e.DB.close();
});

await test('souhaits : mode compte complet, nouvelles collections et retour aux sélections individuelles', async () => {
  const e = makeEnv(); supa.reset();
  const m = await cronMember('SouhaitModes', e, mini(3));
  supa.cards = [gameCard('g-a', 'Manque A'), gameCard('g-b', 'Manque B'), gameCard('g-c', 'Manque C')];
  for (const [id, title, wish_sync] of [['a', 'Manque A', true], ['b', 'Manque B', false]]) {
    await call('POST', 'targets/save', { key: m.u.key, e, body: { id, name: id, items: [{ title }], wish_sync } });
  }
  const mode = async (wish_mode) => {
    oldWish(m.id, e); const waits = [];
    const r = await call('PATCH', 'me', { key: m.u.key, e, body: { wish_mode }, waits });
    await Promise.all(waits); assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.wish_mode, wish_mode);
  };
  await mode('all');
  assert.deepEqual(supa.wishes(m.uid), ['g-a', 'g-b']);
  oldWish(m.id, e); const waits = [];
  await call('POST', 'targets/save', { key: m.u.key, e, body: { id: 'c', name: 'Nouvelle', items: [{ title: 'Manque C' }] }, waits });
  await Promise.all(waits);
  assert.deepEqual(supa.wishes(m.uid), ['g-a', 'g-b', 'g-c']);
  await mode('selected');
  assert.deepEqual(supa.wishes(m.uid), ['g-a']);
  assert.deepEqual(e.DB.sqlite.prepare('SELECT wish_sync FROM targets WHERE user_id = ? ORDER BY id').all(m.id).map(r => r.wish_sync), [1, 0, 0]);
  assert.equal((await call('GET', 'me', { key: m.u.key, e })).json.wish_mode, 'selected');
  assert.equal((await call('PATCH', 'me', { key: m.u.key, e, body: { wish_mode: 'bad' } })).status, 400);
  assert.equal((await call('PATCH', 'me', { key: m.u.key, e, body: { wish_mode: 'all', auto_wish: false } })).status, 400);
  e.DB.close();
});

await test('souhaits : retrait par lots poursuivi après la désactivation de la dernière collection', async () => {
  const e = makeEnv(); supa.reset();
  const m = await cronMember('SouhaitLots', e, mini(3));
  const ids = Array.from({ length: 205 }, (_, i) => `wish-${i}`);
  for (const id of ids) e.DB.sqlite.prepare('INSERT INTO wish_managed (user_id, card_id, title) VALUES (?, ?, ?)').run(m.id, id, id);
  supa.wishlist = [...ids, 'manual'].map(card_id => ({ user_id: m.uid, card_id }));
  e.DB.sqlite.prepare('UPDATE users SET auto_wish = 1 WHERE id = ?').run(m.id);
  const user = userRow(m.id, e);
  const s = await sessionOf(e, user);
  let r = await wishPass(e, user, s, { via: 'cron', max: 2, gap: 0 });
  assert.deepEqual([r.removed, r.left], [100, 105]);
  assert.equal(userRow(m.id, e).auto_wish, 1);
  oldWish(m.id, e);
  r = await call('POST', 'wishlist/sync', { key: m.u.key, e, body: {} });
  assert.deepEqual([r.status, r.json.wish.removed, r.json.wish.left], [200, 105, 0]);
  assert.deepEqual(supa.wishes(m.uid), ['manual']);
  assert.equal(userRow(m.id, e).auto_wish, 0);
  e.DB.close();
});

await test("marché d'une carte (fiche) : enchères en cours, ventes, cote rangée ; détail d'une enchère par le site du jeu, plafonds et limite du jeu", async () => {
  const e = makeEnv();
  clearMarketGame();
  supa.siteLimit = null;
  const m = await marketMember('Fiona', e);
  const { uid } = m;
  supa.player('vendeur').username = 'Vendeuse';
  supa.player('meneur').username = 'Meneur';
  supa.cards = [{ id: 'w9-en', wikipedia_title: 'Voulue 9', lang: 'en' }, { id: 'w9', wikipedia_title: 'Voulue 9', lang: 'fr' }];
  const soon = (ms) => new Date(Date.now() + ms).toISOString();
  const active = (id, extra) => ({ id, card_id: 'w9', status: 'active', snapshot_rarity: 'R', snapshot_atk: 12, snapshot_def: 30, is_shiny: false, seller_id: 'vendeur',
    current_bid: null, current_bidder_id: null, base_amount: 40, end_at: soon(3 * H), ...extra });
  for (let i = 0; i < 4; i++) addAuctions(sale('w9', 'R', 100 + i, (i + 1) * H));
  addAuctions(sale('w9', 'SR', 500, 1.5 * H, true), sale('w9', 'R', 7, 100 * 24 * H));
  addAuctions(
    active('b1', { current_bid: 80, current_bidder_id: 'meneur', bid_count: 3, bids: [{ bidder_id: uid, amount: 60 }, { bidder_id: 'meneur', amount: 70 }, { bidder_id: 'meneur', amount: 80 }] }),
    active('b2', { end_at: soon(H / 2) }),
    active('b3', { seller_id: uid, base_amount: 90, end_at: soon(5 * H) }),
    active('b4', { current_bid: 55, current_bidder_id: uid, is_shiny: true, snapshot_rarity: 'SR' }),
    { ...active('b5'), status: 'settled_unsold' },
    active('b6', { end_at: isoAgo(H) }),
    active('autre', { card_id: 'w8' }),
  );
  const card = (q) => call('GET', 'market/card?' + q, { key: m.u.key, e });

  // Par titre : la carte française, ses enchères en cours (la fin la plus proche d'abord), ses ventes, sa cote.
  supa.calls = [];
  let r = await card('title=' + encodeURIComponent('Voulue 9'));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.card_id, 'w9');
  assert.equal(supa.rest().length, 3, 'titre, enchères en cours, ventes');
  assert.ok(restPaths(0)[1].startsWith('auctions?select=*&status=eq.active') && restPaths(0)[1].includes('card_id=eq.w9'));
  assert.deepEqual(r.json.auctions.map((a) => [a.a, a.ask, a.bid, a.lead, a.mine, a.n]),
    [['b2', 40, false, false, false, null], ['b1', 80, true, false, false, 3], ['b4', 55, true, true, false, null], ['b3', 90, false, false, true, null]]);
  assert.deepEqual(r.json.auctions[1], { a: 'b1', r: 'R', s: false, ask: 80, bid: true, cur: 80, base: 40, end: r.json.auctions[1].end, atk: 12, def: 30, lead: false, mine: false, n: 3 });
  assert.equal(r.json.auctions[2].s, true);
  assert.ok(!JSON.stringify(r.json).includes('vendeur') && !JSON.stringify(r.json).includes(uid), 'ni vendeur ni enchérisseur dans la réponse');
  assert.deepEqual(r.json.sales.map((x) => [x.p, x.k]), [[100, 'R'], [500, 'SR*'], [101, 'R'], [102, 'R'], [103, 'R'], [7, 'R']], 'les plus récentes d\'abord');
  assert.deepEqual(r.json.v.R, { p: 101.5, n: 4, w: null, l: 100, d: r.json.v.R.d }, 'cote des 90 derniers jours');
  assert.deepEqual(priceOf(e, 'w9'), r.json.v, 'cote rangée dans le cache commun');
  // Par identifiant : deux requêtes ; titre inconnu : rien.
  supa.calls = [];
  r = await card('id=w9');
  assert.deepEqual([r.status, supa.rest().length, r.json.auctions.length], [200, 2, 4]);
  r = await card('title=Inconnue');
  assert.deepEqual(r.json, { card_id: null, at: r.json.at, auctions: [], more: false, sales: [], v: null });
  assert.equal((await card('id=' + encodeURIComponent('a b'))).status, 400);
  assert.equal((await card('')).status, 400);

  // Détail d'une enchère : mises, enchérisseurs, meneur, vendeur, ta mise.
  const detail = (id) => call('GET', 'market/auction?id=' + id, { key: m.u.key, e });
  supa.calls = [];
  r = await detail('b1');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { a: 'b1', gone: false, status: 'active', bids: 3, bidders: 2, leader: 'Meneur', seller: 'Vendeuse', leading: false, selling: false, my_bid: 60, cur: 80 });
  const siteCalls = supa.calls.filter((c) => c.url.startsWith('https://www.wiki-masters.com/'));
  assert.deepEqual(siteCalls.map((c) => c.path), ['/api/marketplace/b1']);
  assert.ok(siteCalls[0].headers.cookie.startsWith('sb-cyrxjeppjqsxxjayfrur-auth-token=base64-'));
  r = await detail('b4');
  assert.deepEqual([r.json.leading, r.json.leader, r.json.bids], [true, null, 0], 'sans mise lue : meneur inconnu, toi en tête');
  r = await detail('b3');
  assert.equal(r.json.selling, true);
  assert.deepEqual((await detail('nulle-part')).json, { a: 'nulle-part', gone: true });
  assert.equal((await detail('a%20b')).status, 400);

  // Session presque expirée : renouvelée avant l'appel au site (le site ne doit jamais avoir à le faire).
  const p = supa.player(uid);
  p.expires_at = Math.floor(Date.now() / 1000) + 200;
  const s0 = await sessionOf(e, userRow(m.id, e));
  e.DB.sqlite.prepare('UPDATE users SET game_session_enc = ? WHERE id = ?').run(await sealSession(e, m.id, { ...s0.auth, expires_at: p.expires_at }), m.id);
  supa.calls = [];
  assert.equal((await detail('b2')).status, 200);
  assert.equal(supa.tokens().length, 1, 'un renouvellement avant le site');

  // Plafonds par minute (les compteurs repartent de zéro) ; puis la limite du jeu : pause de 10 min, sans appel au site.
  e.DB.sqlite.prepare('DELETE FROM game_reads').run();
  for (let i = 0; i < 20; i++) assert.equal((await detail('b2')).status, 200, 'détail ' + (i + 1));
  r = await detail('b2');
  assert.deepEqual([r.status, r.json.retry_after > 0 && r.json.retry_after <= 60, !!r.json.limited], [429, true, false]);
  for (let i = 0; i < 12; i++) assert.equal((await card('id=w9')).status, 200, 'fiche ' + (i + 1));
  assert.equal((await card('id=w9')).status, 429);
  e.DB.sqlite.prepare('DELETE FROM game_reads').run();
  supa.siteLimit = 'automation_limit';
  r = await detail('b1');
  assert.deepEqual([r.status, r.json.limited], [429, true]);
  supa.siteLimit = null;
  supa.calls = [];
  r = await detail('b1');
  assert.deepEqual([r.status, r.json.limited, r.json.retry_after > 500], [429, true, true]);
  assert.equal(supa.calls.length, 0, 'en pause : rien ne part au jeu');
  assert.equal((await card('id=w9')).status, 200, 'les fiches restent lisibles');

  // Sans compte relié : 401 needs_link, rien de lu.
  const n = await signup('Nino', e);
  r = await call('GET', 'market/card?id=w9', { key: n.key, e });
  assert.deepEqual([r.status, r.json.needs_link], [401, true]);
  r = await call('GET', 'market/auction?id=b1', { key: n.key, e });
  assert.deepEqual([r.status, r.json.needs_link], [401, true]);
  clearMarketGame();
  e.DB.close();
});

await test('vente : GET /api/market/sell (exemplaires, enchères actives), POST /api/market/sell (exemplaire choisi, refus, vérification, limite), POST /api/market/cancel (seulement sans mise)', async () => {
  const e = makeEnv();
  clearMarketGame();
  const m = await marketMember('Gaby', e);
  const { uid } = m;
  const me = supa.player(uid);
  // c1 : un exemplaire favori, un brillant, un ordinaire (snapshot_rarity R : rareté d'exemplaire différente de la carte).
  me.cards.find((x) => x.id === 'e1').starred = true;
  me.cards.push({ ...rowOf({ id: 'c1', title: 'Carte 1', rarity: 'C', count: 2 }, { uid, eid: 'e1-brillant' }), is_shiny: true });
  me.cards.push(rowOf({ id: 'c1', title: 'Carte 1', rarity: 'C', count: 1 }, { uid, eid: 'e1-simple' }));
  me.cards.push(rowOf({ id: 'c1', title: 'Carte 1', rarity: 'C', count: 1 }, { uid, eid: 'e1-rare', snapshot_rarity: 'R' }));
  putPrice(e, 'c1', { C: { p: 40, n: 5, w: null, l: 42, d: isoAgo(H) } });
  // Une lecture du marché gardée : « Tes ventes » est mise à jour sans attendre la suivante.
  const liveAt = isoAgo(5 * 60_000);
  e.DB.sqlite.prepare('INSERT OR REPLACE INTO market (user_id, live, live_at) VALUES (?, ?, ?)').run(m.id, JSON.stringify({ deals: [], bids: [], sales: [] }), liveAt);
  const live = () => JSON.parse(e.DB.sqlite.prepare('SELECT live FROM market WHERE user_id = ?').get(m.id).live);
  const site = () => supa.calls.filter((c) => c.url.startsWith('https://www.wiki-masters.com/')).map((c) => c.method + ' ' + c.path);
  const info = (id) => call('GET', 'market/sell?id=' + id, { key: m.u.key, e });
  const sell = (body) => call('POST', 'market/sell', { key: m.u.key, e, body });
  const cancel = (a) => call('POST', 'market/cancel', { key: m.u.key, e, body: { a } });

  // Exemplaires par rareté d'exemplaire et brillance, favoris comptés ; enchères actives lues sur le site du jeu.
  supa.calls = [];
  let r = await info('c1');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { card_id: 'c1', copies: [{ k: 'R', n: 1, fav: 0 }, { k: 'C', n: 2, fav: 1 }, { k: 'C*', n: 2, fav: 0 }], selling: 0, max: 5 });
  assert.deepEqual(site(), ['GET /api/marketplace/mine']);
  assert.equal((await info('a b')).status, 400);

  // Corps mal formés : rien ne part au jeu.
  supa.calls = [];
  for (const bad of [{}, { id: 'c1', k: 'X', base: 10, minutes: 60 }, { id: 'c1', k: 'C', base: 0, minutes: 60 }, { id: 'c1', k: 'C', base: 1.5, minutes: 60 },
    { id: 'c1', k: 'C', base: '10', minutes: 60 }, { id: 'c1', k: 'C', base: 10, minutes: 45 }, { id: 'a b', k: 'C', base: 10, minutes: 60 }]) {
    assert.equal((await sell(bad)).status, 400, JSON.stringify(bad));
  }
  assert.deepEqual(site(), []);

  // Mise en vente : l'exemplaire ordinaire (ni favori ni brillant), id de l'exemplaire envoyé au jeu, cookie refait.
  supa.calls = [];
  r = await sell({ id: 'c1', k: 'C', base: 35, minutes: 60 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.auction.a, r.json.auction.k, r.json.auction.base, r.json.auction.minutes, r.json.url],
    ['vente-1', 'C', 35, 60, 'https://www.wiki-masters.com/marketplace/vente-1']);
  assert.deepEqual(site(), ['POST /api/marketplace']);
  const post = supa.calls.find((c) => c.method === 'POST' && c.path === '/api/marketplace');
  assert.deepEqual(JSON.parse(post.body), { card_id: 'e1-simple', base_amount: 35, duration_minutes: 60 });
  assert.ok(post.headers.cookie.startsWith('sb-cyrxjeppjqsxxjayfrur-auth-token=base64-'));
  for (const tok of [me.access, me.refresh]) assert.ok(!JSON.stringify(r.json).includes(tok), 'jeton absent de la réponse');
  let sales = live().sales;
  assert.deepEqual(sales.map((x) => [x.a, x.id, x.t, x.r, x.s, x.base, x.cur, x.bid, x.st, x.cote, x.n]), [['vente-1', 'c1', 'Carte 1', 'C', false, 35, null, false, 'run', 40, 5]]);
  assert.equal(e.DB.sqlite.prepare('SELECT live_at FROM market WHERE user_id = ?').get(m.id).live_at, liveAt, "l'heure reste celle de la lecture");
  // Brillante, rareté d'exemplaire R.
  r = await sell({ id: 'c1', k: 'C*', base: 200, minutes: 720 });
  assert.equal(JSON.parse(supa.calls.at(-1).body).card_id, 'e1-brillant');
  r = await sell({ id: 'c1', k: 'R', base: 90, minutes: 10 });
  assert.equal(JSON.parse(supa.calls.at(-1).body).card_id, 'e1-rare');
  assert.deepEqual(live().sales.map((x) => x.a), ['vente-3', 'vente-2', 'vente-1'], 'les plus récentes en tête');
  assert.equal((await info('c1')).json.selling, 3);
  // Rareté d'exemplaire absente du jeu : 409, rien envoyé.
  supa.calls = [];
  r = await sell({ id: 'c1', k: 'SR', base: 10, minutes: 60 });
  assert.deepEqual([r.status, site()], [409, []]);

  // Refus du jeu (plafond d'enchères actives) : son message ; vérification anti-robot : verify ; panne : à vérifier dans le jeu.
  supa.maxAuctions = 3;
  r = await sell({ id: 'c0', k: 'C', base: 10, minutes: 60 });
  assert.equal(r.status, 409);
  assert.match(r.json.error, /Maximum 3 enchères actives/);
  supa.maxAuctions = 5;
  supa.sellReply = () => ({ status: 403, body: { code: 'human_verification_required', error: 'Vérification requise' } });
  r = await sell({ id: 'c0', k: 'C', base: 10, minutes: 60 });
  assert.deepEqual([r.status, r.json.verify], [409, true]);
  supa.sellReply = () => ({ network: true });
  r = await sell({ id: 'c0', k: 'C', base: 10, minutes: 60 });
  assert.equal(r.status, 502);
  assert.match(r.json.error, /regarde dans le jeu/);
  supa.sellReply = () => ({ status: 201, body: {} });
  assert.equal((await sell({ id: 'c0', k: 'C', base: 10, minutes: 60 })).status, 502, 'sans enchère renvoyée');
  supa.sellReply = null;

  // Annulation : relue d'abord sur le site du jeu, puis DELETE ; « Tes ventes » la marque terminée.
  supa.calls = [];
  r = await cancel('vente-1');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { a: 'vente-1', status: 'cancelled' });
  assert.deepEqual(site(), ['GET /api/marketplace/vente-1', 'DELETE /api/marketplace/vente-1']);
  assert.equal(me.auctions.find((x) => x.id === 'vente-1').status, 'cancelled');
  sales = live().sales;
  assert.deepEqual(sales.map((x) => [x.a, x.st]), [['vente-3', 'run'], ['vente-2', 'run'], ['vente-1', 'off']]);
  // Déjà annulée, inconnue, mal formée.
  supa.calls = [];
  r = await cancel('vente-1');
  assert.deepEqual([r.status, r.json.gone, site()], [409, true, ['GET /api/marketplace/vente-1']]);
  assert.deepEqual([(await cancel('nulle-part')).status, (await cancel('a b')).status], [409, 400]);
  // Quelqu'un a misé : refusée, sans DELETE.
  const v2 = me.auctions.find((x) => x.id === 'vente-2');
  Object.assign(v2, { current_bid: 210, current_bidder_id: 'meneur', bids: [{ bidder_id: 'meneur', amount: 210 }] });
  supa.calls = [];
  r = await cancel('vente-2');
  assert.deepEqual([r.status, r.json.has_bid, site()], [409, true, ['GET /api/marketplace/vente-2']]);
  assert.equal(v2.status, 'active');
  // La vente d'un autre : 403.
  addAuctions({ id: 'autre', card_id: 'c0', status: 'active', seller_id: 'vendeur', base_amount: 10, current_bid: null, current_bidder_id: null, end_at: new Date(Date.now() + H).toISOString(), snapshot_rarity: 'C', is_shiny: false });
  assert.equal((await cancel('autre')).status, 403);

  // Le jeu limite : pause de 10 min des routes du marché, plus rien ne part (vente, annulation, détail).
  e.DB.sqlite.prepare('DELETE FROM game_reads').run();
  supa.siteLimit = 'automation_limit';
  r = await sell({ id: 'c0', k: 'C', base: 10, minutes: 60 });
  assert.deepEqual([r.status, r.json.limited], [429, true]);
  supa.siteLimit = null;
  supa.calls = [];
  for (const res of [await sell({ id: 'c0', k: 'C', base: 10, minutes: 60 }), await cancel('vente-3'), await info('c0')]) assert.deepEqual([res.status, res.json.limited], [429, true]);
  assert.deepEqual(site(), []);
  // Plafond par minute partagé avec les détails d'enchère (20).
  e.DB.sqlite.prepare('DELETE FROM game_reads').run();
  for (let i = 0; i < 20; i++) assert.equal((await info('c0')).status, 200, 'lecture ' + (i + 1));
  assert.equal((await sell({ id: 'c0', k: 'C', base: 10, minutes: 60 })).status, 429);

  // Sans lecture du marché gardée : la vente passe quand même, rien à mettre à jour.
  e.DB.sqlite.prepare('DELETE FROM game_reads').run();
  e.DB.sqlite.prepare('DELETE FROM market WHERE user_id = ?').run(m.id);
  assert.equal((await sell({ id: 'c0', k: 'C', base: 10, minutes: 30 })).status, 200);

  // Sans compte relié : 401 needs_link, rien ne part.
  const n = await signup('Noa', e);
  supa.calls = [];
  r = await call('POST', 'market/sell', { key: n.key, e, body: { id: 'c0', k: 'C', base: 10, minutes: 60 } });
  assert.deepEqual([r.status, r.json.needs_link, site()], [401, true, []]);
  clearMarketGame();
  supa.reset();
  e.DB.close();
});

await test('mise : POST /api/market/bid (relue puis misée, minimum, ta vente, tu mènes, finie, refus, vérification, limite), solde et lecture du marché mis à jour', async () => {
  const e = makeEnv();
  clearMarketGame();
  const m = await marketMember('Hugo', e);
  const me = supa.player(m.uid);
  me.wikibidous = 500;
  const end = new Date(Date.now() + H).toISOString();
  const auction = (id, x = {}) => ({ id, card_id: 'w1', status: 'active', seller_id: 'vendeur', base_amount: 10, current_bid: null, current_bidder_id: null,
    end_at: end, snapshot_rarity: 'R', is_shiny: false, card: { wikipedia_title: 'Voulue 1' }, bids: [], ...x });
  addAuctions(auction('m1'), auction('m2', { current_bid: 40, current_bidder_id: 'autre', bids: [{ bidder_id: 'autre', amount: 40 }] }),
    auction('m3', { end_at: new Date(Date.now() - 1000).toISOString() }));
  me.auctions.push(auction('m4', { seller_id: m.uid }));
  // Une lecture du marché gardée, avec m1 en bonne affaire : elle passe « tu mènes » sans attendre la suivante.
  const liveAt = isoAgo(5 * 60_000);
  const deal = { a: 'm1', id: 'w1', t: 'Voulue 1', r: 'R', s: false, img: null, end, cote: 80, n: 4, ask: 10, bid: false, lead: false, more: 0 };
  e.DB.sqlite.prepare('INSERT OR REPLACE INTO market (user_id, live, live_at) VALUES (?, ?, ?)').run(m.id, JSON.stringify({ deals: [deal], bids: [], sales: [] }), liveAt);
  const live = () => JSON.parse(e.DB.sqlite.prepare('SELECT live FROM market WHERE user_id = ?').get(m.id).live);
  const site = () => supa.calls.filter((c) => c.url.startsWith('https://www.wiki-masters.com/')).map((c) => c.method + ' ' + c.path);
  const bid = (a, amount) => call('POST', 'market/bid', { key: m.u.key, e, body: { a, amount } });

  // Corps mal formés : rien ne part au jeu.
  supa.calls = [];
  for (const [a, amount] of [['m1', 0], ['m1', 1.5], ['m1', '10'], ['a b', 10], [null, 10]]) assert.equal((await bid(a, amount)).status, 400, `${a} ${amount}`);
  assert.deepEqual(site(), []);

  // Sans mise : au moins le prix de départ ; relue, puis misée ; solde et lecture du marché mis à jour.
  supa.calls = [];
  let r = await bid('m1', 9);
  assert.deepEqual([r.status, r.json.min, r.json.cur, site()], [409, 10, null, ['GET /api/marketplace/m1']]);
  supa.calls = [];
  r = await bid('m1', 12);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { a: 'm1', amount: 12, cur: 12, balance: 488, url: 'https://www.wiki-masters.com/marketplace/m1' });
  assert.deepEqual(site(), ['GET /api/marketplace/m1', 'POST /api/marketplace/m1/bid']);
  const post = supa.calls.find((c) => c.method === 'POST');
  assert.deepEqual(JSON.parse(post.body), { amount: 12 });
  assert.equal(post.headers.referer, 'https://www.wiki-masters.com/marketplace/m1');
  for (const tok of [me.access, me.refresh]) assert.ok(!JSON.stringify(r.json).includes(tok), 'jeton absent de la réponse');
  assert.deepEqual((await call('GET', 'me', { key: m.u.key, e })).json.wikibidous.n, 488);
  let lv = live();
  assert.deepEqual(lv.deals.map((x) => [x.a, x.ask, x.bid, x.lead]), [['m1', 12, true, true]]);
  assert.deepEqual(lv.bids.map((x) => [x.a, x.id, x.t, x.r, x.mine, x.cur, x.lead, x.st, x.cote]), [['m1', 'w1', 'Voulue 1', 'R', 12, 12, true, 'run', 80]]);
  assert.equal(e.DB.sqlite.prepare('SELECT live_at FROM market WHERE user_id = ?').get(m.id).live_at, liveAt, "l'heure reste celle de la lecture");
  // Tu mènes déjà : rien ne part au-delà de la lecture.
  supa.calls = [];
  r = await bid('m1', 20);
  assert.deepEqual([r.status, r.json.lead, site()], [409, true, ['GET /api/marketplace/m1']]);

  // Après une mise d'un autre : au moins un W de plus ; mise hors de la lecture du marché : ajoutée à « Tes mises ».
  r = await bid('m2', 40);
  assert.deepEqual([r.status, r.json.min, r.json.cur], [409, 41, 40]);
  r = await bid('m2', 41);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(live().bids.map((x) => [x.a, x.t, x.mine, x.lead]), [['m2', 'Voulue 1', 41, true], ['m1', 'Voulue 1', 12, true]]);

  // Finie, inconnue, ta vente.
  supa.calls = [];
  r = await bid('m3', 10);
  assert.deepEqual([r.status, r.json.gone, site()], [409, true, ['GET /api/marketplace/m3']]);
  assert.deepEqual([(await bid('nulle-part', 10)).json.gone, (await bid('m4', 10)).status], [true, 403]);

  // Refus du jeu (solde) : son message ; vérification anti-robot : verify ; panne : à vérifier dans le jeu.
  addAuctions(auction('m5', { base_amount: 1000 }));
  r = await bid('m5', 1000);
  assert.equal(r.status, 409);
  assert.match(r.json.error, /Solde insuffisant/);
  supa.bidReply = () => ({ status: 403, body: { code: 'human_verification_required', error: 'Vérification requise' } });
  r = await bid('m5', 1000);
  assert.deepEqual([r.status, r.json.verify], [409, true]);
  supa.bidReply = () => ({ network: true });
  r = await bid('m5', 1000);
  assert.equal(r.status, 502);
  assert.match(r.json.error, /regarde dans le jeu/);
  supa.bidReply = null;

  // Le jeu limite : pause de 10 min des routes du marché, plus rien ne part.
  e.DB.sqlite.prepare('DELETE FROM game_reads').run();
  supa.siteLimit = 'automation_limit';
  r = await bid('m5', 1000);
  assert.deepEqual([r.status, r.json.limited], [429, true]);
  supa.siteLimit = null;
  supa.calls = [];
  assert.deepEqual([(await bid('m5', 1000)).json.limited, site()], [true, []]);

  // Sans lecture du marché gardée : la mise passe quand même.
  e.DB.sqlite.prepare('DELETE FROM game_reads').run();
  e.DB.sqlite.prepare('DELETE FROM market WHERE user_id = ?').run(m.id);
  me.wikibidous = 5000;
  assert.equal((await bid('m5', 1000)).status, 200);

  // Sans compte relié : 401 needs_link, rien ne part.
  const n = await signup('Iris', e);
  supa.calls = [];
  r = await call('POST', 'market/bid', { key: n.key, e, body: { a: 'm1', amount: 50 } });
  assert.deepEqual([r.status, r.json.needs_link, site()], [401, true, []]);
  clearMarketGame();
  supa.reset();
  e.DB.close();
});

await test('DELETE /api/me efface tout', async () => {
  await call('POST', 'targets/save', { key: alice.key, body: { name: 'À effacer', items: [] } });
  env.DB.sqlite.prepare("INSERT INTO refresh_staging (user_id, page, entries, created_at) VALUES (?, 0, '[]', ?)").run(alice.user.id, new Date().toISOString());
  assert.ok(rows('SELECT COUNT(*) AS n FROM cards_gone WHERE user_id = ?', alice.user.id)[0].n > 0, 'des cartes retirées à effacer');
  const r = await call('DELETE', 'me', { key: alice.key });
  assert.deepEqual(r.json, { ok: true });
  for (const t of ['cards', 'cards_gone', 'tags', 'targets', 'refresh_staging', 'sync_log', 'market', 'value_history', 'game_reads']) {
    assert.equal(rows(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`, alice.user.id)[0].n, 0, t);
  }
  assert.equal(rows('SELECT COUNT(*) AS n FROM users WHERE id = ?', alice.user.id)[0].n, 0);
  assert.equal((await call('GET', 'me', { key: alice.key })).status, 401);
  assert.equal((await call('GET', 'me', { key: bob.key })).status, 200, 'les autres comptes restent');
});

supa.restore();
console.log(`${results.length} tests`);
console.log('API OK');
