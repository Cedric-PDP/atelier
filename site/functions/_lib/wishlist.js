// Liste de souhaits par collection : wish_sync sélectionne les albums.
// wish_managed mémorise les cartes prises en charge ; les retraits protègent les autres collections cochées.
// Une passe sous sync_lock lit le jeu, retire les cartes obtenues ou qui ne sont plus demandées,
// puis ajoute les manquantes. Déclencheurs : collections, Rafraîchir, cron et bouton manuel.

import { HttpError } from './http.js';
import { SUPA_GAP_MS, acquireLease, freshAuth, inList, lots, releaseLease, sessionOf, supaGet, supaWrite } from './game.js';
import { LEASE_MS } from './refresh.js';
import { wantedSql } from './market.js';
import { nowIso } from './util.js';
import { USER_COLUMNS } from './auth.js';

export const PASS_MAX = 30; // requêtes au jeu d'une passe du cron
export const SOON_MAX = 15; // d'une passe après un geste (après la réponse : ~15 s au plus)
export const CLICK_MAX = 20; // du bouton « Mettre à jour ma liste de souhaits »
export const ADD_LOT = 100; // cartes par ajout (un POST d'une liste)
export const DEL_LOT = 100; // cartes par retrait (un DELETE … card_id=in.(…))
export const WANTED_MAX = 5000; // titres manquants regardés par passe (collections changées le plus récemment d'abord)
export const WISH_PAGES = 10; // pages de 1 000 de la liste de souhaits lues au plus
export const EVERY_MS = 6 * 3600_000; // passe au moins toutes les 6 h (cartes ajoutées ou retirées dans le jeu)
export const SOON_GAP_MS = 60_000; // pas deux passes en moins d'une minute (sauf le cron)
export const RETRY_ERROR_MS = 3600_000; // après un échec, une heure avant la passe suivante du cron (sauf changement)
export const NOT_FOUND_MS = 7 * 24 * 3600_000; // un titre sans carte du jeu est recherché à nouveau après 7 jours
const RESOLVE_LOT = 80; // titres par recherche de cartes du jeu

// Interrupteur : `known` à false, plus aucune passe (clic : 503), si le jeu change sa table.
export const WISH_ROUTE = { known: true };

export function wishState(user) {
  try {
    const v = JSON.parse(user.wish_state || 'null');
    return v && typeof v === 'object' && typeof v.at === 'string' ? v : null;
  } catch {
    return null;
  }
}

const linkedOf = (user) => !!user.game_session_enc && !user.game_session_lost;

// La passe du cron est-elle due ? Case cochée, compte relié, et : jamais faite, collections changées (wish_dirty), cartes
// changées depuis (cards_rev), reste à faire, ou dernière il y a plus de 6 h. Après un échec, une heure d'attente, sauf
// changement.
export function wishDue(user, now = Date.now()) {
  if (!user.auto_wish || !linkedOf(user) || !WISH_ROUTE.known) return false;
  const st = wishState(user);
  if (!st || user.wish_dirty || st.rev !== user.cards_rev) return true;
  const age = now - Date.parse(st.at);
  if (st.error) return age >= RETRY_ERROR_MS;
  return st.left > 0 || age >= EVERY_MS;
}

const CACHED = `SELECT j.value AS t, g.card_id AS id, g.at FROM json_each(?1) AS j JOIN game_titles AS g ON g.title = j.value`;
const OWNED = `SELECT j.value AS id FROM json_each(?2) AS j
  WHERE EXISTS (SELECT 1 FROM cards AS c WHERE c.user_id = ?1 AND c.card_id = j.value)`;
const REMEMBER = `INSERT INTO game_titles (title, card_id, at) SELECT json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), ?2
  FROM json_each(?1) AS j WHERE true
  ON CONFLICT (title) DO UPDATE SET card_id = excluded.card_id, at = excluded.at`;
const CARD_ID = /^[A-Za-z0-9_-]{1,100}$/;

// Tous les titres cochés, sans la limite de recherche par passe : une carte commune doit rester souhaitée.
const SELECTED = `SELECT DISTINCT json_extract(i.value, '$.title') AS title
  FROM targets AS t, json_each(t.items) AS i WHERE t.user_id = ?1
    AND (t.wish_sync = 1 OR EXISTS (SELECT 1 FROM users WHERE id = ?1 AND wish_mode = 'all'))
    AND i.type = 'object' AND coalesce(json_extract(i.value, '$.status'), 'ok') = 'ok'`;
const DROP_MANAGED = `WITH selected AS (${SELECTED})
  SELECT m.card_id AS id FROM wish_managed AS m WHERE m.user_id = ?1 AND (
    EXISTS (SELECT 1 FROM cards AS c WHERE c.user_id = ?1 AND c.card_id = m.card_id)
    OR NOT EXISTS (SELECT 1 FROM selected AS s LEFT JOIN game_titles AS g ON g.title = s.title
      WHERE s.title = m.title OR g.card_id = m.card_id))`;
const TRACK = `INSERT INTO wish_managed (user_id, card_id, title)
  SELECT ?1, json_extract(value, '$[1]'), json_extract(value, '$[0]') FROM json_each(?2) WHERE true
  ON CONFLICT (user_id, card_id) DO UPDATE SET title = excluded.title`;

// Une passe pour `user` (ligne de USER_COLUMNS), session `s` ouverte, sous son bail (pris par l'appelant). max : requêtes
// au jeu au plus. → l'état rangé
// (users.wish_state) : {at, via, rev, size, added, removed, left, none, error?}. Une limite du jeu remonte
// (429 limited) après avoir noté l'état ; les autres erreurs aussi (l'état dit pourquoi).
export async function wishPass(env, user, s, { via, max = PASS_MAX, gap = SUPA_GAP_MS } = {}) {
  const db = env.DB;
  const uid = s.uid || user.game_uid;
  if (!uid) throw new HttpError(401, 'Relie à nouveau ton compte du jeu (onglet « Synchro ») : il manque ton identifiant de joueur.', { needs_link: true });
  const who = encodeURIComponent(uid);
  // Ce que la passe a vu des cartes : une lecture finie pendant la passe la rendra due à nouveau.
  const head = await db.prepare('UPDATE users SET wish_dirty = 0 WHERE id = ?1 RETURNING cards_rev').bind(user.id).first();
  const out = { at: nowIso(), via, rev: head ? head.cards_rev : user.cards_rev, size: null, added: 0, removed: 0, left: 0, none: 0 };
  let missing = null;
  let n = 0;
  const room = () => n < max;
  const wait = () => (n++ ? gap : 0);
  try {
    await freshAuth(env, user, s);
    // 1. La liste de souhaits du joueur.
    const wish = new Set();
    for (let page = 0; page < WISH_PAGES && room(); page++) {
      const { rows } = await supaGet(env, user, s, `wishlist_items?select=card_id&user_id=eq.${who}&order=card_id&limit=1000&offset=${page * 1000}`, { gap: wait() });
      for (const r of rows) if (r && CARD_ID.test(String(r.card_id))) wish.add(String(r.card_id));
      if (rows.length < 1000) break;
      if (page === WISH_PAGES - 1) throw new HttpError(400, `Liste de souhaits trop grande : ${WISH_PAGES * 1000} cartes au plus.`);
    }
    const drop = async (gone) => {
      let done = 0;
      for (const part of lots(gone, DEL_LOT)) {
        if (!room()) break;
        await supaWrite(env, user, s, 'DELETE', `wishlist_items?user_id=eq.${who}&card_id=in.${inList(part)}`, null, { gap: wait() });
        for (const id of part) wish.delete(id);
        done += part.length;
      }
      out.removed += done;
      return gone.length - done;
    };
    // 2. Cartes suivies obtenues ou qui ne sont plus demandées par aucune collection cochée.
    const gone = (await db.prepare(DROP_MANAGED).bind(user.id).all()).results.map((r) => r.id);
    // Même une carte retirée à la main du jeu peut être oubliée par le classeur.
    const absent = gone.filter((id) => !wish.has(id));
    if (absent.length) await db.prepare('DELETE FROM wish_managed WHERE user_id = ?1 AND card_id IN (SELECT value FROM json_each(?2))')
      .bind(user.id, JSON.stringify(absent)).run();
    const pendingDrop = await drop(gone.filter((id) => wish.has(id)));
    const removed = gone.filter((id) => !wish.has(id));
    if (removed.length) await db.prepare('DELETE FROM wish_managed WHERE user_id = ?1 AND card_id IN (SELECT value FROM json_each(?2))')
      .bind(user.id, JSON.stringify(removed)).run();
    // 3. Titres qui manquent aux collections cochées → cartes
    // du jeu (cache commun, puis recherche par titre).
    const titles = (await db.prepare(wantedSql(WANTED_MAX, true)).bind(user.id).all()).results.map((r) => r.t);
    const ids = new Map();
    const stale = new Date(Date.now() - NOT_FOUND_MS).toISOString();
    if (titles.length) {
      for (const r of (await db.prepare(CACHED).bind(JSON.stringify(titles)).all()).results) {
        if (r.id || r.at >= stale) ids.set(r.t, r.id);
      }
    }
    const unknown = titles.filter((t) => !ids.has(t));
    let unresolved = 0;
    for (const part of lots(unknown, RESOLVE_LOT)) {
      if (!room()) { unresolved += part.length; continue; }
      const { rows } = await supaGet(env, user, s, `cards?select=id,wikipedia_title,lang&wikipedia_title=in.${inList(part)}&order=id&limit=1000`, { gap: wait() });
      const found = {};
      for (const c of rows) {
        if (c && CARD_ID.test(String(c.id)) && (!found[c.wikipedia_title] || c.lang === 'fr')) found[c.wikipedia_title] = String(c.id);
      }
      const pairs = part.map((t) => [t, found[t] || '']);
      for (const [t, id] of pairs) ids.set(t, id);
      await db.prepare(REMEMBER).bind(JSON.stringify(pairs), nowIso()).run();
    }
    missing = titles.filter((t) => ids.get(t) === '');
    out.none = missing.length;
    out.missing_checked = true;
    const found = [...new Set(titles.map((t) => ids.get(t)).filter((id) => id))];
    {
      // 4. Celles qui ne sont ni possédées (sous un autre titre) ni déjà souhaitées entrent dans la liste.
      const have = found.length ? new Set((await db.prepare(OWNED).bind(user.id, JSON.stringify(found)).all()).results.map((r) => r.id)) : new Set();
      const add = found.filter((id) => !have.has(id) && !wish.has(id));
      // Mémorisé avant l'écriture : une erreur ou une désactivation pendant une passe ne perd pas les retraits à faire.
      const track = titles.filter((t) => ids.get(t) && !have.has(ids.get(t))).map((t) => [t, ids.get(t)]);
      if (track.length) await db.prepare(TRACK).bind(user.id, JSON.stringify(track)).run();
      let done = 0;
      for (const part of lots(add, ADD_LOT)) {
        if (!room()) break;
        await supaWrite(env, user, s, 'POST', 'wishlist_items', part.map((id) => ({ user_id: uid, card_id: id })), { gap: wait() });
        for (const id of part) wish.add(id);
        done += part.length;
        out.added += part.length;
      }
      out.left = pendingDrop + add.length - done + unresolved;
    }
    out.size = wish.size;
  } catch (err) {
    out.error = err && err.message ? String(err.message).slice(0, 300) : 'Échec de la mise à jour de la liste de souhaits.';
    await saveState(db, user.id, out, missing);
    throw err;
  }
  await saveState(db, user.id, out, missing);
  // Conserve une modification de collection arrivée pendant la passe (wish_dirty).
  await db.prepare(`UPDATE users SET auto_wish = (wish_mode = 'all' OR EXISTS (SELECT 1 FROM targets WHERE user_id = ?1 AND wish_sync = 1)
    OR EXISTS (SELECT 1 FROM wish_managed WHERE user_id = ?1)) WHERE id = ?1`).bind(user.id).run();
  return out;
}

async function saveState(db, userId, st, missing) {
  const statements = [];
  if (missing !== null) {
    statements.push(db.prepare('DELETE FROM wish_missing WHERE user_id = ?1').bind(userId));
    statements.push(db.prepare('INSERT INTO wish_missing (user_id, title) SELECT ?1, value FROM json_each(?2)').bind(userId, JSON.stringify(missing)));
  }
  statements.push(db.prepare('UPDATE users SET wish_state = ?2 WHERE id = ?1').bind(userId, JSON.stringify(st)));
  await db.batch(statements);
}

// Passe sous un bail pris ici. → l'état, ou null si le bail est déjà pris (une autre lecture tourne).
async function underLease(env, user, opts) {
  const db = env.DB;
  const lease = await acquireLease(db, user.id, LEASE_MS);
  if (!lease) return null;
  try {
    const s = await sessionOf(env, user);
    s.via = opts.via;
    return await wishPass(env, user, s, opts);
  } finally {
    await releaseLease(db, user.id, lease).run().catch((err) => console.error(err));
  }
}

// Après un geste du membre (collection enregistrée, « Rafraîchir », case cochée), en arrière-plan (waitUntil) : une
// passe courte si elle est due et si la dernière a plus d'une minute ; sinon le cron s'en charge (wish_dirty reste posé).
// Ne lève jamais.
export async function wishSoon(env, userId) {
  try {
    const user = await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?1`).bind(userId).first();
    if (!user || !wishDue(user)) return null;
    const st = wishState(user);
    if (st && Date.now() - Date.parse(st.at) < SOON_GAP_MS) return null;
    return await underLease(env, user, { via: 'auto', max: SOON_MAX });
  } catch (err) {
    console.error(`liste de souhaits : ${err && err.message ? err.message : err}`);
    return null;
  }
}

// POST /api/wishlist/sync {} : synchronise les collections choisies et termine les retraits ; une fois par minute.
// 401 {needs_link}, 409 (une lecture tourne), 429 {retry_after} ou {limited}, 503 (interrupteur), 502.
export async function syncWishlist(env, user) {
  if (!WISH_ROUTE.known) throw new HttpError(503, "Le classeur ne sait plus écrire dans ta liste de souhaits du jeu : le jeu a peut-être changé.");
  if (!linkedOf(user)) throw new HttpError(401, "Relie d'abord ton compte du jeu (onglet « Synchro ») : la liste de souhaits est mise à jour avec ta session.", { needs_link: true });
  const st = wishState(user);
  const since = st ? Date.now() - Date.parse(st.at) : Infinity;
  if (since < SOON_GAP_MS) {
    throw new HttpError(429, 'Ta liste de souhaits vient d\'être mise à jour : réessaie dans une minute.', { retry_after: Math.ceil((SOON_GAP_MS - since) / 1000) });
  }
  const out = await underLease(env, user, { via: 'clic', max: CLICK_MAX });
  if (!out) throw new HttpError(409, 'Une lecture de ta collection ou du marché est en cours : réessaie dans un instant.');
  return { wish: out };
}
