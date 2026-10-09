// Smoke test of the built journal page against a fake DOM and fake claude.ai capabilities (db, user, assets,
// sample). Renders every view, runs a screenshot analysis with a canned answer and saves it, then checks the stored
// document. Usage: node journal/page/smoke_journal.js journal/journal-spam.html   → ends with "SMOKE OK" or exits 1.
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const code = html.split('<script>\n')[1].split('</script>')[0];
const json = id => { const p = html.split(`id="${id}">`)[1]; return p ? p.split('</script>')[0] : '{}'; };

class El {
  constructor(id) { Object.assign(this, { id, innerHTML: '', textContent: '', value: '', hidden: false, disabled: false, checked: false, dataset: {}, listeners: {}, files: [] }); this.classList = { add() {}, remove() {} }; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  fire(t, e) { (this.listeners[t] || []).forEach(f => f(e)); }
  setAttribute(k, v) { this['attr_' + k] = v; } querySelectorAll() { return []; } scrollIntoView() {} focus() {} setSelectionRange() {} remove() {}
}
const els = {};
const $ = id => els[id] || (els[id] = new El(id));
$('cards-data').textContent = json('cards-data');
$('tox-data').textContent = json('tox-data');
const VIEWS = ['bilan', 'parties', 'meta', 'jeu', 'savoir'];
const tabs = VIEWS.map(v => { const t = new El('tab-' + v); t.dataset.view = v; return t; });
const panels = VIEWS.map(v => $('view-' + v));
const docListeners = {};
const document = {
  getElementById: $, activeElement: null, body: { appendChild() {} }, createElement: () => new El('tmp'),
  querySelectorAll: sel => sel === '.tab' ? tabs : sel === '[role=tabpanel]' ? panels : [],
  addEventListener: (t, f) => { (docListeners[t] = docListeners[t] || []).push(f); }
};
const ls = {};
const localStorage = { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); } };

// Fake store, seeded with one archetype, one note and one analysed match.
const DB = {
  archetypes: { 'codex-ombre': { name: 'Moteur Codex (Ombre)', status: 'théorique', core: [197, 127], flex: [244], plan: 'p', counters: ['c'], bestAnswers: [], ban: { tox: 'Multiplicator', why: 'w', status: 'hypothèse' } } },
  knowledge: { k1: { kind: 'mécanique', subject: 'Gel', text: 't', status: 'confirmé', source: 'wiki' } },
  matches: { '2026-10-09-1800-x': { date: '2026-10-09T18:00:00.000Z', mode: 'classé', result: 'D', first: false, turns: 9, source: 'captures',
    my: { deck: 'deck chimere', cards: [103, 238, 156, 117], unknown: [] }, opp: { name: 'Bob', cards: [197, 127, 244, 177], unknown: [], archetype: null, certainty: 90 },
    bans: { mine: 'Berserk', theirs: 'Multiplicator', c: 100 }, timeline: [{ t: '1', me: 'a', opp: 'b', inferred: false, c: 100, basis: 'capture 1' }, { t: '2', me: 'c', inferred: true, c: 70 }],
    gaps: [{ turns: '2', how: 'recharge', c: 70 }], shop: [{ t: '2', who: 'me', tox: 'Berserk', on: 103, c: 100 }], mistakes: [{ t: '4', cat: 'ciblage', what: 'w', better: 'b', cost: 'élevé', c: 90 }],
    goodPlays: [{ t: '3', what: 'g' }], lessons: ['l'], screens: ['a0'], evidence: { screens: 1, coverage: 'tours 1', confidence: 80 } } }
};
const writes = [];
const snap = col => ({ docs: Object.entries(DB[col] || {}).map(([id, d]) => ({ id, data: () => d })) });
const db = {
  collection: col => ({
    onSnapshot: next => { setTimeout(() => next(snap(col)), 0); return () => {}; },
    doc: id => ({ set: async d => { writes.push({ col, id, d }); (DB[col] = DB[col] || {})[id || 'auto' + writes.length] = d; }, delete: async () => {} })
  })
};
const CANNED = { result: 'V', resultCertainty: 100, first: true, firstCertainty: 85, turns: 12, mode: 'classé',
  my: { cards: [103, 238, 156, 117] }, opp: { name: 'Zed', cards: [231, 136, 142, 263], archetype: null, certainty: 80 },
  timeline: [{ t: 1, me: 'gen', opp: 'x', inferred: false, c: 100, basis: 'capture 1' }, { t: 2, me: 'atk', opp: 'y', inferred: true, c: 88, basis: 'recharge' }],
  gaps: [{ turns: '2', how: 'recharges', c: 88 }], shop: [{ t: 2, who: 'opp', tox: 'Berserk', on: 231, c: 100 }],
  mistakes: [{ t: 5, cat: 'ban', what: 'w', better: 'b', cost: 'moyen', c: 70 }], goodPlays: [{ t: 3, what: 'g' }], lessons: ['l'],
  newKnowledge: [{ kind: 'carte', subject: 's', text: 't', cards: [231] }],
  bans: { mine: 'Multiplicateur', theirs: 'Tox Inconnue', c: 100, phase: 'avant le tour 1', order: 'simultané' }, evidence: { coverage: 'tours 1, 2', confidence: 81 } };
let prompt = '';
const caps = {
  db, user: { can: () => true }, assets: { upload: async () => ({ id: 'up' + writes.length }) },
  sample: Object.assign(async () => ({ text: '' }), { limits: async () => ({ images: { maxCount: 20, maxInputBytes: 2e7, mediaTypes: ['image/png'] } }), json: async (p, o) => { prompt = p; o.onText && o.onText({ text: '{', delta: '{' }); return CANNED; } })
};
const window = { claude: { use: async n => caps[n] || null } };
const URLf = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };

const errors = [];
process.on('unhandledRejection', e => errors.push('UNHANDLED ' + (e && e.stack || e)));
new Function('window', 'document', 'localStorage', 'location', 'URL', code)(window, document, localStorage, { hash: '' }, URLf);
const bad = (name, h) => { const m = String(h).match(/undefined|NaN|\[object Object\]/g); if (m) errors.push(name + ' contains ' + [...new Set(m)].join(',')); };
const check = (cond, msg) => { if (!cond) errors.push('FAIL ' + msg); };
const tick = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await tick(30);
  for (const t of tabs) { t.fire('click', {}); bad('view-' + t.dataset.view, $('view-' + t.dataset.view).innerHTML); }
  tabs[1].fire('click', {});
  bad('m-detail', $('m-detail').innerHTML); bad('m-list', $('m-list').innerHTML);
  check(/Bans du shop/.test($('m-detail').innerHTML), 'match detail shows the bans');
  check(/Multiplicateur/.test($('view-meta').innerHTML), 'meta shows the archetype ban and observed bans');
  check(/f-ban-mine/.test(html) && /Berserk/.test($('f-ban-mine').innerHTML), 'manual form has ban selects');
  check(!$('an-body').hidden, 'analyzer visible when sample+images are available');
  // Analysis: add one screenshot, analyse, save.
  $('an-file').files = [{ type: 'image/png', size: 1000, lastModified: Date.parse('2026-10-09T20:00:00Z'), name: 's1.png' }];
  $('an-file').fire('change', {});
  check(/Capture 1/.test($('an-shots').innerHTML), 'screenshot listed');
  $('an-go').fire('click', {}); await tick(20);
  check(/Ban du shop/.test(prompt) && /Multiplicateur/.test(prompt) && /"bans"/.test(prompt), 'prompt asks for shop bans with Tox names');
  check(!/tier/i.test(prompt.replace(/entier/g, '')), 'no tier in the prompt');
  const draft = $('an-draft').innerHTML; bad('an-draft', draft);
  check(!$('an-draft').hidden && /Brouillon à vérifier/.test(draft), 'draft rendered');
  check(/value="Multiplicator" selected/.test(draft), 'draft maps a known ban name to its Tox family');
  check(draft.includes('value="Tox Inconnue" selected>Tox Inconnue (lu tel quel'), 'unrecognised ban stays visible and selectable in the draft');
  const target = { dataset: { draft: 'save' }, disabled: false };
  $('an-draft').fire('click', { target: { closest: sel => (sel === '[data-draft]' ? target : null) } }); await tick(20);
  const saved = writes.find(w => w.col === 'matches');
  check(saved && saved.d.bans && saved.d.bans.mine === 'Multiplicator' && saved.d.bans.theirs === 'Tox Inconnue', 'saved bans: family id, or the raw name when unrecognised');
  check(saved && saved.d.screens.length === 1 && saved.d.source === 'captures' && saved.d.result === 'V', 'saved match fields');
  check(saved && saved.d.timeline[1].c === 88 && saved.d.evidence.confidence === 81, 'certainty kept');
  check(writes.some(w => w.col === 'knowledge' && w.d.status === 'hypothèse'), 'new knowledge saved as hypothesis');
  check(!('newKnowledge' in (saved ? saved.d : {})), 'draft-only field not stored');
  // 1.21 data: Gel shatter damage is 60 everywhere (Tox text, card text, prompt).
  check(/inflige 60 dégâts/.test(json('tox-data')) && /60 dégâts/.test(prompt) && !/40 dégâts/.test(html), 'Gel aligned on 1.21 (60)');
  // Manual entry: bans saved, then both ban selects reset.
  Object.assign($('f-date'), { value: '2026-10-09T21:00' }); $('f-res').value = 'D'; $('f-first').value = ''; $('f-mode').value = 'classé'; $('f-turns').value = '';
  ['f-my0', 'f-my1', 'f-my2', 'f-my3'].forEach((k, i) => { $(k).value = ['Lame de la forêt', 'Keria', 'Chimère Brasse-chair', "L'Œil des montagnes"][i]; });
  ['f-op0', 'f-op1', 'f-op2', 'f-op3'].forEach(k => { $(k).value = ''; }); $('f-deck').value = 'deck chimere'; $('f-note').value = 'n';
  $('f-ban-mine').value = 'Berserk'; $('f-ban-theirs').value = 'Reset';
  $('add-form').fire('submit', { preventDefault() {} }); await tick(20);
  const manual = writes.filter(w => w.col === 'matches').pop();
  check(manual && manual.d.source === 'manuel' && manual.d.bans && manual.d.bans.mine === 'Berserk' && manual.d.bans.theirs === 'Reset', 'manual entry saves bans');
  check($('f-ban-mine').value === '' && $('f-ban-theirs').value === '', 'manual form resets its ban selects');
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('SMOKE OK — 5 views, analysis draft, save (' + writes.length + ' writes)');
})();
