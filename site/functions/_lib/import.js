// Import par morceaux (POST /api/import) et finalisation en SQL, commune avec /api/refresh.
// Limite de calcul des Workers gratuits : JavaScript ne touche jamais plus d'un morceau (500 cartes) ; la
// comparaison avec la collection en place se fait dans D1.

import { HttpError, raw } from './http.js';
import { purgeStaging } from './db.js';
import { MAX_CARDS, MAX_PART_CARDS, checkCard, entryToCard } from './cards.js';
import { nowIso, randomToken } from './util.js';

const MAX_PARTS = 100;

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

// Remplace la collection par celle de la table d'attente, en n'écrivant que les différences, dans une transaction.
// `clear` = requêtes qui vident la table d'attente (passées dans la même transaction).
export async function finalizeImport(db, user, { source, key, stats, clear }) {
  const cte = collectionCte(source);
  const total = await db.prepare(`${cte} SELECT COUNT(DISTINCT card_id) AS n FROM e`).bind(user.id, key).first();
  const count = total ? total.n : 0;
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
         fetched_at = ?3
       WHERE id = ?1 RETURNING new_ids`,
    ).bind(user.id, key, nowIso()),
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

  let cards;
  if (Array.isArray(body.cards)) {
    if (body.cards.length > MAX_PART_CARDS) throw new HttpError(400, `${MAX_PART_CARDS} cartes au plus par morceau.`);
    cards = body.cards.map(checkCard);
  } else if (Array.isArray(body.collection)) {
    if (body.collection.length > MAX_PART_CARDS) throw new HttpError(400, `${MAX_PART_CARDS} cartes au plus par morceau.`);
    cards = [];
    for (const entry of body.collection) {
      const card = entryToCard(entry);
      if (card) cards.push(card);
    }
  } else {
    throw new HttpError(400, 'Il manque les cartes (champ « cards », ou « collection » pour les entrées du jeu).');
  }
  if (body.stats !== undefined && body.stats !== null && (typeof body.stats !== 'object' || Array.isArray(body.stats))) {
    throw new HttpError(400, 'Le champ « stats » doit être un objet.');
  }
  const stats = pickStats(body.stats);

  // Un seul envoi à la fois par utilisateur : un nouvel upload_id remplace l'envoi en cours.
  const now = nowIso();
  const put = 'INSERT OR REPLACE INTO import_staging (user_id, upload_id, part, cards, created_at) VALUES (?1, ?2, ?3, ?4, ?5)';
  await db.batch([
    ...purgeStaging(db),
    db.prepare('DELETE FROM import_staging WHERE user_id = ?1 AND upload_id <> ?2').bind(user.id, uploadId),
    db.prepare(put).bind(user.id, uploadId, part, JSON.stringify(cards), now),
    ...(stats ? [db.prepare(put).bind(user.id, uploadId, -1, JSON.stringify(stats), now)] : []),
  ]);

  const parts = await db.prepare(
    `SELECT COUNT(*) AS n, MAX(part) AS top, SUM(json_array_length(cards)) AS received
     FROM import_staging WHERE user_id = ?1 AND upload_id = ?2 AND part >= 0`,
  )
    .bind(user.id, uploadId)
    .first();
  if (!last) return { ok: true, received: parts.received ?? 0 };

  // Dernier morceau : tous les précédents doivent être là (morceaux envoyés dans l'ordre, le dernier à la fin).
  if (parts.n !== part + 1 || parts.top !== part) {
    throw new HttpError(409, "Import incomplet : des morceaux manquent. Recommence l'envoi depuis le début.");
  }
  const statsRow = await db.prepare(
    'SELECT cards FROM import_staging WHERE user_id = ?1 AND upload_id = ?2 AND part = -1',
  )
    .bind(user.id, uploadId)
    .first();
  return finalizeImport(db, user, {
    source: IMPORT_SOURCE,
    key: uploadId,
    stats: statsRow ? JSON.parse(statsRow.cards) : null,
    clear: [db.prepare('DELETE FROM import_staging WHERE user_id = ?1').bind(user.id)],
  });
}
