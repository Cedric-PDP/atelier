// API du classeur : routeur unique pour /api/* (Cloudflare Pages Functions).
// Contrat : site/SPEC.md. Bindings : DB (D1), COOKIE_SECRET, SIGNUP_CODE, MAX_USERS (facultatif).

import { HttpError, MAX_BODY, errorResponse, json, readJson } from '../_lib/http.js';
import { ensureSchema } from '../_lib/db.js';
import { authenticate, createAccount, deleteMe, getMe, newImportKey, patchMe, rotateKey } from '../_lib/auth.js';
import { listCards } from '../_lib/cards.js';
import { importRoute } from '../_lib/import.js';
import { deleteSession, saveSession } from '../_lib/session.js';
import { refresh } from '../_lib/refresh.js';
import { bulkTags, renameTag, setTags } from '../_lib/tags.js';
import { deleteTarget, listTargets, saveGameTarget, saveTarget } from '../_lib/targets.js';
import { listMembers, memberCards, memberTargets } from '../_lib/members.js';
import { deleteChat, listChat, postChat } from '../_lib/chat.js';
import { getMarket, listPrices, marketPlan, postLive, postPrices } from '../_lib/market.js';

// Seuls les points d'accès du favori (lancé depuis le jeu, sous ses deux noms) acceptent ces origines.
const GAME_ORIGINS = new Set(['https://www.wiki-masters.com', 'https://wiki-masters.com']);
// Marché : le favori lit son plan et envoie les cotes et sa lecture du marché (market.js).
const CORS_PATHS = new Set(['import', 'targets/from-game', 'market/plan', 'market/prices', 'market/live']);
const CORS_HEADERS = {
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-classeur-key',
  'access-control-max-age': '86400',
};

// chemin → méthode → [gestionnaire, clé exigée]. Clé : false (aucune), 'main' (clé principale seulement) ou
// 'import' (clé principale ou clé d'import du favori).
const ROUTES = {
  health: { GET: [health, false] },
  account: { POST: [(env, _user, body) => createAccount(env, body), false] },
  me: { GET: [getMe, 'main'], PATCH: [patchMe, 'main'], DELETE: [deleteMe, 'main'] },
  'import-key': { POST: [newImportKey, 'main'] },
  'key/rotate': { POST: [rotateKey, 'main'] },
  cards: { GET: [listCards, 'main'] },
  import: { POST: [importRoute, 'import'] },
  session: { POST: [saveSession, 'main'], DELETE: [deleteSession, 'main'] },
  refresh: { POST: [refresh, 'main'] },
  'tags/set': { POST: [setTags, 'main'] },
  'tags/bulk': { POST: [bulkTags, 'main'] },
  'tags/rename': { POST: [renameTag, 'main'] },
  targets: { GET: [listTargets, 'main'] },
  'targets/save': { POST: [saveTarget, 'main'] },
  'targets/delete': { POST: [deleteTarget, 'main'] },
  'targets/from-game': { POST: [saveGameTarget, 'import'] }, // favori : crée une collection depuis une recherche du jeu
  members: { GET: [listMembers, 'main'] },
  'members/*/cards': { GET: [memberCards, 'main'] }, // members/<identifiant public>/cards
  'members/*/targets': { GET: [memberTargets, 'main'] }, // ses collections à compléter, s'il les montre
  chat: { GET: [listChat, 'main'], POST: [postChat, 'main'] }, // un salon pour tous les classeurs ; jamais la clé d'import
  'chat/*': { DELETE: [deleteChat, 'main'] }, // chat/<numéro du message> : par son auteur
  market: { GET: [getMarket, 'main'] }, // valeur du classeur, historique, dernière lecture du marché
  'market/prices': { GET: [listPrices, 'main'], POST: [postPrices, 'import'] }, // cotes : lues par la page, envoyées par le favori
  'market/plan': { POST: [marketPlan, 'import'] }, // favori : cartes à coter, titres des cartes voulues
  'market/live': { POST: [postLive, 'import'] }, // favori : bonnes affaires, enchères et ventes du joueur
};
// Chemins avec un paramètre → leur entrée dans ROUTES.
const PATTERNS = [[/^members\/[^/]+\/cards$/, 'members/*/cards'], [/^members\/[^/]+\/targets$/, 'members/*/targets'], [/^chat\/\d{1,15}$/, 'chat/*']];

// Corps plus petits que la limite générale (5 Mo).
const BODY_LIMITS = { account: 4 * 1024, chat: 8 * 1024, 'market/plan': 1024, 'market/prices': 512 * 1024, 'market/live': 128 * 1024 };

// GET /api/health : présence de la configuration, jamais de valeur secrète.
function health(env) {
  const db = !!env.DB;
  return {
    ok: db,
    db,
    cookie_secret: typeof env.COOKIE_SECRET === 'string' && env.COOKIE_SECRET !== '',
    signup_open: typeof env.SIGNUP_CODE === 'string' && env.SIGNUP_CODE.trim() !== '',
  };
}

async function handle(request, env, path) {
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
  // GET /api/me lit aussi, dans la même requête, le numéro du dernier message du chat (badge des non-lus).
  const user = keyKind ? await authenticate(request, env, { importKey: keyKind === 'import', chat: key === 'me' && request.method === 'GET' }) : null;
  const body = request.method === 'POST' || request.method === 'PATCH'
    ? await readJson(request, Object.hasOwn(BODY_LIMITS, path) ? BODY_LIMITS[path] : MAX_BODY)
    : {};
  return handler(env, user, body, request);
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
      const result = await handle(request, env, path);
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
