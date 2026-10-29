// node dev/palmares.test.mjs : podiums, partage, compteurs durables et échanges confirmés.
import assert from 'node:assert/strict';
import { createD1 } from './d1.mjs';
import { mockSupabase } from './supabase.mjs';
import { onRequest } from '../site/functions/api/[[path]].js';
import { ensureSchema } from '../site/functions/_lib/db.js';
import { syncTradeAwards } from '../site/functions/_lib/palmares.js';
import { deleteMe } from '../site/functions/_lib/auth.js';

const env = { DB: createD1(), COOKIE_SECRET: 'test', SIGNUP_CODE: 'test', MAX_USERS: '10' };
const db = env.DB.sqlite;
const supa = mockSupabase();
async function call(method, path, key, body) {
  const response = await onRequest({ env, request: new Request('http://localhost/api/' + path, {
    method, headers: { 'x-classeur-key': key || '', 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }) });
  return { status: response.status, data: await response.json() };
}
try {
  await ensureSchema(env.DB);
  const users = [];
  for (const name of ['Alice', 'Bob', 'Carole', 'Denis', 'Secret']) {
    const r = await call('POST', 'account', null, { name, code: 'test' });
    assert.equal(r.status, 201, JSON.stringify(r));
    users.push({ ...r.data.user, key: r.data.key });
  }
  const [alice, bob, carole, denis, secret] = users;
  const board = async (u = alice) => {
    const r = await call('GET', 'palmares', u.key);
    assert.equal(r.status, 200, JSON.stringify(r));
    return Object.fromEntries(r.data.categories.map((c) => [c.id, c.entries]));
  };
  assert.equal((await call('GET', 'palmares')).status, 401);
  assert.ok(Object.values(await board()).every((entries) => entries.length === 0));
  for (const u of users) for (let i = 0; i < 9; i++) {
    db.prepare('INSERT INTO cards (user_id, card_id, data) VALUES (?, ?, ?)').run(u.id, 'c' + i,
      JSON.stringify({ title: 'Étoile ' + i, rarity: 'R', count: 1, variants: { R: 1 } }));
  }
  function target(u, id, items) {
    db.prepare('INSERT INTO targets (user_id,id,name,items,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(u.id, id, id, JSON.stringify(items), '2026-10-29', '2026-10-29');
  }
  const item = (i) => ({ title: 'étoile_' + i, status: 'ok' });
  for (const u of users) {
    target(u, 'complete', [item(0), item(0), { title: 'Titre libre', status: 'label' }, { title: 'Inconnu', status: 'missing' }]);
    target(u, 'near', Array.from({ length: 10 }, (_, i) => item(i)));
    target(u, 'empty', []);
    target(u, 'below', Array.from({ length: 11 }, (_, i) => item(i)));
  }
  db.prepare('UPDATE users SET shared = 0 WHERE id = ?').run(secret.id);
  db.prepare('UPDATE users SET shared_targets = 0 WHERE id = ?').run(denis.id);
  let b = await board();
  assert.deepEqual(b.completed.map((e) => e.score), [1, 1, 1]);
  assert.deepEqual(b.completed.map((e) => e.rank), [1, 1, 1]);
  assert.deepEqual(b.near.map((e) => e.score), [1, 1, 1]);
  assert.ok(!JSON.stringify(b).includes('Secret'));
  assert.ok(!b.completed.some((e) => e.name === 'Denis'));
  assert.equal((await call('GET', 'palmares', secret.key)).status, 403);
  db.prepare('INSERT INTO prices VALUES (?, ?, ?)').run('c0', JSON.stringify({ R: { p: 500, n: 3 }, 'R*': { p: 9000, n: 10 } }), '2026-10-29');
  db.prepare('INSERT INTO prices VALUES (?, ?, ?)').run('c1', JSON.stringify({ R: { p: 99999, n: 2 } }), '2026-10-29');
  b = await board();
  assert.ok(b.value.every((e) => e.score === 500 && e.card.variant === 'R'));
  for (const u of users) assert.ok(!JSON.stringify(b).includes(u.id), 'aucun identifiant interne');

  const sent = await call('POST', 'chat', alice.key, { text: 'Bonjour !' });
  assert.equal(sent.status, 201);
  assert.equal((await board()).chat[0].score, 1);
  await call('DELETE', 'chat/' + sent.data.message.id, alice.key);
  db.exec('DELETE FROM chat_messages');
  assert.equal((await board()).chat[0].score, 1, 'compteur conservé après suppression et purge');
  assert.equal((await call('POST', 'chat', alice.key, { text: '' })).status, 400);
  assert.equal((await board()).chat[0].score, 1, 'un envoi refusé ne compte pas');
  for (let i = 0; i < 10; i++) assert.equal((await call('POST', 'chat', alice.key, { text: 'Message ' + i })).status, 201);
  assert.equal((await call('POST', 'chat', alice.key, { text: 'Trop vite' })).status, 429);
  assert.equal((await board()).chat[0].score, 11, 'un INSERT refusé par la limite ne change pas le compteur');

  const player = supa.addPlayer('alice-game');
  db.prepare(`INSERT INTO award_trades (id,user_id,recipient_id,given,received,created_at) VALUES (?,?,?,?,?,?)`)
    .run('t1', alice.id, bob.id, 3, 2, '2026-10-29');
  supa.trades.push({ id: 't1', initiator_id: player.uid, recipient_id: 'bob-game', status: 'pending' });
  const session = { uid: player.uid, auth: { access_token: player.access, refresh_token: player.refresh, expires_at: player.expires_at } };
  await syncTradeAwards(env, alice, session);
  assert.equal((await board()).traded.length, 0, 'proposition en attente exclue');
  supa.trades[0].status = 'accepted';
  await syncTradeAwards(env, alice, session);
  await syncTradeAwards(env, alice, session);
  assert.deepEqual((await board()).traded.map((e) => [e.name, e.score]), [['Alice', 3], ['Bob', 2]], 'confirmé une seule fois, chaque côté crédité');
  db.prepare(`INSERT INTO award_trades (id,user_id,recipient_id,given,received,status,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run('t2', alice.id, bob.id, 100, 100, 'rejected', '2026-10-29');
  assert.equal((await board()).traded[0].score, 3);
  await deleteMe(env, alice);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM award_trades WHERE user_id = ? OR recipient_id = ?').get(alice.id, alice.id).n, 0);
  assert.deepEqual((await board(bob)).traded.map((e) => [e.name, e.score]), [['Bob', 2]], 'supprimer un compte conserve le score de son ami');
  console.log('PALMARES OK');
} finally { supa.restore(); env.DB.close(); }
