// Vérifie le point d'entrée Worker (site/worker.js) : /api/* va au routeur, le reste aux fichiers statiques.
// Usage : node dev/worker.test.mjs   -> doit finir par WORKER OK
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createD1 } from './d1.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { default: worker } = await import(pathToFileURL(path.join(here, '..', 'site', 'worker.js')).href);
const assets = [];
const env = {
  DB: createD1(':memory:'),
  COOKIE_SECRET: 'test',
  SIGNUP_CODE: 'code',
  ASSETS: { fetch: async (req) => { assets.push(new URL(req.url).pathname); return new Response('fichier statique'); } },
};
const ctx = { waitUntil: () => {} };

let r = await worker.fetch(new Request('https://classeur.example/api/health'), env, ctx);
assert.equal(r.status, 200);
assert.deepEqual(await r.json(), { ok: true, db: true, cookie_secret: true, signup_open: true, sync_paused: false, cron: null });

r = await worker.fetch(new Request('https://classeur.example/api/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'code', name: 'Test' }) }), env, ctx);
assert.equal(r.status, 201);
const { key } = await r.json();
r = await worker.fetch(new Request('https://classeur.example/api/me', { headers: { 'x-classeur-key': key } }), env, ctx);
assert.equal(r.status, 200);

r = await worker.fetch(new Request('https://classeur.example/'), env, ctx);
assert.equal(await r.text(), 'fichier statique');
r = await worker.fetch(new Request('https://classeur.example/assets/app.js'), env, ctx);
assert.equal(await r.text(), 'fichier statique');
assert.deepEqual(assets, ['/', '/assets/app.js']);

// Déclencheur planifié : sans membre, la passe laisse tout de même son résultat dans cron_state.
const pending = [];
await worker.scheduled({ cron: '*/10 * * * *', scheduledTime: Date.now() }, env, { waitUntil: (p) => pending.push(p) });
await Promise.all(pending);
r = await worker.fetch(new Request('https://classeur.example/api/health'), env, ctx);
const { cron } = await r.json();
assert.ok(cron.collection.last_at);
assert.equal(cron.collection.last_result, '0 membre vérifié, 0 relu, 0 échec');
assert.deepEqual(cron.market, { last_at: null, last_result: null });

r = await worker.fetch(new Request('https://classeur.example/api/inconnu'), env, ctx);
assert.equal(r.status, 404);
console.log('WORKER OK');
