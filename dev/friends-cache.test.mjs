// node dev/friends-cache.test.mjs : réutilisation des calculs et invalidation ciblée.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../site/public/assets/app.js', import.meta.url), 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
}
let lookups = 0;
const own = [{ id: 'mars', title: 'Mars', rarity: 'R', count: 2, tags: [] }];
const cardsA = [{ id: 'jupiter', title: 'Jupiter', rarity: 'R', count: 2, v: 20 }];
const cardsB = [{ id: 'saturne', title: 'Saturne', rarity: 'R', count: 2, v: 10 }];
const col = (id, ...titles) => ({ id, name: id, items: titles.map((title) => ({ title, status: 'ok' })) });
const a = { id: 'a', name: 'Alice', cards: cardsA, targets: [col('A', 'Mars')], tshare: true, keep: null };
const b = { id: 'b', name: 'Bob', cards: cardsB, targets: [col('B', 'Mars', 'Jupiter')], tshare: true, keep: null };
const index = (cards) => ({ findCard(it) { lookups++; return cards.find((c) => c.title === it.title) || null; } });
const ownIndex = index(own);
const context = vm.createContext({
  cards: { value: own }, friendCols: { value: [col('Moi', 'Jupiter')] }, friendList: { value: [a, b] },
  friendIndexes: { value: [{ f: a, index: index(cardsA) }, { f: b, index: index(cardsB) }] },
  S: { me: { user: { name: 'Moi' } } }, qidVersion: { value: 0 }, resolver: { version: 0 },
  keepPref: { value: { cards: new Set(), tags: new Set() } }, tradePending: { value: new Set() },
  sharing: () => true, findCard: (it) => ownIndex.findCard(it), normTitle: (s) => s,
  friendName: (f) => f.name, RANK: { R: 1 }, COLLATOR: new Intl.Collator('fr'),
  cardItems: (items) => items.filter((i) => i.status !== 'label').length,
  cardWorth: (c) => ({ priced: !!c.v, value: c.v || 0 }),
  computed: (fn) => ({ get value() { return fn(); } }),
});
context.isKept = (card) => context.keepPref.value.cards.has(card.id);
context.isTradePending = (card) => context.tradePending.value.has(card.id);
vm.runInContext(section('  let friendProgressCache =', '  const friendIndexCache ='), context);
vm.runInContext(section('  const ME =', '  // Filtre de la page :'), context);
vm.runInContext(section('  const friendStats =', '  // Classeur d\'un ami parcouru'), context);
vm.runInContext(section('  function friendProgressFor(', '  const friendTargetsView ='), context);
vm.runInContext(section('  const friendWorths =', '  const FRIEND_WORTH ='), context);
vm.runInContext(`globalThis.tradeResult = () => trades.value;
  globalThis.statResult = () => friendStats.value;
  globalThis.worthResult = () => friendWorths.value;`, context);
const pairs = () => new Map(context.tradeResult().pairs.map((p) => [p.key, p]));
let previous = pairs();
assert.deepEqual([...previous.keys()].sort(), ['>a', '>b', 'a>', 'a>b']);
assert.ok(lookups > 0);
let before = lookups;
const same = pairs();
assert.equal(lookups, before, 'mêmes données : aucune recherche de carte refaite');
assert.equal(same.get('>a').rows, previous.get('>a').rows);

// Les noms et autres métadonnées sont frais, même quand les lignes d'échange viennent du cache.
context.friendList.value = [{ ...a, name: 'Alice renommée' }, { ...b }];
const renamed = pairs();
assert.equal(renamed.get('a>').x.f.name, 'Alice renommée');
assert.equal(renamed.get('a>').rows, previous.get('a>').rows);
assert.equal(lookups, before);
const originalStats = context.statResult();
const originalWorth = context.worthResult();
before = lookups;
assert.equal(context.statResult().get('a'), originalStats.get('a'));
assert.equal(context.worthResult().get('a'), originalWorth.get('a'));
assert.equal(lookups, before, 'les statistiques sont conservées par liste de cartes');

// Une collection n'est pas recalculée en ouvrant l'album après la liste des collections.
const ai = context.friendIndexes.value[0].index;
const progress = context.friendProgressFor(ai, a.targets[0]);
before = lookups;
assert.equal(context.friendProgressFor(ai, a.targets[0]), progress);
assert.equal(lookups, before);
assert.equal(progress.help, 1);

// Changement chez Bob : les paires Moi/Alice restent intactes.
const changedB = { ...b, cards: [...cardsB, { id: 'mars-b', title: 'Mars', rarity: 'R', count: 1 }] };
context.friendList.value = [{ ...a }, changedB];
context.friendIndexes.value = [{ f: a, index: ai }, { f: changedB, index: index(changedB.cards) }];
const afterBob = pairs();
assert.equal(afterBob.get('>a').rows, previous.get('>a').rows);
assert.equal(afterBob.get('a>').rows, previous.get('a>').rows);
assert.ok(!afterBob.has('>b'), 'Bob possède maintenant Mars');
assert.equal(context.statResult().get('a'), originalStats.get('a'));
assert.equal(context.worthResult().get('a'), originalWorth.get('a'));

// Les exclusions invalident seulement les propositions du donneur concerné.
context.keepPref.value = { cards: new Set(['mars']), tags: new Set() };
const kept = pairs();
assert.ok(!kept.has('>a'));
assert.equal(kept.get('a>').rows, afterBob.get('a>').rows);
context.friendList.value = [{ ...a, keep: new Set(['jupiter']) }, changedB];
assert.ok(!pairs().has('a>'));
// Cartes dans un échange en attente (trade_pending, pending de GET /api/members) : plus proposées.
context.keepPref.value = { cards: new Set(), tags: new Set() };
context.friendList.value = [a, changedB];
assert.ok(pairs().has('>a') && pairs().has('a>'));
context.tradePending.value = new Set(['mars']);
assert.ok(!pairs().has('>a'), 'ta carte en attente');
context.friendList.value = [{ ...a, pending: new Set(['jupiter']) }, changedB];
assert.ok(!pairs().has('a>'), 'sa carte en attente');
context.tradePending.value = new Set();

// Une nouvelle collection et de nouveaux qids imposent une nouvelle analyse.
context.friendList.value = [{ ...a, targets: [col('Nouvelle', 'Saturne')] }, changedB];
assert.ok(pairs().has('b>a'));
previous = pairs();
context.qidVersion.value++;
assert.equal(pairs().get('b>a').rows, previous.get('b>a').rows, 'notification sans nouveau qid : cache conservé');
context.resolver.version++;
context.qidVersion.value++;
assert.notEqual(pairs().get('b>a').rows, previous.get('b>a').rows);
assert.notEqual(context.friendProgressFor(ai, a.targets[0]), progress);
context.cards.value = own.slice();
const nextProgress = context.friendProgressFor(ai, a.targets[0]);
assert.notEqual(context.friendProgressFor(ai, a.targets[0]), progress);
assert.equal(context.friendProgressFor(ai, a.targets[0]), nextProgress);

// Les membres retirés et les changements de compte n'accumulent aucun ancien résultat.
context.pruneFriendCalculations(new Set(['', 'a']));
assert.equal(vm.runInContext("friendTradePeople.has('b')", context), false);
assert.equal(vm.runInContext("[...friendTradePairs.keys()].some((k) => k.split('>').includes('b'))", context), false);
context.clearFriendCalculations();
assert.equal(vm.runInContext('friendTradePeople.size + friendTradePairs.size', context), 0);
assert.notEqual(context.friendProgressFor(ai, a.targets[0]), nextProgress);
console.log('FRIENDS CACHE OK');
