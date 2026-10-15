// Test du favori de bout en bout : le vrai site/public/assets/bookmarklet.js (mis sur une ligne comme le fait
// l'interface), le vrai serveur (onRequest, D1 simulée en mémoire) et un jeu simulé dont la collection change d'une
// synchro à l'autre : lecture complète, synchro rapide (seulement les nouveautés), rien de nouveau, carte partie.
//   node dev/bookmarklet.test.mjs      → doit finir par « FAVORI OK »

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createD1 } from './d1.mjs';

const require = createRequire(import.meta.url);
const { makeDom } = require('./ui/fakedom.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const { onRequest } = await import(pathToFileURL(path.join(root, 'site', 'functions', 'api', '[[path]].js')).href);

const SITE = 'https://classeur.example';
const env = { DB: createD1(':memory:'), COOKIE_SECRET: 'secret-de-test', SIGNUP_CODE: 'invitation' };

async function api(method, route, { body, key, origin } = {}) {
  const headers = new Headers();
  if (key) headers.set('x-classeur-key', key);
  if (origin) headers.set('origin', origin);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const request = new Request(`${SITE}/api/${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await onRequest({ request, env, params: {}, waitUntil() {} });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

// Le compte et la clé d'import du favori.
const account = (await api('POST', 'account', { body: { code: 'invitation', name: 'Test' } })).json;
const importKey = (await api('POST', 'import-key', { key: account.key })).json.import_key;
assert.ok(importKey);
const cardsOf = async () => (await api('GET', 'cards', { key: account.key })).json.cards;

// Jeu simulé : une entrée par exemplaire ; sort=rarity rend l'ordre d'origine, sort=added du plus récent au plus ancien.
let collection = [];
let gameCalls = [];
const at = (h) => new Date(Date.UTC(2026, 9, 1) + h * 3600_000).toISOString();
const entry = (n, hour, extra = {}) => ({
  id: `e${n}`, card_id: `c${n}`, count: 1, is_shiny: false, starred: false, obtained_at: at(hour), user_id: 'SECRET', tags: [],
  card: { id: `c${n}`, wikipedia_title: `Carte ${n}`, rarity: 'C', atk: 10, def: 10, q_score: 1, pageviews: 100, category: 'essai', image_url: null, hide_image: false, wikipedia_url: null },
  ...extra,
});
const reply = (data) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(data)) });
function gameFetch(url) {
  gameCalls.push(url);
  if (url === '/api/my-collection/stats?sort=rarity') {
    return reply({ total: collection.length, totalUnique: new Set(collection.map((e) => e.card_id)).size, rarityCounts: {}, tagOptions: [] });
  }
  const m = url.match(/^\/api\/my-collection\?sort=(rarity|added)&page=(\d+)&stats=0$/);
  if (!m) throw new Error('jeu : adresse inattendue ' + url);
  const list = m[1] === 'added' ? [...collection].sort((a, b) => (a.obtained_at < b.obtained_at ? 1 : a.obtained_at > b.obtained_at ? -1 : 0)) : collection;
  const p = Number(m[2]);
  return reply({ collection: list.slice(p * 50, p * 50 + 50) });
}

// Le favori tel qu'installé : une ligne, adresse du classeur et clé d'import en place (comme makeBookmarklet).
const src = await readFile(path.join(root, 'site', 'public', 'assets', 'bookmarklet.js'), 'utf8');
const code = src.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join(' ')
  .replace('"__SITE__"', JSON.stringify(SITE)).replace('"__KEY__"', JSON.stringify(importKey));

// Un clic sur le favori, dans une nouvelle page wiki-masters.com ; rend le message final et les messages vus.
async function click() {
  const { doc } = makeDom();
  gameCalls = [];
  const posts = [];
  const seen = [];
  const pageFetch = async (url, init = {}) => {
    if (url === SITE + '/api/import') {
      assert.equal(init.headers['X-Classeur-Key'], importKey);
      const body = JSON.parse(init.body);
      posts.push(body);
      const r = await api('POST', 'import', { body, key: importKey, origin: 'https://www.wiki-masters.com' });
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
    }
    return gameFetch(url);
  };
  const ctx = { document: doc, location: { hostname: 'www.wiki-masters.com' }, fetch: pageFetch, setTimeout: (f) => setImmediate(f), Promise, JSON, Math, Date, Number, String, Array, Object, Error, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const box = () => doc.getElementById('classeur-favori').textContent.replace(/[  ]/g, ' ');
  for (let i = 0; i < 2000; i++) {
    const t = box();
    if (!seen.includes(t)) seen.push(t);
    if (!ctx.__classeurFavori && i > 0) break;
    await new Promise((r) => setImmediate(r));
  }
  return { text: box(), seen: seen.join(' | '), posts };
}

const results = [];
async function test(name, fn) {
  await fn();
  results.push(name);
  console.log(`ok  ${name}`);
}

await test('première fois : lecture complète triée par rareté, date du plus récent exemplaire envoyée', async () => {
  collection = Array.from({ length: 120 }, (_, i) => entry(i, i));
  const r = await click();
  assert.match(r.text, /120 cartes envoyées au classeur/, r.seen);
  assert.deepEqual(gameCalls, ['/api/my-collection/stats?sort=rarity', ...[0, 1, 2].map((p) => `/api/my-collection?sort=rarity&page=${p}&stats=0`)]);
  assert.equal(r.posts[0].mode, 'state');
  assert.equal(r.posts[1].last_at, at(119));
  assert.equal((await cardsOf()).length, 120);
});

await test('synchro rapide : seulement les nouveautés (une page triée par date), additionnées', async () => {
  collection.push(entry(200, 300), entry(201, 301), entry(5, 302, { id: 'e5-bis' }));
  const r = await click();
  assert.match(r.text, /3 exemplaires obtenus depuis ta dernière synchro, 2 nouvelles cartes : ton classeur est à jour \(122 cartes\)/, r.seen);
  assert.deepEqual(gameCalls, ['/api/my-collection/stats?sort=rarity', '/api/my-collection?sort=added&page=0&stats=0']);
  const delta = r.posts.find((b) => b.mode === 'delta');
  assert.deepEqual([delta.rows, delta.copies, delta.cards.length, delta.last_at], [3, 3, 3, at(302)]);
  const cards = await cardsOf();
  assert.equal(cards.length, 122);
  assert.equal(cards.find((c) => c.id === 'c5').count, 2);
});

await test('rien de nouveau : deux requêtes au jeu, classeur inchangé', async () => {
  const r = await click();
  assert.match(r.text, /Rien de nouveau depuis ta dernière synchro : ton classeur est à jour \(122 cartes\)/, r.seen);
  assert.deepEqual(gameCalls, ['/api/my-collection/stats?sort=rarity', '/api/my-collection?sort=added&page=0&stats=0']);
});

await test('une carte vendue : compteurs du jeu en désaccord → relecture complète aussitôt', async () => {
  collection = collection.filter((e) => e.card_id !== 'c7');
  collection.push(entry(202, 400));
  const r = await click();
  assert.match(r.seen, /Des cartes ont bougé/);
  assert.match(r.text, /122 cartes envoyées au classeur, 1 nouvelle/, r.seen);
  assert.ok(gameCalls.includes('/api/my-collection?sort=added&page=0&stats=0') && gameCalls.includes('/api/my-collection?sort=rarity&page=0&stats=0'));
  const cards = await cardsOf();
  assert.ok(!cards.some((c) => c.id === 'c7'));
  assert.ok(cards.some((c) => c.id === 'c202'));
});

await test('plus de 10 pages de nouveautés : relecture complète', async () => {
  for (let i = 0; i < 520; i++) collection.push(entry(1000 + i, 500 + i));
  const r = await click();
  assert.match(r.seen, /Beaucoup de nouveautés/);
  assert.match(r.text, /642 cartes envoyées au classeur, 520 nouvelles/, r.seen);
  assert.equal(gameCalls.filter((u) => u.includes('sort=added')).length, 10);
  // Puis de nouveau rapide.
  collection.push(entry(5000, 2000));
  const again = await click();
  assert.match(again.text, /1 exemplaire obtenu depuis ta dernière synchro, 1 nouvelle carte/, again.seen);
});

console.log(`${results.length} tests`);
console.log('FAVORI OK');
