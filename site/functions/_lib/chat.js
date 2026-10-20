// Chat : un seul salon pour tous les classeurs du site, visible par tous les membres. Contrat : SPEC.md, « Chat ».
// - Messages en texte brut (500 caractères au plus, retours à la ligne gardés ; jamais de HTML) ; auteur = nom ACTUEL
//   du classeur, lu à chaque lecture (jointure sur users) ; jamais l'id interne du compte (seulement `mine`).
// - Suppression par l'auteur seulement : le texte est vidé aussitôt et la ligne reste comme marque (`deleted`) pour que
//   les pages ouvertes retirent le message à leur relecture suivante. DELETE /api/me fait pareil pour tous ses messages
//   (et oublie l'auteur : user_id = '').
// - Clé principale seulement (le favori, qui ne porte que la clé d'import, n'y a pas accès : routeur).
//
// Coût D1 (gratuit : 5 M de lignes lues et 100 000 écrites par jour pour toute l'instance) :
// - chaque message a une révision `rev` (unique, croissante) donnée à sa création, puis à sa suppression ; une page
//   ouverte sur le chat demande ?after=<rev> toutes les 12 s : index chat_by_rev, seules les lignes changées sont lues
//   (aucune si rien n'a bougé, plus MAX(rev) et MAX(id) : une ligne chacun, optimisation min/max de SQLite) ;
// - GET /api/me (relu toutes les 60 s) n'ajoute que MAX(id) (une ligne, clé primaire) : de quoi afficher le badge ;
// - un envoi écrit le message (3 lignes avec ses deux index) et purge, dans le même lot, ce qui dépasse les 2 000
//   plus récents (le plus ancien, par la clé primaire) ; les limites sont contrôlées dans l'INSERT même (index
//   chat_by_user : 10 lignes au plus pour la minute, 300 pour la journée).

import { HttpError, json } from './http.js';

export const CHAT_MAX_CHARS = 500; // en unités UTF-16, comme le maxlength du champ de la page
export const CHAT_KEEP = 2000; // messages gardés (les plus récents ; marques de suppression comprises)
export const CHAT_PAGE = 100; // messages par lecture
export const CHAT_PER_MINUTE = 10; // par classeur
export const CHAT_PER_DAY = 300; // par classeur, sur 24 h glissantes
export const CHAT_ROOM_PER_DAY = 1000; // pour tout le salon, sur 24 h glissantes (garde le quota d'écritures de D1)

// Caractères de contrôle (sauf le retour à la ligne) et forçages de sens d'écriture (texte retourné pour tromper) :
// retirés. Les jointures d'emoji (U+200D) restent.
const CONTROLS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;
// Lien personnel d'un classeur (#cle=<clé>) : il ouvre le classeur de qui l'envoie, à qui le lit.
const PERSONAL_LINK = /#cle=[A-Za-z0-9_-]{20,}/;
const NEEDS_NFC = /\p{M}/u;

// Texte d'un message : fins de ligne unifiées, tabulations en espaces, contrôles retirés, espaces de fin de ligne
// retirés, trois lignes vides ou plus réduites à une, bords retirés. 1 à 500 caractères.
export function cleanMessage(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Le message doit être un texte.');
  if (value.length > CHAT_MAX_CHARS * 4) throw new HttpError(400, `Message trop long : ${CHAT_MAX_CHARS} caractères au plus.`);
  let text = value.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(CONTROLS, '');
  if (NEEDS_NFC.test(text)) text = text.normalize('NFC');
  text = text.replace(/[  ]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new HttpError(400, 'Message vide : écris quelque chose avant d\'envoyer.');
  if (text.length > CHAT_MAX_CHARS) throw new HttpError(400, `Message trop long : ${CHAT_MAX_CHARS} caractères au plus (il en fait ${text.length}).`);
  if (PERSONAL_LINK.test(text)) {
    throw new HttpError(400, "Ce message contient un lien personnel de classeur (#cle=…) : il ouvrirait ton classeur à tous ceux qui le liraient. Retire-le avant d'envoyer.");
  }
  return text;
}

const COLUMNS = 'm.id, m.rev, m.deleted, m.text, m.created_at, (m.user_id = ?1) AS mine, u.name AS author';
const FROM = 'chat_messages AS m LEFT JOIN users AS u ON u.id = m.user_id';
// Les plus récents (sans `before`) ou ceux d'avant un message (`before`), du plus récent au plus ancien ; marques de
// suppression sautées. Une ligne de plus que la page dit s'il en reste de plus anciens.
const LATEST = `SELECT ${COLUMNS} FROM ${FROM} WHERE m.deleted = 0 ORDER BY m.id DESC LIMIT ?2`;
const BEFORE = `SELECT ${COLUMNS} FROM ${FROM} WHERE m.deleted = 0 AND m.id < ?3 ORDER BY m.id DESC LIMIT ?2`;
// Ce qui a changé depuis une révision (messages nouveaux et supprimés), par l'index chat_by_rev.
const AFTER = `SELECT ${COLUMNS} FROM ${FROM} WHERE m.rev > ?3 ORDER BY m.rev LIMIT ?2`;
// Dernière révision et dernier numéro : deux sous-requêtes (une seule fonction MAX chacune), une ligne lue chacune.
const TOP = 'SELECT (SELECT MAX(rev) FROM chat_messages) AS rev, (SELECT MAX(id) FROM chat_messages) AS last_id';

// Envoi : le message n'est écrit que si les trois limites le permettent (contrôle et écriture dans la même requête :
// deux envois simultanés ne passent pas tous deux au-delà). Limite du salon : le 1 000e message le plus récent
// (par numéro) a-t-il moins de 24 h ? Une ligne lue, par la clé primaire.
const INSERT = `INSERT INTO chat_messages (user_id, text, created_at, deleted, rev)
  SELECT ?1, ?2, ?3, 0, COALESCE((SELECT MAX(rev) FROM chat_messages), 0) + 1
  WHERE (SELECT COUNT(*) FROM (SELECT 1 FROM chat_messages WHERE user_id = ?1 AND created_at > ?4 LIMIT ?5)) < ?5
    AND (SELECT COUNT(*) FROM (SELECT 1 FROM chat_messages WHERE user_id = ?1 AND created_at > ?6 LIMIT ?7)) < ?7
    AND COALESCE((SELECT created_at FROM chat_messages WHERE id <= (SELECT MAX(id) FROM chat_messages) - ?8 ORDER BY id DESC LIMIT 1), '') <= ?6
  RETURNING id, created_at`;
// Purge : au-delà des 2 000 plus récents (par numéro). Les numéros ne sont jamais réutilisés (le plus récent n'est
// jamais effacé), donc au plus 2 000 lignes restent.
const PURGE = 'DELETE FROM chat_messages WHERE id <= (SELECT MAX(id) FROM chat_messages) - ?1';
// Envoi refusé : quelle limite, et dans combien de temps elle se lève.
const LIMITS = `SELECT
  (SELECT COUNT(*) FROM (SELECT 1 FROM chat_messages WHERE user_id = ?1 AND created_at > ?2 LIMIT ?3)) AS minute,
  (SELECT MIN(created_at) FROM chat_messages WHERE user_id = ?1 AND created_at > ?2) AS minute_from,
  (SELECT COUNT(*) FROM (SELECT 1 FROM chat_messages WHERE user_id = ?1 AND created_at > ?4 LIMIT ?5)) AS day,
  (SELECT MIN(created_at) FROM chat_messages WHERE user_id = ?1 AND created_at > ?4) AS day_from,
  (SELECT created_at FROM chat_messages WHERE id <= (SELECT MAX(id) FROM chat_messages) - ?6 ORDER BY id DESC LIMIT 1) AS room_from`;

// Suppression d'un message par son auteur : texte vidé, nouvelle révision (les pages ouvertes le retirent).
const DELETE_OWN = `UPDATE chat_messages SET text = '', deleted = 1, rev = (SELECT MAX(rev) FROM chat_messages) + 1
  WHERE id = ?1 AND user_id = ?2 AND deleted = 0`;

// DELETE /api/me : tous ses messages vidés et sans auteur ; ceux qui ne l'étaient pas déjà reçoivent une révision
// nouvelle et unique (max + numéro), pour disparaître aussi des pages ouvertes.
export function eraseChatOf(db, userId) {
  return db.prepare(`UPDATE chat_messages SET text = '', user_id = '',
      rev = CASE WHEN deleted = 0 THEN (SELECT MAX(rev) FROM chat_messages) + id ELSE rev END, deleted = 1
    WHERE user_id = ?1`).bind(userId);
}

const message = (r) => ({ id: r.id, author: r.author ?? null, mine: !!r.mine, text: r.text, created_at: r.created_at });
const INT = /^\d{1,15}$/;
function intParam(params, name) {
  const v = params.get(name);
  if (v === null) return null;
  if (!INT.test(v)) throw new HttpError(400, `${name} doit être un entier positif.`);
  return Number(v);
}

// GET /api/chat : les 100 plus récents (`{messages, rev, last_id, older}`, du plus ancien au plus récent ; `rev` =
// curseur de la lecture suivante, `older` = il y en a de plus anciens) ; ?before=<id> : les 100 d'avant ce message
// (`{messages, older}`) ; ?after=<rev> : ce qui a changé depuis (`{messages, deleted:[id…], rev, last_id, more}` ;
// `more` = plus de 100 changements, `rev` = celle du dernier rendu ; `{reset:true, rev, last_id}` si la révision est
// inconnue : base recréée, tout relire).
export async function listChat(env, user, _body, request) {
  const params = new URL(request.url).searchParams;
  const after = intParam(params, 'after');
  const before = intParam(params, 'before');
  if (after !== null && before !== null) throw new HttpError(400, 'after ou before, pas les deux.');
  const db = env.DB;
  if (before !== null) {
    const { results } = await db.prepare(BEFORE).bind(user.id, CHAT_PAGE + 1, before).all();
    return { messages: results.slice(0, CHAT_PAGE).reverse().map(message), older: results.length > CHAT_PAGE };
  }
  // Curseur et messages dans la même transaction : un changement fait entre les deux revient à la lecture suivante.
  const [top, page] = await db.batch([
    db.prepare(TOP),
    after === null ? db.prepare(LATEST).bind(user.id, CHAT_PAGE + 1) : db.prepare(AFTER).bind(user.id, CHAT_PAGE + 1, after),
  ]);
  const head = top.results[0] || {};
  const rev = head.rev ?? 0;
  const lastId = head.last_id ?? 0;
  const rows = page.results;
  if (after === null) {
    return { messages: rows.slice(0, CHAT_PAGE).reverse().map(message), rev, last_id: lastId, older: rows.length > CHAT_PAGE };
  }
  if (after > rev) return { reset: true, rev, last_id: lastId };
  const more = rows.length > CHAT_PAGE;
  const kept = rows.slice(0, CHAT_PAGE);
  return {
    messages: kept.filter((r) => !r.deleted).map(message),
    deleted: kept.filter((r) => r.deleted).map((r) => r.id),
    rev: more ? kept[kept.length - 1].rev : rev,
    last_id: lastId,
    more,
  };
}

// POST /api/chat {text} → 201 {message} ; 400 (texte, lien personnel, classeur sans prénom), 429 (limites).
export async function postChat(env, user, body) {
  const text = cleanMessage(body.text);
  if (!user.name) {
    throw new HttpError(400, "Donne d'abord un prénom à ton classeur (Réglages, « Ton prénom ») : c'est lui que les autres membres verront.");
  }
  const now = Date.now();
  const at = new Date(now).toISOString();
  const minute = new Date(now - 60_000).toISOString();
  const day = new Date(now - 86_400_000).toISOString();
  const db = env.DB;
  const [ins] = await db.batch([
    db.prepare(INSERT).bind(user.id, text, at, minute, CHAT_PER_MINUTE, day, CHAT_PER_DAY, CHAT_ROOM_PER_DAY - 1),
    db.prepare(PURGE).bind(CHAT_KEEP),
  ]);
  const row = ins.results[0];
  if (!row) throw await limitError(db, user, now, minute, day);
  return json({ message: { id: row.id, author: user.name, mine: true, text, created_at: row.created_at } }, 201);
}

async function limitError(db, user, now, minute, day) {
  const l = await db.prepare(LIMITS).bind(user.id, minute, CHAT_PER_MINUTE, day, CHAT_PER_DAY, CHAT_ROOM_PER_DAY - 1).first() || {};
  const wait = (from, span) => Math.max(1, Math.ceil((Date.parse(from) + span - now) / 1000));
  if (l.minute >= CHAT_PER_MINUTE) {
    const s = wait(l.minute_from, 60_000);
    return new HttpError(429, `Doucement : ${CHAT_PER_MINUTE} messages par minute au plus. Réessaie dans ${s} s.`, { retry_after: s });
  }
  if (l.day >= CHAT_PER_DAY) {
    return new HttpError(429, `Tu as envoyé ${CHAT_PER_DAY} messages en 24 heures : c'est la limite par classeur. Réessaie plus tard.`, { retry_after: wait(l.day_from, 86_400_000) });
  }
  if (l.room_from && l.room_from > day) {
    return new HttpError(429, `Le chat a reçu ${CHAT_ROOM_PER_DAY.toLocaleString('fr-FR')} messages en 24 heures, sa limite (pour rester dans le quota gratuit de la base) : réessaie plus tard.`,
      { retry_after: wait(l.room_from, 86_400_000) });
  }
  // Plus de limite atteinte entre-temps (des messages ont vieilli pendant la requête) : on peut réessayer.
  return new HttpError(429, 'Envoi refusé un instant : réessaie.', { retry_after: 1 });
}

// GET /api/chat/last (sans clé) → {last_at} : heure du dernier message d'un membre (null sans message), rien d'autre (ni
// texte, ni auteur, ni numéro). Sert à l'outil de publication des nouveautés (skill « publier ») : une annonce du chat
// (nouveautes.json) plus récente que lui est la dernière chose du fil. Lu par la clé primaire en partant de la fin
// (marques de suppression sautées).
export async function lastChat(env) {
  const row = await env.DB.prepare('SELECT created_at FROM chat_messages WHERE deleted = 0 ORDER BY id DESC LIMIT 1').first();
  return { last_at: row ? row.created_at : null };
}

// DELETE /api/chat/<id> : par son auteur seulement (403 sinon, 404 s'il n'existe plus). Déjà supprimé par lui : ok.
export async function deleteChat(env, user, _body, request) {
  const m = new URL(request.url).pathname.match(/\/chat\/(\d{1,15})\/?$/);
  if (!m) throw new HttpError(404, "Ce point d'accès n'existe pas.");
  const id = Number(m[1]);
  const db = env.DB;
  const res = await db.prepare(DELETE_OWN).bind(id, user.id).run();
  if (res.meta.changes) return { ok: true };
  const row = await db.prepare('SELECT user_id, deleted FROM chat_messages WHERE id = ?1').bind(id).first();
  if (row && row.user_id === user.id) return { ok: true }; // déjà supprimé (double clic, autre onglet)
  if (!row || row.deleted) throw new HttpError(404, "Ce message n'existe plus.");
  throw new HttpError(403, 'Tu ne peux supprimer que tes propres messages.');
}
