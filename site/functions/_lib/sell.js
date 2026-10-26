// Mise en vente d'une carte dans le jeu, et annulation d'une vente, au clic du membre, avec la session du joueur gardée
// par le serveur (game.js) et les routes du marché du site du jeu (relevées dans le HAR du 2026-10-23) :
// - GET /api/market/sell?id=<card_id> : tes exemplaires de la carte dans le jeu (par rareté d'exemplaire et brillance) et
//   tes enchères actives (GET /api/marketplace/mine du jeu : {sellingCount, maxConcurrentAuctions}).
// - POST /api/market/sell : POST /api/marketplace du jeu {card_id: <id de l'exemplaire>, base_amount, duration_minutes}
//   → 201 {auction_id}. Le jeu peut demander une vérification anti-robot (human_verification_required) : la vente se fait
//   alors dans le jeu.
// - POST /api/market/cancel : DELETE /api/marketplace/<id> du jeu → {status: "cancelled"}, seulement tant que personne n'a
//   misé (le classeur relit l'enchère juste avant : vendeur, état, meneur).
// Chaque appel au site compte dans le plafond par minute des routes du marché (cardmarket.js, `site`) et respecte la pause
// de 10 min posée quand le jeu limite. Une seule tentative : jamais de nouvel essai d'une écriture.

import { HttpError } from './http.js';
import { supaGet } from './game.js';
import { block, siteSession, spend } from './cardmarket.js';
import { patchLiveSales } from './market.js';
import { GAME_ORIGIN, gameFetch, pickCopy } from './trades.js';

const CARD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const AUCTION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RANKS = ['C', 'PC', 'R', 'SR', 'UR', 'L'];
const VARIANT = /^(C|PC|R|SR|UR|L)\*?$/;
export const DURATIONS = [10, 30, 60, 180, 360, 720]; // minutes : les durées du formulaire du jeu
export const BASE_MAX = 10_000_000;
const LIMITED = 'Le jeu limite les actions automatiques sur son marché : routes du marché en pause pour 10 minutes. Fais-le dans le jeu, ou réessaie plus tard.';
const UNSURE = "Le jeu n'a pas répondu à la mise en vente : regarde dans le jeu (Marché, « Mes ventes ») si elle a été créée avant de réessayer.";
const VERIFY = 'Le jeu demande de vérifier que tu es bien humain avant cette mise en vente : lance-la dans le jeu (la vérification ne se fait que là-bas).';

const kOf = (row) => (RANKS.includes(row.snapshot_rarity) ? row.snapshot_rarity : row.card && RANKS.includes(row.card.rarity) ? row.card.rarity : null)
  + (row.is_shiny ? '*' : '');

// Tes exemplaires de la carte dans le jeu → lignes {id, k, count, starred, is_shiny, obtained_at}.
async function copiesOf(env, user, s, id) {
  const { rows } = await supaGet(env, user, s,
    `user_cards?select=id,card_id,count,starred,is_shiny,obtained_at,snapshot_rarity,card:cards(rarity)&user_id=eq.${encodeURIComponent(s.uid)}`
    + `&card_id=eq.${encodeURIComponent(id)}&limit=1000`);
  return rows.filter((r) => r && typeof r.id === 'string' && r.card_id === id).map((r) => ({ ...r, k: kOf(r) })).filter((r) => VARIANT.test(r.k));
}

// Réponse du site du jeu à une écriture ou une lecture du marché : limite (pause de 10 min), session refusée.
export async function guard(db, user, res, data, what) {
  if (res.status === 429 || (data && data.code === 'automation_limit')) {
    await block(db, user.id);
    throw new HttpError(429, LIMITED, { limited: true, retry_after: 600 });
  }
  if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
    throw new HttpError(502, `Le jeu a refusé ta session (${res.status}) : ${what} dans le jeu.`);
  }
}
export const said = (data) => (data && typeof (data.error || data.message) === 'string' ? String(data.error || data.message).slice(0, 300) : '');

export function needUid(s) {
  if (!s.uid) throw new HttpError(401, 'Relie à nouveau ton compte du jeu (onglet « Synchro ») : il manque ton identifiant de joueur.', { needs_link: true });
}

// GET /api/market/sell?id=<card_id> → {card_id, copies:[{k, n, fav}], selling, max}. copies : tes exemplaires par rareté
// d'exemplaire et brillance (n exemplaires, fav : dont favoris dans le jeu), lus dans la base du jeu ; selling / max : tes
// enchères actives et leur plafond (5, 10 en Pro), lus sur le site du jeu (null s'il ne les donne pas).
export async function sellInfo(env, user, _body, request) {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!CARD_ID.test(id)) throw new HttpError(400, 'Carte : identifiant de carte du jeu mal formé (« id »).');
  const s = await siteSession(env, user, 'site');
  needUid(s);
  const by = new Map();
  for (const r of await copiesOf(env, user, s, id)) {
    const x = by.get(r.k) || { k: r.k, n: 0, fav: 0 };
    const n = Number.isInteger(r.count) && r.count > 0 ? r.count : 1;
    x.n += n;
    if (r.starred) x.fav += n;
    by.set(r.k, x);
  }
  let res;
  try {
    res = await gameFetch(env, user, s, '/api/marketplace/mine', { headers: { referer: GAME_ORIGIN + '/collection' } });
  } catch {
    res = null;
  }
  const data = res ? await res.json().catch(() => null) : null;
  if (res) await guard(env.DB, user, res, data, 'mets-la en vente');
  const int = (v) => (Number.isInteger(v) && v >= 0 && v <= 1000 ? v : null);
  const ok = res && res.ok && data;
  return {
    card_id: id,
    copies: [...by.values()].sort((a, b) => RANKS.indexOf(b.k.replace('*', '')) - RANKS.indexOf(a.k.replace('*', '')) || (a.k < b.k ? -1 : 1)),
    selling: ok ? int(data.sellingCount) : null,
    max: ok ? int(data.maxConcurrentAuctions) : null,
  };
}

// POST /api/market/sell {id, k, base, minutes} → {auction:{a, k, base, minutes, end}, url}. id = la carte, k = la rareté
// d'exemplaire (« R », « R* » brillante) à vendre ; l'exemplaire est choisi comme pour un échange (ni favori ni brillant
// si possible). base : mise de départ en W (entier, 1 au moins) ; minutes : une des durées du jeu.
export async function sellCard(env, user, body) {
  const db = env.DB;
  const id = typeof body.id === 'string' ? body.id : '';
  const k = typeof body.k === 'string' ? body.k : '';
  if (!CARD_ID.test(id)) throw new HttpError(400, 'Carte : identifiant de carte du jeu mal formé (« id »).');
  if (!VARIANT.test(k)) throw new HttpError(400, "Rareté de l'exemplaire inconnue (« k »).");
  if (!Number.isInteger(body.base) || body.base < 1 || body.base > BASE_MAX) throw new HttpError(400, 'Mise de départ : un nombre entier de W, 1 au moins.');
  if (!DURATIONS.includes(body.minutes)) throw new HttpError(400, `Durée : ${DURATIONS.join(', ')} minutes.`);
  const card = await db.prepare("SELECT json_extract(data, '$.title') AS title, json_extract(data, '$.image') AS image FROM cards WHERE user_id = ?1 AND card_id = ?2")
    .bind(user.id, id).first();
  const title = (card && card.title) || id;

  const s = await siteSession(env, user, 'site');
  needUid(s);
  const rows = (await copiesOf(env, user, s, id)).filter((r) => r.k === k);
  if (!rows.length) throw new HttpError(409, `Tu n'as plus d'exemplaire de « ${title} » dans cette rareté dans le jeu : rafraîchis ton classeur, puis recommence.`);
  const copy = pickCopy(rows);

  let res;
  try {
    res = await gameFetch(env, user, s, '/api/marketplace', {
      method: 'POST',
      headers: { 'content-type': 'application/json', referer: GAME_ORIGIN + '/collection' },
      body: JSON.stringify({ card_id: copy.id, base_amount: body.base, duration_minutes: body.minutes }),
    });
  } catch {
    throw new HttpError(502, UNSURE);
  }
  const data = await res.json().catch(() => null);
  if (data && data.code === 'human_verification_required') throw new HttpError(409, VERIFY, { verify: true });
  await guard(db, user, res, data, 'mets-la en vente');
  if (res.status >= 500) throw new HttpError(502, UNSURE);
  if (!res.ok) throw new HttpError(409, `Le jeu a refusé la mise en vente${said(data) ? ` : « ${said(data)} »` : ` (${res.status})`}.`);
  const a = data && typeof data.auction_id === 'string' && AUCTION_ID.test(data.auction_id) ? data.auction_id : null;
  if (!a) throw new HttpError(502, "Le jeu a accepté la mise en vente sans renvoyer l'enchère : regarde dans le jeu (Marché, « Mes ventes »).");
  const end = new Date(Date.now() + body.minutes * 60_000).toISOString();

  // Dans « Tes ventes » tout de suite (la carte n'est plus proposée « à vendre »), sans attendre la lecture suivante.
  const p = await db.prepare('SELECT data FROM prices WHERE card_id = ?1').bind(id).first();
  let q = null;
  try { q = p ? JSON.parse(p.data)[k] : null; } catch { q = null; }
  const r = k.replace('*', '');
  await patchLiveSales(db, user, (sales) => [{
    a, id, t: String(title).slice(0, 300), r, s: k.endsWith('*'), img: card && typeof card.image === 'string' && /^https:\/\//i.test(card.image) ? card.image : null,
    end, cote: q && Number.isFinite(q.p) ? q.p : null, n: q && Number.isInteger(q.n) ? q.n : null, base: body.base, cur: null, bid: false, st: 'run',
  }, ...sales.filter((x) => x && x.a !== a)]).catch((err) => console.error(err));
  return { auction: { a, k, base: body.base, minutes: body.minutes, end }, url: GAME_ORIGIN + '/marketplace/' + a };
}

// POST /api/market/cancel {a} → {a, status: "cancelled"}. Relit l'enchère sur le site du jeu (ta vente ? en cours ?
// quelqu'un a misé ?), puis l'annule. 409 {has_bid: true} dès qu'une mise existe : le jeu ne l'annule plus.
export async function cancelSale(env, user, body) {
  const db = env.DB;
  const a = typeof body.a === 'string' ? body.a : '';
  if (!AUCTION_ID.test(a)) throw new HttpError(400, 'Enchère : identifiant mal formé (« a »).');
  const s = await siteSession(env, user, 'site');
  needUid(s);
  const referer = GAME_ORIGIN + '/marketplace/' + a;
  let res;
  try {
    res = await gameFetch(env, user, s, `/api/marketplace/${encodeURIComponent(a)}`, { headers: { referer } });
  } catch {
    throw new HttpError(502, "Le site du jeu ne répond pas : vente pas annulée.");
  }
  let data = await res.json().catch(() => null);
  await guard(db, user, res, data, 'annule-la');
  if (res.status === 404) throw new HttpError(409, 'Le jeu ne connaît plus cette vente : elle est finie, ou déjà retirée.', { gone: true });
  if (!res.ok) throw new HttpError(502, `Le site du jeu a refusé la lecture de la vente (${res.status}) : vente pas annulée.`);
  const au = data && data.auction && typeof data.auction === 'object' ? data.auction : null;
  if (!au) throw new HttpError(502, "Réponse inattendue du site du jeu (détail d'une enchère) : le jeu a peut-être changé.");
  if (au.seller_id !== s.uid) throw new HttpError(403, "Ce n'est pas une de tes ventes.");
  const end = Date.parse(au.end_at || '');
  if (au.status !== 'active' || !(end > Date.now())) throw new HttpError(409, 'Cette vente est terminée : plus rien à annuler.', { gone: true });
  const bids = Array.isArray(data.bids) ? data.bids.filter((b) => b && typeof b === 'object') : [];
  if (au.current_bidder_id || bids.length) {
    throw new HttpError(409, "Quelqu'un a déjà misé sur cette vente : le jeu ne permet plus de l'annuler.", { has_bid: true });
  }

  await spend(db, user.id, 'site');
  try {
    res = await gameFetch(env, user, s, `/api/marketplace/${encodeURIComponent(a)}`, { method: 'DELETE', headers: { referer } });
  } catch {
    throw new HttpError(502, "Le jeu n'a pas répondu à l'annulation : regarde dans le jeu (Marché, « Mes ventes ») si elle est faite.");
  }
  data = await res.json().catch(() => null);
  await guard(db, user, res, data, 'annule-la');
  if (res.status >= 500) throw new HttpError(502, "Le jeu n'a pas répondu à l'annulation : regarde dans le jeu (Marché, « Mes ventes ») si elle est faite.");
  if (!res.ok) throw new HttpError(409, `Le jeu a refusé l'annulation${said(data) ? ` : « ${said(data)} »` : ` (${res.status})`}.`);
  await patchLiveSales(db, user, (sales) => sales.map((x) => (x && x.a === a ? { ...x, st: 'off' } : x))).catch((err) => console.error(err));
  return { a, status: data && typeof data.status === 'string' ? data.status.slice(0, 40) : 'cancelled' };
}
