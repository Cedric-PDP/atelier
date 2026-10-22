// Comptes : inscription par code d'invitation, clé principale (seul son SHA-256 est gardé), réglages du compte.

import { HttpError, json, raw } from './http.js';
import { syncState } from './import.js';
import { FAILS_MAX } from './refresh.js';
import { byteLength, cleanText, nowIso, randomToken, safeEqual, sha256Hex } from './util.js';
import { patchSharing } from './members.js';
import { eraseChatOf } from './chat.js';

export const USER_COLUMNS = 'id, name, created_at, fetched_at, new_ids, prefs, sync_state, cards_rev, cards_gone_floor, shared, public_id, '
  + 'shared_targets, last_sync, game_pseudo, game_session_enc, game_uid, game_session_v, game_session_at, game_session_lost, sync_lock, '
  + 'sync_click_at, auto_sync, sync_fails, link_hash, link_until';
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
// Classeur jamais utilisé : aucune synchro, aucun compte du jeu relié, aucune carte, aucune collection.
const UNUSED = `SELECT 1 AS unused FROM users AS u WHERE u.id = ?1 AND u.fetched_at IS NULL AND u.game_session_enc IS NULL
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

// Utilisateur de la requête (en-tête X-Classeur-Key), ou 401. `chat` (GET /api/me) : numéro du dernier message du chat
// lu dans la même requête (last_chat_id ; MAX sur la clé primaire : une ligne lue). `market` (GET /api/me) : heure de la
// dernière lecture du marché (market_at : lecture du marché reçue ou essai fini, réussi ou non ; une ligne lue par la clé
// primaire de market).
export async function authenticate(request, env, { chat = false, market = false } = {}) {
  const key = (request.headers.get('x-classeur-key') || '').trim();
  if (!key) throw new HttpError(401, 'Clé absente : ouvre ton lien personnel du classeur.');
  const extra = (chat ? ', (SELECT MAX(id) FROM chat_messages) AS last_chat_id' : '')
    + (market ? ", (SELECT max(coalesce(m.live_at, ''), coalesce(CASE WHEN json_valid(m.attempt) THEN json_extract(m.attempt, '$.end') END, '')) FROM market AS m WHERE m.user_id = users.id) AS market_at" : '');
  const user = await env.DB.prepare(`SELECT ${USER_COLUMNS}${extra} FROM users WHERE key_hash = ?1`)
    .bind(await sha256Hex(key))
    .first();
  if (!user) throw new HttpError(401, 'Clé inconnue : ce lien ne correspond à aucun compte.');
  return user;
}

export function publicUser(user) {
  return { id: user.id, name: user.name, created_at: user.created_at, pseudo: user.game_pseudo || null };
}

// État de la session du jeu reliée, rendu par GET /api/me et POST /api/session : linked (session utilisable), lost
// (pourquoi elle ne l'est plus), at (liaison ou dernier renouvellement), auto_sync (réglage « Synchro automatique »),
// paused (trop d'échecs d'affilée des lectures automatiques), fails, checked_at (dernière vérification légère), full_at
// (dernière lecture vérifiée complète).
export function sessionView(user) {
  const state = syncState(user);
  const fails = user.sync_fails || 0;
  return {
    linked: !!user.game_session_enc && !user.game_session_lost,
    lost: user.game_session_lost || null,
    at: user.game_session_at || null,
    auto_sync: !!user.auto_sync,
    paused: fails >= FAILS_MAX,
    fails,
    checked_at: state?.checked_at ?? null,
    full_at: state?.full_at ?? null,
  };
}

// GET /api/me
export async function getMe(env, user) {
  // Nombre de cartes : gardé par chaque lecture de la collection (sync_state.count), sans relire les cartes (D1 compte
  // une ligne lue par carte). Classeur d'avant ce compteur : compté une fois, puis gardé dans sync_state, seulement s'il
  // n'a pas changé depuis la lecture du compte (une lecture finie entre-temps a écrit le sien) — la page relit
  // GET /api/me toutes les minutes.
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
    cards_rev: user.cards_rev, // change à chaque changement de la liste des cartes : la page relit alors ?since=…
    new_ids: raw(user.new_ids || '[]'), // texte JSON écrit par la finalisation d'une lecture
    prefs: raw(user.prefs || '{}'), // objet JSON rangé tel quel par PATCH /api/me
    shared: !!user.shared, // montre ses cartes aux autres membres (partage entre membres, members.js)
    shared_targets: !!(user.shared && user.shared_targets), // et ses collections à compléter (réglage à part)
    // son identifiant public tant qu'il partage (celui que les autres voient) : la page se propose après « #u: » du chat
    public_id: user.shared ? user.public_id || null : null,
    last_chat_id: user.last_chat_id ?? 0, // dernier message du chat (supprimé ou non) : la page en déduit le badge des non-lus
    market_at: user.market_at || null, // dernière lecture du marché (market.js) : la page relit alors l'onglet « Marché »
    // Dernière ligne du journal des synchros ({at, kind, via, result, message}, synclog.js), ou null.
    last_sync: user.last_sync ? raw(user.last_sync) : null,
    session: sessionView(user),
  };
}

// PATCH /api/me {name?, pseudo?, prefs?, shared?, shared_targets?, auto_sync?} : `auto_sync` (booléen) permet ou coupe les
// lectures automatiques de la collection et du marché ; `shared` (booléen) active ou coupe le partage entre membres,
// `shared_targets` (booléen, seulement avec `shared`) celui des collections à compléter (members.js) ; `prefs` (objet JSON de 4 Ko au plus) remplace les préférences entières ; son
// contenu n'est pas vérifié (l'interface y range ce qu'elle veut).
export async function patchMe(env, user, body) {
  const hasName = Object.hasOwn(body, 'name');
  const hasPrefs = Object.hasOwn(body, 'prefs');
  const sharing = patchSharing(user, body);
  const hasShared = sharing.touched;
  const hasAuto = Object.hasOwn(body, 'auto_sync');
  if (hasAuto && typeof body.auto_sync !== 'boolean') throw new HttpError(400, '« auto_sync » vaut true ou false.');
  const hasPseudo = Object.hasOwn(body, 'pseudo');
  if (!hasName && !hasPrefs && !hasShared && !hasAuto && !hasPseudo) throw new HttpError(400, 'Rien à modifier : indique un nom, un pseudo, des préférences, le partage ou la synchro automatique.');
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
  const autoSync = hasAuto ? (body.auto_sync ? 1 : 0) : user.auto_sync ? 1 : 0;
  await env.DB.prepare('UPDATE users SET name = ?1, prefs = ?2, shared = ?3, public_id = ?4, shared_targets = ?5, game_pseudo = ?6, auto_sync = ?7 WHERE id = ?8')
    .bind(name, prefs, shared, publicId, sharedTargets, pseudo, autoSync, user.id)
    .run();
  return { user: publicUser({ ...user, name, game_pseudo: pseudo }), prefs: raw(prefs), shared: !!shared, shared_targets: !!sharedTargets,
    public_id: shared ? publicId : null, auto_sync: !!autoSync };
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
    // Marché : sa lecture du marché et ses quotas (market), l'historique de sa valeur, ses compteurs de lectures des fiches
    // (game_reads) ; les cotes (prices), communes et liées à aucun classeur, restent.
    ['cards', 'cards_gone', 'tags', 'targets', 'refresh_staging', 'market', 'value_history', 'sync_log', 'game_reads'].map((t) =>
      db.prepare(`DELETE FROM ${t} WHERE user_id = ?1`).bind(user.id),
    ).concat(eraseChatOf(db, user.id), db.prepare('DELETE FROM users WHERE id = ?1').bind(user.id)),
  );
  return { ok: true };
}
