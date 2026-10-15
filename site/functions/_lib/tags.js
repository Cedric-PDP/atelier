// Étiquettes du classeur (jamais reposées dans le jeu).

import { HttpError } from './http.js';
import { MAX_CARDS, sortTags } from './cards.js';
import { byteLength, charLength, cleanText } from './util.js';

const MAX_TAG_LENGTH = 40;
const MAX_TAGS_PER_CARD = 30;


// Étiquette nettoyée (espaces réduits) ; vide permis ici, à l'appelant de l'écarter.
export function cleanTag(raw) {
  if (typeof raw !== 'string') throw new HttpError(400, 'Une étiquette doit être un texte.');
  const tag = cleanText(raw);
  if (charLength(tag) > MAX_TAG_LENGTH) {
    throw new HttpError(400, `L'étiquette « ${[...tag].slice(0, MAX_TAG_LENGTH).join('')}… » dépasse ${MAX_TAG_LENGTH} caractères.`);
  }
  return tag;
}

function cleanTagList(list, field) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new HttpError(400, `Le champ « ${field} » doit être une liste d'étiquettes.`);
  return [...new Set(list.map(cleanTag).filter(Boolean))];
}

function cleanCardId(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') || value === '' || String(value).length > 100) {
    throw new HttpError(400, 'Identifiant de carte invalide.');
  }
  return String(value);
}

// POST /api/tags/set {card_id, tags}
export async function setTags(env, user, body) {
  const db = env.DB;
  const cardId = cleanCardId(body.card_id);
  const tags = cleanTagList(body.tags, 'tags');
  if (tags.length > MAX_TAGS_PER_CARD) throw new HttpError(400, `${MAX_TAGS_PER_CARD} étiquettes au plus par carte.`);
  const exists = await db.prepare('SELECT 1 AS ok FROM cards WHERE user_id = ?1 AND card_id = ?2')
    .bind(user.id, cardId)
    .first();
  if (!exists) throw new HttpError(404, "Cette carte n'est pas dans ton classeur.");
  await db.batch([
    db.prepare('DELETE FROM tags WHERE user_id = ?1 AND card_id = ?2').bind(user.id, cardId),
    db.prepare('INSERT OR IGNORE INTO tags (user_id, card_id, tag) SELECT ?1, ?2, value FROM json_each(?3)')
      .bind(user.id, cardId, JSON.stringify(tags)),
  ]);
  return { tags: sortTags(tags) };
}

// POST /api/tags/bulk {card_ids, add, remove} : les cartes absentes du classeur sont ignorées. Tout se fait en SQL
// (aucune lecture de la collection en JavaScript), dans une transaction.
export async function bulkTags(env, user, body) {
  const db = env.DB;
  if (!Array.isArray(body.card_ids)) throw new HttpError(400, 'Le champ « card_ids » doit être une liste.');
  if (body.card_ids.length > MAX_CARDS) throw new HttpError(400, 'Trop de cartes à la fois.');
  const ids = JSON.stringify([...new Set(body.card_ids.map(cleanCardId))]);
  // Un paramètre D1 fait 2 Mo au plus (le calcul exact n'est fait que s'il peut dépasser).
  if (ids.length > 630_000 && byteLength(ids) > 1_900_000) throw new HttpError(400, 'Trop de cartes à la fois.');
  const add = cleanTagList(body.add, 'add');
  const remove = cleanTagList(body.remove, 'remove');
  if (ids === '[]' || (!add.length && !remove.length)) return { ok: true };
  const addJson = JSON.stringify(add);
  const removeJson = JSON.stringify(remove);

  if (add.length) {
    // Pire carte après l'opération : ses étiquettes gardées (ni retirées ni ajoutées) + celles ajoutées.
    const worst = await db.prepare(
      `SELECT MAX(n) AS n FROM (
         SELECT (SELECT COUNT(*) FROM tags AS t WHERE t.user_id = ?1 AND t.card_id = c.card_id
                   AND t.tag NOT IN (SELECT value FROM json_each(?3))
                   AND t.tag NOT IN (SELECT value FROM json_each(?4))) AS n
         FROM cards AS c WHERE c.user_id = ?1 AND c.card_id IN (SELECT value FROM json_each(?2)))`,
    )
      .bind(user.id, ids, removeJson, addJson)
      .first();
    if (worst && worst.n !== null && worst.n + add.length > MAX_TAGS_PER_CARD) {
      throw new HttpError(400, `Une carte aurait plus de ${MAX_TAGS_PER_CARD} étiquettes : rien n'a été changé.`);
    }
  }
  const stmts = [];
  if (remove.length) {
    stmts.push(
      db.prepare(
        `DELETE FROM tags WHERE user_id = ?1 AND card_id IN (SELECT value FROM json_each(?2))
           AND tag IN (SELECT value FROM json_each(?3))`,
      ).bind(user.id, ids, removeJson),
    );
  }
  if (add.length) {
    stmts.push(
      db.prepare(
        `INSERT OR IGNORE INTO tags (user_id, card_id, tag)
         SELECT ?1, c.card_id, a.value FROM cards AS c, json_each(?3) AS a
         WHERE c.user_id = ?1 AND c.card_id IN (SELECT value FROM json_each(?2))`,
      ).bind(user.id, ids, addJson),
    );
  }
  await db.batch(stmts);
  return { ok: true };
}

// POST /api/tags/rename {from, to} : fusionne si `to` existe déjà sur une carte.
export async function renameTag(env, user, body) {
  const db = env.DB;
  const from = cleanTag(body.from ?? '');
  const to = cleanTag(body.to ?? '');
  if (!from || !to) throw new HttpError(400, "Indique l'étiquette à renommer et son nouveau nom.");
  if (from === to) return { ok: true };
  await db.batch([
    db.prepare(
      'INSERT OR IGNORE INTO tags (user_id, card_id, tag) SELECT user_id, card_id, ?2 FROM tags WHERE user_id = ?1 AND tag = ?3',
    ).bind(user.id, to, from),
    db.prepare('DELETE FROM tags WHERE user_id = ?1 AND tag = ?2').bind(user.id, from),
  ]);
  return { ok: true };
}
