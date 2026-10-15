// Vérifie site/public/assets/match.js (rapprochement cartes / collections par titre puis par élément Wikidata).
// Chargé tel quel dans un vm (script classique, faux window et localStorage), Wikipédia simulé.
// Usage : node dev/match.test.mjs   -> doit finir par MATCH OK
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'site', 'public', 'assets', 'match.js');
const code = fs.readFileSync(SRC, 'utf8');

// ------------------------------------------------------------------ chargement : script classique, CSP stricte
assert.ok(/Intégration/.test(code.slice(0, 2000)), 'commentaire « Intégration » en tête');
assert.ok(!/^\s*(import|export)\b/m.test(code), 'pas de module ES');
assert.ok(!/\beval\s*\(|new\s+Function\b|innerHTML/.test(code), 'ni eval, ni Function, ni innerHTML');

class FakeStorage {
  constructor(quota) { this.m = new Map(); this.quota = quota || Infinity; this.writes = 0; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) {
    v = String(v);
    if (v.length > this.quota) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
    this.writes++;
    this.m.set(k, v);
  }
  removeItem(k) { this.m.delete(k); }
}

const sandbox = { console, setTimeout, clearTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'match.js' });
const M = sandbox.ClasseurMatch;
assert.ok(M && typeof M.normTitle === 'function' && typeof M.createResolver === 'function' && typeof M.createIndex === 'function');
assert.equal(M.STORAGE_KEY, 'classeur-qid');

// ------------------------------------------------------------------ normTitle
const N = M.normTitle;
assert.equal(N('  fer_(élément   chimique) '), 'Fer (élément chimique)');
assert.equal(N('Fer\u00a0(élément\u202fchimique)'), 'Fer (élément chimique)', 'espaces insécables');
assert.equal(N('L’Oréal'), "L'Oréal");
assert.equal(N('l‘oréal'), "L'oréal");
assert.equal(N('Jeanne d’Arc'), N("Jeanne d'Arc"));
assert.equal(N('Jeanne dʼArc'), "Jeanne d'Arc");
assert.equal(N('“Fer”'), '"Fer"');
assert.equal(N('« Fer »'), '"Fer"');
assert.equal(N('«\u00a0Fer\u00a0»'), '"Fer"');
assert.equal(N('„Fer“'), '"Fer"');
assert.equal(N('Jean\u2011Paul'), 'Jean-Paul');
assert.equal(N('Fer\u200e'), 'Fer', 'marque de direction');
assert.equal(N('https://fr.wikipedia.org/wiki/Fer_(%C3%A9l%C3%A9ment_chimique)'), 'Fer (élément chimique)');
assert.equal(N('https://fr.m.wikipedia.org/wiki/Jeanne_d%27Arc#Biographie'), "Jeanne d'Arc");
assert.equal(N('https://fr.wikipedia.org/w/index.php?title=Jeanne+d%E2%80%99Arc&oldid=123'), "Jeanne d'Arc");
assert.equal(N('http://fr.wikipedia.org/wiki/fer?action=history'), 'Fer');
assert.equal(N('fr.wikipedia.org/wiki/Hélium'), 'Hélium');
assert.equal(N('https://fr.wikipedia.org/wiki/Fer (élément chimique)'), 'Fer (élément chimique)');
assert.ok(N('https://en.wikipedia.org/wiki/Iron').includes('en.wikipedia.org/wiki/Iron'), 'autre langue : pas un titre français, gardé tel quel');
assert.equal(N('éléments chimiques'), 'Éléments chimiques', 'première lettre accentuée');
assert.equal(N('Été'), 'Été', 'NFC');
assert.notEqual(N('Élément'), N('Element'), 'accents conservés');
assert.notEqual(N('FER'), N('Fer'), 'casse conservée hors première lettre');
assert.equal(N('fER'), 'FER');
assert.equal(N('ßtraße'), 'ßtraße', 'majuscule en deux lettres : inchangée');
assert.equal(N('1984 (roman)'), '1984 (roman)');
assert.equal(N(null), '');
assert.equal(N(undefined), '');
assert.equal(N('   '), '');
assert.equal(N(42), '42');
assert.equal(M.cleanTitle('l’Oréal'), 'L’Oréal', 'le titre envoyé à Wikipédia garde son apostrophe');

// ------------------------------------------------------------------ Wikipédia simulé
const WIKI_PAGES = new Map([
  ['Fer', 'Q677'],
  ['Mercure (chimie)', 'Q925'],
  ['Mercure (planète)', 'Q308'],
  ['Mercure', 'Q229597'], // page d'homonymie
  ['Hydrogène', 'Q556'],
  ['Hélium', 'Q560'],
  ['Iode', 'Q1103'],
  ["Jeanne d'Arc", 'Q7226'],
  ['Catégorie:Éléments chimiques', 'Q5626697'],
  ['Sans élément', null],
]);
const WIKI_REDIRECTS = new Map([
  ['Fer (élément chimique)', { to: 'Fer' }],
  ['Isotopes du fer', { to: 'Fer', tofragment: 'Isotopes' }],
  ['Hg', { to: 'Mercure (chimie)' }],
  ['Jeanne d’Arc', { to: "Jeanne d'Arc" }],
]);
const ucf = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
function apiNormalize(t) {
  let s = t.replace(/_/g, ' ').trim();
  const m = /^(catégorie):(.*)$/i.exec(s);
  if (m) return 'Catégorie:' + ucf(m[2]);
  return ucf(s);
}
function pageOf(title) {
  const a = /^Article (\d+)$/.exec(title);
  if (a) return { title, qid: 'Q' + (1000 + Number(a[1])) };
  const c = /^Carte (\d+)$/.exec(title);
  if (c) return { title, qid: 'Q' + (500000 + Number(c[1])) };
  if (WIKI_PAGES.has(title)) return { title, qid: WIKI_PAGES.get(title) };
  return null;
}
function apiAnswer(params) {
  const titles = params.titles.split('|');
  const normalized = [];
  const redirects = [];
  const pages = new Map();
  for (const t of titles) {
    let cur = apiNormalize(t);
    if (cur !== t) normalized.push({ fromencoded: false, from: t, to: cur });
    const r = WIKI_REDIRECTS.get(cur);
    if (r) { redirects.push(Object.assign({ from: cur, to: r.to }, r.tofragment ? { tofragment: r.tofragment } : {})); cur = r.to; }
    const p = pageOf(cur);
    if (!p) pages.set(cur, { ns: 0, title: cur, missing: true });
    else pages.set(cur, Object.assign({ pageid: 1, ns: 0, title: cur }, p.qid ? { pageprops: { wikibase_item: p.qid } } : {}));
  }
  const query = { pages: [...pages.values()] };
  if (normalized.length) query.normalized = normalized;
  if (redirects.length) query.redirects = redirects;
  return { batchcomplete: true, query };
}
const response = (status, body, headers) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => (headers || {})[k.toLowerCase()] ?? null },
  json: async () => body,
});

// fetch simulé : vérifie les paramètres, compte les requêtes en vol ; `script` = réponses forcées (dans l'ordre).
function makeWiki() {
  const w = { calls: [], inflight: 0, maxInflight: 0, script: [] };
  w.fetch = async (url, init) => {
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, 'https://fr.wikipedia.org/w/api.php');
    const params = Object.fromEntries(u.searchParams);
    assert.equal(params.action, 'query');
    assert.equal(params.prop, 'pageprops');
    assert.equal(params.ppprop, 'wikibase_item');
    assert.equal(params.redirects, '1');
    assert.equal(params.format, 'json');
    assert.equal(params.formatversion, '2');
    assert.equal(params.origin, '*');
    assert.equal(init.credentials, 'omit');
    const titles = params.titles.split('|');
    assert.ok(titles.length >= 1 && titles.length <= 50, 'lot de 50 titres au plus');
    assert.equal(new Set(titles).size, titles.length, 'pas de titre en double dans un lot');
    w.calls.push(titles);
    w.inflight++;
    w.maxInflight = Math.max(w.maxInflight, w.inflight);
    try {
      await new Promise((r) => setImmediate(r));
      if (init.signal && init.signal.aborted) throw init.signal.reason;
      const forced = w.script.shift();
      if (typeof forced === 'function') return await forced(init);
      if (forced) return forced;
      return response(200, apiAnswer(params));
    } finally { w.inflight--; }
  };
  return w;
}

const DAY = 24 * 3600 * 1000;
const T0 = Date.UTC(2026, 9, 15, 12);
function setup(extra) {
  const wiki = makeWiki();
  const storage = new FakeStorage();
  const sleeps = [];
  const clock = { t: T0 };
  const opts = Object.assign({ fetch: wiki.fetch, storage, now: () => clock.t, gap: 0, sleep: async (ms) => { sleeps.push(ms); } }, extra || {});
  return { wiki, storage, sleeps, clock, opts, resolver: M.createResolver(opts) };
}
const plain = (map) => Object.fromEntries(map);
const sent = (wiki) => wiki.calls.flat();
const rejectsAbort = async (p) => assert.rejects(p, (e) => e && e.name === 'AbortError');

// ------------------------------------------------------------------ résolution par lots de 50
{
  const { wiki, storage, resolver, opts } = setup();
  const titles = ['fer (élément chimique)', 'Fer_(élément_chimique)', 'catégorie:éléments chimiques', 'Isotopes du fer', 'Sans élément', 'Introuvable', 'A|B'];
  for (let i = 1; i <= 118; i++) titles.push('article_' + i);
  titles.push('Fer');
  const progress = [];
  const v0 = resolver.version;
  const res = await resolver.resolve(titles, { onProgress: (d, t) => progress.push([d, t]) });
  assert.deepEqual(wiki.calls.map((c) => c.length), [50, 50, 23], '124 titres à demander, « Fer » appris par la redirection du 1er lot');
  assert.ok(wiki.calls[0].includes('Fer (élément chimique)') && wiki.calls[0].includes('Catégorie:éléments chimiques') && wiki.calls[0].includes('Article 1'), 'titres nettoyés avant envoi');
  assert.ok(!sent(wiki).includes('A|B') && !sent(wiki).includes('Fer'));
  assert.deepEqual(progress, [[50, 124], [100, 124], [124, 124]]);
  assert.equal(res.size, 125);
  const r = plain(res);
  assert.equal(r['Fer (élément chimique)'], 'Q677', 'redirection suivie');
  assert.equal(r['Catégorie:éléments chimiques'], 'Q5626697', 'normalisation de l\'API suivie');
  assert.equal(r['Isotopes du fer'], null, 'redirection vers une section : pas le même sujet');
  assert.equal(r['Sans élément'], null, 'article sans élément Wikidata');
  assert.equal(r['Introuvable'], null, 'article absent');
  assert.equal(r['A|B'], null, 'titre invalide, jamais envoyé');
  assert.equal(r['Article 7'], 'Q1007');
  assert.equal(r['Article 118'], 'Q1118');
  assert.equal(r['Fer'], 'Q677');
  assert.ok(resolver.version > v0);
  assert.equal(resolver.known('fer_(élément chimique)'), 'Q677');
  assert.equal(resolver.known('https://fr.wikipedia.org/wiki/Fer_(%C3%A9l%C3%A9ment_chimique)'), 'Q677');
  assert.equal(resolver.known('Introuvable'), null, 'introuvable mémorisé');
  assert.equal(resolver.known('Pas demandé'), undefined);

  // Cache : rien n'est redemandé, ni par ce resolver ni par un nouveau sur le même stockage.
  const again = await resolver.resolve(titles);
  assert.equal(wiki.calls.length, 3);
  assert.deepEqual(plain(again), r);
  const stored = JSON.parse(storage.getItem('classeur-qid'));
  assert.deepEqual(stored['Fer (élément chimique)'], ['Q677', T0]);
  assert.deepEqual(stored['Introuvable'], [null, T0]);
  const wiki2 = makeWiki();
  const fresh = M.createResolver(Object.assign({}, opts, { fetch: wiki2.fetch }));
  assert.equal(fresh.known('Article 7'), 'Q1007');
  assert.equal(fresh.known('Isotopes du fer'), null);
  await fresh.resolve(titles);
  assert.equal(wiki2.calls.length, 0, 'tout vient du stockage');

  // Expiration à 30 jours.
  const at29 = M.createResolver(Object.assign({}, opts, { fetch: wiki2.fetch, now: () => T0 + 29 * DAY }));
  assert.equal(at29.known('Article 7'), 'Q1007');
  const at31 = M.createResolver(Object.assign({}, opts, { fetch: wiki2.fetch, now: () => T0 + 31 * DAY }));
  assert.equal(at31.known('Article 7'), undefined, 'expiré');
  const renewed = await at31.resolve(['Article 7', 'Fer']);
  assert.deepEqual(wiki2.calls, [['Article 7', 'Fer']]);
  assert.equal(renewed.get('Article 7'), 'Q1007');
  assert.deepEqual(JSON.parse(storage.getItem('classeur-qid'))['Article 7'], ['Q1007', T0 + 31 * DAY]);
  assert.equal(JSON.parse(storage.getItem('classeur-qid'))['Article 8'], undefined, 'les entrées expirées ne sont pas réécrites');
}

// ------------------------------------------------------------------ cache borné, stockage abîmé ou plein, remember
{
  const { storage, resolver, clock } = setup({ max: 100, now: undefined });
  // Horloge qui avance d'une minute à chaque lecture : les lots ont des horodatages croissants.
  const ticking = M.createResolver({ fetch: makeWiki().fetch, storage, gap: 0, sleep: async () => {}, max: 100, now: () => (clock.t += 60000) });
  const many = Array.from({ length: 130 }, (_, i) => 'Article ' + (i + 1));
  await ticking.resolve(many);
  const stored = JSON.parse(storage.getItem('classeur-qid'));
  assert.equal(Object.keys(stored).length, 100, 'cache borné');
  assert.ok(many.slice(50).every((t) => stored[t]), 'les deux derniers lots (les plus récents) sont gardés');
  assert.equal(many.slice(0, 50).filter((t) => stored[t]).length, 20, 'le premier lot (le plus ancien) est rogné');
  assert.equal(ticking.known('Article 1'), 'Q1001', 'gardés en mémoire pendant la session');
  void resolver;

  const bad = new FakeStorage();
  bad.setItem('classeur-qid', '{oops');
  const r1 = M.createResolver({ fetch: makeWiki().fetch, storage: bad, gap: 0 });
  assert.equal(r1.known('Fer'), undefined, 'JSON abîmé ignoré');
  bad.setItem('classeur-qid', JSON.stringify({ A: ['nope', T0], B: ['Q5', 'hier'], C: 'Q5', D: ['Q5', Date.now()], E: [null, Date.now()] }));
  const r2 = M.createResolver({ fetch: makeWiki().fetch, storage: bad, gap: 0 });
  assert.deepEqual([r2.known('A'), r2.known('B'), r2.known('C'), r2.known('D'), r2.known('E')], [undefined, undefined, undefined, 'Q5', null]);

  const full = new FakeStorage(2500);
  const r3 = M.createResolver({ fetch: makeWiki().fetch, storage: full, gap: 0, sleep: async () => {} });
  await r3.resolve(many);
  const kept = Object.keys(JSON.parse(full.getItem('classeur-qid')));
  assert.ok(kept.length > 0 && kept.length < 130, `stockage plein : on en garde une partie (${kept.length})`);

  const refusing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() { throw new Error('SecurityError'); } };
  const r4 = M.createResolver({ fetch: makeWiki().fetch, storage: refusing, gap: 0 });
  assert.equal((await r4.resolve(['Fer'])).get('Fer'), 'Q677', 'stockage refusé : en mémoire seulement');
  r4.clear();

  const r5 = M.createResolver({ fetch: makeWiki().fetch, storage: new FakeStorage(), gap: 0 });
  const v = r5.version;
  assert.equal(r5.remember([['hydrogène', 'Q556'], ['Mauvais', 'xyz'], ['Rien', null], null]), 2);
  assert.equal(r5.known('Hydrogène'), 'Q556');
  assert.equal(r5.known('Rien'), null);
  assert.equal(r5.known('Mauvais'), undefined);
  assert.ok(r5.version > v);
  r5.clear();
  assert.equal(r5.known('Hydrogène'), undefined);
}

// ------------------------------------------------------------------ 429, erreurs, nouvelles tentatives
{
  const s = setup();
  s.wiki.script.push(response(429, { error: 'trop' }, { 'retry-after': '3' }));
  const r = await s.resolver.resolve(['Fer', 'Hg']);
  assert.equal(s.wiki.calls.length, 2, '429 puis succès');
  assert.equal(s.sleeps.length, 1);
  assert.ok(s.sleeps[0] >= 3000 && s.sleeps[0] <= 4000, 'Retry-After respecté');
  assert.equal(r.get('Hg'), 'Q925');

  const s2 = setup();
  s2.wiki.script.push(response(503, null), response(200, { error: { code: 'ratelimited', info: 'lent' } }));
  assert.equal((await s2.resolver.resolve(['Fer'])).get('Fer'), 'Q677');
  assert.deepEqual(s2.sleeps, [1000, 2000], 'sans Retry-After : attente croissante');

  const s3 = setup();
  s3.wiki.script.push(response(400, null));
  await assert.rejects(s3.resolver.resolve(['Fer']), /400/);
  assert.equal(s3.wiki.calls.length, 1, 'pas de nouvel essai sur une erreur 4xx');
  assert.equal(s3.resolver.known('Fer'), undefined, 'rien de mémorisé sur une erreur');

  const s4 = setup();
  for (let i = 0; i < 20; i++) s4.wiki.script.push(response(500, null));
  await assert.rejects(s4.resolver.resolve(['Fer']), /ne répond pas/);
  assert.equal(s4.wiki.calls.length, 8);
  assert.deepEqual(s4.sleeps, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);

  const s5 = setup();
  s5.wiki.script.push(response(200, { error: { code: 'badvalue', info: 'paramètre' } }));
  await assert.rejects(s5.resolver.resolve(['Fer']), /refusé/);
}

// ------------------------------------------------------------------ abandon
{
  const s = setup();
  const pre = new AbortController();
  pre.abort();
  await rejectsAbort(s.resolver.resolve(['Fer'], { signal: pre.signal }));
  assert.equal(s.wiki.calls.length, 0);

  // Pendant l'attente d'un 429 (vraie minuterie du resolver par défaut).
  const s2 = setup({ sleep: undefined });
  s2.wiki.script.push(response(429, null, { 'retry-after': '60' }));
  const ac = new AbortController();
  const t = performance.now();
  setTimeout(() => ac.abort(), 30);
  await rejectsAbort(s2.resolver.resolve(['Fer'], { signal: ac.signal }));
  assert.ok(performance.now() - t < 2000, 'abandon immédiat pendant l\'attente');

  // Après le premier lot : le lot reçu est gardé, les suivants ne partent pas.
  const s3 = setup();
  const ac3 = new AbortController();
  const many = Array.from({ length: 120 }, (_, i) => 'Article ' + (i + 1));
  await rejectsAbort(s3.resolver.resolve(many, { signal: ac3.signal, onProgress: (d) => { if (d === 50) ac3.abort(); } }));
  assert.equal(s3.wiki.calls.length, 1);
  assert.equal(s3.resolver.known('Article 50'), 'Q1050');
  assert.equal(s3.resolver.known('Article 51'), undefined);
  assert.ok(JSON.parse(s3.storage.getItem('classeur-qid'))['Article 50'], 'gardé dans le stockage malgré l\'abandon');
  // Le verrou est rendu : une nouvelle résolution repart d'où on en était.
  await s3.resolver.resolve(many);
  assert.deepEqual(s3.wiki.calls.map((c) => c.length), [50, 50, 20]);

  // Pendant une requête.
  const s4 = setup();
  s4.wiki.script.push((init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))));
  const ac4 = new AbortController();
  const p4 = s4.resolver.resolve(['Fer'], { signal: ac4.signal });
  setTimeout(() => ac4.abort(), 10);
  await rejectsAbort(p4);
  assert.equal(s4.resolver.known('Fer'), undefined);

  // Signal sans raison (anciens navigateurs) : AbortError quand même.
  const s5 = setup();
  const oldSignal = { aborted: true, reason: undefined, addEventListener() {}, removeEventListener() {} };
  await rejectsAbort(s5.resolver.resolve(['Fer'], { signal: oldSignal }));
}

// ------------------------------------------------------------------ une requête à la fois, sans doublon
{
  const s = setup();
  const a = Array.from({ length: 60 }, (_, i) => 'Article ' + (i + 1));
  const b = Array.from({ length: 60 }, (_, i) => 'Article ' + (i + 31));
  const [ra, rb] = await Promise.all([s.resolver.resolve(a), s.resolver.resolve(b)]);
  assert.equal(s.wiki.maxInflight, 1, 'une requête à la fois');
  assert.equal(sent(s.wiki).length, 90, 'aucun titre demandé deux fois');
  assert.equal(new Set(sent(s.wiki)).size, 90);
  assert.equal(ra.get('Article 60'), 'Q1060');
  assert.equal(rb.get('Article 31'), 'Q1031');
  assert.equal(rb.size, 60);

  // Pause entre deux requêtes (gap).
  const g = setup({ gap: 150 });
  await g.resolver.resolve(Array.from({ length: 60 }, (_, i) => 'Article ' + (i + 1)));
  assert.deepEqual(g.sleeps, [150]);
}

// ------------------------------------------------------------------ findCard / missingQidTitles
{
  const { resolver } = setup();
  const cards = [
    { id: 'c1', title: 'Fer' },
    { id: 'c2', title: 'Mercure (planète)' },
    { id: 'c3', title: 'Jeanne d’Arc' },
    { id: 'c4', title: 'hélium' },
    { id: 'c5', title: 'Ancien titre', qid: 'Q42' },
    { id: 'c1bis', title: 'Fer' },
  ];
  const index = M.createIndex(cards, resolver);
  const id = (c) => (c ? c.id : null);
  // Par titre.
  assert.equal(id(index.findCard({ title: 'Hélium' })), 'c4');
  assert.equal(id(index.findCard({ title: "Jeanne d'Arc" })), 'c3', 'apostrophe typographique');
  assert.equal(id(index.findCard({ title: 'fer' })), 'c1', 'première carte d\'un titre');
  assert.equal(id(index.findCard('https://fr.wikipedia.org/wiki/Fer')), 'c1');
  assert.equal(index.findCard(null), null);
  assert.equal(index.findCard({ title: '' }), null);
  // Par le qid propre d'une carte.
  assert.equal(id(index.findCard({ title: 'Nouveau titre', qid: 'Q42' })), 'c5');

  const items = [
    { title: 'Fer (élément chimique)', qid: 'Q677' },
    { title: 'Mercure (chimie)', qid: 'Q925' },
    { title: 'Hélium', qid: 'Q560' },
    { title: 'Iode' },
  ];
  assert.equal(index.findCard(items[0]), null, 'qid de la carte pas encore connu');
  const todo = index.missingQidTitles(items);
  assert.deepEqual([...todo], ['Iode', 'Fer', 'Mercure (planète)', 'Jeanne d’Arc', 'hélium'], 'items sans qid, puis cartes');
  assert.deepEqual([...index.missingQidTitles([{ title: 'Fer' }, { title: 'Hélium' }])], [], 'tout trouvé par titre : rien à résoudre');
  assert.deepEqual([...index.missingQidTitles([], { allCards: true })], ['Fer', 'Mercure (planète)', 'Jeanne d’Arc', 'hélium']);

  await resolver.resolve(todo);
  // Sans reconstruire l'index : il voit les qids appris.
  assert.equal(id(index.findCard(items[0])), 'c1', 'par le qid de l\'item');
  const noQid = { title: 'Fer (élément chimique)' };
  assert.equal(index.findCard(noQid), null);
  assert.deepEqual([...index.missingQidTitles([noQid])], ['Fer (élément chimique)'], 'item sans qid : son titre est à résoudre (les cartes le sont déjà)');
  await resolver.resolve(index.missingQidTitles([noQid]));
  assert.equal(id(index.findCard(noQid)), 'c1', 'par le qid connu du titre de l\'item');
  assert.equal(index.findCard(items[1]), null, 'Mercure (chimie) n\'est pas Mercure (planète)');
  assert.equal(index.findCard({ title: 'Mercure (chimie)' }), null);
  assert.equal(index.findCard({ title: 'Mercure' }), null, 'page d\'homonymie : autre élément');
  assert.equal(index.findCard({ title: 'Fer (élément chimique)', qid: 'Q999' }), null, 'le qid de l\'item prime sur celui de son titre');
  assert.equal(index.findCard(items[3]), null, 'Iode non possédée');
  assert.deepEqual([...index.missingQidTitles(items)], [], 'plus rien à résoudre');

  // L'inverse : la carte porte l'ancien titre (redirection), l'item le titre actuel.
  const inv = M.createIndex([{ id: 'old', title: 'Fer (élément chimique)' }], resolver);
  assert.equal(id(inv.findCard({ title: 'Fer', qid: 'Q677' })), 'old');

  // Redirection vers une section : la carte n'est pas l'article entier.
  const sec = M.createIndex([{ id: 'iso', title: 'Isotopes du fer' }], resolver);
  await resolver.resolve(sec.missingQidTitles([{ title: 'Fer', qid: 'Q677' }]));
  assert.equal(sec.findCard({ title: 'Fer', qid: 'Q677' }), null);

  // Sans resolver : titre et card.qid seulement.
  const bare = M.createIndex(cards);
  assert.equal(id(bare.findCard({ title: 'X', qid: 'Q42' })), 'c5');
  assert.equal(bare.findCard({ title: 'Fer (élément chimique)', qid: 'Q677' }), null);
  assert.deepEqual([...bare.missingQidTitles(items)], []);
}

// ------------------------------------------------------------------ le cas réel : « Éléments chimiques » du catalogue
{
  const catalog = JSON.parse(fs.readFileSync(path.join(here, '..', 'site', 'public', 'catalog.json'), 'utf8'));
  for (const col of catalog) for (const it of col.items) assert.ok(/^Q[1-9]\d*$/.test(it.qid), `qid de ${col.id} / ${it.title}`);
  const col = catalog.find((c) => c.id && c.name === 'Éléments chimiques');
  assert.ok(col, 'collection Éléments chimiques');
  const fer = col.items.find((i) => i.qid === 'Q677');
  assert.ok(fer && fer.title === 'Fer');
  assert.ok(col.items.some((i) => i.title === 'Mercure (chimie)' && i.qid === 'Q925'));

  const { wiki, resolver } = setup();
  // La carte a été créée quand l'article s'appelait autrement (ici : la redirection « Fer (élément chimique) »).
  const cards = [{ id: 'k1', title: 'Fer (élément chimique)' }, { id: 'k2', title: 'Hydrogène' }, { id: 'k3', title: 'Mercure (planète)' }];
  let index = M.createIndex(cards, resolver);
  const owned = () => col.items.filter((it) => index.findCard(it)).map((it) => it.title);
  assert.deepEqual(owned(), ['Hydrogène'], 'avant : seul le titre exact compte');
  const todo = index.missingQidTitles(col.items);
  assert.deepEqual([...todo], ['Fer (élément chimique)', 'Hydrogène', 'Mercure (planète)'], 'items du catalogue : qid déjà connu, seules les cartes sont à résoudre');
  await resolver.resolve(todo);
  assert.equal(wiki.calls.length, 1);
  index = M.createIndex(cards, resolver);
  assert.deepEqual(owned(), ['Hydrogène', 'Fer'], 'après : la carte Fer est reconnue, pas Mercure (planète)');
}

// ------------------------------------------------------------------ performance : 20 000 cartes
{
  const resolver = M.createResolver({ fetch: makeWiki().fetch, storage: new FakeStorage(), gap: 0 });
  const cards = Array.from({ length: 20000 }, (_, i) => ({ id: 'id' + i, title: `carte_${i} (thème ${i % 37})` }));
  resolver.remember(cards.map((c, i) => [c.title, 'Q' + (700000 + i)]));
  let t = performance.now();
  let index = M.createIndex(cards, resolver);
  const cold = performance.now() - t;
  t = performance.now();
  index = M.createIndex(cards, resolver);
  const warm = performance.now() - t;
  const items = [];
  for (let i = 0; i < 20000; i += 2) items.push({ title: `Carte ${i} (thème ${i % 37})` }); // par titre
  for (let i = 1; i < 20000; i += 2) items.push({ title: `Article renommé ${i}`, qid: 'Q' + (700000 + i) }); // par qid
  for (let i = 0; i < 2000; i++) items.push({ title: `Absente ${i}`, qid: 'Q' + (900000 + i) });
  M.createIndex(items.map((x) => ({ title: x.title })), null); // normalise les titres des items une fois
  t = performance.now();
  let found = 0;
  for (const it of items) if (index.findCard(it)) found++;
  const lookups = performance.now() - t;
  assert.equal(found, 20000);
  t = performance.now();
  const missing = index.missingQidTitles(items);
  const miss = performance.now() - t;
  assert.equal(missing.length, 0);
  console.log(`performance : index de 20 000 cartes ${cold.toFixed(1)} ms (titres jamais vus), ${warm.toFixed(1)} ms ensuite ; ${items.length} findCard ${lookups.toFixed(1)} ms ; missingQidTitles ${miss.toFixed(1)} ms`);
  assert.ok(cold < 150, `index à froid trop lent : ${cold} ms`);
  assert.ok(warm < 40, `index trop lent : ${warm} ms`);
  assert.ok(lookups < 60, `findCard trop lent : ${lookups} ms`);
}

// ------------------------------------------------------------------ valeurs par défaut : window.fetch et window.localStorage
{
  const wiki = makeWiki();
  sandbox.fetch = wiki.fetch;
  sandbox.localStorage = new FakeStorage();
  const r = M.createResolver({ gap: 0 });
  assert.equal((await r.resolve(['Hg'])).get('Hg'), 'Q925');
  assert.equal(wiki.calls.length, 1);
  assert.deepEqual(JSON.parse(sandbox.localStorage.getItem('classeur-qid')).Hg[0], 'Q925');
  Object.defineProperty(sandbox, 'localStorage', { get() { throw new Error('SecurityError'); }, configurable: true });
  const r2 = M.createResolver({ gap: 0 });
  assert.equal((await r2.resolve(['Fer'])).get('Fer'), 'Q677', 'localStorage refusé : en mémoire');
}

console.log('MATCH OK');
