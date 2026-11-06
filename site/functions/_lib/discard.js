// Défausse explicite : aperçu enregistré, puis un seul envoi au jeu par lot.
// Contrat fourni par le joueur : POST /api/user-cards/bulk-discard {card_ids: [user_card_id]}.
import { HttpError } from './http.js';
import { acquireLease, releaseLease, freshAuth, sessionOf, supaGet, inList } from './game.js';
import { gameFetch, GAME_ORIGIN, pendingTradeCards, pendingSince } from './trades.js';
import { readCollection } from './refresh.js';

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const VARIANT = /^(C|PC|R|SR|UR|L)\*?$/;
const MAX_CARDS = 2000;
const BATCH = 50;
const TTL = 10 * 60_000;
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const fail = (s) => { throw new HttpError(409, s); };
const uncertain = 'Résultat de la défausse incertain : vérifie ta collection dans le jeu avant toute nouvelle sélection. Ce lot ne sera pas renvoyé.';

export function lowQuote(q) {
  return !!q && Number(q.n) >= 3 && q.p != null && Number.isFinite(Number(q.p)) && Number(q.p) >= 0 && Number(q.p) < 5;
}

async function withSession(env, user, run) {
  const lease = await acquireLease(env.DB, user.id, 120_000);
  if (!lease) fail('Une action sur ton compte du jeu est en cours : réessaie dans un instant.');
  try {
    const now = await env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(user.id).first();
    const s = await sessionOf(env, now);
    if (!s.uid) fail('Relie à nouveau ton compte du jeu.');
    s.via = 'clic';
    await freshAuth(env, now, s);
    return await run(s, now);
  } finally {
    await releaseLease(env.DB, user.id, lease).run();
  }
}

async function liveCopies(env, user, s, ids) {
  const rows = [];
  for (let i = 0; i < ids.length; i += 100) {
    const part = await supaGet(env, user, s,
      `user_cards?select=id,card_id,count,starred,is_shiny,snapshot_rarity,card:cards(rarity)&user_id=eq.${encodeURIComponent(s.uid)}&card_id=in.${inList(ids.slice(i, i + 100))}&limit=1000`);
    if (part.rows.length >= 1000) fail('Trop d’exemplaires : réduis ta sélection.');
    rows.push(...part.rows);
  }
  return rows.map(r => ({ id: r.id, card: r.card_id, count: r.count,
    starred: r.starred, k: (r.snapshot_rarity || r.card?.rarity || '') + (r.is_shiny ? '*' : '') }));
}

async function checkCards(env, user, ids, copies) {
  const db = env.DB;
  const prefs = parse(user.prefs) || {};
  const keep = prefs.keep || {};
  const pending = await db.prepare(`SELECT (${pendingTradeCards('?1')}) AS ids`).bind(user.id, pendingSince()).first();
  const blocked = new Set([...(Array.isArray(keep.cards) ? keep.cards : []), ...(parse(pending?.ids) || [])]);
  const keptTags = new Set(Array.isArray(keep.tags) ? keep.tags : []);
  const rows = (await db.prepare(`SELECT c.card_id, c.data, p.data AS quote,
    (SELECT json_group_array(t.tag) FROM tags t WHERE t.user_id = c.user_id AND t.card_id = c.card_id) AS tags
    FROM cards c LEFT JOIN prices p ON p.card_id = c.card_id
    WHERE c.user_id = ?1 AND c.card_id IN (SELECT value FROM json_each(?2))`).bind(user.id, JSON.stringify(ids)).all()).results;
  const cards = new Map(rows.map(r => [r.card_id, r]));
  for (const id of ids) {
    const row = cards.get(id), card = parse(row?.data), quotes = parse(row?.quote);
    if (!card || blocked.has(id) || (parse(row?.tags) || []).some(t => keptTags.has(t))) fail('Une carte est absente, exclue ou en attente d’échange. Retire-la de la sélection.');
    const owned = copies.filter(c => c.card === id);
    if (!owned.length || owned.some(c => !ID.test(c.id) || !Number.isSafeInteger(c.count) || c.count < 1
      || c.starred !== false || !VARIANT.test(c.k) || !lowQuote(quotes?.[c.k]))) {
      fail('Une carte est favorite, absente ou ne possède plus une cote fiable sous 5 W pour chacun de ses exemplaires. Refais la sélection.');
    }
  }
  return cards;
}

export async function previewDiscard(env, user, body) {
  if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > MAX_CARDS || body.ids.some(id => typeof id !== 'string' || !ID.test(id))) {
    throw new HttpError(400, `Sélectionne de 1 à ${MAX_CARDS} cartes à la fois.`);
  }
  const ids = [...new Set(body.ids)];
  return withSession(env, user, async (s, now) => {
    const copies = await liveCopies(env, now, s, ids);
    const cards = await checkCards(env, now, ids, copies);
    const batches = [];
    const at = new Date().toISOString();
    // Les lots terminés sont conservés pour empêcher de rejouer une écriture après une perte de connexion.
    await env.DB.prepare("DELETE FROM discard_batches WHERE user_id = ?1 AND status = 'ready' AND created_at < ?2")
      .bind(user.id, new Date(Date.now() - TTL).toISOString()).run();
    for (let i = 0; i < copies.length; i += BATCH) {
      const id = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO discard_batches (id, user_id, plan, status, created_at) VALUES (?1, ?2, ?3, \'ready\', ?4)')
        .bind(id, user.id, JSON.stringify(copies.slice(i, i + BATCH)), at).run();
      batches.push(id);
    }
    return { batches, cards: ids.map(id => ({ id, title: parse(cards.get(id).data).title,
      count: copies.filter(c => c.card === id).reduce((n, c) => n + c.count, 0) })),
      copies: copies.reduce((n, c) => n + c.count, 0) };
  });
}

async function batchOf(env, user, id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new HttpError(400, 'Lot de défausse invalide.');
  const row = await env.DB.prepare('SELECT * FROM discard_batches WHERE id = ?1 AND user_id = ?2').bind(id, user.id).first();
  if (!row) throw new HttpError(404, 'Lot de défausse introuvable.');
  return row;
}

export async function executeDiscard(env, user, body) {
  return withSession(env, user, async (s, now) => {
    const batch = await batchOf(env, now, body.batch);
    if (batch.status === 'done') return parse(batch.result);
    if (batch.status !== 'ready') fail(uncertain);
    if (Date.now() - Date.parse(batch.created_at) > TTL) fail('Cet aperçu a expiré. Refais ta sélection.');
    const plan = parse(batch.plan);
    const ids = [...new Set(plan.map(c => c.card))];
    const copies = await liveCopies(env, now, s, ids);
    await checkCards(env, now, ids, copies);
    for (const p of plan) {
      const c = copies.find(c => c.id === p.id);
      if (!c || c.card !== p.card || c.count !== p.count || c.k !== p.k) fail('Les exemplaires ont changé depuis la confirmation. Refais la sélection.');
    }
    const claimed = await env.DB.prepare("UPDATE discard_batches SET status = 'sent' WHERE id = ?1 AND user_id = ?2 AND status = 'ready' RETURNING id")
      .bind(batch.id, now.id).first();
    if (!claimed) fail(uncertain);
    // Aucune relance automatique : même un délai réseau peut masquer une défausse réussie.
    let res;
    try {
      res = await gameFetch(env, now, s, '/api/user-cards/bulk-discard', { method: 'POST',
        headers: { 'content-type': 'application/json', referer: GAME_ORIGIN + '/collection' },
        body: JSON.stringify({ card_ids: plan.map(c => c.id) }), signal: AbortSignal.timeout(30_000) });
    } catch { fail(uncertain); }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const said = typeof data?.error === 'string' ? data.error.slice(0, 250) : `HTTP ${res.status}`;
      throw new HttpError(res.status === 429 ? 429 : 409, `Défausse interrompue : ${said}. Vérifie dans le jeu avant de recommencer.`, { uncertain: true });
    }
    let after;
    try { after = await liveCopies(env, now, s, ids); } catch { fail(uncertain); }
    let discarded = 0;
    for (const p of plan) {
      const c = after.find(c => c.id === p.id);
      if (c && (!Number.isSafeInteger(c.count) || c.count < 0 || c.count > p.count)) fail(uncertain);
      discarded += p.count - (c?.count || 0);
    }
    const result = { discarded, requested: plan.reduce((n, c) => n + c.count, 0) };
    await env.DB.prepare("UPDATE discard_batches SET status = 'done', result = ?2 WHERE id = ?1 AND user_id = ?3")
      .bind(batch.id, JSON.stringify(result), now.id).run();
    return result;
  });
}

export async function syncAfterDiscard(env, user, body) {
  const batch = await batchOf(env, user, body.batch);
  if (batch.status === 'ready') fail('Ce lot n’a pas encore été envoyé.');
  return readCollection(env, user, { via: 'clic', force: true, allowEmpty: true });
}
