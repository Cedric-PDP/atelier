// Faux Supabase du jeu (Auth + PostgREST) pour les tests : remplace globalThis.fetch.
//   const supa = mockSupabase();   supa.addPlayer('uid-1', { username: 'Joueur' });   supa.sessionCookie({ uid: 'uid-1' })
// Auth : POST /auth/v1/token?grant_type=refresh_token (rotation : le jeton de renouvellement d'avant ne resert que dans les
// 10 s, et rend alors la même session ; au-delà, il ferme toute la session, comme Supabase) ; GET /auth/v1/user.
// PostgREST : GET /rest/v1/<table> (user_cards, profiles, cards, auctions, auction_bids), filtres eq. gte. gt. in. ilike.,
// order, limit (1 000 au plus), offset, Prefer: count=exact (en-tête content-range) ; RLS simulée. Le `select` est
// ignoré : les lignes sont rangées déjà embarquées (card, tags: [{tag}]). POST /rest/v1/rpc/get_my_profile : le profil du
// joueur, solde de wikibidous compris (addPlayer {wikibidous}). Toute écriture est refusée.
// Site du jeu (www.wiki-masters.com, cookie de session de ses pages) : GET /api/profile/<pseudo>/collection?q=…,
// GET /api/marketplace/<id de l'enchère> (l'enchère, son vendeur et son meneur, et ses mises : champ `bids` de l'enchère
// rangée, [{bidder_id, amount}] ; forme relevée par le projet de référence, pas vérifiée ici ; `siteLimit` : 429 |
// 'automation_limit') ; écritures : POST /api/trades (une proposition d'échange, relevée dans le HAR du 2026-10-22), et
// GET /api/marketplace/mine, POST /api/marketplace (mise en vente d'un exemplaire), DELETE /api/marketplace/<id>
// (annulation, refusée après une mise) relevées dans le HAR du 2026-10-23 ; `sellReply` force la réponse d'une mise en
// vente, `maxAuctions` le plafond d'enchères actives, `siteLimit` limite aussi ces routes. RLS de user_cards :
// ses propres exemplaires seulement, sauf `readOthers` (ceux de tout le monde, comme si le jeu les laissait lire).
// Amis : GET /api/friends ({friendships:[…]}, forme relevée dans le HAR du 2026-10-22, d'après `friendships`) et POST
// /api/friends {addressee_id} → 201 {friendship} (envoi d'une demande, relevé dans le HAR du 2026-10-24) ;
// `friendReply` force sa réponse, `siteLimit = 'friends'` limite ces deux routes.

import assert from 'node:assert/strict';

export const SUPABASE = 'https://cyrxjeppjqsxxjayfrur.supabase.co';
export const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5cnhqZXBwanFzeHhqYXlmcnVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4ODAzMzksImV4cCI6MjA4OTQ1NjMzOX0.BZluyXygNxuQGDPxFX1zG5i-cqp10CVK-8GGtuak4Rg';
export const AUTH_COOKIE = 'sb-cyrxjeppjqsxxjayfrur-auth-token';
export const GAME = 'https://www.wiki-masters.com';
const REUSE_MS = 10_000;

const b64url = (t) => Buffer.from(t, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// in.("a","b, c") de PostgREST -> ['a', 'b, c'] (guillemets et barres obliques inverses).
function pgList(v) {
  const out = [];
  let cur = '';
  let q = false;
  let esc = false;
  for (const ch of v.slice(4, -1)) {
    if (esc) { cur += ch; esc = false; } else if (q && ch === '\\') esc = true;
    else if (ch === '"') q = !q;
    else if (!q && ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

// Motif ilike de PostgREST → expression régulière : « * » devient « % » (comme PostgREST), puis LIKE : % = n'importe quoi,
// _ = un caractère, \x = x à la lettre.
function likeRe(pattern) {
  let re = '';
  const p = pattern.replace(/\*/g, '%');
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '\\' && i + 1 < p.length) re += p[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (ch === '%') re += '.*';
    else if (ch === '_') re += '.';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'is');
}

const reply = (body,status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

// Carte des tests (forme CarteImport : {id, title, rarity, atk, def, quality, pageviews, category, image, url, count, shiny,
// starred, obtained_at}) → ligne user_cards embarquée. tags : noms, ou objets {id, name, color}.
export function rowOf(c, { uid, eid, obtained_at, tags = [], snapshot_rarity = null } = {}) {
  return {
    id: eid ?? `ex-${c.id}`,
    card_id: c.id,
    user_id: uid,
    count: c.count ?? 1,
    starred: !!c.starred,
    is_shiny: !!c.shiny,
    obtained_at: obtained_at ?? c.obtained_at ?? '2026-01-01T00:00:00.000Z',
    snapshot_rarity,
    snapshot_atk: null,
    snapshot_def: null,
    card: {
      id: c.id, wikipedia_title: c.title, wikipedia_url: c.url ?? null, image_url: c.image ?? null, hide_image: false, rarity: c.rarity,
      atk: c.atk ?? null, def: c.def ?? null, q_score: c.quality ?? null, pageviews: c.pageviews ?? null, category: c.category ?? null, lang: 'fr',
    },
    tags: tags.map((t) => ({ tag: typeof t === 'string' ? { id: `t-${t}`, name: t, color: null } : t })),
  };
}

export function mockSupabase({ now = () => Date.now() } = {}) {
  const previous = globalThis.fetch;
  let minted = 0;
  const supa = {
    players: new Map(),
    cards: [],
    calls: [],
    fail: null, // (url, n) → {status, body} pour forcer une réponse
    limit: null, // 429 | 'automation_limit' : lectures limitées par le jeu
    noCount: false,
    after: null, // (n) → appelé après chaque lecture PostgREST
    readOthers: false, // RLS de user_cards : true = les exemplaires de tout le monde se lisent
    trades: [], // échanges créés par POST /api/trades
    tradeReply: null, // (body) → {status, body, setCookie?} pour forcer la réponse de POST /api/trades
    siteLimit: null, // 429 | 'automation_limit' : routes du marché du site limitées
    sellReply: null, // (body) → {status, body, network?} pour forcer la réponse de POST /api/marketplace
    maxAuctions: 5, // enchères actives par vendeur (maxConcurrentAuctions)
    friendships: [], // {id, requester_id, addressee_id, status} : GET /api/friends, POST /api/friends
    friendReply: null, // (body) → {status, body, network?} pour forcer la réponse de POST /api/friends
    reset() {
      this.players.clear();
      this.cards = [];
      this.calls = [];
      this.fail = null;
      this.limit = null;
      this.noCount = false;
      this.after = null;
      this.readOthers = false;
      this.trades = [];
      this.tradeReply = null;
      this.siteLimit = null;
      this.sellReply = null;
      this.maxAuctions = 5;
      this.friendships = [];
      this.friendReply = null;
    },
    befriend(a, b, status = 'accepted') {
      this.friendships.push({ id: `amitie-${this.friendships.length + 1}`, requester_id: a, addressee_id: b, status });
    },
    restore() {
      globalThis.fetch = previous;
    },
    mint(p, expiresIn = 3600) {
      minted++;
      p.access = `acces-${p.uid}-${minted}`;
      p.refresh = `renouv-${p.uid}-${minted}`;
      p.expires_at = Math.floor(now() / 1000) + expiresIn;
    },
    addPlayer(uid, { username = null, expiresIn = 3600, cards = [], wikibidous = 0 } = {}) {
      const p = { uid, username, cards, wikibidous, auctions: [], bids: [], prev: null, phantom: 0 };
      this.mint(p, expiresIn);
      this.players.set(uid, p);
      return p;
    },
    player(uid) {
      return this.players.get(uid) || this.addPlayer(uid);
    },
    // Cookie de session comme le pose la page du jeu (@supabase/ssr) : « base64- » + JSON en base64url, découpé en .0, .1…
    // au-delà de `chunk` caractères ; prefix = false : JSON encodé pour l'adresse. claim = user.id écrit dans le cookie
    // (le serveur ne doit jamais s'y fier).
    sessionCookie({ uid, chunk = 0, prefix = true, claim = uid } = {}) {
      const p = this.player(uid);
      const json = JSON.stringify({ access_token: p.access, token_type: 'bearer', expires_in: 3600, expires_at: p.expires_at, refresh_token: p.refresh,
        user: { id: claim, email: 'joueur@example.org', user_metadata: { name: 'Joueur é' } } });
      const value = prefix ? 'base64-' + b64url(json) : encodeURIComponent(json);
      if (!chunk) return `theme=sombre; ${AUTH_COOKIE}=${value}; autre=1`;
      const parts = [];
      for (let i = 0; i * chunk < value.length; i++) parts.push(`${AUTH_COOKIE}.${i}=${value.slice(i * chunk, (i + 1) * chunk)}`);
      return ['theme=sombre', ...parts].join('; ');
    },
    rest: () => supa.calls.filter((c) => c.path.startsWith('/rest/') && !c.path.startsWith('/rest/v1/rpc/')), // lectures de tables
    rpcs: () => supa.calls.filter((c) => c.path.startsWith('/rest/v1/rpc/')), // fonctions (solde de wikibidous)
    tokens: () => supa.calls.filter((c) => c.path === '/auth/v1/token'),
  };

  const byAccess = (h) => {
    const m = /^Bearer (.+)$/.exec(h.get('authorization') || '');
    if (!m) return null;
    for (const p of supa.players.values()) if (p.access && p.access === m[1] && p.expires_at * 1000 > now()) return p;
    return null;
  };

  async function handle(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    const h = new Headers(init.headers || {});
    const call = { method, url: String(url), path: u.pathname, headers: Object.fromEntries(h), body: init.body ?? null, at: Date.now() };
    supa.calls.push(call);
    assert.ok(!h.has('user-agent'), 'aucun User-Agent posé par le serveur');
    if (h.get('apikey') !== ANON) return reply({ message: 'Invalid API key' }, 401);
    const forced = supa.fail && supa.fail(String(url), supa.calls.length);
    if (forced) return forced.network ? Promise.reject(new TypeError('fetch failed')) : reply(forced.body ?? {}, forced.status);

    if (u.pathname === '/auth/v1/token') {
      assert.equal(method, 'POST');
      assert.equal(u.searchParams.get('grant_type'), 'refresh_token');
      const token = JSON.parse(init.body || '{}').refresh_token;
      for (const p of supa.players.values()) {
        if (p.refresh && p.refresh === token) {
          p.prev = { refresh: token, at: now() };
          supa.mint(p);
          return reply({ access_token: p.access, refresh_token: p.refresh, expires_at: p.expires_at, expires_in: 3600, token_type: 'bearer', user: { id: p.uid } });
        }
        if (p.prev && p.prev.refresh === token) {
          if (p.refresh && now() - p.prev.at < REUSE_MS) {
            return reply({ access_token: p.access, refresh_token: p.refresh, expires_at: p.expires_at, expires_in: 3600, token_type: 'bearer', user: { id: p.uid } });
          }
          p.access = null;
          p.refresh = null;
          return reply({ error: 'invalid_grant', error_description: 'Invalid Refresh Token: Already Used' }, 400);
        }
      }
      return reply({ error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found' }, 400);
    }
    if (method === 'POST' && u.pathname === '/rest/v1/rpc/get_my_profile') {
      if (supa.limit === 429) return reply({ message: 'Too Many Requests' }, 429);
      const p = byAccess(h);
      if (!p) return reply({ code: 'PGRST301', message: 'JWT expired' }, 401);
      return reply({ id: p.uid, username: p.username, is_pro: false, packs_remaining: 0, wikibidous_balance: p.wikibidous });
    }
    if (method !== 'GET') throw new Error('écriture dans la base du jeu : ' + method + ' ' + url);
    if (u.pathname === '/auth/v1/user') {
      const p = byAccess(h);
      return p ? reply({ id: p.uid, email: 'joueur@example.org' }) : reply({ code: 401, msg: 'invalid JWT' }, 401);
    }
    assert.ok(u.pathname.startsWith('/rest/v1/'), 'chemin inattendu : ' + url);
    if (supa.limit === 429) return reply({ message: 'Too Many Requests' }, 429);
    if (supa.limit === 'automation_limit') return reply({ code: 'automation_limit', message: 'automation limit' }, 403);
    const me = byAccess(h);
    if (!me) return reply({ code: 'PGRST301', message: 'JWT expired' }, 401);
    const table = u.pathname.slice('/rest/v1/'.length);
    const all = [...supa.players.values()];
    const source = {
      user_cards: () => (supa.readOthers ? all.flatMap((p) => p.cards) : me.cards),
      profiles: () => all.map((p) => ({ id: p.uid, username: p.username })),
      cards: () => supa.cards,
      auctions: () => all.flatMap((p) => p.auctions).filter((a) => a.status === 'active' || a.seller_id === me.uid || a.winner_id === me.uid
        || (a.status && a.status.startsWith('settled'))),
      auction_bids: () => me.bids,
    }[table];
    if (!source) throw new Error('table inattendue : ' + url);
    let rows = source().filter((r) => [...u.searchParams].every(([k, v]) => {
      if (['select', 'order', 'limit', 'offset'].includes(k)) return true;
      const x = r[k] === undefined || r[k] === null ? null : String(r[k]);
      if (v.startsWith('eq.')) return x === v.slice(3);
      if (v.startsWith('gte.')) return x !== null && x >= v.slice(4);
      if (v.startsWith('gt.')) return x !== null && x > v.slice(3);
      if (v.startsWith('in.')) return pgList(v).includes(x);
      if (v.startsWith('ilike.')) return x !== null && likeRe(v.slice(6)).test(x);
      throw new Error('filtre inattendu : ' + k + '=' + v);
    }));
    const order = (u.searchParams.get('order') || '').split(',').filter(Boolean).map((o) => o.split('.'));
    rows = rows.slice().sort((a, b) => {
      for (const [c, d] of order) if (a[c] !== b[c]) return (a[c] < b[c] ? -1 : 1) * (d === 'desc' ? -1 : 1);
      return 0;
    });
    const limit = Number(u.searchParams.get('limit') || 1000);
    assert.ok(limit <= 1000, 'limit ≤ 1 000');
    const off = Number(u.searchParams.get('offset') || 0);
    const page = rows.slice(off, off + limit);
    const headers = {};
    // phantom : exemplaires comptés par le jeu mais jamais rendus (lecture incomplète) ; noCount : pas de compte exact.
    const total = rows.length + (table === 'user_cards' ? me.phantom || 0 : 0);
    if (/count=exact/.test(h.get('prefer') || '') && !supa.noCount) headers['content-range'] = page.length ? `${off}-${off + page.length - 1}/${total}` : `*/${total}`;
    if (supa.after) await supa.after(supa.rest().length);
    return reply(page, 200, headers);
  }

  // Site du jeu : joueur d'après le jeton d'accès de son cookie de session (refait par le serveur du classeur).
  function byCookie(h) {
    const m = new RegExp(`(?:^|; )${AUTH_COOKIE}=base64-([^;]+)`).exec(h.get('cookie') || '');
    if (!m) return null;
    let auth;
    try { auth = JSON.parse(Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { return null; }
    for (const p of supa.players.values()) if (p.access && p.access === auth.access_token && p.expires_at * 1000 > now()) return p;
    return null;
  }
  async function site(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    const h = new Headers(init.headers || {});
    const call = { method, url: String(url), path: u.pathname, headers: Object.fromEntries(h), body: init.body ?? null, at: Date.now() };
    supa.calls.push(call);
    assert.ok(!h.has('user-agent'), 'aucun User-Agent posé par le serveur');
    const me = byCookie(h);
    if (!me) return reply({ error: 'Non authentifié' }, 401);
    let m;
    if (method === 'GET' && (m = /^\/api\/profile\/([^/]+)\/collection$/.exec(u.pathname))) {
      const name = decodeURIComponent(m[1]);
      const p = [...supa.players.values()].find((x) => x.username === name);
      if (!p) return reply({ error: 'Profil introuvable' }, 404);
      const q = (u.searchParams.get('q') || '').toLowerCase();
      const rows = p.cards.filter((r) => !q || String(r.card && r.card.wikipedia_title).toLowerCase().includes(q)).slice(0, 50);
      return reply({ collection: rows, total: rows.length, rarityCounts: {}, tagOptions: [], profileId: p.uid, pendingTradeCardIds: [] });
    }
    const market = u.pathname === '/api/marketplace' || u.pathname.startsWith('/api/marketplace/');
    if (market && supa.siteLimit === 429) return reply({ error: 'Too Many Requests' }, 429);
    if (market && supa.siteLimit === 'automation_limit') return reply({ code: 'automation_limit', error: 'automation limit' }, 403);
    const running = (p) => p.auctions.filter((a) => a.seller_id === p.uid && a.status === 'active' && Date.parse(a.end_at) > now());
    if (method === 'GET' && u.pathname === '/api/marketplace/mine') return reply({ sellingCount: running(me).length, maxConcurrentAuctions: supa.maxAuctions });
    if (method === 'POST' && u.pathname === '/api/marketplace') {
      assert.equal(h.get('origin'), GAME, 'Origin du jeu');
      const body = JSON.parse(init.body || '{}');
      if (supa.sellReply) {
        const f = supa.sellReply(body);
        if (f.network) throw new TypeError('fetch failed');
        return reply(f.body ?? {}, f.status);
      }
      const row = me.cards.find((r) => r.id === body.card_id);
      if (!row) return reply({ error: 'Carte introuvable' }, 404);
      if (!Number.isInteger(body.base_amount) || body.base_amount < 1) return reply({ error: 'Mise de départ invalide' }, 400);
      if (running(me).length >= supa.maxAuctions) return reply({ error: `Maximum ${supa.maxAuctions} enchères actives` }, 400);
      const created = new Date(now());
      const a = { id: `vente-${me.auctions.length + 1}`, seller_id: me.uid, card_id: row.card_id, user_card_id: row.id, base_amount: body.base_amount,
        duration_minutes: body.duration_minutes, current_bid: null, current_bidder_id: null, status: 'active', created_at: created.toISOString(),
        end_at: new Date(created.getTime() + body.duration_minutes * 60_000).toISOString(), snapshot_rarity: row.snapshot_rarity || row.card.rarity,
        is_shiny: !!row.is_shiny, bids: [] };
      me.auctions.push(a);
      return reply({ auction_id: a.id }, 201);
    }
    if (method === 'DELETE' && (m = /^\/api\/marketplace\/([^/]+)$/.exec(u.pathname))) {
      assert.equal(h.get('origin'), GAME, 'Origin du jeu');
      const a = me.auctions.find((x) => x.id === decodeURIComponent(m[1]));
      if (!a) return reply({ error: 'Enchère introuvable' }, 404);
      if (a.current_bidder_id || (a.bids || []).length) return reply({ error: "Impossible d'annuler : une enchère a déjà été placée" }, 400);
      a.status = 'cancelled';
      return reply({ status: 'cancelled' });
    }
    if (method === 'GET' && (m = /^\/api\/marketplace\/([^/]+)$/.exec(u.pathname))) {
      const id = decodeURIComponent(m[1]);
      const a = [...supa.players.values()].flatMap((p) => p.auctions).find((x) => x.id === id);
      if (!a) return reply({ error: 'Enchère introuvable' }, 404);
      const name = (uid) => (supa.players.get(uid) || {}).username || null;
      const { bids = [], card, ...auction } = a;
      return reply({ auction: { ...auction, seller: { username: name(a.seller_id) }, current_bidder: a.current_bidder_id ? { username: name(a.current_bidder_id) } : null },
        bids: bids.map((b) => ({ ...b, auction_id: id })) });
    }
    if (u.pathname === '/api/friends' && supa.siteLimit === 'friends') return reply({ code: 'automation_limit', error: 'automation limit' }, 403);
    if (method === 'GET' && u.pathname === '/api/friends') {
      const who = (uid) => ({ id: uid, username: (supa.players.get(uid) || {}).username || null, avatar_url: null });
      return reply({ friendships: supa.friendships.filter((f) => f.requester_id === me.uid || f.addressee_id === me.uid)
        .map((f) => ({ ...f, requester: who(f.requester_id), addressee: who(f.addressee_id), created_at: '2026-10-24T00:00:00Z' })) });
    }
    if (method === 'POST' && u.pathname === '/api/friends') {
      assert.equal(h.get('origin'), GAME, 'Origin du jeu');
      const body = JSON.parse(init.body || '{}');
      if (supa.friendReply) {
        const f = supa.friendReply(body);
        if (f.network) throw new TypeError('fetch failed');
        return reply(f.body ?? {}, f.status);
      }
      const to = supa.players.get(body.addressee_id);
      if (!to || to === me) return reply({ error: 'Joueur introuvable' }, 404);
      if (supa.friendships.some((f) => [f.requester_id, f.addressee_id].sort().join() === [me.uid, to.uid].sort().join() && f.status !== 'declined')) {
        return reply({ error: 'Demande déjà existante' }, 409);
      }
      supa.befriend(me.uid, to.uid, 'pending');
      return reply({ friendship: supa.friendships.at(-1) }, 201);
    }
    if (method === 'POST' && u.pathname === '/api/trades') {
      assert.equal(h.get('origin'), GAME, 'Origin du jeu');
      const body = JSON.parse(init.body || '{}');
      if (supa.tradeReply) {
        const f = supa.tradeReply(body);
        if (f.network) throw new TypeError('fetch failed');
        return reply(f.body ?? {}, f.status, f.setCookie ? { 'set-cookie': f.setCookie } : {});
      }
      const to = supa.players.get(body.recipient_id);
      if (!to || to === me) return reply({ error: 'Destinataire invalide' }, 400);
      for (const it of body.items || []) {
        const owner = it.offered_by === me.uid ? me : it.offered_by === to.uid ? to : null;
        if (!owner || !owner.cards.some((r) => r.id === it.user_card_id && r.card_id === it.card_id)) return reply({ error: 'Carte invalide' }, 400);
      }
      if ((body.initiator_wikibidous || 0) > me.wikibidous || (body.recipient_wikibidous || 0) > to.wikibidous) {
        return reply({ error: 'Solde de wikibidous insuffisant' }, 400);
      }
      const trade = { id: `echange-${supa.trades.length + 1}`, initiator_id: me.uid, recipient_id: to.uid, status: 'pending', items: body.items,
        initiator_wikibidous: body.initiator_wikibidous, recipient_wikibidous: body.recipient_wikibidous };
      supa.trades.push(trade);
      const { items, ...out } = trade;
      return reply({ trade: out }, 201);
    }
    throw new Error('route du jeu inattendue : ' + method + ' ' + url);
  }

  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(GAME + '/')) return site(url, init);
    if (!String(url).startsWith(SUPABASE + '/')) throw new Error('adresse inattendue : ' + url);
    return handle(url, init);
  };
  return supa;
}
