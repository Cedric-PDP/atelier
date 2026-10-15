// API du classeur : routeur unique pour /api/* (Cloudflare Pages Functions).
// Contrat : site/SPEC.md. Bindings : DB (D1), COOKIE_SECRET, SIGNUP_CODE.

import { HttpError, errorResponse, json, readJson } from '../_lib/http.js';
import { ensureSchema } from '../_lib/db.js';
import { authenticate, createAccount, deleteMe, getMe, patchMe } from '../_lib/auth.js';
import { listCards } from '../_lib/cards.js';
import { importRoute } from '../_lib/import.js';
import { deleteSession, saveSession } from '../_lib/session.js';
import { refresh } from '../_lib/refresh.js';
import { bulkTags, renameTag, setTags } from '../_lib/tags.js';
import { deleteTarget, listTargets, saveTarget } from '../_lib/targets.js';

// Seul POST /api/import accepte cette origine (le favori lancé depuis le jeu).
const GAME_ORIGIN = 'https://www.wiki-masters.com';
const CORS_HEADERS = {
  'access-control-allow-origin': GAME_ORIGIN,
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-classeur-key',
  'access-control-max-age': '86400',
};

// chemin → méthode → [gestionnaire, authentification exigée]
const ROUTES = {
  health: { GET: [health, false] },
  account: { POST: [(env, _user, body) => createAccount(env, body), false] },
  me: { GET: [getMe, true], PATCH: [patchMe, true], DELETE: [deleteMe, true] },
  cards: { GET: [listCards, true] },
  import: { POST: [importRoute, true] },
  session: { POST: [saveSession, true], DELETE: [deleteSession, true] },
  refresh: { POST: [refresh, true] },
  'tags/set': { POST: [setTags, true] },
  'tags/bulk': { POST: [bulkTags, true] },
  'tags/rename': { POST: [renameTag, true] },
  targets: { GET: [listTargets, true] },
  'targets/save': { POST: [saveTarget, true] },
  'targets/delete': { POST: [deleteTarget, true] },
};

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
  const route = ROUTES[path];
  if (!route) throw new HttpError(404, "Ce point d'accès n'existe pas.");
  const entry = route[request.method];
  if (!entry) throw new HttpError(405, "Méthode non autorisée pour ce point d'accès.");
  const [handler, needsAuth] = entry;

  if (path === 'health') return handler(env);
  await ensureSchema(env.DB);
  // La clé d'abord : un corps n'est lu que pour un compte connu (ou pour l'inscription).
  const user = needsAuth ? await authenticate(request, env) : null;
  const body = request.method === 'POST' || request.method === 'PATCH' ? await readJson(request) : {};
  return handler(env, user, body, request);
}

export async function onRequest(context) {
  const { request, env } = context;
  const path = new URL(request.url).pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const cors = path === 'import' && request.headers.get('origin') === GAME_ORIGIN;

  let response;
  if (path === 'import' && request.method === 'OPTIONS') {
    response = new Response(null, { status: 204, headers: cors ? { ...CORS_HEADERS } : {} });
  } else {
    try {
      const result = await handle(request, env, path);
      response = result instanceof Response ? result : json(result);
    } catch (err) {
      response = errorResponse(err);
    }
  }
  if (path === 'import') {
    response.headers.append('vary', 'Origin');
    if (cors) for (const [k, v] of Object.entries(CORS_HEADERS)) response.headers.set(k, v);
  }
  return response;
}
