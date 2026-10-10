// Shared pieces of the personal-PC site (`.pc-perso/interface/`, served by Cloudflare Pages behind
// functions/_middleware.js): the page list, the navigation bar injected into every page, the document skeleton and
// the style of the hub pages (same tokens as the Atelier and the Journal, light and dark, no external file).
// Used by scripts/app/build_standalone.js (Atelier), build_journal_static.js and build_site.js.

const PAGES = [
  { file: 'index.html', label: 'Accueil' },
  { file: 'atelier-spam.html', label: 'Atelier' },
  { file: 'journal-spam.html', label: 'Journal' },
  { file: 'nouvelles.html', label: 'Nouvelles' },
  { file: 'envoyer.html', label: 'Envoyer' }
];
// Served by the middleware, not a file of the site.
const LOGOUT = '/auth/logout';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The pages published on claude.ai have no skeleton (the publisher adds one); the site serves them as files, so they
// get one here: without it a browser renders in quirks mode, and a phone lays the page out 980 px wide.
const SKELETON = '<!doctype html>\n<html lang="fr">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex, nofollow">\n';

// Only page tokens shared by the Atelier and the Journal (--bg, --surface, --ink-2, --line, --accent, --accent-soft,
// --font-display), with fallbacks.
const NAV_CSS = `.hubnav { margin: 0 -16px; padding: 6px 16px; background: var(--surface, #fff); border-bottom: 1px solid var(--line, #d9dce7); }
.hubnav-in { max-width: 1280px; margin: 0 auto; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; }
.hubnav a { padding: 5px 10px; border-radius: 6px; font-family: var(--font-display, system-ui, sans-serif); font-weight: 600; font-size: .92rem; line-height: 1.3; color: var(--ink-2, #474b60); text-decoration: none; white-space: nowrap; }
.hubnav a:hover { color: var(--ink, #151826); background: var(--surface-2, #e9ebf2); }
.hubnav a[aria-current="page"] { color: var(--accent, #0d7a6b); background: var(--accent-soft, #d6efea); }
.hubnav .hubnav-brand { color: var(--ink, #151826); letter-spacing: .04em; padding-left: 0; margin-right: 6px; }
.hubnav .hubnav-brand b { color: var(--accent, #0d7a6b); }
.hubnav .hubnav-out { margin-left: auto; font-family: inherit; font-weight: 400; font-size: .85rem; color: var(--muted, #74788f); }
@media (max-width: 520px) { .hubnav .hubnav-brand { display: none; } .hubnav a { padding: 5px 8px; } }
@media print { .hubnav { display: none; } }`;

function navHtml(active) {
  if (!PAGES.some(p => p.file === active)) throw new Error('nav: unknown page ' + active);
  const links = PAGES.map(p => `<a href="${p.file}"${p.file === active ? ' aria-current="page"' : ''}>${esc(p.label)}</a>`).join('');
  return `<!--hubnav--><style id="hubnav-css">\n${NAV_CSS}\n</style>
<nav class="hubnav" aria-label="Site SPAM"><div class="hubnav-in"><a class="hubnav-brand" href="index.html">Mon <b>SPAM</b></a>${links}<a class="hubnav-out" href="${LOGOUT}">Se déconnecter</a></div></nav><!--/hubnav-->\n`;
}

// Adds the skeleton (if missing) and the navigation bar right before `anchor` (the page's own header), exactly once.
// Idempotent: a previous bar is removed first.
function injectNav(html, active, anchor = '<header class="top">') {
  html = html.replace(/<!--hubnav-->[\s\S]*?<!--\/hubnav-->\n?/g, '');
  const n = html.split(anchor).length - 1;
  if (n !== 1) throw new Error(`nav: expected exactly one "${anchor}" in ${active}, found ${n}`);
  html = html.replace(anchor, () => navHtml(active) + anchor);
  if (!/^\s*<!doctype html>/i.test(html)) html = SKELETON + html;
  return html;
}

// Tokens of the Atelier (site/atelier-spam.html), light and dark; fonts by name only (nothing is downloaded).
const TOKENS = `:root {
  --bg: #f2f3f7; --surface: #ffffff; --surface-2: #e9ebf2; --ink: #151826; --ink-2: #474b60; --muted: #6d7189; --line: #d9dce7;
  --accent: #0d7a6b; --accent-ink: #ffffff; --accent-soft: #d6efea; --good: #0a7d0a; --warn: #9a6400; --bad: #c22f2f;
  --warn-soft: #fff1d6; --bad-soft: #fbe3e3; --good-soft: #e0f3e0;
  --font-display: "Chakra Petch", "Bahnschrift", "Segoe UI", system-ui, sans-serif;
  --font-body: "Atkinson Hyperlegible", "Segoe UI", system-ui, -apple-system, sans-serif;
  --r: 10px; --r-s: 6px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0f1118; --surface: #171a24; --surface-2: #20242f; --ink: #eef0f7; --ink-2: #b8bccf; --muted: #8b90a8; --line: #2b3040;
    --accent: #2fc2ad; --accent-ink: #062521; --accent-soft: #123a35; --good: #3fbf3f; --warn: #f0b429; --bad: #f07070;
    --warn-soft: #3a2e12; --bad-soft: #3a1c1c; --good-soft: #15301a;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0f1118; --surface: #171a24; --surface-2: #20242f; --ink: #eef0f7; --ink-2: #b8bccf; --muted: #8b90a8; --line: #2b3040;
  --accent: #2fc2ad; --accent-ink: #062521; --accent-soft: #123a35; --good: #3fbf3f; --warn: #f0b429; --bad: #f07070;
  --warn-soft: #3a2e12; --bad-soft: #3a1c1c; --good-soft: #15301a;
  color-scheme: dark;
}`;

// Style of the hub pages (Accueil, Nouvelles, Envoyer): the Atelier's base rules, plus prose and cards.
const HUB_CSS = `${TOKENS}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--font-body); font-size: 15px; line-height: 1.55; padding: 0 16px 48px; overflow-wrap: break-word; }
h1, h2, h3, h4 { font-family: var(--font-display); font-weight: 600; line-height: 1.25; margin: 0; text-wrap: balance; }
h1 { font-size: 1.35rem; letter-spacing: .02em; }
h1 b { color: var(--accent); font-weight: 700; }
h2 { font-size: 1.15rem; letter-spacing: .01em; }
h3 { font-size: 1rem; }
p { margin: 0; }
a { color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
code { font-family: Consolas, "Cascadia Mono", ui-monospace, monospace; font-size: .88em; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; overflow-wrap: anywhere; }
.wrap { max-width: 860px; margin: 0 auto; }
.top { border-bottom: 1px solid var(--line); margin: 0 -16px 20px; padding: 16px; }
.top .wrap { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 16px; }
.muted { color: var(--muted); }
.small { font-size: .85rem; }
.stack { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 16px 18px; min-width: 0; }
.panel > h2 { margin-bottom: 10px; }
.note { border-left: 3px solid var(--accent); background: var(--accent-soft); padding: 10px 14px; border-radius: var(--r-s); }
.note.warn { border-color: var(--warn); background: var(--warn-soft); }
.btn { display: inline-block; border: 1px solid var(--line); background: var(--surface); color: var(--ink); padding: 8px 14px; border-radius: var(--r-s); font: inherit; font-size: .92rem; line-height: 1.2; text-decoration: none; cursor: pointer; }
.btn:hover { border-color: var(--muted); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 700; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 12px; }
.card { display: flex; flex-direction: column; gap: 6px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 14px 16px; color: inherit; text-decoration: none; min-width: 0; }
.card:hover { border-color: var(--accent); }
.card h3 { color: var(--accent); font-size: 1.05rem; }
.card .facts { color: var(--muted); font-size: .85rem; margin-top: auto; }
.prose > * + * { margin-top: 10px; }
.prose h2 { margin-top: 26px; padding-top: 14px; border-top: 1px solid var(--line); }
.prose h2:first-child, .prose .lead + h2 { margin-top: 0; padding-top: 0; border-top: 0; }
.prose .lead { color: var(--muted); font-size: .85rem; }
.prose h3 { margin-top: 18px; }
.prose ul, .prose ol { margin: 8px 0 0; padding-left: 22px; }
.prose li + li { margin-top: 5px; }
.prose li > ul, .prose li > ol { margin-top: 5px; }
.prose blockquote { margin: 10px 0 0; padding: 4px 14px; border-left: 3px solid var(--line); color: var(--ink-2); }
.prose hr { border: 0; border-top: 1px solid var(--line); margin: 20px 0; }
.scroll-x { overflow-x: auto; max-width: 100%; }
.prose table { border-collapse: collapse; font-size: .92rem; margin-top: 10px; }
.prose th, .prose td { border-bottom: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
.prose th { font-family: var(--font-display); font-weight: 600; color: var(--ink-2); }
.steps { margin: 0; padding-left: 22px; }
.steps > li + li { margin-top: 12px; }
.copy-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 6px; }
.copy-row code { font-size: .95em; padding: 6px 9px; }
footer.foot { max-width: 860px; margin: 28px auto 0; color: var(--muted); font-size: .85rem; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }`;

// A complete hub page: skeleton, title, style, navigation bar, header, main content, footer.
function hubPage({ file, title, h1, sub, main, foot, script }) {
  return `${SKELETON}<title>${esc(title)}</title>
<style>
${HUB_CSS}
</style>
${navHtml(file)}<header class="top"><div class="wrap"><h1>${h1}</h1>${sub ? `<span class="muted small">${sub}</span>` : ''}</div></header>
<main class="wrap">
${main}
</main>
${foot ? `<footer class="foot">${foot}</footer>\n` : ''}${script ? `<script>\n${script}\n</script>\n` : ''}`;
}

module.exports = { PAGES, LOGOUT, SKELETON, esc, navHtml, injectNav, hubPage };
