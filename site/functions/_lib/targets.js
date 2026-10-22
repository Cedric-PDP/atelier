// Collections à compléter : rangées telles que l'interface les a vérifiées sur Wikipédia.

import { HttpError, jsonText, raw } from './http.js';
import { purgeStaging } from './db.js';
import { byteLength, cleanText, nowIso, randomToken } from './util.js';

// Quotas par compte (D1 gratuit : 500 Mo en tout). Pas de nombre d'éléments maximal (2026-10-19, demande de
// l'utilisateur : plus de limite à 3 000 par collection) : seulement leur taille.
const MAX_TARGETS = 50;
// Éléments d'une collection, en JSON : une ligne de D1 fait 2 000 000 d'octets au plus, `auto` (200 Ko) compris.
const MAX_ITEMS_BYTES = 1_700_000;
// Éléments d'un envoi, en JSON (une collection plus lourde arrive en morceaux, `upload`) : 3 000 éléments réalistes
// (~300 Ko) coûtent ~2 ms de JS (dev/api.test.mjs), un envoi reste loin des 10 ms d'un Worker gratuit.
const MAX_PART_BYTES = 600 * 1024;
const MAX_UPLOADS = 3; // collections envoyées en morceaux en même temps, par compte (au-delà : les plus anciennes partent)
const MAX_TOTAL_BYTES = 5 * 1024 * 1024; // toutes les collections d'un compte
const MAX_SKIP_DELTA = 20000; // titres d'un auto_skip.add ou .del (n'en restent que MAX_SKIP)
const STATUSES = new Set(['ok', 'missing', 'disambiguation']);
const QID = /^Q[1-9][0-9]{0,11}$/;
// Rareté d'une carte dans le jeu (élément d'une collection créée depuis une recherche du jeu).
const RARITIES = new Set(['C', 'PC', 'R', 'SR', 'UR', 'L']);
// Ajout automatique (« Refaire à chaque synchro » de la fenêtre « Ajouter par tags du jeu », 2026-10-18) : colonne
// `auto` = {rules:[{k, v}], skip:[titres]} en JSON, NULL sans règle. k = 'gtag' (tag du jeu, v = son nom), 'cat'
// (catégorie du jeu, v = son texte) ou 'tag' (tag du classeur, v = le tag, ou « Catégorie/ » pour toute une catégorie de
// tags) ; skip = titres de cartes que l'ajout automatique ne remet jamais (décochées dans l'aperçu, retirées ensuite), les
// plus anciens d'abord. C'est la page qui applique les règles (elle seule rapproche titres et qids) ; le serveur range.
const AUTO_KINDS = new Set(['gtag', 'cat', 'tag']);
const MAX_RULES = 20;
const MAX_RULE_LENGTH = 500; // une catégorie du jeu fait 500 caractères au plus (favori)
const MAX_SKIP = 2000; // titres exclus gardés (au-delà, par auto_skip.add : les plus anciens sont oubliés)
const MAX_AUTO_BYTES = 200 * 1024; // auto en JSON (au-delà : les plus anciens titres exclus sont oubliés)
const MAX_UPDATED_AT = 40;

// Collection telle que stockée : `items` (et `auto`) recopiés en texte JSON, sans être relus.
function toTarget(row, items = row.items) {
  return {
    id: row.id,
    name: row.name,
    items: raw(items),
    source: row.source,
    auto: row.auto ? raw(row.auto) : null,
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
  else if (item.sep === false) out.sep = false; // décoché par le joueur : la détection automatique ne le recoche jamais
  return out;
}

// Liste de titres (exclusions de l'ajout automatique) : textes nettoyés de 1 à 300 caractères, `max` au plus.
function titleList(list, max, label) {
  if (!Array.isArray(list)) throw new HttpError(400, `${label} : une liste de titres.`);
  if (list.length > max) throw new HttpError(400, `${label} : ${max} titres au plus.`);
  return list.map((value, i) => {
    const title = typeof value === 'string' ? cleanText(value) : '';
    if (!title || title.length > 300) throw new HttpError(400, `${label}, titre n° ${i + 1} : manquant ou trop long (300 caractères au plus).`);
    return title;
  });
}

// Clé de comparaison d'un titre exclu, comme normTitle de match.js en plus simple : « _ » en espace, apostrophes et
// guillemets typographiques ramenés à l'ASCII, première lettre en majuscule (casse et accents gardés ailleurs).
function skipKey(title) {
  const t = title.replace(/_/g, ' ').replace(/[\u2018\u2019\u201b\u02bc\u2032]/g, "'").replace(/[\u201c-\u201f\u2033\u00ab\u00bb]/g, '"')
    .replace(/[\u2010\u2011]/g, '-').replace(/\s+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function cleanRules(rules) {
  if (!Array.isArray(rules)) throw new HttpError(400, 'Ajout automatique : « auto.rules » doit être une liste.');
  if (rules.length > MAX_RULES) throw new HttpError(400, `Ajout automatique : ${MAX_RULES} règles au plus.`);
  const seen = new Set();
  const out = [];
  rules.forEach((rule, i) => {
    if (!rule || typeof rule !== 'object' || !AUTO_KINDS.has(rule.k)) {
      throw new HttpError(400, `Ajout automatique, règle n° ${i + 1} : genre inconnu (gtag, cat ou tag).`);
    }
    const v = typeof rule.v === 'string' ? cleanText(rule.v) : '';
    if (!v || v.length > MAX_RULE_LENGTH) {
      throw new HttpError(400, `Ajout automatique, règle n° ${i + 1} : nom manquant ou trop long (${MAX_RULE_LENGTH} caractères au plus).`);
    }
    // Tags et catégories du jeu se comparent sans la casse (la page les replie) ; un tag du classeur, tel quel.
    const key = `${rule.k}\u0000${rule.k === 'tag' ? v : v.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ k: rule.k, v });
  });
  return out;
}

function storedAuto(text) {
  if (!text) return null;
  try {
    const a = JSON.parse(text);
    return a && Array.isArray(a.rules) && a.rules.length ? { rules: a.rules, skip: Array.isArray(a.skip) ? a.skip : [] } : null;
  } catch {
    return null;
  }
}

// Ajout automatique après la requête, d'après celui rangé (texte JSON ou null) : texte JSON, null (aucune règle), ou
// undefined (inchangé : la colonne n'est pas réécrite). `auto` absent = inchangé, null = effacé (règles et exclusions),
// {rules, skip?} = règles remplacées (liste vide = effacé) et exclusions gardées, sauf `skip` donné (remplacées).
// `auto_skip` {add?, del?} : titres ajoutés aux exclusions ou retirés (comparés comme skipKey), appliqué ensuite,
// seulement s'il reste des règles (ignoré sinon) ; au-delà de 2 000 exclusions ou de 200 Ko, les plus anciennes partent.
function nextAuto(body, stored) {
  const hasAuto = body.auto !== undefined;
  const delta = body.auto_skip;
  const hasDelta = delta !== undefined && delta !== null;
  if (!hasAuto && !hasDelta) return undefined;
  let add = [];
  let del = [];
  if (hasDelta) {
    if (typeof delta !== 'object' || Array.isArray(delta)) throw new HttpError(400, 'Le champ « auto_skip » doit être un objet {add?, del?}.');
    if (delta.add !== undefined) add = titleList(delta.add, MAX_SKIP_DELTA, 'Exclusions ajoutées (auto_skip.add)');
    if (delta.del !== undefined) del = titleList(delta.del, MAX_SKIP_DELTA, 'Exclusions retirées (auto_skip.del)');
  }
  let cur = storedAuto(stored);
  if (hasAuto) {
    if (body.auto === null) cur = null;
    else if (typeof body.auto !== 'object' || Array.isArray(body.auto)) {
      throw new HttpError(400, 'Le champ « auto » vaut null ou {rules, skip?}.');
    } else {
      const rules = cleanRules(body.auto.rules);
      const skip = body.auto.skip !== undefined ? titleList(body.auto.skip, MAX_SKIP, 'Titres exclus (auto.skip)') : cur ? cur.skip : [];
      cur = rules.length ? { rules, skip } : null;
    }
  }
  if (!cur) return hasAuto ? null : undefined;
  if (!hasAuto && !add.length && !del.length) return undefined;
  const gone = new Set(del.map(skipKey));
  const skip = [];
  const seen = new Set();
  for (const title of [...cur.skip, ...add]) {
    const k = skipKey(String(title));
    if (gone.has(k) || seen.has(k)) continue;
    seen.add(k);
    skip.push(String(title));
  }
  let out = { rules: cur.rules, skip: skip.slice(-MAX_SKIP) };
  let text = JSON.stringify(out);
  while (out.skip.length && byteLength(text) > MAX_AUTO_BYTES) {
    out = { rules: out.rules, skip: out.skip.slice(Math.ceil(out.skip.length / 10)) };
    text = JSON.stringify(out);
  }
  return text;
}

// GET /api/targets
export async function listTargets(env, user) {
  const { results } = await env.DB.prepare(
    'SELECT id, name, items, source, auto, created_at, updated_at FROM targets WHERE user_id = ?1 ORDER BY created_at, id',
  )
    .bind(user.id)
    .all();
  return { targets: raw(`[${results.map((r) => jsonText(toTarget(r))).join(',')}]`) };
}

// POST /api/targets/save {id?, name, items, source?, auto?, auto_skip?, expect_updated_at?, upload?} : crée, ou remplace
// celle qui a cet id (ajout automatique : voir nextAuto). expect_updated_at (avec un id) : seulement si la collection
// rangée a encore ce updated_at, sinon 409 {conflict:true, target} (la collection d'aujourd'hui, ou null si elle a été
// supprimée) et rien n'est écrit : l'ajout automatique de la page s'en sert pour ne jamais écraser ce qu'un autre onglet
// ou un autre appareil vient d'enregistrer.
// Plus de 600 Ko d'éléments : en morceaux, `upload` = {id (tiré par la page), part (0, 1, 2…), last}. Un morceau sans
// `last` ne porte que ses `items` (600 Ko au plus) : rangé dans target_uploads, réponse {part}. Le dernier porte aussi
// le reste du corps ; ses éléments s'ajoutent aux autres, assemblés en SQL (sans les relire en JavaScript) dans la
// collection, et la réponse a `target.items` = null (la page garde ceux qu'elle a envoyés). Morceaux manquants, ou de
// plus d'une heure : 400, rien n'est écrit.
export async function saveTarget(env, user, body) {
  const out = await storeTarget(env, user, body);
  if (out.part !== undefined) return { part: out.part };
  return { target: raw(jsonText(toTarget(out.row, out.chunked ? 'null' : out.itemsJson))) };
}

// `upload` d'un corps : null, ou {id, part, last}.
function uploadOf(body) {
  const u = body.upload;
  if (u === undefined || u === null) return null;
  if (typeof u !== 'object' || Array.isArray(u) || typeof u.id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(u.id)
    || !Number.isInteger(u.part) || u.part < 0 || u.part > 99) {
    throw new HttpError(400, 'Le champ « upload » vaut {id, part, last?} (part de 0 à 99).');
  }
  return { id: u.id, part: u.part, last: u.last === true };
}

// Range une collection (créée, ou remplacée si body.id existe déjà) après validation et contrôle des quotas ; un morceau
// d'un envoi en plusieurs (upload sans last) est seulement mis de côté : {part}.
async function storeTarget(env, user, body) {
  const db = env.DB;
  const up = uploadOf(body);
  if (!Array.isArray(body.items)) throw new HttpError(400, 'Le champ « items » doit être une liste.');
  const items = body.items.map(cleanItem);
  let itemsJson = JSON.stringify(items);
  const partSize = itemsJson.length > MAX_PART_BYTES ? Infinity : byteLength(itemsJson);
  if (partSize > MAX_PART_BYTES) {
    throw new HttpError(400, up ? 'Morceau trop volumineux : 600 Ko au plus.'
      : 'Collection trop volumineuse pour un seul envoi : 600 Ko au plus (au-delà, en morceaux : « upload »).');
  }
  if (up && !up.last) {
    if (!items.length) throw new HttpError(400, 'Morceau vide.');
    await stashPart(db, user, up, itemsJson.slice(1, -1), partSize - 2);
    return { part: up.part };
  }
  const name = typeof body.name === 'string' ? cleanText(body.name) : '';
  if (!name || name.length > 80) throw new HttpError(400, 'Le nom de la collection fait de 1 à 80 caractères.');
  // Dernier morceau : les précédents (0 à part - 1, tous là) et celui-ci font la collection.
  let size = partSize;
  let chunked = false;
  if (up && up.part > 0) {
    const st = await db.prepare(
      'SELECT COUNT(*) AS n, MIN(part) AS lo, MAX(part) AS hi, COALESCE(SUM(bytes), 0) AS bytes FROM target_uploads WHERE user_id = ?1 AND upload_id = ?2',
    ).bind(user.id, up.id).first();
    if (!st || st.n !== up.part || st.lo !== 0 || st.hi !== up.part - 1) {
      throw new HttpError(400, "Des morceaux de la collection manquent (envoi interrompu depuis plus d'une heure ?) : rien n'a été enregistré, réessaie.");
    }
    chunked = true;
    // '[' + morceaux non vides séparés par des virgules + ']'.
    const parts = st.n + (items.length ? 1 : 0);
    size = st.bytes + (items.length ? partSize - 2 : 0) + (parts - 1) + 2;
    itemsJson = null;
  }
  if (size > MAX_ITEMS_BYTES) throw new HttpError(400, 'Collection trop volumineuse : 1,7 Mo au plus.');

  let source = null;
  if (body.source !== undefined && body.source !== null) {
    if (typeof body.source !== 'string' || body.source.length > 200) {
      throw new HttpError(400, 'Le champ « source » doit être un texte de 200 caractères au plus.');
    }
    source = body.source.trim() || null;
  }

  let expect = null;
  if (body.expect_updated_at !== undefined && body.expect_updated_at !== null) {
    if (typeof body.expect_updated_at !== 'string' || !body.expect_updated_at || body.expect_updated_at.length > MAX_UPDATED_AT) {
      throw new HttpError(400, 'Le champ « expect_updated_at » doit être le updated_at lu de la collection.');
    }
    if (body.id === undefined || body.id === null || body.id === '') throw new HttpError(400, "« expect_updated_at » demande l'id de la collection.");
    expect = body.expect_updated_at;
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

  // Les autres collections du compte (celle-ci, si elle existe, est remplacée), et celle-ci telle que rangée (son ajout
  // automatique, son updated_at).
  const [othersRes, curRes] = await db.batch([
    db.prepare(
      `SELECT COUNT(*) AS n, SUM(id = ?2) AS mine,
              COALESCE(SUM(CASE WHEN id <> ?2 THEN length(CAST(items AS BLOB)) + COALESCE(length(CAST(auto AS BLOB)), 0) END), 0) AS bytes
       FROM targets WHERE user_id = ?1`,
    ).bind(user.id, id),
    db.prepare('SELECT auto, updated_at FROM targets WHERE user_id = ?1 AND id = ?2').bind(user.id, id),
  ]);
  const others = othersRes.results[0];
  const cur = curRes.results[0] || null;
  if (expect !== null && (!cur || cur.updated_at !== expect)) throw await conflict(db, user, id);
  const auto = nextAuto(body, cur ? cur.auto : null);
  if (!others.mine && others.n >= MAX_TARGETS) throw new HttpError(400, `${MAX_TARGETS} collections au plus.`);
  const autoBytes = auto === undefined ? (cur && cur.auto ? byteLength(cur.auto) : 0) : auto === null ? 0 : byteLength(auto);
  if (others.bytes + size + autoBytes > MAX_TOTAL_BYTES) {
    throw new HttpError(400, 'Tes collections à compléter dépassent 5 Mo en tout : supprimes-en une avant.');
  }

  const now = nowIso();
  const setAuto = auto === undefined ? 0 : 1;
  const autoText = auto === undefined ? null : auto;
  // Éléments : ?4, ou, envoyée en morceaux (?4 = l'envoi), ceux de target_uploads (le dernier compris) dans l'ordre,
  // assemblés en SQL.
  const itemsSql = chunked
    ? `(SELECT '[' || group_concat(x, ',') || ']' FROM (SELECT items AS x FROM target_uploads WHERE user_id = ?1 AND upload_id = ?4 ORDER BY part))`
    : '?4';
  const items4 = chunked ? up.id : itemsJson;
  const write = expect !== null
    // Remplacement conditionnel : rien n'est écrit si un autre enregistrement est passé entre-temps.
    ? db.prepare(
      `UPDATE targets SET name = ?3, items = ${itemsSql}, source = ?5, updated_at = ?6, auto = CASE WHEN ?7 = 1 THEN ?8 ELSE auto END
       WHERE user_id = ?1 AND id = ?2 AND updated_at = ?9
       RETURNING id, name, source, auto, created_at, updated_at`,
    )
      .bind(user.id, id, name, items4, source, now, setAuto, autoText, expect)
    : db.prepare(
      `INSERT INTO targets (user_id, id, name, items, source, created_at, updated_at, auto)
       VALUES (?1, ?2, ?3, ${itemsSql}, ?5, ?6, ?6, ?8)
       ON CONFLICT (user_id, id) DO UPDATE SET
         name = excluded.name, items = excluded.items, source = excluded.source, updated_at = excluded.updated_at,
         auto = CASE WHEN ?7 = 1 THEN excluded.auto ELSE targets.auto END
       RETURNING id, name, source, auto, created_at, updated_at`,
    )
      .bind(user.id, id, name, items4, source, now, setAuto, autoText);
  let row;
  if (chunked) {
    // Une transaction : le dernier morceau rangé, la collection écrite, les morceaux effacés.
    const put = items.length ? [db.prepare('INSERT OR REPLACE INTO target_uploads (user_id, upload_id, part, items, bytes, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(user.id, up.id, up.part, JSON.stringify(items).slice(1, -1), partSize - 2, now)] : [];
    const res = await db.batch([...put, write, db.prepare('DELETE FROM target_uploads WHERE user_id = ?1 AND upload_id = ?2').bind(user.id, up.id)]);
    row = res[put.length].results[0] || null;
  } else {
    row = await write.first();
  }
  if (!row) throw await conflict(db, user, id);
  return { row, itemsJson, chunked, count: items.length };
}

// Un morceau d'une collection envoyée en plusieurs (sans ses crochets), en attendant le dernier. Au plus MAX_UPLOADS
// envois en cours par compte (les plus anciens partent), et pas plus de 1,7 Mo par envoi ; purge à une heure.
async function stashPart(db, user, up, text, bytes) {
  const st = await db.prepare(
    'SELECT COALESCE(SUM(bytes), 0) AS bytes FROM target_uploads WHERE user_id = ?1 AND upload_id = ?2 AND part <> ?3',
  ).bind(user.id, up.id, up.part).first();
  if ((st ? st.bytes : 0) + bytes > MAX_ITEMS_BYTES) throw new HttpError(400, 'Collection trop volumineuse : 1,7 Mo au plus.');
  await db.batch([
    ...purgeStaging(db),
    db.prepare(
      `DELETE FROM target_uploads WHERE user_id = ?1 AND upload_id IN (
         SELECT upload_id FROM target_uploads WHERE user_id = ?1 AND upload_id <> ?2
         GROUP BY upload_id ORDER BY MAX(created_at) DESC, MAX(rowid) DESC LIMIT -1 OFFSET ${MAX_UPLOADS - 1})`,
    ).bind(user.id, up.id),
    db.prepare('INSERT OR REPLACE INTO target_uploads (user_id, upload_id, part, items, bytes, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(user.id, up.id, up.part, text, bytes, nowIso()),
  ]);
}

// 409 d'un enregistrement conditionnel (expect_updated_at) : la collection telle qu'elle est maintenant (null si elle a
// été supprimée), pour que la page reparte d'elle.
async function conflict(db, user, id) {
  const row = await db.prepare('SELECT id, name, items, source, auto, created_at, updated_at FROM targets WHERE user_id = ?1 AND id = ?2')
    .bind(user.id, id)
    .first();
  return new HttpError(409, "Cette collection a changé entre-temps (dans un autre onglet ou sur un autre appareil) : rien n'a été enregistré.", {
    conflict: true,
    target: row ? raw(jsonText(toTarget(row))) : null,
  });
}

// POST /api/targets/delete {id}
export async function deleteTarget(env, user, body) {
  if (typeof body.id !== 'string' || !body.id) throw new HttpError(400, 'Indique la collection à supprimer (id).');
  await env.DB.prepare('DELETE FROM targets WHERE user_id = ?1 AND id = ?2').bind(user.id, body.id).run();
  return { ok: true };
}
