// Cartes : entrées brutes du jeu et CarteImport → cartes partielles, lecture de la collection.
// Le regroupement des exemplaires et la comparaison avec la collection en place se font en SQL (import.js).

import { HttpError, raw } from './http.js';

export const MAX_CARDS = 20_000;
export const MAX_PART_CARDS = 500;
export const RARITIES = new Set(['C', 'PC', 'R', 'SR', 'UR', 'L']);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === 'string' && v !== '' ? v : null);
const isHttp = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);
// Date au format ISO 8601 (comme celles du jeu) : comparées en texte par la finalisation (la plus ancienne gagne).
const isDate = (v) => typeof v === 'string' && v.length <= 40 && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v);

function cardIdOf(entry) {
  const id = entry.card_id ?? entry.card?.id;
  if ((typeof id !== 'string' && typeof id !== 'number') || id === '') return null;
  const s = String(id);
  return s.length <= 100 ? s : null;
}

// Entrée brute du jeu → carte partielle (un exemplaire). `eid` = id de l'exemplaire, pour ne pas compter deux fois
// une entrée vue deux fois. Jamais le user_id du jeu ni ses étiquettes. null si l'entrée est inexploitable.
export function entryToCard(entry) {
  if (!entry || typeof entry !== 'object' || !entry.card || typeof entry.card !== 'object') return null;
  const id = cardIdOf(entry);
  if (!id) return null;
  const c = entry.card;
  const n = Number(entry.count);
  return {
    id,
    title: str(c.wikipedia_title),
    rarity: str(c.rarity),
    atk: num(c.atk),
    def: num(c.def),
    quality: num(c.q_score),
    pageviews: num(c.pageviews),
    category: str(c.category),
    image: c.hide_image ? null : isHttp(c.image_url) ? c.image_url : null,
    url: isHttp(c.wikipedia_url) ? c.wikipedia_url : null,
    count: Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1,
    shiny: !!entry.is_shiny,
    starred: !!entry.starred,
    obtained_at: isDate(entry.obtained_at) ? entry.obtained_at : null,
    eid: entry.id === undefined || entry.id === null ? null : String(entry.id),
  };
}

// CarteImport (déjà regroupée par le favori) : on vérifie la forme sans rien recalculer.
export function checkCard(c, i) {
  const bad = (what) => new HttpError(400, `Carte n° ${i + 1} : ${what}.`);
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw bad("ce n'est pas un objet");
  if (typeof c.id !== 'string' || !c.id || c.id.length > 100) throw bad('identifiant (id) manquant ou invalide');
  if (typeof c.title !== 'string' || !c.title || c.title.length > 500) throw bad('titre manquant ou trop long');
  if (!RARITIES.has(c.rarity)) throw bad('rareté inconnue (C, PC, R, SR, UR ou L)');
  const out = { id: c.id, title: c.title, rarity: c.rarity };
  for (const k of ['atk', 'def', 'quality', 'pageviews']) {
    if (c[k] !== undefined && c[k] !== null && num(c[k]) === null) throw bad(`« ${k} » doit être un nombre`);
    out[k] = num(c[k]);
  }
  if (c.category !== undefined && c.category !== null && (typeof c.category !== 'string' || c.category.length > 500)) {
    throw bad('catégorie invalide');
  }
  out.category = str(c.category ?? null);
  for (const k of ['image', 'url']) {
    if (c[k] !== undefined && c[k] !== null && (!isHttp(c[k]) || c[k].length > 2000)) throw bad(`« ${k} » doit être une adresse http(s)`);
    out[k] = c[k] ?? null;
  }
  if (!Number.isInteger(c.count) || c.count < 1 || c.count > 1_000_000) throw bad("nombre d'exemplaires (count) invalide");
  out.count = c.count;
  for (const k of ['shiny', 'starred']) {
    if (c[k] !== undefined && typeof c[k] !== 'boolean') throw bad(`« ${k} » doit être vrai ou faux`);
    out[k] = c[k] === true;
  }
  if (c.obtained_at !== undefined && c.obtained_at !== null && !isDate(c.obtained_at)) throw bad("date d'obtention invalide");
  out.obtained_at = c.obtained_at ?? null;
  return out;
}

// Ordre des étiquettes : ordre binaire, le même que celui de SQLite (GET /api/cards les trie en SQL).
export function sortTags(list) {
  return [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// GET /api/cards : la réponse est assemblée par D1, en morceaux d'environ 1 Mo (une ligne D1 fait 2 Mo au plus) :
// les Cartes stockées (texte JSON) reçoivent leurs étiquettes en SQL et sont recollées telles quelles. Le Worker ne
// décode que quelques longues chaînes, au lieu d'une ligne par carte.
// ?part=N (facultatif) : seulement le morceau N, avec next_part (null au dernier) ; pour les très grandes collections.
const CARDS_CTE = `WITH t AS (
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
  )`;
const ALL_PARTS = `${CARDS_CTE}
  SELECT group_concat(j, ',') AS part FROM (SELECT j, grp FROM k ORDER BY card_id) GROUP BY grp ORDER BY grp`;
const ONE_PART = `${CARDS_CTE}
  SELECT (SELECT MAX(grp) FROM k) AS last, group_concat(j, ',') AS part
  FROM (SELECT j FROM k WHERE grp = ?2 ORDER BY card_id)`;

export async function listCards(env, user, _body, request) {
  const query = new URL(request.url).searchParams.get('part');
  const head = { fetched_at: user.fetched_at };
  const newIds = raw(user.new_ids || '[]');
  if (query === null) {
    const { results } = await env.DB.prepare(ALL_PARTS).bind(user.id).all();
    return { ...head, cards: raw(`[${results.map((r) => r.part).join(',')}]`), new_ids: newIds };
  }
  const part = Number(query);
  if (!Number.isInteger(part) || part < 0) throw new HttpError(400, 'Numéro de morceau (part) invalide.');
  const row = await env.DB.prepare(ONE_PART).bind(user.id, part).first();
  const last = row?.last ?? -1;
  return {
    ...head,
    cards: raw(`[${row?.part ?? ''}]`),
    new_ids: newIds,
    part,
    next_part: part < last ? part + 1 : null,
  };
}
