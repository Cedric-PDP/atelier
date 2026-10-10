// Builds the whole personal-PC site into .pc-perso/interface/ (branch pc-perso, served by Cloudflare Pages behind
// functions/_middleware.js; installation guide: SITE.md of that branch). Same navigation bar on every page:
//   index.html         Accueil: the latest news (REPONSE.md), then the other pages
//   atelier-spam.html  the offline Atelier (scripts/app/build_standalone.js, from site/ and spam/decks.json)
//   journal-spam.html  the Journal, read-only, from a snapshot of its base (build_journal_static.js)
//   nouvelles.html     REPONSE.md (branch pc-perso) rendered (markdown.js)
//   envoyer.html       how to send the replays
//   functions/_middleware.js, _routes.json   copied from scripts/hub/site/ (edit them there)
// Then it checks the site (navigation bar on every page, internal links and anchors, no match ticket nor token) and
// runs the smoke tests (Atelier, Journal, middleware). Exit 1 if anything fails: then do not push.
//
// Usage: node scripts/hub/build_site.js [<journal snapshot dir>] [--out <dir>] [--reponse <REPONSE.md>] [--no-smoke]
//   <journal snapshot dir>: three ArtifactData reads of https://claude.ai/artifact/WSVR5uVuFT9SMAa9WSaqpL, action
//   "list", collections matches, knowledge and archetypes, query {limit: 1000}, same out_dir. Without it, the
//   snapshot embedded in the current <out>/journal-spam.html is kept (the page itself is rebuilt).
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const { PAGES, esc, hubPage } = require('./nav.js');
const md = require('./markdown.js');
const journal = require('./build_journal_static.js');
const root = path.join(__dirname, '..', '..');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const out = path.resolve(opt('--out', path.join(root, '.pc-perso', 'interface')));
const reponseFile = path.resolve(opt('--reponse', path.join(root, '.pc-perso', 'REPONSE.md')));
const smoke = !args.includes('--no-smoke'); if (!smoke) args.splice(args.indexOf('--no-smoke'), 1);
if (args.length > 1 || args.some(a => a.startsWith('--'))) { console.error('usage: node scripts/hub/build_site.js [<journal snapshot dir>] [--out <dir>] [--reponse <REPONSE.md>] [--no-smoke]'); process.exit(1); }
const snapDir = args[0] ? path.resolve(args[0]) : null;

const UPLOAD = 'https://github.com/Cedric-PDP/spam-atelier/upload/pc-perso';
const NEWFILE = 'https://github.com/Cedric-PDP/spam-atelier/new/pc-perso';
const GAME_DIR = '%USERPROFILE%\\AppData\\LocalLow\\Ticroco\\Spam';
const fmtWhen = journal.fmtWhen;
const fmtDay = d => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long' }).format(d);
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
const log = s => console.log(s);

fs.mkdirSync(out, { recursive: true });

/* ---------- Atelier ---------- */
log('Atelier…');
log('  ' + execFileSync(process.execPath, [path.join(root, 'scripts', 'app', 'build_standalone.js'), path.join(out, 'atelier-spam.html')], { encoding: 'utf8' }).trim());
const data = JSON.parse(fs.readFileSync(path.join(root, 'site', 'data.json'), 'utf8'));
const savedDecks = JSON.parse(fs.readFileSync(path.join(root, 'spam', 'decks.json'), 'utf8')).decks || [];

/* ---------- Journal ---------- */
log('Journal…');
let snap, dropped = 0;
if (snapDir) ({ snap, dropped } = journal.readSnapshot(snapDir));
else {
  const prev = path.join(out, 'journal-spam.html');
  if (!fs.existsSync(prev)) { console.error(`no snapshot given and no ${prev} to reuse: give the snapshot dir`); process.exit(1); }
  snap = journal.readEmbedded(prev);
  log('  (instantané repris de la page actuelle)');
}
const j = journal.build(snap, path.join(out, 'journal-spam.html'));
log(`  journal-spam.html: ${j.n} parties, ${j.k} fiches, ${j.a} archétypes, instantané du ${j.when}${dropped ? `, ${dropped} captures non reprises` : ''}`);

/* ---------- Nouvelles (REPONSE.md) ---------- */
log('Nouvelles…');
const blocks = md.parse(fs.readFileSync(reponseFile, 'utf8'));
const body = blocks[0] && blocks[0].type === 'h' && blocks[0].level === 1 ? blocks.slice(1) : blocks;
// "*Mis à jour le 9 octobre 2026, 20 h.*" at the top: the date of the news.
const dateBlock = body[0] && body[0].type === 'p' && /^\*?_?mis à jour/i.test(md.plain(body[0].text)) ? body[0] : null;
const newsDate = dateBlock ? md.plain(dateBlock.text).replace(/^mis à jour le\s*/i, '').replace(/\.$/, '') : null;
const rest = dateBlock ? body.slice(1) : body;
const sections = []; let cur = { h: null, blocks: [] };
for (const b of rest) { if (b.type === 'h' && b.level === 2) { if (cur.h || cur.blocks.length) sections.push(cur); cur = { h: b, blocks: [] }; } else cur.blocks.push(b); }
if (cur.h || cur.blocks.length) sections.push(cur);
const built = fmtWhen(new Date());
// Keeps a hub page as it is when only its build date would change, so a rebuild leaves no noise in git.
const writePage = (file, html) => {
  const undated = t => t.replace(/\r\n/g, '\n').replace(/(construite le |mis à jour le )[^<.]+/g, '$1');
  try { if (undated(fs.readFileSync(file, 'utf8')) === undated(html)) return; } catch (e) {}
  fs.writeFileSync(file, html);
};
writePage(path.join(out, 'nouvelles.html'), hubPage({
  file: 'nouvelles.html', title: 'Nouvelles · SPAM', h1: 'Les <b>nouvelles</b> de Claude',
  sub: newsDate ? `Mises à jour le ${esc(newsDate)}` : '',
  main: `<article class="panel prose">\n${md.render(rest)}\n</article>`,
  foot: `Claude écrit ces nouvelles après chaque envoi (fichier <code>REPONSE.md</code> de la branche pc-perso). Page construite le ${esc(built)}.`
}));

/* ---------- Envoyer ---------- */
log('Envoyer…');
writePage(path.join(out, 'envoyer.html'), hubPage({
  file: 'envoyer.html', title: 'Envoyer tes parties · SPAM', h1: 'Envoyer tes <b>parties</b>',
  sub: 'Après chaque session de jeu',
  main: `<div class="stack">
<p>Le jeu enregistre un replay de chaque partie, et Claude y lit tout : decks, tours, boutique, bans. Envoie le dossier des replays après chaque session de jeu : on ne sait pas combien de replays le jeu garde.</p>
<section class="panel">
<ol class="steps">
<li><b>Ouvre le dossier du jeu.</b> Dans l'Explorateur de fichiers, colle ce chemin dans la barre d'adresse, puis Entrée :
<div class="copy-row"><code id="game-dir">${esc(GAME_DIR)}</code><button class="btn" type="button" data-copy="game-dir">Copier</button><span class="muted small" id="copy-ok" aria-live="polite"></span></div></li>
<li><b>Compresse le dossier <code>replays</code>.</b> Clic droit dessus, puis <b>Compresser en fichier ZIP</b> (selon la version de Windows : <b>Compresser vers</b>, puis <b>Fichier ZIP</b>).</li>
<li><b>Dépose le zip sur GitHub.</b> <a class="btn primary" href="${UPLOAD}" target="_blank" rel="noopener">Ouvrir la page d'envoi</a><br>
<span class="muted small">Elle s'ouvre sur la branche pc-perso. Connecte-toi à GitHub si on te le demande, puis glisse le zip dans la page (25 Mo au plus).</span></li>
<li><b>Écris ton message à Claude.</b> En bas, dans « Commit changes », la grande case de description (<i>Add an optional extended description</i>) est ton message : ce que tu as joué, ce que tu cherches, tes questions. Claude le lit.</li>
<li><b>Valide.</b> Laisse coché <i>Commit directly to the pc-perso branch</i>, puis clique sur <b>Commit changes</b>.</li>
<li><b>Préviens Claude.</b> Sur l'autre PC, dis-lui : « j'ai envoyé un import ». Sa réponse arrivera dans les <a href="nouvelles.html">Nouvelles</a>, et tes parties dans le <a href="journal-spam.html">Journal</a>.</li>
</ol>
</section>
<section class="panel">
<h2>Juste un message, sans fichier</h2>
<p><a class="btn" href="${NEWFILE}" target="_blank" rel="noopener">Écrire un message sur GitHub</a></p>
<p class="muted small" style="margin-top:8px">Nomme le fichier par exemple <code>message.md</code>, écris ton message, puis <b>Commit changes</b>.</p>
</section>
<p class="note warn">N'envoie rien d'autre de Steam ni de Windows : seul le dossier <code>replays</code> sert.</p>
</div>`,
  foot: `Page construite le ${esc(built)}.`,
  script: `document.addEventListener('click', e => {
  const b = e.target.closest('[data-copy]'); if (!b) return;
  const t = document.getElementById(b.dataset.copy).textContent, ok = document.getElementById('copy-ok');
  const done = () => { ok.textContent = 'Copié'; setTimeout(() => { ok.textContent = ''; }, 2000); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => { ok.textContent = 'Sélectionne le chemin et copie-le (Ctrl+C)'; });
  else ok.textContent = 'Sélectionne le chemin et copie-le (Ctrl+C)';
});`
}));

/* ---------- Accueil ---------- */
log('Accueil…');
const ms = snap.matches || [];
const count = r => ms.filter(m => m.result === r).length;
const lastMatch = ms.filter(m => m.date).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
const journalFacts = ms.length
  ? `${plural(ms.length, 'partie')} · ${plural(count('V'), 'victoire')}, ${plural(count('D'), 'défaite')}${count('N') ? `, ${plural(count('N'), 'nul')}` : ''}${lastMatch ? ` · dernière le ${esc(fmtWhen(new Date(lastMatch.date)))}${lastMatch.opp && lastMatch.opp.name ? ` contre ${esc(lastMatch.opp.name)}` : ''}` : ''}`
  : 'Aucune partie pour l\'instant';
const first = sections.find(s => s.h) || sections[0];
const others = sections.filter(s => s.h && s !== first);
const latest = first ? `${first.h ? `<h2 id="${esc(first.h.id)}">${md.inline(first.h.text)}</h2>\n` : ''}${md.render(first.blocks)}` : '<p class="muted">Pas encore de nouvelles.</p>';
const card = (href, title, text, facts) => `<a class="card" href="${href}"><h3>${title}</h3><p>${text}</p><p class="facts">${facts}</p></a>`;
writePage(path.join(out, 'index.html'), hubPage({
  file: 'index.html', title: 'Mon SPAM', h1: 'Mon <b>SPAM</b>',
  sub: `Site mis à jour le ${esc(built)}`,
  main: `<div class="stack">
<section class="panel prose" aria-labelledby="latest-title">
<p class="lead" id="latest-title">Dernières nouvelles${newsDate ? ` · ${esc(newsDate)}` : ''}</p>
${latest}
${others.length ? `<p class="muted small">Aussi dans les nouvelles : ${others.map(s => `<a href="nouvelles.html#${esc(s.h.id)}">${esc(md.plain(s.h.text))}</a>`).join(' · ')}</p>` : ''}
<p><a class="btn primary" href="nouvelles.html">Lire toutes les nouvelles</a></p>
</section>
<div class="cards">
${card('atelier-spam.html', 'Atelier de decks', 'Construis et compare tes decks : score du modèle, plan de jeu, boutique, résistance sans critiques ou sans sa carte clé.', `Jeu v${esc(data.meta.game)} · ${plural(data.meta.nOwn || 0, 'carte')} possédées · tes decks restent dans ce navigateur`)}
${card('journal-spam.html', 'Journal de parties', 'Tes parties lues dans les replays : déroulé tour par tour, boutique, erreurs, leçons, méta adverse.', `${journalFacts} · copie du ${esc(fmtDay(new Date(snap.takenAt)))}`)}
${card('nouvelles.html', 'Nouvelles', 'Les messages de Claude après chaque envoi : ce qu\'il a vu dans tes parties et ce qu\'il attend de toi.', newsDate ? `Mises à jour le ${esc(newsDate)}` : 'REPONSE.md')}
${card('envoyer.html', 'Envoyer tes parties', 'Compresser le dossier des replays et le déposer sur GitHub, avec un mot pour Claude.', 'Après chaque session de jeu')}
</div>
</div>`,
  foot: `Site privé, réservé à ton compte GitHub · <a href="/auth/logout">Se déconnecter</a> · ${plural(savedDecks.length, 'deck')} enregistrés au départ dans l'Atelier`
}));

/* ---------- Middleware ---------- */
fs.mkdirSync(path.join(out, 'functions'), { recursive: true });
fs.copyFileSync(path.join(__dirname, 'site', 'functions', '_middleware.js'), path.join(out, 'functions', '_middleware.js'));
fs.copyFileSync(path.join(__dirname, 'site', '_routes.json'), path.join(out, '_routes.json'));
const routes = JSON.parse(fs.readFileSync(path.join(out, '_routes.json'), 'utf8'));
if (JSON.stringify(routes.include) !== '["/*"]' || (routes.exclude || []).length) throw new Error('_routes.json must include "/*" and exclude nothing');

/* ---------- Checks ---------- */
log('Contrôles…');
const problems = [];
const known = new Set([...PAGES.map(p => p.file), 'functions', '_routes.json']);
for (const f of fs.readdirSync(out)) if (!known.has(f)) problems.push(`unexpected file in the site: ${f}`);
const pages = Object.fromEntries(PAGES.map(p => [p.file, fs.readFileSync(path.join(out, p.file), 'utf8')]));
const ids = h => new Set([...h.matchAll(/\sid="([^"$]+)"/g)].map(m => m[1]));
let links = 0;
for (const [file, html] of Object.entries(pages)) {
  if (!/^<!doctype html>/i.test(html)) problems.push(`${file}: no doctype`);
  const navs = html.match(/<nav class="hubnav"[\s\S]*?<\/nav>/g) || [];
  if (navs.length !== 1) problems.push(`${file}: ${navs.length} navigation bars`);
  else {
    for (const p of PAGES) if (!navs[0].includes(`href="${p.file}"`)) problems.push(`${file}: navigation bar without ${p.file}`);
    if (!navs[0].includes(`href="${file}" aria-current="page"`)) problems.push(`${file}: not marked as the current page`);
    if (!navs[0].includes('href="/auth/logout"')) problems.push(`${file}: no sign-out link`);
  }
  for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
    const u = m[1];
    if (u.includes('${') || /^(https?:|mailto:|data:|blob:|javascript:)/i.test(u) || u === '') continue;
    links++;
    if (u === '/auth/logout' || u.startsWith('/auth/login') || u.startsWith('/auth/connexion')) continue;
    const [p, hash] = u.split('#');
    const target = p === '' ? file : p;
    if (!pages[target]) { problems.push(`${file}: broken link ${u}`); continue; }
    if (hash && !ids(pages[target]).has(hash)) problems.push(`${file}: link ${u} to a missing anchor`);
  }
}
const all = fs.readdirSync(out, { recursive: true }).map(f => path.join(out, String(f))).filter(f => fs.statSync(f).isFile());
for (const f of all) {
  const s = fs.readFileSync(f, 'utf8');
  if (/"[A-Za-z_]*ticket[A-Za-z_]*"\s*:/i.test(s)) problems.push(`${path.relative(out, f)}: a "ticket" field`);
  if (/\bgh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/.test(s)) problems.push(`${path.relative(out, f)}: something that looks like a GitHub token`);
}
log(`  ${Object.keys(pages).length} pages, ${links} liens internes vérifiés, ${all.length} fichiers`);

/* ---------- Smoke tests ---------- */
const run = (name, script, argv, okRe) => {
  try {
    const o = execFileSync(process.execPath, [path.join(root, script), ...argv], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
    const lastLine = o.trim().split('\n').pop();
    if (!okRe.test(lastLine)) problems.push(`${name}: ${lastLine}`); else log(`  ${name}: ${lastLine}`);
  } catch (e) { problems.push(`${name}: ${String(e.stderr || e.stdout || e.message).trim().split('\n').slice(-5).join(' | ')}`); }
};
if (smoke) {
  log('Tests…');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spam-site-smoke-'));
  fs.copyFileSync(path.join(root, 'site', 'data.json'), path.join(tmp, 'data.json'));
  run('Atelier', 'scripts/app/smoke_page.js', [path.join(out, 'atelier-spam.html'), tmp], /^NO RUNTIME ERRORS$/);
  fs.rmSync(tmp, { recursive: true, force: true });
  run('Journal', 'scripts/hub/smoke_journal_static.js', [path.join(out, 'journal-spam.html')], /^SMOKE OK/);
  run('Middleware', 'scripts/hub/test_middleware.js', [path.join(out, 'functions', '_middleware.js')], /^MIDDLEWARE OK/);
}

if (problems.length) { console.error('PROBLÈMES (ne pas pousser) :\n- ' + problems.join('\n- ')); process.exit(1); }
log(`SITE OK — ${out}`);
