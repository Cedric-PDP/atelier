// Fait tourner la page construite dans un faux DOM, avec une collection d'essai, et vérifie qu'aucun rendu ne plante.
// Usage : node scripts/smoke.js [dist/collections-wikimasters.html] [data/owned.json]   -> doit finir par SMOKE OK
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const file = process.argv[2] || path.join(ROOT, 'dist', 'collections-wikimasters.html');
const ownedFile = process.argv[3] || path.join(ROOT, 'data', 'owned.json');
const html = fs.readFileSync(file, 'utf8');

const scripts = [...html.matchAll(/<script(?: id="(\w+)" type="application\/json")?>([\s\S]*?)<\/script>/g)];
const refText = scripts.find((m) => m[1] === 'ref')[2];
const code = scripts.filter((m) => !m[1]).map((m) => m[2]);

const ids = [...html.matchAll(/\sid="([\w-]+)"/g)].map((m) => m[1]);
function el(id) {
  const listeners = {};
  return {
    id, hidden: false, innerHTML: '', textContent: id === 'ref' ? refText : '', value: '', className: '', dataset: {},
    classList: { add() {}, remove() {} },
    setAttribute() {}, addEventListener(t, f) { listeners[t] = f; }, listeners,
    closest() { return null; },
  };
}
const els = Object.fromEntries(ids.map((id) => [id, el(id)]));
const tabButtons = ['collections', 'cartes', 'maj'].map((t) => ({ dataset: { tab: t }, setAttribute() {} }));
const docListeners = {};
const sandbox = {
  console, Date, JSON, Math, Map, Set, Promise, setTimeout, TextDecoder, Uint8Array, atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  location: { hash: '' },
  localStorage: { getItem() { return null; }, setItem() {} },
  scrollTo() {},
  document: {
    getElementById: (id) => els[id] || null,
    querySelectorAll: (sel) => (sel === '.tabs button' ? tabButtons : []),
    addEventListener: (t, f) => { docListeners[t] = f; },
  },
  FileReader: function () {},
  __WM_SMOKE__: {},
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const c of code) vm.runInContext(c, sandbox, { filename: path.basename(file) });

const api = sandbox.__WM_SMOKE__.api;
if (!api) throw new Error('la page n\'a pas démarré');
const fail = (m) => { console.error('ÉCHEC :', m); process.exit(1); };

// Collection d'essai : les cartes de data/owned.json, remises au format de réponse du site.
const owned = JSON.parse(fs.readFileSync(ownedFile, 'utf8'));
const response = {
  collection: owned.cards.map((c) => ({ card: { id: c.id, wikipedia_title: c.t, rarity: c.r, pageviews: c.pv, category: c.c, atk: c.atk, def: c.def }, count: c.n, is_shiny: c.s, starred: c.f, obtained_at: c.at, tags: c.tags })),
  total: owned.stats && owned.stats.total, totalUnique: owned.stats && owned.stats.unique, rarityCounts: owned.stats && owned.stats.rarity,
};
api.readText(JSON.stringify(response), 'essai');
if (api.state.cards.length !== owned.cards.length) fail(`${api.state.cards.length} cartes lues au lieu de ${owned.cards.length}`);
if (!/cartes différentes/.test(els.summary.innerHTML)) fail('synthèse absente');
if (!/data-col=/.test(els.collections.innerHTML)) fail('aucune collection rendue');
if (!/export est complet/.test(els['import-result'].innerHTML)) fail('le contrôle d\'export complet ne s\'affiche pas');

const cols = api.allCollections();
let started = 0;
for (const c of cols) {
  api.openAlbum(c.key);
  if (!/album-title/.test(els.album.innerHTML)) fail('album vide : ' + c.name);
  for (const f of ['missing', 'owned']) { api.state.albumFilter = f; api.renderAlbum(); }
  api.state.albumSort = 'rarity'; api.renderAlbum();
  if (api.progress(c).own) started++;
}
api.state.album = null;
api.setTab('cartes');
api.renderAll();
if (!/class="item"/.test(els['card-list'].innerHTML)) fail('liste des cartes vide');
if (!/data-fk=/.test(els.facets.innerHTML)) fail('aucune étiquette automatique');
const est = ['C', 'PC', 'R', 'SR', 'UR', 'L'].map((r, i) => api.estRarity([10, 100, 500, 2000, 10000, 50000][i]) === r).every(Boolean);
if (!est) fail('estimation de rareté incohérente');

// Format HAR minimal (réponse en base64), comme l'export de Chrome.
const har = { log: { entries: [{ request: { url: 'https://www.wiki-masters.com/api/my-collection?page=0' }, response: { content: { mimeType: 'application/json', encoding: 'base64', text: Buffer.from(JSON.stringify({ collection: response.collection.slice(0, 3) })).toString('base64') } } }] } };
api.readText(JSON.stringify(har), 'har');
if (api.state.cards.length !== 3) fail('lecture du HAR en base64 : ' + api.state.cards.length + ' cartes');
// La même réponse deux fois dans le journal (rechargement) ne double pas les exemplaires.
const withIds = response.collection.slice(0, 3).map((e, i) => ({ ...e, id: 'uc' + i }));
const page = { request: { url: 'https://www.wiki-masters.com/api/my-collection?page=0' }, response: { content: { text: JSON.stringify({ collection: withIds }) } } };
api.readText(JSON.stringify({ log: { entries: [page, page] } }), 'har en double');
if (api.state.cards.some((c) => c.n !== 1)) fail('une réponse vue deux fois double les exemplaires');

console.log(`${cols.length} collections rendues (${started} commencées), ${owned.cards.length} cartes, ${(html.length / 1024).toFixed(0)} Ko`);
console.log('SMOKE OK');
