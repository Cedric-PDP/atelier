// Builds the read-only Journal of the personal-PC site from journal/journal-spam.html (the page published on
// claude.ai) and a snapshot of its base: the page reads the embedded documents instead of window.claude (no db, no
// user), so nothing can be written or deleted, and the delete button is never shown. The snapshot is the output of
// three ArtifactData reads on https://claude.ai/artifact/WSVR5uVuFT9SMAa9WSaqpL:
//   action "list", collection matches | knowledge | archetypes, query {limit: 1000}, out_dir <dir>
// which write <dir>/<collection>/<doc id>.json. Screenshots of old matches (claude.ai assets) cannot be served:
// they are dropped. A document with a « ticket » field stops the build (match tickets never leave the work PC).
// Usage: node scripts/hub/build_journal_static.js <snapshot dir> <out.html>
//        node scripts/hub/build_journal_static.js --reuse <previous out.html> <out.html>   (same snapshot, page rebuilt)
const fs = require('fs'), path = require('path');
const { injectNav, esc } = require('./nav.js');
const root = path.join(__dirname, '..', '..');
const COLS = ['matches', 'knowledge', 'archetypes'];

// "10 octobre 2026 à 8 h 21", Paris time.
const fmtWhen = d => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day} ${p.month} ${p.year} à ${+p.hour} h ${p.minute}`;
};

function findTickets(v, at, hits) {
  if (Array.isArray(v)) v.forEach((x, i) => findTickets(x, `${at}[${i}]`, hits));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (/ticket/i.test(k)) hits.push(`${at}.${k}`); findTickets(x, `${at}.${k}`, hits); }
  return hits;
}

// Reads <dir>/<collection>/*.json into {takenAt, matches:[{id,...}], knowledge:[...], archetypes:[...]}.
function readSnapshot(dir) {
  const snap = { takenAt: null }; let newest = 0, dropped = 0;
  for (const col of COLS) {
    const d = path.join(dir, col);
    if (!fs.existsSync(d)) throw new Error(`snapshot: ${d} is missing (ArtifactData list ${col} with out_dir ${dir})`);
    snap[col] = fs.readdirSync(d).filter(f => f.endsWith('.json')).sort().map(f => {
      const p = path.join(d, f); newest = Math.max(newest, fs.statSync(p).mtimeMs);
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('snapshot: not a document ' + p);
      return Object.assign({ id: f.slice(0, -5) }, doc);
    });
  }
  for (const m of snap.matches) {
    if (Array.isArray(m.screens) && m.screens.length) { dropped += m.screens.length; m.screens = []; }
    if (Array.isArray(m.screensRead) && m.screensRead.length) m.screensRead = [];
  }
  snap.takenAt = new Date(newest || Date.now()).toISOString();
  return { snap, dropped };
}

function readEmbedded(file) {
  const html = fs.readFileSync(file, 'utf8');
  const m = /<script type="application\/json" id="journal-snapshot">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error(`${file} has no embedded snapshot`);
  return JSON.parse(m[1]);
}

function build(snap, out) {
  const tickets = findTickets(snap, 'snapshot', []);
  if (tickets.length) throw new Error('a match ticket is in the snapshot, nothing written: ' + tickets.join(', '));
  let html = fs.readFileSync(path.join(root, 'journal', 'journal-spam.html'), 'utf8');
  const swap = (from, to) => {
    const n = html.split(from).length - 1;
    if (n !== 1) throw new Error(`journal page: expected exactly one "${from.slice(0, 60)}", found ${n} (has journal-src.html changed?)`);
    html = html.replace(from, () => to);
  };
  // Boot: the documents come from the page, not from window.claude (from "const w = window.claude;" to the last sub()).
  const a = html.indexOf('  const w = window.claude;'), endMark = "sub('archetypes', 'a', 'arch');", b = html.indexOf(endMark);
  if (a < 0 || b < a || html.indexOf('  const w = window.claude;', a + 1) >= 0 || html.indexOf(endMark, b + 1) >= 0) throw new Error('journal page: boot block not found');
  html = html.slice(0, a) + `  // Read-only copy (scripts/hub/build_journal_static.js): the documents are a snapshot embedded in the page.
  let snap = {};
  try { snap = JSON.parse($('journal-snapshot').textContent) || {}; } catch (e) { snap = {}; }
  S.matches = arr(snap.matches); S.know = arr(snap.knowledge); S.arch = arr(snap.archetypes);
  S.ready = { m: true, k: true, a: true }; render();` + html.slice(b + endMark.length);
  // No delete button, even if a db came back somehow.
  swap('S.db && S.canWrite !== false ?', 'false ?');
  swap("Le journal n'est pas accessible dans cette vue. Ouvre la page depuis claude.ai en étant connecté.", "Le journal n'a pas pu être lu.");
  // The Atelier is the site's page.
  html = html.replace(/<a class="small" href="https:\/\/claude\.ai\/artifact\/[^"]*" target="_blank" rel="noopener">Ouvrir l'atelier de decks ↗<\/a>/,
    () => '<a class="small" href="atelier-spam.html">Ouvrir l\'atelier de decks</a>');
  const n = snap.matches.length, when = fmtWhen(new Date(snap.takenAt));
  swap('<p class="note warn sec" id="db-note" hidden></p>',
    `<p class="note sec" id="db-note">Copie en lecture seule du Journal, à jour au ${esc(when)} (${n} partie${n > 1 ? 's' : ''}). Claude la met à jour après chaque envoi de replays.</p>`);
  // The snapshot, right before the page script ("<" escaped so that no "</script>" closes it).
  swap('<script>\n(() => {', `<script type="application/json" id="journal-snapshot">${JSON.stringify(snap).replace(/</g, '\\u003c')}</script>\n<script>\n(() => {`);
  html = injectNav(html, 'journal-spam.html');
  if (/window\.claude|claude\.ai/.test(html)) throw new Error('journal page: a claude.ai reference is left');
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, html);
  return { n, k: snap.knowledge.length, a: snap.archetypes.length, when, size: html.length };
}

module.exports = { readSnapshot, readEmbedded, build, fmtWhen };

if (require.main === module) {
  const args = process.argv.slice(2);
  let snap, dropped = 0;
  if (args[0] === '--reuse' && args.length === 3) snap = readEmbedded(args[1]);
  else if (args.length === 2) ({ snap, dropped } = readSnapshot(args[0]));
  else { console.error('usage: node scripts/hub/build_journal_static.js <snapshot dir> <out.html>\n       node scripts/hub/build_journal_static.js --reuse <previous.html> <out.html>'); process.exit(1); }
  const out = args[args.length - 1], r = build(snap, out);
  console.log(`${out}: ${(r.size / 1024).toFixed(0)} Ko, ${r.n} parties, ${r.k} fiches, ${r.a} archétypes, instantané du ${r.when}${dropped ? `, ${dropped} captures non reprises` : ''}`);
}
