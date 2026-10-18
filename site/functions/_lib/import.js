// Import par morceaux (POST /api/import) et finalisation en SQL, commune avec /api/refresh.
// JavaScript ne touche jamais plus d'un morceau (500 cartes) ; la comparaison avec la collection en place se fait dans
// D1 (règle née de la limite de calcul des Workers gratuits, gardée : elle ne coûte rien).
// Sécurité des cartes : une lecture complète ne retire des cartes que si elle est VÉRIFIÉE complète (cartes lues =
// compteurs du jeu, et compteurs identiques avant et après la lecture) ; sinon elle ne fait qu'ajouter les cartes
// absentes du classeur (finalizeImport). Chaque synchro, réussie ou non, laisse une ligne dans le journal (synclog.js).

import { HttpError, raw } from './http.js';
import { purgeStaging } from './db.js';
import {
  MAX_CARDS, MAX_DELTA, MAX_PART_CARDS, NEXT_REV, badCard, checkCard, commitRev, entryToCard, isDate, rankSql, rarityOfRankSql,
} from './cards.js';
import { byteLength, nowIso, randomToken } from './util.js';
import { valueAfterCards } from './market.js';
import { errorEntry, versionOf, viaOf, writeLog } from './synclog.js';

// Quotas d'un envoi en attente (D1 gratuit : 500 Mo en tout, 100 000 lignes écrites par jour).
const MAX_PARTS = 40;
// 8 Mo : une carte réelle pèse ~370 octets en forme compacte, donc ~20 000 cartes (la limite de la collection).
const MAX_STAGING_BYTES = 8 * 1024 * 1024;
// Envois en cours en même temps par classeur, celui-ci compris (deux onglets, favori relié et clic) : au-delà, le plus
// ancien est abandonné.
const MAX_UPLOADS = 3;
// Version du favori la plus récente (site/public/assets/bookmarklet.js, VERSION ; un test vérifie qu'elles concordent),
// rendue par « state » : un favori plus ancien le signale.
export const FAVORI_VERSION = 2;

const nat = (v) => Number.isInteger(v) && v >= 0 && v <= 1_000_000;
const num = (n) => Number(n || 0).toLocaleString('fr-FR');
const plural = (n, one, many) => (n > 1 ? many : one);

// Début de la lecture : heure du serveur rendue par « state » (favori) ou prise à la page 0 (rafraîchissement). Une
// lecture plus ancienne que celle dont le classeur vient (sync_state.read_at) n'est jamais appliquée par-dessus. Absent,
// invalide, à venir (plus d'une minute) ou de plus de 2 h : ignoré (aucun contrôle, comme un ancien favori).
export function startedAt(v) {
  if (!isDate(v)) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t) || t > Date.now() + 60_000 || t < Date.now() - 2 * 3600_000) return null;
  return new Date(Math.min(t, Date.now())).toISOString();
}

// Raisons d'une relecture complète, envoyées par le favori avec sa lecture (« reason ») et recopiées dans le journal :
// celles d'une synchro rapide refusée par le classeur (needs_full) et celles qu'il voit lui-même dans le tri par date.
export const REASONS = {
  state: 'pas de synchro rapide possible : première lecture, relecture de la semaine ou demandée',
  counts: 'les compteurs du jeu ne collaient pas avec les nouveautés',
  race: 'une autre synchro était passée en même temps',
  invalid: 'une nouvelle carte ne pouvait pas être rangée',
  too_many: 'plus de 500 nouveautés',
  max_cards: 'plus de 20 000 cartes',
  gone: 'la carte la plus récente de la dernière synchro était partie',
  order: "le jeu n'avait pas rangé la collection par date",
  sort: "le tri par date du jeu n'avait pas répondu",
};
const reasonOf = (v) => (typeof v === 'string' && Object.hasOwn(REASONS, v) ? v : null);

// Collection à importer, recalculée en SQL à partir de la table d'attente (`source` : requête qui rend une colonne
// `j` = tableau JSON de cartes partielles ; paramètres ?1 = user_id, ?2 = clé de l'envoi).
// e : une ligne par carte partielle (bad = 1 : entrée invalide, comptée mais jamais rangée, cards.js badCard) ;
// d : exemplaires dédoublonnés (eid) ; g : une Carte par card_id, en JSON. Une carte possédée en plusieurs raretés
// garde la plus haute (C < PC < R < SR < UR < L), pas la plus grande en texte. Ses exemplaires par rareté
// d'exemplaire et brillance (variants, cards.js) sont additionnés, et gardés seulement s'ils les comptent tous (une
// entrée sans ce détail : la carte n'en a pas).
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
  g0 AS (
    SELECT card_id, SUM(json_extract(v, '$.count')) AS cnt, json_object(
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
  ),
  vk AS (
    SELECT d.card_id, k.key AS k, SUM(k.value) AS n FROM d, json_each(d.v, '$.variants') AS k
    WHERE d.bad IS NULL AND json_type(d.v, '$.variants') = 'object' GROUP BY d.card_id, k.key
  ),
  vg AS (SELECT card_id, json_group_object(k, n) AS j, SUM(n) AS total FROM (SELECT card_id, k, n FROM vk ORDER BY card_id, k) GROUP BY card_id),
  g AS (
    SELECT g0.card_id, CASE WHEN vg.total = g0.cnt THEN json_set(g0.data, '$.variants', json(vg.j)) ELSE g0.data END AS data
    FROM g0 LEFT JOIN vg ON vg.card_id = g0.card_id
  )`;
}

// Champs de la carte du jeu elle-même (les mêmes dans tous ses exemplaires : `card.*` de chaque entrée), par opposition à
// ceux qui dépendent des exemplaires lus (rareté la plus haute, count, brillante, favorite, date d'obtention, variants).
// Une lecture qui ne peut pas tout remplacer (synchro rapide, lecture complète non vérifiée) rafraîchit quand même ceux-là
// sur les cartes qu'elle a vues (2026-10-18, « pas bien synchronisés » : sans cela, la catégorie du jeu, l'image ou les
// vues d'une carte déjà là n'étaient relues que par une lecture complète vérifiée).
const CARD_FIELDS = ['title', 'atk', 'def', 'quality', 'pageviews', 'category', 'image', 'url'];
// SQL : un de ces champs diffère entre deux cartes en JSON ; carte `a` avec ceux de `b`.
const cardFieldsDiffer = (a, b) => CARD_FIELDS.map((f) => `json_extract(${a}, '$.${f}') IS NOT json_extract(${b}, '$.${f}')`).join(' OR ');
const withCardFields = (a, b) => `json_set(${a}, ${CARD_FIELDS.map((f) => `'$.${f}', json_extract(${b}, '$.${f}')`).join(', ')})`;

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
//   tok      jeton tiré à chaque écriture : deux synchros en même temps ne partent pas du même état (writeDelta) ;
//   read_at  début de la lecture dont le classeur vient (lecture vérifiée ou synchro rapide ; null : inconnu) : une
//            lecture commencée avant n'est plus appliquée (« superseded ») ;
//   complete résultat du contrôle de la dernière lecture complète (true, false ou null : pas de compteurs) ;
//   up       upload_id du dernier envoi du favori appliqué : son dernier morceau renvoyé (réponse perdue) rend le même
//            résultat au lieu d'un 409.
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
// brillante ou favorite si l'un l'est, plus haute rareté, plus ancienne date d'obtention ; exemplaires par rareté
// additionnés si l'ancienne et la nouvelle les ont, sinon plus de détail jusqu'à la lecture complète suivante : la
// cote de cette carte est alors approchée, market.js), et ses champs de carte du jeu (CARD_FIELDS : catégorie, image,
// vues…) repris de la nouveauté, lue à l'instant. Rien n'est retiré. Les cartes
// écrites prennent la révision suivante (aucune nouveauté : la révision ne bouge pas).
// Comparer-échanger : l'état n'est remplacé que s'il est encore celui lu à l'authentification (pas d'autre synchro ni
// d'import complet fini entre-temps), et les cartes ne sont écrites que s'il l'a été (même transaction) ; sinon
// {needs_full, reason: 'race'} et rien n'est écrit.
// started = début de la lecture (startedAt), gardé dans read_at ; copies = exemplaires ajoutés et log = {via, v} pour
// la ligne du journal (synclog.js).
export async function writeDelta(db, user, state, { text, stats, lastAt, fresh, copies = 0, started = null, log = {}, clear = [] }) {
  const t0 = Date.now();
  const cte = collectionCte(DELTA_SOURCE);
  const count = state.count + fresh;
  const next = JSON.stringify({
    ...state,
    stats: pickStats(stats),
    last_at: lastAt && lastAt > state.last_at ? lastAt : state.last_at,
    count,
    tok: randomToken(9),
    read_at: started,
  });
  const old = (f) => `json_extract(cards.data, '$.${f}')`;
  const add = (f) => `json_extract(excluded.data, '$.${f}')`;
  // Carte déjà là : champs de la carte du jeu repris de la nouveauté, champs des exemplaires additionnés, sans ses
  // exemplaires par rareté (base) ; ceux-ci sont remis, additionnés, si l'ancienne et la nouvelle les ont (en dernier,
  // comme dans une carte importée), sinon la carte n'en a plus.
  const base = `json_remove(json_set(${withCardFields('cards.data', 'excluded.data')},
         '$.rarity', CASE WHEN ${rankSql(add('rarity'))} > ${rankSql(old('rarity'))} THEN ${add('rarity')} ELSE ${old('rarity')} END,
         '$.count', ${old('count')} + ${add('count')},
         '$.shiny', json(CASE WHEN ${old('shiny')} OR ${add('shiny')} THEN 'true' ELSE 'false' END),
         '$.starred', json(CASE WHEN ${old('starred')} OR ${add('starred')} THEN 'true' ELSE 'false' END),
         '$.obtained_at', CASE WHEN ${old('obtained_at')} IS NULL OR ${add('obtained_at')} < ${old('obtained_at')}
           THEN ${add('obtained_at')} ELSE ${old('obtained_at')} END), '$.variants')`;
  const variants = `json((SELECT json_group_object(k, n) FROM (SELECT key AS k, SUM(value) AS n FROM (
             SELECT key, value FROM json_each(cards.data, '$.variants') UNION ALL SELECT key, value FROM json_each(excluded.data, '$.variants')
           ) GROUP BY key ORDER BY key)))`;
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
       ON CONFLICT (user_id, card_id) DO UPDATE SET rev = excluded.rev, data = CASE
         WHEN json_type(cards.data, '$.variants') = 'object' AND json_type(excluded.data, '$.variants') = 'object'
         THEN json_set(${base}, '$.variants', ${variants}) ELSE ${base} END`,
    ).bind(user.id, text, next),
    clearGone(db, user.id),
    commitRev(db, user.id),
    ...clear,
  ]);
  if (!updated.results.length) return needsFull('race');
  await valueAfterCards(db, user.id); // valeur du jour (market.js), au plus une fois par heure
  await writeLog(db, user.id, {
    kind: 'quick',
    result: 'ok',
    message: copies
      ? `Synchro rapide : ${num(copies)} ${plural(copies, 'exemplaire obtenu', 'exemplaires obtenus')}, ${fresh ? `${num(fresh)} ${plural(fresh, 'nouvelle carte', 'nouvelles cartes')}` : 'aucune nouvelle carte'} (${num(count)} ${plural(count, 'carte', 'cartes')}).`
      : `Synchro rapide : rien de nouveau (${num(count)} ${plural(count, 'carte', 'cartes')}).`,
    data: { ...log, count, fresh, copies, ms: started ? Date.now() - Date.parse(started) : Date.now() - t0 },
  });
  return {
    count,
    new_ids: raw(updated.results[0].new_ids || '[]'),
    complete: count + state.invalid === stats.totalUnique,
    skipped: 0,
    quick: true,
  };
}

// Réponse à une synchro (rapide ou complète) partie avant la lecture dont le classeur vient déjà (read_at) : rien
// n'est écrit, le classeur est au moins aussi à jour. Même forme qu'une réponse réussie (un ancien client l'affiche
// comme telle), avec superseded: true ; une ligne au journal.
async function supersededReply(db, user, kind, data, extra = {}) {
  const row = await db.prepare('SELECT sync_state FROM users WHERE id = ?1').bind(user.id).first();
  const count = syncState(row || {})?.count ?? null;
  await writeLog(db, user.id, {
    kind,
    result: 'ok',
    message: 'Lecture remplacée : une synchro plus récente (autre onglet, favori relié ou rafraîchissement) est déjà passée, ton classeur est à jour.',
    data: { ...data, count, superseded: true },
  });
  return { count, new_ids: [], complete: null, skipped: 0, ...extra, superseded: true };
}

// POST /api/import {mode: 'delta', cards, stats, rows, copies, last_at, started?, via?, v?} (favori) : nouveautés
// seulement, en un envoi. {needs_full: true, reason} (rien d'écrit) quand la synchro rapide n'est pas possible : 'state'
// (pas de lecture complète vérifiée récente, ou relecture complète demandée), 'too_many', 'invalid' (carte invalide
// parmi les nouveautés), 'counts' (les compteurs ne collent pas), 'max_cards', 'race' (une autre synchro est passée
// entre-temps). Lecture commencée avant celle dont le classeur vient (started < read_at) : superseded, rien d'écrit.
async function deltaRoute(db, user, body) {
  const list = Array.isArray(body.cards) ? body.cards : null;
  if (!list) throw new HttpError(400, 'Il manque les cartes (champ « cards »).');
  if (!nat(body.rows) || !nat(body.copies)) throw new HttpError(400, 'Les champs « rows » et « copies » doivent être des entiers positifs.');
  if (body.last_at !== undefined && body.last_at !== null && !isDate(body.last_at)) throw new HttpError(400, 'Le champ « last_at » doit être une date.');
  const state = syncState(user);
  const started = startedAt(body.started);
  const log = { via: viaOf(body.via), v: versionOf(body.v) };
  if (started && state && isDate(state.read_at) && state.read_at > started) {
    return supersededReply(db, user, 'quick', log, { quick: true });
  }
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
  return writeDelta(db, user, state, { text, stats, lastAt: body.last_at ?? null, fresh: fit.fresh, copies: body.copies, started, log });
}

// Applique la collection de la table d'attente, en n'écrivant que les différences, dans une transaction. Les cartes
// ajoutées, revenues ou modifiées et les retraits prennent la révision suivante ; une collection identique à celle en
// place ne fait pas avancer la révision.
// `clear` = requêtes qui vident la table d'attente (passées dans la même transaction) ; `skipped` = entrées ignorées
// (invalides), recopié dans la réponse.
// lastAt = obtained_at du plus récent exemplaire lu (envoyé par le favori) ; sinon le plus récent de la table d'attente,
// entrées invalides comprises. read = {rows, copies} lus par le favori (ses cartes arrivent déjà regroupées) ; sinon
// comptés dans la table d'attente (entrées brutes). ignored = cartes distinctes écartées par le favori.
// complete = cartes rangées + cartes invalides = totalUnique (null sans compteurs du jeu). statsEnd = compteurs relus
// après la dernière page : s'ils ont changé, la collection a bougé pendant la lecture (moved), qui n'est pas fiable.
// - Lecture VÉRIFIÉE (complete et pas moved) : la collection est remplacée, cartes retirées comprises. La synchro rapide
//   n'est armée (full_at) que si `total` y correspond aux exemplaires ou aux lignes lus (unité apprise, utilisable).
// - Sinon (il manque des cartes d'après le jeu, compteurs absents, collection qui a bougé) : les cartes absentes du
//   classeur sont ajoutées ; aucune n'est retirée (une page manquante ne doit jamais effacer de cartes) ; une carte déjà
//   là ne reprend que ses champs de carte du jeu (CARD_FIELDS : catégorie, image, vues…, les mêmes dans tous ses
//   exemplaires), jamais ses nombres d'exemplaires, sa rareté ni ses dates (une partie de ses exemplaires a pu manquer) ;
//   la synchro rapide n'est pas armée et la suivante relit tout.
// started = début de la lecture (startedAt) : si le classeur vient déjà d'une lecture commencée après (read_at), rien
// n'est écrit (superseded) ; contrôlé dans la transaction même (l'état n'est remplacé que si read_at le permet, et les
// cartes ne sont écrites que s'il l'a été). upload = upload_id du favori (sync_state.up). log = {via, reason, v} pour la
// ligne du journal (synclog.js).
// Réponse : {count, new_ids, complete, skipped, removed, kept} (+ moved: true ; ou superseded: true) ; le journal compte
// aussi les cartes déjà là mises à jour par une lecture non vérifiée (updated).
export async function finalizeImport(db, user, {
  source, key, stats, lastAt = null, read = null, ignored = 0, clear, skipped = 0, statsEnd = null, started = null, upload = null, log = {},
}) {
  const cte = collectionCte(source);
  // Un passage : cartes distinctes (valides ou non ; une entrée sans identifiant de carte n'en est pas une), entrées
  // invalides, plus récent obtained_at, exemplaires lus (dédoublonnés, d) quand le favori ne les a pas comptés, cartes
  // du classeur (have) et cartes du classeur absentes de la lecture (unseen : retirées par une lecture vérifiée, gardées
  // sinon). Cartes rangées / invalides séparées par une seconde requête seulement s'il y a des entrées invalides.
  const mine = `(SELECT COUNT(*) FROM cards WHERE user_id = ?1) AS have,
      (SELECT COUNT(*) FROM cards WHERE user_id = ?1 AND card_id NOT IN (SELECT card_id FROM e WHERE bad IS NULL AND card_id IS NOT NULL)) AS unseen`;
  const sum = await db.prepare(read
    ? `${cte} SELECT COUNT(DISTINCT card_id) AS ids, COUNT(bad) AS nbad, MAX(json_extract(v, '$.obtained_at')) AS last, ${mine} FROM e`
    : `${cte} SELECT COUNT(DISTINCT card_id) AS ids, COUNT(bad) AS nbad, MAX(json_extract(v, '$.obtained_at')) AS last,
         COUNT(*) AS rows, SUM(json_extract(v, '$.count')) AS copies, ${mine} FROM d`,
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
  const end = pickStats(statsEnd);
  const moved = countsOk(counts) && countsOk(end) && (end.total !== counts.total || end.totalUnique !== counts.totalUnique);
  const verified = complete === true && !moved;
  const have = sum.have || 0;
  const unseen = sum.unseen || 0;
  const fresh = count - (have - unseen); // cartes lues absentes du classeur
  const after = verified ? count : have + fresh;
  if (after > MAX_CARDS) throw new HttpError(400, 'Collection trop grande : 20 000 cartes au plus.');
  // Lecture non vérifiée : cartes déjà là dont un champ de carte du jeu a changé (mises à jour plus bas), pour le journal.
  const updated = verified ? 0 : (await db.prepare(
    `${cte} SELECT COUNT(*) AS n FROM g JOIN cards AS c ON c.user_id = ?1 AND c.card_id = g.card_id WHERE ${cardFieldsDiffer('c.data', 'g.data')}`,
  ).bind(user.id, key).first())?.n ?? 0;
  const last = lastAt || sum.last || null;
  const armed = verified && (unit === 'copies' || unit === 'both') && isDate(last);
  const prev = syncState(user);
  const tok = randomToken(9);
  const state = JSON.stringify({
    stats: countsOk(counts) ? counts : null,
    last_at: last,
    full_at: armed ? nowIso() : null,
    unit,
    invalid,
    count: after,
    tok,
    // Une lecture non vérifiée ne dit pas où en est toute la collection : read_at ne bouge pas.
    read_at: verified ? started : prev?.read_at ?? null,
    complete: moved ? false : complete,
    up: upload,
  });
  // Les cartes ne sont écrites que si l'état vient d'être remplacé par celui-ci (son jeton) ; read_at lu en SQL (une
  // ancienne valeur de sync_state peut ne pas être du JSON).
  const ours = "(SELECT CASE WHEN json_valid(sync_state) THEN json_extract(sync_state, '$.tok') END FROM users WHERE id = ?1) IS ?3";
  const readAt = "CASE WHEN json_valid(sync_state) THEN json_extract(sync_state, '$.read_at') END";

  const results = await db.batch([
    // new_ids d'abord (avant l'écriture des cartes) : vide au tout premier import.
    db.prepare(
      `${cte} UPDATE users SET
         new_ids = CASE WHEN fetched_at IS NULL THEN '[]' ELSE
           (SELECT json_group_array(card_id) FROM (SELECT DISTINCT card_id FROM e
              WHERE bad IS NULL AND card_id NOT IN (SELECT card_id FROM cards WHERE user_id = ?1)))
         END,
         fetched_at = ?3, sync_state = ?4
       WHERE id = ?1 AND (?5 IS NULL OR ${readAt} IS NULL OR ${readAt} <= ?5) RETURNING new_ids`,
    ).bind(user.id, key, nowIso(), state, started),
    // Nouvelles et modifiées (lecture vérifiée : la carte lue remplace l'ancienne) ; sinon nouvelles, et déjà là dont un
    // champ de carte du jeu a changé (seulement ceux-là sont repris). Une carte inchangée garde sa révision.
    db.prepare(
      `${cte} INSERT INTO cards (user_id, card_id, data, rev)
       SELECT ?1, g.card_id, g.data, ${NEXT_REV} FROM g LEFT JOIN cards AS c ON c.user_id = ?1 AND c.card_id = g.card_id
       WHERE (c.data IS NULL OR ${verified ? 'c.data <> g.data' : `(${cardFieldsDiffer('c.data', 'g.data')})`}) AND ${ours}
       ON CONFLICT (user_id, card_id) DO UPDATE SET data = ${verified ? 'excluded.data' : withCardFields('cards.data', 'excluded.data')}, rev = excluded.rev`,
    ).bind(user.id, key, tok),
    clearGone(db, user.id),
    // Lecture vérifiée seulement. Disparues : une marque chacune (cards_gone), puis effacées par ces marques (leurs
    // étiquettes restent). Plus de MAX_DELTA : aucune marque une à une (l'élagage les effacerait aussitôt), mais une seule
    // marque de débordement (card_id vide) qui fait avancer la révision et monter le plancher ; les cartes sont alors
    // effacées directement. Sans marque posée (état pas remplacé), rien n'est effacé.
    ...(verified ? [
      db.prepare(
        `${cte}, gone AS MATERIALIZED (
           SELECT card_id FROM cards WHERE user_id = ?1 AND card_id NOT IN (SELECT card_id FROM e WHERE bad IS NULL)
         )
         INSERT INTO cards_gone (user_id, card_id, rev)
         SELECT ?1, card_id, ${NEXT_REV} FROM gone WHERE (SELECT COUNT(*) FROM gone) <= ${MAX_DELTA} AND ${ours}
         UNION ALL
         SELECT ?1, '', ${NEXT_REV} WHERE (SELECT COUNT(*) FROM gone) > ${MAX_DELTA} AND ${ours}
         ON CONFLICT (user_id, card_id) DO UPDATE SET rev = excluded.rev`,
      ).bind(user.id, key, tok),
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
    ] : []),
    commitRev(db, user.id),
    ...(verified ? [
      db.prepare(
        `UPDATE users SET cards_gone_floor = cards_rev WHERE id = ?1
           AND EXISTS (SELECT 1 FROM cards_gone WHERE user_id = ?1 AND card_id = '' AND rev = users.cards_rev)`,
      ).bind(user.id),
    ] : []),
    ...pruneGone(db, user.id),
    ...clear,
  ]);

  const ms = started ? Date.now() - Date.parse(started) : null;
  const data = {
    ...log, count: after, fresh, removed: verified ? unseen : 0, kept: verified ? 0 : unseen, ...(verified ? {} : { updated }), read: count + invalid,
    unique: counts ? counts.totalUnique : null, total: counts ? counts.total : null, invalid, skipped, complete, moved: moved || null, ms,
  };
  if (!results[0].results.length) return supersededReply(db, user, 'full', data, { complete });
  await valueAfterCards(db, user.id); // valeur du jour (market.js), au plus une fois par heure
  await writeLog(db, user.id, fullLogEntry(data, verified, log.reason));
  const res = { count: after, new_ids: raw(results[0].results[0].new_ids || '[]'), complete: moved ? false : complete, skipped, removed: data.removed, kept: data.kept };
  if (moved) res.moved = true;
  return res;
}

// Ligne du journal d'une lecture complète appliquée (data : voir finalizeImport).
function fullLogEntry(d, verified, reason) {
  const nouvelles = d.fresh ? `${num(d.fresh)} ${plural(d.fresh, 'nouvelle', 'nouvelles')}` : 'aucune nouvelle';
  const ignored = d.skipped ? ` ; ${num(d.skipped)} ${plural(d.skipped, 'entrée ignorée', 'entrées ignorées')} (sans titre ou rareté inconnue)` : '';
  if (verified) {
    const why = reason ? ` (${REASONS[reason]})` : '';
    const removed = d.removed ? `${num(d.removed)} ${plural(d.removed, 'retirée', 'retirées')}` : 'aucune retirée';
    return { kind: 'full', result: 'ok', message: `Lecture complète${why} : ${num(d.count)} ${plural(d.count, 'carte', 'cartes')}, ${nouvelles}, ${removed}${ignored}.`, data: d };
  }
  const added = d.fresh ? `${num(d.fresh)} ${plural(d.fresh, 'nouvelle carte ajoutée', 'nouvelles cartes ajoutées')}` : 'aucune nouvelle carte';
  const kept = d.kept ? ` (${num(d.kept)} ${plural(d.kept, 'carte non vue, gardée', 'cartes non vues, gardées')})` : '';
  const updated = d.updated ? `, ${num(d.updated)} ${plural(d.updated, 'carte déjà là mise à jour', 'cartes déjà là mises à jour')} (catégorie du jeu, image, vues…)` : '';
  let head;
  if (d.moved) head = 'Ta collection a bougé pendant la lecture (compteurs du jeu différents avant et après)';
  else if (d.complete === false) head = `Lecture incomplète : ${num(d.read)} ${plural(d.read, 'carte lue', 'cartes lues')}, le jeu en compte ${num(d.unique)}`;
  else head = "Lecture non vérifiée (le jeu n'a pas donné ses compteurs)";
  return {
    kind: 'full',
    result: 'warn',
    message: `${head} : ${added}${updated}, aucune carte retirée${kept}${ignored}. Relance la mise à jour dans un moment.`,
    data: d,
  };
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

// POST /api/import {upload_id, part, last, cards | collection, stats?, last_at?, rows?, copies?, ignored?, stats_end?,
// started?, reason?, via?, v?, source}
// Sans upload_id : import en un seul morceau. `source` est accepté mais pas stocké (aucune colonne prévue).
// rows, copies, ignored (favori, au premier morceau) : exemplaires lus, leur nombre total et cartes distinctes qu'il a
// écartées, pour vérifier que la lecture est complète (finalizeImport) ; stats_end : compteurs du jeu relus après la
// dernière page ; started : heure du serveur rendue par « state » au début de la synchro ; reason : pourquoi une lecture
// complète (REASONS) ; via, v : chemin et version du favori (journal des synchros).
// Tout échec (refus, morceaux manquants, erreur du serveur) laisse une ligne au journal des synchros.
export async function importRoute(env, user, body) {
  if (body.mode === 'state') {
    const state = syncState(user);
    return {
      quick: quickSyncAllowed(state),
      last_at: state?.last_at ?? null,
      full_at: state?.full_at ?? null,
      now: nowIso(), // début de la synchro, à renvoyer (started) avec la lecture
      v: FAVORI_VERSION,
    };
  }
  try {
    return body.mode === 'delta' ? await deltaRoute(env.DB, user, body) : await uploadRoute(env.DB, user, body);
  } catch (err) {
    await writeLog(env.DB, user.id, errorEntry(body.mode === 'delta' ? 'quick' : 'full', err, { via: viaOf(body.via), v: versionOf(body.v) }));
    throw err;
  }
}

async function uploadRoute(db, user, body) {
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
  // Dernier morceau d'un envoi déjà appliqué (nouvel essai du favori après une réponse perdue) : même résultat, rien de
  // plus d'écrit.
  const prev = syncState(user);
  if (!single && last && prev && prev.up === uploadId) {
    return { count: prev.count ?? null, new_ids: raw(user.new_ids || '[]'), complete: prev.complete ?? null, skipped: 0, again: true };
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
  for (const f of ['stats', 'stats_end']) {
    if (body[f] !== undefined && body[f] !== null && (typeof body[f] !== 'object' || Array.isArray(body[f]))) {
      throw new HttpError(400, `Le champ « ${f} » doit être un objet.`);
    }
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

  // Morceau -1 (en-tête) : compteurs du jeu, date du plus récent exemplaire lu, exemplaires lus (favori), compteurs
  // relus à la fin, début de la synchro, raison, chemin et version du favori ; relus à la finalisation.
  const head = { ...(stats || {}) };
  if (body.last_at) head.last_at = body.last_at;
  for (const f of ['rows', 'copies', 'ignored']) if (nat(body[f])) head[f] = body[f];
  const end = pickStats(body.stats_end);
  if (countsOk(end)) head.stats_end = { total: end.total, totalUnique: end.totalUnique };
  const started = startedAt(body.started);
  if (started) head.started = started;
  if (reasonOf(body.reason)) head.reason = body.reason;
  if (viaOf(body.via)) head.via = body.via;
  if (versionOf(body.v)) head.v = body.v;

  // Plusieurs envois en même temps (deux onglets, favori relié et clic) : chacun garde ses morceaux ; au-delà de
  // MAX_UPLOADS, les plus anciens sont abandonnés (leur dernier morceau répondra 409).
  const now = nowIso();
  const put = `INSERT OR REPLACE INTO import_staging (user_id, upload_id, part, cards, skipped, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)`;
  await db.batch([
    ...purgeStaging(db),
    db.prepare(
      `DELETE FROM import_staging WHERE user_id = ?1 AND upload_id IN (
         SELECT upload_id FROM import_staging WHERE user_id = ?1 AND upload_id <> ?2
         GROUP BY upload_id ORDER BY MAX(created_at) DESC, MAX(rowid) DESC LIMIT -1 OFFSET ${MAX_UPLOADS - 1})`,
    ).bind(user.id, uploadId),
    db.prepare(put).bind(user.id, uploadId, part, text, skipped, now),
    ...(Object.keys(head).length ? [db.prepare(put).bind(user.id, uploadId, -1, JSON.stringify(head), 0, now)] : []),
  ]);

  const received = (others.received ?? 0) + cards.length - skipped;
  const skippedTotal = (others.skipped ?? 0) + skipped;
  if (!last) return { ok: true, received, skipped: skippedTotal };

  // Dernier morceau : tous les précédents doivent être là (morceaux envoyés dans l'ordre, le dernier à la fin).
  if (others.n !== part || (part > 0 && others.top !== part - 1)) {
    // Cet envoi ne pourra plus aboutir : ses morceaux sont effacés (un nouvel envoi repart avec un autre upload_id).
    await db.prepare('DELETE FROM import_staging WHERE user_id = ?1 AND upload_id = ?2').bind(user.id, uploadId).run();
    throw new HttpError(409, "Envoi incomplet : des morceaux manquent (envoi interrompu, ou abandonné pour un plus récent). Ton classeur n'a pas été modifié : relance la mise à jour.");
  }
  const statsRow = await db.prepare(
    'SELECT cards FROM import_staging WHERE user_id = ?1 AND upload_id = ?2 AND part = -1',
  )
    .bind(user.id, uploadId)
    .first();
  const meta = statsRow ? JSON.parse(statsRow.cards) : null;
  const clear = db.prepare('DELETE FROM import_staging WHERE user_id = ?1 AND upload_id = ?2').bind(user.id, uploadId);
  try {
    return await finalizeImport(db, user, {
      source: IMPORT_SOURCE,
      key: uploadId,
      stats: meta,
      lastAt: meta && isDate(meta.last_at) ? meta.last_at : null,
      read: meta && nat(meta.rows) && nat(meta.copies) ? { rows: meta.rows, copies: meta.copies } : null,
      ignored: meta && nat(meta.ignored) ? meta.ignored : 0,
      statsEnd: meta ? meta.stats_end ?? null : null,
      started: meta ? startedAt(meta.started) : null,
      upload: single ? null : uploadId,
      clear: [clear],
      skipped: skippedTotal,
      log: { via: meta ? viaOf(meta.via) : null, reason: meta ? reasonOf(meta.reason) : null, v: meta ? versionOf(meta.v) : null },
    });
  } catch (err) {
    // Refus définitif (collection vide ou trop grande) : l'envoi est abandonné. Erreur passagère (base) : ses morceaux
    // restent, un nouvel essai du dernier peut aboutir.
    if (err instanceof HttpError || single) await clear.run().catch(() => {});
    throw err;
  }
}
