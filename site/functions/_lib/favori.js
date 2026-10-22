// GET /api/favori.js : code du favori « Relier », chargé depuis la page du jeu (public/assets/relier.js). L'origine du
// classeur y est écrite à la place de __SITE__ ; jamais mis en cache, pour que chaque clic prenne la dernière version.

import { HttpError } from './http.js';

export async function favoriScript(env, _user, _body, request) {
  if (!env.ASSETS) throw new HttpError(503, 'Les fichiers du classeur ne sont pas liés (variable ASSETS).');
  const origin = new URL(request.url).origin;
  const res = await env.ASSETS.fetch(new Request(`${origin}/assets/relier.js`));
  if (!res.ok) throw new HttpError(404, "Le code de liaison n'est pas disponible.");
  const code = (await res.text()).replace(/__SITE__/g, origin);
  return new Response(code, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
