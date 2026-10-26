// Titres effectivement cherchés sans résultat : jamais les titres encore à résoudre.
// La liste et les retraits restent limités aux collections actuellement synchronisées.
import { HttpError } from './http.js';
import { acquireLease, releaseLease } from './game.js';
import { LEASE_MS } from './refresh.js';
import { sha256Hex } from './util.js';
import { NOT_FOUND_MS, WANTED_MAX, wishState } from './wishlist.js';

const ACTIVE = `(wish_sync = 1 OR EXISTS (SELECT 1 FROM users WHERE id = ?1 AND wish_mode = 'all'))`;
// Les albums sont dépliés une seule fois, et non une fois par titre manquant.
// Même sélection/priorité que wantedSql ; les titres possédés sont également lus une seule fois.
const LIST = `WITH entries AS MATERIALIZED (
    SELECT t.id, t.name, t.updated_at, CAST(i.key AS INTEGER) AS k, json_extract(i.value, '$.title') AS title
    FROM targets AS t CROSS JOIN json_each(t.items) AS i WHERE t.user_id = ?1 AND ${ACTIVE}
      AND i.type = 'object' AND coalesce(json_extract(i.value, '$.status'), 'ok') = 'ok'
  ), wanted AS MATERIALIZED (
    SELECT title FROM entries WHERE typeof(title) = 'text' AND length(title) BETWEEN 1 AND 300
      AND title NOT IN (SELECT json_extract(data, '$.title') FROM cards
        WHERE user_id = ?1 AND json_type(data, '$.title') = 'text')
    GROUP BY title ORDER BY MAX(updated_at) DESC, MIN(k) LIMIT ${WANTED_MAX}
  ), missing AS MATERIALIZED (
  SELECT w.title FROM wanted AS w CROSS JOIN game_titles AS g
  WHERE g.title = w.title AND g.card_id = '' AND g.at >= ?2 AND (?3 = 0 OR EXISTS
    (SELECT 1 FROM wish_missing AS m WHERE m.user_id = ?1 AND m.title = w.title)))
  SELECT e.title, json_group_array(json_object('id', e.id, 'name', e.name)) AS collections
  FROM (SELECT DISTINCT title, id, name FROM entries) AS e JOIN missing AS m ON m.title = e.title
  GROUP BY e.title ORDER BY e.title COLLATE NOCASE`;
const REMOVABLE = `SELECT g.title FROM json_each(?4) AS j CROSS JOIN game_titles AS g
  WHERE g.title = j.value AND g.card_id = '' AND g.at >= ?2 AND (?3 = 0 OR EXISTS
    (SELECT 1 FROM wish_missing AS m WHERE m.user_id = ?1 AND m.title = g.title))
  AND g.title NOT IN (SELECT json_extract(data, '$.title') FROM cards
    WHERE user_id = ?1 AND json_type(data, '$.title') = 'text')`;

async function readList(env, user) {
  const db = env.DB;
  const head = await db.prepare('SELECT wish_mode, wish_state FROM users WHERE id = ?1').bind(user.id).first();
  const st = wishState(head);
  const since = new Date(Date.now() - NOT_FOUND_MS).toISOString();
  // Les anciens bilans n'avaient que le nombre : leur cache négatif reste utilisable.
  const checked = st && st.missing_checked ? 1 : 0;
  const rows = st && (st.none || checked) ? (await db.prepare(LIST).bind(user.id, since, checked).all()).results : [];
  const targets = (await db.prepare(`SELECT id, updated_at FROM targets WHERE user_id = ?1 AND ${ACTIVE} ORDER BY id`).bind(user.id).all()).results;
  const items = rows.map((r) => ({ title: r.title, collections: JSON.parse(r.collections) }));
  const revision = await sha256Hex(JSON.stringify([head.wish_mode, head.wish_state, targets, items]));
  return { items, revision, since, checked, mode: head.wish_mode, targets };
}

export async function listMissingWishes(env, user) {
  const { items, revision } = await readList(env, user);
  return { items, revision };
}

export async function deleteMissingWishes(env, user, body) {
  if (typeof body.revision !== 'string' || !/^[a-f0-9]{64}$/.test(body.revision)
    || (body.all !== true && (!Array.isArray(body.titles) || !body.titles.length || body.titles.length > WANTED_MAX
      || body.titles.some((t) => typeof t !== 'string' || !t.length || t.length > 300)))) {
    throw new HttpError(400, 'Choisis les titres à retirer depuis la liste des titres sans cartes.');
  }
  const db = env.DB;
  const lease = await acquireLease(db, user.id, LEASE_MS);
  if (!lease) throw new HttpError(409, 'Une synchronisation est en cours : réessaie dans un instant.');
  try {
    const current = await readList(env, user);
    if (body.revision !== current.revision) throw new HttpError(409, 'La liste ou les collections ont changé. Actualise la page avant de supprimer.');
    const picked = body.all === true ? null : new Set(body.titles);
    const titles = current.items.filter((r) => !picked || picked.has(r.title)).map((r) => r.title);
    if (!titles.length) return { removed: 0, collections: 0, skipped: 0 };
    const targets = (await db.prepare(`SELECT id, items, updated_at FROM targets WHERE user_id = ?1 AND ${ACTIVE}
      AND EXISTS (SELECT 1 FROM json_each(items) AS i WHERE json_extract(i.value, '$.title') IN
        (SELECT value FROM json_each(?2)))`).bind(user.id, JSON.stringify(titles)).all()).results;
    // Un horodatage strictement plus récent conserve la protection contre les éditions simultanées.
    const at = new Date(Math.max(Date.now(), ...targets.map(t => Date.parse(t.updated_at) + 1 || 0))).toISOString();
    // Chaque écriture vérifie aussi le contenu : une édition simultanée est conservée.
    // Le cache est revérifié dans la transaction : un titre résolu entre-temps reste dans l'album.
    const unchanged = targets.filter((t) => current.targets.some((v) => v.id === t.id && v.updated_at === t.updated_at));
    const results = unchanged.length ? await db.batch(unchanged.map((t) => db.prepare(`WITH missing AS MATERIALIZED (${REMOVABLE})
      UPDATE targets SET items = (SELECT json_group_array(json(i.value)) FROM json_each(targets.items) AS i
        WHERE NOT (i.type = 'object' AND coalesce(json_extract(i.value, '$.status'), 'ok') = 'ok'
          AND json_extract(i.value, '$.title') IN (SELECT title FROM missing))), updated_at = ?5
      WHERE user_id = ?1 AND id = ?6 AND updated_at = ?7 AND items = ?8 AND ${ACTIVE}
        AND EXISTS (SELECT 1 FROM users WHERE id = ?1 AND wish_mode = ?9)
      RETURNING id`).bind(user.id, current.since, current.checked, JSON.stringify(titles), at, t.id, t.updated_at, t.items, current.mode))) : [];
    const changed = results.reduce((n, r) => n + r.results.length, 0);
    await db.prepare('UPDATE users SET wish_dirty = 1 WHERE id = ?1').bind(user.id).run();
    const rest = await readList(env, user);
    await db.prepare("UPDATE users SET wish_state = json_set(wish_state, '$.none', ?2) WHERE id = ?1 AND wish_state IS NOT NULL")
      .bind(user.id, rest.items.length).run();
    return { removed: current.items.length - rest.items.length, collections: changed, skipped: targets.length - changed };
  } finally {
    await releaseLease(db, user.id, lease).run();
  }
}
