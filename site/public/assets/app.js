/* Le classeur : interface.
   Vue 3 (version d'exécution, sans compilateur) : tout est écrit en fonctions de rendu h(), pour que la CSP n'ait
   pas besoin de 'unsafe-eval'. Les styles ne passent que par des classes et des variables CSS posées via le CSSOM.
   Le contrat avec le serveur est dans SPEC.md. */
(function () {
  'use strict';

  // Lien personnel (#cle=…) : lu puis effacé de la barre d'adresse avant toute autre chose, même si Vue ne charge pas.
  // La clé n'est gardée qu'après vérification auprès du serveur (adoptLinkKey).
  function takeHashKey() {
    const m = String(location.hash || '').match(/(?:^#|&)cle=([^&]*)/);
    if (!m) return null;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
    let raw = m[1];
    try { raw = decodeURIComponent(raw); } catch (e) { /* gardé tel quel, la vérification dira s'il est bon */ }
    return raw.trim();
  }
  const LINK_KEY = takeHashKey();

  if (typeof Vue === 'undefined') {
    const box = document.getElementById('app');
    if (box) box.textContent = "Le classeur n'a pas pu se charger : la bibliothèque Vue (cdnjs.cloudflare.com) est inaccessible. Recharge la page, ou essaie un autre réseau.";
    return;
  }
  const { createApp, h, reactive, shallowRef, ref, computed, watch, nextTick, Transition, onMounted, onBeforeUnmount, markRaw } = Vue;

  // ================================================================ constantes et petits outils
  const RARITIES = ['L', 'UR', 'SR', 'R', 'PC', 'C'];
  const RARITY_NAME = { L: 'Légendaire', UR: 'Ultra rare', SR: 'Super rare', R: 'Rare', PC: 'Peu commune', C: 'Commune' };
  const RANK = Object.fromEntries(RARITIES.map((r, i) => [r, i]));
  // Rareté estimée d'une carte manquante, d'après les vues de l'article sur 30 jours.
  const PV_STEPS = [[50, 'C'], [250, 'PC'], [1000, 'R'], [5000, 'SR'], [20000, 'UR']];
  const SORTS = [['rarity', 'Rareté'], ['pageviews', 'Vues par mois'], ['obtained', 'Plus récentes'], ['atk', 'Attaque'], ['def', 'Défense'], ['title', 'Titre']];
  const PAGE = 120;
  const ALBUM_PAGE = 240;
  // Ordre d'affichage des légendes : de la plus commune à la plus rare, comme dans le jeu.
  const RAR_UP = ['C', 'PC', 'R', 'SR', 'UR', 'L'];
  const LS = { key: 'classeur-key', target: 'classeur-target', folded: 'classeur-tags-folded', pv: 'classeur-pv', sugg: 'classeur-sugg',
    importKey: 'classeur-import-key', known: 'classeur-known' };
  // Clé du classeur : 32 octets en base64url (43 caractères). Un lien plus court a été tronqué.
  const KEY_RE = /^[A-Za-z0-9_-]{43,128}$/;
  const DAY = 864e5;
  const WP_API = 'https://fr.wikipedia.org/w/api.php';
  const SPARQL = 'https://query.wikidata.org/sparql';
  const GROUPS = { vivant: 'Le vivant', sciences: 'Sciences', geo: 'Géographie', histoire: 'Histoire', sport: 'Sport' };
  // Natures Wikidata qui ne disent rien du sujet : être humain (remplacé par le métier), pages techniques.
  const SKIP_NATURES = new Set(['Q5', 'Q4167410', 'Q22808320', 'Q13406463', 'Q4167836', 'Q11266439']);
  const TAXON = 'Q16521';
  const FEMALE = 'Q6581072';
  const MALE = 'Q6581097';
  const FEMININE = /^(?:une |la )?[a-zà-ÿœ-]+(?:euse|rice|ienne|ète|ère|esse|ive|ante|ine|enne)(?![a-zà-ÿ])/;

  const NUM = new Intl.NumberFormat('fr-FR');
  const NUM2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
  const COMPACT = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
  const COLLATOR = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
  const fmt = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : NUM.format(n));
  const compact = (n) => (n == null ? '—' : COMPACT.format(n));
  const plural = (n, one, many) => (Math.abs(n) >= 2 ? many : one);
  const cards$ = (n) => `${fmt(n)} ${plural(n, 'carte', 'cartes')}`;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const chunks = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const cleanTag = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const normTitle = (t) => cap(String(t || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim());
  const wikiUrl = (title) => 'https://fr.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%3A/g, ':');
  const qid = (uri) => uri.slice(uri.lastIndexOf('/') + 1);
  const estRarity = (views) => {
    if (views == null) return null;
    for (const [limit, r] of PV_STEPS) if (views < limit) return r;
    return 'L';
  };
  const addTo = (tags, tag) => (tags.includes(tag) || tags.length >= 30 ? tags : [...tags, tag]);
  const dateOf = (iso) => { const d = new Date(iso); return iso && !Number.isNaN(d.getTime()) ? d : null; };
  const dateLong = (iso) => { const d = dateOf(iso); return d ? d.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) : '—'; };
  const dateShort = (iso) => { const d = dateOf(iso); return d ? d.toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : ''; };
  const dateDay = (iso) => { const d = dateOf(iso); return d ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : ''; };

  // localStorage peut être refusé (navigation privée, réglages) : tout passe par ces accès protégés.
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* rien à faire */ } },
    json(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  };

  // Cache par titre dans localStorage, avec une durée de vie ; écrit par paquets.
  function makeCache(name, ttl) {
    const map = new Map();
    const raw = store.json(name);
    const now = Date.now();
    if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (Array.isArray(v) && now - v[0] < ttl) map.set(k, v);
    let timer = null;
    const save = () => {
      timer = null;
      if (store.set(name, JSON.stringify(Object.fromEntries(map)))) return;
      // Plus de place : on oublie la plus vieille moitié.
      const old = [...map.entries()].sort((a, b) => a[1][0] - b[1][0]);
      old.slice(0, Math.ceil(old.length / 2)).forEach(([k]) => map.delete(k));
      store.set(name, JSON.stringify(Object.fromEntries(map)));
    };
    return {
      has: (k) => map.has(k),
      get: (k) => (map.has(k) ? map.get(k)[1] : undefined),
      set(k, v) { map.set(k, [Date.now(), v]); if (!timer) timer = setTimeout(save, 1500); },
      size: () => map.size,
      clear() { map.clear(); if (timer) { clearTimeout(timer); timer = null; } store.del(name); },
    };
  }
  const pvCache = makeCache(LS.pv, 7 * DAY); // titre -> [vues sur 30 jours | null, vignette | null]
  const suggCache = makeCache(LS.sugg, 30 * DAY); // titre -> {n: natures, m: métiers, p: pays}

  // ================================================================ état
  const S = reactive({
    boot: 'loading', // loading | welcome | app
    showEmptyProposed: false, // collections proposées à 0 : masquées par défaut (demande de l'utilisateur)
    key: (() => { const k = store.get(LS.key); return k && KEY_RE.test(k) ? k : null; })(),
    keyNotSaved: false,
    health: null,
    healthError: '',
    bootError: '',
    bootHint: '',
    welcome: { code: '', name: '', link: '', busy: false, error: '', linkError: '', created: null },
    linkError: '', // lien personnel refusé (tronqué, inconnu) : la clé gardée n'est pas touchée
    switchAsk: null, // {key, name, mine} : lien d'un autre classeur, à confirmer
    known: [], // classeurs ouverts dans ce navigateur : [{key, name}]
    newLink: '', // lien après « Changer ma clé »
    me: null,
    fetchedAt: null,
    loadingCards: false,
    tab: 'collections', // collections | cartes | maj | reglages
    album: null, // {kind: 'target' | 'catalog', id} : collection ouverte
    albumFilter: 'all',
    albumSort: 'order',
    albumLimit: ALBUM_PAGE,
    q: '',
    rarities: [], // vide = toutes
    sort: 'rarity',
    tagFilter: [],
    untaggedOnly: false,
    newOnly: false,
    limit: PAGE,
    selected: new Set(),
    lastClicked: null,
    bulkTag: '',
    bulkBusy: false,
    bulkError: '',
    openId: null,
    drawer: { newTag: '', busy: false, error: '' },
    tagSearch: '',
    tagsAll: false,
    refresh: { running: false, msg: '', error: false, warn: false },
    notice: null,
    modal: null, // editor | confirm | tag | switch | link
    session: { cookie: '', busy: false, error: '' },
    editor: null,
    catalog: { list: null, error: '', busy: {}, loading: false },
    confirm: null,
    tagEdit: null,
    settings: { name: '', busy: false, error: '', saved: false },
    copied: '',
    bm: { src: null, error: '', clicked: false, importKey: null, busy: false },
    pv: { version: 0, running: false, done: 0, total: 0, error: '' },
    sugg: { version: 0, running: false, done: 0, total: 0, error: '', cardBusy: '', cardError: '', cardErrorFor: '' },
  });
  // Les cartes et les collections peuvent être nombreuses : tableaux non profonds d'objets figés (markRaw).
  const cards = shallowRef([]);
  const targets = shallowRef([]);
  const newIds = shallowRef([]);

  // ================================================================ API du classeur
  class ApiError extends Error {
    constructor(status, message, data) { super(message); this.status = status; this.data = data || {}; }
  }

  // opts.key : appel avec une autre clé que celle gardée (vérifier un lien avant de l'adopter).
  async function api(method, path, body, opts) {
    const headers = { Accept: 'application/json' };
    const keyed = path !== '/api/account' && path !== '/api/health';
    const key = (opts && opts.key) || S.key;
    if (keyed && key) headers['X-Classeur-Key'] = key;
    const init = { method, headers, credentials: 'same-origin' };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    let r;
    try { r = await fetch(path, init); } catch (e) { throw new ApiError(0, 'Le classeur ne répond pas : vérifie ta connexion, puis réessaie.'); }
    let data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    if (!r.ok) {
      const msg = (data && typeof data.error === 'string' && data.error) || `Le classeur a répondu ${r.status}.`;
      // Clé inconnue (classeur supprimé, lien erroné) : retour à l'accueil. Une session WikiMasters expirée n'est pas concernée.
      if (r.status === 401 && keyed && !(opts && opts.key) && !(data && data.needs_session) && S.boot === 'app') lostKey(msg);
      throw new ApiError(r.status, msg, data);
    }
    return data || {};
  }

  // ================================================================ Wikipédia et Wikidata (depuis le navigateur)
  // Une requête à la fois par service, avec une petite pause ; 429 et 5xx : on attend (Retry-After s'il est lisible) et
  // on réessaie sans lâcher la file, pour que tout le reste attende aussi. Les tâches prioritaires passent devant.
  function makeQueue(gap) { return { gap, last: 0, busy: false, tasks: [] }; }
  const wikiQ = makeQueue(300);
  const dataQ = makeQueue(500);

  function enqueue(q, fn, prio) {
    return new Promise((resolve, reject) => {
      const task = { fn, prio: prio || 0, resolve, reject };
      let i = q.tasks.findIndex((t) => t.prio < task.prio);
      if (i < 0) i = q.tasks.length;
      q.tasks.splice(i, 0, task);
      pump(q);
    });
  }
  async function pump(q) {
    if (q.busy) return;
    q.busy = true;
    try {
      while (q.tasks.length) {
        const wait = q.last + q.gap - Date.now();
        if (wait > 0) await sleep(wait);
        const task = q.tasks.shift();
        try { task.resolve(await task.fn()); } catch (e) { task.reject(e); }
        q.last = Date.now();
      }
    } finally { q.busy = false; }
  }
  function getJson(q, url, prio, accept) {
    const who = url.startsWith(SPARQL) ? 'Wikidata' : 'Wikipédia';
    return enqueue(q, async () => {
      let delay = 2000;
      for (let attempt = 0; attempt < 7; attempt++) {
        let r = null;
        try { r = await fetch(url, { headers: { Accept: accept || 'application/json' }, credentials: 'omit' }); } catch (e) { r = null; }
        if (r && r.ok) return r.json();
        if (r && r.status !== 429 && r.status < 500) throw new Error(`${who} a répondu ${r.status}.`);
        const retry = r ? Number(r.headers.get('retry-after')) : NaN;
        await sleep(retry > 0 ? Math.min(retry, 120) * 1000 + 250 : delay);
        delay = Math.min(delay * 2, 30000);
      }
      throw new Error(`${who} ne répond pas pour l'instant : réessaie dans quelques minutes.`);
    }, prio);
  }
  const wpUrl = (params) => WP_API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
  const sparql = (query, prio) => getJson(dataQ, SPARQL + '?format=json&query=' + encodeURIComponent(query), prio, 'application/sparql-results+json')
    .then((j) => (j && j.results && j.results.bindings) || []);
  // Titres renommés par l'API (normalisation, redirections) : from -> to.
  const aliasOf = (q) => {
    const a = {};
    for (const n of q.normalized || []) a[n.from] = n.to;
    for (const r of q.redirects || []) a[r.from] = r.to;
    return a;
  };
  const resolve = (alias, t) => { let cur = t; for (let i = 0; i < 5 && alias[cur]; i++) cur = alias[cur]; return cur; };

  // Vérifie des titres (50 par requête) : existence, redirection, homonymie, description courte, vignette.
  async function verifyTitles(titles, onProgress, alive) {
    const out = new Map();
    let done = 0;
    for (const batch of chunks(titles, 50)) {
      if (!alive()) return out;
      const pages = new Map();
      const alias = {};
      let cont = {};
      for (let guard = 0; guard < 20; guard++) {
        const j = await getJson(wikiQ, wpUrl({ action: 'query', redirects: '1', prop: 'pageprops|description|pageimages', ppprop: 'disambiguation',
          piprop: 'thumbnail', pithumbsize: '330', pilimit: '50', titles: batch.join('|'), ...cont }), 2);
        const q = (j && j.query) || {};
        Object.assign(alias, aliasOf(q));
        for (const p of q.pages || []) pages.set(p.title, Object.assign(pages.get(p.title) || {}, p));
        if (!j.continue) break;
        cont = j.continue;
      }
      for (const t of batch) {
        const p = pages.get(resolve(alias, t));
        if (!p || p.missing || p.invalid) out.set(t, { title: t, description: null, image: null, status: 'missing' });
        else out.set(t, {
          title: p.title,
          description: p.description || null,
          image: (p.thumbnail && p.thumbnail.source) || null,
          status: p.pageprops && 'disambiguation' in p.pageprops ? 'disambiguation' : 'ok',
        });
      }
      done += batch.length;
      onProgress(done);
    }
    return out;
  }

  // Vues sur 30 jours (et vignette) des articles qui manquent dans la collection ouverte.
  let pvToken = 0;
  async function loadPageviews(titles, token) {
    for (const batch of chunks(titles, 50)) {
      if (token !== pvToken) return;
      const views = new Map();
      const thumbs = new Map();
      const alias = {};
      let cont = {};
      for (let guard = 0; guard < 40; guard++) {
        const j = await getJson(wikiQ, wpUrl({ action: 'query', redirects: '1', prop: 'pageviews|pageimages', pvipdays: '30',
          piprop: 'thumbnail', pithumbsize: '330', pilimit: '50', titles: batch.join('|'), ...cont }), 0);
        const q = (j && j.query) || {};
        Object.assign(alias, aliasOf(q));
        for (const p of q.pages || []) {
          if (p.pageviews) views.set(p.title, (views.get(p.title) || 0) + Object.values(p.pageviews).reduce((s, x) => s + (x || 0), 0));
          if (p.thumbnail && p.thumbnail.source) thumbs.set(p.title, p.thumbnail.source);
        }
        // L'API rend les vues d'un lot en plusieurs morceaux : on suit la continuation jusqu'au bout.
        if (!j.continue || token !== pvToken) break;
        cont = j.continue;
      }
      if (token !== pvToken) return;
      for (const t of batch) {
        const f = resolve(alias, t);
        pvCache.set(t, [views.has(f) ? views.get(f) : null, thumbs.get(f) || null]);
      }
      S.pv.done += batch.length;
      S.pv.version++;
    }
  }
  function startPageviews() {
    const token = ++pvToken;
    S.pv.running = false;
    S.pv.error = '';
    const st = activeAlbum.value;
    if (!st || S.boot !== 'app') return;
    const owned = byTitle.value;
    const titles = st.items.filter((it) => it.status === 'ok' && !owned.has(normTitle(it.title)) && !pvCache.has(it.title)).map((it) => it.title);
    if (!titles.length) return;
    Object.assign(S.pv, { running: true, done: 0, total: titles.length });
    loadPageviews(titles, token)
      .catch((e) => { if (token === pvToken) S.pv.error = e.message; })
      .finally(() => { if (token === pvToken) S.pv.running = false; });
  }

  // ---------------------------------------------------------------- suggestions de tags (Wikidata)
  // Groupe lisible d'un taxon d'après la description de la carte : « espèce d'insectes » -> « insectes ».
  function taxonGroup(desc) {
    const m = String(desc || '').match(/^(?:espèce|genre|famille|sous-espèce|ordre|variété) d(?:e |'|’|es |u )(.+)$/i);
    if (!m) return null;
    const g = m[1].split(/,| (?:de|du|des|d'|d’|endémique|originaire|présente?|vivant|décrite?)\b/)[0].trim();
    return g || null;
  }
  function tidy(list, max) {
    const out = [];
    const seen = new Set();
    for (const x of list) {
      const t = cap(String(x || '').replace(/\s+/g, ' ').trim());
      if (!t || t.length > 40 || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      out.push(t);
    }
    return out.slice(0, max);
  }
  // Les libellés français des métiers sont épicènes (« chanteur ou chanteuse ») : on prend la forme féminine (P2521) ou
  // masculine (P3321) d'après le genre de la personne (P21), ou à défaut d'après sa description (« chanteuse barbadienne »).
  function buildSuggestion(card, it, labels, forms, sup) {
    const desc = String((card && card.category) || '').trim();
    const human = it.P31.includes('Q5');
    const female = it.P21.includes(FEMALE) || (human && !it.P21.length && FEMININE.test(desc.toLowerCase()));
    const male = !female && it.P21.includes(MALE);
    const natures = it.P31.filter((c) => !SKIP_NATURES.has(c) && !sup.has(c)).map((c) => (c === TAXON ? taxonGroup(desc) : labels[c]));
    const jobs = it.P106.map((m) => (female && forms.f[m]) || (male && forms.m[m]) || labels[m]);
    const lands = [...it.P27, ...it.P17].map((c) => labels[c]);
    return { n: tidy(natures, 2), m: tidy(jobs, 3), p: tidy(lands, 2) };
  }
  // Calcule (et garde) les suggestions des titres donnés : titre -> élément (50 par requête), puis SPARQL par lots de 150.
  async function ensureSuggestions(titles, prio, onProgress, cancelled) {
    const stop = cancelled || (() => false);
    const cardOf = new Map();
    for (const c of cards.value) if (!cardOf.has(c.title)) cardOf.set(c.title, c);
    let done = 0;
    for (const batch of chunks(titles, 150)) {
      if (stop()) return;
      const qidOf = new Map();
      for (const part of chunks(batch, 50)) {
        const j = await getJson(wikiQ, wpUrl({ action: 'query', redirects: '1', prop: 'pageprops', ppprop: 'wikibase_item', titles: part.join('|') }), prio);
        const q = (j && j.query) || {};
        const alias = aliasOf(q);
        const item = new Map((q.pages || []).map((p) => [p.title, (p.pageprops && p.pageprops.wikibase_item) || null]));
        for (const t of part) qidOf.set(t, item.get(resolve(alias, t)) || null);
        if (stop()) return;
      }
      const ids = [...new Set([...qidOf.values()].filter(Boolean))];
      const items = new Map();
      const labels = {};
      const forms = { f: {}, m: {} };
      const sup = new Map();
      if (ids.length) {
        const vals = ids.map((id) => 'wd:' + id).join(' ');
        const rows = await sparql(`SELECT ?item ?p ?v ?l ?f ?m WHERE { VALUES ?item { ${vals} } VALUES ?p { wdt:P31 wdt:P106 wdt:P27 wdt:P17 wdt:P21 }
          ?item ?p ?v . OPTIONAL { ?v rdfs:label ?l . FILTER(LANG(?l) = "fr") }
          OPTIONAL { ?v wdt:P2521 ?f . FILTER(LANG(?f) = "fr") } OPTIONAL { ?v wdt:P3321 ?m . FILTER(LANG(?m) = "fr") } }`, prio);
        for (const r of rows) {
          if (!r.item || !r.p || !r.v || r.v.type !== 'uri') continue;
          const id = qid(r.item.value);
          const p = qid(r.p.value);
          const v = qid(r.v.value);
          if (!items.has(id)) items.set(id, { P31: [], P106: [], P27: [], P17: [], P21: [] });
          const it = items.get(id);
          if (it[p] && !it[p].includes(v)) it[p].push(v);
          if (r.l) labels[v] = r.l.value;
          if (r.f) forms.f[v] = r.f.value;
          if (r.m) forms.m[v] = r.m.value;
        }
        // Natures qui sont des superclasses d'une autre nature de la même carte : on garde la plus précise.
        const multi = ids.filter((id) => items.has(id) && items.get(id).P31.length >= 2);
        if (multi.length) {
          try {
            const rows2 = await sparql(`SELECT DISTINCT ?item ?b WHERE { VALUES ?item { ${multi.map((id) => 'wd:' + id).join(' ')} }
              ?item wdt:P31 ?a , ?b . FILTER(?a != ?b) ?a wdt:P279+ ?b . }`, prio);
            for (const r of rows2) {
              const id = qid(r.item.value);
              if (!sup.has(id)) sup.set(id, new Set());
              sup.get(id).add(qid(r.b.value));
            }
          } catch (e) { /* sans cette information, on garde toutes les natures */ }
        }
      }
      if (stop()) return;
      for (const t of batch) {
        const id = qidOf.get(t);
        const it = id && items.get(id);
        suggCache.set(t, it ? buildSuggestion(cardOf.get(t), it, labels, forms, sup.get(id) || new Set()) : { n: [], m: [], p: [] });
      }
      done += batch.length;
      S.sugg.version++;
      if (onProgress) onProgress(done);
    }
  }
  // Suggestions d'une carte qui ne sont pas déjà dans ses tags ; null = pas encore calculées.
  function suggestionsFor(card) {
    void S.sugg.version;
    const s = suggCache.get(card.title);
    if (!s) return null;
    const own = new Set(card.tags.map((t) => t.toLowerCase()));
    const out = [];
    for (const t of [...(s.n || []), ...(s.m || []), ...(s.p || [])]) if (!own.has(t.toLowerCase()) && !out.includes(t)) out.push(t);
    return out;
  }
  let suggToken = 0;
  async function computeAllSuggestions() {
    if (S.sugg.running) return;
    const titles = [...new Set(cards.value.map((c) => c.title))].filter((t) => !suggCache.has(t));
    if (!titles.length) return;
    const token = ++suggToken;
    Object.assign(S.sugg, { running: true, done: 0, total: titles.length, error: '' });
    try {
      await ensureSuggestions(titles, 0, (n) => { if (token === suggToken) S.sugg.done = n; }, () => token !== suggToken);
    } catch (e) {
      if (token === suggToken) S.sugg.error = e.message;
    } finally {
      if (token === suggToken) S.sugg.running = false;
    }
  }
  function stopSuggestions() { suggToken++; S.sugg.running = false; }
  async function loadCardSuggestions(card) {
    if (S.sugg.cardBusy === card.title) return;
    S.sugg.cardBusy = card.title;
    S.sugg.cardError = '';
    try {
      await ensureSuggestions([card.title], 2);
    } catch (e) {
      S.sugg.cardError = e.message;
      S.sugg.cardErrorFor = card.title;
    } finally {
      if (S.sugg.cardBusy === card.title) S.sugg.cardBusy = '';
    }
  }

  // ================================================================ données dérivées
  const cardById = computed(() => new Map(cards.value.map((c) => [c.id, c])));
  const byTitle = computed(() => {
    const m = new Map();
    for (const c of cards.value) {
      const k = normTitle(c.title);
      if (m.has(k)) m.get(k).push(c); else m.set(k, [c]);
    }
    return m;
  });
  const newIdSet = computed(() => new Set(newIds.value));
  const rarityCount = computed(() => {
    const n = {};
    for (const c of cards.value) n[c.rarity] = (n[c.rarity] || 0) + 1;
    return n;
  });
  const copies = computed(() => cards.value.reduce((n, c) => n + (Number(c.count) || 1), 0));
  const tagList = computed(() => {
    const counts = new Map();
    for (const c of cards.value) for (const t of c.tags) counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || COLLATOR.compare(a.name, b.name));
  });
  const tagCount = computed(() => new Map(tagList.value.map((t) => [t.name, t.count])));
  const untaggedCount = computed(() => cards.value.reduce((n, c) => n + (c.tags.length ? 0 : 1), 0));
  const hasFilters = computed(() => !!(S.tagFilter.length || S.untaggedOnly || S.newOnly || S.q.trim() || S.rarities.length));
  const SORTERS = {
    rarity: (a, b) => (RANK[a.rarity] ?? 9) - (RANK[b.rarity] ?? 9) || (b.pageviews ?? -1) - (a.pageviews ?? -1),
    pageviews: (a, b) => (b.pageviews ?? -1) - (a.pageviews ?? -1),
    obtained: (a, b) => String(b.obtained_at || '').localeCompare(String(a.obtained_at || '')),
    atk: (a, b) => (b.atk ?? -1) - (a.atk ?? -1),
    def: (a, b) => (b.def ?? -1) - (a.def ?? -1),
    title: (a, b) => COLLATOR.compare(a.title, b.title),
  };
  // « Mes cartes » : recherche (titre, description, tags), raretés, tags (combinés), sans tag, nouvelles.
  const filtered = computed(() => {
    const q = fold(S.q.trim());
    const rar = new Set(S.rarities.length ? S.rarities : RARITIES);
    const tags = S.tagFilter;
    const fresh = newIdSet.value;
    const out = cards.value.filter((c) => rar.has(c.rarity)
      && (!q || c._k.includes(q) || c.tags.some((t) => fold(t).includes(q)))
      && (!S.untaggedOnly || !c.tags.length)
      && (!S.newOnly || fresh.has(c.id))
      && tags.every((t) => c.tags.includes(t)));
    return out.sort(SORTERS[S.sort] || SORTERS.rarity);
  });
  const visibleCards = computed(() => filtered.value.slice(0, S.limit));

  // Collections : les tiennes (targets) et celles du catalogue que tu n'as pas encore ajoutées.
  const catalogById = computed(() => new Map((S.catalog.list || []).map((e) => [e.id, e])));
  const collections = computed(() => {
    const cat = catalogById.value;
    const mine = targets.value.map((t) => {
      const src = typeof t.source === 'string' && t.source.startsWith('catalog:') ? cat.get(t.source.slice(8)) : null;
      return { kind: 'target', id: t.id, key: 'target:' + t.id, name: t.name, items: t.items, ordered: src ? !!src.ordered : true, t };
    });
    const added = new Set(targets.value.map((t) => t.source).filter(Boolean));
    const proposed = (S.catalog.list || []).filter((e) => !added.has('catalog:' + e.id)).map((e) => ({
      kind: 'catalog', id: e.id, key: 'catalog:' + e.id, name: e.name, group: e.group, groupName: e.group_name || GROUPS[e.group] || cap(e.group || 'autres'),
      items: e.items.map((i) => ({ title: String(i.title), description: i.description || null, image: null, status: 'ok' })), ordered: !!e.ordered, e,
    }));
    return { mine, proposed };
  });
  // Progression d'une collection : possédées, répartition par rareté, trois cartes pour l'éventail.
  const progress = computed(() => {
    const owned = byTitle.value;
    const out = new Map();
    for (const col of [...collections.value.mine, ...collections.value.proposed]) {
      let own = 0;
      const byR = {};
      const sample = [];
      for (const it of col.items) {
        const list = owned.get(normTitle(it.title));
        if (!list) continue;
        own++;
        const c = list[0];
        byR[c.rarity] = (byR[c.rarity] || 0) + 1;
        sample.push(c);
      }
      sample.sort((a, b) => (RANK[a.rarity] ?? 9) - (RANK[b.rarity] ?? 9) || (b.image ? 1 : 0) - (a.image ? 1 : 0));
      out.set(col.key, { own, total: col.items.length, byR, sample: sample.slice(0, 3) });
    }
    return out;
  });
  const progressOf = (col) => progress.value.get(col.key) || { own: 0, total: col.items.length, byR: {}, sample: [] };
  const activeAlbum = computed(() => {
    const a = S.album;
    if (!a) return null;
    const list = a.kind === 'target' ? collections.value.mine : collections.value.proposed;
    return list.find((c) => c.id === a.id) || null;
  });
  // Album : cartes possédées et cases vides dans l'ordre de la collection, filtrées et triées.
  const albumSlots = computed(() => {
    const col = activeAlbum.value;
    if (!col) return [];
    void S.pv.version;
    const owned = byTitle.value;
    let slots = col.items.map((item, i) => {
      const list = owned.get(normTitle(item.title));
      const card = list ? list[0] : null;
      const info = card ? null : pvCache.get(item.title);
      const views = info ? info[0] : null;
      return { i: i + 1, key: card ? card.id + ':' + i : 'vide:' + i + ':' + item.title, item, card, views, est: card || item.status !== 'ok' ? null : estRarity(views), thumb: info ? info[1] : null };
    });
    if (S.albumFilter === 'owned') slots = slots.filter((s) => s.card);
    if (S.albumFilter === 'missing') slots = slots.filter((s) => !s.card);
    if (S.albumSort === 'rarity') {
      const rank = (s) => RANK[s.card ? s.card.rarity : s.est] ?? 9;
      const views = (s) => (s.card ? s.card.pageviews : s.views) || 0;
      slots = slots.slice().sort((a, b) => rank(a) - rank(b) || views(b) - views(a));
    } else if (!col.ordered) slots = slots.slice().sort((a, b) => COLLATOR.compare(a.item.title, b.item.title));
    return slots;
  });
  const visibleSlots = computed(() => albumSlots.value.slice(0, S.albumLimit));
  // Cartes qu'on peut sélectionner dans la vue ouverte (Maj+clic pour une plage).
  const selectableIds = computed(() => (S.tab === 'collections' && activeAlbum.value
    ? albumSlots.value.filter((s) => s.card).map((s) => s.card.id)
    : filtered.value.map((c) => c.id)));
  const openCard = computed(() => (S.openId ? cardById.value.get(S.openId) || null : null));
  const pendingInView = computed(() => {
    void S.sugg.version;
    if (!suggCache.size()) return [];
    const out = [];
    for (const c of filtered.value) { const s = suggestionsFor(c); if (s && s.length) out.push([c, s]); }
    return out;
  });
  const unsuggested = computed(() => {
    void S.sugg.version;
    let n = 0;
    const seen = new Set();
    for (const c of cards.value) if (!seen.has(c.title)) { seen.add(c.title); if (!suggCache.has(c.title)) n++; }
    return n;
  });
  // Collections qui contiennent une carte (pour la fiche).
  function membershipsOf(card) {
    const k = normTitle(card.title);
    const all = [...collections.value.mine, ...collections.value.proposed];
    return all.filter((col) => col.items.some((it) => normTitle(it.title) === k));
  }
  const personalLink = computed(() => (S.key ? location.origin + '/#cle=' + S.key : ''));
  // Le favori n'embarque que la clé d'import (elle ne permet que d'envoyer des cartes), jamais la clé principale.
  const bookmarkletUrl = computed(() => (S.bm.src && S.bm.importKey ? makeBookmarklet(S.bm.src, location.origin, S.bm.importKey) : ''));

  // ================================================================ actions
  let noticeSeq = 0;
  function notify(text, error) {
    const id = ++noticeSeq;
    S.notice = { id, text, error: !!error };
    setTimeout(() => { if (S.notice && S.notice.id === id) S.notice = null; }, error ? 12000 : 6000);
  }

  // ---------------------------------------------------------------- clés : la sienne, les classeurs connus, la clé d'import
  function setKey(k) {
    S.key = k;
    S.keyNotSaved = !store.set(LS.key, k);
  }
  function loadKnown() {
    const list = store.json(LS.known);
    S.known = Array.isArray(list) ? list.filter((x) => x && typeof x.key === 'string' && KEY_RE.test(x.key)).map((x) => ({ key: x.key, name: String(x.name || '') })) : [];
  }
  function saveKnown() { store.set(LS.known, JSON.stringify(S.known)); }
  function remember(key, name) {
    const i = S.known.findIndex((x) => x.key === key);
    if (i >= 0) S.known[i].name = name || S.known[i].name; else S.known.push({ key, name: name || '' });
    saveKnown();
  }
  function forgetKnown(key) { S.known = S.known.filter((x) => x.key !== key); saveKnown(); }
  // Clé d'import gardée pour un compte donné : {user, key}. Celle d'un autre classeur ne compte pas.
  function storedImportKey() {
    const v = store.json(LS.importKey);
    const me = S.me && S.me.user;
    return v && me && v.user === me.id && typeof v.key === 'string' && v.key ? v.key : null;
  }

  function resetData() {
    cards.value = [];
    targets.value = [];
    newIds.value = [];
    Object.assign(S, { me: null, fetchedAt: null, openId: null, modal: null, editor: null, confirm: null, tagEdit: null, notice: null, switchAsk: null, tab: 'collections', album: null,
      q: '', tagFilter: [], untaggedOnly: false, newOnly: false, rarities: [], limit: PAGE, lastClicked: null, bulkTag: '', bulkError: '' });
    S.selected.clear();
    S.refresh.msg = '';
    S.refresh.error = false;
    S.refresh.warn = false;
    S.bm.importKey = null;
    pvToken++;
    suggToken++;
    S.sugg.running = false;
  }
  const STALE_KEY = "La clé gardée dans ce navigateur ne correspond plus à aucun classeur : il a peut-être été supprimé, ou sa clé a été changée sur un autre appareil. Ouvre ton lien personnel le plus récent.";
  function lostKey(msg) {
    resetData();
    S.bootError = msg;
    S.bootHint = STALE_KEY;
    S.boot = 'welcome';
  }
  // « Oublier ce navigateur » : la clé, les classeurs connus, la clé d'import et les caches de Wikipédia.
  function forgetKey() {
    for (const k of Object.values(LS)) store.del(k);
    pvCache.clear();
    suggCache.clear();
    S.key = null;
    S.known = [];
    resetData();
    S.bootError = '';
    S.bootHint = '';
    S.linkError = '';
    S.welcome.created = null;
    S.boot = 'welcome';
  }

  // Clé gardée qui n'ouvre plus rien (accueil) : on l'oublie, sans toucher aux autres classeurs connus.
  function dropStaleKey() {
    if (S.key) forgetKnown(S.key);
    store.del(LS.key);
    S.key = null;
    S.bootError = '';
    S.bootHint = '';
  }

  async function loadHealth() {
    S.healthError = '';
    try {
      S.health = await api('GET', '/api/health');
    } catch (e) {
      S.health = null;
      S.healthError = e.message;
    }
  }
  async function loadMe() {
    const me = await api('GET', '/api/me');
    S.me = me;
    if (S.key && me.user) remember(S.key, me.user.name || '');
    return me;
  }
  function prepCard(c) {
    const tags = Array.isArray(c.tags) ? c.tags.map(String) : [];
    return markRaw({ ...c, title: String(c.title || ''), tags, _k: fold(`${c.title || ''} ${c.category || ''}`) });
  }
  async function loadCards() {
    // Lecture par morceaux (?part=0, puis next_part renvoyé tel quel jusqu'à null) : une grosse collection d'un coup
    // dépasserait le temps de calcul d'un Worker gratuit. next_part peut être un nombre ou une chaîne opaque.
    const all = [];
    let r = null;
    let part = 0;
    for (let guard = 0; guard < 500; guard++) {
      r = await api('GET', '/api/cards?part=' + encodeURIComponent(String(part)));
      if (Array.isArray(r.cards)) all.push(...r.cards);
      const next = r.next_part;
      if (next === null || next === undefined || next === '' || next === part) break;
      part = next;
    }
    cards.value = all.map(prepCard);
    newIds.value = Array.isArray(r.new_ids) ? r.new_ids : [];
    S.fetchedAt = r.fetched_at || null;
    if (S.openId && !cardById.value.has(S.openId)) S.openId = null;
    for (const id of [...S.selected]) if (!cardById.value.has(id)) S.selected.delete(id);
  }
  async function loadCatalog() {
    if (S.catalog.list || S.catalog.loading) return;
    S.catalog.loading = true;
    S.catalog.error = '';
    try {
      const r = await fetch('/catalog.json', { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`Le catalogue n'a pas pu être chargé (${r.status}).`);
      const list = await r.json();
      S.catalog.list = markRaw(Array.isArray(list) ? list.filter((x) => x && x.id && Array.isArray(x.items)) : []);
    } catch (e) {
      S.catalog.error = e instanceof SyntaxError ? 'Le catalogue est illisible.' : e.message || "Le catalogue n'a pas pu être chargé.";
    } finally {
      S.catalog.loading = false;
    }
  }
  const prepTarget = (t) => markRaw({ ...t, items: Array.isArray(t.items) ? t.items : [] });
  async function loadTargets() {
    const r = await api('GET', '/api/targets');
    targets.value = (Array.isArray(r.targets) ? r.targets : []).map(prepTarget);
    if (S.album && S.album.kind === 'target' && !targets.value.some((t) => t.id === S.album.id)) S.album = null;
  }
  function upsertTarget(t) {
    const next = prepTarget(t);
    const list = targets.value.slice();
    const i = list.findIndex((x) => x.id === next.id);
    if (i >= 0) list[i] = next; else list.push(next);
    targets.value = list;
  }

  const BAD_LINK = "Ce lien personnel est incomplet ou abîmé : après « #cle= », il doit avoir une suite de 43 lettres, chiffres, « - » ou « _ ». Copie-le à nouveau, en entier.";
  const UNKNOWN_LINK = "Ce lien ne correspond à aucun classeur : il est peut-être incomplet, sa clé a été changée, ou le classeur a été supprimé.";
  // Lien personnel ouvert : la clé n'est gardée qu'une fois vérifiée (GET /api/me). Si une autre clé valable est déjà
  // gardée, on demande avant de changer de classeur ; l'ancienne reste dans la liste des classeurs connus.
  async function adoptLinkKey(raw) {
    S.linkError = '';
    if (!raw || !KEY_RE.test(raw)) { S.linkError = BAD_LINK; return; }
    if (raw === S.key) return;
    let me;
    try {
      me = await api('GET', '/api/me', undefined, { key: raw });
    } catch (e) {
      S.linkError = e.status === 401 ? UNKNOWN_LINK : e.message;
      return;
    }
    const name = (me.user && me.user.name) || '';
    if (S.key) {
      let mine = null;
      try {
        mine = await api('GET', '/api/me', undefined, { key: S.key });
      } catch (e) {
        if (e.status !== 401) mine = { user: null };
      }
      if (mine) {
        S.switchAsk = { key: raw, name, mine: (mine.user && mine.user.name) || '' };
        return;
      }
      forgetKnown(S.key); // la clé gardée n'ouvre plus rien : on prend la nouvelle sans demander
    }
    setKey(raw);
    remember(raw, name);
  }
  async function switchTo(key) {
    if (key === S.key) { closeModal(); return; }
    try {
      await api('GET', '/api/me', undefined, { key });
    } catch (e) {
      if (e.status === 401) { forgetKnown(key); notify(UNKNOWN_LINK, true); } else notify(e.message, true);
      return;
    }
    setKey(key);
    S.album = null;
    await boot();
  }

  async function boot(linkKey) {
    S.boot = 'loading';
    resetData();
    loadKnown();
    await loadHealth();
    if (linkKey != null) await adoptLinkKey(linkKey);
    const ask = S.switchAsk;
    if (!S.key) { S.boot = 'welcome'; return; }
    try {
      await loadMe();
    } catch (e) {
      S.bootError = e.message;
      S.bootHint = e.status === 401 ? STALE_KEY : '';
      S.boot = 'welcome';
      return;
    }
    S.bootError = '';
    S.bootHint = '';
    S.boot = 'app';
    if (S.linkError) { notify(S.linkError, true); S.linkError = ''; }
    if (ask) { S.switchAsk = ask; S.modal = 'switch'; }
    S.loadingCards = true;
    await Promise.all([
      loadCards().catch((e) => notify(e.message, true)),
      loadTargets().catch((e) => notify(e.message, true)),
      loadCatalog(),
    ]);
    S.loadingCards = false;
    // Classeur vide : on commence par « Mettre à jour » (le favori).
    if (!cards.value.length && S.tab === 'collections' && !S.album) openFavori();
    startPageviews();
  }

  async function createAccount() {
    const w = S.welcome;
    if (w.busy) return;
    const code = w.code.trim();
    if (!code) { w.error = "Saisis le code d'invitation."; return; }
    w.busy = true;
    w.error = '';
    try {
      const body = { code };
      if (w.name.trim()) body.name = w.name.trim();
      const r = await api('POST', '/api/account', body);
      if (!r.key || !KEY_RE.test(r.key)) throw new Error("Le classeur n'a pas renvoyé de clé valable : réessaie.");
      setKey(r.key);
      remember(r.key, (r.user && r.user.name) || '');
      w.created = { link: location.origin + '/#cle=' + r.key, name: (r.user && r.user.name) || '' };
      w.code = '';
    } catch (e) {
      w.error = e.message;
    } finally {
      w.busy = false;
    }
  }
  function useLink() {
    const w = S.welcome;
    const raw = w.link.trim();
    const m = raw.match(/[#&?]cle=([^&\s]*)/);
    let key = m ? m[1] : raw;
    try { key = decodeURIComponent(key); } catch (e) { /* tel quel */ }
    if (!KEY_RE.test(key)) { w.linkError = BAD_LINK; return; }
    w.linkError = '';
    w.link = '';
    boot(key);
  }

  // ---------------------------------------------------------------- rafraîchissement
  function importSummary(res) {
    const n = Array.isArray(res.new_ids) ? res.new_ids.length : 0;
    const parts = [cards$(res.count)];
    if (n) parts.push(`${fmt(n)} ${plural(n, 'nouvelle', 'nouvelles')}`);
    else parts.push('aucune nouvelle');
    // Entrées du jeu ignorées par le serveur (sans titre, rareté inconnue, champs trop longs).
    const skipped = Number(res.skipped) || 0;
    if (skipped > 0) parts.push(`${fmt(skipped)} ${plural(skipped, 'ignorée', 'ignorées')} (sans titre ou rareté inconnue)`);
    return parts.join(' · ');
  }
  async function refreshCollection() {
    if (S.refresh.running) return;
    const sess = (S.me && S.me.session) || {};
    if (!sess.has_cookie || sess.expired) { openSession(); return; }
    await runRefresh();
  }
  async function runRefresh() {
    if (S.refresh.running) return;
    Object.assign(S.refresh, { running: true, error: false, warn: false, msg: 'Lecture de ta collection sur WikiMasters…' });
    try {
      let page = 0;
      let res = null;
      for (let guard = 0; guard < 5000; guard++) {
        res = await api('POST', '/api/refresh', { page });
        if (res.done) break;
        const next = Number(res.next_page);
        if (!Number.isFinite(next) || next <= page) throw new Error('Réponse inattendue du classeur pendant le rafraîchissement : relance-le.');
        page = next;
        const got = Number(res.fetched);
        const total = Number(res.total);
        S.refresh.msg = Number.isFinite(got) && got > 0
          ? `Lecture de ta collection… ${fmt(got)}${Number.isFinite(total) && total > 0 ? ' sur ' + fmt(total) : ''} exemplaires`
          : `Lecture de ta collection… ${fmt(page)} ${plural(page, 'page lue', 'pages lues')}`;
      }
      if (!res || !res.done) throw new Error("Le rafraîchissement ne s'est pas terminé : relance-le.");
      S.refresh.msg = importSummary(res);
      if (res.complete === false) {
        S.refresh.warn = true;
        S.refresh.msg += ' · il en manque par rapport au total du jeu : relance dans un moment';
      }
      await Promise.all([loadCards(), loadMe()]);
      startPageviews();
    } catch (e) {
      S.refresh.error = true;
      S.refresh.msg = e.message;
      if (e.data && e.data.needs_session) {
        await loadMe().catch(() => {});
        openSession(e.message);
      }
    } finally {
      S.refresh.running = false;
    }
  }

  // ---------------------------------------------------------------- session WikiMasters
  function openSession(error) {
    S.session.error = typeof error === 'string' ? error : '';
    S.session.cookie = '';
    openFavori();
  }
  async function sendSession(body) {
    S.session.busy = true;
    S.session.error = '';
    try {
      await api('POST', '/api/session', body);
      S.session.cookie = '';
      closeModal();
      await loadMe().catch(() => {});
      runRefresh();
    } catch (e) {
      S.session.error = e.message;
    } finally {
      S.session.busy = false;
    }
  }
  function submitCookie() {
    const cookie = S.session.cookie.trim().replace(/^cookie\s*:\s*/i, '').trim();
    if (!cookie) { S.session.error = "Colle la valeur de l'en-tête Cookie."; return; }
    sendSession({ cookie });
  }
  const isGameUrl = (url) => {
    try { const u = new URL(url); return u.hostname === 'www.wiki-masters.com' || u.hostname === 'wiki-masters.com'; } catch (e) { return false; }
  };
  // Du HAR, on n'envoie que l'adresse et l'en-tête Cookie des requêtes vers le jeu ; le reste ne quitte pas le navigateur.
  async function uploadHar(ev) {
    const input = ev.target;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    S.session.error = '';
    let har = null;
    try { har = JSON.parse(await file.text()); } catch (e) { har = null; }
    if (!har || !har.log || !Array.isArray(har.log.entries)) {
      S.session.error = "Ce fichier n'est pas un export HAR lisible : exporte-le à nouveau depuis l'onglet Réseau.";
      return;
    }
    const entries = har.log.entries
      .map((e) => e && e.request)
      .filter((rq) => rq && typeof rq.url === 'string' && isGameUrl(rq.url))
      .map((rq) => ({ request: { url: rq.url, headers: (Array.isArray(rq.headers) ? rq.headers : [])
        .filter((hd) => hd && /^cookie$/i.test(String(hd.name || '')) && hd.value)
        .map((hd) => ({ name: 'Cookie', value: String(hd.value) })) } }))
      .filter((e) => e.request.headers.length);
    if (!entries.length) {
      S.session.error = "Ce HAR ne contient aucune requête vers wiki-masters.com avec un cookie. Dans Chrome ou Edge, l'export par défaut retire les cookies : choisis l'export « avec données sensibles ».";
      return;
    }
    const mine = (e) => (/\/api\/my-collection/.test(e.request.url) ? 1 : 0);
    entries.sort((a, b) => mine(b) - mine(a));
    await sendSession({ har: { log: { entries: entries.slice(0, 20) } } });
  }
  async function forgetSession() {
    S.session.busy = true;
    S.session.error = '';
    try {
      await api('DELETE', '/api/session');
      await loadMe();
      notify('Session WikiMasters oubliée.');
    } catch (e) {
      S.session.error = e.message;
    } finally {
      S.session.busy = false;
    }
  }

  // ---------------------------------------------------------------- navigation et filtres
  function toTop() {
    nextTick(() => {
      const m = document.getElementById('main');
      if (m && typeof m.getBoundingClientRect === 'function' && m.getBoundingClientRect().top < 0) m.scrollIntoView({ block: 'start' });
    });
  }
  function setTab(tab) {
    if (S.tab === tab) return;
    S.tab = tab;
    if (tab === 'reglages') Object.assign(S.settings, { name: (S.me && S.me.user && S.me.user.name) || '', busy: false, error: '', saved: false });
    if (tab === 'maj') prepareFavori();
    toTop();
  }
  function resetFilters() {
    Object.assign(S, { q: '', tagFilter: [], untaggedOnly: false, newOnly: false, rarities: [] });
  }
  function openAlbum(kind, id) {
    S.album = { kind, id };
    S.tab = 'collections';
    Object.assign(S, { albumFilter: 'all', albumSort: 'order', albumLimit: ALBUM_PAGE, lastClicked: null });
    S.selected.clear();
    toTop();
  }
  function closeAlbum() { S.album = null; S.selected.clear(); toTop(); }
  function openTarget(id) { openAlbum('target', id); }
  function toggleTagFilter(name, ev) {
    // Clic simple : ce tag seul (ou plus aucun) ; Ctrl/⌘+clic : combiner.
    if (ev && (ev.ctrlKey || ev.metaKey)) S.tagFilter = S.tagFilter.includes(name) ? S.tagFilter.filter((x) => x !== name) : [...S.tagFilter, name];
    else S.tagFilter = S.tagFilter.length === 1 && S.tagFilter[0] === name ? [] : [name];
    S.untaggedOnly = false;
    S.newOnly = false;
    S.tab = 'cartes';
  }
  function toggleUntagged() { S.untaggedOnly = !S.untaggedOnly; S.tagFilter = []; S.newOnly = false; S.tab = 'cartes'; }
  function toggleNew() { S.newOnly = !S.newOnly; S.tagFilter = []; S.untaggedOnly = false; S.tab = 'cartes'; }
  function toggleRarity(r, ev) {
    // Aucune rareté choisie = toutes. Clic : ajouter ou retirer ; Ctrl/⌘+clic : n'afficher qu'elle.
    if (ev && (ev.ctrlKey || ev.metaKey)) { S.rarities = S.rarities.length === 1 && S.rarities[0] === r ? [] : [r]; return; }
    S.rarities = S.rarities.includes(r) ? S.rarities.filter((x) => x !== r) : [...S.rarities, r];
  }

  // ---------------------------------------------------------------- sélection et tags
  function toggleSelect(id, ev) {
    const set = S.selected;
    const ids = selectableIds.value;
    if (ev && ev.shiftKey && S.lastClicked && S.lastClicked !== id) {
      const a = ids.indexOf(S.lastClicked);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        for (let i = lo; i <= hi; i++) set.add(ids[i]);
      } else if (set.has(id)) set.delete(id); else set.add(id);
    } else if (set.has(id)) set.delete(id); else set.add(id);
    S.lastClicked = id;
    if (ev && ev.target && ev.target.type === 'checkbox') ev.target.checked = set.has(id);
  }
  function selectAll() { S.selected = new Set([...S.selected, ...selectableIds.value]); }
  function clearSelection() { S.selected.clear(); S.lastClicked = null; S.bulkError = ''; }

  function applyTags(ids, fn) {
    const set = new Set(ids);
    cards.value = cards.value.map((c) => (set.has(c.id) ? markRaw({ ...c, tags: fn(c.tags) }) : c));
  }
  async function bulk(mode) {
    const tag = cleanTag(S.bulkTag);
    if (!tag || S.bulkBusy) return;
    const ids = [...S.selected];
    S.bulkBusy = true;
    S.bulkError = '';
    try {
      await api('POST', '/api/tags/bulk', { card_ids: ids, add: mode === 'add' ? [tag] : [], remove: mode === 'remove' ? [tag] : [] });
      applyTags(ids, (tags) => (mode === 'add' ? addTo(tags, tag) : tags.filter((t) => t !== tag)));
      S.bulkTag = '';
      notify(mode === 'add' ? `« ${tag} » ajouté à ${cards$(ids.length)}.` : `« ${tag} » retiré de ${cards$(ids.length)}.`);
    } catch (e) {
      S.bulkError = e.message;
    } finally {
      S.bulkBusy = false;
    }
  }
  async function setTags(card, tags) {
    S.drawer.busy = true;
    S.drawer.error = '';
    try {
      const r = await api('POST', '/api/tags/set', { card_id: card.id, tags });
      const next = Array.isArray(r.tags) ? r.tags.map(String) : tags;
      applyTags([card.id], () => next);
      return true;
    } catch (e) {
      S.drawer.error = e.message;
      return false;
    } finally {
      S.drawer.busy = false;
    }
  }
  async function addTag(card) {
    const t = cleanTag(S.drawer.newTag);
    if (!t) return;
    if (card.tags.includes(t)) { S.drawer.newTag = ''; return; }
    if (card.tags.length >= 30) { S.drawer.error = '30 tags au plus par carte.'; return; }
    if (await setTags(card, [...card.tags, t])) S.drawer.newTag = '';
  }
  function openCardById(id) {
    if (S.modal) closeModal();
    S.openId = id;
    S.drawer.error = '';
    S.drawer.newTag = '';
    const c = cardById.value.get(id);
    if (c && !suggCache.has(c.title)) loadCardSuggestions(c);
  }
  let lastFocus = null;
  function openCardFrom(id, ev) {
    lastFocus = ev && ev.currentTarget ? ev.currentTarget : document.activeElement;
    openCardById(id);
  }
  function closeCard() {
    S.openId = null;
    const el = lastFocus;
    lastFocus = null;
    if (el && document.contains(el)) nextTick(() => el.focus());
  }

  function openTagEdit(name) {
    S.tagEdit = { from: name, to: name, busy: false, error: '', confirmDelete: false };
    S.modal = 'tag';
  }
  async function renameTag(te) {
    const to = cleanTag(te.to);
    if (!to) { te.error = 'Donne un nom au tag.'; return; }
    if (to === te.from) { closeModal(); return; }
    te.busy = true;
    te.error = '';
    try {
      await api('POST', '/api/tags/rename', { from: te.from, to });
      cards.value = cards.value.map((c) => (c.tags.includes(te.from)
        ? markRaw({ ...c, tags: [...new Set(c.tags.map((t) => (t === te.from ? to : t)))] }) : c));
      S.tagFilter = [...new Set(S.tagFilter.map((t) => (t === te.from ? to : t)))];
      closeModal();
      notify(`Tag « ${te.from} » renommé en « ${to} ».`);
    } catch (e) {
      te.error = e.message;
    } finally {
      te.busy = false;
    }
  }
  async function deleteTag(te) {
    if (!te.confirmDelete) { te.confirmDelete = true; return; }
    const ids = cards.value.filter((c) => c.tags.includes(te.from)).map((c) => c.id);
    te.busy = true;
    te.error = '';
    try {
      if (ids.length) await api('POST', '/api/tags/bulk', { card_ids: ids, add: [], remove: [te.from] });
      applyTags(ids, (tags) => tags.filter((t) => t !== te.from));
      S.tagFilter = S.tagFilter.filter((t) => t !== te.from);
      closeModal();
      notify(`Tag « ${te.from} » retiré de ${cards$(ids.length)}.`);
    } catch (e) {
      te.error = e.message;
    } finally {
      te.busy = false;
    }
  }
  function askAcceptInView() {
    const pending = pendingInView.value;
    const byTag = new Map();
    for (const [c, list] of pending) for (const t of list) { if (!byTag.has(t)) byTag.set(t, []); byTag.get(t).push(c.id); }
    openConfirm({
      title: 'Valider les suggestions',
      text: `Ajouter les tags suggérés par Wikidata à ${cards$(pending.length)} (${fmt(byTag.size)} ${plural(byTag.size, 'tag différent', 'tags différents')}) ? Tu pourras les retirer ensuite.`,
      ok: 'Valider les suggestions',
      run: async (cf) => {
        let i = 0;
        for (const [tag, ids] of byTag) {
          cf.progress = `Tag ${fmt(++i)} sur ${fmt(byTag.size)}…`;
          await api('POST', '/api/tags/bulk', { card_ids: ids, add: [tag], remove: [] });
          applyTags(ids, (tags) => addTo(tags, tag));
        }
        notify(`Suggestions validées pour ${cards$(pending.length)}.`);
      },
    });
  }

  // ---------------------------------------------------------------- collections à compléter
  function parseLine(line) {
    let s = String(line || '').trim();
    if (!s) return null;
    const url = s.match(/^https?:\/\/([a-z.-]+)\/(.*)$/i);
    if (url) {
      if (!/^fr\.(?:m\.)?wikipedia\.org$/i.test(url[1])) return { error: 'seules les adresses fr.wikipedia.org sont reconnues' };
      let m = url[2].match(/^wiki\/([^?#]+)/);
      let raw = m ? m[1] : null;
      if (!raw) { m = url[2].match(/[?&]title=([^&#]+)/); raw = m ? m[1].replace(/\+/g, ' ') : null; }
      if (!raw) return { error: "adresse d'article non reconnue" };
      try { s = decodeURIComponent(raw); } catch (e) { s = raw; }
    }
    s = normTitle(s);
    if (/[#<>[\]{}|]/.test(s)) return { error: 'caractère interdit dans un titre' };
    return s || null;
  }
  function openEditor(t) {
    S.editor = {
      id: t ? t.id : null,
      name: t ? t.name : '',
      text: t ? t.items.map((i) => i.title).join('\n') : '',
      source: t ? t.source || null : null,
      known: markRaw(new Map(t ? t.items.map((i) => [i.title, i]) : [])),
      busy: false, progress: '', error: '', issues: null,
    };
    S.modal = 'editor';
  }
  async function saveEditor(ed, force) {
    if (ed.busy) return;
    ed.error = '';
    const name = ed.name.trim();
    if (!name) { ed.error = 'Donne un nom à ta collection.'; return; }
    const titles = [];
    const seen = new Set();
    const bad = [];
    ed.text.split('\n').forEach((line, i) => {
      const r = parseLine(line);
      if (r == null) return;
      if (typeof r === 'object') bad.push(`ligne ${i + 1} : ${r.error}`);
      else if (!seen.has(r)) { seen.add(r); titles.push(r); }
    });
    if (bad.length) { ed.error = 'À corriger : ' + bad.slice(0, 4).join(' ; ') + (bad.length > 4 ? ' ; …' : '.'); return; }
    if (!titles.length) { ed.error = 'Ajoute au moins un article, un par ligne.'; return; }
    if (titles.length > 3000) { ed.error = `3 000 articles au plus par collection (il y en a ${fmt(titles.length)}).`; return; }
    const alive = () => S.editor === ed;
    ed.busy = true;
    try {
      const todo = titles.filter((t) => !ed.known.has(t));
      if (todo.length) {
        ed.progress = `Vérification sur Wikipédia… 0 sur ${fmt(todo.length)}`;
        const checked = await verifyTitles(todo, (n) => { if (alive()) ed.progress = `Vérification sur Wikipédia… ${fmt(n)} sur ${fmt(todo.length)}`; }, alive);
        if (!alive()) return;
        for (const [t, item] of checked) ed.known.set(t, item);
      }
      const items = [];
      const kept = new Set();
      let redirected = 0;
      for (const t of titles) {
        const it = ed.known.get(t);
        if (!it) continue;
        if (it.title !== t) redirected++;
        if (kept.has(it.title)) continue;
        kept.add(it.title);
        items.push({ title: it.title, description: it.description || null, image: it.image || null, status: it.status || 'ok' });
      }
      const issues = items.filter((i) => i.status !== 'ok');
      if (issues.length && !force) {
        ed.issues = issues.map((i) => ({ title: i.title, status: i.status }));
        ed.progress = '';
        return;
      }
      ed.progress = 'Enregistrement…';
      const body = { name, items };
      if (ed.id) body.id = ed.id;
      if (ed.source) body.source = ed.source;
      const r = await api('POST', '/api/targets/save', body);
      if (!alive()) return;
      if (r.target) upsertTarget(r.target); else await loadTargets();
      closeModal();
      if (r.target) openTarget(r.target.id);
      startPageviews();
      notify(redirected ? `Collection enregistrée (${fmt(redirected)} ${plural(redirected, 'titre suivi', 'titres suivis')} jusqu'à l'article).` : 'Collection enregistrée.');
    } catch (e) {
      if (alive()) ed.error = e.message;
    } finally {
      ed.busy = false;
      if (alive()) ed.progress = '';
    }
  }
  function askDeleteTarget(t) {
    openConfirm({
      title: `Supprimer « ${t.name} » ?`,
      text: "La collection disparaît de ton classeur. Tes cartes et tes tags ne sont pas touchés.",
      ok: 'Supprimer la collection',
      danger: true,
      run: async () => {
        await api('POST', '/api/targets/delete', { id: t.id });
        targets.value = targets.value.filter((x) => x.id !== t.id);
        if (S.album && S.album.kind === 'target' && S.album.id === t.id) S.album = null;
        notify(`Collection « ${t.name} » supprimée.`);
      },
    });
  }
  async function addCatalog(entry) {
    if (S.catalog.busy[entry.id]) return;
    S.catalog.busy[entry.id] = true;
    S.catalog.error = '';
    try {
      const items = entry.items.slice(0, 3000).map((i) => ({ title: String(i.title), description: i.description || null, image: null, status: 'ok' }));
      const r = await api('POST', '/api/targets/save', { name: entry.name, items, source: 'catalog:' + entry.id });
      if (r.target) upsertTarget(r.target); else await loadTargets();
      const mine = targets.value.find((t) => t.source === 'catalog:' + entry.id);
      if (mine && S.album && S.album.kind === 'catalog' && S.album.id === entry.id) S.album = { kind: 'target', id: mine.id };
      notify(`« ${entry.name} » ajoutée à tes collections.`);
    } catch (e) {
      S.catalog.error = e.message;
    } finally {
      S.catalog.busy[entry.id] = false;
    }
  }

  // ---------------------------------------------------------------- fenêtres, réglages, favori
  function closeModal() {
    const m = S.modal;
    S.modal = null;
    if (m === 'editor') S.editor = null;
    if (m === 'confirm') S.confirm = null;
    if (m === 'tag') S.tagEdit = null;
    if (m === 'switch') S.switchAsk = null;
  }
  function openConfirm(o) {
    S.confirm = { title: o.title, text: o.text, ok: o.ok, danger: !!o.danger, run: markRaw(o.run), after: o.after ? markRaw(o.after) : null,
      busy: false, error: '', progress: '' };
    S.modal = 'confirm';
  }
  async function runConfirm(cf) {
    if (cf.busy) return;
    cf.busy = true;
    cf.error = '';
    try {
      await cf.run(cf);
      if (S.confirm === cf) { closeModal(); if (cf.after) cf.after(); }
    } catch (e) {
      cf.error = e.message;
    } finally {
      cf.busy = false;
      cf.progress = '';
    }
  }
  function openSettings() { setTab('reglages'); }
  async function saveName() {
    const st = S.settings;
    st.busy = true;
    st.error = '';
    st.saved = false;
    try {
      const r = await api('PATCH', '/api/me', { name: st.name.trim() });
      if (S.me) S.me.user = r.user || { ...S.me.user, name: st.name.trim() };
      remember(S.key, (S.me && S.me.user && S.me.user.name) || '');
      st.saved = true;
    } catch (e) {
      st.error = e.message;
    } finally {
      st.busy = false;
    }
  }
  function askForget() {
    openConfirm({
      title: 'Oublier ce navigateur ?',
      text: "Ce navigateur oubliera la clé de ton classeur, les autres classeurs ouverts ici, la clé de ton favori et les données gardées de Wikipédia. Ton classeur reste intact : ton lien personnel le rouvre (vérifie que tu l'as bien gardé). Le favori déjà installé continue de marcher.",
      ok: 'Oublier ce navigateur',
      run: async () => { forgetKey(); },
    });
  }
  function askDeleteAccount() {
    openConfirm({
      title: 'Supprimer ton classeur ?',
      text: "Tes cartes rangées, tes tags, tes collections à compléter et ta session WikiMasters seront effacés du classeur, et ton lien ne marchera plus. C'est définitif. Ta collection dans le jeu n'est pas touchée.",
      ok: 'Supprimer mon classeur',
      danger: true,
      run: async () => {
        const key = S.key;
        await api('DELETE', '/api/me');
        forgetKnown(key);
        const others = S.known.slice();
        forgetKey();
        // Les autres classeurs ouverts dans ce navigateur restent connus.
        S.known = others;
        saveKnown();
        notify('Ton classeur a été supprimé.');
      },
    });
  }
  // « Changer ma clé » : nouvelle clé principale, l'ancien lien cesse de marcher partout.
  function askRotate() {
    openConfirm({
      title: 'Changer ma clé ?',
      text: "Ton classeur reçoit une nouvelle clé, donc un nouveau lien personnel. L'ancien lien cessera de marcher partout : sur tes autres appareils, il faudra ouvrir le nouveau. À faire si ton lien a pu être vu par quelqu'un d'autre.",
      ok: 'Changer ma clé',
      run: async () => {
        const r = await api('POST', '/api/key/rotate');
        if (!r.key || !KEY_RE.test(r.key)) throw new Error("Le classeur n'a pas renvoyé de nouvelle clé valable : réessaie.");
        const name = (S.me && S.me.user && S.me.user.name) || '';
        forgetKnown(S.key);
        setKey(r.key);
        remember(r.key, name);
        S.newLink = location.origin + '/#cle=' + r.key;
      },
      after: () => { S.modal = 'link'; },
    });
  }
  async function loadBookmarkletSource() {
    if (S.bm.src != null) return;
    S.bm.error = '';
    try {
      const r = await fetch('/assets/bookmarklet.js', { cache: 'no-cache' });
      if (!r.ok) throw new Error(String(r.status));
      S.bm.src = await r.text();
    } catch (e) {
      S.bm.error = "Le favori n'a pas pu être préparé : recharge la page, puis réessaie.";
    }
  }
  // Prépare le favori (source, clé d'import gardée) pour l'onglet « Mettre à jour ».
  async function prepareFavori() {
    S.bm.clicked = false;
    S.bm.importKey = storedImportKey();
    await loadBookmarkletSource();
  }
  function openFavori() {
    if (S.modal) closeModal();
    S.openId = null;
    S.tab = 'maj';
    prepareFavori();
    toTop();
  }
  // Nouvelle clé d'import (POST /api/import-key) : l'ancien favori, où qu'il soit, cesse de marcher.
  async function createImportKey() {
    if (S.bm.busy) return false;
    S.bm.busy = true;
    S.bm.error = '';
    try {
      const r = await api('POST', '/api/import-key');
      if (!r.import_key || typeof r.import_key !== 'string') throw new Error("Le classeur n'a pas renvoyé de clé d'import : réessaie.");
      const me = S.me && S.me.user;
      store.set(LS.importKey, JSON.stringify({ user: me ? me.id : null, key: r.import_key }));
      S.bm.importKey = r.import_key;
      if (S.me) S.me.has_import_key = true;
      return true;
    } catch (e) {
      S.bm.error = e.message;
      return false;
    } finally {
      S.bm.busy = false;
    }
  }
  function askRegenerate() {
    openConfirm({
      title: 'Régénérer le favori ?',
      text: "Le favori reçoit une nouvelle clé d'import. L'ancien favori cessera de marcher partout : il faudra remplacer celui de ta barre de favoris, et sur tes autres navigateurs. À faire si ton favori a pu être vu ou copié par quelqu'un d'autre.",
      ok: 'Régénérer le favori',
      run: async () => {
        if (!(await createImportKey())) throw new Error(S.bm.error || "Le favori n'a pas pu être régénéré.");
        await loadBookmarkletSource();
      },
      after: () => { openFavori(); notify('Nouveau favori prêt : remplace l\'ancien dans ta barre de favoris.'); },
    });
  }
  // Met bookmarklet.js sur une ligne (commentaires en lignes à part, instructions finies par « ; »), y place l'adresse
  // du classeur et la clé, et en fait une adresse javascript: (encodeURI, plus « # » qui couperait l'adresse).
  function makeBookmarklet(src, site, key) {
    const code = src.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join(' ')
      .replace('"__SITE__"', JSON.stringify(site)).replace('"__KEY__"', JSON.stringify(key));
    return 'javascript:' + encodeURI(code).replace(/#/g, '%23');
  }
  async function copy(text, id) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { ok = false; }
    if (!ok) {
      const el = document.getElementById(id);
      if (el && el.select) { el.focus(); el.select(); try { ok = document.execCommand('copy'); } catch (e) { ok = false; } }
    }
    if (ok) {
      S.copied = id;
      setTimeout(() => { if (S.copied === id) S.copied = ''; }, 2000);
    } else notify('Copie impossible ici : le texte est sélectionné, copie-le avec Ctrl+C (⌘+C sur Mac).', true);
  }

  // ================================================================ rendu : petits morceaux
  const icon = (name, cls) => h('svg', { class: ['ic', cls || ''], 'aria-hidden': 'true', focusable: 'false' }, [h('use', { href: '#i-' + name })]);
  const hideBroken = (e) => { if (e && e.target) e.target.classList.add('broken'); };
  const errLine = (msg) => (msg ? h('p', { class: 'status err', role: 'alert' }, msg) : null);
  const sr = (text) => h('span', { class: 'sr' }, text);
  const okRarity = (r) => (RARITY_NAME[r] ? r : null);
  // Pastille de rareté ; « ≈ R » pour une rareté estimée, « ? » si inconnue.
  function pill(r, est) {
    r = okRarity(r);
    if (!r) return h('span', { class: 'pill unk', title: 'Rareté inconnue' }, '?');
    return h('span', { class: ['pill', 'r' + r, { est }], title: (est ? 'Rareté estimée : ' : '') + RARITY_NAME[r] }, (est ? '≈ ' : '') + r);
  }
  const initialOf = (t) => (String(t || '').replace(/^[^\p{L}\p{N}]+/u, '').charAt(0) || '?').toUpperCase();
  const pct = (own, total) => {
    const p = total ? (100 * own) / total : 0;
    return (p >= 10 || p === 0 ? String(Math.round(p)) : p.toFixed(1).replace('.', ',')) + ' %';
  };
  function chipList(tags, auto) {
    const shown = tags.slice(0, 3).map((t) => h('span', { class: ['tag', { auto }], key: t }, t));
    if (tags.length > 3) shown.push(h('span', { class: 'tag more', key: '+', title: tags.slice(3).join(', ') }, '+' + (tags.length - 3)));
    return shown;
  }

  // ---------------------------------------------------------------- la carte de jeu (5:7)
  function viewCard(c, big) {
    const r = okRarity(c.rarity) || 'C';
    const open = (e) => {
      if (big) return;
      if (e.shiftKey || e.ctrlKey || e.metaKey) { toggleSelect(c.id, e); return; }
      openCardFrom(c.id, e);
    };
    return h('article', {
      class: ['card', 'r' + r, { shiny: c.shiny, big }],
      role: big ? null : 'button', tabindex: big ? null : '0',
      'aria-label': `${c.title}, ${RARITY_NAME[r]}${c.shiny ? ', brillante' : ''}${big ? '' : ' : ouvrir la fiche'}`,
      onClick: open,
      onKeydown: big ? null : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCardFrom(c.id, e); } },
    }, [
      h('div', { class: 'card__art' }, [
        h('div', { class: 'card__noart' }, [h('span', null, initialOf(c.title))]),
        c.image ? h('img', { src: c.image, alt: '', loading: big ? null : 'lazy', decoding: 'async', onError: hideBroken }) : null,
      ]),
      pill(r),
      c.starred ? h('svg', { class: 'card__star', viewBox: '0 0 24 24', role: 'img', 'aria-label': 'Favorite dans le jeu' }, [h('use', { href: '#i-star' })]) : null,
      c.count > 1 ? h('span', { class: 'card__count', title: `${fmt(c.count)} exemplaires` }, '×' + fmt(c.count)) : null,
      !big && newIdSet.value.has(c.id) ? h('span', { class: 'card__new' }, 'Nouvelle') : null,
      h('div', { class: 'card__body' }, [
        h(big ? 'p' : 'h3', { class: 'card__title' }, c.title),
        c.category ? h('p', { class: 'card__desc' }, c.category) : null,
        h('div', { class: 'card__stats' }, [
          h('span', { class: 'atk', title: 'Attaque' }, [icon('swords'), sr('Attaque '), fmt(c.atk)]),
          h('span', { class: 'def', title: 'Défense' }, [icon('shield'), sr('Défense '), fmt(c.def)]),
        ]),
      ]),
      r === 'L' ? h('div', { class: 'card__sheen', 'aria-hidden': 'true' }) : null,
    ]);
  }
  // Une carte dans une grille : la carte, sa case de sélection, et les tags sous la carte.
  function viewCell(c) {
    const sel = S.selected.has(c.id);
    let tags = c.tags;
    let auto = false;
    if (!tags.length) { const s = suggestionsFor(c); if (s && s.length) { tags = s; auto = true; } }
    return h('div', { class: ['cell', { selected: sel, pulled: S.openId === c.id }] }, [
      viewCard(c, false),
      h('label', { class: 'pick', title: 'Sélectionner (Maj+clic : une plage)' }, [
        h('input', { type: 'checkbox', checked: sel, 'aria-label': 'Sélectionner ' + c.title, onClick: (e) => toggleSelect(c.id, e) }),
        icon('check'),
      ]),
      tags.length ? h('div', { class: 'cell__tags', title: auto ? 'Suggestions de Wikidata (à valider dans la fiche)' : null }, chipList(tags, auto)) : null,
    ]);
  }
  // Case vide d'une collection : la carte qui te manque.
  function viewSlot(s, col) {
    const it = s.item;
    const img = it.image || s.thumb;
    let views = '';
    if (it.status === 'ok') views = s.views != null ? `${fmt(s.views)} vues / 30 j` : S.pv.running ? 'vues…' : 'vues inconnues';
    return h('div', { class: 'slot', key: s.key }, [
      img ? h('img', { class: 'slot__bg', src: img, alt: '', loading: 'lazy', decoding: 'async', onError: hideBroken }) : null,
      col.ordered ? h('span', { class: 'slot__no', 'aria-hidden': 'true' }, String(s.i)) : null,
      h('div', { class: 'slot__top' }, [it.status === 'ok' ? pill(s.est, true) : null]),
      h('h3', null, [h('a', { href: wikiUrl(it.title), target: '_blank', rel: 'noopener noreferrer', title: "Pas encore dans ta collection : ouvrir l'article" }, it.title)]),
      it.description ? h('p', null, it.description) : null,
      it.status === 'missing' ? h('p', { class: 'warn' }, 'Article introuvable sur Wikipédia') : null,
      it.status === 'disambiguation' ? h('p', { class: 'warn' }, "Page d'homonymie : précise le titre") : null,
      views ? h('span', { class: 'views' }, views) : null,
    ]);
  }
  function viewMini(c, i) {
    const r = okRarity(c.rarity) || 'C';
    return h('span', { class: ['mini', 'r' + r], key: c.id + ':' + i }, c.image ? [h('img', { src: c.image, alt: '', loading: 'lazy', decoding: 'async', onError: hideBroken })] : null);
  }
  function rarityBar(byR, total, cls) {
    return h('span', { class: cls || 'bar', 'aria-hidden': 'true' }, RAR_UP.map((r) => (byR[r]
      ? h('i', { key: r, class: 'r' + r, style: { width: ((100 * byR[r]) / Math.max(1, total)).toFixed(3) + '%' } }) : null)));
  }
  function viewRow(col) {
    const p = progressOf(col);
    return h('button', { class: ['row', { zero: !p.own }], type: 'button', key: col.key, onClick: () => openAlbum(col.kind, col.id),
      'aria-label': `${col.name} : ${fmt(p.own)} sur ${fmt(p.total)}` }, [
      h('span', { class: 'fan', 'aria-hidden': 'true' }, p.sample.length ? p.sample.map(viewMini) : [h('span', { class: 'mini empty' })]),
      h('span', { class: 'info' }, [
        h('span', { class: 'name' }, col.name),
        rarityBar(p.byR, p.total),
        h('span', { class: 'line' }, [h('span', null, [h('b', null, fmt(p.own)), ` sur ${fmt(p.total)}`]), h('span', null, pct(p.own, p.total))]),
      ]),
    ]);
  }

  // ================================================================ rendu : bandeau et onglets
  const TABS = [['collections', 'Collections'], ['cartes', 'Mes cartes'], ['maj', 'Mettre à jour'], ['reglages', 'Réglages']];
  function onTabKey(e) {
    const i = TABS.findIndex(([id]) => id === S.tab);
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
    if (e.key === 'ArrowLeft') j = (i + TABS.length - 1) % TABS.length;
    if (e.key === 'Home') j = 0;
    if (e.key === 'End') j = TABS.length - 1;
    if (j < 0) return;
    e.preventDefault();
    setTab(TABS[j][0]);
    nextTick(() => { const b = document.getElementById('tab-' + TABS[j][0]); if (b) b.focus(); });
  }
  function viewSummary() {
    const total = cards.value.length;
    const sess = (S.me && S.me.session) || {};
    const refreshBits = [
      h('button', { class: 'btn small', type: 'button', disabled: S.refresh.running, onClick: refreshCollection },
        [icon('refresh', S.refresh.running ? 'spin' : ''), S.refresh.running ? 'Rafraîchissement…' : 'Rafraîchir la collection']),
      h('span', { class: ['status', { err: S.refresh.error, warn: S.refresh.warn }], 'aria-live': 'polite' }, S.refresh.msg),
      S.refresh.error && !S.refresh.running ? h('button', { class: 'linkish', type: 'button', onClick: openFavori }, 'Passer par le favori') : null,
    ];
    if (!total) {
      return h('div', { class: 'summary' }, [
        h('div', { class: 'figures' }, [h('div', { class: 'figure wide' }, [h('span', null, S.loadingCards ? 'Chargement de ta collection…'
          : "Ton classeur est vide : ouvre « Mettre à jour » pour y envoyer ta collection avec le favori.")])]),
        h('div', { class: 'refresh-line' }, refreshBits),
      ]);
    }
    const counts = rarityCount.value;
    const all = [...collections.value.mine, ...collections.value.proposed];
    const started = all.filter((c) => progressOf(c).own > 0).length;
    const nL = counts.L || 0;
    return h('div', { class: 'summary' }, [
      h('div', { class: 'figures' }, [
        h('div', { class: 'figure' }, [h('b', null, fmt(total)), h('span', null, 'cartes différentes')]),
        copies.value !== total ? h('div', { class: 'figure' }, [h('b', null, fmt(copies.value)), h('span', null, 'exemplaires')]) : null,
        h('div', { class: 'figure' }, [h('b', null, `${fmt(started)} / ${fmt(all.length)}`), h('span', null, 'collections commencées')]),
        h('div', { class: 'figure' }, [h('b', null, fmt(nL)), h('span', null, plural(nL, 'légendaire', 'légendaires'))]),
      ]),
      h('div', { class: 'rbar' }, [
        h('div', { class: 'track', role: 'img', 'aria-label': 'Répartition par rareté : ' + RAR_UP.map((r) => `${RARITY_NAME[r]} ${counts[r] || 0}`).join(', ') },
          RAR_UP.map((r) => (counts[r] ? h('i', { key: r, class: 'r' + r, title: `${RARITY_NAME[r]} : ${fmt(counts[r])}`, style: { width: ((100 * counts[r]) / total).toFixed(3) + '%' } }) : null))),
        h('div', { class: 'rlegend' }, [
          ...RAR_UP.map((r) => h('span', { key: r }, [pill(r), ' ', h('b', null, fmt(counts[r] || 0))])),
          S.fetchedAt ? h('span', { class: 'stamp' }, `· instantané du ${dateShort(S.fetchedAt)}`) : null,
          sess.has_cookie && sess.expired ? h('span', { class: 'stamp warn' }, '· session WikiMasters expirée') : null,
        ]),
      ]),
      h('div', { class: 'refresh-line' }, refreshBits),
    ]);
  }
  function viewTop() {
    const name = S.me && S.me.user && S.me.user.name;
    return h('header', { class: 'top' }, [h('div', { class: 'wrap' }, [
      h('div', { class: 'headline' }, [
        h('div', null, [h('p', { class: 'eyebrow' }, 'Collections WikiMasters'), h('h1', null, name ? `Le classeur de ${name}` : 'Le classeur')]),
        h('p', { class: 'note' }, 'Outil personnel, sans lien avec le jeu. Les cartes viennent de ta collection, les illustrations de Wikimedia Commons, les listes de Wikidata.'),
      ]),
      viewSummary(),
      h('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Sections' }, TABS.map(([id, label]) => h('button', {
        key: id, id: 'tab-' + id, type: 'button', role: 'tab', 'aria-selected': String(S.tab === id), 'aria-controls': 'panel-' + id,
        tabindex: S.tab === id ? '0' : '-1', onClick: () => setTab(id), onKeydown: onTabKey,
      }, label))),
    ])]);
  }

  // ================================================================ rendu : onglet Collections
  function viewCollections() {
    const { mine, proposed } = collections.value;
    const groups = new Map();
    for (const col of proposed) {
      if (!groups.has(col.groupName)) groups.set(col.groupName, []);
      groups.get(col.groupName).push(col);
    }
    // Dans chaque groupe proposé : d'abord celles où tu as déjà des cartes (les plus avancées en tête).
    // Une collection proposée à 0 ne dit rien : on ne montre que celles où tu as déjà des cartes, les autres derrière
    // un bouton (tes propres collections, elles, restent toujours visibles).
    let hidden = 0;
    const ordered = (list) => list.map((col, i) => ({ col, p: progressOf(col), i }))
      .filter((x) => { if (S.showEmptyProposed || x.p.own > 0) return true; hidden++; return false; })
      .sort((a, b) => (b.p.own > 0) - (a.p.own > 0) || (b.p.own / Math.max(1, b.p.total)) - (a.p.own / Math.max(1, a.p.total)) || a.i - b.i)
      .map((x) => x.col);
    const shownGroups = [...groups].map(([name, list]) => [name, ordered(list)]).filter(([, list]) => list.length);
    return h('div', { class: 'groups' }, [
      h('section', { class: 'group', 'aria-labelledby': 'h-mine' }, [
        h('div', { class: 'section-head' }, [
          h('h2', { id: 'h-mine' }, 'Mes collections'),
          h('small', null, 'les tiennes, à compléter'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn', type: 'button', onClick: () => openEditor(null) }, [icon('plus', 'sm'), 'Nouvelle collection']),
        ]),
        mine.length ? h('div', { class: 'rows' }, mine.map(viewRow))
          : h('p', { class: 'empty-box' }, 'Aucune collection pour l\'instant : crée la tienne (une liste d\'articles Wikipédia), ou ajoute une collection proposée ci-dessous.'),
      ]),
      h('section', { class: 'group', 'aria-labelledby': 'h-proposed' }, [
        h('div', { class: 'section-head' }, [
          h('h2', { id: 'h-proposed' }, 'Collections proposées'),
          h('small', null, 'tirées de Wikidata, articles en français seulement ; ouvre-en une, puis ajoute-la à tes collections'),
        ]),
        !S.catalog.list ? (S.catalog.error ? errLine(S.catalog.error) : h('p', { class: 'muted', role: 'status' }, 'Chargement du catalogue…')) : null,
        ...shownGroups.map(([name, list]) => h('div', { class: 'subgroup', key: 'g:' + name }, [
          h('h3', { class: 'subhead' }, name),
          h('div', { class: 'rows' }, list.map(viewRow)),
        ])),
        S.catalog.list && proposed.length && !shownGroups.length ? h('p', { class: 'muted' }, 'Aucune collection proposée commencée pour l\x27instant.') : null,
        S.catalog.list && (hidden || S.showEmptyProposed) ? h('div', { class: 'show-more' }, [
          h('button', { class: 'btn', type: 'button', id: 'toggle-empty', onClick: () => { S.showEmptyProposed = !S.showEmptyProposed; } },
            S.showEmptyProposed ? 'Masquer les collections pas encore commencées' : `Afficher aussi les ${fmt(hidden)} collections pas encore commencées`),
        ]) : null,
        S.catalog.list && !proposed.length ? h('p', { class: 'muted' }, 'Tu as déjà ajouté toutes les collections proposées.') : null,
      ]),
    ]);
  }
  function seg(label, pressed, onClick) {
    return h('button', { type: 'button', 'aria-pressed': String(pressed), onClick }, label);
  }
  function viewAlbum() {
    const col = activeAlbum.value;
    if (!col) {
      return h('div', { class: 'album-head' }, [
        h('button', { class: 'back', type: 'button', onClick: closeAlbum }, '← Toutes les collections'),
        h('p', { class: 'muted' }, S.catalog.loading ? 'Chargement…' : "Cette collection n'existe plus."),
      ]);
    }
    const p = progressOf(col);
    void S.pv.version;
    const missR = {};
    let unknown = 0;
    let problems = 0;
    for (const it of col.items) {
      if (byTitle.value.has(normTitle(it.title))) continue;
      if (it.status !== 'ok') { problems++; continue; }
      const info = pvCache.get(it.title);
      const est = estRarity(info ? info[0] : null);
      if (est) missR[est] = (missR[est] || 0) + 1; else unknown++;
    }
    const missing = p.total - p.own;
    const missLine = missing > 0 ? [
      h('span', null, `Il t'en manque ${fmt(missing)} :`),
      ...RAR_UP.slice().reverse().filter((r) => missR[r]).map((r) => h('span', { key: r }, [pill(r, true), ' ', h('b', { class: 'num' }, fmt(missR[r]))])),
      unknown ? h('span', { key: '?' }, [pill(null), ' ', h('b', { class: 'num' }, fmt(unknown))]) : null,
      problems ? h('span', { key: '!' }, `· ${fmt(problems)} à vérifier`) : null,
    ] : [h('span', null, p.total ? 'Collection complète.' : 'Cette collection est vide.')];
    let hint = '≈ : rareté estimée d\'après les vues de l\'article sur Wikipédia ces 30 derniers jours.';
    if (S.pv.running) hint = `Rareté estimée des cases vides : ${fmt(S.pv.done)} sur ${fmt(S.pv.total)} articles…`;
    else if (S.pv.error) hint = `Rareté estimée incomplète : ${S.pv.error}`;
    const actions = col.kind === 'target' ? [
      h('button', { class: 'btn', type: 'button', onClick: () => openEditor(col.t) }, [icon('pen', 'sm'), 'Modifier']),
      h('button', { class: 'btn danger', type: 'button', onClick: () => askDeleteTarget(col.t) }, [icon('trash', 'sm'), 'Supprimer']),
    ] : [
      h('button', { class: 'btn primary', type: 'button', disabled: !!S.catalog.busy[col.id], onClick: () => addCatalog(col.e) },
        [icon('plus', 'sm'), S.catalog.busy[col.id] ? 'Ajout…' : 'Ajouter à mes collections']),
    ];
    const total = albumSlots.value.length;
    const shown = visibleSlots.value.length;
    return h('div', null, [
      h('div', { class: 'album-head' }, [
        h('button', { class: 'back', type: 'button', onClick: closeAlbum }, '← Toutes les collections'),
        h('div', { class: 'album-title' }, [h('h2', null, col.name), h('span', { class: 'num' }, `${fmt(p.own)} sur ${fmt(p.total)}`),
          col.kind === 'catalog' ? h('span', { class: 'badge' }, 'proposée') : null]),
        rarityBar(p.byR, p.total, 'bar big'),
        h('div', { class: 'missing-sum' }, missLine),
        missing > 0 ? h('p', { class: 'hint', 'aria-live': 'polite' }, hint) : null,
        errLine(S.catalog.error && S.album && S.album.kind === 'catalog' ? S.catalog.error : ''),
        h('div', { class: 'toolbar' }, [
          h('div', { class: 'seg', role: 'group', 'aria-label': 'Filtrer' }, [
            seg('Toutes', S.albumFilter === 'all', () => { S.albumFilter = 'all'; }),
            seg('Possédées', S.albumFilter === 'owned', () => { S.albumFilter = 'owned'; }),
            seg('Manquantes', S.albumFilter === 'missing', () => { S.albumFilter = 'missing'; }),
          ]),
          h('div', { class: 'seg', role: 'group', 'aria-label': 'Trier' }, [
            seg(col.ordered ? 'Ordre' : 'A → Z', S.albumSort === 'order', () => { S.albumSort = 'order'; }),
            seg('Rareté', S.albumSort === 'rarity', () => { S.albumSort = 'rarity'; }),
          ]),
          h('span', { class: 'spacer' }),
          ...actions,
        ]),
      ]),
      total ? h(AlbumGrid) : h('div', { class: 'empty-box' }, p.total ? 'Aucune carte ici.' : [
        'Ajoute des articles Wikipédia pour la remplir. ',
        col.kind === 'target' ? h('button', { class: 'btn', type: 'button', onClick: () => openEditor(col.t) }, 'Modifier la collection') : null,
      ]),
      shown < total ? h('div', { class: 'show-more' }, [h('button', { class: 'btn', type: 'button', onClick: () => { S.albumLimit += ALBUM_PAGE; } },
        `Afficher les ${fmt(Math.min(ALBUM_PAGE, total - shown))} suivantes (${fmt(total - shown)} restantes)`)]) : null,
    ]);
  }

  // ================================================================ rendu : onglet Mes cartes
  function facetChip(key, label, n, on, onClick, title) {
    return h('button', { key, class: 'chip', type: 'button', 'aria-pressed': String(on), title, onClick }, [h('span', { class: 'chip__label' }, label), h('span', { class: 'n' }, fmt(n))]);
  }
  function viewSuggBox() {
    if (S.sugg.running) {
      return [h('p', { class: 'small', role: 'status' }, `Suggestions : ${fmt(S.sugg.done)} sur ${cards$(S.sugg.total)}…`),
        h('button', { class: 'btn small', type: 'button', onClick: stopSuggestions }, 'Arrêter')];
    }
    const left = unsuggested.value;
    return [
      h('p', { class: 'small muted' }, left ? 'Tags suggérés d\'après Wikidata (nature, métier, pays), gardés dans ce navigateur. Tu les valides dans les fiches.'
        : 'Suggestions calculées pour toute la collection : elles apparaissent en pointillés sous les cartes sans tag.'),
      errLine(S.sugg.error),
      left ? h('button', { class: 'btn small', type: 'button', onClick: computeAllSuggestions }, `Calculer les suggestions pour toute la collection (${fmt(left)})`) : null,
    ];
  }
  function viewFacets() {
    const q = fold(S.tagSearch.trim());
    const list = q ? tagList.value.filter((t) => fold(t.name).includes(q)) : tagList.value;
    const shown = q || S.tagsAll ? list : list.slice(0, 40);
    return h('aside', { class: 'facets', 'aria-label': 'Tags' }, [
      h('div', { class: 'facet' }, [
        h('h3', null, 'Raccourcis'),
        h('div', { class: 'chips' }, [
          facetChip('untagged', 'Sans tag', untaggedCount.value, S.untaggedOnly, toggleUntagged),
          newIds.value.length ? facetChip('new', 'Nouvelles du dernier rafraîchissement', newIds.value.length, S.newOnly, toggleNew) : null,
        ]),
      ]),
      h('div', { class: 'facet' }, [
        h('h3', null, ['Tes tags', h('span', { class: 'hint-inline' }, 'Ctrl/⌘+clic : combiner')]),
        tagList.value.length > 8 ? h('label', { class: 'tag-search' }, [sr('Chercher un tag'),
          h('input', { type: 'search', value: S.tagSearch, placeholder: 'Chercher un tag…', autocomplete: 'off', onInput: (e) => { S.tagSearch = e.target.value; } })]) : null,
        list.length ? h('div', { class: 'chips' }, shown.map((t) => facetChip('tag:' + t.name, t.name, t.count, S.tagFilter.includes(t.name), (e) => toggleTagFilter(t.name, e),
          'Ctrl/⌘+clic : combiner avec les tags choisis')))
          : h('p', { class: 'small muted' }, tagList.value.length ? 'Aucun tag ne correspond.' : 'Pas encore de tag : sélectionne des cartes, ou ouvre une fiche pour en ajouter.'),
        list.length > shown.length ? h('button', { class: 'linkish', type: 'button', onClick: () => { S.tagsAll = true; } }, `Afficher les ${fmt(list.length - shown.length)} autres`) : null,
      ]),
      h('div', { class: 'facet' }, [h('h3', null, 'Suggestions'), ...viewSuggBox()]),
    ]);
  }
  function filterChip(key, label, onRemove, removeLabel) {
    return h('span', { class: 'chip on', key }, [h('span', { class: 'chip__label' }, label),
      h('button', { type: 'button', class: 'x', 'aria-label': removeLabel, onClick: onRemove }, [icon('x', 'sm')])]);
  }
  function viewCountLine() {
    const n = filtered.value.length;
    const pending = pendingInView.value.length;
    const rar = RAR_UP.filter((r) => S.rarities.includes(r));
    return h('div', { class: 'count-line' }, [
      h('span', null, [h('b', null, fmt(n)), ` ${plural(n, 'carte', 'cartes')}`, n !== cards.value.length ? ` sur ${fmt(cards.value.length)}` : '']),
      ...S.tagFilter.map((t) => filterChip('tag:' + t, t, () => { S.tagFilter = S.tagFilter.filter((x) => x !== t); }, 'Retirer le filtre ' + t)),
      S.untaggedOnly ? filterChip('untagged', 'Sans tag', () => { S.untaggedOnly = false; }, 'Retirer le filtre Sans tag') : null,
      S.newOnly ? filterChip('new', 'Nouvelles', () => { S.newOnly = false; }, 'Retirer le filtre Nouvelles') : null,
      S.q.trim() ? filterChip('q', `« ${S.q.trim()} »`, () => { S.q = ''; }, 'Effacer la recherche') : null,
      rar.length ? filterChip('rar', 'Raretés : ' + rar.join(', '), () => { S.rarities = []; }, 'Afficher toutes les raretés') : null,
      S.tagFilter.length === 1 ? h('button', { class: 'linkish', type: 'button', onClick: () => openTagEdit(S.tagFilter[0]) }, `Renommer ou supprimer « ${S.tagFilter[0]} »`) : null,
      hasFilters.value ? h('button', { class: 'linkish', type: 'button', onClick: resetFilters }, 'Réinitialiser les filtres') : null,
      pending ? h('button', { class: 'btn small', type: 'button', onClick: askAcceptInView }, [icon('check', 'sm'), `Valider les suggestions (${cards$(pending)})`]) : null,
    ]);
  }
  function viewCards() {
    if (!cards.value.length) {
      return h('div', { class: 'empty-box big' }, [
        h('h2', null, 'Ton classeur est vide'),
        h('p', null, 'Ta collection apparaîtra ici : chaque carte avec son illustration, sa rareté, son attaque, sa défense et tes tags.'),
        h('button', { class: 'btn primary', type: 'button', onClick: openFavori }, [icon('bookmark', 'sm'), 'Installer le favori']),
      ]);
    }
    const counts = rarityCount.value;
    const total = filtered.value.length;
    const shown = visibleCards.value.length;
    return h('div', { class: 'cards-layout' }, [
      viewFacets(),
      h('div', { class: 'cards-main' }, [
        h('div', { class: 'search', role: 'search' }, [
          h('label', { class: 'sr', for: 'q' }, 'Chercher dans mes cartes'),
          h('input', { id: 'q', type: 'search', value: S.q, autocomplete: 'off', placeholder: 'Chercher un titre, une description, un tag  ( / )', onInput: (e) => { S.q = e.target.value; } }),
          h('label', { class: 'sr', for: 'sort' }, 'Trier'),
          h('select', { id: 'sort', value: S.sort, onChange: (e) => { S.sort = e.target.value; } }, SORTS.map(([v, l]) => h('option', { key: v, value: v }, l))),
          h('button', { class: 'btn', type: 'button', disabled: !total, onClick: selectAll }, 'Tout sélectionner'),
        ]),
        h('div', { class: 'chips rarity-filter', role: 'group', 'aria-label': 'Raretés (Ctrl/⌘+clic : n\'afficher qu\'elle)' }, RAR_UP.filter((r) => counts[r]).map((r) => h('button', {
          key: r, class: 'chip rpill', type: 'button', 'aria-pressed': String(S.rarities.includes(r)), title: `${RARITY_NAME[r]} · Ctrl/⌘+clic : n'afficher qu'elle`,
          onClick: (e) => toggleRarity(r, e),
        }, [pill(r), h('span', { class: 'chip__label' }, RARITY_NAME[r]), h('span', { class: 'n' }, fmt(counts[r]))]))),
        viewCountLine(),
        total ? h(CardGrid) : h('div', { class: 'empty-box' }, [h('p', null, 'Aucune carte ne correspond à ces filtres.'),
          h('button', { class: 'btn', type: 'button', onClick: resetFilters }, 'Réinitialiser les filtres')]),
        shown < total ? h('div', { class: 'show-more' }, [h('button', { class: 'btn', type: 'button', onClick: () => { S.limit += PAGE; } },
          `Afficher plus (${fmt(total - shown)} restantes)`)]) : null,
      ]),
    ]);
  }

  // ================================================================ rendu : onglet Mettre à jour
  function copyRow(id, value, label) {
    return h('div', { class: 'copy-row' }, [
      h('input', { id, class: 'field', readonly: true, value, 'aria-label': label, onFocus: (e) => e.target.select() }),
      h('button', { class: 'btn', type: 'button', disabled: !value, onClick: () => copy(value, id) }, [icon(S.copied === id ? 'check' : 'copy', 'sm'), S.copied === id ? 'Copié' : 'Copier']),
    ]);
  }
  function viewFavori() {
    const url = bookmarkletUrl.value;
    const hasKey = !!S.bm.importKey;
    const elsewhere = !!(S.me && S.me.has_import_key);
    let button;
    if (!hasKey) {
      button = h('div', { class: 'notice' }, [
        h('p', null, "Pour fabriquer ton favori, le classeur crée une clé d'import : elle ne sert qu'à envoyer des cartes, jamais à ouvrir ton classeur."),
        elsewhere ? h('p', { class: 'warn' }, 'Tu as déjà un favori (sur un autre navigateur, ou avant que celui-ci ne l\'oublie) : en créer un ici le remplace, et l\'ancien cessera de marcher.') : null,
        h('button', { class: 'btn primary', type: 'button', disabled: S.bm.busy, onClick: createImportKey }, S.bm.busy ? 'Création…' : elsewhere ? 'Créer un nouveau favori' : 'Créer mon favori'),
        errLine(S.bm.error),
      ]);
    } else if (url) {
      button = h('p', { class: 'bm-line' }, [h('a', { class: 'bookmarklet', href: url, title: 'Glisse-moi dans ta barre de favoris',
        onClick: (e) => { e.preventDefault(); S.bm.clicked = true; } }, [icon('bookmark'), 'Classeur WikiMasters'])]);
    } else button = S.bm.error ? errLine(S.bm.error) : h('p', { class: 'muted', role: 'status' }, 'Préparation du favori…');
    return h('div', { class: 'panel' }, [
      h('h2', null, 'Le favori, le chemin conseillé'),
      h('p', null, "Sur wiki-masters.com, un clic sur le favori lit ta collection (comme la page « Collection » du jeu) et l'envoie à ton classeur. Il se sert de ta session dans ton navigateur : rien à copier, rien qui expire. Il ne fait que lire : rien n'est écrit dans le jeu."),
      h('ol', { class: 'steps' }, [h('li', null, 'Glisse ce bouton dans ta barre de favoris :')]),
      button,
      S.bm.clicked ? h('p', { class: 'warn', role: 'status' }, 'Pas ici : glisse le bouton dans ta barre de favoris, puis clique-le sur wiki-masters.com.') : null,
      h('ol', { class: 'steps', start: 2 }, [
        h('li', null, 'Ouvre wiki-masters.com, avec ta session ouverte.'),
        h('li', null, 'Clique le favori : un encart montre la lecture, puis le nombre de cartes envoyées. Reviens ici : le classeur se met à jour.'),
      ]),
      h('p', { class: 'small muted' }, ['Barre de favoris cachée ? ', h('kbd', null, 'Ctrl'), '+', h('kbd', null, 'Maj'), '+', h('kbd', null, 'B'),
        ' (', h('kbd', null, '⌘'), '+', h('kbd', null, 'Maj'), '+', h('kbd', null, 'B'), ' sur Mac).']),
      hasKey ? h('h3', null, 'Le créer à la main') : null,
      hasKey ? h('p', { class: 'small muted' }, "Sur téléphone, ou si le glisser ne marche pas : crée un favori sur n'importe quelle page, nomme-le « Classeur », et remplace son adresse par ceci. Sur téléphone, tape ensuite « Classeur » dans la barre d'adresse sur wiki-masters.com et choisis le favori.") : null,
      hasKey ? copyRow('bm-url', url, 'Adresse du favori') : null,
      hasKey ? h('p', { class: 'small muted' }, "Le favori contient sa clé d'import : quelqu'un qui l'aurait pourrait envoyer des cartes dans ton classeur, sans pouvoir l'ouvrir. Ne le partage pas ; s'il a fuité, régénère-le dans les Réglages.") : null,
    ]);
  }
  function viewCookie() {
    const ss = S.session;
    const sess = (S.me && S.me.session) || {};
    const noSecret = !!(S.health && S.health.cookie_secret === false);
    const off = noSecret || ss.busy;
    const dot = !sess.has_cookie ? '' : sess.expired ? 'off' : 'on';
    const label = !sess.has_cookie ? 'Pas de session WikiMasters enregistrée'
      : sess.expired ? 'Session WikiMasters expirée' : 'Session WikiMasters enregistrée' + (sess.updated_at ? ' le ' + dateDay(sess.updated_at) : '');
    return h('div', { class: 'panel' }, [
      h('h2', null, sess.expired ? 'Ta session WikiMasters a expiré' : 'En secours : ton cookie WikiMasters'),
      h('p', { class: 'session-line' }, [h('span', { class: ['dot', dot] }), label]),
      h('p', null, "Le classeur garde alors ta session chiffrée et s'en sert pour lire ta collection quand tu cliques « Rafraîchir la collection »."),
      h('p', { class: 'notice warn-box' }, 'Le jeu renouvelle ta session régulièrement : le rafraîchissement par cookie marche en général environ une heure après le collage, et peut te déconnecter du jeu dans ton navigateur. Le favori n\'a pas ce problème.'),
      noSecret ? h('p', { class: 'warn' }, "Le collage du cookie est désactivé sur ce classeur : l'administrateur n'a pas encore réglé sa clé de chiffrement (COOKIE_SECRET). Utilise le favori.") : null,
      h('ol', { class: 'steps' }, [
        h('li', null, ['Sur wiki-masters.com, avec ta session ouverte, ouvre les outils de développement (', h('kbd', null, 'F12'), '), onglet Réseau, puis recharge ta page Collection.']),
        h('li', null, ['Clique la requête ', h('code', null, 'my-collection'), ', puis dans les en-têtes de la requête, copie la valeur de ', h('code', null, 'Cookie'), '.']),
      ]),
      h('label', { class: 'sr', for: 'cookie-input' }, 'Valeur de l\'en-tête Cookie'),
      h('textarea', { id: 'cookie-input', rows: 3, value: ss.cookie, disabled: off, spellcheck: 'false', autocomplete: 'off',
        placeholder: 'sb-…-auth-token.0=…; sb-…-auth-token.1=…', onInput: (e) => { ss.cookie = e.target.value; } }),
      h('label', { class: ['drop', { disabled: noSecret }] }, [h('strong', null, 'Ou dépose un export HAR'), h('span', { class: 'muted' }, 'fichier .har de l\'onglet Réseau, ou clique pour le choisir'),
        h('input', { type: 'file', accept: '.har,application/json', disabled: off, onChange: uploadHar })]),
      h('p', { class: 'small muted' }, "Du fichier HAR, seuls l'adresse et le cookie des requêtes vers wiki-masters.com sont envoyés ; le reste ne quitte pas ton navigateur. Dans Chrome ou Edge, l'export par défaut retire les cookies : choisis l'export « avec données sensibles »."),
      errLine(ss.error),
      h('div', { class: 'actions' }, [
        h('button', { class: 'btn', type: 'button', disabled: off || !ss.cookie.trim(), onClick: submitCookie }, ss.busy ? 'Enregistrement…' : 'Enregistrer le cookie et rafraîchir'),
        sess.has_cookie ? h('button', { class: 'btn danger', type: 'button', disabled: ss.busy, onClick: forgetSession }, 'Oublier la session') : null,
      ]),
    ]);
  }
  function viewUpdate() {
    return h('div', { class: 'update' }, [viewFavori(), viewCookie()]);
  }

  // ================================================================ rendu : onglet Réglages
  function knownLabel(k) { return k.name ? `Classeur de ${k.name}` : 'Classeur sans prénom'; }
  function viewSettings() {
    const st = S.settings;
    const others = S.known.filter((k) => k.key !== S.key);
    const section = (title, kids, cls) => h('section', { class: ['panel', cls || ''] }, [h('h2', null, title), ...kids]);
    return h('div', { class: 'settings' }, [
      section('Ton prénom', [
        h('form', { class: 'line', onSubmit: (e) => { e.preventDefault(); saveName(); } }, [
          h('label', { class: 'sr', for: 'set-name' }, 'Ton prénom'),
          h('input', { id: 'set-name', class: 'field', value: st.name, maxlength: 60, autocomplete: 'given-name', onInput: (e) => { st.name = e.target.value; st.saved = false; } }),
          h('button', { class: 'btn', type: 'submit', disabled: st.busy }, st.busy ? 'Enregistrement…' : 'Enregistrer'),
        ]),
        st.saved ? h('p', { class: 'status ok', role: 'status' }, 'Enregistré.') : null,
        errLine(st.error),
      ]),
      section('Ton lien personnel', [
        h('p', null, "C'est la clé de ton classeur : il l'ouvre sur n'importe quel appareil, sans mot de passe. Garde-le pour toi (dans tes favoris ou un gestionnaire de mots de passe) et ne le partage pas."),
        copyRow('my-link', personalLink.value, 'Ton lien personnel'),
        h('p', { class: 'small muted' }, "Un lien ouvert reste dans l'historique du navigateur : sur un appareil partagé, efface-le de l'historique, ou change ta clé."),
        h('div', { class: 'actions' }, [h('button', { class: 'btn', type: 'button', onClick: askRotate }, [icon('key', 'sm'), 'Changer ma clé'])]),
      ]),
      section('Le favori', [
        h('p', null, "Pour envoyer ta collection au classeur depuis wiki-masters.com, en un clic. Il a sa propre clé, qui ne sert qu'à envoyer des cartes."),
        h('div', { class: 'actions' }, [
          h('button', { class: 'btn', type: 'button', onClick: openFavori }, [icon('bookmark', 'sm'), 'Installer le favori']),
          S.me && S.me.has_import_key ? h('button', { class: 'btn', type: 'button', onClick: askRegenerate }, [icon('refresh', 'sm'), 'Régénérer le favori']) : null,
        ]),
      ]),
      others.length ? section('Autres classeurs ouverts dans ce navigateur', [
        h('ul', { class: 'known' }, others.map((k) => h('li', { key: k.key, class: 'line' }, [
          h('span', { class: 'known-name' }, knownLabel(k)),
          h('button', { class: 'btn small', type: 'button', onClick: () => switchTo(k.key) }, 'Ouvrir'),
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Retirer de la liste : ' + knownLabel(k), onClick: () => forgetKnown(k.key) }, 'Retirer'),
        ]))),
      ]) : null,
      section('Ce navigateur', [
        h('p', null, "Sur un appareil partagé, fais-lui oublier ta clé et tout ce qu'il garde du classeur. Ton classeur reste intact : ton lien le rouvre."),
        h('div', { class: 'actions' }, [h('button', { class: 'btn', type: 'button', onClick: askForget }, 'Oublier ce navigateur')]),
      ]),
      section('Supprimer mon classeur', [
        h('p', null, 'Efface définitivement tes cartes rangées, tes tags, tes collections et ta session WikiMasters.'),
        h('div', { class: 'actions' }, [h('button', { class: 'btn danger', type: 'button', onClick: askDeleteAccount }, [icon('trash', 'sm'), 'Supprimer mon classeur'])]),
      ], 'danger-zone'),
    ]);
  }

  // ================================================================ rendu : contenu, bande de sélection
  function viewMain() {
    let panel;
    if (S.tab === 'cartes') panel = viewCards();
    else if (S.tab === 'maj') panel = viewUpdate();
    else if (S.tab === 'reglages') panel = viewSettings();
    else panel = S.album ? viewAlbum() : viewCollections();
    return h('main', { class: 'wrap', id: 'main' }, [
      h('section', { id: 'panel-' + S.tab, role: 'tabpanel', 'aria-labelledby': 'tab-' + S.tab, key: S.tab }, [panel]),
    ]);
  }
  function viewBulk() {
    const n = S.selected.size;
    if (!n) return null;
    return h('div', { class: 'bulk', role: 'region', 'aria-label': 'Actions sur la sélection' }, [
      h('span', { class: 'count' }, fmt(n)), h('span', null, plural(n, 'sélectionnée', 'sélectionnées')),
      h('label', { class: 'sr', for: 'bulk-tag' }, 'Tag à ajouter ou à retirer'),
      h('input', { id: 'bulk-tag', class: 'field', list: 'taglist', value: S.bulkTag, maxlength: 40, autocomplete: 'off', placeholder: 'Tag à ajouter ou retirer…',
        onInput: (e) => { S.bulkTag = e.target.value; }, onKeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); bulk('add'); } } }),
      h('button', { class: 'btn primary', type: 'button', disabled: S.bulkBusy || !S.bulkTag.trim(), onClick: () => bulk('add') }, 'Ajouter'),
      h('button', { class: 'btn', type: 'button', disabled: S.bulkBusy || !S.bulkTag.trim(), onClick: () => bulk('remove') }, 'Retirer'),
      h('button', { class: 'btn ghost', type: 'button', onClick: clearSelection }, 'Vider la sélection'),
      errLine(S.bulkError),
    ]);
  }

  // ================================================================ rendu : fiche d'une carte
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function trapTab(e, box) {
    if (e.key !== 'Tab' || !box) return;
    const list = [...box.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (!list.length) { e.preventDefault(); return; }
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function viewSuggestions(c) {
    const list = suggestionsFor(c);
    const busy = S.sugg.cardBusy === c.title;
    let body;
    if (busy) body = [h('p', { class: 'small muted', role: 'status' }, 'Recherche sur Wikidata…')];
    else if (S.sugg.cardError && S.sugg.cardErrorFor === c.title) {
      body = [errLine(S.sugg.cardError), h('button', { class: 'btn small', type: 'button', onClick: () => loadCardSuggestions(c) }, 'Réessayer')];
    } else if (list == null) body = [h('button', { class: 'btn small', type: 'button', onClick: () => loadCardSuggestions(c) }, 'Chercher des suggestions')];
    else if (!list.length) body = [h('p', { class: 'small muted' }, 'Pas d\'autre suggestion pour cette carte.')];
    else {
      body = [
        h('div', { class: 'tags' }, list.map((t) => h('button', { key: t, class: 'tag auto', type: 'button', title: 'Ajouter ce tag', disabled: S.drawer.busy,
          onClick: () => setTags(c, addTo(c.tags, t)) }, [icon('plus', 'sm'), t]))),
        h('div', null, [h('button', { class: 'btn small', type: 'button', disabled: S.drawer.busy, onClick: () => setTags(c, list.reduce(addTo, c.tags)) }, [icon('check', 'sm'), 'Valider les suggestions'])]),
      ];
    }
    return h('div', { class: 'sugg' }, [h('h3', null, ['Suggestions ', h('span', { class: 'hint-inline' }, "d'après Wikidata")]), ...body]);
  }
  function fact(label, value) { return h('div', { class: 'fact' }, [h('span', null, label), h('b', null, value)]); }
  function viewFiche(c, closeRef, boxRef) {
    const member = membershipsOf(c);
    const mine = member.filter((m) => m.kind === 'target');
    const prop = member.filter((m) => m.kind === 'catalog');
    const goto = (col) => { closeCard(); openAlbum(col.kind, col.id); };
    const memberList = (list) => h('div', { class: 'memberships' }, list.map((col) => {
      const p = progressOf(col);
      return h('button', { key: col.key, type: 'button', onClick: () => goto(col) }, [col.name, h('span', null, `${fmt(p.own)} / ${fmt(p.total)}`)]);
    }));
    return h('div', { class: 'sheet fiche', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'detail-title', tabindex: '-1', ref: boxRef,
      onKeydown: (e) => trapTab(e, boxRef.value) }, [
      h('button', { class: 'close', type: 'button', ref: closeRef, 'aria-label': 'Fermer la fiche', onClick: closeCard }, [icon('x')]),
      viewCard(c, true),
      h('div', { class: 'info' }, [
        h('h2', { id: 'detail-title' }, c.title),
        c.category ? h('p', { class: 'muted lead' }, c.category) : null,
        h('div', { class: 'facts' }, [
          fact('Rareté', RARITY_NAME[c.rarity] || c.rarity || '?'),
          fact('Vues par mois', fmt(c.pageviews)),
          fact('Obtenue le', dateOf(c.obtained_at) ? dateOf(c.obtained_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '?'),
          fact('Exemplaires', fmt(c.count || 1) + (c.shiny ? ' · brillante' : '')),
          c.quality != null ? fact('Qualité', NUM2.format(c.quality)) : null,
          c.starred ? fact('Favorite', 'oui, dans le jeu') : null,
        ]),
        h('div', null, [
          h('h3', null, 'Tes tags'),
          h('div', { class: 'tags' }, c.tags.length ? c.tags.map((t) => h('span', { class: 'tag own', key: t }, [t,
            h('button', { type: 'button', class: 'x', 'aria-label': 'Retirer le tag ' + t, disabled: S.drawer.busy, onClick: () => setTags(c, c.tags.filter((x) => x !== t)) }, [icon('x', 'sm')])]))
            : [h('span', { class: 'small muted' }, "Aucun tag pour l'instant.")]),
          h('form', { class: 'add-row', onSubmit: (e) => { e.preventDefault(); addTag(c); } }, [
            h('label', { class: 'sr', for: 'new-tag' }, 'Ajouter un tag'),
            h('input', { id: 'new-tag', class: 'field', list: 'taglist', value: S.drawer.newTag, maxlength: 40, autocomplete: 'off', placeholder: 'Ajouter un tag…',
              onInput: (e) => { S.drawer.newTag = e.target.value; } }),
            h('button', { class: 'btn primary', type: 'submit', disabled: S.drawer.busy || !S.drawer.newTag.trim() }, 'Ajouter'),
          ]),
          errLine(S.drawer.error),
        ]),
        viewSuggestions(c),
        mine.length ? h('div', null, [h('h3', null, 'Dans tes collections'), memberList(mine)]) : null,
        prop.length ? h('div', null, [h('h3', null, 'Dans les collections proposées'), memberList(prop)]) : null,
        h('div', null, [h('a', { href: c.url || wikiUrl(c.title), target: '_blank', rel: 'noopener noreferrer' }, "Lire l'article sur Wikipédia ↗")]),
      ]),
    ]);
  }

  // ================================================================ rendu : fenêtres
  let modalSeq = 0;
  const Modal = {
    name: 'Modal',
    props: { title: String, wide: Boolean, onClose: Function },
    setup(props, { slots }) {
      const box = ref(null);
      const id = 'modal-title-' + ++modalSeq;
      let before = null;
      let downOnVeil = false;
      onMounted(() => {
        before = document.activeElement;
        nextTick(() => {
          const el = box.value;
          if (!el) return;
          const field = el.querySelector('input:not([disabled]):not([readonly]):not([type="file"]), textarea:not([disabled]):not([readonly]), select:not([disabled])');
          (field || el).focus();
        });
      });
      onBeforeUnmount(() => { if (before && before.focus && document.contains(before)) before.focus(); });
      return () => h('div', {
        class: 'overlay',
        onPointerdown: (e) => { downOnVeil = e.target === e.currentTarget; },
        onClick: (e) => { if (downOnVeil && e.target === e.currentTarget && props.onClose) props.onClose(); downOnVeil = false; },
      }, [
        h('div', { class: ['modal', { wide: props.wide }], role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id, tabindex: '-1', ref: box, onKeydown: (e) => trapTab(e, box.value) }, [
          h('div', { class: 'modal-head' }, [
            h('h2', { id }, props.title),
            h('button', { class: 'close', type: 'button', 'aria-label': 'Fermer', onClick: () => props.onClose && props.onClose() }, [icon('x')]),
          ]),
          ...(slots.default ? slots.default() : []),
        ]),
      ]);
    },
  };
  const foot = (kids) => h('div', { class: 'foot' }, kids);
  const closeBtn = (label) => h('button', { class: 'btn ghost', type: 'button', onClick: closeModal }, label || 'Fermer');

  // ---------------------------------------------------------------- fenêtres gardées (collection, tag, confirmation, autre classeur, nouveau lien)
  function modalEditor() {
    const ed = S.editor;
    if (!ed) return null;
    const lines = ed.text.split('\n').filter((l) => l.trim()).length;
    return h(Modal, { key: 'editor', title: ed.id ? 'Modifier la collection' : 'Nouvelle collection à compléter', onClose: closeModal }, () => [
      h('label', { class: 'sr', for: 'ed-name' }, 'Nom de la collection'),
      h('input', { id: 'ed-name', class: 'field full', value: ed.name, maxlength: 120, autocomplete: 'off', placeholder: "Nom, par exemple Dieux de l'Olympe",
        onInput: (e) => { ed.name = e.target.value; } }),
      h('p', { class: 'note' }, 'Un article Wikipédia par ligne : son titre exact (« Zeus ») ou son adresse fr.wikipedia.org. Chaque article est vérifié sur Wikipédia.'),
      h('label', { class: 'sr', for: 'ed-text' }, 'Articles, un par ligne'),
      h('textarea', { id: 'ed-text', class: 'field full', rows: 12, value: ed.text, spellcheck: 'false',
        placeholder: 'Zeus\nHéra\nhttps://fr.wikipedia.org/wiki/Poséidon', onInput: (e) => { ed.text = e.target.value; ed.issues = null; } }),
      h('p', { class: 'note' }, `${fmt(lines)} ${plural(lines, 'ligne', 'lignes')} · 3 000 articles au plus`),
      ed.progress ? h('p', { class: 'progress-msg', role: 'status' }, ed.progress) : null,
      ed.issues ? h('div', { class: 'panel' }, [
        h('p', { class: 'warn' }, `${fmt(ed.issues.length)} ${plural(ed.issues.length, 'article pose', 'articles posent')} problème :`),
        h('ul', { class: 'issues' }, ed.issues.slice(0, 300).map((i) => h('li', { key: i.title },
          `${i.title} : ${i.status === 'missing' ? 'introuvable sur Wikipédia' : "page d'homonymie, précise le titre"}`))),
        h('p', { class: 'note' }, 'Corrige ces lignes, ou enregistre quand même : leurs cases vides le signaleront.'),
      ]) : null,
      errLine(ed.error),
      foot([
        closeBtn('Annuler'),
        ed.issues ? h('button', { class: 'btn', type: 'button', disabled: ed.busy, onClick: () => saveEditor(ed, true) }, 'Enregistrer quand même') : null,
        h('button', { class: 'btn primary', type: 'button', disabled: ed.busy || !ed.name.trim() || !ed.text.trim(), onClick: () => saveEditor(ed, false) },
          ed.busy ? 'Vérification…' : 'Enregistrer'),
      ]),
    ]);
  }
  function modalTag() {
    const te = S.tagEdit;
    if (!te) return null;
    const n = tagCount.value.get(te.from) || 0;
    return h(Modal, { key: 'tag', title: `Le tag « ${te.from} »`, onClose: closeModal }, () => [
      h('p', null, `${cards$(n)} ${plural(n, 'porte', 'portent')} ce tag.`),
      h('form', { class: 'copy-row', onSubmit: (e) => { e.preventDefault(); renameTag(te); } }, [
        h('label', { class: 'sr', for: 'tag-to' }, 'Nouveau nom du tag'),
        h('input', { id: 'tag-to', class: 'field', value: te.to, maxlength: 40, autocomplete: 'off', onInput: (e) => { te.to = e.target.value; } }),
        h('button', { class: 'btn primary', type: 'submit', disabled: te.busy || !te.to.trim() }, 'Renommer'),
      ]),
      h('p', { class: 'note' }, 'Si un tag porte déjà ce nom, les deux sont fusionnés.'),
      errLine(te.error),
      foot([
        h('button', { class: ['btn', 'danger', 'left', { solid: te.confirmDelete }], type: 'button', disabled: te.busy, onClick: () => deleteTag(te) },
          te.confirmDelete ? `Confirmer : le retirer de ${cards$(n)}` : [icon('trash', 'sm'), 'Supprimer ce tag']),
        closeBtn(),
      ]),
    ]);
  }
  function modalConfirm() {
    const cf = S.confirm;
    if (!cf) return null;
    return h(Modal, { key: 'confirm', title: cf.title, onClose: closeModal }, () => [
      h('p', null, cf.text),
      cf.progress ? h('p', { class: 'progress-msg', role: 'status' }, cf.progress) : null,
      errLine(cf.error),
      foot([
        closeBtn('Annuler'),
        h('button', { class: ['btn', cf.danger ? 'danger solid' : 'primary'], type: 'button', disabled: cf.busy, onClick: () => runConfirm(cf) }, cf.busy ? 'Un instant…' : cf.ok),
      ]),
    ]);
  }
  // Lien d'un autre classeur ouvert alors qu'une clé est déjà gardée : on demande.
  function modalSwitch() {
    const ask = S.switchAsk;
    if (!ask) return null;
    const who = ask.name ? `de ${ask.name}` : "d'une autre personne";
    const mine = ask.mine ? `celui de ${ask.mine}` : 'le tien';
    const keep = () => { S.switchAsk = null; closeModal(); };
    return h(Modal, { key: 'switch', title: 'Un autre classeur', onClose: keep }, () => [
      h('p', null, `Ce lien ouvre le classeur ${who}. Ouvrir le classeur ${who} à la place du tien ?`),
      h('p', { class: 'note' }, `Ce navigateur se souviendra des deux : tu pourras revenir à ${mine} depuis les Réglages.`),
      foot([
        h('button', { class: 'btn', type: 'button', onClick: keep }, 'Garder le mien'),
        h('button', { class: 'btn primary', type: 'button', onClick: () => { S.switchAsk = null; remember(ask.key, ask.name); switchTo(ask.key); } }, 'Ouvrir'),
      ]),
    ]);
  }
  // Nouveau lien après « Changer ma clé ».
  function modalLink() {
    return h(Modal, { key: 'link', title: 'Ton nouveau lien personnel', onClose: closeModal }, () => [
      h('p', null, "Ta clé a changé : l'ancien lien ne marche plus. Garde celui-ci à la place (favoris, gestionnaire de mots de passe), et ouvre-le sur tes autres appareils."),
      copyRow('new-key-link', S.newLink, 'Ton nouveau lien personnel'),
      h('p', { class: 'warn' }, 'Garde-le pour toi : quiconque a ce lien ouvre ton classeur.'),
      foot([closeBtn("C'est noté")]),
    ]);
  }

  const MODALS = { editor: modalEditor, confirm: modalConfirm, tag: modalTag, switch: modalSwitch, link: modalLink };

  // ================================================================ rendu : accueil
  function viewWelcome() {
    const w = S.welcome;
    const hl = S.health;
    const notConfigured = !!(hl && hl.db === false);
    const known = S.known.filter((k) => k.key !== S.key);
    const closed = !!(hl && hl.signup_open === false);
    const head = h('header', { class: 'top' }, [h('div', { class: 'wrap' }, [h('div', { class: 'headline' }, [
      h('div', null, [h('p', { class: 'eyebrow' }, 'Collections WikiMasters'), h('h1', null, 'Le classeur')]),
      h('p', { class: 'note' }, 'Ta collection WikiMasters rangée hors du jeu : tes cartes avec tes tags, des collections à compléter, la rareté estimée des cartes qui te manquent. Outil personnel, sans lien avec le jeu.'),
    ])])]);
    let body;
    if (w.created) {
      body = [h('section', { class: 'panel narrow' }, [
        h('h2', null, w.created.name ? `Ton classeur est prêt, ${w.created.name}.` : 'Ton classeur est prêt.'),
        h('p', null, "Voici ton lien personnel. C'est la clé de ton classeur : il l'ouvre sur n'importe quel appareil, sans mot de passe."),
        copyRow('new-link', w.created.link, 'Ton lien personnel'),
        h('p', { class: 'notice' }, [h('strong', null, 'Garde-le pour toi.'), ' Quiconque a ce lien ouvre ton classeur. Range-le dans tes favoris ou un gestionnaire de mots de passe, et ne le partage pas : sans lui, tu ne pourras pas revenir depuis un autre navigateur.']),
        S.keyNotSaved ? h('p', { class: 'status err' }, 'Ce navigateur refuse de garder ta clé : sans ton lien, tu ne retrouveras pas ton classeur.') : null,
        h('div', { class: 'actions' }, [h('button', { class: 'btn primary', type: 'button', onClick: () => { S.welcome.created = null; boot(); } }, "C'est noté, ouvrir mon classeur")]),
      ])];
    } else {
      const create = closed
        ? h('section', { class: 'panel' }, [h('h2', null, 'Créer un classeur'), h('p', null, 'Les inscriptions sont fermées : demande un lien à la personne qui gère le classeur.')])
        : h('form', { class: 'panel', onSubmit: (e) => { e.preventDefault(); createAccount(); } }, [
          h('h2', null, 'Créer mon classeur'),
          h('p', { class: 'muted' }, "Il te faut le code d'invitation donné par la personne qui gère le classeur."),
          h('label', { class: 'field' }, [h('span', null, "Code d'invitation"), h('input', { value: w.code, autocomplete: 'off', spellcheck: 'false', required: true,
            onInput: (e) => { w.code = e.target.value; } })]),
          h('label', { class: 'field' }, [h('span', null, 'Ton prénom (facultatif)'), h('input', { value: w.name, maxlength: 60, autocomplete: 'given-name',
            onInput: (e) => { w.name = e.target.value; } })]),
          errLine(w.error),
          h('div', { class: 'actions' }, [h('button', { class: 'btn primary', type: 'submit', disabled: w.busy }, w.busy ? 'Création…' : 'Créer mon classeur')]),
        ]);
      const link = h('form', { class: 'panel', onSubmit: (e) => { e.preventDefault(); useLink(); } }, [
        h('h2', null, "J'ai déjà un lien"),
        h('p', { class: 'muted' }, 'Ouvre ton lien personnel, ou colle-le ici.'),
        h('label', { class: 'field' }, [h('span', null, 'Ton lien personnel'), h('input', { value: w.link, autocomplete: 'off', spellcheck: 'false', placeholder: location.origin + '/#cle=…',
          onInput: (e) => { w.link = e.target.value; } })]),
        errLine(w.linkError),
        h('div', { class: 'actions' }, [h('button', { class: 'btn', type: 'submit' }, 'Ouvrir mon classeur')]),
      ]);
      body = [
        S.linkError ? h('div', { class: 'notice error', role: 'alert' }, [h('p', null, S.linkError)]) : null,
        S.bootError ? h('div', { class: 'notice error', role: 'alert' }, [
          h('p', null, S.bootError), S.bootHint ? h('p', null, S.bootHint) : null,
          S.key ? h('button', { class: 'btn small', type: 'button', onClick: dropStaleKey }, 'Oublier cette clé') : null,
        ]) : null,
        S.healthError ? h('div', { class: 'notice error', role: 'alert' }, [h('p', null, S.healthError),
          h('button', { class: 'btn small', type: 'button', onClick: () => boot() }, 'Réessayer')]) : null,
        known.length ? h('section', { class: 'panel' }, [
          h('h2', null, 'Classeurs ouverts dans ce navigateur'),
          h('ul', { class: 'known' }, known.map((k) => h('li', { key: k.key, class: 'line' }, [h('span', { class: 'known-name' }, knownLabel(k)),
            h('button', { class: 'btn small', type: 'button', onClick: () => switchTo(k.key) }, 'Ouvrir')]))),
        ]) : null,
        notConfigured ? h('section', { class: 'panel' }, [
          h('h2', null, "Le classeur n'est pas encore configuré"),
          h('p', null, "L'administrateur doit lier la base de données D1 au projet Cloudflare Pages (voir SETUP.md), puis redéployer le site."),
        ]) : h('div', { class: 'welcome-grid' }, [create, link]),
        h('p', { class: 'small muted' }, "Le classeur lit ta collection seulement quand tu le demandes, comme la page « Collection » du jeu. Il ne joue jamais à ta place et n'écrit rien dans le jeu."),
      ];
    }
    return h('div', { class: 'welcome' }, [head, h('main', { class: 'wrap welcome-main' }, body)]);
  }

  // ================================================================ composants
  const Top = { name: 'Top', setup: () => viewTop };
  const Main = { name: 'Main', setup: () => viewMain };
  const Cell = { name: 'Cell', props: { card: Object }, setup: (props) => () => viewCell(props.card) };
  const CardGrid = {
    name: 'CardGrid',
    setup: () => () => h('div', { class: ['cardgrid', { selecting: S.selected.size > 0 }] }, visibleCards.value.map((c) => h(Cell, { key: c.id, card: c }))),
  };
  const AlbumGrid = {
    name: 'AlbumGrid',
    setup: () => () => {
      const col = activeAlbum.value;
      return h('div', { class: ['cardgrid', { selecting: S.selected.size > 0 }] }, visibleSlots.value.map((s) => (s.card ? h(Cell, { key: s.key, card: s.card }) : viewSlot(s, col))));
    },
  };
  const BulkBar = { name: 'BulkBar', setup: () => () => h(Transition, { name: 'rise' }, () => viewBulk()) };
  const Fiche = {
    name: 'Fiche',
    setup() {
      const closeRef = ref(null);
      const boxRef = ref(null);
      let downOnVeil = false;
      watch(() => S.openId, (id, old) => { if (id && !old) nextTick(() => { if (closeRef.value) closeRef.value.focus(); }); });
      return () => h(Transition, { name: 'fade' }, () => (openCard.value ? h('div', {
        class: 'overlay', key: 'fiche',
        onPointerdown: (e) => { downOnVeil = e.target === e.currentTarget; },
        onClick: (e) => { if (downOnVeil && e.target === e.currentTarget) closeCard(); downOnVeil = false; },
      }, [viewFiche(openCard.value, closeRef, boxRef)]) : null));
    },
  };
  const Modals = { name: 'Modals', setup: () => () => h(Transition, { name: 'fade' }, () => (S.modal && MODALS[S.modal] ? MODALS[S.modal]() : null)) };
  const Notice = {
    name: 'Notice',
    setup: () => () => h(Transition, { name: 'fade' }, () => (S.notice ? h('div', { key: S.notice.id, class: ['toast', { error: S.notice.error }], role: S.notice.error ? 'alert' : 'status' }, [
      h('span', null, S.notice.text),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Fermer le message', onClick: () => { S.notice = null; } }, [icon('x')]),
    ]) : null)),
  };
  const TagList = { name: 'TagList', setup: () => () => h('datalist', { id: 'taglist' }, tagList.value.map((t) => h('option', { key: t.name, value: t.name }))) };
  const Welcome = { name: 'Welcome', setup: () => viewWelcome };

  function onKey(e) {
    if (S.boot !== 'app') return;
    if (e.key === 'Escape') {
      if (S.modal) { e.preventDefault(); closeModal(); return; }
      if (S.openId) { e.preventDefault(); closeCard(); return; }
      return;
    }
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (e.key === '/' && S.tab === 'cartes' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag) && !S.modal && !S.openId) {
      const q = document.getElementById('q');
      if (q) { e.preventDefault(); q.focus(); }
    }
  }
  async function onVisible() {
    if (document.visibilityState !== 'visible' || S.boot !== 'app' || S.refresh.running) return;
    const before = S.me && S.me.fetched_at;
    try { await loadMe(); } catch (e) { return; }
    if (S.me && S.me.fetched_at && S.me.fetched_at !== before) {
      try {
        await loadCards();
        notify(`Collection mise à jour : ${cards$(cards.value.length)}.`);
        startPageviews();
      } catch (e) { notify(e.message, true); }
    }
  }

  const Root = {
    name: 'Classeur',
    setup() {
      onMounted(() => {
        window.addEventListener('keydown', onKey);
        window.addEventListener('hashchange', () => { const k = takeHashKey(); if (k != null) boot(k); });
        document.addEventListener('visibilitychange', onVisible);
        boot(LINK_KEY);
      });
      return () => {
        let main;
        if (S.boot === 'loading') main = h('p', { class: 'boot', role: 'status' }, 'Ouverture du classeur…');
        else if (S.boot === 'welcome') main = h(Welcome);
        else main = h('div', { class: 'app' }, [h(Top), h(Main), h(BulkBar), h(Fiche), h(Modals), h(TagList)]);
        return [main, h(Notice)];
      };
    },
  };

  watch([() => S.q, () => S.sort, () => S.rarities.join(), () => S.tagFilter.join('\u0001'), () => S.untaggedOnly, () => S.newOnly], () => { S.limit = PAGE; });
  watch([() => S.albumFilter, () => S.albumSort], () => { S.albumLimit = ALBUM_PAGE; });
  // Collection ouverte (ou catalogue arrivé après coup) : vues sur 30 jours des articles qui manquent.
  watch(() => (activeAlbum.value ? activeAlbum.value.key + ':' + activeAlbum.value.items.length : ''), () => startPageviews());

  createApp(Root).mount('#app');
})();
