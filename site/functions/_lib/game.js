// Base du jeu (Supabase : Auth et PostgREST), lue par le serveur avec la session du joueur reliée au classeur.
// La session naît dans une page du jeu ouverte en fenêtre privée (jamais partagée avec le navigateur du joueur :
// Supabase renouvelle par rotation et ferme toute la session quand un jeton de renouvellement resservirait ailleurs).
// Gardée chiffrée (users.game_session_enc), renouvelée par le serveur avant expiration, sous verrou : la version
// (game_session_v) est comparée et incrémentée dans la même requête, qui perd reprend la session la plus récente ; le bail
// (sync_lock) empêche deux lectures en même temps avec la même session. Lecture seule : rien n'est jamais écrit dans le jeu,
// et aucun en-tête n'imite un navigateur.

import { HttpError } from './http.js';
import { cookieFromHar, decryptCookie, encryptCookie } from './session.js';
import { logStatements, writeLog } from './synclog.js';
import { cleanPseudo } from './auth.js';
import { base64ToBytes, nowIso, sleep } from './util.js';

export const SUPABASE = 'https://cyrxjeppjqsxxjayfrur.supabase.co';
// Clé publique de la base du jeu (rôle « anon », livrée dans le code de sa page) : seule, elle n'ouvre rien.
export const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5cnhqZXBwanFzeHhqYXlmcnVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4ODAzMzksImV4cCI6MjA4OTQ1NjMzOX0.BZluyXygNxuQGDPxFX1zG5i-cqp10CVK-8GGtuak4Rg';
export const AUTH_COOKIE = 'sb-cyrxjeppjqsxxjayfrur-auth-token';
export const REFRESH_MARGIN_MS = 120_000;
export const SUPA_GAP_MS = 1000;

const LIMITED = 'Le jeu limite les lectures automatiques : réessaie plus tard.';
const DOWN = 'La base du jeu ne répond pas : réessaie dans un moment.';
const NOT_VALID = "Cette session du jeu n'est pas valable (expirée, ou copiée hors d'une fenêtre privée) : recommence depuis une fenêtre privée.";
const BAD_COOKIE = "Ce cookie ne contient pas de session du jeu lisible (« sb-…-auth-token ») : copie-le depuis une page du jeu "
  + 'où tu es connecté, dans une fenêtre privée.';
const needsLink = (message) => new HttpError(401, message, { needs_link: true });

// Attente : REFRESH_PAUSE_MS (tests) remplace toutes les attentes quand il est défini.
const pause = (env, ms) => sleep(env.REFRESH_PAUSE_MS !== undefined ? Number(env.REFRESH_PAUSE_MS) : ms);

// En-tête Cookie d'une page du jeu → {access_token, refresh_token, expires_at}. Le cookie de session (@supabase/ssr) est
// découpé en sb-…-auth-token.0, .1… au-delà d'une certaine taille ; sa valeur est « base64- » + JSON en base64url, ou
// (anciennes versions) le JSON encodé pour l'adresse.
export function authFromCookie(header) {
  const whole = [];
  const chunks = [];
  for (const piece of String(header ?? '').split(';')) {
    const i = piece.indexOf('=');
    if (i < 0) continue;
    const name = piece.slice(0, i).trim();
    const value = piece.slice(i + 1).trim();
    if (name === AUTH_COOKIE) whole.push(value);
    else if (name.startsWith(AUTH_COOKIE + '.') && /^\d{1,3}$/.test(name.slice(AUTH_COOKIE.length + 1))) {
      chunks.push([Number(name.slice(AUTH_COOKIE.length + 1)), value]);
    }
  }
  if (!whole.length && !chunks.length) throw new HttpError(400, BAD_COOKIE);
  let value = chunks.length ? chunks.sort((a, b) => a[0] - b[0]).map(([, v]) => v).join('') : whole[0];
  try {
    value = decodeURIComponent(value);
  } catch {
    // déjà décodé
  }
  let auth;
  try {
    const text = value.startsWith('base64-')
      ? new TextDecoder().decode(base64ToBytes(base64Std(value.slice(7))))
      : value;
    auth = JSON.parse(text);
  } catch {
    throw new HttpError(400, BAD_COOKIE);
  }
  if (!auth || typeof auth !== 'object' || typeof auth.access_token !== 'string' || !auth.access_token
    || typeof auth.refresh_token !== 'string' || !auth.refresh_token) {
    throw new HttpError(400, BAD_COOKIE);
  }
  return { access_token: auth.access_token, refresh_token: auth.refresh_token, expires_at: Number(auth.expires_at) || 0 };
}

function base64Std(text) {
  const b = text.replace(/-/g, '+').replace(/_/g, '/');
  return b + '='.repeat((4 - (b.length % 4)) % 4);
}

export function authFromHar(har) {
  return authFromCookie(cookieFromHar(har));
}

const aadOf = (userId) => 'game-session:' + userId;

export function sealSession(env, userId, auth) {
  return encryptCookie(env, aadOf(userId), JSON.stringify(auth));
}

export async function openSession(env, userId, enc) {
  try {
    return JSON.parse(await decryptCookie(env, aadOf(userId), enc));
  } catch {
    throw needsLink("Ta session du jeu n'est plus lisible (secret du serveur changé) : relie ton compte.");
  }
}

// Session reliée du compte (colonnes de USER_COLUMNS) → {auth, v, uid}, ou 401 needs_link.
export async function sessionOf(env, user) {
  if (!user.game_session_enc) throw needsLink('Aucun compte du jeu relié : relie ton compte dans l\'onglet « Synchro ».');
  if (user.game_session_lost) throw needsLink(`Ta session du jeu n'est plus valable (${user.game_session_lost}) : relie ton compte.`);
  return { auth: await openSession(env, user.id, user.game_session_enc), v: user.game_session_v, uid: user.game_uid };
}

// Jeton d'accès renouvelé d'avance s'il expire dans moins de REFRESH_MARGIN_MS (expires_at est en secondes).
export async function freshAuth(env, user, s) {
  if ((Number(s.auth.expires_at) || 0) * 1000 - Date.now() < REFRESH_MARGIN_MS) await renewSession(env, user, s);
  return s;
}

// Une requête au jeu ; réseau ou 5xx : `retries` nouveaux essais (1 s, puis 2 s). null si le jeu ne répond toujours pas.
async function send(env, url, init, retries) {
  for (let attempt = 0; ; attempt++) {
    let res = null;
    try {
      res = await fetch(url, init);
    } catch {
      res = null;
    }
    if (res && res.status < 500) return res;
    if (attempt >= retries) return null;
    await pause(env, 1000 * (attempt + 1));
  }
}

const readJson = (res) => res.json().catch(() => null);

// POST auth/v1/token (grant refresh_token) → {status, auth?} ; auth = nouvelle session si 200.
async function tokenRequest(env, refreshToken) {
  const res = await send(env, `${SUPABASE}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  }, 2);
  if (!res) throw new HttpError(502, DOWN);
  const data = await readJson(res);
  if (res.status === 429 || (data && data.code === 'automation_limit')) throw new HttpError(429, LIMITED, { limited: true });
  if (!res.ok) return { status: res.status };
  if (!data || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') {
    throw new HttpError(502, 'Réponse inattendue du jeu au renouvellement de ta session : le jeu a peut-être changé.');
  }
  const expiresAt = Number(data.expires_at) || Math.floor(Date.now() / 1000) + (Number(data.expires_in) || 3600);
  return { status: 200, auth: { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: expiresAt } };
}

// Renouvelle la session (s, mise à jour sur place et rendue). Révoquée par le jeu (400/403 : déconnexion du jeu, ou jeton
// réutilisé ailleurs) : le membre est « à relier ». Une autre lecture l'a renouvelée entre-temps (version changée) : sa
// session, la plus récente, est reprise.
export async function renewSession(env, user, s) {
  const db = env.DB;
  const got = await tokenRequest(env, s.auth.refresh_token);
  if (got.status === 400 || got.status === 403) {
    const lost = await db.prepare(
      "UPDATE users SET game_session_lost = 'révoquée', game_session_v = game_session_v + 1 WHERE id = ?1 AND game_session_v = ?2 RETURNING id",
    ).bind(user.id, s.v).first();
    if (lost) {
      await writeLog(db, user.id, {
        kind: 'session',
        result: 'error',
        message: 'Session du jeu révoquée (déconnexion du jeu, ou session réutilisée ailleurs) : relie ton compte.',
        data: { via: s.via },
      });
      throw needsLink('Ta session du jeu a été révoquée (déconnexion du jeu, ou session réutilisée ailleurs) : relie ton compte.');
    }
    return takeLatest(env, user, s);
  }
  if (got.status !== 200) throw new HttpError(502, `Le jeu a refusé le renouvellement de ta session (${got.status}) : le jeu a peut-être changé.`);
  const auth = { ...got.auth, uid: s.auth.uid ?? s.uid ?? null };
  const row = await db.prepare(
    'UPDATE users SET game_session_enc = ?1, game_session_v = ?2 + 1, game_session_at = ?3 WHERE id = ?4 AND game_session_v = ?2 RETURNING game_session_v',
  ).bind(await sealSession(env, user.id, auth), s.v, nowIso(), user.id).first();
  if (!row) return takeLatest(env, user, s);
  s.auth = auth;
  s.v = row.game_session_v;
  return s;
}

async function takeLatest(env, user, s) {
  const row = await env.DB.prepare('SELECT game_session_enc, game_session_v, game_session_lost FROM users WHERE id = ?1').bind(user.id).first();
  if (!row || !row.game_session_enc) throw needsLink('Aucun compte du jeu relié : relie ton compte dans l\'onglet « Synchro ».');
  if (row.game_session_lost) throw needsLink(`Ta session du jeu n'est plus valable (${row.game_session_lost}) : relie ton compte.`);
  s.auth = await openSession(env, user.id, row.game_session_enc);
  s.v = row.game_session_v;
  return s;
}

// GET rest/v1/<path> avec la session du joueur → {rows, count} (count : compte exact si demandé, sinon null). gap = attente
// avant l'appel. Jeton refusé (401) : un renouvellement, puis un seul nouvel essai.
export async function supaGet(env, user, s, path, { count = false, gap = 0, retry = true } = {}) {
  if (gap) await pause(env, gap);
  const headers = { apikey: ANON, authorization: `Bearer ${s.auth.access_token}`, accept: 'application/json' };
  if (count) headers.prefer = 'count=exact';
  const res = await send(env, `${SUPABASE}/rest/v1/${path}`, { headers }, 2);
  if (!res) throw new HttpError(502, DOWN);
  const data = await readJson(res);
  if (res.status === 429 || (data && !Array.isArray(data) && data.code === 'automation_limit')) throw new HttpError(429, LIMITED, { limited: true });
  if (res.status === 401) {
    if (!retry) throw new HttpError(502, 'La base du jeu refuse ta session même renouvelée : le jeu a peut-être changé.');
    await renewSession(env, user, s);
    return supaGet(env, user, s, path, { count, retry: false });
  }
  if (!res.ok) throw new HttpError(502, `La base du jeu a refusé une lecture (${res.status}) : le jeu a peut-être changé.`);
  if (!Array.isArray(data)) throw new HttpError(502, "Réponse inattendue de la base du jeu (ce n'est pas une liste) : le jeu a peut-être changé.");
  let n = null;
  if (count) {
    const m = /\/(\d+)\s*$/.exec(res.headers.get('content-range') || '');
    n = m ? Number(m[1]) : null;
  }
  return { rows: data, count: n };
}

// Liste PostgREST « in.(…) » de textes entre guillemets (titres avec virgules ou parenthèses compris).
export function inList(xs) {
  return encodeURIComponent('(' + xs.map((x) => '"' + String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + ')');
}

// Lots pour « in.(…) » : max valeurs au plus, et 5 000 caractères au plus une fois encodés (une adresse trop longue
// serait refusée, 414).
export function lots(xs, max) {
  const out = [];
  let cur = [];
  let len = 0;
  for (const x of xs) {
    const n = inList([x]).length;
    if (cur.length && (cur.length >= max || len + n > 5000)) {
      out.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(x);
    len += n;
  }
  return cur.length ? [...out, cur] : out;
}

// À qui est cette session, d'après le jeu (jamais d'après le contenu du cookie, que n'importe qui peut écrire) :
// {uid, username}.
export async function verifySession(env, auth) {
  const headers = { apikey: ANON, authorization: `Bearer ${auth.access_token}`, accept: 'application/json' };
  let res = await send(env, `${SUPABASE}/auth/v1/user`, { headers }, 2);
  if (!res) throw new HttpError(502, DOWN);
  let data = await readJson(res);
  if (res.status === 429 || (data && data.code === 'automation_limit')) throw new HttpError(429, LIMITED, { limited: true });
  if (res.status === 401 || res.status === 403) throw new HttpError(401, NOT_VALID);
  if (!res.ok || !data || typeof data.id !== 'string' || !data.id) {
    throw new HttpError(502, `Le jeu n'a pas dit à qui est cette session (${res.status}) : réessaie dans un moment.`);
  }
  const uid = data.id;
  res = await send(env, `${SUPABASE}/rest/v1/profiles?select=username&id=eq.${encodeURIComponent(uid)}`, { headers }, 2);
  data = res && res.ok ? await readJson(res) : null;
  const username = Array.isArray(data) && data[0] && typeof data[0].username === 'string' ? data[0].username : null;
  return { uid, username };
}

// Relie le compte du jeu de cette session au classeur (via : clic | relier). Session presque expirée : renouvelée d'abord
// (pas encore gardée). Un compte du jeu déjà relié à un autre classeur est refusé. Le pseudo du jeu remplit game_pseudo
// s'il est vide. → {pseudo}.
export async function linkSession(env, user, auth, via) {
  const db = env.DB;
  let session = { ...auth };
  if ((Number(session.expires_at) || 0) * 1000 - Date.now() < REFRESH_MARGIN_MS) {
    const got = await tokenRequest(env, session.refresh_token);
    if (got.status !== 200) throw new HttpError(401, NOT_VALID);
    session = got.auth;
  }
  const { uid, username } = await verifySession(env, session);
  const taken = await db.prepare('SELECT id FROM users WHERE game_uid = ?1 AND id <> ?2').bind(uid, user.id).first();
  if (taken) throw new HttpError(409, 'Ce compte du jeu est déjà relié à un autre classeur.');
  let pseudo = null;
  try {
    pseudo = cleanPseudo(username);
  } catch {
    pseudo = null;
  }
  const enc = await sealSession(env, user.id, { ...session, uid });
  await db.batch([
    db.prepare(
      `UPDATE users SET game_session_enc = ?1, game_uid = ?2, game_session_v = game_session_v + 1, game_session_at = ?3,
         game_session_lost = NULL, sync_fails = 0, link_hash = NULL, link_until = NULL, game_pseudo = COALESCE(game_pseudo, ?4)
       WHERE id = ?5`,
    ).bind(enc, uid, nowIso(), pseudo, user.id),
    db.prepare('DELETE FROM refresh_staging WHERE user_id = ?1').bind(user.id),
    ...logStatements(db, user.id, { kind: 'session', result: 'ok', message: `Compte du jeu relié (${username || uid}).`, data: { via } }),
  ]);
  return { pseudo: username || null };
}

// Bail d'une lecture (collection ou marché) : pris seulement s'il est libre ou échu. Rend sa valeur (heure de fin), ou null.
export async function acquireLease(db, userId, ms) {
  const now = Date.now();
  const until = new Date(now + ms).toISOString();
  const row = await db.prepare('UPDATE users SET sync_lock = ?2 WHERE id = ?1 AND (sync_lock IS NULL OR sync_lock < ?3) RETURNING id')
    .bind(userId, until, new Date(now).toISOString()).first();
  return row ? until : null;
}

// Requête qui rend le bail (à passer dans le lot final, ou à lancer seule) ; avec `lease`, seulement s'il est encore le sien.
export function releaseLease(db, userId, lease) {
  return lease === undefined
    ? db.prepare('UPDATE users SET sync_lock = NULL WHERE id = ?1').bind(userId)
    : db.prepare('UPDATE users SET sync_lock = NULL WHERE id = ?1 AND sync_lock IS ?2').bind(userId, lease);
}
