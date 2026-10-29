// Illustrations choisies à la main : pour un article (titre de Wikipédia en français), l'image principale d'une de ses
// versions linguistiques, choisie dans la fenêtre « Changer l'illustration » de la fiche. Seulement dans le classeur
// (la carte du jeu ne change pas), pour ce compte, sur tous ses appareils ; une carte et une case vide du même article
// partagent le choix.

import { HttpError } from './http.js';
import { cleanText, nowIso } from './util.js';

const MAX_TITLE = 300;
const MAX_URL = 1000;
const MAX_PICKS = 5000;
// Images servies par Wikimedia seulement (celles que la CSP de la page laisse passer) : upload.wikimedia.org, ou
// thumb.wikimedia.org où l'API de Wikipédia sert ses vignettes depuis fin octobre 2026. Sans paramètres (utm_*).
const URL_RE = /^https:\/\/(upload|thumb)\.wikimedia\.org\/[^\s"'<>\\?#]+$/;

function cleanTitle(raw) {
  if (typeof raw !== 'string') throw new HttpError(400, 'Le champ « title » doit être un texte.');
  const title = cleanText(raw);
  if (!title || title.length > MAX_TITLE) throw new HttpError(400, `Titre d'article vide ou de plus de ${MAX_TITLE} caractères.`);
  return title;
}

// GET /api/art : {picks:{<titre>: <adresse>}}
export async function listArt(env, user) {
  const { results } = await env.DB.prepare('SELECT title, url FROM art_picks WHERE user_id = ?1').bind(user.id).all();
  const picks = {};
  for (const r of results) picks[r.title] = r.url;
  return { picks };
}

// POST /api/art/set {title, url} : url = l'image gardée (upload. ou thumb.wikimedia.org, sans paramètres) ; null ou '' = revenir à l'image par défaut.
export async function setArt(env, user, body) {
  const db = env.DB;
  const title = cleanTitle(body.title);
  const url = body.url == null || body.url === '' ? null : body.url;
  if (url === null) {
    await db.prepare('DELETE FROM art_picks WHERE user_id = ?1 AND title = ?2').bind(user.id, title).run();
    return { title, url: null };
  }
  if (typeof url !== 'string' || url.length > MAX_URL || !URL_RE.test(url)) {
    throw new HttpError(400, "L'illustration doit être une image de upload.wikimedia.org ou thumb.wikimedia.org, sans paramètres.");
  }
  const state = await db.prepare(
    `SELECT (SELECT COUNT(*) FROM art_picks WHERE user_id = ?1) AS total,
            EXISTS (SELECT 1 FROM art_picks WHERE user_id = ?1 AND title = ?2) AS had`,
  ).bind(user.id, title).first();
  if (!state.had && state.total >= MAX_PICKS) {
    throw new HttpError(400, `${fmtN(MAX_PICKS)} illustrations choisies au plus : reviens à l'image par défaut sur d'autres cartes d'abord.`);
  }
  await db.prepare(
    `INSERT INTO art_picks (user_id, title, url, at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (user_id, title) DO UPDATE SET url = excluded.url, at = excluded.at`,
  ).bind(user.id, title, url, nowIso()).run();
  return { title, url };
}

const fmtN = (n) => new Intl.NumberFormat('fr-FR').format(n);
