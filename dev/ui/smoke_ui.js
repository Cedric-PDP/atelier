// Fait tourner l'interface du classeur (site/public) dans un faux DOM avec la vraie version d'exécution de Vue,
// une API simulée (ou le serveur local avec --server=http://localhost:8788) et Wikipédia/Wikidata simulés.
// Usage : node smoke_ui.js <site/public> <vue.runtime.global.prod.min.js> [--server=URL]   -> doit finir par UI OK
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeDom } = require('./fakedom.js');

// DOMParser simulé : analyse un HTML bien formé (celui des fausses pages de Wikipédia) en nœuds du faux DOM, dans un
// document à part ; comme le vrai, il n'exécute rien (scripts gardés en texte, gestionnaires gardés en attributs).
const parsedDocs = []; // documents rendus par parseFromString (l'interface ne doit jamais les insérer dans la page)
class FakeDOMParser {
  parseFromString(html) {
    const { doc } = makeDom();
    const VOID = new Set(['br', 'img', 'hr', 'meta', 'link', 'input', 'wbr', 'col', 'source']);
    const RAW = new Set(['script', 'style']);
    const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
    const ent = (x) => x.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : NAMED[e.toLowerCase()] || m));
    const stack = [doc.body];
    const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+|</g;
    let m;
    while ((m = re.exec(html))) {
      const top = stack[stack.length - 1];
      if (m[0].startsWith('<!--')) continue;
      if (m[1]) {
        const name = m[1].toLowerCase();
        for (let i = stack.length - 1; i > 0; i--) if (stack[i].localName === name) { stack.length = i; break; }
        continue;
      }
      if (m[2]) {
        const name = m[2].toLowerCase();
        const el = doc.createElement(name);
        for (const a of m[3].matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) el.setAttribute(a[1].toLowerCase(), ent(a[2] ?? a[3] ?? a[4] ?? ''));
        top.appendChild(el);
        if (RAW.has(name)) {
          const end = html.toLowerCase().indexOf('</' + name, re.lastIndex);
          const stop = end < 0 ? html.length : end;
          el.appendChild(doc.createTextNode(html.slice(re.lastIndex, stop)));
          re.lastIndex = stop;
          continue;
        }
        if (!VOID.has(name) && !m[4]) stack.push(el);
        continue;
      }
      top.appendChild(doc.createTextNode(ent(m[0])));
    }
    parsedDocs.push(doc);
    return doc;
  }
}

const PUB = process.argv[2];
const VUE = process.argv[3];
const SERVER = (process.argv.find((a) => a.startsWith('--server=')) || '').slice(9) || null;
const ORIGIN = 'https://classeur.example';
const fail = (m) => { console.error('ÉCHEC :', m); process.exit(1); };
const check0 = (c, m) => { if (!c) fail(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ API simulée (contrat SPEC.md), plusieurs comptes
// Clés de 43 caractères comme les vraies ; `api.st` = le premier compte (celui que crée le parcours).
// Révision des cartes par compte (`rev`, `changed` : carte -> révision de son dernier changement, retrait compris) :
// GET /api/cards?since=R, `rev` des pages, `cards_rev` de GET /api/me. `api.noRev = true` : ancien serveur (sans rien de cela).
function mockApi() {
  const users = [];
  const calls = [];
  const trades = []; // échanges proposés (POST /api/trades/create)
  let tradeFail = null; // {status, error} : le prochain échange est refusé
  const gameFriends = {}; // amitié dans le jeu avec chaque membre, par prénom (GET /api/friends) ; absent : amis
  const friendRequests = []; // demandes d'ami envoyées (POST /api/friends/request)
  let canRequest = false; // la route d'envoi d'une demande d'ami est-elle connue du serveur (can_request) ?
  let seq = 0;
  const mk = (p) => (p + '_'.repeat(43)).slice(0, 43);
  const json = (status, body) => ({ status, body });
  function makeUser(name) {
    // Compte du jeu relié : linked, lost, linkAt, autoSync, fails, fullAt ; game = sa collection dans le jeu (sinon ses
    // cartes), phantom = exemplaires comptés par le jeu mais jamais lus ; clickAt = dernier « Rafraîchir » (un par minute).
    const u = { id: 'u' + ++seq, key: mk('cle' + seq), name: name || null, cards: [], tags: new Map(), targets: [], fetched_at: null,
      new_ids: [], linked: false, lost: null, linkAt: null, autoSync: true, fails: 0, fullAt: null, game: null, phantom: 0, clickAt: 0, linkToken: null,
      calls, rev: 1, changed: new Map() };
    users.push(u);
    return u;
  }
  // Comme le serveur : la révision n'avance que si une carte change (un envoi identique ne change que fetched_at).
  const bump = (st, ids) => { if (!ids.length) return; st.rev++; for (const id of ids) st.changed.set(id, st.rev); };
  // GET /api/me.session, et la liaison d'un compte du jeu (POST /api/session, favori « Relier »).
  const sessionOf = (u) => ({ linked: u.linked, lost: u.lost, at: u.linkAt, auto_sync: u.autoSync, paused: u.fails >= 3, fails: u.fails, checked_at: null, full_at: u.fullAt });
  const linkUser = (u) => Object.assign(u, { linked: true, lost: null, linkAt: new Date().toISOString(), fails: 0, linkToken: null });
  // Chat : un salon pour tous les comptes ; révision (rev) à la création puis à la suppression (marque vide gardée),
  // comme le serveur. `chatLimit` : le prochain envoi est refusé (429).
  const chat = { msgs: [], rev: 0, id: 0, reacts: [] };
  // Réactions (2026-10-24), comme chat.js : [{emoji, n, mine, who}], dans l'ordre où chaque emoji a été mis.
  const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👀'];
  const reactsOut = (st, id) => {
    const out = [];
    for (const r of chat.reacts.filter((x) => x.msg === id)) {
      let e = out.find((x) => x.emoji === r.emoji);
      if (!e) out.push(e = { emoji: r.emoji, n: 0, mine: false, who: [] });
      e.n++;
      if (r.user === st.id) e.mine = true;
      else e.who.push((users.find((u) => u.id === r.user) || {}).name || 'membre sans prénom');
    }
    return out;
  };
  // Collections citées, comme chat.js : un lien vers une collection (#/ami/<id public>/<id>, ou la sienne :
  // #/collections/<id>) rangé `\uE000c:<compte>/<id>\uE001` (sans contrôle de l'hôte ici), retraduit pour chaque lecteur.
  const COL_LINK = /\bhttps?:\/\/[^\s/#]+\/?#\/(?:ami\/([A-Za-z0-9_-]+)|collections)\/([A-Za-z0-9_-]+)(?:\?[\w=&%.~-]*[\w=&%~-])?(?![\w/-])/g;
  // Membres cités (2026-10-20) : un lien vers le classeur d'un membre qui montre ses cartes (#/ami/<id public>) rangé
  // `\uE000u:<compte>\uE001`, rendu à part dans `members`.
  const USER_LINK = /\bhttps?:\/\/[^\s/#]+\/?#\/ami\/([A-Za-z0-9_-]+)(?:\?[\w=&%.~-]*[\w=&%~-])?(?![\w/-])/g;
  const chatStore = (st, text) => text.replace(/[\uE000\uE001]/g, '').replace(COL_LINK, (all, pid, tid) => {
    const u = !pid || pid === st.pub ? st : users.find((x) => x.shared && x.sharedTargets && x.pub === pid);
    return u && u.targets.some((t) => t.id === tid) ? `\uE000c:${u.id}/${tid}\uE001` : all;
  }).replace(USER_LINK, (all, pid) => {
    const u = users.find((x) => x.shared && x.pub === pid);
    return u ? `\uE000u:${u.id}\uE001` : all;
  });
  const chatOut = (st, m) => {
    const out = { id: m.id, author: (users.find((u) => u.id === m.user) || {}).name || null, mine: m.user === st.id, text: m.text, created_at: m.at };
    const reactions = reactsOut(st, m.id);
    if (reactions.length) out.reactions = reactions;
    if (m.replyTo) {
      // Message cité : auteur et extrait (citations en clair, cartes sans crochets, espaces réduits), comme chat.js.
      const q = chat.msgs.find((x) => x.id === m.replyTo && !x.deleted);
      const o = q && chatOut(st, { ...q, replyTo: null });
      out.reply = o ? { id: q.id, author: o.author, mine: o.mine, text: o.text.replace(/\[\[([^[\]\n]{1,300})\]\]/g, '$1').replace(/\s+/g, ' ').trim() } : { id: m.replyTo, gone: true };
    }
    if (!m.text.includes('\uE000')) return out;
    // Nom de la collection en clair dans le texte, sa place (at, len) dans refs.
    const refs = [];
    const members = [];
    const sees = !!(st.shared && st.pub);
    let txt = '';
    let last = 0;
    for (const x of m.text.matchAll(/\uE000(?:c:([^/]+)\/([^\uE001]+)|u:([^\uE001]+))\uE001/g)) {
      if (x[3]) {
        const u = users.find((y) => y.id === x[3]);
        const mine = u === st;
        const open = u && !mine && sees && u.shared && u.pub;
        const c = !u ? { gone: true } : { name: u.name || 'membre sans prénom', mine, pid: open ? u.pub : null, pseudo: open ? u.pseudo || null : null };
        const shown = c.gone ? 'classeur supprimé' : c.name;
        txt += m.text.slice(last, x.index);
        members.push({ at: txt.length, len: shown.length, ...c });
        txt += shown;
        last = x.index + x[0].length;
        continue;
      }
      const u = users.find((y) => y.id === x[1]);
      const t = u && u.targets.find((y) => y.id === x[2]);
      const mine = u === st;
      const c = !t || (!mine && !(u.shared && u.sharedTargets)) ? { gone: true }
        : { name: t.name, owner: u.name, mine, pid: !mine && sees ? u.pub : null, id: mine || sees ? x[2] : null };
      const shown = c.gone ? 'collection non partagée' : c.name;
      txt += m.text.slice(last, x.index);
      refs.push({ at: txt.length, len: shown.length, ...c });
      txt += shown;
      last = x.index + x[0].length;
    }
    out.text = txt + m.text.slice(last);
    if (refs.length) out.refs = refs;
    if (members.length) out.members = members;
    return out;
  };
  const chatDrop = (m) => { if (!m.deleted) { m.deleted = true; m.text = ''; m.rev = ++chat.rev; chat.reacts = chat.reacts.filter((r) => r.msg !== m.id); } };
  function chatRoute(st, method, p, body) {
    const rm = p.match(/^\/api\/chat\/(\d+)\/react$/);
    if (rm) {
      if (method !== 'POST') return json(405, { error: 'Méthode non autorisée.' });
      const m = chat.msgs.find((x) => x.id === Number(rm[1]) && !x.deleted);
      if (!REACTIONS.includes(body.emoji) || typeof body.on !== 'boolean') return json(400, { error: 'Réaction inconnue.' });
      if (!m) return json(404, { error: "Ce message n'existe plus (supprimé par son auteur ?)." });
      if (self.reactLimit) return json(429, { error: 'Doucement : 30 réactions par minute au plus. Réessaie dans 12 s.', retry_after: 12 });
      const i = chat.reacts.findIndex((r) => r.msg === m.id && r.user === st.id && r.emoji === body.emoji);
      if (body.on && i < 0) chat.reacts.push({ msg: m.id, user: st.id, emoji: body.emoji });
      if (!body.on && i >= 0) chat.reacts.splice(i, 1);
      if (body.on === (i < 0)) m.rev = ++chat.rev;
      return json(200, { id: m.id, reactions: reactsOut(st, m.id) });
    }
    const dm = p.match(/^\/api\/chat\/(\d+)$/);
    if (dm) {
      if (method !== 'DELETE') return json(405, { error: 'Méthode non autorisée.' });
      const m = chat.msgs.find((x) => x.id === Number(dm[1]));
      if (m && m.user === st.id) { chatDrop(m); return json(200, { ok: true }); }
      if (!m || m.deleted) return json(404, { error: "Ce message n'existe plus." });
      return json(403, { error: 'Tu ne peux supprimer que tes propres messages.' });
    }
    if (method === 'POST') {
      const text = typeof body.text === 'string' ? body.text.replace(/\r\n?/g, '\n').trim() : '';
      if (!text) return json(400, { error: "Message vide : écris quelque chose avant d'envoyer." });
      if (text.length > 500) return json(400, { error: 'Message trop long : 500 caractères au plus.' });
      if (!st.name) return json(400, { error: "Donne d'abord un prénom à ton classeur (Réglages, « Ton prénom ») : c'est lui que les autres membres verront." });
      if (self.chatLimit) return json(429, { error: 'Doucement : 10 messages par minute au plus. Réessaie dans 42 s.', retry_after: 42 });
      const replyTo = body.reply_to ?? null;
      if (replyTo !== null && !(Number.isSafeInteger(replyTo) && replyTo > 0)) return json(400, { error: "reply_to doit être le numéro d'un message." });
      if (replyTo !== null && !chat.msgs.some((x) => x.id === replyTo && !x.deleted)) return json(404, { error: "Le message auquel tu réponds n'existe plus (supprimé par son auteur ?)." });
      const m = { id: ++chat.id, user: st.id, text: chatStore(st, text), at: new Date().toISOString(), deleted: false, rev: ++chat.rev, replyTo };
      chat.msgs.push(m);
      return json(201, { message: chatOut(st, m) });
    }
    if (method !== 'GET') return json(405, { error: 'Méthode non autorisée.' });
    const sp = new URL('http://x' + p).searchParams;
    const live = chat.msgs.filter((m) => !m.deleted);
    if (sp.has('before')) {
      const older = live.filter((m) => m.id < Number(sp.get('before')));
      return json(200, { messages: older.slice(-100).map((m) => chatOut(st, m)), older: older.length > 100 });
    }
    if (sp.has('after')) {
      const a = Number(sp.get('after'));
      if (a > chat.rev) return json(200, { reset: true, rev: chat.rev, last_id: chat.id });
      const changed = chat.msgs.filter((m) => m.rev > a).sort((x, y) => x.rev - y.rev);
      const kept = changed.slice(0, 100);
      return json(200, { messages: kept.filter((m) => !m.deleted).map((m) => chatOut(st, m)), deleted: kept.filter((m) => m.deleted).map((m) => m.id),
        rev: changed.length > 100 ? kept[99].rev : chat.rev, last_id: chat.id, more: changed.length > 100 });
    }
    return json(200, { messages: live.slice(-100).map((m) => chatOut(st, m)), rev: chat.rev, last_id: chat.id, older: live.length > 100 });
  }
  // Ajout automatique d'une collection, comme targets.js (nextAuto) : undefined = inchangé, null = aucune règle ; une
  // erreur = 400. Titres exclus comparés par leur première lettre, « _ » et apostrophes typographiques.
  function mockAuto(body, stored) {
    const hasAuto = body.auto !== undefined;
    const delta = body.auto_skip;
    if (!hasAuto && (delta === undefined || delta === null)) return undefined;
    const key = (x) => { const t = String(x).replace(/_/g, ' ').replace(/[\u2018\u2019]/g, "'").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
    let cur = stored ? { rules: stored.rules, skip: stored.skip.slice() } : null;
    if (hasAuto) {
      if (body.auto === null) cur = null;
      else {
        if (!body.auto || !Array.isArray(body.auto.rules) || body.auto.rules.length > 20) throw new Error('Ajout automatique : 20 règles au plus.');
        const seen = new Set();
        const rules = body.auto.rules.filter((r) => { const k = r.k + ':' + (r.k === 'tag' ? r.v : r.v.toLowerCase()); if (seen.has(k)) return false; seen.add(k); return true; })
          .map((r) => ({ k: r.k, v: r.v }));
        cur = rules.length ? { rules, skip: Array.isArray(body.auto.skip) ? body.auto.skip.slice() : cur ? cur.skip : [] } : null;
      }
    }
    if (!cur) return hasAuto ? null : undefined;
    if (delta) {
      const gone = new Set((delta.del || []).map(key));
      const seen = new Set();
      const skip = [];
      for (const x of [...cur.skip, ...(delta.add || [])]) { const k = key(x); if (gone.has(k) || seen.has(k)) continue; seen.add(k); skip.push(x); }
      cur.skip = skip.slice(-2000);
    }
    return cur;
  }
  function importCards(st, list, stats) {
    const before = new Map(st.cards.map((c) => [c.id, JSON.stringify(c)]));
    const first = st.fetched_at === null;
    const now = new Set(list.map((c) => c.id));
    bump(st, [...list.filter((c) => before.get(c.id) !== JSON.stringify(c)).map((c) => c.id), ...[...before.keys()].filter((id) => !now.has(id))]);
    st.cards = list;
    st.fetched_at = new Date().toISOString();
    st.new_ids = first ? [] : list.filter((c) => !before.has(c.id)).map((c) => c.id);
    return { count: list.length, new_ids: st.new_ids, complete: stats ? stats.totalUnique === list.length : null };
  }
  const self = {
    noRev: false,
    calls,
    sold: [], // ventes créées (POST /api/market/sell)
    cancelled: [], // ventes annulées (POST /api/market/cancel)
    bidsSent: [], // mises faites (POST /api/market/bid)
    sellFail: null,
    cancelFail: null,
    conflicts: [], // enregistrements conditionnels refusés (409) : ids des collections
    get st() { return users[0]; },
    users,
    makeUser,
    // Collection posée dans le jeu, puis lue en entier par le serveur : c'est ainsi que le test sème les cartes d'un compte.
    seed(key, list) {
      const u = users.find((x) => x.key === key);
      if (!u) throw new Error('seed : clé inconnue');
      u.game = list;
      return importCards(u, list, { totalUnique: list.length });
    },
    // Compte du jeu relié sans passer par le favori.
    link(key) { linkUser(users.find((x) => x.key === key)); },
    trades,
    failTrade(r) { tradeFail = r; },
    gameFriends,
    friendRequests,
    canRequest(v) { canRequest = v; },
    isLinked(key) { return !!(users.find((x) => x.key === key) || {}).linked; },
    handle(method, p, headers, body) {
      calls.push([method, p, body]);
      if (p === '/api/health') return json(200, { ok: true, db: true, cookie_secret: true, signup_open: true });
      if (p === '/api/account' && method === 'POST') {
        if (body.code !== 'dev') return json(403, { error: "Code d'invitation incorrect." });
        const u = makeUser(body.name);
        return json(201, { key: u.key, user: { id: u.id, name: u.name } });
      }
      // Dépôt de la session par le favori « Relier » : sans clé, avec le jeton à usage unique ; un cookie illisible ne le
      // consomme pas.
      if (p === '/api/link/session' && method === 'POST') {
        const u = users.find((x) => x.linkToken && x.linkToken === (body || {}).token);
        if (!/auth-token/.test(String((body || {}).cookie || ''))) return json(400, { error: 'Ce cookie ne contient pas de session du jeu lisible.' });
        if (!u) return json(401, { error: 'Lien de liaison périmé ou déjà utilisé : refais « Relier mon compte » dans le classeur, puis reclique le favori dans ta fenêtre privée.' });
        linkUser(u);
        u.lastSession = { cookie: body.cookie, via: 'relier' };
        return json(200, { ok: true, pseudo: null });
      }
      const key = headers['X-Classeur-Key'];
      const st = users.find((u) => u.key === key);
      if (!st) return json(401, { error: key ? 'Clé inconnue : ce classeur a peut-être été supprimé.' : 'Clé absente : ouvre ton lien personnel du classeur.' });
      const cardOut = (c) => ({ ...c, tags: st.tags.get(c.id) || [] });
      if (p === '/api/me' && method === 'GET') {
        return json(200, { user: { id: st.id, name: st.name, created_at: 'x' }, fetched_at: st.fetched_at, card_count: st.cards.length, new_ids: st.new_ids,
          prefs: st.prefs || {}, session: sessionOf(st),
          shared: !!st.shared, shared_targets: !!(st.shared && st.sharedTargets), public_id: st.shared ? st.pub || null : null, ...(self.noRev ? {} : { cards_rev: st.rev }), last_chat_id: chat.id,
          market_at: (st.market && st.market.market_at) || null, last_sync: st.lastSync || null, fast_sync: !!st.fastSync, auto_friend: !!st.autoFriend,
          auto_wish: !!st.autoWish, wish: st.wish || null,
          wikibidous: st.wb == null ? null : { n: st.wb, at: st.fetched_at } });
      }
      if (p === '/api/me' && method === 'PATCH') {
        if ('prefs' in body) {
          if (!body.prefs || typeof body.prefs !== 'object' || JSON.stringify(body.prefs).length > 16384) return json(400, { error: 'Préférences invalides.' });
          st.prefs = body.prefs;
        }
        if ('pseudo' in body) {
          if (typeof body.pseudo !== 'string' || body.pseudo.trim().length > 40 || /[\s/?#<>]/.test(body.pseudo.trim())) return json(400, { error: 'Pseudo invalide.' });
          st.pseudo = body.pseudo.trim() || null;
        }
        if ('shared' in body) {
          // Partage entre membres : identifiant public tiré à chaque activation, effacé à la désactivation.
          if (typeof body.shared !== 'boolean') return json(400, { error: 'Le partage (shared) vaut true ou false.' });
          if (!body.shared) { st.shared = false; st.pub = null; st.sharedTargets = false; } else if (!st.shared) { st.shared = true; st.pub = 'pub' + ++seq; }
        }
        if ('shared_targets' in body) {
          // Second réglage : montrer aussi ses collections, seulement si l'on montre ses cartes.
          if (typeof body.shared_targets !== 'boolean') return json(400, { error: 'Le partage des collections (shared_targets) vaut true ou false.' });
          if (body.shared_targets && !st.shared) return json(400, { error: "Pour montrer tes collections à compléter, montre d'abord tes cartes." });
          st.sharedTargets = body.shared_targets;
        }
        if ('auto_sync' in body) {
          if (typeof body.auto_sync !== 'boolean') return json(400, { error: '« auto_sync » vaut true ou false.' });
          st.autoSync = body.auto_sync;
        }
        if ('fast_sync' in body) {
          if (typeof body.fast_sync !== 'boolean') return json(400, { error: '« fast_sync » vaut true ou false.' });
          st.fastSync = body.fast_sync;
        }
        if ('auto_friend' in body) {
          if (typeof body.auto_friend !== 'boolean') return json(400, { error: '« auto_friend » vaut true ou false.' });
          st.autoFriend = body.auto_friend;
        }
        if ('auto_wish' in body) {
          if (typeof body.auto_wish !== 'boolean') return json(400, { error: '« auto_wish » vaut true ou false.' });
          st.autoWish = body.auto_wish;
        }
        if ('name' in body) st.name = body.name;
        return json(200, { user: { id: st.id, name: st.name }, prefs: st.prefs || {}, shared: !!st.shared, shared_targets: !!(st.shared && st.sharedTargets), public_id: st.shared ? st.pub || null : null,
          auto_sync: st.autoSync, fast_sync: !!st.fastSync, auto_friend: !!st.autoFriend, auto_wish: !!st.autoWish });
      }
      // Liste de souhaits du jeu : « Mettre à jour maintenant » rend une passe fixe (2 ajoutées, 1 retirée).
      if (p === '/api/wishlist/sync' && method === 'POST') {
        if (!st.linked) return json(401, { error: "Relie d'abord ton compte du jeu.", needs_link: true });
        st.wish = { at: new Date().toISOString(), via: 'clic', size: 345, added: 2, removed: 1, left: 0, none: 3 };
        return json(200, { wish: st.wish });
      }
      // Amis dans le jeu : statut de chaque membre qui partage ; une demande d'ami passe le membre à « sent ».
      if ((p === '/api/friends' || p.startsWith('/api/friends?')) && method === 'GET') {
        const list = users.filter((u) => u !== st && u.shared && u.pub).map((u) => ({ id: u.pub, name: u.name, pseudo: u.pseudo || null, st: st.linked ? gameFriends[u.name] || 'friends' : 'unknown' }));
        const members = Object.fromEntries(list.map((m) => [m.id, m.st]));
        return json(200, { linked: !!st.linked, at: st.linked ? new Date().toISOString() : null, members, list, can_request: canRequest, auto_friend: !!st.autoFriend });
      }
      if (p === '/api/friends/request-all' && method === 'POST') {
        const results = ((body || {}).members || []).map((id) => {
          const f = users.find((u) => u !== st && u.shared && u.pub && u.pub === id);
          if (!f) return { id, error: 'Ce membre ne montre pas (ou plus) ses cartes.' };
          const now = gameFriends[f.name] || 'friends';
          if (now !== 'none') return { id, status: now };
          friendRequests.push(f.name);
          gameFriends[f.name] = 'sent';
          return { id, status: 'sent' };
        });
        return json(200, { results });
      }
      if (p === '/api/friends/request' && method === 'POST') {
        const f = users.find((u) => u !== st && u.shared && u.pub && u.pub === (body || {}).member);
        if (!f) return json(404, { error: 'Ce membre ne montre pas (ou plus) ses cartes.' });
        const now = gameFriends[f.name] || 'friends';
        if (now !== 'none') return json(200, { status: now });
        if (!canRequest) return json(503, { error: "Le classeur ne sait pas encore envoyer une demande d'ami : envoie-la dans le jeu (page Amis)." });
        friendRequests.push(f.name);
        gameFriends[f.name] = 'sent';
        return json(200, { status: 'sent' });
      }
      // « Proposer un échange » : créé dans le jeu par le serveur (ici, gardé dans api.trades) ; titres des cartes de chacun.
      if (p === '/api/trades/create' && method === 'POST') {
        if (!st.linked) return json(401, { error: "Aucun compte du jeu relié : relie ton compte dans l'onglet « Synchro ».", needs_link: true });
        const f = users.find((u) => u !== st && u.shared && u.pub && u.pub === (body || {}).member);
        if (!f) return json(404, { error: 'Ce membre ne montre pas (ou plus) ses cartes.' });
        if (tradeFail) { const r = tradeFail; tradeFail = null; return json(r.status, { error: r.error }); }
        const titles = (u, ids) => (ids || []).map((id) => ({ id, title: (u.cards.find((c) => c.id === id) || {}).title || id }));
        trades.push({ from: st.name, to: f.name, give: body.give || [], get: body.get || [], give_wb: body.give_wb, get_wb: body.get_wb });
        return json(200, { trade: { id: 'echange-' + trades.length, status: 'pending' }, given: titles(st, body.give), received: titles(f, body.get),
          given_wb: body.give_wb || 0, received_wb: body.get_wb || 0, url: 'https://www.wiki-masters.com/trades' });
      }
      // Partage entre membres : 403 sans partager soi-même, 404 pour un membre qui ne partage pas ; cartes par pages
      // de 2 ici (curseur opaque), sans étiquettes, champs montrés seulement.
      if (p === '/api/members' || p.startsWith('/api/members/')) {
        if (method !== 'GET') return json(405, { error: 'Méthode non autorisée.' });
        if (!st.shared) return json(403, { error: "Pour voir les cartes des autres membres, montre d'abord les tiennes : Réglages, « Partage entre membres »." });
        if (p === '/api/members') {
          return json(200, { members: users.filter((u) => u !== st && u.shared && u.pub).map((u) => ({ id: u.pub, name: u.name, pseudo: u.pseudo || null, count: u.cards.length, fetched_at: u.fetched_at,
            targets: u.sharedTargets ? { count: u.targets.length, updated_at: 'r' + (u.targetsRev || 0) } : null,
            wikibidous: u.wb == null ? null : { n: u.wb, at: u.fetched_at } })) });
        }
        // Collections d'un membre qui les montre : une par page ici, réduites à leur nature (kind) et au titre, au qid et au
        // drapeau d'intercalaire (sep: true) des éléments vérifiés.
        const mt = p.match(/^\/api\/members\/([^/?]+)\/targets(?:\?part=(.*))?$/);
        if (mt) {
          const u = users.find((x) => x.shared && x.pub === mt[1]);
          if (!u) return json(404, { error: 'Ce membre ne montre pas (ou plus) ses cartes.' });
          if (!u.sharedTargets) return json(404, { error: 'Ce membre ne montre pas (ou plus) ses collections à compléter.' });
          const part = mt[2] === undefined ? '0' : decodeURIComponent(mt[2]);
          const n = part === '0' ? 0 : Number(part.replace(/^tpage-/, ''));
          const page = u.targets.slice(n, n + 1).map((t) => ({ id: t.id, name: t.name, kind: String(t.source || '').startsWith('wp:') ? 'category' : 'collection',
            items: t.items.filter((i) => (i.status || 'ok') === 'ok').map((i) => ({ title: i.title, ...(i.qid ? { qid: i.qid } : {}), ...(i.sep === true ? { sep: true } : {}) })) }));
          return json(200, { member: { id: u.pub, name: u.name }, targets: page, part, next_part: n + 1 < u.targets.length ? 'tpage-' + (n + 1) : null });
        }
        const m = p.match(/^\/api\/members\/([^/?]+)\/cards(?:\?part=(.*))?$/);
        const u = m && users.find((x) => x.shared && x.pub === m[1]);
        if (!u) return json(404, { error: 'Ce membre ne montre pas (ou plus) ses cartes.' });
        const part = m[2] === undefined ? '0' : decodeURIComponent(m[2]);
        const n = part === '0' ? 0 : Number(part.replace(/^page-/, ''));
        const sorted = u.cards.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        // Avec sa cote (`v`) quand le cache commun en a une (ici : les cotes posées sur un compte par le test), comme le serveur.
        const priceOf = (id) => users.flatMap((x) => (x.market && x.market.prices) || []).find((q) => q.id === id && q.v && Object.keys(q.v).length);
        const page = sorted.slice(n * 2, n * 2 + 2).map((c) => {
          const q = priceOf(c.id);
          return { id: c.id, title: c.title, rarity: c.rarity, count: c.count, shiny: !!c.shiny, image: c.image ?? null, url: c.url ?? null, ...(q ? { v: q.v } : {}) };
        });
        return json(200, { member: { id: u.pub, name: u.name, fetched_at: u.fetched_at }, cards: page, part, next_part: (n + 1) * 2 < sorted.length ? 'page-' + (n + 1) : null });
      }
      if (p === '/api/me' && method === 'DELETE') {
        for (const m of chat.msgs) if (m.user === st.id) { chatDrop(m); m.user = ''; } // ses messages du chat : vidés, sans auteur
        users.splice(users.indexOf(st), 1);
        return json(200, { ok: true });
      }
      if (p === '/api/chat' || p.startsWith('/api/chat?') || p.startsWith('/api/chat/')) return chatRoute(st, method, p, body || {});
      if (p === '/api/key/rotate' && method === 'POST') { st.key = mk('tourne' + ++seq); return json(200, { key: st.key }); }
      if (p === '/api/cards' || p.startsWith('/api/cards?')) {
        // Lecture par morceaux comme le vrai serveur, avec un curseur opaque (chaîne) : 400 cartes par morceau ici.
        const sp = new URL('http://x' + p).searchParams;
        const q = sp.get('part');
        const rev = self.noRev ? {} : { rev: st.rev };
        const since = self.noRev ? null : sp.get('since');
        if (since !== null) {
          // Ce qui a changé depuis R ; delta:false si R est inconnue (plus grande que la révision : base recréée) ou s'il
          // y a plus de 1 000 changements.
          if (!/^\d+$/.test(since)) return json(400, { error: 'Révision invalide.' });
          const R = Number(since);
          if (R > st.rev) return json(200, { rev: st.rev, delta: false });
          const ids = [...st.changed].filter(([, r]) => r > R).map(([id]) => id);
          if (ids.length > 1000) return json(200, { rev: st.rev, delta: false });
          const present = new Map(st.cards.map((c) => [c.id, c]));
          return json(200, { rev: st.rev, delta: true, cards: ids.filter((id) => present.has(id)).map((id) => cardOut(present.get(id))),
            gone: ids.filter((id) => !present.has(id)), fetched_at: st.fetched_at, new_ids: st.new_ids });
        }
        const all = st.cards.map(cardOut);
        if (q === null) return json(200, { ...rev, fetched_at: st.fetched_at, cards: all, new_ids: st.new_ids });
        const n = q === '0' ? 0 : Number(String(q).replace(/^curseur-/, ''));
        if (!Number.isInteger(n)) return json(400, { error: 'curseur invalide' });
        const size = 400, last = Math.max(0, Math.ceil(all.length / size) - 1);
        calls.push('cards part ' + q);
        return json(200, { ...rev, fetched_at: st.fetched_at, cards: all.slice(n * size, (n + 1) * size), new_ids: st.new_ids, part: q, next_part: n < last ? 'curseur-' + (n + 1) : null });
      }
      // Journal des synchros : st.syncLog (lignes posées par le test), comme GET /api/sync-log.
      if (p === '/api/sync-log' && method === 'GET') return json(200, { entries: st.syncLog || [] });
      if (p === '/api/session' && method === 'POST') {
        if (!body.cookie && !body.har) return json(400, { error: 'Envoie le cookie ou un export HAR, copiés depuis une fenêtre privée.' });
        st.lastSession = body;
        linkUser(st);
        return json(200, { ok: true, pseudo: null, session: sessionOf(st) });
      }
      if (p === '/api/session' && method === 'DELETE') { Object.assign(st, { linked: false, lost: null, linkAt: null, fails: 0 }); return json(200, { ok: true }); }
      if (p === '/api/link' && method === 'POST') {
        st.linkToken = ('jeton' + ++seq + 'x'.repeat(30)).slice(0, 32);
        return json(200, { token: st.linkToken, until: new Date(Date.now() + 30 * 60_000).toISOString() });
      }
      // « Rafraîchir » : toute la collection du jeu (st.game, sinon les cartes déjà là) lue en un appel, une fois par minute.
      if (p === '/api/refresh' && method === 'POST') {
        if (st.revokeNext) Object.assign(st, { revokeNext: false, linked: false, lost: 'révoquée' });
        if (!st.linked) {
          return json(401, { error: st.lost ? `Ta session du jeu n'est plus valable (${st.lost}) : relie ton compte.` : "Aucun compte du jeu relié : relie ton compte dans l'onglet « Synchro ».", needs_link: true });
        }
        const now = Date.now();
        if (now - st.clickAt < 60_000) return json(429, { error: "Collection déjà rafraîchie il y a moins d'une minute : patiente un instant.", retry_after: Math.max(1, Math.ceil((st.clickAt + 60_000 - now) / 1000)) });
        st.clickAt = now;
        const list = (st.game || st.cards).map(({ tags, ...c }) => c);
        const res = importCards(st, list, { totalUnique: list.length + st.phantom });
        if (res.complete) st.fullAt = new Date().toISOString();
        st.fails = 0;
        return json(200, { ...res, fresh: res.new_ids.length, removed: 0, kept: 0, skipped: 2 });
      }
      if (p === '/api/tags/set') { st.tags.set(body.card_id, body.tags); bump(st, [body.card_id]); return json(200, { tags: body.tags }); }
      if (p === '/api/tags/bulk') {
        if (body.add.includes('QUOTA')) return json(503, { error: 'La base du classeur est pleine pour aujourd\'hui (quota gratuit atteint) : réessaie demain.' });
        for (const id of body.card_ids) { let t = st.tags.get(id) || []; t = t.filter((x) => !body.remove.includes(x)); for (const a of body.add) if (!t.includes(a)) t.push(a); st.tags.set(id, t); }
        bump(st, body.card_ids);
        return json(200, { ok: true });
      }
      if (p === '/api/tags/rename') {
        const ids = [...st.tags].filter(([, t]) => t.includes(body.from)).map(([id]) => id);
        for (const [id, t] of st.tags) st.tags.set(id, [...new Set(t.map((x) => (x === body.from ? body.to : x)))]);
        bump(st, ids);
        return json(200, { ok: true });
      }
      if (p === '/api/targets') return json(200, { targets: st.targets });
      if (p === '/api/targets/save') {
        // Envoi en morceaux (upload {id, part, last}, comme targets.js) : les morceaux sans last sont gardés, le dernier
        // les reprend dans l'ordre ; la réponse n'a pas les éléments (items: null). Un envoi seul : 600 Ko au plus.
        let chunked = false;
        if (body.upload) {
          const u = body.upload;
          st.targetUploads = st.targetUploads || {};
          const got = (st.targetUploads[u.id] = st.targetUploads[u.id] || []);
          self.uploadParts = (self.uploadParts || 0) + 1;
          if (!u.last) { got[u.part] = body.items; return json(200, { part: u.part }); }
          if (got.length !== u.part || got.some((x) => !x)) return json(400, { error: 'Des morceaux de la collection manquent.' });
          body = { ...body, items: [...got.flat(), ...body.items] };
          delete st.targetUploads[u.id];
          chunked = true;
        } else if (Buffer.byteLength(JSON.stringify(body.items || [])) > 600 * 1024) return json(400, { error: 'Collection trop volumineuse pour un seul envoi : 600 Ko au plus.' });
        if (Buffer.byteLength(JSON.stringify(body.items || [])) > 1_700_000) return json(400, { error: 'Collection trop volumineuse : 1,7 Mo au plus.' });
        if (!Array.isArray(body.items) || !body.items.every((i) => typeof i.title === 'string' && ['ok', 'missing', 'disambiguation'].includes(i.status))) return json(400, { error: 'items invalides' });
        let t = body.id ? st.targets.find((x) => x.id === body.id) : null;
        // Enregistrement conditionnel (expect_updated_at) : un autre est passé avant -> 409 avec la collection d'aujourd'hui
        // (null si elle a été supprimée), rien d'écrit.
        if (body.expect_updated_at !== undefined && body.expect_updated_at !== null && (!t || t.updated_at !== body.expect_updated_at)) {
          self.conflicts.push(body.id);
          return json(409, { error: "Cette collection a changé entre-temps (dans un autre onglet ou sur un autre appareil) : rien n'a été enregistré.", conflict: true, target: t || null });
        }
        let auto;
        try { auto = mockAuto(body, t ? t.auto || null : null); } catch (e) { return json(400, { error: e.message }); }
        if (!t) { t = { id: 't' + (st.targets.length + 1), created_at: 'x', auto: null }; st.targets.push(t); }
        Object.assign(t, { name: body.name, items: body.items, source: body.source || null, updated_at: 'y' + ++seq });
        if (auto !== undefined) t.auto = auto;
        st.targetsRev = (st.targetsRev || 0) + 1; // dernier changement, vu par les autres membres (GET /api/members)
        return json(200, { target: chunked ? { ...t, items: null } : t });
      }
      // « Réorganiser » de « Mes collections » (targets.js, orderTargets) : celles de la liste dans son ordre, les autres après.
      if (p === '/api/targets/order') {
        if (!Array.isArray(body.ids) || new Set(body.ids).size !== body.ids.length) return json(400, { error: "Indique l'ordre des collections (ids : leurs identifiants)." });
        const at = (t) => { const i = body.ids.indexOf(t.id); return i < 0 ? body.ids.length : i; };
        st.targets = st.targets.map((t, i) => [t, at(t), i]).sort((x, y) => x[1] - y[1] || x[2] - y[2]).map(([t]) => t);
        return json(200, { ok: true });
      }
      if (p === '/api/targets/delete') { st.targets = st.targets.filter((x) => x.id !== body.id); st.targetsRev = (st.targetsRev || 0) + 1; return json(200, { ok: true }); }
      // Marché (SPEC.md, « Le marché ») : st.market = {value, history, live, live_at, prices} posé par le test ; cotes par
      // pages de 2 (curseur opaque), comme GET /api/market/prices.
      if (p === '/api/market' && method === 'GET') {
        const m = st.market || {};
        return json(200, { value: m.value || { value: 0, priced: 0, cards: st.cards.length, approx: 0 }, history: m.history || [], live: m.live || null, live_at: m.live_at || null, attempt: m.attempt || null });
      }
      // « Actualiser le marché » : une passe légère du serveur (une par minute), qui pose la lecture du marché de ce membre.
      if (p === '/api/market/refresh' && method === 'POST') {
        if (!st.linked) return json(401, { error: 'Relie ton compte du jeu pour lire le marché.', needs_link: true });
        const wait = 60_000 - (Date.now() - (st.marketClickAt || 0));
        if (wait > 0) return json(429, { error: "Marché déjà relu il y a moins d’une minute : patiente un instant.", retry_after: Math.ceil(wait / 1000) });
        st.marketClickAt = Date.now();
        const now = new Date().toISOString();
        st.market = { ...(st.market || {}), live: { deals: [], bids: [], sales: [] }, live_at: now, market_at: now, attempt: { start: now, end: now, ok: true, v: 'serveur', light: true, full: null } };
        return json(200, { ok: true, read: 12, left: 30, deals: 3, running: 2, light: true });
      }
      // « Depuis le jeu » : les cartes du jeu dont le titre contient q (self.gameCards, lignes de la table `cards`).
      if (p.startsWith('/api/game/cards') && method === 'GET') {
        if (!st.linked) return json(401, { error: 'Relie ton compte du jeu pour chercher dans ses cartes.', needs_link: true });
        const q = (new URL('http://x' + p).searchParams.get('q') || '').trim().toLowerCase();
        if (!q || q.length > 100) return json(400, { error: 'Recherche : de 1 à 100 caractères (paramètre « q »).' });
        const found = (self.gameCards || []).filter((c) => c.wikipedia_title.toLowerCase().includes(q)).sort((a, b) => (a.wikipedia_title < b.wikipedia_title ? -1 : 1));
        return json(200, { cards: found.slice(0, 200).map((c) => ({ card_id: String(c.id), title: c.wikipedia_title, rarity: c.rarity, category: c.category || null, image: c.hide_image ? null : c.image_url || null })), more: found.length > 200 });
      }
      // Marché d'une carte, à l'ouverture de sa fiche : self.cardMarket[card_id] = {auctions, sales, v} ; détail d'une enchère
      // (site du jeu) : self.auctionDetails[id], sinon « le jeu ne la connaît plus ».
      if (p.startsWith('/api/market/card') && method === 'GET') {
        if (!st.linked) return json(401, { error: 'Relie ton compte du jeu.', needs_link: true });
        const sp = new URL('http://x' + p).searchParams;
        const id = sp.get('id') || ((self.gameCards || []).find((c) => c.wikipedia_title === sp.get('title')) || {}).id || null;
        const m = id != null ? (self.cardMarket || {})[id] : null;
        return json(200, { card_id: id != null ? String(id) : null, at: new Date().toISOString(), auctions: m ? m.auctions : [], more: false, sales: m ? m.sales : [], v: (m && m.v) || null });
      }
      if (p.startsWith('/api/market/auction') && method === 'GET') {
        if (!st.linked) return json(401, { error: 'Relie ton compte du jeu.', needs_link: true });
        const id = new URL('http://x' + p).searchParams.get('id');
        const dd = (self.auctionDetails || {})[id];
        // Une de tes ventes en cours (lecture du marché) : son détail d'après la lecture, sauf s'il est posé à part.
        const mine = !dd && st.market && st.market.live ? st.market.live.sales.find((x) => x.a === id && x.st === 'run') : null;
        if (mine) return json(200, { a: id, gone: false, status: 'active', bids: mine.bid ? 1 : 0, bidders: mine.bid ? 1 : 0, leader: mine.bid ? 'Acheteur' : null, seller: st.name, leading: false, selling: true, my_bid: null, cur: mine.bid ? mine.cur : null });
        return json(200, dd || { a: id, gone: true });
      }
      // Mettre en vente (SPEC.md, « Vendre ») : exemplaires d'après les cartes du membre (variants), enchères actives d'après
      // sa lecture du marché ; la vente rejoint « Tes ventes » comme le fait le serveur. self.sold = ventes créées ;
      // self.sellFail / self.cancelFail = {status, error, extra} : la prochaine est refusée.
      if (p.startsWith('/api/market/sell') && method === 'GET') {
        if (!st.linked) return json(401, { error: 'Relie ton compte du jeu.', needs_link: true });
        const id = new URL('http://x' + p).searchParams.get('id');
        const c = st.cards.find((x) => x.id === id);
        const copies = c ? Object.entries(c.variants || { [c.rarity + (c.shiny ? '*' : '')]: c.count || 1 }).map(([k, n]) => ({ k, n, fav: c.starred ? n : 0 })) : [];
        const live = st.market && st.market.live;
        return json(200, { card_id: id, copies, selling: live ? live.sales.filter((x) => x.st === 'run').length : 0, max: 5 });
      }
      if (p === '/api/market/sell' && method === 'POST') {
        if (!st.linked) return json(401, { error: 'Relie ton compte du jeu.', needs_link: true });
        if (self.sellFail) { const r = self.sellFail; self.sellFail = null; return json(r.status, { error: r.error, ...(r.extra || {}) }); }
        const c = st.cards.find((x) => x.id === body.id);
        if (!c || !Number.isInteger(body.base) || body.base < 1) return json(400, { error: 'Vente invalide.' });
        const a = 'vente-' + (self.sold.length + 1);
        const end = new Date(Date.now() + body.minutes * 60_000).toISOString();
        self.sold.push({ a, ...body });
        const live = st.market && st.market.live;
        if (live) live.sales.unshift({ a, id: c.id, t: c.title, r: body.k.replace('*', ''), s: body.k.endsWith('*'), img: null, end, cote: null, n: null, base: body.base, cur: null, bid: false, st: 'run' });
        return json(200, { auction: { a, k: body.k, base: body.base, minutes: body.minutes, end }, url: 'https://www.wiki-masters.com/marketplace/' + a });
      }
      // Miser (SPEC.md, « Miser ») : self.bidsSent = mises faites ; self.bidFail = {status, error, extra} : la prochaine est refusée.
      if (p === '/api/market/bid' && method === 'POST') {
        if (!st.linked) return json(401, { error: 'Relie ton compte du jeu.', needs_link: true });
        if (self.bidFail) { const r = self.bidFail; self.bidFail = null; return json(r.status, { error: r.error, ...(r.extra || {}) }); }
        if (typeof body.a !== 'string' || !Number.isInteger(body.amount) || body.amount < 1) return json(400, { error: 'Mise invalide.' });
        self.bidsSent.push({ ...body });
        const live = st.market && st.market.live;
        const x = live && live.deals.find((y) => y.a === body.a);
        if (x) Object.assign(x, { ask: body.amount, bid: true, lead: true });
        return json(200, { a: body.a, amount: body.amount, cur: body.amount, balance: 1000 - body.amount, url: 'https://www.wiki-masters.com/marketplace/' + body.a });
      }
      if (p === '/api/market/cancel' && method === 'POST') {
        if (self.cancelFail) { const r = self.cancelFail; self.cancelFail = null; return json(r.status, { error: r.error, ...(r.extra || {}) }); }
        const live = st.market && st.market.live;
        const x = live && live.sales.find((y) => y.a === body.a);
        if (x) x.st = 'off';
        self.cancelled.push(body.a);
        return json(200, { a: body.a, status: 'cancelled' });
      }
      if (p.startsWith('/api/market/prices') && method === 'GET') {
        const part = new URL('http://x' + p).searchParams.get('part') || '0';
        const n = part === '0' ? 0 : Number(part.replace(/^cotes-/, ''));
        const list = (st.market && st.market.prices) || [];
        return json(200, { prices: list.slice(n * 2, n * 2 + 2), part, next_part: (n + 1) * 2 < list.length ? 'cotes-' + (n + 1) : null });
      }
      return json(404, { error: 'introuvable' });
    },
  };
  return self;
}

// ------------------------------------------------------------------ IndexedDB simulé (ce que lit le cache des cartes)
// Un seul pour tout le test : les pages ouvertes l'une après l'autre sont celles d'un même navigateur. Valeurs copiées
// comme par le vrai (structuredClone), requêtes et fin de transaction asynchrones, dans l'ordre de création.
function fakeIndexedDB() {
  const dbs = new Map();
  const later = (f) => setTimeout(f, 0);
  function makeDb(d) {
    return {
      createObjectStore(n) { if (!d.stores.has(n)) d.stores.set(n, new Map()); return {}; },
      close() {},
      transaction(name, mode) {
        const store = d.stores.get(name);
        if (!store) throw new Error('NotFoundError : ' + name);
        const tx = { oncomplete: null, onerror: null, onabort: null };
        let pending = 0;
        let ended = false;
        const end = () => later(() => { if (!pending && !ended) { ended = true; if (tx.oncomplete) tx.oncomplete({ target: tx }); } });
        const op = (write, fn) => {
          if (ended) throw new Error('TransactionInactiveError');
          if (write && mode !== 'readwrite') throw new Error('ReadOnlyError');
          const rq = { result: undefined, onsuccess: null, onerror: null };
          pending++;
          later(() => { rq.result = fn(); if (rq.onsuccess) rq.onsuccess({ target: rq }); pending--; end(); });
          return rq;
        };
        tx.objectStore = () => ({
          get: (k) => op(false, () => (store.has(k) ? structuredClone(store.get(k)) : undefined)),
          getAll: () => op(false, () => [...store.values()].map((v) => structuredClone(v))),
          put: (v, k) => { const c = structuredClone(v); return op(true, () => { store.set(k, c); return k; }); },
          delete: (k) => op(true, () => { store.delete(k); }),
          clear: () => op(true, () => { store.clear(); }),
        });
        end();
        return tx;
      },
    };
  }
  return {
    open(name, version) {
      const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      later(() => {
        let d = dbs.get(name);
        if (!d) { d = { version: 0, stores: new Map() }; dbs.set(name, d); }
        req.result = makeDb(d);
        if ((version || 1) > d.version) { d.version = version || 1; if (req.onupgradeneeded) req.onupgradeneeded({ target: req }); }
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
    // Pour les vérifications : les enregistrements du magasin `store` (copie), ou null.
    dump(name, store) { const d = dbs.get(name); return d && d.stores.get(store) ? new Map(d.stores.get(store)) : null; },
    wipe(name, store, key) { const d = dbs.get(name); if (d && d.stores.get(store)) d.stores.get(store).delete(key); },
  };
}

// ------------------------------------------------------------------ Wikipédia et Wikidata simulés
const WIKI = {
  Zeus: { q: 'Q34201', desc: 'dieu grec', thumb: 'https://upload.wikimedia.org/z.jpg', pv: 40000 },
  'Héra': { q: 'Q38012', desc: 'déesse grecque', pv: 3000 },
  'Poséidon': { q: 'Q41127', desc: 'dieu grec de la mer', pv: 800 },
  Mercure: { disamb: true },
  Rihanna: { q: 'Q36844', desc: 'chanteuse barbadienne', pv: 30000 },
  'Abeille domestique': { q: 'Q30034', desc: "espèce d'insectes", pv: 100 },
  'Hydrogène (élément)': { q: 'Q556' },
  'Hydrogène': { q: 'Q556' }, // article de la catégorie « Élément chimique » : même élément que la carte « Hydrogène (élément) »
  Neptune: { q: 'Q332' }, // carte de Léa (Entre amis) : même élément que « Neptune (planète) » de la catégorie suivie
  'Neptune (planète)': { q: 'Q332' },
  'Hélium': { q: 'Q560', pv: 3000, thumb: 'https://upload.wikimedia.org/he.jpg' }, // catégorie « Élément chimique » que Paul suit (case vide, rareté estimée)
  'Néon': { q: 'Q654' }, // article de la catégorie « Gaz noble » : même élément que la carte « Néon (gaz) » de Léo
  'Néon (gaz)': { q: 'Q654' },
  'Liste de races bovines': { q: 'Q900100' },
  'Liste des races bovines de France': { q: 'Q900110' },
  'Liste de noms de couleur': { q: 'Q900300' },
  'Liste de couleurs (pigments)': { q: 'Q900310' },
  'Tableau périodique des éléments': { q: 'Q10693' },
  'Liste des présidents de Testlande': { q: 'Q901000' }, // page en tableaux (colonne clé)
  'Liste des gares de Testlande': { q: 'Q902000' }, // tableaux rangés en sections
  'Lèpre': { q: 'Q36956', desc: 'maladie infectieuse chronique', pv: 2000 }, // carte citée dans le chat, qu'Alek n'a pas
};
// Liens de « Liste de races bovines » : 3 races, 2 lieux, un lien rouge et une homonymie (écartés).
const LINKS = { 'Charolaise': 'Q900101', 'Limousine (race bovine)': 'Q900102', 'Salers (race bovine)': 'Q900103', France: 'Q142', 'Massif central': 'Q900104' };
// Liens de « Liste de noms de couleur » : [qid, natures (P31), description]. Gardés : 3 « couleur » (Q1075), Rouge
// (« couleur primaire », sous-classe de couleur) et « Vert d'eau » (sans nature, décrit « nom de couleur ») ; écartés :
// Imprimerie et une linguiste. « Article 3 » est une carte du classeur.
const COLOR_LINKS = { 'Article 3': ['Q900301', ['Q1075'], 'couleur'], 'Bleu marine': ['Q900302', ['Q1075'], 'couleur'], 'Mauve (couleur)': ['Q900303', ['Q1075'], 'couleur'],
  Rouge: ['Q900304', ['Q166902'], 'couleur primaire'], "Vert d'eau": ['Q900305', [], 'nom de couleur'], Imprimerie: ['Q900306', ['Q900399'], 'technique d\'impression'],
  'Annie Mollard-Desfour': ['Q900307', ['Q5'], 'linguiste française'] };
const COLOR_BY_Q = Object.fromEntries(Object.values(COLOR_LINKS).map(([q, c, d]) => [q, { c, d }]));
const SUBCLASSES = { Q1075: ['Q166902'] }; // sous-classes (P279+) connues d'une nature
const linkCalls = []; // pages dont les liens ont été lus (generator=links)
// « Liste des présidents de Testlande » : deux tableaux (colonne clé « Nom »), une liste « Voir aussi », une boîte de
// navigation. Liens : [qid, natures, description]. Présidents (Q5, nature dominante : 5 sur 16 liens), présidences (liens
// de la colonne « N° », au texte « 1 », « 2 »), partis, villes, Conseil d'État, voir aussi. « E. Dubois » redirige vers
// « Émile Dubois » ; « Martin » est une homonymie, « Denis Inconnu » un lien rouge (lignes sans article).
const TL = {
  'Aline Martin': ['Q901001', ['Q5'], 'femme politique testlandaise'], 'Bruno Petit': ['Q901002', ['Q5'], 'homme politique testlandais'],
  'Carla Rossi (femme politique)': ['Q901003', ['Q5'], 'femme politique testlandaise'], 'Émile Dubois': ['Q901004', ['Q5'], 'homme politique testlandais'],
  'Fanny Leroy': ['Q901005', ['Q5'], 'femme politique testlandaise'],
  "Présidence d'Aline Martin": ['Q901011', ['Q901090'], 'présidence'], 'Présidence de Bruno Petit': ['Q901012', ['Q901090'], 'présidence'],
  'Parti bleu': ['Q901021', ['Q7278'], 'parti politique'], 'Parti rouge': ['Q901022', ['Q7278'], 'parti politique'], 'Parti vert': ['Q901023', ['Q7278'], 'parti politique'],
  Testville: ['Q901031', ['Q515'], 'ville de Testlande'], 'Bourg-Test': ['Q901032', ['Q515'], 'ville de Testlande'], 'Port-Test': ['Q901033', ['Q515'], 'ville de Testlande'],
  "Conseil d'État (Testlande)": ['Q901041', ['Q901091'], 'institution'], 'Politique en Testlande': ['Q901051', ['Q901092'], 'politique'],
  'Constitution de Testlande': ['Q901052', ['Q901093'], 'constitution'],
};
const TL_BY_Q = Object.fromEntries(Object.values(TL).map(([q, c, d]) => [q, { c, d }]));
const TL_PAGE = 'Liste des présidents de Testlande';
const TL_HTML = `<div class="mw-content-ltr mw-parser-output" lang="fr" dir="ltr">
<style data-mw-deduplicate="TemplateStyles:r1">.mw-parser-output .x{color:red}</style>
<p>Les présidents de la <a href="/wiki/Testlande_(pays)" class="new">Testlande</a>.</p>
<div class="mw-heading mw-heading2"><h2 id="Premiere">Première République</h2></div>
<table class="wikitable sortable" style="text-align:center;">
<tbody><tr><th rowspan="2">N<sup>o</sup></th><th rowspan="2">Portrait</th><th rowspan="2">Nom</th><th colspan="2">Mandat</th><th rowspan="2" colspan="2">Parti</th></tr>
<tr><th>Début</th><th>Fin</th></tr>
<tr><th><a href="/wiki/Pr%C3%A9sidence_d%27Aline_Martin" title="Présidence d&#39;Aline Martin">1</a></th><td><span typeof="mw:File"><a href="/wiki/Fichier:Aline.jpg" class="mw-file-description"><img src="//upload.wikimedia.org/aline.jpg" onerror="window.__pwn = 1" /></a></span></td><td><b><a href="/wiki/Aline_Martin" title="Aline Martin">Aline Martin</a></b><sup id="cite_ref-1" class="reference"><a href="#cite_note-1">[1]</a></sup></td><td>1901</td><td>1910</td><td style="background:#00f"></td><td><a href="/wiki/Parti_bleu" title="Parti bleu">Parti bleu</a></td></tr>
<tr><td colspan="7"><i>Intérim assuré par le <a href="/wiki/Conseil_d%27%C3%89tat_(Testlande)" title="Conseil d&#39;État (Testlande)">Conseil d'État</a>.</i></td></tr>
<tr><th rowspan="2"><a href="/wiki/Pr%C3%A9sidence_de_Bruno_Petit" title="Présidence de Bruno Petit">2</a></th><td rowspan="2"></td><td rowspan="2"><a href="/wiki/Bruno_Petit" title="Bruno Petit">Bruno Petit</a> <small>(<a href="/wiki/Testville" title="Testville">Testville</a>)</small></td><td>1910</td><td>1915</td><td></td><td><a href="/wiki/Parti_rouge" title="Parti rouge">Parti rouge</a></td></tr>
<tr><td>1915</td><td>1920</td><td></td><td><a href="/wiki/Parti_rouge" title="Parti rouge">Parti rouge</a></td></tr>
<tr><th>3</th><td></td><td><span style="display:none">0003</span><a href="/wiki/Carla_Rossi_(femme_politique)" title="Carla Rossi (femme politique)">Carla Rossi</a></td><td>1920</td><td>1930</td><td></td><td><a href="/wiki/Parti_bleu" title="Parti bleu">Parti bleu</a></td></tr>
<tr><th>4</th><td></td><td><a href="/w/index.php?title=Denis_Inconnu&amp;action=edit&amp;redlink=1" class="new" title="Denis Inconnu (page inexistante)">Denis Inconnu</a></td><td>1930</td><td>1931</td><td></td><td><a href="/wiki/Parti_vert" title="Parti vert">Parti vert</a></td></tr>
</tbody></table>
<div class="mw-heading mw-heading2"><h2 id="Seconde">Seconde République</h2></div>
<table class="wikitable mw-collapsible mw-collapsed"><caption>Présidents depuis 1950</caption>
<thead><tr><th>Nom</th><th>Parti</th><th>Ville natale</th></tr></thead>
<tbody><tr><td><a href="/wiki/E._Dubois" title="E. Dubois">Émile Dubois</a></td><td><a href="/wiki/Parti_vert" title="Parti vert">Parti vert</a></td><td><a href="/wiki/Testville" title="Testville">Testville</a></td></tr>
<tr><th>Nom</th><th>Parti</th><th>Ville natale</th></tr>
<tr><td><a href="/wiki/Aline_Martin" title="Aline Martin">Aline Martin</a> (second mandat)</td><td><a href="/wiki/Parti_bleu" title="Parti bleu">Parti bleu</a></td><td><a href="/wiki/Bourg-Test" title="Bourg-Test">Bourg-Test</a></td></tr>
<tr><td><a href="/wiki/Martin" title="Martin">Martin</a><script>window.__pwn = 2</script></td><td><a href="/wiki/Parti_bleu" title="Parti bleu" onclick="window.__pwn = 3">Parti bleu</a></td><td><a href="/wiki/Bourg-Test" title="Bourg-Test">Bourg-Test</a></td></tr>
<tr><td><a href="/wiki/Fanny_Leroy" title="Fanny Leroy">Fanny Leroy</a></td><td><a href="/wiki/Parti_rouge" title="Parti rouge">Parti rouge</a></td><td><a href="/wiki/Port-Test" title="Port-Test">Port-Test</a></td></tr>
</tbody></table>
<div class="mw-heading mw-heading2"><h2 id="Voir">Voir aussi</h2></div>
<ul><li><a href="/wiki/Politique_en_Testlande" title="Politique en Testlande">Politique en Testlande</a></li><li><a href="/wiki/Constitution_de_Testlande" title="Constitution de Testlande">Constitution de Testlande</a></li></ul>
<table class="navbox"><tbody><tr><td><a href="/wiki/Aline_Martin">Aline Martin</a> · <a href="/wiki/Fanny_Leroy">Fanny Leroy</a></td></tr></tbody></table>
</div>`;
// « Liste des gares de Testlande », rangée comme « Liste des gares desservies par TGV » : la colonne « Gare » dans quatre
// tableaux, sous des intertitres imbriqués (h2 › h3 › h4), dont deux « En Testlande » sous des h2 différents.
const GR = {
  'Gare A': ['Q902001', ['Q55488'], 'gare de Testlande'], 'Gare B': ['Q902002', ['Q55488'], 'gare de Testlande'], 'Gare C': ['Q902003', ['Q55488'], 'gare de Testlande'],
  'Gare D': ['Q902004', ['Q55488'], 'gare de Ruritanie'], 'Gare E': ['Q902005', ['Q55488'], 'gare de Ruritanie'], 'Gare F': ['Q902006', ['Q55488'], 'gare de Syldavie'],
  'Gare G': ['Q902007', ['Q55488'], 'gare de Syldavie'], 'Gare H': ['Q902008', ['Q55488'], 'ancienne gare de Testlande'],
  Nordie: ['Q902011', ['Q82794'], 'région'], Sudie: ['Q902012', ['Q82794'], 'région'],
};
const GR_BY_Q = Object.fromEntries(Object.values(GR).map(([q, c, d]) => [q, { c, d }]));
const GR_PAGE = 'Liste des gares de Testlande';
const grRow = (g, r) => `<tr><td><a href="/wiki/${g.replace(/ /g, '_')}" title="${g}">${g}</a></td>${r ? `<td><a href="/wiki/${r}" title="${r}">${r}</a></td>` : ''}</tr>`;
const GR_HTML = `<div class="mw-parser-output"><p>Les gares.</p>
<div class="mw-heading mw-heading2"><h2 id="D">Gares desservies</h2></div>
<div class="mw-heading mw-heading3"><h3 id="DT">En Testlande</h3></div>
<table class="wikitable sortable"><tbody><tr><th>Gare</th><th>Région</th></tr>${grRow('Gare A', 'Nordie')}${grRow('Gare B', 'Sudie')}${grRow('Gare C', 'Nordie')}</tbody></table>
<div class="mw-heading mw-heading3"><h3 id="DE">À l'étranger</h3></div>
<div class="mw-heading mw-heading4"><h4 id="R">Ruritanie</h4></div>
<table class="wikitable sortable"><tbody><tr><th>Gare</th></tr>${grRow('Gare D')}${grRow('Gare E')}</tbody></table>
<div class="mw-heading mw-heading4"><h4 id="S">Syldavie</h4></div>
<table class="wikitable sortable"><tbody><tr><th>Gare</th></tr>${grRow('Gare F')}${grRow('Gare G')}</tbody></table>
<div class="mw-heading mw-heading2"><h2 id="F">Gares fermées</h2></div>
<div class="mw-heading mw-heading3"><h3 id="FT">En Testlande</h3></div>
<table class="wikitable sortable"><tbody><tr><th>Gare</th><th>Région</th></tr>${grRow('Gare H', 'Sudie')}</tbody></table>
</div>`;
// « Tableau périodique des éléments » (pas une « Liste… ») : un petit tableau de 2 éléments, trop peu pour être
// présélectionné : la page garde tous ses liens, la colonne « Élément » reste proposée.
const PERIODIC_HTML = `<div class="mw-parser-output"><p>Le tableau.</p><table class="wikitable"><tbody><tr><th>Élément</th><th>Symbole</th></tr>
<tr><td><a href="/wiki/Hydrog%C3%A8ne" title="Hydrogène">Hydrogène</a></td><td>H</td></tr><tr><td><a href="/wiki/H%C3%A9lium" title="Hélium">Hélium</a></td><td>He</td></tr></tbody></table></div>`;
const parseCalls = []; // pages dont le HTML a été lu (action=parse)
const REDIRECTS = { 'Poseidon': 'Poséidon', 'Tableau périodique': 'Tableau périodique des éléments' };
// Pages « Liste de… » trouvées par la recherche intitle:liste (ou des articles, écartés par l'interface).
const listSearch = (s) => (/bovin/i.test(s) ? [{ title: 'Liste de races bovines' }, { title: 'Charolaise' }, { title: 'Liste des races bovines de France' }]
  : /couleur/i.test(s) ? [{ title: 'Liste de noms de couleur' }, { title: 'Couleur' }, { title: 'Liste de couleurs (pigments)' }] : []);
// Articles par préfixe (espace 0) : leurs noms, sans précision entre parenthèses, sont essayés comme catégories.
const ARTICLE_PREFIX = { viol: ['Violence', 'Violet (couleur)', 'Viola Davis'], couleur: ['Couleur', 'Couleur primaire'],
  europe: ['Union européenne', 'Europe', 'Europe centrale', 'Peste'] }; // « europe » : un mot du titre, le titre exact, une carte d'Alek (par une redirection)
const chatPrefix = []; // textes cherchés sur Wikipédia par l'autocomplétion « # » du chat
// Catégories de Wikipédia (onglet Collections, zone « Catégories ») : taille (categoryinfo), articles et sous-catégories
// (categorymembers). Pour « viol » : par préfixe Violence, Violet, Violoniste français (une homonymie, une catégorie
// cachée et une vide écartées), Viol par son titre exact seulement (noPrefix : le préfixe de Wikipédia classe par
// popularité), puis Nuance de violet par la recherche plein texte ; « peintre » : 12 par préfixe ; « races bovines » :
// Race bovine par le singulier, Race bovine originaire de France par la recherche plein texte.
const CATS = {
  'Catégorie:Viol': { pages: 42, subcats: 5, noPrefix: true },
  'Catégorie:Race bovine': { pages: 25, subcats: 2, noPrefix: true },
  'Catégorie:Race bovine originaire de France': { pages: 60, subcats: 0, noPrefix: true },
  'Catégorie:Violet': { pages: 4, subcats: 1, page: ['Article 3', 'Violet (couleur)', 'Améthyste', 'Lavande'], subcat: ['Catégorie:Nuance de violet'] },
  'Catégorie:Nuance de violet': { pages: 2, subcats: 0, page: ['Mauve', 'Article 8'] },
  'Catégorie:Violence': { pages: 120, subcats: 6 },
  'Catégorie:Violoniste français': { pages: 310, subcats: 0 },
  'Catégorie:Violence (homonymie)': { pages: 3, subcats: 0 },
  'Catégorie:Violation du droit d’auteur': { pages: 50, subcats: 0, hidden: true },
  'Catégorie:Viole vide': { pages: 0, subcats: 0 },
  'Catégorie:Élément chimique': { pages: 4, subcats: 0, page: ['Hydrogène', 'Hélium', 'Lithium', 'Mercure (chimie)'] },
  'Catégorie:Gaz noble': { pages: 3, subcats: 0, page: ['Néon', 'Argon', 'Krypton'] }, // qids de l'album (Léo)
  // Couleurs (propositions : sous-catégories écartées) : Rouge, Vert et Jaune sont des sous-catégories de Couleur.
  'Catégorie:Couleur': { pages: 40, subcats: 3, page: ['Arc-en-ciel', 'Spectre visible'], subcat: ['Catégorie:Rouge', 'Catégorie:Vert', 'Catégorie:Jaune'] },
  'Catégorie:Rouge': { pages: 20, subcats: 0, page: ['Coquelicot', 'Fraise'] },
  'Catégorie:Vert': { pages: 20, subcats: 0, page: ['Pomme verte', 'Menthe'] },
  'Catégorie:Jaune': { pages: 20, subcats: 0, page: ['Citron', 'Banane'] },
  'Catégorie:Planète du Système solaire': { pages: 9, subcats: 0, page: ['Mercure (planète)', 'Vénus (planète)', 'Terre', 'Théia (impacteur)', 'Jupiter (planète)',
    'Uranus (planète)', 'Neptune (planète)', 'Mars (planète)', 'Saturne (planète)'] },
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['Catégorie:Peintre ' + String(i + 1).padStart(2, '0'), { pages: 10 + i, subcats: 0 }])),
};
// Catégories des cartes d'Iris (couleurs) et catégories parentes des catégories (prop=categories sur l'espace 14).
const CARD_CATS = { Coquelicot: ['Rouge'], Fraise: ['Rouge'], 'Pomme verte': ['Vert'], Menthe: ['Vert'], Citron: ['Jaune'], Banane: ['Jaune'],
  'Arc-en-ciel': ['Couleur'], 'Spectre visible': ['Couleur'] };
const CAT_PARENTS = { 'Catégorie:Rouge': ['Couleur'], 'Catégorie:Vert': ['Couleur'], 'Catégorie:Jaune': ['Couleur'], 'Catégorie:Couleur': ['Optique'],
  'Catégorie:Autre essai': ['Essais'] };
const parentCalls = []; // titres des catégories dont les parentes ont été demandées
const foldT = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const catInfo = (t) => { const c = CATS[t]; return c ? { size: c.pages + c.subcats, pages: c.pages, files: 0, subcats: c.subcats, ...(c.hidden ? { hidden: true } : {}) } : null; };
const catSuggest = []; // requêtes de suggestions de catégories : ['prefix' | 'search', texte]
// « Définition Wikipédia » : articles qui citent « est une maladie » (texte d'ouverture de l'index, bandeaux compris).
// Gardés : Grippe (après l'infobox), Phtiriase (après un bandeau), Malabsorption du fructose (sans texte : description).
// Écartés : Freddie Mercury (formule plus loin), Plèvre (sa définition dit « membrane »), une homonymie.
const DEF_MALADIE = [
  { title: 'Freddie Mercury', open: 'Pour les articles homonymes, voir Mercury. Freddie Mercury, né le 5 septembre 1946 à Stone Town, est un chanteur britannique. Pour lui, l’amour est une maladie.', q: 'Q15869' },
  { title: 'Grippe', open: 'Grippe Virus de la grippe. Mise en garde médicale modifier - modifier le code - voir Wikidata (aide) La grippe ou l\'influenza est une maladie infectieuse et contagieuse fréquente.', desc: 'maladie infectieuse', q: 'Q2840' },
  { title: 'Hépatite (homonymie)', open: 'L’hépatite est une maladie du foie. Hépatite peut désigner :', disamb: true },
  { title: 'Malabsorption du fructose', open: '', desc: 'maladie intestinale', q: 'Q1047897' },
  { title: 'Phtiriase', open: 'Cet article est une ébauche concernant la médecine. Vous pouvez partager vos connaissances en l’améliorant. La phtiriase (ou phthiriase) est une maladie infectieuse de la peau due au pou du pubis.', q: 'Q1474' },
  { title: 'Plèvre', open: 'En anatomie, la plèvre est une membrane séreuse. Le cancer de la plèvre est une maladie grave.', desc: 'membrane séreuse', q: 'Q193266' },
];
const defCalls = [];
let wikiCalls = 0;
const pvAsked = []; // titres dont les vues (prop=pageviews) ont été demandées, dans l'ordre
const propose = { categories: 0 };
const wdSearches = [];
let lastProbe = '';
let pvContinueSeen = false;
function wikiHandle(url) {
  wikiCalls++;
  const u = new URL(url);
  const uri = (id) => ({ type: 'uri', value: 'http://www.wikidata.org/entity/' + id });
  const lit = (v) => ({ type: 'literal', value: String(v) });
  const bool = (v) => ({ type: 'literal', datatype: 'http://www.w3.org/2001/XMLSchema#boolean', value: v ? 'true' : 'false' });
  if (u.hostname === 'www.wikidata.org') {
    const p = Object.fromEntries(u.searchParams);
    if (p.action !== 'wbsearchentities' || p.origin !== '*' || p.language !== 'fr') throw new Error('appel Wikidata inattendu : ' + url);
    const S2 = { footballeur: [{ id: 'Q937857', label: 'footballeur' }], musique: [{ id: 'Q638', label: 'musique' }] };
    wdSearches.push(p.search);
    return { search: S2[p.search.toLowerCase()] || [] };
  }
  if (u.hostname === 'query.wikidata.org') {
    const q = u.searchParams.get('query');
    if (/SELECT \?item \?c \?desc/.test(q)) {
      const ids = [...q.matchAll(/wd:(Q\d+)/g)].map((m) => m[1]);
      return { results: { bindings: ids.flatMap((id) => {
        const col = COLOR_BY_Q[id];
        if (col) return col.c.length ? col.c.map((c) => ({ item: uri(id), c: uri(c), desc: lit(col.d) })) : [{ item: uri(id), desc: lit(col.d) }];
        const tl = TL_BY_Q[id] || GR_BY_Q[id];
        if (tl) return tl.c.map((c) => ({ item: uri(id), c: uri(c), desc: lit(tl.d) }));
        return [Number(id.slice(1)) >= 900101 && Number(id.slice(1)) <= 900103
          ? { item: uri(id), c: uri('Q12045585'), desc: lit('race bovine française') } : { item: uri(id), c: uri(id === 'Q142' ? 'Q6256' : 'Q1620908') }];
      }) } };
    }
    if (/wd:Q12045585 rdfs:label/.test(q)) return { results: { bindings: [{ l: lit('race bovine') }] } };
    if (/wd:Q1075 rdfs:label/.test(q)) return { results: { bindings: [{ l: lit('couleur') }] } };
    if (/wd:Q5 rdfs:label/.test(q)) return { results: { bindings: [{ l: lit('être humain') }] } };
    {
      // Sous-classes de la nature dominante parmi celles vues (liens d'une page).
      const m = q.match(/^SELECT \?c WHERE \{ VALUES \?c \{ ([^}]*) \} \?c wdt:P279\+ wd:(Q\d+) \. \}$/);
      if (m) {
        const asked = [...m[1].matchAll(/wd:(Q\d+)/g)].map((x) => x[1]);
        return { results: { bindings: asked.filter((c) => (SUBCLASSES[m[2]] || []).includes(c)).map((c) => ({ c: uri(c) })) } };
      }
    }
    if (/P279\+/.test(q)) return { results: { bindings: [] } };
    if (/P1549/.test(q)) return { results: { bindings: q.includes('fr[aàâä]n[cç]') ? [{ c: uri('Q142'), cl: lit('France'), isCountry: bool(true) }] : [] } };
    if (/AS \?country\)/.test(q)) {
      const kinds = { Q937857: { occ: true, cls: true }, Q142: { country: true, cls: false }, Q638: { cls: true } };
      const ids = [...q.matchAll(/wd:(Q\d+)/g)].map((m) => m[1]).filter((id) => kinds[id]);
      return { results: { bindings: [...new Set(ids)].map((id) => ({ c: uri(id), country: bool(kinds[id].country), occ: bool(kinds[id].occ), cls: bool(kinds[id].cls), human: bool(false) })) } };
    }
    if (/wdt:P279\* \?g/.test(q)) return { results: { bindings: /wd:Q638\b/.test(q) ? [{ c: uri('Q638'), g: uri('Q17537576') }] : [] } };
    if (/wdt:P106 wd:Q937857/.test(q)) {
      lastProbe = q;
      const n = /LIMIT 20001/.test(q) ? 20001 : Number((q.match(/LIMIT (\d+)/) || [])[1]) || 0;
      if (/LIMIT 20001/.test(q) && !/wdt:P27 wd:Q142/.test(q)) throw new Error('nationalité absente de la requête : ' + q);
      if (!/LIMIT 20001/.test(q) && !/ORDER BY DESC\(\?sl\)/.test(q)) throw new Error('les plus connus doivent être triés par sitelinks');
      return { results: { bindings: Array.from({ length: n }, (_, i) => ({ item: uri('Q' + (900000 + i)), title: lit('Joueur ' + (i + 1)), desc: lit('footballeur français') })) } };
    }
    const b = [];
    const add = (item, p, v, l, f) => b.push({ item: { type: 'uri', value: 'http://www.wikidata.org/entity/' + item }, p: { type: 'uri', value: 'http://www.wikidata.org/prop/direct/' + p }, v: { type: 'uri', value: 'http://www.wikidata.org/entity/' + v }, ...(l ? { l: { type: 'literal', value: l } } : {}), ...(f ? { f: { type: 'literal', value: f } } : {}) });
    if (/Q36844/.test(q)) { add('Q36844', 'P31', 'Q5', 'être humain'); add('Q36844', 'P21', 'Q6581072', 'féminin'); add('Q36844', 'P106', 'Q177220', 'chanteur ou chanteuse', 'chanteuse'); add('Q36844', 'P27', 'Q244', 'Barbade'); }
    if (/Q30034/.test(q)) add('Q30034', 'P31', 'Q16521', 'taxon');
    return { results: { bindings: b } };
  }
  const p = Object.fromEntries(u.searchParams);
  if (p.origin !== '*' || p.format !== 'json' || p.formatversion !== '2') throw new Error('paramètres Wikipédia manquants : ' + url);
  // HTML rendu d'une page (tableaux : colonne clé) ; une page sans tableau rend un paragraphe.
  if (p.action === 'parse') {
    if (p.prop !== 'text' || p.redirects !== '1' || !p.page) throw new Error('lecture du HTML incorrecte : ' + url);
    parseCalls.push(p.page);
    const html = p.page === TL_PAGE ? TL_HTML : p.page === GR_PAGE ? GR_HTML : p.page === 'Tableau périodique des éléments' ? PERIODIC_HTML : '<div class="mw-parser-output"><p>Une page sans tableau.</p></div>';
    return { parse: { title: p.page, pageid: 1, text: html } };
  }
  if (p.list === 'search' && p.srnamespace === '0' && /^"est un /.test(p.srsearch)) {
    // Recherche de la formule (« Définition Wikipédia ») : seulement son nombre d'articles et quelques extraits.
    if (p.srsearch.length > 300 || p.srinfo !== 'totalhits') throw new Error('recherche de la formule incorrecte : ' + p.srsearch);
    const hl = (s) => s.replace(/\b(est|une|maladie|cathédrale)\b/g, '<span class="searchmatch">$1</span>');
    if (p.srsearch.includes('"est une maladie"~1') && p.srsearch.includes('"sont des maladies"~1')) {
      return { query: { searchinfo: { totalhits: DEF_MALADIE.length }, search: [{ title: 'Grippe', snippet: hl('La grippe ou l&#039;influenza est une maladie infectieuse et contagieuse') }] } };
    }
    if (p.srsearch.includes('"est une cathédrale"~1')) return { query: { searchinfo: { totalhits: 12000 }, search: [{ title: 'Cathédrale 1', snippet: hl('La cathédrale 1 est une cathédrale gothique') }] } };
    return { query: { searchinfo: { totalhits: 0 }, search: [] } };
  }
  // Cartes citées dans le chat (« # ») : articles par préfixe seuls (ARTICLE_PREFIX, par le texte tapé replié).
  if (p.list === 'prefixsearch' && !p.generator) {
    if (p.psnamespace !== '0' || p.pslimit !== '8' || !p.pssearch) throw new Error('articles par préfixe (chat) incorrects : ' + url);
    chatPrefix.push(p.pssearch);
    return { batchcomplete: true, query: { prefixsearch: (ARTICLE_PREFIX[foldT(p.pssearch)] || []).map((title) => ({ ns: 0, title })) } };
  }
  // Suggestions de catégories : par préfixe (et, dans la même requête, les pages « Liste de… » et les articles par
  // préfixe), puis plein texte, avec leur taille (categoryinfo) dans la même réponse ; pages rendues dans le désordre
  // (l'interface les range par index). Plein texte : « races » trouve « race » (racine, comme CirrusSearch).
  if (p.generator === 'prefixsearch' || (p.generator === 'search' && p.gsrnamespace === '14')) {
    const prefix = p.generator === 'prefixsearch';
    if ((prefix ? p.gpsnamespace : p.gsrnamespace) !== '14' || p.prop !== 'categoryinfo') throw new Error('suggestions de catégories incorrectes : ' + url);
    const q = foldT(prefix ? p.gpssearch : p.gsrsearch);
    catSuggest.push([prefix ? 'prefix' : 'search', prefix ? p.gpssearch : p.gsrsearch]);
    const stem = (w) => (w.length >= 5 ? w.replace(/s$/, '') : w);
    const titles = Object.keys(CATS).sort().filter((t) => (prefix ? !CATS[t].noPrefix && foldT(t.slice(10)).startsWith(q) : q.split(/\s+/).every((w) => foldT(t.slice(10)).includes(stem(w)))))
      .slice(0, Number(prefix ? p.gpslimit : p.gsrlimit) || 10);
    const query = { pages: titles.map((title, i) => ({ ns: 14, title, index: i + 1, categoryinfo: catInfo(title) })).reverse() };
    if (p.list) {
      if (!prefix || p.list !== 'search|prefixsearch' || p.srnamespace !== '0' || p.psnamespace !== '0' || !/^intitle:liste /.test(p.srsearch) || p.pssearch !== p.gpssearch) {
        throw new Error('suggestions : pages de liste ou articles par préfixe incorrects : ' + url);
      }
      query.search = listSearch(p.srsearch).map((r) => ({ ns: 0, ...r }));
      query.prefixsearch = (ARTICLE_PREFIX[foldT(p.pssearch)] || []).map((title) => ({ ns: 0, title }));
    }
    return { batchcomplete: true, query };
  }
  // Titres exacts (suggestions, adresse collée) : catégories avec leur taille, pages avec leurs pageprops ; normalisation
  // (majuscule) et redirections comme Wikipédia.
  if (p.prop === 'categoryinfo|pageprops') {
    if (p.redirects !== '1' || p.ppprop !== 'disambiguation') throw new Error('titres exacts : redirections ou homonymies non demandées : ' + url);
    catSuggest.push(['exact', p.titles]);
    const normalized = [];
    const redirects = [];
    const pages = [];
    for (const t of p.titles.split('|')) {
      let cur = t.replace(/^Category:/, 'Catégorie:');
      cur = cur.startsWith('Catégorie:') ? 'Catégorie:' + cur.charAt(10).toUpperCase() + cur.slice(11) : cur.charAt(0).toUpperCase() + cur.slice(1);
      if (cur !== t) normalized.push({ from: t, to: cur });
      if (REDIRECTS[cur]) { redirects.push({ from: cur, to: REDIRECTS[cur] }); cur = REDIRECTS[cur]; }
      if (pages.some((x) => x.title === cur)) continue;
      if (cur.startsWith('Spécial:')) pages.push({ ns: -1, title: cur, special: true, missing: true });
      else if (CATS[cur]) pages.push({ ns: 14, title: cur, categoryinfo: catInfo(cur) });
      else if (cur.startsWith('Catégorie:')) pages.push({ ns: 14, title: cur, missing: true });
      else if (WIKI[cur]) pages.push({ ns: 0, title: cur, pageprops: WIKI[cur].disamb ? { disambiguation: '' } : {} });
      else pages.push({ ns: 0, title: cur, missing: true });
    }
    return { batchcomplete: true, query: { normalized, redirects, pages } };
  }
  if (p.generator === 'search') {
    if (p.gsrnamespace !== '0' || p.prop !== 'cirrusdoc|description|pageprops' || p.cdincludes !== 'opening_text' || !/wikibase_item/.test(p.ppprop) || !/disambiguation/.test(p.ppprop)) throw new Error('lecture des définitions incorrecte : ' + url);
    defCalls.push({ q: p.gsrsearch, sort: p.gsrsort, offset: Number(p.gsroffset), limit: Number(p.gsrlimit) });
    const page = (d, i) => ({ title: d.title, index: i + 1, ...(d.desc ? { description: d.desc } : {}), pageprops: { ...(d.q ? { wikibase_item: d.q } : {}), ...(d.disamb ? { disambiguation: '' } : {}) },
      cirrusdoc: [{ index: 'frwiki_content', id: String(i + 1), source: d.open ? { opening_text: d.open } : {} }] });
    if (p.gsrsearch.includes('"est une maladie"~1')) {
      if (p.gsrsort !== 'title_natural_asc') throw new Error('tous les articles : tri par titre attendu (pages stables)');
      return { batchcomplete: true, query: { pages: DEF_MALADIE.map(page).reverse() } }; // dans le désordre : l'interface trie par index
    }
    if (p.gsrsearch.includes('"est une cathédrale"~1')) {
      if (p.gsrsort !== 'incoming_links_desc') throw new Error('les plus connus : tri par liens entrants attendu');
      const from = Number(p.gsroffset) || 0;
      const to = Math.min(12000, from + Number(p.gsrlimit));
      const docs = [];
      for (let i = from; i < to; i++) docs.push(i % 4 === 3 ? { title: `Ville ${i + 1}`, open: `Ville ${i + 1} est une ville de France.`, q: 'Q' + (950000 + i) }
        : { title: `Cathédrale ${i + 1}`, open: `La cathédrale ${i + 1} est une cathédrale gothique.`, desc: 'cathédrale', q: 'Q' + (950000 + i) });
      return { ...(to < 12000 ? { continue: { gsroffset: to, continue: 'gsroffset||' } } : {}), query: { pages: docs.map((d, k) => page(d, from + k)) } };
    }
    throw new Error('formule inattendue : ' + p.gsrsearch);
  }
  if (p.list === 'search' && p.srnamespace === '0') {
    if (!/^intitle:liste /.test(p.srsearch)) throw new Error('recherche de listes sans intitle : ' + p.srsearch);
    return { query: { search: listSearch(p.srsearch) } };
  }
  if (p.generator === 'links') {
    if (!['Liste de races bovines', 'Liste de noms de couleur', 'Tableau périodique des éléments', TL_PAGE, GR_PAGE].includes(p.titles) || p.gplnamespace !== '0' || p.redirects !== '1') throw new Error('liens demandés incorrects : ' + url);
    linkCalls.push(p.titles);
    if (p.titles === TL_PAGE) {
      const pages = Object.entries(TL).map(([title, [q]]) => ({ title, pageprops: { wikibase_item: q } }));
      pages.push({ title: 'Denis Inconnu', missing: true }, { title: 'Martin', pageprops: { disambiguation: '', wikibase_item: 'Q901099' } }, { title: 'Testlande (pays)', missing: true });
      return { batchcomplete: true, query: { redirects: [{ from: 'E. Dubois', to: 'Émile Dubois' }], pages } };
    }
    if (p.titles === GR_PAGE) return { batchcomplete: true, query: { pages: Object.entries(GR).map(([title, [q]]) => ({ title, pageprops: { wikibase_item: q } })) } };
    if (p.titles === 'Liste de noms de couleur') {
      const pages = Object.entries(COLOR_LINKS).map(([title, [q]]) => ({ title, pageprops: { wikibase_item: q } }));
      pages.push({ title: 'Couleur (homonymie)', pageprops: { disambiguation: '', wikibase_item: 'Q900308' } });
      return { batchcomplete: true, query: { pages } };
    }
    if (p.titles === 'Tableau périodique des éléments') return { batchcomplete: true, query: { pages: [{ title: 'Hydrogène', pageprops: { wikibase_item: 'Q556' } }, { title: 'Hélium', pageprops: { wikibase_item: 'Q560' } }] } };
    const pages = Object.entries(LINKS).map(([title, q]) => ({ title, pageprops: { wikibase_item: q } }));
    pages.push({ title: 'Race inconnue', missing: true }, { title: 'Salers', pageprops: { disambiguation: '', wikibase_item: 'Q900105' } });
    return { batchcomplete: true, query: { pages } };
  }
  if (p.list === 'search') {
    if (p.srnamespace !== '14') throw new Error('recherche hors des catégories');
    return { query: { search: /footballeur/i.test(p.srsearch) ? [{ title: 'Catégorie:Footballeur international français' }, { title: 'Catégorie:Footballeur français' }] : [] } };
  }
  if (p.list === 'categorymembers') {
    const M = { 'Catégorie:Exemples de test': { page: Array.from({ length: 40 }, (_, i) => 'Article ' + (i + 1)), subcat: [] },
      'Catégorie:Footballeur international français': { page: ['Zinédine Zidane', 'Thierry Henry', 'Kylian Mbappé'], subcat: ['Catégorie:Footballeur international français espoir'] },
      'Catégorie:Footballeur international français espoir': { page: ['Jeune Espoir', 'Thierry Henry'], subcat: [] } };
    const m = M[p.cmtitle] || (CATS[p.cmtitle] ? { page: CATS[p.cmtitle].page || [], subcat: CATS[p.cmtitle].subcat || [] } : { page: [], subcat: [] });
    if (p.cmtype === 'page' && p.cmnamespace !== '0') throw new Error('membres hors de l\'espace principal');
    return { query: { categorymembers: (m[p.cmtype] || []).map((title) => ({ title })) } };
  }
  if (p.prop === 'categories') {
    if (p.clshow !== '!hidden') throw new Error('catégories cachées demandées : ' + url);
    const titles = p.titles.split('|');
    if (titles.every((t) => t.startsWith('Catégorie:'))) {
      // Catégories parentes des propositions.
      parentCalls.push(...titles);
      return { query: { pages: titles.map((title) => ({ ns: 14, title, categories: (CAT_PARENTS[title] || []).map((c) => ({ ns: 14, title: 'Catégorie:' + c })) })) } };
    }
    propose.categories++;
    return { query: { pages: titles.map((title) => {
      const n = Number((title.match(/^Article (\d+)$/) || [])[1]);
      const cat = n >= 1 && n <= 10 ? 'Catégorie:Exemples de test' : n >= 41 && n <= 45 ? 'Catégorie:Autre essai' : null;
      const cats = CARD_CATS[title] ? CARD_CATS[title].map((c) => 'Catégorie:' + c) : cat ? [cat] : [];
      return { title, categories: cats.map((c) => ({ title: c })) };
    }) } };
  }
  if (p.prop === 'categoryinfo') {
    const I = { 'Catégorie:Footballeur international français': { pages: 3, subcats: 1 }, 'Catégorie:Footballeur français': { pages: 32000, subcats: 40 },
      'Catégorie:Exemples de test': { pages: 40, subcats: 0 }, 'Catégorie:Autre essai': { pages: 50, subcats: 0 } };
    return { query: { pages: p.titles.split('|').map((title) => ({ title, categoryinfo: I[title] || catInfo(title) || { pages: 0, subcats: 0 } })) } };
  }
  const titles = p.titles.split('|');
  if (/pageviews/.test(p.prop || '') && !p.pvipcontinue) pvAsked.push(...titles);
  const normalized = [];
  const redirects = [];
  const pages = [];
  for (const t of titles) {
    let cur = t;
    const n = t.charAt(0).toUpperCase() + t.slice(1);
    if (n !== t) { normalized.push({ from: t, to: n }); cur = n; }
    if (REDIRECTS[cur]) { redirects.push({ from: cur, to: REDIRECTS[cur] }); cur = REDIRECTS[cur]; }
    const w = WIKI[cur];
    if (!w) { pages.push({ title: cur, missing: true }); continue; }
    const page = { title: cur };
    if (/pageprops/.test(p.prop)) page.pageprops = w.disamb ? { disambiguation: '' } : { wikibase_item: w.q };
    if (/description/.test(p.prop) && w.desc) page.description = w.desc;
    if (/pageimages/.test(p.prop) && w.thumb) page.thumbnail = { source: w.thumb };
    if (/pageviews/.test(p.prop) && w.pv) {
      // Première réponse sans les vues, avec une continuation : l'interface doit la suivre.
      if (!p.pvipcontinue) { pvContinueSeen = false; return { continue: { pvipcontinue: '1', continue: '||' }, query: { normalized, redirects, pages: titles.map((x) => ({ title: x })) } }; }
      pvContinueSeen = true;
      page.pageviews = { '2026-10-01': Math.floor(w.pv / 2), '2026-10-02': w.pv - Math.floor(w.pv / 2), '2026-10-03': null };
    }
    pages.push(page);
  }
  return { batchcomplete: true, query: { normalized, redirects, pages } };
}

// ------------------------------------------------------------------ montage
// Historique d'une page : entrées (adresses), position ; pushState / replaceState posent le fragment de location (« # »
// seul = vide, comme un navigateur) ; back() / forward() changent d'entrée et envoient popstate à la fenêtre. log : les
// appels, « push #/cartes » ou « replace #/cartes ».
function fakeHistory(getCtx, win) {
  const hashOf = (url) => { const i = String(url).indexOf('#'); const h = i < 0 ? '' : String(url).slice(i); return h === '#' ? '' : h; };
  const hist = {
    entries: null, index: 0, log: [],
    init() { if (!hist.entries) hist.entries = [getCtx().location.hash || '']; },
    replaceState(a, b, url) { hist.init(); const h = hashOf(url); hist.entries[hist.index] = h; getCtx().location.hash = h; getCtx().lastReplace = url; hist.log.push('replace ' + h); },
    pushState(a, b, url) { hist.init(); const h = hashOf(url); hist.entries = hist.entries.slice(0, hist.index + 1); hist.entries.push(h); hist.index++; getCtx().location.hash = h; hist.log.push('push ' + h); },
    go(n) {
      hist.init();
      const i = hist.index + n;
      if (i < 0 || i >= hist.entries.length) return;
      hist.index = i;
      getCtx().location.hash = hist.entries[i];
      for (const f of [...(win.listeners.popstate || [])]) f({ type: 'popstate' });
    },
    back() { hist.go(-1); },
    forward() { hist.go(1); },
  };
  return hist;
}

async function main() {
  const { doc, win, walk } = makeDom();
  const api = SERVER ? null : mockApi();
  const errors = [];
  const ls = new Map();
  const copied = [];
  const idb = fakeIndexedDB();
  const apiLog = []; // appels à /api/ de toutes les pages, « GET /api/cards?since=3 »
  const apiKeyLog = []; // les mêmes, avec la clé envoyée et l'heure : {call, key, at}
  const catalogFetches = []; // demandes de /catalog.json (aucune attendue)
  // /nouveautes.json servi aux pages : le vrai fichier (body null), ou un texte d'essai ; status ≠ 200 : fichier absent.
  const newsFile = { body: null, status: 200, fetches: 0 };
  // Contexte d'une page du classeur ; toutes les pages sont dans le même navigateur (localStorage, IndexedDB, API).
  // opts.idb : 'absent' (pas d'IndexedDB) ou 'refusé' (son accès lève une erreur, comme un stockage bloqué) ;
  // opts.hold(url) : promesse attendue avant de répondre à un appel de l'API ; opts.wikiHold(url) : de même pour
  // Wikipédia et Wikidata (une réponse abandonnée pendant l'attente est rejetée) ; opts.hash : fragment de l'adresse
  // (« #cle=… ») ; opts.speed : horloge de la page (minuteries et Date) accélérée d'autant, pour les longues attentes.
  function makeCtx(doc, win, opts = {}) {
    const ctx = {
      console: { log: console.log, warn: (...a) => { errors.push('warn: ' + a.join(' ')); }, error: (...a) => { errors.push('error: ' + a.map((x) => (x && x.stack) || x).join(' ')); } },
      document: doc, window: null, navigator: { clipboard: { writeText: async (t) => { copied.push(t); } } },
      location: { origin: ORIGIN, pathname: '/', search: '', hash: opts.hash || '', hostname: 'classeur.example' },
      history: fakeHistory(() => ctx, win),
      localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
      setTimeout, clearTimeout, setInterval, clearInterval, Promise, Date, Math, JSON, Map, Set, WeakMap, WeakSet, Symbol, Proxy, Reflect, Object, Array, Number, String, Boolean, RegExp, Error, TypeError, SyntaxError,
      Intl, URL, URLSearchParams, encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, isNaN, parseInt, parseFloat, Infinity, NaN, undefined,
      requestAnimationFrame: (f) => setTimeout(f, 0), getComputedStyle: () => ({}),
      matchMedia: () => ({ matches: false }),
      scrollTo: () => {},
      SVGElement: function SVGElement() {},
      Element: function Element() {},
      Node: function Node() {},
      queueMicrotask, AbortController, DOMParser: FakeDOMParser,
    };
    ctx.window = ctx;
    ctx.self = ctx;
    if (opts.speed) {
      const k = opts.speed;
      const t0 = Date.now();
      const now = () => t0 + (Date.now() - t0) * k;
      ctx.setTimeout = (f, ms, ...a) => setTimeout(f, (Number(ms) || 0) / k, ...a);
      ctx.setInterval = (f, ms, ...a) => setInterval(f, (Number(ms) || 0) / k, ...a);
      ctx.Date = class extends Date { constructor(...a) { super(...(a.length ? a : [now()])); } static now() { return now(); } };
    }
    // Minuteries répétées d'une minute ou plus (relecture de GET /api/me toutes les 60 s, onglet visible) : jamais lancées
    // d'elles-mêmes, pour ne pas tomber au hasard au milieu d'un autre test ; rangées dans opts.longTimers (id → fonction)
    // et déclenchées à la main (openPage(…).live()).
    const longs = opts.longTimers || new Map();
    const shortInterval = ctx.setInterval;
    let longId = 0;
    ctx.setInterval = (f, ms, ...a) => {
      if ((Number(ms) || 0) < 60000) return shortInterval(f, ms, ...a);
      longId += 1;
      longs.set('long-' + longId, () => f(...a));
      return 'long-' + longId;
    };
    ctx.clearInterval = (id) => (longs.delete(id) ? undefined : clearInterval(id));
    ctx.addEventListener = win.addEventListener;
    ctx.removeEventListener = win.removeEventListener;
    ctx.fetch = async (url, init = {}) => {
      const headers = init.headers || {};
      const method = init.method || 'GET';
      const body = init.body ? JSON.parse(init.body) : undefined;
      if (/^https:\/\/(fr\.wikipedia\.org|query\.wikidata\.org|www\.wikidata\.org)\//.test(url)) {
        if (init.signal && init.signal.aborted) { const e = new Error('abandon'); e.name = 'AbortError'; throw e; }
        const data = wikiHandle(url);
        if (opts.wikiHold) { // réponse de Wikipédia rendue plus tard (réseau lent) ; abandonnée entre-temps : rejetée
          await opts.wikiHold(url);
          if (init.signal && init.signal.aborted) { const e = new Error('abandon'); e.name = 'AbortError'; throw e; }
        }
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => data };
      }
      // Le catalogue Wikidata a été retiré de l'interface (2026-10-16) : il ne doit plus jamais être demandé.
      if (/catalog\.json/.test(String(url))) { catalogFetches.push(url); throw new Error('catalogue demandé : ' + url); }
      if (url === '/nouveautes.json') {
        newsFile.fetches++;
        const body = newsFile.body ?? fs.readFileSync(path.join(PUB, 'nouveautes.json'), 'utf8');
        return { ok: newsFile.status === 200, status: newsFile.status, headers: { get: () => null }, json: async () => JSON.parse(body) };
      }
      if (!url.startsWith('/api/')) throw new Error('adresse inattendue : ' + url);
      apiLog.push(method + ' ' + url);
      apiKeyLog.push({ call: method + ' ' + url, key: headers['X-Classeur-Key'] || '', at: Date.now() });
      if (SERVER) {
        if (opts.hold) await opts.hold(url);
        const r = await fetch(SERVER + url, { method, headers, body: init.body });
        const text = await r.text();
        return { ok: r.ok, status: r.status, headers: r.headers, json: async () => JSON.parse(text) };
      }
      const r = api.handle(method, url, headers, body);
      if (opts.hold) await opts.hold(url); // réponse calculée à l'appel, rendue plus tard (réseau lent)
      return { ok: r.status < 400, status: r.status, headers: { get: () => null }, json: async () => JSON.parse(JSON.stringify(r.body)) };
    };
    if (opts.idb === 'refusé') Object.defineProperty(ctx, 'indexedDB', { get() { throw new Error('SecurityError : stockage refusé'); } });
    else if (opts.idb !== 'absent') ctx.indexedDB = idb;
    vm.createContext(ctx);
    return ctx;
  }
  const mainOpts = {};
  const ctx = makeCtx(doc, win, mainOpts);

  check0(!fs.existsSync(path.join(PUB, 'catalog.json')), 'site/public/catalog.json ne doit plus exister (catalogue retiré)');
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  // L'index charge Vue depuis cdnjs (avec SRI) puis /assets/app.js.
  if (!/vue\.runtime\.global\.prod\.min\.js" integrity="sha384-/.test(html)) fail('Vue (runtime) avec SRI absent de index.html');
  for (const id of [...html.matchAll(/<symbol id="([\w-]+)"/g)].map((m) => m[1])) ctx.__symbols = (ctx.__symbols || []).concat(id);
  const app = doc.createElement('div');
  app.setAttribute('id', 'app');
  doc.body.appendChild(app);
  vm.runInContext(fs.readFileSync(VUE, 'utf8'), ctx, { filename: 'vue.js' });
  for (const m of ['match.js', 'propose.js']) vm.runInContext(fs.readFileSync(path.join(PUB, 'assets', m), 'utf8'), ctx, { filename: m });
  check0(/assets\/match\.js[\s\S]*assets\/propose\.js[\s\S]*assets\/app\.js/.test(html), 'match.js et propose.js doivent être chargés avant app.js');
  vm.runInContext(fs.readFileSync(path.join(PUB, 'assets', 'app.js'), 'utf8'), ctx, { filename: 'app.js' });

  const settle = async (ms = 30) => { const t = SERVER ? Math.max(ms, 250) : ms; for (let i = 0; i < 6; i++) await sleep(t / 6); };
  const all = (pred) => { const out = []; walk(doc.documentElement, (n) => { if (n.nodeType === 1 && pred(n)) out.push(n); }); return out; };
  const text = (n) => (n ? n.textContent.replace(/[  ]/g, ' ') : '');
  const cls = (c) => all((n) => n.classList.contains(c));
  const one = (c) => cls(c)[0] || null;
  const buttonByText = (t) => all((n) => n.tagName === 'BUTTON' && text(n).includes(t))[0] || null;
  const needButton = (t) => { const b = buttonByText(t); if (!b) fail('bouton absent : ' + t + '\n' + text(doc.body).slice(0, 600)); return b; };
  const type = (input, v) => { input.value = v; input.dispatch('input'); };
  const byId = (id) => doc.getElementById(id);
  const has = (t) => text(doc.body).includes(t);
  const check = (cond, m) => { if (!cond) fail(m + '\n--- page ---\n' + text(doc.body).slice(0, 1200)); };
  const usedIcons = () => all((n) => n.localName === 'use').map((n) => n.getAttribute('href').slice(1));
  // Appel direct de l'API (hors interface), simulée ou réelle.
  const rawApi = async (method, p, key, body) => {
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['X-Classeur-Key'] = key;
    if (SERVER) { const r = await fetch(SERVER + p, { method, headers, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; }
    return api.handle(method, p, headers, body || {});
  };
  // Collection enregistrée par l'API, en morceaux (upload de targets.js) au-delà de 500 Ko d'éléments, comme la page.
  const rawSave = async (key, body) => {
    const items = body.items || [];
    const size = Buffer.byteLength(JSON.stringify(items));
    if (size <= 500 * 1024) return rawApi('POST', '/api/targets/save', key, body);
    const n = Math.ceil(size / (450 * 1024));
    const cut = Math.ceil(items.length / n);
    const id = 'brut-' + Math.random().toString(36).slice(2, 12);
    for (let k = 0; k < n - 1; k++) {
      const r = await rawApi('POST', '/api/targets/save', key, { items: items.slice(k * cut, (k + 1) * cut), upload: { id, part: k } });
      if (r.status !== 200) return r;
    }
    return rawApi('POST', '/api/targets/save', key, { ...body, items: items.slice((n - 1) * cut), upload: { id, part: n - 1, last: true } });
  };
  const makeOtherAccount = async (name) => {
    const r = await rawApi('POST', '/api/account', null, { code: SERVER ? (process.env.SIGNUP_CODE || 'dev') : 'dev', name });
    if (r.status !== 201) fail('second compte : ' + JSON.stringify(r.body));
    // Le vrai serveur active le partage à la création ; l'API simulée non : coupé, pour partir du même état.
    if (SERVER) await rawApi('PATCH', '/api/me', r.body.key, { shared: false });
    return r.body.key;
  };
  // Lectures des cartes (GET /api/cards…) faites par les pages depuis `mark` (position dans apiLog).
  const cardCalls = (mark) => apiLog.slice(mark).filter((x) => x.startsWith('GET /api/cards'));
  // Nombre de cartes du bandeau d'une page (« 1 050 cartes différentes »), ou null s'il n'est pas affiché.
  // Tuile « N collections » du bandeau : le nombre de « Mes collections » (sans les catégories suivies, sans total).
  const colFigure = () => { const f = cls('figure').find((n) => /^collections?$/.test(text(n.querySelector('span')))); return f ? text(f.querySelector('b')) + ' ' + text(f.querySelector('span')) : null; };
  const countIn = (d) => {
    const f = d.querySelectorAll('.figure').find((n) => text(n).includes('cartes différentes'));
    return f ? Number(text(f.querySelector('b')).replace(/\D/g, '')) : null;
  };
  const waitFor = async (cond, ms = 3000) => { for (let t = 0; t < ms && !cond(); t += 25) await sleep(25); return cond(); };
  // Collection d'un compte dans le jeu, lue par le serveur (cartes sous la forme de GET /api/cards, sans leurs tags du
  // classeur) : lecture complète vérifiée, les cartes absentes sont retirées. Serveur local : son faux jeu (FAUX_JEU=1)
  // relie le compte s'il ne l'est pas, puis lit.
  const fakeGame = async (action, body) => {
    const r = await fetch(SERVER + '/__jeu/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 404 || r.status === 405) fail('serveur local sans faux jeu : lance-le avec FAUX_JEU=1 (node dev/server.mjs)');
    const out = await r.json();
    if (!r.ok) fail(`faux jeu (${action}) : ${out.error || r.status}`);
    return out;
  };
  const seedCards = async (key, list) => {
    const rows = list.map(({ tags, ...c }) => c);
    if (SERVER) return fakeGame('collection', { key, cards: rows });
    return api.seed(key, rows);
  };
  // Cartes de la table `cards` du jeu (lignes {id, wikipedia_title, rarity, category, image_url, lang}) : celles que cherche
  // « Depuis le jeu ».
  const setGameTable = async (rows) => {
    if (SERVER) return fakeGame('cartes', { cards: rows });
    api.gameCards = rows;
  };
  // Collection du compte dans le jeu (sans la lire) et cookie d'une fenêtre privée connectée à ce compte.
  const setGame = async (key, list) => {
    const rows = list.map(({ tags, ...c }) => c);
    if (SERVER) return (await fakeGame('joueur', { key, cards: rows })).cookie;
    api.users.find((u) => u.key === key).game = rows;
    return 'theme=sombre; sb-cyrxjeppjqsxxjayfrur-auth-token=base64-faux; autre=1';
  };
  // Le classeur rouvert dans une autre page du même navigateur (localStorage, IndexedDB et API partagés). live() :
  // déclenche ses minuteries d'une minute ou plus (relecture périodique), longTimers : celles en place.
  const openPage = (opts) => {
    const p = makeDom();
    const longTimers = new Map();
    const c = makeCtx(p.doc, p.win, { ...opts, longTimers });
    const box = p.doc.createElement('div');
    box.setAttribute('id', 'app');
    p.doc.body.appendChild(box);
    for (const file of [VUE, ...['match.js', 'propose.js', 'app.js'].map((m) => path.join(PUB, 'assets', m))]) vm.runInContext(fs.readFileSync(file, 'utf8'), c, { filename: path.basename(file) });
    return { doc: p.doc, win: p.win, ctx: c, count: () => countIn(p.doc), visible: async () => { for (const f of p.doc.listeners.visibilitychange || []) await f(); },
      longTimers, live: async () => { for (const f of [...longTimers.values()]) await f(); } };
  };
  const cachedCards = () => { const m = idb.dump('classeur', 'cards'); return m ? [...m.values()] : []; };

  await settle(60);
  // 1. Accueil
  check(has('Créer mon classeur') && has("J'ai déjà un lien"), "l'accueil ne s'affiche pas");
  const codeInput = all((n) => n.tagName === 'INPUT' && n.getAttribute('autocomplete') === 'off' && n.getAttribute('required') !== null)[0];
  check(codeInput, 'champ du code absent');
  const nameInput = all((n) => n.getAttribute && n.getAttribute('autocomplete') === 'given-name')[0];
  type(nameInput, 'Cédric');
  type(codeInput, 'mauvais');
  needButton('Créer mon classeur').click();
  await settle(SERVER ? 300 : 30);
  check(has("Code d'invitation incorrect."), "l'erreur de l'API ne s'affiche pas telle quelle");
  type(codeInput, SERVER ? (process.env.SIGNUP_CODE || 'dev') : 'dev');
  needButton('Créer mon classeur').click();
  await settle(SERVER ? 300 : 30);
  check(has('Ton classeur est prêt, Cédric.'), 'pas de lien personnel après création');
  const linkInput = byId('new-link');
  check(linkInput && /^https:\/\/classeur\.example\/#cle=[A-Za-z0-9_-]{20,}$/.test(linkInput.value), 'lien personnel mal formé : ' + (linkInput && linkInput.value));
  check(ls.get('classeur-key'), 'clé non rangée dans localStorage');
  needButton("C'est noté").click();
  await settle(60);

  // 2. Classeur vide : bandeau, onglets, et l'onglet « Synchro » ouvert sur la liaison du compte du jeu
  const h1 = () => text(doc.body.querySelector('h1'));
  const tabBtn = (id) => byId('tab-' + id);
  const goTab = async (id) => { tabBtn(id).click(); await settle(); };
  // Bouton du contenu de l'onglet « Synchro » (le bandeau a aussi un « Relier mon compte »).
  const syncButton = (t) => { const u = one('update'); const b = u && u.querySelectorAll('button').find((n) => text(n).trim() === t); if (!b) fail('bouton absent de « Synchro » : ' + t + '\n' + text(u).slice(0, 600)); return b; };
  const relierLink = () => all((n) => n.tagName === 'A' && n.classList.contains('bookmarklet'))[0] || null;
  check(h1() === 'Le classeur de Cédric' && has('Collections WikiMasters'), 'bandeau absent');
  check(has('Ton classeur est vide') && has('relie ton compte du jeu dans « Synchro »'), 'le bandeau ne dit pas que le classeur est vide');
  check(tabBtn('maj') && tabBtn('maj').getAttribute('aria-selected') === 'true' && text(tabBtn('maj')) === 'Synchro', "un classeur vide doit s'ouvrir sur « Synchro »");
  check(has('Aucun compte du jeu relié') && has('Relier mon compte du jeu') && has('En secours : coller le cookie ou déposer un HAR') && has('Dernières synchros'),
    "l'onglet « Synchro » ne présente pas l'état du compte, la liaison, le secours et le journal");
  check(!relierLink() && !has('Rafraîchir maintenant') && !byId('set-auto-sync'), 'sans compte relié : ni favori, ni « Rafraîchir maintenant », ni « Synchro automatique »');
  check(!has('Tampermonkey') && !has("clé d'import") && !has('favori court'), "restes de l'ancien favori de synchro");
  // « Relier mon compte » : jeton à usage unique (POST /api/link), dans un favori court qui le pose dans
  // window.__classeurLien et charge /api/favori.js ; jamais la clé du classeur.
  syncButton('Relier mon compte').click();
  await settle(SERVER ? 300 : 60);
  const rl = relierLink();
  check(rl && text(rl).includes('Relier au classeur'), 'favori « Relier » absent après « Relier mon compte »');
  const href = rl.getAttribute('href') || rl.href;
  check(href && href.startsWith('javascript:') && href.length < 400 && !/[\s#"<>]/.test(href.slice(11)), 'adresse du favori « Relier » mal formée : ' + href);
  const relierCode = decodeURI(href.slice(11));
  const linkToken = (relierCode.match(/window\.__classeurLien=\{t:"([A-Za-z0-9_-]{20,64})"\}/) || [])[1];
  check(linkToken && (SERVER || linkToken === api.st.linkToken), 'jeton de liaison absent du favori : ' + relierCode);
  check(relierCode.includes('"' + ORIGIN + '/api/favori.js"') && !relierCode.includes(ls.get('classeur-key')), 'favori « Relier » : adresse du code ou clé incorrecte : ' + relierCode);
  try { new vm.Script(relierCode); } catch (e) { fail('favori « Relier » : code invalide : ' + e.message); }
  check(byId('link-url') && byId('link-url').value === href, 'adresse du favori « Relier » à copier absente');
  check(has('fenêtre privée') && has('sans te déconnecter') && has('Le favori vaut 30 minutes') && has('En attente de la liaison'), 'étapes de la liaison absentes');
  rl.dispatch('click');
  await settle();
  check(has('Pas ici'), 'clic sur le favori dans le classeur non intercepté');

  // 3. Le favori dans une fenêtre privée connectée au jeu : il envoie le jeton et le cookie de la page
  // (POST /api/link/session) ; le classeur, qui relit GET /api/me toutes les 4 s pendant que le jeton vaut, voit la
  // liaison et lit la collection (POST /api/refresh) : 1 050 cartes. Plus de 1 000 changements depuis la révision lue à
  // l'ouverture : le serveur répond delta:false à ?since, et la page relit tout, par morceaux.
  const gameCookie = await setGame(ls.get('classeur-key'), gameCards());
  {
    const away = await runRelier(href, ctx.fetch, gameCookie, 'exemple.fr');
    check(/Ouvre ce favori sur wiki-masters\.com/.test(away.box) && !away.posts.length, 'favori « Relier » hors du jeu : ' + away.box);
    const noSession = await runRelier(href, ctx.fetch, 'theme=sombre');
    check(/Pas de session du jeu/.test(noSession.box) && !noSession.posts.length, 'favori « Relier » sans session : ' + noSession.box);
  }
  let mark = apiLog.length;
  const relie = await runRelier(href, ctx.fetch, gameCookie);
  check(/Compte du jeu relié/.test(relie.box) && relie.posts.length === 1 && relie.posts[0].token === linkToken && relie.posts[0].cookie === gameCookie, 'favori « Relier » : ' + relie.box);
  check(/périmé ou déjà utilisé/.test((await runRelier(href, ctx.fetch, gameCookie)).box), 'favori « Relier » : le jeton doit ne servir qu\'une fois');
  check(await waitFor(() => /1 050 cartes/.test(text(doc.body.querySelector('.refresh-line'))) && !has('Rafraîchissement…'), 10000),
    "la liaison n'a pas lancé la lecture de la collection : " + text(doc.body.querySelector('.refresh-line')));
  await settle(80);
  check(apiLog.slice(mark).filter((x) => x === 'POST /api/refresh').length === 1, 'une lecture attendue après la liaison : ' + apiLog.slice(mark).filter((x) => x.includes('refresh')).join(', '));
  check(has('Compte du jeu relié') && !relierLink() && has('Rafraîchir maintenant') && byId('set-auto-sync') && byId('set-auto-sync').checked, 'état « relié » absent après la liaison');
  {
    const got = cardCalls(mark);
    check(got.length >= 2 && /^GET \/api\/cards\?since=\d+$/.test(got[0]) && got[1] === 'GET /api/cards?part=0' && got.slice(1).every((x) => x.includes('?part=')),
      'delta:false : ?since puis relecture complète attendus : ' + got.join(', '));
    check(SERVER || api.st.calls.some((c) => c === 'cards part curseur-1'), 'le curseur opaque next_part n\'est pas renvoyé tel quel');
  }
  // Liaison faite : la page cesse de relire GET /api/me toutes les 4 s.
  {
    const from = apiLog.length;
    await sleep(4500);
    check(!apiLog.slice(from).includes('GET /api/me'), 'GET /api/me encore relu toutes les 4 s après la liaison');
  }
  // « Synchro automatique » : PATCH /api/me {auto_sync}.
  const autoBox = byId('set-auto-sync');
  autoBox.checked = false;
  autoBox.dispatch('change');
  await settle(SERVER ? 300 : 60);
  check(!byId('set-auto-sync').checked && (SERVER || api.st.autoSync === false), '« Synchro automatique » non décochée');
  byId('set-auto-sync').checked = true;
  byId('set-auto-sync').dispatch('change');
  await settle(SERVER ? 300 : 60);
  check(byId('set-auto-sync').checked && (SERVER || (api.st.autoSync === true && api.st.calls.filter(([m, p, b]) => m === 'PATCH' && p === '/api/me' && 'auto_sync' in b).length === 2)),
    '« Synchro automatique » : PATCH /api/me {auto_sync} attendu deux fois');
  check(has('cartes différentes') && colFigure() === '0 collection' && !has('commencées') && cls('track').length === 1, 'tuiles de chiffres ou barre de répartition absentes : ' + colFigure());
  await goTab('cartes');
  check(cls('cell').length === 120 && cls('card').length === 120, `120 cartes attendues, ${cls('cell').length} affichées`);
  needButton('Afficher plus').click();
  await settle();
  check(cls('cell').length > 120, 'Afficher plus sans effet');

  // 4. Mes cartes : recherche, rareté, tri
  const q = byId('q');
  type(q, 'rihanna');
  await settle();
  check(cls('cell').length === 1 && has('Rihanna'), 'la recherche ne filtre pas');
  check(cls('card__sheen').length === 1 && cls('card__star').length === 0, 'légendaire sans brillance');
  type(q, '');
  const rp = cls('rpill');
  check(rp.length === 6 && text(rp[0]).startsWith('C'), 'pastilles de rareté absentes');
  rp.find((b) => text(b).includes('Légendaire')).dispatch('click', { ctrlKey: true });
  await settle();
  check(cls('cell').length === 1 && cls('cell').every((c) => text(c.querySelector('.pill')) === 'L'), 'Ctrl+clic sur une rareté ne l\'isole pas');
  needButton('Réinitialiser les filtres').click();
  await settle();
  const sel = byId('sort');
  sel.value = 'title';
  sel.dispatch('change');
  await settle();
  const titles = cls('card__title').map(text);
  check(titles.slice(0, 5).join('|') === titles.slice(0, 5).sort((a, b) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' })).join('|'), 'tri par titre incorrect : ' + titles.slice(0, 5).join(' | '));

  // « Nouvelle collection » ouverte sur un onglet (url, mots, liste, props, jeu), dans la page d ; fermée.
  const openNewIn = async (d, mode) => {
    if (!d.getElementById('newcol-panel')) {
      const b = d.querySelectorAll('button').find((n) => text(n).trim() === 'Nouvelle collection');
      if (!b) fail('bouton « Nouvelle collection » absent : ' + text(d.body).slice(0, 400));
      b.click();
      await settle();
    }
    const t = d.getElementById('newcol-tab-' + mode);
    if (!t) fail('onglet « ' + mode + ' » absent de « Nouvelle collection »');
    if (t.getAttribute('aria-selected') !== 'true') { t.click(); await settle(); }
  };
  const closeNewIn = async (d) => { if (d.getElementById('newcol-panel')) { d.querySelectorAll('.modal')[0].querySelector('.close').click(); await settle(); } };
  const openNew = (mode) => openNewIn(doc, mode);
  const catQ = async () => { await openNew('url'); return byId('cat-q'); };
  const modalBtn = (t) => { const m = one('modal'); const x = m && m.querySelectorAll('button').filter((n) => text(n).trim() === t)[0]; if (!x) fail('bouton absent de la fenêtre : ' + t + ' / ' + text(m).slice(0, 400)); return x; };
  // 5. Sélection (Maj+clic) et bande de sélection ; tags à deux niveaux (catégorie facultative)
  const picks = all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox');
  picks[0].click();
  await settle();
  picks[4].click({ shiftKey: true });
  await settle();
  check(one('bulk') && text(one('bulk').querySelector('.count')) === '5', 'Maj+clic : 5 cartes attendues, ' + text(one('bulk') && one('bulk').querySelector('.count')));
  check(one('cardgrid').classList.contains('selecting'), 'mode sélection non signalé à la grille');
  type(byId('bulk-tag'), '  À  échanger ');
  needButton('Ajouter').click();
  await settle();
  check(has('« À échanger » ajouté à 5 cartes.'), 'ajout groupé sans confirmation');
  if (!SERVER) check(api.st.calls.some(([m, p, b]) => p === '/api/tags/bulk' && b.card_ids.length === 5 && b.add[0] === 'À échanger'), 'appel tags/bulk incorrect');
  check(!cls('cell__tags').length && !cls('cardgrid')[0].querySelectorAll('.tag').length, 'les tags ne doivent plus être affichés sous les cartes (seulement dans la fiche)');
  // Une étiquette sans « / » est rangée dans « Autres », catégorie repliée par défaut.
  const catChip = (name) => cls('tagcat').map((n) => n.querySelector('.chip')).find((b) => b && text(b.querySelector('.chip__label')) === name);
  const subChip = (name) => all((n) => n.tagName === 'BUTTON' && n.classList.contains('chip') && n.parentNode.classList.contains('tagcat__subs') && text(n.querySelector('.chip__label')) === name)[0];
  const unfold = async (cat) => { const b = all((n) => n.classList.contains('fold') && n.getAttribute('aria-label') === 'Déplier ' + cat)[0]; if (b) { b.click(); await settle(); } };
  check(catChip('Autres') && text(catChip('Autres').querySelector('.n')) === '5' && !subChip('À échanger'), 'catégorie « Autres » (repliée, 5 cartes) absente');
  // Catégorie choisie dans la bande : « Brésil » + Pays -> « Pays/Brésil » ; la carte n'affiche que « Brésil ».
  picks[0].click();
  await settle();
  type(byId('bulk-tag'), 'Brésil');
  byId('bulk-cat').value = 'Pays';
  byId('bulk-cat').dispatch('change');
  needButton('Ajouter').click();
  await settle();
  if (!SERVER) check(api.st.calls.some(([m, p, b]) => p === '/api/tags/bulk' && b.add[0] === 'Pays/Brésil' && b.card_ids.length === 4), 'tag rangé mal envoyé');
  check(!cls('cardgrid')[0].querySelectorAll('.tag').length, 'aucun tag sous les cartes (seulement dans la fiche)');
  check(catChip('Pays') && text(catChip('Pays').querySelector('.n')) === '4', 'catégorie « Pays » absente du menu');
  // Quota ou base pleine : le 503 du serveur s'affiche tel quel.
  if (!SERVER) {
    type(byId('bulk-tag'), 'QUOTA');
    byId('bulk-cat').value = '';
    byId('bulk-cat').dispatch('change');
    needButton('Ajouter').click();
    await settle();
    check(has("La base du classeur est pleine pour aujourd'hui (quota gratuit atteint) : réessaie demain."), "le 503 (quota) ne s'affiche pas tel quel");
  }
  needButton('Vider la sélection').click();
  await settle(400);
  check(!one('bulk'), 'la bande de sélection reste');

  // 6. Menu à deux niveaux : filtre par catégorie (union), par sous-catégorie, renommage
  catChip('Pays').click();
  await settle();
  check(cls('cell').length === 4 && text(one('count-line')).includes('Pays (toute la catégorie)'), 'le filtre par catégorie ne marche pas');
  needButton('Réinitialiser les filtres').click();
  await settle();
  await unfold('Autres');
  check(subChip('À échanger'), 'sous-catégorie absente une fois la catégorie dépliée');
  check(JSON.parse(ls.get('classeur-tagcats') || '[]').includes('Autres'), 'état des catégories dépliées non gardé');
  subChip('À échanger').click();
  await settle();
  check(cls('cell').length === 5 && text(one('count-line')).includes('5 cartes'), 'le filtre par tag ne marche pas');
  needButton('Renommer ou supprimer « À échanger »').click();
  await settle();
  check(byId('tag-cat') && byId('tag-cat').value === 'Autres', 'liste des catégories absente de la fenêtre du tag');
  type(byId('tag-to'), 'Échange');
  all((n) => n.tagName === 'BUTTON' && text(n) === 'Renommer')[0].click();
  await settle();
  check(has('renommé en « Échange »') && cls('cell').length === 5, 'renommage du tag incorrect');
  needButton('Réinitialiser les filtres').click();
  await settle();

  // 7. Fiche : tags, suggestions Wikidata (métier au féminin, pays) rangées, validation
  type(q, 'rihanna');
  await settle();
  one('card').dispatch('click');
  await settle(120);
  const fiche = () => one('fiche');
  check(fiche() && text(fiche()).includes('Rihanna') && text(fiche()).includes('Légendaire') && text(fiche()).includes('Vues par mois'), 'fiche absente');
  check(fiche().querySelector('.card') && fiche().querySelector('.card').classList.contains('big'), 'grande carte absente de la fiche');
  check(text(fiche()).includes('Métiers › Chanteuse') && text(fiche()).includes('Pays › Barbade'), 'suggestions rangées absentes : ' + text(fiche()).slice(-220));
  check(!text(fiche()).includes('Être humain'), '« être humain » ne doit pas être suggéré');
  fiche().querySelectorAll('button').filter((b) => text(b).includes('Valider les suggestions'))[0].click();
  await settle();
  if (!SERVER) check(JSON.stringify(api.st.tags.get('c0')) === '["Métiers/Chanteuse","Pays/Barbade"]', 'tags/set après validation : ' + JSON.stringify(api.st.tags.get('c0')));
  check(fiche().querySelectorAll('.tag.own').map(text).join('|') === 'Chanteuse|Barbade', 'la fiche doit afficher les sous-catégories seules');
  type(byId('new-tag'), 'Musique');
  all((n) => n.tagName === 'BUTTON' && n.getAttribute('type') === 'submit' && text(n) === 'Ajouter')[0].click();
  await settle();
  check(text(fiche()).includes('Musique'), 'ajout de tag dans la fiche sans effet');
  // « Copier le nom » : le titre de la carte dans le presse-papiers ; un lien vers le marché du jeu seulement sur une enchère en
  // cours (compte du jeu relié), pas ici.
  {
    check(!fiche().querySelectorAll('a').some((a) => /marketplace/.test(a.getAttribute('href') || '')), 'la fiche ne doit mener au marché que par une enchère en cours');
    const b = fiche().querySelectorAll('button').filter((x) => x.getAttribute('aria-label') === 'Copier le nom « Rihanna »')[0];
    check(b && b.classList.contains('copy-name') && b.parentNode.classList.contains('fiche__title'), 'icône « Copier le nom » absente à côté du titre de la fiche');
    const n = copied.length;
    b.click();
    await settle();
    check(copied.length === n + 1 && copied[n] === 'Rihanna', 'le nom n\'est pas copié : ' + JSON.stringify(copied.slice(n)));
    check(fiche() && fiche().querySelectorAll('button').some((x) => x.getAttribute('aria-label') === 'Nom « Rihanna » copié'), 'pas de « Nom copié » après la copie (ou fiche fermée)');
  }
  win.listeners.keydown.forEach((f) => f({ key: 'Escape', preventDefault() {} }));
  await settle(500);
  check(!fiche(), 'Échap ne ferme pas la fiche');
  type(q, '');
  check(text(catChip('Pays').querySelector('.n')) === '5' && catChip('Métiers'), 'les suggestions validées ne sont pas rangées dans le menu');

  // 8. Suggestions pour toute la collection (colonne des tags)
  needButton('Calculer les suggestions pour toute la collection').click();
  await settle(400);
  check(has('Suggestions : ') && has('sur 1 049 cartes'), 'progression des suggestions absente');
  needButton('Arrêter').click();
  await settle();
  check(has('Calculer les suggestions pour toute la collection'), 'Arrêter sans effet');

  // 8 bis. « Ranger mes tags » : aperçu (catégorie modifiable), puis application ; déplacer un tag à la main
  needButton('Ranger mes tags').click();
  for (let i = 0; i < 300 && (!one('arrange') || has('Analyse de tes tags') || has('Recherche sur Wikidata') || has('Lecture des cartes')); i++) await sleep(50);
  await settle();
  const arrRows = () => cls('arrange')[0].childNodes.filter((n) => n.nodeType === 1);
  const rowOf = (name) => arrRows().find((li) => text(li.querySelector('.from')).startsWith(name));
  // Un mot libre trouvé seulement sur Wikidata n'est plus rangé d'office (« Musique » pouvait finir en événements) :
  // il reste dans Autres avec un « peut-être… », et c'est l'utilisateur qui choisit.
  check(rowOf('Musique') && rowOf('Musique').querySelector('select').value === 'Autres' && text(rowOf('Musique')).includes('peut-être'), 'aperçu : Musique devrait rester dans Autres avec une suggestion');
  rowOf('Musique').querySelector('select').value = 'Culture et œuvres';
  rowOf('Musique').querySelector('select').dispatch('change');
  await settle();
  check(rowOf('Échange') && rowOf('Échange').querySelector('select').value === 'Autres' && text(rowOf('Échange')).includes('reste dans Autres'), 'aperçu : Échange devrait rester dans Autres');
  check(!rowOf('Brésil') && !rowOf('Chanteuse'), 'les tags déjà rangés ne doivent pas être proposés');
  if (!SERVER) check(wdSearches.includes('Musique') && wdSearches.includes('Échange'), 'Wikidata non interrogé sur les libellés : ' + wdSearches.join(', '));
  needButton('Appliquer (1 tag)').click();
  await settle(200);
  if (!SERVER) check(api.st.calls.some(([m, p, b]) => p === '/api/tags/rename' && b.from === 'Musique' && b.to === 'Culture et œuvres/Musique'), 'renommage du rangement mal envoyé');
  check(!one('arrange') && catChip('Culture et œuvres') && has('Tags rangés : 1'), 'rangement non appliqué');
  await unfold('Autres');
  subChip('Échange').click();
  await settle();
  needButton('Renommer ou supprimer « Échange »').click();
  await settle();
  byId('tag-cat').value = 'Organisations';
  byId('tag-cat').dispatch('change');
  all((n) => n.tagName === 'BUTTON' && text(n) === 'Renommer')[0].click();
  await settle();
  if (!SERVER) check(api.st.calls.some(([m, p, b]) => p === '/api/tags/rename' && b.from === 'Échange' && b.to === 'Organisations/Échange'), 'déplacement à la main mal envoyé');
  check(catChip('Organisations') && !catChip('Autres'), 'le tag déplacé n\'a pas changé de catégorie');
  needButton('Réinitialiser les filtres').click();
  await settle();
  const cats = cls('tagcat').map((n) => text(n.querySelector('.chip__label')));
  check(cats.join('|') === 'Pays|Métiers|Culture et œuvres|Organisations', 'ordre des catégories : ' + cats.join(' | '));

  // 9. Onglet Collections : « Mes collections » seule (toutes, quelle que soit leur origine) ; une seule façon d'en créer,
  // « Nouvelle collection » : une fenêtre, un onglet par méthode (Par URL, Par mots-clés, Par liste d'articles,
  // Propositions, Depuis le jeu), chacun avec son explication. Onglet « Par URL » : recherche d'une catégorie de
  // Wikipédia avec suggestions au fil de la frappe, album d'une catégorie, « Créer une collection ». Ni catalogue, ni
  // « Mes catégories » (plus de suivi).
  await goTab('collections');
  check(has('Mes collections') && !byId('h-cats') && !byId('cat-q') && !has("Proposées d'après tes cartes"), 'onglet Collections : « Mes collections » seule attendue');
  check(!has('Mes catégories') && !byId('h-mycats') && !has('Suivre') && !has('suivie'), '« Mes catégories » et le vocabulaire du suivi doivent avoir disparu');
  check(!has('Collections proposées') && !has('Parcourir tout le catalogue') && !has('Pharaons') && !byId('prop-q'), 'le catalogue doit avoir disparu');
  check(has("Aucune collection pour l'instant") && has('depuis les cartes du jeu'), 'texte de la liste vide absent');
  {
    const addBtn = all((n) => n.tagName === 'BUTTON' && text(n).trim() === 'Nouvelle collection')[0];
    check(addBtn && addBtn.classList.contains('primary'), '« Nouvelle collection » : bouton principal attendu');
    addBtn.click();
    await settle();
    const tabs = all((n) => n.getAttribute && n.getAttribute('role') === 'tab' && (n.getAttribute('id') || '').startsWith('newcol-tab-'));
    const intro = () => (one('newcol-intro') ? text(one('newcol-intro')) : '');
    check(tabs.map((t) => text(t).replace(/\d+$/, '').trim()).join('|') === "Par URL|Par mots-clés|Par liste d'articles|Propositions|Depuis le jeu",
      'onglets de « Nouvelle collection » : ' + tabs.map(text).join(' | '));
    check(tabs[0].getAttribute('aria-selected') === 'true' && byId('cat-q') && byId('newcol-panel').getAttribute('aria-labelledby') === 'newcol-tab-url'
      && intro().includes("Colle l'adresse d'une catégorie ou d'une page de Wikipédia"), '« Par URL » doit être l\'onglet par défaut, avec son explication : ' + intro());
    // Clavier : → passe à l'onglet suivant (focus compris), Fin au dernier, → revient au premier.
    tabs[0].dispatch('keydown', { key: 'ArrowRight' });
    await settle();
    check(byId('newcol-tab-mots').getAttribute('aria-selected') === 'true' && byId('kw') && intro().includes('Décris un thème'), 'flèche droite : « Par mots-clés » attendu');
    byId('newcol-tab-mots').dispatch('keydown', { key: 'End' });
    await settle();
    check(byId('newcol-tab-jeu').getAttribute('aria-selected') === 'true' && intro().includes('interroge la base du jeu') && byId('game-q') && has('Chercher'), 'Fin : « Depuis le jeu » attendu, ' + intro());
    byId('newcol-tab-jeu').dispatch('keydown', { key: 'ArrowRight' });
    await settle();
    check(byId('newcol-tab-url').getAttribute('aria-selected') === 'true', 'flèche droite sur le dernier onglet : retour au premier attendu');
    await closeNewIn(doc);
    check(!byId('newcol-panel'), '« Nouvelle collection » non refermée');
  }
  const mineSection = () => byId('h-mine').parentNode.parentNode;
  // Lignes de « Mes collections » faites d'une catégorie : « depuis la catégorie Wikipédia ».
  const fromCat = (name) => { const r = mineSection().querySelectorAll('.row').find((n) => text(n.querySelector('.name')) === name); return !!r && !!r.querySelector('.row-kind') && text(r.querySelector('.row-kind')) === 'depuis la catégorie Wikipédia'; };
  const rowNames = (box) => box.querySelectorAll('.row').map((n) => text(n.querySelector('.name')));
  const opts = () => all((n) => n.getAttribute && n.getAttribute('role') === 'option');
  const at = () => (one('album-title') ? text(one('album-title')) : '');
  {
    const cq = await catQ();
    check(cq && cq.getAttribute('role') === 'combobox' && cq.getAttribute('aria-controls') === 'cat-list' && cq.getAttribute('aria-autocomplete') === 'list',
      'champ de recherche des catégories (combobox) absent');
    // Frappe rapide : une seule recherche, 250 ms après la dernière touche ; préfixe (avec les pages de liste et les
    // articles), titres exacts, puis plein texte (peu de catégories) : trois requêtes au plus.
    const n0 = catSuggest.length;
    for (const v of ['v', 'vi', 'vio', 'viol']) type(cq, v);
    check(await waitFor(() => opts().length > 0), 'suggestions absentes pour « viol » : ' + text(one('prop-search')));
    check(JSON.stringify(catSuggest.slice(n0).map((x) => x[0])) === '["prefix","exact","search"]' && catSuggest[n0][1] === 'viol' && catSuggest[n0 + 2][1] === 'viol'
      && catSuggest[n0 + 1][1].split('|').includes('Catégorie:Viol') && catSuggest[n0 + 1][1].split('|').includes('Catégorie:Viola Davis')
      && !catSuggest[n0 + 1][1].split('|').includes('Catégorie:Violence'), 'requêtes de suggestions : ' + JSON.stringify(catSuggest.slice(n0)));
    const names = () => opts().map((o) => text(o.querySelector('.prop-list__name')));
    // Classement : Viol (titre exact, absent du préfixe) d'abord, puis celles qui commencent par « viol » de la plus grande
    // à la plus petite, puis Nuance de violet (un mot commence par « viol ») ; homonymie, cachée et vide écartées.
    check(names().join('|') === 'Viol|Violoniste français|Violence|Violet|Nuance de violet', 'suggestions (exact, commence par, taille) : ' + names().join(' | '));
    check(text(opts()[0]).includes('42 articles') && text(opts()[0]).includes('5 sous-catégories') && text(opts()[3]).includes('4 articles') && text(opts()[3]).includes('1 sous-catégorie')
      && text(opts()[1]).includes('310 articles'), 'tailles des suggestions : ' + opts().map(text).join(' / '));
    check(cls('prop-list__group').map(text).join('|') === 'Catégories', 'un seul groupe (pas de page de liste pour « viol ») : ' + cls('prop-list__group').map(text).join('|'));
    check(cq.getAttribute('aria-expanded') === 'true' && cq.getAttribute('aria-activedescendant') === 'cat-opt-0' && byId('cat-list').getAttribute('role') === 'listbox', 'combobox : liste ouverte et option active attendues');
    cq.dispatch('keydown', { key: 'ArrowDown' });
    await settle();
    check(cq.getAttribute('aria-activedescendant') === 'cat-opt-1' && opts()[1].getAttribute('aria-selected') === 'true', 'flèche bas sans effet');
    cq.dispatch('keydown', { key: 'ArrowDown' });
    await settle();
    cq.dispatch('keydown', { key: 'ArrowUp' });
    await settle();
    check(cq.getAttribute('aria-activedescendant') === 'cat-opt-1', 'flèche haut sans effet');
    // Échap ferme la liste ; la même recherche reprise ne redemande rien à Wikipédia (réponse gardée).
    cq.dispatch('keydown', { key: 'Escape' });
    await settle();
    check(!opts().length && cq.getAttribute('aria-expanded') === 'false', 'Échap ne ferme pas la liste');
    const n1 = catSuggest.length;
    type(cq, 'viol');
    await sleep(400);
    check(opts().length === 5, 'suggestions reprises absentes');
    check(catSuggest.length === n1, 'même recherche : réponse gardée attendue, ' + JSON.stringify(catSuggest.slice(n1)));
    // Au plus 8 catégories (la plus grande d'abord, à rang égal) ; une recherche sans résultat le dit.
    type(cq, 'peintre');
    check(await waitFor(() => opts().length && text(opts()[0]).includes('Peintre 12')), 'suggestions « peintre » absentes : ' + opts().map(text).join(' / '));
    check(opts().length === 8 && JSON.stringify(catSuggest.slice(-2).map((x) => x[0])) === '["prefix","exact"]', '8 suggestions au plus, sans plein texte quand le préfixe suffit : ' + opts().length + ' ' + JSON.stringify(catSuggest.slice(-2)));
    type(cq, 'zzzz');
    check(await waitFor(() => has('Aucune catégorie ni page de liste de Wikipédia ne correspond.')), 'recherche sans résultat');
    // Catégories et pages « Liste de… » mêlées, en deux groupes, chacun avec sa taille : « couleur » (la catégorie
    // exacte d'abord, puis les pages ; « Couleurs (pigments) » commence par le texte, « Noms de couleur » non).
    type(cq, 'couleur');
    check(await waitFor(() => opts().length === 3 && !one('prop-list--stale')), 'suggestions « couleur » : ' + opts().map(text).join(' / '));
    check(cls('prop-list__group').map(text).join('|') === 'Catégories|Pages de liste' && names().join('|') === 'Couleur|Liste de couleurs (pigments)|Liste de noms de couleur'
      && text(opts()[0]).includes('40 articles') && text(opts()[1]).includes('liste') && byId('cat-list').querySelectorAll('[role="group"]').length === 2,
      'groupes « Catégories » / « Pages de liste » : ' + cls('prop-list__group').map(text).join('|') + ' — ' + opts().map(text).join(' / '));
    // « noms de couleur » : la page exacte (« Liste de noms de couleur ») seule, son groupe en tête.
    type(cq, 'noms de couleur');
    check(await waitFor(() => opts().length === 1 && !one('prop-list--stale')), 'suggestions « noms de couleur » : ' + opts().map(text).join(' / '));
    check(cls('prop-list__group').map(text).join('|') === 'Pages de liste' && names()[0] === 'Liste de noms de couleur', 'page exacte : ' + opts().map(text).join(' / '));
    // Le titre de la page tapé en entier : demandé tel quel parmi les titres exacts.
    {
      const n2 = catSuggest.length;
      type(cq, 'Liste de noms de couleur');
      await settle();
      check(await waitFor(() => catSuggest.slice(n2).some((x) => x[0] === 'exact') && opts().length === 1 && !one('prop-list--stale')), 'titre tapé en entier : ' + opts().map(text).join(' / '));
      const ex = catSuggest.slice(n2).find((x) => x[0] === 'exact');
      check(names()[0] === 'Liste de noms de couleur' && ex && ex[1].split('|').includes('Liste de noms de couleur'), 'titre exact demandé : ' + JSON.stringify(catSuggest.slice(n2)));
    }
    // « races bovines » : la catégorie au singulier (titre exact) avant la recherche plein texte, plus grande ; puis les pages.
    type(cq, 'races bovines');
    check(await waitFor(() => opts().length === 4 && !one('prop-list--stale')), 'suggestions « races bovines » : ' + opts().map(text).join(' / '));
    check(names().join('|') === 'Race bovine|Race bovine originaire de France|Liste de races bovines|Liste des races bovines de France', 'races bovines : ' + names().join(' | '));
    type(cq, 'viol');
    check(await waitFor(() => opts().length === 5 && !one('prop-list--stale')), 'suggestions « viol » absentes');
    for (let k = 0; k < 3; k++) { cq.dispatch('keydown', { key: 'ArrowDown' }); await settle(); }
    cq.dispatch('keydown', { key: 'Enter' });
    check(await waitFor(() => at().includes('Violet') && cls('slot').length === 3), "Entrée n'ouvre pas l'album de la catégorie : " + at());
    // Le champ de recherche disparaît avec la liste : le focus va au titre de l'album (pas sur <body>).
    await settle();
    const focused = doc.activeElement && doc.activeElement.getAttribute ? doc.activeElement.getAttribute('id') : null;
    check(focused === 'album-name' && byId('album-name').getAttribute('tabindex') === '-1', 'focus après le choix d\'une suggestion : ' + focused);
  }
  // Album d'une catégorie : ses articles, la progression, la rareté estimée ; sous-catégories (1 niveau) ; « Créer une
  // collection ».
  check(at().includes('1 sur 4') && at().includes('catégorie de Wikipédia') && cls('cell').length === 1 && has('Créer une collection') && !has('Modifier') && !has('Réorganiser'), 'album de la catégorie : ' + at());
  check(all((n) => n.tagName === 'A' && text(n).includes('Voir sur Wikipédia')).some((a) => a.getAttribute('href') === 'https://fr.wikipedia.org/wiki/Cat%C3%A9gorie:Violet'), 'lien vers la catégorie absent');
  {
    const subBox = all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox' && n.parentNode.classList.contains('check'))[0];
    check(subBox && text(subBox.parentNode).includes('inclure les sous-catégories (1 niveau : 1)'), 'case des sous-catégories absente');
    subBox.dispatch('change');
    check(await waitFor(() => at().includes('2 sur 6') && cls('slot').length === 4), 'avec les sous-catégories : 2 sur 6 attendu, ' + at());
  }
  needButton('Créer une collection').click();
  check(await waitFor(() => has('Modifier') && has('Supprimer')), '« Créer une collection » sans effet');
  if (!SERVER) check(api.st.targets.some((t) => t.source === 'wp:Violet' && t.name === 'Violet' && t.items.length === 6), 'collection de la catégorie mal enregistrée : ' + JSON.stringify(api.st.targets.map((t) => [t.name, t.source, t.items.length])));
  check(at().includes('depuis la catégorie Wikipédia') && at().includes('2 sur 6') && has('Collection « Violet » créée : 6 articles, sous-catégories comprises, dans « Mes collections ».')
    && !has('Créer une collection') && !has('Ne plus suivre') && !!buttonByText('Réorganiser…'), 'album de la collection créée (devenu une collection comme les autres) : ' + at());
  // Fiches : « Dans tes collections » (carte possédée, puis case vide), la collection faite de la catégorie comprise.
  {
    one('cell').querySelector('.card').dispatch('click');
    await settle(120);
    check(fiche() && text(fiche()).includes('Dans tes collections') && fiche().querySelector('.memberships') && text(fiche().querySelector('.memberships')).includes('Violet')
      && !text(fiche()).includes('Dans tes catégories') && !text(fiche()).includes('collections proposées'), 'fiche : « Dans tes collections » attendu : ' + (fiche() ? text(fiche()).slice(-300) : 'absente'));
    win.listeners.keydown.forEach((f) => f({ key: 'Escape', preventDefault() {} }));
    await settle(500);
    cls('slot__open').filter((b) => (b.getAttribute('aria-label') || '').startsWith('Lavande : '))[0].click();
    await settle(120);
    const f = one('fiche--missing');
    check(f && text(f).includes('Dans tes collections') && text(f.querySelector('.memberships')).includes('Violet') && !text(f).includes('Dans tes catégories'),
      'fiche d\'une case vide : « Dans tes collections » attendu : ' + (f ? text(f).slice(-300) : 'absente'));
    f.querySelector('.close').click();
    await settle(500);
  }
  needButton('← Toutes les collections').click();
  await settle();
  check(rowNames(mineSection()).includes('Violet') && fromCat('Violet'), 'Violet doit être dans « Mes collections », « depuis la catégorie Wikipédia » : ' + rowNames(mineSection()).join(', '));
  {
    const n = rowNames(mineSection()).length;
    check(colFigure() === `${n} ${n > 1 ? 'collections' : 'collection'}`, 'tuile du bandeau : la collection faite d\'une catégorie compte, ' + colFigure() + ' pour ' + n);
  }
  check(!byId('newcol-panel') && (await catQ()) && byId('cat-q').value === '', 'le champ de recherche doit être vidé après le choix (et la fenêtre refermée)');
  // La catégorie se rouvre depuis la recherche (« ta collection ») : son album propose « Ouvrir ta collection » ; la
  // collection se supprime comme les autres, après confirmation.
  type(await catQ(), 'viol');
  check(await waitFor(() => opts().length === 5 && text(opts()[3]).includes('ta collection')), 'suggestion d\'une catégorie déjà en collection : ' + opts().map(text).join(' / '));
  opts()[3].dispatch('mousedown');
  check(await waitFor(() => at().includes('Violet') && at().includes('catégorie de Wikipédia') && !!buttonByText('Ouvrir ta collection') && !buttonByText('Créer une collection')),
    'catégorie déjà en collection : « Ouvrir ta collection » attendu, ' + at());
  needButton('Ouvrir ta collection').click();
  check(await waitFor(() => at().includes('depuis la catégorie Wikipédia') && at().includes('2 sur 6') && has('Supprimer')), '« Ouvrir ta collection » : ' + at());
  needButton('Supprimer').click();
  await settle();
  check(has('Supprimer « Violet » ?'), 'confirmation de suppression de la collection faite d\'une catégorie absente');
  if (!SERVER) check(api.st.targets.some((t) => t.source === 'wp:Violet'), 'collection supprimée avant la confirmation');
  modalBtn('Supprimer la collection').click();
  check(await waitFor(() => !one('album-title') && !rowNames(mineSection()).includes('Violet')), 'collection « Violet » non supprimée');
  if (!SERVER) check(!api.st.targets.some((t) => t.source === 'wp:Violet'), 'la collection « Violet » existe encore');

  // 9 ter. Rapprochement par identifiant Wikidata : la carte « Hydrogène (élément) » compte pour « Hydrogène » (même qid).
  // Entrée pressée avant l'arrivée des suggestions de « élément » (celles de « viol », estompées, sont encore là) : ce
  // n'est pas « Viol » qui s'ouvre, mais la première suggestion de « élément », à son arrivée.
  type(await catQ(), 'viol');
  check(await waitFor(() => opts().length === 5 && !one('prop-list--stale')), 'suggestions « viol » absentes');
  type(await catQ(), 'élément');
  await settle(); // rendu fait, recherche pas encore partie (250 ms)
  check(opts().length === 5 && one('prop-list--stale'), 'les suggestions du texte précédent doivent rester, estompées, en attendant');
  byId('cat-q').dispatch('keydown', { key: 'Enter' });
  check(await waitFor(() => at().includes('Élément chimique') && at().includes('1 sur 4'), 15000), 'la carte « Hydrogène (élément) » doit compter pour « Hydrogène » (qid) : ' + at());
  check(cls('cell').length === 1 && cls('slot').length === 3 && text(cls('cell')[0]).includes('Hydrogène (élément)'), "l'album doit montrer la carte à la place de « Hydrogène »");
  needButton('← Toutes les collections').click();
  await settle();

  // 9 quater. « Proposées d'après tes cartes » : catégories de tes cartes dont tu as au moins 5 % (et 2 cartes) ; ouvrir,
  // Retirer, Créer une collection (sans quitter la liste), masquer, rétablir.
  await openNew('props');
  for (let i = 0; i < 150 && !has('Exemples de test'); i++) await sleep(100);
  check(has('Exemples de test') && has('Autre essai'), 'propositions d\'après les catégories absentes');
  check(propose.categories > 0, 'propose.js n\'a pas interrogé Wikipédia');
  const wpRow = (name) => all((n) => n.classList.contains('row') && n.classList.contains('wp') && text(n.querySelector('.name')) === name)[0];
  check(text(wpRow('Exemples de test')).includes('7 sur 40') && text(wpRow('Exemples de test')).includes('Voir sur Wikipédia'), 'ligne de proposition incorrecte : ' + text(wpRow('Exemples de test')));
  wpRow('Exemples de test').querySelector('.row-open').click();
  check(await waitFor(() => at().includes('Exemples de test') && at().includes('37 sur 40') && has('Créer une collection')) && !byId('newcol-panel'), 'le nom d\'une proposition doit ouvrir son album (fenêtre refermée) : ' + at());
  needButton('← Toutes les collections').click();
  await settle();
  await openNew('props');
  all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Retirer « Autre essai » des propositions')[0].click();
  await settle();
  modalBtn('Retirer des propositions').click();
  await settle(100);
  check(byId('newcol-tab-props') && byId('newcol-tab-props').getAttribute('aria-selected') === 'true', 'après « Retirer » : retour à l\'onglet « Propositions » attendu');
  if (!SERVER) check(JSON.stringify(api.st.prefs.hidden_proposals) === '["wp:Autre essai"]' && !('hidden_catalog' in api.st.prefs), 'retrait de la proposition non enregistré : ' + JSON.stringify(api.st.prefs));
  check(!wpRow('Autre essai'), 'la proposition retirée reste affichée');
  all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Créer une collection « Exemples de test »')[0].click();
  check(await waitFor(() => has('Collection « Exemples de test » créée : 40 articles, dans « Mes collections ».')), 'proposition : collection non créée');
  if (!SERVER) check(api.st.targets.some((t) => t.source === 'wp:Exemples de test' && t.items.length === 40 && t.name === 'Exemples de test'), 'proposition mal enregistrée');
  check(!one('album-title') && !wpRow('Exemples de test') && rowNames(mineSection()).includes('Exemples de test') && fromCat('Exemples de test'),
    'la collection créée d\'une proposition doit passer dans « Mes collections », sans quitter la liste');
  // Masquer les propositions, puis les afficher ; rétablir la proposition retirée.
  needButton('Masquer les propositions').click();
  await settle(100);
  check(has('Propositions masquées.') && !wpRow('Exemples de test') && !wpRow('Autre essai'), 'les propositions ne sont pas masquées');
  if (!SERVER) check(api.st.prefs.hide_proposals === true, 'masquage non enregistré : ' + JSON.stringify(api.st.prefs));
  needButton('Afficher les propositions').click();
  await settle(100);
  needButton('Rétablir la proposition retirée').click();
  check(await waitFor(() => !!wpRow('Autre essai')), 'la proposition rétablie n\'est pas revenue');
  await closeNewIn(doc);
  check(!!buttonByText("proposition d'après tes cartes"), 'lien vers les propositions absent de « Mes collections »');
  if (!SERVER) check(api.st.prefs.hide_proposals === false && api.st.prefs.hidden_proposals.length === 0, 'rétablissement non enregistré : ' + JSON.stringify(api.st.prefs));
  // Pour « Entre amis » : une collection « Planète du Système solaire » (Entrée sur la première suggestion).
  type(await catQ(), 'planète');
  byId('cat-q').dispatch('keydown', { key: 'Enter' }); // tout de suite, sans attendre les suggestions
  check(await waitFor(() => at().includes('Planète du Système solaire') && at().includes('1 sur 9')), 'album des planètes : ' + at());
  needButton('Créer une collection').click();
  check(await waitFor(() => has('Modifier') && at().includes('depuis la catégorie Wikipédia')), 'planètes : collection non créée');
  needButton('← Toutes les collections').click();
  await settle();
  check(rowNames(mineSection()).join('|') === 'Exemples de test|Planète du Système solaire' && fromCat('Planète du Système solaire'), 'Mes collections : ' + rowNames(mineSection()).join(' | '));

  // 9 quater bis. Adresse collée dans la recherche des catégories : une catégorie (adresse mobile, encodée) ouvre son
  // album ; une page de liste, l'album des articles qu'elle lie (nature dominante, ou tous), « Créer une collection »
  // (source links:<titre>), « depuis la page Wikipédia « … » » ; collée de nouveau : « Ouvrir ta collection ». Une autre
  // page (redirection suivie) : ses liens aussi ; l'adresse d'un autre site ou d'une page absente : rien à ouvrir.
  {
    const paste = async (v) => { const cq = await catQ(); cq.value = v; cq.dispatch('input', { inputType: 'insertFromPaste' }); };
    let n0 = catSuggest.length;
    await paste('https://fr.m.wikipedia.org/wiki/Cat%C3%A9gorie:Violet');
    check(await waitFor(() => at().includes('Violet') && at().includes('catégorie de Wikipédia') && cls('slot').length === 3), "adresse d'une catégorie collée : son album attendu, " + at());
    check(JSON.stringify(catSuggest.slice(n0)) === '[["exact","Catégorie:Violet"]]', 'adresse collée : une seule requête attendue, ' + JSON.stringify(catSuggest.slice(n0)));
    needButton('← Toutes les collections').click();
    await settle();
    const n1 = linkCalls.length;
    await paste('https://fr.wikipedia.org/wiki/Liste_de_noms_de_couleur#Rouge');
    check(await waitFor(() => at().includes('Noms de couleur') && at().includes('1 sur 5'), 5000), "adresse d'une page de liste collée : album de ses liens attendu, " + at());
    check(at().includes('page de Wikipédia') && has('ne garder que les « couleur » (5 sur 7 articles liés') && cls('cell').length === 1 && cls('slot').length === 4
      && has('Créer une collection') && !has('Modifier'), 'album de la page : nature dominante, sous-classe et description gardées, ' + at() + ' / ' + cls('slot').map((s) => text(s.querySelector('h3'))).join(', '));
    check(all((n) => n.tagName === 'A' && text(n).includes('Voir sur Wikipédia')).some((a) => a.getAttribute('href') === 'https://fr.wikipedia.org/wiki/Liste_de_noms_de_couleur'), 'lien vers la page absent');
    const box = () => all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox' && n.parentNode.classList.contains('check'))[0];
    box().dispatch('change');
    check(await waitFor(() => at().includes('1 sur 7')), 'tous les liens : 1 sur 7 attendu, ' + at());
    box().dispatch('change');
    check(await waitFor(() => at().includes('1 sur 5')), 'retour à la nature dominante : ' + at());
    check(linkCalls.length === n1 + 1, 'liens de la page lus une seule fois : ' + JSON.stringify(linkCalls.slice(n1)));
    needButton('Créer une collection').click();
    check(await waitFor(() => has('Modifier') && has('Supprimer')), '« Créer une collection » (page) sans effet');
    if (!SERVER) {
      const t = api.st.targets.find((x) => x.source === 'links:Liste de noms de couleur');
      check(t && t.name === 'Noms de couleur' && t.items.length === 5 && t.items.every((i) => i.status === 'ok' && /^Q9003\d\d$/.test(i.qid)) && t.items.find((i) => i.title === 'Rouge').description === 'couleur primaire',
        'collection de la page mal enregistrée : ' + JSON.stringify(t));
    }
    check(at().includes('depuis la page Wikipédia « Liste de noms de couleur »') && has('Collection « Noms de couleur » créée : 5 articles (les « couleur » de la page), dans « Mes collections ».'),
      'album de la collection créée depuis la page : ' + at());
    {
      const sortBtn = all((n) => n.tagName === 'BUTTON' && ['Ordre', 'A → Z'].includes(text(n).trim()))[0];
      check(sortBtn && text(sortBtn).trim() === 'A → Z' && !cls('slot__no').length, 'collection faite d\'une page : de A à Z, sans numéros');
    }
    // Fiche de la carte « Article 3 » : « Dans tes collections » la cite.
    one('cell').querySelector('.card').dispatch('click');
    await settle(120);
    check(fiche() && fiche().querySelector('.memberships') && text(fiche().querySelector('.memberships')).includes('Noms de couleur'), 'fiche : « Noms de couleur » attendue dans « Dans tes collections »');
    win.listeners.keydown.forEach((f) => f({ key: 'Escape', preventDefault() {} }));
    await settle(500);
    needButton('← Toutes les collections').click();
    await settle();
    {
      const r = mineSection().querySelectorAll('.row').find((n) => text(n.querySelector('.name')) === 'Noms de couleur');
      check(r && r.querySelector('.row-kind') && text(r.querySelector('.row-kind')) === 'depuis la page Wikipédia « Liste de noms de couleur »', 'ligne de la collection faite d\'une page : ' + (r ? text(r) : 'absente'));
    }
    // Les suggestions la disent déjà faite ; collée de nouveau (adresse mobile) : « Ouvrir ta collection », sans requête.
    type(await catQ(), 'noms de couleur');
    check(await waitFor(() => opts().length === 1 && text(opts()[0]).includes('ta collection')), 'suggestion d\'une page déjà en collection : ' + opts().map(text).join(' / '));
    n0 = catSuggest.length;
    await paste('https://fr.m.wikipedia.org/wiki/Liste_de_noms_de_couleur');
    check(await waitFor(() => at().includes('Noms de couleur') && !!buttonByText('Ouvrir ta collection') && !buttonByText('Créer une collection')), 'page déjà en collection : « Ouvrir ta collection » attendu, ' + at());
    check(catSuggest.length === n0, 'adresse déjà lue : réponse gardée attendue, ' + JSON.stringify(catSuggest.slice(n0)));
    needButton('Ouvrir ta collection').click();
    check(await waitFor(() => at().includes('depuis la page Wikipédia') && has('Supprimer')), '« Ouvrir ta collection » (page) : ' + at());
    needButton('Supprimer').click();
    await settle();
    modalBtn('Supprimer la collection').click();
    check(await waitFor(() => !one('album-title') && !rowNames(mineSection()).includes('Noms de couleur')), 'collection « Noms de couleur » non supprimée');
    // Autre page, par /w/index.php?title=… (redirection suivie) : ses liens, sans nature dominante à filtrer.
    await paste('https://fr.wikipedia.org/w/index.php?title=Tableau_p%C3%A9riodique&action=history');
    check(await waitFor(() => at().includes('Tableau périodique des éléments') && at().includes('page de Wikipédia') && cls('slot').length + cls('cell').length === 2, 5000), 'autre page collée : ' + at());
    check(has('sans nature dominante à filtrer') && !all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox' && n.parentNode.classList.contains('check')).length, 'page sans nature dominante : ' + at());
    // Son petit tableau (2 éléments) : la colonne « Élément » est proposée, pas présélectionnée (trop peu d'articles).
    {
      const sel = byId('page-key');
      const o = sel ? sel.querySelectorAll('option').map((x) => text(x)).join(' | ') : '';
      check(sel && sel.value === '' && o === 'Élément (2 articles) | Aucune : tous les liens de la page (2)' && has('Sans colonne clé : les articles liés depuis la page'),
        'petit tableau : colonne proposée mais pas choisie, ' + o + ' / ' + (sel ? JSON.stringify(sel.value) : 'pas de choix'));
    }
    needButton('← Toutes les collections').click();
    await settle();
    // Lecture lente (liens de la page retenus) : « Créer une collection » reste cliquable, avec la roue, et la ligne
    // d'état dit l'étape ; cliqué, il attend (« Créée dès la fin de la lecture… ») et la collection est créée dès que la
    // lecture finit, sans second clic.
    {
      let release = null;
      mainOpts.wikiHold = (url) => (/generator=links/.test(url) && /Tableau/.test(decodeURIComponent(url)) ? new Promise((r) => { release = r; }) : null);
      await paste('https://fr.wikipedia.org/w/index.php?title=Tableau_p%C3%A9riodique&action=history');
      check(await waitFor(() => at().includes('Tableau périodique des éléments') && !!release, 5000), 'page lente : album en lecture attendu, ' + at());
      await settle();
      const cb = () => buttonByText('Créer une collection') || buttonByText('Créée dès la fin de la lecture');
      check(cb() && !cb().disabled && cb().getAttribute('aria-busy') === 'true' && has('Lecture des liens de la page sur Wikipédia…'),
        'pendant la lecture : bouton cliquable (aria-busy) et étape attendus, ' + (cb() ? text(cb()) + ' ' + cb().disabled : 'bouton absent') + ' / ' + text(one('album-head')).slice(0, 300));
      cb().click();
      await settle();
      check(text(cb()).includes('Créée dès la fin de la lecture…') && cb().disabled && has('La collection sera créée à la fin.') && !has('Modifier'),
        'clic pendant la lecture : attente attendue, ' + text(cb()));
      mainOpts.wikiHold = null;
      release();
      check(await waitFor(() => has('Modifier') && has('Supprimer') && has('Collection « Tableau périodique des éléments » créée : 2 articles (tous les liens de la page), dans « Mes collections ».'), 5000),
        'création à la fin de la lecture : ' + at());
      needButton('Supprimer').click();
      await settle();
      modalBtn('Supprimer la collection').click();
      check(await waitFor(() => !one('album-title') && !rowNames(mineSection()).includes('Tableau périodique des éléments')), 'collection « Tableau périodique des éléments » non supprimée');
    }
    // 9 quater ter. Page dont la liste est en tableaux (« Liste des présidents de Testlande », deux tableaux) : son HTML lu
    // une fois (action=parse), analysé à part sans rien exécuter ni insérer dans la page ; « Colonne clé » proposée,
    // « Nom » présélectionnée, ses articles dans l'ordre des lignes (cellules fusionnées, intertitre, en-tête répété, clé de
    // tri cachée, note, image, lien rouge, homonymie, redirection, doublon), « Tableaux lus » ; une autre colonne, un
    // tableau décoché, « Aucune : tous les liens de la page » ; « Créer une collection » (source links:<titre>#Nom,
    // ordonnée, qid et description) ; rouverte : « Ouvrir ta collection ».
    {
      const p0 = parseCalls.length;
      const l0 = linkCalls.length;
      const slotTitles = () => cls('slot').map((s) => text(s.querySelector('h3')));
      const keySel = () => byId('page-key');
      const keyOpts = () => (keySel() ? keySel().querySelectorAll('option').map((o) => text(o)) : []);
      const pickKey = async (label) => {
        const sel = keySel();
        const o = sel && sel.querySelectorAll('option').find((x) => text(x).startsWith(label));
        if (!o) fail('colonne absente : ' + label + ' / ' + keyOpts().join(' | '));
        sel.value = o.value;
        sel.dispatch('change');
        await settle(60);
      };
      const hintText = () => cls('hint').map(text).join(' || ');
      await paste('https://fr.wikipedia.org/wiki/Liste_des_pr%C3%A9sidents_de_Testlande');
      check(await waitFor(() => at().includes('Présidents de Testlande') && !!keySel(), 5000), 'page en tableaux : « Colonne clé » attendue, ' + at() + ' / ' + text(one('album-head')).slice(0, 400));
      check(keyOpts().join(' | ') === 'No (2 articles) | Nom (5 articles) | Parti (3 articles) | Ville natale (3 articles) | Aucune : tous les liens de la page (5)',
        'colonnes proposées : ' + keyOpts().join(' | '));
      check(keySel().value === 'nom' && at().includes('0 sur 5'), 'colonne « Nom » présélectionnée : ' + keySel().value + ' / ' + at());
      check(slotTitles().join(' | ') === 'Aline Martin | Bruno Petit | Carla Rossi (femme politique) | Émile Dubois | Fanny Leroy',
        'articles de la colonne « Nom », dans l\'ordre des lignes : ' + slotTitles().join(' | '));
      check(cls('slot__no').map(text).join(',') === '1,2,3,4,5' && !!all((n) => n.tagName === 'BUTTON' && text(n).trim() === 'Ordre')[0], 'colonne clé : album numéroté, dans l\'ordre');
      check(hintText().includes('Le premier article lié de chaque ligne de la colonne « Nom » des 2 tableaux de la page « Liste des présidents de Testlande », dans l\'ordre des lignes : 5 articles (2 lignes sans article : lien rouge, homonymie ou pas de lien).'),
        'explication de la colonne clé : ' + hintText());
      check(parseCalls.length === p0 + 1 && parseCalls[p0] === TL_PAGE && linkCalls.length === l0 + 1, 'HTML et liens de la page lus une fois chacun : ' + JSON.stringify(parseCalls.slice(p0)));
      // Le HTML analysé n'entre jamais dans la page : ni son image, ni son script, ni son texte ; rien n'a été exécuté.
      check(ctx.__pwn === undefined && !all((n) => n.tagName === 'IMG' && /aline\.jpg/.test(n.getAttribute('src') || '')).length && !has('Intérim assuré')
        && !all((n) => n.tagName === 'SCRIPT').length && parsedDocs.length > 0, 'le HTML de la page ne doit être ni exécuté ni inséré');
      // « Sections et tableaux lus : 2 sur 2 » (un tableau sous chaque intertitre : une case par intertitre) : décocher le
      // premier ne garde que le second (le dernier coché ne se décoche pas).
      const tableBoxes = () => (one('page-tables') ? one('page-tables').querySelectorAll('input').filter((n) => n.getAttribute('type') === 'checkbox') : []);
      check(has('Sections et tableaux lus : 2 sur 2') && tableBoxes().map((b) => text(b.parentNode)).join(' | ') === 'Première République (3 articles) | Seconde République (3 articles)',
        'liste des tableaux : ' + tableBoxes().map((b) => text(b.parentNode)).join(' | '));
      tableBoxes()[0].checked = false;
      tableBoxes()[0].dispatch('change');
      await settle(60);
      check(slotTitles().join(' | ') === 'Émile Dubois | Aline Martin | Fanny Leroy' && has('Sections et tableaux lus : 1 sur 2') && tableBoxes()[1].disabled && !tableBoxes()[0].disabled,
        'premier tableau décoché : ' + slotTitles().join(' | ') + ' / ' + hintText());
      tableBoxes()[0].checked = true;
      tableBoxes()[0].dispatch('change');
      await settle(60);
      check(slotTitles().length === 5, 'tableau recoché : 5 articles attendus, ' + slotTitles().join(' | '));
      // Une autre colonne : « Parti » (chaque parti une fois, dans l'ordre de la page).
      await pickKey('Parti');
      check(slotTitles().join(' | ') === 'Parti bleu | Parti rouge | Parti vert' && at().includes('0 sur 3'), 'colonne « Parti » : ' + slotTitles().join(' | '));
      // « Aucune » : tous les liens de la page, ceux de la nature dominante (case), de A à Z.
      await pickKey('Aucune');
      check(keySel().value === '' && has('ne garder que les « être humain » (5 sur 16 articles liés') && hintText().includes('Sans colonne clé : les articles liés depuis la page')
        && !cls('slot__no').length && !!all((n) => n.tagName === 'BUTTON' && text(n).trim() === 'A → Z')[0] && slotTitles()[0] === 'Aline Martin',
        'sans colonne clé : ' + hintText() + ' / ' + slotTitles().join(' | '));
      check(parseCalls.length === p0 + 1 && linkCalls.length === l0 + 1, 'changer de colonne ne relit rien');
      await pickKey('Nom');
      needButton('Créer une collection').click();
      check(await waitFor(() => has('Modifier') && has('Supprimer')), '« Créer une collection » (colonne clé) sans effet');
      if (!SERVER) {
        const t = api.st.targets.find((x) => x.source === 'links:' + TL_PAGE + '#Nom');
        check(t && t.name === 'Présidents de Testlande' && t.items.map((i) => i.title).join('|') === 'Aline Martin|Bruno Petit|Carla Rossi (femme politique)|Émile Dubois|Fanny Leroy'
          && t.items.every((i) => i.status === 'ok' && /^Q90100\d$/.test(i.qid)) && t.items[0].description === 'femme politique testlandaise',
        'collection de la colonne clé mal enregistrée : ' + JSON.stringify(t));
      }
      check(has('Collection « Présidents de Testlande » créée : 5 articles (colonne « Nom » des tableaux de la page, dans l\'ordre), dans « Mes collections ».')
        && at().includes('depuis la page Wikipédia « Liste des présidents de Testlande », colonne « Nom »'), 'collection créée de la colonne clé : ' + at());
      check(cls('slot__no').map(text).join(',') === '1,2,3,4,5' && !!all((n) => n.tagName === 'BUTTON' && text(n).trim() === 'Ordre')[0], 'collection d\'une colonne clé : ordonnée, numérotée');
      needButton('← Toutes les collections').click();
      await settle();
      {
        const r = mineSection().querySelectorAll('.row').find((n) => text(n.querySelector('.name')) === 'Présidents de Testlande');
        check(r && text(r.querySelector('.row-kind')) === 'depuis la page Wikipédia « Liste des présidents de Testlande », colonne « Nom »', 'ligne de la collection d\'une colonne clé : ' + (r ? text(r) : 'absente'));
      }
      // Rouverte (même page, autre adresse) : une page ne donne qu'une collection, « Ouvrir ta collection ».
      await paste('https://fr.m.wikipedia.org/wiki/Liste_des_présidents_de_Testlande');
      check(await waitFor(() => at().includes('Présidents de Testlande') && !!buttonByText('Ouvrir ta collection') && !buttonByText('Créer une collection'), 5000),
        'page déjà en collection (colonne clé) : « Ouvrir ta collection » attendu, ' + at());
      needButton('Ouvrir ta collection').click();
      check(await waitFor(() => has('Supprimer') && at().includes('colonne « Nom »')), '« Ouvrir ta collection » (colonne clé) : ' + at());
      needButton('Supprimer').click();
      await settle();
      modalBtn('Supprimer la collection').click();
      check(await waitFor(() => !one('album-title') && !rowNames(mineSection()).includes('Présidents de Testlande')), 'collection « Présidents de Testlande » non supprimée');
    }
    // 9 quater quater. Page dont les tableaux sont rangés en sections (« Liste des gares de Testlande », comme celle des
    // gares desservies par TGV) : « Sections et tableaux lus » ouvert d'emblée, une case par intertitre (h2 › h3 › h4,
    // deux « En Testlande » distincts), qui coche ou décoche tous ses tableaux ; « mixte » quand une partie l'est.
    {
      const boxes = () => (one('page-tables') ? one('page-tables').querySelectorAll('input').filter((n) => n.getAttribute('type') === 'checkbox') : []);
      const box = (label, k = 0) => boxes().filter((b) => text(b.parentNode).startsWith(label + ' ('))[k] || fail('case absente : ' + label + ' / ' + boxes().map((b) => text(b.parentNode)).join(' | '));
      const click = async (b) => { b.checked = !b.checked; b.dispatch('change'); await settle(60); };
      const mixed = (b) => String(b.indeterminate !== undefined ? b.indeterminate : b.getAttribute('indeterminate')) === 'true';
      const slotTitles = () => cls('slot').map((s) => text(s.querySelector('h3')));
      await paste('https://fr.wikipedia.org/wiki/Liste_des_gares_de_Testlande');
      check(await waitFor(() => at().includes('Gares de Testlande') && !!byId('page-key') && !!one('page-tables'), 5000), 'page en sections : ' + at() + ' / ' + text(one('album-head')).slice(0, 400));
      check(byId('page-key').value === 'gare' && slotTitles().join(',') === 'Gare A,Gare B,Gare C,Gare D,Gare E,Gare F,Gare G,Gare H', 'colonne « Gare » : ' + byId('page-key').value + ' / ' + slotTitles().join(','));
      check(one('page-tables').getAttribute('open') !== null && one('page-tables').getAttribute('open') !== 'false' && has('Sections et tableaux lus : 4 sur 4'), '« Sections et tableaux lus » ouvert attendu');
      check(boxes().map((b) => text(b.parentNode)).join(' | ') === 'Gares desservies (7 articles, 3 tableaux) | En Testlande (3 articles) | À l\'étranger (4 articles, 2 tableaux) | Ruritanie (2 articles) | Syldavie (2 articles) | Gares fermées (1 article) | En Testlande (1 article)',
        'sections : ' + boxes().map((b) => text(b.parentNode)).join(' | '));
      await click(box('À l\'étranger'));
      check(slotTitles().join(',') === 'Gare A,Gare B,Gare C,Gare H' && !box('À l\'étranger').checked && !box('Ruritanie').checked && mixed(box('Gares desservies')) && has('Sections et tableaux lus : 2 sur 4'),
        '« À l\'étranger » décochée : ' + slotTitles().join(','));
      await click(box('Syldavie'));
      check(slotTitles().join(',') === 'Gare A,Gare B,Gare C,Gare F,Gare G,Gare H' && mixed(box('À l\'étranger')), '« Syldavie » recochée : ' + slotTitles().join(','));
      await click(box('Gares desservies')); // mixte -> tout coché
      check(slotTitles().length === 8 && box('Gares desservies').checked && !mixed(box('Gares desservies')), 'section mixte cliquée : tout cochée attendue, ' + slotTitles().join(','));
      await click(box('Gares desservies'));
      check(slotTitles().join(',') === 'Gare H' && box('Gares fermées').disabled && box('En Testlande', 1).disabled && !box('Gares desservies').disabled, 'seules les gares fermées : ' + slotTitles().join(','));
      await click(box('En Testlande'));
      check(slotTitles().join(',') === 'Gare A,Gare B,Gare C,Gare H' && !box('Gares fermées').disabled, '« En Testlande » (desservies) recochée : ' + slotTitles().join(','));
      // Une collection par choix de sections (2026-10-19) : « À l'étranger » seule, puis tout ensemble, chacune la sienne.
      await click(box('Gares desservies'));
      await click(box('Gares fermées'));
      await click(box('En Testlande'));
      check(slotTitles().join(',') === 'Gare D,Gare E,Gare F,Gare G', 'seulement « À l\'étranger » : ' + slotTitles().join(','));
      const p0 = parseCalls.length;
      const l0 = linkCalls.length;
      needButton('Créer une collection').click();
      check(await waitFor(() => has('Modifier') && has('Supprimer')), '« Créer une collection » (section) sans effet');
      check(has('Collection « Gares de Testlande — À l\'étranger » créée : 4 articles (colonne « Gare » des tableaux de la page, section « À l\'étranger », dans l\'ordre), dans « Mes collections ».')
        && at().includes('Gares de Testlande — À l\'étranger') && has('depuis la page Wikipédia « Liste des gares de Testlande », colonne « Gare », section « À l\'étranger »'), 'collection d\'une section : ' + at());
      if (!SERVER) {
        const t = api.st.targets.find((x) => x.source === 'links:' + GR_PAGE + '#Gare#§À l\'étranger');
        check(t && t.name === 'Gares de Testlande — À l\'étranger' && t.items.map((i) => i.title).join(',') === 'Gare D,Gare E,Gare F,Gare G', 'collection d\'une section mal enregistrée : ' + JSON.stringify(t).slice(0, 300));
      }
      // « Autres sections de la page » : la page rouverte sans rien relire, tout coché ; ta collection de la page citée.
      needButton('Autres sections de la page').click();
      check(await waitFor(() => !!one('page-tables') && boxes().every((b) => b.checked) && !!buttonByText('Créer une collection'), 5000), 'page rouverte : ' + at());
      check(parseCalls.length === p0 && linkCalls.length === l0, 'page rouverte : rien ne doit être relu, ' + (parseCalls.length - p0) + ' / ' + (linkCalls.length - l0));
      check(text(one('page-mine')) === 'Ta collection de cette page : Gares de Testlande — À l\'étranger.', 'tes collections de la page : ' + text(one('page-mine') || { childNodes: [] }));
      needButton('Créer une collection').click();
      check(await waitFor(() => has('Collection « Gares de Testlande » créée : 8 articles (colonne « Gare » des tableaux de la page, dans l\'ordre), dans « Mes collections ».')), 'collection de toute la page : ' + at());
      needButton('Autres sections de la page').click();
      check(await waitFor(() => !!one('page-mine') && text(one('page-mine')).startsWith('Tes collections de cette page : Gares de Testlande — À l\'étranger, Gares de Testlande')
        && !!buttonByText('Ouvrir ta collection'), 5000), 'deux collections de la page : ' + text(one('page-mine') || { childNodes: [] }));
      // Le choix d'une collection déjà faite l'ouvre au lieu d'en créer une seconde.
      await click(box('Gares fermées'));
      await click(box('En Testlande'));
      check(!!buttonByText('Ouvrir ta collection') && !buttonByText('Créer une collection'), 'sections déjà en collection : « Ouvrir ta collection » attendu');
      await click(box('En Testlande'));
      await click(box('À l\'étranger'));
      check(!!buttonByText('Créer une collection') && slotTitles().join(',') === 'Gare A,Gare B,Gare C', 'autre choix : « Créer une collection » attendu, ' + slotTitles().join(','));
      for (const name of ['Gares de Testlande — À l\'étranger', 'Gares de Testlande']) {
        all((n) => n.tagName === 'BUTTON' && n.classList.contains('linkish') && text(n) === name)[0].click();
        check(await waitFor(() => has('Supprimer') && one('album-title') && text(one('album-title')).startsWith(name)), 'collection « ' + name + ' » non ouverte');
        needButton('Supprimer').click();
        await settle();
        modalBtn('Supprimer la collection').click();
        await settle(60);
        if (name !== 'Gares de Testlande') {
          await paste('https://fr.wikipedia.org/wiki/Liste_des_gares_de_Testlande');
          check(await waitFor(() => !!one('page-mine'), 5000), 'page rouverte pour la suppression');
        }
      }
      check(await waitFor(() => !rowNames(mineSection()).some((n) => n.startsWith('Gares de Testlande'))), 'collections des gares non supprimées');
    }
    // Adresse d'un autre site : rien n'est demandé à Wikipédia ; page absente : la recherche le dit.
    n0 = catSuggest.length;
    type(await catQ(), 'https://en.wikipedia.org/wiki/Color');
    check(await waitFor(() => has("Colle l'adresse d'une page de Wikipédia en français")), 'adresse d\'un autre site : message attendu');
    check(catSuggest.length === n0, 'adresse d\'un autre site : aucune requête attendue');
    await paste('https://fr.wikipedia.org/wiki/Page_inexistante_zz');
    check(await waitFor(() => has("Cette page n'existe pas sur Wikipédia : « Page inexistante zz ».")) && !one('album-title'), 'page absente : message attendu');
    type(await catQ(), '');
    await settle();
  }

  // 9 bis. Nouvelle collection par mots-clés : catégories Wikipédia et requête Wikidata
  await openNew('mots');
  check(byId('kw') && all((n) => n.getAttribute('role') === 'tab' && n.getAttribute('aria-selected') === 'true').some((t) => text(t) === 'Par mots-clés'), 'onglet « Par mots-clés » attendu');
  type(byId('kw'), 'footballeur français');
  for (let i = 0; i < 100 && !(has('Interprétation') && !has('Recherche…')); i++) await sleep(50);
  await settle();
  check(has('Interprétation : Métier : footballeur · Nationalité : France'), 'interprétation Wikidata absente : ' + text(one('modal')).slice(0, 400));
  const candTexts = cls('cand').map(text);
  check(candTexts.length === 3, 'trois candidats attendus : ' + candTexts.join(' / '));
  check(candTexts[0].includes('Footballeur français') && candTexts[0].includes('plus de 20 000 articles · Wikidata') && candTexts[0].includes('Garder les plus connus'), 'candidat Wikidata incorrect : ' + candTexts[0]);
  check(candTexts.some((t) => t.includes('Footballeur international français') && t.includes('3 articles · 1 sous-catégories · Catégorie Wikipédia')), 'candidat catégorie absent');
  check(cls('cand').some((c) => c.classList.contains('disabled') && text(c).includes('trop grande : précise ta recherche')), 'la catégorie trop grande doit être grisée');
  all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Garder les 100 plus connus')[0].click();
  for (let i = 0; i < 60 && !cls('preview').length; i++) await sleep(50);
  check(byId('kw-name') && byId('kw-name').value === 'Footballeur français (les 100 plus connus)' && cls('preview')[0].querySelectorAll('li').length === 20 && has('… et 80 autres'),
    'aperçu des plus connus incorrect');
  if (!SERVER) check(/ORDER BY DESC\(\?sl\)/.test(lastProbe) && /LIMIT 100/.test(lastProbe), 'requête des plus connus incorrecte');
  type(byId('kw-name'), 'Footballeurs français célèbres');
  modalBtn('Enregistrer').click();
  for (let i = 0; i < 60 && !has('enregistrée : 100 articles'); i++) await sleep(50);
  if (!SERVER) {
    const t = api.st.targets.find((x) => x.name === 'Footballeurs français célèbres');
    check(t && t.items.length === 100 && t.items[0].title === 'Joueur 1' && t.items[0].qid === 'Q900000' && t.items[0].status === 'ok', 'collection Wikidata mal enregistrée');
  }
  check(text(one('album-title')).includes('Footballeurs français célèbres'), 'l\'album de la nouvelle collection ne s\'ouvre pas');
  needButton('← Toutes les collections').click();
  await settle();
  await openNew('mots');
  type(byId('kw'), 'footballeur français');
  byId('kw').dispatch('keydown', { key: 'Enter' });
  for (let i = 0; i < 100 && cls('cand').length < 3; i++) await sleep(50);
  all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Choisir Footballeur international français')[0].click();
  for (let i = 0; i < 60 && !cls('preview').length; i++) await sleep(50);
  check(cls('preview')[0].querySelectorAll('li').length === 3, 'membres de la catégorie absents');
  all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox' && n.parentNode.classList.contains('check'))[0].dispatch('change');
  for (let i = 0; i < 60 && cls('preview')[0].querySelectorAll('li').length !== 4; i++) await sleep(50);
  check(cls('preview')[0].querySelectorAll('li').map(text).join('|') === 'Zinédine Zidane|Thierry Henry|Kylian Mbappé|Jeune Espoir', 'sous-catégories mal fusionnées : ' + cls('preview')[0].querySelectorAll('li').map(text).join('|'));
  modalBtn('Enregistrer').click();
  for (let i = 0; i < 60 && !has('enregistrée : 4 articles'); i++) await sleep(50);
  if (!SERVER) check(api.st.targets.some((x) => x.name === 'Footballeur international français' && x.items.length === 4), 'collection de catégorie mal enregistrée');
  needButton('← Toutes les collections').click();
  await settle();

  // 9 ter. Nouvelle collection d'après les liens d'une page « Liste de… » : la nature dominante seulement, ou tous les liens
  await openNew('mots');
  type(byId('kw'), 'Races_bovines');
  byId('kw').dispatch('keydown', { key: 'Enter' });
  for (let i = 0; i < 100 && !(has('Interprétation') && !has('Recherche…')); i++) await sleep(50);
  await settle();
  const pageCands = cls('cand').map(text);
  check(pageCands.length === 2 && pageCands[0].includes('Races bovines') && pageCands[0].includes('Page Wikipédia') && pageCands[1].includes('Races bovines de France'),
    'pages « Liste de… » absentes : ' + pageCands.join(' / '));
  all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Choisir Races bovines')[0].click();
  for (let i = 0; i < 100 && !cls('preview').length; i++) await sleep(50);
  const linkPreview = () => cls('preview')[0].querySelectorAll('li').map(text).join('|');
  const linkBox = () => all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox' && n.parentNode.classList.contains('check'))[0];
  check(linkPreview() === 'Charolaise|Limousine (race bovine)|Salers (race bovine)' && has('ne garder que les « race bovine » (3 sur 5 articles liés'), 'liens de la page mal filtrés : ' + linkPreview());
  linkBox().dispatch('change');
  for (let i = 0; i < 60 && cls('preview')[0].querySelectorAll('li').length !== 5; i++) await sleep(50);
  check(linkPreview() === 'Charolaise|France|Limousine (race bovine)|Massif central|Salers (race bovine)', 'tous les liens : ' + linkPreview());
  linkBox().dispatch('change');
  for (let i = 0; i < 60 && cls('preview')[0].querySelectorAll('li').length !== 3; i++) await sleep(50);
  modalBtn('Enregistrer').click();
  for (let i = 0; i < 60 && !has('enregistrée : 3 articles'); i++) await sleep(50);
  if (!SERVER) {
    const t = api.st.targets.find((x) => x.name === 'Races bovines');
    check(t && t.items.length === 3 && t.items[0].qid === 'Q900101' && t.items[0].description === 'race bovine française', 'collection de liens mal enregistrée');
  }
  needButton('← Toutes les collections').click();
  await settle();
  await openNew('mots');
  type(byId('kw'), 'https://fr.wikipedia.org/wiki/Liste_des_races_bovines_de_France');
  byId('kw').dispatch('keydown', { key: 'Enter' });
  for (let i = 0; i < 100 && !(cls('cand').length && !has('Recherche…')); i++) await sleep(50);
  await settle();
  check(cls('cand').length === 1 && text(cls('cand')[0]).includes('Races bovines de France'), 'adresse collée : ' + cls('cand').map(text).join(' / '));
  modalBtn('Annuler').click();
  await settle();
  // Page en tableaux dans « Nouvelle collection » : « Colonne clé » aussi, « Nom » présélectionnée, aperçu dans l'ordre des
  // lignes ; « Parti », puis « Nom » ; enregistrée dans cet ordre (collection sans source, ordonnée), puis supprimée.
  {
    await openNew('mots');
    type(byId('kw'), 'https://fr.wikipedia.org/wiki/Liste_des_pr%C3%A9sidents_de_Testlande');
    byId('kw').dispatch('keydown', { key: 'Enter' });
    for (let i = 0; i < 100 && !(cls('cand').length && !has('Recherche…')); i++) await sleep(50);
    await settle();
    all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Choisir Présidents de Testlande')[0].click();
    for (let i = 0; i < 100 && !(cls('preview').length && byId('kw-key')); i++) await sleep(50);
    const prev = () => cls('preview')[0].querySelectorAll('li').map(text).join('|');
    const ks = byId('kw-key');
    check(ks && ks.value === 'nom' && ks.querySelectorAll('option').map((o) => text(o)).join(' | ') === 'No (2 articles) | Nom (5 articles) | Parti (3 articles) | Ville natale (3 articles) | Aucune : tous les liens de la page'
      && prev() === 'Aline Martin|Bruno Petit|Carla Rossi (femme politique)|Émile Dubois|Fanny Leroy' && has('Colonne « Nom » des tableaux de la page')
      && !has('ne garder que les « être humain »'), 'nouvelle collection, page en tableaux : ' + (ks ? ks.value : 'pas de colonne clé') + ' / ' + (cls('preview').length ? prev() : ''));
    ks.value = 'parti';
    ks.dispatch('change');
    for (let i = 0; i < 60 && cls('preview')[0].querySelectorAll('li').length !== 3; i++) await sleep(50);
    check(prev() === 'Parti bleu|Parti rouge|Parti vert', 'nouvelle collection, colonne « Parti » : ' + prev());
    byId('kw-key').value = 'nom';
    byId('kw-key').dispatch('change');
    for (let i = 0; i < 60 && cls('preview')[0].querySelectorAll('li').length !== 5; i++) await sleep(50);
    modalBtn('Enregistrer').click();
    for (let i = 0; i < 60 && !has('enregistrée : 5 articles'); i++) await sleep(50);
    if (!SERVER) {
      const t = api.st.targets.find((x) => x.name === 'Présidents de Testlande');
      check(t && t.items.map((i) => i.title).join('|') === 'Aline Martin|Bruno Petit|Carla Rossi (femme politique)|Émile Dubois|Fanny Leroy' && t.items[3].qid === 'Q901004',
        'nouvelle collection d\'une colonne clé mal enregistrée : ' + JSON.stringify(t));
    }
    check(await waitFor(() => at().includes('Présidents de Testlande') && has('Supprimer')), 'nouvelle collection d\'une colonne clé : album attendu, ' + at());
    needButton('Supprimer').click();
    await settle();
    modalBtn('Supprimer la collection').click();
    check(await waitFor(() => !one('album-title') && !rowNames(mineSection()).includes('Présidents de Testlande')), 'collection « Présidents de Testlande » (nouvelle collection) non supprimée');
  }

  // 9 quinquies. « Définition Wikipédia » : les articles dont la première phrase dit « … est une maladie … » (formule
  // cherchée dans Wikipédia, puis début de chaque article lu : bandeaux et infobox sautés, homonymies écartées)
  await openNew('mots');
  type(byId('kw'), 'maladie');
  byId('kw').dispatch('keydown', { key: 'Enter' });
  for (let i = 0; i < 100 && !(has('Interprétation') && !has('Recherche…')); i++) await sleep(50);
  await settle();
  const defCands = cls('cand').map(text);
  check(defCands.length === 1 && defCands[0].includes('Maladies') && defCands[0].includes('6 articles citent la formule, triés à l\'ouverture · Définition Wikipédia')
    && defCands[0].includes('Articles dont la première phrase dit « … est une maladie … »'), 'candidat « Définition » : ' + defCands.join(' / '));
  all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Choisir Maladies')[0].click();
  for (let i = 0; i < 100 && !cls('preview').length; i++) await sleep(50);
  const defPreview = () => cls('preview')[0].querySelectorAll('li').map(text).join('|');
  check(defPreview() === 'Grippe|Malabsorption du fructose|Phtiriase', 'définitions mal triées : ' + defPreview());
  check(has('Définition Wikipédia · articles dont la première phrase dit « … est une maladie … »') && has('3 retenus sur 6 articles lus, par ordre alphabétique'),
    'note de l\'aperçu des définitions : ' + text(one('modal')).slice(0, 500));
  check(byId('kw-name').value === 'Maladies', 'nom proposé pour les définitions : ' + byId('kw-name').value);
  modalBtn('Enregistrer').click();
  for (let i = 0; i < 60 && !has('« Maladies » enregistrée : 3 articles'); i++) await sleep(50);
  await settle();
  if (!SERVER) {
    const t = api.st.targets.find((x) => x.name === 'Maladies');
    check(t && t.items.length === 3 && t.items[0].title === 'Grippe' && t.items[0].qid === 'Q2840' && t.items[0].description === 'maladie infectieuse'
      && t.items[1].qid === 'Q1047897' && t.items.every((i) => i.status === 'ok'), 'collection « Définition » mal enregistrée : ' + JSON.stringify(t && t.items));
  }
  needButton('← Toutes les collections').click();
  await settle();
  // Trop d'articles pour tous les lire : seulement les plus liés depuis Wikipédia, lus jusqu'à en avoir assez.
  await openNew('mots');
  type(byId('kw'), 'cathédrales');
  byId('kw').dispatch('keydown', { key: 'Enter' });
  for (let i = 0; i < 100 && !(has('Interprétation') && !has('Recherche…')); i++) await sleep(50);
  await settle();
  const bigDef = cls('cand').filter((c) => text(c).includes('Définition Wikipédia'))[0];
  check(bigDef && text(bigDef).includes('plus de 10 000 articles (12 000 citent la formule)') && text(bigDef).includes('Garder les plus connus') && !text(bigDef).includes('Choisir'),
    'grand candidat « Définition » : ' + (bigDef ? text(bigDef) : cls('cand').map(text).join(' / ')));
  bigDef.querySelectorAll('button').filter((b) => b.getAttribute('aria-label') === 'Garder les 100 plus connus')[0].click();
  for (let i = 0; i < 100 && !cls('preview').length; i++) await sleep(50);
  const bigItems = cls('preview')[0].querySelectorAll('li').map(text);
  check(byId('kw-name').value === 'Cathédrales (les 100 plus connus)' && bigItems.length === 20 && has('… et 80 autres') && bigItems[0] === 'Cathédrale 1' && !bigItems.some((x) => x.startsWith('Ville')),
    'plus connus de la définition : ' + text(one('modal')).slice(0, 500));
  check(has('100 retenus sur 180 articles lus, les plus liés depuis Wikipédia d\'abord'), 'note des plus connus : ' + text(one('modal')).slice(0, 600));
  const linked = defCalls.filter((x) => x.sort === 'incoming_links_desc');
  check(linked.length === 2 && linked[0].limit === 130 && linked[1].offset === 130 && linked[1].limit === 50, 'lecture des plus connus : ' + JSON.stringify(linked));
  modalBtn('Annuler').click();
  await settle();

  // 10. Nouvelle collection (liste d'articles) : vérification sur Wikipédia (redirection, homonymie, introuvable)
  await openNew('liste');
  type(byId('ed-name'), "Dieux de l'Olympe");
  type(byId('ed-text'), 'zeus\nPoseidon\nhttps://fr.wikipedia.org/wiki/H%C3%A9ra\nMercure\nInexistant\nRihanna\n');
  modalBtn('Enregistrer').click();
  for (let i = 0; i < 100 && !has('posent problème'); i++) await sleep(50);
  await settle(200);
  check(has('2 articles posent problème') && has('Mercure') && has('Inexistant'), "les problèmes de vérification ne s'affichent pas");
  needButton('Enregistrer quand même').click();
  for (let i = 0; i < 100 && !has('Collection enregistrée'); i++) await sleep(50);
  await settle(200);
  if (!SERVER) {
    const t = api.st.targets.find((x) => x.name === "Dieux de l'Olympe");
    check(t && t.items.map((i) => i.title + ':' + i.status).join(',') === 'Zeus:ok,Poséidon:ok,Héra:ok,Mercure:disambiguation,Inexistant:missing,Rihanna:ok', 'items enregistrés : ' + (t && JSON.stringify(t.items)));
    check(t.items[0].image === 'https://upload.wikimedia.org/z.jpg' && t.items[0].description === 'dieu grec', 'description ou vignette perdue');
    check(t.items[0].qid === 'Q34201' && !('qid' in t.items[4]), "qid de la vérification sur Wikipédia non envoyé");
  }
  check(text(one('album-title')).includes('1 sur 6') && has("Il t'en manque 5") && has('Tu en as 1 :'), 'en-tête de la collection incorrect');
  for (let i = 0; i < 40 && has('Rareté estimée des cases vides'); i++) await sleep(100);
  check(pvContinueSeen, 'la continuation des vues (pvipcontinue) n\'est pas suivie');
  const ests = cls('slot').map((s) => text(s.querySelector('.pill')));
  check(ests.includes('≈ L') && ests.includes('≈ SR') && ests.includes('≈ R'), 'raretés estimées : ' + ests.join(' '));
  check(has("Page d'homonymie : précise le titre") && has('Article introuvable sur Wikipédia'), 'avertissements des cases vides absents');
  check(cls('slot').length === 5 && cls('slot__no').length === 5 && cls('cell').length === 1, 'cases vides numérotées absentes');
  // Cases vides : bouton « Copier le nom » sur les articles vérifiés (ni homonymie ni article introuvable).
  {
    const buttons = cls('slot__copy');
    check(buttons.length === 3 && buttons.every((b) => b.tagName === 'BUTTON' && b.getAttribute('type') === 'button') && !cls('slot__market').length,
      'boutons « Copier le nom » des cases vides : ' + buttons.length);
    const zeus = buttons.filter((b) => (b.getAttribute('aria-label') || '').includes('« Zeus »'))[0];
    check(zeus, 'bouton « Copier le nom » de « Zeus » sans nom accessible');
    zeus.click();
    await settle();
    check(copied[copied.length - 1] === 'Zeus', 'le nom de la case vide n\'est pas copié');
    check(cls('slot__copy').some((b) => b.getAttribute('aria-label') === 'Nom « Zeus » copié'), 'pas de confirmation sur le bouton de la case');
  }
  check(has('40 000 vues / 30 j') || has('40 000 vues / 30 j'), 'vues sur 30 jours absentes des cases vides');
  // Toute la case vide ouvre la fiche de la carte manquante (bouton étendu, frère de la loupe) : description, rareté
  // estimée, vues, collections, marché et Wikipédia ; sans marché pour une homonymie ou un article introuvable.
  {
    const opener = (t) => cls('slot__open').filter((b) => (b.getAttribute('aria-label') || '').startsWith(t + ' : '))[0];
    check(cls('slot__open').length === 5 && cls('slot__open').every((b) => b.tagName === 'BUTTON' && b.getAttribute('type') === 'button' && !b.querySelector('a, button')),
      'boutons d\'ouverture des cases vides : ' + cls('slot__open').length);
    check(cls('slot').every((s) => s.querySelectorAll('h3').every((t) => !t.querySelector('a'))), 'le titre d\'une case vide ne doit plus être un lien (la case entière ouvre la fiche)');
    const zeusBtn = opener('Zeus');
    check(zeusBtn, 'bouton d\'ouverture de « Zeus » absent');
    zeusBtn.focus();
    zeusBtn.click();
    await settle(120);
    const f = one('fiche');
    check(f && f.classList.contains('fiche--missing') && text(f.querySelector('h2')) === 'Zeus', 'la case vide n\'ouvre pas la fiche de la carte manquante');
    const ft = text(f);
    check(ft.includes('Pas encore dans ta collection') && ft.includes('dieu grec') && ft.includes('≈ Légendaire') && ft.includes('40 000'),
      'contenu de la fiche manquante : ' + ft.slice(0, 400));
    check(f.querySelector('.slot__bg') && f.querySelector('.slot__bg').getAttribute('src') === 'https://upload.wikimedia.org/z.jpg', 'vignette absente de la fiche manquante');
    check(ft.includes('Dans tes collections') && f.querySelector('.memberships') && f.querySelector('.memberships').querySelectorAll('button').some((b) => text(b).includes("Dieux de l'Olympe")), 'collections de la carte manquante absentes');
    const wp = f.querySelectorAll('a').filter((a) => text(a).includes("Lire l'article sur Wikipédia"))[0];
    check(wp && wp.getAttribute('href') === 'https://fr.wikipedia.org/wiki/Zeus' && wp.getAttribute('target') === '_blank', 'lien Wikipédia absent de la fiche manquante');
    const m = f.querySelectorAll('button').filter((b) => /^(Copier le nom|Nom) « Zeus »/.test(b.getAttribute('aria-label') || '') && b.classList.contains('copy-name'))[0];
    check(m && !f.querySelectorAll('a').some((a) => /marketplace/.test(a.getAttribute('href') || '')), 'bouton « Copier le nom » absent de la fiche manquante (ou lien du marché resté)');
    const n = copied.length;
    m.click();
    await settle();
    check(copied.length === n + 1 && copied[n] === 'Zeus' && one('fiche'), 'la fiche manquante ne copie pas le nom (ou se ferme)');
    win.listeners.keydown.forEach((fn) => fn({ key: 'Escape', preventDefault() {} }));
    await settle(500);
    check(!one('fiche'), 'Échap ne ferme pas la fiche de la carte manquante');
    check(doc.activeElement === opener('Zeus'), 'le focus ne revient pas sur la case vide après la fiche');
    // Homonymie : la fiche s'ouvre, avec l'avertissement et Wikipédia, sans « Copier le nom ».
    opener('Mercure').click();
    await settle(120);
    const g = one('fiche');
    check(g && text(g.querySelector('h2')) === 'Mercure' && text(g).includes("Page d'homonymie") && text(g).includes("Lire l'article sur Wikipédia")
      && !g.querySelectorAll('button').some((b) => (b.getAttribute('aria-label') || '').startsWith('Copier le nom')), 'fiche d\'une homonymie : ' + text(g).slice(0, 300));
    g.querySelector('.close').click();
    await settle(500);
    check(!one('fiche'), 'le bouton Fermer ne ferme pas la fiche de la carte manquante');
  }
  await sleep(1600);
  const pvCache = JSON.parse(ls.get('classeur-pv') || '{}');
  check(pvCache.Zeus && pvCache.Zeus[1][0] === 40000, 'cache des vues non écrit');
  all((n) => n.tagName === 'BUTTON' && text(n).trim() === 'Rareté')[0].click();
  await settle();
  { const g = cls('cardgrid')[0].childNodes.filter((n) => n.nodeType === 1); check(text(g[0]).includes('Zeus') && text(g[1]).includes('Rihanna') && text(g[2]).includes('Héra'), 'tri par rareté : ' + g.slice(0, 3).map((n) => text(n).slice(0, 20)).join(' | ')); }
  all((n) => n.tagName === 'BUTTON' && text(n).trim() === 'Manquantes')[0].click();
  await settle();
  check(cls('cell').length === 0 && cls('slot').length === 5, 'filtre Manquantes incorrect');

  // 11. Supprimer la collection (confirmation dans la page)
  all((n) => n.tagName === 'BUTTON' && text(n).trim() === 'Supprimer')[0].click();
  await settle();
  check(has('Supprimer « Dieux de l\'Olympe » ?'), 'confirmation de suppression absente');
  needButton('Supprimer la collection').click();
  await settle(400);
  check(has('Mes collections') && !cls('group')[0].querySelectorAll('.row').some((n) => text(n).includes('Dieux')), 'collection non supprimée');
  // Bandeau : les 6 collections de « Mes collections », les 2 faites d'une catégorie de Wikipédia comprises.
  check(colFigure() === '6 collections' && cls('group')[0].querySelectorAll('.row').length === 6, 'tuile des collections : ' + colFigure());

  // 12. « Rafraîchir la collection » (compte relié) : le serveur relit toute la collection dans le jeu, en un appel
  // (POST /api/refresh), puis la page ne lit que ce qui a changé (?since) ; une carte nouvelle dans le jeu, un exemplaire
  // compté par le jeu mais pas lu (lecture non vérifiée : rien n'est retiré, et c'est dit). Une seconde fois dans la
  // minute : refusé (429), avec l'attente.
  {
    const key = ls.get('classeur-key');
    const cur = (await rawApi('GET', '/api/cards', key)).body.cards.map(({ tags, ...c }) => c);
    const fresh = { id: 'new1', title: 'Nouvelle carte', rarity: 'SR', atk: 5, def: 6, quality: 1, pageviews: 3000, category: 'test', image: null, url: null, count: 1, shiny: true, starred: false,
      obtained_at: '2026-10-15T09:00:00Z', variants: { 'SR*': 1 }, gtags: [], gtagc: null };
    await setGame(key, [...cur, fresh]);
    if (!SERVER) Object.assign(api.st, { phantom: 1, clickAt: 0 });
  }
  mark = apiLog.length;
  needButton('Rafraîchir la collection').click();
  await settle();
  for (let i = 0; i < 1200 && (has('Rafraîchissement…') || !text(doc.body.querySelector('.refresh-line')).match(/cartes ·|moins d'une minute|répond/)); i++) await sleep(50);
  await settle(100);
  if (SERVER) console.log('rafraîchissement : ' + text(doc.body.querySelector('.refresh-line')));
  if (!SERVER) {
    const sent = api.st.calls.filter(([m, p]) => m === 'POST' && p === '/api/refresh').slice(-1);
    check(apiLog.slice(mark).filter((x) => x === 'POST /api/refresh').length === 1 && JSON.stringify(sent[0][2]) === '{}', 'rafraîchissement : un seul POST /api/refresh {} attendu, ' + apiLog.slice(mark).join(', '));
    const line = text(doc.body.querySelector('.refresh-line'));
    check(line.includes('1 051 cartes') && line.includes('1 nouvelle') && line.includes('2 ignorées'), 'résumé du rafraîchissement : ' + line);
    check(line.includes("moins d'exemplaires lus que le jeu n'en compte : aucune carte retirée") && doc.body.querySelector('.refresh-line').querySelector('.status').classList.contains('warn'), 'lecture non vérifiée non dite : ' + line);
    check(cardCalls(mark).length === 1 && /\?since=\d+$/.test(cardCalls(mark)[0]), 'après le rafraîchissement : un seul ?since attendu, ' + cardCalls(mark).join(', '));
    needButton('Rafraîchir la collection').click();
    await settle(100);
    check(/Collection déjà rafraîchie il y a moins d'une minute : patiente un instant\. \(encore \d+ s\)/.test(text(doc.body.querySelector('.refresh-line'))), 'second clic dans la minute : ' + text(doc.body.querySelector('.refresh-line')));
    api.st.phantom = 0;
    await goTab('cartes');
    check(has('Nouvelles du dernier rafraîchissement'), 'raccourci des nouvelles absent');
    all((n) => n.tagName === 'BUTTON' && n.classList.contains('chip') && text(n).includes('Nouvelles du dernier rafraîchissement'))[0].click();
    await settle();
    check(cls('cell').length === 1 && cls('card__new').length === 1 && has('Nouvelle carte'), 'ruban « Nouvelle » ou raccourci des nouvelles incorrect');
    needButton('Réinitialiser les filtres').click();
    await settle();

    // 12 bis. Envoi sans deux cartes (retirées du jeu) et tags changés sur un autre appareil : au retour sur l'onglet,
    // seul ?since est lu ; les cartes retirées disparaissent, avec la fiche ouverte et la sélection qui les montraient.
    const key = ls.get('classeur-key');
    type(q, 'mirna');
    await settle();
    check(cls('cell').length === 1, 'carte « (11194) Mirna » introuvable');
    all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox')[0].click();
    await settle();
    one('card').dispatch('click');
    await settle(120);
    check(one('fiche') && one('bulk'), 'fiche ou sélection absente avant le retrait');
    const cur = (await rawApi('GET', '/api/cards', key)).body.cards;
    await rawApi('POST', '/api/tags/set', key, { card_id: 'c10', tags: [...cur.find((c) => c.id === 'c10').tags, 'Ailleurs'] });
    await seedCards(key, cur.filter((c) => c.id !== 'c2' && c.id !== 'c1000'));
    mark = apiLog.length;
    for (const f of doc.listeners.visibilitychange || []) await f();
    await settle(500);
    check(cardCalls(mark).length === 1 && /\?since=\d+$/.test(cardCalls(mark)[0]), 'retour sur l\'onglet : un seul ?since attendu, ' + cardCalls(mark).join(', '));
    check(!one('fiche') && !one('bulk'), 'la carte retirée reste ouverte ou sélectionnée');
    check(has('Collection mise à jour : 1 049 cartes.') && countIn(doc) === 1049, 'cartes retirées : 1 049 cartes attendues, ' + countIn(doc));
    check(cls('cell').length === 0, 'la carte retirée reste affichée');
    type(q, 'ailleurs');
    await settle();
    check(cls('cell').length === 1, 'le tag posé sur un autre appareil n\'est pas arrivé');

    // 12 ter. Tags changés ailleurs, sans envoi : cards_rev le dit, ?since les rapporte. Un tag posé ici pendant cette
    // lecture n'est pas écrasé par sa réponse, calculée avant lui ; la lecture suivante rapporte l'état du serveur.
    type(q, 'terre');
    await settle();
    check(cls('cell').length === 1, 'carte « Terre » introuvable');
    one('card').dispatch('click');
    await settle(120);
    const ficheTags = () => one('fiche').querySelectorAll('.tag.own').map(text).join('|');
    const expected = [ficheTags(), 'Local'].filter(Boolean).join('|');
    await rawApi('POST', '/api/tags/set', key, { card_id: 'c5', tags: ['Distant'] });
    let release = null;
    mainOpts.hold = (url) => (url.startsWith('/api/cards') ? new Promise((r) => { release = r; }) : null);
    mark = apiLog.length;
    const back = Promise.all([...(doc.listeners.visibilitychange || [])].map((f) => f()));
    check(await waitFor(() => !!release), 'tags changés ailleurs : ?since non demandé au retour sur l\'onglet');
    mainOpts.hold = null;
    type(byId('new-tag'), 'Local');
    all((n) => n.tagName === 'BUTTON' && n.getAttribute('type') === 'submit' && text(n) === 'Ajouter')[0].click();
    await settle();
    release();
    await back;
    await settle();
    check(cardCalls(mark).length === 1 && /\?since=\d+$/.test(cardCalls(mark)[0]), 'tags changés ailleurs : un seul ?since attendu, ' + cardCalls(mark).join(', '));
    check(ficheTags() === expected, 'tag posé pendant la lecture écrasé par sa réponse : ' + ficheTags() + ' au lieu de ' + expected);
    mark = apiLog.length;
    for (const f of doc.listeners.visibilitychange || []) await f();
    await settle();
    check(cardCalls(mark).length === 1 && ficheTags() === expected && api.st.tags.get('c5').includes('Local') && !api.st.tags.get('c5').includes('Distant'),'lecture suivante : ' + ficheTags() + ', ' + cardCalls(mark).join(', '));
    win.listeners.keydown.forEach((fn) => fn({ key: 'Escape', preventDefault() {} }));
    await settle(500);
    type(q, '');
    await settle();
  }

  // 12 quater. Journal des synchros : « Dernières synchros » dans « Synchro » (résultat, chemin et type, heure, message,
  // répétitions ; une ligne d'avant le 22 octobre 2026 garde son type), ligne d'état sous le résumé quand la dernière a
  // échoué, et un nouvel échec d'une lecture automatique annoncé au retour sur l'onglet.
  if (!SERVER) {
    const at = (min) => new Date(Date.now() - min * 60_000).toISOString();
    api.st.syncLog = [
      { at: at(1), kind: 'full', result: 'error', message: 'Le jeu a refusé la lecture (trop de requêtes) : la prochaine lecture automatique est sautée.', data: { via: 'cron' } },
      { at: at(5), kind: 'full', result: 'ok', message: 'Lecture complète : 1 050 cartes, aucune nouvelle, aucune retirée.', data: { via: 'cron', repeat: 3, first: at(30) } },
      { at: at(60), kind: 'session', result: 'ok', message: 'Compte du jeu relié (Joueur).', data: { via: 'relier' } },
      { at: at(90), kind: 'quick', result: 'ok', message: 'Synchro rapide : rien de nouveau (1 050 cartes).', data: { via: 'relie', v: 3 } },
    ];
    api.st.lastSync = { at: at(1), kind: 'full', via: 'cron', result: 'error', message: api.st.syncLog[0].message };
    for (const f of doc.listeners.visibilitychange || []) await f();
    await settle(200);
    await goTab('collections');
    const line = () => text(doc.body.querySelector('.refresh-line'));
    check(/Dernière synchro en échec \(Automatique · lecture complète, aujourd'hui à \d\d:\d\d\) : Le jeu a refusé la lecture/.test(line()), 'échec de la dernière synchro absent du résumé : ' + line());
    needButton('Dernières synchros').click();
    await settle(200);
    check(tabBtn('maj').getAttribute('aria-selected') === 'true', '« Dernières synchros » doit ouvrir « Synchro »');
    check(api.st.calls.some(([m, p]) => m === 'GET' && p === '/api/sync-log'), 'journal non demandé à l\'ouverture de « Synchro »');
    const rows = () => cls('synclog-row');
    check(has('Dernières synchros') && rows().length === 4, 'journal : 4 lignes attendues, ' + rows().length);
    check(rows()[0].classList.contains('is-error') && text(rows()[0]).includes('échec') && text(rows()[0]).includes('Automatique · lecture complète') && text(rows()[0]).includes('Le jeu a refusé la lecture'),
      'ligne en échec : ' + text(rows()[0]));
    check(text(rows()[1]).includes('réussie') && text(rows()[1]).includes('Automatique · lecture complète') && /3 fois depuis aujourd'hui à \d\d:\d\d/.test(text(rows()[1])), 'ligne répétée : ' + text(rows()[1]));
    check(text(rows()[2]).includes('Liaison · compte') && text(rows()[2]).includes('Compte du jeu relié (Joueur).'), 'ligne de liaison : ' + text(rows()[2]));
    check(text(rows()[3]).includes('Synchro · synchro rapide'), "ligne d'avant le 22 octobre 2026 : " + text(rows()[3]));
    check(!/favori/i.test(text(one('synclog'))), "le journal ne doit plus parler de l'ancien favori");
    api.st.syncLog = [{ at: at(0), kind: 'full', result: 'ok', message: 'Lecture complète : 1 050 cartes, aucune nouvelle, aucune retirée.', data: { via: 'clic' } }, ...api.st.syncLog];
    needButton('Actualiser').click();
    await settle(200);
    check(rows().length === 5 && text(rows()[0]).includes('Clic · lecture complète'), 'journal non relu par « Actualiser »');
    // Nouvel échec d'une lecture automatique pendant que la page est ouverte : annoncé au retour sur l'onglet, journal relu.
    const msg = 'Le jeu limite les lectures automatiques : la prochaine passe est sautée. Rien n\'a été changé dans ton classeur.';
    api.st.syncLog = [{ at: at(0), kind: 'full', result: 'error', message: msg, data: { via: 'cron' } }, ...api.st.syncLog];
    api.st.lastSync = { at: api.st.syncLog[0].at, kind: 'full', via: 'cron', result: 'error', message: msg };
    for (const f of doc.listeners.visibilitychange || []) await f();
    await settle(200);
    check(has('La dernière synchro a échoué : ' + msg), 'nouvel échec automatique non annoncé');
    check(rows().length === 6 && text(rows()[0]).includes('Automatique · lecture complète'), 'journal non relu après un nouvel échec');
    // Lecture automatique en pause (3 échecs d'affilée) : dit, avec le remède.
    api.st.fails = 3;
    for (const f of doc.listeners.visibilitychange || []) await f();
    await settle(100);
    check(has("Synchro automatique en pause après 3 échecs d'affilée : « Rafraîchir maintenant » la relance."), 'pause de la synchro automatique non dite');
    api.st.fails = 0;
    api.st.syncLog = [];
    api.st.lastSync = null;
    for (const f of doc.listeners.visibilitychange || []) await f();
    await settle(100);
  }

  // 12 quinquies. Session révoquée par le jeu pendant un « Rafraîchir » : 401 needs_link, qui ne fait pas oublier la clé du
  // classeur ; « À relier » dans le bandeau et dans « Synchro », et le bouton du bandeau mène à la liaison.
  if (!SERVER) {
    await goTab('collections');
    Object.assign(api.st, { revokeNext: true, clickAt: 0 });
    needButton('Rafraîchir la collection').click();
    for (let i = 0; i < 100 && !has('compte du jeu à relier'); i++) await sleep(30);
    check(has("Ta session du jeu n'est plus valable (révoquée) : relie ton compte.") && h1() === 'Le classeur de Cédric' && ls.get('classeur-key'), 'session révoquée : message ou classeur perdu');
    check(has('· compte du jeu à relier') && buttonByText('Relier mon compte'), 'session révoquée : bandeau non adapté');
    needButton('Relier mon compte').click();
    await settle(100);
    check(tabBtn('maj').getAttribute('aria-selected') === 'true' && has('À relier : révoquée') && has('Relier mon compte du jeu') && !has('Rafraîchir maintenant'), 'session révoquée : « Synchro » non adapté');
    Object.assign(api.st, { linked: true, lost: null });
    for (const f of doc.listeners.visibilitychange || []) await f();
    await settle(100);
  }


  // 13. En secours, depuis une fenêtre privée : le cookie collé (préfixe « Cookie: » retiré) relie le compte puis lit la
  // collection ; « Oublier la liaison » ; puis un HAR, dont seuls l'adresse et le cookie des requêtes vers le jeu partent.
  if (!SERVER) {
    await goTab('maj');
    check(has('Compte du jeu relié') && byId('cookie-input'), '« Synchro » : compte relié et secours attendus');
    api.st.clickAt = 0;
    type(byId('cookie-input'), 'Cookie: sb-a=1; sb-b=2');
    mark = apiLog.length;
    syncButton('Relier avec ce cookie').click();
    for (let i = 0; i < 100 && !apiLog.slice(mark).includes('POST /api/refresh'); i++) await sleep(30);
    await settle(100);
    check(api.st.lastSession && api.st.lastSession.cookie === 'sb-a=1; sb-b=2' && apiLog.slice(mark).includes('POST /api/refresh'), 'cookie mal envoyé, ou lecture non lancée : ' + JSON.stringify(api.st.lastSession));
    check(byId('cookie-input').value === '' && has('Compte du jeu relié'), 'cookie : champ non vidé ou compte non relié');
    syncButton('Oublier la liaison').click();
    await settle(100);
    check(!api.st.linked && has('Aucun compte du jeu relié') && buttonByText('Relier mon compte') && !has('Oublier la liaison'), '« Oublier la liaison » sans effet');
    const fileInput = all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'file')[0];
    const har = { log: { entries: [
      { request: { url: 'https://www.wiki-masters.com/api/my-collection?page=0', headers: [{ name: 'cookie', value: 'sb=har' }, { name: 'authorization', value: 'secret' }] }, response: { content: { text: 'PRIVÉ' } } },
      { request: { url: 'https://autre.example/', headers: [{ name: 'Cookie', value: 'autre=1' }] } },
    ] } };
    fileInput.files = [{ text: async () => JSON.stringify(har) }];
    fileInput.dispatch('change');
    await settle(200);
    const sent = JSON.stringify(api.st.lastSession);
    check(sent === '{"har":{"log":{"entries":[{"request":{"url":"https://www.wiki-masters.com/api/my-collection?page=0","headers":[{"name":"Cookie","value":"sb=har"}]}}]}}}' && api.st.linked, 'HAR envoyé : ' + sent);
  }
  await settle(200);

  const openLink = async (key) => {
    ctx.location.hash = '#cle=' + key;
    for (const f of win.listeners.hashchange || []) f();
    for (let i = 0; i < 40; i++) { await settle(25); if (!has('Ouverture du classeur')) break; }
    await settle(100);
  };
  const exactButton = (t) => { const b = all((n) => n.tagName === 'BUTTON' && text(n).trim() === t)[0]; if (!b) fail('bouton absent : ' + t + '\n' + text(doc.body).slice(-600)); return b; };
  const modalButton = (t) => { const m = one('modal'); const b = m && m.querySelectorAll('button').filter((n) => text(n).trim() === t)[0]; if (!b) fail('bouton absent de la fenêtre : ' + t); return b; };
  const waitH1 = async (name) => { for (let i = 0; i < 200 && !h1().includes(name); i++) await settle(25); };
  const myKey = ls.get('classeur-key');

  // 14. Lien d'un autre classeur : vérifié, puis demandé ; la clé gardée n'est pas écrasée sans accord
  const otherKey = await makeOtherAccount('Bob');
  await openLink(otherKey);
  check(ctx.location.hash === '', 'fragment #cle= non effacé');
  check(has('Ouvrir le classeur de Bob à la place du tien ?'), 'pas de question avant d\'ouvrir un autre classeur');
  check(ls.get('classeur-key') === myKey, 'clé écrasée avant confirmation');
  exactButton('Garder le mien').click();
  await settle(100);
  check(ls.get('classeur-key') === myKey && h1().includes('Cédric') && !one('modal'), '« Garder le mien » ne garde pas le classeur');
  await openLink(otherKey);
  modalButton('Ouvrir').click();
  await waitH1('Bob');
  check(ls.get('classeur-key') === otherKey && h1() === 'Le classeur de Bob', "« Ouvrir » n'ouvre pas l'autre classeur");
  check(JSON.parse(ls.get('classeur-known') || '[]').length === 2, 'liste des classeurs connus incomplète');
  await goTab('reglages');
  check(has('Autres classeurs ouverts dans ce navigateur') && has('Classeur de Cédric'), 'retour à son classeur absent des Réglages');
  mark = apiLog.length;
  exactButton('Ouvrir').click();
  await waitH1('Cédric');
  check(ls.get('classeur-key') === myKey && h1().includes('Cédric'), 'retour à son classeur impossible');
  {
    // Ses cartes, gardées dans ce navigateur au changement de classeur, sont à jour (même cards_rev) : rien à relire.
    await settle(100);
    const n = (await rawApi('GET', '/api/cards', myKey)).body.cards.length;
    check(countIn(doc) === n && !cardCalls(mark).length, 'retour à son classeur : cartes du cache sans lecture attendues, ' + countIn(doc) + ' cartes, ' + cardCalls(mark).join(', '));
    check(cachedCards().length === 2 && cachedCards().every((r) => r.v === 1 && Number.isInteger(r.rev) && Array.isArray(r.cards) && !('_k' in (r.cards[0] || {}))),
      'cache : un enregistrement par classeur, cartes telles que l\'API les renvoie');
  }

  // 15. Lien tronqué ou inconnu : refusé avec un message clair, jamais enregistré
  await openLink(myKey.slice(0, 20));
  check(has('incomplet ou abîmé') && ls.get('classeur-key') === myKey, 'lien tronqué mal géré');
  const unknownKey = 'Z'.repeat(43);
  await openLink(unknownKey);
  check(has('ne correspond à aucun classeur') && ls.get('classeur-key') === myKey, 'lien inconnu mal géré');
  check(!(ls.get('classeur-known') || '').includes(unknownKey), 'clé inconnue enregistrée');

  // 16. Changer ma clé : nouveau lien montré, ancienne clé oubliée
  await goTab('reglages');
  {
    // « Synchro rapide du marché » : décochée par défaut, PATCH /api/me {fast_sync} au clic.
    const fast = byId('set-fast-sync');
    check(fast && !fast.checked && has('à tes risques'), '« Synchro rapide du marché » absente ou cochée par défaut');
    fast.checked = true;
    fast.dispatch('change');
    await settle(SERVER ? 300 : 60);
    check(byId('set-fast-sync').checked && (SERVER || api.st.fastSync === true), '« Synchro rapide du marché » non cochée');
    byId('set-fast-sync').checked = false;
    byId('set-fast-sync').dispatch('change');
    await settle(SERVER ? 300 : 60);
    check(!byId('set-fast-sync').checked && (SERVER || api.st.fastSync === false), '« Synchro rapide du marché » non décochée');
  }
  check(has("Un lien ouvert reste dans l'historique du navigateur"), "l'avertissement sur l'historique manque");
  needButton('Changer ma clé').click();
  await settle();
  check(has('Changer ma clé ?'), 'confirmation de changement de clé absente');
  modalButton('Changer ma clé').click();
  await settle(SERVER ? 300 : 80);
  const rotated = ls.get('classeur-key');
  check(rotated && rotated !== myKey && byId('new-key-link') && byId('new-key-link').value === ORIGIN + '/#cle=' + rotated, 'nouveau lien absent après changement de clé');
  check(!(ls.get('classeur-known') || '').includes(myKey), 'ancienne clé encore connue');
  exactButton("C'est noté").click();
  await settle();
  const st1 = await rawApi('GET', '/api/me', myKey);
  check(st1.status === 401, "l'ancienne clé marche encore (" + st1.status + ')');

  // 18. Oublier ce navigateur : clé, classeurs connus, caches de Wikipédia
  await sleep(1600);
  check(ls.get('classeur-pv') && ls.get('classeur-sugg'), 'caches attendus avant l\'oubli');
  await goTab('reglages');
  needButton('Oublier ce navigateur').click();
  await settle();
  modalButton('Oublier ce navigateur').click();
  await settle(100);
  check(has("J'ai déjà un lien"), "oublier ce navigateur ne ramène pas à l'accueil");
  const left = ['classeur-key', 'classeur-pv', 'classeur-sugg', 'classeur-import-key', 'classeur-known', 'classeur-target', 'classeur-qid', 'classeur-cats', 'classeur-catinfo', 'classeur-catparents', 'classeur-propose-at', 'classeur-natgroup', 'classeur-tagcats'].filter((k) => ls.has(k));
  check(!left.length, 'encore gardé après « Oublier ce navigateur » : ' + left.join(', '));
  await sleep(1700);
  check(!cachedCards().length, 'cartes encore gardées (IndexedDB) après « Oublier ce navigateur » : ' + cachedCards().length);

  // 19. Lien personnel sans clé gardée : vérifié puis adopté sans question, fragment effacé
  mark = apiLog.length;
  await openLink(rotated);
  await waitH1('Cédric');
  check(ctx.location.hash === '' && ls.get('classeur-key') === rotated && h1() === 'Le classeur de Cédric' && has('Mes collections'), 'le lien personnel n\'ouvre pas le classeur');
  check(cardCalls(mark)[0] === 'GET /api/cards?part=0', 'sans cache, relecture complète attendue : ' + cardCalls(mark).join(', '));

  // 20. Le classeur rouvert dans une autre page (même navigateur) : cartes du cache affichées avant toute réponse de
  // /api/cards, puis seulement ce qui a changé entre-temps (une carte retirée, un tag posé ailleurs).
  {
    await sleep(1700); // écriture du cache (regroupée)
    const key = ls.get('classeur-key');
    const me = (await rawApi('GET', '/api/me', key)).body;
    const cur = (await rawApi('GET', '/api/cards', key)).body.cards;
    const n0 = cur.length;
    const rec = cachedCards().find((r) => r.user === me.user.id);
    check(rec && rec.rev === me.cards_rev && rec.cards.length === n0, 'cache non écrit après la relecture : ' + (rec ? rec.rev + ' / ' + me.cards_rev + ', ' + rec.cards.length + ' / ' + n0 : 'absent'));
    await rawApi('POST', '/api/tags/set', key, { card_id: 'c11', tags: ['Vu ailleurs'] });
    await seedCards(key, cur.filter((c) => c.id !== 'c12'));
    let open = null;
    const gate = new Promise((r) => { open = r; });
    mark = apiLog.length;
    const p2 = openPage({ hold: (url) => (url.startsWith('/api/cards') ? gate : null) });
    check(await waitFor(() => p2.count() === n0), 'deuxième page : les cartes du cache ne s\'affichent pas avant la réponse de /api/cards (' + p2.count() + ')');
    check(cardCalls(mark).length === 1 && cardCalls(mark)[0] === 'GET /api/cards?since=' + rec.rev, 'deuxième page : ?since=' + rec.rev + ' attendu, ' + cardCalls(mark).join(', '));
    open();
    check(await waitFor(() => p2.count() === n0 - 1), 'deuxième page : la carte retirée reste (' + p2.count() + ')');
    await settle(100);
    check(cardCalls(mark).length === 1, 'deuxième page : lectures en trop, ' + cardCalls(mark).join(', '));
    p2.doc.getElementById('tab-cartes').click();
    await settle();
    const q2 = p2.doc.getElementById('q');
    q2.value = 'vu ailleurs';
    q2.dispatch('input');
    await settle();
    check(p2.doc.querySelectorAll('.cell').length === 1, 'deuxième page : le tag posé ailleurs n\'est pas arrivé');

    // 21. Rien n'a changé depuis : aucune lecture des cartes, tout vient du cache.
    await sleep(1700);
    mark = apiLog.length;
    const p3 = openPage();
    check(await waitFor(() => p3.count() === n0 - 1), 'troisième page : cartes du cache absentes (' + p3.count() + ')');
    await settle(200);
    check(!cardCalls(mark).length, 'troisième page : rien n\'a changé, aucune lecture attendue : ' + cardCalls(mark).join(', '));

    // 22. Base recréée (cards_rev plus petit que la révision gardée) : cache ignoré et effacé, relecture complète.
    if (!SERVER) {
      api.st.rev = 1;
      api.st.changed = new Map();
      mark = apiLog.length;
      const p4 = openPage({ hold: (url) => (url.startsWith('/api/cards') ? sleep(300) : null) });
      await sleep(150);
      check(p4.count() === null, 'base recréée : les cartes du cache ne doivent pas s\'afficher (' + p4.count() + ')');
      check(await waitFor(() => p4.count() === n0 - 1) && cardCalls(mark)[0] === 'GET /api/cards?part=0' && !cardCalls(mark).some((x) => x.includes('since')),
        'base recréée : relecture complète attendue, ' + cardCalls(mark).join(', '));
      check(await waitFor(() => (cachedCards().find((r) => r.user === api.st.id) || {}).rev === 1), 'base recréée : cache non réécrit avec la nouvelle révision');
    }

    // 23. IndexedDB absent ou refusé (navigation privée, stockage bloqué) : la page lit tout au serveur, comme avant.
    for (const mode of ['absent', 'refusé']) {
      mark = apiLog.length;
      const p = openPage({ idb: mode });
      check(await waitFor(() => p.count() === n0 - 1) && cardCalls(mark)[0] === 'GET /api/cards?part=0', `IndexedDB ${mode} : relecture complète attendue, ` + cardCalls(mark).join(', '));
    }

    // 24. Ancien serveur (ni rev ni cards_rev) : pas de cache ni de ?since ; un nouvel envoi (fetched_at) au retour sur
    // l'onglet relit tout, comme avant.
    if (!SERVER) {
      api.noRev = true;
      mark = apiLog.length;
      const p5 = openPage();
      check(await waitFor(() => p5.count() === n0 - 1) && cardCalls(mark).every((x) => x.includes('?part=')) && cardCalls(mark).length === 3, 'ancien serveur : relecture complète attendue, ' + cardCalls(mark).join(', '));
      const cur2 = (await rawApi('GET', '/api/cards', key)).body.cards;
      await seedCards(key, [...cur2, { ...cur2[0], id: 'ancien-serveur', title: 'Carte de l\'ancien serveur' }]);
      mark = apiLog.length;
      await p5.visible();
      check(await waitFor(() => p5.count() === n0) && cardCalls(mark)[0] === 'GET /api/cards?part=0' && !cardCalls(mark).some((x) => x.includes('since')),
        'ancien serveur : un nouvel envoi doit tout relire, ' + cardCalls(mark).join(', '));
      api.noRev = false;
    }
  }

  // 25 à 27 : plusieurs classeurs dans ce navigateur (pages à part ; localStorage remis comme avant à la fin).
  {
    const savedLs = ['classeur-key', 'classeur-known'].map((k) => [k, ls.get(k)]);
    const mkCards = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: prefix + i, title: prefix.toUpperCase() + ' carte ' + i, rarity: 'C', atk: 1, def: 1, quality: 1,
      pageviews: 10, category: 'x', image: null, url: null, count: 1, shiny: false, starred: false, obtained_at: '2026-10-01T00:00:00Z' }));
    const tabOf = (d) => { const t = d.querySelectorAll('button').find((n) => (n.getAttribute('id') || '').startsWith('tab-') && n.getAttribute('aria-selected') === 'true'); return t ? t.getAttribute('id') : null; };
    const modalBtnIn = (d, t) => { const m = d.querySelectorAll('.modal')[0]; return (m && m.querySelectorAll('button').filter((n) => text(n).trim() === t).pop()) || null; };
    const keyA = await makeOtherAccount('Alice');
    const keyB = await makeOtherAccount('Bob');
    await seedCards(keyA, mkCards('a', 500));
    await seedCards(keyB, mkCards('b', 30));
    await rawApi('POST', '/api/targets/save', keyA, { name: 'Rangement Alice', items: [{ title: 'Zeus', status: 'ok' }] });

    // 25. Changement de classeur pendant le chargement du premier : lien du classeur de Bob ouvert dans un navigateur qui
    // garde celui d'Alice, « Ouvrir » cliqué avant que les cartes d'Alice soient lues. La fin du premier chargement ne
    // touche pas au classeur de Bob : ni l'onglet (« Synchro », celui d'un classeur vide), ni l'état de son compte du jeu,
    // ni les collections (celles d'Alice, arrivées après coup).
    for (const when of ['cartes', 'santé', 'collections']) {
      ls.set('classeur-key', keyA);
      ls.set('classeur-known', JSON.stringify([{ key: keyA, name: 'Alice' }]));
      // Réponses retenues : les cartes ; GET /api/health du second chargement (« santé ») ; les collections d'Alice.
      const gate = { cards: [], health: [], targets: [] };
      const hold = { cards: true, health: false, targets: when === 'collections' };
      const p = openPage({ idb: 'absent', hash: '#cle=' + keyB, hold: (url) => {
        const k = url.startsWith('/api/cards') ? 'cards' : url === '/api/health' ? 'health' : url === '/api/targets' ? 'targets' : null;
        if (!k || !hold[k]) return null;
        if (k === 'targets') hold.targets = false;
        return new Promise((r) => gate[k].push(r));
      } });
      check(await waitFor(() => text(p.doc.body).includes('Ouvrir le classeur de Bob à la place du tien ?') && gate.cards.length === 1),
        `changement pendant le chargement (${when}) : question et lecture des cartes d'Alice attendues`);
      if (when === 'santé') hold.health = true;
      modalBtnIn(p.doc, 'Ouvrir').click();
      if (when === 'santé') {
        check(await waitFor(() => gate.health.length === 1), 'changement pendant le chargement (santé) : second chargement attendu sur GET /api/health');
        gate.cards[0](); // cartes d'Alice, arrivées pendant le second chargement
        await settle(60);
        hold.health = false;
        gate.health[0]();
      }
      check(await waitFor(() => gate.cards.length === 2), `changement pendant le chargement (${when}) : lecture des cartes de Bob attendue`);
      if (when !== 'santé') { gate.cards[0](); await settle(60); }
      hold.cards = false;
      gate.cards[1]();
      check(await waitFor(() => p.count() === 30), `changement pendant le chargement (${when}) : cartes de Bob absentes (${p.count()})`);
      if (when === 'collections') gate.targets[0]();
      await settle(200);
      const h = text(p.doc.querySelector('h1'));
      check(h === 'Le classeur de Bob' && tabOf(p.doc) === 'tab-collections' && p.count() === 30,
        `changement pendant le chargement (${when}) : classeur de Bob sur « Mes collections » attendu, ${h} / ${tabOf(p.doc)} / ${p.count()} cartes`);
      check(!text(p.doc.body).includes('Rangement Alice'), `changement pendant le chargement (${when}) : une collection d'Alice est arrivée dans le classeur de Bob`);
      p.doc.getElementById('tab-maj').click();
      await settle(100);
      check(text(p.doc.body).includes(SERVER ? 'Compte du jeu relié' : 'Aucun compte du jeu relié'), `changement pendant le chargement (${when}) : état du compte du jeu de Bob attendu`);
    }

    // 26. « Supprimer mon classeur » : seul le classeur supprimé est oublié ; les autres classeurs de ce navigateur restent.
    {
      ls.set('classeur-key', keyB);
      ls.set('classeur-known', JSON.stringify([{ key: keyA, name: 'Alice' }, { key: keyB, name: 'Bob' }]));
      const p = openPage({ idb: 'absent' });
      check(await waitFor(() => p.count() === 30), 'suppression : classeur de Bob non ouvert');
      p.doc.getElementById('tab-reglages').click();
      await settle();
      p.doc.querySelectorAll('button').find((n) => text(n).trim() === 'Supprimer mon classeur').click();
      await settle();
      modalBtnIn(p.doc, 'Supprimer mon classeur').click();
      check(await waitFor(() => !ls.has('classeur-key')) && text(p.doc.body).includes("J'ai déjà un lien"), 'suppression : classeur de Bob non supprimé');
      check(ls.get('classeur-known') === JSON.stringify([{ key: keyA, name: 'Alice' }]), 'suppression : classeurs connus ' + ls.get('classeur-known'));
      ls.set('classeur-key', keyA);
      const p2 = openPage({ idb: 'absent' });
      check(await waitFor(() => p2.count() === 500), "suppression : classeur d'Alice non rouvert");
    }

    // 27 bis. Onglet du classeur visible : GET /api/me toutes les 60 s (minuterie déclenchée à la main ici), et les
    // cartes (?since) seulement si cards_rev a bougé — lecture automatique de la collection par le serveur —, avec « Mis à jour depuis
    // wiki-masters.com ». Onglet caché : minuterie arrêtée, rien n'est lu ; de nouveau visible : relu aussitôt, minuterie
    // relancée.
    {
      const keyG = await makeOtherAccount('Gil');
      await seedCards(keyG, mkCards('g', 3));
      ls.set('classeur-key', keyG);
      const p = openPage({ idb: 'absent' });
      check(await waitFor(() => p.count() === 3), 'relecture périodique : classeur de Gil non ouvert');
      await settle(60);
      check(p.longTimers.size === 1, `relecture périodique : une minuterie d'une minute attendue, ${p.longTimers.size}`);
      const reads = (from) => apiKeyLog.slice(from).filter((x) => x.key === keyG && /^GET \/api\/(me|cards)\b/.test(x.call)).map((x) => x.call);
      let from = apiKeyLog.length;
      await p.live();
      await settle(60);
      check(reads(from).join(', ') === 'GET /api/me', 'relecture périodique sans changement : seul GET /api/me attendu, ' + reads(from).join(', '));
      await seedCards(keyG, mkCards('g', 5));
      from = apiKeyLog.length;
      await p.live();
      check(await waitFor(() => p.count() === 5), `relecture périodique : nouvelles cartes absentes (${p.count()})`);
      const got = reads(from);
      check(got.length === 2 && got[0] === 'GET /api/me' && /^GET \/api\/cards\?since=\d+$/.test(got[1]), 'relecture périodique après un envoi : ' + got.join(', '));
      check(text(p.doc.body).includes('Mis à jour depuis wiki-masters.com : 2 nouvelles cartes (5 cartes).'), 'message « Mis à jour depuis wiki-masters.com » absent');
      p.doc.visibilityState = 'hidden';
      await p.visible();
      check(p.longTimers.size === 0, 'onglet caché : la minuterie doit être arrêtée');
      from = apiKeyLog.length;
      await seedCards(keyG, mkCards('g', 6));
      await p.live();
      await settle(60);
      check(reads(from).length === 0, 'onglet caché : aucune lecture attendue, ' + reads(from).join(', '));
      p.doc.visibilityState = 'visible';
      await p.visible();
      check(await waitFor(() => p.count() === 6) && p.longTimers.size === 1, `retour sur l'onglet : ${p.count()} cartes, ${p.longTimers.size} minuterie`);
    }
    for (const [k, v] of savedLs) if (v == null) ls.delete(k); else ls.set(k, v);
  }

  // 28. Entre amis : partage choisi et réciproque ; deux amis (Paul, Léa), Zoé qui ne partage pas ; mise en avant des
  // cases vides que les amis remplissent (doubles d'abord, rapprochement par qid), badge d'une case vide, fiche,
  // classeur d'un ami en lecture seule (« Me manquent »), l'inverse (tes cartes pour leurs collections), désactivation.
  // Sur la page principale (classeur de Cédric).
  {
    const myKey3 = ls.get('classeur-key');
    const fc = (id, title, rarity, count, extra) => ({ id, title, rarity, atk: 10, def: 10, quality: 50, pageviews: 100, category: 'test', image: null,
      url: 'https://fr.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')), count, shiny: false, starred: false, obtained_at: '2026-10-01T10:00:00Z', ...extra });
    const paulKey = await makeOtherAccount('Paul');
    const leaKey = await makeOtherAccount('Léa');
    const zoeKey = await makeOtherAccount('Zoé');
    await seedCards(paulKey, [fc('p-mars', 'Mars (planète)', 'UR', 2), fc('p-jup', 'Jupiter (planète)', 'UR', 1), fc('p-a5', 'Article 5', 'C', 1),
      fc('p-pluton', 'Pluton', 'R', 1, { shiny: true }), fc('p-a1', 'Article 1', 'PC', 3)]);
    await seedCards(leaKey, [fc('l-jup', 'Jupiter (planète)', 'UR', 1), fc('l-sat', 'Saturne (planète)', 'SR', 3), fc('l-nep', 'Neptune', 'SR', 1), fc('l-a7', 'Article 7', 'C', 1)]);
    await seedCards(zoeKey, [fc('z-mars', 'Mars (planète)', 'UR', 5)]);
    for (const k of [paulKey, leaKey]) check((await rawApi('PATCH', '/api/me', k, { shared: true })).status === 200, 'partage des amis refusé');
    check((await rawApi('PATCH', '/api/me', paulKey, { pseudo: 'PaulDu13' })).status === 200, 'pseudo de Paul refusé');
    // Soldes de wikibidous lus à la synchro (« Proposer un échange ») : le tien et celui de Paul ; Léa n'en a pas encore.
    if (!SERVER) for (const [k, n] of [[myKey3, 120], [paulKey, 40]]) api.users.find((u) => u.key === k).wb = n;
    // Partage activé dès la création (2026-10-16, vrai serveur) : coupé ici pour Cédric et Zoé, comme au départ du scénario.
    for (const k of [myKey3, zoeKey]) check((await rawApi('PATCH', '/api/me', k, { shared: false })).status === 200, 'arrêt du partage refusé');
    // Sans partager soi-même : 403 (réciprocité), et l'onglet invite à partager sans rien lire des autres.
    check((await rawApi('GET', '/api/members', myKey3)).status === 403, 'sans partage, GET /api/members doit répondre 403');
    // Partage coupé hors de la page : elle le voit au retour sur l'onglet (GET /api/me).
    for (const f of doc.listeners.visibilitychange || []) await f();
    await settle(100);
    mark = apiLog.length;
    await goTab('amis');
    check(tabBtn('amis') && text(tabBtn('amis')) === 'Entre amis', 'onglet « Entre amis » absent');
    check(has('Montrer mes cartes aux autres membres') && has('Le partage est réciproque') && has('Jamais tes tags'), 'Entre amis : invitation au partage absente');
    check(!apiLog.slice(mark).some((x) => x.includes('/api/members')), 'sans partage, la page ne doit pas lire les membres : ' + apiLog.slice(mark).join(', '));
    needButton('Montrer mes cartes aux autres membres').click();
    const fcol = (name) => cls('fcol').find((n) => text(n.querySelector('.fcol__name')) === name) || null;
    const titlesIn = (n) => n.querySelectorAll('.fitem__title').map(text);
    check(await waitFor(() => has('Paul') && has('Léa') && fcol('Planète du Système solaire'), 5000), 'Entre amis : membres ou mise en avant absents');
    check(fcol('Planète du Système solaire').querySelector('.row-kind') && text(fcol('Planète du Système solaire').querySelector('.row-kind')) === 'depuis la catégorie Wikipédia', 'collection tirée de la catégorie : mention discrète attendue');
    check(apiLog.slice(mark).includes('PATCH /api/me') && !has('Zoé') && !has('Bob'), 'seuls les membres qui partagent doivent apparaître');
    if (!SERVER) {
      // Cartes lues par pages (2 par page dans l'API simulée) : Paul 5 cartes = 3 pages, Léa 4 = 2 pages ; jamais Zoé.
      const reads = apiLog.slice(mark).filter((x) => x.startsWith('GET /api/members/'));
      check(reads.length === 5 && reads.every((x) => /\/cards\?part=/.test(x)), 'cartes des amis : 5 pages attendues, ' + reads.join(', '));
    }
    // Neptune (titre différent, même qid Q332) : reconnu une fois les qids des cartes des amis résolus.
    check(await waitFor(() => fcol('Planète du Système solaire') && titlesIn(fcol('Planète du Système solaire')).includes('Neptune (planète)'), 10000),
      'mise en avant : « Neptune » de Léa doit compter pour « Neptune (planète) » (qid) : ' + text(fcol('Planète du Système solaire')));
    {
      const col = fcol('Planète du Système solaire');
      check(titlesIn(col).join(' | ') === 'Saturne (planète) | Mars (planète) | Jupiter (planète) | Neptune (planète)', 'ordre : doubles d\'abord, ' + titlesIn(col).join(' | '));
      check(text(col).includes('4 cases à remplir chez tes amis') && text(col).includes('2 en double'), 'résumé de la collection : ' + text(col));
      check(cls('fcol')[0] === col, 'la collection où les amis remplissent le plus de cases vient en premier');
      const jup = col.querySelectorAll('.fitem').find((n) => text(n).includes('Jupiter'));
      check(jup.querySelectorAll('.holder').map(text).join(',') === 'Léa,Paul' && text(col.querySelectorAll('.fitem')[0]).includes('Léa ×3'), 'qui a quoi : ' + text(col));
      // Pseudo dans le jeu en info-bulle du prénom (Paul en a donné un, pas Léa).
      check(jup.querySelectorAll('.holder').map((n) => n.getAttribute('title') || '').join(',') === ',Pseudo dans le jeu : PaulDu13',
        'info-bulle du pseudo de Paul : ' + jup.querySelectorAll('.holder').map((n) => n.getAttribute('title')).join(','));
      check(fcol('Exemples de test') && titlesIn(fcol('Exemples de test')).join() === 'Article 5', 'Exemples de test : Article 5 (chez Paul) attendu');
    }
    // Membres : nombre de cartes et cartes qui me manquent.
    const paulRow = cls('member').find((n) => text(n).includes('Paul'));
    check(paulRow && text(paulRow).includes('5 cartes') && text(paulRow).includes('4 cartes que tu n\'as pas') && text(paulRow).includes('1 en double'), 'ligne de Paul : ' + text(paulRow));
    // Pseudo dans le jeu : celui de Paul avec un lien vers son profil du jeu ; Léa n'en a pas donné.
    {
      const a = paulRow.querySelectorAll('a').find((n) => text(n).includes('profil dans le jeu'));
      check(text(paulRow).includes('pseudo dans le jeu : PaulDu13') && a && a.getAttribute('href') === 'https://www.wiki-masters.com/profile/PaulDu13',
        'pseudo de Paul : ' + text(paulRow));
      const leaRow = cls('member').find((n) => text(n).includes('Léa'));
      check(leaRow && !text(leaRow).includes('pseudo dans le jeu'), 'Léa : pas de pseudo attendu');
    }
    // L'inverse : personne ne partage encore ses collections, donc rien à leur proposer (plus d'estimation par le catalogue).
    check(await waitFor(() => has('Aucun de tes amis ne partage ses collections : impossible de savoir ce qui leur manque.')) && !fcol('Paul') && !fcol('Léa')
      && !cls('badge').some((b) => text(b) === 'estimation'), 'tes cartes pour tes amis : rien sans leurs collections, ' + text(doc.body).slice(-400));
    // Rien des amis dans IndexedDB (le cache ne garde que mon classeur).
    await sleep(1600);
    check(!JSON.stringify(cachedCards()).includes('p-mars') && !JSON.stringify(cachedCards()).includes('Pluton'), 'les cartes des amis ne doivent pas aller dans IndexedDB');

    // Album : badge discret sur les cases vides qu'un ami peut remplir ; fiche de la case vide : « Chez : … ».
    fcol('Planète du Système solaire').querySelector('.fcol__name').click();
    await settle(80);
    check(has("Il t'en manque") && tabBtn('collections').getAttribute('aria-selected') === 'true', 'le nom de la collection doit ouvrir son album');
    const slotOf = (t) => cls('slot').find((n) => text(n.querySelector('h3')) === t);
    const badge = (t) => { const s = slotOf(t); const b = s && s.querySelector('.slot__friends'); return b ? text(b) : null; };
    check(badge('Mars (planète)') === 'chez Paul ×2' && badge('Saturne (planète)') === 'chez Léa ×3' && badge('Jupiter (planète)') === 'chez Léa +1'
      && badge('Neptune (planète)') === 'chez Léa' && badge('Mercure (planète)') === null,
      'badges des cases vides : ' + ['Mars', 'Saturne', 'Jupiter', 'Neptune', 'Mercure'].map((p) => p + '=' + badge(p + ' (planète)')).join(', '));
    check(slotOf('Mars (planète)').querySelector('.slot__friends').classList.contains('dup'), 'un double doit ressortir');
    slotOf('Jupiter (planète)').querySelector('.slot__open').click();
    await settle();
    check(one('fiche--missing') && text(one('fiche--missing')).includes('Chez : Léa, Paul'), 'fiche de la case vide : « Chez : Léa, Paul » attendu : ' + text(one('fiche--missing')));
    one('fiche--missing').querySelector('.close').click();
    await settle();
    slotOf('Mars (planète)').querySelector('.slot__open').click();
    await settle();
    check(text(one('fiche--missing')).includes('Chez : Paul (×2)'), 'fiche : « Chez : Paul (×2) » attendu');
    one('fiche--missing').querySelector('.close').click();
    await settle();

    // Classeur de Paul en lecture seule : toutes ses cartes, puis « Me manquent », recherche.
    mark = apiLog.length;
    await goTab('amis');
    if (!SERVER) check(apiLog.slice(mark).filter((x) => x.startsWith('GET /api/members/')).length === 0, 'cartes des amis relues sans changement : ' + apiLog.slice(mark).join(', '));
    all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Parcourir le classeur de Paul')[0].click();
    await settle();
    check(has('Le classeur de Paul') && has('lecture seule') && cls('card--friend').length === 5, 'classeur de Paul : 5 cartes attendues, ' + cls('card--friend').length);
    check(cls('card--friend').filter((n) => n.classList.contains('have')).map((n) => text(n.querySelector('.card__title'))).join() === 'Article 1', 'seule « Article 1 » est déjà à moi');
    check(!cls('card--friend').some((n) => n.getAttribute('role') === 'button' || n.parentNode.querySelector('input')), 'cartes d\'un ami : ni fiche ni sélection');
    exactButton('Me manquent').click();
    await settle();
    check(cls('card--friend').length === 4 && !cls('card--friend').some((n) => n.classList.contains('have')), '« Me manquent » : 4 cartes attendues');
    type(byId('fq'), 'pluton');
    await settle();
    check(cls('card--friend').length === 1 && cls('card--friend')[0].classList.contains('shiny'), 'recherche dans le classeur d\'un ami');
    needButton('← Entre amis').click();
    await settle();
    check(has('Pour compléter tes collections'), 'retour à la vue d\'ensemble');

    // 29. Échanges possibles : Paul montre aussi ses collections (deux), Léa non (estimation d'après le catalogue), Zoé
    // ne montre rien. Une ligne « carte de X → collection(s) de Z » par carte, groupées par couple ; vraies collections
    // avant les estimations, puis doubles, puis nombre de cases ; filtres « Ce qui me concerne » (défaut), « Tout le
    // monde », par membre ; « Ce qui pourrait intéresser tes amis » sur les vraies collections de Paul ; second réglage.
    {
      // Paul : « Article 1 », « Mars » et « Pluton » sont à lui ; « Neptune (planète) » (qid Q332) = « Neptune » de Léa ;
      // « Article 7 » est dans ses deux collections ; des éléments que personne n'a, ou introuvables.
      for (const t of [
        { name: 'Les préférées de Paul', items: [
          { title: 'Terre', description: 'planète', image: null, status: 'ok', qid: 'Q2' }, { title: 'Rihanna', description: null, image: null, status: 'ok' },
          { title: 'Article 60', description: null, image: null, status: 'ok' }, { title: 'Saturne (planète)', description: null, image: null, status: 'ok' },
          { title: 'Neptune (planète)', description: null, image: null, status: 'ok', qid: 'Q332' }, { title: 'Article 7', description: null, image: null, status: 'ok' },
          { title: 'Livre introuvable', description: null, image: null, status: 'ok' }, { title: 'Article 1', description: null, image: null, status: 'ok' },
          { title: 'Mars (planète)', description: null, image: null, status: 'ok' }, { title: 'Article 40', description: null, image: null, status: 'missing' },
        ] },
        { name: 'Exemples de Paul', items: [{ title: 'Article 7', description: null, image: null, status: 'ok' }, { title: 'Pluton', description: null, image: null, status: 'ok' }] },
      ]) check((await rawApi('POST', '/api/targets/save', paulKey, t)).status === 200, 'collection de Paul refusée');
      const pubOf = async (name, key) => ((await rawApi('GET', '/api/members', key)).body.members.find((m) => m.name === name) || {}).id;
      const paulPub = await pubOf('Paul', myKey3);
      check((await rawApi('GET', '/api/members/' + paulPub + '/targets', myKey3)).status === 404, 'collections de Paul visibles sans son accord');
      check((await rawApi('PATCH', '/api/me', paulKey, { shared_targets: 'oui' })).status === 400, 'shared_targets non booléen accepté');
      check((await rawApi('PATCH', '/api/me', zoeKey, { shared_targets: true })).status === 400, 'Zoé ne montre pas ses cartes : ses collections non plus (400)');
      check((await rawApi('PATCH', '/api/me', paulKey, { shared_targets: true })).body.shared_targets === true, 'Paul : partage des collections refusé');
      check((await rawApi('GET', '/api/members/' + paulPub + '/targets', zoeKey)).status === 403, 'Zoé ne montre pas ses cartes : 403 attendu');
      {
        const r = await rawApi('GET', '/api/members/' + paulPub + '/targets', myKey3);
        const s = JSON.stringify(r.body);
        check(r.status === 200 && s.includes('Les préférées de Paul') && !s.includes('"description"') && !s.includes('Article 40') && !s.includes('"status"'),
          'collections de Paul vues par l\'API : ' + s.slice(0, 300));
      }
      mark = apiLog.length;
      needButton('Actualiser').click();
      const row = (name) => cls('member').find((n) => text(n.querySelector('.name')) === name);
      check(await waitFor(() => row('Paul') && text(row('Paul')).includes('partage ses collections : 2'), 5000), 'ligne de Paul : ' + text(row('Paul')));
      check(text(row('Léa')).includes('ne partage pas ses collections'), 'ligne de Léa : ' + text(row('Léa')));
      const tsum = () => (one('trade-sum') ? text(one('trade-sum')) : '');
      // Les amis et tes collections les plus concernés, nommés (2026-10-16).
      check(await waitFor(() => tsum().includes('4 de tes cartes peuvent compléter les collections de Paul ; 6 de leurs cartes peuvent compléter « Planète du Système solaire » et « Exemples de test ». Entre eux : 3.'), 8000),
        'résumé des échanges : ' + tsum());
      if (!SERVER) {
        const reads = apiLog.slice(mark).filter((x) => x.startsWith('GET /api/members/'));
        check(reads.length === 2 && reads.every((x) => x.startsWith('GET /api/members/' + paulPub + '/targets?part=')), 'collections lues : celles de Paul seulement, 2 pages : ' + reads.join(', '));
      }
      check(has('Léa ne partage pas ses collections') && has('Tes amis ne voient pas tes collections'), 'notes des échanges absentes');
      // « Ce qui pourrait intéresser tes amis » : les collections que Paul montre ; rien pour Léa, qui ne les montre pas.
      check(fcol('Paul') && titlesIn(fcol('Paul')).join(' | ') === 'Article 7 | Rihanna | Terre | Article 60' && !fcol('Paul').querySelector('.badge'),
        'tes cartes pour Paul (ses collections) : ' + (fcol('Paul') ? text(fcol('Paul')) : 'absent'));
      // Le résumé nomme ses collections concernées, les plus complétées d'abord (« Les préférées de Paul » : 4 cartes).
      check(text(fcol('Paul').querySelector('.fcol__sum')) === '4 de tes cartes complètent « Les préférées de Paul » et « Exemples de Paul » · 3 que tu as en double',
        'résumé de tes cartes pour Paul : ' + text(fcol('Paul').querySelector('.fcol__sum')));
      check(!fcol('Léa') && has('Rien pour Léa, qui ne partage pas ses collections.'), 'tes cartes pour Léa : rien attendu (elle ne partage pas ses collections)');
      // La page : « Tout le monde » par défaut (demande de l'utilisateur, 2026-10-16), puis « Ce qui me concerne ».
      needButton('Voir les échanges possibles').click();
      await settle();
      // Un bloc par paire de membres (« Toi ⇄ Paul »), les deux sens dedans (« Toi → Paul », puis « Paul → Toi »).
      const dirOf = (n) => text(n.querySelector('.trade__dir')).replace(' pour ', '');
      const pairs = () => cls('trade__side').map(dirOf);
      const pair = (name) => cls('trade__side').find((n) => dirOf(n) === name) || null;
      const duos = () => cls('trade').map((n) => text(n.querySelector('.fcol__name')).replace(' et ', ''));
      const duoOf = (name) => cls('trade').find((n) => n.querySelectorAll('.trade__dir').some((x) => text(x).replace(' pour ', '') === name)) || null;
      const pressed = () => one('seg') ? one('seg').querySelectorAll('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map(text).join() : '';
      check(has('Échanges possibles') && pressed() === 'Tout le monde', 'page des échanges : filtre par défaut ' + pressed());
      // « Seulement les cartes en double », cochée par défaut : chaque ligne montrée est un double (×n) de celui qui donne.
      check(byId('trade-dup') && byId('trade-dup').checked === true, 'case « Seulement les cartes en double » absente ou décochée par défaut');
      {
        const shown = cls('trade');
        const rowsOf = (n) => n.querySelectorAll('.fitem__title').length;
        check(shown.length > 0 && shown.every((n) => rowsOf(n) > 0 && n.querySelectorAll('.holder.dup').length === rowsOf(n)),
          'doubles seulement : ' + shown.map((n) => text(n.querySelector('.fcol__name')) + ' ' + rowsOf(n) + '/' + n.querySelectorAll('.holder.dup').length).join(' ; '));
      }
      byId('trade-dup').dispatch('change');
      await settle();
      check(pairs().join(' | ') === 'Toi → Paul | Paul → Toi | Léa → Toi | Léa → Paul', 'couples (tout le monde, tous les exemplaires) : ' + pairs().join(' | '));
      check(duos().join(' | ') === 'Toi ⇄ Paul | Toi ⇄ Léa | Léa ⇄ Paul', 'un bloc par paire : ' + duos().join(' | '));
      exactButton('Ce qui me concerne').click();
      await settle();
      check(pressed() === 'Ce qui me concerne' && pairs().join(' | ') === 'Toi → Paul | Paul → Toi | Léa → Toi', 'couples (ce qui me concerne) : ' + pairs().join(' | '));
      {
        const p = pair('Toi → Paul');
        check(titlesIn(p).join(' | ') === 'Article 7 | Rihanna | Terre | Article 60', 'Toi → Paul : ' + titlesIn(p).join(' | '));
        check(text(p).includes('Tu peux compléter 4 cases chez Paul, dont 3 en double'), 'résumé Toi → Paul : ' + text(p.querySelector('.fcol__sum')));
        const a7 = p.querySelectorAll('.fitem')[0];
        check(text(a7).includes('×2') && text(a7).includes('Les préférées de Paul') && text(a7).includes('Exemples de Paul'), 'Article 7 : ses deux collections attendues : ' + text(a7));
        check(!text(p.querySelectorAll('.fitem')[3]).includes('×'), 'Article 60 : un seul exemplaire, pas de ×');
        check(titlesIn(pair('Léa → Toi')).join(' | ') === 'Saturne (planète) | Jupiter (planète) | Neptune' && text(pair('Léa → Toi')).includes('Léa peut compléter 3 cases chez toi, dont 1 en double'),
          'Léa → Toi : ' + text(pair('Léa → Toi')));
        check(titlesIn(pair('Paul → Toi')).join(' | ') === 'Mars (planète) | Jupiter (planète) | Article 5', 'Paul → Toi : ' + text(pair('Paul → Toi')));
        // Plus de « (catégorie) » : une collection faite d'une catégorie est une collection comme les autres.
        check(text(pair('Paul → Toi').querySelectorAll('.fitem')[0]).includes('Planète du Système solaire') && !text(pair('Paul → Toi')).includes('(catégorie)') && !text(a7).includes('(catégorie)'),
          'nature des collections dans les échanges : ' + text(pair('Paul → Toi').querySelectorAll('.fitem')[0]));
        check(!pair('Toi → Léa') && !cls('trade').some((n) => n.querySelector('.badge')), "plus d'estimation pour Léa, qui ne partage pas ses collections");
        // Ta carte : sa fiche ; une case vide chez toi : la fiche de la carte manquante. Une ligne pour un ami : deux boutons
        // côte à côte (ta carte, et chaque collection de l'ami, qui ouvre son album), jamais l'un dans l'autre.
        check(a7.tagName === 'DIV' && a7.querySelector('.fitem__main') && a7.querySelectorAll('.fitem__col').map(text).sort().join(' | ') === 'Exemples de Paul | Les préférées de Paul'
          && !a7.querySelector('.fitem__main').querySelector('button'), 'Article 7 : la carte et les collections de Paul, en boutons distincts : ' + text(a7));
        a7.querySelector('.fitem__main').click();
        await settle();
        check(fiche() && text(fiche()).includes('Article 7') && !one('fiche--missing'), 'clic sur ta carte : sa fiche attendue');
        fiche().querySelector('.close').click();
        await settle();
        pair('Paul → Toi').querySelectorAll('.fitem')[0].click();
        await settle();
        check(one('fiche--missing') && text(one('fiche--missing')).includes('Mars (planète)'), 'clic sur une carte de Paul pour toi : fiche de la case vide attendue');
        one('fiche--missing').querySelector('.close').click();
        await settle();
      }
      // « Proposer un échange » : un bouton par bloc toi ↔ ami ; la fenêtre reprend les deux couples avec cet ami (toutes
      // les cartes, doubles cochés d'avance), puis l'échange part au serveur (POST /api/trades/create).
      if (!SERVER) {
        const btnIn = (pr, t) => (pr ? pr.querySelectorAll('button').find((b) => text(b) === t) : null) || null;
        check(btnIn(duoOf('Toi → Paul'), 'Proposer un échange à Paul') && duoOf('Toi → Paul') === duoOf('Paul → Toi') && btnIn(duoOf('Léa → Toi'), 'Proposer un échange à Léa')
          && cls('trade__new').length === 2, '« Proposer un échange » : un bouton par bloc toi ⇄ ami attendu : ' + cls('trade__new').map(text).join(' | '));
        const md = () => one('modal');
        const side = (i) => (md() ? md().querySelectorAll('.trade-pick')[i] : null);
        const titlesOf = (i, on) => side(i).querySelectorAll('li').filter((li) => !on || li.querySelector('input').checked).map((li) => text(li.querySelector('.trade-pick__title')));
        const send = () => md().querySelectorAll('button').find((b) => text(b) === "Proposer l'échange dans le jeu");
        const mdBtn = (t) => (md() ? md().querySelectorAll('button').find((b) => text(b) === t) : null) || null;
        // Pas amis dans le jeu : la fenêtre le dit à la place des cartes. Sans route d'envoi connue : marche à suivre et liens
        // vers le jeu ; avec : « Envoyer une demande d'ami », puis « demande partie » ; demande reçue : l'accepter dans le jeu.
        api.gameFriends['Léa'] = 'none';
        btnIn(duoOf('Léa → Toi'), 'Proposer un échange à Léa').click();
        await settle(80);
        check(md() && text(md()).includes("Léa n'est pas ton ami dans le jeu.") && !side(0) && !mdBtn("Envoyer une demande d'ami à Léa")
          && md().querySelectorAll('a').some((x) => x.getAttribute('href') === 'https://www.wiki-masters.com/friends'), 'pas amis, sans route d\'envoi : ' + (md() ? text(md()) : ''));
        md().querySelectorAll('button').find((b) => text(b) === 'Fermer').click();
        await settle();
        api.canRequest(true);
        btnIn(duoOf('Léa → Toi'), 'Proposer un échange à Léa').click();
        await settle(80);
        check(mdBtn("Envoyer une demande d'ami à Léa"), "bouton « Envoyer une demande d'ami à Léa » absent : " + (md() ? text(md()) : ''));
        mdBtn("Envoyer une demande d'ami à Léa").click();
        await settle(80);
        check(api.friendRequests.join() === 'Léa' && text(md()).includes("Ta demande d'ami est partie") && mdBtn('Vérifier à nouveau') && !side(0), 'demande d\'ami envoyée : ' + text(md()));
        api.gameFriends['Léa'] = 'friends';
        mdBtn('Vérifier à nouveau').click();
        await settle(80);
        check(side(0) && text(md()).includes('Proposer un échange à Léa'), 'amis dans le jeu : formulaire d\'échange attendu après « Vérifier à nouveau »');
        md().querySelectorAll('button').find((b) => text(b) === 'Annuler').click();
        await settle();
        api.gameFriends['Paul'] = 'received';
        btnIn(duoOf('Toi → Paul'), 'Proposer un échange à Paul').click();
        await settle(80);
        check(md() && text(md()).includes("Paul t'a envoyé une demande d'ami") && !side(0), 'demande reçue de Paul : ' + (md() ? text(md()) : ''));
        md().querySelectorAll('button').find((b) => text(b) === 'Fermer').click();
        await settle();
        delete api.gameFriends['Paul'];
        api.canRequest(false);
        btnIn(duoOf('Toi → Paul'), 'Proposer un échange à Paul').click();
        await settle();
        check(md() && text(md()).includes('Proposer un échange à Paul'), 'fenêtre « Proposer un échange » absente');
        check(titlesOf(0).join(' | ') === 'Article 7 | Rihanna | Terre | Article 60' && titlesOf(1).join(' | ') === 'Mars (planète) | Jupiter (planète) | Article 5',
          'cartes de la fenêtre : ' + titlesOf(0).join(' | ') + ' / ' + titlesOf(1).join(' | '));
        check(titlesOf(0, true).join(' | ') === 'Article 7 | Rihanna | Terre' && titlesOf(1, true).join(' | ') === 'Mars (planète)',
          'doubles cochés d\'avance : ' + titlesOf(0, true).join(' | ') + ' / ' + titlesOf(1, true).join(' | '));
        check(text(md()).includes('Tu donnes 3 cartes, tu reçois 1 carte.'), 'résumé de la fenêtre : ' + text(md()).slice(-300));
        // Décocher Rihanna, cocher Article 5.
        side(0).querySelectorAll('li')[1].querySelector('input').dispatch('change');
        side(1).querySelectorAll('li')[2].querySelector('input').dispatch('change');
        await settle();
        check(text(md()).includes('Tu donnes 2 cartes, tu reçois 2 cartes.'), 'résumé après changement : ' + text(md()).slice(-300));
        side(0).querySelectorAll('button').find((b) => text(b) === 'Rien').click();
        side(1).querySelectorAll('button').find((b) => text(b) === 'Rien').click();
        await settle();
        check(text(md()).includes('Aucune carte cochée, aucun wikibidou.') && send().disabled, 'rien de coché : envoi désactivé attendu');
        // Wikibidous : soldes lus à la synchro (le tien, celui de Paul), montant invalide refusé, des wikibidous seuls suffisent.
        check(text(side(0)).includes('Ton solde : 120W') && text(side(1)).includes('Solde de Paul : 40W'), 'soldes de wikibidous : ' + text(side(0)).slice(-120) + ' / ' + text(side(1)).slice(-120));
        type(byId('trade-getWb'), '1.5');
        await settle();
        check(send().disabled && text(md()).includes('nombre entier'), 'montant invalide : envoi désactivé attendu');
        type(byId('trade-getWb'), '50');
        await settle();
        check(!send().disabled && text(md()).includes('Tu donnes 0 carte, tu reçois 0 carte et 40W.') && byId('trade-getWb').value === '40'
          && byId('trade-getWb').getAttribute('max') === '40', 'wikibidous seuls, plafonnés au solde de Paul (40W) : ' + text(md()).slice(-300));
        type(byId('trade-giveWb'), '500');
        await settle();
        check(byId('trade-giveWb').value === '120' && text(md()).includes('et 120W'), 'plafond de ton solde (120W) : ' + text(md()).slice(-300));
        type(byId('trade-getWb'), '');
        type(byId('trade-giveWb'), '5');
        await settle();
        side(1).querySelectorAll('button').find((b) => text(b) === 'Les doubles').click();
        side(0).querySelectorAll('li')[0].querySelector('input').dispatch('change');
        await settle();
        check(text(md()).includes('Tu donnes 1 carte et 5W, tu reçois 1 carte.'), 'résumé (Article 7 et 5W contre Mars) : ' + text(md()).slice(-300));
        // Refus du jeu : message dans la fenêtre, rien de créé ; puis l'envoi réussi.
        api.failTrade({ status: 409, error: "Le jeu a refusé l'échange : « Carte déjà engagée »." });
        send().click();
        await settle(80);
        check(api.trades.length === 0 && md() && text(md()).includes('Carte déjà engagée'), 'refus du jeu non affiché : ' + text(md()).slice(-300));
        send().click();
        await settle(80);
        const tr = api.trades[0];
        check(api.trades.length === 1 && tr.to === 'Paul' && tr.give.length === 1 && tr.get.join() === 'p-mars' && tr.give_wb === 5 && tr.get_wb === 0, 'échange envoyé : ' + JSON.stringify(api.trades));
        check(md() && text(md()).includes('Échange proposé à Paul dans le jeu.') && text(md()).includes('Tu reçois « Mars (planète) »') && text(md()).includes('5W')
          && md().querySelectorAll('a').some((x) => x.getAttribute('href') === 'https://www.wiki-masters.com/trades'), 'fin de l\'échange : ' + text(md()));
        md().querySelectorAll('button').find((b) => text(b) === 'Fermer').click();
        await settle();
        check(!md(), 'fenêtre fermée attendue');
        // Réglages, « Amis dans le jeu » : cocher la case ouvre « Ajouter les membres pas encore amis » (Paul, pas encore ami :
        // coché d'avance ; Léa, déjà amie), qui envoie les demandes d'un coup ; puis retour à « Échanges possibles ».
        api.gameFriends['Paul'] = 'none';
        api.canRequest(true);
        await goTab('reglages');
        check(byId('set-auto-friend') && !byId('set-auto-friend').checked, "case « Envoyer une demande d'ami aux membres du classeur » absente ou cochée");
        byId('set-auto-friend').checked = true;
        byId('set-auto-friend').dispatch('change');
        await settle(80);
        check(md() && text(md()).includes('Ajouter les membres pas encore amis') && text(md()).includes("C'est coché") && text(md()).includes('Déjà tes amis : Léa')
          && mdBtn("Envoyer 1 demande d'ami"), 'fenêtre « Ajouter les membres pas encore amis » : ' + (md() ? text(md()) : ''));
        mdBtn("Envoyer 1 demande d'ami").click();
        await settle(80);
        check(api.friendRequests.join() === 'Léa,Paul' && text(md()).includes('En attente : Paul (demande envoyée)') && byId('set-auto-friend').checked, 'demandes groupées : ' + text(md()));
        md().querySelectorAll('button').find((b) => text(b) === 'Fermer').click();
        await settle();
        delete api.gameFriends['Paul'];
        api.canRequest(false);
        // Réglages, « Liste de souhaits du jeu » : la case (PATCH auto_wish), puis « Mettre à jour maintenant ».
        check(byId('set-auto-wish') && !byId('set-auto-wish').checked, 'case « Liste de souhaits du jeu » absente ou cochée');
        const wishPanel = () => doc.querySelectorAll('section').find((x) => text(x).startsWith('Liste de souhaits du jeu'));
        check(wishPanel().querySelectorAll('button').some((b) => text(b) === 'Retirer mes collections de ma liste de souhaits')
          && !wishPanel().querySelectorAll('button').some((b) => text(b) === 'Mettre à jour maintenant'), 'case décochée : bouton de retrait attendu : ' + text(wishPanel()));
        byId('set-auto-wish').checked = true;
        byId('set-auto-wish').dispatch('change');
        await settle(80);
        check(byId('set-auto-wish').checked && text(wishPanel()).includes('Première mise à jour en cours'), 'case cochée : ' + text(wishPanel()));
        wishPanel().querySelectorAll('button').find((b) => text(b) === 'Mettre à jour maintenant').click();
        await settle(80);
        check(text(wishPanel()).includes('2 cartes ajoutées, 1 retirée.') && text(wishPanel()).includes('345 cartes dans ta liste de souhaits du jeu')
          && text(wishPanel()).includes('3 titres de tes collections sans carte dans le jeu'), 'liste de souhaits mise à jour : ' + text(wishPanel()));
        await goTab('amis');
        check(pairs().length > 0, "retour à « Échanges possibles » attendu");
      }
      exactButton('Tout le monde').click();
      await settle();
      check(pairs().join(' | ') === 'Toi → Paul | Paul → Toi | Léa → Toi | Léa → Paul', 'couples (tout le monde) : ' + pairs().join(' | '));
      {
        const p = pair('Léa → Paul');
        check(titlesIn(p).join(' | ') === 'Saturne (planète) | Article 7 | Neptune' && text(p).includes('Léa peut compléter 3 cases chez Paul, dont 1 en double'), 'Léa → Paul : ' + text(p));
        check(!p.querySelectorAll('.fitem').some((n) => n.tagName === 'BUTTON'), 'entre deux amis : rien à ouvrir');
      }
      const sel = byId('trade-member');
      sel.value = paulPub;
      sel.dispatch('change');
      await settle();
      check(pairs().join(' | ') === 'Toi → Paul | Paul → Toi | Léa → Paul' && pressed() === '', 'couples (Paul) : ' + pairs().join(' | ') + ' / ' + pressed());
      // « Un membre… » : retour au filtre par défaut, « Tout le monde ».
      sel.value = '';
      sel.dispatch('change');
      await settle();
      check(pressed() === 'Tout le monde' && pairs().length === 4, '« Un membre… » : « Tout le monde » attendu, ' + pressed());
      exactButton('Ce qui me concerne').click();
      await settle();
      check(pairs().length === 3 && byId('trade-member').value === '', 'retour à « Ce qui me concerne »');
      // Rien des amis dans IndexedDB ; rien de relu en revenant sur l'onglet quand rien n'a changé.
      await sleep(1600);
      check(!JSON.stringify(cachedCards()).includes('Les préférées de Paul'), 'les collections des amis ne doivent pas aller dans IndexedDB');
      needButton('← Entre amis').click();
      await settle();
      mark = apiLog.length;
      await goTab('collections');
      await goTab('amis');
      if (!SERVER) check(apiLog.slice(mark).filter((x) => x.startsWith('GET /api/members/')).length === 0, 'collections de Paul relues sans changement : ' + apiLog.slice(mark).join(', '));
      // Second réglage, seulement quand on montre ses cartes : Paul voit alors mes collections (titres et qids seulement).
      await goTab('reglages');
      const cbt = byId('set-shared-targets');
      check(cbt && !cbt.checked && has('et mes collections à compléter'), 'second réglage absent ou coché');
      cbt.checked = true;
      cbt.dispatch('change');
      await settle(80);
      check(byId('set-shared-targets').checked && has('Tes collections à compléter sont montrées'), 'partage des collections sans effet');
      {
        const mine = (await rawApi('GET', '/api/members', paulKey)).body.members.find((m) => m.name === 'Cédric');
        check(mine && mine.targets && mine.targets.count === 6, 'Paul doit voir que je montre mes 6 collections : ' + JSON.stringify(mine));
        const r = await rawApi('GET', '/api/members/' + mine.id + '/targets', paulKey);
        const all2 = [];
        let part = '0';
        for (let g = 0; g < 10; g++) {
          const x = await rawApi('GET', '/api/members/' + mine.id + '/targets?part=' + encodeURIComponent(part), paulKey);
          all2.push(...x.body.targets);
          if (!x.body.next_part) break;
          part = x.body.next_part;
        }
        check(r.status === 200 && all2.some((t) => t.name === 'Planète du Système solaire' && t.kind === 'category') && all2.some((t) => t.name === 'Maladies' && t.kind === 'collection')
          && !JSON.stringify(all2).includes('"description"') && !JSON.stringify(all2).includes('wp:'), 'mes collections vues par Paul : ' + JSON.stringify(all2).slice(0, 300));
      }
      await goTab('amis');
      check(!has('Tes amis ne voient pas tes collections'), 'la note « Tes amis ne voient pas tes collections » doit disparaître');

      // 30. Les collections des amis : « Ses collections » dans le classeur de Paul (une liste, celles tirées d'une catégorie
      // de Wikipédia signalées ; progression avec SES cartes), album d'une de ses collections en lecture seule (« tu l'as »,
      // « ×2 en double », ses cartes qui manquent à mes collections, filtres, fiche sans action, « Copier le nom », retours),
      // ouvert aussi depuis « Échanges possibles » et « Ce qui pourrait intéresser tes amis », « Créer la même collection
      // chez moi » ; Léa, qui ne partage pas ses collections ; rien dans IndexedDB ; vues demandées à Wikipédia seulement
      // pour les cases que ni Paul ni moi n'avons.
      {
        // Paul a aussi deux collections tirées de catégories : « Planète du Système solaire » (j'en ai une aussi) et
        // « Élément chimique » (pas moi).
        const its = (list) => list.map((title) => ({ title, description: null, image: null, status: 'ok' }));
        for (const t of [
          { name: 'Planète du Système solaire', source: 'wp:Planète du Système solaire', items: its(['Mars (planète)', 'Jupiter (planète)', 'Terre', 'Saturne (planète)']) },
          { name: 'Élément chimique', source: 'wp:Élément chimique', items: its(['Hydrogène', 'Hélium', 'Lithium']) },
        ]) check((await rawApi('POST', '/api/targets/save', paulKey, t)).status === 200, 'catégorie de Paul refusée');
        needButton('Actualiser').click();
        check(await waitFor(() => row('Paul') && text(row('Paul')).includes('partage ses collections : 4'), 5000), 'ligne de Paul (4 collections) : ' + text(row('Paul')));
        // Échanges : une carte qui casserait une collection de celui qui donne n'est plus proposée (2026-10-26). Jupiter, que
        // Paul n'a qu'en un exemplaire, est maintenant dans sa « Planète du Système solaire » : il ne la donne plus ; Mars,
        // dans la même collection mais en double, reste.
        needButton('Voir les échanges possibles').click();
        await settle();
        check(titlesIn(pair('Paul → Toi')).join(' | ') === 'Mars (planète) | Article 5', 'Paul → Toi (Jupiter gardée pour sa collection) : ' + text(pair('Paul → Toi')));
        const tradeBtn = (pr, t) => (pr ? pr.querySelectorAll('button').find((b) => text(b) === t) : null) || null;
        const tmd = () => one('modal');
        tradeBtn(duoOf('Toi → Paul'), 'Proposer un échange à Paul').click();
        await settle(80);
        const pick = tmd() ? tmd().querySelectorAll('.trade-pick')[1] : null;
        check(pick && pick.querySelectorAll('.trade-pick__title').map(text).join(' | ') === 'Mars (planète) | Article 5', 'fenêtre : Jupiter de Paul ne doit plus être proposée : ' + (pick ? text(pick) : 'absente'));
        tmd().querySelectorAll('button').find((b) => text(b) === 'Annuler').click();
        await settle();
        needButton('← Entre amis').click();
        await settle();
        const openBinder = async (name) => { all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Parcourir le classeur de ' + name)[0].click(); await settle(); };
        const sect = (id) => all((n) => n.tagName === 'SECTION' && n.getAttribute('aria-labelledby') === id)[0] || null;
        const colRow = (name) => cls('row').find((n) => n.querySelector('.name') && text(n.querySelector('.name')) === name) || null;
        const cr = (name) => text(colRow(name));
        const rowNamesIn = (n) => (n ? n.querySelectorAll('.row').map((r) => text(r.querySelector('.name'))) : []);
        const KIND = 'depuis la catégorie Wikipédia';
        await openBinder('Paul');
        check(sect('h-fcols') && text(sect('h-fcols')).includes('Ses collections') && sect('h-fcards') && !has('Ses catégories'),
          '« Ses collections » absente du classeur de Paul : ' + text(doc.body).slice(-800));
        {
          // Une seule liste, de A à Z ; celles tirées d'une catégorie le disent ; progression avec SES cartes ; ce que je
          // peux lui donner.
          check(rowNamesIn(sect('h-fcols')).join(' | ') === 'Élément chimique | Exemples de Paul | Les préférées de Paul | Planète du Système solaire',
            'ses collections : ' + rowNamesIn(sect('h-fcols')).join(' | '));
          check(sect('h-fcols').querySelectorAll('.row').filter((r) => r.querySelector('.row-kind') && text(r.querySelector('.row-kind')) === KIND).map((r) => text(r.querySelector('.name'))).join(' | ')
            === 'Élément chimique | Planète du Système solaire', 'collections tirées d\'une catégorie : signalées');
          check(cr('Les préférées de Paul').includes('2 sur 9') && cr('Les préférées de Paul').includes('22 %') && cr('Les préférées de Paul').includes("Tu peux l'aider : 4, dont 3 en double")
            && colRow('Les préférées de Paul').querySelectorAll('.mini').length === 2, 'progression des préférées de Paul : ' + cr('Les préférées de Paul'));
          check(cr('Exemples de Paul').includes('1 sur 2') && cr('Exemples de Paul').includes('50 %') && cr('Exemples de Paul').includes("Tu peux l'aider : 1, dont 1 en double"), 'Exemples de Paul : ' + cr('Exemples de Paul'));
          check(cr('Planète du Système solaire').includes('2 sur 4') && cr('Planète du Système solaire').includes("Tu peux l'aider : 1, dont 1 en double"), 'catégorie de Paul : ' + cr('Planète du Système solaire'));
          // Hydrogène : ma carte « Hydrogène (élément) » (même qid).
          check(await waitFor(() => cr('Élément chimique').includes('0 sur 3') && cr('Élément chimique').includes("Tu peux l'aider : 1"), 8000) && colRow('Élément chimique').classList.contains('zero'),
            'Élément chimique (Paul) : ' + cr('Élément chimique'));
        }
        // Album des préférées de Paul : ses cartes et ses cases vides, dans l'ordre de sa collection.
        const atitle = () => (one('album-title') ? text(one('album-title')) : '');
        const grid = () => cls('cardgrid')[0] || null;
        const shownTitles = () => (grid() ? grid().childNodes.filter((n) => n.nodeType === 1).map((n) => text(n.querySelector('h3'))) : []);
        const fslot = (t) => cls('slot').find((n) => n.querySelector('h3') && text(n.querySelector('h3')) === t) || null;
        const fcard = (t) => cls('card--fa').find((n) => text(n.querySelector('.card__title')) === t) || null;
        const gives = (t) => { const s = fslot(t); return s ? s.querySelectorAll('.slot__friends').map(text) : null; };
        const pvMark = pvAsked.length;
        colRow('Les préférées de Paul').click();
        await settle(80);
        check(atitle().includes('Les préférées de Paul') && atitle().includes('Paul en a 2 sur 9') && atitle().includes('lecture seule') && !atitle().includes('catégorie'), 'album de Paul : ' + atitle());
        check(shownTitles().join(' | ') === 'Terre | Rihanna | Article 60 | Saturne (planète) | Neptune (planète) | Article 7 | Livre introuvable | Article 1 | Mars (planète)'
          && cls('card--fa').length === 2 && cls('slot').length === 7, 'album de Paul, ordre et cases : ' + shownTitles().join(' | '));
        check(text(fslot('Terre').querySelector('.slot__no')) === '1' && one('bar') && one('give-sum') && text(one('give-sum')).includes("Tu peux l'aider : 4 cartes dont 3 en double")
          && text(one('give-sum')).includes('1 de ses cartes manque à tes collections'), 'en-tête de l\'album : ' + (one('give-sum') ? text(one('give-sum')) : 'absent'));
        // Cases vides que je remplis : « tu l'as », et « ×2 en double » pour mes doubles ; rareté de ma carte (sans ≈).
        check(gives('Terre').join() === "tu l'as,×2 en double" && gives('Rihanna').join() === "tu l'as,×2 en double" && gives('Article 60').join() === "tu l'as"
          && gives('Article 7').join() === "tu l'as,×2 en double" && gives('Saturne (planète)').length === 0 && gives('Livre introuvable').length === 0,
          'badges « tu l\'as » : ' + ['Terre', 'Rihanna', 'Article 60', 'Article 7', 'Saturne (planète)'].map((t) => t + '=' + gives(t)).join(', '));
        check(fslot('Terre').classList.contains('can') && !fslot('Saturne (planète)').classList.contains('can') && !fslot('Terre').querySelector('.pill').classList.contains('est'),
          'cases que je remplis : à part, rareté de ma carte');
        // Ses cartes : Mars me manque et remplirait ma collection des planètes ; Article 1, je l'ai.
        check(fcard('Mars (planète)') && fcard('Mars (planète)').classList.contains('want') && text(fcard('Mars (planète)').querySelector('.card__mark')) === 'Te manque'
          && text(fcard('Mars (planète)').parentNode.querySelector('.cell__want')).startsWith('→ Planète du Système solaire'), 'Mars chez Paul : ' + text(fcard('Mars (planète)').parentNode));
        check(fcard('Article 1').classList.contains('have') && text(fcard('Article 1').querySelector('.card__mark')) === "Tu l'as" && !fcard('Article 1').parentNode.querySelector('.cell__want'), 'Article 1 chez Paul');
        // Vues sur Wikipédia : seulement pour les cases que ni Paul ni moi n'avons (Saturne et Neptune sont déjà en cache).
        check(await waitFor(() => fslot('Livre introuvable') && text(fslot('Livre introuvable')).includes('vues inconnues'), 5000), 'vues de « Livre introuvable » : ' + text(fslot('Livre introuvable')));
        {
          const asked = pvAsked.slice(pvMark);
          check(asked.includes('Livre introuvable') && asked.every((t) => ['Saturne (planète)', 'Neptune (planète)', 'Livre introuvable'].includes(t)), 'vues demandées pour l\'album de Paul : ' + asked.join(', '));
        }
        // Filtres : Toutes / Il les a / Lui manquent / Tu peux l'aider ; tri par rareté.
        exactButton('Il les a').click();
        await settle();
        check(shownTitles().join(' | ') === 'Article 1 | Mars (planète)', '« Il les a » : ' + shownTitles().join(' | '));
        exactButton('Lui manquent').click();
        await settle();
        check(shownTitles().length === 7 && !cls('card--fa').length, '« Lui manquent » : ' + shownTitles().join(' | '));
        exactButton("Tu peux l'aider").click();
        await settle();
        check(shownTitles().join(' | ') === 'Terre | Rihanna | Article 60 | Article 7', '« Tu peux l\'aider » : ' + shownTitles().join(' | '));
        exactButton('Rareté').click();
        await settle();
        check(shownTitles()[0] === 'Rihanna' && shownTitles().length === 4, 'tri par rareté : ' + shownTitles().join(' | '));
        exactButton('Ordre').click();
        exactButton('Toutes').click();
        await settle();
        check(shownTitles().length === 9, '« Toutes » : ' + shownTitles().length);
        // « Copier le nom » sur une case vide.
        {
          const n0 = copied.length;
          fslot('Article 60').querySelector('.slot__copy').click();
          await settle();
          check(copied[n0] === 'Article 60', 'copier le nom d\'une case de Paul : ' + JSON.stringify(copied.slice(n0)));
        }
        // Fiche d'une case vide que je remplis : en lecture seule, sans rien qui touche à mon classeur.
        const fs = () => one('fiche--friend');
        fslot('Terre').querySelector('.slot__open').click();
        await settle();
        check(fs() && text(fs()).includes('Manque à Paul') && text(fs()).includes("Tu l'as : ×2, en double") && text(fs()).includes('Tu pourrais la lui donner'), 'fiche de Terre (case vide de Paul) : ' + text(fs()));
        check(!fs().querySelectorAll('input, textarea, select').length && !fs().querySelectorAll('button').some((b) => /Ajouter|Suivre|Modifier|Supprimer|Valider/.test(text(b))),
          'fiche d\'un ami : aucune action sur un classeur');
        {
          const lists = fs().querySelectorAll('.memberships').map((m) => m.querySelectorAll('button').map(text));
          check(text(fs()).includes('Dans les collections de Paul') && lists.length === 2 && lists[0].some((t) => t.startsWith('Les préférées de Paul'))
            && lists[0].some((t) => t.startsWith('Planète du Système solaire')) && text(fs()).includes('Dans tes collections') && lists[1].some((t) => t.startsWith('Planète du Système solaire')),
          'fiche de Terre : collections de Paul et les miennes : ' + text(fs()));
        }
        {
          const n0 = copied.length;
          fs().querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'Copier le nom « Terre »').click();
          await settle();
          check(copied[n0] === 'Terre', 'copier le nom (fiche d\'un ami) : ' + JSON.stringify(copied.slice(n0)));
        }
        fs().querySelector('.close').click();
        await settle();
        // Fiche d'une de ses cartes qui me manque.
        fcard('Mars (planète)').click();
        await settle();
        check(fs() && text(fs()).includes('Chez Paul : ×2') && text(fs()).includes('Pas encore dans ta collection') && text(fs()).includes('Rareté dans le jeu')
          && text(fs()).includes('Dans tes collections') && !fiche().querySelector('#new-tag'), 'fiche de Mars (carte de Paul) : ' + text(fs()));
        fs().querySelector('.close').click();
        await settle();
        needButton('← Retour au classeur de Paul').click();
        await settle();
        check(has('Le classeur de Paul') && sect('h-fcols') && !one('card--fa'), 'retour au classeur de Paul');
        // Sa collection tirée d'une catégorie : de A à Z, sans numéros, signalée.
        colRow('Planète du Système solaire').click();
        await settle(80);
        check(atitle().includes('Planète du Système solaire') && atitle().includes(KIND) && atitle().includes('Paul en a 2 sur 4')
          && shownTitles().join(' | ') === 'Jupiter (planète) | Mars (planète) | Saturne (planète) | Terre' && !cls('slot__no').length && !has('Suivre aussi'),
          'catégorie de Paul : ' + atitle() + ' / ' + shownTitles().join(' | '));
        needButton('← Retour au classeur de Paul').click();
        await settle();
        // Celle que je n'ai pas : Hydrogène (qid), Hélium (rareté estimée, vignette) ; « Créer la même collection chez moi »
        // (sa liste d'articles, recopiée telle quelle, sans requête à Wikipédia).
        colRow('Élément chimique').click();
        await settle(80);
        check(await waitFor(() => gives('Hydrogène') && gives('Hydrogène')[0] === "tu l'as", 8000), 'Hydrogène (ma carte, même qid) : ' + JSON.stringify(gives('Hydrogène')));
        check(await waitFor(() => fslot('Hélium') && text(fslot('Hélium').querySelector('.pill')) === '≈ SR' && fslot('Hélium').querySelector('.slot__bg')), 'Hélium : rareté estimée et vignette : ' + text(fslot('Hélium')));
        {
          needButton('Créer la même collection chez moi').click();
          check(await waitFor(() => buttonByText('Ouvrir ma collection'), 5000) && has('Collection « Élément chimique » créée dans ton classeur : 3 articles.') && !buttonByText('Créer la même collection'),
            'Créer la même collection chez moi : sans effet');
          const mineT = ((await rawApi('GET', '/api/targets', myKey3)).body.targets || []).find((x) => x.name === 'Élément chimique');
          check(mineT && mineT.items.map((i) => i.title + ':' + i.status).join() === 'Hydrogène:ok,Hélium:ok,Lithium:ok' && !mineT.source, 'collection copiée de Paul : ' + JSON.stringify(mineT));
        }
        needButton('Ouvrir ma collection').click();
        await settle(80);
        check(tabBtn('collections').getAttribute('aria-selected') === 'true' && atitle().includes('Élément chimique') && !atitle().includes('lecture seule'), 'ma collection : ' + atitle());
        await goTab('amis');
        needButton('← Retour au classeur de Paul').click();
        await settle();
        needButton('← Entre amis').click();
        await settle();
        // Depuis « Ce qui pourrait intéresser tes amis » : le nom d'une collection de Paul ouvre son album.
        fcol('Paul').querySelectorAll('.fitem__col')[0].click();
        await settle(80);
        check(atitle().includes('Paul en a') && buttonByText('← Retour au classeur de Paul') && !buttonByText('← Échanges possibles'), 'album depuis « Ce qui pourrait intéresser tes amis » : ' + atitle());
        needButton('← Retour au classeur de Paul').click();
        await settle();
        needButton('← Entre amis').click();
        await settle();
        // Depuis « Échanges possibles » : le nom d'une collection de Paul ouvre son album ; un lien ramène aux échanges, filtre gardé.
        needButton('Voir les échanges possibles').click();
        await settle();
        exactButton('Ce qui me concerne').click(); // un filtre autre que celui par défaut : il doit être gardé au retour
        await settle();
        const a7row = () => (pair('Toi → Paul') ? pair('Toi → Paul').querySelectorAll('.fitem').find((n) => text(n.querySelector('.fitem__title')) === 'Article 7') || null : null);
        check(a7row(), 'échanges : Article 7 pour Paul absent');
        a7row().querySelectorAll('.fitem__col').find((b) => text(b) === 'Exemples de Paul').click();
        await settle(80);
        check(atitle().includes('Exemples de Paul') && atitle().includes('Paul en a 1 sur 2') && buttonByText('← Échanges possibles') && buttonByText('← Retour au classeur de Paul')
          && gives('Article 7').join() === "tu l'as,×2 en double", 'album depuis les échanges : ' + atitle());
        needButton('← Échanges possibles').click();
        await settle();
        check(has('Échanges possibles') && pressed() === 'Ce qui me concerne' && a7row(), 'retour aux échanges : filtre gardé, ' + pressed());
        a7row().querySelectorAll('.fitem__col').find((b) => text(b) === 'Les préférées de Paul').click();
        await settle(80);
        needButton('← Retour au classeur de Paul').click();
        await settle();
        check(has('Le classeur de Paul') && sect('h-fcols'), 'retour au classeur de Paul (depuis les échanges)');
        needButton('← Entre amis').click();
        await settle();
        // Léa ne partage pas ses collections.
        await openBinder('Léa');
        check(sect('h-fcols') && text(sect('h-fcols')).includes('Léa ne partage pas ses collections.') && !sect('h-fcols').querySelector('.row') && cls('card--friend').length === 4,
          'classeur de Léa : ' + (sect('h-fcols') ? text(sect('h-fcols')) : 'absent'));
        needButton('← Entre amis').click();
        await settle();
        // Rien des collections des amis dans IndexedDB ni dans localStorage.
        await sleep(1600);
        const kept = JSON.stringify(cachedCards());
        check(!kept.includes('Les préférées de Paul') && !kept.includes('Livre introuvable') && !kept.includes('p-mars'), 'les collections des amis ne doivent pas aller dans IndexedDB');
        check(![...ls.values()].some((v) => String(v).includes('Les préférées de Paul') || String(v).includes('Exemples de Paul')), 'les collections des amis ne doivent pas aller dans localStorage');
      }
    }

    // Désactivation dans les Réglages : l'onglet invite de nouveau à partager ; Paul ne me voit plus.
    check((await rawApi('GET', '/api/members', paulKey)).body.members.some((m) => m.name === 'Cédric'), 'Paul doit me voir');
    await goTab('reglages');
    const cb = byId('set-shared');
    check(has('Partage entre membres') && cb && cb.checked, 'réglage du partage absent ou décoché');
    cb.checked = false;
    cb.dispatch('change');
    await settle(80);
    check(!byId('set-shared').checked && has('ne sont plus montrées'), 'désactivation du partage sans effet');
    // Le partage des collections tombe avec celui des cartes (à rechoisir) : le second réglage disparaît.
    check(!byId('set-shared-targets') && (await rawApi('GET', '/api/me', myKey3)).body.shared_targets === false, 'partage des collections encore actif après la désactivation');
    check(!(await rawApi('GET', '/api/members', paulKey)).body.members.some((m) => m.name === 'Cédric'), 'Paul me voit encore après la désactivation');
    await goTab('amis');
    check(has('Montrer mes cartes aux autres membres') && !cls('fcol').length && !has('Pour compléter tes collections'), 'après désactivation : invitation au partage attendue');
    await goTab('collections');
  }

  // Collection créée par le favori depuis une recherche de la Collection globale du jeu (source wm:…) : la rareté du jeu
  // s'affiche sans « ≈ » (case vide, fiche de la carte manquante, « Il t'en manque ») ; l'estimation reste pour les autres.
  {
    const keyG = await makeOtherAccount('Gaston');
    await seedCards(keyG, [{ id: 'g1', title: 'Vache normande', rarity: 'PC', atk: 1, def: 1, quality: 1, pageviews: 10, category: 'race bovine', image: null, url: null,
      count: 1, shiny: false, starred: false, obtained_at: '2026-10-01T00:00:00Z' }]);
    await rawApi('POST', '/api/targets/save', keyG, { name: 'Vaches', source: 'wm:vache', items: [
      { title: 'Vache', description: 'mammifère domestique', image: null, status: 'ok', rarity: 'R' },
      { title: 'Vache Highland', description: null, image: null, status: 'ok', rarity: 'UR' },
      { title: 'Vache normande', description: 'race bovine', image: null, status: 'ok', rarity: 'PC' },
      { title: 'Zeus', description: 'dieu grec', image: null, status: 'ok' }, // sans rareté du jeu : estimée (vues gardées en cache)
    ] });
    // Préférences d'avant le retrait du catalogue (hidden_catalog, hide_catalog) : encore lues, puis réécrites au format
    // actuel (hidden_proposals, hide_proposals), les ids du catalogue oubliés, le reste gardé.
    check((await rawApi('PATCH', '/api/me', keyG, { prefs: { hidden_catalog: ['vaches', 'wp:Autre essai'], hide_catalog: true, autre: 1 } })).status === 200, 'anciennes préférences refusées');
    ls.set('classeur-key', keyG);
    ls.set('classeur-known', JSON.stringify([{ key: keyG, name: 'Gaston' }]));
    const p = openPage({ idb: 'absent' });
    check(await waitFor(() => p.count() === 1), 'collection du jeu : classeur de Gaston non ouvert');
    p.doc.getElementById('tab-collections').click();
    await settle();
    {
      await openNewIn(p.doc, 'props');
      check(text(p.doc.body).includes('Propositions masquées.'), 'anciennes préférences : hide_catalog doit masquer les propositions');
      p.doc.querySelectorAll('button').find((b) => text(b) === 'Afficher les propositions').click();
      await settle(100);
      await closeNewIn(p.doc);
      const prefs = (await rawApi('GET', '/api/me', keyG)).body.prefs;
      check(JSON.stringify(prefs) === JSON.stringify({ autre: 1, hidden_proposals: ['wp:Autre essai'], hide_proposals: false }), 'anciennes préférences mal reprises : ' + JSON.stringify(prefs));
    }
    const row = p.doc.querySelectorAll('.row').find((n) => (n.getAttribute('aria-label') || '').startsWith('Vaches'));
    check(row, 'collection du jeu : « Vaches » absente de « Mes collections »');
    row.click();
    await settle(80);
    const slotOf = (t) => p.doc.querySelectorAll('.slot').find((s) => s.querySelector('h3') && text(s.querySelector('h3')) === t);
    const pillOf = (t) => { const s = slotOf(t); return s && s.querySelector('.pill') ? text(s.querySelector('.pill')) : null; };
    check(await waitFor(() => pillOf('Zeus') === '≈ L'), 'collection du jeu : rareté estimée de « Zeus » attendue, ' + pillOf('Zeus'));
    check(pillOf('Vache') === 'R' && pillOf('Vache Highland') === 'UR', 'collection du jeu : raretés du jeu sans « ≈ » attendues, ' + pillOf('Vache') + ' / ' + pillOf('Vache Highland'));
    check(!slotOf('Vache').querySelector('.pill').classList.contains('est'), 'collection du jeu : pastille estimée pour une rareté du jeu');
    const missBox = p.doc.querySelectorAll('.missing-sum').find((n) => text(n).includes("Il t'en manque 3 :"));
    const missPills = missBox ? missBox.querySelectorAll('.pill').map(text) : [];
    check(missPills.join(',') === 'UR,R,≈ L' && text(missBox).includes('Tu en as') === false,
      "collection du jeu : « Il t'en manque » : " + p.doc.querySelectorAll('.missing-sum').map(text).join(' | '));
    check(await waitFor(() => text(p.doc.body).includes('Sans « ≈ » : rareté relevée dans le jeu.')), 'collection du jeu : explication des pastilles sans « ≈ » absente');
    slotOf('Vache').querySelector('.slot__open').click();
    await settle(120);
    const f = p.doc.querySelectorAll('.fiche--missing')[0];
    const ft = f ? text(f) : '';
    check(ft.includes('Rareté dans le jeu') && ft.includes('Rare') && !ft.includes('≈') && ft.includes('mammifère domestique') && text(f.querySelector('.pill')) === 'R',
      'collection du jeu : fiche de la carte manquante : ' + ft.slice(0, 300));
    f.querySelector('.close').click();
    await settle(400);
  }

  // « Depuis le jeu » : recherche dans les cartes du jeu (GET /api/game/cards, faite par le serveur avec la session reliée),
  // puis une collection qui garde la rareté du jeu de chaque carte (source wm:<recherche>). Sans compte relié : renvoi vers
  // l'onglet « Synchro ».
  {
    const keyH = await makeOtherAccount('Hortense');
    await setGameTable([
      { id: 'gv1', wikipedia_title: 'Vache', rarity: 'R', category: 'mammifère domestique', image_url: 'https://upload.wikimedia.org/vache.jpg', lang: 'fr' },
      { id: 'gv2', wikipedia_title: 'Vache Highland', rarity: 'L', category: null, image_url: null, lang: 'fr' },
      { id: 'gv3', wikipedia_title: 'Dragon', rarity: 'C', category: 'créature', image_url: null, lang: 'fr' },
    ]);
    ls.set('classeur-key', keyH);
    ls.set('classeur-known', JSON.stringify([{ key: keyH, name: 'Hortense' }]));
    const p = openPage({ idb: 'absent' });
    check(await waitFor(() => text(p.doc.body).includes('Collections')), 'Depuis le jeu : classeur de Hortense non ouvert');
    p.doc.getElementById('tab-collections').click();
    await settle();
    await openNewIn(p.doc, 'jeu');
    check(!p.doc.getElementById('game-q') && text(p.doc.body).includes('relie-le une fois') && p.doc.querySelectorAll('button').some((b) => text(b).includes('Relier mon compte')),
      'Depuis le jeu sans compte relié : renvoi vers « Synchro » attendu : ' + text(p.doc.getElementById('newcol-panel')));
    await closeNewIn(p.doc);
    // Compte relié (le faux jeu relie en lisant une collection) : la page le sait en relisant GET /api/me.
    if (SERVER) await seedCards(keyH, [{ id: 'h1', title: 'Hortensia', rarity: 'C', atk: 1, def: 1, quality: 1, pageviews: 1, category: 'x', image: null, url: null, count: 1, shiny: false, starred: false, obtained_at: '2026-10-01T00:00:00Z' }]);
    else api.link(keyH);
    await p.live();
    await settle(120);
    await openNewIn(p.doc, 'jeu');
    const q = p.doc.getElementById('game-q');
    check(q, 'Depuis le jeu : champ de recherche absent après la liaison : ' + text(p.doc.getElementById('newcol-panel')));
    const seen = () => text(p.doc.getElementById('newcol-panel'));
    const press = (label) => p.doc.querySelectorAll('button').find((b) => text(b).includes(label));
    const search = (v) => { q.value = v; q.dispatch('input'); press('Chercher').click(); };
    search('vache');
    check(await waitFor(() => seen().includes('Vache Highland')), 'Depuis le jeu : résultats absents : ' + seen());
    const pills = p.doc.getElementById('newcol-panel').querySelectorAll('.pill').map(text);
    check(seen().includes('mammifère domestique') && !seen().includes('Dragon') && pills.join(',') === 'R,L', 'Depuis le jeu : cartes ou raretés trouvées : ' + seen() + ' / ' + pills);
    check(press('Créer la collection « vache » (2 cartes)'), 'Depuis le jeu : bouton « Créer la collection » absent : ' + seen());
    // Une recherche sans résultat ne propose rien à créer.
    search('licorne');
    check(await waitFor(() => seen().includes('Aucune carte du jeu ne porte ce nom')), 'Depuis le jeu : recherche vide non dite : ' + seen());
    check(press('Créer la collection').disabled, 'Depuis le jeu : création possible sans carte');
    search('vache');
    check(await waitFor(() => seen().includes('Vache Highland')), 'Depuis le jeu : seconde recherche absente');
    press('Créer la collection « vache »').click();
    check(await waitFor(() => !p.doc.getElementById('newcol-panel')), 'Depuis le jeu : fenêtre non refermée après la création');
    await settle(80);
    const made = (await rawApi('GET', '/api/targets', keyH)).body.targets.find((t) => t.source === 'wm:vache');
    check(made && made.name === 'vache' && made.items.length === 2 && made.items[0].title === 'Vache' && made.items[0].rarity === 'R' && made.items[1].rarity === 'L'
      && made.items[0].description === 'mammifère domestique' && made.items[0].status === 'ok', 'Depuis le jeu : collection mal enregistrée : ' + JSON.stringify(made));
    if (!SERVER) check(api.calls.some(([m, pp, b]) => m === 'POST' && pp === '/api/targets/save' && b.source === 'wm:vache' && b.items.length === 2 && b.items.every((x) => x.rarity)), 'Depuis le jeu : envoi mal formé');
    check(apiLog.filter((x) => x.startsWith('GET /api/game/cards?q=')).length === 3, 'Depuis le jeu : trois recherches attendues : ' + apiLog.filter((x) => x.includes('game/cards')).join(', '));
    check(text(p.doc.body).includes('Collection « vache » créée'), 'Depuis le jeu : message de création absent');
    console.log('depuis le jeu : collection « vache » créée (' + made.items.length + ' cartes, source ' + made.source + ')');
  }

  // Intercalaires et collections complètes (Ninon ; Olga, une amie qui montre ses collections). Un intercalaire (sep: true)
  // est une vraie carte qui ouvre une section : cadre à onglet (carte possédée ou case vide), nouvelle ligne de la grille
  // dans l'ordre de la collection (gridBreak), cadre seul en tri par rareté ou avec un filtre ; « # » dans l'éditeur (relu
  // et enregistré) ; case « Intercalaire » de la fiche (carte possédée, case vide) qui renvoie la collection entière, ses
  // autres champs gardés ; rien depuis « Mes cartes ». Collection complète : ligne et en-tête dorés (.complete), « Complète ».
  // Chez Olga (lecture seule) : ses intercalaires, sa collection complète.
  {
    const keyN = await makeOtherAccount('Ninon');
    const keyO = await makeOtherAccount('Olga');
    const mkc = (id, title) => ({ id, title, rarity: 'C', atk: 1, def: 1, quality: 1, pageviews: 10, category: 'continent', image: null, url: null, count: 1, shiny: false, starred: false, obtained_at: '2026-10-01T00:00:00Z' });
    const it = (title, extra) => ({ title, description: null, image: null, status: 'ok', ...extra });
    const CONT = [it('Continent', { sep: true }), it('Afrique', { qid: 'Q15', rarity: 'R', description: 'continent' }), it('Europe'), it('Sous-continent', { sep: true }),
      it('Amérique du Nord'), it('Supercontinent', { sep: true }), it('Pangée')];
    await seedCards(keyN, ['Continent', 'Afrique', 'Europe', 'Supercontinent', 'Pangée', 'Zeus'].map((t, i) => mkc('n' + i, t)));
    await seedCards(keyO, CONT.map((x, i) => mkc('o' + i, x.title)));
    check((await rawApi('POST', '/api/targets/save', keyN, { name: 'Continents', items: CONT })).status === 200, 'intercalaires : collection refusée');
    await rawApi('POST', '/api/targets/save', keyN, { name: 'Olympe', items: [it('Zeus')] }); // complète (Ninon a Zeus)
    // Cartes avant le premier intercalaire (hors section) : montrées après les sections, sur leur ligne.
    await rawApi('POST', '/api/targets/save', keyN, { name: 'Mêlée', items: [it('Zeus'), it('Pangée'), it('Continent', { sep: true }), it('Afrique', { qid: 'Q15' })] });
    await rawApi('POST', '/api/targets/save', keyO, { name: "Continents d'Olga", items: CONT });
    for (const k of [keyN, keyO]) check((await rawApi('PATCH', '/api/me', k, { shared: true, shared_targets: true })).status === 200, 'intercalaires : partage refusé');
    ls.set('classeur-key', keyN);
    ls.set('classeur-known', JSON.stringify([{ key: keyN, name: 'Ninon' }]));
    const p = openPage({ idb: 'absent' });
    check(await waitFor(() => p.count() === 6), 'intercalaires : classeur de Ninon non ouvert');
    p.doc.getElementById('tab-collections').click();
    await settle();
    const d = p.doc;
    const rowOf = (name) => d.querySelectorAll('.row').find((n) => (n.getAttribute('aria-label') || '').startsWith(name + ' :')) || null;
    const btnIn = (t) => d.querySelectorAll('button').find((b) => text(b).trim() === t) || null;
    const grid = () => d.querySelectorAll('.cardgrid')[0] || null;
    // Enfants de la grille : « | » pour une nouvelle ligne, « [Titre] » pour un intercalaire (cadre), « Titre » sinon.
    const layout = () => (grid() ? grid().childNodes.filter((n) => n.nodeType === 1).map((n) => {
      if (n.classList.contains('grid-break')) return '|';
      const t = text(n.querySelector('h3'));
      return n.querySelector('.sep-frame') || n.classList.contains('sep-frame') ? `[${t}]` : t;
    }).join(' ') : '');
    const serverSeps = async () => {
      const t = (await rawApi('GET', '/api/targets', keyN)).body.targets.find((x) => x.name === 'Continents');
      return { seps: t.items.filter((x) => x.sep === true).map((x) => x.title).join(', '), afrique: t.items.find((x) => x.title === 'Afrique'), t };
    };
    // « Mes collections » : Olympe complète (tour doré, « Complète » au lieu du pourcentage), Continents non.
    check(rowOf('Olympe') && rowOf('Olympe').classList.contains('complete') && text(rowOf('Olympe')).includes('Complète') && !text(rowOf('Olympe')).includes('100 %')
      && (rowOf('Olympe').getAttribute('aria-label') || '').includes('collection complète'), 'collection complète : ligne dorée attendue, ' + (rowOf('Olympe') ? rowOf('Olympe').className + ' / ' + text(rowOf('Olympe')) : 'absente'));
    check(!rowOf('Continents').classList.contains('complete') && text(rowOf('Continents')).includes('71 %') && !text(rowOf('Continents')).includes('Complète'), 'collection incomplète : pas de tour doré, ' + text(rowOf('Continents')));
    rowOf('Olympe').click();
    await settle(80);
    {
      const at = d.querySelectorAll('.album-title')[0];
      check(at && at.classList.contains('complete') && text(at).includes('1 sur 1') && text(at).includes('Complète'), 'en-tête d\'une collection complète : ' + (at ? at.className + ' / ' + text(at) : 'absent'));
    }
    btnIn('← Toutes les collections').click();
    await settle();
    rowOf('Mêlée').click();
    await settle(80);
    check(layout() === '[Continent] Afrique | Zeus Pangée', 'cartes hors section : après les intercalaires attendues, ' + layout());
    d.querySelectorAll('.sec-fold')[0].click();
    await settle();
    check(layout() === '[Continent] | Zeus Pangée', 'cartes hors section, section repliée : ' + layout());
    d.querySelectorAll('.sec-fold')[0].click();
    await settle();
    btnIn('Rareté').click();
    await settle();
    check(!d.querySelectorAll('.grid-break').length, 'cartes hors section, tri par rareté : pas de nouvelle ligne, ' + layout());
    btnIn('Ordre').click();
    await settle();
    btnIn('← Toutes les collections').click();
    await settle();
    // Album des continents, dans l'ordre : trois sections, intercalaires dans leur cadre (case vide comprise).
    rowOf('Continents').click();
    await settle(80);
    check(!d.querySelectorAll('.album-title')[0].classList.contains('complete'), 'collection incomplète : en-tête doré');
    check(layout() === '[Continent] Afrique Europe | [Sous-continent] Amérique du Nord | [Supercontinent] Pangée', 'intercalaires dans l\'ordre : ' + layout());
    {
      const cont = d.querySelectorAll('.cell').find((c) => text(c.querySelector('.card__title')) === 'Continent');
      check(cont.classList.contains('sep') && (cont.querySelector('.card').getAttribute('aria-label') || '').startsWith('Continent, Commune, intercalaire'),
        'carte intercalaire : classe ou nom accessible, ' + cont.className + ' / ' + cont.querySelector('.card').getAttribute('aria-label'));
      const sous = d.querySelectorAll('.slot').find((s) => text(s.querySelector('h3')) === 'Sous-continent');
      check(sous.classList.contains('sep') && sous.parentNode.classList.contains('sep-frame') && (sous.querySelector('.slot__open').getAttribute('aria-label') || '').startsWith('Sous-continent, intercalaire :'),
        'case vide intercalaire : cadre ou nom accessible');
      check(!d.querySelectorAll('.cell').find((c) => text(c.querySelector('.card__title')) === 'Afrique').classList.contains('sep'), 'Afrique n\'est pas un intercalaire');
    }
    // Tri par rareté, filtre « Manquantes » : le cadre reste, plus de nouvelle ligne.
    btnIn('Rareté').click();
    await settle();
    check(!d.querySelectorAll('.grid-break').length && d.querySelectorAll('.sep-frame').length === 3, 'tri par rareté : cadres sans sections attendus, ' + layout());
    btnIn('Ordre').click();
    btnIn('Manquantes').click();
    await settle();
    check(layout() === '[Sous-continent] Amérique du Nord', 'filtre « Manquantes » : ' + layout());
    btnIn('Toutes').click();
    await settle();
    // Repli d'une section (onglet de l'intercalaire) : il ne reste que l'intercalaire, « +2 » ; gardé dans ce navigateur,
    // sans effet hors des sections (tri par rareté) ; « Tout replier » (chaque section garde sa ligne) / « Tout déplier ».
    {
      const tab = (t) => d.querySelectorAll('.sec-fold').find((b) => (b.getAttribute('aria-label') || '').includes('« ' + t + ' »')) || null;
      check(d.querySelectorAll('.sec-fold').length === 3 && tab('Continent').getAttribute('aria-expanded') === 'true', 'repli : trois onglets ouverts attendus');
      tab('Continent').click();
      await settle();
      check(layout() === '[Continent] | [Sous-continent] Amérique du Nord | [Supercontinent] Pangée' && tab('Continent').getAttribute('aria-expanded') === 'false'
        && text(tab('Continent')).includes('+2') && (tab('Continent').getAttribute('aria-label') || '').startsWith('Déplier la section « Continent » (2 cartes)'), 'repli de « Continent » : ' + layout());
      check(d.querySelectorAll('.sec-wrap.folded').length === 1 && (JSON.parse(ls.get('classeur-sections') || '{}')[Object.keys(JSON.parse(ls.get('classeur-sections') || '{}'))[0]] || []).join() === 'Continent',
        'repli : non gardé dans le navigateur, ' + ls.get('classeur-sections'));
      btnIn('Rareté').click();
      await settle();
      check(!d.querySelectorAll('.sec-fold').length && d.querySelectorAll('.sep-frame').length === 3 && layout().includes('Afrique'), 'tri par rareté : section repliée cachée, ' + layout());
      btnIn('Ordre').click();
      await settle();
      btnIn('Tout replier').click();
      await settle();
      check(layout() === '[Continent] | [Sous-continent] | [Supercontinent]' && !!btnIn('Tout déplier'), 'tout replier : ' + layout());
      btnIn('Tout déplier').click();
      await settle();
      check(layout() === '[Continent] Afrique Europe | [Sous-continent] Amérique du Nord | [Supercontinent] Pangée' && !ls.get('classeur-sections').includes('Continent'), 'tout déplier : ' + layout());
    }
    // Éditeur : « # » devant les intercalaires ; « # » retiré de Supercontinent, ajouté (sans espace) à Pangée, enregistré
    // sans revérifier les articles (tous déjà connus).
    btnIn('Modifier').click();
    await settle();
    {
      const ta = d.getElementById('ed-text');
      check(ta && ta.value === '# Continent\nAfrique\nEurope\n# Sous-continent\nAmérique du Nord\n# Supercontinent\nPangée', 'éditeur : intercalaires en « # » attendus, ' + JSON.stringify(ta && ta.value));
      check(text(d.querySelectorAll('.modal')[0]).includes('7 lignes · 3 intercalaires') && text(d.querySelectorAll('.modal')[0]).includes('« # » en début de ligne'), 'éditeur : explication ou compte des intercalaires absent');
      const wikiMark = apiLog.length;
      type(ta, '# Continent\nAfrique\nEurope\n#  Sous-continent\nAmérique du Nord\nSupercontinent\n#Pangée\n');
      d.querySelectorAll('.modal')[0].querySelectorAll('button').find((b) => text(b).trim() === 'Enregistrer').click();
      check(await waitFor(() => !d.querySelectorAll('.modal').length), 'éditeur : enregistrement sans effet, ' + text(d.querySelectorAll('.modal')[0] || d.body).slice(0, 300));
      check(apiLog.slice(wikiMark).filter((x) => x.startsWith('POST /api/targets/save')).length === 1, 'éditeur : un seul enregistrement attendu');
    }
    {
      const s = await serverSeps();
      check(s.seps === 'Continent, Sous-continent, Pangée' && s.afrique.qid === 'Q15' && s.afrique.rarity === 'R' && s.afrique.description === 'continent',
        'éditeur : intercalaires enregistrés (ou autres champs perdus) : ' + s.seps + ' / ' + JSON.stringify(s.afrique));
    }
    await settle(80);
    check(layout() === '[Continent] Afrique Europe | [Sous-continent] Amérique du Nord Supercontinent | [Pangée]', 'après l\'éditeur : ' + layout());
    // Fiche d'une carte possédée de l'album : case « Intercalaire » cochée ; décochée, la collection est renvoyée sans le
    // drapeau (le reste gardé).
    const sepBox = () => { const t = d.querySelectorAll('.sep-toggle')[0]; return t ? t.querySelector('input') : null; };
    d.querySelectorAll('.card').find((c) => text(c.querySelector('.card__title')) === 'Pangée').click();
    await settle(80);
    check(sepBox() && sepBox().checked && text(d.querySelectorAll('.sep-toggle')[0]).includes('« Continents »'), 'fiche : case « Intercalaire » cochée attendue, ' + text(d.querySelectorAll('.fiche')[0] || d.body).slice(0, 300));
    sepBox().checked = false;
    sepBox().dispatch('change');
    check(await waitFor(() => sepBox() && !sepBox().disabled && !sepBox().checked), 'fiche : case « Intercalaire » restée cochée');
    {
      const s = await serverSeps();
      check(s.seps === 'Continent, Sous-continent' && s.afrique.qid === 'Q15' && s.t.items.length === 7, 'fiche : intercalaire non retiré (ou collection abîmée) : ' + s.seps + ' / ' + JSON.stringify(s.afrique));
    }
    d.querySelectorAll('.fiche')[0].querySelector('.close').click();
    await settle(400);
    check(layout() === '[Continent] Afrique Europe | [Sous-continent] Amérique du Nord Supercontinent Pangée', 'après la fiche (carte) : ' + layout());
    // Fiche d'une case vide : même case, cochée cette fois.
    d.querySelectorAll('.slot__open').find((b) => (b.getAttribute('aria-label') || '').startsWith('Amérique du Nord :')).click();
    await settle(80);
    check(sepBox() && !sepBox().checked && d.querySelectorAll('.fiche--missing').length === 1, 'fiche d\'une case vide : case « Intercalaire » décochée attendue');
    sepBox().checked = true;
    sepBox().dispatch('change');
    check(await waitFor(() => sepBox() && !sepBox().disabled), 'fiche d\'une case vide : enregistrement sans fin');
    {
      let seps = '';
      for (let i = 0; i < 40 && (seps = (await serverSeps()).seps) !== 'Continent, Sous-continent, Amérique du Nord'; i++) await sleep(50);
      check(seps === 'Continent, Sous-continent, Amérique du Nord', 'fiche d\'une case vide : intercalaire non enregistré, ' + seps);
    }
    d.querySelectorAll('.fiche')[0].querySelector('.close').click();
    await settle(400);
    check(layout() === '[Continent] Afrique Europe | [Sous-continent] | [Amérique du Nord] Supercontinent Pangée', 'après la fiche (case vide) : ' + layout());
    // « Retirer de « Continents » » (fiche de la case vide Amérique du Nord) : la collection est renvoyée sans elle, la
    // fiche se ferme ; « Annuler » dans le message la remet à sa place, intercalaire compris.
    d.querySelectorAll('.slot__open').find((b) => (b.getAttribute('aria-label') || '').startsWith('Amérique du Nord')).click();
    await settle(80);
    {
      const until = async (f, ms = 3000) => { for (let t = 0; t < ms; t += 25) { if (await f()) return true; await sleep(25); } return !!(await f()); };
      const rm = d.querySelectorAll('button').find((b) => b.classList.contains('item-remove'));
      check(rm && text(rm).includes('Retirer de « Continents »'), 'fiche : bouton « Retirer de « Continents » » absent');
      rm.click();
      check(await until(async () => (await serverSeps()).t.items.length === 6 && !d.querySelectorAll('.fiche').length), 'retrait : collection non renvoyée sans l\'élément, ou fiche restée ouverte');
      await settle(80);
      check(!(await serverSeps()).t.items.some((i) => i.title === 'Amérique du Nord') && layout() === '[Continent] Afrique Europe | [Sous-continent] Supercontinent Pangée', 'après le retrait : ' + layout());
      const toast = d.querySelectorAll('.toast')[0];
      check(toast && text(toast).includes('« Amérique du Nord » retirée de « Continents ».'), 'message du retrait absent : ' + (toast ? text(toast) : ''));
      toast.querySelectorAll('button').find((b) => text(b) === 'Annuler').click();
      check(await until(async () => (await serverSeps()).t.items.length === 7), '« Annuler » : élément non remis');
      await settle(80);
      check((await serverSeps()).seps === 'Continent, Sous-continent, Amérique du Nord' && layout() === '[Continent] Afrique Europe | [Sous-continent] | [Amérique du Nord] Supercontinent Pangée',
        '« Annuler » : élément remis ailleurs ou sans son intercalaire : ' + layout());
    }
    // Depuis « Mes cartes », la fiche n'a pas la case (aucun album ouvert là).
    d.getElementById('tab-cartes').click();
    await settle();
    d.querySelectorAll('.card').find((c) => text(c.querySelector('.card__title')) === 'Pangée').click();
    await settle(80);
    check(d.querySelectorAll('.fiche').length === 1 && !d.querySelectorAll('.sep-toggle').length, 'fiche ouverte depuis « Mes cartes » : pas de case « Intercalaire »');
    d.querySelectorAll('.fiche')[0].querySelector('.close').click();
    await settle(400);
    // Chez Olga (lecture seule) : sa collection complète (ligne et en-tête dorés), ses intercalaires et ses sections.
    d.getElementById('tab-amis').click();
    check(await waitFor(() => !!d.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'Parcourir le classeur de Olga'), 5000), 'intercalaires : Olga absente d\'« Entre amis »');
    d.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'Parcourir le classeur de Olga').click();
    check(await waitFor(() => !!rowOf("Continents d'Olga"), 5000), 'collections d\'Olga absentes');
    check(rowOf("Continents d'Olga").classList.contains('complete') && text(rowOf("Continents d'Olga")).includes('Complète'), 'collection complète d\'Olga : ligne dorée attendue, ' + text(rowOf("Continents d'Olga")));
    rowOf("Continents d'Olga").click();
    await settle(80);
    check(d.querySelectorAll('.album-title')[0].classList.contains('complete') && layout() === '[Continent] Afrique Europe | [Sous-continent] Amérique du Nord | [Supercontinent] Pangée',
      'album d\'Olga : en-tête doré et intercalaires attendus, ' + layout());
    check(!d.querySelectorAll('.sep-toggle').length && !d.querySelectorAll('button').some((b) => text(b).includes('Réorganiser')), 'album d\'Olga : rien à modifier (ni à réorganiser)');
    {
      const tab = d.querySelectorAll('.sec-fold').find((x) => (x.getAttribute('aria-label') || '').includes('« Sous-continent »'));
      tab.click();
      await settle();
      check(layout() === '[Continent] Afrique Europe | [Sous-continent] | [Supercontinent] Pangée', 'album d\'Olga : section repliée, ' + layout());
      d.querySelectorAll('.sec-fold').find((x) => (x.getAttribute('aria-label') || '').includes('« Sous-continent »')).click();
      await settle();
    }
  }

  // Propositions d'après les cartes, sans les sous-catégories (Iris : 8 cartes de couleurs). Rouge, Vert et Jaune sont
  // des sous-catégories de Couleur, toutes proposables (2 cartes chacune, au moins 5 %).
  {
    const keyI = await makeOtherAccount('Iris');
    const mk1 = (id, title) => ({ id, title, rarity: 'C', atk: 1, def: 1, quality: 1, pageviews: 10, category: 'couleur', image: null, url: null, count: 1, shiny: false, starred: false, obtained_at: '2026-10-01T00:00:00Z' });
    await seedCards(keyI, Object.keys(CARD_CATS).map((t, i) => mk1('i' + i, t)));
    ls.set('classeur-key', keyI);
    ls.set('classeur-known', JSON.stringify([{ key: keyI, name: 'Iris' }]));
    const proposedIn = (d) => d.querySelectorAll('.row').filter((n) => n.classList.contains('wp')).map((n) => text(n.querySelector('.name')));
    const openIris = async () => {
      const pg = openPage({ idb: 'absent' });
      check(await waitFor(() => pg.count() === 8), 'propositions : classeur d\'Iris non ouvert');
      pg.doc.getElementById('tab-collections').click();
      await settle();
      await openNewIn(pg.doc, 'props');
      return pg;
    };
    const pt = (d) => text(d.body);
    const btnIn = (d, t) => d.querySelectorAll('button').find((b) => text(b).trim() === t) || null;
    const ariaBtn = (d, t) => d.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === t) || null;
    const atIn = (d) => (d.querySelectorAll('.album-title').length ? text(d.querySelectorAll('.album-title')[0]) : '');
    const coveredIn = (d) => { const n = d.querySelectorAll('.wp-covered')[0]; return n ? text(n) : ''; };
    const targetsOf = async (key) => (await rawApi('GET', '/api/targets', key)).body.targets;
    const searchCat = async (d, q) => { await openNewIn(d, 'url'); const cq = d.getElementById('cat-q'); cq.value = q; cq.dispatch('input'); cq.dispatch('keydown', { key: 'Enter' }); };
    const ready = (d) => !d.querySelectorAll('.wp-progress').length;
    // 1. Couleur est proposée : ses sous-catégories, proposables aussi, ne le sont pas une à une ; Couleur les regroupe
    // (« Regroupe 3 sous-catégories proposées ») et son album s'ouvre sous-catégories comprises.
    let p = await openIris();
    check(await waitFor(() => proposedIn(p.doc).length > 0 && ready(p.doc), 8000), 'propositions d\'Iris absentes');
    check(proposedIn(p.doc).join('|') === 'Couleur', 'parente proposée : seule « Couleur » attendue, ' + proposedIn(p.doc).join(' | '));
    check(['Rouge', 'Vert', 'Jaune', 'Couleur'].every((c) => parentCalls.includes('Catégorie:' + c)), 'catégories parentes non demandées : ' + parentCalls.join(', '));
    check(text(p.doc.querySelectorAll('.row-why')[0]) === 'Tu as : Arc-en-ciel et Spectre visible', 'pourquoi la catégorie est proposée : ' + text(p.doc.querySelectorAll('.row-why')[0]));
    {
      const line = p.doc.querySelectorAll('.row-subs')[0];
      check(line && text(line) === 'Regroupe 3 sous-catégories proposées : Jaune, Rouge et Vert. La collection est créée sous-catégories comprises.',
        'sous-catégories regroupées sous « Couleur » : ' + (line ? text(line) : 'absent'));
    }
    p.doc.querySelectorAll('.row-open')[0].click();
    check(await waitFor(() => atIn(p.doc).includes('Couleur') && atIn(p.doc).includes('8 sur 8')), 'album de « Couleur » ouvert depuis la proposition : sous-catégories comprises attendues, ' + atIn(p.doc));
    {
      const box = p.doc.querySelectorAll('input').find((n) => n.getAttribute('type') === 'checkbox' && n.parentNode.classList.contains('check'));
      check(box && box.checked === true, 'album de « Couleur » : case des sous-catégories cochée attendue');
    }
    btnIn(p.doc, '← Toutes les collections').click();
    await settle();
    await openNewIn(p.doc, 'props');
    // « Créer une collection » sur la proposition : ses 2 articles et les 6 de ses sous-catégories ; plus rien n'est
    // proposé, et la page dit pourquoi (les 3 sous-catégories sont couvertes par la nouvelle collection).
    ariaBtn(p.doc, 'Créer une collection « Couleur »').click();
    check(await waitFor(() => pt(p.doc).includes('Collection « Couleur » créée : 8 articles, sous-catégories comprises, dans « Mes collections ».')), 'collection « Couleur » (proposition) non créée');
    {
      const tc = (await targetsOf(keyI)).find((t) => t.source === 'wp:Couleur');
      check(tc && tc.items.map((i) => i.title).sort().join('|') === Object.keys(CARD_CATS).sort().join('|'), 'collection « Couleur » : ses articles et ceux de ses sous-catégories attendus, ' + JSON.stringify(tc && tc.items.map((i) => i.title)));
      check(await waitFor(() => !proposedIn(p.doc).length && coveredIn(p.doc) === 'Pas de nouvelle proposition : 3 catégories de tes cartes sont écartées car déjà couvertes par « Couleur » (au moins 80 % de leurs cartes y sont déjà).')
        && !pt(p.doc).includes('Pas de proposition pour l\'instant'), 'propositions couvertes : message attendu, ' + coveredIn(p.doc) + ' / ' + proposedIn(p.doc).join(' | '));
      check((await rawApi('POST', '/api/targets/delete', keyI, { id: tc.id })).status === 200, 'suppression de « Couleur » refusée');
    }
    // 2. Couleur retirée : elle n'est plus proposée, ses sous-catégories le sont.
    p = await openIris();
    check(await waitFor(() => proposedIn(p.doc).join('|') === 'Couleur' && ready(p.doc), 8000), 'collection supprimée : « Couleur » de nouveau proposée attendue, ' + proposedIn(p.doc).join(' | '));
    p.doc.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'Retirer « Couleur » des propositions').click();
    await settle();
    p.doc.querySelectorAll('.modal')[0].querySelectorAll('button').filter((b) => text(b).trim() === 'Retirer des propositions')[0].click();
    check(await waitFor(() => proposedIn(p.doc).join('|') === 'Jaune|Rouge|Vert'), 'parente retirée : ses sous-catégories attendues, ' + proposedIn(p.doc).join(' | '));
    check(!p.doc.querySelectorAll('.row-subs').length, 'parente retirée : plus rien de regroupé');
    // 3. Une collection « Couleurs » contient déjà mes cartes rouges et vertes, et une des deux jaunes : Rouge et Vert sont
    // « couvertes » (100 %), pas Jaune (50 % < 80 %) ; la page le dit.
    check((await rawApi('POST', '/api/targets/save', keyI, { name: 'Couleurs', items: ['Coquelicot', 'Fraise', 'Pomme verte', 'Menthe', 'Citron']
      .map((title) => ({ title, description: null, image: null, status: 'ok' })) })).status === 200, 'collection « Couleurs » refusée');
    p = await openIris();
    check(await waitFor(() => proposedIn(p.doc).length > 0 && ready(p.doc), 8000) && proposedIn(p.doc).join('|') === 'Jaune',
      'couvertes par « Couleurs » : seule « Jaune » attendue, ' + proposedIn(p.doc).join(' | '));
    check(coveredIn(p.doc) === '2 autres catégories de tes cartes écartées car déjà couvertes par « Couleurs ».', 'couvertes : message attendu, ' + coveredIn(p.doc));
    // 4. Une collection faite de « Catégorie:Couleur » SANS ses sous-catégories n'a pas les articles de Jaune (sur
    // Wikipédia, un article est rangé dans la catégorie la plus précise) : Jaune reste proposée.
    await searchCat(p.doc, 'couleur');
    check(await waitFor(() => atIn(p.doc).includes('Couleur') && atIn(p.doc).includes('2 sur 2')), 'album de « Couleur » (recherche, sans sous-catégories) : ' + atIn(p.doc));
    check(await waitFor(() => p.doc.querySelectorAll('button').some((b) => text(b).includes('Créer une collection') && !b.disabled)), '« Créer une collection » indisponible');
    p.doc.querySelectorAll('button').find((b) => text(b).includes('Créer une collection')).click();
    check(await waitFor(() => atIn(p.doc).includes('depuis la catégorie Wikipédia') && !!btnIn(p.doc, 'Supprimer')), 'collection « Couleur » non créée : ' + atIn(p.doc));
    if (!SERVER) check(api.users.find((u) => u.key === keyI).targets.some((t) => t.source === 'wp:Couleur' && t.items.length === 2), 'collection « Couleur » (2 articles) mal enregistrée');
    btnIn(p.doc, '← Toutes les collections').click();
    await settle();
    await openNewIn(p.doc, 'props');
    check(proposedIn(p.doc).join('|') === 'Jaune', 'parente en collection sans ses sous-catégories : « Jaune » doit rester proposée, ' + proposedIn(p.doc).join(' | '));
    // 5. Supprimée (confirmation), puis refaite AVEC ses sous-catégories : Jaune est couverte, plus rien n'est proposé.
    await closeNewIn(p.doc);
    p.doc.querySelectorAll('.row').find((n) => (n.getAttribute('aria-label') || '').startsWith('Couleur :')).click();
    await settle(80);
    btnIn(p.doc, 'Supprimer').click();
    await settle();
    btnIn(p.doc.querySelectorAll('.modal')[0], 'Supprimer la collection').click();
    check(await waitFor(() => !atIn(p.doc) && !p.doc.querySelectorAll('.row').some((n) => (n.getAttribute('aria-label') || '').startsWith('Couleur :'))), 'collection « Couleur » non supprimée');
    await searchCat(p.doc, 'couleur');
    check(await waitFor(() => atIn(p.doc).includes('2 sur 2') && !!btnIn(p.doc, 'Créer une collection')), 'album de « Couleur » : ' + atIn(p.doc));
    p.doc.querySelectorAll('input').find((n) => n.getAttribute('type') === 'checkbox' && n.parentNode.classList.contains('check')).dispatch('change');
    check(await waitFor(() => atIn(p.doc).includes('8 sur 8')), 'avec ses sous-catégories : 8 sur 8 attendu, ' + atIn(p.doc));
    btnIn(p.doc, 'Créer une collection').click();
    check(await waitFor(() => atIn(p.doc).includes('depuis la catégorie Wikipédia')), 'collection « Couleur » (sous-catégories comprises) non créée');
    btnIn(p.doc, '← Toutes les collections').click();
    await settle();
    await openNewIn(p.doc, 'props');
    check(!proposedIn(p.doc).length && coveredIn(p.doc) === 'Pas de nouvelle proposition : 3 catégories de tes cartes sont écartées car déjà couvertes par tes collections, surtout « Couleurs » (au moins 80 % de leurs cartes y sont déjà).',
      'parente en collection avec ses sous-catégories : rien de proposé attendu, ' + proposedIn(p.doc).join(' | ') + ' / ' + coveredIn(p.doc));

    // Courses (Jade : cartes rouges et jaunes, Rouge et Jaune proposées ; Kim : cartes vertes), réponses de Wikipédia
    // (wikiHold) ou de GET /api/me (hold) retenues.
    const keyJ = await makeOtherAccount('Jade');
    const keyK = await makeOtherAccount('Kim');
    await seedCards(keyJ, ['Coquelicot', 'Fraise', 'Citron', 'Banane'].map((t, i) => mk1('j' + i, t)));
    await seedCards(keyK, ['Pomme verte', 'Menthe'].map((t, i) => mk1('k' + i, t)));
    const known = JSON.stringify([{ key: keyJ, name: 'Jade' }, { key: keyK, name: 'Kim' }]);
    const gates = [];
    const wikiSeen = [];
    let holdIf = null; // (adresse décodée) => vrai : réponse de Wikipédia retenue jusqu'à release()
    const wikiHold = (url) => { const u = decodeURIComponent(url); wikiSeen.push(u); return holdIf && holdIf(u) ? new Promise((r) => gates.push(r)) : null; };
    const release = () => { holdIf = null; while (gates.length) gates.shift()(); };
    let meHold = false;
    const meGates = [];
    const hold = (url) => (meHold && url === '/api/me' ? new Promise((r) => meGates.push(r)) : null);
    const tabIn = (d) => { const t = d.querySelectorAll('button').find((n) => (n.getAttribute('id') || '').startsWith('tab-') && n.getAttribute('aria-selected') === 'true'); return t ? t.getAttribute('id') : null; };
    const openJade = async (wantProposals = true) => {
      ls.set('classeur-key', keyJ);
      ls.set('classeur-known', known);
      const pg = openPage({ idb: 'absent', wikiHold, hold });
      check(await waitFor(() => pg.count() === 4), 'classeur de Jade non ouvert');
      pg.doc.getElementById('tab-collections').click();
      await settle();
      if (wantProposals) await openNewIn(pg.doc, 'props');
      if (wantProposals) check(await waitFor(() => proposedIn(pg.doc).length > 0 && ready(pg.doc), 8000), 'propositions de Jade absentes');
      return pg;
    };
    // A. « Créer une collection », puis changement de classeur pendant la lecture des articles : rien n'est enregistré
    // (ni chez Kim, où la page est passée, ni chez Jade), et le classeur de Kim n'a que ses propositions.
    let pj = await openJade();
    check(proposedIn(pj.doc).join('|') === 'Jaune|Rouge', 'propositions de Jade : ' + proposedIn(pj.doc).join(' | '));
    holdIf = (u) => u.includes('list=categorymembers') && u.includes('Catégorie:Rouge');
    ariaBtn(pj.doc, 'Créer une collection « Rouge »').click();
    check(await waitFor(() => gates.length === 1), 'lecture des articles de « Rouge » attendue');
    pj.doc.getElementById('tab-reglages').click();
    await settle();
    btnIn(pj.doc, 'Ouvrir').click();
    check(await waitFor(() => text(pj.doc.querySelector('h1')) === 'Le classeur de Kim' && pj.count() === 2), 'classeur de Kim non ouvert : ' + text(pj.doc.querySelector('h1')));
    release();
    await settle(200);
    check(!(await targetsOf(keyK)).some((t) => t.source === 'wp:Rouge') && !(await targetsOf(keyJ)).some((t) => t.source === 'wp:Rouge'),
      'collection créée dans le classeur de Jade, enregistrée après le changement de classeur : ' + JSON.stringify((await targetsOf(keyK)).map((t) => t.source)));
    pj.doc.getElementById('tab-collections').click();
    await settle();
    await openNewIn(pj.doc, 'props');
    check(await waitFor(() => proposedIn(pj.doc).join('|') === 'Vert' && ready(pj.doc)), 'classeur de Kim : seule « Vert » attendue, ' + proposedIn(pj.doc).join(' | '));
    // E. « Masquer les propositions » pendant un calcul (caches vidés : il doit tout redemander) : il s'arrête, plus rien
    // n'est demandé à Wikipédia ; « Afficher » le relance.
    for (const k of ['classeur-cats', 'classeur-catinfo', 'classeur-catparents']) ls.delete(k);
    holdIf = (u) => u.includes('prop=categories') && !u.includes('titles=Catégorie:');
    const pe = await openJade(false);
    await openNewIn(pe.doc, 'props');
    check(await waitFor(() => gates.length === 1 && pe.doc.querySelectorAll('.wp-progress').length === 1), 'calcul des propositions en cours attendu');
    const mark = wikiSeen.length;
    btnIn(pe.doc, 'Masquer les propositions').click();
    await settle(100);
    release();
    await settle(300);
    const after = wikiSeen.slice(mark).filter((u) => /prop=categor/.test(u));
    check(!after.length && pt(pe.doc).includes('Propositions masquées.'), 'masquées pendant le calcul : Wikipédia encore interrogé, ' + after.join(' ; '));
    const mark2 = wikiSeen.length;
    btnIn(pe.doc, 'Afficher les propositions').click();
    check(await waitFor(() => ready(pe.doc) && wikiSeen.slice(mark2).some((u) => u.includes('prop=categories') && !u.includes('titles=Catégorie:'))), 'propositions affichées : le calcul doit reprendre');
    // B. « Créer une collection » sur la proposition, puis son album ouvert pendant la lecture : le bouton de l'album
    // attend (« Un instant… »), puis l'album devient celui de la collection ; une seule collection de source wp:Rouge.
    pj = await openJade();
    holdIf = (u) => u.includes('list=categorymembers') && u.includes('Catégorie:Rouge') && u.includes('cmnamespace=0&cmlimit=500'); // propose.js seul
    ariaBtn(pj.doc, 'Créer une collection « Rouge »').click();
    check(await waitFor(() => gates.length === 1), 'lecture des articles de « Rouge » (proposition) attendue');
    pj.doc.querySelectorAll('.row-open').find((b) => text(b) === 'Rouge').click();
    check(await waitFor(() => atIn(pj.doc).includes('Rouge') && atIn(pj.doc).includes('2 sur 2')), 'album de « Rouge » pendant la création : ' + atIn(pj.doc));
    {
      const b = pj.doc.querySelectorAll('button').find((n) => /Créer une collection|Un instant/.test(text(n)) && !n.getAttribute('aria-label'));
      check(b && text(b).includes('Un instant…') && b.disabled, 'album pendant la création depuis la proposition : bouton en attente attendu, ' + (b ? text(b) + (b.disabled ? ' (désactivé)' : '') : 'absent'));
      b.click(); // désactivé : sans effet
    }
    release();
    check(await waitFor(() => atIn(pj.doc).includes('Rouge') && atIn(pj.doc).includes('depuis la catégorie Wikipédia')), 'l\'album doit passer à la collection créée : ' + atIn(pj.doc));
    check((await targetsOf(keyJ)).filter((t) => t.source === 'wp:Rouge').length === 1, 'deux collections de source wp:Rouge');
    btnIn(pj.doc, '← Toutes les collections').click();
    await settle();
    // C. Entrée avant l'arrivée des suggestions, puis on passe à « Mes cartes » (ou on quitte le champ) : à leur arrivée,
    // aucune catégorie ne s'ouvre.
    for (const [how, q] of [['onglet', 'rouge'], ['champ quitté', 'jaune']]) {
      holdIf = (u) => u.includes('generator=prefixsearch');
      await searchCat(pj.doc, q);
      check(await waitFor(() => gates.length === 1), `Entrée (${how}) : recherche partie tout de suite attendue`);
      if (how === 'onglet') pj.doc.getElementById('tab-cartes').click(); else pj.doc.getElementById('cat-q').dispatch('blur');
      await settle();
      release();
      await settle(300);
      check(!atIn(pj.doc) && tabIn(pj.doc) === (how === 'onglet' ? 'tab-cartes' : 'tab-collections'), `Entrée en attente (${how}) : aucune catégorie ne doit s'ouvrir, ${atIn(pj.doc)} / ${tabIn(pj.doc)}`);
      if (how === 'onglet') { pj.doc.getElementById('tab-collections').click(); await settle(); }
    }
    // D. Relecture de GET /api/me (retour sur l'onglet) partie avant « Retirer » et revenue après : le retrait reste.
    meHold = true;
    pj.visible();
    check(await waitFor(() => meGates.length === 1), 'GET /api/me retenue attendue');
    meHold = false;
    await openNewIn(pj.doc, 'props');
    ariaBtn(pj.doc, 'Retirer « Jaune » des propositions').click();
    await settle();
    btnIn(pj.doc.querySelectorAll('.modal')[0], 'Retirer des propositions').click();
    check(await waitFor(() => !proposedIn(pj.doc).includes('Jaune') && !!btnIn(pj.doc, 'Rétablir la proposition retirée')), 'proposition « Jaune » non retirée');
    meGates.shift()();
    await settle(200);
    check(!!btnIn(pj.doc, 'Rétablir la proposition retirée') && !proposedIn(pj.doc).includes('Jaune'), 'GET /api/me revenue après « Retirer » : le retrait a été défait');
    check(JSON.stringify((await rawApi('GET', '/api/me', keyJ)).body.prefs.hidden_proposals) === '["wp:Jaune"]', 'retrait de « Jaune » non enregistré');
    // F. Anciennes collections du catalogue : « vaches » n'avait pas d'ordre (de A à Z, sans numéros), « planetes » oui.
    const it = (l) => l.map((title) => ({ title, description: null, image: null, status: 'ok' }));
    await rawApi('POST', '/api/targets/save', keyJ, { name: 'Vaches du catalogue', source: 'catalog:vaches', items: it(['Salers', 'Aubrac', 'Charolaise']) });
    await rawApi('POST', '/api/targets/save', keyJ, { name: 'Planètes du catalogue', source: 'catalog:planetes', items: it(['Mercure (planète)', 'Vénus (planète)', 'Terre']) });
    const pf = await openJade(false);
    for (const [name, ordered] of [['Vaches du catalogue', false], ['Planètes du catalogue', true]]) {
      pf.doc.querySelectorAll('.row').find((n) => (n.getAttribute('aria-label') || '').startsWith(name + ' :')).click();
      await settle(80);
      const sortBtn = pf.doc.querySelectorAll('button').find((b) => ['Ordre', 'A → Z'].includes(text(b).trim()));
      check(sortBtn && text(sortBtn).trim() === (ordered ? 'Ordre' : 'A → Z') && !!pf.doc.querySelectorAll('.slot__no').length === ordered,
        `${name} : ${ordered ? 'dans l\'ordre, numérotée' : 'de A à Z, sans numéros'} attendue, ${sortBtn ? text(sortBtn) : '?'} / ${pf.doc.querySelectorAll('.slot__no').length} numéros`);
      btnIn(pf.doc, '← Toutes les collections').click();
      await settle();
    }
    // G. Relecture périodique (60 s) pendant la résolution des qids de l'album ouvert : elle ne la coupe pas. Léo a la
    // carte « Néon (gaz) », même élément que « Néon » de la catégorie « Gaz noble » ; sa collection « Inconnus » a des
    // titres dont le qid n'est pas encore connu (résolus après chaque chargement des cartes).
    {
      const keyL = await makeOtherAccount('Léo');
      await seedCards(keyL, [mk1('l0', 'Néon (gaz)')]);
      await rawApi('POST', '/api/targets/save', keyL, { name: 'Inconnus', items: it(['Inconnu 1', 'Inconnu 2']) });
      ls.set('classeur-key', keyL);
      ls.set('classeur-known', JSON.stringify([{ key: keyL, name: 'Léo' }]));
      holdIf = (u) => u.includes('ppprop=wikibase_item'); // toutes les résolutions de qids attendent
      const pl = openPage({ idb: 'absent', wikiHold, hold });
      check(await waitFor(() => pl.count() === 1), 'classeur de Léo non ouvert');
      pl.doc.getElementById('tab-collections').click();
      await settle();
      await searchCat(pl.doc, 'gaz noble');
      check(await waitFor(() => atIn(pl.doc).includes('Gaz noble') && atIn(pl.doc).includes('0 sur 3')), 'album « Gaz noble » : ' + atIn(pl.doc));
      await rawApi('POST', '/api/tags/set', keyL, { card_id: 'l0', tags: ['Gaz'] }); // cards_rev avance : la relecture recharge
      await pl.live();
      await settle(100);
      release();
      check(await waitFor(() => atIn(pl.doc).includes('1 sur 3'), 5000), 'qids de l\'album coupés par la relecture périodique : « Néon » doit compter pour « Néon (gaz) », ' + atIn(pl.doc));
    }
  }

  // 30. Chat : un salon pour tous les classeurs. Maëlle (une page du classeur) et Noa (un autre compte, par l'API) :
  // badge des non-lus (GET /api/me au retour sur la page), ouverture (auteur, heure, lien cliquable), Entrée envoie et
  // Maj+Entrée va à la ligne, « (toi) », lien personnel refusé avant l'envoi, suppression de son message seulement
  // (confirmation), propagée aux autres pages par la relecture, 429 lisible, messages plus anciens, relecture minutée.
  {
    const keyM = await makeOtherAccount('Maëlle');
    const keyN = await makeOtherAccount('Noa');
    const meM = (await rawApi('GET', '/api/me', keyM)).body.user.id;
    ls.set('classeur-key', keyM);
    ls.set('classeur-known', JSON.stringify([{ key: keyM, name: 'Maëlle' }]));
    const pc = openPage({ idb: 'absent' });
    const d = pc.doc;
    const hasIn = (t) => text(d.body).includes(t);
    const tab = (id) => d.getElementById('tab-' + id);
    const msgs = () => d.querySelectorAll('.chat-msg');
    const badgeOf = (doc) => { const t = doc.getElementById('tab-chat'); const b = t && t.querySelector('.tab-badge'); return b ? text(b) : ''; };
    const badge = () => badgeOf(d);
    const field = () => d.getElementById('chat-input');
    const chatCalls = (from) => apiLog.slice(from).filter((x) => /^(GET|POST|DELETE) \/api\/chat\b/.test(x));
    check(await waitFor(() => tab('chat') && hasIn('Le classeur de Maëlle')), 'classeur de Maëlle non ouvert');
    check(text(tab('chat')) === 'Chat' && badge() === '', 'onglet « Chat » absent, ou badge sans message : ' + text(tab('chat')));
    // Noa écrit pendant que Maëlle est ailleurs : au retour sur la page, GET /api/me annonce un message, la page le lit.
    const n1 = await rawApi('POST', '/api/chat', keyN, { text: 'Salut tout le monde ! Ma liste : https://fr.wikipedia.org/wiki/Mercure_(planète).' });
    check(n1.status === 201, 'envoi de Noa refusé : ' + JSON.stringify(n1.body));
    let from = apiLog.length;
    await pc.visible();
    check(await waitFor(() => badge() === '1 message non lu'), 'badge des non-lus absent : « ' + badge() + ' » / ' + apiLog.slice(from).join(', '));
    check(chatCalls(from).join() === 'GET /api/chat', 'une lecture du chat attendue pour le badge : ' + chatCalls(from).join(', '));
    // Rien de nouveau : la relecture de GET /api/me (toutes les 60 s) ne relit pas le chat.
    from = apiLog.length;
    await pc.live();
    await settle(60);
    check(apiLog.slice(from).includes('GET /api/me') && !chatCalls(from).length, 'chat relu sans nouveau message : ' + apiLog.slice(from).join(', '));
    // Ouverture : message de Noa (auteur, heure, lien cliquable), sans bouton Supprimer ; badge parti, dernier lu gardé.
    tab('chat').click();
    await settle();
    check(hasIn('Visible par tous les membres du classeur'), 'mention « Visible par tous les membres du classeur » absente');
    check(await waitFor(() => msgs().length === 1), 'message de Noa absent');
    const m0 = msgs()[0];
    check(text(m0.querySelector('.chat-msg__who')) === 'Noa' && !m0.classList.contains('mine') && !m0.querySelector('.chat-msg__me'), 'auteur du message de Noa : ' + text(m0));
    check(/^\d{2}:\d{2}$/.test(text(m0.querySelector('time'))), 'heure du message : ' + text(m0.querySelector('time')));
    const link = m0.querySelector('a');
    check(link && link.getAttribute('href') === 'https://fr.wikipedia.org/wiki/Mercure_(plan%C3%A8te)' && text(link) === 'https://fr.wikipedia.org/wiki/Mercure_(planète)'
      && /\bnoopener\b/.test(link.getAttribute('rel') || '') && link.getAttribute('target') === '_blank', 'lien du message : ' + (link && link.getAttribute('href')));
    check(text(m0.querySelector('.chat-msg__text')).endsWith('Mercure_(planète).') && !m0.querySelector('.chat-msg__del'), "point final hors du lien ; pas de suppression du message d'un autre");
    check(badge() === '', 'badge encore affiché, onglet ouvert');
    check(JSON.parse(ls.get('classeur-chat-lu') || '{}')[meM] === n1.body.message.id, 'dernier lu non gardé : ' + ls.get('classeur-chat-lu'));
    // Maj+Entrée : pas d'envoi (le navigateur va à la ligne) ; Entrée : envoi, « (toi) », retours à la ligne gardés, champ vidé.
    check(field() && field().getAttribute('maxlength') === '500', 'champ du message absent, ou sans limite de 500');
    type(field(), 'Bonjour Noa');
    from = apiLog.length;
    let ev = field().dispatch('keydown', { key: 'Enter', shiftKey: true });
    await settle();
    check(!ev.defaultPrevented && !chatCalls(from).some((x) => x.startsWith('POST')), 'Maj+Entrée ne doit rien envoyer');
    type(field(), 'Bonjour Noa\nça va ?');
    ev = field().dispatch('keydown', { key: 'Enter' });
    check(ev.defaultPrevented, 'Entrée doit envoyer, sans aller à la ligne');
    check(await waitFor(() => msgs().length === 2), "mon message n'apparaît pas");
    const mine = msgs()[1];
    check(mine.classList.contains('mine') && text(mine.querySelector('.chat-msg__who')) === 'Maëlle' && text(mine.querySelector('.chat-msg__me')) === '(toi)', 'mention « (toi) » absente : ' + text(mine));
    check(text(mine.querySelector('.chat-msg__text')) === 'Bonjour Noa\nça va ?' && field().value === '', 'retour à la ligne perdu, ou champ non vidé');
    check(chatCalls(from).filter((x) => x === 'POST /api/chat').length === 1, 'un seul envoi attendu : ' + chatCalls(from).join(', '));
    // Champ vide : Entrée n'envoie rien ; lien personnel : refusé avant tout envoi.
    from = apiLog.length;
    field().dispatch('keydown', { key: 'Enter' });
    type(field(), 'mon lien ' + ORIGIN + '/#cle=' + keyM);
    field().dispatch('keydown', { key: 'Enter' });
    await settle();
    check(hasIn('lien personnel de classeur') && !chatCalls(from).some((x) => x.startsWith('POST')), 'champ vide ou lien personnel : rien ne doit partir');
    type(field(), '');
    // Chez Noa : mon message, sans « (toi) » ; elle ne peut pas le supprimer (403). Elle supprime le sien : il disparaît de
    // la page de Maëlle à la relecture suivante (retour sur la page, chat ouvert).
    const seenByN = (await rawApi('GET', '/api/chat', keyN)).body.messages.find((m) => m.text.startsWith('Bonjour Noa'));
    check(seenByN && seenByN.author === 'Maëlle' && seenByN.mine === false, 'mon message vu par Noa : ' + JSON.stringify(seenByN));
    check((await rawApi('DELETE', '/api/chat/' + seenByN.id, keyN)).status === 403, 'Noa ne doit pas pouvoir supprimer mon message');
    check((await rawApi('DELETE', '/api/chat/' + n1.body.message.id, keyN)).status === 200, 'suppression du message de Noa refusée');
    await pc.visible();
    check(await waitFor(() => msgs().length === 1 && !hasIn('Salut tout le monde')), 'message supprimé par Noa encore affiché');
    // Suppression du mien, avec confirmation.
    msgs()[0].querySelector('.chat-msg__del').click();
    await settle();
    const modal = d.querySelectorAll('.modal')[0];
    check(modal && text(modal).includes('disparaîtra du chat pour tout le monde'), 'confirmation de suppression absente');
    modal.querySelectorAll('button').find((b) => text(b).trim() === 'Supprimer').click();
    check(await waitFor(() => !msgs().length && hasIn("Aucun message pour l'instant")), 'mon message supprimé reste affiché');
    check(!(await rawApi('GET', '/api/chat', keyN)).body.messages.length, 'suppression non faite côté serveur');
    // Ailleurs : mon propre message (autre appareil) ne compte pas ; un message de Noa → badge ; onglet ouvert → lu.
    tab('cartes').click();
    await settle();
    await rawApi('POST', '/api/chat', keyM, { text: 'Depuis mon téléphone' });
    from = apiLog.length;
    await pc.visible();
    check(await waitFor(() => chatCalls(from).length > 0), 'nouveau message annoncé par GET /api/me : le chat doit être relu');
    await settle(60);
    check(badge() === '', 'mon propre message ne doit pas compter comme non lu : ' + badge());
    await rawApi('POST', '/api/chat', keyN, { text: 'Tu es là ?' });
    await pc.live();
    check(await waitFor(() => badge() === '1 message non lu'), 'badge après un nouveau message de Noa : « ' + badge() + ' »');
    tab('chat').click();
    check(await waitFor(() => badge() === '' && hasIn('Tu es là ?') && hasIn('Depuis mon téléphone')), "messages à l'ouverture, ou badge resté");
    // Répondre : bandeau au-dessus du champ, Échap l'annule ; l'envoi porte reply_to, la bulle montre le message cité.
    const byText = (t) => msgs().find((m) => text(m.querySelector('.chat-msg__text')) === t);
    const asked = byText('Tu es là ?');
    check(asked && asked.querySelector('.chat-msg__reply') && !asked.querySelector('.chat-quote'), 'bouton « Répondre » absent, ou citation sur un message sans réponse');
    asked.querySelector('.chat-msg__reply').click();
    await settle();
    const bar = () => d.querySelector('.chat-replying');
    check(bar() && text(bar()).includes('Réponse à Noa') && text(bar()).includes('Tu es là ?') && field().getAttribute('placeholder') === 'Ta réponse…', 'bandeau de réponse : ' + text(bar()));
    field().dispatch('keydown', { key: 'Escape' });
    await settle();
    check(!bar(), 'Échap doit annuler la réponse');
    asked.querySelector('.chat-msg__reply').click();
    await settle();
    type(field(), 'Oui, je suis là');
    from = apiLog.length;
    field().dispatch('keydown', { key: 'Enter' });
    check(await waitFor(() => byText('Oui, je suis là')), 'réponse non affichée');
    const answered = byText('Oui, je suis là');
    const quote = answered.querySelector('.chat-quote');
    check(quote && text(quote.querySelector('.chat-quote__who')) === 'Noa' && text(quote.querySelector('.chat-quote__text')) === 'Tu es là ?' && !bar() && field().value === '',
      'citation de la réponse : ' + text(answered) + ' / bandeau ' + text(bar()));
    const seenAnswer = (await rawApi('GET', '/api/chat', keyN)).body.messages.find((m) => m.text === 'Oui, je suis là');
    check(seenAnswer && seenAnswer.reply && seenAnswer.reply.id === Number(asked.getAttribute('id').slice(7)) && seenAnswer.reply.mine === true, 'reply_to non envoyé : ' + JSON.stringify(seenAnswer));
    // Noa répond à mon message : mis en avant, « te répond » ; puis elle supprime le sien : « message supprimé ».
    await rawApi('POST', '/api/chat', keyN, { text: 'Super', reply_to: seenAnswer.id });
    await pc.visible();
    check(await waitFor(() => byText('Super') && byText('Super').classList.contains('ping') && text(byText('Super')).includes('te répond')), 'réponse à mon message non mise en avant');
    check(text(byText('Super').querySelector('.chat-quote')).includes('Maëlle (toi)'), 'citation de mon message : ' + text(byText('Super').querySelector('.chat-quote')));
    await rawApi('DELETE', '/api/chat/' + seenAnswer.reply.id, keyN);
    await pc.visible();
    check(await waitFor(() => !hasIn('Tu es là ?') && text(byText('Oui, je suis là').querySelector('.chat-quote')) === 'En réponse à un message supprimé'), 'citation d\'un message supprimé');
    // Réactions : « Réagir » ouvre le choix, Échap le ferme ; un emoji choisi devient une pastille (la mienne marquée) et
    // part au serveur ; Noa réagit aussi : la relecture ?after met la pastille à jour (2, « Noa et toi »), sans « nouveau
    // message » ; un clic sur la pastille retire la mienne.
    const superMsg = () => byText('Super');
    check(superMsg().querySelector('.chat-msg__react') && !superMsg().querySelector('.chat-reacts') && !superMsg().querySelector('.chat-pick'), 'bouton « Réagir » absent, ou réactions sans réaction');
    superMsg().querySelector('.chat-msg__react').click();
    await settle();
    const pick = () => superMsg().querySelector('.chat-pick');
    check(pick() && pick().querySelectorAll('button').length === 8 && superMsg().querySelector('.chat-msg__react').getAttribute('aria-expanded') === 'true', 'choix des réactions non ouvert');
    pick().dispatch('keydown', { key: 'Escape' });
    await settle();
    check(!pick(), 'Échap doit fermer le choix des réactions');
    superMsg().querySelector('.chat-msg__react').click();
    await settle();
    from = apiLog.length;
    [...pick().querySelectorAll('button')].find((b) => text(b) === '🎉').click();
    const chip = (e) => [...superMsg().querySelectorAll('.chat-react')].find((b) => text(b).startsWith(e));
    check(await waitFor(() => chip('🎉') && text(chip('🎉')) === '🎉1' && chip('🎉').classList.contains('mine') && !pick()), 'pastille 🎉 : ' + text(superMsg().querySelector('.chat-reacts')));
    check(await waitFor(() => apiLog.slice(from).some((x) => /^POST \/api\/chat\/\d+\/react$/.test(x))), 'réaction non envoyée : ' + apiLog.slice(from).join(', '));
    const superId = Number(superMsg().getAttribute('id').slice(7));
    await rawApi('POST', `/api/chat/${superId}/react`, keyN, { emoji: '🎉', on: true });
    await rawApi('POST', `/api/chat/${superId}/react`, keyN, { emoji: '❤️', on: true });
    await pc.visible();
    check(await waitFor(() => chip('🎉') && text(chip('🎉')) === '🎉2' && chip('❤️') && !chip('❤️').classList.contains('mine')), 'réactions de Noa non reçues : ' + text(superMsg().querySelector('.chat-reacts')));
    check(chip('🎉').getAttribute('title') === 'Noa et toi' && chip('❤️').getAttribute('aria-pressed') === 'false' && !d.querySelector('.chat-below'), 'info-bulle ou état des pastilles : ' + chip('🎉').getAttribute('title'));
    chip('🎉').click();
    check(await waitFor(() => chip('🎉') && text(chip('🎉')) === '🎉1' && !chip('🎉').classList.contains('mine')), 'ma réaction non retirée');
    const seenByNoa = (await rawApi('GET', '/api/chat', keyN)).body.messages.find((m) => m.id === superId).reactions;
    check(JSON.stringify(seenByNoa) === JSON.stringify([{ emoji: '🎉', n: 1, mine: true, who: [] }, { emoji: '❤️', n: 1, mine: true, who: [] }]), 'réactions côté serveur : ' + JSON.stringify(seenByNoa));
    if (!SERVER) {
      // 429 : message lisible, brouillon gardé.
      api.chatLimit = true;
      type(field(), 'Encore un');
      field().dispatch('keydown', { key: 'Enter' });
      check(await waitFor(() => hasIn('Doucement : 10 messages par minute au plus')), 'refus 429 non affiché');
      check(field().value === 'Encore un', 'brouillon perdu après un refus');
      api.chatLimit = false;
      type(field(), '');
      // 130 messages de plus (133 en tout, avec les 3 de Noa et moi) : une page rouverte affiche « 99+ » non lus, lit les 100 plus récents, puis les autres à la
      // demande ; chat ouvert, la relecture minutée (horloge accélérée) apporte un nouveau message sans autre geste.
      for (let i = 0; i < 130; i++) await rawApi('POST', '/api/chat', keyN, { text: 'Message ' + i });
      tab('collections').click(); // la première page quitte le chat : sa minuterie s'arrête
      await settle();
      const p2 = openPage({ idb: 'absent', speed: 50 });
      const m2 = () => p2.doc.querySelectorAll('.chat-msg');
      check(await waitFor(() => badgeOf(p2.doc) === '99+ messages non lus'), 'badge « 99+ » attendu : « ' + badgeOf(p2.doc) + ' »');
      p2.doc.getElementById('tab-chat').click();
      check(await waitFor(() => m2().length === 100), '100 messages attendus, ' + m2().length);
      const olderBtn = () => p2.doc.querySelectorAll('button').find((b) => text(b).trim() === 'Charger les messages plus anciens');
      check(olderBtn(), '« Charger les messages plus anciens » absent');
      olderBtn().click();
      check(await waitFor(() => m2().length === 133), 'messages plus anciens non chargés : ' + m2().length);
      check(text(m2()[0].querySelector('.chat-msg__text')) === 'Depuis mon téléphone' && !olderBtn(), 'ordre des messages, ou bouton des plus anciens resté');
      from = apiLog.length;
      await rawApi('POST', '/api/chat', keyN, { text: 'En direct' });
      check(await waitFor(() => text(p2.doc.body).includes('En direct')), 'chat ouvert : la relecture minutée doit apporter le nouveau message');
      check(chatCalls(from).some((x) => /^GET \/api\/chat\?after=\d+$/.test(x)), 'relecture par ?after attendue : ' + chatCalls(from).join(', '));
      p2.doc.getElementById('tab-collections').click();
      await settle(100);
      from = apiLog.length;
      await sleep(800); // ≈ 40 s à l'horloge de la page : plus aucune relecture du chat
      check(!chatCalls(from).length, 'chat relu alors que son onglet est fermé : ' + chatCalls(from).join(', '));
    } else {
      tab('collections').click();
      await settle();
    }
    console.log(`chat : ${apiLog.filter((x) => /^(GET|POST|DELETE) \/api\/chat\b/.test(x)).length} appels de /api/chat par les pages, dont ${apiLog.filter((x) => /^GET \/api\/chat\?after=/.test(x)).length} relectures ?after`);
  }

  // 31. « Ajouter par tags du jeu » (album d'une collection) : Alek a une collection « Maladies », des cartes qu'il a
  // taguées « Maladie » dans le jeu (tags du jeu, avec leur couleur) et des cartes de catégorie du jeu « maladie » qui n'y
  // sont pas. Tags du jeu proposés d'abord (même nom, coché d'emblée ; plus précis ; porté par beaucoup de ses cartes),
  // puis les catégories du jeu (même nom, cochée d'emblée ; plus précises ; portée par beaucoup de ses éléments,
  // description comprise), tes tags du classeur repliés (jamais cochés), aperçu décochable (catégorie rappelée quand
  // plusieurs propositions sont cochées), ajout (éléments existants gardés, nouveaux à la fin, sans doublon) ; rouverte :
  // le tag complet est signalé. Plus large que le nom (« Maladies parasitaires » ← tag « Maladie ») : proposé, pas coché.
  // Collection faite d'une catégorie : « Rien à proposer », un tag puis une catégorie choisis à la main (casse, pluriel,
  // féminin ramenés ; inconnu : ressemblants proposés), source gardée. Classeur sans tag du jeu : la fenêtre le dit.
  // « Mes cartes » : section « Tags du jeu » (filtre, combinable) ; fiche : « Tags du jeu » en pastilles colorées.
  // 32. Cartes citées dans le chat : [[Titre]] devient une pastille (ta carte : sa rareté ; sinon en pointillés) qui ouvre
  // la fiche (la tienne, ou la carte manquante vérifiée sur Wikipédia) ; jamais de HTML ; « Partager dans le chat » d'une
  // fiche met [[Titre]] dans le champ du chat et ouvre l'onglet.
  {
    const keyA = await makeOtherAccount('Alek');
    const mkA = (id, title, rarity, category, gtags = [], gtagc = null) => ({ id, title, rarity, atk: 1, def: 1, quality: 1, pageviews: 10, category, image: null, url: null,
      count: 1, shiny: false, starred: false, obtained_at: '2026-10-01T00:00:00Z', gtags, ...(gtagc ? { gtagc } : {}) });
    const red = { Maladie: '#ef4444' };
    await seedCards(keyA, [mkA('a1', 'Grippe', 'R', 'maladie infectieuse', ['Maladie', 'Virus'], red), mkA('a2', 'Rougeole', 'PC', 'infection virale', ['Maladie', 'Virus'], red),
      mkA('a3', 'Varicelle', 'C', 'maladie', ['Maladie', 'Virus'], red), mkA('a4', 'Choléra', 'SR', 'Maladie', ['Maladie'], red), mkA('a5', 'Peste', 'UR', 'maladie', ['Fléau']),
      mkA('a6', 'Paludisme', 'R', 'maladie parasitaire', ['Maladies tropicales']), mkA('a7', 'Louis Pasteur', 'L', 'scientifique français'),
      mkA('a8', 'Rihanna', 'L', 'chanteuse barbadienne', ['Musique']), mkA('a9', 'Herpès', 'C', 'infection virale', ['Virus']), mkA('a10', 'Diphtérie', 'PC', 'maladie infectieuse')]);
    const tagA = async (ids, tag) => check((await rawApi('POST', '/api/tags/bulk', keyA, { card_ids: ids, add: [tag], remove: [] })).status === 200, "tags d'Alek refusés");
    await tagA(['a1', 'a2', 'a3', 'a4', 'a5'], 'Sciences et nature/Maladie');
    await tagA(['a1', 'a2', 'a3', 'a7'], 'Contagion');
    await tagA(['a6'], 'Maladies tropicales');
    await tagA(['a8'], 'Métiers/Chanteuse');
    const it0 = (title, more) => ({ title, description: null, image: null, status: 'ok', ...more });
    check((await rawApi('POST', '/api/targets/save', keyA, { name: 'Maladies', items: [it0('Grippe'), it0('Rougeole'),
      it0('Tuberculose', { description: 'maladie infectieuse', qid: 'Q12204' }), it0('Variole', { description: 'infection virale' })] })).status === 200, 'collection « Maladies » refusée');
    check((await rawApi('POST', '/api/targets/save', keyA, { name: 'Maladies parasitaires', items: [it0('Toxoplasmose')] })).status === 200, 'collection « Maladies parasitaires » refusée');
    check((await rawApi('POST', '/api/targets/save', keyA, { name: 'Vaccination', source: 'wp:Vaccination', items: [it0('Louis Pasteur')] })).status === 200, 'collection « Vaccination » refusée');
    ls.set('classeur-key', keyA);
    ls.set('classeur-known', JSON.stringify([{ key: keyA, name: 'Alek' }]));
    const pa = openPage({ idb: 'absent' });
    const d = pa.doc;
    const txt = () => text(d.body);
    const btnIn = (root, t) => root.querySelectorAll('button').find((b) => text(b).trim() === t) || null;
    const ADD = 'Ajouter par tags du jeu';
    check(await waitFor(() => pa.count() === 10), "classeur d'Alek non ouvert");
    d.getElementById('tab-collections').click();
    await settle();
    const openRow = async (name) => {
      const r = d.querySelectorAll('.row').find((n) => (n.getAttribute('aria-label') || '').startsWith(name + ' :'));
      check(r, `collection « ${name} » absente`);
      r.click();
      await settle(80);
    };
    await openRow('Maladies');
    check(txt().includes('2 sur 4') && btnIn(d.body, ADD) && !btnIn(d.body, 'Ajouter par catégorie du jeu'), `« ${ADD} » absent de l'album de « Maladies »`);
    btnIn(d.body, ADD).click();
    await settle();
    const modal = () => d.querySelectorAll('.modal')[0] || null;
    const listOf = (label) => modal().querySelectorAll('.tagadd').find((u) => u.getAttribute('aria-label') === label) || null;
    const lis = (label) => { const u = listOf(label); return u ? u.querySelectorAll('li') : []; }; // le faux DOM ne lit pas « .a li »
    const grows = () => lis('Tags du jeu proposés');
    const rows = () => lis('Catégories du jeu proposées');
    const tagRows = () => lis('Tes tags du classeur proposés');
    const box = (li) => li.querySelector('input');
    const prev = () => { const u = modal().querySelectorAll('.tagadd-preview')[0]; return u ? u.querySelectorAll('li').map((li) => text(li)) : []; };
    check(modal() && text(modal().querySelector('h2')) === ADD && text(modal()).includes('Dans « Maladies »') && text(modal()).includes('Tes tags du jeu')
      && text(modal()).includes('Catégories du jeu'), 'fenêtre « Ajouter par tags du jeu » absente : ' + (modal() ? text(modal()).slice(0, 300) : ''));
    // Tags du jeu : « Maladie » (même nom ; Grippe et Rougeole déjà dedans), « Maladies tropicales » (plus précis), « Virus »
    // (porté par Grippe et Rougeole, les 2 cartes d'Alek dans la collection).
    let rt = grows().map((li) => text(li));
    check(rt.length === 3 && rt[0].startsWith('Maladie') && rt[0].includes('2 à ajouter') && rt[0].includes('même nom que la collection') && rt[0].includes('2 déjà dans la collection')
      && rt[1].includes('Maladies tropicales') && rt[1].includes('1 à ajouter') && rt[1].includes('plus précis que le nom de la collection')
      && rt[2].includes('Virus') && rt[2].includes('2 à ajouter') && rt[2].includes('porté par 2 de tes 2 cartes de la collection'), 'tags du jeu proposés : ' + rt.join(' | '));
    check(box(grows()[0]).checked && !box(grows()[1]).checked && !box(grows()[2]).checked, "seul le tag du jeu du même nom doit être coché d'emblée");
    check(grows()[0].querySelector('.gtag-name').style['--gtag'] === '#ef4444' && !grows()[2].querySelector('.gtag-name').style['--gtag'], 'couleur du tag du jeu absente de sa pastille');
    // Catégories du jeu, ensuite : « maladie » (même nom, cochée), « maladie infectieuse » et « maladie parasitaire » (plus
    // précises), « infection virale » (celle de Rougeole et la description de Variole : 2 des 4 éléments).
    rt = rows().map((li) => text(li));
    check(rt.length === 4 && rt[0].includes('« maladie »') && rt[0].includes('3 à ajouter') && rt[0].includes('même nom que la collection')
      && rt[1].includes('« maladie infectieuse »') && rt[1].includes('2 déjà dans la collection') && rt[2].includes('« maladie parasitaire »')
      && rt[3].includes('« infection virale »') && rt[3].includes('portée par 2 des 4 éléments de la collection'), 'catégories proposées : ' + rt.join(' | '));
    check(box(rows()[0]).checked && !box(rows()[1]).checked && !box(rows()[3]).checked, "seule la catégorie du même nom doit être cochée d'emblée");
    check(prev().join('|') === 'SRCholéraMaladie|URPestemaladie|CVaricellemaladie' && btnIn(modal(), 'Ajouter 3 cartes'), 'aperçu des deux propositions du même nom : ' + prev().join('|'));
    // Sans la catégorie : le tag du jeu seul (une proposition cochée : catégorie pas rappelée) ; puis « Virus » en plus.
    box(rows()[0]).click();
    await settle();
    check(prev().join('|') === 'SRCholéra|CVaricelle', 'aperçu du tag du jeu seul : ' + prev().join('|'));
    box(grows()[2]).click();
    await settle();
    check(prev().join('|') === 'SRCholéraMaladie|CHerpèsinfection virale|CVaricellemaladie', 'aperçu avec « Virus » : ' + prev().join('|'));
    // Tes tags du classeur : repliés (rien de coché une fois dépliés), puis repliés de nouveau.
    check(!listOf('Tes tags du classeur proposés') && btnIn(modal(), 'Proposer aussi tes tags du classeur (3)'), 'tags du classeur : repliés, avec leur nombre');
    btnIn(modal(), 'Proposer aussi tes tags du classeur (3)').click();
    await settle();
    check(tagRows().length === 3 && text(tagRows()[0]).includes('Sciences et nature › Maladie') && tagRows().every((li) => !box(li).checked), 'tags du classeur dépliés : ' + tagRows().map(text).join(' | '));
    btnIn(modal(), 'Masquer tes tags du classeur').click();
    await settle();
    // « Refaire à chaque synchro » : cochée d'emblée ; décochée ici (ce parcours reste un ajout ponctuel, sans règle :
    // l'ajout automatique a son propre parcours, 31 bis).
    check(d.getElementById('tagadd-auto') && d.getElementById('tagadd-auto').checked, '« Refaire à chaque synchro » absente ou décochée d\'emblée');
    d.getElementById('tagadd-auto').click();
    await settle();
    btnIn(modal(), 'Ajouter 3 cartes').click();
    check(await waitFor(() => !modal()), "la fenêtre doit se fermer après l'ajout");
    let mal = (await rawApi('GET', '/api/targets', keyA)).body.targets.find((x) => x.name === 'Maladies');
    check(mal.items.map((i) => i.title).join('|') === 'Grippe|Rougeole|Tuberculose|Variole|Choléra|Herpès|Varicelle', "éléments après l'ajout : " + mal.items.map((i) => i.title).join('|'));
    check(mal.items[2].qid === 'Q12204' && mal.items[2].description === 'maladie infectieuse' && mal.items[4].description === 'Maladie' && mal.items[5].description === 'infection virale'
      && mal.items[4].status === 'ok' && mal.items[4].image === null, 'éléments existants gardés tels quels, nouveaux avec la catégorie du jeu : ' + JSON.stringify(mal.items.slice(2, 6)));
    check(await waitFor(() => txt().includes('3 cartes ajoutées à « Maladies »') && txt().includes('5 sur 7')), "confirmation ou progression après l'ajout");
    // Rouverte : le tag « Maladie » est complet (signalé, plus proposé) ; « Virus » aussi (porté, mais rien à ajouter).
    btnIn(d.body, ADD).click();
    await settle();
    rt = grows().map((li) => text(li));
    check(rt.length === 1 && rt[0].includes('Maladies tropicales') && text(modal()).includes('Déjà toutes dans la collection : tes cartes au tag Maladie'), 'tags du jeu, rouverte : ' + rt.join(' | '));
    check(rows()[0] && text(rows()[0]).includes('« maladie »') && text(rows()[0]).includes('1 à ajouter') && box(rows()[0]).checked && prev().join('|') === 'URPeste',
      'catégorie du même nom, rouverte (Peste seule) : ' + rows().map(text).join(' | ') + ' / ' + prev().join('|'));
    btnIn(modal(), 'Annuler').click();
    await settle(300);
    // « Maladies parasitaires » : tag « Maladie » plus large (pas coché), catégorie « maladie parasitaire » du même nom (cochée).
    btnIn(d.body, '← Toutes les collections').click();
    await settle();
    await openRow('Maladies parasitaires');
    btnIn(d.body, ADD).click();
    await settle();
    rt = grows().map((li) => text(li));
    check(rt.length === 1 && rt[0].startsWith('Maladie') && rt[0].includes("plus large que le nom de la collection : vérifie l'aperçu") && !box(grows()[0]).checked
      && text(rows()[0]).includes('« maladie parasitaire »') && box(rows()[0]).checked, 'tag plus large : ' + rt.join(' | '));
    btnIn(modal(), 'Annuler').click();
    await settle(300);
    // Collection faite d'une catégorie de Wikipédia : rien ne ressemble à son nom ; un tag du jeu puis une catégorie choisis
    // à la main (casse, pluriel et féminin ramenés), source gardée à l'enregistrement.
    btnIn(d.body, '← Toutes les collections').click();
    await settle();
    await openRow('Vaccination');
    btnIn(d.body, ADD).click();
    await settle();
    check(text(modal()).includes('Rien à proposer : aucun de tes tags du jeu ne ressemble au nom « Vaccination ».')
      && text(modal()).includes('Rien à proposer : aucune catégorie du jeu de tes cartes ne ressemble au nom « Vaccination ».') && !grows().length && !rows().length
      && text(modal()).includes('faite de la catégorie Wikipédia « Vaccination »') && d.getElementById('tagadd-cats').querySelectorAll('option').length === 11,
    '« Rien à proposer », note de la catégorie ou liste des tags et catégories du jeu absents : ' + text(modal()).slice(0, 600));
    const pick = async (v) => { type(d.getElementById('tagadd-other'), v); btnIn(modal(), 'Ajouter à la liste').click(); await settle(); };
    await pick('Inconnue');
    check(text(modal()).includes("Aucune de tes cartes n'a le tag ou la catégorie du jeu « Inconnue »."), 'inconnu non signalé');
    await pick('infectieux');
    check(text(modal()).includes("Aucune de tes cartes n'a le tag ou la catégorie du jeu « infectieux » ; ressemblants : « maladie infectieuse »."), 'ressemblants non proposés : ' + text(modal()).slice(0, 900));
    await pick('virus');
    check(grows().length === 1 && text(grows()[0]).includes('Virus') && text(grows()[0]).includes('choisi par toi') && box(grows()[0]).checked
      && prev().join('|') === 'RGrippe|CHerpès|PCRougeole|CVaricelle', 'tag du jeu choisi à la main : ' + grows().map(text).join(' | ') + ' / ' + prev().join('|'));
    await pick('Maladies infectieuses');
    check(rows().length === 1 && text(rows()[0]).includes('« maladie infectieuse »') && text(rows()[0]).includes('choisie par toi') && prev().length === 5,
      'catégorie choisie à la main : ' + rows().map(text).join(' | ') + ' / ' + prev().join('|'));
    btnIn(modal(), 'Ajouter 5 cartes').click();
    check(await waitFor(() => !modal()), "la fenêtre doit se fermer après l'ajout (catégorie)");
    const vac = (await rawApi('GET', '/api/targets', keyA)).body.targets.find((x) => x.name === 'Vaccination');
    check(vac.source === 'wp:Vaccination' && vac.items.map((i) => i.title).join('|') === 'Louis Pasteur|Diphtérie|Grippe|Herpès|Rougeole|Varicelle', 'collection faite d\'une catégorie après l\'ajout : ' + JSON.stringify(vac));
    check(await waitFor(() => txt().includes('depuis la catégorie Wikipédia')), 'la collection doit rester signalée « depuis la catégorie Wikipédia »');
    // « Mes cartes » : section « Tags du jeu » (les plus portés d'abord), filtre, Ctrl+clic pour combiner, filtre retiré.
    d.getElementById('tab-cartes').click();
    await settle();
    const gchips = () => d.querySelectorAll('.gchip');
    check(gchips().map((b) => text(b)).join('|') === 'Maladie4|Virus4|Fléau1|Maladies tropicales1|Musique1' && gchips()[0].style['--gtag'] === '#ef4444',
      'section « Tags du jeu » de « Mes cartes » : ' + gchips().map((b) => text(b)).join('|'));
    gchips()[1].click();
    await settle();
    const shownTitles = () => d.querySelectorAll('.card__title').map((n) => text(n)).sort().join('|');
    check(shownTitles() === 'Grippe|Herpès|Rougeole|Varicelle' && txt().includes('Jeu : Virus'), 'filtre « Virus » : ' + shownTitles());
    gchips()[0].dispatch('click', { ctrlKey: true });
    await settle();
    check(shownTitles() === 'Grippe|Rougeole|Varicelle', 'filtres combinés « Virus » et « Maladie » : ' + shownTitles());
    // Fiche : « Tags du jeu » en pastilles, avec leur couleur, à part de « Tes tags ».
    d.querySelectorAll('.card').find((n) => text(n).includes('Grippe')).dispatch('click');
    await settle(80);
    const fiche = () => d.querySelectorAll('.fiche')[0] || null;
    const games = () => (fiche() ? fiche().querySelectorAll('.game') : []);
    check(fiche() && text(fiche()).includes('Tags du jeu') && games().map((n) => text(n)).join('|') === 'Maladie|Virus' && games()[0].style['--gtag'] === '#ef4444'
      && !games().some((n) => n.classList.contains('own')), 'fiche : tags du jeu absents ou mêlés aux tiens : ' + (fiche() ? text(fiche()).slice(0, 400) : 'aucune'));
    fiche().querySelector('.close').click();
    await settle(400);
    btnIn(d.body, 'Réinitialiser les filtres').click();
    await settle();
    check(!txt().includes('Jeu : Virus'), 'filtres des tags du jeu non retirés');
    d.getElementById('tab-collections').click();
    await settle();
    // Classeur dont aucune carte n'a de tag du jeu : la fenêtre le dit (et propose quand même les catégories du jeu).
    {
      const keyZ = await makeOtherAccount('Zélie');
      await seedCards(keyZ, [mkA('z1', 'Grippe', 'R', 'maladie'), mkA('z2', 'Peste', 'UR', 'maladie')].map(({ gtags, ...c }) => c));
      check((await rawApi('POST', '/api/targets/save', keyZ, { name: 'Maladies', items: [it0('Rougeole')] })).status === 200, 'collection de Zélie refusée');
      ls.set('classeur-key', keyZ);
      ls.set('classeur-known', JSON.stringify([{ key: keyZ, name: 'Zélie' }]));
      const pz = openPage({ idb: 'absent' });
      check(await waitFor(() => pz.count() === 2), 'classeur de Zélie non ouvert');
      pz.doc.getElementById('tab-collections').click();
      await settle();
      pz.doc.querySelectorAll('.row').find((n) => (n.getAttribute('aria-label') || '').startsWith('Maladies :')).click();
      await settle(80);
      btnIn(pz.doc.body, ADD).click();
      await settle();
      const mz = text(pz.doc.querySelectorAll('.modal')[0]);
      check(mz.includes("Aucun tag du jeu lu pour l'instant : ils arrivent avec chaque lecture de ta collection") && mz.includes('« maladie »') && mz.includes('Ajouter 2 cartes'),
        'classeur sans tag du jeu : message absent : ' + mz.slice(0, 600));
      pz.doc.getElementById('tab-cartes').click();
      await settle();
      check(text(pz.doc.body).includes("Aucun tag du jeu lu pour l'instant"), '« Mes cartes » sans tag du jeu : message absent');
      ls.set('classeur-key', keyA);
      ls.set('classeur-known', JSON.stringify([{ key: keyA, name: 'Alek' }]));
    }

    // 32. Cartes citées dans le chat.
    const keyB = await makeOtherAccount('Bérénice');
    // Le vrai serveur ne liste que les membres qui ont des cartes ou des collections (l'API simulée, tous).
    if (SERVER) await seedCards(keyB, [{ id: 'b1', title: 'Carte de Bérénice', rarity: 'C', atk: 1, def: 1, quality: 1, pageviews: 1, category: 'x', image: null, url: null, count: 1, shiny: false, starred: false, obtained_at: '2026-10-01T00:00:00Z' }]);
    check((await rawApi('POST', '/api/chat', keyB, { text: 'Regarde [[grippe]] et [[Lèpre]] ! <b>gras</b> [[<img src=x onerror=alert(1)>]] [[Mot inconnu]]' })).status === 201, 'message de Bérénice refusé');
    d.getElementById('tab-chat').click();
    const lastMsg = () => { const l = d.querySelectorAll('.chat-msg'); return l[l.length - 1] || null; };
    const chips = () => (lastMsg() ? lastMsg().querySelectorAll('.chat-card') : []);
    check(await waitFor(() => chips().length === 3), 'pastilles des cartes citées absentes : ' + chips().map(text).join('|'));
    check(text(chips()[0]) === 'RGrippe' && chips()[0].classList.contains('own') && chips()[0].getAttribute('aria-label') === 'Ta carte « Grippe » (Rare) : ouvrir sa fiche'
      && text(chips()[1]) === 'Lèpre' && !chips()[1].classList.contains('own') && text(chips()[2]) === 'Mot inconnu', 'pastilles : ' + chips().map(text).join('|'));
    const mt = text(lastMsg().querySelector('.chat-msg__text'));
    check(!lastMsg().querySelectorAll('b').length && !lastMsg().querySelectorAll('img').length && mt.includes('<b>gras</b>') && mt.includes('[[<img src=x onerror=alert(1)>]]'),
      'le texte du message ne doit jamais devenir du HTML : ' + mt);
    check(txt().includes('Pour montrer une carte : # puis son titre, [[Titre de la carte]], ou « Partager dans le chat » depuis sa fiche. Pour une collection : #c: puis son nom, ou colle son lien. Pour un membre : @ puis son prénom pour le mentionner, #u: pour montrer son classeur.'),
      'aide des cartes et collections citées et des mentions absente sous le champ du chat');
    const ficheA = () => d.querySelectorAll('.fiche')[0] || null;
    chips()[0].click();
    await settle(80);
    check(ficheA() && !ficheA().classList.contains('fiche--missing') && text(ficheA().querySelector('h2')) === 'Grippe', 'pastille de ta carte : sa fiche attendue');
    ficheA().querySelector('.close').click();
    await settle(400);
    chips()[1].click();
    check(await waitFor(() => ficheA() && ficheA().classList.contains('fiche--missing') && text(ficheA()).includes('maladie infectieuse chronique') && text(ficheA()).includes('≈ Super rare')),
      'pastille d\'une carte que tu n\'as pas : fiche vérifiée sur Wikipédia attendue : ' + (ficheA() ? text(ficheA()).slice(0, 300) : 'aucune'));
    check(text(ficheA()).includes('Pas encore dans ta collection') && text(ficheA()).includes('2 000'), 'fiche de « Lèpre » : vues ou mention absentes');
    // « Partager dans le chat » (à côté de « Copier le nom ») : [[Lèpre]] dans le champ, fiche fermée.
    const share = (t) => ficheA().querySelectorAll('button').find((b) => b.getAttribute('aria-label') === `Partager « ${t} » dans le chat`);
    check(share('Lèpre') && share('Lèpre').parentNode.classList.contains('fiche__title'), 'bouton « Partager dans le chat » absent à côté du titre');
    share('Lèpre').click();
    await settle(400);
    const field = () => d.getElementById('chat-input');
    check(!ficheA() && field().value === '[[Lèpre]] ', 'partage : fiche fermée et [[Lèpre]] dans le champ attendus : « ' + (field() && field().value) + ' »');
    chips()[2].click();
    check(await waitFor(() => ficheA() && text(ficheA()).includes('le titre cité dans le chat est peut-être mal écrit')), 'carte citée introuvable sur Wikipédia : message attendu');
    check(!share('Mot inconnu'), 'pas de partage pour un article introuvable');
    ficheA().querySelector('.close').click();
    await settle(400);
    // Depuis une autre page (« Mes cartes ») : le partage ouvre l'onglet Chat, le titre s'ajoute au brouillon.
    d.getElementById('tab-cartes').click();
    await settle();
    type(d.getElementById('q'), 'peste');
    await settle();
    d.querySelectorAll('.card')[0].dispatch('click');
    await settle(80);
    share('Peste').click();
    check(await waitFor(() => d.getElementById('tab-chat').getAttribute('aria-selected') === 'true' && field() && field().value === '[[Lèpre]] [[Peste]] ' && d.activeElement === field()),
      'partage depuis « Mes cartes » : onglet Chat, brouillon et curseur attendus : « ' + (field() && field().value) + ' »');
    field().dispatch('keydown', { key: 'Enter' });
    check(await waitFor(() => lastMsg() && lastMsg().classList.contains('mine') && chips().map(text).join('|') === 'Lèpre|URPeste'), 'message envoyé avec deux cartes citées : ' + chips().map(text).join('|'));

    // 32 bis. Autocomplétion du champ (demande du 2026-10-19) : « # » + lettre propose des cartes (les tiennes d'abord, avec
    // leur rareté, puis celles de tes collections) et insère [[Titre]] ; « @ » propose les membres qui montrent leurs cartes
    // (il faut montrer les siennes) et insère @Prénom ; flèches, Entrée, Tab, Échap ; Entrée sur une suggestion n'envoie rien.
    // Un message qui te mentionne (@prénom, sans distinction de casse) est mis en avant, et compté à part dans le badge.
    const acList = () => d.getElementById('chat-ac');
    const acNames = () => (acList() ? acList().querySelectorAll('li').map((li) => text(li.querySelector('.prop-list__name'))) : []);
    const posts = (mark) => apiLog.slice(mark).filter((x) => x === 'POST /api/chat');
    let mark = apiLog.length;
    type(field(), 'Vu #gri');
    await settle();
    check(acNames().join('|') === 'Grippe' && acList().getAttribute('role') === 'listbox' && acList().querySelector('.pill')
      && field().getAttribute('aria-activedescendant') === 'chat-ac-0', 'suggestions de « #gri » : ' + acNames().join('|'));
    let kev = field().dispatch('keydown', { key: 'Enter' });
    await settle();
    check(kev.defaultPrevented && field().value === 'Vu [[Grippe]] ' && !acList() && !posts(mark).length, 'Entrée sur une suggestion : [[Grippe]] inséré, rien envoyé : « ' + field().value + ' »');
    type(field(), 'Vu [[Grippe]] #r');
    await settle();
    check(acNames().join('|') === 'Rihanna|Rougeole', 'suggestions de « #r » (tes cartes, la plus courte d\'abord) : ' + acNames().join('|'));
    field().dispatch('keydown', { key: 'ArrowDown' });
    await settle();
    check(field().getAttribute('aria-activedescendant') === 'chat-ac-1', 'flèche bas : deuxième suggestion attendue');
    field().dispatch('keydown', { key: 'Tab' });
    await settle();
    check(field().value === 'Vu [[Grippe]] [[Rougeole]] ', 'Tab : [[Rougeole]] attendu : « ' + field().value + ' »');
    type(field(), 'et #tuber');
    await settle();
    const tub = acList() && acList().querySelectorAll('li')[0];
    check(acNames().join('|') === 'Tuberculose' && text(tub).includes('pas dans ton classeur') && !tub.querySelector('.pill'), 'carte d\'une collection, que tu n\'as pas : ' + (tub ? text(tub) : 'aucune'));
    field().dispatch('keydown', { key: 'Escape' });
    await settle();
    type(field(), 'et #tuberc');
    await settle();
    check(!acList(), 'Échap : la liste ne doit pas revenir pour le même #');
    // Une carte que tu n'as nulle part : les articles de Wikipédia qui commencent par le texte tapé (dès 2 lettres, après
    // une pause de frappe) ; le titre exact en tête, puis par début du titre, puis par début d'un mot, et un article
    // trouvé par une redirection (ici une carte d'Alek, avec sa rareté) en dernier.
    const asked = chatPrefix.length;
    type(field(), 'Vu #Europe');
    check(await waitFor(() => acNames().join('|') === 'Europe|Europe centrale|Union européenne|Peste'), 'suggestions Wikipédia de « #Europe » : ' + acNames().join('|'));
    const peste = acList().querySelectorAll('li')[3];
    check(peste.querySelector('.pill') && !text(peste).includes('pas dans ton classeur') && text(acList().querySelectorAll('li')[0]).includes('pas dans ton classeur'),
      'article de Wikipédia : ta carte avec sa rareté, les autres « pas dans ton classeur »');
    check(chatPrefix.slice(asked).join('|') === 'Europe', 'une seule recherche Wikipédia attendue : ' + chatPrefix.slice(asked).join('|'));
    field().dispatch('keydown', { key: 'Enter' });
    await settle();
    check(field().value === 'Vu [[Europe]] ', '[[Europe]] attendu : « ' + field().value + ' »');
    for (const v of ["C'est le #1", 'C#maj', 'Rien #zzzz']) {
      type(field(), v);
      await settle();
      check(!acList(), `« ${v} » ne doit rien proposer`);
    }
    kev = field().dispatch('keydown', { key: 'Enter' });
    await settle(80);
    check(posts(mark).length === 1, 'Entrée sans suggestion : le message doit partir');
    // « @ » sans montrer ses cartes : on dit pourquoi personne n'est proposé.
    type(field(), 'Salut @');
    await settle();
    check(!acList() && txt().includes('Seuls les membres qui montrent leurs cartes peuvent être mentionnés'), '« @ » sans partage : explication attendue');
    check(!apiLog.slice(mark).includes('GET /api/members'), 'sans partage, la page ne doit pas lire les membres');
    type(field(), '');
    // Bérénice et Alek montrent leurs cartes ; Alek ouvre de nouveau le chat : les prénoms sont lus (sans leurs cartes).
    check((await rawApi('PATCH', '/api/me', keyB, { shared: true, pseudo: 'Bere_42' })).status === 200, 'partage de Bérénice refusé');
    d.getElementById('tab-reglages').click();
    await settle();
    const cbA = d.getElementById('set-shared');
    cbA.checked = true;
    cbA.dispatch('change');
    await settle(120);
    d.getElementById('tab-chat').click();
    await settle(80);
    type(field(), 'Salut @bé');
    check(await waitFor(() => acNames().join('|') === '@Bérénice'), 'suggestions de « @bé » : ' + acNames().join('|'));
    check(text(acList().querySelector('.prop-list__hint')) === 'Bere_42', 'suggestion de « @bé » : pseudo dans le jeu attendu, ' + text(acList()));
    field().dispatch('keydown', { key: 'Enter' });
    await settle();
    check(field().value === 'Salut @Bérénice ', '@Bérénice attendu : « ' + field().value + ' »');
    type(field(), 'Salut @Bérénice ça va ?');
    field().dispatch('keydown', { key: 'Enter' });
    check(await waitFor(() => lastMsg() && lastMsg().classList.contains('mine') && text(lastMsg().querySelector('.chat-at')) === '@Bérénice' && !lastMsg().classList.contains('ping')),
      'mention envoyée : pastille @Bérénice attendue');
    check(lastMsg().querySelector('.chat-at').getAttribute('title') === 'Pseudo dans le jeu : Bere_42' && !lastMsg().querySelector('.chat-msg__pseudo'),
      'mention : pseudo de Bérénice en info-bulle attendu, et pas de pseudo sur mes messages');
    // Bérénice mentionne Alek (casse différente) pendant qu'il est ailleurs : badge à part ; une adresse n'est pas une mention.
    d.getElementById('tab-collections').click();
    await settle();
    await rawApi('POST', '/api/chat', keyB, { text: 'Coucou @alek, regarde !' });
    await rawApi('POST', '/api/chat', keyB, { text: 'Écris-moi à moi@alek.fr' });
    await pa.visible();
    const tabC = () => d.getElementById('tab-chat');
    check(await waitFor(() => tabC().querySelector('.tab-badge.ping') && text(tabC().querySelector('.tab-badge.ping')) === '@1'
      && text(tabC().querySelector('.tab-badge')).includes("2 messages non lus, dont 1 s'adresse à toi")), 'badge des mentions : « ' + text(tabC()) + ' »');
    tabC().click();
    await settle(80);
    const all = () => d.querySelectorAll('.chat-msg');
    const ping = all().find((m) => text(m).includes('Coucou'));
    const mail = all().find((m) => text(m).includes('moi@alek.fr'));
    check(ping && ping.classList.contains('ping') && text(ping.querySelector('.chat-msg__ping')) === 'te mentionne' && text(ping.querySelector('.chat-at.me')) === '@alek',
      'message qui me mentionne : mise en avant attendue');
    const pseudoA = ping.querySelector('.chat-msg__pseudo');
    check(pseudoA && text(pseudoA) === 'Bere_42' && pseudoA.getAttribute('href') === 'https://www.wiki-masters.com/profile/Bere_42' && !ping.querySelector('.chat-at.me').getAttribute('title'),
      'message de Bérénice : pseudo dans le jeu à côté du prénom attendu : ' + text(ping));
    check(mail && !mail.classList.contains('ping') && !mail.querySelector('.chat-at'), 'une adresse électronique n\'est pas une mention');
    check(!tabC().querySelector('.tab-badge'), 'badge resté à l\'ouverture du chat');
    d.getElementById('tab-collections').click();
    await settle();
  }

  // 31 bis. Ajout automatique (« Refaire à chaque synchro », demande du 2026-10-18 : « Quand il y a déjà eu un "Ajouter par
  // tags du jeu", automatiser pour le faire à chaque synchro ») : règles retenues par la fenêtre (case cochée d'emblée), carte
  // décochée exclue ; ligne de l'album et marque dans « Mes collections » ; nouvelles cartes d'un tag ou d'une catégorie des
  // règles ajoutées à la synchro suivante (une requête conditionnelle, une notification), carte exclue jamais rajoutée ;
  // « Retirer » exclut, « Annuler » remet et lève l'exclusion ; éditeur ; fenêtre rouverte : règles cochées, cartes exclues
  // décochées, règles changées ; deux onglets : un seul ajout ; trois collections : une notification ; collection pleine :
  // ce qui tient, et le message le dit ; « Arrêter » (cartes gardées) et son « Annuler ».
  {
    const keyU = await makeOtherAccount('Ugo');
    const mkU = (id, title, category, gtags = []) => ({ id, title, rarity: 'C', atk: 1, def: 1, quality: 1, pageviews: 10, category, image: null, url: null,
      count: 1, shiny: false, starred: false, obtained_at: '2026-10-01T00:00:00Z', gtags });
    let deck = [mkU('u1', 'Grippe', 'maladie infectieuse', ['Maladie']), mkU('u2', 'Rougeole', 'infection virale', ['Maladie']), mkU('u3', 'Peste', 'maladie'),
      mkU('u4', 'Rihanna', 'chanteuse barbadienne', ['Musique'])];
    await seedCards(keyU, deck);
    const more = async (...list) => { deck = [...deck, ...list]; await seedCards(keyU, deck); };
    const itU = (title, extra) => ({ title, description: null, image: null, status: 'ok', ...extra });
    check((await rawApi('POST', '/api/targets/save', keyU, { name: 'Maladies', items: [itU('Grippe')] })).status === 200, "collection « Maladies » d'Ugo refusée");
    const colU = async (name) => ((await rawApi('GET', '/api/targets', keyU)).body.targets || []).find((x) => x.name === name);
    const titlesOf = (t) => (t ? t.items.map((i) => i.title).join('|') : '(aucune)');
    const autoOfU = (t) => JSON.stringify(t && t.auto);
    const until = async (f, ms = 3000) => { for (let t = 0; t < ms; t += 25) { if (await f()) return true; await sleep(25); } return !!(await f()); };
    const saves = (mark) => apiLog.slice(mark).filter((x) => x === 'POST /api/targets/save');
    ls.set('classeur-key', keyU);
    ls.set('classeur-known', JSON.stringify([{ key: keyU, name: 'Ugo' }]));
    // Une page (onglet) du classeur d'Ugo et ses outils.
    const pageU = async () => {
      const pg = openPage({ idb: 'absent' });
      const d = pg.doc;
      check(await waitFor(() => pg.count() === deck.length), "classeur d'Ugo non ouvert");
      d.getElementById('tab-collections').click();
      await settle();
      const btnIn = (root, t) => (root ? root.querySelectorAll('button').find((b) => text(b).trim() === t) || null : null);
      const modal = () => d.querySelectorAll('.modal')[0] || null;
      const row = (name) => d.querySelectorAll('.row').find((n) => (n.getAttribute('aria-label') || '').startsWith(name + ' :')) || null;
      return {
        pg, d, btnIn, modal, row,
        toast: () => text(d.querySelectorAll('.toast')[0] || null),
        autoLine: () => d.querySelectorAll('.auto-line')[0] || null,
        lis: (label) => { const u = modal() ? modal().querySelectorAll('.tagadd').find((x) => x.getAttribute('aria-label') === label) : null; return u ? u.querySelectorAll('li') : []; },
        prev: () => { const u = modal() ? modal().querySelectorAll('.tagadd-preview')[0] : null; return u ? u.querySelectorAll('li') : []; },
        open: async (name) => {
          const back = btnIn(d.body, '← Toutes les collections');
          if (back) { back.click(); await settle(); }
          check(row(name), `collection « ${name} » absente`);
          row(name).click();
          await settle(80);
        },
        // Fiche d'une de tes cartes de l'album (une carte possédée y est une carte, pas une case vide).
        slot: async (title) => {
          const c = d.querySelectorAll('.card').find((n) => text(n.querySelector('.card__title')) === title);
          check(c, `carte « ${title} » absente de l'album`);
          c.dispatch('click');
          await settle(80);
        },
      };
    };
    const u = await pageU();
    check(!(u.row('Maladies').getAttribute('aria-label') || '').includes('Ajout automatique') && !u.d.querySelectorAll('.row-auto').length, 'marque « ajout automatique » sans règle');
    await u.open('Maladies');
    check(!u.autoLine(), 'ligne « Ajout automatique » sans règle');
    u.btnIn(u.d.body, 'Ajouter par tags du jeu').click();
    await settle();
    const autoBox = () => u.d.getElementById('tagadd-auto');
    check(autoBox() && autoBox().checked && text(u.modal()).includes('Refaire à chaque synchro : les prochaines cartes de ces tags iront dans cette collection'),
      'case « Refaire à chaque synchro » absente ou décochée : ' + (u.modal() ? text(u.modal()).slice(0, 400) : ''));
    // Tag du jeu « Maladie » et catégorie « maladie » (même nom, cochés) : Peste et Rougeole ; Rougeole décochée -> exclue.
    check(u.prev().length === 2 && text(u.prev()[0]).includes('Peste') && text(u.prev()[1]).includes('Rougeole'), 'aperçu : ' + u.prev().map(text).join('|'));
    u.prev()[1].querySelector('input').click();
    await settle();
    let from = apiLog.length;
    u.btnIn(u.modal(), 'Ajouter 1 carte').click();
    check(await waitFor(() => !u.modal()), "la fenêtre doit se fermer après l'ajout");
    let mal = await colU('Maladies');
    check(titlesOf(mal) === 'Grippe|Peste' && autoOfU(mal) === JSON.stringify({ rules: [{ k: 'gtag', v: 'Maladie' }, { k: 'cat', v: 'maladie' }], skip: ['Rougeole'] }),
      'règles ou exclusion mal enregistrées : ' + JSON.stringify(mal));
    check(saves(from).length === 1, 'un seul enregistrement attendu : ' + saves(from).length);
    check(await waitFor(() => u.toast().includes('1 carte ajoutée à « Maladies ».') && u.toast().includes('à chaque synchro')), 'message de la fenêtre : ' + u.toast());
    check(u.autoLine() && text(u.autoLine()).includes('Ajout automatique : tag du jeu « Maladie », catégorie du jeu « maladie »') && text(u.autoLine()).includes('1 carte exclue')
      && u.btnIn(u.autoLine(), 'Arrêter') && u.btnIn(u.autoLine(), 'Changer les règles'), 'ligne « Ajout automatique » : ' + text(u.autoLine()));
    u.btnIn(u.d.body, '← Toutes les collections').click();
    await settle();
    check((u.row('Maladies').getAttribute('aria-label') || '').endsWith('. Ajout automatique') && text(u.row('Maladies')).includes('ajout automatique'),
      'marque de « Mes collections » absente : ' + u.row('Maladies').getAttribute('aria-label'));

    // Synchro suivante : Choléra (catégorie « Maladie », autre casse) et Typhus (tag du jeu « maladie ») ajoutées à la fin, de
    // A à Z, avec les champs de la fenêtre ; Rougeole (exclue) et Tétanos (hors des règles) non ; une requête,
    // conditionnelle ; une notification, après celle de la synchro.
    await more(mkU('u5', 'Typhus', 'fièvre', ['maladie']), mkU('u6', 'Choléra', 'Maladie'), mkU('u7', 'Tétanos', 'infection'));
    from = apiLog.length;
    await u.pg.live();
    check(await waitFor(() => u.toast().includes('2 cartes ajoutées automatiquement à « Maladies ».')), "notification de l'ajout automatique : " + u.toast());
    check(u.toast().startsWith('Mis à jour depuis wiki-masters.com'), 'le message de la synchro doit rester devant : ' + u.toast());
    mal = await colU('Maladies');
    check(titlesOf(mal) === 'Grippe|Peste|Choléra|Typhus', 'ajout automatique : ' + titlesOf(mal));
    check(JSON.stringify(mal.items[2]) === JSON.stringify({ title: 'Choléra', description: 'Maladie', image: null, status: 'ok' }), 'élément ajouté : ' + JSON.stringify(mal.items[2]));
    check(saves(from).length === 1, 'une seule requête par collection : ' + saves(from).length);
    if (!SERVER) {
      const last = api.calls.filter((c) => c[1] === '/api/targets/save').pop()[2];
      check(typeof last.expect_updated_at === 'string' && !('auto' in last) && !('auto_skip' in last), 'ajout automatique : envoi conditionnel attendu, sans toucher aux règles : ' + JSON.stringify(Object.keys(last)));
    }
    // Rien de nouveau : rien d'envoyé.
    from = apiLog.length;
    await u.pg.live();
    await settle(150);
    check(!saves(from).length, 'relecture sans nouvelle carte : aucun enregistrement attendu');

    // « Retirer » (fiche de Choléra ouverte depuis l'album) : exclue ; « Annuler » la remet et lève l'exclusion.
    await u.open('Maladies');
    await u.slot('Choléra');
    const rm = () => u.d.querySelectorAll('button').find((b) => b.classList.contains('item-remove'));
    check(rm() && text(rm()).includes('Retirer de « Maladies »'), 'bouton « Retirer » absent');
    rm().click();
    check(await until(async () => { const t = await colU('Maladies'); return titlesOf(t) === 'Grippe|Peste|Typhus' && t.auto.skip.join('|') === 'Rougeole|Choléra'; }),
      'retrait : exclusion attendue : ' + autoOfU(await colU('Maladies')));
    check(await waitFor(() => u.toast().includes("« Choléra » retirée de « Maladies » : elle n'y sera plus ajoutée automatiquement.")), 'message du retrait : ' + u.toast());
    u.d.querySelectorAll('.toast')[0].querySelectorAll('button').find((b) => text(b) === 'Annuler').click();
    check(await until(async () => { const t = await colU('Maladies'); return titlesOf(t) === 'Grippe|Peste|Choléra|Typhus' && t.auto.skip.join('|') === 'Rougeole'; }),
      '« Annuler » : carte remise et exclusion levée attendues : ' + JSON.stringify(await colU('Maladies')));
    await settle(80);
    // Retirée de nouveau ; la synchro suivante (Lèpre, tag « Maladie ») ne la rajoute pas.
    await u.slot('Choléra');
    rm().click();
    check(await until(async () => (await colU('Maladies')).auto.skip.join('|') === 'Rougeole|Choléra'), 'second retrait : exclusion attendue');
    await settle(80);
    await more(mkU('u8', 'Lèpre', 'maladie infectieuse chronique', ['Maladie']));
    await u.pg.live();
    check(await waitFor(() => u.toast().includes('1 carte ajoutée automatiquement à « Maladies ».')), 'Lèpre non ajoutée : ' + u.toast());
    mal = await colU('Maladies');
    check(titlesOf(mal) === 'Grippe|Peste|Typhus|Lèpre', 'carte exclue rajoutée, ou Lèpre absente : ' + titlesOf(mal));

    // « Modifier » (éditeur) : Typhus retirée à la main -> exclue.
    await settle(80);
    u.btnIn(u.d.body, 'Modifier').click();
    await settle();
    type(u.d.getElementById('ed-text'), 'Grippe\nPeste\nLèpre');
    u.btnIn(u.modal(), 'Enregistrer').click();
    check(await waitFor(() => !u.modal()), 'éditeur : enregistrement sans effet');
    mal = await colU('Maladies');
    check(titlesOf(mal) === 'Grippe|Peste|Lèpre' && mal.auto.skip.join('|') === 'Rougeole|Choléra|Typhus' && mal.auto.rules.length === 2, 'éditeur : exclusion attendue : ' + JSON.stringify(mal));

    // Fenêtre rouverte (« Changer les règles ») : les règles cochées, même sans carte à ajouter ; les cartes exclues décochées
    // d'emblée ; la catégorie décochée -> « Enregistrer les règles ».
    check(await waitFor(() => !!u.autoLine()), 'ligne « Ajout automatique » absente après l\'éditeur');
    u.btnIn(u.autoLine(), 'Changer les règles').click();
    await settle();
    const gRows = u.lis('Tags du jeu proposés');
    const cRows = u.lis('Catégories du jeu proposées');
    check(gRows[0] && text(gRows[0]).startsWith('Maladie') && gRows[0].querySelector('input').checked && text(gRows[0]).includes("règle de l'ajout automatique"),
      'règle du tag du jeu non cochée : ' + gRows.map(text).join(' | '));
    const catRow = () => u.lis('Catégories du jeu proposées').find((li) => text(li).includes('« maladie »'));
    check(catRow() && catRow().querySelector('input').checked && text(catRow()).includes("règle de l'ajout automatique"), 'règle de la catégorie non cochée : ' + cRows.map(text).join(' | '));
    check(u.prev().length === 3 && u.prev().every((li) => !li.querySelector('input').checked && text(li).includes("exclue de l'ajout automatique")),
      "cartes exclues : décochées d'emblée attendues : " + u.prev().map(text).join('|'));
    check(autoBox().checked && text(u.modal()).includes('(3 cartes exclues pour l\'instant)') && u.btnIn(u.modal(), 'Ajouter') && u.btnIn(u.modal(), 'Ajouter').disabled,
      'rien à changer : bouton grisé attendu : ' + text(u.modal()).slice(-500));
    catRow().querySelector('input').click();
    await settle();
    from = apiLog.length;
    u.btnIn(u.modal(), 'Enregistrer les règles').click();
    check(await waitFor(() => !u.modal()), 'règles : fenêtre restée ouverte');
    mal = await colU('Maladies');
    check(autoOfU(mal) === JSON.stringify({ rules: [{ k: 'gtag', v: 'Maladie' }], skip: ['Rougeole', 'Choléra', 'Typhus'] }) && titlesOf(mal) === 'Grippe|Peste|Lèpre',
      'règles changées : ' + JSON.stringify(mal));
    check(saves(from).length === 1 && (await waitFor(() => u.toast().includes('Ajout automatique mis à jour pour « Maladies »'))), 'règles : message ' + u.toast());
    check(text(u.autoLine()).includes('Ajout automatique : tag du jeu « Maladie »') && !text(u.autoLine()).includes('catégorie'), "ligne de l'album après le changement : " + text(u.autoLine()));

    // Deux onglets ouverts : la même nouvelle carte, un seul ajout (l'autre reçoit 409 et repart de la collection
    // d'aujourd'hui : plus rien à ajouter), une seule notification d'ajout.
    const v = await pageU();
    await settle(150);
    await more(mkU('u9', 'Variole', 'maladie infectieuse', ['Maladie']));
    from = apiLog.length;
    const conflicts0 = SERVER ? 0 : api.conflicts.length;
    await Promise.all([u.pg.live(), v.pg.live()]);
    check(await until(async () => titlesOf(await colU('Maladies')) === 'Grippe|Peste|Lèpre|Variole'), 'deux onglets : ' + titlesOf(await colU('Maladies')));
    await settle(300);
    const said = [u, v].filter((x) => x.toast().includes('ajoutée automatiquement'));
    check(said.length === 1 && said[0].toast().includes('1 carte ajoutée automatiquement à « Maladies ».'), 'deux onglets : une seule notification attendue : ' + u.toast() + ' / ' + v.toast());
    const n2 = saves(from).length;
    check(n2 === 1 || (n2 === 2 && (SERVER || api.conflicts.length === conflicts0 + 1)), 'deux onglets : un ajout, l\'autre refusé (409) : ' + n2);
    console.log(`ajout automatique, deux onglets : ${n2} ${n2 > 1 ? 'envois (le second refusé, 409, puis rien à ajouter)' : 'envoi'}`);
    check(titlesOf(await colU('Maladies')) === 'Grippe|Peste|Lèpre|Variole', 'deux onglets : doublon');
    // Collection changée ailleurs (un autre appareil) depuis la dernière lecture de la page : l'envoi est refusé (409), la
    // page repart de la collection d'aujourd'hui (rien d'écrasé) et ajoute quand même la nouvelle carte.
    {
      const cur = await colU('Maladies');
      check((await rawApi('POST', '/api/targets/save', keyU, { id: cur.id, name: cur.name, items: [...cur.items, itU('Ajoutée ailleurs')] })).status === 200, 'changement ailleurs refusé');
      await more(mkU('u11', 'Coqueluche', 'maladie infectieuse', ['Maladie']));
      from = apiLog.length;
      const c0 = SERVER ? 0 : api.conflicts.length;
      await u.pg.live();
      check(await until(async () => titlesOf(await colU('Maladies')) === 'Grippe|Peste|Lèpre|Variole|Ajoutée ailleurs|Coqueluche'),
        'changement ailleurs écrasé, ou carte non ajoutée : ' + titlesOf(await colU('Maladies')));
      check(saves(from).length === 2 && (SERVER || api.conflicts.length === c0 + 1), 'changement ailleurs : un envoi refusé (409) puis un autre attendus : ' + saves(from).length);
      check(await waitFor(() => u.toast().includes('1 carte ajoutée automatiquement à « Maladies ».')), 'changement ailleurs : notification ' + u.toast());
    }

    // Trois collections à règles (deux créées ici par l'API, avec leurs règles) : une notification pour toutes ; « Grande »
    // (à 100 octets des 1,7 Mo) ne prend que la première de ses deux cartes (de A à Z), envoyée en morceaux (plus de 600
    // Ko), la notification le dit, rien ne casse.
    check((await rawApi('POST', '/api/targets/save', keyU, { name: 'Virus', items: [itU('Grippe')], auto: { rules: [{ k: 'gtag', v: 'Virus' }] } })).status === 200, 'collection « Virus » refusée');
    const grande = [];
    {
      const room = 1_700_000 - 100;
      let b = 1;
      const full = (i) => itU('Élément ' + i, { qid: 'Q' + (7000000 + i), description: 'd'.repeat(400) });
      for (let i = 0; ; i++) {
        const n = Buffer.byteLength(JSON.stringify(full(i))) + 1;
        if (b + n + 100 > room) break;
        grande.push(full(i));
        b += n;
      }
      const last = itU('Élément ' + grande.length, { qid: 'Q' + (7000000 + grande.length), description: '' });
      last.description = 'd'.repeat(room - b - Buffer.byteLength(JSON.stringify(last)) - 1);
      grande.push(last);
      check(Buffer.byteLength(JSON.stringify(grande)) === room, 'remplissage de « Grande » : ' + Buffer.byteLength(JSON.stringify(grande)));
      check((await rawSave(keyU, { name: 'Grande', items: grande, auto: { rules: [{ k: 'cat', v: 'géant' }] } })).status === 200, 'collection « Grande » refusée');
    }
    const parts0 = SERVER ? 0 : api.uploadParts;
    const w = await pageU();
    await settle(150);
    await more(mkU('v1', 'Herpès', 'infection virale', ['Virus']), mkU('v2', 'Zona', 'infection virale', ['Virus', 'Maladie']), mkU('g1', 'Séquoia', 'Géant'), mkU('g2', 'Baleine bleue', 'géant'));
    from = apiLog.length;
    await w.pg.live();
    check(await waitFor(() => w.toast().includes('4 cartes ajoutées automatiquement : 1 à « Maladies », 2 à « Virus » et 1 à « Grande ».')
      && w.toast().includes("« Grande » est pleine : 1 carte de ses règles d'ajout automatique n'a pas pu y entrer (1,7 Mo au plus par collection)."), 5000),
    'trois collections : notification ' + w.toast());
    check(saves(from).length >= 4 && (SERVER || api.uploadParts - parts0 === saves(from).length - 2), 'une requête par collection, « Grande » en morceaux : ' + saves(from).length);
    check(titlesOf(await colU('Maladies')) === 'Grippe|Peste|Lèpre|Variole|Ajoutée ailleurs|Coqueluche|Zona' && titlesOf(await colU('Virus')) === 'Grippe|Herpès|Zona',
      'trois collections : ' + titlesOf(await colU('Maladies')) + ' / ' + titlesOf(await colU('Virus')));
    const big = await colU('Grande');
    check(big.items.length === grande.length + 1 && big.items[grande.length].title === 'Baleine bleue' && big.items[0].title === 'Élément 0',
      'collection pleine : ' + big.items.length + ' / ' + big.items[big.items.length - 1].title);
    // Une autre carte, hors des règles : « Grande » est toujours pleine, l'avertissement n'est pas répété ; aucune requête.
    await more(mkU('x1', 'Caillou', 'pierre'));
    from = apiLog.length;
    await w.pg.live();
    await settle(300);
    check(w.toast().includes('Mis à jour depuis wiki-masters.com') && !w.toast().includes('est pleine') && !saves(from).length, 'avertissement répété sans changement : ' + w.toast());

    // « Arrêter » (album de « Maladies ») : règles et exclusions effacées, cartes gardées ; « Annuler » les remet ; arrêté de
    // nouveau, une nouvelle carte du tag n'est plus ajoutée.
    await w.open('Maladies');
    from = apiLog.length;
    w.btnIn(w.autoLine(), 'Arrêter').click();
    check(await until(async () => (await colU('Maladies')).auto === null), '« Arrêter » : règles non effacées');
    check(titlesOf(await colU('Maladies')) === 'Grippe|Peste|Lèpre|Variole|Ajoutée ailleurs|Coqueluche|Zona' && saves(from).length === 1, '« Arrêter » : cartes non gardées');
    check(await waitFor(() => !w.autoLine() && w.toast().includes('Ajout automatique arrêté pour « Maladies » : les cartes déjà ajoutées restent.')), '« Arrêter » : ' + w.toast());
    w.d.querySelectorAll('.toast')[0].querySelectorAll('button').find((b) => text(b) === 'Annuler').click();
    check(await until(async () => autoOfU(await colU('Maladies')) === JSON.stringify({ rules: [{ k: 'gtag', v: 'Maladie' }], skip: ['Rougeole', 'Choléra', 'Typhus'] })),
      '« Annuler » de « Arrêter » : règles non remises : ' + autoOfU(await colU('Maladies')));
    check(await waitFor(() => !!w.autoLine()), '« Annuler » de « Arrêter » : ligne absente');
    await settle(80);
    w.btnIn(w.autoLine(), 'Arrêter').click();
    check(await until(async () => (await colU('Maladies')).auto === null), '« Arrêter » (2) : règles non effacées');
    await settle(80);
    await more(mkU('u10', 'Diphtérie', 'maladie infectieuse', ['Maladie']));
    from = apiLog.length;
    await w.pg.live();
    await settle(300);
    check(!saves(from).length && titlesOf(await colU('Maladies')) === 'Grippe|Peste|Lèpre|Variole|Ajoutée ailleurs|Coqueluche|Zona', 'après « Arrêter » : carte ajoutée quand même');
    w.btnIn(w.d.body, '← Toutes les collections').click();
    await settle();
    check(!(w.row('Maladies').getAttribute('aria-label') || '').includes('Ajout automatique') && (w.row('Virus').getAttribute('aria-label') || '').includes('Ajout automatique'),
      'marques de « Mes collections » après « Arrêter »');
  }

  // Marché : valeur dans le bandeau, onglet « Marché » (graphique, bonnes affaires, cartes qui bougent, mes enchères et
  // ventes, règles), cotes dans les fiches (carte possédée : par exemplaire, « ~ » sous 3 ventes ; carte qui manque : par
  // rareté). Données posées dans l'API simulée (le favori les enverrait).
  if (!SERVER) {
    const keyM = await makeOtherAccount('Mona');
    api.link(keyM);
    const um = api.users.find((u) => u.key === keyM);
    const mc = (id, title, rarity, count, extra = {}) => ({ id, title, rarity, atk: 1, def: 1, quality: 1, pageviews: 10, category: 'essai', image: null, url: null, count, shiny: false, starred: false, obtained_at: '2026-10-01T00:00:00Z', ...extra });
    const ventes = Array.from({ length: 24 }, (_, i) => mc('v' + String(i + 1).padStart(2, '0'), 'Vente ' + String(i + 1).padStart(2, '0'), 'C', 1, { variants: { C: 1 } }));
    await seedCards(keyM, [mc('m1', 'Marché 1', 'R', 3, { shiny: true, variants: { R: 2, 'R*': 1 } }), mc('m2', 'Marché 2', 'C', 1), mc('m3', 'Marché 3', 'C', 1, { variants: { C: 1 } }),
      ...ventes, mc('m9', 'Sans cote M', 'C', 1, { variants: { C: 1 } }), mc('vf', 'Favorite F', 'C', 1, { starred: true, variants: { C: 1 } })]);
    const it = (title) => ({ title, description: null, image: null, status: 'ok' });
    await rawApi('POST', '/api/targets/save', keyM, { name: 'Envies', items: [it('Voulue A'), it('Marché 1'), it('Marché 2'), it('Marché 3'), it('Voulue B')] });
    // Nino, un ami qui montre ses cartes et ses collections : Marché 1 (2 exemplaires dont 1 brillant), Voulue A, une carte
    // jamais cotée ; sa collection « Cotées ». Mona montre les siennes.
    const keyN = await makeOtherAccount('Nino');
    await seedCards(keyN, [mc('m1', 'Marché 1', 'R', 2, { shiny: true }), mc('w1', 'Voulue A', 'SR', 1), mc('n3', 'Sans cote', 'C', 1)]);
    await rawApi('POST', '/api/targets/save', keyN, { name: 'Cotées', items: [it('Marché 1'), it('Voulue A'), it('Absente')] });
    for (const k of [keyN, keyM]) check((await rawApi('PATCH', '/api/me', k, { shared: true, shared_targets: true })).status === 200, 'partage refusé (marché)');
    const soon = new Date(Date.now() + 3600_000).toISOString();
    const q = (p, n, w = null) => ({ p, n, w, l: p - 1, d: '2026-10-15T10:00:00.000Z' });
    um.market = {
      value: { value: 1234, priced: 2, cards: 3, approx: 1 },
      history: [{ date: '2026-10-14', value: 1000, priced: 2, cards: 3 }, { date: '2026-10-15', value: 1100, priced: 2, cards: 3 }, { date: '2026-10-16', value: 1234, priced: 2, cards: 3 }],
      live_at: new Date().toISOString(),
      attempt: { start: new Date(Date.now() - 60_000).toISOString(), end: new Date().toISOString(), ok: true, v: 'serveur', auto: true },
      live: {
        // Voulue A deux fois (la moins chère reste, l'autre comptée) ; Voulue B finie depuis la lecture ; Marché 3, que
        // Mona a maintenant : ni l'une ni l'autre montrées.
        deals: [{ a: 'a0', id: 'w1', t: 'Voulue A', r: 'SR', s: false, img: null, end: soon, cote: 100, n: 5, ask: 70, bid: true, lead: false, more: 0 },
          { a: 'a1', id: 'w1', t: 'Voulue A', r: 'SR', s: false, img: null, end: soon, cote: 100, n: 5, ask: 50, bid: false, lead: false },
          { a: 'a2', id: 'w2', t: 'Voulue B', r: 'R', s: false, img: null, end: '2026-10-15T08:00:00.000Z', cote: 50, n: 3, ask: 10, bid: false, lead: false, more: 0 },
          { a: 'a3', id: 'm3', t: 'Marché 3', r: 'C', s: false, img: null, end: soon, cote: 10, n: 4, ask: 2, bid: false, lead: false, more: 0 }],
        bids: [{ a: 'b1', id: 'm3', t: 'Marché 3', r: 'C', s: false, img: null, end: soon, cote: 10, n: 4, mine: 8, cur: 9, lead: false, st: 'run' },
          { a: 'b2', id: 'x9', t: 'Ailleurs', r: 'L', s: true, img: null, end: '2026-10-15T08:00:00.000Z', cote: null, n: null, mine: 300, cur: 300, lead: false, st: 'won' }],
        sales: [{ a: 's1', id: 'm2', t: 'Marché 2', r: 'C', s: false, img: null, end: '2026-10-15T09:00:00.000Z', cote: 20, n: 5, base: 5, cur: 12, bid: true, st: 'sold' },
          // Favorite F, en vente dans le jeu (enchère en cours) mais encore dans le classeur : pas proposée « à vendre ».
          { a: 's2', id: 'vf', t: 'Favorite F', r: 'C', s: false, img: null, end: soon, cote: 300, n: 5, base: 250, cur: null, bid: false, st: 'run' }],
      },
      prices: [
        { id: 'm1', v: { R: q(400, 10, 300), 'R*': q(900, 2) }, at: '2026-10-16T08:00:00.000Z' },
        { id: 'm2', v: { C: q(20, 5, 25) }, at: '2026-10-16T08:00:00.000Z' },
        { id: 'w1', v: { SR: q(100, 5), 'SR*': q(260, 1) }, at: '2026-10-16T08:00:00.000Z', t: 'Voulue A' },
        { id: 'w2', v: { R: q(50, 1) }, at: '2026-10-16T08:00:00.000Z', t: 'Voulue B' }, // une seule vente : peu fiable
        ...ventes.map((c, i) => ({ id: c.id, v: { C: q(20 * (i + 1) + 25, 5) }, at: '2026-10-16T08:00:00.000Z' })),
        { id: 'vf', v: { C: q(300, 5) }, at: '2026-10-16T08:00:00.000Z' }, // favorite dans le jeu : jamais à vendre
      ],
    };
    ls.set('classeur-key', keyM);
    ls.set('classeur-known', JSON.stringify([{ key: keyM, name: 'Mona' }]));
    const pm = openPage({ idb: 'absent' });
    const d = pm.doc;
    const body = () => text(d.body);
    const btn = (t) => d.querySelectorAll('button').find((b) => text(b).trim() === t) || null;
    check(await waitFor(() => pm.count() === 29), 'classeur de Mona non ouvert');
    check(await waitFor(() => body().includes('1 234W') && body().includes('valeur (2 cotées)')), 'valeur absente du bandeau : ' + body().slice(0, 400));
    // Les montants : « 1 234W » (W collé, séparateur des milliers gardé), en vert (classe w) ; la tuile du bandeau aussi.
    const tile = d.querySelectorAll('.figure').find((n) => text(n).includes('valeur ('));
    check(tile && tile.querySelector('.w') && text(tile.querySelector('.w')) === '1 234W', 'tuile de la valeur : montant en vert attendu');
    // Valeur d'une collection : ses cartes cotées (Marché 1 : 2 rares à 400W, la brillante n'a que 2 ventes ; Marché 2 :
    // approchée, 20W ; Marché 3 : pas de cote), et ce qu'il faudrait pour la compléter (Voulue A : la moins chère de ses
    // cotes fiables, 100W ; Voulue B : pas de cote).
    const envies = () => d.querySelectorAll('.row').find((n) => text(n.querySelector('.name')) === 'Envies') || null;
    check(await waitFor(() => envies() && envies().querySelector('.row-value')), 'ligne de « Envies » : valeur absente');
    check(text(envies().querySelector('.row-value')) === 'valeur 820W · pour la compléter ~100W' && envies().querySelector('.row-value').querySelectorAll('.w').length === 2
      && /Valeur : 820W \(2 cartes cotées sur 3\) ; pour la compléter : ~100W \(1 carte cotée sur 2 qui manquent\)/.test((envies().getAttribute('aria-label') || '').replace(/[\u00a0\u202f]/g, ' ')),
      'ligne de « Envies » : ' + text(envies().querySelector('.row-value')) + ' / ' + envies().getAttribute('aria-label'));
    envies().click();
    await settle(60);
    const head = () => text(d.querySelectorAll('.album-head')[0]);
    check(head().includes('3 sur 5') && head().includes('Valeur : 820W (2 cartes cotées sur 3)') && head().includes('Pour la compléter : ~100W(1 carte cotée sur 2 qui manquent, à la moins chère de leurs cotes)'),
      'album « Envies » : ' + head().slice(0, 500));
    check(d.querySelectorAll('.album-value').length === 1 && d.querySelectorAll('.album-value')[0].querySelectorAll('.w').length === 1 && d.querySelectorAll('.worth-sum')[0].querySelectorAll('.w').length === 1, 'album « Envies » : montants en vert attendus');
    // Tris par prix de l'album : tes cartes (cote de ton meilleur exemplaire) et les cases vides (celle de « Pour la
    // compléter ») ; « ~ » (Voulue B, une vente) après les cotes fiables, puis sans cote (Marché 3), dans les deux sens.
    const gridTitles = () => (d.querySelectorAll('.cardgrid')[0] ? d.querySelectorAll('.cardgrid')[0].childNodes.filter((n) => n.nodeType === 1).map((n) => text(n.querySelector('h3'))) : []);
    const segBtn = (label) => d.querySelectorAll('button').find((b) => text(b) === label && b.getAttribute('aria-pressed') !== null) || null;
    segBtn('Prix ↑').click();
    await settle(40);
    check(gridTitles().join(' | ') === 'Marché 2 | Voulue A | Marché 1 | Voulue B | Marché 3' && segBtn('Prix ↑').getAttribute('aria-pressed') === 'true', 'album, prix croissant : ' + gridTitles().join(' | '));
    segBtn('Prix ↓').click();
    await settle(40);
    check(gridTitles().join(' | ') === 'Marché 1 | Voulue A | Marché 2 | Voulue B | Marché 3', 'album, prix décroissant : ' + gridTitles().join(' | '));
    check(segBtn('Prix ↓').getAttribute('aria-label') === 'Prix décroissant', 'tri « Prix ↓ » : libellé lisible attendu');
    btn('← Toutes les collections').click();
    await settle(40);
    d.getElementById('tab-marche').click();
    await settle(80);
    const panel = () => text(d.getElementById('panel-marche'));
    check(/Valeur de ton classeur/.test(panel()) && panel().includes('1 234W · 2 cartes cotées sur 3') && panel().includes('Dont 1 carte comptée dans sa plus haute rareté'), 'valeur de l\'onglet Marché : ' + panel().slice(0, 300));
    // Graphique : une ligne de 3 points, lisible sans couleur (valeur et date au-dessus, tableau des valeurs).
    const svg = d.querySelectorAll('svg').find((n) => n.classList.contains('chart__svg'));
    check(svg && svg.querySelectorAll('polyline').length === 1 && svg.querySelectorAll('circle').length === 3 && /Valeur du classeur, un point par jour/.test(svg.getAttribute('aria-label') || ''), 'graphique de la valeur absent');
    check(d.querySelectorAll('.chart__table')[0].querySelectorAll('tr').length === 4 && panel().includes('Voir les valeurs'), 'tableau des valeurs absent');
    // Bonnes affaires : carte qui manque, prix demandé, écart à la cote, « finit bientôt », collection qu'elle complète.
    check(panel().includes('Voulue A') && panel().includes('50W (prix de départ, sans enchère) · cote 100W (−50 %)') && panel().includes('finit bientôt') && panel().includes('pour « Envies »'), 'bonnes affaires : ' + panel());
    // Une seule par carte (la moins chère, l'autre comptée) ; finies depuis la lecture ou carte que tu as maintenant : plus
    // montrées, et dit.
    {
      const buy = text(d.querySelectorAll('section').find((n) => n.getAttribute('data-section') === 'acheter'));
      check(!buy.includes('70W (enchère en cours)') && buy.includes('1 autre enchère intéressante sur cette carte') && !buy.includes('Voulue B') && !buy.includes('Marché 3'),
        'bonnes affaires, doublons, enchères finies ou cartes déjà là : ' + buy);
    }
    check(panel().includes('Plus montrées : 1 enchère finie depuis la lecture, 1 carte que tu as maintenant.'), 'bonnes affaires écartées non dites : ' + panel());
    // Âge de la lecture, essai réussi : rien d'autre à dire.
    check(panel().includes("Lecture du marché par le classeur : à l'instant") && !panel().includes("n'est pas à jour") && !panel().includes('Dernier essai'), 'âge de la lecture du marché : ' + panel().slice(0, 900));
    // Sections : « à acheter » et « à vendre » côte à côte, puis « Mes enchères » sur toute la largeur (plus de « Cartes
    // qui bougent ») ; accordéon, « Mes enchères » fermée par défaut (rien de rendu), état gardé par classeur.
    const sections = () => d.getElementById('panel-marche').querySelectorAll('section').filter((n) => n.classList.contains('acc'));
    const section = (id) => sections().find((n) => n.getAttribute('data-section') === id) || null;
    const accBtn = (id) => section(id).querySelector('.acc__btn');
    check(sections().map((n) => n.getAttribute('data-section') + (n.classList.contains('market__wide') ? '*' : '')).join(',') === 'valeur,ventes*,acheter,vendre,encheres*',
      'sections du Marché : ' + sections().map((n) => n.getAttribute('data-section')).join(','));
    // « Valeur de ton classeur » : repliable comme les autres, ouverte par défaut ; repliée, son titre garde la valeur.
    check(accBtn('valeur').getAttribute('aria-expanded') === 'true' && d.querySelectorAll('.market__big').length === 1, '« Valeur de ton classeur » doit être ouverte par défaut');
    accBtn('valeur').click();
    await settle(40);
    check(accBtn('valeur').getAttribute('aria-expanded') === 'false' && !d.querySelectorAll('.market__big').length && text(accBtn('valeur')).includes('1 234W')
      && Object.values(JSON.parse(ls.get('classeur-marche') || '{}'))[0].open.valeur === false, '« Valeur de ton classeur » repliée : ' + text(accBtn('valeur')));
    accBtn('valeur').click();
    await settle(40);
    check(accBtn('valeur').getAttribute('aria-expanded') === 'true' && d.querySelectorAll('.market__big').length === 1, '« Valeur de ton classeur » ne se rouvre pas');
    check(!panel().includes('Cartes qui bougent') && !d.querySelectorAll('.movers').length, '« Cartes qui bougent » encore là');
    check(text(accBtn('acheter')).includes('Bonnes affaires à acheter1'), 'nombre de bonnes affaires montrées dans le titre : ' + text(accBtn('acheter')));
    check(['acheter', 'vendre'].every((id) => accBtn(id).getAttribute('aria-expanded') === 'true') && accBtn('encheres').getAttribute('aria-expanded') === 'false'
      && !text(section('encheres')).includes('Tes mises') && text(accBtn('encheres')).includes('2 mises · 2 ventes'), '« Mes enchères » doit être fermée par défaut : ' + text(section('encheres')));
    check(text(accBtn('acheter')).startsWith('Bonnes affaires à acheter') && text(accBtn('vendre')).startsWith('Bonnes affaires à vendre'), 'titres des deux colonnes');
    accBtn('encheres').click();
    await settle(40);
    check(accBtn('encheres').getAttribute('aria-expanded') === 'true' && text(section('encheres')).includes('Tes mises'), '« Mes enchères » ne s\'ouvre pas');
    const prefs = () => JSON.parse(ls.get('classeur-marche') || '{}');
    check(Object.values(prefs()).length === 1 && Object.values(prefs())[0].open.encheres === true && Object.values(prefs())[0].open.acheter === true, 'état des sections non gardé : ' + ls.get('classeur-marche'));
    accBtn('vendre').click();
    await settle(40);
    check(accBtn('vendre').getAttribute('aria-expanded') === 'false' && !section('vendre').querySelector('.lots') && Object.values(prefs())[0].open.vendre === false, '« Bonnes affaires à vendre » ne se ferme pas');
    accBtn('vendre').click();
    await settle(40);
    // « Bonnes affaires à vendre » : seuil 100W par défaut ; « Cacher les cartes de mes collections » cochée par défaut :
    // 21 « Vente » (105W à 505W) et Favorite F (300W : une favorite du jeu reste proposée), pas Marché 1, 2 ni 3 (dans
    // « Envies ») ; du plus cher au moins cher ; 20 lignes puis « Afficher 2 de plus » ; une carte sans cote annoncée.
    // Décochée : Marché 1 aussi (3 exemplaires, un gardé, « 2 en trop » à 400W), jamais Marché 2 ni 3 (un seul exemplaire).
    {
      const sell = () => section('vendre');
      const rows = () => sell().querySelectorAll('li').map((n) => text(n.querySelector('.lot__title').querySelector('button')));
      check(d.getElementById('sell-min') && String(d.getElementById('sell-min').value) === '100', 'seuil par défaut : 100 attendu');
      check(d.getElementById('sell-hide-col') && d.getElementById('sell-hide-col').checked === true, '« Cacher les cartes de mes collections » absente ou décochée par défaut');
      check(rows().length === 20 && rows().slice(0, 8).join(' | ') === 'Vente 24 | Vente 23 | Vente 22 | Vente 21 | Vente 20 | Vente 19 | Vente 18 | Vente 17' && !rows().some((t) => t.startsWith('Marché')),
        'à vendre (20 premières) : ' + rows().join(' | '));
      check(text(sell()).includes('1 carte sans cote fiable : le classeur les lit peu à peu'), 'cartes sans cote non annoncées : ' + text(sell()));
      const more = sell().querySelectorAll('button').find((b) => text(b).startsWith('Afficher'));
      check(more && text(more) === 'Afficher 1 de plus (1 restante)', 'bouton « Afficher plus » : ' + (more ? text(more) : 'absent'));
      more.click();
      await settle(40);
      check(rows().length === 21 && rows().slice(-2).join(' | ') === 'Vente 05 | Vente 04' && !sell().querySelectorAll('button').some((b) => text(b).startsWith('Afficher')), 'après « Afficher plus » : ' + rows().length);
      // Favorite F : en vente dans le jeu (enchère en cours), encore dans le classeur : pas proposée, et la ligne le dit.
      check(!rows().includes('Favorite F') && text(sell()).includes('1 carte déjà en vente dans le jeu (« Mes enchères ») : pas proposée ici, même si ton classeur la garde encore.'),
        'carte déjà en vente proposée : ' + text(sell()).slice(-300));
      // Case décochée : les exemplaires en trop des cartes de tes collections (Marché 1), réglage gardé ; recochée ensuite.
      d.getElementById('sell-hide-col').dispatch('change');
      await settle(40);
      const m1 = sell().querySelectorAll('li').find((n) => text(n).includes('Marché 1'));
      check(rows().length === 20 && rows().slice(6, 8).join(' | ') === 'Marché 1 | Vente 18' && !rows().some((t) => t === 'Marché 2' || t === 'Marché 3') && Object.values(prefs())[0].hideCol === false,
        'case décochée : ' + rows().slice(0, 8).join(' | ') + ' / ' + ls.get('classeur-marche'));
      check(m1 && text(m1).includes('2 en trop') && text(m1).includes('400W · 10 ventes · dernière 399W le 15 octobre') && m1.querySelector('.copy-name') && m1.querySelector('.w'), 'ligne de Marché 1 : ' + (m1 ? text(m1) : 'absente'));
      d.getElementById('sell-hide-col').dispatch('change');
      await settle(40);
      check(!rows().includes('Marché 1') && Object.values(prefs())[0].hideCol === true, 'case recochée : Marché 1 doit disparaître');
      type(d.getElementById('sell-min'), '450');
      await settle(40);
      check(rows().join(' | ') === 'Vente 24 | Vente 23 | Vente 22' && Object.values(prefs())[0].min === 450, 'seuil 450W : ' + rows().join(' | ') + ' / ' + ls.get('classeur-marche'));
      type(d.getElementById('sell-min'), '');
      await settle(40);
      check(rows().length === 3 && Object.values(prefs())[0].min === 450, 'champ vidé : le seuil ne doit pas bouger');
      // Une ligne ouvre la fiche de la carte.
      sell().querySelectorAll('li')[0].querySelector('.lot__title').querySelector('button').click();
      await settle(60);
      check(d.querySelectorAll('.fiche').length === 1 && text(d.querySelectorAll('.fiche')[0]).includes('Vente 24'), 'fiche de la carte à vendre absente');
      d.querySelectorAll('.fiche')[0].querySelectorAll('button.close')[0].click();
      await settle(40);
    }
    // Mes enchères et mes ventes.
    check(panel().includes('ta mise 8W · enchère actuelle 9W · cote 10W (−10 %)') && panel().includes('dépassée') && panel().includes('gagnée') && panel().includes('pas de cote'), 'mes enchères : ' + panel());
    check(panel().includes('départ 5W · vendue 12W · cote 20W (−40 %)'), 'mes ventes : ' + panel());
    check(panel().includes('sont faites par le classeur, dans la base du jeu, avec le compte que tu as relié (onglet « Synchro »)') && panel().includes('une passe par membre toutes les 20 minutes')
      && panel().includes('30 requêtes, une par seconde') && panel().includes("la passe s'arrête et la suivante est sautée"), 'avertissement des règles absent');
    // Aucun « 12 W » (espace avant le W) ; les montants de l'onglet en vert (classe w), hors écarts (hausse, baisse).
    check(!/\d W\b/.test(panel()), 'montant avec une espace avant le W : ' + panel().match(/.{0,30}\d W\b.{0,10}/));
    check(d.getElementById('panel-marche').querySelectorAll('.w').length >= 12 && text(d.querySelectorAll('.market__big')[0].querySelector('.w')) === '1 234W', "montants de l'onglet Marché : classe w attendue");
    // « Mettre en vente » depuis « Bonnes affaires à vendre » (seuil 450W : Vente 24, 23, 22) : la fenêtre lit les
    // exemplaires dans le jeu et le marché de la carte, propose la cote, prévient d'un départ bien sous la cote ; la vente
    // part au serveur (rareté, prix, durée), puis s'annule depuis la fenêtre.
    {
      const md = () => d.querySelectorAll('.modal')[0] || null;
      const mdText = () => (md() ? text(md()) : '');
      const inMd = (t) => (md() ? md().querySelectorAll('button').find((b) => text(b).trim() === t) || null : null);
      const sell = () => section('vendre');
      const row24 = sell().querySelectorAll('li').find((n) => text(n).includes('Vente 24'));
      const from = apiLog.length;
      row24.querySelectorAll('button').find((b) => text(b) === 'Mettre en vente').click();
      await settle(60);
      check(md() && md().classList.contains('sell') && mdText().includes('Mettre en vente « Vente 24 »'), 'fenêtre de vente absente : ' + mdText().slice(0, 200));
      // Exemplaires lus dans le jeu ; le marché de la carte, lu à l'ouverture de sa fiche juste avant, vient du cache.
      check(await waitFor(() => apiLog.slice(from).includes('GET /api/market/sell?id=v24')) && !apiLog.slice(from).includes('GET /api/market/card?id=v24'), 'lectures de la fenêtre : ' + apiLog.slice(from).join(', '));
      await settle(40);
      check(String(d.getElementById('sell-base').value) === '505' && inMd('la cote · 505W') && inMd('la dernière vente · 504W'), 'prix proposés : ' + mdText());
      check(mdText().includes('Cote · Commune505W · 5 ventes') && mdText().includes('Tes enchères actives1 / 5') && mdText().includes('Commune · départ 505W · 1 h'), 'marché dans la fenêtre : ' + mdText());
      check(mdText().includes('Enchères en cours') && mdText().includes('Personne ne vend cette carte en ce moment.'), 'enchères de la carte dans la fenêtre : ' + mdText());
      type(d.getElementById('sell-base'), '300');
      await settle(30);
      check(mdText().includes('Départ 41 % sous la cote (505W)'), 'avertissement sous la cote : ' + mdText());
      inMd('3 h').click();
      await settle(30);
      inMd('Mettre en vente dans le jeu').click();
      await settle(80);
      check(api.sold.length === 1 && api.sold[0].id === 'v24' && api.sold[0].k === 'C' && api.sold[0].base === 300 && api.sold[0].minutes === 180, 'vente envoyée : ' + JSON.stringify(api.sold));
      check(mdText().includes('« Vente 24 » est en vente dans le jeu.') && mdText().includes('Commune, départ 300W') && md().querySelectorAll('a').some((a) => a.getAttribute('href') === 'https://www.wiki-masters.com/marketplace/vente-1'),
        'vente faite : ' + mdText());
      inMd('Annuler la vente').click();
      await settle(80);
      check(api.cancelled.join() === 'vente-1' && mdText().includes('Vente annulée.') && !inMd('Annuler la vente'), 'annulation depuis la fenêtre : ' + mdText());
      inMd('Fermer').click();
      await settle(40);
      check(!md(), 'fenêtre de vente pas refermée');
      // Refus du jeu (vérification anti-robot) : le message et un lien vers le jeu.
      type(d.getElementById('sell-min'), '100');
      await settle(40);
      sell().querySelectorAll('li').find((n) => text(n).includes('Vente 23')).querySelectorAll('button').find((b) => text(b) === 'Mettre en vente').click();
      await settle(80);
      api.sellFail = { status: 409, error: 'Le jeu demande de vérifier que tu es bien humain.', extra: { verify: true } };
      inMd('Mettre en vente dans le jeu').click();
      await settle(80);
      check(mdText().includes('Le jeu demande de vérifier que tu es bien humain.') && md().querySelectorAll('a').some((a) => a.getAttribute('href') === 'https://www.wiki-masters.com/collection'), 'vérification demandée : ' + mdText());
      inMd('Annuler').click();
      await settle(40);
      type(d.getElementById('sell-min'), '450');
      await settle(40);
      // « Mes enchères » : une vente en cours sans mise s'annule (confirmation) ; le jeu refuse si quelqu'un a misé.
      const salesLi = () => section('encheres').querySelectorAll('li').filter((n) => text(n).includes('Favorite F') && text(n).includes('sans enchère'));
      check(salesLi().length === 1 && salesLi()[0].querySelectorAll('button').some((b) => text(b) === 'Annuler la vente'), 'annulation dans « Mes enchères » absente');
      api.cancelFail = { status: 409, error: "Quelqu'un a déjà misé sur cette vente : le jeu ne permet plus de l'annuler.", extra: { has_bid: true } };
      salesLi()[0].querySelectorAll('button').find((b) => text(b) === 'Annuler la vente').click();
      await settle(40);
      check(mdText().includes('Retirer « Favorite F » du marché du jeu ?'), 'confirmation absente : ' + mdText());
      inMd('Annuler la vente').click();
      await settle(80);
      check(mdText().includes("Quelqu'un a déjà misé sur cette vente"), 'refus du jeu absent : ' + mdText());
      inMd('Annuler').click();
      await settle(40);
    }
    // « Mes ventes en cours » (ouverte par défaut, en haut) : Favorite F, mises relues sur le site du jeu, annulable ; une
    // vente faite depuis la fenêtre y arrive, avec une mise elle n'est plus annulable, et une annulation l'en retire.
    {
      const enc = () => section('ventes');
      const rowsOf = () => enc().querySelectorAll('li');
      check(accBtn('ventes').getAttribute('aria-expanded') === 'true' && text(accBtn('ventes')).startsWith('Mes ventes en cours'), '« Mes ventes en cours » fermée ou absente');
      check(await waitFor(() => apiLog.includes('GET /api/market/auction?id=s2')), 'mises de Favorite F pas relues : ' + apiLog.slice(-8).join(', '));
      await settle(40);
      check(rowsOf().length === 1 && text(rowsOf()[0]).includes('Favorite F') && text(rowsOf()[0]).includes('départ 250W') && text(rowsOf()[0]).includes('sans enchère')
        && rowsOf()[0].querySelectorAll('button').some((b) => text(b) === 'Annuler la vente'), 'ventes en cours : ' + text(enc()));
      // Une vente depuis la fenêtre (Vente 22, 3 h), puis une mise reçue : plus annulable.
      section('vendre').querySelectorAll('li').find((n) => text(n).includes('Vente 22')).querySelectorAll('button').find((b) => text(b) === 'Mettre en vente').click();
      await settle(80);
      const md = () => d.querySelectorAll('.modal')[0] || null;
      md().querySelectorAll('button').find((b) => text(b).trim() === 'Mettre en vente dans le jeu').click();
      await settle(80);
      md().querySelectorAll('button').find((b) => text(b).trim() === 'Fermer').click();
      await settle(80);
      check(await waitFor(() => rowsOf().length === 2) && rowsOf().some((n) => text(n).includes('Vente 22') && n.querySelectorAll('button').some((b) => text(b) === 'Annuler la vente')),
        'vente faite depuis la fenêtre absente des ventes en cours : ' + text(enc()));
      const v22 = um.market.live.sales.find((x) => x.t === 'Vente 22');
      Object.assign(v22, { bid: true, cur: 600 });
      enc().querySelectorAll('button').find((b) => text(b) === 'Relire les mises').click();
      await settle(80);
      const row22 = rowsOf().find((n) => text(n).includes('Vente 22'));
      check(text(row22).includes('enchère 600W') && text(row22).includes('1 mise') && text(row22).includes('mène : Acheteur') && text(row22).includes('plus annulable')
        && !row22.querySelectorAll('button').some((b) => text(b) === 'Annuler la vente'), 'vente avec une mise : ' + text(row22));
      // Annuler Favorite F : confirmation, puis elle quitte la section.
      rowsOf().find((n) => text(n).includes('Favorite F')).querySelectorAll('button').find((b) => text(b) === 'Annuler la vente').click();
      await settle(40);
      md().querySelectorAll('button').find((b) => text(b).trim() === 'Annuler la vente').click();
      await settle(120);
      check(api.cancelled.includes('s2') && await waitFor(() => rowsOf().length === 1 && !text(enc()).includes('Favorite F')), 'annulation depuis les ventes en cours : ' + text(enc()));
    }
    // Fiche d'une carte possédée (depuis « Mes cartes ») : cote de chaque exemplaire.
    d.getElementById('tab-cartes').click();
    await settle(60);
    d.querySelectorAll('.cell').find((n) => text(n).includes('Marché 1')).querySelector('.card').dispatch('click');
    await settle(60);
    const fiche = () => text(d.querySelectorAll('.fiche')[0]);
    check(/Cote/.test(fiche()) && fiche().includes('2 × Rare400W10 ventes · dernière 399W le 15 octobre · 7 jours : +33 %') && fiche().includes('Rare, brillante~900W2 ventes'), 'cote de la fiche : ' + fiche());
    check(fiche().includes('Tes exemplaires cotés : 800W'), 'total des exemplaires : ' + fiche());
    {
      const approx = d.querySelectorAll('.fiche')[0].querySelectorAll('.w').filter((n) => n.classList.contains('approx'));
      check(approx.length === 1 && text(approx[0]) === '~900W' && d.querySelectorAll('.fiche')[0].querySelectorAll('.cote__row').every((n) => n.querySelector('.w')),
        'cote peu fiable : « ~900W » estompé attendu');
    }
    d.querySelectorAll('.fiche')[0].querySelectorAll('button.close')[0].click();
    await settle(40);
    // Carte sans détail de ses exemplaires : approchée, dite.
    d.getElementById('tab-cartes').click();
    await settle(60);
    d.querySelectorAll('.cell').find((n) => text(n).includes('Marché 2')).querySelector('.card').dispatch('click');
    await settle(60);
    check(fiche().includes('Commune20W') && fiche().includes('Rareté de tes exemplaires pas encore connue'), 'fiche approchée : ' + fiche());
    d.querySelectorAll('.fiche')[0].querySelectorAll('button.close')[0].click();
    await settle(40);
    // « Mes cartes », tri par prix : Marché 2 (20W), Marché 1 (400W, son meilleur exemplaire coté de façon fiable), puis
    // Marché 3, sans cote, à la fin dans les deux sens.
    {
      const sortSel = d.getElementById('sort');
      const titles = () => d.querySelectorAll('.cell').map((n) => text(n.querySelector('.card__title')));
      // Les cartes Marché entre elles, puis les deux sans cote (Marché 3, Sans cote M), toujours les dernières.
      const order = () => titles().filter((t) => t.startsWith('Marché')).join(' | ') + ' / fin : ' + titles().slice(-2).sort().join(', ');
      check(sortSel.querySelectorAll('option').map(text).join(',').includes('Prix ↑,Prix ↓'), 'tri « Mes cartes » : options de prix absentes');
      sortSel.value = 'price-up';
      sortSel.dispatch('change');
      await settle(40);
      check(order() === 'Marché 2 | Marché 1 | Marché 3 / fin : Marché 3, Sans cote M' && titles()[0] === 'Marché 2' && titles()[1] === 'Vente 01', 'Mes cartes, prix croissant : ' + order());
      sortSel.value = 'price-down';
      sortSel.dispatch('change');
      await settle(40);
      check(order() === 'Marché 1 | Marché 2 | Marché 3 / fin : Marché 3, Sans cote M' && titles()[0] === 'Vente 24', 'Mes cartes, prix décroissant : ' + order());
      sortSel.value = 'rarity';
      sortSel.dispatch('change');
      await settle(40);
    }
    // Fiche d'une carte qui manque (depuis une bonne affaire) : ses cotes par rareté.
    d.getElementById('tab-marche').click();
    await settle(40);
    // Filtre par collection des bonnes affaires à acheter : « Toutes les collections (1) », puis « Envies (1) ».
    {
      const sel = d.getElementById('deal-col');
      const opts = sel ? sel.querySelectorAll('option').map(text) : [];
      check(opts.join(' | ') === 'Toutes les collections (1) | Envies (1)', 'filtre des bonnes affaires par collection : ' + opts.join(' | '));
      sel.value = sel.querySelectorAll('option')[1].getAttribute('value');
      sel.dispatch('change');
      await settle(40);
      check(d.querySelectorAll('.lot__title').some((n) => text(n).includes('Voulue A')), 'la bonne affaire de « Envies » doit rester affichée');
      sel.value = '';
      sel.dispatch('change');
      await settle(40);
    }
    // Filtres des bonnes affaires à acheter (2026-10-24), gardés dans les préférences du compte : la seule affaire montrée,
    // Voulue A (SR, 50W pour une cote de 100, sans enchère, finit dans 1 h).
    {
      const deals = () => d.querySelector('[data-section="acheter"]').querySelectorAll('.lot__title').map(text).filter((t) => t.includes('Voulue'));
      const btn = () => d.getElementById('deal-filters-btn');
      const sortSel = d.getElementById('deal-sort');
      check(sortSel && sortSel.querySelectorAll('option').map(text).join(' | ') === 'Fin la plus proche | Meilleure remise | Plus grosse économie | Prix croissant', 'tri des bonnes affaires : ' + (sortSel ? sortSel.querySelectorAll('option').map(text).join(' | ') : 'absent'));
      check(text(btn()) === 'Filtres' && btn().getAttribute('aria-expanded') === 'false' && !d.getElementById('deal-filters'), 'panneau des filtres fermé par défaut');
      btn().click();
      await settle(40);
      check(!!d.getElementById('deal-filters') && btn().getAttribute('aria-expanded') === 'true', 'panneau des filtres pas ouvert');
      const chip = (label) => d.getElementById('deal-filters').querySelectorAll('button').find((b) => text(b) === label);
      chip('L').click();
      await settle(40);
      check(deals().length === 0 && text(btn()) === 'Filtres · 1' && text(d.querySelector('.deal-summary')).startsWith('0 affaire sur 1 · L'), 'filtre de rareté L : ' + deals().join(', ') + ' / ' + text(btn()));
      if (!SERVER) check(JSON.stringify(um.prefs.deal_filter.r) === '["L"]', 'filtre pas gardé au compte : ' + JSON.stringify(um.prefs));
      chip('L').click();
      chip('30 %').click();
      await settle(40);
      check(deals().length === 1, '« finit bientôt » sans mise : montrée malgré le seuil de 30 %');
      d.getElementById('deal-soon').dispatch('change');
      await settle(40);
      check(deals().length === 0, 'sans « finit bientôt » : 50 % de la cote ne passe pas 30 %');
      d.querySelector('.deal-summary').querySelector('button').click(); // « Effacer les filtres »
      await settle(40);
      check(deals().length === 1 && text(btn()) === 'Filtres' && !d.querySelector('.deal-summary'), 'filtres pas effacés');
      // Champ de saisie : la liste suit tout de suite, le compte après une pause de la frappe.
      type(d.getElementById('deal-max'), '40');
      await settle(40);
      check(deals().length === 0, 'prix ≤ 40W : Voulue A (50W) doit disparaître');
      await sleep(900);
      if (!SERVER) check(um.prefs.deal_filter.max === 40, 'prix maximal pas enregistré au compte : ' + JSON.stringify(um.prefs.deal_filter));
      // Enregistrer ces filtres, les effacer, les reprendre d'un clic, puis supprimer le filtre enregistré.
      chip('Enregistrer ces filtres…').click();
      await settle(40);
      type(d.getElementById('deal-preset-name'), '  Petits prix ');
      d.querySelector('.deal-filters__save').dispatch('submit');
      await settle(60);
      const presets = () => (d.querySelector('.deal-presets') ? d.querySelector('.deal-presets').querySelectorAll('.chip') : []);
      check(presets().length === 1 && text(presets()[0]) === 'Petits prix' && presets()[0].classList.contains('on'), 'filtre enregistré : ' + presets().map(text).join(', '));
      if (!SERVER) check(um.prefs.deal_presets.length === 1 && um.prefs.deal_presets[0].name === 'Petits prix' && um.prefs.deal_presets[0].f.max === 40, 'filtre enregistré pas gardé au compte : ' + JSON.stringify(um.prefs.deal_presets));
      chip('Effacer les filtres').click();
      await settle(40);
      check(deals().length === 1 && !presets()[0].classList.contains('on'), 'filtres effacés : le filtre enregistré ne doit plus être actif');
      presets()[0].querySelector('.chip__label').click();
      await settle(40);
      check(deals().length === 0 && presets()[0].classList.contains('on') && String(d.getElementById('deal-max').value) === '40', 'filtre enregistré pas repris');
      presets()[0].querySelector('.x').click();
      await settle(40);
      check(presets().length === 0, 'filtre enregistré pas supprimé');
      if (!SERVER) check(um.prefs.deal_presets.length === 0, 'suppression pas gardée au compte');
      chip('Effacer les filtres').click();
      btn().click();
      await settle(40);
      check(deals().length === 1 && !d.getElementById('deal-filters'), 'retour aux filtres par défaut, panneau fermé');
    }
    // Bonnes affaires, mes enchères et mes ventes en cours : un lien vers l'enchère dans le jeu.
    {
      const hrefs = d.getElementById('panel-marche').querySelectorAll('a').filter((a) => a.classList.contains('game-link')).map((a) => a.getAttribute('href'));
      check(hrefs.includes('https://www.wiki-masters.com/marketplace/a1') && hrefs.every((x) => /^https:\/\/www\.wiki-masters\.com\/marketplace\/[a-z0-9-]+$/.test(x)), 'liens vers les enchères du jeu : ' + hrefs.join(', '));
    }
    // « Miser » sur une bonne affaire (Voulue A, 50W sans mise, cote 100W) : la fenêtre propose le prix de départ (et la
    // cote), prévient au-dessus de la cote, refuse sous le minimum ; la mise part au serveur, puis « tu mènes ».
    {
      const md = () => d.querySelectorAll('.modal')[0] || null;
      const mdText = () => (md() ? text(md()) : '');
      const inMd = (t) => (md() ? md().querySelectorAll('button').find((b) => text(b).trim() === t) || null : null);
      const dealRow = () => d.querySelector('[data-section="acheter"]').querySelectorAll('li').find((n) => text(n).includes('Voulue A')) || null;
      const bidBtn = () => (dealRow() ? dealRow().querySelectorAll('button').find((b) => text(b) === 'Miser') || null : null);
      check(bidBtn() && bidBtn().getAttribute('aria-label') === 'Miser sur « Voulue A »', 'bouton « Miser » absent de la bonne affaire : ' + (dealRow() ? text(dealRow()) : 'ligne absente'));
      bidBtn().click();
      await settle(40);
      const amount = () => d.getElementById('bid-amount');
      check(mdText().includes('Miser sur « Voulue A »') && mdText().includes('Prix de départ50W · aucune mise') && mdText().includes('Cote100W') && String(amount().value) === '50',
        'fenêtre « Miser » : ' + mdText().slice(0, 400));
      check(inMd('minimum · 50W') && inMd('la cote · 100W') && inMd('Miser 50W dans le jeu'), 'mises proposées : ' + md().querySelectorAll('button').map(text).join(' | '));
      amount().value = '40';
      amount().dispatch('input');
      await settle(20);
      check(mdText().includes('Il faut au moins 50W') && inMd('Miser 40W dans le jeu').disabled, 'mise sous le minimum : ' + mdText().slice(0, 600));
      amount().value = '120';
      amount().dispatch('input');
      await settle(20);
      check(mdText().includes('20 % au-dessus de la cote'), 'mise au-dessus de la cote : ' + mdText().slice(0, 600));
      // Refus du serveur (quelqu'un a misé entre-temps) : message, le minimum suit.
      inMd('minimum · 50W').click();
      await settle(20);
      api.bidFail = { status: 409, error: "Quelqu'un a misé 55W : il faut au moins 56W.", extra: { min: 56, cur: 55 } };
      inMd('Miser 50W dans le jeu').click();
      await settle(60);
      check(mdText().includes('il faut au moins 56W') && String(amount().value) === '56' && mdText().includes('Enchère actuelle55W') && api.bidsSent.length === 0, 'refus de la mise : ' + mdText().slice(0, 600));
      inMd('Miser 56W dans le jeu').click();
      await settle(80);
      check(api.bidsSent.length === 1 && api.bidsSent[0].a === 'a1' && api.bidsSent[0].amount === 56, 'mise envoyée : ' + JSON.stringify(api.bidsSent));
      check(mdText().includes('Mise faite : tu mènes.') && mdText().includes('Ta mise : 56W') && mdText().includes('ton solde dans le jeu : 944W')
        && md().querySelectorAll('a').some((a) => a.getAttribute('href') === 'https://www.wiki-masters.com/marketplace/a1'), 'mise faite : ' + mdText());
      inMd('Fermer').click();
      await settle(60);
      check(await waitFor(() => dealRow() && text(dealRow()).includes('tu mènes') && !bidBtn()), 'bonne affaire misée : « tu mènes », plus de « Miser » : ' + (dealRow() ? text(dealRow()) : 'absente'));
    }
    // Fiche d'une carte qui manque : ses enchères en cours (lues à l'ouverture), de la moins chère à la plus chère, comparées à
    // la cote de leur rareté, le détail des moins chères (site du jeu), un lien vers chacune ; la courbe de ses prix de vente.
    const inH = (h) => new Date(Date.now() + h * 3600_000).toISOString();
    const dayAgo = (n) => new Date(Date.now() - n * 86400_000).toISOString();
    api.cardMarket = { w1: {
      auctions: [{ a: 'e1', r: 'SR', s: false, ask: 120, bid: true, cur: 120, base: 50, end: inH(5), atk: 10, def: 20, lead: false, mine: false, n: null },
        { a: 'e2', r: 'SR', s: false, ask: 60, bid: false, cur: null, base: 60, end: inH(0.5), atk: 11, def: 21, lead: false, mine: false, n: null },
        { a: 'e3', r: 'SR', s: true, ask: 250, bid: true, cur: 250, base: 100, end: inH(30), atk: 12, def: 22, lead: true, mine: false, n: null }],
      sales: [{ d: dayAgo(1), p: 110, k: 'SR' }, { d: dayAgo(2), p: 90, k: 'SR' }, { d: dayAgo(3), p: 100, k: 'SR' }, { d: dayAgo(4), p: 300, k: 'SR*' }],
      v: { SR: { p: 100, n: 5, w: null, l: 110, d: dayAgo(1) }, 'SR*': { p: 260, n: 1, w: null, l: 300, d: dayAgo(4) } }, // celles de la liste des cotes
    } };
    api.auctionDetails = { e1: { a: 'e1', gone: false, status: 'active', bids: 4, bidders: 2, leader: 'Rival', seller: 'Marchande', leading: false, selling: false, my_bid: 90, cur: 130 },
      e2: { a: 'e2', gone: false, status: 'active', bids: 0, bidders: 0, leader: null, seller: 'Marchande', leading: false, selling: false, my_bid: null, cur: null },
      e3: { a: 'e3', gone: false, status: 'active', bids: 1, bidders: 1, leader: null, seller: 'Autre', leading: true, selling: false, my_bid: 250, cur: 250 } };
    const mark = apiLog.length;
    d.querySelectorAll('.lot__title').flatMap((n) => n.querySelectorAll('button')).find((b) => text(b) === 'Voulue A').click();
    await settle(60);
    check(fiche().includes('Cote dans le jeu') && fiche().includes('Super rare100W5 ventes') && fiche().includes('Super rare, brillante~260W1 vente'), 'cote d\'une carte qui manque : ' + fiche());
    check(await waitFor(() => fiche().includes('mène : Rival')), 'détail des enchères absent : ' + fiche());
    {
      const f = d.querySelectorAll('.fiche')[0];
      const rows = f.querySelectorAll('li').filter((n) => n.classList.contains('auction'));
      const rt = rows.map(text);
      check(rows.length === 3 && rt[0].includes('60W') && rt[1].includes('130W') && rt[2].includes('250W'), 'enchères de la fiche, de la moins chère à la plus chère : ' + rt.join(' || '));
      check(rt[0].includes('−40 % vs cote') && rt[0].includes('aucune mise, prix de départ') && rows[0].querySelector('.auction__clock').classList.contains('hot'), 'enchère sans mise : ' + rt[0]);
      check(rt[1].includes('+30 % vs cote') && rt[1].includes('4 mises de 2 joueurs') && rt[1].includes('mène : Rival') && rt[1].includes('vendeur : Marchande') && rt[1].includes('dépassée · ta mise 90W') && rt[1].includes('ATK 10 · DEF 20'), 'enchère détaillée : ' + rt[1]);
      check(rt[2].includes('tu mènes') && rt[2].includes('brillante') && rt[2].includes('cote ~260W') && !rt[2].includes('vs cote') && !rt[2].includes('dépassée') && rows[2].classList.contains('lead'), 'enchère que je mène : ' + rt[2]);
      check(rows.every((n) => n.querySelectorAll('a').some((a) => a.classList.contains('game-link') && /^https:\/\/www\.wiki-masters\.com\/marketplace\/e[123]$/.test(a.getAttribute('href')) && a.getAttribute('target') === '_blank')), 'liens vers le jeu dans la fiche');
      // « Miser » sur chaque enchère, sauf celle que je mène ; après une mise, un W de plus que l'enchère lue sur le site du jeu.
      const rowBid = (n) => n.querySelectorAll('button').find((b) => text(b) === 'Miser') || null;
      check(rowBid(rows[0]) && rowBid(rows[1]) && !rowBid(rows[2]), 'boutons « Miser » de la fiche : ' + rows.map((n) => !!rowBid(n)).join(', '));
      rowBid(rows[1]).click();
      await settle(40);
      {
        const mdt = () => (d.querySelectorAll('.modal')[0] ? text(d.querySelectorAll('.modal')[0]) : '');
        check(mdt().includes('Miser sur « Voulue A »') && mdt().includes('Enchère actuelle130W') && String(d.getElementById('bid-amount').value) === '131', 'fenêtre « Miser » de la fiche : ' + mdt().slice(0, 400));
        check(d.querySelectorAll('.fiche').length === 1, 'la fiche reste ouverte sous la fenêtre');
        d.querySelectorAll('.modal')[0].querySelectorAll('button').find((b) => text(b).trim() === 'Annuler').click();
        await settle(40);
        check(!d.querySelectorAll('.modal').length && d.querySelectorAll('.fiche').length === 1, 'fenêtre « Miser » fermée, fiche gardée');
      }
      const calls = apiLog.slice(mark);
      check(calls.filter((x) => x === 'GET /api/market/card?id=w1').length === 1 && calls.filter((x) => x.startsWith('GET /api/market/auction?id=')).length === 3, 'lectures de la fiche : ' + calls.join(', '));
      // Courbe : la rareté vendue le plus souvent (Super rare, 3 ventes) ; la brillante n'a qu'une vente, pas de puce.
      check(fiche().includes('Prix de vente') && fiche().includes('3 ventes depuis le') && f.querySelectorAll('svg').some((n) => /Prix de vente en Super rare/.test(n.getAttribute('aria-label') || '')), 'courbe des prix de vente : ' + fiche().slice(-600));
      // Rouvrir la fiche tout de suite ne relit rien.
      f.querySelectorAll('button.close')[0].click();
      await settle(40);
      d.querySelectorAll('.lot__title').flatMap((n) => n.querySelectorAll('button')).find((b) => text(b) === 'Voulue A').click();
      await settle(60);
      check(apiLog.slice(mark).filter((x) => x.startsWith('GET /api/market/card') || x.startsWith('GET /api/market/auction')).length === 4, 'fiche rouverte : rien de relu');
    }
    d.querySelectorAll('.fiche')[0].querySelectorAll('button.close')[0].click();
    await settle(40);
    // Valeur du classeur d'un ami (cotes venues avec ses cartes, rareté de sa carte pour tous ses exemplaires) : Marché 1
    // (1 rare à 400W, la brillante n'a que 2 ventes), Voulue A (100W), Sans cote : 500W, 2 cartes cotées sur 3.
    d.getElementById('tab-amis').click();
    const nino = () => d.querySelectorAll('.member').find((n) => text(n.querySelector('.name')) === 'Nino') || null;
    check(await waitFor(() => nino() && text(nino()).includes('valeur 500W'), 5000), 'ligne de Nino : valeur absente, ' + (nino() ? text(nino()) : 'absente'));
    check(text(nino()).includes('valeur 500W2 cartes cotées sur 3') && nino().querySelectorAll('.w').length === 1, 'ligne de Nino : ' + text(nino()));
    check(!d.querySelectorAll('.member').some((n) => n !== nino() && n.querySelector('.w')), 'valeur affichée pour un ami sans carte cotée');
    nino().querySelectorAll('button').find((b) => text(b) === 'Parcourir son classeur').click();
    await settle(60);
    check(head().includes('Le classeur de Nino') && head().includes('Valeur : 500W, 2 cartes cotées sur 3') && head().includes("le détail de ses exemplaires n'est pas partagé"),
      'classeur de Nino : ' + head().slice(0, 400));
    // Ses cartes triées par prix (sa cote) : Sans cote à la fin dans les deux sens.
    {
      const fsort = d.getElementById('fsort');
      const order = () => d.querySelectorAll('.card--friend').map((n) => text(n.querySelector('.card__title'))).join(' | ');
      fsort.value = 'price-up';
      fsort.dispatch('change');
      await settle(40);
      check(order() === 'Voulue A | Marché 1 | Sans cote', 'classeur de Nino, prix croissant : ' + order());
      fsort.value = 'price-down';
      fsort.dispatch('change');
      await settle(40);
      check(order() === 'Marché 1 | Voulue A | Sans cote', 'classeur de Nino, prix décroissant : ' + order());
    }
    // Sa collection « Cotées » : la valeur de ses cartes qui la remplissent, sur la ligne et dans l'album.
    const cotees = () => d.querySelectorAll('.row').find((n) => text(n.querySelector('.name')) === 'Cotées') || null;
    check(await waitFor(() => cotees() && cotees().querySelector('.row-value')), 'ligne de « Cotées » (Nino) : valeur absente');
    check(text(cotees().querySelector('.row-value')) === 'valeur 500W', 'ligne de « Cotées » : ' + text(cotees()));
    cotees().click();
    await settle(60);
    check(head().includes('Nino en a 2 sur 3') && head().includes('Valeur : 500W (2 cartes cotées sur 2)'), 'album « Cotées » de Nino : ' + head().slice(0, 400));
    // Son album trié par prix : ses cartes (sa cote), puis « Absente », que personne ne cote.
    segBtn('Prix ↑').click();
    await settle(40);
    check(gridTitles().join(' | ') === 'Voulue A | Marché 1 | Absente', 'album de Nino, prix croissant : ' + gridTitles().join(' | '));
    segBtn('Prix ↓').click();
    await settle(40);
    check(gridTitles().join(' | ') === 'Marché 1 | Voulue A | Absente', 'album de Nino, prix décroissant : ' + gridTitles().join(' | '));
    // Fiche de sa carte : sa cote, venue avec ses cartes.
    d.querySelectorAll('.card--fa').find((n) => text(n).includes('Voulue A')).dispatch('click');
    await settle(60);
    const ff = () => d.querySelectorAll('.fiche--friend')[0] || null;
    check(ff() && text(ff()).includes('Cote dans le jeuSuper rare100W5 ventes'), 'fiche de la carte de Nino : ' + (ff() ? text(ff()) : 'absente'));
    ff().querySelectorAll('button.close')[0].click();
    await settle(40);
    d.getElementById('tab-marche').click();
    await settle(40);
    // Nouvelle lecture du serveur (market_at de GET /api/me, relu chaque minute) : l'onglet est relu, une fois. Ici un essai
    // raté : la raison est dite ; puis une lecture de 3 h : elle est dite ancienne ; puis « Actualiser le marché » (une
    // passe du serveur, une par minute) ; puis jamais de lecture ni d'essai : quoi faire.
    {
      const reads = () => apiLog.filter((x) => x === 'GET /api/market').length;
      const now = new Date().toISOString();
      const n0 = reads();
      um.market.attempt = { start: now, end: now, ok: false, why: 'Ta session du jeu a été révoquée : relie ton compte (onglet « Synchro »).', v: 'serveur', auto: true };
      um.market.market_at = now;
      await pm.live();
      await settle(80);
      check(reads() === n0 + 1, `onglet relu après une lecture du serveur : ${reads() - n0} lecture(s)`);
      check(panel().includes("Dernier essai, à l'instant (automatique) : Ta session du jeu a été révoquée : relie ton compte (onglet « Synchro »)."), 'essai raté non dit : ' + panel().slice(0, 1200));
      check(!/(ton|le|du) favori/i.test(panel()), 'le marché parle encore du favori : ' + panel().slice(0, 1200));
      await pm.live();
      await settle(40);
      check(reads() === n0 + 1, 'onglet relu sans nouvelle lecture');
      const later = new Date(Date.now() + 1000).toISOString();
      um.market.live_at = new Date(Date.now() - 3 * 3600_000).toISOString();
      um.market.attempt = { start: later, end: later, ok: true, v: 'serveur', auto: true };
      um.market.market_at = later;
      await pm.live();
      await settle(80);
      check(panel().includes('Lecture du marché par le classeur : il y a 3 h') && panel().includes('Elle date de plus de 2 h') && !panel().includes('Dernier essai'),
        'lecture ancienne : ' + panel().slice(0, 1200));
      // « Actualiser le marché » : POST /api/market/refresh (passe légère), puis le marché est relu ; un second clic tout de suite est refusé
      // (429) et dit combien attendre ; un compte délié côté serveur (401 needs_link) est dit.
      check(!btn('Relire') && !btn('Mettre à jour les cotes') && btn('Actualiser le marché'), '« Actualiser le marché » attendu à la place de « Relire » et « Mettre à jour les cotes »');
      const mark2 = apiLog.length;
      btn('Actualiser le marché').click();
      await settle(120);
      const sent = apiLog.slice(mark2);
      check(sent[0] === 'POST /api/market/refresh' && sent[1] === 'GET /api/market' && sent.filter((x) => x === 'POST /api/market/refresh').length === 1, 'mise à jour des cotes : appels ' + sent.join(', '));
      check(panel().includes("Marché relu : 3 bonnes affaires · 2 enchères en cours · 12 cotes relues (30 autres à relire : le classeur s'en charge toutes les 20 minutes)") && panel().includes("Lecture du marché par le classeur : à l'instant"),
        'résultat de la mise à jour des cotes : ' + panel().slice(0, 600));
      btn('Actualiser le marché').click();
      await settle(80);
      check(/Marché déjà relu il y a moins d’une minute : patiente un instant\. \(encore \d+ s\)/.test(panel()), 'second clic : attente non dite : ' + panel().slice(0, 600));
      um.linked = false;
      um.marketClickAt = 0;
      btn('Actualiser le marché').click();
      await settle(80);
      check(panel().includes('Relie ton compte du jeu pour lire le marché.') && !panel().includes('Marché relu'), 'compte délié côté serveur : message attendu : ' + panel().slice(0, 600));
      um.linked = true;
      d.getElementById('tab-marche').click();
      await settle(40);
    }
    // Classeur sans cote : l'onglet dit comment en avoir, sans valeur dans le bandeau.
    {
      const later = new Date(Date.now() + 5000).toISOString();
      um.market = { market_at: later };
      await pm.live();
      await settle(80);
    }
    check(panel().includes('Pas encore de cote : relie ton compte du jeu (onglet « Synchro ») : le classeur les lit tout seul toutes les 20 minutes') && panel().includes('Pas de lecture du marché') && !body().includes('valeur ('), 'classeur sans cote : ' + panel().slice(0, 400));
    check(panel().includes("Le classeur n'a pas encore lu le marché : relie ton compte (onglet « Synchro ») ou clique « Actualiser le marché »."), 'jamais de lecture : quoi faire non dit');
    {
      const pm2 = openPage({ idb: 'absent' });
      check(await waitFor(() => pm2.count() === 29), 'classeur de Mona non rouvert');
      pm2.doc.getElementById('tab-marche').click();
      await settle(80);
      const btn2 = (id) => pm2.doc.querySelectorAll('section').find((n) => n.getAttribute('data-section') === id).querySelector('.acc__btn');
      check(btn2('encheres').getAttribute('aria-expanded') === 'true' && btn2('vendre').getAttribute('aria-expanded') === 'true' && String(pm2.doc.getElementById('sell-min').value) === '450',
        'nouvelle page : état des sections ou seuil non gardés');
    }
  }

  // « Fusionner avec… » (album d'une collection) : Mila fusionne « Dieux grecs » dans « Olympe ». Ses autres collections
  // de A à Z avec leur taille ; aperçu (ajoutés, déjà présents par titre, par qid enregistré ou résolu sur Wikipédia,
  // complétés) ; « Rien à ajouter » ; intercalaires gardés, transmis (intercalaire déjà présent) et en tête sur demande ;
  // nouveau nom ; une seule requête d'enregistrement puis la suppression de l'autre. Limites : 3 000 éléments, 600 Ko
  // (sans les images quand elles seules font dépasser). Collection faite d'une catégorie : source gardée, pas
  // d'intercalaire en tête ; suppression refusée : la fusion reste enregistrée, l'autre reste telle quelle.
  {
    const keyF = await makeOtherAccount('Mila');
    const mkF = (id, title, rarity) => ({ id, title, rarity, atk: 1, def: 1, quality: 1, pageviews: 10, category: 'essai', image: null, url: null,
      count: 1, shiny: false, starred: false, obtained_at: '2026-10-01T00:00:00Z' });
    await seedCards(keyF, [mkF('f1', 'Zeus', 'L'), mkF('f2', 'Héra', 'R'), mkF('f3', 'Apollon', 'SR')]);
    const itF = (title, more) => ({ title, description: null, image: null, status: 'ok', ...more });
    const pad = (i) => String(i).padStart(4, '0');
    const saveF = async (t) => check((await rawSave(keyF, t)).status === 200, `collection « ${t.name} » refusée`);
    await saveF({ name: 'Olympe', items: [itF('Zeus'), itF('Héra'), itF('Poséidon'), itF('Athéna', { qid: 'Q37122' })] });
    // « Poseidon » : redirection vers « Poséidon » (même qid, résolu sur Wikipédia) ; « Pallas Athéna » : même qid
    // qu'« Athéna » ; Héra, déjà présente, ouvre une section : Hermès, la carte ajoutée suivante, l'ouvrira.
    await saveF({ name: 'Dieux grecs', items: [itF('Zeus', { description: 'roi des dieux', image: 'https://upload.wikimedia.org/z2.jpg', rarity: 'L' }), itF('Apollon'),
      itF('Héra', { sep: true }), itF('Poseidon'), itF('Hermès'), itF('Pallas Athéna', { qid: 'Q37122' }), itF('Artémis', { sep: true })] });
    await saveF({ name: 'Doublons', items: [itF('Zeus'), itF('Héra')] });
    await saveF({ name: 'Vaches', source: 'wp:Race bovine', items: [itF('Salers'), itF('Aubrac')] });
    await saveF({ name: 'Vaches 2', items: [itF('Aubrac', { qid: 'Q900200', description: 'race bovine' }), itF('Charolaise')] });
    // Grandes collections (avec un qid : rien à résoudre sur Wikipédia). « Grande » : 1 699 867 octets, la fusion de 7
    // éléments de plus ne tient plus dans 1,7 Mo.
    await saveF({ name: 'Grande', items: Array.from({ length: 2998 }, (_, i) => itF('Article G' + pad(i), { qid: 'Q71' + pad(i), description: 'd'.repeat(481) })) });
    const desc = 'Une description de cinq cents caractères. '.repeat(12).slice(0, 500);
    await saveF({ name: 'Longues A', items: Array.from({ length: 1550 }, (_, i) => itF('Longue A' + pad(i), { description: desc, qid: 'Q72' + pad(i) })) });
    await saveF({ name: 'Longues B', items: Array.from({ length: 1550 }, (_, i) => itF('Longue B' + pad(i), { description: desc, qid: 'Q73' + pad(i) })) });
    await saveF({ name: 'Images B', items: Array.from({ length: 900 }, (_, i) => itF('Image B' + pad(i), { image: `https://upload.wikimedia.org/b${i}/${'i'.repeat(940)}.jpg`, qid: 'Q74' + pad(i) })) });
    const targetsF = async () => (await rawApi('GET', '/api/targets', keyF)).body.targets;
    const olympeId = (await targetsF()).find((x) => x.name === 'Olympe').id;
    ls.set('classeur-key', keyF);
    ls.set('classeur-known', JSON.stringify([{ key: keyF, name: 'Mila' }]));
    const pf = openPage({ idb: 'absent' });
    const d = pf.doc;
    const txt = () => text(d.body);
    const btnIn = (root, t) => root.querySelectorAll('button').find((b) => text(b).trim() === t) || null;
    check(await waitFor(() => pf.count() === 3), 'classeur de Mila non ouvert');
    d.getElementById('tab-collections').click();
    await settle();
    const openRow = async (name) => {
      const r = d.querySelectorAll('.row').find((n) => (n.getAttribute('aria-label') || '').startsWith(name + ' :'));
      check(r, `collection « ${name} » absente`);
      r.click();
      await settle(80);
    };
    const back = async () => { btnIn(d.body, '← Toutes les collections').click(); await settle(); };
    const modal = () => d.querySelectorAll('.modal')[0] || null;
    const mtxt = () => text(modal());
    const choices = () => { const u = modal().querySelector('.merge-list'); return u ? u.querySelectorAll('li') : []; };
    const choose = async (name) => {
      const li = choices().find((x) => text(x.querySelector('.check')) === name);
      check(li, `« ${name} » absente des collections proposées : ` + choices().map(text).join(' | '));
      li.querySelector('input').click();
      await settle();
    };
    const primary = () => modal().querySelectorAll('button').find((b) => b.classList.contains('primary')) || null;
    const box = (id) => d.getElementById(id);
    await openRow('Olympe');
    check(btnIn(d.body, 'Fusionner avec…'), '« Fusionner avec… » absent de l\'album de « Olympe »');
    btnIn(d.body, 'Fusionner avec…').click();
    await settle();
    check(modal() && text(modal().querySelector('h2')) === 'Fusionner « Olympe » avec…', 'fenêtre « Fusionner avec… » absente');
    const ct = choices().map(text);
    check(ct.length === 8 && ct.join(' | ').startsWith('Dieux grecs7 éléments | Doublons2 éléments | Grande2 998 éléments | Images B900 éléments | Longues A1 550 éléments | Longues B1 550 éléments | Vaches2 éléments')
      && ct[6].includes('depuis la catégorie Wikipédia « Race bovine »') && ct[7] === 'Vaches 22 éléments' && !ct.some((x) => x.startsWith('Olympe')), 'collections proposées : ' + ct.join(' | '));
    check(primary() && text(primary()) === 'Fusionner' && primary().disabled && !box('merge-name'), 'rien de choisi : bouton grisé, pas encore de nom');
    // Tout est déjà là : rien à ajouter ; supprimer l'autre (coché d'emblée) reste possible, sinon rien à faire.
    await choose('Doublons');
    check(mtxt().includes('Rien à ajouter : les 2 éléments de « Doublons » sont déjà dans « Olympe ».') && box('merge-drop').checked
      && text(primary()) === 'Supprimer « Doublons »' && !primary().disabled, '« Doublons » : rien à ajouter attendu : ' + mtxt().slice(0, 600));
    // Seulement la suppression, refusée (API simulée) : rien d'enregistré, la fenêtre reste ouverte avec l'erreur.
    if (api) {
      const realHandle0 = api.handle;
      api.handle = (method, p, headers, body) => (p === '/api/targets/delete' ? { status: 500, body: { error: 'Panne passagère du serveur.' } } : realHandle0.call(api, method, p, headers, body));
      const mark0 = apiLog.length;
      try {
        primary().click();
        check(await waitFor(() => modal() && mtxt().includes("« Doublons » n'a pas pu être supprimée : Panne passagère du serveur.") && !primary().disabled),
          'suppression seule refusée : erreur dans la fenêtre attendue : ' + (modal() ? mtxt().slice(-300) : 'fenêtre fermée'));
      } finally {
        api.handle = realHandle0;
      }
      check(apiLog.slice(mark0).join(' | ') === 'POST /api/targets/delete', 'suppression seule : aucun enregistrement attendu : ' + apiLog.slice(mark0).join(' | '));
    }
    box('merge-drop').click();
    await settle();
    check(text(primary()) === 'Fusionner' && primary().disabled && mtxt().includes('Elle restera telle quelle'), 'rien à ajouter et rien à supprimer : bouton grisé');
    box('merge-drop').click();
    await settle();
    await choose('Dieux grecs');
    check(await waitFor(() => mtxt().includes('3 éléments ajoutés, 4 déjà présents')), 'aperçu de la fusion : ' + mtxt().slice(0, 900));
    check(mtxt().includes('Après la fusion : 7 éléments, dont 3 que tu as.') && mtxt().includes('1 élément déjà présent reçoit ce qui lui manquait')
      && mtxt().includes('Intercalaires dans la partie ajoutée : « Hermès » et « Artémis ».'), 'détail de l\'aperçu : ' + mtxt().slice(0, 900));
    const added = () => { const u = modal().querySelector('.merge-added'); return u ? u.querySelectorAll('li').map(text) : []; };
    check(added().join('|') === 'SRApollon|Hermèsintercalaire|Artémisintercalaire', 'éléments ajoutés : ' + added().join('|'));
    check(box('merge-name').value === 'Olympe' && box('merge-drop').checked && box('merge-head') && !box('merge-head').checked
      && mtxt().includes('« Apollon » commencera une nouvelle ligne') && text(primary()) === 'Fusionner et supprimer « Dieux grecs »', 'options de la fusion : ' + mtxt().slice(-700));
    box('merge-head').click();
    await settle();
    check(mtxt().includes('Intercalaires dans la partie ajoutée : « Apollon », « Hermès » et « Artémis ».') && added()[0] === 'SRApollonintercalaire', 'intercalaire en tête : ' + added().join('|'));
    type(box('merge-name'), "Dieux de l'Olympe");
    await settle();
    const mark = apiLog.length;
    primary().click();
    check(await waitFor(() => !modal()), 'la fenêtre doit se fermer après la fusion');
    check(await waitFor(() => txt().includes("« Dieux grecs » fusionnée dans « Dieux de l'Olympe » : 3 éléments ajoutés, 4 déjà présents ; « Dieux grecs » supprimée.")),
      'confirmation de la fusion absente');
    const calls = apiLog.slice(mark).filter((x) => /^POST \/api\/targets\//.test(x));
    check(calls.join(' | ') === 'POST /api/targets/save | POST /api/targets/delete', 'requêtes de la fusion : ' + calls.join(' | '));
    let all = await targetsF();
    const ol = all.find((x) => x.id === olympeId);
    check(ol && ol.name === "Dieux de l'Olympe" && !all.some((x) => x.name === 'Dieux grecs') && all.length === 8, 'collections après la fusion : ' + all.map((x) => x.name).join(' | '));
    check(ol.items.map((i) => i.title + (i.sep ? '#' : '')).join('|') === 'Zeus|Héra|Poséidon|Athéna|Apollon#|Hermès#|Artémis#', 'éléments fusionnés : ' + ol.items.map((i) => i.title + (i.sep ? '#' : '')).join('|'));
    check(ol.items[0].description === 'roi des dieux' && ol.items[0].image === 'https://upload.wikimedia.org/z2.jpg' && ol.items[0].rarity === 'L' && !ol.items[0].sep
      && ol.items[3].qid === 'Q37122' && !ol.items[1].sep, 'éléments déjà présents complétés, sans intercalaire de plus : ' + JSON.stringify(ol.items.slice(0, 4)));
    check(await waitFor(() => text(d.querySelector('.album-title')).includes("Dieux de l'Olympe") && text(d.querySelector('.album-title')).includes('3 sur 7')), 'album après la fusion');
    // 1,7 Mo au plus : vérifié avant l'envoi (même sans les images).
    btnIn(d.body, 'Fusionner avec…').click();
    await settle();
    check(!choices().some((x) => text(x).startsWith('Dieux grecs')), 'la collection supprimée est encore proposée');
    await choose('Grande');
    check(mtxt().includes('Collection fusionnée trop volumineuse : ') && mtxt().includes('Ko même sans les images, 1,7 Mo au plus.') && primary().disabled,
      'fusion de plus de 1,7 Mo : ' + mtxt().slice(-500));
    btnIn(modal(), 'Annuler').click();
    await settle(300);
    // Collection faite d'une catégorie : elle garde sa source, pas d'intercalaire en tête (de A à Z). Suppression de l'autre
    // refusée (API simulée) : la fusion est enregistrée, l'autre reste, on le dit.
    await back();
    await openRow('Vaches');
    btnIn(d.body, 'Fusionner avec…').click();
    await settle();
    await choose('Vaches 2');
    check(mtxt().includes('1 élément ajouté, 1 déjà présent') && mtxt().includes('« Vaches » est faite de la catégorie Wikipédia « Race bovine » : la collection fusionnée garde cette source')
      && mtxt().includes('1 élément déjà présent reçoit') && !box('merge-head'), 'fusion dans une collection faite d\'une catégorie : ' + mtxt().slice(0, 900));
    const realHandle = api ? api.handle : null;
    if (api) api.handle = (method, p, headers, body) => (p === '/api/targets/delete' ? { status: 500, body: { error: 'Panne passagère du serveur.' } } : realHandle.call(api, method, p, headers, body));
    try {
      primary().click();
      check(await waitFor(() => !modal()), 'la fenêtre doit se fermer après la fusion (catégorie)');
      if (api) {
        check(await waitFor(() => txt().includes("« Vaches 2 » fusionnée dans « Vaches » : 1 élément ajouté, 1 déjà présent. Mais « Vaches 2 » n'a pas pu être supprimée (Panne passagère du serveur) : elle est restée telle quelle")),
          'suppression refusée : message attendu');
      } else check(await waitFor(() => txt().includes('« Vaches 2 » fusionnée dans « Vaches »')), 'confirmation de la fusion (catégorie) absente');
    } finally {
      if (api) api.handle = realHandle;
    }
    all = await targetsF();
    const vac = all.find((x) => x.name === 'Vaches');
    check(vac.source === 'wp:Race bovine' && vac.items.map((i) => i.title).join('|') === 'Salers|Aubrac|Charolaise' && vac.items[1].qid === 'Q900200' && vac.items[1].description === 'race bovine',
      'collection faite d\'une catégorie après la fusion : ' + JSON.stringify(vac));
    check(all.some((x) => x.name === 'Vaches 2') === !!api, '« Vaches 2 » doit rester si sa suppression est refusée');
    // 1,7 Mo : trop lourde même sans images, refusée avant l'envoi ; trop lourde à cause des images : fusion sans elles
    // (envoyée en morceaux).
    await back();
    await openRow('Longues A');
    btnIn(d.body, 'Fusionner avec…').click();
    await settle();
    await choose('Longues B');
    check(/Collection fusionnée trop volumineuse : [\d  ]+ Ko, 1,7 Mo au plus\./.test(mtxt()) && !mtxt().includes('même sans les images') && primary().disabled, 'fusion de plus de 1,7 Mo : ' + mtxt().slice(-500));
    await choose('Images B');
    check(mtxt().includes('900 éléments ajoutés, aucun déjà présent') && mtxt().includes('Sans les images : avec elles, la collection dépasserait 1,7 Mo') && !mtxt().includes('trop volumineuse')
      && !primary().disabled, 'fusion sans les images : ' + mtxt().slice(0, 900));
    check(added().length === 31 && added()[30] === '… et 870 éléments de plus', 'aperçu des éléments ajoutés (30 montrés) : ' + added().slice(-2).join('|'));
    box('merge-drop').click();
    await settle();
    check(text(primary()) === 'Fusionner', 'garder l\'autre : bouton « Fusionner »');
    primary().click();
    check(await waitFor(() => !modal()), 'la fenêtre doit se fermer après la fusion (images)');
    all = await targetsF();
    const la = all.find((x) => x.name === 'Longues A');
    const ib = all.find((x) => x.name === 'Images B');
    check(la.items.length === 2450 && la.items.every((i) => i.image === null) && la.items[2449].title === 'Image B0899' && ib && ib.items.length === 900 && ib.items[0].image,
      'fusion sans les images : ' + la.items.length + ' éléments, ' + la.items.filter((i) => i.image).length + ' images ; « Images B » ' + (ib ? 'gardée' : 'absente'));
    check(await waitFor(() => txt().includes('« Images B » fusionnée dans « Longues A » : 900 éléments ajoutés.')), 'confirmation de la fusion sans suppression');
    console.log(`fusion : ${all.length} collections de Mila après trois fusions ; « Longues A » : ${la.items.length} éléments, ${Math.round(JSON.stringify(la.items).length / 1024)} Ko`);
  }

  // « Réorganiser » de « Mes collections » (demande du 2026-10-24) : Rose range ses collections. Pas de bouton sous 2
  // collections ; « ↓ » / « En tête » (focus gardé, annonce) ; glisser à la souris (repère, lâché au-dessus de la moitié
  // d'une ligne), au doigt hors de la poignée : rien ; « Annuler » (aucune requête, « Reprendre ») ; « Enregistrer
  // l'ordre » (une requête POST /api/targets/order) puis « Annuler » du message (l'ordre d'avant renvoyé).
  {
    const keyO = await makeOtherAccount('Rose');
    const it = (title) => ({ title, description: null, image: null, status: 'ok' });
    const saveO = async (name) => check((await rawApi('POST', '/api/targets/save', keyO, { name, items: [it(name + ' 1'), it(name + ' 2')] })).status === 200, `ordre : « ${name} » refusée`);
    await seedCards(keyO, [{ id: 'o1', title: 'Alpha 1', rarity: 'C', atk: 1, def: 1, quality: 1, pageviews: 10, category: 'x', image: null, url: null,
      count: 1, shiny: false, starred: false, obtained_at: '2026-10-01T00:00:00Z' }]);
    await saveO('Alpha');
    ls.set('classeur-key', keyO);
    ls.set('classeur-known', JSON.stringify([{ key: keyO, name: 'Rose' }]));
    let pr = openPage({ idb: 'absent' });
    let d = pr.doc;
    check(await waitFor(() => pr.count() === 1), 'ordre : classeur de Rose non ouvert');
    d.getElementById('tab-collections').click();
    await settle();
    check(d.querySelectorAll('.row').length === 1, 'ordre : une collection attendue');
    check(!d.getElementById('colorder-btn'), 'ordre : pas de « Réorganiser » avec une seule collection');
    await saveO('Bravo');
    await saveO('Charlie');
    await saveO('Delta');
    pr = openPage({ idb: 'absent' });
    d = pr.doc;
    check(await waitFor(() => pr.count() === 1), 'ordre : classeur de Rose non rouvert');
    d.getElementById('tab-collections').click();
    await settle();
    check(await waitFor(() => d.querySelectorAll('.row').length === 4), 'ordre : 4 collections attendues');
    const rowNames = () => d.querySelectorAll('.row').map((n) => text(n.querySelector('.name'))).join(' ');
    const coNames = () => d.querySelectorAll('li.co-row').map((n) => text(n.querySelector('.name'))).join(' ');
    const coRow = (name) => d.querySelectorAll('li.co-row').find((n) => text(n.querySelector('.name')) === name);
    const act = (name, a) => coRow(name).querySelectorAll('button').find((b) => b.getAttribute('data-act') === a);
    const said = () => { const p = d.querySelectorAll('.colorder')[0].querySelectorAll('p').find((x) => x.getAttribute('role') === 'status'); return p ? text(p) : ''; };
    const btnIn = (root, t) => root.querySelectorAll('button').find((b) => text(b).trim() === t) || null;
    const toastBtn = (t) => { const n = d.querySelectorAll('.toast')[0]; return n ? n.querySelectorAll('button').find((b) => text(b) === t) || null : null; };
    const orders = (mark) => apiLog.slice(mark).filter((x) => x === 'POST /api/targets/order').length;
    const serverNames = async () => (await rawApi('GET', '/api/targets', keyO)).body.targets.map((t) => t.name).join(' ');
    check(rowNames() === 'Alpha Bravo Charlie Delta', 'ordre de départ : ' + rowNames());
    d.getElementById('colorder-btn').click();
    await settle();
    check(coNames() === 'Alpha Bravo Charlie Delta' && !d.querySelectorAll('.row').length && act('Alpha', 'up').getAttribute('aria-disabled') === 'true'
      && btnIn(d.body, 'Enregistrer l\'ordre').disabled, 'mode réorganisation : ' + coNames());
    act('Alpha', 'down').click();
    await settle();
    check(coNames() === 'Bravo Alpha Charlie Delta' && said() === '« Alpha » : position 2 sur 4.' && d.activeElement === act('Alpha', 'down'), '« ↓ » : ' + coNames() + ' / ' + said());
    act('Delta', 'first').click();
    await settle();
    check(coNames() === 'Delta Bravo Alpha Charlie' && !btnIn(d.body, 'Enregistrer l\'ordre').disabled, '« En tête » : ' + coNames());
    act('Delta', 'up').click();
    await settle();
    check(said() === '« Delta » est déjà en tête.' && coNames() === 'Delta Bravo Alpha Charlie', 'déjà en tête : ' + said());
    // Glisser : lignes simulées de 60 px de haut, 10 px d'écart.
    const fire = (type, ev) => { for (const f of [...(pr.win.listeners[type] || [])]) f({ preventDefault() {}, stopPropagation() {}, cancelable: true, ...ev }); };
    const geom = () => {
      const list = d.querySelectorAll('.co-list')[0];
      list.parentNode.getBoundingClientRect = () => ({ left: 0, top: 0, width: 700, height: 400, right: 700, bottom: 400 });
      list.querySelectorAll('li.co-row').forEach((li, i) => { const b = { left: 0, top: i * 70, width: 700, height: 60, right: 700, bottom: i * 70 + 60 }; li.getBoundingClientRect = () => b; });
      return list;
    };
    {
      geom();
      // Charlie (4e, y 210–270) lâchée dans le haut de Bravo (2e, y 70–130) : avant Bravo.
      coRow('Charlie').querySelector('.name').dispatch('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 11, clientX: 300, clientY: 240 });
      // Encore au-dessous de la moitié d'Alpha (3e, y 140–200) : elle ne bougerait pas, pas de repère.
      fire('pointermove', { pointerId: 11, clientX: 300, clientY: 200 });
      await settle();
      const mark = d.querySelectorAll('.co-mark')[0];
      check(coRow('Charlie').classList.contains('lifted') && !mark.classList.contains('on'), 'glisser : ligne soulevée sans repère attendue, ' + mark.className);
      fire('pointermove', { pointerId: 11, clientX: 300, clientY: 150 });
      await settle();
      check(mark.classList.contains('on') && mark.style['--my'] === '136px', 'glisser : repère avant Alpha attendu, ' + mark.style['--my']);
      fire('pointermove', { pointerId: 11, clientX: 300, clientY: 80 });
      await settle();
      check(mark.style['--my'] === '66px', 'glisser : repère avant Bravo attendu, ' + mark.style['--my']);
      fire('pointerup', { pointerId: 11, clientX: 300, clientY: 80 });
      await settle();
      check(coNames() === 'Delta Charlie Bravo Alpha' && !mark.classList.contains('on') && !coRow('Charlie').classList.contains('lifted') && said() === '« Charlie » : position 2 sur 4.',
        'glisser à la souris : ' + coNames() + ' / ' + said());
      // Au doigt hors de la poignée : rien ; par la poignée : Alpha en tête.
      geom();
      coRow('Alpha').querySelector('.name').dispatch('pointerdown', { pointerType: 'touch', button: 0, pointerId: 12, clientX: 300, clientY: 240 });
      check(!(pr.win.listeners.pointermove || new Set()).size, 'au doigt hors de la poignée : aucun glisser attendu');
      coRow('Alpha').querySelector('.co-grip').dispatch('pointerdown', { pointerType: 'touch', button: 0, pointerId: 13, clientX: 15, clientY: 240 });
      fire('pointermove', { pointerId: 13, clientX: 15, clientY: 10 });
      await settle();
      fire('pointerup', { pointerId: 13, clientX: 15, clientY: 10 });
      await settle();
      check(coNames() === 'Alpha Delta Charlie Bravo', 'glisser par la poignée : ' + coNames());
    }
    // « Annuler » : aucune requête, « Reprendre » rend le brouillon.
    let mark0 = apiLog.length;
    btnIn(d.body, 'Annuler').click();
    await settle();
    check(rowNames() === 'Alpha Bravo Charlie Delta' && orders(mark0) === 0 && toastBtn('Reprendre') && d.activeElement === d.getElementById('colorder-btn'), '« Annuler » : ' + rowNames());
    toastBtn('Reprendre').click();
    await settle();
    check(coNames() === 'Alpha Delta Charlie Bravo', '« Reprendre » : ' + coNames());
    mark0 = apiLog.length;
    btnIn(d.body, 'Enregistrer l\'ordre').click();
    await settle(80);
    check(rowNames() === 'Alpha Delta Charlie Bravo' && orders(mark0) === 1 && await serverNames() === 'Alpha Delta Charlie Bravo', '« Enregistrer l\'ordre » : ' + rowNames());
    // Rechargée : le nouvel ordre vient du serveur.
    pr = openPage({ idb: 'absent' });
    d = pr.doc;
    check(await waitFor(() => pr.count() === 1), 'ordre : classeur de Rose non rouvert');
    d.getElementById('tab-collections').click();
    await settle();
    check(await waitFor(() => rowNames() === 'Alpha Delta Charlie Bravo'), 'ordre gardé au rechargement : ' + rowNames());
    // « Annuler » du message (dans la première page, déjà fermée : on rejoue dans celle-ci).
    d.getElementById('colorder-btn').click();
    await settle();
    act('Bravo', 'first').click();
    await settle();
    btnIn(d.body, 'Enregistrer l\'ordre').click();
    await settle(80);
    check(rowNames() === 'Bravo Alpha Delta Charlie' && toastBtn('Annuler'), 'second enregistrement : ' + rowNames());
    toastBtn('Annuler').click();
    await settle(80);
    check(rowNames() === 'Alpha Delta Charlie Bravo' && await serverNames() === 'Alpha Delta Charlie Bravo', '« Annuler » du message : ' + rowNames());
  }

  // « Réorganiser » (album d'une de tes collections, demande du 2026-10-18) : Rémi range « Continents » à la main. Pas de
  // bouton sous 2 éléments. Mode réorganisation : vignettes réduites, toutes, dans l'ordre (tri et filtre de l'album mis de
  // côté), sections des intercalaires ; « ← » / « → » (focus gardé sur la flèche, annonce « … : position N sur M »,
  // « déjà en tête / à la fin ») ; vignette choisie : « En tête », « À la fin », « Position » ; glisser à la souris (toute
  // la vignette, seuil de 6 px, fantôme, repère d'insertion ; avant un intercalaire = fin de la section d'avant ; trou de la
  // grille = après la vignette à sa gauche), au doigt (poignée seulement : ailleurs, rien ne bouge) ; Échap annule le geste.
  // « Annuler » (aucune requête, « Reprendre ») ; brouillon gardé en quittant l'album ou l'onglet (message, « Y revenir ») ;
  // « Enregistrer l'ordre » (une seule requête, tous les champs gardés) puis « Annuler » du message ; 3 000 éléments ;
  // un autre brouillon en cours (confirmation) ; collection sans ordre : faite d'une catégorie, copie à ordonner (l'originale
  // garde sa source) ; ancien thème du catalogue, ordre manuel sur place. Rien chez un ami ni dans l'album d'une catégorie
  // (vérifié plus haut).
  {
    const keyR = await makeOtherAccount('Rémi');
    const mkR = (id, title, rarity) => ({ id, title, rarity: rarity || 'C', atk: 1, def: 1, quality: 1, pageviews: 10, category: 'continent', image: null, url: null,
      count: 1, shiny: false, starred: false, obtained_at: '2026-10-01T00:00:00Z' });
    const itR = (title, extra) => ({ title, description: null, image: null, status: 'ok', ...extra });
    await seedCards(keyR, [mkR('r1', 'Afrique', 'R'), mkR('r2', 'Europe'), mkR('r3', 'Continent')]);
    const CONT = [itR('Continent', { sep: true }), itR('Afrique', { qid: 'Q15', rarity: 'R', description: 'continent' }), itR('Europe'), itR('Asie'),
      itR('Sous-continent', { sep: true, image: 'https://upload.wikimedia.org/sc.jpg' }), itR('Amérique du Nord'), itR('Océanie')];
    const saveR = async (t) => check((await rawApi('POST', '/api/targets/save', keyR, t)).status === 200, `réorganiser : collection « ${t.name} » refusée`);
    await saveR({ name: 'Continents', items: CONT });
    await saveR({ name: 'Races bovines', source: 'wp:Race bovine', items: [itR('Salers'), itR('Aubrac'), itR('Charolaise')] });
    await saveR({ name: 'Vaches du catalogue', source: 'catalog:vaches', items: [itR('Salers'), itR('Aubrac'), itR('Charolaise')] });
    await saveR({ name: 'Une seule', items: [itR('Afrique')] });
    const pad = (i) => String(i).padStart(4, '0');
    await saveR({ name: 'Grande', items: Array.from({ length: 3000 }, (_, i) => itR('Article R' + pad(i), { qid: 'Q75' + pad(i) })) });
    const targetsR = async () => (await rawApi('GET', '/api/targets', keyR)).body.targets;
    const serverOf = async (name) => (await targetsR()).find((x) => x.name === name);
    ls.set('classeur-key', keyR);
    ls.set('classeur-known', JSON.stringify([{ key: keyR, name: 'Rémi' }]));
    const pr = openPage({ idb: 'absent' });
    const d = pr.doc;
    check(await waitFor(() => pr.count() === 3), 'réorganiser : classeur de Rémi non ouvert');
    d.getElementById('tab-collections').click();
    await settle();
    const btnIn = (root, t) => root.querySelectorAll('button').find((b) => text(b).trim() === t) || null;
    const rowOf = (name) => d.querySelectorAll('.row').find((n) => (n.getAttribute('aria-label') || '').startsWith(name + ' :')) || null;
    const openRow = async (name) => { const r = rowOf(name); check(r, `réorganiser : « ${name} » absente de « Mes collections »`); r.click(); await settle(80); };
    const back = async () => { btnIn(d.body, '← Toutes les collections').click(); await settle(); };
    const modal = () => d.querySelectorAll('.modal')[0] || null;
    const toast = () => d.querySelectorAll('.toast')[0] || null;
    const toastBtn = (t) => (toast() ? toast().querySelectorAll('button').find((b) => text(b) === t) || null : null);
    const grid = () => d.querySelectorAll('.ro-grid')[0] || null;
    const bar = () => d.querySelectorAll('.reorder-bar')[0] || null;
    const roTitle = (li) => li.querySelector('.ro-title').childNodes[0].textContent;
    const tiles = () => (grid() ? grid().childNodes.filter((n) => n.nodeType === 1 && n.classList.contains('ro-tile')) : []);
    const tileFor = (title) => tiles().find((li) => roTitle(li) === title) || null;
    const arrow = (title, act) => tileFor(title).querySelectorAll('button').find((b) => b.getAttribute('data-act') === act);
    // Vignettes du mode réorganisation : « | » pour une nouvelle ligne, « [Titre] » pour un intercalaire.
    const roLayout = () => (grid() ? grid().childNodes.filter((n) => n.nodeType === 1).map((n) => (n.classList.contains('grid-break') ? '|'
      : n.classList.contains('sep') ? `[${roTitle(n)}]` : roTitle(n))).join(' ') : '');
    // Album ordinaire : même écriture (cartes et cases vides).
    const albumLayout = () => { const g = d.querySelectorAll('.cardgrid')[0]; return g ? g.childNodes.filter((n) => n.nodeType === 1).map((n) => {
      if (n.classList.contains('grid-break')) return '|';
      const t = text(n.querySelector('h3'));
      return n.querySelector('.sep-frame') || n.classList.contains('sep-frame') ? `[${t}]` : t;
    }).join(' ') : ''; };
    const said = () => { const p = bar() && bar().querySelectorAll('p').find((x) => x.getAttribute('role') === 'status'); return p ? text(p) : ''; };
    const barName = () => (bar() && bar().querySelector('.reorder-bar__name') ? text(bar().querySelector('.reorder-bar__name')) : '');
    const saves = (mark) => apiLog.slice(mark).filter((x) => x === 'POST /api/targets/save').length;
    const fire = (type, ev) => { for (const f of [...(pr.win.listeners[type] || [])]) f({ preventDefault() {}, stopPropagation() {}, cancelable: true, ...ev }); };
    const listening = () => ((pr.win.listeners.pointermove || new Set()).size);
    // Géométrie simulée de la grille (le faux DOM n'en a pas) : 4 vignettes de 100 × 160 par ligne, 10 px d'écart, une
    // nouvelle ligne à chaque intercalaire ; elementFromPoint rend le titre de la vignette sous le point, sinon la grille
    // (trou), sinon la page. Rend la boîte d'une vignette par son titre.
    const geom = () => {
      const g = grid();
      const box = (l, t, w, hh) => ({ left: l, top: t, width: w, height: hh, right: l + w, bottom: t + hh, x: l, y: t });
      g.parentNode.getBoundingClientRect = () => box(0, 0, 440, 2000);
      const boxes = [];
      let col = 0;
      let row = 0;
      for (const n of g.childNodes.filter((x) => x.nodeType === 1)) {
        if (n.classList.contains('grid-break')) { if (col) { row++; col = 0; } continue; }
        const b = box(col * 110, row * 170, 100, 160);
        n.getBoundingClientRect = () => b;
        boxes.push([b, n]);
        if (++col === 4) { col = 0; row++; }
      }
      d.elementFromPoint = (x, y) => {
        const hit = boxes.find(([b]) => x >= b.left && x < b.right && y >= b.top && y < b.bottom);
        return hit ? hit[1].querySelector('.ro-title') : x >= 0 && x < 440 && y >= 0 && y < 2000 ? g : d.body;
      };
      return (title) => boxes.find(([, n]) => roTitle(n) === title)[0];
    };
    const ORIG = '[Continent] Afrique Europe Asie | [Sous-continent] Amérique du Nord Océanie';

    // Moins de 2 éléments : rien à réorganiser.
    await openRow('Une seule');
    check(!d.querySelectorAll('button').some((b) => text(b).includes('Réorganiser')), '« Une seule » : pas de « Réorganiser » attendu');
    await back();
    // « Continents » en tri par rareté, filtre « Possédées » : « Réorganiser » montre tout, dans l'ordre.
    await openRow('Continents');
    btnIn(d.body, 'Rareté').click();
    btnIn(d.body, 'Possédées').click();
    await settle();
    check(btnIn(d.body, 'Réorganiser') && d.getElementById('reorder-btn'), '« Réorganiser » absent de l\'album de « Continents »');
    btnIn(d.body, 'Réorganiser').click();
    await settle(80);
    check(grid() && roLayout() === ORIG && tiles().length === 7, 'mode réorganisation : toutes les vignettes dans l\'ordre attendues, ' + roLayout());
    check(text(d.querySelectorAll('.album-title')[0]).includes('Réorganisation') && !btnIn(d.body, 'Possédées') && !btnIn(d.body, 'Modifier') && !d.querySelectorAll('.cardgrid').length,
      'mode réorganisation : en-tête réduit, sans filtres ni actions de l\'album');
    check(d.activeElement === d.getElementById('album-name'), 'mode réorganisation : focus sur le nom de la collection attendu');
    check(text(tileFor('Asie').querySelector('.ro-no')) === '4' && tileFor('Asie').classList.contains('ro-tile--missing') && tileFor('Afrique').classList.contains('rR')
      && tileFor('Continent').classList.contains('sep') && text(tileFor('Continent').querySelector('.ro-title')) === 'Continent, intercalaire'
      && text(tileFor('Asie').querySelector('.ro-title')) === 'Asie, pas encore dans ta collection' && tileFor('Asie').querySelector('.ro-grip').getAttribute('aria-hidden') === 'true',
      'vignettes : numéro, case vide, rareté, intercalaire ou poignée incorrects');
    check(arrow('Afrique', 'next').getAttribute('aria-label') === '« Afrique » : une place après' && arrow('Continent', 'prev').getAttribute('aria-disabled') === 'true'
      && arrow('Océanie', 'next').getAttribute('aria-disabled') === 'true' && arrow('Afrique', 'prev').getAttribute('aria-disabled') === null, 'flèches : noms ou états incorrects');
    check(btnIn(bar(), 'Enregistrer l\'ordre').disabled && text(bar()).includes('Ordre inchangé') && text(bar()).includes('Choisis une carte'), 'barre du bas au départ : ' + text(bar()));
    // « → » sur Afrique : elle passe après Europe ; le focus reste sur sa flèche ; l'annonce le dit.
    arrow('Afrique', 'next').click();
    await settle();
    check(roLayout() === '[Continent] Europe Afrique Asie | [Sous-continent] Amérique du Nord Océanie' && said() === '« Afrique » : position 3 sur 7.'
      && d.activeElement === arrow('Afrique', 'next') && barName() === 'Afrique · 3 sur 7' && !btnIn(bar(), 'Enregistrer l\'ordre').disabled
      && text(bar()).includes('Ordre modifié, pas encore enregistré'), '« → » : ' + roLayout() + ' / ' + said() + ' / ' + barName());
    // Aux deux bouts : rien ne bouge, l'annonce le dit.
    arrow('Continent', 'prev').click();
    await settle();
    check(said() === '« Continent » est déjà en tête.' && roLayout().startsWith('[Continent] Europe'), '« ← » en tête : ' + said());
    arrow('Océanie', 'next').click();
    await settle();
    check(said() === '« Océanie » est déjà à la fin.', '« → » à la fin : ' + said());
    // Un intercalaire bouge comme les autres et ouvre toujours sa section.
    arrow('Sous-continent', 'prev').click();
    await settle();
    check(roLayout() === '[Continent] Europe Afrique | [Sous-continent] Asie Amérique du Nord Océanie' && said() === '« Sous-continent » (intercalaire) : position 4 sur 7.',
      'intercalaire avancé : ' + roLayout() + ' / ' + said());
    arrow('Sous-continent', 'next').click();
    await settle();
    // Vignette choisie (clic) : « En tête », « À la fin », « Position ».
    tileFor('Océanie').querySelector('.ro-title').click();
    await settle();
    check(barName() === 'Océanie · 7 sur 7' && tileFor('Océanie').classList.contains('active'), 'vignette choisie : ' + barName());
    btnIn(bar(), 'En tête').click();
    await settle();
    check(roLayout() === 'Océanie | [Continent] Europe Afrique Asie | [Sous-continent] Amérique du Nord' && barName() === 'Océanie · 1 sur 7', '« En tête » : ' + roLayout());
    btnIn(bar(), 'À la fin').click();
    await settle();
    check(roLayout() === '[Continent] Europe Afrique Asie | [Sous-continent] Amérique du Nord Océanie', '« À la fin » : ' + roLayout());
    type(d.getElementById('reorder-pos'), '2');
    await settle();
    btnIn(bar(), 'Déplacer').click();
    await settle();
    check(roLayout() === '[Continent] Océanie Europe Afrique Asie | [Sous-continent] Amérique du Nord' && d.getElementById('reorder-pos').value === '', '« Position » 2 : ' + roLayout());
    type(d.getElementById('reorder-pos'), '9');
    await settle();
    btnIn(bar(), 'Déplacer').click();
    await settle();
    check(text(bar()).includes('Position : un nombre entier de 1 à 7.') && roLayout().startsWith('[Continent] Océanie'), '« Position » 9 : ' + text(bar()));
    // Glisser à la souris : Amérique du Nord lâchée sur la moitié gauche d'Europe (avant elle) ; sous 6 px, rien ne commence.
    {
      const at = geom();
      const am = at('Amérique du Nord');
      tileFor('Amérique du Nord').querySelector('.ro-title').dispatch('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 3, clientX: am.left + 50, clientY: am.top + 120 });
      check(listening() === 1, 'glisser : écoute du pointeur attendue');
      fire('pointermove', { pointerId: 3, clientX: am.left + 53, clientY: am.top + 122 });
      await settle();
      check(!tileFor('Amérique du Nord').classList.contains('lifted') && !d.querySelectorAll('.ro-ghost').length, 'glisser : rien ne doit commencer sous 6 px');
      const eu = at('Europe');
      fire('pointermove', { pointerId: 3, clientX: eu.left + 20, clientY: eu.top + 80 });
      await settle();
      const mark = grid().parentNode.querySelector('.ro-mark');
      const ghost = d.querySelectorAll('.ro-ghost')[0];
      check(tileFor('Amérique du Nord').classList.contains('lifted') && ghost && text(ghost).includes('Amérique du Nord') && ghost.style['--gx'] === (eu.left + 20) + 'px'
        && mark.classList.contains('on') && mark.style['--mx'] === (eu.left - 5) + 'px' && mark.style['--my'] === '0px' && mark.style['--mh'] === '160px',
        'glisser : vignette soulevée, fantôme et repère attendus, ' + JSON.stringify({ mx: mark.style['--mx'], on: mark.className, gx: ghost && ghost.style['--gx'] }));
      fire('pointerup', { pointerId: 3, clientX: eu.left + 20, clientY: eu.top + 80 });
      await settle();
      check(roLayout() === '[Continent] Océanie Amérique du Nord Europe Afrique Asie | [Sous-continent]' && said() === '« Amérique du Nord » : position 3 sur 7.'
        && !d.querySelectorAll('.ro-ghost').length && !mark.classList.contains('on') && !tileFor('Amérique du Nord').classList.contains('lifted') && listening() === 0,
        'glisser à la souris : ' + roLayout() + ' / ' + said());
    }
    // Lâcher sur la moitié gauche d'un intercalaire = à la fin de la section d'avant (repère après sa dernière vignette) ;
    // dans le trou de la ligne, après la vignette à gauche : même place.
    {
      const at = geom();
      const oc = at('Océanie');
      tileFor('Océanie').querySelector('.ro-title').dispatch('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 4, clientX: oc.left + 50, clientY: oc.top + 100 });
      const sc = at('Sous-continent');
      const asie = at('Asie');
      const mark = grid().parentNode.querySelector('.ro-mark');
      fire('pointermove', { pointerId: 4, clientX: sc.left + 20, clientY: sc.top + 60 });
      await settle();
      check(mark.classList.contains('on') && mark.style['--mx'] === (asie.right + 5) + 'px' && mark.style['--my'] === asie.top + 'px', 'avant un intercalaire : repère après Asie attendu, ' + mark.style['--mx'] + ' ' + mark.style['--my']);
      fire('pointermove', { pointerId: 4, clientX: 400, clientY: asie.top + 80 });
      await settle();
      check(mark.classList.contains('on') && mark.style['--mx'] === (asie.right + 5) + 'px', 'trou de la grille : repère après Asie attendu, ' + mark.style['--mx']);
      fire('pointerup', { pointerId: 4, clientX: 400, clientY: asie.top + 80 });
      await settle();
      check(roLayout() === '[Continent] Amérique du Nord Europe Afrique Asie Océanie | [Sous-continent]', 'lâcher avant un intercalaire : ' + roLayout());
    }
    // Au doigt : hors de la poignée, rien (la page défile) ; par la poignée, l'intercalaire passe après Europe.
    {
      let at = geom();
      const eu = at('Europe');
      tileFor('Europe').querySelector('.ro-title').dispatch('pointerdown', { pointerType: 'touch', button: 0, pointerId: 5, clientX: eu.left + 50, clientY: eu.top + 120 });
      check(listening() === 0, 'au doigt hors de la poignée : aucun glisser attendu');
      at = geom();
      const sc = at('Sous-continent');
      tileFor('Sous-continent').querySelector('.ro-grip').dispatch('pointerdown', { pointerType: 'touch', button: 0, pointerId: 6, clientX: sc.left + 90, clientY: sc.top + 15 });
      check(listening() === 1, 'au doigt sur la poignée : glisser attendu');
      fire('pointermove', { pointerId: 6, clientX: eu.left + 80, clientY: eu.top + 80 });
      await settle();
      check(tileFor('Sous-continent').classList.contains('lifted'), 'au doigt : vignette soulevée attendue');
      fire('pointerup', { pointerId: 6, clientX: eu.left + 80, clientY: eu.top + 80 });
      await settle();
      check(roLayout() === '[Continent] Amérique du Nord Europe | [Sous-continent] Afrique Asie Océanie' && said() === '« Sous-continent » (intercalaire) : position 4 sur 7.',
        'au doigt, intercalaire déplacé : ' + roLayout() + ' / ' + said());
    }
    const DRAFT = '[Continent] Amérique du Nord Europe | [Sous-continent] Afrique Asie Océanie';
    // Échap pendant un glisser : rien ne bouge.
    {
      const at = geom();
      const af = at('Afrique');
      tileFor('Afrique').querySelector('.ro-title').dispatch('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 8, clientX: af.left + 50, clientY: af.top + 100 });
      fire('pointermove', { pointerId: 8, clientX: 20, clientY: 80 });
      await settle();
      d.body.dispatch('keydown', { key: 'Escape' });
      await settle();
      fire('pointerup', { pointerId: 8, clientX: 20, clientY: 80 });
      await settle();
      check(roLayout() === DRAFT && said() === 'Déplacement annulé.' && !tileFor('Afrique').classList.contains('lifted') && listening() === 0, 'Échap : ' + roLayout() + ' / ' + said());
    }
    // « Annuler » : aucune requête ; « Reprendre » rend le brouillon.
    let mark = apiLog.length;
    btnIn(bar(), 'Annuler').click();
    await settle();
    check(!grid() && albumLayout() === ORIG && saves(mark) === 0 && toast() && text(toast()).includes("Ordre de « Continents » laissé tel quel : rien n'a été envoyé."),
      '« Annuler » : album d\'avant sans requête attendu, ' + albumLayout() + ' / ' + (toast() ? text(toast()) : ''));
    check(d.activeElement === d.getElementById('reorder-btn'), '« Annuler » : focus sur « Réorganiser » attendu');
    toastBtn('Reprendre').click();
    await settle();
    check(roLayout() === DRAFT, '« Reprendre » : brouillon attendu, ' + roLayout());
    // Quitter l'album, puis l'onglet : le brouillon est gardé, le message le dit ; « Y revenir », ou l'album rouvert, le rend.
    await back();
    check(!grid() && toast() && text(toast()).includes("Le nouvel ordre de « Continents » n'est pas encore enregistré : il t'attend dans son album.") && saves(mark) === 0,
      'quitter l\'album : message du brouillon attendu, ' + (toast() ? text(toast()) : ''));
    toastBtn('Y revenir').click();
    await settle();
    check(roLayout() === DRAFT, '« Y revenir » : brouillon attendu, ' + roLayout());
    d.getElementById('tab-cartes').click();
    await settle();
    check(toast() && text(toast()).includes('pas encore enregistré'), 'quitter l\'onglet : message du brouillon attendu');
    d.getElementById('tab-collections').click();
    await settle();
    check(roLayout() === DRAFT, 'retour sur l\'onglet : brouillon attendu, ' + roLayout());
    // « Enregistrer l'ordre » : une seule requête, les éléments tels quels dans le nouvel ordre.
    mark = apiLog.length;
    btnIn(bar(), 'Enregistrer l\'ordre').click();
    check(await waitFor(() => !grid() && !!d.querySelectorAll('.cardgrid').length), 'enregistrer : mode réorganisation resté ouvert');
    await settle(80);
    {
      const t = await serverOf('Continents');
      const by = (x) => t.items.find((i) => i.title === x);
      check(saves(mark) === 1 && t.items.map((i) => i.title).join('|') === 'Continent|Amérique du Nord|Europe|Sous-continent|Afrique|Asie|Océanie',
        'enregistrer : une requête et le nouvel ordre attendus, ' + saves(mark) + ' / ' + t.items.map((i) => i.title).join('|'));
      check(by('Afrique').qid === 'Q15' && by('Afrique').rarity === 'R' && by('Afrique').description === 'continent' && by('Sous-continent').sep === true
        && by('Sous-continent').image === 'https://upload.wikimedia.org/sc.jpg' && by('Continent').sep === true && !by('Europe').sep && t.items.length === 7,
        'enregistrer : champs perdus, ' + JSON.stringify(t.items));
    }
    check(albumLayout() === DRAFT && toast() && text(toast()).includes('Nouvel ordre de « Continents » enregistré.') && btnIn(d.body, 'Ordre').getAttribute('aria-pressed') === 'true',
      'après l\'enregistrement : ' + albumLayout() + ' / ' + (toast() ? text(toast()) : ''));
    // « Annuler » du message : l'ordre d'avant revient.
    mark = apiLog.length;
    toastBtn('Annuler').click();
    check(await waitFor(() => albumLayout() === ORIG), '« Annuler » après l\'enregistrement : ordre d\'avant attendu, ' + albumLayout());
    check(saves(mark) === 1 && (await serverOf('Continents')).items.map((i) => i.title).join('|') === CONT.map((i) => i.title).join('|'), '« Annuler » : ordre d\'avant non enregistré');
    // Sans changement, quitter referme simplement le mode (pas de brouillon).
    btnIn(d.body, 'Réorganiser').click();
    await settle();
    await back();
    check(!toast() || !text(toast()).includes('pas encore enregistré'), 'sans changement : pas de message de brouillon attendu');
    await openRow('Continents');
    check(!grid() && albumLayout() === ORIG, 'sans changement : album ordinaire attendu au retour');
    await back();
    // 3 000 éléments : toutes les vignettes ; « → », puis « Position » 3000 ; brouillon gardé ; « Réorganiser » d'une autre
    // collection demande d'abord ; enregistré en une requête.
    await openRow('Grande');
    let t0 = Date.now();
    btnIn(d.body, 'Réorganiser').click();
    check(await waitFor(() => tiles().length === 3000, 20000), 'grande collection : 3 000 vignettes attendues, ' + tiles().length);
    const ms = Date.now() - t0;
    t0 = Date.now();
    arrow('Article R0000', 'next').click();
    await settle();
    check(roTitle(tiles()[0]) === 'Article R0001' && roTitle(tiles()[1]) === 'Article R0000' && said() === '« Article R0000 » : position 2 sur 3 000.', 'grande collection : « → » : ' + said());
    type(d.getElementById('reorder-pos'), '3000');
    await settle();
    btnIn(bar(), 'Déplacer').click();
    await settle();
    check(roTitle(tiles()[2999]) === 'Article R0000' && barName() === 'Article R0000 · 3 000 sur 3 000', 'grande collection : « Position » 3000 : ' + barName());
    console.log(`réorganiser : 3 000 vignettes en ${ms} ms (faux DOM), deux déplacements en ${Date.now() - t0} ms`);
    await back();
    await openRow('Continents');
    btnIn(d.body, 'Réorganiser').click();
    await settle();
    check(modal() && text(modal()).includes('Le nouvel ordre de « Grande » n\'est pas enregistré. L\'abandonner pour réorganiser « Continents » ?'), 'autre brouillon : confirmation attendue');
    btnIn(modal(), 'Annuler').click();
    await settle(300);
    check(!grid(), 'autre brouillon gardé : pas de mode réorganisation pour « Continents »');
    await back();
    await openRow('Grande');
    check(await waitFor(() => tiles().length === 3000 && roTitle(tiles()[2999]) === 'Article R0000'), 'grande collection : brouillon attendu au retour');
    mark = apiLog.length;
    btnIn(bar(), 'Enregistrer l\'ordre').click();
    check(await waitFor(() => !grid(), 10000), 'grande collection : enregistrement sans effet');
    {
      const t = await serverOf('Grande');
      check(saves(mark) === 1 && t.items.length === 3000 && t.items[0].title === 'Article R0001' && t.items[2999].title === 'Article R0000' && t.items[2999].qid === 'Q750000'
        && t.items.every((i) => /^Q75\d{4}$/.test(i.qid)), 'grande collection enregistrée : ' + t.items.slice(0, 2).map((i) => i.title).join('|') + ' … ' + t.items[2999].title);
    }
    await back();
    // Collection faite d'une catégorie : « Réorganiser… » dit pourquoi et propose une copie à ordonner.
    await openRow('Races bovines');
    check(!btnIn(d.body, 'Réorganiser') && btnIn(d.body, 'Réorganiser…'), 'collection d\'une catégorie : « Réorganiser… » attendu');
    btnIn(d.body, 'Réorganiser…').click();
    await settle();
    check(modal() && text(modal().querySelector('h2')) === 'Réorganiser « Races bovines »' && text(modal()).includes('« Races bovines » est faite de la catégorie Wikipédia « Race bovine »')
      && text(modal()).includes('elle ne se réorganise donc pas') && text(modal()).includes('« Races bovines (mon ordre) »'), 'collection d\'une catégorie : explication attendue, ' + (modal() ? text(modal()) : ''));
    mark = apiLog.length;
    btnIn(modal(), 'Créer la copie et la réorganiser').click();
    check(await waitFor(() => !modal() && roLayout() === 'Aubrac Charolaise Salers'), 'copie à ordonner : mode réorganisation attendu, ' + roLayout());
    {
      const all = await targetsR();
      const copy = all.find((x) => x.name === 'Races bovines (mon ordre)');
      const orig = all.find((x) => x.name === 'Races bovines');
      check(saves(mark) === 1 && copy && !copy.source && copy.items.map((i) => i.title).join('|') === 'Aubrac|Charolaise|Salers' && orig.source === 'wp:Race bovine'
        && orig.items.map((i) => i.title).join('|') === 'Salers|Aubrac|Charolaise', 'copie à ordonner : ' + JSON.stringify(all.map((x) => [x.name, x.source, x.items.length])));
    }
    arrow('Aubrac', 'next').click();
    await settle();
    btnIn(bar(), 'Enregistrer l\'ordre').click();
    check(await waitFor(() => !grid()), 'copie : enregistrement sans effet');
    check((await serverOf('Races bovines (mon ordre)')).items.map((i) => i.title).join('|') === 'Charolaise|Aubrac|Salers', 'copie : nouvel ordre non enregistré');
    await back();
    // Ancien thème du catalogue sans ordre : ordre manuel sur place (même collection, sans source, de A à Z), numérotée.
    await openRow('Vaches du catalogue');
    btnIn(d.body, 'Réorganiser…').click();
    await settle();
    check(modal() && text(modal()).includes('ancien thème du catalogue sans ordre'), 'thème du catalogue : explication attendue');
    btnIn(modal(), 'Passer en ordre manuel').click();
    check(await waitFor(() => !modal() && roLayout() === 'Aubrac Charolaise Salers'), 'thème du catalogue : mode réorganisation attendu, ' + roLayout());
    {
      const all = await targetsR();
      const v = all.filter((x) => x.name === 'Vaches du catalogue');
      check(v.length === 1 && !v[0].source && v[0].items.map((i) => i.title).join('|') === 'Aubrac|Charolaise|Salers', 'thème du catalogue en ordre manuel : ' + JSON.stringify(v));
    }
    btnIn(bar(), 'Annuler').click();
    await settle();
    check(!grid() && d.querySelectorAll('.slot__no').length === 3 && btnIn(d.body, 'Réorganiser'), 'thème du catalogue : album numéroté attendu après « Annuler »');
  }

  // 33. Intercalaires détectés à l'ouverture de l'album (2026-10-18) : « Continent » (suivi de cartes décrites « continent
  // … ») et « Sous-continent » (suivi de « sous-continent … ») sont cochés tout seuls, en une requête, avec « Annuler » ;
  // annulés, ils passent à sep: false et ne sont plus jamais recochés. Pangée (dernière) ne l'est pas.
  if (!SERVER) {
    const saved = ['classeur-key', 'classeur-known'].map((k) => [k, ls.get(k)]);
    const keyD = await makeOtherAccount('Daphné');
    const it = (title, description) => ({ title, description, image: null, status: 'ok' });
    await rawApi('POST', '/api/targets/save', keyD, { name: 'Continents détectés', items: [
      it('Continent', 'très grande masse de terre émergée'), it('Afrique', 'continent'), it('Europe', 'continent terrestre situé au nord-ouest de l’Eurasie'),
      it('Asie', 'continent terrestre'), it('Sous-continent', 'partie d’un continent'), it('Amérique du Nord', 'sous-continent nord-américain'),
      it('Amérique du Sud', 'sous-continent de l’Amérique'), it('Pangée', 'supercontinent')] });
    const sepsOf = async () => {
      const t = (await rawApi('GET', '/api/targets', keyD)).body.targets.find((x) => x.name === 'Continents détectés');
      return t.items.filter((x) => 'sep' in x).map((x) => x.title + '=' + x.sep).join(', ');
    };
    ls.set('classeur-key', keyD);
    ls.set('classeur-known', JSON.stringify([{ key: keyD, name: 'Daphné' }]));
    const pd = openPage({ idb: 'absent' });
    const d = pd.doc;
    const row = () => d.querySelectorAll('.row').find((n) => n.querySelector('.name') && text(n.querySelector('.name')) === 'Continents détectés');
    const goList = async () => { const t = d.getElementById('tab-collections'); if (t) t.click(); await settle(60); };
    for (let i = 0; i < 120 && !d.getElementById('tab-collections'); i++) await sleep(25);
    await goList();
    check(await waitFor(() => !!row()), 'collection « Continents détectés » absente de « Mes collections »');
    row().click();
    let seps = '';
    for (let i = 0; i < 200 && seps === ''; i++) { await sleep(25); seps = await sepsOf(); }
    check(seps === 'Continent=true, Sous-continent=true', 'intercalaires détectés : ' + seps);
    await settle(60);
    const toast = d.querySelectorAll('.toast')[0];
    check(toast && text(toast).includes('« Continent » et « Sous-continent » cochées comme intercalaires dans « Continents détectés » (détection automatique).'), 'message de la détection : ' + (toast ? text(toast) : 'absent'));
    toast.querySelectorAll('button').find((b) => text(b) === 'Annuler').click();
    for (let i = 0; i < 200 && seps !== 'Continent=false, Sous-continent=false'; i++) { await sleep(25); seps = await sepsOf(); }
    check(seps === 'Continent=false, Sous-continent=false', '« Annuler » de la détection : ' + seps);
    // Rouvert : rien n'est recoché.
    d.querySelectorAll('button').find((b) => text(b).includes('Toutes les collections')).click();
    await settle(60);
    row().click();
    await settle(300);
    check((await sepsOf()) === 'Continent=false, Sous-continent=false' && !d.querySelectorAll('.toast').some((n) => text(n).includes('détection automatique')), 'intercalaires annulés recochés à la réouverture : ' + (await sepsOf()));
    for (const [k, v] of saved) if (v == null) ls.delete(k); else ls.set(k, v);
  }

  // 34. Adresse de chaque vue (#/…, 2026-10-20) : rafraîchir (une page rouverte sur une adresse) rouvre la vue — onglet,
  // collection, catégorie, filtres et tris, fiche, classeur d'un ami, échanges ; nouvelle vue = nouvelle entrée de
  // l'historique, filtres et fiche = même entrée (regroupés) ; Précédent / Suivant ; liens morts signalés ; jamais la clé.
  {
    const key = ls.get('classeur-key');
    const tl = (await rawApi('GET', '/api/targets', key)).body.targets;
    const t = tl.find((x) => x.items.length >= 2 && !/^(wp|links):/.test(x.source || ''));
    check(t, 'adresses : aucune collection pour le test');
    const someCard = (await rawApi('GET', '/api/cards', key)).body.cards.find((c) => c.title);
    const pages = [];
    const open = async (hash) => {
      const pg = openPage({ hash });
      pages.push(pg);
      for (let i = 0; i < 200 && !pg.doc.getElementById('tab-collections'); i++) await sleep(25);
      await settle(150);
      return pg;
    };
    const ptext = (pg) => text(pg.doc.body);
    const pressed = (pg) => pg.doc.querySelectorAll('button[aria-pressed="true"]').map(text);
    const albumName = (pg) => { const a = pg.doc.querySelector('.album-title'); return a && a.querySelector('h2') ? text(a.querySelector('h2')) : ''; };
    const tabOn = (pg) => (pg.doc.querySelector('button[aria-selected="true"]') || { id: '' }).id;
    const log = (pg) => pg.ctx.history.log;
    const albumHash = '#/collections/' + encodeURIComponent(t.id) + '?filtre=missing&tri=rarity';

    // Rafraîchi sur une collection filtrée et triée : rouverte telle quelle, sans nouvelle entrée.
    const pa = await open(albumHash);
    check(albumName(pa) === t.name && pressed(pa).includes('Manquantes') && pressed(pa).includes('Rareté'), 'adresse d\'une collection : ' + albumName(pa) + ' / ' + pressed(pa).join(','));
    check(pa.ctx.location.hash === albumHash && !log(pa).some((x) => x.startsWith('push')), 'adresse d\'une collection réécrite : ' + pa.ctx.location.hash + ' ; ' + log(pa).join(', '));
    // Autre onglet : nouvelle entrée ; recherche et tri : même entrée, une fois la saisie finie.
    pa.doc.getElementById('tab-cartes').click();
    await settle();
    check(pa.ctx.location.hash === '#/cartes' && log(pa).at(-1) === 'push #/cartes', 'onglet « Mes cartes » : ' + log(pa).join(', '));
    const q = pa.doc.getElementById('q');
    for (const v of ['m', 'ma', 'mar']) { q.value = v; q.dispatch('input'); await sleep(20); }
    check(pa.ctx.location.hash === '#/cartes', 'recherche : adresse écrite avant la fin de la saisie');
    await sleep(400);
    check(pa.ctx.location.hash === '#/cartes?q=mar' && log(pa).filter((x) => x.includes('q=')).length === 1, 'recherche : ' + log(pa).join(', '));
    const sel = pa.doc.getElementById('sort');
    sel.value = 'title';
    sel.dispatch('change');
    await sleep(400);
    check(pa.ctx.location.hash === '#/cartes?q=mar&tri=title' && pa.ctx.history.entries.length === 2, 'tri : ' + log(pa).join(', '));
    // Précédent : la collection, avec ses filtres ; Suivant : « Mes cartes » avec la recherche et le tri.
    pa.ctx.history.back();
    await settle(100);
    check(albumName(pa) === t.name && pressed(pa).includes('Manquantes') && pa.ctx.location.hash === albumHash, 'Précédent : ' + albumName(pa) + ' ' + pa.ctx.location.hash);
    pa.ctx.history.forward();
    await settle(100);
    check(tabOn(pa) === 'tab-cartes' && pa.doc.getElementById('q').value === 'mar' && pa.doc.getElementById('sort').value === 'title', 'Suivant : ' + tabOn(pa) + ' « ' + (pa.doc.getElementById('q') || {}).value + ' »');
    check(pa.ctx.history.entries.length === 2, 'Précédent / Suivant ne doivent pas ajouter d\'entrée : ' + pa.ctx.history.entries.join(' | '));
    // Retour à la liste des collections : adresse nue.
    pa.doc.getElementById('tab-collections').click();
    await settle();
    pa.doc.querySelectorAll('button').find((b) => text(b).includes('Toutes les collections')).click();
    await settle();
    check(pa.ctx.location.hash === '', 'liste des collections : adresse nue attendue, ' + pa.ctx.location.hash);

    // Rafraîchi sur une fiche : rouverte une fois les cartes là ; refermée : même entrée, sans « carte= ».
    const cardHash = '#/cartes?q=' + encodeURIComponent(someCard.title).replace(/%20/g, '+') + '&carte=' + encodeURIComponent(someCard.id);
    const pc = await open(cardHash);
    check(pc.doc.querySelector('.fiche') && text(pc.doc.getElementById('detail-title')).includes(someCard.title), 'adresse d\'une fiche : fiche non rouverte');
    check(pc.doc.getElementById('q').value === someCard.title, 'adresse d\'une fiche : recherche perdue');
    pc.doc.body.dispatch('keydown', { key: 'Escape' });
    await sleep(400);
    check(!pc.doc.querySelector('.fiche') && !pc.ctx.location.hash.includes('carte=') && !log(pc).some((x) => x.startsWith('push')), 'fiche refermée : ' + log(pc).join(', '));

    // Catégorie de Wikipédia (sous-catégories comprises) : relue et rouverte.
    const pk = await open('#/categorie/Couleur?sous=1');
    check(await waitFor(() => albumName(pk).includes('Couleur')) && pk.ctx.location.hash === '#/categorie/Couleur?sous=1', 'adresse d\'une catégorie : « ' + albumName(pk) + ' » ' + pk.ctx.location.hash);

    // Liens morts : collection supprimée, carte disparue, vue inconnue ; signalés et remplacés (même entrée).
    const pd = await open('#/collections/inconnue');
    check(ptext(pd).includes("La collection de cette adresse n'existe plus") && pd.ctx.location.hash === '' && pd.ctx.history.entries.length === 1, 'collection morte : ' + pd.ctx.location.hash + ' ' + ptext(pd).slice(0, 200));
    const pe = await open('#/cartes?carte=inconnue');
    check(ptext(pe).includes("La carte de cette adresse n'est plus dans ton classeur") && pe.ctx.location.hash === '#/cartes', 'carte morte : ' + pe.ctx.location.hash);
    const pf = await open('#/nimportequoi/12');
    check(tabOn(pf) === 'tab-collections' && pf.ctx.location.hash === '', 'vue inconnue : ' + tabOn(pf) + ' ' + pf.ctx.location.hash);

    // Entre amis : classeur d'un ami (filtre), échanges qui me concernent, ami qui n'existe pas.
    const was = (await rawApi('GET', '/api/me', key)).body.shared;
    if (!was) await rawApi('PATCH', '/api/me', key, { shared: true });
    const members = (await rawApi('GET', '/api/members', key)).body.members || [];
    const paul = members.find((m) => m.name === 'Paul');
    if (paul) {
      const pp = await open('#/ami/' + paul.id + '?filtre=missing');
      check(await waitFor(() => pressed(pp).includes('Me manquent'), 5000) && pp.ctx.location.hash === '#/ami/' + paul.id + '?filtre=missing', 'adresse du classeur de Paul : ' + pressed(pp).join(',') + ' ' + pp.ctx.location.hash);
      const pt = await open('#/amis/echanges?qui=me');
      check(await waitFor(() => pressed(pt).includes('Ce qui me concerne'), 5000) && ptext(pt).includes('Échanges possibles'), 'adresse des échanges : ' + pressed(pt).join(','));
      const pg = await open('#/ami/inconnu');
      check(await waitFor(() => pg.ctx.location.hash === '#/amis', 5000) && pg.ctx.history.entries.length === 1, 'ami inconnu : ' + pg.ctx.location.hash);
    } else check(SERVER, 'adresses : Paul ne partage plus ses cartes');
    if (!was) await rawApi('PATCH', '/api/me', key, { shared: false });

    // La clé : une recherche « &cle=… » reste un filtre (encodée), jamais lue comme un lien personnel.
    const pq = await open('#/cartes');
    const q2 = pq.doc.getElementById('q');
    q2.value = '&cle=' + 'A'.repeat(43);
    q2.dispatch('input');
    await sleep(400);
    check(!/(?:^#|&)cle=/.test(pq.ctx.location.hash), 'une recherche ne doit jamais ressembler à un lien personnel : ' + pq.ctx.location.hash);
    const pr = await open(pq.ctx.location.hash);
    check(pr.doc.getElementById('q').value === '&cle=' + 'A'.repeat(43) && ls.get('classeur-key') === key, 'recherche « &cle= » rouverte : ' + pr.doc.getElementById('q').value);
    for (const pg of [pa, ...pages]) check(!log(pg).some((x) => /cle=[A-Za-z0-9_-]{20}/.test(decodeURIComponent(x)) && !x.includes('q=')), 'clé écrite dans l\'adresse : ' + log(pg).join(', '));
    check(ls.get('classeur-key') === key, 'les adresses ont changé la clé gardée');
    console.log(`adresses : ${pages.length} pages rouvertes sur une adresse${paul ? ', Entre amis compris' : ''} ; historique de la première : ${log(pa).join(', ')}`);
  }

  // 35. Collections citées dans le chat (demande du 2026-10-20) : « #c: » propose les collections (les tiennes, celles des
  // amis qui les montrent) et insère leur lien ; dans le message, le nom de la collection (lien vers elle) et, dessous, sa
  // ligne (éventail, progression de son propriétaire) ; pour qui ne montre pas ses cartes, son nom et son propriétaire
  // seulement. Serveur simulé seulement (l'hôte de la page n'est pas celui d'un serveur de dev).
  if (!SERVER) {
    const keyT = await makeOtherAccount('Tiff');
    const keyY = await makeOtherAccount('Yan');
    const keyZ = await makeOtherAccount('Zed');
    const mkC = (id, title, rarity) => ({ id, title, rarity, atk: 1, def: 1, quality: 1, pageviews: 10, category: 'pirate', image: null, url: null,
      count: 1, shiny: false, starred: false, obtained_at: '2026-10-01T00:00:00Z' });
    await seedCards(keyT, [mkC('t1', 'Monkey D. Luffy', 'L'), mkC('t2', 'Roronoa Zoro', 'UR')]);
    await seedCards(keyY, [mkC('y1', 'Nami', 'R')]);
    const it0 = (title) => ({ title, description: null, image: null, status: 'ok' });
    check((await rawApi('POST', '/api/targets/save', keyT, { name: 'Mugiwara', items: [it0('Monkey D. Luffy'), it0('Roronoa Zoro'), it0('Nami')] })).status === 200, 'collection « Mugiwara » refusée');
    const tid = (await rawApi('GET', '/api/targets', keyT)).body.targets.find((t) => t.name === 'Mugiwara').id;
    check((await rawApi('POST', '/api/targets/save', keyY, { name: 'Mugiwara (mes cartes)', items: [it0('Nami')] })).status === 200, 'collection de Yan refusée');
    check((await rawApi('PATCH', '/api/me', keyT, { shared: true, shared_targets: true })).status === 200, 'partage de Tiff refusé');
    check((await rawApi('PATCH', '/api/me', keyY, { shared: true })).status === 200, 'partage de Yan refusé');
    const saved = ['classeur-key', 'classeur-known'].map((k) => [k, ls.get(k)]);
    ls.set('classeur-key', keyY);
    ls.set('classeur-known', JSON.stringify([{ key: keyY, name: 'Yan' }]));
    const py = openPage({ idb: 'absent', hash: '#/chat' });
    const d = py.doc;
    const field = () => d.getElementById('chat-input');
    const acList = () => d.getElementById('chat-ac');
    const acRows = () => (acList() ? acList().querySelectorAll('li').map((li) => text(li)) : []);
    check(await waitFor(() => field()), 'chat de Yan non ouvert');
    type(field(), 'Bravo Tiff pour #c:mugi');
    await settle();
    check(await waitFor(() => acRows().length === 2), 'suggestions de « #c:mugi » : ' + acRows().join(' | '));
    check(acRows()[0] === 'Mugiwara (mes cartes)ta collection' && acRows()[1] === 'Mugiwarade Tiff' && acList().getAttribute('aria-label') === 'Collections à citer',
      'suggestions de « #c:mugi » (la tienne d\'abord, puis celle de Tiff) : ' + acRows().join(' | '));
    field().dispatch('keydown', { key: 'ArrowDown' });
    await settle();
    field().dispatch('keydown', { key: 'Enter' });
    await settle();
    const pubT = (await rawApi('GET', '/api/members', keyY)).body.members.find((m) => m.name === 'Tiff').id;
    const url = `${ORIGIN}/#/ami/${pubT}/${tid}`;
    check(field().value === `Bravo Tiff pour ${url} `, 'lien de la collection inséré : « ' + field().value + ' »');
    type(field(), field().value + '!');
    field().dispatch('keydown', { key: 'Enter' });
    const last = () => { const l = d.querySelectorAll('.chat-msg'); return l[l.length - 1] || null; };
    check(await waitFor(() => last() && last().classList.contains('mine') && last().querySelector('.chat-col')), 'message avec la collection citée absent');
    const a = last().querySelector('.chat-col');
    check(a.tagName === 'A' && text(a) === 'Mugiwara' && a.getAttribute('href') === `#/ami/${pubT}/${tid}` && !a.getAttribute('target')
      && text(last().querySelector('.chat-msg__text')) === 'Bravo Tiff pour Mugiwara !', 'lien de la collection dans le message : ' + text(last()));
    // Aperçu : la ligne de la collection de Tiff, avec SA progression (2 sur 3) et ce que Yan peut lui donner (Nami).
    const rowIn = (m) => { const e = m && m.querySelector('.chat-embed'); return e ? e.querySelector('.row') : null; }; // le faux DOM ne lit pas « .a .b »
    const row = () => rowIn(last());
    check(await waitFor(() => row()), 'aperçu de la collection absent : ' + text(last()));
    check((row().getAttribute('aria-label') || '').startsWith('Mugiwara : Tiff en a 2 sur 3') && text(row()).includes("Tu peux l'aider"), 'aperçu : ' + row().getAttribute('aria-label'));
    // Zed ne montre pas ses cartes : le nom (sans lien) et le propriétaire, et pourquoi pas plus.
    ls.set('classeur-key', keyZ);
    ls.set('classeur-known', JSON.stringify([{ key: keyZ, name: 'Zed' }]));
    const pz = openPage({ idb: 'absent', hash: '#/chat' });
    const lastZ = () => { const l = pz.doc.querySelectorAll('.chat-msg'); return l[l.length - 1] || null; };
    check(await waitFor(() => lastZ() && lastZ().querySelector('.chat-col')), 'message de Yan absent chez Zed');
    const z = lastZ();
    check(z.querySelector('.chat-col').tagName === 'SPAN' && text(z.querySelector('.chat-col')) === 'Mugiwara' && !rowIn(z)
      && text(z.querySelector('.chat-embed')).includes('Collection de Tiff') && text(z.querySelector('.chat-embed')).includes('Montre tes cartes'), 'collection citée vue par Zed : ' + text(z));
    // Tiff ne montre plus ses collections : « collection non partagée », sans aperçu.
    check((await rawApi('PATCH', '/api/me', keyT, { shared_targets: false })).status === 200, 'partage des collections de Tiff non coupé');
    const r = await rawApi('GET', '/api/chat', keyY);
    check(JSON.stringify(r.body.messages.at(-1).refs) === '[{"at":16,"len":23,"gone":true}]', 'collection plus montrée : ' + JSON.stringify(r.body.messages.at(-1).refs));
    for (const [k, v] of saved) if (v == null) ls.delete(k); else ls.set(k, v);
    console.log('collections citées : #c:, lien, aperçu (progression de son propriétaire), nom seul sans partage');
  }

  // 36. Membres cités dans le chat (demande du 2026-10-20) : « #u: » propose les membres qui montrent leurs cartes et
  // insère le lien de leur classeur ; dans le message, son prénom (lien vers son classeur) et, dessous, son pseudo dans le
  // jeu et les chiffres de son classeur (cartes, collections, complètes) ; pour qui ne montre pas ses cartes, le prénom
  // seul. Serveur simulé seulement.
  if (!SERVER) {
    const keyU = await makeOtherAccount('Uma');
    const keyV = await makeOtherAccount('Vic');
    const keyW = await makeOtherAccount('Wil');
    const mkC = (id, title, rarity) => ({ id, title, rarity, atk: 1, def: 1, quality: 1, pageviews: 10, category: 'x', image: null, url: null,
      count: 1, shiny: false, starred: false, obtained_at: '2026-10-01T00:00:00Z' });
    await seedCards(keyU, [mkC('u1', 'Mercure', 'L'), mkC('u2', 'Vénus', 'R'), mkC('u3', 'Mars', 'C')]);
    await seedCards(keyV, [mkC('v1', 'Terre', 'R')]);
    const it0 = (title) => ({ title, description: null, image: null, status: 'ok' });
    check((await rawApi('POST', '/api/targets/save', keyU, { name: 'Planètes telluriques', items: [it0('Mercure'), it0('Vénus'), it0('Terre'), it0('Mars')] })).status === 200, 'collection d\'Uma refusée');
    check((await rawApi('POST', '/api/targets/save', keyU, { name: 'Intérieures', items: [it0('Mercure'), it0('Vénus')] })).status === 200, 'collection d\'Uma refusée');
    check((await rawApi('PATCH', '/api/me', keyU, { shared: true, shared_targets: true, pseudo: 'UmaDu75' })).status === 200, 'partage d\'Uma refusé');
    check((await rawApi('PATCH', '/api/me', keyV, { shared: true })).status === 200, 'partage de Vic refusé');
    const saved = ['classeur-key', 'classeur-known'].map((k) => [k, ls.get(k)]);
    ls.set('classeur-key', keyV);
    ls.set('classeur-known', JSON.stringify([{ key: keyV, name: 'Vic' }]));
    const pv = openPage({ idb: 'absent', hash: '#/chat' });
    const d = pv.doc;
    const field = () => d.getElementById('chat-input');
    const acList = () => d.getElementById('chat-ac');
    const acRows = () => (acList() ? acList().querySelectorAll('li').map((li) => text(li)) : []);
    check(await waitFor(() => field()), 'chat de Vic non ouvert');
    // « #u: » seul : toi d'abord (ton classeur), puis les autres.
    type(field(), '#u:');
    await settle();
    check(await waitFor(() => acRows().length >= 2), 'suggestions de « #u: » : ' + acRows().join(' | '));
    check(acRows()[0] === 'Victoi : ton classeur', 'suggestions de « #u: » (toi d\'abord) : ' + acRows().join(' | '));
    field().dispatch('keydown', { key: 'Enter' });
    await settle();
    const pubV = (await rawApi('GET', '/api/me', keyV)).body.public_id;
    check(pubV && field().value === `${ORIGIN}/#/ami/${pubV} `, 'ton lien inséré : « ' + field().value + ' »');
    field().dispatch('keydown', { key: 'Enter' });
    const lastV = () => { const l = d.querySelectorAll('.chat-msg'); return l[l.length - 1] || null; };
    check(await waitFor(() => lastV() && lastV().querySelector('.chat-user')), 'message te citant absent');
    const me = lastV().querySelector('.chat-user');
    check(text(me) === 'Vic' && me.getAttribute('href') === '#/cartes' && text(lastV().querySelector('.chat-member')).includes('1 carte'), 'toi cité : ' + text(lastV()));
    // Ton lien tel que les autres le voient (#/ami/<ton id public>) ouvre tes cartes.
    const go = async (href) => { pv.ctx.history.pushState(null, '', href); for (const f of [...(pv.win.listeners.hashchange || [])]) f({ type: 'hashchange' }); await settle(80); };
    await go('#/ami/' + pubV);
    check(await waitFor(() => d.getElementById('q') && pv.ctx.location.hash === '#/cartes'), 'ton propre lien n\'ouvre pas tes cartes : ' + pv.ctx.location.hash);
    await go('#/chat');
    check(await waitFor(() => field()), 'retour au chat de Vic');
    type(field(), 'Regardez #u:um');
    await settle();
    check(await waitFor(() => acRows().length === 1), 'suggestions de « #u:um » : ' + acRows().join(' | '));
    check(acRows()[0] === 'UmaUmaDu75' && acList().getAttribute('aria-label') === 'Membres à citer', 'suggestion de « #u:um » (prénom et pseudo) : ' + acRows().join(' | '));
    field().dispatch('keydown', { key: 'Enter' });
    await settle();
    const pubU = (await rawApi('GET', '/api/members', keyV)).body.members.find((m) => m.name === 'Uma').id;
    check(field().value === `Regardez ${ORIGIN}/#/ami/${pubU} `, 'lien du classeur inséré : « ' + field().value + ' »');
    type(field(), field().value + '!');
    field().dispatch('keydown', { key: 'Enter' });
    const last = () => { const l = d.querySelectorAll('.chat-msg'); return l[l.length - 1] || null; };
    check(await waitFor(() => last() && last().classList.contains('mine') && text(last()).includes('Regardez') && last().querySelector('.chat-user')), 'message avec le membre cité absent');
    const a = last().querySelector('.chat-user');
    check(a.tagName === 'A' && text(a) === 'Uma' && a.getAttribute('href') === `#/ami/${pubU}` && (a.getAttribute('title') || '').includes('UmaDu75')
      && text(last().querySelector('.chat-msg__text')) === 'Regardez Uma !', 'lien du membre dans le message : ' + text(last()));
    // Aperçu : pseudo (lien vers son profil du jeu), 3 cartes, 2 collections dont 1 complète (Intérieures).
    const card = () => last().querySelector('.chat-member');
    check(await waitFor(() => card() && text(card()).includes('2 collections')), 'aperçu du membre : ' + (card() ? text(card()) : 'absent'));
    const figs = text(card());
    check(figs.includes('3 cartes') && figs.includes('1 complète') && card().querySelector('.chat-member__pseudo').getAttribute('href') === 'https://www.wiki-masters.com/profile/UmaDu75',
      'chiffres du membre : ' + figs);
    // Wil ne montre pas ses cartes : le prénom, sans lien ni chiffres, et pourquoi.
    ls.set('classeur-key', keyW);
    ls.set('classeur-known', JSON.stringify([{ key: keyW, name: 'Wil' }]));
    const pw = openPage({ idb: 'absent', hash: '#/chat' });
    const lastW = () => { const l = pw.doc.querySelectorAll('.chat-msg'); return l[l.length - 1] || null; };
    check(await waitFor(() => lastW() && lastW().querySelector('.chat-user')), 'message de Vic absent chez Wil');
    const w = lastW();
    check(w.querySelector('.chat-user').tagName === 'SPAN' && !w.querySelector('.chat-member__pseudo') && !w.querySelector('.chat-member__figs')
      && text(w.querySelector('.chat-member')).includes('Montre tes cartes'), 'membre cité vu par Wil : ' + text(w));
    for (const [k, v] of saved) if (v == null) ls.delete(k); else ls.set(k, v);
    console.log('membres cités : #u:, lien, aperçu (pseudo, cartes, collections, complètes), prénom seul sans partage');
  }

  // Nouveautés : page à part (#/nouveautes), pastille « nouveau » tant que la dernière version n'a pas été vue dans ce
  // navigateur, liens internes, messages système du chat (nouveautes.json, contrat : SPEC.md, « Nouveautés »).
  {
    // Le vrai fichier : chaque version, rubrique, ligne, lien interne et message système se lit (rien d'écarté).
    const real = JSON.parse(fs.readFileSync(path.join(PUB, 'nouveautes.json'), 'utf8'));
    check(Array.isArray(real.versions) && real.versions.length && Array.isArray(real.chat), 'nouveautes.json : versions et chat attendus');
    for (const v of real.versions) {
      check(typeof v.id === 'string' && v.id && /^\d{4}-\d{2}-\d{2}$/.test(v.date) && Array.isArray(v.sections) && v.sections.length, 'nouveautes.json : version mal formée ' + JSON.stringify(v).slice(0, 200));
      for (const g of v.sections) {
        check(typeof g.title === 'string' && g.title && Array.isArray(g.items) && g.items.length, 'nouveautes.json : rubrique mal formée ' + JSON.stringify(g).slice(0, 200));
        for (const it of g.items) {
          check(typeof it.text === 'string' && it.text && it.text.length <= 600, 'nouveautes.json : ligne mal formée ' + JSON.stringify(it));
          if (it.to != null) check(/^#\/(collections|cartes|amis|marche|chat|maj|reglages|nouveautes)(\/|\?|$)/.test(it.to) && typeof it.link === 'string', 'nouveautes.json : lien interne inconnu ' + it.to);
        }
      }
    }
    for (const m of real.chat) check(real.versions.some((v) => v.id === m.version) && !Number.isNaN(Date.parse(m.at)) && m.text, 'nouveautes.json : message système mal formé ' + JSON.stringify(m));

    const nowIso = new Date().toISOString();
    newsFile.body = JSON.stringify({
      versions: [
        { id: 'v1', date: '2026-10-01', sections: [{ title: 'Ancienne', items: [{ text: 'Première version' }] }] },
        { id: 'v2', date: '2026-10-21', title: 'Le chat', sections: [
          { icon: '💬', title: 'Chat', items: [{ text: 'Tape `@` pour mentionner.', to: '#/chat', link: 'Chat' }, { text: '<b>pas de HTML</b>', to: 'https://exemple.fr/', link: 'Ailleurs' }] },
          { title: 'Vide', items: [] }] },
        { id: 'sans-date', sections: [{ title: 'X', items: [{ text: 'écartée' }] }] },
      ],
      chat: [{ id: 'm2', at: nowIso, text: 'Nouvelle version du classeur disponible', version: 'v2' }, { id: 'sans-heure', text: 'écarté' }],
    });
    ls.set('classeur-nouveautes-vu', 'v1');
    const follow = async (pg, href) => { // clic sur un lien « #/… » : nouvelle entrée, puis hashchange
      pg.ctx.history.pushState(null, '', href);
      for (const f of [...(pg.win.listeners.hashchange || [])]) f({ type: 'hashchange' });
      await settle(80);
    };
    const pg = openPage({});
    const pt = () => text(pg.doc.body);
    const link = () => pg.doc.querySelector('.news-link');
    check(await waitFor(() => link() && text(link()).includes('nouveau')), 'Nouveautés : pastille « nouveau » absente : ' + (link() ? text(link()) : 'pas de lien'));
    check(link().getAttribute('href') === '#/nouveautes', 'Nouveautés : lien du bandeau ' + link().getAttribute('href'));
    await follow(pg, '#/nouveautes');
    const vers = pg.doc.querySelectorAll('.news-ver');
    check(pg.doc.getElementById('h-news') && vers.length === 2, 'Nouveautés : 2 versions attendues (sans celle sans date), ' + vers.length + '\n' + pt().slice(0, 600));
    check(text(vers[0]).includes('21 octobre 2026') && text(vers[0]).includes('Nouveau') && text(vers[0]).includes('Le chat') && !text(vers[1]).includes('Nouveau'),
      'Nouveautés : la plus récente en tête, seule « Nouveau » : ' + text(vers[0]) + ' | ' + text(vers[1]));
    check(!text(vers[0]).includes('Vide') && text(vers[0]).includes('<b>pas de HTML</b>') && !vers[0].querySelectorAll('b').length, 'Nouveautés : rubrique vide affichée, ou HTML interprété');
    check(vers[0].querySelectorAll('code').map(text).join() === '@', 'Nouveautés : `@` en code attendu');
    const gos = vers[0].querySelectorAll('a.news-go');
    check(gos.length === 1 && gos[0].getAttribute('href') === '#/chat', 'Nouveautés : seul le lien interne doit rester : ' + gos.map((a) => a.getAttribute('href')).join());
    check(!text(link()).includes('nouveau') && link().getAttribute('aria-current') === 'page' && ls.get('classeur-nouveautes-vu') === 'v2', 'Nouveautés : version non marquée vue');
    check(!pg.doc.querySelector('button[aria-selected="true"]') && pg.doc.getElementById('tab-collections').getAttribute('tabindex') === '0', 'Nouveautés : aucun onglet ne doit être sélectionné, le premier joignable');
    check(pg.ctx.location.hash === '#/nouveautes', 'Nouveautés : adresse ' + pg.ctx.location.hash);
    // Lien interne vers le chat : le message système y est, discret, avec son lien vers la page, après les messages plus anciens.
    await follow(pg, '#/chat');
    check(pg.doc.getElementById('tab-chat').getAttribute('aria-selected') === 'true', 'Nouveautés : le lien « Chat » n\'ouvre pas le chat');
    check(await waitFor(() => pg.doc.querySelectorAll('.chat-sys').length === 1), 'chat : message système absent : ' + pg.doc.querySelectorAll('.chat-sys').length);
    const sys = pg.doc.querySelector('.chat-sys');
    check(text(sys).includes('Nouvelle version du classeur disponible') && sys.querySelector('a').getAttribute('href') === '#/nouveautes' && !sys.querySelector('.chat-msg__who'),
      'chat : message système mal rendu : ' + text(sys));
    const kids = [...pg.doc.querySelector('.chat-list').childNodes].filter((n) => n.nodeType === 1);
    check(kids[kids.length - 1] === sys || !pg.doc.querySelectorAll('.chat-msg').length, 'chat : le message système (le plus récent) doit être en bas du fil');
    check(text(pg.doc.getElementById('tab-chat')) === 'Chat' || !text(pg.doc.getElementById('tab-chat')).includes('1 message'), 'chat : le message système ne compte pas dans les non-lus');
    // Le lien du message système ramène à la page ; rouverte, plus de pastille ni de « Nouveau ».
    await follow(pg, sys.querySelector('a').getAttribute('href'));
    check(pg.doc.getElementById('h-news'), 'chat : le lien du message système n\'ouvre pas les nouveautés');
    const p2 = openPage({ hash: '#/nouveautes' });
    check(await waitFor(() => p2.doc.querySelectorAll('.news-ver').length === 2), 'Nouveautés : page non rouverte sur son adresse');
    check(!p2.doc.querySelector('.news-dot') && !p2.doc.querySelector('.news-new'), 'Nouveautés : version vue encore signalée');
    // Fichier absent : ni pastille ni message système, la page le dit et propose de réessayer ; le reste marche.
    newsFile.status = 404;
    ls.delete('classeur-nouveautes-vu');
    const p3 = openPage({ hash: '#/nouveautes' });
    check(await waitFor(() => text(p3.doc.body).includes("Les nouveautés n'ont pas pu être lues.")), 'Nouveautés : fichier absent non signalé');
    check(!p3.doc.querySelector('.news-dot'), 'Nouveautés : pastille sans fichier');
    newsFile.status = 200;
    newsFile.body = null;
    p3.doc.querySelectorAll('button').find((b) => text(b) === 'Réessayer').click();
    check(await waitFor(() => p3.doc.querySelectorAll('.news-ver').length === real.versions.length), 'Nouveautés : « Réessayer » ne relit pas le fichier');
    console.log(`nouveautés : ${newsFile.fetches} lectures de /nouveautes.json ; vrai fichier : ${real.versions.length} ${real.versions.length > 1 ? 'versions' : 'version'}, ${real.chat.length} message(s) système`);
  }

  // Icônes : toutes celles utilisées existent dans le sprite.
  const missing = [...new Set(usedIcons())].filter((i) => !ctx.__symbols.includes(i));
  check(!missing.length, 'icônes absentes du sprite : ' + missing.join(', '));
  check(!catalogFetches.length, 'le catalogue a été demandé : ' + catalogFetches.join(', '));
  if (errors.length) fail('erreurs pendant le rendu :\n' + errors.join('\n'));
  noVue();
  console.log(`appels Wikimedia simulés : ${wikiCalls}`);
  console.log('UI OK');
  process.exit(0);
}

// Sans Vue (cdnjs bloqué) : le fragment #cle= est quand même effacé, et la page le dit.
function noVue() {
  const { doc } = makeDom();
  const box = doc.createElement('div');
  box.setAttribute('id', 'app');
  doc.body.appendChild(box);
  const ctx = { document: doc, location: { hash: '#cle=' + 'Q'.repeat(43), pathname: '/', search: '' }, console };
  ctx.history = { replaceState: () => { ctx.location.hash = ''; } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(PUB, 'assets', 'app.js'), 'utf8'), ctx, { filename: 'app.js' });
  if (ctx.location.hash !== '') fail('sans Vue, le fragment #cle= reste dans la barre d\'adresse');
  if (!/Vue/.test(box.textContent)) fail('sans Vue, aucun message : ' + box.textContent);
}

// La collection du joueur dans le jeu (forme des cartes de GET /api/cards) : 1 050 cartes, 1 100 exemplaires (les 50
// premières en double, c10 avec un exemplaire brillant), tag du jeu « jeu » sur chacune.
function gameCards() {
  const out = [];
  for (let i = 0; i < 1050; i++) {
    const rarity = i === 0 ? 'L' : ['C', 'PC', 'R', 'SR', 'UR'][i % 5];
    const count = i < 50 ? 2 : 1;
    const shiny = i === 10;
    out.push({ id: 'c' + i, title: i === 0 ? 'Rihanna' : 'Article ' + i, rarity, atk: 100 + i, def: 50, quality: 12.5, pageviews: i * 3,
      category: i === 0 ? 'chanteuse barbadienne' : 'catégorie ' + (i % 7), image: i % 3 || i === 3 ? null : 'https://upload.wikimedia.org/x' + i + '.jpg',
      url: 'https://fr.wikipedia.org/wiki/A' + i, count, shiny, starred: false, obtained_at: `2026-10-${String(10 + (i % 5)).padStart(2, '0')}T10:00:00Z`,
      variants: shiny ? { [rarity]: 1, [rarity + '*']: 1 } : { [rarity]: count }, gtags: ['jeu'], gtagc: null });
  }
  out[2].title = '(11194) Mirna';
  out[5].title = 'Terre';
  out[6].title = 'Hydrogène (élément)';
  return out;
}

// Exécute le favori « Relier » dans une fausse page du jeu (fenêtre privée, cookie de session `cookie`) : son chargeur pose le
// jeton et charge /api/favori.js (public/assets/relier.js, l'origine du classeur à la place de __SITE__), qui envoie le
// jeton et le cookie au classeur (POST /api/link/session). Rend le texte de son encart et les corps envoyés.
async function runRelier(href, classeurFetch, cookie, host = 'www.wiki-masters.com') {
  const { doc } = makeDom();
  Object.defineProperty(doc, 'cookie', { value: cookie, configurable: true });
  const posts = [];
  const ctx = { document: doc, location: { hostname: host }, setTimeout, Promise, JSON, Math, Date, Number, String, Array, Error, console };
  ctx.window = ctx;
  ctx.fetch = async (url, init = {}) => {
    if (url !== ORIGIN + '/api/link/session') throw new Error('favori « Relier » : adresse inattendue ' + url);
    if (init.credentials !== 'omit') throw new Error('favori « Relier » : ne doit envoyer aucun cookie du classeur');
    posts.push(JSON.parse(init.body));
    return classeurFetch('/api/link/session', init);
  };
  const root = doc.documentElement;
  const append = root.appendChild.bind(root);
  let loaded = false;
  root.appendChild = (el) => {
    if (el.tagName !== 'SCRIPT') return append(el);
    if (el.src !== ORIGIN + '/api/favori.js') throw new Error('favori « Relier » : script inattendu ' + el.src);
    const code = fs.readFileSync(path.join(PUB, 'assets', 'relier.js'), 'utf8').replace(/__SITE__/g, ORIGIN);
    setTimeout(() => { vm.runInContext(code, ctx, { filename: 'relier.js' }); loaded = true; }, 0);
    return el;
  };
  vm.createContext(ctx);
  vm.runInContext(decodeURI(href.slice('javascript:'.length)), ctx, { filename: 'favori-relier.js' });
  const box = () => root.textContent.replace(/[  ]/g, ' ').replace(/Fermer$/, '');
  for (let i = 0; i < 400 && (!loaded || !box() || box().includes('Liaison en cours')); i++) await new Promise((r) => setTimeout(r, 10));
  if (ctx.__classeurLien !== undefined) fail('favori « Relier » : jeton laissé dans la page');
  return { box: box(), posts };
}

main().catch((e) => fail(e.stack || e.message));
