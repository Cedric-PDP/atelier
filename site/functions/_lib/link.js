// Liaison du compte du jeu par un favori « Relier » : le classeur donne un jeton à usage unique (30 min), le favori, lancé
// depuis une fenêtre privée sur la page du jeu, le renvoie avec la session de la page (POST /api/link/session, la seule
// route qui accepte les origines du jeu). Le jeton n'ouvre pas le classeur : il permet seulement d'y déposer une session,
// que le jeu doit reconnaître (linkSession). Il ne passe jamais par l'adresse de favori.js (journaux), mais par
// window.__classeurLien.
//
// Forme du favori, construite par la page (~250 caractères, marche sur téléphone) :
//   javascript:(function(){window.__classeurLien={t:"<jeton>"};var s=document.createElement("script");s.src="<origine>/api/favori.js";s.async=true;document.documentElement.appendChild(s)})();

import { HttpError } from './http.js';
import { linkSession, authFromCookie } from './game.js';
import { cleanCookie } from './session.js';
import { nowIso, randomToken, sha256Hex } from './util.js';

export const LINK_TTL_MS = 30 * 60 * 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

const STALE = 'Lien de liaison périmé ou déjà utilisé : refais « Relier mon compte » dans le classeur, puis reclique le favori dans ta fenêtre privée.';

// POST /api/link : un nouveau jeton remplace l'ancien.
export async function createLink(env, user) {
  const token = randomToken(24);
  const until = new Date(Date.now() + LINK_TTL_MS).toISOString();
  await env.DB.prepare('UPDATE users SET link_hash = ?1, link_until = ?2 WHERE id = ?3').bind(await sha256Hex(token), until, user.id).run();
  return { token, until };
}

// POST /api/link/session, sans clé : {token, cookie} → {ok, pseudo}.
export async function linkWithToken(env, _user, body) {
  const token = body && body.token;
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new HttpError(401, STALE);
  const auth = authFromCookie(cleanCookie(body.cookie)); // un cookie illisible ne consomme pas le jeton
  // Consommé avant la vérification auprès du jeu, même si la liaison échoue ensuite : un jeton ne sert qu'une fois.
  const owner = await env.DB.prepare('UPDATE users SET link_hash = NULL, link_until = NULL WHERE link_hash = ?1 AND link_until > ?2 RETURNING id')
    .bind(await sha256Hex(token), nowIso()).first();
  if (!owner) throw new HttpError(401, STALE);
  const { pseudo } = await linkSession(env, owner, auth, 'relier');
  return { ok: true, pseudo };
}
