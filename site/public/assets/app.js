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
  const SORTS = [['rarity', 'Rareté'], ['price-up', 'Prix ↑'], ['price-down', 'Prix ↓'], ['pageviews', 'Vues par mois'], ['obtained', 'Plus récentes'], ['atk', 'Attaque'], ['def', 'Défense'], ['title', 'Titre']];
  const PAGE = 120;
  const ALBUM_PAGE = 240;
  // Ordre d'affichage des légendes : de la plus commune à la plus rare, comme dans le jeu.
  const RAR_UP = ['C', 'PC', 'R', 'SR', 'UR', 'L'];
  const LS = { key: 'classeur-key', target: 'classeur-target', folded: 'classeur-tags-folded', pv: 'classeur-pv', sugg: 'classeur-sugg',
    importKey: 'classeur-import-key', known: 'classeur-known', natGroup: 'classeur-natgroup', tagCats: 'classeur-tagcats', proposeAt: 'classeur-propose-at',
    chatRead: 'classeur-chat-lu', market: 'classeur-marche', sections: 'classeur-sections' };
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
    gtagFilter: [], // tags du jeu (clés repliées, catKey) qui filtrent « Mes cartes », combinés
    gtagsAll: false, // « Tags du jeu » de « Mes cartes » : tous montrés (sinon les GTAG_FACET premiers)
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
    sepBusy: null, // id de la collection dont un intercalaire s'enregistre (case de la fiche)
    sepError: '',
    autoBusy: null, // id de la collection dont l'ajout automatique s'arrête ou reprend (« Arrêter », « Annuler »)
    drawer: { newTag: '', newCat: '', busy: false, error: '' },
    tagSearch: '',
    tagsAll: false,
    refresh: { running: false, msg: '', error: false, warn: false },
    // Fenêtre « Mettre à jour avec le favori » ; failed = échec signalé par le favori pendant qu'elle est ouverte (journal
    // des synchros, last_sync de GET /api/me), lastAt = dernière ligne du journal à son ouverture.
    sync: { done: false, msg: '', before: null, expired: false, hasFavori: false, others: {}, elsewhere: null, failed: '', lastAt: null },
    notice: null,
    modal: null, // editor | confirm | tag | switch | link | arrange | sync | tagadd | merge
    session: { cookie: '', busy: false, error: '' },
    editor: null,
    confirm: null,
    tagEdit: null,
    // « Fusionner avec… » (album d'une de tes collections) : {id (celle d'où l'on part, qui reçoit la fusion), other (id de
    // l'autre, null tant qu'elle n'est pas choisie), name (nom de la collection fusionnée), drop (supprimer l'autre après),
    // head (la première carte ajoutée devient un intercalaire), busy, error}.
    merge: null,
    // « Réorganiser » (album d'une de tes collections qui a un ordre) : brouillon du nouvel ordre, voir startReorder.
    reorder: null,
    settings: { name: '', busy: false, error: '', saved: false, pseudo: '', pBusy: false, pError: '', pSaved: false },
    copied: '',
    bm: { src: null, error: '', clicked: false, importKey: null, busy: false, checking: false, stale: false },
    pv: { version: 0, running: false, done: 0, total: 0, error: '' },
    prefs: { hidden_proposals: [], hide_proposals: false }, // préférences du compte (GET/PATCH /api/me) : propositions retirées, masquées
    tagCatsOpen: (() => { const v = store.json(LS.tagCats); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; })(),
    bulkCat: '',
    wp: { list: [], running: false, done: 0, total: 0, label: '', error: '', busy: {} }, // propositions d'après les catégories Wikipédia
    arrange: null, // « Ranger mes tags » : {rows, busy, loading, progress, error}
    // « Ajouter par tags du jeu » (album d'une collection) : {id (de la collection), on (propositions cochées :
    // « g:<tag du jeu replié> », « c:<catégorie du jeu repliée> », « t:<tag> » ou « t:<Catégorie de tags>/ »), off (cartes
    // décochées dans l'aperçu : ids), keep (cartes exclues de l'ajout automatique, recochées : ids), extra (tags et
    // catégories du jeu choisis à la main), field, fieldError, limit (cartes de l'aperçu affichées), tags (tes tags du
    // classeur dépliés), auto (case « Refaire à chaque synchro »), rules (règles de la collection à l'ouverture), busy, error}.
    tagAdd: null,
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
    // ac = autocomplétion du champ ouverte : {kind ('@' membre | '#' carte), start (position du @ ou du #), end (curseur),
    // q (texte tapé après), active (suggestion surlignée)} ; acOff = {start, q} : le @ ou # dont la liste a été fermée par
    // Échap, et ce qui était tapé (elle reste fermée tant qu'on continue ce mot) ;
    // acWp = articles de Wikipédia qui commencent par le texte tapé après « # » ({q (replié), titles, loading}).
    chat: { user: null, status: 'idle', error: '', draft: '', sending: false, sendError: '', older: false, olderBusy: false, read: 0, newBelow: false, ac: null, acOff: null,
      acWp: { q: '', titles: [], loading: false } },
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
  // Prénoms des membres qui montrent leurs cartes, pour les mentions du chat (« @ ») quand « Entre amis » n'a pas encore
  // été lu : GET /api/members seul, sans leurs cartes (loadChatMembers). Remis à zéro avec friendList (clearFriends).
  const chatMembers = shallowRef([]);
  let chatMembersAt = 0;
  let chatMembersJob = null;
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
  // POST /api/targets/save : en un envoi tant que ses éléments font moins de TARGET_PART_BYTES en JSON, sinon en morceaux
  // (upload {id, part, last} de targets.js), le dernier portant le reste du corps. La réponse d'un envoi en morceaux n'a
  // pas les éléments (target.items = null) : ceux envoyés les remplacent. Marge sous les 600 Ko du serveur : il range
  // chaque élément avec tous ses champs (description, image à null…).
  const TARGET_PART_BYTES = 480 * 1024;
  const uploadId = () => {
    const a = new Uint8Array(12);
    try { crypto.getRandomValues(a); } catch (e) { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); }
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  };
  async function saveTargetApi(body) {
    const items = Array.isArray(body.items) ? body.items : [];
    const parts = [];
    let cur = [];
    let size = 2;
    for (const it of items) {
      const n = utf8Length(JSON.stringify(it)) + 40;
      if (cur.length && size + n > TARGET_PART_BYTES) { parts.push(cur); cur = []; size = 2; }
      cur.push(it);
      size += n;
    }
    if (parts.length === 0) return api('POST', '/api/targets/save', body);
    parts.push(cur);
    const id = uploadId();
    for (let k = 0; k < parts.length - 1; k++) await api('POST', '/api/targets/save', { items: parts[k], upload: { id, part: k } });
    const r = await api('POST', '/api/targets/save', { ...body, items: parts[parts.length - 1], upload: { id, part: parts.length - 1, last: true } });
    if (r.target && r.target.items === null) r.target = { ...r.target, items };
    return r;
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
  const hasFilters = computed(() => !!(S.tagFilter.length || S.gtagFilter.length || S.untaggedOnly || S.newOnly || S.q.trim() || S.rarities.length));
  const SORTERS = {
    rarity: (a, b) => (RANK[a.rarity] ?? 9) - (RANK[b.rarity] ?? 9) || (b.pageviews ?? -1) - (a.pageviews ?? -1),
    pageviews: (a, b) => (b.pageviews ?? -1) - (a.pageviews ?? -1),
    obtained: (a, b) => String(b.obtained_at || '').localeCompare(String(a.obtained_at || '')),
    atk: (a, b) => (b.atk ?? -1) - (a.atk ?? -1),
    def: (a, b) => (b.def ?? -1) - (a.def ?? -1),
    title: (a, b) => COLLATOR.compare(a.title, b.title),
  };
  // « Mes cartes » : recherche (titre, description, tags du jeu, tags), raretés, tags du jeu et tags (combinés), sans tag,
  // nouvelles.
  const filtered = computed(() => {
    const q = fold(S.q.trim());
    const rar = new Set(S.rarities.length ? S.rarities : RARITIES);
    const tags = S.tagFilter;
    const fresh = newIdSet.value;
    const out = cards.value.filter((c) => rar.has(c.rarity)
      && (!q || c._k.includes(q) || c.tags.some((t) => fold(t).includes(q)))
      && (!S.untaggedOnly || !c.tags.length)
      && (!S.newOnly || fresh.has(c.id))
      && tags.every((tok) => (tok.endsWith('/') ? c.tags.some((t) => tagCat(t) === tok.slice(0, -1)) : c.tags.includes(tok)))
      && S.gtagFilter.every((k) => c.gtags.some((t) => catKey(t) === k)));
    // Prix (cote de ton meilleur exemplaire ; sans cote fiable, à la fin) : à égalité, par rareté.
    if (isPriceSort(S.sort)) return sortByPrice(out, (c) => cardPrice(c, ownCote(c)), priceDir(S.sort), SORTERS.rarity);
    return out.sort(SORTERS[S.sort] || SORTERS.rarity);
  });
  const visibleCards = computed(() => filtered.value.slice(0, S.limit));

  // Collections à compléter du serveur (targets), toutes dans « Mes collections » : créées par le favori depuis la
  // Collection globale du jeu, à la main dans « Nouvelle collection », depuis une catégorie de Wikipédia (source
  // « wp:<nom> » : `cat`, signalée « depuis la catégorie Wikipédia »), depuis les liens d'une page de Wikipédia (source
  // « links:<titre> » : `page` = le titre, signalée « depuis la page Wikipédia « … » » ; « links:<titre>#<colonne> » quand
  // elle est faite de la colonne clé des tableaux de la page : `column` = le libellé de la colonne, et elle est ordonnée
  // comme les lignes des tableaux ; un titre de Wikipédia ne contient jamais « # ») ; « links:<titre>#<colonne>#§<sections> »
  // quand elle n'est faite que de certaines sections de ses tableaux (pageSelection : `sections` = « En France », « À
  // l'étranger › Allemagne + Suisse »…), ou jadis ajoutées du catalogue (sources wm:, wd, cat, links, def, catalog:… ou
  // aucune).
  const isCatSource = (s) => typeof s === 'string' && s.startsWith('wp:');
  const PAGE_SRC = 'links:';
  const pageSourceParts = (s) => {
    if (typeof s !== 'string' || !s.startsWith(PAGE_SRC) || s.length <= PAGE_SRC.length) return null;
    const rest = s.slice(PAGE_SRC.length);
    const k = rest.indexOf('#');
    if (k < 0) return { page: rest, column: null, sections: null };
    const col = rest.slice(k + 1);
    const j = col.indexOf('#§');
    return { page: rest.slice(0, k), column: (j < 0 ? col : col.slice(0, j)) || null, sections: j < 0 ? null : col.slice(j + 2) || null };
  };
  const pageOfSource = (s) => { const p = pageSourceParts(s); return p && p.page ? p.page : null; };
  const columnOfSource = (s) => { const p = pageSourceParts(s); return p ? p.column : null; };
  const sectionsOfSource = (s) => { const p = pageSourceParts(s); return p ? p.sections : null; };
  // Thèmes du catalogue (retiré le 2026-10-16) qui n'avaient pas d'ordre (`ordered: false` dans catalog.json, repris de
  // git 9a62469) : leurs collections (source « catalog:<id> ») restent de A à Z, sans numéros.
  const UNORDERED_CATALOG = new Set(['vaches', 'chiens', 'chats', 'chevaux', 'cepages', 'fromages', 'constellations', 'pays', 'departements', 'regions',
    'merveilles', 'moutons', 'poules', 'etats_usa', 'regions_italie', 'canada', 'capitales_ue', 'metro_paris', 'cathedrales', 'olympe', 'ballon_or',
    'beethoven', 'zodiaque']);
  const unorderedSource = (s) => typeof s === 'string' && s.startsWith('catalog:') && UNORDERED_CATALOG.has(s.slice(8));
  const collections = computed(() => {
    // Une catégorie n'a pas d'ordre à elle (celui de Wikipédia suit des clés de tri) : de A à Z, sans numéros ; les liens
    // d'une page non plus (lus de A à Z), sauf ceux de la colonne clé de ses tableaux (dans l'ordre des lignes).
    const all = targets.value.map((t) => {
      const cat = isCatSource(t.source);
      const page = pageOfSource(t.source);
      const column = page ? columnOfSource(t.source) : null;
      const sections = column ? sectionsOfSource(t.source) : null;
      return { kind: 'target', id: t.id, key: 'target:' + t.id, name: t.name, items: t.items, ordered: !cat && (!page || !!column) && !unorderedSource(t.source), cat, page, column, sections, t };
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
    // Colonne clé des tableaux d'une page : dans l'ordre des lignes, numérotée.
    return cv ? { kind: 'category', id: cv.key, key: 'cat:' + cv.key, name: cv.name, items: cv.items || [], ordered: !!(page && cv.col), cat: !page, page, cv } : null;
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
    } else if (isPriceSort(S.albumSort)) {
      // Ta carte : la cote de ton meilleur exemplaire ; une case vide : celle de « Pour la compléter ». À égalité (ou sans
      // cote), l'ordre de la collection (de A à Z si elle n'en a pas).
      const price = (s) => (s.card ? cardPrice(s.card, ownCote(s.card)) : s.item.status === 'ok' ? holePrice(wantedCote(s.item.title)) : NO_PRICE);
      slots = sortByPrice(slots, price, priceDir(S.albumSort), col.ordered ? (a, b) => a.i - b.i : (a, b) => COLLATOR.compare(a.item.title, b.item.title));
    } else if (!col.ordered) slots = slots.slice().sort((a, b) => COLLATOR.compare(a.item.title, b.item.title));
    return slots;
  });
  const albumFold = computed(() => {
    const col = activeAlbum.value;
    return foldSlots(albumSlots.value, !!col && showSections(col.ordered, S.albumSort, S.albumFilter), col ? col.key : '');
  });
  const visibleSlots = computed(() => albumFold.value.slots.slice(0, S.albumLimit));
  // Mode réorganisation : un objet figé par élément du brouillon ({k : indice dans base, item, card, thumb}), puis dans
  // l'ordre en cours. Un déplacement ne refait que la liste ; une relecture (cartes, qids résolus, vignettes arrivées)
  // garde l'objet d'un élément dont rien n'a changé (roInfoPrev) : les vignettes dont ni l'objet, ni le numéro, ni l'état
  // ne changent ne sont pas redessinées (RoTile), même à 3 000.
  let roInfoPrev = [];
  const reorderInfo = computed(() => {
    const r = S.reorder;
    if (!r) { roInfoPrev = []; return roInfoPrev; }
    void S.pv.version;
    const prev = roInfoPrev;
    roInfoPrev = r.base.map((item, k) => {
      const card = findCard(item);
      const info = card ? null : pvCache.get(item.title);
      const thumb = info ? info[1] : null;
      const old = prev[k];
      return old && old.item === item && old.card === card && old.thumb === thumb ? old : markRaw({ k, item, card, thumb });
    });
    return roInfoPrev;
  });
  const reorderSlots = computed(() => {
    const r = S.reorder;
    const info = reorderInfo.value;
    return r ? r.order.map((k) => info[k]).filter(Boolean) : [];
  });
  // Cartes qu'on peut sélectionner dans la vue ouverte (Maj+clic pour une plage).
  const selectableIds = computed(() => (S.tab === 'collections' && activeAlbum.value
    ? albumFold.value.slots.filter((s) => s.card).map((s) => s.card.id)
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
  // Favori court (téléphone, 2026-10-18 : le favori complet, ≈ 62 000 caractères, fait planter les navigateurs de
  // téléphone) : il pose la clé d'import dans window.__classeurCourt, puis charge le code du favori depuis le classeur
  // (GET /api/favori.js), à chaque clic : toujours la dernière version, mais il faut le réseau, et ce code vient du
  // classeur à chaque fois (le favori complet, lui, est figé à son installation).
  const shortFavoriUrl = computed(() => {
    if (!S.bm.importKey) return '';
    const code = `(function(){window.__classeurCourt={k:${JSON.stringify(S.bm.importKey)}};var s=document.createElement("script");`
      + `s.src=${JSON.stringify(location.origin + '/api/favori.js')}+"?t="+Date.now();`
      + 's.onerror=function(){alert("Le classeur ne répond pas : réessaie dans un instant.")};document.head.appendChild(s)})()';
    return 'javascript:' + encodeURI(code).replace(/#/g, '%23');
  });

  // ---------------------------------------------------------------- « Entre amis » : qui a quoi
  const sharing = () => !!(S.me && S.me.shared);
  const sharingTargets = () => !!(S.me && S.me.shared && S.me.shared_targets); // et ses collections à compléter
  const friendName = (f) => f.name || 'Sans prénom';
  // Pseudo dans le jeu d'un membre (s'il l'a donné, Réglages), en info-bulle de son prénom : partout où il apparaît, sans
  // l'alourdir (la ligne de « Entre amis » et le haut de son classeur le montrent en clair).
  const pseudoTip = (f) => (f && f.pseudo ? 'Pseudo dans le jeu : ' + f.pseudo : null);
  const friendWho = (f) => h('span', { class: { 'has-pseudo': !!(f && f.pseudo) }, title: pseudoTip(f) }, friendName(f));
  const nameWithPseudo = (f) => friendName(f) + (f && f.pseudo ? ` (${f.pseudo})` : '');
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
      if (c) out.push({ id: f.id, name: f.name, pseudo: f.pseudo, count: c.count || 1, rarity: c.rarity });
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
    // Prix : sa cote (venue avec ses cartes), tous ses exemplaires dans la rareté de sa carte ; à égalité, par rareté.
    if (isPriceSort(S.friends.sort)) return sortByPrice(list, (c) => cardPrice(c, c.v), priceDir(S.friends.sort), FRIEND_SORTS.rarity);
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
    // Valeur de ses cartes de cette collection (comme celle de son classeur, friendWorths), chaque carte une fois.
    const seen = new Set();
    let value = 0;
    let priced = 0;
    for (const it of t.items) {
      const c = index.findCard(it);
      if (c) {
        own++; byR[c.rarity] = (byR[c.rarity] || 0) + 1; sample.push(c);
        if (!seen.has(c.id)) { seen.add(c.id); const x = cardWorth(c, c.v); if (x.priced) { priced++; value += x.value; } }
        continue;
      }
      const m = findCard(it);
      if (m) { help++; if ((Number(m.count) || 1) >= 2) helpDup++; }
    }
    sample.sort((a, b) => (RANK[a.rarity] ?? 9) - (RANK[b.rarity] ?? 9) || (b.image ? 1 : 0) - (a.image ? 1 : 0));
    return { own, total: t.items.length, byR, sample: sample.slice(0, 3), help, helpDup, value, priced, cards: seen.size };
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
    } else if (isPriceSort(S.friends.albumSort)) {
      // Sa carte : sa cote (venue avec ses cartes) ; une case vide : la moins chère des cotes connues de la carte (la tienne
      // si tu l'as, sinon celle d'une carte qui te manque).
      const price = (s) => (s.card ? cardPrice(s.card, s.card.v) : holePrice(s.mine ? ownCote(s.mine) : wantedCote(s.item.title)));
      slots = sortByPrice(slots, price, priceDir(S.friends.albumSort), fa.ordered ? (a, b) => a.i - b.i : (a, b) => COLLATOR.compare(a.item.title, b.item.title));
    } else if (!fa.ordered) slots = slots.slice().sort((a, b) => COLLATOR.compare(a.item.title, b.item.title));
    return slots;
  });

  // ================================================================ actions
  let noticeSeq = 0;
  // action : {label, run} facultatif, un bouton dans le message (« Annuler ») ; le message reste alors 10 s.
  function notify(text, error, action) {
    const id = ++noticeSeq;
    S.notice = { id, text, error: !!error, action: action || null };
    setTimeout(() => { if (S.notice && S.notice.id === id) S.notice = null; }, error ? 12000 : action ? 10000 : 6000);
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
    routeOn = false; // l'adresse ne suit plus l'état jusqu'à ce que boot l'ait appliquée
    cardsRev = null;
    cardsGen++;
    cardsJob = Promise.resolve();
    Object.assign(S, { me: null, fetchedAt: null, loadingCards: false, openId: null, openMissing: null, modal: null, editor: null, confirm: null, tagEdit: null, notice: null, switchAsk: null, tab: 'collections', album: null, reorder: null, autoBusy: null,
      q: '', tagFilter: [], gtagFilter: [], untaggedOnly: false, newOnly: false, rarities: [], limit: PAGE, lastClicked: null, bulkTag: '', bulkError: '' });
    S.selected.clear();
    S.refresh.msg = '';
    S.refresh.error = false;
    S.refresh.warn = false;
    S.bm.importKey = null;
    Object.assign(syncLog, { entries: null, error: '' }); // journal des synchros : celui de l'autre classeur
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
    autoSaid.clear(); // avertissements de l'ajout automatique : ceux de l'autre classeur
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
    // Dernière synchro connue avant cette réponse (undefined : première lecture du compte, rien à annoncer).
    const lastBefore = S.me ? (S.me.last_sync ? S.me.last_sync.at : null) : undefined;
    S.me = me;
    noteLastSync(lastBefore, me.last_sync);
    if (S.key && me.user) remember(S.key, me.user.name || '');
    chatNote(me); // dernier message du chat (badge des non-lus)
    // Préférences changées ici (savePrefs) avant la réponse, ou encore en route à l'envoi : la réponse peut les précéder,
    // elle ne les remplace pas.
    if (me.prefs !== undefined && pg === prefsGen && !prefsPending) S.prefs = normPrefs(me.prefs);
    return me;
  }
  // Carte reçue du serveur : tags du classeur et tags du jeu (gtags, posés par le joueur dans wiki-masters.com, avec leurs
  // couleurs gtagc) en tableaux ; _k = texte de la recherche (titre, catégorie du jeu, tags du jeu).
  function prepCard(c) {
    const tags = Array.isArray(c.tags) ? c.tags.map(String) : [];
    const gtags = Array.isArray(c.gtags) ? c.gtags.map(String) : [];
    const gtagc = c.gtagc && typeof c.gtagc === 'object' && !Array.isArray(c.gtagc) ? c.gtagc : null;
    return markRaw({ ...c, title: String(c.title || ''), tags, gtags, gtagc, _k: fold(`${c.title || ''} ${c.category || ''} ${gtags.join(' ')}`) });
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
    if (S.openId && !cardById.value.has(S.openId)) { S.openId = null; routeSync(); }
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
  // Ajout automatique d'une collection (`auto` de GET /api/targets, voir « ajout automatique » plus bas) : {rules, skip}
  // s'il a au moins une règle bien formée, sinon null.
  const AUTO_KINDS = new Set(['gtag', 'cat', 'tag']);
  const normAuto = (a) => {
    if (!a || typeof a !== 'object' || !Array.isArray(a.rules)) return null;
    const rules = a.rules.filter((r) => r && AUTO_KINDS.has(r.k) && typeof r.v === 'string' && r.v);
    return rules.length ? { rules, skip: Array.isArray(a.skip) ? a.skip.filter((x) => typeof x === 'string') : [] } : null;
  };
  const prepTarget = (t) => markRaw({ ...t, items: Array.isArray(t.items) ? t.items : [], auto: normAuto(t.auto) });
  // Après chaque chargement des cartes : qids manquants (toutes les collections), propositions d'après les
  // catégories de tes cartes (sauf si tu les as masquées), ajout automatique des nouvelles cartes aux collections qui ont
  // des règles (runAutoAdd).
  function afterCards() {
    resolveQids(collections.value.all.flatMap((c) => c.items), false, 'all'); // à part de celle de l'album ouvert
    if (!S.prefs.hide_proposals) computeProposals(false);
    loadMarket(false); // valeur et cotes (les cartes ont pu changer)
    runAutoAdd();
  }
  async function loadTargets() {
    const gen = cardsGen;
    const r = await api('GET', '/api/targets');
    if (gen !== cardsGen) return; // collections de l'ancien classeur : écartées
    targets.value = (Array.isArray(r.targets) ? r.targets : []).map(prepTarget);
    if (S.album && S.album.kind === 'target' && !targets.value.some((t) => t.id === S.album.id)) { S.album = null; routeSync(); }
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
    clearRoute(); // l'adresse était celle de l'autre classeur
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
    const route = parseRoute(location.hash); // adresse de la vue (#/…), appliquée avant les données : voir la fin
    applyRoute(route);
    routeOn = true;
    routeSync();
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
    if (!cards.value.length && S.tab === 'collections' && !S.album) { openFavori(); routeSync(); }
    // Adresse arrivée avant les données : fiche de la carte (si l'on n'a pas changé de vue entre-temps), lien mort signalé.
    const wantCard = route.p.get('carte');
    if (wantCard && !S.openId && !S.modal && S.tab === route.tab) {
      if (cardById.value.has(wantCard)) openCardById(wantCard); else notify("La carte de cette adresse n'est plus dans ton classeur.", true);
    }
    if (route.album && route.album.kind === 'target' && !targets.value.some((t) => t.id === route.album.id)) {
      notify("La collection de cette adresse n'existe plus : elle a peut-être été supprimée.", true);
    }
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

  // ---------------------------------------------------------------- journal des synchros
  // GET /api/sync-log : les dernières synchros du classeur, réussies ou non (favori, favori relié, script Tampermonkey,
  // cookie), avec leur message ; lu à l'ouverture de « Mettre à jour », quand une synchro arrive pendant qu'il est
  // ouvert (last_sync de GET /api/me change) et sur « Actualiser ».
  const syncLog = reactive({ entries: null, busy: false, error: '' });
  async function loadSyncLog() {
    if (syncLog.busy || !S.key) return;
    const gen = cardsGen;
    syncLog.busy = true;
    syncLog.error = '';
    try {
      const r = await api('GET', '/api/sync-log');
      if (gen === cardsGen) syncLog.entries = Array.isArray(r.entries) ? r.entries : [];
    } catch (e) {
      // Classeur plus ancien, sans journal (404) : rien à montrer.
      if (gen === cardsGen) {
        if (e.status === 404) syncLog.entries = [];
        else syncLog.error = e.message;
      }
    } finally {
      syncLog.busy = false;
    }
  }
  const VIA_LABEL = { clic: 'Favori', relie: 'Favori relié', script: 'Script Tampermonkey', cookie: 'Cookie' };
  const KIND_LABEL = { full: 'lecture complète', quick: 'synchro rapide' };
  const RESULT_LABEL = { ok: 'réussie', warn: 'incomplète', error: 'échec' };
  // « Favori relié · synchro rapide » (un favori d'avant le journal n'envoie pas son chemin : « Favori »).
  const syncKind = (via, kind) => `${VIA_LABEL[via] || 'Favori'} · ${KIND_LABEL[kind] || 'synchro'}`;
  // Heure d'une synchro : « aujourd'hui à 14:32 », « hier à 09:10 », sinon « 16 octobre à 14:32 ».
  function syncWhen(iso) {
    const d = dateOf(iso);
    if (!d) return '';
    const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return `aujourd'hui à ${hm}`;
    if (d.toDateString() === new Date(now.getTime() - 86400000).toDateString()) return `hier à ${hm}`;
    return `${dateDay(iso)} à ${hm}`;
  }
  // Version du favori servi (bookmarklet.js, « var VERSION = 3; ») ; la dernière synchro faite par un favori (ou un
  // script) plus ancien le fait remplacer.
  const favoriVersion = computed(() => { const m = S.bm.src && S.bm.src.match(/var VERSION = (\d+);/); return m ? Number(m[1]) : null; });
  const oldFavori = computed(() => {
    const v = favoriVersion.value;
    const last = (syncLog.entries || []).find((x) => (x.data || {}).via !== 'cookie' && (x.result !== 'error' || (x.data || {}).client));
    return !!(v && last && !(Number((last.data || {}).v) >= v));
  });
  // Dernière ligne du journal (GET /api/me) : un nouvel échec du favori (cliqué dans un autre onglet, ou relié) est
  // annoncé ; « Mettre à jour » ouvert relit le journal. Les échecs du rafraîchissement par cookie s'affichent déjà.
  function noteLastSync(before, ls) {
    if (!ls || ls.at === before) return;
    // Une synchro du favori depuis le dernier rafraîchissement par cookie : son message, dépassé, laisse la place.
    if (before !== undefined && ls.via !== 'cookie' && !S.refresh.running) Object.assign(S.refresh, { msg: '', error: false, warn: false });
    if (before !== undefined && ls.result === 'error' && ls.via !== 'cookie' && S.modal !== 'sync') notify(`La dernière synchro du favori a échoué : ${ls.message}`, true);
    if (S.tab === 'maj') loadSyncLog();
  }

  // ---------------------------------------------------------------- rafraîchissement
  function importSummary(res) {
    if (res.superseded) return `une synchro plus récente est déjà passée : ton classeur est à jour${Number.isInteger(res.count) ? ` (${cards$(res.count)})` : ''}`;
    const n = Array.isArray(res.new_ids) ? res.new_ids.length : 0;
    const parts = [cards$(res.count)];
    if (n) parts.push(`${fmt(n)} ${plural(n, 'nouvelle', 'nouvelles')}`);
    else parts.push('aucune nouvelle');
    const removed = Number(res.removed) || 0;
    if (removed) parts.push(`${fmt(removed)} ${plural(removed, 'retirée', 'retirées')}`);
    // Entrées du jeu ignorées par le serveur (sans titre, rareté inconnue, champs trop longs).
    const skipped = Number(res.skipped) || 0;
    if (skipped > 0) parts.push(`${fmt(skipped)} ${plural(skipped, 'ignorée', 'ignorées')} (sans titre ou rareté inconnue)`);
    return parts.join(' · ');
  }
  // Lecture complète non vérifiée (complete:false) : ce qui s'est passé et quoi faire ; aucune carte n'a été retirée.
  function incompleteNote(res) {
    const kept = Number(res.kept) || 0;
    return (res.moved ? ' · ta collection a bougé pendant la lecture' : ' · il en manque par rapport au total du jeu')
      + ` : aucune carte retirée${kept ? ` (${fmt(kept)} ${plural(kept, 'non vue, gardée', 'non vues, gardées')})` : ''}, relance dans un moment`;
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
    Object.assign(S.sync, { done: false, msg: '', before: S.me ? S.me.fetched_at || null : null, expired: !!(sess.has_cookie && sess.expired), hasFavori: !!storedImportKey() || !!(S.me && S.me.has_import_key), others: {}, elsewhere: null,
      failed: '', lastAt: S.me && S.me.last_sync ? S.me.last_sync.at : null });
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
        // Échec signalé par le favori depuis l'ouverture de la fenêtre (session du jeu, limite de lectures…) : dit ici.
        const ls = S.me && S.me.last_sync;
        if (ls && ls.at !== S.sync.lastAt && ls.result === 'error' && ls.via !== 'cookie') S.sync.failed = ls.message;
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
          // Lecture incomplète (rien de retiré) : le journal dit quoi faire.
          const last = S.me.last_sync;
          if (last && last.result === 'warn') S.sync.msg += ' ' + last.message;
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
      let run = null; // jeton de cette lecture (page 0) : une autre lecture commencée entre-temps (autre onglet) l'arrête
      for (let guard = 0; guard < 5000; guard++) {
        // Relecture complète demandée (onglet « Mettre à jour ») : jamais de synchro rapide.
        res = await api('POST', '/api/refresh', page === 0 ? (S.me && S.me.next_full ? { page, full: true } : { page }) : run ? { page, run } : { page });
        if (res.done) break;
        if (page === 0 && typeof res.run === 'string') run = res.run;
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
      if (res.complete === false && !res.superseded) {
        S.refresh.warn = true;
        S.refresh.msg += incompleteNote(res);
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
      if (S.tab === 'maj') loadSyncLog();
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
    if (tab === 'reglages') Object.assign(S.settings, { name: (S.me && S.me.user && S.me.user.name) || '', busy: false, error: '', saved: false,
      pseudo: (S.me && S.me.user && S.me.user.pseudo) || '', pBusy: false, pError: '', pSaved: false });
    if (tab === 'maj') prepareFavori();
    if (tab === 'amis') loadFriends(true);
    if (tab === 'marche') loadMarket(Date.now() - M.at > 20000); // les cotes ont pu être relues dans le jeu entre-temps
    toTop();
  }
  function resetFilters() {
    Object.assign(S, { q: '', tagFilter: [], gtagFilter: [], untaggedOnly: false, newOnly: false, rarities: [] });
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
  // Tag du jeu (clé repliée) : clic simple, lui seul (ou plus aucun) ; Ctrl/⌘+clic : combiner. Les tags du classeur
  // choisis restent (les deux se combinent).
  function toggleGtagFilter(key, ev) {
    if (ev && (ev.ctrlKey || ev.metaKey)) S.gtagFilter = S.gtagFilter.includes(key) ? S.gtagFilter.filter((x) => x !== key) : [...S.gtagFilter, key];
    else S.gtagFilter = S.gtagFilter.length === 1 && S.gtagFilter[0] === key ? [] : [key];
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
    S.sepError = '';
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
    S.sepError = '';
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
  // Ligne de l'éditeur d'une collection : un titre ou une adresse fr.wikipedia.org ; « # » devant (interdit dans un titre de
  // Wikipédia, donc sans ambiguïté) en fait un intercalaire, qui ouvre une section (SEP_MARK : ce qu'écrit openEditor).
  const SEP_LINE = /^#\s*/;
  const SEP_MARK = '# ';
  function parseLine(line) {
    let s = String(line || '').trim().replace(SEP_LINE, '');
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
  // t : la collection à modifier (éditeur « Liste d'articles » seul) ; sinon la fenêtre « Nouvelle collection », un onglet
  // par façon de créer (NEW_MODES), ouverte sur mode (par défaut le premier).
  function openEditor(t, mode) {
    stopCatSearch();
    S.editor = {
      id: t ? t.id : null,
      name: t ? t.name : '',
      text: t ? t.items.map((i) => (i.sep ? SEP_MARK : '') + i.title).join('\n') : '',
      source: t ? t.source || null : null,
      known: markRaw(new Map(t ? t.items.map((i) => [i.title, i]) : [])),
      base: markRaw(t ? t.items.map((i) => i.title) : []), // titres à l'ouverture (exclusions de l'ajout automatique)
      busy: false, progress: '', error: '', issues: null,
      mode: t ? 'liste' : NEW_MODES.some((m) => m[0] === mode) ? mode : NEW_MODES[0][0],
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
    const seps = new Set(); // titres marqués « # » (intercalaires), sur au moins une de leurs lignes
    const bad = [];
    ed.text.split('\n').forEach((line, i) => {
      const r = parseLine(line);
      if (r == null) return;
      if (typeof r === 'object') { bad.push(`ligne ${i + 1} : ${r.error}`); return; }
      if (SEP_LINE.test(line.trim())) seps.add(r);
      if (!seen.has(r)) { seen.add(r); titles.push(r); }
    });
    if (bad.length) { ed.error = 'À corriger : ' + bad.slice(0, 4).join(' ; ') + (bad.length > 4 ? ' ; …' : '.'); return; }
    if (!titles.length) { ed.error = 'Ajoute au moins un article, un par ligne.'; return; }
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
      const kept = new Map();
      let redirected = 0;
      for (const t of titles) {
        const it = ed.known.get(t);
        if (!it) continue;
        if (it.title !== t) redirected++;
        // Deux lignes qui mènent au même article (redirection) : un seul élément, intercalaire si l'une des deux l'est.
        if (kept.has(it.title)) { if (seps.has(t)) kept.get(it.title).sep = true; continue; }
        const item = { title: it.title, description: it.description || null, image: it.image || null, status: it.status || 'ok' };
        if (it.qid) item.qid = it.qid;
        if (realRarity(it)) item.rarity = it.rarity; // rareté du jeu (collection créée par le favori) : gardée
        if (seps.has(t)) item.sep = true;
        else if (it.sep === true || it.sep === false) item.sep = false; // « # » retiré (ou déjà décoché) : choix gardé
        kept.set(it.title, item);
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
      // Collection qui a un ajout automatique : les titres retirés à la main sont exclus (jamais rajoutés), ceux remis à
      // la main ne le sont plus.
      const cur = ed.id ? autoOf(targets.value.find((x) => x.id === ed.id)) : null;
      if (cur) {
        const now = new Set(items.map((i) => titleKey(i.title)));
        const before = new Set(ed.base.map(titleKey));
        const skipped = new Set(cur.skip.map(titleKey));
        const add = ed.base.filter((x) => !now.has(titleKey(x)));
        const del = items.filter((i) => !before.has(titleKey(i.title)) && skipped.has(titleKey(i.title))).map((i) => i.title);
        if (add.length || del.length) body.auto_skip = { ...(add.length ? { add } : {}), ...(del.length ? { del } : {}) };
      }
      const r = await saveTargetApi(body);
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
  // Intercalaire changé depuis l'album (case de la fiche) : la collection renvoyée telle quelle (POST /api/targets/save,
  // éléments rangés par le serveur), avec ou sans `sep` sur l'élément n° index. Refusé : la case revient à l'état d'avant.
  async function setSep(t, index, on, input) {
    if (S.sepBusy) return;
    const gen = cardsGen;
    S.sepBusy = t.id;
    S.sepError = '';
    try {
      const items = t.items.map((it, j) => {
        if (j !== index) return it;
        const { sep, ...rest } = it;
        return { ...rest, sep: !!on }; // décochée : sep: false, jamais recochée par la détection automatique
      });
      const body = { id: t.id, name: t.name, items };
      if (t.source) body.source = t.source;
      const r = await saveTargetApi(body);
      if (gen !== cardsGen) return; // classeur changé entre-temps
      if (r.target) upsertTarget(r.target); else await loadTargets();
    } catch (e) {
      if (gen !== cardsGen) return;
      S.sepError = e.message;
      if (input) input.checked = !on;
    } finally {
      S.sepBusy = null;
    }
  }
  // Retirer une carte d'une collection (bouton de la fiche ouverte depuis l'album, demande du 2026-10-18) : la collection
  // renvoyée sans l'élément n° index ; la fiche se ferme et le message propose « Annuler » (l'élément remis à sa place,
  // avec tous ses champs). Mêmes garde-fous que la case « Intercalaire » (S.sepBusy, S.sepError).
  // Intercalaires probables (2026-10-18, « vérifier si une carte peut être considérée intercalaire et cocher la case
  // automatiquement ») : dans une collection ordonnée, un élément dont le titre nomme la nature des éléments qui le
  // suivent : au moins 2 des 12 suivants (jusqu'au prochain intercalaire), dont l'un des 2 premiers, ont une description
  // qui commence par ce titre (« Continent », puis « continent situé… », « continent terrestre… » ; « Sous-continent »,
  // puis « sous-continent nord-américain… »), sans que la sienne commence aussi par ce titre. Sur les descriptions déjà
  // gardées, sans requête ; jamais un élément déjà décidé (sep: true, ou sep: false = décoché par toi).
  const sepWords = (s) => fold(String(s || '').replace(/\s*\([^)]*\)\s*$/, '')).replace(/[^a-z0-9-]+/g, ' ').trim().split(' ').filter(Boolean).map(singular);
  function sepCandidates(items) {
    const out = [];
    for (let i = 0; i < items.length - 2; i++) {
      const it = items[i];
      if (it.sep === true || it.sep === false || (it.status && it.status !== 'ok')) continue;
      const w = sepWords(it.title).join(' ');
      if (w.length < 4 || w.split(' ').length > 3) continue;
      const starts = (d) => { const x = sepWords(d).join(' '); return x === w || x.startsWith(w + ' '); };
      if (starts(it.description)) continue; // elle-même de cette nature : un membre, pas un intercalaire
      let n = 0;
      let near = false;
      for (let j = i + 1; j < items.length && j <= i + 12; j++) {
        if (items[j].sep === true) break;
        if (starts(items[j].description)) { n++; if (j <= i + 2) near = true; }
      }
      if (n >= 2 && near) out.push(i);
    }
    return out;
  }
  // Ouverture de l'album d'une de tes collections ordonnées : ses intercalaires probables sont cochés (une requête) ; le
  // message propose « Annuler » (ils passent à sep: false : jamais recochés). Une fois par état de la collection.
  const sepChecked = new Set();
  async function autoSeps(t) {
    const sig = t.id + ':' + (t.updated_at || '') + ':' + t.items.length;
    if (sepChecked.has(sig) || S.sepBusy) return;
    sepChecked.add(sig);
    const idx = sepCandidates(t.items);
    if (!idx.length) return;
    const gen = cardsGen;
    const pick = new Set(idx);
    const titles = idx.map((i) => t.items[i].title);
    S.sepBusy = t.id;
    try {
      await saveItemsOf(t, t.items.map((it, j) => (pick.has(j) ? { ...it, sep: true } : it)));
      if (gen !== cardsGen) return;
      const list = andList(titles.map((x) => `« ${x} »`));
      notify(`${list} ${titles.length > 1 ? 'cochées comme intercalaires' : 'cochée comme intercalaire'} dans « ${t.name} » (détection automatique).`, false,
        { label: 'Annuler', run: () => undoAutoSeps(t.id, titles) });
    } catch (e) {
      sepChecked.delete(sig); // réessayé à la prochaine ouverture
    } finally {
      S.sepBusy = null;
    }
  }
  async function undoAutoSeps(id, titles) {
    const t = targets.value.find((x) => x.id === id);
    if (!t) return;
    const set = new Set(titles);
    try {
      await saveItemsOf(t, t.items.map((it) => (set.has(it.title) ? { ...it, sep: false } : it)));
      notify(titles.length > 1 ? 'Intercalaires décochés : ils ne seront plus cochés automatiquement.' : 'Intercalaire décoché : il ne sera plus coché automatiquement.');
    } catch (e) {
      notify(e.message, true);
    }
  }
  watch(() => {
    const col = S.tab === 'collections' && !S.reorder ? activeAlbum.value : null;
    return col && col.kind === 'target' && col.ordered && col.t ? col.t : null;
  }, (t) => { if (t) autoSeps(t); });
  // extra : champs en plus (auto_skip : exclusions de l'ajout automatique).
  async function saveItemsOf(t, items, extra) {
    const body = { id: t.id, name: t.name, items, ...extra };
    if (t.source) body.source = t.source;
    const r = await saveTargetApi(body);
    if (r.target) upsertTarget(r.target); else await loadTargets();
  }
  async function removeFromCollection(t, index) {
    if (S.sepBusy) return;
    const gen = cardsGen;
    const item = t.items[index];
    S.sepBusy = t.id;
    S.sepError = '';
    // Collection qui a un ajout automatique : la carte retirée est exclue (jamais rajoutée) ; « Annuler » lève l'exclusion.
    const auto = !!autoOf(t);
    try {
      await saveItemsOf(t, t.items.filter((_, j) => j !== index), auto ? { auto_skip: { add: [item.title] } } : null);
      if (gen !== cardsGen) return;
      closeCard();
      notify(auto ? `« ${item.title} » retirée de « ${t.name} » : elle n'y sera plus ajoutée automatiquement.` : `« ${item.title} » retirée de « ${t.name} ».`, false,
        { label: 'Annuler', run: () => restoreItem(t.id, index, item) });
    } catch (e) {
      if (gen === cardsGen) S.sepError = e.message;
    } finally {
      S.sepBusy = null;
    }
  }
  async function restoreItem(id, index, item) {
    const t = targets.value.find((x) => x.id === id);
    if (!t) { notify("Cette collection n'existe plus : rien à remettre.", true); return; }
    const gen = cardsGen;
    const items = t.items.slice();
    items.splice(Math.min(index, items.length), 0, item);
    try {
      await saveItemsOf(t, items, autoOf(t) ? { auto_skip: { del: [item.title] } } : null);
      if (gen === cardsGen) notify(`« ${item.title} » remise dans « ${t.name} ».`);
    } catch (e) {
      if (gen === cardsGen) notify(e.message, true);
    }
  }
  // ---------------------------------------------------------------- « Réorganiser » (album d'une de tes collections)
  // Demande de l'utilisateur (2026-10-18) : « Il faudrait aussi qu'on puisse réorganiser les cartes d'une collection à la
  // main. » Dans l'album d'une de tes collections qui a un ordre, « Réorganiser » passe en mode réorganisation (tri
  // « Ordre », filtre « Toutes ») : tous les éléments, dans l'ordre, en vignettes réduites (ReorderGrid : léger jusqu'à
  // 3 000), avec les sections des intercalaires. Brouillon (S.reorder) : {id, name, base (les éléments de la collection à
  // l'entrée, tels que rangés, figés), order (l'ordre en cours : indices dans base, tableau figé remplacé à chaque
  // déplacement), dirty (différent de l'ordre de la collection), active (indice de l'élément choisi : barre du bas, « En
  // tête », « À la fin », « Position »), drag (élément en train d'être glissé), pos (position tapée), busy, error, said
  // et saidN (annonce pour les lecteurs d'écran, et son numéro), away (message « pas encore enregistré » déjà donné)}.
  // « Enregistrer l'ordre » : une seule requête POST /api/targets/save, les éléments tels quels (tous leurs champs) dans
  // le nouvel ordre ; « Annuler » n'envoie rien. Quitter l'album (ou l'onglet) avec un ordre modifié garde le brouillon :
  // un message le dit (« Y revenir »), l'album le reprend à son retour ; recharger ou fermer la page le demande d'abord
  // (beforeunload). Sans changement, le mode se referme simplement.
  const isIdentity = (order) => order.every((k, i) => k === i);
  function reorderOf(col) {
    const r = S.reorder;
    return r && col && col.kind === 'target' && r.id === col.id ? r : null;
  }
  // Ordre de `list` (des éléments) reporté sur `items` : indices dans items, dans l'ordre des titres de list, puis ceux
  // de items qui n'y sont pas, à la fin, dans leur ordre (deux éléments de même titre gardent leur ordre entre eux).
  function alignOrder(list, items) {
    const pool = new Map();
    items.forEach((it, i) => { const k = normTitle(it.title); if (pool.has(k)) pool.get(k).push(i); else pool.set(k, [i]); });
    const out = [];
    for (const it of list) { const q = pool.get(normTitle(it.title)); if (q && q.length) out.push(q.shift()); }
    const used = new Set(out);
    items.forEach((_, i) => { if (!used.has(i)) out.push(i); });
    return out;
  }
  function startReorder(col) {
    const r = S.reorder;
    if (r && r.id !== col.id && r.dirty) {
      openConfirm({
        title: 'Ordre non enregistré',
        text: `Le nouvel ordre de « ${r.name} » n'est pas enregistré. L'abandonner pour réorganiser « ${col.name} » ?`,
        ok: 'Abandonner et réorganiser',
        danger: true,
        run: () => { beginReorder(col.t); },
      });
      return;
    }
    beginReorder(col.t);
  }
  function beginReorder(t) {
    roDragEnd();
    S.selected.clear();
    if (S.openId || S.openMissing) closeCard();
    Object.assign(S, { albumSort: 'order', albumFilter: 'all' });
    S.reorder = { id: t.id, name: t.name, base: markRaw(t.items), order: markRaw(t.items.map((_, i) => i)), dirty: false, active: null, drag: null, pos: '',
      busy: false, error: '', said: '', saidN: 0, away: false };
    nextTick(() => { const el = document.getElementById('album-name'); if (el) el.focus(); });
  }
  function sayReorder(r, text) { r.said = text; r.saidN++; }
  // Déplace l'élément k (indice dans base) à la place `to` de l'ordre (0 = en tête), bornée ; false s'il n'a pas bougé.
  function moveTo(k, to) {
    const r = S.reorder;
    if (!r || r.busy) return false;
    const from = r.order.indexOf(k);
    if (from < 0) return false;
    const n = r.order.length;
    const dest = Math.max(0, Math.min(n - 1, to));
    const title = r.base[k].title;
    if (r.active !== k) Object.assign(r, { active: k, pos: '' });
    r.error = '';
    if (dest === from) {
      sayReorder(r, from === 0 && to <= 0 ? `« ${title} » est déjà en tête.` : from === n - 1 && to >= n - 1 ? `« ${title} » est déjà à la fin.` : `« ${title} » est déjà en position ${fmt(from + 1)}.`);
      return false;
    }
    const next = r.order.slice();
    next.splice(from, 1);
    next.splice(dest, 0, k);
    r.order = markRaw(next);
    r.dirty = !isIdentity(next);
    sayReorder(r, `« ${title} »${r.base[k].sep ? ' (intercalaire)' : ''} : position ${fmt(dest + 1)} sur ${fmt(n)}.`);
    return true;
  }
  // Lâché avant (after = false) ou après l'élément `target`.
  function dropAt(k, target, after) {
    const r = S.reorder;
    if (!r) return;
    const from = r.order.indexOf(k);
    let to = r.order.indexOf(target) + (after ? 1 : 0);
    if (from < to) to--;
    moveTo(k, to);
  }
  // Champ « Position » de la barre du bas (1 = en tête).
  function moveToTyped() {
    const r = S.reorder;
    if (!r || r.active == null) return;
    const n = r.order.length;
    const p = Number(String(r.pos).trim());
    if (!Number.isInteger(p) || p < 1 || p > n) { r.error = `Position : un nombre entier de 1 à ${fmt(n)}.`; sayReorder(r, r.error); return; }
    r.pos = '';
    const k = r.active;
    if (moveTo(k, p - 1)) showTile(k);
  }
  // Vignette de l'élément k montrée (déplacée au loin par la barre du bas).
  function showTile(k) {
    nextTick(() => { const li = document.querySelector(`li.ro-tile[data-k="${k}"]`); if (li && typeof li.scrollIntoView === 'function') li.scrollIntoView({ block: 'nearest' }); });
  }
  function focusReorderButton() {
    nextTick(() => { const b = document.getElementById('reorder-btn'); if (b) b.focus(); });
  }
  function cancelReorder() {
    const r = S.reorder;
    if (!r || r.busy) return;
    roDragEnd();
    S.reorder = null;
    focusReorderButton();
    if (r.dirty) notify(`Ordre de « ${r.name} » laissé tel quel : rien n'a été envoyé.`, false, { label: 'Reprendre', run: () => resumeReorder(r) });
  }
  // « Reprendre » (après « Annuler ») ou « Y revenir » (brouillon gardé) : le brouillon, reporté sur la collection
  // d'aujourd'hui, dans son album.
  function resumeReorder(r) {
    const t = targets.value.find((x) => x.id === r.id);
    if (!t) { notify("Cette collection n'existe plus.", true); return; }
    const cur = S.reorder;
    if (cur && cur.id !== r.id && cur.dirty) { notify(`Termine d'abord la réorganisation de « ${cur.name} » (« Enregistrer l'ordre » ou « Annuler »).`, true); return; }
    Object.assign(r, { drag: null, busy: false, away: false });
    S.reorder = r;
    if (t.items !== S.reorder.base) rebaseReorder(S.reorder, t);
    if (!(S.tab === 'collections' && S.album && S.album.kind === 'target' && S.album.id === r.id)) openAlbum('target', r.id);
    Object.assign(S, { albumSort: 'order', albumFilter: 'all' });
  }
  // Collection changée pendant la réorganisation (ailleurs dans la page) : l'ordre en cours est reporté sur ses éléments
  // d'aujourd'hui (par titre) ; ceux qui ont disparu sont retirés, les nouveaux viennent à la fin.
  function rebaseReorder(r, t) {
    roDragEnd();
    const next = alignOrder(r.order.map((k) => r.base[k]), t.items);
    Object.assign(r, { base: markRaw(t.items), order: markRaw(next), dirty: !isIdentity(next), active: null, drag: null, name: t.name });
  }
  async function saveOrder() {
    const r = S.reorder;
    if (!r || r.busy) return;
    roDragEnd();
    const t = targets.value.find((x) => x.id === r.id);
    if (!t) { S.reorder = null; notify("Cette collection n'existe plus.", true); return; }
    if (t.items !== r.base) rebaseReorder(r, t);
    if (!r.dirty) { S.reorder = null; focusReorderButton(); notify('Ordre inchangé : rien à enregistrer.'); return; }
    const before = t.items;
    const items = r.order.map((k) => r.base[k]);
    const gen = cardsGen;
    r.busy = true;
    r.error = '';
    try {
      await saveItemsOf(t, items);
      if (gen !== cardsGen) return;
      if (S.reorder === r) { S.reorder = null; focusReorderButton(); }
      notify(`Nouvel ordre de « ${t.name} » enregistré.`, false, { label: 'Annuler', run: () => restoreOrder(t.id, before) });
    } catch (e) {
      if (gen === cardsGen) r.error = e.message;
    } finally {
      r.busy = false;
    }
  }
  // « Annuler » du message après l'enregistrement : l'ordre d'avant, reporté sur la collection d'aujourd'hui.
  async function restoreOrder(id, before) {
    const t = targets.value.find((x) => x.id === id);
    if (!t) { notify("Cette collection n'existe plus : rien à remettre.", true); return; }
    const gen = cardsGen;
    try {
      await saveItemsOf(t, alignOrder(before, t.items).map((i) => t.items[i]));
      if (gen === cardsGen) notify(`Ordre d'avant remis dans « ${t.name} ».`);
    } catch (e) {
      if (gen === cardsGen) notify(e.message, true);
    }
  }
  // Collection sans ordre (de A à Z) : « Réorganiser… » dit pourquoi. Faite d'une catégorie ou d'une page de Wikipédia
  // (`wp:` / `links:` sans colonne), elle reste LA collection de cette source (une seule par compte : targets/save
  // remplace au lieu de doubler, « Catégories » propose de l'ouvrir au lieu d'en créer une autre) ; lui retirer sa source
  // pour lui donner un ordre casserait ce dédoublonnage (une seconde collection de la même catégorie deviendrait
  // possible) et son lien « Voir sur Wikipédia ». Proposé à la place : une copie à ordonner, sans source (mêmes éléments,
  // de A à Z pour commencer), l'originale restant telle quelle. Ancien thème du catalogue sans ordre (`catalog:<id>`) :
  // rien ne dépend de sa source (ni dédoublonnage, ni lien), elle passe en ordre manuel sur place (source retirée,
  // éléments dans l'ordre affiché), puis en mode réorganisation.
  function explainUnordered(col) {
    const t = col.t;
    const az = t.items.slice().sort((a, b) => COLLATOR.compare(a.title, b.title));
    const from = col.cat ? `la catégorie Wikipédia « ${catName(t.source)} »` : col.page ? `la page Wikipédia « ${col.page} »` : null;
    const cur = S.reorder;
    const lost = cur && cur.id !== t.id && cur.dirty ? ` Le nouvel ordre non enregistré de « ${cur.name} » sera abandonné.` : '';
    if (!from) {
      openConfirm({
        title: `Réorganiser « ${t.name} »`,
        text: `« ${t.name} » vient d'un ancien thème du catalogue sans ordre : elle s'affiche de A à Z, sans numéros. En ordre manuel, ses éléments gardent d'abord l'ordre affiché (de A à Z), numérotés, puis tu les places comme tu veux.${lost}`,
        ok: 'Passer en ordre manuel',
        run: async () => {
          const gen = cardsGen;
          const r = await saveTargetApi({ id: t.id, name: t.name, items: az });
          if (gen !== cardsGen) return;
          if (r.target) upsertTarget(r.target); else await loadTargets();
          const nt = targets.value.find((x) => x.id === t.id);
          if (nt) beginReorder(nt);
        },
      });
      return;
    }
    const suffix = ' (mon ordre)';
    const name = t.name.slice(0, 80 - suffix.length).trim() + suffix;
    openConfirm({
      title: `Réorganiser « ${t.name} »`,
      text: `« ${t.name} » est faite de ${from} : elle s'affiche de A à Z, sans numéros, et reste la collection de cette ${col.cat ? 'catégorie' : 'page'} (le classeur n'en crée jamais une seconde). Lui donner ton ordre couperait ce lien : elle ne se réorganise donc pas. À la place, une copie à ordonner : « ${name} », mêmes éléments (de A à Z pour commencer), sans lien avec ${col.cat ? 'la catégorie' : 'la page'} ; « ${t.name} » reste telle quelle.${lost}`,
      ok: 'Créer la copie et la réorganiser',
      run: async () => {
        const gen = cardsGen;
        const r = await saveTargetApi({ name, items: az });
        if (gen !== cardsGen) return;
        if (r.target) upsertTarget(r.target); else await loadTargets();
        const nt = r.target ? targets.value.find((x) => x.id === r.target.id) : null;
        if (!nt) return;
        openAlbum('target', nt.id);
        beginReorder(nt);
        notify(`Copie « ${name} » créée : place ses cartes, puis « Enregistrer l'ordre ».`);
      },
    });
  }
  // ---------------------------------------------------------------- « Fusionner avec… » (album d'une de tes collections)
  // Demande de l'utilisateur (2026-10-18) : « un bouton pour fusionner deux collections ». La collection d'où l'on part
  // reçoit la fusion (même id, même source, même place dans « Mes collections ») : ses éléments dans leur ordre, puis
  // ceux de l'autre qui n'y sont pas déjà (même titre, ou même qid : le sien, sinon celui que la page a résolu pour son
  // titre), une seule fois. Un élément déjà présent garde sa place et reçoit ce qui lui manque de l'autre (qid,
  // description, image, rareté du jeu, statut « ok »). Les intercalaires de l'autre sont gardés ; dans une collection qui
  // a un ordre (en tri « Ordre », un intercalaire commence une ligne), un intercalaire déjà présent passe sa marque à la
  // première carte ajoutée de sa section, et, sur demande, la première carte ajoutée en devient un. Une seule requête
  // (POST /api/targets/save), limites de targets.js vérifiées avant ; trop lourde avec les images mais pas sans : sans les
  // images (comme targets/from-game : la page retrouve les vignettes sur Wikipédia). Puis, si demandé, l'autre est
  // supprimée (POST /api/targets/delete) : un échec la laisse telle quelle, la fusion reste enregistrée.
  const mergeOrdered = (t) => !isCatSource(t.source) && !pageOfSource(t.source) && !unorderedSource(t.source);
  // Élément tel que targets.js le range : {title, description, image, status, qid?, rarity?, sep?}.
  function mergeCopy(it) {
    const out = { title: it.title, description: it.description || null, image: it.image || null, status: it.status || 'ok' };
    if (it.qid) out.qid = it.qid;
    if (realRarity(it)) out.rarity = it.rarity;
    if (it.sep === true) out.sep = true;
    return out;
  }
  // Champs que `b` (le même article) apporte à `a` : {champ: valeur}, vide si rien ne manque à `a`.
  function mergeGain(a, b, sameTitle) {
    const add = {};
    if (!a.qid && b.qid) add.qid = b.qid;
    if (!a.description && b.description) add.description = b.description;
    if (!a.image && b.image) add.image = b.image;
    if (!realRarity(a) && realRarity(b)) add.rarity = b.rarity;
    if (sameTitle && (a.status || 'ok') !== 'ok' && (b.status || 'ok') === 'ok') add.status = 'ok';
    return add;
  }
  // Fusion de deux listes d'éléments (opts : sections = la collection a un ordre, head = la première carte ajoutée devient
  // un intercalaire) : {items, added (éléments ajoutés), present (éléments de l'autre déjà là), enriched (éléments déjà là
  // complétés), headMoot (la première carte ajoutée est déjà un intercalaire), changed, noImages (images retirées pour
  // tenir dans 1,7 Mo), hadImages, kb (taille en Ko si elle ne tient pas), tooBig, own (tes cartes après)}.
  function mergeTargetItems(base, other, opts) {
    const qidOf = (it) => it.qid || (resolver ? resolver.known(it.title) || null : null);
    const items = base.slice();
    const byTitle = new Map();
    const byQid = new Map();
    const remember = (it, i) => {
      const k = titleKey(it.title);
      if (!byTitle.has(k)) byTitle.set(k, i);
      const q = qidOf(it);
      if (q && !byQid.has(q)) byQid.set(q, i);
    };
    items.forEach(remember);
    const added = [];
    const gains = new Map(); // élément déjà là (rang) -> champs reçus
    let present = 0;
    let carry = false; // intercalaire de l'autre déjà présent : la prochaine carte ajoutée ouvre sa section
    let headMoot = false;
    for (const it of other) {
      const k = titleKey(it.title);
      const q = qidOf(it);
      const j = byTitle.has(k) ? byTitle.get(k) : q && byQid.has(q) ? byQid.get(q) : -1;
      if (j >= 0) {
        present++;
        const add = mergeGain(items[j], it, titleKey(items[j].title) === k);
        if (Object.keys(add).length) {
          items[j] = { ...items[j], ...add };
          if (j < base.length) gains.set(j, new Set([...(gains.get(j) || []), ...Object.keys(add)]));
        }
        if (it.sep === true && opts.sections) carry = true;
        continue;
      }
      const item = mergeCopy(it);
      if (carry) item.sep = true;
      if (!added.length) {
        headMoot = item.sep === true;
        if (opts.sections && opts.head) item.sep = true;
      }
      carry = false;
      remember(item, items.length);
      items.push(item);
      added.push(item);
    }
    // Limite de targets.js (1,7 Mo d'éléments en JSON) ; trop lourde : sans les images, si elle tient.
    const fits = (s) => s.length * 3 <= TARGET_MAX_BYTES || utf8Length(s) <= TARGET_MAX_BYTES;
    let out = items;
    let json = JSON.stringify(out);
    let noImages = false;
    const hadImages = out.some((it) => it.image);
    if (!fits(json) && hadImages) {
      const bare = out.map((it) => (it.image ? { ...it, image: null } : it));
      json = JSON.stringify(bare);
      if (fits(json)) { out = bare; noImages = true; }
    }
    const tooBig = !noImages && !fits(json);
    // Complétés : ceux qui ont reçu un champ (une image retirée ensuite ne compte pas).
    let enriched = 0;
    for (const f of gains.values()) if (!noImages || [...f].some((x) => x !== 'image')) enriched++;
    return {
      items: out, added, present, enriched, headMoot, noImages, hadImages, tooBig,
      changed: out.length !== base.length || (out.some((it, i) => it !== base[i]) && JSON.stringify(out) !== JSON.stringify(base)),
      kb: tooBig ? Math.ceil(utf8Length(json) / 1024) : 0,
      own: out.reduce((n, it) => n + (findCard(it) ? 1 : 0), 0),
    };
  }
  // Fenêtre ouverte : la collection d'où l'on part (t), tes autres collections (de A à Z), celle choisie (o) et la fusion.
  const mergeInfo = computed(() => {
    const mg = S.merge;
    const t = mg ? targets.value.find((x) => x.id === mg.id) : null;
    if (!t) return null;
    const others = targets.value.filter((x) => x.id !== t.id).sort((a, b) => COLLATOR.compare(a.name, b.name));
    const o = mg.other ? others.find((x) => x.id === mg.other) || null : null;
    const sections = mergeOrdered(t);
    if (!o) return { t, others, o: null, sections };
    void qidVersion.value;
    return { t, others, o, sections, ...mergeTargetItems(t.items, o.items, { sections, head: mg.head }) };
  });
  function openMerge(t) {
    // « Supprimer l'autre » coché d'emblée : fusionner, c'est faire une collection de deux, et tous ses éléments seront
    // dans la collection fusionnée (le bouton le dit : « Fusionner et supprimer « … » »).
    S.merge = { id: t.id, other: null, name: t.name, drop: true, head: false, busy: false, error: '' };
    S.modal = 'merge';
  }
  function pickMerge(mg, id) {
    if (mg.busy || mg.other === id) return;
    mg.other = id;
    mg.error = '';
  }
  const mergeName = (mg) => String(mg.name || '').replace(/\s+/g, ' ').trim();
  async function saveMerge(mg) {
    if (mg.busy) return;
    const info = mergeInfo.value;
    if (!info) { mg.error = "Cette collection n'existe plus."; return; }
    const { t, o } = info;
    if (!o) { mg.error = `Choisis la collection à fusionner avec « ${t.name} ».`; return; }
    const name = mergeName(mg);
    if (!name) { mg.error = 'Donne un nom à la collection fusionnée.'; return; }
    if (name.length > 80) { mg.error = 'Le nom de la collection fait 80 caractères au plus.'; return; }
    if (info.tooBig) { mg.error = 'Collection fusionnée trop volumineuse : 1,7 Mo au plus.'; return; }
    const save = info.changed || name !== t.name;
    if (!save && !mg.drop) { mg.error = `Rien à fusionner : les éléments de « ${o.name} » sont déjà tous dans « ${t.name} ».`; return; }
    const gen = cardsGen;
    mg.busy = true;
    mg.error = '';
    try {
      if (save) {
        const body = { id: t.id, name, items: info.items };
        if (t.source) body.source = t.source; // la source de celle d'où l'on part (voir plus haut)
        // Ajout automatique : un élément ajouté par la fusion qui était exclu ne l'est plus (remis à la main).
        const auto = autoOf(t);
        if (auto) {
          const skipped = new Set(auto.skip.map(titleKey));
          const del = info.added.filter((it) => skipped.has(titleKey(it.title))).map((it) => it.title);
          if (del.length) body.auto_skip = { del };
        }
        let r;
        try {
          r = await saveTargetApi(body);
        } catch (e) {
          if (gen === cardsGen && S.merge === mg) mg.error = e.message;
          return;
        }
        if (gen !== cardsGen) return; // classeur changé entre-temps
        if (r.target) upsertTarget(r.target); else await loadTargets();
        if (gen !== cardsGen) return;
        // Fermée dès l'enregistrement : son aperçu, recalculé sur la collection fusionnée, dirait « Rien à ajouter ».
        if (S.merge === mg) closeModal();
      }
      // La fusion est enregistrée : l'autre n'est supprimée qu'ensuite. Un échec la laisse telle quelle (ses éléments sont
      // déjà dans la collection fusionnée) : rien n'est perdu, on le dit.
      let dropError = '';
      if (mg.drop) {
        try {
          await api('POST', '/api/targets/delete', { id: o.id });
          if (gen !== cardsGen) return;
          targets.value = targets.value.filter((x) => x.id !== o.id);
          if (S.album && S.album.kind === 'target' && S.album.id === o.id) S.album = null;
        } catch (e) {
          if (gen !== cardsGen) return;
          dropError = String(e.message || '').replace(/[.\s]+$/, '');
          // Seulement la suppression (rien à enregistrer) : la fenêtre reste ouverte, avec l'erreur.
          if (!save && S.merge === mg) { mg.error = `« ${o.name} » n'a pas pu être supprimée : ${dropError}.`; return; }
        }
      }
      if (S.merge === mg) closeModal();
      const n = info.added.length;
      const what = !save ? `Les éléments de « ${o.name} » étaient déjà tous dans « ${name} »`
        : `« ${o.name} » fusionnée dans « ${name} » : ${fmt(n)} ${plural(n, 'élément ajouté', 'éléments ajoutés')}`
          + (info.present ? `, ${fmt(info.present)} déjà ${plural(info.present, 'présent', 'présents')}` : '');
      if (dropError) notify(`${what}. Mais « ${o.name} » n'a pas pu être supprimée (${dropError}) : elle est restée telle quelle, supprime-la depuis son album.`, true);
      else notify(`${what}${mg.drop ? ` ; « ${o.name} » supprimée` : ''}.`);
    } finally {
      mg.busy = false;
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

  // ---------------------------------------------------------------- « Ajouter par tags du jeu » (album d'une collection)
  // Demande de l'utilisateur (2026-10-17) : « Alek a une collection maladie et doit avoir plein de cartes avec le tag
  // maladie qui ne sont pas dedans » ; précisée le 2026-10-18 : « je parlais [des tags] de wiki-masters, pas ceux en
  // automatique ». Ce sont les **tags du jeu** : les étiquettes que le joueur pose lui-même sur ses cartes dans
  // wiki-masters.com (gtags, lus par le favori depuis le 18 octobre 2026). Proposés d'abord, parmi ceux de tes cartes :
  // ceux dont le nom ressemble à celui de la collection (mots repliés : accents, casse, articles, pluriel et féminin
  // ignorés) — même nom (« Maladies » ↔ « Maladie », coché d'emblée), plus précis (« Maladies tropicales ») ou plus large
  // (« Maladie » pour « Maladies rares ») —, puis ceux que portent beaucoup de tes cartes déjà dans la collection (2 au
  // moins, et 20 % d'entre elles), et ceux choisis à la main. Puis, pareil, les **catégories du jeu** (card.category : le
  // texte que le jeu montre sous le titre, « maladie », « chanteuse barbadienne ») ; « portées par beaucoup de ses
  // éléments » compte la catégorie de ta carte, sinon la description de l'élément (celle du jeu pour une collection du
  // favori, celle de Wikidata sinon, le même texte en général : 2 au moins, et 20 % des éléments qui en ont une). Tes tags
  // du classeur ne viennent qu'en dernier, repliés, jamais cochés d'emblée (l'utilisateur ne les veut pas comme base).
  // Pour chaque proposition : tes cartes qui la portent et ne sont pas encore dans la collection (titre puis qid, comme
  // l'album ; une seule par titre). Les cartes cochées s'ajoutent à la fin de la collection (POST /api/targets/save,
  // éléments existants inchangés), sans doublon, dans les limites de targets.js ; une collection faite d'une catégorie ou
  // d'une page de Wikipédia garde sa source (comme avec « Modifier »).
  // Clés des propositions : « g:<tag du jeu replié> », « c:<catégorie repliée> » (catégorie du jeu), « t:<tag> » ou
  // « t:<Catégorie de tags>/ » (tags du classeur).
  const TAGADD_PAGE = 120; // cartes de l'aperçu affichées d'abord
  const TAGADD_MAX = 16; // propositions au plus par liste (celles du même nom et celles choisies à la main en plus)
  // targets.js : pas de nombre d'éléments maximal (2026-10-19), MAX_ITEMS_BYTES = 1,7 Mo d'éléments en JSON, envoyés en
  // morceaux au-delà de 600 Ko par envoi (saveTargetApi).
  const TARGET_MAX_BYTES = 1_700_000;
  // Articles lus au plus depuis une source (catégorie, page, requête Wikidata, proposition) : au-delà, ils ne tiendraient
  // pas dans 1,7 Mo (~70 octets par article au moins) ; l'album d'une source plus grande n'en montre que autant.
  const LIST_MAX = 20000;
  const titleKey = (t) => (Match ? Match.normTitle(t) : normTitle(t));
  // Octets UTF-8 d'un texte (la limite de targets.js se compte en octets).
  const utf8Length = (s) => {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n++;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i++; } else n += 3;
    }
    return n;
  };
  // Mots qui ne comptent pas dans un nom : ceux de la recherche par mots-clés (KW_STOP, plus bas), articles indéfinis et
  // possessifs (« Mes astéroïdes » = « astéroïde »). Mots déjà repliés (sans accents).
  const NAME_STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'en', 'et', 'au', 'aux', 'a', 'un', 'une', 'mes', 'ma', 'mon', 'tes', 'ta',
    'ton', 'ses', 'sa', 'nos', 'notre', 'vos', 'votre', 'leur', 'leurs']);
  // Féminin et masculin ramenés à une même forme (les catégories du jeu sont genrées : « chanteuse barbadienne » ↔
  // « Chanteurs », « maladie infectieuse » ↔ « infectieux »), sur des mots de 6 lettres au moins pour ne pas confondre de
  // mots courts (« mère » / « mer »). Après le singulier : « chanteurs » -> chanteur -> chanteu.
  const MASC = [['euse', 'eu'], ['eur', 'eu'], ['rice', 'eu'], ['enne', 'en'], ['aise', 'ais'], ['oise', 'ois'], ['aine', 'ain'], ['ande', 'and'],
    ['ere', 'er'], ['ive', 'if'], ['elle', 'el'], ['ale', 'al']];
  const masc = (w) => {
    if (w.length < 6) return w;
    for (const [a, b] of MASC) if (w.endsWith(a)) return w.slice(0, -a.length) + b;
    return w;
  };
  // Mots qui comptent dans un nom, repliés, au singulier, féminin ramené : « Chanteuses françaises » -> chanteu, francais.
  const nameWords = (s) => fold(String(s || '').replace(/œ/gi, 'oe').replace(/æ/gi, 'ae')).replace(/['’]/g, ' ').split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !NAME_STOP.has(w)).map((w) => masc(singular(w)));
  // Ressemblance de deux noms (listes de mots) : 3 = les mêmes mots, 2 = ceux de l'un sont tous dans l'autre, 0 sinon.
  function nameMatch(a, b) {
    if (!a.length || !b.length) return 0;
    const A = new Set(a);
    const B = new Set(b);
    const aInB = [...A].every((w) => B.has(w));
    const bInA = [...B].every((w) => A.has(w));
    return aInB && bInA ? 3 : aInB || bInA ? 2 : 0;
  }
  // Catégorie ou tag du jeu replié (casse, accents, espaces) : la clé qui regroupe tes cartes (les noms de tags du jeu
  // sont uniques par joueur sans tenir compte de la casse).
  const catKey = (s) => fold(String(s || '').replace(/\s+/g, ' ').trim());
  // Catégories du jeu de tes cartes : clé -> {key, label (texte du jeu, l'écriture la plus fréquente), words, n (tes
  // cartes)}.
  const gameCats = computed(() => {
    const m = new Map();
    for (const c of cards.value) {
      if (!c.category) continue;
      const k = catKey(c.category);
      if (!k) continue;
      const text = String(c.category).replace(/\s+/g, ' ').trim();
      let g = m.get(k);
      if (!g) m.set(k, (g = { key: k, label: text, words: nameWords(text), n: 0, seen: new Map() }));
      g.n++;
      const v = (g.seen.get(text) || 0) + 1;
      g.seen.set(text, v);
      if (v > g.seen.get(g.label)) g.label = text;
    }
    return m;
  });
  // Liste des catégories du jeu de tes cartes pour le champ « Un autre tag ou une autre catégorie du jeu » : les plus
  // portées d'abord.
  const gameCatList = computed(() => [...gameCats.value.values()].sort((a, b) => b.n - a.n || COLLATOR.compare(a.label, b.label)));
  // Couleur d'un tag du jeu (« #rrggbb » donnée par le jeu), sinon null ; style : la variable CSS de sa pastille.
  const GTAG_COLOR = /^#[0-9a-f]{3,8}$/i;
  const gtagStyle = (color) => (color && GTAG_COLOR.test(color) ? { '--gtag': color } : null);
  // Tags du jeu de tes cartes : clé repliée -> {key, label, words, n (tes cartes), color}.
  const gameTags = computed(() => {
    const m = new Map();
    for (const c of cards.value) {
      for (const t of c.gtags) {
        const k = catKey(t);
        if (!k) continue;
        let g = m.get(k);
        if (!g) m.set(k, (g = { key: k, label: t, words: nameWords(t), n: 0, color: null }));
        g.n++;
        const color = c.gtagc ? c.gtagc[t] : null;
        if (!g.color && typeof color === 'string' && GTAG_COLOR.test(color)) g.color = color;
      }
    }
    return m;
  });
  const gameTagList = computed(() => [...gameTags.value.values()].sort((a, b) => b.n - a.n || COLLATOR.compare(a.label, b.label)));
  // Propositions tirées d'un index (tags du jeu ou catégories du jeu : clé -> {key, label, words, color?}) pour une
  // collection dont le nom a les mots `words`. Rang : choisi à la main 4 (extra, clés « prefix… »), même nom 3, plus précis
  // 2 (moins il a de mots en plus, mieux il est classé), plus large 1,5, porté par beaucoup de ses éléments : la part de
  // ces éléments (inside : clé -> éléments, sur `known` ; 2 au moins et 20 %). out : clé -> titre -> ta carte hors de la
  // collection. {rows = [{key, label, color, kind, why: same | near | wide | manual | often, score, n, inside, cards}]
  // (celles qui ont des cartes à ajouter, les plus sûres d'abord ; TAGADD_MAX au plus, celles du même nom et choisies en
  // plus), more = propositions non montrées, full = ressemblantes ou choisies dont toutes tes cartes sont déjà dedans}.
  // ruled : clé -> règle de l'ajout automatique de la collection (toujours montrées, même sans carte à ajouter, rule: true).
  function propose(index, prefix, kind, words, extra, inside, known, out, ruled) {
    const W = new Set(words);
    const rel = new Map();
    for (const g of index.values()) {
      const s = nameMatch(g.words, words);
      if (s === 3) rel.set(g.key, { score: 3, why: 'same' });
      else if (s === 2) {
        const G = new Set(g.words);
        rel.set(g.key, [...W].every((w) => G.has(w)) ? { score: 2 - Math.min(G.size - W.size, 9) / 100, why: 'near' } : { score: 1.5, why: 'wide' });
      }
    }
    for (const x of extra) if (x.startsWith(prefix) && index.has(x.slice(prefix.length))) rel.set(x.slice(prefix.length), { score: 4, why: 'manual' });
    // Règles de l'ajout automatique : montrées même sans carte à ajouter, ou quand plus aucune de tes cartes ne porte ce
    // tag (libellé : celui de la règle), pour qu'on puisse les décocher.
    const ghost = new Map();
    for (const [key, rule] of ruled) {
      if (!key.startsWith(prefix)) continue;
      const k = key.slice(prefix.length);
      rel.set(k, { ...(rel.get(k) || { score: 4, why: 'manual' }), rule: true });
      if (!index.has(k)) ghost.set(k, { label: rule.v, color: null });
    }
    if (known >= 2) {
      for (const [k, n] of inside) {
        if (rel.has(k) || !index.has(k) || n < 2 || n < known * 0.2) continue;
        rel.set(k, { score: n / known, why: 'often', n });
      }
    }
    const rows = [];
    const full = [];
    for (const [k, r] of rel) {
      const g = index.get(k) || ghost.get(k);
      const row = { ...r, key: prefix + k, label: g.label, color: g.color || null, kind, inside: inside.get(k) || 0, cards: [...(out.get(k) || new Map()).values()] };
      if (row.cards.length || r.rule) rows.push(row); else if (r.why !== 'often') full.push(row);
    }
    rows.sort((a, b) => b.score - a.score || b.cards.length - a.cards.length || COLLATOR.compare(a.label, b.label));
    const sure = rows.filter((r) => r.why === 'same' || r.why === 'manual' || r.rule);
    const rest = rows.filter((r) => r.why !== 'same' && r.why !== 'manual' && !r.rule);
    const shown = rest.slice(0, Math.max(0, TAGADD_MAX - sure.length));
    return { rows: [...sure, ...shown], more: rest.length - shown.length, full };
  }
  // Propositions pour la collection de la fenêtre : game (tags du jeu ; « portés par beaucoup » : tes cartes de la
  // collection, own) et cats (catégories du jeu ; « portées par beaucoup » : ses éléments dont la catégorie est connue,
  // known), chacun {rows, more, full} (propose) ; tags = {rows, own} pour tes tags du classeur (repliés).
  const tagAddInfo = computed(() => {
    const ta = S.tagAdd;
    const t = ta ? targets.value.find((x) => x.id === ta.id) : null;
    if (!t) return null;
    void qidVersion.value;
    const titles = new Set();
    const qids = new Set();
    const inIds = new Set();
    const inside = new Map(); // catégorie du jeu -> éléments de la collection qui la portent (ta carte, sinon l'élément)
    let known = 0;
    for (const it of t.items) {
      titles.add(titleKey(it.title));
      if (it.qid) qids.add(it.qid);
      const c = findCard(it);
      if (c) inIds.add(c.id);
      const k = catKey(c && c.category ? c.category : it.description);
      if (k) { known++; inside.set(k, (inside.get(k) || 0) + 1); }
    }
    const qidOf = (c) => (resolver && qids.size ? resolver.known(c.title) || null : null);
    const isIn = (c) => inIds.has(c.id) || titles.has(titleKey(c.title)) || qids.has(qidOf(c));
    let own = 0;
    const tagsIn = new Map(); // tag (ou « Catégorie/ ») -> tes cartes de la collection qui le portent
    const gtagsIn = new Map(); // tag du jeu -> tes cartes de la collection qui le portent
    const catOut = new Map(); // catégorie du jeu -> titre -> ta carte hors de la collection
    const gtagOut = new Map(); // tag du jeu -> titre -> ta carte hors de la collection
    const tagged = []; // tes cartes hors de la collection qui ont au moins un tag du classeur
    const put = (map, k, c) => {
      let m = map.get(k);
      if (!m) map.set(k, (m = new Map()));
      const tk = titleKey(c.title);
      if (!m.has(tk)) m.set(tk, c);
    };
    for (const c of cards.value) {
      const gkeys = new Set(c.gtags.map(catKey).filter(Boolean));
      if (isIn(c)) {
        own++;
        const keys = new Set();
        for (const tg of c.tags) { keys.add(tg); keys.add(tagCat(tg) + '/'); }
        for (const k of keys) tagsIn.set(k, (tagsIn.get(k) || 0) + 1);
        for (const k of gkeys) gtagsIn.set(k, (gtagsIn.get(k) || 0) + 1);
        continue;
      }
      if (c.tags.length) tagged.push(c);
      for (const k of gkeys) put(gtagOut, k, c);
      const k = c.category ? catKey(c.category) : '';
      if (k) put(catOut, k, c);
    }
    const words = nameWords(t.name);
    const ruled = new Map((ta.rules || []).map((r) => [ruleKey(r), r])); // règles de l'ajout automatique à l'ouverture
    return {
      t, own, known,
      game: propose(gameTags.value, 'g:', 'gtag', words, ta.extra, gtagsIn, own, gtagOut, ruled),
      cats: propose(gameCats.value, 'c:', 'cat', words, ta.extra, inside, known, catOut, ruled),
      hasGtags: gameTags.value.size > 0,
      hasCats: gameCats.value.size > 0,
      tags: tagProposals(words, own, tagsIn, tagged, ruled),
    };
  });
  // Tes tags du classeur (en second, repliés) : même nom (sous-tag : « Sciences et nature/Maladie » pour « Maladies »),
  // nom proche, catégorie de tags de même nom ou proche (toute la catégorie), puis portés par beaucoup de tes cartes de la
  // collection (2 au moins, et 20 % d'entre elles).
  function tagProposals(words, own, tagsIn, tagged, ruled) {
    const rel = new Map();
    for (const { name } of tagList.value) {
      const s = nameMatch(nameWords(tagSub(name)), words);
      if (s) rel.set(name, { score: s, why: s === 3 ? 'same' : 'near' });
    }
    for (const node of tagTree.value) {
      if (node.cat === OTHER) continue;
      const s = nameMatch(nameWords(node.cat), words);
      if (s) rel.set(node.cat + '/', { score: s - 0.5, why: 'cat' });
    }
    // Règles de l'ajout automatique (tags du classeur) : toujours montrées, en tête.
    for (const [key] of ruled) {
      if (!key.startsWith('t:')) continue;
      const k = key.slice(2);
      rel.set(k, { ...(rel.get(k) || { score: 4, why: 'manual' }), rule: true });
    }
    if (own >= 2) {
      for (const [k, n] of tagsIn) {
        if (rel.has(k) || k.endsWith('/') || n < 2 || n < own * 0.2) continue;
        rel.set(k, { score: n / own, why: 'often', n });
      }
    }
    const found = new Map([...rel.keys()].map((k) => [k, new Map()])); // clé -> titre -> carte
    for (const c of tagged) {
      const tk = titleKey(c.title);
      for (const tg of c.tags) {
        for (const k of [tg, tagCat(tg) + '/']) {
          const m = found.get(k);
          if (m && !m.has(tk)) m.set(tk, c);
        }
      }
    }
    const rows = [];
    for (const [k, r] of rel) {
      const row = { ...r, key: 't:' + k, label: tokenLabel(k), kind: 'tag', inside: tagsIn.get(k) || 0, cards: [...found.get(k).values()] };
      if (row.cards.length || r.rule) rows.push(row);
    }
    rows.sort((a, b) => (b.rule ? 1 : 0) - (a.rule ? 1 : 0) || b.score - a.score || b.cards.length - a.cards.length || COLLATOR.compare(a.label, b.label));
    return { rows: rows.slice(0, Math.max(TAGADD_MAX, rows.filter((r) => r.rule).length)), own };
  }
  // Propositions cochables : tags du jeu, catégories du jeu, et tes tags du classeur quand leur liste est dépliée.
  const tagAddRows = computed(() => {
    const info = tagAddInfo.value;
    if (!info) return [];
    return [...info.game.rows, ...info.cats.rows, ...(S.tagAdd && S.tagAdd.tags ? info.tags.rows : [])];
  });
  // Aperçu : tes cartes des propositions cochées, une par titre, de A à Z ; picked = sans celles décochées.
  const tagAddPreview = computed(() => {
    const ta = S.tagAdd;
    if (!ta) return [];
    const m = new Map();
    for (const r of tagAddRows.value) {
      if (!ta.on.has(r.key)) continue;
      for (const c of r.cards) { const k = titleKey(c.title); if (!m.has(k)) m.set(k, c); }
    }
    return [...m.values()].sort((a, b) => COLLATOR.compare(a.title, b.title));
  });
  // Titres exclus de l'ajout automatique de la collection de la fenêtre (titres repliés) : décochés d'emblée dans l'aperçu.
  const tagAddSkip = computed(() => {
    const ta = S.tagAdd;
    const auto = autoOf(ta ? targets.value.find((x) => x.id === ta.id) : null);
    return new Set(auto ? auto.skip.map(titleKey) : []);
  });
  const tagAddSkipped = (c) => tagAddSkip.value.has(titleKey(c.title));
  // Carte de l'aperçu décochée : à la main, ou exclue de l'ajout automatique (sauf recochée).
  const tagAddOff = (ta, c) => ta.off.has(c.id) || (!ta.keep.has(c.id) && tagAddSkipped(c));
  const tagAddPicked = computed(() => (S.tagAdd ? tagAddPreview.value.filter((c) => !tagAddOff(S.tagAdd, c)) : []));
  // Règles que la fenêtre enregistrerait (propositions cochées, tes tags du classeur s'ils sont dépliés) et ce qui change
  // par rapport à celles de la collection : {had, rules, skipAdd (titres décochés dans l'aperçu, pas encore exclus),
  // changed}.
  const rulesSig = (list) => list.map(ruleKey).sort().join('\u0001');
  const tagAddAuto = computed(() => {
    const ta = S.tagAdd;
    const info = tagAddInfo.value;
    if (!ta || !info) return null;
    const had = autoOf(info.t);
    const rules = [];
    if (ta.auto) {
      for (const r of tagAddRows.value) {
        if (!ta.on.has(r.key)) continue;
        rules.push(r.kind === 'gtag' ? { k: 'gtag', v: r.label } : r.kind === 'cat' ? { k: 'cat', v: r.label } : { k: 'tag', v: r.key.slice(2) });
      }
    }
    const skipAdd = rules.length ? tagAddPreview.value.filter((c) => tagAddOff(ta, c) && !tagAddSkipped(c)).map((c) => c.title) : [];
    return { had, rules, skipAdd, changed: rulesSig(rules) !== rulesSig(had ? had.rules : []) || skipAdd.length > 0 };
  });
  function openTagAdd(col) {
    const t = col.t || targets.value.find((x) => x.id === col.id) || null;
    const auto = autoOf(t);
    S.tagAdd = { id: col.id, on: new Set(), off: new Set(), keep: new Set(), extra: [], field: '', fieldError: '', limit: TAGADD_PAGE, tags: false, busy: false, error: '',
      auto: true, rules: auto ? auto.rules.slice() : [] };
    if (auto) {
      // Collection qui a déjà un ajout automatique : ses règles, et elles seules, sont cochées (à changer ici).
      for (const r of auto.rules) S.tagAdd.on.add(ruleKey(r));
      S.tagAdd.tags = auto.rules.some((r) => r.k === 'tag');
    } else {
      // Cochés d'emblée : les tags et les catégories du jeu du même nom que la collection (les plus sûrs) ; les autres, à
      // cocher soi-même.
      const info = tagAddInfo.value;
      if (info) for (const r of [...info.game.rows, ...info.cats.rows]) if (r.why === 'same') S.tagAdd.on.add(r.key);
    }
    S.modal = 'tagadd';
  }
  function toggleTagAddKey(ta, key, on) {
    if (on) ta.on.add(key); else ta.on.delete(key);
    ta.limit = TAGADD_PAGE;
    ta.error = '';
  }
  function toggleTagAddCard(ta, id, on) {
    if (on) { ta.off.delete(id); ta.keep.add(id); } else { ta.off.add(id); ta.keep.delete(id); }
  }
  // Tout cocher (exclues comprises) ou tout décocher dans l'aperçu.
  function toggleTagAddAll(ta, on) {
    if (on) { ta.off.clear(); for (const c of tagAddPreview.value) ta.keep.add(c.id); } else for (const c of tagAddPreview.value) ta.off.add(c.id);
  }
  // Tes tags du classeur, dépliés ou repliés (repliés : plus cochés).
  function toggleTagAddTags(ta) {
    ta.tags = !ta.tags;
    if (!ta.tags) for (const k of [...ta.on]) if (k.startsWith('t:')) ta.on.delete(k);
    ta.limit = TAGADD_PAGE;
  }
  // « Un autre tag ou une autre catégorie du jeu » : le nom d'un tag du jeu ou le texte d'une catégorie de tes cartes
  // (sans la casse ni les accents ; les deux s'ils existent), sinon ceux qui ont exactement les mêmes mots (pluriel,
  // féminin : « Maladies infectieuses » -> « maladie infectieuse ») ; inconnu : jusqu'à trois tags ou catégories qui
  // contiennent tous ses mots.
  function addTagAddKey(ta) {
    const raw = String(ta.field || '').replace(/\s+/g, ' ').trim();
    if (!raw) return;
    const words = nameWords(raw);
    const find = (index, list) => (index.has(catKey(raw)) ? [catKey(raw)] : list.filter((g) => nameMatch(g.words, words) === 3).map((g) => g.key));
    const keys = [...find(gameTags.value, gameTagList.value).map((k) => 'g:' + k), ...find(gameCats.value, gameCatList.value).map((k) => 'c:' + k)];
    if (!keys.length) {
      const w = new Set(words);
      const near = w.size ? [...gameTagList.value, ...gameCatList.value].filter((g) => [...w].every((x) => g.words.includes(x))).slice(0, 3).map((g) => `« ${g.label} »`) : [];
      ta.fieldError = `Aucune de tes cartes n'a le tag ou la catégorie du jeu « ${raw} »${near.length ? ` ; ressemblants : ${andList(near)}` : ''}.`;
      return;
    }
    for (const key of keys) {
      if (!ta.extra.includes(key)) ta.extra.push(key);
      ta.on.add(key);
    }
    ta.field = '';
    ta.fieldError = '';
    ta.limit = TAGADD_PAGE;
  }
  async function saveTagAdd(ta) {
    if (ta.busy) return;
    const t = targets.value.find((x) => x.id === ta.id);
    if (!t) { ta.error = "Cette collection n'existe plus."; return; }
    const st = tagAddAuto.value || { had: null, rules: [], skipAdd: [], changed: false };
    // Rapprochés de nouveau au moment d'enregistrer (la collection a pu changer depuis l'ouverture) : aucun doublon.
    const titles = new Set(t.items.map((it) => titleKey(it.title)));
    const qids = new Set(t.items.map((it) => it.qid).filter(Boolean));
    const fresh = [];
    for (const c of tagAddPicked.value) {
      const k = titleKey(c.title);
      const q = resolver ? resolver.known(c.title) || null : null;
      if (titles.has(k) || (q && qids.has(q))) continue;
      titles.add(k);
      if (q) qids.add(q);
      fresh.push(itemOfCard(c, q));
    }
    const { had, rules } = st;
    if (rules.length > AUTO_MAX_RULES) { ta.error = `${fmt(AUTO_MAX_RULES)} règles au plus pour l'ajout automatique : décoche des tags ou des catégories, ou « Refaire à chaque synchro ».`; return; }
    if (!fresh.length && !st.changed) { ta.error = 'Ces cartes sont déjà toutes dans la collection.'; return; }
    const items = fresh.length ? [...t.items, ...fresh] : t.items;
    if (fresh.length && utf8Length(JSON.stringify(items)) > TARGET_MAX_BYTES) { ta.error = 'Collection trop volumineuse avec ces cartes : 1,7 Mo au plus. Décoche-en une partie.'; return; }
    const body = { id: t.id, name: t.name, items };
    if (t.source) body.source = t.source;
    if (rules.length) {
      // « Refaire à chaque synchro » : les règles cochées sont gardées ; les cartes décochées dans l'aperçu sont exclues
      // (jamais ajoutées automatiquement), celles recochées malgré une exclusion ne le sont plus.
      body.auto = { rules };
      const skipped = new Set(had ? had.skip.map(titleKey) : []);
      const del = fresh.filter((it) => skipped.has(titleKey(it.title))).map((it) => it.title);
      if (st.skipAdd.length || del.length) body.auto_skip = { ...(st.skipAdd.length ? { add: st.skipAdd } : {}), ...(del.length ? { del } : {}) };
    } else if (had) body.auto = null; // case décochée : l'ajout automatique s'arrête
    const gen = cardsGen;
    ta.busy = true;
    ta.error = '';
    try {
      const r = await saveTargetApi(body);
      if (gen !== cardsGen) return; // classeur changé entre-temps
      if (r.target) upsertTarget(r.target); else await loadTargets();
      if (S.tagAdd === ta) closeModal();
      const n = fresh.length;
      const added = n ? `${cards$(n)} ${plural(n, 'ajoutée', 'ajoutées')} à « ${t.name} ».` : '';
      const auto = rules.length
        ? (n ? 'Les prochaines cartes de ces tags y seront ajoutées à chaque synchro.' : `Ajout automatique ${had ? 'mis à jour' : 'enregistré'} pour « ${t.name} » : les prochaines cartes de ces tags y seront ajoutées à chaque synchro.`)
        : had ? `Ajout automatique arrêté pour « ${t.name} » : les cartes déjà ajoutées restent.` : '';
      notify([added, auto].filter(Boolean).join(' '));
    } catch (e) {
      if (S.tagAdd === ta) ta.error = e.message;
    } finally {
      ta.busy = false;
    }
  }

  // ---------------------------------------------------------------- ajout automatique (« Refaire à chaque synchro »)
  // Demande de l'utilisateur (2026-10-18) : « Quand il y a déjà eu un "Ajouter par tags du jeu", automatiser pour le faire
  // à chaque synchro. » La fenêtre retient ce qui y a été coché (tags du jeu, catégories du jeu, tags du classeur) comme
  // règles de la collection : t.auto = {rules:[{k:'gtag'|'cat'|'tag', v}], skip:[titres exclus]} (colonne `auto` de
  // targets, jamais montrée aux amis). À chaque arrivée de cartes dans la page (ouverture du classeur, synchro du favori,
  // relecture ?since : afterCards), runAutoAdd ajoute à chaque collection qui a des règles tes cartes qui y répondent, ni
  // déjà dedans (titre puis qid, comme la fenêtre), ni exclues (décochées dans l'aperçu, retirées ensuite de la
  // collection : skip), à la fin, avec les mêmes champs que la fenêtre ; une requête par collection, une seule
  // notification pour toutes. Fait ici, pas par le serveur à la fin d'un import : seule la page rapproche titres et qids
  // (résolus sur Wikipédia) et replie tags et catégories comme la fenêtre, et import.js / refresh.js restent tels quels.
  // Deux onglets (ou deux appareils) ouverts : chaque envoi porte expect_updated_at (le updated_at de la collection sur
  // laquelle il a été calculé) ; si un autre est passé avant, le serveur répond 409 avec la collection d'aujourd'hui, et la
  // page recalcule dessus (rien à ajouter, en général) : jamais de doublon ni d'écrasement. Sans collection à règles :
  // rien à faire, aucune requête (les lectures incrémentales restent les mêmes).
  const AUTO_MAX_RULES = 20; // targets.js : MAX_RULES
  const autoOf = (t) => (t && t.auto && t.auto.rules.length ? t.auto : null);
  // Clé d'une règle : celle de sa proposition dans la fenêtre (« g:<tag du jeu replié> », « c:<catégorie repliée> »,
  // « t:<tag> » ou « t:<Catégorie de tags>/ »).
  const ruleKey = (r) => (r.k === 'gtag' ? 'g:' + catKey(r.v) : r.k === 'cat' ? 'c:' + catKey(r.v) : 't:' + r.v);
  // Test d'une carte contre des règles (l'une suffit), comme les propositions de la fenêtre.
  function ruleTest(rules) {
    const g = new Set();
    const c = new Set();
    const tags = new Set();
    const tcats = new Set();
    for (const r of rules) {
      if (r.k === 'gtag') g.add(catKey(r.v));
      else if (r.k === 'cat') c.add(catKey(r.v));
      else if (r.v.endsWith('/')) tcats.add(r.v.slice(0, -1));
      else tags.add(r.v);
    }
    return (card) => (g.size > 0 && card.gtags.some((t) => g.has(catKey(t))))
      || (c.size > 0 && !!card.category && c.has(catKey(card.category)))
      || ((tags.size > 0 || tcats.size > 0) && card.tags.some((t) => tags.has(t) || tcats.has(tagCat(t))));
  }
  // « tag du jeu « Maladie », catégorie du jeu « maladie » ».
  function autoRulesText(rules) {
    const part = (k, one, many) => {
      const names = rules.filter((r) => r.k === k).map((r) => `« ${k === 'tag' ? tokenLabel(r.v) : r.v} »`);
      return names.length ? `${plural(names.length, one, many)} ${andList(names)}` : null;
    };
    return [part('gtag', 'tag du jeu', 'tags du jeu'), part('cat', 'catégorie du jeu', 'catégories du jeu'), part('tag', 'tag du classeur', 'tags du classeur')]
      .filter(Boolean).join(', ');
  }
  // Élément ajouté pour une de tes cartes (fenêtre et ajout automatique) : sa catégorie du jeu ; pas d'image (la carte a la
  // sienne, une case vide la retrouve sur Wikipédia) ; son qid s'il est connu.
  function itemOfCard(c, q) {
    const item = { title: c.title, description: c.category || null, image: null, status: 'ok' };
    if (q) item.qid = q;
    return item;
  }
  // Ce que l'ajout automatique mettrait dans t : cands = tes cartes qui répondent aux règles, ni dans la collection (titre,
  // puis qid de l'élément ou de son titre) ni exclues, une par titre, de A à Z ; fresh = leurs éléments, sans doublon de
  // qid, tant que la collection tient dans les limites de targets.js ; left = celles qui n'y tiennent pas.
  function autoPlan(t) {
    const auto = autoOf(t);
    if (!auto) return { cands: [], fresh: [], left: 0 };
    const test = ruleTest(auto.rules);
    const skip = new Set(auto.skip.map(titleKey));
    const titles = new Set();
    const qids = new Set();
    const inIds = new Set();
    for (const it of t.items) {
      titles.add(titleKey(it.title));
      if (it.qid) qids.add(it.qid);
      const c = findCard(it);
      if (c) inIds.add(c.id);
    }
    const found = new Map();
    for (const c of cards.value) {
      if (inIds.has(c.id)) continue;
      const k = titleKey(c.title);
      if (!k || titles.has(k) || skip.has(k) || found.has(k) || !test(c)) continue;
      found.set(k, c);
    }
    const cands = [...found.values()].sort((a, b) => COLLATOR.compare(a.title, b.title));
    const fresh = [];
    let left = 0;
    let bytes = cands.length ? utf8Length(JSON.stringify(t.items)) : 0;
    for (const c of cands) {
      const q = resolver ? resolver.known(c.title) || null : null;
      if (q && qids.has(q)) continue;
      const item = itemOfCard(c, q);
      const size = utf8Length(JSON.stringify(item)) + 1;
      if (bytes + size > TARGET_MAX_BYTES) { left++; continue; }
      if (q) qids.add(q);
      fresh.push(item);
      bytes += size;
    }
    return { cands, fresh, left };
  }
  // Un seul passage à la fois (par classeur) ; une arrivée de cartes pendant un passage en relance un à la fin.
  let autoJob = null; // {gen, again, p}
  const autoSaid = new Map(); // collection -> dernier avertissement donné (limites, erreur) : pas répété à chaque synchro
  function runAutoAdd() {
    if (autoJob && autoJob.gen === cardsGen) { autoJob.again = true; return autoJob.p; }
    const job = { gen: cardsGen, again: false, p: null };
    autoJob = job;
    job.p = (async () => {
      try {
        do { job.again = false; await autoAddOnce(job.gen); } while (job.again && job.gen === cardsGen);
      } catch (e) { /* la prochaine arrivée de cartes réessaie */ } finally {
        if (autoJob === job) autoJob = null;
      }
    })();
    return job.p;
  }
  function dropTarget(id) {
    targets.value = targets.value.filter((x) => x.id !== id);
    if (S.album && S.album.kind === 'target' && S.album.id === id) S.album = null;
  }
  async function autoAddOnce(gen) {
    const stale = () => gen !== cardsGen;
    const todo = targets.value.filter((t) => autoOf(t) && autoPlan(t).cands.length);
    if (!todo.length) return;
    // Qids des cartes à ajouter et des éléments sans qid que rien ne rapproche encore : une carte que tu as sous un autre
    // titre que l'élément (renommage, redirection) ne doit pas entrer une seconde fois. En cache la plupart du temps.
    if (resolver) {
      const titles = new Set();
      for (const t of todo) {
        for (const c of autoPlan(t).cands) if (resolver.known(c.title) === undefined) titles.add(c.title);
        for (const it of t.items) if (!it.qid && resolver.known(it.title) === undefined && !findCard(it)) titles.add(it.title);
      }
      if (titles.size) {
        try { await resolver.resolve([...titles]); } catch (e) { /* Wikipédia indisponible : rapprochement par titre */ }
        if (stale()) return;
        qidVersion.value++;
      }
    }
    const added = [];
    const warns = [];
    const warn = (t, sig, text) => { if (autoSaid.get(t.id) !== sig) { autoSaid.set(t.id, sig); warns.push(text); } };
    for (const t0 of todo) {
      let t = targets.value.find((x) => x.id === t0.id);
      for (let attempt = 0; t && autoOf(t) && attempt < 3; attempt++) {
        const plan = autoPlan(t);
        const full = () => warn(t, `full:${t.items.length + plan.fresh.length}:${plan.left}`, `« ${t.name} » est pleine : ${cards$(plan.left)} de ses règles d'ajout automatique ${plural(plan.left, "n'a", "n'ont")} pas pu y entrer (1,7 Mo au plus par collection).`);
        if (!plan.fresh.length) { if (plan.left) full(); break; }
        const body = { id: t.id, name: t.name, items: [...t.items, ...plan.fresh] };
        if (t.source) body.source = t.source;
        if (t.updated_at) body.expect_updated_at = t.updated_at;
        try {
          const r = await saveTargetApi(body);
          if (stale()) return;
          if (r.target) upsertTarget(r.target); else await loadTargets();
          added.push({ name: t.name, n: plan.fresh.length });
          if (plan.left) full(); else autoSaid.delete(t.id);
          break;
        } catch (e) {
          if (stale()) return;
          if (e.status === 409 && e.data && e.data.conflict) {
            // Un autre onglet ou un autre appareil est passé avant : on repart de la collection d'aujourd'hui.
            if (e.data.target) upsertTarget(e.data.target); else dropTarget(t.id);
            t = targets.value.find((x) => x.id === t0.id);
            continue;
          }
          warn(t, 'err:' + e.message, `Ajout automatique à « ${t.name} » impossible : ${String(e.message || '').replace(/[.\s]+$/, '')}.`);
          break;
        }
      }
    }
    const parts = [];
    if (added.length) {
      const n = added.reduce((k, a) => k + a.n, 0);
      parts.push(added.length === 1 ? `${cards$(n)} ${plural(n, 'ajoutée', 'ajoutées')} automatiquement à « ${added[0].name} ».`
        : `${cards$(n)} ${plural(n, 'ajoutée', 'ajoutées')} automatiquement : ${andList(added.map((a) => `${fmt(a.n)} à « ${a.name} »`))}.`);
    }
    parts.push(...warns);
    if (!parts.length) return;
    // Un message encore affiché (« Mis à jour depuis wiki-masters.com… ») est gardé devant.
    const cur = S.notice;
    const text = parts.join(' ');
    notify(cur && !cur.error && !cur.action ? `${cur.text} ${text}` : text, !added.length);
  }
  // Enregistre la collection `id` telle qu'elle est (éléments compris) avec `extra` (auto…), sans écraser un
  // enregistrement passé entre-temps (expect_updated_at ; 409 : on repart de la collection d'aujourd'hui). Rend la
  // collection enregistrée (null : classeur changé entre-temps).
  async function saveTargetFresh(id, extra) {
    const gen = cardsGen;
    for (let attempt = 0; attempt < 3; attempt++) {
      const t = targets.value.find((x) => x.id === id);
      if (!t) throw new Error("Cette collection n'existe plus.");
      const body = { id: t.id, name: t.name, items: t.items, ...extra };
      if (t.source) body.source = t.source;
      if (t.updated_at) body.expect_updated_at = t.updated_at;
      try {
        const r = await saveTargetApi(body);
        if (gen !== cardsGen) return null;
        if (r.target) upsertTarget(r.target); else await loadTargets();
        return targets.value.find((x) => x.id === id) || null;
      } catch (e) {
        if (gen !== cardsGen) return null;
        if (!(e.status === 409 && e.data && e.data.conflict)) throw e;
        if (e.data.target) upsertTarget(e.data.target); else dropTarget(id);
      }
    }
    throw new Error('Cette collection vient de changer plusieurs fois (dans un autre onglet ?) : réessaie.');
  }
  // « Arrêter » (album) : règles et exclusions effacées, cartes déjà ajoutées gardées ; « Annuler » les remet.
  async function stopAuto(t) {
    const prev = autoOf(t);
    if (S.autoBusy || !prev) return;
    const gen = cardsGen;
    S.autoBusy = t.id;
    try {
      const nt = await saveTargetFresh(t.id, { auto: null });
      if (!nt || gen !== cardsGen) return;
      notify(`Ajout automatique arrêté pour « ${nt.name} » : les cartes déjà ajoutées restent.`, false, { label: 'Annuler', run: () => restoreAuto(t.id, prev) });
    } catch (e) {
      if (gen === cardsGen) notify(e.message, true);
    } finally {
      if (gen === cardsGen) S.autoBusy = null;
    }
  }
  async function restoreAuto(id, prev) {
    if (S.autoBusy) return;
    const gen = cardsGen;
    S.autoBusy = id;
    try {
      const nt = await saveTargetFresh(id, { auto: { rules: prev.rules, skip: prev.skip } });
      if (!nt || gen !== cardsGen) return;
      notify(`Ajout automatique de « ${nt.name} » remis.`);
      runAutoAdd();
    } catch (e) {
      if (gen === cardsGen) notify(e.message, true);
    } finally {
      if (gen === cardsGen) S.autoBusy = null;
    }
  }

  // ---------------------------------------------------------------- fenêtres, réglages, favori
  function closeModal() {
    const m = S.modal;
    S.modal = null;
    if (m === 'editor') { S.editor = null; stopCatSearch(); }
    // Confirmation ouverte depuis une autre fenêtre (« Retirer » une proposition de « Nouvelle collection ») : on y revient.
    if (m === 'confirm') { const back = S.confirm && S.confirm.back; S.confirm = null; if (back) S.modal = back; }
    if (m === 'tag') S.tagEdit = null;
    if (m === 'switch') S.switchAsk = null;
    if (m === 'editor') kwAbort();
    if (m === 'arrange') { if (arrangeCtrl) arrangeCtrl.abort(); S.arrange = null; }
    if (m === 'tagadd') S.tagAdd = null;
    if (m === 'merge') S.merge = null;
    if (m === 'sync') stopSync();
  }
  function openConfirm(o) {
    S.confirm = { title: o.title, text: o.text, ok: o.ok, danger: !!o.danger, run: markRaw(o.run), after: o.after ? markRaw(o.after) : null,
      back: o.back || null, busy: false, error: '', progress: '' };
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
  // Pseudo dans le jeu (PATCH /api/me {pseudo}) : montré aux membres avec qui tu partages, pour qu'ils te trouvent.
  async function savePseudo() {
    const st = S.settings;
    st.pBusy = true;
    st.pError = '';
    st.pSaved = false;
    try {
      const r = await api('PATCH', '/api/me', { pseudo: st.pseudo.trim() });
      if (S.me) S.me.user = r.user || { ...S.me.user, pseudo: st.pseudo.trim() || null };
      st.pseudo = (S.me && S.me.user && S.me.user.pseudo) || '';
      st.pSaved = true;
    } catch (e) {
      st.pError = e.message;
    } finally {
      st.pBusy = false;
    }
  }
  // Profil d'un joueur dans le jeu (wiki-masters.com/profile/<pseudo>) : un lien, rien n'est lu ni écrit dans le jeu.
  const gameProfileUrl = (pseudo) => 'https://www.wiki-masters.com/profile/' + encodeURIComponent(pseudo);
  function viewPseudo(f, id) {
    if (!f.pseudo) return null;
    return h('span', { class: 'line pseudo-line' }, [
      h('span', null, ['pseudo dans le jeu : ', h('b', null, f.pseudo)]),
      h('button', { class: 'linkish', type: 'button', title: 'Copier le pseudo', onClick: () => copy(f.pseudo, id) }, S.copied === id ? 'copié' : 'copier'),
      h('a', { href: gameProfileUrl(f.pseudo), target: '_blank', rel: 'noopener noreferrer' }, 'son profil dans le jeu ↗'),
    ]);
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
  // Clé d'import gardée dans ce navigateur (classeur-import-key, par classeur) : posée, ou retirée (k = null).
  function keepImportKey(k) {
    const me = S.me && S.me.user;
    if (me) {
      const all = importKeys();
      if (k) all[me.id] = k; else delete all[me.id];
      store.set(LS.importKey, JSON.stringify(all));
    }
    S.bm.importKey = k;
  }
  // Clé du favori : celle du classeur (GET /api/import-key), la même sur tous les appareils, même si ce navigateur en
  // garde une autre. Favori créé avant que le classeur n'en garde une copie (404) : la clé gardée ici est adoptée si c'est
  // celle du favori en cours (POST /api/import-key/adopt), oubliée sinon (409 : périmée, un favori plus récent a été créé
  // ailleurs ; avant le 2026-10-18, la page reproposait ce favori périmé sans fin). Classeur injoignable : celle d'ici.
  async function syncImportKey() {
    const stored = storedImportKey();
    S.bm.checking = true;
    try {
      try {
        const r = await api('GET', '/api/import-key');
        if (r && typeof r.import_key === 'string' && r.import_key) { keepImportKey(r.import_key); S.bm.stale = false; return; }
      } catch (e) {
        if (e.status !== 404) { S.bm.importKey = stored; return; }
      }
      if (!stored) { S.bm.importKey = null; return; }
      try {
        const r = await api('POST', '/api/import-key/adopt', { import_key: stored });
        keepImportKey(r.import_key || stored);
        S.bm.stale = false;
      } catch (e) {
        if (e.status === 409) { keepImportKey(null); S.bm.stale = true; } else S.bm.importKey = stored;
      }
    } finally {
      S.bm.checking = false;
    }
  }
  // Prépare le favori (source, clé d'import du classeur) et le journal des synchros pour l'onglet « Mettre à jour ».
  async function prepareFavori() {
    S.bm.clicked = false;
    S.bm.importKey = null;
    loadSyncLog();
    await Promise.all([syncImportKey(), loadBookmarkletSource()]);
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
      keepImportKey(r.import_key);
      S.bm.stale = false;
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
  // du classeur et la clé. Les espaces du code qui ne séparent pas deux mots (« var x », « return x ») sont retirés,
  // jamais dans une chaîne "…" ou '…' ni dans une expression régulière (reconnue à ce qui la précède : « ( , = : [ ! & | ?
  // { } ; + - * % < > ~ ^ », ou return, typeof…) : chaque espace coûte 3 caractères une fois encodé (%20), et Firefox
  // refuse un favori de plus de 65 536 caractères (54 600 avec, 73 200 sans, le 2026-10-17). Fonction autonome : le test
  // du favori (dev/bookmarklet.test.mjs) la reprend telle quelle.
  function favoriCode(src, site, key) {
    const code = src.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join(' ');
    const word = (c) => /[\w$\u0080-\uffff]/.test(c || '');
    let out = '';
    const regexHere = () => {
      const t = out.replace(/\s+$/, '');
      return !t || '(,=:[!&|?{};+-*%<>~^'.includes(t.slice(-1)) || /(^|[^\w$])(return|typeof|case|do|else|in|of|new|delete|void|throw)$/.test(t);
    };
    for (let i = 0; i < code.length;) {
      const c = code[i];
      let j = i + 1;
      if (c === '"' || c === "'") {
        while (j < code.length && code[j] !== c) j += code[j] === '\\' ? 2 : 1;
        out += code.slice(i, j + 1);
        i = j + 1;
      } else if (c === '/' && regexHere()) {
        for (let cls = false; j < code.length && (cls || code[j] !== '/'); j++) {
          if (code[j] === '\\') j++;
          else if (code[j] === '[') cls = true;
          else if (code[j] === ']') cls = false;
        }
        out += code.slice(i, j + 1);
        i = j + 1;
      } else if (c === ' ') {
        while (code[i] === ' ') i++;
        const a = out.slice(-1);
        const b = code[i];
        if ((word(a) && word(b)) || (a === b && (a === '+' || a === '-')) || (a === '/' && (b === '/' || b === '*'))) out += ' ';
      } else {
        out += c;
        i = j;
      }
    }
    return out.replace('"__SITE__"', JSON.stringify(site)).replace('"__KEY__"', JSON.stringify(key));
  }
  // Le favori : une adresse javascript: (encodeURI, plus « # » qui couperait l'adresse).
  function makeBookmarklet(src, site, key) {
    return 'javascript:' + encodeURI(favoriCode(src, site, key)).replace(/#/g, '%23');
  }
  // Le script Tampermonkey / Violentmonkey (facultatif) : le même code, avec "__START__" = "load" (relié dès le
  // chargement de chaque page du jeu, rien n'est lu avant une action du joueur), sous l'en-tête du gestionnaire.
  // @grant none : il tourne dans la page, comme le favori (il doit voir le window.fetch de la page).
  function makeUserscript(src, site, key) {
    const version = (src.match(/var VERSION = (\d+);/) || [])[1] || '1'; // celle du favori
    return ['// ==UserScript==', '// @name         Le classeur, relié à WikiMasters', `// @namespace    ${site}`, `// @version      ${version}`,
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
  // Articles de la collection créée d'une proposition : ceux de la catégorie (20 000 au plus) ; si elle en regroupe d'autres (p.subs :
  // propositions cachées sous elle), aussi ceux de ses sous-catégories (1 niveau) et des propositions regroupées plus bas
  // (petites-filles…). Plus de 20 000 ainsi : ses articles et ceux des seules propositions regroupées ; encore trop : erreur.
  async function proposalMembers(p) {
    if (!p.subs || !p.subs.length) return { members: await proposer.loadMembers(p.title, {}), withSubs: false };
    const byName = new Map(S.wp.list.map((x) => [x.name, x]));
    const direct = (n) => { const q = byName.get(n); return !!q && (q.parents || []).map(catName).includes(p.name); };
    const out = new Map();
    const add = (list) => { for (const m of list) if (!out.has(m.title)) out.set(m.title, m); };
    add(await categoryMembers(p.title, true, null));
    for (const n of p.subs) {
      if (out.size > LIST_MAX) break;
      if (!direct(n)) add(await categoryMembers(CAT_NS + n, false, null));
    }
    if (out.size > LIST_MAX) {
      out.clear();
      add(await categoryMembers(p.title, false, null));
      for (const n of p.subs) { if (out.size > LIST_MAX) break; add(await categoryMembers(CAT_NS + n, false, null)); }
    }
    if (out.size > LIST_MAX) throw new Error(`« ${p.name} » et les catégories qu'elle regroupe ont plus de 20 000 articles : trop pour une collection. Ouvre-la pour en faire une collection sans ses sous-catégories.`);
    return { members: [...out.values()], withSubs: true };
  }
  // « Créer une collection » d'une proposition : ses articles (directement dans la catégorie, 20 000 au plus ; avec ses
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
      const r = await saveTargetApi({ name, items, source: p.key });
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
      text: 'Cette catégorie ne te sera plus proposée. Tu pourras la rétablir dans « Nouvelle collection », onglet « Propositions », ou la retrouver par son nom dans l\'onglet « Par URL ».',
      ok: 'Retirer des propositions',
      run: async () => {
        await savePrefs({ hidden_proposals: [...S.prefs.hidden_proposals, p.key] });
        S.wp.list = markRaw(S.wp.list.filter((x) => x.key !== p.key));
      },
      after: () => notify(`« ${p.name} » retirée des propositions.`),
      back: S.modal === 'editor' ? 'editor' : null,
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
  // Une page donne une collection par choix (2026-10-19, demande de l'utilisateur : « une par section, ou tout
  // ensemble ») : de tous ses liens (« links:<titre> »), de la colonne clé de tous ses tableaux (« links:<titre>#<colonne> »)
  // ou de certaines sections (« …#§<sections> ») ; pageCollections = toutes les tiennes, dans l'ordre de création.
  const pageCollections = (title) => targets.value.filter((t) => pageOfSource(t.source) === title);
  // Celle du choix en cours (même source que « Créer une collection »), ou null.
  const catCollection = (cv) => collectionFor(cv.type === 'page' ? pageSelection(cv).source : cv.key);
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
    if (S.modal === 'editor') closeModal(); // onglet « Par URL » de « Nouvelle collection » : l'aperçu s'ouvre à la place
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
      loading: true, error: '', items: null, total: 0, busy: false, step: '', queued: false };
    openAlbum('category', key);
    loadCategory();
  }
  // Ouvre une page (suggestion « Pages de liste », adresse collée) : les articles qu'elle lie, comme un album (source
  // « links:<titre> », titre tel que Wikipédia l'écrit, redirection suivie), ou ceux de la colonne clé de ses tableaux
  // (tables : tableaux lus par pageTables ; cols : colonnes proposées (tableColumns) ; col : clé de la colonne choisie,
  // '' = tous les liens, null = pas encore choisie ; tableOff : tableaux décochés). reuse (« Autres sections de la page »
  // d'une de ses collections) : ses tableaux et ses liens déjà lus dans cette session servent sans requête.
  function openPage(title, reuse) {
    const t = String(title || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return;
    const key = PAGE_SRC + t;
    stopCategory();
    S.catView = { type: 'page', key, title: t, name: pageName(t), size: null, subcats: null, withSubs: false, links: null, allLinks: false,
      tables: null, tablesError: '', cols: null, col: null, tableOff: [], reuse: !!reuse,
      loading: true, error: '', items: null, total: 0, busy: false, step: '', queued: false };
    openAlbum('category', key);
    loadCategory();
  }
  const pageCache = new Map(); // titre -> {tables, tablesError, links} des 3 dernières pages lues
  // Catégorie : taille (categoryinfo) si on ne la connaît pas, puis les articles (avec ceux des sous-catégories directes
  // si withSubs). Page : ses tableaux (pageTables) puis ses liens et leur nature (pageLinks), lus une fois ; les articles de
  // la colonne clé choisie (cv.col, présélectionnée par pickColumn), dans l'ordre des lignes, ou sinon ceux de la nature
  // dominante seulement sauf si allLinks. 20 000 au plus, total = ce qui a été lu ou gardé (plus de 20 000 : trop grande
  // pour une collection).
  // cv.step : où en est la lecture (montré pendant l'attente) ; cv.queued : « Créer une collection » cliqué pendant la
  // lecture, la collection est créée dès qu'elle finit (pas en cas d'erreur).
  async function loadCategory() {
    const cv = S.catView;
    if (!cv) return;
    if (catCtrl) catCtrl.abort();
    const ctrl = new AbortController();
    catCtrl = ctrl;
    const stale = () => catCtrl !== ctrl || S.catView !== cv;
    const onStep = (s) => { if (!stale()) cv.step = s; };
    cv.loading = true;
    cv.error = '';
    cv.step = '';
    try {
      if (cv.type === 'page') {
        // Page déjà lue dans cette session (rouverte pour en faire une autre collection) : rien n'est relu.
        const cached = cv.reuse ? pageCache.get(cv.title) : null;
        if (cached && !cv.tables && !cv.links) { cv.tables = cached.tables; cv.tablesError = cached.tablesError; }
        if (!cv.tables) {
          // Tableaux illisibles (Wikipédia en panne pour action=parse) : la page garde ses liens, la vue le dit.
          try { cv.tables = markRaw(await pageTables(cv.title, ctrl.signal, onStep)); } catch (e) {
            if (e.name === 'AbortError') throw e;
            if (stale()) return;
            cv.tables = markRaw({ list: [], inTables: 0, inLists: 0 });
            cv.tablesError = e.message;
          }
          if (stale()) return;
        }
        if (!cv.links) {
          const links = cached && cached.tables === cv.tables ? cached.links : await pageLinks(cv.title, ctrl.signal, onStep);
          if (stale()) return;
          cv.links = markRaw(links);
          pageCache.delete(cv.title);
          pageCache.set(cv.title, { tables: cv.tables, tablesError: cv.tablesError, links: cv.links });
          while (pageCache.size > 3) pageCache.delete(pageCache.keys().next().value);
          const tc = tableColumns(cv.tables, links, cv.title);
          cv.cols = markRaw(tc.cols);
          if (cv.col === null) cv.col = pickColumn(tc, links, cv.title, cv.tables);
        }
        const { top } = cv.links;
        const col = cv.col ? cv.cols.find((c) => c.key === cv.col) || null : null;
        const kept = col ? columnItems(col, cv.tableOff) : top && !cv.allLinks ? cv.links.items.filter((i) => i.fits) : cv.links.items;
        cv.total = kept.length;
        cv.items = markRaw(kept.slice(0, LIST_MAX).map((i) => {
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
      const list = await categoryMembers(cv.title, cv.withSubs, ctrl.signal, onStep);
      if (stale()) return;
      cv.total = list.length;
      cv.items = markRaw(list.slice(0, LIST_MAX).map((m) => ({ title: m.title, description: null, image: null, status: 'ok' })));
    } catch (e) {
      if (!stale() && e.name !== 'AbortError') cv.error = e.message;
    } finally {
      if (!stale()) {
        catCtrl = null;
        cv.loading = false;
        if (cv.queued) { cv.queued = false; if (!cv.error) createFromCategory(); }
      }
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
  // Page : colonne clé de ses tableaux (key = celle de tableColumns), ou '' pour tous ses liens ; un tableau décoché
  // (index dans cv.tables.list) ne compte plus. Déjà lus : sans requête.
  function setPageColumn(key) {
    const cv = S.catView;
    if (!cv || cv.busy || cv.type !== 'page' || !cv.cols) return;
    cv.col = key && cv.cols.some((c) => c.key === key) ? key : '';
    loadCategory();
  }
  function togglePageTable(t) {
    const cv = S.catView;
    if (!cv || cv.busy || cv.type !== 'page') return;
    cv.tableOff = cv.tableOff.includes(t) ? cv.tableOff.filter((x) => x !== t) : [...cv.tableOff, t];
    loadCategory();
  }
  // Page : une section de ses tableaux (« En France ») cochée ou décochée d'un coup : ts = ses tableaux (index dans
  // cv.tables.list). Jamais tous les tableaux de la colonne clé décochés.
  function setPageTables(ts, on) {
    const cv = S.catView;
    if (!cv || cv.busy || cv.type !== 'page' || !cv.cols) return;
    const col = cv.col ? cv.cols.find((c) => c.key === cv.col) || null : null;
    const off = new Set(cv.tableOff);
    for (const t of ts) { if (on) off.delete(t); else off.add(t); }
    if (col && col.parts.every((p) => off.has(p.t))) return;
    cv.tableOff = [...off];
    loadCategory();
  }
  // « Créer une collection » (album d'une catégorie ou d'une page) : ses articles lus (avec les sous-catégories si la case
  // est cochée ; page : les articles liés gardés, avec leur qid et leur description Wikidata) deviennent une collection à
  // compléter de source « wp:<nom> » ou « links:<titre> » (« links:<titre>#<colonne> » faite de la colonne clé de ses
  // tableaux, « …#§<sections> » de certaines de ses sections), nommée comme la catégorie (page : « Liste de » retiré,
  // sections après « — ») ; l'album reste ouvert, devenu celui de la collection (Modifier, Supprimer). Une page en donne
  // une par choix de colonne et de sections (pageSelection). Déjà faite, ou « Créer une collection » de sa proposition en
  // cours (S.wp.busy, partagé) : pas de seconde collection de même source. Cliqué pendant la lecture
  // des articles (une page : ses liens puis leur nature sur Wikidata, plusieurs secondes) : retenu (cv.queued), la
  // collection est créée dès la fin de la lecture (loadCategory).
  async function createFromCategory() {
    const cv = S.catView;
    if (!cv) return;
    const t0 = catCollection(cv);
    if (t0) { openAlbum('target', t0.id); return; }
    if (cv.busy || S.wp.busy[cv.key]) return;
    if (cv.loading || !cv.items) { if (!cv.error) cv.queued = true; return; }
    if (!cv.items.length) return;
    const page = cv.type === 'page';
    if (cv.total > LIST_MAX) { notify(page ? 'Cette page lie plus de 20 000 articles : trop pour une collection.' : 'Cette catégorie a plus de 20 000 articles : trop grande pour une collection.', true); return; }
    if (cv.key.length > 200) { notify(page ? 'Le titre de cette page est trop long pour en faire une collection.' : 'Le nom de cette catégorie est trop long pour en faire une collection.', true); return; }
    // Colonne clé des tableaux d'une page : source « links:<titre>#<colonne> », « …#§<sections> » pour une partie de ses
    // tableaux (pageSelection).
    const sel = page ? pageSelection(cv) : null;
    const col = sel ? sel.col : null;
    const source = sel ? sel.source : cv.key;
    const gen = cardsGen;
    const stale = () => gen !== cardsGen;
    cv.busy = true;
    S.wp.busy[cv.key] = true;
    try {
      const name = sel ? sel.name : cv.name.length > 80 ? cv.name.slice(0, 79) + '…' : cv.name;
      const items = cv.items.map((it) => (it.qid ? { title: it.title, description: it.description || null, image: null, status: 'ok', qid: it.qid }
        : { title: it.title, description: it.description || null, image: null, status: 'ok' }));
      const r = await saveTargetApi({ name, items, source });
      if (stale()) return;
      if (r.target) upsertTarget(r.target); else { await loadTargets(); if (stale()) return; }
      S.wp.list = markRaw(S.wp.list.filter((x) => x.key !== cv.key));
      const t = collectionFor(source);
      if (t && S.catView === cv) { stopCategory(); S.album = { kind: 'target', id: t.id }; }
      const used = col ? col.parts.filter((p) => !cv.tableOff.includes(p.t)).length : 0;
      const how = cv.withSubs ? ', sous-catégories comprises' : col ? ` (colonne « ${col.name} » ${plural(used, 'du tableau', 'des tableaux')} de la page${sel.sections ? `, ${sel.sections.includes(' + ') ? 'sections' : 'section'} « ${sel.sections} »` : ''}, dans l'ordre)`
        : page && cv.links && cv.links.top && !cv.allLinks ? ` (les « ${cv.links.top.label} » de la page)` : page ? ' (tous les liens de la page)' : '';
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
    const rows = await sparql(`SELECT ?item ?title ?desc WHERE { ${body} ${FR_ARTICLE} OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc) = "fr") } } LIMIT ${LIST_MAX + 1}`, 3, signal);
    const items = rowsToItems(rows);
    const interp = parts.join(' · ');
    return {
      interp,
      cand: { id: 'wd', source: 'wd', name: cap(text), size: items.length, tooBig: items.length > LIST_MAX, where: body, interp,
        items: items.length > LIST_MAX ? null : markRaw(items) },
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
      return { id: 'cat:' + t, source: 'cat', title: t, name: cap(t.replace(/^Catégorie\s*:\s*/i, '')), size, subcats: Number(ci.subcats) || 0, tooBig: size > LIST_MAX };
    }).filter((c) => c.size > 0 || c.subcats > 0).slice(0, 12);
  }
  // Articles d'une catégorie (et de ses sous-catégories directes) ; s'arrête au-delà de 20 000.
  // onStep(texte) : où en est la lecture (articles lus, sous-catégorie en cours), pour l'album qui attend.
  async function categoryMembers(title, withSubs, signal, onStep) {
    const out = new Map();
    const step = onStep || (() => {});
    let where = '';
    const read = async (cat, type) => {
      const found = [];
      let cont = {};
      for (let guard = 0; guard < 50; guard++) {
        const j = await getJson(wikiQ, wpUrl({ action: 'query', list: 'categorymembers', cmtitle: cat, cmtype: type, cmlimit: '500', ...(type === 'page' ? { cmnamespace: '0' } : {}), ...cont }), 3, null, signal);
        for (const m of (j && j.query && j.query.categorymembers) || []) found.push(m.title);
        if (!j.continue || (type === 'page' && out.size + found.length > LIST_MAX)) break;
        cont = j.continue;
        if (type === 'page') step(`Lecture des articles de la catégorie sur Wikipédia${where} : ${fmt(out.size + found.length)} articles lus…`);
      }
      return found;
    };
    step('Lecture des articles de la catégorie sur Wikipédia…');
    for (const t of await read(title, 'page')) out.set(t, { title: t, description: null, qid: null });
    if (withSubs) {
      const subs = await read(title, 'subcat');
      for (let k = 0; k < subs.length; k++) {
        if (out.size > LIST_MAX) break;
        where = ` (sous-catégorie ${fmt(k + 1)} sur ${fmt(subs.length)})`;
        step(`Lecture des articles de la catégorie sur Wikipédia${where} : ${fmt(out.size)} articles lus…`);
        for (const t of await read(subs[k], 'page')) if (!out.has(t)) out.set(t, { title: t, description: null, qid: null });
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
  // onStep(texte) : où en est la lecture (liens lus, lot Wikidata en cours), pour l'album qui attend.
  async function pageLinks(title, signal, onStep) {
    const step = onStep || (() => {});
    const by = new Map();
    const drop = new Set();
    const alias = {}; // redirections suivies (titre du lien -> article), pour retrouver les liens des tableaux
    let cont = {};
    step('Lecture des liens de la page sur Wikipédia…');
    for (let guard = 0; guard < 50 && by.size <= LIST_MAX; guard++) {
      const j = await getJson(wikiQ, wpUrl({ action: 'query', generator: 'links', titles: title, gplnamespace: '0', gpllimit: 'max', redirects: '1',
        prop: 'pageprops', ppprop: 'wikibase_item|disambiguation', ...cont }), 3, null, signal);
      Object.assign(alias, aliasOf((j && j.query) || {}));
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
      step(`Lecture des liens de la page sur Wikipédia : ${fmt(by.size)} articles liés…`);
    }
    const items = [...by.values()].filter((i) => !drop.has(i.title) && i.title !== title).sort((a, b) => a.title.localeCompare(b.title, 'fr'));
    const byQ = new Map(items.filter((i) => i.qid).map((i) => [i.qid, i]));
    const batches = chunks([...byQ.keys()], 200);
    for (let k = 0; k < batches.length; k++) {
      const batch = batches[k];
      step(`Nature des ${fmt(items.length)} articles liés, sur Wikidata${batches.length > 1 ? ` (lot ${fmt(k + 1)} sur ${fmt(batches.length)})` : ''}…`);
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
      step(`Nature dominante des ${fmt(items.length)} articles liés, sur Wikidata…`);
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
    return { items, top, alias };
  }
  // ---------------------------------------------------------------- tableaux d'une page : la colonne clé
  // Une page de liste faite d'un ou plusieurs tableaux (« Liste des éléments chimiques », « Liste des présidents de la
  // République française »…) : ses autres colonnes (pays, villes, partis…) mêlent leurs liens aux bons. On lit le HTML
  // rendu de la page (action=parse&prop=text : les modèles qui font les lignes y sont développés, ce que le wikicode ne
  // donne pas), analysé par DOMParser dans un document à part, inerte (ni script exécuté, ni gestionnaire d'événement, ni
  // image chargée) et jamais inséré dans la page : on n'en garde que des textes et des titres d'articles.
  // - Tableaux « wikitable », repliés compris, pas ceux imbriqués dans un autre ; cellules fusionnées (rowspan, colspan)
  //   dépliées dans une grille. En-tête : les premières lignes faites de <th> (ou dans <thead>), une ligne d'une seule
  //   cellule sur toute la largeur (titre) mise à part ; libellé d'une colonne = ses en-têtes de haut en bas (« Mandat ›
  //   Début ») ; deux colonnes sous une même cellule d'en-tête (« Appartenance politique » : couleur et nom) n'en font
  //   qu'une ; sans en-tête : « Colonne 1 », « Colonne 2 »… Lignes de données : les suivantes, sauf une cellule seule sur
  //   toute la largeur (intertitre « IIIe République », commentaire « intérim ») et les en-têtes répétés.
  // - Pour chaque ligne et chaque colonne, le PREMIER lien d'article de la cellule (lien bleu de l'espace principal dont
  //   le texte se voit : ni image seule comme un drapeau ou un portrait, ni note, ni clé de tri cachée). Dans la colonne
  //   clé, c'est le sujet de la ligne ; les liens suivants de la même cellule le précisent (nationalité, lieu, parti,
  //   « (intérim) ») : les prendre tous ramènerait ce que la colonne clé écarte.
  const WP_NS = /^(?:Fichier|File|Image|Média|Media|Catégorie|Category|Aide|Help|Wikipédia|Wikipedia|WP|Modèle|Template|Portail|Portal|Projet|Spécial|Special|Utilisateur|Utilisatrice|User|Discussion|Talk|Module|MediaWiki|Référence|Livre|Sujet|TimedText|Gadget|Brouillon|Draft)(?:[ _]discussion)?\s*:/i;
  const TABLE_SKIP = /(?:^|\s)(?:reference|mw-ref|sortkey|noprint|mw-editsection|mw-cite-backlink|error|metadata|navbox)(?:\s|$)/;
  const elKids = (el) => Array.prototype.filter.call(el.childNodes, (n) => n.nodeType === 1);
  const skipEl = (el) => el.localName === 'style' || el.localName === 'script' || TABLE_SKIP.test(el.getAttribute('class') || '')
    || /display\s*:\s*none/i.test(el.getAttribute('data-style') || '');
  // Texte visible d'un nœud (notes « [1] », « [a] », « [pas clair] » et clés de tri cachées retirées).
  function nodeText(el) {
    let out = '';
    const walk = (n) => {
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1 || skipEl(n)) return;
      if (n.localName === 'br') { out += ' '; return; }
      if (n.localName === 'sup' && /^\s*\[/.test(n.textContent)) return;
      for (const c of n.childNodes) walk(c);
    };
    walk(el);
    return out.replace(/\[\s*(?:\d+|[a-z]|N \d+|note \d+)\s*\]/gi, '').replace(/\s+/g, ' ').trim();
  }
  // Article d'un lien du HTML de Wikipédia (« /wiki/Titre », ou « ./Titre » dans le HTML de Parsoid ; bleu, de l'espace
  // principal), sinon null.
  function articleOf(a) {
    const href = a.getAttribute('href') || '';
    const at = href.startsWith('/wiki/') ? 6 : href.startsWith('./') ? 2 : -1;
    if (at < 0 || /(?:^|\s)(?:new|extiw|external|mw-selflink|mw-file-description)(?:\s|$)/.test(a.getAttribute('class') || '')) return null;
    let t = href.slice(at).split('#')[0].split('?')[0];
    try { t = decodeURIComponent(t); } catch (e) { return null; }
    t = normTitle(t);
    return t && !WP_NS.test(t) ? t : null;
  }
  // Le texte du lien nomme-t-il l'article (« Hydrogène » ; « Abricot » pour « Abricot (couleur) ») plutôt qu'une de ses
  // propriétés (« 1873 » pour « Élection présidentielle française de 1873 », « 2 » pour « Présidence d'Adolphe Thiers ») ?
  const namesIt = (text, title) => {
    const a = normName(text);
    const b = normName(title.replace(/\s*\([^)]*\)\s*$/, ''));
    return !!a && !!b && (a === b || (b.includes(a) && a.length >= 0.5 * b.length) || a.includes(b));
  };
  // Premier lien d'article d'une cellule : {t (titre), named (namesIt)}, ou null.
  function firstArticle(el) {
    let found = null;
    const walk = (n) => {
      if (found || n.nodeType !== 1 || skipEl(n)) return;
      if (n.localName === 'a') {
        const t = articleOf(n);
        const text = t ? nodeText(n) : '';
        if (text) found = { t, named: namesIt(text, t) };
        return;
      }
      for (const c of n.childNodes) { walk(c); if (found) return; }
    };
    walk(el);
    return found;
  }
  function tableRows(table) {
    const out = [];
    for (const c of elKids(table)) {
      if (c.localName === 'tr') out.push(c);
      else if (c.localName === 'thead' || c.localName === 'tbody' || c.localName === 'tfoot') for (const r of elKids(c)) if (r.localName === 'tr') out.push(r);
    }
    return out;
  }
  // Un tableau : {caption, rows (lignes de données), cols: [{label, links: [titre | null, un par ligne], named (liens dont le
  // texte nomme l'article)}]}, ou null.
  function readTable(table) {
    const trs = tableRows(table);
    const grid = trs.map(() => []);
    const starts = trs.map(() => []); // cellules qui commencent sur cette ligne
    const span = (el, name, max) => { const n = parseInt(el.getAttribute(name), 10); return Number.isFinite(n) && n > 1 ? Math.min(n, max) : 1; };
    for (let r = 0; r < trs.length; r++) {
      let c = 0;
      for (const td of elKids(trs[r])) {
        if (td.localName !== 'td' && td.localName !== 'th') continue;
        while (grid[r][c]) c++;
        const cs = span(td, 'colspan', 60);
        const rs = Math.min(span(td, 'rowspan', 3000), trs.length - r);
        const cell = { el: td, th: td.localName === 'th', cs, link: undefined, text: undefined };
        starts[r].push(cell);
        for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) grid[r + dr][c + dc] = cell;
        c += cs;
      }
    }
    const W = Math.max(0, ...grid.map((row) => row.length));
    if (!W) return null;
    const cellsOf = (r) => { const s = []; for (let c = 0; c < W; c++) if (grid[r][c] && !s.includes(grid[r][c])) s.push(grid[r][c]); return s; };
    const full = (r) => { const d = cellsOf(r); return W > 1 && d.length === 1 && d[0].cs >= W; };
    const inHead = (r) => !!trs[r].parentNode && trs[r].parentNode.localName === 'thead';
    const textOf = (x) => (x.text === undefined ? (x.text = nodeText(x.el)) : x.text);
    const linkOf = (x) => (x.link === undefined ? (x.link = firstArticle(x.el)) : x.link);
    // Ligne d'en-tête : faite de <th> (une case vide en <td>, le coin d'un tableau, n'y change rien), ou toute couverte
    // par les cellules fusionnées de la ligne d'avant.
    const headRow = (r) => inHead(r) || !starts[r].length || (starts[r].some((x) => x.th) && starts[r].every((x) => x.th || !textOf(x)));
    let h = 0;
    while (h < trs.length && headRow(h)) h++;
    if (h >= trs.length) h = Math.min(1, trs.length);
    const heads = [];
    for (let r = 0; r < h; r++) if (!full(r)) heads.push(r);
    const last = heads.length ? heads[heads.length - 1] : -1;
    const cols = [];
    for (let c = 0; c < W; c++) {
      const bottom = last >= 0 ? grid[last][c] || null : null;
      const prev = cols[cols.length - 1];
      if (prev && bottom && prev.bottom === bottom) { prev.c1 = c; continue; }
      const parts = [];
      const seen = [];
      for (const r of heads) {
        const x = grid[r][c];
        if (!x || seen.includes(x)) continue;
        seen.push(x);
        const t = textOf(x);
        if (t && !parts.includes(t)) parts.push(t);
      }
      cols.push({ c0: c, c1: c, bottom, label: parts.join(' › ').slice(0, 120) || `Colonne ${cols.length + 1}`, links: [], named: 0 });
    }
    let rows = 0;
    for (let r = h; r < trs.length; r++) {
      if (full(r) || (starts[r].length > 1 && starts[r].every((x) => x.th))) continue;
      rows++;
      for (const col of cols) {
        let l = null;
        for (let c = col.c0; c <= col.c1 && !l; c++) if (grid[r][c]) l = linkOf(grid[r][c]);
        col.links.push(l ? l.t : null);
        if (l && l.named) col.named++;
      }
    }
    if (!rows) return null;
    const caption = elKids(table).find((x) => x.localName === 'caption');
    return { caption: caption ? nodeText(caption).slice(0, 120) : '', rows, cols: cols.map(({ label, links, named }) => ({ label, links, named })) };
  }
  // Tableaux d'un HTML de Wikipédia : {list: [tableaux dans l'ordre de la page, chacun avec ses intertitres : path, de h2 à
  // h4 (« Gares desservies en 2026 › À l'étranger › Allemagne »), section = le dernier], inTables, inLists (liens d'articles dans ces tableaux, et dans des listes à puces hors tableaux)}. Bandeaux,
  // boîtes de navigation, infobox, notes et références ne comptent pas. Avant l'analyse, les attributs style deviennent
  // data-style et les feuilles <style> sont retirées : le document créé hérite de la CSP de la page, qui signalerait chacun
  // dans la console (« inline style ») ; « display:none » reste lisible.
  const PAGE_SKIP = /(?:^|\s)(?:infobox\w*|references|reflist|mw-references-wrap|bandeau\w*|homonymie|toc)(?:\s|$)/;
  function readTables(html) {
    const out = { list: [], inTables: 0, inLists: 0 };
    if (typeof DOMParser === 'undefined') return out;
    const clean = String(html).replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '').replace(/(<[a-z][a-z0-9]*\b[^<>]*?)\sstyle=/gi, '$1 data-style=');
    const doc = new DOMParser().parseFromString(clean, 'text/html');
    let path = []; // intertitres en cours : [{lv (2 à 4), t}]
    const walk = (n, inTable, inLi) => {
      if (n.nodeType !== 1 || skipEl(n) || PAGE_SKIP.test(n.getAttribute('class') || '')) return;
      const name = n.localName;
      if (/^h[2-4]$/.test(name)) {
        const lv = Number(name[1]);
        const t = nodeText(n).slice(0, 120);
        path = path.filter((x) => x.lv < lv);
        if (t) path.push({ lv, t });
        return;
      }
      if (name === 'a') {
        if (articleOf(n)) { if (inTable) out.inTables++; else if (inLi) out.inLists++; }
        return;
      }
      if (name === 'table') {
        const wiki = /(?:^|\s)wikitable(?:\s|$)/.test(n.getAttribute('class') || '');
        if (wiki && !inTable) { const t = readTable(n); if (t) { const ts = path.map((x) => x.t); out.list.push(Object.assign(t, { path: ts, section: ts.length ? ts[ts.length - 1] : '' })); } }
        for (const c of n.childNodes) walk(c, inTable || wiki, inLi);
        return;
      }
      for (const c of n.childNodes) walk(c, inTable, inLi || name === 'li');
    };
    if (doc && doc.body) walk(doc.body, false, false);
    return out;
  }
  async function pageTables(title, signal, onStep) {
    if (typeof DOMParser === 'undefined') return { list: [], inTables: 0, inLists: 0 };
    if (onStep) onStep('Lecture des tableaux de la page sur Wikipédia…');
    const j = await getJson(wikiQ, wpUrl({ action: 'parse', page: title, prop: 'text', redirects: '1', disableeditsection: '1', disablelimitreport: '1', disabletoc: '1' }), 3, null, signal);
    const html = j && j.parse && typeof j.parse.text === 'string' ? j.parse.text : '';
    return readTables(html);
  }
  // Colonnes proposées comme clé, d'après les tableaux lus et les liens de la page (pageLinks : article, qid, nature) :
  // les colonnes de même libellé (au repli près) dans plusieurs tableaux n'en font qu'une (« Forme courte » dans les 24
  // tableaux A à Z de « Liste des pays du monde ») ; un lien retrouvé parmi ceux de la page (redirection suivie, ni lien
  // rouge ni homonymie) donne l'article de la ligne. Gardées : celles qui donnent au moins 2 articles différents, dans
  // l'ordre où elles apparaissent ; chacune : {key, label, name (libellé court : la dernière ligne d'en-tête, sauf si deux
  // colonnes l'ont), parts: [{t (index du tableau), items, rows, linked}], n (articles différents), fits (de la nature
  // dominante), score}. best = la mieux notée : articles différents × (½ + ½ part des liens dont le texte nomme l'article :
  // « Adolphe Thiers » oui, « 1873 » pour une élection non) × 1,5 si son en-tête reprend un mot du titre (« Nom de couleur »
  // pour « Liste de noms de couleur ») × (1 + ¼ part de la nature dominante) × 0,9 par colonne gardée à sa gauche (la
  // colonne clé est souvent la première : « Nom » plutôt que « Chef-lieu », 102 articles chacune). La nature dominante ne
  // pèse que peu : c'est celle de TOUS les liens de la page, pas forcément celle de sa liste (« Liste des départements
  // français » : les arrondissements, plus nombreux que les départements). Mesuré le 2026-10-18 (pages de Wikipédia
  // réelles) : « Nom » des éléments chimiques (118), « Titulaire » des présidents (26, contre « Élection » 31), « Forme
  // courte » des pays (197), « Nom » des gratte-ciel, des races bovines, des départements, « Nom de couleur » (189).
  function tableColumns(tables, links, title) {
    const by = new Map(links.items.map((i) => [i.title, i]));
    const find = (t) => by.get(resolve(links.alias || {}, t)) || by.get(t) || null;
    const words = new Set(normName(listName(title)).split(' ').filter((w) => w.length >= 4).map(singular));
    const groups = new Map();
    ((tables && tables.list) || []).forEach((tb, ti) => {
      const used = new Set();
      tb.cols.forEach((c, ci) => {
        const key = normName(c.label) || 'colonne ' + (ci + 1);
        if (used.has(key)) return; // même libellé deux fois dans un tableau : la première
        used.add(key);
        const items = [];
        for (const t of c.links) { const it = t ? find(t) : null; if (it) items.push(it); }
        if (!items.length) return;
        if (!groups.has(key)) groups.set(key, { key, label: c.label, order: groups.size, parts: [] });
        groups.get(key).parts.push({ t: ti, items, rows: tb.rows, linked: items.length, raw: c.links.filter(Boolean).length, named: c.named || 0 });
      });
    });
    const cols = [];
    for (const g of groups.values()) {
      const seen = new Set();
      let fits = 0;
      for (const p of g.parts) for (const it of p.items) if (!seen.has(it.title)) { seen.add(it.title); if (it.fits) fits++; }
      const n = seen.size;
      if (n < 2) continue;
      const short = g.label.split(' › ').pop();
      const match = normName(short).split(' ').some((w) => w.length >= 4 && words.has(singular(w)));
      const raw = g.parts.reduce((x, p) => x + p.raw, 0);
      const named = raw ? g.parts.reduce((x, p) => x + p.named, 0) / raw : 0;
      const rank = cols.length; // place parmi les colonnes gardées, de gauche à droite
      cols.push({ ...g, short, n, fits, score: n * (0.5 + 0.5 * named) * (match ? 1.5 : 1) * (1 + (links.top ? 0.25 * fits / n : 0)) * 0.9 ** rank });
    }
    const same = new Map();
    for (const c of cols) { const k = normName(c.short); same.set(k, (same.get(k) || 0) + 1); }
    for (const c of cols) c.name = same.get(normName(c.short)) > 1 ? c.label : c.short;
    let best = null;
    for (const c of cols) if (!best || c.score > best.score) best = c;
    return { cols, best };
  }
  // Colonne présélectionnée : la mieux notée, si elle donne au moins 3 articles et au moins le quart de ce que donnent les
  // liens de la page (nature dominante, ou tous), ou, pour une page « Liste… », si ses liens d'articles sont au moins aussi
  // nombreux dans ses tableaux que dans ses listes à puces (« Liste des présidents de la République française » : aucune
  // nature dominante parmi ses 713 liens, 222 liens dans ses tableaux contre 182 dans des listes) ; sinon '' (tous les
  // liens) : une page dont la liste est surtout en puces et qui n'a qu'un petit tableau garde ses liens.
  function pickColumn(tc, links, title, tables) {
    const b = tc.best;
    if (!b || b.n < 3) return '';
    const kept = links.top ? links.top.n : links.items.length;
    if (b.n >= 0.25 * kept) return b.key;
    return /^Liste\b/i.test(title) && tables && tables.inTables >= tables.inLists ? b.key : '';
  }
  // Articles d'une colonne clé, dans l'ordre des tableaux et des lignes, chacun une fois ; off : tableaux décochés.
  function columnItems(col, off) {
    const seen = new Set();
    const out = [];
    for (const p of col.parts) {
      if (off && off.includes(p.t)) continue;
      for (const it of p.items) if (!seen.has(it.title)) { seen.add(it.title); out.push(it); }
    }
    return out;
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
  const DEF_MAX = 10000; // la recherche de Wikipédia ne va pas au-delà du 10 000e résultat
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
  // Articles du candidat « Définition » : tous (au plus 10 000 résultats : limite de la recherche de Wikipédia), ou les top plus liés depuis Wikipédia. Tri
  // explicite : par pertinence, les pages de 500 se recouvrent (mesuré : 15 doublons et autant d'absents sur 2 025) ;
  // par titre, aucun ; par liens entrants, 3.
  async function defPages(cand, top, signal, onProgress) {
    const T = { forms: new Set(cand.terms.forms), quals: cand.terms.quals };
    const items = [];
    const seen = new Set();
    let checked = 0;
    let offset = 0;
    for (let guard = 0; guard < 20 && offset < 10000; guard++) {
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
      name: top ? `${cand.name} (les ${top} plus connus)` : cand.name, loading: true, error: '', items: null, total: 0, interp: cand.interp || '', progress: '', checked: 0,
      cols: null, col: null }; // page : colonnes de ses tableaux (tableColumns) et colonne clé choisie ('' = tous les liens)
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
          // Comme l'album d'une page : ses tableaux (colonne clé, présélectionnée par pickColumn), puis ses liens.
          let tables;
          try { tables = await pageTables(cand.title, ctrl.signal); } catch (e) {
            if (e.name === 'AbortError') throw e;
            tables = { list: [], inTables: 0, inLists: 0 };
          }
          if (stale()) return;
          const links = await pageLinks(cand.title, ctrl.signal);
          if (stale()) return;
          ch.links = markRaw(links);
          const tc = tableColumns(tables, links, cand.title);
          ch.cols = markRaw(tc.cols);
          ch.col = pickColumn(tc, links, cand.title, tables);
        }
        const { top } = ch.links;
        const col = ch.col ? ch.cols.find((c) => c.key === ch.col) || null : null;
        items = col ? columnItems(col, []) : top && !ch.allLinks ? ch.links.items.filter((i) => i.fits) : ch.links.items;
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
      ch.items = markRaw(items.slice(0, LIST_MAX));
    } catch (e) {
      if (!stale() && e.name !== 'AbortError') ch.error = e.message;
    } finally {
      if (!stale()) ch.loading = false;
    }
  }
  // Page : colonne clé de ses tableaux, ou '' pour tous ses liens (déjà lus : sans requête).
  function kwSetColumn(ed, cand, key) {
    const ch = ed.kw.chosen;
    if (!ch || !ch.cols) return;
    ch.col = key && ch.cols.some((c) => c.key === key) ? key : '';
    if (kwCtrl) kwCtrl.abort();
    const ctrl = new AbortController();
    kwCtrl = ctrl;
    kwLoad(ed, cand, ctrl);
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
    if (ch.total > LIST_MAX) { ed.error = 'Trop grande (plus de 20 000 articles) : précise ta recherche.'; return; }
    ed.busy = true;
    ed.error = '';
    try {
      const items = ch.items.map((i) => {
        const it = { title: i.title, description: i.description || null, image: null, status: 'ok' };
        if (i.qid) it.qid = i.qid;
        return it;
      });
      const r = await saveTargetApi({ name, items });
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
    chatMembers.value = [];
    chatMembersAt = 0;
    chatMembersJob = null;
    Object.assign(S.friends, { status: 'idle', busy: false, error: '', loading: '', open: null, q: '', filter: 'all', limit: PAGE, more: {}, page: null, trade: 'all', tradeDup: true,
      album: null, albumFilter: 'all', albumSort: 'order', albumLimit: ALBUM_PAGE, albumFrom: null, copies: {} });
  }
  // Carte d'un ami (champs montrés par le serveur, rien d'autre) ; adresses vérifiées avant d'en faire des liens.
  function prepFriendCard(c) {
    const title = String(c.title || '');
    const link = (v) => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : null);
    // v : les cotes de la carte (cache commun des ventes du jeu), {"R": {p, n, w, l, d}}, ou null.
    const v = c.v && typeof c.v === 'object' && !Array.isArray(c.v) ? c.v : null;
    return markRaw({ id: String(c.id), title, rarity: RARITY_NAME[c.rarity] ? c.rarity : null, count: Math.max(1, Number(c.count) || 1),
      shiny: c.shiny === true, image: link(c.image), url: link(c.url), v, _k: fold(title) });
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
  // élément, le titre, le qid et le drapeau d'intercalaire (rien d'autre n'est gardé).
  const QID_RE = /^Q[1-9]\d{0,11}$/;
  function prepFriendTarget(t) {
    const items = (Array.isArray(t.items) ? t.items : []).filter((it) => it && typeof it.title === 'string' && it.title)
      .map((it) => {
        const out = typeof it.qid === 'string' && QID_RE.test(it.qid) ? { title: it.title, qid: it.qid } : { title: it.title };
        if (it.sep === true) out.sep = true; // intercalaire : il ouvre une section de son album
        return out;
      });
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
          return markRaw({ id: m.id, name: typeof m.name === 'string' ? m.name : '', pseudo: typeof m.pseudo === 'string' && m.pseudo ? m.pseudo : null, count, fetched_at: m.fetched_at || null, cards: same ? p.cards : null,
            tshare: !!tg, tcount: tg ? Number(tg.count) || 0 : 0, tmark, targets: sameT ? p.targets : null });
        }).sort((a, b) => COLLATOR.compare(friendName(a), friendName(b)));
        friendList.value = list;
        if (fr.open && !list.some((f) => f.id === fr.open)) { fr.open = null; routeSync(); } // a cessé de partager, ou adresse morte
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
      const items = t.items.map((it) => {
        const item = { title: it.title, description: null, image: null, status: 'ok' };
        if (it.qid) item.qid = it.qid;
        if (it.sep) item.sep = true; // ses intercalaires aussi : la même collection, mêmes sections
        return item;
      });
      const name = copiedName(t);
      const r = await saveTargetApi({ name, items });
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
  // Tout ce qui vient du jeu est lu par le favori, dans la page du jeu, à son clic « Mettre à jour les cotes » et, relié,
  // toutes les 20 min et après tes enchères et ventes (cette page ne peut pas lire la base du jeu : CSP, et pas de
  // session) ; ici, on montre ce que le serveur a rangé : la valeur du classeur et son historique (GET /api/market), la
  // dernière lecture du marché (bonnes affaires, tes enchères et tes ventes, 7 jours au plus, avec son âge), le dernier
  // essai du favori (attempt : réussi, ou raté et pourquoi), et les cotes de tes cartes et des cartes qui te manquent
  // (GET /api/market/prices, communes à tous les classeurs). Relu à l'ouverture, après chaque changement des cartes, à
  // l'ouverture de l'onglet « Marché » (une fois par minute au plus, sauf demande), et quand GET /api/me (relu chaque
  // minute, checkRemote) annonce un nouvel envoi du favori (market_at).
  const M = reactive({ loaded: false, busy: false, error: '', value: null, history: [], live: null, liveAt: null, attempt: null, at: 0, hover: -1 });
  const prices = shallowRef(new Map()); // card_id -> {id, v: {"R": {p, n, w, l, d}, "R*": …}, at}
  const wantedPrices = shallowRef(new Map()); // titre (normTitle) d'une carte qui te manque -> la même chose
  let marketJob = null;
  let marketSeen = ''; // market_at de GET /api/me déjà pris en compte par la dernière lecture de l'onglet
  const VARIANT_RE = /^(C|PC|R|SR|UR|L)\*?$/;
  // Version du favori qui lit les cotes toute seule (VERSION de bookmarklet.js, un entier ; le test du favori vérifie
  // qu'elles concordent) : un essai d'un favori plus ancien, sans version ou à version texte (celui du 17/10 au matin,
  // « 2026-10-17 ») dit de le remplacer.
  const FAVORI_VERSION = 3;
  function resetMarket() {
    Object.assign(M, { loaded: false, busy: false, error: '', value: null, history: [], live: null, liveAt: null, attempt: null, at: 0, hover: -1 });
    prices.value = new Map();
    wantedPrices.value = new Map();
    marketSeen = '';
  }
  function loadMarket(force) {
    if (S.boot !== 'app' || !S.key) return Promise.resolve();
    if (marketJob) return marketJob;
    if (!force && M.at && Date.now() - M.at < 60000) return Promise.resolve();
    const gen = cardsGen;
    M.busy = true;
    const seen = (S.me && S.me.market_at) || '';
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
        const attempt = m.attempt && typeof m.attempt === 'object' && typeof m.attempt.start === 'string' ? m.attempt : null;
        Object.assign(M, { value: m.value || null, history: Array.isArray(m.history) ? m.history : [], live, liveAt: m.live_at || null, attempt, loaded: true, error: '' });
        if (seen > marketSeen) marketSeen = seen;
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
  // Montant en W, collé au nombre (« 738W », « 1 234W », séparateur des milliers à la française) : pour le texte des
  // libellés (aria-label, title). À l'écran, toujours priceTag. Séparateur : espace insécable ordinaire (U+00A0) plutôt
  // que l'espace fine de fr-FR (U+202F), que la police des titres (Outfit : tuiles, grande valeur, cotes) n'a pas et
  // affiche sans largeur (« 10790W »).
  const wfmt = (n) => (n == null || !Number.isFinite(Number(n)) ? '—'
    : (Math.abs(n) >= 100 ? NUM.format(Math.round(n)) : NUM2.format(n)).replace(/ /g, ' ') + 'W');
  // Un prix ou une valeur à l'écran : en vert (couleur des liens, celle de « ← Toutes les collections »), classe `w`.
  // approx : cote peu fiable (moins de 3 ventes), « ~120W » estompé ; about : somme estimée, « ~5 100W » (sans estomper).
  const priceTag = (n, o) => h((o && o.tag) || 'b', { class: ['w', { approx: !!(o && o.approx) }], title: (o && o.title) || null },
    (o && (o.approx || o.about) ? '~' : '') + wfmt(n));
  // Valeur d'une carte : cote fiable de la rareté de chacun de ses exemplaires × leur nombre (comme la valeur du classeur,
  // `variantsOf`) ; priced : au moins un exemplaire coté. v = les cotes de la carte ({"R": {p, n…}}) ou rien.
  function cardWorth(c, v) {
    if (!v || typeof v !== 'object') return { value: 0, priced: false };
    let value = 0;
    let priced = false;
    for (const [k, n] of variantsOf(c).list) {
      const q = v[k];
      if (reliable(q)) { value += Number(q.p) * n; priced = true; }
    }
    return { value, priced };
  }
  // Ce que coûterait une carte qui manque : la moins chère de ses cotes fiables, toutes raretés d'exemplaire et brillance
  // confondues (n'importe quel exemplaire remplit la case) ; null sans cote fiable.
  function cheapest(v) {
    if (!v || typeof v !== 'object') return null;
    let best = null;
    for (const [k, q] of Object.entries(v)) if (VARIANT_RE.test(k) && reliable(q) && (best === null || Number(q.p) < best)) best = Number(q.p);
    return best;
  }
  // Tris « Prix ↑ » / « Prix ↓ » (listes de cartes, albums, classeur et albums d'un ami). Prix d'une carte : la plus haute
  // cote de ses exemplaires (rareté, brillance), celle de son meilleur exemplaire ; d'une case vide : celui de « Pour la
  // compléter » (la moins chère des cotes de la carte). g = 0 cote fiable, 1 peu fiable seulement (« ~ »), 2 sans cote :
  // toujours dans cet ordre, dans les deux sens ; puis l'ordre habituel de la vue.
  const NO_PRICE = Object.freeze({ g: 2, p: 0 });
  const isPriceSort = (s) => s === 'price-up' || s === 'price-down';
  const priceDir = (s) => (s === 'price-down' ? -1 : 1);
  function pickPrice(v, keys, high) {
    if (!v || typeof v !== 'object') return NO_PRICE;
    let sure = null;
    let rough = null;
    const better = (x, y) => y === null || (high ? x > y : x < y);
    for (const k of keys) {
      const q = v[k];
      if (!q || typeof q !== 'object' || !Number.isFinite(Number(q.p))) continue;
      const p = Number(q.p);
      if (reliable(q)) { if (better(p, sure)) sure = p; } else if (better(p, rough)) rough = p;
    }
    return sure !== null ? { g: 0, p: sure } : rough !== null ? { g: 1, p: rough } : NO_PRICE;
  }
  const cardPrice = (c, v) => pickPrice(v, variantsOf(c).list.map(([k]) => k), true);
  const holePrice = (v) => (v && typeof v === 'object' ? pickPrice(v, Object.keys(v).filter((k) => VARIANT_RE.test(k)), false) : NO_PRICE);
  const byPrice = (a, b, dir) => a.g - b.g || (a.g < 2 ? dir * (a.p - b.p) : 0);
  // Trie list par prix (price(x) une fois par élément), puis par tie (l'ordre habituel).
  function sortByPrice(list, price, dir, tie) {
    const pk = new Map(list.map((x) => [x, price(x)]));
    return list.slice().sort((a, b) => byPrice(pk.get(a), pk.get(b), dir) || tie(a, b));
  }
  const ownCote = (c) => { const p = prices.value.get(String(c.id)); return p ? p.v : null; };
  const wantedCote = (title) => { const p = wantedPrices.value.get(normTitle(title)); return p ? p.v : null; };
  // Valeur d'une collection : tes cartes qui la remplissent, comptées comme la valeur du classeur (une carte une fois, même
  // si deux cases la nomment) ; et « Pour la compléter » : la somme, sur ses cartes qui manquent (articles vérifiés, un par
  // titre), de la moins chère de leurs cotes fiables. Cotes : celles déjà lues pour le classeur (GET /api/market/prices :
  // tes cartes, et les cartes voulues dont le favori a trouvé l'identifiant, `t`) : rien de plus n'est demandé au serveur.
  // null tant qu'aucune cote n'est connue.
  function colWorthFor(col) {
    const byId = prices.value;
    const wanted = wantedPrices.value;
    if (!byId.size && !wanted.size) return null;
    const seen = new Set();
    const holes = new Set();
    const w = { value: 0, priced: 0, cards: 0, cost: 0, costPriced: 0, missing: 0 };
    for (const it of col.items) {
      const c = findCard(it);
      if (c) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        w.cards++;
        const p = byId.get(String(c.id));
        const x = cardWorth(c, p && p.v);
        if (x.priced) { w.priced++; w.value += x.value; }
        continue;
      }
      if (!it || it.status !== 'ok') continue;
      const k = normTitle(it.title);
      if (holes.has(k)) continue;
      holes.add(k);
      w.missing++;
      const p = wanted.get(k);
      const best = p ? cheapest(p.v) : null;
      if (best !== null) { w.costPriced++; w.cost += best; }
    }
    return w;
  }
  const colWorths = computed(() => new Map(collections.value.all.map((col) => [col.key, colWorthFor(col)])));
  const catWorth = computed(() => (catAlbum.value ? colWorthFor(catAlbum.value) : null));
  const worthOf = (col) => (col.kind === 'category' ? catWorth.value : colWorths.value.get(col.key)) || null;
  // Valeur du classeur d'un ami : ses cartes telles qu'il les montre (rareté, exemplaires, brillance : tous ses exemplaires
  // comptés dans la rareté de sa carte, le détail n'étant pas partagé) × les cotes communes, rendues avec ses cartes (champ
  // `v` de GET /api/members/<id>/cards). Seulement pour un ami qui montre ses cartes (sinon le serveur ne les rend pas).
  const friendWorths = computed(() => {
    const m = new Map();
    for (const f of friendList.value) {
      if (!f.cards) continue;
      let value = 0;
      let priced = 0;
      for (const c of f.cards) {
        const x = cardWorth(c, c.v);
        if (x.priced) { priced++; value += x.value; }
      }
      m.set(f.id, { value, priced, cards: f.cards.length });
    }
    return m;
  });
  const FRIEND_WORTH = "Cotes fiables (3 ventes au moins) × ses exemplaires, tous comptés dans la rareté de sa carte (le détail de ses exemplaires n'est pas partagé) : peut différer un peu de la valeur qu'il voit chez lui.";
  // « 18 cartes cotées sur 25 »
  const pricedOf = (priced, cards) => `${fmt(priced)} ${plural(priced, 'carte cotée', 'cartes cotées')} sur ${fmt(cards)}`;
  // Détail d'une valeur de collection, en texte (survol, lecteurs d'écran).
  function worthText(w) {
    const out = [];
    if (w.priced) out.push(`Valeur : ${wfmt(w.value)} (${pricedOf(w.priced, w.cards)})`);
    if (w.costPriced) out.push(`pour la compléter : ~${wfmt(w.cost)} (${pricedOf(w.costPriced, w.missing)} qui ${plural(w.missing, 'manque', 'manquent')})`);
    return out.join(' ; ');
  }
  const variantName = (k) => (RARITY_NAME[k.replace('*', '')] || k) + (k.endsWith('*') ? ', brillante' : '');
  const variantOrder = (a, b) => rarityRank(a.replace('*', '')) - rarityRank(b.replace('*', '')) || (a < b ? -1 : a > b ? 1 : 0);
  const pctOf = (p, w) => { const d = Math.round(((p - w) / w) * 100); return (d > 0 ? '+' : d < 0 ? '−' : '') + NUM.format(Math.abs(d)) + ' %'; };
  // « Bonnes affaires à vendre » : tes cartes qui ne servent à aucune de tes collections (rapprochement titre puis qid,
  // comme les albums) ; case décochée (MP.hideCol, cochée par défaut, 2026-10-18), aussi les exemplaires en trop de celles qui y servent (une collection n'a besoin que d'un exemplaire :
  // on garde le moins coté, cote peu fiable comprise pour en juger ; « 2 en trop »). Prix d'une ligne : la plus haute cote
  // fiable de ses exemplaires à vendre ; du plus cher au moins cher (le seuil est appliqué à l'affichage). unpriced : cartes
  // (ou exemplaires en trop) sans aucune cote fiable.
  const usedInCollections = computed(() => {
    const ids = new Set();
    for (const col of collections.value.all) for (const it of col.items) { const c = findCard(it); if (c) ids.add(c.id); }
    return ids;
  });
  // Exemplaires déjà en vente dans le jeu, d'après ta dernière lecture du marché (ventes en cours ou conclues) : la
  // carte reste dans ton classeur tant qu'une lecture complète vérifiée ne l'a pas retirée (pas pendant que tu joues :
  // compteurs qui bougent), elle n'est donc pas proposée « à vendre » une deuxième fois (2026-10-18). card_id -> raretés
  // d'exemplaire (« R », « R* »), une par vente ; invendue ou annulée : la carte t'est revenue, elle reste proposée.
  const onSaleCopies = computed(() => {
    const m = new Map();
    const sales = M.live && Array.isArray(M.live.sales) ? M.live.sales : [];
    for (const s of sales) {
      if (!s || (s.st !== 'run' && s.st !== 'sold') || s.id == null) continue;
      const k = String(s.id);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(String(s.r || '') + (s.s ? '*' : ''));
    }
    return m;
  });
  const sellOffers = computed(() => {
    const used = usedInCollections.value;
    const map = prices.value;
    const sale = onSaleCopies.value;
    const list = [];
    let unpriced = 0;
    let onSale = 0;
    for (const c of cards.value) {
      const inCol = used.has(c.id);
      if (inCol && MP.hideCol) continue; // « Cacher les cartes de mes collections » (cochée par défaut)
      const p = map.get(String(c.id));
      const v = p && p.v && typeof p.v === 'object' ? p.v : null;
      const copies = [];
      for (const [k, n] of variantsOf(c).list) {
        const q = v && v[k] && typeof v[k] === 'object' ? v[k] : null;
        const known = q && Number.isFinite(Number(q.p)) ? Number(q.p) : -1;
        for (let i = 0; i < n; i++) copies.push({ k, q: reliable(q) ? q : null, known });
      }
      const sold = sale.get(String(c.id));
      if (sold) {
        for (const k of sold) { const i = copies.findIndex((x) => x.k === k); if (copies.length) copies.splice(i >= 0 ? i : 0, 1); }
        if (!copies.length) { onSale++; continue; }
      }
      if (inCol) {
        if (copies.length < 2) continue;
        copies.sort((a, b) => a.known - b.known);
        copies.shift(); // l'exemplaire gardé pour tes collections
      }
      let best = null;
      for (const x of copies) if (x.q && (best === null || Number(x.q.p) > Number(best.q.p))) best = x;
      if (!best) { unpriced++; continue; }
      list.push({ c, price: Number(best.q.p), q: best.q, k: best.k, n: copies.length, extra: inCol ? copies.length : 0 });
    }
    list.sort((a, b) => b.price - a.price || COLLATOR.compare(a.c.title, b.c.title));
    return { list, unpriced, onSale };
  });
  // Onglet « Marché » : sections repliables (accordéon : « Mes enchères » fermée par défaut, les autres ouvertes, « Valeur
  // de ton classeur » comprise depuis le 2026-10-18) et seuil
  // des « Bonnes affaires à vendre » (100W par défaut), gardés par classeur dans ce navigateur (localStorage, accès protégés
  // : sans lui, les valeurs par défaut). Chaque liste montre 20 cartes, puis « Afficher 20 de plus ».
  const MARKET_OPEN = Object.freeze({ valeur: true, acheter: true, vendre: true, encheres: false });
  const MARKET_MIN = 100;
  const MARKET_STEP = 20;
  // col : collection choisie dans « à acheter » ; hideCol : « à vendre » sans les cartes de tes collections (cochée par défaut).
  const MP = reactive({ user: null, open: { ...MARKET_OPEN }, min: MARKET_MIN, more: {}, col: '', hideCol: true });
  function loadMarketPrefs(user) {
    const all = store.json(LS.market);
    const mine = user && all && typeof all === 'object' && !Array.isArray(all) && all[user] && typeof all[user] === 'object' ? all[user] : {};
    const open = { ...MARKET_OPEN };
    if (mine.open && typeof mine.open === 'object') for (const k of Object.keys(MARKET_OPEN)) if (typeof mine.open[k] === 'boolean') open[k] = mine.open[k];
    const min = Number(mine.min);
    Object.assign(MP, { user: user || null, open, min: Number.isFinite(min) && min >= 0 ? min : MARKET_MIN, more: {}, col: typeof mine.col === 'string' ? mine.col : '', hideCol: mine.hideCol !== false });
  }
  function saveMarketPrefs() {
    if (!MP.user) return;
    const all = store.json(LS.market);
    const map = all && typeof all === 'object' && !Array.isArray(all) ? all : {};
    map[MP.user] = { open: { ...MP.open }, min: MP.min, col: MP.col, hideCol: MP.hideCol };
    store.set(LS.market, JSON.stringify(map));
  }
  watch(() => (S.me && S.me.user ? S.me.user.id : null), (u) => loadMarketPrefs(u), { immediate: true });
  function toggleMarketSection(id) {
    MP.open[id] = !MP.open[id];
    saveMarketPrefs();
  }
  function setMarketMin(raw) {
    if (String(raw).trim() === '') return; // champ vidé pour en taper un autre : le seuil ne bouge pas encore
    const n = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return;
    MP.min = Math.min(n, 1e9);
    MP.more.vendre = 0;
    saveMarketPrefs();
  }
  // Les `shown` premières d'une liste de la page (20, puis 20 de plus à chaque clic).
  const marketShown = (key) => MP.more[key] || MARKET_STEP;
  function marketMoreButton(key, total) {
    const shown = marketShown(key);
    if (total <= shown) return null;
    const rest = total - shown;
    return h('div', { class: 'show-more' }, [h('button', { class: 'btn small', type: 'button', onClick: () => { MP.more[key] = shown + MARKET_STEP; } },
      `Afficher ${fmt(Math.min(MARKET_STEP, rest))} de plus (${fmt(rest)} ${plural(rest, 'restante', 'restantes')})`)]);
  }
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
  function viewCard(c, big, sep) {
    const r = okRarity(c.rarity) || 'C';
    const open = (e) => {
      if (big) return;
      if (e.shiftKey || e.ctrlKey || e.metaKey) { toggleSelect(c.id, e); return; }
      openCardFrom(c.id, e);
    };
    return h('article', {
      class: ['card', 'r' + r, { shiny: c.shiny, big }],
      role: big ? null : 'button', tabindex: big ? null : '0',
      'aria-label': `${c.title}, ${RARITY_NAME[r]}${c.shiny ? ', brillante' : ''}${sep ? ', intercalaire' : ''}${big ? '' : ' : ouvrir la fiche'}`,
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
  // Intercalaire (élément `sep` d'une collection, qui ouvre une section) : la carte ou la case posée sur un cadre à onglet,
  // comme glissée dans l'intercalaire d'un classeur (dessiné en CSS, .sep-frame). Le cadre ne bouge pas quand la carte se
  // soulève au survol. key : celle de l'élément de la grille, quand le cadre en est un.
  const sepFrame = (node, on, key) => (on ? h('div', { class: 'sep-frame', key: key || null }, [node]) : node);
  // Sections d'un album : un intercalaire commence une nouvelle ligne de la grille (gridBreak avant lui, sauf en tête),
  // seulement dans l'ordre de la collection, sans filtre ; ailleurs, il ne garde que son cadre.
  const showSections = (ordered, sort, filter) => !!ordered && sort === 'order' && filter === 'all';
  const gridBreak = (key) => h('div', { class: 'grid-break', key: 'sec:' + key, 'aria-hidden': 'true' });
  // fold : foldSlots de l'album ; l'onglet d'un intercalaire suivi d'au moins une carte devient le bouton qui replie sa
  // section (foldTab, dans un .sec-wrap autour de la carte). Repliée ou non, une section garde sa ligne.
  function albumKids(slots, sections, render, fold) {
    const kids = [];
    slots.forEach((s, n) => {
      if (sections && n > 0 && s.item.sep) kids.push(gridBreak(s.key));
      const sec = sections && s.item.sep && fold ? fold.sec.get(s.key) : null;
      kids.push(sec && sec.n ? h('div', { class: ['sec-wrap', { folded: sec.folded }], key: 'w:' + s.key }, [render(s), foldTab(fold.album, s.item.title, sec)]) : render(s));
    });
    return kids;
  }
  // Sections repliées (2026-10-19, « replier toute la catégorie derrière la carte intercalaire ») : par album (col.key,
  // fa.key chez un ami), les titres de ses intercalaires repliés, gardés dans ce navigateur. Seulement là où les sections
  // existent (ordre de la collection, sans filtre) : ailleurs, tout reste visible.
  const FOLDS = reactive((() => { const v = store.json(LS.sections); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; })());
  const foldedIn = (album) => (Array.isArray(FOLDS[album]) ? FOLDS[album] : []);
  function setFolded(album, titles) {
    if (titles.length) FOLDS[album] = titles; else delete FOLDS[album];
    store.set(LS.sections, JSON.stringify(FOLDS));
  }
  function toggleFold(album, title) {
    const cur = foldedIn(album);
    setFolded(album, cur.includes(title) ? cur.filter((t) => t !== title) : [...cur, title]);
  }
  // Une section repliée ne garde que son intercalaire. {slots (à montrer), sec (clé de l'intercalaire → {n : cartes de sa
  // section, folded}), album}.
  function foldSlots(slots, sections, album) {
    const sec = new Map();
    if (!sections) return { slots, sec, album };
    const folded = new Set(foldedIn(album));
    const out = [];
    let cur = null;
    for (const s of slots) {
      if (s.item.sep) { cur = { n: 0, folded: folded.has(s.item.title) }; sec.set(s.key, cur); out.push(s); continue; }
      if (cur) cur.n++;
      if (!cur || !cur.folded) out.push(s);
    }
    return { slots: out, sec, album };
  }
  function foldTab(album, title, sec) {
    const what = `la section « ${title} » (${cards$(sec.n)})`;
    return h('button', { class: 'sec-fold', type: 'button', 'aria-expanded': String(!sec.folded), title: (sec.folded ? 'Déplier ' : 'Replier ') + what,
      'aria-label': (sec.folded ? 'Déplier ' : 'Replier ') + what, onClick: () => toggleFold(album, title) },
    [icon('chev', 'sm'), sec.folded ? h('span', { class: 'num' }, '+' + fmt(sec.n)) : null]);
  }
  // « Tout replier » / « Tout déplier » dans la barre de l'album, dès qu'une section a des cartes.
  function foldAllButton(fold) {
    const secs = [...fold.sec.entries()].filter(([, x]) => x.n);
    if (!secs.length) return null;
    const open = secs.some(([, x]) => !x.folded);
    const titles = new Map(fold.slots.filter((s) => fold.sec.has(s.key)).map((s) => [s.key, s.item.title]));
    return h('button', { class: 'btn small', type: 'button', onClick: () => setFolded(fold.album, open ? secs.map(([k]) => titles.get(k)) : []) },
      [icon('chev', 'sm' + (open ? ' chev-down' : '')), open ? 'Tout replier' : 'Tout déplier']);
  }
  function viewCell(c, sep) {
    const sel = S.selected.has(c.id);
    return h('div', { class: ['cell', { selected: sel, pulled: S.openId === c.id, sep }] }, [
      sepFrame(viewCard(c, false, sep), sep),
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
  // Icône « Partager dans le chat » : à côté de « Copier le nom » dans les fiches ; met [[Titre]] dans le champ du chat.
  function shareChatButton(title) {
    return h('button', { class: 'copy-name share-chat', type: 'button', title: 'Partager dans le chat', 'aria-label': `Partager « ${title} » dans le chat`,
      onClick: () => shareInChat(title) }, [icon('chat', 'sm')]);
  }
  // Titre d'une fiche, avec les icônes « Copier le nom » et « Partager dans le chat » à côté (sauf article à vérifier).
  const ficheTitle = (title, copy) => h('div', { class: 'fiche__title' }, [h('h2', { id: 'detail-title' }, title),
    copy ? copyNameButton(title) : null, copy ? shareChatButton(title) : null]);
  // Case vide d'une collection : la carte qui te manque. Toute la case ouvre sa fiche : un bouton étendu sur la case
  // (frère du bouton « Copier le nom », jamais parent : pas de contrôle dans un contrôle), qui passe au-dessus.
  function viewSlot(s, col) {
    const it = s.item;
    const img = it.image || s.thumb;
    let views = '';
    if (it.status === 'ok') views = s.views != null ? `${fmt(s.views)} vues / 30 j` : S.pv.running ? 'vues…' : 'vues inconnues';
    return sepFrame(h('div', { class: ['slot', { pulled: !!S.openMissing && S.openMissing.title === it.title, sep: !!it.sep }], key: s.key }, [
      img ? h('img', { class: 'slot__bg', src: img, alt: '', loading: 'lazy', decoding: 'async', onError: hideBroken }) : null,
      col.ordered ? h('span', { class: 'slot__no', 'aria-hidden': 'true' }, String(s.i)) : null,
      h('button', { class: 'slot__open', type: 'button', title: 'Pas encore dans ta collection : ouvrir la fiche',
        'aria-label': `${it.title}${it.sep ? ', intercalaire' : ''} : pas encore dans ta collection, ouvrir la fiche`, onClick: (e) => openMissingFrom(it, e) }),
      h('div', { class: 'slot__top' }, it.status === 'ok' ? [s.real ? pill(s.real) : pill(s.est, true), copyNameButton(it.title, true)] : []),
      h('h3', null, it.title),
      it.description ? h('p', null, it.description) : null,
      it.status === 'missing' ? h('p', { class: 'warn' }, 'Article introuvable sur Wikipédia') : null,
      it.status === 'disambiguation' ? h('p', { class: 'warn' }, "Page d'homonymie : précise le titre") : null,
      friendBadge(it),
      views ? h('span', { class: 'views' }, views) : null,
    ]), !!it.sep, s.key);
  }
  // Case vide qu'un ami peut remplir (partage entre membres) : « chez Paul ×2 », « +1 » s'il y en a d'autres.
  function friendBadge(item) {
    const list = holdersOf(item);
    if (!list.length) return null;
    const first = list[0];
    const label = `chez ${friendName(first)}${first.count > 1 ? ' ×' + fmt(first.count) : ''}${list.length > 1 ? ' +' + (list.length - 1) : ''}`;
    return h('span', { class: ['slot__friends', { dup: first.count > 1 }], title: 'Chez : ' + list.map((x) => nameWithPseudo(x) + (x.count > 1 ? ` ×${fmt(x.count)}` : '')).join(', ') }, label);
  }
  function viewMini(c, i) {
    const r = okRarity(c.rarity) || 'C';
    return h('span', { class: ['mini', 'r' + r], key: c.id + ':' + i }, c.image ? [h('img', { src: c.image, alt: '', loading: 'lazy', decoding: 'async', onError: hideBroken })] : null);
  }
  function rarityBar(byR, total, cls) {
    return h('span', { class: cls || 'bar', 'aria-hidden': 'true' }, RAR_UP.map((r) => (byR[r]
      ? h('i', { key: r, class: 'r' + r, style: { width: ((100 * byR[r]) / Math.max(1, total)).toFixed(3) + '%' } }) : null)));
  }
  // Collection complète (toutes ses cartes, au moins une) : tour doré et brillant de sa ligne et de l'en-tête de son
  // album (.complete, app.css), « Complète » à la place du pourcentage.
  const isComplete = (p) => p.total > 0 && p.own >= p.total;
  const doneMark = () => h('span', { class: 'done-mark' }, [icon('check', 'sm'), 'Complète']);
  function viewRow(col) {
    const p = progressOf(col);
    const w = worthOf(col);
    const wt = w ? worthText(w) : '';
    const done = isComplete(p);
    const auto = col.kind === 'target' ? autoOf(col.t) : null; // ajout automatique : petite marque
    return h('button', { class: ['row', { zero: !p.own, complete: done }], type: 'button', key: col.key, onClick: () => openAlbum(col.kind, col.id),
      'aria-label': `${col.name} : ${fmt(p.own)} sur ${fmt(p.total)}${done ? ', collection complète' : ''}${wt ? '. ' + wt : ''}${auto ? '. Ajout automatique' : ''}` }, [
      h('span', { class: 'fan', 'aria-hidden': 'true' }, p.sample.length ? p.sample.map(viewMini) : [h('span', { class: 'mini empty' })]),
      h('span', { class: 'info' }, [
        h('span', { class: 'name' }, col.name),
        rarityBar(p.byR, p.total),
        h('span', { class: 'line' }, [h('span', null, [h('b', null, fmt(p.own)), ` sur ${fmt(p.total)}`]), done ? doneMark() : h('span', null, pct(p.own, p.total))]),
        rowWorth(w, wt),
        sourceKind(col),
        auto ? h('span', { class: 'row-kind row-auto', title: 'Ajout automatique : ' + autoRulesText(auto.rules) }, [icon('refresh', 'sm'), 'ajout automatique']) : null,
      ]),
    ]);
  }
  // Ligne discrète d'une collection (la tienne, ou celle d'un ami) : « valeur 2 340W · pour la compléter ~5 100W », le
  // détail au survol ; rien sans cote.
  function rowWorth(w, title) {
    if (!w || (!w.priced && !w.costPriced)) return null;
    return h('span', { class: 'row-value', title: title || worthText(w) }, [
      w.priced ? ['valeur ', priceTag(w.value, { tag: 'span' })] : null,
      w.priced && w.costPriced ? ' · ' : null,
      w.costPriced ? ['pour la compléter ', priceTag(w.cost, { about: true, tag: 'span' })] : null,
    ]);
  }
  // Mention discrète d'une collection faite d'une catégorie ou d'une page de Wikipédia.
  function sourceKind(col) {
    if (col.cat) return h('span', { class: 'row-kind' }, 'depuis la catégorie Wikipédia');
    if (col.page) return h('span', { class: 'row-kind' }, `depuis la page Wikipédia « ${col.page} »${col.column ? `, colonne « ${col.column} »` : ''}${col.sections ? `, ${col.sections.includes(' + ') ? 'sections' : 'section'} « ${col.sections} »` : ''}`);
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
    // Dernière synchro en échec ou incomplète (journal des synchros), tant que rien d'autre n'est affiché ici.
    const ls = S.me && S.me.last_sync;
    const lastBad = !S.refresh.msg && !S.refresh.running && ls && (ls.result === 'error' || ls.result === 'warn') ? ls : null;
    const refreshBits = [
      h('button', { class: 'btn small', type: 'button', disabled: S.refresh.running, onClick: refreshCollection },
        [icon('refresh', S.refresh.running ? 'spin' : ''), S.refresh.running ? 'Rafraîchissement…' : (sess.has_cookie && !sess.expired ? 'Rafraîchir la collection' : 'Mettre à jour avec le favori')]),
      h('span', { class: ['status', { err: S.refresh.error, warn: S.refresh.warn }], 'aria-live': 'polite' }, S.refresh.msg),
      S.refresh.error && !S.refresh.running ? h('button', { class: 'linkish', type: 'button', onClick: openFavori }, 'Passer par le favori') : null,
      lastBad ? h('span', { class: ['status', 'last-sync', lastBad.result === 'error' ? 'err' : 'warn'] },
        `Dernière synchro ${lastBad.result === 'error' ? 'en échec' : 'incomplète'} (${syncKind(lastBad.via, lastBad.kind)}, ${syncWhen(lastBad.at)}) : ${lastBad.message}`) : null,
      lastBad ? h('button', { class: 'linkish', type: 'button', onClick: () => setTab('maj') }, 'Dernières synchros') : null,
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
          [priceTag(M.value.value), h('span', null, `valeur (${fmt(M.value.priced)} ${plural(M.value.priced, 'cotée', 'cotées')})`)]) : null,
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
  // Une seule zone, « Mes collections » (toutes, quelle que soit leur origine), et un seul point d'entrée pour en créer :
  // « Nouvelle collection », une fenêtre avec un onglet par façon de faire (modalEditor) : par URL (ou nom) d'une catégorie
  // ou d'une page de Wikipédia, par mots-clés, par liste d'articles, propositions d'après tes cartes, depuis le jeu.
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
        h('button', { class: 'name row-open', type: 'button', title: 'Ouvrir la catégorie', onClick: () => {
          if (S.modal === 'editor') closeModal();
          openCategory(p.title, { pages: p.size, subcats: p.subcats, withSubs: subs.length > 0 });
        } }, p.name),
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
  // Onglet « Propositions » de « Nouvelle collection » : catégories de Wikipédia de tes cartes dont tu as au moins 5 %
  // (et 2 cartes).
  function viewWpGroup() {
    if (!proposer) return [h('p', { class: 'small muted' }, 'Propositions indisponibles dans ce navigateur.')];
    const hidden = !!S.prefs.hide_proposals;
    const list = wpVisible.value;
    const retired = S.prefs.hidden_proposals.length;
    const toggle = h('button', { class: 'linkish', type: 'button', onClick: () => setHideProposals(!hidden) }, hidden ? 'Afficher les propositions' : 'Masquer les propositions');
    if (hidden) {
      return [h('p', { class: 'small muted' }, "Propositions masquées. Rien n'est cherché sur Wikipédia tant qu'elles le restent."), h('div', { class: 'row-actions' }, [toggle])];
    }
    // Catégories écartées parce que tes collections les couvrent déjà (règle des 80 %) : on le dit, avec la collection qui
    // en couvre le plus (une très grande collection peut en écarter presque toutes).
    const { covered: nCov, coveredBy: top } = wpPruned.value;
    const by = !top ? 'par tes collections' : top[1] === nCov ? `par « ${top[0]} »` : `par tes collections, surtout « ${top[0]} »`;
    const covText = !nCov ? ''
      : list.length ? `${fmt(nCov)} ${plural(nCov, 'autre catégorie de tes cartes écartée car déjà couverte', 'autres catégories de tes cartes écartées car déjà couvertes')} ${by}.`
        : `Pas de nouvelle proposition : ${fmt(nCov)} ${plural(nCov, 'catégorie de tes cartes est écartée car déjà couverte', 'catégories de tes cartes sont écartées car déjà couvertes')} ${by} (au moins 80 % ${plural(nCov, 'de ses cartes y sont', 'de leurs cartes y sont')} déjà).`;
    return [
      S.wp.running ? h('div', { class: 'wp-progress', role: 'status' }, [
        h('progress', { max: Math.max(1, S.wp.total), value: Math.min(S.wp.done, Math.max(1, S.wp.total)), 'aria-label': 'Recherche de propositions' }),
        h('span', null, S.wp.label), h('button', { class: 'linkish', type: 'button', onClick: cancelProposals }, 'Annuler'),
      ]) : null,
      errLine(S.wp.error),
      list.length ? h('div', { class: 'rows' }, list.map(viewWpRow))
        : S.wp.running ? null : !covText ? h('p', { class: 'small muted' }, 'Pas de proposition pour l\'instant : une catégorie de Wikipédia de tes cartes est proposée quand tu en as au moins 5 % (et 2 cartes).') : null,
      covText && !S.wp.running ? h('p', { class: 'small muted wp-covered' }, covText) : null,
      h('div', { class: 'row-actions' }, [
        S.wp.running ? null : h('button', { class: 'linkish', type: 'button', onClick: () => computeProposals(true) }, 'Chercher de nouvelles propositions'),
        retired && !S.wp.running ? h('button', { class: 'linkish', type: 'button', onClick: restoreProposals },
          `Rétablir ${retired > 1 ? 'les ' + fmt(retired) + ' propositions retirées' : 'la proposition retirée'}`) : null,
        toggle,
      ]),
    ];
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
      const mineN = page ? pageCollections(m.title).length : collectionFor('wp:' + m.name) ? 1 : 0;
      return h('li', {
        id: 'cat-opt-' + i, key: (page ? 'p:' : 'c:') + m.title, role: 'option', 'aria-selected': String(i === act), class: { active: i === act },
        onMousedown: (e) => { e.preventDefault(); chooseCat(m); }, onMouseenter: () => { cs.active = i; },
      }, [
        h('span', { class: 'prop-list__name' }, page ? m.title : m.name),
        h('span', { class: 'prop-list__hint' }, mineN ? (mineN > 1 ? `${fmt(mineN)} de tes collections` : 'ta collection')
          : !page && m.subcats ? `${fmt(m.subcats)} ${plural(m.subcats, 'sous-catégorie', 'sous-catégories')}` : ''),
        h('span', { class: 'prop-list__count num' }, page ? (m.list ? 'liste' : 'page') : `${fmt(m.pages)} ${plural(m.pages, 'article', 'articles')}`),
      ]);
    };
    const groupLabel = (type) => (type === 'cat' ? 'Catégories' : urlTitle ? 'Page Wikipédia' : 'Pages de liste');
    return h('div', { class: 'prop-search' }, [
      h('label', { class: 'sr', for: 'cat-q' }, "Chercher une catégorie ou une page de liste de Wikipédia, ou coller l'adresse d'une page"),
      h('input', {
        id: 'cat-q', class: 'field full', type: 'search', value: cs.q, autocomplete: 'off', spellcheck: 'false',
        placeholder: 'https://fr.wikipedia.org/wiki/…',
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
    const props = proposer && !S.prefs.hide_proposals ? wpVisible.value.length : 0;
    const add = (label) => h('button', { class: 'btn primary', type: 'button', onClick: () => openEditor(null) }, [icon('plus', 'sm'), label]);
    return h('div', { class: 'groups' }, [
      h('section', { class: 'group', 'aria-labelledby': 'h-mine' }, [
        h('div', { class: 'section-head' }, [
          h('h2', { id: 'h-mine' }, 'Mes collections'),
          h('span', { class: 'spacer' }),
          // Propositions d'après tes cartes : la fenêtre s'ouvre directement sur elles.
          props && mine.length ? h('button', { class: 'linkish props-link', type: 'button', onClick: () => openEditor(null, 'props') }, [icon('spark', 'sm'),
            `${fmt(props)} ${plural(props, 'proposition', 'propositions')} d'après tes cartes`]) : null,
          mine.length ? add('Nouvelle collection') : null,
        ]),
        mine.length ? h('div', { class: 'rows' }, mine.map(viewRow))
          : h('div', { class: 'empty-box' }, [
            h('p', null, "Aucune collection pour l'instant. Crée-en une depuis l'adresse d'une page ou d'une catégorie de Wikipédia, par mots-clés, avec une liste d'articles, parmi les propositions faites d'après tes cartes, ou depuis le jeu avec ton favori."),
            add('Nouvelle collection'),
            props ? h('button', { class: 'linkish', type: 'button', onClick: () => openEditor(null, 'props') },
              `Voir les ${fmt(props)} ${plural(props, 'proposition', 'propositions')} d'après tes cartes`) : null,
          ]),
      ]),
    ]);
  }
  function seg(label, pressed, onClick, aria) {
    return h('button', { type: 'button', 'aria-pressed': String(pressed), 'aria-label': aria || null, title: aria || null, onClick }, label);
  }
  // Page de Wikipédia ouverte (album) : d'où viennent ses articles. Avec des tableaux (lecture finie) : « Colonne clé »
  // (les colonnes de tableColumns, la présélectionnée par pickColumn, et « Aucune : tous les liens de la page »), ce que la
  // colonne donne et, si elle est dans plusieurs tableaux, lesquels lire (« Sections et tableaux lus » : l'arbre de leurs
  // intertitres, pageSections, une case par section ou par tableau). Sans colonne
  // clé : les articles liés, ceux de leur nature dominante seulement (case cochée) ou tous.
  function viewPageSource(pg, reading) {
    const link = h('a', { href: wikiUrl(pg.title), target: '_blank', rel: 'noopener noreferrer' }, pg.title);
    const top = pg.links ? pg.links.top : null;
    const cols = !reading && pg.links && pg.cols && pg.cols.length ? pg.cols : null;
    const col = cols && pg.col ? cols.find((c) => c.key === pg.col) || null : null;
    const out = [];
    if (cols) {
      const all = top && !pg.allLinks ? top.n : pg.links.items.length;
      out.push(h('label', { class: 'page-key', for: 'page-key' }, [
        h('span', { class: 'page-key__label' }, 'Colonne clé'),
        h('select', { id: 'page-key', class: 'field', value: col ? col.key : '', disabled: pg.busy, onChange: (e) => setPageColumn(e.target.value) }, [
          ...cols.map((c) => h('option', { key: 'c:' + c.key, value: c.key, title: c.label }, `${c.name} (${fmt(c.n)} ${plural(c.n, 'article', 'articles')})`)),
          h('option', { key: 'tous', value: '' }, `Aucune : tous les liens de la page (${fmt(all)})`),
        ]),
      ]));
    }
    if (!col) {
      out.push(h('p', { class: 'hint' }, [cols ? 'Sans colonne clé : les articles liés depuis la page « ' : 'Les articles liés depuis la page « ', link, ' »',
        pg.links && !top && !reading ? ` : tous (${fmt(pg.links.items.length)}), sans nature dominante à filtrer.` : '.',
        pg.tablesError && !reading ? ` Tableaux de la page non lus (${pg.tablesError}).` : '']));
      if (top) {
        out.push(h('label', { class: 'check' }, [
          h('input', { type: 'checkbox', checked: !pg.allLinks, disabled: pg.loading || pg.busy, onChange: toggleAllLinks }),
          ` ne garder que les « ${top.label} » (${fmt(top.n)} sur ${fmt(pg.links.items.length)} articles liés ; décochée : tous les liens)`]));
      }
      return out;
    }
    const used = col.parts.filter((x) => !pg.tableOff.includes(x.t));
    const empty = used.reduce((s, x) => s + x.rows - x.linked, 0);
    const others = pg.tables.list.length - col.parts.length;
    out.push(h('p', { class: 'hint' }, [
      `Le premier article lié de chaque ligne de la colonne « ${col.name} » `,
      used.length > 1 ? `des ${fmt(used.length)} tableaux` : 'du tableau', ' de la page « ', link, ' », dans l\'ordre des lignes : ',
      `${fmt(pg.total)} ${plural(pg.total, 'article', 'articles')}`,
      empty ? ` (${fmt(empty)} ${plural(empty, 'ligne', 'lignes')} sans article : lien rouge, homonymie ou pas de lien)` : '', '.',
      others > 0 ? ` ${others > 1 ? `Les ${fmt(others)} autres tableaux` : "L'autre tableau"} de la page ${others > 1 ? "n'ont" : "n'a"} aucun article dans une colonne « ${col.name} ».` : '',
    ]));
    if (col.parts.length > 1) {
      const tree = pageSections(col, pg.tables);
      const count = (parts) => { const n = new Set(parts.flatMap((x) => x.items.map((i) => i.title))).size; return `${fmt(n)} ${plural(n, 'article', 'articles')}`; };
      const tableName = (x, inSection) => {
        const tb = pg.tables.list[x.t] || {};
        const what = tb.caption || (inSection ? '' : tb.section);
        return `Tableau ${fmt(x.t + 1)}${what ? ' · ' + what : ''}`;
      };
      const tableLi = (x, inSection) => {
        const on = !pg.tableOff.includes(x.t);
        return h('li', { key: 't' + x.t }, h('label', { class: 'check' }, [
          h('input', { type: 'checkbox', checked: on, disabled: pg.busy || (on && used.length === 1), onChange: () => togglePageTable(x.t) }),
          h('span', null, `${tableName(x, inSection)} (${count([x])})`)]));
      };
      // Une section : sa case (cochée si tous ses tableaux le sont, « mixte » si une partie), puis ses sous-sections et,
      // s'il y en a plusieurs ou à côté de sous-sections, ses propres tableaux.
      const sectionLi = (node, key) => {
        const ts = node.parts.map((x) => x.t);
        const n = ts.filter((t) => !pg.tableOff.includes(t)).length;
        const on = n === ts.length;
        const kids = [...node.kids.map((k, i) => sectionLi(k, key + '/' + i)), ...(node.own.length > 1 || node.kids.length ? node.own.map((x) => tableLi(x, true)) : [])];
        return h('li', { key }, [
          h('label', { class: 'check' }, [
            h('input', { type: 'checkbox', checked: on, indeterminate: n > 0 && !on, disabled: pg.busy || (n > 0 && used.every((x) => ts.includes(x.t))),
              onChange: () => setPageTables(ts, !on) }),
            h('span', null, [h('b', null, node.label), ` (${count(node.parts)}${ts.length > 1 ? `, ${fmt(ts.length)} tableaux` : ''})`])]),
          kids.length ? h('ul', null, kids) : null,
        ]);
      };
      // Ouvert d'emblée quand les tableaux sont rangés dans des sections (« En France », « À l'étranger »…).
      out.push(h('details', { class: 'page-tables', open: tree.kids.length > 0 }, [
        h('summary', null, `${tree.kids.length ? 'Sections et tableaux lus' : 'Tableaux lus'} : ${fmt(used.length)} sur ${fmt(col.parts.length)}`),
        h('ul', null, [...tree.kids.map((k, i) => sectionLi(k, 's' + i)), ...tree.own.map((x) => tableLi(x, false))]),
      ]));
    }
    return out;
  }
  // Tes collections déjà faites depuis la page ouverte (une par choix de colonne et de sections) : chacune s'ouvre d'un clic.
  function viewPageMine(pg) {
    const mine = pageCollections(pg.title);
    if (!mine.length) return null;
    return h('p', { class: 'hint page-mine' }, [mine.length > 1 ? 'Tes collections de cette page : ' : 'Ta collection de cette page : ',
      ...mine.flatMap((t, i) => [i ? ', ' : '', h('button', { key: t.id, class: 'linkish', type: 'button', onClick: () => openAlbum('target', t.id) }, t.name)]), '.']);
  }
  // Sections des tableaux d'une colonne clé, d'après leurs intertitres (path de readTables) : un arbre
  // {label, kids (sous-sections, dans l'ordre de la page), own (tableaux juste sous cet intertitre), parts (tous ses
  // tableaux)} ; la racine (label '') garde les tableaux sans intertitre.
  function pageSections(col, tables) {
    const node = (label) => ({ label, kids: [], own: [], parts: [] });
    const root = node('');
    for (const x of col.parts) {
      const tb = (tables && tables.list[x.t]) || {};
      let cur = root;
      cur.parts.push(x);
      for (const s of tb.path || (tb.section ? [tb.section] : [])) {
        let k = cur.kids.find((y) => y.label === s);
        if (!k) { k = node(s); cur.kids.push(k); }
        cur = k;
        cur.parts.push(x);
      }
      cur.own.push(x);
    }
    return root;
  }
  // Choix en cours d'une page ouverte : {source, name, col, sections} de la collection que « Créer une collection »
  // ferait. Sans colonne clé : « links:<titre> » ; la colonne et tous ses tableaux : « links:<titre>#<colonne> » ; une
  // partie de ses tableaux : « …#§<sections> », les sections entièrement cochées les plus hautes (et les tableaux cochés
  // seuls sous une section en partie cochée : leur légende, ou « Tableau N »), séparées par « + » ; un intertitre qui a un
  // homonyme dans la page garde celui au-dessus (« Gares desservies en 2026 › En France »). Nom : celui de la page, « — »
  // et les sections. Source de plus de 200 caractères : sections coupées, avec une empreinte de leur texte entier.
  function pageSelection(cv) {
    const col = cv.col && cv.cols ? cv.cols.find((c) => c.key === cv.col) || null : null;
    if (!col) return { source: cv.key, name: cv.name, col: null, sections: null };
    const all = cv.key.length < 199 ? (cv.key + '#' + col.name).slice(0, 200) : cv.key;
    const off = new Set(cv.tableOff.filter((t) => col.parts.some((x) => x.t === t)));
    if (!off.size) return { source: all, name: cv.name, col, sections: null };
    const base = all.slice(0, 180);
    const tree = pageSections(col, cv.tables);
    const seen = new Map();
    const count = (n) => { for (const k of n.kids) { seen.set(k.label, (seen.get(k.label) || 0) + 1); count(k); } };
    count(tree);
    const picks = [];
    const tableLabel = (x) => { const tb = (cv.tables && cv.tables.list[x.t]) || {}; return tb.caption || `Tableau ${fmt(x.t + 1)}`; };
    const walk = (node, parent) => {
      const on = node.parts.filter((x) => !off.has(x.t));
      if (!on.length) return;
      if (node.label && on.length === node.parts.length) {
        picks.push(seen.get(node.label) > 1 && parent ? `${parent} › ${node.label}` : node.label);
        return;
      }
      for (const k of node.kids) walk(k, node.label);
      for (const x of node.own) if (!off.has(x.t)) picks.push(tableLabel(x));
    };
    walk(tree, '');
    const sections = picks.join(' + ');
    let src = base + '#§' + sections;
    if (src.length > 200) {
      let hsh = 0x811c9dc5; // FNV-1a
      for (let i = 0; i < sections.length; i++) { hsh ^= sections.charCodeAt(i); hsh = Math.imul(hsh, 0x01000193) >>> 0; }
      src = src.slice(0, 200 - 9) + '…' + hsh.toString(36).padStart(8, '0').slice(-8);
    }
    const full = `${cv.name} — ${sections}`;
    return { source: src, name: full.length > 80 ? full.slice(0, 79) + '…' : full, col, sections };
  }
  function viewAlbum() {
    const col = activeAlbum.value;
    if (!col) {
      return h('div', { class: 'album-head' }, [
        h('button', { class: 'back', type: 'button', onClick: closeAlbum }, '← Toutes les collections'),
        h('p', { class: 'muted' }, "Cette collection n'existe plus."),
      ]);
    }
    const ro = reorderOf(col);
    if (ro) return viewReorder(col, ro);
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
    // Wikipédia » ; collection : « Ajouter par tags du jeu », « Modifier », « Supprimer » (et « Voir sur Wikipédia »
    // pour celle faite d'une catégorie ou d'une page).
    const wpLink = (title) => h('a', { class: 'btn ghost', href: wikiUrl(title), target: '_blank', rel: 'noopener noreferrer' }, 'Voir sur Wikipédia ↗');
    const tooBig = !!cv && cv.total > LIST_MAX;
    const pg = cv && cv.type === 'page' ? cv : null; // page de Wikipédia ouverte : ses liens
    const pgTop = pg && pg.links ? pg.links.top : null;
    let actions;
    if (cv) {
      const mineT = catCollection(cv);
      // « Créer une collection » de sa proposition en cours (S.wp.busy) : en attente ici aussi, l'album passera à la
      // collection créée. Pendant la lecture, le bouton reste cliquable (avec la roue) : la collection est créée dès
      // qu'elle finit (cv.queued) ; grisé seulement après une erreur de lecture.
      const creating = cv.busy || !!S.wp.busy[cv.key];
      const queued = reading && cv.queued;
      const turning = creating || (reading && !cv.error);
      actions = [
        mineT ? h('button', { class: 'btn primary', type: 'button', onClick: () => openAlbum('target', mineT.id) }, 'Ouvrir ta collection')
          : h('button', { class: 'btn primary', type: 'button', disabled: creating || tooBig || (reading ? queued || !!cv.error : !cv.items.length), 'aria-busy': turning ? 'true' : null,
            title: reading && !queued && !cv.error ? 'Lecture en cours : la collection sera créée dès qu\'elle se termine.' : null, onClick: createFromCategory },
            [icon(turning ? 'refresh' : 'plus', turning ? 'sm spin' : 'sm'), creating ? 'Un instant…' : queued ? 'Créée dès la fin de la lecture…' : 'Créer une collection']),
        wpLink(cv.title),
      ];
    } else {
      actions = [
        h('button', { class: 'btn', type: 'button', onClick: () => openTagAdd(col) }, [icon('tag', 'sm'), 'Ajouter par tags du jeu']),
        h('button', { class: 'btn', type: 'button', onClick: () => openEditor(col.t) }, [icon('pen', 'sm'), 'Modifier']),
        // « Réorganiser » (2 éléments au moins) ; « Réorganiser… » d'une collection sans ordre : pourquoi (explainUnordered).
        viewReorderButton(col),
        // « Fusionner avec… » : seulement s'il y a une autre collection avec qui fusionner.
        targets.value.length > 1 ? h('button', { class: 'btn', type: 'button', onClick: () => openMerge(col.t) }, [icon('merge', 'sm'), 'Fusionner avec…']) : null,
        h('button', { class: 'btn danger', type: 'button', onClick: () => askDeleteTarget(col.t) }, [icon('trash', 'sm'), 'Supprimer']),
        // Faite des tableaux d'une page : la rouvrir pour en faire une autre collection (d'autres sections, tout ensemble).
        col.page && col.column ? h('button', { class: 'btn', type: 'button', onClick: () => openPage(col.page, true) }, [icon('plus', 'sm'), 'Autres sections de la page']) : null,
        col.cat ? wpLink(CAT_NS + catName(col.t.source)) : col.page ? wpLink(col.page) : null,
      ];
    }
    const total = albumFold.value.slots.length;
    const shown = visibleSlots.value.length;
    // Valeur de la collection (tes cartes) et ce qu'il faudrait pour la compléter (SPEC.md, « Le marché »).
    const w = reading ? null : worthOf(col);
    const done = !cv && isComplete(p); // une de tes collections, complète (pas une catégorie à créer)
    return h('div', null, [
      h('div', { class: 'album-head' }, [
        h('button', { class: 'back', type: 'button', onClick: closeAlbum }, '← Toutes les collections'),
        h('div', { class: ['album-title', { complete: done }] }, [h('h2', { id: 'album-name', tabindex: '-1' }, col.name), reading ? null : h('span', { class: 'num' }, `${fmt(p.own)} sur ${fmt(p.total)}`),
          done ? doneMark() : null,
          w && w.priced ? h('span', { class: 'album-value' }, ['Valeur : ', priceTag(w.value), ` (${pricedOf(w.priced, w.cards)})`]) : null,
          cv ? h('span', { class: 'badge' }, pg ? 'page de Wikipédia' : 'catégorie de Wikipédia') : sourceKind(col)]),
        cv && cv.subcats ? h('label', { class: 'check' }, [
          h('input', { type: 'checkbox', checked: cv.withSubs, disabled: cv.loading || cv.busy, onChange: toggleCatSubs }),
          ` inclure les sous-catégories (1 niveau : ${fmt(cv.subcats)})`]) : null,
        // Page : la colonne clé de ses tableaux, ou les articles qu'elle lie (nature dominante seulement, ou tous).
        ...(pg ? viewPageSource(pg, reading) : []),
        pg ? viewPageMine(pg) : null,
        reading ? (cv.error ? null : h('p', { class: 'wait-line', role: 'status' }, [icon('refresh', 'spin'),
          cv.step || (pg ? 'Lecture des liens de la page sur Wikipédia et de leur nature sur Wikidata…' : 'Lecture des articles de la catégorie sur Wikipédia…'),
          cv.queued ? ' La collection sera créée à la fin.' : ''])) : rarityBar(p.byR, p.total, 'bar big'),
        cv && cv.error ? h('p', { class: 'status err', role: 'alert' }, [cv.error, ' ', h('button', { class: 'linkish', type: 'button', onClick: () => loadCategory() }, 'Réessayer')]) : null,
        tooBig ? h('p', { class: 'warn' }, pg && pg.col ? 'Plus de 20 000 articles dans cette colonne : trop pour une collection (décoche des tableaux). Seuls les 20 000 premiers sont montrés.'
          : pg ? `Plus de 20 000 articles liés : trop pour une collection${pgTop && pg.allLinks ? ' (ne garde que les « ' + pgTop.label + ' »)' : ''}. Seuls les 20 000 premiers sont montrés.`
          : 'Plus de 20 000 articles : trop grande pour une collection. Seuls les 20 000 premiers sont montrés.') : null,
        !reading && ownLine ? h('div', { class: 'missing-sum' }, ownLine) : null,
        reading ? null : h('div', { class: 'missing-sum' }, missLine),
        w && w.costPriced ? h('div', { class: 'missing-sum worth-sum', title: "Pour chaque carte qui manque, la moins chère de ses cotes fiables (3 ventes au moins), toutes raretés d'exemplaire confondues : n'importe quel exemplaire remplit la case. Cotes connues : celles des cartes que ton favori a trouvées dans le jeu." }, [
          h('span', null, ['Pour la compléter : ', priceTag(w.cost, { about: true })]),
          h('span', null, `(${pricedOf(w.costPriced, w.missing)} qui ${plural(w.missing, 'manque', 'manquent')}, à la moins chère de leurs cotes)`),
        ]) : null,
        !reading && missing > 0 ? h('p', { class: 'hint', 'aria-live': 'polite' }, hint) : null,
        // Actions de la collection sur leur propre ligne, au-dessus des filtres et des tris (2026-10-18 : avec
        // « Réorganiser » et « Fusionner avec… », elles ne tenaient plus sur la même ligne).
        h('div', { class: 'toolbar album-actions' }, actions),
        cv ? null : viewAutoLine(col),
        h('div', { class: 'toolbar' }, [
          h('div', { class: 'seg', role: 'group', 'aria-label': 'Filtrer' }, [
            seg('Toutes', S.albumFilter === 'all', () => { S.albumFilter = 'all'; }),
            seg('Possédées', S.albumFilter === 'owned', () => { S.albumFilter = 'owned'; }),
            seg('Manquantes', S.albumFilter === 'missing', () => { S.albumFilter = 'missing'; }),
          ]),
          h('div', { class: 'seg seg--four', role: 'group', 'aria-label': 'Trier' }, [
            seg(col.ordered ? 'Ordre' : 'A → Z', S.albumSort === 'order', () => { S.albumSort = 'order'; }),
            seg('Rareté', S.albumSort === 'rarity', () => { S.albumSort = 'rarity'; }),
            seg('Prix ↑', S.albumSort === 'price-up', () => { S.albumSort = 'price-up'; loadMarket(false); }, 'Prix croissant'),
            seg('Prix ↓', S.albumSort === 'price-down', () => { S.albumSort = 'price-down'; loadMarket(false); }, 'Prix décroissant'),
          ]),
          foldAllButton(albumFold.value),
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
  // Album d'une collection qui a un ajout automatique : « Ajout automatique : tag du jeu « Maladie », … », « Changer les
  // règles » (la fenêtre, règles cochées) et « Arrêter » (règles effacées, cartes déjà ajoutées gardées).
  function viewAutoLine(col) {
    const auto = col.kind === 'target' ? autoOf(col.t) : null;
    if (!auto) return null;
    const n = auto.skip.length;
    const busy = S.autoBusy === col.t.id;
    return h('div', { class: 'auto-line' }, [
      icon('refresh', 'sm'),
      h('span', { class: 'auto-line__text' }, [h('b', null, 'Ajout automatique : '), autoRulesText(auto.rules),
        n ? h('span', { class: 'auto-line__skip' }, ` · ${cards$(n)} ${plural(n, 'exclue', 'exclues')}`) : null]),
      h('span', { class: 'auto-line__actions' }, [
        h('button', { class: 'linkish', type: 'button', disabled: busy, onClick: () => openTagAdd(col) }, 'Changer les règles'),
        h('button', { class: 'linkish', type: 'button', disabled: busy, 'aria-label': `Arrêter l'ajout automatique de « ${col.name} »`, onClick: () => stopAuto(col.t) },
          busy ? 'Un instant…' : 'Arrêter'),
      ]),
    ]);
  }
  // « Réorganiser » dans l'album d'une de tes collections (2 éléments au moins) : le mode réorganisation si elle a un ordre,
  // sinon « Réorganiser… », qui dit pourquoi elle reste de A à Z (explainUnordered).
  function viewReorderButton(col) {
    if (col.kind !== 'target' || col.items.length < 2) return null;
    return col.ordered
      ? h('button', { id: 'reorder-btn', class: 'btn', type: 'button', onClick: () => startReorder(col) }, [icon('move', 'sm'), 'Réorganiser'])
      : h('button', { id: 'reorder-btn', class: 'btn', type: 'button', title: 'Elle s\'affiche de A à Z : pourquoi, et que faire', onClick: () => explainUnordered(col) }, [icon('move', 'sm'), 'Réorganiser…']);
  }
  // Mode réorganisation (S.reorder) : en-tête réduit (nom, aide), toutes les vignettes (ReorderGrid), barre du bas.
  function viewReorder(col, r) {
    const n = r.order.length;
    return h('div', { class: 'reorder' }, [
      h('div', { class: 'album-head' }, [
        h('button', { class: 'back', type: 'button', onClick: closeAlbum }, '← Toutes les collections'),
        h('div', { class: 'album-title' }, [h('h2', { id: 'album-name', tabindex: '-1' }, col.name),
          h('span', { class: 'num' }, `${fmt(n)} ${plural(n, 'élément', 'éléments')}`), h('span', { class: 'badge' }, 'Réorganisation')]),
        h('p', { class: 'hint reorder-help', id: 'reorder-help' }, [
          'Glisse une carte à sa place (au doigt, par sa poignée ', icon('grip', 'sm'), sr('poignée'), '), ou utilise ← et →. ',
          'Choisis une carte pour la mettre en tête, à la fin ou à une position (barre du bas). ',
          'Un intercalaire garde son rôle : il ouvre toujours une nouvelle ligne. Rien n\'est envoyé avant « Enregistrer l\'ordre ».',
        ]),
      ]),
      h(ReorderGrid),
      viewReorderBar(r),
    ]);
  }
  // Barre du bas du mode réorganisation : l'élément choisi (position, « En tête », « À la fin », « Position »), « Annuler »,
  // « Enregistrer l'ordre », et l'annonce de chaque déplacement pour les lecteurs d'écran (role=status, cachée à l'œil :
  // la position visible change déjà sur la vignette et ici).
  function viewReorderBar(r) {
    const n = r.order.length;
    const k = r.active;
    const at = k == null ? -1 : r.order.indexOf(k);
    const item = at >= 0 ? r.base[k] : null;
    return h('div', { class: 'reorder-bar', role: 'region', 'aria-label': 'Réorganisation' }, [
      item ? h('div', { class: 'reorder-bar__item' }, [
        h('span', { class: 'reorder-bar__name' }, [h('b', null, item.title), h('span', { class: 'num' }, ` · ${fmt(at + 1)} sur ${fmt(n)}`)]),
        h('span', { class: 'reorder-bar__acts' }, [
          h('button', { class: 'btn small', type: 'button', disabled: r.busy, 'aria-disabled': at === 0 ? 'true' : null, onClick: () => { if (moveTo(k, 0)) showTile(k); } }, 'En tête'),
          h('button', { class: 'btn small', type: 'button', disabled: r.busy, 'aria-disabled': at === n - 1 ? 'true' : null, onClick: () => { if (moveTo(k, n - 1)) showTile(k); } }, 'À la fin'),
          h('form', { class: 'reorder-bar__pos', onSubmit: (e) => { e.preventDefault(); moveToTyped(); } }, [
            h('label', { class: 'sr', for: 'reorder-pos' }, `Nouvelle position de « ${item.title} » (1 à ${fmt(n)})`),
            h('input', { id: 'reorder-pos', class: 'field', type: 'number', inputmode: 'numeric', min: '1', max: String(n), step: '1', value: r.pos, placeholder: 'N°',
              onInput: (e) => { r.pos = e.target.value; } }),
            h('button', { class: 'btn small', type: 'submit', disabled: r.busy || !String(r.pos).trim() }, 'Déplacer'),
          ]),
        ]),
      ]) : h('p', { class: 'reorder-bar__hint small muted' }, 'Choisis une carte pour la mettre en tête, à la fin ou à une position précise.'),
      h('div', { class: 'reorder-bar__end' }, [
        h('span', { class: ['reorder-bar__state', 'small', { dirty: r.dirty }] }, r.dirty
          ? [h('span', { class: 'long' }, 'Ordre modifié, pas encore enregistré'), h('span', { class: 'short' }, 'Non enregistré')]
          : [h('span', { class: 'long' }, 'Ordre inchangé'), h('span', { class: 'short' }, 'Inchangé')]),
        h('button', { class: 'btn', type: 'button', disabled: r.busy, onClick: cancelReorder }, 'Annuler'),
        h('button', { class: 'btn primary', type: 'button', disabled: r.busy || !r.dirty, 'aria-busy': r.busy ? 'true' : null, onClick: saveOrder },
          r.busy ? 'Enregistrement…' : 'Enregistrer l\'ordre'),
      ]),
      errLine(r.error),
      h('p', { class: 'sr', role: 'status' }, r.said ? [h('span', { key: r.saidN }, r.said)] : []),
    ]);
  }
  // Vignette réduite d'un élément (mode réorganisation, fantôme du glisser) : son image (ta carte, sinon l'article), ou
  // son initiale.
  function roArt(s) {
    const it = s.item;
    const img = s.card ? s.card.image : it.image || s.thumb;
    return h('span', { class: 'ro-art', 'aria-hidden': 'true' }, [
      h('span', { class: 'ro-noart' }, initialOf(it.title)),
      img ? h('img', { src: img, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false', onError: hideBroken }) : null,
    ]);
  }
  // Une vignette du mode réorganisation : numéro, poignée (au doigt), image, titre, « ← » / « → ». Ta carte : bord de sa
  // rareté ; case vide : bord pointillé ; intercalaire : bord et onglet gris. Les flèches restent actives aux deux bouts
  // (aria-disabled : le focus ne se perd pas, l'annonce dit « déjà en tête »). Clics et glisser : délégués à la grille.
  function viewRoTile(s, n, last, active, lifted) {
    const it = s.item;
    const c = s.card;
    const r = c ? okRarity(c.rarity) || 'C' : null;
    return h('li', { class: ['ro-tile', r ? 'r' + r : 'ro-tile--missing', { sep: !!it.sep, active, lifted }], 'data-k': String(s.k) }, [
      roArt(s),
      h('span', { class: 'ro-no' }, fmt(n)),
      h('span', { class: 'ro-grip', title: 'Glisser pour déplacer', 'aria-hidden': 'true' }, [icon('grip')]),
      h('span', { class: 'ro-title' }, [it.title, it.sep ? sr(', intercalaire') : null, c ? null : sr(', pas encore dans ta collection')]),
      h('span', { class: 'ro-moves' }, [
        h('button', { class: 'ro-move', type: 'button', 'data-act': 'prev', title: 'Une place avant', 'aria-label': `« ${it.title} » : une place avant`, 'aria-disabled': n === 1 ? 'true' : null }, '←'),
        h('button', { class: 'ro-move', type: 'button', 'data-act': 'next', title: 'Une place après', 'aria-label': `« ${it.title} » : une place après`, 'aria-disabled': last ? 'true' : null }, '→'),
      ]),
    ]);
  }

  // ================================================================ rendu : onglet Mes cartes
  function facetChip(key, label, n, on, onClick, title) {
    return h('button', { key, class: 'chip', type: 'button', 'aria-pressed': String(on), title, onClick }, [h('span', { class: 'chip__label' }, label), h('span', { class: 'n' }, fmt(n))]);
  }
  const GTAG_FACET = 24; // tags du jeu montrés d'abord dans « Mes cartes »
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
    // Tags du jeu (posés dans wiki-masters.com) : les plus portés d'abord, GTAG_FACET puis « Afficher les N autres » ;
    // couleur du jeu en pastille.
    const glist = gameTagList.value;
    const gshown = S.gtagsAll ? glist : glist.slice(0, GTAG_FACET);
    return h('aside', { class: 'facets', 'aria-label': 'Tags' }, [
      h('div', { class: 'facet' }, [
        h('h3', null, 'Raccourcis'),
        h('div', { class: 'chips' }, [
          facetChip('untagged', 'Sans tag', untaggedCount.value, S.untaggedOnly, toggleUntagged),
          newIds.value.length ? facetChip('new', 'Nouvelles du dernier rafraîchissement', newIds.value.length, S.newOnly, toggleNew) : null,
        ]),
      ]),
      h('div', { class: 'facet' }, [
        h('h3', null, ['Tags du jeu', glist.length > 1 ? h('span', { class: 'hint-inline' }, 'Ctrl/⌘+clic : combiner') : null]),
        glist.length ? h('div', { class: 'chips' }, gshown.map((g) => h('button', { key: 'g:' + g.key, class: 'chip gchip', type: 'button', style: gtagStyle(g.color),
          'aria-pressed': String(S.gtagFilter.includes(g.key)), title: `Tag posé dans le jeu · Ctrl/⌘+clic : combiner`, onClick: (e) => toggleGtagFilter(g.key, e) },
        [h('span', { class: 'chip__label' }, g.label), h('span', { class: 'n' }, fmt(g.n))])))
          : h('p', { class: 'small muted' }, "Aucun tag du jeu lu pour l'instant : ceux que tu poses sur tes cartes dans wiki-masters.com arrivent avec une mise à jour complète par le favori (celui du 18 octobre 2026 ou plus récent)."),
        glist.length > GTAG_FACET ? h('button', { class: 'linkish', type: 'button', onClick: () => { S.gtagsAll = !S.gtagsAll; } },
          S.gtagsAll ? 'Afficher moins' : `Afficher les ${fmt(glist.length - GTAG_FACET)} autres`) : null,
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
      ...S.gtagFilter.map((k) => { const label = (gameTags.value.get(k) || { label: k }).label; return filterChip('gtag:' + k, 'Jeu : ' + label, () => { S.gtagFilter = S.gtagFilter.filter((x) => x !== k); }, `Retirer le filtre du tag du jeu ${label}`); }),
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
          h('select', { id: 'sort', value: S.sort, onChange: (e) => { S.sort = e.target.value; if (isPriceSort(S.sort)) loadMarket(false); } }, SORTS.map(([v, l]) => h('option', { key: v, value: v }, l))),
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
    if (!hasKey && S.bm.checking) {
      button = h('p', { class: 'muted', role: 'status' }, 'Préparation du favori…');
    } else if (!hasKey) {
      button = h('div', { class: 'notice' }, [
        h('p', null, "Pour fabriquer ton favori, le classeur crée une clé d'import : elle ne sert qu'à envoyer des cartes, jamais à ouvrir ton classeur."),
        S.bm.stale ? h('p', { class: 'warn', role: 'status' }, "Le favori gardé dans ce navigateur était périmé : un favori plus récent a été créé sur un autre appareil ou navigateur, avant que le classeur ne garde sa clé. Crée un nouveau favori ici et remplace l'ancien dans ta barre ; ensuite, tes autres appareils retrouveront ce même favori ici, sans le recréer.")
          : elsewhere ? h('p', { class: 'warn' }, 'Tu as déjà un favori (sur un autre navigateur, ou avant que celui-ci ne l\'oublie) : en créer un ici le remplace, et l\'ancien cessera de marcher.') : null,
        h('button', { class: 'btn primary', type: 'button', disabled: S.bm.busy, onClick: createImportKey }, S.bm.busy ? 'Création…' : elsewhere || S.bm.stale ? 'Créer un nouveau favori' : 'Créer mon favori'),
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
      h('p', { class: 'small muted' }, "« Mettre à jour les cotes », dans l'encart du favori : il lit les cotes du marché, les bonnes affaires et tes enchères pour l'onglet « Marché », directement dans la base du jeu avec ta session ; relié, il le fait aussi tout seul toutes les 20 minutes et après tes enchères et tes ventes (voir « À savoir » dans cet onglet ; « Couper les cotes automatiques » dans son encart). Un favori installé avant le 17 octobre 2026 ne lit les cotes qu'au clic (avant le 16, il n'a pas ce bouton) : glisse à nouveau celui-ci dans ta barre."),
      h('p', { class: 'small muted' }, ['Barre de favoris cachée ? ', h('kbd', null, 'Ctrl'), '+', h('kbd', null, 'Maj'), '+', h('kbd', null, 'B'),
        ' (', h('kbd', null, '⌘'), '+', h('kbd', null, 'Maj'), '+', h('kbd', null, 'B'), ' sur Mac).']),
      hasKey ? h('h3', null, 'Sur téléphone : le favori court') : null,
      hasKey ? h('p', { class: 'small muted' }, "Le favori complet est trop long pour un téléphone (il fait planter le navigateur). Crée un favori sur n'importe quelle page, nomme-le « Classeur », et remplace son adresse par ce favori court ; puis, sur wiki-masters.com, tape « Classeur » dans la barre d'adresse et choisis le favori. Il charge le code du favori depuis le classeur à chaque clic : il faut le réseau, et c'est toujours la dernière version (pas besoin de le recréer après une mise à jour). Il marche aussi sur ordinateur.") : null,
      hasKey ? copyRow('bm-short', shortFavoriUrl.value, 'Adresse du favori court') : null,
      hasKey ? h('h3', null, 'Le créer à la main (ordinateur)') : null,
      hasKey ? h('p', { class: 'small muted' }, "Si le glisser ne marche pas : crée un favori sur n'importe quelle page, nomme-le « Classeur », et remplace son adresse par ceci.") : null,
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
  // « Dernières synchros » (journal des synchros) : heure, chemin et type, résultat, message lisible ; les 20 plus récentes.
  function viewSyncLog() {
    const list = syncLog.entries;
    const rows = (list || []).slice(0, 20);
    let body;
    if (list === null) body = h('p', { class: 'small muted', role: 'status' }, syncLog.busy ? 'Lecture du journal…' : '');
    else if (!rows.length) body = h('p', { class: 'small muted' }, 'Aucune synchro notée pour l\'instant : elles apparaîtront ici (favori, favori relié, cookie), réussies ou non.');
    else body = h('ul', { class: 'synclog-list' }, rows.map((x, i) => viewSyncRow(x, i)));
    return h('div', { class: 'panel synclog', style: { gridColumn: '1 / -1' } }, [
      h('div', { class: 'synclog-head' }, [
        h('h3', null, 'Dernières synchros'),
        h('button', { class: 'btn small ghost', type: 'button', disabled: syncLog.busy, onClick: loadSyncLog }, [icon('refresh', syncLog.busy ? 'sm spin' : 'sm'), 'Actualiser']),
      ]),
      oldFavori.value ? h('p', { class: 'notice warn-box' }, "Ta dernière synchro vient d'un favori d'avant le 18 octobre 2026 : glisse le nouveau favori (ci-dessus) dans ta barre à la place de l'ancien, et recolle le script Tampermonkey si tu t'en sers. Le nouveau lit aussi les tags que tu poses sur tes cartes dans le jeu, relit une page restée vide, vérifie que ta collection n'a pas bougé pendant la lecture et signale ici ses échecs.") : null,
      body,
      errLine(syncLog.error),
    ]);
  }
  function viewSyncRow(x, i) {
    const d = x.data || {};
    const repeat = Number(d.repeat) > 1 ? ` · ${fmt(d.repeat)} fois${d.first ? ` depuis ${syncWhen(d.first)}` : ''}` : '';
    return h('li', { key: i + ':' + x.at, class: ['synclog-row', 'is-' + x.result] }, [
      h('div', { class: 'synclog-line' }, [
        h('span', { class: 'synclog-badge' }, RESULT_LABEL[x.result] || x.result),
        h('span', { class: 'synclog-what' }, syncKind(d.via, x.kind)),
        h('span', { class: 'synclog-when' }, syncWhen(x.at) + repeat),
      ]),
      h('p', { class: 'synclog-msg' }, x.message),
    ]);
  }
  function viewUpdate() {
    return h('div', { class: 'update' }, [viewFavori(), viewCookie(), viewFullNext(), viewSyncLog()]);
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
      section('Ton pseudo dans WikiMasters', [
        h('p', { class: 'small muted' }, "Visible par les membres avec qui tu partages tes cartes (« Entre amis »), avec un lien vers ton profil du jeu : pour qu'ils te trouvent et t'envoient des échanges."),
        h('form', { class: 'line', onSubmit: (e) => { e.preventDefault(); savePseudo(); } }, [
          h('label', { class: 'sr', for: 'set-pseudo' }, 'Ton pseudo dans WikiMasters'),
          h('input', { id: 'set-pseudo', class: 'field', value: st.pseudo, maxlength: 40, autocomplete: 'nickname', spellcheck: 'false', placeholder: 'Ton pseudo dans le jeu',
            onInput: (e) => { st.pseudo = e.target.value; st.pSaved = false; } }),
          h('button', { class: 'btn', type: 'submit', disabled: st.pBusy }, st.pBusy ? 'Enregistrement…' : 'Enregistrer'),
        ]),
        st.pSaved ? h('p', { class: 'status ok', role: 'status' }, st.pseudo ? 'Enregistré.' : 'Pseudo retiré.') : null,
        errLine(st.pError),
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
    return h('span', { class: 'holders' }, list.map((x) => h('span', { key: x.id, class: ['holder', { dup: x.count > 1 }], title: pseudoTip(x) },
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
    const fw = friendWorths.value.get(f.id);
    return h('div', { class: 'row member', key: f.id }, [
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, initialOf(friendName(f))),
      h('span', { class: 'info' }, [
        h('span', { class: 'name' }, friendName(f)),
        viewPseudo(f, 'pseudo-' + f.id),
        h('span', { class: 'line' }, [h('span', null, [h('b', null, fmt(f.count)), ' ' + plural(f.count, 'carte', 'cartes')]), h('span', null, syncedOn(f))]),
        fw && fw.priced ? h('span', { class: 'line', title: FRIEND_WORTH }, [h('span', null, ['valeur ', priceTag(fw.value)]), h('span', null, pricedOf(fw.priced, fw.cards))]) : null,
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
        h('span', { class: 'fcol__name' }, friendWho(x.f)),
        // « 3 de tes cartes complètent « A », « B » et « C » » : ses collections concernées, les plus complétées d'abord.
        h('span', { class: 'fcol__sum' }, [h('b', null, fmt(x.rows.length)),
          ` de tes cartes ${plural(x.rows.length, 'complète', 'complètent')} ${namesText(rankNames(x.rows, (r) => r.cols.map((c) => c.name)), true)}`,
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
  const personWho = (p) => (p.me ? 'Toi' : friendWho(p.f));
  const andList = (names) => (names.length > 1 ? names.slice(0, -1).join(', ') + ' et ' + names[names.length - 1] : names[0] || '');
  // Trois noms au plus (entre guillemets pour des collections) : « A », « B » et « C » ; au-delà, « A », « B », « C » et
  // 2 autres.
  function namesText(names, quote) {
    const list = quote ? names.map((n) => `« ${n} »`) : names;
    return list.length > 3 ? `${list.slice(0, 3).join(', ')} et ${fmt(list.length - 3)} autres` : andList(list);
  }
  // Noms cités par des lignes (collections, personnes), du plus au moins cité (une fois par ligne), puis de A à Z.
  function rankNames(rows, namesOf) {
    const n = new Map();
    for (const r of rows) for (const name of new Set(namesOf(r))) n.set(name, (n.get(name) || 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1] || COLLATOR.compare(a[0], b[0])).map(([name]) => name);
  }
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
        h('span', { class: 'fcol__name' }, [personWho(p.x), h('span', { class: 'trade__arrow', 'aria-hidden': 'true' }, ' → '), h('span', { class: 'sr' }, ' pour '), personWho(p.z)]),
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
            [h('option', { value: '' }, 'Un membre…'), ...friendList.value.map((f) => h('option', { key: f.id, value: f.id }, nameWithPseudo(f)))]),
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
    const done = isComplete(p);
    return h('button', { class: ['row', { zero: !p.own, complete: done }], type: 'button', key: r.key, onClick: () => openFriendAlbum(f.id, r.t.id, null),
      'aria-label': `${r.t.name} : ${friendName(f)} en a ${fmt(p.own)} sur ${fmt(p.total)}${done ? ', collection complète' : ''}${p.priced ? `, valeur ${wfmt(p.value)}` : ''}${p.help ? `, tu as ${fmt(p.help)} ${plural(p.help, 'carte', 'cartes')} qui lui ${plural(p.help, 'manque', 'manquent')}` : ''}` }, [
      h('span', { class: 'fan', 'aria-hidden': 'true' }, p.sample.length ? p.sample.map(viewMini) : [h('span', { class: 'mini empty' })]),
      h('span', { class: 'info' }, [
        h('span', { class: 'name' }, r.t.name),
        r.t.cat ? h('span', { class: 'row-kind' }, 'depuis la catégorie Wikipédia') : null,
        rarityBar(p.byR, p.total),
        h('span', { class: 'line' }, [h('span', null, [h('b', null, fmt(p.own)), ` sur ${fmt(p.total)}`]), done ? doneMark() : h('span', null, pct(p.own, p.total))]),
        rowWorth(p, p.priced ? `Valeur de ses cartes de cette collection : ${wfmt(p.value)} (${pricedOf(p.priced, p.cards)}). ${FRIEND_WORTH}` : ''),
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
    const sep = !!s.item.sep;
    const label = `${c.title}, ${RARITY_NAME[r]}${c.shiny ? ', brillante' : ''}${c.count > 1 ? `, ${fmt(c.count)} exemplaires` : ''}${sep ? ', intercalaire' : ''} chez ${friendName(f)}, `
      + `${have ? "tu l'as" : want ? 'manque à ' + colsText(want, ', ') : 'te manque'} : ouvrir la fiche`;
    return h('div', { class: ['cell', { pulled: !!S.openMissing && !!S.openMissing.friend && S.openMissing.title === s.item.title, sep }], key: s.key }, [
      sepFrame(h('article', { class: ['card', 'card--friend', 'card--fa', 'r' + r, { shiny: c.shiny, have, want: !!want }], role: 'button', tabindex: '0', 'aria-label': label,
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
      ]), sep),
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
    return sepFrame(h('div', { class: ['slot', { can: !!mine, pulled: !!S.openMissing && !!S.openMissing.friend && S.openMissing.title === it.title, sep: !!it.sep }], key: s.key }, [
      img ? h('img', { class: 'slot__bg', src: img, alt: '', loading: 'lazy', decoding: 'async', onError: hideBroken }) : null,
      fa.ordered ? h('span', { class: 'slot__no', 'aria-hidden': 'true' }, String(s.i)) : null,
      h('button', { class: 'slot__open', type: 'button', title: `Manque à ${friendName(f)} : ouvrir la fiche`,
        'aria-label': `${it.title}${it.sep ? ', intercalaire' : ''} : manque à ${friendName(f)}${give}, ouvrir la fiche`, onClick: (e) => openFriendItem(f, s, e) }),
      h('div', { class: 'slot__top' }, [s.real ? pill(s.real) : pill(s.est, true), copyNameButton(it.title, true)]),
      h('h3', null, it.title),
      mine && mine.category ? h('p', null, mine.category) : null,
      mine ? h('div', { class: 'slot__give' }, [h('span', { class: 'slot__friends' }, "tu l'as"),
        n > 1 ? h('span', { class: 'slot__friends dup', title: `Tu en as ${fmt(n)} exemplaires` }, `×${fmt(n)} en double`) : null]) : null,
      views ? h('span', { class: 'views' }, views) : null,
    ]), !!it.sep, s.key);
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
    const worth = friendTargetsView.value && friendTargetsView.value.byId.get(t.id); // valeur de ses cartes ici (friendProgressFor)
    for (const s of all) {
      if (s.card) { own++; byR[s.card.rarity] = (byR[s.card.rarity] || 0) + 1; if (!s.mine && s.want) want++; continue; }
      if (s.mine) { help++; if ((Number(s.mine.count) || 1) >= 2) helpDup++; }
      if (s.real) { missG[s.real] = (missG[s.real] || 0) + 1; continue; }
      estimated++;
      if (s.est) missR[s.est] = (missR[s.est] || 0) + 1; else unknown++;
    }
    const total = all.length;
    const missing = total - own;
    const done = isComplete({ own, total }); // sa collection complète : en-tête doré, comme les tiennes
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
    const sections = showSections(fa.ordered, fr.albumSort, fr.albumFilter);
    const fold = foldSlots(friendSlots.value, sections, fa.key);
    const list = fold.slots;
    const shown = list.slice(0, fr.albumLimit);
    const setFilter = (v) => () => { fr.albumFilter = v; fr.albumLimit = ALBUM_PAGE; };
    const empty = fr.albumFilter === 'help' ? `Tu n'as aucune des cartes qui manquent à ${name} ici.`
      : fr.albumFilter === 'has' ? `${name} n'a encore aucune carte de cette collection.` : fr.albumFilter === 'lacks' ? 'Il ne lui en manque aucune.' : 'Cette collection est vide.';
    return h('div', null, [
      h('div', { class: 'album-head' }, [
        backLine,
        h('div', { class: ['album-title', { complete: done }] }, [h('h2', null, t.name), h('span', { class: 'num' }, `${name} en a ${fmt(own)} sur ${fmt(total)}`),
          done ? doneMark() : null,
          worth && worth.p.priced ? h('span', { class: 'album-value', title: FRIEND_WORTH }, ['Valeur : ', priceTag(worth.p.value), ` (${pricedOf(worth.p.priced, worth.p.cards)})`]) : null,
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
          h('div', { class: 'seg seg--four', role: 'group', 'aria-label': 'Trier' }, [
            seg(fa.ordered ? 'Ordre' : 'A → Z', fr.albumSort === 'order', () => { fr.albumSort = 'order'; fr.albumLimit = ALBUM_PAGE; }),
            seg('Rareté', fr.albumSort === 'rarity', () => { fr.albumSort = 'rarity'; fr.albumLimit = ALBUM_PAGE; }),
            seg('Prix ↑', fr.albumSort === 'price-up', () => { fr.albumSort = 'price-up'; fr.albumLimit = ALBUM_PAGE; loadMarket(false); }, 'Prix croissant'),
            seg('Prix ↓', fr.albumSort === 'price-down', () => { fr.albumSort = 'price-down'; fr.albumLimit = ALBUM_PAGE; loadMarket(false); }, 'Prix décroissant'),
          ]),
          foldAllButton(fold),
          h('span', { class: 'spacer' }),
          ...actions,
        ]),
      ]),
      list.length ? h('div', { class: 'cardgrid' }, albumKids(shown, sections, (s) => (s.card ? viewFriendAlbumCard(s, f) : viewFriendSlot(s, fa)), fold))
        : h('div', { class: 'empty-box' }, empty),
      shown.length < list.length ? h('div', { class: 'show-more' }, [h('button', { class: 'btn', type: 'button', onClick: () => { fr.albumLimit += ALBUM_PAGE; } },
        `Afficher les ${fmt(Math.min(ALBUM_PAGE, list.length - shown.length))} suivantes (${fmt(list.length - shown.length)} restantes)`)]) : null,
    ]);
  }
  function viewFriendBinder(f) {
    const fr = S.friends;
    const st = friendStats.value.get(f.id);
    const fw = friendWorths.value.get(f.id);
    const list = friendCardsView.value;
    const shown = list.slice(0, fr.limit);
    return h('div', null, [
      h('div', { class: 'album-head' }, [
        h('button', { class: 'back', type: 'button', onClick: closeFriendBinder }, '← Entre amis'),
        h('div', { class: 'album-title' }, [h('h2', null, `Le classeur de ${friendName(f)}`), h('span', { class: 'num' }, `${cards$(f.count)} · ${syncedOn(f)}`),
          fw && fw.priced ? h('span', { class: 'album-value' }, ['Valeur : ', priceTag(fw.value), `, ${pricedOf(fw.priced, fw.cards)}`]) : null,
          h('span', { class: 'badge' }, 'lecture seule')]),
        f.pseudo ? h('p', { class: 'missing-sum' }, [viewPseudo(f, 'pseudo-b-' + f.id)]) : null,
        st ? h('div', { class: 'missing-sum' }, [h('span', null, [h('b', null, fmt(st.missing)), ` ${plural(st.missing, 'carte', 'cartes')} que tu n'as pas`]),
          st.dup ? h('span', null, ['· dont ', h('b', null, fmt(st.dup)), ` en double chez ${friendName(f)}`]) : null]) : null,
        fw && fw.priced ? h('p', { class: 'hint' }, 'Valeur : ' + FRIEND_WORTH[0].toLowerCase() + FRIEND_WORTH.slice(1)) : null,
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
              [['rarity', 'Rareté'], ['price-up', 'Prix ↑'], ['price-down', 'Prix ↓'], ['count', 'Exemplaires'], ['title', 'Titre']].map(([v, l]) => h('option', { key: v, value: v }, l))),
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
    const giveTo = pairs.filter((p) => p.x.me);
    const getFrom = pairs.filter((p) => p.z.me);
    const give = giveTo.reduce((a, p) => a + p.rows.length, 0);
    const get = getFrom.reduce((a, p) => a + p.rows.length, 0);
    const others = pairs.filter((p) => !p.x.me && !p.z.me).reduce((a, p) => a + p.rows.length, 0);
    // Qui en profite : les amis à qui tes cartes servent le plus (« les collections de Paul et Léa »), et tes collections
    // que leurs cartes complètent le plus (« « Planètes » et « Couleurs » »).
    const giveNames = giveTo.slice().sort((a, b) => b.rows.length - a.rows.length || COLLATOR.compare(friendName(a.z.f), friendName(b.z.f))).map((p) => friendName(p.z.f));
    const getNames = rankNames(getFrom.flatMap((p) => p.rows), (r) => r.cols.map((c) => c.name));
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
        S.me && S.me.user && !S.me.user.pseudo ? h('p', { class: 'small muted pseudo-ask' }, ['Ajoute ton pseudo du jeu pour que tes amis te trouvent dans WikiMasters : ',
          h('button', { class: 'linkish', type: 'button', onClick: openSettings }, 'Réglages'), '.']) : null,
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
            h('b', null, fmt(give)), ` de tes cartes ${plural(give, 'peut', 'peuvent')} compléter les collections ${giveNames.length ? 'de ' + namesText(giveNames, false) : 'de tes amis'} ; `,
            h('b', null, fmt(get)), ` de leurs cartes ${plural(get, 'peut', 'peuvent')} compléter ${getNames.length ? namesText(getNames, true) : 'les tiennes'}`,
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
  // texte passe tel quel à Vue (échappé), seuls les liens http(s) deviennent des <a> (rel=noopener), les cartes citées
  // ([[Titre]]) des boutons qui ouvrent leur fiche (titre en texte) et les mentions (@Prénom) des pastilles ; un message
  // qui te mentionne est mis en avant et compté à part dans le badge.
  const CHAT_MAX = 500;
  const CHAT_EVERY = 12 * 1000;
  const CHAT_IDLE_EVERY = 30 * 1000;
  const CHAT_IDLE_AFTER = 5 * 60 * 1000;
  const CHAT_KEY_LINK = /#cle=[A-Za-z0-9_-]{20,}/;
  const CHAT_URL = /\bhttps?:\/\/[^\s<>"«»]+/gi;
  // Carte citée dans un message : [[Titre de la carte]] (un titre de Wikipédia : 1 à 300 caractères, sans [ ] { } | # < >
  // ni retour à la ligne). Le texte envoyé ne change pas ; la page la montre en pastille qui ouvre la fiche de la carte.
  const CHAT_CARD = /\[\[([^[\]{}|#<>\n]{1,300})\]\]/g;
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
  // Non lus qui te mentionnent (parmi les non lus).
  const chatUnreadPings = computed(() => {
    const read = S.chat.read;
    let n = 0;
    for (const m of chatMsgs.value) if (m.id > read && !m.mine && chatInfo(m).me) n++;
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
  // Morceaux d'un message : cartes citées ({text, card: titre}, « [[rihanna]] » -> « Rihanna »), puis, entre elles,
  // texte brut et liens (linkify). Un lien entre crochets (« [[https://…]] ») reste un lien.
  function chatParts(text) {
    const out = [];
    let last = 0;
    for (const m of text.matchAll(CHAT_CARD)) {
      const title = normTitle(m[1]);
      if (!title || /^https?:/i.test(title)) continue;
      if (m.index > last) out.push(...linkify(text.slice(last, m.index)));
      out.push({ text: m[0], card: title });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(...linkify(text.slice(last)));
    return out;
  }
  // Mentions : « @ » puis le prénom (users.name) d'un membre, tel quel, sans distinction de casse ; « @ » en début de mot
  // (pas « a@b.fr ») et prénom suivi d'autre chose qu'une lettre ou un chiffre. Prénoms reconnus : le tien, ceux des
  // membres qui montrent leurs cartes et ceux des auteurs des messages lus ; le plus long l'emporte (« @Jo Anne » plutôt
  // que « @Jo »). Un prénom qui contient des espaces marche donc aussi.
  const CHAT_WORD = /[\p{L}\p{N}_]/u;
  const chatPeople = computed(() => {
    const src = friendList.value.length ? friendList.value : chatMembers.value;
    const seen = new Set();
    const out = [];
    for (const f of src) {
      const name = typeof f.name === 'string' ? f.name.trim() : '';
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push(name);
    }
    return out.sort(COLLATOR.compare);
  });
  // Pseudos dans le jeu par prénom (sans casse) : ceux des membres qui montrent leurs cartes (les seuls que le serveur
  // donne, et seulement si tu montres les tiennes), pour le nom des messages, les mentions et les suggestions de « @ ».
  const chatPseudos = computed(() => {
    const src = friendList.value.length ? friendList.value : chatMembers.value;
    const m = new Map();
    for (const f of src) if (f.pseudo && typeof f.name === 'string' && f.name.trim()) m.set(f.name.trim().toLowerCase(), f.pseudo);
    return m;
  });
  const pseudoOf = (name) => (typeof name === 'string' && chatPseudos.value.get(name.trim().toLowerCase())) || null;
  const chatNames = computed(() => {
    const myName = (S.me && S.me.user && S.me.user.name) || '';
    const all = new Map();
    const add = (n) => { if (typeof n === 'string' && n.trim()) all.set(n.trim().toLowerCase(), n.trim()); };
    add(myName);
    chatPeople.value.forEach(add);
    for (const m of chatMsgs.value) add(m.author);
    return { list: [...all.keys()].sort((a, b) => b.length - a.length), me: myName.trim().toLowerCase() };
  });
  // Texte brut en morceaux : texte et mentions ({text: '@Paul', at: true, me: te mentionne}).
  function atParts(text, names) {
    const out = [];
    let last = 0;
    for (let i = text.indexOf('@'); i >= 0; i = text.indexOf('@', i + 1)) {
      if (i > 0 && CHAT_WORD.test(text[i - 1])) continue;
      const rest = text.slice(i + 1).toLowerCase();
      const name = names.list.find((n) => rest.startsWith(n) && !CHAT_WORD.test(rest.charAt(n.length)));
      if (!name) continue;
      if (i > last) out.push({ text: text.slice(last, i) });
      out.push({ text: text.slice(i, i + 1 + name.length), at: true, me: name === names.me });
      last = i + 1 + name.length;
      i = last - 1;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }
  // Morceaux d'un message avec ses mentions, et s'il te mentionne (pas tes propres messages) ; refait quand les prénoms
  // connus changent.
  const chatInfoCache = new WeakMap();
  function chatInfo(m) {
    const names = chatNames.value;
    let x = chatInfoCache.get(m);
    if (x && x.names === names) return x;
    const parts = [];
    let me = false;
    for (const p of m.parts) {
      if (p.card || p.url) { parts.push(p); continue; }
      for (const q of atParts(p.text, names)) { parts.push(q); if (q.me) me = true; }
    }
    x = { names, parts, me: me && !m.mine };
    chatInfoCache.set(m, x);
    return x;
  }
  function prepChatMsg(m) {
    const id = Number(m && m.id);
    if (!Number.isInteger(id) || id <= 0) return null;
    const text = String(m.text || '');
    return markRaw({ id, mine: m.mine === true, author: typeof m.author === 'string' && m.author ? m.author : null, text, at: String(m.created_at || ''), parts: chatParts(text) });
  }
  // Pastille d'une carte citée : la fiche de ta carte, sinon celle d'une carte que tu n'as pas (ce qu'en disent tes
  // collections, puis l'article vérifié sur Wikipédia : checkChatCard).
  function openChatCard(title, ev) {
    const c = findCard({ title });
    if (c) { openCardFrom(c.id, ev); return; }
    const k = titleKey(title);
    let known = null;
    for (const t of targets.value) { known = t.items.find((it) => it.status === 'ok' && titleKey(it.title) === k) || null; if (known) break; }
    openMissingFrom({ ...(known || { title, description: null, image: null, status: 'ok' }), chat: true, checking: true }, ev);
    checkChatCard(S.openMissing);
  }
  // Article d'une carte citée dans le chat, vérifié sur Wikipédia (une requête : redirection, homonymie, description,
  // qid, vignette et vues sur 30 jours, dans le cache des vues des albums) ; fiche mise à jour si elle est encore
  // ouverte. Une redirection vers une de tes cartes (même qid) ouvre la sienne ; le qid appris sert aussi aux pastilles.
  async function checkChatCard(opened) {
    const title = opened.title;
    const pages = new Map();
    const alias = {};
    let views = null;
    try {
      let cont = {};
      for (let guard = 0; guard < 10; guard++) {
        const j = await getJson(wikiQ, wpUrl({ action: 'query', redirects: '1', prop: 'pageprops|description|pageimages|pageviews', ppprop: 'disambiguation|wikibase_item',
          piprop: 'thumbnail', pithumbsize: '330', pvipdays: '30', titles: title, ...cont }), 3);
        const q = (j && j.query) || {};
        Object.assign(alias, aliasOf(q));
        for (const p of q.pages || []) {
          if (p.pageviews) views = (views || 0) + Object.values(p.pageviews).reduce((s, x) => s + (x || 0), 0);
          pages.set(p.title, Object.assign(pages.get(p.title) || {}, p));
        }
        if (!j.continue) break;
        cont = j.continue;
      }
    } catch (e) {
      if (S.openMissing === opened) S.openMissing = markRaw({ ...opened, checking: false });
      return; // Wikipédia indisponible : la fiche garde ce qu'elle sait
    }
    const p = pages.get(resolve(alias, title));
    let item;
    if (!p || p.missing || p.invalid) item = { ...opened, status: 'missing', checking: false };
    else {
      const thumb = (p.thumbnail && p.thumbnail.source) || null;
      const q = (p.pageprops && p.pageprops.wikibase_item) || null;
      item = { ...opened, title: p.title, description: opened.description || p.description || null, image: opened.image || thumb,
        status: p.pageprops && 'disambiguation' in p.pageprops ? 'disambiguation' : 'ok', qid: opened.qid || q, checking: false };
      pvCache.set(p.title, [views, thumb]);
      S.pv.version++;
      if (resolver && q) { resolver.remember([[title, q], [p.title, q]]); qidVersion.value++; }
    }
    if (S.openMissing !== opened) return;
    const mine = item.status === 'ok' ? findCard(item) : null;
    if (mine) openCardById(mine.id); else S.openMissing = markRaw(item);
  }
  // « Partager dans le chat » (fiches) : [[Titre]] au bout du brouillon du chat (sauf s'il y est déjà), puis l'onglet
  // Chat, le curseur à la fin du champ. Rien n'est envoyé : on complète son message, puis Entrée.
  function shareInChat(title) {
    const c = S.chat;
    const link = '[[' + title + ']]';
    if (!c.draft.includes(link)) {
      const next = c.draft + (c.draft && !/\s$/.test(c.draft) ? ' ' : '') + link + ' ';
      if (next.length > CHAT_MAX) { notify(`Ton message en cours est trop long pour y ajouter « ${title} » (${CHAT_MAX} caractères au plus).`, true); return; }
      c.draft = next;
    }
    c.sendError = '';
    c.ac = null;
    if (S.modal) closeModal();
    closeCard();
    setTab('chat');
    nextTick(() => {
      const t = document.getElementById('chat-input');
      if (!t) return;
      t.focus();
      if (typeof t.setSelectionRange === 'function') t.setSelectionRange(t.value.length, t.value.length);
    });
  }
  // Autocomplétion du champ : « @ » propose les membres qui montrent leurs cartes (il faut montrer les siennes : c'est ce
  // que permet GET /api/members) et insère « @Prénom » ; « # » suivi d'une lettre propose des cartes (les tiennes, celles
  // de tes collections, celles des amis déjà lues, puis, dès 2 lettres, les articles de Wikipédia qui commencent par le
  // texte tapé : toute carte du jeu en est un) et insère « [[Titre]] ». Flèches, Entrée ou Tab, Échap ; rien de
  // choisi : le texte reste tel quel.
  const CHAT_AC_MAX = 8;
  const CHAT_AC_SPAN = 60; // caractères tapés après le @ ou le # au plus
  // Le @ ou le # avant le curseur (même ligne, en début de mot), et ce qui a été tapé depuis.
  function chatTrigger(value, caret) {
    for (let i = caret - 1; i >= 0 && i >= caret - CHAT_AC_SPAN - 1; i--) {
      const ch = value[i];
      if (ch === '\n') return null;
      if (ch !== '@' && ch !== '#') continue;
      if (i > 0 && CHAT_WORD.test(value[i - 1])) return null;
      const q = value.slice(i + 1, caret);
      if (/^\s|\s\s/.test(q)) return null;
      if (ch === '#' && !/^\p{L}/u.test(q)) return null;
      return { kind: ch, start: i, end: caret, q };
    }
    return null;
  }
  // Prénoms des membres qui montrent leurs cartes, sans leurs cartes ; inutile si « Entre amis » les a déjà lus.
  function loadChatMembers() {
    if (!sharing() || friendList.value.length || chatMembersJob || (chatMembersAt && Date.now() - chatMembersAt < FRIENDS_TTL)) return;
    const gen = friendsGen;
    const job = api('GET', '/api/members').then((r) => {
      if (gen !== friendsGen) return;
      chatMembers.value = (Array.isArray(r.members) ? r.members : []).filter((m) => m && typeof m.name === 'string' && m.name)
        .map((m) => markRaw({ name: m.name, pseudo: typeof m.pseudo === 'string' && m.pseudo ? m.pseudo : null }));
      chatMembersAt = Date.now();
    }).catch(() => { /* la liste reste vide : on tape le prénom à la main */ }).finally(() => { if (chatMembersJob === job) chatMembersJob = null; });
    chatMembersJob = job;
  }
  // Cartes proposées après « # » : les tiennes (avec leur rareté), puis les éléments de tes collections et les cartes des
  // amis, une fois par titre.
  const chatCardChoices = computed(() => {
    const out = new Map();
    const add = (title, own, rarity) => {
      const t = normTitle(title);
      const k = titleKey(t);
      if (!t || out.has(k)) return;
      out.set(k, { title: t, f: fold(t), own, rarity: own ? rarity : null });
    };
    for (const c of cards.value) add(c.title, true, c.rarity);
    for (const t of targets.value) for (const it of t.items) if (it.status === 'ok') add(it.title, false);
    for (const f of friendList.value) for (const c of f.cards || []) add(c.title, false);
    return [...out.values()];
  });
  // Articles de Wikipédia par préfixe (list=prefixsearch, 8 au plus, dans l'ordre de Wikipédia : les plus consultés
  // d'abord), 250 ms après la dernière frappe ; une recherche périmée est abandonnée.
  let chatWpTimer = null;
  let chatWpCtrl = null;
  function stopChatWp() {
    clearTimeout(chatWpTimer);
    chatWpTimer = null;
    if (chatWpCtrl) { chatWpCtrl.abort(); chatWpCtrl = null; }
    if (S.chat.acWp.loading) S.chat.acWp = { q: '', titles: [], loading: false };
  }
  function chatWpSearch(text) {
    const c = S.chat;
    const q = text.trim();
    const k = fold(q);
    if (k.length < 2) { stopChatWp(); return; }
    if (c.acWp.q === k) return; // déjà cherché, ou en cours
    stopChatWp();
    c.acWp = { q: k, titles: [], loading: true };
    const gen = chatGen;
    chatWpTimer = setTimeout(async () => {
      chatWpTimer = null;
      const ctrl = new AbortController();
      chatWpCtrl = ctrl;
      let titles = [];
      try {
        const j = await getJson(wikiQ, wpUrl({ action: 'query', list: 'prefixsearch', pssearch: q, psnamespace: '0', pslimit: String(CHAT_AC_MAX) }), 4, null, ctrl.signal);
        titles = ((j && j.query && j.query.prefixsearch) || []).map((r) => String((r && r.title) || '')).filter(Boolean);
      } catch (e) {
        if (ctrl.signal.aborted) return; // Wikipédia indisponible : les cartes connues restent proposées
      } finally {
        if (chatWpCtrl === ctrl) chatWpCtrl = null;
      }
      if (gen === chatGen && c.acWp.q === k) c.acWp = { q: k, titles, loading: false };
    }, 250);
  }
  const chatAcList = computed(() => {
    const ac = S.chat.ac;
    if (!ac) return [];
    const q = fold(ac.q);
    // Rang : le nom tapé en entier, puis il commence par ce qui est tapé, puis un mot commence par lui, puis (3 lettres
    // ou plus) il le contient.
    const rank = (f) => (f === q.trim() ? -1 : f.startsWith(q) ? 0 : f.includes(' ' + q) ? 1 : q.length >= 3 && f.includes(q) ? 2 : 9);
    if (ac.kind === '@') {
      const me = chatNames.value.me;
      return chatPeople.value.filter((n) => n.toLowerCase() !== me).map((n) => ({ n, r: rank(fold(n)) }))
        .filter((x) => x.r < 9).sort((a, b) => a.r - b.r || COLLATOR.compare(a.n, b.n)).slice(0, CHAT_AC_MAX)
        .map(({ n }) => ({ key: 'm:' + n, label: '@' + n, insert: '@' + n, hint: pseudoOf(n) }));
    }
    const hits = [];
    const seen = new Set();
    for (const c of chatCardChoices.value) { const r = rank(c.f); if (r < 9) { hits.push([r, c]); seen.add(titleKey(c.title)); } }
    // Articles de Wikipédia pas déjà proposés ; un article trouvé par une redirection (son titre ne contient pas le texte
    // tapé) vient après les autres. À rang égal : les tiennes, puis les autres cartes connues (la plus courte d'abord),
    // puis les articles dans l'ordre de Wikipédia.
    const wp = S.chat.acWp;
    if (wp.q === fold(ac.q.trim())) {
      wp.titles.forEach((title, i) => {
        const k = titleKey(title);
        if (seen.has(k)) return;
        seen.add(k);
        const f = fold(title);
        const mine = findCard({ title }); // une de tes cartes, trouvée par une redirection : avec sa rareté
        hits.push([Math.min(rank(f), 3), { title, f, own: !!mine, rarity: mine ? mine.rarity : null, wp: i + 1 }]);
      });
    }
    return hits.sort(([ra, a], [rb, b]) => ra - rb || (b.own - a.own) || (a.wp || 0) - (b.wp || 0) || a.title.length - b.title.length || COLLATOR.compare(a.title, b.title))
      .slice(0, CHAT_AC_MAX).map(([, c]) => ({ key: 'c:' + c.title, label: c.title, insert: '[[' + c.title + ']]', own: c.own, rarity: c.rarity }));
  });
  // Après une frappe ou un déplacement du curseur : liste ouverte, mise à jour ou fermée.
  function updateChatAc(t) {
    const c = S.chat;
    const caret = t && typeof t.selectionStart === 'number' ? t.selectionStart : c.draft.length;
    const tr = t && typeof t.selectionEnd === 'number' && t.selectionEnd !== caret ? null : chatTrigger(c.draft, caret);
    const off = c.acOff;
    if (!tr || !off || off.start !== tr.start || !tr.q.startsWith(off.q)) c.acOff = null;
    if (!tr || c.acOff !== null) { c.ac = null; stopChatWp(); return; }
    if (tr.kind === '@') { loadChatMembers(); stopChatWp(); } else chatWpSearch(tr.q);
    const same = c.ac && c.ac.kind === tr.kind && c.ac.start === tr.start && c.ac.q === tr.q;
    c.ac = { ...tr, active: same ? c.ac.active : 0 };
  }
  function pickChatAc(item) {
    const c = S.chat;
    const ac = c.ac;
    if (!ac || !item) return;
    const after = c.draft.slice(ac.end);
    const ins = item.insert + (/^\s/.test(after) ? '' : ' ');
    const next = c.draft.slice(0, ac.start) + ins + after;
    c.ac = null;
    stopChatWp();
    if (next.length > CHAT_MAX) { notify(`Ton message est trop long pour y ajouter « ${item.label} » (${CHAT_MAX} caractères au plus).`, true); return; }
    c.draft = next;
    c.sendError = '';
    const pos = ac.start + ins.length + (/^\s/.test(after) ? 1 : 0);
    nextTick(() => {
      const t = document.getElementById('chat-input');
      if (!t) return;
      t.focus();
      if (typeof t.setSelectionRange === 'function') t.setSelectionRange(pos, pos);
    });
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
    loadChatMembers(); // prénoms des membres : pastilles des mentions et suggestions de « @ »
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
    Object.assign(S.chat, { user: null, status: 'idle', error: '', draft: '', sending: false, sendError: '', older: false, olderBusy: false, read: 0, newBelow: false, ac: null, acOff: null,
      acWp: { q: '', titles: [], loading: false } });
    stopChatWp();
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
      if (c.draft.replace(/\r\n?/g, '\n').trim() === text) { c.draft = ''; c.ac = null; } // tapé de nouveau pendant l'envoi : gardé
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
  // Suggestions ouvertes : flèches pour choisir, Entrée ou Tab pour insérer, Échap pour fermer.
  function onChatKey(e) {
    chatTouch();
    const ac = S.chat.ac;
    if (ac && !e.isComposing && e.keyCode !== 229) {
      const list = chatAcList.value;
      if (e.key === 'Escape') { e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); S.chat.acOff = { start: ac.start, q: ac.q }; S.chat.ac = null; stopChatWp(); return; }
      if (list.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        ac.active = (Math.min(ac.active, list.length - 1) + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length;
        return;
      }
      if (list.length && ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Tab' && !e.shiftKey))) {
        e.preventDefault();
        pickChatAc(list[Math.min(ac.active, list.length - 1)]);
        return;
      }
    }
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
  // Badge des non-lus, et à côté « @2 » (couleur d'alerte) pour ceux qui te mentionnent.
  function chatTabLabel(label) {
    const n = S.tab === 'chat' ? 0 : chatUnread.value;
    if (!n) return label;
    const p = chatUnreadPings.value;
    const said = ' ' + plural(n, 'message non lu', 'messages non lus') + (p ? `, dont ${p} ${plural(p, 'te mentionne', 'te mentionnent')}` : '');
    return [label, h('span', { class: 'tab-badge' }, [n > 99 ? '99+' : String(n), sr(said)]),
      p ? h('span', { class: 'tab-badge ping', 'aria-hidden': 'true' }, '@' + (p > 99 ? '99+' : String(p))) : null];
  }
  function viewChatMsg(m) {
    // Les miens : mon prénom actuel (renommé dans Réglages, il change aussitôt) ; ceux des autres : à la lecture.
    const who = (m.mine && S.me && S.me.user && S.me.user.name) || m.author || 'Sans prénom';
    const info = chatInfo(m);
    // Son pseudo dans le jeu, discret, avec un lien vers son profil (pas sur les tiens : les autres ne le voient que si
    // tu leur montres tes cartes).
    const pseudo = m.mine ? null : pseudoOf(m.author);
    return h('div', { key: m.id, class: ['chat-msg', { mine: m.mine, ping: info.me }] }, [
      h('div', { class: 'chat-msg__head' }, [
        h('span', { class: 'chat-msg__who' }, who),
        m.mine ? h('span', { class: 'chat-msg__me' }, '(toi)') : null,
        pseudo ? h('a', { class: 'chat-msg__pseudo', href: gameProfileUrl(pseudo), target: '_blank', rel: 'noopener noreferrer',
          title: `Pseudo dans le jeu : ${pseudo} (son profil dans le jeu)` }, pseudo) : null,
        info.me ? h('span', { class: 'chat-msg__ping' }, 'te mentionne') : null,
        h('time', { class: 'chat-msg__time', datetime: m.at, title: dateLong(m.at) }, chatWhen(m.at)),
        m.mine ? h('button', { class: 'chat-msg__del', type: 'button', title: 'Supprimer ce message', 'aria-label': 'Supprimer ce message', onClick: () => askDeleteChat(m) },
          [icon('trash', 'sm'), h('span', { class: 'chat-msg__del-label', 'aria-hidden': 'true' }, 'Supprimer')]) : null,
      ]),
      h('p', { class: 'chat-msg__text' }, info.parts.map((p) => (p.card ? viewChatCard(p.card)
        : p.at ? h('span', { class: ['chat-at', { me: p.me }], title: p.me ? null : pseudoTip({ pseudo: pseudoOf(p.text.slice(1)) }) }, p.text)
        : p.url ? h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer nofollow ugc' }, p.text) : p.text))),
    ]);
  }
  // Pastille d'une carte citée : ta carte (avec sa rareté), ou une carte que tu n'as pas (bord en pointillés).
  function viewChatCard(title) {
    const c = findCard({ title });
    const r = c ? okRarity(c.rarity) : null;
    return h('button', { class: ['chat-card', { own: !!c }], type: 'button', title: c ? 'Ta carte : ouvrir sa fiche' : "Pas dans ton classeur : ouvrir sa fiche",
      'aria-label': c ? `Ta carte « ${title} »${r ? ' (' + RARITY_NAME[r] + ')' : ''} : ouvrir sa fiche` : `Carte « ${title} », pas dans ton classeur : ouvrir sa fiche`,
      onClick: (e) => openChatCard(title, e) }, [c ? pill(c.rarity) : null, h('span', { class: 'chat-card__name' }, title)]);
  }
  function viewChatForm() {
    const c = S.chat;
    const n = c.draft.length;
    const ac = c.ac;
    const list = ac ? chatAcList.value : [];
    const act = list.length ? Math.min(ac.active, list.length - 1) : 0;
    const open = list.length > 0;
    // Sans suggestion : pourquoi (« @ » : il faut montrer ses cartes, liste en cours de lecture ; « # » : recherche en cours).
    const status = !ac || open ? ''
      : ac.kind === '#' ? (c.acWp.loading ? 'Recherche sur Wikipédia…' : '')
      : !sharing() ? 'Seuls les membres qui montrent leurs cartes peuvent être mentionnés, et il faut montrer les tiennes (Réglages) pour les voir ici.'
      : chatMembersJob && !chatPeople.value.length ? 'Lecture des membres…'
      : !ac.q && !chatPeople.value.length ? "Aucun autre membre ne montre ses cartes pour l'instant." : '';
    const option = (it, i) => h('li', {
      id: 'chat-ac-' + i, key: it.key, role: 'option', 'aria-selected': String(i === act), class: { active: i === act },
      onMousedown: (e) => { e.preventDefault(); pickChatAc(it); }, onMouseenter: () => { if (c.ac) c.ac.active = i; },
    }, [
      it.own ? pill(it.rarity) : null,
      h('span', { class: 'prop-list__name' }, it.label),
      ac.kind === '#' && !it.own ? h('span', { class: 'prop-list__hint' }, 'pas dans ton classeur')
        : it.hint ? h('span', { class: 'prop-list__hint', title: 'Pseudo dans le jeu' }, it.hint) : null,
    ]);
    return h('form', { class: 'chat-form', onSubmit: (e) => { e.preventDefault(); sendChat(false); } }, [
      h('label', { class: 'sr', for: 'chat-input' }, 'Ton message'),
      h('div', { class: 'chat-field' }, [
        h('textarea', { id: 'chat-input', class: 'chat-input', rows: 2, maxlength: CHAT_MAX, value: c.draft, placeholder: 'Écris un message…', 'aria-describedby': 'chat-hint chat-tip',
          role: 'combobox', 'aria-multiline': 'true', 'aria-expanded': String(open), 'aria-controls': 'chat-ac', 'aria-autocomplete': 'list',
          'aria-activedescendant': open ? 'chat-ac-' + act : null,
          onInput: (e) => { c.draft = e.target.value; if (c.sendError) c.sendError = ''; chatTouch(); updateChatAc(e.target); }, onKeydown: onChatKey,
          // Curseur déplacé (flèches, clic) : la liste suit le @ ou le # sous le curseur.
          onKeyup: (e) => { if (/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) updateChatAc(e.target); },
          onClick: (e) => updateChatAc(e.target),
          onBlur: () => { c.ac = null; stopChatWp(); } }),
        open ? h('ul', { id: 'chat-ac', class: 'prop-list chat-ac', role: 'listbox', 'aria-label': ac.kind === '@' ? 'Membres à mentionner' : 'Cartes à citer' }, list.map(option))
          : status ? h('p', { class: 'prop-list prop-list--empty chat-ac', role: 'status' }, status) : null,
      ]),
      h('div', { class: 'chat-form__foot' }, [
        h('span', { id: 'chat-hint', class: 'chat-hint' }, [h('kbd', null, 'Entrée'), ' envoie, ', h('kbd', null, 'Maj'), ' + ', h('kbd', null, 'Entrée'), ' va à la ligne']),
        n >= CHAT_MAX - 100 ? h('span', { class: ['chat-count', { full: n >= CHAT_MAX }] }, `${fmt(n)} / ${fmt(CHAT_MAX)}`) : null,
        h('button', { class: 'btn primary', type: 'submit', disabled: c.sending || !c.draft.trim() }, c.sending ? 'Envoi…' : 'Envoyer'),
      ]),
      errLine(c.sendError),
      // Aide (aussi sur téléphone, contrairement aux raccourcis) : citer une carte.
      h('p', { id: 'chat-tip', class: 'chat-tip' }, ['Pour montrer une carte : ', h('code', null, '#'), ' puis son titre, ', h('code', null, '[[Titre de la carte]]'),
        ', ou « Partager dans le chat » depuis sa fiche. Pour mentionner un membre : ', h('code', null, '@'), ' puis son prénom.']),
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
  const MARKET_RULES = "Les cotes et la lecture du marché viennent de ton favori, sur wiki-masters.com : il lit directement la base du jeu avec ta session, à ton clic sur « Mettre à jour les cotes » et, tant qu'il est relié à un onglet du jeu visible, toutes les 20 minutes et après tes enchères et tes ventes (une requête par seconde, 30 au plus par lecture), sans passer par les pages du marché du jeu, qui limitent les outils automatiques. C'est plus risqué qu'une synchro de ta collection : « Couper les cotes automatiques », dans l'encart du favori, revient à la lecture au clic seulement. Le classeur ne fait que montrer : enchères et ventes se font dans le jeu, par toi.";
  const MARKET_HOW = "Pas encore de cote : ouvre wiki-masters.com et clique ton favori ; une minute après, il lit les cotes tout seul (ou clique « Mettre à jour les cotes » dans son encart). Favori installé avant le 17 octobre 2026 : remplace-le (onglet « Mettre à jour »).";
  const MARKET_OLD = 2 * 3600000; // lecture du marché « ancienne » au-delà de 2 h (les enchères bougent vite)
  // « il y a 5 min », « il y a 2 h », « il y a 3 jours ».
  const agoText = (iso) => {
    const ms = Date.now() - Date.parse(iso);
    if (!(ms >= 60000)) return "à l'instant";
    const m = Math.floor(ms / 60000);
    if (m < 60) return `il y a ${m} min`;
    if (m < 2880) return `il y a ${Math.floor(m / 60)} h`;
    return `il y a ${Math.floor(m / 1440)} jours`;
  };
  // Où en est la lecture du marché par le favori : son âge, le dernier essai raté (et pourquoi), favori à remplacer, ou
  // jamais lue (et quoi faire). Une ligne par fait, en tête de l'onglet.
  function viewMarketRead() {
    const a = M.attempt;
    const out = [];
    const old = !!M.liveAt && Date.now() - Date.parse(M.liveAt) > MARKET_OLD;
    if (M.liveAt) {
      out.push(h('p', { class: ['small', old ? 'warn' : 'muted'], key: 'age' }, [`Lecture du marché par ton favori : ${agoText(M.liveAt)} (${dateShort(M.liveAt)}).`,
        old ? ' Elle date de plus de 2 h : des enchères ont pu finir ou monter. Ouvre wiki-masters.com avec ton favori relié : il la refait toutes les 20 minutes (ou clique « Mettre à jour les cotes »).' : '']));
    } else if (a && a.ok === true) {
      out.push(h('p', { class: 'small muted', key: 'age' }, `Cotes lues par ton favori ${agoText(a.end || a.start)} ; sa lecture du marché (bonnes affaires, tes enchères) n'est pas arrivée : relance « Mettre à jour les cotes » sur wiki-masters.com.`));
    } else if (!a) {
      out.push(h('p', { class: 'small warn', key: 'age' }, "Ton favori n'a encore jamais lu le marché. Sur wiki-masters.com, clique-le : une minute après, il lit les cotes et les bonnes affaires tout seul, puis toutes les 20 minutes tant que l'onglet du jeu reste ouvert. S'il n'a pas de bouton « Mettre à jour les cotes », il date d'avant le 16 octobre : remplace-le (onglet « Mettre à jour »)."));
    }
    if (a && a.ok === false && a.why) {
      out.push(h('p', { class: 'status err', role: 'status', key: 'fail' }, `Dernier essai de ton favori, ${agoText(a.end || a.start)}${a.auto ? ' (lecture automatique)' : ''} : ${a.why}`));
    } else if (a && !a.end && Date.now() - Date.parse(a.start) > 10 * 60000) {
      out.push(h('p', { class: 'small warn', key: 'fail' }, `Une lecture commencée ${agoText(a.start)} n'a pas abouti (onglet du jeu fermé pendant la lecture, ou favori ancien) : relance « Mettre à jour les cotes » sur wiki-masters.com.`));
    }
    if (a && !(Number(a.v) >= FAVORI_VERSION)) {
      out.push(h('p', { class: 'small warn', key: 'old' }, "Ton favori n'est pas à jour : le nouveau lit les cotes et les bonnes affaires tout seul, dit pourquoi quand il n'y arrive pas et lit aussi tes tags du jeu. Onglet « Mettre à jour » : glisse le nouveau favori dans ta barre à la place de l'ancien (script Tampermonkey : recopie-le)."));
    }
    return out;
  }
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
      h('figcaption', { class: 'chart__read', 'aria-live': 'polite' }, [priceTag(sel.value), ` le ${dateDay(sel.date)} · ${fmt(sel.priced)} ${plural(sel.priced, 'carte cotée', 'cartes cotées')} sur ${fmt(sel.cards)}`]),
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
          h('tbody', null, pts.slice().reverse().map((p) => h('tr', { key: p.date }, [h('td', null, dateDay(p.date)), h('td', { class: 'num' }, [priceTag(p.value, { tag: 'span' })]), h('td', { class: 'num' }, `${fmt(p.priced)} sur ${fmt(p.cards)}`)]))),
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
  const vsCote = (amount, x) => (x.cote != null && amount != null ? h('span', { class: 'lot__cote' },
    [' · cote ', priceTag(x.cote, { approx: !(x.n >= 3), tag: 'span', title: x.n >= 3 ? null : 'Moins de 3 ventes : cote peu fiable' }), ` (${pctOf(amount, x.cote)})`]) : h('span', { class: 'lot__cote' }, ' · pas de cote'));
  // Bonnes affaires de la dernière lecture encore valables : enchère pas finie, carte que tu n'as pas eue depuis (gagnée,
  // échangée…), une seule par carte (la moins chère : une lecture d'un ancien favori en a parfois plusieurs ; more =
  // les autres). ended / owned : écartées pour l'une ou l'autre raison.
  function dealsOf(live) {
    const best = new Map();
    let ended = 0;
    let owned = 0;
    for (const x of Array.isArray(live && live.deals) ? live.deals : []) {
      if (!x || typeof x.id !== 'string') continue;
      if (!(Date.parse(x.end) > Date.now())) { ended++; continue; }
      if (cardById.value.has(x.id)) { owned++; continue; }
      const o = best.get(x.id);
      const more = Number(x.more) > 0 ? Number(x.more) : 0;
      if (!o) best.set(x.id, { ...x, more });
      else if (x.ask < o.ask) best.set(x.id, { ...x, more: more + o.more + 1 });
      else o.more += more + 1;
    }
    return { list: [...best.values()].sort((a, b) => Date.parse(a.end) - Date.parse(b.end)), ended, owned };
  }
  // Liste déroulante « Toutes les collections / <collection> (N) » : les collections que remplissent les bonnes
  // affaires lues, de celle qui en a le plus à celle qui en a le moins ; le choix est gardé (MP.col).
  function viewDeals(live) {
    if (!live) return h('p', { class: 'muted' }, "Pas de lecture du marché : sur wiki-masters.com, clique ton favori (il la fait tout seul une minute après, puis toutes les 20 minutes) ou « Mettre à jour les cotes » dans son encart.");
    const { list: deals, ended, owned } = dealsOf(live);
    const hidden = [ended ? `${fmt(ended)} ${plural(ended, 'enchère finie', 'enchères finies')} depuis la lecture` : '', owned ? `${fmt(owned)} ${plural(owned, 'carte que tu as maintenant', 'cartes que tu as maintenant')}` : ''].filter(Boolean);
    const note = hidden.length ? h('p', { class: 'small muted' }, `Plus montrées : ${hidden.join(', ')}.`) : null;
    const all = deals.map((x) => ({ x, cols: membershipsOfItem({ title: x.t }) }));
    if (!all.length) return [h('p', { class: 'muted' }, 'Aucune bonne affaire à ta dernière lecture.'), note];
    const counts = new Map();
    for (const d of all) for (const c of d.cols) counts.set(c.key, { col: c, n: ((counts.get(c.key) || {}).n || 0) + 1 });
    const options = [...counts.values()].sort((a, b) => b.n - a.n || COLLATOR.compare(a.col.name, b.col.name));
    const sel = counts.has(MP.col) ? MP.col : '';
    const list = sel ? all.filter((d) => d.cols.some((c) => c.key === sel)) : all;
    const pick = h('label', { class: 'deal-col' }, [h('span', { class: 'sr' }, 'Filtrer par collection'),
      h('select', { id: 'deal-col', class: 'field', value: sel, onChange: (e) => { MP.col = e.target.value; MP.more.acheter = 0; saveMarketPrefs(); } }, [
        h('option', { value: '' }, `Toutes les collections (${fmt(all.length)})`),
        ...options.map((o) => h('option', { key: o.col.key, value: o.col.key }, `${o.col.name} (${fmt(o.n)})`)),
      ])]);
    return [pick, h('ul', { class: 'lots' }, list.slice(0, marketShown('acheter')).map(({ x, cols }) => {
      const soon = !x.bid && Date.parse(x.end) - Date.now() < 2 * 3600000;
      return h('li', { key: x.a, class: 'lot' }, [
        lotTitle(x, copyNameButton(x.t)),
        h('span', { class: 'lot__line' }, [priceTag(x.ask), x.bid ? ' (enchère en cours)' : ' (prix de départ, sans enchère)', vsCote(x.ask, x)]),
        h('span', { class: 'lot__meta small' }, [soon ? h('span', { class: 'flag' }, 'finit bientôt') : null, x.lead ? h('span', { class: 'flag ok' }, 'tu mènes') : null, leftText(x.end),
          cols.length ? ` · pour ${cols.slice(0, 2).map((c) => `« ${c.name} »`).join(', ')}${cols.length > 2 ? '…' : ''}` : '',
          x.more ? ` · ${fmt(x.more)} ${plural(x.more, 'autre enchère intéressante', 'autres enchères intéressantes')} sur cette carte` : '']),
      ]);
    })), marketMoreButton('acheter', list.length), note];
  }
  // « Bonnes affaires à vendre » : seuil (« Valeur minimale : [100]W »), puis tes cartes dont la cote l'atteint, de la plus
  // chère à la moins chère : rareté et brillance de l'exemplaire, titre (sa fiche), « ×3 » ou « 2 en trop », « Copier le
  // nom », cote, dernière vente.
  function viewSell() {
    const { list, unpriced, onSale } = sellOffers.value;
    const kept = list.filter((x) => x.price >= MP.min);
    const shown = kept.slice(0, marketShown('vendre'));
    return [
      h('label', { class: 'sell-min' }, ['Valeur minimale : ',
        h('input', { id: 'sell-min', class: 'field', type: 'number', min: '0', step: '10', inputmode: 'numeric', value: MP.min, 'aria-describedby': 'sell-min-hint',
          onInput: (e) => setMarketMin(e.target.value) }), h('span', { class: 'w', 'aria-hidden': 'true' }, 'W')]),
      h('label', { class: 'check sell-hide' }, [
        h('input', { id: 'sell-hide-col', type: 'checkbox', checked: MP.hideCol, onChange: () => { MP.hideCol = !MP.hideCol; MP.more.vendre = 0; saveMarketPrefs(); } }),
        ' Cacher les cartes de mes collections']),
      h('p', { id: 'sell-min-hint', class: 'small muted' }, MP.hideCol
        ? 'Tes cartes qui ne servent à aucune de tes collections, dont la cote fiable atteint ce seuil.'
        : "Tes cartes qui ne servent à aucune de tes collections, et les exemplaires en trop de celles qui y servent (on en garde un, le moins coté), dont la cote fiable atteint ce seuil."),
      !M.loaded ? h('p', { class: 'muted', role: 'status' }, M.error ? M.error : 'Lecture des cotes…')
        : kept.length ? h('ul', { class: 'lots' }, shown.map((x) => {
          const c = x.c;
          const r = x.k.replace('*', '');
          return h('li', { key: c.id, class: 'lot' }, [
            h('span', { class: 'lot__title' }, [pill(r), ' ', h('button', { class: 'linkish', type: 'button', onClick: (e) => openCardFrom(c.id, e) }, c.title),
              x.k.endsWith('*') ? h('span', { class: 'tag-mini' }, 'brillante') : null,
              x.extra ? h('span', { class: 'holder dup', title: "Exemplaires en plus de celui que gardent tes collections" }, `${fmt(x.extra)} en trop`)
                : x.n > 1 ? h('span', { class: 'holder dup', title: `${fmt(x.n)} exemplaires` }, '×' + fmt(x.n)) : null,
              copyNameButton(c.title)]),
            h('span', { class: 'lot__line' }, [priceTag(x.price), ` · ${fmt(x.q.n)} ${plural(x.q.n, 'vente', 'ventes')}`,
              x.q.l != null ? [' · dernière ', priceTag(x.q.l, { tag: 'span' }), x.q.d ? ` le ${dateDay(x.q.d)}` : ''] : null]),
          ]);
        })) : h('p', { class: 'muted' }, list.length ? `Aucune carte à vendre à ${wfmt(MP.min)} ou plus.` : 'Aucune carte à vendre : toutes tes cartes servent à tes collections, ou ne sont pas encore cotées.'),
      M.loaded ? marketMoreButton('vendre', kept.length) : null,
      M.loaded && onSale ? h('p', { class: 'small muted' }, `${fmt(onSale)} ${plural(onSale, 'carte déjà en vente', 'cartes déjà en vente')} dans le jeu (« Mes enchères ») : pas ${onSale > 1 ? 'proposées' : 'proposée'} ici, même si ton classeur ${onSale > 1 ? 'les garde' : 'la garde'} encore.`) : null,
      M.loaded && unpriced ? h('p', { class: 'small muted' }, `${fmt(unpriced)} ${plural(unpriced, 'carte', 'cartes')} sans cote fiable : ton favori les lit peu à peu, les plus anciennes d'abord, à chaque lecture (ou clique « Mettre à jour les cotes » dans son encart, sur wiki-masters.com).`) : null,
    ];
  }
  const BID_STATE = { won: 'gagnée', lost: 'perdue', off: 'terminée' };
  const SALE_STATE = { sold: 'vendue', unsold: 'invendue', off: 'annulée ou terminée' };
  function viewMine(live) {
    if (!live) return h('p', { class: 'muted' }, 'Tes mises et tes ventes des 14 derniers jours apparaissent ici à la prochaine lecture du marché par ton favori.');
    const bids = Array.isArray(live.bids) ? live.bids : [];
    const sales = Array.isArray(live.sales) ? live.sales : [];
    return h('div', { class: 'mine' }, [
      h('h3', null, 'Tes mises'),
      bids.length ? h('ul', { class: 'lots' }, bids.slice(0, marketShown('mises')).map((x) => h('li', { key: x.a, class: 'lot' }, [
        lotTitle(x),
        h('span', { class: 'lot__line' }, ['ta mise ', priceTag(x.mine, { tag: 'span' }), x.cur != null ? [` · ${x.st === 'run' ? 'enchère actuelle' : 'prix final'} `, priceTag(x.cur, { tag: 'span' })] : '', vsCote(x.cur != null ? x.cur : x.mine, x)]),
        h('span', { class: 'lot__meta small' }, x.st === 'run' ? [h('span', { class: ['flag', { ok: x.lead }] }, x.lead ? 'tu mènes' : 'dépassée'), leftText(x.end)]
          : [h('span', { class: ['flag', { ok: x.st === 'won' }] }, BID_STATE[x.st] || x.st), ` le ${dateDay(x.end)}`]),
      ]))) : h('p', { class: 'small muted' }, 'Aucune mise ces 14 derniers jours.'),
      marketMoreButton('mises', bids.length),
      h('h3', null, 'Tes ventes'),
      sales.length ? h('ul', { class: 'lots' }, sales.slice(0, marketShown('ventes')).map((x) => h('li', { key: x.a, class: 'lot' }, [
        lotTitle(x),
        h('span', { class: 'lot__line' }, ['départ ', priceTag(x.base, { tag: 'span' }), x.cur != null ? [` · ${x.st === 'sold' ? 'vendue' : 'enchère'} `, priceTag(x.cur, { tag: 'span' })] : '', vsCote(x.cur != null ? x.cur : x.base, x)]),
        h('span', { class: 'lot__meta small' }, x.st === 'run' ? [h('span', { class: ['flag', { ok: x.bid }] }, x.bid ? 'enchère reçue' : 'sans enchère'), leftText(x.end)]
          : [h('span', { class: ['flag', { ok: x.st === 'sold' }] }, SALE_STATE[x.st] || x.st), ` le ${dateDay(x.end)}`]),
      ]))) : h('p', { class: 'small muted' }, 'Aucune vente ces 14 derniers jours.'),
      marketMoreButton('ventes', sales.length),
    ]);
  }
  // Une section repliable de l'onglet (accordéon) : un bouton dans le titre (aria-expanded), le contenu rendu seulement
  // quand elle est ouverte. note : ce que la section contient, dit dans le titre (utile quand elle est fermée).
  function marketSection(id, title, note, body, cls) {
    const open = !!MP.open[id];
    const bodyId = 'marche-' + id;
    return h('section', { class: ['panel', 'acc', cls || '', { open }], key: id, 'data-section': id }, [
      h('h2', { class: 'acc__head' }, [h('button', { class: 'acc__btn', type: 'button', 'aria-expanded': String(open), 'aria-controls': bodyId, onClick: () => toggleMarketSection(id) },
        [icon('chev', 'sm'), h('span', null, title), note ? h('span', { class: 'acc__note' }, note) : null])]),
      h('div', { class: 'acc__body', id: bodyId, hidden: !open }, open ? body() : []),
    ]);
  }
  function viewMarket() {
    const v = M.value;
    const stamp = M.liveAt ? `lue par ton favori ${agoText(M.liveAt)}` : '';
    const live = M.live;
    const nDeals = live ? dealsOf(live).list.length : 0;
    const nBids = live && Array.isArray(live.bids) ? live.bids.length : 0;
    const nSales = live && Array.isArray(live.sales) ? live.sales.length : 0;
    const nSell = M.loaded ? sellOffers.value.list.filter((x) => x.price >= MP.min).length : 0;
    // En haut, la valeur et où en est la lecture du marché (repliable comme les autres sections : repliée, le titre garde
    // la valeur) ; puis côte à côte « à acheter » et « à vendre » (l'une sous l'autre sur un écran étroit) ; « Mes
    // enchères » (fermée par défaut) ; « À savoir ».
    return h('div', { class: 'market' }, [
      marketSection('valeur', 'Valeur de ton classeur', M.loaded && v ? wfmt(v.value) : '', () => [
        h('div', { class: 'market__head' }, [h('span', { class: 'spacer' }),
          h('button', { class: 'btn small', type: 'button', disabled: M.busy, onClick: () => loadMarket(true) }, [icon('refresh', M.busy ? 'spin' : ''), M.busy ? 'Lecture…' : 'Relire'])]),
        !M.loaded ? (M.error ? errLine(M.error) : h('p', { class: 'muted', role: 'status' }, 'Lecture des cotes…')) : null,
        M.loaded && v ? h('p', { class: 'market__big' }, [priceTag(v.value), h('span', { class: 'muted' }, ` · ${fmt(v.priced)} ${plural(v.priced, 'carte cotée', 'cartes cotées')} sur ${fmt(v.cards)}`)]) : null,
        M.loaded && v && v.approx ? h('p', { class: 'small muted' }, `Dont ${fmt(v.approx)} ${plural(v.approx, 'carte comptée', 'cartes comptées')} dans sa plus haute rareté : le détail de leurs exemplaires arrive avec la prochaine relecture complète du favori.`) : null,
        M.loaded && v && !v.priced ? h('p', { class: 'muted' }, MARKET_HOW) : null,
        M.loaded ? viewValueChart(M.history) : null,
        h('p', { class: 'small muted' }, 'Valeur = somme des cotes fiables (3 ventes au moins) de chacun de tes exemplaires, selon sa rareté et s\'il est brillant ; cote = médiane des 30 dernières ventes sur 90 jours. Un point par jour.'),
        M.loaded && M.error ? errLine(M.error) : null,
        M.loaded ? h('div', { class: 'market__read' }, viewMarketRead()) : null,
      ], 'market__value'),
      marketSection('acheter', 'Bonnes affaires à acheter', nDeals ? fmt(nDeals) : '', () => [
        h('p', { class: 'small muted' }, `Enchères en cours sur des cartes qui manquent à tes collections, la moins chère par carte : au plus 80 % de la cote, ou « finit bientôt » (sans enchère, moins de 2 h, départ sous la cote).${stamp ? ' ' + cap(stamp) + '.' : ''}`),
        viewDeals(live)]),
      marketSection('vendre', 'Bonnes affaires à vendre', nSell ? fmt(nSell) : '', viewSell),
      marketSection('encheres', 'Mes enchères', live ? `${fmt(nBids)} ${plural(nBids, 'mise', 'mises')} · ${fmt(nSales)} ${plural(nSales, 'vente', 'ventes')}` : '', () => [viewMine(live)], 'market__wide'),
      h('section', { class: 'panel market__rules' }, [h('h2', null, 'À savoir'),
        h('p', { class: 'notice warn-box' }, MARKET_RULES),
        h('p', { class: 'small muted' }, 'Les cotes sont communes à tous les classeurs du site (des ventes du jeu, liées à aucun joueur) : une cote lue il y a plus de 12 h est relue à la lecture suivante d\'un membre qui a la carte.')]),
    ]);
  }
  // Fiche d'une carte possédée : cote de chacun de tes exemplaires (rareté, brillance), « ~ » si moins de 3 ventes.
  function viewCote(c) {
    if (!M.loaded) return null;
    const p = prices.value.get(String(c.id));
    if (!p) return h('div', { class: 'cote' }, [h('h3', null, 'Cote'), h('p', { class: 'small muted' }, M.value && M.value.priced ? "Pas encore lue : ton favori la lira à une prochaine lecture (les plus anciennes d'abord), ou clique « Mettre à jour les cotes » dans son encart." : MARKET_HOW)]);
    const { list, approx } = variantsOf(c);
    let total = 0;
    let all = true;
    const rows = list.slice().sort((a, b) => variantOrder(a[0], b[0])).map(([k, n]) => {
      const q = p.v[k];
      if (reliable(q)) total += q.p * n; else all = false;
      return h('li', { key: k, class: 'cote__row' }, [
        h('span', null, `${n > 1 ? fmt(n) + ' × ' : ''}${variantName(k)}`),
        q ? priceTag(q.p, { approx: !reliable(q), title: reliable(q) ? null : 'Moins de 3 ventes : cote peu fiable' }) : h('b', { class: 'none' }, 'pas de vente'),
        q ? h('span', { class: 'small muted' }, [`${fmt(q.n)} ${plural(q.n, 'vente', 'ventes')} · dernière `, priceTag(q.l, { tag: 'span' }), ` le ${dateDay(q.d)}${q.w != null && q.w > 0 ? ` · 7 jours : ${pctOf(q.p, q.w)}` : ''}`]) : null,
      ]);
    });
    return h('div', { class: 'cote' }, [
      h('h3', null, ['Cote ', h('span', { class: 'hint-inline' }, `lue le ${dateDay(p.at)}`)]),
      h('ul', { class: 'cote__list' }, rows),
      list.length > 1 || list[0][1] > 1 ? h('p', { class: 'small' }, [`${all ? 'Tes exemplaires' : 'Tes exemplaires cotés'} : `, priceTag(total)]) : null,
      approx ? h('p', { class: 'small muted' }, "Rareté de tes exemplaires pas encore connue : comptés dans celle de la carte (la prochaine relecture complète du favori la donne).") : null,
    ]);
  }
  // Fiche d'une carte qui te manque : ses cotes connues, par rareté d'exemplaire.
  function viewMissingCote(item) {
    if (!M.loaded) return null;
    return viewCoteKeys(wantedPrices.value.get(normTitle(item.title)));
  }
  // Cotes connues d'une carte, par rareté d'exemplaire : fiche d'une carte qui te manque, fiche d'une carte d'un ami (ses
  // cotes arrivent avec ses cartes, sans date de lecture). p = {v, at?}.
  function viewCoteKeys(p) {
    if (!p || !p.v || typeof p.v !== 'object') return null;
    const keys = Object.keys(p.v).filter((k) => VARIANT_RE.test(k) && p.v[k] && typeof p.v[k] === 'object').sort(variantOrder);
    return h('div', { class: 'cote' }, [
      h('h3', null, ['Cote dans le jeu', p.at ? [' ', h('span', { class: 'hint-inline' }, `lue le ${dateDay(p.at)}`)] : null]),
      keys.length ? h('ul', { class: 'cote__list' }, keys.map((k) => {
        const q = p.v[k];
        return h('li', { key: k, class: 'cote__row' }, [h('span', null, variantName(k)),
          priceTag(q.p, { approx: !reliable(q), title: reliable(q) ? null : 'Moins de 3 ventes : cote peu fiable' }),
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
  // Fiche ouverte depuis l'album d'une de tes collections : l'élément qu'elle montre (le premier qui correspond), de quoi
  // en faire un intercalaire ou non. Rien depuis « Mes cartes », une catégorie de Wikipédia ou l'album d'un ami.
  function albumItemOf(match) {
    const col = S.tab === 'collections' ? activeAlbum.value : null;
    if (!col || col.kind !== 'target') return null;
    const i = col.items.findIndex(match);
    return i < 0 ? null : { col, i, item: col.items[i] };
  }
  // Outils de l'élément dans la fiche ouverte depuis l'album d'une de tes collections : case « Intercalaire », et
  // « Retirer de « … » » (removeFromCollection).
  function viewSepToggle(ref) {
    if (!ref) return null;
    const busy = S.sepBusy === ref.col.id;
    return h('div', { class: 'sep-toggle' }, [
      h('label', { class: 'check' }, [
        h('input', { type: 'checkbox', checked: !!ref.item.sep, disabled: busy, 'aria-describedby': 'sep-toggle-help',
          onChange: (e) => setSep(ref.col.t, ref.i, e.target.checked, e.target) }),
        ' Intercalaire',
        busy ? h('span', { class: 'muted' }, ' · enregistrement…') : null,
      ]),
      h('p', { id: 'sep-toggle-help', class: 'small muted' }, `Dans « ${ref.col.name} », cette carte ouvre une section : un bord à part, et une nouvelle ligne dans l'ordre de la collection.`),
      h('div', { class: 'actions' }, [h('button', { class: 'btn small danger item-remove', type: 'button', disabled: busy, onClick: () => removeFromCollection(ref.col.t, ref.i) },
        [icon('trash', 'sm'), `Retirer de « ${ref.col.name} »`])]),
      errLine(S.sepError),
    ]);
  }
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
        viewSepToggle(albumItemOf((it) => { const f = findCard(it); return !!f && f.id === c.id; })),
        h('div', { class: 'facts' }, [
          fact('Rareté', RARITY_NAME[c.rarity] || c.rarity || '?'),
          fact('Vues par mois', fmt(c.pageviews)),
          fact('Obtenue le', dateOf(c.obtained_at) ? dateOf(c.obtained_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '?'),
          fact('Exemplaires', fmt(c.count || 1) + (c.shiny ? ' · brillante' : '')),
          c.quality != null ? fact('Qualité', NUM2.format(c.quality)) : null,
          c.starred ? fact('Favorite', 'oui, dans le jeu') : null,
        ]),
        viewCote(c),
        // Tags posés dans le jeu (lecture seule ici : ils se changent dans wiki-masters.com), avec leur couleur.
        c.gtags.length ? h('div', null, [
          h('h3', null, 'Tags du jeu'),
          h('div', { class: 'tags' }, c.gtags.map((t) => h('span', { class: 'tag game', key: t, style: gtagStyle(c.gtagc ? c.gtagc[t] : null), title: 'Tag posé dans le jeu' }, t))),
        ]) : null,
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
    return h('p', { class: 'friends-note' }, [h('b', null, 'Chez : '),
      ...list.flatMap((x, i) => [i ? ', ' : null, friendWho(x), x.count > 1 ? ` (×${fmt(x.count)})` : null]), h('span', { class: 'muted' }, ' · à échanger dans le jeu, entre vous')]);
  }
  // Fiche d'une carte qui te manque (case vide, ou carte citée dans le chat) : ce qu'en dit Wikipédia, sa rareté
  // estimée d'après ses vues, les collections où elle figure, le marché du jeu (article vérifié seulement) et l'article.
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
        item.chat ? null : viewSepToggle(albumItemOf((it) => it.title === item.title && !findCard(it))),
        // Carte citée dans le chat (item.chat) : vérifiée sur Wikipédia à l'ouverture (item.checking), pas de collection à corriger.
        item.checking ? h('p', { class: 'small muted', role: 'status' }, 'Vérification sur Wikipédia…') : null,
        viewMissingFriends(item),
        item.status === 'missing' ? h('p', { class: 'warn' }, item.chat ? 'Article introuvable sur Wikipédia : le titre cité dans le chat est peut-être mal écrit.'
          : 'Article introuvable sur Wikipédia : corrige son titre dans la collection.') : null,
        item.status === 'disambiguation' ? h('p', { class: 'warn' }, item.chat ? "Page d'homonymie sur Wikipédia : le titre cité dans le chat ne désigne pas une seule carte."
          : "Page d'homonymie : précise le titre dans la collection.") : null,
        ok ? h('div', { class: 'facts' }, [
          real ? fact('Rareté dans le jeu', RARITY_NAME[real]) : fact('Rareté estimée', est ? '≈ ' + RARITY_NAME[est] : S.pv.running || item.checking ? '…' : '?'),
          fact('Vues sur 30 jours', views != null ? fmt(views) : S.pv.running || item.checking ? '…' : '?'),
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
        // Cote : celle de sa carte (venue avec ses cartes), sinon de tes exemplaires, sinon celle connue d'une carte qui te manque.
        fc && fc.v ? viewCoteKeys({ v: fc.v }) : mine ? viewCote(mine) : viewMissingCote(item),
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
    props: { title: String, wide: Boolean, cls: String, onClose: Function },
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
        h('div', { class: ['modal', props.cls || '', { wide: props.wide }], role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id, tabindex: '-1', ref: box, onKeydown: (e) => trapTab(e, box.value) }, [
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
      : c.source === 'def' ? (big ? `plus de 10 000 articles (${fmt(c.size)} citent la formule)` : `${fmt(c.size)} ${plural(c.size, 'article cite', 'articles citent')} la formule, triés à l'ouverture`)
        : big ? 'plus de 20 000 articles'
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
      const kcol = ch.source === 'links' && ch.col && ch.cols ? ch.cols.find((c) => c.key === ch.col) || null : null; // colonne clé
      return [
        h('button', { class: 'back', type: 'button', onClick: () => { kwAbort(); kw.chosen = null; } }, '← Autres candidats'), // arrête un chargement en cours
        h('label', { class: 'field' }, [h('span', null, 'Nom de la collection'),
          h('input', { id: 'kw-name', class: 'field full', value: ch.name, maxlength: 120, autocomplete: 'off', onInput: (e) => { ch.name = e.target.value; } })]),
        h('p', { class: 'note' }, [
          ch.source === 'cat' ? `Catégorie Wikipédia : ${ch.title.replace(/^Catégorie\s*:\s*/i, '')}`
            : ch.source === 'links' ? [kcol ? `Colonne « ${kcol.name} » ${kcol.parts.length > 1 ? 'des tableaux' : 'du tableau'} de la page ` : 'Liens de la page ', h('a', { href: wpPageUrl(ch.title), target: '_blank', rel: 'noopener noreferrer' }, ch.title),
              kcol ? ", dans l'ordre des lignes" : '']
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
        // Page en tableaux : « Colonne clé », comme dans l'album d'une page (tous ses tableaux).
        ch.source === 'links' && ch.cols && ch.cols.length && cand ? h('label', { class: 'page-key', for: 'kw-key' }, [
          h('span', { class: 'page-key__label' }, 'Colonne clé'),
          h('select', { id: 'kw-key', class: 'field', value: ch.col || '', disabled: ch.loading, onChange: (e) => kwSetColumn(ed, cand, e.target.value) }, [
            ...ch.cols.map((c) => h('option', { key: 'c:' + c.key, value: c.key, title: c.label }, `${c.name} (${fmt(c.n)} ${plural(c.n, 'article', 'articles')})`)),
            h('option', { key: 'tous', value: '' }, 'Aucune : tous les liens de la page'),
          ])]) : null,
        ch.source === 'links' && ch.links && ch.links.top && !kcol && cand ? h('label', { class: 'check' }, [
          h('input', { type: 'checkbox', checked: !ch.allLinks, disabled: ch.loading, onChange: () => kwToggleSubs(ed, cand) }),
          ` ne garder que les « ${ch.links.top.label} » (${fmt(ch.links.top.n)} sur ${fmt(ch.links.items.length)} articles liés : pays, régions et autres liens écartés)`]) : null,
        ch.total > LIST_MAX ? h('p', { class: 'warn' }, 'Trop grande (plus de 20 000 articles) : précise ta recherche.') : null,
        ch.items && ch.items.length ? h('ol', { class: 'preview', 'aria-label': 'Aperçu des premiers articles' }, ch.items.slice(0, 20).map((i) => h('li', { key: i.title }, i.title))) : null,
        extra ? h('p', { class: 'note' }, `… et ${fmt(extra)} autres`) : null,
        ch.items && !ch.items.length && !ch.loading ? h('p', { class: 'muted' }, 'Aucun article dans ce candidat.') : null,
        errLine(ch.error),
        errLine(ed.error),
        foot([
          closeBtn('Annuler'),
          h('button', { class: 'btn primary', type: 'button', disabled: ed.busy || ch.loading || !ch.items || !ch.items.length || ch.total > LIST_MAX || !ch.name.trim(),
            onClick: () => kwSave(ed) }, ed.busy ? 'Enregistrement…' : 'Enregistrer'),
        ]),
      ];
    }
    return [
      h('label', { class: 'sr', for: 'kw' }, 'Mots-clés'),
      h('input', { id: 'kw', class: 'field full', type: 'search', value: kw.q, autocomplete: 'off', spellcheck: 'false',
        placeholder: 'races bovines, footballeur français, cathédrales de France, films de Miyazaki…',
        onInput: (e) => kwInput(ed, e.target.value), onKeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); kwSearch(ed); } } }),
      kw.searching ? h('p', { class: 'progress-msg', role: 'status' }, 'Recherche…') : null,
      errLine(kw.error),
      kw.interp ? h('p', { class: 'interp-line' }, ['Interprétation : ', h('b', null, kw.interp)]) : null,
      kw.cands.length ? h('ul', { class: 'cands', 'aria-label': 'Candidats' }, kw.cands.map((c) => viewCandidate(ed, c)))
        : kw.searched && !kw.searching ? h('p', { class: 'muted' }, "Aucun candidat : essaie d'autres mots, ou la liste d'articles.") : null,
      foot([closeBtn('Annuler')]),
    ];
  }
  function viewListMode(ed) {
    const filled = ed.text.split('\n').filter((l) => l.trim());
    const lines = filled.length;
    const seps = filled.filter((l) => SEP_LINE.test(l.trim()) && l.trim().replace(SEP_LINE, '')).length;
    return [
      h('label', { class: 'sr', for: 'ed-name' }, 'Nom de la collection'),
      h('input', { id: 'ed-name', class: 'field full', value: ed.name, maxlength: 120, autocomplete: 'off', placeholder: "Nom, par exemple Dieux de l'Olympe",
        onInput: (e) => { ed.name = e.target.value; } }),
      ed.id ? h('p', { class: 'note' }, 'Un article Wikipédia par ligne : son titre exact (« Zeus ») ou son adresse fr.wikipedia.org. Chaque article est vérifié sur Wikipédia.') : null,
      h('p', { class: 'note', id: 'ed-sep-help' }, "Intercalaire : « # » en début de ligne (« # Sous-continent ») ; cette carte ouvre alors une section de l'album, avec un bord à part. Elle se possède et compte comme les autres."),
      h('label', { class: 'sr', for: 'ed-text' }, 'Articles, un par ligne'),
      h('textarea', { id: 'ed-text', class: 'field full', rows: 12, value: ed.text, spellcheck: 'false', 'aria-describedby': 'ed-sep-help',
        placeholder: 'Zeus\nHéra\nhttps://fr.wikipedia.org/wiki/Poséidon', onInput: (e) => { ed.text = e.target.value; ed.issues = null; } }),
      h('p', { class: 'note' }, `${fmt(lines)} ${plural(lines, 'ligne', 'lignes')}${seps ? ` · ${fmt(seps)} ${plural(seps, 'intercalaire', 'intercalaires')}` : ''}`),
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
  // « Nouvelle collection » : un onglet par façon de créer, chacun avec son explication en tête. [mode, libellé, icône,
  // explication].
  const NEW_MODES = [
    ['url', 'Par URL', 'link', "Colle l'adresse d'une catégorie ou d'une page de Wikipédia en français (ou tape son nom). Elle s'ouvre en aperçu avec tes cartes : choisis la colonne clé ou les sections s'il y en a, puis « Créer une collection »."],
    ['mots', 'Par mots-clés', 'search', "Décris un thème : « races bovines », « films de Miyazaki », « maladie ». Le classeur cherche des pages « Liste de… », des catégories, des définitions et Wikidata ; choisis un candidat, vérifie l'aperçu, enregistre."],
    ['liste', "Par liste d'articles", 'list', "Un article de Wikipédia par ligne, par son titre exact (« Zeus ») ou son adresse. Chaque article est vérifié sur Wikipédia ; la collection garde ton ordre."],
    ['props', 'Propositions', 'spark', "Les catégories de Wikipédia dont tu as déjà au moins 5 % des cartes (et 2 au moins), trouvées d'après ta collection. Un clic en fait une collection ; le nom ouvre l'aperçu."],
    ['jeu', 'Depuis le jeu', 'bookmark', "Sur wiki-masters.com, fais une recherche dans la « Collection globale » (« vache »…), puis clique ton favori : il propose d'en faire une collection, avec la rareté de chaque carte dans le jeu."],
  ];
  function viewNewFromGame() {
    const has = !!storedImportKey() || !!(S.me && S.me.has_import_key);
    return [
      h('p', { class: 'small muted' }, has ? 'Ton favori est installé : la collection apparaîtra ici dès que tu l\'auras créée sur wiki-masters.com.'
        : "Il te faut d'abord le favori (un bouton à glisser dans ta barre de favoris) : c'est aussi lui qui met ta collection à jour."),
      h('div', { class: 'row-actions' }, [h('button', { class: has ? 'btn small' : 'btn small primary', type: 'button', onClick: openFavori },
        [icon('bookmark', 'sm'), has ? 'Voir mon favori' : 'Installer le favori'])]),
    ];
  }
  function modalEditor() {
    const ed = S.editor;
    if (!ed) return null;
    if (ed.id) return h(Modal, { key: 'editor', title: 'Modifier la collection', onClose: closeModal }, () => viewListMode(ed));
    const props = proposer && !S.prefs.hide_proposals ? wpVisible.value.length : 0;
    const cur = NEW_MODES.find((m) => m[0] === ed.mode) || NEW_MODES[0];
    const go = (mode) => {
      if (mode === ed.mode) return;
      if (ed.mode === 'mots') kwAbort();
      if (ed.mode === 'url') stopCatSearch();
      ed.mode = mode;
      ed.error = '';
    };
    // Onglets au clavier : ← → (en boucle), Début, Fin ; l'onglet atteint est choisi et prend le focus.
    const onKey = (e) => {
      const i = NEW_MODES.findIndex((m) => m[0] === ed.mode);
      const n = NEW_MODES.length;
      const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
      if (j < 0) return;
      e.preventDefault();
      go(NEW_MODES[j][0]);
      nextTick(() => { const el = document.getElementById('newcol-tab-' + NEW_MODES[j][0]); if (el) el.focus(); });
    };
    const body = ed.mode === 'url' ? [viewCatSearch()]
      : ed.mode === 'mots' ? viewKeywords(ed)
        : ed.mode === 'liste' ? viewListMode(ed)
          : ed.mode === 'props' ? viewWpGroup()
            : viewNewFromGame();
    // Les vues mots-clés et liste ont leurs propres boutons ; les autres onglets se ferment simplement.
    const ownFoot = ed.mode === 'mots' || ed.mode === 'liste';
    return h(Modal, { key: 'editor', wide: true, cls: 'newcol', title: 'Nouvelle collection', onClose: closeModal }, () => [
      h('div', { class: 'newcol-tabs', role: 'tablist', 'aria-label': 'Façon de créer la collection' }, NEW_MODES.map(([mode, label, ic]) => h('button', {
        key: mode, id: 'newcol-tab-' + mode, type: 'button', role: 'tab', 'aria-selected': String(ed.mode === mode), 'aria-controls': 'newcol-panel',
        tabindex: ed.mode === mode ? '0' : '-1', onClick: () => go(mode), onKeydown: onKey,
      }, [icon(ic, 'sm'), h('span', null, label), mode === 'props' && props ? h('span', { class: 'tab-badge' }, fmt(props)) : null]))),
      h('div', { id: 'newcol-panel', class: 'newcol-panel', role: 'tabpanel', 'aria-labelledby': 'newcol-tab-' + cur[0] }, [
        h('p', { class: 'newcol-intro' }, cur[3]),
        ...body,
      ]),
      ownFoot ? null : foot([closeBtn()]),
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
  // « Ajouter par tags du jeu » : tes tags du jeu proposés, puis les catégories du jeu (cochés d'emblée : ceux du même
  // nom), un autre au choix, tes tags du classeur repliés, aperçu des cartes à ajouter (décochables une à une), puis
  // « Ajouter N cartes ». Nom du bouton : ce que l'utilisateur appelle « les tags de wiki-masters » (2026-10-18) ; les
  // catégories du jeu viennent en second dans la même fenêtre.
  const TAGADD_TITLE = 'Ajouter par tags du jeu';
  const NO_GTAGS = "Ton favori n'a encore lu aucun tag du jeu : relance une mise à jour complète (onglet « Mettre à jour » : « La prochaine mise à jour relira toute ta collection », puis le favori sur wiki-masters.com ; il faut celui du 18 octobre 2026 ou plus récent). Si tu n'as posé aucun tag sur tes cartes dans le jeu, les catégories du jeu ci-dessous suffisent.";
  function modalTagAdd() {
    const ta = S.tagAdd;
    if (!ta) return null;
    const info = tagAddInfo.value;
    if (!info) return h(Modal, { key: 'tagadd', title: TAGADD_TITLE, onClose: closeModal }, () => [h('p', null, "Cette collection n'existe plus."), foot([closeBtn()])]);
    const t = info.t;
    const preview = tagAddPreview.value;
    const n = tagAddPicked.value.length;
    const page = pageOfSource(t.source);
    const src = isCatSource(t.source) ? `de la catégorie Wikipédia « ${catName(t.source)} »` : page ? `de la page Wikipédia « ${page} »` : null;
    const already = (r) => (r.why !== 'often' && r.inside ? ` · ${fmt(r.inside)} déjà dans la collection` : '');
    const whyGtag = (r) => (r.why === 'same' ? 'même nom que la collection' : r.why === 'near' ? 'plus précis que le nom de la collection'
      : r.why === 'wide' ? "plus large que le nom de la collection : vérifie l'aperçu" : r.why === 'manual' ? 'choisi par toi'
        : `porté par ${fmt(r.n)} de tes ${fmt(info.own)} cartes de la collection`) + already(r);
    const whyCat = (r) => (r.why === 'same' ? 'même nom que la collection' : r.why === 'near' ? 'plus précise que le nom de la collection'
      : r.why === 'wide' ? "plus large que le nom de la collection : vérifie l'aperçu" : r.why === 'manual' ? 'choisie par toi'
        : `portée par ${fmt(r.n)} des ${fmt(info.known)} éléments de la collection`) + already(r);
    const whyTag = (r) => (r.why === 'same' ? 'même nom que la collection' : r.why === 'near' ? 'nom proche de celui de la collection'
      : r.why === 'cat' ? `catégorie de tags ${r.score > 2 ? 'de même nom' : 'au nom proche'} : tous ses tags` : r.why === 'manual' ? 'choisi par toi'
        : `porté par ${fmt(r.n)} de tes ${fmt(info.tags.own)} cartes de la collection`) + (r.why !== 'often' && r.inside ? ` · ${fmt(r.inside)} déjà dedans` : '');
    // Règle de l'ajout automatique de la collection : signalée (montrée même sans carte à ajouter).
    const row = (r) => h('li', { key: r.key, class: { 'tagadd-rule': r.rule } }, [
      h('label', { class: 'check' }, [h('input', { type: 'checkbox', checked: ta.on.has(r.key), disabled: ta.busy, onClick: (e) => toggleTagAddKey(ta, r.key, e.target.checked) }),
        r.kind === 'gtag' ? h('span', { class: 'gtag-name', style: gtagStyle(r.color) }, r.label) : h('span', null, r.kind === 'cat' ? `« ${r.label} »` : r.label)]),
      h('span', { class: 'n' }, r.cards.length ? `${fmt(r.cards.length)} à ajouter` : 'rien à ajouter'),
      h('span', { class: 'why' }, (r.kind === 'gtag' ? whyGtag(r) : r.kind === 'cat' ? whyCat(r) : whyTag(r)) + (r.rule ? " · règle de l'ajout automatique" : '')),
    ]);
    // Une liste (tags du jeu ou catégories du jeu) : ses propositions, ou pourquoi il n'y en a pas ; celles qui ne tiennent
    // pas ; celles dont tout est déjà dedans.
    const section = (part, o) => {
      const fullNames = part.full.map((r) => (o.quote ? `« ${r.label} »` : r.label));
      let none = null;
      if (!o.has) none = o.empty;
      else if (!part.rows.length) {
        none = fullNames.length ? `Rien à proposer : tes cartes ${o.of} ${namesText(fullNames, false)} sont déjà toutes dans la collection, et ${o.noOther}.`
          : `Rien à proposer : ${o.noName} « ${t.name} »${o.often ? `, et ${o.noOften}` : ''}.`;
      }
      return [
        h('h3', { class: 'tagadd-sec' }, o.title),
        part.rows.length ? h('ul', { class: 'tagadd', 'aria-label': o.label }, part.rows.map(row)) : h('p', { role: 'status', class: 'note' }, none),
        part.more ? h('p', { class: 'note' }, `Et ${fmt(part.more)} ${o.more(part.more)} : tape celui que tu veux dans le champ ci-dessous.`) : null,
        part.rows.length && fullNames.length ? h('p', { class: 'note' }, `Déjà toutes dans la collection : tes cartes ${o.of} ${namesText(fullNames, false)}.`) : null,
      ];
    };
    const tagRows = info.tags.rows;
    // Plusieurs propositions cochées : la catégorie de chaque carte de l'aperçu est rappelée.
    const many = tagAddRows.value.filter((r) => ta.on.has(r.key)).length > 1;
    const shown = preview.slice(0, ta.limit);
    const choices = [...gameTagList.value.map((g) => ['g:' + g.key, g.label]), ...gameCatList.value.map((g) => ['c:' + g.key, g.label])].slice(0, 2000);
    // Ajout automatique : règles cochées, exclusions, ce que le bouton fera.
    const st = tagAddAuto.value;
    const nSkip = st && st.had ? st.had.skip.length : 0;
    const tooManyRules = !!st && st.rules.length > AUTO_MAX_RULES;
    const autoNote = ta.auto
      ? `Les tags et catégories cochés sont gardés : à chaque synchro du favori (ou à l'ouverture du classeur), tes nouvelles cartes qui les portent s'ajoutent à la fin. Une carte décochée dans l'aperçu, ou retirée ensuite de la collection, n'est jamais rajoutée${nSkip ? ` (${cards$(nSkip)} ${plural(nSkip, 'exclue', 'exclues')} pour l'instant)` : ''}.`
      : st && st.had ? "Décochée : l'ajout automatique de cette collection s'arrête (les cartes déjà ajoutées restent)." : null;
    const go = ta.busy ? 'Enregistrement…' : n ? `Ajouter ${cards$(n)}` : st && st.changed ? (st.rules.length ? 'Enregistrer les règles' : "Arrêter l'ajout automatique") : 'Ajouter';
    return h(Modal, { key: 'tagadd', wide: true, title: TAGADD_TITLE, onClose: closeModal }, () => [
      h('p', null, `Dans « ${t.name} » : coche des tags du jeu (ceux que tu poses sur tes cartes dans wiki-masters.com) ou des catégories du jeu (le texte affiché sous le titre de chaque carte), et tes cartes qui les portent sans être encore dans la collection s'y ajoutent, à la fin. Proposés : ceux dont le nom ressemble à celui de la collection, puis ceux que portent beaucoup de ses éléments.`),
      src ? h('p', { class: 'note' }, `Cette collection est faite ${src} : les cartes ajoutées viennent en plus de ses articles et elle garde sa source, comme avec « Modifier ».`) : null,
      ...section(info.game, { title: 'Tes tags du jeu', label: 'Tags du jeu proposés', has: info.hasGtags, empty: NO_GTAGS, of: 'au tag', quote: false,
        noOther: "aucun autre de tes tags du jeu ne s'en approche", noName: 'aucun de tes tags du jeu ne ressemble au nom', often: info.own >= 2,
        noOften: "aucun n'est porté par plusieurs de tes cartes de la collection", more: (k) => plural(k, 'autre tag proposé', 'autres tags proposés') }),
      ...section(info.cats, { title: 'Catégories du jeu', label: 'Catégories du jeu proposées', has: info.hasCats, quote: true, of: 'de catégorie',
        empty: "Aucune de tes cartes n'a de catégorie du jeu (le texte que le jeu affiche sous leur titre) : relance une mise à jour avec le favori, puis reviens ici.",
        noOther: "aucune autre catégorie du jeu ne s'en approche", noName: 'aucune catégorie du jeu de tes cartes ne ressemble au nom', often: info.known >= 2,
        noOften: "aucune n'est portée par beaucoup de ses éléments", more: (k) => plural(k, 'autre catégorie proposée', 'autres catégories proposées') }),
      choices.length ? h('form', { class: 'tagadd-other', onSubmit: (e) => { e.preventDefault(); addTagAddKey(ta); } }, [
        h('label', { class: 'sr', for: 'tagadd-other' }, 'Un autre tag ou une autre catégorie du jeu'),
        h('input', { id: 'tagadd-other', class: 'field', list: 'tagadd-cats', value: ta.field, maxlength: 500, autocomplete: 'off', placeholder: 'Un autre tag ou une autre catégorie du jeu…',
          onInput: (e) => { ta.field = e.target.value; ta.fieldError = ''; } }),
        h('datalist', { id: 'tagadd-cats' }, choices.map(([key, label]) => h('option', { key, value: label }))),
        h('button', { class: 'btn small', type: 'submit', disabled: ta.busy || !ta.field.trim() }, [icon('plus', 'sm'), 'Ajouter à la liste']),
      ]) : null,
      errLine(ta.fieldError),
      // Tes tags du classeur : repliés, jamais cochés d'emblée.
      tagRows.length ? h('button', { class: 'linkish tagadd-tags', type: 'button', 'aria-expanded': ta.tags ? 'true' : 'false', disabled: ta.busy, onClick: () => toggleTagAddTags(ta) },
        ta.tags ? 'Masquer tes tags du classeur' : `Proposer aussi tes tags du classeur (${fmt(tagRows.length)})`) : null,
      tagRows.length && ta.tags ? h('ul', { class: 'tagadd', 'aria-label': 'Tes tags du classeur proposés' }, tagRows.map(row)) : null,
      ...(preview.length ? [
        h('div', { class: 'tagadd-head' }, [
          h('h3', null, `Aperçu : ${cards$(n)} à ajouter${n < preview.length ? ` sur ${fmt(preview.length)}` : ''}`),
          h('button', { class: 'linkish', type: 'button', disabled: ta.busy, onClick: () => toggleTagAddAll(ta, n < preview.length) }, n < preview.length ? 'Tout cocher' : 'Tout décocher'),
        ]),
        h('ul', { class: 'tagadd-preview', 'aria-label': 'Cartes à ajouter' }, shown.map((c) => h('li', { key: c.id }, [
          h('label', { class: 'check' }, [h('input', { type: 'checkbox', checked: !tagAddOff(ta, c), disabled: ta.busy, onClick: (e) => toggleTagAddCard(ta, c.id, e.target.checked) }),
            pill(c.rarity), h('span', null, [c.title, many && c.category ? h('small', { class: 'tagadd-cat' }, c.category) : null,
              tagAddSkipped(c) ? h('small', { class: 'tagadd-skip' }, "exclue de l'ajout automatique") : null])]),
        ]))),
        shown.length < preview.length ? h('button', { class: 'linkish', type: 'button', onClick: () => { ta.limit += TAGADD_PAGE; } },
          `Afficher les ${fmt(Math.min(TAGADD_PAGE, preview.length - shown.length))} suivantes (${fmt(preview.length - shown.length)} restantes)`) : null,
      ] : ta.on.size && (info.game.rows.length || info.cats.rows.length) ? [h('p', { class: 'note' }, st && st.had && st.rules.length
        ? "Rien à ajouter pour l'instant : tes cartes de ces tags et catégories sont déjà toutes dans la collection."
        : 'Coche un tag ou une catégorie qui a des cartes à ajouter.')] : []),
      // « Refaire à chaque synchro » (cochée d'emblée) : les propositions cochées deviennent les règles de la collection.
      h('div', { class: 'tagadd-auto' }, [
        h('label', { class: 'check' }, [
          h('input', { id: 'tagadd-auto', type: 'checkbox', checked: ta.auto, disabled: ta.busy, onClick: (e) => { ta.auto = e.target.checked; ta.error = ''; } }),
          h('span', null, 'Refaire à chaque synchro : les prochaines cartes de ces tags iront dans cette collection'),
        ]),
        autoNote ? h('p', { class: 'note' }, autoNote) : null,
      ]),
      tooManyRules ? h('p', { class: 'warn', role: 'alert' }, `${fmt(st.rules.length)} tags et catégories cochés : l'ajout automatique en garde ${fmt(AUTO_MAX_RULES)} au plus. Décoche-en ${fmt(st.rules.length - AUTO_MAX_RULES)}, ou décoche « Refaire à chaque synchro ».`) : null,
      errLine(ta.error),
      foot([
        closeBtn('Annuler'),
        h('button', { class: 'btn primary', type: 'button', disabled: ta.busy || (!n && !(st && st.changed)) || tooManyRules, onClick: () => saveTagAdd(ta) }, go),
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
  // « Fusionner avec… » : l'autre collection (tes collections, de A à Z, avec leur taille), aperçu (ajoutés, déjà
  // présents, complétés), nom de la collection fusionnée, supprimer l'autre (coché d'emblée) et, pour une collection qui a
  // un ordre, un intercalaire en tête de la partie ajoutée.
  const MERGE_SHOWN = 30; // éléments ajoutés montrés dans l'aperçu
  function modalMerge() {
    const mg = S.merge;
    if (!mg) return null;
    const info = mergeInfo.value;
    if (!info) return h(Modal, { key: 'merge', title: 'Fusionner deux collections', onClose: closeModal }, () => [h('p', null, "Cette collection n'existe plus."), foot([closeBtn()])]);
    const { t, o } = info;
    const els = (n) => `${fmt(n)} ${plural(n, 'élément', 'éléments')}`;
    const srcOf = (x) => (isCatSource(x.source) ? `la catégorie Wikipédia « ${catName(x.source)} »` : pageOfSource(x.source) ? `la page Wikipédia « ${pageOfSource(x.source)} »` : null);
    const choice = (x) => h('li', { key: x.id, class: { on: mg.other === x.id } }, [
      h('label', { class: 'check' }, [
        h('input', { type: 'radio', name: 'merge-other', value: x.id, checked: mg.other === x.id, disabled: mg.busy,
          onClick: () => pickMerge(mg, x.id), onChange: () => pickMerge(mg, x.id) }),
        h('span', null, x.name)]),
      h('span', { class: 'n' }, els(x.items.length)),
      srcOf(x) ? h('span', { class: 'why' }, 'depuis ' + srcOf(x)) : null,
    ]);
    let detail = [];
    let ready = false;
    let label = 'Fusionner';
    if (o) {
      const n = info.added.length;
      const after = info.items.length;
      const name = mergeName(mg);
      const save = info.changed || name !== t.name;
      ready = !info.tooBig && !!name && (save || mg.drop);
      label = mg.drop ? (save ? `Fusionner et supprimer « ${o.name} »` : `Supprimer « ${o.name} »`) : 'Fusionner';
      const lines = [`Après la fusion : ${els(after)}, dont ${info.own ? fmt(info.own) : 'aucun'} que tu as.`];
      if (info.enriched) {
        lines.push(info.enriched > 1 ? `${fmt(info.enriched)} éléments déjà présents reçoivent ce qui leur manquait (qid, description, image ou rareté du jeu).`
          : '1 élément déjà présent reçoit ce qui lui manquait (qid, description, image ou rareté du jeu).');
      }
      const seps = info.added.filter((it) => it.sep).map((it) => it.title);
      if (seps.length && info.sections) lines.push(`${plural(seps.length, 'Intercalaire', 'Intercalaires')} dans la partie ajoutée : ${namesText(seps, true)}.`);
      if (info.noImages) lines.push('Sans les images : avec elles, la collection dépasserait 1,7 Mo (la page retrouve les vignettes sur Wikipédia).');
      const oSrc = srcOf(o);
      detail = [
        h('p', { class: 'merge-sum', role: 'status' }, n ? [h('b', null, `${fmt(n)} ${plural(n, 'élément ajouté', 'éléments ajoutés')}`),
          info.present ? `, ${fmt(info.present)} déjà ${plural(info.present, 'présent', 'présents')}` : ', aucun déjà présent']
          : [h('b', null, 'Rien à ajouter'), !o.items.length ? ` : « ${o.name} » est vide.`
            : ` : ${o.items.length > 1 ? `les ${fmt(o.items.length)} éléments` : "l'élément"} de « ${o.name} » ${o.items.length > 1 ? 'sont' : 'est'} déjà dans « ${t.name} ».`]),
        h('p', { class: 'note' }, lines.join(' ')),
        n ? h('ul', { class: 'merge-added', 'aria-label': 'Éléments ajoutés' }, [
          ...info.added.slice(0, MERGE_SHOWN).map((it, i) => {
            const c = findCard(it);
            return h('li', { key: i + ':' + it.title }, [c ? pill(c.rarity) : null, h('span', null, it.title), it.sep ? h('span', { class: 'merge-sep' }, 'intercalaire') : null]);
          }),
          n > MERGE_SHOWN ? h('li', { key: 'plus', class: 'merge-more' }, `… et ${els(n - MERGE_SHOWN)} de plus`) : null,
        ]) : null,
        h('label', { class: 'field' }, [h('span', null, 'Nom de la collection fusionnée'),
          h('input', { id: 'merge-name', class: 'field full', value: mg.name, maxlength: 80, autocomplete: 'off', disabled: mg.busy, onInput: (e) => { mg.name = e.target.value; mg.error = ''; } })]),
        h('div', { class: 'merge-opt' }, [
          h('label', { class: 'check' }, [h('input', { id: 'merge-drop', type: 'checkbox', checked: mg.drop, disabled: mg.busy, onClick: (e) => { mg.drop = e.target.checked; mg.error = ''; } }),
            h('span', null, `Supprimer « ${o.name} » après la fusion`)]),
          h('p', { class: 'note' }, mg.drop ? (oSrc ? `Tous ses éléments seront dans la collection fusionnée, qui ne reprend pas sa source (${oSrc}) : tu pourras en refaire une collection depuis « Nouvelle collection ».`
            : "Tous ses éléments seront dans la collection fusionnée ; elle n'est supprimée qu'une fois la fusion enregistrée.") : 'Elle restera telle quelle, à côté de la collection fusionnée.'),
        ]),
        info.sections && n && !info.headMoot ? h('div', { class: 'merge-opt' }, [
          h('label', { class: 'check' }, [h('input', { id: 'merge-head', type: 'checkbox', checked: mg.head, disabled: mg.busy, onClick: (e) => { mg.head = e.target.checked; } }),
            h('span', null, 'Ouvrir la partie ajoutée par un intercalaire')]),
          h('p', { class: 'note' }, `« ${info.added[0].title} » commencera une nouvelle ligne de l'album (tri « Ordre ») ; c'est une carte comme les autres.`),
        ]) : null,
        srcOf(t) ? h('p', { class: 'note' }, `« ${t.name} » est faite de ${srcOf(t)} : la collection fusionnée garde cette source (ses éléments restent de A à Z) ; les éléments ajoutés viennent en plus de ses articles.`) : null,
        info.tooBig ? h('p', { class: 'warn', role: 'alert' }, `Collection fusionnée trop volumineuse : ${fmt(info.kb)} Ko${info.hadImages ? ' même sans les images' : ''}, 1,7 Mo au plus. Retire d'abord des éléments de l'une des deux (« Modifier »).`) : null,
      ];
    }
    return h(Modal, { key: 'merge', title: `Fusionner « ${t.name} » avec…`, onClose: closeModal }, () => [
      h('p', null, `Les éléments de « ${t.name} » gardent leur ordre ; ceux de l'autre collection qui n'y sont pas déjà s'ajoutent à la fin. Un article présent dans les deux (même titre ou même article Wikidata) n'y est qu'une fois.`),
      h('fieldset', { class: 'merge-pick' }, [
        h('legend', null, 'Avec quelle collection ?'),
        info.others.length ? h('ul', { class: 'merge-list' }, info.others.map(choice)) : h('p', null, "Tu n'as pas d'autre collection."),
      ]),
      ...detail,
      errLine(mg.error),
      foot([
        closeBtn('Annuler'),
        h('button', { class: 'btn primary', type: 'button', disabled: mg.busy || !ready, onClick: () => saveMerge(mg) }, mg.busy ? 'Fusion…' : label),
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
      y.failed ? h('p', { class: 'notice error', role: 'alert' }, ['Le favori a signalé un échec : ', y.failed, ' Fais ce qu\x27il demande, puis clique-le à nouveau.']) : null,
      y.expired ? h('p', { class: 'note' }, 'Ta session collée a expiré : le favori la remplace, sans rien coller.') : null,
      !y.hasFavori ? h('p', { class: 'note' }, ['Pas encore de favori ? ', h('button', { class: 'linkish', type: 'button', onClick: () => { closeModal(); openFavori(); } }, 'Installer le favori')]) : null,
      foot([
        h('button', { class: 'linkish', type: 'button', onClick: () => { closeModal(); openFavori(); } }, 'Voir le favori et les autres façons'),
        h('button', { class: 'btn', type: 'button', onClick: close }, 'Fermer'),
      ]),
    ]);
  }
  const MODALS = { editor: modalEditor, confirm: modalConfirm, tag: modalTag, switch: modalSwitch, link: modalLink, arrange: modalArrange, sync: modalSync, tagadd: modalTagAdd, merge: modalMerge };

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
        h('p', { class: 'muted' }, "Ouvre ton lien personnel, ou colle-le ici. Tu le retrouves dans les Réglages du classeur (« Ton lien personnel »), sur un appareil où il est déjà ouvert : ne recrée pas de classeur."),
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
  const Cell = { name: 'Cell', props: { card: Object, sep: Boolean }, setup: (props) => () => viewCell(props.card, props.sep) };
  const CardGrid = {
    name: 'CardGrid',
    setup: () => () => h('div', { class: ['cardgrid', { selecting: S.selected.size > 0 }] }, visibleCards.value.map((c) => h(Cell, { key: c.id, card: c }))),
  };
  const AlbumGrid = {
    name: 'AlbumGrid',
    setup: () => () => {
      const col = activeAlbum.value;
      const sections = !!col && showSections(col.ordered, S.albumSort, S.albumFilter);
      return h('div', { class: ['cardgrid', { selecting: S.selected.size > 0 }] },
        albumKids(visibleSlots.value, sections, (s) => (s.card ? h(Cell, { key: s.key, card: s.card, sep: !!s.item.sep }) : viewSlot(s, col)), albumFold.value));
    },
  };
  // Glisser une vignette du mode réorganisation, en pointer events (souris, doigt et stylet de la même façon ; le
  // glisser-déposer HTML5 ne marche pas au doigt). Souris : toute la vignette, après 6 px ; doigt ou stylet : sa poignée
  // seulement (touch-action: none sur elle), le reste de la grille faisant défiler la page comme d'habitude — une poignée
  // plutôt qu'un appui long : visible, immédiate, sans conflit avec le défilement ni avec le menu du système. Écouteurs sur
  // window le temps du geste ; Vue ne redessine qu'au début (vignette soulevée, fantôme) et au lâcher (nouvel ordre) :
  // entre les deux, le fantôme et le repère d'insertion bougent par des variables CSS (CSSOM), une fois par image, et la
  // page défile seule près du haut de la fenêtre et au-dessus de la barre du bas. Échap annule le geste.
  let roDrag = null; // {k, id (pointerId), type, x0, y0, x, y, on (geste commencé), grid, target: {k, after, el} | null, raf}
  let roDragEnded = 0; // heure du dernier lâcher : le clic qui le suit aussitôt (souris) ne choisit rien
  const isTile = (n) => typeof n.hasAttribute === 'function' && n.hasAttribute('data-k');
  function upTo(el, stop, test) {
    for (let n = el; n && n !== stop; n = n.parentNode) if (n.nodeType === 1 && test(n)) return n;
    return null;
  }
  const tileOf = (k) => document.querySelector(`li.ro-tile[data-k="${k}"]`);
  function roPointerDown(e) {
    const r = S.reorder;
    if (!r || r.busy || roDrag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const grid = e.currentTarget;
    const li = upTo(e.target, grid, isTile);
    if (!li || upTo(e.target, li, (n) => n.tagName === 'BUTTON')) return; // les flèches : un clic
    const grip = !!upTo(e.target, li, (n) => n.classList.contains('ro-grip'));
    if (e.pointerType !== 'mouse' && !grip) return; // au doigt, hors de la poignée : la page défile
    roDrag = { k: Number(li.getAttribute('data-k')), id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false, grid, target: null, raf: 0 };
    if (e.pointerType === 'mouse') e.preventDefault(); // pas de sélection de texte
    window.addEventListener('pointermove', roPointerMove);
    window.addEventListener('pointerup', roPointerUp);
    window.addEventListener('pointercancel', roPointerCancel);
    window.addEventListener('keydown', roDragKey, true);
  }
  function roPointerMove(e) {
    const d = roDrag;
    if (!d || e.pointerId !== d.id) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.on) {
      if (Math.abs(d.x - d.x0) + Math.abs(d.y - d.y0) < (d.type === 'mouse' ? 6 : 3)) return;
      const r = S.reorder;
      if (!r) { roDragEnd(); return; }
      d.on = true;
      Object.assign(r, { drag: d.k, active: d.k, pos: '' });
      try { if (d.grid.setPointerCapture) d.grid.setPointerCapture(d.id); } catch (err) { /* pointeur déjà relâché */ }
      document.documentElement.classList.add('ro-dragging');
    }
    if (e.cancelable !== false && typeof e.preventDefault === 'function') e.preventDefault();
    roFrame();
  }
  function roFrame() { if (roDrag && !roDrag.raf) roDrag.raf = requestAnimationFrame(roStep); }
  function roStep() {
    const d = roDrag;
    if (!d) return;
    d.raf = 0;
    const wrap = d.grid.parentNode;
    const ghost = wrap && wrap.querySelector('.ro-ghost');
    if (ghost) { ghost.style.setProperty('--gx', d.x + 'px'); ghost.style.setProperty('--gy', d.y + 'px'); }
    d.target = roTargetAt(d);
    roMark(d);
    // Près du haut de la fenêtre, ou au-dessus de la barre du bas : la page défile (plus vite près du bord).
    const vh = window.innerHeight || 0;
    if (!vh || typeof window.scrollBy !== 'function') return;
    const bar = document.querySelector('.reorder-bar');
    const bottom = bar && typeof bar.getBoundingClientRect === 'function' ? Math.min(vh, bar.getBoundingClientRect().top) : vh;
    const edge = 70;
    let dy = 0;
    if (d.y < edge) dy = -(edge - d.y);
    else if (d.y > bottom - edge) dy = d.y - (bottom - edge);
    if (dy) { window.scrollBy(0, Math.max(-28, Math.min(28, Math.round(dy / 3)))); roFrame(); }
  }
  // Où lâcher : la vignette sous le pointeur (avant ou après selon la moitié), sinon, dans un trou de la grille (fin d'une
  // ligne courte, avant une section), la plus proche à sa gauche ; avant un intercalaire (qui commence sa ligne) = à la fin
  // de la section d'avant (le repère va après sa dernière vignette). null : lâcher ne changerait rien ; hors de la grille,
  // la cible d'avant reste.
  function roTargetAt(d) {
    const r = S.reorder;
    if (!r || typeof document.elementFromPoint !== 'function') return d.target;
    const inGrid = (n) => !!n && d.grid.contains(n);
    let hit = document.elementFromPoint(d.x, d.y);
    let li = inGrid(hit) ? upTo(hit, d.grid, isTile) : null;
    let after = false;
    if (li) {
      const rc = li.getBoundingClientRect();
      after = d.x > rc.left + rc.width / 2;
    } else if (inGrid(hit)) {
      for (let dx = 12; dx <= 600 && !li; dx += 12) {
        hit = document.elementFromPoint(d.x - dx, d.y);
        if (!inGrid(hit)) break;
        li = upTo(hit, d.grid, isTile);
      }
      after = true;
    }
    if (!li) return d.target;
    let k = Number(li.getAttribute('data-k'));
    let at = r.order.indexOf(k);
    if (at < 0) return d.target;
    if (!after && at > 0 && r.base[k].sep) {
      at--;
      k = r.order[at];
      after = true;
      li = tileOf(k) || li;
    }
    const from = r.order.indexOf(d.k);
    let to = at + (after ? 1 : 0);
    if (from < to) to--;
    return to === from ? null : { k, after, el: li };
  }
  function roMark(d) {
    const wrap = d.grid.parentNode;
    const mark = wrap && wrap.querySelector('.ro-mark');
    if (!mark) return;
    const t = d.target;
    if (!t || !t.el || typeof t.el.getBoundingClientRect !== 'function') { mark.classList.remove('on'); return; }
    const rc = t.el.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    mark.style.setProperty('--mx', Math.round((t.after ? rc.right + 5 : rc.left - 5) - wr.left) + 'px');
    mark.style.setProperty('--my', Math.round(rc.top - wr.top) + 'px');
    mark.style.setProperty('--mh', Math.round(rc.height) + 'px');
    mark.classList.add('on');
  }
  function roPointerUp(e) {
    const d = roDrag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.on) { roDragEnd(); return; } // un simple clic : la grille le reçoit (roClick)
    d.x = e.clientX;
    d.y = e.clientY;
    const t = roTargetAt(d);
    roDragEnd();
    roDragEnded = Date.now();
    if (t) dropAt(d.k, t.k, t.after);
    else if (S.reorder && S.reorder.base[d.k]) sayReorder(S.reorder, `« ${S.reorder.base[d.k].title} » reste à sa place.`);
  }
  function roPointerCancel(e) { if (roDrag && e.pointerId === roDrag.id) roDragEnd(); }
  function roDragKey(e) {
    if (e.key !== 'Escape' || !roDrag) return;
    e.preventDefault();
    e.stopPropagation();
    const on = roDrag.on;
    roDragEnd();
    if (on && S.reorder) sayReorder(S.reorder, 'Déplacement annulé.');
  }
  function roDragEnd() {
    const d = roDrag;
    roDrag = null;
    window.removeEventListener('pointermove', roPointerMove);
    window.removeEventListener('pointerup', roPointerUp);
    window.removeEventListener('pointercancel', roPointerCancel);
    window.removeEventListener('keydown', roDragKey, true);
    if (!d) return;
    if (d.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(d.raf);
    const wrap = d.grid.parentNode;
    const mark = wrap && wrap.querySelector('.ro-mark');
    if (mark) mark.classList.remove('on');
    document.documentElement.classList.remove('ro-dragging');
    try { if (d.on && d.grid.releasePointerCapture) d.grid.releasePointerCapture(d.id); } catch (err) { /* déjà relâché */ }
    if (S.reorder) S.reorder.drag = null;
  }
  // Clic dans la grille : « ← » / « → » d'une vignette (le focus reste sur la flèche de l'élément déplacé, que Vue a pu
  // déplacer dans la page), ou une vignette choisie pour la barre du bas.
  function roClick(e) {
    const r = S.reorder;
    if (!r) return;
    const li = upTo(e.target, e.currentTarget, isTile);
    if (!li) return;
    const k = Number(li.getAttribute('data-k'));
    const b = upTo(e.target, li, (n) => n.tagName === 'BUTTON');
    const act = b ? b.getAttribute('data-act') : null;
    if (act === 'prev' || act === 'next') {
      const at = r.order.indexOf(k);
      moveTo(k, act === 'prev' ? at - 1 : at + 1);
      nextTick(() => {
        const t = tileOf(k);
        const nb = t && t.querySelector(`button[data-act="${act}"]`);
        if (nb && document.activeElement !== nb) nb.focus();
      });
      return;
    }
    if (Date.now() - roDragEnded < 150) return;
    if (r.active !== k) Object.assign(r, { active: k, pos: '' });
  }
  // Le focus entre dans une vignette (Tab) : elle devient l'élément choisi de la barre du bas.
  function roFocusIn(e) {
    const r = S.reorder;
    if (!r || roDrag) return;
    const li = upTo(e.target, e.currentTarget, isTile);
    if (!li) return;
    const k = Number(li.getAttribute('data-k'));
    if (r.active !== k) Object.assign(r, { active: k, pos: '' });
  }
  const RoTile = {
    name: 'RoTile',
    props: { s: Object, n: Number, last: Boolean, active: Boolean, lifted: Boolean },
    setup: (props) => () => viewRoTile(props.s, props.n, props.last, props.active, props.lifted),
  };
  const ReorderGrid = {
    name: 'ReorderGrid',
    setup() {
      onBeforeUnmount(roDragEnd);
      return () => {
        const r = S.reorder;
        if (!r) return null;
        const slots = reorderSlots.value;
        const kids = [];
        slots.forEach((s, i) => {
          if (i > 0 && s.item.sep) kids.push(h('li', { class: 'grid-break', key: 'sec:' + s.k, 'aria-hidden': 'true' }));
          kids.push(h(RoTile, { key: s.k, s, n: i + 1, last: i === slots.length - 1, active: r.active === s.k, lifted: r.drag === s.k }));
        });
        const g = r.drag != null ? reorderInfo.value[r.drag] : null;
        return h('div', { class: 'ro-wrap' }, [
          h('ol', { class: ['ro-grid', { dragging: r.drag != null }], 'aria-label': `Ordre de « ${r.name} »`, 'aria-describedby': 'reorder-help',
            onPointerdown: roPointerDown, onClick: roClick, onFocusin: roFocusIn, onDragstart: (e) => e.preventDefault() }, kids),
          h('div', { class: 'ro-mark', 'aria-hidden': 'true' }),
          g ? h('div', { class: ['ro-ghost', g.card ? 'r' + (okRarity(g.card.rarity) || 'C') : 'ro-ghost--missing'], 'aria-hidden': 'true',
            style: roDrag ? { '--gx': roDrag.x + 'px', '--gy': roDrag.y + 'px' } : null },
            [roArt(g), h('span', null, g.item.title)]) : null,
        ]);
      };
    },
  };
  const BulkBar ={ name: 'BulkBar', setup: () => () => h(Transition, { name: 'rise' }, () => viewBulk()) };
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
      S.notice.action ? h('button', { class: 'linkish toast__action', type: 'button', onClick: () => { const a = S.notice.action; S.notice = null; a.run(); } }, S.notice.action.label) : null,
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
      // Nouvel envoi du favori au marché (lecture automatique ou au clic, réussie ou non) : l'onglet « Marché » est relu.
      if (M.loaded && me && typeof me.market_at === 'string' && me.market_at > marketSeen) loadMarket(true);
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

  // ================================================================ adresse de la page (#/…)
  // Chaque vue a son adresse, pour qu'un rafraîchissement (ou une adresse gardée) la rouvre : onglet, collection,
  // catégorie ou page de Wikipédia ouverte, classeur et collection d'un ami, « Échanges possibles », filtres et tris, fiche
  // d'une de tes cartes (2026-10-20, demande de l'utilisateur). Dans le fragment : jamais envoyé au serveur, et le Worker ne
  // sert que les fichiers de public/ (un chemin /collections/… y serait un 404). Le lien personnel (#cle=…) est lu et
  // effacé avant (takeHashKey) : une adresse ne contient jamais la clé, et aucun paramètre ne s'appelle « cle ».
  // L'état reste la seule source : routeHash le traduit en adresse, écrite par writeRoute ; une adresse lue (chargement,
  // Précédent / Suivant, saisie) passe par applyRoute, qui ouvre la vue par les mêmes fonctions qu'un clic (setTab,
  // openAlbum, openFriendAlbum…) pour garder leurs effets (lecture des amis, du marché…).
  // Nouvelle vue = nouvelle entrée de l'historique (pushState) ; filtres, tris, fiche = même entrée (replaceState, regroupé
  // par ROUTE_WAIT : les navigateurs limitent ces appels, et la recherche en fait un par lettre) ; corrections faites par
  // la page (adresse appliquée, lien mort, classeur vide ouvert sur « Mettre à jour ») = même entrée aussi (routeSync).
  const ROUTE_WAIT = 300;
  const ALBUM_FILTERS = ['all', 'owned', 'missing'];
  const ALBUM_SORTS = ['order', 'rarity', 'price-up', 'price-down'];
  const FRIEND_FILTERS = ['all', 'missing'];
  const FRIEND_CARD_SORTS = ['rarity', 'price-up', 'price-down', 'count', 'title'];
  const FRIEND_ALBUM_FILTERS = ['all', 'has', 'lacks', 'help'];
  let routeOn = false; // l'adresse suit l'état : classeur ouvert et adresse du chargement appliquée (boot)
  let routeTimer = null;
  let routePending = ''; // adresse que routeTimer écrira
  // Les titres de Wikipédia gardent leurs « _ » à la place des espaces (comme dans ses adresses).
  const encSeg = (s) => encodeURIComponent(s);
  const encTitle = (s) => encodeURIComponent(String(s).replace(/ /g, '_')).replace(/%2C/g, ',').replace(/%3A/g, ':');
  const decSeg = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  const routeNorm = (hash) => decSeg(String(hash || '').replace(/^#/, ''));
  const routePath = (hash) => routeNorm(hash).split('?')[0] || '/collections';

  const routeHash = computed(() => {
    const p = new URLSearchParams();
    const fr = S.friends;
    const albumParams = (filter, sort, filters) => {
      if (filter !== 'all' && filters.includes(filter)) p.set('filtre', filter);
      if (sort !== 'order' && ALBUM_SORTS.includes(sort)) p.set('tri', sort);
    };
    let path = S.tab;
    if (S.tab === 'collections' && S.album) {
      const a = S.album;
      if (a.kind === 'target') path = 'collections/' + encSeg(a.id);
      else if (a.id.startsWith('wp:')) {
        path = 'categorie/' + encTitle(a.id.slice(3));
        if (S.catView && S.catView.key === a.id && S.catView.withSubs) p.set('sous', '1');
      } else if (a.id.startsWith(PAGE_SRC)) path = 'page/' + encTitle(a.id.slice(PAGE_SRC.length));
      albumParams(S.albumFilter, S.albumSort, ALBUM_FILTERS);
    } else if (S.tab === 'cartes') {
      if (S.q) p.set('q', S.q);
      if (S.sort !== 'rarity') p.set('tri', S.sort);
      for (const r of S.rarities) p.append('rarete', r);
      for (const t of S.tagFilter) p.append('tag', t);
      for (const t of S.gtagFilter) p.append('jeu', t);
      if (S.untaggedOnly) p.set('sans-tag', '1');
      if (S.newOnly) p.set('nouvelles', '1');
    } else if (S.tab === 'amis') {
      if (fr.open && fr.album != null) {
        path = 'ami/' + encSeg(fr.open) + '/' + encSeg(fr.album);
        albumParams(fr.albumFilter, fr.albumSort, FRIEND_ALBUM_FILTERS);
        if (fr.albumFrom === 'trades') p.set('depuis', 'echanges');
      } else if (fr.open) {
        path = 'ami/' + encSeg(fr.open);
        if (fr.q) p.set('q', fr.q);
        if (fr.filter !== 'all') p.set('filtre', fr.filter);
        if (fr.sort !== 'rarity') p.set('tri', fr.sort);
      } else if (fr.page === 'trades') {
        path = 'amis/echanges';
        if (fr.trade !== 'all') p.set('qui', fr.trade);
      }
    }
    if (S.openId) p.set('carte', S.openId);
    const q = p.toString();
    return path === 'collections' && !q ? '' : '#/' + path + (q ? '?' + q : ''); // liste des collections : adresse nue
  });

  // Adresse lue : {tab, album ({kind, id} d'une de tes collections, d'une catégorie ou d'une page), withSubs, friend,
  // falbum, trades, p (paramètres)}. Ce qui ne se lit pas (onglet inconnu, fragment sans « #/ ») = « Collections ».
  function parseRoute(hash) {
    const raw = String(hash || '').replace(/^#/, '');
    const r = { tab: 'collections', album: null, withSubs: false, friend: null, falbum: null, trades: false, p: new URLSearchParams() };
    if (!raw.startsWith('/')) return r;
    const qi = raw.indexOf('?');
    if (qi >= 0) r.p = new URLSearchParams(raw.slice(qi + 1));
    const seg = (qi >= 0 ? raw.slice(1, qi) : raw.slice(1)).split('/').filter(Boolean).map(decSeg);
    const title = (s) => String(s || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    const [a, b, c] = seg;
    if (a === 'collections' && b) r.album = { kind: 'target', id: b };
    else if (a === 'categorie' && title(b)) { r.album = { kind: 'category', id: 'wp:' + catName(CAT_NS + title(b)) }; r.withSubs = r.p.get('sous') === '1'; }
    else if (a === 'page' && title(b)) r.album = { kind: 'category', id: PAGE_SRC + title(b) };
    else if (a === 'ami' && b) { r.tab = 'amis'; r.friend = b; r.falbum = c || null; }
    else if (a === 'amis' && b === 'echanges') { r.tab = 'amis'; r.trades = true; }
    else if (TABS.some(([id]) => id === a)) r.tab = a;
    return r;
  }

  // Ouvre la vue d'une adresse. Ce qui y est déjà ouvert n'est pas rouvert (une catégorie n'est pas relue).
  function applyRoute(r) {
    const p = r.p;
    const pick = (k, ok, def) => { const v = p.get(k); return v != null && ok.includes(v) ? v : def; };
    if (r.tab === 'collections') {
      const a = r.album;
      if (a) {
        if (!(S.album && S.album.kind === a.kind && S.album.id === a.id)) {
          if (a.kind === 'target') openAlbum('target', a.id);
          else if (a.id.startsWith('wp:')) openCategory(CAT_NS + a.id.slice(3), r.withSubs ? { withSubs: true } : null);
          else openPage(a.id.slice(PAGE_SRC.length));
        }
        Object.assign(S, { albumFilter: pick('filtre', ALBUM_FILTERS, 'all'), albumSort: pick('tri', ALBUM_SORTS, 'order') });
        if (isPriceSort(S.albumSort)) loadMarket(false);
      } else if (S.album) closeAlbum();
      setTab('collections');
    } else if (r.tab === 'cartes') {
      setTab('cartes');
      const list = (k, ok) => [...new Set(p.getAll(k).filter((v) => v && (!ok || ok.includes(v))))];
      Object.assign(S, { q: p.get('q') || '', sort: pick('tri', SORTS.map(([v]) => v), 'rarity'), rarities: list('rarete', RARITIES), tagFilter: list('tag'),
        gtagFilter: list('jeu'), untaggedOnly: p.get('sans-tag') === '1', newOnly: p.get('nouvelles') === '1' });
      if (isPriceSort(S.sort)) loadMarket(false);
    } else if (r.tab === 'amis') {
      setTab('amis');
      const fr = S.friends;
      if (r.friend && r.falbum != null) {
        const from = p.get('depuis') === 'echanges' ? 'trades' : null;
        if (fr.open !== r.friend || fr.album !== r.falbum) openFriendAlbum(r.friend, r.falbum, from);
        Object.assign(fr, { albumFilter: pick('filtre', FRIEND_ALBUM_FILTERS, 'all'), albumSort: pick('tri', ALBUM_SORTS, 'order'), albumFrom: from });
      } else if (r.friend) {
        if (fr.open !== r.friend || fr.album != null) openFriendBinder(r.friend);
        Object.assign(fr, { q: p.get('q') || '', filter: pick('filtre', FRIEND_FILTERS, 'all'), sort: pick('tri', FRIEND_CARD_SORTS, 'rarity') });
      } else if (r.trades) {
        if (fr.page !== 'trades' || fr.open) openTrades(p.get('qui') || 'all'); else fr.trade = p.get('qui') || 'all';
      } else if (fr.open || fr.page) {
        Object.assign(fr, { open: null, album: null, albumFrom: null, page: null });
        toTop();
      }
      if (isPriceSort(fr.albumSort) || isPriceSort(fr.sort)) loadMarket(false);
    } else setTab(r.tab);
    // Fiche d'une de tes cartes (pas encore chargées au démarrage : boot la rouvre ensuite).
    const card = p.get('carte');
    if (card) { if (S.openId !== card && cardById.value.has(card)) openCardById(card); } else if (S.openId || S.openMissing) closeCard();
  }

  // Écrit l'adresse de l'état. quiet : remplace l'entrée de l'historique au lieu d'en ajouter une.
  function writeRoute(hash, quiet) {
    if (routeNorm(hash) === routeNorm(location.hash)) {
      clearTimeout(routeTimer);
      routeTimer = null;
      return;
    }
    const url = (h) => location.pathname + location.search + h;
    if (!quiet && routePath(hash) === routePath(location.hash)) {
      // Même vue : filtre, tri, recherche, fiche ; regroupés.
      routePending = hash;
      if (!routeTimer) routeTimer = setTimeout(routeFlush, ROUTE_WAIT);
      return;
    }
    try {
      if (routeTimer) { clearTimeout(routeTimer); routeTimer = null; history.replaceState(null, '', url(routePending)); } // l'entrée qu'on quitte garde ses filtres
      if (quiet) history.replaceState(null, '', url(hash)); else history.pushState(null, '', url(hash));
    } catch (e) { /* historique refusé (bac à sable) : l'adresse ne suit pas, le classeur marche */ }
  }
  function routeFlush() {
    clearTimeout(routeTimer);
    if (!routeTimer) return;
    routeTimer = null;
    try { history.replaceState(null, '', location.pathname + location.search + routePending); } catch (e) { /* voir writeRoute */ }
  }
  // Correction faite par la page : même entrée de l'historique.
  function routeSync() { if (routeOn) writeRoute(routeHash.value, true); }
  // Plus de classeur ouvert (accueil, autre classeur) : adresse remise à zéro.
  function clearRoute() {
    routeOn = false;
    clearTimeout(routeTimer);
    routeTimer = null;
    if (/^#\//.test(location.hash)) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* voir writeRoute */ } }
  }
  // Adresse changée par le navigateur (Précédent, Suivant, saisie dans la barre d'adresse).
  function onRouteChange() {
    if (!routeOn || routeNorm(location.hash) === routeNorm(routeHash.value)) return;
    clearTimeout(routeTimer);
    routeTimer = null;
    applyRoute(parseRoute(location.hash));
    routeSync(); // adresse incomplète ou morte : celle de la vue ouverte
  }
  watch(routeHash, (hash) => { if (routeOn) writeRoute(hash, false); });
  watch(() => S.boot, (b) => { if (b === 'welcome') clearRoute(); });

  const Root = {
    name: 'Classeur',
    setup() {
      onMounted(() => {
        window.addEventListener('keydown', onKey);
        window.addEventListener('hashchange', () => { const k = takeHashKey(); if (k != null) boot(k); else onRouteChange(); });
        window.addEventListener('popstate', onRouteChange);
        document.addEventListener('visibilitychange', onVisible);
        // Ordre réorganisé pas encore enregistré : recharger ou fermer la page le demande d'abord (message du navigateur).
        window.addEventListener('beforeunload', (e) => { routeFlush(); if (S.reorder && S.reorder.dirty) { e.preventDefault(); e.returnValue = ''; } });
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

  watch([() => S.q, () => S.sort, () => S.rarities.join(), () => S.tagFilter.join('\u0001'), () => S.gtagFilter.join('\u0001'), () => S.untaggedOnly, () => S.newOnly], () => { S.limit = PAGE; });
  watch([() => S.albumFilter, () => S.albumSort], () => { S.albumLimit = ALBUM_PAGE; });
  // Mode réorganisation quitté par la navigation (autre album, liste des collections, autre onglet) : sans changement, il
  // se referme ; avec un ordre modifié, le brouillon est gardé et un message le dit une fois (« Y revenir »).
  watch(() => S.tab + '|' + (S.album ? S.album.kind + ':' + S.album.id : ''), () => {
    const r = S.reorder;
    if (!r) return;
    if (S.tab === 'collections' && S.album && S.album.kind === 'target' && S.album.id === r.id) { r.away = false; return; }
    roDragEnd();
    if (!r.dirty) { S.reorder = null; return; }
    if (r.away) return;
    r.away = true;
    notify(`Le nouvel ordre de « ${r.name} » n'est pas encore enregistré : il t'attend dans son album.`, false, { label: 'Y revenir', run: () => resumeReorder(r) });
  });
  // Collections relues ou changées pendant la réorganisation : collection supprimée, brouillon abandonné ; changée (par une
  // autre action de la page), brouillon reporté sur ses éléments d'aujourd'hui (rebaseReorder). Pas pendant
  // l'enregistrement de l'ordre (sa propre réponse).
  watch(() => targets.value, (list) => {
    const r = S.reorder;
    if (!r || r.busy) return;
    const t = list.find((x) => x.id === r.id);
    if (!t) {
      roDragEnd();
      S.reorder = null;
      if (r.dirty && list.length) notify(`« ${r.name} » n'existe plus : son nouvel ordre est abandonné.`, true);
      return;
    }
    if (t.items !== r.base) rebaseReorder(r, t);
    else if (t.name !== r.name) r.name = t.name;
  });
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
