// Test du favori de bout en bout : le vrai site/public/assets/bookmarklet.js (mis sur une ligne comme le fait
// l'interface), le vrai serveur (onRequest, D1 simulée en mémoire) et un jeu simulé dont la collection change d'une
// synchro à l'autre : lecture complète, synchro rapide (seulement les nouveautés), rien de nouveau, carte partie, et
// les cas où la synchro rapide doit céder la place à une relecture complète (avec la raison affichée).
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

// Le favori tel qu'installé : une ligne, adresse du classeur et clé d'import en place (comme makeBookmarklet).
const src = await readFile(path.join(root, 'site', 'public', 'assets', 'bookmarklet.js'), 'utf8');
const oneLine = (key) => src.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join(' ')
  .replace('"__SITE__"', JSON.stringify(SITE)).replace('"__KEY__"', JSON.stringify(key));

// Un compte neuf, sa clé d'import et son favori (chaque scénario indépendant repart de là).
let account;
let importKey;
let code;
async function newAccount() {
  account = (await api('POST', 'account', { body: { code: 'invitation', name: 'Test' } })).json;
  importKey = (await api('POST', 'import-key', { key: account.key })).json.import_key;
  assert.ok(importKey);
  code = oneLine(importKey);
}
await newAccount();
const cardsOf = async () => (await api('GET', 'cards', { key: account.key })).json.cards;
const cardOf = async (id) => (await cardsOf()).find((c) => c.id === id);

// Jeu simulé : une entrée par ligne ; sort=rarity rend l'ordre d'origine, sort=added du plus récent au plus ancien.
// game.total : `total` compte les lignes ('rows') ou les exemplaires ('copies') ; game.rc : rarityCounts rempli (dans la
// même unité) ; game.added : 'desc' (attendu) ou 'asc' ; game.fault(sort, page, liste) peut remplacer une page ;
// game.status(url) peut rendre une réponse en erreur.
let collection = [];
let gameCalls = [];
const game = {};
const resetGame = () => Object.assign(game, { total: 'rows', rc: false, added: 'desc', fault: null, status: null });
resetGame();
const at = (h) => new Date(Date.UTC(2026, 9, 1) + h * 3600_000).toISOString();
const entry = (n, hour, extra = {}, card = {}) => ({
  id: `e${n}`, card_id: `c${n}`, count: 1, is_shiny: false, starred: false, obtained_at: at(hour), user_id: 'SECRET', tags: [],
  ...extra,
  card: { id: `c${n}`, wikipedia_title: `Carte ${n}`, rarity: 'C', atk: 10, def: 10, q_score: 1, pageviews: 100, category: 'essai', image_url: null, hide_image: false, wikipedia_url: null, ...card },
});
const reply = (data, status = 200) => ({ ok: status < 300, status, json: async () => JSON.parse(JSON.stringify(data)) });
function gameFetch(url) {
  gameCalls.push(url);
  const failed = game.status && game.status(url);
  if (failed) return failed;
  const weight = (e) => (game.total === 'rows' ? 1 : e.count);
  if (url === '/api/my-collection/stats?sort=rarity') {
    const rarityCounts = {};
    if (game.rc) for (const e of collection) rarityCounts[e.card.rarity] = (rarityCounts[e.card.rarity] || 0) + weight(e);
    return reply({ total: collection.reduce((s, e) => s + weight(e), 0), totalUnique: new Set(collection.map((e) => e.card_id)).size, rarityCounts, tagOptions: [] });
  }
  const m = url.match(/^\/api\/my-collection\?sort=(rarity|added)&page=(\d+)&stats=0$/);
  if (!m) throw new Error('jeu : adresse inattendue ' + url);
  let list = collection;
  if (m[1] === 'added') {
    list = [...collection].sort((a, b) => (a.obtained_at < b.obtained_at ? 1 : a.obtained_at > b.obtained_at ? -1 : 0));
    if (game.added === 'asc') list.reverse();
  }
  const p = Number(m[2]);
  let page = list.slice(p * 50, p * 50 + 50);
  const forced = game.fault ? game.fault(m[1], p, page, list) : undefined;
  if (forced !== undefined) page = forced; // null : réponse sans liste
  return reply(page === null ? {} : { collection: page });
}

// Un clic sur le favori, dans une nouvelle page wiki-masters.com ; rend le message final et les messages vus.
async function click() {
  const { doc } = makeDom();
  const key = importKey;
  const calls = [];
  const posts = [];
  const seen = [];
  const pageFetch = async (url, init = {}) => {
    if (url === SITE + '/api/import') {
      assert.equal(init.headers['X-Classeur-Key'], key);
      const body = JSON.parse(init.body);
      posts.push(body);
      const r = await api('POST', 'import', { body, key, origin: 'https://www.wiki-masters.com' });
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
    }
    calls.push(url);
    return gameFetch(url);
  };
  const ctx = { document: doc, location: { hostname: 'www.wiki-masters.com' }, fetch: pageFetch, setTimeout: (f) => setImmediate(f), Promise, JSON, Math, Date, Number, String, Array, Object, Error, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const box = () => doc.getElementById('classeur-favori').textContent.replace(/[  ]/g, ' ');
  for (let i = 0; i < 20000; i++) {
    const t = box();
    if (!seen.includes(t)) seen.push(t);
    if (!ctx.__classeurFavori && i > 0) break;
    await new Promise((r) => setImmediate(r));
  }
  gameCalls = calls;
  return { text: box(), seen: seen.join(' | '), posts, calls };
}
const fullRead = (r) => r.calls.includes('/api/my-collection?sort=rarity&page=0&stats=0');

const results = [];
async function test(name, fn) {
  try {
    await fn();
  } finally {
    resetGame();
  }
  results.push(name);
  console.log(`ok  ${name}`);
}
// Scénario indépendant : compte neuf, 60 cartes lues une première fois (lecture complète).
async function fresh60() {
  await newAccount();
  collection = Array.from({ length: 60 }, (_, i) => entry(i, i));
  const r = await click();
  assert.match(r.text, /60 cartes envoyées au classeur/, r.seen);
}

await test('première fois : lecture complète triée par rareté, date du plus récent exemplaire et exemplaires lus envoyés', async () => {
  collection = Array.from({ length: 120 }, (_, i) => entry(i, i));
  const r = await click();
  assert.match(r.text, /120 cartes envoyées au classeur/, r.seen);
  assert.deepEqual(gameCalls, ['/api/my-collection/stats?sort=rarity', ...[0, 1, 2].map((p) => `/api/my-collection?sort=rarity&page=${p}&stats=0`)]);
  assert.equal(r.posts[0].mode, 'state');
  assert.deepEqual([r.posts[1].last_at, r.posts[1].rows, r.posts[1].copies, r.posts[1].ignored], [at(119), 120, 120, 0]);
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

await test('une carte vendue : compteurs du jeu en désaccord → relecture complète aussitôt, raison affichée', async () => {
  collection = collection.filter((e) => e.card_id !== 'c7');
  collection.push(entry(202, 400));
  const r = await click();
  assert.match(r.seen, /Les compteurs du jeu ne collent pas avec tes nouveautés \(carte vendue/);
  assert.match(r.text, /122 cartes envoyées au classeur, 1 nouvelle/, r.seen);
  assert.ok(gameCalls.includes('/api/my-collection?sort=added&page=0&stats=0') && fullRead(r));
  const cards = await cardsOf();
  assert.ok(!cards.some((c) => c.id === 'c7'));
  assert.ok(cards.some((c) => c.id === 'c202'));
});

await test('plus de 10 pages de nouveautés : relecture complète', async () => {
  for (let i = 0; i < 520; i++) collection.push(entry(1000 + i, 500 + i));
  const r = await click();
  assert.match(r.seen, /Plus de 500 exemplaires obtenus depuis ta dernière synchro : relecture complète/);
  assert.match(r.text, /642 cartes envoyées au classeur, 520 nouvelles/, r.seen);
  assert.equal(gameCalls.filter((u) => u.includes('sort=added')).length, 10);
  // Puis de nouveau rapide.
  collection.push(entry(5000, 2000));
  const again = await click();
  assert.match(again.text, /1 exemplaire obtenu depuis ta dernière synchro, 1 nouvelle carte/, again.seen);
});

await test('favori périmé (clé d\'import remplacée) : arrêt dès la demande d\'état, sans lire la collection', async () => {
  await api('POST', 'import-key', { key: account.key });
  const r = await click();
  assert.match(r.text, /Favori périmé/, r.seen);
  assert.deepEqual(r.calls, ['/api/my-collection/stats?sort=rarity']);
  assert.deepEqual(r.posts.map((b) => b.mode), ['state']);
});

await test('limite de lectures automatiques du jeu (403 « automation_limit ») : message à part, pas « Connecte-toi »', async () => {
  await fresh60();
  collection.push(entry(900, 500));
  game.status = (url) => (url.includes('sort=added') ? reply({ code: 'automation_limit', error: 'Trop de requêtes' }, 403) : null);
  let r = await click();
  assert.match(r.text, /Le jeu limite les lectures automatiques : réessaie plus tard/, r.seen);
  assert.ok(!/Connecte-toi/.test(r.seen) && !fullRead(r), 'pas de relecture complète derrière');
  // Pendant une lecture complète (compte neuf : rien d'armé).
  await newAccount();
  collection = Array.from({ length: 120 }, (_, i) => entry(i, i));
  game.status = (url) => (url.includes('sort=rarity&page=1') ? reply({ code: 'automation_limit' }, 403) : null);
  r = await click();
  assert.match(r.text, /Le jeu limite les lectures automatiques/, r.seen);
  // Un vrai refus de session reste « Connecte-toi ».
  game.status = (url) => (url.includes('stats') ? reply({ error: 'Unauthorized' }, 401) : null);
  r = await click();
  assert.match(r.text, /Connecte-toi à WikiMasters/, r.seen);
});

await test('tri par date en erreur, ou ignoré (ordre croissant) : relecture complète avec la bonne raison', async () => {
  await fresh60();
  collection.push(entry(900, 500));
  game.status = (url) => (url.includes('sort=added') ? reply({ error: 'tri inconnu' }, 400) : null);
  let r = await click();
  assert.match(r.seen, /Le tri par date du jeu n'a pas répondu : relecture complète/);
  assert.match(r.text, /61 cartes envoyées au classeur, 1 nouvelle/, r.seen);
  game.status = null;
  game.added = 'asc';
  collection.push(entry(901, 501));
  r = await click();
  assert.match(r.seen, /Le jeu n'a pas rangé ta collection par date comme prévu/);
  assert.ok(!/n'est plus dans ta collection|compteurs/.test(r.seen), r.seen);
  assert.match(r.text, /62 cartes envoyées au classeur, 1 nouvelle/, r.seen);
});

await test('la carte la plus récente de la dernière synchro est partie (échange contre une carte datée d\'avant) : relecture complète', async () => {
  await fresh60();
  // Compteurs identiques (une ligne de même rareté pour une autre) : seule l'absence de la plus récente le trahit.
  collection = [...collection.filter((e) => e.card_id !== 'c59'), entry(900, 5)];
  const r = await click();
  assert.match(r.seen, /La carte la plus récente de ta dernière synchro n'est plus dans ta collection/);
  assert.ok(!(await cardOf('c59')) && (await cardOf('c900')));
});

await test('lecture complète incomplète (page vide passagère, pagination instable) : pas armée, le clic suivant relit tout', async () => {
  for (const fault of [
    (sort, p) => (sort === 'rarity' && p === 1 ? [] : undefined),
    (sort, p, page, list) => (sort === 'rarity' && p === 1 ? list.slice(49, 99) : undefined),
  ]) {
    await newAccount();
    collection = Array.from({ length: 120 }, (_, i) => entry(i, 119 - i)); // le plus récent en tête du tri par rareté
    await click();
    collection = collection.filter((e) => e.card_id !== 'c70'); // une vente → relecture complète
    let once = true;
    game.fault = (...a) => {
      const out = once ? fault(...a) : undefined;
      if (out !== undefined) once = false;
      return out;
    };
    let r = await click();
    assert.match(r.text, /Il en manque par rapport au total du jeu/, r.seen);
    game.fault = null;
    r = await click();
    assert.ok(fullRead(r) && !/Rien de nouveau/.test(r.text), r.seen);
    assert.match(r.text, /119 cartes envoyées au classeur/, r.seen);
    assert.equal((await cardsOf()).length, 119);
    r = await click();
    assert.match(r.text, /Rien de nouveau/, r.seen);
  }
});

await test('réponse sans liste pendant la lecture complète : erreur, rien n\'est envoyé', async () => {
  await newAccount();
  collection = Array.from({ length: 120 }, (_, i) => entry(i, i));
  game.fault = (sort, p) => (p === 1 ? null : undefined);
  const r = await click();
  assert.match(r.text, /Réponse inattendue de WikiMasters \(pas de liste de cartes\)/, r.seen);
  assert.deepEqual(r.posts.map((b) => b.mode), ['state']);
});

await test('carte invalide : message honnête (relancer n\'y change rien), puis synchro rapide', async () => {
  await fresh60();
  collection.push(entry(900, 500, {}, { rarity: 'M' }));
  let r = await click();
  assert.match(r.seen, /Une de tes nouvelles cartes ne peut pas être rangée dans le classeur : relecture complète/);
  assert.match(r.text, /60 cartes envoyées au classeur, 0 nouvelle\. 1 carte ignorée \(sans titre ou rareté inconnue du classeur\) : elle reste dans le jeu/, r.seen);
  assert.ok(!/relance/.test(r.text), r.text);
  r = await click();
  assert.match(r.text, /Rien de nouveau depuis ta dernière synchro : ton classeur est à jour \(60 cartes\)/, r.seen);
});

await test('deux favoris en même temps (deux onglets) : chaque nouveauté comptée une fois', async () => {
  await fresh60();
  collection.push(entry(900, 500), entry(3, 501, { id: 'e3-bis' }));
  const batch = env.DB.batch.bind(env.DB);
  env.DB.batch = async (sts) => { await new Promise((r) => setTimeout(r, 5)); return batch(sts); };
  try {
    const [a, b] = await Promise.all([click(), click()]);
    const race = [a, b].some((r) => /Une autre synchro est passée en même temps/.test(r.seen));
    console.log(`    deux clics : « ${a.text.slice(11, 70)}… » / « ${b.text.slice(11, 70)}… »${race ? ' (course détectée)' : ''}`);
  } finally {
    env.DB.batch = batch;
  }
  assert.deepEqual([(await cardOf('c900')).count, (await cardOf('c3')).count], [1, 2]);
});

await test('pile : exemplaire ajouté à une ligne avec sa date remise à neuf, total = exemplaires → relecture complète, classeur juste', async () => {
  await newAccount();
  game.total = 'copies';
  collection = Array.from({ length: 60 }, (_, i) => entry(i, i));
  await click();
  const row = collection.find((e) => e.card_id === 'c3');
  Object.assign(row, { count: 2, obtained_at: at(500) });
  const r = await click();
  assert.ok(fullRead(r), r.seen);
  assert.equal((await cardOf('c3')).count, 2);
});

await test('rareté : une carte possédée en plusieurs raretés garde la plus haute (lecture complète et synchro rapide)', async () => {
  await newAccount();
  collection = [entry(1, 1, {}, { rarity: 'L' }), entry(1, 2, { id: 'e1-r' }, { rarity: 'R' }), entry(2, 3, {}, { rarity: 'UR' }),
    entry(2, 4, { id: 'e2-l' }, { rarity: 'L' }), ...Array.from({ length: 10 }, (_, i) => entry(10 + i, 10 + i, {}, { rarity: 'R' }))];
  let r = await click();
  assert.equal(r.posts[1].cards.find((c) => c.id === 'c1').rarity, 'L', 'favori : rareté la plus haute envoyée');
  assert.deepEqual([(await cardOf('c1')).rarity, (await cardOf('c2')).rarity], ['L', 'L']);
  collection.push(entry(10, 100, { id: 'e10-sr' }, { rarity: 'SR' }));
  r = await click();
  assert.match(r.text, /1 exemplaire obtenu/, r.seen);
  assert.deepEqual([(await cardOf('c10')).rarity, (await cardOf('c10')).count], ['SR', 2]);
});

await test('échange 1 contre 1 entre raretés différentes, carte reçue datée d\'avant : rarityCounts le voit', async () => {
  await newAccount();
  game.rc = true;
  collection = Array.from({ length: 60 }, (_, i) => entry(i, i));
  await click();
  collection = [...collection.filter((e) => e.card_id !== 'c10'), entry(900, 5, {}, { rarity: 'SR' })];
  const r = await click();
  assert.match(r.seen, /Les compteurs du jeu ne collent pas/, r.seen);
  assert.ok(!(await cardOf('c10')) && (await cardOf('c900')).rarity === 'SR');
});

// --- Page « Collection globale » du jeu : créer une collection du classeur avec la recherche affichée --------------

// Catalogue simulé du jeu, GET /api/cards?page=N&q=…&sort=name (format relevé dans le code d'extensions tierces, voir
// SPEC.md) : search.pageSize cartes par page (50 dans le jeu), searchHasMore ; search.format(page, réponse) peut la
// remplacer (format inconnu).
const search = {};
const resetSearch = () => Object.assign(search, { pageSize: 50, format: null });
resetSearch();
let catalogue = [];
const RARS = ['C', 'PC', 'R', 'SR', 'UR', 'L'];
const globalCard = (i, title) => ({ id: `g${i}`, wikipedia_title: title, rarity: RARS[i % 6], atk: 10, def: 10, q_score: 1, pageviews: 100,
  category: i % 2 ? 'race bovine' : null, image_url: i % 3 ? null : `https://upload.wikimedia.org/g${i}.jpg`, hide_image: i === 3,
  wikipedia_url: `https://fr.wikipedia.org/wiki/G${i}`, summary: 'résumé', created_at: 'x' });
const vaches = () => [
  ...Array.from({ length: 87 }, (_, i) => globalCard(i, `Vache ${String(i).padStart(2, '0')}`)),
  ...Array.from({ length: 30 }, (_, i) => globalCard(100 + i, `Mouton ${i}`)),
];
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function searchFetch(url) {
  const u = new URL(url, 'https://www.wiki-masters.com');
  if (u.pathname !== '/api/cards') return gameFetch(url);
  const q = fold(u.searchParams.get('q') || '');
  const p = Number(u.searchParams.get('page'));
  const found = catalogue.filter((c) => fold(`${c.wikipedia_title} ${c.category || ''}`).includes(q))
    .sort((a, b) => a.wikipedia_title.localeCompare(b.wikipedia_title, 'fr'));
  const n = search.pageSize;
  let body = { cards: found.slice(p * n, (p + 1) * n), total: null, searchHasMore: (p + 1) * n < found.length, rarityCounts: {},
    friendOwners: {}, ownedCardIds: [], wishlistCardIds: [], friendPendingOfferKeys: [] };
  if (search.format) body = search.format(p, body);
  return reply(body);
}

// Le favori cliqué sur /global-collection. field : valeur d'un champ de recherche de la page (placeholder du jeu par
// défaut), ou null ; address : partie « ?… » de l'adresse ; answers : réponses successives à prompt(). choose(texte) clique
// le choix qui commence par ce texte et attend la fin.
async function openGlobal({ field = null, placeholder = 'Rechercher par titre ou catégorie...', address = '', answers = [] } = {}) {
  const { doc } = makeDom();
  const key = importKey;
  const calls = [];
  const posts = [];
  const prompts = [];
  const delays = [];
  if (field !== null) {
    const main = doc.createElement('main');
    const input = doc.createElement('input');
    input.setAttribute('placeholder', placeholder);
    input.value = field;
    main.appendChild(input);
    doc.body.appendChild(main);
  }
  const pageFetch = async (url, init = {}) => {
    if (url.startsWith(SITE + '/api/')) {
      assert.equal(init.headers['X-Classeur-Key'], key);
      const route = url.slice(SITE.length + 5);
      const body = JSON.parse(init.body);
      posts.push({ route, body });
      const r = await api('POST', route, { body, key, origin: 'https://www.wiki-masters.com' });
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
    }
    calls.push(url);
    return searchFetch(url);
  };
  const ctx = { document: doc, location: { hostname: 'www.wiki-masters.com', pathname: '/global-collection', search: address }, fetch: pageFetch,
    setTimeout: (f, ms) => { delays.push(ms); setImmediate(f); },
    prompt: (message, value) => { prompts.push([message, value]); return answers.length ? answers.shift() : null; },
    URLSearchParams, Promise, JSON, Math, Date, Number, String, Array, Object, Error, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const boxEl = () => doc.getElementById('classeur-favori');
  const text = () => boxEl().textContent.replace(/[  ]/g, ' ');
  const choices = () => boxEl().querySelectorAll('button').map((b) => b.textContent).filter((t) => t !== 'Fermer');
  const choose = async (label) => {
    const b = boxEl().querySelectorAll('button').find((x) => x.textContent.startsWith(label));
    assert.ok(b, `choix « ${label} » absent : ${choices().join(' | ')}`);
    const seen = [];
    b.click();
    for (let i = 0; i < 20000; i++) {
      const t = text();
      if (!seen.includes(t)) seen.push(t);
      if (!ctx.__classeurFavori) break;
      await new Promise((r) => setImmediate(r));
    }
    return { text: text(), seen: seen.join(' | ') };
  };
  return { calls, posts, prompts, delays, choices, choose, text };
}
const targetsOf = async () => (await api('GET', 'targets', { key: account.key })).json.targets;

await test('Collection globale : deux choix, recherche lue dans le champ, pages par nom, collection créée avec la rareté du jeu', async () => {
  await newAccount();
  resetSearch();
  catalogue = vaches();
  const g = await openGlobal({ field: 'vache', answers: ['Mes vaches'] });
  assert.deepEqual(g.choices(), ['Mettre à jour mon classeur', 'Créer une collection avec cette recherche (« vache »)']);
  assert.deepEqual(g.calls, [], 'rien n\'est lu avant un choix');
  const r = await g.choose('Créer une collection');
  assert.match(r.text, /Collection « Mes vaches » créée dans ton classeur : 87 cartes, avec leur rareté dans le jeu\./, r.seen);
  assert.match(r.text, /Ouvrir le classeur/);
  assert.match(r.seen, /Lecture de la recherche « vache »… 50 cartes/);
  assert.deepEqual(g.calls, [0, 1].map((p) => `/api/cards?page=${p}&q=vache&sort=name`));
  assert.ok(g.delays.includes(300), 'pause de 300 ms entre deux pages');
  assert.deepEqual(g.prompts.map((p) => p[1]), ['Vache'], 'nom proposé : la recherche avec une majuscule');
  assert.match(g.prompts[0][0], /87 cartes trouvées pour « vache »/);
  assert.deepEqual(g.posts.map((p) => p.route), ['targets/from-game']);
  const sent = g.posts[0].body;
  assert.deepEqual([sent.name, sent.query, sent.items.length], ['Mes vaches', 'vache', 87]);
  assert.deepEqual(Object.keys(sent.items[0]).sort(), ['card_id', 'category', 'image', 'rarity', 'title']);
  assert.ok(!JSON.stringify(sent).includes('résumé') && !JSON.stringify(sent).includes('wikipedia.org'), 'seulement les champs utiles');
  const [t] = await targetsOf();
  assert.deepEqual([t.name, t.source, t.items.length], ['Mes vaches', 'wm:vache', 87]);
  assert.deepEqual(t.items.slice(0, 4), [
    { title: 'Vache 00', description: null, image: 'https://upload.wikimedia.org/g0.jpg', status: 'ok', rarity: 'C' },
    { title: 'Vache 01', description: 'race bovine', image: null, status: 'ok', rarity: 'PC' },
    { title: 'Vache 02', description: null, image: null, status: 'ok', rarity: 'R' },
    { title: 'Vache 03', description: 'race bovine', image: null, status: 'ok', rarity: 'SR' }, // hide_image
  ]);
  assert.equal(t.items[86].title, 'Vache 86');
});

await test('Collection globale : recherche dans l\'adresse, sinon demandée (préremplie) ; annuler ; « Mettre à jour mon classeur » inchangé', async () => {
  await newAccount();
  resetSearch();
  catalogue = vaches();
  let g = await openGlobal({ address: '?q=mouton&sort=rarity', field: 'autre chose', answers: ['Moutons'] });
  assert.equal(g.choices()[1], 'Créer une collection avec cette recherche (« mouton »)');
  let r = await g.choose('Créer une collection');
  assert.match(r.text, /Collection « Moutons » créée dans ton classeur : 30 cartes/, r.seen);
  assert.deepEqual(g.calls, ['/api/cards?page=0&q=mouton&sort=name']);
  // Ni adresse ni champ du jeu reconnu : la recherche est demandée, préremplie avec ce qu'un champ de recherche contient.
  g = await openGlobal({ field: 'vach', placeholder: 'Search', answers: ['vache 1', 'Dix vaches'] });
  assert.equal(g.choices()[1], 'Créer une collection avec une recherche…');
  r = await g.choose('Créer une collection');
  assert.deepEqual(g.prompts.map((p) => p[1]), ['vach', 'Vache 1']);
  assert.match(r.text, /Collection « Dix vaches » créée dans ton classeur : 10 cartes/, r.seen);
  // Recherche ou nom annulés, recherche trop courte : rien n'est lu ni envoyé.
  for (const [answers, re, read] of [[[null], /Annulé : rien n'a été envoyé/, false], [['v'], /Recherche trop courte/, false], [['vache', null], /Annulé : rien n'a été envoyé/, true]]) {
    g = await openGlobal({ answers });
    r = await g.choose('Créer une collection');
    assert.match(r.text, re, r.seen);
    assert.deepEqual([g.calls.length > 0, g.posts], [read, []]);
  }
  assert.equal((await targetsOf()).length, 2);
  // « Mettre à jour mon classeur » : la synchro habituelle (my-collection, envoi à /api/import), rien de la recherche.
  collection = Array.from({ length: 60 }, (_, i) => entry(i, i));
  g = await openGlobal({ field: 'vache' });
  r = await g.choose('Mettre à jour mon classeur');
  assert.match(r.text, /60 cartes envoyées au classeur/, r.seen);
  assert.ok(g.posts.every((p) => p.route === 'import') && !g.calls.some((u) => u.startsWith('/api/cards')) && !g.prompts.length);
  assert.equal((await cardsOf()).length, 60);
  // Ailleurs dans le jeu (pas de pathname, comme les tests ci-dessus) : la synchro part aussitôt, sans choix.
});

await test('Collection globale : trop de résultats (20 pages, 3 000 cartes), aucun résultat, format inconnu → message clair, rien envoyé', async () => {
  await newAccount();
  resetSearch();
  catalogue = Array.from({ length: 1200 }, (_, i) => globalCard(i, `Article ${String(i).padStart(4, '0')}`));
  let g = await openGlobal({ field: 'article', answers: ['Trop'] });
  let r = await g.choose('Créer une collection');
  assert.match(r.text, /Trop de résultats .*précise ta recherche/, r.seen);
  assert.deepEqual([g.calls.length, g.posts, g.prompts], [20, [], []]);
  // Pages plus grandes : la limite de 3 000 cartes arrive avant celle des pages.
  search.pageSize = 200;
  catalogue = Array.from({ length: 3200 }, (_, i) => globalCard(i, `Article ${String(i).padStart(4, '0')}`));
  g = await openGlobal({ field: 'article', answers: ['Trop'] });
  r = await g.choose('Créer une collection');
  assert.match(r.text, /Trop de résultats .*précise ta recherche/, r.seen);
  assert.deepEqual([g.calls.length, g.posts, g.prompts], [16, [], []]);
  // Aucun résultat.
  resetSearch();
  g = await openGlobal({ field: 'licorne' });
  r = await g.choose('Créer une collection');
  assert.match(r.text, /Aucune carte ne correspond à « licorne » dans la Collection globale/, r.seen);
  assert.deepEqual([g.posts, g.prompts], [[], []]);
  // Une carte d'une rareté inconnue est seulement écartée (et annoncée).
  catalogue = vaches();
  catalogue[5].rarity = 'M';
  g = await openGlobal({ field: 'vache', answers: ['Vaches'] });
  r = await g.choose('Créer une collection');
  assert.match(r.text, /« Vaches » créée dans ton classeur : 86 cartes.* 1 carte écartée \(rareté inconnue du classeur\)/, r.seen);
  // Formats inconnus : message clair, rien n'est envoyé.
  catalogue = vaches();
  let first = null;
  for (const [format, re] of [
    [(p, b) => ({ results: b.cards }), /format inattendu \(pas de liste « cards »\)/],
    [() => 'pas un objet', /format inattendu \(pas de liste « cards »\)/],
    [(p, b) => ({ ...b, cards: b.cards.map((c) => ({ id: c.id, title: c.wikipedia_title, rarity: c.rarity })) }), /format inattendu \(carte sans « id » ou sans « wikipedia_title »\)/],
    [(p, b) => ({ ...b, cards: b.cards.map((c) => ({ ...c, rarity: 'common' })) }), /format inattendu \(aucune rareté connue/],
    [(p, b) => (p === 0 ? (first = b) : first), /format inattendu \(la page suivante redonne les mêmes cartes\)/],
  ]) {
    search.format = format;
    g = await openGlobal({ field: 'vache', answers: ['Vaches'] });
    r = await g.choose('Créer une collection');
    assert.match(r.text, re, r.seen);
    assert.match(r.text, /Rien n'a été envoyé au classeur/, r.seen);
    assert.deepEqual([g.posts, g.prompts], [[], []]);
  }
  resetSearch();
  assert.equal((await targetsOf()).length, 1);
});

console.log(`${results.length} tests`);
console.log('FAVORI OK');
