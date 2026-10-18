// Test du favori de bout en bout : le vrai site/public/assets/bookmarklet.js (mis sur une ligne comme le fait
// l'interface), le vrai serveur (onRequest, D1 simulée en mémoire) et un jeu simulé dont la collection change d'une
// synchro à l'autre : lecture complète, synchro rapide (seulement les nouveautés), rien de nouveau, carte partie, et
// les cas où la synchro rapide doit céder la place à une relecture complète (avec la raison affichée). Puis le mode
// relié : la page simulée fait ses propres requêtes (paquet, défausse, enchère, échange, lectures…) par window.fetch,
// horloge virtuelle ; réponses rendues telles quelles, synchro 5 s après une action, limites (aussi entre pages et
// onglets, et d'après full_at du classeur), « Arrêter » (même en pleine synchro), erreurs, classeur en panne. Enfin les
// cotes et le marché (base du jeu simulée) : au clic, puis les cotes automatiques du mode relié (rythme, onglet caché,
// session expirée ou absente, limites entre onglets et entre appareils, « Couper », échecs et leur raison au classeur).
// Le favori est mis sur une ligne par favoriCode d'app.js (la fonction même de la page, espaces retirés).
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
// MAX_USERS : un compte neuf par scénario, bien plus que les 50 comptes permis par défaut.
const env = { DB: createD1(':memory:'), COOKIE_SECRET: 'secret-de-test', SIGNUP_CODE: 'invitation', MAX_USERS: '1000' };

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

// Le favori tel qu'installé : une ligne, adresse du classeur et clé d'import en place, par la fonction même de la page
// (favoriCode d'app.js, reprise telle quelle : espaces inutiles retirés).
const src = await readFile(path.join(root, 'site', 'public', 'assets', 'bookmarklet.js'), 'utf8');
const appSrc = await readFile(path.join(root, 'site', 'public', 'assets', 'app.js'), 'utf8');
const favoriSrc = appSrc.match(/\n( {2}function favoriCode\(src, site, key\) \{\r?\n[\s\S]*?\r?\n {2}\})\r?\n/);
assert.ok(favoriSrc, 'favoriCode introuvable dans app.js');
const favoriCode = new Function(`${favoriSrc[1]}; return favoriCode;`)();
// La page dit « ton favori n'est pas à jour » d'après la version qu'il envoie : les deux doivent concorder.
assert.equal(appSrc.match(/const FAVORI_VERSION = (\d+);/)[1], src.match(/var VERSION = (\d+);/)[1], 'FAVORI_VERSION (app.js) ≠ VERSION (bookmarklet.js)');
const oneLine = (key, start) => favoriCode(src, SITE, key)
  .replace('"__START__"', JSON.stringify(start || '__START__')); // "load" : script Tampermonkey (makeUserscript)
// favoriCode retire des espaces : le code doit rester le même. Arbre syntaxique (acorn, interne à Node : processus à part
// avec --expose-internals) du favori sur une ligne, espaces gardés ou retirés, positions mises à part : identique.
{
  const spaced = src.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join(' ');
  const script = `const acorn = require('internal/deps/acorn/acorn/dist/acorn');
    const strip = (t) => JSON.stringify(acorn.parse(t, { ecmaVersion: 2022 }), (k, v) => (['start', 'end', 'raw'].includes(k) ? undefined : v));
    const [a, b] = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    process.stdout.write(strip(a) === strip(b) ? 'same' : 'different');`;
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['--expose-internals', '-e', script], { input: JSON.stringify([spaced, favoriCode(src, '__SITE__', '__KEY__')]), encoding: 'utf8' });
  if (r.status === 0) assert.equal(r.stdout, 'same', 'favoriCode a changé le code du favori (chaîne ou expression régulière abîmée ?)');
  else console.log('  (arbre syntaxique non comparé : acorn interne indisponible dans ce Node)');
}
// Taille une fois en adresse javascript: (makeBookmarklet) : Firefox refuse un favori de plus de 65 536 caractères.
// 61 300 le 2026-10-17 (synchros sûres + cotes automatiques) : seuil à 64 000, il ne reste plus beaucoup de place.
{
  const url = 'javascript:' + encodeURI(favoriCode(src, 'https://classeur.cedric-pdp.workers.dev', 'k'.repeat(43))).replace(/#/g, '%23');
  assert.ok(url.length < 64000, `favori trop long pour Firefox : ${url.length} caractères (65 536 au plus, garder de la marge)`);
  console.log(`favori : ${url.length} caractères en adresse javascript:`);
}

// Un compte neuf, sa clé d'import et son favori (chaque scénario indépendant repart de là).
let account;
let importKey;
let code;
let accounts = 0; // prénom différent à chaque compte : l'inscription refuse un prénom déjà pris (2026-10-17)
async function newAccount() {
  account = (await api('POST', 'account', { body: { code: 'invitation', name: `Test ${++accounts}` } })).json;
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
// Favori cliqué (click) : game.siteFail(body, route) → statut d'erreur rendu à la place du classeur (rien de transmis) ;
// game.siteLose(body, route) → transmis au classeur, puis réponse perdue (échec réseau) ; game.sitePre(body, route) : appelé
// juste avant de transmettre. Mode relié : game.lagPack (les cartes d'un paquet n'arrivent dans la collection qu'avec
// game.pending, quand le test les y met).
const resetGame = () => Object.assign(game, { total: 'rows', rc: false, added: 'desc', fault: null, status: null, offline: false, weird: null, packRefused: false, auctioned: null, siteDown: false, siteStatus: null,
  siteFail: null, siteLose: null, sitePre: null, lagPack: false, pending: [] });
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
  const posts = []; // envois à /api/import
  const reports = []; // échecs signalés au journal des synchros (/api/sync-log)
  const seen = [];
  const pageFetch = async (url, init = {}) => {
    if (url.startsWith(SITE + '/api/')) {
      assert.equal(init.headers['X-Classeur-Key'], key);
      const route = url.slice(SITE.length + 5);
      const body = JSON.parse(init.body);
      if (route === 'import') posts.push(body);
      else if (route === 'sync-log') reports.push(body); // pas les envois du marché (market/plan, market/fail…)
      const failed = game.siteFail && game.siteFail(body, route);
      if (failed) return { ok: false, status: failed, json: async () => ({ error: 'Erreur interne du serveur.' }) };
      if (game.sitePre) game.sitePre(body, route);
      const r = await api('POST', route, { body, key, origin: 'https://www.wiki-masters.com' });
      if (game.siteLose && game.siteLose(body, route)) throw new TypeError('Failed to fetch');
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
  return { text: box(), seen: seen.join(' | '), posts, reports, calls };
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
  // Compteurs, pages, puis compteurs relus après la dernière page (la collection a-t-elle bougé pendant la lecture ?).
  assert.deepEqual(gameCalls, ['/api/my-collection/stats?sort=rarity', ...[0, 1, 2].map((p) => `/api/my-collection?sort=rarity&page=${p}&stats=0`), '/api/my-collection/stats?sort=rarity']);
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

await test('lecture complète : page vide passagère relue ; page manquante persistante ou pagination instable → incomplète, aucune carte retirée, le clic suivant relit tout', async () => {
  // Page vide une seule fois (alors que le jeu compte plus d'exemplaires) : relue après une pause, lecture complète.
  await newAccount();
  collection = Array.from({ length: 120 }, (_, i) => entry(i, 119 - i)); // le plus récent en tête du tri par rareté
  await click();
  collection = collection.filter((e) => e.card_id !== 'c70'); // une vente → relecture complète
  let once = true;
  game.fault = (sort, p) => {
    if (sort !== 'rarity' || p !== 1 || !once) return undefined;
    once = false;
    return [];
  };
  let r = await click();
  assert.equal(r.calls.filter((u) => u.includes('sort=rarity&page=1&')).length, 2, 'page 1 relue');
  assert.match(r.text, /119 cartes envoyées au classeur, 0 nouvelle, 1 retirée/, r.seen);
  assert.equal((await cardsOf()).length, 119);
  for (const fault of [
    (sort, p) => (sort === 'rarity' && p === 1 ? [] : undefined),
    (sort, p, page, list) => (sort === 'rarity' && p === 1 ? list.slice(49, 99) : undefined),
  ]) {
    await newAccount();
    collection = Array.from({ length: 120 }, (_, i) => entry(i, 119 - i));
    await click();
    collection = collection.filter((e) => e.card_id !== 'c70');
    game.fault = fault;
    r = await click();
    assert.match(r.text, /Il en manque par rapport au total du jeu .*: aucune carte n'a été retirée de ton classeur \(\d+ cartes? non vues?, gardées? pour l'instant\)\. Relance le favori dans un moment\./, r.seen);
    assert.equal((await cardsOf()).length, 120, 'une lecture incomplète ne retire aucune carte');
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

await test('catégorie du jeu de plus de 500 caractères : coupée, la carte rangée quand même ; catégorie changée par le jeu reprise par la synchro rapide', async () => {
  await fresh60();
  collection.push(entry(901, 500, {}, { category: 'é'.repeat(700) }));
  collection.push(entry(3, 501, { id: 'e3-ter' }, { category: 'maladie infectieuse' }));
  let r = await click();
  assert.match(r.text, /2 exemplaires obtenus depuis ta dernière synchro, 1 nouvelle carte : ton classeur est à jour \(61 cartes\)/, r.seen);
  let cards = await cardsOf();
  assert.equal(cards.find((c) => c.id === 'c901').category, 'é'.repeat(500));
  assert.deepEqual([cards.find((c) => c.id === 'c3').category, cards.find((c) => c.id === 'c3').count], ['maladie infectieuse', 2]);
  // Lecture complète : toujours rangée (plus « ignorée »).
  collection = collection.filter((e) => e.card_id !== 'c7');
  r = await click();
  assert.match(r.text, /60 cartes envoyées au classeur, 0 nouvelle/, r.seen);
  assert.ok(!/ignorée/.test(r.text), r.text);
  cards = await cardsOf();
  assert.equal(cards.find((c) => c.id === 'c901').category, 'é'.repeat(500));
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

// --- Sûreté des synchros et journal des synchros ------------------------------------------------------------------

const VERSION = Number(src.match(/var VERSION = (\d+);/)[1]);
const syncLog = async () => (await api('GET', 'sync-log', { key: account.key })).json.entries;

await test('version du favori : la même que celle que le classeur annonce ; un favori plus ancien le dit à la fin de sa synchro', async () => {
  const { FAVORI_VERSION } = await import(pathToFileURL(path.join(root, 'site', 'functions', '_lib', 'import.js')).href);
  assert.equal(VERSION, FAVORI_VERSION, 'bookmarklet.js (VERSION) et import.js (FAVORI_VERSION) doivent concorder');
  await fresh60();
  const current = code;
  code = oneLine(importKey).replace(/var VERSION\s*=\s*\d+;/, `var VERSION=${VERSION - 1};`); // favoriCode retire les espaces
  assert.ok(code.includes(`var VERSION=${VERSION - 1};`), 'version du favori non remplacée');
  try {
    const r = await click();
    assert.match(r.text, /Rien de nouveau.*Une nouvelle version du favori existe : remplace celui-ci/, r.seen);
  } finally {
    code = current;
  }
  const r = await click();
  assert.ok(!/nouvelle version du favori/.test(r.text), r.text);
});

await test('journal : la lecture envoie son début (heure du classeur), son chemin, sa version, les compteurs relus et sa raison ; une ligne par synchro', async () => {
  await newAccount();
  collection = Array.from({ length: 60 }, (_, i) => entry(i, i));
  let r = await click();
  const full = r.posts[1];
  assert.deepEqual([full.via, full.v, full.reason, full.stats_end, full.started], ['clic', VERSION, 'state', { total: 60, totalUnique: 60 }, new Date(clock.now).toISOString()]);
  let [e] = await syncLog();
  assert.deepEqual([e.kind, e.result, e.data.via, e.data.reason, e.data.v, e.data.count], ['full', 'ok', 'clic', 'state', VERSION, 60]);
  assert.match(e.message, /^Lecture complète \(pas de synchro rapide possible/);
  collection.push(entry(100, 100));
  r = await click();
  const delta = r.posts.find((b) => b.mode === 'delta');
  assert.deepEqual([delta.via, delta.v, delta.started], ['clic', VERSION, new Date(clock.now).toISOString()]);
  [e] = await syncLog();
  assert.deepEqual([e.kind, e.result, e.message], ['quick', 'ok', 'Synchro rapide : 1 exemplaire obtenu, 1 nouvelle carte (61 cartes).']);
  // Une carte vendue : la relecture complète dit pourquoi (raison venue du classeur, needs_full « counts »).
  collection = collection.filter((x) => x.card_id !== 'c3');
  r = await click();
  assert.equal(r.posts.at(-1).reason, 'counts');
  [e] = await syncLog();
  assert.match(e.message, /^Lecture complète \(les compteurs du jeu ne collaient pas avec les nouveautés\) : 60 cartes, aucune nouvelle, 1 retirée\.$/);
  assert.match(r.text, /60 cartes envoyées au classeur, 0 nouvelle, 1 retirée \(plus dans ta collection\)\./, r.seen);
});

await test('échec vu par le favori (session du jeu, réponse inattendue) : message clair, signalé au journal du classeur, sans jeton ni cookie', async () => {
  await fresh60();
  game.status = (url) => (url.includes('stats') ? reply({ error: 'Unauthorized' }, 401) : null);
  let r = await click();
  assert.match(r.text, /Connecte-toi à WikiMasters \(ta session du jeu a expiré ou n'est pas ouverte dans cette page\).*Rien n'a été changé dans ton classeur\./, r.seen);
  assert.equal(r.reports.length, 1);
  const sent = r.reports[0];
  assert.deepEqual(Object.keys(sent).sort(), ['code', 'kind', 'message', 'ms', 'v', 'via']);
  assert.deepEqual([sent.kind, sent.code, sent.via, sent.v], ['quick', 'session', 'clic', VERSION]);
  assert.ok(!JSON.stringify(r.reports).includes(importKey) && !JSON.stringify(r.reports).includes('SECRET'), 'ni clé ni donnée du jeu');
  let [e] = await syncLog();
  assert.deepEqual([e.kind, e.result, e.data.client, e.data.code, e.data.via, e.message], ['quick', 'error', true, 'session', 'clic', sent.message]);
  // Réponse sans liste en pleine lecture complète (compte neuf) : code « format », exemplaires lus avant l'arrêt.
  await newAccount();
  collection = Array.from({ length: 120 }, (_, i) => entry(i, i));
  game.status = null;
  game.fault = (sort, p) => (p === 1 ? null : undefined);
  r = await click();
  assert.deepEqual([r.reports.length, r.reports[0].code, r.reports[0].kind, r.reports[0].read, r.reports[0].reason], [1, 'format', 'full', 50, 'state']);
  [e] = await syncLog();
  assert.match(e.message, /^Réponse inattendue de WikiMasters \(pas de liste de cartes\)/);
  // Refus du classeur (favori périmé) : il l'a noté lui-même, ou ne reconnaît plus la clé ; rien de signalé en plus.
  await api('POST', 'import-key', { key: account.key });
  r = await click();
  assert.deepEqual(r.reports, []);
});

await test('limite de lectures du jeu en pleine lecture complète : pause puis reprise à la même page ; une seconde limite arrête tout (signalée)', async () => {
  await newAccount();
  collection = Array.from({ length: 120 }, (_, i) => entry(i, i));
  let n = 0;
  game.status = (url) => (url.includes('sort=rarity&page=1&') && n++ === 0 ? reply({ code: 'automation_limit' }, 403) : null);
  let r = await click();
  assert.match(r.seen, /Le jeu demande de ralentir : reprise de la lecture à \d\d:\d\d \(50 exemplaires lus\)… « Arrêter » l'annule\./);
  assert.match(r.text, /120 cartes envoyées au classeur/, r.seen);
  assert.equal(r.calls.filter((u) => u.includes('sort=rarity&page=1&')).length, 2);
  assert.equal((await cardsOf()).length, 120);
  await newAccount();
  game.status = (url) => (url.includes('sort=rarity&page=1&') ? reply({ code: 'automation_limit' }, 403) : null);
  r = await click();
  assert.match(r.text, /Le jeu limite les lectures automatiques : réessaie plus tard \(dans une dizaine de minutes\)\. Rien n'a été changé dans ton classeur\./, r.seen);
  assert.deepEqual(r.posts.map((b) => b.mode), ['state'], 'rien envoyé');
  assert.deepEqual([r.reports.length, r.reports[0].code, r.reports[0].kind, r.reports[0].read], [1, 'limit', 'full', 50]);
});

await test('envoi en morceaux : panne passagère du classeur (500, réponse perdue) → morceau renvoyé, rien de mélangé ni de 409', async () => {
  await newAccount();
  collection = Array.from({ length: 1200 }, (_, i) => entry(i, i));
  let fails = 0;
  game.siteFail = (body, route) => (route === 'import' && body.part === 1 && fails++ < 2 ? 500 : 0);
  let r = await click();
  assert.match(r.text, /1\s200 cartes envoyées au classeur/, r.seen);
  assert.equal(r.posts.filter((b) => b.part === 1).length, 3, 'deux nouveaux essais');
  assert.equal((await cardsOf()).length, 1200);
  // Dernier morceau appliqué mais réponse perdue : renvoyé, le classeur rend le même résultat.
  game.siteFail = null;
  collection = collection.filter((x) => x.card_id !== 'c5');
  let lost = true;
  game.siteLose = (body, route) => {
    if (route !== 'import' || !body.last || !lost) return false;
    lost = false;
    return true;
  };
  r = await click();
  assert.match(r.text, /1\s199 cartes envoyées au classeur/, r.seen);
  assert.equal(r.posts.filter((b) => b.last).length, 2);
  assert.equal((await cardsOf()).length, 1199);
  // 503 (quota du jour du classeur) : pas de nouvel essai, son message.
  game.siteLose = null;
  game.siteFail = (body, route) => (route === 'import' && body.part === 0 && body.upload_id ? 503 : 0);
  collection = collection.filter((x) => x.card_id !== 'c6');
  r = await click();
  assert.equal(r.posts.filter((b) => b.part === 0).length, 1);
});

await test('deux synchros en même temps : une lecture commencée avant celle déjà appliquée ne passe pas par-dessus (« Une synchro plus récente… »)', async () => {
  await fresh60();
  collection = collection.filter((e) => e.card_id !== 'c7'); // une vente → relecture complète
  // Pendant l'envoi, une lecture commencée plus tard (autre onglet) est appliquée.
  game.sitePre = (body, route) => {
    if (route === 'import' && body.last) {
      env.DB.sqlite.prepare("UPDATE users SET sync_state = json_set(sync_state, '$.read_at', ?) WHERE id = ?").run(new Date(clock.now + 1000).toISOString(), account.user.id);
    }
  };
  const r = await click();
  assert.match(r.text, /Une synchro plus récente \(autre onglet, favori relié ou rafraîchissement\) est déjà passée : ton classeur est à jour \(60 cartes\)\./, r.seen);
  assert.ok(await cardOf('c7'), 'rien appliqué');
});

await test('délai d\'attente : une requête du jeu qui ne répond plus n\'immobilise plus le favori (30 s), échec signalé', async () => {
  await fresh60();
  const { doc } = makeDom();
  const timers = [];
  const reports = [];
  const pageFetch = async (url, init = {}) => {
    if (url.startsWith(SITE + '/api/')) {
      const route = url.slice(SITE.length + 5);
      const body = JSON.parse(init.body);
      if (route === 'sync-log') reports.push(body);
      const r = await api('POST', route, { body, key: importKey, origin: GAME });
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
    }
    // Le jeu ne répond jamais aux compteurs : seule l'interruption (AbortController) rend la main.
    if (url.includes('/stats')) {
      assert.ok(init.signal, 'requête du jeu sans délai d\'attente');
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('The operation was aborted.'))));
    }
    return gameFetch(url);
  };
  // Minuteries : celles de moins de 30 s partent aussitôt ; les délais d'attente (30 s et plus) quand le test le décide.
  const ctx = { document: doc, location: { hostname: 'www.wiki-masters.com', origin: GAME, href: GAME + '/collection', pathname: '/collection', search: '' }, fetch: pageFetch,
    AbortController,
    setTimeout: (f, ms) => {
      const t = { f, ms, cleared: false };
      timers.push(t);
      if (ms < 30000) setImmediate(() => { if (!t.cleared) f(); });
      return timers.length;
    },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    URL, Promise, JSON, Math, Date, Number, String, Array, Object, Error, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const settle = async () => { for (let i = 0; i < 200; i++) await new Promise((ok) => setImmediate(ok)); };
  await settle();
  assert.equal(ctx.__classeurFavori, true, 'la synchro attend le jeu');
  const pending = timers.filter((t) => t.ms === 30000 && !t.cleared);
  assert.equal(pending.length, 1);
  pending[0].f();
  await settle();
  const text = doc.getElementById('classeur-favori').textContent;
  assert.match(text, /WikiMasters ne répond plus \(30 s sans réponse\) : réessaie dans un moment\. Rien n'a été changé dans ton classeur\./);
  assert.equal(ctx.__classeurFavori, false, 'le favori a rendu la main');
  assert.deepEqual([reports.length, reports[0].code], [1, 'timeout']);
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
async function openGame({ start = 'click', pathname = '/collection', answers = [], tab = false, storage = memoryStorage(), onPost = null, cookie = '' } = {}) {
  const { doc } = makeDom();
  doc.cookie = cookie; // cookies de la page lisibles en JavaScript (session du jeu : supa.cookie)
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
      if (game.lagPack) game.pending.push(...fresh); else collection.push(...fresh);
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
    if (url.startsWith('https://cyrxjeppjqsxxjayfrur.supabase.co/')) return Promise.resolve(supaFetch(url, init)); // base du jeu (cotes)
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
    URL, URLSearchParams, Date, Promise, JSON, Math, Number, String, Array, Object, Error, TypeError, console, atob,
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

await test('relié : paquet ouvert mais « Rien de nouveau » (cartes pas encore rangées par le jeu) → une seule vérification, une minute après', async () => {
  await fresh60();
  const g = await openGame();
  await g.advance(15 * 60_000);
  game.lagPack = true;
  let n = g.calls.length;
  await g.page('/api/packs/open', POST_JSON({}));
  await g.advance(6_000);
  assert.deepEqual(g.since(n), QUICK);
  assert.match(g.text(), /Rien de nouveau depuis ta dernière synchro/, g.text());
  assert.match(g.status(), /synchro à \d\d:\d\d \(vérification après le paquet ; une par minute au plus\)/, g.status());
  // Les cartes arrivent ; la vérification les trouve.
  collection.push(...game.pending);
  game.pending = [];
  n = g.calls.length;
  await g.advance(60_000);
  assert.deepEqual(g.since(n), QUICK);
  assert.match(g.text(), /5 exemplaires obtenus depuis ta dernière synchro, 5 nouvelles cartes/, g.text());
  assert.equal((await cardsOf()).length, 65);
  // Une seule vérification par action : plus rien ensuite, même si elle n'avait rien trouvé.
  // (synchro du paquet une minute après la précédente au moins, puis sa vérification une minute plus tard)
  game.lagPack = true;
  n = g.calls.length;
  await g.page('/api/packs/open', POST_JSON({}));
  await g.advance(3 * 60_000);
  assert.deepEqual(g.since(n), [...QUICK, ...QUICK], 'la synchro du paquet et sa vérification');
  n = g.calls.length;
  await g.advance(30 * 60_000);
  assert.deepEqual(g.since(n), [], 'pas de troisième synchro');
  game.lagPack = false;
  game.pending = [];
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
  assert.deepEqual(buttons(), [...CHOICES, 'Synchroniser', 'Mettre à jour les cotes', 'Réduire', 'Arrêter', 'Couper les cotes automatiques']);
  await g.page('/api/packs/open', POST_JSON({}));
  await g.advance(6_000);
  assert.match(g.text(), /5 exemplaires obtenus depuis ta dernière synchro/, g.text());
  assert.match(g.text(), /Collection globale : que veux-tu faire \?/, g.text());
  assert.deepEqual(buttons(), [...CHOICES, 'Synchroniser', 'Mettre à jour les cotes', 'Réduire', 'Arrêter', 'Couper les cotes automatiques']);
  g.press('Créer une collection avec une recherche…');
  await g.advance(1_000);
  assert.match(g.text(), /Collection « Mes vaches » créée dans ton classeur : 87 cartes/, g.text());
  assert.deepEqual(buttons(), ['Synchroniser', 'Mettre à jour les cotes', 'Réduire', 'Arrêter', 'Couper les cotes automatiques'], 'choix retirés une fois l\'un d\'eux pris');
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

// --- Cotes et marché : « Mettre à jour les cotes », base du jeu simulée (Supabase, PostgREST) ------------------------
// supa.token : le seul jeton accepté (sinon 401 « JWT expired ») ; supa.fail(url, n) peut rendre une erreur au n-ième
// appel ; tables : cards (titre -> id), ventes et enchères en cours (auctions), enchères posées (auction_bids).
const ANON_KEY = src.match(/var ANON = "([^"]+)"/)[1];
const supa = {};
const resetSupa = () => Object.assign(supa, { calls: [], token: 'jeton-acces-1', cards: [], auctions: [], bids: [], fail: null, after: null });
resetSupa();
const SESSION_COOKIE = 'sb-cyrxjeppjqsxxjayfrur-auth-token';
const UID = 'uid-joueur-7f3a';
const REFRESH = 'jeton-de-renouvellement-a-usage-unique';
const b64url = (t) => Buffer.from(t, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// Cookie de session comme le pose la page du jeu (@supabase/ssr) : « base64- » + JSON en base64url, découpé en .0, .1…
// au-delà de `chunk` caractères ; prefix = false : JSON encodé pour l'adresse (anciennes versions).
function sessionCookie({ token = supa.token, exp = Math.floor(clock.now / 1000) + 3600, chunk = 0, prefix = true } = {}) {
  const json = JSON.stringify({ access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: REFRESH, user: { id: UID, email: 'joueur@example.org', user_metadata: { name: 'Joueur é' } } });
  const value = prefix ? 'base64-' + b64url(json) : encodeURIComponent(json);
  if (!chunk) return `theme=sombre; ${SESSION_COOKIE}=${value}; autre=1`;
  const parts = [];
  for (let i = 0; i * chunk < value.length; i++) parts.push(`${SESSION_COOKIE}.${i}=${value.slice(i * chunk, (i + 1) * chunk)}`);
  return ['theme=sombre', ...parts].join('; ');
}
// in.("a","b, c") de PostgREST -> ['a', 'b, c'] (guillemets et barres obliques inverses).
function pgList(v) {
  const out = [];
  let cur = '';
  let q = false;
  let esc = false;
  for (const ch of v.slice(4, -1)) {
    if (esc) { cur += ch; esc = false; } else if (q && ch === '\\') esc = true;
    else if (ch === '"') q = !q;
    else if (!q && ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
function supaFetch(url, init) {
  const headers = (init && init.headers) || {};
  supa.calls.push({ url, at: clock.now, headers: { ...headers } });
  clock.ticks += 1;
  if (init && init.method && init.method !== 'GET') throw new Error('écriture dans la base du jeu : ' + url);
  if (headers.apikey !== ANON_KEY) return reply({ message: 'Invalid API key' }, 401);
  const forced = supa.fail && supa.fail(url, supa.calls.length);
  if (forced) return reply(forced.body, forced.status);
  if (headers.Authorization !== 'Bearer ' + supa.token) return reply({ code: 'PGRST301', message: 'JWT expired' }, 401);
  const u = new URL(url);
  assert.equal(u.pathname.startsWith('/rest/v1/'), true, 'seulement les tables (REST), jamais /auth : ' + url);
  const rows0 = { cards: supa.cards, auctions: supa.auctions, auction_bids: supa.bids }[u.pathname.slice(9)];
  if (!rows0) throw new Error('table inattendue : ' + url);
  let rows = rows0.filter((r) => [...u.searchParams].every(([k, v]) => {
    if (['select', 'order', 'limit', 'offset'].includes(k)) return true;
    const x = r[k] === undefined || r[k] === null ? null : String(r[k]);
    if (v.startsWith('eq.')) return x === v.slice(3);
    if (v.startsWith('gte.')) return x !== null && x >= v.slice(4);
    if (v.startsWith('gt.')) return x !== null && x > v.slice(3);
    if (v.startsWith('in.')) return pgList(v).includes(x);
    throw new Error('filtre inattendu : ' + k + '=' + v);
  }));
  const order = (u.searchParams.get('order') || '').split(',').filter(Boolean).map((o) => o.split('.'));
  rows = rows.slice().sort((a, b) => {
    for (const [c, d] of order) if (a[c] !== b[c]) return (a[c] < b[c] ? -1 : 1) * (d === 'desc' ? -1 : 1);
    return 0;
  });
  const limit = Number(u.searchParams.get('limit') || 1000);
  assert.ok(limit <= 1000, 'limit ≤ 1 000');
  const off = Number(u.searchParams.get('offset') || 0);
  if (supa.after) supa.after(supa.calls.length);
  return reply(rows.slice(off, off + limit));
}
const iso = (ms) => new Date(ms).toISOString();
const sale = (card, rarity, price, ageMs, shiny = false) => ({ id: `v${supa.auctions.length}`, card_id: card, status: 'settled_sold', snapshot_rarity: rarity, is_shiny: shiny,
  final_price: price, settled_at: iso(clock.now - ageMs), end_at: iso(clock.now - ageMs - 1000), seller_id: 'vendeur', winner_id: 'acheteur' });
const H = 3600_000;
const supaPaths = () => supa.calls.map((c) => decodeURIComponent(c.url.slice('https://cyrxjeppjqsxxjayfrur.supabase.co/rest/v1/'.length)));
const pricesOf = async (ids) => {
  const all = [];
  for (let part = '0'; part !== null;) {
    const r = (await api('GET', `market/prices?part=${encodeURIComponent(part)}`, { key: account.key })).json;
    all.push(...r.prices);
    part = r.next_part;
  }
  return ids ? Object.fromEntries(ids.map((id) => [id, (all.find((x) => x.id === id) || {}).v])) : all;
};
// Cartes envoyées au classeur sans passer par le jeu (clé principale, morceaux de 500).
async function importDirect(ids) {
  let r = null;
  for (let p = 0; p * 500 < ids.length; p++) {
    r = await api('POST', 'import', { key: account.key, body: { upload_id: 'direct', part: p, last: (p + 1) * 500 >= ids.length, cards: ids.slice(p * 500, (p + 1) * 500).map((id) => ({ id, title: 'Titre ' + id, rarity: 'C', count: 1 })) } });
  }
  return r;
}
async function pressCotes(g, ms = 120_000) {
  g.press('Mettre à jour les cotes');
  await g.advance(ms);
  return g.text();
}

await test('cotes : médiane des 30 ventes (fiable dès 3), 7 jours, brillance et rareté à part ; bonnes affaires, enchères, ventes ; une requête par seconde ; jeton jamais envoyé', async () => {
  await newAccount();
  collection = Array.from({ length: 60 }, (_, i) => entry(i, i, i === 4 ? { snapshot_rarity: 'R' } : {}));
  resetSupa();
  const item = (title) => ({ title, description: null, image: null, status: 'ok' });
  const odd = 'Avec, virgule (et "guillemets")';
  await api('POST', 'targets/save', { key: account.key, body: { name: 'Envies', items: ['Voulue 1', 'Voulue 2', odd, 'Carte 3', 'Inconnue'].map(item) } });
  const g = await openGame({ cookie: sessionCookie() });
  await g.advance(5_000);
  assert.match(g.text(), /60 cartes envoyées au classeur/, g.text());
  assert.deepEqual((await cardOf('c4')).variants, { R: 1 }, 'rareté de l\'exemplaire (snapshot_rarity) envoyée');
  assert.deepEqual((await cardOf('c5')).variants, { C: 1 });
  assert.equal(supa.calls.length, 0, 'aucune lecture de la base du jeu avant la première lecture automatique (une minute après le clic)');
  supa.cards = [{ id: 'w1', wikipedia_title: 'Voulue 1', lang: 'fr' }, { id: 'w2-en', wikipedia_title: 'Voulue 2', lang: 'en' }, { id: 'w2', wikipedia_title: 'Voulue 2', lang: 'fr' },
    { id: 'w3', wikipedia_title: odd, lang: 'fr' }, { id: 'c3', wikipedia_title: 'Carte 3', lang: 'fr' }];
  // Ventes : c0 en R (40, dont 11 de plus de 7 jours), en R brillante (3), en C (2 : pas fiable) ; c2 : une seule, de
  // plus de 90 jours (pas lue) ; les cartes voulues w1 (R), w2 (SR), w3 (C).
  const t0 = clock.now;
  for (let i = 0; i < 40; i++) supa.auctions.push(sale('c0', 'R', i + 1, (i * 6 + 1) * H));
  supa.auctions.push(sale('c0', 'R', 999, 2 * H, true), sale('c0', 'R', 100, 3 * H, true), sale('c0', 'R', 200, 4 * H, true));
  supa.auctions.push(sale('c0', 'C', 5, H), sale('c0', 'C', 7, 2 * H), sale('c2', 'C', 50, 100 * 24 * H));
  for (let i = 0; i < 5; i++) supa.auctions.push(sale('w1', 'R', 100, i * H), sale('w2', 'SR', 100, i * H));
  for (let i = 0; i < 3; i++) supa.auctions.push(sale('w3', 'C', 100, i * H));
  const card = (t) => ({ wikipedia_title: t, image_url: 'https://upload.wikimedia.org/' + t.length + '.jpg', hide_image: false });
  const active = (id, cardId, rarity, extra) => ({ id, card_id: cardId, status: 'active', snapshot_rarity: rarity, is_shiny: false, seller_id: 'vendeur', current_bid: null,
    current_bidder_id: null, base_amount: 10, card: card('Titre du jeu ' + cardId), ...extra });
  supa.auctions.push(
    active('a1', 'w1', 'R', { base_amount: 50, end_at: iso(clock.now + H) }), // sans enchère, finit dans 1 h, 50 % de la cote
    active('a1b', 'w1', 'R', { base_amount: 90, end_at: iso(clock.now + 1.5 * H) }), // finit bientôt : sans enchère, < 2 h, départ ≤ cote
    active('a2', 'w2', 'SR', { current_bid: 70, current_bidder_id: 'quelqu-un', base_amount: 20, end_at: iso(clock.now + 5 * H) }), // 70 % de la cote
    active('a3', 'w3', 'C', { current_bid: 95, current_bidder_id: 'quelqu-un', end_at: iso(clock.now + 3 * H) }), // 95 % : pas une affaire
    active('a3b', 'w3', 'C', { base_amount: 90, end_at: iso(clock.now + 3 * H) }), // sans enchère mais plus de 2 h
    active('a4', 'w1', 'R', { seller_id: UID, base_amount: 1, end_at: iso(clock.now + H) }), // la mienne
    active('a5', 'w1', 'R', { is_shiny: true, base_amount: 1, end_at: iso(clock.now + H) }), // brillante : pas de cote
    active('a6', 'w3', 'C', { current_bid: 85, current_bidder_id: UID, end_at: iso(clock.now + 4 * H) }), // j'y mène, 85 % : pas une affaire
    // Mes ventes : en cours avec une enchère, vendue, invendue, trop ancienne.
    active('s1', 'c5', 'C', { seller_id: UID, base_amount: 30, current_bid: 35, current_bidder_id: 'x', end_at: iso(clock.now + 2 * H) }),
    { ...active('s2', 'c6', 'C', { seller_id: UID, base_amount: 30, end_at: iso(clock.now - 30 * H) }), status: 'settled_sold', final_price: 70 },
    { ...active('s3', 'c7', 'C', { seller_id: UID, base_amount: 30, end_at: iso(clock.now - 40 * H) }), status: 'settled_unsold' },
    { ...active('s4', 'c8', 'C', { seller_id: UID, base_amount: 30, end_at: iso(clock.now - 20 * 24 * H) }), status: 'settled_sold', final_price: 1 },
  );
  const auctionOf = (id) => supa.auctions.find((a) => a.id === id);
  const bid = (auction, amount, ageMs) => ({ bidder_id: UID, amount, placed_at: iso(clock.now - ageMs), auction: auctionOf(auction) });
  supa.auctions.push({ ...active('a7', 'c9', 'C', { end_at: iso(clock.now - 5 * H) }), status: 'settled_sold', final_price: 80, winner_id: UID },
    { ...active('a8', 'c9', 'C', { end_at: iso(clock.now - 6 * H) }), status: 'settled_sold', final_price: 120, winner_id: 'autre' });
  supa.bids = [bid('a6', 85, H), bid('a6', 40, 2 * H), bid('a7', 80, 6 * H), bid('a8', 110, 7 * H), { ...bid('a8', 5, 30 * 24 * H) }];
  for (let i = 5; i < 10; i++) supa.auctions.push(sale(`c${i}`, 'C', 40, i * H), sale(`c${i}`, 'C', 50, i * H), sale(`c${i}`, 'C', 60, i * H));
  const posted0 = g.posts.length;
  const text = await pressCotes(g);
  assert.match(text, /Cotes lues : 6\d cartes, tes cotes sont à jour\. 2 bonnes affaires, 1 de tes enchères en cours : onglet « Marché » du classeur\./, text);
  // Rythme et plafond : une requête par seconde au plus, 30 au plus, après la demande du plan au classeur.
  assert.ok(supa.calls.length <= 30, `${supa.calls.length} requêtes`);
  for (let i = 1; i < supa.calls.length; i++) assert.ok(supa.calls[i].at - supa.calls[i - 1].at >= 1000, `requêtes ${i} et ${i + 1} à moins d'une seconde`);
  const routes = g.posts.slice(posted0).map((x) => x.route);
  // Plan d'abord ; la lecture du marché dès qu'elle est prête (avant les cotes du plan) ; les cotes à la fin (last: true).
  assert.deepEqual([routes[0], routes[routes.length - 1], routes.filter((x) => x === 'market/live').length], ['market/plan', 'market/prices', 1]);
  assert.ok(routes.indexOf('market/live') < routes.indexOf('market/prices'), routes.join(', '));
  assert.equal(g.posts.slice(posted0).find((x) => x.route === 'market/plan').body.v, VERSION, 'version du favori envoyée avec le plan');
  assert.ok(g.posts.slice(posted0).find((x) => x.route === 'market/plan').at <= supa.calls[0].at, 'plan demandé avant toute lecture du jeu');
  const paths = supaPaths();
  assert.ok(paths.some((p) => p.startsWith('auction_bids?') && p.includes(`bidder_id=eq.${UID}`)), 'mes enchères');
  assert.ok(paths.some((p) => p.startsWith('auctions?') && p.includes(`seller_id=eq.${UID}`)), 'mes ventes');
  assert.ok(paths.some((p) => p.startsWith('cards?') && p.includes('wikipedia_title=in.("Voulue 1","Voulue 2","Avec, virgule (et \\"guillemets\\")","Inconnue")')), 'titres entre guillemets');
  assert.ok(paths.some((p) => p.includes('status=eq.active') && p.includes('card_id=in.("w1","w2","w3")') && p.includes('order=end_at')), 'enchères en cours des cartes voulues');
  assert.ok(paths.filter((p) => p.includes('status=eq.settled_sold')).every((p) => p.includes('order=card_id,settled_at.desc,id&limit=1000&offset=')), 'ventes : ordre stable, pages de 1 000');
  assert.ok(!paths.some((p) => p.includes('/api/marketplace')) && !g.calls.some((c) => c.url.includes('marketplace')), 'jamais les routes du marché du site du jeu');
  // Le jeton : seulement dans l'en-tête des requêtes à la base du jeu, jamais au classeur, dans l'encart ni renouvelé.
  assert.ok(supa.calls.every((c) => c.headers.Authorization === 'Bearer ' + supa.token && c.headers.apikey === ANON_KEY));
  const outgoing = JSON.stringify(g.posts) + JSON.stringify(supa.calls);
  assert.ok(!outgoing.includes(REFRESH), 'jeton de renouvellement utilisé');
  assert.ok(!JSON.stringify(g.posts).includes(supa.token) && !JSON.stringify(g.posts).includes(UID), 'jeton ou identifiant du joueur envoyé au classeur');
  assert.ok(!g.text().includes(supa.token) && !(g.storage.keys ? g.storage.keys().some((k) => k.includes('token')) : false), 'jeton dans l\'encart ou le stockage');
  // Les cotes rangées par le classeur.
  const v = await pricesOf(['c0', 'c1', 'c2', 'c5']);
  // R : médiane des 30 plus récentes (1 à 30), 40 ventes ; il y a 7 jours : médiane des 12 plus anciennes (29 à 40).
  assert.deepEqual(v.c0.R, { p: 15.5, n: 40, w: 34.5, l: 1, d: iso(t0 - H) });
  assert.deepEqual(v.c0['R*'], { p: 200, n: 3, w: null, l: 999, d: iso(t0 - 2 * H) }, 'brillantes à part');
  assert.deepEqual(v.c0.C, { p: 6, n: 2, w: null, l: 5, d: iso(t0 - H) }, 'rareté d\'exemplaire à part (2 ventes : pas fiable)');
  assert.deepEqual([v.c1, v.c2], [{}, {}], 'sans vente sur 90 jours : datée, sans cote');
  assert.equal(v.c5.C.p, 50);
  // La lecture du marché, montrée par la page.
  const m = (await api('GET', 'market', { key: account.key })).json;
  assert.deepEqual(m.live.deals.map((d) => [d.a, d.ask, d.bid, d.cote, d.t]), [['a1', 50, false, 100, 'Voulue 1'], ['a2', 70, true, 100, 'Voulue 2']]);
  assert.deepEqual(m.live.deals.map((d) => d.more), [1, 0], 'la moins chère par carte, les autres comptées (a1b)');
  assert.deepEqual([m.attempt.ok, m.attempt.v, m.attempt.auto], [true, VERSION, false], 'essai noté réussi');
  assert.deepEqual(m.live.bids.map((b) => [b.a, b.st, b.mine, b.cur, b.lead, b.cote]), [['a6', 'run', 85, 85, true, 100], ['a7', 'won', 80, 80, false, 50], ['a8', 'lost', 110, 120, false, 50]]);
  assert.deepEqual(m.live.sales.map((x) => [x.a, x.st, x.base, x.cur, x.bid]), [['s1', 'run', 30, 35, true], ['a4', 'run', 1, null, false], ['s2', 'sold', 30, 70, false], ['s3', 'unsold', 30, null, false]]);
  assert.equal(m.live.deals[0].img, 'https://upload.wikimedia.org/' + 'Titre du jeu w1'.length + '.jpg');
  assert.ok(!JSON.stringify(m.live).includes(UID) && !JSON.stringify(m.live).includes('quelqu-un'), 'identifiants du jeu dans la lecture du marché');
  // Valeur : c5 à c9 (C, 3 ventes à 40, 50, 60 : 50) ; c0 a son exemplaire en C (2 ventes : pas fiable), c4 en R (pas de cote).
  assert.deepEqual(m.value, { value: 250, priced: 5, cards: 60, approx: 0 });
  // Les titres résolus restent : le clic suivant ne les cherche plus ; cotes fraîches (moins de 12 h) pas relues.
  const n0 = supa.calls.length;
  const again = await pressCotes(g);
  assert.ok(!supaPaths().slice(n0).some((p) => p.startsWith('cards?')), 'titres déjà résolus redemandés');
  assert.ok(!supaPaths().slice(n0).some((p) => p.includes('status=eq.settled_sold') && p.includes('"c1"')), 'cote fraîche relue');
  assert.match(again, /tes cotes sont à jour/, again);
  // Cotes des enchères en cours lues il y a moins d'une heure dans cette page : pas relues, les bonnes affaires restent.
  assert.ok(!supaPaths().slice(n0).some((p) => p.includes('status=eq.settled_sold') && p.includes('"w1"')), "cote d'une enchère relue moins d'une heure après");
  assert.deepEqual((await api('GET', 'market', { key: account.key })).json.live.deals.map((d) => [d.a, d.cote]), [['a1', 100], ['a2', 100]]);
  resetSupa();
});

await test('cotes : 30 requêtes au plus par lecture ; la suivante reprend aux cotes les plus anciennes ; pages stables de 1 000 ventes ; quota du jour', async () => {
  await newAccount();
  resetSupa();
  const ids = Array.from({ length: 2950 }, (_, i) => `p${String(i).padStart(4, '0')}`);
  const r = await importDirect(ids);
  assert.equal(r.json.count, 2950);
  for (let i = 0; i < 1200; i++) supa.auctions.push(sale('p0000', 'C', 10 + (i % 7), (i + 1) * 60_000));
  const g = await openGame({ start: 'load', cookie: sessionCookie() });
  const t1 = await pressCotes(g);
  assert.equal(supa.calls.length, 30, 'plafond de 30 requêtes');
  assert.match(t1, /Cotes lues : 2\s700 cartes \(il en reste 250 : la prochaine lecture continue, les plus anciennes d'abord\)/, t1);
  const paths = supaPaths();
  const first = paths.filter((p) => p.includes('"p0000"'));
  assert.deepEqual(first.map((p) => p.match(/offset=(\d+)/)[1]), ['0', '1000'], 'deux pages, dans le même ordre');
  assert.equal((await pricesOf()).length, 2700);
  assert.deepEqual((await pricesOf(['p0000'])).p0000.C.n, 1200);
  const asked = (list) => list.filter((p) => p.includes('settled_sold')).flatMap((p) => pgList(p.match(/card_id=(in\.\([^)]*\))/)[1]));
  const before = new Set(asked(paths));
  supa.calls = [];
  await g.advance(60_000);
  const t2 = await pressCotes(g);
  const now = asked(supaPaths());
  assert.equal(new Set(now).size, 250, t2);
  assert.ok(now.every((id) => !before.has(id)), 'le second clic reprend là où le premier s\'est arrêté');
  assert.match(t2, /Cotes lues : 250 cartes, tes cotes sont à jour/, t2);
  // Quota du classeur (15 000 par jour) : 2 950 envoyées ; le reste du jour, 12 050 au plus.
  const plan = (await api('POST', 'market/plan', { key: importKey, body: {} })).json;
  assert.deepEqual([plan.cards.length, plan.quota], [0, 12050]);
  // Quota atteint : rien n'est lu, le message le dit (la page aussi : essai raté, avec la raison).
  env.DB.sqlite.prepare("UPDATE market SET quota_n = 15000 WHERE quota_day IS NOT NULL AND user_id <> '*'").run();
  supa.calls = [];
  await g.advance(60_000);
  const t3 = await pressCotes(g, 5_000);
  assert.match(t3, /Quota du jour des cotes atteint pour ton classeur \(ou pour tout le site\) : reprise demain\. Rien n'a été lu\./, t3);
  assert.equal(supa.calls.length, 0);
  const m = (await api('GET', 'market', { key: account.key })).json;
  assert.deepEqual([m.attempt.ok, m.attempt.why], [false, "Quota du jour des cotes atteint pour ton classeur (ou pour tout le site) : reprise demain. Rien n'a été lu."]);
  env.DB.sqlite.prepare("UPDATE market SET quota_n = 0").run();
  resetSupa();
});

await test('cotes : session absente ou expirée → rien n\'est lu ; la raison va au classeur ; formes du cookie (découpé, sans « base64- », localStorage, guillemets, tableau, vieux cookie à côté, morceau en trop) ; jamais de renouvellement', async () => {
  await fresh60();
  resetSupa();
  for (let i = 0; i < 3; i++) supa.auctions.push(sale('c1', 'C', 10, i * H));
  // Pas de session lisible : message (resté déplié), aucune lecture du jeu ; le classeur reçoit seulement la raison de
  // l'échec (sa page la montre), sans rien du jeu.
  let g = await openGame({ start: 'load' });
  let text = await pressCotes(g, 30_000);
  assert.match(text, /ne trouve pas ta session du jeu/, text);
  assert.match(g.text(), /Réduire/, 'encart replié : le message d\'échec ne doit pas disparaître');
  assert.equal(supa.calls.length, 0);
  assert.deepEqual(g.posts.map((x) => [x.route, x.body.v, x.body.auto]), [['market/fail', VERSION, false]]);
  assert.match(g.posts[0].body.why, /^Le favori ne trouve pas ta session du jeu dans cette page : connecte-toi, recharge la page du jeu \(F5\)/);
  let m = (await api('GET', 'market', { key: account.key })).json;
  assert.deepEqual([m.attempt.ok, m.attempt.why], [false, g.posts[0].body.why]);
  assert.match(g.text(), /Cotes : en attente de ta session du jeu/, g.text());
  // Session expirée (expires_at passé) : demande de recharger la page, sans rien lire ni renouveler.
  g = await openGame({ start: 'load', cookie: sessionCookie({ exp: Math.floor(clock.now / 1000) - 60 }) });
  text = await pressCotes(g, 5_000);
  assert.match(text, /Ta session du jeu a expiré dans cette page : recharge la page du jeu/, text);
  assert.deepEqual([supa.calls.length, g.posts.map((x) => x.route)], [0, ['market/fail']]);
  // Cookie d'une autre base Supabase seulement : le jeu a changé de base, le favori le dit.
  g = await openGame({ start: 'load', cookie: 'sb-autrebase-auth-token=base64-eyJ4IjoxfQ' });
  text = await pressCotes(g, 5_000);
  assert.match(text, /La base du jeu a changé : le favori doit être mis à jour pour lire les cotes/, text);
  // Ta collection se lit (synchro réussie) mais pas ta session : le message le précise.
  g = await openGame({ cookie: 'theme=clair' });
  text = await pressCotes(g, 5_000);
  assert.match(text, /Ta collection, elle, se lit : si ça continue après un rechargement, le jeu cache sans doute sa session au favori/, text);
  // Formes du cookie : découpé en .0, .1… ; sans préfixe (JSON encodé) ; absent, mais dans le localStorage ; entre
  // guillemets ; tableau [jeton, …] (anciens outils de Supabase) ; un vieux cookie entier (expiré) resté à côté du
  // cookie découpé à jour ; un ancien morceau .3 resté après les morceaux à jour.
  const stale = () => env.DB.sqlite.prepare("UPDATE prices SET read_at = '2000-01-01T00:00:00.000Z'").run();
  const later = Math.floor(clock.now / 1000) + 600;
  const forms = {
    'découpé': () => sessionCookie({ chunk: 120 }),
    'sans préfixe': () => sessionCookie({ prefix: false }),
    'localStorage': () => 'theme=clair',
    'entre guillemets': () => `${SESSION_COOKIE}="${encodeURIComponent(JSON.stringify({ access_token: supa.token, expires_at: later, user: { id: UID } }))}"`,
    'tableau': () => `${SESSION_COOKIE}=${encodeURIComponent(JSON.stringify([supa.token, REFRESH, null]))}`,
    'vieux cookie à côté': () => `${sessionCookie({ token: 'vieux-jeton', exp: Math.floor(clock.now / 1000) - 3600 }).split('; ')[1]}; ${sessionCookie({ chunk: 150 })}`,
    'morceau en trop': () => `${sessionCookie({ chunk: 150 })}; ${SESSION_COOKIE}.9=ancien; ${SESSION_COOKIE}.${Math.ceil(sessionCookie().length / 150) + 1}=xyz`,
  };
  for (const [how, cookieOf] of Object.entries(forms)) {
    resetSupa();
    stale();
    for (let i = 0; i < 3; i++) supa.auctions.push(sale('c1', 'C', 10, i * H));
    const storage = memoryStorage();
    if (how === 'localStorage') storage.setItem(SESSION_COOKIE, JSON.stringify({ access_token: supa.token, expires_at: later, refresh_token: REFRESH, user: { id: UID } }));
    const cookie = cookieOf();
    if (how === 'découpé') assert.ok(cookie.includes(SESSION_COOKIE + '.2='), 'au moins trois morceaux');
    g = await openGame({ start: 'load', cookie, storage });
    text = await pressCotes(g);
    assert.match(text, /Cotes lues : 60 cartes/, `${how} : ${text}`);
    assert.ok(supa.calls.length && supa.calls.every((c) => c.headers.Authorization === 'Bearer ' + supa.token), how);
  }
  m = (await api('GET', 'market', { key: account.key })).json;
  assert.equal(m.attempt.ok, true, 'un succès efface l\'échec précédent');
  // La page renouvelle elle-même sa session pendant la lecture : le favori prend le nouveau jeton à la requête suivante.
  resetSupa();
  stale();
  g = await openGame({ start: 'load', cookie: sessionCookie() });
  supa.after = (n) => {
    if (n === 2) { supa.token = 'jeton-acces-2'; g.ctx.document.cookie = sessionCookie(); }
  };
  text = await pressCotes(g);
  assert.match(text, /Cotes lues : 60 cartes/, text);
  assert.deepEqual(supa.calls.map((c) => c.headers.Authorization.slice(-1)), ['1', '1', '2']);
  // Jeton refusé en route (401) : arrêt et message, rien d'autre lu ; aucune requête de renouvellement, nulle part.
  resetSupa();
  g = await openGame({ start: 'load', cookie: sessionCookie() });
  supa.token = 'jeton-que-la-page-na-pas-encore';
  text = await pressCotes(g);
  assert.match(text, /Ta session du jeu a expiré dans cette page : recharge la page du jeu/, text);
  assert.equal(supa.calls.length, 1);
  assert.ok(!g.calls.some((c) => /auth|token/.test(c.url)) && !g.posts.some((x) => /token/.test(x.route)), 'renouvellement tenté');
  resetSupa();
});

await test('cotes : 429 ou 403 « automation_limit » → arrêt aussitôt, avec la raison ; les cotes déjà lues sont envoyées, la lecture du marché si elle était complète', async () => {
  await newAccount();
  const ids = Array.from({ length: 450 }, (_, i) => `q${String(i).padStart(3, '0')}`);
  await importDirect(ids);
  for (const [status, body] of [[429, { message: 'Too Many Requests' }], [403, { code: 'automation_limit', error: 'Trop de requêtes' }]]) {
    resetSupa();
    supa.auctions.push(sale('q000', 'C', 10, H), sale('q000', 'C', 12, H), sale('q000', 'C', 14, H));
    // Appels : mes enchères, mes ventes, puis les lots de 100 ; le 5e (3e lot des cotes du plan) est refusé : la lecture
    // du marché, complète, était déjà partie.
    supa.fail = (url, n) => (n === 5 ? { status, body } : null);
    const g = await openGame({ start: 'load', cookie: sessionCookie() });
    const text = await pressCotes(g);
    assert.match(text, /Le jeu limite les lectures automatiques : cotes arrêtées, réessaie plus tard\. 200 cotes lues avant l'arrêt ont été envoyées au classeur, avec les bonnes affaires et tes enchères\./, text);
    assert.equal(supa.calls.length, 5, 'plus rien après le refus');
    assert.deepEqual(g.posts.map((x) => x.route), ['market/plan', 'market/live', 'market/prices', 'market/fail']);
    assert.equal((await pricesOf(['q000'])).q000.C.p, 12);
    const m = (await api('GET', 'market', { key: account.key })).json;
    assert.deepEqual([m.attempt.ok, /^Le jeu limite les lectures automatiques/.test(m.attempt.why)], [false, true]);
    // La limite du jeu met aussi les lectures automatiques en pause : plus rien, même une heure après.
    assert.match(g.text(), /Cotes : lecture automatique en pause \(le jeu limite les lectures automatiques\)/, g.text());
    await g.advance(3600_000);
    assert.equal(supa.calls.length, 5, 'lecture automatique malgré la limite du jeu');
    env.DB.sqlite.prepare("UPDATE prices SET read_at = '2000-01-01T00:00:00.000Z'").run();
  }
  // Refus dès la première requête : la lecture du marché, incomplète, n'est pas envoyée (la précédente reste).
  resetSupa();
  supa.fail = (url, n) => (n === 1 ? { status: 429, body: {} } : null);
  const g = await openGame({ start: 'load', cookie: sessionCookie() });
  const text = await pressCotes(g);
  assert.match(text, /Le jeu limite les lectures automatiques : cotes arrêtées, réessaie plus tard\.$|réessaie plus tard\.Classeur/, text);
  assert.deepEqual(g.posts.map((x) => x.route), ['market/plan', 'market/prices', 'market/fail']);
  resetSupa();
});

// --- Cotes automatiques (mode relié) : toutes les 20 min, onglet visible ; après une enchère ou une vente ; limites ----
const autoPlans = (g, from = 0) => g.posts.slice(from).filter((x) => x.route === 'market/plan');
const cotesLine = (g) => {
  const el = g.ctx.document.getElementById('classeur-favori');
  const d = el && el.querySelectorAll('div').find((x) => x.childNodes.length === 1 && x.childNodes[0].nodeType === 3 && x.textContent.startsWith('Cotes : '));
  return d ? d.textContent : '';
};

await test('cotes automatiques : une minute après le clic, puis toutes les 20 min tant que l\'onglet est visible ; la page les voit (market_at)', async () => {
  await fresh60();
  resetSupa();
  for (let i = 0; i < 3; i++) supa.auctions.push(sale('c1', 'C', 10, i * H));
  const t0 = clock.now;
  const g = await openGame({ cookie: sessionCookie() });
  assert.match(cotesLine(g), new RegExp(`^Cotes : prochaine vers ${hhmm(t0 + 60_000)}$`), cotesLine(g));
  await g.advance(50_000);
  assert.equal(supa.calls.length, 0, 'rien avant la minute');
  await g.advance(30_000);
  let plans = autoPlans(g);
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].body, { v: VERSION, auto: true });
  assert.ok(supa.calls.length > 0 && supa.calls.length <= 30, `${supa.calls.length} requêtes`);
  assert.ok(g.posts.some((x) => x.route === 'market/live'), 'lecture du marché envoyée');
  const first = plans[0].at;
  assert.match(cotesLine(g), new RegExp(`^Cotes : lues à (${hhmm(first)}|${hhmm(first + 60_000)}), prochaine vers ${hhmm(first + 20 * 60_000)}$`), cotesLine(g));
  assert.doesNotMatch(g.text(), /Réduire/, 'une lecture automatique réussie ne déplie pas l\'encart');
  const me = (await api('GET', 'me', { key: account.key })).json;
  const m = (await api('GET', 'market', { key: account.key })).json;
  assert.ok(me.market_at && me.market_at >= m.live_at, 'market_at de GET /api/me : la page relit l\'onglet « Marché »');
  assert.deepEqual([m.attempt.ok, m.attempt.auto], [true, true]);
  // Rien pendant 20 min ; puis la suivante.
  let n = supa.calls.length;
  await g.advance(18 * 60_000);
  assert.equal(supa.calls.length, n, 'lecture avant 20 min');
  await g.advance(3 * 60_000);
  assert.equal(autoPlans(g).length, 2);
  assert.ok(supa.calls.length > n);
  // Onglet caché : rien ; de retour, une lecture dans la minute.
  g.ctx.document.visibilityState = 'hidden';
  n = supa.calls.length;
  await g.advance(45 * 60_000);
  assert.equal(supa.calls.length, n, 'lecture avec l\'onglet caché');
  assert.equal(cotesLine(g), 'Cotes : prochaine lecture au retour sur cet onglet');
  // De retour sur l'onglet, la page renouvelle sa session (son jeton d'une heure a expiré entre-temps).
  g.ctx.document.visibilityState = 'visible';
  g.ctx.document.cookie = sessionCookie();
  await g.advance(61_000);
  assert.equal(autoPlans(g).length, 3);
  assert.ok(supa.calls.length > n);
  // Jamais de renouvellement de session, jamais le jeton au classeur.
  assert.ok(!JSON.stringify(g.posts).includes(supa.token) && !JSON.stringify(g.posts).includes(REFRESH));
  resetSupa();
});

await test('cotes automatiques : après une enchère ou une mise en vente (20 s après), jamais moins de 5 min après la précédente, 6 par heure ; tous les onglets', async () => {
  await fresh60();
  resetSupa();
  const storage = memoryStorage();
  const g = await openGame({ cookie: sessionCookie(), storage });
  await g.advance(61_000);
  assert.equal(autoPlans(g).length, 1, 'première lecture automatique');
  // Enchère posée 6 min après : lecture 20 s après.
  await g.advance(6 * 60_000);
  const c0 = g.calls.length;
  await samePage(g, '/api/marketplace/0d6c0f4e-1111-4111-8111-111111111111/bid', POST_JSON({ amount: 12 }), (d) => assert.equal(d.current_bid, 12));
  await g.advance(15_000);
  assert.equal(autoPlans(g).length, 1, 'trop tôt (20 s)');
  await g.advance(10_000);
  assert.equal(autoPlans(g).length, 2, 'lecture après l\'enchère');
  assert.equal(g.calls.length, c0, 'une enchère ne relit pas la collection');
  const second = autoPlans(g)[1].at;
  // Nouvelle enchère tout de suite : attendue 5 min après la précédente lecture.
  await samePage(g, '/api/marketplace/0d6c0f4e-1111-4111-8111-111111111111/bid', POST_JSON({ amount: 13 }));
  await g.advance(2 * 60_000);
  assert.equal(autoPlans(g).length, 2, 'moins de 5 min après la précédente');
  assert.match(cotesLine(g), new RegExp(`prochaine vers ${hhmm(second + 5 * 60_000)}`), cotesLine(g));
  await g.advance(4 * 60_000);
  assert.equal(autoPlans(g).length, 3);
  // Un second onglet du même navigateur ne double pas les lectures ; et jamais plus de 6 automatiques par heure, même
  // avec une enchère toutes les 5 minutes.
  const g2 = await openGame({ cookie: sessionCookie(), storage, tab: true, start: 'load' });
  const all = () => autoPlans(g).length + autoPlans(g2).length;
  const before = all();
  const t1 = clock.now;
  for (let i = 0; i < 12; i++) {
    await samePage(i % 2 ? g2 : g, '/api/marketplace', POST_JSON({ card_id: 'e1', base_amount: 5, duration_minutes: 60 }));
    await g.advance(5 * 60_000);
  }
  const times = [...autoPlans(g), ...autoPlans(g2)].map((x) => x.at).filter((t) => t >= t1).sort((a, b) => a - b);
  assert.ok(all() - before <= 6 && times.length <= 6, `${all() - before} lectures en une heure`);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 5 * 60_000, 'deux lectures à moins de 5 min');
  resetSupa();
});

await test('cotes automatiques : session expirée (attente de son renouvellement), absente (rien de programmé), autre appareil (refus du classeur), « Couper », échecs passagers puis pause', async () => {
  await fresh60();
  resetSupa();
  // Session expirée à l'heure prévue : rien n'est lu ; la page renouvelle sa session : lecture dans la minute.
  let g = await openGame({ cookie: sessionCookie({ exp: Math.floor(clock.now / 1000) + 40 }) });
  await g.advance(70_000);
  assert.equal(supa.calls.length, 0);
  assert.match(cotesLine(g), /session du jeu expirée, en attente de son renouvellement par la page/, cotesLine(g));
  await g.advance(5 * 60_000);
  assert.equal(supa.calls.length, 0);
  g.ctx.document.cookie = sessionCookie();
  await g.advance(61_000);
  assert.equal(autoPlans(g).length, 1);
  assert.ok(supa.calls.length > 0);
  // Sans session lisible : aucune minuterie de cotes, aucune requête, une heure durant.
  resetSupa();
  g = await openGame({ cookie: 'theme=clair' });
  const timers = clock.timers.length;
  await g.advance(3600_000);
  assert.deepEqual([supa.calls.length, autoPlans(g).length], [0, 0]);
  assert.ok(clock.timers.length <= timers, 'minuterie de cotes sans session');
  assert.match(cotesLine(g), /en attente de ta session du jeu/);
  // Un autre appareil a lu il y a 2 min : le classeur refuse la lecture automatique, rien n'est lu dans le jeu, la
  // suivante 20 min après celle de l'autre appareil.
  resetSupa();
  g = await openGame({ cookie: sessionCookie() });
  env.DB.sqlite.prepare('UPDATE market SET attempt = ? WHERE user_id = (SELECT id FROM users WHERE import_key_hash IS NOT NULL ORDER BY created_at DESC LIMIT 1)')
    .run(JSON.stringify({ start: new Date(clock.now - 2 * 60_000 + 61_000).toISOString(), v: VERSION, auto: true, end: new Date(clock.now).toISOString(), ok: true }));
  await g.advance(61_000);
  assert.equal(autoPlans(g).length, 1);
  assert.equal(supa.calls.length, 0, 'lecture malgré le refus du classeur');
  await g.advance(15 * 60_000);
  assert.equal(autoPlans(g).length, 1, 'relance trop tôt après le refus');
  await g.advance(5 * 60_000);
  assert.equal(autoPlans(g).length, 2);
  assert.ok(supa.calls.length > 0);
  // « Couper les cotes automatiques » : plus rien dans ce navigateur (une autre page aussi) ; « Réactiver » les relance.
  resetSupa();
  const storage = memoryStorage();
  g = await openGame({ cookie: sessionCookie(), storage });
  g.press('Couper les cotes automatiques');
  await g.advance(2 * 3600_000);
  assert.equal(supa.calls.length, 0);
  assert.match(cotesLine(g), /lecture automatique coupée/);
  assert.equal(JSON.parse(storage.getItem('classeur:cotes')).off, true);
  const g3 = await openGame({ cookie: sessionCookie(), storage, start: 'load' });
  await g3.advance(3600_000);
  assert.equal(supa.calls.length, 0, 'coupées dans tout le navigateur');
  g3.ctx.document.cookie = sessionCookie(); // la page a renouvelé sa session entre-temps
  g3.press('Réactiver les cotes automatiques');
  await g3.advance(61_000);
  assert.equal(autoPlans(g3).length, 1);
  // Échecs passagers (base du jeu en 500) : rien de déplié, mention sous la ligne d'état ; au troisième, pause et encart
  // déplié avec le message ; un clic réussi les relance.
  resetSupa();
  supa.fail = () => ({ status: 500, body: { message: 'Internal' } });
  env.DB.sqlite.prepare('UPDATE market SET attempt = NULL').run(); // sinon refusée : la lecture de g3 date d'une minute
  g = await openGame({ cookie: sessionCookie(), start: 'load' });
  await g.advance(61_000);
  assert.equal(supa.calls.length, 1);
  assert.match(cotesLine(g), /dernier essai raté : La base du jeu a répondu 500/, cotesLine(g));
  assert.doesNotMatch(g.text(), /Réduire/, 'échec passager : encart replié');
  await g.advance(41 * 60_000);
  assert.equal(supa.calls.length, 3);
  assert.match(g.text(), /Réduire/, 'pause : encart déplié');
  assert.match(g.text(), /Cotes automatiques en pause : « Mettre à jour les cotes » les relance\./);
  assert.match(cotesLine(g), /lecture automatique en pause \(trois échecs de suite\)/);
  await g.advance(3600_000);
  assert.equal(supa.calls.length, 3);
  supa.fail = null;
  g.ctx.document.cookie = sessionCookie();
  await pressCotes(g);
  assert.ok(supa.calls.length > 3);
  assert.match(cotesLine(g), /^Cotes : lues à \d\d:\d\d, prochaine vers/, cotesLine(g));
  resetSupa();
});

await test('cotes : « Mettre à jour les cotes » pendant une synchro → lue juste après ; lecture du marché allégée au-delà de 200 000 caractères ; titres longs en plusieurs requêtes courtes', async () => {
  await fresh60();
  resetSupa();
  // Bouton pendant une synchro : la lecture suit.
  const storage = memoryStorage();
  let during = null;
  let seen = '';
  const g = await openGame({ cookie: sessionCookie(), storage, onPost: (body, route) => {
    if (during && route === 'import' && body.mode === 'state') {
      during = null;
      seen = g.status();
      g.press('Mettre à jour les cotes');
      seen += ' | ' + cotesLine(g);
    }
  } });
  g.press('Couper les cotes automatiques');
  await g.advance(61_000);
  during = true;
  await g.page('/api/packs/open', POST_JSON({}));
  await g.advance(120_000);
  assert.equal(seen, 'Classeur relié · synchro en cours… | Cotes : lecture juste après la synchro en cours');
  assert.equal(autoPlans(g).length, 1);
  assert.deepEqual(autoPlans(g)[0].body, { v: VERSION, auto: false });
  // Beaucoup de mises et de ventes avec de longues images : allégée (sans leurs images, puis sans les plus anciennes),
  // jamais refusée par le classeur.
  resetSupa();
  const long = 'https://upload.wikimedia.org/' + 'x'.repeat(1900) + '.jpg';
  const act = (id, extra) => ({ id, card_id: 'c' + (Number(id.slice(1)) % 60), status: 'active', snapshot_rarity: 'C', is_shiny: false, seller_id: UID, base_amount: 10, current_bid: null, current_bidder_id: null,
    end_at: iso(clock.now + H), card: { wikipedia_title: 'Titre ' + id, image_url: long, hide_image: false }, ...extra });
  for (let i = 0; i < 100; i++) supa.auctions.push(act('s' + i));
  for (let i = 0; i < 100; i++) {
    const a = act('b' + i, { seller_id: 'vendeur', current_bid: 20, current_bidder_id: UID });
    supa.auctions.push(a);
    supa.bids.push({ bidder_id: UID, amount: 20, placed_at: iso(clock.now - i * 60_000), auction: a });
  }
  // Collections : 300 titres longs et accentués (une adresse de plus de 8 000 caractères en un seul lot de 80).
  const titles = Array.from({ length: 300 }, (_, i) => `Liste des épisodes de la série télévisée « Été ${i} » — saison complète, édition spéciale numéro ${i}`);
  await api('POST', 'targets/save', { key: account.key, body: { name: 'Longs', items: titles.map((title) => ({ title, description: null, image: null, status: 'ok' })) } });
  await pressCotes(g);
  const live = g.posts.filter((x) => x.route === 'market/live').pop().body;
  assert.ok(JSON.stringify(live).length <= 200000, `lecture de ${JSON.stringify(live).length} caractères`);
  assert.ok(live.bids.length + live.sales.length > 50 && live.bids.concat(live.sales).every((x) => x.img === null), 'images des mises et ventes retirées d\'abord');
  assert.ok(!g.posts.some((x) => x.route === 'market/fail'), 'lecture refusée : ' + JSON.stringify(g.posts.filter((x) => x.route === 'market/fail').map((x) => x.body.why)));
  const cardsReqs = supa.calls.filter((c) => c.url.includes('/rest/v1/cards?'));
  assert.ok(cardsReqs.length >= 5 && cardsReqs.every((c) => c.url.length < 6000), `requêtes de titres : ${cardsReqs.map((c) => c.url.length).join(', ')}`);
  assert.equal(Object.keys(live.ids).length, 300, 'tous les titres cherchés');
  resetSupa();
});

console.log(`${results.length} tests`);
console.log('FAVORI OK');
