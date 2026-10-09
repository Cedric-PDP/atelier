// Smoke test of the built journal page against a fake DOM and fake claude.ai capabilities (db, user). Renders every view
// with matches imported from replays (shop with offers and rerolls, bans.none, Tox game ids with rarity, long timeline
// texts) and older ones (screenshot analysis, manual entry, Pont import), opens a screenshot, deletes a match, and checks
// that the page has no entry form or screenshot analysis left.
// Usage: node journal/page/smoke_journal.js journal/journal-spam.html   → ends with "SMOKE OK" or exits 1.
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const code = html.split('<script>\n')[1].split('</script>')[0];
const json = id => { const p = html.split(`id="${id}">`)[1]; return p ? p.split('</script>')[0] : '{}'; };
const NBSP = String.fromCharCode(160);

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
const docListeners = {}, appended = [];
const document = {
  getElementById: $, activeElement: null, body: { appendChild: el => appended.push(el) }, createElement: () => new El('tmp'),
  querySelectorAll: sel => sel === '.tab' ? tabs : sel === '[role=tabpanel]' ? panels : [],
  addEventListener: (t, f) => { (docListeners[t] = docListeners[t] || []).push(f); }, removeEventListener() {}
};
const ls = {};
const localStorage = { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); } };

// A match as read_srpl.js drafts it (journal key) plus the analysis, shaped like the base on 2026-10-09 (the shop is the
// real one of match-1056862, the timeline an excerpt), with bans.none set.
const BASIS = 'replay match-1056862.srpl décodé (read_srpl.js 1.0) ; buffs et statuts rattachés aux lancers par proximité et par le modèle';
const T = (t, me, opp) => ({ t, me, opp, note: '', inferred: false, c: 95, basis: BASIS });
const S = (t, who, tox, on, replaced, cost, rerolls, rerollSpent, offers) => ({ t, who, tox, pass: !tox, on, replaced, c: 100, cost, rerolls, rerollSpent, offers });
const REPLAY = {
  date: '2026-10-09T11:04:12Z', mode: 'normal', result: 'D', resultCertainty: 100, first: true, firstCertainty: 100, turns: 11,
  source: 'pc-perso@bbfb1ca', createdAt: 1791564720000,
  my: { deck: 'deck chimere', cards: [103, 117, 156, 238], unknown: [] },
  opp: { name: 'Rival', cards: [263, 219, 33, 5], unknown: [], archetype: null, certainty: 100 },
  timeline: [
    T(1, "[25 Spamtons, Chance 1] Lame de la forêt · Pinces : Nakyel −6 (500→494). passifs : L'Œil des montagnes (Cœur d'eau) +1 Eau",
      "[27 Spamtons, Chance 1] Catixy · Charme Sinistre : critique +25 % (Catixy). Catixy · Miaulement : L'Œil des montagnes −41 crit. (572→531), critique +5 % (Catixy). Paguroniyx · Cisaille veneneuse : L'Œil des montagnes −32 (531→499)"),
    T(2, "[51 Spamtons, Chance 2] Boutique : Cœur d'eau C, Spamland C, Berserk C. relance (−10) : Érosion C, Vampirisme C, Renvoi C. passe (+10). Chimère Brasse-chair · Galop arctique : Paguroniyx −18 (850→832), Esprit Ombre −21 crit. (488→467), soin 15 crit. sur Chimère Brasse-chair (525→525/525)",
      '[55 Spamtons, Chance 2] Boutique : Ténacité C, Érosion C, Spamland C. achète Spamland C (6) sur Nakyel. Esprit Ombre · Obscur : +1 Ombre'),
    T(8, '[153 Spamtons, Chance 8] Lame de la forêt · Soin critique : soin 58 crit. sur L\'Œil des montagnes (58→116/600), critique +10 % (L\'Œil des montagnes)',
      "[176 Spamtons, Chance 8] Catixy · Miaulement : L'Œil des montagnes −121 crit. (66→0), L'Œil des montagnes retirée du jeu, critique +5 % (Catixy). prime +50 Spamtons (moi)"),
    T(11, '[162 Spamtons, Chance 11] passifs : Keria (Cœur vital) PV max +30 (Keria)', '— (partie finie par abandon pendant mon tour)')
  ],
  gaps: [],
  shop: [
    S(2, 'me', null, null, null, 0, 1, 10, [['CoeurEau_C', 'Spamland_C', 'Berserk_C'], ['Erosion_C', 'Life Steal_C', 'Reflect_C']]),
    S(2, 'opp', 'Spamland_C', 33, null, 6, 0, 0, [['Tenacite_C', 'Erosion_C', 'Spamland_C']]),
    S(4, 'me', 'CoeurVital_C', 117, null, 10, 2, 25, [['Tenacite_C', 'Reflect_C', 'CoeurLumiere_C'], ['Aoe_C', 'CoeurFeu_C', 'Brut_R'], ['Optimisation_R', 'CoeurVital_C', 'CoeurFeu_C']]),
    S(4, 'opp', 'Berserk_C', 219, null, 30, 1, 10, [['CoeurLumiere_C', 'CoeurFeu_C', 'CoeurTerre_C'], ['Chance_C', 'PunchingBag_C', 'Berserk_C']]),
    S(6, 'me', 'CoeurVital_R', 117, 'CoeurVital_C', 30, 1, 10, [['Cimetiere_C', 'Cimetiere_R', 'CoeurTerre_C'], ['Reflect_R', 'CoeurVital_R', 'Spamland_C']]),
    S(6, 'opp', 'Optimisation_R', 5, null, 40, 0, 0, [['Berserk_C', 'Optimisation_R', 'Inversement_R']]),
    S(8, 'me', 'Primitive heal_E', 156, 'CoeurEau_C', 60, 1, 10, [['CoeurLumiere_R', 'Mimetisme_R', 'CoeurLumiere_C'], ['CoeurResistance_E', 'Primitive heal_E', 'Smoked_R']]),
    S(8, 'opp', null, null, null, 0, 1, 10, [['Phoenix_E', 'Chance_E', 'CoeurVital_R'], ['Shield_R', 'Phoenix_C', 'CoeurEau_E']]),
    S(10, 'me', 'Erosion_E', 238, 'Mimetisme_R', 75, 2, 25, [['Phoenix_R', 'Reflect_R', 'Reflect_E'], ['Vengeur_E', 'Smoked_R', 'Cimetiere_E'], ['CoeurLumiere_C', 'Erosion_E', 'CoeurResistance_C']]),
    S(10, 'opp', 'CoeurVital_E', 33, 'Spamland_C', 70, 1, 10, [['CoeurEau_R', 'Shield_E', 'Mystere_R'], ['CoeurVital_E', 'Phoenix_R', 'Phoenix_E']])
  ],
  bans: { none: true, mine: null, theirs: null, c: 100, seen: 'Statistiques de fin de partie du serveur : « bans: [] » pour les deux joueurs.' },
  evidence: { screens: 0, confidence: 95, coverage: 'replay entier décodé (match-1056862.srpl, 1148 messages, 0 erreur)' },
  screens: [], screensRead: [],
  summary: 'Défaite par abandon au début de mon tour 11.', turningPoint: "Tour 8 adverse : Catixy achève L'Œil des montagnes.",
  mistakes: [{ t: 8, cat: 'boutique', what: 'Soin primitif É acheté sur une carte mourante.', better: 'Garder les Spamtons.', cost: 'moyen', c: 85 }],
  goodPlays: [], lessons: ['Catixy est la menace de ce deck.'],
  note: 'Replay match-1056862.srpl décodé par scripts/replay/read_srpl.js 1.0.'
};
// Second player, and the bans as written before bans.none existed (nothing known, explained in seen).
const REPLAY2 = {
  date: '2026-10-09T13:46:39Z', mode: 'normal', result: 'V', first: false, turns: 2, source: 'pc-perso@bbfb1ca', createdAt: 1791564720001,
  my: { deck: 'deck chimere', cards: [103, 156, 117, 238], unknown: [] }, opp: { name: 'Autre', cards: [123, 222, 6, 22], unknown: [], archetype: null, certainty: 100 },
  timeline: [T(1, '[25 Spamtons, Chance 1] Lame de la forêt · Pinces : Tisseuse de Mots −5 (500→495)', '[30 Spamtons, Chance 2] Fleur de Vie · Barrière Florale : Provocation sur Fleur de Vie'),
    T(2, '[51 Spamtons, Chance 2] Boutique : Sac de frappe C, Poison C, Érosion C', "[61 Spamtons, Chance 4] Tisseuse de Mots · Veuve noire : PV max +525 (Tisseuse de Mots), Chimère Brasse-chair retirée du jeu")],
  shop: [S(2, 'opp', null, null, null, 0, 0, 0, [['Shield_C', 'Revenge_R', 'CoeurEau_R']])],
  bans: { c: 95, lasts: null, mine: null, order: null, phase: null, sawOpp: null, theirs: null, seen: 'Aucun ban dans cette partie : stats du serveur.' },
  evidence: { screens: 0, confidence: 95, coverage: 'replay entier décodé (match-1087144.srpl)' }, screens: [], screensRead: [], mistakes: [], goodPlays: [], lessons: []
};
// Older matches, from before the replays: screenshot analysis in the page, Pont import, manual entry.
const DB = {
  archetypes: { 'codex-ombre': { name: 'Moteur Codex (Ombre)', status: 'théorique', core: [197, 127], flex: [244], plan: 'p', counters: ['c'], bestAnswers: [], ban: { tox: 'Multiplicator', why: 'w', status: 'hypothèse' } } },
  knowledge: { k0: { kind: 'mécanique', subject: 'Absorption', text: 'h', status: 'hypothèse', source: 'audit' }, k1: { kind: 'mécanique', subject: 'Gel', text: 't', status: 'confirmé', source: 'wiki' } },
  matches: {
    '2026-10-09-1304-6862': REPLAY,
    '2026-10-09-1546-7144': REPLAY2,
    '2026-10-09-1800-x': { date: '2026-10-09T18:00:00.000Z', mode: 'classé', result: 'D', first: false, turns: 9, source: 'captures',
      my: { deck: 'deck chimere', cards: [103, 238, 156, 117], unknown: [] }, opp: { name: 'Bob', cards: [197, 127, 244, 177], unknown: [], archetype: null, certainty: 90 },
      bans: { mine: 'Berserk', theirs: 'Multiplicator', rarity: { mine: 'R', theirs: null }, c: 100 }, timeline: [{ t: '1', me: 'a', opp: 'b', inferred: false, c: 100, basis: 'capture 1' }, { t: '2', me: 'c', inferred: true, c: 70 }],
      gaps: [{ turns: '2', how: 'recharge', c: 70 }], shop: [{ t: '2', who: 'me', tox: 'Berserk', on: 103, c: 100 }], mistakes: [{ t: '4', cat: 'ciblage', what: 'w', better: 'b', cost: 'élevé', c: 90 }],
      goodPlays: [{ t: '3', what: 'g' }], lessons: ['l'], screens: ['a0'], evidence: { screens: 1, coverage: 'tours 1', confidence: 80 } },
    '2026-10-08-2000-pimp': { date: '2026-10-08T20:00:00.000Z', mode: 'normal', result: 'V', first: true, turns: 14, source: '2026-10-09T18-24-00-123Z',
      my: { cards: [103, 238, 156, 117] }, opp: { cards: [123, 127], unknown: [] }, bans: { mine: null, theirs: null, c: null, phase: 'à chaque boutique', sawOpp: true },
      screens: ['/_blob/copie1', 'b2'], evidence: { screens: 2, coverage: 'tours 1, 14' } },
    '2026-10-07-2100-mabc': { date: '2026-10-07T21:00:00.000Z', mode: 'classé', result: 'N', first: null, turns: null, source: 'manuel',
      my: { deck: 'deck chimere', cards: [103, 238, 156, 117] }, opp: { cards: [], unknown: [] }, note: 'Partie saisie à la main.', createdAt: '2026-10-07T21:30:00.000Z' }
  }
};
const deleted = [];
const snap = col => ({ docs: Object.entries(DB[col] || {}).map(([id, d]) => ({ id, data: () => d })) });
const db = {
  collection: col => ({
    onSnapshot: next => { setTimeout(() => next(snap(col)), 0); return () => {}; },
    doc: id => ({ set: async () => { throw new Error('the page must not write documents'); }, delete: async () => { deleted.push(col + '/' + id); } })
  })
};
const uses = [];
const caps = { db, user: { can: () => true }, sample: {}, assets: {} };
const window = { claude: { use: async n => { uses.push(n); return caps[n] || null; } } };

const errors = [];
process.on('unhandledRejection', e => errors.push('UNHANDLED ' + (e && e.stack || e)));
new Function('window', 'document', 'localStorage', 'location', code)(window, document, localStorage, { hash: '' });
const bad = (name, h) => { const m = String(h).match(/undefined|NaN|\[object Object\]/g); if (m) errors.push(name + ' contains ' + [...new Set(m)].join(',')); };
const check = (cond, msg) => { if (!cond) errors.push('FAIL ' + msg); };
const tick = ms => new Promise(r => setTimeout(r, ms));
const click = target => (docListeners.click || []).forEach(f => f({ target }));
const open = id => { click({ closest: sel => (sel === '[data-open]' ? { dataset: { open: id } } : null) }); const h = $('m-detail').innerHTML; bad('detail ' + id, h); return h; };
const count = (h, s) => h.split(s).length - 1;

(async () => {
  await tick(30);
  // Every view renders; nothing left of the entry forms or of the screenshot analysis.
  for (const t of tabs) { t.fire('click', {}); const v = $('view-' + t.dataset.view).innerHTML; bad('view-' + t.dataset.view, v); check(!/\btier/i.test(v), 'no tier in view ' + t.dataset.view); }
  check(!/id="(an-panel|an-file|an-go|an-draft|add-form|add-box|f-save|f-ban-mine|dl-cards|dl-ban-phase)"/.test(html) && !/Analyser une partie|Ajouter une partie/.test(html), 'no screenshot analysis nor manual entry form in the page');
  check(html.includes('Les parties viennent des replays du jeu'), 'Parties says where matches come from');
  check(!/buildPrompt|sampleErr|saveManual|saveDraft|assets\.upload/.test(code), 'dead code of the removed forms is gone');
  check(uses.includes('db') && uses.includes('user') && !uses.includes('sample') && !uses.includes('assets'), 'the page asks only for db and user (asked: ' + uses.join(', ') + ')');
  check(/@container \(max-width: 640px\) \{ \.halves/.test(html) && /@media \(max-width: 600px\) \{ \.halves/.test(html), 'the two half-turns stack on narrow screens');
  const tox = JSON.parse(json('tox-data'));
  check(Object.keys(tox).length === 101 && tox['Primitive heal_E'] && tox['Primitive heal_E'].name === 'Soin primitif', 'the 101 Tox of ref/tox.json are inlined, by game id');
  check(/inflige 60 dégâts/.test(json('tox-data')) && !/40 dégâts/.test(html), 'Gel aligned on 1.21 (60)');

  // List: the old sources are named, the replays (the norm) are not.
  tabs[1].fire('click', {});
  const list = $('m-list').innerHTML; bad('m-list', list);
  check(list.includes('import « 2026-10-09T18-24-00-123Z »') && list.includes(' · saisie manuelle') && list.includes(' · captures') && !list.includes('pc-perso@'), 'match list names the older sources only');

  // A match imported from a replay.
  const d = open('2026-10-09-1304-6862');
  check(!/CoeurVital_|Primitive heal_|Life Steal_|Mimetisme_|Erosion_|CoeurEau_|Spamland_/.test(d), 'no raw Tox id left in the detail');
  check(d.includes('Soin primitif <span class="rar E">E</span>') && d.includes('Vampirisme <span class="rar C">C</span>') && d.includes('Cœur vital <span class="rar R">R</span>'), 'Tox shown by French name and rarity');
  check(/, à la place de <span class="tox"[^>]*>Mimétisme <span class="rar R">R<\/span>/.test(d) && /, à la place de <span class="tox"[^>]*>Cœur d&#39;eau <span class="rar C">C<\/span>/.test(d), 'replaced Tox by name and rarity');
  check(d.includes('Achète <span class="tox"') && d.includes(' pour 60 Spamtons sur <span class="cc"') && d.includes('Passe <span class="muted">(+10 Spamtons)</span>'), 'shop: purchase, price, card, pass');
  check(d.includes('2 relances : 25 Spamtons') && d.includes('1 relance : 10 Spamtons') && d.includes('Sans relance'), 'shop: rerolls and Spamtons spent');
  check(count(d, '<details class="offers">') === 10 && d.includes('<summary>Offres vues (3)</summary>') && d.includes('<span class="ol">Relance 2</span>') && d.includes('<span class="ol">Départ</span>'), 'shop: offers seen, collapsed');
  check(count(d, 'class="tox bought"') === 8 && d.includes('<span class="pr num">60</span>'), 'shop: the purchase is ticked in the offers, offers show their price');
  check(d.includes('<b>Moi</b> : 4 achats, 1 passe, 7 relances · 255 Spamtons dépensés, dont 80 en relances') && d.includes('<b>Adversaire</b> : 4 achats, 1 passe, 3 relances · 176 Spamtons dépensés, dont 30 en relances'), 'shop totals per side');
  check(d.includes('<span class="rar L">L</span> légendaire'), 'rarity legend');
  check(d.includes('Tous les passages : <span class="cert seen"') && !/<b class="who">(Moi|Adversaire)<\/b><span class="cert/.test(d), 'shop: a certainty shared by all visits is shown once');
  check(/<b>Bans du shop<\/b> · Aucun ban dans cette partie <span class="cert seen"/.test(d) && !/moi : <span class="muted">\?<\/span>/.test(d), 'bans.none shows "Aucun ban"');
  check(!d.includes('<table class="timeline"') && count(d, 'class="halves"') === 4 && d.includes('25 Spamtons, Chance 1'), 'timeline: one block per turn, the Spamtons apart');
  check(d.includes('<li><b>Lame de la forêt · Pinces</b> : Nakyel −6 (500→494)</li>'), 'timeline: one line per action, the actor in bold');
  check(d.includes('<li><b>Catixy · Miaulement</b> : L&#39;Œil des montagnes −41 crit.' + NBSP + '(572→531), critique +5 % (Catixy)</li>'), 'timeline: a critical hit stays on its line');
  check(d.includes('<li><b>Esprit Ombre · Obscur</b> : +1 Ombre</li>') && d.includes('<li><b>relance (−10)</b> : Érosion C, Vampirisme C, Renvoi C</li>') && d.includes('<li>passe (+10)</li>'), 'timeline: shop lines split');
  check(/<li class="ko"><b>Catixy · Miaulement<\/b> : [^<]*retirée du jeu/.test(d) && /<li class="pas"><b>passifs<\/b> : /.test(d) && d.includes('<li>— (partie finie par abandon pendant mon tour)</li>'), 'timeline: deaths stand out, passives muted');
  check(count(d, BASIS) === 1 && d.includes('Tous les tours : <span class="cert forced"'), 'timeline: a basis shared by all turns is shown once');
  check(d.includes("Tu jouais en premier") && d.indexOf('class="half me"') < d.indexOf('class="half opp"'), 'timeline: first player first');
  check(d.indexOf('<h2>Leçons</h2>') < d.indexOf('<h2>Boutique</h2>') && d.indexOf('<h2>Boutique</h2>') < d.indexOf('<h2>Déroulé</h2>') && d.indexOf('<h2>Erreurs</h2>') < d.indexOf('<h2>Leçons</h2>'), 'analysis first, then shop, then turn by turn');
  check(d.includes('Replay du jeu · envoi bbfb1ca · replay entier décodé') && !d.includes('Captures</h2>'), 'detail names the replay source');

  // Second player; bans written before bans.none existed.
  const d2 = open('2026-10-09-1546-7144');
  check(d2.includes("L'adversaire jouait en premier") && d2.indexOf('class="half opp"') < d2.indexOf('class="half me"'), 'timeline: the opponent first when I was second');
  check(d2.includes('<b>Bans du shop</b> · moi : <span class="muted">?</span>') && d2.includes('constat : Aucun ban dans cette partie'), 'bans without none still shown');
  check(d2.includes('<b>Adversaire</b> : 0 achat, 1 passe, 0 relance · 0 Spamtons dépensés</li>') && d2.includes('Sans relance') && !d2.includes('<b>Moi</b> : '), 'one-sided shop: totals only for the side that shopped');

  // Older matches still display.
  const d3 = open('2026-10-09-1800-x');
  check(d3.includes('src="/_blob/a0"') && d3.includes('Analyse de captures · 1 capture · tours 1'), 'screenshot analysis: screens and source');
  check(d3.includes('Berserk <span class="rar R">R</span>') && d3.includes('>Multiplicateur</span>'), 'old bans: family ids shown by name, rarity apart');
  check(/Achète <span class="tox" title="Berserk[^"]*">Berserk<\/span> sur <span class="cc"/.test(d3) && !d3.includes('<details class="offers">'), 'old shop row without price nor offers');
  check(d3.includes('class="turn inferred"') && d3.includes('Les tours en italique sont déduits') && d3.includes('<span class="basis">capture 1</span>') && d3.includes('<span class="cert likely"'), 'old timeline: inferred turns, certainty per turn');
  check(d3.includes('<h2>Trous comblés</h2>') && d3.includes('Ciblage'), 'old gaps and mistakes');
  const d4 = open('2026-10-08-2000-pimp');
  check(d4.includes('Import « 2026-10-09T18-24-00-123Z » · 2 captures') && d4.includes('src="/_blob/copie1"') && d4.includes('src="/_blob/b2"'), 'Pont import: name, screens as asset id or URL');
  check(/Bans du shop/.test(d4) && /ses 4 cartes étaient visibles/.test(d4) && /à chaque boutique/.test(d4), 'ban details shown without banned Tox');
  const d5 = open('2026-10-07-2100-mabc');
  check(d5.includes('Saisie manuelle · réf. 2026-10-07-2100-mabc') && d5.includes('Partie saisie à la main.') && !d5.includes('<h2>Déroulé</h2>'), 'manual entry: source and note');

  // Méta and Mon jeu.
  tabs[2].fire('click', {});
  const meta = $('view-meta').innerHTML;
  check(/Multiplicateur/.test(meta) && meta.includes('Aucun ban dans 1 partie sur 5.'), 'meta shows the archetype ban, observed bans and matches without ban');
  tabs[3].fire('click', {});
  check($('view-jeu').innerHTML.includes('Catixy est la menace de ce deck.'), 'Mon jeu lists the lessons of the replays');

  // Zoom on a screenshot, then delete a match.
  click({ closest: sel => (sel === '[data-zoom]' ? { dataset: { zoom: '/_blob/a0' } } : null) });
  check(appended.some(el => el.className === 'lightbox' && el.innerHTML.includes('src="/_blob/a0"')), 'a screenshot opens full size');
  open('2026-10-09-1304-6862');
  $('m-detail').fire('click', { target: { closest: sel => (sel === '[data-del]' ? { dataset: { del: '2026-10-09-1304-6862' } } : null) } });
  check($('m-detail').innerHTML.includes('Supprimer cette partie du journal ?'), 'delete asks for confirmation');
  $('m-detail').fire('click', { target: { closest: sel => (sel === '[data-del-yes]' ? { dataset: { delYes: '2026-10-09-1304-6862' } } : null) } });
  await tick(10);
  check(deleted.includes('matches/2026-10-09-1304-6862'), 'delete removes the match');

  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('SMOKE OK — 5 views, 5 matches (2 from replays, 3 older), zoom, delete');
})();
