// Auto-favoris : un exemplaire possédé par carte, uniquement des ajouts.
// API relevée dans le code public de la Collection WikiMasters le 2026-10-26 :
// from('user_cards').update({starred:true}).eq('user_id', uid).in('id', ids).
import { supaWrite, inList, lots } from './game.js';
import { nowIso } from './util.js';

export const FAVORITE_BATCH = 100;
export const FAVORITE_MAX_WRITES = 5;
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const key = s => String(s || '').replace(/_/g, ' ').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().normalize('NFC');
const parse = s => { try { return JSON.parse(s || 'null'); } catch { return null; } };
export const hasAutoFavorites = async (db, uid) => !!await db.prepare('SELECT 1 FROM targets WHERE user_id = ?1 AND auto_favorite = 1 LIMIT 1').bind(uid).first();
export const autoFavoriteLinks = async (db, uid) => (await db.prepare(`SELECT id, items, updated_at, auto_tag, auto_tag_id
  FROM targets WHERE user_id = ?1 AND auto_favorite = 1 ORDER BY id`).bind(uid).all()).results;

export async function syncAutoFavorites(env, user, session, rows, links, { maxWrites = FAVORITE_MAX_WRITES, gap = 1000 } = {}) {
  const db = env.DB;
  const out = { added: 0, left: 0, changed: false };
  const states = new Map(links.map(t => [t.id, { at: nowIso(), added: 0, left: 0 }]));
  const plans = new Map();
  try {
    const cards = new Map(), byTitle = new Map();
    for (const row of rows) {
      if (row.user_id !== session.uid || !ID.test(String(row.id)) || !ID.test(String(row.card_id))
        || !row.card || typeof row.card.wikipedia_title !== 'string'
        || (typeof row.starred !== 'boolean' && row.starred !== null)) {
        throw new Error('Lecture incomplète des exemplaires : auto-favoris reporté.');
      }
      if (!cards.has(row.card_id)) cards.set(row.card_id, []);
      cards.get(row.card_id).push(row);
      byTitle.set(key(row.card.wikipedia_title), row.card_id);
    }
    for (const link of links) {
      const items = parse(link.items) || [];
      const cached = (await db.prepare(`SELECT title, card_id FROM game_titles WHERE title IN
        (SELECT json_extract(value, '$.title') FROM json_each(?1))`).bind(link.items).all()).results;
      const aliases = new Map(cached.map(r => [key(r.title), r.card_id]));
      const desired = new Set(items.filter(it => it && (!it.status || it.status === 'ok'))
        .map(it => byTitle.get(key(it.title)) || aliases.get(key(it.title))).filter(id => cards.has(id)));
      const config = parse(link.auto_tag);
      for (const id of desired) {
        const copies = cards.get(id);
        if (copies.some(r => r.starred)) continue;
        let plan = plans.get(id);
        if (!plan) { plan = { copies, links: [], tags: new Set() }; plans.set(id, plan); }
        plan.links.push(link.id);
        if (config && config.enabled && link.auto_tag_id) plan.tags.add(link.auto_tag_id);
        states.get(link.id).left++;
      }
    }
    // Préférer le même exemplaire que l'auto-tag, puis borner aussi la longueur des URL PostgREST.
    const copies = new Map([...plans.values()].map(plan => {
      const tagged = r => Array.isArray(r.tags) && r.tags.some(t => t && t.tag && plan.tags.has(t.tag.id));
      const copy = plan.copies.slice().sort((a, b) => Number(tagged(b)) - Number(tagged(a)) || a.id.localeCompare(b.id))[0];
      return [copy.id, { plan, copy }];
    }));
    let writes = 0;
    for (const ids of lots([...copies.keys()], FAVORITE_BATCH)) {
      if (writes >= maxWrites) break;
      const current = (await db.prepare('SELECT id, items, updated_at FROM targets WHERE user_id = ?1 AND auto_favorite = 1 ORDER BY id').bind(user.id).all()).results;
      if (current.length !== links.length || current.some((t, i) => t.id !== links[i].id || t.updated_at !== links[i].updated_at || t.items !== links[i].items)) {
        throw new Error('Collections modifiées pendant l’auto-favoris : reprise à la prochaine synchro.');
      }
      await supaWrite(env, user, session, 'PATCH', `user_cards?user_id=eq.${encodeURIComponent(session.uid)}&id=in.${inList(ids)}`,
        { starred: true }, { gap: writes++ ? gap : 0 });
      for (const id of ids) {
        const { copy, plan } = copies.get(id);
        copy.starred = true;
        out.added++;
        for (const linkId of plan.links) { const st = states.get(linkId); st.added++; st.left--; }
      }
      out.changed = true;
    }
  } catch (err) {
    out.error = String(err.message || err).slice(0, 300);
    if (err.extra && err.extra.limited) out.limited = true;
  }
  out.left = plans.size - out.added;
  if (links.length) await db.batch(links.map(t => {
    const st = states.get(t.id);
    if (out.error && (st.left || !plans.size)) st.error = out.error;
    return db.prepare(`UPDATE targets SET auto_favorite_state = ?3
      WHERE user_id = ?1 AND id = ?2 AND auto_favorite = 1 AND updated_at = ?4 AND items = ?5`)
      .bind(user.id, t.id, JSON.stringify(st), t.updated_at, t.items);
  }));
  return out;
}
