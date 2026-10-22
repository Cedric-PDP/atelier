// Lectures sans geste du joueur, lancées par les déclencheurs planifiés de Cloudflare (wrangler.jsonc, `triggers`) :
// la collection de chaque membre relié (vérifiée toutes les 10 minutes, relue en entier si elle a bougé et au moins toutes
// les 6 heures), le marché sur le rythme MARKET_CRON. Une passe par déclencheur, un bail par passe (cron_state) pour que deux
// invocations ne se chevauchent pas. Garde-fous : SYNC_PAUSED suspend tout, un membre sans « Synchro automatique » ou en
// pause (FAILS_MAX échecs d'affilée) est sauté, une limite du jeu (429, automation_limit) arrête la passe et saute la suivante.

import { ensureSchema } from './db.js';
import { USER_COLUMNS } from './auth.js';
import { acquireLease, freshAuth, releaseLease, sessionOf } from './game.js';
import { syncState } from './import.js';
import { FAILS_MAX, LEASE_MS, checkCollection, readCollection } from './refresh.js';
import { errorEntry, writeLog } from './synclog.js';

export { FAILS_MAX, LEASE_MS };
export const COLLECTION_CRON = '*/10 * * * *';
export const MARKET_CRON = '5-59/20 * * * *';
export const FULL_EVERY_MS = 6 * 3600_000;
export const CRON_BUDGET_MS = 10 * 60_000;
export const SKIP_AFTER_LIMIT_MS = { collection: 15 * 60_000, market: 25 * 60_000 };

const plural = (n, one, many) => (n > 1 ? many : one);

// SYNC_PAUSED = 1, true, oui ou yes : plus aucun déclencheur ne lit (les clics fonctionnent toujours).
export function syncPaused(env) {
  return /^(1|true|oui|yes)$/i.test(String(env.SYNC_PAUSED ?? ''));
}

// Membres dont la session sert et qui n'ont ni coupé la synchro automatique ni atteint la pause. `order` : expression
// SQL de tri (par défaut l'identifiant).
export async function eligibleMembers(db, order = 'id') {
  const { results } = await db.prepare(
    `SELECT ${USER_COLUMNS} FROM users WHERE game_session_enc IS NOT NULL AND game_session_lost IS NULL AND auto_sync = 1
       AND sync_fails < ${FAILS_MAX} ORDER BY ${order}`,
  ).all();
  return results;
}

// Un échec de plus ; rend le nombre d'échecs d'affilée.
export async function noteFailure(db, userId) {
  const row = await db.prepare('UPDATE users SET sync_fails = sync_fails + 1 WHERE id = ?1 RETURNING sync_fails').bind(userId).first();
  return row ? row.sync_fails : 0;
}

export async function noteSuccess(db, userId) {
  await db.prepare('UPDATE users SET sync_fails = 0 WHERE id = ?1 AND sync_fails <> 0').bind(userId).run();
}

// La prochaine passe de ce déclencheur n'a pas lieu avant `ms`.
export async function skipNext(db, name, ms, now = Date.now()) {
  await db.prepare('INSERT OR IGNORE INTO cron_state (name) VALUES (?1)').bind(name).run();
  await db.prepare('UPDATE cron_state SET skip_until = ?2 WHERE name = ?1').bind(name, new Date(now + ms).toISOString()).run();
}

const HANDLERS = { collection: collectionPass, market: null };

// Déclencheur `cron` (expression de wrangler.jsonc) → une passe. Rend le résultat noté dans cron_state, ou null si rien
// n'a été fait (configuration absente, SYNC_PAUSED, passe précédente encore en cours ou sautée).
export async function runCron(env, cron, { now = Date.now() } = {}) {
  if (!env.DB || syncPaused(env)) return null;
  const db = env.DB;
  const name = cron === MARKET_CRON ? 'market' : 'collection';
  const pass = HANDLERS[name];
  if (!pass) return null;
  await ensureSchema(db);
  await db.prepare('INSERT OR IGNORE INTO cron_state (name) VALUES (?1)').bind(name).run();
  const taken = await db.prepare(
    `UPDATE cron_state SET running_until = ?2 WHERE name = ?1 AND (running_until IS NULL OR running_until < ?3)
       AND (skip_until IS NULL OR skip_until < ?3) RETURNING name`,
  ).bind(name, new Date(now + LEASE_MS + CRON_BUDGET_MS).toISOString(), new Date(now).toISOString()).first();
  if (!taken) return null;
  let result;
  try {
    result = await pass(env, { now });
  } catch (err) {
    console.error(err);
    result = `erreur : ${String(err && err.message ? err.message : err).slice(0, 200)}`;
  }
  await db.prepare('UPDATE cron_state SET running_until = NULL, last_at = ?2, last_result = ?3 WHERE name = ?1')
    .bind(name, new Date().toISOString(), result).run();
  return result;
}

const byLastCheck = "CASE WHEN json_valid(sync_state) THEN json_extract(sync_state, '$.checked_at') END, id";

// Relecture nécessaire ? Le compte ou le plus récent exemplaire ont changé, ou la dernière lecture vérifiée est trop vieille.
function needsRead(state, seen, now) {
  return seen.rows !== state?.rows || seen.last_at !== state?.last_at || !state?.full_at
    || now - Date.parse(state.full_at) >= FULL_EVERY_MS;
}

async function collectionPass(env, { now }) {
  const db = env.DB;
  const start = Date.now();
  const counts = { checked: 0, read: 0, failed: 0 };
  let limited = false;
  for (const member of await eligibleMembers(db, byLastCheck)) {
    if (Date.now() - start >= CRON_BUDGET_MS) break;
    const lease = await acquireLease(db, member.id, LEASE_MS);
    if (!lease) continue; // une lecture du membre est déjà en cours : sauté, sans échec
    try {
      const s = await sessionOf(env, member);
      s.via = 'cron';
      await freshAuth(env, member, s);
      const seen = await checkCollection(env, member, s);
      if (needsRead(syncState(member), seen, now)) {
        // La vérification a pu renouveler la session : la lecture repart de la ligne à jour, sous le même bail.
        const user = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?1`).bind(member.id).first();
        await readCollection(env, user, { via: 'cron', lease });
        counts.read++;
      } else {
        await db.prepare("UPDATE users SET sync_state = json_set(sync_state, '$.checked_at', ?2) WHERE id = ?1 AND json_valid(sync_state)")
          .bind(member.id, new Date().toISOString()).run();
      }
      counts.checked++;
      await noteSuccess(db, member.id);
    } catch (err) {
      if (err && err.extra && err.extra.needs_link) continue; // déjà noté au journal par game.js ; le membre n'est plus éligible
      counts.failed++;
      const entry = errorEntry('full', err, { via: 'cron' });
      if (err && err.extra && err.extra.limited) {
        await skipNext(db, 'collection', SKIP_AFTER_LIMIT_MS.collection, now);
        await writeLog(db, member.id, entry);
        limited = true;
        break;
      }
      const fails = await noteFailure(db, member.id);
      if (fails >= FAILS_MAX) {
        entry.message += ` Lectures automatiques en pause après ${FAILS_MAX} échecs : « Rafraîchir » dans le classeur les relance.`;
      }
      await writeLog(db, member.id, entry);
    } finally {
      await releaseLease(db, member.id, lease).run().catch((err) => console.error(err));
    }
  }
  const text = `${counts.checked} ${plural(counts.checked, 'membre vérifié', 'membres vérifiés')}, ${counts.read} ${plural(counts.read, 'relu', 'relus')}, `
    + `${counts.failed} ${plural(counts.failed, 'échec', 'échecs')}`;
  return limited ? `limite du jeu (${text})` : text;
}
