// API du classeur : routeur unique pour /api/* (Cloudflare Pages Functions).
// Contrat : site/SPEC.md. Bindings : DB (D1), COOKIE_SECRET, SIGNUP_CODE, MAX_USERS (facultatif).

import { HttpError, MAX_BODY, errorResponse, json, readJson } from '../_lib/http.js';
import { ensureSchema } from '../_lib/db.js';
import { authenticate, createAccount, deleteMe, getMe, patchMe, rotateKey } from '../_lib/auth.js';
import { listCards } from '../_lib/cards.js';
import { deleteSession, saveSession } from '../_lib/session.js';
import { refresh } from '../_lib/refresh.js';
import { bulkTags, renameTag, setTags } from '../_lib/tags.js';
import { deleteTarget, listTargets, orderTargets, saveTarget } from '../_lib/targets.js';
import { listMembers, memberCards, memberTargets } from '../_lib/members.js';
import { deleteChat, lastChat, listChat, postChat, reactChat } from '../_lib/chat.js';
import { getMarket, listPrices } from '../_lib/market.js';
import { refreshMarket, searchCards } from '../_lib/marketread.js';
import { listSyncLog } from '../_lib/synclog.js';
import { favoriScript } from '../_lib/favori.js';
import { syncPaused } from '../_lib/cron.js';
import { createLink, linkWithToken } from '../_lib/link.js';
import { createTrade } from '../_lib/trades.js';
import { listFriends, requestFriend, requestFriends } from '../_lib/friends.js';
import { auctionDetail, cardMarket } from '../_lib/cardmarket.js';
import { cancelSale, sellCard, sellInfo } from '../_lib/sell.js';
import { placeBid } from '../_lib/bid.js';
import { markWish, syncWishlist, wishSoon } from '../_lib/wishlist.js';

// Seul le dépôt de session par le favori « Relier », lancé depuis le jeu (sous ses deux noms), accepte ces origines.
const GAME_ORIGINS = new Set(['https://www.wiki-masters.com', 'https://wiki-masters.com']);
const CORS_PATHS = new Set(['link/session']);
const CORS_HEADERS = {
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

// chemin → méthode → [gestionnaire, clé exigée]. Clé : false (aucune) ou 'main' (clé principale).
const ROUTES = {
  health: { GET: [health, false] },
  account: { POST: [(env, _user, body) => createAccount(env, body), false] },
  me: { GET: [getMe, 'main'], PATCH: [patchMe, 'main'], DELETE: [deleteMe, 'main'] },
  'favori.js': { GET: [favoriScript, false] },
  'key/rotate': { POST: [rotateKey, 'main'] },
  cards: { GET: [listCards, 'main'] },
  session: { POST: [saveSession, 'main'], DELETE: [deleteSession, 'main'] },
  refresh: { POST: [refresh, 'main'] },
  link: { POST: [createLink, 'main'] }, // jeton de liaison à usage unique
  'link/session': { POST: [linkWithToken, false] }, // dépôt de la session par le favori « Relier » (CORS du jeu)
  'tags/set': { POST: [setTags, 'main'] },
  'tags/bulk': { POST: [bulkTags, 'main'] },
  'tags/rename': { POST: [renameTag, 'main'] },
  targets: { GET: [listTargets, 'main'] },
  'targets/save': { POST: [saveTarget, 'main'] },
  'targets/delete': { POST: [deleteTarget, 'main'] },
  'targets/order': { POST: [orderTargets, 'main'] },
  members: { GET: [listMembers, 'main'] },
  'members/*/cards': { GET: [memberCards, 'main'] }, // members/<identifiant public>/cards
  'members/*/targets': { GET: [memberTargets, 'main'] }, // ses collections à compléter, s'il les montre
  chat: { GET: [listChat, 'main'], POST: [postChat, 'main'] }, // un salon pour tous les classeurs
  'chat/*': { DELETE: [deleteChat, 'main'] }, // chat/<numéro du message> : par son auteur
  'chat/*/react': { POST: [reactChat, 'main'] }, // chat/<numéro du message>/react : mettre ou retirer une réaction
  'chat/last': { GET: [lastChat, false] }, // heure du dernier message, sans clé (outil de publication des nouveautés)
  market: { GET: [getMarket, 'main'] }, // valeur du classeur, historique, dernière lecture du marché
  'market/prices': { GET: [listPrices, 'main'] }, // cotes de mes cartes et des cartes voulues
  'market/refresh': { POST: [refreshMarket, 'main'] }, // « Mettre à jour les cotes » : une passe de marché
  'market/card': { GET: [cardMarket, 'main'] }, // enchères en cours et ventes d'une carte (fiche)
  'market/auction': { GET: [auctionDetail, 'main'] }, // mises, meneur et vendeur d'une enchère (site du jeu)
  'game/cards': { GET: [searchCards, 'main'] }, // cartes du jeu par titre (« Depuis le jeu »)
  'sync-log': { GET: [listSyncLog, 'main'] }, // journal des synchros
  'trades/create': { POST: [createTrade, 'main'] }, // proposer un échange à un ami, dans le jeu
  friends: { GET: [listFriends, 'main'] }, // qui est ton ami dans le jeu, parmi les membres qui partagent
  'friends/request': { POST: [requestFriend, 'main'] }, // envoyer une demande d'ami dans le jeu à un membre
  'friends/request-all': { POST: [requestFriends, 'main'] }, // plusieurs demandes d'ami d'un coup (Réglages)
  'market/sell': { GET: [sellInfo, 'main'], POST: [sellCard, 'main'] }, // mettre une carte en vente dans le jeu (et ses exemplaires)
  'market/cancel': { POST: [cancelSale, 'main'] }, // annuler une de tes ventes, tant que personne n'a misé
  'market/bid': { POST: [placeBid, 'main'] }, // miser sur une enchère du jeu
  'wishlist/sync': { POST: [syncWishlist, 'main'] }, // « Mettre à jour ma liste de souhaits » du jeu (wishlist.js)
};

// Après ces gestes réussis, la liste de souhaits du jeu (wishlist.js) est mise à jour en arrière-plan, après la réponse,
// pour un membre qui l'a choisie : collection enregistrée (en entier, pas un morceau d'envoi ; elle devient due),
// « Rafraîchir » (due si les cartes ont changé), case « Liste de souhaits du jeu » cochée. → true si la passe est due.
async function wishAfter(env, user, key, method, result) {
  if (!user || (!user.auto_wish && !(key === 'me' && result && result.auto_wish))) return false;
  if (key === 'targets/save' && result && result.target) {
    await markWish(env.DB, user.id);
    return true;
  }
  return key === 'refresh' || (key === 'me' && method === 'PATCH' && !!(result && result.auto_wish));
}
// Chemins avec un paramètre → leur entrée dans ROUTES.
const PATTERNS = [[/^members\/[^/]+\/cards$/, 'members/*/cards'], [/^members\/[^/]+\/targets$/, 'members/*/targets'], [/^chat\/\d{1,15}$/, 'chat/*'], [/^chat\/\d{1,15}\/react$/, 'chat/*/react']];

// Corps plus petits que la limite générale (5 Mo), par entrée de ROUTES.
const BODY_LIMITS = { account: 4 * 1024, chat: 8 * 1024, 'chat/*/react': 1024, 'link/session': 20 * 1024, 'trades/create': 8 * 1024, 'friends/request': 1024, 'friends/request-all': 4 * 1024, 'market/sell': 2 * 1024, 'market/cancel': 2 * 1024, 'market/bid': 1024, 'wishlist/sync': 1024 };

// GET /api/health : présence de la configuration, jamais de valeur secrète.
async function health(env) {
  const db = !!env.DB;
  const out = {
    ok: db,
    db,
    cookie_secret: typeof env.COOKIE_SECRET === 'string' && env.COOKIE_SECRET !== '',
    signup_open: typeof env.SIGNUP_CODE === 'string' && env.SIGNUP_CODE.trim() !== '',
    sync_paused: syncPaused(env),
  };
  if (db) out.cron = await cronState(env.DB);
  return out;
}

// Dernière passe de chaque déclencheur (cron_state) ; null si la table n'existe pas encore (la santé répond avant ensureSchema).
async function cronState(db) {
  try {
    const { results } = await db.prepare('SELECT name, last_at, last_result FROM cron_state').all();
    const out = { collection: { last_at: null, last_result: null }, market: { last_at: null, last_result: null } };
    for (const r of results) if (Object.hasOwn(out, r.name)) out[r.name] = { last_at: r.last_at, last_result: r.last_result };
    return out;
  } catch {
    return null;
  }
}

async function handle(request, env, path, waitUntil) {
  // Sans base, tout répond 503, sauf /api/health qui sert justement à le diagnostiquer.
  if (!env.DB && path !== 'health') {
    throw new HttpError(503, "Le classeur n'est pas encore configuré : la base D1 n'est pas liée (variable DB).");
  }
  const pattern = PATTERNS.find(([re]) => re.test(path));
  const key = pattern ? pattern[1] : path;
  if (!Object.hasOwn(ROUTES, key)) throw new HttpError(404, "Ce point d'accès n'existe pas.");
  const route = ROUTES[key];
  if (!Object.hasOwn(route, request.method)) throw new HttpError(405, "Méthode non autorisée pour ce point d'accès.");
  const [handler, keyKind] = route[request.method];

  if (path === 'health') return handler(env);
  await ensureSchema(env.DB);
  // La clé d'abord : un corps n'est lu que pour un compte connu (ou pour l'inscription).
  // GET /api/me lit aussi, dans la même requête, le numéro du dernier message du chat (badge des non-lus) et l'heure de
  // la dernière lecture du marché (la page relit alors l'onglet « Marché »).
  const isMe = key === 'me' && request.method === 'GET';
  const user = keyKind ? await authenticate(request, env, { chat: isMe, market: isMe }) : null;
  const body = request.method === 'POST' || request.method === 'PATCH'
    ? await readJson(request, Object.hasOwn(BODY_LIMITS, key) ? BODY_LIMITS[key] : MAX_BODY)
    : {};
  const result = await handler(env, user, body, request);
  if (waitUntil && await wishAfter(env, user, key, request.method, result)) waitUntil(wishSoon(env, user.id));
  return result;
}

export async function onRequest(context) {
  const { request, env } = context;
  const path = new URL(request.url).pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const origin = request.headers.get('origin');
  const cors = CORS_PATHS.has(path) && GAME_ORIGINS.has(origin);

  let response;
  if (CORS_PATHS.has(path) && request.method === 'OPTIONS') {
    response = new Response(null, { status: 204 });
  } else {
    try {
      const result = await handle(request, env, path, typeof context.waitUntil === 'function' ? (p) => context.waitUntil(p) : null);
      response = result instanceof Response ? result : json(result);
    } catch (err) {
      response = errorResponse(err);
    }
  }
  if (CORS_PATHS.has(path)) {
    response.headers.append('vary', 'Origin');
    if (cors) {
      response.headers.set('access-control-allow-origin', origin);
      for (const [k, v] of Object.entries(CORS_HEADERS)) response.headers.set(k, v);
    }
  }
  return response;
}
