// Mise sur une enchère du jeu, au clic du membre, avec la session du joueur gardée par le serveur (game.js) et la route du
// marché du site du jeu relevée dans le HAR du 2026-10-26 : POST /api/marketplace/<id>/bid {amount} → 200 {auction_id,
// current_bid, bidder_balance}.
// - POST /api/market/bid {a, amount} : relit d'abord l'enchère (GET /api/marketplace/<id> : en cours ? ta vente ? tu
//   mènes ? mise minimale), puis mise. La mise minimale du jeu n'est connue que sans mise (effective_bid, sinon le prix de
//   départ) ; après une mise, le classeur demande au moins un W de plus que l'enchère actuelle, et le jeu peut demander
//   plus : son refus est montré tel quel.
// Deux appels au site, comptés dans le plafond par minute des routes du marché (cardmarket.js, `site`), avec la pause de
// 10 min posée quand le jeu limite. Une seule tentative : jamais de nouvel essai d'une écriture.

import { HttpError } from './http.js';
import { siteSession, spend } from './cardmarket.js';
import { patchLive } from './market.js';
import { BASE_MAX, guard, needUid, said } from './sell.js';
import { GAME_ORIGIN, gameFetch } from './trades.js';

const AUCTION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const UNSURE = "Le jeu n'a pas répondu à ta mise : regarde dans le jeu (Marché, « Mes enchères ») si elle est passée avant de réessayer.";
const VERIFY = 'Le jeu demande de vérifier que tu es bien humain avant cette mise : mise dans le jeu (la vérification ne se fait que là-bas).';

const money = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 && n <= 1e9 ? n : null;
};
// Mise minimale d'une enchère lue sur le site du jeu : sans mise, effective_bid (le prix de départ, peut-être révisé) ;
// après une mise, un W de plus que l'enchère actuelle.
export function minBid(au) {
  if (au.current_bidder_id) {
    const cur = money(au.current_bid);
    return cur === null ? null : Math.floor(cur) + 1;
  }
  const base = money(au.effective_bid) ?? money(au.base_amount);
  return base === null ? null : Math.max(1, Math.ceil(base));
}

// POST /api/market/bid {a, amount} → {a, amount, cur, balance, url}. a = l'enchère, amount = la mise en W (entier). 409
// {min, cur} si la mise ne suffit plus (quelqu'un a misé entre-temps) ; 409 {lead} si tu mènes déjà ; 409 {gone} si
// l'enchère est finie ; 403 sur ta propre vente.
export async function placeBid(env, user, body) {
  const db = env.DB;
  const a = typeof body.a === 'string' ? body.a : '';
  if (!AUCTION_ID.test(a)) throw new HttpError(400, 'Enchère : identifiant mal formé (« a »).');
  if (!Number.isInteger(body.amount) || body.amount < 1 || body.amount > BASE_MAX) throw new HttpError(400, 'Mise : un nombre entier de W, 1 au moins.');
  const amount = body.amount;
  const s = await siteSession(env, user, 'site');
  needUid(s);
  const referer = GAME_ORIGIN + '/marketplace/' + a;
  let res;
  try {
    res = await gameFetch(env, user, s, `/api/marketplace/${encodeURIComponent(a)}`, { headers: { referer } });
  } catch {
    throw new HttpError(502, "Le site du jeu ne répond pas : pas de mise.");
  }
  let data = await res.json().catch(() => null);
  await guard(db, user, res, data, 'mise dans le jeu');
  if (res.status === 404) throw new HttpError(409, 'Le jeu ne connaît plus cette enchère : elle est finie, ou retirée.', { gone: true });
  if (!res.ok) throw new HttpError(502, `Le site du jeu a refusé la lecture de l'enchère (${res.status}) : pas de mise.`);
  const au = data && data.auction && typeof data.auction === 'object' ? data.auction : null;
  if (!au) throw new HttpError(502, "Réponse inattendue du site du jeu (détail d'une enchère) : le jeu a peut-être changé.");
  if (au.seller_id === s.uid) throw new HttpError(403, "C'est une de tes ventes : tu ne peux pas miser dessus.");
  const end = Date.parse(au.end_at || '');
  if (au.status !== 'active' || !(end > Date.now())) throw new HttpError(409, 'Cette enchère est terminée.', { gone: true });
  const cur = au.current_bidder_id ? money(au.current_bid) : null;
  if (au.current_bidder_id && au.current_bidder_id === s.uid) {
    throw new HttpError(409, 'Tu mènes déjà cette enchère : inutile de surenchérir sur toi-même.', { lead: true, cur });
  }
  const min = minBid(au);
  if (min !== null && amount < min) {
    throw new HttpError(409, cur !== null ? `Quelqu'un a misé ${cur}W : il faut au moins ${min}W.` : `Il faut au moins ${min}W (prix de départ).`, { min, cur });
  }

  await spend(db, user.id, 'site');
  try {
    res = await gameFetch(env, user, s, `/api/marketplace/${encodeURIComponent(a)}/bid`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', referer },
      body: JSON.stringify({ amount }),
    });
  } catch {
    throw new HttpError(502, UNSURE);
  }
  data = await res.json().catch(() => null);
  if (data && data.code === 'human_verification_required') throw new HttpError(409, VERIFY, { verify: true });
  await guard(db, user, res, data, 'mise dans le jeu');
  if (res.status >= 500) throw new HttpError(502, UNSURE);
  if (!res.ok) throw new HttpError(409, `Le jeu a refusé ta mise${said(data) ? ` : « ${said(data)} »` : ` (${res.status})`}.`);
  const now = money(data && data.current_bid) ?? amount;
  const balance = data && Number.isInteger(data.bidder_balance) && data.bidder_balance >= 0 ? data.bidder_balance : null;

  // Solde et « Tes mises » / bonnes affaires tout de suite (tu mènes), sans attendre la lecture suivante.
  if (balance !== null) {
    await db.prepare('UPDATE users SET wikibidous = ?2, wikibidous_at = ?3 WHERE id = ?1').bind(user.id, balance, new Date().toISOString()).run()
      .catch((err) => console.error(err));
  }
  const card = au.card && typeof au.card === 'object' ? au.card : {};
  await patchLive(db, user, (lv) => {
    const deal = lv.deals.find((x) => x && x.a === a);
    const old = lv.bids.find((x) => x && x.a === a);
    const base = old || deal || null;
    const t = base ? base.t : typeof card.wikipedia_title === 'string' && card.wikipedia_title ? card.wikipedia_title.slice(0, 300) : null;
    const r = base ? base.r : au.snapshot_rarity;
    const mine = { a, id: base ? base.id : String(au.card_id), t, r, s: base ? base.s : !!au.is_shiny, img: base ? base.img : null,
      end: base ? base.end : new Date(end).toISOString(), cote: base ? base.cote : null, n: base ? base.n : null, mine: amount, cur: now, lead: true, st: 'run' };
    return {
      ...lv,
      deals: lv.deals.map((x) => (x && x.a === a ? { ...x, ask: now, bid: true, lead: true } : x)),
      bids: t ? [mine, ...lv.bids.filter((x) => x && x.a !== a)] : lv.bids,
    };
  }).catch((err) => console.error(err));
  return { a, amount, cur: now, balance, url: GAME_ORIGIN + '/marketplace/' + a };
}
