// Étiquettes du classeur (jamais reposées dans le jeu).

import { HttpError } from './http.js';
import { MAX_CARDS, sortTags } from './cards.js';
import { cleanText } from './util.js';

const MAX_TAG_LENGTH = 60; // deux niveaux dans le nom : « Culture et œuvres/Groupe de musique »
const MAX_TAGS_PER_CARD = 30;
const MAX_TAGS_PER_USER = 50_000; // étiquettes des cartes disparues comprises
const MAX_PAIRS = 5000; // couples carte × étiquette touchés par un appel de tags/bulk

const TOO_MANY = "50 000 étiquettes au plus par classeur (y compris celles des cartes disparues) : rien n'a été changé.";

// Étiquette nettoyée (espaces réduits) ; vide permis ici, à l'appelant de l'écarter.
export function cleanTag(raw) {
  if (typeof raw !== 'string') throw new HttpError(400, 'Une étiquette doit être un texte.');
  const tag = cleanText(raw);
  if (tag.length > MAX_TAG_LENGTH) {
    throw new HttpError(400, `L'étiquette « ${tag.slice(0, MAX_TAG_LENGTH)}… » dépasse ${MAX_TAG_LENGTH} caractères.`);
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
  const state = await db.prepare(
    `SELECT EXISTS (SELECT 1 FROM cards WHERE user_id = ?1 AND card_id = ?2) AS owned,
            (SELECT COUNT(*) FROM tags WHERE user_id = ?1) AS total,
            (SELECT COUNT(*) FROM tags WHERE user_id = ?1 AND card_id = ?2) AS mine`,
  )
    .bind(user.id, cardId)
    .first();
  if (!state.owned) throw new HttpError(404, "Cette carte n'est pas dans ton classeur.");
  if (state.total - state.mine + tags.length > MAX_TAGS_PER_USER) throw new HttpError(400, TOO_MANY);
  await db.batch([
    db.prepare('DELETE FROM tags WHERE user_id = ?1 AND card_id = ?2').bind(user.id, cardId),
    db.prepare('INSERT OR IGNORE INTO tags (user_id, card_id, tag) SELECT ?1, ?2, value FROM json_each(?3)')
      .bind(user.id, cardId, JSON.stringify(tags)),
  ]);
  return { tags: sortTags(tags) };
}

// POST /api/tags/bulk {card_ids, add, remove} : les cartes absentes du classeur sont ignorées. Tout se fait en SQL
// (aucune lecture de la collection en JavaScript), dans une transaction. 5 000 couples carte × étiquette au plus.
export async function bulkTags(env, user, body) {
  const db = env.DB;
  if (!Array.isArray(body.card_ids)) throw new HttpError(400, 'Le champ « card_ids » doit être une liste.');
  if (body.card_ids.length > MAX_CARDS) throw new HttpError(400, 'Trop de cartes à la fois.');
  const idList = [...new Set(body.card_ids.map(cleanCardId))];
  const add = cleanTagList(body.add, 'add');
  const remove = cleanTagList(body.remove, 'remove');
  if (!idList.length || (!add.length && !remove.length)) return { ok: true };
  if (idList.length * (add.length + remove.length) > MAX_PAIRS) {
    throw new HttpError(400, "5 000 changements d'étiquettes au plus par appel (cartes × étiquettes) : découpe la sélection.");
  }
  const ids = JSON.stringify(idList);
  const addJson = JSON.stringify(add);
  const removeJson = JSON.stringify(remove);

  // Total après l'opération (étiquettes ajoutées - retirées) et pire carte (gardées + ajoutées).
  const state = await db.prepare(
    // CROSS JOIN : la liste d'abord, puis une recherche par clé dans cards (json_each n'a pas d'index : dans
    // l'autre sens, chaque carte du compte parcourrait toute la liste).
    `WITH ids AS (SELECT value AS card_id FROM json_each(?2)),
          owned AS (SELECT c.card_id FROM ids CROSS JOIN cards AS c ON c.user_id = ?1 AND c.card_id = ids.card_id)
     SELECT
       (SELECT COUNT(*) FROM tags WHERE user_id = ?1) AS total,
       (SELECT COUNT(*) FROM owned, json_each(?4) AS a WHERE NOT EXISTS
          (SELECT 1 FROM tags AS t WHERE t.user_id = ?1 AND t.card_id = owned.card_id AND t.tag = a.value)) AS added,
       (SELECT COUNT(*) FROM tags AS t WHERE t.user_id = ?1 AND t.card_id IN (SELECT card_id FROM ids)
          AND t.tag IN (SELECT value FROM json_each(?3)) AND t.tag NOT IN (SELECT value FROM json_each(?4))) AS removed,
       (SELECT MAX(n) FROM (SELECT (SELECT COUNT(*) FROM tags AS t WHERE t.user_id = ?1 AND t.card_id = owned.card_id
          AND t.tag NOT IN (SELECT value FROM json_each(?3))
          AND t.tag NOT IN (SELECT value FROM json_each(?4))) AS n FROM owned)) AS worst`,
  )
    .bind(user.id, ids, removeJson, addJson)
    .first();
  if (add.length && state.worst !== null && state.worst + add.length > MAX_TAGS_PER_CARD) {
    throw new HttpError(400, `Une carte aurait plus de ${MAX_TAGS_PER_CARD} étiquettes : rien n'a été changé.`);
  }
  if (state.total + state.added - state.removed > MAX_TAGS_PER_USER) throw new HttpError(400, TOO_MANY);

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
         SELECT ?1, c.card_id, a.value
         FROM json_each(?2) AS i CROSS JOIN cards AS c ON c.user_id = ?1 AND c.card_id = i.value
         CROSS JOIN json_each(?3) AS a`,
      ).bind(user.id, ids, addJson),
    );
  }
  await db.batch(stmts);
  return { ok: true };
}

// POST /api/tags/rename {from, to} : fusionne si `to` existe déjà sur une carte (le total ne peut que baisser).
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
