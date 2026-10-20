// Comptes : inscription par code d'invitation, clés (seuls leurs SHA-256 sont gardés).
// Clé principale : toutes les routes. Clé d'import (celle du favori) : POST /api/import seulement.

import { HttpError, json, raw } from './http.js';
import { quickSyncAllowed, syncState } from './import.js';
import { byteLength, cleanText, nowIso, randomToken, safeEqual, sha256Hex } from './util.js';
import { patchSharing } from './members.js';
import { eraseChatOf } from './chat.js';
import { decryptCookie, encryptCookie } from './session.js';

const USER_COLUMNS = 'id, name, created_at, fetched_at, new_ids, cookie_enc, cookie_updated_at, session_expired, '
  + 'import_key_hash, prefs, sync_state, cards_rev, cards_gone_floor, shared, public_id, shared_targets, last_sync, game_pseudo';
const DEFAULT_MAX_USERS = 50;
const MAX_PREFS_BYTES = 4 * 1024;

// Pseudo dans le jeu (2026-10-18, « pour qu'on puisse se trouver ») : facultatif, 40 caractères au plus, sans espace
// ni « / ? # < > » (il sert dans l'adresse de son profil du jeu) ; vide = aucun.
export function cleanPseudo(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'Le pseudo doit être un texte.');
  const pseudo = cleanText(value);
  if (pseudo.length > 40) throw new HttpError(400, 'Le pseudo fait 40 caractères au plus.');
  if (/[\s/?#<>\\]/.test(pseudo)) throw new HttpError(400, 'Le pseudo ne contient ni espace ni « / ? # < > \\ ».');
  return pseudo || null;
}

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

// Nom comparé sans casse, accents ni espaces en trop : « Trykh4r » = « trykh4r ».
const foldName = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
// Classeur jamais utilisé : aucune synchro, pas de favori, aucune carte, aucune collection.
const UNUSED = `SELECT 1 AS unused FROM users AS u WHERE u.id = ?1 AND u.fetched_at IS NULL AND u.import_key_hash IS NULL
  AND NOT EXISTS (SELECT 1 FROM cards AS c WHERE c.user_id = u.id) AND NOT EXISTS (SELECT 1 FROM targets AS t WHERE t.user_id = u.id)`;

// Un prénom déjà pris par un autre classeur est refusé (2026-10-17 : des amis qui avaient perdu leur lien recréaient
// un second classeur à leur nom) ; le message dit comment retrouver son lien. Sauf si ce classeur n'a jamais servi :
// il est alors effacé, et le nouveau prend sa place.
async function freeName(env, name) {
  const { results } = await env.DB.prepare('SELECT id, name FROM users WHERE name IS NOT NULL').all();
  const same = results.filter((r) => foldName(r.name) === foldName(name));
  for (const r of same) {
    if (!(await env.DB.prepare(UNUSED).bind(r.id).first())) {
      throw new HttpError(409, `Il existe déjà un classeur « ${r.name} ». Si c'est le tien, ouvre-le avec ton lien personnel (« J'ai déjà un lien ») : `
        + "il est dans les Réglages du classeur, sur un appareil où il est déjà ouvert. Lien perdu : demande un nouveau lien à la personne qui gère "
        + 'le classeur. Sinon, choisis un autre prénom.');
    }
  }
  for (const r of same) await deleteMe(env, { id: r.id });
}

// POST /api/account {code, name?}
export async function createAccount(env, body) {
  const expected = typeof env.SIGNUP_CODE === 'string' ? env.SIGNUP_CODE.trim() : '';
  if (!expected) throw new HttpError(403, 'Les inscriptions sont fermées.');
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!(await safeEqual(code, expected))) throw new HttpError(403, "Code d'invitation incorrect.");

  const name = cleanName(body.name);
  if (name) await freeName(env, name);
  const id = randomToken(12);
  const key = randomToken(32);
  // Nombre de comptes plafonné (MAX_USERS) : vérifié dans la même requête que l'insertion. Partage entre membres
  // (cartes et collections) activé dès la création (2026-10-16) ; il se coupe dans Réglages.
  const res = await env.DB.prepare(
    `INSERT INTO users (id, name, key_hash, created_at, shared, shared_targets, public_id)
     SELECT ?1, ?2, ?3, ?4, 1, 1, ?6 WHERE (SELECT COUNT(*) FROM users) < ?5`,
  )
    .bind(id, name, await sha256Hex(key), nowIso(), maxUsers(env), randomToken(9))
    .run();
  if (!res.meta.changes) throw new HttpError(403, 'Le classeur est complet : demande à la personne qui le gère.');
  return json({ key, user: { id, name } }, 201);
}

// Utilisateur de la requête (en-tête X-Classeur-Key), ou 401. `importKey` : la clé d'import est acceptée aussi.
// `chat` (GET /api/me) : numéro du dernier message du chat lu dans la même requête (last_chat_id ; MAX sur la clé
// primaire : une ligne lue). `market` (GET /api/me) : heure du dernier envoi du favori au marché (market_at : lecture
// du marché reçue ou essai fini, réussi ou non ; une ligne lue par la clé primaire de market).
export async function authenticate(request, env, { importKey = false, chat = false, market = false } = {}) {
  const key = (request.headers.get('x-classeur-key') || '').trim();
  if (!key) throw new HttpError(401, 'Clé absente : ouvre ton lien personnel du classeur.');
  const where = importKey ? 'key_hash = ?1 OR import_key_hash = ?1' : 'key_hash = ?1';
  const extra = (chat ? ', (SELECT MAX(id) FROM chat_messages) AS last_chat_id' : '')
    + (market ? ", (SELECT max(coalesce(m.live_at, ''), coalesce(CASE WHEN json_valid(m.attempt) THEN json_extract(m.attempt, '$.end') END, '')) FROM market AS m WHERE m.user_id = users.id) AS market_at" : '');
  const user = await env.DB.prepare(`SELECT ${USER_COLUMNS}${extra} FROM users WHERE ${where}`)
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
  return { id: user.id, name: user.name, created_at: user.created_at, pseudo: user.game_pseudo || null };
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
    // son identifiant public tant qu'il partage (celui que les autres voient) : la page se propose après « #u: » du chat
    public_id: user.shared ? user.public_id || null : null,
    last_chat_id: user.last_chat_id ?? 0, // dernier message du chat (supprimé ou non) : la page en déduit le badge des non-lus
    market_at: user.market_at || null, // dernier envoi du favori au marché (market.js) : la page relit alors l'onglet « Marché »
    // Dernière ligne du journal des synchros ({at, kind, via, result, message}, synclog.js), ou null.
    last_sync: user.last_sync ? raw(user.last_sync) : null,
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
  const hasPseudo = Object.hasOwn(body, 'pseudo');
  if (!hasName && !hasPrefs && !hasShared && !hasForce && !hasPseudo) throw new HttpError(400, 'Rien à modifier : indique un nom, un pseudo, des préférences, le partage ou une relecture complète.');
  const name = hasName ? cleanName(body.name) : user.name;
  const pseudo = hasPseudo ? cleanPseudo(body.pseudo) : user.game_pseudo || null;
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
  await env.DB.prepare('UPDATE users SET name = ?1, prefs = ?2, shared = ?3, public_id = ?4, shared_targets = ?5, game_pseudo = ?6 WHERE id = ?7')
    .bind(name, prefs, shared, publicId, sharedTargets, pseudo, user.id)
    .run();
  // Relecture complète demandée : la synchro rapide n'est plus armée (full_at effacé ; une synchro rapide en cours,
  // partie de l'ancien état, échoue aussi).
  if (hasForce) {
    await env.DB.prepare("UPDATE users SET sync_state = json_set(sync_state, '$.full_at', NULL) WHERE id = ?1 AND json_valid(sync_state)")
      .bind(user.id)
      .run();
  }
  return { user: publicUser({ ...user, name, game_pseudo: pseudo }), prefs: raw(prefs), shared: !!shared, shared_targets: !!sharedTargets,
    public_id: shared ? publicId : null };
}

// La clé d'import est aussi gardée chiffrée (import_key_enc : AES-GCM de COOKIE_SECRET, donnée associée
// « import-key:<id> ») : chaque appareil du titulaire reprend la clé du favori en cours (GET /api/import-key) au lieu
// de garder la sienne. Avant (2026-10-18), elle n'était gardée que dans le navigateur qui l'avait créée : un favori créé
// ailleurs la rendait périmée, et la page reproposait sans fin ce favori périmé (« Favori périmé » à chaque essai).
const importAad = (id) => 'import-key:' + id;
async function sealImportKey(env, userId, importKey) {
  try {
    return await encryptCookie(env, importAad(userId), importKey);
  } catch {
    return null; // sans COOKIE_SECRET : pas de copie (comme avant, seul ce navigateur la garde)
  }
}
const IMPORT_KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const STALE_FAVORI = "Favori périmé : la clé gardée dans ce navigateur n'est plus celle de ton favori (un favori plus récent a été créé sur un autre appareil ou navigateur). Crée un nouveau favori, puis remplace l'ancien partout.";

// POST /api/import-key : nouvelle clé d'import (le favori qui portait l'ancienne cesse de marcher).
export async function newImportKey(env, user) {
  const importKey = randomToken(32);
  await env.DB.prepare('UPDATE users SET import_key_hash = ?1, import_key_enc = ?2 WHERE id = ?3')
    .bind(await sha256Hex(importKey), await sealImportKey(env, user.id, importKey), user.id)
    .run();
  return { import_key: importKey };
}

// GET /api/import-key (clé principale) : la clé du favori en cours, la même sur tous les appareils ; 404 sans favori, ou
// pour un favori créé avant la copie chiffrée (la page propose alors la clé qu'elle garde : POST /api/import-key/adopt).
export async function getImportKey(env, user) {
  const row = await env.DB.prepare('SELECT import_key_hash, import_key_enc FROM users WHERE id = ?1').bind(user.id).first();
  if (row && row.import_key_hash && row.import_key_enc) {
    try {
      const importKey = await decryptCookie(env, importAad(user.id), row.import_key_enc);
      if ((await sha256Hex(importKey)) === row.import_key_hash) return { import_key: importKey };
    } catch {
      // copie illisible (secret changé) : comme sans copie
    }
  }
  throw new HttpError(404, row && row.import_key_hash
    ? "Le classeur n'a pas de copie de la clé de ton favori (créé avant le 18 octobre 2026)."
    : "Pas encore de favori : crée-le dans l'onglet « Mettre à jour ».");
}

// POST /api/import-key/adopt {import_key} (clé principale) : la clé gardée par un navigateur, si c'est bien celle du
// favori en cours, devient la copie du classeur (favori d'avant le 18/10) ; sinon 409 : ce favori est périmé.
export async function adoptImportKey(env, user, body) {
  const importKey = typeof body.import_key === 'string' ? body.import_key.trim() : '';
  if (!IMPORT_KEY_RE.test(importKey)) throw new HttpError(400, "« import_key » doit être une clé d'import (43 lettres, chiffres, « - » ou « _ »).");
  const hash = await sha256Hex(importKey);
  const row = await env.DB.prepare('SELECT import_key_hash FROM users WHERE id = ?1').bind(user.id).first();
  if (!row || row.import_key_hash !== hash) throw new HttpError(409, STALE_FAVORI);
  const sealed = await sealImportKey(env, user.id, importKey);
  if (sealed) {
    await env.DB.prepare('UPDATE users SET import_key_enc = ?1 WHERE id = ?2 AND import_key_hash = ?3').bind(sealed, user.id, hash).run();
  }
  return { import_key: importKey };
}

// POST /api/key/rotate : nouvelle clé principale (l'ancienne cesse de marcher).
export async function rotateKey(env, user) {
  const key = randomToken(32);
  await env.DB.prepare('UPDATE users SET key_hash = ?1 WHERE id = ?2').bind(await sha256Hex(key), user.id).run();
  return { key };
}

// DELETE /api/me : efface le compte et tout ce qui s'y rattache. Messages du chat : texte vidé et auteur oublié
// (eraseChatOf : ils disparaissent aussi des pages ouvertes).
export async function deleteMe(env, user) {
  const db = env.DB;
  await db.batch(
    // Marché : sa lecture du marché et ses quotas (market), l'historique de sa valeur ; les cotes (prices), communes et
    // liées à aucun classeur, restent.
    ['cards', 'cards_gone', 'tags', 'targets', 'refresh_staging', 'import_staging', 'market', 'value_history', 'sync_log'].map((t) =>
      db.prepare(`DELETE FROM ${t} WHERE user_id = ?1`).bind(user.id),
    ).concat(eraseChatOf(db, user.id), db.prepare('DELETE FROM users WHERE id = ?1').bind(user.id)),
  );
  return { ok: true };
}
