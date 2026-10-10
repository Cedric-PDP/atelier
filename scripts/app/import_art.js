// Card art for the Atelier. The illustrations live on spamgame.com, which the work proxy blocks and a published page
// cannot load (its CSP only allows its own files): the personal PC downloads them and sends a zip (README of the
// `pc-perso` branch). Usage:
//   node scripts/app/import_art.js <folder>   files named like the wiki's (<slug>.<hash>.webp, any subfolder) -> spam/img/<number>.webp
//   node scripts/app/import_art.js            only rebuild site/img/ + site/img.json from spam/img/ (e.g. after a collection change)
// site/img.json maps each card of site/data.json to {src: "img/<n>.webp", by: artist}; the page shows the element dot
// for a card without art. build_standalone.js inlines the same images in the offline copy.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'site/data.json'), 'utf8'));
const cards = JSON.parse(fs.readFileSync(path.join(root, 'spam/versions', data.meta.game, 'cards_fr.json'), 'utf8')).cards;
const lib = path.join(root, 'spam/img'), site = path.join(root, 'site/img');
// The image URL's file name starts with the card's slug: .../512/<slug>.<hash>.webp
const slugOf = f => path.basename(f).split('.')[0];
const bySlug = new Map(cards.map(c => [slugOf(c.image || c.slug), c]));
const isWebp = b => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';

const src = process.argv[2];
if (src) {
  const files = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.isFile() && /\.webp$/i.test(e.name)) files.push(p);
  });
  walk(src);
  fs.mkdirSync(lib, { recursive: true });
  const got = new Set(), unknown = [], invalid = [];
  for (const f of files) {
    const c = bySlug.get(slugOf(f)); if (!c) { unknown.push(path.basename(f)); continue; }
    const b = fs.readFileSync(f);
    if (!isWebp(b) || b.length > 4 << 20) { invalid.push(path.basename(f)); continue; }
    fs.writeFileSync(path.join(lib, c.number + '.webp'), b); got.add(c.number);
  }
  const missing = cards.filter(c => !got.has(c.number)).map(c => `${c.number} ${c.name}`);
  console.log(`${got.size} illustrations rangées dans spam/img/ (sur ${cards.length} cartes en ${data.meta.game})`);
  if (missing.length) console.log('manquantes :', missing.join(', '));
  if (unknown.length) console.log('fichiers inconnus, ignorés :', unknown.join(', '));
  if (invalid.length) console.log('pas des images WebP, ignorés :', invalid.join(', '));
}

// site/img/ = the page's cards only (published with it), named by card number.
fs.mkdirSync(site, { recursive: true });
const pool = new Set(data.cards.map(c => c.n)), artist = new Map(cards.map(c => [c.number, c.artist]));
for (const f of fs.readdirSync(site)) if (/^\d+\.webp$/.test(f) && !pool.has(+f.split('.')[0])) fs.unlinkSync(path.join(site, f));
const map = {}, files = {};
for (const c of data.cards) {
  const from = path.join(lib, c.n + '.webp'); if (!fs.existsSync(from)) continue;
  fs.copyFileSync(from, path.join(site, c.n + '.webp'));
  map[c.n] = artist.get(c.n) ? { src: `img/${c.n}.webp`, by: artist.get(c.n) } : { src: `img/${c.n}.webp` };
  files[`img/${c.n}.webp`] = `site/img/${c.n}.webp`;
}
fs.writeFileSync(path.join(root, 'site/img.json'), JSON.stringify(map));
const n = Object.keys(map).length;
console.log(`site/img.json : ${n} cartes de la page sur ${data.cards.length} ont une illustration`);
if (n) console.log('files à publier avec la page :', JSON.stringify(Object.assign({ 'data.json': 'site/data.json', 'shop.json': 'site/shop.json', 'img.json': 'site/img.json' }, files)));
