// Réponses JSON, erreurs et lecture du corps des requêtes.

import { cleanMessage } from './synclog.js';

export const MAX_BODY = 5 * 1024 * 1024; // 5 Mo

// Erreur destinée au client : statut HTTP + message en français (+ champs en plus, comme needs_link).
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

// JSON déjà sérialisé (texte stocké en base) : recopié tel quel dans la réponse, sans le relire en JavaScript.
export class RawJson {
  constructor(text) {
    this.text = text;
  }
}
export const raw = (text) => new RawJson(text);

// Objet JSON dont certains champs (au premier niveau) peuvent être du RawJson.
export function jsonText(fields) {
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(`${JSON.stringify(k)}:${v instanceof RawJson ? v.text : JSON.stringify(v ?? null)}`);
  }
  return `{${parts.join(',')}}`;
}

function toText(data) {
  if (data instanceof RawJson) return data.text;
  if (data && typeof data === 'object' && !Array.isArray(data) && Object.values(data).some((v) => v instanceof RawJson)) {
    return jsonText(data);
  }
  return JSON.stringify(data);
}

export function json(data, status = 200, headers = {}) {
  return new Response(toText(data), { status, headers: { ...JSON_HEADERS, ...headers } });
}

// Erreurs de D1 dues à la place ou aux quotas (base pleine, quota du jour atteint, ligne trop grosse).
function isDbFull(err) {
  const msg = String(err && err.message);
  return /SQLITE_FULL|SQLITE_TOOBIG|disk is full|database is full|too big/i.test(msg)
    || (/D1|SQLITE/i.test(msg) && /full|exceeded|quota|limit/i.test(msg));
}

export function errorResponse(err) {
  if (err instanceof HttpError) return json({ error: err.message, ...err.extra }, err.status);
  console.error(err);
  if (isDbFull(err)) {
    return json({
      error: 'La base du classeur est pleine ou a atteint son quota du jour : réessaie demain, ou préviens la personne qui le gère.',
    }, 503);
  }
  // Un extrait de l'erreur (secrets masqués) : sans accès aux journaux du Worker, c'est le seul moyen de la connaître.
  const detail = err && err.message ? ` (${cleanMessage(err.message, 160)})` : '';
  return json({ error: `Erreur interne du serveur${detail}.` }, 500);
}

// Lit un corps JSON (objet) en s'arrêtant dès que la limite est dépassée. Corps vide = {}.
export async function readJson(request, limit = MAX_BODY) {
  const tooBig = () => new HttpError(
    413,
    `Requête trop volumineuse : ${limit >= 1024 * 1024 ? `${limit / (1024 * 1024)} Mo` : `${Math.round(limit / 1024)} Ko`} au plus.`,
  );
  const declared = Number(request.headers.get('content-length'));
  if (declared > limit) throw tooBig();
  if (!request.body) return {};

  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw tooBig();
    }
    chunks.push(value);
  }
  if (size === 0) return {};

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "Le corps de la requête n'est pas du JSON valide.");
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpError(400, 'Le corps de la requête doit être un objet JSON.');
  }
  return data;
}
