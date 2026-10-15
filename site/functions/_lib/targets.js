// Collections à compléter : rangées telles que l'interface les a vérifiées sur Wikipédia.

import { HttpError, jsonText, raw } from './http.js';
import { byteLength, charLength, cleanText, nowIso, randomToken } from './util.js';

const MAX_ITEMS = 3000;
const MAX_TARGETS = 100;
const MAX_ITEMS_BYTES = 1_800_000; // une ligne D1 fait 2 Mo au plus
const STATUSES = new Set(['ok', 'missing', 'disambiguation']);

// Collection telle que stockée : `items` recopié en texte JSON, sans être relu.
function toTarget(row) {
  return {
    id: row.id,
    name: row.name,
    items: raw(row.items),
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function cleanItem(item, i) {
  if (!item || typeof item !== 'object') throw new HttpError(400, `Élément n° ${i + 1} invalide.`);
  const title = typeof item.title === 'string' ? cleanText(item.title) : '';
  if (!title || charLength(title) > 300) {
    throw new HttpError(400, `Élément n° ${i + 1} : titre manquant ou trop long (300 caractères au plus).`);
  }
  const status = item.status ?? 'ok';
  if (!STATUSES.has(status)) {
    throw new HttpError(400, `Élément n° ${i + 1} : statut inconnu (ok, missing ou disambiguation).`);
  }
  const description = typeof item.description === 'string' && item.description.trim()
    ? [...cleanText(item.description)].slice(0, 500).join('')
    : null;
  const image = typeof item.image === 'string' && /^https?:\/\//i.test(item.image) && item.image.length <= 1000
    ? item.image
    : null;
  return { title, description, image, status };
}

// GET /api/targets
export async function listTargets(env, user) {
  const { results } = await env.DB.prepare(
    'SELECT id, name, items, source, created_at, updated_at FROM targets WHERE user_id = ?1 ORDER BY created_at, id',
  )
    .bind(user.id)
    .all();
  return { targets: raw(`[${results.map((r) => jsonText(toTarget(r))).join(',')}]`) };
}

// POST /api/targets/save {id?, name, items, source?} : crée, ou remplace celle qui a cet id.
export async function saveTarget(env, user, body) {
  const db = env.DB;
  const name = typeof body.name === 'string' ? cleanText(body.name) : '';
  if (!name || charLength(name) > 80) throw new HttpError(400, 'Le nom de la collection fait de 1 à 80 caractères.');
  if (!Array.isArray(body.items)) throw new HttpError(400, 'Le champ « items » doit être une liste.');
  if (body.items.length > MAX_ITEMS) throw new HttpError(400, `${MAX_ITEMS} éléments au plus par collection.`);
  const items = body.items.map(cleanItem);
  const itemsJson = JSON.stringify(items);
  if (byteLength(itemsJson) > MAX_ITEMS_BYTES) throw new HttpError(400, 'Collection trop volumineuse.');

  let source = null;
  if (body.source !== undefined && body.source !== null) {
    if (typeof body.source !== 'string' || body.source.length > 200) {
      throw new HttpError(400, 'Le champ « source » doit être un texte de 200 caractères au plus.');
    }
    source = body.source.trim() || null;
  }

  let id = body.id;
  if (id === undefined || id === null || id === '') id = randomToken(8);
  else if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new HttpError(400, 'Identifiant de collection invalide.');
  }

  const counts = await db.prepare(
    'SELECT COUNT(*) AS n, SUM(id = ?2) AS mine FROM targets WHERE user_id = ?1',
  )
    .bind(user.id, id)
    .first();
  if (!counts.mine && counts.n >= MAX_TARGETS) throw new HttpError(400, `${MAX_TARGETS} collections au plus.`);

  const now = nowIso();
  const row = await db.prepare(
    `INSERT INTO targets (user_id, id, name, items, source, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
     ON CONFLICT (user_id, id) DO UPDATE SET
       name = excluded.name, items = excluded.items, source = excluded.source, updated_at = excluded.updated_at
     RETURNING id, name, items, source, created_at, updated_at`,
  )
    .bind(user.id, id, name, itemsJson, source, now)
    .first();
  return { target: raw(jsonText(toTarget(row))) };
}

// POST /api/targets/delete {id}
export async function deleteTarget(env, user, body) {
  if (typeof body.id !== 'string' || !body.id) throw new HttpError(400, 'Indique la collection à supprimer (id).');
  await env.DB.prepare('DELETE FROM targets WHERE user_id = ?1 AND id = ?2').bind(user.id, body.id).run();
  return { ok: true };
}
