// Charge le vrai lecteur d'Entre amis dans un contexte isolé, avec pagination et latence simulées.
// node dev/friends.test.mjs : concurrence bornée, cache, erreurs et changement de compte.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const source = await readFile(new URL('../site/public/assets/app.js', import.meta.url), 'utf8');
const start = source.indexOf('  const FRIENDS_TTL =');
const end = source.indexOf('  // Titres des cartes des amis que tu', start);
assert.ok(start >= 0 && end > start);
const reader = source.slice(start, end);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixture({ latency = 1, members = 4, pages = 3, perPage = 50, targets = 2 } = {}) {
  const log = [];
  let active = 0, maxActive = 0, fail = null, sharing = true;
  let stamp = '2026-10-29T10:00:00Z';
  const list = Array.from({ length: members }, (_, i) => ({ id: 'm' + i, name: 'Ami ' + i, count: pages * perPage,
    fetched_at: stamp, targets: { count: targets, updated_at: stamp } }));
  const context = vm.createContext({
    S: { friends: { status: 'idle', busy: false, error: '', loading: '' }, me: { shared: true } },
    friendsGen: 0, friendsJob: null, friendsAt: 0, friendQidCtrl: null,
    friendList: { value: [] }, chatMembers: { value: [] }, chatMembersAt: 0, chatMembersJob: null,
    PAGE: 100, ALBUM_PAGE: 100, RARITY_NAME: { R: 'Rare' }, COLLATOR: new Intl.Collator('fr'),
    markRaw: (v) => v, fold: (v) => v.toLowerCase(), friendName: (v) => v.name,
    sharing: () => sharing, routeSync() {}, resolveFriendQids() {},
    ME: '', clearFriendCalculations() {}, pruneFriendCalculations() {},
    api: async (_method, url) => {
      log.push(url);
      active++; maxActive = Math.max(active, maxActive);
      try {
        await delay(latency);
        const error = fail?.(url);
        if (error) throw Object.assign(new Error('Erreur simulée'), { status: error });
        if (url === '/api/members') return { members: list.map((m) => ({ ...m })) };
        const match = /^\/api\/members\/(m\d+)\/(cards|targets)\?part=(\d+)$/.exec(url);
        assert.ok(match, url);
        const [, id, kind, raw] = match;
        const page = Number(raw);
        if (kind === 'cards') return { cards: Array.from({ length: perPage }, (_, j) => ({
          id: id + '-' + (page * perPage + j), title: 'Article ' + j, rarity: 'R', count: 1,
        })), next_part: page + 1 < pages ? String(page + 1) : null };
        return { targets: [{ id: 't' + page, name: 'Collection ' + page, items: [{ title: 'Article 0' }] }],
          next_part: page + 1 < targets ? String(page + 1) : null };
      } finally { active--; }
    },
  });
  vm.runInContext(reader, context);
  return { context, log, list, load: (force = true) => context.loadFriends(force), clear: () => context.clearFriends(),
    get maxActive() { return maxActive; }, fail: (f) => { fail = f; }, sharing: (v) => { sharing = v; },
    refresh: () => { stamp += 'x'; for (const m of list) m.fetched_at = stamp; } };
}

const sample = fixture({ latency: 8, members: 4, pages: 30, perPage: 1000, targets: 2 });
const at = performance.now();
const job = sample.load();
assert.equal(sample.load(), job, 'deux ouvertures partagent le même chargement');
await job;
const elapsed = performance.now() - at;
assert.equal(sample.log.length, 1 + 4 * (30 + 2));
assert.equal(sample.context.friendList.value.length, 4);
assert.ok(sample.context.friendList.value.every((f) => f.cards.length === 30000 && f.targets.length === 2));
console.log(`Entre amis : ${sample.log.length} appels, ${elapsed.toFixed(0)} ms avec 8 ms de latence simulée ; maximum ${sample.maxActive} requêtes simultanées.`);
const before = sample.log.length;
await sample.load(false);
assert.equal(sample.log.length, before, 'cache récent : aucun appel');
await sample.load(true);
assert.equal(sample.log.length, before + 1, 'actualiser sans changement : seule la liste des membres est relue');

if (process.argv.includes('--baseline')) process.exit(0);
assert.ok(sample.maxActive > 1 && sample.maxActive <= 4, 'lectures simultanées, quatre au maximum');

const unavailable = fixture();
unavailable.fail((url) => url.includes('/m0/cards') ? 502 : null);
await unavailable.load();
assert.equal(unavailable.context.S.friends.status, 'error');
assert.ok(unavailable.context.friendList.value.find((f) => f.id === 'm1').cards, 'un ami indisponible ne bloque pas les autres');
assert.equal(unavailable.context.S.friends.busy, false);
unavailable.fail(null);
await unavailable.load(false);
assert.ok(unavailable.context.friendList.value.every((f) => f.cards), 'les lectures en échec peuvent être reprises');
unavailable.refresh();
unavailable.fail((url) => url.includes('/m0/cards') ? 502 : null);
await unavailable.load(true);
unavailable.fail(null);
await unavailable.load(false);
assert.ok(unavailable.context.friendList.value.every((f) => f.cards), 'une actualisation échouée ne réutilise pas la date du cache précédent');

const privateMember = fixture();
privateMember.fail((url) => url.includes('/m0/cards') ? 404 : url.includes('/m1/targets') ? 404 : null);
await privateMember.load();
assert.ok(!privateMember.context.friendList.value.some((f) => f.id === 'm0'));
assert.equal(privateMember.context.friendList.value.find((f) => f.id === 'm1').tshare, false);

const switched = fixture({ latency: 5 });
const old = switched.load();
await delay(8);
switched.clear();
await old;
assert.equal(switched.context.friendList.value.length, 0, 'aucune réponse de l’ancien compte réinsérée');
assert.equal(switched.context.S.friends.busy, false);

const revoked = fixture();
revoked.fail((url) => url.includes('/m0/cards') ? 403 : null);
await revoked.load();
assert.equal(revoked.context.S.me.shared, false);
assert.equal(revoked.context.friendList.value.length, 0, 'partage révoqué : aucune donnée tardive ne revient');

// Les mises à jour de métadonnées ne reconstruisent pas les mêmes index de cartes.
// L'index conservé continue à reconnaître les qids appris après sa création.
const matching = vm.createContext({ URL, URLSearchParams, setTimeout, clearTimeout });
vm.runInContext(await readFile(new URL('../site/public/assets/match.js', import.meta.url), 'utf8'), matching);
matching.Match = matching.ClasseurMatch;
matching.known = new Map();
matching.resolver = { version: 0, now: () => 0, knownKey: (key) => matching.known.get(key) };
const indexStart = source.indexOf('  const friendIndexCache =');
const indexEnd = source.indexOf('  const friendIndexes =', indexStart);
vm.runInContext(source.slice(indexStart, indexEnd), matching);
const cards = [{ id: 'one', title: 'Ancien titre' }];
const index = matching.makeFriendIndex(cards);
assert.equal(matching.makeFriendIndex(cards), index);
assert.equal(index.findCard({ title: 'Nouveau titre' }), null);
matching.known.set(matching.Match.normTitle('Ancien titre'), 'Q1');
matching.known.set(matching.Match.normTitle('Nouveau titre'), 'Q1');
matching.resolver.version++;
assert.equal(index.findCard({ title: 'Nouveau titre' }).id, 'one');
assert.notEqual(matching.makeFriendIndex(cards.slice()), index, 'de nouvelles cartes ont leur propre index');

console.log('FRIENDS OK');
