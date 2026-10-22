// Finalisation en SQL d'une lecture complète de la collection (refresh.js) : la collection lue, rangée dans la table
// d'attente, remplace celle du classeur dans D1, en n'écrivant que les différences (JavaScript ne touche jamais toute la
// collection : la comparaison se fait dans D1).
// Sécurité des cartes : une lecture ne retire des cartes que si elle est VÉRIFIÉE complète (exemplaires lus = compte
// exact du jeu lu avant, et compte identique après) ; sinon elle ne fait qu'ajouter les cartes absentes du classeur
// (finalizeImport). Chaque lecture, réussie ou non, laisse une ligne dans le journal (synclog.js).

import { HttpError, raw } from './http.js';
import { MAX_CARDS, MAX_DELTA, MAX_GTAGS, NEXT_REV, commitRev, rankSql, rarityOfRankSql } from './cards.js';
import { nowIso, randomToken } from './util.js';
import { valueAfterCards } from './market.js';
import { writeLog } from './synclog.js';

const num = (n) => Number(n || 0).toLocaleString('fr-FR');
const plural = (n, one, many) => (n > 1 ? many : one);

// Collection lue, recalculée en SQL à partir de la table d'attente (`source` : requête qui rend une colonne
// `j` = tableau JSON de cartes partielles ; paramètres ?1 = user_id, ?2 = clé de l'envoi).
// e : une ligne par carte partielle (bad = 1 : entrée invalide, comptée mais jamais rangée, cards.js badCard) ;
// d : exemplaires dédoublonnés (eid) ; g : une Carte par card_id, en JSON. Une carte possédée en plusieurs raretés
// garde la plus haute (C < PC < R < SR < UR < L), pas la plus grande en texte. Ses exemplaires par rareté
// d'exemplaire et brillance (variants, cards.js) sont additionnés, et gardés seulement s'ils les comptent tous (une
// entrée sans ce détail : la carte n'en a pas). Tags du jeu (gtags) : réunis sur tous ses exemplaires, sans doublon, triés,
// MAX_GTAGS au plus, en dernier dans le JSON (puis leurs couleurs, gtagc, s'il y en a) et absents s'il n'y en a aucun ;
// g.gread = 1 si au moins un exemplaire les a lus (tableau gtags, même vide), 0 sinon (ceux du classeur sont gardés).
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
    ) AS data, MAX(json_type(v, '$.gtags') = 'array') AS gread
    FROM d WHERE bad IS NULL GROUP BY card_id
  ),
  vk AS (
    SELECT d.card_id, k.key AS k, SUM(k.value) AS n FROM d, json_each(d.v, '$.variants') AS k
    WHERE d.bad IS NULL AND json_type(d.v, '$.variants') = 'object' GROUP BY d.card_id, k.key
  ),
  vg AS (SELECT card_id, json_group_object(k, n) AS j, SUM(n) AS total FROM (SELECT card_id, k, n FROM vk ORDER BY card_id, k) GROUP BY card_id),
  gv AS (
    SELECT DISTINCT d.card_id, t.value AS t FROM d, json_each(d.v, '$.gtags') AS t
    WHERE d.bad IS NULL AND json_type(d.v, '$.gtags') = 'array' AND t.type = 'text'
  ),
  gc AS (
    SELECT d.card_id, k.key AS t, MAX(k.value) AS c FROM d, json_each(d.v, '$.gtagc') AS k
    WHERE d.bad IS NULL AND json_type(d.v, '$.gtagc') = 'object' AND k.type = 'text' GROUP BY d.card_id, k.key
  ),
  gt AS (
    SELECT card_id, json_group_array(t) AS j, json_group_object(t, c) FILTER (WHERE c IS NOT NULL) AS cj, COUNT(c) AS nc FROM (
      SELECT r.card_id, r.t, gc.c FROM (SELECT card_id, t, ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY t) AS k FROM gv) AS r
      LEFT JOIN gc ON gc.card_id = r.card_id AND gc.t = r.t
      WHERE r.k <= ${MAX_GTAGS} ORDER BY r.card_id, r.t
    ) GROUP BY card_id
  ),
  g1 AS (
    SELECT g0.card_id, g0.gread, CASE WHEN vg.total = g0.cnt THEN json_set(g0.data, '$.variants', json(vg.j)) ELSE g0.data END AS data
    FROM g0 LEFT JOIN vg ON vg.card_id = g0.card_id
  ),
  g AS (
    SELECT g1.card_id, g1.gread, CASE WHEN gt.j IS NULL THEN g1.data WHEN gt.nc THEN json_set(g1.data, '$.gtags', json(gt.j), '$.gtagc', json(gt.cj))
      ELSE json_set(g1.data, '$.gtags', json(gt.j)) END AS data
    FROM g1 LEFT JOIN gt ON gt.card_id = g1.card_id
  )`;
}

// Champs de la carte du jeu elle-même (les mêmes dans tous ses exemplaires : `card.*` de chaque entrée), par opposition à
// ceux qui dépendent des exemplaires lus (rareté la plus haute, count, brillante, favorite, date d'obtention, variants).
// Une lecture qui ne peut pas tout remplacer (lecture non vérifiée) rafraîchit quand même ceux-là
// sur les cartes qu'elle a vues (2026-10-18, « pas bien synchronisés » : sans cela, la catégorie du jeu, l'image ou les
// vues d'une carte déjà là n'étaient relues que par une lecture complète vérifiée).
const CARD_FIELDS = ['title', 'atk', 'def', 'quality', 'pageviews', 'category', 'image', 'url'];
// SQL : un de ces champs diffère entre deux cartes en JSON ; carte `a` avec ceux de `b`.
const cardFieldsDiffer = (a, b) => CARD_FIELDS.map((f) => `json_extract(${a}, '$.${f}') IS NOT json_extract(${b}, '$.${f}')`).join(' OR ');
const withCardFields = (a, b) => `json_set(${a}, ${CARD_FIELDS.map((f) => `'$.${f}', json_extract(${b}, '$.${f}')`).join(', ')})`;
// Tags du jeu : propres à chaque exemplaire (pas à la carte), donc jamais retirés par une lecture qui a pu manquer des
// exemplaires (lecture non vérifiée) : la carte `base` reçoit la réunion de ses tags du jeu `a` et des
// nouveaux `b` (tableaux JSON ou NULL), triés, MAX_GTAGS au plus, avec leurs couleurs (`bc` d'abord, sinon `ac` : objets
// JSON ou NULL), remis en dernier (même ordre des clés qu'une carte importée) ; aucun : clés retirées. Seule une lecture
// vérifiée qui les a lus les remplace.
const withGtags = (base, a, b, ac, bc) => {
  const bare = `json_remove(${base}, '$.gtags', '$.gtagc')`;
  return `(SELECT CASE WHEN COUNT(*) = 0 THEN ${bare}
      WHEN COUNT(c) = 0 THEN json_set(${bare}, '$.gtags', json_group_array(t))
      ELSE json_set(${bare}, '$.gtags', json_group_array(t), '$.gtagc', json_group_object(t, c) FILTER (WHERE c IS NOT NULL)) END
    FROM (SELECT u.t, COALESCE((SELECT value FROM json_each(COALESCE(${bc}, '{}')) WHERE key = u.t),
        (SELECT value FROM json_each(COALESCE(${ac}, '{}')) WHERE key = u.t)) AS c
      FROM (SELECT value AS t FROM json_each(COALESCE(${a}, '[]')) UNION SELECT value FROM json_each(COALESCE(${b}, '[]'))
        ORDER BY t LIMIT ${MAX_GTAGS}) AS u))`;
};

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

export const REFRESH_SOURCE = 'SELECT entries AS j FROM refresh_staging WHERE user_id = ?1 AND page >= ?2';

// users.sync_state (JSON), écrit par chaque finalisation ($.count aussi par GET /api/me pour un classeur d'avant) :
//   count       cartes du classeur (lu aussi par GET /api/me, sans compter les lignes) ;
//   rows        compte exact des exemplaires dans le jeu à la dernière lecture (null : inconnu) ;
//   last_at     obtained_at du plus récent exemplaire (première ligne de la lecture) ;
//   full_at     date de la dernière lecture VÉRIFIÉE complète ;
//   checked_at  date de la dernière vérification (lecture, ou vérification légère) ;
//   read_at     début de la lecture dont le classeur vient (lecture vérifiée ; null : inconnu) : une lecture commencée
//               avant n'est plus appliquée (« superseded ») ;
//   tok         jeton tiré à chaque écriture : les cartes ne sont écrites que si l'état vient d'être remplacé par celui-ci ;
//   complete    résultat du contrôle de la dernière lecture (true, false ou null : pas de compte exact).
export function syncState(user) {
  try {
    const s = JSON.parse(user.sync_state || 'null');
    return s && typeof s === 'object' && !Array.isArray(s) ? s : null;
  } catch {
    return null;
  }
}

// Réponse à une lecture partie avant celle dont le classeur vient déjà (read_at) : rien n'est écrit, le classeur est au
// moins aussi à jour. Même forme qu'une réponse réussie, avec superseded: true ; une ligne au journal.
async function supersededReply(db, user, kind, data, extra = {}) {
  const row = await db.prepare('SELECT sync_state FROM users WHERE id = ?1').bind(user.id).first();
  const count = syncState(row || {})?.count ?? null;
  await writeLog(db, user.id, {
    kind,
    result: 'ok',
    message: 'Lecture remplacée : une lecture plus récente est déjà passée, ton classeur est à jour.',
    data: { ...data, count, superseded: true },
  });
  return { count, fresh: 0, new_ids: [], complete: null, skipped: 0, ...extra, superseded: true };
}

// Applique la collection de la table d'attente, en n'écrivant que les différences, dans une transaction. Les cartes
// ajoutées, revenues ou modifiées et les retraits prennent la révision suivante ; une collection identique à celle en
// place ne fait pas avancer la révision.
// `clear` = requêtes passées dans la même transaction (table d'attente vidée, bail rendu) ; `skipped` = entrées ignorées
// (invalides), recopié dans la réponse.
// exact = {before, after, lastBefore, lastAfter} : compte exact des exemplaires dans le jeu et obtained_at du plus récent,
// lus avant et après la lecture. complete = exemplaires lus (dédoublonnés, invalides compris) = before (null sans compte
// exact) ; moved = compte ou plus récent différents après (la collection a bougé pendant la lecture).
// - Lecture VÉRIFIÉE (complete et pas moved) : la collection est remplacée, cartes retirées comprises.
// - Sinon : les cartes absentes du classeur sont ajoutées ; aucune n'est retirée (une page manquante ne doit jamais
//   effacer de cartes) ; une carte déjà là ne reprend que ses champs de carte du jeu (CARD_FIELDS : catégorie, image,
//   vues…, les mêmes dans tous ses exemplaires), jamais ses nombres d'exemplaires, sa rareté ni ses dates (une partie de
//   ses exemplaires a pu manquer).
// new_ids n'est remplacé que si la lecture apporte au moins une carte nouvelle (une relecture sans nouveauté garde les
// pastilles de la précédente).
// started = début de la lecture : si le classeur vient déjà d'une lecture commencée après (read_at), rien n'est écrit
// (superseded) ; contrôlé dans la transaction même (l'état n'est remplacé que si read_at le permet, et les cartes ne sont
// écrites que s'il l'a été). log = {via} pour la ligne du journal (synclog.js).
// Réponse : {count, fresh, new_ids, complete, skipped, removed, kept} (+ moved: true ; ou superseded: true) ; le journal
// compte aussi les cartes déjà là mises à jour par une lecture non vérifiée (updated).
export async function finalizeImport(db, user, { source, key, exact = {}, started = null, clear = [], skipped = 0, log = {} }) {
  const cte = collectionCte(source);
  // Un passage : cartes distinctes (valides ou non ; une entrée sans identifiant de carte n'en est pas une), entrées
  // invalides, plus récent obtained_at, exemplaires lus (dédoublonnés, d), cartes du classeur (have) et cartes du classeur
  // absentes de la lecture (unseen : retirées par une lecture vérifiée, gardées sinon). Cartes rangées / invalides séparées
  // par une seconde requête seulement s'il y a des entrées invalides.
  const sum = await db.prepare(
    `${cte} SELECT COUNT(DISTINCT card_id) AS ids, COUNT(bad) AS nbad, MAX(json_extract(v, '$.obtained_at')) AS last, COUNT(*) AS rows,
       (SELECT COUNT(*) FROM cards WHERE user_id = ?1) AS have,
       (SELECT COUNT(*) FROM cards WHERE user_id = ?1 AND card_id NOT IN (SELECT card_id FROM e WHERE bad IS NULL AND card_id IS NOT NULL)) AS unseen
     FROM d`,
  ).bind(user.id, key).first();
  const ids = sum ? sum.ids : 0;
  const count = sum && sum.nbad
    ? (await db.prepare(`${cte} SELECT COUNT(DISTINCT card_id) AS n FROM e WHERE bad IS NULL`).bind(user.id, key).first()).n
    : ids;
  if (count > MAX_CARDS) throw new HttpError(400, 'Collection trop grande : 20 000 cartes au plus.');
  if (count === 0) throw new HttpError(400, "Collection vide : rien n'a été lu (ton classeur est inchangé).");
  const invalid = ids - count;
  const complete = Number.isInteger(exact.before) ? sum.rows === exact.before : null;
  const moved = exact.after !== exact.before || (exact.lastAfter ?? null) !== (exact.lastBefore ?? null);
  const verified = complete === true && !moved;
  const have = sum.have || 0;
  const unseen = sum.unseen || 0;
  const fresh = count - (have - unseen); // cartes lues absentes du classeur
  const total = verified ? count : have + fresh;
  if (total > MAX_CARDS) throw new HttpError(400, 'Collection trop grande : 20 000 cartes au plus.');
  // Lecture non vérifiée : cartes déjà là dont un champ de carte du jeu a changé ou qui reçoivent un tag du jeu de plus
  // (mises à jour plus bas), pour le journal.
  const updated = verified ? 0 : (await db.prepare(
    `${cte} SELECT COUNT(*) AS n FROM g JOIN cards AS c ON c.user_id = ?1 AND c.card_id = g.card_id
     WHERE ${cardFieldsDiffer('c.data', 'g.data')} OR EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(g.data, '$.gtags'), '[]')) AS t
       WHERE t.value NOT IN (SELECT value FROM json_each(COALESCE(json_extract(c.data, '$.gtags'), '[]'))))`,
  ).bind(user.id, key).first())?.n ?? 0;
  const prev = syncState(user);
  const tok = randomToken(9);
  const now = nowIso();
  const state = JSON.stringify({
    count: total,
    rows: Number.isInteger(exact.after) ? exact.after : null,
    last_at: exact.lastAfter ?? sum.last ?? null,
    full_at: verified ? now : prev?.full_at ?? null,
    checked_at: now,
    // Une lecture non vérifiée ne dit pas où en est toute la collection : read_at ne bouge pas.
    read_at: verified ? started : prev?.read_at ?? null,
    tok,
    complete: moved ? false : complete,
  });
  // Les cartes ne sont écrites que si l'état vient d'être remplacé par celui-ci (son jeton) ; read_at lu en SQL (une
  // ancienne valeur de sync_state peut ne pas être du JSON).
  const ours = "(SELECT CASE WHEN json_valid(sync_state) THEN json_extract(sync_state, '$.tok') END FROM users WHERE id = ?1) IS ?3";
  const readAt = "CASE WHEN json_valid(sync_state) THEN json_extract(sync_state, '$.read_at') END";
  const newCards = 'SELECT DISTINCT card_id FROM e WHERE bad IS NULL AND card_id NOT IN (SELECT card_id FROM cards WHERE user_id = ?1)';

  const results = await db.batch([
    // new_ids d'abord (avant l'écriture des cartes) : vide à la toute première lecture, gardé sans carte nouvelle.
    db.prepare(
      `${cte} UPDATE users SET
         new_ids = CASE WHEN fetched_at IS NULL THEN '[]' WHEN NOT EXISTS (${newCards}) THEN new_ids
           ELSE (SELECT json_group_array(card_id) FROM (${newCards})) END,
         fetched_at = ?3, sync_state = ?4
       WHERE id = ?1 AND (?5 IS NULL OR ${readAt} IS NULL OR ${readAt} <= ?5) RETURNING new_ids`,
    ).bind(user.id, key, now, state, started),
    // Nouvelles et modifiées (lecture vérifiée : la carte lue remplace l'ancienne, tags du jeu compris s'ils ont été lus ;
    // sinon ceux du classeur restent) ; lecture non vérifiée : nouvelles, et déjà là dont un champ de carte du jeu a changé
    // (seulement ceux-là sont repris) ou qui reçoivent des tags du jeu (réunis, jamais retirés). Une carte inchangée garde
    // sa révision. nd = la carte écrite, od = celle du classeur, gd = celle de la lecture.
    db.prepare(
      `${cte} INSERT INTO cards (user_id, card_id, data, rev)
       SELECT ?1, card_id, nd, ${NEXT_REV} FROM (
         SELECT card_id, od, gd, CASE WHEN od IS NULL THEN gd ELSE ${verified
    ? `CASE WHEN gread OR json_type(od, '$.gtags') IS NULL THEN gd
         WHEN json_type(od, '$.gtagc') IS NULL THEN json_set(gd, '$.gtags', json(json_extract(od, '$.gtags')))
         ELSE json_set(gd, '$.gtags', json(json_extract(od, '$.gtags')), '$.gtagc', json(json_extract(od, '$.gtagc'))) END`
    : withGtags(withCardFields('od', 'gd'), "json_extract(od, '$.gtags')", "json_extract(gd, '$.gtags')", "json_extract(od, '$.gtagc')",
      "json_extract(gd, '$.gtagc')")} END AS nd
         FROM (SELECT g.card_id, g.gread, c.data AS od, g.data AS gd FROM g LEFT JOIN cards AS c ON c.user_id = ?1 AND c.card_id = g.card_id)
       )
       WHERE (od IS NULL OR ${verified ? 'od <> nd' : `${cardFieldsDiffer('od', 'gd')} OR json_extract(nd, '$.gtags') IS NOT json_extract(od, '$.gtags')
         OR json_extract(nd, '$.gtagc') IS NOT json_extract(od, '$.gtagc')`}) AND ${ours}
       ON CONFLICT (user_id, card_id) DO UPDATE SET data = excluded.data, rev = excluded.rev`,
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
    ...log, count: total, fresh, removed: verified ? unseen : 0, kept: verified ? 0 : unseen, ...(verified ? {} : { updated }), read: sum.rows,
    exact: Number.isInteger(exact.before) ? exact.before : null, invalid, skipped, complete, moved: moved || null, ms,
  };
  if (!results[0].results.length) return supersededReply(db, user, 'full', data, { complete });
  await valueAfterCards(db, user.id); // valeur du jour (market.js), au plus une fois par heure
  await writeLog(db, user.id, fullLogEntry(data, verified));
  const res = {
    count: total, fresh, new_ids: raw(results[0].results[0].new_ids || '[]'), complete: moved ? false : complete, skipped, removed: data.removed,
    kept: data.kept,
  };
  if (moved) res.moved = true;
  return res;
}

// Ligne du journal d'une lecture complète appliquée (data : voir finalizeImport).
function fullLogEntry(d, verified) {
  const nouvelles = d.fresh ? `${num(d.fresh)} ${plural(d.fresh, 'nouvelle', 'nouvelles')}` : 'aucune nouvelle';
  const ignored = d.skipped ? ` ; ${num(d.skipped)} ${plural(d.skipped, 'entrée ignorée', 'entrées ignorées')} (sans titre ou rareté inconnue)` : '';
  if (verified) {
    const removed = d.removed ? `${num(d.removed)} ${plural(d.removed, 'retirée', 'retirées')}` : 'aucune retirée';
    return { kind: 'full', result: 'ok', message: `Lecture complète : ${num(d.count)} ${plural(d.count, 'carte', 'cartes')}, ${nouvelles}, ${removed}${ignored}.`, data: d };
  }
  const added = d.fresh ? `${num(d.fresh)} ${plural(d.fresh, 'nouvelle carte ajoutée', 'nouvelles cartes ajoutées')}` : 'aucune nouvelle carte';
  const kept = d.kept ? ` (${num(d.kept)} ${plural(d.kept, 'carte non vue, gardée', 'cartes non vues, gardées')})` : '';
  const updated = d.updated ? `, ${num(d.updated)} ${plural(d.updated, 'carte déjà là mise à jour', 'cartes déjà là mises à jour')} (catégorie du jeu, image, vues…)` : '';
  let head;
  if (d.moved) head = 'Ta collection a bougé pendant la lecture (compte du jeu différent avant et après)';
  else if (d.complete === false) head = `Lecture incomplète : ${num(d.read)} ${plural(d.read, 'exemplaire lu', 'exemplaires lus')}, le jeu en compte ${num(d.exact)}`;
  else head = 'Lecture non vérifiée (pas de compte exact)';
  return {
    kind: 'full',
    result: 'warn',
    message: `${head} : ${added}${updated}, aucune carte retirée${kept}${ignored}. Rafraîchis dans un moment.`,
    data: d,
  };
}
