// Liste de souhaits du jeu (2026-10-24, demande de l'utilisateur) : pour un membre qui l'a choisi (case « Liste de
// souhaits du jeu », users.auto_wish, coupée par défaut), le classeur met dans sa liste de souhaits du jeu les cartes qui
// manquent à ses collections, et en retire les cartes qu'il possède. Table wishlist_items du jeu ({user_id, card_id}),
// écrite comme le fait la page d'une carte du jeu (HAR du 2026-10-24) : POST rest/v1/wishlist_items {user_id, card_id}
// → 201, DELETE rest/v1/wishlist_items?user_id=eq.<uid>&card_id=eq.<id> → 204. La lecture de la liste (GET, même table)
// n'est pas dans le HAR : non vérifiée sur la vraie base.
//
// Une passe (wishPass), sous le bail du membre (sync_lock) : lit sa liste de souhaits, en retire les cartes possédées,
// trouve les cartes du jeu des titres qui manquent aux collections (cache commun game_titles, puis cards du jeu par
// titre), ajoute celles qui n'y sont pas encore. Lancée :
// - par le cron de la collection (cron.js), quand elle est due (wishDue : collections changées, cartes changées, reste à
//   faire, ou plus de 6 h) ;
// - juste après un enregistrement de collection, un « Rafraîchir » ou la case cochée (wishSoon, après la réponse) ;
// - au clic sur « Mettre à jour ma liste de souhaits » (POST /api/wishlist/sync).
// Jamais une carte retirée parce qu'elle a quitté une collection : seulement parce qu'elle est possédée.
//
// Case décochée, le clic fait une passe de retrait (clear, 2026-10-24, demande de l'utilisateur) : toutes les cartes de
// ses collections (possédées ou non) sortent de sa liste de souhaits ; les autres cartes de la liste restent.

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

// Les collections ont changé : la prochaine passe est due (seulement pour un membre qui a coché la case).
export const markWish = (db, userId) => db.prepare('UPDATE users SET wish_dirty = 1 WHERE id = ?1 AND auto_wish = 1').bind(userId).run();

const CACHED = `SELECT j.value AS t, g.card_id AS id, g.at FROM json_each(?1) AS j JOIN game_titles AS g ON g.title = j.value`;
const OWNED = `SELECT j.value AS id FROM json_each(?2) AS j
  WHERE EXISTS (SELECT 1 FROM cards AS c WHERE c.user_id = ?1 AND c.card_id = j.value)`;
const REMEMBER = `INSERT INTO game_titles (title, card_id, at) SELECT json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), ?2
  FROM json_each(?1) AS j WHERE true
  ON CONFLICT (title) DO UPDATE SET card_id = excluded.card_id, at = excluded.at`;
// Tous les titres de ses collections (passe de retrait), quel que soit leur état ou leur possession.
const ALL_TITLES = `SELECT DISTINCT json_extract(i.value, '$.title') AS t
  FROM targets AS t0, json_each(t0.items) AS i
  WHERE t0.user_id = ?1 AND i.type = 'object' AND json_type(i.value, '$.title') = 'text'
    AND length(json_extract(i.value, '$.title')) BETWEEN 1 AND 300
  LIMIT ${WANTED_MAX}`;
// Ses cartes dont le titre est dans ?2 (une carte possédée peut être d'une autre langue que celle trouvée par titre).
const OWNED_TITLED = `SELECT c.card_id AS id FROM cards AS c
  WHERE c.user_id = ?1 AND json_extract(c.data, '$.title') IN (SELECT value FROM json_each(?2))`;
const CARD_ID = /^[A-Za-z0-9_-]{1,100}$/;

// Une passe pour `user` (ligne de USER_COLUMNS), session `s` ouverte, sous son bail (pris par l'appelant). max : requêtes
// au jeu au plus ; clear : passe de retrait (cartes des collections retirées, rien d'ajouté). → l'état rangé
// (users.wish_state) : {at, via, clear?, rev, size, added, removed, left, none, error?}. Une limite du jeu remonte
// (429 limited) après avoir noté l'état ; les autres erreurs aussi (l'état dit pourquoi).
export async function wishPass(env, user, s, { via, max = PASS_MAX, gap = SUPA_GAP_MS, clear = false } = {}) {
  const db = env.DB;
  const uid = s.uid || user.game_uid;
  if (!uid) throw new HttpError(401, 'Relie à nouveau ton compte du jeu (onglet « Synchro ») : il manque ton identifiant de joueur.', { needs_link: true });
  const who = encodeURIComponent(uid);
  // Ce que la passe a vu des cartes : une lecture finie pendant la passe la rendra due à nouveau.
  const head = await db.prepare('UPDATE users SET wish_dirty = 0 WHERE id = ?1 RETURNING cards_rev').bind(user.id).first();
  const out = { at: nowIso(), via, ...(clear ? { clear: true } : {}), rev: head ? head.cards_rev : user.cards_rev, size: null, added: 0, removed: 0, left: 0, none: 0 };
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
    // 2. Les cartes possédées en sortent (passe normale).
    if (!clear) await drop(wish.size ? (await db.prepare(OWNED).bind(user.id, JSON.stringify([...wish])).all()).results.map((r) => r.id) : []);
    // 3. Titres qui manquent aux collections (retrait : tous leurs titres, rien à chercher si la liste est vide) → cartes
    // du jeu (cache commun, puis recherche par titre).
    const titles = clear && !wish.size ? [] : (await db.prepare(clear ? ALL_TITLES : wantedSql(WANTED_MAX)).bind(user.id).all()).results.map((r) => r.t);
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
    out.none = titles.filter((t) => ids.get(t) === '').length;
    const found = [...new Set(titles.map((t) => ids.get(t)).filter((id) => id))];
    if (clear) {
      // 4'. Retrait : les cartes trouvées et ses cartes de ces titres, si elles sont dans la liste.
      const mine = titles.length ? (await db.prepare(OWNED_TITLED).bind(user.id, JSON.stringify(titles)).all()).results.map((r) => String(r.id)) : [];
      out.left = (await drop([...new Set([...found, ...mine])].filter((id) => wish.has(id)))) + unresolved;
    } else {
      // 4. Celles qui ne sont ni possédées (sous un autre titre) ni déjà souhaitées entrent dans la liste.
      const have = found.length ? new Set((await db.prepare(OWNED).bind(user.id, JSON.stringify(found)).all()).results.map((r) => r.id)) : new Set();
      const add = found.filter((id) => !have.has(id) && !wish.has(id));
      let done = 0;
      for (const part of lots(add, ADD_LOT)) {
        if (!room()) break;
        await supaWrite(env, user, s, 'POST', 'wishlist_items', part.map((id) => ({ user_id: uid, card_id: id })), { gap: wait() });
        for (const id of part) wish.add(id);
        done += part.length;
        out.added += part.length;
      }
      out.left = add.length - done + unresolved;
    }
    out.size = wish.size;
  } catch (err) {
    out.error = err && err.message ? String(err.message).slice(0, 300) : 'Échec de la mise à jour de la liste de souhaits.';
    await saveState(db, user.id, out);
    throw err;
  }
  await saveState(db, user.id, out);
  return out;
}

const saveState = (db, userId, st) => db.prepare('UPDATE users SET wish_state = ?2 WHERE id = ?1').bind(userId, JSON.stringify(st)).run()
  .catch((err) => console.error(err));

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

// POST /api/wishlist/sync {} → l'état de la passe (voir wishPass). Au clic, même case décochée : c'est alors une passe de
// retrait (cartes des collections retirées de la liste) ; une fois par minute.
// 401 {needs_link}, 409 (une lecture tourne), 429 {retry_after} ou {limited}, 503 (interrupteur), 502.
export async function syncWishlist(env, user) {
  if (!WISH_ROUTE.known) throw new HttpError(503, "Le classeur ne sait plus écrire dans ta liste de souhaits du jeu : le jeu a peut-être changé.");
  if (!linkedOf(user)) throw new HttpError(401, "Relie d'abord ton compte du jeu (onglet « Synchro ») : la liste de souhaits est mise à jour avec ta session.", { needs_link: true });
  const st = wishState(user);
  const since = st ? Date.now() - Date.parse(st.at) : Infinity;
  if (since < SOON_GAP_MS) {
    throw new HttpError(429, 'Ta liste de souhaits vient d\'être mise à jour : réessaie dans une minute.', { retry_after: Math.ceil((SOON_GAP_MS - since) / 1000) });
  }
  const out = await underLease(env, user, { via: 'clic', max: CLICK_MAX, clear: !user.auto_wish });
  if (!out) throw new HttpError(409, 'Une lecture de ta collection ou du marché est en cours : réessaie dans un instant.');
  return { wish: out };
}
