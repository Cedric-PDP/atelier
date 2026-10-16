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
    importKey: 'classeur-import-key', known: 'classeur-known', natGroup: 'classeur-natgroup', tagCats: 'classeur-tagcats', proposeAt: 'classeur-propose-at',
    chatRead: 'classeur-chat-lu' };
  // Clé du classeur : 32 octets en base64url (43 caractères). Un lien plus court a été tronqué.
  const KEY_RE = /^[A-Za-z0-9_-]{43,128}$/;
  const DAY = 864e5;
  const WP_API = 'https://fr.wikipedia.org/w/api.php';
  // Le marché du jeu ne lit aucune recherche dans son adresse (2026-10-15 : sa recherche n'appelle que
  // GET /api/marketplace?q=…, doc de qpautrat/wikimasters-cli) et remplir son champ serait agir à la place du joueur :
  // le classeur propose seulement de copier le nom de la carte (copyNameButton), que le joueur colle lui-même.
  const SPARQL = 'https://query.wikidata.org/sparql';
  // Natures Wikidata qui ne disent rien du sujet : être humain (remplacé par le métier), pages techniques.
  const SKIP_NATURES = new Set(['Q5', 'Q4167410', 'Q22808320', 'Q13406463', 'Q4167836', 'Q11266439']);
  const TAXON = 'Q16521';
  // Tags à deux niveaux au plus : « Catégorie/Sous-catégorie ». Une étiquette sans « / » est rangée dans « Autres ».
  const TAG_CATS = ['Pays', 'Métiers', 'Lieux', 'Culture et œuvres', 'Sciences et nature', 'Histoire et événements', 'Organisations', 'Autres'];
  const OTHER = 'Autres';
  // Groupe d'une nature Wikidata, d'après ses superclasses (P279*), dans cet ordre de priorité.
  const NATURE_GROUPS = [
    ['Lieux', ['Q2221906', 'Q17334923', 'Q618123', 'Q811979', 'Q41176']],
    ['Culture et œuvres', ['Q17537576', 'Q838948', 'Q2188189', 'Q7725634', 'Q11424', 'Q7889', 'Q5398426', 'Q215380']],
    ['Sciences et nature', ['Q16521', 'Q6999', 'Q11344', 'Q12136']],
    ['Histoire et événements', ['Q1656682', 'Q1190554', 'Q178561', 'Q27020041']],
    ['Organisations', ['Q43229']],
  ];
  const COUNTRY_CLASSES = ['Q6256', 'Q3624078'];
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
// Étiquette nettoyée : espaces, un seul « / » (deux niveaux au plus), 60 caractères au plus.
  const cleanTag = (t) => {
    let x = String(t || '').replace(/\s+/g, ' ').trim();
    const i = x.indexOf('/');
    if (i >= 0) {
      const cat = x.slice(0, i).trim();
      const sub = x.slice(i + 1).replace(/\//g, ' ').replace(/\s+/g, ' ').trim();
      x = cat && sub ? cat + '/' + sub : sub || cat;
    }
    return x.slice(0, 60);
  };
  const splitTag = (t) => {
    const i = String(t).indexOf('/');
    return i > 0 && i < t.length - 1 ? { cat: t.slice(0, i), sub: t.slice(i + 1) } : { cat: null, sub: String(t) };
  };
  const tagCat = (t) => splitTag(t).cat || OTHER;
  const tagSub = (t) => splitTag(t).sub;
  const tagTitle = (t) => { const p = splitTag(t); return p.cat ? p.cat + ' › ' + p.sub : t; };
  // Étiquette tapée + catégorie choisie : « Brésil » + Pays -> « Pays/Brésil » (une étiquette déjà rangée reste telle quelle).
  const composeTag = (text, cat) => {
    const t = cleanTag(text);
    if (!t || t.includes('/') || !cat || cat === OTHER) return t;
    return cleanTag(cat + '/' + t);
  };
  const normTitle = (t) => cap(String(t || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim());
  const wikiUrl = (title) => 'https://fr.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%3A/g, ':');
  const qid = (uri) => uri.slice(uri.lastIndexOf('/') + 1);
  const estRarity = (views) => {
    if (views == null) return null;
    for (const [limit, r] of PV_STEPS) if (views < limit) return r;
    return 'L';
  };
  // Rareté relevée dans le jeu (collection créée par le favori depuis la Collection globale), sinon null.
  const realRarity = (item) => (item && RARITIES.includes(item.rarity) ? item.rarity : null);
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
  const suggCache = makeCache(LS.sugg, 30 * DAY); // titre -> {v: 2, q, n: [[nature, classe]], m: métiers, p: pays}
  const natGroupCache = makeCache(LS.natGroup, 90 * DAY); // classe Wikidata -> catégorie de tags

  // Cartes gardées dans IndexedDB (localStorage est trop petit pour 20 000 cartes) : un enregistrement par classeur,
  // rangé sous l'id du compte (pas sous la clé : « Changer ma clé » le garde), {v, user, keyTag, rev, fetched_at,
  // new_ids, cards (telles que l'API les renvoie)}. Le classeur s'ouvre dessus, puis ne demande que ce qui a changé.
  // Tout est facultatif : IndexedDB absent, refusé (navigation privée, stockage bloqué) ou muet, chaque accès rend
  // undefined et la page lit tout au serveur, comme avant.
  const cardCache = (() => {
    const STORE = 'cards';
    let dbp = null;
    const within = (p, ms) => new Promise((resolve) => { setTimeout(() => resolve(undefined), ms); p.then(resolve, () => resolve(undefined)); });
    function open() {
      if (!dbp) {
        dbp = within(new Promise((resolve) => {
          const req = indexedDB.open('classeur', 1);
          req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
          req.onsuccess = () => {
            const db = req.result;
            db.onversionchange = () => { try { db.close(); } catch (e) { /* déjà fermée */ } dbp = null; };
            resolve(db);
          };
          req.onerror = () => resolve(null);
          req.onblocked = () => resolve(null);
        }), 2000).then((db) => db || null);
      }
      return dbp;
    }
    async function run(mode, fn) {
      const db = await open();
      if (!db) return undefined;
      return within(new Promise((resolve) => {
        const tx = db.transaction(STORE, mode);
        let out;
        fn(tx.objectStore(STORE), (v) => { out = v; });
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => resolve(undefined);
        tx.onabort = () => resolve(undefined);
      }), 10000);
    }
    return {
      get: (user) => run('readonly', (st, out) => { const r = st.get(user); r.onsuccess = () => out(r.result); }),
      put: (rec) => run('readwrite', (st) => { st.put(rec, rec.user); }),
      del: (user) => run('readwrite', (st) => { st.delete(user); }),
      clear: () => run('readwrite', (st) => { st.clear(); }),
      // « Oublier cette clé » : le compte n'a pas pu être lu, on retrouve ses cartes par l'empreinte de la clé.
      dropKey: (tag) => run('readwrite', (st) => {
        const r = st.getAll();
        r.onsuccess = () => { for (const x of r.result || []) if (x && x.keyTag === tag) st.delete(x.user); };
      }),
    };
  })();
  // Empreinte de la clé gardée avec les cartes (jamais la clé elle-même).
  const keyTag = (k) => { let x = 0x811c9dc5; for (let i = 0; i < k.length; i++) x = Math.imul(x ^ k.charCodeAt(i), 0x01000193); return (x >>> 0).toString(36); };

  // ================================================================ état
  const S = reactive({
    boot: 'loading', // loading | welcome | app
    // « Catégories » (onglet Collections) : recherche d'une catégorie ou d'une page « Liste de… » de Wikipédia avec
    // suggestions au fil de la frappe, ou adresse d'une page collée (list : [{type: 'cat', title, name, pages, subcats} |
    // {type: 'page', title, name, list}], dans l'ordre affiché ; done : texte pour lequel list a été reçue, nav : flèches
    // utilisées depuis la dernière frappe, enter : Entrée pressée avant l'arrivée des suggestions) ; catégorie ou page
    // ouverte (catView : {type: 'cat' | 'page', key, title, name, size, subcats, withSubs, links, allLinks, loading,
    // error, items, total, busy}), source d'une collection à créer.
    catSearch: { q: '', open: false, active: 0, list: [], loading: false, error: '', done: '', nav: false, enter: false },
    catView: null,
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
    album: null, // {kind: 'target', id} : collection ouverte ; {kind: 'category', id: 'wp:<nom>' | 'links:<titre>'} : catégorie ou page de Wikipédia ouverte (S.catView)
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
    openMissing: null, // élément d'une collection qui te manque, ouvert dans sa fiche (case vide)
    drawer: { newTag: '', newCat: '', busy: false, error: '' },
    tagSearch: '',
    tagsAll: false,
    refresh: { running: false, msg: '', error: false, warn: false },
    sync: { done: false, msg: '', before: null, expired: false, hasFavori: false, others: {}, elsewhere: null }, // fenêtre « Mettre à jour avec le favori »
    notice: null,
    modal: null, // editor | confirm | tag | switch | link | arrange | sync
    session: { cookie: '', busy: false, error: '' },
    editor: null,
    confirm: null,
    tagEdit: null,
    settings: { name: '', busy: false, error: '', saved: false },
    copied: '',
    bm: { src: null, error: '', clicked: false, importKey: null, busy: false },
    pv: { version: 0, running: false, done: 0, total: 0, error: '' },
    prefs: { hidden_proposals: [], hide_proposals: false }, // préférences du compte (GET/PATCH /api/me) : propositions retirées, masquées
    tagCatsOpen: (() => { const v = store.json(LS.tagCats); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; })(),
    bulkCat: '',
    wp: { list: [], running: false, done: 0, total: 0, label: '', error: '', busy: {} }, // propositions d'après les catégories Wikipédia
    arrange: null, // « Ranger mes tags » : {rows, busy, loading, progress, error}
    sugg: { version: 0, running: false, done: 0, total: 0, error: '', cardBusy: '', cardError: '', cardErrorFor: '' },
    // « Entre amis » : lecture des membres (busy, loading = carte en cours), activation du partage, classeur parcouru.
    // page : 'trades' = « Échanges possibles » (sous-page) ; trade : filtre de cette page ('all' = tout le monde, par défaut
    // (demande de l'utilisateur, 2026-10-16 : peu d'échanges pour l'instant), 'me' = ce qui me concerne, sinon l'identifiant
    // public d'un membre). album : collection de l'ami ouvert (open), en lecture
    // seule, avec son filtre (all | has : il les a | lacks : lui manquent | help : tu peux l'aider), son tri et d'où on
    // l'a ouverte (albumFrom : 'trades' = « Échanges possibles ») ; copyBusy : « Créer la même collection chez moi » en
    // cours ; copies : collections ainsi créées pendant la visite ('<ami>:<sa collection>' -> id de la tienne).
    friends: { status: 'idle', busy: false, error: '', loading: '', shareBusy: false, shareError: '', open: null, q: '', filter: 'all', sort: 'rarity', limit: PAGE, more: {}, page: null, trade: 'all', tradeDup: true,
      album: null, albumFilter: 'all', albumSort: 'order', albumLimit: ALBUM_PAGE, albumFrom: null, copyBusy: false, copies: {} },
    // « Chat » (un salon pour tous les classeurs) : user = compte dont `read` (dernier message lu, aussi dans
    // localStorage) a été chargé ; status idle | loading | ready | error ; brouillon et envoi ; older = il y a des
    // messages plus anciens ; newBelow = nouveaux messages arrivés sous la zone lue (on n'était pas en bas).
    chat: { user: null, status: 'idle', error: '', draft: '', sending: false, sendError: '', older: false, olderBusy: false, read: 0, newBelow: false },
  });
  // Les cartes et les collections peuvent être nombreuses : tableaux non profonds d'objets figés (markRaw).
  const cards = shallowRef([]);
  const targets = shallowRef([]);
  const newIds = shallowRef([]);
  // Membres qui montrent leurs cartes (« Entre amis ») : [{id (public), name, count, fetched_at, cards | null, tshare
  // (montre aussi ses collections), tmark (leur nombre et dernier changement), targets ([{id, name, items:[{title, qid?}]}]
  // | null)}], figés. En mémoire seulement, jamais dans IndexedDB (cardCache ne garde que ton classeur). friendsGen change à chaque
  // remise à zéro (classeur changé, partage coupé) : une lecture partie avant est écartée.
  const friendList = shallowRef([]);
  let friendsGen = 0;
  let friendsJob = null;
  let friendsAt = 0;
  let friendQidCtrl = null;
  // Révision des cartes affichées (`rev` de GET /api/cards, null = inconnue : relecture complète). cardsGen change avec
  // le classeur (resetData) : une réponse arrivée après coup est écartée.
  let cardsRev = null;
  let cardsGen = 0;
  let cardsJob = Promise.resolve();
  let cacheTimer = null;
  let cacheWrite = null; // écriture du cache en attente (saveCardCache)
  // Lectures de cartes en cours : chacune note les cartes dont les tags changent ici entre-temps, pour ne pas les
  // écraser par une réponse partie avant (la lecture suivante les rapporte : le serveur a fait avancer sa révision).
  const tagWatch = new Set();

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
  const wdApiQ = makeQueue(300);
  const abortError = () => { const e = new Error('Recherche annulée.'); e.name = 'AbortError'; return e; };

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
  // signal : AbortController d'une recherche, pour abandonner une requête périmée (même en attente dans la file).
  function getJson(q, url, prio, accept, signal) {
    const who = /wikidata\.org/.test(url) ? 'Wikidata' : 'Wikipédia';
    return enqueue(q, async () => {
      let delay = 2000;
      for (let attempt = 0; attempt < 7; attempt++) {
        if (signal && signal.aborted) throw abortError();
        let r = null;
        try { r = await fetch(url, { headers: { Accept: accept || 'application/json' }, credentials: 'omit', signal }); } catch (e) { if (signal && signal.aborted) throw abortError(); r = null; }
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
  const sparql = (query, prio, signal) => getJson(dataQ, SPARQL + '?format=json&query=' + encodeURIComponent(query), prio, 'application/sparql-results+json', signal)
    .then((j) => (j && j.results && j.results.bindings) || []);
  const WD_API = 'https://www.wikidata.org/w/api.php';
  // Éléments Wikidata dont le libellé ou un alias correspond (français).
  const wdSearch = (text, signal, limit) => getJson(wdApiQ, WD_API + '?' + new URLSearchParams({ action: 'wbsearchentities', search: text, language: 'fr', uselang: 'fr',
    type: 'item', limit: String(limit || 7), format: 'json', origin: '*' }), 3, null, signal).then((j) => (j && Array.isArray(j.search) ? j.search : []));
  const truthy = (b) => !!b && (b.value === 'true' || b.value === '1');
  // Nature d'éléments : pays, métier (quelqu'un l'exerce), classe (quelque chose en est une instance), personne.
  async function classifyItems(ids, prio, signal) {
    const out = new Map();
    if (!ids.length) return out;
    const rows = await sparql(`SELECT ?c ?country ?occ ?cls ?human WHERE { VALUES ?c { ${ids.map((id) => 'wd:' + id).join(' ')} }
      BIND(EXISTS { ?c wdt:P31 ?t . FILTER(?t IN (${COUNTRY_CLASSES.map((x) => 'wd:' + x).join(', ')})) } AS ?country)
      BIND(EXISTS { ?x wdt:P106 ?c } AS ?occ) BIND(EXISTS { ?y wdt:P31 ?c } AS ?cls) BIND(EXISTS { ?c wdt:P31 wd:Q5 } AS ?human) }`, prio, signal);
    for (const r of rows) out.set(qid(r.c.value), { country: truthy(r.country), occ: truthy(r.occ), cls: truthy(r.cls), human: truthy(r.human) });
    return out;
  }
  // Catégorie de tags d'une nature (classe Wikidata) d'après ses superclasses ; gardée dans ce navigateur.
  async function resolveGroups(classIds, prio, signal) {
    const todo = [...new Set(classIds)].filter((c) => c && c !== TAXON && !natGroupCache.has(c));
    const targets = NATURE_GROUPS.flatMap(([, ids]) => ids);
    for (const batch of chunks(todo, 80)) {
      const rows = await sparql(`SELECT ?c ?g WHERE { VALUES ?c { ${batch.map((id) => 'wd:' + id).join(' ')} }
        VALUES ?g { ${targets.map((id) => 'wd:' + id).join(' ')} } ?c wdt:P279* ?g . }`, prio, signal);
      const hits = new Map();
      for (const r of rows) { const c = qid(r.c.value); if (!hits.has(c)) hits.set(c, new Set()); hits.get(c).add(qid(r.g.value)); }
      for (const c of batch) {
        const got = hits.get(c) || new Set();
        const g = NATURE_GROUPS.find(([, ids]) => ids.some((id) => got.has(id)));
        natGroupCache.set(c, g ? g[0] : OTHER);
      }
    }
  }
  const natGroupOf = (c) => (c === TAXON ? 'Sciences et nature' : natGroupCache.get(c) || OTHER);
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
        const j = await getJson(wikiQ, wpUrl({ action: 'query', redirects: '1', prop: 'pageprops|description|pageimages', ppprop: 'disambiguation|wikibase_item',
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
          qid: (p.pageprops && p.pageprops.wikibase_item) || null,
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
    const titles = st.items.filter((it) => it.status === 'ok' && !findCard(it) && !pvCache.has(it.title)).map((it) => it.title);
    if (!titles.length) return;
    Object.assign(S.pv, { running: true, done: 0, total: titles.length });
    loadPageviews(titles, token)
      .catch((e) => { if (token === pvToken) S.pv.error = e.message; })
      .finally(() => { if (token === pvToken) S.pv.running = false; });
  }
  // Même chose pour l'album d'une collection d'un ami (même file, mêmes lots de 50, même cache) : seulement les cases que
  // ni lui ni toi ne remplissez (une carte possédée donne déjà sa rareté et son illustration).
  function startFriendPageviews() {
    const token = ++pvToken;
    S.pv.running = false;
    S.pv.error = '';
    const fa = friendAlbum.value;
    if (!fa || S.boot !== 'app') return;
    const index = friendIndexOf(fa.f.id);
    const titles = [...new Set(fa.t.items.filter((it) => !index.findCard(it) && !findCard(it) && !pvCache.has(it.title)).map((it) => it.title))];
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
    const natures = [];
    const seen = new Set();
    for (const c of it.P31.filter((x) => !SKIP_NATURES.has(x) && !sup.has(x))) {
      const label = tidy([c === TAXON ? taxonGroup(desc) : labels[c]], 1)[0];
      if (label && !seen.has(label.toLowerCase())) { seen.add(label.toLowerCase()); natures.push([label, c]); }
    }
    const jobs = it.P106.map((m) => (female && forms.f[m]) || (male && forms.m[m]) || labels[m]);
    const lands = [...it.P27, ...it.P17].map((c) => labels[c]);
    return { v: 2, q: it.id || null, n: natures.slice(0, 2), m: tidy(jobs, 3), p: tidy(lands, 2) };
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
          if (!items.has(id)) items.set(id, { id, P31: [], P106: [], P27: [], P17: [], P21: [] });
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
      const built = new Map();
      for (const t of batch) {
        const id = qidOf.get(t);
        const it = id && items.get(id);
        built.set(t, it ? buildSuggestion(cardOf.get(t), it, labels, forms, sup.get(id) || new Set()) : { v: 2, q: id || null, n: [], m: [], p: [] });
      }
      // Catégorie des natures (Lieux, Culture et œuvres…) avant de montrer les suggestions.
      try { await resolveGroups([...built.values()].flatMap((b) => b.n.map((x) => x[1])), prio); } catch (e) { /* elles iront dans « Autres » */ }
      if (stop()) return;
      for (const [t, b] of built) suggCache.set(t, b);
      if (resolver) { const known = [...built].filter(([, b]) => b.q).map(([t, b]) => [t, b.q]); if (known.length && resolver.remember(known)) qidVersion.value++; }
      done += batch.length;
      S.sugg.version++;
      if (onProgress) onProgress(done);
    }
  }
  // Suggestions d'une carte qui ne sont pas déjà dans ses tags ; null = pas encore calculées.
  // Suggestions déjà calculées dans le format actuel (les anciennes, sans catégories, sont recalculées).
  const hasSugg = (title) => { const s = suggCache.get(title); return !!s && s.v === 2; };
  // Suggestions rangées (« Pays/France », « Métiers/Footballeur », « Lieux/Commune française »…) qui ne sont pas
  // déjà dans les tags de la carte (comparées sur la sous-catégorie) ; null = pas encore calculées.
  function suggestionsFor(card) {
    void S.sugg.version;
    const s = suggCache.get(card.title);
    if (!s || s.v !== 2) return null;
    const own = new Set(card.tags.map((t) => tagSub(t).toLowerCase()));
    const out = [];
    const push = (t) => {
      const key = tagSub(t).toLowerCase();
      if (t.length <= 60 && !own.has(key) && !out.some((x) => tagSub(x).toLowerCase() === key)) out.push(t);
    };
    for (const [label, c] of s.n || []) push(natGroupOf(c) + '/' + label);
    for (const l of s.m || []) push('Métiers/' + l);
    for (const l of s.p || []) push('Pays/' + l);
    return out;
  }
  let suggToken = 0;
  async function computeAllSuggestions() {
    if (S.sugg.running) return;
    const titles = [...new Set(cards.value.map((c) => c.title))].filter((t) => !hasSugg(t));
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
  // Une carte compte pour un élément d'une collection si leurs titres sont égaux, sinon s'ils désignent le même élément
  // Wikidata (match.js) ; les qids manquants sont résolus à la demande, le compteur fait recalculer.
  const Match = window.ClasseurMatch || null;
  const resolver = Match ? Match.createResolver() : null;
  const qidVersion = ref(0);
  const cardIndex = computed(() => (Match ? Match.createIndex(cards.value, resolver) : null));
  function findCard(item) {
    void qidVersion.value;
    if (!item) return null;
    if (cardIndex.value) return cardIndex.value.findCard(item);
    const list = byTitle.value.get(normTitle(item.title));
    return list ? list[0] : null;
  }
  // Deux résolutions indépendantes (le resolver les fait passer l'une après l'autre, lot par lot) : 'album' (l'album
  // ouvert) et 'all' (toutes les collections, après chaque chargement des cartes) ; une nouvelle n'annule que la
  // précédente du même canal (la relecture des 60 s ne coupe plus celle de l'album ouvert).
  const matchCtrl = { album: null, all: null };
  function resolveQids(items, allCards, channel) {
    if (!resolver || !cardIndex.value) return;
    const ch = channel === 'all' ? 'all' : 'album';
    let titles = [];
    try { titles = cardIndex.value.missingQidTitles(items, { allCards: !!allCards }); } catch (e) { return; }
    if (!titles.length) return;
    if (matchCtrl[ch]) matchCtrl[ch].abort();
    const ctrl = new AbortController();
    matchCtrl[ch] = ctrl;
    resolver.resolve(titles, { signal: ctrl.signal, onProgress: () => { qidVersion.value++; } })
      .then(() => { qidVersion.value++; })
      .catch(() => { /* annulée, ou Wikipédia indisponible : le rapprochement par titre reste */ })
      .finally(() => { if (matchCtrl[ch] === ctrl) matchCtrl[ch] = null; });
  }
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
      && tags.every((tok) => (tok.endsWith('/') ? c.tags.some((t) => tagCat(t) === tok.slice(0, -1)) : c.tags.includes(tok))));
    return out.sort(SORTERS[S.sort] || SORTERS.rarity);
  });
  const visibleCards = computed(() => filtered.value.slice(0, S.limit));

  // Collections à compléter du serveur (targets), toutes dans « Mes collections » : créées par le favori depuis la
  // Collection globale du jeu, à la main dans « Nouvelle collection », depuis une catégorie de Wikipédia (source
  // « wp:<nom> » : `cat`, signalée « depuis la catégorie Wikipédia »), depuis les liens d'une page de Wikipédia (source
  // « links:<titre> » : `page` = le titre, signalée « depuis la page Wikipédia « … » »), ou jadis ajoutées du catalogue
  // (sources wm:, wd, cat, links, def, catalog:… ou aucune).
  const isCatSource = (s) => typeof s === 'string' && s.startsWith('wp:');
  const PAGE_SRC = 'links:';
  const pageOfSource = (s) => (typeof s === 'string' && s.startsWith(PAGE_SRC) && s.length > PAGE_SRC.length ? s.slice(PAGE_SRC.length) : null);
  // Thèmes du catalogue (retiré le 2026-10-16) qui n'avaient pas d'ordre (`ordered: false` dans catalog.json, repris de
  // git 9a62469) : leurs collections (source « catalog:<id> ») restent de A à Z, sans numéros.
  const UNORDERED_CATALOG = new Set(['vaches', 'chiens', 'chats', 'chevaux', 'cepages', 'fromages', 'constellations', 'pays', 'departements', 'regions',
    'merveilles', 'moutons', 'poules', 'etats_usa', 'regions_italie', 'canada', 'capitales_ue', 'metro_paris', 'cathedrales', 'olympe', 'ballon_or',
    'beethoven', 'zodiaque']);
  const unorderedSource = (s) => typeof s === 'string' && s.startsWith('catalog:') && UNORDERED_CATALOG.has(s.slice(8));
  const collections = computed(() => {
    // Une catégorie n'a pas d'ordre à elle (celui de Wikipédia suit des clés de tri) : de A à Z, sans numéros ; les liens
    // d'une page non plus (lus de A à Z).
    const all = targets.value.map((t) => {
      const cat = isCatSource(t.source);
      const page = pageOfSource(t.source);
      return { kind: 'target', id: t.id, key: 'target:' + t.id, name: t.name, items: t.items, ordered: !cat && !page && !unorderedSource(t.source), cat, page, t };
    });
    return { all, mine: all };
  });
  // Progression d'une collection : possédées, répartition par rareté, trois cartes pour l'éventail.
  function progressFor(col) {
    let own = 0;
    const byR = {};
    const sample = [];
    for (const it of col.items) {
      const c = findCard(it);
      if (!c) continue;
      own++;
      byR[c.rarity] = (byR[c.rarity] || 0) + 1;
      sample.push(c);
    }
    sample.sort((a, b) => (RANK[a.rarity] ?? 9) - (RANK[b.rarity] ?? 9) || (b.image ? 1 : 0) - (a.image ? 1 : 0));
    return { own, total: col.items.length, byR, sample: sample.slice(0, 3) };
  }
  const progress = computed(() => new Map(collections.value.all.map((col) => [col.key, progressFor(col)])));
  // Catégorie ou page de Wikipédia ouverte (source d'une collection à créer) : ses articles (ou les articles liés depuis
  // la page), lus sur Wikipédia (S.catView), montrés comme un album.
  const catAlbum = computed(() => {
    const cv = S.catView;
    const page = cv && cv.type === 'page' ? cv.title : null;
    return cv ? { kind: 'category', id: cv.key, key: 'cat:' + cv.key, name: cv.name, items: cv.items || [], ordered: false, cat: !page, page, cv } : null;
  });
  const catProgress = computed(() => (catAlbum.value ? progressFor(catAlbum.value) : null));
  const progressOf = (col) => (col.kind === 'category' ? catProgress.value : progress.value.get(col.key)) || { own: 0, total: col.items.length, byR: {}, sample: [] };
  const activeAlbum = computed(() => {
    const a = S.album;
    if (!a) return null;
    if (a.kind === 'category') return catAlbum.value && catAlbum.value.id === a.id ? catAlbum.value : null;
    return collections.value.all.find((c) => c.id === a.id) || null;
  });
  // Album : cartes possédées et cases vides dans l'ordre de la collection, filtrées et triées.
  const albumSlots = computed(() => {
    const col = activeAlbum.value;
    if (!col) return [];
    void S.pv.version;
    const owned = byTitle.value;
    let slots = col.items.map((item, i) => {
      const card = findCard(item);
      const info = card ? null : pvCache.get(item.title);
      const views = info ? info[0] : null;
      // real : rareté donnée par le jeu (pastille sans « ≈ ») ; est : estimée d'après les vues, pour les autres.
      const real = card ? null : realRarity(item);
      return { i: i + 1, key: card ? card.id + ':' + i : 'vide:' + i + ':' + item.title, item, card, views, real, est: card || real || item.status !== 'ok' ? null : estRarity(views), thumb: info ? info[1] : null };
    });
    if (S.albumFilter === 'owned') slots = slots.filter((s) => s.card);
    if (S.albumFilter === 'missing') slots = slots.filter((s) => !s.card);
    if (S.albumSort === 'rarity') {
      const rank = (s) => RANK[s.card ? s.card.rarity : s.real || s.est] ?? 9;
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
    for (const c of cards.value) if (!seen.has(c.title)) { seen.add(c.title); if (!hasSugg(c.title)) n++; }
    return n;
  });
  // Collections (toutes, celles faites d'une catégorie comprises) qui contiennent une carte (pour la fiche).
  function membershipsOf(card) {
    return collections.value.all.filter((col) => col.items.some((it) => { const f = findCard(it); return !!f && f.id === card.id; }));
  }
  // Collections qui contiennent un article que tu n'as pas (fiche d'une case vide) : même titre,
  // ou même qid.
  function membershipsOfItem(item) {
    const k = normTitle(item.title);
    return collections.value.all.filter((col) => col.items.some((it) => normTitle(it.title) === k || (!!item.qid && it.qid === item.qid)));
  }
  const personalLink = computed(() => (S.key ? location.origin + '/#cle=' + S.key : ''));
  // Le favori n'embarque que la clé d'import (elle ne permet que d'envoyer des cartes), jamais la clé principale.
  const bookmarkletUrl = computed(() => (S.bm.src && S.bm.importKey ? makeBookmarklet(S.bm.src, location.origin, S.bm.importKey) : ''));

  // ---------------------------------------------------------------- « Entre amis » : qui a quoi
  const sharing = () => !!(S.me && S.me.shared);
  const sharingTargets = () => !!(S.me && S.me.shared && S.me.shared_targets); // et ses collections à compléter
  const friendName = (f) => f.name || 'Sans prénom';
  // Index des cartes de chaque ami : par titre, puis par identifiant Wikidata, comme pour les tiennes (match.js).
  function makeFriendIndex(list) {
    if (Match) return Match.createIndex(list, resolver);
    const m = new Map();
    for (const c of list) { const k = normTitle(c.title); if (!m.has(k)) m.set(k, c); }
    return { findCard: (it) => (it ? m.get(normTitle(typeof it === 'string' ? it : it.title)) || null : null) };
  }
  const friendIndexes = computed(() => (sharing() ? friendList.value.filter((f) => f.cards && f.cards.length).map((f) => ({ f, index: makeFriendIndex(f.cards) })) : []));
  // Amis qui ont la carte d'un élément de collection : les doubles d'abord (les plus faciles à échanger), puis par prénom.
  function holdersOf(item) {
    void qidVersion.value;
    if (!item || (item.status && item.status !== 'ok')) return [];
    const out = [];
    for (const { f, index } of friendIndexes.value) {
      const c = index.findCard(item);
      if (c) out.push({ id: f.id, name: f.name, count: c.count || 1, rarity: c.rarity });
    }
    return out.length > 1 ? out.sort((a, b) => b.count - a.count || COLLATOR.compare(friendName(a), friendName(b))) : out;
  }
  const holdersText = (list) => list.map((x) => friendName(x) + (x.count > 1 ? ` (×${fmt(x.count)})` : '')).join(', ');
  // Collections où chercher chez les amis : toutes les tiennes (celles faites d'une catégorie Wikipédia comprises).
  const friendCols = computed(() => collections.value.all);
  // Noms des collections d'une ligne (« Échanges possibles », « Ce qui pourrait intéresser tes amis ») : une catégorie
  // suivie est signalée comme telle.
  const colsText = (cols, sep) => cols.map((c) => c.name).join(sep);
  // Pour chacune : ses cases vides qu'au moins un ami peut remplir (en double chez lui d'abord), et les collections où
  // les amis remplissent le plus de cases en premier.
  const friendHighlights = computed(() => {
    if (!friendIndexes.value.length) return [];
    void qidVersion.value;
    const out = [];
    for (const col of friendCols.value) {
      const rows = [];
      const seen = new Set();
      col.items.forEach((it, i) => {
        if (it.status !== 'ok' || findCard(it)) return;
        const k = normTitle(it.title);
        if (seen.has(k)) return;
        seen.add(k);
        const holders = holdersOf(it);
        if (holders.length) rows.push({ item: it, holders, dup: holders[0].count >= 2, i });
      });
      if (!rows.length) continue;
      rows.sort((a, b) => (b.dup - a.dup) || (a.dup ? b.holders[0].count - a.holders[0].count : 0) || b.holders.length - a.holders.length || a.i - b.i);
      out.push({ col, rows, dup: rows.filter((r) => r.dup).length });
    }
    return out.sort((a, b) => b.rows.length - a.rows.length || b.dup - a.dup || COLLATOR.compare(a.col.name, b.col.name));
  });
  // « Échanges possibles » : pour chaque couple (X a la carte C, Z a la collection Y où C remplit une case vide), une
  // ligne, X et Z pris parmi toi et les amis dont les cartes sont lues. Collections de Z : les tiennes comme dans « Pour
  // compléter tes collections » (celles faites d'une catégorie comprises) ; celles qu'un ami montre ; rien pour un ami qui ne les
  // montre pas (on ne sait pas ce qui lui manque : il est seulement nommé). Une ligne par carte et par couple
  // (X → Z), avec toutes les collections de Z qu'elle complète ; rapprochement titre puis qid (match.js), comme ailleurs.
  // Calculé une fois par chargement (et quand un qid est appris), filtré à part (tradeView).
  const ME = ''; // « toi » dans les échanges (un identifiant public n'est jamais vide)
  const rarityRank = (r) => RANK[r] ?? 9;
  const trades = computed(() => {
    const empty = { pairs: [], hidden: [], waiting: [] };
    if (!sharing() || !S.me) return empty;
    void qidVersion.value;
    const indexOf = new Map(friendIndexes.value.map(({ f, index }) => [f.id, index]));
    const none = { findCard: () => null };
    const people = [{ id: ME, me: true, name: (S.me.user && S.me.user.name) || '', index: { findCard }, f: null }];
    for (const f of friendList.value) if (f.cards) people.push({ id: f.id, me: false, name: f.name, index: indexOf.get(f.id) || none, f });
    if (people.length < 2) return empty;
    const hidden = [];
    const waiting = [];
    // Collections de chacun : [{id, name, items, cat}] (cat : catégorie de Wikipédia suivie ; id : celui de la collection,
    // pour ouvrir l'album d'un ami depuis une ligne).
    function colsOf(p) {
      if (p.me) return friendCols.value.map((col) => ({ id: col.id, name: col.name, items: col.items, cat: !!col.cat }));
      if (p.f.tshare && p.f.targets) return p.f.targets.map((t) => ({ id: t.id, name: t.name, items: t.items, cat: !!t.cat }));
      if (p.f.tshare) waiting.push(p); else hidden.push(p);
      return [];
    }
    const sameCol = (a, b) => (a.id != null && b.id != null ? a.id === b.id : a.name === b.name && a.cat === b.cat);
    const pairs = [];
    for (const z of people) {
      // Cases vides de Z (un même article dans deux de ses collections : une seule case, les deux noms).
      const holes = new Map();
      for (const col of colsOf(z)) {
        const c = { id: col.id, name: col.name, cat: col.cat };
        for (const it of col.items) {
          if (!it || (it.status && it.status !== 'ok')) continue;
          const k = normTitle(it.title);
          let hole = holes.get(k);
          if (hole === undefined) {
            hole = z.index.findCard(it) ? null : { item: it, cols: [] };
            holes.set(k, hole);
          }
          if (hole && !hole.cols.some((x) => sameCol(x, c))) hole.cols.push(c);
        }
      }
      if (!holes.size) continue;
      for (const x of people) {
        if (x === z) continue;
        const byCard = new Map();
        for (const hole of holes.values()) {
          if (!hole) continue;
          const c = x.index.findCard(hole.item);
          if (!c) continue;
          const row = byCard.get(c.id);
          if (row) { for (const n of hole.cols) if (!row.cols.some((x) => sameCol(x, n))) row.cols.push(n); continue; }
          const count = Math.max(1, Number(c.count) || 1);
          byCard.set(c.id, { card: c, item: hole.item, cols: hole.cols.slice(), count, dup: count >= 2 });
        }
        if (!byCard.size) continue;
        const rows = [...byCard.values()].sort((a, b) => (b.dup - a.dup) || (a.dup ? b.count - a.count : 0) || b.cols.length - a.cols.length
          || rarityRank(a.card.rarity) - rarityRank(b.card.rarity) || COLLATOR.compare(a.card.title, b.card.title));
        pairs.push({ key: x.id + '>' + z.id, x, z, rows, dup: rows.filter((r) => r.dup).length });
      }
    }
    // Les couples qui ont le plus de doubles (les plus faciles à donner), puis le plus de cases ; à égalité, par
    // prénoms (toi d'abord).
    const who = (p) => (p.me ? '' : friendName(p));
    pairs.sort((a, b) => b.dup - a.dup || b.rows.length - a.rows.length
      || COLLATOR.compare(who(a.x), who(b.x)) || COLLATOR.compare(who(a.z), who(b.z)));
    return { pairs, hidden: hidden.map((p) => p.f), waiting: waiting.map((p) => p.f) };
  });
  // Filtre de la page : tout le monde (par défaut, et pour un membre qui n'est plus là), ce qui me concerne (je donne ou je
  // reçois), ou un membre (qui donne ou reçoit).
  // Case « Seulement les cartes en double » (cochée par défaut, 2026-10-16) : ne garder que les cartes que celui qui
  // donne a en plusieurs exemplaires (il les donne sans les perdre), et les couples qui en ont.
  const tradeView = computed(() => {
    const t = S.friends.trade;
    let list = trades.value.pairs;
    if (t === 'me') list = list.filter((p) => p.x.me || p.z.me);
    else if (t !== 'all' && friendList.value.some((f) => f.id === t)) list = list.filter((p) => p.x.id === t || p.z.id === t);
    if (!S.friends.tradeDup) return list;
    return list.map((p) => ({ ...p, rows: p.rows.filter((r) => r.dup) })).filter((p) => p.rows.length);
  });
  // « Ce qui pourrait intéresser tes amis » : tes cartes qui complètent les collections qu'ils montrent, tes doubles
  // d'abord (rien pour ceux qui ne les montrent pas).
  const friendWants = computed(() => trades.value.pairs.filter((p) => p.x.me).map((p) => ({ f: p.z.f, rows: p.rows, dup: p.dup })));
  // Par ami : ses cartes qui te manquent, et combien il en a en double.
  const friendStats = computed(() => {
    void qidVersion.value;
    const m = new Map();
    for (const f of friendList.value) {
      if (!f.cards) continue;
      let missing = 0;
      let dup = 0;
      for (const c of f.cards) if (!findCard(c)) { missing++; if (c.count >= 2) dup++; }
      m.set(f.id, { missing, dup });
    }
    return m;
  });
  // Classeur d'un ami parcouru (lecture seule) : recherche, « Me manquent », tri.
  const openFriend = computed(() => (S.friends.open ? friendList.value.find((f) => f.id === S.friends.open) || null : null));
  const FRIEND_SORTS = {
    rarity: (a, b) => (RANK[a.rarity] ?? 9) - (RANK[b.rarity] ?? 9) || COLLATOR.compare(a.title, b.title),
    count: (a, b) => b.count - a.count || (RANK[a.rarity] ?? 9) - (RANK[b.rarity] ?? 9) || COLLATOR.compare(a.title, b.title),
    title: (a, b) => COLLATOR.compare(a.title, b.title),
  };
  const friendCardsView = computed(() => {
    const f = openFriend.value;
    if (!f || !f.cards) return [];
    void qidVersion.value;
    const q = fold(S.friends.q.trim());
    let list = q ? f.cards.filter((c) => c._k.includes(q)) : f.cards.slice();
    if (S.friends.filter === 'missing') list = list.filter((c) => !findCard(c));
    return list.sort(FRIEND_SORTS[S.friends.sort] || FRIEND_SORTS.rarity);
  });
  // « Ses collections » (classeur d'un ami qui les montre) : la progression de chacune avec SES cartes (titre puis qid,
  // comme les tiennes), et ce que tu peux lui donner (ses cases vides que tes cartes remplissent, dont tes doubles). Toutes
  // dans une liste (celles tirées d'une catégorie de Wikipédia sont seulement signalées), de A à Z (le serveur les rend
  // dans l'ordre de leurs ids).
  const noneIndex = { findCard: () => null };
  const friendIndexOf = (id) => { const x = friendIndexes.value.find((y) => y.f.id === id); return x ? x.index : noneIndex; };
  function friendProgressFor(index, t) {
    let own = 0;
    let help = 0;
    let helpDup = 0;
    const byR = {};
    const sample = [];
    for (const it of t.items) {
      const c = index.findCard(it);
      if (c) { own++; byR[c.rarity] = (byR[c.rarity] || 0) + 1; sample.push(c); continue; }
      const m = findCard(it);
      if (m) { help++; if ((Number(m.count) || 1) >= 2) helpDup++; }
    }
    sample.sort((a, b) => (RANK[a.rarity] ?? 9) - (RANK[b.rarity] ?? 9) || (b.image ? 1 : 0) - (a.image ? 1 : 0));
    return { own, total: t.items.length, byR, sample: sample.slice(0, 3), help, helpDup };
  }
  const friendTargetsView = computed(() => {
    const f = openFriend.value;
    if (!f || !f.targets) return null;
    void qidVersion.value;
    const index = friendIndexOf(f.id);
    const rows = f.targets.map((t) => ({ t, key: 'ft:' + t.id, p: friendProgressFor(index, t) })).sort((a, b) => COLLATOR.compare(a.t.name, b.t.name));
    return { rows, byId: new Map(rows.map((r) => [r.t.id, r])) };
  });
  // Tes cases vides (toutes tes collections), une par article, avec les collections où il manque : indexées
  // comme des cartes (titre, puis qid : match.js), pour reconnaître chez un ami une carte qui t'en remplirait une.
  const myHoles = computed(() => {
    void qidVersion.value;
    const holes = new Map();
    for (const col of collections.value.all) {
      for (const it of col.items) {
        if (!it || (it.status && it.status !== 'ok')) continue;
        const k = normTitle(it.title);
        let hole = holes.get(k);
        if (hole === undefined) {
          hole = findCard(it) ? null : { title: it.title, qid: it.qid || null, cols: [] };
          holes.set(k, hole);
        }
        if (hole && !hole.cols.includes(col)) hole.cols.push(col);
      }
    }
    return makeFriendIndex([...holes.values()].filter(Boolean));
  });
  // Album d'une collection d'un ami (lecture seule), comme les tiennes : ses cartes et ses cases vides. Une case vide que
  // tu remplis : mine (ta carte : « tu l'as », « ×2 en double ») ; une de ses cartes qui te manque et qui remplirait une
  // de tes collections : want (ces collections). Rareté : celle de sa carte ou de la tienne, sinon estimée d'après les vues.
  const friendAlbum = computed(() => {
    const f = openFriend.value;
    const id = S.friends.album;
    if (!f || id == null || !f.targets) return null;
    const t = f.targets.find((x) => x.id === id);
    return t ? { f, t, key: 'fa:' + f.id + ':' + t.id, ordered: !t.cat } : null;
  });
  const friendSlotsAll = computed(() => {
    const fa = friendAlbum.value;
    if (!fa) return [];
    void qidVersion.value;
    void S.pv.version;
    const index = friendIndexOf(fa.f.id);
    const holes = myHoles.value;
    return fa.t.items.map((item, i) => {
      const card = index.findCard(item);
      const mine = findCard(item);
      const hole = card && !mine ? holes.findCard(item) || holes.findCard(card) : null;
      const info = card || mine ? null : pvCache.get(item.title);
      const views = info ? info[0] : null;
      const real = card ? null : mine ? okRarity(mine.rarity) : null;
      return { i: i + 1, key: (card ? 'c:' + card.id : 'v:' + item.title) + ':' + i, item, card, mine, want: hole ? hole.cols : null,
        views, real, est: card || real ? null : estRarity(views), thumb: info ? info[1] : null };
    });
  });
  const friendSlots = computed(() => {
    const fa = friendAlbum.value;
    if (!fa) return [];
    const f = S.friends.albumFilter;
    let slots = friendSlotsAll.value;
    if (f === 'has') slots = slots.filter((s) => s.card);
    else if (f === 'lacks') slots = slots.filter((s) => !s.card);
    else if (f === 'help') slots = slots.filter((s) => !s.card && s.mine);
    if (S.friends.albumSort === 'rarity') {
      const rank = (s) => RANK[s.card ? s.card.rarity : s.real || s.est] ?? 9;
      slots = slots.slice().sort((a, b) => rank(a) - rank(b) || (b.views || 0) - (a.views || 0));
    } else if (!fa.ordered) slots = slots.slice().sort((a, b) => COLLATOR.compare(a.item.title, b.item.title));
    return slots;
  });

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
  // Clés d'import gardées par compte : {<id du compte>: clé} (l'ancien format {user, key} est encore lu).
  function importKeys() {
    const v = store.json(LS.importKey);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    if (typeof v.user === 'string') return typeof v.key === 'string' && v.key ? { [v.user]: v.key } : {};
    return v;
  }
  function storedImportKey() {
    const me = S.me && S.me.user;
    const k = me ? importKeys()[me.id] : null;
    return typeof k === 'string' && k ? k : null;
  }

  function resetData() {
    // Écriture du cache en attente : faite tout de suite, avec les cartes du classeur qu'on quitte.
    clearTimeout(cacheTimer);
    cacheTimer = null;
    if (cacheWrite) cacheWrite();
    cards.value = [];
    targets.value = [];
    newIds.value = [];
    cardsRev = null;
    cardsGen++;
    cardsJob = Promise.resolve();
    Object.assign(S, { me: null, fetchedAt: null, loadingCards: false, openId: null, openMissing: null, modal: null, editor: null, confirm: null, tagEdit: null, notice: null, switchAsk: null, tab: 'collections', album: null,
      q: '', tagFilter: [], untaggedOnly: false, newOnly: false, rarities: [], limit: PAGE, lastClicked: null, bulkTag: '', bulkError: '' });
    S.selected.clear();
    S.refresh.msg = '';
    S.refresh.error = false;
    S.refresh.warn = false;
    S.bm.importKey = null;
    S.prefs = normPrefs({});
    S.arrange = null;
    stopCategory(); // catégorie ouverte (lecture de ses articles) et recherche de catégories : celles de l'autre classeur
    stopCatSearch();
    // Propositions (calcul en cours, liste, créations en cours) : celles des cartes de l'autre classeur.
    cancelProposals();
    S.wp.list = [];
    S.wp.busy = {};
    pvToken++;
    suggToken++;
    S.sugg.running = false;
    clearFriends(); // cartes des amis : celles de l'autre classeur ne servent plus
    resetMarket(); // cotes, valeur et lecture du marché : celles de l'autre classeur
    resetChat(); // messages, brouillon et dernier lu : ceux de l'autre classeur
  }
  const STALE_KEY = "La clé gardée dans ce navigateur ne correspond plus à aucun classeur : il a peut-être été supprimé, ou sa clé a été changée sur un autre appareil. Ouvre ton lien personnel le plus récent.";
  function lostKey(msg) {
    // Un autre onglet a changé de clé (« Changer ma clé ») ou de classeur : on reprend celle qu'il a gardée.
    const saved = store.get(LS.key);
    if (saved && saved !== S.key && KEY_RE.test(saved)) { S.key = saved; boot(); return; }
    resetData();
    S.bootError = msg;
    S.bootHint = STALE_KEY;
    S.boot = 'welcome';
  }
  // « Oublier ce navigateur » : la clé, les classeurs connus, la clé d'import, les caches de Wikipédia et les cartes
  // gardées (toutes, ou seulement celles du compte `user` : classeur supprimé).
  function forgetKey(user) {
    for (const k of Object.values(LS)) store.del(k);
    pvCache.clear();
    suggCache.clear();
    natGroupCache.clear();
    if (resolver) resolver.clear();
    if (proposer) proposer.clearCache();
    cancelProposals();
    catSuggCache.clear();
    S.wp.list = [];
    S.key = null;
    S.known = [];
    resetData();
    if (user) cardCache.del(user); else cardCache.clear();
    S.bootError = '';
    S.bootHint = '';
    S.linkError = '';
    S.welcome.created = null;
    S.boot = 'welcome';
  }

  // Clé gardée qui n'ouvre plus rien (accueil) : on l'oublie, sans toucher aux autres classeurs connus.
  function dropStaleKey() {
    if (S.key) { forgetKnown(S.key); cardCache.dropKey(keyTag(S.key)); }
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
    const gen = cardsGen;
    const pg = prefsPending ? null : prefsGen;
    const me = await api('GET', '/api/me');
    if (gen !== cardsGen) return me; // classeur changé entre-temps (resetData) : réponse de l'ancien, écartée
    S.me = me;
    if (S.key && me.user) remember(S.key, me.user.name || '');
    chatNote(me); // dernier message du chat (badge des non-lus)
    // Préférences changées ici (savePrefs) avant la réponse, ou encore en route à l'envoi : la réponse peut les précéder,
    // elle ne les remplace pas.
    if (me.prefs !== undefined && pg === prefsGen && !prefsPending) S.prefs = normPrefs(me.prefs);
    return me;
  }
  function prepCard(c) {
    const tags = Array.isArray(c.tags) ? c.tags.map(String) : [];
    return markRaw({ ...c, title: String(c.title || ''), tags, _k: fold(`${c.title || ''} ${c.category || ''}`) });
  }
  // Relecture complète. Rend true si les cartes ont été remplacées (false : classeur changé entre-temps).
  async function loadCards() {
    // Lecture par morceaux (?part=0, puis next_part renvoyé tel quel jusqu'à null) : une grosse collection d'un coup
    // dépasserait le temps de calcul d'un Worker gratuit. next_part peut être un nombre ou une chaîne opaque.
    const gen = cardsGen;
    const edited = new Set();
    tagWatch.add(edited);
    try {
      const all = [];
      let r = null;
      let part = 0;
      let rev = null;
      for (let guard = 0; guard < 500; guard++) {
        r = await api('GET', '/api/cards?part=' + encodeURIComponent(String(part)));
        if (gen !== cardsGen) return false;
        if (guard === 0) rev = r.rev; // révision lue avant les cartes : celle de la première page
        if (Array.isArray(r.cards)) all.push(...r.cards);
        const next = r.next_part;
        if (next === null || next === undefined || next === '' || next === part) break;
        part = next;
      }
      cards.value = all.map((c) => prepCard(keepLocalTags(c, edited)));
      newIds.value = Array.isArray(r.new_ids) ? r.new_ids : [];
      S.fetchedAt = r.fetched_at || null;
      cardsRev = Number.isInteger(rev) ? rev : null;
      purgeGone();
      saveCardCache();
      return true;
    } finally {
      tagWatch.delete(edited);
    }
  }
  function purgeGone() {
    if (S.openId && !cardById.value.has(S.openId)) S.openId = null;
    for (const id of [...S.selected]) if (!cardById.value.has(id)) S.selected.delete(id);
  }
  function keepLocalTags(raw, edited) {
    const cur = raw && edited.has(String(raw.id)) ? cardById.value.get(raw.id) : null;
    return cur ? { ...raw, tags: cur.tags } : raw;
  }
  // Les lectures de cartes passent l'une après l'autre ; celles d'un autre classeur (resetData entre-temps) sont sautées.
  function queueCards(fn) {
    const gen = cardsGen;
    const run = cardsJob.then(() => (gen === cardsGen ? fn() : false));
    cardsJob = run.catch(() => {});
    return run;
  }
  // Mise à jour des cartes déjà chargées : seulement ce qui a changé depuis la révision connue (GET /api/cards?since=).
  // Relecture complète (loadCards) sans révision (premier chargement, ancien serveur), si le serveur répond delta:false
  // (révision inconnue ou trop ancienne, plus de 1 000 changements), en cas d'erreur, ou si `me` (réponse de GET
  // /api/me, facultative) annonce une révision plus petite que la nôtre (base recréée). Même cards_rev et même
  // fetched_at que les cartes affichées : rien à demander. Rend true si les cartes ont changé.
  const syncCards = (me) => queueCards(() => doSyncCards(me));
  async function doSyncCards(me) {
    const gen = cardsGen;
    const srv = me && Number.isInteger(me.cards_rev) ? me.cards_rev : null;
    if (cardsRev !== null && srv === cardsRev && (me.fetched_at || null) === (S.fetchedAt || null)) return false;
    if (cardsRev !== null && (srv === null || srv >= cardsRev)) {
      const from = cardsRev;
      const edited = new Set();
      tagWatch.add(edited);
      try {
        const r = await api('GET', '/api/cards?since=' + encodeURIComponent(String(from)));
        if (gen !== cardsGen) return false;
        if (r && r.delta === true && Number.isInteger(r.rev) && r.rev >= from) {
          const before = S.fetchedAt;
          const changed = applyDelta(r, edited);
          if (Array.isArray(r.new_ids)) newIds.value = r.new_ids;
          if ('fetched_at' in r) S.fetchedAt = r.fetched_at || null;
          cardsRev = r.rev;
          if (changed) purgeGone();
          if (changed || r.rev !== from || S.fetchedAt !== before) saveCardCache();
          return changed;
        }
      } catch (e) {
        if (gen !== cardsGen) return false; // sinon : relecture complète ci-dessous
      } finally {
        tagWatch.delete(edited);
      }
    }
    return loadCards();
  }
  // Delta : cartes ajoutées ou modifiées (remplacées à leur place, les nouvelles à la fin), cartes retirées (`gone`).
  function applyDelta(r, edited) {
    const gone = new Set((Array.isArray(r.gone) ? r.gone : []).map(String));
    const incoming = new Map();
    for (const c of Array.isArray(r.cards) ? r.cards : []) if (c && c.id != null) incoming.set(String(c.id), c);
    if (!gone.size && !incoming.size) return false;
    const next = [];
    for (const c of cards.value) {
      const k = String(c.id);
      const n = incoming.get(k);
      if (n) { next.push(prepCard(keepLocalTags(n, edited))); incoming.delete(k); } else if (!gone.has(k)) next.push(c);
    }
    for (const n of incoming.values()) next.push(prepCard(n));
    cards.value = next;
    return true;
  }
  // Ouverture : les cartes gardées dans ce navigateur s'affichent avant toute lecture au serveur, si celui-ci annonce
  // une révision (cards_rev) qui n'est pas plus petite que celle du cache (sinon, base recréée : cache effacé).
  async function showCachedCards(me) {
    const user = me && me.user && me.user.id;
    if (!user || !Number.isInteger(me.cards_rev)) return false;
    const gen = cardsGen;
    const rec = await cardCache.get(user);
    if (gen !== cardsGen || !rec || rec.v !== 1 || rec.user !== user || !Number.isInteger(rec.rev) || !Array.isArray(rec.cards)) return false;
    if (rec.rev > me.cards_rev) { cardCache.del(user); return false; }
    try {
      cards.value = rec.cards.filter((c) => c && c.id != null).map(prepCard);
    } catch (e) {
      cards.value = [];
      return false;
    }
    newIds.value = Array.isArray(rec.new_ids) ? rec.new_ids : [];
    S.fetchedAt = rec.fetched_at || null;
    cardsRev = rec.rev;
    return true;
  }
  // Cache écrit après chaque chargement ou delta, regroupé (1,5 s), jamais à chaque tag : la lecture suivante rapporte
  // les cartes modifiées ici (leur modification fait avancer la révision du serveur).
  function saveCardCache() {
    const user = S.me && S.me.user && S.me.user.id;
    if (!user || cardsRev === null || !S.key) return;
    const gen = cardsGen;
    const tag = keyTag(S.key);
    clearTimeout(cacheTimer);
    cacheWrite = () => {
      cacheWrite = null;
      if (gen !== cardsGen || cardsRev === null) return;
      const list = cards.value.map(({ _k, ...c }) => c);
      cardCache.put({ v: 1, user, keyTag: tag, rev: cardsRev, fetched_at: S.fetchedAt, new_ids: newIds.value.slice(), saved_at: new Date().toISOString(), cards: list });
    };
    cacheTimer = setTimeout(() => { cacheTimer = null; if (cacheWrite) cacheWrite(); }, 1500);
  }
  const prepTarget = (t) => markRaw({ ...t, items: Array.isArray(t.items) ? t.items : [] });
  // Après chaque chargement des cartes : qids manquants (toutes les collections), propositions d'après les
  // catégories de tes cartes (sauf si tu les as masquées).
  function afterCards() {
    resolveQids(collections.value.all.flatMap((c) => c.items), false, 'all'); // à part de celle de l'album ouvert
    if (!S.prefs.hide_proposals) computeProposals(false);
    loadMarket(false); // valeur et cotes (les cartes ont pu changer)
  }
  async function loadTargets() {
    const gen = cardsGen;
    const r = await api('GET', '/api/targets');
    if (gen !== cardsGen) return; // collections de l'ancien classeur : écartées
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
    const gen = cardsGen; // un autre boot (lien suivant, changement de classeur) l'emporte sur celui-ci
    let me;
    try {
      me = await api('GET', '/api/me', undefined, { key: raw });
    } catch (e) {
      if (gen === cardsGen) S.linkError = e.status === 401 ? UNKNOWN_LINK : e.message;
      return;
    }
    if (gen !== cardsGen) return;
    const name = (me.user && me.user.name) || '';
    if (S.key) {
      let mine = null;
      try {
        mine = await api('GET', '/api/me', undefined, { key: S.key });
      } catch (e) {
        if (e.status !== 401) mine = { user: null };
      }
      if (gen !== cardsGen) return;
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

  // Un boot qui en suit un autre (changement de classeur, lien ouvert pendant le chargement) l'emporte : le premier
  // s'arrête à son prochain await (cardsGen a changé avec resetData), sans toucher à l'état du nouveau classeur.
  async function boot(linkKey) {
    S.boot = 'loading';
    resetData();
    const gen = cardsGen;
    const stale = () => gen !== cardsGen;
    loadKnown();
    await loadHealth();
    if (stale()) return;
    if (linkKey != null) await adoptLinkKey(linkKey);
    if (stale()) return;
    const ask = S.switchAsk;
    if (!S.key) { S.boot = 'welcome'; return; }
    try {
      await loadMe();
    } catch (e) {
      if (stale()) return;
      S.bootError = e.message;
      S.bootHint = e.status === 401 ? STALE_KEY : '';
      S.boot = 'welcome';
      return;
    }
    if (stale()) return;
    S.bootError = '';
    S.bootHint = '';
    S.boot = 'app';
    if (S.linkError) { notify(S.linkError, true); S.linkError = ''; }
    if (ask) { S.switchAsk = ask; S.modal = 'switch'; }
    S.loadingCards = true;
    const side = loadTargets().catch((e) => { if (!stale()) notify(e.message, true); });
    // Cartes gardées dans ce navigateur d'abord (tout de suite), puis seulement ce qui a changé depuis.
    if (await queueCards(() => showCachedCards(S.me)).catch(() => false) && !stale()) S.loadingCards = false;
    await Promise.all([syncCards(S.me).catch((e) => { if (!stale()) notify(e.message, true); }), side]);
    if (stale()) return;
    S.loadingCards = false;
    afterCards();
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
    if (!sess.has_cookie || sess.expired) { openSync(); return; }
    await runRefresh();
  }
  // Sans cookie, le classeur ne peut pas lire le jeu : c'est le favori, cliqué sur wiki-masters.com, qui envoie les
  // cartes. La fenêtre guide l'utilisateur, puis surveille l'arrivée de l'envoi (GET /api/me toutes les 4 s, 15 min au
  // plus, seulement pendant qu'elle est ouverte) et recharge la collection dès qu'il est là. Les autres classeurs connus
  // ne sont relus qu'à l'ouverture, puis toutes les 30 s pendant les 3 premières minutes : chaque GET /api/me compte les
  // cartes de son compte sur le serveur (lignes lues, sur le quota quotidien de la base).
  const SYNC_OTHERS_EVERY = 30 * 1000;
  const SYNC_OTHERS_FOR = 3 * 60 * 1000;
  let syncTimer = null;
  function stopSync() { if (syncTimer) { clearInterval(syncTimer); syncTimer = null; } }
  function openSync() {
    if (S.modal) closeModal();
    const sess = (S.me && S.me.session) || {};
    Object.assign(S.sync, { done: false, msg: '', before: S.me ? S.me.fetched_at || null : null, expired: !!(sess.has_cookie && sess.expired), hasFavori: !!storedImportKey() || !!(S.me && S.me.has_import_key), others: {}, elsewhere: null });
    // Les autres classeurs connus de ce navigateur (un ami, un second compte) : le favori envoie vers le classeur pour
    // lequel il a été créé, qui n'est pas forcément celui ouvert ici. On note leur dernier envoi pour repérer le bon.
    const others = S.known.filter((k) => k.key !== S.key).slice(0, 6);
    for (const k of others) {
      api('GET', '/api/me', undefined, { key: k.key })
        .then((m) => { if (S.modal === 'sync') S.sync.others[k.key] = { name: (m.user && m.user.name) || k.name || '', at: m.fetched_at || null }; })
        .catch(() => {});
    }
    S.modal = 'sync';
    stopSync();
    const started = Date.now();
    let othersAt = started; // dernière relecture des autres classeurs (la première : à l'ouverture, ci-dessus)
    let busy = false;
    syncTimer = setInterval(async () => {
      if (S.modal !== 'sync' || S.sync.done || Date.now() - started > 15 * 60 * 1000) { stopSync(); return; }
      if (busy) return;
      busy = true;
      try {
        await loadMe();
        const now = S.me && S.me.fetched_at;
        // Envoi arrivé dans un autre classeur de ce navigateur ? (toutes les 30 s, pendant 3 min)
        const t = Date.now();
        if (!(now && now !== S.sync.before) && !S.sync.elsewhere && t - started <= SYNC_OTHERS_FOR && t - othersAt >= SYNC_OTHERS_EVERY) {
          othersAt = t;
          for (const [k, o] of Object.entries(S.sync.others)) {
            const m = await api('GET', '/api/me', undefined, { key: k }).catch(() => null);
            if (m && m.fetched_at && m.fetched_at !== o.at) { S.sync.elsewhere = { key: k, name: (m.user && m.user.name) || o.name || '' }; break; }
          }
        }
        if (now && now !== S.sync.before) {
          stopSync();
          const newCount = Array.isArray(S.me.new_ids) ? S.me.new_ids.length : 0;
          await syncCards(S.me);
          startPageviews();
          afterCards();
          S.sync.done = true;
          S.sync.msg = `Collection mise à jour : ${cards$(cards.value.length)}${newCount ? ', ' + fmt(newCount) + ' ' + plural(newCount, 'nouvelle', 'nouvelles') : ''}.`;
          notify(S.sync.msg);
        }
      } catch (e) { /* le prochain tour réessaie */ } finally { busy = false; }
    }, 4000);
  }
  async function runRefresh() {
    if (S.refresh.running) return;
    Object.assign(S.refresh, { running: true, error: false, warn: false, msg: 'Lecture de ta collection sur WikiMasters…' });
    try {
      let page = 0;
      let res = null;
      for (let guard = 0; guard < 5000; guard++) {
        // Relecture complète demandée (onglet « Mettre à jour ») : jamais de synchro rapide.
        res = await api('POST', '/api/refresh', page === 0 && S.me && S.me.next_full ? { page, full: true } : { page });
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
      await Promise.all([syncCards(), loadMe()]);
      startPageviews();
      afterCards();
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
    S.catSearch.enter = false; // Entrée en attente dans la recherche des catégories : oubliée (on est passé ailleurs)
    if (tab === 'reglages') Object.assign(S.settings, { name: (S.me && S.me.user && S.me.user.name) || '', busy: false, error: '', saved: false });
    if (tab === 'maj') prepareFavori();
    if (tab === 'amis') loadFriends(true);
    if (tab === 'marche') loadMarket(Date.now() - M.at > 20000); // les cotes ont pu être relues dans le jeu entre-temps
    toTop();
  }
  function resetFilters() {
    Object.assign(S, { q: '', tagFilter: [], untaggedOnly: false, newOnly: false, rarities: [] });
  }
  function openAlbum(kind, id) {
    if (kind !== 'category') stopCategory();
    S.album = { kind, id };
    S.tab = 'collections';
    S.catSearch.enter = false;
    Object.assign(S, { albumFilter: 'all', albumSort: 'order', albumLimit: ALBUM_PAGE, lastClicked: null });
    S.selected.clear();
    ensureFriends(); // badges « chez Paul » des cases vides
    toTop();
  }
  function closeAlbum() { stopCategory(); S.album = null; S.catSearch.enter = false; S.selected.clear(); toTop(); }
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
    for (const w of tagWatch) for (const id of ids) w.add(String(id));
    cards.value = cards.value.map((c) => (set.has(c.id) ? markRaw({ ...c, tags: fn(c.tags) }) : c));
  }
  const renameLocal = (from, to) => applyTags(cards.value.filter((c) => c.tags.includes(from)).map((c) => c.id), (tags) => [...new Set(tags.map((t) => (t === from ? to : t)))]);
  async function bulk(mode) {
    const tag = composeTag(S.bulkTag, S.bulkCat);
    if (!tag || S.bulkBusy) return;
    const ids = [...S.selected];
    S.bulkBusy = true;
    S.bulkError = '';
    try {
      await api('POST', '/api/tags/bulk', { card_ids: ids, add: mode === 'add' ? [tag] : [], remove: mode === 'remove' ? [tag] : [] });
      applyTags(ids, (tags) => (mode === 'add' ? addTo(tags, tag) : tags.filter((t) => t !== tag)));
      S.bulkTag = '';
      notify(mode === 'add' ? `« ${tagTitle(tag)} » ajouté à ${cards$(ids.length)}.` : `« ${tagTitle(tag)} » retiré de ${cards$(ids.length)}.`);
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
    const t = composeTag(S.drawer.newTag, S.drawer.newCat);
    if (!t) return;
    if (card.tags.includes(t)) { S.drawer.newTag = ''; return; }
    if (card.tags.length >= 30) { S.drawer.error = '30 tags au plus par carte.'; return; }
    if (await setTags(card, [...card.tags, t])) S.drawer.newTag = '';
  }
  function openCardById(id) {
    if (S.modal) closeModal();
    S.openMissing = null;
    S.openId = id;
    S.drawer.error = '';
    S.drawer.newTag = '';
    const c = cardById.value.get(id);
    if (c && !hasSugg(c.title)) loadCardSuggestions(c);
  }
  let lastFocus = null;
  function openCardFrom(id, ev) {
    lastFocus = ev && ev.currentTarget ? ev.currentTarget : document.activeElement;
    openCardById(id);
  }
  // Case vide d'une collection : fiche de la carte qui te manque (description, rareté estimée, marché, Wikipédia).
  function openMissingFrom(item, ev) {
    lastFocus = ev && ev.currentTarget ? ev.currentTarget : document.activeElement;
    if (S.modal) closeModal();
    S.openId = null;
    S.openMissing = markRaw({ ...item }); // copie figée : la fiche lit les vues et la vignette dans le cache, en direct
    ensureFriends(); // « Chez : Paul (×2), Léa »
  }
  function closeCard() {
    S.openId = null;
    S.openMissing = null;
    const el = lastFocus;
    lastFocus = null;
    if (el && document.contains(el)) nextTick(() => el.focus());
  }

  function openTagEdit(name) {
    S.tagEdit = { from: name, to: tagSub(name), cat: tagCat(name), busy: false, error: '', confirmDelete: false };
    S.modal = 'tag';
  }
  async function renameTag(te) {
    const to = composeTag(te.to, te.cat);
    if (!to) { te.error = 'Donne un nom au tag.'; return; }
    if (to === te.from) { closeModal(); return; }
    te.busy = true;
    te.error = '';
    try {
      await api('POST', '/api/tags/rename', { from: te.from, to });
      renameLocal(te.from, to);
      S.tagFilter = [...new Set(S.tagFilter.map((t) => (t === te.from ? to : t)))];
      closeModal();
      notify(`Tag « ${tagTitle(te.from)} » renommé en « ${tagTitle(to)} ».`);
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
      mode: t ? 'liste' : 'mots',
      kw: { q: '', searching: false, error: '', interp: '', cands: [], chosen: null, searched: '' },
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
        const item = { title: it.title, description: it.description || null, image: it.image || null, status: it.status || 'ok' };
        if (it.qid) item.qid = it.qid;
        if (realRarity(it)) item.rarity = it.rarity; // rareté du jeu (collection créée par le favori) : gardée
        items.push(item);
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

  // ---------------------------------------------------------------- fenêtres, réglages, favori
  function closeModal() {
    const m = S.modal;
    S.modal = null;
    if (m === 'editor') S.editor = null;
    if (m === 'confirm') S.confirm = null;
    if (m === 'tag') S.tagEdit = null;
    if (m === 'switch') S.switchAsk = null;
    if (m === 'editor') kwAbort();
    if (m === 'arrange') { if (arrangeCtrl) arrangeCtrl.abort(); S.arrange = null; }
    if (m === 'sync') stopSync();
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
      text: "Tes cartes rangées, tes tags, tes collections à compléter et ta session WikiMasters seront effacés du classeur, tes messages du chat aussi (pour tout le monde), et ton lien ne marchera plus. C'est définitif. Ta collection dans le jeu n'est pas touchée.",
      ok: 'Supprimer mon classeur',
      danger: true,
      run: async () => {
        const key = S.key;
        const user = S.me && S.me.user && S.me.user.id;
        await api('DELETE', '/api/me');
        forgetKnown(key);
        const others = S.known.slice();
        // Clés d'import (favoris) des autres comptes : gardées ; seule celle du classeur supprimé part.
        const favoris = user ? importKeys() : {};
        if (user) delete favoris[user];
        forgetKey(user || undefined);
        // Les autres classeurs ouverts dans ce navigateur restent connus, avec leur favori.
        S.known = others;
        saveKnown();
        if (Object.keys(favoris).length) store.set(LS.importKey, JSON.stringify(favoris));
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
    S.openMissing = null;
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
      if (me) store.set(LS.importKey, JSON.stringify({ ...importKeys(), [me.id]: r.import_key }));
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
  // Met bookmarklet.js sur une ligne (commentaires en lignes à part, instructions finies par « ; ») et y place l'adresse
  // du classeur et la clé.
  function favoriCode(src, site, key) {
    return src.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join(' ')
      .replace('"__SITE__"', JSON.stringify(site)).replace('"__KEY__"', JSON.stringify(key));
  }
  // Le favori : une adresse javascript: (encodeURI, plus « # » qui couperait l'adresse).
  function makeBookmarklet(src, site, key) {
    return 'javascript:' + encodeURI(favoriCode(src, site, key)).replace(/#/g, '%23');
  }
  // Le script Tampermonkey / Violentmonkey (facultatif) : le même code, avec "__START__" = "load" (relié dès le
  // chargement de chaque page du jeu, rien n'est lu avant une action du joueur), sous l'en-tête du gestionnaire.
  // @grant none : il tourne dans la page, comme le favori (il doit voir le window.fetch de la page).
  function makeUserscript(src, site, key) {
    return ['// ==UserScript==', '// @name         Le classeur, relié à WikiMasters', `// @namespace    ${site}`, '// @version      1',
      '// @description  Après tes actions dans le jeu (paquet, défausse, enchère, échange), relit tes nouvelles cartes et les envoie à ton classeur. Lecture seule.',
      '// @match        https://www.wiki-masters.com/*', '// @match        https://wiki-masters.com/*', '// @run-at       document-idle',
      '// @grant        none', '// @noframes', '// ==/UserScript==', favoriCode(src, site, key).replace('"__START__"', '"load"'), ''].join('\n');
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
  // « Copier le nom » : le titre de la carte dans le presse-papiers ; le bouton affiche « Nom copié » 2 secondes.
  function copyName(title, id) {
    const done = (ok) => {
      if (!ok) { notify(`Copie impossible ici : le nom de la carte est « ${title} ».`, true); return; }
      S.copied = id;
      setTimeout(() => { if (S.copied === id) S.copied = ''; }, 2000);
    };
    try { navigator.clipboard.writeText(title).then(() => done(true), () => done(false)); } catch (e) { done(false); }
  }

  // ---------------------------------------------------------------- préférences du compte (propositions retirées ou masquées)
  // hidden_proposals : catégories proposées retirées (« wp:<nom> ») ; hide_proposals : propositions masquées. Anciennes
  // préférences (avant le retrait du catalogue, 2026-10-16) : hidden_catalog (ids du catalogue et « wp:<nom> ») et
  // hide_catalog sont encore lus, repris ici (les ids du catalogue n'ont plus d'usage) et ne sont plus réécrits.
  function normPrefs(p) {
    const o = p && typeof p === 'object' && !Array.isArray(p) ? { ...p } : {};
    const list = [...(Array.isArray(o.hidden_proposals) ? o.hidden_proposals : []), ...(Array.isArray(o.hidden_catalog) ? o.hidden_catalog : [])];
    o.hidden_proposals = [...new Set(list.filter((x) => typeof x === 'string' && x.startsWith('wp:')))];
    o.hide_proposals = typeof o.hide_proposals === 'boolean' ? o.hide_proposals : !!o.hide_catalog;
    delete o.hidden_catalog;
    delete o.hide_catalog;
    return o;
  }
  // Remplace les préférences (objet entier) ; gardées en mémoire même si le serveur refuse, et l'erreur est affichée.
  // prefsGen avance à chaque changement fait ici, prefsPending compte ceux en route : une lecture de GET /api/me
  // (retour sur l'onglet, minuterie des 60 s) partie avant, ou pendant, ne les défait pas (loadMe).
  let prefsGen = 0;
  let prefsPending = 0;
  async function savePrefs(patch) {
    const gen = cardsGen;
    const g = ++prefsGen;
    prefsPending++;
    S.prefs = normPrefs({ ...S.prefs, ...patch });
    try {
      const r = await api('PATCH', '/api/me', { prefs: S.prefs });
      const back = (r && r.prefs) || (r && r.user && r.user.prefs);
      if (back && gen === cardsGen && g === prefsGen) S.prefs = normPrefs(back);
      return true;
    } catch (e) {
      if (gen === cardsGen) notify(e.message, true);
      return false;
    } finally {
      prefsPending--;
    }
  }
  // Masquer ou afficher les propositions (rien n'est cherché sur Wikipédia tant qu'elles sont masquées : un calcul en
  // cours s'arrête tout de suite).
  async function setHideProposals(hide) {
    if (hide) cancelProposals();
    await savePrefs({ hide_proposals: !!hide });
    if (!hide) computeProposals(false);
  }
  const restoreProposals = async () => { await savePrefs({ hidden_proposals: [] }); computeProposals(true); };

  // ---------------------------------------------------------------- propositions d'après les catégories Wikipédia (propose.js)
  const Propose = window.ClasseurPropose || null;
  const proposer = Propose ? Propose.createProposer({}) : null;
  let wpCtrl = null;
  // Déjà en collection (source « wp:<nom> ») ou retirées : jamais proposées.
  const wpExclude = () => [...targets.value.map((t) => t.source).filter(isCatSource), ...S.prefs.hidden_proposals];
  // Automatique au plus une fois par semaine, ou quand presque tout est déjà en cache ; à la main avec le bouton.
  async function computeProposals(manual) {
    if (!proposer || !cards.value.length) return;
    if (wpCtrl) { if (!manual) return; wpCtrl.abort(); }
    const titles = cards.value.map((c) => c.title);
    if (!manual) {
      const at = Number(store.get(LS.proposeAt)) || 0;
      if (Date.now() - at < 7 * DAY && proposer.uncached(titles) > 500) return;
    }
    const ctrl = new AbortController();
    wpCtrl = ctrl;
    Object.assign(S.wp, { running: true, done: 0, total: 0, label: 'Recherche de propositions…', error: '' });
    try {
      const list = await proposer.compute(titles, { signal: ctrl.signal, exclude: wpExclude(),
        onProgress: (p) => { if (wpCtrl === ctrl) Object.assign(S.wp, { done: p.done || 0, total: p.total || 0, label: p.label || '' }); } });
      if (wpCtrl !== ctrl) return;
      S.wp.list = markRaw(list);
      store.set(LS.proposeAt, String(Date.now()));
    } catch (e) {
      if (wpCtrl === ctrl && e.name !== 'AbortError') S.wp.error = e.message;
    } finally {
      if (wpCtrl === ctrl) { wpCtrl = null; S.wp.running = false; }
    }
  }
  function cancelProposals() { if (wpCtrl) wpCtrl.abort(); wpCtrl = null; S.wp.running = false; }
  // Propositions affichées : ni masquées, ni retirées, ni déjà en collection (source « wp:<nom> »).
  // Puis, sans requête (propose.js, prune) : ni celles déjà « couvertes » par une de tes collections (au moins 80 % des
  // cartes qui la rendent proposable y sont déjà ; ce qui écarte aussi les filles d'une catégorie dont tu as une
  // collection avec ses sous-catégories), ni les sous-catégories d'une catégorie elle-même proposée : la parente seule
  // reste et les regroupe (p.subs), « Créer une collection » la prend avec ses sous-catégories. Une collection faite
  // d'une catégorie sans ses sous-catégories n'écarte pas ses filles (ses articles directs ne les contiennent pas).
  // wpPruned.covered : nombre de catégories couvertes, coveredBy : [nom, nombre] de la collection qui en couvre le plus
  // (pour le dire).
  const COVERED_MIN = 0.8;
  const wpPruned = computed(() => {
    const none = { list: [], covered: 0, coveredBy: null };
    if (S.prefs.hide_proposals) return none;
    const hidden = new Set(S.prefs.hidden_proposals);
    const added = new Set(targets.value.map((t) => t.source).filter(Boolean));
    const list = S.wp.list.filter((p) => !hidden.has(p.key) && !added.has(p.key));
    if (!Propose || typeof Propose.prune !== 'function') return { ...none, list };
    const by = new Map();
    const stats = {};
    const covered = (p) => {
      const col = coveringCol(p);
      if (col) by.set(col.name, (by.get(col.name) || 0) + 1);
      return !!col;
    };
    const kept = Propose.prune(list, { covered, stats });
    const top = [...by].sort((a, b) => b[1] - a[1])[0];
    return { list: kept, covered: stats.covered || 0, coveredBy: top || null };
  });
  const wpVisible = computed(() => wpPruned.value.list);
  // Cartes de chaque collection (ids des cartes qui y remplissent une case, titre puis qid).
  const colCardIds = computed(() => {
    void qidVersion.value;
    return collections.value.all.map((col) => {
      const ids = new Set();
      for (const it of col.items) { const c = findCard(it); if (c) ids.add(c.id); }
      return { col, ids };
    });
  });
  // Collection (quelle qu'en soit la source) qui contient déjà au moins 80 % des cartes qui rendent une proposition
  // proposable (p.cards : celles comptées pour les 5 % et les 2 cartes) ; null sinon.
  function coveringCol(p) {
    const ids = [...new Set((p.cards || []).map((t) => { const l = byTitle.value.get(normTitle(t)); return l ? l[0].id : null; }).filter(Boolean))];
    if (!ids.length) return null;
    for (const { col, ids: inCol } of colCardIds.value) {
      let n = 0;
      for (const id of ids) if (inCol.has(id)) n++;
      if (n >= COVERED_MIN * ids.length) return col;
    }
    return null;
  }
  // Articles de la collection créée d'une proposition : ceux de la catégorie (3 000 au plus) ; si elle en regroupe d'autres (p.subs :
  // propositions cachées sous elle), aussi ceux de ses sous-catégories (1 niveau) et des propositions regroupées plus bas
  // (petites-filles…). Plus de 3 000 ainsi : ses articles et ceux des seules propositions regroupées ; encore trop : erreur.
  async function proposalMembers(p) {
    if (!p.subs || !p.subs.length) return { members: await proposer.loadMembers(p.title, {}), withSubs: false };
    const byName = new Map(S.wp.list.map((x) => [x.name, x]));
    const direct = (n) => { const q = byName.get(n); return !!q && (q.parents || []).map(catName).includes(p.name); };
    const out = new Map();
    const add = (list) => { for (const m of list) if (!out.has(m.title)) out.set(m.title, m); };
    add(await categoryMembers(p.title, true, null));
    for (const n of p.subs) {
      if (out.size > 3000) break;
      if (!direct(n)) add(await categoryMembers(CAT_NS + n, false, null));
    }
    if (out.size > 3000) {
      out.clear();
      add(await categoryMembers(p.title, false, null));
      for (const n of p.subs) { if (out.size > 3000) break; add(await categoryMembers(CAT_NS + n, false, null)); }
    }
    if (out.size > 3000) throw new Error(`« ${p.name} » et les catégories qu'elle regroupe ont plus de 3 000 articles : trop pour une collection. Ouvre-la pour en faire une collection sans ses sous-catégories.`);
    return { members: [...out.values()], withSubs: true };
  }
  // « Créer une collection » d'une proposition : ses articles (directement dans la catégorie, 3 000 au plus ; avec ses
  // sous-catégories si elle en regroupe) deviennent une collection à compléter de source « wp:<nom> », nommée comme la
  // catégorie, dans « Mes collections ». On reste sur la liste. Classeur changé pendant la lecture (resetData) : rien
  // n'est enregistré.
  async function createFromProposal(p) {
    if (S.wp.busy[p.key] || !proposer) return;
    const gen = cardsGen;
    const stale = () => gen !== cardsGen;
    S.wp.busy[p.key] = true;
    try {
      const { members, withSubs } = await proposalMembers(p);
      if (stale()) return;
      // Créée entre-temps (depuis son album, un autre onglet…) : pas de seconde collection, celle qui existe s'ouvre.
      const t0 = collectionFor(p.key);
      if (t0) { openAlbum('target', t0.id); return; }
      if (!members.length) throw new Error('Cette catégorie ne contient plus d\'articles.');
      const items = members.map((m) => ({ title: m.title, description: null, image: null, status: 'ok' }));
      const name = p.name.length > 80 ? p.name.slice(0, 79) + '…' : p.name;
      const r = await api('POST', '/api/targets/save', { name, items, source: p.key });
      if (stale()) return;
      if (r.target) upsertTarget(r.target); else { await loadTargets(); if (stale()) return; }
      S.wp.list = markRaw(S.wp.list.filter((x) => x.key !== p.key));
      // Son album ouvert pendant la création (par son nom ou la recherche) : il devient celui de la nouvelle collection.
      const t = collectionFor(p.key);
      if (t && S.album && S.album.kind === 'category' && S.album.id === p.key) { stopCategory(); S.album = { kind: 'target', id: t.id }; }
      notify(`Collection « ${name} » créée : ${fmt(items.length)} ${plural(items.length, 'article', 'articles')}${withSubs ? ', sous-catégories comprises' : ''}, dans « Mes collections ».`);
    } catch (e) {
      if (!stale()) notify(e.message, true);
    } finally {
      if (!stale()) S.wp.busy[p.key] = false;
    }
  }
  function askHideWp(p) {
    openConfirm({
      title: `Retirer « ${p.name} » des propositions ?`,
      text: 'Cette catégorie ne te sera plus proposée. Tu pourras la rétablir sous « Proposées d\'après tes cartes », ou la retrouver avec la recherche des catégories.',
      ok: 'Retirer des propositions',
      run: async () => {
        await savePrefs({ hidden_proposals: [...S.prefs.hidden_proposals, p.key] });
        S.wp.list = markRaw(S.wp.list.filter((x) => x.key !== p.key));
      },
      after: () => notify(`« ${p.name} » retirée des propositions.`),
    });
  }

  // ---------------------------------------------------------------- « Catégories » : recherche, album d'une catégorie ou d'une page, collection
  // Une catégorie de Wikipédia (« Catégorie:Violet ») et les liens d'une page (« Liste de noms de couleur ») sont des
  // SOURCES de collection. Elles se cherchent par leur nom, au fil de la frappe : 250 ms après la dernière frappe, dans
  // la file de Wikipédia (wikiQ : une requête à la fois, 429 et Retry-After respectés), la recherche précédente
  // abandonnée, réponses gardées en mémoire le temps de la visite ; trois requêtes au plus (suggestSources) :
  // 1. les catégories par préfixe (generator=prefixsearch, espace 14, avec categoryinfo) et, dans la même requête, les
  //    pages « Liste de… » (list=search, intitle:liste) et les articles par préfixe (list=prefixsearch, espace 0 : leurs
  //    noms sont souvent ceux des catégories principales, « Violence », « Violon ») ;
  // 2. des titres exacts (titles=, avec categoryinfo) : « Catégorie:<texte> » et sa forme au singulier (le préfixe de
  //    Wikipédia classe par popularité : la catégorie exacte peut lui manquer), les catégories du nom de ces articles,
  //    « Liste de <texte> », « Liste des <texte> », ou le texte lui-même s'il commence par « Liste » ;
  // 3. seulement s'il reste moins de CAT_MORE catégories : la recherche plein texte des catégories (generator=search),
  //    dont on ne garde que celles qui ont tous les mots du texte.
  // Catégories cachées, de maintenance ou vides écartées. Classement (nameRank) : nom exact (ou titre exact atteint par
  // une redirection), puis qui commence par le texte, puis dont un mot commence par le texte, puis le reste ; à rang
  // égal, la catégorie qui a le plus d'articles d'abord (pages : l'ordre de la recherche). Deux groupes, « Catégories »
  // (CAT_MAX au plus) et « Pages de liste » (PAGE_MAX au plus), SUGG_MAX en tout, celui qui a le meilleur rang d'abord.
  // L'adresse d'une page de fr.wikipedia.org (wpTitleFromUrl) : une seule requête, la page elle-même, catégorie ou toute
  // autre page (suggestFromUrl) ; collée (et pas tapée), elle s'ouvre aussitôt.
  // Ouverte, une catégorie montre ses articles (categoryMembers), une page les articles qu'elle lie (pageLinks : ceux de
  // sa nature dominante, ou tous), comme un album ; « Créer une collection » en fait une collection à compléter de source
  // « wp:<nom> » ou « links:<titre> », dans « Mes collections » (déjà faite : « Ouvrir ta collection »).
  const CAT_NS = 'Catégorie:';
  const CAT_MAX = 8;
  const CAT_MORE = 5; // moins de catégories après les deux premières requêtes : la recherche plein texte complète
  const PAGE_MAX = 4;
  const SUGG_MAX = 10;
  const catName = (t) => (Propose ? Propose.displayName(t)
    : cap(String(t || '').replace(/^wp:/, '').replace(/_/g, ' ').replace(/^(?:Catégorie|Category)\s*:\s*/i, '').replace(/\s+/g, ' ').trim()));
  // Texte cherché : sans « Catégorie: » (on cherche déjà dans l'espace des catégories).
  const catQuery = (q) => String(q || '').replace(/_/g, ' ').replace(/^\s*(?:Catégorie|Category)\s*:\s*/i, '').replace(/\s+/g, ' ').trim();
  // Nom d'une collection faite des liens d'une page : « Liste de noms de couleur » -> « Noms de couleur ».
  const pageName = (t) => { const n = /^Liste\b/i.test(t) ? listName(t) : t; return n.length > 80 ? n.slice(0, 79) + '…' : n; };
  // Ta collection créée depuis une catégorie (source « wp:<nom> ») ou une page (« links:<titre> »), ou null.
  const collectionFor = (key) => targets.value.find((t) => t.source === key) || null;
  const pagesOf = (j) => ((j && j.query && j.query.pages) || []).slice().sort((a, b) => (a.index || 0) - (b.index || 0));
  const catSuggCache = new Map(); // texte replié (ou « url:<titre> ») -> suggestions
  let catSugCtrl = null;
  let catSugTimer = null;
  let catCtrl = null;
  // Titre d'une page de fr.wikipedia.org d'après son adresse : https://fr.wikipedia.org/wiki/…, fr.m.wikipedia.org,
  // /w/index.php?title=…, encodée ou non, avec ou sans « https:// » ; null si ce n'en est pas une.
  function wpTitleFromUrl(q) {
    const m = String(q || '').trim().match(/^(?:https?:\/\/)?fr\.(?:m\.)?wikipedia\.org\/(?:wiki\/([^?#]+)|w\/index\.php\?(?:[^#]*&)?title=([^&#]+))/i);
    if (!m) return null;
    let t = m[1] !== undefined ? m[1] : m[2].replace(/\+/g, ' ');
    try { t = decodeURIComponent(t); } catch (e) { /* mal encodée : prise telle quelle */ }
    t = t.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    return t || null;
  }
  // Une adresse, mais pas d'une page de fr.wikipedia.org (en.wikipedia, autre site) : rien à chercher.
  const looksLikeUrl = (q) => /^\s*(?:https?:\/\/|www\.)\S/i.test(String(q || '')) || /^\s*[a-z-]+(?:\.m)?\.wikipedia\.org\//i.test(String(q || ''));
  // Rang d'un nom pour le texte cherché (forms : le texte et sa forme au singulier, repliés) : 0 exact, 1 commence par
  // le texte, 2 un de ses mots commence par le texte, 3 le reste (recherche plein texte).
  const normName = (s) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();
  function nameRank(name, forms) {
    const n = normName(name);
    if (forms.some((f) => n === f)) return 0;
    if (forms.some((f) => n.startsWith(f))) return 1;
    if (forms.some((f) => (' ' + n).includes(' ' + f))) return 2;
    return 3;
  }
  async function suggestSources(q, signal) {
    // « races bovines » -> « race bovine » (mots de 5 lettres et plus : « pays » reste « pays »).
    const sing = q.split(/\s+/).map((w) => (w.length >= 5 ? singular(w) : w)).join(' ');
    const forms = [...new Set([normName(q), normName(sing)])].filter(Boolean);
    const words = simplify(q).split(' ').filter((w) => w.length > 2).map(fold);
    const withPages = words.length > 0;
    const cats = new Map(); // titre -> {type: 'cat', title, name, pages, subcats, order}
    const pages = new Map(); // titre -> {type: 'page', title, name, list, order}
    const exact = new Set(); // titres atteints par un titre exact demandé (redirection comprise)
    const addCat = (p, order) => {
      const t = p && typeof p.title === 'string' ? p.title : '';
      if (!t || cats.has(t) || !t.startsWith(CAT_NS) || p.missing || p.invalid) return;
      const ci = p.categoryinfo || {};
      const n = Number(ci.pages) || 0;
      const subcats = Number(ci.subcats) || 0;
      if (ci.hidden || isMaintenanceCategory(t) || (!n && !subcats)) return;
      cats.set(t, { type: 'cat', title: t, name: catName(t), pages: n, subcats, order });
    };
    const addPage = (t, order) => { if (!pages.has(t)) pages.set(t, { type: 'page', title: t, name: pageName(t), list: true, order }); };
    // 1. Catégories par préfixe ; pages « Liste de… » et articles par préfixe dans la même requête.
    const p1 = { action: 'query', generator: 'prefixsearch', gpssearch: q, gpsnamespace: '14', gpslimit: '20', prop: 'categoryinfo' };
    if (withPages) Object.assign(p1, { list: 'search|prefixsearch', srsearch: 'intitle:liste ' + q, srnamespace: '0', srlimit: '10', srprop: '', pssearch: q, psnamespace: '0', pslimit: '8' });
    const j1 = await getJson(wikiQ, wpUrl(p1), 4, null, signal);
    pagesOf(j1).forEach((p, i) => addCat(p, i));
    const q1 = (j1 && j1.query) || {};
    (q1.search || []).forEach((r, i) => {
      const t = String((r && r.title) || '');
      const f = fold(t);
      if (/^liste\b/.test(f) && words.every((w) => f.includes(w))) addPage(t, 100 + i);
    });
    const derived = [];
    for (const r of q1.prefixsearch || []) {
      const base = String((r && r.title) || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (base && nameRank(base, forms) <= 1 && !derived.includes(base)) derived.push(base);
    }
    // 2. Titres exacts : la catégorie du texte (et au singulier), celles du nom des articles trouvés, la page de liste.
    const exactAsked = new Set([CAT_NS + cap(q), CAT_NS + cap(sing)]);
    if (withPages) {
      if (/^liste\b/i.test(q)) exactAsked.add(cap(q));
      else for (const t of [(/^[aeiouyhàâäéèêëîïôöûüù]/i.test(q) ? "Liste d'" : 'Liste de ') + q, 'Liste des ' + q]) exactAsked.add(t);
    }
    const asked = [...new Set([...exactAsked, ...derived.slice(0, 6).map((t) => CAT_NS + cap(t))])].filter((t) => !cats.has(t) && t.length <= 250);
    if (asked.length) {
      const j2 = await getJson(wikiQ, wpUrl({ action: 'query', titles: asked.join('|'), redirects: '1', prop: 'categoryinfo|pageprops', ppprop: 'disambiguation' }), 4, null, signal);
      const q2 = (j2 && j2.query) || {};
      const alias = aliasOf(q2);
      const byT = new Map((q2.pages || []).map((p) => [p.title, p]));
      for (const t of asked) {
        const to = resolve(alias, t);
        const p = byT.get(to);
        if (!p || p.missing || p.invalid) continue;
        if (to.startsWith(CAT_NS)) { addCat(p, 50); if (exactAsked.has(t) && cats.has(to)) exact.add(to); continue; }
        if (exactAsked.has(t) && /^liste\b/i.test(to) && !(p.pageprops && 'disambiguation' in p.pageprops)) { addPage(to, 99); exact.add(to); }
      }
    }
    // 3. Peu de catégories : la recherche plein texte complète, seulement celles dont le nom a tous les mots du texte
    // (au singulier) : pour « noms de couleur », elle donnait « Chanson contre le racisme et la xénophobie ».
    if (cats.size < CAT_MORE) {
      const j3 = await getJson(wikiQ, wpUrl({ action: 'query', generator: 'search', gsrsearch: q, gsrnamespace: '14', gsrlimit: '20', prop: 'categoryinfo' }), 4, null, signal);
      pagesOf(j3).forEach((p, i) => { if (p && words.every((w) => fold(p.title).includes(w))) addCat(p, 200 + i); });
    }
    const rankOf = (x) => (exact.has(x.title) ? 0 : x.type === 'cat' ? nameRank(x.name, forms) : Math.min(nameRank(x.name, forms), nameRank(x.title, forms)));
    const ranked = (m, bySize) => [...m.values()].map((x) => ({ x, r: rankOf(x) }))
      .sort((a, b) => a.r - b.r || (bySize ? b.x.pages - a.x.pages : 0) || a.x.order - b.x.order);
    const ps = ranked(pages, false).slice(0, PAGE_MAX);
    const cs = ranked(cats, true).slice(0, Math.min(CAT_MAX, SUGG_MAX - ps.length));
    const strip = (l) => l.map(({ x }) => { const { order, ...rest } = x; return rest; });
    // Le groupe qui a le meilleur rang d'abord (à égalité : les catégories).
    return ps.length && (!cs.length || ps[0].r < cs[0].r) ? [...strip(ps), ...strip(cs)] : [...strip(cs), ...strip(ps)];
  }
  // Adresse collée : la page elle-même (redirection suivie), catégorie ou autre page ; [] si elle n'existe pas.
  async function suggestFromUrl(title, signal) {
    const j = await getJson(wikiQ, wpUrl({ action: 'query', titles: title, redirects: '1', prop: 'categoryinfo|pageprops', ppprop: 'disambiguation' }), 4, null, signal);
    const qy = (j && j.query) || {};
    const to = resolve(aliasOf(qy), title);
    const p = (qy.pages || []).find((x) => x.title === to) || (qy.pages || [])[0];
    if (!p || p.missing || p.invalid || p.special || typeof p.title !== 'string') return [];
    if (p.ns === 14 || p.title.startsWith(CAT_NS)) {
      const ci = p.categoryinfo || {};
      return [{ type: 'cat', title: p.title, name: catName(p.title), pages: Number(ci.pages) || 0, subcats: Number(ci.subcats) || 0 }];
    }
    return [{ type: 'page', title: p.title, name: pageName(p.title), list: /^Liste\b/i.test(p.title) }];
  }
  // pasted : texte collé (et pas tapé) ; une adresse de Wikipédia collée s'ouvre aussitôt (comme Entrée).
  function catSearchInput(value, pasted) {
    const cs = S.catSearch;
    Object.assign(cs, { q: value, open: true, active: 0, error: '', nav: false, enter: false, loading: catQuery(value).length >= 2 });
    clearTimeout(catSugTimer);
    catSugTimer = setTimeout(runCatSuggest, 250);
    if (pasted && wpTitleFromUrl(value)) catSearchEnter();
  }
  // Entrée : la suggestion active si la liste est celle du texte tapé (ou choisie aux flèches) ; sinon (suggestions pas
  // encore arrivées, ou celles d'un texte précédent) la recherche part tout de suite et la première suggestion s'ouvre
  // à son arrivée.
  function catSearchEnter() {
    const cs = S.catSearch;
    const list = cs.list;
    const act = Math.max(0, Math.min(cs.active, list.length - 1));
    if (list[act] && (cs.done === cs.q || (cs.open && cs.nav))) { chooseCat(list[act]); return; }
    if (catQuery(cs.q).length < 2 || (cs.done === cs.q && !catSugTimer)) return; // aucune catégorie pour ce texte
    cs.open = true;
    cs.enter = true;
    // Frappe encore en attente : la recherche part tout de suite ; requête en cours : c'est celle de ce texte.
    if (catSugTimer || !catSugCtrl) runCatSuggest();
  }
  function chooseCat(m) {
    stopCatSearch();
    if (m.type === 'page') openPage(m.title); else openCategory(m.title, m);
    // Le champ de recherche disparaît avec la liste : le focus va au titre de l'album ouvert (pas sur <body>).
    nextTick(() => { const el = document.getElementById('album-name'); if (el) el.focus(); });
  }
  // Suggestions arrivées pour le texte tapé : si Entrée a été pressée entre-temps, la première s'ouvre.
  function catSuggested(list) {
    const cs = S.catSearch;
    if (!cs.enter) return;
    cs.enter = false;
    if (list.length) chooseCat(list[0]);
  }
  async function runCatSuggest() {
    clearTimeout(catSugTimer);
    catSugTimer = null;
    const cs = S.catSearch;
    const raw = cs.q;
    const q = catQuery(raw);
    if (catSugCtrl) catSugCtrl.abort();
    catSugCtrl = null;
    if (q.length < 2) { Object.assign(cs, { list: [], loading: false, error: '', done: '' }); return; }
    // Adresse d'une page de fr.wikipedia.org : la page elle-même ; autre adresse : rien à chercher (la vue le dit).
    const urlTitle = wpTitleFromUrl(raw);
    if (!urlTitle && looksLikeUrl(raw)) { Object.assign(cs, { list: [], loading: false, error: '', done: raw, active: 0, nav: false, enter: false }); return; }
    const k = urlTitle ? 'url:' + urlTitle : fold(q);
    const hit = catSuggCache.get(k);
    if (hit) { Object.assign(cs, { list: hit, loading: false, error: '', done: raw, active: 0, nav: false }); catSuggested(hit); return; }
    const ctrl = new AbortController();
    catSugCtrl = ctrl;
    Object.assign(cs, { loading: true, error: '' });
    try {
      const list = markRaw(urlTitle ? await suggestFromUrl(urlTitle, ctrl.signal) : await suggestSources(q, ctrl.signal));
      if (catSugCtrl !== ctrl) return;
      catSuggCache.set(k, list);
      if (catSuggCache.size > 60) catSuggCache.delete(catSuggCache.keys().next().value);
      Object.assign(cs, { list, done: raw, active: 0, nav: false, loading: false });
      catSugCtrl = null;
      catSuggested(list);
    } catch (e) {
      if (catSugCtrl === ctrl && e.name !== 'AbortError') Object.assign(cs, { list: [], error: e.message, enter: false });
    } finally {
      if (catSugCtrl === ctrl) { catSugCtrl = null; cs.loading = false; }
    }
  }
  function stopCatSearch() {
    clearTimeout(catSugTimer);
    catSugTimer = null;
    if (catSugCtrl) catSugCtrl.abort();
    catSugCtrl = null;
    Object.assign(S.catSearch, { q: '', open: false, active: 0, list: [], loading: false, error: '', done: '', nav: false, enter: false });
  }
  function stopCategory() {
    if (catCtrl) catCtrl.abort();
    catCtrl = null;
    S.catView = null;
  }
  // Ouvre une catégorie (suggestion, proposition) : ses articles lus sur Wikipédia, comme un album ; si tu en as déjà
  // fait une collection, l'album le dit (« Ouvrir ta collection »). info : {pages, subcats} quand on les connaît déjà
  // (categoryinfo) ; withSubs : sous-catégories comprises d'emblée (proposition qui en regroupe d'autres, comme son
  // « Créer une collection »).
  function openCategory(title, info) {
    const name = catName(title);
    if (!name) return;
    const key = 'wp:' + name;
    stopCategory();
    const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
    S.catView = { type: 'cat', key, title: CAT_NS + name, name, size: info ? num(info.pages) : null, subcats: info ? num(info.subcats) : null, withSubs: !!(info && info.withSubs),
      loading: true, error: '', items: null, total: 0, busy: false };
    openAlbum('category', key);
    loadCategory();
  }
  // Ouvre une page (suggestion « Pages de liste », adresse collée) : les articles qu'elle lie, comme un album (source
  // « links:<titre> », titre tel que Wikipédia l'écrit, redirection suivie).
  function openPage(title) {
    const t = String(title || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return;
    const key = PAGE_SRC + t;
    stopCategory();
    S.catView = { type: 'page', key, title: t, name: pageName(t), size: null, subcats: null, withSubs: false, links: null, allLinks: false,
      loading: true, error: '', items: null, total: 0, busy: false };
    openAlbum('category', key);
    loadCategory();
  }
  // Catégorie : taille (categoryinfo) si on ne la connaît pas, puis les articles (avec ceux des sous-catégories directes
  // si withSubs). Page : ses liens et leur nature (pageLinks, lus une fois), ceux de la nature dominante seulement sauf
  // si allLinks. 3 000 au plus, total = ce qui a été lu ou gardé (plus de 3 000 : trop grande pour une collection).
  async function loadCategory() {
    const cv = S.catView;
    if (!cv) return;
    if (catCtrl) catCtrl.abort();
    const ctrl = new AbortController();
    catCtrl = ctrl;
    const stale = () => catCtrl !== ctrl || S.catView !== cv;
    cv.loading = true;
    cv.error = '';
    try {
      if (cv.type === 'page') {
        if (!cv.links) {
          const links = await pageLinks(cv.title, ctrl.signal);
          if (stale()) return;
          cv.links = markRaw(links);
        }
        const { top } = cv.links;
        const kept = top && !cv.allLinks ? cv.links.items.filter((i) => i.fits) : cv.links.items;
        cv.total = kept.length;
        cv.items = markRaw(kept.slice(0, 3000).map((i) => {
          const it = { title: i.title, description: i.description || null, image: null, status: 'ok' };
          if (i.qid) it.qid = i.qid;
          return it;
        }));
        return;
      }
      if (cv.size === null || cv.subcats === null) {
        const j = await getJson(wikiQ, wpUrl({ action: 'query', prop: 'categoryinfo', titles: cv.title }), 3, null, ctrl.signal);
        if (stale()) return;
        const ci = (pagesOf(j)[0] || {}).categoryinfo || {};
        cv.size = Number(ci.pages) || 0;
        cv.subcats = Number(ci.subcats) || 0;
      }
      const list = await categoryMembers(cv.title, cv.withSubs, ctrl.signal);
      if (stale()) return;
      cv.total = list.length;
      cv.items = markRaw(list.slice(0, 3000).map((m) => ({ title: m.title, description: null, image: null, status: 'ok' })));
    } catch (e) {
      if (!stale() && e.name !== 'AbortError') cv.error = e.message;
    } finally {
      if (!stale()) { catCtrl = null; cv.loading = false; }
    }
  }
  function toggleCatSubs() {
    const cv = S.catView;
    if (!cv || cv.busy) return;
    cv.withSubs = !cv.withSubs;
    loadCategory();
  }
  // Page : seulement la nature dominante, ou tous les liens (déjà lus : sans requête).
  function toggleAllLinks() {
    const cv = S.catView;
    if (!cv || cv.busy || cv.type !== 'page') return;
    cv.allLinks = !cv.allLinks;
    loadCategory();
  }
  // « Créer une collection » (album d'une catégorie ou d'une page) : ses articles lus (avec les sous-catégories si la case
  // est cochée ; page : les articles liés gardés, avec leur qid et leur description Wikidata) deviennent une collection à
  // compléter de source « wp:<nom> » ou « links:<titre> », nommée comme la catégorie (page : « Liste de » retiré) ;
  // l'album reste ouvert, devenu celui de la collection (Modifier, Supprimer). Déjà faite, ou « Créer une collection » de
  // sa proposition en cours (S.wp.busy, partagé) : pas de seconde collection de même source.
  async function createFromCategory() {
    const cv = S.catView;
    if (!cv) return;
    const t0 = collectionFor(cv.key);
    if (t0) { openAlbum('target', t0.id); return; }
    if (cv.busy || cv.loading || !cv.items || !cv.items.length || S.wp.busy[cv.key]) return;
    const page = cv.type === 'page';
    if (cv.total > 3000) { notify(page ? 'Cette page lie plus de 3 000 articles : trop pour une collection.' : 'Cette catégorie a plus de 3 000 articles : trop grande pour une collection.', true); return; }
    if (cv.key.length > 200) { notify(page ? 'Le titre de cette page est trop long pour en faire une collection.' : 'Le nom de cette catégorie est trop long pour en faire une collection.', true); return; }
    const gen = cardsGen;
    const stale = () => gen !== cardsGen;
    cv.busy = true;
    S.wp.busy[cv.key] = true;
    try {
      const name = cv.name.length > 80 ? cv.name.slice(0, 79) + '…' : cv.name;
      const items = cv.items.map((it) => (it.qid ? { title: it.title, description: it.description || null, image: null, status: 'ok', qid: it.qid }
        : { title: it.title, description: it.description || null, image: null, status: 'ok' }));
      const r = await api('POST', '/api/targets/save', { name, items, source: cv.key });
      if (stale()) return;
      if (r.target) upsertTarget(r.target); else { await loadTargets(); if (stale()) return; }
      S.wp.list = markRaw(S.wp.list.filter((x) => x.key !== cv.key));
      const t = collectionFor(cv.key);
      if (t && S.catView === cv) { stopCategory(); S.album = { kind: 'target', id: t.id }; }
      const how = cv.withSubs ? ', sous-catégories comprises' : page && cv.links && cv.links.top && !cv.allLinks ? ` (les « ${cv.links.top.label} » de la page)` : page ? ' (tous les liens de la page)' : '';
      notify(`Collection « ${name} » créée : ${fmt(items.length)} ${plural(items.length, 'article', 'articles')}${how}, dans « Mes collections ».`);
    } catch (e) {
      if (!stale()) notify(e.message, true);
    } finally {
      cv.busy = false;
      if (!stale()) S.wp.busy[cv.key] = false;
    }
  }

  // ---------------------------------------------------------------- nouvelle collection par mots-clés
  // Sources de candidats, interrogées dans le navigateur, une requête à la fois : les pages « Liste de… », les catégories
  // de Wikipédia, les définitions (« … est une maladie … », plus bas) et une requête Wikidata construite d'après les mots
  // (métier ou nature, nationalité, pays, lieu, auteur…).
  const KW_STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'en', 'et', 'au', 'aux', 'a', 'à']);
  const singular = (w) => {
    if (w.length <= 3) return w;
    if (/aux$/.test(w)) return w.slice(0, -3) + 'al';
    if (/[sx]$/.test(w) && !/(ais|ois|us|ss)$/.test(w)) return w.slice(0, -1);
    return w;
  };
  // « cathédrales de France » -> « cathédrale France » (pour une deuxième recherche de catégories).
  const simplify = (q) => q.toLowerCase().replace(/[’']/g, ' ').split(/\s+/).filter((w) => w && !KW_STOP.has(w)).map(singular).join(' ');
  // Formes d'un adjectif de nationalité : « françaises » -> français, « italienne » -> italien…
  function adjForms(word) {
    const w = fold(word).replace(/[^a-z-]/g, '');
    const out = new Set([w]);
    for (const [a, b] of [['aises', 'ais'], ['aise', 'ais'], ['iennes', 'ien'], ['ienne', 'ien'], ['ennes', 'en'], ['enne', 'en'], ['ines', 'in'], ['ine', 'in'],
      ['oises', 'ois'], ['oise', 'ois'], ['aines', 'ain'], ['aine', 'ain'], ['ques', 'que'], ['es', 'e'], ['ees', 'e'], ['ee', 'e'], ['aux', 'al'], ['s', ''], ['e', '']]) {
      if (w.endsWith(a) && w.length > a.length + 2) out.add(w.slice(0, -a.length) + b);
    }
    return [...out].filter(Boolean);
  }
  // Expression régulière insensible aux accents (Wikidata ne sait pas les enlever).
  const accentRe = (w) => w.replace(/a/g, '[aàâä]').replace(/e/g, '[eéèêë]').replace(/i/g, '[iîï]').replace(/o/g, '[oôö]').replace(/u/g, '[uùûü]').replace(/c/g, '[cç]');
  async function findDemonym(word, signal) {
    const forms = adjForms(word);
    if (!forms.length) return null;
    const re = '^(' + forms.map(accentRe).join('|') + ')$';
    const rows = await sparql(`SELECT ?c ?cl ?isCountry WHERE { ?c wdt:P1549 ?g . FILTER(LANG(?g) = "fr") FILTER(REGEX(LCASE(STR(?g)), "${re}"))
      BIND(EXISTS { ?c wdt:P31 ?t . FILTER(?t IN (${COUNTRY_CLASSES.map((x) => 'wd:' + x).join(', ')})) } AS ?isCountry)
      OPTIONAL { ?c rdfs:label ?cl . FILTER(LANG(?cl) = "fr") } } LIMIT 20`, 3, signal);
    if (!rows.length) return null;
    const pick = rows.find((r) => truthy(r.isCountry)) || rows[0];
    return { id: qid(pick.c.value), label: pick.cl ? pick.cl.value : qid(pick.c.value), country: truthy(pick.isCountry) };
  }
  // Premier élément trouvé pour des mots, avec sa nature (classe, métier, pays, personne).
  async function resolveTerm(text, signal, want) {
    const tries = [...new Set([text.split(/\s+/).map(singular).join(' '), text])];
    for (const t of tries) {
      const found = await wdSearch(t, signal, 7);
      if (!found.length) continue;
      const kinds = await classifyItems(found.map((x) => x.id), 3, signal);
      for (const f of found) {
        const k = kinds.get(f.id) || {};
        if (want(k)) return { id: f.id, label: f.label || f.id, ...k };
      }
    }
    return null;
  }
  const FR_ARTICLE = '?a schema:about ?item ; schema:isPartOf <https://fr.wikipedia.org/> ; schema:name ?title .';
  const rowsToItems = (rows) => {
    const by = new Map();
    for (const r of rows) {
      if (!r.item || !r.title) continue;
      const id = qid(r.item.value);
      if (!by.has(id)) by.set(id, { title: r.title.value, description: r.desc ? r.desc.value : null, qid: id });
    }
    return [...by.values()];
  };
  async function searchWikidata(q, signal) {
    const text = q.trim();
    let noun = text;
    let rest = null;
    const m = text.match(/^(.+?)\s+(?:(?:de la|de l['’]|du|des|de|en|au|aux)\s+|d['’])(.+)$/i);
    if (m) { noun = m[1]; rest = m[2]; }
    const parts = [];
    let place = null;
    let nat = null;
    if (!rest) {
      const words = text.split(/\s+/);
      if (words.length >= 2) {
        nat = await findDemonym(words[words.length - 1], signal);
        if (nat) noun = words.slice(0, -1).join(' ');
      }
    }
    const head = await resolveTerm(noun, signal, (k) => k.occ || k.cls);
    if (!head) return { interp: `Wikidata : je n'ai pas reconnu « ${noun} ».`, cand: null };
    const person = head.occ || head.id === 'Q5';
    const where = [];
    if (head.occ) { where.push(`?item wdt:P106 wd:${head.id} .`); parts.push(`Métier : ${head.label}`); }
    else parts.push(`Nature : ${head.label}`);
    if (rest) {
      place = await resolveTerm(rest, signal, () => true);
      if (!place) return { interp: parts.join(' · ') + ` · je n'ai pas reconnu « ${rest} ».`, cand: null };
    }
    const narrowed = !!(nat || place);
    if (!head.occ) where.push(`?item wdt:P31${narrowed ? '/wdt:P279*' : ''} wd:${head.id} .`);
    if (nat) {
      where.push(person ? `?item wdt:P27 wd:${nat.id} .` : `?item wdt:P17 wd:${nat.id} .`);
      parts.push(`${person ? 'Nationalité' : 'Pays'} : ${nat.label}`);
    }
    if (place) {
      if (place.country) { where.push(person ? `?item wdt:P27 wd:${place.id} .` : `?item wdt:P17 wd:${place.id} .`); parts.push(`${person ? 'Nationalité' : 'Pays'} : ${place.label}`); }
      else if (place.human) {
        where.push(['P57', 'P50', 'P86', 'P170', 'P175', 'P162'].map((p) => `{ ?item wdt:${p} wd:${place.id} . }`).join(' UNION '));
        parts.push(`Œuvres de : ${place.label}`);
      } else if (person) { where.push(`?item wdt:P19/wdt:P131* wd:${place.id} .`); parts.push(`Né à : ${place.label}`); }
      else { where.push(`?item wdt:P131* wd:${place.id} .`); parts.push(`Lieu : ${place.label}`); }
    }
    const body = where.join(' ');
    const rows = await sparql(`SELECT ?item ?title ?desc WHERE { ${body} ${FR_ARTICLE} OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc) = "fr") } } LIMIT 3001`, 3, signal);
    const items = rowsToItems(rows);
    const interp = parts.join(' · ');
    return {
      interp,
      cand: { id: 'wd', source: 'wd', name: cap(text), size: items.length, tooBig: items.length > 3000, where: body, interp,
        items: items.length > 3000 ? null : markRaw(items) },
    };
  }
  async function wdTop(where, n, signal) {
    const rows = await sparql(`SELECT ?item ?title ?desc ?sl WHERE { ${where} ?item wikibase:sitelinks ?sl . ${FR_ARTICLE}
      OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc) = "fr") } } ORDER BY DESC(?sl) LIMIT ${n}`, 3, signal);
    return rowsToItems(rows);
  }
  // Catégories de maintenance de Wikipédia (ébauches, portails, homonymies, pages à…) : jamais des collections.
  // Reprend le filtre du module de propositions quand il est chargé.
  function isMaintenanceCategory(title) {
    const name = String(title).replace(/^Catégorie\s*:\s*/i, '');
    if (/^(Wikipédia|Portail|Projet|Modèle|Aide)\s*:/i.test(name) || /ébauche|homonymie|maintenance|à (vérifier|sourcer|wikifier|recycler)|page(s)? (utilisant|avec|à)|article(s)? (à|avec|utilisant)/i.test(name)) return true;
    const P = window.ClasseurPropose;
    try { return !!(P && P.isNoise && P.isNoise(title) && /^(Wikipédia|Page|Article|Portail|Projet|Ébauche|Homonymie)/i.test(name)); } catch (e) { return false; }
  }
  async function searchCategories(q, signal) {
    const titles = [];
    for (const v of [...new Set([q, simplify(q)])].filter(Boolean)) {
      const j = await getJson(wikiQ, wpUrl({ action: 'query', list: 'search', srnamespace: '14', srsearch: v, srlimit: '10' }), 3, null, signal);
      for (const r of (j && j.query && j.query.search) || []) if (r.title && !titles.includes(r.title) && !isMaintenanceCategory(r.title)) titles.push(r.title);
    }
    if (!titles.length) return [];
    const j = await getJson(wikiQ, wpUrl({ action: 'query', prop: 'categoryinfo', titles: titles.slice(0, 20).join('|') }), 3, null, signal);
    const info = new Map(((j && j.query && j.query.pages) || []).map((p) => [p.title, p.categoryinfo || {}]));
    return titles.slice(0, 20).map((t) => {
      const ci = info.get(t) || {};
      const size = Number(ci.pages) || 0;
      return { id: 'cat:' + t, source: 'cat', title: t, name: cap(t.replace(/^Catégorie\s*:\s*/i, '')), size, subcats: Number(ci.subcats) || 0, tooBig: size > 3000 };
    }).filter((c) => c.size > 0 || c.subcats > 0).slice(0, 12);
  }
  // Articles d'une catégorie (et de ses sous-catégories directes) ; s'arrête au-delà de 3 000.
  async function categoryMembers(title, withSubs, signal) {
    const out = new Map();
    const read = async (cat, type) => {
      const found = [];
      let cont = {};
      for (let guard = 0; guard < 40; guard++) {
        const j = await getJson(wikiQ, wpUrl({ action: 'query', list: 'categorymembers', cmtitle: cat, cmtype: type, cmlimit: '500', ...(type === 'page' ? { cmnamespace: '0' } : {}), ...cont }), 3, null, signal);
        for (const m of (j && j.query && j.query.categorymembers) || []) found.push(m.title);
        if (!j.continue || (type === 'page' && out.size + found.length > 3000)) break;
        cont = j.continue;
      }
      return found;
    };
    for (const t of await read(title, 'page')) out.set(t, { title: t, description: null, qid: null });
    if (withSubs) {
      for (const sub of await read(title, 'subcat')) {
        if (out.size > 3000) break;
        for (const t of await read(sub, 'page')) if (!out.has(t)) out.set(t, { title: t, description: null, qid: null });
      }
    }
    return [...out.values()];
  }
  // Pages « Liste de… » (ou l'adresse d'une page collée) : leurs liens deviennent la collection.
  function pageFromUrl(q) { return wpTitleFromUrl(q); }
  const listName = (t) => cap(t.replace(/^Liste\s+(?:de la |de l['’]|des |du |de |d['’])/i, ''));
  // exact : titre tiré d'une adresse collée, pris tel quel (même si ce n'est pas une liste).
  async function searchPages(q, signal, exact) {
    const titles = [exact || q];
    if (!exact) {
      const words = simplify(q).split(' ').filter((w) => w.length > 2).map(fold);
      const j = await getJson(wikiQ, wpUrl({ action: 'query', list: 'search', srnamespace: '0', srsearch: 'intitle:liste ' + q, srlimit: '20' }), 3, null, signal);
      for (const r of (j && j.query && j.query.search) || []) {
        const t = fold(r.title);
        if (/^liste /.test(t) && words.every((w) => t.includes(w)) && !titles.includes(r.title)) titles.push(r.title);
      }
    }
    const asked = titles.slice(0, 8);
    const j = await getJson(wikiQ, wpUrl({ action: 'query', titles: asked.join('|'), redirects: '1', prop: 'pageprops', ppprop: 'disambiguation' }), 3, null, signal);
    const alias = aliasOf((j && j.query) || {});
    const byTitle = new Map(((j && j.query && j.query.pages) || []).map((p) => [p.title, p]));
    const out = [];
    for (const t of asked) {
      let to = t;
      for (let k = 0; k < 3 && alias[to]; k++) to = alias[to];
      const p = byTitle.get(to);
      if (!p || p.missing || p.invalid || (p.pageprops && 'disambiguation' in p.pageprops)) continue;
      if ((!exact && !/^Liste\b/i.test(p.title)) || out.some((c) => c.title === p.title)) continue;
      out.push({ id: 'links:' + p.title, source: 'links', title: p.title, name: listName(p.title), size: null });
    }
    return out.slice(0, 5);
  }
  // Articles liés depuis une page, avec leur nature (P31) et leur description Wikidata ; top = la nature la plus
  // fréquente, et `fits` sur chaque article de cette nature : directement, par une de ses sous-classes (P279+), ou par
  // une description qui la nomme dans ses quatre premiers mots (« nom de couleur ») ; top.n = leur nombre. Mesuré le
  // 2026-10-16 : « Liste de races bovines », race bovine, 330 directement, 351 avec les sous-classes, 355 avec les
  // descriptions, sur 589 liens (le reste = pays, régions…) ; « Liste de noms de couleur », couleur : 103, 134, 181 sur
  // 247 (beaucoup de noms de couleur sont des « chromonymes » sans nature « couleur »).
  async function pageLinks(title, signal) {
    const by = new Map();
    const drop = new Set();
    let cont = {};
    for (let guard = 0; guard < 12 && by.size < 5000; guard++) {
      const j = await getJson(wikiQ, wpUrl({ action: 'query', generator: 'links', titles: title, gplnamespace: '0', gpllimit: 'max', redirects: '1',
        prop: 'pageprops', ppprop: 'wikibase_item|disambiguation', ...cont }), 3, null, signal);
      for (const p of (j && j.query && j.query.pages) || []) {
        if (p.missing || p.invalid) continue;
        const pp = p.pageprops || {};
        if ('disambiguation' in pp) drop.add(p.title);
        const cur = by.get(p.title);
        if (!cur) by.set(p.title, { title: p.title, description: null, qid: pp.wikibase_item || null, classes: [] });
        else if (!cur.qid && pp.wikibase_item) cur.qid = pp.wikibase_item;
      }
      if (!j || !j.continue) break;
      cont = j.continue;
    }
    const items = [...by.values()].filter((i) => !drop.has(i.title) && i.title !== title).sort((a, b) => a.title.localeCompare(b.title, 'fr'));
    const byQ = new Map(items.filter((i) => i.qid).map((i) => [i.qid, i]));
    for (const batch of chunks([...byQ.keys()], 200)) {
      const rows = await sparql(`SELECT ?item ?c ?desc WHERE { VALUES ?item { ${batch.map((id) => 'wd:' + id).join(' ')} }
        OPTIONAL { ?item wdt:P31 ?c } OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc) = "fr") } }`, 3, signal);
      for (const r of rows) {
        const it = byQ.get(qid(r.item.value));
        if (!it) continue;
        if (r.c) { const c = qid(r.c.value); if (!it.classes.includes(c)) it.classes.push(c); }
        if (r.desc && !it.description) it.description = r.desc.value;
      }
    }
    const count = new Map();
    for (const it of items) for (const c of it.classes) count.set(c, (count.get(c) || 0) + 1);
    let top = null;
    for (const [c, n] of count) if (!top || n > top.n) top = { id: c, n, label: c };
    // Filtre seulement s'il y a vraiment une nature dominante et quelque chose à écarter.
    if (top && (top.n < 3 || top.n < 0.2 * items.length || top.n === items.length)) top = null;
    if (top) {
      const rows = await sparql(`SELECT ?l WHERE { wd:${top.id} rdfs:label ?l . FILTER(LANG(?l) = "fr") } LIMIT 1`, 3, signal);
      if (rows[0] && rows[0].l) top.label = rows[0].l.value;
      // Sous-classes de la nature dominante parmi les natures vues (« couleur primaire », « couleur du Web » pour « couleur »).
      const subs = new Set();
      for (const batch of chunks([...count.keys()].filter((c) => c !== top.id), 200)) {
        const rs = await sparql(`SELECT ?c WHERE { VALUES ?c { ${batch.map((id) => 'wd:' + id).join(' ')} } ?c wdt:P279+ wd:${top.id} . }`, 3, signal);
        for (const r of rs) if (r.c) subs.add(qid(r.c.value));
      }
      const lab = /^Q\d+$/.test(top.label) ? '' : normName(top.label);
      const head = (d) => ' ' + normName(d).split(' ').slice(0, 4).join(' ') + ' ';
      for (const it of items) it.fits = it.classes.some((c) => c === top.id || subs.has(c)) || (!!lab && !!it.description && head(it.description).includes(' ' + lab + ' '));
      top.n = items.filter((i) => i.fits).length;
      if (top.n === items.length) top = null;
    }
    return { items, top };
  }
  // « Définition Wikipédia » : les articles dont la première phrase dit « … est une maladie … ». Deux temps :
  // 1. recherche de la formule dans le texte de Wikipédia (CirrusSearch, phrases à un mot près, « est un », « est une »,
  //    féminin, « sont des », « était un ») : le nombre d'articles qui la citent, quelque part ;
  // 2. à l'ouverture, le texte d'ouverture de chaque article (prop=cirrusdoc, 500 par requête) : on garde ceux dont la
  //    phrase de définition (sujet = le titre, puis « est un(e) ») a le nom cherché juste après le verbe.
  // Mesuré le 2026-10-15 : « maladie » 1 744 articles citent la formule, 1 041 la disent en ouverture (le résumé
  // TextExtracts dit pareil pour 99 % d'entre eux), 4 requêtes, ≈ 45 s ; « cathédrale » 598 → 558 ; « footballeur »
  // 49 676 → seulement les plus liés (436 sur les 500 premiers). Les résumés (prop=extracts, 20 par requête) coûtent
  // vingt fois plus de requêtes et Wikipédia répond 429 au bout d'une dizaine.
  const DEF_MAX = 3000;
  const DEF_ART = new Set(['le', 'la', 'les', "l'", 'un', 'une', 'des']);
  const DEF_PREP = new Set(['de', 'du', 'des', "d'", 'en', 'à', 'a', 'au', 'aux', 'pour', 'sur', 'dans', 'chez', 'par', 'avec', 'sans', 'contre', 'entre', 'et', 'ou', 'qui', 'que', 'dont']);
  const DEF_SKIP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'en', 'et', 'au', 'aux', 'a', 'un', 'une', 'sur', 'pour', 'par', 'dans', 'the', 'of', 'saint', 'sainte', 'st']);
  // Féminin, seulement pour des finales sûres (footballeur -> footballeuse, acteur -> actrice) ; adjectif : + e.
  function defFem(w, adj) {
    for (const [a, bs] of [['teur', ['trice', 'teuse']], ['eur', ['euse']], ['ien', ['ienne']], ['ier', ['ière']], ['er', ['ère']], ['on', ['onne']], ['el', ['elle']],
      ['eux', ['euse']], ['if', ['ive']], ['ais', ['aise']], ['ois', ['oise']], ['ain', ['aine']], ['in', ['ine']], ['ant', ['ante']], ['ent', ['ente']], ['and', ['ande']]]) {
      if (w.length > a.length + 1 && w.endsWith(a)) return bs.map((b) => w.slice(0, -a.length) + b);
    }
    return adj ? [/e$/.test(w) ? w : w + 'e'] : [];
  }
  const defPl = (w) => (/[sxz]$/.test(w) ? w : /(eau|au|eu)$/.test(w) ? w + 'x' : /al$/.test(w) ? w.slice(0, -2) + 'aux' : w + 's');
  const defJoin = (ws) => ws.join(' ').replace(/([dl]') /g, '$1');
  // Préfixe commun (genre, nombre) : « français » ~ « française », « bovine » ~ « bovins ».
  const defNear = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, Math.max(4, b.length - 2))) || b.startsWith(a.slice(0, Math.max(4, a.length - 2)))));
  // « races bovines » -> formule « est une race bovine » (et ses variantes), nom « race » sous toutes ses formes, autres mots
  // (« bovine », « vigne » de « maladie de la vigne ») à retrouver dans la phrase de définition. null si ça n'y ressemble pas.
  function defTerms(q) {
    const words = String(q).toLowerCase().replace(/[’ʼ]/g, "'").replace(/(^|\s)([dl])'\s*/g, "$1$2' ").replace(/[«»"()]/g, ' ').split(/\s+/).filter(Boolean);
    while (words.length > 1 && DEF_ART.has(words[0])) words.shift();
    let cut = words.findIndex((w, i) => i > 0 && DEF_PREP.has(w));
    if (cut < 0) cut = words.length;
    const np = words.slice(0, cut).map(singular);
    const rest = words.slice(cut);
    if (!np.length || np.length > 4 || words.length > 8 || np[0].length < 3 || !/^[\p{L}-]+$/u.test(np[0])) return null;
    const head = np[0];
    const fems = defFem(head, false).map((f) => [f, ...np.slice(1).map((a) => defFem(a, true)[0])]);
    const R = rest.length ? ' ' + defJoin(rest) : '';
    const NP = defJoin(np) + R;
    const PL = defJoin(np.map(defPl)) + R;
    const phrases = [...new Set([`est un ${NP}`, `est une ${NP}`, ...fems.map((f) => `est une ${defJoin(f)}${R}`), `sont des ${PL}`, `était un ${NP}`, `était une ${NP}`,
      ...fems.map((f) => `était une ${defJoin(f)}${R}`), ...fems.map((f) => `sont des ${defJoin(f.map(defPl))}${R}`)])];
    // CirrusSearch refuse les recherches de plus de 300 caractères : les variantes les moins utiles sautent d'abord.
    let query = '';
    for (const p of phrases) {
      const next = (query ? query + ' OR ' : '') + `"${p}"~1`;
      if (next.length > 300) break;
      query = next;
    }
    if (!query) return null;
    const heads = [head, defPl(head), head + 's', ...defFem(head, false).flatMap((f) => [f, defPl(f)])];
    const quals = [...np.slice(1), ...rest.filter((w) => !DEF_PREP.has(w) && !DEF_ART.has(w) && w.length > 1)];
    return { query, phrases, forms: [...new Set(heads.map(fold))], quals: quals.map(fold), name: cap(PL) };
  }
  // Fins de phrase d'un texte (en minuscules), sauf après une abréviation ou une initiale (« St. », « J. », « av. »).
  function defBounds(t) {
    const out = [];
    for (const m of t.matchAll(/[.!?]\s+/g)) if (!/(?:^|[\s(])(?:st|ste|av|apr|env|cf|ex|no|vol|mgr|dr|mr|mme|[a-z]|j\.-c)$/.test(t.slice(Math.max(0, m.index - 6), m.index))) out.push([m.index, m.index + m[0].length]);
    return out;
  }
  const DEF_COP = /(?:^|[\s,;)»"])(?:est|sont|etait|etaient|fut|furent|reste|demeure|devient|designe|designent)\s+(?:(?:aujourd'hui|actuellement|egalement|aussi|avant tout|principalement|essentiellement|surtout|souvent|generalement|historiquement|desormais|alors|d'abord)\s+)?(?:(?:l'une? des|une? des|l'une?|une?|des|les?|la)\s+|l')/g;
  // Phrase de définition d'un article (texte d'ouverture : bandeaux, homonymies et légende de l'infobox compris) : la
  // première phrase « <sujet> est un(e) … » dont le sujet reprend un mot du titre (ou le nom cherché). Elle convient si
  // le nom cherché vient juste après (à deux mots près : « est un ancien footballeur ») et si les autres mots y sont.
  function defCheck(text, title, T) {
    let t = fold(text).replace(/[’ʼ]/g, "'").replace(/\s+/g, ' ');
    const k = t.lastIndexOf('voir wikidata (aide)', 6000); // fin de l'infobox (« modifier le code - voir Wikidata (aide) »)
    if (k >= 0) t = t.slice(k + 20);
    t = t.slice(0, 4000);
    const toks = fold(String(title).replace(/\s*\([^)]*\)\s*$/, '')).split(/[^a-z0-9]+/).filter((w) => w && !DEF_SKIP.has(w) && !T.forms.has(w));
    const bounds = defBounds(t);
    const re = new RegExp(DEF_COP.source, 'g');
    let m;
    for (let n = 0; n < 15 && (m = re.exec(t)); n++) {
      const startB = bounds.filter((b) => b[1] <= m.index + 1).pop();
      const subject = t.slice(startB ? startB[1] : 0, m.index + 1).split(/[^a-z0-9]+/).filter(Boolean);
      if (!subject.some((w) => T.forms.has(w) || toks.some((x) => defNear(w, x)))) continue;
      const from = m.index + m[0].length;
      const endB = bounds.find((b) => b[0] >= from);
      const pred = t.slice(from, endB ? endB[0] : t.length).split(/[^a-z0-9'-]+/).filter(Boolean);
      if (pred[0] === 'nom' && !T.forms.has('nom')) continue; // « Andrés Iniesta Luján est un nom espagnol » (bandeau)
      return pred.slice(0, 3).some((w) => T.forms.has(w)) && T.quals.every((q) => pred.some((w) => defNear(w, q)));
    }
    return false;
  }
  // Sans texte d'ouverture (rare) : la description Wikidata (« maladie intestinale »).
  function defDescOk(desc, T) {
    const w = fold(desc).split(/[^a-z0-9'-]+/).filter(Boolean);
    return w.slice(0, 3).some((x) => T.forms.has(x)) && T.quals.every((q) => w.some((x) => defNear(x, q)));
  }
  async function searchDefinition(q, signal) {
    const t = defTerms(q);
    if (!t) return null;
    const j = await getJson(wikiQ, wpUrl({ action: 'query', list: 'search', srsearch: t.query, srnamespace: '0', srlimit: '5', srinfo: 'totalhits', srprop: 'snippet' }), 3, null, signal);
    const n = Number(j && j.query && j.query.searchinfo && j.query.searchinfo.totalhits) || 0;
    if (!n) return null;
    // Formule montrée : la variante qu'on lit dans les premiers résultats (« est une maladie » plutôt que « est un maladie »).
    const snips = ((j.query && j.query.search) || []).map((r) => fold(String(r.snippet || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' '));
    const loose = (p) => new RegExp(fold(p).split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(' (?:\\S+ )?')); // à un mot près, comme la recherche
    const shown = t.phrases.find((p) => { const re = loose(p); return snips.some((s) => re.test(s)); }) || t.phrases[0].replace(/^est un /, 'est un(e) ');
    const interp = `articles dont la première phrase dit « … ${shown} … »`;
    return { id: 'def:' + t.query, source: 'def', name: t.name, size: n, tooBig: n > DEF_MAX, query: t.query, interp,
      terms: markRaw({ forms: t.forms, quals: t.quals }) };
  }
  // Articles du candidat « Définition » : tous (au plus 3 000 résultats), ou les top plus liés depuis Wikipédia. Tri
  // explicite : par pertinence, les pages de 500 se recouvrent (mesuré : 15 doublons et autant d'absents sur 2 025) ;
  // par titre, aucun ; par liens entrants, 3.
  async function defPages(cand, top, signal, onProgress) {
    const T = { forms: new Set(cand.terms.forms), quals: cand.terms.quals };
    const items = [];
    const seen = new Set();
    let checked = 0;
    let offset = 0;
    for (let guard = 0; guard < 10 && offset < 10000; guard++) {
      const want = top ? Math.min(500, Math.max(50, Math.ceil((top - items.length) * 1.3))) : 500;
      const j = await getJson(wikiQ, wpUrl({ action: 'query', generator: 'search', gsrsearch: cand.query, gsrnamespace: '0', gsrlimit: String(want), gsroffset: String(offset),
        gsrsort: top ? 'incoming_links_desc' : 'title_natural_asc', prop: 'cirrusdoc|description|pageprops', cdincludes: 'opening_text', ppprop: 'wikibase_item|disambiguation' }), 3, null, signal);
      const pages = ((j && j.query && j.query.pages) || []).slice().sort((a, b) => (a.index || 0) - (b.index || 0));
      for (const p of pages) {
        checked++;
        if (p.missing || p.invalid || seen.has(p.title)) continue;
        seen.add(p.title);
        const pp = p.pageprops || {};
        if ('disambiguation' in pp) continue;
        const doc = p.cirrusdoc && p.cirrusdoc[0] && p.cirrusdoc[0].source;
        const open = (doc && doc.opening_text) || '';
        if (open.trim() ? defCheck(open, p.title, T) : defDescOk(p.description, T)) items.push({ title: p.title, description: p.description || null, qid: pp.wikibase_item || null });
      }
      if (onProgress) onProgress(checked, items.length);
      if (top && items.length >= top) break;
      const next = Number(j && j.continue && j.continue.gsroffset);
      if (!next || next <= offset) break;
      offset = next;
    }
    return { items: top ? items.slice(0, top) : items, checked };
  }
  let kwCtrl = null;
  let kwTimer = null;
  function kwAbort() { if (kwCtrl) kwCtrl.abort(); kwCtrl = null; clearTimeout(kwTimer); }
  function kwInput(ed, value) {
    ed.kw.q = value;
    clearTimeout(kwTimer);
    kwTimer = setTimeout(() => kwSearch(ed), 600);
  }
  async function kwSearch(ed) {
    clearTimeout(kwTimer);
    if (kwCtrl) kwCtrl.abort();
    const ctrl = new AbortController();
    kwCtrl = ctrl;
    const stale = () => kwCtrl !== ctrl || S.editor !== ed;
    const raw = ed.kw.q.trim();
    const exact = pageFromUrl(raw);
    const q = exact || raw.replace(/_/g, ' ');
    Object.assign(ed.kw, { cands: [], interp: '', error: '', chosen: null, searched: '' });
    if (q.length < 3) { ed.kw.searching = false; return; }
    ed.kw.searching = true;
    try {
      const pages = await searchPages(q, ctrl.signal, exact);
      if (stale()) return;
      ed.kw.cands = pages;
      if (!exact) {
        const cats = await searchCategories(q, ctrl.signal);
        if (stale()) return;
        ed.kw.cands = [...pages, ...cats];
        // Un incident sur la recherche de la formule ne doit pas priver des autres candidats.
        let def = null;
        try { def = await searchDefinition(q, ctrl.signal); } catch (e) { if (e.name === 'AbortError') throw e; }
        if (stale()) return;
        const defs = def ? [def] : [];
        ed.kw.cands = [...pages, ...defs, ...cats];
        const wd = await searchWikidata(q, ctrl.signal);
        if (stale()) return;
        ed.kw.interp = wd.interp;
        if (wd.cand) ed.kw.cands = [...pages, wd.cand, ...defs, ...cats];
      }
      ed.kw.searched = q;
    } catch (e) {
      if (!stale() && e.name !== 'AbortError') ed.kw.error = e.message;
    } finally {
      if (!stale()) ed.kw.searching = false;
    }
  }
  async function kwChoose(ed, cand, top) {
    if (kwCtrl) kwCtrl.abort();
    ed.kw.searching = false; // la recherche en cours (Wikidata, souvent la plus lente) s'arrête ici
    const ctrl = new AbortController();
    kwCtrl = ctrl;
    const ch = { candId: cand.id, source: cand.source, title: cand.title || null, subcats: cand.subcats || 0, withSubs: false, top: top || null,
      name: top ? `${cand.name} (les ${top} plus connus)` : cand.name, loading: true, error: '', items: null, total: 0, interp: cand.interp || '', progress: '', checked: 0 };
    ed.kw.chosen = ch;
    await kwLoad(ed, cand, ctrl);
  }
  async function kwLoad(ed, cand, ctrl) {
    const ch = ed.kw.chosen;
    const stale = () => kwCtrl !== ctrl || S.editor !== ed || ed.kw.chosen !== ch;
    ch.loading = true;
    ch.error = '';
    try {
      let items;
      if (cand.source === 'wd') items = ch.top ? await wdTop(cand.where, ch.top, ctrl.signal) : cand.items || [];
      else if (cand.source === 'links') {
        if (!ch.links) {
          const links = await pageLinks(cand.title, ctrl.signal);
          if (stale()) return;
          ch.links = markRaw(links);
        }
        const { top } = ch.links;
        items = top && !ch.allLinks ? ch.links.items.filter((i) => i.fits) : ch.links.items;
      } else if (cand.source === 'def') {
        const r = await defPages(cand, ch.top, ctrl.signal, (done, kept) => {
          if (!stale()) ch.progress = ch.top ? `${fmt(kept)} sur ${fmt(ch.top)} trouvés (${fmt(done)} lus)…` : `${fmt(done)} sur ${fmt(cand.size)} lus, ${fmt(kept)} retenus…`;
        });
        if (stale()) return;
        ch.checked = r.checked;
        items = r.items;
      } else items = await categoryMembers(cand.title, ch.withSubs, ctrl.signal);
      if (stale()) return;
      ch.total = items.length;
      ch.items = markRaw(items.slice(0, 3000));
    } catch (e) {
      if (!stale() && e.name !== 'AbortError') ch.error = e.message;
    } finally {
      if (!stale()) ch.loading = false;
    }
  }
  // Catégorie : avec ou sans sous-catégories ; page : seulement la nature dominante, ou tous les liens.
  function kwToggleSubs(ed, cand) {
    const ch = ed.kw.chosen;
    if (cand.source === 'links') ch.allLinks = !ch.allLinks; else ch.withSubs = !ch.withSubs;
    if (kwCtrl) kwCtrl.abort();
    const ctrl = new AbortController();
    kwCtrl = ctrl;
    kwLoad(ed, cand, ctrl);
  }
  async function kwSave(ed) {
    const ch = ed.kw.chosen;
    if (!ch || !ch.items || ed.busy) return;
    const name = ch.name.trim();
    if (!name) { ed.error = 'Donne un nom à ta collection.'; return; }
    if (ch.total > 3000) { ed.error = 'Trop grande (plus de 3 000 articles) : précise ta recherche.'; return; }
    ed.busy = true;
    ed.error = '';
    try {
      const items = ch.items.map((i) => {
        const it = { title: i.title, description: i.description || null, image: null, status: 'ok' };
        if (i.qid) it.qid = i.qid;
        return it;
      });
      const r = await api('POST', '/api/targets/save', { name, items });
      if (S.editor !== ed) return;
      if (r.target) upsertTarget(r.target); else await loadTargets();
      closeModal();
      if (r.target) openTarget(r.target.id);
      startPageviews();
      notify(`Collection « ${name} » enregistrée : ${fmt(items.length)} articles.`);
    } catch (e) {
      if (S.editor === ed) ed.error = e.message;
    } finally {
      ed.busy = false;
    }
  }

  // ---------------------------------------------------------------- tags à deux niveaux : menu, rangement
  const tokenLabel = (tok) => (tok.endsWith('/') ? tok.slice(0, -1) + ' (toute la catégorie)' : tagTitle(tok));
  function toggleTagCat(cat) {
    const open = new Set(S.tagCatsOpen);
    if (open.has(cat)) open.delete(cat); else open.add(cat);
    S.tagCatsOpen = [...open];
    store.set(LS.tagCats, JSON.stringify(S.tagCatsOpen));
  }
  // « Ranger mes tags » : une catégorie proposée pour chaque étiquette sans « / ».
  let arrangeCtrl = null;
  async function openArrange() {
    if (arrangeCtrl) arrangeCtrl.abort();
    const ctrl = new AbortController();
    arrangeCtrl = ctrl;
    const flat = tagList.value.filter((t) => !splitTag(t.name).cat);
    S.arrange = { rows: flat.map((t) => ({ from: t.name, count: t.count, cat: OTHER, why: '' })), loading: true, busy: false, progress: '', error: '' };
    S.modal = 'arrange';
    const ar = S.arrange; // l'objet réactif : c'est lui qu'on modifie
    const stale = () => arrangeCtrl !== ctrl || S.arrange !== ar;
    // 1. Ce que disent les suggestions des cartes qui portent l'étiquette (pays, métier, nature). On les calcule d'abord
    // pour quelques cartes de chaque étiquette si ce navigateur ne les a pas encore : c'est la source la plus sûre.
    const byTag = new Map();
    for (const c of cards.value) for (const t of c.tags) { if (!byTag.has(t)) byTag.set(t, []); byTag.get(t).push(c); }
    const sample = [...new Set(ar.rows.flatMap((r) => (byTag.get(r.from) || []).slice(0, 4).map((c) => c.title)))].filter((t) => !hasSugg(t));
    if (sample.length) {
      ar.progress = `Lecture des cartes sur Wikidata : 0 sur ${fmt(sample.length)}…`;
      try {
        await ensureSuggestions(sample, 3, (done) => { if (!stale()) ar.progress = `Lecture des cartes sur Wikidata : ${fmt(done)} sur ${fmt(sample.length)}…`; }, stale);
      } catch (e) { if (e.name === 'AbortError') return; }
      if (stale()) return;
    }
    for (const row of ar.rows) {
      const key = row.from.toLowerCase();
      for (const c of byTag.get(row.from) || []) {
        const sg = suggCache.get(c.title);
        if (!sg || sg.v !== 2) continue;
        if ((sg.p || []).some((x) => x.toLowerCase() === key)) { row.cat = 'Pays'; row.why = 'pays d\'une carte'; break; }
        if ((sg.m || []).some((x) => x.toLowerCase() === key)) { row.cat = 'Métiers'; row.why = 'métier d\'une carte'; break; }
        const n = (sg.n || []).find((x) => x[0].toLowerCase() === key);
        if (n) { row.cat = natGroupOf(n[1]); row.why = 'nature d\'une carte'; break; }
      }
    }
    // 2. Les autres : ce que Wikidata dit de l'étiquette elle-même.
    const rest = ar.rows.filter((r) => !r.why);
    try {
      const found = new Map();
      let i = 0;
      for (const row of rest) {
        if (stale()) return;
        ar.progress = `Recherche sur Wikidata : ${fmt(++i)} sur ${fmt(rest.length)}…`;
        const hits = await wdSearch(row.from, ctrl.signal, 3);
        if (hits.length) found.set(row.from, hits[0].id);
      }
      const kinds = await classifyItems([...new Set(found.values())], 3, ctrl.signal);
      const classes = [...new Set([...found.values()].filter((id) => (kinds.get(id) || {}).cls))];
      await resolveGroups(classes, 3, ctrl.signal);
      if (stale()) return;
      // Un mot libre (« Musique », « Sport ») trouve souvent un concept large sur Wikidata, mal rangé : on ne retient
      // que les pays, sûrs ; le reste devient une suggestion à confirmer et reste dans « Autres » par défaut.
      for (const row of rest) {
        const id = found.get(row.from);
        const k = (id && kinds.get(id)) || {};
        if (k.country) { row.cat = 'Pays'; row.why = 'pays (Wikidata)'; }
        else if (k.occ) row.why = 'peut-être un métier : à toi de voir';
        else if (k.cls) row.why = `peut-être « ${natGroupOf(id)} » : à toi de voir`;
      }
    } catch (e) {
      if (!stale() && e.name !== 'AbortError') ar.error = e.message;
    } finally {
      if (!stale()) { ar.loading = false; ar.progress = ''; }
    }
  }
  async function applyArrange(ar) {
    if (ar.busy) return;
    const todo = ar.rows.filter((r) => r.cat !== OTHER);
    ar.busy = true;
    ar.error = '';
    let done = 0;
    let skipped = 0;
    try {
      for (const row of todo) {
        if (S.arrange !== ar) return;
        const to = cleanTag(row.cat + '/' + row.from);
        if (to.length > 60 || to === row.from || !to.includes('/')) { skipped++; continue; }
        ar.progress = `Rangement : ${fmt(++done)} sur ${fmt(todo.length)}…`;
        await api('POST', '/api/tags/rename', { from: row.from, to });
        renameLocal(row.from, to);
        S.tagFilter = [...new Set(S.tagFilter.map((t) => (t === row.from ? to : t)))];
      }
      closeModal();
      notify(`Tags rangés : ${fmt(done)}${skipped ? ` (${fmt(skipped)} trop longs, laissés dans « Autres »)` : ''}.`);
    } catch (e) {
      ar.error = e.message;
    } finally {
      ar.busy = false;
      ar.progress = '';
    }
  }

  // ================================================================ « Entre amis » : partage entre membres
  // Le partage est activé par défaut (2026-10-16 ; chacun le coupe dans Réglages) et il est réciproque : on ne voit les cartes des autres membres que
  // si on montre les siennes (PATCH /api/me {shared}). Leurs cartes sont lues à la demande (onglet « Entre amis »,
  // ouverture d'une collection ou d'une case vide), par pages de 1 000, et gardées en mémoire pendant la visite ; elles
  // ne sont relues que si leur synchro ou leur nombre a changé. Le classeur ne fait que montrer qui a quoi : les
  // échanges se font dans le jeu, entre joueurs.
  const FRIENDS_TTL = 10 * 60 * 1000; // liste des membres relue au plus toutes les 10 min (sauf onglet ou « Actualiser »)
  function clearFriends() {
    friendsGen++;
    friendsJob = null;
    friendsAt = 0;
    if (friendQidCtrl) { friendQidCtrl.abort(); friendQidCtrl = null; }
    friendList.value = [];
    Object.assign(S.friends, { status: 'idle', busy: false, error: '', loading: '', open: null, q: '', filter: 'all', limit: PAGE, more: {}, page: null, trade: 'all', tradeDup: true,
      album: null, albumFilter: 'all', albumSort: 'order', albumLimit: ALBUM_PAGE, albumFrom: null, copies: {} });
  }
  // Carte d'un ami (champs montrés par le serveur, rien d'autre) ; adresses vérifiées avant d'en faire des liens.
  function prepFriendCard(c) {
    const title = String(c.title || '');
    const link = (v) => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : null);
    return markRaw({ id: String(c.id), title, rarity: RARITY_NAME[c.rarity] ? c.rarity : null, count: Math.max(1, Number(c.count) || 1),
      shiny: c.shiny === true, image: link(c.image), url: link(c.url), _k: fold(title) });
  }
  async function readMemberCards(id, gen) {
    const out = [];
    let part = '0';
    for (let guard = 0; guard < 100; guard++) {
      const r = await api('GET', '/api/members/' + encodeURIComponent(id) + '/cards?part=' + encodeURIComponent(String(part)));
      if (gen !== friendsGen) return null;
      for (const c of Array.isArray(r.cards) ? r.cards : []) if (c && c.id != null && c.title) out.push(prepFriendCard(c));
      const next = r.next_part;
      if (next === null || next === undefined || next === '' || next === part) break;
      part = next;
    }
    return out;
  }
  // Collection qu'un ami montre : son nom, si c'est une catégorie de Wikipédia qu'il suit (kind), et pour chaque
  // élément, le titre et le qid (rien d'autre n'est gardé).
  const QID_RE = /^Q[1-9]\d{0,11}$/;
  function prepFriendTarget(t) {
    const items = (Array.isArray(t.items) ? t.items : []).filter((it) => it && typeof it.title === 'string' && it.title)
      .map((it) => (typeof it.qid === 'string' && QID_RE.test(it.qid) ? { title: it.title, qid: it.qid } : { title: it.title }));
    return markRaw({ id: String(t.id), name: String(t.name || 'Sans nom'), cat: t.kind === 'category', items });
  }
  async function readMemberTargets(id, gen) {
    const out = [];
    let part = '0';
    for (let guard = 0; guard < 60; guard++) {
      const r = await api('GET', '/api/members/' + encodeURIComponent(id) + '/targets?part=' + encodeURIComponent(String(part)));
      if (gen !== friendsGen) return null;
      for (const t of Array.isArray(r.targets) ? r.targets : []) if (t && t.id != null) out.push(prepFriendTarget(t));
      const next = r.next_part;
      if (next === null || next === undefined || next === '' || next === part) break;
      part = next;
    }
    return out;
  }
  // Liste des membres (GET /api/members), puis les cartes de ceux qui ont changé, puis les collections de ceux qui les
  // montrent et dont le nombre ou le dernier changement a bougé. force : relire la liste même récente.
  function loadFriends(force) {
    if (!sharing()) return Promise.resolve();
    if (friendsJob) return friendsJob;
    if (!force && friendsAt && Date.now() - friendsAt < FRIENDS_TTL) return Promise.resolve();
    const gen = friendsGen;
    const fr = S.friends;
    const job = (async () => {
      fr.busy = true;
      fr.error = '';
      if (!friendList.value.length) fr.status = 'loading';
      try {
        const r = await api('GET', '/api/members');
        if (gen !== friendsGen) return;
        const prev = new Map(friendList.value.map((f) => [f.id, f]));
        const list = (Array.isArray(r.members) ? r.members : []).filter((m) => m && typeof m.id === 'string' && m.id).map((m) => {
          const p = prev.get(m.id);
          const count = Number(m.count) || 0;
          const same = p && p.cards && p.fetched_at === (m.fetched_at || null) && p.count === count;
          const tg = m.targets && typeof m.targets === 'object' ? m.targets : null;
          const tmark = tg ? `${Number(tg.count) || 0}|${tg.updated_at || ''}` : null;
          const sameT = tmark !== null && p && p.targets && p.tmark === tmark;
          return markRaw({ id: m.id, name: typeof m.name === 'string' ? m.name : '', count, fetched_at: m.fetched_at || null, cards: same ? p.cards : null,
            tshare: !!tg, tcount: tg ? Number(tg.count) || 0 : 0, tmark, targets: sameT ? p.targets : null });
        }).sort((a, b) => COLLATOR.compare(friendName(a), friendName(b)));
        friendList.value = list;
        if (fr.open && !list.some((f) => f.id === fr.open)) fr.open = null;
        fr.status = 'ready';
        for (const f of list) {
          if (f.cards) continue;
          fr.loading = `Lecture des cartes de ${friendName(f)}…`;
          let got;
          try {
            got = await readMemberCards(f.id, gen);
          } catch (e) {
            if (gen !== friendsGen) return;
            // A cessé de partager entre la liste et ses cartes : il disparaît de la liste.
            if (e.status === 404) { friendList.value = friendList.value.filter((x) => x.id !== f.id); continue; }
            throw e;
          }
          if (got === null || gen !== friendsGen) return;
          friendList.value = friendList.value.map((x) => (x.id === f.id ? markRaw({ ...x, cards: got }) : x));
        }
        for (const f of friendList.value) {
          if (!f.tshare || f.targets) continue;
          fr.loading = `Lecture des collections de ${friendName(f)}…`;
          let got;
          try {
            got = await readMemberTargets(f.id, gen);
          } catch (e) {
            if (gen !== friendsGen) return;
            // A cessé de montrer ses collections entre la liste et cette lecture : il redevient « ne partage pas ».
            if (e.status === 404) { friendList.value = friendList.value.map((x) => (x.id === f.id ? markRaw({ ...x, tshare: false, tmark: null, targets: null }) : x)); continue; }
            throw e;
          }
          if (got === null || gen !== friendsGen) return;
          friendList.value = friendList.value.map((x) => (x.id === f.id ? markRaw({ ...x, targets: got }) : x));
        }
        friendsAt = Date.now();
        resolveFriendQids();
      } catch (e) {
        if (gen !== friendsGen) return;
        // Partage coupé ailleurs (autre appareil) : la page revient à l'invitation à partager.
        if (e.status === 403 && S.me) { S.me.shared = false; S.me.shared_targets = false; clearFriends(); return; }
        fr.status = 'error';
        fr.error = e.message;
      } finally {
        if (gen === friendsGen) { fr.busy = false; fr.loading = ''; friendsJob = null; }
      }
    })();
    friendsJob = job;
    return job;
  }
  const ensureFriends = () => { if (sharing()) loadFriends(false); };
  // Titres des cartes des amis que tu n'as pas : leur identifiant Wikidata (même cache que les tiennes, 30 jours) fait
  // reconnaître une carte dont le titre diffère de celui d'une collection (renommage, homonymie). De même pour les
  // éléments sans qid des collections qu'ils montrent et qui leur manquent (2 000 au plus par lecture : le cache se
  // complète d'une visite à l'autre), par lots de 50 dans la même file que les tiens.
  const FRIEND_ITEM_QIDS = 2000;
  function resolveFriendQids() {
    if (!resolver || !Match) return;
    const t = resolver.now();
    const titles = new Map();
    for (const f of friendList.value) {
      for (const c of f.cards || []) {
        const k = Match.normTitle(c.title);
        if (!k || titles.has(k) || resolver.knownKey(k, t) !== undefined || findCard(c)) continue;
        titles.set(k, c.title);
      }
    }
    const indexOf = new Map(friendIndexes.value.map(({ f, index }) => [f.id, index]));
    let items = 0;
    for (const f of friendList.value) {
      const index = indexOf.get(f.id);
      for (const tg of f.targets || []) {
        for (const it of tg.items) {
          if (items >= FRIEND_ITEM_QIDS) break;
          if (it.qid) continue;
          const k = Match.normTitle(it.title);
          if (!k || titles.has(k) || resolver.knownKey(k, t) !== undefined || (index && index.findCard(it))) continue;
          titles.set(k, it.title);
          items++;
        }
      }
    }
    if (!titles.size) return;
    if (friendQidCtrl) friendQidCtrl.abort();
    const ctrl = new AbortController();
    friendQidCtrl = ctrl;
    // Une fois par seconde au plus pendant la résolution (et à la fin) : les échanges possibles se recalculent à chaque
    // qid appris, en O(personnes² × cases vides).
    let bumped = 0;
    const onProgress = () => { const now = Date.now(); if (now - bumped >= 1000) { bumped = now; qidVersion.value++; } };
    resolver.resolve([...titles.values()], { signal: ctrl.signal, onProgress })
      .then(() => { qidVersion.value++; })
      .catch(() => { /* annulée, ou Wikipédia indisponible : le rapprochement par titre reste */ })
      .finally(() => { if (friendQidCtrl === ctrl) friendQidCtrl = null; });
  }
  async function setShared(on) {
    const fr = S.friends;
    if (fr.shareBusy) return;
    fr.shareBusy = true;
    fr.shareError = '';
    try {
      const r = await api('PATCH', '/api/me', { shared: !!on });
      const now = r && typeof r.shared === 'boolean' ? r.shared : !!on;
      if (S.me) { S.me.shared = now; S.me.shared_targets = !!(now && r && r.shared_targets === true); }
      clearFriends();
      if (now) {
        notify('Tes cartes sont montrées aux autres membres qui montrent les leurs.');
        loadFriends(true);
      } else notify('Tes cartes ne sont plus montrées aux autres membres.');
    } catch (e) {
      fr.shareError = e.message;
    } finally {
      fr.shareBusy = false;
    }
  }
  // Second réglage, seulement quand on montre ses cartes : montrer aussi ses collections à compléter (PATCH
  // /api/me {shared_targets}). Ne change rien à ce que tu vois des autres.
  async function setSharedTargets(on) {
    const fr = S.friends;
    if (fr.shareBusy || !sharing()) return;
    fr.shareBusy = true;
    fr.shareError = '';
    try {
      const r = await api('PATCH', '/api/me', { shared_targets: !!on });
      const now = r && typeof r.shared_targets === 'boolean' ? r.shared_targets : !!on;
      if (S.me) S.me.shared_targets = now;
      notify(now ? 'Tes collections à compléter sont montrées aux membres qui montrent leurs cartes.' : 'Tes collections à compléter ne sont plus montrées aux autres membres.');
    } catch (e) {
      fr.shareError = e.message;
    } finally {
      fr.shareBusy = false;
    }
  }
  function openFriendBinder(id) {
    Object.assign(S.friends, { open: id, q: '', filter: 'all', limit: PAGE, page: null, album: null, albumFrom: null });
    toTop();
  }
  function closeFriendBinder() { S.friends.open = null; S.friends.album = null; toTop(); }
  // « Échanges possibles » : sous-page de l'onglet, avec son filtre (tout le monde par défaut).
  function openTrades(filter) {
    Object.assign(S.friends, { page: 'trades', open: null, album: null, trade: filter || 'all' });
    toTop();
  }
  function closeTrades() { S.friends.page = null; toTop(); }
  // Album d'une collection d'un ami (lecture seule) : depuis « Ses collections » de son classeur, la fiche d'une de ses
  // cartes, « Échanges possibles » ou « Ce qui pourrait intéresser tes amis » (from = 'trades' : un lien y ramène, avec
  // le filtre gardé). « ← Retour au classeur de Paul » ramène à son classeur.
  function openFriendAlbum(fid, tid, from) {
    const fr = S.friends;
    if (fr.open !== fid) Object.assign(fr, { q: '', filter: 'all', limit: PAGE });
    Object.assign(fr, { open: fid, album: tid, albumFilter: 'all', albumSort: 'order', albumLimit: ALBUM_PAGE, albumFrom: from || null, page: null });
    S.tab = 'amis';
    toTop();
  }
  function closeFriendAlbum() { S.friends.album = null; S.friends.albumFrom = null; toTop(); }
  function backToTrades() { Object.assign(S.friends, { album: null, albumFrom: null, open: null, page: 'trades' }); toTop(); }
  // Une carte (ou une case vide) de l'album d'un ami : fiche en lecture seule (viewFriendSheet), sans rien qui touche à
  // ton classeur. card : la sienne, s'il l'a.
  function openFriendItem(f, s, ev) {
    lastFocus = ev && ev.currentTarget ? ev.currentTarget : document.activeElement;
    if (S.modal) closeModal();
    S.openId = null;
    S.openMissing = markRaw({ title: s.item.title, qid: s.item.qid || null, description: null, image: null, status: 'ok',
      friend: { id: f.id, name: friendName(f), card: s.card || null } });
  }
  // « Créer la même collection chez moi » (album d'une collection d'un ami) : une collection à toi, de même nom, avec ses
  // articles tels qu'il les montre (titre et qid, déjà vérifiés par sa page), sans requête à Wikipédia ni source (on ne
  // connaît ni sa recherche ni sa catégorie : c'est une liste d'articles, rangée dans « Mes collections »). Rien ne la
  // relie ensuite à la sienne. copyOf : la tienne, si tu l'as créée ainsi pendant la visite (et qu'elle existe encore), ou
  // une des tiennes qui lui ressemble (même nom, sans source, autant d'articles : créée ainsi lors d'une autre visite).
  const copyKey = (f, t) => f.id + ':' + t.id;
  const copiedName = (t) => (t.name.length > 80 ? t.name.slice(0, 79) + '…' : t.name);
  const copyOf = (f, t) => {
    const id = S.friends.copies[copyKey(f, t)];
    const name = copiedName(t);
    return (id && targets.value.find((x) => x.id === id)) || targets.value.find((x) => !x.source && x.name === name && x.items.length === t.items.length) || null;
  };
  async function copyFriendCollection(f, t) {
    const fr = S.friends;
    if (fr.copyBusy || copyOf(f, t) || !t.items.length) return;
    fr.copyBusy = true;
    try {
      const items = t.items.map((it) => (it.qid ? { title: it.title, description: null, image: null, status: 'ok', qid: it.qid } : { title: it.title, description: null, image: null, status: 'ok' }));
      const name = copiedName(t);
      const r = await api('POST', '/api/targets/save', { name, items });
      if (r.target) upsertTarget(r.target); else await loadTargets();
      const mine = r.target ? targets.value.find((x) => x.id === r.target.id) : null;
      if (mine) fr.copies = { ...fr.copies, [copyKey(f, t)]: mine.id };
      notify(`Collection « ${name} » créée dans ton classeur : ${fmt(items.length)} ${plural(items.length, 'article', 'articles')}.`);
    } catch (e) {
      notify(e.message, true);
    } finally {
      fr.copyBusy = false;
    }
  }

  // ================================================================ marché : cotes, valeur, bonnes affaires (SPEC.md, « Le marché »)
  // Tout ce qui vient du jeu est lu par le favori, dans la page du jeu, à son clic « Mettre à jour les cotes » (cette page
  // ne peut pas lire la base du jeu : CSP, et pas de session) ; ici, on montre ce que le serveur a rangé : la valeur du
  // classeur et son historique (GET /api/market), la dernière lecture du marché (bonnes affaires, tes enchères et tes
  // ventes, 24 h au plus), et les cotes de tes cartes et des cartes qui te manquent (GET /api/market/prices, communes à
  // tous les classeurs). Relu à l'ouverture, après chaque changement des cartes et à l'ouverture de l'onglet « Marché »,
  // une fois par minute au plus (sauf demande).
  const M = reactive({ loaded: false, busy: false, error: '', value: null, history: [], live: null, liveAt: null, at: 0, hover: -1 });
  const prices = shallowRef(new Map()); // card_id -> {id, v: {"R": {p, n, w, l, d}, "R*": …}, at}
  const wantedPrices = shallowRef(new Map()); // titre (normTitle) d'une carte qui te manque -> la même chose
  let marketJob = null;
  const VARIANT_RE = /^(C|PC|R|SR|UR|L)\*?$/;
  function resetMarket() {
    Object.assign(M, { loaded: false, busy: false, error: '', value: null, history: [], live: null, liveAt: null, at: 0, hover: -1 });
    prices.value = new Map();
    wantedPrices.value = new Map();
  }
  function loadMarket(force) {
    if (S.boot !== 'app' || !S.key) return Promise.resolve();
    if (marketJob) return marketJob;
    if (!force && M.at && Date.now() - M.at < 60000) return Promise.resolve();
    const gen = cardsGen;
    M.busy = true;
    marketJob = (async () => {
      try {
        const m = await api('GET', '/api/market');
        const list = [];
        for (let part = '0', guard = 0; part !== null && part !== undefined && part !== '' && guard < 200; guard++) {
          const r = await api('GET', '/api/market/prices?part=' + encodeURIComponent(String(part)));
          if (gen !== cardsGen) return;
          if (Array.isArray(r.prices)) list.push(...r.prices);
          part = r.next_part === part ? null : r.next_part;
        }
        if (gen !== cardsGen) return;
        const byId = new Map();
        const byTitle = new Map();
        for (const p of list) {
          if (!p || p.id == null || !p.v || typeof p.v !== 'object') continue;
          const x = markRaw({ id: String(p.id), v: p.v, at: p.at || null });
          byId.set(x.id, x);
          if (typeof p.t === 'string') byTitle.set(normTitle(p.t), x);
        }
        prices.value = byId;
        wantedPrices.value = byTitle;
        const live = m.live && typeof m.live === 'object' ? m.live : null;
        Object.assign(M, { value: m.value || null, history: Array.isArray(m.history) ? m.history : [], live, liveAt: m.live_at || null, loaded: true, error: '' });
      } catch (e) {
        if (gen === cardsGen) M.error = e.message;
      } finally {
        if (gen === cardsGen) { M.busy = false; M.at = Date.now(); }
        marketJob = null;
      }
    })();
    return marketJob;
  }
  // Exemplaires d'une carte par rareté d'exemplaire et brillance (« R* ») : son détail (variants) si le favori l'a
  // envoyé, sinon approché comme le fait le serveur (tous dans sa plus haute rareté, un seul brillant si elle l'est).
  function variantsOf(c) {
    const v = c && c.variants && typeof c.variants === 'object' ? Object.entries(c.variants).filter(([k, n]) => VARIANT_RE.test(k) && n > 0) : null;
    if (v && v.length) return { list: v, approx: false };
    const n = Math.max(1, Number(c && c.count) || 1);
    const r = (c && c.rarity) || 'C';
    return { list: c && c.shiny ? [[r + '*', 1], ...(n > 1 ? [[r, n - 1]] : [])] : [[r, n]], approx: true };
  }
  const reliable = (q) => !!q && Number(q.n) >= 3;
  const wfmt = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : (Math.abs(n) >= 100 ? NUM.format(Math.round(n)) : NUM2.format(n)) + ' W');
  const variantName = (k) => (RARITY_NAME[k.replace('*', '')] || k) + (k.endsWith('*') ? ', brillante' : '');
  const variantOrder = (a, b) => rarityRank(a.replace('*', '')) - rarityRank(b.replace('*', '')) || (a < b ? -1 : a > b ? 1 : 0);
  const pctOf = (p, w) => { const d = Math.round(((p - w) / w) * 100); return (d > 0 ? '+' : d < 0 ? '−' : '') + NUM.format(Math.abs(d)) + ' %'; };
  // « Cartes qui bougent » : écart en W sur 7 jours de tes exemplaires (cote fiable maintenant et il y a 7 jours), les 12
  // plus fortes hausses et les 12 plus fortes baisses.
  const movers = computed(() => {
    const map = prices.value;
    const all = [];
    if (!map.size) return { up: [], down: [] };
    for (const c of cards.value) {
      const p = map.get(String(c.id));
      if (!p) continue;
      let delta = 0;
      let now = 0;
      let then = 0;
      for (const [k, n] of variantsOf(c).list) {
        const q = p.v[k];
        if (!reliable(q) || q.w == null || !(q.w > 0)) continue;
        delta += (q.p - q.w) * n;
        now += q.p * n;
        then += q.w * n;
      }
      if (delta) all.push({ c, delta, pct: pctOf(now, then) });
    }
    return {
      up: all.filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 12),
      down: all.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 12),
    };
  });
  const leftText = (end) => {
    const ms = Date.parse(end) - Date.now();
    if (!(ms > 0)) return 'se termine';
    const m = Math.round(ms / 60000);
    if (m < 60) return `encore ${m} min`;
    if (m < 2880) return `encore ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
    return `encore ${Math.round(m / 1440)} jours`;
  };

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
    const shown = tags.slice(0, 3).map((t) => h('span', { class: ['tag', { auto }], key: t, title: tagTitle(t) }, tagSub(t)));
    if (tags.length > 3) shown.push(h('span', { class: 'tag more', key: '+', title: tags.slice(3).map(tagTitle).join(', ') }, '+' + (tags.length - 3)));
    return shown;
  }
  // Liste déroulante des catégories de tags (facultative quand on tape un tag).
  function catSelect(id, value, onChange, label, withEmpty) {
    const opts = withEmpty ? [h('option', { key: '', value: '' }, 'Catégorie…')] : [];
    const list = TAG_CATS.includes(value) || !value ? TAG_CATS : [...TAG_CATS, value];
    return h('select', { id: id || null, class: 'field cat-select', value: value || '', 'aria-label': label, onChange: (e) => onChange(e.target.value) },
      [...opts, ...list.map((c) => h('option', { key: c, value: c }, c))]);
  }
  // Menu des tags : catégories larges, puis sous-catégories (deux niveaux au plus).
  const tagTree = computed(() => {
    const groups = new Map();
    for (const t of tagList.value) { const cat = tagCat(t.name); if (!groups.has(cat)) groups.set(cat, []); groups.get(cat).push(t); }
    const perCat = new Map();
    for (const c of cards.value) for (const cat of new Set(c.tags.map(tagCat))) perCat.set(cat, (perCat.get(cat) || 0) + 1);
    const extra = [...groups.keys()].filter((c) => !TAG_CATS.includes(c)).sort(COLLATOR.compare);
    const order = [...TAG_CATS.filter((c) => c !== OTHER && groups.has(c)), ...extra, ...(groups.has(OTHER) ? [OTHER] : [])];
    return order.map((cat) => ({ cat, tags: groups.get(cat), count: perCat.get(cat) || 0 }));
  });

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
  // Une carte dans une grille : la carte et sa case de sélection. Ses tags (et les suggestions) ne sont que dans la
  // fiche, ouverte d'un clic sur la carte (demande de l'utilisateur, 2026-10-16).
  function viewCell(c) {
    const sel = S.selected.has(c.id);
    return h('div', { class: ['cell', { selected: sel, pulled: S.openId === c.id }] }, [
      viewCard(c, false),
      h('label', { class: 'pick', title: 'Sélectionner (Maj+clic : une plage)' }, [
        h('input', { type: 'checkbox', checked: sel, 'aria-label': 'Sélectionner ' + c.title, onClick: (e) => toggleSelect(c.id, e) }),
        icon('check'),
      ]),
    ]);
  }
  // Icône « Copier le nom » : à côté du titre des fiches, en haut à droite des cases vides (slot). Le nom copié se
  // colle dans la recherche du jeu.
  function copyNameButton(title, slot) {
    const id = 'nom:' + title;
    const done = S.copied === id;
    return h('button', {
      class: slot ? 'slot__copy' : 'copy-name', type: 'button',
      title: done ? 'Nom copié' : `Copier « ${title} » pour le coller dans la recherche du jeu (Ctrl+V, ⌘+V sur Mac)`,
      'aria-label': done ? `Nom « ${title} » copié` : `Copier le nom « ${title} »`,
      onClick: () => copyName(title, id),
    }, [icon(done ? 'check' : 'copy', slot ? '' : 'sm')]);
  }
  // Titre d'une fiche, avec l'icône « Copier le nom » à côté (sauf article à vérifier).
  const ficheTitle = (title, copy) => h('div', { class: 'fiche__title' }, [h('h2', { id: 'detail-title' }, title), copy ? copyNameButton(title) : null]);
  // Case vide d'une collection : la carte qui te manque. Toute la case ouvre sa fiche : un bouton étendu sur la case
  // (frère du bouton « Copier le nom », jamais parent : pas de contrôle dans un contrôle), qui passe au-dessus.
  function viewSlot(s, col) {
    const it = s.item;
    const img = it.image || s.thumb;
    let views = '';
    if (it.status === 'ok') views = s.views != null ? `${fmt(s.views)} vues / 30 j` : S.pv.running ? 'vues…' : 'vues inconnues';
    return h('div', { class: ['slot', { pulled: !!S.openMissing && S.openMissing.title === it.title }], key: s.key }, [
      img ? h('img', { class: 'slot__bg', src: img, alt: '', loading: 'lazy', decoding: 'async', onError: hideBroken }) : null,
      col.ordered ? h('span', { class: 'slot__no', 'aria-hidden': 'true' }, String(s.i)) : null,
      h('button', { class: 'slot__open', type: 'button', title: 'Pas encore dans ta collection : ouvrir la fiche',
        'aria-label': `${it.title} : pas encore dans ta collection, ouvrir la fiche`, onClick: (e) => openMissingFrom(it, e) }),
      h('div', { class: 'slot__top' }, it.status === 'ok' ? [s.real ? pill(s.real) : pill(s.est, true), copyNameButton(it.title, true)] : []),
      h('h3', null, it.title),
      it.description ? h('p', null, it.description) : null,
      it.status === 'missing' ? h('p', { class: 'warn' }, 'Article introuvable sur Wikipédia') : null,
      it.status === 'disambiguation' ? h('p', { class: 'warn' }, "Page d'homonymie : précise le titre") : null,
      friendBadge(it),
      views ? h('span', { class: 'views' }, views) : null,
    ]);
  }
  // Case vide qu'un ami peut remplir (partage entre membres) : « chez Paul ×2 », « +1 » s'il y en a d'autres.
  function friendBadge(item) {
    const list = holdersOf(item);
    if (!list.length) return null;
    const first = list[0];
    const label = `chez ${friendName(first)}${first.count > 1 ? ' ×' + fmt(first.count) : ''}${list.length > 1 ? ' +' + (list.length - 1) : ''}`;
    return h('span', { class: ['slot__friends', { dup: first.count > 1 }], title: 'Chez : ' + holdersText(list) }, label);
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
        sourceKind(col),
      ]),
    ]);
  }
  // Mention discrète d'une collection faite d'une catégorie ou d'une page de Wikipédia.
  function sourceKind(col) {
    if (col.cat) return h('span', { class: 'row-kind' }, 'depuis la catégorie Wikipédia');
    if (col.page) return h('span', { class: 'row-kind' }, `depuis la page Wikipédia « ${col.page} »`);
    return null;
  }

  // ================================================================ rendu : bandeau et onglets
  const TABS = [['collections', 'Collections'], ['cartes', 'Mes cartes'], ['amis', 'Entre amis'], ['marche', 'Marché'], ['chat', 'Chat'], ['maj', 'Mettre à jour'], ['reglages', 'Réglages']];
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
        [icon('refresh', S.refresh.running ? 'spin' : ''), S.refresh.running ? 'Rafraîchissement…' : (sess.has_cookie && !sess.expired ? 'Rafraîchir la collection' : 'Mettre à jour avec le favori')]),
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
    // Nombre de collections de « Mes collections » (celles faites d'une catégorie de Wikipédia comprises ; pas de total).
    const nCol = collections.value.mine.length;
    const nL = counts.L || 0;
    return h('div', { class: 'summary' }, [
      h('div', { class: 'figures' }, [
        h('div', { class: 'figure' }, [h('b', null, fmt(total)), h('span', null, 'cartes différentes')]),
        copies.value !== total ? h('div', { class: 'figure' }, [h('b', null, fmt(copies.value)), h('span', null, 'exemplaires')]) : null,
        h('div', { class: 'figure' }, [h('b', null, fmt(nCol)), h('span', null, plural(nCol, 'collection', 'collections'))]),
        h('div', { class: 'figure' }, [h('b', null, fmt(nL)), h('span', null, plural(nL, 'légendaire', 'légendaires'))]),
        M.value && M.value.priced ? h('div', { class: 'figure', title: `${fmt(M.value.priced)} ${plural(M.value.priced, 'carte cotée', 'cartes cotées')} sur ${fmt(M.value.cards)} : onglet « Marché »` },
          [h('b', null, wfmt(M.value.value)), h('span', null, `valeur (${fmt(M.value.priced)} ${plural(M.value.priced, 'cotée', 'cotées')})`)]) : null,
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
        h('p', { class: 'note' }, 'Outil personnel, sans lien avec le jeu. Les cartes viennent de ta collection, les illustrations de Wikimedia Commons, les listes et les catégories de Wikipédia et de Wikidata.'),
      ]),
      viewSummary(),
      h('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Sections' }, TABS.map(([id, label]) => h('button', {
        key: id, id: 'tab-' + id, type: 'button', role: 'tab', 'aria-selected': String(S.tab === id), 'aria-controls': 'panel-' + id,
        tabindex: S.tab === id ? '0' : '-1', onClick: () => setTab(id), onKeydown: onTabKey,
      }, id === 'chat' ? chatTabLabel(label) : label))),
    ])]);
  }

  // ================================================================ rendu : onglet Collections
  // Deux zones : « Mes collections » (toutes : favori depuis la Collection globale du jeu, à la main, ou depuis une
  // catégorie de Wikipédia), puis « Catégories » : des catégories de Wikipédia d'où créer une collection (recherche,
  // propositions d'après tes cartes).
  function viewWpRow(p) {
    const owned = p.cards.map((t) => byTitle.value.get(normTitle(t))).filter(Boolean).map((l) => l[0]);
    const byR = {};
    for (const c of owned) byR[c.rarity] = (byR[c.rarity] || 0) + 1;
    const sample = owned.slice().sort((a, b) => (RANK[a.rarity] ?? 9) - (RANK[b.rarity] ?? 9) || (b.image ? 1 : 0) - (a.image ? 1 : 0)).slice(0, 3);
    const busy = !!S.wp.busy[p.key];
    // « A, B et C », « A, B, C et 2 autres ».
    const andList = (l) => (l.length > 3 ? `${l.slice(0, 3).join(', ')} et ${fmt(l.length - 3)} ${plural(l.length - 3, 'autre', 'autres')}`
      : l.length > 1 ? `${l.slice(0, -1).join(', ')} et ${l[l.length - 1]}` : l.join(''));
    const subs = Array.isArray(p.subs) ? p.subs : [];
    return h('div', { class: ['row', 'wp'], key: p.key }, [
      h('span', { class: 'fan', 'aria-hidden': 'true' }, sample.length ? sample.map(viewMini) : [h('span', { class: 'mini empty' })]),
      h('span', { class: 'info' }, [
        h('button', { class: 'name row-open', type: 'button', title: 'Ouvrir la catégorie', onClick: () => openCategory(p.title, { pages: p.size, subcats: p.subcats, withSubs: subs.length > 0 }) }, p.name),
        rarityBar(byR, p.size),
        h('span', { class: 'line' }, [h('span', null, [h('b', null, fmt(p.owned)), ` sur ${fmt(p.size)}${p.partial ? ' (avec sous-catégories)' : ''}`]),
          h('span', null, pct(p.owned, p.size))]),
        // Pourquoi elle est proposée : les cartes qui la rendent proposable.
        h('span', { class: 'row-why' }, 'Tu as : ' + andList(p.cards)),
        // Sous-catégories proposables cachées sous elle (prune) : « Créer une collection » les prend avec elle.
        subs.length ? h('span', { class: 'row-why row-subs' }, `Regroupe ${fmt(subs.length)} ${plural(subs.length, 'sous-catégorie proposée', 'sous-catégories proposées')} : ${andList(subs)}. La collection est créée sous-catégories comprises.`) : null,
        h('span', { class: 'row-actions' }, [
          h('button', { class: 'btn small primary', type: 'button', disabled: busy, 'aria-label': `Créer une collection « ${p.name} »`, onClick: () => createFromProposal(p) },
            busy ? 'Un instant…' : 'Créer une collection'),
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Retirer « ${p.name} » des propositions`, onClick: () => askHideWp(p) }, 'Retirer'),
          h('a', { class: 'small', href: p.url, target: '_blank', rel: 'noopener noreferrer' }, 'Voir sur Wikipédia ↗'),
        ]),
      ]),
    ]);
  }
  // « Proposées d'après tes cartes » : catégories de Wikipédia de tes cartes dont tu as au moins 5 % (et 2 cartes).
  function viewWpGroup() {
    if (!proposer) return null;
    const hidden = !!S.prefs.hide_proposals;
    const list = wpVisible.value;
    const retired = S.prefs.hidden_proposals.length;
    const head = h('div', { class: 'subhead-line' }, [
      h('h3', { class: 'subhead', id: 'h-wp' }, "Proposées d'après tes cartes"),
      h('button', { class: 'linkish', type: 'button', onClick: () => setHideProposals(!hidden) }, hidden ? 'Afficher les propositions' : 'Masquer les propositions'),
    ]);
    if (hidden) return h('div', { class: 'subgroup', role: 'group', 'aria-labelledby': 'h-wp' }, [head, h('p', { class: 'small muted' }, 'Propositions masquées.')]);
    // Catégories écartées parce que tes collections les couvrent déjà (règle des 80 %) : on le dit, avec la collection qui
    // en couvre le plus (une très grande collection peut en écarter presque toutes).
    const { covered: nCov, coveredBy: top } = wpPruned.value;
    const by = !top ? 'par tes collections' : top[1] === nCov ? `par « ${top[0]} »` : `par tes collections, surtout « ${top[0]} »`;
    const covText = !nCov ? ''
      : list.length ? `${fmt(nCov)} ${plural(nCov, 'autre catégorie de tes cartes écartée car déjà couverte', 'autres catégories de tes cartes écartées car déjà couvertes')} ${by}.`
        : `Pas de nouvelle proposition : ${fmt(nCov)} ${plural(nCov, 'catégorie de tes cartes est écartée car déjà couverte', 'catégories de tes cartes sont écartées car déjà couvertes')} ${by} (au moins 80 % ${plural(nCov, 'de ses cartes y sont', 'de leurs cartes y sont')} déjà).`;
    return h('div', { class: 'subgroup', role: 'group', 'aria-labelledby': 'h-wp' }, [
      head,
      S.wp.running ? h('div', { class: 'wp-progress', role: 'status' }, [
        h('progress', { max: Math.max(1, S.wp.total), value: Math.min(S.wp.done, Math.max(1, S.wp.total)), 'aria-label': 'Recherche de propositions' }),
        h('span', null, S.wp.label), h('button', { class: 'linkish', type: 'button', onClick: cancelProposals }, 'Annuler'),
      ]) : null,
      errLine(S.wp.error),
      list.length ? h('div', { class: 'rows' }, list.map(viewWpRow))
        : S.wp.running ? null : !covText ? h('p', { class: 'small muted' }, 'Pas de proposition pour l\'instant : une catégorie de Wikipédia de tes cartes est proposée quand tu en as au moins 5 % (et 2 cartes).') : null,
      covText && !S.wp.running ? h('p', { class: 'small muted wp-covered' }, covText) : null,
      S.wp.running ? null : h('div', { class: 'row-actions' }, [
        h('button', { class: 'linkish', type: 'button', onClick: () => computeProposals(true) }, 'Chercher de nouvelles propositions'),
        retired ? h('button', { class: 'linkish', type: 'button', onClick: restoreProposals },
          `Rétablir ${retired > 1 ? 'les ' + fmt(retired) + ' propositions retirées' : 'la proposition retirée'}`) : null,
      ]),
    ]);
  }
  // Recherche d'une catégorie ou d'une page « Liste de… » de Wikipédia (combobox), ou adresse d'une page collée :
  // suggestions au fil de la frappe (suggestSources, suggestFromUrl) en deux groupes, « Catégories » et « Pages de
  // liste » (une adresse : « Page Wikipédia »), ↑ ↓ pour choisir (d'un groupe à l'autre), Entrée pour ouvrir, Échap pour
  // fermer la liste.
  function viewCatSearch() {
    const cs = S.catSearch;
    const list = cs.list;
    const q = catQuery(cs.q);
    const open = cs.open && q.length >= 2 && list.length > 0;
    const act = Math.max(0, Math.min(cs.active, list.length - 1));
    const stale = cs.done !== cs.q; // suggestions d'un texte précédent, montrées en attendant (estompées)
    const urlTitle = wpTitleFromUrl(cs.q);
    let status = null;
    if (cs.open && q.length >= 2 && !open) {
      if (cs.error) status = cs.error;
      else if (cs.loading) status = urlTitle ? 'Lecture de la page sur Wikipédia…' : 'Recherche des catégories et des pages de liste…';
      else if (cs.done === cs.q) {
        status = urlTitle ? `Cette page n'existe pas sur Wikipédia : « ${urlTitle} ».`
          : looksLikeUrl(cs.q) ? "Colle l'adresse d'une page de Wikipédia en français (https://fr.wikipedia.org/wiki/…)."
            : 'Aucune catégorie ni page de liste de Wikipédia ne correspond.';
      }
    }
    // Groupes dans l'ordre de la liste (une suite de suggestions de même type) ; options numérotées dans cet ordre.
    const groups = [];
    list.forEach((m, i) => {
      const type = m.type === 'page' ? 'page' : 'cat';
      const g = groups[groups.length - 1];
      if (g && g.type === type) g.items.push([m, i]); else groups.push({ type, items: [[m, i]] });
    });
    const option = ([m, i]) => {
      const page = m.type === 'page';
      const mine = collectionFor(page ? PAGE_SRC + m.title : 'wp:' + m.name);
      return h('li', {
        id: 'cat-opt-' + i, key: (page ? 'p:' : 'c:') + m.title, role: 'option', 'aria-selected': String(i === act), class: { active: i === act },
        onMousedown: (e) => { e.preventDefault(); chooseCat(m); }, onMouseenter: () => { cs.active = i; },
      }, [
        h('span', { class: 'prop-list__name' }, page ? m.title : m.name),
        h('span', { class: 'prop-list__hint' }, mine ? 'ta collection'
          : !page && m.subcats ? `${fmt(m.subcats)} ${plural(m.subcats, 'sous-catégorie', 'sous-catégories')}` : ''),
        h('span', { class: 'prop-list__count num' }, page ? (m.list ? 'liste' : 'page') : `${fmt(m.pages)} ${plural(m.pages, 'article', 'articles')}`),
      ]);
    };
    const groupLabel = (type) => (type === 'cat' ? 'Catégories' : urlTitle ? 'Page Wikipédia' : 'Pages de liste');
    return h('div', { class: 'prop-search' }, [
      h('label', { class: 'sr', for: 'cat-q' }, "Chercher une catégorie ou une page de liste de Wikipédia, ou coller l'adresse d'une page"),
      h('input', {
        id: 'cat-q', class: 'field full', type: 'search', value: cs.q, autocomplete: 'off', spellcheck: 'false',
        placeholder: 'Catégorie, page « Liste de… » ou adresse Wikipédia : « violet », « races bovines »…',
        role: 'combobox', 'aria-expanded': String(open), 'aria-controls': 'cat-list', 'aria-autocomplete': 'list',
        'aria-activedescendant': open ? 'cat-opt-' + act : null, 'aria-busy': String(!!cs.loading),
        onInput: (e) => catSearchInput(e.target.value, e.inputType === 'insertFromPaste'),
        onFocus: () => { cs.open = true; },
        // Champ quitté : une Entrée en attente (suggestions pas encore arrivées) n'ouvrira plus rien.
        onBlur: () => { cs.enter = false; setTimeout(() => { cs.open = false; }, 150); },
        onKeydown: (e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); cs.open = true; cs.nav = true; cs.active = Math.min(act + 1, Math.max(0, list.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); cs.nav = true; cs.active = Math.max(act - 1, 0); }
          else if (e.key === 'Enter') { e.preventDefault(); catSearchEnter(); }
          else if (e.key === 'Escape' && cs.open) { e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); cs.open = false; }
        },
      }),
      open ? h('div', { id: 'cat-list', class: ['prop-list', { 'prop-list--stale': stale }], role: 'listbox', 'aria-label': 'Catégories et pages de Wikipédia' },
        groups.map((g, k) => h('ul', { key: g.type + k, class: 'prop-list__grp', role: 'group', 'aria-labelledby': 'cat-grp-' + k }, [
          h('li', { id: 'cat-grp-' + k, class: 'prop-list__group', role: 'presentation' }, groupLabel(g.type)),
          ...g.items.map(option),
        ]))) : status ? h('p', { class: 'prop-list prop-list--empty', role: 'status' }, status) : null,
    ]);
  }
  function viewCollections() {
    const { mine } = collections.value;
    const hasFavori = !!storedImportKey() || !!(S.me && S.me.has_import_key);
    return h('div', { class: 'groups' }, [
      h('section', { class: 'group', 'aria-labelledby': 'h-mine' }, [
        h('div', { class: 'section-head' }, [
          h('h2', { id: 'h-mine' }, 'Mes collections'),
          h('small', null, 'créées avec ton favori depuis la « Collection globale » du jeu, à la main, ou depuis une catégorie ou une page de Wikipédia'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn', type: 'button', onClick: () => openEditor(null) }, [icon('plus', 'sm'), 'Nouvelle collection']),
        ]),
        mine.length ? h('div', { class: 'rows' }, mine.map(viewRow))
          : h('div', { class: 'empty-box' }, [
            h('p', null, "Aucune collection pour l'instant. Le plus simple : sur wiki-masters.com, ouvre la « Collection globale », fais une recherche (« vache »…) puis clique ton favori : il propose d'en faire une collection, avec la rareté de chaque carte dans le jeu."),
            h('p', null, "Tu peux aussi en créer une ici, par mots-clés ou avec une liste d'articles (« Nouvelle collection »), ou depuis une catégorie de Wikipédia (plus bas)."),
            hasFavori ? null : h('button', { class: 'btn small', type: 'button', onClick: openFavori }, [icon('bookmark', 'sm'), 'Installer le favori']),
          ]),
      ]),
      h('section', { class: 'group', 'aria-labelledby': 'h-cats' }, [
        h('div', { class: 'section-head' }, [
          h('h2', { id: 'h-cats' }, 'Catégories'),
          h('small', null, "les catégories de Wikipédia (« Catégorie:Violet »…) et les pages « Liste de… » : cherches-en une (ou colle l'adresse d'une page), ouvre-la, fais-en une collection"),
        ]),
        viewCatSearch(),
        viewWpGroup(),
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
        h('p', { class: 'muted' }, "Cette collection n'existe plus."),
      ]);
    }
    const cv = col.kind === 'category' ? col.cv : null; // catégorie de Wikipédia ouverte (source d'une collection à créer)
    const reading = !!cv && (cv.loading || !cv.items);
    const p = progressOf(col);
    void S.pv.version;
    const missR = {};
    const missG = {}; // rareté donnée par le jeu (pastille sans « ≈ »)
    let unknown = 0;
    let problems = 0;
    let estimated = 0;
    for (const it of col.items) {
      if (findCard(it)) continue;
      if (it.status !== 'ok') { problems++; continue; }
      const real = realRarity(it);
      if (real) { missG[real] = (missG[real] || 0) + 1; continue; }
      estimated++;
      const info = pvCache.get(it.title);
      const est = estRarity(info ? info[0] : null);
      if (est) missR[est] = (missR[est] || 0) + 1; else unknown++;
    }
    const missing = p.total - p.own;
    const ownLine = p.own > 0 && missing > 0 ? [
      h('span', null, `Tu en as ${fmt(p.own)} :`),
      ...RAR_UP.slice().reverse().filter((r) => p.byR[r]).map((r) => h('span', { key: r }, [pill(r), ' ', h('b', { class: 'num' }, fmt(p.byR[r]))])),
    ] : null;
    const missLine = missing > 0 ? [
      h('span', null, `Il t'en manque ${fmt(missing)} :`),
      ...RAR_UP.slice().reverse().filter((r) => missG[r]).map((r) => h('span', { key: 'g' + r }, [pill(r), ' ', h('b', { class: 'num' }, fmt(missG[r]))])),
      ...RAR_UP.slice().reverse().filter((r) => missR[r]).map((r) => h('span', { key: r }, [pill(r, true), ' ', h('b', { class: 'num' }, fmt(missR[r]))])),
      unknown ? h('span', { key: '?' }, [pill(null), ' ', h('b', { class: 'num' }, fmt(unknown))]) : null,
      problems ? h('span', { key: '!' }, `· ${fmt(problems)} à vérifier`) : null,
    ] : [h('span', null, p.total ? 'Collection complète.' : 'Cette collection est vide.')];
    let hint = '≈ : rareté estimée d\'après les vues de l\'article sur Wikipédia ces 30 derniers jours.';
    if (!estimated && Object.keys(missG).length) hint = 'Rareté des cases vides : celle du jeu, relevée dans sa Collection globale.';
    else if (S.pv.running) hint = `Rareté estimée des cases vides : ${fmt(S.pv.done)} sur ${fmt(S.pv.total)} articles…`;
    else if (S.pv.error) hint = `Rareté estimée incomplète : ${S.pv.error}`;
    else if (Object.keys(missG).length) hint += ' Sans « ≈ » : rareté relevée dans le jeu.';
    // Catégorie ou page de Wikipédia : « Créer une collection » (déjà faite : « Ouvrir ta collection »), « Voir sur
    // Wikipédia » ; collection : « Modifier », « Supprimer » (et « Voir sur Wikipédia » pour celle faite d'une catégorie
    // ou d'une page).
    const wpLink = (title) => h('a', { class: 'btn ghost', href: wikiUrl(title), target: '_blank', rel: 'noopener noreferrer' }, 'Voir sur Wikipédia ↗');
    const tooBig = !!cv && cv.total > 3000;
    const pg = cv && cv.type === 'page' ? cv : null; // page de Wikipédia ouverte : ses liens
    const pgTop = pg && pg.links ? pg.links.top : null;
    let actions;
    if (cv) {
      const mineT = collectionFor(cv.key);
      // « Créer une collection » de sa proposition en cours (S.wp.busy) : en attente ici aussi, l'album passera à la
      // collection créée.
      const creating = cv.busy || !!S.wp.busy[cv.key];
      actions = [
        mineT ? h('button', { class: 'btn primary', type: 'button', onClick: () => openAlbum('target', mineT.id) }, 'Ouvrir ta collection')
          : h('button', { class: 'btn primary', type: 'button', disabled: creating || reading || !cv.items.length || tooBig, onClick: createFromCategory },
            [icon('plus', 'sm'), creating ? 'Un instant…' : 'Créer une collection']),
        wpLink(cv.title),
      ];
    } else {
      actions = [
        h('button', { class: 'btn', type: 'button', onClick: () => openEditor(col.t) }, [icon('pen', 'sm'), 'Modifier']),
        h('button', { class: 'btn danger', type: 'button', onClick: () => askDeleteTarget(col.t) }, [icon('trash', 'sm'), 'Supprimer']),
        col.cat ? wpLink(CAT_NS + catName(col.t.source)) : col.page ? wpLink(col.page) : null,
      ];
    }
    const total = albumSlots.value.length;
    const shown = visibleSlots.value.length;
    return h('div', null, [
      h('div', { class: 'album-head' }, [
        h('button', { class: 'back', type: 'button', onClick: closeAlbum }, '← Toutes les collections'),
        h('div', { class: 'album-title' }, [h('h2', { id: 'album-name', tabindex: '-1' }, col.name), reading ? null : h('span', { class: 'num' }, `${fmt(p.own)} sur ${fmt(p.total)}`),
          cv ? h('span', { class: 'badge' }, pg ? 'page de Wikipédia' : 'catégorie de Wikipédia') : sourceKind(col)]),
        cv && cv.subcats ? h('label', { class: 'check' }, [
          h('input', { type: 'checkbox', checked: cv.withSubs, disabled: cv.loading || cv.busy, onChange: toggleCatSubs }),
          ` inclure les sous-catégories (1 niveau : ${fmt(cv.subcats)})`]) : null,
        // Page : les articles qu'elle lie, ceux de leur nature dominante seulement (case cochée) ou tous.
        pg ? h('p', { class: 'hint' }, ['Les articles liés depuis la page « ', h('a', { href: wikiUrl(pg.title), target: '_blank', rel: 'noopener noreferrer' }, pg.title), ' »',
          pg.links && !pgTop && !reading ? ` : tous (${fmt(pg.links.items.length)}), sans nature dominante à filtrer.` : '.']) : null,
        pgTop ? h('label', { class: 'check' }, [
          h('input', { type: 'checkbox', checked: !pg.allLinks, disabled: pg.loading || pg.busy, onChange: toggleAllLinks }),
          ` ne garder que les « ${pgTop.label} » (${fmt(pgTop.n)} sur ${fmt(pg.links.items.length)} articles liés ; décochée : tous les liens)`]) : null,
        reading ? (cv.error ? null : h('p', { class: 'hint', role: 'status' }, pg ? 'Lecture des liens de la page sur Wikipédia et de leur nature sur Wikidata…' : 'Lecture des articles de la catégorie sur Wikipédia…')) : rarityBar(p.byR, p.total, 'bar big'),
        cv && cv.error ? h('p', { class: 'status err', role: 'alert' }, [cv.error, ' ', h('button', { class: 'linkish', type: 'button', onClick: () => loadCategory() }, 'Réessayer')]) : null,
        tooBig ? h('p', { class: 'warn' }, pg ? `Plus de 3 000 articles liés : trop pour une collection${pgTop && pg.allLinks ? ' (ne garde que les « ' + pgTop.label + ' »)' : ''}. Seuls les 3 000 premiers sont montrés.`
          : 'Plus de 3 000 articles : trop grande pour une collection. Seuls les 3 000 premiers sont montrés.') : null,
        !reading && ownLine ? h('div', { class: 'missing-sum' }, ownLine) : null,
        reading ? null : h('div', { class: 'missing-sum' }, missLine),
        !reading && missing > 0 ? h('p', { class: 'hint', 'aria-live': 'polite' }, hint) : null,
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
      total ? h(AlbumGrid) : reading ? null : h('div', { class: 'empty-box' }, p.total ? 'Aucune carte ici.' : pg ? 'Cette page ne lie aucun article.' : col.cat ? 'Cette catégorie ne contient aucun article.' : [
        'Ajoute des articles Wikipédia pour la remplir. ',
        h('button', { class: 'btn', type: 'button', onClick: () => openEditor(col.t) }, 'Modifier la collection'),
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
        : "Suggestions calculées pour toute la collection : elles s'affichent dans la fiche de chaque carte sans tag."),
      errLine(S.sugg.error),
      left ? h('button', { class: 'btn small', type: 'button', onClick: computeAllSuggestions }, `Calculer les suggestions pour toute la collection (${fmt(left)})`) : null,
    ];
  }
  function viewFacets() {
    const q = fold(S.tagSearch.trim());
    const open = new Set(S.tagCatsOpen);
    const tree = tagTree.value;
    let matches = 0;
    const nodes = tree.map((node) => {
      const subs = q ? node.tags.filter((t) => fold(t.name).includes(q)) : node.tags;
      if (q && !subs.length && !fold(node.cat).includes(q)) return null;
      matches += subs.length;
      const isOpen = q ? true : open.has(node.cat);
      const tok = node.cat + '/';
      return h('div', { class: 'tagcat', key: 'cat:' + node.cat }, [
        h('div', { class: 'tagcat__head' }, [
          h('button', { class: ['fold', { open: isOpen }], type: 'button', 'aria-expanded': String(isOpen), disabled: !!q,
            'aria-label': (isOpen ? 'Replier ' : 'Déplier ') + node.cat, onClick: () => toggleTagCat(node.cat) }, [icon('chev', 'sm')]),
          facetChip('cat:' + node.cat, node.cat, node.count, S.tagFilter.includes(tok), (e) => toggleTagFilter(tok, e),
            'Toutes les cartes de cette catégorie · Ctrl/⌘+clic : combiner'),
        ]),
        isOpen ? h('div', { class: 'chips tagcat__subs' }, (q ? subs : node.tags).map((t) => facetChip('tag:' + t.name, tagSub(t.name), t.count,
          S.tagFilter.includes(t.name), (e) => toggleTagFilter(t.name, e), tagTitle(t.name) + ' · Ctrl/⌘+clic : combiner'))) : null,
      ]);
    }).filter(Boolean);
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
        tagList.value.length ? h('div', { class: 'actions' }, [h('button', { class: 'btn small', type: 'button', onClick: openArrange }, [icon('grid', 'sm'), 'Ranger mes tags'])]) : null,
        tagList.value.length > 8 ? h('label', { class: 'tag-search' }, [sr('Chercher un tag'),
          h('input', { type: 'search', value: S.tagSearch, placeholder: 'Chercher un tag…', autocomplete: 'off', onInput: (e) => { S.tagSearch = e.target.value; } })]) : null,
        nodes.length ? h('div', { class: 'tagtree' }, nodes)
          : h('p', { class: 'small muted' }, tagList.value.length ? 'Aucun tag ne correspond.' : 'Pas encore de tag : sélectionne des cartes, ou ouvre une fiche pour en ajouter.'),
        q && nodes.length ? h('p', { class: 'small muted', role: 'status' }, `${fmt(matches)} ${plural(matches, 'tag trouvé', 'tags trouvés')}`) : null,
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
      ...S.tagFilter.map((t) => filterChip('tag:' + t, tokenLabel(t), () => { S.tagFilter = S.tagFilter.filter((x) => x !== t); }, 'Retirer le filtre ' + tokenLabel(t))),
      S.untaggedOnly ? filterChip('untagged', 'Sans tag', () => { S.untaggedOnly = false; }, 'Retirer le filtre Sans tag') : null,
      S.newOnly ? filterChip('new', 'Nouvelles', () => { S.newOnly = false; }, 'Retirer le filtre Nouvelles') : null,
      S.q.trim() ? filterChip('q', `« ${S.q.trim()} »`, () => { S.q = ''; }, 'Effacer la recherche') : null,
      rar.length ? filterChip('rar', 'Raretés : ' + rar.join(', '), () => { S.rarities = []; }, 'Afficher toutes les raretés') : null,
      S.tagFilter.length === 1 && !S.tagFilter[0].endsWith('/') ? h('button', { class: 'linkish', type: 'button', onClick: () => openTagEdit(S.tagFilter[0]) }, `Renommer ou supprimer « ${tagSub(S.tagFilter[0])} »`) : null,
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
  // Le même favori en script Tampermonkey (makeUserscript), proposé replié sous le favori.
  const userscriptText = computed(() => (S.bm.src && S.bm.importKey ? makeUserscript(S.bm.src, location.origin, S.bm.importKey) : ''));
  function viewUserscript() {
    const us = userscriptText.value;
    if (!us) return null;
    return h('details', { class: 'userscript' }, [
      h('summary', null, 'Sans cliquer à chaque fois : le script Tampermonkey (facultatif)'),
      h('p', { class: 'small muted' }, "Avec l'extension Tampermonkey ou Violentmonkey, ce script relie le classeur à chaque page du jeu que tu ouvres, sans clic : rien n'est lu avant ta première action (paquet, défausse, enchère, échange). Installation : dans l'extension, « Créer un nouveau script », remplace tout par ce texte, puis enregistre."),
      h('p', { class: 'small warn' }, "À savoir : il tourne sur toutes les pages du jeu sans geste de ta part (le favori, lui, attend ton clic). Il porte la clé d'import, comme le favori : si ton extension synchronise tes scripts (Google Drive, Dropbox…), la clé y part aussi. Régénérer le favori arrête aussi ce script : recolle-le alors."),
      h('div', { class: 'copy-row' }, [
        h('textarea', { id: 'us-code', class: 'field', rows: 3, readonly: true, value: us, spellcheck: 'false', 'aria-label': 'Script Tampermonkey', onFocus: (e) => e.target.select() }),
        h('button', { class: 'btn', type: 'button', onClick: () => copy(us, 'us-code') }, [icon(S.copied === 'us-code' ? 'check' : 'copy', 'sm'), S.copied === 'us-code' ? 'Copié' : 'Copier']),
      ]),
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
      h('p', null, "Ensuite, le favori reste relié à la page du jeu jusqu'à ce que tu la recharges : après tes actions (paquet ouvert, carte défaussée, mise aux enchères, échange), il renvoie tout seul tes nouvelles cartes, et ce classeur se met à jour pendant qu'il est ouvert. Il ne fait toujours que lire : il regarde passer les requêtes que la page du jeu fait d'elle-même, sans en envoyer ni en modifier, puis relit tes nouvelles cartes (au plus une fois par minute). Il ne joue pas et ne clique rien. Le badge « Classeur relié » le rappelle ; « Arrêter » le coupe."),
      h('p', { class: 'small muted' }, "Sur la page « Collection globale » du jeu, fais une recherche (« vache »…) puis clique le favori : il propose aussi d'en faire une collection à compléter, avec la vraie rareté de chaque carte dans le jeu."),
      h('p', { class: 'small muted' }, "« Mettre à jour les cotes », dans l'encart du favori : il lit les cotes du marché, les bonnes affaires et tes enchères pour l'onglet « Marché », directement dans la base du jeu avec ta session, à ton clic seulement (voir « À savoir » dans cet onglet). Un favori installé avant le 16 octobre 2026 n'a pas ce bouton : glisse à nouveau celui-ci dans ta barre."),
      h('p', { class: 'small muted' }, ['Barre de favoris cachée ? ', h('kbd', null, 'Ctrl'), '+', h('kbd', null, 'Maj'), '+', h('kbd', null, 'B'),
        ' (', h('kbd', null, '⌘'), '+', h('kbd', null, 'Maj'), '+', h('kbd', null, 'B'), ' sur Mac).']),
      hasKey ? h('h3', null, 'Le créer à la main') : null,
      hasKey ? h('p', { class: 'small muted' }, "Sur téléphone, ou si le glisser ne marche pas : crée un favori sur n'importe quelle page, nomme-le « Classeur », et remplace son adresse par ceci. Sur téléphone, tape ensuite « Classeur » dans la barre d'adresse sur wiki-masters.com et choisis le favori.") : null,
      hasKey ? copyRow('bm-url', url, 'Adresse du favori') : null,
      hasKey ? h('p', { class: 'small muted' }, "Le favori contient sa clé d'import : quelqu'un qui l'aurait pourrait envoyer des cartes dans ton classeur ou y créer des collections, sans pouvoir l'ouvrir. Ne le partage pas ; s'il a fuité, régénère-le dans les Réglages.") : null,
      hasKey ? viewUserscript() : null,
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
  // Relecture complète à la prochaine mise à jour (PATCH /api/me {force_full}) : seul remède à ce que la synchro rapide
  // ne voit pas (échange de deux cartes de même rareté, carte retirée des favoris dans le jeu…).
  const fullNext = reactive({ busy: false, error: '' });
  async function armFullRead() {
    Object.assign(fullNext, { busy: true, error: '' });
    try {
      await api('PATCH', '/api/me', { force_full: true });
      if (S.me) S.me.next_full = true;
    } catch (e) {
      fullNext.error = e.message;
    } finally {
      fullNext.busy = false;
    }
  }
  function viewFullNext() {
    const armed = !!(S.me && S.me.next_full);
    return h('div', { class: 'panel', style: { gridColumn: '1 / -1' } }, [
      h('h3', null, 'Tout relire'),
      h('p', { class: 'small muted' }, "D'habitude, le favori et le rafraîchissement ne lisent que tes nouvelles cartes. Un échange de deux cartes de même rareté, ou une carte retirée de tes favoris dans le jeu, peut leur échapper jusqu'à la relecture complète de la semaine."),
      armed ? h('p', { class: 'small', role: 'status' }, [icon('check', 'sm'), ' La prochaine mise à jour relira toute ta collection.'])
        : h('button', { class: 'btn small', type: 'button', disabled: fullNext.busy, onClick: armFullRead }, 'La prochaine mise à jour relira toute ta collection'),
      errLine(fullNext.error),
    ]);
  }
  function viewUpdate() {
    return h('div', { class: 'update' }, [viewFavori(), viewCookie(), viewFullNext()]);
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
      section('Partage entre membres', [
        h('label', { class: 'check' }, [
          h('input', { type: 'checkbox', id: 'set-shared', checked: sharing(), disabled: S.friends.shareBusy,
            onChange: (e) => { const want = e.target.checked; e.target.checked = sharing(); setShared(want); } }),
          'Montrer mes cartes aux autres membres du classeur',
        ]),
        sharing() ? h('label', { class: 'check check--sub' }, [
          h('input', { type: 'checkbox', id: 'set-shared-targets', checked: sharingTargets(), disabled: S.friends.shareBusy,
            onChange: (e) => { const want = e.target.checked; e.target.checked = sharingTargets(); setSharedTargets(want); } }),
          'et mes collections à compléter',
        ]) : null,
        h('p', { class: 'small muted' }, 'Réciproque : tu ne vois les cartes des autres membres (onglet « Entre amis ») que si tu montres les tiennes. Désactivé par défaut.'),
        h('p', { class: 'small muted' }, SHARE_WHAT),
        sharing() ? h('p', { class: 'small muted' }, SHARE_TARGETS_WHAT) : null,
        errLine(S.friends.shareError),
      ]),
      section('Ce navigateur', [
        h('p', null, "Sur un appareil partagé, fais-lui oublier ta clé et tout ce qu'il garde du classeur. Ton classeur reste intact : ton lien le rouvre."),
        h('div', { class: 'actions' }, [h('button', { class: 'btn', type: 'button', onClick: askForget }, 'Oublier ce navigateur')]),
      ]),
      section('Supprimer mon classeur', [
        h('p', null, 'Efface définitivement tes cartes rangées, tes tags, tes collections, ta session WikiMasters et tes messages du chat.'),
        h('div', { class: 'actions' }, [h('button', { class: 'btn danger', type: 'button', onClick: askDeleteAccount }, [icon('trash', 'sm'), 'Supprimer mon classeur'])]),
      ], 'danger-zone'),
    ]);
  }

  // ================================================================ rendu : onglet Entre amis
  const SHARE_WHAT = 'Ce qui est montré : ton prénom, ton nombre de cartes, la date de ta dernière synchro et, pour chaque carte, son titre, sa rareté, tes exemplaires, si elle est brillante, son illustration et son lien Wikipédia. Jamais tes tags, tes clés ni ta session WikiMasters ; tes collections à compléter seulement si tu le choisis en plus.';
  const SHARE_TARGETS_WHAT = 'Avec « et mes collections à compléter » : le nom de chacune de tes collections (avec la mention « depuis la catégorie Wikipédia » pour celles faites d\'une catégorie) et les titres de leurs articles, pour que tes amis voient lesquelles de leurs cartes les complètent. Jamais leurs descriptions ni la recherche qui les a créées ; seulement aux membres qui montrent leurs cartes.';
  const TRADE_NOTE = 'Le classeur ne fait que montrer qui a quoi : les échanges se font dans le jeu, entre vous.';
  const FRIEND_ROWS = 8; // lignes montrées par bloc avant « Voir les … »
  const syncedOn = (f) => (f.fetched_at ? `synchro du ${dateDay(f.fetched_at)}` : 'pas encore synchronisé');
  function holderChips(list) {
    return h('span', { class: 'holders' }, list.map((x) => h('span', { key: x.id, class: ['holder', { dup: x.count > 1 }] },
      x.count > 1 ? [friendName(x), h('b', null, ' ×' + fmt(x.count))] : friendName(x))));
  }
  function moreToggle(key, total) {
    if (total <= FRIEND_ROWS) return null;
    const open = !!S.friends.more[key];
    return h('button', { class: 'linkish', type: 'button', 'aria-expanded': String(open), onClick: () => { S.friends.more = { ...S.friends.more, [key]: !open }; } },
      open ? 'Réduire' : `Voir les ${fmt(total)}`);
  }
  function viewShareOff() {
    const fr = S.friends;
    return h('section', { class: 'panel friends-intro', 'aria-labelledby': 'h-friends' }, [
      h('h2', { id: 'h-friends' }, 'Entre amis'),
      h('p', null, 'Vois quelles cartes les autres membres du classeur ont pour compléter tes collections, et lesquelles des tiennes complètent les leurs.'),
      h('p', null, [h('b', null, 'Le partage est réciproque : '), 'tu ne vois les cartes des autres que si tu montres les tiennes. Tu peux arrêter quand tu veux, dans les Réglages.']),
      h('div', { class: 'actions' }, [h('button', { class: 'btn primary', type: 'button', disabled: fr.shareBusy, onClick: () => setShared(true) },
        fr.shareBusy ? 'Activation…' : 'Montrer mes cartes aux autres membres')]),
      errLine(fr.shareError),
      h('p', { class: 'small muted' }, SHARE_WHAT),
      h('p', { class: 'small muted' }, TRADE_NOTE),
    ]);
  }
  function viewMemberRow(f) {
    const st = friendStats.value.get(f.id);
    return h('div', { class: 'row member', key: f.id }, [
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, initialOf(friendName(f))),
      h('span', { class: 'info' }, [
        h('span', { class: 'name' }, friendName(f)),
        h('span', { class: 'line' }, [h('span', null, [h('b', null, fmt(f.count)), ' ' + plural(f.count, 'carte', 'cartes')]), h('span', null, syncedOn(f))]),
        st ? h('span', { class: 'line' }, [h('span', null, [h('b', null, fmt(st.missing)), ` ${plural(st.missing, 'carte', 'cartes')} que tu n'as pas`]),
          st.dup ? h('span', null, [h('b', null, fmt(st.dup)), ' en double']) : null]) : null,
        h('span', { class: 'line' }, [f.tshare
          ? h('span', null, ['partage ses collections : ', h('b', null, fmt(f.tcount))])
          : h('span', null, 'ne partage pas ses collections')]),
        h('span', { class: 'row-actions' }, [h('button', { class: 'btn small', type: 'button', disabled: !f.cards, onClick: () => openFriendBinder(f.id),
          'aria-label': `Parcourir le classeur de ${friendName(f)}` }, f.cards ? 'Parcourir son classeur' : 'Lecture…')]),
      ]),
    ]);
  }
  function viewFillCol(x) {
    const key = 'col:' + x.col.key;
    const rows = S.friends.more[key] ? x.rows : x.rows.slice(0, FRIEND_ROWS);
    const p = progressOf(x.col);
    return h('article', { class: 'fcol', key: x.col.key }, [
      h('div', { class: 'fcol__head' }, [
        h('button', { class: 'fcol__name', type: 'button', title: x.col.cat ? 'Ouvrir la catégorie' : 'Ouvrir la collection', onClick: () => openAlbum(x.col.kind, x.col.id) }, x.col.name),
        sourceKind(x.col),
        h('span', { class: 'fcol__sum' }, [h('b', null, fmt(x.rows.length)), ` ${plural(x.rows.length, 'case', 'cases')} à remplir chez tes amis`,
          ...(x.dup ? [' · ', h('b', null, fmt(x.dup)), ' en double'] : []), ` · tu en as ${fmt(p.own)} sur ${fmt(p.total)}`]),
      ]),
      h('ul', { class: 'fitems' }, rows.map((r) => h('li', { key: r.i }, [
        h('button', { class: 'fitem', type: 'button', 'aria-label': `${r.item.title} : chez ${holdersText(r.holders)}. Ouvrir la fiche`, onClick: (e) => openMissingFrom(r.item, e) }, [
          pill(r.holders[0].rarity), h('span', { class: 'fitem__title' }, r.item.title), holderChips(r.holders),
        ]),
      ]))),
      moreToggle(key, x.rows.length),
    ]);
  }
  function viewWant(x) {
    const key = 'want:' + x.f.id;
    const rows = S.friends.more[key] ? x.rows : x.rows.slice(0, FRIEND_ROWS);
    return h('article', { class: 'fcol', key }, [
      h('div', { class: 'fcol__head' }, [
        h('span', { class: 'fcol__name' }, friendName(x.f)),
        h('span', { class: 'fcol__sum' }, [h('b', null, fmt(x.rows.length)), ` de tes cartes ${plural(x.rows.length, 'complète', 'complètent')} ses collections`,
          ...(x.dup ? [' · ', h('b', null, fmt(x.dup)), ' que tu as en double'] : [])]),
      ]),
      h('ul', { class: 'fitems' }, rows.map((r) => h('li', { key: r.card.id }, [
        // Ta carte ouvre sa fiche ; le nom de chaque collection de l'ami, son album (deux boutons côte à côte).
        h('div', { class: 'fitem fitem--split', role: 'group', 'aria-label': `${r.card.title}, pour ${friendName(x.f)} (${colsText(r.cols, ', ')})` }, [
          h('button', { class: 'fitem__main', type: 'button', 'aria-label': `${r.card.title}, pour ${friendName(x.f)} (${colsText(r.cols, ', ')}). Ouvrir ta carte`, onClick: (e) => openCardFrom(r.card.id, e) }, [
            pill(r.card.rarity), h('span', { class: 'fitem__title' }, r.card.title),
            r.card.count > 1 ? h('span', { class: 'holder dup' }, ['tu en as ', h('b', null, '×' + fmt(r.card.count))]) : null,
          ]),
          h('span', { class: 'fitem__cols' }, colLinks(x.f, r.cols, null)),
        ]),
      ]))),
      moreToggle(key, x.rows.length),
    ]);
  }
  // Noms des collections d'une ligne : celles d'un ami (f) ouvrent son album en lecture seule ; les tiennes (f null) restent
  // du texte. Chaque nom s'écrit comme colsText l'écrit.
  function colLinks(f, cols, from) {
    if (!f) return [colsText(cols, ' · ')];
    const out = [];
    cols.forEach((c, i) => {
      const label = colsText([c], '');
      if (i) out.push(' · ');
      out.push(c.id == null ? label : h('button', { class: 'linkish fitem__col', type: 'button', key: 'col' + i,
        'aria-label': `Ouvrir « ${c.name} » de ${friendName(f)}`, onClick: () => openFriendAlbum(f.id, c.id, from) }, label));
    });
    return out;
  }
  // ---------------------------------------------------------------- « Échanges possibles »
  const personOf = (p) => (p.me ? 'Toi' : friendName(p.f));
  const andList = (names) => (names.length > 1 ? names.slice(0, -1).join(', ') + ' et ' + names[names.length - 1] : names[0] || '');
  // « Paul peut compléter 5 cases chez Léa, dont 3 en double » (une case = une carte qui manque, dans une ou plusieurs
  // de ses collections).
  function tradeSum(p) {
    const n = p.rows.length;
    return `${p.x.me ? 'Tu peux' : friendName(p.x.f) + ' peut'} compléter ${fmt(n)} ${plural(n, 'case', 'cases')} ${p.z.me ? 'chez toi' : 'chez ' + friendName(p.z.f)}`
      + (p.dup ? `, dont ${fmt(p.dup)} en double` : '');
  }
  // Une ligne : la carte de X (rareté, ×n si X l'a en double) → la ou les collections de Z qu'elle complète. Ta carte :
  // sa fiche ; une case vide chez toi : sa fiche de carte manquante ; entre deux amis : rien à ouvrir.
  function viewTradeRow(p, r) {
    const z = personOf(p.z);
    const from = p.x.me ? 'à toi' : 'de ' + friendName(p.x.f);
    const label = `${r.card.title}, ${RARITY_NAME[okRarity(r.card.rarity)] || 'rareté inconnue'}${r.dup ? `, ×${fmt(r.count)}` : ''}, ${from} : pourrait compléter ${colsText(r.cols, ', ')} ${p.z.me ? 'chez toi' : 'de ' + z}`;
    const body = [
      pill(r.card.rarity), h('span', { class: 'fitem__title' }, r.card.title),
      r.dup ? h('span', { class: 'holder dup', title: `${p.x.me ? 'Tu en as' : friendName(p.x.f) + ' en a'} ${fmt(r.count)} exemplaires` }, [h('b', null, '×' + fmt(r.count))]) : null,
    ];
    // Collections de Z : chez un ami, chaque nom ouvre son album (lecture seule) ; d'ici, un lien ramène aux échanges.
    const cols = h('span', { class: 'fitem__cols' }, ['→ ', ...colLinks(p.z.me ? null : p.z.f, r.cols, 'trades')]);
    if (p.z.me) return h('button', { class: 'fitem', type: 'button', 'aria-label': label + '. Ouvrir la fiche', onClick: (e) => openMissingFrom(r.item, e) }, [...body, cols]);
    if (p.x.me) {
      return h('div', { class: 'fitem fitem--split', role: 'group', 'aria-label': label }, [
        h('button', { class: 'fitem__main', type: 'button', 'aria-label': label + '. Ouvrir ta carte', onClick: (e) => openCardFrom(r.card.id, e) }, body), cols]);
    }
    return h('div', { class: 'fitem fitem--static', role: 'group', 'aria-label': label }, [...body, cols]);
  }
  function viewTradePair(p) {
    const key = 'trade:' + p.key;
    const rows = S.friends.more[key] ? p.rows : p.rows.slice(0, FRIEND_ROWS);
    return h('article', { class: ['fcol', 'trade'], key: p.key }, [
      h('div', { class: 'fcol__head' }, [
        h('span', { class: 'fcol__name' }, [personOf(p.x), h('span', { class: 'trade__arrow', 'aria-hidden': 'true' }, ' → '), h('span', { class: 'sr' }, ' pour '), personOf(p.z)]),
        h('span', { class: 'fcol__sum' }, tradeSum(p)),
      ]),
      h('ul', { class: 'fitems' }, rows.map((r) => h('li', { key: r.card.id }, [viewTradeRow(p, r)]))),
      moreToggle(key, p.rows.length),
    ]);
  }
  // Ce que disent les échanges : les membres qui ne partagent pas leurs collections (on ne sait pas ce qui leur
  // manque), ceux en lecture.
  function tradeNotes() {
    const t = trades.value;
    const out = [];
    if (t.hidden.length) {
      const names = andList(t.hidden.map(friendName));
      const many = t.hidden.length > 1;
      out.push(h('p', { class: 'trade-note', key: 'hidden' }, [h('b', null, names), many ? ' ne partagent pas leurs collections' : ' ne partage pas ses collections',
        ` : impossible de savoir ce qui ${many ? 'leur' : 'lui'} manque (${many ? 'leurs' : 'ses'} cartes peuvent quand même compléter les collections des autres).`]));
    }
    if (t.waiting.length) out.push(h('p', { class: 'small muted', role: 'status', key: 'waiting' }, `Lecture des collections de ${andList(t.waiting.map(friendName))}…`));
    if (!sharingTargets()) {
      out.push(h('p', { class: 'trade-note', key: 'mine' }, ['Tes amis ne voient pas tes collections : ils ne savent pas ce qui te manque. ',
        h('button', { class: 'linkish', type: 'button', disabled: S.friends.shareBusy, onClick: () => setSharedTargets(true) }, 'Partager aussi mes collections à compléter')]));
    }
    return out;
  }
  function viewTrades() {
    const fr = S.friends;
    const list = tradeView.value;
    const all = trades.value.pairs;
    const member = friendList.value.find((f) => f.id === fr.trade) || null;
    const loading = fr.busy || friendList.value.some((f) => !f.cards || (f.tshare && !f.targets));
    const n = list.reduce((a, p) => a + p.rows.length, 0);
    return h('div', null, [
      h('div', { class: 'album-head' }, [
        h('button', { class: 'back', type: 'button', onClick: closeTrades }, '← Entre amis'),
        h('div', { class: 'album-title' }, [h('h2', null, 'Échanges possibles'),
          h('span', { class: 'num' }, `${fmt(n)} ${plural(n, 'carte', 'cartes')} à donner · ${fmt(list.length)} ${plural(list.length, 'groupe', 'groupes')} « qui → à qui »`)]),
        h('p', { class: 'hint' }, "Telle carte de l'un pourrait compléter telle collection de l'autre. Les doubles d'abord : ce sont les plus faciles à donner. " + TRADE_NOTE),
        h('div', { class: 'toolbar' }, [
          h('div', { class: 'seg', role: 'group', 'aria-label': 'Échanges à montrer' }, [
            seg('Tout le monde', fr.trade === 'all' || (fr.trade !== 'me' && !member), () => { fr.trade = 'all'; }),
            seg('Ce qui me concerne', fr.trade === 'me', () => { fr.trade = 'me'; }),
          ]),
          h('label', { class: 'sr', for: 'trade-member' }, 'Les échanges d\'un membre'),
          h('select', { id: 'trade-member', class: 'field', value: member ? member.id : '', onChange: (e) => { fr.trade = e.target.value || 'all'; } },
            [h('option', { value: '' }, 'Un membre…'), ...friendList.value.map((f) => h('option', { key: f.id, value: f.id }, friendName(f)))]),
          h('label', { class: 'check' }, [
            h('input', { id: 'trade-dup', type: 'checkbox', checked: fr.tradeDup, onChange: () => { fr.tradeDup = !fr.tradeDup; } }),
            ' Seulement les cartes en double']),
        ]),
      ]),
      ...tradeNotes(),
      list.length ? h('div', { class: 'fcols' }, list.map(viewTradePair))
        : h('p', { class: 'empty-box' }, loading ? 'Recherche dans les classeurs…'
          : all.length ? (fr.tradeDup ? 'Aucune carte en double à donner avec ce filtre : décoche « Seulement les cartes en double », ou essaie « Tout le monde ».'
            : 'Aucun échange possible avec ce filtre : essaie « Tout le monde ».')
            : "Aucun échange possible pour l'instant : personne n'a de carte qui manque aux collections d'un autre."),
    ]);
  }
  // Carte d'un ami (lecture seule) : pas de fiche ni de sélection ; « Te manque » si tu ne l'as pas.
  function viewFriendCard(c) {
    const r = okRarity(c.rarity) || 'C';
    const have = !!findCard(c);
    return h('div', { class: 'cell', key: c.id }, [
      h('article', { class: ['card', 'card--friend', 'r' + r, { shiny: c.shiny, have }],
        'aria-label': `${c.title}, ${RARITY_NAME[r]}${c.shiny ? ', brillante' : ''}${c.count > 1 ? `, ${fmt(c.count)} exemplaires` : ''}, ${have ? "tu l'as" : 'te manque'}` }, [
        h('div', { class: 'card__art' }, [
          h('div', { class: 'card__noart' }, [h('span', null, initialOf(c.title))]),
          c.image ? h('img', { src: c.image, alt: '', loading: 'lazy', decoding: 'async', onError: hideBroken }) : null,
        ]),
        pill(r),
        c.count > 1 ? h('span', { class: 'card__count', title: `${fmt(c.count)} exemplaires` }, '×' + fmt(c.count)) : null,
        h('span', { class: ['card__mark', { have }] }, have ? "Tu l'as" : 'Te manque'),
        h('div', { class: 'card__body' }, [h('h3', { class: 'card__title' }, c.title)]),
        r === 'L' ? h('div', { class: 'card__sheen', 'aria-hidden': 'true' }) : null,
      ]),
      c.url ? h('a', { class: 'cell__link', href: c.url, target: '_blank', rel: 'noopener noreferrer' }, 'Wikipédia ↗') : null,
    ]);
  }
  // ---------------------------------------------------------------- « Ses collections » et album d'une collection d'un ami
  // Une collection d'un ami, comme les tiennes : ses cartes en éventail, sa progression (« 12 sur 40 », barre, %), et ce
  // que tu peux lui donner (ses cases vides que tes cartes remplissent, dont tes doubles).
  function viewFriendColRow(f, r) {
    const p = r.p;
    return h('button', { class: ['row', { zero: !p.own }], type: 'button', key: r.key, onClick: () => openFriendAlbum(f.id, r.t.id, null),
      'aria-label': `${r.t.name} : ${friendName(f)} en a ${fmt(p.own)} sur ${fmt(p.total)}${p.help ? `, tu as ${fmt(p.help)} ${plural(p.help, 'carte', 'cartes')} qui lui ${plural(p.help, 'manque', 'manquent')}` : ''}` }, [
      h('span', { class: 'fan', 'aria-hidden': 'true' }, p.sample.length ? p.sample.map(viewMini) : [h('span', { class: 'mini empty' })]),
      h('span', { class: 'info' }, [
        h('span', { class: 'name' }, r.t.name),
        r.t.cat ? h('span', { class: 'row-kind' }, 'depuis la catégorie Wikipédia') : null,
        rarityBar(p.byR, p.total),
        h('span', { class: 'line' }, [h('span', null, [h('b', null, fmt(p.own)), ` sur ${fmt(p.total)}`]), h('span', null, pct(p.own, p.total))]),
        p.help ? h('span', { class: 'row-help' }, ['Tu peux l\'aider : ', h('b', null, fmt(p.help)), p.helpDup ? `, dont ${fmt(p.helpDup)} en double` : '']) : null,
      ]),
    ]);
  }
  // « Ses collections » dans le classeur d'un ami : toutes ses collections, dans une liste (celles tirées d'une catégorie
  // de Wikipédia signalées discrètement) ; rien (une phrase) s'il ne les partage pas.
  function viewFriendCols(f) {
    const name = friendName(f);
    const v = f.tshare && f.targets ? friendTargetsView.value : null;
    const key = 'fcols:' + f.id;
    let body;
    if (!f.tshare) body = [h('p', { class: 'small muted' }, `${name} ne partage pas ses collections.`)];
    else if (!v) body = [h('p', { class: 'small muted', role: 'status' }, 'Lecture de ses collections…')];
    else if (!v.rows.length) body = [h('p', { class: 'small muted' }, `${name} n'a pas encore de collection.`)];
    else {
      const shown = S.friends.more[key] ? v.rows : v.rows.slice(0, FRIEND_ROWS);
      body = [h('div', { class: 'rows' }, shown.map((r) => viewFriendColRow(f, r))), moreToggle(key, v.rows.length)];
    }
    return h('section', { class: 'group', 'aria-labelledby': 'h-fcols' }, [
      h('div', { class: 'section-head' }, [h('h2', { id: 'h-fcols' }, 'Ses collections'),
        f.tshare ? h('small', null, `la progression de ${name} avec ses cartes ; ouvre-en une pour voir ce que tu peux lui donner`) : null]),
      ...body,
    ]);
  }
  // Une carte de l'ami dans son album : « Tu l'as » (estompée) ou « Te manque » ; si elle remplirait une de tes
  // collections, elle ressort, avec leurs noms dessous. Un clic ouvre la fiche en lecture seule.
  function viewFriendAlbumCard(s, f) {
    const c = s.card;
    const r = okRarity(c.rarity) || 'C';
    const have = !!s.mine;
    const want = !have && s.want && s.want.length ? s.want : null;
    const open = (e) => openFriendItem(f, s, e);
    const label = `${c.title}, ${RARITY_NAME[r]}${c.shiny ? ', brillante' : ''}${c.count > 1 ? `, ${fmt(c.count)} exemplaires` : ''} chez ${friendName(f)}, `
      + `${have ? "tu l'as" : want ? 'manque à ' + colsText(want, ', ') : 'te manque'} : ouvrir la fiche`;
    return h('div', { class: ['cell', { pulled: !!S.openMissing && !!S.openMissing.friend && S.openMissing.title === s.item.title }], key: s.key }, [
      h('article', { class: ['card', 'card--friend', 'card--fa', 'r' + r, { shiny: c.shiny, have, want: !!want }], role: 'button', tabindex: '0', 'aria-label': label,
        onClick: open, onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } } }, [
        h('div', { class: 'card__art' }, [
          h('div', { class: 'card__noart' }, [h('span', null, initialOf(c.title))]),
          c.image ? h('img', { src: c.image, alt: '', loading: 'lazy', decoding: 'async', onError: hideBroken }) : null,
        ]),
        pill(r),
        c.count > 1 ? h('span', { class: 'card__count', title: `${fmt(c.count)} exemplaires chez ${friendName(f)}` }, '×' + fmt(c.count)) : null,
        h('span', { class: ['card__mark', { have }] }, have ? "Tu l'as" : 'Te manque'),
        h('div', { class: 'card__body' }, [h('h3', { class: 'card__title' }, c.title)]),
        r === 'L' ? h('div', { class: 'card__sheen', 'aria-hidden': 'true' }) : null,
      ]),
      want ? h('p', { class: 'cell__want', title: 'Manque à : ' + colsText(want, ', ') }, ['→ ', colsText(want, ' · ')]) : null,
    ]);
  }
  // Case vide de l'album d'un ami : « tu l'as » (et « ×2 en double ») si ta carte la remplit, c'est-à-dire une carte que tu
  // pourrais lui donner. Toute la case ouvre la fiche en lecture seule ; « Copier le nom » en haut à droite.
  function viewFriendSlot(s, fa) {
    const it = s.item;
    const f = fa.f;
    const mine = s.mine;
    const n = mine ? Math.max(1, Number(mine.count) || 1) : 0;
    const img = (mine && mine.image) || s.thumb;
    let views = '';
    if (!mine) views = s.views != null ? `${fmt(s.views)} vues / 30 j` : S.pv.running ? 'vues…' : 'vues inconnues';
    const give = mine ? (n > 1 ? `, tu l'as (${fmt(n)} exemplaires)` : ", tu l'as") : '';
    return h('div', { class: ['slot', { can: !!mine, pulled: !!S.openMissing && !!S.openMissing.friend && S.openMissing.title === it.title }], key: s.key }, [
      img ? h('img', { class: 'slot__bg', src: img, alt: '', loading: 'lazy', decoding: 'async', onError: hideBroken }) : null,
      fa.ordered ? h('span', { class: 'slot__no', 'aria-hidden': 'true' }, String(s.i)) : null,
      h('button', { class: 'slot__open', type: 'button', title: `Manque à ${friendName(f)} : ouvrir la fiche`,
        'aria-label': `${it.title} : manque à ${friendName(f)}${give}, ouvrir la fiche`, onClick: (e) => openFriendItem(f, s, e) }),
      h('div', { class: 'slot__top' }, [s.real ? pill(s.real) : pill(s.est, true), copyNameButton(it.title, true)]),
      h('h3', null, it.title),
      mine && mine.category ? h('p', null, mine.category) : null,
      mine ? h('div', { class: 'slot__give' }, [h('span', { class: 'slot__friends' }, "tu l'as"),
        n > 1 ? h('span', { class: 'slot__friends dup', title: `Tu en as ${fmt(n)} exemplaires` }, `×${fmt(n)} en double`) : null]) : null,
      views ? h('span', { class: 'views' }, views) : null,
    ]);
  }
  // Album d'une collection d'un ami (lecture seule), avec l'allure des tiens : ses cartes et ses cases vides ; filtres
  // « Toutes / Il les a / Lui manquent / Tu peux l'aider », tri ; rien n'y modifie sa collection.
  function viewFriendAlbum(f) {
    const fr = S.friends;
    const fa = friendAlbum.value;
    const name = friendName(f);
    const backs = [
      h('button', { class: 'back', type: 'button', onClick: closeFriendAlbum }, `← Retour au classeur de ${name}`),
      fr.albumFrom === 'trades' ? h('button', { class: 'back', type: 'button', onClick: backToTrades }, '← Échanges possibles') : null,
    ];
    const backLine = h('div', { class: 'back-line' }, backs);
    if (!fa) {
      return h('div', { class: 'album-head' }, [backLine, h('p', { class: 'muted', role: 'status' },
        !f.tshare ? `${name} ne partage plus ses collections.` : !f.targets ? 'Lecture de ses collections…' : "Cette collection n'existe plus.")]);
    }
    const t = fa.t;
    const all = friendSlotsAll.value;
    let own = 0;
    let help = 0;
    let helpDup = 0;
    let want = 0;
    let estimated = 0;
    let unknown = 0;
    const byR = {};
    const missG = {}; // rareté connue (ta carte)
    const missR = {}; // rareté estimée d'après les vues
    for (const s of all) {
      if (s.card) { own++; byR[s.card.rarity] = (byR[s.card.rarity] || 0) + 1; if (!s.mine && s.want) want++; continue; }
      if (s.mine) { help++; if ((Number(s.mine.count) || 1) >= 2) helpDup++; }
      if (s.real) { missG[s.real] = (missG[s.real] || 0) + 1; continue; }
      estimated++;
      if (s.est) missR[s.est] = (missR[s.est] || 0) + 1; else unknown++;
    }
    const total = all.length;
    const missing = total - own;
    const pills = (m, est) => RAR_UP.slice().reverse().filter((r) => m[r]).map((r) => h('span', { key: (est ? 'e' : 'g') + r }, [pill(r, est), ' ', h('b', { class: 'num' }, fmt(m[r]))]));
    const ownLine = own > 0 ? [h('span', null, `${name} en a ${fmt(own)} :`), ...pills(byR, false)] : null;
    const missLine = missing > 0 ? [h('span', null, `Il lui en manque ${fmt(missing)} :`), ...pills(missG, false), ...pills(missR, true),
      unknown ? h('span', { key: '?' }, [pill(null), ' ', h('b', { class: 'num' }, fmt(unknown))]) : null]
      : [h('span', null, total ? 'Sa collection est complète.' : 'Cette collection est vide.')];
    let hint = '≈ : rareté estimée d\'après les vues de l\'article sur Wikipédia ces 30 derniers jours.';
    if (!estimated && Object.keys(missG).length) hint = 'Rareté des cases vides : celle de ta carte.';
    else if (S.pv.running) hint = `Rareté estimée des cases vides : ${fmt(S.pv.done)} sur ${fmt(S.pv.total)} articles…`;
    else if (S.pv.error) hint = `Rareté estimée incomplète : ${S.pv.error}`;
    else if (Object.keys(missG).length) hint += ' Sans « ≈ » : rareté de ta carte.';
    // « Créer la même collection chez moi » (une liste d'articles à toi, copiée de la sienne) ; une fois créée, ton album.
    const copy = copyOf(f, t);
    const actions = copy
      ? [h('button', { class: 'btn', type: 'button', key: 'ouvrir', onClick: () => openAlbum('target', copy.id) }, 'Ouvrir ma collection')]
      : t.items.length ? [h('button', { class: 'btn', type: 'button', key: 'copier', disabled: fr.copyBusy, onClick: () => copyFriendCollection(f, t) },
        [icon('plus', 'sm'), fr.copyBusy ? 'Un instant…' : 'Créer la même collection chez moi'])] : [];
    const list = friendSlots.value;
    const shown = list.slice(0, fr.albumLimit);
    const setFilter = (v) => () => { fr.albumFilter = v; fr.albumLimit = ALBUM_PAGE; };
    const empty = fr.albumFilter === 'help' ? `Tu n'as aucune des cartes qui manquent à ${name} ici.`
      : fr.albumFilter === 'has' ? `${name} n'a encore aucune carte de cette collection.` : fr.albumFilter === 'lacks' ? 'Il ne lui en manque aucune.' : 'Cette collection est vide.';
    return h('div', null, [
      h('div', { class: 'album-head' }, [
        backLine,
        h('div', { class: 'album-title' }, [h('h2', null, t.name), h('span', { class: 'num' }, `${name} en a ${fmt(own)} sur ${fmt(total)}`),
          h('span', { class: 'badge' }, 'lecture seule'), t.cat ? h('span', { class: 'row-kind' }, 'depuis la catégorie Wikipédia') : null]),
        rarityBar(byR, total, 'bar big'),
        ownLine ? h('div', { class: 'missing-sum' }, ownLine) : null,
        h('div', { class: 'missing-sum' }, missLine),
        help || want ? h('div', { class: 'missing-sum give-sum' }, [
          help ? h('span', { key: 'help' }, ['Tu peux l\'aider : ', h('b', { class: 'num' }, fmt(help)), ` ${plural(help, 'carte', 'cartes')}`, helpDup ? [' dont ', h('b', { class: 'num' }, fmt(helpDup)), ' en double'] : null]) : null,
          want ? h('span', { key: 'want' }, [help ? '· ' : '', h('b', { class: 'num' }, fmt(want)), ` de ses cartes ${plural(want, 'manque', 'manquent')} à tes collections`]) : null,
        ]) : null,
        missing > 0 ? h('p', { class: 'hint', 'aria-live': 'polite' }, hint) : null,
        h('p', { class: 'hint' }, TRADE_NOTE),
        h('div', { class: 'toolbar' }, [
          h('div', { class: 'seg seg--four', role: 'group', 'aria-label': 'Filtrer' }, [
            seg('Toutes', fr.albumFilter === 'all', setFilter('all')),
            seg('Il les a', fr.albumFilter === 'has', setFilter('has')),
            seg('Lui manquent', fr.albumFilter === 'lacks', setFilter('lacks')),
            seg('Tu peux l\'aider', fr.albumFilter === 'help', setFilter('help')),
          ]),
          h('div', { class: 'seg', role: 'group', 'aria-label': 'Trier' }, [
            seg(fa.ordered ? 'Ordre' : 'A → Z', fr.albumSort === 'order', () => { fr.albumSort = 'order'; fr.albumLimit = ALBUM_PAGE; }),
            seg('Rareté', fr.albumSort === 'rarity', () => { fr.albumSort = 'rarity'; fr.albumLimit = ALBUM_PAGE; }),
          ]),
          h('span', { class: 'spacer' }),
          ...actions,
        ]),
      ]),
      list.length ? h('div', { class: 'cardgrid' }, shown.map((s) => (s.card ? viewFriendAlbumCard(s, f) : viewFriendSlot(s, fa))))
        : h('div', { class: 'empty-box' }, empty),
      shown.length < list.length ? h('div', { class: 'show-more' }, [h('button', { class: 'btn', type: 'button', onClick: () => { fr.albumLimit += ALBUM_PAGE; } },
        `Afficher les ${fmt(Math.min(ALBUM_PAGE, list.length - shown.length))} suivantes (${fmt(list.length - shown.length)} restantes)`)]) : null,
    ]);
  }
  function viewFriendBinder(f) {
    const fr = S.friends;
    const st = friendStats.value.get(f.id);
    const list = friendCardsView.value;
    const shown = list.slice(0, fr.limit);
    return h('div', null, [
      h('div', { class: 'album-head' }, [
        h('button', { class: 'back', type: 'button', onClick: closeFriendBinder }, '← Entre amis'),
        h('div', { class: 'album-title' }, [h('h2', null, `Le classeur de ${friendName(f)}`), h('span', { class: 'num' }, `${cards$(f.count)} · ${syncedOn(f)}`),
          h('span', { class: 'badge' }, 'lecture seule')]),
        st ? h('div', { class: 'missing-sum' }, [h('span', null, [h('b', null, fmt(st.missing)), ` ${plural(st.missing, 'carte', 'cartes')} que tu n'as pas`]),
          st.dup ? h('span', null, ['· dont ', h('b', null, fmt(st.dup)), ` en double chez ${friendName(f)}`]) : null]) : null,
        h('p', { class: 'hint' }, TRADE_NOTE),
      ]),
      // « Ses collections » (s'il les partage), puis ses cartes.
      h('div', { class: 'groups' }, [
        viewFriendCols(f),
        h('section', { class: 'group', 'aria-labelledby': 'h-fcards' }, [
          h('div', { class: 'section-head' }, [h('h2', { id: 'h-fcards' }, 'Ses cartes')]),
          h('div', { class: 'toolbar friend-tools' }, [
            h('label', { class: 'sr', for: 'fq' }, 'Chercher dans ce classeur'),
            h('input', { id: 'fq', class: 'field', type: 'search', value: fr.q, autocomplete: 'off', placeholder: 'Chercher un titre', onInput: (e) => { fr.q = e.target.value; fr.limit = PAGE; } }),
            h('div', { class: 'seg', role: 'group', 'aria-label': 'Filtrer' }, [
              seg('Toutes', fr.filter === 'all', () => { fr.filter = 'all'; fr.limit = PAGE; }),
              seg('Me manquent', fr.filter === 'missing', () => { fr.filter = 'missing'; fr.limit = PAGE; }),
            ]),
            h('label', { class: 'sr', for: 'fsort' }, 'Trier'),
            h('select', { id: 'fsort', class: 'field', value: fr.sort, onChange: (e) => { fr.sort = e.target.value; } },
              [['rarity', 'Rareté'], ['count', 'Exemplaires'], ['title', 'Titre']].map(([v, l]) => h('option', { key: v, value: v }, l))),
          ]),
          !f.cards ? h('p', { class: 'muted', role: 'status' }, 'Lecture de ses cartes…')
            : list.length ? h('div', { class: 'cardgrid' }, shown.map(viewFriendCard))
              : h('div', { class: 'empty-box' }, fr.filter === 'missing' && !fr.q.trim() ? `Tu as déjà toutes les cartes de ${friendName(f)}.` : 'Aucune carte ne correspond.'),
          shown.length < list.length ? h('div', { class: 'show-more' }, [h('button', { class: 'btn', type: 'button', onClick: () => { fr.limit += PAGE; } },
            `Afficher plus (${fmt(list.length - shown.length)} restantes)`)]) : null,
        ]),
      ]),
    ]);
  }
  function viewFriends() {
    if (!sharing()) return viewShareOff();
    const fr = S.friends;
    const open = openFriend.value;
    if (fr.open && open) return fr.album != null ? viewFriendAlbum(open) : viewFriendBinder(open);
    if (fr.page === 'trades') return viewTrades();
    const list = friendList.value;
    const loadingAll = fr.busy || list.some((f) => !f.cards || (f.tshare && !f.targets));
    const fill = friendHighlights.value;
    const wants = friendWants.value;
    // Résumé des échanges qui te concernent (la page « Échanges possibles » les détaille, pour tout le monde aussi).
    const pairs = trades.value.pairs;
    const give = pairs.filter((p) => p.x.me).reduce((a, p) => a + p.rows.length, 0);
    const get = pairs.filter((p) => p.z.me).reduce((a, p) => a + p.rows.length, 0);
    const others = pairs.filter((p) => !p.x.me && !p.z.me).reduce((a, p) => a + p.rows.length, 0);
    return h('div', { class: 'groups' }, [
      h('section', { class: 'group', 'aria-labelledby': 'h-friends' }, [
        h('div', { class: 'section-head' }, [
          h('h2', { id: 'h-friends' }, 'Entre amis'),
          h('small', null, 'les membres du classeur qui montrent leurs cartes'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn small', type: 'button', disabled: fr.busy, onClick: () => loadFriends(true) }, [icon('refresh', fr.busy ? 'sm spin' : 'sm'), 'Actualiser']),
        ]),
        fr.loading ? h('p', { class: 'small muted', role: 'status' }, fr.loading) : null,
        errLine(fr.error),
        list.length ? h('div', { class: 'rows' }, list.map(viewMemberRow))
          : fr.status === 'loading' || fr.busy ? h('p', { class: 'muted', role: 'status' }, 'Lecture des membres…')
            : fr.status === 'ready' ? h('p', { class: 'empty-box' }, "Personne d'autre ne montre encore ses cartes : propose à tes amis d'activer « Montrer mes cartes aux autres membres » dans leurs Réglages.") : null,
        h('p', { class: 'small muted friends-trade' }, TRADE_NOTE),
      ]),
      list.length ? h('section', { class: 'group trades-intro', 'aria-labelledby': 'h-trades' }, [
        h('div', { class: 'section-head' }, [h('h2', { id: 'h-trades' }, 'Échanges possibles'),
          h('small', null, "telle carte de l'un pourrait compléter telle collection de l'autre")]),
        h('div', { class: 'trade-sum' }, [
          h('p', null, pairs.length || !loadingAll ? [
            h('b', null, fmt(give)), ` de tes cartes ${plural(give, 'peut', 'peuvent')} compléter les collections de tes amis ; `,
            h('b', null, fmt(get)), ` de leurs cartes ${plural(get, 'peut', 'peuvent')} compléter les tiennes`,
            others ? ['. Entre eux : ', h('b', null, fmt(others)), '.'] : '.',
          ] : 'Recherche dans les classeurs…'),
          h('button', { class: 'btn primary', type: 'button', onClick: () => openTrades('all') }, 'Voir les échanges possibles'),
        ]),
        ...tradeNotes(),
      ]) : null,
      list.length ? h('section', { class: 'group', 'aria-labelledby': 'h-fill' }, [
        h('div', { class: 'section-head' }, [h('h2', { id: 'h-fill' }, 'Pour compléter tes collections'),
          h('small', null, 'les cartes qui manquent à tes collections, et que tes amis ont ; en double chez eux : les plus faciles à échanger')]),
        fill.length ? h('div', { class: 'fcols' }, fill.map(viewFillCol))
          : h('p', { class: 'empty-box' }, loadingAll ? 'Recherche dans les classeurs de tes amis…' : "Tes amis n'ont aucune des cartes qui manquent à tes collections."),
      ]) : null,
      list.length ? h('section', { class: 'group', 'aria-labelledby': 'h-wants' }, [
        h('div', { class: 'section-head' }, [h('h2', { id: 'h-wants' }, 'Ce qui pourrait intéresser tes amis'),
          h('small', null, "tes cartes qui manquent aux collections et catégories qu'ils partagent")]),
        wants.length ? h('div', { class: 'fcols' }, wants.map(viewWant))
          : h('p', { class: 'empty-box' }, loadingAll ? 'Recherche…' : !list.some((f) => f.tshare) ? 'Aucun de tes amis ne partage ses collections : impossible de savoir ce qui leur manque.'
            : 'Aucune de tes cartes ne manque aux collections de tes amis.'),
        wants.length && trades.value.hidden.length ? h('p', { class: 'small muted' }, `Rien pour ${andList(trades.value.hidden.map(friendName))}, qui ne ${trades.value.hidden.length > 1 ? 'partagent pas leurs' : 'partage pas ses'} collections.`) : null,
      ]) : null,
    ]);
  }

  // ================================================================ chat : un salon pour tous les classeurs
  // Contrat : SPEC.md, « Chat ». Messages gardés en mémoire le temps de la visite (chatMsgs : figés, triés par numéro) ;
  // chatRev = révision du serveur jusqu'où tout a été lu (null : rien lu), chatLastId = dernier numéro du serveur à cette
  // lecture. Onglet ouvert et page visible : relecture ?after=<rev> toutes les 12 s (30 s après 5 min sans nouveau
  // message ni geste dans le chat). Ailleurs : GET /api/me (relu toutes les 60 s, page visible) donne last_chat_id, et
  // les nouveaux messages ne sont lus que s'il change : badge des non-lus sur l'onglet. Dernier message lu : localStorage
  // (classeur-chat-lu = {<id du compte>: numéro}, accès protégés ; refusé : en mémoire seulement). Jamais de HTML : le
  // texte passe tel quel à Vue (échappé), seuls les liens http(s) deviennent des <a> (rel=noopener).
  const CHAT_MAX = 500;
  const CHAT_EVERY = 12 * 1000;
  const CHAT_IDLE_EVERY = 30 * 1000;
  const CHAT_IDLE_AFTER = 5 * 60 * 1000;
  const CHAT_KEY_LINK = /#cle=[A-Za-z0-9_-]{20,}/;
  const CHAT_URL = /\bhttps?:\/\/[^\s<>"«»]+/gi;
  const chatMsgs = shallowRef([]);
  let chatRev = null;
  let chatLastId = 0;
  let chatGen = 0; // change avec le classeur (resetChat) : une réponse arrivée après coup est écartée
  let chatJob = null;
  let chatAgain = false;
  let chatTimer = null;
  let chatActive = 0; // dernier geste dans le chat ou dernier nouveau message (relecture ralentie au-delà de 5 min)
  let chatAtBottom = true; // fil défilé jusqu'en bas (mesuré au défilement, avant l'arrivée des nouveaux messages)

  const chatSeen = () => S.boot === 'app' && S.tab === 'chat' && document.visibilityState === 'visible';
  const chatBox = () => document.getElementById('chat-scroll');
  const byChatId = (a, b) => a.id - b.id;
  function chatReadOf(user) {
    const v = store.json(LS.chatRead);
    const n = v && typeof v === 'object' && !Array.isArray(v) ? Number(v[user]) : 0;
    return Number.isInteger(n) && n > 0 ? n : 0;
  }
  function setChatRead(n) {
    const user = S.chat.user;
    if (!user || !Number.isInteger(n) || n < 0 || n === S.chat.read) return;
    S.chat.read = n;
    const v = store.json(LS.chatRead);
    const map = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    map[user] = n;
    store.set(LS.chatRead, JSON.stringify(map));
  }
  // Non lus : messages des autres au-delà du dernier lu, parmi ceux que la page a lus (les 100 plus récents, plus ceux
  // chargés en remontant).
  const chatUnread = computed(() => {
    const read = S.chat.read;
    let n = 0;
    for (const m of chatMsgs.value) if (m.id > read && !m.mine) n++;
    return n;
  });
  function markChatRead() {
    const list = chatMsgs.value;
    setChatRead(Math.max(S.chat.read, chatLastId, list.length ? list[list.length - 1].id : 0));
  }
  // Texte d'un message en morceaux : texte brut et liens http(s) (ponctuation finale laissée hors du lien, sauf une
  // parenthèse fermante qui en ferme une du lien : « …/Mercure_(planète) »).
  function linkify(text) {
    const out = [];
    let last = 0;
    for (const m of text.matchAll(CHAT_URL)) {
      let url = m[0];
      while (/[.,;:!?'’)\]}]$/.test(url)) {
        if (url.endsWith(')') && (url.match(/\(/g) || []).length >= (url.match(/\)/g) || []).length) break;
        url = url.slice(0, -1);
      }
      let href = null;
      try { const u = new URL(url); if ((u.protocol === 'https:' || u.protocol === 'http:') && u.hostname) href = u.href; } catch (e) { href = null; }
      if (!href) continue;
      if (m.index > last) out.push({ text: text.slice(last, m.index) });
      out.push({ text: url, url: href });
      last = m.index + url.length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }
  function prepChatMsg(m) {
    const id = Number(m && m.id);
    if (!Number.isInteger(id) || id <= 0) return null;
    const text = String(m.text || '');
    return markRaw({ id, mine: m.mine === true, author: typeof m.author === 'string' && m.author ? m.author : null, text, at: String(m.created_at || ''), parts: linkify(text) });
  }
  // Heure du message : « 14:32 » aujourd'hui, « hier, 14:32 », sinon « 15 oct., 14:32 » (l'année si ce n'est pas celle-ci).
  function chatWhen(iso) {
    const d = dateOf(iso);
    if (!d) return '';
    const now = new Date();
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const day0 = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((day0(now) - day0(d)) / DAY);
    if (days === 0) return time;
    if (days === 1) return 'hier, ' + time;
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }) + ', ' + time;
  }

  // Réponse de GET /api/me : dernier numéro du chat (ancien serveur, sans last_chat_id : rien).
  function chatNote(me) {
    const last = me && Number.isInteger(me.last_chat_id) ? me.last_chat_id : null;
    const user = me && me.user && me.user.id;
    if (last === null || !user) return;
    if (S.chat.user !== user) { S.chat.user = user; S.chat.read = chatReadOf(user); }
    if (last < S.chat.read) setChatRead(last); // base recréée : les numéros sont repartis de zéro
    if (last !== chatLastId && (chatRev !== null || last > S.chat.read)) refreshChat();
  }
  // Une lecture à la fois ; demandée pendant une autre, elle repart juste après.
  function refreshChat() {
    if (chatJob) { chatAgain = true; return chatJob; }
    const gen = chatGen;
    const job = (async () => {
      try {
        do {
          chatAgain = false;
          if (chatRev === null) await loadChat(gen); else await pollChat(gen);
        } while (chatAgain && gen === chatGen);
      } catch (e) {
        if (gen === chatGen) {
          S.chat.error = e.message;
          if (S.chat.status !== 'ready') S.chat.status = 'error';
        }
      } finally {
        if (chatJob === job) chatJob = null;
      }
    })();
    chatJob = job;
    return job;
  }
  async function loadChat(gen) {
    if (S.chat.status !== 'ready') S.chat.status = 'loading';
    const r = await api('GET', '/api/chat');
    if (gen !== chatGen) return;
    chatMsgs.value = (Array.isArray(r.messages) ? r.messages : []).map(prepChatMsg).filter(Boolean).sort(byChatId);
    chatRev = Number.isInteger(r.rev) ? r.rev : 0;
    chatLastId = Number.isInteger(r.last_id) ? r.last_id : 0;
    Object.assign(S.chat, { older: !!r.older, status: 'ready', error: '' });
    afterChat(true, false);
  }
  async function pollChat(gen) {
    const r = await api('GET', '/api/chat?after=' + encodeURIComponent(String(chatRev)));
    if (gen !== chatGen) return;
    // Révision inconnue (base recréée) ou plus de 100 changements : on relit les plus récents.
    if (r.reset || r.more || !Number.isInteger(r.rev)) { chatRev = null; await loadChat(gen); return; }
    const map = new Map(chatMsgs.value.map((m) => [m.id, m]));
    let added = 0;
    let changed = false;
    for (const id of Array.isArray(r.deleted) ? r.deleted : []) if (map.delete(Number(id))) changed = true;
    for (const raw of Array.isArray(r.messages) ? r.messages : []) {
      const m = prepChatMsg(raw);
      if (!m) continue;
      if (!map.has(m.id)) added++;
      map.set(m.id, m);
      changed = true;
    }
    if (changed) chatMsgs.value = [...map.values()].sort(byChatId);
    chatRev = r.rev;
    if (Number.isInteger(r.last_id)) chatLastId = r.last_id;
    Object.assign(S.chat, { status: 'ready', error: '' });
    if (added) chatActive = Date.now();
    afterChat(false, added > 0);
  }
  // Après une lecture : lu si le chat est sous les yeux (ou si rien de nouveau ne vient des autres), puis défilement :
  // en bas à l'ouverture ou si on y était déjà, sinon « Nouveaux messages » pour y descendre.
  function afterChat(jump, added) {
    if (chatSeen() || !chatUnread.value) markChatRead();
    if (S.tab !== 'chat') return;
    if (jump || chatAtBottom) nextTick(chatToBottom);
    else if (added) S.chat.newBelow = true;
  }
  function chatToBottom() {
    S.chat.newBelow = false;
    chatAtBottom = true;
    const b = chatBox();
    if (b && typeof b.scrollHeight === 'number') b.scrollTop = b.scrollHeight;
  }
  function onChatScroll(e) {
    const b = e.target;
    if (!b || typeof b.scrollHeight !== 'number') return;
    chatAtBottom = b.scrollHeight - b.scrollTop - b.clientHeight < 48;
    if (chatAtBottom) S.chat.newBelow = false;
    chatTouch();
  }
  // Messages d'avant le plus ancien affiché (100 de plus) ; la position de lecture ne bouge pas.
  async function loadOlderChat() {
    const c = S.chat;
    if (c.olderBusy || !chatMsgs.value.length) return;
    const gen = chatGen;
    const b0 = chatBox();
    const h0 = b0 && typeof b0.scrollHeight === 'number' ? b0.scrollHeight : 0;
    const t0 = b0 && typeof b0.scrollTop === 'number' ? b0.scrollTop : 0;
    c.olderBusy = true;
    chatTouch();
    try {
      const r = await api('GET', '/api/chat?before=' + chatMsgs.value[0].id);
      if (gen !== chatGen) return;
      const map = new Map(chatMsgs.value.map((m) => [m.id, m]));
      for (const raw of Array.isArray(r.messages) ? r.messages : []) { const m = prepChatMsg(raw); if (m && !map.has(m.id)) map.set(m.id, m); }
      chatMsgs.value = [...map.values()].sort(byChatId);
      c.older = !!r.older;
      nextTick(() => { const b = chatBox(); if (b && typeof b.scrollHeight === 'number') b.scrollTop = t0 + (b.scrollHeight - h0); });
    } catch (e) {
      if (gen === chatGen) notify(e.message, true);
    } finally {
      if (gen === chatGen) c.olderBusy = false;
    }
  }
  // Minuterie de relecture : seulement l'onglet ouvert et la page visible.
  function setChatLive() {
    if (!chatSeen()) { if (chatTimer) { clearTimeout(chatTimer); chatTimer = null; } return; }
    if (chatTimer) return;
    const wait = Date.now() - chatActive > CHAT_IDLE_AFTER ? CHAT_IDLE_EVERY : CHAT_EVERY;
    chatTimer = setTimeout(async () => {
      chatTimer = null;
      if (!chatSeen()) return;
      await refreshChat();
      setChatLive();
    }, wait);
  }
  function chatTouch() {
    const idle = Date.now() - chatActive > CHAT_IDLE_AFTER;
    chatActive = Date.now();
    if (idle && chatTimer) { clearTimeout(chatTimer); chatTimer = null; setChatLive(); }
  }
  function openChat() {
    chatActive = Date.now();
    chatAtBottom = true;
    Object.assign(S.chat, { newBelow: false, sendError: '' });
    if (chatRev !== null) markChatRead(); // ce qui est déjà là est sous les yeux
    refreshChat();
    setChatLive();
    nextTick(() => { chatToBottom(); chatIntoView(); });
  }
  // Onglet ouvert : le bas du chat (derniers messages et champ de saisie) visible sans avoir à faire défiler la page.
  function chatIntoView() {
    const el = document.querySelector('.chat');
    if (!el || typeof el.getBoundingClientRect !== 'function' || typeof window.innerHeight !== 'number') return;
    if (el.getBoundingClientRect().bottom > window.innerHeight) el.scrollIntoView({ block: 'end' });
  }
  function chatVisibility() {
    if (chatSeen()) { chatActive = Date.now(); refreshChat(); }
    setChatLive();
  }
  watch(() => S.boot === 'app' && S.tab === 'chat', (on) => { if (on) openChat(); else setChatLive(); });
  function resetChat() {
    chatGen++;
    chatJob = null;
    chatAgain = false;
    if (chatTimer) { clearTimeout(chatTimer); chatTimer = null; }
    chatMsgs.value = [];
    chatRev = null;
    chatLastId = 0;
    chatAtBottom = true;
    Object.assign(S.chat, { user: null, status: 'idle', error: '', draft: '', sending: false, sendError: '', older: false, olderBusy: false, read: 0, newBelow: false });
  }
  async function sendChat(fromKey) {
    const c = S.chat;
    const text = c.draft.replace(/\r\n?/g, '\n').trim();
    if (!text || c.sending) return;
    if (text.length > CHAT_MAX) { c.sendError = `Message trop long : ${CHAT_MAX} caractères au plus.`; return; }
    if (CHAT_KEY_LINK.test(text)) {
      c.sendError = "Ce message contient un lien personnel de classeur (#cle=…) : il ouvrirait ton classeur à tous ceux qui le liraient. Retire-le avant d'envoyer.";
      return;
    }
    const gen = chatGen;
    c.sending = true;
    c.sendError = '';
    chatTouch();
    try {
      const r = await api('POST', '/api/chat', { text });
      if (gen !== chatGen) return;
      if (c.draft.replace(/\r\n?/g, '\n').trim() === text) c.draft = ''; // tapé de nouveau pendant l'envoi : gardé
      const m = prepChatMsg(r.message);
      if (m && !chatMsgs.value.some((x) => x.id === m.id)) chatMsgs.value = [...chatMsgs.value, m].sort(byChatId);
      afterChat(true, false);
      refreshChat(); // et les messages des autres arrivés entre-temps
    } catch (e) {
      if (gen === chatGen) c.sendError = e.message;
    } finally {
      if (gen === chatGen) c.sending = false;
      if (fromKey) nextTick(() => { const t = document.getElementById('chat-input'); if (t) t.focus(); });
    }
  }
  // Entrée envoie, Maj+Entrée va à la ligne (le navigateur s'en charge) ; pas pendant une saisie en cours (IME).
  function onChatKey(e) {
    chatTouch();
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    sendChat(true);
  }
  function askDeleteChat(m) {
    const short = m.text.replace(/\s+/g, ' ');
    openConfirm({
      title: 'Supprimer ce message ?',
      text: `« ${short.length > 80 ? short.slice(0, 80).trimEnd() + '…' : short} » disparaîtra du chat pour tout le monde. C'est définitif.`,
      ok: 'Supprimer',
      danger: true,
      run: async () => {
        const gen = chatGen;
        try { await api('DELETE', '/api/chat/' + m.id); } catch (e) { if (e.status !== 404) throw e; } // 404 : déjà parti
        if (gen !== chatGen) return;
        chatMsgs.value = chatMsgs.value.filter((x) => x.id !== m.id);
        refreshChat();
      },
    });
  }

  // ---------------------------------------------------------------- rendu du chat
  function chatTabLabel(label) {
    const n = S.tab === 'chat' ? 0 : chatUnread.value;
    if (!n) return label;
    return [label, h('span', { class: 'tab-badge' }, [n > 99 ? '99+' : String(n), sr(' ' + plural(n, 'message non lu', 'messages non lus'))])];
  }
  function viewChatMsg(m) {
    // Les miens : mon prénom actuel (renommé dans Réglages, il change aussitôt) ; ceux des autres : à la lecture.
    const who = (m.mine && S.me && S.me.user && S.me.user.name) || m.author || 'Sans prénom';
    return h('div', { key: m.id, class: ['chat-msg', { mine: m.mine }] }, [
      h('div', { class: 'chat-msg__head' }, [
        h('span', { class: 'chat-msg__who' }, who),
        m.mine ? h('span', { class: 'chat-msg__me' }, '(toi)') : null,
        h('time', { class: 'chat-msg__time', datetime: m.at, title: dateLong(m.at) }, chatWhen(m.at)),
        m.mine ? h('button', { class: 'chat-msg__del', type: 'button', title: 'Supprimer ce message', 'aria-label': 'Supprimer ce message', onClick: () => askDeleteChat(m) },
          [icon('trash', 'sm'), h('span', { class: 'chat-msg__del-label', 'aria-hidden': 'true' }, 'Supprimer')]) : null,
      ]),
      h('p', { class: 'chat-msg__text' }, m.parts.map((p) => (p.url ? h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer nofollow ugc' }, p.text) : p.text))),
    ]);
  }
  function viewChatForm() {
    const c = S.chat;
    const n = c.draft.length;
    return h('form', { class: 'chat-form', onSubmit: (e) => { e.preventDefault(); sendChat(false); } }, [
      h('label', { class: 'sr', for: 'chat-input' }, 'Ton message'),
      h('textarea', { id: 'chat-input', class: 'chat-input', rows: 2, maxlength: CHAT_MAX, value: c.draft, placeholder: 'Écris un message…', 'aria-describedby': 'chat-hint',
        onInput: (e) => { c.draft = e.target.value; if (c.sendError) c.sendError = ''; chatTouch(); }, onKeydown: onChatKey }),
      h('div', { class: 'chat-form__foot' }, [
        h('span', { id: 'chat-hint', class: 'chat-hint' }, [h('kbd', null, 'Entrée'), ' envoie, ', h('kbd', null, 'Maj'), ' + ', h('kbd', null, 'Entrée'), ' va à la ligne']),
        n >= CHAT_MAX - 100 ? h('span', { class: ['chat-count', { full: n >= CHAT_MAX }] }, `${fmt(n)} / ${fmt(CHAT_MAX)}`) : null,
        h('button', { class: 'btn primary', type: 'submit', disabled: c.sending || !c.draft.trim() }, c.sending ? 'Envoi…' : 'Envoyer'),
      ]),
      errLine(c.sendError),
    ]);
  }
  function viewChat() {
    const c = S.chat;
    const list = chatMsgs.value;
    const named = !!(S.me && S.me.user && S.me.user.name);
    const empty = c.status === 'error' ? "Le chat n'a pas pu être lu." : c.status === 'ready' ? "Aucun message pour l'instant : écris le premier !" : 'Chargement des messages…';
    return h('div', { class: 'chat' }, [
      h('div', { class: 'section-head' }, [h('h2', { id: 'h-chat' }, 'Chat'), h('small', null, 'Visible par tous les membres du classeur')]),
      h('p', { class: 'chat-note' }, "Un seul salon pour tous les classeurs du site. Texte seulement, 500 caractères au plus ; les liens deviennent cliquables, et tu peux supprimer tes messages. N'y colle jamais ton lien personnel."),
      h('div', { class: 'chat-box' }, [
        h('div', { id: 'chat-scroll', class: 'chat-scroll', role: 'log', 'aria-label': 'Messages du chat', tabindex: '0', onScroll: onChatScroll }, [
          c.older ? h('div', { class: 'chat-older' }, [h('button', { class: 'btn small', type: 'button', disabled: c.olderBusy, onClick: loadOlderChat },
            c.olderBusy ? 'Chargement…' : 'Charger les messages plus anciens')]) : null,
          h('div', { class: 'chat-list' }, list.length ? list.map(viewChatMsg) : [h('p', { class: 'chat-empty' }, empty)]),
        ]),
        c.newBelow ? h('button', { class: 'chat-below', type: 'button', onClick: chatToBottom }, 'Nouveaux messages ↓') : null,
      ]),
      c.error ? h('div', { class: 'chat-error' }, [h('p', { class: 'status err', role: 'alert' }, c.error),
        h('button', { class: 'btn small', type: 'button', onClick: () => { c.error = ''; refreshChat(); } }, 'Réessayer')]) : null,
      named ? viewChatForm() : h('div', { class: 'notice' }, [
        h('p', null, "Pour écrire, donne d'abord un prénom à ton classeur : c'est lui que les autres membres verront."),
        h('div', { class: 'actions' }, [h('button', { class: 'btn small', type: 'button', onClick: openSettings }, 'Choisir mon prénom')]),
      ]),
    ]);
  }

  // ================================================================ rendu : onglet Marché, cotes des fiches
  const MARKET_RULES = "Les cotes et la lecture du marché viennent de ton favori, sur wiki-masters.com : « Mettre à jour les cotes » lit directement la base du jeu avec ta session, à ton clic seulement (une requête par seconde, 30 au plus par clic), sans passer par les pages du marché du jeu, qui limitent les outils automatiques. C'est plus risqué qu'une synchro de ta collection : à utiliser avec modération. Le classeur ne fait que montrer : enchères et ventes se font dans le jeu, par toi.";
  const MARKET_HOW = "Pas encore de cote : sur wiki-masters.com, clique « Mettre à jour les cotes » dans l'encart du favori (favori installé avant le 16 octobre 2026 : glisse à nouveau le favori dans ta barre, onglet « Mettre à jour »).";
  // Valeur jour par jour : une ligne (SVG dans la page), survol = le jour le plus proche, tableau des valeurs à part.
  function viewValueChart(hist) {
    const pts = hist.filter((p) => p && typeof p.date === 'string' && Number.isFinite(Number(p.value)) && Number.isFinite(Date.parse(p.date)));
    if (pts.length < 2) return h('p', { class: 'small muted' }, 'Le graphique de la valeur apparaît à partir de deux jours de cotes.');
    const W = 640;
    const H = 200;
    const L = 64;
    const R = 14;
    const T = 12;
    const B = 28;
    const vals = pts.map((p) => Number(p.value));
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (lo === hi) { lo = Math.max(0, lo - 1); hi += 1; }
    const pad = (hi - lo) * 0.1;
    lo = Math.max(0, lo - pad);
    hi += pad;
    const t0 = Date.parse(pts[0].date);
    const span = Math.max(1, Date.parse(pts[pts.length - 1].date) - t0);
    const x = (p) => L + ((Date.parse(p.date) - t0) / span) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const xy = pts.map((p) => [x(p), y(Number(p.value))]);
    const line = xy.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
    const area = `M${xy[0][0].toFixed(1)},${H - B} ` + xy.map(([a, b]) => `L${a.toFixed(1)},${b.toFixed(1)}`).join(' ') + ` L${xy[xy.length - 1][0].toFixed(1)},${H - B} Z`;
    const hov = M.hover >= 0 && M.hover < pts.length ? M.hover : -1;
    const onMove = (e) => {
      const el = e.currentTarget;
      if (!el || typeof el.getBoundingClientRect !== 'function') return;
      const box = el.getBoundingClientRect();
      if (!box.width) return;
      const px = ((e.clientX - box.left) / box.width) * W;
      let best = 0;
      xy.forEach(([a], i) => { if (Math.abs(a - px) < Math.abs(xy[best][0] - px)) best = i; });
      M.hover = best;
    };
    const first = pts[0];
    const last = pts[pts.length - 1];
    const sel = hov >= 0 ? pts[hov] : last;
    return h('figure', { class: 'chart' }, [
      h('figcaption', { class: 'chart__read', 'aria-live': 'polite' }, [h('b', null, wfmt(sel.value)), ` le ${dateDay(sel.date)} · ${fmt(sel.priced)} ${plural(sel.priced, 'carte cotée', 'cartes cotées')} sur ${fmt(sel.cards)}`]),
      h('svg', { class: 'chart__svg', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Valeur du classeur, un point par jour : ${wfmt(first.value)} le ${dateDay(first.date)}, ${wfmt(last.value)} le ${dateDay(last.date)}.`,
        onPointermove: onMove, onPointerleave: () => { M.hover = -1; } }, [
        ...[lo, (lo + hi) / 2, hi].flatMap((v, i) => [
          h('line', { key: 'g' + i, class: 'chart__grid', x1: L, x2: W - R, y1: y(v).toFixed(1), y2: y(v).toFixed(1) }),
          h('text', { key: 't' + i, class: 'chart__tick', x: L - 8, y: (y(v) + 4).toFixed(1), 'text-anchor': 'end' }, compact(Math.round(v))),
        ]),
        h('path', { class: 'chart__area', d: area }),
        h('polyline', { class: 'chart__line', points: line }),
        hov >= 0 ? h('line', { class: 'chart__cross', x1: xy[hov][0].toFixed(1), x2: xy[hov][0].toFixed(1), y1: T, y2: H - B }) : null,
        ...xy.map(([a, b], i) => h('circle', { key: 'p' + i, class: ['chart__dot', { on: i === hov }], cx: a.toFixed(1), cy: b.toFixed(1), r: i === hov ? 5 : 3 },
          [h('title', null, `${dateDay(pts[i].date)} : ${wfmt(pts[i].value)}`)])),
        h('text', { class: 'chart__tick', x: L, y: H - 8 }, dateDay(first.date)),
        h('text', { class: 'chart__tick', x: W - R, y: H - 8, 'text-anchor': 'end' }, dateDay(last.date)),
      ]),
      h('details', { class: 'chart__table' }, [
        h('summary', null, 'Voir les valeurs'),
        h('table', null, [
          h('thead', null, [h('tr', null, [h('th', null, 'Jour'), h('th', null, 'Valeur'), h('th', null, 'Cartes cotées')])]),
          h('tbody', null, pts.slice().reverse().map((p) => h('tr', { key: p.date }, [h('td', null, dateDay(p.date)), h('td', { class: 'num' }, wfmt(p.value)), h('td', { class: 'num' }, `${fmt(p.priced)} sur ${fmt(p.cards)}`)]))),
        ]),
      ]),
    ]);
  }
  // Une enchère (bonne affaire, mise, vente) : rareté de l'exemplaire, titre (ouvre sa fiche), brillance.
  function lotTitle(x, extra) {
    const mine = cardById.value.get(x.id) || null;
    const open = (e) => (mine ? openCardFrom(mine.id, e) : openMissingFrom({ title: x.t, description: null, image: x.img || null, status: 'ok', rarity: x.r }, e));
    return h('span', { class: 'lot__title' }, [pill(x.r), ' ', h('button', { class: 'linkish', type: 'button', onClick: open }, x.t), x.s ? h('span', { class: 'tag-mini' }, 'brillante') : null, extra || null]);
  }
  const vsCote = (amount, x) => (x.cote != null && amount != null ? h('span', { class: ['lot__cote', { approx: !(x.n >= 3) }] },
    ` · cote ${x.n >= 3 ? '' : '~ '}${wfmt(x.cote)} (${pctOf(amount, x.cote)})`) : h('span', { class: 'lot__cote' }, ' · pas de cote'));
  function viewDeals(live) {
    if (!live) return h('p', { class: 'muted' }, "Pas de lecture récente du marché (elle est gardée 24 h) : sur wiki-masters.com, clique « Mettre à jour les cotes » dans l'encart du favori.");
    const list = Array.isArray(live.deals) ? live.deals : [];
    if (!list.length) return h('p', { class: 'muted' }, 'Aucune bonne affaire à ta dernière lecture.');
    return h('ul', { class: 'lots' }, list.map((x) => {
      const soon = !x.bid && Date.parse(x.end) - Date.now() < 2 * 3600000;
      const cols = membershipsOfItem({ title: x.t });
      return h('li', { key: x.a, class: 'lot' }, [
        lotTitle(x, copyNameButton(x.t)),
        h('span', { class: 'lot__line' }, [h('b', null, wfmt(x.ask)), x.bid ? ' (enchère en cours)' : ' (prix de départ, sans enchère)', vsCote(x.ask, x)]),
        h('span', { class: 'lot__meta small' }, [soon ? h('span', { class: 'flag' }, 'finit bientôt') : null, x.lead ? h('span', { class: 'flag ok' }, 'tu mènes') : null, leftText(x.end),
          cols.length ? ` · pour ${cols.slice(0, 2).map((c) => `« ${c.name} »`).join(', ')}${cols.length > 2 ? '…' : ''}` : '']),
      ]);
    }));
  }
  const BID_STATE = { won: 'gagnée', lost: 'perdue', off: 'terminée' };
  const SALE_STATE = { sold: 'vendue', unsold: 'invendue', off: 'annulée ou terminée' };
  function viewMine(live) {
    if (!live) return h('p', { class: 'muted' }, 'Tes mises et tes ventes des 14 derniers jours apparaissent ici après « Mettre à jour les cotes ».');
    const bids = Array.isArray(live.bids) ? live.bids : [];
    const sales = Array.isArray(live.sales) ? live.sales : [];
    return h('div', { class: 'mine' }, [
      h('h3', null, 'Tes mises'),
      bids.length ? h('ul', { class: 'lots' }, bids.map((x) => h('li', { key: x.a, class: 'lot' }, [
        lotTitle(x),
        h('span', { class: 'lot__line' }, [`ta mise ${wfmt(x.mine)}`, x.cur != null ? ` · ${x.st === 'run' ? 'enchère actuelle' : 'prix final'} ${wfmt(x.cur)}` : '', vsCote(x.cur != null ? x.cur : x.mine, x)]),
        h('span', { class: 'lot__meta small' }, x.st === 'run' ? [h('span', { class: ['flag', { ok: x.lead }] }, x.lead ? 'tu mènes' : 'dépassée'), leftText(x.end)]
          : [h('span', { class: ['flag', { ok: x.st === 'won' }] }, BID_STATE[x.st] || x.st), ` le ${dateDay(x.end)}`]),
      ]))) : h('p', { class: 'small muted' }, 'Aucune mise ces 14 derniers jours.'),
      h('h3', null, 'Tes ventes'),
      sales.length ? h('ul', { class: 'lots' }, sales.map((x) => h('li', { key: x.a, class: 'lot' }, [
        lotTitle(x),
        h('span', { class: 'lot__line' }, [`départ ${wfmt(x.base)}`, x.cur != null ? ` · ${x.st === 'sold' ? 'vendue' : 'enchère'} ${wfmt(x.cur)}` : '', vsCote(x.cur != null ? x.cur : x.base, x)]),
        h('span', { class: 'lot__meta small' }, x.st === 'run' ? [h('span', { class: ['flag', { ok: x.bid }] }, x.bid ? 'enchère reçue' : 'sans enchère'), leftText(x.end)]
          : [h('span', { class: ['flag', { ok: x.st === 'sold' }] }, SALE_STATE[x.st] || x.st), ` le ${dateDay(x.end)}`]),
      ]))) : h('p', { class: 'small muted' }, 'Aucune vente ces 14 derniers jours.'),
    ]);
  }
  function viewMovers() {
    const mv = movers.value;
    if (!mv.up.length && !mv.down.length) return h('p', { class: 'muted' }, "Pas encore assez de ventes pour comparer à il y a 7 jours (3 ventes au moins, maintenant et avant).");
    const col = (title, list) => h('div', null, [h('h3', null, title), list.length ? h('ol', { class: 'movers' }, list.map((x) => h('li', { key: x.c.id }, [
      pill(x.c.rarity), ' ', h('button', { class: 'linkish', type: 'button', onClick: (e) => openCardFrom(x.c.id, e) }, x.c.title),
      h('b', { class: ['delta', x.delta > 0 ? 'up' : 'down'] }, `${x.delta > 0 ? '+' : '−'}${wfmt(Math.abs(x.delta))}`), h('span', { class: 'small muted' }, ` ${x.pct}`),
    ]))) : h('p', { class: 'small muted' }, 'Aucune.')]);
    return h('div', { class: 'movers-cols' }, [col('En hausse', mv.up), col('En baisse', mv.down)]);
  }
  function viewMarket() {
    const v = M.value;
    const stamp = M.liveAt ? `lue par ton favori le ${dateShort(M.liveAt)}` : '';
    return h('div', { class: 'market' }, [
      h('section', { class: 'panel market__value' }, [
        h('div', { class: 'market__head' }, [h('h2', null, 'Valeur de ton classeur'),
          h('button', { class: 'btn small', type: 'button', disabled: M.busy, onClick: () => loadMarket(true) }, [icon('refresh', M.busy ? 'spin' : ''), M.busy ? 'Lecture…' : 'Relire'])]),
        !M.loaded ? (M.error ? errLine(M.error) : h('p', { class: 'muted', role: 'status' }, 'Lecture des cotes…')) : null,
        M.loaded && v ? h('p', { class: 'market__big' }, [h('b', null, wfmt(v.value)), h('span', { class: 'muted' }, ` · ${fmt(v.priced)} ${plural(v.priced, 'carte cotée', 'cartes cotées')} sur ${fmt(v.cards)}`)]) : null,
        M.loaded && v && v.approx ? h('p', { class: 'small muted' }, `Dont ${fmt(v.approx)} ${plural(v.approx, 'carte comptée', 'cartes comptées')} dans sa plus haute rareté : le détail de leurs exemplaires arrive avec la prochaine relecture complète du favori.`) : null,
        M.loaded && v && !v.priced ? h('p', { class: 'muted' }, MARKET_HOW) : null,
        M.loaded ? viewValueChart(M.history) : null,
        h('p', { class: 'small muted' }, 'Valeur = somme des cotes fiables (3 ventes au moins) de chacun de tes exemplaires, selon sa rareté et s\'il est brillant ; cote = médiane des 30 dernières ventes sur 90 jours. Un point par jour.'),
        M.loaded && M.error ? errLine(M.error) : null,
      ]),
      h('section', { class: 'panel' }, [h('h2', null, 'Bonnes affaires'),
        h('p', { class: 'small muted' }, `Enchères en cours sur des cartes qui manquent à tes collections : au plus 80 % de la cote, ou « finit bientôt » (sans enchère, moins de 2 h, départ sous la cote).${stamp ? ' ' + cap(stamp) + '.' : ''}`),
        viewDeals(M.live)]),
      h('section', { class: 'panel' }, [h('h2', null, 'Cartes qui bougent'),
        h('p', { class: 'small muted' }, 'Écart de la cote de tes exemplaires sur 7 jours, en W.'), viewMovers()]),
      h('section', { class: 'panel' }, [h('h2', null, 'Mes enchères'), viewMine(M.live)]),
      h('section', { class: 'panel market__rules' }, [h('h2', null, 'À savoir'),
        h('p', { class: 'notice warn-box' }, MARKET_RULES),
        h('p', { class: 'small muted' }, 'Les cotes sont communes à tous les classeurs du site (des ventes du jeu, liées à aucun joueur) : une cote lue il y a plus de 12 h est relue au clic suivant d\'un membre qui a la carte.')]),
    ]);
  }
  // Fiche d'une carte possédée : cote de chacun de tes exemplaires (rareté, brillance), « ~ » si moins de 3 ventes.
  function viewCote(c) {
    if (!M.loaded) return null;
    const p = prices.value.get(String(c.id));
    if (!p) return h('div', { class: 'cote' }, [h('h3', null, 'Cote'), h('p', { class: 'small muted' }, M.value && M.value.priced ? "Pas encore lue : « Mettre à jour les cotes » dans l'encart du favori la lira (les plus anciennes d'abord)." : MARKET_HOW)]);
    const { list, approx } = variantsOf(c);
    let total = 0;
    let all = true;
    const rows = list.slice().sort((a, b) => variantOrder(a[0], b[0])).map(([k, n]) => {
      const q = p.v[k];
      if (reliable(q)) total += q.p * n; else all = false;
      return h('li', { key: k, class: 'cote__row' }, [
        h('span', null, `${n > 1 ? fmt(n) + ' × ' : ''}${variantName(k)}`),
        q ? h('b', { class: { approx: !reliable(q) }, title: reliable(q) ? null : 'Moins de 3 ventes : cote peu fiable' }, (reliable(q) ? '' : '~ ') + wfmt(q.p)) : h('b', { class: 'none' }, 'pas de vente'),
        q ? h('span', { class: 'small muted' }, `${fmt(q.n)} ${plural(q.n, 'vente', 'ventes')} · dernière ${wfmt(q.l)} le ${dateDay(q.d)}${q.w != null && q.w > 0 ? ` · 7 jours : ${pctOf(q.p, q.w)}` : ''}`) : null,
      ]);
    });
    return h('div', { class: 'cote' }, [
      h('h3', null, ['Cote ', h('span', { class: 'hint-inline' }, `lue le ${dateDay(p.at)}`)]),
      h('ul', { class: 'cote__list' }, rows),
      list.length > 1 || list[0][1] > 1 ? h('p', { class: 'small' }, `${all ? 'Tes exemplaires' : 'Tes exemplaires cotés'} : ${wfmt(total)}`) : null,
      approx ? h('p', { class: 'small muted' }, "Rareté de tes exemplaires pas encore connue : comptés dans celle de la carte (la prochaine relecture complète du favori la donne).") : null,
    ]);
  }
  // Fiche d'une carte qui te manque : ses cotes connues, par rareté d'exemplaire.
  function viewMissingCote(item) {
    if (!M.loaded) return null;
    const p = wantedPrices.value.get(normTitle(item.title));
    if (!p) return null;
    const keys = Object.keys(p.v).filter((k) => VARIANT_RE.test(k)).sort(variantOrder);
    return h('div', { class: 'cote' }, [
      h('h3', null, ['Cote dans le jeu ', h('span', { class: 'hint-inline' }, `lue le ${dateDay(p.at)}`)]),
      keys.length ? h('ul', { class: 'cote__list' }, keys.map((k) => {
        const q = p.v[k];
        return h('li', { key: k, class: 'cote__row' }, [h('span', null, variantName(k)), h('b', { class: { approx: !reliable(q) } }, (reliable(q) ? '' : '~ ') + wfmt(q.p)),
          h('span', { class: 'small muted' }, `${fmt(q.n)} ${plural(q.n, 'vente', 'ventes')} · dernière le ${dateDay(q.d)}`)]);
      })) : h('p', { class: 'small muted' }, 'Aucune vente ces 90 derniers jours.'),
    ]);
  }

  // ================================================================ rendu : contenu, bande de sélection
  function viewMain() {
    let panel;
    if (S.tab === 'cartes') panel = viewCards();
    else if (S.tab === 'maj') panel = viewUpdate();
    else if (S.tab === 'reglages') panel = viewSettings();
    else if (S.tab === 'amis') panel = viewFriends();
    else if (S.tab === 'chat') panel = viewChat();
    else if (S.tab === 'marche') panel = viewMarket();
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
      h('input', { id: 'bulk-tag', class: 'field', list: 'taglist', value: S.bulkTag, maxlength: 60, autocomplete: 'off', placeholder: 'Tag à ajouter ou retirer (« Pays/Brésil » ou « Brésil »)…',
        onInput: (e) => { S.bulkTag = e.target.value; }, onKeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); bulk('add'); } } }),
      catSelect('bulk-cat', S.bulkCat, (v) => { S.bulkCat = v; }, 'Catégorie du tag (facultatif)', true),
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
        h('div', { class: 'tags' }, list.map((t) => h('button', { key: t, class: 'tag auto', type: 'button', title: `Ajouter « ${tagTitle(t)} »`, disabled: S.drawer.busy,
          onClick: () => setTags(c, addTo(c.tags, t)) }, [icon('plus', 'sm'), h('span', { class: 'tag__cat' }, tagCat(t) + ' › '), tagSub(t)]))),
        h('div', null, [h('button', { class: 'btn small', type: 'button', disabled: S.drawer.busy, onClick: () => setTags(c, list.reduce(addTo, c.tags)) }, [icon('check', 'sm'), 'Valider les suggestions'])]),
      ];
    }
    return h('div', { class: 'sugg' }, [h('h3', null, ['Suggestions ', h('span', { class: 'hint-inline' }, "d'après Wikidata")]), ...body]);
  }
  function fact(label, value) { return h('div', { class: 'fact' }, [h('span', null, label), h('b', null, value)]); }
  function viewFiche(c, closeRef, boxRef) {
    const mine = membershipsOf(c); // toutes tes collections, celles faites d'une catégorie de Wikipédia comprises
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
        ficheTitle(c.title, true),
        c.category ? h('p', { class: 'muted lead' }, c.category) : null,
        h('div', { class: 'facts' }, [
          fact('Rareté', RARITY_NAME[c.rarity] || c.rarity || '?'),
          fact('Vues par mois', fmt(c.pageviews)),
          fact('Obtenue le', dateOf(c.obtained_at) ? dateOf(c.obtained_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '?'),
          fact('Exemplaires', fmt(c.count || 1) + (c.shiny ? ' · brillante' : '')),
          c.quality != null ? fact('Qualité', NUM2.format(c.quality)) : null,
          c.starred ? fact('Favorite', 'oui, dans le jeu') : null,
        ]),
        viewCote(c),
        h('div', null, [
          h('h3', null, 'Tes tags'),
          h('div', { class: 'tags' }, c.tags.length ? c.tags.map((t) => h('span', { class: 'tag own', key: t, title: tagTitle(t) }, [tagSub(t),
            h('button', { type: 'button', class: 'x', 'aria-label': 'Retirer le tag ' + tagTitle(t), disabled: S.drawer.busy, onClick: () => setTags(c, c.tags.filter((x) => x !== t)) }, [icon('x', 'sm')])]))
            : [h('span', { class: 'small muted' }, "Aucun tag pour l'instant.")]),
          h('form', { class: 'add-row', onSubmit: (e) => { e.preventDefault(); addTag(c); } }, [
            h('label', { class: 'sr', for: 'new-tag' }, 'Ajouter un tag'),
            h('input', { id: 'new-tag', class: 'field', list: 'taglist', value: S.drawer.newTag, maxlength: 60, autocomplete: 'off', placeholder: 'Ajouter un tag…',
              onInput: (e) => { S.drawer.newTag = e.target.value; } }),
            catSelect('new-tag-cat', S.drawer.newCat, (v) => { S.drawer.newCat = v; }, 'Catégorie du tag (facultatif)', true),
            h('button', { class: 'btn primary', type: 'submit', disabled: S.drawer.busy || !S.drawer.newTag.trim() }, 'Ajouter'),
          ]),
          errLine(S.drawer.error),
        ]),
        viewSuggestions(c),
        mine.length ? h('div', null, [h('h3', null, 'Dans tes collections'), memberList(mine)]) : null,
        h('div', { class: 'actions' }, [
          h('a', { href: c.url || wikiUrl(c.title), target: '_blank', rel: 'noopener noreferrer' }, "Lire l'article sur Wikipédia ↗"),
        ]),
      ]),
    ]);
  }
  // Amis qui ont la carte d'une case vide (partage entre membres) : « Chez : Paul (×2), Léa ».
  function viewMissingFriends(item) {
    if (!sharing()) return null;
    const list = holdersOf(item);
    if (!list.length) return S.friends.busy ? h('p', { class: 'small muted', role: 'status' }, 'Recherche chez tes amis…') : null;
    return h('p', { class: 'friends-note' }, [h('b', null, 'Chez : '), holdersText(list), h('span', { class: 'muted' }, ' · à échanger dans le jeu, entre vous')]);
  }
  // Fiche d'une carte qui te manque (case vide) : ce qu'en dit Wikipédia, sa rareté estimée d'après ses vues,
  // les collections où elle figure, le marché du jeu (article vérifié seulement) et l'article.
  function viewMissing(item, closeRef, boxRef) {
    void S.pv.version;
    const info = pvCache.get(item.title);
    const views = info ? info[0] : null;
    const img = item.image || (info ? info[1] : null);
    const ok = item.status === 'ok';
    const real = ok ? realRarity(item) : null; // rareté donnée par le jeu : pas d'estimation
    const est = ok && !real ? estRarity(views) : null;
    const mine = membershipsOfItem(item); // toutes tes collections, celles faites d'une catégorie de Wikipédia comprises
    const goto = (col) => { closeCard(); openAlbum(col.kind, col.id); };
    const memberList = (list) => h('div', { class: 'memberships' }, list.map((col) => {
      const p = progressOf(col);
      return h('button', { key: col.key, type: 'button', onClick: () => goto(col) }, [col.name, h('span', null, `${fmt(p.own)} / ${fmt(p.total)}`)]);
    }));
    return h('div', { class: 'sheet fiche fiche--missing', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'detail-title', tabindex: '-1', ref: boxRef,
      onKeydown: (e) => trapTab(e, boxRef.value) }, [
      h('button', { class: 'close', type: 'button', ref: closeRef, 'aria-label': 'Fermer la fiche', onClick: closeCard }, [icon('x')]),
      h('div', { class: 'slot big', 'aria-hidden': 'true' }, [
        img ? h('img', { class: 'slot__bg', src: img, alt: '', decoding: 'async', onError: hideBroken }) : null,
        h('div', { class: 'slot__top' }, ok ? [real ? pill(real) : pill(est, true)] : []),
        h('p', { class: 'slot__name' }, item.title),
      ]),
      h('div', { class: 'info' }, [
        ficheTitle(item.title, ok),
        item.description ? h('p', { class: 'muted lead' }, item.description) : null,
        h('p', { class: 'missing-note' }, 'Pas encore dans ta collection'),
        viewMissingFriends(item),
        item.status === 'missing' ? h('p', { class: 'warn' }, 'Article introuvable sur Wikipédia : corrige son titre dans la collection.') : null,
        item.status === 'disambiguation' ? h('p', { class: 'warn' }, "Page d'homonymie : précise le titre dans la collection.") : null,
        ok ? h('div', { class: 'facts' }, [
          real ? fact('Rareté dans le jeu', RARITY_NAME[real]) : fact('Rareté estimée', est ? '≈ ' + RARITY_NAME[est] : S.pv.running ? '…' : '?'),
          fact('Vues sur 30 jours', views != null ? fmt(views) : S.pv.running ? '…' : '?'),
        ]) : null,
        ok ? h('p', { class: 'small muted' }, real ? 'Rareté relevée dans la Collection globale du jeu, quand la collection a été créée.'
          : "Rareté estimée d'après les vues de l'article sur 30 jours (seuils observés dans le jeu).") : null,
        ok ? viewMissingCote(item) : null,
        mine.length ? h('div', null, [h('h3', null, 'Dans tes collections'), memberList(mine)]) : null,
        h('div', { class: 'actions' }, [
          h('a', { href: wikiUrl(item.title), target: '_blank', rel: 'noopener noreferrer' }, "Lire l'article sur Wikipédia ↗"),
        ]),
      ]),
    ]);
  }
  // Fiche d'une carte (ou d'une case vide) de l'album d'un ami, en lecture seule : qui l'a (lui, toi), sa rareté (celle de
  // sa carte ou de la tienne, sinon estimée), ses vues, les autres collections de l'ami et les tiennes où elle figure,
  // « Copier le nom », Wikipédia. Rien n'y modifie ton classeur ni le sien (pas de tags, pas de sélection).
  function viewFriendSheet(item, closeRef, boxRef) {
    void S.pv.version;
    const fx = item.friend;
    const fc = fx.card;
    const mine = findCard(item);
    const n = mine ? Math.max(1, Number(mine.count) || 1) : 0;
    const info = pvCache.get(item.title);
    const views = info ? info[0] : null;
    const real = (fc && okRarity(fc.rarity)) || (mine && okRarity(mine.rarity)) || null;
    const est = real ? null : estRarity(views);
    const img = (fc && fc.image) || (mine && mine.image) || (info ? info[1] : null);
    const url = (fc && fc.url) || (mine && mine.url) || wikiUrl(item.title);
    const myCols = mine ? membershipsOf(mine) : membershipsOfItem(item);
    // Ses collections qui contiennent cet article : même titre, ou même qid.
    const f = friendList.value.find((x) => x.id === fx.id) || null;
    const k = normTitle(item.title);
    const theirs = f && f.targets ? f.targets.filter((t) => t.items.some((it) => normTitle(it.title) === k || (!!item.qid && it.qid === item.qid))) : [];
    const progressById = friendTargetsView.value && openFriend.value && openFriend.value.id === fx.id ? friendTargetsView.value.byId : new Map();
    const goMine = (col) => { closeCard(); openAlbum(col.kind, col.id); };
    const goTheirs = (t) => { closeCard(); openFriendAlbum(fx.id, t.id, S.friends.albumFrom); };
    const myList = (list) => h('div', { class: 'memberships' }, list.map((col) => {
      const p = progressOf(col);
      return h('button', { key: col.key, type: 'button', onClick: () => goMine(col) }, [col.name, h('span', null, `${fmt(p.own)} / ${fmt(p.total)}`)]);
    }));
    const theirList = h('div', { class: 'memberships' }, theirs.map((t) => {
      const r = progressById.get(t.id);
      return h('button', { key: t.id, type: 'button', 'aria-label': `Ouvrir « ${t.name} » de ${fx.name}`, onClick: () => goTheirs(t) },
        [colsText([t], ''), r ? h('span', null, `${fmt(r.p.own)} / ${fmt(r.p.total)}`) : null]);
    }));
    return h('div', { class: 'sheet fiche fiche--missing fiche--friend', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'detail-title', tabindex: '-1', ref: boxRef,
      onKeydown: (e) => trapTab(e, boxRef.value) }, [
      h('button', { class: 'close', type: 'button', ref: closeRef, 'aria-label': 'Fermer la fiche', onClick: closeCard }, [icon('x')]),
      h('div', { class: ['slot', 'big', { can: !fc && !!mine }], 'aria-hidden': 'true' }, [
        img ? h('img', { class: 'slot__bg', src: img, alt: '', decoding: 'async', onError: hideBroken }) : null,
        h('div', { class: 'slot__top' }, [real ? pill(real) : pill(est, true)]),
        h('p', { class: 'slot__name' }, item.title),
      ]),
      h('div', { class: 'info' }, [
        ficheTitle(item.title, true),
        mine && mine.category ? h('p', { class: 'muted lead' }, mine.category) : null,
        h('div', { class: 'fiche__states' }, [
          h('p', { class: ['missing-note', { on: !!fc }] }, fc ? `Chez ${fx.name}${fc.count > 1 ? ' : ×' + fmt(fc.count) : ''}${fc.shiny ? ', brillante' : ''}` : `Manque à ${fx.name}`),
          h('p', { class: ['missing-note', { on: !!mine }] }, mine ? `Tu l'as${n > 1 ? ` : ×${fmt(n)}, en double` : ''}` : 'Pas encore dans ta collection'),
        ]),
        !fc && mine ? h('p', { class: 'friends-note' }, [h('b', null, n > 1 ? 'Tu pourrais la lui donner' : 'Tu pourrais la lui donner, mais c\'est ton seul exemplaire'),
          h('span', { class: 'muted' }, ' · à échanger dans le jeu, entre vous')]) : null,
        mine ? null : viewMissingFriends(item),
        h('div', { class: 'facts' }, [
          real ? fact('Rareté dans le jeu', RARITY_NAME[real]) : fact('Rareté estimée', est ? '≈ ' + RARITY_NAME[est] : S.pv.running ? '…' : '?'),
          views != null || (!fc && !mine) ? fact('Vues sur 30 jours', views != null ? fmt(views) : S.pv.running ? '…' : '?') : null,
        ]),
        h('p', { class: 'small muted' }, real ? (fc ? `Rareté de la carte de ${fx.name} dans le jeu.` : 'Rareté de ta carte dans le jeu.')
          : "Rareté estimée d'après les vues de l'article sur 30 jours (seuils observés dans le jeu)."),
        theirs.length ? h('div', null, [h('h3', null, `Dans les collections de ${fx.name}`), theirList]) : null,
        myCols.length ? h('div', null, [h('h3', null, 'Dans tes collections'), myList(myCols)]) : null,
        h('div', { class: 'actions' }, [
          h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, "Lire l'article sur Wikipédia ↗"),
        ]),
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
  const SOURCE_LABEL = { cat: 'Catégorie Wikipédia', wd: 'Wikidata', links: 'Page Wikipédia', def: 'Définition Wikipédia' };
  const wpPageUrl = (t) => 'https://fr.wikipedia.org/wiki/' + encodeURIComponent(t.replace(/ /g, '_'));
  function viewCandidate(ed, c) {
    const big = c.tooBig;
    // Définition : le nombre d'articles qui citent la formule ; ceux qui la disent en ouverture sont triés au choix.
    const size = c.source === 'links' ? 'ses liens, triés à l\'ouverture'
      : c.source === 'def' ? (big ? `plus de 3 000 articles (${fmt(c.size)} citent la formule)` : `${fmt(c.size)} ${plural(c.size, 'article cite', 'articles citent')} la formule, triés à l'ouverture`)
        : big ? 'plus de 3 000 articles'
          : `${fmt(c.size)} ${plural(c.size, 'article', 'articles')}` + (c.subcats ? ` · ${fmt(c.subcats)} sous-catégories` : '');
    let action;
    if (!big) action = h('button', { class: 'btn small primary', type: 'button', 'aria-label': 'Choisir ' + c.name, onClick: () => kwChoose(ed, c) }, 'Choisir');
    else if (c.source === 'wd' || c.source === 'def') {
      action = h('div', { class: 'actions' }, [h('span', { class: 'small muted' }, 'Garder les plus connus :'),
        ...[100, 200, 500].map((n) => h('button', { key: n, class: 'btn small', type: 'button', 'aria-label': `Garder les ${n} plus connus`, onClick: () => kwChoose(ed, c, n) }, String(n)))]);
    } else action = h('span', { class: 'small muted' }, 'trop grande : précise ta recherche');
    return h('li', { class: ['cand', { disabled: big && c.source !== 'wd' && c.source !== 'def' }], key: c.id }, [
      h('div', { class: 'what' }, [
        h('b', null, c.name),
        h('span', null, `${size} · ${SOURCE_LABEL[c.source]}`),
        (c.source === 'wd' || c.source === 'def') && c.interp ? h('span', { class: 'interp' }, cap(c.interp)) : null,
      ]),
      action,
    ]);
  }
  function viewKeywords(ed) {
    const kw = ed.kw;
    const ch = kw.chosen;
    if (ch) {
      const cand = kw.cands.find((x) => x.id === ch.candId);
      const extra = ch.items && ch.items.length > 20 ? ch.items.length - 20 : 0;
      return [
        h('button', { class: 'back', type: 'button', onClick: () => { kwAbort(); kw.chosen = null; } }, '← Autres candidats'), // arrête un chargement en cours
        h('label', { class: 'field' }, [h('span', null, 'Nom de la collection'),
          h('input', { id: 'kw-name', class: 'field full', value: ch.name, maxlength: 120, autocomplete: 'off', onInput: (e) => { ch.name = e.target.value; } })]),
        h('p', { class: 'note' }, [
          ch.source === 'cat' ? `Catégorie Wikipédia : ${ch.title.replace(/^Catégorie\s*:\s*/i, '')}`
            : ch.source === 'links' ? ['Liens de la page ', h('a', { href: wpPageUrl(ch.title), target: '_blank', rel: 'noopener noreferrer' }, ch.title)]
              : ch.source === 'def' ? 'Définition Wikipédia · ' + ch.interp
                : 'Wikidata' + (ch.interp ? ' · ' + ch.interp : ''),
          ' · ', ch.loading ? (ch.source === 'links' ? 'lecture des liens et de leur nature sur Wikidata…'
            : ch.source === 'def' ? 'lecture du début des articles' + (ch.progress ? ' : ' + ch.progress : '…') : 'chargement des articles…')
            : `${fmt(ch.total)} ${plural(ch.total, 'article', 'articles')}`]),
        ch.source === 'def' && !ch.loading && ch.items ? h('p', { class: 'note' }, `${fmt(ch.total)} ${plural(ch.total, 'retenu', 'retenus')} sur ${fmt(ch.checked)} ${plural(ch.checked, 'article lu', 'articles lus')}`
          + (ch.top ? ', les plus liés depuis Wikipédia d\'abord' : ', par ordre alphabétique') + ' : les autres citent la formule plus loin, ou leur première phrase dit autre chose.') : null,
        ch.source === 'cat' && ch.subcats && cand ? h('label', { class: 'check' }, [
          h('input', { type: 'checkbox', checked: ch.withSubs, disabled: ch.loading, onChange: () => kwToggleSubs(ed, cand) }),
          ` inclure les sous-catégories (1 niveau : ${fmt(ch.subcats)})`]) : null,
        ch.source === 'links' && ch.links && ch.links.top && cand ? h('label', { class: 'check' }, [
          h('input', { type: 'checkbox', checked: !ch.allLinks, disabled: ch.loading, onChange: () => kwToggleSubs(ed, cand) }),
          ` ne garder que les « ${ch.links.top.label} » (${fmt(ch.links.top.n)} sur ${fmt(ch.links.items.length)} articles liés : pays, régions et autres liens écartés)`]) : null,
        ch.total > 3000 ? h('p', { class: 'warn' }, 'Trop grande (plus de 3 000 articles) : précise ta recherche.') : null,
        ch.items && ch.items.length ? h('ol', { class: 'preview', 'aria-label': 'Aperçu des premiers articles' }, ch.items.slice(0, 20).map((i) => h('li', { key: i.title }, i.title))) : null,
        extra ? h('p', { class: 'note' }, `… et ${fmt(extra)} autres`) : null,
        ch.items && !ch.items.length && !ch.loading ? h('p', { class: 'muted' }, 'Aucun article dans ce candidat.') : null,
        errLine(ch.error),
        errLine(ed.error),
        foot([
          closeBtn('Annuler'),
          h('button', { class: 'btn primary', type: 'button', disabled: ed.busy || ch.loading || !ch.items || !ch.items.length || ch.total > 3000 || !ch.name.trim(),
            onClick: () => kwSave(ed) }, ed.busy ? 'Enregistrement…' : 'Enregistrer'),
        ]),
      ];
    }
    return [
      h('label', { class: 'sr', for: 'kw' }, 'Mots-clés'),
      h('input', { id: 'kw', class: 'field full', type: 'search', value: kw.q, autocomplete: 'off', spellcheck: 'false',
        placeholder: 'races bovines, footballeur français, cathédrales de France, films de Miyazaki…',
        onInput: (e) => kwInput(ed, e.target.value), onKeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); kwSearch(ed); } } }),
      h('p', { class: 'note' }, "Le classeur cherche les pages « Liste de… » de Wikipédia (leurs liens forment la collection), des catégories, les articles dont la première phrase dit « … est une maladie … » (un nom suffit : « maladie »), et construit une requête Wikidata d'après tes mots. Tu peux aussi coller l'adresse d'une page Wikipédia. Choisis un candidat, vérifie l'aperçu, puis enregistre."),
      kw.searching ? h('p', { class: 'progress-msg', role: 'status' }, 'Recherche…') : null,
      errLine(kw.error),
      kw.interp ? h('p', { class: 'interp-line' }, ['Interprétation : ', h('b', null, kw.interp)]) : null,
      kw.cands.length ? h('ul', { class: 'cands', 'aria-label': 'Candidats' }, kw.cands.map((c) => viewCandidate(ed, c)))
        : kw.searched && !kw.searching ? h('p', { class: 'muted' }, "Aucun candidat : essaie d'autres mots, ou la liste d'articles.") : null,
      foot([closeBtn('Annuler')]),
    ];
  }
  function viewListMode(ed) {
    const lines = ed.text.split('\n').filter((l) => l.trim()).length;
    return [
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
    ];
  }
  function modalEditor() {
    const ed = S.editor;
    if (!ed) return null;
    const tab = (mode, label) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(ed.mode === mode), 'aria-pressed': String(ed.mode === mode),
      onClick: () => { ed.mode = mode; ed.error = ''; } }, label);
    return h(Modal, { key: 'editor', wide: ed.mode === 'mots', title: ed.id ? 'Modifier la collection' : 'Nouvelle collection à compléter', onClose: closeModal }, () => [
      ed.id ? null : h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Façon de créer la collection' }, [tab('mots', 'Par mots-clés'), tab('liste', "Liste d'articles")]),
      ...(ed.mode === 'mots' && !ed.id ? viewKeywords(ed) : viewListMode(ed)),
    ]);
  }
  function modalTag() {
    const te = S.tagEdit;
    if (!te) return null;
    const n = tagCount.value.get(te.from) || 0;
    return h(Modal, { key: 'tag', title: `Le tag « ${tagSub(te.from)} »`, onClose: closeModal }, () => [
      h('p', null, `${cards$(n)} ${plural(n, 'porte', 'portent')} ce tag, rangé dans « ${tagCat(te.from)} ».`),
      h('form', { class: 'tag-form', onSubmit: (e) => { e.preventDefault(); renameTag(te); } }, [
        h('label', { class: 'field' }, [h('span', null, 'Nom'),
          h('input', { id: 'tag-to', class: 'field', value: te.to, maxlength: 60, autocomplete: 'off', onInput: (e) => { te.to = e.target.value; } })]),
        h('label', { class: 'field' }, [h('span', null, 'Catégorie'), catSelect('tag-cat', te.cat, (v) => { te.cat = v; }, 'Catégorie', false)]),
        h('div', { class: 'actions' }, [h('button', { class: 'btn primary', type: 'submit', disabled: te.busy || !te.to.trim() }, 'Renommer')]),
      ]),
      h('p', { class: 'note' }, ['Si un tag porte déjà ce nom, les deux sont fusionnés. Pour ranger tous tes tags d\'un coup : ',
        h('button', { class: 'linkish', type: 'button', onClick: () => { closeModal(); openArrange(); } }, 'Ranger mes tags'), '.']),
      errLine(te.error),
      foot([
        h('button', { class: ['btn', 'danger', 'left', { solid: te.confirmDelete }], type: 'button', disabled: te.busy, onClick: () => deleteTag(te) },
          te.confirmDelete ? `Confirmer : le retirer de ${cards$(n)}` : [icon('trash', 'sm'), 'Supprimer ce tag']),
        closeBtn(),
      ]),
    ]);
  }
  function modalArrange() {
    const ar = S.arrange;
    if (!ar) return null;
    const moving = ar.rows.filter((r) => r.cat !== OTHER).length;
    return h(Modal, { key: 'arrange', wide: true, title: 'Ranger mes tags', onClose: closeModal }, () => [
      h('p', null, 'Chaque tag sans catégorie en reçoit une, devinée d\'après tes cartes et Wikidata. Vérifie, change si besoin, puis applique : « Autres » laisse le tag tel quel.'),
      ar.loading ? h('p', { class: 'progress-msg', role: 'status' }, ar.progress || 'Analyse de tes tags…') : null,
      ar.rows.length ? h('ul', { class: 'arrange' }, ar.rows.map((row) => h('li', { key: row.from }, [
        h('span', { class: 'from' }, [row.from, h('span', { class: 'n' }, ' · ' + fmt(row.count))]),
        h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'),
        catSelect('', row.cat, (v) => { row.cat = v; }, `Catégorie de « ${row.from} »`, false),
        h('span', { class: 'why' }, row.cat === OTHER ? (row.why && row.why.startsWith('peut-être') ? 'reste dans Autres (' + row.why + ')' : 'reste dans Autres') : row.why),
      ]))) : h('p', { class: 'muted' }, 'Tous tes tags sont déjà rangés dans une catégorie.'),
      !ar.loading && ar.progress ? h('p', { class: 'progress-msg', role: 'status' }, ar.progress) : null,
      errLine(ar.error),
      foot([
        closeBtn('Annuler'),
        h('button', { class: 'btn primary', type: 'button', disabled: ar.busy || ar.loading || !moving, onClick: () => applyArrange(ar) },
          ar.busy ? (ar.progress || 'Rangement…') : `Appliquer (${fmt(moving)} ${plural(moving, 'tag', 'tags')})`),
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

  function modalSync() {
    const y = S.sync;
    const close = () => closeModal();
    if (y.done) {
      return h(Modal, { key: 'sync', title: 'Collection mise à jour', onClose: close }, () => [
        h('p', { class: 'ok', role: 'status' }, y.msg),
        foot([h('button', { class: 'btn primary', type: 'button', onClick: close }, 'Fermer')]),
      ]);
    }
    return h(Modal, { key: 'sync', title: 'Mettre à jour ta collection', onClose: close }, () => [
      h('p', null, "Le classeur ne peut pas lire le jeu tout seul : c'est ton favori, cliqué sur wiki-masters.com où tu es connecté, qui lui envoie ta collection."),
      h('p', { class: 'note' }, ['Classeur ouvert ici : ', h('strong', null, (S.me && S.me.user && S.me.user.name) ? 'celui de ' + S.me.user.name : 'sans nom'),
        S.known.some((k) => k.key !== S.key) ? '. Le favori envoie dans le classeur pour lequel il a été créé : si ce n\x27est pas celui-ci, change de classeur dans les Réglages.' : '.']),
      y.elsewhere ? h('p', { class: 'warn', role: 'alert' }, [
        `Tes cartes sont arrivées dans le classeur ${y.elsewhere.name ? 'de ' + y.elsewhere.name : 'd\x27un autre compte'}, pas dans celui ouvert ici. `,
        h('button', { class: 'btn small primary', type: 'button', onClick: () => { const k = y.elsewhere.key; closeModal(); switchTo(k); } }, `Ouvrir ${y.elsewhere.name ? 'le classeur de ' + y.elsewhere.name : 'ce classeur'}`),
      ]) : null,
      h('ol', { class: 'steps' }, [
        h('li', null, [h('a', { class: 'btn primary small', href: 'https://www.wiki-masters.com/collection', target: '_blank', rel: 'noopener' }, 'Ouvrir wiki-masters.com')]),
        h('li', null, ['Clique ton favori « Classeur WikiMasters » dans la barre de favoris (', h('kbd', null, 'Ctrl'), '+', h('kbd', null, 'Maj'), '+', h('kbd', null, 'B'), ' pour l\x27afficher). Un encart montre la lecture, puis l\x27envoi.']),
        h('li', null, 'Reviens ici : le classeur se met à jour tout seul.'),
      ]),
      h('p', { class: 'wait-line', role: 'status' }, [icon('refresh', 'spin'), ' En attente de ton favori…']),
      y.expired ? h('p', { class: 'note' }, 'Ta session collée a expiré : le favori la remplace, sans rien coller.') : null,
      !y.hasFavori ? h('p', { class: 'note' }, ['Pas encore de favori ? ', h('button', { class: 'linkish', type: 'button', onClick: () => { closeModal(); openFavori(); } }, 'Installer le favori')]) : null,
      foot([
        h('button', { class: 'linkish', type: 'button', onClick: () => { closeModal(); openFavori(); } }, 'Voir le favori et les autres façons'),
        h('button', { class: 'btn', type: 'button', onClick: close }, 'Fermer'),
      ]),
    ]);
  }
  const MODALS = { editor: modalEditor, confirm: modalConfirm, tag: modalTag, switch: modalSwitch, link: modalLink, arrange: modalArrange, sync: modalSync };

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
      watch(() => S.openId || S.openMissing, (id, old) => { if (id && !old) nextTick(() => { if (closeRef.value) closeRef.value.focus(); }); });
      return () => h(Transition, { name: 'fade' }, () => (openCard.value || S.openMissing ? h('div', {
        class: 'overlay', key: 'fiche',
        onPointerdown: (e) => { downOnVeil = e.target === e.currentTarget; },
        onClick: (e) => { if (downOnVeil && e.target === e.currentTarget) closeCard(); downOnVeil = false; },
      }, [openCard.value ? viewFiche(openCard.value, closeRef, boxRef) : S.openMissing.friend ? viewFriendSheet(S.openMissing, closeRef, boxRef)
        : viewMissing(S.openMissing, closeRef, boxRef)]) : null));
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
      if (S.openId || S.openMissing) { e.preventDefault(); closeCard(); return; }
      return;
    }
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (e.key === '/' && S.tab === 'cartes' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag) && !S.modal && !S.openId) {
      const q = document.getElementById('q');
      if (q) { e.preventDefault(); q.focus(); }
    }
  }
  // Retour sur l'onglet, puis toutes les 60 s tant qu'il reste visible (LIVE_EVERY) : cards_rev (GET /api/me) dit si
  // quelque chose a changé (envoi du favori, cliqué ou relié à la page du jeu ; tags modifiés sur un autre appareil), et
  // les cartes ne sont relues (?since) que dans ce cas. Sans lui (ancien serveur), seul un nouvel envoi (fetched_at)
  // recharge, comme avant. GET /api/me ne lit qu'une ligne de la base (le compte, par l'index unique de sa clé). Onglet
  // caché : minuterie arrêtée, aucune requête. poll = true : relecture périodique, sautée si une autre est en cours, si
  // les cartes se chargent ou si la fenêtre du favori (qui relit déjà toutes les 4 s) est ouverte.
  const LIVE_EVERY = 60 * 1000;
  let liveTimer = null;
  let livePolling = false;
  async function checkRemote(poll) {
    if (document.visibilityState !== 'visible' || S.boot !== 'app' || S.refresh.running || S.modal === 'sync') return;
    if (poll && (livePolling || S.loadingCards)) return;
    if (poll) livePolling = true;
    try {
      const before = S.me && S.me.fetched_at;
      try { await loadMe(); } catch (e) { return; }
      const me = S.me;
      const imported = !!(me && me.fetched_at && me.fetched_at !== before);
      if (!(imported || (me && Number.isInteger(me.cards_rev) && me.cards_rev !== cardsRev))) return;
      try {
        const changed = await syncCards(me);
        if (imported && poll) {
          const n = Array.isArray(me.new_ids) ? me.new_ids.length : 0;
          notify(`Mis à jour depuis wiki-masters.com${n ? ` : ${fmt(n)} ${plural(n, 'nouvelle carte', 'nouvelles cartes')}` : ''} (${cards$(cards.value.length)}).`);
        } else if (imported) notify(`Collection mise à jour : ${cards$(cards.value.length)}.`);
        if (changed) {
          startPageviews();
          afterCards();
        }
      } catch (e) { notify(e.message, true); }
    } finally {
      if (poll) livePolling = false;
    }
  }
  function setLive() {
    const on = document.visibilityState === 'visible';
    if (on && !liveTimer) liveTimer = setInterval(() => checkRemote(true), LIVE_EVERY);
    if (!on && liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  }
  function onVisible() {
    setLive();
    chatVisibility(); // chat ouvert : relu tout de suite au retour, minuterie arrêtée quand la page est cachée
    if (S.tab === 'marche' && document.visibilityState === 'visible') loadMarket(Date.now() - M.at > 20000); // retour du jeu : cotes peut-être relues
    return checkRemote(false);
  }

  const Root = {
    name: 'Classeur',
    setup() {
      onMounted(() => {
        window.addEventListener('keydown', onKey);
        window.addEventListener('hashchange', () => { const k = takeHashKey(); if (k != null) boot(k); });
        document.addEventListener('visibilitychange', onVisible);
        setLive();
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
  // Collection ouverte (ou articles d'une catégorie arrivés après coup) : vues sur 30 jours des articles qui manquent.
  watch(() => (activeAlbum.value ? activeAlbum.value.key + ':' + activeAlbum.value.items.length : ''), () => {
    startPageviews();
    if (activeAlbum.value) resolveQids(activeAlbum.value.items, false);
  });
  // Album d'une collection d'un ami affiché : vues des articles que ni lui ni toi n'avez, et qids de ses articles pour les
  // rapprocher de tes cartes ; refermé (ou onglet quitté) : celles de ton album ouvert reprennent.
  watch(() => (friendAlbum.value && S.tab === 'amis' ? friendAlbum.value.key + ':' + friendAlbum.value.t.items.length : ''), (k, old) => {
    if (k) {
      startFriendPageviews();
      resolveQids(friendAlbum.value.t.items, false);
    } else if (old) startPageviews();
  });

  createApp(Root).mount('#app');
})();
