// Tests de site/public/assets/propose.js (collections proposées d'après les catégories Wikipédia des cartes).
// Le script tourne dans un vm (faux window, faux localStorage), Wikipédia est simulée par un fetch remplacé.
// Puis, si cache/cats.json et data/owned.json sont là, un essai sur les vraies données, sans réseau.
//   node dev/propose.test.mjs      → doit finir par « PROPOSE OK »

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const SRC = readFileSync(path.join(root, 'site', 'public', 'assets', 'propose.js'), 'utf8');
const DAY = 864e5;

// ------------------------------------------------------------------------------------------------ bac à sable
function makeStorage(quota = Infinity) {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) {
      const s = String(v);
      let total = s.length;
      for (const [k2, v2] of m) if (k2 !== k) total += v2.length;
      if (total > quota) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      m.set(k, s);
    },
    removeItem: (k) => { m.delete(k); },
  };
}
function loadModule(win = {}) {
  const sandbox = { URLSearchParams, setTimeout, clearTimeout, console };
  Object.defineProperties(sandbox, Object.getOwnPropertyDescriptors(win));
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'propose.js' });
  assert.ok(sandbox.window.ClasseurPropose, 'window.ClasseurPropose défini');
  return sandbox.window.ClasseurPropose;
}
const P = loadModule();

// ------------------------------------------------------------------------------------------------ Wikipédia simulée
const json = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => (k.toLowerCase() in headers ? String(headers[k.toLowerCase()]) : null) },
  json: async () => body,
});
// pages : titre -> [catégories (avec « Catégorie: »)] ; redirects : de -> vers ; info : catégorie -> {pages, subcats} ;
// members : catégorie -> [titres]. Les titres commençant par une minuscule sont normalisés (majuscule).
function makeWiki({ pages = {}, redirects = {}, info = {}, members = {}, chunk = 3, memberChunk = 500 } = {}) {
  const w = { calls: [], inflight: 0, maxInflight: 0, script: [], urls: [] };
  const up = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  w.fetch = async (url, init) => {
    w.inflight++;
    w.maxInflight = Math.max(w.maxInflight, w.inflight);
    try {
      await new Promise((r) => setTimeout(r, 1));
      if (init && init.signal && init.signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
      w.urls.push(url);
      const u = new URL(url);
      const p = Object.fromEntries(u.searchParams);
      w.calls.push(p);
      if (w.script.length) { const s = w.script.shift(); if (s) return typeof s === 'function' ? s(p) : s; }
      assert.equal(p.format, 'json');
      assert.equal(p.formatversion, '2');
      assert.equal(p.origin, '*');
      if (p.prop === 'categories') {
        assert.equal(p.clshow, '!hidden');
        assert.equal(p.cllimit, 'max');
        assert.equal(p.redirects, '1');
        const asked = p.titles.split('|');
        assert.ok(asked.length <= 50, '50 titres au plus par requête');
        const normalized = [];
        const redirs = [];
        const finals = [];
        for (const t of asked) {
          let f = t;
          if (up(f) !== f) { normalized.push({ fromencoded: false, from: f, to: up(f) }); f = up(f); }
          if (redirects[f]) { redirs.push({ from: f, to: redirects[f] }); f = redirects[f]; }
          if (!finals.includes(f)) finals.push(f);
        }
        const pairs = [];
        finals.forEach((f, i) => (pages[f] || []).forEach((c) => pairs.push([i, c])));
        const off = Number(p.clcontinue || 0);
        const part = pairs.slice(off, off + chunk);
        const q = { pages: finals.map((f, i) => {
          const page = pages[f] ? { pageid: i + 1, ns: 0, title: f } : { ns: 0, title: f, missing: true };
          const cs = part.filter(([j]) => j === i).map(([, c]) => ({ ns: 14, title: c }));
          if (cs.length) page.categories = cs;
          return page;
        }) };
        if (normalized.length) q.normalized = normalized;
        if (redirs.length) q.redirects = redirs;
        const body = { batchcomplete: off + chunk >= pairs.length, query: q };
        if (off + chunk < pairs.length) body.continue = { clcontinue: String(off + chunk), continue: '||' };
        return json(body);
      }
      if (p.prop === 'categoryinfo') {
        const asked = p.titles.split('|');
        assert.ok(asked.length <= 50);
        return json({ batchcomplete: true, query: { pages: asked.map((t) => {
          assert.ok(t.startsWith('Catégorie:'), 'titre de catégorie complet : ' + t);
          const ci = info[t];
          return ci ? { pageid: 1, ns: 14, title: t, categoryinfo: { size: ci.pages + ci.subcats, pages: ci.pages, files: 0, subcats: ci.subcats } } : { ns: 14, title: t, missing: true };
        }) } });
      }
      if (p.list === 'categorymembers') {
        assert.equal(p.cmtype, 'page');
        assert.equal(p.cmnamespace, '0');
        assert.equal(p.cmlimit, '500');
        const all = members[p.cmtitle] || [];
        const off = Number(p.cmcontinue || 0);
        const body = { query: { categorymembers: all.slice(off, off + memberChunk).map((t) => ({ pageid: 1, ns: 0, title: t })) } };
        if (off + memberChunk < all.length) body.continue = { cmcontinue: String(off + memberChunk), continue: '-||' };
        else body.batchcomplete = true;
        return json(body);
      }
      throw new Error('requête inattendue : ' + url);
    } finally { w.inflight--; }
  };
  return w;
}
const C = (n) => 'Catégorie:' + n;
// Horloge et pauses simulées : les pauses avancent l'horloge sans attendre.
function makeClock(start = Date.UTC(2026, 9, 15)) {
  const c = { t: start, sleeps: [] };
  c.now = () => c.t;
  c.sleep = async (ms, signal) => {
    if (signal && signal.aborted) { const e = new Error('Recherche annulée.'); e.name = 'AbortError'; throw e; }
    c.sleeps.push(ms);
    c.t += ms;
  };
  return c;
}
// Résultats sortis du vm en objets ordinaires (deepStrictEqual compare aussi les prototypes).
const plain = (x) => JSON.parse(JSON.stringify(x));
// Seuil de taille des propositions ramené à 3 000 (par défaut : 20 000, MAX_MEMBERS) pour éprouver ses bords sur de
// petits scénarios ; { maxSize: undefined } garde celui par défaut.
const make = (opts, mod = P) => {
  const p = mod.createProposer(opts);
  return { compute: async (titles, o) => plain(await p.compute(titles, { maxSize: 3000, ...o })), loadMembers: async (...a) => plain(await p.loadMembers(...a)),
    uncached: (t) => p.uncached(t), clearCache: () => p.clearCache() };
};
const mk = (wiki, extra = {}) => {
  const clock = extra.clock || makeClock();
  const storage = extra.storage || makeStorage();
  const proposer = make({ fetch: wiki.fetch, storage, now: clock.now, sleep: clock.sleep, gap: 0, ...extra.opts });
  return { proposer, clock, storage };
};
let checks = 0;
const ok = (name) => { checks++; console.log('  ok  ' + name); };

// ------------------------------------------------------------------------------------------------ noms, clés, bruit
assert.equal(P.displayName('Catégorie:Kampen'), 'Kampen');
assert.equal(P.displayName('wp:Catégorie:Race_bovine'), 'Race bovine');
assert.equal(P.displayName('wp:kampen'), 'Kampen');
assert.equal(P.keyOf('Catégorie:Kampen'), 'wp:Kampen');
assert.equal(P.categoryTitle('wp:Kampen'), 'Catégorie:Kampen');
ok('displayName, keyOf, categoryTitle');

const NOISY = ['Naissance en octobre 1929', 'Décès à 72 ans', 'Homonymie de patronyme', 'Page d\'homonymie', 'Article de qualité',
  'Articles de Wikipédia qui incorpore des textes', 'Portail:Astronomie/Articles liés', 'Wikipédia:Ébauche chimie', 'Ébauche chimie',
  'Liste en rapport avec la Grèce', 'Personnalité liée à Conliège', 'Personne détenue à la prison Montluc', 'Projet:Musique',
  'Sigle de 3 caractères', 'Thé par pays', '1429', '795', '1942 en Palestine mandataire', '2006 aux États-Unis', '26 décembre',
  'Octobre 1925', 'Février 2012 aux États-Unis', 'Années 1920', 'Chronologie de l\'Inde au XXe siècle', 'XVe siècle en littérature',
  'Planète mineure découverte en 1998', 'Film grec sorti en 2008', 'Bateau lancé en 2019', 'Traité de 1918', 'Chanson de 1975',
  'Skieur alpin aux Jeux olympiques d\'hiver de 2002', 'Avion des années 1930', 'Saison 2023-2024 de rugby à XV en France',
  'Député européen élu au Portugal 1994-1999', 'District de Loir-et-Cher de 1790 à 1795', 'Saison NBA 1995-1996',
  'Sport en octobre 1985', 'Politique en mars 2012', 'Limitations de vitesse par pays'];
const KEPT = ['Kampen', 'Entraîneur du FC Lucerne', 'Barnet (borough londonien)', 'Peintre français du XIXe siècle',
  'Écrivain espagnol du XXe siècle', '2e arrondissement de Lyon', '800 mètres aux championnats du monde d\'athlétisme',
  'Bataille de la guerre anglo-américaine de 1812', 'Projet ferroviaire en France', 'Objet céleste découvert par LINEAR',
  'Coureuse de 800 mètres', 'Race bovine originaire de France', 'Siège de la guerre de Quatre-Vingts Ans', 'Années folles',
  'Siècle des Lumières', 'Aide humanitaire', 'Lieu nommé d\'après Voltaire', 'Exposition universelle de 1900',
  'Titulaire de la croix de guerre 1914-1918', 'Étudiant de l\'université catholique de Louvain (1834-1968)',
  'Participant au Concours Eurovision de la chanson 1980', 'NGC 1500 à 1999', 'Site Natura 2000 aux Pays-Bas',
  'Circonscription du Parlement d\'Écosse (jusqu\'en 1707)', '59e législature du Nouveau-Brunswick'];
for (const n of NOISY) assert.ok(P.isNoise(C(n)), 'bruit : ' + n);
for (const n of KEPT) assert.equal(P.noiseReason(C(n)), null, 'gardée : ' + n);
ok(`filtre du bruit (${NOISY.length} écartées, ${KEPT.length} gardées)`);

// ------------------------------------------------------------------------------------------------ calcul de base
// 40 cartes dans « Petit lot » (taille 40 → 2 possédées = 5 % pile), etc.
function scenario() {
  const pages = {};
  const add = (t, ...cats) => { pages[t] = [...(pages[t] || []), ...cats.map(C)]; };
  // A et B : 7 catégories chacune (plusieurs morceaux de 3), dont « Petit lot » en dernier.
  add('Alpha', 'Naissance en 1950', 'Décès à 72 ans', 'Homonymie', 'Film sorti en 1998', 'Grand ensemble', 'Trop gros', 'Petit lot');
  add('Bêta', 'Naissance en 1950', 'Décès à 72 ans', 'Homonymie', 'Film sorti en 1998', 'Grand ensemble', 'Trop gros', 'Petit lot');
  add('Gamma', 'Presque', 'Trop petit', 'Naissance en 1950', 'Grand ensemble', 'Trop gros');
  add('Delta', 'Presque', 'Trop petit', 'Grand ensemble', 'Trop gros', 'Sans taille');
  add('Epsilon', 'Seule', 'Grand ensemble', 'Trop gros', 'Sans taille', 'Kampen');
  add('Chat', 'Félin', 'Animal de compagnie', 'Kampen');
  add('Zêta', 'Félin', 'Animal de compagnie', 'Énorme exact');
  for (let i = 0; i < 150; i++) add('Pierre ' + i, 'Énorme exact', 'Énorme de trop');
  for (let i = 0; i < 49; i++) add('Ruisseau ' + i, 'Énorme de trop');
  const info = {
    [C('Petit lot')]: { pages: 40, subcats: 0 },
    [C('Presque')]: { pages: 41, subcats: 0 },
    [C('Trop petit')]: { pages: 9, subcats: 0 },
    [C('Grand ensemble')]: { pages: 100, subcats: 20 },
    [C('Trop gros')]: { pages: 3001, subcats: 0 },
    [C('Seule')]: { pages: 10, subcats: 0 },
    [C('Félin')]: { pages: 30, subcats: 8 },
    [C('Animal de compagnie')]: { pages: 20, subcats: 0 },
    [C('Kampen')]: { pages: 26, subcats: 1 },
    [C('Énorme exact')]: { pages: 3000, subcats: 2 },
    [C('Énorme de trop')]: { pages: 3001, subcats: 0 },
  };
  // « chat domestique » est normalisé en « Chat domestique », qui redirige vers « Chat » ; « Minou » aussi.
  const redirects = { 'Chat domestique': 'Chat', Minou: 'Chat' };
  const titles = ['Alpha', 'Bêta', 'Gamma', 'Delta', 'Epsilon', 'chat domestique', 'Minou', 'Zêta',
    ...Array.from({ length: 150 }, (_, i) => 'Pierre ' + i), ...Array.from({ length: 49 }, (_, i) => 'Ruisseau ' + i)];
  return { pages, info, redirects, titles };
}

{
  const sc = scenario();
  const wiki = makeWiki({ ...sc, chunk: 3 });
  const { proposer, storage } = mk(wiki);
  const steps = [];
  const list = await proposer.compute(sc.titles, { onProgress: (p) => steps.push(p) });
  const by = Object.fromEntries(list.map((r) => [r.name, r]));
  // Continuation : « Petit lot » n'arrive qu'au 3e morceau des catégories d'Alpha et Bêta.
  assert.ok(by['Petit lot'], 'catégorie arrivée dans un morceau suivant');
  assert.deepEqual(by['Petit lot'].cards, ['Alpha', 'Bêta']);
  assert.equal(by['Petit lot'].owned, 2);
  assert.equal(by['Petit lot'].size, 40);
  assert.equal(by['Petit lot'].ratio, 0.05);
  assert.equal(by['Petit lot'].key, 'wp:Petit lot');
  assert.equal(by['Petit lot'].title, 'Catégorie:Petit lot');
  assert.equal(by['Petit lot'].url, 'https://fr.wikipedia.org/wiki/Cat%C3%A9gorie:Petit_lot');
  ok('continuation des catégories sur plusieurs morceaux');
  // Redirections et normalisation : les catégories de « Chat » vont aux deux titres demandés.
  assert.deepEqual(by['Félin'].cards, ['chat domestique', 'Minou', 'Zêta']);
  assert.equal(by['Félin'].owned, 3);
  assert.equal(by['Animal de compagnie'].owned, 3);
  assert.equal(by['Félin'].partial, true, '8 sous-catégories pour 30 pages : avec sous-catégories');
  assert.equal(by['Animal de compagnie'].partial, false);
  ok('normalisation et redirections rattachées au titre demandé');
  // Seuils.
  assert.equal(by['Presque'], undefined, '2/41 < 5 %');
  assert.equal(by['Trop petit'], undefined, 'taille 9 < 10');
  assert.equal(by['Trop gros'], undefined, 'taille 3001 > 3000');
  assert.equal(by['Énorme de trop'], undefined, '199/3001 : taille > 3000');
  assert.ok(by['Énorme exact'], 'taille 3000 acceptée');
  assert.equal(by['Énorme exact'].owned, 151);
  assert.equal(by['Seule'], undefined, '1 carte < 2');
  assert.equal(by['Sans taille'], undefined, 'catégorie inexistante : taille = possédées = 2 < 10');
  assert.equal(by['Grand ensemble'].owned, 5);
  assert.equal(by['Grand ensemble'].partial, false, '20 sous-catégories pour 100 pages');
  assert.deepEqual(by['Kampen'].cards, ['Epsilon', 'chat domestique', 'Minou']);
  // Bruit : jamais proposé, et jamais de taille demandée pour lui.
  for (const n of ['Naissance en 1950', 'Décès à 72 ans', 'Homonymie', 'Film sorti en 1998']) assert.equal(by[n], undefined, n);
  const infoAsked = wiki.calls.filter((p) => p.prop === 'categoryinfo').flatMap((p) => p.titles.split('|'));
  for (const n of ['Naissance en 1950', 'Décès à 72 ans', 'Homonymie', 'Film sorti en 1998', 'Seule']) assert.ok(!infoAsked.includes(C(n)), 'taille non demandée : ' + n);
  ok('seuils (5 %, 2 cartes, taille 10 à maxSize) et bruit écarté avant les tailles');
  // Tri : ratio puis possédées décroissants.
  assert.deepEqual(list.map((r) => r.name), ['Animal de compagnie', 'Kampen', 'Félin', 'Énorme exact', 'Grand ensemble', 'Petit lot']);
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].ratio > list[i].ratio || (list[i - 1].ratio === list[i].ratio && list[i - 1].owned >= list[i].owned));
  ok('tri par part puis nombre possédé');
  // Paquets de 50, une requête à la fois.
  const catCalls = wiki.calls.filter((p) => p.prop === 'categories' && !p.titles.startsWith('Catégorie:')); // celles des cartes (pas les parentes)
  assert.ok(catCalls.every((p) => p.titles.split('|').length <= 50));
  assert.equal(new Set(catCalls.map((p) => p.titles)).size, 5, '207 titres → 5 paquets');
  assert.equal(wiki.maxInflight, 1);
  // Progression.
  assert.equal(steps[0].step, 'categories');
  assert.equal(steps[0].done, 0);
  assert.equal(steps[0].total, 207);
  const lastCat = steps.filter((s) => s.step === 'categories').at(-1);
  assert.equal(lastCat.done, 207);
  assert.ok(steps.some((s) => s.step === 'sizes' && s.done === s.total && s.total > 0));
  assert.equal(steps.at(-1).step, 'done');
  assert.ok(steps.every((s) => typeof s.label === 'string'));
  ok('paquets de 50, une requête à la fois, progression');
  // Cache écrit.
  assert.ok(storage.m.has('classeur-cats'));
  assert.ok(storage.m.has('classeur-catinfo'));
  const stored = JSON.parse(storage.m.get('classeur-cats'));
  assert.deepEqual(stored.Alpha[1], ['Grand ensemble', 'Trop gros', 'Petit lot'], 'cache sans préfixe et sans bruit');
  assert.deepEqual(stored['chat domestique'][1], ['Félin', 'Animal de compagnie', 'Kampen']);
}

// ------------------------------------------------------------------------------------------------ exclusion
{
  const sc = scenario();
  const wiki = makeWiki(sc);
  const { proposer } = mk(wiki);
  const list = await proposer.compute(sc.titles, { exclude: ['wp:Kampen', 'Catégorie:Félin', 'wp:Catégorie:Petit_lot', 'Grand ensemble', 'vaches', 42, null] });
  const names = list.map((r) => r.name);
  assert.ok(!names.includes('Kampen') && !names.includes('Félin') && !names.includes('Petit lot'));
  assert.ok(names.includes('Grand ensemble'), 'un id sans préfixe (catalogue) n\'exclut rien');
  assert.ok(names.includes('Animal de compagnie'));
  const infoAsked = wiki.calls.filter((p) => p.prop === 'categoryinfo').flatMap((p) => p.titles.split('|'));
  assert.ok(!infoAsked.includes(C('Kampen')), 'pas de taille demandée pour une catégorie exclue');
  ok('exclusion (wp:, Catégorie:, ids du catalogue ignorés)');
}

// ------------------------------------------------------------------------------------------------ catégories parentes, prune
{
  const sc = scenario();
  sc.pages[C('Petit lot')] = [C('Grand ensemble'), C('Lot')];
  sc.pages[C('Félin')] = [C('Animal de compagnie'), C('Mammifère')];
  sc.pages[C('Kampen')] = [C("Commune d'Overijssel")];
  const wiki = makeWiki({ ...sc, chunk: 3 });
  const { proposer, storage } = mk(wiki);
  const steps = [];
  const list = await proposer.compute(sc.titles, { onProgress: (p) => steps.push(p) });
  const by = Object.fromEntries(list.map((r) => [r.name, r]));
  assert.deepEqual(by['Petit lot'].parents, ['Grand ensemble', 'Lot']);
  assert.deepEqual(by['Félin'].parents, ['Animal de compagnie', 'Mammifère'], 'parentes arrivées en plusieurs morceaux');
  assert.deepEqual(by['Kampen'].parents, ["Commune d'Overijssel"]);
  assert.deepEqual(by['Animal de compagnie'].parents, []);
  const parentCalls = wiki.calls.filter((p) => p.prop === 'categories' && p.titles.startsWith('Catégorie:'));
  assert.ok(parentCalls.length >= 2 && parentCalls.every((p) => p.clshow === '!hidden' && p.titles.split('|').length <= 50), 'parentes : prop=categories, clshow=!hidden, 50 au plus');
  assert.deepEqual([...new Set(parentCalls.flatMap((p) => p.titles.split('|')))].sort(), list.map((r) => C(r.name)).sort(), 'parentes demandées : celles des propositions seulement');
  assert.ok(steps.some((x) => x.step === 'parents' && x.done === x.total && x.total === list.length) && steps.at(-1).step === 'done');
  assert.ok(storage.m.has('classeur-catparents'));
  const n = wiki.calls.length;
  assert.deepEqual(await proposer.compute(sc.titles), list);
  assert.equal(wiki.calls.length, n, 'parentes en cache : aucune requête');
  // Un incident sur les parentes ne prive pas des propositions (sans parentes).
  const wiki2 = makeWiki(sc);
  const base = wiki2.fetch;
  const parentsOnly = (url) => { const q = new URL(url).searchParams; return q.get('prop') === 'categories' && q.get('titles').startsWith('Catégorie:'); };
  wiki2.fetch = async (url, init) => (parentsOnly(url) ? json({}, 404) : base(url, init)); // les parentes : 404
  const { proposer: p2 } = mk(wiki2);
  const l2 = await p2.compute(sc.titles);
  assert.deepEqual(l2.map((r) => r.name), list.map((r) => r.name));
  assert.ok(l2.every((r) => Array.isArray(r.parents)));
  ok('catégories parentes des propositions (espace 14, continuation, cache, incident sans effet sur la liste)');

  // prune : rien n'est demandé, l'ordre est gardé.
  const names = (l, o) => Array.from(P.prune(l, o), (r) => r.name); // tableau de ce contexte (pas celui du vm)
  // Liste : Animal de compagnie, Kampen, Félin (fille d'Animal de compagnie), Énorme exact, Grand ensemble, Petit lot
  // (fille de Grand ensemble).
  assert.deepEqual(names(list), ['Animal de compagnie', 'Kampen', 'Énorme exact', 'Grand ensemble'], 'parente proposée : la fille est écartée');
  // La parente qui reste regroupe ses filles (subs, à suivre avec elle) ; les autres sont rendues telles quelles.
  const st = {};
  const pruned = Array.from(P.prune(list, { stats: st }));
  const subsOf = (l, n) => { const x = l.find((p) => p.name === n); return x && x.subs ? Array.from(x.subs) : null; };
  assert.deepEqual(subsOf(pruned, 'Animal de compagnie'), ['Félin']);
  assert.deepEqual(subsOf(pruned, 'Grand ensemble'), ['Petit lot']);
  assert.equal(subsOf(pruned, 'Kampen'), null);
  assert.ok(pruned.find((p) => p.name === 'Kampen') === list.find((p) => p.name === 'Kampen'), 'proposition sans fille : rendue telle quelle');
  assert.ok(!('subs' in list.find((p) => p.name === 'Grand ensemble')), 'la liste reçue ne doit pas être modifiée');
  assert.deepEqual({ ...st }, { covered: 0, grouped: 2 });
  const sansGrand = list.filter((r) => r.name !== 'Grand ensemble'); // retirée par l'utilisateur
  assert.deepEqual(names(sansGrand), ['Animal de compagnie', 'Kampen', 'Énorme exact', 'Petit lot'], 'parente non proposée : la fille reste');
  // Une parente dont on a une collection n'écarte pas ses filles par elle-même (faite sans ses sous-catégories, elle ne
  // les contient pas ; avec, ses filles sont couvertes, plus bas) ; l'ancienne option followed (« suivies ») est ignorée.
  assert.deepEqual(names(sansGrand, { followed: ['wp:Lot', 'wp:Catégorie:Mammifère'] }), ['Animal de compagnie', 'Kampen', 'Énorme exact', 'Petit lot'], 'parente en collection : la fille reste');
  // Couvertes écartées (et comptées) ; Félin reste alors (sa parente, couverte, n'est plus proposée).
  const st2 = {};
  assert.deepEqual(names(list, { covered: (r) => r.name === 'Kampen' || r.name === 'Animal de compagnie', stats: st2 }), ['Félin', 'Énorme exact', 'Grand ensemble'], 'couvertes écartées');
  assert.deepEqual({ ...st2 }, { covered: 2, grouped: 1 });
  // Chaîne et cycles.
  const r = (name, size, parents) => ({ name, key: 'wp:' + name, size, parents });
  const chain = [r('Couleur', 60, ['Optique']), r('Violet', 30, ['Couleur']), r('Nuance de violet', 12, ['Violet']), r('Rose', 20, [])];
  assert.deepEqual(names(chain), ['Couleur', 'Rose'], 'chaîne : la plus haute reste');
  assert.deepEqual(subsOf(Array.from(P.prune(chain)), 'Couleur'), ['Violet', 'Nuance de violet'], 'chaîne : la plus haute regroupe filles et petites-filles');
  assert.deepEqual(names([r('A', 10, ['B']), r('B', 30, ['A'])]), ['B'], 'cycle : la plus grande reste');
  // Cycle de 3 (A → C, B → A, C → B : chacune parente de la suivante) : la plus grande reste, et regroupe les deux autres.
  const cyc3 = [r('A', 10, ['C']), r('B', 20, ['A']), r('C', 30, ['B'])];
  assert.deepEqual(names(cyc3), ['C'], 'cycle de 3 : la plus grande reste');
  assert.deepEqual(subsOf(Array.from(P.prune(cyc3)), 'C'), ['A', 'B']);
  assert.deepEqual(names([r('A', 30, ['C']), r('B', 20, ['A']), r('C', 30, ['B'])]), ['A'], 'cycle de 3, deux plus grandes égales : ordre alphabétique');
  // Cycle sous une parente proposée : la parente seule reste, même si une catégorie du cycle est plus grande qu'elle.
  assert.deepEqual(names([r('X', 5, []), r('A', 40, ['B', 'X']), r('B', 10, ['A'])]), ['X'], 'cycle sous une parente : la parente reste');
  // Collection d'une catégorie avec ses sous-catégories : ses filles sont couvertes (leurs cartes y sont), règle des 80 %.
  assert.deepEqual(names([r('Violet', 30, ['Couleur', 'Catégorie:Couleur']), r('Brun', 20, ['Couleur'])], { covered: (p) => p.name === 'Violet' }), ['Brun'], 'filles couvertes par la collection de la parente');
  assert.deepEqual(names(null), []);
  ok('prune : couvertes (comptées), parente proposée (la plus haute reste et regroupe, subs), parente en collection sans effet, parente non proposée, cycles de 2 et 3');
}

// ------------------------------------------------------------------------------------------------ autres seuils
{
  const sc = scenario();
  const wiki = makeWiki(sc);
  const { proposer } = mk(wiki);
  const a = await proposer.compute(sc.titles, { threshold: 0.04 });
  assert.ok(a.some((r) => r.name === 'Presque'), '2/41 passe à 4 %');
  const b = await proposer.compute(sc.titles, { minCards: 1, minSize: 5 });
  assert.ok(b.some((r) => r.name === 'Seule'), '1/10 avec minCards 1');
  assert.ok(b.some((r) => r.name === 'Trop petit'), 'taille 9 avec minSize 5');
  const c = await proposer.compute(sc.titles, { maxSize: 5000 });
  assert.ok(c.some((r) => r.name === 'Énorme de trop'));
  // Par défaut, jusqu'à 20 000 articles (une collection en tient autant depuis le 2026-10-19).
  const d = await proposer.compute(sc.titles, { maxSize: undefined });
  assert.ok(d.some((r) => r.name === 'Énorme de trop'), '3 001 articles proposés par défaut');
  ok('options threshold, minCards, minSize, maxSize');
}

// ------------------------------------------------------------------------------------------------ cache et expiration
{
  const sc = scenario();
  const wiki = makeWiki(sc);
  const clock = makeClock();
  const storage = makeStorage();
  const { proposer } = mk(wiki, { clock, storage });
  assert.equal(proposer.uncached(sc.titles), 207);
  const first = await proposer.compute(sc.titles);
  const n1 = wiki.calls.length;
  assert.ok(n1 > 0);
  assert.equal(proposer.uncached(sc.titles), 0);
  assert.deepEqual(await proposer.compute(sc.titles), first);
  assert.equal(wiki.calls.length, n1, 'aucune requête quand tout est en cache');
  // Un autre proposer (nouvelle page) relit le cache.
  const again = make({ fetch: wiki.fetch, storage, now: clock.now, sleep: clock.sleep, gap: 0 });
  assert.equal(again.uncached(sc.titles), 0);
  assert.deepEqual(await again.compute(sc.titles), first);
  assert.equal(wiki.calls.length, n1, 'cache relu depuis le storage');
  // Une carte nouvelle : une seule requête de catégories.
  sc.pages['Nouvelle'] = [C('Petit lot')];
  const withNew = [...sc.titles, 'Nouvelle'];
  assert.equal(again.uncached(withNew), 1);
  const third = await again.compute(withNew);
  const added = wiki.calls.slice(n1);
  assert.equal(added.filter((p) => p.prop === 'categories').length, 1);
  assert.equal(added.find((p) => p.prop === 'categories').titles, 'Nouvelle');
  assert.equal(third.find((r) => r.name === 'Petit lot').owned, 3);
  const n2 = wiki.calls.length;
  // 13 jours plus tard : toujours en cache ; 15 jours : expiré.
  clock.t += 13 * DAY;
  const p13 = make({ fetch: wiki.fetch, storage, now: clock.now, sleep: clock.sleep, gap: 0 });
  await p13.compute(withNew);
  assert.equal(wiki.calls.length, n2, 'encore valable à 13 jours');
  clock.t += 2 * DAY;
  const p15 = make({ fetch: wiki.fetch, storage, now: clock.now, sleep: clock.sleep, gap: 0 });
  assert.equal(p15.uncached(withNew), 208);
  await p15.compute(withNew);
  assert.ok(wiki.calls.slice(n2).some((p) => p.prop === 'categories'), 'catégories redemandées après 14 jours');
  assert.ok(wiki.calls.slice(n2).some((p) => p.prop === 'categoryinfo'), 'tailles redemandées après 14 jours');
  ok('cache par titre et par catégorie, relu, expiration à 14 jours');
  // clearCache.
  p15.clearCache();
  assert.ok(!storage.m.has('classeur-cats') && !storage.m.has('classeur-catinfo'));
  ok('clearCache');
}

// ------------------------------------------------------------------------------------------------ cache borné
{
  const sc = scenario();
  // Borne de taille : les plus récents gardés, sous la borne.
  const wiki = makeWiki(sc);
  const storage = makeStorage();
  const { proposer } = mk(wiki, { storage, opts: { maxCatsChars: 3000 } });
  const list = await proposer.compute(sc.titles);
  assert.ok(list.length > 0, 'le calcul en cours garde tout en mémoire');
  const text = storage.m.get('classeur-cats');
  assert.ok(text.length <= 3000, 'cache borné : ' + text.length);
  assert.ok(Object.keys(JSON.parse(text)).length > 10);
  // Quota du navigateur dépassé : on oublie la moitié et on réessaie, sans erreur.
  const wiki2 = makeWiki(sc);
  const tight = makeStorage(2500);
  const { proposer: p2 } = mk(wiki2, { storage: tight });
  const list2 = await p2.compute(sc.titles);
  assert.deepEqual(list2.map((r) => r.name), list.map((r) => r.name));
  assert.ok((tight.m.get('classeur-cats') || '').length <= 2500);
  // Sans localStorage du tout (refusé) : cache en mémoire.
  const P2 = loadModule({ get localStorage() { throw new Error('SecurityError'); }, fetch: makeWiki(sc).fetch });
  const p3 = make({ sleep: async () => {}, gap: 0 }, P2);
  assert.ok((await p3.compute(sc.titles)).length > 0);
  assert.equal(p3.uncached(sc.titles), 0);
  ok('cache borné, quota dépassé, localStorage refusé');
}

// ------------------------------------------------------------------------------------------------ 429, erreurs
{
  const sc = scenario();
  const wiki = makeWiki(sc);
  const clock = makeClock();
  const { proposer } = mk(wiki, { clock });
  wiki.script.push(json({}, 429, { 'retry-after': '7' }), json({}, 503), json({ error: { code: 'ratelimited', info: 'too fast' } }));
  const list = await proposer.compute(sc.titles.slice(0, 2));
  assert.deepEqual(list.map((r) => r.name), ['Petit lot']);
  assert.equal(clock.sleeps[0], 7250, 'Retry-After respecté');
  assert.equal(clock.sleeps[1], 4000, 'puis attente croissante');
  assert.equal(clock.sleeps[2], 8000);
  assert.equal(proposer.uncached(sc.titles.slice(0, 2)), 0, 'réussi après les refus');
  ok('429 + Retry-After, 503, erreur « ratelimited » : on attend et on réessaie');
  // Retry-After en date HTTP.
  const wiki2 = makeWiki(sc);
  const clock2 = makeClock();
  const { proposer: p2 } = mk(wiki2, { clock: clock2 });
  wiki2.script.push(json({}, 429, { 'retry-after': new Date(clock2.t + 3000).toUTCString() }));
  await p2.compute(['Alpha']);
  assert.ok(clock2.sleeps[0] >= 2250 && clock2.sleeps[0] <= 3250, 'Retry-After en date : ' + clock2.sleeps[0]);
  // 404 et erreur MediaWiki : message lisible, pas de nouvel essai.
  const wiki3 = makeWiki(sc);
  const { proposer: p3 } = mk(wiki3);
  wiki3.script.push(json({}, 404));
  await assert.rejects(p3.compute(['Alpha']), /Wikipédia a répondu 404/);
  wiki3.script.push(json({ error: { code: 'badvalue', info: 'Valeur non reconnue' } }));
  await assert.rejects(p3.compute(['Alpha']), /Wikipédia a refusé la demande : Valeur non reconnue/);
  // Toujours 429 : abandon avec un message.
  const wiki4 = makeWiki(sc);
  const { proposer: p4 } = mk(wiki4);
  for (let i = 0; i < 8; i++) wiki4.script.push(json({}, 429));
  await assert.rejects(p4.compute(['Alpha']), /ne répond pas pour l'instant/);
  // Réseau coupé puis rétabli.
  const wiki5 = makeWiki(sc);
  const { proposer: p5 } = mk(wiki5);
  wiki5.script.push(() => { throw new TypeError('Failed to fetch'); });
  assert.equal((await p5.compute(['Alpha', 'Bêta'])).length, 1);
  ok('Retry-After en date, 404, erreur MediaWiki, abandon après 8 essais, réseau coupé');
}

// ------------------------------------------------------------------------------------------------ pause entre requêtes
{
  const sc = scenario();
  const wiki = makeWiki(sc);
  const clock = makeClock();
  const proposer = make({ fetch: wiki.fetch, storage: makeStorage(), now: clock.now, sleep: clock.sleep, gap: 300 });
  await proposer.compute(sc.titles);
  assert.ok(clock.sleeps.length >= 4 && clock.sleeps.every((ms) => ms > 0 && ms <= 300), 'pauses de 300 ms au plus : ' + clock.sleeps.join(','));
  // Deux calculs en même temps : toujours une seule requête en vol.
  const wiki2 = makeWiki(sc);
  const p2 = make({ fetch: wiki2.fetch, storage: makeStorage(), gap: 5 });
  const [x, y] = await Promise.all([p2.compute(sc.titles), p2.compute(sc.titles.slice(0, 60))]);
  assert.equal(wiki2.maxInflight, 1);
  assert.ok(x.length > 0 && Array.isArray(y));
  ok('pause entre deux requêtes, une seule en vol même avec deux calculs');
}

// ------------------------------------------------------------------------------------------------ abandon
{
  const sc = scenario();
  const wiki = makeWiki(sc);
  const { proposer } = mk(wiki);
  const ctrl = new AbortController();
  const p = proposer.compute(sc.titles, { signal: ctrl.signal, onProgress: (s) => { if (s.step === 'categories' && s.done >= 50) ctrl.abort(); } });
  await assert.rejects(p, (e) => e.name === 'AbortError');
  const left = proposer.uncached(sc.titles);
  assert.ok(left > 0 && left < 207, 'ce qui a été relevé reste en cache : ' + left);
  // Déjà annulé : rien n'est demandé.
  const n = wiki.calls.length;
  const ctrl2 = new AbortController();
  ctrl2.abort();
  await assert.rejects(proposer.compute(sc.titles, { signal: ctrl2.signal }), (e) => e.name === 'AbortError');
  assert.equal(wiki.calls.length, n);
  // Annulé pendant une longue attente (429, Retry-After 30 s), avec les vraies pauses : rendu tout de suite.
  const wiki3 = makeWiki(sc);
  const p3 = make({ fetch: wiki3.fetch, storage: makeStorage(), gap: 0 });
  wiki3.script.push(json({}, 429, { 'retry-after': '30' }));
  const ctrl3 = new AbortController();
  const t0 = Date.now();
  const run = p3.compute(['Alpha'], { signal: ctrl3.signal });
  setTimeout(() => ctrl3.abort(), 50);
  await assert.rejects(run, (e) => e.name === 'AbortError');
  assert.ok(Date.now() - t0 < 2000, 'abandon pendant l\'attente');
  // Après un abandon, la file repart.
  assert.equal((await p3.compute(['Alpha', 'Bêta'])).length, 1);
  // loadMembers aussi.
  const ctrl4 = new AbortController();
  ctrl4.abort();
  await assert.rejects(p3.loadMembers('Petit lot', { signal: ctrl4.signal }), (e) => e.name === 'AbortError');
  ok('abandon (avant, pendant, pendant une attente de 429) ; la file repart ensuite');
}

// ------------------------------------------------------------------------------------------------ loadMembers
{
  const members = {
    [C('Race bovine originaire de France')]: Array.from({ length: 1234 }, (_, i) => 'Race ' + i),
    [C('Astéroïde')]: Array.from({ length: 20600 }, (_, i) => 'Astéroïde ' + i),
  };
  const wiki = makeWiki({ members });
  const { proposer } = mk(wiki);
  const a = await proposer.loadMembers('wp:Race bovine originaire de France');
  assert.equal(a.length, 1234);
  assert.deepEqual(a[0], { title: 'Race 0' });
  assert.deepEqual(a.at(-1), { title: 'Race 1233' });
  assert.equal(wiki.calls.length, 3, '3 morceaux de 500');
  assert.ok(wiki.calls.every((p) => p.cmtitle === 'Catégorie:Race bovine originaire de France'));
  const b = await proposer.loadMembers('Catégorie:Astéroïde');
  assert.equal(b.length, 20000, '20 000 au plus');
  assert.equal(wiki.calls.length - 3, 40, 'arrêt dès 20 000');
  const c = await proposer.loadMembers('Inexistante');
  assert.deepEqual(c, []);
  const d = await proposer.loadMembers('Astéroïde', { limit: 700 });
  assert.equal(d.length, 700);
  ok('loadMembers : continuation, 20 000 au plus, préfixe ajouté');
}

// ------------------------------------------------------------------------------------------------ vraies données, sans réseau
const CACHE = path.join(root, 'cache', 'cats.json');
const OWNED = path.join(root, 'data', 'owned.json');
if (existsSync(CACHE) && existsSync(OWNED)) {
  const cache = JSON.parse(readFileSync(CACHE, 'utf8'));
  const titles = JSON.parse(readFileSync(OWNED, 'utf8')).cards.map((c) => c.t);
  const t0 = Date.UTC(2026, 9, 15);
  const strip = (c) => P.displayName(c);
  // Le cache de scripts/categories.js, mis au format du classeur (comme si l'interface l'avait relevé).
  const storage = makeStorage();
  const catsLS = {};
  for (const t of titles) catsLS[t] = [t0, (cache.art[t] || []).map(strip).filter((c) => !P.isNoise(c))];
  const infoLS = {};
  for (const [c, v] of Object.entries(cache.info)) infoLS[strip(c)] = [t0, [v.pages, v.subcats]];
  storage.setItem('classeur-cats', JSON.stringify(catsLS));
  storage.setItem('classeur-catinfo', JSON.stringify(infoLS));
  const catsChars = storage.getItem('classeur-cats').length;
  // Hors ligne : aucune requête de catégories ; une taille absente du vieux cache (catégorie que son filtre écartait)
  // est notée et comptée comme inconnue.
  const missingInfo = [];
  const offline = async (url) => {
    const p = Object.fromEntries(new URL(url).searchParams);
    // Catégories parentes des propositions : absentes du vieux cache, rendues vides.
    if (p.prop === 'categories' && p.titles.split('|').every((t) => t.startsWith('Catégorie:'))) {
      return json({ query: { pages: p.titles.split('|').map((t) => ({ ns: 14, title: t, missing: true })) } });
    }
    assert.notEqual(p.prop, 'categories', 'hors ligne : catégories toutes en cache');
    assert.equal(p.prop, 'categoryinfo');
    missingInfo.push(...p.titles.split('|'));
    return json({ query: { pages: p.titles.split('|').map((t) => ({ ns: 14, title: t, missing: true })) } });
  };
  // Chaque calcul part d'une copie du cache (les tailles inconnues ne doivent pas s'y ajouter).
  const runWith = async (threshold) => {
    const st = makeStorage();
    st.setItem('classeur-cats', storage.getItem('classeur-cats'));
    st.setItem('classeur-catinfo', storage.getItem('classeur-catinfo'));
    return make({ fetch: offline, storage: st, now: () => t0, sleep: async () => {}, gap: 0 }).compute(titles, { threshold });
  };
  const at5 = await runWith(0.05);
  const at3 = await runWith(0.03);
  const at10 = await runWith(0.10);
  const all = Object.values(catsLS).flatMap((v) => v[1]);
  const raw = new Set(titles.flatMap((t) => cache.art[t] || []));
  const kept = new Set(all);
  console.log(`\nVraies données (${titles.length} cartes, ${raw.size} catégories visibles, ${kept.size} après le filtre du bruit ;`
    + ` cache des catégories : ${Math.round(catsChars / 1000)} k caractères) :`);
  console.log(`  à 5 % et 2 cartes : ${at5.length} proposition(s)`);
  for (const r of at5) console.log(`    ${r.name} : ${r.owned}/${r.size} (${(r.ratio * 100).toFixed(1).replace('.', ',')} %)${r.partial ? ' (avec sous-catégories)' : ''} — ${r.cards.join(', ')}`);
  console.log(`  à 3 % : ${at3.length} ; à 10 % : ${at10.length}`);
  for (const r of at3.filter((x) => x.ratio < 0.05)) console.log(`    (3 %) ${r.name} : ${r.owned}/${r.size} (${(r.ratio * 100).toFixed(1).replace('.', ',')} %)`);
  if (missingInfo.length) console.log(`  tailles absentes du vieux cache (comptées inconnues) : ${[...new Set(missingInfo)].join(' ; ')}`);
  assert.ok(at3.length >= at5.length && at5.length >= at10.length);
  ok('essai sur les vraies données, hors ligne');
} else {
  console.log('(cache/cats.json ou data/owned.json absent : essai sur les vraies données sauté)');
}

console.log(`\n${checks} vérifications`);
console.log('PROPOSE OK');
