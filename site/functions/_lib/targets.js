// Collections à compléter : rangées telles que l'interface les a vérifiées sur Wikipédia.

import { HttpError, jsonText, raw } from './http.js';
import { byteLength, cleanText, nowIso, randomToken } from './util.js';

// Quotas par compte (D1 gratuit : 500 Mo en tout).
const MAX_ITEMS = 3000;
const MAX_TARGETS = 50;
const MAX_ITEMS_BYTES = 600 * 1024; // éléments d'une collection, en JSON
const MAX_TOTAL_BYTES = 5 * 1024 * 1024; // toutes les collections d'un compte
const STATUSES = new Set(['ok', 'missing', 'disambiguation']);
const QID = /^Q[1-9][0-9]{0,11}$/;
// Rareté d'une carte dans le jeu (élément d'une collection créée depuis une recherche du jeu).
const RARITIES = new Set(['C', 'PC', 'R', 'SR', 'UR', 'L']);

// Collection telle que stockée : `items` recopié en texte JSON, sans être relu.
function toTarget(row, items = row.items) {
  return {
    id: row.id,
    name: row.name,
    items: raw(items),
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Coupe à n unités sans séparer une paire de substitution (emoji…).
function cut(text, n) {
  if (text.length <= n) return text;
  const code = text.charCodeAt(n - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? n - 1 : n);
}

function cleanItem(item, i) {
  if (!item || typeof item !== 'object') throw new HttpError(400, `Élément n° ${i + 1} invalide.`);
  const title = typeof item.title === 'string' ? cleanText(item.title) : '';
  if (!title || title.length > 300) {
    throw new HttpError(400, `Élément n° ${i + 1} : titre manquant ou trop long (300 caractères au plus).`);
  }
  const status = item.status ?? 'ok';
  if (!STATUSES.has(status)) {
    throw new HttpError(400, `Élément n° ${i + 1} : statut inconnu (ok, missing ou disambiguation).`);
  }
  const description = typeof item.description === 'string' ? cut(cleanText(item.description), 500) || null : null;
  const image = typeof item.image === 'string' && item.image.length <= 1000 && /^https?:\/\//i.test(item.image)
    ? item.image
    : null;
  const out = { title, description, image, status };
  // Identifiant Wikidata facultatif (reconnaît une carte même si son titre diffère) ; gardé seulement s'il est valide.
  if (typeof item.qid === 'string' && QID.test(item.qid)) out.qid = item.qid;
  // Rareté relevée dans le jeu (collection créée depuis sa Collection globale) ; gardée seulement si elle est connue.
  if (RARITIES.has(item.rarity)) out.rarity = item.rarity;
  // Intercalaire : carte qui ouvre une section de la collection (une vraie carte, qui compte comme les autres) ; gardé
  // seulement s'il vaut true, absent sinon.
  if (item.sep === true) out.sep = true;
  return out;
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
  const { row, itemsJson } = await storeTarget(env, user, body);
  return { target: raw(jsonText(toTarget(row, itemsJson))) };
}

// POST /api/targets/from-game {name, query, items:[{title, rarity, card_id, category?, image?}]} : collection créée
// par le favori depuis une recherche de la Collection globale du jeu. Accepte la clé d'import (celle du favori) : ne
// fait que CRÉER une collection (jamais de remplacement ni de suppression), dans les mêmes quotas que saveTarget.
export async function saveGameTarget(env, user, body) {
  const query = typeof body.query === 'string' ? cleanText(body.query) : '';
  if (!query || query.length > 100) throw new HttpError(400, 'La recherche (« query ») fait de 1 à 100 caractères.');
  if (!Array.isArray(body.items)) throw new HttpError(400, 'Le champ « items » doit être une liste.');
  if (!body.items.length) throw new HttpError(400, 'Aucune carte : la recherche ne donne rien à ranger.');
  if (body.items.length > MAX_ITEMS) throw new HttpError(400, `${MAX_ITEMS} éléments au plus par collection.`);
  const seen = new Set();
  const items = [];
  body.items.forEach((item, i) => {
    if (!item || typeof item !== 'object') throw new HttpError(400, `Carte n° ${i + 1} invalide.`);
    const id = item.card_id;
    if (typeof id !== 'string' || !id || id.length > 100) {
      throw new HttpError(400, `Carte n° ${i + 1} : identifiant du jeu (card_id) manquant ou invalide.`);
    }
    if (!RARITIES.has(item.rarity)) {
      throw new HttpError(400, `Carte n° ${i + 1} : rareté inconnue (C, PC, R, SR, UR ou L).`);
    }
    if (seen.has(id)) return; // la même carte lue deux fois (pages qui se chevauchent)
    seen.add(id);
    // La catégorie du jeu (description Wikidata) tient lieu de description ; titre et image vérifiés par storeTarget.
    items.push({ title: item.title, description: typeof item.category === 'string' ? item.category : null,
      image: item.image, status: 'ok', rarity: item.rarity });
  });
  // Grande recherche : sans les images si elles font dépasser 600 Ko (la page retrouve les vignettes sur Wikipédia).
  if (byteLength(JSON.stringify(items)) > MAX_ITEMS_BYTES) for (const it of items) it.image = null;
  const { row, count } = await storeTarget(env, user, { name: body.name, items, source: `wm:${query}` });
  return { target: { id: row.id, name: row.name, source: row.source, count, created_at: row.created_at, updated_at: row.updated_at } };
}

// Range une collection (créée, ou remplacée si body.id existe déjà) après validation et contrôle des quotas.
async function storeTarget(env, user, body) {
  const db = env.DB;
  const name = typeof body.name === 'string' ? cleanText(body.name) : '';
  if (!name || name.length > 80) throw new HttpError(400, 'Le nom de la collection fait de 1 à 80 caractères.');
  if (!Array.isArray(body.items)) throw new HttpError(400, 'Le champ « items » doit être une liste.');
  if (body.items.length > MAX_ITEMS) throw new HttpError(400, `${MAX_ITEMS} éléments au plus par collection.`);
  const items = body.items.map(cleanItem);
  const itemsJson = JSON.stringify(items);
  const size = itemsJson.length > MAX_ITEMS_BYTES ? Infinity : byteLength(itemsJson);
  if (size > MAX_ITEMS_BYTES) throw new HttpError(400, 'Collection trop volumineuse : 600 Ko au plus.');

  let source = null;
  if (body.source !== undefined && body.source !== null) {
    if (typeof body.source !== 'string' || body.source.length > 200) {
      throw new HttpError(400, 'Le champ « source » doit être un texte de 200 caractères au plus.');
    }
    source = body.source.trim() || null;
  }

  let id = body.id;
  if (id === undefined || id === null || id === '') {
    // Une catégorie de Wikipédia (source « wp:… ») ou une page dont les liens font la collection (« links:<titre> ») n'a
    // qu'une collection par compte : sans id, la plus ancienne qui a déjà cette source est remplacée (créée deux fois,
    // depuis deux onglets ou deux appareils) au lieu d'en créer une seconde.
    const same = source && (source.startsWith('wp:') || source.startsWith('links:'))
      ? await db.prepare('SELECT id FROM targets WHERE user_id = ?1 AND source = ?2 ORDER BY created_at, id LIMIT 1').bind(user.id, source).first()
      : null;
    id = same ? same.id : randomToken(8);
  } else if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new HttpError(400, 'Identifiant de collection invalide.');
  }

  // Les autres collections du compte (celle-ci, si elle existe, est remplacée).
  const others = await db.prepare(
    `SELECT COUNT(*) AS n, SUM(id = ?2) AS mine,
            COALESCE(SUM(CASE WHEN id <> ?2 THEN length(CAST(items AS BLOB)) END), 0) AS bytes
     FROM targets WHERE user_id = ?1`,
  )
    .bind(user.id, id)
    .first();
  if (!others.mine && others.n >= MAX_TARGETS) throw new HttpError(400, `${MAX_TARGETS} collections au plus.`);
  if (others.bytes + size > MAX_TOTAL_BYTES) {
    throw new HttpError(400, 'Tes collections à compléter dépassent 5 Mo en tout : supprimes-en une avant.');
  }

  const now = nowIso();
  const row = await db.prepare(
    `INSERT INTO targets (user_id, id, name, items, source, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
     ON CONFLICT (user_id, id) DO UPDATE SET
       name = excluded.name, items = excluded.items, source = excluded.source, updated_at = excluded.updated_at
     RETURNING id, name, source, created_at, updated_at`,
  )
    .bind(user.id, id, name, itemsJson, source, now)
    .first();
  return { row, itemsJson, count: items.length };
}

// POST /api/targets/delete {id}
export async function deleteTarget(env, user, body) {
  if (typeof body.id !== 'string' || !body.id) throw new HttpError(400, 'Indique la collection à supprimer (id).');
  await env.DB.prepare('DELETE FROM targets WHERE user_id = ?1 AND id = ?2').bind(user.id, body.id).run();
  return { ok: true };
}
