const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const unesc = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const decode = v => {
  if (!Array.isArray(v)) return v;
  const [t, x] = v;
  if (t === 0) { if (x && typeof x === 'object' && !Array.isArray(x)) { const o = {}; for (const k in x) o[k] = decode(x[k]); return o; } return x; }
  if (t === 1) return x.map(decode);
  return x;
};
const re = /props="([^"]*)"/g; let m, best = null;
while ((m = re.exec(html))) { if (!best || m[1].length > best.length) best = m[1]; }
const props = JSON.parse(unesc(best));
const out = {}; for (const k in props) out[k] = decode(props[k]);
const keys = Object.keys(out);
console.error('prop keys:', keys.map(k => k + ':' + (Array.isArray(out[k]) ? 'arr' + out[k].length : typeof out[k])).join(', '));
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
