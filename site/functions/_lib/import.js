// Import par morceaux (POST /api/import) et finalisation en SQL, commune avec /api/refresh.
// Limite de calcul des Workers gratuits : JavaScript ne touche jamais plus d'un morceau (500 cartes) ; la
// comparaison avec la collection en place se fait dans D1.

import { HttpError, raw } from './http.js';
import { purgeStaging } from './db.js';
import {
  MAX_CARDS, MAX_DELTA, MAX_PART_CARDS, NEXT_REV, badCard, checkCard, commitRev, entryToCard, isDate, rankSql, rarityOfRankSql,
} from './cards.js';
import { byteLength, nowIso, randomToken } from './util.js';

// Quotas d'un envoi en attente (D1 gratuit : 500 Mo en tout, 100 000 lignes écrites par jour).
const MAX_PARTS = 40;
// 8 Mo : une carte réelle pèse ~370 octets en forme compacte, donc ~20 000 cartes (la limite de la collection).
const MAX_STAGING_BYTES = 8 * 1024 * 1024;

const nat = (v) => Number.isInteger(v) && v >= 0 && v <= 1_000_000;

// Collection à importer, recalculée en SQL à partir de la table d'attente (`source` : requête qui rend une colonne
// `j` = tableau JSON de cartes partielles ; paramètres ?1 = user_id, ?2 = clé de l'envoi).
// e : une ligne par carte partielle (bad = 1 : entrée invalide, comptée mais jamais rangée, cards.js badCard) ;
// d : exemplaires dédoublonnés (eid) ; g : une Carte par card_id, en JSON. Une carte possédée en plusieurs raretés
// garde la plus haute (C < PC < R < SR < UR < L), pas la plus grande en texte.
function collectionCte(source) {
  return `WITH st AS (${source}),
  e AS (
    SELECT json_extract(j.value, '$.id') AS card_id, json_extract(j.value, '$.eid') AS eid,
      json_extract(j.value, '$.bad') AS bad, j.value AS v
    FROM st, json_each(st.j) AS j
  ),
  d AS (
    SELECT card_id, bad, v FROM e WHERE eid IS NULL
    UNION ALL
    SELECT card_id, bad, v FROM e WHERE eid IS NOT NULL GROUP BY eid
  ),
  g AS (
    SELECT card_id, json_object(
      'id', card_id,
      'title', MAX(json_extract(v, '$.title')),
      'rarity', ${rarityOfRankSql(`MAX(${rankSql("json_extract(v, '$.rarity')")})`)},
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
    FROM d WHERE bad IS NULL GROUP BY card_id
  )`;
}

// Cartes retirées (cards_gone, lecture incrémentale). Une carte écrite par l'opération (nouvelle, revenue ou modifiée,
// donc cards.rev = NEXT_REV) n'est plus retirée.
const clearGone = (db, userId) => db.prepare(
  `DELETE FROM cards_gone WHERE user_id = ?1 AND card_id IN (SELECT card_id FROM cards WHERE user_id = ?1 AND rev = ${NEXT_REV})`,
).bind(userId);

// Élagage : seuls les retraits des révisions les plus récentes sont gardés, MAX_DELTA au plus. Un plus ancien ne
// servirait qu'à une lecture incrémentale qui compterait de toute façon plus de MAX_DELTA changements (refusée) ; le
// plancher (cards_gone_floor) monte à la plus récente révision effacée, et GET /api/cards?since=R refuse R < plancher.
const pruneGone = (db, userId) => [
  db.prepare(
    `WITH x AS (SELECT rev FROM cards_gone WHERE user_id = ?1 ORDER BY rev DESC LIMIT 1 OFFSET ${MAX_DELTA})
     UPDATE users SET cards_gone_floor = (SELECT rev FROM x) WHERE id = ?1 AND (SELECT rev FROM x) > cards_gone_floor`,
  ).bind(userId),
  db.prepare('DELETE FROM cards_gone WHERE user_id = ?1 AND rev <= (SELECT cards_gone_floor FROM users WHERE id = ?1)')
    .bind(userId),
];

export const IMPORT_SOURCE =
  'SELECT cards AS j FROM import_staging WHERE user_id = ?1 AND upload_id = ?2 AND part >= 0';
export const REFRESH_SOURCE = 'SELECT entries AS j FROM refresh_staging WHERE user_id = ?1 AND page >= ?2';
// Nouveautés d'une synchro rapide : ?2 = le tableau JSON des cartes partielles lui-même.
const DELTA_SOURCE = 'SELECT ?2 AS j';

// ---------------------------------------------------------------- synchro rapide (seulement les nouveautés)
// users.sync_state (JSON), écrit par chaque import complet et chaque synchro rapide :
//   stats    compteurs du jeu à la dernière synchro ({total, totalUnique, rarityCounts}) ;
//   last_at  obtained_at du plus récent exemplaire lu (valide ou non) ;
//   full_at  date de la dernière lecture complète VÉRIFIÉE complète (null sinon, ou relecture complète demandée :
//            la synchro suivante relit tout) ;
//   unit     ce que compte `total`, appris à chaque lecture complète : 'copies' (exemplaires, Σ count), 'both' (on ne
//            sait pas : autant de lignes que d'exemplaires), 'rows' (lignes, et des piles count > 1 existent : la
//            synchro rapide ne verrait pas un exemplaire ajouté à une pile, elle est coupée), null (ni l'un ni l'autre :
//            lecture incomplète) ;
//   invalid  cartes distinctes ignorées (invalides) à la lecture complète, comptées dans totalUnique ;
//   count    cartes du classeur (lu aussi par GET /api/me, sans compter les lignes) ;
//   tok      jeton tiré à chaque écriture : deux synchros en même temps ne partent pas du même état (writeDelta).
// Le favori (ou /api/refresh) lit la collection triée du plus récent au plus ancien (sort=added) jusqu'à last_at ; les
// nouveautés ne sont ajoutées que si elles expliquent à elles seules les compteurs du jeu (deltaFits), sinon relecture
// complète.
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
const needsFull = (reason) => ({ needs_full: true, reason });

// Synchro rapide possible : une lecture complète vérifiée de moins d'une semaine, avec les compteurs du jeu, la date du
// dernier exemplaire, une unité de `total` utilisable et le nombre de cartes du classeur.
export function quickSyncAllowed(state) {
  if (!state || !countsOk(state.stats) || !isDate(state.last_at) || !isDate(state.full_at)) return false;
  if ((state.unit !== 'copies' && state.unit !== 'both') || !Number.isInteger(state.count) || !Number.isInteger(state.invalid)) return false;
  const age = Date.now() - Date.parse(state.full_at);
  return age >= 0 && age < FULL_EVERY_MS;
}

// Ce que compte `total` du jeu, d'après une lecture complète : rows / copies = exemplaires lus (entrées) et leur
// nombre total (Σ count), invalides compris.
function learnUnit(stats, rows, copies) {
  if (!countsOk(stats) || !Number.isInteger(rows) || !Number.isInteger(copies)) return null;
  if (stats.total === rows && stats.total === copies) return 'both';
  if (stats.total === copies) return 'copies';
  if (stats.total === rows) return 'rows';
  return null;
}

// rarityCounts utilisable : des entiers dont la somme fait `total` (même unité que lui). Sinon (le jeu compterait
// autre chose, des cartes distinctes par exemple), il n'est pas comparé.
function rarityCounts(s) {
  const rc = s && s.rarityCounts;
  if (!rc || typeof rc !== 'object' || Array.isArray(rc)) return null;
  let sum = 0;
  for (const v of Object.values(rc)) {
    if (!Number.isInteger(v) || v < 0) return null;
    sum += v;
  }
  return sum === s.total ? rc : null;
}

// Les nouveautés (cartes partielles valides, et leur texte JSON) expliquent-elles à elles seules les compteurs du jeu ?
// rows = exemplaires lus ; copies (facultatif) = leur nombre total selon le client, qui doit être celui des cartes
// reçues (sinon des entrées ont été écartées). Contrôles, dans l'unité apprise :
//   - total : précédent + exemplaires lus. Le précédent vient d'une lecture complète vérifiée (total = exemplaires
//     lus), puis de synchros contrôlées pareil : c'est donc aussi le total du classeur. 'both' exige en plus une ligne
//     par exemplaire ;
//   - rarityCounts, rareté par rareté (voit un échange 1 contre 1 entre raretés différentes) ;
//   - totalUnique, en absolu : cartes du classeur + cartes nouvelles + cartes invalides connues.
// {fresh} (nombre de cartes nouvelles) si tout colle, sinon {reason}.
export async function deltaFits(db, user, state, { cards, text, stats, rows, copies: sent }) {
  const prev = state.stats;
  if (!countsOk(stats)) return { reason: 'counts' };
  let copies = 0;
  const byRarity = {};
  for (const c of cards) {
    copies += c.count;
    byRarity[c.rarity] = (byRarity[c.rarity] || 0) + c.count;
  }
  if (sent !== undefined && sent !== copies) return { reason: 'invalid' };
  if (rows > copies || (state.unit === 'both' && rows !== copies)) return { reason: 'counts' };
  if (stats.total - prev.total !== copies) return { reason: 'counts' };
  const was = rarityCounts(prev);
  const now = rarityCounts(stats);
  if (was && now) {
    for (const r of new Set([...Object.keys(was), ...Object.keys(now), ...Object.keys(byRarity)])) {
      if ((now[r] || 0) - (was[r] || 0) !== (byRarity[r] || 0)) return { reason: 'counts' };
    }
  }
  // Cartes nouvelles : une recherche par clé par nouveauté (jamais toute la collection).
  const row = await db.prepare(
    `${collectionCte(DELTA_SOURCE)} SELECT COUNT(*) AS n FROM g
     WHERE NOT EXISTS (SELECT 1 FROM cards AS c WHERE c.user_id = ?1 AND c.card_id = g.card_id)`,
  )
    .bind(user.id, text)
    .first();
  const fresh = row ? row.n : -1;
  if (state.count + fresh > MAX_CARDS) return { reason: 'max_cards' };
  if (state.count + fresh + state.invalid !== stats.totalUnique) return { reason: 'counts' };
  return { fresh };
}

// Ajoute les nouveautés à la collection en place : carte nouvelle insérée, carte déjà là additionnée (exemplaires,
// brillante ou favorite si l'un l'est, plus haute rareté, plus ancienne date d'obtention). Rien n'est retiré. Les cartes
// écrites prennent la révision suivante (aucune nouveauté : la révision ne bouge pas).
// Comparer-échanger : l'état n'est remplacé que s'il est encore celui lu à l'authentification (pas d'autre synchro ni
// d'import complet fini entre-temps), et les cartes ne sont écrites que s'il l'a été (même transaction) ; sinon
// {needs_full, reason: 'race'} et rien n'est écrit.
export async function writeDelta(db, user, state, { text, stats, lastAt, fresh, clear = [] }) {
  const cte = collectionCte(DELTA_SOURCE);
  const count = state.count + fresh;
  const next = JSON.stringify({
    ...state,
    stats: pickStats(stats),
    last_at: lastAt && lastAt > state.last_at ? lastAt : state.last_at,
    count,
    tok: randomToken(9),
  });
  const old = (f) => `json_extract(cards.data, '$.${f}')`;
  const add = (f) => `json_extract(excluded.data, '$.${f}')`;
  const [updated] = await db.batch([
    db.prepare(
      `${cte} UPDATE users SET
         new_ids = (SELECT json_group_array(card_id) FROM g
           WHERE NOT EXISTS (SELECT 1 FROM cards AS c WHERE c.user_id = ?1 AND c.card_id = g.card_id)),
         fetched_at = ?3, sync_state = ?4
       WHERE id = ?1 AND sync_state IS ?5 RETURNING new_ids`,
    ).bind(user.id, text, nowIso(), next, user.sync_state),
    db.prepare(
      `${cte} INSERT INTO cards (user_id, card_id, data, rev)
       SELECT ?1, g.card_id, g.data, ${NEXT_REV} FROM g WHERE (SELECT sync_state FROM users WHERE id = ?1) IS ?3
       ON CONFLICT (user_id, card_id) DO UPDATE SET rev = excluded.rev, data = json_set(cards.data,
         '$.rarity', CASE WHEN ${rankSql(add('rarity'))} > ${rankSql(old('rarity'))} THEN ${add('rarity')} ELSE ${old('rarity')} END,
         '$.count', ${old('count')} + ${add('count')},
         '$.shiny', json(CASE WHEN ${old('shiny')} OR ${add('shiny')} THEN 'true' ELSE 'false' END),
         '$.starred', json(CASE WHEN ${old('starred')} OR ${add('starred')} THEN 'true' ELSE 'false' END),
         '$.obtained_at', CASE WHEN ${old('obtained_at')} IS NULL OR ${add('obtained_at')} < ${old('obtained_at')}
           THEN ${add('obtained_at')} ELSE ${old('obtained_at')} END)`,
    ).bind(user.id, text, next),
    clearGone(db, user.id),
    commitRev(db, user.id),
    ...clear,
  ]);
  if (!updated.results.length) return needsFull('race');
  return {
    count,
    new_ids: raw(updated.results[0].new_ids || '[]'),
    complete: count + state.invalid === stats.totalUnique,
    skipped: 0,
    quick: true,
  };
}

// POST /api/import {mode: 'delta', cards, stats, rows, copies, last_at} (favori) : nouveautés seulement, en un envoi.
// {needs_full: true, reason} (rien d'écrit) quand la synchro rapide n'est pas possible : 'state' (pas de lecture
// complète vérifiée récente, ou relecture complète demandée), 'too_many', 'invalid' (carte invalide parmi les
// nouveautés), 'counts' (les compteurs ne collent pas), 'max_cards', 'race' (une autre synchro est passée entre-temps).
async function deltaRoute(db, user, body) {
  const list = Array.isArray(body.cards) ? body.cards : null;
  if (!list) throw new HttpError(400, 'Il manque les cartes (champ « cards »).');
  if (!nat(body.rows) || !nat(body.copies)) throw new HttpError(400, 'Les champs « rows » et « copies » doivent être des entiers positifs.');
  if (body.last_at !== undefined && body.last_at !== null && !isDate(body.last_at)) throw new HttpError(400, 'Le champ « last_at » doit être une date.');
  const state = syncState(user);
  if (!quickSyncAllowed(state)) return needsFull('state');
  if (list.length > MAX_PART_CARDS) return needsFull('too_many');
  if (body.ignored !== undefined && body.ignored !== null && body.ignored !== 0) return needsFull('invalid');
  const cards = [];
  for (const item of list) {
    const card = checkCard(item);
    if (!card) return needsFull('invalid');
    cards.push(card);
  }
  const text = JSON.stringify(cards);
  const stats = pickStats(body.stats);
  const fit = await deltaFits(db, user, state, { cards, text, stats, rows: body.rows, copies: body.copies });
  if (fit.reason) return needsFull(fit.reason);
  return writeDelta(db, user, state, { text, stats, lastAt: body.last_at ?? null, fresh: fit.fresh });
}

// Remplace la collection par celle de la table d'attente, en n'écrivant que les différences, dans une transaction.
// Les cartes ajoutées, revenues ou modifiées et les retraits prennent la révision suivante ; une collection identique
// à celle en place ne fait pas avancer la révision.
// `clear` = requêtes qui vident la table d'attente (passées dans la même transaction) ; `skipped` = entrées ignorées
// (invalides), recopié dans la réponse.
// lastAt = obtained_at du plus récent exemplaire lu (envoyé par le favori) ; sinon le plus récent de la table d'attente,
// entrées invalides comprises. read = {rows, copies} lus par le favori (ses cartes arrivent déjà regroupées) ; sinon
// comptés dans la table d'attente (entrées brutes). ignored = cartes distinctes écartées par le favori.
// complete = cartes rangées + cartes invalides = totalUnique. La synchro rapide n'est armée (full_at) que si la lecture
// est complète et que `total` y correspond aux exemplaires ou aux lignes lus (unité apprise, utilisable).
export async function finalizeImport(db, user, { source, key, stats, lastAt = null, read = null, ignored = 0, clear, skipped = 0 }) {
  const cte = collectionCte(source);
  // Un passage : cartes distinctes (valides ou non ; une entrée sans identifiant de carte n'en est pas une), entrées
  // invalides, plus récent obtained_at, et exemplaires lus (dédoublonnés, d) quand le favori ne les a pas comptés.
  // Cartes rangées / invalides séparées par une seconde requête seulement s'il y a des entrées invalides.
  const sum = await db.prepare(read
    ? `${cte} SELECT COUNT(DISTINCT card_id) AS ids, COUNT(bad) AS nbad, MAX(json_extract(v, '$.obtained_at')) AS last FROM e`
    : `${cte} SELECT COUNT(DISTINCT card_id) AS ids, COUNT(bad) AS nbad, MAX(json_extract(v, '$.obtained_at')) AS last,
         COUNT(*) AS rows, SUM(json_extract(v, '$.count')) AS copies FROM d`,
  ).bind(user.id, key).first();
  const ids = sum ? sum.ids : 0;
  const count = sum && sum.nbad
    ? (await db.prepare(`${cte} SELECT COUNT(DISTINCT card_id) AS n FROM e WHERE bad IS NULL`).bind(user.id, key).first()).n
    : ids;
  if (count > MAX_CARDS) throw new HttpError(400, 'Collection trop grande : 20 000 cartes au plus.');
  if (count === 0) throw new HttpError(400, "Collection vide : rien n'a été importé (ton classeur est inchangé).");
  const counts = pickStats(stats);
  const invalid = ids - count + ignored;
  const unit = learnUnit(counts, read ? read.rows : sum.rows, read ? read.copies : sum.copies);
  const complete = counts && Number.isInteger(counts.totalUnique) ? count + invalid === counts.totalUnique : null;
  const last = lastAt || sum.last || null;
  const armed = complete === true && (unit === 'copies' || unit === 'both') && isDate(last);
  const state = JSON.stringify({
    stats: countsOk(counts) ? counts : null,
    last_at: last,
    full_at: armed ? nowIso() : null,
    unit,
    invalid,
    count,
    tok: randomToken(9),
  });

  const [updated] = await db.batch([
    // new_ids d'abord (avant l'écriture des cartes) : vide au tout premier import.
    db.prepare(
      `${cte} UPDATE users SET
         new_ids = CASE WHEN fetched_at IS NULL THEN '[]' ELSE
           (SELECT json_group_array(card_id) FROM (SELECT DISTINCT card_id FROM e
              WHERE bad IS NULL AND card_id NOT IN (SELECT card_id FROM cards WHERE user_id = ?1)))
         END,
         fetched_at = ?3, sync_state = ?4
       WHERE id = ?1 RETURNING new_ids`,
    ).bind(user.id, key, nowIso(), state),
    // Nouvelles et modifiées.
    db.prepare(
      `${cte} INSERT INTO cards (user_id, card_id, data, rev)
       SELECT ?1, g.card_id, g.data, ${NEXT_REV} FROM g LEFT JOIN cards AS c ON c.user_id = ?1 AND c.card_id = g.card_id
       WHERE c.data IS NULL OR c.data <> g.data
       ON CONFLICT (user_id, card_id) DO UPDATE SET data = excluded.data, rev = excluded.rev`,
    ).bind(user.id, key),
    clearGone(db, user.id),
    // Disparues : une marque chacune (cards_gone), puis effacées par ces marques (leurs étiquettes restent). Plus de
    // MAX_DELTA : aucune marque une à une (l'élagage les effacerait aussitôt), mais une seule marque de débordement
    // (card_id vide) qui fait avancer la révision et monter le plancher ; les cartes sont alors effacées directement.
    db.prepare(
      `${cte}, gone AS MATERIALIZED (
         SELECT card_id FROM cards WHERE user_id = ?1 AND card_id NOT IN (SELECT card_id FROM e WHERE bad IS NULL)
       )
       INSERT INTO cards_gone (user_id, card_id, rev)
       SELECT ?1, card_id, ${NEXT_REV} FROM gone WHERE (SELECT COUNT(*) FROM gone) <= ${MAX_DELTA}
       UNION ALL
       SELECT ?1, '', ${NEXT_REV} WHERE (SELECT COUNT(*) FROM gone) > ${MAX_DELTA}
       ON CONFLICT (user_id, card_id) DO UPDATE SET rev = excluded.rev`,
    ).bind(user.id, key),
    db.prepare(
      `DELETE FROM cards WHERE user_id = ?1 AND card_id IN (SELECT card_id FROM cards_gone WHERE user_id = ?1 AND rev = ${NEXT_REV})`,
    ).bind(user.id),
    // Débordement seulement : la marque est cherchée d'abord (par clé) ; sans elle, rien n'est parcouru.
    db.prepare(
      `${cte} DELETE FROM cards WHERE user_id = ?1 AND card_id IN (
         SELECT c.card_id FROM cards_gone AS s, cards AS c
         WHERE s.user_id = ?1 AND s.card_id = '' AND s.rev = ${NEXT_REV}
           AND c.user_id = ?1 AND c.card_id NOT IN (SELECT card_id FROM e WHERE bad IS NULL))`,
    ).bind(user.id, key),
    commitRev(db, user.id),
    db.prepare(
      `UPDATE users SET cards_gone_floor = cards_rev WHERE id = ?1
         AND EXISTS (SELECT 1 FROM cards_gone WHERE user_id = ?1 AND card_id = '' AND rev = users.cards_rev)`,
    ).bind(user.id),
    ...pruneGone(db, user.id),
    ...clear,
  ]);

  return { count, new_ids: raw(updated.results[0]?.new_ids || '[]'), complete, skipped };
}

// Statistiques du jeu gardées : seulement les compteurs (pas tagOptions). Un compteur donné en texte (« 1043 ») est
// lu comme un nombre ; rarityCounts : 20 raretés au plus.
const counter = (v) => (typeof v === 'string' && /^\s*\d{1,9}\s*$/.test(v) ? Number(v) : v ?? null);

export function pickStats(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const rc = s.rarityCounts;
  return {
    total: counter(s.total),
    totalUnique: counter(s.totalUnique),
    rarityCounts: rc && typeof rc === 'object' && !Array.isArray(rc)
      ? Object.fromEntries(Object.entries(rc).filter(([k]) => k.length <= 20).slice(0, 20).map(([k, v]) => [k, counter(v)]))
      : null,
  };
}

// POST /api/import {upload_id, part, last, cards | collection, stats?, last_at?, rows?, copies?, ignored?, source}
// Sans upload_id : import en un seul morceau. `source` est accepté mais pas stocké (aucune colonne prévue).
// rows, copies, ignored (favori, au premier morceau) : exemplaires lus, leur nombre total et cartes distinctes qu'il a
// écartées, pour vérifier que la lecture est complète (finalizeImport).
export async function importRoute(env, user, body) {
  const db = env.DB;
  if (body.mode === 'state') {
    const state = syncState(user);
    return { quick: quickSyncAllowed(state), last_at: state?.last_at ?? null, full_at: state?.full_at ?? null };
  }
  if (body.mode === 'delta') return deltaRoute(db, user, body);
  if (body.mode !== undefined) throw new HttpError(400, "Mode d'import inconnu (« state », « delta » ou rien).");
  if (body.last_at !== undefined && body.last_at !== null && !isDate(body.last_at)) throw new HttpError(400, 'Le champ « last_at » doit être une date.');
  for (const f of ['rows', 'copies', 'ignored']) {
    if (body[f] !== undefined && body[f] !== null && !nat(body[f])) throw new HttpError(400, `Le champ « ${f} » doit être un entier positif.`);
  }
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

  // Cartes invalides (favori ou entrées brutes, mêmes règles) : ignorées et comptées, gardées en attente sous forme de
  // marque (badCard) pour que la finalisation les compte.
  const list = Array.isArray(body.cards) ? body.cards : Array.isArray(body.collection) ? body.collection : null;
  if (!list) throw new HttpError(400, 'Il manque les cartes (champ « cards », ou « collection » pour les entrées du jeu).');
  if (list.length > MAX_PART_CARDS) throw new HttpError(400, `${MAX_PART_CARDS} cartes au plus par morceau.`);
  const rawEntries = list !== body.cards;
  const convert = rawEntries ? entryToCard : checkCard;
  const cards = [];
  let skipped = 0;
  list.forEach((item) => {
    const card = convert(item);
    if (card) {
      cards.push(card);
    } else {
      skipped++;
      cards.push(badCard(item, rawEntries));
    }
  });
  if (body.stats !== undefined && body.stats !== null && (typeof body.stats !== 'object' || Array.isArray(body.stats))) {
    throw new HttpError(400, 'Le champ « stats » doit être un objet.');
  }
  const stats = pickStats(body.stats);

  // Les autres morceaux de cet envoi déjà en attente (celui-ci peut être un nouvel essai : il remplace l'ancien).
  const text = JSON.stringify(cards);
  const others = await db.prepare(
    `SELECT COUNT(*) AS n, MAX(part) AS top, SUM(json_array_length(cards) - skipped) AS received, SUM(skipped) AS skipped,
            SUM(length(CAST(cards AS BLOB))) AS bytes
     FROM import_staging WHERE user_id = ?1 AND upload_id = ?2 AND part >= 0 AND part <> ?3`,
  )
    .bind(user.id, uploadId, part)
    .first();
  if ((others.bytes ?? 0) + byteLength(text) > MAX_STAGING_BYTES) {
    throw new HttpError(413, "Envoi trop volumineux : 8 Mo au plus en attente pour un import. Rien n'a été importé.");
  }

  // Morceau -1 : compteurs du jeu, date du plus récent exemplaire lu, exemplaires lus (favori), relus à la finalisation.
  const head = { ...(stats || {}) };
  if (body.last_at) head.last_at = body.last_at;
  for (const f of ['rows', 'copies', 'ignored']) if (nat(body[f])) head[f] = body[f];

  // Un seul envoi à la fois par utilisateur : un nouvel upload_id remplace l'envoi en cours.
  const now = nowIso();
  const put = `INSERT OR REPLACE INTO import_staging (user_id, upload_id, part, cards, skipped, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)`;
  await db.batch([
    ...purgeStaging(db),
    db.prepare('DELETE FROM import_staging WHERE user_id = ?1 AND upload_id <> ?2').bind(user.id, uploadId),
    db.prepare(put).bind(user.id, uploadId, part, text, skipped, now),
    ...(Object.keys(head).length ? [db.prepare(put).bind(user.id, uploadId, -1, JSON.stringify(head), 0, now)] : []),
  ]);

  const received = (others.received ?? 0) + cards.length - skipped;
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
    read: meta && nat(meta.rows) && nat(meta.copies) ? { rows: meta.rows, copies: meta.copies } : null,
    ignored: meta && nat(meta.ignored) ? meta.ignored : 0,
    clear: [db.prepare('DELETE FROM import_staging WHERE user_id = ?1').bind(user.id)],
    skipped: skippedTotal,
  });
}
