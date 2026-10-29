// Classements calculés côté serveur : aucune clé ni aucun identifiant interne dans la réponse.
import { HttpError } from './http.js';
import { inList, supaGet } from './game.js';
import { nowIso } from './util.js';

// Ne compter que les échanges créés depuis le classeur et confirmés par le jeu.
// Les lignes terminales restent pour dédupliquer les relectures, même après une purge du jeu.
export async function syncTradeAwards(env, user, session) {
  const { results: pending } = await env.DB.prepare(`SELECT id FROM award_trades
    WHERE (user_id = ?1 OR recipient_id = ?1) AND status = 'pending'
    ORDER BY checked_at IS NOT NULL, checked_at, created_at LIMIT 100`).bind(user.id).all();
  if (!pending.length) return;
  const { rows } = await supaGet(env, user, session,
    `trades?select=id,status&id=in.${inList(pending.map((r) => r.id))}&limit=100`);
  const terminal = new Map(rows.filter((r) => ['accepted', 'completed', 'cancelled', 'canceled', 'rejected', 'declined', 'expired'].includes(r.status))
    .map((r) => [r.id, r.status]));
  await env.DB.batch(pending.map((r) => env.DB.prepare(
    "UPDATE award_trades SET status = ?2, checked_at = ?3 WHERE id = ?1 AND status = 'pending'",
  ).bind(r.id, terminal.get(r.id) || 'pending', nowIso())));
}

const norm = (s) => String(s || '').normalize('NFC').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase('fr');
const parse = (s, fallback) => { try { return JSON.parse(s) ?? fallback; } catch { return fallback; } };

// Listes de rangement : les préfixes permettent aussi « À vendre - doublons ».
// Comparaison sans accents, casse, emoji ou séparateurs ; pas de sous-chaîne dans un nom thématique.
function storageCollection(name) {
  const key = String(name || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
  return /^(?:lock market|a vendre)(?: |$)/.test(key) || /^(?:autre|autres)$/.test(key);
}

export async function getPalmares(env, user) {
  if (!user.shared || !user.public_id) throw new HttpError(403, 'Active le partage entre membres dans Réglages pour participer au palmarès.');
  const db = env.DB;
  const [members, cards, targets, trades] = await db.batch([
    db.prepare(`SELECT id, public_id, name, game_pseudo, shared_targets, chat_sent FROM users WHERE shared = 1 AND public_id IS NOT NULL`),
    // Écarter images, descriptions et tags : seuls les titres et variantes servent au calcul.
    db.prepare(`SELECT c.user_id, json_object('title', json_extract(c.data, '$.title'),
      'rarity', json_extract(c.data, '$.rarity'), 'count', json_extract(c.data, '$.count'),
      'shiny', json_extract(c.data, '$.shiny'), 'variants', json_extract(c.data, '$.variants')) AS data,
      p.data AS prices FROM cards c JOIN users u ON u.id = c.user_id
      LEFT JOIN prices p ON p.card_id = c.card_id WHERE u.shared = 1 AND u.public_id IS NOT NULL`),
    db.prepare(`SELECT t.user_id, t.name, json_group_array(json_object('title', json_extract(i.value, '$.title'))) AS items
      FROM targets t JOIN users u ON u.id = t.user_id, json_each(t.items) i
      WHERE u.shared = 1 AND u.public_id IS NOT NULL AND u.shared_targets = 1
        AND i.type = 'object' AND COALESCE(json_extract(i.value, '$.status'), 'ok') = 'ok'
      GROUP BY t.user_id, t.id`),
    db.prepare(`SELECT user_id, recipient_id, given, received FROM award_trades WHERE status IN ('accepted', 'completed')`),
  ]);
  const stats = new Map(members.results.map((m) => [m.id, { member: { id: m.public_id, name: m.name || m.game_pseudo || 'Un membre', mine: m.id === user.id },
    titles: new Set(), sharedTargets: !!m.shared_targets, completed: 0, near: 0, value: 0, card: null, traded: 0, chat: m.chat_sent }]));
  for (const row of cards.results) {
    const s = stats.get(row.user_id);
    const c = parse(row.data, {});
    s.titles.add(norm(c.title));
    const prices = parse(row.prices, {});
    const variants = c.variants || { [c.rarity]: Math.max(0, (c.count || 1) - (c.shiny ? 1 : 0)), ...(c.shiny ? { [c.rarity + '*']: 1 } : {}) };
    for (const [variant, count] of Object.entries(variants)) {
      const p = prices[variant];
      if (count > 0 && p && p.n >= 3 && Number.isFinite(p.p) && p.p > s.value) {
        s.value = p.p;
        s.card = { title: c.title, variant };
      }
    }
  }
  for (const row of targets.results) {
    if (storageCollection(row.name)) continue;
    const s = stats.get(row.user_id);
    const items = new Set(parse(row.items, []).filter((i) => i && (!i.status || i.status === 'ok') && i.title).map((i) => norm(i.title)));
    if (!items.size) continue;
    let own = 0;
    for (const title of items) if (s.titles.has(title)) own++;
    if (own === items.size) s.completed++;
    else if (own / items.size >= 0.9) s.near++;
  }
  for (const t of trades.results) {
    // Le partageur est celui qui donne la carte ; un même échange crédite les deux côtés selon leurs dons.
    if (stats.has(t.user_id)) stats.get(t.user_id).traded += t.given;
    if (stats.has(t.recipient_id)) stats.get(t.recipient_id).traded += t.received;
  }
  const board = (key, collections = false) => {
    const sorted = [...stats.values()].filter((s) => (!collections || s.sharedTargets) && s[key] > 0)
      .sort((a, b) => b[key] - a[key] || a.member.id.localeCompare(b.member.id));
    return sorted.slice(0, 3).map((s) => ({ ...s.member, score: s[key], rank: sorted.findIndex((x) => x[key] === s[key]) + 1,
      ...(key === 'value' ? { card: s.card } : {}) }));
  };
  return { updated_at: nowIso(), categories: [
    { id: 'completed', entries: board('completed', true) }, { id: 'value', entries: board('value') },
    { id: 'traded', entries: board('traded') }, { id: 'near', entries: board('near', true) }, { id: 'chat', entries: board('chat') },
  ] };
}
