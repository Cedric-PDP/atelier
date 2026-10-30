// Solde de wikibidous relu à la demande (POST /api/me/balance) : la page l'appelle quand on s'apprête à dépenser (fenêtres
// « Miser » et « Proposer un échange », onglet « Marché ») et après une action dans le jeu faite depuis le classeur. Une
// requête légère (rpc/get_my_profile, game.js readBalance), au plus une toutes les BALANCE_FRESH_MS : sinon le solde rangé
// est rendu tel quel. Le bail sert seulement à renouveler la session (deux renouvellements en même temps la fermeraient) :
// une lecture automatique le tient, la session vaut encore assez longtemps → lecture sans renouvellement ; sinon, solde
// rangé (cette lecture relit le solde elle-même à sa fin).

import { HttpError } from './http.js';
import { REFRESH_MARGIN_MS, acquireLease, balanceStatement, freshAuth, readBalance, releaseLease, sessionOf } from './game.js';

export const BALANCE_FRESH_MS = 30_000;
export const BALANCE_FORCE_MS = 5_000;
const LEASE_MS = 30_000;

const stored = (user) => (user.wikibidous === null || user.wikibidous === undefined ? null : { n: user.wikibidous, at: user.wikibidous_at || null });

// POST /api/me/balance {force?} → {wikibidous: {n, at} | null, read}. read : true si le jeu vient d'être lu. force : juste
// après une action dans le jeu (vente, échange), relu s'il a plus de BALANCE_FORCE_MS. 401 needs_link sans compte relié,
// 429 limited si le jeu limite.
export async function refreshBalance(env, user, body) {
  const db = env.DB;
  // Sans compte relié : 401 needs_link tout de suite (la session elle-même est relue sous bail plus bas).
  if (!user.game_session_enc || user.game_session_lost) await sessionOf(env, user);
  const at = Date.parse(user.wikibidous_at || '');
  const fresh = body && body.force === true ? BALANCE_FORCE_MS : BALANCE_FRESH_MS;
  if (at && Date.now() - at < fresh) return { wikibidous: stored(user), read: false };

  const lease = await acquireLease(db, user.id, LEASE_MS);
  try {
    const now = await db.prepare('SELECT game_session_enc, game_session_v, game_session_lost, game_uid FROM users WHERE id = ?1').bind(user.id).first();
    const u = { ...user, ...now };
    const s = await sessionOf(env, u);
    if (lease) await freshAuth(env, u, s);
    else if ((Number(s.auth.expires_at) || 0) * 1000 - Date.now() < REFRESH_MARGIN_MS) return { wikibidous: stored(user), read: false };
    const n = await readBalance(env, u, s, { retry: !!lease });
    if (n === null) return { wikibidous: stored(user), read: false };
    const st = balanceStatement(db, user.id, n);
    await st.run();
    return { wikibidous: { n, at: new Date().toISOString() }, read: true };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, "Le solde n'a pas pu être relu : réessaie dans un moment.");
  } finally {
    if (lease) await releaseLease(db, user.id, lease).run().catch((err) => console.error(err));
  }
}
