// Comptes : inscription par code d'invitation, clés (seuls leurs SHA-256 sont gardés).
// Clé principale : toutes les routes. Clé d'import (celle du favori) : POST /api/import seulement.

import { HttpError, json, raw } from './http.js';
import { cleanText, nowIso, randomToken, safeEqual, sha256Hex } from './util.js';

const USER_COLUMNS =
  'id, name, created_at, fetched_at, new_ids, cookie_enc, cookie_updated_at, session_expired, import_key_hash';
const DEFAULT_MAX_USERS = 50;

// Nom affiché : facultatif, 60 caractères au plus ; vide = aucun.
export function cleanName(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'Le nom doit être un texte.');
  const name = cleanText(value);
  if (name.length > 60) throw new HttpError(400, 'Le nom fait 60 caractères au plus.');
  return name || null;
}

function maxUsers(env) {
  const n = Number(env.MAX_USERS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_USERS;
}

// POST /api/account {code, name?}
export async function createAccount(env, body) {
  const expected = typeof env.SIGNUP_CODE === 'string' ? env.SIGNUP_CODE.trim() : '';
  if (!expected) throw new HttpError(403, 'Les inscriptions sont fermées.');
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!(await safeEqual(code, expected))) throw new HttpError(403, "Code d'invitation incorrect.");

  const name = cleanName(body.name);
  const id = randomToken(12);
  const key = randomToken(32);
  // Nombre de comptes plafonné (MAX_USERS) : vérifié dans la même requête que l'insertion.
  const res = await env.DB.prepare(
    `INSERT INTO users (id, name, key_hash, created_at)
     SELECT ?1, ?2, ?3, ?4 WHERE (SELECT COUNT(*) FROM users) < ?5`,
  )
    .bind(id, name, await sha256Hex(key), nowIso(), maxUsers(env))
    .run();
  if (!res.meta.changes) throw new HttpError(403, 'Le classeur est complet : demande à la personne qui le gère.');
  return json({ key, user: { id, name } }, 201);
}

// Utilisateur de la requête (en-tête X-Classeur-Key), ou 401. `importKey` : la clé d'import est acceptée aussi.
export async function authenticate(request, env, { importKey = false } = {}) {
  const key = (request.headers.get('x-classeur-key') || '').trim();
  if (!key) throw new HttpError(401, 'Clé absente : ouvre ton lien personnel du classeur.');
  const where = importKey ? 'key_hash = ?1 OR import_key_hash = ?1' : 'key_hash = ?1';
  const user = await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE ${where}`)
    .bind(await sha256Hex(key))
    .first();
  if (!user) throw new HttpError(401, 'Clé inconnue : ce lien ne correspond à aucun compte.');
  return user;
}

export function publicUser(user) {
  return { id: user.id, name: user.name, created_at: user.created_at };
}

// GET /api/me
export async function getMe(env, user) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM cards WHERE user_id = ?1').bind(user.id).first();
  return {
    user: publicUser(user),
    fetched_at: user.fetched_at,
    card_count: row ? row.n : 0,
    new_ids: raw(user.new_ids || '[]'), // texte JSON écrit par la finalisation d'import
    has_import_key: !!user.import_key_hash,
    session: {
      has_cookie: !!user.cookie_enc,
      expired: !!user.session_expired,
      updated_at: user.cookie_updated_at,
    },
  };
}

// PATCH /api/me {name}
export async function patchMe(env, user, body) {
  if (!('name' in body)) throw new HttpError(400, 'Rien à modifier : indique un nom.');
  const name = cleanName(body.name);
  await env.DB.prepare('UPDATE users SET name = ?1 WHERE id = ?2').bind(name, user.id).run();
  return { user: publicUser({ ...user, name }) };
}

// POST /api/import-key : nouvelle clé d'import (le favori qui portait l'ancienne cesse de marcher).
export async function newImportKey(env, user) {
  const importKey = randomToken(32);
  await env.DB.prepare('UPDATE users SET import_key_hash = ?1 WHERE id = ?2')
    .bind(await sha256Hex(importKey), user.id)
    .run();
  return { import_key: importKey };
}

// POST /api/key/rotate : nouvelle clé principale (l'ancienne cesse de marcher).
export async function rotateKey(env, user) {
  const key = randomToken(32);
  await env.DB.prepare('UPDATE users SET key_hash = ?1 WHERE id = ?2').bind(await sha256Hex(key), user.id).run();
  return { key };
}

// DELETE /api/me : efface le compte et tout ce qui s'y rattache.
export async function deleteMe(env, user) {
  const db = env.DB;
  await db.batch(
    ['cards', 'tags', 'targets', 'refresh_staging', 'import_staging'].map((t) =>
      db.prepare(`DELETE FROM ${t} WHERE user_id = ?1`).bind(user.id),
    ).concat(db.prepare('DELETE FROM users WHERE id = ?1').bind(user.id)),
  );
  return { ok: true };
}
