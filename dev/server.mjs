// Serveur local : sert site/public/ et route /api/* vers les Pages Functions (site/functions/), avec D1 simulée
// (dev/local.sqlite).
//   node dev/server.mjs            (PORT, COOKIE_SECRET, SIGNUP_CODE, DB_PATH lus dans l'environnement)

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createD1 } from './d1.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, '..', 'site');
const PUBLIC = path.join(SITE, 'public'); // seul dossier servi, comme sur Cloudflare Pages
const PORT = Number(process.env.PORT) || 8788;
const MAX_DEV_BODY = 50 * 1024 * 1024; // garde-fou du serveur local ; la vraie limite (5 Mo) est dans l'API

const { onRequest } = await import(pathToFileURL(path.join(SITE, 'functions', 'api', '[[path]].js')).href);

const env = {
  DB: createD1(process.env.DB_PATH || path.join(here, 'local.sqlite')),
  COOKIE_SECRET: process.env.COOKIE_SECRET || 'secret-de-developpement-a-ne-pas-utiliser-en-ligne',
  SIGNUP_CODE: process.env.SIGNUP_CODE ?? 'dev',
};
if (process.env.REFRESH_PAUSE_MS !== undefined) env.REFRESH_PAUSE_MS = process.env.REFRESH_PAUSE_MS;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

// site/public/_headers (format Cloudflare Pages, sous-ensemble : chemins exacts ou avec *), relu à chaque requête.
async function headerRules() {
  let text;
  try {
    text = await readFile(path.join(PUBLIC, '_headers'), 'utf8');
  } catch {
    return [];
  }
  const rules = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      const pattern = line.trim().replace(/^https?:\/\/[^/]+/, '');
      const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      current = { re, headers: [] };
      rules.push(current);
    } else if (current) {
      const i = line.indexOf(':');
      if (i > 0) current.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
    }
  }
  return rules;
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(PUBLIC, '.' + rel);
  // Ni en dehors de site/public/, ni les fichiers de réglage de Pages.
  const inside = file.startsWith(PUBLIC + path.sep);
  const hidden = /[\\/](_headers|_redirects|_routes\.json)$/.test(file);
  let info = null;
  if (inside && !hidden) info = await stat(file).catch(() => null);
  if (!info || !info.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Introuvable');
    return;
  }
  const headers = { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' };
  for (const rule of await headerRules()) {
    if (rule.re.test(pathname)) for (const [k, v] of rule.headers) headers[k.toLowerCase()] = v;
  }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : await readFile(file));
}

async function serveApi(req, res, url) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_DEV_BODY) {
      res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Requête trop volumineuse.' }));
      return;
    }
    chunks.push(chunk);
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) for (const x of v) headers.append(k, x);
    else if (v !== undefined) headers.set(k, v);
  }
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const request = new Request(url, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined });
  const segments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const context = {
    request,
    env,
    params: { path: segments },
    data: {},
    waitUntil: (p) => Promise.resolve(p).catch((e) => console.error(e)),
    next: async () => new Response('Introuvable', { status: 404 }),
  };
  const response = await onRequest(context);
  const out = {};
  response.headers.forEach((v, k) => {
    out[k] = v;
  });
  res.writeHead(response.status, out);
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  try {
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) await serveApi(req, res, url);
    else await serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Erreur du serveur local');
  }
  console.log(`${req.method} ${url.pathname} → ${res.statusCode}`);
});

server.listen(PORT, () => {
  console.log(`Classeur local : http://localhost:${PORT}/  (fichiers : ${PUBLIC})`);
  console.log(`  base       : ${process.env.DB_PATH || path.join(here, 'local.sqlite')}`);
  console.log(`  SIGNUP_CODE : ${env.SIGNUP_CODE === '' ? '(vide : inscriptions fermées)' : env.SIGNUP_CODE}`);
  console.log(`  COOKIE_SECRET : ${process.env.COOKIE_SECRET ? '(depuis l\'environnement)' : env.COOKIE_SECRET + ' (valeur de dev)'}`);
});
