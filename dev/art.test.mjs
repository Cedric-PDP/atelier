// Tests de site/public/assets/art.js (illustrations : image de Wikipédia en anglais, couverture des cartes sans image).
// Chargé tel quel dans un vm (script classique), Wikipédia simulé.
// Usage : node dev/art.test.mjs   -> doit finir par ART OK
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, '..', 'site', 'public', 'assets', 'art.js'), 'utf8');
assert.ok(/Intégration/.test(code.slice(0, 3000)), 'commentaire « Intégration » en tête');
assert.ok(!/^\s*(import|export)\b/m.test(code), 'pas de module ES');
assert.ok(!/\beval\s*\(|new\s+Function\b|innerHTML/.test(code), 'ni eval, ni Function, ni innerHTML');

class FakeStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
const sandbox = { console, setTimeout, clearTimeout, URLSearchParams };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'art.js' });
const A = sandbox.ClasseurArt;
assert.ok(A && typeof A.createArt === 'function' && typeof A.coverOf === 'function');

// ------------------------------------------------------------------ nature de l'article
const K = (d, t) => A.kindOf(d, t)[0];
const cases = [
  ['footballeur algérien', '', 'personne'], ['actrice américaine', '', 'personne'], ['personnage de fiction des Simpson', 'Homer Simpson', 'personne'],
  ['compétition sportive', '', 'sport'], ['club seychellois de football', '', 'sport'], ['joueur américain de football américain', '', 'personne'],
  ['village au Cameroun', '', 'lieu'], ['commune française du département du Nord', '', 'lieu'], ["espèce d'arachnides", '', 'espece'],
  ['espèce de plantes', '', 'plante'], ['film de Cecil B. DeMille sorti en 1929', '', 'film'], ['série télévisée', '', 'film'],
  ['album de Deep Purple', '', 'musique'], ['jeu vidéo de 1985', '', 'jeu'], ['roman paru en 1993', '', 'livre'],
  ["page d'homonymie de Wikimédia", '', 'homonymie'], ['', 'Waga (homonymie)', 'homonymie'], ['', '(11194) Mirna', 'astre'],
  ['astéroïde', '', 'astre'], ['chronologie de la Tunisie', '', 'date'], ['', '1973 en Tunisie', 'date'], ['château situé à Normanville (France)', '', 'batiment'],
  ['montagne suisse', '', 'relief'], ["cours d'eau de Kansas, États-Unis", '', 'eau'], ['parti politique andorran', '', 'org'],
  ['bataille de la guerre de la Quatrième coalition', '', 'histoire'], ['composé chimique', '', 'science'], ['pâtisserie', '', 'cuisine'],
  ['peinture de Rogier van der Weyden', '', 'oeuvre'], ['navire de croisière', '', 'vehicule'], ['constructeur automobile français', '', 'org'],
  ['', 'Double-bêchage', 'article'], [null, 'Sans description', 'article'],
];
for (const [d, t, want] of cases) assert.equal(K(d, t), want, `${d || t} -> ${want}`);

// ------------------------------------------------------------------ drapeau
const C = (d) => A.countryOf(d);
assert.equal(C('village au Cameroun'), 'Cameroon');
assert.equal(C('footballeur algérien né en France'), 'Algeria', 'le pays nommé le plus tôt');
assert.equal(C('personnalité politique française'), 'France');
assert.equal(C('actrice italienne'), 'Italy');
assert.equal(C('femme politique grecque'), 'Greece');
assert.equal(C('village de Bosnie-Herzégovine'), 'Bosnia and Herzegovina');
assert.equal(C('ville du Royaume-Uni'), 'the United Kingdom');
assert.equal(C('commune de la Guyane'), null, 'pays inconnu : pas de drapeau');
assert.equal(C('Indonésie'), 'Indonesia', '« Inde » ne prend pas « Indonésie »');
assert.equal(C('chanteur sud-africain'), 'South Africa', 'adjectif composé');
assert.equal(C(''), null);
assert.equal(A.flagUrl('Cameroon'), 'https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Cameroon.svg?width=96');
assert.ok(A.flagUrl("Côte d'Ivoire").includes('Flag_of_C%C3%B4te_d\'Ivoire.svg'));
assert.equal(A.coverOf("page d'homonymie de Wikimédia", 'Paris (homonymie)').flag, null, 'homonymie : pas de drapeau');
const cov = A.coverOf('village au Cameroun', 'Bali');
assert.deepEqual({ ...cov }, { kind: 'lieu', label: 'Lieu', icon: 'k-pin', flag: A.flagUrl('Cameroon') });
const html = fs.readFileSync(path.join(here, '..', 'site', 'public', 'index.html'), 'utf8');
for (const ic of A.ICONS) assert.ok(html.includes(`<symbol id="i-${ic}"`), `icône ${ic} absente du sprite de index.html`);

// ------------------------------------------------------------------ image de Wikipédia en anglais
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const calls = [];
const EN = {
  'Homer Simpson': { title: 'Homer Simpson', pageprops: { page_image: 'Homer_Simpson_2006.png' }, thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/en/0/02/Homer_Simpson_2006.png?utm_source=en.wikipedia.org&utm_campaign=api' } },
  'Coca-Cola': { title: 'Coca-Cola', thumbnail: { source: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/27/Coca.jpg/330px-Coca.jpg?utm_source=en' } },
  'Darth Vader': { title: 'Darth Vader', pageprops: { page_image: 'Vader.jpg' }, thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/en/0/0b/Vader.jpg' } },
  Nowhere: { title: 'Nowhere' },
  'Marge Simpson': { title: 'Marge Simpson' }, // image de la fiche trop allongée : pas d'image principale
  'Lisa Simpson': { title: 'Lisa Simpson' }, // seul fichier proche : « Lisa Simpsonite », pas le sien
};
const LINKS = { 'Homer Simpson': 'Homer Simpson', 'Coca-Cola': 'Coca-Cola', 'Dark Vador': 'Darth Vader', 'Dark Vader': null, Nulle: 'Nowhere',
  'Marge Simpson': 'Marge Simpson', 'Lisa Simpson': 'Lisa Simpson' };
let fail = false;
async function get(url) {
  const u = new URL(url);
  const p = Object.fromEntries(u.searchParams);
  calls.push(u.hostname + ' ' + p.titles);
  assert.equal(p.origin, '*');
  if (fail) throw new Error('réseau');
  if (u.hostname === 'fr.wikipedia.org') {
    assert.equal(p.prop, 'langlinks');
    assert.equal(p.lllang, 'en');
    const titles = p.titles.split('|');
    const redirects = titles.includes('Dark Vader') ? [{ from: 'Dark Vader', to: 'Dark Vador' }] : [];
    return { query: { redirects, pages: titles.map((t) => (redirects.find((r) => r.from === t) || { to: t }).to)
      .map((t) => (LINKS[t] ? { title: t, langlinks: [{ lang: 'en', title: LINKS[t] }] } : { title: t })) } };
  }
  assert.equal(u.hostname, 'en.wikipedia.org');
  if (p.generator === 'images') {
    // Images des articles sans image principale : celles de Wikipédia en anglais (local, non libres) et de Commons (shared).
    assert.equal(p.titles, 'Nowhere|Marge Simpson|Lisa Simpson', 'seuls les articles sans image principale');
    const F = (title, repo, url) => ({ title, imagerepository: repo, imageinfo: [{ url, thumburl: url + '?utm_source=en' }] });
    return { query: { pages: [
      F('File:Cosplayers of Homer and Marge.jpg', 'shared', 'https://thumb.wikimedia.org/c/cos.jpg'),
      F('File:Marge Simpson.png', 'local', 'https://upload.wikimedia.org/wikipedia/en/0/0b/Marge_Simpson.png'),
      F('File:Marge - Good Night.png', 'local', 'https://upload.wikimedia.org/wikipedia/en/a/a7/Marge_-_Good_Night.png'),
      F('File:Marge Simpson.ogg', 'local', 'https://upload.wikimedia.org/wikipedia/en/x/xx/Marge.ogg'),
      F('File:Symbol support vote.svg', 'local', 'https://upload.wikimedia.org/wikipedia/en/9/94/Vote.svg'),
      F('File:Lisa Simpsonite.png', 'local', 'https://upload.wikimedia.org/wikipedia/en/l/li/Lisa_ite.png'),
    ] } };
  }
  assert.equal(p.pilicense, 'any');
  assert.equal(p.ppprop, 'page_image');
  return { query: { pages: p.titles.split('|').map((t) => EN[t] || { title: t, missing: true }) } };
}
const storage = new FakeStorage();
let changes = 0;
const art = A.createArt({ get, onChange: () => { changes++; }, storage });
const FR_IMG = 'https://upload.wikimedia.org/wikipedia/commons/x/cosplay.jpg';
// Tant que l'anglais n'est pas connu : l'image donnée, telle quelle.
assert.equal(art.image('Homer Simpson', FR_IMG), FR_IMG);
assert.equal(art.image('Coca-Cola', null), null);
art.image('Coca-Cola', null); // demandé deux fois : un seul titre dans la requête
art.image('Dark Vader', null);
art.image('Sans lien', 'https://upload.wikimedia.org/a.jpg');
art.image('Nulle', null);
art.image('Marge Simpson', FR_IMG);
art.image('Lisa Simpson', FR_IMG);
await sleep(150);
assert.equal(calls.length, 3, 'un lot : une requête en français, deux en anglais (images des articles sans image principale) : ' + calls.join(' ; '));
assert.equal(calls[0], 'fr.wikipedia.org Homer Simpson|Coca-Cola|Dark Vader|Sans lien|Nulle|Marge Simpson|Lisa Simpson');
assert.ok(changes >= 1);
// Image principale non libre en anglais : elle remplace la photo libre (sans les paramètres de suivi).
assert.equal(art.image('Homer Simpson', FR_IMG), 'https://upload.wikimedia.org/wikipedia/en/0/02/Homer_Simpson_2006.png');
// Image libre en anglais : prise seulement si la carte n'en a pas.
assert.equal(art.image('Coca-Cola', null), 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/27/Coca.jpg/330px-Coca.jpg');
assert.equal(art.image('Coca-Cola', FR_IMG), FR_IMG);
// Redirection suivie côté français.
assert.equal(art.image('Dark Vader', null), 'https://upload.wikimedia.org/wikipedia/en/0/0b/Vader.jpg');
// Sans article anglais, ou article sans image : l'image d'avant.
assert.equal(art.image('Sans lien', 'https://upload.wikimedia.org/a.jpg'), 'https://upload.wikimedia.org/a.jpg');
assert.equal(art.image('Nulle', null), null);
// Sans image principale : le fichier non libre qui porte son nom (ni la photo de Commons, ni le son, ni un autre nom).
assert.equal(art.image('Marge Simpson', FR_IMG), 'https://upload.wikimedia.org/wikipedia/en/0/0b/Marge_Simpson.png');
assert.equal(art.image('Lisa Simpson', FR_IMG), FR_IMG, '« Lisa Simpsonite » n\'est pas « Lisa Simpson »');
// Gardé dans localStorage, sans le début commun des adresses ; relu par une nouvelle page.
await sleep(1700);
const raw = JSON.parse(storage.getItem(A.STORAGE_KEY));
assert.equal(raw['Homer Simpson'][1], 'en/0/02/Homer_Simpson_2006.png');
assert.equal(raw['Sans lien'][1], 0);
const before = calls.length;
const art2 = A.createArt({ get, storage });
assert.equal(art2.image('Homer Simpson', FR_IMG), 'https://upload.wikimedia.org/wikipedia/en/0/02/Homer_Simpson_2006.png');
await sleep(100);
assert.equal(calls.length, before, 'cache relu : aucune requête');
// Échec du réseau : l'image d'avant, et pas de nouvel essai pendant la visite.
fail = true;
const art3 = A.createArt({ get, storage: new FakeStorage() });
assert.equal(art3.image('Homer Simpson', FR_IMG), FR_IMG);
await sleep(150);
const n3 = calls.length;
assert.equal(art3.image('Homer Simpson', FR_IMG), FR_IMG);
await sleep(150);
assert.equal(calls.length, n3, 'titre en échec redemandé');
fail = false;
// Lots de 50 titres au plus.
const many = Array.from({ length: 120 }, (_, i) => 'Article ' + i);
const art4 = A.createArt({ get, storage: new FakeStorage() });
const n4 = calls.length;
many.forEach((t) => art4.image(t, null));
await sleep(300);
const fr = calls.slice(n4).filter((c) => c.startsWith('fr.'));
assert.deepEqual(fr.map((c) => c.split('|').length), [50, 50, 20]);
art4.clear();
assert.equal(art4.size, 0);

// ------------------------------------------------------------------ « Changer l'illustration » : images de chaque langue
{
  const C = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Homer.jpg/330px-Homer.jpg';
  const EN = 'https://upload.wikimedia.org/wikipedia/en/0/02/Homer_Simpson_2006.png';
  const asked = [];
  const PT = 'https://upload.wikimedia.org/wikipedia/pt/0/02/Homer_Simpson_2006.png';
  const page = (title, src, file, extra) => ({ query: { pages: [{ title, ...(src ? { thumbnail: { source: src + '?utm_source=x' }, pageimage: file } : {}), ...extra }] } });
  const pages = {
    'fr.wikipedia.org': page('Homer Simpson', C, 'Homer.jpg', { langlinks: [{ lang: 'en', title: 'Homer Simpson' }, { lang: 'de', title: 'Homer Simpson' },
      { lang: 'ja', title: 'ホーマー・シンプソン' }, { lang: 'xx', title: 'Ignorée' }, { lang: 'it', title: 'Homer Simpson' }, { lang: 'pt', title: 'Homer Simpson' }] }),
    'en.wikipedia.org': page('Homer Simpson', EN, 'Homer_Simpson_2006.png'),
    'pt.wikipedia.org': page('Homer Simpson', PT, 'Homer_Simpson_2006.png'),
    'de.wikipedia.org': page('Homer Simpson', C, 'Homer.jpg'),
    'ja.wikipedia.org': page('ホーマー・シンプソン', null),
  };
  const getC = async (url) => {
    const u = new URL(url);
    asked.push(u.host + ' ' + u.searchParams.get('titles'));
    if (u.host === 'it.wikipedia.org') throw new Error('panne');
    return pages[u.host];
  };
  const r = await A.candidates('Homer Simpson', getC);
  assert.equal(r.missing, false);
  assert.deepEqual(JSON.parse(JSON.stringify(r.list)), [
    { url: C, file: 'Homer.jpg', langs: [{ code: 'fr', name: 'Français' }, { code: 'de', name: 'Allemand' }] },
    { url: EN, file: 'Homer Simpson 2006.png', langs: [{ code: 'en', name: 'Anglais' }, { code: 'pt', name: 'Portugais' }] },
  ], 'même image (même fichier) regroupée, sans utm, langue en panne ou sans image sautée');
  assert.ok(!asked.some((a) => a.startsWith('xx.')), 'langue hors de la liste jamais demandée');
  assert.ok(asked.includes('ja.wikipedia.org ホーマー・シンプソン'), 'titre de la langue');
  const none = await A.candidates('Inexistant', async () => ({ query: { pages: [{ title: 'Inexistant', missing: true }] } }));
  assert.deepEqual(JSON.parse(JSON.stringify(none)), { missing: true, list: [] });
}

console.log(`${cases.length} natures, drapeaux, image anglaise (${calls.length} requêtes simulées)`);
console.log('ART OK');
