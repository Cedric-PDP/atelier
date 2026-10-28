// Cartes : exemplaires lus dans la base du jeu → cartes partielles, lecture de la collection.
// Le regroupement des exemplaires et la comparaison avec la collection en place se font en SQL (import.js).

import { HttpError, raw } from './http.js';
import { base64ToBytes, base64url, cleanText } from './util.js';

export const MAX_CARDS = 20_000;
export const RARITIES = new Set(['C', 'PC', 'R', 'SR', 'UR', 'L']);
// Raretés de la plus basse à la plus haute : une carte possédée en plusieurs raretés garde la plus haute.
export const RARITY_ORDER = ['C', 'PC', 'R', 'SR', 'UR', 'L'];
// Rang SQL (1 à 6, NULL si inconnue) d'une expression texte, et rareté d'un rang.
export const rankSql = (expr) => `CASE ${expr} ${RARITY_ORDER.map((r, i) => `WHEN '${r}' THEN ${i + 1}`).join(' ')} END`;
export const rarityOfRankSql = (expr) => `CASE ${expr} ${RARITY_ORDER.map((r, i) => `WHEN ${i + 1} THEN '${r}'`).join(' ')} END`;

const isHttp = (v) => typeof v === 'string' && v.length <= 2000 && /^https?:\/\//i.test(v);
// Date au format ISO 8601 (comme celles du jeu) : comparées en texte par la finalisation (la plus ancienne gagne).
export const isDate = (v) => typeof v === 'string' && v.length <= 40 && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v);
const isNum = (v) => v === null || (typeof v === 'number' && Number.isFinite(v));
const isText = (v, max) => v === null || (typeof v === 'string' && v.length <= max);

// Exemplaires d'une carte par rareté d'exemplaire et brillance (« R » : rares, « R* » : rares brillantes), de quoi coter
// chacun (market.js) : {"C*": 1, "R": 2}, clés dans l'ordre binaire (celui de SQLite), somme = count. Une forme invalide
// est seulement oubliée, la carte reste.
const VARIANT_KEY = /^(C|PC|R|SR|UR|L)\*?$/;
export function cleanVariants(v, n) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const keys = Object.keys(v).sort();
  if (!keys.length || keys.length > 12) return null;
  const out = {};
  let sum = 0;
  for (const k of keys) {
    if (!VARIANT_KEY.test(k) || !Number.isInteger(v[k]) || v[k] < 1 || v[k] > 1_000_000) return null;
    out[k] = v[k];
    sum += v[k];
  }
  return sum === n ? out : null;
}

// Une carte qui ne respecte pas ces règles est ignorée (et comptée dans `skipped`), jamais corrigée (seule exception : une
// catégorie du jeu trop longue est coupée avant, par entryToCard).
function validCard(c) {
  if (typeof c.id !== 'string' || !c.id || c.id.length > 100) return null;
  if (typeof c.title !== 'string' || !c.title || c.title.length > 500) return null;
  if (!RARITIES.has(c.rarity)) return null;
  if (!isNum(c.atk) || !isNum(c.def) || !isNum(c.quality) || !isNum(c.pageviews)) return null;
  if (!isText(c.category, MAX_CATEGORY)) return null;
  if (c.image !== null && !isHttp(c.image)) return null;
  if (c.url !== null && !isHttp(c.url)) return null;
  if (!Number.isInteger(c.count) || c.count < 1 || c.count > 1_000_000) return null;
  if (typeof c.shiny !== 'boolean' || typeof c.starred !== 'boolean') return null;
  if (c.obtained_at !== null && !isDate(c.obtained_at)) return null;
  if (!isText(c.eid, 100)) return null;
  if (c.gtags !== null && !Array.isArray(c.gtags)) return null;
  if (c.gtagc !== null && (typeof c.gtagc !== 'object' || Array.isArray(c.gtagc))) return null;
  // Forme compacte pour la table d'attente : un champ nul ou faux est omis, ce que la finalisation SQL lit pareil
  // (json_extract d'un champ absent = NULL).
  const out = { id: c.id, title: c.title, rarity: c.rarity, count: c.count };
  if (c.atk !== null) out.atk = c.atk;
  if (c.def !== null) out.def = c.def;
  if (c.quality !== null) out.quality = c.quality;
  if (c.pageviews !== null) out.pageviews = c.pageviews;
  if (c.category !== null) out.category = c.category;
  if (c.image !== null) out.image = c.image;
  if (c.url !== null) out.url = c.url;
  if (c.shiny) out.shiny = true;
  if (c.starred) out.starred = true;
  // Exemplaires en favori (le jeu refuse d'échanger un exemplaire favori) : facultatif, ignoré s'il est incohérent.
  if (Number.isInteger(c.fav) && c.fav > 0 && c.fav <= c.count) out.fav = c.fav;
  if (c.obtained_at !== null) out.obtained_at = c.obtained_at;
  if (c.eid !== null) out.eid = c.eid;
  const variants = c.variants === null || c.variants === undefined ? null : cleanVariants(c.variants, c.count);
  if (variants) out.variants = variants;
  // Tags du jeu : un tableau, même vide, dit que l'exemplaire les a été lus ; leurs couleurs (gtagc), seulement s'il y en a.
  if (c.gtags !== null) out.gtags = c.gtags;
  if (c.gtagc !== null) out.gtagc = c.gtagc;
  return out;
}

// ---------------------------------------------------------------- tags du jeu
// Étiquettes que le joueur crée lui-même dans le jeu (table `tags` du jeu : id, name, color ; posées sur ses exemplaires
// par `user_card_tags`) : chaque exemplaire lu porte `tags` = [{id, name, color}]. Lu de façon tolérante : un tag est aussi
// une chaîne, un nombre ou un objet {name|label|title|tag|value} (un niveau d'objet en plus : {tag: {name}}). Carte :
// `gtags` = noms, 30 au plus, 60 caractères chacun, sans doublon sur tous ses exemplaires ; `gtagc` = couleur de chacun
// quand le jeu en donne une (« #rrggbb », validée, en minuscules), absent sinon.
export const MAX_GTAGS = 30;
const GTAG_LEN = 60;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const scalar = (v) => typeof v === 'string' || typeof v === 'number';
const tagName = (t) => (t && typeof t === 'object' && !Array.isArray(t) ? t.name || t.label || t.title || t.tag || t.value : t);

// Tags d'un exemplaire (entry.tags) → {names, colors} nettoyés ; un objet sans nom dont l'identifiant n'est pas dans `names`
// est ignoré (jamais un identifiant opaque pris pour un nom).
export function gameTagsOf(raw, names = new Map()) {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const out = [];
  const colors = {};
  for (const t of list) {
    let n = tagName(tagName(t));
    if ((n === undefined || n === null) && t && typeof t === 'object' && names.has(String(t.id))) n = t.id;
    if (!scalar(n)) continue;
    const key = String(n);
    const name = cleanText(names.has(key) ? names.get(key) : key).slice(0, GTAG_LEN).trim();
    if (!name || out.includes(name)) continue;
    out.push(name);
    if (t && typeof t === 'object' && typeof t.color === 'string' && HEX.test(t.color)) colors[name] = t.color.toLowerCase();
    if (out.length >= MAX_GTAGS) break;
  }
  return { names: out, colors: Object.keys(colors).length ? colors : null };
}

const opt = (v) => (v === undefined || v === '' ? null : v);
// Catégorie du jeu (texte affiché sous le titre de la carte) : coupée à 500 caractères plutôt que de faire écarter toute
// la carte (2026-10-18 : une carte possédée ne doit pas manquer au classeur pour un texte trop long) ; une moitié de paire
// de substitution laissée à la fin par la coupe est retirée.
export const MAX_CATEGORY = 500;
function category(v) {
  if (typeof v !== 'string') return opt(v);
  const s = v.length > MAX_CATEGORY ? v.slice(0, MAX_CATEGORY) : v;
  const code = s.charCodeAt(s.length - 1);
  return opt(code >= 0xd800 && code <= 0xdbff ? s.slice(0, -1) : s);
}

// Exemplaire du jeu (refresh.js toEntry : forme de /api/my-collection du jeu) → carte partielle. `eid` = id de
// l'exemplaire, pour ne pas compter deux fois une entrée vue deux fois. Jamais le user_id du jeu. null si l'entrée est
// invalide. Rareté de l'exemplaire (variants) : son snapshot_rarity s'il en a un (rareté au moment où il a été obtenu,
// celle des ventes du marché), sinon celle de la carte. Tags du jeu (gtags) : lus de entry.tags (names : identifiants →
// noms, facultatif).
export function entryToCard(entry, names = new Map()) {
  if (!entry || typeof entry !== 'object' || !entry.card || typeof entry.card !== 'object') return null;
  const c = entry.card;
  const id = entry.card_id ?? c.id;
  const gt = gameTagsOf(entry.tags, names);
  return validCard({
    id: typeof id === 'number' ? String(id) : id,
    title: c.wikipedia_title,
    rarity: c.rarity,
    atk: opt(c.atk),
    def: opt(c.def),
    quality: opt(c.q_score),
    pageviews: opt(c.pageviews),
    category: category(c.category),
    image: c.hide_image ? null : opt(c.image_url),
    url: opt(c.wikipedia_url),
    count: entry.count ?? 1,
    shiny: !!entry.is_shiny,
    starred: !!entry.starred,
    fav: entry.starred ? entry.count ?? 1 : 0,
    obtained_at: opt(entry.obtained_at),
    eid: entry.id === undefined || entry.id === null ? null : String(entry.id),
    variants: { [(RARITIES.has(entry.snapshot_rarity) ? entry.snapshot_rarity : c.rarity) + (entry.is_shiny ? '*' : '')]: entry.count ?? 1 },
    gtags: gt.names,
    gtagc: gt.colors,
  });
}

// Entrée (raw = true : exemplaire du jeu) invalide → marque gardée en attente avec les cartes : la finalisation ne la range
// jamais, mais la compte (cartes distinctes, exemplaires, date) pour vérifier qu'une lecture complète l'est vraiment.
// Sans identifiant de carte exploitable, elle compte comme exemplaire lu, pas comme carte distincte.
export function badCard(item, raw) {
  const o = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
  let id = raw ? (o.card_id ?? (o.card && typeof o.card === 'object' ? o.card.id : undefined)) : o.id;
  if (typeof id === 'number') id = String(id);
  const out = typeof id === 'string' && id && id.length <= 100 ? { id, bad: 1 } : { bad: 1 };
  const eid = raw ? o.id : undefined;
  if (typeof eid === 'number' || (typeof eid === 'string' && eid && eid.length <= 100)) out.eid = String(eid);
  out.count = Number.isInteger(o.count) && o.count >= 1 && o.count <= 1_000_000 ? o.count : 1;
  if (isDate(o.obtained_at)) out.obtained_at = o.obtained_at;
  return out;
}

// Ordre des étiquettes : ordre binaire, le même que celui de SQLite (GET /api/cards les trie en SQL).
export function sortTags(list) {
  return [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ---------------------------------------------------------------- révisions (lecture incrémentale)
// users.cards_rev = révision de la liste des cartes. Une opération qui la change (lecture de la collection, étiquettes)
// écrit ses cartes (cards.rev) et ses retraits (cards_gone.rev) avec la révision suivante, NEXT_REV, puis commitRev
// avance d'un cran, seulement si quelque chose porte cette révision : une opération qui ne change rien ne la fait pas
// avancer. Toujours dans le même lot (transaction D1), ?1 = user_id dans toutes ces requêtes.
export const NEXT_REV = '(SELECT cards_rev + 1 FROM users WHERE id = ?1)';

export function commitRev(db, userId) {
  return db.prepare(
    `UPDATE users SET cards_rev = cards_rev + 1 WHERE id = ?1
       AND (EXISTS (SELECT 1 FROM cards WHERE user_id = ?1 AND rev = users.cards_rev + 1)
         OR EXISTS (SELECT 1 FROM cards_gone WHERE user_id = ?1 AND rev = users.cards_rev + 1))`,
  ).bind(userId);
}

// Au-delà de 1 000 cartes changées ou retirées depuis la révision demandée, la page recharge tout.
export const MAX_DELTA = 1000;

// GET /api/cards : la réponse est assemblée par D1, en morceaux d'environ 1 Mo (une ligne D1 fait 2 Mo au plus) :
// les Cartes stockées (texte JSON) reçoivent leurs étiquettes en SQL et sont recollées telles quelles. Le Worker ne
// décode que quelques longues chaînes, au lieu d'une ligne par carte.
const ALL_CARDS = `WITH t AS (
    SELECT card_id, json_group_array(tag) AS tags
    FROM (SELECT card_id, tag FROM tags WHERE user_id = ?1 ORDER BY card_id, tag)
    GROUP BY card_id
  ),
  j AS (
    SELECT c.card_id, substr(c.data, 1, length(c.data) - 1) || ',"tags":' || COALESCE(t.tags, '[]') || '}' AS j
    FROM cards AS c LEFT JOIN t ON t.card_id = c.card_id
    WHERE c.user_id = ?1
  ),
  k AS (
    SELECT card_id, j, SUM(length(CAST(j AS BLOB))) OVER (ORDER BY card_id) / 1000000 AS grp FROM j
  )
  SELECT group_concat(j, ',') AS part FROM (SELECT j, grp FROM k ORDER BY card_id) GROUP BY grp ORDER BY grp`;

// ?part=… : lecture par pages de 1 000 cartes, par clé (card_id > dernière carte lue) : seules ces cartes et leurs
// étiquettes sont lues. part = « 0 » (ou vide) pour la première page, puis le curseur next_part (texte opaque).
// CROSS JOIN : la page d'abord, puis ses étiquettes par clé (sinon SQLite parcourt toutes celles du compte).
const PAGE_SIZE = 1000;
const PAGE_CARDS = `WITH page AS (
    SELECT card_id, data FROM cards WHERE user_id = ?1 AND card_id > ?2 ORDER BY card_id LIMIT ${PAGE_SIZE + 1}
  ),
  t AS (
    SELECT card_id, json_group_array(tag) AS tags FROM (
      SELECT page.card_id, tags.tag FROM page CROSS JOIN tags ON tags.user_id = ?1 AND tags.card_id = page.card_id
      ORDER BY page.card_id, tags.tag
    ) GROUP BY card_id
  )
  SELECT page.card_id, substr(page.data, 1, length(page.data) - 1) || ',"tags":' || COALESCE(t.tags, '[]') || '}' AS j
  FROM page LEFT JOIN t ON t.card_id = page.card_id ORDER BY page.card_id`;

// ?since=R : cartes changées depuis la révision R (rev > R, avec leurs étiquettes) et cartes retirées depuis
// (cards_gone, sauf celles revenues). Lecture par les index (user_id, rev), MAX_DELTA + 1 lignes au plus de chaque
// côté : le coût ne dépend pas de la taille de la collection. Révision, plancher et changements sont lus dans la même
// requête (un seul état de la base), avec fetched_at et new_ids. Première ligne (grp = 0) : révision, plancher, nombre de
// changements, retraits ; lignes suivantes : les cartes, en morceaux d'environ 1 Mo comme ALL_CARDS (une ligne D1 fait
// 2 Mo au plus, et 1 001 cartes avec de longues catégories et adresses peuvent dépasser). Le Worker ne décode que
// quelques longues chaînes.
const CHANGES = `WITH ch AS (SELECT card_id, data FROM cards WHERE user_id = ?1 AND rev > ?2 LIMIT ${MAX_DELTA + 1}),
  gn AS (
    SELECT g.card_id FROM cards_gone AS g WHERE g.user_id = ?1 AND g.rev > ?2
      AND NOT EXISTS (SELECT 1 FROM cards AS c WHERE c.user_id = ?1 AND c.card_id = g.card_id)
    LIMIT ${MAX_DELTA + 1}
  ),
  t AS (
    SELECT card_id, json_group_array(tag) AS tags FROM (
      SELECT ch.card_id, tags.tag FROM ch CROSS JOIN tags ON tags.user_id = ?1 AND tags.card_id = ch.card_id
      ORDER BY ch.card_id, tags.tag
    ) GROUP BY card_id
  ),
  j AS (
    SELECT ch.card_id, substr(ch.data, 1, length(ch.data) - 1) || ',"tags":' || COALESCE(t.tags, '[]') || '}' AS j
    FROM ch LEFT JOIN t ON t.card_id = ch.card_id
  ),
  k AS (
    SELECT card_id, j, SUM(length(CAST(j AS BLOB))) OVER (ORDER BY card_id) / 1000000 AS grp FROM j
  )
  SELECT 0 AS grp, u.cards_rev AS rev, u.cards_gone_floor AS floor, (SELECT COUNT(*) FROM ch) + (SELECT COUNT(*) FROM gn) AS n,
    (SELECT json_group_array(card_id) FROM gn) AS gone, u.fetched_at AS fetched_at, u.new_ids AS new_ids, NULL AS part
  FROM users AS u WHERE u.id = ?1
  UNION ALL
  SELECT 1 + grp, NULL, NULL, NULL, NULL, NULL, NULL, group_concat(j, ',') FROM (SELECT j, grp FROM k ORDER BY card_id) GROUP BY grp
  ORDER BY 1`;

// Curseur de lecture par pages (?part=…) : aussi celui des cartes d'un autre membre (members.js).
export const encodeCursor = (cardId) => base64url(new TextEncoder().encode(cardId));

export function decodeCursor(part) {
  if (part === '' || part === '0') return '';
  try {
    if (!/^[A-Za-z0-9_-]{2,200}$/.test(part)) throw new Error();
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
    return new TextDecoder('utf-8', { fatal: true }).decode(base64ToBytes(b64));
  } catch {
    throw new HttpError(400, 'Curseur de lecture (part) invalide.');
  }
}

// GET /api/cards?since=R. {rev, delta:false} (rien d'autre) quand la page doit tout recharger : révision inconnue
// (R > rev, base recréée), retraits plus anciens élagués (R < plancher), plus de MAX_DELTA changements.
async function listChanges(env, user, since) {
  const newIds = raw(user.new_ids || '[]');
  if (since > user.cards_rev) return { rev: user.cards_rev, delta: false };
  if (since === user.cards_rev) {
    return { rev: since, delta: true, cards: [], gone: [], fetched_at: user.fetched_at, new_ids: newIds };
  }
  const { results } = await env.DB.prepare(CHANGES).bind(user.id, since).all();
  const row = results[0] && results[0].grp === 0 ? results[0] : null;
  if (!row || since > row.rev || since < row.floor || row.n > MAX_DELTA) {
    return { rev: row ? row.rev : user.cards_rev, delta: false };
  }
  return {
    rev: row.rev,
    delta: true,
    cards: raw(`[${results.slice(1).map((r) => r.part).join(',')}]`),
    gone: raw(row.gone || '[]'),
    fetched_at: row.fetched_at,
    new_ids: raw(row.new_ids || '[]'),
  };
}

// `rev` = users.cards_rev lu à l'authentification, donc AVANT les cartes : un changement fait pendant la lecture
// (entre deux pages) sera renvoyé par la lecture incrémentale suivante. La page garde celui de la première page.
export async function listCards(env, user, _body, request) {
  const params = new URL(request.url).searchParams;
  const part = params.get('part');
  const since = params.get('since');
  if (since !== null) {
    if (part !== null) throw new HttpError(400, '« since » et « part » ne vont pas ensemble.');
    if (!/^\d{1,15}$/.test(since)) throw new HttpError(400, 'Révision (since) invalide : un entier positif ou nul.');
    return listChanges(env, user, Number(since));
  }
  const newIds = raw(user.new_ids || '[]');
  const rev = user.cards_rev;
  if (part === null) {
    const { results } = await env.DB.prepare(ALL_CARDS).bind(user.id).all();
    return { rev, fetched_at: user.fetched_at, cards: raw(`[${results.map((r) => r.part).join(',')}]`), new_ids: newIds };
  }
  const after = decodeCursor(part);
  const { results } = await env.DB.prepare(PAGE_CARDS).bind(user.id, after).all();
  const more = results.length > PAGE_SIZE;
  const rows = more ? results.slice(0, PAGE_SIZE) : results;
  return {
    rev,
    fetched_at: user.fetched_at,
    cards: raw(`[${rows.map((r) => r.j).join(',')}]`),
    new_ids: newIds,
    part,
    next_part: more ? encodeCursor(rows[rows.length - 1].card_id) : null,
  };
}
