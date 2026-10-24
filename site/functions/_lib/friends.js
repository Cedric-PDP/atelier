// Amis dans le jeu (2026-10-24) : le jeu n'accepte un échange qu'entre amis. Le classeur lit la liste d'amis du joueur
// sur le site du jeu (GET /api/friends, relevé dans les HAR du 2026-10-22 et du 2026-10-24), en déduit, pour chaque membre qui partage, s'il
// est son ami dans le jeu, et peut envoyer une demande d'ami :
// - au clic (POST /api/friends/request {member}), depuis la fenêtre « Proposer un échange » ;
// - seul, pendant les lectures automatiques de la collection (cron.js), pour un membre qui l'a choisi (case « Demandes
//   d'ami automatiques », users.auto_friend, coupée par défaut) : une demande à chaque autre membre relié au jeu qui n'est
//   ni son ami ni déjà demandé. Une fois par compte visé (friend_requests), jamais d'acceptation, de refus ni de retrait.
// Lecture : la session du membre gardée par le serveur, cookie des pages du jeu refait (trades.js, gameFetch). La liste
// lue est gardée (users.game_friends) : relue au plus toutes les FRIENDS_TTL_MS à l'ouverture de la fenêtre d'échange.

import { HttpError } from './http.js';
import { supaGet } from './game.js';
import { block, siteSession } from './cardmarket.js';
import { gameFetch } from './trades.js';
import { nowIso } from './util.js';

export const FRIENDS_TTL_MS = 60_000;
export const AUTO_PER_PASS = 5; // demandes automatiques par membre et par passe du cron
export const BULK_MAX = 20; // demandes d'un « Ajouter les membres pas encore amis »
export const RETRY_ERROR_MS = 24 * 3600_000; // une demande en échec est retentée après un jour
const AUTO_GAP_MS = 1000;
const PUBLIC_ID = /^[A-Za-z0-9_-]{1,64}$/;
const LIMITED = 'Le jeu limite les actions automatiques : envoie la demande d\'ami dans le jeu, ou réessaie plus tard.';
const UNSURE = "Le jeu n'a pas répondu à la demande d'ami : regarde dans le jeu (Amis) si elle est partie avant de réessayer.";

// Route d'envoi d'une demande d'ami du site du jeu, relevée dans le HAR du 2026-10-24 : POST /api/friends {addressee_id}
// → 201 {friendship:{id, requester_id, addressee_id, status:"pending", …}}. Interrupteur : `known` à false, aucune demande
// ne part plus (clic : 503 « envoie-la dans le jeu » ; cron : rien), si le jeu change sa route.
export const FRIEND_ROUTE = {
  known: true,
  request: (uid) => ({ path: '/api/friends', body: { addressee_id: uid } }),
};

// Membres qui partagent leurs cartes (désignés par leur identifiant public), avec ce qui les désigne dans le jeu.
const MEMBERS = `SELECT u.public_id AS id, u.name, u.game_uid, u.game_pseudo FROM users AS u
  WHERE u.shared = 1 AND u.public_id IS NOT NULL AND u.id <> ?1`;
const MEMBERS_ORDER = ' ORDER BY u.created_at, u.public_id';

const fold = (s) => String(s || '').toLowerCase();

// Réponse de GET /api/friends du jeu → [{uid, name, st, out}] vus de `uid` : st = accepted | pending | autre état du jeu,
// out = c'est lui qui a demandé. null si la forme est inattendue.
export function parseFriends(data, uid) {
  if (!data || !Array.isArray(data.friendships)) return null;
  const out = [];
  for (const f of data.friendships) {
    if (!f || typeof f !== 'object') continue;
    const mine = f.requester_id === uid;
    if (!mine && f.addressee_id !== uid) continue;
    const other = mine ? f.addressee : f.requester;
    const id = mine ? f.addressee_id : f.requester_id;
    if (typeof id !== 'string') continue;
    out.push({ uid: id, name: other && typeof other.username === 'string' ? other.username.slice(0, 40) : null,
      st: typeof f.status === 'string' ? f.status.slice(0, 20) : 'pending', out: mine });
  }
  return out;
}

// Où en est-on avec ce joueur du jeu (uid, sinon pseudo) ? friends | sent (demande envoyée, en attente) | received (il
// t'a demandé) | none | unknown (rien pour le désigner).
export function statusWith(list, uid, pseudo) {
  if (!uid && !pseudo) return 'unknown';
  const f = list.find((x) => (uid && x.uid === uid) || (pseudo && x.name && fold(x.name) === fold(pseudo)));
  if (!f) return 'none';
  if (f.st === 'accepted') return 'friends';
  if (f.st === 'pending') return f.out ? 'sent' : 'received';
  return 'none'; // refusée, retirée… : une nouvelle demande est possible
}

// Liste d'amis gardée : {at, list} ou null.
export function storedFriends(user) {
  try {
    const v = JSON.parse(user.game_friends || 'null');
    return v && Array.isArray(v.list) ? v : null;
  } catch {
    return null;
  }
}

// Lit la liste d'amis du joueur sur le site du jeu et la garde. Erreurs : 429 limited, 502.
export async function readFriends(env, user, s) {
  let res;
  try {
    res = await gameFetch(env, user, s, '/api/friends', { headers: { referer: 'https://www.wiki-masters.com/friends' } });
  } catch {
    throw new HttpError(502, "Le site du jeu ne répond pas : liste d'amis indisponible.");
  }
  const data = await res.json().catch(() => null);
  if (res.status === 429 || (data && data.code === 'automation_limit')) throw new HttpError(429, LIMITED, { limited: true });
  if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
    throw new HttpError(502, `Le site du jeu a refusé ta session (${res.status}) : liste d'amis indisponible.`);
  }
  if (!res.ok) throw new HttpError(502, `Le site du jeu a refusé la lecture de ta liste d'amis (${res.status}).`);
  const list = parseFriends(data, s.uid);
  if (!list) throw new HttpError(502, "Réponse inattendue du jeu (liste d'amis) : le jeu a peut-être changé.");
  const kept = { at: nowIso(), list };
  await env.DB.prepare('UPDATE users SET game_friends = ?1 WHERE id = ?2').bind(JSON.stringify(kept), user.id).run();
  return kept;
}

// Envoie une demande d'ami au compte `uid` (une seule tentative : une écriture ne se rejoue pas). Erreurs : 429 limited,
// 502, 409 (refus du jeu, avec son message).
async function sendRequest(env, user, s, uid) {
  const { path, body } = FRIEND_ROUTE.request(uid);
  let res;
  try {
    res = await gameFetch(env, user, s, path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', referer: 'https://www.wiki-masters.com/friends' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new HttpError(502, UNSURE);
  }
  const data = await res.json().catch(() => null);
  if (res.status === 429 || (data && data.code === 'automation_limit')) throw new HttpError(429, LIMITED, { limited: true });
  if (res.status >= 500) throw new HttpError(502, UNSURE);
  if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
    throw new HttpError(502, `Le jeu a refusé ta session pour la demande d'ami (${res.status}) : envoie-la dans le jeu.`);
  }
  if (!res.ok) {
    const said = data && typeof (data.error || data.message) === 'string' ? String(data.error || data.message).slice(0, 300) : '';
    throw new HttpError(409, `Le jeu a refusé la demande d'ami${said ? ` : « ${said} »` : ` (${res.status})`}.`);
  }
}

const noteRequest = (db, userId, uid, via, result) => db.prepare(
  `INSERT INTO friend_requests (user_id, target_uid, at, via, result) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (user_id, target_uid) DO UPDATE SET at = excluded.at, via = excluded.via, result = excluded.result`,
).bind(userId, uid, nowIso(), via, result).run();

const linkedOf = (user) => !!user.game_session_enc && !user.game_session_lost;

// GET /api/friends[?fresh=1] → {linked, at, members: {<identifiant public>: friends|sent|received|none|unknown},
// list: [{id, name, pseudo, st}] (les mêmes, avec leur prénom et leur pseudo, dans l'ordre d'arrivée), can_request,
// auto_friend, error?}. Liste relue sur le site du jeu si elle a plus de FRIENDS_TTL_MS (fresh : toujours) ;
// une lecture impossible garde l'ancienne (error dit pourquoi), ou rend unknown pour tous.
export async function listFriends(env, user, _body, request) {
  const db = env.DB;
  const fresh = new URL(request.url).searchParams.get('fresh') === '1';
  const { results } = await db.prepare(MEMBERS + MEMBERS_ORDER).bind(user.id).all();
  const out = { linked: linkedOf(user), at: null, members: {}, list: [], can_request: FRIEND_ROUTE.known, auto_friend: !!user.auto_friend };
  let kept = storedFriends(user);
  if (out.linked && (fresh || !kept || Date.now() - Date.parse(kept.at) >= FRIENDS_TTL_MS)) {
    try {
      const s = await siteSession(env, user, 'site');
      if (!s.uid) throw new HttpError(401, 'Relie à nouveau ton compte du jeu (onglet « Synchro ») : il manque ton identifiant de joueur.');
      kept = await readFriends(env, user, s);
    } catch (err) {
      if (err && err.extra && err.extra.limited) await block(db, user.id).catch(() => {});
      out.error = err && err.message ? String(err.message) : 'Liste d\'amis du jeu illisible.';
    }
  }
  if (kept && out.linked) out.at = kept.at;
  for (const m of results) {
    const st = kept && out.linked ? statusWith(kept.list, m.game_uid, m.game_pseudo) : 'unknown';
    out.members[m.id] = st;
    out.list.push({ id: m.id, name: m.name || null, pseudo: m.game_pseudo || null, st });
  }
  return out;
}

// Compte du jeu d'un membre : celui qu'il a relié, sinon celui de son pseudo (profiles du jeu). null si inconnu.
async function uidOf(env, user, s, member) {
  if (member.game_uid) return member.game_uid;
  if (!member.game_pseudo) return null;
  const { rows } = await supaGet(env, user, s, `profiles?select=id&username=eq.${encodeURIComponent(member.game_pseudo)}&limit=2`);
  return rows.length === 1 && typeof rows[0].id === 'string' ? rows[0].id : null;
}

// POST /api/friends/request {member} → {status: sent | friends | received}. Relit d'abord la liste d'amis : rien
// ne part si vous êtes déjà amis ou si une demande est en cours (dans un sens ou dans l'autre).
export async function requestFriend(env, user, body) {
  const db = env.DB;
  const id = typeof body.member === 'string' ? body.member : '';
  if (!PUBLIC_ID.test(id)) throw new HttpError(400, 'Membre inconnu (member).');
  const member = await db.prepare(`${MEMBERS} AND u.public_id = ?2`).bind(user.id, id).first();
  if (!member) throw new HttpError(404, 'Ce membre ne montre pas (ou plus) ses cartes.');
  const name = member.name || 'ce membre';
  if (!linkedOf(user)) throw new HttpError(401, 'Relie d\'abord ton compte du jeu (onglet « Synchro ») : la demande part avec ta session.', { needs_link: true });
  const s = await siteSession(env, user, 'site');
  if (!s.uid) throw new HttpError(401, 'Relie à nouveau ton compte du jeu (onglet « Synchro ») : il manque ton identifiant de joueur.', { needs_link: true });
  try {
    const kept = await readFriends(env, user, s);
    const now = statusWith(kept.list, member.game_uid, member.game_pseudo);
    if (now === 'friends' || now === 'sent' || now === 'received') return { status: now };
    if (!FRIEND_ROUTE.known) {
      throw new HttpError(503, `Le classeur ne sait pas encore envoyer une demande d'ami : envoie-la à ${name} dans le jeu (page Amis).`);
    }
    const uid = await uidOf(env, user, s, member);
    if (!uid) throw new HttpError(409, `${name} n'a ni relié son compte du jeu ni donné son pseudo du jeu : impossible de savoir à qui envoyer la demande.`);
    if (uid === s.uid) throw new HttpError(409, 'Ce membre est relié au même compte du jeu que toi.');
    await sendRequest(env, user, s, uid);
    await noteRequest(db, user.id, uid, 'clic', 'sent');
    await readFriends(env, user, s).catch(() => {}); // la demande apparaît dans la liste gardée
    return { status: 'sent' };
  } catch (err) {
    if (err && err.extra && err.extra.limited) await block(db, user.id).catch(() => {});
    throw err;
  }
}

// POST /api/friends/request-all {members: [identifiants publics]} (1 à BULK_MAX) → {results: [{id, status} | {id, error}],
// limited?} : « Ajouter les membres pas encore amis » (Réglages). Une seule lecture de la liste d'amis, puis une demande
// à chacun de ceux qui ne sont ni amis ni en attente, 1 s entre deux ; une limite du jeu arrête tout (les suivants
// gardent error). status comme POST /api/friends/request.
export async function requestFriends(env, user, body) {
  const db = env.DB;
  const ids = Array.isArray(body.members) ? [...new Set(body.members)] : null;
  if (!ids || !ids.length || ids.length > BULK_MAX || ids.some((x) => typeof x !== 'string' || !PUBLIC_ID.test(x))) {
    throw new HttpError(400, `Membres : une liste de 1 à ${BULK_MAX} identifiants publics (members).`);
  }
  if (!linkedOf(user)) throw new HttpError(401, 'Relie d\'abord ton compte du jeu (onglet « Synchro ») : les demandes partent avec ta session.', { needs_link: true });
  if (!FRIEND_ROUTE.known) throw new HttpError(503, "Le classeur n'envoie pas de demande d'ami pour l'instant : envoie-les dans le jeu (page Amis).");
  const { results: rows } = await db.prepare(`${MEMBERS} AND u.public_id IN (${ids.map((_, i) => `?${i + 2}`).join(',')})`).bind(user.id, ...ids).all();
  const byId = new Map(rows.map((m) => [m.id, m]));
  const s = await siteSession(env, user, 'site');
  if (!s.uid) throw new HttpError(401, 'Relie à nouveau ton compte du jeu (onglet « Synchro ») : il manque ton identifiant de joueur.', { needs_link: true });
  const results = [];
  let limited = false;
  let sent = 0;
  try {
    const kept = await readFriends(env, user, s);
    for (const id of ids) {
      const m = byId.get(id);
      if (!m) { results.push({ id, error: 'Ce membre ne montre pas (ou plus) ses cartes.' }); continue; }
      const name = m.name || 'ce membre';
      if (limited) { results.push({ id, error: 'Pas envoyée : le jeu limite les actions automatiques.' }); continue; }
      const now = statusWith(kept.list, m.game_uid, m.game_pseudo);
      if (now !== 'none' && now !== 'unknown') { results.push({ id, status: now }); continue; }
      try {
        const uid = await uidOf(env, user, s, m);
        if (!uid) throw new HttpError(409, `${name} n'a ni relié son compte du jeu ni donné son pseudo du jeu.`);
        if (uid === s.uid) throw new HttpError(409, 'Ce membre est relié au même compte du jeu que toi.');
        if (kept.list.some((x) => x.uid === uid)) { results.push({ id, status: statusWith(kept.list, uid, null) }); continue; }
        if (sent) await new Promise((r) => setTimeout(r, env.REFRESH_PAUSE_MS !== undefined ? Number(env.REFRESH_PAUSE_MS) : AUTO_GAP_MS));
        await sendRequest(env, user, s, uid);
        await noteRequest(db, user.id, uid, 'clic', 'sent');
        sent++;
        results.push({ id, status: 'sent' });
      } catch (err) {
        if (err && err.extra && err.extra.limited) { limited = true; await block(db, user.id).catch(() => {}); }
        results.push({ id, error: err && err.message ? String(err.message) : 'Échec de la demande.' });
      }
    }
  } catch (err) {
    if (err && err.extra && err.extra.limited) await block(db, user.id).catch(() => {});
    throw err;
  }
  if (sent) await readFriends(env, user, s).catch(() => {}); // les demandes apparaissent dans la liste gardée
  return limited ? { results, limited: true } : { results };
}

// Autres membres reliés au jeu à qui `user` n'a encore rien demandé (ou dont la demande a échoué il y a plus d'un jour).
const CANDIDATES = `SELECT u.game_uid FROM users AS u WHERE u.id <> ?1 AND u.game_uid IS NOT NULL AND u.game_uid <> ?2
  AND NOT EXISTS (SELECT 1 FROM friend_requests AS r WHERE r.user_id = ?1 AND r.target_uid = u.game_uid
    AND (r.result <> 'error' OR r.at > ?3))
  ORDER BY u.created_at, u.id`;

// Pendant une lecture automatique de la collection (cron.js, sous le bail du membre, session fraîche) : pour un membre qui
// a coché « Demandes d'ami automatiques », une demande à chaque autre membre relié qui n'est ni son ami ni déjà demandé,
// AUTO_PER_PASS au plus. Aucun appel au jeu quand il n'y a personne de nouveau. → {sent, known} ; une limite du jeu
// remonte (429 limited) pour arrêter la passe.
export async function autoFriends(env, member, s) {
  const db = env.DB;
  if (!member.auto_friend || !s.uid || !FRIEND_ROUTE.known) return { sent: 0, known: 0 };
  const { results } = await db.prepare(CANDIDATES).bind(member.id, s.uid, new Date(Date.now() - RETRY_ERROR_MS).toISOString()).all();
  if (!results.length) return { sent: 0, known: 0 };
  const kept = await readFriends(env, member, s);
  let sent = 0;
  let known = 0;
  for (const { game_uid: uid } of results) {
    const now = statusWith(kept.list, uid, null);
    if (now !== 'none') {
      await noteRequest(db, member.id, uid, 'auto', now === 'friends' ? 'friends' : 'pending');
      known++;
      continue;
    }
    if (sent >= AUTO_PER_PASS) continue;
    if (sent) await new Promise((r) => setTimeout(r, env.REFRESH_PAUSE_MS !== undefined ? Number(env.REFRESH_PAUSE_MS) : AUTO_GAP_MS));
    try {
      await sendRequest(env, member, s, uid);
      await noteRequest(db, member.id, uid, 'auto', 'sent');
      sent++;
    } catch (err) {
      if (err && err.extra && err.extra.limited) throw err;
      await noteRequest(db, member.id, uid, 'auto', 'error');
      console.error(`demande d'ami automatique : ${err && err.message ? err.message : err}`);
    }
  }
  return { sent, known };
}
