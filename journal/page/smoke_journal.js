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
  knowledge: { k0: { kind: 'mécanique', subject: 'Absorption', text: 'h', status: 'hypothèse', source: 'audit' }, k1: { kind: 'mécanique', subject: 'Gel', text: 't', status: 'confirmé', source: 'wiki' } },
  matches: { '2026-10-09-1800-x': { date: '2026-10-09T18:00:00.000Z', mode: 'classé', result: 'D', first: false, turns: 9, source: 'captures',
    my: { deck: 'deck chimere', cards: [103, 238, 156, 117], unknown: [] }, opp: { name: 'Bob', cards: [197, 127, 244, 177], unknown: [], archetype: null, certainty: 90 },
    bans: { mine: 'Berserk', theirs: 'Multiplicator', c: 100 }, timeline: [{ t: '1', me: 'a', opp: 'b', inferred: false, c: 100, basis: 'capture 1' }, { t: '2', me: 'c', inferred: true, c: 70 }],
    gaps: [{ turns: '2', how: 'recharge', c: 70 }], shop: [{ t: '2', who: 'me', tox: 'Berserk', on: 103, c: 100 }], mistakes: [{ t: '4', cat: 'ciblage', what: 'w', better: 'b', cost: 'élevé', c: 90 }],
    goodPlays: [{ t: '3', what: 'g' }], lessons: ['l'], screens: ['a0'], evidence: { screens: 1, coverage: 'tours 1', confidence: 80 } },
    '2026-10-08-2000-pimp': { date: '2026-10-08T20:00:00.000Z', mode: 'normal', result: 'V', first: true, turns: 14, source: '2026-10-09T18-24-00-123Z',
    my: { cards: [103, 238, 156, 117] }, opp: { cards: [123, 127], unknown: [] }, bans: { mine: null, theirs: null, c: null, phase: 'à chaque boutique', sawOpp: true },
    screens: ['/_blob/copie1', 'b2'], evidence: { screens: 2, coverage: 'tours 1, 14' } } }
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
  bans: { mine: 'Multiplicateur', theirs: 'Tox Inconnue', rarity: { mine: 'rare', theirs: null }, c: 100, phase: 'avant le tour 1', order: 'inconnu', sawOpp: false, lasts: 'toute la partie', seen: 'capture 1 : écran de ban' },
  evidence: { coverage: 'tours 1, 2', confidence: 81 } };
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
  check(/f-ban-saw/.test(html) && /Je ne sais pas/.test($('f-ban-saw').innerHTML) && /Légendaire/.test($('f-ban-rar-mine').innerHTML) && /dl-ban-phase/.test(html), 'manual form has the optional ban fields');
  check($('m-list').innerHTML.includes('import « 2026-10-09T18-24-00-123Z »'), 'match list names the Pont import');
  (docListeners.click || []).forEach(f => f({ target: { closest: sel => (sel === '[data-open]' ? { dataset: { open: '2026-10-08-2000-pimp' } } : null) } }));
  const imp = $('m-detail').innerHTML; bad('m-detail import', imp);
  check(imp.includes('Import « 2026-10-09T18-24-00-123Z » · 2 captures'), 'match detail names the Pont import');
  check(imp.includes('src="/_blob/copie1"') && imp.includes('src="/_blob/b2"'), 'screens: asset id or URL kept as given');
  check(/Bans du shop/.test(imp) && /ses 4 cartes étaient visibles/.test(imp) && /à chaque boutique/.test(imp), 'ban details shown without banned Tox');
  check(!$('an-body').hidden, 'analyzer visible when sample+images are available');
  // Analysis: add one screenshot, analyse, save.
  $('an-file').files = [{ type: 'image/png', size: 1000, lastModified: Date.parse('2026-10-09T20:00:00Z'), name: 's1.png' }];
  $('an-file').fire('change', {});
  check(/Capture 1/.test($('an-shots').innerHTML), 'screenshot listed');
  $('an-go').fire('click', {}); await tick(20);
  check(/Ban du shop/.test(prompt) && /Multiplicateur/.test(prompt) && /"bans"/.test(prompt), 'prompt asks for shop bans with Tox names');
  check(!/tier/i.test(prompt.replace(/entier/g, '')), 'no tier in the prompt');
  check(prompt.includes('- [confirmé] Gel : t') && prompt.includes('- [hypothèse] Absorption : h') && prompt.indexOf('[confirmé] Gel') < prompt.indexOf('[hypothèse] Absorption') && /pas à tenir pour acquis/.test(prompt), 'knowledge carries its status, hypotheses flagged');
  check(/"sawOpp"/.test(prompt) && /"lasts"/.test(prompt) && /"rarity"/.test(prompt) && /bans\.seen/.test(prompt), 'prompt asks the open ban questions');
  check(/Tisseuse de Mots, #123/.test(prompt) && /prime de 50 Spamtons/.test(prompt) && /Cimetière, Vengeur/.test(prompt) && /tour 20/.test(prompt), 'prompt asks for absorption and turn 20 observations');
  const draft = $('an-draft').innerHTML; bad('an-draft', draft);
  check(!$('an-draft').hidden && /Brouillon à vérifier/.test(draft), 'draft rendered');
  check(/value="Multiplicator" selected/.test(draft), 'draft maps a known ban name to its Tox family');
  check(draft.includes('value="Tox Inconnue" selected>Tox Inconnue (lu tel quel'), 'unrecognised ban stays visible and selectable in the draft');
  check(/id="d-ban-saw"><option value="">Je ne sais pas<\/option><option value="1">[^<]*<\/option><option value="0" selected>/.test(draft), 'draft shows sawOpp = false');
  check(/id="d-ban-rar-mine">.*?value="R" selected/.test(draft) && /id="d-ban-order"[^>]*value=""/.test(draft), 'draft: rarity read, "inconnu" emptied');
  $('an-draft').fire('change', { target: { id: 'd-ban-order', value: "moi d'abord", dataset: {} } });
  const target = { dataset: { draft: 'save' }, disabled: false };
  $('an-draft').fire('click', { target: { closest: sel => (sel === '[data-draft]' ? target : null) } }); await tick(20);
  const saved = writes.find(w => w.col === 'matches');
  check(saved && saved.d.bans && saved.d.bans.mine === 'Multiplicator' && saved.d.bans.theirs === 'Tox Inconnue', 'saved bans: family id, or the raw name when unrecognised');
  const sb = (saved && saved.d.bans) || {};
  check(sb.sawOpp === false && sb.rarity && sb.rarity.mine === 'R' && sb.rarity.theirs === null && sb.lasts === 'toute la partie' && sb.phase === 'avant le tour 1' && sb.order === "moi d'abord" && /écran de ban/.test(sb.seen), 'saved optional ban fields (and a draft edit)');
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
  $('f-ban-mine').value = 'Berserk'; $('f-ban-theirs').value = 'Reset'; $('f-ban-rar-theirs').value = 'E'; $('f-ban-saw').value = '1'; $('f-ban-phase').value = ' à chaque boutique '; $('f-ban-order').value = 'simultané';
  $('add-form').fire('submit', { preventDefault() {} }); await tick(20);
  const manual = writes.filter(w => w.col === 'matches').pop();
  check(manual && manual.d.source === 'manuel' && manual.d.bans && manual.d.bans.mine === 'Berserk' && manual.d.bans.theirs === 'Reset', 'manual entry saves bans');
  const mb = (manual && manual.d.bans) || {};
  check(mb.sawOpp === true && mb.rarity && mb.rarity.theirs === 'E' && mb.rarity.mine === null && mb.phase === 'à chaque boutique' && mb.order === 'simultané' && !('lasts' in mb) && !('seen' in mb), 'manual entry saves every ban field filled in, and only those');
  check(['f-ban-mine', 'f-ban-theirs', 'f-ban-rar-theirs', 'f-ban-saw', 'f-ban-phase', 'f-ban-order'].every(k => $(k).value === ''), 'manual form resets its ban fields');
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('SMOKE OK — 5 views, analysis draft, save (' + writes.length + ' writes)');
})();
