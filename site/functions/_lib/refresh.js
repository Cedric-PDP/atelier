// POST /api/refresh {page, full?} : lit la collection sur WikiMasters avec le cookie gardé, 10 pages au plus par appel.
// Lecture seule, mêmes requêtes que la page « Collection » du jeu ; toujours lancé par un geste de l'utilisateur.
// Synchro rapide d'abord (page 0, sans full) : seulement les exemplaires plus récents que la dernière synchro (import.js).

import { purgeStaging } from './db.js';
import { HttpError } from './http.js';
import { entryToCard } from './cards.js';
import { REFRESH_SOURCE, deltaFits, finalizeImport, pickStats, quickSyncAllowed, syncState, writeDelta } from './import.js';
import { GAME_HOST, decryptCookie, encryptCookie, mergeSetCookies, setCookiesOf } from './session.js';
import { nowIso, sleep } from './util.js';

const GAME = `https://${GAME_HOST}`;
const PAGE_SIZE = 50;
const PAGES_PER_CALL = 10; // 500 entrées au plus traitées en JavaScript par appel (limite de calcul des Workers)
const MAX_PAGE = 1000; // 50 000 exemplaires : au-delà, quelque chose ne va pas
const PAUSE_MS = 250;

const NO_SESSION = "Aucune session WikiMasters : colle d'abord ton cookie.";
const EXPIRED = 'Ta session WikiMasters a expiré : colle un nouveau cookie.';

const STAGE = `INSERT OR REPLACE INTO refresh_staging (user_id, page, entries, skipped, created_at)
  VALUES (?1, ?2, ?3, ?4, ?5)`;

// Exemplaires plus récents que lastAt, en lisant la collection du plus récent au plus ancien (sort=added, 10 pages au
// plus). null si l'ordre n'est pas celui attendu (tri non respecté) ou s'il y en a trop : relecture complète.
async function readNewest(gameGet, lastAt) {
  const fresh = [];
  let prev = null;
  for (let p = 0; p < PAGES_PER_CALL; p++) {
    const data = await gameGet(`/api/my-collection?sort=added&page=${p}&stats=0`);
    const list = data && Array.isArray(data.collection) ? data.collection : null;
    if (!list) return null;
    for (const entry of list) {
      const at = entry && entry.obtained_at;
      if (typeof at !== 'string' || (prev !== null && at > prev)) return null;
      prev = at;
      if (at <= lastAt) return fresh;
      fresh.push(entry);
    }
    if (list.length < PAGE_SIZE) return fresh;
  }
  return null;
}

// Nouveautés → {text, rows, copies, lastAt} pour deltaFits / writeDelta ; null si une entrée est inexploitable.
function deltaOf(fresh) {
  const seen = new Set();
  const cards = [];
  let rows = 0;
  let copies = 0;
  for (const entry of fresh) {
    const eid = entry.id ?? null;
    if (eid !== null) {
      if (seen.has(eid)) continue;
      seen.add(eid);
    }
    const card = entryToCard(entry);
    if (!card) return null;
    cards.push(card);
    rows++;
    copies += card.count;
  }
  return { text: JSON.stringify(cards), rows, copies, lastAt: fresh.length ? fresh[0].obtained_at : null };
}

export async function refresh(env, user, body) {
  const db = env.DB;
  const page = body.page ?? 0;
  if (!Number.isInteger(page) || page < 0 || page > MAX_PAGE) throw new HttpError(400, 'Numéro de page invalide.');
  if (!user.cookie_enc) throw new HttpError(401, NO_SESSION, { needs_session: true });
  if (user.session_expired) throw new HttpError(401, EXPIRED, { needs_session: true });

  const original = await decryptCookie(env, user.id, user.cookie_enc);
  let cookie = original;
  // Pause réglable pour les tests (REFRESH_PAUSE_MS) ; 250 ms sinon.
  const pause = env.REFRESH_PAUSE_MS !== undefined ? Number(env.REFRESH_PAUSE_MS) : PAUSE_MS;

  if (page === 0) {
    await db.batch([...purgeStaging(db), db.prepare('DELETE FROM refresh_staging WHERE user_id = ?1').bind(user.id)]);
  } else {
    await db.batch(purgeStaging(db));
    // Les pages précédentes doivent toutes être en attente (sinon : rafraîchissement interrompu).
    const row = await db.prepare(
      'SELECT COUNT(*) AS n FROM refresh_staging WHERE user_id = ?1 AND page >= 0 AND page < ?2',
    )
      .bind(user.id, page)
      .first();
    if (!row || row.n !== page) {
      throw new HttpError(409, 'Le rafraîchissement a été interrompu : recommence depuis le début.');
    }
  }

  let expired = false;
  let calls = 0;
  const gameGet = async (path) => {
    if (calls++ > 0) await sleep(pause);
    let res;
    try {
      // Pas de redirection suivie : une redirection (vers la connexion) veut dire que la session a expiré.
      res = await fetch(GAME + path, { headers: { Cookie: cookie, Accept: 'application/json' }, redirect: 'manual' });
    } catch {
      throw new HttpError(502, 'WikiMasters ne répond pas : réessaie dans un moment.');
    }
    cookie = mergeSetCookies(cookie, setCookiesOf(res.headers));
    const redirected = res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400);
    if (res.status === 401 || redirected) {
      expired = true;
      throw new HttpError(401, EXPIRED, { needs_session: true });
    }
    if (res.status === 403) {
      // 403 en JSON : le jeu refuse la session. Autre chose (page HTML) : sans doute la protection anti-robots
      // devant le site, la session n'y est pour rien.
      const text = await res.text().catch(() => '');
      try {
        JSON.parse(text);
      } catch {
        throw new HttpError(502, 'WikiMasters a refusé la requête (protection anti-robots ?) : réessaie plus tard.');
      }
      expired = true;
      throw new HttpError(401, EXPIRED, { needs_session: true });
    }
    if (!res.ok) throw new HttpError(502, `WikiMasters a répondu ${res.status} : réessaie dans un moment.`);
    try {
      return await res.json();
    } catch {
      throw new HttpError(502, "Réponse inattendue de WikiMasters (ce n'est pas du JSON).");
    }
  };

  const staged = []; // [page, JSON des cartes partielles, entrées ignorées] ; page -1 = statistiques
  let done = false;
  let quick = null; // synchro rapide validée : {text, stats, lastAt}
  let failure = null;
  try {
    if (page === 0) {
      const stats = pickStats(await gameGet('/api/my-collection/stats?sort=rarity'));
      staged.push([-1, JSON.stringify(stats ?? {}), 0]);
      const state = syncState(user);
      if (body.full !== true && stats && quickSyncAllowed(state)) {
        const fresh = await readNewest(gameGet, state.last_at);
        const delta = fresh && deltaOf(fresh);
        if (delta && (await deltaFits(db, user, { ...delta, stats }))) quick = { text: delta.text, stats, lastAt: delta.lastAt };
      }
    }
    for (let p = page; !quick && p < page + PAGES_PER_CALL; p++) {
      if (p > MAX_PAGE) throw new HttpError(502, 'WikiMasters renvoie trop de pages : rafraîchissement arrêté.');
      const data = await gameGet(`/api/my-collection?sort=rarity&page=${p}&stats=0`);
      const list = data && Array.isArray(data.collection) ? data.collection : null;
      if (!list) throw new HttpError(502, 'Réponse inattendue de WikiMasters (pas de champ « collection »).');
      const cards = [];
      for (const entry of list) {
        const card = entryToCard(entry);
        if (card) cards.push(card);
      }
      staged.push([p, JSON.stringify(cards), list.length - cards.length]);
      if (list.length < PAGE_SIZE) {
        done = true;
        break;
      }
    }
  } catch (err) {
    failure = err;
  }

  // Même en cas d'erreur, le cookie renouvelé par le jeu et l'état de la session sont gardés, dans une requête à
  // part et avant les pages (si l'écriture des pages échoue, le cookie est quand même à jour).
  if (cookie !== original || expired) {
    const sets = [];
    const params = [];
    if (cookie !== original) {
      params.push(await encryptCookie(env, user.id, cookie), nowIso());
      sets.push(`cookie_enc = ?${params.length - 1}`, `cookie_updated_at = ?${params.length}`);
    }
    if (expired) sets.push('session_expired = 1');
    params.push(user.id);
    await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?${params.length}`).bind(...params).run();
  }
  if (failure) throw failure;
  if (quick) {
    const result = await writeDelta(db, user, { ...quick, clear: [db.prepare('DELETE FROM refresh_staging WHERE user_id = ?1').bind(user.id)] });
    return { done: true, ...result };
  }
  const now = nowIso();
  await db.batch(staged.map(([p, text, skipped]) => db.prepare(STAGE).bind(user.id, p, text, skipped, now)));

  if (!done) {
    const progress = await db.prepare(
      `SELECT SUM(CASE WHEN page >= 0 THEN json_array_length(entries) + skipped END) AS fetched,
              SUM(CASE WHEN page >= 0 THEN skipped END) AS skipped,
              MAX(CASE WHEN page < 0 THEN json_extract(entries, '$.total') END) AS total
       FROM refresh_staging WHERE user_id = ?1`,
    )
      .bind(user.id)
      .first();
    return {
      done: false,
      next_page: page + PAGES_PER_CALL,
      fetched: progress?.fetched ?? 0,
      total: typeof progress?.total === 'number' ? progress.total : null,
      skipped: progress?.skipped ?? 0,
    };
  }

  // Dernière page lue : finalisation en SQL (comme un import), puis table d'attente vidée (même transaction).
  const info = await db.prepare(
    `SELECT MAX(CASE WHEN page = -1 THEN entries END) AS stats, SUM(CASE WHEN page >= 0 THEN skipped END) AS skipped
     FROM refresh_staging WHERE user_id = ?1`,
  )
    .bind(user.id)
    .first();
  const result = await finalizeImport(db, user, {
    source: REFRESH_SOURCE,
    key: 0,
    stats: info?.stats ? JSON.parse(info.stats) : null,
    clear: [db.prepare('DELETE FROM refresh_staging WHERE user_id = ?1').bind(user.id)],
    skipped: info?.skipped ?? 0,
  });
  return { done: true, ...result };
}
