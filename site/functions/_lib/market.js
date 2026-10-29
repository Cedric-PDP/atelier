// Le marché : cotes des cartes (cache commun à tous les classeurs), valeur du classeur jour par jour, et dernière
// lecture du marché (bonnes affaires, enchères et ventes du joueur). Contrat : SPEC.md, « Le marché ».
// Le serveur lit la base du jeu (Supabase) avec la session dédiée de chaque membre (marketread.js : à son clic, et par
// les lectures automatiques) ; ici, on vérifie ce qui a été calculé, on range et on montre, et on garde le dernier essai
// (réussi ou non, avec la raison) pour que la page dise quoi faire.
// Calcul : les jointures et les sommes se font dans D1, pas en JavaScript (10 ms visés par requête hors lecture).

import { HttpError, raw } from './http.js';
import { RARITIES, decodeCursor, encodeCursor, isDate } from './cards.js';
import { byteLength, cleanText, nowIso } from './util.js';

export const FRESH_MS = 12 * 3600_000; // une cote lue il y a moins de 12 h n'est pas relue (plan)
export const PLAN_CARDS = 3000; // cartes à coter rendues par le plan (une passe en lit moins ; plus pour FAST_SYNC)
const PLAN_WANTED = 500; // titres des cartes qui manquent aux collections, surveillés aux enchères
const IDS_MAX = 2000; // titres -> card_id gardés par compte
export const PART_PRICES = 500; // cotes par envoi
// Bonnes affaires gardées par lecture du marché (2026-10-24 : 50 avant) : les meilleures remises, la page les filtre.
export const DEALS_MAX = 150;
// Quotas du jour des cotes : une cote = une ligne écrite (et son index). Abonnement payant (2026-10-17) : 50 millions
// de lignes écrites par mois comprises ; avant, D1 gratuit (100 000 par jour pour tout) imposait 3 000 et 30 000.
export const QUOTA_USER = 15000;
export const QUOTA_ALL = 150000;
const VALUE_GAP = 3600_000; // après un import, la valeur du jour est recalculée au plus une fois par heure
// La lecture du marché est montrée (avec son âge) puis oubliée au bout de 7 jours : la page dit qu'elle est vieille bien
// avant (les enchères changent vite), mais les mises et les ventes du joueur restent utiles.
const LIVE_MS = 7 * 86400_000;
const LIVE_BYTES = 256 * 1024;
// Lecture automatique : jamais à moins de 5 min du début de la précédente pour un classeur, d'où qu'elle vienne.
export const AUTO_GAP = 5 * 60_000;
const WHY_MAX = 300;
const VERSION = /^[A-Za-z0-9._-]{1,20}$/;
const HISTORY_DAYS = 400;
const MAX_AMOUNT = 1e9;
// Rareté d'un exemplaire, « * » pour une brillante : clé des cotes d'une carte et des exemplaires d'une carte.
export const VARIANT = /^(C|PC|R|SR|UR|L)\*?$/;
const CARD_ID = /^[A-Za-z0-9_-]{1,100}$/;
const PAGE_SIZE = 1000;

const today = () => nowIso().slice(0, 10);
const amount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_AMOUNT;
const count = (v) => Number.isInteger(v) && v >= 1 && v <= 1_000_000;
const bad = (msg) => new HttpError(400, msg);

// ---------------------------------------------------------------- valeur du classeur
// Valeur = Σ cote fiable (3 ventes au moins) × exemplaires, par rareté d'exemplaire et brillance. Carte sans détail de
// ses exemplaires (`variants`, importée avant lui, sans détail de ses exemplaires) : approchée, tous
// ses exemplaires dans sa plus haute rareté, un seul brillant si elle l'est (`approx` les compte).
const VALUE = `WITH c AS (SELECT card_id, data FROM cards WHERE user_id = ?1),
  v AS (
    SELECT c.card_id, k.key AS k, k.value AS n, 0 AS approx FROM c, json_each(c.data, '$.variants') AS k
      WHERE json_type(c.data, '$.variants') = 'object'
    UNION ALL
    SELECT card_id, json_extract(data, '$.rarity'), json_extract(data, '$.count') - (CASE WHEN json_extract(data, '$.shiny') THEN 1 ELSE 0 END), 1
      FROM c WHERE json_type(data, '$.variants') IS NOT 'object'
    UNION ALL
    SELECT card_id, json_extract(data, '$.rarity') || '*', 1, 1
      FROM c WHERE json_type(data, '$.variants') IS NOT 'object' AND json_extract(data, '$.shiny')
  ),
  x AS (
    SELECT v.card_id, v.n, v.approx, json_extract(p.data, '$."' || v.k || '".p') AS price, json_extract(p.data, '$."' || v.k || '".n') AS sales
    FROM v LEFT JOIN prices AS p ON p.card_id = v.card_id WHERE v.n > 0
  )
  SELECT CAST(ROUND(COALESCE(SUM(CASE WHEN sales >= 3 THEN n * price END), 0)) AS INTEGER) AS value,
    COUNT(DISTINCT CASE WHEN sales >= 3 THEN card_id END) AS priced,
    (SELECT COUNT(*) FROM c) AS cards,
    COUNT(DISTINCT CASE WHEN approx = 1 THEN card_id END) AS approx
  FROM x`;

const SAVE_VALUE = `INSERT INTO value_history (user_id, date, value, priced, cards, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
  ON CONFLICT (user_id, date) DO UPDATE SET value = excluded.value, priced = excluded.priced, cards = excluded.cards, at = excluded.at`;

async function computeValue(db, userId) {
  const r = await db.prepare(VALUE).bind(userId).first();
  return { value: r ? r.value : 0, priced: r ? r.priced : 0, cards: r ? r.cards : 0, approx: r ? r.approx : 0 };
}

// Point du jour (le dernier du jour remplace les précédents) : écrit s'il change, ou toujours (`touch`, pour dater le
// dernier calcul). Rien tant qu'aucune carte n'est cotée et qu'il n'y a pas de point ce jour-là.
async function saveValue(db, userId, v, prev, touch) {
  if (!prev && !v.priced) return;
  if (prev && !touch && prev.value === v.value && prev.priced === v.priced && prev.cards === v.cards) return;
  await db.batch([
    db.prepare(SAVE_VALUE).bind(userId, today(), v.value, v.priced, v.cards, nowIso()),
    db.prepare('DELETE FROM value_history WHERE user_id = ?1 AND date < ?2')
      .bind(userId, new Date(Date.now() - HISTORY_DAYS * 86400_000).toISOString().slice(0, 10)),
  ]);
}

const TODAY_POINT = 'SELECT value, priced, cards, at FROM value_history WHERE user_id = ?1 AND date = ?2';

// Après une lecture complète de la collection (import.js) : la valeur du jour, au plus une fois par heure, et seulement si
// des cotes existent. Une erreur ici ne fait jamais échouer l'import (il est déjà écrit).
export async function valueAfterCards(db, userId) {
  try {
    const row = await db.prepare(`SELECT h.value, h.priced, h.cards, h.at, EXISTS (SELECT 1 FROM prices) AS anyp
      FROM (SELECT 1) LEFT JOIN value_history AS h ON h.user_id = ?1 AND h.date = ?2`).bind(userId, today()).first();
    if (!row || !row.anyp) return;
    if (row.at && Date.now() - Date.parse(row.at) < VALUE_GAP) return;
    await saveValue(db, userId, await computeValue(db, userId), row.at ? row : null, true);
  } catch (err) {
    console.error(err);
  }
}

// ---------------------------------------------------------------- plan d'une passe
// Table wt(t) : titres des éléments vérifiés des collections de ?1 absents des titres de ses cartes, sans ordre ni limite
// (enchères de la lecture du marché entier, marketscan.js).
export const WANTED_TITLES = `wt AS (
    SELECT DISTINCT json_extract(i.value, '$.title') AS t FROM targets AS t0, json_each(t0.items) AS i
    WHERE t0.user_id = ?1 AND i.type = 'object' AND coalesce(json_extract(i.value, '$.status'), 'ok') = 'ok'
      AND typeof(json_extract(i.value, '$.title')) = 'text' AND length(json_extract(i.value, '$.title')) BETWEEN 1 AND 300
      AND json_extract(i.value, '$.title') NOT IN (SELECT json_extract(data, '$.title') FROM cards WHERE user_id = ?1 AND json_type(data, '$.title') = 'text')
  )`;
// Cartes possédées et cartes voulues dont le card_id est connu, cote absente ou de plus de 12 h, la plus ancienne
// d'abord (les possédées avant les voulues à égalité) : une passe s'arrête au plafond de ses requêtes, la suivante
// reprend là. stale / fresh : nombre de cartes à coter et déjà cotées il y a moins de 12 h. Cartes voulues : titres
// résolus (market.ids), et cartes en vente (auctions_live) dont le titre manque à ses collections.
const PLAN = `WITH ${WANTED_TITLES}, own AS (SELECT card_id AS id, 0 AS w FROM cards WHERE user_id = ?1),
  want AS (SELECT j.value AS id, 1 AS w FROM market AS m, json_each(m.ids) AS j
    WHERE m.user_id = ?1 AND j.type = 'text' AND j.value <> ''
    UNION ALL SELECT DISTINCT l.card_id, 1 FROM wt JOIN auctions_live AS l ON l.title = wt.t WHERE l.seller <> ?1),
  x AS MATERIALIZED (
    SELECT a.id, a.w, p.read_at AS at FROM (SELECT id, MIN(w) AS w FROM (SELECT * FROM own UNION ALL SELECT * FROM want) GROUP BY id) AS a
    LEFT JOIN prices AS p ON p.card_id = a.id
  )
  SELECT 0 AS h, NULL AS id, (SELECT COUNT(*) FROM x WHERE at IS NULL OR at < ?2) AS stale, (SELECT COUNT(*) FROM x WHERE at >= ?2) AS fresh
  UNION ALL
  SELECT * FROM (SELECT 1, id, NULL, NULL FROM x WHERE at IS NULL OR at < ?2 ORDER BY at IS NOT NULL, at, w, id LIMIT ?3)`;

// Rang de chaque collection dans « Mes collections » (pos, puis celles sans place, comme GET /api/targets). Clé de
// priorité d'un élément : r * 10 000 000 + sa place dans la collection (1,7 Mo au plus : bien moins de 10 000 000).
export const WANT_ORDER = `o AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY pos IS NULL, pos, created_at, id) AS r FROM targets WHERE user_id = ?1
  )`;
// Titres des cartes qui manquent aux collections (éléments vérifiés, titre absent des cartes du classeur), collection
// par collection dans l'ordre de « Mes collections », puis dans l'ordre de chaque collection ; un titre présent dans
// plusieurs collections prend la place de la première. Rapprochement par titre seulement : le serveur n'a
// pas les qids des cartes (une carte possédée sous un autre titre est écartée plus tard, par son card_id). Aussi lu par la
// liste de souhaits du jeu (wishlist.js), avec une autre limite.
export const wantedSql = (limit, wishOnly = false) => `WITH ${WANT_ORDER}, it AS (
    SELECT json_extract(i.value, '$.title') AS t, o.r * 10000000 + CAST(i.key AS INTEGER) AS p
    FROM targets AS t0 JOIN o ON o.id = t0.id, json_each(t0.items) AS i
    WHERE t0.user_id = ?1 ${wishOnly ? "AND (t0.wish_sync = 1 OR EXISTS (SELECT 1 FROM users WHERE id = ?1 AND wish_mode = 'all'))" : ''} AND i.type = 'object' AND coalesce(json_extract(i.value, '$.status'), 'ok') = 'ok'
  )
  SELECT t FROM it
  WHERE typeof(t) = 'text' AND length(t) BETWEEN 1 AND 300
    AND t NOT IN (SELECT json_extract(data, '$.title') FROM cards WHERE user_id = ?1 AND json_type(data, '$.title') = 'text')
  GROUP BY t ORDER BY MIN(p) LIMIT ${limit}`;
const WANTED = wantedSql(PLAN_WANTED);

const QUOTA = "SELECT user_id, quota_day, quota_n FROM market WHERE user_id IN (?1, '*')";

function quotaLeft(rows, userId) {
  const d = today();
  const used = (id) => {
    const r = rows.find((x) => x.user_id === id);
    return r && r.quota_day === d ? r.quota_n : 0;
  };
  return Math.max(0, Math.min(QUOTA_USER - used(userId), QUOTA_ALL - used('*')));
}

const parseIds = (text) => {
  try {
    const o = JSON.parse(text || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
};

// Dernier essai (colonne market.attempt, texte JSON) : {start, v, auto} posé par le plan, puis {end, ok} à la fin
// (cotes écrites avec last : ok = true ; échec : ok = false et why, la raison dite au joueur). Rien du jeu (ni jeton ni
// identifiant) : des heures, qui a lu (v) et un message.
const parseAttempt = (text) => {
  try {
    const o = JSON.parse(text || 'null');
    return o && typeof o === 'object' && !Array.isArray(o) && typeof o.start === 'string' ? o : null;
  } catch {
    return null;
  }
};
// v : « serveur » ; les essais d'avant la lecture par le serveur gardent leur version (un entier, ou un texte court).
const cleanVersion = (v) => (Number.isInteger(v) && v >= 0 && v < 1e6 ? v : typeof v === 'string' && VERSION.test(v) ? v : null);
export const READER = 'serveur';
const SET_ATTEMPT = `INSERT INTO market (user_id, attempt) VALUES (?1, ?2)
  ON CONFLICT (user_id) DO UPDATE SET attempt = excluded.attempt`;

// Dernier essai du compte (null s'il n'y en a jamais eu).
export async function lastAttempt(db, userId) {
  const row = await db.prepare('SELECT attempt FROM market WHERE user_id = ?1').bind(userId).first();
  return parseAttempt(row && row.attempt);
}

// Début de la dernière passe complète (2026-10-23) : une passe légère (au clic, light : true) garde dans full celui de la
// passe complète d'avant (null s'il n'y en a pas eu) ; c'est lui que regardent les lectures automatiques, pour qu'un clic
// ne repousse jamais la relecture des cotes du plan.
export const fullStart = (a) => (a ? (a.light ? a.full ?? null : a.start) : null);
export const FULL_START_SQL = (col) => `CASE WHEN json_valid(${col}) THEN CASE WHEN json_extract(${col}, '$.light')
  THEN json_extract(${col}, '$.full') ELSE json_extract(${col}, '$.start') END END`;

// Ce qu'une passe doit lire : {cards: [card_id…], stale, fresh, wanted: [titre…], ids: {titre: card_id | ""}, quota}.
// auto : lecture automatique, refusée ({skip: true, until}, rien d'autre de lu ni d'écrit) si une passe complète de ce
// classeur a commencé il y a moins de 5 min. Sinon l'essai est noté (start, v, auto ; light et full pour une passe
// légère) : la page voit qu'une lecture a commencé, puis comment elle a fini. cards : nombre de cartes à coter rendues
// au plus (0 pour une passe légère : seulement stale et fresh).
export async function planFor(db, user, { auto = false, light = false, cards = PLAN_CARDS } = {}) {
  const row = await db.prepare('SELECT ids, attempt FROM market WHERE user_id = ?1').bind(user.id).first();
  const prev = parseAttempt(row && row.attempt);
  const since = Date.parse(fullStart(prev) || '');
  if (auto && since > Date.now() - AUTO_GAP && since <= Date.now() + 60_000) {
    return { skip: true, until: new Date(since + AUTO_GAP).toISOString() };
  }
  const cutoff = new Date(Date.now() - FRESH_MS).toISOString();
  const attempt = light ? { start: nowIso(), v: READER, auto: false, light: true, full: fullStart(prev) } : { start: nowIso(), v: READER, auto: !!auto };
  const [plan, wanted, quota] = await db.batch([
    db.prepare(PLAN).bind(user.id, cutoff, light ? 0 : cards),
    db.prepare(WANTED).bind(user.id),
    db.prepare(QUOTA).bind(user.id),
    db.prepare(SET_ATTEMPT).bind(user.id, JSON.stringify(attempt)),
  ]);
  const head = plan.results.find((r) => r.h === 0) || { stale: 0, fresh: 0 };
  const titles = wanted.results.map((r) => r.t);
  const known = parseIds(row && row.ids);
  const ids = {};
  for (const t of titles) if (typeof known[t] === 'string') ids[t] = known[t];
  return {
    cards: plan.results.filter((r) => r.h === 1).map((r) => r.id),
    stale: head.stale,
    fresh: head.fresh,
    wanted: titles,
    ids,
    quota: quotaLeft(quota.results, user.id),
  };
}

// Échec d'une passe : sa raison (le message dit au joueur), nettoyée, 300 caractères au plus ; un texte qui ressemble à
// un jeton (JWT) est masqué par prudence.
export async function writeFail(db, user, { why, auto = false }) {
  const text = cleanText(String(why ?? '')).replace(/eyJ[\w-]{8,}(\.[\w-]*){1,2}/g, '[jeton masqué]').slice(0, WHY_MAX) || 'Erreur inconnue.';
  const prev = await lastAttempt(db, user.id);
  const now = nowIso();
  await db.prepare(SET_ATTEMPT).bind(user.id, JSON.stringify({
    start: prev ? prev.start : now,
    v: prev ? cleanVersion(prev.v) ?? READER : READER,
    auto: !!auto,
    ...(prev && prev.light ? { light: true, full: prev.full ?? null } : {}),
    end: now,
    ok: false,
    why: text,
  })).run();
}

// ---------------------------------------------------------------- cotes (cache commun, sans user_id)
// Une cote par rareté d'exemplaire (« R », « R* » brillante) : {p: médiane des 30 ventes les plus récentes, n: ventes
// lues, w: médiane d'il y a 7 jours (null : moins de 3 ventes avant), l: dernière vente, d: sa date}. Fiable à partir
// de 3 ventes (n ≥ 3). Carte sans vente lue : {} (elle est datée, pour ne pas être relue tout de suite).
function cleanPriceEntry(e, i) {
  const where = `Cote n° ${i + 1}`;
  if (!e || typeof e !== 'object' || Array.isArray(e)) throw bad(`${where} invalide.`);
  if (typeof e.id !== 'string' || !CARD_ID.test(e.id)) throw bad(`${where} : identifiant de carte invalide.`);
  const v = e.v;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad(`${where} : cotes absentes.`);
  const keys = Object.keys(v);
  if (keys.length > 12) throw bad(`${where} : trop de raretés.`);
  const soon = Date.now() + 86400_000;
  const out = {};
  for (const k of keys.sort()) {
    const x = v[k];
    if (!VARIANT.test(k)) throw bad(`${where} : rareté inconnue (« ${k.slice(0, 10)} »).`);
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw bad(`${where} : cote ${k} invalide.`);
    if (!amount(x.p) || !count(x.n) || !(x.w === null || x.w === undefined || amount(x.w)) || !amount(x.l)) {
      throw bad(`${where} : montants ou nombre de ventes hors bornes (${k}).`);
    }
    if (!isDate(x.d) || !(Date.parse(x.d) <= soon)) throw bad(`${where} : date de la dernière vente invalide (${k}).`);
    out[k] = { p: Math.round(x.p * 100) / 100, n: x.n, w: x.w === null || x.w === undefined ? null : Math.round(x.w * 100) / 100, l: Math.round(x.l * 100) / 100, d: x.d };
  }
  return [e.id, JSON.stringify(out)];
}

// Cotes lues par une passe, [{id, v}] : 500 au plus par appel, contrôlées (cleanPriceEntry), remplacées en entier (une
// carte relue a toutes ses ventes récentes), datées de maintenant. Quotas du jour : 15 000 par compte, 150 000 pour tout
// le site (429 au-delà, rien d'écrit). last : fin de la passe, la valeur du jour de ce classeur est recalculée et son
// essai noté fini (ok ; un échec noté ensuite par writeFail le remplace).
export async function writePrices(db, user, list, last = false) {
  if (!Array.isArray(list)) throw bad('Il manque les cotes.');
  if (list.length > PART_PRICES) throw bad(`${PART_PRICES} cotes au plus par envoi.`);
  const rows = list.map(cleanPriceEntry);
  const seen = new Set(rows.map((r) => r[0]));
  if (seen.size !== rows.length) throw bad('Une carte est cotée deux fois dans le même envoi.');
  const { results } = await db.prepare(QUOTA).bind(user.id).all();
  const left = quotaLeft(results, user.id);
  if (rows.length > left) {
    throw new HttpError(429, `Quota du jour des cotes atteint (${QUOTA_USER} par classeur, ${QUOTA_ALL} pour tout le site) : la suite demain. Rien n'a été écrit pour cet envoi.`, { quota: left });
  }
  const now = nowIso();
  const d = today();
  const bump = `INSERT INTO market (user_id, quota_day, quota_n) VALUES (?1, ?2, ?3)
    ON CONFLICT (user_id) DO UPDATE SET quota_n = CASE WHEN market.quota_day = excluded.quota_day THEN market.quota_n + excluded.quota_n ELSE excluded.quota_n END,
      quota_day = excluded.quota_day`;
  if (rows.length) {
    await db.batch([
      db.prepare(`INSERT INTO prices (card_id, data, read_at)
        SELECT json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), ?2 FROM json_each(?1) AS j WHERE true
        ON CONFLICT (card_id) DO UPDATE SET data = excluded.data, read_at = excluded.read_at`).bind(JSON.stringify(rows), now),
      db.prepare(bump).bind(user.id, d, rows.length),
      db.prepare(bump).bind('*', d, rows.length),
    ]);
  }
  if (last === true) {
    const prev = await db.prepare(TODAY_POINT).bind(user.id, d).first();
    await saveValue(db, user.id, await computeValue(db, user.id), prev, true);
    await db.prepare(`UPDATE market SET attempt = json_remove(json_set(attempt, '$.end', ?2, '$.ok', json('true')), '$.why')
      WHERE user_id = ?1 AND json_valid(attempt)`).bind(user.id, nowIso()).run();
  }
  return { written: rows.length, quota: left - rows.length };
}

// ---------------------------------------------------------------- lecture du marché, montrée par la page
// Ce que la dernière passe a lu, pour l'onglet « Marché » : bonnes affaires (enchères en cours sur des
// cartes qui manquent aux collections, la meilleure par carte ; more = autres enchères intéressantes sur la même carte),
// enchères posées par le joueur et ses ventes. Une ligne par compte, remplacée à chaque passage, oubliée au bout de
// 7 jours. Jamais l'identifiant du joueur dans le jeu ni celui des enchérisseurs.
const text = (v, max) => typeof v === 'string' && v.length >= 1 && v.length <= max;
const FIELDS = {
  a: (v) => text(v, 64) && /^[A-Za-z0-9_-]+$/.test(v), // identifiant de l'enchère
  id: (v) => typeof v === 'string' && CARD_ID.test(v),
  t: (v) => text(v, 300),
  r: (v) => RARITIES.has(v),
  s: (v) => typeof v === 'boolean',
  img: (v) => v === null || (typeof v === 'string' && v.length <= 2000 && /^https:\/\//i.test(v)),
  end: (v) => isDate(v),
  cote: (v) => v === null || amount(v),
  n: (v) => v === null || count(v),
  ask: amount,
  bid: (v) => typeof v === 'boolean',
  lead: (v) => typeof v === 'boolean',
  mine: amount,
  cur: (v) => v === null || amount(v),
  base: amount,
  more: (v) => v === 0 || count(v),
};
// Valeur d'un champ absent : null pour ceux qui peuvent l'être ; more = 0.
const ABSENT = { img: null, cote: null, n: null, cur: null, more: 0 };
const KINDS = {
  deals: { max: DEALS_MAX, fields: ['a', 'id', 't', 'r', 's', 'img', 'end', 'cote', 'n', 'ask', 'bid', 'lead', 'more'], st: null },
  bids: { max: 100, fields: ['a', 'id', 't', 'r', 's', 'img', 'end', 'cote', 'n', 'mine', 'cur', 'lead'], st: new Set(['run', 'won', 'lost', 'off']) },
  sales: { max: 100, fields: ['a', 'id', 't', 'r', 's', 'img', 'end', 'cote', 'n', 'base', 'cur', 'bid'], st: new Set(['run', 'sold', 'unsold', 'off']) },
};

function cleanLive(body) {
  const out = {};
  for (const [kind, spec] of Object.entries(KINDS)) {
    const list = body[kind] === undefined ? [] : body[kind];
    if (!Array.isArray(list) || list.length > spec.max) throw bad(`« ${kind} » : une liste de ${spec.max} au plus.`);
    out[kind] = list.map((x, i) => {
      if (!x || typeof x !== 'object' || Array.isArray(x)) throw bad(`« ${kind} » n° ${i + 1} invalide.`);
      const o = {};
      for (const f of spec.fields) {
        const v = x[f] === undefined && Object.hasOwn(ABSENT, f) ? ABSENT[f] : x[f];
        if (!FIELDS[f](v)) throw bad(`« ${kind} » n° ${i + 1} : champ « ${f} » invalide.`);
        o[f] = v;
      }
      if (spec.st) {
        if (!spec.st.has(x.st)) throw bad(`« ${kind} » n° ${i + 1} : état inconnu.`);
        o.st = x.st;
      }
      return o;
    });
  }
  return out;
}

// Lecture du marché d'une passe, {ids?, deals?, bids?, sales?}, contrôlée (cleanLive). ids : titres des cartes voulues ->
// card_id du jeu ("" : aucune carte de ce titre), ajoutés à ceux déjà connus (2 000 au plus). 256 Ko au plus (413 ;
// la passe allège sa lecture avant). Les lectures de plus de 7 jours de tous les comptes sont effacées au passage.
export async function writeLive(db, user, body) {
  const ids = body.ids === undefined ? {} : body.ids;
  if (!ids || typeof ids !== 'object' || Array.isArray(ids)) throw bad('« ids » : un objet {titre: identifiant}.');
  const fresh = Object.entries(ids);
  if (fresh.length > PLAN_WANTED) throw bad(`« ids » : ${PLAN_WANTED} titres au plus.`);
  for (const [t, id] of fresh) {
    if (!text(t, 300) || !(id === '' || (typeof id === 'string' && CARD_ID.test(id)))) throw bad('« ids » : titre ou identifiant invalide.');
  }
  const live = JSON.stringify(cleanLive(body));
  if (byteLength(live) > LIVE_BYTES) throw new HttpError(413, 'Lecture du marché trop volumineuse : 256 Ko au plus.');
  const row = await db.prepare('SELECT ids FROM market WHERE user_id = ?1').bind(user.id).first();
  const merged = { ...parseIds(row && row.ids) };
  for (const [t, id] of fresh) {
    delete merged[t];
    merged[t] = id; // les plus récents en dernier : ce sont eux qui restent
  }
  const keys = Object.keys(merged);
  const kept = Object.fromEntries(keys.slice(Math.max(0, keys.length - IDS_MAX)).map((k) => [k, merged[k]]));
  const now = nowIso();
  await db.batch([
    db.prepare(`INSERT INTO market (user_id, ids, live, live_at) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT (user_id) DO UPDATE SET ids = excluded.ids, live = excluded.live, live_at = excluded.live_at`).bind(user.id, JSON.stringify(kept), live, now),
    db.prepare('UPDATE market SET live = NULL, live_at = NULL WHERE live_at < ?1').bind(new Date(Date.now() - LIVE_MS).toISOString()),
  ]);
  return { ok: true, known: Object.keys(kept).length };
}

// La dernière lecture du marché changée sans attendre la suivante (mise en vente, annulation ou mise depuis le classeur,
// sell.js, bid.js) : edit(lv) rend la nouvelle lecture {deals, bids, sales}, contrôlée comme une lecture (cleanLive). Rien
// sans lecture gardée ; jamais par-dessus une lecture arrivée entre-temps (live_at comparé), dont l'heure reste celle de
// la lecture.
export async function patchLive(db, user, edit) {
  const row = await db.prepare('SELECT live, live_at FROM market WHERE user_id = ?1').bind(user.id).first();
  if (!row || !row.live || !(row.live_at >= new Date(Date.now() - LIVE_MS).toISOString())) return false;
  let lv;
  try {
    lv = JSON.parse(row.live);
  } catch {
    return false;
  }
  for (const kind of Object.keys(KINDS)) if (!Array.isArray(lv[kind])) lv[kind] = [];
  lv = edit(lv);
  for (const [kind, spec] of Object.entries(KINDS)) lv[kind] = (Array.isArray(lv[kind]) ? lv[kind] : []).slice(0, spec.max);
  const live = JSON.stringify(cleanLive(lv));
  if (byteLength(live) > LIVE_BYTES) return false;
  const done = await db.prepare('UPDATE market SET live = ?2 WHERE user_id = ?1 AND live_at = ?3').bind(user.id, live, row.live_at).run();
  return !!(done.meta && done.meta.changes);
}
// « Tes ventes » seulement : edit(sales) rend la nouvelle liste.
export const patchLiveSales = (db, user, edit) => patchLive(db, user, (lv) => ({ ...lv, sales: edit(lv.sales) }));

// ---------------------------------------------------------------- la page (clé principale)
// GET /api/market : valeur du classeur (calculée maintenant, et le point du jour mis à jour s'il a changé : les cotes ont
// pu bouger depuis, relues par un autre membre), son historique (un point par jour), la dernière lecture du marché (de
// moins de 7 jours) et le dernier essai (attempt : {start, end?, ok?, why?, v, auto}, null s'il n'y en a
// jamais eu).
export async function getMarket(env, user) {
  const db = env.DB;
  const v = await computeValue(db, user.id);
  const [prev, hist, live] = await db.batch([
    db.prepare(TODAY_POINT).bind(user.id, today()),
    db.prepare(`SELECT date, value, priced, cards FROM value_history WHERE user_id = ?1 ORDER BY date DESC LIMIT ${HISTORY_DAYS}`).bind(user.id),
    db.prepare('SELECT live, live_at, attempt FROM market WHERE user_id = ?1').bind(user.id),
  ]);
  await saveValue(db, user.id, v, prev.results[0] || null, false);
  // L'historique lu avant l'écriture : son point du jour prend la valeur qui vient d'être écrite.
  const history = hist.results.reverse();
  const last = history[history.length - 1];
  const point = { date: today(), value: v.value, priced: v.priced, cards: v.cards };
  if (last && last.date === point.date) Object.assign(last, point);
  else if (v.priced) history.push(point);
  const l = live.results[0];
  const kept = !!(l && l.live && l.live_at >= new Date(Date.now() - LIVE_MS).toISOString());
  return { value: v, history, live: kept ? raw(l.live) : null, live_at: kept ? l.live_at : null, attempt: parseAttempt(l && l.attempt) };
}

// GET /api/market/prices?part=X : cotes des cartes du classeur et des cartes voulues dont le card_id est connu (t : leur
// titre dans les collections), par pages de 1 000 (curseur comme GET /api/cards).
const PRICES_PAGE = `WITH ids AS (
    SELECT card_id AS id, NULL AS t FROM cards WHERE user_id = ?1 AND card_id > ?2
    UNION ALL
    SELECT j.value, j.key FROM market AS m, json_each(m.ids) AS j WHERE m.user_id = ?1 AND j.type = 'text' AND j.value > ?2
  )
  SELECT ids.id, MAX(ids.t) AS t, p.data, p.read_at FROM ids JOIN prices AS p ON p.card_id = ids.id
  GROUP BY ids.id ORDER BY ids.id LIMIT ${PAGE_SIZE + 1}`;

export async function listPrices(env, user, _body, request) {
  const part = new URL(request.url).searchParams.get('part') ?? '0';
  const after = decodeCursor(part);
  const { results } = await env.DB.prepare(PRICES_PAGE).bind(user.id, after).all();
  const more = results.length > PAGE_SIZE;
  const rows = more ? results.slice(0, PAGE_SIZE) : results;
  const one = (r) => `{"id":${JSON.stringify(r.id)},"v":${r.data},"at":${JSON.stringify(r.read_at)}${r.t ? `,"t":${JSON.stringify(r.t)}` : ''}}`;
  return { prices: raw(`[${rows.map(one).join(',')}]`), part, next_part: more ? encodeCursor(rows[rows.length - 1].id) : null };
}
