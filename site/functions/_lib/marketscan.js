// Lecture du marché entier, partagée par tout le classeur (2026-10-29, demande de l'utilisateur : plus de limite de 500
// cartes voulues) : toutes les enchères en cours du jeu (près de 160 000), avec la session d'UN seul compte, celui dont le
// pseudo du jeu est MARKET_SCAN_PSEUDO (sans elle, rien ne change : recherche ciblée par membre). Rangées dans
// auctions_live. Une lecture complète par jour, étalée sur plusieurs déclencheurs du marché (SCAN_PAGES pages de 10 000
// par déclencheur, curseur sur id : le serveur du jeu rend 10 000 lignes par requête, mesuré le 2026-10-29) ; entre deux,
// seulement les nouvelles enchères (created_at). Les passes de marché des membres y prennent leurs candidates (enchères
// sur les cartes qui manquent à leurs collections, sous leur cote), puis les relisent de façon ciblée.
// Rien du jeu sur les joueurs : le vendeur est rangé comme l'id du classeur du membre qui vend, '' pour tout autre joueur.

import { HttpError } from './http.js';
import { SUPA_GAP_MS, acquireLease, freshAuth, releaseLease, sessionOf, supaGet } from './game.js';
import { LEASE_MS } from './refresh.js';
import { USER_COLUMNS } from './auth.js';
import { WANTED_TITLES } from './market.js';
import { nowIso } from './util.js';

export const SCAN_PAGE = 10000;
export const SCAN_PAGES = 6; // pages par déclencheur (≈ 60 000 enchères, une vingtaine de secondes)
export const SCAN_NEW_PAGES = 3; // nouvelles enchères : pages par déclencheur
export const SCAN_FULL_MS = 24 * 3600_000; // une lecture complète par jour
// Au-delà, la lecture du marché entier est tenue pour arrêtée : les passes des membres reviennent à la recherche ciblée.
export const SCAN_FRESH_MS = 36 * 3600_000;
const SCAN_MARGIN_MS = 5 * 60_000; // nouvelles enchères relues avec cette marge (dates du jeu et horloge)
export const SCAN_CANDIDATES = 300; // cartes candidates relues par une passe de membre (3 requêtes)
const PART = 1000; // enchères par écriture (un paramètre JSON d'environ 300 Ko)
const FIELDS = 'id,card_id,seller_id,snapshot_rarity,current_bid,current_bidder_id,base_amount,end_at,is_shiny,created_at,'
  + 'card:cards(wikipedia_title,image_url,hide_image)';
const RANKS = ['C', 'PC', 'R', 'SR', 'UR', 'L'];
const AUCTION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CARD_ID = /^[A-Za-z0-9_-]{1,100}$/;

const https = (v) => (typeof v === 'string' && v.length <= 2000 && /^https:\/\//i.test(v) ? v : null);
const money = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && Number.isFinite(n) && n >= 0 && n <= 1e9 ? n : null;
};
const iso = (t) => encodeURIComponent(new Date(t).toISOString());
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// Pseudo du jeu du compte qui lit le marché entier, ou null (lecture du marché entier coupée).
export function scanPseudo(env) {
  const p = String(env.MARKET_SCAN_PSEUDO ?? '').trim();
  return p.length >= 1 && p.length <= 100 ? p : null;
}

// Enchère du jeu → ligne de auctions_live ([id, card_id, title, img, r, s, ask, bid, seller, end_at, created_at]), ou
// null si une valeur manque ou ne passerait pas les contrôles de la lecture du marché. sellers : game_uid → id du classeur.
export function liveRow(a, sellers) {
  const c = (a && a.card) || {};
  const end = typeof a.end_at === 'string' && a.end_at.length <= 40 ? Date.parse(a.end_at) : NaN;
  const created = typeof a.created_at === 'string' && a.created_at.length <= 40 ? Date.parse(a.created_at) : NaN;
  const title = c.wikipedia_title;
  if (RANKS.indexOf(a.snapshot_rarity) < 0 || !AUCTION_ID.test(String(a.id)) || !CARD_ID.test(String(a.card_id))
    || !Number.isFinite(end) || typeof title !== 'string' || title.length < 1 || title.length > 300) return null;
  const bid = !!a.current_bidder_id;
  const ask = money(bid ? a.current_bid : a.base_amount);
  if (ask === null) return null;
  return [String(a.id), String(a.card_id), title, c.hide_image ? null : https(c.image_url), a.snapshot_rarity, a.is_shiny ? 1 : 0,
    ask, bid ? 1 : 0, sellers.get(String(a.seller_id)) || '', new Date(end).toISOString(),
    Number.isFinite(created) ? new Date(created).toISOString() : null];
}

const UPSERT = `INSERT INTO auctions_live (id, card_id, title, img, r, s, ask, bid, seller, end_at, created_at, seen_at)
  SELECT json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), json_extract(j.value, '$[2]'), json_extract(j.value, '$[3]'),
    json_extract(j.value, '$[4]'), json_extract(j.value, '$[5]'), json_extract(j.value, '$[6]'), json_extract(j.value, '$[7]'),
    json_extract(j.value, '$[8]'), json_extract(j.value, '$[9]'), json_extract(j.value, '$[10]'), ?2
  FROM json_each(?1) AS j WHERE true
  ON CONFLICT (id) DO UPDATE SET card_id = excluded.card_id, title = excluded.title, img = excluded.img, r = excluded.r, s = excluded.s,
    ask = excluded.ask, bid = excluded.bid, seller = excluded.seller, end_at = excluded.end_at,
    created_at = coalesce(excluded.created_at, auctions_live.created_at), seen_at = excluded.seen_at`;

// Enchères lues → requêtes qui les rangent (par lots de PART).
function upserts(db, rows, sellers, seen) {
  const out = [];
  for (const a of rows) {
    const x = a && liveRow(a, sellers);
    if (x) out.push(x);
  }
  const stmts = [];
  for (let i = 0; i < out.length; i += PART) stmts.push(db.prepare(UPSERT).bind(JSON.stringify(out.slice(i, i + PART)), seen));
  return { stmts, n: out.length };
}

const STATE = "SELECT cursor, full_start, full_at, since FROM market_scan WHERE name = 'all'";

// Comptes du jeu reliés à un classeur : game_uid → id du classeur.
async function memberSellers(db) {
  const { results } = await db.prepare('SELECT id, game_uid FROM users WHERE game_uid IS NOT NULL').all();
  return new Map(results.map((r) => [String(r.game_uid), r.id]));
}

// La lecture du marché entier sert-elle aux passes des membres ? (dernière lecture complète de moins de SCAN_FRESH_MS)
export async function scanFresh(db, now = Date.now()) {
  const row = await db.prepare(STATE).first();
  const at = Date.parse((row && row.full_at) || '');
  return Number.isFinite(at) && now - at < SCAN_FRESH_MS;
}

// Un passage, depuis le déclencheur du marché (cron.js) → texte pour cron_state, ou null si elle est coupée. Une limite du
// jeu (429) remonte (le déclencheur s'arrête et saute le suivant) ; toute autre erreur est notée et rendue en texte.
export async function scanPass(env, { now = Date.now() } = {}) {
  const pseudo = scanPseudo(env);
  if (!pseudo) return null;
  const db = env.DB;
  await db.prepare("INSERT OR IGNORE INTO market_scan (name) VALUES ('all')").run();
  const note = async (text) => {
    await db.prepare("UPDATE market_scan SET last_at = ?1, last_result = ?2 WHERE name = 'all'").bind(nowIso(), text).run();
    return text;
  };
  const user = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE lower(game_pseudo) = lower(?1)
    AND game_session_enc IS NOT NULL AND game_session_lost IS NULL`).bind(pseudo).first();
  if (!user) return note(`marché entier : aucun classeur relié au compte du jeu « ${pseudo} »`);
  const lease = await acquireLease(db, user.id, LEASE_MS);
  if (!lease) return note('marché entier : session du compte occupée, reprise au prochain passage');
  try {
    const s = await sessionOf(env, user);
    s.via = 'cron';
    await freshAuth(env, user, s);
    const st = (await db.prepare(STATE).first()) || {};
    const sellers = await memberSellers(db);
    const size = Number(env.MARKET_SCAN_PAGE) || SCAN_PAGE; // plus petit dans les tests
    let n = 0;
    const get = async (path) => (await supaGet(env, user, s, path, { gap: n++ ? SUPA_GAP_MS : 0 })).rows;
    const seen = new Date(now).toISOString();
    let stored = 0;
    let text;
    const going = typeof st.cursor === 'string';
    if (going || !st.full_at || now - Date.parse(st.full_at) >= SCAN_FULL_MS) {
      // Lecture complète, reprise au curseur ; chaque page rangée avec son curseur (un arrêt ne perd que la page en cours).
      const start = going && st.full_start ? st.full_start : seen;
      let cursor = st.cursor || '';
      let done = false;
      for (let p = 0; p < SCAN_PAGES; p++) {
        const page = await get(`auctions?select=${FIELDS}&status=eq.active&end_at=gt.${iso(now)}`
          + `${cursor ? `&id=gt.${encodeURIComponent(cursor)}` : ''}&order=id&limit=${size}`);
        const { stmts, n: k } = upserts(db, page, sellers, seen);
        stored += k;
        if (page.length) cursor = String(page[page.length - 1].id);
        done = page.length < size;
        await db.batch([...stmts, db.prepare("UPDATE market_scan SET cursor = ?1, full_start = ?2 WHERE name = 'all'").bind(cursor, start)]);
        if (done) break;
      }
      if (done) {
        // Finie : les enchères absentes de cette lecture (vendues, annulées) sont effacées ; les nouvelles seront lues à
        // partir de son début.
        await db.batch([
          db.prepare('DELETE FROM auctions_live WHERE seen_at < ?1').bind(start),
          db.prepare("UPDATE market_scan SET cursor = NULL, full_start = NULL, full_at = ?1, since = ?1 WHERE name = 'all'").bind(start),
        ]);
      }
      text = `marché entier : ${plural(stored, 'enchère lue', 'enchères lues')}, lecture complète ${done ? 'finie' : 'en cours'}`;
    } else {
      // Nouvelles enchères depuis la plus récente vue (avec une marge), par ordre de création : pages par décalage (une
      // enchère créée entre deux pages vient à la fin) ; une enchère déjà rangée est simplement mise à jour. since ne
      // dépasse jamais ce qui a été lu : la passe suivante reprend là si les pages manquent.
      let since = st.since || st.full_at;
      const from = new Date(Date.parse(since) - SCAN_MARGIN_MS).toISOString();
      for (let p = 0; p < SCAN_NEW_PAGES; p++) {
        const page = await get(`auctions?select=${FIELDS}&status=eq.active&created_at=gte.${encodeURIComponent(from)}`
          + `&order=created_at,id&limit=${size}&offset=${p * size}`);
        const { stmts, n: k } = upserts(db, page, sellers, seen);
        stored += k;
        for (const a of page) {
          const t = Date.parse(a && a.created_at);
          if (Number.isFinite(t) && t > Date.parse(since)) since = new Date(t).toISOString();
        }
        await db.batch([...stmts, db.prepare("UPDATE market_scan SET since = ?1 WHERE name = 'all'").bind(since)]);
        if (page.length < size) break;
      }
      text = `marché entier : ${plural(stored, 'nouvelle enchère', 'nouvelles enchères')}`;
    }
    await db.prepare('DELETE FROM auctions_live WHERE end_at <= ?1').bind(seen).run();
    return note(text);
  } catch (err) {
    if (err && err.extra && err.extra.limited) {
      await note('marché entier : limite du jeu');
      throw err;
    }
    if (err instanceof HttpError) return note(`marché entier : ${String(err.message).slice(0, 200)}`);
    throw err;
  } finally {
    await releaseLease(db, user.id, lease).run().catch((err) => console.error(err));
  }
}

// Cartes candidates d'un membre : enchères rangées sur les cartes qui manquent à ses collections, pas les siennes, pas
// finies, au plus à la cote fiable (3 ventes) de leur rareté → [{card_id, title}], les meilleures remises d'abord.
const CANDIDATES = `WITH ${WANTED_TITLES},
  a AS (
    SELECT l.card_id, l.title, l.ask, json_extract(p.data, '$."' || l.r || CASE WHEN l.s THEN '*' ELSE '' END || '".p') AS cote,
      json_extract(p.data, '$."' || l.r || CASE WHEN l.s THEN '*' ELSE '' END || '".n') AS n
    FROM wt JOIN auctions_live AS l ON l.title = wt.t JOIN prices AS p ON p.card_id = l.card_id
    WHERE l.end_at > ?2 AND l.seller <> ?1
  )
  SELECT card_id, MIN(title) AS title, MIN(ask / cote) AS ratio FROM a WHERE n >= 3 AND cote > 0 AND ask <= cote
  GROUP BY card_id ORDER BY ratio, card_id LIMIT ?3`;

export async function candidates(db, userId, now = Date.now(), limit = SCAN_CANDIDATES) {
  return (await db.prepare(CANDIDATES).bind(userId, new Date(now).toISOString(), limit).all()).results;
}

// Après la relecture ciblée des candidates d'un membre ([{card_id, title}], enchères en cours de ces cartes : `rows`) :
// rangées à jour, et celles de ces cartes qui n'y sont plus (vendues, annulées) effacées (par l'index des titres).
const FORGET = `DELETE FROM auctions_live WHERE title IN (SELECT value FROM json_each(?1))
  AND card_id IN (SELECT value FROM json_each(?2)) AND id NOT IN (SELECT value FROM json_each(?3))`;

export async function syncCandidates(db, cands, rows) {
  if (!cands.length) return;
  const { stmts } = upserts(db, rows, await memberSellers(db), nowIso());
  const titles = JSON.stringify([...new Set(cands.map((c) => c.title))]);
  const ids = JSON.stringify(cands.map((c) => c.card_id));
  await db.batch([...stmts, db.prepare(FORGET).bind(titles, ids, JSON.stringify(rows.map((a) => String(a && a.id))))]);
}
