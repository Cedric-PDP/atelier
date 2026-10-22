// Lecture du marché dans la base du jeu (Supabase : tables auctions, auction_bids et cards), avec la session du joueur
// gardée par le serveur (game.js) : au clic « Mettre à jour les cotes » (POST /api/market/refresh) et par les lectures
// automatiques (cron.js). Une passe : plan du classeur (cartes à coter, cartes qui manquent aux collections), enchères et
// ventes du joueur, titres -> cartes du jeu, enchères en cours sur les cartes voulues et leurs cotes ; la lecture du
// marché est alors rangée ; puis les cotes des cartes du plan (les plus anciennes d'abord) tant que le plafond le permet.
// Une requête par seconde au plus, SUPA_MAX par passe (la suivante reprend aux cotes les plus anciennes ; plus vite pour les
// membres qui ont coché « Synchro rapide du marché », voir FAST_*) ; les cotes lues
// sont gardées même si une erreur arrête tout, et l'échec noté avec sa raison (market.attempt). Cotes : médiane des 30
// ventes les plus récentes par rareté d'exemplaire et brillance, sur 90 jours ; fiable dès 3 ventes ; celle d'il y a
// 7 jours ; la dernière vente. Jamais l'identifiant du joueur dans le jeu dans ce qui est rangé.
// Aussi : GET /api/game/cards?q= (« Depuis le jeu » : recherche de cartes par titre).

import { HttpError } from './http.js';
import { RARITIES } from './cards.js';
import { SUPA_GAP_MS, acquireLease, freshAuth, inList, lots, releaseLease, sessionOf, supaGet } from './game.js';
import { LEASE_MS } from './refresh.js';
import { PART_PRICES, PLAN_CARDS, lastAttempt, planFor, writeFail, writeLive, writePrices } from './market.js';
import { cleanText } from './util.js';

export const SUPA_MAX = 30;
// Essai de rythme plus rapide (2026-10-22), seulement pour les membres qui l'ont choisi (users.fast_sync, case « Synchro
// rapide du marché », coupée par défaut) : eux seuls prennent le risque d'être vus ou limités par le jeu ; les autres
// gardent SUPA_GAP_MS et SUPA_MAX.
export const FAST_GAP_MS = 250;
export const FAST_MAX = 60;
const FAST_PLAN = PLAN_CARDS * 2;
export const CLICK_GAP_MS = 60_000;
const HOUR = 3600_000;
const DAY = 86400_000;
const RANKS = ['C', 'PC', 'R', 'SR', 'UR', 'L'];
const CARD = 'card:cards(wikipedia_title,image_url,hide_image)';
// Identifiant de carte accepté par le classeur (sinon toute la lecture serait refusée).
const CARD_ID = /^[A-Za-z0-9_-]{1,100}$/;
const LIVE_CHARS = 200_000;

const num = (n) => Number(n || 0).toLocaleString('fr-FR');
const iso = (t) => encodeURIComponent(new Date(t).toISOString());
const vkey = (r, shiny) => (RANKS.indexOf(r) >= 0 ? r + (shiny ? '*' : '') : null);
const median = (xs) => {
  const a = xs.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const px = (x) => x.p;
const https = (v) => (typeof v === 'string' && v.length <= 2000 && /^https:\/\//i.test(v) ? v : null);
const money = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && Number.isFinite(n) && n >= 0 && n <= 1e9 ? n : null;
};

// Ventes d'une carte -> {"R": {p, n, w, l, d}, "R*": …}.
export function cotes(rows) {
  const by = {};
  const out = {};
  const week = Date.now() - 7 * DAY;
  for (const x of rows) {
    const k = vkey(x.snapshot_rarity, x.is_shiny);
    const p = Number(x.final_price);
    const t = Date.parse(x.settled_at);
    if (k && Number.isFinite(p) && p >= 0 && p <= 1e9 && Number.isFinite(t)) (by[k] = by[k] || []).push({ p, t, d: x.settled_at });
  }
  for (const k of Object.keys(by)) {
    const s = by[k].sort((a, b) => b.t - a.t);
    const old = s.filter((x) => x.t < week).slice(0, 30);
    out[k] = { p: median(s.slice(0, 30).map(px)), n: s.length, w: old.length >= 3 ? median(old.map(px)) : null, l: s[0].p, d: s[0].d };
  }
  return out;
}

// Ce que la page montre d'une enchère : carte, rareté de l'exemplaire, image, fin (ISO), cote (fiable ou non). null si
// une valeur ne passerait pas les contrôles de writeLive (qui refuserait toute la lecture du marché).
function lot(a, fresh, title) {
  const r = a.snapshot_rarity;
  const c = a.card || {};
  const end = typeof a.end_at === 'string' && a.end_at.length <= 40 ? Date.parse(a.end_at) : NaN;
  if (RANKS.indexOf(r) < 0 || !/^[A-Za-z0-9_-]{1,64}$/.test(String(a.id)) || !CARD_ID.test(String(a.card_id)) || !Number.isFinite(end)) return null;
  const k = vkey(r, a.is_shiny);
  const q = fresh[a.card_id] && fresh[a.card_id][k];
  return {
    a: String(a.id),
    id: String(a.card_id),
    t: String(title || c.wikipedia_title || '?').slice(0, 300),
    r,
    s: !!a.is_shiny,
    img: c.hide_image ? null : https(c.image_url),
    end: new Date(end).toISOString(),
    cote: q ? q.p : null,
    n: q ? q.n : null,
  };
}

// La lecture du marché tient sous 200 000 caractères (writeLive en accepte 256 Ko) : sinon sans les images des enchères et
// ventes du joueur, puis sans les plus anciennes.
function fit(lv) {
  const big = () => JSON.stringify(lv).length > LIVE_CHARS;
  if (big()) for (const x of lv.bids.concat(lv.sales)) x.img = null;
  while (big() && lv.bids.length + lv.sales.length) (lv.bids.length >= lv.sales.length ? lv.bids : lv.sales).pop();
}

// Une passe (via : clic | cron ; auto : lecture automatique, sautée si une autre a commencé il y a moins de 5 min).
// → {ok: true, read, left, deals, running}, ou {skip: true, until}. Échec : noté (writeFail), puis relancé.
export async function marketPass(env, user, { via, auto = false } = {}) {
  const db = env.DB;
  const lease = await acquireLease(db, user.id, LEASE_MS);
  if (!lease) {
    throw new HttpError(409, 'Une lecture du marché ou de ta collection est déjà en cours (automatique, ou depuis un autre appareil) : réessaie dans un instant.');
  }
  try {
    let s;
    try {
      s = await sessionOf(env, user);
    } catch (err) {
      if (err && err.extra && err.extra.needs_link) await writeFail(db, user, { why: err.message, auto });
      throw err;
    }
    s.via = via;
    const plan = await planFor(db, user, { auto, cards: user.fast_sync ? FAST_PLAN : PLAN_CARDS });
    if (plan.skip) return { skip: true, until: plan.until };
    if (!(plan.quota > 0)) {
      const why = "Quota du jour des cotes atteint pour ton classeur (ou pour tout le site) : reprise demain. Rien n'a été lu.";
      await writeFail(db, user, { why, auto });
      throw new HttpError(429, why, { quota: 0 });
    }
    return await read(env, user, s, plan, auto);
  } finally {
    await releaseLease(db, user.id, lease).run().catch((err) => console.error(err));
  }
}

async function read(env, user, s, plan, auto) {
  const db = env.DB;
  const uid = s.uid || user.game_uid || '';
  const fast = !!user.fast_sync;
  const max = fast ? FAST_MAX : SUPA_MAX;
  let n = 0;
  const room = () => n < max;
  const supa = async (path) => {
    const gap = n ? (fast ? FAST_GAP_MS : SUPA_GAP_MS) : 0;
    n += 1;
    return (await supaGet(env, user, s, path, { gap })).rows;
  };
  // Cotes d'un lot de cartes : ventes des 90 derniers jours, pages de 1 000 dans un ordre stable. Plafond atteint au
  // milieu : seules les cartes lues en entier (toutes sauf la dernière vue) sont rendues. [{id, v}].
  const readCotes = async (ids) => {
    let rows = [];
    let done = false;
    for (let off = 0; room(); off += 1000) {
      const page = await supa(`auctions?select=card_id,snapshot_rarity,final_price,settled_at,is_shiny&status=eq.settled_sold&settled_at=gte.${iso(Date.now() - 90 * DAY)}`
        + `&card_id=in.${inList(ids)}&order=card_id,settled_at.desc,id&limit=1000&offset=${off}`);
      rows = rows.concat(page);
      if (page.length < 1000) {
        done = true;
        break;
      }
    }
    const by = {};
    for (const x of rows) (by[x.card_id] = by[x.card_id] || []).push(x);
    const last = rows.length ? rows[rows.length - 1].card_id : null;
    return ids.filter((id) => done || (by[id] && id !== last)).map((id) => ({ id, v: by[id] ? cotes(by[id]) : {} }));
  };

  const cards = Array.isArray(plan.cards) ? plan.cards : [];
  const ids = plan.ids && typeof plan.ids === 'object' ? { ...plan.ids } : {};
  const wanted = Array.isArray(plan.wanted) ? plan.wanted : [];
  const fresh = {};
  const sent = [];
  const found = {};
  const lv = { ids: {}, deals: [], bids: [], sales: [] };
  let fail = null;
  let told = false;
  const take = async (list) => {
    const parts = lots(list, 100);
    for (let i = 0; i < parts.length && room() && sent.length < plan.quota; i++) {
      for (const x of await readCotes(parts[i])) {
        if (!fresh[x.id] && sent.length < plan.quota && CARD_ID.test(x.id)) {
          fresh[x.id] = x.v;
          sent.push(x);
        }
      }
    }
  };
  try {
    await freshAuth(env, user, s);
    const now = Date.now();
    const mine = [];
    const who = encodeURIComponent(uid);
    const bids = uid ? await supa(`auction_bids?select=amount,placed_at,auction:auctions(id,card_id,status,end_at,current_bid,current_bidder_id,final_price,winner_id,snapshot_rarity,is_shiny,${CARD})`
      + `&bidder_id=eq.${who}&placed_at=gte.${iso(now - 14 * DAY)}&order=placed_at.desc&limit=200`) : [];
    const sales = uid ? await supa(`auctions?select=id,card_id,status,end_at,base_amount,current_bid,current_bidder_id,final_price,snapshot_rarity,is_shiny,${CARD}`
      + `&seller_id=eq.${who}&end_at=gte.${iso(now - 14 * DAY)}&order=end_at.desc&limit=100`) : [];
    const unknown = lots(wanted.filter((t) => typeof ids[t] !== 'string').slice(0, 320), 80);
    for (let i = 0; i < unknown.length && room(); i++) {
      for (const c of await supa(`cards?select=id,wikipedia_title,lang&wikipedia_title=in.${inList(unknown[i])}&order=id&limit=1000`)) {
        if (c && CARD_ID.test(String(c.id)) && (!found[c.wikipedia_title] || c.lang === 'fr')) found[c.wikipedia_title] = String(c.id);
      }
      for (const t of unknown[i]) {
        lv.ids[t] = found[t] || '';
        ids[t] = lv.ids[t];
      }
    }
    const titleOf = {};
    const want = lots(wanted.filter((t) => ids[t]).map((t) => {
      titleOf[ids[t]] = t;
      return ids[t];
    }).slice(0, 500), 100);
    let auctions = [];
    for (let k = 0; k < want.length && room(); k++) {
      auctions = auctions.concat(await supa(`auctions?select=id,card_id,seller_id,snapshot_rarity,current_bid,current_bidder_id,base_amount,end_at,is_shiny,${CARD}`
        + `&status=eq.active&end_at=gt.${iso(now)}&card_id=in.${inList(want[k])}&order=end_at&limit=1000`));
    }
    auctions = auctions.filter((a) => a && a.id && a.card_id && a.seller_id !== uid);
    for (const b of bids) {
      const a = b && b.auction;
      if (a && a.id && a.card_id) mine.push(a.card_id);
    }
    for (const a of sales) if (a && a.card_id && a.status === 'active') mine.push(a.card_id);
    await take(auctions.map((a) => String(a.card_id)).concat(mine.map(String)).filter((id, k, all) => all.indexOf(id) === k && !fresh[id]).slice(0, 300));
    // Bonnes affaires : la moins chère par carte (une collection n'en demande qu'un exemplaire, de n'importe quelle
    // rareté) ; more = les autres enchères intéressantes sur la même carte.
    const best = {};
    for (const a of auctions) {
      const x = lot(a, fresh, titleOf[a.card_id]);
      const bid = !!a.current_bidder_id;
      const ask = money(bid ? a.current_bid : a.base_amount);
      const base = money(a.base_amount);
      if (!x || x.cote === null || x.n < 3 || ask === null
        || !(ask <= 0.8 * x.cote || (!bid && Date.parse(x.end) - Date.now() < 2 * HOUR && base !== null && base <= x.cote))) continue;
      x.ask = ask;
      x.bid = bid;
      x.lead = !!uid && a.current_bidder_id === uid;
      x.more = 0;
      const o = best[x.id];
      if (!o) {
        lv.deals.push(x);
      } else if (ask < o.ask || (ask === o.ask && x.end < o.end)) {
        x.more = o.more + 1;
        lv.deals[lv.deals.indexOf(o)] = x;
      } else {
        o.more += 1;
        continue;
      }
      best[x.id] = x;
    }
    lv.deals = lv.deals.sort((a, b) => Date.parse(a.end) - Date.parse(b.end)).slice(0, 50);
    const seen = {};
    for (const b of bids) {
      const a = b && b.auction;
      const amount = money(b && b.amount);
      if (!a || !a.id || !a.card_id || amount === null) continue;
      if (seen[a.id]) {
        seen[a.id].mine = Math.max(seen[a.id].mine, amount);
        continue;
      }
      const x = lot(a, fresh);
      if (!x) continue;
      const run = a.status === 'active';
      x.mine = amount;
      x.cur = money(run ? a.current_bid : a.final_price);
      x.lead = run && a.current_bidder_id === uid;
      x.st = run ? 'run' : a.status === 'settled_sold' ? (a.winner_id === uid ? 'won' : 'lost') : 'off';
      seen[a.id] = x;
      lv.bids.push(x);
    }
    lv.bids = lv.bids.slice(0, 100);
    for (const a of sales.slice(0, 100)) {
      if (!a || !a.id || !a.card_id || money(a.base_amount) === null) continue;
      const x = lot(a, fresh);
      if (!x) continue;
      const st = String(a.status || '');
      x.base = money(a.base_amount);
      x.bid = !!a.current_bidder_id;
      x.cur = money(st === 'settled_sold' ? a.final_price : x.bid ? a.current_bid : null);
      x.st = st === 'active' ? 'run' : st === 'settled_sold' ? 'sold' : st.indexOf('settled') === 0 ? 'unsold' : 'off';
      lv.sales.push(x);
    }
    fit(lv);
    await writeLive(db, user, lv);
    told = true;
    await take(cards.filter((id) => !fresh[id]));
  } catch (err) {
    fail = err;
  }
  try {
    for (let p = 0; p * PART_PRICES < sent.length || p === 0; p++) {
      await writePrices(db, user, sent.slice(p * PART_PRICES, (p + 1) * PART_PRICES), (p + 1) * PART_PRICES >= sent.length);
    }
  } catch (err) {
    fail = fail || err;
  }
  if (fail) {
    const why = (fail.message || String(fail)) + (sent.length
      ? ` ${num(sent.length)} cotes lues avant l'arrêt ont été gardées${told ? ', avec les bonnes affaires et tes enchères.' : '.'}`
      : '');
    await writeFail(db, user, { why, auto });
    if (fail instanceof HttpError) throw new HttpError(fail.status, why, fail.extra);
    throw fail;
  }
  const planned = new Set(cards);
  return {
    ok: true,
    read: sent.length,
    left: Math.max(0, (Number(plan.stale) || 0) - sent.filter((x) => planned.has(x.id)).length),
    deals: lv.deals.length,
    running: lv.bids.filter((x) => x.st === 'run').length,
  };
}

// POST /api/market/refresh {} : « Mettre à jour les cotes ». Refusé (429) moins d'une minute après le début de la
// précédente passe, d'où qu'elle vienne.
export async function refreshMarket(env, user) {
  const prev = await lastAttempt(env.DB, user.id);
  const since = Date.parse(prev ? prev.start : '');
  const now = Date.now();
  if (since > now - CLICK_GAP_MS && since <= now + 60_000) {
    const wait = Math.max(1, Math.ceil((since + CLICK_GAP_MS - now) / 1000));
    throw new HttpError(429, "Cotes déjà lues il y a moins d'une minute : patiente un instant.", { retry_after: Math.min(wait, 60) });
  }
  return marketPass(env, user, { via: 'clic', auto: false });
}

// Motif ilike de PostgREST pour « contient q » : les jokers de LIKE (%, _) et l'échappement (\) de q pris à la lettre,
// « * » (joker de PostgREST) aussi ; encodé pour l'adresse, parenthèses et virgules comprises.
export function ilikeContains(q) {
  const escaped = q.replace(/[\\%_*]/g, (c) => '\\' + c);
  const enc = encodeURIComponent(escaped).replace(/[()*!']/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `*${enc}*`;
}

const SEARCH_MAX = 200;

// GET /api/game/cards?q= : cartes du jeu dont le titre contient q (1 à 100 caractères), dans l'ordre des titres, 200 au
// plus (more : il y en a d'autres) ; la version française d'un même titre l'emporte, une rareté inconnue est écartée.
// Une requête, avec la session du membre.
export async function searchCards(env, user, _body, request) {
  const raw = new URL(request.url).searchParams.get('q');
  const q = cleanText(raw ?? '');
  if (q.length < 1 || q.length > 100) throw new HttpError(400, 'Recherche : de 1 à 100 caractères (paramètre « q »).');
  const s = await sessionOf(env, user);
  s.via = 'clic';
  const { rows } = await supaGet(env, user, s, `cards?select=id,wikipedia_title,rarity,category,image_url,hide_image,lang&wikipedia_title=ilike.${ilikeContains(q)}`
    + `&order=wikipedia_title,id&limit=${SEARCH_MAX + 1}`);
  const byTitle = new Map();
  for (const c of rows) {
    if (!c || typeof c.wikipedia_title !== 'string' || !RARITIES.has(c.rarity) || c.id === null || c.id === undefined) continue;
    const had = byTitle.get(c.wikipedia_title);
    if (had && (had.lang === 'fr' || c.lang !== 'fr')) continue;
    byTitle.set(c.wikipedia_title, c);
  }
  const cards = [...byTitle.values()].slice(0, SEARCH_MAX).map((c) => ({
    card_id: String(c.id),
    title: c.wikipedia_title,
    rarity: c.rarity,
    category: typeof c.category === 'string' ? c.category : null,
    image: c.hide_image ? null : https(c.image_url),
  }));
  return { cards, more: rows.length > SEARCH_MAX };
}
