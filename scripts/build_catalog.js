// Catalogue des collections proposées du classeur (site/public/catalog.json), d'après config/themes.json :
// un motif SPARQL par thème, seuls comptent les éléments qui ont un article sur Wikipédia en français.
// Réutilise cache/themes.json (mêmes requêtes que build_reference.js) et n'interroge Wikidata que pour les thèmes
// nouveaux ou modifiés. Usage : node scripts/build_catalog.js [--refresh]
const fs = require('fs');
const path = require('path');
const { sparql, qid } = require('../lib/net.js');

const ROOT = path.join(__dirname, '..');
const REFRESH = process.argv.includes('--refresh');
const load = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const save = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o)); };

const FR = '?a schema:about ?item ; schema:isPartOf <https://fr.wikipedia.org/> ; schema:name ?title .';
const DESC = 'OPTIONAL { ?item schema:description ?desc FILTER(LANG(?desc) = "fr") }';

async function members(where, ord) {
  const rows = await sparql(`SELECT ?item ?title ?desc ?ord WHERE { ${where} ${FR} ${DESC} ${ord || ''} }`);
  const by = new Map();
  for (const r of rows) {
    const id = qid(r.item.value);
    const o = r.ord ? r.ord.value : null;
    const cur = by.get(id);
    if (!cur) by.set(id, { q: id, t: r.title.value, d: r.desc ? r.desc.value : null, o });
    else if (o !== null && (cur.o === null || o < cur.o)) cur.o = o;
  }
  return [...by.values()];
}

// Clé d'ordre numérique : un nombre tel quel, une date ISO (y compris avant notre ère, « -0332-… ») en AAAAMMJJ signé.
// Comparer les dates comme du texte mettait les pharaons à l'envers.
function orderKey(o) {
  if (o === null || o === undefined) return null;
  const s = String(o);
  if (/^-?[\d.]+(e[+-]?\d+)?$/i.test(s)) return Number(s);
  const m = s.match(/^([+-]?)(\d{1,6})-(\d\d)-(\d\d)/);
  if (m) return (m[1] === '-' ? -1 : 1) * Number(m[2]) * 10000 + Number(m[3]) * 100 + Number(m[4]);
  return null;
}

function sortMembers(list, ordered) {
  if (!ordered) return list.sort((a, b) => a.t.localeCompare(b.t, 'fr'));
  return list.sort((a, b) => {
    if (a.o === null && b.o === null) return a.t.localeCompare(b.t, 'fr');
    if (a.o === null) return 1;
    if (b.o === null) return -1;
    const ka = orderKey(a.o), kb = orderKey(b.o);
    return ka !== null && kb !== null ? ka - kb || a.t.localeCompare(b.t, 'fr') : String(a.o).localeCompare(String(b.o));
  });
}

async function main() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'themes.json'), 'utf8'));
  const cache = load(path.join(ROOT, 'cache', 'themes.json'), {});
  const groupName = Object.fromEntries(cfg.groups.map((g) => [g.id, g.name]));
  const out = [];
  for (const th of cfg.themes) {
    const key = th.where + '|' + (th.ord || '');
    if (REFRESH || !cache[th.id] || cache[th.id].key !== key) {
      try {
        cache[th.id] = { key, at: new Date().toISOString(), list: await members(th.where, th.ord) };
        save(path.join(ROOT, 'cache', 'themes.json'), cache);
      } catch (e) {
        console.log(`échec ${th.id} : ${e.message.slice(0, 120)}`);
        continue;
      }
    }
    const list = sortMembers(cache[th.id].list.map((m) => ({ ...m })), !!th.ord);
    if (list.length < 3) { console.log(`ignoré ${th.name} : ${list.length} article(s)`); continue; }
    out.push({ id: th.id, name: th.name, group: th.group, group_name: groupName[th.group] || th.group, ordered: !!th.ord, items: list.map((m) => ({ title: m.t, description: m.d })) });
    console.log(`${th.name} : ${list.length}`);
  }
  save(path.join(ROOT, 'site', 'public', 'catalog.json'), out);
  const size = fs.statSync(path.join(ROOT, 'site', 'public', 'catalog.json')).size;
  console.log(`site/public/catalog.json : ${out.length} collections, ${(size / 1024).toFixed(0)} Ko`);
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
