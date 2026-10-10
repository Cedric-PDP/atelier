// Cloudflare Pages Functions middleware of the SPAM site (branch pc-perso, folder interface/): every request, pages
// and files alike, goes through it (functions/_middleware.js at the root covers the static files; _routes.json
// includes "/*"). The site is reserved for ONE GitHub account, checked by its numeric id.
//
// Closed by default: if a variable is missing or invalid, every request gets 503 « site pas encore configuré ».
// Any unexpected error gives 500, never the page (no passThroughOnException).
//
// Variables (Cloudflare > Workers & Pages > the project > Settings > Variables and Secrets):
//   GITHUB_CLIENT_ID      the GitHub OAuth App's Client ID
//   GITHUB_CLIENT_SECRET  its client secret (type Secret)
//   SESSION_SECRET        32 characters or more, random (type Secret); changing it signs everyone out
//   ALLOWED_GITHUB_ID     numeric id of the only account let in
//
// Routes: /auth/connexion (sign-in page), /auth/login (→ GitHub), /auth/callback (← GitHub), /auth/logout.
// Sign-in: OAuth web flow without scope (only the public profile is read), `state` kept in a short signed cookie,
// the GitHub token is used once to read the user id and never stored. Session: cookie signed with HMAC-SHA256,
// "v1.<id>.<expiry>.<signature>", 30 days, HttpOnly, Secure, SameSite=Lax, host-only (__Host- prefix).
// Source and tests on branch main: scripts/hub/site/functions/_middleware.js, scripts/hub/test_middleware.js
// (copied here by scripts/hub/build_site.js: edit it there).

const SESSION_COOKIE = '__Host-spam_session';
const STATE_COOKIE = '__Host-spam_state';
const SESSION_SECONDS = 30 * 24 * 3600;
const STATE_SECONDS = 600;
const UA = 'spam-site-auth';
const VARS = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET', 'ALLOWED_GITHUB_ID'];
const enc = new TextEncoder();

export async function onRequest(context) {
  try {
    return await handle(context);
  } catch (e) {
    return page(500, 'Erreur', '<p>Une erreur est survenue. Recharge la page dans un moment.</p>');
  }
}

async function handle(context) {
  const { request, env } = context;
  const cfg = config(env);
  if (!cfg.ok) {
    const what = cfg.problems.map(p => `<li><code>${esc(p)}</code></li>`).join('');
    return page(503, 'Site pas encore configuré',
      `<p>Ce site est privé. Il reste à poser ses réglages dans Cloudflare Pages :</p><ul>${what}</ul><p class="muted">Voir SITE.md, sur la branche pc-perso du dépôt.</p>`);
  }
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === '/auth/connexion') return signInPage(request, url, cfg);
  if (path === '/auth/login') return startLogin(url, cfg);
  if (path === '/auth/callback') return callback(request, url, cfg);
  if (path === '/auth/logout') return redirect('/auth/connexion?out=1', [cookie(SESSION_COOKIE, '', 0)]);

  if (!(await sessionUser(request, cfg))) {
    if (request.method === 'GET' || request.method === 'HEAD') return redirect('/auth/connexion?next=' + encodeURIComponent(path + url.search));
    return page(401, 'Connexion nécessaire', '<p>Connecte-toi d\'abord.</p>');
  }
  const res = await context.next();
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'private, no-cache');
  secure(out.headers);
  return out;
}

function config(env) {
  const e = env || {};
  const problems = VARS.filter(k => typeof e[k] !== 'string' || !e[k].trim());
  if (!problems.includes('SESSION_SECRET') && e.SESSION_SECRET.length < 32) problems.push('SESSION_SECRET : 32 caractères au moins');
  if (!problems.includes('ALLOWED_GITHUB_ID') && !/^\d+$/.test(e.ALLOWED_GITHUB_ID.trim())) problems.push('ALLOWED_GITHUB_ID : un nombre');
  if (problems.length) return { ok: false, problems };
  return { ok: true, clientId: e.GITHUB_CLIENT_ID.trim(), clientSecret: e.GITHUB_CLIENT_SECRET.trim(), secret: e.SESSION_SECRET, allowed: e.ALLOWED_GITHUB_ID.trim() };
}

/* ---------- Sign-in ---------- */

async function signInPage(request, url, cfg) {
  const next = safeNext(url.searchParams.get('next'));
  if (await sessionUser(request, cfg)) return redirect(next);
  const out = url.searchParams.get('out') === '1';
  return page(200, 'Connexion', `${out ? '<p class="ok">Tu es déconnecté.</p>' : ''}
<p>Ce site est privé : il est réservé à ton compte GitHub.</p>
<p><a class="btn" href="/auth/login?next=${esc(encodeURIComponent(next))}">Se connecter avec GitHub</a></p>
<p class="muted">GitHub te demande d'autoriser l'application la première fois. Elle ne lit que ton profil public.</p>`);
}

async function startLogin(url, cfg) {
  const state = hex(crypto.getRandomValues(new Uint8Array(16)));
  const next = safeNext(url.searchParams.get('next'));
  const value = `${state}.${b64urlText(next)}.${now() + STATE_SECONDS}`;
  const gh = new URL('https://github.com/login/oauth/authorize');
  gh.searchParams.set('client_id', cfg.clientId);
  gh.searchParams.set('redirect_uri', url.origin + '/auth/callback');
  gh.searchParams.set('state', state);
  gh.searchParams.set('allow_signup', 'false');
  return redirect(gh.toString(), [cookie(STATE_COOKIE, `${value}.${await sign(cfg.secret, 'state.' + value)}`, STATE_SECONDS)]);
}

async function callback(request, url, cfg) {
  const clear = cookie(STATE_COOKIE, '', 0);
  const retry = '<p><a class="btn" href="/auth/connexion">Réessayer</a></p>';
  const q = url.searchParams;
  const st = await readState(request, cfg);
  if (q.get('error')) return page(400, 'Connexion annulée', '<p>GitHub n\'a pas confirmé la connexion.</p>' + retry, [clear]);
  const code = q.get('code'), state = q.get('state');
  if (!st || !code || !state || !safeEqual(state, st.state)) {
    return page(400, 'Connexion refusée', '<p>Cette connexion a expiré ou n\'a pas été lancée depuis ce site.</p>' + retry, [clear]);
  }
  const tr = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: url.origin + '/auth/callback' })
  });
  const tj = tr.ok ? await tr.json().catch(() => null) : null;
  const token = tj && typeof tj.access_token === 'string' && tj.access_token ? tj.access_token : null;
  if (!token) return page(502, 'Connexion impossible', '<p>GitHub n\'a pas validé la connexion.</p>' + retry, [clear]);
  const ur = await fetch('https://api.github.com/user', {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': UA, 'X-GitHub-Api-Version': '2022-11-28' }
  });
  const user = ur.ok ? await ur.json().catch(() => null) : null;
  if (!user || !Number.isSafeInteger(user.id)) return page(502, 'Connexion impossible', '<p>GitHub n\'a pas donné ton profil.</p>' + retry, [clear]);
  if (String(user.id) !== cfg.allowed) {
    return page(403, 'Accès refusé', '<p>Ce compte GitHub n\'a pas accès à ce site.</p><p class="muted">Si tu as plusieurs comptes GitHub, déconnecte-toi de github.com, puis reconnecte-toi ici avec le bon.</p>', [clear]);
  }
  const payload = `v1.${user.id}.${now() + SESSION_SECONDS}`;
  return redirect(st.next, [cookie(SESSION_COOKIE, `${payload}.${await sign(cfg.secret, 'session.' + payload)}`, SESSION_SECONDS), clear]);
}

/* ---------- Cookies ---------- */

async function sessionUser(request, cfg) {
  const raw = getCookie(request, SESSION_COOKIE);
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1' || !/^\d{1,20}$/.test(parts[1]) || !/^\d{1,12}$/.test(parts[2])) return null;
  const payload = parts.slice(0, 3).join('.');
  if (!safeEqual(parts[3], await sign(cfg.secret, 'session.' + payload))) return null;
  if (Number(parts[2]) <= now()) return null;
  if (parts[1] !== cfg.allowed) return null;
  return parts[1];
}

async function readState(request, cfg) {
  const raw = getCookie(request, STATE_COOKIE);
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 4 || !/^[0-9a-f]{32}$/.test(parts[0]) || !/^\d{1,12}$/.test(parts[2])) return null;
  const value = parts.slice(0, 3).join('.');
  if (!safeEqual(parts[3], await sign(cfg.secret, 'state.' + value))) return null;
  if (Number(parts[2]) <= now()) return null;
  let next;
  try { next = safeNext(fromB64urlText(parts[1])); } catch (e) { return null; }
  return { state: parts[0], next };
}

function getCookie(request, name) {
  const h = request.headers.get('Cookie') || '';
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

/* ---------- Crypto ---------- */

const now = () => Math.floor(Date.now() / 1000);

async function sign(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text))));
}

// Same time whatever the first differing character (the length of a signature is public).
function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const hex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = s => b64url(enc.encode(s));
const fromB64urlText = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

// Only a path of this site: "/x", never "//host" nor "/\host".
function safeNext(v) {
  v = typeof v === 'string' ? v : '';
  if (!/^\/(?![/\\])/.test(v) || /[\u0000-\u001f\\]/.test(v) || v.length > 512 || v.startsWith('/auth/')) return '/';
  return v;
}

/* ---------- Responses ---------- */

function secure(h) {
  h.set('X-Robots-Tag', 'noindex, nofollow');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'same-origin');
  h.set('X-Frame-Options', 'DENY');
}

function redirect(location, cookies = []) {
  const h = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const c of cookies) h.append('Set-Cookie', c);
  secure(h);
  return new Response(null, { status: 302, headers: h });
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(status, title, body, cookies = []) {
  const h = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  for (const c of cookies) h.append('Set-Cookie', c);
  secure(h);
  return new Response(`<!doctype html>
<html lang="fr">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · SPAM</title>
<style>
:root { --bg: #f2f3f7; --surface: #ffffff; --ink: #151826; --ink-2: #474b60; --muted: #6d7189; --line: #d9dce7; --accent: #0d7a6b; --accent-ink: #ffffff; --ok: #0a7d0a; }
@media (prefers-color-scheme: dark) { :root { --bg: #0f1118; --surface: #171a24; --ink: #eef0f7; --ink-2: #b8bccf; --muted: #8b90a8; --line: #2b3040; --accent: #2fc2ad; --accent-ink: #062521; --ok: #3fbf3f; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: var(--bg); color: var(--ink); font: 15px/1.55 "Atkinson Hyperlegible", "Segoe UI", system-ui, sans-serif; }
main { width: 100%; max-width: 440px; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 22px 22px 18px; }
h1 { margin: 0 0 12px; font: 600 1.3rem/1.25 "Chakra Petch", "Bahnschrift", "Segoe UI", system-ui, sans-serif; }
h1 b { color: var(--accent); }
p { margin: 0 0 12px; } ul { margin: 0 0 12px; padding-left: 20px; }
code { font-family: Consolas, ui-monospace, monospace; font-size: .9em; }
.muted { color: var(--muted); font-size: .88rem; } .ok { color: var(--ok); font-weight: 700; }
.btn { display: inline-block; background: var(--accent); color: var(--accent-ink); font-weight: 700; text-decoration: none; padding: 10px 16px; border-radius: 6px; }
.btn:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
</style>
<main><h1>Mon <b>SPAM</b> · ${esc(title)}</h1>
${body}
</main>
`, { status, headers: h });
}
