// Création d'un échange dans le jeu (POST /api/trades/create), avec la session du joueur gardée par le serveur (game.js).
// Une **proposition** d'échange (cartes et wikibidous, d'un côté ou de l'autre), en attente tant que l'ami ne l'a pas
// acceptée dans le jeu ; rien d'autre (ni acceptation, ni annulation). L'autre écriture du classeur dans le jeu : la mise en vente d'une carte (sell.js).
// Les cartes sont désignées par leur id de carte (card_id) ; le jeu veut aussi l'id d'un exemplaire (user_card_id) de
// chaque carte, lu juste avant dans sa base. La route du jeu (Next.js, www.wiki-masters.com/api/trades) n'accepte que le
// cookie de session de ses pages : il est refait à partir de la session gardée, jamais donné au navigateur.

import { HttpError } from './http.js';
import { AUTH_COOKIE, acquireLease, authFromCookie, inList, releaseLease, renewSession, sealSession, sessionOf, supaGet } from './game.js';
import { bytesToBase64, nowIso } from './util.js';

export const GAME_ORIGIN = 'https://www.wiki-masters.com';
export const MAX_ITEMS = 40; // cartes d'un échange, des deux côtés
export const MAX_WIKIBIDOUS = 100_000_000; // wikibidous d'un côté d'un échange (garde-fou : c'est le jeu qui vérifie le solde)
const LEASE_MS = 2 * 60_000;
// Marge avant l'expiration du jeton d'accès : bien au-delà de celle du jeu (supabase-js renouvelle à 90 s de la fin), pour
// qu'il ne renouvelle jamais la session pendant l'appel (un jeton de renouvellement ne sert qu'une fois).
const TRADE_MARGIN_MS = 5 * 60_000;
const CARD_ID = /^[A-Za-z0-9_-]{1,64}$/; // id de carte du jeu (un uuid ; plus large pour les tests)
const PUBLIC_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PROFILE_GAP_MS = 300;
const UNSURE = "Le jeu n'a pas répondu à la création de l'échange : regarde dans le jeu (Échanges) s'il a été créé avant de réessayer.";

// Ami désigné par son identifiant public ; seulement s'il montre ses cartes (comme ses pages), et toi aussi.
const FRIEND = `SELECT u.id, u.name, u.game_uid, u.game_pseudo FROM users AS u WHERE u.public_id = ?1 AND u.shared = 1 AND u.id <> ?2`;
// Titres des cartes dans le classeur de chacun (pour les messages et la lecture de la page de profil de l'ami).
const titlesOf = (n) => `SELECT card_id, json_extract(data, '$.title') AS title FROM cards WHERE user_id = ?1 AND card_id IN (${
  Array.from({ length: n }, (_, i) => `?${i + 2}`).join(',')})`;

function cardIds(value, what) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((x) => typeof x !== 'string' || !CARD_ID.test(x))) {
    throw new HttpError(400, `Les cartes ${what} (liste d'identifiants de cartes du jeu) sont mal formées.`);
  }
  return [...new Set(value)];
}

// Wikibidous d'un côté de l'échange : entier de 0 à MAX_WIKIBIDOUS (absent : 0).
function wikibidous(value, what) {
  if (value === undefined || value === null) return 0;
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_WIKIBIDOUS) {
    throw new HttpError(400, `Les wikibidous ${what} sont un nombre entier de 0 à ${MAX_WIKIBIDOUS.toLocaleString('fr-FR')}.`);
  }
  return value;
}

// Exemplaire à donner parmi ceux d'une carte : ni étoilé ni brillant si possible, puis le plus gros paquet (count),
// puis le plus récent.
export function pickCopy(rows) {
  return rows.slice().sort((a, b) => (!!a.starred - !!b.starred) || (!!a.is_shiny - !!b.is_shiny)
    || (Number(b.count) || 1) - (Number(a.count) || 1) || String(b.obtained_at || '').localeCompare(String(a.obtained_at || '')))[0] || null;
}

// Cookie de session d'une page du jeu (@supabase/ssr : « base64- » + JSON en base64url), refait depuis la session gardée.
export function sessionCookie(auth, uid) {
  const json = JSON.stringify({
    access_token: auth.access_token,
    token_type: 'bearer',
    expires_in: Math.max(0, Math.round((Number(auth.expires_at) || 0) - Date.now() / 1000)),
    expires_at: Number(auth.expires_at) || 0,
    refresh_token: auth.refresh_token,
    user: { id: uid },
  });
  const b64 = bytesToBase64(new TextEncoder().encode(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${AUTH_COOKIE}=base64-${b64}`;
}

// Session renouvelée par le jeu pendant l'appel (Set-Cookie de son cookie de session) : gardée, sinon la rotation de
// Supabase fermerait la session au prochain renouvellement du classeur. null si la réponse n'en pose pas.
export function sessionFromSetCookie(headers) {
  const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie()
    : typeof headers.getAll === 'function' ? headers.getAll('set-cookie') : [headers.get('set-cookie')].filter(Boolean);
  const pairs = [];
  for (const line of list) {
    const first = String(line).split(';')[0];
    const i = first.indexOf('=');
    if (i < 0) continue;
    const name = first.slice(0, i).trim();
    if (name === AUTH_COOKIE || name.startsWith(AUTH_COOKIE + '.')) pairs.push(first.trim());
  }
  if (!pairs.length) return null;
  const header = pairs.join('; ');
  if (/=\s*(;|$)/.test(header)) return null; // cookie effacé (déconnexion) : rien à garder
  try {
    return authFromCookie(header);
  } catch {
    return null;
  }
}

async function keepRenewed(env, user, s, auth) {
  if (!auth || auth.refresh_token === s.auth.refresh_token) return;
  const next = { ...auth, uid: s.auth.uid ?? s.uid ?? null };
  const row = await env.DB.prepare(
    'UPDATE users SET game_session_enc = ?1, game_session_v = ?2 + 1, game_session_at = ?3 WHERE id = ?4 AND game_session_v = ?2 RETURNING game_session_v',
  ).bind(await sealSession(env, user.id, next), s.v, nowIso(), user.id).first();
  if (row) { s.auth = next; s.v = row.game_session_v; }
}

// Exemplaires de ces cartes chez ce joueur, lus dans la base du jeu → Map card_id → [lignes].
async function copiesOf(env, user, s, uid, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const { rows } = await supaGet(env, user, s,
    `user_cards?select=id,card_id,count,starred,is_shiny,obtained_at&user_id=eq.${encodeURIComponent(uid)}&card_id=in.${inList(ids)}&limit=1000`,
    { retry: s.leased });
  for (const r of rows) {
    if (!r || typeof r.id !== 'string' || typeof r.card_id !== 'string') continue;
    if (!out.has(r.card_id)) out.set(r.card_id, []);
    out.get(r.card_id).push(r);
  }
  return out;
}

// Une requête à une route du jeu (www.wiki-masters.com), avec le cookie de session refait. Une seule tentative. Aussi pour
// le détail d'une enchère (cardmarket.js).
export async function gameFetch(env, user, s, path, init = {}) {
  const headers = {
    cookie: sessionCookie(s.auth, s.uid),
    accept: 'application/json',
    origin: GAME_ORIGIN,
    referer: GAME_ORIGIN + '/trades',
    ...(init.headers || {}),
  };
  const res = await fetch(GAME_ORIGIN + path, { ...init, headers, redirect: 'manual' });
  await keepRenewed(env, user, s, sessionFromSetCookie(res.headers));
  return res;
}

// Repli quand la base du jeu ne laisse pas lire les exemplaires de l'ami : la page de profil du jeu, une recherche par
// titre de carte (comme l'écran d'échange du jeu). → Map card_id → [lignes], et l'id de profil de l'ami.
async function copiesFromProfile(env, user, s, pseudo, wanted) {
  const out = new Map();
  let profileId = null;
  let first = true;
  for (const [id, title] of wanted) {
    if (!first) await new Promise((r) => setTimeout(r, env.REFRESH_PAUSE_MS !== undefined ? Number(env.REFRESH_PAUSE_MS) : PROFILE_GAP_MS));
    first = false;
    const q = new URLSearchParams({ page: '0', sort: 'rarity', stats: '0', q: title, pending: '1' });
    const res = await gameFetch(env, user, s, `/api/profile/${encodeURIComponent(pseudo)}/collection?${q}`);
    if (res.status === 404) throw new HttpError(409, `Le jeu ne connaît pas le pseudo « ${pseudo} » : vérifie-le avec ton ami.`);
    if (!res.ok) throw new HttpError(502, `Le jeu a refusé la lecture du profil de ton ami (${res.status}).`);
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.collection)) throw new HttpError(502, "Réponse inattendue du jeu (profil d'un joueur) : le jeu a peut-être changé.");
    if (typeof data.profileId === 'string') profileId = data.profileId;
    const pending = new Set(Array.isArray(data.pendingTradeCardIds) ? data.pendingTradeCardIds : []);
    const rows = data.collection.filter((r) => r && typeof r.id === 'string' && r.card_id === id && !pending.has(r.id));
    if (rows.length) out.set(id, rows);
  }
  return { copies: out, profileId };
}

// POST /api/trades/create {member, give:[card_id], get:[card_id], give_wb?, get_wb?} → {trade:{id, status}, given, received,
// given_wb, received_wb, url}. member = identifiant public de l'ami ; give = tes cartes, get = les siennes ; give_wb = les
// wikibidous que tu donnes, get_wb ceux que tu demandes (initiator_wikibidous et recipient_wikibidous du jeu). Au moins une
// carte ou des wikibidous, MAX_ITEMS cartes au plus. Les soldes ne sont pas vérifiés ici (celui lu à la synchro peut être
// vieux) : le jeu refuse un échange qu'un des deux ne peut pas payer.
export async function createTrade(env, user, body) {
  const db = env.DB;
  if (!user.shared || !user.public_id) {
    throw new HttpError(403, 'Pour proposer un échange depuis le classeur, montre d\'abord tes cartes : Réglages, « Partage entre membres ».');
  }
  const member = typeof body.member === 'string' ? body.member : '';
  if (!PUBLIC_ID.test(member)) throw new HttpError(400, 'Ami inconnu (member).');
  const give = cardIds(body.give, 'données');
  const get = cardIds(body.get, 'reçues');
  const giveWb = wikibidous(body.give_wb, 'donnés');
  const getWb = wikibidous(body.get_wb, 'demandés');
  if (!give.length && !get.length && !giveWb && !getWb) throw new HttpError(400, 'Choisis au moins une carte ou des wikibidous à donner ou à recevoir.');
  if (give.length + get.length > MAX_ITEMS) throw new HttpError(400, `${MAX_ITEMS} cartes au plus par échange.`);

  const friend = await db.prepare(FRIEND).bind(member, user.id).first();
  if (!friend) throw new HttpError(404, 'Ce membre ne montre pas (ou plus) ses cartes.');
  const friendName = friend.name || 'ton ami';
  await sessionOf(env, user); // pas de compte relié : 401 needs_link avant tout le reste

  const [mine, theirs] = await db.batch([
    db.prepare(titlesOf(Math.max(give.length, 1))).bind(user.id, ...(give.length ? give : [''])),
    db.prepare(titlesOf(Math.max(get.length, 1))).bind(friend.id, ...(get.length ? get : [''])),
  ]);
  const myTitles = new Map(mine.results.map((r) => [r.card_id, r.title]));
  const hisTitles = new Map(theirs.results.map((r) => [r.card_id, r.title]));
  const title = (m, id) => m.get(id) || id;

  // Le bail n'est indispensable que pour renouveler la session (deux renouvellements en même temps la fermeraient). Une
  // lecture automatique peut le tenir plusieurs minutes : si la session vaut encore plus de TRADE_MARGIN_MS, l'échange
  // part sans bail et sans jamais la renouveler (le jeton d'accès reste valable même si la lecture la renouvelle).
  const lease = await acquireLease(db, user.id, LEASE_MS);
  try {
    // Session relue après le bail : une lecture a pu la renouveler depuis l'authentification (son jeton de renouvellement
    // d'avant ne resservirait pas).
    const now = await db.prepare('SELECT game_session_enc, game_session_v, game_session_lost, game_uid FROM users WHERE id = ?1').bind(user.id).first();
    const s = await sessionOf(env, { ...user, ...now });
    if (!s.uid) throw new HttpError(401, 'Relie à nouveau ton compte du jeu (onglet « Synchro ») : il manque ton identifiant de joueur.', { needs_link: true });
    s.leased = !!lease;
    if ((Number(s.auth.expires_at) || 0) * 1000 - Date.now() < TRADE_MARGIN_MS) {
      if (!lease) {
        throw new HttpError(409, 'Une lecture automatique de ton compte du jeu est en cours et ta session doit être renouvelée : réessaie dans quelques minutes.');
      }
      await renewSession(env, user, s);
    }

    // L'ami dans le jeu : le compte qu'il a relié, sinon son pseudo (Réglages).
    let recipient = friend.game_uid || null;
    if (!recipient && friend.game_pseudo) {
      const { rows } = await supaGet(env, user, s, `profiles?select=id&username=eq.${encodeURIComponent(friend.game_pseudo)}&limit=2`, { retry: s.leased });
      if (rows.length === 1 && typeof rows[0].id === 'string') recipient = rows[0].id;
    }
    if (!recipient && !friend.game_pseudo) {
      throw new HttpError(409, `${friendName} n'a ni relié son compte du jeu ni donné son pseudo du jeu : impossible de savoir à qui proposer l'échange.`);
    }
    if (recipient === s.uid) throw new HttpError(409, 'Ce membre est relié au même compte du jeu que toi.');

    const myCopies = await copiesOf(env, user, s, s.uid, give);
    const missingMine = give.filter((id) => !myCopies.has(id));
    if (missingMine.length) {
      throw new HttpError(409, `Tu n'as plus dans le jeu : ${missingMine.map((id) => `« ${title(myTitles, id)} »`).join(', ')}. Rafraîchis ton classeur, puis recommence.`);
    }

    let hisCopies = recipient ? await copiesOf(env, user, s, recipient, get) : new Map();
    if (get.length && !hisCopies.size) {
      // Rien de lisible chez l'ami dans la base : la page de profil du jeu, par son pseudo.
      if (!friend.game_pseudo) {
        throw new HttpError(409, `Impossible de lire les cartes de ${friendName} dans le jeu : il doit donner son pseudo du jeu (Réglages).`);
      }
      const prof = await copiesFromProfile(env, user, s, friend.game_pseudo, get.map((id) => [id, title(hisTitles, id)]));
      hisCopies = prof.copies;
      if (!recipient) recipient = prof.profileId;
    }
    if (!recipient) throw new HttpError(409, `Le jeu ne connaît pas le pseudo « ${friend.game_pseudo} » : vérifie-le avec ${friendName}.`);
    const missingHis = get.filter((id) => !hisCopies.has(id));
    if (missingHis.length) {
      throw new HttpError(409, `${friendName} n'a plus dans le jeu : ${missingHis.map((id) => `« ${title(hisTitles, id)} »`).join(', ')}.`);
    }

    // Le jeu refuse un exemplaire favori : si tous les exemplaires d'une carte le sont, inutile de l'interroger.
    const allStarred = (copies, ids) => ids.filter((id) => copies.get(id).every((r) => r.starred));
    const lockedMine = allStarred(myCopies, give);
    if (lockedMine.length) {
      throw new HttpError(409, `En favori dans le jeu, donc non échangeables : ${lockedMine.map((id) => `« ${title(myTitles, id)} »`).join(', ')}. Décoche-les, ou retire le favori dans le jeu.`);
    }
    const lockedHis = allStarred(hisCopies, get);
    if (lockedHis.length) {
      throw new HttpError(409, `En favori chez ${friendName} dans le jeu, donc non échangeables : ${lockedHis.map((id) => `« ${title(hisTitles, id)} »`).join(', ')}.`);
    }

    const items = [
      ...give.map((id) => ({ user_card_id: pickCopy(myCopies.get(id)).id, card_id: id, offered_by: s.uid })),
      ...get.map((id) => ({ user_card_id: pickCopy(hisCopies.get(id)).id, card_id: id, offered_by: recipient })),
    ];
    let res;
    try {
      res = await gameFetch(env, user, s, '/api/trades', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipient_id: recipient, items, initiator_wikibidous: giveWb, recipient_wikibidous: getWb }),
      });
    } catch {
      throw new HttpError(502, UNSURE);
    }
    const data = await res.json().catch(() => null);
    if (res.status === 429 || (data && data.code === 'automation_limit')) {
      throw new HttpError(429, 'Le jeu limite les actions automatiques : propose cet échange dans le jeu, ou réessaie plus tard.', { limited: true });
    }
    if (res.status >= 500) throw new HttpError(502, UNSURE);
    if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
      throw new HttpError(502, `Le jeu a refusé ta session pour créer l'échange (${res.status}) : propose-le dans le jeu.`);
    }
    if (!res.ok) {
      const said = data && typeof (data.error || data.message) === 'string' ? String(data.error || data.message).slice(0, 300) : '';
      throw new HttpError(409, `Le jeu a refusé l'échange${said ? ` : « ${said} »` : ` (${res.status})`}.`);
    }
    const trade = data && data.trade && typeof data.trade.id === 'string' ? data.trade : null;
    if (!trade) throw new HttpError(502, "Le jeu a accepté la demande sans renvoyer l'échange : vérifie dans le jeu (Échanges).");
    return {
      trade: { id: trade.id, status: trade.status || 'pending' },
      given: give.map((id) => ({ id, title: title(myTitles, id) })),
      received: get.map((id) => ({ id, title: title(hisTitles, id) })),
      given_wb: giveWb,
      received_wb: getWb,
      url: GAME_ORIGIN + '/trades',
    };
  } finally {
    if (lease) await releaseLease(db, user.id, lease).run().catch((err) => console.error(err));
  }
}
