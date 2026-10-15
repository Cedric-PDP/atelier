// Comptes : inscription par code d'invitation, clé personnelle (seul son SHA-256 est gardé).

import { HttpError, json, raw } from './http.js';
import { charLength, cleanText, nowIso, randomToken, safeEqual, sha256Hex } from './util.js';

const USER_COLUMNS =
  'id, name, created_at, fetched_at, new_ids, cookie_enc, cookie_updated_at, session_expired';

// Nom affiché : facultatif, 60 caractères au plus ; vide = aucun.
export function cleanName(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'Le nom doit être un texte.');
  const name = cleanText(value);
  if (charLength(name) > 60) throw new HttpError(400, 'Le nom fait 60 caractères au plus.');
  return name || null;
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
  await env.DB.prepare('INSERT INTO users (id, name, key_hash, created_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(id, name, await sha256Hex(key), nowIso())
    .run();
  return json({ key, user: { id, name } }, 201);
}

// Utilisateur de la requête (en-tête X-Classeur-Key), ou 401.
export async function authenticate(request, env) {
  const key = (request.headers.get('x-classeur-key') || '').trim();
  if (!key) throw new HttpError(401, 'Clé absente : ouvre ton lien personnel du classeur.');
  const user = await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE key_hash = ?1`)
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
