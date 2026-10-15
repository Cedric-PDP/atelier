// Cartes : entrées brutes du jeu et CarteImport → cartes partielles, lecture de la collection.
// Le regroupement des exemplaires et la comparaison avec la collection en place se font en SQL (import.js).

import { HttpError, raw } from './http.js';
import { base64ToBytes, base64url } from './util.js';

export const MAX_CARDS = 20_000;
export const MAX_PART_CARDS = 500;
export const RARITIES = new Set(['C', 'PC', 'R', 'SR', 'UR', 'L']);

const isHttp = (v) => typeof v === 'string' && v.length <= 2000 && /^https?:\/\//i.test(v);
// Date au format ISO 8601 (comme celles du jeu) : comparées en texte par la finalisation (la plus ancienne gagne).
export const isDate = (v) => typeof v === 'string' && v.length <= 40 && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v);
const isNum = (v) => v === null || (typeof v === 'number' && Number.isFinite(v));
const isText = (v, max) => v === null || (typeof v === 'string' && v.length <= max);

// Mêmes règles pour les deux sources (favori : CarteImport ; rafraîchissement ou favori ancien : entrées brutes) :
// une carte qui ne les respecte pas est ignorée (et comptée dans `skipped`), jamais corrigée.
function validCard(c) {
  if (typeof c.id !== 'string' || !c.id || c.id.length > 100) return null;
  if (typeof c.title !== 'string' || !c.title || c.title.length > 500) return null;
  if (!RARITIES.has(c.rarity)) return null;
  if (!isNum(c.atk) || !isNum(c.def) || !isNum(c.quality) || !isNum(c.pageviews)) return null;
  if (!isText(c.category, 500)) return null;
  if (c.image !== null && !isHttp(c.image)) return null;
  if (c.url !== null && !isHttp(c.url)) return null;
  if (!Number.isInteger(c.count) || c.count < 1 || c.count > 1_000_000) return null;
  if (typeof c.shiny !== 'boolean' || typeof c.starred !== 'boolean') return null;
  if (c.obtained_at !== null && !isDate(c.obtained_at)) return null;
  if (!isText(c.eid, 100)) return null;
  // Forme compacte pour la table d'attente (8 Mo au plus par envoi) : un champ nul ou faux est omis, ce que la
  // finalisation SQL lit pareil (json_extract d'un champ absent = NULL).
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
  if (c.obtained_at !== null) out.obtained_at = c.obtained_at;
  if (c.eid !== null) out.eid = c.eid;
  return out;
}

const opt = (v) => (v === undefined || v === '' ? null : v);

// CarteImport (déjà regroupée par le favori) : seuls les champs connus sont gardés. null si invalide.
export function checkCard(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  return validCard({
    id: c.id,
    title: c.title,
    rarity: c.rarity,
    atk: opt(c.atk),
    def: opt(c.def),
    quality: opt(c.quality),
    pageviews: opt(c.pageviews),
    category: opt(c.category),
    image: opt(c.image),
    url: opt(c.url),
    count: c.count,
    shiny: c.shiny ?? false,
    starred: c.starred ?? false,
    obtained_at: opt(c.obtained_at),
    eid: null,
  });
}

// Entrée brute du jeu → carte partielle (un exemplaire). `eid` = id de l'exemplaire, pour ne pas compter deux fois
// une entrée vue deux fois. Jamais le user_id du jeu ni ses étiquettes. null si l'entrée est invalide.
export function entryToCard(entry) {
  if (!entry || typeof entry !== 'object' || !entry.card || typeof entry.card !== 'object') return null;
  const c = entry.card;
  const id = entry.card_id ?? c.id;
  return validCard({
    id: typeof id === 'number' ? String(id) : id,
    title: c.wikipedia_title,
    rarity: c.rarity,
    atk: opt(c.atk),
    def: opt(c.def),
    quality: opt(c.q_score),
    pageviews: opt(c.pageviews),
    category: opt(c.category),
    image: c.hide_image ? null : opt(c.image_url),
    url: opt(c.wikipedia_url),
    count: entry.count ?? 1,
    shiny: !!entry.is_shiny,
    starred: !!entry.starred,
    obtained_at: opt(entry.obtained_at),
    eid: entry.id === undefined || entry.id === null ? null : String(entry.id),
  });
}

// Ordre des étiquettes : ordre binaire, le même que celui de SQLite (GET /api/cards les trie en SQL).
export function sortTags(list) {
  return [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ---------------------------------------------------------------- révisions (lecture incrémentale)
// users.cards_rev = révision de la liste des cartes. Une opération qui la change (import, synchro rapide, étiquettes)
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
// requête (un seul état de la base) ; le Worker ne décode que deux longues chaînes.
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
  )
  SELECT u.cards_rev AS rev, u.cards_gone_floor AS floor, (SELECT COUNT(*) FROM ch) + (SELECT COUNT(*) FROM gn) AS n,
    (SELECT group_concat(j, ',') FROM (
      SELECT substr(ch.data, 1, length(ch.data) - 1) || ',"tags":' || COALESCE(t.tags, '[]') || '}' AS j
      FROM ch LEFT JOIN t ON t.card_id = ch.card_id ORDER BY ch.card_id
    )) AS cards,
    (SELECT json_group_array(card_id) FROM gn) AS gone
  FROM users AS u WHERE u.id = ?1`;

const encodeCursor = (cardId) => base64url(new TextEncoder().encode(cardId));

function decodeCursor(part) {
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
  const row = await env.DB.prepare(CHANGES).bind(user.id, since).first();
  if (!row || since > row.rev || since < row.floor || row.n > MAX_DELTA) {
    return { rev: row ? row.rev : user.cards_rev, delta: false };
  }
  return {
    rev: row.rev,
    delta: true,
    cards: raw(`[${row.cards ?? ''}]`),
    gone: raw(row.gone || '[]'),
    fetched_at: user.fetched_at,
    new_ids: newIds,
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
