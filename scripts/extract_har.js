// Usage : node scripts/extract_har.js <export.har | réponses.json> [sortie]
// Écrit data/owned.json : les cartes de la collection, sans rien d'autre du HAR.
const fs = require('fs');
const path = require('path');
const { extractCards } = require('../lib/extract.js');

const src = process.argv[2];
if (!src) { console.error('usage: node scripts/extract_har.js <export.har> [sortie]'); process.exit(2); }
const out = process.argv[3] || path.join(__dirname, '..', 'data', 'owned.json');

const { cards, stats, responses } = extractCards(fs.readFileSync(src, 'utf8'));
cards.sort((a, b) => a.t.localeCompare(b.t, 'fr'));
const doc = { extractedAt: new Date().toISOString(), responses, stats, cards };
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(doc, null, 1));

const byR = {};
for (const c of cards) byR[c.r] = (byR[c.r] || 0) + 1;
console.log(`${cards.length} cartes extraites de ${responses} réponses -> ${out}`);
console.log('par rareté :', JSON.stringify(byR));
if (stats) {
  const ok = stats.unique === cards.length;
  console.log(`le site annonce ${stats.unique} cartes différentes : ${ok ? 'export complet' : 'EXPORT INCOMPLET, faire défiler toute la collection avant d\'exporter'}`);
}
