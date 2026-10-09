// usage: node h2t.js <in.html> <out.txt>   (strip HTML to readable text)
const fs = require('fs');
const [,, inp, out] = process.argv;
let h = fs.readFileSync(inp, 'utf8');
h = h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
h = h.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/header|\/footer|\/summary|\/details|\/dt|\/dd|hr)[^>]*>/gi, '\n');
h = h.replace(/<h([1-6])[^>]*>/gi, (m, l) => '\n' + '#'.repeat(+l) + ' ');
h = h.replace(/<li[^>]*>/gi, '\n- ');
h = h.replace(/<[^>]+>/g, ' ');
const ent = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d', hellip: '\u2026', middot: '\u00b7', eacute: '\u00e9', egrave: '\u00e8', agrave: '\u00e0', ccedil: '\u00e7', ecirc: '\u00ea', ocirc: '\u00f4', ucirc: '\u00fb', icirc: '\u00ee', laquo: '\u00ab', raquo: '\u00bb', times: '\u00d7', minus: '\u2212', ndash: '\u2013', mdash: '\u2014', larr: '\u2190', rarr: '\u2192' };
h = h.replace(/&#x([0-9a-f]+);/gi, (m, x) => String.fromCodePoint(parseInt(x, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&([a-z]+);/gi, (m, e) => ent[e] !== undefined ? ent[e] : m);
h = h.split('\n').map(l => l.replace(/[ \t\r]+/g, ' ').trim()).filter(l => l.length).join('\n');
fs.writeFileSync(out, h);
