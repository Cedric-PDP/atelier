// Test du favori de bout en bout : le vrai site/public/assets/bookmarklet.js (mis sur une ligne comme le fait
// l'interface), le vrai serveur (onRequest, D1 simulée en mémoire) et un jeu simulé dont la collection change d'une
// synchro à l'autre : lecture complète, synchro rapide (seulement les nouveautés), rien de nouveau, carte partie, et
// les cas où la synchro rapide doit céder la place à une relecture complète (avec la raison affichée). Puis le mode
// relié : la page simulée fait ses propres requêtes (paquet, défausse, enchère, échange, lectures…) par window.fetch,
// horloge virtuelle ; réponses rendues telles quelles, synchro 5 s après une action, limites (aussi entre pages et
// onglets, et d'après full_at du classeur), « Arrêter » (même en pleine synchro), erreurs, classeur en panne.
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
const GAME = 'https://www.wiki-masters.com';
const env ={ DB: createD1(':memory:'), COOKIE_SECRET: 'secret-de-test', SIGNUP_CODE: 'invitation' };

// Horloge virtuelle, la même pour le serveur et pour les pages simulées du mode relié (openGame) : Date est remplacée
// dans tout le processus (le serveur date full_at, le favori le compare à son heure) et n'avance que par advance().
// clock.timers : minuteries (setTimeout) des pages ouvertes ; clock.pages : pages en vie (une page déchargée, par un
// rechargement, ne déclenche plus rien).
const RealDate = Date;
const clock = { now: RealDate.UTC(2026, 9, 16, 10, 0, 0), timers: [], seq: 0, busy: 0, ticks: 0, pages: [] };
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [clock.now])); }
  static now() { return clock.now; }
};

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
const oneLine = (key, start) => src.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join(' ')
  .replace('"__SITE__"', JSON.stringify(SITE)).replace('"__KEY__"', JSON.stringify(key))
  .replace('"__START__"', JSON.stringify(start || '__START__')); // "load" : script Tampermonkey (makeUserscript)

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
// Mode relié (openGame) : game.offline (échec réseau), game.weird(res) (réponse altérée), game.packRefused (429) ; et
// le classeur : game.siteDown (injoignable), game.siteStatus(body, route) (statut d'erreur rendu à la place du serveur).
const resetGame = () => Object.assign(game, { total: 'rows', rc: false, added: 'desc', fault: null, status: null, offline: false, weird: null, packRefused: false, auctioned: null, siteDown: false, siteStatus: null });
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
  // Adresse complète et URL : le favori se met en mode relié (sans action de la page ici, il ne relit rien de plus).
  const ctx = { document: doc, location: { hostname: 'www.wiki-masters.com', origin: GAME, href: GAME + '/collection', pathname: '/collection', search: '' }, fetch: pageFetch,
    setTimeout: (f) => setImmediate(f), URL, Promise, JSON, Math, Date, Number, String, Array, Object, Error, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  assert.equal(typeof ctx.__classeurRelie?.stop, 'function', 'mode relié attendu');
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

await test('favori périmé (clé d\'import remplacée) : arrêt dès la demande d\'état, avant toute lecture du jeu', async () => {
  await api('POST', 'import-key', { key: account.key });
  const r = await click();
  assert.match(r.text, /Favori périmé.*remplace le favori de ta barre/, r.seen);
  assert.deepEqual(r.calls, [], 'rien n\'est lu dans le jeu');
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

// --- Mode relié : le favori reste dans la page et regarde passer les requêtes que la page du jeu fait elle-même -------

// localStorage simulé (keys() : clés écrites).
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => { m.set(String(k), String(v)); }, removeItem: (k) => { m.delete(String(k)); }, keys: () => [...m.keys()] };
}
// Calme : plus d'envoi au classeur en cours, plus rien qui bouge pendant 40 tours de boucle.
async function idle() {
  for (let i = 0, still = 0, last = -1; i < 100000 && (clock.busy > 0 || still < 40); i++) {
    await new Promise((r) => setImmediate(r));
    if (clock.ticks === last) still += 1; else { still = 0; last = clock.ticks; }
  }
}
// Fait avancer l'horloge virtuelle de ms, en déclenchant dans l'ordre les minuteries échues de toutes les pages en vie.
async function advance(ms) {
  const end = clock.now + ms;
  await idle();
  for (;;) {
    clock.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
    if (!clock.timers.length || clock.timers[0].at > end) break;
    const t = clock.timers.shift();
    clock.now = Math.max(clock.now, t.at);
    if (t.page.alive) t.f();
    await idle();
  }
  clock.now = Math.max(clock.now, end);
  await idle();
}
// Réponse d'erreur du classeur simulée (game.siteStatus) ; 503 : le message du serveur (http.js) quand D1 est pleine.
const SITE_ERRORS = { 500: 'Erreur interne du serveur.', 503: 'La base du classeur est pleine ou a atteint son quota du jour : réessaie demain, ou préviens la personne qui le gère.' };

// Page du jeu simulée, sur l'horloge virtuelle (Date, setTimeout ; advance(ms) la fait avancer). fetch « du
// navigateur » (base) : les lectures du favori vont au jeu simulé (gameFetch, notées dans calls avec leur heure), ses
// envois au vrai serveur (sauf game.siteDown / game.siteStatus) ; les requêtes de la page (page(url, init), qui passe par
// window.fetch, donc par le favori) reçoivent de vraies Response et changent la collection comme le ferait le jeu.
// start : "click" (favori) ou "load" (script Tampermonkey). tab : true = un autre onglet (les pages ouvertes restent
// en vie) ; sinon les autres pages sont déchargées (rechargement). storage : le localStorage de la page (un neuf par
// défaut ; le même objet pour deux pages = le même navigateur ; null : absent ; 'refused' : accès refusé).
// onPost(body, route) : appelé à chaque envoi au classeur, avant sa réponse.
async function openGame({ start = 'click', pathname = '/collection', answers = [], tab = false, storage = memoryStorage(), onPost = null } = {}) {
  const { doc } = makeDom();
  if (!tab) {
    for (const p of clock.pages) p.alive = false;
    clock.pages = [];
    clock.timers = [];
  }
  const me = { alive: true };
  clock.pages.push(me);
  const key = importKey;
  const calls = [];
  const posts = [];
  const sent = []; // [promesse rendue par base, Response] de chaque requête de la page
  const thisOf = []; // this reçu par le fetch d'origine pour chaque requête de la page
  let fromPage = false;
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  // Ce que fait le jeu pour une requête de la page (sa collection change comme sur le vrai site) ; adresse et méthode
  // lues une seule fois, par base.
  function pageAnswer(url, method, init) {
    const u = new URL(url, GAME);
    if (game.offline) throw new TypeError('Failed to fetch');
    if (u.origin !== GAME) return new Response(null, { status: 204 }); // Supabase (étoile, étiquettes…)
    const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : {};
    const p = u.pathname;
    if (method === 'POST' && p === '/api/packs/open') {
      if (game.packRefused) return json({ error: 'Trop de paquets', rate_limited: true }, 429);
      const fresh = Array.from({ length: 5 }, () => {
        packSeq += 1;
        return entry(0, 0, { id: `pack-${packSeq}`, card_id: `pk${packSeq}`, obtained_at: new Date(clock.now).toISOString() }, { id: `pk${packSeq}`, wikipedia_title: `Paquet ${packSeq}` });
      });
      collection.push(...fresh);
      return json({ cards: fresh.map((e) => e.card), packs_remaining: 3, packs_last_regen_at: new Date(clock.now).toISOString(), owned_copies: fresh.map((e) => ({ id: e.id, card_id: e.card_id, is_shiny: false })) });
    }
    if (method === 'POST' && p === '/api/user-cards/bulk-discard') {
      const gone = collection.filter((e) => body.card_ids.includes(e.id));
      collection = collection.filter((e) => !body.card_ids.includes(e.id));
      return json({ balance: 100 + gone.length, discarded_count: gone.length, failed: [] });
    }
    if (method === 'POST' && p === '/api/marketplace') {
      const e = collection.find((x) => x.id === body.card_id);
      collection = collection.filter((x) => x !== e);
      game.auctioned = e;
      return json({ auction_id: 'a1' });
    }
    if (method === 'DELETE' && p === '/api/marketplace/a1') {
      collection.push({ ...game.auctioned, id: game.auctioned.id + '-retour', obtained_at: new Date(clock.now).toISOString() });
      return json({ status: 'cancelled' });
    }
    if (method === 'POST' && /^\/api\/marketplace\/[^/]+\/bid$/.test(p)) return json({ auction_id: 'x', current_bid: 12, bidder_balance: 88 });
    if (method === 'POST' && p === '/api/trades/t1/accept') return json({ status: 'accepted' });
    if (method === 'POST') return json({ ok: true }); // human-check, achievements/check…
    return json({ collection: collection.slice(0, 50).map((e) => ({ ...e })) }); // lecture de la page elle-même
  }
  function base(input, init) {
    clock.ticks += 1;
    const page = fromPage;
    fromPage = false;
    const url = typeof input === 'string' ? input : input.url;
    if (page) {
      thisOf.push(this);
      let res;
      try {
        const method = String((init && init.method) || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
        res = pageAnswer(url, method, init);
      } catch (e) {
        const p = Promise.reject(e);
        sent.push([p, null]);
        return p;
      }
      const p = Promise.resolve(game.weird ? game.weird(res) : res);
      sent.push([p, res]);
      return p;
    }
    if (url.startsWith(SITE + '/api/')) {
      assert.equal(init.headers['X-Classeur-Key'], key);
      const route = url.slice(SITE.length + 5);
      const body = JSON.parse(init.body);
      posts.push({ route, body, at: clock.now });
      if (onPost) onPost(body, route);
      if (game.siteDown) return Promise.reject(new TypeError('Failed to fetch'));
      const failed = game.siteStatus && game.siteStatus(body, route);
      if (failed) return Promise.resolve({ ok: false, status: failed, json: async () => ({ error: SITE_ERRORS[failed] || 'Erreur.' }) });
      clock.busy += 1;
      return api('POST', route, { body, key, origin: GAME }).then((r) => {
        clock.busy -= 1;
        clock.ticks += 1;
        return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
      });
    }
    calls.push({ url, at: clock.now });
    return Promise.resolve(searchFetch(url)); // jeu simulé, Collection globale comprise
  }
  const ctx = {
    document: doc, location: { hostname: 'www.wiki-masters.com', origin: GAME, href: GAME + pathname, pathname, search: '' }, fetch: base,
    setTimeout: (f, ms) => {
      if (!me.alive) return 0;
      clock.seq += 1;
      clock.ticks += 1;
      clock.timers.push({ at: clock.now + Math.max(0, Number(ms) || 0), seq: clock.seq, f, page: me });
      return clock.seq;
    },
    URL, URLSearchParams, Date, Promise, JSON, Math, Number, String, Array, Object, Error, TypeError, console,
    prompt: () => (answers.length ? answers.shift() : null),
  };
  if (storage === 'refused') Object.defineProperty(ctx, 'localStorage', { get() { throw new Error('SecurityError : accès au stockage refusé'); } });
  else if (storage) ctx.localStorage = storage;
  ctx.window = ctx;
  vm.createContext(ctx);
  const run = () => vm.runInContext(oneLine(key, start), ctx);
  // Requête faite par la page elle-même (comme un clic du joueur dans le jeu), avec ce this (window par défaut).
  const page = (input, init, self = ctx.window) => {
    fromPage = true;
    return ctx.window.fetch.call(self, input, init);
  };
  const boxEl = () => doc.getElementById('classeur-favori');
  const text = () => (boxEl() ? boxEl().textContent.replace(/[  ]/g, ' ') : '');
  // Ligne d'état du mode relié (« Classeur relié · … »).
  const status = () => {
    const el = boxEl() && boxEl().querySelectorAll('div').find((d) => d.childNodes.length === 1 && d.childNodes[0].nodeType === 3 && d.textContent.startsWith('Classeur relié · '));
    return el ? el.textContent : '';
  };
  const press = (label) => {
    const b = boxEl().querySelectorAll('button').find((x) => x.textContent === label || x.textContent.startsWith(label + ' '));
    assert.ok(b, `bouton « ${label} » absent : ${text()}`);
    b.click();
  };
  run();
  await advance(0);
  return { ctx, base, calls, posts, sent, thisOf, storage, page, advance, text, status, press, run, boxes: () => doc.querySelectorAll('#classeur-favori').length,
    get now() { return clock.now; }, since: (n) => calls.slice(n).map((c) => c.url) };
}
let packSeq = 0; // cartes des paquets ouverts par les pages (pk1, pk2…), uniques pour tous les tests
const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (t) => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const QUICK = ['/api/my-collection/stats?sort=rarity', '/api/my-collection?sort=added&page=0&stats=0'];
const POST_JSON = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
const unhandled = [];
process.on('unhandledRejection', (e) => { unhandled.push(e); });

// La page envoie sa requête et lit sa réponse : même promesse que le fetch d'origine, même Response, corps intact.
async function samePage(g, input, init, check) {
  const before = g.sent.length;
  const p = g.page(input, init);
  assert.equal(g.sent.length, before + 1, 'la requête de la page doit partir une fois, aussitôt');
  const [orig, res] = g.sent[before];
  assert.equal(p, orig, 'la page doit recevoir la promesse même du fetch d\'origine');
  const got = await p;
  assert.equal(got, res, 'la page doit recevoir la Response d\'origine');
  assert.equal(got.bodyUsed, false, 'le corps de la réponse ne doit pas avoir été lu');
  if (got.status !== 204) {
    const data = await got.json();
    if (check) check(data, got);
  }
  return got;
}

await test('relié : la page reçoit ses réponses telles quelles ; seules ses actions sur la collection relancent la synchro rapide, 5 s après', async () => {
  await fresh60();
  const g = await openGame();
  assert.match(g.text(), /Rien de nouveau depuis ta dernière synchro/, g.text());
  assert.deepEqual(g.since(0), QUICK);
  assert.notEqual(g.ctx.window.fetch, g.base, 'window.fetch enveloppé');
  assert.equal(g.status(), `Classeur relié · dernière synchro à ${hhmm(g.now)}`);
  // Requêtes de la page sans effet sur la collection : lectures, enchère posée, vérification humaine, succès vérifiés,
  // Supabase (étoile), paquet refusé (429). Rien n'est relu, même 10 minutes après.
  let n = g.calls.length;
  await samePage(g, '/api/my-collection?sort=rarity&page=0&stats=0', { credentials: 'include' }, (d) => assert.equal(d.collection.length, 50));
  await samePage(g, new Request(GAME + '/api/my-collection/stats?sort=rarity'));
  await samePage(g, '/api/marketplace/0d6c0f4e-1111-4111-8111-111111111111/bid', POST_JSON({ amount: 12 }), (d) => assert.equal(d.current_bid, 12));
  await samePage(g, '/api/human-check', POST_JSON({ token: 'x' }));
  await samePage(g, '/api/achievements/check', POST_JSON({ event: 'achievements_sync' }));
  await samePage(g, 'https://cyrxjeppjqsxxjayfrur.supabase.co/rest/v1/user_cards?id=eq.e3', { method: 'PATCH', body: '{"starred":true}' });
  game.packRefused = true;
  await samePage(g, '/api/packs/open', POST_JSON({}), (d, r) => assert.equal(r.status, 429));
  game.packRefused = false;
  await g.advance(10 * 60_000);
  assert.deepEqual(g.since(n), [], 'aucune lecture du jeu sans action sur la collection');
  // Paquet ouvert : synchro rapide 5 s après la réponse, pas avant.
  n = g.calls.length;
  await samePage(g, '/api/packs/open', POST_JSON({}), (d) => assert.equal(d.cards.length, 5));
  await g.advance(4_000);
  assert.deepEqual(g.since(n), []);
  assert.match(g.status(), /Classeur relié · synchro dans un instant \(paquet ouvert\)/);
  await g.advance(1_000);
  assert.deepEqual(g.since(n), QUICK);
  assert.match(g.text(), /5 exemplaires obtenus depuis ta dernière synchro, 5 nouvelles cartes : ton classeur est à jour \(65 cartes\)/, g.text());
  assert.equal((await cardsOf()).length, 65);
  assert.equal(g.status(), `Classeur relié · dernière synchro à ${hhmm(g.now)}`);
  // Adresse absolue, objet URL, Request : reconnus pareil (échange accepté).
  n = g.calls.length;
  await samePage(g, new Request(GAME + '/api/trades/t1/accept', { method: 'POST' }));
  await g.advance(65_000);
  assert.deepEqual(g.since(n), QUICK);
  assert.deepEqual(unhandled, []);
});

await test('relié : rafales et limites — 5 s après la dernière action (30 s au plus), une synchro par minute, 20 par heure', async () => {
  await fresh60();
  let g = await openGame();
  const syncs = (from) => g.calls.slice(from).filter((c) => c.url === QUICK[0]).map((c) => c.at);
  // Un paquet juste après la synchro du clic attend la minute ; puis deux paquets à 10 s d'écart : le second attend une
  // minute après la fin de la synchro du premier.
  let n = g.calls.length;
  let t = g.now;
  await g.page('/api/packs/open', POST_JSON({}));
  await g.advance(0);
  assert.match(g.status(), new RegExp(`synchro à ${hhmm(t + 60_000)} \\(paquet ouvert ; une par minute au plus\\)`), g.status());
  await g.advance(61_000);
  assert.deepEqual(syncs(n).map((x) => x - t), [60_000]);
  await g.advance(60_000);
  n = g.calls.length;
  t = g.now;
  await g.page('/api/packs/open', POST_JSON({}));
  await g.advance(10_000);
  await g.page('/api/packs/open', POST_JSON({}));
  await g.advance(0);
  assert.match(g.status(), new RegExp(`synchro à ${hhmm(t + 5_000 + 60_000)} \\(paquet ouvert ; une par minute au plus\\)`), g.status());
  await g.advance(60_000);
  assert.deepEqual(syncs(n).map((x) => x - t), [5_000, 65_000]);
  // Rafale : un paquet toutes les 4 s pendant 40 s → une synchro 30 s après le premier, une autre une minute plus tard.
  await g.advance(5 * 60_000);
  n = g.calls.length;
  const r0 = g.now;
  for (let i = 0; i < 11; i++) {
    await g.page('/api/packs/open', POST_JSON({}));
    await g.advance(4_000);
  }
  await g.advance(2 * 60_000);
  assert.deepEqual(syncs(n).map((x) => x - r0), [30_000, 90_000]);
  assert.equal((await cardsOf()).length, 60 + 14 * 5);
  // 20 synchros automatiques par heure au plus (nouvelle page, même compte) : la 21e attend que la plus ancienne ait une
  // heure, puis rattrape tout d'un coup.
  g = await openGame();
  await g.advance(60_000);
  n = g.calls.length;
  const h0 = g.now;
  for (let i = 0; i < 24; i++) {
    await g.page('/api/packs/open', POST_JSON({}));
    await g.advance(61_000);
  }
  const first = syncs(n);
  assert.equal(first.length, 20, `20 synchros attendues dans l'heure, ${first.length}`);
  assert.match(g.status(), new RegExp(`synchro à ${hhmm(first[0] + 3_600_000)} \\(paquet ouvert ; 20 synchros automatiques par heure au plus\\)`), g.status());
  await g.advance(first[0] + 3_600_000 - g.now + 1_000);
  const all = syncs(n);
  assert.equal(all.length, 21);
  assert.equal(all[20], first[0] + 3_600_000);
  assert.ok(all.every((x, i) => !i || x - all[i - 1] >= 60_000), 'jamais deux synchros à moins d\'une minute');
  assert.equal((await cardsOf()).length, 60 + 14 * 5 + 24 * 5);
  assert.equal(first[0], h0 + 5_000);
});

await test('relié : défausse, mise aux enchères → relecture complète, au plus une automatique par quart d\'heure ; annulation → synchro rapide', async () => {
  await fresh60();
  const g = await openGame();
  await g.advance(15 * 60_000);
  const full = (from) => g.calls.slice(from).some((c) => c.url.includes('sort=rarity&page=0'));
  // Défausse : les compteurs ne collent plus → relecture complète aussitôt (la dernière, celle de fresh60, a un quart
  // d'heure).
  let n = g.calls.length;
  await g.page('/api/user-cards/bulk-discard', POST_JSON({ card_ids: ['e3', 'e4'] }));
  await g.advance(6_000);
  assert.ok(full(n), g.since(n).join(', '));
  assert.ok(!(await cardOf('c3')) && !(await cardOf('c4')) && (await cardsOf()).length === 58);
  const fullAt = g.calls.find((c, i) => i >= n && c.url === '/api/my-collection?sort=rarity&page=0&stats=0').at;
  // Mise aux enchères 2 minutes plus tard : relecture reportée à 15 minutes après la précédente, dite dans l'encart.
  await g.advance(2 * 60_000);
  n = g.calls.length;
  await g.page('/api/marketplace', POST_JSON({ card_id: 'e10', base_amount: 5, duration_minutes: 60 }));
  await g.advance(6_000);
  assert.deepEqual(g.since(n), QUICK, 'synchro rapide seulement');
  assert.match(g.text(), new RegExp(`Les compteurs du jeu ne collent pas avec tes nouveautés \\(carte vendue, échangée ou mise aux enchères, exemplaire ajouté à une carte déjà là…\\)\\. Relecture complète prévue à ${hhmm(fullAt + 15 * 60_000)}`), g.text());
  assert.match(g.status(), new RegExp(`relecture complète à ${hhmm(fullAt + 15 * 60_000)} \\(carte mise aux enchères ; une relecture complète automatique toutes les 15 minutes au plus\\)`), g.status());
  // Un paquet entre-temps n'avance pas l'heure (la synchro rapide échouerait de même).
  await g.page('/api/packs/open', POST_JSON({}));
  const pack = 'pk' + packSeq;
  await g.advance(fullAt + 15 * 60_000 - g.now - 1_000);
  assert.deepEqual(g.since(n), QUICK);
  await g.advance(2_000);
  assert.ok(full(n + 2), g.since(n).join(', '));
  assert.ok(!(await cardOf('c10')) && (await cardOf(pack)) && (await cardsOf()).length === 62);
  // Enchère annulée : la carte revient avec une nouvelle date → simple nouveauté, synchro rapide.
  await g.advance(2 * 60_000);
  n = g.calls.length;
  await g.page('/api/marketplace/a1', { method: 'DELETE' });
  await g.advance(6_000);
  assert.deepEqual(g.since(n), QUICK);
  assert.match(g.text(), /1 exemplaire obtenu depuis ta dernière synchro, 1 nouvelle carte/, g.text());
  assert.ok(await cardOf('c10'));
});

await test('relié : « Arrêter » rend window.fetch d\'origine ; enveloppé par-dessus par un autre script, il ne fait plus que passer la main', async () => {
  await fresh60();
  let g = await openGame();
  g.press('Arrêter');
  assert.equal(g.ctx.window.fetch, g.base, 'window.fetch d\'origine rendu');
  assert.equal(g.boxes(), 0, 'encart retiré');
  assert.ok(!g.ctx.__classeurRelie);
  let n = g.calls.length;
  await samePage(g, '/api/packs/open', POST_JSON({}));
  await g.advance(5 * 60_000);
  assert.deepEqual(g.since(n), []);
  // Un autre script a enveloppé window.fetch après le favori : il reste en place, la requête passe toujours, sans synchro.
  g = await openGame();
  const theirs = g.ctx.window.fetch;
  const outer = function (...a) { return theirs.apply(this, a); };
  g.ctx.window.fetch = outer;
  g.press('Arrêter');
  assert.equal(g.ctx.window.fetch, outer);
  n = g.calls.length;
  await samePage(g, '/api/packs/open', POST_JSON({}), (d) => assert.equal(d.cards.length, 5));
  await g.advance(5 * 60_000);
  assert.deepEqual(g.since(n), []);
});

await test('relié : une erreur de l\'observateur ne casse jamais la requête de la page (ni rejet non géré)', async () => {
  await fresh60();
  const g = await openGame();
  const n = g.calls.length;
  // init dont la méthode ne se lit qu'une fois (le fetch d'origine la lit d'abord) : l'observateur échoue, la page a sa réponse.
  let reads = 0;
  const init = { body: '{}', get method() { reads += 1; if (reads > 1) throw new Error('lecture refusée'); return 'POST'; } };
  await samePage(g, '/api/packs/open', init, (d) => assert.equal(d.cards.length, 5));
  // Adresse d'un objet qui ne se lit qu'une fois.
  let urlReads = 0;
  await samePage(g, { get url() { urlReads += 1; if (urlReads > 1) throw new Error('adresse refusée'); return '/api/packs/open'; }, method: 'POST' }, { method: 'POST' });
  // Réponse étrange (ok qui lève) : la page la reçoit telle quelle.
  game.weird = (res) => Object.defineProperty(res, 'ok', { get() { throw new Error('ok illisible'); } });
  const p = g.page('/api/packs/open', POST_JSON({}));
  assert.equal(p, g.sent.at(-1)[0]);
  assert.equal(await p, g.sent.at(-1)[1]);
  game.weird = null;
  // Échec réseau : la page reçoit le même rejet, l'observateur ne dit rien.
  game.offline = true;
  const before = g.sent.length;
  const failed = g.page('/api/packs/open', POST_JSON({}));
  assert.equal(failed, g.sent[before][0]);
  await assert.rejects(failed, (e) => e instanceof TypeError && e.message === 'Failed to fetch');
  game.offline = false;
  await g.advance(5 * 60_000);
  assert.deepEqual(g.since(n), [], 'aucune synchro : aucune action vue comme réussie');
  assert.deepEqual(unhandled, [], 'aucun rejet non géré');
});

await test('relié : nouveau clic dans la même page → l\'ancien favori s\'arrête ; un seul encart, une seule synchro par action', async () => {
  await fresh60();
  const g = await openGame();
  g.run();
  await g.advance(61_000);
  assert.equal(g.boxes(), 1);
  const n = g.calls.length;
  const before = g.sent.length;
  await samePage(g, '/api/packs/open', POST_JSON({}));
  assert.equal(g.sent.length, before + 1, 'une seule requête de la page (pas d\'enveloppe en double)');
  await g.advance(6_000);
  assert.deepEqual(g.since(n), QUICK, 'une seule synchro');
  g.press('Arrêter');
  assert.equal(g.ctx.window.fetch, g.base, 'window.fetch d\'origine rendu après deux clics');
});

await test('relié : erreur du jeu pendant une synchro automatique → pause et encart déplié ; « Synchroniser » relance', async () => {
  await fresh60();
  const g = await openGame();
  await g.advance(14_000);
  assert.match(g.text(), /Réduire/);
  await g.advance(47_000);
  assert.match(g.text(), /Détails/, 'encart réduit en badge 15 s après la synchro du clic');
  game.status = (url) => (url.includes('stats') ? reply({ code: 'automation_limit', error: 'Trop de requêtes' }, 403) : null);
  let n = g.calls.length;
  await g.page('/api/packs/open', POST_JSON({}));
  await g.advance(6_000);
  assert.match(g.text(), /Le jeu limite les lectures automatiques : réessaie plus tard/, g.text());
  assert.match(g.text(), /Réduire/, 'encart déplié');
  assert.match(g.status(), /synchro automatique en pause : clique « Synchroniser »/);
  await g.page('/api/packs/open', POST_JSON({}));
  await g.advance(10 * 60_000);
  assert.deepEqual(g.since(n), [QUICK[0]], 'plus rien d\'automatique pendant la pause');
  game.status = null;
  n = g.calls.length;
  g.press('Synchroniser');
  await g.advance(0);
  assert.deepEqual(g.since(n), QUICK);
  assert.match(g.text(), /10 exemplaires obtenus/, g.text());
  n = g.calls.length;
  await g.page('/api/packs/open', POST_JSON({}));
  await g.advance(65_000);
  assert.deepEqual(g.since(n), QUICK, 'synchros automatiques reprises');
});

await test("relié sur la Collection globale : une action en attente n'est pas perdue pendant « Créer une collection »", async () => {
  await fresh60();
  resetSearch();
  catalogue = vaches();
  const g = await openGame({ pathname: '/global-collection', answers: ['vache', 'Mes vaches'] });
  assert.match(g.text(), /Collection globale : que veux-tu faire \?/);
  assert.deepEqual(g.since(0), [], "rien n'est lu avant un choix");
  await g.page('/api/packs/open', POST_JSON({}));
  g.press('Créer une collection avec une recherche…');
  await g.advance(1_000);
  assert.match(g.text(), /Collection « Mes vaches » créée dans ton classeur : 87 cartes/, g.text());
  assert.match(g.status(), /synchro dans un instant \(paquet ouvert\)/, g.status());
  await g.advance(5_000);
  assert.deepEqual(g.since(0).filter((u) => !u.startsWith('/api/cards')), QUICK);
  assert.equal((await cardsOf()).length, 65);
  assert.equal((await targetsOf()).length, 1);
});

await test('script Tampermonkey (« load ») : relié dès le chargement, rien de lu avant une action, ni choix sur la Collection globale', async () => {
  await fresh60();
  let g = await openGame({ start: 'load' });
  await g.advance(10 * 60_000);
  assert.deepEqual(g.since(0), []);
  assert.deepEqual(g.posts, []);
  assert.equal(g.status(), 'Classeur relié · synchro après ta prochaine action dans le jeu');
  assert.match(g.text(), /Détails/);
  await g.page('/api/packs/open', POST_JSON({}));
  await g.advance(6_000);
  assert.deepEqual(g.since(0), QUICK);
  assert.equal((await cardsOf()).length, 65);
  g = await openGame({ start: 'load', pathname: '/global-collection' });
  assert.ok(!/que veux-tu faire/.test(g.text()) && !/Créer une collection/.test(g.text()), g.text());
  assert.deepEqual(g.since(0), []);
});

const FULL0 = '/api/my-collection?sort=rarity&page=0&stats=0';
const syncsOf = (g, from = 0) => g.calls.slice(from).filter((c) => c.url === QUICK[0]).map((c) => c.at);

await test('relié : l\'observateur ne regarde que les écritures de la page vers l\'API du jeu ; this transmis ; ses propres requêtes ne passent pas par window.fetch', async () => {
  await fresh60();
  const g = await openGame();
  await g.advance(61_000);
  // Une enveloppe posée par un autre script après le favori voit les requêtes de la page, jamais celles du favori.
  const theirs = g.ctx.window.fetch;
  const other = [];
  g.ctx.window.fetch = function (input) {
    other.push(typeof input === 'string' ? input : input.url);
    return theirs.apply(this, arguments);
  };
  let n = g.calls.length;
  // Lectures d'échanges (GET, HEAD : le chemin est celui d'une action « toute méthode »), écritures vers un autre site
  // sur des chemins d'action : rien.
  await samePage(g, '/api/trades', { credentials: 'include' });
  await samePage(g, new Request(GAME + '/api/trades?status=pending'));
  await samePage(g, '/api/trades/t1', { method: 'HEAD' });
  await samePage(g, 'https://autre-site.example/api/packs/open', POST_JSON({}));
  await samePage(g, 'https://autre-site.example/api/trades/t1/accept', { method: 'POST' });
  await g.advance(10 * 60_000);
  assert.deepEqual(g.since(n), [], 'aucune synchro');
  // Le this de la page arrive tel quel au fetch d'origine.
  assert.ok(g.thisOf.length === 5 && g.thisOf.every((t) => t === g.ctx.window), 'this = window');
  const self = { autreThis: true };
  n = g.calls.length;
  await g.page('/api/packs/open', POST_JSON({}), self);
  assert.equal(g.thisOf.at(-1), self, 'this transmis');
  await g.advance(6_000);
  assert.deepEqual(g.since(n), QUICK);
  assert.deepEqual(other, ['/api/trades', GAME + '/api/trades?status=pending', '/api/trades/t1', 'https://autre-site.example/api/packs/open', 'https://autre-site.example/api/trades/t1/accept', '/api/packs/open'],
    'l\'autre enveloppe ne voit que les requêtes de la page');
});

await test('relié : classeur injoignable ou en erreur (réseau, 500) → rien n\'est lu dans le jeu ; pause après trois échecs de suite, dite dans le badge', async () => {
  for (const [mode, said] of [['réseau', /Le classeur ne répond pas \(réseau\) : réessaie dans un moment\./], ['500', /Le classeur ne répond pas \(erreur 500\) : réessaie dans un moment\./]]) {
    await newAccount();
    collection = Array.from({ length: 2000 }, (_, i) => entry(i, -i)); // 40 pages, toutes datées d'avant les paquets
    const g = await openGame(); // compte neuf : relecture complète du clic
    await g.advance(20 * 60_000);
    assert.match(g.text(), /2\s000 cartes envoyées au classeur/, g.text());
    const n = g.calls.length;
    const p = g.posts.length;
    if (mode === 'réseau') game.siteDown = true;
    else game.siteStatus = () => 500;
    // Deux échecs : encart déplié avec le message, pas encore de pause.
    for (let i = 0; i < 2; i++) {
      await g.page('/api/packs/open', POST_JSON({}));
      await g.advance(120_000);
    }
    assert.match(g.text(), said, g.text());
    assert.match(g.text(), /Réduire/, 'encart déplié');
    assert.doesNotMatch(g.status(), /pause/, g.status());
    // Le troisième de suite : pause, dite dans le badge et dans l'encart.
    await g.page('/api/packs/open', POST_JSON({}));
    await g.advance(120_000);
    assert.equal(g.status(), 'Classeur relié · le classeur ne répond pas, synchros automatiques en pause : clique « Synchroniser »');
    assert.match(g.text(), /Synchros automatiques en pause : « Synchroniser » les relance\./, g.text());
    // Deux heures de jeu pendant la pause : plus rien, ni lecture du jeu ni envoi.
    for (let i = 0; i < 60; i++) {
      await g.page('/api/packs/open', POST_JSON({}));
      await g.advance(120_000);
    }
    assert.deepEqual(g.since(n), [], 'aucune lecture du jeu tant que le classeur ne répond pas');
    assert.deepEqual(g.posts.slice(p).map((x) => x.body.mode), ['state', 'state', 'state'], 'trois demandes d\'état, rien d\'autre');
    // « Synchroniser » pendant la panne : le message, toujours rien de lu dans le jeu.
    g.press('Synchroniser');
    await g.advance(5_000);
    assert.match(g.text(), said, g.text());
    assert.deepEqual(g.since(n), []);
    // Classeur revenu : « Synchroniser » relance, puis les synchros automatiques.
    game.siteDown = false;
    game.siteStatus = null;
    g.press('Synchroniser');
    await g.advance(5_000);
    assert.match(g.text(), /315 exemplaires obtenus depuis ta dernière synchro/, g.text());
    assert.ok(g.since(n)[0] === QUICK[0] && g.since(n).slice(1).every((u) => u.includes('sort=added')), g.since(n).join(', '));
    const m = g.calls.length;
    await g.page('/api/packs/open', POST_JSON({}));
    await g.advance(65_000);
    assert.deepEqual(g.since(m), QUICK, 'synchros automatiques reprises');
  }
});

await test('relié : une relecture complète reportée n\'efface pas les échecs d\'avant (seule une synchro réussie le fait)', async () => {
  await fresh60();
  const g = await openGame();
  const t0 = g.now; // relecture complète de fresh60 : la prochaine automatique, pas avant t0 + 15 min
  await g.advance(60_000);
  game.siteStatus = () => 500;
  await g.page('/api/packs/open', POST_JSON({}));
  await g.advance(120_000); // échec 1
  game.siteStatus = null;
  await g.page('/api/user-cards/bulk-discard', POST_JSON({ card_ids: ['e3'] }));
  await g.advance(10_000); // relecture complète reportée à t0 + 15 min (le classeur a répondu)
  assert.match(g.status(), new RegExp(`relecture complète à ${hhmm(t0 + 15 * 60_000)}`), g.status());
  game.siteStatus = () => 500;
  await g.advance(t0 + 15 * 60_000 - g.now + 10_000); // échec 2 : la relecture reportée
  await g.page('/api/packs/open', POST_JSON({}));
  await g.advance(120_000); // échec 3 : pause
  assert.equal(g.status(), 'Classeur relié · le classeur ne répond pas, synchros automatiques en pause : clique « Synchroniser »');
});

await test('relié : quota du jour du classeur atteint (503) → pause aussitôt, avec son message', async () => {
  for (const at of ['delta', 'state']) {
    await fresh60();
    const g = await openGame();
    await g.advance(61_000);
    const n = g.calls.length;
    const p = g.posts.length;
    game.siteStatus = (body) => (at === 'state' || body.mode !== 'state' ? 503 : null);
    await g.page('/api/packs/open', POST_JSON({}));
    await g.advance(6_000);
    assert.match(g.text(), /La base du classeur est pleine ou a atteint son quota du jour : réessaie demain/, g.text());
    assert.equal(g.status(), 'Classeur relié · le classeur ne répond pas, synchros automatiques en pause : clique « Synchroniser »');
    await g.page('/api/packs/open', POST_JSON({}));
    await g.advance(10 * 60_000);
    assert.deepEqual(g.since(n), at === 'state' ? [] : QUICK);
    assert.deepEqual(g.posts.slice(p).map((x) => x.body.mode), at === 'state' ? ['state'] : ['state', 'delta']);
    resetGame();
  }
});

await test('relié : « Arrêter » en pleine synchro → plus rien n\'est lu ni envoyé ; un clic pendant qu\'elle se termine le dit', async () => {
  await newAccount();
  collection = Array.from({ length: 2000 }, (_, i) => entry(i, i)); // 40 pages, 4 envois de 500 cartes
  // Pendant la lecture (compte neuf : relecture complète du clic, arrêtée après sa première page).
  const g = await openGame();
  assert.equal(g.calls.filter((c) => c.url.includes('sort=rarity&page=')).length, 1);
  assert.equal(g.ctx.__classeurFavori, true, 'synchro en cours');
  g.press('Arrêter');
  const n = g.calls.length;
  const p = g.posts.length;
  // Nouveau clic pendant qu'elle se termine : un encart le dit, rien n'est lancé ni enveloppé.
  g.run();
  assert.equal(g.boxes(), 1);
  assert.match(g.text(), /Une synchro se termine : clique à nouveau le favori dans un instant \(ou recharge la page\)\./, g.text());
  assert.equal(g.ctx.window.fetch, g.base);
  await g.advance(60_000);
  assert.deepEqual([g.since(n), g.posts.length - p], [[], 0], 'plus rien de lu ni d\'envoyé après « Arrêter »');
  assert.equal(g.ctx.__classeurFavori, false);
  assert.equal((await cardsOf()).length, 0);
  // Une fois finie, le clic suivant repart normalement.
  g.run();
  await g.advance(60_000);
  assert.equal(g.boxes(), 1);
  assert.match(g.text(), /2\s000 cartes envoyées au classeur/, g.text());
  // Pendant l'envoi : le morceau déjà parti finit, le suivant ne part pas.
  await newAccount();
  let h = null;
  h = await openGame({ onPost: (body) => { if (body.part === 1) h.press('Arrêter'); } });
  await h.advance(60_000);
  assert.deepEqual(h.posts.map((x) => (x.body.mode || x.body.part)), ['state', 0, 1]);
  assert.equal((await cardsOf()).length, 0, 'import inachevé : rien de rangé');
  assert.equal(h.ctx.__classeurFavori, false);
});

await test('relié : limites communes aux pages et onglets du jeu (localStorage), et relectures complètes d\'après full_at du classeur', async () => {
  // Piles (total = lignes) : la synchro rapide est coupée et full_at n'est jamais armé, chaque synchro relit tout.
  // Script Tampermonkey, une défausse… par page rechargée : une relecture complète automatique par quart d'heure au plus.
  await newAccount();
  collection = Array.from({ length: 120 }, (_, i) => entry(i, i, i === 7 ? { count: 2 } : {}));
  const st = memoryStorage();
  let g = await openGame({ storage: st });
  await g.advance(5_000);
  assert.match(g.text(), /120 cartes envoyées au classeur/, g.text());
  const t0 = g.calls.find((c) => c.url === FULL0).at;
  let fulls = 0;
  for (let i = 0; i < 6; i++) {
    g = await openGame({ start: 'load', storage: st }); // rechargement : nouveau script, même navigateur
    const n = g.calls.length;
    await g.page('/api/packs/open', POST_JSON({}));
    await g.advance(90_000);
    fulls += g.calls.slice(n).filter((c) => c.url === FULL0).length;
  }
  assert.equal(fulls, 0, 'aucune relecture complète automatique dans le quart d\'heure');
  assert.match(g.status(), new RegExp(`relecture complète à ${hhmm(t0 + 15 * 60_000)} \\(paquet ouvert ; une relecture complète automatique toutes les 15 minutes au plus\\)`), g.status());
  let n = g.calls.length;
  await g.advance(t0 + 15 * 60_000 - g.now + 5_000);
  assert.deepEqual(g.calls.slice(n).filter((c) => c.url === FULL0).map((c) => c.at), [t0 + 15 * 60_000]);
  // Un autre onglet pendant qu'une synchro (ici une relecture complète, avec ses pauses entre pages) tourne dans le
  // premier : il attend la minute après elle, et ne relit pas tout derrière.
  const other = await openGame({ start: 'load', storage: st, tab: true });
  await g.advance(16 * 60_000);
  n = g.calls.length;
  const nOther = other.calls.length;
  const t2 = g.now;
  await g.page('/api/packs/open', POST_JSON({}));
  await g.advance(300);
  await other.page('/api/packs/open', POST_JSON({}));
  await g.advance(5 * 60_000);
  const pagesA = g.calls.slice(n).filter((c) => c.url.includes('sort=rarity&page='));
  assert.ok(pagesA.length >= 3 && pagesA[0].at === t2 + 5_000, 'relecture complète du premier onglet, sur plusieurs pages');
  const firstOther = syncsOf(other, nOther);
  assert.equal(firstOther.length, 1);
  assert.ok(firstOther[0] >= pagesA.at(-1).at + 60_000, `l'autre onglet attend la minute après la fin de la synchro en cours (${firstOther[0] - t2} ms)`);
  assert.ok(!other.since(nOther).includes(FULL0), 'et ne relit pas tout derrière');
  // Ce que garde le localStorage du jeu : une seule clé « classeur:… », des heures, jamais une clé du classeur.
  assert.deepEqual(st.keys(), ['classeur:relie']);
  const kept = st.getItem('classeur:relie');
  assert.ok(!kept.includes(importKey) && !kept.includes(account.key), kept);
  assert.deepEqual(Object.keys(JSON.parse(kept)).sort(), ['autos', 'end', 'full']);

  // Deux onglets ouverts en même temps : une synchro par minute au plus, tous onglets confondus, même quand leurs deux
  // actions tombent au même moment.
  await fresh60();
  const both = memoryStorage();
  const a = await openGame({ start: 'load', storage: both });
  const b = await openGame({ start: 'load', storage: both, tab: true });
  await a.advance(60_000);
  for (const together of [false, true]) {
    const na = a.calls.length;
    const nb = b.calls.length;
    const t = a.now;
    await a.page('/api/packs/open', POST_JSON({}));
    if (!together) {
      await a.advance(10_000);
      await b.page('/api/packs/open', POST_JSON({}));
      await a.advance(0);
      assert.match(b.status(), new RegExp(`synchro à ${hhmm(t + 5_000 + 60_000)} \\(paquet ouvert ; une par minute au plus\\)`), b.status());
    } else {
      await b.page('/api/packs/open', POST_JSON({}));
    }
    await a.advance(2 * 60_000);
    assert.deepEqual([syncsOf(a, na).map((x) => x - t), syncsOf(b, nb).map((x) => x - t)], [[5_000], [65_000]], together ? 'actions au même moment' : 'à 10 s d\'écart');
  }
  assert.equal((await cardsOf()).length, 60 + 4 * 5);

  // 20 synchros automatiques par heure, rechargement compris : la 21e attend que la plus ancienne ait une heure.
  const hour = memoryStorage();
  g = await openGame({ start: 'load', storage: hour });
  await g.advance(60_000);
  n = g.calls.length;
  for (let i = 0; i < 20; i++) {
    await g.page('/api/packs/open', POST_JSON({}));
    await g.advance(61_000);
  }
  const first = syncsOf(g, n);
  assert.equal(first.length, 20);
  g = await openGame({ start: 'load', storage: hour });
  await g.page('/api/packs/open', POST_JSON({}));
  await g.advance(0);
  assert.match(g.status(), new RegExp(`synchro à ${hhmm(first[0] + 3_600_000)} \\(paquet ouvert ; 20 synchros automatiques par heure au plus\\)`), g.status());
  await g.advance(first[0] + 3_600_000 - g.now + 1_000);
  assert.deepEqual(syncsOf(g), [first[0] + 3_600_000]);

  // full_at du classeur : relecture complète il y a 2 minutes (le clic de fresh60), page neuve sans rien en mémoire
  // (autre navigateur, stockage vidé) : la relecture complète automatique attend quand même le quart d'heure.
  await fresh60();
  const t1 = g.now;
  g = await openGame({ start: 'load' });
  await g.advance(2 * 60_000);
  n = g.calls.length;
  await g.page('/api/user-cards/bulk-discard', POST_JSON({ card_ids: ['e3'] }));
  await g.advance(6_000);
  assert.deepEqual(g.since(n), QUICK, 'synchro rapide seulement');
  assert.match(g.text(), new RegExp(`Relecture complète prévue à ${hhmm(t1 + 15 * 60_000)} \\(une relecture automatique toutes les 15 minutes au plus\\) : « Synchroniser » la lance tout de suite\\.`), g.text());
  // « Synchroniser » la lance tout de suite.
  n = g.calls.length;
  g.press('Synchroniser');
  await g.advance(5_000);
  assert.ok(g.since(n).includes(FULL0), g.since(n).join(', '));
  assert.match(g.text(), /59 cartes envoyées au classeur/, g.text());

  // localStorage refusé (navigation privée…) : rien ne casse, limites de cette page seulement.
  g = await openGame({ storage: 'refused' });
  assert.match(g.text(), /Rien de nouveau depuis ta dernière synchro/, g.text());
  n = g.calls.length;
  await g.page('/api/packs/open', POST_JSON({}));
  await g.advance(0);
  assert.match(g.status(), /synchro à .* \(paquet ouvert ; une par minute au plus\)/, g.status());
  await g.advance(65_000);
  assert.deepEqual(g.since(n), QUICK);
  assert.deepEqual(unhandled, []);
});

await test('relié sur la Collection globale : une synchro automatique n\'efface ni la question ni les deux choix', async () => {
  await fresh60();
  resetSearch();
  catalogue = vaches();
  const g = await openGame({ pathname: '/global-collection', answers: ['vache', 'Mes vaches'] });
  const CHOICES = ['Mettre à jour mon classeur', 'Créer une collection avec une recherche…'];
  const buttons = () => g.ctx.document.getElementById('classeur-favori').querySelectorAll('button').map((x) => x.textContent);
  assert.deepEqual(buttons(), [...CHOICES, 'Synchroniser', 'Réduire', 'Arrêter']);
  await g.page('/api/packs/open', POST_JSON({}));
  await g.advance(6_000);
  assert.match(g.text(), /5 exemplaires obtenus depuis ta dernière synchro/, g.text());
  assert.match(g.text(), /Collection globale : que veux-tu faire \?/, g.text());
  assert.deepEqual(buttons(), [...CHOICES, 'Synchroniser', 'Réduire', 'Arrêter']);
  g.press('Créer une collection avec une recherche…');
  await g.advance(1_000);
  assert.match(g.text(), /Collection « Mes vaches » créée dans ton classeur : 87 cartes/, g.text());
  assert.deepEqual(buttons(), ['Synchroniser', 'Réduire', 'Arrêter'], 'choix retirés une fois l\'un d\'eux pris');
});

await test('script Tampermonkey périmé (favori régénéré) : rien n\'est lu dans le jeu, message propre au script, pause aussitôt', async () => {
  await fresh60();
  await api('POST', 'import-key', { key: account.key }); // nouveau favori : importKey (celle du script) ne vaut plus
  const g = await openGame({ start: 'load' });
  await g.page('/api/packs/open', POST_JSON({}));
  await g.advance(6_000);
  assert.deepEqual(g.since(0), [], 'rien n\'est lu dans le jeu');
  assert.match(g.text(), /Script Tampermonkey périmé : .*onglet « Mettre à jour », copie le script régénéré .* et remplace l'ancien dans Tampermonkey\. Synchros automatiques en pause\./, g.text());
  assert.doesNotMatch(g.text(), /favori de ta barre/);
  assert.match(g.text(), /Réduire/, 'encart déplié');
  assert.equal(g.status(), 'Classeur relié · script périmé, synchros automatiques en pause');
  await g.page('/api/packs/open', POST_JSON({}));
  await g.advance(10 * 60_000);
  assert.deepEqual(g.posts.map((x) => x.body.mode), ['state'], 'une seule demande d\'état, puis la pause');
  assert.deepEqual(g.since(0), []);
});

await test('classeur plus ancien (« state » refusé, 400) : après un clic, lecture complète quand même ; en automatique, une erreur', async () => {
  await fresh60();
  game.siteStatus = (body) => (body.mode === 'state' ? 400 : null);
  const g = await openGame();
  await g.advance(5_000);
  assert.match(g.text(), /60 cartes envoyées au classeur/, g.text());
  assert.ok(g.since(0).includes(FULL0));
  await g.advance(15 * 60_000);
  const n = g.calls.length;
  await g.page('/api/packs/open', POST_JSON({}));
  await g.advance(6_000);
  assert.deepEqual(g.since(n), [], 'rien n\'est lu dans le jeu en automatique');
  assert.match(g.text(), /Erreur\./, g.text());
});

console.log(`${results.length} tests`);
console.log('FAVORI OK');
