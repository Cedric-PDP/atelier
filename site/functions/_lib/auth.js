// Comptes : inscription par code d'invitation, clés (seuls leurs SHA-256 sont gardés).
// Clé principale : toutes les routes. Clé d'import (celle du favori) : POST /api/import seulement.

import { HttpError, json, raw } from './http.js';
import { quickSyncAllowed, syncState } from './import.js';
import { byteLength, cleanText, nowIso, randomToken, safeEqual, sha256Hex } from './util.js';
import { patchSharing } from './members.js';

const USER_COLUMNS = 'id, name, created_at, fetched_at, new_ids, cookie_enc, cookie_updated_at, session_expired, '
  + 'import_key_hash, prefs, sync_state, cards_rev, cards_gone_floor, shared, public_id, shared_targets';
const DEFAULT_MAX_USERS = 50;
const MAX_PREFS_BYTES = 4 * 1024;

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
  if (!user) {
    throw new HttpError(401, importKey
      ? "Favori périmé : sa clé ne correspond plus à aucun classeur (un favori plus récent l'a remplacé, ou le classeur a été supprimé). Ouvre ton classeur, onglet « Mettre à jour », et remplace le favori de ta barre."
      : 'Clé inconnue : ce lien ne correspond à aucun compte.');
  }
  return user;
}

export function publicUser(user) {
  return { id: user.id, name: user.name, created_at: user.created_at };
}

// GET /api/me
export async function getMe(env, user) {
  // Nombre de cartes : gardé par chaque import et chaque synchro rapide (sync_state.count), sans relire les cartes (D1
  // compte une ligne lue par carte). Classeur importé avant ce compteur (sync_state absent, ou sans unit, invalid ni
  // count : jamais de synchro rapide) : compté une fois, puis gardé dans sync_state, seulement s'il n'a pas changé depuis
  // la lecture du compte (un import fini entre-temps a écrit le sien) — la page relit GET /api/me toutes les minutes.
  const state = syncState(user);
  let count = state && Number.isInteger(state.count) ? state.count : null;
  if (count === null) {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM cards WHERE user_id = ?1').bind(user.id).first();
    count = row ? row.n : 0;
    await env.DB.prepare(
      "UPDATE users SET sync_state = json_set(CASE WHEN json_valid(sync_state) THEN sync_state ELSE '{}' END, '$.count', ?2) WHERE id = ?1 AND sync_state IS ?3",
    ).bind(user.id, count, user.sync_state ?? null).run();
  }
  return {
    user: publicUser(user),
    fetched_at: user.fetched_at,
    card_count: count,
    next_full: !quickSyncAllowed(state), // la prochaine mise à jour (favori ou rafraîchissement) relira toute la collection
    cards_rev: user.cards_rev, // change à chaque changement de la liste des cartes : la page relit alors ?since=…
    new_ids: raw(user.new_ids || '[]'), // texte JSON écrit par la finalisation d'import
    has_import_key: !!user.import_key_hash,
    prefs: raw(user.prefs || '{}'), // objet JSON rangé tel quel par PATCH /api/me
    shared: !!user.shared, // montre ses cartes aux autres membres (partage entre membres, members.js)
    shared_targets: !!(user.shared && user.shared_targets), // et ses collections à compléter (réglage à part)
    session: {
      has_cookie: !!user.cookie_enc,
      expired: !!user.session_expired,
      updated_at: user.cookie_updated_at,
    },
  };
}

// PATCH /api/me {name?, prefs?, shared?, shared_targets?} : `shared` (booléen) active ou coupe le partage entre membres,
// `shared_targets` (booléen, seulement avec `shared`) celui des collections à compléter (members.js) ; `prefs` (objet JSON de 4 Ko au plus) remplace les préférences entières ; son
// contenu n'est pas vérifié (l'interface y range ce qu'elle veut).
export async function patchMe(env, user, body) {
  const hasName = Object.hasOwn(body, 'name');
  const hasPrefs = Object.hasOwn(body, 'prefs');
  const sharing = patchSharing(user, body);
  const hasShared = sharing.touched;
  // force_full: true (clé principale seulement) : la prochaine mise à jour relira toute la collection (seul remède à ce
  // que la synchro rapide ne voit pas : échange de cartes de même rareté, favori retiré dans le jeu…).
  const hasForce = Object.hasOwn(body, 'force_full');
  if (hasForce && body.force_full !== true) throw new HttpError(400, 'force_full vaut true (relire toute la collection à la prochaine mise à jour).');
  if (!hasName && !hasPrefs && !hasShared && !hasForce) throw new HttpError(400, 'Rien à modifier : indique un nom, des préférences, le partage ou une relecture complète.');
  const name = hasName ? cleanName(body.name) : user.name;
  let prefs = user.prefs || '{}';
  if (hasPrefs) {
    const p = body.prefs;
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new HttpError(400, 'Les préférences doivent être un objet JSON.');
    prefs = JSON.stringify(p);
    if (prefs.length > MAX_PREFS_BYTES || byteLength(prefs) > MAX_PREFS_BYTES) {
      throw new HttpError(413, 'Préférences trop volumineuses : 4 Ko au plus.');
    }
  }
  // Partage entre membres (choisi, désactivé par défaut ; identifiant public tiré à chaque activation) : patchSharing.
  const { shared, publicId, sharedTargets } = sharing;
  await env.DB.prepare('UPDATE users SET name = ?1, prefs = ?2, shared = ?3, public_id = ?4, shared_targets = ?5 WHERE id = ?6')
    .bind(name, prefs, shared, publicId, sharedTargets, user.id)
    .run();
  // Relecture complète demandée : la synchro rapide n'est plus armée (full_at effacé ; une synchro rapide en cours,
  // partie de l'ancien état, échoue aussi).
  if (hasForce) {
    await env.DB.prepare("UPDATE users SET sync_state = json_set(sync_state, '$.full_at', NULL) WHERE id = ?1 AND json_valid(sync_state)")
      .bind(user.id)
      .run();
  }
  return { user: publicUser({ ...user, name }), prefs: raw(prefs), shared: !!shared, shared_targets: !!sharedTargets };
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
    ['cards', 'cards_gone', 'tags', 'targets', 'refresh_staging', 'import_staging'].map((t) =>
      db.prepare(`DELETE FROM ${t} WHERE user_id = ?1`).bind(user.id),
    ).concat(db.prepare('DELETE FROM users WHERE id = ?1').bind(user.id)),
  );
  return { ok: true };
}
