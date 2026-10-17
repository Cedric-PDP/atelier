// Journal des synchros (table sync_log) : une ligne par synchro du classeur, réussie ou non, pour comprendre après coup
// ce qui s'est passé. Écrit par le serveur (import du favori, synchro rapide, rafraîchissement par cookie) et, pour ses
// propres échecs avant tout envoi (session du jeu expirée, erreur ou limite de lectures du jeu, réponse inattendue…),
// par le favori (POST /api/sync-log, clé d'import). Lu par la page (GET /api/sync-log, onglet « Mettre à jour »).
// Borné : les LOG_KEEP plus récentes par classeur, LOG_DAYS jours au plus ; une ligne identique à la précédente (même
// type, même résultat, même message, même chemin : « rien de nouveau » toutes les minutes en mode relié, même échec
// répété) met seulement celle-ci à jour (heure, data.repeat, data.first). users.last_sync garde le résumé de la
// dernière, que GET /api/me renvoie sans requête de plus.

import { HttpError } from './http.js';
import { cleanText, nowIso, randomToken } from './util.js';

export const LOG_KEEP = 50;
const LOG_DAYS = 30;
const KINDS = new Set(['full', 'quick']);
// Chemin de la synchro : favori cliqué, favori relié (synchro automatique après une action), script Tampermonkey,
// rafraîchissement par cookie (lancé par la page).
export const VIAS = new Set(['clic', 'relie', 'script', 'cookie']);
// Ce que le favori peut signaler de ses propres échecs (POST /api/sync-log).
const CLIENT_CODES = new Set(['session', 'limit', 'antibot', 'game', 'network', 'timeout', 'format', 'site', 'other']);
const CLIENT_PER_HOUR = 30;

const nat = (v) => Number.isInteger(v) && v >= 0 && v <= 1_000_000_000;

// Texte d'un message : nettoyé, `max` caractères au plus. Ce qui ressemble à un secret (jeton JWT, lien personnel
// « #cle=… », longue suite base64 : clé, cookie) est masqué. Le favori n'envoie que ses propres messages, jamais de jeton
// ni de cookie du jeu ; ce masque n'est qu'une précaution de plus.
const SECRETISH = /eyJ[\w-]{6,}(?:\.[\w-]*)*|#?cle=\S*|[A-Za-z0-9_\-+/=]{32,}/g;
export function cleanMessage(value, max = 300) {
  return cleanText(String(value ?? '')).replace(SECRETISH, '…').slice(0, max);
}

// Chemin de la synchro envoyé par le favori (« via »), sinon null.
export const viaOf = (v) => (typeof v === 'string' && VIAS.has(v) && v !== 'cookie' ? v : null);
// Version du favori (« v »), sinon null : les favoris d'avant le 17 octobre 2026 n'en envoient pas.
export const versionOf = (v) => (Number.isInteger(v) && v > 0 && v < 1000 ? v : null);

// Requêtes qui ajoutent une ligne au journal de userId (à passer dans un lot) : {kind, result, message, data}.
// data : objet JSON (via, nombres, durée, raison…), les champs null ou undefined omis.
export function logStatements(db, userId, { kind, result, message, data = {} }) {
  const at = nowIso();
  const text = cleanMessage(message) || '(sans message)';
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== undefined));
  const via = clean.via ?? null;
  const last = '(SELECT id FROM sync_log WHERE user_id = ?1 ORDER BY id DESC LIMIT 1)';
  // Marque tirée au hasard, posée par le regroupement et retirée aussitôt : la ligne n'est ajoutée que si le regroupement
  // n'a pas eu lieu (deux écritures dans la même milliseconde ne se confondent pas).
  const mark = randomToken(9);
  return [
    // Même ligne que la précédente : seulement son heure et son nombre de répétitions (data.first = heure de la première).
    db.prepare(
      `UPDATE sync_log SET at = ?2, data = json_set(data, '$.repeat', COALESCE(json_extract(data, '$.repeat'), 1) + 1,
         '$.first', COALESCE(json_extract(data, '$.first'), at), '$.mark', ?7)
       WHERE id = ${last} AND kind = ?3 AND result = ?4 AND message = ?5 AND json_extract(data, '$.via') IS ?6`,
    ).bind(userId, at, kind, result, text, via, mark),
    db.prepare(
      `INSERT INTO sync_log (user_id, at, kind, result, message, data) SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE NOT EXISTS (SELECT 1 FROM sync_log WHERE id = ${last} AND json_extract(data, '$.mark') = ?7)`,
    ).bind(userId, at, kind, result, text, JSON.stringify(clean), mark),
    db.prepare(`UPDATE sync_log SET data = json_remove(data, '$.mark') WHERE id = ${last} AND json_extract(data, '$.mark') = ?2`)
      .bind(userId, mark),
    db.prepare(
      `DELETE FROM sync_log WHERE user_id = ?1 AND (at < ?2
         OR id <= (SELECT id FROM sync_log WHERE user_id = ?1 ORDER BY id DESC LIMIT 1 OFFSET ${LOG_KEEP}))`,
    ).bind(userId, new Date(Date.now() - LOG_DAYS * 86400_000).toISOString()),
    db.prepare('UPDATE users SET last_sync = ?2 WHERE id = ?1')
      .bind(userId, JSON.stringify({ at, kind, via, result, message: text })),
  ];
}

// Écrit une ligne du journal ; un échec (base pleine…) est seulement noté dans les journaux du Worker : le journal ne
// doit jamais faire échouer une synchro, ni masquer l'erreur d'origine.
export async function writeLog(db, userId, entry) {
  try {
    await db.batch(logStatements(db, userId, entry));
  } catch (err) {
    console.error(err);
  }
}

// Ligne d'échec pour une erreur levée pendant une synchro : le message rendu au client (HttpError), sinon « Erreur
// interne du serveur » et un extrait de l'erreur (seul le titulaire du classeur le voit).
export function errorEntry(kind, err, data = {}) {
  const known = err instanceof HttpError;
  const detail = !known && err && err.message ? ` (${cleanMessage(err.message, 160)})` : '';
  return {
    kind,
    result: 'error',
    message: known ? err.message : `Erreur interne du serveur${detail}.`,
    data: { ...data, status: known ? err.status : 500 },
  };
}

// GET /api/sync-log (clé principale) : {entries: [{at, kind, result, message, data}]}, de la plus récente à la plus
// ancienne.
export async function listSyncLog(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT at, kind, result, message, data FROM sync_log WHERE user_id = ?1 ORDER BY id DESC LIMIT ${LOG_KEEP}`,
  ).bind(user.id).all();
  return {
    entries: results.map((r) => {
      let data = {};
      try {
        data = JSON.parse(r.data || '{}');
      } catch {
        data = {};
      }
      return { at: r.at, kind: r.kind, result: r.result, message: r.message, data };
    }),
  };
}

// POST /api/sync-log (clé principale ou clé d'import, CORS du jeu ; 2 Ko au plus) {kind, via, code, message, reason?,
// ms?, read?, total?, v?} : un échec vu par le favori lui-même, avant ou pendant sa lecture du jeu (rien n'a été envoyé
// au classeur). kind = phase où il a échoué (full | quick) ; code ∈ CLIENT_CODES (autre valeur : « other ») ; message =
// ce que l'encart du favori a affiché (300 caractères au plus, secrets masqués). CLIENT_PER_HOUR par heure au plus.
export async function reportSync(env, user, body) {
  const db = env.DB;
  if (typeof body.message !== 'string' || !body.message.trim()) throw new HttpError(400, 'Il manque le message (champ « message »).');
  if (body.kind !== undefined && !KINDS.has(body.kind)) throw new HttpError(400, 'Le champ « kind » vaut « full » ou « quick ».');
  for (const f of ['ms', 'read', 'total']) {
    if (body[f] !== undefined && body[f] !== null && !nat(body[f])) throw new HttpError(400, `Le champ « ${f} » doit être un entier positif.`);
  }
  // Débit : les répétitions d'une ligne regroupée comptent aussi.
  const row = await db.prepare(
    `SELECT COALESCE(SUM(COALESCE(json_extract(data, '$.repeat'), 1)), 0) AS n FROM sync_log
     WHERE user_id = ?1 AND at >= ?2 AND json_extract(data, '$.client') = 1`,
  ).bind(user.id, new Date(Date.now() - 3600_000).toISOString()).first();
  if (row && row.n >= CLIENT_PER_HOUR) {
    throw new HttpError(429, 'Trop de signalements du favori cette heure-ci : le journal des synchros les reprendra plus tard.');
  }
  const reason = typeof body.reason === 'string' && /^[a-z_]{1,20}$/.test(body.reason) ? body.reason : null;
  await db.batch(logStatements(db, user.id, {
    kind: body.kind || 'full',
    result: 'error',
    message: body.message,
    data: {
      client: true,
      via: viaOf(body.via) || 'clic',
      code: CLIENT_CODES.has(body.code) ? body.code : 'other',
      reason,
      ms: nat(body.ms) ? body.ms : null,
      read: nat(body.read) ? body.read : null,
      total: nat(body.total) ? body.total : null,
      v: versionOf(body.v),
    },
  }));
  return { ok: true };
}
