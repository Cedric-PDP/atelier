// Session du jeu : cookie collé ou tiré d'un HAR (copiés depuis une fenêtre privée), chiffrement AES-GCM, liaison et
// oubli (POST et DELETE /api/session). La session elle-même est lue, vérifiée et renouvelée par game.js.

import { HttpError } from './http.js';
import { base64ToBytes, bytesToBase64 } from './util.js';
import { authFromCookie, authFromHar, linkSession } from './game.js';
import { sessionView } from './auth.js';

export const GAME_HOST = 'www.wiki-masters.com';
// Le jeu répond sous les deux noms : un HAR peut contenir l'un ou l'autre.
const GAME_HOSTS = new Set(['www.wiki-masters.com', 'wiki-masters.com']);

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

// En-tête Cookie d'une requête vers (www.)wiki-masters.com, de préférence /api/my-collection (puis /api/…, puis
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
    if (!GAME_HOSTS.has(url.hostname)) continue;
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
  if (!seen) throw new HttpError(400, 'Ce HAR ne contient aucune requête vers wiki-masters.com.');
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
    throw new HttpError(500, "COOKIE_SECRET n'est pas configuré sur le serveur : impossible de garder une session du jeu.");
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

// Chiffre un texte ; la donnée associée (aad : « game-session:<id> ») lie le chiffré à son compte et à son usage.
export async function encryptCookie(env, aad, text) {
  const key = await cookieKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, key, encoder.encode(text)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return bytesToBase64(out);
}

export async function decryptCookie(env, aad, stored) {
  const key = await cookieKey(env);
  try {
    const bytes = base64ToBytes(stored);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: encoder.encode(aad) },
      key,
      bytes.subarray(12),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new HttpError(401, "Donnée chiffrée illisible (secret du serveur changé).");
  }
}

// POST /api/session {cookie} | {har} : relie le compte du jeu dont la session est copiée depuis une fenêtre privée.
export async function saveSession(env, user, body) {
  let auth;
  if (body.cookie !== undefined && body.cookie !== null && body.cookie !== '') auth = authFromCookie(cleanCookie(body.cookie));
  else if (body.har !== undefined && body.har !== null) auth = authFromHar(body.har);
  else throw new HttpError(400, 'Envoie le cookie (champ « cookie ») ou un export HAR (champ « har »), copiés depuis une fenêtre privée.');
  const { pseudo } = await linkSession(env, user, auth, 'clic');
  const row = await env.DB.prepare(
    'SELECT game_session_enc, game_session_lost, game_session_at, auto_sync, sync_fails, sync_state FROM users WHERE id = ?1',
  ).bind(user.id).first();
  return { ok: true, pseudo, session: sessionView(row) };
}

// DELETE /api/session : le classeur oublie la session (sans déconnecter le jeu).
export async function deleteSession(env, user) {
  const db = env.DB;
  await db.batch([
    db.prepare(
      `UPDATE users SET game_session_enc = NULL, game_uid = NULL, game_session_at = NULL, game_session_lost = NULL,
         game_session_v = game_session_v + 1, sync_fails = 0, sync_lock = NULL WHERE id = ?1`,
    ).bind(user.id),
    db.prepare('DELETE FROM refresh_staging WHERE user_id = ?1').bind(user.id),
  ]);
  return { ok: true };
}
