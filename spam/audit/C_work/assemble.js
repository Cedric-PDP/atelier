const fs = require('fs');
const p1a = fs.readFileSync('part1a.md', 'utf8');
const p2 = fs.readFileSync('part2r.md', 'utf8');
const p1b = fs.readFileSync('part1b.md', 'utf8');
const t = fs.readFileSync('tables.md', 'utf8');
const NL = String.fromCharCode(10);
fs.writeFileSync('../C_actives.md', p1a.trimEnd() + NL + p2 + NL + '---' + NL + NL + p1b + NL + t);
console.log('assembled');
