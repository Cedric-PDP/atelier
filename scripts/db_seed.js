// Prépare les documents de la base de la page (owned/meta + owned/<rev>-0, -1…) à partir de data/owned.json,
// au même format que l'import fait dans la page. À envoyer avec ArtifactData (batch, file_path).
// Usage : node scripts/db_seed.js [dossier de sortie]   (défaut : cache/db_seed)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FIELDS = ['t', 'r', 'pv', 'c', 'at', 'n', 's', 'f', 'tags'];
const CHUNK = 700;
const out = process.argv[2] || path.join(ROOT, 'cache', 'db_seed');

const owned = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'owned.json'), 'utf8'));
const rows = owned.cards.map((c) => FIELDS.map((k) => (k === 's' || k === 'f' ? (c[k] ? 1 : 0) : k === 'tags' ? (c.tags || []).join('|') : c[k] ?? null)));
const rev = Date.now().toString(36);
const n = Math.max(1, Math.ceil(rows.length / CHUNK));

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (let i = 0; i < n; i++) fs.writeFileSync(path.join(out, `${rev}-${i}.json`), JSON.stringify({ rev, i, rows: rows.slice(i * CHUNK, (i + 1) * CHUNK) }));
const meta = { rev, chunks: n, fields: FIELDS, cards: rows.length, total: owned.stats ? owned.stats.total : null, unique: owned.stats ? owned.stats.unique : null, at: owned.extractedAt, source: 'claude' };
fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify(meta));
for (const f of fs.readdirSync(out)) console.log(`${path.join(out, f)} : ${(fs.statSync(path.join(out, f)).size / 1024).toFixed(0)} Ko`);
console.log(`rev ${rev}, ${n} morceaux (documents owned/${rev}-<i>) : les écrire d'abord, owned/meta en dernier, puis supprimer les morceaux de l'ancien rev`);
