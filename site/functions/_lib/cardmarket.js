// Le marché d'une carte, lu à l'ouverture de sa fiche (au clic du membre, jamais sans lui), avec la session du jeu gardée
// par le serveur (game.js) :
// - GET /api/market/card?id=<card_id> (ou ?title=<titre>) : ses enchères en cours et ses ventes conclues, dans la base du
//   jeu (deux requêtes, trois avec la recherche du titre) ; sa cote, recalculée de ces ventes, rejoint le cache commun.
// - GET /api/market/auction?id=<id de l'enchère> : nombre de mises et d'enchérisseurs, meneur, vendeur et ta mise, lus
//   sur la route du site du jeu (/api/marketplace/<id>, la seule à les donner : auction_bids ne montre que tes mises).
//   Cette route limite les outils automatiques (automation_limit) : plafond par minute et par membre, et pause de 10 min
//   pour ce membre dès que le jeu limite.
// Rien de ce qui est lu ici n'est gardé, sauf la cote (des ventes, liées à aucun joueur) : ni vendeur, ni enchérisseur.

import { HttpError } from './http.js';
import { acquireLease, releaseLease, renewSession, sessionOf, supaGet } from './game.js';
import { cotes } from './marketread.js';
import { writePrices } from './market.js';
import { gameFetch } from './trades.js';
import { cleanText } from './util.js';

const CARD_ID = /^[A-Za-z0-9_-]{1,100}$/;
const AUCTION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RANKS = ['C', 'PC', 'R', 'SR', 'UR', 'L'];
const DAY = 86400_000;
const SALES_MAX = 1000; // ventes conclues rendues (les plus récentes), pour la courbe des prix
const AUCTIONS_MAX = 100;
// Lectures par minute et par membre : fiches (base du jeu, 2 ou 3 requêtes chacune) et détails d'enchère (site du jeu,
// limité à environ 30 par minute pour ses routes du marché).
export const PER_MINUTE = { card: 12, site: 20 };
export const LIMITED_MS = 10 * 60_000; // pause des détails d'enchère pour un membre que le jeu a limité
// Le site du jeu renouvelle lui-même une session qui expire bientôt (Set-Cookie) : il n'est appelé qu'avec un jeton valable
// encore 5 min, renouvelé avant sous bail sinon.
const SITE_MARGIN_MS = 5 * 60_000;
const LIMITED = 'Le jeu limite les lectures automatiques de son marché : détails des enchères en pause pour 10 minutes.';

const money = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 && n <= 1e9 ? n : null;
};
const stat = (v) => (Number.isInteger(v) && v >= 0 && v <= 1e6 ? v : null);
const pseudo = (v) => (typeof v === 'string' && v.length >= 1 && v.length <= 40 ? v : null);
// Nombre de mises s'il est une colonne de l'enchère (son nom n'est pas connu : `select=*` rend ce qui existe).
const bidCount = (a) => {
  for (const k of ['bid_count', 'bids_count', 'nb_bids', 'num_bids']) if (Number.isInteger(a[k]) && a[k] >= 0) return a[k];
  return null;
};

// Une lecture de plus pour ce membre (kind : card | site), dans sa minute. 429 au-delà du plafond, ou pendant une pause.
async function spend(db, userId, kind) {
  const now = Date.now();
  const win = new Date(now).toISOString().slice(0, 16);
  const row = await db.prepare(`INSERT INTO game_reads (user_id, kind, win, n) VALUES (?1, ?2, ?3, 1)
    ON CONFLICT (user_id, kind) DO UPDATE SET n = CASE WHEN game_reads.win = excluded.win THEN game_reads.n + 1 ELSE 1 END, win = excluded.win
    RETURNING n, blocked_until`).bind(userId, kind, win).first();
  const until = Date.parse((row && row.blocked_until) || '');
  if (until > now) {
    throw new HttpError(429, LIMITED, { limited: true, retry_after: Math.min(Math.ceil((until - now) / 1000), LIMITED_MS / 1000) });
  }
  if (row && row.n > PER_MINUTE[kind]) {
    const wait = Math.max(1, Math.ceil((Date.parse(win + ':00.000Z') + 60_000 - now) / 1000));
    throw new HttpError(429, kind === 'site' ? "Trop de détails d'enchères lus cette minute : patiente un instant." : 'Trop de fiches lues cette minute : patiente un instant.',
      { retry_after: Math.min(wait, 60) });
  }
}

const block = (db, userId) => db.prepare('UPDATE game_reads SET blocked_until = ?3 WHERE user_id = ?1 AND kind = ?2')
  .bind(userId, 'site', new Date(Date.now() + LIMITED_MS).toISOString()).run();

// Carte du jeu d'après son titre (la version française d'abord) ; null si aucune carte n'a ce titre.
async function cardByTitle(env, user, s, title) {
  const { rows } = await supaGet(env, user, s, `cards?select=id,wikipedia_title,lang&wikipedia_title=eq.${encodeURIComponent(title)}&order=id&limit=10`);
  let best = null;
  for (const c of rows) {
    if (!c || c.wikipedia_title !== title || !CARD_ID.test(String(c.id))) continue;
    if (!best || (c.lang === 'fr' && best.lang !== 'fr')) best = c;
  }
  return best ? String(best.id) : null;
}

// GET /api/market/card?id=<card_id> | ?title=<titre> →
// {card_id, at, auctions:[{a, r, s, ask, bid, cur, base, end, atk, def, lead, mine, n}], more, sales:[{d, p, k}], v}
// auctions : en cours, la fin la plus proche d'abord (ask = enchère actuelle, sinon prix de départ ; bid : quelqu'un a
// misé ; lead : tu mènes ; mine : ta vente ; n : nombre de mises, si la base le donne) ; sales : ventes conclues, les plus
// récentes d'abord (k = rareté de l'exemplaire, « * » brillante) ; v : cotes recalculées de ces ventes (90 jours), null si
// les ventes rendues ne couvrent pas les 90 jours. card_id null : aucune carte du jeu n'a ce titre.
export async function cardMarket(env, user, _body, request) {
  const params = new URL(request.url).searchParams;
  const rawId = params.get('id');
  const title = cleanText(params.get('title') ?? '');
  if (rawId !== null ? !CARD_ID.test(rawId) : title.length < 1 || title.length > 300) {
    throw new HttpError(400, 'Carte : un identifiant de carte du jeu (« id ») ou un titre de 1 à 300 caractères (« title »).');
  }
  const s = await sessionOf(env, user);
  s.via = 'clic';
  await spend(env.DB, user.id, 'card');
  const at = new Date().toISOString();
  const id = rawId !== null ? rawId : await cardByTitle(env, user, s, title);
  if (!id) return { card_id: null, at, auctions: [], more: false, sales: [], v: null };
  const uid = s.uid || user.game_uid || '';
  const now = Date.now();
  const { rows: running } = await supaGet(env, user, s, `auctions?select=*&status=eq.active&end_at=gt.${encodeURIComponent(new Date(now).toISOString())}`
    + `&card_id=eq.${encodeURIComponent(id)}&order=end_at&limit=${AUCTIONS_MAX + 1}`);
  const { rows: sold } = await supaGet(env, user, s, 'auctions?select=snapshot_rarity,final_price,settled_at,is_shiny&status=eq.settled_sold'
    + `&card_id=eq.${encodeURIComponent(id)}&order=settled_at.desc,id&limit=${SALES_MAX}`);

  const auctions = [];
  for (const a of running.slice(0, AUCTIONS_MAX)) {
    if (!a || !AUCTION_ID.test(String(a.id)) || RANKS.indexOf(a.snapshot_rarity) < 0) continue;
    const end = typeof a.end_at === 'string' ? Date.parse(a.end_at) : NaN;
    const bid = !!a.current_bidder_id;
    const ask = money(bid ? a.current_bid : a.base_amount);
    if (!Number.isFinite(end) || ask === null) continue;
    auctions.push({
      a: String(a.id),
      r: a.snapshot_rarity,
      s: !!a.is_shiny,
      ask,
      bid,
      cur: bid ? money(a.current_bid) : null,
      base: money(a.base_amount),
      end: new Date(end).toISOString(),
      atk: stat(a.snapshot_atk),
      def: stat(a.snapshot_def),
      lead: !!uid && bid && a.current_bidder_id === uid,
      mine: !!uid && a.seller_id === uid,
      n: bidCount(a),
    });
  }
  const sales = [];
  for (const x of sold) {
    const k = x && RANKS.indexOf(x.snapshot_rarity) >= 0 ? x.snapshot_rarity + (x.is_shiny ? '*' : '') : null;
    const p = money(x && x.final_price);
    const t = x && typeof x.settled_at === 'string' ? Date.parse(x.settled_at) : NaN;
    if (k && p !== null && Number.isFinite(t) && t <= now + 60_000) sales.push({ d: new Date(t).toISOString(), p, k });
  }
  // Cote : seulement si les ventes lues couvrent les 90 jours de la cote (sinon elle compterait mal ses ventes).
  const window = now - 90 * DAY;
  const covered = sold.length < SALES_MAX || (sales.length && Date.parse(sales[sales.length - 1].d) < window);
  let v = null;
  if (covered) {
    v = cotes(sold.filter((x) => x && Date.parse(x.settled_at) >= window));
    // Rangée dans le cache commun (une cote du quota du jour) ; quota atteint ou cote refusée : montrée quand même.
    await writePrices(env.DB, user, [{ id, v }]).catch(() => {});
  }
  return { card_id: id, at, auctions, more: running.length > AUCTIONS_MAX, sales, v };
}

// GET /api/market/auction?id=<id de l'enchère> → {a, gone, status, bids, bidders, leader, seller, leading, selling, my_bid,
// cur} : lu sur la route du site du jeu. gone : le jeu ne connaît plus cette enchère. Pseudos du meneur et du vendeur
// montrés, jamais gardés.
export async function auctionDetail(env, user, _body, request) {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!AUCTION_ID.test(id)) throw new HttpError(400, 'Enchère : identifiant mal formé (« id »).');
  const db = env.DB;
  let s = await sessionOf(env, user);
  s.via = 'clic';
  await spend(db, user.id, 'site');
  if ((Number(s.auth.expires_at) || 0) * 1000 - Date.now() < SITE_MARGIN_MS) {
    const lease = await acquireLease(db, user.id, 60_000);
    if (!lease) throw new HttpError(409, 'Une lecture de ton compte du jeu est en cours et ta session doit être renouvelée : réessaie dans un instant.');
    try {
      const now = await db.prepare('SELECT game_session_enc, game_session_v, game_session_lost, game_uid FROM users WHERE id = ?1').bind(user.id).first();
      s = await sessionOf(env, { ...user, ...now });
      s.via = 'clic';
      if ((Number(s.auth.expires_at) || 0) * 1000 - Date.now() < SITE_MARGIN_MS) await renewSession(env, user, s);
    } finally {
      await releaseLease(db, user.id, lease).run().catch((err) => console.error(err));
    }
  }
  let res;
  try {
    res = await gameFetch(env, user, s, `/api/marketplace/${encodeURIComponent(id)}`, { headers: { referer: 'https://www.wiki-masters.com/marketplace/' + id } });
  } catch {
    throw new HttpError(502, "Le site du jeu ne répond pas : détail de l'enchère indisponible.");
  }
  const data = await res.json().catch(() => null);
  if (res.status === 429 || (data && data.code === 'automation_limit')) {
    await block(db, user.id);
    throw new HttpError(429, LIMITED, { limited: true, retry_after: LIMITED_MS / 1000 });
  }
  if (res.status === 404) return { a: id, gone: true };
  if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
    throw new HttpError(502, `Le site du jeu a refusé ta session (${res.status}) : détail de l'enchère indisponible.`);
  }
  if (!res.ok) throw new HttpError(502, `Le site du jeu a refusé la lecture de l'enchère (${res.status}).`);
  const au = data && data.auction && typeof data.auction === 'object' ? data.auction : null;
  if (!au) throw new HttpError(502, "Réponse inattendue du site du jeu (détail d'une enchère) : le jeu a peut-être changé.");
  const uid = s.uid || user.game_uid || '';
  const bids = (Array.isArray(data.bids) ? data.bids : []).filter((b) => b && typeof b === 'object');
  const mine = bids.filter((b) => uid && b.bidder_id === uid).map((b) => money(b.amount)).filter((n) => n !== null);
  const leaderId = au.current_bidder_id || null;
  return {
    a: id,
    gone: false,
    status: typeof au.status === 'string' ? au.status.slice(0, 40) : null,
    bids: bids.length,
    bidders: new Set(bids.map((b) => b.bidder_id).filter(Boolean)).size,
    leader: leaderId ? pseudo(au.current_bidder && au.current_bidder.username) : null,
    seller: pseudo(au.seller && au.seller.username),
    leading: !!uid && !!leaderId && leaderId === uid,
    selling: !!uid && au.seller_id === uid,
    my_bid: mine.length ? Math.max(...mine) : null,
    cur: leaderId ? money(au.current_bid) : null,
  };
}
