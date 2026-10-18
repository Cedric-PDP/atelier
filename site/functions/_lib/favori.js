// Favori court (téléphone, 2026-10-18 : le favori complet, ≈ 62 000 caractères en adresse javascript:, fait planter les
// navigateurs de téléphone) : GET /api/favori.js sert le code du favori (public/assets/bookmarklet.js) tel quel, avec
// l'adresse du classeur en place et la clé d'import lue dans window.__classeurCourt.k, posée par le favori court (jamais
// dans l'adresse ni dans les journaux). Sans cache : chaque clic prend la dernière version du favori.

import { HttpError } from './http.js';

export async function favoriScript(env, _user, _body, request) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
    throw new HttpError(503, "Le code du favori n'est pas disponible ici (fichiers du site non liés).");
  }
  const origin = new URL(request.url).origin;
  const r = await env.ASSETS.fetch(new Request(origin + '/assets/bookmarklet.js'));
  if (!r.ok) throw new HttpError(502, 'Code du favori introuvable : réessaie dans un instant.');
  const src = (await r.text())
    .replaceAll('"__SITE__"', JSON.stringify(origin))
    .replaceAll('"__KEY__"', '((window.__classeurCourt || {}).k || "")');
  return new Response(src, {
    headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}
