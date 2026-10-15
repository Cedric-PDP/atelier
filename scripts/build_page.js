// Assemble la page publiée : page/app.html + data/reference.json + lib/extract.js -> dist/collections-wikimasters.html
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const tpl = fs.readFileSync(path.join(ROOT, 'page', 'app.html'), 'utf8');
const ref = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'reference.json'), 'utf8'));
const extract = fs.readFileSync(path.join(ROOT, 'lib', 'extract.js'), 'utf8');

// Dans un <script>, « </ » fermerait la balise : on l'échappe.
const refJson = JSON.stringify(ref).replace(/<\//g, '<\\/');
const html = tpl
  .replace('__REF__', () => refJson)
  .replace('__EXTRACT__', () => extract.replace(/<\/script/gi, '<\\/script'));

const out = path.join(ROOT, 'dist', 'collections-wikimasters.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out} : ${(html.length / 1024).toFixed(0)} Ko`);
