// Titres effectivement cherchés sans résultat : jamais les titres encore à résoudre.
// La liste et les retraits restent limités aux collections actuellement synchronisées.
import { HttpError } from './http.js';
import { acquireLease, releaseLease } from './game.js';
import { LEASE_MS } from './refresh.js';
import { nowIso, sha256Hex } from './util.js';
import { NOT_FOUND_MS, WANTED_MAX, wishState } from './wishlist.js';
import { wantedSql } from './market.js';

const ACTIVE = `(wish_sync = 1 OR EXISTS (SELECT 1 FROM users WHERE id = ?1 AND wish_mode = 'all'))`;
const ELIGIBLE = `WITH wanted AS (${wantedSql(WANTED_MAX, true)})
  SELECT w.t AS title FROM wanted AS w JOIN game_titles AS g ON g.title = w.t
  WHERE g.card_id = '' AND g.at >= ?2 AND (?3 = 0 OR EXISTS
    (SELECT 1 FROM wish_missing AS m WHERE m.user_id = ?1 AND m.title = w.t))`;
// Pendant un retrait par lots, la limite de recherche ne doit pas déplacer les titres
// d'une collection à l'autre. On revérifie les seuls titres déjà approuvés par la liste.
const REMOVABLE = `SELECT g.title FROM game_titles AS g WHERE g.card_id = '' AND g.at >= ?2
  AND g.title IN (SELECT value FROM json_each(?4)) AND (?3 = 0 OR EXISTS
    (SELECT 1 FROM wish_missing AS m WHERE m.user_id = ?1 AND m.title = g.title))
  AND NOT EXISTS (SELECT 1 FROM cards AS c WHERE c.user_id = ?1 AND json_extract(c.data, '$.title') = g.title)`;

async function readList(env, user) {
  const db = env.DB;
  const head = await db.prepare('SELECT wish_mode, wish_state FROM users WHERE id = ?1').bind(user.id).first();
  const st = wishState(head);
  const since = new Date(Date.now() - NOT_FOUND_MS).toISOString();
  // Les anciens bilans n'avaient que le nombre : leur cache négatif reste utilisable.
  const checked = st && st.missing_checked ? 1 : 0;
  const rows = st && (st.none || checked) ? (await db.prepare(`WITH missing AS (${ELIGIBLE})
    SELECT m.title, json_group_array(json_object('id', t.id, 'name', t.name)) AS collections
    FROM missing AS m JOIN targets AS t ON t.user_id = ?1 AND ${ACTIVE}
    WHERE EXISTS (SELECT 1 FROM json_each(t.items) AS i WHERE i.type = 'object'
      AND json_extract(i.value, '$.title') = m.title AND coalesce(json_extract(i.value, '$.status'), 'ok') = 'ok')
    GROUP BY m.title ORDER BY m.title COLLATE NOCASE`).bind(user.id, since, checked).all()).results : [];
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
    const at = nowIso();
    // Chaque écriture vérifie aussi le contenu : une édition simultanée est conservée.
    // Le cache est revérifié dans la transaction : un titre résolu entre-temps reste dans l'album.
    const unchanged = targets.filter((t) => current.targets.some((v) => v.id === t.id && v.updated_at === t.updated_at));
    const results = unchanged.length ? await db.batch(unchanged.map((t) => db.prepare(`WITH missing AS (${REMOVABLE})
      UPDATE targets SET items = (SELECT json_group_array(json(i.value)) FROM json_each(targets.items) AS i
        WHERE NOT (i.type = 'object' AND coalesce(json_extract(i.value, '$.status'), 'ok') = 'ok'
          AND json_extract(i.value, '$.title') IN (SELECT title FROM missing)
          AND json_extract(i.value, '$.title') IN (SELECT value FROM json_each(?4)))), updated_at = ?5
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
