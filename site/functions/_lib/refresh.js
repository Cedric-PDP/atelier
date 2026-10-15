// POST /api/refresh {page} : lit la collection sur WikiMasters avec le cookie gardé, 10 pages au plus par appel.
// Lecture seule, mêmes requêtes que la page « Collection » du jeu ; toujours lancé par un geste de l'utilisateur.

import { purgeStaging } from './db.js';
import { HttpError } from './http.js';
import { entryToCard } from './cards.js';
import { REFRESH_SOURCE, finalizeImport, pickStats } from './import.js';
import { GAME_HOST, decryptCookie, encryptCookie, mergeSetCookies, setCookiesOf } from './session.js';
import { nowIso, sleep } from './util.js';

const GAME = `https://${GAME_HOST}`;
const PAGE_SIZE = 50;
const PAGES_PER_CALL = 10; // 500 entrées au plus traitées en JavaScript par appel (limite de calcul des Workers)
const MAX_PAGE = 1000; // 50 000 exemplaires : au-delà, quelque chose ne va pas
const PAUSE_MS = 250;

const NO_SESSION = "Aucune session WikiMasters : colle d'abord ton cookie.";
const EXPIRED = 'Ta session WikiMasters a expiré : colle un nouveau cookie.';

const STAGE = 'INSERT OR REPLACE INTO refresh_staging (user_id, page, entries, created_at) VALUES (?1, ?2, ?3, ?4)';

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
      res = await fetch(GAME + path, { headers: { Cookie: cookie, Accept: 'application/json' } });
    } catch {
      throw new HttpError(502, 'WikiMasters ne répond pas : réessaie dans un moment.');
    }
    cookie = mergeSetCookies(cookie, setCookiesOf(res.headers));
    if (res.status === 401 || res.status === 403) {
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

  const staged = []; // [page, JSON des cartes partielles] ; page -1 = statistiques
  let done = false;
  let failure = null;
  try {
    if (page === 0) {
      const stats = pickStats(await gameGet('/api/my-collection/stats?sort=rarity'));
      staged.push([-1, JSON.stringify(stats ?? {})]);
    }
    for (let p = page; p < page + PAGES_PER_CALL; p++) {
      if (p > MAX_PAGE) throw new HttpError(502, 'WikiMasters renvoie trop de pages : rafraîchissement arrêté.');
      const data = await gameGet(`/api/my-collection?sort=rarity&page=${p}&stats=0`);
      const list = data && Array.isArray(data.collection) ? data.collection : null;
      if (!list) throw new HttpError(502, 'Réponse inattendue de WikiMasters (pas de champ « collection »).');
      const cards = [];
      for (const entry of list) {
        const card = entryToCard(entry);
        if (card) cards.push(card);
      }
      staged.push([p, JSON.stringify(cards)]);
      if (list.length < PAGE_SIZE) {
        done = true;
        break;
      }
    }
  } catch (err) {
    failure = err;
  }

  // Même en cas d'erreur, on garde le cookie renouvelé par le jeu et l'état de la session.
  const writes = [];
  if (cookie !== original) {
    writes.push(
      db.prepare('UPDATE users SET cookie_enc = ?1, cookie_updated_at = ?2 WHERE id = ?3')
        .bind(await encryptCookie(env, user.id, cookie), nowIso(), user.id),
    );
  }
  if (expired) writes.push(db.prepare('UPDATE users SET session_expired = 1 WHERE id = ?1').bind(user.id));
  if (!failure) {
    const now = nowIso();
    for (const [p, text] of staged) writes.push(db.prepare(STAGE).bind(user.id, p, text, now));
  }
  if (writes.length) await db.batch(writes);
  if (failure) throw failure;

  if (!done) {
    const progress = await db.prepare(
      `SELECT SUM(CASE WHEN page >= 0 THEN json_array_length(entries) END) AS fetched,
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
    };
  }

  // Dernière page lue : finalisation en SQL (comme un import), puis table d'attente vidée (même transaction).
  const statsRow = await db.prepare('SELECT entries FROM refresh_staging WHERE user_id = ?1 AND page = -1')
    .bind(user.id)
    .first();
  const result = await finalizeImport(db, user, {
    source: REFRESH_SOURCE,
    key: 0,
    stats: statsRow ? JSON.parse(statsRow.entries) : null,
    clear: [db.prepare('DELETE FROM refresh_staging WHERE user_id = ?1').bind(user.id)],
  });
  return { done: true, ...result };
}
