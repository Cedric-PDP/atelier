// Lance à la main un déclencheur planifié contre la base locale (dev/local.sqlite, ou DB_PATH) et affiche son résultat.
//   node dev/cron.mjs collection|market      (COOKIE_SECRET, DB_PATH, SYNC_PAUSED lus dans l'environnement)

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createD1 } from './d1.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, '..', 'site');
const name = process.argv[2];
const { COLLECTION_CRON, MARKET_CRON } = await import(pathToFileURL(path.join(SITE, 'functions', '_lib', 'cron.js')).href);
const CRONS = { collection: COLLECTION_CRON, market: MARKET_CRON };
if (!Object.hasOwn(CRONS, name || '')) {
  console.error('Usage : node dev/cron.mjs collection|market');
  process.exit(2);
}

const { default: worker } = await import(pathToFileURL(path.join(SITE, 'worker.js')).href);
const env = {
  DB: createD1(process.env.DB_PATH || path.join(here, 'local.sqlite')),
  COOKIE_SECRET: process.env.COOKIE_SECRET || 'secret-de-developpement-a-ne-pas-utiliser-en-ligne',
};
if (process.env.SYNC_PAUSED !== undefined) env.SYNC_PAUSED = process.env.SYNC_PAUSED;
if (process.env.REFRESH_PAUSE_MS !== undefined) env.REFRESH_PAUSE_MS = process.env.REFRESH_PAUSE_MS;

const waiting = [];
await worker.scheduled({ cron: CRONS[name], scheduledTime: Date.now() }, env, { waitUntil: (p) => waiting.push(p) });
const [result] = await Promise.all(waiting);
console.log(`${name} : ${result ?? 'rien à faire (suspendu, déjà en cours ou sauté)'}`);
