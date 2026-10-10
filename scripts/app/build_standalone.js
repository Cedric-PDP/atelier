// Builds a self-contained copy of the Atelier page for the personal PC, where claude.ai pages cannot be opened:
// data.json and shop.json are inlined (a page opened from a local file cannot fetch), and the saved decks start
// from spam/decks.json, then live in that browser (the page already falls back to localStorage without
// window.claude). The result is pushed to the `pc-perso` branch (see CLAUDE.md).
// Usage: node scripts/app/build_standalone.js <out.html>
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const out = process.argv[2];
if (!out) { console.error('usage: node scripts/app/build_standalone.js <out.html>'); process.exit(1); }
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let html = read('site/atelier-spam.html');
const data = JSON.parse(read('site/data.json')), shop = JSON.parse(read('site/shop.json'));
const saved = JSON.parse(read('spam/decks.json')).decks;
// Card art: the images of site/img.json (scripts/app/import_art.js) are inlined, then turned into blob: URLs by the
// page so that each one is decoded once. Without them, the page loads the wiki's illustrations from spamgame.com:
// the personal PC can reach it (untested from here: the work proxy blocks it), and a failed image shows the dot.
let img = {}, art;
if (fs.existsSync(path.join(root, 'site/img.json'))) {
  img = JSON.parse(read('site/img.json'));
  for (const a of Object.values(img)) { a.b64 = fs.readFileSync(path.join(root, 'site', a.src)).toString('base64'); delete a.src; }
  art = `${Object.keys(img).length} illustrations intégrées`;
}
if (!Object.keys(img).length) {
  const wiki = new Map(JSON.parse(read(`spam/versions/${data.meta.game}/cards_fr.json`)).cards.map(c => [c.number, c]));
  for (const c of data.cards) { const w = wiki.get(c.n); if (w && w.image) img[c.n] = { src: w.image, by: w.artist }; }
  art = `${Object.keys(img).length} illustrations chargées depuis spamgame.com`;
}

const swap = (from, to) => {
  const n = html.split(from).length - 1;
  if (n !== 1) throw new Error(`expected exactly one "${from}" in the page, found ${n}`);
  html = html.replace(from, () => to);
};
// JSON inside a <script>: escape "<" so no "</script>" can close it early.
const js = v => JSON.stringify(v).replace(/</g, '\\u003c');
// Injected at the top of the page's single script (smoke_page.js reads one <script> block). Each rebuild adds the
// snapshot decks this browser has never received (by id), so a deck the user deleted does not come back.
swap('<script>', `<script>
const __SPAM_LOCAL__ = { data: ${js(data)}, shop: ${js(shop)}, saved: ${js(saved)}, img: ${js(img)} };
const __local = k => Promise.resolve({ ok: true, json: async () => __SPAM_LOCAL__[k] });
for (const a of Object.values(__SPAM_LOCAL__.img)) if (a.b64) {
  try { const b = atob(a.b64), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); a.src = URL.createObjectURL(new Blob([u], { type: 'image/webp' })); }
  catch (e) { a.src = 'data:image/webp;base64,' + a.b64; }
  delete a.b64;
}
try {
  const seeded = JSON.parse(localStorage.getItem('spam-seeded-ids') || '[]'), mine = JSON.parse(localStorage.getItem('spam-saved-local') || '[]');
  const fresh = __SPAM_LOCAL__.saved.filter(d => !seeded.includes(d.id) && !mine.some(m => m.id === d.id));
  if (fresh.length) localStorage.setItem('spam-saved-local', JSON.stringify(fresh.concat(mine)));
  localStorage.setItem('spam-seeded-ids', JSON.stringify([...new Set(seeded.concat(__SPAM_LOCAL__.saved.map(d => d.id)))]));
} catch (e) {}
`);
swap("fetch('data.json')", "__local('data')");
swap("fetch('shop.json')", "__local('shop')");
swap("fetch('img.json')", "__local('img')");
swap('Stockage en ligne indisponible ici : tes decks sont gardés dans ce navigateur seulement.',
  'Version hors ligne : tes decks sont gardés dans ce navigateur, sur ce PC.');

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out}: ${(html.length / 1048576).toFixed(1)} Mo, jeu v${data.meta.game}, ${saved.length} decks sauvegardés, ${art}`);
