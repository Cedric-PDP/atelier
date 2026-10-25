// Synchronisation collection ↔ tag du jeu, sous le bail de readCollection et sur une lecture complète vérifiée.
// POST/DELETE user_card_tags : requêtes relevées par l'utilisateur le 2026-10-25. Aucun tag créé, un exemplaire suffit.
import { HttpError } from './http.js';
import { supaWrite } from './game.js';
import { updateWishWork } from './targets.js';
import { nowIso, byteLength } from './util.js';

export const AUTO_TAG_MAX_WRITES = 30;
export const AUTO_TAG_ROUTE = { known: true };
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const key = (s) => String(s || '').replace(/_/g, ' ').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().normalize('NFC');
const parse = (s, fallback) => { try { return JSON.parse(s || 'null') || fallback; } catch { return fallback; } };
export const autoTagLinks = async (db, userId) => (await db.prepare(`SELECT id, name, items, auto, auto_tag, auto_tag_id,
  auto_tag_baseline, updated_at FROM targets WHERE user_id = ?1 AND json_extract(auto_tag, '$.enabled') = 1 ORDER BY id`)
  .bind(userId).all()).results;

// rows restent la lecture originale des exemplaires : seules les écritures confirmées modifient leurs tags en mémoire.
// refresh.js remet ces pages en attente avant l'import : le navigateur reçoit les vrais tags après la même synchro.
export async function syncAutoTags(env, user, session, rows, links, { maxWrites = AUTO_TAG_MAX_WRITES, gap = 1000 } = {}) {
  const db = env.DB;
  const out = { added: 0, removed: 0, cards_added: 0, cards_removed: 0, left: 0, changed: false };
  if (!AUTO_TAG_ROUTE.known) return { ...out, error: "L'API des tags du jeu doit être vérifiée avant de reprendre l'auto-tag." };
  const cards = new Map();
  for (const row of rows) {
    if (row.user_id !== session.uid || !ID.test(String(row.id)) || !ID.test(String(row.card_id))
      || !row.card || typeof row.card.wikipedia_title !== 'string' || !Array.isArray(row.tags)
      || !row.tags.every(t => t && t.tag && typeof t.tag.id === 'string' && ID.test(t.tag.id) && typeof t.tag.name === 'string')) {
      return { ...out, error: 'Lecture incomplète des exemplaires ou des tags : aucun auto-tag effectué.' };
    }
    let c = cards.get(row.card_id);
    if (!c) { c = { id: row.card_id, title: row.card.wikipedia_title, copies: [], category: row.card.category || null }; cards.set(c.id, c); }
    c.copies.push(row);
  }
  const knownTags = rows.flatMap(r => r.tags.map(t => t && t.tag).filter(Boolean));
  let writes = 0;
  for (const link of links) {
    const config = parse(link.auto_tag, {});
    const state = { at: nowIso(), added: 0, removed: 0, cards_added: 0, cards_removed: 0, left: 0 };
    const previous = parse(link.auto_tag_baseline, {});
    const next = Object.assign(Object.create(null), previous);
    let stamp = link.updated_at;
    let tagId = link.auto_tag_id;
    try {
      const named = knownTags.find(t => tagId && String(t.id) === tagId)
        || knownTags.find(t => typeof t.name === 'string' && t.name.toLowerCase() === config.key);
      if (!tagId) tagId = named && named.id;
      if (!tagId || !ID.test(tagId)) throw new HttpError(409, `Tag « ${config.tag} » introuvable : pose-le sur une carte dans le jeu puis relance la synchro.`);
      const duplicate = await db.prepare(`SELECT id FROM targets WHERE user_id = ?1 AND id <> ?2
        AND auto_tag_id = ?3 AND json_extract(auto_tag, '$.enabled') = 1`).bind(user.id, link.id, tagId).first();
      if (duplicate) throw new HttpError(409, 'Ce tag du jeu est déjà lié à une autre collection (son nom a peut-être changé).');
      const items = JSON.parse(link.items);
      const index = new Map();
      const cached = (await db.prepare('SELECT title, card_id FROM game_titles WHERE title IN (SELECT json_extract(value, \'$.title\') FROM json_each(?1))')
        .bind(link.items).all()).results;
      const aliases = new Map(cached.map(r => [key(r.title), r.card_id]));
      const byTitle = new Map([...cards.values()].map(c => [key(c.title), c.id]));
      for (const it of items) {
        const id = byTitle.get(key(it.title)) || aliases.get(key(it.title));
        if (id) { if (!index.has(id)) index.set(id, []); index.get(id).push(it); }
      }
      const plans = [];
      const remove = new Set();
      const add = [];
      // Parcourir uniquement les cartes encore possédées : la disparition du dernier exemplaire (vente/échange)
      // conserve l'élément de l'album. L'import retire sa possession et l'interface le montre « non obtenu ».
      for (const c of cards.values()) {
        const mine = index.get(c.id) || [];
        const inside = mine.length > 0;
        const tagged = c.copies.filter(r => r.tags.some(t => t && t.tag && String(t.tag.id) === tagId));
        const prev = Object.hasOwn(previous, c.id) ? previous[c.id] : null;
        // Suppression de l'exemplaire tagué (vente/échange) ≠ retrait de son tag : taguer l'exemplaire restant.
        const tagRemoved = prev && !tagged.length && (prev.tagged || []).some(id => c.copies.some(r => r.id === id));
        const desired = prev ? inside && !tagRemoved : inside || tagged.length > 0;
        if (!desired && inside) for (const it of mine) remove.add(it);
        if (desired && !inside) add.push({ title: c.title, description: c.category, image: null, status: 'ok' });
        if (prev || desired || tagged.length) plans.push({ c, desired, tagged });
      }
      const updated = [...items.filter(it => !remove.has(it)), ...add];
      if (remove.size || add.length) {
        const json = JSON.stringify(updated);
        if (byteLength(json) > 1_700_000) throw new HttpError(400, 'Auto-tag : collection trop volumineuse (1,7 Mo).');
        const time = new Date(Math.max(Date.now(), Date.parse(stamp) + 1 || 0)).toISOString();
        const saved = await db.prepare(`UPDATE targets SET items = ?3, updated_at = ?4 WHERE user_id = ?1 AND id = ?2
          AND updated_at = ?5 AND auto_tag = ?6 AND
          (SELECT COALESCE(SUM(length(CAST(items AS BLOB)) + COALESCE(length(CAST(auto AS BLOB)), 0)), 0) FROM targets WHERE user_id = ?1)
          - length(CAST(items AS BLOB)) + length(CAST(?3 AS BLOB)) <= 5242880 RETURNING id`)
          .bind(user.id, link.id, json, time, stamp, link.auto_tag).first();
        if (!saved) throw new HttpError(409, 'Collection modifiée pendant la synchro ou quota atteint : auto-tag à reprendre à la prochaine synchro.');
        stamp = time;
        state.cards_added = add.length; state.cards_removed = remove.size;
        await updateWishWork(db, user.id);
      }
      for (const id of Object.keys(next)) if (!cards.has(id)) delete next[id];
      // Intention durable avant tout POST : une suppression locale pendant l'écriture sera reconnue au prochain passage,
      // même si la sauvegarde finale est refusée car updated_at a changé.
      for (const { c, desired, tagged } of plans) if (desired) next[c.id] = { tagged: tagged.map(r => r.id) };
      const intentText = JSON.stringify(next);
      const growth = plans.filter(p => p.desired && !p.tagged.length).length * 110;
      if (byteLength(JSON.stringify(updated)) + byteLength(link.auto || '') + byteLength(intentText) + growth > 1_950_000) {
        throw new HttpError(400, 'Collection trop volumineuse pour mémoriser son auto-tag : réduis sa taille avant de réessayer.');
      }
      const intent = await db.prepare(`UPDATE targets SET auto_tag_id = ?3, auto_tag_baseline = ?4
        WHERE user_id = ?1 AND id = ?2 AND updated_at = ?5 AND auto_tag = ?6 RETURNING id`)
        .bind(user.id, link.id, tagId, intentText, stamp, link.auto_tag).first();
      if (!intent) throw new HttpError(409, 'Collection modifiée pendant l’auto-tag : reprise à la prochaine synchro.');
      for (const plan of plans) {
        const { c, desired, tagged } = plan;
        const operations = desired && !tagged.length ? [{ method: 'POST', row: c.copies.slice().sort((a, b) => a.id.localeCompare(b.id))[0] }]
          : !desired ? tagged.map(row => ({ method: 'DELETE', row })) : [];
        let completed = true;
        for (const op of operations) {
          if (writes >= maxWrites) { state.left++; completed = false; continue; }
          const current = await db.prepare('SELECT id FROM targets WHERE user_id = ?1 AND id = ?2 AND updated_at = ?3 AND auto_tag = ?4')
            .bind(user.id, link.id, stamp, link.auto_tag).first();
          if (!current) throw new HttpError(409, 'Collection modifiée pendant l’auto-tag : reprise à la prochaine synchro.');
          const path = op.method === 'POST' ? 'user_card_tags'
            : `user_card_tags?user_card_id=eq.${encodeURIComponent(op.row.id)}&tag_id=eq.${encodeURIComponent(tagId)}`;
          await supaWrite(env, user, session, op.method, path,
            op.method === 'POST' ? { user_card_id: op.row.id, tag_id: tagId } : null, { gap: writes++ ? gap : 0 });
          if (op.method === 'POST') { op.row.tags.push({ tag: { id: tagId, name: named ? named.name : config.tag, color: named ? named.color : null } }); state.added++; }
          else { op.row.tags = op.row.tags.filter(t => !t || !t.tag || String(t.tag.id) !== tagId); state.removed++; }
          out.changed = true;
        }
        if (completed) {
          if (desired) next[c.id] = { tagged: c.copies.filter(r => r.tags.some(t => t && t.tag && String(t.tag.id) === tagId)).map(r => r.id) };
          else delete next[c.id];
        }
      }
    } catch (err) {
      state.error = String(err.message || err).slice(0, 300);
      out.error = state.error;
      if (err.extra && err.extra.limited) out.limited = true;
    }
    await db.prepare(`UPDATE targets SET auto_tag_id = ?3, auto_tag_baseline = ?4, auto_tag_state = ?5
      WHERE user_id = ?1 AND id = ?2 AND auto_tag = ?6 AND updated_at = ?7`)
      .bind(user.id, link.id, tagId || null, JSON.stringify(next), JSON.stringify(state), link.auto_tag, stamp).run();
    for (const k of ['added', 'removed', 'cards_added', 'cards_removed', 'left']) out[k] += state[k];
    if (out.error) break;
  }
  return out;
}
