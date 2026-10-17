// POST /api/refresh {page, full?, run?} : lit la collection sur WikiMasters avec le cookie gardé, 10 pages au plus par
// appel. Lecture seule, mêmes requêtes que la page « Collection » du jeu ; toujours lancé par un geste de l'utilisateur.
// Synchro rapide d'abord (page 0, sans full) : seulement les exemplaires plus récents que la dernière synchro (import.js).
// La page 0 rend un jeton de lecture (run) que les appels suivants renvoient : une autre lecture commencée entre-temps
// (autre onglet) arrête celle-ci au lieu de mélanger leurs pages. Chaque fin de lecture, réussie ou non, laisse une ligne
// au journal des synchros (synclog.js, via « cookie »).

import { purgeStaging } from './db.js';
import { HttpError } from './http.js';
import { badCard, entryToCard } from './cards.js';
import { REFRESH_SOURCE, deltaFits, finalizeImport, pickStats, quickSyncAllowed, startedAt, syncState, writeDelta } from './import.js';
import { GAME_HOST, decryptCookie, encryptCookie, mergeSetCookies, setCookiesOf } from './session.js';
import { errorEntry, writeLog } from './synclog.js';
import { nowIso, randomToken, sleep } from './util.js';

const GAME = `https://${GAME_HOST}`;
const PAGE_SIZE = 50;
const PAGES_PER_CALL = 10; // 500 entrées au plus traitées en JavaScript par appel (limite de calcul des Workers)
const MAX_PAGE = 1000; // 50 000 exemplaires : au-delà, quelque chose ne va pas
const PAUSE_MS = 250;

const NO_SESSION = "Aucune session WikiMasters : colle d'abord ton cookie.";
const EXPIRED = 'Ta session WikiMasters a expiré : colle un nouveau cookie.';
const LIMITED = 'Le jeu limite les lectures automatiques : réessaie plus tard.';

const STAGE = `INSERT OR REPLACE INTO refresh_staging (user_id, page, entries, skipped, created_at)
  VALUES (?1, ?2, ?3, ?4, ?5)`;

// Exemplaires plus récents que lastAt, en lisant la collection du plus récent au plus ancien (sort=added, maxPages
// pages au plus) : {fresh, pages}. Sinon {reason, pages}, et relecture complète : réponse du jeu en erreur ou sans liste
// ('error', 'collection'), dates dans le désordre ('order'), exemplaire de la dernière synchro introuvable ('gone' : le
// premier d'au plus lastAt doit être lui, à la même date), trop de nouveautés ('too_many'). pages = requêtes faites.
// Session expirée ou limite de lectures du jeu : tout s'arrête (la relecture complète échouerait pareil).
async function readNewest(gameGet, lastAt, maxPages) {
  const fresh = [];
  let prev = null;
  for (let p = 0; p < maxPages; p++) {
    let data;
    try {
      data = await gameGet(`/api/my-collection?sort=added&page=${p}&stats=0`);
    } catch (err) {
      if (err instanceof HttpError && (err.extra.needs_session || err.status === 429)) throw err;
      return { reason: 'error', pages: p + 1 };
    }
    const list = data && Array.isArray(data.collection) ? data.collection : null;
    if (!list) return { reason: 'collection', pages: p + 1 };
    let stop = -1;
    for (let i = 0; i < list.length; i++) {
      const at = list[i] && list[i].obtained_at;
      if (typeof at !== 'string' || (prev !== null && at > prev)) return { reason: 'order', pages: p + 1 };
      prev = at;
      if (stop < 0 && at <= lastAt) stop = i;
      if (stop < 0) fresh.push(list[i]);
    }
    // Le reste de la page a aussi été contrôlé (ordre des dates) : un tri ignoré ou croissant ne passe pas pour une vente.
    if (stop >= 0) return list[stop].obtained_at === lastAt ? { fresh, pages: p + 1 } : { reason: 'gone', pages: p + 1 };
    if (list.length < PAGE_SIZE) return { reason: 'gone', pages: p + 1 };
  }
  return { reason: 'too_many', pages: maxPages };
}

// Nouveautés → {cards, text, rows, copies, lastAt} pour deltaFits / writeDelta ; null si une entrée est inexploitable.
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
  return { cards, text: JSON.stringify(cards), rows, copies, lastAt: fresh.length ? fresh[0].obtained_at : null };
}

// Toute erreur laisse une ligne au journal des synchros (phase : synchro rapide ou lecture complète).
export async function refresh(env, user, body) {
  const ctx = { phase: 'full' };
  try {
    return await refreshCall(env, user, body, ctx);
  } catch (err) {
    await writeLog(env.DB, user.id, errorEntry(ctx.phase, err, { via: 'cookie', page: Number.isInteger(body.page) ? body.page : 0 }));
    throw err;
  }
}

async function refreshCall(env, user, body, ctx) {
  const db = env.DB;
  const page = body.page ?? 0;
  if (!Number.isInteger(page) || page < 0 || page > MAX_PAGE) throw new HttpError(400, 'Numéro de page invalide.');
  if (body.run !== undefined && body.run !== null && (typeof body.run !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.run))) {
    throw new HttpError(400, 'Jeton de lecture (run) invalide.');
  }
  if (!user.cookie_enc) throw new HttpError(401, NO_SESSION, { needs_session: true });
  if (user.session_expired) throw new HttpError(401, EXPIRED, { needs_session: true });

  const original = await decryptCookie(env, user.id, user.cookie_enc);
  let cookie = original;
  // Pause réglable pour les tests (REFRESH_PAUSE_MS) ; 250 ms sinon.
  const pause = env.REFRESH_PAUSE_MS !== undefined ? Number(env.REFRESH_PAUSE_MS) : PAUSE_MS;

  // Jeton de cette lecture (tiré à la page 0, gardé dans la page -1 de la table d'attente) et son début.
  let run = body.run ?? null;
  if (page === 0) {
    run = randomToken(9);
    await db.batch([...purgeStaging(db), db.prepare('DELETE FROM refresh_staging WHERE user_id = ?1').bind(user.id)]);
  } else {
    await db.batch(purgeStaging(db));
    // Les pages précédentes doivent toutes être en attente (sinon : rafraîchissement interrompu), et être celles de
    // cette lecture (jeton de la page -1 ; un ancien client sans jeton n'est pas contrôlé).
    const row = await db.prepare(
      `SELECT COUNT(*) AS n,
         (SELECT json_extract(entries, '$.run') FROM refresh_staging WHERE user_id = ?1 AND page = -1) AS run
       FROM refresh_staging WHERE user_id = ?1 AND page >= 0 AND page < ?2`,
    )
      .bind(user.id, page)
      .first();
    if (row && run && row.run && row.run !== run) {
      throw new HttpError(409, "Une autre mise à jour a commencé entre-temps (dans un autre onglet ?) : celle-ci s'arrête, sans rien changer à ton classeur.");
    }
    if (!row || row.n !== page) {
      throw new HttpError(409, "Le rafraîchissement a été interrompu : recommence depuis le début (ton classeur n'a pas été modifié).");
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
      // 403 en JSON : le jeu refuse la session, sauf `code: 'automation_limit'` (limite de lectures automatiques, vue
      // sur son marché : la session n'y est pour rien). Autre chose (page HTML) : sans doute la protection anti-robots
      // devant le site, la session n'y est pour rien non plus.
      const text = await res.text().catch(() => '');
      let reply;
      try {
        reply = JSON.parse(text);
      } catch {
        throw new HttpError(502, 'WikiMasters a refusé la requête (protection anti-robots ?) : réessaie plus tard.');
      }
      if (reply && reply.code === 'automation_limit') throw new HttpError(429, LIMITED);
      expired = true;
      throw new HttpError(401, EXPIRED, { needs_session: true });
    }
    if (res.status === 429) throw new HttpError(429, LIMITED);
    if (!res.ok) throw new HttpError(502, `WikiMasters a répondu ${res.status} : réessaie dans un moment.`);
    try {
      return await res.json();
    } catch {
      throw new HttpError(502, "Réponse inattendue de WikiMasters (ce n'est pas du JSON).");
    }
  };

  const staged = []; // [page, JSON des cartes partielles et des marques d'entrées invalides, entrées ignorées] ; -1 = stats
  let done = false;
  let next = page; // première page pas encore lue
  let quick = null; // synchro rapide écrite : la réponse de writeDelta
  let statsEnd = null; // compteurs relus après la dernière page (lecture en plusieurs appels)
  let failure = null;
  try {
    let budget = PAGES_PER_CALL;
    if (page === 0) {
      const stats = pickStats(await gameGet('/api/my-collection/stats?sort=rarity'));
      const started = nowIso();
      staged.push([-1, JSON.stringify({ ...(stats ?? {}), run, started }), 0]);
      const state = syncState(user);
      if (body.full !== true && stats && quickSyncAllowed(state)) {
        ctx.phase = 'quick';
        // PAGES_PER_CALL - 1 pages au plus : la relecture complète qui suivrait un échec lit au moins une page, et
        // l'appel ne décode jamais plus de PAGES_PER_CALL pages en tout.
        const got = await readNewest(gameGet, state.last_at, PAGES_PER_CALL - 1);
        budget -= got.pages;
        const delta = got.fresh && deltaOf(got.fresh);
        const fit = delta && (await deltaFits(db, user, state, { ...delta, stats }));
        if (fit && fit.reason === undefined) {
          const res = await writeDelta(db, user, state, {
            text: delta.text, stats, lastAt: delta.lastAt, fresh: fit.fresh, copies: delta.copies, started, log: { via: 'cookie' },
            clear: [db.prepare('DELETE FROM refresh_staging WHERE user_id = ?1').bind(user.id)],
          });
          // Une autre synchro est passée entre-temps : relecture complète.
          if (!res.needs_full) quick = res;
        }
        ctx.phase = 'full';
      }
    }
    for (let p = page; !quick && p < page + budget; p++) {
      if (p > MAX_PAGE) throw new HttpError(502, 'WikiMasters renvoie trop de pages : rafraîchissement arrêté.');
      const data = await gameGet(`/api/my-collection?sort=rarity&page=${p}&stats=0`);
      const list = data && Array.isArray(data.collection) ? data.collection : null;
      if (!list) throw new HttpError(502, 'Réponse inattendue de WikiMasters (pas de champ « collection »).');
      const cards = [];
      let skipped = 0;
      list.forEach((entry) => {
        const card = entryToCard(entry);
        if (card) {
          cards.push(card);
        } else {
          skipped++;
          cards.push(badCard(entry, true));
        }
      });
      staged.push([p, JSON.stringify(cards), skipped]);
      next = p + 1;
      if (list.length < PAGE_SIZE) {
        done = true;
        break;
      }
    }
    // Lecture en plusieurs appels : compteurs du jeu relus à la fin ; s'ils ont changé, la collection a bougé pendant la
    // lecture, qui ne retirera aucune carte (finalizeImport). Échec de cette relecture : la lecture finit sans (les pages
    // lues ne sont pas perdues ; une session expirée est quand même notée).
    if (done && page > 0) {
      try {
        statsEnd = pickStats(await gameGet('/api/my-collection/stats?sort=rarity'));
      } catch {
        statsEnd = null;
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
  if (quick) return { done: true, ...quick };
  const now = nowIso();
  await db.batch(staged.map(([p, text, skipped]) => db.prepare(STAGE).bind(user.id, p, text, skipped, now)));

  if (!done) {
    // fetched = entrées lues, valides ou non (les marques des invalides sont gardées avec les cartes).
    const progress = await db.prepare(
      `SELECT SUM(CASE WHEN page >= 0 THEN json_array_length(entries) END) AS fetched,
              SUM(CASE WHEN page >= 0 THEN skipped END) AS skipped,
              MAX(CASE WHEN page < 0 THEN json_extract(entries, '$.total') END) AS total
       FROM refresh_staging WHERE user_id = ?1`,
    )
      .bind(user.id)
      .first();
    return {
      done: false,
      next_page: next,
      run, // à renvoyer avec la page suivante
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
  const head = info?.stats ? JSON.parse(info.stats) : null;
  const result = await finalizeImport(db, user, {
    source: REFRESH_SOURCE,
    key: 0,
    stats: head,
    statsEnd,
    started: head ? startedAt(head.started) : null,
    clear: [db.prepare('DELETE FROM refresh_staging WHERE user_id = ?1').bind(user.id)],
    skipped: info?.skipped ?? 0,
    log: { via: 'cookie' },
  });
  return { done: true, ...result };
}
