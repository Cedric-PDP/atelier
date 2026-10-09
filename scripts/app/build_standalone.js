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

const swap = (from, to) => {
  const n = html.split(from).length - 1;
  if (n !== 1) throw new Error(`expected exactly one "${from}" in the page, found ${n}`);
  html = html.replace(from, () => to);
};
// JSON inside a <script>: escape "<" so no "</script>" can close it early.
const js = v => JSON.stringify(v).replace(/</g, '\\u003c');
// Injected at the top of the page's single script (smoke_page.js reads one <script> block).
swap('<script>', `<script>
const __SPAM_LOCAL__ = { data: ${js(data)}, shop: ${js(shop)} };
const __local = k => Promise.resolve({ ok: true, json: async () => __SPAM_LOCAL__[k] });
try { if (localStorage.getItem('spam-saved-local') == null) localStorage.setItem('spam-saved-local', ${JSON.stringify(js(saved))}); } catch (e) {}
`);
swap("fetch('data.json')", "__local('data')");
swap("fetch('shop.json')", "__local('shop')");
swap('Stockage en ligne indisponible ici : tes decks sont gardés dans ce navigateur seulement.',
  'Version hors ligne : tes decks sont gardés dans ce navigateur, sur ce PC.');

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out}: ${(html.length / 1048576).toFixed(1)} Mo, jeu v${data.meta.game}, ${saved.length} decks sauvegardés`);
