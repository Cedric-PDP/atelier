// Smoke test of the read-only Journal of the personal-PC site (build_journal_static.js) on a fake DOM: every view
// renders from the embedded snapshot alone (window.claude is a trap), every match opens, nothing offers to write or
// delete, the counts match the snapshot, and the page has the site's navigation bar.
// Usage: node scripts/hub/smoke_journal_static.js <journal-spam.html>   → ends with "SMOKE OK" or exits 1.
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const code = html.split('<script>\n')[1].split('</script>')[0];
const json = id => { const p = html.split(`id="${id}">`)[1]; return p ? p.split('</script>')[0] : ''; };

class El {
  constructor(id) { Object.assign(this, { id, innerHTML: '', textContent: '', value: '', hidden: false, disabled: false, checked: false, dataset: {}, listeners: {}, files: [] }); this.classList = { add() {}, remove() {} }; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  fire(t, e) { (this.listeners[t] || []).forEach(f => f(e)); }
  setAttribute(k, v) { this['attr_' + k] = v; } querySelectorAll() { return []; } scrollIntoView() {} focus() {} setSelectionRange() {} remove() {}
}
const els = {};
const $ = id => els[id] || (els[id] = new El(id));
for (const id of ['cards-data', 'tox-data', 'journal-snapshot']) $(id).textContent = json(id);
const VIEWS = ['bilan', 'parties', 'meta', 'jeu', 'savoir'];
const tabs = VIEWS.map(v => { const t = new El('tab-' + v); t.dataset.view = v; return t; });
const panels = VIEWS.map(v => $('view-' + v));
const docListeners = {}, appended = [];
const document = {
  getElementById: $, activeElement: null, body: { appendChild: el => appended.push(el) }, createElement: () => new El('tmp'),
  querySelectorAll: sel => sel === '.tab' ? tabs : sel === '[role=tabpanel]' ? panels : [],
  addEventListener: (t, f) => { (docListeners[t] = docListeners[t] || []).push(f); }, removeEventListener() {}
};
const ls = {};
const localStorage = { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); } };
const errors = [];
const window = {};
Object.defineProperty(window, 'claude', { get() { errors.push('FAIL the page reached for window.claude'); return undefined; } });
process.on('unhandledRejection', e => errors.push('UNHANDLED ' + (e && e.stack || e)));

const snap = JSON.parse(json('journal-snapshot'));
new Function('window', 'document', 'localStorage', 'location', code)(window, document, localStorage, { hash: '' });
const bad = (name, h) => { const m = String(h).match(/undefined|NaN|\[object Object\]/g); if (m) errors.push(name + ' contains ' + [...new Set(m)].join(',')); };
const check = (cond, msg) => { if (!cond) errors.push('FAIL ' + msg); };
const tick = ms => new Promise(r => setTimeout(r, ms));
const click = target => (docListeners.click || []).forEach(f => f({ target }));
const open = id => { click({ closest: sel => (sel === '[data-open]' ? { dataset: { open: id } } : null) }); const h = $('m-detail').innerHTML; bad('detail ' + id, h); return h; };
const noWrite = (name, h) => check(!/data-del|Supprimer|data-del-yes/.test(h), name + ' offers no delete');

(async () => {
  await tick(30);
  // The page: skeleton, navigation bar, no claude.ai, the snapshot embedded, a read-only note.
  check(/^<!doctype html>/i.test(html) && html.includes('<meta name="viewport"'), 'document skeleton');
  const nav = (html.match(/<nav class="hubnav"[\s\S]*?<\/nav>/) || [''])[0];
  check(['index.html', 'atelier-spam.html', 'journal-spam.html', 'nouvelles.html', 'envoyer.html', '/auth/logout'].every(h => nav.includes(`href="${h}"`)), 'navigation bar with every page');
  check(nav.includes('href="journal-spam.html" aria-current="page"'), 'Journal is the current page');
  check(!/claude\.ai|window\.claude/.test(html), 'no claude.ai left');
  check(html.includes('href="atelier-spam.html">Ouvrir l\'atelier de decks</a>'), 'the Atelier link is the site page');
  check(Array.isArray(snap.matches) && Array.isArray(snap.knowledge) && Array.isArray(snap.archetypes) && snap.takenAt, 'snapshot embedded');
  check(!/ticket/i.test(JSON.stringify(Object.keys(snap))) && !/"[^"]*ticket[^"]*"\s*:/i.test(json('journal-snapshot')), 'no ticket field in the snapshot');
  check(/^Copie en lecture seule du Journal, à jour au /.test(html.split('id="db-note">')[1] || '') && !$('db-note').hidden, 'read-only note shown');
  check(!/pas pu être lu|interrompue/.test($('db-note').textContent), 'no read error');

  // Every view renders from the snapshot.
  for (const t of tabs) { t.fire('click', {}); const v = $('view-' + t.dataset.view).innerHTML; bad('view-' + t.dataset.view, v); noWrite('view-' + t.dataset.view, v); check(!/Chargement/.test(v), 'view ' + t.dataset.view + ' is loaded'); }
  const n = snap.matches.length;
  check(String($('c-parties').textContent) === (n ? String(n) : ''), `match count ${$('c-parties').textContent} = ${n}`);
  check(String($('c-savoir').textContent) === (snap.knowledge.length ? String(snap.knowledge.length) : ''), 'knowledge count');
  check(String($('c-meta').textContent) === (snap.archetypes.length ? String(snap.archetypes.length) : ''), 'archetype count');
  check(n === 0 || /\d+ partie/.test($('subtitle').textContent), 'subtitle counts the matches: ' + $('subtitle').textContent);

  // Every match opens, without screenshots nor delete.
  tabs[1].fire('click', {});
  const list = $('m-list').innerHTML; bad('m-list', list);
  for (const m of snap.matches) {
    check(list.includes(m.id), 'match listed ' + m.id);
    const d = open(m.id);
    check(d.length > 500, 'match detail ' + m.id);
    noWrite('detail ' + m.id, d);
    check(!d.includes('/_blob/'), 'no claude.ai asset in ' + m.id);
    // Try the delete flow anyway: nothing must happen.
    $('m-detail').fire('click', { target: { closest: sel => (sel === '[data-del]' ? { dataset: { del: m.id } } : null) } });
    noWrite('after a delete click ' + m.id, $('m-detail').innerHTML);
  }
  tabs[4].fire('click', {});
  const sav = $('view-savoir').innerHTML;
  for (const k of snap.knowledge.slice(0, 5)) check(sav.includes(String(k.subject).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;')), 'knowledge shown: ' + k.subject);

  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log(`SMOKE OK — journal en lecture seule : 5 vues, ${n} parties ouvertes, ${snap.knowledge.length} fiches, ${snap.archetypes.length} archétypes, instantané ${snap.takenAt}`);
})();
