// Aucun appel au vrai jeu : propriété des exemplaires, seuil, confirmation et écritures non rejouables.
import assert from 'node:assert/strict';
import { createD1 } from './d1.mjs';
import { mockSupabase, rowOf, GAME } from './supabase.mjs';
import { onRequest } from '../site/functions/api/[[path]].js';

const env = { DB: createD1(':memory:'), COOKIE_SECRET: 'test-only', SIGNUP_CODE: 'test', REFRESH_PAUSE_MS: '0' };
const supa = mockSupabase();
const simulated = globalThis.fetch;
let posts = [], mode = 'ok';
const player = supa.addPlayer('owner');
globalThis.fetch = async (url, init = {}) => {
  if (String(url) === GAME + '/api/user-cards/bulk-discard') {
    assert.equal(init.method, 'POST');
    assert.ok(new Headers(init.headers).get('cookie'));
    const ids = JSON.parse(init.body).card_ids;
    assert.ok(ids.every(id => player.cards.some(c => c.id === id)), 'identifiants d’exemplaires possédés');
    posts.push(ids);
    if (mode === 'network') throw new Error('connection lost');
    if (mode === 'rate') return Response.json({ error: 'Ralentis' }, { status: 429 });
    if (mode !== 'partial') player.cards = player.cards.filter(c => !ids.includes(c.id));
    return Response.json({ ok: true });
  }
  return simulated(url, init);
};
async function call(route, body = {}, key) {
  const res = await onRequest({ env, request: new Request('https://local/api/' + route, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'x-classeur-key': key } : {}) }, body: JSON.stringify(body),
  }) });
  return { status: res.status, data: await res.json() };
}
try {
  const a = await call('account', { code: 'test', name: 'Test discard' });
  assert.equal(a.status, 201);
  const key = a.data.key, uid = a.data.user.id;
  assert.equal((await call('session', { cookie: supa.sessionCookie({ uid: 'owner' }) }, key)).status, 200);
  function seed({ count = 2, starred = false, price = 4, n = 3, high = false } = {}) {
    player.cards = [rowOf({ id: 'card-a', title: 'Carte A', rarity: 'C', count, starred }, { uid: 'owner', eid: 'copy-a' })];
    if (high) player.cards.push(rowOf({ id: 'card-a', title: 'Carte A', rarity: 'R', count: 1 }, { uid: 'owner', eid: 'copy-r' }));
    env.DB.sqlite.prepare('UPDATE users SET prefs = ?, sync_lock = NULL WHERE id = ?').run('{}', uid);
    env.DB.sqlite.prepare('INSERT OR REPLACE INTO cards (user_id, card_id, data, rev) VALUES (?, ?, ?, 1)')
      .run(uid, 'card-a', JSON.stringify({ id: 'card-a', title: 'Carte A', rarity: 'C', count, tags: [] }));
    env.DB.sqlite.prepare('INSERT OR REPLACE INTO prices (card_id, data, read_at) VALUES (?, ?, ?)')
      .run('card-a', JSON.stringify({ C: { p: price, n }, ...(high ? { R: { p: 20, n: 3 } } : {}) }), new Date().toISOString());
    mode = 'ok';
  }
  const preview = () => call('cards/discard/preview', { ids: ['card-a'] }, key);
  const execute = batch => call('cards/discard', { batch }, key);
  seed();
  assert.equal((await call('cards/discard/preview', { ids: ['card-a'] })).status, 401);
  assert.equal((await call('cards/discard/preview', { ids: [] }, key)).status, 400);
  assert.equal((await call('cards/discard/preview', { ids: ['other-card'] }, key)).status, 409);
  let p = await preview();
  assert.equal(p.status, 200, JSON.stringify(p));
  assert.equal(p.data.copies, 2);
  assert.equal(posts.length, 0, 'un aperçu ne défausse rien');
  let r = await execute(p.data.batches[0]);
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual(r.data, { discarded: 2, requested: 2 });
  assert.deepEqual(posts[0], ['copy-a'], 'jamais le card_id de la carte');
  assert.deepEqual(await execute(p.data.batches[0]), r);
  assert.equal(posts.length, 1, 'un lot terminé ne repart pas');
  r = await call('cards/discard/sync', { batch: p.data.batches[0] }, key);
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM cards WHERE user_id = ?').get(uid).n, 0, 'collection entièrement vidée : le classeur est aussi vidé');
  for (const options of [{ price: 5 }, { n: 2 }, { starred: true }, { high: true }, { price: null }]) {
    seed(options);
    assert.equal((await preview()).status, 409, JSON.stringify(options));
  }
  seed();
  env.DB.sqlite.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify({ keep: { cards: ['card-a'] } }), uid);
  assert.equal((await preview()).status, 409);
  seed();
  env.DB.sqlite.prepare('INSERT INTO tags (user_id, card_id, tag) VALUES (?, ?, ?)').run(uid, 'card-a', 'À garder');
  env.DB.sqlite.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify({ keep: { tags: ['À garder'] } }), uid);
  assert.equal((await preview()).status, 409, 'exclusion par tag rangé dans la table tags');
  seed();
  env.DB.sqlite.prepare('INSERT INTO award_trades (id, user_id, recipient_id, given, received, created_at, give_ids, get_ids) VALUES (?, ?, ?, 1, 0, ?, ?, ?)')
    .run('pending-discard', uid, 'friend', new Date().toISOString(), JSON.stringify(['card-a']), '[]');
  assert.equal((await preview()).status, 409, 'échange en attente');
  env.DB.sqlite.prepare('DELETE FROM award_trades WHERE id = ?').run('pending-discard');
  seed(); p = await preview(); player.cards[0].count++;
  assert.equal((await execute(p.data.batches[0])).status, 409, 'quantité changée depuis l’aperçu');
  seed(); p = await preview(); player.cards[0].starred = true;
  assert.equal((await execute(p.data.batches[0])).status, 409, 'favori ajouté depuis l’aperçu');
  seed(); p = await preview();
  env.DB.sqlite.prepare('UPDATE prices SET data = ? WHERE card_id = ?').run(JSON.stringify({ C: { p: 8, n: 3 } }), 'card-a');
  assert.equal((await execute(p.data.batches[0])).status, 409, 'cote changée depuis l’aperçu');
  seed(); p = await preview();
  env.DB.sqlite.prepare('UPDATE discard_batches SET created_at = ? WHERE id = ?').run('2020-01-01T00:00:00Z', p.data.batches[0]);
  assert.equal((await execute(p.data.batches[0])).status, 409, 'aperçu expiré');
  for (const failure of ['network', 'rate']) {
    seed(); p = await preview(); mode = failure;
    const before = posts.length;
    assert.notEqual((await execute(p.data.batches[0])).status, 200);
    assert.equal((await execute(p.data.batches[0])).status, 409);
    assert.equal(posts.length, before + 1, 'aucune relance après un résultat incertain');
  }
  seed(); p = await preview(); mode = 'partial';
  r = await execute(p.data.batches[0]);
  assert.deepEqual(r.data, { discarded: 0, requested: 2 }, 'compte vérifié dans le jeu, pas déduit du HTTP 200');
  seed();
  player.cards = Array.from({ length: 51 }, (_, i) => rowOf({ id: 'card-a', title: 'Carte A', rarity: 'C', count: 1 }, { uid: 'owner', eid: 'copy-' + i }));
  p = await preview();
  assert.equal(p.data.batches.length, 2, 'sélection répartie en lots de 50');
  assert.equal((await execute(p.data.batches[0])).data.discarded, 50);
  assert.equal((await execute(p.data.batches[1])).data.discarded, 1);
  seed(); p = await preview();
  const b = await call('account', { code: 'test', name: 'Autre compte' });
  assert.equal((await call('cards/discard/sync', { batch: p.data.batches[0] }, b.data.key)).status, 404);
  assert.equal((await call('cards/discard/sync', { batch: p.data.batches[0] }, key)).status, 409);
  const res = await onRequest({ env, request: new Request('https://local/api/me', { method: 'DELETE', headers: { 'x-classeur-key': key } }) });
  assert.equal(res.status, 200);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM discard_batches WHERE user_id = ?').get(uid).n, 0);
  console.log('DISCARD OK : aperçu, propriété, seuil, variantes, favoris, exclusions, changements, expiration, isolation, résultat partiel et anti-rejeu.');
} finally { supa.restore(); env.DB.close(); }
