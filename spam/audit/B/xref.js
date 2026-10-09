// node xref.js <file> pat1 pat2 ... : prints the line numbers where each literal substring occurs
const fs = require('fs');
const [file, ...pats] = process.argv.slice(2);
const lines = fs.readFileSync(file, 'utf8').split('\n');
for (const p of pats) {
  const hits = [];
  lines.forEach((l, i) => { if (l.includes(p)) hits.push(i + 1); });
  console.log(p.padEnd(22), hits.join(' '));
}
