// Lecture de la collection dans la base du jeu (PostgREST), avec la session du joueur gardée par le serveur (game.js) :
// au clic (POST /api/refresh, une fois par minute au plus) ou par les lectures automatiques (readCollection). Une page de
// 1 000 exemplaires par requête, carte et tags du jeu compris, et le compte exact des exemplaires lu avant et après
// (contrôle de la lecture, finalizeImport). Un bail par compte (sync_lock) : jamais deux lectures en même temps avec la
// même session. Chaque fin de lecture, réussie ou non, laisse une ligne au journal des synchros (synclog.js).

import { purgeStaging } from './db.js';
import { HttpError } from './http.js';
import { RARITIES, badCard, entryToCard } from './cards.js';
import { REFRESH_SOURCE, finalizeImport } from './import.js';
import { acquireLease, freshAuth, releaseLease, sessionOf, supaGet } from './game.js';
import { errorEntry, logStatements, writeLog } from './synclog.js';
import { nowIso } from './util.js';

export const FAILS_MAX = 3; // échecs d'affilée des lectures automatiques avant la pause (jusqu'à un clic réussi)
export const CLICK_GAP_MS = 60_000;
export const LEASE_MS = 10 * 60_000;
const PAGE = 1000;
const HALF = 500; // une page rangée en deux lignes : une ligne D1 fait 2 Mo au plus
const MAX_PAGES = 50; // 50 000 exemplaires : au-delà, quelque chose ne va pas
const PAGE_GAP_MS = 250;

export const ENTRY_FIELDS = 'id,card_id,user_id,count,starred,is_shiny,obtained_at,snapshot_rarity,snapshot_atk,snapshot_def,'
  + 'card:cards(id,wikipedia_title,wikipedia_url,image_url,hide_image,rarity,atk,def,q_score,pageviews,category,lang),'
  + 'tags:user_card_tags(tag:tags(id,name,color))';
const ORDER = 'order=obtained_at.desc,id.asc';

const STAGE = `INSERT OR REPLACE INTO refresh_staging (user_id, page, entries, skipped, created_at)
  VALUES (?1, ?2, ?3, ?4, ?5)`;

// Ligne user_cards (carte et tags embarqués) → exemplaire au format de /api/my-collection du jeu (entryToCard) : les
// snapshot_* de l'exemplaire, quand il en a, remplacent rareté (connue seulement), attaque et défense de la carte. Jamais
// le user_id du jeu.
export function toEntry(row) {
  if (!row || typeof row !== 'object') return row;
  let card = row.card;
  if (card && typeof card === 'object') {
    card = { ...card };
    for (const f of ['rarity', 'atk', 'def']) {
      const v = row[`snapshot_${f}`];
      if (v !== null && v !== undefined && (f !== 'rarity' || RARITIES.has(v))) card[f] = v;
    }
  }
  return {
    id: row.id,
    card,
    tags: Array.isArray(row.tags) ? row.tags.map((t) => t && t.tag).filter(Boolean) : [],
    count: row.count,
    card_id: row.card_id,
    starred: row.starred,
    is_shiny: row.is_shiny,
    obtained_at: row.obtained_at,
    snapshot_rarity: row.snapshot_rarity,
  };
}

// Vérification légère : compte exact des exemplaires et obtained_at du plus récent, en une requête → {rows, last_at}.
export async function checkCollection(env, user, s) {
  const { rows, count } = await supaGet(env, user, s, `user_cards?select=obtained_at&user_id=eq.${encodeURIComponent(s.uid)}&${ORDER}&limit=1`,
    { count: true });
  return { rows: count, last_at: rows[0]?.obtained_at ?? null };
}

// POST /api/refresh {} : « Rafraîchir ». Toute erreur laisse une ligne au journal, sauf les refus d'avant la lecture
// (moins d'une minute après le précédent clic, lecture déjà en cours).
export async function refresh(env, user) {
  try {
    return await readCollection(env, user, { via: 'clic' });
  } catch (err) {
    const refused = err instanceof HttpError && (err.status === 409 || err.extra.retry_after !== undefined);
    if (!refused) await writeLog(env.DB, user.id, errorEntry('full', err, { via: 'clic' }));
    throw err;
  }
}

// Lecture complète (via : clic | cron). Au clic, une par minute au plus (force : sans cette limite).
export async function readCollection(env, user, { via, force = false } = {}) {
  const db = env.DB;
  if (via === 'clic' && !force) await takeClick(db, user);
  const s = await sessionOf(env, user);
  s.via = via;
  const lease = await acquireLease(db, user.id, LEASE_MS);
  if (!lease) {
    throw new HttpError(409, "Une lecture de ta collection est déjà en cours (automatique, ou depuis un autre appareil) : réessaie dans un instant.");
  }
  let held = true;
  try {
    await freshAuth(env, user, s);
    const started = nowIso();
    await db.batch([...purgeStaging(db), db.prepare('DELETE FROM refresh_staging WHERE user_id = ?1').bind(user.id)]);
    const base = `user_cards?select=${ENTRY_FIELDS}&user_id=eq.${encodeURIComponent(s.uid)}&${ORDER}&limit=${PAGE}`;
    let before = null;
    let lastBefore = null;
    let skipped = 0;
    for (let p = 0; ; p++) {
      const { rows, count } = await supaGet(env, user, s, `${base}&offset=${p * PAGE}`, { count: p === 0, gap: p ? PAGE_GAP_MS : 0 });
      if (p === 0) {
        before = count;
        lastBefore = rows[0]?.obtained_at ?? null;
        if (before === 0 || !rows.length) {
          await db.batch([releaseLease(db, user.id, lease), ...logStatements(db, user.id, {
            kind: 'full', result: 'warn', message: "Collection vide dans le jeu : rien n'a été changé.", data: { via },
          })]);
          held = false;
          return { count: 0, empty: true };
        }
      }
      skipped += await stagePage(db, user.id, p, rows);
      if (rows.length < PAGE) break;
      if (p + 1 >= MAX_PAGES) throw new HttpError(400, 'Collection trop grande : 50 000 exemplaires au plus.');
    }
    const end = await checkCollection(env, user, s);
    const result = await finalizeImport(db, user, {
      source: REFRESH_SOURCE,
      key: 0,
      exact: { before, after: end.rows, lastBefore, lastAfter: end.last_at },
      started,
      clear: [db.prepare('DELETE FROM refresh_staging WHERE user_id = ?1').bind(user.id), releaseLease(db, user.id, lease)],
      skipped,
      log: { via },
    });
    held = false;
    return result;
  } finally {
    if (held) await releaseLease(db, user.id, lease).run().catch((err) => console.error(err));
  }
}

// Une page lue → deux lignes de la table d'attente (page 2p et 2p + 1). Rend le nombre d'entrées invalides.
async function stagePage(db, userId, p, rows) {
  const now = nowIso();
  const statements = [];
  let skipped = 0;
  for (let h = 0; h * HALF < rows.length; h++) {
    const cards = [];
    let bad = 0;
    for (const row of rows.slice(h * HALF, (h + 1) * HALF)) {
      const entry = toEntry(row);
      const card = entryToCard(entry);
      if (card) {
        cards.push(card);
      } else {
        bad++;
        cards.push(badCard(entry, true));
      }
    }
    skipped += bad;
    statements.push(db.prepare(STAGE).bind(userId, 2 * p + h, JSON.stringify(cards), bad, now));
  }
  await db.batch(statements);
  return skipped;
}

// « Rafraîchir » une fois par minute au plus, tous appareils confondus.
async function takeClick(db, user) {
  const now = Date.now();
  const row = await db.prepare(
    'UPDATE users SET sync_click_at = ?2 WHERE id = ?1 AND (sync_click_at IS NULL OR sync_click_at <= ?3) RETURNING id',
  ).bind(user.id, new Date(now).toISOString(), new Date(now - CLICK_GAP_MS).toISOString()).first();
  if (row) return;
  const last = await db.prepare('SELECT sync_click_at FROM users WHERE id = ?1').bind(user.id).first();
  const wait = Math.max(1, Math.ceil((Date.parse(last?.sync_click_at || '') + CLICK_GAP_MS - now) / 1000) || 1);
  throw new HttpError(429, "Collection déjà rafraîchie il y a moins d'une minute : patiente un instant.", { retry_after: Math.min(wait, 60) });
}
