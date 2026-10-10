// Tests of the site's auth middleware (scripts/hub/site/functions/_middleware.js, or the copy given as argument) in
// Node: Request, Response, Headers and crypto.subtle are the globals the Workers runtime also has; `context`
// (request, env, next) is simulated, and so is GitHub (fetch). Ends with "MIDDLEWARE OK" or exits 1.
// Usage: node scripts/hub/test_middleware.js [path/to/_middleware.js]
const fs = require('fs'), path = require('path'), nodeCrypto = require('crypto');
const file = path.resolve(process.argv[2] || path.join(__dirname, 'site', 'functions', '_middleware.js'));

const ORIGIN = 'https://spam-perso.pages.dev';
const ID = '171561900';
const ENV = { GITHUB_CLIENT_ID: 'Iv1.testclient', GITHUB_CLIENT_SECRET: 'test-client-secret', SESSION_SECRET: 'x'.repeat(20) + 'test-session-secret', ALLOWED_GITHUB_ID: ID };
const PAGE = '<!doctype html><title>page privée</title>';

let failures = 0, passes = 0;
const check = (cond, msg) => { if (cond) passes++; else { failures++; console.error('FAIL ' + msg); } };

// GitHub, simulated: the token endpoint and /user. Every call is recorded.
let gh = { token: 'gho_testtoken', user: { id: Number(ID), login: 'Cedric-PDP' }, tokenStatus: 200 };
const calls = [];
globalThis.fetch = async (u, init = {}) => {
  calls.push({ url: String(u), init });
  if (String(u) === 'https://github.com/login/oauth/access_token') {
    return new Response(JSON.stringify(gh.token ? { access_token: gh.token, token_type: 'bearer', scope: '' } : { error: 'bad_verification_code' }), { status: gh.tokenStatus, headers: { 'Content-Type': 'application/json' } });
  }
  if (String(u) === 'https://api.github.com/user') return new Response(JSON.stringify(gh.user), { status: 200, headers: { 'Content-Type': 'application/json' } });
  throw new Error('unexpected fetch ' + u);
};

let served = 0, passThrough = 0, nextThrows = false;
async function call(mw, url, { env = ENV, cookies = {}, method = 'GET' } = {}) {
  const headers = new Headers();
  const c = Object.entries(cookies).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join('; ');
  if (c) headers.set('Cookie', c);
  const request = new Request(url.startsWith('http') ? url : ORIGIN + url, { method, headers });
  const context = {
    request, env, params: {}, data: {}, waitUntil() {}, passThroughOnException() { passThrough++; },
    next: async () => { if (nextThrows) throw new Error('boom'); served++; return new Response(method === 'HEAD' ? null : PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate', ETag: '"abc"' } }); }
  };
  const res = await mw.onRequest(context);
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { res, status: res.status, loc: res.headers.get('Location'), set, body: res.body ? await res.text() : '' };
}
const setOf = (r, name) => r.set.find(s => s.startsWith(name + '='));
const valueOf = s => s ? s.split(';')[0].split('=').slice(1).join('=') : null;
const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hmac = (secret, text) => b64url(nodeCrypto.createHmac('sha256', secret).update(text).digest());
const sessionCookie = (id, exp, secret = ENV.SESSION_SECRET) => { const p = `v1.${id}.${exp}`; return `${p}.${hmac(secret, 'session.' + p)}`; };
const nowS = () => Math.floor(Date.now() / 1000);
const isSignIn = (r, next) => r.status === 302 && r.loc === '/auth/connexion?next=' + encodeURIComponent(next);

// Full sign-in: /auth/login, then GitHub sends back to /auth/callback with the state. Returns the callback result.
async function signIn(mw, next = '/') {
  const login = await call(mw, '/auth/login?next=' + encodeURIComponent(next));
  const state = new URL(login.loc).searchParams.get('state');
  const stateCookie = valueOf(setOf(login, '__Host-spam_state'));
  const cb = await call(mw, `/auth/callback?code=testcode&state=${state}`, { cookies: { '__Host-spam_state': stateCookie } });
  return { login, state, stateCookie, cb };
}

(async () => {
  const src = fs.readFileSync(file, 'utf8');
  const mw = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  check(typeof mw.onRequest === 'function', 'exports onRequest');
  check(!/passThroughOnException/.test(src.replace(/\/\/.*$/gm, '')), 'the middleware never calls passThroughOnException (fail closed)');

  // 1. Closed by default: a missing or invalid variable → 503 for every request, nothing served, no GitHub call.
  const broken = [null, {}];
  for (const k of Object.keys(ENV)) { const e = { ...ENV }; delete e[k]; broken.push(e); broken.push({ ...ENV, [k]: '  ' }); }
  broken.push({ ...ENV, SESSION_SECRET: 'too-short' }, { ...ENV, ALLOWED_GITHUB_ID: 'Cedric-PDP' });
  const good = sessionCookie(ID, nowS() + 3600);
  for (const env of broken) for (const u of ['/', '/atelier-spam.html', '/journal-spam.html?x=1', '/functions/_middleware.js', '/auth/login', '/auth/callback?code=a&state=b', '/auth/connexion', '/auth/logout']) {
    const r = await call(mw, u, { env, cookies: { '__Host-spam_session': good } });
    check(r.status === 503 && /pas encore configuré/.test(r.body) && !r.body.includes('page privée'), `503 when not configured (${JSON.stringify(env && Object.keys(env))} ${u}): got ${r.status}`);
  }
  check(served === 0 && calls.length === 0, 'nothing served nor asked to GitHub before configuration');
  const r503 = await call(mw, '/', { env: { ...ENV, GITHUB_CLIENT_SECRET: '' } });
  check(r503.body.includes('GITHUB_CLIENT_SECRET') && !r503.body.includes(ENV.SESSION_SECRET) && !r503.body.includes(ENV.GITHUB_CLIENT_ID), '503 names the missing variable, shows no value');

  // 2. No cookie → sign-in page; POST → 401; the sign-in page itself.
  let r = await call(mw, '/journal-spam.html?x=1');
  check(isSignIn(r, '/journal-spam.html?x=1') && !r.body.includes('page privée'), 'no cookie: redirect to the sign-in page');
  r = await call(mw, '/atelier-spam.html', { method: 'HEAD' });
  check(isSignIn(r, '/atelier-spam.html'), 'HEAD without cookie: redirect');
  r = await call(mw, '/', { method: 'POST' });
  check(r.status === 401 && !r.body.includes('page privée'), 'POST without cookie: 401');
  r = await call(mw, '/https://evil.example/');
  check(isSignIn(r, '/https://evil.example/'), 'any path is protected');
  r = await call(mw, 'https://3f2a9c1d.spam-perso.pages.dev/atelier-spam.html');
  check(isSignIn(r, '/atelier-spam.html'), 'a deployment URL <hash>.<project>.pages.dev goes through the same check');
  r = await call(mw, '/auth/connexion?next=%2Fjournal-spam.html');
  check(r.status === 200 && r.body.includes('href="/auth/login?next=%2Fjournal-spam.html"') && /Se connecter avec GitHub/.test(r.body), 'sign-in page links to /auth/login');
  check(r.res.headers.get('X-Robots-Tag') === 'noindex, nofollow' && r.res.headers.get('Cache-Control') === 'no-store', 'sign-in page: noindex, no-store');
  check(served === 0, 'nothing served without a session');

  // 3. /auth/login → GitHub, with client_id, redirect_uri, a random state, no scope; signed short state cookie.
  r = await call(mw, '/auth/login?next=%2Fjournal-spam.html');
  const a = new URL(r.loc || 'about:blank');
  check(r.status === 302 && a.origin + a.pathname === 'https://github.com/login/oauth/authorize', 'login redirects to GitHub');
  check(a.searchParams.get('client_id') === ENV.GITHUB_CLIENT_ID && a.searchParams.get('redirect_uri') === ORIGIN + '/auth/callback', 'client_id and redirect_uri');
  check(/^[0-9a-f]{32}$/.test(a.searchParams.get('state') || '') && !a.searchParams.has('scope'), 'random state, no scope');
  check(!r.loc.includes(ENV.GITHUB_CLIENT_SECRET), 'the client secret never leaves the server');
  const sc = setOf(r, '__Host-spam_state') || '';
  check(/; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/.test(sc) && !/Domain=/i.test(sc), 'state cookie: 10 min, HttpOnly, Secure, SameSite=Lax, host-only');
  const r2 = await call(mw, '/auth/login');
  check(new URL(r2.loc).searchParams.get('state') !== a.searchParams.get('state'), 'a new state each time');

  // 4. Callback refused without GitHub: wrong state, no state cookie, forged or expired state cookie, cancelled.
  calls.length = 0;
  const st = a.searchParams.get('state'), stc = valueOf(sc);
  const refused = async (u, cookies, msg) => {
    const x = await call(mw, u, { cookies });
    check(x.status === 400 && !setOf(x, '__Host-spam_session') && /Max-Age=0/.test(setOf(x, '__Host-spam_state') || ''), msg + `: refused (${x.status})`);
  };
  await refused(`/auth/callback?code=c&state=${'0'.repeat(32)}`, { '__Host-spam_state': stc }, 'wrong state');
  await refused(`/auth/callback?code=c&state=${st}`, {}, 'no state cookie');
  await refused(`/auth/callback?code=c`, { '__Host-spam_state': stc }, 'no state in the URL');
  await refused(`/auth/callback?state=${st}`, { '__Host-spam_state': stc }, 'no code');
  const parts = stc.split('.');
  await refused(`/auth/callback?code=c&state=${st}`, { '__Host-spam_state': [parts[0], b64url('//evil.example'), parts[2], parts[3]].join('.') }, 'state cookie with a changed next');
  await refused(`/auth/callback?code=c&state=${st}`, { '__Host-spam_state': [parts[0], parts[1], String(nowS() + 99999), parts[3]].join('.') }, 'state cookie with a changed expiry');
  const old = [parts[0], parts[1], String(nowS() - 1)].join('.');
  await refused(`/auth/callback?code=c&state=${st}`, { '__Host-spam_state': `${old}.${hmac(ENV.SESSION_SECRET, 'state.' + old)}` }, 'expired state cookie');
  const asSession = sessionCookie(ID, nowS() + 3600);
  await refused(`/auth/callback?code=c&state=${st}`, { '__Host-spam_state': asSession }, 'a session cookie is not a state');
  await refused(`/auth/callback?error=access_denied&state=${st}`, { '__Host-spam_state': stc }, 'sign-in cancelled on GitHub');
  check(calls.length === 0, 'no GitHub call when the state is wrong');

  // 5. Another GitHub account → 403, no session; GitHub refusing the code → 502.
  gh.user = { id: 4242, login: 'someone-else' };
  let s = await signIn(mw, '/journal-spam.html');
  check(s.cb.status === 403 && /n'a pas accès|n&#39;a pas accès/.test(s.cb.body) && !setOf(s.cb, '__Host-spam_session'), 'another GitHub id: 403, no session');
  const tokCall = calls.find(c => c.url === 'https://github.com/login/oauth/access_token');
  const body = tokCall ? JSON.parse(tokCall.init.body) : {};
  check(tokCall && tokCall.init.method === 'POST' && tokCall.init.headers.Accept === 'application/json' && body.client_id === ENV.GITHUB_CLIENT_ID &&
    body.client_secret === ENV.GITHUB_CLIENT_SECRET && body.code === 'testcode' && body.redirect_uri === ORIGIN + '/auth/callback', 'code exchanged with client id, secret, code and redirect_uri');
  const userCall = calls.find(c => c.url === 'https://api.github.com/user');
  check(userCall && userCall.init.headers.Authorization === 'Bearer gho_testtoken' && userCall.init.headers['User-Agent'], '/user read with the token and a User-Agent');
  gh.user = { id: '171561900', login: 'string-id' };
  s = await signIn(mw);
  check(s.cb.status === 502 && !setOf(s.cb, '__Host-spam_session'), 'an id that is not a number is refused');
  gh.user = { id: Number(ID), login: 'Cedric-PDP' }; gh.token = null;
  s = await signIn(mw);
  check(s.cb.status === 502 && !setOf(s.cb, '__Host-spam_session'), 'GitHub refusing the code: 502, no session');
  gh.token = 'gho_testtoken';

  // 6. The right account → session cookie, back to the asked page, then the page is served.
  calls.length = 0;
  s = await signIn(mw, '/journal-spam.html');
  const ses = setOf(s.cb, '__Host-spam_session') || '';
  check(s.cb.status === 302 && s.cb.loc === '/journal-spam.html', 'right id: back to the asked page');
  check(/; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$/.test(ses) && !/Domain=/i.test(ses), 'session cookie: 30 days, HttpOnly, Secure, SameSite=Lax, host-only');
  check(/Max-Age=0/.test(setOf(s.cb, '__Host-spam_state') || ''), 'state cookie cleared after use');
  const sv = valueOf(ses), sp = sv.split('.');
  check(sp.length === 4 && sp[0] === 'v1' && sp[1] === ID && Math.abs(Number(sp[2]) - (nowS() + 2592000)) < 5 && sp[3] === hmac(ENV.SESSION_SECRET, 'session.' + sp.slice(0, 3).join('.')), 'session cookie = v1.<id>.<expiry>.<HMAC-SHA256>');
  check(![s.cb.loc, ...s.cb.set, s.cb.body].some(x => String(x).includes('gho_testtoken')), 'the GitHub token is not kept');
  const replay = await call(mw, `/auth/callback?code=testcode&state=${s.state}`, { cookies: { '__Host-spam_state': s.stateCookie, '__Host-spam_session': sv } });
  check(replay.status === 400 || replay.status === 302, 'callback replay does not crash');
  const before = served;
  r = await call(mw, '/journal-spam.html', { cookies: { '__Host-spam_session': sv } });
  check(r.status === 200 && r.body === PAGE && served === before + 1, 'with the session: the page is served');
  check(r.res.headers.get('X-Robots-Tag') === 'noindex, nofollow' && r.res.headers.get('Cache-Control') === 'private, no-cache' && r.res.headers.get('ETag') === '"abc"', 'served page: noindex, private, ETag kept');
  check(!r.res.headers.get('Content-Security-Policy'), 'no CSP (the Atelier loads its illustrations from spamgame.com)');
  r = await call(mw, '/journal-spam.html', { cookies: { other: '1', '__Host-spam_session': sv, more: 'x=y' } });
  check(r.status === 200, 'session found among other cookies');
  r = await call(mw, '/auth/connexion?next=%2Fnouvelles.html', { cookies: { '__Host-spam_session': sv } });
  check(r.status === 302 && r.loc === '/nouvelles.html', 'sign-in page when already signed in: back to the page');
  s = await signIn(mw, '//evil.example/x');
  check(s.cb.status === 302 && s.cb.loc === '/', 'next = //host is replaced by /');
  s = await signIn(mw, 'https://evil.example/');
  check(s.cb.loc === '/', 'next = absolute URL is replaced by /');

  // 7. Forged, tampered or expired session cookies are refused.
  const exp = nowS() + 3600;
  const forged = {
    'other id, right secret (ALLOWED_GITHUB_ID changed)': sessionCookie('4242', exp),
    'other secret': sessionCookie(ID, exp, 'another-secret-another-secret-another'),
    'id changed after signing': sv.replace(`v1.${ID}.`, 'v1.4242.'),
    'expiry pushed after signing': [sp[0], sp[1], String(Number(sp[2]) + 999999), sp[3]].join('.'),
    'signature changed': [sp[0], sp[1], sp[2], sp[3].slice(0, -2) + (sp[3].endsWith('AA') ? 'BB' : 'AA')].join('.'),
    'no signature': sp.slice(0, 3).join('.'),
    'expired': sessionCookie(ID, nowS() - 1),
    'garbage': 'hello',
    'empty': '',
    'v2 format': sv.replace(/^v1/, 'v2')
  };
  for (const [what, value] of Object.entries(forged)) {
    const x = await call(mw, '/atelier-spam.html', { cookies: { '__Host-spam_session': value } });
    check(isSignIn(x, '/atelier-spam.html') && !x.body.includes('page privée'), 'refused: ' + what);
  }
  const x = await call(mw, '/atelier-spam.html', { cookies: { 'spam_session': sv } });
  check(isSignIn(x, '/atelier-spam.html'), 'refused: cookie without the __Host- name');
  const realNow = Date.now;
  Date.now = () => realNow() + 31 * 24 * 3600 * 1000;
  r = await call(mw, '/atelier-spam.html', { cookies: { '__Host-spam_session': sv } });
  Date.now = realNow;
  check(isSignIn(r, '/atelier-spam.html'), 'refused: the session after 30 days');

  // 8. Sign-out clears the cookie; an error in the site never serves the page.
  r = await call(mw, '/auth/logout', { cookies: { '__Host-spam_session': sv } });
  check(r.status === 302 && r.loc === '/auth/connexion?out=1' && /^__Host-spam_session=; Path=\/; Max-Age=0; HttpOnly; Secure; SameSite=Lax$/.test(setOf(r, '__Host-spam_session') || ''), 'sign-out clears the session cookie');
  r = await call(mw, '/auth/connexion?out=1');
  check(r.status === 200 && r.body.includes('Tu es déconnecté'), 'sign-out page');
  r = await call(mw, '/atelier-spam.html');
  check(isSignIn(r, '/atelier-spam.html'), 'after sign-out (cookie gone): sign-in again');
  nextThrows = true;
  r = await call(mw, '/atelier-spam.html', { cookies: { '__Host-spam_session': sv } });
  nextThrows = false;
  check(r.status === 500 && !r.body.includes('page privée'), 'an error gives 500, not the page');
  check(passThrough === 0, 'passThroughOnException never called');

  if (failures) { console.error(`${failures} échec(s), ${passes} réussis`); process.exit(1); }
  console.log(`MIDDLEWARE OK — ${passes} vérifications (${path.relative(process.cwd(), file)})`);
})().catch(e => { console.error(e); process.exit(1); });
