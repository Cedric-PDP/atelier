// Import par morceaux (POST /api/import) et finalisation en SQL, commune avec /api/refresh.
// Limite de calcul des Workers gratuits : JavaScript ne touche jamais plus d'un morceau (500 cartes) ; la
// comparaison avec la collection en place se fait dans D1.

import { HttpError, raw } from './http.js';
import { purgeStaging } from './db.js';
import { MAX_CARDS, MAX_PART_CARDS, checkCard, entryToCard, isDate } from './cards.js';
import { byteLength, nowIso, randomToken } from './util.js';

// Quotas d'un envoi en attente (D1 gratuit : 500 Mo en tout, 100 000 lignes écrites par jour).
const MAX_PARTS = 40;
// 8 Mo : une carte réelle pèse ~370 octets en forme compacte, donc ~20 000 cartes (la limite de la collection).
const MAX_STAGING_BYTES = 8 * 1024 * 1024;

// Collection à importer, recalculée en SQL à partir de la table d'attente (`source` : requête qui rend une colonne
// `j` = tableau JSON de cartes partielles ; paramètres ?1 = user_id, ?2 = clé de l'envoi).
// e : une ligne par carte partielle ; d : exemplaires dédoublonnés (eid) ; g : une Carte par card_id, en JSON.
function collectionCte(source) {
  return `WITH st AS (${source}),
  e AS (
    SELECT json_extract(j.value, '$.id') AS card_id, json_extract(j.value, '$.eid') AS eid, j.value AS v
    FROM st, json_each(st.j) AS j
  ),
  d AS (
    SELECT card_id, v FROM e WHERE eid IS NULL
    UNION ALL
    SELECT card_id, v FROM e WHERE eid IS NOT NULL GROUP BY eid
  ),
  g AS (
    SELECT card_id, json_object(
      'id', card_id,
      'title', MAX(json_extract(v, '$.title')),
      'rarity', MAX(json_extract(v, '$.rarity')),
      'atk', MAX(json_extract(v, '$.atk')),
      'def', MAX(json_extract(v, '$.def')),
      'quality', MAX(json_extract(v, '$.quality')),
      'pageviews', MAX(json_extract(v, '$.pageviews')),
      'category', MAX(json_extract(v, '$.category')),
      'image', MAX(json_extract(v, '$.image')),
      'url', MAX(json_extract(v, '$.url')),
      'count', SUM(json_extract(v, '$.count')),
      'shiny', json(CASE WHEN MAX(json_extract(v, '$.shiny')) THEN 'true' ELSE 'false' END),
      'starred', json(CASE WHEN MAX(json_extract(v, '$.starred')) THEN 'true' ELSE 'false' END),
      'obtained_at', MIN(json_extract(v, '$.obtained_at'))
    ) AS data
    FROM d GROUP BY card_id
  )`;
}

export const IMPORT_SOURCE =
  'SELECT cards AS j FROM import_staging WHERE user_id = ?1 AND upload_id = ?2 AND part >= 0';
export const REFRESH_SOURCE = 'SELECT entries AS j FROM refresh_staging WHERE user_id = ?1 AND page >= ?2';
// Nouveautés d'une synchro rapide : ?2 = le tableau JSON des cartes partielles lui-même.
const DELTA_SOURCE = 'SELECT ?2 AS j';

// ---------------------------------------------------------------- synchro rapide (seulement les nouveautés)
// users.sync_state (JSON) : {stats, last_at, full_at} = compteurs du jeu à la dernière synchro, obtained_at du plus
// récent exemplaire lu, date de la dernière lecture complète. Le favori (ou /api/refresh) lit alors la collection
// triée du plus récent au plus ancien (sort=added) et s'arrête à last_at. Les nouveautés ne sont ajoutées que si
// elles expliquent à elles seules l'évolution des compteurs du jeu : une carte partie entre-temps (vente, enchère,
// échange, défausse) ou un exemplaire ajouté à une carte déjà là fait échouer ce contrôle → relecture complète.
const FULL_EVERY_MS = 7 * 86400_000; // une lecture complète au moins une fois par semaine

export function syncState(user) {
  try {
    const s = JSON.parse(user.sync_state || 'null');
    return s && typeof s === 'object' && !Array.isArray(s) ? s : null;
  } catch {
    return null;
  }
}

const countsOk = (s) => !!s && Number.isInteger(s.total) && Number.isInteger(s.totalUnique);

// Synchro rapide possible : une lecture complète récente, avec les compteurs du jeu et la date du dernier exemplaire.
export function quickSyncAllowed(state) {
  if (!state || !countsOk(state.stats) || !isDate(state.last_at) || !isDate(state.full_at)) return false;
  const age = Date.now() - Date.parse(state.full_at);
  return age >= 0 && age < FULL_EVERY_MS;
}

// Les nouveautés (JSON de cartes partielles) expliquent-elles l'évolution des compteurs du jeu depuis la dernière
// synchro ? rows / copies = exemplaires lus et leur nombre total (le jeu compte l'un ou l'autre dans `total`).
export async function deltaFits(db, user, { text, stats, rows, copies }) {
  const prev = syncState(user)?.stats;
  if (!countsOk(prev) || !countsOk(stats)) return false;
  const fresh = await db.prepare(
    `${collectionCte(DELTA_SOURCE)} SELECT COUNT(*) AS n FROM g WHERE card_id NOT IN (SELECT card_id FROM cards WHERE user_id = ?1)`,
  )
    .bind(user.id, text)
    .first();
  const total = stats.total - prev.total;
  return stats.totalUnique - prev.totalUnique === (fresh ? fresh.n : -1) && (total === rows || total === copies);
}

// Ajoute les nouveautés à la collection en place : carte nouvelle insérée, carte déjà là additionnée (exemplaires,
// brillante ou favorite si l'un l'est, plus ancienne date d'obtention). Rien n'est retiré.
export async function writeDelta(db, user, { text, stats, lastAt, clear = [] }) {
  const state = syncState(user) || {};
  const cte = collectionCte(DELTA_SOURCE);
  const next = JSON.stringify({ stats: pickStats(stats), last_at: lastAt && lastAt > state.last_at ? lastAt : state.last_at, full_at: state.full_at });
  const old = (f) => `json_extract(cards.data, '$.${f}')`;
  const add = (f) => `json_extract(excluded.data, '$.${f}')`;
  const [updated] = await db.batch([
    db.prepare(
      `${cte} UPDATE users SET
         new_ids = (SELECT json_group_array(card_id) FROM g WHERE card_id NOT IN (SELECT card_id FROM cards WHERE user_id = ?1)),
         fetched_at = ?3, sync_state = ?4
       WHERE id = ?1 RETURNING new_ids`,
    ).bind(user.id, text, nowIso(), next),
    db.prepare(
      `${cte} INSERT INTO cards (user_id, card_id, data) SELECT ?1, g.card_id, g.data FROM g WHERE true
       ON CONFLICT (user_id, card_id) DO UPDATE SET data = json_set(cards.data,
         '$.count', ${old('count')} + ${add('count')},
         '$.shiny', json(CASE WHEN ${old('shiny')} OR ${add('shiny')} THEN 'true' ELSE 'false' END),
         '$.starred', json(CASE WHEN ${old('starred')} OR ${add('starred')} THEN 'true' ELSE 'false' END),
         '$.obtained_at', CASE WHEN ${old('obtained_at')} IS NULL OR ${add('obtained_at')} < ${old('obtained_at')}
           THEN ${add('obtained_at')} ELSE ${old('obtained_at')} END)`,
    ).bind(user.id, text),
    ...clear,
  ]);
  const total = await db.prepare('SELECT COUNT(*) AS n FROM cards WHERE user_id = ?1').bind(user.id).first();
  const count = total ? total.n : 0;
  return { count, new_ids: raw(updated.results[0]?.new_ids || '[]'), complete: stats.totalUnique === count, skipped: 0, quick: true };
}

// POST /api/import {mode: 'delta', cards, stats, rows, copies, last_at} (favori) : nouveautés seulement, en un envoi.
// {needs_full: true} (rien d'écrit) quand la synchro rapide n'est pas possible ou que les compteurs ne collent pas.
async function deltaRoute(db, user, body) {
  const list = Array.isArray(body.cards) ? body.cards : null;
  if (!list) throw new HttpError(400, 'Il manque les cartes (champ « cards »).');
  const nat = (v) => Number.isInteger(v) && v >= 0 && v <= 1_000_000;
  if (!nat(body.rows) || !nat(body.copies)) throw new HttpError(400, 'Les champs « rows » et « copies » doivent être des entiers positifs.');
  if (body.last_at !== undefined && body.last_at !== null && !isDate(body.last_at)) throw new HttpError(400, 'Le champ « last_at » doit être une date.');
  const stats = pickStats(body.stats);
  if (list.length > MAX_PART_CARDS || !quickSyncAllowed(syncState(user)) || !countsOk(stats)) return { needs_full: true };
  const cards = [];
  for (const item of list) {
    const card = checkCard(item);
    if (card) cards.push(card);
  }
  if (cards.length !== list.length) return { needs_full: true };
  const text = JSON.stringify(cards);
  if (!(await deltaFits(db, user, { text, stats, rows: body.rows, copies: body.copies }))) return { needs_full: true };
  return writeDelta(db, user, { text, stats, lastAt: body.last_at ?? null });
}

// Remplace la collection par celle de la table d'attente, en n'écrivant que les différences, dans une transaction.
// `clear` = requêtes qui vident la table d'attente (passées dans la même transaction) ; `skipped` = cartes ignorées
// (invalides), recopié dans la réponse.
// lastAt = obtained_at du plus récent exemplaire lu (envoyé par le favori) ; sinon le plus récent de la table d'attente.
export async function finalizeImport(db, user, { source, key, stats, lastAt = null, clear, skipped = 0 }) {
  const cte = collectionCte(source);
  const total = await db.prepare(
    `${cte} SELECT COUNT(DISTINCT card_id) AS n, MAX(json_extract(v, '$.obtained_at')) AS last FROM e`,
  ).bind(user.id, key).first();
  const count = total ? total.n : 0;
  const counts = pickStats(stats);
  const state = JSON.stringify({ stats: countsOk(counts) ? counts : null, last_at: lastAt || total?.last || null, full_at: nowIso() });
  if (count > MAX_CARDS) throw new HttpError(400, 'Collection trop grande : 20 000 cartes au plus.');
  if (count === 0) throw new HttpError(400, "Collection vide : rien n'a été importé (ton classeur est inchangé).");

  const [updated] = await db.batch([
    // new_ids d'abord (avant l'écriture des cartes) : vide au tout premier import.
    db.prepare(
      `${cte} UPDATE users SET
         new_ids = CASE WHEN fetched_at IS NULL THEN '[]' ELSE
           (SELECT json_group_array(card_id) FROM (SELECT DISTINCT card_id FROM e
              WHERE card_id NOT IN (SELECT card_id FROM cards WHERE user_id = ?1)))
         END,
         fetched_at = ?3, sync_state = ?4
       WHERE id = ?1 RETURNING new_ids`,
    ).bind(user.id, key, nowIso(), state),
    // Nouvelles et modifiées.
    db.prepare(
      `${cte} INSERT INTO cards (user_id, card_id, data)
       SELECT ?1, g.card_id, g.data FROM g LEFT JOIN cards AS c ON c.user_id = ?1 AND c.card_id = g.card_id
       WHERE c.data IS NULL OR c.data <> g.data
       ON CONFLICT (user_id, card_id) DO UPDATE SET data = excluded.data`,
    ).bind(user.id, key),
    // Disparues (leurs étiquettes restent).
    db.prepare(
      `${cte} DELETE FROM cards WHERE user_id = ?1 AND card_id NOT IN (SELECT card_id FROM e)`,
    ).bind(user.id, key),
    ...clear,
  ]);

  const unique = stats && typeof stats === 'object' ? stats.totalUnique : undefined;
  return {
    count,
    new_ids: raw(updated.results[0]?.new_ids || '[]'),
    complete: typeof unique === 'number' ? unique === count : null,
    skipped,
  };
}

// Statistiques du jeu gardées : seulement les compteurs (pas tagOptions).
export function pickStats(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  return { total: s.total ?? null, totalUnique: s.totalUnique ?? null, rarityCounts: s.rarityCounts ?? null };
}

// POST /api/import {upload_id, part, last, cards | collection, stats?, source}
// Sans upload_id : import en un seul morceau. `source` est accepté mais pas stocké (aucune colonne prévue).
export async function importRoute(env, user, body) {
  const db = env.DB;
  if (body.mode === 'state') {
    const state = syncState(user);
    return { quick: quickSyncAllowed(state), last_at: state?.last_at ?? null, full_at: state?.full_at ?? null };
  }
  if (body.mode === 'delta') return deltaRoute(db, user, body);
  if (body.mode !== undefined) throw new HttpError(400, "Mode d'import inconnu (« state », « delta » ou rien).");
  if (body.last_at !== undefined && body.last_at !== null && !isDate(body.last_at)) throw new HttpError(400, 'Le champ « last_at » doit être une date.');
  const single = body.upload_id === undefined || body.upload_id === null;
  let uploadId;
  let part = 0;
  let last = true;
  if (single) {
    uploadId = randomToken(9);
  } else {
    uploadId = body.upload_id;
    if (typeof uploadId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(uploadId)) {
      throw new HttpError(400, "Identifiant d'envoi (upload_id) invalide.");
    }
    part = body.part;
    if (!Number.isInteger(part) || part < 0 || part >= MAX_PARTS) {
      throw new HttpError(400, `Numéro de morceau (part) invalide : de 0 à ${MAX_PARTS - 1}.`);
    }
    if (body.last !== undefined && typeof body.last !== 'boolean') throw new HttpError(400, 'Le champ « last » doit être vrai ou faux.');
    last = body.last === true;
  }
  if (body.source !== undefined && typeof body.source !== 'string') {
    throw new HttpError(400, 'Le champ « source » doit être un texte.');
  }

  // Cartes invalides (favori ou entrées brutes, mêmes règles) : ignorées et comptées.
  const list = Array.isArray(body.cards) ? body.cards : Array.isArray(body.collection) ? body.collection : null;
  if (!list) throw new HttpError(400, 'Il manque les cartes (champ « cards », ou « collection » pour les entrées du jeu).');
  if (list.length > MAX_PART_CARDS) throw new HttpError(400, `${MAX_PART_CARDS} cartes au plus par morceau.`);
  const convert = list === body.cards ? checkCard : entryToCard;
  const cards = [];
  for (const item of list) {
    const card = convert(item);
    if (card) cards.push(card);
  }
  const skipped = list.length - cards.length;
  if (body.stats !== undefined && body.stats !== null && (typeof body.stats !== 'object' || Array.isArray(body.stats))) {
    throw new HttpError(400, 'Le champ « stats » doit être un objet.');
  }
  const stats = pickStats(body.stats);

  // Les autres morceaux de cet envoi déjà en attente (celui-ci peut être un nouvel essai : il remplace l'ancien).
  const text = JSON.stringify(cards);
  const others = await db.prepare(
    `SELECT COUNT(*) AS n, MAX(part) AS top, SUM(json_array_length(cards)) AS received, SUM(skipped) AS skipped,
            SUM(length(CAST(cards AS BLOB))) AS bytes
     FROM import_staging WHERE user_id = ?1 AND upload_id = ?2 AND part >= 0 AND part <> ?3`,
  )
    .bind(user.id, uploadId, part)
    .first();
  if ((others.bytes ?? 0) + byteLength(text) > MAX_STAGING_BYTES) {
    throw new HttpError(413, "Envoi trop volumineux : 8 Mo au plus en attente pour un import. Rien n'a été importé.");
  }

  // Un seul envoi à la fois par utilisateur : un nouvel upload_id remplace l'envoi en cours.
  const now = nowIso();
  const put = `INSERT OR REPLACE INTO import_staging (user_id, upload_id, part, cards, skipped, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)`;
  await db.batch([
    ...purgeStaging(db),
    db.prepare('DELETE FROM import_staging WHERE user_id = ?1 AND upload_id <> ?2').bind(user.id, uploadId),
    db.prepare(put).bind(user.id, uploadId, part, text, skipped, now),
    // Morceau -1 : compteurs du jeu et date du plus récent exemplaire lu (favori), relus à la finalisation.
    ...(stats || body.last_at ? [db.prepare(put).bind(user.id, uploadId, -1, JSON.stringify({ ...(stats || {}), last_at: body.last_at ?? null }), 0, now)] : []),
  ]);

  const received = (others.received ?? 0) + cards.length;
  const skippedTotal = (others.skipped ?? 0) + skipped;
  if (!last) return { ok: true, received, skipped: skippedTotal };

  // Dernier morceau : tous les précédents doivent être là (morceaux envoyés dans l'ordre, le dernier à la fin).
  if (others.n !== part || (part > 0 && others.top !== part - 1)) {
    throw new HttpError(409, "Import incomplet : des morceaux manquent. Recommence l'envoi depuis le début.");
  }
  const statsRow = await db.prepare(
    'SELECT cards FROM import_staging WHERE user_id = ?1 AND upload_id = ?2 AND part = -1',
  )
    .bind(user.id, uploadId)
    .first();
  const meta = statsRow ? JSON.parse(statsRow.cards) : null;
  return finalizeImport(db, user, {
    source: IMPORT_SOURCE,
    key: uploadId,
    stats: meta,
    lastAt: meta && isDate(meta.last_at) ? meta.last_at : null,
    clear: [db.prepare('DELETE FROM import_staging WHERE user_id = ?1').bind(user.id)],
    skipped: skippedTotal,
  });
}
