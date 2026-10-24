// Lectures sans geste du joueur, lancées par les déclencheurs planifiés de Cloudflare (wrangler.jsonc, `triggers`) :
// la collection de chaque membre relié (vérifiée toutes les 10 minutes avec son solde de wikibidous, relue en entier si elle
// a bougé et au moins toutes les 6 heures), le marché de chaque membre relié (cotes, enchères et ventes : une passe toutes les 20 minutes au plus). Une passe par déclencheur, un bail par passe (cron_state) pour que deux
// invocations ne se chevauchent pas. Garde-fous : SYNC_PAUSED suspend tout, un membre sans « Synchro automatique » ou en
// pause (FAILS_MAX échecs d'affilée) est sauté, une limite du jeu (429, automation_limit) arrête la passe et saute la suivante.

import { ensureSchema } from './db.js';
import { USER_COLUMNS } from './auth.js';
import { acquireLease, balanceStatement, freshAuth, readBalance, releaseLease, sessionOf } from './game.js';
import { syncState } from './import.js';
import { FAILS_MAX, LEASE_MS, checkCollection, readCollection } from './refresh.js';
import { errorEntry, writeLog } from './synclog.js';
import { FULL_START_SQL } from './market.js';
import { marketPass } from './marketread.js';
import { autoFriends } from './friends.js';

export { FAILS_MAX, LEASE_MS };
export const COLLECTION_CRON = '*/10 * * * *';
export const MARKET_CRON = '5-59/20 * * * *';
export const FULL_EVERY_MS = 6 * 3600_000;
export const CRON_BUDGET_MS = 10 * 60_000;
export const SKIP_AFTER_LIMIT_MS = { collection: 15 * 60_000, market: 25 * 60_000 };
export const MARKET_EVERY_MS = 20 * 60_000;

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

const HANDLERS = { collection: collectionPass, market: marketCronPass };

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
  const counts = { checked: 0, read: 0, failed: 0, friends: 0 };
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
        // Le solde de wikibidous bouge sans la collection (ventes, achats, échanges) : relu à chaque vérification.
        const balance = balanceStatement(db, member.id, await readBalance(env, member, s, { gap: 250 }));
        await db.batch([
          db.prepare("UPDATE users SET sync_state = json_set(sync_state, '$.checked_at', ?2) WHERE id = ?1 AND json_valid(sync_state)")
            .bind(member.id, new Date().toISOString()),
          ...(balance ? [balance] : []),
        ]);
      }
      counts.checked++;
      await noteSuccess(db, member.id);
      if (member.auto_friend) {
        // Demandes d'ami automatiques (friends.js), sous le même bail ; session relue (la lecture a pu la renouveler). Un
        // échec n'est pas celui de la lecture : seule une limite du jeu arrête la passe.
        try {
          const row = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?1`).bind(member.id).first();
          const fs = await sessionOf(env, row);
          fs.via = 'cron';
          const r = await autoFriends(env, row, fs);
          counts.friends += r.sent;
        } catch (err) {
          if (err && err.extra && err.extra.limited) {
            await skipNext(db, 'collection', SKIP_AFTER_LIMIT_MS.collection, now);
            limited = true;
            break;
          }
          console.error(err);
        }
      }
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
    + `${counts.failed} ${plural(counts.failed, 'échec', 'échecs')}`
    + (counts.friends ? `, ${counts.friends} ${plural(counts.friends, "demande d'ami envoyée", "demandes d'ami envoyées")}` : '');
  return limited ? `limite du jeu (${text})` : text;
}

// Début de la dernière passe complète de marché de chaque compte (FULL_START_SQL : une passe légère, au clic, ne compte
// pas), les plus anciennes d'abord : une passe dure environ 30 s par membre (30 requêtes à une par seconde), tous ne
// tiennent pas dans un tick ; l'ordre fait tourner.
const byLastMarket = `(SELECT ${FULL_START_SQL('m.attempt')} FROM market AS m WHERE m.user_id = users.id), id`;

async function marketCronPass(env, { now }) {
  const db = env.DB;
  const start = Date.now();
  const counts = { read: 0, failed: 0 };
  let limited = false;
  const { results } = await db.prepare(
    `SELECT user_id, ${FULL_START_SQL('attempt')} AS start FROM market WHERE attempt IS NOT NULL`,
  ).all();
  const lastStart = new Map(results.map((r) => [r.user_id, Date.parse(r.start || '')]));
  for (const member of await eligibleMembers(db, byLastMarket)) {
    if (Date.now() - start >= CRON_BUDGET_MS) break;
    const since = lastStart.get(member.id);
    if (since > now - MARKET_EVERY_MS && since <= now + 60_000) continue; // passe complète il y a moins de 20 min (un clic, léger, ne compte pas)
    try {
      const r = await marketPass(env, member, { via: 'cron', auto: true });
      if (r.skip) continue;
      counts.read++;
      await noteSuccess(db, member.id);
    } catch (err) {
      const extra = (err && err.extra) || {};
      if (extra.needs_link) continue; // noté dans l'essai (et au journal par game.js) ; le membre n'est plus éligible
      if (err && err.status === 409) continue; // une autre lecture tient sa session : sauté, sans échec
      if (extra.limited) {
        await skipNext(db, 'market', SKIP_AFTER_LIMIT_MS.market, now);
        counts.failed++;
        limited = true;
        break;
      }
      if (extra.quota !== undefined) continue; // quota du jour des cotes : pas un échec du membre
      counts.failed++;
      await noteFailure(db, member.id);
    }
  }
  const text = `${counts.read} ${plural(counts.read, 'membre lu', 'membres lus')}, ${counts.failed} ${plural(counts.failed, 'échec', 'échecs')}`;
  return limited ? `limite du jeu (${text})` : text;
}
