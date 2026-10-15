// Session WikiMasters : cookie collé ou tiré d'un HAR, chiffré en AES-GCM, fusion des Set-Cookie du jeu.

import { HttpError } from './http.js';
import { base64ToBytes, bytesToBase64, nowIso } from './util.js';

export const GAME_HOST = 'www.wiki-masters.com';

const encoder = new TextEncoder();
const MAX_COOKIE = 16_384;

const INVALID_COOKIE =
  "Cookie invalide : colle la valeur de l'en-tête Cookie d'une requête vers www.wiki-masters.com " +
  '(de la forme nom=valeur; nom2=valeur2).';

// Valeur d'en-tête Cookie acceptée : texte ASCII visible, au moins une paire nom=valeur.
export function cleanCookie(raw) {
  if (typeof raw !== 'string') throw new HttpError(400, INVALID_COOKIE);
  const cookie = raw
    .replace(/^\s*cookie\s*:\s*/i, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .replace(/;\s*$/, '');
  if (!cookie || !cookie.includes('=') || cookie.length > MAX_COOKIE || !/^[\x20-\x7e\t]+$/.test(cookie)) {
    throw new HttpError(400, INVALID_COOKIE);
  }
  return cookie;
}

// En-tête Cookie d'une requête vers www.wiki-masters.com, de préférence /api/my-collection (puis /api/…, puis
// n'importe quelle page) ; à rang égal, la plus récente.
export function cookieFromHar(har) {
  if (typeof har === 'string') {
    try {
      har = JSON.parse(har);
    } catch {
      throw new HttpError(400, "Ce fichier HAR n'est pas du JSON valide.");
    }
  }
  const entries = har?.log?.entries;
  if (!Array.isArray(entries)) throw new HttpError(400, 'Fichier HAR invalide : il manque log.entries.');

  let seen = false;
  let best = null;
  for (const entry of entries) {
    const req = entry?.request;
    let url;
    try {
      url = new URL(String(req?.url));
    } catch {
      continue;
    }
    if (url.hostname !== GAME_HOST) continue;
    seen = true;
    const headers = Array.isArray(req.headers) ? req.headers : [];
    // En HTTP/2, le navigateur peut envoyer plusieurs en-têtes cookie : on les recolle.
    let cookie = headers
      .filter((h) => String(h?.name).toLowerCase() === 'cookie')
      .map((h) => String(h.value ?? '').trim())
      .filter(Boolean)
      .join('; ');
    if (!cookie && Array.isArray(req.cookies)) {
      cookie = req.cookies
        .filter((c) => c && c.name)
        .map((c) => `${c.name}=${c.value ?? ''}`)
        .join('; ');
    }
    if (!cookie) continue;
    const rank = url.pathname.startsWith('/api/my-collection') ? 2 : url.pathname.startsWith('/api/') ? 1 : 0;
    if (!best || rank >= best.rank) best = { rank, cookie };
  }
  if (!seen) throw new HttpError(400, 'Ce HAR ne contient aucune requête vers www.wiki-masters.com.');
  if (!best) {
    throw new HttpError(
      400,
      "Ce HAR ne contient pas de cookie : il a été exporté « nettoyé » (c'est le réglage par défaut de Chrome " +
        "et d'Edge). Colle plutôt l'en-tête Cookie d'une requête my-collection (F12 → Réseau → la requête → " +
        "En-têtes de requête), ou exporte le HAR avec les données sensibles (« Export HAR (with sensitive data) »).",
    );
  }
  return cleanCookie(best.cookie);
}

// Clé AES-GCM dérivée de COOKIE_SECRET (HKDF-SHA-256), gardée en mémoire par secret.
const keys = new Map();

async function cookieKey(env) {
  const secret = env.COOKIE_SECRET;
  if (typeof secret !== 'string' || !secret) {
    throw new HttpError(500, "COOKIE_SECRET n'est pas configuré sur le serveur : impossible de garder un cookie.");
  }
  let key = keys.get(secret);
  if (!key) {
    key = (async () => {
      const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
      return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('classeur'), info: encoder.encode('cookie-wikimasters-v1') },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
    keys.set(secret, key);
  }
  return key;
}

// Chiffre le cookie ; l'id du compte sert de donnée associée (un chiffré ne vaut que pour son compte).
export async function encryptCookie(env, userId, cookie) {
  const key = await cookieKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(userId) }, key, encoder.encode(cookie)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return bytesToBase64(out);
}

export async function decryptCookie(env, userId, stored) {
  const key = await cookieKey(env);
  try {
    const bytes = base64ToBytes(stored);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: encoder.encode(userId) },
      key,
      bytes.subarray(12),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new HttpError(
      401,
      "Ta session WikiMasters n'est plus lisible (secret du serveur changé) : colle un nouveau cookie.",
      { needs_session: true },
    );
  }
}

// Tous les Set-Cookie d'une réponse (getSetCookie standard, getAll des Workers, ou en-tête recollé).
export function setCookiesOf(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  if (typeof headers.getAll === 'function') return headers.getAll('set-cookie');
  const joined = headers.get('set-cookie');
  return joined ? joined.split(/,(?=\s*[^;,=\s]+=)/) : [];
}

// Fusionne des Set-Cookie (nom=valeur) dans un en-tête Cookie ; un cookie expiré (Max-Age ≤ 0, Expires passé)
// est retiré.
export function mergeSetCookies(cookie, setCookies) {
  if (!setCookies.length) return cookie;
  const jar = new Map();
  for (const part of cookie.split(';')) {
    const p = part.trim();
    if (!p) continue;
    const i = p.indexOf('=');
    if (i < 0) jar.set(p, null);
    else jar.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
  }
  for (const line of setCookies) {
    const [pair, ...attrs] = String(line).split(';');
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    let expired = false;
    for (const attr of attrs) {
      const [k, ...rest] = attr.split('=');
      const v = rest.join('=').trim();
      const key = k.trim().toLowerCase();
      if (key === 'max-age' && Number(v) <= 0) expired = true;
      if (key === 'expires' && Date.parse(v) < Date.now()) expired = true;
    }
    if (expired) jar.delete(name);
    else jar.set(name, value);
  }
  return [...jar].map(([n, v]) => (v === null ? n : `${n}=${v}`)).join('; ');
}

// POST /api/session {cookie} | {har}
export async function saveSession(env, user, body) {
  let cookie;
  if (body.cookie !== undefined && body.cookie !== null && body.cookie !== '') cookie = cleanCookie(body.cookie);
  else if (body.har !== undefined && body.har !== null) cookie = cookieFromHar(body.har);
  else throw new HttpError(400, 'Envoie le cookie (champ « cookie ») ou un export HAR (champ « har »).');

  const enc = await encryptCookie(env, user.id, cookie);
  await env.DB.prepare(
    'UPDATE users SET cookie_enc = ?1, cookie_updated_at = ?2, session_expired = 0 WHERE id = ?3',
  )
    .bind(enc, nowIso(), user.id)
    .run();
  return { ok: true };
}

// DELETE /api/session
export async function deleteSession(env, user) {
  const db = env.DB;
  await db.batch([
    db.prepare(
      'UPDATE users SET cookie_enc = NULL, cookie_updated_at = NULL, session_expired = 0 WHERE id = ?1',
    ).bind(user.id),
    db.prepare('DELETE FROM refresh_staging WHERE user_id = ?1').bind(user.id),
  ]);
  return { ok: true };
}
