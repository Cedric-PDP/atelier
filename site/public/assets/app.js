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
    known: 'classeur-known', natGroup: 'classeur-natgroup', tagCats: 'classeur-tagcats', proposeAt: 'classeur-propose-at',
    chatRead: 'classeur-chat-lu', market: 'classeur-marche', sections: 'classeur-sections', newsSeen: 'classeur-nouveautes-vu' };
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
  // Rareté relevée dans le jeu (collection créée depuis les cartes du jeu), sinon null.
  const realRarity = (item) => (item && RARITIES.includes(item.rarity) ? item.rarity : null);
  // Intercalaire libre (2026-10-28, demande de l'utilisateur : « déclarer un regroupement sans que ce soit lié à une
  // carte ») : élément {title, status: 'label', sep: true}, un nom qui ouvre une section de l'album. Jamais une carte :
  // ni case vide, ni progression, ni souhait ; montré seulement par le bandeau de sa section (ordre de la collection,
  // sans filtre) et dans « Réorganiser ».
  const isLabel = (item) => !!item && item.status === 'label';
  const cardItems = (items) => items.reduce((n, it) => n + (isLabel(it) ? 0 : 1), 0);
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
  store.del('classeur-import-key'); // clés d'import de l'ancienne synchro (retirée le 22 octobre 2026) : plus rien ne les lit

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
    mMore: false, // téléphone : feuille « Plus » ouverte
    mFacets: false, // téléphone : filtres de « Mes cartes » ouverts (feuille)
    installReady: false, // le navigateur propose l'installation (beforeinstallprompt, Android et Chrome) : bouton « Installer »
    installed: false, // l'app vient d'être installée depuis ce navigateur (appinstalled)
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
    duplicatesOnly: false,
    keptOnly: false, // « Exclues des échanges et ventes » (prefs.keep)
    keepTag: '', // tag tapé dans « Exclues des échanges et ventes »
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
    notice: null,
    modal: null, // editor | confirm | tag | switch | link | arrange | tagadd | merge | install | trade
    session: { cookie: '', busy: false, error: '' }, // liaison en secours : cookie collé ou HAR
    // « Relier mon compte » (onglet « Synchro ») : jeton à usage unique du favori « Relier » (POST /api/link), son
    // expiration, l'heure de la session reliée à sa création (sa liaison la change) ; clicked = favori cliqué ici.
    link: { token: '', until: '', at: null, busy: false, error: '', clicked: false },
    auto: { busy: false, error: '' }, // case « Synchro automatique » (PATCH /api/me {auto_sync})
    fast: { busy: false, error: '' }, // case « Synchro rapide du marché » de Réglages (PATCH /api/me {fast_sync})
    editor: null,
    confirm: null,
    tagEdit: null,
    // « Fusionner avec… » (album d'une de tes collections) : {id (celle d'où l'on part, qui reçoit la fusion), other (id de
    // l'autre, null tant qu'elle n'est pas choisie), name (nom de la collection fusionnée), drop (supprimer l'autre après),
    // head (la première carte ajoutée devient un intercalaire), busy, error}.
    merge: null,
    tradeNew: null, // « Proposer un échange » : {f (l'ami), give, get (ids de cartes cochées), giveWb, getWb (wikibidous tapés), busy, error, done, fr (amitié dans le jeu)}
    autoFriend: { busy: false, error: '' }, // case « Demandes d'ami automatiques » de Réglages (PATCH /api/me {auto_friend})
    // Liste de souhaits dans les albums : choix par collection et synchronisation manuelle.
    // (POST /api/wishlist/sync) ; msg = résultat du clic.
    autoWish: { busy: false, error: '', syncBusy: false, msg: '', targetId: null },
    wishMissing: { busy: false, error: '', message: '', items: [], revision: '', selected: new Set(), limit: 100 },
    autoTag: { busy: false, targetId: null, syncTargetId: null, error: '' },
    friendsAdd: null, // « Ajouter les membres pas encore amis » : {st (loading | ready | error), list [{id, name, pseudo, st, result?, error?}], pick (ids cochés), busy, error, fromCheck}
    // « Mettre en vente » : {c (la carte), k (rareté d'exemplaire choisie), base (texte du champ), minutes, info (GET
    // /api/market/sell), infoBusy, infoError, busy, error, verify, done (la vente créée), cancelBusy, cancelError, cancelled}.
    sell: null,
    // « Miser » : {x (l'enchère, voir openBid), min (mise minimale), amount (texte du champ), busy, error, verify, done (la
    // mise faite : {amount, cur, balance, url})}.
    bid: null,
    // « Réorganiser » (album d'une de tes collections qui a un ordre) : brouillon du nouvel ordre, voir startReorder.
    reorder: null,
    // « Réorganiser » de « Mes collections » : brouillon de l'ordre des collections, voir startColOrder.
    colOrder: null,
    settings: { at: 'profil', name: '', busy: false, error: '', saved: false, pseudo: '', pBusy: false, pError: '', pSaved: false },
    copied: '',
    pv: { version: 0, running: false, done: 0, total: 0, error: '' },
    artV: 0, // avance quand art.js apprend l'image anglaise d'un lot de titres (case « Image de Wikipédia en anglais »)
    artPicks: {}, // illustrations choisies à la main (GET /api/art) : titre de l'article -> adresse de l'image
    // « Changer l'illustration » : {title, base (image par défaut), desc, st (loading | ready | missing | error), list
    // (ClasseurArt.candidates), sel ('' = par défaut, sinon l'adresse choisie), busy, error}.
    artPick: null,
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
    friends: { status: 'idle', busy: false, error: '', loading: '', shareBusy: false, shareError: '', open: null, q: '', filter: 'all', sort: 'rarity', limit: PAGE, more: {}, page: null, duo: null, trade: 'all',
      album: null, albumFilter: 'all', albumSort: 'order', albumLimit: ALBUM_PAGE, albumFrom: null, copyBusy: false, copies: {} },
    // « Chat » (un salon pour tous les classeurs) : user = compte dont `read` (dernier message lu, aussi dans
    // localStorage) a été chargé ; status idle | loading | ready | error ; brouillon et envoi ; older = il y a des
    // messages plus anciens ; newBelow = nouveaux messages arrivés sous la zone lue (on n'était pas en bas).
    // ac = autocomplétion du champ ouverte : {kind ('@' membre | '#' carte | 'c' collection, après « #c: »), start (position
    // du @ ou du #), end (curseur), tq (texte tapé après), q (ce qui est cherché : tq sans « c: »), active (suggestion
    // surlignée)} ; acOff = {start, tq} : le @ ou # dont la liste a été fermée par
    // Échap, et ce qui était tapé (elle reste fermée tant qu'on continue ce mot) ;
    // acWp = articles de Wikipédia qui commencent par le texte tapé après « # » ({q (replié), titles, loading}) ;
    // reply = message auquel le brouillon répond ({id, author, text}, « Répondre » sur une bulle) ou null ; picker =
    // numéro du message dont le choix des réactions est ouvert (« Réagir »), ou null.
    chat: { user: null, status: 'idle', error: '', draft: '', sending: false, sendError: '', older: false, olderBusy: false, read: 0, newBelow: false, ac: null, acOff: null,
      acWp: { q: '', titles: [], loading: false }, reply: null, picker: null },
    // « Nouveautés » (/nouveautes.json) : status idle | loading | ready | error ; seen = dernière version vue dans ce
    // navigateur (localStorage) ; fresh = versions pas encore vues à l'ouverture de la page (« Nouveau » le temps de la visite).
    news: { status: 'idle', seen: store.get(LS.newsSeen), fresh: [] },
  });
  // Les cartes et les collections peuvent être nombreuses : tableaux non profonds d'objets figés (markRaw).
  const cards = shallowRef([]);
  const targets = shallowRef([]);
  const newIds = shallowRef([]);
  // Membres qui montrent leurs cartes (« Entre amis ») : [{id (public), name, count, fetched_at, cards | null, tshare
  // (montre aussi ses collections), tmark (leur nombre et dernier changement), targets ([{id, name, items:[{title, qid?}]}]
  // | null), wb (solde de wikibidous lu à sa dernière synchro, {n, at} | null)}], figés. En mémoire seulement, jamais dans IndexedDB (cardCache ne garde que ton classeur). friendsGen change à chaque
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

  // opts.key : autre clé ; opts.timeoutMs : rendre la main si une opération reste sans réponse.
  async function api(method, path, body, opts) {
    const headers = { Accept: 'application/json' };
    const keyed = path !== '/api/account' && path !== '/api/health';
    const key = (opts && opts.key) || S.key;
    if (keyed && key) headers['X-Classeur-Key'] = key;
    const init = { method, headers, credentials: 'same-origin' };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const ctrl = opts && opts.timeoutMs ? new AbortController() : null;
    if (ctrl) init.signal = ctrl.signal;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : null;
    let r;
    let data = null;
    try {
      r = await fetch(path, init);
      try { data = await r.json(); } catch (e) { if (ctrl && ctrl.signal.aborted) throw e; }
    } catch (e) {
      if (ctrl && ctrl.signal.aborted) throw new ApiError(0,
        opts.timeoutMessage || 'Le serveur met trop de temps à répondre. Réessaie dans un instant.', { timeout: true });
      throw new ApiError(0, 'Le classeur ne répond pas : vérifie ta connexion, puis réessaie.');
    } finally { if (timer) clearTimeout(timer); }
    if (!r.ok) {
      const msg = (data && typeof data.error === 'string' && data.error) || `Le classeur a répondu ${r.status}.`;
      // Clé inconnue (classeur supprimé, lien erroné) : retour à l'accueil. Un compte du jeu à relier n'est pas concerné.
      if (r.status === 401 && keyed && !(opts && opts.key) && !(data && data.needs_link) && S.boot === 'app') lostKey(msg);
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
  // Vignette de Wikipédia : la page la retrouve d'elle-même (pageimages), elle n'a pas besoin d'être rangée. L'API les
  // sert sur thumb.wikimedia.org (avec des paramètres utm_…) depuis fin octobre 2026, avant sur upload.wikimedia.org.
  const WIKI_THUMB = /^https?:\/\/(upload|thumb)\.wikimedia\.org\//i;
  async function saveTargetApi(body) {
    let items = Array.isArray(body.items) ? body.items : [];
    // Au-delà de 1,7 Mo, les vignettes de Wikipédia partent (comme à la fusion) : une liste de 8 000 articles avec leurs
    // adresses d'images n'y tiendrait pas, sans elles si (2026-10-28). Les images du jeu restent.
    if (items.some((it) => it && typeof it.image === 'string' && WIKI_THUMB.test(it.image))
      && utf8Length(JSON.stringify(items)) > TARGET_MAX_BYTES) {
      items = items.map((it) => (it && typeof it.image === 'string' && WIKI_THUMB.test(it.image) ? { ...it, image: null } : it));
      body = { ...body, items };
    }
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
    if (!item || isLabel(item)) return null;
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
  const duplicatesCount = computed(() => cards.value.reduce((n, c) => n + (c.count > 1 ? 1 : 0), 0));
  // Cartes exclues des échanges et des ventes (2026-10-29, demande de l'utilisateur) : choisies une à une ou par tag
  // (tags exacts), gardées avec le compte (prefs.keep = {cards: [ids], tags: [tags]}). Une carte exclue n'est proposée ni
  // dans « Échanges possibles » (donc ni « Ce qui pourrait intéresser tes amis » ni « Proposer un échange ») ni dans
  // « Bonnes affaires à vendre » ; GET /api/members dit aussi à tes amis lesquelles de tes cartes le sont (keep, sans les
  // tags), pour que leurs échanges ne les demandent pas.
  const KEEP_MAX_CARDS = 1000;
  const KEEP_MAX_TAGS = 100;
  const keepPref = computed(() => {
    const k = S.prefs && S.prefs.keep && typeof S.prefs.keep === 'object' ? S.prefs.keep : {};
    const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
    return { cards: new Set(list(k.cards)), tags: new Set(list(k.tags)) };
  });
  // Ce qui exclut une carte : null, ou {card} (exclue elle-même) et {tag} (le premier de ses tags exclus, ou null).
  function keptBy(c) {
    const k = keepPref.value;
    const card = k.cards.has(String(c.id));
    const tag = k.tags.size ? c.tags.find((t) => k.tags.has(t)) || null : null;
    return card || tag ? { card, tag } : null;
  }
  const isKept = (c) => !!keptBy(c);
  const keptCount = computed(() => cards.value.reduce((n, c) => n + (isKept(c) ? 1 : 0), 0));
  const saveKeep = (cardIds, tags) => savePrefs({ keep: { cards: [...cardIds], tags: [...tags] } });
  // Exclure (on) ou réintégrer des cartes choisies une à une. Réintégrer une carte exclue par un tag ne la réintègre pas :
  // il faut retirer le tag de la liste (la fiche le dit).
  function setKeepCards(ids, on) {
    const k = keepPref.value;
    const next = new Set(k.cards);
    for (const id of ids) { if (on) next.add(String(id)); else next.delete(String(id)); }
    if (next.size > KEEP_MAX_CARDS) {
      notify(`${fmt(KEEP_MAX_CARDS)} cartes exclues une à une au plus : pour en exclure davantage, pose-leur un tag et exclus ce tag.`, true);
      return Promise.resolve(false);
    }
    return saveKeep(next, k.tags);
  }
  function addKeepTag(raw) {
    const t = cleanTag(raw);
    const k = keepPref.value;
    if (!t || k.tags.has(t)) { S.keepTag = ''; return; }
    if (k.tags.size >= KEEP_MAX_TAGS) { notify(`${fmt(KEEP_MAX_TAGS)} tags exclus au plus.`, true); return; }
    S.keepTag = '';
    saveKeep(k.cards, [...k.tags, t]);
  }
  const removeKeepTag = (t) => { const k = keepPref.value; saveKeep(k.cards, [...k.tags].filter((x) => x !== t)); };
  const hasFilters = computed(() => !!(S.tagFilter.length || S.gtagFilter.length || S.untaggedOnly || S.newOnly || S.duplicatesOnly || S.keptOnly || S.q.trim() || S.rarities.length));
  const SORTERS = {
    rarity: (a, b) => (RANK[a.rarity] ?? 9) - (RANK[b.rarity] ?? 9) || (b.pageviews ?? -1) - (a.pageviews ?? -1),
    pageviews: (a, b) => (b.pageviews ?? -1) - (a.pageviews ?? -1),
    obtained: (a, b) => String(b.obtained_at || '').localeCompare(String(a.obtained_at || '')),
    atk: (a, b) => (b.atk ?? -1) - (a.atk ?? -1),
    def: (a, b) => (b.def ?? -1) - (a.def ?? -1),
    title: (a, b) => COLLATOR.compare(a.title, b.title),
  };
  // « Mes cartes » : recherche (titre, description, tags du jeu, tags), raretés, tags du jeu et tags (combinés), sans tag,
  // nouvelles et doublons.
  const filtered = computed(() => {
    const q = fold(S.q.trim());
    const rar = new Set(S.rarities.length ? S.rarities : RARITIES);
    const tags = S.tagFilter;
    const fresh = newIdSet.value;
    const out = cards.value.filter((c) => rar.has(c.rarity)
      && (!q || c._k.includes(q) || c.tags.some((t) => fold(t).includes(q)))
      && (!S.untaggedOnly || !c.tags.length)
      && (!S.newOnly || fresh.has(c.id))
      && (!S.duplicatesOnly || c.count > 1)
      && (!S.keptOnly || isKept(c))
      && tags.every((tok) => (tok.endsWith('/') ? c.tags.some((t) => tagCat(t) === tok.slice(0, -1)) : c.tags.includes(tok)))
      && S.gtagFilter.every((k) => c.gtags.some((t) => catKey(t) === k)));
    // Prix (cote de ton meilleur exemplaire ; sans cote fiable, à la fin) : à égalité, par rareté.
    if (isPriceSort(S.sort)) return sortByPrice(out, (c) => cardPrice(c, ownCote(c)), priceDir(S.sort), SORTERS.rarity);
    return out.sort(SORTERS[S.sort] || SORTERS.rarity);
  });
  const visibleCards = computed(() => filtered.value.slice(0, S.limit));

  // Collections à compléter du serveur (targets), toutes dans « Mes collections » : créées depuis les cartes du jeu, à la
  // main dans « Nouvelle collection », depuis une catégorie de Wikipédia (source
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
    return { own, total: cardItems(col.items), byR, sample: sample.slice(0, 3) };
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
  const progressOf = (col) => (col.kind === 'category' ? catProgress.value : progress.value.get(col.key)) || { own: 0, total: cardItems(col.items), byR: {}, sample: [] };
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
    let no = 0; // numéro de la case (les intercalaires libres n'en ont pas)
    let slots = col.items.map((item, i) => {
      if (isLabel(item)) return { i: no, key: 'label:' + i + ':' + item.title, item, card: null, views: null, real: null, est: null, thumb: null };
      const card = findCard(item);
      const info = card ? null : pvCache.get(item.title);
      const views = info ? info[0] : null;
      // real : rareté donnée par le jeu (pastille sans « ≈ ») ; est : estimée d'après les vues, pour les autres.
      const real = card ? null : realRarity(item);
      return { i: ++no, key: card ? card.id + ':' + i : 'vide:' + i + ':' + item.title, item, card, views, real, est: card || real || item.status !== 'ok' ? null : estRarity(views), thumb: info ? info[1] : null };
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
    return collections.value.all.filter((col) => col.items.some((it) => !isLabel(it) && (normTitle(it.title) === k || (!!item.qid && it.qid === item.qid))));
  }
  const personalLink = computed(() => (S.key ? location.origin + '/#cle=' + S.key : ''));
  // Favori « Relier » : pose le jeton à usage unique dans window.__classeurLien et charge le code de liaison depuis le
  // classeur (GET /api/favori.js, relier.js). Court, pour marcher sur téléphone ; le jeton ne passe jamais par l'adresse du
  // script, et ne vaut que 30 minutes et une liaison.
  const relierUrl = computed(() => {
    if (!S.link.token) return '';
    const code = `(function(){window.__classeurLien={t:${JSON.stringify(S.link.token)}};var s=document.createElement("script");`
      + `s.src=${JSON.stringify(location.origin + '/api/favori.js')};s.async=true;document.documentElement.appendChild(s)})();`;
    return 'javascript:' + encodeURI(code).replace(/#/g, '%23');
  });

  // ---------------------------------------------------------------- « Entre amis » : qui a quoi
  const sharing = () => !!(S.me && S.me.shared);
  const sharingTargets = () => !!(S.me && S.me.shared && S.me.shared_targets); // et ses collections à compléter
  // Ton identifiant public (celui que voient les autres membres), tant que tu montres tes cartes ; null avant (ancien serveur).
  const myPid = () => (sharing() && typeof S.me.public_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(S.me.public_id) ? S.me.public_id : null);
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
  // Jamais une carte qui casserait une collection de X (2026-10-26, demande de l'utilisateur) : une carte que X n'a qu'en
  // un exemplaire et qui remplit une case d'une de ses collections n'est pas proposée (en double, elle l'est : il en
  // garde une). Pour un ami qui ne montre pas ses collections, on ne peut pas savoir : ses cartes restent proposées.
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
    // Collections de chacun, et ses cartes qui y remplissent une case (à ne pas donner s'il n'en a qu'une).
    const colsBy = new Map();
    const usedBy = new Map();
    for (const p of people) {
      const cols = colsOf(p);
      const used = new Set();
      for (const col of cols) for (const it of col.items) {
        if (!it || (it.status && it.status !== 'ok')) continue;
        const c = p.index.findCard(it);
        if (c) used.add(c.id);
      }
      colsBy.set(p, cols);
      usedBy.set(p, used);
    }
    const pairs = [];
    for (const z of people) {
      // Cases vides de Z (un même article dans deux de ses collections : une seule case, les deux noms).
      const holes = new Map();
      for (const col of colsBy.get(z)) {
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
        const used = usedBy.get(x);
        const byCard = new Map();
        for (const hole of holes.values()) {
          if (!hole) continue;
          const c = x.index.findCard(hole.item);
          if (!c) continue;
          const row = byCard.get(c.id);
          if (row) { for (const n of hole.cols) if (!row.cols.some((x) => sameCol(x, n))) row.cols.push(n); continue; }
          if (x.me ? isKept(c) : x.f.keep && x.f.keep.has(c.id)) continue; // exclue des échanges (prefs.keep)
          const count = Math.max(1, Number(c.count) || 1);
          if (count < 2 && used.has(c.id)) continue;
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
    if (tradeDupOn()) list = list.map((p) => ({ ...p, rows: p.rows.filter((r) => r.dup) })).filter((p) => p.rows.length);
    return tradeDuos(list);
  });
  // Un bloc par paire de membres (2026-10-24, demande d'un membre : « Toi → Paul » et « Paul → Toi » étaient deux blocs, on
  // ne s'y retrouvait pas) : les deux sens ensemble, toi d'abord (puis de A à Z entre deux amis), ce que tu donnes avant ce
  // que tu reçois. Ordre des blocs : le plus de doubles, puis le plus de cases ; à égalité, par prénoms (toi d'abord).
  // ab = le sens a → b, ba = b → a (null : rien dans ce sens). off : une paire avec toi et un ami qui n'a ni relié son
  // compte du jeu ni donné son pseudo (on ne saurait pas à qui proposer l'échange) : grisée, rangée après les autres
  // (2026-10-28, demande de l'utilisateur).
  const noGameTrade = (d) => !!(d.a.me && d.b.f && !d.b.f.game);
  // Le jeu refuse d'échanger un exemplaire favori (2026-10-28) : une carte dont tous les exemplaires le sont est grisée (fav =
  // exemplaires favoris, lu à la synchro ; sans lui, seule une carte à un seul exemplaire favori est sûre). Une paire dont
  // toutes les cartes, dans les deux sens, sont dans ce cas est grisée en entier.
  const favLocked = (c) => {
    const n = Math.max(1, Number(c.count) || 1);
    const f = Number(c.fav);
    return f > 0 ? f >= n : !!c.starred && n === 1;
  };
  const lockedSide = (p) => !!p && p.rows.length > 0 && p.rows.every((r) => favLocked(r.card));
  const lockedTrade = (d) => !!(d.ab || d.ba) && (!d.ab || lockedSide(d.ab)) && (!d.ba || lockedSide(d.ba));
  const offTrade = (d) => noGameTrade(d) || lockedTrade(d);
  function tradeDuos(pairs) {
    const who = (p) => (p.me ? '' : friendName(p.f));
    const duos = new Map();
    for (const p of pairs) {
      const [a, b] = COLLATOR.compare(who(p.x), who(p.z)) <= 0 ? [p.x, p.z] : [p.z, p.x];
      const key = a.id + '<>' + b.id;
      let d = duos.get(key);
      if (!d) duos.set(key, (d = { key, a, b, ab: null, ba: null, dup: 0, n: 0 }));
      if (p.x === a) d.ab = p; else d.ba = p;
      d.dup += p.dup;
      d.n += p.rows.length;
    }
    return [...duos.values()].sort((u, v) => offTrade(u) - offTrade(v) || v.dup - u.dup || v.n - u.n
      || COLLATOR.compare(who(u.a), who(v.a)) || COLLATOR.compare(who(u.b), who(v.b)));
  }
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
    return { own, total: cardItems(t.items), byR, sample: sample.slice(0, 3), help, helpDup, value, priced, cards: seen.size };
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
    let no = 0;
    return fa.t.items.map((item, i) => {
      if (isLabel(item)) return { i: no, key: 'label:' + i + ':' + item.title, item, card: null, mine: null, want: null, views: null, real: null, est: null, thumb: null };
      no++;
      const card = index.findCard(item);
      const mine = findCard(item);
      const hole = card && !mine ? holes.findCard(item) || holes.findCard(card) : null;
      const info = card || mine ? null : pvCache.get(item.title);
      const views = info ? info[0] : null;
      const real = card ? null : mine ? okRarity(mine.rarity) : null;
      return { i: no, key: (card ? 'c:' + card.id : 'v:' + item.title) + ':' + i, item, card, mine, want: hole ? hole.cols : null,
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

  // ---------------------------------------------------------------- clés : la sienne, les classeurs connus
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
    Object.assign(S, { me: null, fetchedAt: null, loadingCards: false, openId: null, openMissing: null, modal: null, editor: null, confirm: null, tagEdit: null, notice: null, switchAsk: null, tab: 'collections', album: null, reorder: null, colOrder: null, autoBusy: null,
      q: '', tagFilter: [], gtagFilter: [], untaggedOnly: false, newOnly: false, duplicatesOnly: false, keptOnly: false, rarities: [], limit: PAGE, lastClicked: null, bulkTag: '', bulkError: '' });
    S.selected.clear();
    Object.assign(S.autoTag, { busy: false, targetId: null, syncTargetId: null, error: '' });
    Object.assign(S.wishMissing, { busy: false, error: '', message: '', items: [], revision: '', selected: new Set(), limit: 100 });
    S.refresh.msg = '';
    S.refresh.error = false;
    S.refresh.warn = false;
    stopLinkWatch();
    Object.assign(S.link, { token: '', until: '', at: null, busy: false, error: '', clicked: false });
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
  // « Oublier ce navigateur » : la clé, les classeurs connus, les caches de Wikipédia et les cartes
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
    const lastBefore = S.me ? S.me.last_sync || null : undefined;
    S.me = me;
    noteLastSync(lastBefore, me.last_sync);
    noteLinked(me.session);
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
    // dépasserait la limite de calcul d'une requête. next_part peut être un nombre ou une chaîne opaque.
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
    if (resolver) { await resolver.ready(); qidVersion.value++; }
    if (stale()) return;
    S.bootError = '';
    S.bootHint = '';
    S.boot = 'app';
    const route = parseRoute(location.hash); // adresse de la vue (#/…), appliquée avant les données : voir la fin
    applyRoute(route);
    routeOn = true;
    routeSync();
    loadNews(true); // pastille « nouveau » du lien Nouveautés, messages système du chat
    S.artPicks = {};
    loadArtPicks();
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
    // Classeur vide : on commence par « Synchro » (relier son compte du jeu).
    if (!cards.value.length && S.tab === 'collections' && !S.album) { openSyncTab(); routeSync(); }
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
  // GET /api/sync-log : les dernières synchros du classeur, réussies ou non (au clic, automatiques, liaison du compte du
  // jeu), avec leur message ; lu à l'ouverture de « Synchro », quand une synchro arrive pendant qu'il est ouvert
  // (last_sync de GET /api/me change) et sur « Actualiser ».
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
  const VIA_LABEL = { clic: 'Clic', cron: 'Automatique', relier: 'Liaison' };
  // « quick » : ancienne synchro rapide, dans les lignes d'avant le 22 octobre 2026.
  const KIND_LABEL = { full: 'lecture complète', session: 'compte', quick: 'synchro rapide' };
  const RESULT_LABEL = { ok: 'réussie', warn: 'incomplète', error: 'échec' };
  // « Automatique · lecture complète » ; une ligne d'un ancien chemin (retiré) : « Synchro ».
  const syncKind = (via, kind) => `${VIA_LABEL[via] || 'Synchro'} · ${KIND_LABEL[kind] || 'synchro'}`;
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
  // Dernière ligne du journal (GET /api/me) : un nouvel échec d'une lecture automatique est annoncé (une seule fois par
  // message : le serveur regroupe le même échec répété), « Synchro » ouvert relit le journal. Les échecs au clic
  // s'affichent déjà à côté du bouton.
  function noteLastSync(before, ls) {
    if (!ls || (before && ls.at === before.at)) return;
    if (before !== undefined && ls.via !== 'clic' && !S.refresh.running) Object.assign(S.refresh, { msg: '', error: false, warn: false });
    if (before !== undefined && ls.result === 'error' && ls.via !== 'clic' && !(before && before.message === ls.message)) notify(`La dernière synchro a échoué : ${ls.message}`, true);
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
  // Lecture non vérifiée (complete:false) : ce qui s'est passé et quoi faire ; aucune carte n'a été retirée.
  function incompleteNote(res) {
    const kept = Number(res.kept) || 0;
    return (res.moved ? ' · ta collection a bougé pendant la lecture (compte du jeu différent avant et après)' : ' · moins d\'exemplaires lus que le jeu n\'en compte')
      + ` : aucune carte retirée${kept ? ` (${fmt(kept)} ${plural(kept, 'non vue, gardée', 'non vues, gardées')})` : ''}, rafraîchis dans un moment`;
  }
  async function refreshCollection() {
    if (S.refresh.running) return;
    const sess = (S.me && S.me.session) || {};
    if (!sess.linked) { openSyncTab(); return; }
    await runRefresh();
  }
  // « Rafraîchir » : le serveur lit toute la collection dans la base du jeu (POST /api/refresh, une fois par minute au
  // plus), avec la session reliée.
  async function runRefresh() {
    if (S.refresh.running) return;
    Object.assign(S.refresh, { running: true, error: false, warn: false, msg: 'Lecture de ta collection sur WikiMasters…' });
    try {
      const res = await api('POST', '/api/refresh', {});
      if (res.empty) {
        S.refresh.warn = true;
        S.refresh.msg = "Collection vide dans le jeu : rien n'a été changé.";
      } else {
        S.refresh.msg = importSummary(res);
        if (res.complete === false && !res.superseded) {
          S.refresh.warn = true;
          S.refresh.msg += incompleteNote(res);
        }
      }
      await Promise.all([syncCards(), loadMe()]);
      if (res.auto_tag || res.auto_favorite || targets.value.some(t => t.auto_favorite || (t.auto_tag && t.auto_tag.enabled))) await loadTargets();
      if (res.auto_tag && res.auto_tag.error) { S.refresh.warn = true; S.refresh.msg += ` Auto-tag : ${res.auto_tag.error}`; }
      if (res.auto_favorite) {
        if (res.auto_favorite.error) { S.refresh.warn = true; S.refresh.msg += ` Auto-favoris : ${res.auto_favorite.error}`; }
        else S.refresh.msg += ` Auto-favoris : ${fmt(res.auto_favorite.added || 0)} ajouté(s)${res.auto_favorite.left ? ` · ${fmt(res.auto_favorite.left)} en attente` : ''}.`;
      }
      startPageviews();
      afterCards();
    } catch (e) {
      S.refresh.error = true;
      const wait = e.data && Number(e.data.retry_after);
      S.refresh.msg = e.message + (e.status === 429 && wait > 0 ? ` (encore ${fmt(Math.ceil(wait))} s)` : '');
      if (e.data && e.data.needs_link) await loadMe().catch(() => {});
    } finally {
      S.refresh.running = false;
      if (S.tab === 'maj') loadSyncLog();
    }
  }

  // ---------------------------------------------------------------- compte du jeu relié
  // « Relier mon compte » : un jeton à usage unique (POST /api/link, 30 min), embarqué dans le favori « Relier » que le
  // membre clique dans une fenêtre privée connectée au jeu ; la session de cette fenêtre, que personne d'autre n'utilise,
  // devient celle du classeur. Pendant que le jeton vaut, GET /api/me est relu toutes les 4 s (onglet visible) : la
  // liaison change session.at, puis une première lecture part.
  const LINK_WATCH_EVERY = 4000;
  let linkTimer = null;
  function stopLinkWatch() { if (linkTimer) { clearInterval(linkTimer); linkTimer = null; } }
  function watchLink() {
    stopLinkWatch();
    let busy = false;
    linkTimer = setInterval(async () => {
      if (!S.link.token || Date.parse(S.link.until) < Date.now()) { stopLinkWatch(); return; }
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try { await loadMe(); } catch (e) { /* le prochain tour réessaie */ } finally { busy = false; }
    }, LINK_WATCH_EVERY);
  }
  async function createLink() {
    if (S.link.busy) return;
    Object.assign(S.link, { busy: true, error: '', clicked: false });
    try {
      const r = await api('POST', '/api/link', {});
      if (typeof r.token !== 'string' || !r.token) throw new Error("Le classeur n'a pas renvoyé de lien de liaison : réessaie.");
      const sess = (S.me && S.me.session) || {};
      Object.assign(S.link, { token: r.token, until: r.until || '', at: sess.linked ? sess.at || null : null });
      watchLink();
    } catch (e) {
      S.link.error = e.message;
    } finally {
      S.link.busy = false;
    }
  }
  // Session reliée par le favori pendant que le jeton valait (GET /api/me) : le favori a servi, on lit la collection.
  function noteLinked(sess) {
    if (!S.link.token || !sess || !sess.linked || (sess.at || null) === S.link.at) return;
    stopLinkWatch();
    Object.assign(S.link, { token: '', until: '', at: null, clicked: false, error: '' });
    notify('Compte du jeu relié : lecture de ta collection…');
    runRefresh();
  }
  async function sendSession(body) {
    S.session.busy = true;
    S.session.error = '';
    try {
      const r = await api('POST', '/api/session', body);
      S.session.cookie = '';
      if (S.me && r.session) S.me.session = r.session;
      notify(`Compte du jeu relié${r.pseudo ? ` (${r.pseudo})` : ''} : lecture de ta collection…`);
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
    if (!cookie) { S.session.error = "Colle la valeur de l'en-tête Cookie, copiée depuis ta fenêtre privée."; return; }
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
      S.session.error = "Ce fichier n'est pas un export HAR lisible : exporte-le à nouveau depuis l'onglet Réseau de ta fenêtre privée.";
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
  // « Oublier la liaison » : le classeur efface sa session du jeu (DELETE /api/session), sans te déconnecter du jeu.
  async function forgetSession() {
    S.session.busy = true;
    S.session.error = '';
    try {
      await api('DELETE', '/api/session');
      await loadMe();
      notify('Liaison oubliée : le classeur ne lit plus ton compte du jeu.');
    } catch (e) {
      S.session.error = e.message;
    } finally {
      S.session.busy = false;
    }
  }
  // « Synchro automatique » (PATCH /api/me {auto_sync}) : le serveur lit tout seul la collection et le marché, ou seulement au clic.
  async function setAutoSync(on) {
    if (S.auto.busy) return;
    Object.assign(S.auto, { busy: true, error: '' });
    try {
      const r = await api('PATCH', '/api/me', { auto_sync: on });
      if (S.me && S.me.session) S.me.session.auto_sync = typeof r.auto_sync === 'boolean' ? r.auto_sync : on;
    } catch (e) {
      S.auto.error = e.message;
    } finally {
      S.auto.busy = false;
    }
  }

  // « Demandes d'ami automatiques » (PATCH /api/me {auto_friend}, coupée par défaut) : le serveur envoie seul une demande
  // d'ami du jeu aux autres membres reliés (friends.js, pendant les lectures automatiques).
  async function setAutoFriend(on) {
    if (S.autoFriend.busy) return;
    Object.assign(S.autoFriend, { busy: true, error: '' });
    try {
      const r = await api('PATCH', '/api/me', { auto_friend: on });
      const now = typeof r.auto_friend === 'boolean' ? r.auto_friend : on;
      if (S.me) S.me.auto_friend = now;
      if (now) openFriendsAdd(true); // et les membres déjà là : proposés tout de suite, plutôt qu'au fil des lectures automatiques
    } catch (e) {
      S.autoFriend.error = e.message;
    } finally {
      S.autoFriend.busy = false;
    }
  }
  // Choix par collection ; saveTargetFresh préserve les modifications concurrentes (autres onglets/appareils).
  async function setWishMode(mode) {
    if (S.autoWish.busy) return;
    const gen = cardsGen;
    Object.assign(S.autoWish, { busy: true, targetId: null, error: '', msg: '' });
    try {
      const r = await api('PATCH', '/api/me', { wish_mode: mode });
      if (gen !== cardsGen) return;
      if (S.me) Object.assign(S.me, { wish_mode: r.wish_mode, auto_wish: r.auto_wish });
      S.autoWish.msg = mode === 'all' ? 'Toutes tes collections sont synchronisées, y compris celles que tu créeras.'
        : 'Seules les collections cochées sont synchronisées. Tes choix individuels ont été conservés.';
    } catch (e) {
      if (gen === cardsGen) S.autoWish.error = e.message;
    } finally {
      if (gen === cardsGen) S.autoWish.busy = false;
    }
  }
  async function setTargetWish(t, on) {
    if (S.autoWish.busy) return;
    const gen = cardsGen;
    Object.assign(S.autoWish, { busy: true, targetId: t.id, error: '', msg: '' });
    try {
      const nt = await saveTargetFresh(t.id, { wish_sync: on });
      if (!nt || gen !== cardsGen) return;
      S.autoWish.msg = on ? 'Collection sélectionnée pour les souhaits du jeu.'
        : 'Synchronisation arrêtée. Retrait des souhaits non partagés en attente.';
    } catch (e) {
      if (gen === cardsGen) S.autoWish.error = e.message;
    } finally {
      if (gen === cardsGen) S.autoWish.busy = false;
    }
  }
  async function syncWish(t = null) {
    if (S.autoWish.syncBusy) return;
    const gen = cardsGen;
    Object.assign(S.autoWish, { syncBusy: true, targetId: t ? t.id : null, error: '', msg: '' });
    try {
      const r = await api('POST', '/api/wishlist/sync', {});
      if (gen !== cardsGen) return;
      if (S.me) S.me.wish = r.wish;
      S.autoWish.msg = wishDone(r.wish);
    } catch (e) {
      if (gen === cardsGen) S.autoWish.error = e.message;
    } finally {
      if (gen === cardsGen) S.autoWish.syncBusy = false;
    }
  }
  // Ce qu'a fait une passe : « 12 cartes ajoutées, 1 retirée » ; « 3 cartes retirées » ; rien : « Rien à changer ».
  // Passe de retrait (clear, clic case décochée) : ce qui reste à retirer.
  function wishDone(w) {
    if (!w) return '';
    const parts = [];
    if (w.added) parts.push(`${fmt(w.added)} ${plural(w.added, 'carte ajoutée', 'cartes ajoutées')}`);
    if (w.removed) parts.push(w.added ? `${fmt(w.removed)} ${plural(w.removed, 'retirée', 'retirées')}` : `${fmt(w.removed)} ${plural(w.removed, 'carte retirée', 'cartes retirées')}`);
    if (w.clear && w.left) parts.push(`${fmt(w.left)} encore à retirer : clique à nouveau dans une minute`);
    if (w.clear && !parts.length) return 'Aucune carte de tes collections dans ta liste de souhaits du jeu.';
    return parts.length ? parts.join(', ') + '.' : 'Rien à changer.';
  }
  // Dernière passe (GET /api/me, wish) : quand, ce qu'elle a fait, ce qui reste ; ou son échec.
  function wishLine(w) {
    if (!w) return h('p', { class: 'small muted' }, 'Première mise à jour en cours : son résultat s\'affiche ici dans une minute.');
    if (w.error) return h('p', { class: 'status err' }, `Dernière mise à jour en échec (${agoText(w.at)}) : ${w.error}`);
    const bits = [`Dernière mise à jour ${agoText(w.at)} : ${wishDone(w).replace(/\.$/, '')}`];
    if (Number.isInteger(w.size)) bits.push(`${fmt(w.size)} ${plural(w.size, 'carte', 'cartes')} dans ta liste de souhaits du jeu`);
    if (w.left) bits.push(`${fmt(w.left)} encore à traiter (le classeur continue pendant les synchronisations automatiques)`);
    if (w.none) bits.push(`${fmt(w.none)} ${plural(w.none, 'titre', 'titres')} de tes collections sans carte dans le jeu`);
    return h('p', { class: 'small muted' }, [bits.join(' · ') + '.', w.none
      ? h('a', { href: '#/souhaits-sans-cartes', class: 'wish-missing-link' }, 'Voir les titres sans cartes') : null]);
  }
  async function loadMissingWishes() {
    const gen = cardsGen, m = S.wishMissing;
    Object.assign(m, { busy: true, error: '', items: [], revision: '', selected: new Set(), limit: 100 });
    try {
      const r = await api('GET', '/api/wishlist/missing', undefined, { timeoutMs: 30000 });
      if (gen === cardsGen) Object.assign(m, { items: r.items, revision: r.revision });
    } catch (e) { if (gen === cardsGen) m.error = e.message; }
    finally { if (gen === cardsGen) m.busy = false; }
  }
  function askDeleteMissingWishes(all) {
    const m = S.wishMissing;
    const titles = [...m.selected], revision = m.revision, gen = cardsGen;
    const n = all ? m.items.length : titles.length;
    if (!n || m.busy) return;
    openConfirm({ title: 'Supprimer les titres sans cartes ?',
      text: `Retirer ${fmt(n)} ${plural(n, 'titre', 'titres')} de toutes les collections synchronisées qui les contiennent ?`,
      ok: all ? 'Tout supprimer' : 'Supprimer les sélectionnés', danger: true,
      run: async () => {
        try {
          const r = await api('POST', '/api/wishlist/missing', all ? { all: true, revision } : { titles, revision },
            { timeoutMs: 30000, timeoutMessage: 'Le serveur met trop de temps à répondre. Actualise la liste avant de réessayer : la suppression a peut-être été appliquée.' });
          if (gen !== cardsGen) return;
          m.message = `${fmt(r.removed)} ${plural(r.removed, 'titre retiré', 'titres retirés')}.`
            + (r.skipped ? ' Certaines collections ont été modifiées entre-temps et ont été conservées.' : '');
          await Promise.all([loadTargets(), loadMissingWishes()]);
          if (S.me && S.me.wish && !m.error) S.me.wish.none = m.items.length;
        } catch (e) {
          if (gen === cardsGen && e.status === 409) await loadMissingWishes();
          throw e;
        }
      } });
  }
  function viewMissingWishes() {
    const m = S.wishMissing;
    return h('div', { class: 'wish-missing' }, [
      h('a', { href: '#/collections', class: 'back' }, '← Mes collections'),
      h('div', { class: 'section-head' }, [h('h2', { id: 'h-wish-missing' }, 'Titres sans cartes')]),
      h('p', { class: 'small muted' }, 'Titres non trouvés dans le jeu pour toutes tes collections synchronisées. Copie un nom pour le vérifier dans WikiMasters.'),
      h('div', { class: 'actions' }, [
        h('button', { id: 'wish-missing-delete-all', class: 'btn danger', disabled: m.busy || !m.items.length,
          onClick: () => askDeleteMissingWishes(true) }, 'Supprimer tous ces titres des collections'),
        h('button', { id: 'wish-missing-delete-selected', class: 'btn danger', disabled: m.busy || !m.selected.size,
          onClick: () => askDeleteMissingWishes(false) }, `Supprimer les sélectionnés (${fmt(m.selected.size)})`),
        h('button', { class: 'btn', disabled: m.busy, onClick: () => loadMissingWishes() }, 'Actualiser'),
      ]),
      m.message ? h('p', { class: 'status ok', role: 'status' }, m.message) : null,
      errLine(m.error),
      m.busy ? h('p', { role: 'status' }, 'Chargement…') : !m.error && !m.items.length
        ? h('p', null, 'Aucun titre sans carte dans tes collections synchronisées.') : null,
      !m.busy && m.items.length ? h('p', { class: 'small muted' }, `${fmt(m.items.length)} ${plural(m.items.length, 'titre', 'titres')}`) : null,
      h('ul', { class: 'wish-missing-list' }, m.items.slice(0, m.limit).map((r) => h('li', { class: 'wish-missing-item', key: r.title }, [
        h('label', { class: 'check' }, [h('input', { type: 'checkbox', checked: m.selected.has(r.title),
          onChange: (e) => e.target.checked ? m.selected.add(r.title) : m.selected.delete(r.title) }), h('span', null, r.title)]),
        copyNameButton(r.title),
        h('div', { class: 'small muted wish-missing-collections' }, r.collections.map((c, i) => [i ? ' · ' : '',
          h('a', { href: '#/collections/' + encodeURIComponent(c.id) }, c.name)])),
      ]))),
      m.items.length > m.limit ? h('button', { class: 'btn', onClick: () => { m.limit += 100; } }, 'Afficher la suite') : null,
    ]);
  }
  watch(() => S.boot === 'app' && S.tab === 'souhaits-sans-cartes', (on) => {
    if (on) { S.wishMissing.message = ''; loadMissingWishes(); }
  });
  function viewTargetWish(t) {
    if (S.me && S.me.wish_mode === 'all') return null;
    const linked = S.me && S.me.session && S.me.session.linked && !S.me.session.lost;
    const ownMessage = S.autoWish.targetId === t.id;
    return h('section', { class: 'album-wish', 'aria-label': 'Liste de souhaits du jeu' }, [
      h('label', { class: 'check' }, [
        h('input', { id: 'collection-wish-sync', type: 'checkbox', checked: !!t.wish_sync, disabled: S.autoWish.busy,
          onChange: (e) => { const on = e.target.checked; e.target.checked = !!t.wish_sync; setTargetWish(t, on); } }),
        'Synchroniser les souhaits de cette collection',
      ]),
      h('p', { class: 'small muted' }, ['Ajoute les manquantes, retire tous les souhaits déjà obtenus. ', h('a', { href: '#/reglages' }, 'Réglages')]),
      linked ? h('div', { class: 'actions' }, [h('button', { class: 'btn', type: 'button', disabled: S.autoWish.syncBusy || S.autoWish.busy,
        onClick: () => syncWish(t) }, S.autoWish.syncBusy ? 'Mise à jour…' : 'Synchroniser les souhaits maintenant')])
        : h('p', { class: 'small muted' }, 'Compte du jeu à relier dans « Synchro ».'),
      S.me && S.me.wish ? wishLine(S.me.wish) : null,
      ownMessage && S.autoWish.msg ? h('p', { class: 'status ok', role: 'status' }, S.autoWish.msg) : null,
      ownMessage ? errLine(S.autoWish.error) : null,
    ]);
  }
  async function setCollectionAutoTag(t, tag, enabled) {
    if (S.autoTag.busy) return;
    if (enabled && !tag) return;
    const gen = cardsGen;
    Object.assign(S.autoTag, { busy: true, targetId: t.id, syncTargetId: null, error: '' });
    try {
      const r = await api('POST', '/api/targets/autotag', { id: t.id, tag, enabled });
      if (gen !== cardsGen) return;
      if (r.target) upsertTarget(r.target);
    } catch (e) {
      if (gen === cardsGen) S.autoTag.error = e.message;
    } finally {
      if (gen === cardsGen) S.autoTag.busy = false;
    }
  }
  async function syncCollectionAutoTag(t) {
    if (S.refresh.running || S.autoTag.busy || !(t.auto_favorite || (t.auto_tag && t.auto_tag.enabled))) return;
    S.autoTag.syncTargetId = t.id;
    await runRefresh();
  }
  async function setCollectionAutoFavorite(t, enabled) {
    if (S.autoTag.busy) return;
    const gen = cardsGen;
    Object.assign(S.autoTag, { busy: true, targetId: t.id, syncTargetId: null, error: '' });
    try {
      const r = await api('POST', '/api/targets/favorite', { id: t.id, enabled });
      if (gen === cardsGen && r.target) upsertTarget(r.target);
    } catch (e) {
      if (gen === cardsGen) S.autoTag.error = e.message;
    } finally {
      if (gen === cardsGen) S.autoTag.busy = false;
    }
  }
  function viewAutoTag(t) {
    const cfg = t.auto_tag || {};
    const tags = gameTagList.value.map(g => g.label);
    if (cfg.tag && !tags.includes(cfg.tag)) tags.unshift(cfg.tag);
    const chosen = cfg.tag || '';
    const linked = S.me && S.me.session && S.me.session.linked && !S.me.session.lost;
    const st = t.auto_tag_state;
    return h('section', { class: 'album-wish', 'aria-label': 'Auto-tag dans le jeu' }, [
      h('div', { class: 'album-auto-options' }, [h('label', { class: 'check' }, [
        h('input', { id: 'collection-auto-tag', type: 'checkbox', checked: !!cfg.enabled, disabled: S.autoTag.busy || !chosen,
          onChange: e => { const enabled = e.target.checked; e.target.checked = !!cfg.enabled; setCollectionAutoTag(t, chosen, enabled); } }),
        'Auto-tag dans WikiMasters',
      ]), h('label', { class: 'check' }, [
        h('input', { id: 'collection-auto-favorite', type: 'checkbox', checked: !!t.auto_favorite, disabled: S.autoTag.busy,
          onChange: e => { const enabled = e.target.checked; e.target.checked = !!t.auto_favorite; setCollectionAutoFavorite(t, enabled); } }),
        'Auto-favoris dans WikiMasters',
      ])]),
      h('div', { class: 'actions' }, [h('button', { id: 'collection-auto-tag-sync', class: 'btn', type: 'button',
        disabled: !(t.auto_favorite || (cfg.enabled && chosen)) || !linked || S.autoTag.busy || S.refresh.running,
        onClick: () => syncCollectionAutoTag(t) }, S.refresh.running ? 'Synchronisation…' : 'Synchroniser maintenant')]),
      tags.length ? h('label', { class: 'wish-mode' }, [h('span', { class: 'small muted' }, 'Tag du jeu lié à cette collection. Désactiver conserve cartes et tags.'),
        h('select', { id: 'collection-auto-tag-name', class: 'field full', value: chosen, disabled: S.autoTag.busy || !!cfg.enabled,
          title: cfg.enabled ? 'Désactive l’auto-tag pour changer le tag lié.' : null,
          onChange: e => setCollectionAutoTag(t, e.target.value, false) }, [h('option', { value: '' }, 'Choisir un tag du jeu…'),
            ...tags.map(tag => h('option', { key: tag, value: tag }, tag))]),
      ]) : h('p', { class: 'small muted' }, 'Pose un tag sur une carte dans le jeu, puis rafraîchis le classeur.'),
      cfg.enabled ? h('p', { class: 'small muted' }, 'L’auto-tag remplace l’ajout automatique par règles pour cet album.') : null,
      t.auto_favorite ? h('p', { class: 'small muted' }, 'Un exemplaire en favori par carte. Désactiver conserve les favoris.') : null,
      (cfg.enabled || t.auto_favorite) && !linked
        ? h('p', { class: 'small muted' }, 'Compte du jeu à relier dans « Synchro ».') : null,
      st ? h('p', { class: st.error ? 'status err' : 'small muted', role: 'status' }, st.error ||
        `Dernière synchro : ${fmt(st.added || 0)} tag(s) ajouté(s), ${fmt(st.removed || 0)} retiré(s) · ${fmt(st.cards_added || 0)} carte(s) ajoutée(s), ${fmt(st.cards_removed || 0)} retirée(s)${st.left ? ` · ${fmt(st.left)} opération(s) en attente` : ''}.`) : null,
      t.auto_favorite_state ? h('p', { class: t.auto_favorite_state.error ? 'status err' : 'small muted', role: 'status' },
        t.auto_favorite_state.error || `Dernière synchro favoris : ${fmt(t.auto_favorite_state.added || 0)} ajouté(s)${t.auto_favorite_state.left ? ` · ${fmt(t.auto_favorite_state.left)} en attente` : ''}.`) : null,
      S.autoTag.targetId === t.id ? errLine(S.autoTag.error) : null,
      S.autoTag.syncTargetId === t.id && !S.refresh.running && (S.refresh.error || S.refresh.warn)
        ? h('p', { class: S.refresh.error ? 'status err' : 'warn', role: 'status' }, S.refresh.msg) : null,
    ]);
  }
  // « Ajouter les membres pas encore amis » : ta liste d'amis du jeu relue (GET /api/friends?fresh=1), les membres qui ne
  // sont ni tes amis ni en attente cochés d'avance, puis les demandes envoyées d'un coup (POST /api/friends/request-all,
  // par paquets de FRIENDS_BULK). fromCheck : ouverte en cochant la case des demandes automatiques.
  const FRIENDS_BULK = 20; // comme le serveur (BULK_MAX)
  async function openFriendsAdd(fromCheck) {
    S.friendsAdd = { st: 'loading', list: [], pick: [], busy: false, error: '', fromCheck: !!fromCheck, canRequest: true };
    S.modal = 'friendsadd';
    const fa = S.friendsAdd; // la version réactive : la fenêtre suit ses changements
    const sess = (S.me && S.me.session) || {};
    if (!sess.linked || sess.lost) { fa.st = 'ready'; return; }
    try {
      const r = await api('GET', '/api/friends?fresh=1');
      fa.list = (r.list || []).map((m) => ({ ...m, result: null, error: '' }));
      fa.canRequest = !!r.can_request;
      fa.error = r.error || '';
      fa.pick = fa.list.filter((m) => m.st === 'none').map((m) => m.id);
      fa.st = 'ready';
    } catch (e) {
      fa.st = 'error';
      fa.error = e.message;
    }
  }
  async function sendFriendsAdd(fa) {
    if (fa.busy || !fa.pick.length) return;
    fa.busy = true;
    fa.error = '';
    try {
      const ids = fa.pick.slice();
      for (let i = 0; i < ids.length; i += FRIENDS_BULK) {
        const r = await api('POST', '/api/friends/request-all', { members: ids.slice(i, i + FRIENDS_BULK) });
        for (const x of r.results || []) {
          const m = fa.list.find((y) => y.id === x.id);
          if (!m) continue;
          if (x.status) { m.st = x.status; m.result = x.status; m.error = ''; } else m.error = x.error || 'Échec.';
        }
        if (r.limited) { fa.error = 'Le jeu limite les actions automatiques : envoie les autres demandes dans le jeu, ou réessaie plus tard.'; break; }
      }
      fa.pick = fa.pick.filter((id) => { const m = fa.list.find((y) => y.id === id); return m && m.st === 'none'; });
      const n = fa.list.filter((m) => m.result === 'sent').length;
      if (n) notify(`${fmt(n)} ${plural(n, "demande d'ami envoyée", "demandes d'ami envoyées")} dans le jeu.`);
    } catch (e) {
      fa.error = e.message;
    } finally {
      fa.busy = false;
    }
  }

  // « Synchro rapide du marché » (PATCH /api/me {fast_sync}, coupée par défaut) : essai d'un rythme plus rapide, à ses risques.
  async function setFastSync(on) {
    if (S.fast.busy) return;
    Object.assign(S.fast, { busy: true, error: '' });
    try {
      const r = await api('PATCH', '/api/me', { fast_sync: on });
      if (S.me) S.me.fast_sync = typeof r.fast_sync === 'boolean' ? r.fast_sync : on;
    } catch (e) {
      S.fast.error = e.message;
    } finally {
      S.fast.busy = false;
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
    if (tab === 'maj') loadSyncLog();
    if (tab === 'amis') loadFriends(true);
    if (tab === 'marche') loadMarket(Date.now() - M.at > 20000); // les cotes ont pu être relues dans le jeu entre-temps
    toTop();
  }
  function resetFilters() {
    Object.assign(S, { q: '', tagFilter: [], gtagFilter: [], untaggedOnly: false, newOnly: false, duplicatesOnly: false, keptOnly: false, rarities: [] });
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
  // « Les voir » (« Bonnes affaires à vendre ») : « Mes cartes » avec seulement les cartes exclues des échanges et ventes.
  function showKept() { resetFilters(); S.keptOnly = true; setTab('cartes'); }
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
  // « ## » devant un nom en fait un intercalaire libre (isLabel) : la section seule, sans carte ni vérification.
  const SEP_LINE = /^#\s*/;
  const SEP_MARK = '# ';
  const LABEL_LINE = /^##\s*/;
  const LABEL_MARK = '## ';
  const LABEL_MAX = 300; // longueur d'un titre pour targets.js
  const itemLine = (i) => (isLabel(i) ? LABEL_MARK : i.sep ? SEP_MARK : '') + i.title;
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
      text: t ? t.items.map(itemLine).join('\n') : '',
      source: t ? t.source || null : null,
      known: markRaw(new Map(t ? t.items.filter((i) => !isLabel(i)).map((i) => [i.title, i]) : [])),
      base: markRaw(t ? t.items.filter((i) => !isLabel(i)).map((i) => i.title) : []), // titres à l'ouverture (exclusions de l'ajout automatique)
      busy: false, progress: '', error: '', issues: null,
      mode: t ? 'liste' : NEW_MODES.some((m) => m[0] === mode) ? mode : NEW_MODES[0][0],
      kw: { q: '', searching: false, error: '', interp: '', cands: [], chosen: null, searched: '' },
      game: { q: '', busy: false, error: '', needsLink: false, cards: null, more: false, searched: '' },
    };
    S.modal = 'editor';
  }
  async function saveEditor(ed, force) {
    if (ed.busy) return;
    ed.error = '';
    const name = ed.name.trim();
    if (!name) { ed.error = 'Donne un nom à ta collection.'; return; }
    const titles = [];
    const lines = []; // dans l'ordre : un titre, ou {label} pour un intercalaire libre (« ## »)
    const seen = new Set();
    const seenLabels = new Set();
    const seps = new Set(); // titres marqués « # » (intercalaires), sur au moins une de leurs lignes
    const bad = [];
    ed.text.split('\n').forEach((line, i) => {
      const trimmed = line.trim();
      if (LABEL_LINE.test(trimmed)) {
        const label = trimmed.replace(LABEL_LINE, '').replace(/\s+/g, ' ').trim();
        if (!label) return;
        if (label.length > LABEL_MAX) { bad.push(`ligne ${i + 1} : intercalaire trop long (${LABEL_MAX} caractères au plus)`); return; }
        if (!seenLabels.has(label)) { seenLabels.add(label); lines.push({ label }); }
        return;
      }
      const r = parseLine(line);
      if (r == null) return;
      if (typeof r === 'object') { bad.push(`ligne ${i + 1} : ${r.error}`); return; }
      if (SEP_LINE.test(trimmed)) seps.add(r);
      if (!seen.has(r)) { seen.add(r); titles.push(r); lines.push(r); }
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
      for (const t of lines) {
        if (typeof t === 'object') { items.push({ title: t.label, description: null, image: null, status: 'label', sep: true }); continue; }
        const it = ed.known.get(t);
        if (!it) continue;
        if (it.title !== t) redirected++;
        // Deux lignes qui mènent au même article (redirection) : un seul élément, intercalaire si l'une des deux l'est.
        if (kept.has(it.title)) { if (seps.has(t)) kept.get(it.title).sep = true; continue; }
        const item = { title: it.title, description: it.description || null, image: it.image || null, status: it.status || 'ok' };
        if (it.qid) item.qid = it.qid;
        if (realRarity(it)) item.rarity = it.rarity; // rareté du jeu (collection créée depuis le jeu) : gardée
        if (seps.has(t)) item.sep = true;
        else if (it.sep === true || it.sep === false) item.sep = false; // « # » retiré (ou déjà décoché) : choix gardé
        kept.set(it.title, item);
        items.push(item);
      }
      const issues = items.filter((i) => i.status !== 'ok' && !isLabel(i));
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
        const cardsNow = items.filter((i) => !isLabel(i));
        const now = new Set(cardsNow.map((i) => titleKey(i.title)));
        const before = new Set(ed.base.map(titleKey));
        const skipped = new Set(cur.skip.map(titleKey));
        const add = ed.base.filter((x) => !now.has(titleKey(x)));
        const del = cardsNow.filter((i) => !before.has(titleKey(i.title)) && skipped.has(titleKey(i.title))).map((i) => i.title);
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
  const orderKey = (it) => (isLabel(it) ? '\u0000' : '') + normTitle(it.title); // un intercalaire libre n'est jamais une carte
  function alignOrder(list, items) {
    const pool = new Map();
    items.forEach((it, i) => { const k = orderKey(it); if (pool.has(k)) pool.get(k).push(i); else pool.set(k, [i]); });
    const out = [];
    for (const it of list) { const q = pool.get(orderKey(it)); if (q && q.length) out.push(q.shift()); }
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
      busy: false, error: '', said: '', saidN: 0, away: false, labels: false, label: '', rename: '', sort: 'rarity' };
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
    r.dirty = reorderDirty(r);
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
  // Brouillon différent de la collection rangée : ordre changé, ou intercalaire libre ajouté, renommé ou retiré
  // (r.labels : le brouillon a alors ses propres éléments, base n'est plus t.items).
  function reorderDirty(r) {
    if (!r.labels) return !isIdentity(r.order);
    const t = targets.value.find((x) => x.id === r.id);
    return !t || !sameIds(r.order.map((k) => r.base[k]), t.items);
  }
  // Intercalaires libres du mode réorganisation (2026-10-28) : « Ajouter un intercalaire » (champ en tête) le met avant
  // l'élément choisi (en tête sans choix) ; choisi, il se renomme ou se retire dans la barre du bas. Comme un
  // déplacement, rien n'est envoyé avant « Enregistrer l'ordre ».
  const labelName = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  function addLabel() {
    const r = S.reorder;
    if (!r || r.busy) return;
    const name = labelName(r.label);
    if (!name || name.length > LABEL_MAX) { r.error = `Nom de l'intercalaire : 1 à ${fmt(LABEL_MAX)} caractères.`; sayReorder(r, r.error); return; }
    const k = r.base.length;
    const at = r.active != null && r.order.includes(r.active) ? r.order.indexOf(r.active) : 0;
    const next = r.order.slice();
    next.splice(at, 0, k);
    Object.assign(r, { base: markRaw([...r.base, { title: name, description: null, image: null, status: 'label', sep: true }]), order: markRaw(next),
      labels: true, label: '', rename: '', active: k, pos: '', error: '' });
    r.dirty = reorderDirty(r);
    sayReorder(r, `Intercalaire « ${name} » ajouté en position ${fmt(at + 1)} sur ${fmt(next.length)}.`);
    showTile(k);
  }
  function renameLabel(k) {
    const r = S.reorder;
    if (!r || r.busy || !isLabel(r.base[k])) return;
    const name = labelName(r.rename);
    if (!name || name.length > LABEL_MAX) { r.error = `Nom de l'intercalaire : 1 à ${fmt(LABEL_MAX)} caractères.`; sayReorder(r, r.error); return; }
    const old = r.base[k].title;
    if (name === old) { r.rename = ''; return; }
    const base = r.base.slice();
    base[k] = { ...base[k], title: name };
    Object.assign(r, { base: markRaw(base), labels: true, rename: '', error: '' });
    r.dirty = reorderDirty(r);
    sayReorder(r, `Intercalaire « ${old} » renommé « ${name} ».`);
  }
  function removeLabel(k) {
    const r = S.reorder;
    if (!r || r.busy || !isLabel(r.base[k])) return;
    Object.assign(r, { order: markRaw(r.order.filter((x) => x !== k)), labels: true, active: null, pos: '', rename: '', error: '' });
    r.dirty = reorderDirty(r);
    sayReorder(r, `Intercalaire « ${r.base[k].title} » retiré.`);
  }
  // « Trier la section » (2026-10-28, demande de l'utilisateur : « trier d'un coup toutes les cartes d'un intercalaire
  // selon un ordre défini, par exemple par rareté ») : intercalaire choisi, les éléments qui le suivent jusqu'au prochain
  // intercalaire sont rangés d'un coup ; l'intercalaire reste en tête. Tri stable (à égalité, l'ordre d'avant : trier
  // de A à Z puis par rareté range chaque rareté de A à Z). Rareté d'une case vide : celle du jeu, sinon l'estimée
  // d'après les vues ; inconnue : à la fin. Comme un déplacement, rien n'est envoyé avant « Enregistrer l'ordre ».
  const SECTION_SORTS = [
    ['rarity', 'Rareté (L → C)'],
    ['rarity-up', 'Rareté (C → L)'],
    ['az', 'A → Z'],
    ['za', 'Z → A'],
    ['owned', 'Possédées d\'abord'],
  ];
  function sortSection(k) {
    const r = S.reorder;
    if (!r || r.busy || !r.base[k] || !r.base[k].sep) return;
    const at = r.order.indexOf(k);
    if (at < 0) return;
    let end = at + 1;
    while (end < r.order.length && !r.base[r.order[end]].sep) end++;
    const part = r.order.slice(at + 1, end);
    const title = r.base[k].title;
    if (part.length < 2) { sayReorder(r, `La section « ${title} » a moins de deux cartes : rien à trier.`); return; }
    const info = reorderInfo.value;
    const rank = (x) => {
      const s = info[x];
      if (s && s.card) return RANK[s.card.rarity] ?? 9;
      const it = r.base[x];
      const pv = pvCache.get(it.title);
      return RANK[realRarity(it) || estRarity(pv ? pv[0] : null)] ?? 9;
    };
    const name = (x) => r.base[x].title;
    const how = r.sort;
    const cmp = how === 'rarity' ? (a, b) => rank(a) - rank(b)
      : how === 'rarity-up' ? (a, b) => (rank(a) === 9) - (rank(b) === 9) || rank(b) - rank(a)
        : how === 'az' ? (a, b) => COLLATOR.compare(name(a), name(b))
          : how === 'za' ? (a, b) => COLLATOR.compare(name(b), name(a))
            : (a, b) => (info[a] && info[a].card ? 0 : 1) - (info[b] && info[b].card ? 0 : 1);
    const sorted = part.map((x, i) => [x, i]).sort((a, b) => cmp(a[0], b[0]) || a[1] - b[1]).map(([x]) => x);
    const label = (SECTION_SORTS.find(([v]) => v === how) || SECTION_SORTS[0])[1];
    if (sorted.every((x, i) => x === part[i])) { sayReorder(r, `La section « ${title} » est déjà triée : ${label}.`); return; }
    const next = r.order.slice();
    next.splice(at + 1, part.length, ...sorted);
    r.order = markRaw(next);
    r.error = '';
    r.dirty = reorderDirty(r);
    sayReorder(r, `Section « ${title} » triée : ${label} (${cards$(part.length)}).`);
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
  // Intercalaires libres changés dans le brouillon (r.labels) : ce sont les siens qui restent.
  function rebaseReorder(r, t) {
    roDragEnd();
    const draft = r.order.map((k) => r.base[k]);
    const items = r.labels ? t.items.filter((it) => !isLabel(it)).concat(draft.filter(isLabel)) : t.items;
    const next = alignOrder(draft, items);
    Object.assign(r, { base: markRaw(items), order: markRaw(next), active: null, drag: null, name: t.name });
    r.dirty = reorderDirty(r);
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
    // Intercalaires libres : ceux d'avant (un ajout, un renommage ou un retrait est aussi annulé).
    const items = t.items.filter((it) => !isLabel(it)).concat(before.filter(isLabel));
    try {
      await saveItemsOf(t, alignOrder(before, items).map((i) => items[i]));
      if (gen === cardsGen) notify(`Ordre d'avant remis dans « ${t.name} ».`);
    } catch (e) {
      if (gen === cardsGen) notify(e.message, true);
    }
  }
  // ---------------------------------------------------------------- « Réorganiser » (« Mes collections »)
  // Demande de l'utilisateur (2026-10-24) : « pouvoir réorganiser les collections ». « Réorganiser » (en tête de « Mes
  // collections », à partir de 2 collections) passe la liste en mode réorganisation : une ligne compacte par collection,
  // à glisser (à la souris toute la ligne, au doigt par sa poignée), « ↑ » / « ↓ », « En tête » / « À la fin ».
  // Brouillon (S.colOrder) : {base (les ids dans l'ordre à l'entrée), order (l'ordre en cours), dirty, busy, error, drag
  // (id glissé), said et saidN (annonce pour les lecteurs d'écran)}. Une collection créée ou supprimée pendant ce temps :
  // l'ordre affiché (colOrderIds) retire les disparues et ajoute les nouvelles à la fin. « Enregistrer l'ordre » : une
  // seule requête POST /api/targets/order {ids}, puis « Annuler » pendant 10 s (l'ordre d'avant renvoyé) ; « Annuler »
  // du mode n'envoie rien. Le brouillon survit à un changement d'onglet ; recharger avec un ordre modifié le demande.
  function colOrderIds(r) {
    const have = new Set(targets.value.map((t) => t.id));
    const out = r.order.filter((id) => have.has(id));
    const seen = new Set(out);
    for (const t of targets.value) if (!seen.has(t.id)) out.push(t.id);
    return out;
  }
  const sameIds = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  function startColOrder() {
    const ids = targets.value.map((t) => t.id);
    S.colOrder = { base: ids, order: ids, dirty: false, busy: false, error: '', drag: null, said: '', saidN: 0 };
    nextTick(() => { const el = document.getElementById('h-mine'); if (el) el.focus(); });
  }
  const colName = (id) => { const t = targets.value.find((x) => x.id === id); return t ? t.name : ''; };
  // Déplace la collection `id` à la place `to` (0 = en tête), bornée ; false si elle n'a pas bougé.
  function colMoveTo(id, to) {
    const r = S.colOrder;
    if (!r || r.busy) return false;
    const list = colOrderIds(r);
    const from = list.indexOf(id);
    if (from < 0) return false;
    const n = list.length;
    const dest = Math.max(0, Math.min(n - 1, to));
    const name = colName(id);
    r.error = '';
    if (dest === from) {
      r.said = from === 0 && to <= 0 ? `« ${name} » est déjà en tête.` : `« ${name} » est déjà à la fin.`;
      r.saidN++;
      return false;
    }
    list.splice(from, 1);
    list.splice(dest, 0, id);
    r.order = list;
    r.dirty = !sameIds(list, targets.value.map((t) => t.id));
    r.said = `« ${name} » : position ${fmt(dest + 1)} sur ${fmt(n)}.`;
    r.saidN++;
    return true;
  }
  // « ↑ », « ↓ », « En tête », « À la fin » d'une ligne : le focus reste sur le même bouton de la collection déplacée.
  function colMove(id, act) {
    const r = S.colOrder;
    if (!r) return;
    const list = colOrderIds(r);
    const at = list.indexOf(id);
    colMoveTo(id, act === 'up' ? at - 1 : act === 'down' ? at + 1 : act === 'first' ? 0 : list.length - 1);
    nextTick(() => {
      const li = document.querySelector(`li.co-row[data-id="${id}"]`);
      const b = li && li.querySelector(`button[data-act="${act}"]`);
      if (b && document.activeElement !== b) b.focus();
    });
  }
  function focusColOrderButton() {
    nextTick(() => { const b = document.getElementById('colorder-btn'); if (b) b.focus(); });
  }
  function cancelColOrder() {
    const r = S.colOrder;
    if (!r || r.busy) return;
    coDragEnd();
    S.colOrder = null;
    focusColOrderButton();
    if (r.dirty) notify("Ordre des collections laissé tel quel : rien n'a été envoyé.", false, { label: 'Reprendre', run: () => { if (S.colOrder) return; S.colOrder = r; setTab('collections'); if (S.album) closeAlbum(); } });
  }
  // Range targets dans l'ordre `ids` (les autres après, dans leur ordre).
  function applyColOrder(ids) {
    const pos = new Map(ids.map((id, i) => [id, i]));
    const n = ids.length;
    targets.value = targets.value.map((t, i) => [t, pos.has(t.id) ? pos.get(t.id) : n + i]).sort((a, b) => a[1] - b[1]).map(([t]) => t);
  }
  async function saveColOrder() {
    const r = S.colOrder;
    if (!r || r.busy) return;
    coDragEnd();
    const before = targets.value.map((t) => t.id);
    const ids = colOrderIds(r);
    if (sameIds(ids, before)) { S.colOrder = null; focusColOrderButton(); notify('Ordre inchangé : rien à enregistrer.'); return; }
    const gen = cardsGen;
    r.busy = true;
    r.error = '';
    try {
      await api('POST', '/api/targets/order', { ids });
      if (gen !== cardsGen) return;
      applyColOrder(ids);
      if (S.colOrder === r) { S.colOrder = null; focusColOrderButton(); }
      notify('Nouvel ordre des collections enregistré.', false, { label: 'Annuler', run: () => restoreColOrder(before) });
    } catch (e) {
      if (gen === cardsGen) r.error = e.message;
    } finally {
      r.busy = false;
    }
  }
  async function restoreColOrder(before) {
    const gen = cardsGen;
    const have = new Set(targets.value.map((t) => t.id));
    const ids = before.filter((id) => have.has(id));
    for (const t of targets.value) if (!ids.includes(t.id)) ids.push(t.id);
    try {
      await api('POST', '/api/targets/order', { ids });
      if (gen !== cardsGen) return;
      applyColOrder(ids);
      notify("Ordre d'avant des collections remis.");
    } catch (e) {
      if (gen === cardsGen) notify(e.message, true);
    }
  }
  // Glisser une ligne (pointer events) : repère d'insertion entre deux lignes, lâché au-dessus ou au-dessous de la
  // moitié d'une ligne ; Échap annule le geste ; la page défile seule près des bords de la fenêtre.
  let coDrag = null;
  function coPointerDown(e) {
    const r = S.colOrder;
    if (!r || r.busy || coDrag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const list = e.currentTarget;
    const li = upTo(e.target, list, (n) => n.classList && n.classList.contains('co-row'));
    if (!li || upTo(e.target, li, (n) => n.tagName === 'BUTTON')) return;
    const grip = !!upTo(e.target, li, (n) => n.classList && n.classList.contains('co-grip'));
    if (e.pointerType !== 'mouse' && !grip) return;
    coDrag = { id: li.getAttribute('data-id'), pid: e.pointerId, type: e.pointerType, y0: e.clientY, y: e.clientY, on: false, list, target: null, raf: 0 };
    if (e.pointerType === 'mouse') e.preventDefault();
    window.addEventListener('pointermove', coPointerMove);
    window.addEventListener('pointerup', coPointerUp);
    window.addEventListener('pointercancel', coPointerCancel);
    window.addEventListener('keydown', coDragKey, true);
  }
  function coPointerMove(e) {
    const d = coDrag;
    if (!d || e.pointerId !== d.pid) return;
    d.y = e.clientY;
    if (!d.on) {
      if (Math.abs(d.y - d.y0) < (d.type === 'mouse' ? 6 : 3)) return;
      if (!S.colOrder) { coDragEnd(); return; }
      d.on = true;
      S.colOrder.drag = d.id;
      try { if (d.list.setPointerCapture) d.list.setPointerCapture(d.pid); } catch (err) { /* pointeur déjà relâché */ }
      document.documentElement.classList.add('ro-dragging');
    }
    if (e.cancelable !== false && typeof e.preventDefault === 'function') e.preventDefault();
    if (!d.raf) d.raf = requestAnimationFrame(coStep);
  }
  function coStep() {
    const d = coDrag;
    if (!d) return;
    d.raf = 0;
    d.target = coTargetAt(d);
    const wrap = d.list.parentNode;
    const mark = wrap && wrap.querySelector('.co-mark');
    if (mark) {
      if (d.target == null) mark.classList.remove('on');
      else {
        const rows = [...d.list.querySelectorAll('li.co-row')];
        const wr = wrap.getBoundingClientRect();
        const ref = rows[Math.min(d.target.at, rows.length - 1)];
        const rc = ref.getBoundingClientRect();
        const y = d.target.at >= rows.length ? rc.bottom + 4 : rc.top - 4;
        mark.style.setProperty('--my', Math.round(y - wr.top) + 'px');
        mark.classList.add('on');
      }
    }
    const vh = window.innerHeight || 0;
    if (!vh || typeof window.scrollBy !== 'function') return;
    const edge = 70;
    const dy = d.y < edge ? -(edge - d.y) : d.y > vh - edge ? d.y - (vh - edge) : 0;
    if (dy) { window.scrollBy(0, Math.max(-28, Math.min(28, Math.round(dy / 3)))); d.raf = requestAnimationFrame(coStep); }
  }
  // Place d'insertion sous le pointeur : `at` = indice de la ligne devant laquelle lâcher (le nombre de lignes : à la fin),
  // `to` = place finale de la collection glissée ; null si elle ne bougerait pas.
  function coTargetAt(d) {
    const rows = [...d.list.querySelectorAll('li.co-row')];
    if (!rows.length || typeof rows[0].getBoundingClientRect !== 'function') return null;
    let at = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const rc = rows[i].getBoundingClientRect();
      if (d.y < rc.top + rc.height / 2) { at = i; break; }
    }
    const from = rows.findIndex((li) => li.getAttribute('data-id') === d.id);
    const to = from >= 0 && from < at ? at - 1 : at;
    return from < 0 || to === from ? null : { at, to };
  }
  function coPointerUp(e) {
    const d = coDrag;
    if (!d || e.pointerId !== d.pid) return;
    if (!d.on) { coDragEnd(); return; }
    d.y = e.clientY;
    const t = coTargetAt(d);
    coDragEnd();
    if (t) colMoveTo(d.id, t.to);
    else if (S.colOrder) { S.colOrder.said = `« ${colName(d.id)} » reste à sa place.`; S.colOrder.saidN++; }
  }
  function coPointerCancel(e) { if (coDrag && e.pointerId === coDrag.pid) coDragEnd(); }
  function coDragKey(e) {
    if (e.key !== 'Escape' || !coDrag) return;
    e.preventDefault();
    e.stopPropagation();
    const on = coDrag.on;
    coDragEnd();
    if (on && S.colOrder) { S.colOrder.said = 'Déplacement annulé.'; S.colOrder.saidN++; }
  }
  function coDragEnd() {
    const d = coDrag;
    coDrag = null;
    window.removeEventListener('pointermove', coPointerMove);
    window.removeEventListener('pointerup', coPointerUp);
    window.removeEventListener('pointercancel', coPointerCancel);
    window.removeEventListener('keydown', coDragKey, true);
    if (!d) return;
    if (d.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(d.raf);
    const wrap = d.list.parentNode;
    const mark = wrap && wrap.querySelector('.co-mark');
    if (mark) mark.classList.remove('on');
    document.documentElement.classList.remove('ro-dragging');
    try { if (d.on && d.list.releasePointerCapture) d.list.releasePointerCapture(d.pid); } catch (err) { /* déjà relâché */ }
    if (S.colOrder) S.colOrder.drag = null;
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
    // Un intercalaire libre ne se confond qu'avec un intercalaire libre du même nom (jamais avec une carte).
    const qidOf = (it) => (isLabel(it) ? null : it.qid || (resolver ? resolver.known(it.title) || null : null));
    const keyOf = (it) => (isLabel(it) ? '\u0000' : '') + titleKey(it.title);
    const items = base.slice();
    const byTitle = new Map();
    const byQid = new Map();
    const remember = (it, i) => {
      const k = keyOf(it);
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
      const k = keyOf(it);
      const q = qidOf(it);
      const j = byTitle.has(k) ? byTitle.get(k) : q && byQid.has(q) ? byQid.get(q) : -1;
      if (j >= 0) {
        present++;
        const add = isLabel(it) ? {} : mergeGain(items[j], it, keyOf(items[j]) === k);
        if (Object.keys(add).length) {
          items[j] = { ...items[j], ...add };
          if (j < base.length) gains.set(j, new Set([...(gains.get(j) || []), ...Object.keys(add)]));
        }
        if (it.sep === true && opts.sections && !isLabel(it)) carry = true;
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
  // wiki-masters.com (gtags, lus avec la collection depuis le 18 octobre 2026). Proposés d'abord, parmi ceux de tes cartes :
  // ceux dont le nom ressemble à celui de la collection (mots repliés : accents, casse, articles, pluriel et féminin
  // ignorés) — même nom (« Maladies » ↔ « Maladie », coché d'emblée), plus précis (« Maladies tropicales ») ou plus large
  // (« Maladie » pour « Maladies rares ») —, puis ceux que portent beaucoup de tes cartes déjà dans la collection (2 au
  // moins, et 20 % d'entre elles), et ceux choisis à la main. Puis, pareil, les **catégories du jeu** (card.category : le
  // texte que le jeu montre sous le titre, « maladie », « chanteuse barbadienne ») ; « portées par beaucoup de ses
  // éléments » compte la catégorie de ta carte, sinon la description de l'élément (celle du jeu pour une collection faite
  // depuis le jeu, celle de Wikidata sinon, le même texte en général : 2 au moins, et 20 % des éléments qui en ont une). Tes tags
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
      if (isLabel(it)) continue;
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
    const titles = new Set(t.items.filter((it) => !isLabel(it)).map((it) => titleKey(it.title)));
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
  // targets, jamais montrée aux amis). À chaque arrivée de cartes dans la page (ouverture du classeur, lecture de la collection,
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
  const autoOf = (t) => (t && !(t.auto_tag && t.auto_tag.enabled) && t.auto && t.auto.rules.length ? t.auto : null);
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
      if (isLabel(it)) continue;
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

  // ---------------------------------------------------------------- fenêtres, réglages
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
    if (m === 'trade') S.tradeNew = null;
    if (m === 'friendsadd') S.friendsAdd = null;
    if (m === 'sell') S.sell = null;
    if (m === 'bid') S.bid = null;
    if (m === 'art') S.artPick = null;
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
      text: "Ce navigateur oubliera la clé de ton classeur, les autres classeurs ouverts ici et les données gardées de Wikipédia. Ton classeur reste intact, avec ton compte du jeu relié : ton lien personnel le rouvre (vérifie que tu l'as bien gardé).",
      ok: 'Oublier ce navigateur',
      run: async () => { forgetKey(); },
    });
  }
  function askDeleteAccount() {
    openConfirm({
      title: 'Supprimer ton classeur ?',
      text: "Tes cartes rangées, tes tags, tes collections à compléter et la session du jeu reliée seront effacés du classeur, tes messages du chat aussi (pour tout le monde), et ton lien ne marchera plus. C'est définitif. Ta collection dans le jeu n'est pas touchée.",
      ok: 'Supprimer mon classeur',
      danger: true,
      run: async () => {
        const key = S.key;
        const user = S.me && S.me.user && S.me.user.id;
        await api('DELETE', '/api/me');
        forgetKnown(key);
        const others = S.known.slice();
        forgetKey(user || undefined);
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
  // Onglet « Synchro » (id « maj ») : état du compte du jeu relié, liaison, « Rafraîchir », journal.
  function openSyncTab() {
    if (S.modal) closeModal();
    S.openId = null;
    S.openMissing = null;
    if (S.tab === 'maj') loadSyncLog(); else setTab('maj');
    toTop();
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

  // ---------------------------------------------------------------- illustrations (art.js) : deux cases des Réglages
  // prefs.art_en : image de l'article anglais quand elle est meilleure (personnage dessiné, affiche, pochette, logo) ;
  // prefs.art_cover : couverture dessinée (nature de l'article, drapeau) pour une carte sans image. Décochées par défaut :
  // l'affichage reste alors exactement celui d'avant (aucune requête vers Wikipédia en anglais).
  const Art = window.ClasseurArt || null;
  const enQ = makeQueue(300);
  const art = Art ? Art.createArt({ get: (url) => getJson(/^https:\/\/en\./.test(url) ? enQ : wikiQ, url, 0), onChange: () => { S.artV++; } }) : null;
  const artEn = () => !!(art && S.prefs.art_en);
  const artCover = () => !!(Art && S.prefs.art_cover);
  // Image à montrer pour un article (titre français) qui a déjà img (ou null) : celle choisie à la main d'abord.
  function artOf(title, img) {
    return (title && S.artPicks[title]) || artDefault(title, img);
  }
  // Sans choix à la main : l'image donnée, ou l'anglaise (case des Réglages).
  function artDefault(title, img) {
    if (!artEn()) return img || null;
    void S.artV; // relu quand un lot arrive
    return art.image(title, img);
  }

  // ---------------------------------------------------------------- « Changer l'illustration » (fiches)
  // Images principales de l'article dans plusieurs langues de Wikipédia (art.js, candidates) ; le choix est gardé par le
  // serveur (POST /api/art/set), pour toutes les cartes et cases vides de cet article, sur tous tes appareils.
  const langQ = makeQueue(60); // autres langues que le français : une requête par langue, l'une après l'autre
  async function loadArtPicks() {
    try {
      const r = await api('GET', '/api/art');
      S.artPicks = r && r.picks && typeof r.picks === 'object' ? r.picks : {};
    } catch (e) { /* illustrations par défaut : rien d'autre ne change */ }
  }
  async function openArtPick(title, base, desc) {
    if (!Art) return;
    const ap = reactive({ title, base: base || null, desc: desc || '', st: 'loading', list: [], sel: S.artPicks[title] || '', busy: false, error: '' });
    S.artPick = ap;
    S.modal = 'art';
    try {
      const r = await Art.candidates(title, (url) => getJson(/^https:\/\/fr\./.test(url) ? wikiQ : langQ, url, 1));
      if (S.artPick !== ap) return;
      ap.list = markRaw(r.list);
      ap.st = r.missing ? 'missing' : 'ready';
    } catch (e) {
      if (S.artPick !== ap) return;
      ap.st = 'error';
      ap.error = e.message;
    }
  }
  async function saveArtPick(ap) {
    if (ap.busy) return;
    ap.busy = true;
    ap.error = '';
    try {
      const r = await api('POST', '/api/art/set', { title: ap.title, url: ap.sel || null });
      const next = { ...S.artPicks };
      if (r.url) next[ap.title] = r.url; else delete next[ap.title];
      S.artPicks = next;
      if (S.artPick === ap) closeModal();
      notify(r.url ? 'Illustration changée.' : 'Illustration par défaut rétablie.');
    } catch (e) {
      ap.error = e.message;
    } finally {
      ap.busy = false;
    }
  }
  const artPickButton = (title, base, desc) => (Art ? h('button', { class: 'btn small', type: 'button', onClick: () => openArtPick(title, base, desc) },
    [icon('pen', 'sm'), S.artPicks[title] ? "Changer l'illustration (choisie)" : "Changer l'illustration"]) : null);

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
    Object.assign(S.friends, { status: 'idle', busy: false, error: '', loading: '', open: null, q: '', filter: 'all', limit: PAGE, more: {}, page: null, trade: 'all',
      album: null, albumFilter: 'all', albumSort: 'order', albumLimit: ALBUM_PAGE, albumFrom: null, copies: {} });
  }
  // Carte d'un ami (champs montrés par le serveur, rien d'autre) ; adresses vérifiées avant d'en faire des liens.
  function prepFriendCard(c) {
    const title = String(c.title || '');
    const link = (v) => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : null);
    // v : les cotes de la carte (cache commun des ventes du jeu), {"R": {p, n, w, l, d}}, ou null.
    const v = c.v && typeof c.v === 'object' && !Array.isArray(c.v) ? c.v : null;
    return markRaw({ id: String(c.id), title, rarity: RARITY_NAME[c.rarity] ? c.rarity : null, count: Math.max(1, Number(c.count) || 1),
      fav: Math.max(0, Number(c.fav) || 0), shiny: c.shiny === true, image: link(c.image), url: link(c.url), v, _k: fold(title) });
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
        if (it.label === true) return { title: it.title, status: 'label', sep: true }; // intercalaire libre
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
  // Solde de wikibidous lu à la dernière synchro ({n, at} de /api/me et /api/members), ou null.
  const wbOf = (x) => (x && Number.isFinite(Number(x.n)) ? { n: Number(x.n), at: typeof x.at === 'string' ? x.at : null } : null);
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
          return markRaw({ id: m.id, name: typeof m.name === 'string' ? m.name : '', pseudo: typeof m.pseudo === 'string' && m.pseudo ? m.pseudo : null, game: m.game !== false, cstyle: typeof m.card_style === 'string' ? m.card_style : null, count, fetched_at: m.fetched_at || null, cards: same ? p.cards : null,
            tshare: !!tg, tcount: tg ? Number(tg.count) || 0 : 0, tmark, targets: sameT ? p.targets : null, wb: wbOf(m.wikibidous),
            // ses cartes exclues des échanges (ids), relues avec la liste : jamais proposées dans « Échanges possibles »
            keep: Array.isArray(m.keep) && m.keep.length ? new Set(m.keep.map(String)) : null });
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
          if (it.qid || isLabel(it)) continue;
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
      if (S.me) { S.me.shared = now; S.me.shared_targets = !!(now && r && r.shared_targets === true); S.me.public_id = now && r && typeof r.public_id === 'string' ? r.public_id : null; }
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
  // Filtre (« Tout le monde » ou « Ce qui me concerne ») et case « Seulement les cartes en double » d'« Échanges
  // possibles » retenus avec le compte (prefs.trade_filter, prefs.trade_dup ; 2026-10-28, demande de l'utilisateur : la
  // page s'ouvre comme on l'a laissée, sur tous ses appareils). Un membre choisi dans « Un membre… » ne l'est pas.
  const tradePref = () => (S.prefs.trade_filter === 'me' ? 'me' : 'all');
  const tradeDupOn = () => S.prefs.trade_dup !== false;
  function setTradeFilter(v) {
    S.friends.trade = v;
    if ((v === 'all' || v === 'me') && v !== tradePref()) savePrefs({ trade_filter: v });
  }
  // « Échanges possibles » : sous-page de l'onglet, avec son filtre (le dernier choisi, tout le monde par défaut).
  function openTrades(filter) {
    Object.assign(S.friends, { page: 'trades', open: null, album: null, trade: filter || tradePref() });
    toTop();
  }
  function closeTrades() { S.friends.page = null; toTop(); }
  // « Proposer un échange » avec un ami : ses cartes qui complètent tes collections et les tiennes qui complètent les
  // siennes (les couples toi → lui et lui → toi des échanges possibles, tous, doubles compris), doubles cochés d'avance.
  const TRADE_MAX = 40; // cartes d'un échange, des deux côtés (comme le serveur)
  function tradeRowsWith(f) {
    const pairs = trades.value.pairs;
    const give = (pairs.find((p) => p.x.me && p.z.id === f.id) || { rows: [] }).rows;
    const get = (pairs.find((p) => p.z.me && p.x.id === f.id) || { rows: [] }).rows;
    return { give, get };
  }
  function openTradeNew(f) {
    const { give, get } = tradeRowsWith(f);
    const pick = (rows) => rows.filter((r) => r.dup && !favLocked(r.card)).map((r) => r.card.id);
    S.tradeNew = { f, give: pick(give), get: pick(get), giveWb: '', getWb: '', busy: false, error: '', done: null,
      fr: { st: 'loading', canRequest: false, busy: false, error: '' } };
    S.modal = 'trade';
    loadTradeFriend(S.tradeNew);
  }
  // Le jeu n'accepte un échange qu'entre amis : à l'ouverture de la fenêtre, l'amitié avec l'ami dans le jeu (GET
  // /api/friends?fresh=1). st : friends | sent | received | none | unknown (illisible, ou rien pour le désigner : la
  // fenêtre reste comme avant, le jeu tranche).
  async function loadTradeFriend(tn) {
    const fr = tn.fr;
    const sess = (S.me && S.me.session) || {};
    if (!sess.linked || sess.lost) { fr.st = 'unknown'; return; }
    try {
      const r = await api('GET', '/api/friends?fresh=1');
      fr.st = (r.members && r.members[tn.f.id]) || 'unknown';
      fr.canRequest = !!r.can_request;
      fr.readError = r.error || '';
    } catch (e) {
      fr.st = 'unknown';
    }
  }
  // « Envoyer une demande d'ami » (POST /api/friends/request) : la demande part dans le jeu, à ton nom.
  async function sendFriendRequest(tn) {
    const fr = tn.fr;
    if (fr.busy) return;
    fr.busy = true;
    fr.error = '';
    try {
      const r = await api('POST', '/api/friends/request', { member: tn.f.id });
      fr.st = r.status || 'sent';
      if (fr.st === 'sent') notify(`Demande d'ami envoyée à ${friendName(tn.f)} dans le jeu.`);
    } catch (e) {
      fr.error = e.message;
    } finally {
      fr.busy = false;
    }
  }
  function toggleTradeCard(tn, side, id) {
    const list = tn[side];
    tn[side] = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    tn.error = '';
  }
  // Wikibidous tapés d'un côté de l'échange : entier de 0 ou plus (vide : 0), sinon null (montant invalide).
  const TRADE_WB_MAX = 100000000; // comme le serveur
  function tradeWb(text) {
    const t = String(text ?? '').trim();
    if (!t) return 0;
    const n = /^\d+$/.test(t) ? Number(t) : NaN;
    return Number.isSafeInteger(n) && n <= TRADE_WB_MAX ? n : null;
  }
  async function sendTrade(tn) {
    if (tn.busy) return;
    tn.busy = true;
    tn.error = '';
    try {
      const r = await api('POST', '/api/trades/create', { member: tn.f.id, give: tn.give, get: tn.get, give_wb: tradeWb(tn.giveWb) || 0, get_wb: tradeWb(tn.getWb) || 0 });
      tn.done = { given: r.given || [], received: r.received || [], givenWb: Number(r.given_wb) || 0, receivedWb: Number(r.received_wb) || 0,
        url: r.url || 'https://www.wiki-masters.com/trades' };
    } catch (e) {
      tn.error = e.message;
    } finally {
      tn.busy = false;
    }
  }
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
        if (isLabel(it)) return { title: it.title, description: null, image: null, status: 'label', sep: true };
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
  // Les cotes et le marché sont lus par le serveur dans la base du jeu, avec la session reliée (toutes les 20 min, et à
  // « Actualiser le marché » : POST /api/market/refresh) ; ici, on montre ce que le serveur a rangé : la valeur du
  // classeur et son historique (GET /api/market), la dernière lecture du marché (bonnes affaires, tes enchères et tes
  // ventes, 7 jours au plus, avec son âge), le dernier essai (attempt : réussi, ou raté et pourquoi), et les cotes de
  // tes cartes et des cartes qui te manquent (GET /api/market/prices, communes à tous les classeurs). Relu à l'ouverture,
  // après chaque changement des cartes, à l'ouverture de l'onglet « Marché » (une fois par minute au plus, sauf demande),
  // et quand GET /api/me (relu chaque minute, checkRemote) annonce une nouvelle lecture (market_at).
  const M = reactive({ loaded: false, busy: false, error: '', value: null, history: [], live: null, liveAt: null, attempt: null, scan: null, at: 0, hover: -1, refreshing: false, scanning: false, msg: '', msgErr: false });
  const prices = shallowRef(new Map()); // card_id -> {id, v: {"R": {p, n, w, l, d}, "R*": …}, at}
  const wantedPrices = shallowRef(new Map()); // titre (normTitle) d'une carte qui te manque -> la même chose
  let marketJob = null;
  let marketSeen = ''; // market_at de GET /api/me déjà pris en compte par la dernière lecture de l'onglet
  const VARIANT_RE = /^(C|PC|R|SR|UR|L)\*?$/;
  function resetMarket() {
    Object.assign(M, { loaded: false, busy: false, error: '', value: null, history: [], live: null, liveAt: null, attempt: null, at: 0, hover: -1, refreshing: false, msg: '', msgErr: false });
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
        const scan = m.scan && typeof m.scan === 'object' ? m.scan : null;
        Object.assign(M, { value: m.value || null, history: Array.isArray(m.history) ? m.history : [], live, liveAt: m.live_at || null, attempt, scan, loaded: true, error: '' });
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
  // « Actualiser le marché » : le serveur fait une passe légère de lecture du marché avec la session reliée (une par minute au
  // plus), puis l'onglet est relu.
  async function refreshMarket() {
    if (M.refreshing) return;
    const sess = (S.me && S.me.session) || {};
    if (!sess.linked) { openSyncTab(); return; }
    const gen = cardsGen;
    Object.assign(M, { refreshing: true, msg: 'Lecture du marché sur WikiMasters…', msgErr: false });
    try {
      const r = await api('POST', '/api/market/refresh', {});
      if (gen !== cardsGen) return;
      const read = Number(r.read) || 0;
      const left = Number(r.left) || 0;
      const deals = Number(r.deals) || 0;
      const running = Number(r.running) || 0;
      M.msg = r.light
        ? `Marché relu : ${fmt(deals)} ${plural(deals, 'bonne affaire', 'bonnes affaires')} · ${fmt(running)} ${plural(running, 'enchère en cours', 'enchères en cours')} · ${fmt(read)} ${plural(read, 'cote relue', 'cotes relues')}${left ? ` (${fmt(left)} autres à relire : le classeur s'en charge toutes les 20 minutes)` : ''}`
        : `Cotes lues : ${fmt(read)} ${plural(read, 'carte', 'cartes')}${left ? ` (il en reste ${fmt(left)})` : ''} · ${fmt(deals)} ${plural(deals, 'bonne affaire', 'bonnes affaires')} · ${fmt(running)} ${plural(running, 'enchère en cours', 'enchères en cours')}`;
      if (r.ok === false) { M.msgErr = true; M.msg = r.why || M.msg; }
      await loadMarket(true);
    } catch (e) {
      if (gen !== cardsGen) return;
      const wait = e.data && Number(e.data.retry_after);
      M.msgErr = true;
      M.msg = e.message + (e.status === 429 && wait > 0 ? ` (encore ${fmt(Math.ceil(wait))} s)` : '');
      if (e.data && e.data.needs_link) await loadMe().catch(() => {});
      else loadMarket(true);
    } finally {
      if (gen === cardsGen) M.refreshing = false;
    }
  }
  // « Relire tout le marché » (POST /api/market/scan) : seulement pour le compte qui lit le marché entier pour le classeur
  // (scan.mine) ; une fois par heure au plus. La lecture prend environ une minute.
  async function scanWholeMarket() {
    if (M.scanning || !M.scan || !M.scan.mine) return;
    const gen = cardsGen;
    Object.assign(M, { scanning: true, msg: 'Lecture de tout le marché sur WikiMasters (environ une minute)…', msgErr: false });
    try {
      const r = await api('POST', '/api/market/scan', {});
      if (gen !== cardsGen) return;
      M.msg = typeof r.result === 'string' ? r.result.replace(/^marché entier : /, 'Marché entier : ') : 'Marché entier relu.';
      if (r.scan && typeof r.scan === 'object') M.scan = r.scan;
      await loadMarket(true);
    } catch (e) {
      if (gen !== cardsGen) return;
      M.msgErr = true;
      M.msg = e.message;
      loadMarket(true);
    } finally {
      if (gen === cardsGen) M.scanning = false;
    }
  }
  // Marché d'une carte, lu par le serveur à l'ouverture de sa fiche ou de « Mettre en vente » (GET /api/market/card : ses enchères en cours et ses
  // ventes conclues, dans la base du jeu), puis le détail de ses enchères les moins chères (GET /api/market/auction :
  // mises, meneur, vendeur, ta mise, sur le site du jeu ; trois à la fois, CM_DETAILS au plus par fiche). Gardés en mémoire
  // (CM_KEEP pour une carte, CM_DETAIL_KEEP pour une enchère) : rouvrir une fiche ne relit rien tout de suite.
  const CM_KEEP = 60000;
  const CM_DETAIL_KEEP = 2 * 60000;
  const CM_DETAILS = 10;
  const CM = reactive({ key: '', busy: false, error: '', data: null, at: 0, variant: '', hover: -1, all: false, now: Date.now(), details: {}, detailBusy: {}, detailError: '' });
  const cmCache = new Map(); // clé de la fiche -> {data, at}
  const cmDetailAt = new Map(); // id de l'enchère -> heure de lecture de son détail
  let cmTimer = null;
  // Clé du marché de la fiche ouverte : « id:<card_id> » (ta carte, celle d'un ami, une carte qui te manque dont le
  // classeur connaît l'identifiant) ou « t:<titre> » (le serveur la cherche) ; '' sans fiche ou sans compte relié.
  const ficheMarketKey = computed(() => {
    if (S.boot !== 'app' || !(S.me && S.me.session && S.me.session.linked)) return '';
    if (S.modal === 'sell' && S.sell) return 'id:' + S.sell.c.id; // la fenêtre « Mettre en vente », par-dessus la fiche ou non
    const c = openCard.value;
    if (c) return 'id:' + c.id;
    const it = S.openMissing;
    if (!it || it.status !== 'ok') return '';
    const fc = it.friend && it.friend.card;
    if (fc && fc.id != null) return 'id:' + fc.id;
    const mine = findCard(it);
    if (mine) return 'id:' + mine.id;
    const w = wantedPrices.value.get(normTitle(it.title));
    return w ? 'id:' + w.id : 't:' + normTitle(it.title);
  });
  async function loadCardMarket(key, force) {
    if (!key) return;
    const hit = cmCache.get(key);
    if (!force && hit && Date.now() - hit.at < CM_KEEP) {
      Object.assign(CM, { data: hit.data, at: hit.at, error: '', busy: false });
      loadAuctionDetails(key);
      return;
    }
    CM.busy = true;
    CM.error = '';
    try {
      const q = key.startsWith('id:') ? 'id=' + encodeURIComponent(key.slice(3)) : 'title=' + encodeURIComponent(key.slice(2));
      const r = await api('GET', '/api/market/card?' + q);
      if (CM.key !== key) return;
      const data = markRaw({ ...r, auctions: Array.isArray(r.auctions) ? r.auctions : [], sales: Array.isArray(r.sales) ? r.sales : [] });
      const at = Date.now();
      cmCache.set(key, { data, at });
      Object.assign(CM, { data, at });
      // La cote recalculée de ces ventes (rangée aussi par le serveur) : la fiche et les listes la montrent tout de suite.
      if (data.card_id && data.v && typeof data.v === 'object') {
        const x = markRaw({ id: String(data.card_id), v: data.v, at: data.at || new Date().toISOString() });
        prices.value = new Map(prices.value).set(x.id, x);
        const it = S.openMissing;
        if (it && !it.friend && key === ficheMarketKey.value) wantedPrices.value = new Map(wantedPrices.value).set(normTitle(it.title), x);
      }
      loadAuctionDetails(key);
    } catch (e) {
      if (CM.key === key) CM.error = e.message + (e.status === 429 && e.data && e.data.retry_after ? ` (encore ${fmt(Math.ceil(e.data.retry_after))} s)` : '');
      if (e.data && e.data.needs_link) loadMe().catch(() => {});
    } finally {
      if (CM.key === key) CM.busy = false;
    }
  }
  // Détails des enchères les moins chères de la fiche (celles qui ne sont pas déjà lues depuis moins de CM_DETAIL_KEEP).
  // Le jeu limite : on s'arrête là, le message le dit.
  async function loadAuctionDetails(key) {
    const list = CM.data && CM.key === key ? auctionsByPrice(CM.data.auctions).slice(0, CM_DETAILS) : [];
    const queue = list.filter((a) => !(Date.now() - (cmDetailAt.get(a.a) || 0) < CM_DETAIL_KEEP) && !CM.detailBusy[a.a]);
    let stop = false;
    const worker = async () => {
      for (let a; !stop && CM.key === key && (a = queue.shift());) {
        CM.detailBusy = { ...CM.detailBusy, [a.a]: true };
        try {
          const d = await api('GET', '/api/market/auction?id=' + encodeURIComponent(a.a));
          cmDetailAt.set(a.a, Date.now());
          CM.details = { ...CM.details, [a.a]: markRaw(d) };
        } catch (e) {
          if (e.status === 429 || e.status === 401) { stop = true; CM.detailError = e.message; }
        } finally {
          const { [a.a]: _, ...rest } = CM.detailBusy;
          CM.detailBusy = rest;
        }
      }
    };
    CM.detailError = '';
    await Promise.all([worker(), worker(), worker()]);
  }
  const askOf = (a) => Number(a.ask) || 0;
  const auctionsByPrice = (list) => list.slice().sort((a, b) => askOf(a) - askOf(b) || Date.parse(a.end) - Date.parse(b.end));
  watch(ficheMarketKey, (key) => {
    Object.assign(CM, { key, data: null, error: '', busy: false, variant: '', hover: -1, all: false, detailError: '' });
    clearInterval(cmTimer);
    cmTimer = null;
    if (!key) return;
    CM.now = Date.now();
    cmTimer = setInterval(() => { CM.now = Date.now(); }, 30000); // temps restant des enchères
    loadCardMarket(key, false);
  });
  // Exemplaires d'une carte par rareté d'exemplaire et brillance (« R* ») : son détail (variants) si le serveur l'a
  // lu, sinon approché comme le fait le serveur (tous dans sa plus haute rareté, un seul brillant si elle l'est).
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
  // tes cartes, et les cartes voulues dont le serveur a trouvé l'identifiant, `t`) : rien de plus n'est demandé au serveur.
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
    let kept = 0;
    for (const c of cards.value) {
      if (isKept(c)) { kept++; continue; } // exclue des échanges et des ventes (prefs.keep)
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
    return { list, unpriced, onSale, kept };
  });
  // Onglet « Marché » : sections repliables (accordéon : « Mes enchères » fermée par défaut, les autres ouvertes, « Valeur
  // de ton classeur » comprise depuis le 2026-10-18) et seuil
  // des « Bonnes affaires à vendre » (100W par défaut), gardés par classeur dans ce navigateur (localStorage, accès protégés
  // : sans lui, les valeurs par défaut). Chaque liste montre 20 cartes, puis « Afficher 20 de plus ».
  const MARKET_OPEN = Object.freeze({ valeur: true, ventes: true, acheter: true, vendre: true, encheres: false, filtres: false, cols: false }); // filtres, cols : les panneaux des filtres et des collections de « à acheter »
  const MARKET_MIN = 100;
  const MARKET_STEP = 20;
  // col : collection choisie dans « à acheter » avant le 2026-10-24 (reprise une fois dans ses filtres, voir dealFilter) ; hideCol : « à vendre » sans les cartes de tes collections (cochée par défaut).
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
  // Filtres de « Bonnes affaires à acheter » (2026-10-24), dans les préférences du compte (PATCH /api/me : les mêmes sur
  // tous les appareils) : deal_filter = le filtre en cours, deal_presets = les filtres enregistrés [{name, f}]. Le serveur
  // garde les enchères jusqu'à la cote (les 150 meilleures remises) ; par défaut, comme avant, la page montre celles à
  // 80 % de la cote au plus, et celles qui finissent bientôt sans mise (moins de 2 h).
  // pct : % de la cote au plus ; soon : garder quand même celles qui finissent bientôt sans mise ; min, max : prix demandé
  // (W) ; save : économie (cote - prix) au moins ; r : raretés (vide : toutes) ; shiny : '' | 'only' | 'no' ; bid : '' |
  // 'bid' | 'nobid' | 'lead' ; end : finit dans moins de <end> h (0 : peu importe) ; n : ventes au moins (fiabilité de la
  // cote) ; cols : collections incluses (vide : toutes ; une affaire passe si elle sert à l'une d'elles) ; xcols : collections
  // exclues (jamais une affaire qui sert à l'une d'elles) ; sort : DEAL_SORTS. L'ancien col (une seule collection, avant le
  // 2026-10-29) est repris dans cols.
  const DEAL_DEFAULT = Object.freeze({ pct: 80, soon: true, min: null, max: null, save: null, r: Object.freeze([]), shiny: '', bid: '', end: 0, n: 3, cols: Object.freeze([]), xcols: Object.freeze([]), sort: 'end' });
  const DEAL_SORTS = [['end', 'Fin la plus proche'], ['pct', 'Meilleure remise'], ['save', 'Plus grosse économie'], ['price', 'Prix croissant']];
  const DEAL_ENDS = [[0, 'Toutes'], [1, '< 1 h'], [6, '< 6 h'], [24, '< 24 h']];
  const DEAL_SALES = [3, 5, 10];
  const DEAL_PCTS = [30, 50, 70, 80, 100];
  const DEAL_PRESETS_MAX = 12;
  const DEAL_COLS_MAX = 50;
  const DEAL_NAME_MAX = 40;
  const DEAL_SOON_MS = 2 * 3600000;
  const DEAL_SAVE_MS = 800; // champs de saisie : enregistrés après une pause de la frappe
  const wOrNull = (v) => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) || n < 0 ? null : Math.min(Math.round(n), 1e9); };
  const colKeys = (v) => [...new Set((Array.isArray(v) ? v : []).filter((k) => typeof k === 'string' && k && k.length <= 200))].slice(0, DEAL_COLS_MAX);
  function normDealFilter(f) {
    const o = f && typeof f === 'object' && !Array.isArray(f) ? f : {};
    const cols = colKeys(Array.isArray(o.cols) ? o.cols : typeof o.col === 'string' && o.col ? [o.col] : []);
    const pct = Number(o.pct);
    const pick = (v, list, d) => (list.includes(v) ? v : d);
    return {
      pct: Number.isFinite(pct) && pct >= 1 ? Math.min(Math.round(pct), 100) : DEAL_DEFAULT.pct,
      soon: typeof o.soon === 'boolean' ? o.soon : DEAL_DEFAULT.soon,
      min: wOrNull(o.min),
      max: wOrNull(o.max),
      save: wOrNull(o.save),
      r: RARITIES.filter((x) => Array.isArray(o.r) && o.r.includes(x)),
      shiny: pick(o.shiny, ['', 'only', 'no'], ''),
      bid: pick(o.bid, ['', 'bid', 'nobid', 'lead'], ''),
      end: pick(o.end, DEAL_ENDS.map(([v]) => v), 0),
      n: pick(o.n, DEAL_SALES, DEAL_DEFAULT.n),
      cols,
      xcols: colKeys(o.xcols).filter((k) => !cols.includes(k)),
      sort: pick(o.sort, DEAL_SORTS.map(([v]) => v), DEAL_DEFAULT.sort),
    };
  }
  // Sans filtre enregistré au compte, la collection choisie avant le 2026-10-24 (gardée dans ce navigateur) est reprise.
  const dealFilter = computed(() => normDealFilter(S.prefs.deal_filter || { col: MP.col }));
  const dealPresets = computed(() => (Array.isArray(S.prefs.deal_presets) ? S.prefs.deal_presets : [])
    .filter((p) => p && typeof p.name === 'string' && p.name.trim()).slice(0, DEAL_PRESETS_MAX)
    .map((p) => ({ name: p.name.trim().slice(0, DEAL_NAME_MAX), f: normDealFilter(p.f) })));
  const sameDealFilter = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Les collections incluses et exclues d'un filtre, en mots (celles qui n'existent plus sont ignorées).
  function dealColWords(f) {
    const names = (keys) => keys.map((k) => collections.value.all.find((c) => c.key === k)).filter(Boolean).map((c) => `« ${c.name} »`);
    const inc = names(f.cols);
    const exc = names(f.xcols);
    return [inc.length ? 'pour ' + inc.join(' ou ') : '', exc.length ? 'sans ' + exc.join(', ') : ''].filter(Boolean);
  }
  // Les filtres du panneau qui s'écartent du défaut (les collections et le tri ont leur propre bouton), en mots.
  function dealFilterWords(f) {
    const out = [];
    if (f.pct !== DEAL_DEFAULT.pct) out.push(`≤ ${f.pct} % de la cote`);
    if (!f.soon) out.push('sans « finit bientôt »');
    if (f.min != null) out.push(`prix ≥ ${wfmt(f.min)}`);
    if (f.max != null) out.push(`prix ≤ ${wfmt(f.max)}`);
    if (f.save != null) out.push(`économie ≥ ${wfmt(f.save)}`);
    if (f.r.length) out.push(f.r.join(', '));
    if (f.shiny) out.push(f.shiny === 'only' ? 'brillantes' : 'pas brillantes');
    if (f.bid) out.push({ bid: 'avec mise', nobid: 'sans mise', lead: 'tu mènes' }[f.bid]);
    if (f.end) out.push(`fin dans moins de ${f.end} h`);
    if (f.n !== DEAL_DEFAULT.n) out.push(`${f.n} ventes et plus`);
    return out;
  }
  function dealMatches(x, f, now) {
    const left = Date.parse(x.end) - now;
    if (!(x.ask <= (f.pct / 100) * x.cote + 1e-9 || (f.soon && !x.bid && left < DEAL_SOON_MS))) return false;
    if (f.min != null && x.ask < f.min) return false;
    if (f.max != null && x.ask > f.max) return false;
    if (f.save != null && x.cote - x.ask < f.save) return false;
    if (f.r.length && !f.r.includes(x.r)) return false;
    if ((f.shiny === 'only' && !x.s) || (f.shiny === 'no' && x.s)) return false;
    if ((f.bid === 'bid' && !x.bid) || (f.bid === 'nobid' && x.bid) || (f.bid === 'lead' && !x.lead)) return false;
    if (f.end && left > f.end * 3600000) return false;
    return x.n >= f.n;
  }
  const DEAL_ORDER = {
    end: (a, b) => Date.parse(a.end) - Date.parse(b.end),
    pct: (a, b) => a.ask / a.cote - b.ask / b.cote || Date.parse(a.end) - Date.parse(b.end),
    save: (a, b) => (b.cote - b.ask) - (a.cote - a.ask) || Date.parse(a.end) - Date.parse(b.end),
    price: (a, b) => a.ask - b.ask || Date.parse(a.end) - Date.parse(b.end),
  };
  // Change le filtre en cours. later : depuis un champ de saisie, enregistré au compte après une pause de la frappe
  // (DEAL_SAVE_MS) ; compté comme un changement en route (prefsPending) pour qu'une relecture de GET /api/me ne le défasse
  // pas, et oublié si le classeur change entre-temps.
  let dealSaveTimer = null;
  function setDealFilter(patch, later) {
    const f = normDealFilter({ ...dealFilter.value, ...patch });
    MP.more.acheter = 0;
    if (!later) {
      if (dealSaveTimer) { clearTimeout(dealSaveTimer); dealSaveTimer = null; prefsPending--; }
      return savePrefs({ deal_filter: f });
    }
    S.prefs = normPrefs({ ...S.prefs, deal_filter: f });
    prefsGen++;
    if (dealSaveTimer) clearTimeout(dealSaveTimer); else prefsPending++;
    const gen = cardsGen;
    dealSaveTimer = setTimeout(() => {
      dealSaveTimer = null;
      prefsPending--;
      if (gen === cardsGen) savePrefs({});
    }, DEAL_SAVE_MS);
    return null;
  }
  // Champ de saisie d'un montant (W) : vide = pas de limite.
  const setDealAmount = (k, raw) => setDealFilter({ [k]: String(raw).trim() === '' ? null : wOrNull(String(raw).replace(',', '.')) }, true);
  function setDealPct(raw, later) {
    if (String(raw).trim() === '') return; // champ vidé pour en taper un autre : le seuil ne bouge pas encore
    const n = Number(String(raw).replace(',', '.'));
    if (Number.isFinite(n) && n >= 1) setDealFilter({ pct: Math.min(Math.round(n), 100) }, later);
  }
  const toggleDealRarity = (r) => setDealFilter({ r: dealFilter.value.r.includes(r) ? dealFilter.value.r.filter((x) => x !== r) : [...dealFilter.value.r, r] });
  // Une collection : incluse, exclue ou ni l'un ni l'autre (mode 'in' | 'out' ; le même mode une deuxième fois la libère).
  function setDealCol(key, mode) {
    const f = dealFilter.value;
    const was = f.cols.includes(key) ? 'in' : f.xcols.includes(key) ? 'out' : '';
    const cols = f.cols.filter((k) => k !== key);
    const xcols = f.xcols.filter((k) => k !== key);
    if (mode !== was) (mode === 'in' ? cols : xcols).push(key);
    return setDealFilter({ cols, xcols });
  }
  const clearDealCols = () => setDealFilter({ cols: [], xcols: [] });
  // « Effacer les filtres » : ceux du panneau ; les collections et le tri restent.
  const clearDealFilter = () => setDealFilter({ ...DEAL_DEFAULT, cols: dealFilter.value.cols, xcols: dealFilter.value.xcols, sort: dealFilter.value.sort });
  // Filtres enregistrés : un nom (40 caractères), le filtre en cours avec sa collection et son tri ; un nom déjà pris est
  // remplacé ; DEAL_PRESETS_MAX au plus.
  const DP = reactive({ naming: false, name: '', error: '', q: '' }); // q : recherche dans la liste des collections
  async function saveDealPreset() {
    const name = DP.name.trim().replace(/\s+/g, ' ').slice(0, DEAL_NAME_MAX);
    if (!name) { DP.error = 'Donne un nom à ces filtres.'; return; }
    const list = dealPresets.value.filter((p) => p.name.toLowerCase() !== name.toLowerCase());
    if (list.length >= DEAL_PRESETS_MAX) { DP.error = `${DEAL_PRESETS_MAX} filtres enregistrés au plus : supprimes-en un d'abord.`; return; }
    Object.assign(DP, { naming: false, name: '', error: '' });
    await savePrefs({ deal_presets: [...list, { name, f: dealFilter.value }] });
  }
  const applyDealPreset = (p) => setDealFilter({ ...p.f });
  const deleteDealPreset = (p) => savePrefs({ deal_presets: dealPresets.value.filter((x) => x.name !== p.name) });
  const leftText = (end) => {
    const ms = Date.parse(end) - Date.now();
    if (!(ms > 0)) return 'se termine';
    const m = Math.round(ms / 60000);
    if (m < 60) return `encore ${m} min`;
    if (m < 2880) return `encore ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
    return `encore ${Math.round(m / 1440)} jours`;
  };

  // ================================================================ vente d'une carte dans le jeu (SPEC.md, « Vendre »)
  // « Mettre en vente » (fiche d'une de tes cartes, « Bonnes affaires à vendre ») : le serveur met en vente un exemplaire
  // dans le jeu avec ta session reliée (POST /api/market/sell) ; la fenêtre montre tout ce que le classeur sait du marché
  // de la carte (cotes, enchères en cours, ventes, tes ventes) et propose des prix. Une vente s'annule tant que personne
  // n'a misé (POST /api/market/cancel) : depuis la fenêtre, « Mes enchères » ou les enchères de la fiche.
  const SELL_DURATIONS = [[10, '10 min'], [30, '30 min'], [60, '1 h'], [180, '3 h'], [360, '6 h'], [720, '12 h']];
  const SELL_MINUTES = 60; // la durée par défaut du jeu
  const sellLinked = () => { const sess = (S.me && S.me.session) || {}; return !!sess.linked && !sess.lost; };
  // Prix de départ proposé pour une rareté d'exemplaire : la cote fiable, sinon la cote peu fiable ; '' sans cote.
  function sellDefaultBase(c, k) {
    const p = prices.value.get(String(c.id));
    const q = p && p.v ? p.v[k] : null;
    return q && Number.isFinite(Number(q.p)) && Number(q.p) >= 1 ? String(Math.round(Number(q.p))) : '';
  }
  // k : la rareté d'exemplaire à vendre (« Bonnes affaires à vendre » : celle de la ligne) ; sinon celle de tes exemplaires
  // qui a la plus haute cote fiable, puis la plus haute rareté.
  function openSell(c, k) {
    const list = variantsOf(c).list.map(([x]) => x);
    const v = (prices.value.get(String(c.id)) || {}).v || {};
    const score = (x) => (reliable(v[x]) ? Number(v[x].p) : -1);
    const best = k && list.includes(k) ? k : list.slice().sort((a, b) => score(b) - score(a) || variantOrder(b, a))[0] || c.rarity || 'C';
    S.sell = { c: markRaw(c), k: best, base: sellDefaultBase(c, best), minutes: SELL_MINUTES, info: null, infoBusy: false, infoError: '',
      busy: false, error: '', verify: false, done: null, cancelBusy: false, cancelError: '', cancelled: false };
    S.modal = 'sell';
    if (sellLinked()) loadSellInfo(S.sell);
  }
  // Tes exemplaires de la carte dans le jeu et tes enchères actives (GET /api/market/sell) : la rareté choisie est gardée
  // si le jeu l'a, sinon la première qu'il a.
  async function loadSellInfo(sl) {
    sl.infoBusy = true;
    sl.infoError = '';
    try {
      const r = await api('GET', '/api/market/sell?id=' + encodeURIComponent(sl.c.id));
      if (S.sell !== sl) return;
      sl.info = markRaw({ copies: Array.isArray(r.copies) ? r.copies : [], selling: r.selling ?? null, max: r.max ?? null });
      const ks = sl.info.copies.map((x) => x.k);
      if (ks.length && !ks.includes(sl.k)) setSellVariant(sl, ks[0]);
    } catch (e) {
      if (S.sell === sl) sl.infoError = e.message + (e.status === 429 && e.data && e.data.retry_after ? ` (encore ${fmt(Math.ceil(e.data.retry_after))} s)` : '');
      if (e.data && e.data.needs_link) loadMe().catch(() => {});
    } finally {
      if (S.sell === sl) sl.infoBusy = false;
    }
  }
  function setSellVariant(sl, k) {
    const auto = sl.base === '' || sl.base === sellDefaultBase(sl.c, sl.k);
    sl.k = k;
    if (auto) sl.base = sellDefaultBase(sl.c, k); // prix encore celui proposé : suit la rareté
    sl.error = '';
    CM.variant = k; // la courbe des prix de vente montre cette rareté, si elle a assez de ventes
    CM.hover = -1;
  }
  const sellBaseOf = (sl) => { const n = Number(String(sl.base).replace(/\s/g, '')); return Number.isInteger(n) && n >= 1 && n <= 1e7 ? n : null; };
  // Ce que le classeur sait du marché de la carte pour une rareté d'exemplaire : cote, enchères en cours de cette rareté
  // (la moins chère, avec ou sans mise), dernières ventes ; et tes ventes de la carte (14 jours, dernière lecture du marché).
  function sellMarket(sl) {
    const p = prices.value.get(String(sl.c.id));
    const d = CM.data && CM.data.card_id === String(sl.c.id) ? CM.data : null;
    const q = (d && d.v && d.v[sl.k]) || (p && p.v ? p.v[sl.k] : null) || null;
    const running = d ? d.auctions.filter((a) => a.r + (a.s ? '*' : '') === sl.k && !a.mine) : [];
    const cheapest = running.length ? auctionsByPrice(running)[0] : null;
    const sales = d ? d.sales.filter((x) => x.k === sl.k) : [];
    const mine = M.live && Array.isArray(M.live.sales) ? M.live.sales.filter((x) => x && x.id === String(sl.c.id)) : [];
    return { q, d, running, cheapest, sales, mine };
  }
  async function sendSell(sl) {
    if (sl.busy) return;
    const base = sellBaseOf(sl);
    if (base === null) { sl.error = 'Mise de départ : un nombre entier de W, 1 au moins.'; return; }
    sl.busy = true;
    sl.error = '';
    sl.verify = false;
    try {
      const r = await api('POST', '/api/market/sell', { id: sl.c.id, k: sl.k, base, minutes: sl.minutes });
      const a = r.auction || {};
      sl.done = markRaw({ a: a.a, k: a.k || sl.k, base: a.base || base, minutes: a.minutes || sl.minutes, end: a.end || null, url: r.url || gameAuctionUrl(a.a) });
      // La fiche et la fenêtre la montrent tout de suite parmi les enchères en cours ; « Mes enchères » et « à vendre » la
      // prennent dans la lecture du marché, que le serveur vient de mettre à jour.
      if (CM.data && CM.data.card_id === String(sl.c.id) && a.a) {
        const k = sl.done.k;
        const own = { a: a.a, r: k.replace('*', ''), s: k.endsWith('*'), ask: sl.done.base, bid: false, cur: null, base: sl.done.base, end: sl.done.end, atk: null, def: null, lead: false, mine: true, n: null };
        const data = markRaw({ ...CM.data, auctions: [...CM.data.auctions.filter((x) => x.a !== a.a), own] });
        cmCache.set(CM.key, { data, at: CM.at });
        CM.data = data;
      }
      loadMarket(true);
    } catch (e) {
      sl.error = e.message + (e.status === 429 && e.data && e.data.retry_after && !e.data.limited ? ` (encore ${fmt(Math.ceil(e.data.retry_after))} s)` : '');
      sl.verify = !!(e.data && e.data.verify);
      if (e.data && e.data.needs_link) loadMe().catch(() => {});
    } finally {
      sl.busy = false;
    }
  }
  // Annule une de tes ventes (le serveur vérifie d'abord sur le site du jeu que personne n'a misé). → true si annulée.
  async function cancelSaleApi(a) {
    await api('POST', '/api/market/cancel', { a });
    if (CM.data && CM.data.auctions.some((x) => x.a === a)) {
      const data = markRaw({ ...CM.data, auctions: CM.data.auctions.filter((x) => x.a !== a) });
      cmCache.set(CM.key, { data, at: CM.at });
      CM.data = data;
    }
    loadMarket(true);
    return true;
  }
  async function cancelFromSell(sl) {
    if (sl.cancelBusy || !sl.done) return;
    sl.cancelBusy = true;
    sl.cancelError = '';
    try {
      await cancelSaleApi(sl.done.a);
      sl.cancelled = true;
    } catch (e) {
      sl.cancelError = e.message;
    } finally {
      sl.cancelBusy = false;
    }
  }
  // « Annuler la vente » d'une liste (« Mes enchères », enchères de la fiche) : confirmation d'abord.
  function askCancelSale(a, title) {
    openConfirm({
      title: 'Annuler la vente',
      text: `Retirer${title ? ` « ${title} »` : ' cette carte'} du marché du jeu ? La carte revient dans ta collection. Le jeu refuse si quelqu'un a déjà misé.`,
      ok: 'Annuler la vente',
      danger: true,
      run: () => cancelSaleApi(a),
      after: () => notify('Vente annulée : la carte revient dans ta collection du jeu.'),
      back: S.modal === 'sell' ? 'sell' : null,
    });
  }
  // ================================================================ mise sur une enchère du jeu (SPEC.md, « Miser »)
  // « Miser » (« Bonnes affaires à acheter », enchères en cours de la fiche d'une carte) : le serveur relit l'enchère sur le
  // site du jeu, puis mise à ton nom avec ta session reliée (POST /api/market/bid). Mise minimale : le prix de départ sans
  // mise, un W de plus que l'enchère actuelle après (le jeu peut demander plus : son refus est montré).
  // x : l'enchère {a, t, r, s, ask, bid, cur?, end, cote?, n?} (une bonne affaire, ou une enchère de la fiche).
  const bidMin = (x) => (x.bid ? Math.floor(Number(x.cur ?? x.ask) || 0) + 1 : Math.max(1, Math.ceil(Number(x.ask) || 1)));
  const bidAmountOf = (b) => { const n = Number(String(b.amount).replace(/\s/g, '')); return Number.isInteger(n) && n >= 1 && n <= 1e7 ? n : null; };
  function openBid(x) {
    const min = bidMin(x);
    S.bid = { x: markRaw({ ...x }), min, amount: String(min), busy: false, error: '', verify: false, done: null };
    S.modal = 'bid';
  }
  const bidButton = (x, cls) => (sellLinked() ? h('button', { class: ['btn', 'small', 'primary', cls || ''], type: 'button', 'aria-label': `Miser sur « ${x.t} »`, onClick: () => openBid(x) }, 'Miser') : null);
  async function sendBid(b) {
    if (b.busy) return;
    const amount = bidAmountOf(b);
    if (amount === null) { b.error = 'Ta mise : un nombre entier de W, 1 au moins.'; return; }
    b.busy = true;
    b.error = '';
    b.verify = false;
    const a = b.x.a;
    try {
      const r = await api('POST', '/api/market/bid', { a, amount });
      const cur = Number.isFinite(r.cur) ? r.cur : amount;
      b.done = markRaw({ amount: r.amount || amount, cur, balance: Number.isInteger(r.balance) ? r.balance : null, url: r.url || gameAuctionUrl(a) });
      if (b.done.balance != null && S.me) S.me.wikibidous = { n: b.done.balance, at: new Date().toISOString() };
      // La fiche la montre tout de suite « tu mènes » ; « Bonnes affaires » et « Tes mises » la prennent dans la lecture du
      // marché, que le serveur vient de mettre à jour.
      if (CM.data && CM.data.auctions.some((y) => y.a === a)) {
        const data = markRaw({ ...CM.data, auctions: CM.data.auctions.map((y) => (y.a === a ? { ...y, ask: cur, cur, bid: true, lead: true } : y)) });
        cmCache.set(CM.key, { data, at: CM.at });
        CM.data = data;
      }
      const det = CM.details[a];
      if (det && !det.gone) CM.details = { ...CM.details, [a]: markRaw({ ...det, leading: true, leader: null, cur, my_bid: amount, bids: (det.bids || 0) + 1 }) };
      loadMarket(true);
    } catch (e) {
      b.error = e.message + (e.status === 429 && e.data && e.data.retry_after && !e.data.limited ? ` (encore ${fmt(Math.ceil(e.data.retry_after))} s)` : '');
      b.verify = !!(e.data && e.data.verify);
      // Quelqu'un a misé entre-temps : le minimum suit.
      if (e.data && Number.isInteger(e.data.min)) {
        const auto = bidAmountOf(b) === b.min;
        b.min = e.data.min;
        if (e.data.cur != null) b.x = markRaw({ ...b.x, bid: true, cur: e.data.cur, ask: e.data.cur });
        if (auto) b.amount = String(b.min);
      }
      if (e.data && e.data.needs_link) loadMe().catch(() => {});
    } finally {
      b.busy = false;
    }
  }
  // « Mes ventes en cours » (onglet « Marché ») : tes ventes pas encore finies d'après la dernière lecture du marché (ou
  // ajoutées par une vente du classeur depuis), la fin la plus proche d'abord. Section ouverte et onglet affiché : leurs
  // mises sont relues sur le site du jeu (GET /api/market/auction, gardées CM_DETAIL_KEEP, SALES_DETAILS au plus) : la
  // lecture du marché peut dater de 20 min, et une vente ne s'annule que sans mise.
  const SALES_DETAILS = 10;
  const SD = reactive({ details: {}, busy: {}, error: '' });
  const sdAt = new Map(); // id de l'enchère -> heure de lecture de son détail
  const runningSales = computed(() => {
    void CM.now;
    const sales = M.live && Array.isArray(M.live.sales) ? M.live.sales : [];
    return sales.filter((x) => x && x.st === 'run' && Date.parse(x.end) > Date.now()).sort((a, b) => Date.parse(a.end) - Date.parse(b.end));
  });
  async function loadSaleDetails(force) {
    const queue = runningSales.value.slice(0, SALES_DETAILS).filter((x) => !SD.busy[x.a] && (force || !(Date.now() - (sdAt.get(x.a) || 0) < CM_DETAIL_KEEP)));
    if (!queue.length) return;
    SD.error = '';
    let stop = false;
    const worker = async () => {
      for (let x; !stop && (x = queue.shift());) {
        SD.busy = { ...SD.busy, [x.a]: true };
        try {
          const d = await api('GET', '/api/market/auction?id=' + encodeURIComponent(x.a));
          sdAt.set(x.a, Date.now());
          SD.details = { ...SD.details, [x.a]: markRaw(d) };
        } catch (e) {
          if (e.status === 429 || e.status === 401) { stop = true; SD.error = e.message; }
        } finally {
          const { [x.a]: _, ...rest } = SD.busy;
          SD.busy = rest;
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }
  watch(() => (S.boot === 'app' && S.tab === 'marche' && MP.open.ventes && sellLinked() ? runningSales.value.map((x) => x.a).join() : ''), (ids) => {
    if (ids) loadSaleDetails(false);
  }, { immediate: true });

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

  // Couverture d'une carte sans image (case « Couverture dessinée ») : icône de la nature de l'article, son nom et le
  // drapeau du pays que nomme sa description. size : card (haut d'une carte), slot (case vide, fiche), mini (vignette).
  function viewCover(desc, title, size) {
    const c = Art.coverOf(desc, title);
    return h('div', { class: ['cover', 'cover--' + size], 'aria-hidden': 'true' }, [
      h('svg', { class: 'cover__ic', focusable: 'false' }, [h('use', { href: '#i-' + c.icon })]),
      size === 'mini' ? null : h('span', { class: 'cover__label' }, c.label),
      c.flag && size !== 'mini' ? h('img', { class: 'cover__flag', src: c.flag, alt: '', loading: 'lazy', decoding: 'async', onError: hideBroken }) : null,
    ]);
  }
  // Fond sous l'image d'une carte : son initiale (affichage par défaut) ; avec la couverture, celle-ci si la carte n'a pas
  // d'image, rien sinon (elle se verrait à travers une image transparente).
  const noArt = (c, img) => h('div', { class: 'card__noart' },
    artCover() ? (img ? [] : [viewCover(c.category, c.title, 'card')]) : [h('span', null, initialOf(c.title))]);

  // ---------------------------------------------------------------- style des cartes (Réglages, prefs.card_style)
  // « classique » (par défaut) = le rendu d'origine, inchangé ; les quatre autres posent un visage .cf (conteneur des
  // unités cqw, qui suivent la taille de la carte) dans la carte et la classe cs cs--<style>. Leur finition monte avec la
  // rareté (app.css, « styles de carte »). L'inclinaison et le reflet suivent la souris (tiltCards, plus bas).
  const CARD_STYLES = [
    { id: 'classique', name: 'Classique', what: 'Le rendu d\'origine : image en haut, texte sur la couleur de la rareté.' },
    { id: 'plein', name: 'Holo plein cadre', what: 'L\'illustration prend toute la carte, cadre métal de plus en plus brillant avec la rareté.' },
    { id: 'tcg', name: 'Cadre TCG', what: 'Carte de jeu à cases : bandeau du nom, fenêtre d\'illustration, ligne de type, statistiques en blocs.' },
    { id: 'musee', name: 'Musée', what: 'Plein cadre façon œuvre exposée : cartel crème, titre en sérif, sceau de rareté.' },
    { id: 'neon', name: 'Néon chrome', what: 'Cadre chromé, liseré néon ; Communes et Peu communes en bichromie, couleurs pleines dès Rare.' },
  ];
  const cardStyle = () => (CARD_STYLES.some((s) => s.id === S.prefs.card_style) ? S.prefs.card_style : 'classique');
  const csClass = (st) => (st === 'classique' ? null : ['cs', 'cs--' + st]);
  // Carte des aperçus des Réglages : ta plus rare qui a une image (à rareté égale, la plus forte), sinon un exemple.
  const styleSample = computed(() => {
    let best = null, bestKey = -1;
    for (const c of cards.value) {
      if (!c.image) continue;
      const key = RAR_UP.indexOf(okRarity(c.rarity) || 'C') * 1e6 + Math.min(999999, (c.atk || 0) + (c.def || 0));
      if (key > bestKey) { best = c; bestKey = key; }
    }
    return best || { id: 'exemple', title: 'La Joconde', category: 'peinture de Léonard de Vinci', rarity: 'L', atk: 9640, def: 9410, image: null, count: 1 };
  });
  // Visage d'une carte d'un des quatre styles. o : big (fiche), star (étoile du jeu montrée), isNew, have (carte d'un
  // ami : true / false ; undefined sinon), countTitle. Les statistiques manquent sur les cartes d'un ami.
  function csFace(st, c, r, img, o) {
    const art = h('div', { class: 'cf__art' }, [
      noArt(c, img),
      img ? h('img', { src: img, alt: '', loading: o.big ? null : 'lazy', decoding: 'async', onError: hideBroken }) : null,
    ]);
    const holoArt = h('div', { class: 'cf__holo cf__holo--art' });
    const gem = h('span', { class: 'cf__gem', 'aria-hidden': 'true' }, st === 'neon' ? RARITY_NAME[r] : r);
    const star = o.star && c.starred ? h('svg', { class: 'cf__star', viewBox: '0 0 24 24', role: 'img', 'aria-label': 'Favorite dans le jeu' }, [h('use', { href: '#i-star' })]) : null;
    const count = c.count > 1 ? h('span', { class: 'cf__count', title: o.countTitle }, '×' + fmt(c.count)) : null;
    const flag = o.have != null ? h('span', { class: ['cf__flag', { have: o.have }] }, o.have ? "Tu l'as" : 'Te manque')
      : o.isNew ? h('span', { class: 'cf__flag' }, 'Nouvelle') : null;
    const title = h(o.big ? 'p' : 'h3', { class: 'cf__title' }, c.title);
    const cat = c.category ? h('p', { class: 'cf__cat' }, c.category) : null;
    const stat = (k, name, v) => h('span', { class: ['cf__stat', k], title: name }, [icon(k === 'atk' ? 'swords' : 'shield'),
      h('small', { 'aria-hidden': 'true' }, k === 'atk' ? 'ATK' : 'DEF'), sr(name + ' '), h('b', null, fmt(v))]);
    const stats = c.atk != null || c.def != null ? h('div', { class: 'cf__stats' }, [stat('atk', 'Attaque', c.atk || 0), stat('def', 'Défense', c.def || 0)]) : null;
    const glare = h('div', { class: 'cf__glare' });
    const badges = [star, count, flag];
    if (st === 'tcg') {
      return [h('div', { class: 'cf__holo cf__holo--card' }), h('div', { class: 'cf__face' }, [
        h('div', { class: 'cf__name' }, [title, gem]),
        h('div', { class: 'cf__window' }, [art, holoArt, ...badges]),
        cat ? h('p', { class: 'cf__type' }, c.category) : null,
        stats,
      ]), glare];
    }
    if (st === 'musee') return [art, holoArt, h('div', { class: 'cf__edge' }), gem, ...badges, h('div', { class: 'cf__label' }, [title, cat, stats]), glare];
    const info = h('div', { class: 'cf__info' }, [title, cat, stats]);
    if (st === 'neon') return [art, h('div', { class: 'cf__tint' }), holoArt, h('div', { class: 'cf__scrim' }), h('div', { class: 'cf__neon' }), h('div', { class: 'cf__chrome' }), gem, ...badges, info, glare];
    return [art, holoArt, h('div', { class: 'cf__scrim' }), h('div', { class: 'cf__frame' }, [h('div', { class: 'cf__holo' })]), gem, ...badges, info, glare];
  }
  // Inclinaison et reflet à la souris (pas au doigt) : variables --mx, --my (position du pointeur), --rx, --ry (angles),
  // --o (reflet allumé), posées par le CSSOM sur la carte survolée et retirées quand elle n'est plus sous le pointeur.
  let tiltEl = null;
  const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function tiltOff() {
    if (!tiltEl) return;
    for (const p of ['--mx', '--my', '--o', '--rx', '--ry']) tiltEl.style.removeProperty(p);
    tiltEl = null;
  }
  document.addEventListener('pointermove', (e) => {
    const el = e.pointerType === 'mouse' && e.target && e.target.closest ? e.target.closest('.card.cs') : null;
    if (el !== tiltEl) tiltOff();
    if (!el) return;
    tiltEl = el;
    const b = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y = Math.min(1, Math.max(0, (e.clientY - b.top) / b.height));
    el.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
    el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
    el.style.setProperty('--o', '1');
    if (!still && !el.classList.contains('card--friend')) {
      el.style.setProperty('--rx', ((0.5 - y) * 14).toFixed(2) + 'deg');
      el.style.setProperty('--ry', ((x - 0.5) * 18).toFixed(2) + 'deg');
    }
  }, { passive: true });
  document.addEventListener('pointerout', (e) => { if (!e.relatedTarget) tiltOff(); }, { passive: true });

  // ---------------------------------------------------------------- la carte de jeu (5:7)
  // look : style imposé (aperçus des Réglages, carte inerte) ; sinon celui des Réglages.
  function viewCard(c, big, sep, look) {
    const r = okRarity(c.rarity) || 'C';
    const img = artOf(c.title, c.image);
    const st = look || cardStyle();
    const inert = big || !!look;
    const open = (e) => {
      if (inert) return;
      if (e.shiftKey || e.ctrlKey || e.metaKey) { toggleSelect(c.id, e); return; }
      openCardFrom(c.id, e);
    };
    if (st !== 'classique') {
      return h('article', {
        class: ['card', csClass(st), 'r' + r, { shiny: c.shiny, big }],
        role: inert ? null : 'button', tabindex: inert ? null : '0', 'aria-hidden': look ? 'true' : null,
        'aria-label': look ? null : `${c.title}, ${RARITY_NAME[r]}${c.shiny ? ', brillante' : ''}${sep ? ', intercalaire' : ''}${big ? '' : ' : ouvrir la fiche'}`,
        onClick: open,
        onKeydown: inert ? null : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCardFrom(c.id, e); } },
      }, [h('div', { class: 'cf' }, csFace(st, c, r, img, { big, star: true, isNew: !inert && newIdSet.value.has(c.id), countTitle: `${fmt(c.count)} exemplaires` }))]);
    }
    return h('article', {
      class: ['card', 'r' + r, { shiny: c.shiny, big }],
      role: inert ? null : 'button', tabindex: inert ? null : '0', 'aria-hidden': look ? 'true' : null,
      'aria-label': look ? null : `${c.title}, ${RARITY_NAME[r]}${c.shiny ? ', brillante' : ''}${sep ? ', intercalaire' : ''}${big ? '' : ' : ouvrir la fiche'}`,
      onClick: open,
      onKeydown: inert ? null : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCardFrom(c.id, e); } },
    }, [
      h('div', { class: 'card__art' }, [
        noArt(c, img),
        img ? h('img', { src: img, alt: '', loading: big ? null : 'lazy', decoding: 'async', onError: hideBroken }) : null,
      ]),
      pill(r),
      c.starred ? h('svg', { class: 'card__star', viewBox: '0 0 24 24', role: 'img', 'aria-label': 'Favorite dans le jeu' }, [h('use', { href: '#i-star' })]) : null,
      c.count > 1 ? h('span', { class: 'card__count', title: `${fmt(c.count)} exemplaires` }, '×' + fmt(c.count)) : null,
      !inert && newIdSet.value.has(c.id) ? h('span', { class: 'card__new' }, 'Nouvelle') : null,
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
  // Intercalaire (élément `sep` d'une collection, qui ouvre une section) : la carte ou la case posée sur un cadre, comme
  // glissée dans l'intercalaire d'un classeur (dessiné en CSS, .sep-frame). Le cadre ne bouge pas quand la carte se
  // soulève au survol. key : celle de l'élément de la grille, quand le cadre en est un.
  const sepFrame = (node, on, key) => (on ? h('div', { class: 'sep-frame', key: key || null }, [node]) : node);
  // Sections d'un album, seulement dans l'ordre de la collection, sans filtre (ailleurs, l'intercalaire ne garde que son
  // cadre) : chaque intercalaire est précédé d'un bandeau de toute la largeur (secHead, 2026-10-28, demande de
  // l'utilisateur : « la gestion des intercalaires n'est pas très satisfaisante et belle »), qui ouvre une nouvelle ligne ;
  // les cartes hors section, montrées après les sections (foldSlots), ont le leur.
  const showSections = (ordered, sort, filter) => !!ordered && sort === 'order' && filter === 'all';
  function albumKids(slots, sections, render, fold) {
    const kids = [];
    slots.forEach((s) => {
      const sec = sections && s.item.sep && fold ? fold.sec.get(s.key) : null;
      if (sec) kids.push(secHead(fold.album, s, sec));
      else if (sections && fold && s.key === fold.loose) kids.push(h('div', { class: 'sec-head sec-head--loose', key: 'sec:' + s.key }, [
        h('h3', { class: 'sec-head__h' }, h('span', { class: 'sec-head__tab' }, 'Hors intercalaire')),
        h('span', { class: 'sec-head__meta' }, cards$(fold.looseN)),
      ]));
      if (!(sec && sec.folded) && !isLabel(s.item)) kids.push(render(s));
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
  // Une section repliée ne garde que son bandeau. Les cartes d'avant le premier intercalaire (hors de toute section)
  // passent après les sections, sur une nouvelle ligne (2026-10-26, demande de l'utilisateur : les intercalaires toujours
  // au-dessus des cartes non triées) ; seulement à l'affichage, la collection garde son ordre. {slots (à montrer), sec
  // (clé de l'intercalaire → {n : cartes de sa section après lui, folded, own et total : cartes possédées et éléments,
  // intercalaire compris, byR : possédées par rareté, sample : 3 possédées au plus}), loose (clé de la première carte
  // hors section, ou null), looseN, album}. Possédée = s.card (la tienne, ou celle de l'ami dans son album).
  function foldSlots(slots, sections, album) {
    const sec = new Map();
    // Hors des sections, un intercalaire libre n'a rien à montrer.
    if (!sections) return { slots: slots.some((s) => isLabel(s.item)) ? slots.filter((s) => !isLabel(s.item)) : slots, sec, loose: null, looseN: 0, album };
    const folded = new Set(foldedIn(album));
    const out = [];
    const loose = [];
    let cur = null;
    const count = (x, s) => {
      x.total++;
      if (!s.card) return;
      x.own++;
      const r = okRarity(s.card.rarity) || 'C';
      x.byR[r] = (x.byR[r] || 0) + 1;
      if (x.sample.length < 3) x.sample.push(s.card);
    };
    for (const s of slots) {
      if (s.item.sep) {
        cur = { n: 0, folded: folded.has(s.item.title), own: 0, total: 0, byR: {}, sample: [], label: isLabel(s.item) };
        if (!cur.label) count(cur, s); // un intercalaire libre n'est pas une carte de sa section
        sec.set(s.key, cur);
        out.push(s);
        continue;
      }
      if (!cur) { loose.push(s); continue; }
      cur.n++;
      count(cur, s);
      if (!cur.folded) out.push(s);
    }
    return { slots: out.concat(loose), sec, loose: loose.length && out.length ? loose[0].key : null, looseN: loose.length, album };
  }
  // Bandeau d'une section : l'onglet de l'intercalaire (son nom), « 4 / 7 » et la barre de raretés de la section, doré
  // quand elle est complète. Avec au moins une carte après l'intercalaire, tout le bandeau est le bouton qui la replie
  // (.sec-fold, aria-expanded) ; repliée, il montre en éventail ses cartes possédées et « +N ».
  function secHead(album, s, sec) {
    const title = s.item.title;
    const done = isComplete(sec);
    const meta = [
      h('span', { class: 'sec-head__count num' }, [h('b', null, fmt(sec.own)), ' / ', fmt(sec.total)]),
      rarityBar(sec.byR, sec.total, 'bar sec-head__bar'),
      done ? doneMark() : null,
    ];
    const folded = sec.n && sec.folded;
    const fan = folded ? h('span', { class: 'sec-head__fan', 'aria-hidden': 'true' }, [
      h('span', { class: 'fan' }, sec.sample.length ? sec.sample.map(viewMini) : [h('span', { class: 'mini empty' })]),
      h('span', { class: 'sec-head__more num' }, '+' + fmt(sec.label ? sec.n : sec.n + 1)),
    ]) : null;
    const tab = h('span', { class: 'sec-head__tab' }, [sec.n ? icon('chev', 'sm') : null, h('span', { class: 'sec-head__name' }, title)]);
    const cls = ['sec-head', { 'sec-head--fold': !!sec.n, 'sec-head--label': !!sec.label, folded, complete: done }];
    if (!sec.n) return h('div', { class: cls, key: 'sec:' + s.key }, [h('h3', { class: 'sec-head__h' }, tab), h('span', { class: 'sec-head__meta' }, meta)]);
    const what = `la section « ${title} » (${cards$(sec.n)})`;
    return h('div', { class: cls, key: 'sec:' + s.key }, [
      h('h3', { class: 'sec-head__h' }, h('button', { class: 'sec-fold', type: 'button', 'aria-expanded': String(!sec.folded),
        'aria-label': (sec.folded ? 'Déplier ' : 'Replier ') + what + ` : ${fmt(sec.own)} sur ${fmt(sec.total)}`, onClick: () => toggleFold(album, title) },
      [tab, h('span', { class: 'sec-head__meta' }, meta), fan])),
    ]);
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
    const kept = isKept(c);
    return h('div', { class: ['cell', { selected: sel, pulled: S.openId === c.id, sep }] }, [
      sepFrame(viewCard(c, false, sep), sep),
      kept ? h('span', { class: 'cell__keep', title: 'Exclue des échanges et ventes' }, [icon('lock', 'sm'), sr('Exclue des échanges et ventes')]) : null,
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
    const img = artOf(it.title, it.image || s.thumb);
    let views = '';
    if (it.status === 'ok') views = s.views != null ? `${fmt(s.views)} vues / 30 j` : S.pv.running ? 'vues…' : 'vues inconnues';
    return sepFrame(h('div', { class: ['slot', { pulled: !!S.openMissing && S.openMissing.title === it.title, sep: !!it.sep }], key: s.key }, [
      img ? h('img', { class: 'slot__bg', src: img, alt: '', loading: 'lazy', decoding: 'async', onError: hideBroken })
        : artCover() && it.status === 'ok' ? viewCover(it.description, it.title, 'slot') : null,
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
    const img = artOf(c.title, c.image);
    return h('span', { class: ['mini', 'r' + r], key: c.id + ':' + i }, img ? [h('img', { src: img, alt: '', loading: 'lazy', decoding: 'async', onError: hideBroken })]
      : artCover() ? [viewCover(c.category, c.title, 'mini')] : null);
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
  const TABS = [['collections', 'Collections'], ['cartes', 'Mes cartes'], ['amis', 'Entre amis'], ['marche', 'Marché'], ['chat', 'Chat'], ['maj', 'Synchro'], ['palmares', 'Palmarès'], ['reglages', 'Réglages']];
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
        [icon(sess.linked ? 'refresh' : 'link', S.refresh.running ? 'spin' : ''), S.refresh.running ? 'Rafraîchissement…' : (sess.linked ? 'Rafraîchir la collection' : 'Relier mon compte')]),
      h('span', { class: ['status', { err: S.refresh.error, warn: S.refresh.warn }], 'aria-live': 'polite' }, S.refresh.msg),
      S.refresh.error && !S.refresh.running && !sess.linked ? h('button', { class: 'linkish', type: 'button', onClick: openSyncTab }, 'Relier mon compte') : null,
      lastBad ? h('span', { class: ['status', 'last-sync', lastBad.result === 'error' ? 'err' : 'warn'] },
        `Dernière synchro ${lastBad.result === 'error' ? 'en échec' : 'incomplète'} (${syncKind(lastBad.via, lastBad.kind)}, ${syncWhen(lastBad.at)}) : ${lastBad.message}`) : null,
      lastBad ? h('button', { class: 'linkish', type: 'button', onClick: () => setTab('maj') }, 'Dernières synchros') : null,
    ];
    if (!total) {
      return h('div', { class: 'summary' }, [
        h('div', { class: 'figures' }, [h('div', { class: 'figure wide' }, [h('span', null, S.loadingCards ? 'Chargement de ta collection…'
          : "Ton classeur est vide : relie ton compte du jeu dans « Synchro ».")])]),
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
          sess.lost ? h('span', { class: 'stamp warn' }, '· compte du jeu à relier') : null,
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
      h('div', { class: 'tabs-row' }, [
        h('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Sections' }, TABS.map(([id, label]) => h('button', {
          key: id, id: 'tab-' + id, type: 'button', role: 'tab', 'aria-selected': String(S.tab === id), 'aria-controls': 'panel-' + id,
          // Page hors des onglets (« Nouveautés ») : le premier onglet reste joignable au clavier.
          tabindex: S.tab === id || (id === TABS[0][0] && !TABS.some(([t]) => t === S.tab)) ? '0' : '-1', onClick: () => setTab(id), onKeydown: onTabKey,
        }, id === 'chat' ? chatTabLabel(label) : label))),
        // « Nouveautés » : une page à part (pas un onglet), pastille tant que la dernière version n'a pas été vue ici.
        h('a', { class: ['news-link', { on: S.tab === 'nouveautes' }], href: '#/nouveautes', 'aria-current': S.tab === 'nouveautes' ? 'page' : null },
          [icon('spark', 'sm'), 'Nouveautés', newsUnseen.value ? h('span', { class: 'news-dot' }, ['nouveau', sr(' : une version que tu n\'as pas encore vue')]) : null]),
      ]),
    ])]);
  }

  // ================================================================ rendu : téléphone (barre du haut, barre du bas, « Plus »)
  // Sous 760 px, le bandeau et les onglets du haut laissent la place à une barre compacte (titre de la vue, retour,
  // synchro) et à une barre flottante en bas ; le reste des onglets est dans la feuille « Plus ». Tout est rendu sur
  // ordinateur aussi, mais caché par le CSS (.m-only) : la version large ne change pas.
  const M_NAV = [['collections', 'Collections', 'album'], ['amis', 'Amis', 'users'], ['chat', 'Chat', 'chat'], ['marche', 'Marché', 'coins']];
  const M_MORE = [['cartes', 'Mes cartes', 'grid', 'Toutes tes cartes, tes tags et les filtres'], ['maj', 'Synchro', 'refresh', 'Ton compte du jeu, la synchro et son journal'],
    ['palmares', 'Palmarès', 'spark', 'Les podiums des membres du classeur'],
    ['reglages', 'Réglages', 'gear', 'Prénom, pseudo, partage, lien personnel'], ['nouveautes', 'Nouveautés', 'spark', 'Ce qui a changé dans le classeur']];
  const M_TITLE = { collections: 'Collections', cartes: 'Mes cartes', amis: 'Entre amis', marche: 'Marché', chat: 'Chat', maj: 'Synchro', palmares: 'Palmarès', reglages: 'Réglages', nouveautes: 'Nouveautés', 'souhaits-sans-cartes': 'Titres sans cartes' };
  // ---------------------------------------------------------------- app installée (PWA)
  // L'app installée (écran d'accueil) est la même page, ouverte sans barre d'adresse. Sur iPhone, elle a son propre
  // stockage, séparé de Safari : au premier lancement elle ne connaît pas la clé, d'où « J'ai déjà un lien » en tête de
  // l'accueil et le lien à copier dans « Installer l'app ». La liaison du compte du jeu, elle, se fait dans le navigateur.
  const mq = (q) => { try { return typeof window.matchMedia === 'function' && window.matchMedia(q).matches; } catch { return false; } };
  const STANDALONE = mq('(display-mode: standalone)') || (typeof navigator !== 'undefined' && navigator.standalone === true);
  const UA = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const IOS = /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && (navigator.maxTouchPoints || 0) > 1);
  let installEvent = null; // beforeinstallprompt gardé jusqu'au clic sur « Installer »
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; S.installReady = true; });
    window.addEventListener('appinstalled', () => { installEvent = null; S.installReady = false; S.installed = true; });
    // Service worker (sw.js) : rend l'app installable et l'ouvre sans réseau ; jamais sur une adresse non sûre.
    if (typeof navigator !== 'undefined' && navigator.serviceWorker && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
    }
  }
  async function installApp() {
    if (!installEvent) return;
    const e = installEvent;
    installEvent = null;
    S.installReady = false;
    try { e.prompt(); const r = await e.userChoice; if (r && r.outcome === 'accepted') S.installed = true; } catch { /* refusée ou déjà montrée */ }
  }
  function openInstall() { S.mMore = false; S.modal = 'install'; }
  function modalInstall() {
    const how = S.installed ? h('p', { class: 'ok', role: 'status' }, "C'est installé : l'icône « Classeur » est sur ton écran d'accueil.")
      : S.installReady ? h('div', { class: 'actions' }, [h('button', { class: 'btn primary', type: 'button', onClick: installApp }, [icon('upload', 'sm'), "Installer l'app"])])
      : IOS ? h('ol', { class: 'steps' }, [
        h('li', null, ['Dans Safari, touche le bouton ', h('strong', null, 'Partager'), ' (le carré avec une flèche vers le haut).']),
        h('li', null, ['Choisis ', h('strong', null, "« Sur l'écran d'accueil »"), ' (fais défiler la liste si besoin), puis ', h('strong', null, '« Ajouter »'), '.']),
      ])
      : h('ol', { class: 'steps' }, [
        h('li', null, ['Ouvre le menu du navigateur (', h('strong', null, '⋮'), ' en haut à droite dans Chrome).']),
        h('li', null, ['Choisis ', h('strong', null, "« Installer l'application »"), ' ou ', h('strong', null, "« Ajouter à l'écran d'accueil »"), '.']),
      ]);
    return h(Modal, { key: 'install', title: "Installer l'app", onClose: closeModal }, () => [
      h('p', null, "Le classeur s'ouvre alors depuis une icône de ton écran d'accueil, en plein écran, comme une app. C'est le même classeur : rien à télécharger d'un store."),
      how,
      h('h3', { class: 'install-h' }, IOS ? 'Au premier lancement (iPhone)' : 'Au premier lancement'),
      h('p', null, IOS
        ? "Sur iPhone, l'app ne voit pas ce que Safari a gardé : elle ne connaît pas encore ton classeur. Copie ton lien personnel maintenant, puis dans l'app choisis « J'ai déjà un lien » et colle-le."
        : "En général, l'app ouvre directement ton classeur. Si elle te demande ton lien, choisis « J'ai déjà un lien » et colle celui-ci :"),
      copyRow('install-link', personalLink.value, 'Ton lien personnel'),
      h('p', { class: 'warn' }, 'Garde-le pour toi : quiconque a ce lien ouvre ton classeur.'),
      h('h3', { class: 'install-h' }, 'Pour mettre à jour ta collection'),
      h('p', null, "Rien à faire dans l'app : une fois ton compte du jeu relié (onglet « Synchro »), le classeur lit ta collection tout seul. La liaison, elle, se fait dans une fenêtre privée du navigateur, pas dans l'app."),
      foot([closeBtn('Fermer')]),
    ]);
  }
  const lastSyncBad = () => { const ls = S.me && S.me.last_sync; return !S.refresh.running && ls && (ls.result === 'error' || ls.result === 'warn') ? ls : null; };
  // Sous-vue ouverte : le retour du haut fait ce que faisait le « ← … » du contenu (caché sur téléphone).
  function mobileBack() {
    const fr = S.friends;
    if (S.tab === 'collections' && S.album) {
      const col = activeAlbum.value;
      return { title: col ? col.name : 'Collection', label: 'Toutes les collections', run: closeAlbum };
    }
    if (S.tab === 'amis') {
      const f = fr.open ? friendList.value.find((x) => x.id === fr.open) : null;
      const name = f ? friendName(f) : '';
      if (fr.album) return { title: (friendAlbum.value && friendAlbum.value.name) || 'Collection', label: name ? `Classeur de ${name}` : 'Retour', run: closeFriendAlbum };
      if (fr.open) return { title: name ? `Classeur de ${name}` : 'Classeur', label: 'Entre amis', run: closeFriendBinder };
    }
    return null;
  }
  function mobileGo(tab) {
    S.mMore = false;
    S.mFacets = false;
    if (S.tab !== tab) { setTab(tab); return; }
    // Onglet déjà ouvert : retour à sa racine, puis en haut (comme une app).
    if (tab === 'collections' && S.album) closeAlbum();
    else if (tab === 'amis' && (S.friends.open || S.friends.page)) Object.assign(S.friends, { open: null, album: null, albumFrom: null, page: null });
    if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function viewMobileBar() {
    const back = mobileBack();
    const bad = lastSyncBad();
    const running = S.refresh.running;
    const sess = (S.me && S.me.session) || {};
    return h('header', { class: ['mbar', 'm-only', { sub: !!back }] }, [
      back ? h('button', { class: 'mbar__back', type: 'button', 'aria-label': 'Retour : ' + back.label, onClick: back.run }, [icon('chev', 'flip')])
        : h('span', { class: 'mbar__mark', 'aria-hidden': 'true' }, [h('img', { src: '/assets/icon.svg', alt: '' })]),
      h('div', { class: 'mbar__title' }, [
        back ? h('span', { class: 'mbar__kicker' }, back.label) : null,
        h('span', { class: 'mbar__name' }, back ? back.title : M_TITLE[S.tab] || 'Le classeur'),
      ]),
      h('button', { class: ['mbar__act', { bad: !!bad, err: S.refresh.error }], type: 'button', disabled: running,
        'aria-label': running ? 'Rafraîchissement en cours' : (sess.linked ? 'Rafraîchir la collection' : 'Relier mon compte du jeu'),
        onClick: refreshCollection }, [icon('refresh', running ? 'spin' : ''), bad || S.refresh.error ? h('i', { class: 'mbar__dot', 'aria-hidden': 'true' }) : null]),
      S.refresh.msg ? h('p', { class: ['mbar__status', { err: S.refresh.error, warn: S.refresh.warn }], 'aria-live': 'polite' }, [
        h('span', null, S.refresh.msg),
        S.refresh.error && !running && !sess.linked ? h('button', { class: 'linkish', type: 'button', onClick: openSyncTab }, 'Relier mon compte') : null,
      ]) : null,
    ]);
  }
  // Accueil de « Collections » sur téléphone : la synthèse du bandeau, en une carte compacte.
  function viewMobileSummary() {
    const total = cards.value.length;
    const name = S.me && S.me.user && S.me.user.name;
    const bad = lastSyncBad();
    const counts = rarityCount.value;
    const nCol = collections.value.mine.length;
    const fig = (n, l) => h('div', { class: 'mfig' }, [h('b', null, n), h('span', null, l)]);
    return h('section', { class: 'mhome m-only', 'aria-label': 'Ton classeur en bref' }, [
      h('h1', { class: 'mhome__title' }, name ? `Le classeur de ${name}` : 'Le classeur'),
      total ? h('div', { class: 'mhome__figs' }, [
        fig(fmt(total), plural(total, 'carte', 'cartes')),
        copies.value !== total ? fig(fmt(copies.value), 'exemplaires') : null,
        fig(fmt(nCol), plural(nCol, 'collection', 'collections')),
        M.value && M.value.priced ? h('div', { class: 'mfig' }, [priceTag(M.value.value), h('span', null, 'valeur')]) : fig(fmt(counts.L || 0), plural(counts.L || 0, 'légendaire', 'légendaires')),
      ]) : h('p', { class: 'small muted' }, S.loadingCards ? 'Chargement de ta collection…' : 'Ton classeur est vide : relie ton compte du jeu pour y amener ta collection.'),
      total ? h('div', { class: 'track mhome__track', role: 'img', 'aria-label': 'Répartition par rareté : ' + RAR_UP.map((r) => `${RARITY_NAME[r]} ${counts[r] || 0}`).join(', ') },
        RAR_UP.map((r) => (counts[r] ? h('i', { key: r, class: 'r' + r, style: { width: ((100 * counts[r]) / total).toFixed(3) + '%' } }) : null))) : null,
      bad ? h('button', { class: ['mhome__sync', bad.result === 'error' ? 'err' : 'warn'], type: 'button', onClick: () => mobileGo('maj') }, [
        h('span', null, [h('b', null, `Dernière synchro ${bad.result === 'error' ? 'en échec' : 'incomplète'}`), ` · ${syncWhen(bad.at)}`]), icon('chev', 'sm')])
        : !total ? h('button', { class: 'btn primary', type: 'button', onClick: () => mobileGo('maj') }, [icon('link', 'sm'), 'Relier mon compte']) : null,
    ]);
  }
  function viewMobileNav() {
    const inMore = M_MORE.some(([id]) => id === S.tab);
    const unread = S.tab === 'chat' ? 0 : chatUnread.value;
    const pings = unread ? chatUnreadPings.value : 0;
    const moreDot = newsUnseen.value || !!lastSyncBad();
    return h('nav', { class: ['mnav', 'm-only', { hide: S.mFacets && S.tab === 'cartes' }], 'aria-label': 'Sections' }, [
      ...M_NAV.map(([id, label, ic]) => h('button', { key: id, class: ['mnav__item', { on: S.tab === id && !S.mMore }], type: 'button', 'aria-current': S.tab === id ? 'page' : null, onClick: () => mobileGo(id) }, [
        h('span', { class: 'mnav__ic' }, [icon(ic), id === 'chat' && unread ? h('span', { class: ['mnav__badge', { ping: pings }] }, [pings ? '@' : '', unread > 99 ? '99+' : String(unread),
          sr(` ${plural(unread, 'message non lu', 'messages non lus')}`)]) : null]),
        h('span', { class: 'mnav__label' }, label),
      ])),
      h('button', { class: ['mnav__item', { on: S.mMore || inMore }], type: 'button', 'aria-expanded': String(S.mMore), 'aria-controls': 'mmore', onClick: () => { S.mFacets = false; S.mMore = !S.mMore; } }, [
        h('span', { class: 'mnav__ic' }, [icon('more'), moreDot ? h('i', { class: 'mnav__dot', 'aria-hidden': 'true' }) : null]),
        h('span', { class: 'mnav__label' }, inMore && !S.mMore ? M_TITLE[S.tab] : 'Plus'),
      ]),
    ]);
  }
  function viewMobileMore() {
    if (!S.mMore) return null;
    const bad = lastSyncBad();
    return h('div', { class: 'msheet-wrap m-only' }, [
      h('div', { class: 'msheet-backdrop', onClick: () => { S.mMore = false; } }),
      h('div', { id: 'mmore', class: 'msheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Plus' }, [
        h('span', { class: 'msheet__grab', 'aria-hidden': 'true' }),
        h('ul', { class: 'mmore' }, M_MORE.map(([id, label, ic, hint]) => {
          const flag = id === 'nouveautes' && newsUnseen.value ? 'nouveau' : id === 'maj' && bad ? (bad.result === 'error' ? 'échec' : 'incomplète') : '';
          return h('li', { key: id }, [h('button', { class: ['mmore__row', { on: S.tab === id }], type: 'button', 'aria-current': S.tab === id ? 'page' : null, onClick: () => mobileGo(id) }, [
            h('span', { class: 'mmore__ic' }, [icon(ic)]),
            h('span', { class: 'mmore__text' }, [h('b', null, label), h('span', null, hint)]),
            flag ? h('span', { class: ['mmore__flag', { warn: id === 'maj' }] }, flag) : null,
            icon('chev', 'sm mmore__chev'),
          ])]);
        })),
        STANDALONE ? null : h('button', { class: 'mmore__install', type: 'button', onClick: openInstall }, [
          h('img', { src: '/assets/apple-touch-icon.png', alt: '', width: 40, height: 40 }),
          h('span', { class: 'mmore__text' }, [h('b', null, "Installer l'app"), h('span', null, "Le classeur sur ton écran d'accueil, en plein écran")]),
          icon('chev', 'sm mmore__chev'),
        ]),
        h('p', { class: 'mmore__note' }, 'Outil personnel, sans lien avec le jeu. Les cartes viennent de ta collection, les illustrations de Wikimedia Commons, les listes et les catégories de Wikipédia et de Wikidata.'),
      ]),
    ]);
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
  // Mode réorganisation de « Mes collections » (S.colOrder) : une ligne compacte par collection (poignée, numéro, éventail,
  // nom, « 12 sur 40 »), « ↑ » / « ↓ » / « En tête » / « À la fin », « Annuler » et « Enregistrer l'ordre ».
  function viewColOrder(r) {
    const byId = new Map(collections.value.mine.map((c) => [c.id, c]));
    const ids = colOrderIds(r);
    const n = ids.length;
    const btn = (id, act, label, text, off) => h('button', { class: 'co-move', type: 'button', 'data-act': act, disabled: r.busy, 'aria-disabled': off ? 'true' : null,
      'aria-label': label, title: label, onClick: () => { if (!off) colMove(id, act); else { r.said = act === 'up' || act === 'first' ? `« ${colName(id)} » est déjà en tête.` : `« ${colName(id)} » est déjà à la fin.`; r.saidN++; } } }, text);
    return h('section', { class: 'group colorder', 'aria-labelledby': 'h-mine' }, [
      h('div', { class: 'section-head' }, [
        h('h2', { id: 'h-mine', tabindex: '-1' }, 'Mes collections'),
        h('span', { class: 'badge' }, 'Réorganisation'),
        h('span', { class: 'spacer' }),
        h('span', { class: ['small', 'muted', 'co-state'] }, r.dirty ? 'Ordre modifié, pas encore enregistré' : 'Ordre inchangé'),
        h('button', { class: 'btn', type: 'button', disabled: r.busy, onClick: cancelColOrder }, 'Annuler'),
        h('button', { class: 'btn primary', type: 'button', disabled: r.busy || !r.dirty, 'aria-busy': r.busy ? 'true' : null, onClick: saveColOrder },
          r.busy ? 'Enregistrement…' : 'Enregistrer l\'ordre'),
      ]),
      h('p', { class: 'hint', id: 'colorder-help' }, [
        'Glisse une collection à sa place (au doigt, par sa poignée ', icon('grip', 'sm'), sr('poignée'), '), ou utilise ↑ et ↓. ',
        'Rien n\'est envoyé avant « Enregistrer l\'ordre ».',
      ]),
      errLine(r.error),
      h('div', { class: 'co-wrap' }, [
        h('ol', { class: ['co-list', { dragging: r.drag != null }], 'aria-label': 'Ordre de tes collections', 'aria-describedby': 'colorder-help', onPointerdown: coPointerDown }, ids.map((id, i) => {
          const col = byId.get(id);
          if (!col) return null;
          const p = progressOf(col);
          return h('li', { class: ['co-row', { lifted: r.drag === id }], key: id, 'data-id': id }, [
            h('span', { class: 'co-grip', title: 'Glisser pour déplacer', 'aria-hidden': 'true' }, [icon('grip')]),
            h('span', { class: 'co-no num', 'aria-hidden': 'true' }, fmt(i + 1)),
            h('span', { class: 'fan', 'aria-hidden': 'true' }, p.sample.length ? p.sample.map(viewMini) : [h('span', { class: 'mini empty' })]),
            h('span', { class: 'co-info' }, [h('span', { class: 'name' }, col.name), h('span', { class: 'small muted' }, `${fmt(p.own)} sur ${fmt(p.total)}`)]),
            h('span', { class: 'co-moves' }, [
              btn(id, 'first', `« ${col.name} » : en tête`, 'En tête', i === 0),
              btn(id, 'up', `« ${col.name} » : une place plus haut`, '↑', i === 0),
              btn(id, 'down', `« ${col.name} » : une place plus bas`, '↓', i === n - 1),
              btn(id, 'last', `« ${col.name} » : à la fin`, 'À la fin', i === n - 1),
            ]),
          ]);
        })),
        h('span', { class: 'co-mark', 'aria-hidden': 'true' }),
      ]),
      h('p', { class: 'sr', role: 'status' }, r.said ? [h('span', { key: r.saidN }, r.said)] : []),
    ]);
  }
  function viewCollections() {
    const { mine } = collections.value;
    if (S.colOrder && mine.length) return h('div', { class: 'groups' }, [viewColOrder(S.colOrder)]);
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
          mine.length > 1 ? h('button', { id: 'colorder-btn', class: 'btn', type: 'button', title: "Changer l'ordre de tes collections", onClick: startColOrder }, [icon('move', 'sm'), 'Réorganiser']) : null,
          mine.length ? add('Nouvelle collection') : null,
        ]),
        mine.length ? h('div', { class: 'rows' }, mine.map(viewRow))
          : h('div', { class: 'empty-box' }, [
            h('p', null, "Aucune collection pour l'instant. Crée-en une depuis l'adresse d'une page ou d'une catégorie de Wikipédia, par mots-clés, avec une liste d'articles, parmi les propositions faites d'après tes cartes, ou depuis les cartes du jeu."),
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
      if (isLabel(it) || findCard(it)) continue;
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
      // « Modifier » et « Réorganiser » visibles ; le reste dans le menu « Plus » (2026-10-28 : en-tête allégé).
      actions = [
        h('button', { class: 'btn', type: 'button', onClick: () => openEditor(col.t) }, [icon('pen', 'sm'), 'Modifier']),
        // « Réorganiser » (2 éléments au moins) ; « Réorganiser… » d'une collection sans ordre : pourquoi (explainUnordered).
        viewReorderButton(col),
        moreMenu([
          h('button', { class: 'btn', type: 'button', onClick: () => openTagAdd(col) }, [icon('tag', 'sm'), 'Ajouter par tags du jeu']),
          // « Fusionner avec… » : seulement s'il y a une autre collection avec qui fusionner.
          targets.value.length > 1 ? h('button', { class: 'btn', type: 'button', onClick: () => openMerge(col.t) }, [icon('merge', 'sm'), 'Fusionner avec…']) : null,
          // Faite des tableaux d'une page : la rouvrir pour en faire une autre collection (d'autres sections, tout ensemble).
          col.page && col.column ? h('button', { class: 'btn', type: 'button', onClick: () => openPage(col.page, true) }, [icon('plus', 'sm'), 'Autres sections de la page']) : null,
          col.cat ? wpLink(CAT_NS + catName(col.t.source)) : col.page ? wpLink(col.page) : null,
          h('button', { class: 'btn danger', type: 'button', onClick: () => askDeleteTarget(col.t) }, [icon('trash', 'sm'), 'Supprimer']),
        ]),
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
        h('div', { class: 'album-top' }, [
          h('div', { class: ['album-title', { complete: done }] }, [h('h2', { id: 'album-name', tabindex: '-1' }, col.name), reading ? null : h('span', { class: 'num' }, `${fmt(p.own)} sur ${fmt(p.total)}`),
            done ? doneMark() : null,
            w && w.priced ? h('span', { class: 'album-value' }, ['Valeur : ', priceTag(w.value), ` (${pricedOf(w.priced, w.cards)})`]) : null,
            cv ? h('span', { class: 'badge' }, pg ? 'page de Wikipédia' : 'catégorie de Wikipédia') : sourceKind(col)]),
          h('div', { class: 'toolbar album-actions' }, actions),
        ]),
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
        // Le détail (raretés de ce que tu as et de ce qui manque, prix pour la compléter) et les réglages de synchro avec le
        // jeu : deux volets repliés sous la barre (2026-10-28, demande de l'utilisateur : « accessibles mais pas le main
        // focus »), leur résumé dans leur titre.
        reading ? null : h('div', { class: 'album-meta' }, [
          h('details', { class: 'album-fold' }, [
            h('summary', null, [icon('chev', 'sm'), h('span', { class: 'album-fold__sum' }, [
              missing > 0 ? [h('b', null, fmt(missing)), ` ${plural(missing, 'manque', 'manquent')}`] : p.total ? 'Complète' : 'Vide',
              w && w.costPriced ? [' · pour la compléter ', priceTag(w.cost, { about: true, tag: 'span' })] : null,
              problems ? ` · ${fmt(problems)} à vérifier` : null,
            ]), h('span', { class: 'album-fold__more' }, 'Détail')]),
            h('div', { class: 'album-fold__body' }, [
              ownLine ? h('div', { class: 'missing-sum' }, ownLine) : null,
              h('div', { class: 'missing-sum' }, missLine),
              w && w.costPriced ? h('div', { class: 'missing-sum worth-sum', title: "Pour chaque carte qui manque, la moins chère de ses cotes fiables (3 ventes au moins), toutes raretés d'exemplaire confondues : n'importe quel exemplaire remplit la case. Cotes connues : celles des cartes que le classeur a trouvées dans le jeu." }, [
                h('span', null, ['Pour la compléter : ', priceTag(w.cost, { about: true })]),
                h('span', null, `(${pricedOf(w.costPriced, w.missing)} qui ${plural(w.missing, 'manque', 'manquent')}, à la moins chère de leurs cotes)`),
              ]) : null,
              missing > 0 ? h('p', { class: 'hint', 'aria-live': 'polite' }, hint) : null,
            ]),
          ]),
          cv ? null : h('details', { class: 'album-fold' }, [
            h('summary', null, [icon('chev', 'sm'), h('span', { class: 'album-fold__sum' }, ['Synchro avec le jeu', ...gameChips(col)]), h('span', { class: 'album-fold__more' }, 'Régler')]),
            h('div', { class: 'album-fold__body' }, [
              viewAutoLine(col),
              h('div', { class: ['album-sync', { 'album-sync--single': S.me && S.me.wish_mode === 'all' }] }, [viewTargetWish(col.t), viewAutoTag(col.t)]),
            ]),
          ]),
        ]),
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
  // Menu « Plus » (actions rares d'un album) : un <details> ; un clic ailleurs ou Échap le referme.
  const moreMenu = (items) => h('details', { class: 'menu' }, [
    h('summary', { class: 'btn', 'aria-label': "Plus d'actions" }, [icon('more', 'sm'), 'Plus']),
    h('div', { class: 'menu__list' }, items),
  ]);
  const closeMenus = (keep) => { for (const m of document.querySelectorAll('details.menu[open]')) if (m !== keep) m.removeAttribute('open'); };
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('click', (e) => {
      const m = e.target && e.target.closest ? e.target.closest('details.menu') : null;
      // Un choix du menu le referme aussi (sauf le clic sur son bouton « Plus », qui l'ouvre ou le ferme lui-même).
      closeMenus(m && !(e.target.closest('.menu__list')) ? m : null);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(null); });
  }
  // Ce qui est actif entre cette collection et le jeu, en pastilles dans le titre du volet « Synchro avec le jeu ».
  function gameChips(col) {
    const t = col.t;
    if (!t) return [];
    const auto = col.kind === 'target' ? autoOf(t) : null;
    const chip = (label) => h('span', { class: 'gchip' }, label);
    const out = [];
    if (S.me && S.me.wish_mode !== 'all' && t.wish_sync) out.push(chip('souhaits'));
    if (t.auto_tag && t.auto_tag.enabled && t.auto_tag.tag) out.push(chip('tag « ' + t.auto_tag.tag + ' »'));
    if (t.auto_favorite) out.push(chip('favoris'));
    if (auto) out.push(chip('ajout automatique'));
    return out.length ? out : [h('span', { class: 'gchip off' }, 'rien d\'actif')];
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
          'Un intercalaire garde son rôle : il ouvre toujours une nouvelle ligne. Un intercalaire libre (un nom, sans carte) s\'ajoute ci-dessous, avant la carte choisie. Choisis un intercalaire pour trier d\'un coup les cartes de sa section (rareté, A → Z…). Rien n\'est envoyé avant « Enregistrer l\'ordre ».',
        ]),
        h('form', { class: 'reorder-add', onSubmit: (e) => { e.preventDefault(); addLabel(); } }, [
          h('label', { class: 'sr', for: 'reorder-label' }, "Nom de l'intercalaire libre"),
          h('input', { id: 'reorder-label', class: 'field', value: r.label, maxlength: LABEL_MAX, autocomplete: 'off', placeholder: "Nom de l'intercalaire (Europe, Années 80…)",
            onInput: (e) => { r.label = e.target.value; } }),
          h('button', { class: 'btn small', type: 'submit', disabled: r.busy || !labelName(r.label) }, [icon('plus', 'sm'), 'Ajouter un intercalaire']),
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
          isLabel(item) ? h('form', { class: 'reorder-bar__pos reorder-bar__rename', onSubmit: (e) => { e.preventDefault(); renameLabel(k); } }, [
            h('label', { class: 'sr', for: 'reorder-rename' }, `Nouveau nom de l'intercalaire « ${item.title} »`),
            h('input', { id: 'reorder-rename', class: 'field', value: r.rename, maxlength: LABEL_MAX, autocomplete: 'off', placeholder: 'Nouveau nom',
              onInput: (e) => { r.rename = e.target.value; } }),
            h('button', { class: 'btn small', type: 'submit', disabled: r.busy || !labelName(r.rename) }, 'Renommer'),
          ]) : null,
          isLabel(item) ? h('button', { class: 'btn small danger', type: 'button', disabled: r.busy, onClick: () => removeLabel(k) }, 'Retirer') : null,
          item.sep ? h('form', { class: 'reorder-bar__pos reorder-bar__sort', onSubmit: (e) => { e.preventDefault(); sortSection(k); } }, [
            h('label', { class: 'sr', for: 'reorder-sort' }, `Ordre des cartes de la section « ${item.title} »`),
            h('select', { id: 'reorder-sort', class: 'field', value: r.sort, disabled: r.busy, onChange: (e) => { r.sort = e.target.value; } },
              SECTION_SORTS.map(([v, t]) => h('option', { value: v, selected: v === r.sort }, t))),
            h('button', { class: 'btn small', type: 'submit', disabled: r.busy }, 'Trier la section'),
          ]) : null,
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
    if (isLabel(it)) return h('span', { class: 'ro-art ro-art--label', 'aria-hidden': 'true' }, [h('span', { class: 'ro-label' }, it.title)]);
    const img = s.card ? artOf(s.card.title, s.card.image) : artOf(it.title, it.image || s.thumb);
    return h('span', { class: 'ro-art', 'aria-hidden': 'true' }, [
      h('span', { class: 'ro-noart' }, artCover() ? [viewCover(s.card ? s.card.category : it.description, it.title, 'mini')] : initialOf(it.title)),
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
    const label = isLabel(it);
    return h('li', { class: ['ro-tile', r ? 'r' + r : label ? 'ro-tile--label' : 'ro-tile--missing', { sep: !!it.sep, active, lifted }], 'data-k': String(s.k) }, [
      roArt(s),
      h('span', { class: 'ro-no' }, fmt(n)),
      h('span', { class: 'ro-grip', title: 'Glisser pour déplacer', 'aria-hidden': 'true' }, [icon('grip')]),
      h('span', { class: 'ro-title' }, [it.title, label ? sr(', intercalaire libre') : it.sep ? sr(', intercalaire') : null, c || label ? null : sr(', pas encore dans ta collection')]),
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
      h('div', { class: 'facets__mhead m-only' }, [
        h('span', { class: 'msheet__grab', 'aria-hidden': 'true' }),
        h('h2', null, 'Filtres'),
        h('button', { class: 'btn small primary', type: 'button', onClick: () => { S.mFacets = false; } }, `Voir ${cards$(filtered.value.length)}`),
      ]),
      h('div', { class: 'facet' }, [
        h('h3', null, 'Raccourcis'),
        h('div', { class: 'chips' }, [
          facetChip('untagged', 'Sans tag', untaggedCount.value, S.untaggedOnly, toggleUntagged),
          facetChip('duplicates', 'Doublons', duplicatesCount.value, S.duplicatesOnly, () => { S.duplicatesOnly = !S.duplicatesOnly; }, 'Cartes possédées en au moins deux exemplaires, toutes raretés et brillances confondues'),
          newIds.value.length ? facetChip('new', 'Nouvelles du dernier rafraîchissement', newIds.value.length, S.newOnly, toggleNew) : null,
        ]),
      ]),
      viewKeepFacet(),
      h('div', { class: 'facet' }, [
        h('h3', null, ['Tags du jeu', glist.length > 1 ? h('span', { class: 'hint-inline' }, 'Ctrl/⌘+clic : combiner') : null]),
        glist.length ? h('div', { class: 'chips' }, gshown.map((g) => h('button', { key: 'g:' + g.key, class: 'chip gchip', type: 'button', style: gtagStyle(g.color),
          'aria-pressed': String(S.gtagFilter.includes(g.key)), title: `Tag posé dans le jeu · Ctrl/⌘+clic : combiner`, onClick: (e) => toggleGtagFilter(g.key, e) },
        [h('span', { class: 'chip__label' }, g.label), h('span', { class: 'n' }, fmt(g.n))])))
          : h('p', { class: 'small muted' }, "Aucun tag du jeu lu pour l'instant : ceux que tu poses sur tes cartes dans wiki-masters.com arrivent avec la prochaine lecture de ta collection (onglet « Synchro »)."),
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
  // « Exclues des échanges et ventes » (prefs.keep) : le filtre, les tags exclus (« × » les réintègre) et un champ pour en
  // exclure un ; les cartes s'excluent une à une depuis la sélection ou leur fiche.
  function viewKeepFacet() {
    const k = keepPref.value;
    const tags = [...k.tags].sort((a, b) => COLLATOR.compare(tagTitle(a), tagTitle(b)));
    return h('div', { class: 'facet keep-facet' }, [
      h('h3', null, 'Exclues des échanges et ventes'),
      h('p', { class: 'small muted' }, "Jamais proposées dans « Échanges possibles » ni dans « Bonnes affaires à vendre », chez toi comme chez tes amis. Exclus des cartes depuis la sélection ou leur fiche, ou tout un tag :"),
      keptCount.value || S.keptOnly ? h('div', { class: 'chips' }, [facetChip('kept', 'Exclues', keptCount.value, S.keptOnly, () => { S.keptOnly = !S.keptOnly; S.tab = 'cartes'; },
        'Cartes exclues des échanges et des ventes, une à une ou par un tag')]) : null,
      tags.length ? h('div', { class: 'tags' }, tags.map((t) => h('span', { class: 'tag own', key: t, title: tagTitle(t) + ` · ${cards$(tagCount.value.get(t) || 0)}` }, [
        icon('lock', 'sm'), tagTitle(t),
        h('button', { type: 'button', class: 'x', 'aria-label': `Ne plus exclure le tag ${tagTitle(t)}`, onClick: () => removeKeepTag(t) }, [icon('x', 'sm')])]))) : null,
      h('form', { class: 'add-row', onSubmit: (e) => { e.preventDefault(); addKeepTag(S.keepTag); } }, [
        h('label', { class: 'sr', for: 'keep-tag' }, 'Tag à exclure des échanges et ventes'),
        h('input', { id: 'keep-tag', class: 'field', list: 'taglist', value: S.keepTag, maxlength: 60, autocomplete: 'off', placeholder: 'Tag à exclure…',
          onInput: (e) => { S.keepTag = e.target.value; } }),
        h('button', { class: 'btn small', type: 'submit', disabled: !S.keepTag.trim() }, 'Exclure'),
      ]),
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
      S.duplicatesOnly ? filterChip('duplicates', 'Doublons', () => { S.duplicatesOnly = false; }, 'Retirer le filtre Doublons') : null,
      S.keptOnly ? filterChip('kept', 'Exclues des échanges et ventes', () => { S.keptOnly = false; }, 'Retirer le filtre Exclues') : null,
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
        h('button', { class: 'btn primary', type: 'button', onClick: openSyncTab }, [icon('link', 'sm'), 'Relier mon compte du jeu']),
      ]);
    }
    const counts = rarityCount.value;
    const total = filtered.value.length;
    const shown = visibleCards.value.length;
    const nf = S.tagFilter.length + S.gtagFilter.length + (S.untaggedOnly ? 1 : 0) + (S.newOnly ? 1 : 0) + (S.duplicatesOnly ? 1 : 0) + (S.keptOnly ? 1 : 0);
    return h('div', { class: ['cards-layout', { 'm-facets': S.mFacets }] }, [
      S.mFacets ? h('div', { class: 'msheet-backdrop m-only', onClick: () => { S.mFacets = false; } }) : null,
      viewFacets(),
      h('div', { class: 'cards-main' }, [
        h('button', { class: ['btn', 'mfilter', 'm-only', { on: nf }], type: 'button', 'aria-expanded': String(S.mFacets), onClick: () => { S.mMore = false; S.mFacets = true; } },
          [icon('filter', 'sm'), 'Tags et filtres', nf ? h('span', { class: 'mfilter__n' }, String(nf)) : null]),
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

  // ================================================================ rendu : onglet Synchro
  function copyRow(id, value, label) {
    return h('div', { class: 'copy-row' }, [
      h('input', { id, class: 'field', readonly: true, value, 'aria-label': label, onFocus: (e) => e.target.select() }),
      h('button', { class: 'btn', type: 'button', disabled: !value, onClick: () => copy(value, id) }, [icon(S.copied === id ? 'check' : 'copy', 'sm'), S.copied === id ? 'Copié' : 'Copier']),
    ]);
  }
  // Compte du jeu relié : état, « Rafraîchir maintenant », « Synchro automatique », « Oublier la liaison ».
  function viewGameAccount() {
    const sess = (S.me && S.me.session) || {};
    const pseudo = S.me && S.me.user && S.me.user.pseudo;
    const ss = S.session;
    let state;
    if (sess.linked) {
      const when = [sess.checked_at ? `dernière vérification ${agoText(sess.checked_at)}` : '', sess.full_at ? `dernière lecture complète ${agoText(sess.full_at)}` : 'pas encore de lecture complète vérifiée'].filter(Boolean);
      state = [
        h('p', { class: 'session-line' }, [h('span', { class: ['dot', 'on'] }), `Compte du jeu relié${pseudo ? ` (${pseudo})` : ''}`]),
        h('p', { class: 'small muted' }, when.join(' · ') + '.'),
      ];
    } else if (sess.lost) {
      state = [
        h('p', { class: 'session-line' }, [h('span', { class: ['dot', 'off'] }), `À relier : ${sess.lost}`]),
        h('p', { class: 'small muted' }, "Le jeu a fermé la session du classeur (une déconnexion du jeu, sur n'importe lequel de tes appareils, la ferme aussi). Relie ton compte à nouveau, ci-dessous."),
      ];
    } else {
      state = [
        h('p', { class: 'session-line' }, [h('span', { class: 'dot' }), 'Aucun compte du jeu relié']),
        h('p', { class: 'small muted' }, "Relie-le une fois, ci-dessous : ensuite, le classeur lit ta collection tout seul dans la base du jeu, quel que soit l'appareil où tu joues."),
      ];
    }
    return h('div', { class: 'panel' }, [
      h('h2', null, 'Ton compte du jeu'),
      ...state,
      sess.linked ? h('div', { class: 'refresh-line' }, [
        h('button', { class: 'btn primary', type: 'button', disabled: S.refresh.running, onClick: runRefresh },
          [icon('refresh', S.refresh.running ? 'sm spin' : 'sm'), S.refresh.running ? 'Lecture…' : 'Rafraîchir maintenant']),
        h('span', { class: ['status', { err: S.refresh.error, warn: S.refresh.warn }], 'aria-live': 'polite' }, S.refresh.msg),
      ]) : null,
      sess.linked && sess.paused ? h('p', { class: 'notice warn-box', role: 'status' }, `Synchro automatique en pause après ${fmt(sess.fails)} échecs d'affilée : « Rafraîchir maintenant » la relance.`) : null,
      sess.linked ? h('label', { class: 'check' }, [
        h('input', { type: 'checkbox', id: 'set-auto-sync', checked: !!sess.auto_sync, disabled: S.auto.busy,
          onChange: (e) => { const want = e.target.checked; e.target.checked = !!sess.auto_sync; setAutoSync(want); } }),
        'Synchro automatique',
      ]) : null,
      sess.linked ? h('p', { class: 'small muted' }, "Toutes les 10 minutes, le classeur vérifie ta collection dans la base du jeu et la relit si elle a changé (au moins toutes les 6 h) ; les cotes toutes les 20 minutes. Décoche pour ne lire qu'au clic.") : null,
      errLine(S.auto.error),
      sess.linked || sess.lost ? h('div', { class: 'actions' }, [
        h('button', { class: 'btn danger', type: 'button', disabled: ss.busy, onClick: forgetSession }, 'Oublier la liaison'),
      ]) : null,
      sess.linked || sess.lost ? h('p', { class: 'small muted' }, "Le classeur efface sa session du jeu : il ne lit plus rien jusqu'à la prochaine liaison. Ton compte du jeu n'est pas touché.") : null,
    ]);
  }
  // « Relier mon compte » : le favori « Relier » (jeton à usage unique), et en secours le cookie collé ou un HAR, toujours
  // depuis une fenêtre privée.
  function viewLink() {
    const lk = S.link;
    const ss = S.session;
    const sess = (S.me && S.me.session) || {};
    const noSecret = !!(S.health && S.health.cookie_secret === false);
    const url = relierUrl.value;
    const expired = !!(lk.token && lk.until && Date.parse(lk.until) < Date.now());
    const off = noSecret || ss.busy;
    return h('div', { class: 'panel' }, [
      h('h2', null, sess.linked ? 'Relier à nouveau' : 'Relier mon compte du jeu'),
      h('p', null, "Le classeur garde sa propre session du jeu, ouverte dans une fenêtre privée : elle ne se mêle pas à celle de ton navigateur, où tu restes connecté. Elle ne sert qu'à lire ta collection et le marché : rien n'est écrit dans le jeu."),
      noSecret ? h('p', { class: 'warn' }, "La liaison est désactivée sur ce classeur : l'administrateur n'a pas encore réglé sa clé de chiffrement (COOKIE_SECRET).") : null,
      !url || expired ? h('div', { class: 'actions' }, [
        h('button', { class: sess.linked ? 'btn' : 'btn primary', type: 'button', disabled: lk.busy || noSecret, onClick: createLink },
          [icon('link', 'sm'), lk.busy ? 'Préparation…' : expired ? 'Refaire le favori' : 'Relier mon compte']),
      ]) : null,
      expired ? h('p', { class: 'warn', role: 'status' }, 'Ce favori a expiré (il vaut 30 minutes) : refais-en un.') : null,
      errLine(lk.error),
      url && !expired ? h('p', { class: 'bm-line' }, [h('a', { class: 'bookmarklet', href: url, title: 'Glisse-moi dans ta barre de favoris',
        onClick: (e) => { e.preventDefault(); lk.clicked = true; } }, [icon('bookmark'), 'Relier au classeur'])]) : null,
      url && !expired && lk.clicked ? h('p', { class: 'warn', role: 'status' }, 'Pas ici : glisse le bouton dans ta barre de favoris (ou copie son adresse), puis clique-le sur wiki-masters.com, dans ta fenêtre privée.') : null,
      url && !expired ? copyRow('link-url', url, 'Adresse du favori (téléphone : colle-la dans un favori)') : null,
      url && !expired ? h('ol', { class: 'steps' }, [
        h('li', null, ['Ouvre une ', h('strong', null, 'fenêtre privée'), ' (', h('kbd', null, 'Ctrl'), '+', h('kbd', null, 'Maj'), '+', h('kbd', null, 'N'), ', ',
          h('kbd', null, 'Ctrl'), '+', h('kbd', null, 'Maj'), '+', h('kbd', null, 'P'), ' sur Firefox, onglet privé sur téléphone) et connecte-toi à wiki-masters.com.']),
        h('li', null, 'Clique le favori « Relier au classeur » (ou colle son adresse dans la barre d\'adresse).'),
        h('li', null, ['Ferme la fenêtre privée ', h('strong', null, 'sans te déconnecter'), '.']),
      ]) : null,
      url && !expired ? h('p', { class: 'small muted' }, 'Le favori vaut 30 minutes et ne sert qu\'une fois : rien de durable ne reste dans ta barre.') : null,
      url && !expired ? h('p', { class: 'wait-line', role: 'status' }, [icon('refresh', 'spin'), ' En attente de la liaison… ce classeur se met à jour dès qu\'elle est faite.']) : null,
      h('p', { class: 'small muted' }, "Pourquoi une fenêtre privée : le jeu renouvelle sa session régulièrement, et une session partagée entre ton navigateur et le classeur finit fermée des deux côtés. Se déconnecter du jeu, sur n'importe quel appareil, ferme aussi celle du classeur : il faudra relier à nouveau."),
      h('details', { class: 'secours' }, [
        h('summary', null, 'En secours : coller le cookie ou déposer un HAR'),
        h('p', { class: 'small muted' }, ['Depuis une fenêtre privée connectée au jeu : outils de développement (', h('kbd', null, 'F12'), ') → Réseau → une requête vers wiki-masters.com → en-tête ',
          h('code', null, 'Cookie'), '. Copie sa valeur et colle-la ici, puis ferme la fenêtre privée sans te déconnecter.']),
        h('label', { class: 'sr', for: 'cookie-input' }, 'Valeur de l\'en-tête Cookie'),
        h('textarea', { id: 'cookie-input', rows: 3, value: ss.cookie, disabled: off, spellcheck: 'false', autocomplete: 'off',
          placeholder: 'sb-…-auth-token.0=…; sb-…-auth-token.1=…', onInput: (e) => { ss.cookie = e.target.value; } }),
        h('label', { class: ['drop', { disabled: noSecret }] }, [h('strong', null, 'Ou dépose un export HAR'), h('span', { class: 'muted' }, 'fichier .har de l\'onglet Réseau de ta fenêtre privée, ou clique pour le choisir'),
          h('input', { type: 'file', accept: '.har,application/json', disabled: off, onChange: uploadHar })]),
        h('p', { class: 'small muted' }, "Du fichier HAR, seuls l'adresse et le cookie des requêtes vers wiki-masters.com sont envoyés ; le reste ne quitte pas ton navigateur. Dans Chrome ou Edge, l'export par défaut retire les cookies : choisis l'export « avec données sensibles »."),
        errLine(ss.error),
        h('div', { class: 'actions' }, [
          h('button', { class: 'btn', type: 'button', disabled: off || !ss.cookie.trim(), onClick: submitCookie }, ss.busy ? 'Liaison…' : 'Relier avec ce cookie'),
        ]),
      ]),
    ]);
  }
  // « Dernières synchros » (journal des synchros) : heure, chemin et type, résultat, message lisible ; les 20 plus récentes.
  function viewSyncLog() {
    const list = syncLog.entries;
    const rows = (list || []).slice(0, 20);
    let body;
    if (list === null) body = h('p', { class: 'small muted', role: 'status' }, syncLog.busy ? 'Lecture du journal…' : '');
    else if (!rows.length) body = h('p', { class: 'small muted' }, "Aucune synchro notée pour l'instant : les lectures de ta collection (au clic ou automatiques) et la liaison de ton compte apparaîtront ici, réussies ou non. Une vérification sans changement n'est pas notée.");
    else body = h('ul', { class: 'synclog-list' }, rows.map((x, i) => viewSyncRow(x, i)));
    return h('div', { class: 'panel synclog', style: { gridColumn: '1 / -1' } }, [
      h('div', { class: 'synclog-head' }, [
        h('h3', null, 'Dernières synchros'),
        h('button', { class: 'btn small ghost', type: 'button', disabled: syncLog.busy, onClick: loadSyncLog }, [icon('refresh', syncLog.busy ? 'sm spin' : 'sm'), 'Actualiser']),
      ]),
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
    return h('div', { class: 'update' }, [
      STANDALONE ? h('p', { class: 'notice app-note' }, [h('strong', null, "Tu es dans l'app installée."), " Pour relier ton compte, il faut une fenêtre privée du navigateur : copie l'adresse du favori ci-dessous, puis colle-la dans un onglet privé de Safari ou Chrome où tu es connecté au jeu. Ensuite, l'app suit ta collection toute seule."]) : null,
      viewGameAccount(), viewLink(), viewSyncLog()]);
  }

  // ================================================================ rendu : palmarès
  const awards = reactive({ loading: false, error: '', data: null });
  let awardsRequest = 0;
  const AWARDS = [
    ['completed', '🏆', 'Le plus de collections complétées', 'Les collections partagées remplies à 100 %.', 'collection'],
    ['value', '💎', 'La carte la plus chère', 'La meilleure cote d’un exemplaire possédé, avec au moins 3 ventes.', 'W'],
    ['traded', '🤝', 'Les plus gros partageurs', 'Les cartes données dans les échanges acceptés, créés depuis l’application.', 'carte'],
    ['near', '🍹', 'À ça du bol de sangria', 'Les collections partagées entre 90 % et moins de 100 % : presque au bout !', 'collection'],
    ['chat', '💬', 'Le tchateur', 'Les messages envoyés dans le tchat, même après leur suppression.', 'message'],
  ];
  async function loadAwards() {
    const request = ++awardsRequest;
    const gen = cardsGen;
    awards.loading = true;
    awards.error = '';
    awards.data = null;
    try {
      const data = await api('GET', '/api/palmares');
      if (gen === cardsGen && request === awardsRequest) awards.data = data;
    } catch (e) { if (gen === cardsGen && request === awardsRequest) awards.error = e.message; }
    finally { if (request === awardsRequest) awards.loading = false; }
  }
  watch(() => S.boot === 'app' && S.tab === 'palmares' ? cardsGen + ':' + myPid() : '', (key) => { if (key) loadAwards(); else awards.data = null; });
  function viewAwards() {
    return h('section', { class: 'awards', 'aria-labelledby': 'awards-title', 'aria-busy': String(awards.loading) }, [
      h('div', { class: 'awards-head' }, [
        h('div', null, [h('p', { class: 'awards-eyebrow' }, 'LE CERCLE DES COLLECTIONNEURS'), h('h1', { id: 'awards-title' }, 'Palmarès'),
          h('p', { class: 'muted' }, 'Les petites victoires méritent leur podium.')]),
        h('button', { class: 'btn', disabled: awards.loading, onClick: loadAwards }, awards.loading ? 'Chargement…' : 'Actualiser'),
      ]),
      awards.error ? h('p', { class: 'notice', role: 'alert' }, [awards.error, ' ', h('a', { href: '#/reglages' }, 'Réglages')]) : null,
      awards.loading ? h('p', { class: 'muted', role: 'status' }, 'On prépare les podiums…') : null,
      awards.data ? h('div', { class: 'awards-grid' }, AWARDS.map(([id, emoji, title, description, unit]) => {
        const entries = (awards.data.categories.find((c) => c.id === id) || {}).entries || [];
        return h('article', { class: ['award', 'award--' + id], 'aria-labelledby': 'award-' + id, key: id }, [
          h('span', { class: 'award-symbol', 'aria-hidden': 'true' }, emoji),
          h('h2', { id: 'award-' + id }, title), h('p', { class: 'small muted' }, description),
          h('ol', { class: 'podium', 'aria-label': title }, [0, 1, 2].map((i) => {
            const entry = entries[i];
            return h('li', { class: ['podium-place', 'podium-place--' + (i + 1), { 'podium-place--empty': !entry }], key: i }, [
              h('div', { class: 'podium-person' }, [
                h('span', { class: 'podium-medal', 'aria-hidden': 'true' }, entry ? ['🥇', '🥈', '🥉'][Math.min(entry.rank - 1, 2)] : '○'),
                h('strong', { class: 'podium-name' }, entry ? entry.name : 'Place à prendre'),
                entry && entry.mine ? h('span', { class: 'podium-you' }, 'Toi') : null,
                entry ? h('span', { class: 'podium-score' }, unit === 'W' ? `${fmt(entry.score)} W` : `${fmt(entry.score)} ${unit}${entry.score > 1 ? 's' : ''}`) : null,
                entry && entry.card ? h('span', { class: 'podium-card', title: entry.card.title }, `${entry.card.title} · ${entry.card.variant}`) : null,
              ]),
              h('div', { class: 'podium-step' }, entry ? `${entry.rank}${entry.rank === 1 ? 'er' : 'e'}` : '—'),
            ]);
          })),
          !entries.length ? h('p', { class: 'small muted award-empty' }, 'Le premier podium attend ses champions.') : null,
        ]);
      })) : null,
      h('p', { class: 'small muted awards-note' }, 'Seuls les membres qui partagent leurs cartes participent. Les podiums de collections demandent aussi le partage des collections. Les ex æquo gardent le même rang ; trois membres sont affichés au maximum.'),
      h('p', { class: 'small muted' }, 'Collections : les listes « Lock Market », « À vendre » et « Autre / Autres » sont exclues des deux podiums de collections. Comparaison par titre, sans les intercalaires libres ni les articles non vérifiés. Un article renommé peut entraîner un écart avec la progression de son album.'),
      h('p', { class: 'small muted' }, 'Échanges : suivi à partir de l’ajout du palmarès, confirmation à la synchronisation du compte du jeu. Tchat : reprise des messages encore conservés, puis compteur permanent des nouveaux envois.'),
    ]);
  }

  // ================================================================ rendu : onglet Réglages
  // Réglages (2026-10-28, demande de l'utilisateur : « beaucoup trop chargée, pas organisée ») : cinq groupes, une ligne
  // par réglage (intitulé, phrase courte, contrôle à droite), le détail replié sous « En savoir plus » ; un sommaire
  // collant à gauche sur ordinateur, qui suit le défilement (S.settings.at).
  const SET_GROUPS = [['profil', 'Profil', 'k-person'], ['partage', 'Partage et amis', 'users'], ['jeu', 'Synchro avec le jeu', 'refresh'],
    ['apparence', 'Apparence', 'k-palette'], ['acces', 'Accès et sécurité', 'key']];
  const setMore = (kids) => h('details', { class: 'set-more' }, [h('summary', null, [icon('chev', 'sm'), 'En savoir plus']), h('div', { class: 'set-more__body' }, kids)]);
  const setTag = (t, warn) => h('span', { class: ['set-tag', { warn }] }, t);
  // Une ligne : à gauche l'intitulé et sa phrase, à droite le contrôle (un interrupteur : toute la ligne le bascule).
  function setRow(o) {
    const text = h('span', { class: 'set-row__text' }, [
      h('span', { class: 'set-row__title' }, [o.title, ...(o.tags || [])]),
      o.desc ? h('span', { class: 'set-row__desc' }, o.desc) : null,
    ]);
    const main = o.sw
      ? h('label', { class: 'set-row__main', for: o.sw.id }, [text, h('input', { type: 'checkbox', role: 'switch', class: 'switch', ...o.sw })])
      : h('div', { class: ['set-row__main', { 'set-row__main--stack': o.stack }] }, [text, o.control ? h('div', { class: 'set-row__ctl' }, o.control) : null]);
    return h('div', { class: ['set-row', { 'set-row--sub': o.sub }, o.cls || ''] }, [main, ...(o.after || []), o.more ? setMore(o.more) : null]);
  }
  function setGroup(id, kids, cls) {
    const g = SET_GROUPS.find((x) => x[0] === id);
    return h('section', { class: ['set-group', cls || ''], id: 'set-g-' + id, 'aria-labelledby': 'set-h-' + id }, [
      h('h2', { id: 'set-h-' + id }, g[1]),
      h('div', { class: 'set-list' }, kids),
    ]);
  }
  function goSetGroup(id) {
    S.settings.at = id;
    const el = document.getElementById('set-g-' + id);
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // Sommaire : le groupe dont le titre a passé le haut de l'écran (le dernier, tout en bas de la page).
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('scroll', () => {
      if (S.tab !== 'reglages') return;
      let at = SET_GROUPS[0][0];
      for (const [id] of SET_GROUPS) { const el = document.getElementById('set-g-' + id); if (el && el.getBoundingClientRect().top < 140) at = id; }
      const root = document.documentElement;
      if (root && window.innerHeight + window.scrollY >= root.scrollHeight - 4) at = SET_GROUPS[SET_GROUPS.length - 1][0];
      if (S.settings.at !== at) S.settings.at = at;
    }, { passive: true });
  }
  function knownLabel(k) { return k.name ? `Classeur de ${k.name}` : 'Classeur sans prénom'; }
  function viewSettings() {
    const st = S.settings;
    const others = S.known.filter((k) => k.key !== S.key);
    const linked = !!(S.me && S.me.session && S.me.session.linked && !S.me.session.lost);
    const at = st.at || 'profil';
    const nav = h('nav', { class: 'set-nav', 'aria-label': 'Groupes de réglages' }, SET_GROUPS.map(([id, label, ic]) => h('button', {
      key: id, type: 'button', class: { on: at === id }, 'aria-current': at === id ? 'true' : null, onClick: () => goSetGroup(id),
    }, [icon(ic, 'sm'), label])));
    const textForm = (id, value, attrs, onInput, onSave, busy) => h('form', { class: 'line set-form', onSubmit: (e) => { e.preventDefault(); onSave(); } }, [
      h('input', { id, class: 'field', value, ...attrs, onInput: (e) => onInput(e.target.value) }),
      h('button', { class: 'btn', type: 'submit', disabled: busy }, busy ? 'Enregistrement…' : 'Enregistrer'),
    ]);
    const sw = (id, checked, disabled, set) => ({ id, checked, disabled, onChange: (e) => { const want = e.target.checked; e.target.checked = checked; set(want); } });
    return h('div', { class: 'settings' }, [
      nav,
      h('div', { class: 'set-body' }, [
        setGroup('profil', [
          setRow({ title: h('label', { for: 'set-name' }, 'Ton prénom'), desc: 'Comment les autres membres te voient.', stack: true,
            control: [textForm('set-name', st.name, { maxlength: 60, autocomplete: 'given-name' }, (v) => { st.name = v; st.saved = false; }, saveName, st.busy)],
            after: [st.saved ? h('p', { class: 'status ok', role: 'status' }, 'Enregistré.') : null, errLine(st.error)] }),
          setRow({ title: h('label', { for: 'set-pseudo' }, 'Ton pseudo dans WikiMasters'), desc: 'Pour que tes amis te trouvent dans le jeu.', stack: true,
            control: [textForm('set-pseudo', st.pseudo, { maxlength: 40, autocomplete: 'nickname', spellcheck: 'false', placeholder: 'Ton pseudo dans le jeu' },
              (v) => { st.pseudo = v; st.pSaved = false; }, savePseudo, st.pBusy)],
            after: [st.pSaved ? h('p', { class: 'status ok', role: 'status' }, st.pseudo ? 'Enregistré.' : 'Pseudo retiré.') : null, errLine(st.pError)],
            more: [h('p', null, "Visible par les membres avec qui tu partages tes cartes (« Entre amis »), avec un lien vers ton profil du jeu : pour qu'ils te trouvent et t'envoient des échanges.")] }),
        ]),
        setGroup('partage', [
          setRow({ title: 'Montrer mes cartes aux autres membres du classeur', desc: 'Réciproque : tu vois les leurs si tu montres les tiennes.',
            sw: sw('set-shared', sharing(), S.friends.shareBusy, setShared),
            after: [errLine(S.friends.shareError)],
            more: [h('p', null, 'Tu ne vois les cartes des autres membres (onglet « Entre amis ») que si tu montres les tiennes. Désactivé par défaut.'), h('p', null, SHARE_WHAT)] }),
          sharing() ? setRow({ sub: true, title: 'et mes collections à compléter', desc: 'Tes amis voient ce qui te manque.',
            sw: sw('set-shared-targets', sharingTargets(), S.friends.shareBusy, setSharedTargets),
            more: [h('p', null, SHARE_TARGETS_WHAT)] }) : null,
          setRow({ title: "Envoyer une demande d'ami aux membres du classeur", desc: "Le jeu n'accepte les échanges qu'entre amis.", tags: [setTag('à ta place', true)],
            sw: sw('set-auto-friend', !!(S.me && S.me.auto_friend), S.autoFriend.busy, setAutoFriend),
            after: [linked ? h('div', { class: 'set-row__extra' }, [h('button', { class: 'btn small', type: 'button', onClick: () => openFriendsAdd(false) }, 'Ajouter les membres pas encore amis…')]) : null,
              errLine(S.autoFriend.error)],
            more: [h('p', null, "Coché, le classeur envoie seul, depuis ton compte du jeu relié, une demande d'ami à chaque membre qui relie le sien (et à ceux déjà là), une seule fois par membre, pendant les lectures automatiques. Il n'accepte jamais une demande à ta place : ça se fait dans le jeu. C'est une action faite à ta place, que le jeu peut remarquer. Désactivé par défaut.")] }),
        ]),
        setGroup('jeu', [
          setRow({ title: h('label', { for: 'set-wish-mode' }, 'Liste de souhaits du jeu'), desc: 'Les cartes qui manquent à tes collections, mises en souhaits dans le jeu.', stack: true,
            control: [h('select', { id: 'set-wish-mode', class: 'field', value: S.me && S.me.wish_mode || 'selected', disabled: S.autoWish.busy || S.autoWish.syncBusy,
              onChange: (e) => { const mode = e.target.value; e.target.value = S.me && S.me.wish_mode || 'selected'; setWishMode(mode); } }, [
              h('option', { value: 'all' }, 'Toutes mes collections'),
              h('option', { value: 'selected' }, 'Collection par collection'),
            ]),
            linked ? h('button', { class: 'btn', type: 'button', disabled: S.autoWish.busy || S.autoWish.syncBusy, onClick: () => syncWish() },
              S.autoWish.syncBusy ? 'Mise à jour…' : 'Synchroniser les souhaits maintenant') : null],
            after: [
              linked ? null : h('p', { class: 'small muted' }, 'Relie ton compte du jeu dans « Synchro » pour appliquer ce choix.'),
              S.me && S.me.wish ? wishLine(S.me.wish) : null,
              S.autoWish.targetId === null && S.autoWish.msg ? h('p', { class: 'status ok', role: 'status' }, S.autoWish.msg) : null,
              S.autoWish.targetId === null ? errLine(S.autoWish.error) : null,
            ],
            more: [h('p', null, '« Toutes mes collections » synchronise les cartes manquantes de toutes tes collections et catégories, y compris les nouvelles. « Collection par collection » utilise les cases dans tes albums.'),
              h('p', null, 'Changer de mode conserve ces choix individuels ; les souhaits qui ne sont plus demandés sont retirés automatiquement. Toute carte déjà obtenue est retirée des souhaits, même ajoutée directement dans le jeu.')] }),
          setRow({ title: 'Lire le marché plus vite', desc: 'Les cotes à jour quatre fois plus vite.', tags: [setTag('essai'), setTag('risqué', true)],
            sw: sw('set-fast-sync', !!(S.me && S.me.fast_sync), S.fast.busy, setFastSync),
            after: [errLine(S.fast.error)],
            more: [h('p', null, "Une requête toutes les 250 ms au lieu d'une par seconde, et deux fois plus par passe (60 requêtes au lieu de 30). Le jeu pourrait remarquer ce rythme et limiter, voire sanctionner, ton compte : c'est un essai, à tes risques. Désactivé par défaut.")] }),
        ]),
        setGroup('apparence', [
          setRow({ cls: 'set-row--styles', title: 'Style des cartes', desc: CARD_STYLES.find((o) => o.id === cardStyle()).what, stack: true,
            after: [h('div', { class: 'cstyle', role: 'radiogroup', 'aria-label': 'Style des cartes' }, CARD_STYLES.map((o) => h('label', { key: o.id, class: ['cstyle__opt', { on: cardStyle() === o.id }] }, [
              h('input', { type: 'radio', name: 'card-style', id: 'set-card-style-' + o.id, value: o.id, 'aria-label': o.name, checked: cardStyle() === o.id, onChange: () => savePrefs({ card_style: o.id }) }),
              h('span', { class: 'cstyle__card' }, [viewCard(styleSample.value, false, false, o.id)]),
              h('span', { class: 'cstyle__name' }, o.name),
            ])))],
            more: [h('p', null, 'La finition monte avec la rareté (de mate pour une Commune à dorée et holo pour une Légendaire) ; une carte brillante est holo. À la souris, la carte penche et son reflet suit le pointeur. Gardé avec ton compte, sur tous tes appareils.')] }),
          setRow({ title: "Prendre l'image de Wikipédia en anglais quand elle est meilleure", desc: 'Personnages, affiches, pochettes : souvent sans image en français.', tags: [setTag('essai')],
            sw: { id: 'set-art-en', checked: !!S.prefs.art_en, onChange: (e) => savePrefs({ art_en: e.target.checked }) },
            more: [h('p', null, "Wikipédia en français n'accepte aucune image sous droits d'auteur : un personnage dessiné, une affiche de film, une pochette d'album ou un logo y sont remplacés par une photo libre (Homer Simpson en cosplay) ou par rien. Coché, le classeur prend l'image de l'article anglais quand ses rédacteurs l'ont préférée aux images libres, ou quand la carte n'a pas d'image. Seulement dans le classeur : la carte du jeu ne change pas. Désactivé par défaut.")] }),
          setRow({ title: 'Dessiner une couverture pour les cartes sans image', desc: "La nature de l'article et le drapeau de son pays, au lieu de l'initiale.", tags: [setTag('essai')],
            sw: { id: 'set-art-cover', checked: !!S.prefs.art_cover, onChange: (e) => savePrefs({ art_cover: e.target.checked }) },
            more: [h('p', null, "Coché, une carte sans image montre la nature de son article (personne, lieu, espèce, film…), lue dans sa description, et le drapeau du pays qu'elle nomme, au lieu de son initiale. Désactivé par défaut.")] }),
        ]),
        setGroup('acces', [
          setRow({ title: 'Ton lien personnel', desc: 'La clé de ton classeur, sans mot de passe : garde-le pour toi.', stack: true,
            control: [h('button', { class: 'btn', type: 'button', onClick: askRotate }, [icon('key', 'sm'), 'Changer ma clé'])],
            after: [copyRow('my-link', personalLink.value, 'Ton lien personnel')],
            more: [h('p', null, "Il ouvre ton classeur sur n'importe quel appareil. Range-le dans tes favoris ou un gestionnaire de mots de passe, et ne le partage pas."),
              h('p', null, "Un lien ouvert reste dans l'historique du navigateur : sur un appareil partagé, efface-le de l'historique, ou change ta clé.")] }),
          others.length ? setRow({ title: 'Autres classeurs ouverts dans ce navigateur', stack: true,
            after: [h('ul', { class: 'known' }, others.map((k) => h('li', { key: k.key, class: 'line' }, [
              h('span', { class: 'known-name' }, knownLabel(k)),
              h('button', { class: 'btn small', type: 'button', onClick: () => switchTo(k.key) }, 'Ouvrir'),
              h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Retirer de la liste : ' + knownLabel(k), onClick: () => forgetKnown(k.key) }, 'Retirer'),
            ])))] }) : null,
          setRow({ title: 'Ce navigateur', desc: "Lui faire oublier ta clé et ce qu'il garde du classeur.",
            control: [h('button', { class: 'btn', type: 'button', onClick: askForget }, 'Oublier ce navigateur')],
            more: [h('p', null, 'Utile sur un appareil partagé. Ton classeur reste intact : ton lien le rouvre.')] }),
          setRow({ cls: 'set-row--danger', title: 'Supprimer mon classeur', desc: 'Cartes rangées, tags, collections, session du jeu et messages du chat : tout est effacé, définitivement.',
            control: [h('button', { class: 'btn danger', type: 'button', onClick: askDeleteAccount }, [icon('trash', 'sm'), 'Supprimer mon classeur'])] }),
        ]),
      ]),
    ]);
  }

  // ================================================================ rendu : onglet Entre amis
  const SHARE_WHAT = 'Ce qui est montré : ton prénom, ton nombre de cartes, la date de ta dernière synchro et, pour chaque carte, son titre, sa rareté, tes exemplaires, si elle est brillante, son illustration et son lien Wikipédia. Jamais tes tags, tes clés ni la session du jeu reliée ; tes collections à compléter seulement si tu le choisis en plus.';
  const SHARE_TARGETS_WHAT = 'Avec « et mes collections à compléter » : le nom de chacune de tes collections (avec la mention « depuis la catégorie Wikipédia » pour celles faites d\'une catégorie) et les titres de leurs articles, pour que tes amis voient lesquelles de leurs cartes les complètent. Jamais leurs descriptions ni la recherche qui les a créées ; seulement aux membres qui montrent leurs cartes.';
  const TRADE_NOTE = 'Le classeur montre qui a quoi. « Proposer un échange » crée la proposition dans le jeu, à ton nom : rien ne bouge tant que ton ami ne l\'a pas acceptée dans le jeu.';
  const FRIEND_ROWS = 5; // lignes montrées par bloc avant « Voir les … »
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
  // Un membre (2026-10-28, page « Entre amis » remise à plat) : carte compacte, prénom et pseudo en haut, ses chiffres en
  // pastilles avec « Parcourir son classeur », la synchro, le partage de ses collections et la valeur en pied.
  function viewMemberRow(f) {
    const st = friendStats.value.get(f.id);
    const fw = friendWorths.value.get(f.id);
    const chip = (n, label, cls) => h('span', { class: ['member__chip', cls || ''] }, [h('b', { class: 'num' }, fmt(n)), ' ' + label]);
    return h('article', { class: 'member', key: f.id }, [
      h('div', { class: 'member__top' }, [
        h('span', { class: 'avatar', 'aria-hidden': 'true' }, initialOf(friendName(f))),
        h('span', { class: 'member__who' }, [h('span', { class: 'name' }, friendName(f)), viewPseudo(f, 'pseudo-' + f.id)]),
      ]),
      h('div', { class: 'member__chips' }, [
        chip(f.count, plural(f.count, 'carte', 'cartes')),
        st ? chip(st.missing, `${plural(st.missing, 'carte', 'cartes')} que tu n'as pas`, 'new') : null,
        st && st.dup ? chip(st.dup, 'en double', 'dup') : null,
        h('button', { class: 'btn small member__open', type: 'button', disabled: !f.cards, onClick: () => openFriendBinder(f.id),
          'aria-label': `Parcourir le classeur de ${friendName(f)}` }, f.cards ? 'Parcourir son classeur' : 'Lecture…'),
      ]),
      h('p', { class: 'member__foot' }, [
        h('span', null, syncedOn(f)),
        f.tshare ? h('span', null, ['partage ses collections : ', h('b', null, fmt(f.tcount))]) : h('span', null, 'ne partage pas ses collections'),
        fw && fw.priced ? h('span', { title: FRIEND_WORTH }, ['valeur ', priceTag(fw.value), ` (${pricedOf(fw.priced, fw.cards)})`]) : null,
      ]),
    ]);
  }
  // Tête repliable d'un bloc (« Pour toi », « Pour tes amis ») : le chevron replie sa liste (S.friends.more['shut:…']).
  function fcolFold(key, name) {
    const shut = !!S.friends.more['shut:' + key];
    return h('button', { class: 'fcol__fold', type: 'button', 'aria-expanded': String(!shut), 'aria-label': (shut ? 'Déplier ' : 'Replier ') + name,
      onClick: () => { S.friends.more = { ...S.friends.more, ['shut:' + key]: !shut }; } }, [icon('chev', 'sm')]);
  }
  function viewFillCol(x) {
    const key = 'col:' + x.col.key;
    const rows = S.friends.more[key] ? x.rows : x.rows.slice(0, FRIEND_ROWS);
    const p = progressOf(x.col);
    const shut = !!S.friends.more['shut:' + key];
    return h('article', { class: ['fcol', { shut }], key: x.col.key }, [
      h('div', { class: 'fcol__head' }, [
        fcolFold(key, x.col.name),
        h('button', { class: 'fcol__name', type: 'button', title: x.col.cat ? 'Ouvrir la catégorie' : 'Ouvrir la collection', onClick: () => openAlbum(x.col.kind, x.col.id) }, x.col.name),
        sourceKind(x.col),
        h('span', { class: 'fcol__sum' }, [h('b', null, fmt(x.rows.length)), ` ${plural(x.rows.length, 'case', 'cases')} à remplir chez tes amis`,
          ...(x.dup ? [' · ', h('b', null, fmt(x.dup)), ' en double'] : []), ` · tu en as ${fmt(p.own)} sur ${fmt(p.total)}`]),
      ]),
      shut ? null : h('ul', { class: 'fitems' }, rows.map((r) => h('li', { key: r.i }, [
        h('button', { class: 'fitem', type: 'button', 'aria-label': `${r.item.title} : chez ${holdersText(r.holders)}. Ouvrir la fiche`, onClick: (e) => openMissingFrom(r.item, e) }, [
          pill(r.holders[0].rarity), h('span', { class: 'fitem__title' }, r.item.title), holderChips(r.holders),
        ]),
      ]))),
      shut ? null : moreToggle(key, x.rows.length),
    ]);
  }
  function viewWant(x) {
    const key = 'want:' + x.f.id;
    const rows = S.friends.more[key] ? x.rows : x.rows.slice(0, FRIEND_ROWS);
    const shut = !!S.friends.more['shut:' + key];
    return h('article', { class: ['fcol', { shut }], key }, [
      h('div', { class: 'fcol__head' }, [
        fcolFold(key, friendName(x.f)),
        h('span', { class: 'fcol__name' }, friendWho(x.f)),
        // « 3 de tes cartes complètent « A », « B » et « C » » : ses collections concernées, les plus complétées d'abord.
        h('span', { class: 'fcol__sum' }, [h('b', null, fmt(x.rows.length)),
          ` de tes cartes ${plural(x.rows.length, 'complète', 'complètent')} ${namesText(rankNames(x.rows, (r) => r.cols.map((c) => c.name)), true)}`,
          ...(x.dup ? [' · ', h('b', null, fmt(x.dup)), ' que tu as en double'] : [])]),
      ]),
      shut ? null : h('ul', { class: 'fitems' }, rows.map((r) => h('li', { key: r.card.id }, [
        // Ta carte ouvre sa fiche ; le nom de chaque collection de l'ami, son album (deux boutons côte à côte).
        h('div', { class: 'fitem fitem--split', role: 'group', 'aria-label': `${r.card.title}, pour ${friendName(x.f)} (${colsText(r.cols, ', ')})` }, [
          h('button', { class: 'fitem__main', type: 'button', 'aria-label': `${r.card.title}, pour ${friendName(x.f)} (${colsText(r.cols, ', ')}). Ouvrir ta carte`, onClick: (e) => openCardFrom(r.card.id, e) }, [
            pill(r.card.rarity), h('span', { class: 'fitem__title' }, r.card.title),
            r.card.count > 1 ? h('span', { class: 'holder dup' }, ['tu en as ', h('b', null, '×' + fmt(r.card.count))]) : null,
          ]),
          h('span', { class: 'fitem__cols' }, colLinks(x.f, r.cols, null)),
        ]),
      ]))),
      shut ? null : moreToggle(key, x.rows.length),
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
      favLocked(r.card) ? h('span', { class: 'fitem__fav', title: "Favori dans le jeu : le jeu refuse de l'échanger" }, 'favori') : null,
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
  // Un sens d'une paire : « Toi → Paul » (avec « Tu donnes » / « Tu reçois » quand tu y es) et son nombre de cartes, son
  // résumé, ses lignes ; x et z : qui donne, qui reçoit ; p : ce sens (null : rien dans ce sens, et pourquoi).
  function viewTradeSide(x, z, p) {
    const role = x.me ? 'Tu donnes' : z.me ? 'Tu reçois' : null;
    const head = h('h3', { class: 'trade__dir' }, [
      h('span', { class: 'trade__who' }, [personWho(x), h('span', { class: 'trade__arrow', 'aria-hidden': 'true' }, ' → '), h('span', { class: 'sr' }, ' pour '), personWho(z)]),
      role ? h('span', { class: 'trade__role' }, role) : null,
      h('span', { class: 'trade__count num' }, cards$(p ? p.rows.length : 0)),
    ]);
    if (!p) {
      const hiddenZ = z.f && trades.value.hidden.includes(z.f);
      const dup = tradeDupOn() ? 'en double ' : '';
      const why = hiddenZ ? `${friendName(z.f)} ne partage pas ses collections : impossible de savoir ce qui lui manque.`
        : `${x.me ? "Tu n'as" : friendName(x.f) + " n'a"} aucune carte ${dup}qui manque aux collections ${z.me ? 'que tu partages' : 'de ' + friendName(z.f)}.`;
      return h('section', { class: 'trade__side trade__side--empty', key: x.id + '>' + z.id }, [head, h('p', { class: 'trade__none' }, why)]);
    }
    const key = 'trade:' + p.key;
    const rows = S.friends.more[key] ? p.rows : p.rows.slice(0, FRIEND_ROWS);
    return h('section', { class: 'trade__side', key: p.key }, [
      head,
      h('p', { class: 'fcol__sum' }, tradeSum(p)),
      h('ul', { class: 'fitems' }, rows.map((r) => h('li', { key: r.card.id, class: { locked: favLocked(r.card) } }, [viewTradeRow(p, r)]))),
      moreToggle(key, p.rows.length),
    ]);
  }
  // Les deux sens d'une paire dans sa tuile de la liste : « Toi → Paul  10 (3 en double) », « Paul → Toi  0 ».
  function viewDuoCounts(d) {
    const line = (x, z, p) => h('span', { class: ['duos__dir', { none: !p }] }, [
      h('span', { class: 'duos__way' }, [personOf(x), h('span', { class: 'trade__arrow', 'aria-hidden': 'true' }, ' → '), h('span', { class: 'sr' }, ' pour '), personOf(z)]),
      h('span', { class: 'duos__n num' }, [p ? fmt(p.rows.length) : '0', p && p.dup && p.dup < p.rows.length ? h('span', { class: 'duos__dup' }, ` (${fmt(p.dup)} en double)`) : null]),
    ]);
    return h('span', { class: 'duos__dirs' }, [line(d.a, d.b, d.ab), line(d.b, d.a, d.ba)]);
  }
  // Une paire : « Toi ⇄ Paul », « Proposer un échange », puis les deux sens côte à côte, toujours tous les deux (à gauche
  // a → b, ce que tu donnes ; à droite b → a, ce que tu reçois ; 2026-10-28, demande de l'utilisateur : un seul sens
  // prenait toute la largeur, on ne voyait plus qui donnait à qui). hidden : pas la paire choisie dans la liste
  // (maître-détail de « Échanges possibles »). Paire grisée (offTrade) : pas de bouton, la raison à la place.
  function viewTradeDuo(d, hidden) {
    const f = d.a.me ? d.b.f : null;
    const off = offTrade(d);
    return h('article', { class: ['fcol', 'trade', { off }], key: d.key, id: 'duo-' + d.key, role: 'tabpanel', 'aria-labelledby': 'duo-tab-' + d.key, hidden: hidden || null }, [
      h('div', { class: 'fcol__head' }, [
        h('span', { class: 'fcol__name' }, [personWho(d.a), h('span', { class: 'trade__arrow', 'aria-hidden': 'true' }, ' ⇄ '), h('span', { class: 'sr' }, ' et '), personWho(d.b)]),
        f && !off ? h('button', { class: 'btn small primary trade__new', type: 'button', onClick: () => openTradeNew(f) }, `Proposer un échange à ${friendName(f)}`) : null,
      ]),
      off && noGameTrade(d) ? h('p', { class: 'trade-note trade__off' }, [h('b', null, friendName(f)), " n'a ni relié son compte du jeu ni donné son pseudo du jeu : impossible de lui proposer un échange depuis le classeur (il peut donner son pseudo dans ses Réglages)."])
        : off ? h('p', { class: 'trade-note trade__off' }, 'Toutes ces cartes sont en favori dans le jeu : le jeu refuse de les échanger.') : null,
      h('div', { class: 'trade__sides' }, [viewTradeSide(d.a, d.b, d.ab), viewTradeSide(d.b, d.a, d.ba)]),
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
  // « Échanges possibles » (2026-10-28 : maître-détail) : les filtres, puis à gauche la liste des paires (combien de cartes,
  // dont de doubles), à droite la paire choisie (S.friends.duo ; la première par défaut). Toutes les paires restent dans la
  // page (panneaux cachés) : passer de l'une à l'autre ne relit rien.
  function viewTrades() {
    const fr = S.friends;
    const list = tradeView.value;
    const all = trades.value.pairs;
    const member = friendList.value.find((f) => f.id === fr.trade) || null;
    const loading = fr.busy || friendList.value.some((f) => !f.cards || (f.tshare && !f.targets));
    const n = list.reduce((a, d) => a + d.n, 0);
    const cur = list.find((d) => d.key === fr.duo) || list[0] || null;
    const pick = (d) => () => { fr.duo = d.key; };
    const onKey = (e) => {
      const i = list.indexOf(cur);
      const j = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? i - 1 : -2;
      if (j < 0 || j >= list.length) return;
      e.preventDefault();
      fr.duo = list[j].key;
      nextTick(() => { const b = document.getElementById('duo-tab-' + list[j].key); if (b) b.focus(); });
    };
    return h('div', { class: 'friends' }, [
      viewFriendsHead(),
      friendsNav('trades'),
      tradeSummary(),
      h('div', { class: 'trades-head' }, [
        h('div', { class: 'section-head' }, [h('h2', null, 'Échanges possibles'),
          h('small', { class: 'num' }, `${fmt(n)} ${plural(n, 'carte', 'cartes')} à donner · ${fmt(list.length)} ${plural(list.length, 'paire', 'paires')} de membres`)]),
        h('div', { class: 'toolbar' }, [
          h('div', { class: 'seg', role: 'group', 'aria-label': 'Échanges à montrer' }, [
            seg('Tout le monde', fr.trade === 'all' || (fr.trade !== 'me' && !member), () => setTradeFilter('all')),
            seg('Ce qui me concerne', fr.trade === 'me', () => setTradeFilter('me')),
          ]),
          h('label', { class: 'sr', for: 'trade-member' }, 'Les échanges d\'un membre'),
          h('select', { id: 'trade-member', class: 'field', value: member ? member.id : '', onChange: (e) => { if (e.target.value) fr.trade = e.target.value; else setTradeFilter(tradePref()); } },
            [h('option', { value: '' }, 'Un membre…'), ...friendList.value.map((f) => h('option', { key: f.id, value: f.id }, nameWithPseudo(f)))]),
          h('label', { class: 'check' }, [
            h('input', { id: 'trade-dup', type: 'checkbox', checked: tradeDupOn(), onChange: () => savePrefs({ trade_dup: !tradeDupOn() }) }),
            ' Seulement les cartes en double']),
        ]),
        ...tradeNotes(),
      ]),
      list.length ? h('div', { class: 'duos' }, [
        h('div', { class: 'duos__list', role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Paires de membres', onKeydown: onKey }, list.map((d) => h('button', {
          key: d.key, id: 'duo-tab-' + d.key, type: 'button', role: 'tab', class: ['duos__item', { on: d === cur, off: offTrade(d) }], 'aria-selected': String(d === cur),
          'aria-controls': 'duo-' + d.key, tabindex: d === cur ? '0' : '-1', onClick: pick(d),
        }, [
          h('span', { class: 'duos__names' }, [personOf(d.a), h('span', { class: 'trade__arrow', 'aria-hidden': 'true' }, ' ⇄ '), h('span', { class: 'sr' }, ' et '), personOf(d.b)]),
          viewDuoCounts(d),
          offTrade(d) ? h('span', { class: 'duos__off' }, noGameTrade(d) ? 'Échange impossible : ni compte du jeu relié ni pseudo' : 'Échange impossible : cartes en favori dans le jeu') : null,
        ]))),
        h('div', { class: 'duos__panels' }, list.map((d) => viewTradeDuo(d, d !== cur))),
      ]) : h('p', { class: 'empty-box' }, loading ? 'Recherche dans les classeurs…'
        : all.length ? (tradeDupOn() ? 'Aucune carte en double à donner avec ce filtre : décoche « Seulement les cartes en double », ou essaie « Tout le monde ».'
          : 'Aucun échange possible avec ce filtre : essaie « Tout le monde ».')
          : "Aucun échange possible pour l'instant : personne n'a de carte qui manque aux collections d'un autre."),
      h('p', { class: 'small muted friends-trade' }, TRADE_NOTE),
    ]);
  }
  // Contenu d'une carte d'un ami (« Tu l'as » ou « Te manque ») dans le style des Réglages.
  // Le style est celui que l'ami a choisi chez lui (f.cstyle, lu dans GET /api/members), pas le tien.
  const friendStyle = (f) => (f && CARD_STYLES.some((s) => s.id === f.cstyle) ? f.cstyle : 'classique');
  function friendCardKids(c, r, have, countTitle, f) {
    const img = artOf(c.title, c.image);
    const st = friendStyle(f);
    if (st !== 'classique') return [h('div', { class: 'cf' }, csFace(st, c, r, img, { have, countTitle }))];
    return [
      h('div', { class: 'card__art' }, [
        noArt(c, img),
        img ? h('img', { src: img, alt: '', loading: 'lazy', decoding: 'async', onError: hideBroken }) : null,
      ]),
      pill(r),
      c.count > 1 ? h('span', { class: 'card__count', title: countTitle }, '×' + fmt(c.count)) : null,
      h('span', { class: ['card__mark', { have }] }, have ? "Tu l'as" : 'Te manque'),
      h('div', { class: 'card__body' }, [h('h3', { class: 'card__title' }, c.title)]),
      r === 'L' ? h('div', { class: 'card__sheen', 'aria-hidden': 'true' }) : null,
    ];
  }
  // Carte d'un ami (lecture seule) : pas de fiche ni de sélection ; « Te manque » si tu ne l'as pas.
  function viewFriendCard(c, f) {
    const r = okRarity(c.rarity) || 'C';
    const have = !!findCard(c);
    return h('div', { class: 'cell', key: c.id }, [
      h('article', { class: ['card', 'card--friend', csClass(friendStyle(f)), 'r' + r, { shiny: c.shiny, have }],
        'aria-label': `${c.title}, ${RARITY_NAME[r]}${c.shiny ? ', brillante' : ''}${c.count > 1 ? `, ${fmt(c.count)} exemplaires` : ''}, ${have ? "tu l'as" : 'te manque'}` },
      friendCardKids(c, r, have, `${fmt(c.count)} exemplaires`, f)),
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
      sepFrame(h('article', { class: ['card', 'card--friend', 'card--fa', csClass(friendStyle(f)), 'r' + r, { shiny: c.shiny, have, want: !!want }], role: 'button', tabindex: '0', 'aria-label': label,
        onClick: open, onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } } },
      friendCardKids(c, r, have, `${fmt(c.count)} exemplaires chez ${friendName(f)}`, f)), sep),
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
    const img = artOf(it.title, (mine && mine.image) || s.thumb);
    let views = '';
    if (!mine) views = s.views != null ? `${fmt(s.views)} vues / 30 j` : S.pv.running ? 'vues…' : 'vues inconnues';
    const give = mine ? (n > 1 ? `, tu l'as (${fmt(n)} exemplaires)` : ", tu l'as") : '';
    return sepFrame(h('div', { class: ['slot', { can: !!mine, pulled: !!S.openMissing && !!S.openMissing.friend && S.openMissing.title === it.title, sep: !!it.sep }], key: s.key }, [
      img ? h('img', { class: 'slot__bg', src: img, alt: '', loading: 'lazy', decoding: 'async', onError: hideBroken })
        : artCover() ? viewCover((mine && mine.category) || it.description, it.title, 'slot') : null,
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
        // Le détail replié sous la barre, comme dans tes albums (2026-10-28) : son titre dit ce que tu peux lui donner.
        h('div', { class: 'album-meta' }, [h('details', { class: 'album-fold' }, [
          h('summary', null, [icon('chev', 'sm'), h('span', { class: 'album-fold__sum' }, [
            missing > 0 ? [h('b', null, fmt(missing)), ` lui ${plural(missing, 'manque', 'manquent')}`] : total ? 'Complète' : 'Vide',
            help ? [" · tu peux l'aider : ", h('b', null, fmt(help))] : null,
          ]), h('span', { class: 'album-fold__more' }, 'Détail')]),
          h('div', { class: 'album-fold__body' }, [
            ownLine ? h('div', { class: 'missing-sum' }, ownLine) : null,
            h('div', { class: 'missing-sum' }, missLine),
            help || want ? h('div', { class: 'missing-sum give-sum' }, [
              help ? h('span', { key: 'help' }, ['Tu peux l\'aider : ', h('b', { class: 'num' }, fmt(help)), ` ${plural(help, 'carte', 'cartes')}`, helpDup ? [' dont ', h('b', { class: 'num' }, fmt(helpDup)), ' en double'] : null]) : null,
              want ? h('span', { key: 'want' }, [help ? '· ' : '', h('b', { class: 'num' }, fmt(want)), ` de ses cartes ${plural(want, 'manque', 'manquent')} à tes collections`]) : null,
            ]) : null,
            missing > 0 ? h('p', { class: 'hint', 'aria-live': 'polite' }, hint) : null,
            h('p', { class: 'hint' }, TRADE_NOTE),
          ]),
        ])]),
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
            : list.length ? h('div', { class: 'cardgrid' }, shown.map((c) => viewFriendCard(c, f)))
              : h('div', { class: 'empty-box' }, fr.filter === 'missing' && !fr.q.trim() ? `Tu as déjà toutes les cartes de ${friendName(f)}.` : 'Aucune carte ne correspond.'),
          shown.length < list.length ? h('div', { class: 'show-more' }, [h('button', { class: 'btn', type: 'button', onClick: () => { fr.limit += PAGE; } },
            `Afficher plus (${fmt(list.length - shown.length)} restantes)`)]) : null,
        ]),
      ]),
    ]);
  }
  // « Entre amis » (2026-10-28, demande de l'utilisateur : « complètement splittée par sous-menu ») : un en-tête commun
  // (titre, « Actualiser », sous-menu) et quatre sous-pages, chacune avec son adresse (S.friends.page) :
  // « Collections » (#/amis : chaque membre et les collections qu'il partage), « Pour toi » (#/amis/pour-toi), « Pour tes
  // amis » (#/amis/pour-eux) et « Échanges » (#/amis/echanges, viewTrades).
  const FRIEND_PAGES = [[null, 'Collections', 'amis'], ['fill', 'Pour toi', 'amis/pour-toi'], ['wants', 'Pour tes amis', 'amis/pour-eux'], ['trades', 'Échanges', 'amis/echanges']];
  function openFriendsPage(page) {
    if (page === 'trades') { openTrades(); return; }
    Object.assign(S.friends, { page, open: null, album: null, albumFrom: null });
    toTop();
  }
  function viewFriendsHead() {
    const fr = S.friends;
    return h('div', { class: 'section-head' }, [
      h('h2', { id: 'h-friends' }, 'Entre amis'),
      h('small', null, 'les membres du classeur qui montrent leurs cartes'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', type: 'button', disabled: fr.busy, onClick: () => loadFriends(true) }, [icon('refresh', fr.busy ? 'sm spin' : 'sm'), 'Actualiser']),
    ]);
  }
  // Compte de chaque sous-page : collections partagées, cases que tes amis remplissent, cartes que tu peux leur donner,
  // cartes de tous les échanges.
  function friendsNav(active) {
    const n = {
      cols: allFriendCols.value.reduce((a, x) => a + (x.rows ? x.rows.length : 0), 0),
      fill: friendHighlights.value.reduce((a, x) => a + x.rows.length, 0),
      wants: friendWants.value.reduce((a, x) => a + x.rows.length, 0),
      trades: trades.value.pairs.reduce((a, p) => a + p.rows.length, 0),
    };
    return h('nav', { class: 'fnav', 'aria-label': 'Entre amis' }, FRIEND_PAGES.map(([id, label]) => {
      const on = (active || null) === id;
      const c = n[id || 'cols'];
      return h('button', { key: label, type: 'button', class: ['fnav__btn', { on }], 'aria-current': on ? 'page' : null, onClick: () => { if (!on) openFriendsPage(id); } },
        [h('span', null, label), c ? h('span', { class: 'fnav__n num', 'aria-label': `(${fmt(c)})` }, fmt(c)) : null]);
    }));
  }
  // Les collections partagées de chaque membre, avec leur progression (comme « Ses collections » de son classeur).
  const allFriendCols = computed(() => {
    void qidVersion.value;
    return friendList.value.map((f) => {
      if (!f.tshare || !f.targets) return { f, rows: null };
      const index = friendIndexOf(f.id);
      return { f, rows: f.targets.map((t) => ({ t, key: 'ft:' + f.id + ':' + t.id, p: friendProgressFor(index, t) })).sort((a, b) => COLLATOR.compare(a.t.name, b.t.name)) };
    });
  });
  // Sous-page « Collections » : un bloc par membre (sa carte, puis ses collections ; 5 avant « Voir les N »).
  function viewFriendsCols() {
    const fr = S.friends;
    return h('div', { class: 'fmembers' }, allFriendCols.value.map(({ f, rows }) => {
      const key = 'mcols:' + f.id;
      const shown = rows ? (fr.more[key] ? rows : rows.slice(0, FRIEND_ROWS)) : [];
      return h('section', { class: 'fmember', key: f.id, 'aria-label': friendName(f) }, [
        viewMemberRow(f),
        !f.tshare ? h('p', { class: 'small muted fmember__none' }, `${friendName(f)} ne partage pas ses collections : parcours son classeur pour voir ses cartes.`)
          : !rows ? h('p', { class: 'small muted fmember__none', role: 'status' }, 'Lecture de ses collections…')
            : !rows.length ? h('p', { class: 'small muted fmember__none' }, `${friendName(f)} n'a pas encore de collection.`)
              : h('div', { class: 'rows' }, shown.map((r) => viewFriendColRow(f, r))),
        rows ? moreToggle(key, rows.length) : null,
      ]);
    }));
  }
  function viewFriends() {
    if (!sharing()) return viewShareOff();
    const fr = S.friends;
    const open = openFriend.value;
    if (fr.open && open) return fr.album != null ? viewFriendAlbum(open) : viewFriendBinder(open);
    if (fr.page === 'trades') return viewTrades();
    const list = friendList.value;
    const loadingAll = fr.busy || list.some((f) => !f.cards || (f.tshare && !f.targets));
    const page = fr.page === 'fill' || fr.page === 'wants' ? fr.page : null;
    const t = trades.value;
    let body;
    if (!list.length) {
      body = [fr.status === 'loading' || fr.busy ? h('p', { class: 'muted', role: 'status' }, 'Lecture des membres…')
        : fr.status === 'ready' ? h('p', { class: 'empty-box' }, "Personne d'autre ne montre encore ses cartes : propose à tes amis d'activer « Montrer mes cartes aux autres membres » dans leurs Réglages.") : null];
    } else if (page === 'fill') {
      const fill = friendHighlights.value;
      body = [
        h('div', { class: 'section-head' }, [h('h2', { id: 'h-fill' }, 'Pour compléter tes collections'),
          h('small', null, 'les cartes qui te manquent et que tes amis ont ; leurs doubles d\'abord')]),
        !sharingTargets() ? h('p', { class: 'trade-note' }, ['Tes amis ne voient pas tes collections : ils ne savent pas ce qui te manque. ',
          h('button', { class: 'linkish', type: 'button', disabled: fr.shareBusy, onClick: () => setSharedTargets(true) }, 'Partager aussi mes collections à compléter')]) : null,
        fill.length ? h('div', { class: 'fcols' }, fill.map(viewFillCol))
          : h('p', { class: 'empty-box' }, loadingAll ? 'Recherche dans les classeurs de tes amis…' : "Tes amis n'ont aucune des cartes qui manquent à tes collections."),
        h('p', { class: 'small muted friends-trade' }, TRADE_NOTE),
      ];
    } else if (page === 'wants') {
      const wants = friendWants.value;
      body = [
        h('div', { class: 'section-head' }, [h('h2', { id: 'h-wants' }, 'Ce qui pourrait intéresser tes amis'),
          h('small', null, 'tes cartes qui manquent aux collections qu\'ils partagent')]),
        wants.length ? h('div', { class: 'fcols' }, wants.map(viewWant))
          : h('p', { class: 'empty-box' }, loadingAll ? 'Recherche…' : !list.some((f) => f.tshare) ? 'Aucun de tes amis ne partage ses collections : impossible de savoir ce qui leur manque.'
            : 'Aucune de tes cartes ne manque aux collections de tes amis.'),
        wants.length && t.hidden.length ? h('p', { class: 'small muted' }, `Rien pour ${andList(t.hidden.map(friendName))}, qui ne ${t.hidden.length > 1 ? 'partagent pas leurs' : 'partage pas ses'} collections.`) : null,
        h('p', { class: 'small muted friends-trade' }, TRADE_NOTE),
      ];
    } else body = [viewFriendsCols()];
    return h('div', { class: 'friends' }, [
      viewFriendsHead(),
      fr.loading ? h('p', { class: 'small muted', role: 'status' }, fr.loading) : null,
      errLine(fr.error),
      S.me && S.me.user && !S.me.user.pseudo ? h('p', { class: 'small muted pseudo-ask' }, ['Ajoute ton pseudo du jeu pour que tes amis te trouvent dans WikiMasters : ',
        h('button', { class: 'linkish', type: 'button', onClick: openSettings }, 'Réglages'), '.']) : null,
      list.length ? friendsNav(page) : null,
      h('section', { class: 'fpanel', 'aria-labelledby': page === 'fill' ? 'h-fill' : page === 'wants' ? 'h-wants' : 'h-friends' }, body),
    ]);
  }
  // Résumé des échanges qui te concernent, en tête de « Échanges » : les amis à qui tes cartes servent le plus (« les
  // collections de Paul et Léa »), et tes collections que leurs cartes complètent le plus (« « Planètes » et « Couleurs » »).
  function tradeSummary() {
    const pairs = trades.value.pairs;
    const giveTo = pairs.filter((p) => p.x.me);
    const getFrom = pairs.filter((p) => p.z.me);
    const give = giveTo.reduce((a, p) => a + p.rows.length, 0);
    const get = getFrom.reduce((a, p) => a + p.rows.length, 0);
    const others = pairs.filter((p) => !p.x.me && !p.z.me).reduce((a, p) => a + p.rows.length, 0);
    const giveNames = giveTo.slice().sort((a, b) => b.rows.length - a.rows.length || COLLATOR.compare(friendName(a.z.f), friendName(b.z.f))).map((p) => friendName(p.z.f));
    const getNames = rankNames(getFrom.flatMap((p) => p.rows), (r) => r.cols.map((c) => c.name));
    if (!pairs.length) return null;
    return h('p', { class: 'trade-sum' }, [
      h('b', null, fmt(give)), ` de tes cartes ${plural(give, 'peut', 'peuvent')} compléter les collections ${giveNames.length ? 'de ' + namesText(giveNames, false) : 'de tes amis'} ; `,
      h('b', null, fmt(get)), ` de leurs cartes ${plural(get, 'peut', 'peuvent')} compléter ${getNames.length ? namesText(getNames, true) : 'les tiennes'}`,
      others ? ['. Entre eux : ', h('b', null, fmt(others)), '.'] : '.',
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
  // qui te mentionne est mis en avant et compté à part dans le badge. Réactions (2026-10-24) : un emoji parmi
  // CHAT_REACTIONS sous chaque bulle, mis ou retiré d'un clic ; un changement donne au message une nouvelle révision, la
  // relecture ?after le rend de nouveau (remplacé dans le fil).
  const CHAT_MAX = 500;
  // Même liste que le serveur (CHAT_REACTIONS de chat.js), dans l'ordre du choix « Réagir ».
  const CHAT_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👀'];
  const CHAT_EVERY = 12 * 1000;
  const CHAT_IDLE_EVERY = 30 * 1000;
  const CHAT_IDLE_AFTER = 5 * 60 * 1000;
  const CHAT_KEY_LINK = /#cle=[A-Za-z0-9_-]{20,}/;
  const CHAT_URL = /\bhttps?:\/\/[^\s<>"«»]+/gi;
  // Carte citée dans un message : [[Titre de la carte]] (un titre de Wikipédia : 1 à 300 caractères, sans [ ] { } | # < >
  // ni retour à la ligne). Le texte envoyé ne change pas ; la page la montre en pastille qui ouvre la fiche de la carte.
  const CHAT_CARD = /\[\[([^[\]{}|#<>\n]{1,300})\]\]/g;
  // Collection citée (2026-10-20) : le serveur range un lien du site vers une collection sous une forme stable et la rend
  // par son nom, en clair dans le texte ; `refs` du message dit où (at, len) et ce qu'elle est (propriétaire, de quoi
  // l'ouvrir).
  const REF_ID = /^[A-Za-z0-9_-]{1,64}$/;
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
  // Non lus qui te mentionnent ou répondent à un de tes messages (parmi les non lus).
  const chatUnreadPings = computed(() => {
    const read = S.chat.read;
    let n = 0;
    for (const m of chatMsgs.value) if (m.id > read && !m.mine && (chatInfo(m).me || m.toMe)) n++;
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
      let local = false;
      try {
        const u = new URL(url);
        if ((u.protocol === 'https:' || u.protocol === 'http:') && u.hostname) href = u.href;
        // Une vue du classeur (#/…) : ouverte dans cette page, pas dans un nouvel onglet.
        if (href && u.origin === location.origin && u.pathname === '/' && !u.search && u.hash.startsWith('#/')) { href = u.hash; local = true; }
      } catch (e) { href = null; }
      if (!href) continue;
      if (m.index > last) out.push({ text: text.slice(last, m.index) });
      out.push(local ? { text: url, url: href, local } : { text: url, url: href });
      last = m.index + url.length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }
  // Morceaux d'un message : collections et membres cités ({text: nom, col: ref} ou {text: prénom, member: ref}, à leur
  // place dans le texte, dans l'ordre et sans chevauchement ; les autres sont ignorés), puis, entre eux, cardParts.
  function chatParts(text, refs, members) {
    const out = [];
    let last = 0;
    const all = [...refs.map((ref) => ({ ref, col: ref })), ...members.map((ref) => ({ ref, member: ref }))].sort((a, b) => a.ref.at - b.ref.at);
    for (const { ref, col, member } of all) {
      if (ref.at < last || ref.at + ref.len > text.length) continue;
      if (ref.at > last) out.push(...cardParts(text.slice(last, ref.at)));
      out.push(col ? { text: text.slice(ref.at, ref.at + ref.len), col } : { text: text.slice(ref.at, ref.at + ref.len), member });
      last = ref.at + ref.len;
    }
    if (last < text.length) out.push(...cardParts(text.slice(last)));
    return out;
  }
  // Cartes citées ({text, card: titre}, « [[rihanna]] » -> « Rihanna »), puis, entre elles, texte brut et liens
  // (linkify). Un lien entre crochets (« [[https://…]] ») reste un lien.
  function cardParts(text) {
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
      if (p.card || p.url || p.col || p.member) { parts.push(p); continue; }
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
    const refs = (Array.isArray(m.refs) ? m.refs : []).map(prepChatRef).filter(Boolean);
    const members = (Array.isArray(m.members) ? m.members : []).map(prepChatMember).filter(Boolean);
    const mine = m.mine === true;
    const reply = prepChatReply(m.reply);
    return markRaw({ id, mine, author: typeof m.author === 'string' && m.author ? m.author : null, text, at: String(m.created_at || ''),
      parts: chatParts(text, refs, members), refs, members, reply, toMe: !mine && !!reply && reply.mine, reactions: prepChatReactions(m.reactions) });
  }
  // Réactions telles que le serveur les rend : [{emoji, n, mine, who}] (who : prénoms des autres membres qui l'ont mise) ;
  // un emoji inconnu de cette page est écarté.
  function prepChatReactions(list) {
    const out = [];
    for (const r of Array.isArray(list) ? list : []) {
      if (!r || !CHAT_REACTIONS.includes(r.emoji) || !Number.isInteger(r.n) || r.n <= 0 || out.some((x) => x.emoji === r.emoji)) continue;
      const who = (Array.isArray(r.who) ? r.who : []).filter((x) => typeof x === 'string' && x).slice(0, 60);
      out.push(Object.freeze({ emoji: r.emoji, n: r.n, mine: r.mine === true, who }));
    }
    return out;
  }
  // Message auquel il répond, tel que le serveur le rend : {id, author, mine, text} (extrait) ou {id, gone: true}
  // (supprimé ou purgé depuis) ; null sans réponse.
  function prepChatReply(r) {
    const id = Number(r && r.id);
    if (!Number.isInteger(id) || id <= 0) return null;
    if (r.gone || typeof r.text !== 'string') return { id, gone: true };
    return { id, author: typeof r.author === 'string' && r.author ? r.author : null, mine: r.mine === true, text: r.text };
  }
  // Messages supprimés (par la relecture ou par toi) : retirés du fil ; les réponses qui les citent gardent seulement
  // « message supprimé », et un brouillon qui y répondait n'y répond plus.
  function dropChatMsgs(ids) {
    const gone = new Set(ids);
    if (!gone.size) return false;
    const before = chatMsgs.value;
    const list = before.filter((m) => !gone.has(m.id)).map((m) => (m.reply && !m.reply.gone && gone.has(m.reply.id) ? markRaw({ ...m, reply: { id: m.reply.id, gone: true } }) : m));
    const c = S.chat;
    if (c.reply && gone.has(c.reply.id)) { c.reply = null; c.sendError = 'Le message auquel tu répondais vient d\'être supprimé.'; }
    if (list.length === before.length && list.every((m, i) => m === before[i])) return false;
    chatMsgs.value = list;
    return true;
  }
  // Membre cité tel que le serveur le rend : {at, len, name, mine, pid, pseudo} (pid : de quoi ouvrir son classeur,
  // pseudo : son pseudo dans le jeu, si tu montres tes cartes et lui les siennes), ou {at, len, gone: true} (classeur
  // supprimé) ; sans place valide : ignoré (son prénom reste du texte).
  function prepChatMember(r) {
    if (!r || typeof r !== 'object' || !Number.isInteger(r.at) || !Number.isInteger(r.len) || r.at < 0 || r.len <= 0) return null;
    const { at, len } = r;
    if (r.gone || typeof r.name !== 'string') return { at, len, gone: true };
    const mine = r.mine === true;
    const pid = !mine && typeof r.pid === 'string' && REF_ID.test(r.pid) ? r.pid : null;
    return { at, len, name: r.name || 'Sans prénom', mine, pid, pseudo: pid && typeof r.pseudo === 'string' && r.pseudo ? r.pseudo : null };
  }
  // Collection citée telle que le serveur la rend : {at, len, name, owner, mine, pid, id} (pid : son propriétaire, si tu
  // peux ouvrir ses collections ; id : la collection, si tu peux l'ouvrir), ou {at, len, gone: true} ; sans place valide :
  // ignorée (son nom reste du texte).
  function prepChatRef(r) {
    if (!r || typeof r !== 'object' || !Number.isInteger(r.at) || !Number.isInteger(r.len) || r.at < 0 || r.len <= 0) return null;
    const { at, len } = r;
    if (r.gone || typeof r.name !== 'string') return { at, len, gone: true };
    const mine = r.mine === true;
    const pid = !mine && typeof r.pid === 'string' && REF_ID.test(r.pid) ? r.pid : null;
    const id = (mine || pid) && typeof r.id === 'string' && REF_ID.test(r.id) ? r.id : null;
    return { at, len, name: r.name || 'Sans nom', owner: typeof r.owner === 'string' && r.owner ? r.owner : null, mine, pid: id ? pid : null, id };
  }
  const chatRefHref = (ref) => (!ref.id ? null : ref.mine ? '#/collections/' + encodeURIComponent(ref.id) : `#/ami/${encodeURIComponent(ref.pid)}/${encodeURIComponent(ref.id)}`);
  // Des messages lus citent la collection d'un ami : ses cartes et ses collections (« Entre amis ») pour en montrer la
  // progression dans l'aperçu, au plus toutes les 10 min, comme l'onglet.
  function loadCitedFriends() {
    if (sharing() && chatMsgs.value.some((m) => m.refs.some((r) => r.pid) || m.members.some((r) => r.pid))) ensureFriends();
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
        .map((m) => markRaw({ id: typeof m.id === 'string' ? m.id : '', name: m.name, pseudo: typeof m.pseudo === 'string' && m.pseudo ? m.pseudo : null }));
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
  // Collections proposées après « #c: » : les tiennes, puis celles des amis qui les montrent (lues avec « Entre amis » ;
  // il faut montrer ses cartes). Insère le lien du site vers elle : le serveur le range sous une forme stable.
  const chatColChoices = computed(() => {
    const site = location.origin + '/#/';
    const out = targets.value.map((t) => ({ key: 'me:' + t.id, name: t.name, f: fold(t.name), mine: true, owner: null,
      url: site + 'collections/' + encodeURIComponent(t.id) }));
    if (sharing()) {
      for (const f of friendList.value) for (const t of f.targets || []) {
        out.push({ key: f.id + ':' + t.id, name: t.name, f: fold(t.name), mine: false, owner: friendName(f), url: `${site}ami/${encodeURIComponent(f.id)}/${encodeURIComponent(t.id)}` });
      }
    }
    return out;
  });
  // Membres proposés après « #u: » : toi (pour montrer ton classeur), puis ceux qui montrent leurs cartes (« Entre amis »
  // s'il est lu, sinon GET /api/members seul ; il faut montrer les siennes). Insère le lien de son classeur : le serveur le
  // range sous une forme stable.
  const chatUserChoices = computed(() => {
    if (!sharing()) return [];
    const site = location.origin + '/#/ami/';
    const src = friendList.value.length ? friendList.value : chatMembers.value;
    const out = src.filter((f) => f.id && REF_ID.test(f.id)).map((f) => ({ key: f.id, name: friendName(f), f: fold(friendName(f)), mine: false, pseudo: f.pseudo || null,
      url: site + encodeURIComponent(f.id) }));
    const pid = myPid();
    if (pid) {
      const name = (S.me.user && S.me.user.name) || 'Moi';
      out.unshift({ key: pid, name, f: fold(name) + ' moi toi', mine: true, pseudo: null, url: site + encodeURIComponent(pid) });
    }
    return out;
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
    if (ac.kind === 'c') {
      return chatColChoices.value.map((x) => ({ x, r: rank(x.f) })).filter((y) => y.r < 9)
        .sort((a, b) => a.r - b.r || b.x.mine - a.x.mine || COLLATOR.compare(a.x.name, b.x.name)).slice(0, CHAT_AC_MAX)
        .map(({ x }) => ({ key: 'col:' + x.key, label: x.name, insert: x.url, hint: x.mine ? 'ta collection' : 'de ' + x.owner, col: x }));
    }
    if (ac.kind === 'u') {
      return chatUserChoices.value.map((x) => ({ x, r: rank(x.f) })).filter((y) => y.r < 9)
        .sort((a, b) => a.r - b.r || b.x.mine - a.x.mine || COLLATOR.compare(a.x.name, b.x.name)).slice(0, CHAT_AC_MAX)
        .map(({ x }) => ({ key: 'u:' + x.key, label: x.name, insert: x.url, hint: x.mine ? 'toi : ton classeur' : x.pseudo, self: x.mine }));
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
    if (!tr || !off || off.start !== tr.start || !tr.q.startsWith(off.tq)) c.acOff = null;
    if (!tr || c.acOff !== null) { c.ac = null; stopChatWp(); return; }
    // « #c: » : une collection (les tiennes, celles des amis), « #u: » : un membre, pas une carte.
    const kind = tr.kind === '#' && /^[cu]:/i.test(tr.q) ? tr.q.charAt(0).toLowerCase() : tr.kind;
    const q = kind === 'c' || kind === 'u' ? tr.q.slice(2) : tr.q;
    if (kind === '@' || kind === 'u') { loadChatMembers(); stopChatWp(); } else if (kind === 'c') { ensureFriends(); stopChatWp(); } else chatWpSearch(q);
    const same = c.ac && c.ac.kind === kind && c.ac.start === tr.start && c.ac.q === q;
    c.ac = { ...tr, tq: tr.q, kind, q, active: same ? c.ac.active : 0 };
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
    if (item.col && item.col.mine && !sharingTargets()) {
      notify('Tu ne montres pas tes collections (Réglages, « Partage entre membres ») : les autres membres verront « collection non partagée ».', true);
    }
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
    dropChatMsgs((Array.isArray(r.deleted) ? r.deleted : []).map(Number));
    const map = new Map(chatMsgs.value.map((m) => [m.id, m]));
    // Un message plus ancien que ceux affichés revient quand ses réactions changent : pas ajouté au fil.
    const oldest = chatMsgs.value.length ? chatMsgs.value[0].id : 0;
    let added = 0;
    let changed = false;
    for (const raw of Array.isArray(r.messages) ? r.messages : []) {
      const m = prepChatMsg(raw);
      if (!m || (!map.has(m.id) && m.id < oldest)) continue;
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
    loadCitedFriends();
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
      acWp: { q: '', titles: [], loading: false }, reply: null, picker: null });
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
    const reply = c.reply;
    c.sending = true;
    c.sendError = '';
    chatTouch();
    try {
      const r = await api('POST', '/api/chat', reply ? { text, reply_to: reply.id } : { text });
      if (gen !== chatGen) return;
      if (c.draft.replace(/\r\n?/g, '\n').trim() === text) { c.draft = ''; c.ac = null; } // tapé de nouveau pendant l'envoi : gardé
      if (c.reply === reply) c.reply = null;
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
      if (e.key === 'Escape') { e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); S.chat.acOff = { start: ac.start, tq: ac.tq }; S.chat.ac = null; stopChatWp(); return; }
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
    if (e.key === 'Escape' && S.chat.reply && !e.isComposing) { e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); S.chat.reply = null; return; }
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    sendChat(true);
  }
  // « Répondre » sur une bulle : le brouillon y répondra (bandeau au-dessus du champ), curseur dans le champ.
  function replyToChat(m) {
    const short = m.text.replace(/\[\[([^[\]\n]{1,300})\]\]/g, '$1').replace(/\s+/g, ' ').trim();
    const who = (m.mine && S.me && S.me.user && S.me.user.name) || m.author || 'Sans prénom';
    Object.assign(S.chat, { reply: { id: m.id, author: who, mine: m.mine, text: short.length > 140 ? short.slice(0, 140).trimEnd() + '…' : short }, sendError: '' });
    chatTouch();
    nextTick(() => { const t = document.getElementById('chat-input'); if (t) { t.focus(); const n = t.value.length; if (t.setSelectionRange) t.setSelectionRange(n, n); } });
  }
  // Clic sur la citation d'une réponse : le message cité, s'il est chargé, défile au milieu du fil et clignote un instant.
  function showChatMsg(id) {
    const el = document.getElementById('chat-m-' + id);
    if (!el) { notify('Ce message est plus ancien que ceux affichés : « Charger les messages plus anciens » en haut du fil.'); return; }
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('flash');
    void el.offsetWidth; // relance l'animation
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
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
        dropChatMsgs([m.id]);
        refreshChat();
      },
    });
  }

  // Réactions : la tienne mise ou retirée tout de suite dans le fil, puis remplacée par ce que rend le serveur (les
  // réactions des autres arrivées entre-temps comprises) ; refusée : remise comme avant, avec le message du serveur.
  function setChatReactions(id, reactions) {
    chatMsgs.value = chatMsgs.value.map((m) => (m.id === id ? markRaw({ ...m, reactions }) : m));
  }
  async function toggleReaction(m, emoji) {
    const cur = chatMsgs.value.find((x) => x.id === m.id);
    if (!cur) return;
    const was = cur.reactions;
    const r0 = was.find((x) => x.emoji === emoji);
    const on = !(r0 && r0.mine);
    const next = r0 ? was.map((x) => (x === r0 ? Object.freeze({ ...x, mine: on, n: x.n + (on ? 1 : -1) }) : x)).filter((x) => x.n > 0)
      : was.concat(Object.freeze({ emoji, n: 1, mine: true, who: [] }));
    S.chat.picker = null;
    setChatReactions(m.id, next);
    chatTouch();
    const gen = chatGen;
    try {
      const r = await api('POST', `/api/chat/${m.id}/react`, { emoji, on });
      if (gen === chatGen) setChatReactions(m.id, prepChatReactions(r.reactions));
    } catch (e) {
      if (gen !== chatGen) return;
      if (e.status === 404) { dropChatMsgs([m.id]); notify("Ce message n'existe plus.", true); return; }
      const now = chatMsgs.value.find((x) => x.id === m.id);
      if (now && now.reactions === next) setChatReactions(m.id, was);
      notify(e.message, true);
    }
  }
  // « Réagir » : ouvre (ou ferme) le choix des réactions sous l'en-tête de la bulle, le premier emoji prêt au clavier ;
  // Échap, un clic ailleurs ou un choix le ferment.
  function toggleChatPicker(m) {
    const c = S.chat;
    c.picker = c.picker === m.id ? null : m.id;
    chatTouch();
    if (c.picker !== null) nextTick(() => { const b = chatMsgPart(m.id, '.chat-pick__e'); if (b) b.focus(); });
  }
  function closeChatPicker(focusBack) {
    const id = S.chat.picker;
    if (id === null) return;
    S.chat.picker = null;
    if (focusBack) nextTick(() => { const b = chatMsgPart(id, '.chat-msg__react'); if (b) b.focus(); });
  }
  const chatMsgPart = (id, sel) => { const el = document.getElementById('chat-m-' + id); return el ? el.querySelector(sel) : null; };
  // Un geste hors du choix et de son bouton « Réagir » le ferme (le bouton, lui, le ferme à son clic).
  function onChatPickerAway(e) {
    if (S.chat.picker === null) return;
    for (let n = e.target; n; n = n.parentNode) {
      if (n.classList && (n.classList.contains('chat-pick') || n.classList.contains('chat-msg__react'))) return;
    }
    closeChatPicker(false);
  }
  watch(() => S.chat.picker !== null, (open) => {
    if (open) document.addEventListener('pointerdown', onChatPickerAway, true);
    else document.removeEventListener('pointerdown', onChatPickerAway, true);
  });
  watch(() => S.tab, () => { S.chat.picker = null; });
  // Qui a mis une réaction : « Ben, Cléo et toi ».
  function reactWho(r) {
    const names = r.mine ? r.who.concat('toi') : r.who;
    return names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' et ' + names[names.length - 1];
  }

  // ================================================================ nouveautés : journal des versions, annonces du chat
  // Contrat : SPEC.md, « Nouveautés ». Un fichier publié avec le site, /nouveautes.json, rien dans la base : `versions` =
  // le journal des changements (page « Nouveautés », #/nouveautes), `chat` = les messages système du chat (discrets,
  // centrés, avec un lien vers la page). Les deux s'écrivent à la main et séparément : ajouter une version n'annonce rien
  // dans le chat. Lu à l'ouverture du classeur, puis à l'ouverture du chat ou de la page, au plus toutes les 10 min.
  // Tout est revérifié ici (le fichier est du texte : jamais de HTML ; liens internes en « #/… » seulement).
  const NEWS_URL = '/nouveautes.json';
  const NEWS_TTL = 10 * 60 * 1000;
  const NEWS_ROUTE = /^#\/[^\s#<>"]{0,300}$/;
  const NEWS_DAY = /^\d{4}-\d{2}-\d{2}$/;
  const news = shallowRef({ versions: [], chat: [] });
  let newsAt = 0;
  let newsJob = null;
  const newsStr = (v, max) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);
  const newsList = (v, max) => (Array.isArray(v) ? v.slice(0, max).filter((x) => x && typeof x === 'object') : []);
  // {versions:[{id, date, title, intro, sections:[{icon, title, items:[{text, to, link}]}]}] (la plus récente d'abord),
  // chat:[{sys:true, id, at, text, version}] (du plus ancien au plus récent)} ; ce qui ne se lit pas est écarté.
  function cleanNews(d) {
    const versions = [];
    for (const v of newsList(d && d.versions, 200)) {
      const id = newsStr(v.id, 60);
      const date = typeof v.date === 'string' && NEWS_DAY.test(v.date) && dateOf(v.date + 'T12:00:00Z') ? v.date : null;
      if (!id || !date || versions.some((x) => x.id === id)) continue;
      const sections = [];
      for (const s of newsList(v.sections, 30)) {
        const items = [];
        for (const it of newsList(s.items, 50)) {
          const text = newsStr(it.text, 600);
          const to = typeof it.to === 'string' && NEWS_ROUTE.test(it.to) ? it.to : null;
          if (text) items.push(Object.freeze({ text, to, link: to ? newsStr(it.link, 60) || 'Voir' : null }));
        }
        const title = newsStr(s.title, 120);
        if (title && items.length) sections.push(Object.freeze({ icon: newsStr(s.icon, 8), title, items }));
      }
      if (sections.length) versions.push(Object.freeze({ id, date, title: newsStr(v.title, 120), intro: newsStr(v.intro, 600), sections }));
    }
    versions.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
    const chat = [];
    for (const m of newsList(d && d.chat, 100)) {
      const id = newsStr(m.id, 60);
      const at = typeof m.at === 'string' ? dateOf(m.at) : null;
      const text = newsStr(m.text, 300);
      if (!id || !at || !text || chat.some((x) => x.id === id)) continue;
      const version = newsStr(m.version, 60);
      chat.push(Object.freeze({ sys: true, id, at: at.toISOString(), text, version: versions.some((v) => v.id === version) ? version : null }));
    }
    chat.sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? -1 : 1));
    return markRaw({ versions, chat });
  }
  function loadNews(force) {
    if (newsJob || (!force && newsAt && Date.now() - newsAt < NEWS_TTL)) return newsJob;
    if (S.news.status !== 'ready') S.news.status = 'loading';
    newsJob = (async () => {
      try {
        const r = await fetch(NEWS_URL, { cache: 'no-cache' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        news.value = cleanNews(await r.json());
        S.news.status = 'ready';
        newsAt = Date.now();
      } catch (e) {
        if (S.news.status !== 'ready') S.news.status = 'error';
        newsAt = Date.now() - NEWS_TTL + 60000; // nouvel essai dans une minute
      } finally {
        newsJob = null;
      }
    })();
    return newsJob;
  }
  const newsLatest = computed(() => (news.value.versions[0] || null));
  // Une version que ce navigateur n'a pas encore vue : pastille sur le lien « Nouveautés » du bandeau.
  const newsUnseen = computed(() => !!newsLatest.value && newsLatest.value.id !== S.news.seen && S.tab !== 'nouveautes');
  // Page ouverte (et versions lues) : la dernière est vue ; celles d'après la précédente vue (la dernière seule si aucune
  // ne l'a été) restent « Nouveau » le temps de la visite.
  watch(() => (S.boot === 'app' && S.tab === 'nouveautes' && newsLatest.value ? newsLatest.value.id : ''), (id) => {
    if (!id || id === S.news.seen) return;
    const list = news.value.versions;
    const old = list.findIndex((v) => v.id === S.news.seen);
    S.news.fresh = list.slice(0, old > 0 ? old : 1).map((v) => v.id);
    S.news.seen = id;
    store.set(LS.newsSeen, id);
  });
  watch(() => S.boot === 'app' && (S.tab === 'nouveautes' || S.tab === 'chat'), (on) => { if (on) loadNews(false); });
  // Messages système à placer dans le fil du chat : ceux d'après le plus ancien message chargé (tous s'il n'y en a pas
  // de plus anciens), une fois le chat lu.
  const chatSystem = computed(() => {
    const c = S.chat;
    const list = chatMsgs.value;
    if (c.status !== 'ready' && !list.length) return [];
    const from = c.older && list.length ? list[0].at : '';
    return news.value.chat.filter((m) => m.at >= from);
  });
  // Fil du chat : messages des membres et messages système, par heure (à heure égale, le message système d'abord).
  const chatTimeline = computed(() => {
    const sys = chatSystem.value;
    const list = chatMsgs.value;
    if (!sys.length) return list;
    const out = [];
    let i = 0;
    for (const m of list) {
      while (i < sys.length && sys[i].at <= m.at) out.push(sys[i++]);
      out.push(m);
    }
    while (i < sys.length) out.push(sys[i++]);
    return out;
  });

  // ---------------------------------------------------------------- rendu du chat
  // Badge des non-lus, et à côté « @2 » (couleur d'alerte) pour ceux qui te mentionnent.
  function chatTabLabel(label) {
    const n = S.tab === 'chat' ? 0 : chatUnread.value;
    if (!n) return label;
    const p = chatUnreadPings.value;
    const said = ' ' + plural(n, 'message non lu', 'messages non lus') + (p ? `, dont ${p} ${plural(p, "s'adresse à toi", "s'adressent à toi")}` : '');
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
    return h('div', { key: m.id, id: 'chat-m-' + m.id, class: ['chat-msg', { mine: m.mine, ping: info.me || m.toMe }] }, [
      h('div', { class: 'chat-msg__head' }, [
        h('span', { class: 'chat-msg__who' }, who),
        m.mine ? h('span', { class: 'chat-msg__me' }, '(toi)') : null,
        pseudo ? h('a', { class: 'chat-msg__pseudo', href: gameProfileUrl(pseudo), target: '_blank', rel: 'noopener noreferrer',
          title: `Pseudo dans le jeu : ${pseudo} (son profil dans le jeu)` }, pseudo) : null,
        info.me ? h('span', { class: 'chat-msg__ping' }, 'te mentionne') : m.toMe ? h('span', { class: 'chat-msg__ping' }, 'te répond') : null,
        h('time', { class: 'chat-msg__time', datetime: m.at, title: dateLong(m.at) }, chatWhen(m.at)),
        h('button', { class: 'chat-msg__act chat-msg__react', type: 'button', title: 'Réagir à ce message', 'aria-label': `Réagir au message de ${who}`,
          'aria-expanded': S.chat.picker === m.id ? 'true' : 'false', onClick: () => toggleChatPicker(m) },
          [icon('smile', 'sm'), h('span', { class: 'chat-msg__act-label', 'aria-hidden': 'true' }, 'Réagir')]),
        h('button', { class: 'chat-msg__act chat-msg__reply', type: 'button', title: 'Répondre à ce message', 'aria-label': `Répondre au message de ${who}`, onClick: () => replyToChat(m) },
          [icon('reply', 'sm'), h('span', { class: 'chat-msg__act-label', 'aria-hidden': 'true' }, 'Répondre')]),
        m.mine ? h('button', { class: 'chat-msg__act chat-msg__del', type: 'button', title: 'Supprimer ce message', 'aria-label': 'Supprimer ce message', onClick: () => askDeleteChat(m) },
          [icon('trash', 'sm'), h('span', { class: 'chat-msg__act-label', 'aria-hidden': 'true' }, 'Supprimer')]) : null,
      ]),
      m.reply ? viewChatQuote(m.reply) : null,
      h('p', { class: 'chat-msg__text' }, info.parts.map((p) => (p.card ? viewChatCard(p.card)
        : p.at ? h('span', { class: ['chat-at', { me: p.me }], title: p.me ? null : pseudoTip({ pseudo: pseudoOf(p.text.slice(1)) }) }, p.text)
        : p.col ? viewChatColLink(p)
        : p.member ? viewChatMemberLink(p)
        : p.url ? (p.local ? h('a', { href: p.url }, p.text) : h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer nofollow ugc' }, p.text)) : p.text))),
      viewChatColEmbed(m.refs.find((r) => !r.gone)),
      viewChatMemberEmbed(m.members.find((r) => !r.gone)),
      S.chat.picker === m.id ? viewChatPicker(m) : null,
      m.reactions.length ? viewChatReactions(m) : null,
    ]);
  }
  // Réactions sous la bulle : une pastille par emoji (son nombre ; la tienne marquée), un clic met ou retire la tienne ;
  // qui l'a mise en info-bulle et pour les lecteurs d'écran.
  function viewChatReactions(m) {
    return h('div', { class: 'chat-reacts' }, m.reactions.map((r) => h('button', {
      key: r.emoji, class: ['chat-react', { mine: r.mine }], type: 'button', 'aria-pressed': r.mine ? 'true' : 'false', title: reactWho(r),
      'aria-label': `${r.emoji} ${r.n} : ${reactWho(r)}. ${r.mine ? 'Retirer ta réaction' : 'Réagir aussi'}`, onClick: () => toggleReaction(m, r.emoji),
    }, [h('span', { class: 'chat-react__e', 'aria-hidden': 'true' }, r.emoji), h('span', { class: 'chat-react__n', 'aria-hidden': 'true' }, String(r.n))])));
  }
  // Choix des réactions (« Réagir ») : les emojis de CHAT_REACTIONS, ceux que tu as déjà mis marqués (les choisir les
  // retire) ; flèches gauche et droite d'un emoji à l'autre, Échap ferme.
  function viewChatPicker(m) {
    const mine = new Set(m.reactions.filter((r) => r.mine).map((r) => r.emoji));
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); closeChatPicker(true); return; }
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const list = [...e.currentTarget.querySelectorAll('button')];
      const i = list.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length].focus();
    };
    return h('div', { class: 'chat-pick', role: 'group', 'aria-label': 'Choisir une réaction', onKeydown: onKey }, CHAT_REACTIONS.map((emoji) => h('button', {
      key: emoji, class: ['chat-pick__e', { mine: mine.has(emoji) }], type: 'button', 'aria-pressed': mine.has(emoji) ? 'true' : 'false',
      title: mine.has(emoji) ? 'Retirer ta réaction' : null, onClick: () => toggleReaction(m, emoji),
    }, emoji)));
  }
  // Message auquel il répond, au-dessus du texte : son auteur et un extrait ; un clic y mène (s'il est chargé). Supprimé
  // ou purgé : « message supprimé », sans lien.
  function viewChatQuote(q) {
    if (q.gone) return h('div', { class: 'chat-quote gone' }, 'En réponse à un message supprimé');
    const who = (q.mine && S.me && S.me.user && S.me.user.name) || q.author || 'Sans prénom';
    return h('button', { class: ['chat-quote', { mine: q.mine }], type: 'button', title: 'Voir le message cité', onClick: () => showChatMsg(q.id) }, [
      h('span', { class: 'chat-quote__who' }, q.mine ? `${who} (toi)` : who),
      h('span', { class: 'chat-quote__text' }, q.text),
    ]);
  }
  // Membre cité, dans le texte : son prénom en lien vers son classeur (« Mes cartes » pour toi), avec son pseudo dans le
  // jeu en info-bulle ; sans lien (tu ne montres pas tes cartes, ou lui plus les siennes) : son prénom seul ; « classeur
  // supprimé » en italique.
  function viewChatMemberLink(p) {
    const ref = p.member;
    if (ref.gone) return h('span', { class: 'chat-col gone', title: 'Ce classeur a été supprimé' }, p.text);
    const tip = ref.pseudo ? ` (pseudo dans le jeu : ${ref.pseudo})` : '';
    if (ref.mine) return h('a', { class: 'chat-col chat-user', href: '#/cartes', title: 'Toi : ouvrir tes cartes' }, p.text);
    return ref.pid ? h('a', { class: 'chat-col chat-user', href: '#/ami/' + encodeURIComponent(ref.pid), title: `Ouvrir le classeur de ${ref.name}${tip}` }, p.text)
      : h('span', { class: 'chat-col chat-user', title: sharing() ? `${ref.name} ne montre pas ses cartes` : 'Montre tes cartes (Réglages) pour ouvrir son classeur' }, p.text);
  }
  // Aperçu sous le message (le premier membre cité) : prénom, pseudo dans le jeu (lien vers son profil du jeu) et quelques
  // chiffres de son classeur : cartes différentes, collections (et combien sont complètes), valeur. Ceux d'un ami viennent
  // d'« Entre amis » (ses cartes et ses collections, s'il les montre) ; les tiens, de ton classeur.
  function viewChatMemberEmbed(ref) {
    if (!ref) return null;
    let st = null;
    let pseudo = ref.pseudo;
    let href = null;
    if (ref.mine) {
      const all = collections.value.all;
      st = { cards: cards.value.length, cols: all.length, done: all.filter((col) => { const p = progressOf(col); return p.total > 0 && p.own >= p.total; }).length,
        worth: M.value && M.value.priced ? M.value.value : null };
      pseudo = (S.me && S.me.user && S.me.user.pseudo) || null;
      href = '#/cartes';
    } else if (ref.pid) {
      void qidVersion.value;
      href = '#/ami/' + encodeURIComponent(ref.pid);
      const f = friendList.value.find((x) => x.id === ref.pid);
      if (f && f.cards) {
        const fw = friendWorths.value.get(f.id);
        let done = null;
        if (f.targets) {
          const index = friendIndexOf(f.id);
          done = f.targets.filter((t) => { const p = friendProgressFor(index, t); return p.total > 0 && p.own >= p.total; }).length;
        }
        st = { cards: f.count, cols: f.tshare ? f.tcount : null, done, worth: fw && fw.priced ? fw.value : null };
        pseudo = f.pseudo || pseudo;
      }
    }
    const why = st || ref.mine ? null : !sharing() ? 'Montre tes cartes (Réglages) pour voir son classeur.'
      : !ref.pid ? 'Ne montre pas ses cartes.' : friendsJob ? 'Lecture de son classeur…' : null;
    const fig = (n, one, many) => h('span', { class: 'chat-member__fig' }, [h('b', null, fmt(n)), ' ' + plural(n, one, many)]);
    return h('div', { class: 'chat-embed chat-embed--light chat-member' }, [
      h('span', { class: 'avatar sm', 'aria-hidden': 'true' }, initialOf(ref.name)),
      h('span', { class: 'chat-embed__info' }, [
        h('span', { class: 'chat-member__head' }, [
          href ? h('a', { class: 'chat-embed__name', href }, ref.mine ? `${ref.name} (toi)` : ref.name) : h('span', { class: 'chat-embed__name' }, ref.name),
          pseudo ? h('a', { class: 'chat-member__pseudo', href: gameProfileUrl(pseudo), target: '_blank', rel: 'noopener noreferrer', title: 'Son profil dans le jeu' }, pseudo + ' ↗') : null,
        ]),
        st ? h('span', { class: 'chat-member__figs' }, [
          fig(st.cards, 'carte', 'cartes'),
          st.cols === null ? h('span', { class: 'chat-member__fig muted' }, 'collections non partagées')
            : [fig(st.cols, 'collection', 'collections'), st.done !== null && st.cols ? h('span', { class: 'chat-member__fig' }, [h('b', null, fmt(st.done)), ' ' + plural(st.done, 'complète', 'complètes')]) : null],
          st.worth !== null ? h('span', { class: 'chat-member__fig', title: ref.mine ? 'Valeur de ton classeur (onglet « Marché »)' : FRIEND_WORTH }, ['valeur ', priceTag(st.worth)]) : null,
        ]) : null,
        why ? h('span', { class: 'chat-embed__why', role: ref.pid ? 'status' : null }, why) : null,
      ]),
    ]);
  }
  // Collection citée, dans le texte : un lien vers elle (son nom), sinon son nom seul (tu ne montres pas tes cartes), ou
  // « collection non partagée » (effacée, ou que son propriétaire ne montre plus).
  function viewChatColLink(p) {
    const ref = p.col;
    if (ref.gone) return h('span', { class: 'chat-col gone', title: "Cette collection a été effacée, ou son propriétaire ne la montre plus" }, p.text);
    const owner = ref.mine ? 'Ta collection' : `Collection de ${ref.owner || 'quelqu\'un'}`;
    const href = chatRefHref(ref);
    return href ? h('a', { class: 'chat-col', href, title: owner + ' : l\'ouvrir' }, p.text)
      : h('span', { class: 'chat-col', title: owner + ' : montre tes cartes (Réglages) pour l\'ouvrir' }, p.text);
  }
  // Aperçu sous le message (la première collection citée) : sa ligne, comme dans tes collections ou le classeur de l'ami
  // (éventail, progression, ce que tu peux lui donner) ; sinon son nom et son propriétaire, et pourquoi pas plus.
  function viewChatColEmbed(ref) {
    if (!ref) return null;
    let row = null;
    if (ref.mine) {
      const col = collections.value.all.find((c) => c.id === ref.id);
      if (col) row = viewRow(col);
    } else if (ref.pid) {
      void qidVersion.value;
      const f = friendList.value.find((x) => x.id === ref.pid);
      const t = f && f.targets ? f.targets.find((x) => x.id === ref.id) : null;
      if (t) row = viewFriendColRow(f, { t, key: 'chat:' + t.id, p: friendProgressFor(friendIndexOf(f.id), t) });
    }
    if (row) return h('div', { class: 'chat-embed' }, [row]);
    const why = ref.mine ? null : !sharing() ? 'Montre tes cartes (Réglages) pour voir sa progression.'
      : ref.pid && friendsJob ? 'Lecture de sa progression…' : null;
    return h('div', { class: 'chat-embed chat-embed--light' }, [
      icon('album', 'sm'),
      h('span', { class: 'chat-embed__info' }, [
        h('span', { class: 'chat-embed__name' }, ref.name),
        h('span', { class: 'chat-embed__owner' }, ref.mine ? 'Ta collection' : `Collection de ${ref.owner || 'quelqu\'un'}`),
        why ? h('span', { class: 'chat-embed__why', role: ref.pid ? 'status' : null }, why) : null,
      ]),
    ]);
  }
  // Message système (nouveautes.json) : une ligne discrète, centrée, en petit, sans auteur ni bulle, avec un lien vers la
  // page « Nouveautés ».
  function viewChatSystem(m) {
    return h('p', { key: 'sys-' + m.id, class: 'chat-sys' }, [
      h('span', { class: 'chat-sys__text' }, m.text),
      ' · ', h('a', { href: '#/nouveautes' }, 'Voir les nouveautés'),
      ' · ', h('time', { datetime: m.at, title: dateLong(m.at) }, chatWhen(m.at)),
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
      : ac.kind === 'u' ? (!sharing() ? 'Seuls les membres qui montrent leurs cartes peuvent être cités, et il faut montrer les tiennes (Réglages) pour les voir ici.'
        : chatMembersJob && !chatUserChoices.value.length ? 'Lecture des membres…' : `Aucun membre${ac.q.trim() ? ` ne s'appelle « ${ac.q.trim()} »` : ' ne montre ses cartes pour l\'instant'}.`)
      : ac.kind === 'c' ? (sharing() && friendsJob ? 'Lecture des collections des membres…'
        : `Aucune collection${ac.q.trim() ? ` ne s'appelle « ${ac.q.trim()} »` : ''}${sharing() ? '' : ' parmi les tiennes (montre tes cartes, Réglages, pour citer celles des autres membres)'}.`)
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
        : it.hint ? h('span', { class: 'prop-list__hint', title: it.col || it.self ? null : 'Pseudo dans le jeu' }, it.hint) : null,
    ]);
    return h('form', { class: 'chat-form', onSubmit: (e) => { e.preventDefault(); sendChat(false); } }, [
      c.reply ? h('div', { class: 'chat-replying', id: 'chat-replying' }, [
        icon('reply', 'sm'),
        h('span', { class: 'chat-replying__info' }, [
          h('span', { class: 'chat-replying__who' }, `Réponse à ${c.reply.author}${c.reply.mine ? ' (toi)' : ''}`),
          h('span', { class: 'chat-replying__text' }, c.reply.text),
        ]),
        h('button', { class: 'chat-replying__x', type: 'button', title: 'Ne plus répondre à ce message (Échap)', 'aria-label': 'Annuler la réponse',
          onClick: () => { c.reply = null; nextTick(() => { const t = document.getElementById('chat-input'); if (t) t.focus(); }); } }, '×'),
      ]) : null,
      h('label', { class: 'sr', for: 'chat-input' }, 'Ton message'),
      h('div', { class: 'chat-field' }, [
        h('textarea', { id: 'chat-input', class: 'chat-input', rows: 2, maxlength: CHAT_MAX, value: c.draft, placeholder: c.reply ? 'Ta réponse…' : 'Écris un message…', 'aria-describedby': c.reply ? 'chat-replying chat-hint chat-tip' : 'chat-hint chat-tip',
          role: 'combobox', 'aria-multiline': 'true', 'aria-expanded': String(open), 'aria-controls': 'chat-ac', 'aria-autocomplete': 'list',
          'aria-activedescendant': open ? 'chat-ac-' + act : null,
          onInput: (e) => { c.draft = e.target.value; if (c.sendError) c.sendError = ''; chatTouch(); updateChatAc(e.target); }, onKeydown: onChatKey,
          // Curseur déplacé (flèches, clic) : la liste suit le @ ou le # sous le curseur.
          onKeyup: (e) => { if (/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) updateChatAc(e.target); },
          onClick: (e) => updateChatAc(e.target),
          onBlur: () => { c.ac = null; stopChatWp(); } }),
        open ? h('ul', { id: 'chat-ac', class: 'prop-list chat-ac', role: 'listbox', 'aria-label': ac.kind === '@' ? 'Membres à mentionner' : ac.kind === 'u' ? 'Membres à citer' : ac.kind === 'c' ? 'Collections à citer' : 'Cartes à citer' }, list.map(option))
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
        ', ou « Partager dans le chat » depuis sa fiche. Pour une collection : ', h('code', null, '#c:'), ' puis son nom, ou colle son lien. Pour un membre : ', h('code', null, '@'),
        ' puis son prénom pour le mentionner, ', h('code', null, '#u:'), ' pour montrer son classeur.']),
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
          h('div', { class: 'chat-list' }, list.length ? chatTimeline.value.map((m) => (m.sys ? viewChatSystem(m) : viewChatMsg(m)))
            : [...chatSystem.value.map(viewChatSystem), h('p', { class: 'chat-empty' }, empty)]),
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

  // ================================================================ rendu : page Nouveautés
  // Le journal des versions, la plus récente en haut : date à gauche (au-dessus sur téléphone), puis une rubrique par
  // thème, une ligne par changement, avec un lien vers la vue concernée.
  const newsDate = (day) => { const d = dateOf(day + 'T12:00:00Z'); return d ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : day; };
  // Texte d'un changement : `code` en <code>, le reste en texte brut.
  const newsText = (t) => t.split(/`([^`\n]{1,80})`/).map((x, i) => (i % 2 ? h('code', null, x) : x));
  function viewNews() {
    const list = news.value.versions;
    const st = S.news.status;
    const head = h('div', { class: 'section-head' }, [h('h2', { id: 'h-news' }, 'Nouveautés'), h('small', null, 'Ce qui a changé dans le classeur')]);
    if (!list.length) {
      return h('div', { class: 'news' }, [head, st === 'error'
        ? h('div', { class: 'chat-error' }, [h('p', { class: 'status err', role: 'alert' }, "Les nouveautés n'ont pas pu être lues."),
          h('button', { class: 'btn small', type: 'button', onClick: () => loadNews(true) }, 'Réessayer')])
        : h('p', { class: 'muted' }, st === 'ready' ? "Rien de neuf pour l'instant." : 'Chargement…')]);
    }
    return h('div', { class: 'news' }, [head, h('ol', { class: 'news-list' }, list.map((v) => h('li', { key: v.id, id: 'v-' + v.id, class: 'news-ver' }, [
      h('div', { class: 'news-ver__when' }, [
        h('time', { datetime: v.date }, newsDate(v.date)),
        S.news.fresh.includes(v.id) ? h('span', { class: 'news-new' }, 'Nouveau') : null,
      ]),
      h('div', { class: 'news-ver__body' }, [
        v.title ? h('h3', { class: 'news-ver__title' }, v.title) : null,
        v.intro ? h('p', { class: 'news-ver__intro' }, newsText(v.intro)) : null,
        ...v.sections.map((g, i) => h('section', { key: i, class: 'news-group' }, [
          h('h4', null, [g.icon ? h('span', { class: 'news-group__icon', 'aria-hidden': 'true' }, g.icon) : null, g.title]),
          h('ul', null, g.items.map((it, j) => h('li', { key: j }, [...newsText(it.text),
            it.to ? [' ', h('a', { class: 'news-go', href: it.to }, [it.link, ' →'])] : null]))),
        ])),
      ]),
    ])))]);
  }

  // ================================================================ rendu : onglet Marché, cotes des fiches
  const MARKET_RULES = "Les cotes et la lecture du marché sont faites par le classeur, dans la base du jeu, avec le compte que tu as relié (onglet « Synchro ») : une passe par membre toutes les 20 minutes tant que la synchro automatique est active, qui relit aussi les cotes de tes cartes, les plus anciennes d'abord ; et à ton clic sur « Actualiser le marché » (une fois par minute au plus), une passe plus courte : tes enchères, tes ventes, les bonnes affaires et leurs cotes. Chaque passe fait au plus 30 requêtes, une par seconde, sans passer par les pages du marché du jeu, qui limitent les outils automatiques. C'est plus risqué qu'une synchro de ta collection : si le jeu limite les lectures, la passe s'arrête et la suivante est sautée. Au clic, et seulement là, le classeur met une de tes cartes en vente, annule une vente sans mise ou mise sur une enchère, à ton nom, avec ta session ; le reste se fait dans le jeu.";
  const MARKET_HOW = "Pas encore de cote : relie ton compte du jeu (onglet « Synchro ») : le classeur les lit tout seul toutes les 20 minutes (« Actualiser le marché » ne relit que tes enchères, tes ventes et les bonnes affaires).";
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
  // Où en est la lecture du marché : son âge, le dernier essai raté (et pourquoi), ou jamais lue (et quoi faire). Une ligne
  // par fait, en tête de l'onglet.
  function viewMarketRead() {
    const a = M.attempt;
    const out = [];
    const old = !!M.liveAt && Date.now() - Date.parse(M.liveAt) > MARKET_OLD;
    if (M.liveAt) {
      out.push(h('p', { class: ['small', old ? 'warn' : 'muted'], key: 'age' }, [`Lecture du marché par le classeur : ${agoText(M.liveAt)} (${dateShort(M.liveAt)}).`,
        old ? " Elle date de plus de 2 h : des enchères ont pu finir ou monter. Clique « Actualiser le marché » (le classeur la refait toutes les 20 minutes quand la synchro automatique est active)." : '']));
    } else if (a && a.ok === true) {
      out.push(h('p', { class: 'small muted', key: 'age' }, `Cotes lues par le classeur ${agoText(a.end || a.start)} ; sa lecture du marché (bonnes affaires, tes enchères) n'est pas arrivée : clique « Actualiser le marché ».`));
    } else if (!a) {
      out.push(h('p', { class: 'small warn', key: 'age' }, "Le classeur n'a pas encore lu le marché : relie ton compte (onglet « Synchro ») ou clique « Actualiser le marché »."));
    }
    const sc = M.scan;
    if (sc && sc.fresh) {
      out.push(h('p', { class: 'small muted', key: 'scan' }, `Marché entier lu par le classeur ${agoText(sc.full_at)} : les bonnes affaires sont cherchées sur toutes les cartes qui te manquent.${sc.running ? ' Une relecture complète est en cours.' : ''}`));
    } else if (sc) {
      out.push(h('p', { class: 'small muted', key: 'scan' }, `${sc.running ? 'Lecture du marché entier en cours.' : "Le marché entier n'a pas été lu depuis plus de 36 h."} En attendant, les bonnes affaires sont cherchées sur 500 cartes qui te manquent au plus.`));
    }
    if (sc && sc.mine && sc.last_at && sc.last_result) {
      out.push(h('p', { class: 'small muted', key: 'scanlast' }, `Dernier passage sur le marché entier (avec ton compte), ${agoText(sc.last_at)} : ${sc.last_result.replace(/^marché entier : /, '')}.`));
    }
    if (a && a.ok === false && a.why) {
      out.push(h('p', { class: 'status err', role: 'status', key: 'fail' }, `Dernier essai, ${agoText(a.end || a.start)}${a.auto ? ' (automatique)' : ''} : ${a.why}`));
    } else if (a && !a.end && Date.now() - Date.parse(a.start) > 10 * 60000) {
      out.push(h('p', { class: 'small warn', key: 'fail' }, `Une lecture commencée ${agoText(a.start)} n'a pas abouti : réessaie « Actualiser le marché ».`));
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
  // échangée…), une seule par carte (la moins chère : une lecture en a parfois plusieurs ; more =
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
  // Bonnes affaires de la dernière lecture passées aux filtres (dealFilter) : all = toutes celles encore valables, avec leurs
  // collections ; pass = celles qui passent les filtres du panneau ; list = et les collections incluses et exclues, dans l'ordre
  // choisi ; options = les collections que remplissent celles de pass, de celle qui en a le plus à celle qui en a le moins (une
  // collection incluse ou exclue y reste à 0 tant qu'elle existe) ; inc, exc = les collections incluses et exclues qui existent.
  function filteredDeals(live) {
    const { list: deals, ended, owned } = dealsOf(live);
    const f = dealFilter.value;
    const now = Date.now();
    const all = deals.map((x) => ({ x, cols: membershipsOfItem({ title: x.t }) }));
    const pass = all.filter((d) => dealMatches(d.x, f, now));
    const counts = new Map();
    for (const d of pass) for (const c of d.cols) counts.set(c.key, { col: c, n: ((counts.get(c.key) || {}).n || 0) + 1 });
    for (const k of [...f.cols, ...f.xcols]) {
      if (counts.has(k)) continue;
      const col = collections.value.all.find((c) => c.key === k);
      if (col) counts.set(col.key, { col, n: 0 });
    }
    const options = [...counts.values()].sort((a, b) => b.n - a.n || COLLATOR.compare(a.col.name, b.col.name));
    const inc = f.cols.filter((k) => counts.has(k));
    const exc = f.xcols.filter((k) => counts.has(k));
    const list = pass.filter((d) => (!inc.length || d.cols.some((c) => inc.includes(c.key))) && !d.cols.some((c) => exc.includes(c.key)))
      .sort((a, b) => DEAL_ORDER[f.sort](a.x, b.x));
    return { all, pass, list, options, inc, exc, ended, owned };
  }
  // Panneau des filtres (ouvert ou fermé, gardé dans ce navigateur : MP.open.filtres) : % de la cote, prix, économie,
  // rareté, brillance, mise, fin, ventes ; « Effacer les filtres », « Enregistrer ces filtres… ».
  function viewDealFilters(f) {
    const amount = (id, label, k, hint) => h('label', { class: 'sell-min' }, [label,
      h('input', { id, class: 'field', type: 'number', min: '0', step: '10', inputmode: 'numeric', value: f[k] == null ? '' : f[k], placeholder: hint,
        onInput: (e) => setDealAmount(k, e.target.value) }), h('span', { class: 'w', 'aria-hidden': 'true' }, 'W')]);
    const group = (label, body) => h('div', { class: 'deal-filters__row' }, [h('span', { class: 'deal-filters__label' }, label), body]);
    const segs = (label, cur, opts, set) => h('div', { class: 'seg seg--four', role: 'group', 'aria-label': label }, opts.map(([v, l]) => seg(l, cur === v, () => set(v))));
    return h('div', { class: 'deal-filters', id: 'deal-filters' }, [
      group('Prix demandé', h('div', { class: 'deal-filters__pct' }, [
        h('label', { class: 'sell-min' }, ['au plus ',
          h('input', { id: 'deal-pct', class: 'field', type: 'number', min: '1', max: '100', step: '5', inputmode: 'numeric', value: f.pct, onInput: (e) => setDealPct(e.target.value, true) }),
          ' % de la cote']),
        h('div', { class: 'chips' }, DEAL_PCTS.map((n) => h('button', { key: n, type: 'button', class: ['chip-btn', { on: f.pct === n }], 'aria-pressed': String(f.pct === n), onClick: () => setDealFilter({ pct: n }) }, `${n} %`))),
      ])),
      h('label', { class: 'check' }, [h('input', { id: 'deal-soon', type: 'checkbox', checked: f.soon, onChange: () => setDealFilter({ soon: !f.soon }) }),
        ' Montrer aussi celles qui finissent bientôt sans mise (moins de 2 h, au plus à la cote)']),
      group('Prix', h('div', { class: 'deal-filters__amounts' }, [amount('deal-min', 'de ', 'min', '0'), amount('deal-max', 'à ', 'max', 'sans limite')])),
      group('Économie', amount('deal-save', 'au moins ', 'save', '0')),
      group('Rareté', h('div', { class: 'chips', role: 'group', 'aria-label': 'Rareté' }, RARITIES.map((r) => h('button', {
        key: r, type: 'button', class: ['chip-btn', { on: f.r.includes(r) }], 'aria-pressed': String(f.r.includes(r)), title: RARITY_NAME[r], onClick: () => toggleDealRarity(r) }, r)))),
      group('Brillante', segs('Brillante', f.shiny, [['', 'Peu importe'], ['only', 'Seulement'], ['no', 'Exclure']], (v) => setDealFilter({ shiny: v }))),
      group('Enchère', segs('Enchère', f.bid, [['', 'Toutes'], ['bid', 'Avec mise'], ['nobid', 'Sans mise'], ['lead', 'Tu mènes']], (v) => setDealFilter({ bid: v }))),
      group('Fin', segs('Fin', f.end, DEAL_ENDS, (v) => setDealFilter({ end: v }))),
      group('Cote', segs('Ventes au moins', f.n, DEAL_SALES.map((n) => [n, `${n} ventes et +`]), (v) => setDealFilter({ n: v }))),
      h('div', { class: 'deal-filters__foot' }, [
        h('button', { class: 'btn small', type: 'button', disabled: !dealFilterWords(f).length, onClick: clearDealFilter }, 'Effacer les filtres'),
        DP.naming ? null : h('button', { class: 'btn small', type: 'button', onClick: () => Object.assign(DP, { naming: true, name: '', error: '' }) }, [icon('bookmark'), 'Enregistrer ces filtres…']),
      ]),
      DP.naming ? h('form', { class: 'deal-filters__save', onSubmit: (e) => { e.preventDefault(); saveDealPreset(); } }, [
        h('label', { class: 'sr', for: 'deal-preset-name' }, 'Nom des filtres'),
        h('input', { id: 'deal-preset-name', class: 'field', type: 'text', maxlength: DEAL_NAME_MAX, placeholder: 'Pépites UR, petits prix…', value: DP.name, onInput: (e) => { DP.name = e.target.value; DP.error = ''; } }),
        h('button', { class: 'btn small primary', type: 'submit' }, 'Enregistrer'),
        h('button', { class: 'btn small', type: 'button', onClick: () => Object.assign(DP, { naming: false, name: '', error: '' }) }, 'Annuler'),
        DP.error ? h('p', { class: 'status err', role: 'alert' }, DP.error) : h('p', { class: 'small muted' }, 'Avec les collections et le tri choisis. Un nom déjà pris est remplacé. Gardés avec ton compte : sur tous tes appareils.'),
      ]) : null,
    ]);
  }
  // Panneau des collections (MP.open.cols) : chaque collection que remplissent les affaires, avec leur nombre, « Inclure » ou
  // « Exclure » ; une recherche au-delà de 8 collections ; « Toutes les collections » libère tout.
  // Le bouton des collections : « Toutes les collections (12) », « Envies (3) », « 2 collections · 1 exclue (5) ».
  function dealColsLabel(options, inc, exc, nAll, n) {
    if (!inc.length && !exc.length) return `Toutes les collections (${fmt(nAll)})`;
    const what = inc.length === 1 ? options.find((o) => o.col.key === inc[0]).col.name : inc.length ? `${fmt(inc.length)} collections` : 'Toutes les collections';
    return `${what}${exc.length ? ` · ${fmt(exc.length)} ${plural(exc.length, 'exclue', 'exclues')}` : ''} (${fmt(n)})`;
  }
  function viewDealCols(options, inc, exc) {
    const q = normName(DP.q || '');
    const shown = q ? options.filter((o) => normName(o.col.name).includes(q)) : options;
    return h('div', { class: 'deal-filters deal-cols', id: 'deal-cols' }, [
      h('p', { class: 'small muted' }, "Inclure : seulement les cartes d'au moins une des collections incluses. Exclure : jamais les cartes d'une collection exclue."),
      options.length > 8 ? h('label', { class: 'deal-cols__q' }, [h('span', { class: 'sr' }, 'Chercher une collection'),
        h('input', { id: 'deal-cols-q', class: 'field', type: 'search', placeholder: 'Chercher une collection…', value: DP.q, onInput: (e) => { DP.q = e.target.value; } })]) : null,
      shown.length ? h('ul', { class: 'deal-cols__list' }, shown.map((o) => {
        const mode = inc.includes(o.col.key) ? 'in' : exc.includes(o.col.key) ? 'out' : '';
        return h('li', { key: o.col.key, class: ['deal-cols__row', mode] }, [
          h('span', { class: 'deal-cols__name' }, [o.col.name, h('span', { class: 'muted' }, ` (${fmt(o.n)})`)]),
          h('div', { class: 'seg', role: 'group', 'aria-label': o.col.name }, [
            seg('Inclure', mode === 'in', () => setDealCol(o.col.key, 'in')),
            seg('Exclure', mode === 'out', () => setDealCol(o.col.key, 'out')),
          ]),
        ]);
      })) : h('p', { class: 'muted' }, options.length ? 'Aucune collection ne correspond.' : 'Aucune de ces affaires ne sert à tes collections.'),
      h('div', { class: 'deal-filters__foot' }, [h('button', { class: 'btn small', type: 'button', disabled: !inc.length && !exc.length, onClick: clearDealCols }, 'Toutes les collections')]),
    ]);
  }
  function viewDeals(live) {
    if (!live) return h('p', { class: 'muted' }, "Pas de lecture du marché : clique « Actualiser le marché » en haut de l'onglet (le classeur la refait ensuite toutes les 20 minutes).");
    const f = dealFilter.value;
    const { all, pass, list, options, inc, exc, ended, owned } = filteredDeals(live);
    const hidden = [ended ? `${fmt(ended)} ${plural(ended, 'enchère finie', 'enchères finies')} depuis la lecture` : '', owned ? `${fmt(owned)} ${plural(owned, 'carte que tu as maintenant', 'cartes que tu as maintenant')}` : ''].filter(Boolean);
    const note = hidden.length ? h('p', { class: 'small muted' }, `Plus montrées : ${hidden.join(', ')}.`) : null;
    if (!all.length) return [h('p', { class: 'muted' }, 'Aucune bonne affaire à ta dernière lecture.'), note];
    const words = dealFilterWords(f);
    const open = !!MP.open.filtres;
    const colsOpen = !!MP.open.cols;
    const colWords = dealColWords({ cols: inc, xcols: exc });
    const presets = dealPresets.value;
    const bar = h('div', { class: 'deal-bar' }, [
      h('button', { class: ['btn', 'small', 'deal-col', { on: inc.length || exc.length }], type: 'button', id: 'deal-cols-btn', 'aria-expanded': String(colsOpen), 'aria-controls': 'deal-cols',
        onClick: () => toggleMarketSection('cols') }, [icon('album'), dealColsLabel(options, inc, exc, pass.length, list.length)]),
      h('label', { class: 'deal-sort' }, [h('span', { class: 'sr' }, 'Trier'),
        h('select', { id: 'deal-sort', class: 'field', value: f.sort, onChange: (e) => setDealFilter({ sort: e.target.value }) }, DEAL_SORTS.map(([v, l]) => h('option', { key: v, value: v }, l)))]),
      h('button', { class: ['btn', 'small', { on: words.length }], type: 'button', id: 'deal-filters-btn', 'aria-expanded': String(open), 'aria-controls': 'deal-filters',
        onClick: () => toggleMarketSection('filtres') }, [icon('filter'), words.length ? `Filtres · ${fmt(words.length)}` : 'Filtres']),
    ]);
    const chips = presets.length ? h('div', { class: 'chips deal-presets', role: 'group', 'aria-label': 'Filtres enregistrés' }, presets.map((p) => {
      const on = sameDealFilter(p.f, f);
      return h('span', { key: p.name, class: ['chip', { on }] }, [
        h('button', { class: 'chip__label linkish', type: 'button', 'aria-pressed': String(on), title: [...dealColWords(p.f), ...dealFilterWords(p.f)].join(' · ') || 'Filtres par défaut', onClick: () => applyDealPreset(p) }, p.name),
        h('button', { class: 'x', type: 'button', 'aria-label': `Supprimer les filtres « ${p.name} »`, title: 'Supprimer', onClick: () => deleteDealPreset(p) }, [icon('x', 'sm')]),
      ]);
    })) : null;
    const summary = words.length || colWords.length
      ? h('p', { class: 'small muted deal-summary' }, [`${fmt(list.length)} ${plural(list.length, 'affaire', 'affaires')} sur ${fmt(all.length)} · ${[...colWords, ...words].join(', ')}. `,
        words.length ? h('button', { class: 'linkish', type: 'button', onClick: clearDealFilter }, 'Effacer les filtres') : null])
      : null;
    return [bar, chips, colsOpen ? viewDealCols(options, inc, exc) : null, open ? viewDealFilters(f) : null, summary,
      list.length ? h('ul', { class: 'lots' }, list.slice(0, marketShown('acheter')).map(({ x, cols }) => {
        const soon = !x.bid && Date.parse(x.end) - Date.now() < DEAL_SOON_MS;
        return h('li', { key: x.a, class: 'lot' }, [
          lotTitle(x, copyNameButton(x.t)),
          h('span', { class: 'lot__line' }, [priceTag(x.ask), x.bid ? ' (enchère en cours)' : ' (prix de départ, sans enchère)', vsCote(x.ask, x),
            x.cote > x.ask ? h('span', { class: 'lot__save' }, [' · économie ', priceTag(x.cote - x.ask, { tag: 'span' })]) : null]),
          h('span', { class: 'lot__meta small' }, [soon ? h('span', { class: 'flag' }, 'finit bientôt') : null, x.lead ? h('span', { class: 'flag ok' }, 'tu mènes') : null, leftText(x.end),
            cols.length ? ` · pour ${cols.slice(0, 2).map((c) => `« ${c.name} »`).join(', ')}${cols.length > 2 ? '…' : ''}` : '',
            x.more ? ` · ${fmt(x.more)} ${plural(x.more, 'autre enchère intéressante', 'autres enchères intéressantes')} sur cette carte` : '', gameLink(x.a), x.lead ? null : bidButton(x, 'lot__bid')]),
        ]);
      })) : h('p', { class: 'muted' }, 'Aucune bonne affaire ne passe ces filtres.'),
      marketMoreButton('acheter', list.length), note];
  }
  // « Bonnes affaires à vendre » : seuil (« Valeur minimale : [100]W »), puis tes cartes dont la cote l'atteint, de la plus
  // chère à la moins chère : rareté et brillance de l'exemplaire, titre (sa fiche), « ×3 » ou « 2 en trop », « Copier le
  // nom », cote, dernière vente.
  function viewSell() {
    const { list, unpriced, onSale, kept: excluded } = sellOffers.value;
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
            h('span', { class: 'lot__meta small' }, [h('button', { class: 'linkish', type: 'button', 'aria-label': `Mettre en vente « ${c.title} »`, onClick: () => openSell(c, x.k) }, 'Mettre en vente')]),
          ]);
        })) : h('p', { class: 'muted' }, list.length ? `Aucune carte à vendre à ${wfmt(MP.min)} ou plus.` : 'Aucune carte à vendre : toutes tes cartes servent à tes collections, ou ne sont pas encore cotées.'),
      M.loaded ? marketMoreButton('vendre', kept.length) : null,
      M.loaded && onSale ? h('p', { class: 'small muted' }, `${fmt(onSale)} ${plural(onSale, 'carte déjà en vente', 'cartes déjà en vente')} dans le jeu (« Mes enchères ») : pas ${onSale > 1 ? 'proposées' : 'proposée'} ici, même si ton classeur ${onSale > 1 ? 'les garde' : 'la garde'} encore.`) : null,
      M.loaded && excluded ? h('p', { class: 'small muted' }, [`${fmt(excluded)} ${plural(excluded, 'carte exclue', 'cartes exclues')} des échanges et des ventes : pas ${excluded > 1 ? 'proposées' : 'proposée'} ici. `,
        h('button', { class: 'linkish', type: 'button', onClick: showKept }, excluded > 1 ? 'Les voir' : 'La voir')]) : null,
      M.loaded && unpriced ? h('p', { class: 'small muted' }, `${fmt(unpriced)} ${plural(unpriced, 'carte', 'cartes')} sans cote fiable : le classeur les lit peu à peu, les plus anciennes d'abord, à chaque lecture automatique (toutes les 20 minutes).`) : null,
    ];
  }
  // « Mes ventes en cours » : une ligne par vente (rareté, titre : sa fiche), départ, enchère actuelle et cote, mises et
  // meneur lus sur le site du jeu, temps restant, « Ouvrir dans le jeu ↗ », et « Annuler la vente » tant qu'il n'y a
  // aucune mise.
  function viewOnSale(live) {
    if (!live) return [h('p', { class: 'muted' }, 'Tes ventes en cours apparaissent ici à la prochaine lecture du marché par le classeur.')];
    const list = runningSales.value;
    return [
      h('div', { class: 'market__head' }, [
        h('p', { class: 'small muted' }, `D'après la lecture du marché ${agoText(M.liveAt)}, et les ventes faites depuis le classeur ; mises relues sur le site du jeu. Une vente s'annule tant que personne n'a misé.`),
        list.length ? h('button', { class: 'linkish', type: 'button', disabled: Object.keys(SD.busy).length > 0, onClick: () => loadSaleDetails(true) }, Object.keys(SD.busy).length ? 'Lecture…' : 'Relire les mises') : null]),
      list.length ? h('ul', { class: 'lots' }, list.slice(0, marketShown('encours')).map((x) => {
        const d = SD.details[x.a] || null;
        const gone = !!(d && (d.gone || (d.status && d.status !== 'active')));
        const bids = d && !d.gone ? d.bids : null;
        const bid = gone ? false : d && !d.gone ? !!(d.bids || d.cur != null) : x.bid;
        const cur = d && !d.gone && d.cur != null ? d.cur : x.cur;
        return h('li', { key: x.a, class: 'lot' }, [
          lotTitle(x),
          h('span', { class: 'lot__line' }, ['départ ', priceTag(x.base, { tag: 'span' }), cur != null ? [' · enchère ', priceTag(cur, { tag: 'span' })] : '', vsCote(cur != null ? cur : x.base, x)]),
          h('span', { class: 'lot__meta small' }, gone ? [h('span', { class: 'flag' }, 'terminée ou retirée'), ' le jeu ne la montre plus en cours']
            : [h('span', { class: ['flag', { ok: bid }] }, bid ? (bids ? `${fmt(bids)} ${plural(bids, 'mise', 'mises')}` : 'enchère reçue') : 'sans enchère'),
              bid && d && d.leader ? `mène : ${d.leader}` : null, leftText(x.end), gameLink(x.a),
              bid ? h('span', { class: 'faint' }, 'plus annulable')
                : h('button', { class: 'linkish', type: 'button', 'aria-label': `Annuler la vente de « ${x.t} »`, onClick: () => askCancelSale(x.a, x.t) }, 'Annuler la vente'),
              SD.busy[x.a] ? h('span', { class: 'faint' }, 'mises…') : null]),
        ]);
      })) : h('p', { class: 'small muted' }, 'Aucune vente en cours. Mets une carte en vente depuis sa fiche, ou depuis « Bonnes affaires à vendre ».'),
      marketMoreButton('encours', list.length),
      SD.error ? h('p', { class: 'small warn', role: 'status' }, SD.error) : null,
    ];
  }
  const BID_STATE = { won: 'gagnée', lost: 'perdue', off: 'terminée' };
  const SALE_STATE = { sold: 'vendue', unsold: 'invendue', off: 'annulée ou terminée' };
  function viewMine(live) {
    if (!live) return h('p', { class: 'muted' }, 'Tes mises et tes ventes des 14 derniers jours apparaissent ici à la prochaine lecture du marché par le classeur.');
    const bids = Array.isArray(live.bids) ? live.bids : [];
    const sales = Array.isArray(live.sales) ? live.sales : [];
    return h('div', { class: 'mine' }, [
      h('h3', null, 'Tes mises'),
      bids.length ? h('ul', { class: 'lots' }, bids.slice(0, marketShown('mises')).map((x) => h('li', { key: x.a, class: 'lot' }, [
        lotTitle(x),
        h('span', { class: 'lot__line' }, ['ta mise ', priceTag(x.mine, { tag: 'span' }), x.cur != null ? [` · ${x.st === 'run' ? 'enchère actuelle' : 'prix final'} `, priceTag(x.cur, { tag: 'span' })] : '', vsCote(x.cur != null ? x.cur : x.mine, x)]),
        h('span', { class: 'lot__meta small' }, x.st === 'run' ? [h('span', { class: ['flag', { ok: x.lead }] }, x.lead ? 'tu mènes' : 'dépassée'), leftText(x.end), gameLink(x.a)]
          : [h('span', { class: ['flag', { ok: x.st === 'won' }] }, BID_STATE[x.st] || x.st), ` le ${dateDay(x.end)}`]),
      ]))) : h('p', { class: 'small muted' }, 'Aucune mise ces 14 derniers jours.'),
      marketMoreButton('mises', bids.length),
      h('h3', null, 'Tes ventes'),
      sales.length ? h('ul', { class: 'lots' }, sales.slice(0, marketShown('ventes')).map((x) => h('li', { key: x.a, class: 'lot' }, [
        lotTitle(x),
        h('span', { class: 'lot__line' }, ['départ ', priceTag(x.base, { tag: 'span' }), x.cur != null ? [` · ${x.st === 'sold' ? 'vendue' : 'enchère'} `, priceTag(x.cur, { tag: 'span' })] : '', vsCote(x.cur != null ? x.cur : x.base, x)]),
        h('span', { class: 'lot__meta small' }, x.st === 'run' ? [h('span', { class: ['flag', { ok: x.bid }] }, x.bid ? 'enchère reçue' : 'sans enchère'), leftText(x.end), gameLink(x.a),
          x.bid ? null : h('button', { class: 'linkish', type: 'button', 'aria-label': `Annuler la vente de « ${x.t} »`, onClick: () => askCancelSale(x.a, x.t) }, 'Annuler la vente')]
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
    const stamp = M.liveAt ? `lue par le classeur ${agoText(M.liveAt)}` : '';
    const live = M.live;
    const nDeals = live ? filteredDeals(live).list.length : 0;
    const nBids = live && Array.isArray(live.bids) ? live.bids.length : 0;
    const nSales = live && Array.isArray(live.sales) ? live.sales.length : 0;
    const nSell = M.loaded ? sellOffers.value.list.filter((x) => x.price >= MP.min).length : 0;
    // En haut, la valeur et où en est la lecture du marché (repliable comme les autres sections : repliée, le titre garde
    // la valeur) ; « Mes ventes en cours » ; puis côte à côte « à acheter » et « à vendre » (l'une sous l'autre sur un
    // écran étroit) ; « Mes enchères » (fermée par défaut) ; « À savoir ».
    return h('div', { class: 'market' }, [
      marketSection('valeur', 'Valeur de ton classeur', M.loaded && v ? wfmt(v.value) : '', () => [
        h('div', { class: 'market__head' }, [h('span', { class: 'spacer' }),
          M.scan && M.scan.mine ? h('button', { class: 'btn small ghost', type: 'button', disabled: M.busy || M.refreshing || M.scanning, onClick: scanWholeMarket,
            title: 'Relit toutes les enchères en cours du jeu avec ton compte (une fois par heure au plus)' },
            [icon('refresh', M.scanning ? 'spin' : ''), M.scanning ? 'Lecture du marché entier…' : 'Relire tout le marché']) : null,
          h('button', { class: 'btn small', type: 'button', disabled: M.busy || M.refreshing || M.scanning, onClick: refreshMarket },
            [icon('refresh', M.refreshing ? 'spin' : ''), M.refreshing ? 'Lecture…' : 'Actualiser le marché'])]),
        M.msg ? h('p', { class: M.msgErr ? 'status err' : 'small muted', role: 'status' }, M.msg) : null,
        !M.loaded ? (M.error ? errLine(M.error) : h('p', { class: 'muted', role: 'status' }, 'Lecture des cotes…')) : null,
        M.loaded && v ? h('p', { class: 'market__big' }, [priceTag(v.value), h('span', { class: 'muted' }, ` · ${fmt(v.priced)} ${plural(v.priced, 'carte cotée', 'cartes cotées')} sur ${fmt(v.cards)}`)]) : null,
        M.loaded && v && v.approx ? h('p', { class: 'small muted' }, `Dont ${fmt(v.approx)} ${plural(v.approx, 'carte comptée', 'cartes comptées')} dans sa plus haute rareté : le détail de leurs exemplaires arrive avec la prochaine relecture complète de ta collection.`) : null,
        M.loaded && v && !v.priced ? h('p', { class: 'muted' }, MARKET_HOW) : null,
        M.loaded ? viewValueChart(M.history) : null,
        h('p', { class: 'small muted' }, 'Valeur = somme des cotes fiables (3 ventes au moins) de chacun de tes exemplaires, selon sa rareté et s\'il est brillant ; cote = médiane des 30 dernières ventes sur 90 jours. Un point par jour.'),
        M.loaded && M.error ? errLine(M.error) : null,
        M.loaded ? h('div', { class: 'market__read' }, viewMarketRead()) : null,
      ], 'market__value'),
      marketSection('ventes', 'Mes ventes en cours', M.loaded && runningSales.value.length ? fmt(runningSales.value.length) : '', () => viewOnSale(live), 'market__wide'),
      marketSection('acheter', 'Bonnes affaires à acheter', nDeals ? fmt(nDeals) : '', () => [
        h('p', { class: 'small muted' }, `Enchères en cours sur des cartes qui manquent à tes collections, la moins chère par carte, au plus à la cote ; les filtres choisissent lesquelles montrer (par défaut : au plus 80 % de la cote, ou « finit bientôt » sans enchère).${stamp ? ' ' + cap(stamp) + '.' : ''}`),
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
    if (!p) return h('div', { class: 'cote' }, [h('h3', null, 'Cote'), h('p', { class: 'small muted' }, M.value && M.value.priced ? "Pas encore lue : le classeur la lira à une prochaine lecture automatique (les plus anciennes d'abord, toutes les 20 minutes)." : MARKET_HOW)]);
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
      approx ? h('p', { class: 'small muted' }, "Rareté de tes exemplaires pas encore connue : comptés dans celle de la carte (la prochaine relecture complète de ta collection la donne).") : null,
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

  // Lien vers une enchère dans le jeu (« Miser » le fait aussi depuis le classeur).
  const gameAuctionUrl = (id) => 'https://www.wiki-masters.com/marketplace/' + encodeURIComponent(id);
  const gameLink = (id, label) => h('a', { class: 'game-link', href: gameAuctionUrl(id), target: '_blank', rel: 'noopener noreferrer', title: "Ouvrir l'enchère dans WikiMasters" },
    [label || 'Ouvrir dans le jeu', ' ↗']);
  // Titre de la carte de la fiche ouverte (ta carte, celle d'un ami, une carte qui te manque), '' sans fiche.
  const ficheCardTitle = () => (openCard.value && openCard.value.title) || (S.openMissing && S.openMissing.title) || '';
  // Section « Marché dans le jeu » d'une fiche : enchères en cours sur la carte (de la moins chère à la plus chère), puis
  // la courbe de ses prix de vente. mine : ta carte (pour choisir la rareté de la courbe), s'il y en a une.
  function viewCardMarket(mine) {
    void CM.now;
    if (S.boot !== 'app') return null;
    const sess = (S.me && S.me.session) || {};
    if (!sess.linked) {
      return h('div', { class: 'cmk' }, [h('h3', null, 'Enchères en cours'),
        h('p', { class: 'small muted' }, ["Relie ton compte du jeu pour voir les enchères en cours sur cette carte et ses ventes : ",
          h('button', { class: 'linkish', type: 'button', onClick: () => { closeCard(); openSyncTab(); } }, 'onglet « Synchro »'), '.'])]);
    }
    const d = CM.data;
    const head = h('h3', { class: 'cmk__head' }, ['Enchères en cours ',
      d && d.auctions.length ? h('span', { class: 'hint-inline' }, `${fmt(d.auctions.length)}${d.more ? ' et plus' : ''}, de la moins chère à la plus chère · lues ${agoText(new Date(CM.at).toISOString())}`) : null,
      h('button', { class: 'linkish cmk__reload', type: 'button', disabled: CM.busy, onClick: () => loadCardMarket(CM.key, true) }, CM.busy ? 'Lecture…' : 'Relire')]);
    if (!d) {
      return h('div', { class: 'cmk' }, [head, CM.error ? errLine(CM.error) : h('p', { class: 'small muted', role: 'status' }, 'Lecture du marché du jeu…')]);
    }
    if (!d.card_id) return h('div', { class: 'cmk' }, [head, h('p', { class: 'small muted' }, "Aucune carte du jeu ne porte ce titre (pas encore tirée, ou un autre titre dans le jeu).")]);
    const list = auctionsByPrice(d.auctions);
    const shown = CM.all ? list : list.slice(0, CM_DETAILS);
    return h('div', { class: 'cmk' }, [
      head,
      CM.error ? errLine(CM.error) : null,
      list.length ? h('ul', { class: 'lots cmk__list' }, shown.map((a) => viewAuction(a, d))) : h('p', { class: 'small muted' }, 'Personne ne vend cette carte en ce moment.'),
      list.length > shown.length ? h('div', { class: 'show-more' }, [h('button', { class: 'btn small', type: 'button', onClick: () => { CM.all = true; } },
        `Afficher les ${fmt(list.length)} enchères`)]) : null,
      CM.detailError ? h('p', { class: 'small warn', role: 'status' }, CM.detailError) : null,
      list.length ? h('p', { class: 'small muted' }, `Mises, meneur et vendeur : lus sur le site du jeu pour les ${fmt(Math.min(CM_DETAILS, list.length))} moins chères (il limite les lectures automatiques).`) : null,
      viewSalesChart(d, mine),
    ]);
  }
  // Une enchère en cours de la fiche : rareté et brillance de l'exemplaire, prix à battre comparé à la cote de cette
  // rareté, temps restant, ATK / DEF, puis le détail lu sur le site du jeu (mises, meneur, vendeur, ta mise).
  function viewAuction(a, d) {
    const k = a.r + (a.s ? '*' : '');
    const q = (d.v && d.v[k]) || ((prices.value.get(String(d.card_id)) || {}).v || {})[k] || null;
    const det = CM.details[a.a] || null;
    const shown = det && det.cur != null && det.cur > a.ask ? det.cur : a.ask; // le site du jeu peut avoir vu une mise de plus
    const gap = reliable(q) && q.p > 0 ? Math.round(((shown - q.p) / q.p) * 100) : null;
    const left = Date.parse(a.end) - CM.now;
    const lead = det && !det.gone ? det.leading : a.lead;
    const own = a.mine || (det && det.selling);
    const mineBid = (det && det.my_bid) || ((M.live && Array.isArray(M.live.bids) ? M.live.bids.find((x) => x && x.a === a.a) : null) || {}).mine || null;
    const facts = [];
    if (own) facts.push(h('span', { class: 'flag ok', key: 'own' }, 'ta vente'));
    if (own && !a.bid && !(det && (det.bids || det.gone))) {
      facts.push(h('button', { class: 'linkish', type: 'button', key: 'cancel', onClick: () => askCancelSale(a.a) }, 'Annuler ma vente'));
    }
    // « Miser » : pas sur ta vente, ni quand tu mènes, ni depuis « Mettre en vente » (sa fenêtre la fermerait).
    const canBid = !own && !lead && !(det && det.gone) && left > 0 && S.modal !== 'sell' && !!ficheCardTitle();
    if (lead) facts.push(h('span', { class: 'flag ok', key: 'lead' }, 'tu mènes'));
    else if (mineBid) facts.push(h('span', { class: 'flag', key: 'out' }, ['dépassée · ta mise ', priceTag(mineBid, { tag: 'span' })]));
    if (det && det.gone) facts.push(h('span', { key: 'gone' }, "le jeu ne la connaît plus (finie ou retirée)"));
    else if (det) {
      if (det.bids) facts.push(h('span', { key: 'n' }, `${fmt(det.bids)} ${plural(det.bids, 'mise', 'mises')}${det.bidders > 1 ? ` de ${fmt(det.bidders)} joueurs` : ''}`));
      if (!lead && det.leader) facts.push(h('span', { key: 'l' }, `mène : ${det.leader}`));
      if (!own && det.seller) facts.push(h('span', { key: 's' }, `vendeur : ${det.seller}`));
    } else if (a.n != null && a.n > 0) facts.push(h('span', { key: 'n' }, `${fmt(a.n)} ${plural(a.n, 'mise', 'mises')}`));
    else if (CM.detailBusy[a.a]) facts.push(h('span', { key: 'busy', class: 'faint' }, 'détail…'));
    return h('li', { key: a.a, class: ['lot', 'auction', { lead, own }] }, [
      h('span', { class: 'auction__top' }, [
        h('span', { class: 'auction__price' }, [priceTag(shown),
          gap != null ? h('span', { class: ['auction__gap', gap <= -10 ? 'good' : gap >= 10 ? 'bad' : ''], title: `Cote ${variantName(k)} : ${wfmt(q.p)}` },
            `${gap > 0 ? '+' : gap < 0 ? '−' : ''}${fmt(Math.abs(gap))} % vs cote`)
            : q ? h('span', { class: 'auction__gap', title: 'Moins de 3 ventes : cote peu fiable' }, ['cote ', priceTag(q.p, { tag: 'span', approx: true })])
              : h('span', { class: 'auction__gap' }, 'pas de cote')]),
        pill(a.r), a.s ? h('span', { class: 'tag-mini' }, 'brillante') : null,
        h('span', { class: ['auction__clock', { hot: left < 3600000 }], title: 'Fin le ' + dateShort(a.end) }, [icon('clock', 'sm'), leftText(a.end).replace(/^encore /, '')]),
      ]),
      h('span', { class: 'lot__line small muted' }, [a.bid || (det && det.bids) ? 'enchère en cours' : `aucune mise, prix de départ`,
        a.atk != null || a.def != null ? ` · ATK ${a.atk != null ? fmt(a.atk) : '?'} · DEF ${a.def != null ? fmt(a.def) : '?'}` : '']),
      facts.length ? h('span', { class: 'lot__meta small' }, facts) : null,
      h('span', { class: 'auction__go' }, [gameLink(a.a), canBid ? bidButton({ a: a.a, t: ficheCardTitle(), r: a.r, s: a.s, ask: shown, bid: !!(a.bid || (det && det.bids) || (det && det.cur != null)),
        cur: det && det.cur != null ? det.cur : a.cur, end: a.end, cote: q ? q.p : null, n: q ? q.n : null }) : null]),
    ]);
  }
  // Prix de vente de la carte dans une rareté d'exemplaire (et brillance) : à chaque vente, la médiane des 30 dernières
  // (comme la cote) ; les ventes en points. Une puce par rareté vendue au moins deux fois.
  function viewSalesChart(d, mine) {
    const by = new Map();
    for (let i = d.sales.length - 1; i >= 0; i--) {
      const x = d.sales[i];
      if (!x || !VARIANT_RE.test(x.k) || !Number.isFinite(Date.parse(x.d))) continue;
      if (!by.has(x.k)) by.set(x.k, []);
      by.get(x.k).push(x);
    }
    const keys = [...by.keys()].filter((k) => by.get(k).length >= 2).sort(variantOrder);
    if (!keys.length) {
      return h('div', { class: 'cmk__sales' }, [h('h3', null, 'Prix de vente'),
        h('p', { class: 'small muted' }, d.sales.length ? `${fmt(d.sales.length)} ${plural(d.sales.length, 'vente', 'ventes')} seulement : pas de courbe.` : 'Jamais vendue dans le jeu.')]);
    }
    const prefer = mine ? variantsOf(mine).list.map(([k]) => k) : [];
    const most = (ks) => ks.reduce((b, k) => (by.get(k).length > by.get(b).length ? k : b), ks[0]);
    const auto = prefer.filter((k) => keys.includes(k)).length ? most(prefer.filter((k) => keys.includes(k))) : most(keys);
    const key = keys.includes(CM.variant) ? CM.variant : auto;
    const sales = by.get(key);
    const pts = sales.map((x, i) => ({ t: Date.parse(x.d), p: x.p, v: median(sales.slice(Math.max(0, i - 29), i + 1).map((y) => y.p)), d: x.d }));
    const W = 640;
    const H = 180;
    const L = 56;
    const R = 14;
    const T = 12;
    const B = 28;
    const all = pts.flatMap((p) => [p.p, p.v]);
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    if (lo === hi) { lo = Math.max(0, lo - 1); hi += 1; }
    const t0 = pts[0].t;
    const span = Math.max(1, pts[pts.length - 1].t - t0);
    const x = (t) => L + ((t - t0) / span) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const line = pts.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const hov = CM.hover >= 0 && CM.hover < pts.length ? CM.hover : -1;
    const sel = hov >= 0 ? pts[hov] : pts[pts.length - 1];
    const onMove = (e) => {
      const box = e.currentTarget && typeof e.currentTarget.getBoundingClientRect === 'function' ? e.currentTarget.getBoundingClientRect() : null;
      if (!box || !box.width) return;
      const px = ((e.clientX - box.left) / box.width) * W;
      let best = 0;
      pts.forEach((p, i) => { if (Math.abs(x(p.t) - px) < Math.abs(x(pts[best].t) - px)) best = i; });
      CM.hover = best;
    };
    const recent = sales.slice(-8).reverse();
    return h('div', { class: 'cmk__sales' }, [
      h('h3', null, ['Prix de vente ', h('span', { class: 'hint-inline' }, `médiane des 30 dernières ventes · ${fmt(sales.length)} ${plural(sales.length, 'vente', 'ventes')} depuis le ${dateDay(sales[0].d)}`)]),
      keys.length > 1 ? h('div', { class: 'cmk__keys', role: 'group', 'aria-label': "Rareté de l'exemplaire" }, keys.map((k) => h('button', {
        key: k, type: 'button', class: ['chip-btn', { on: k === key }], 'aria-pressed': String(k === key), onClick: () => { CM.variant = k; CM.hover = -1; },
      }, `${variantName(k)} · ${fmt(by.get(k).length)}`))) : h('p', { class: 'small muted' }, variantName(key)),
      h('figure', { class: 'chart' }, [
        h('figcaption', { class: 'chart__read', 'aria-live': 'polite' }, ['médiane ', priceTag(sel.v), ' · vente ', priceTag(sel.p, { tag: 'span' }), ` le ${dateDay(sel.d)}`]),
        h('svg', { class: 'chart__svg', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Prix de vente en ${variantName(key)} : médiane ${wfmt(pts[0].v)} le ${dateDay(pts[0].d)}, ${wfmt(pts[pts.length - 1].v)} le ${dateDay(pts[pts.length - 1].d)}.`,
          onPointermove: onMove, onPointerleave: () => { CM.hover = -1; } }, [
          ...[lo, (lo + hi) / 2, hi].flatMap((v, i) => [
            h('line', { key: 'g' + i, class: 'chart__grid', x1: L, x2: W - R, y1: y(v).toFixed(1), y2: y(v).toFixed(1) }),
            h('text', { key: 't' + i, class: 'chart__tick', x: L - 8, y: (y(v) + 4).toFixed(1), 'text-anchor': 'end' }, compact(Math.round(v))),
          ]),
          ...pts.map((p, i) => h('circle', { key: 's' + i, class: 'chart__sale', cx: x(p.t).toFixed(1), cy: y(p.p).toFixed(1), r: 2.5 })),
          h('polyline', { class: 'chart__line', points: line }),
          hov >= 0 ? h('line', { class: 'chart__cross', x1: x(sel.t).toFixed(1), x2: x(sel.t).toFixed(1), y1: T, y2: H - B }) : null,
          h('circle', { class: 'chart__dot on', cx: x(sel.t).toFixed(1), cy: y(sel.v).toFixed(1), r: 5 }),
          h('text', { class: 'chart__tick', x: L, y: H - 8 }, dateDay(pts[0].d)),
          h('text', { class: 'chart__tick', x: W - R, y: H - 8, 'text-anchor': 'end' }, dateDay(pts[pts.length - 1].d)),
        ]),
        h('details', { class: 'chart__table' }, [
          h('summary', null, 'Dernières ventes'),
          h('table', null, [
            h('thead', null, [h('tr', null, [h('th', null, 'Jour'), h('th', null, 'Prix')])]),
            h('tbody', null, recent.map((s, i) => h('tr', { key: i }, [h('td', null, dateShort(s.d)), h('td', { class: 'num' }, [priceTag(s.p, { tag: 'span' })])]))),
          ]),
        ]),
      ]),
    ]);
  }
  const median = (xs) => {
    const a = xs.slice().sort((p, q) => p - q);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };

  // ================================================================ rendu : contenu, bande de sélection
  function viewMain() {
    let panel;
    if (S.tab === 'cartes') panel = viewCards();
    else if (S.tab === 'maj') panel = viewUpdate();
    else if (S.tab === 'palmares') panel = viewAwards();
    else if (S.tab === 'reglages') panel = viewSettings();
    else if (S.tab === 'amis') panel = viewFriends();
    else if (S.tab === 'chat') panel = viewChat();
    else if (S.tab === 'marche') panel = viewMarket();
    else if (S.tab === 'nouveautes') panel = viewNews();
    else if (S.tab === 'souhaits-sans-cartes') panel = viewMissingWishes();
    else panel = S.album ? viewAlbum() : viewCollections();
    const page = S.tab === 'nouveautes' || S.tab === 'souhaits-sans-cartes'; // page à part, sans onglet : une région nommée par son titre
    return h('main', { class: ['wrap', 'tab-' + S.tab], id: 'main' }, [
      S.tab === 'collections' && !S.album ? viewMobileSummary() : null,
      h('section', page ? { id: 'panel-' + S.tab, 'aria-labelledby': S.tab === 'souhaits-sans-cartes' ? 'h-wish-missing' : 'h-news', key: S.tab }
        : { id: 'panel-' + S.tab, role: 'tabpanel', 'aria-labelledby': 'tab-' + S.tab, key: S.tab }, [panel]),
    ]);
  }
  // Sélection : « Exclure des échanges et ventes » (celles qui ne le sont pas déjà une à une) ou « Réintégrer » (celles
  // exclues une à une ; une carte exclue par un tag le reste).
  function viewBulkKeep() {
    const k = keepPref.value;
    const ids = [...S.selected].map(String);
    const on = ids.filter((id) => k.cards.has(id)).length;
    return [
      on < ids.length ? h('button', { class: 'btn', type: 'button', title: 'Ces cartes ne seront plus proposées dans « Échanges possibles » ni dans « Bonnes affaires à vendre »',
        onClick: () => setKeepCards(ids, true) }, [icon('lock', 'sm'), 'Exclure des échanges et ventes']) : null,
      on ? h('button', { class: 'btn', type: 'button', onClick: () => setKeepCards(ids, false) }, `Réintégrer (${fmt(on)})`) : null,
    ];
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
      viewBulkKeep(),
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
  // Fiche d'une de tes cartes : case « Exclue des échanges et ventes » (prefs.keep) ; exclue par un tag, elle le dit, et la
  // case cochée reste grisée tant que le tag est exclu.
  function viewKeepToggle(c) {
    const by = keptBy(c);
    return h('div', { class: 'keep-toggle' }, [
      h('label', { class: 'check' }, [
        h('input', { type: 'checkbox', checked: !!by, disabled: !!(by && by.tag && !by.card), 'aria-describedby': 'keep-toggle-help',
          onChange: (e) => setKeepCards([c.id], e.target.checked) }),
        ' Exclue des échanges et ventes',
      ]),
      h('p', { id: 'keep-toggle-help', class: 'small muted' }, by && by.tag
        ? [`Exclue par le tag « ${tagTitle(by.tag)} » (« Mes cartes », « Exclues des échanges et ventes »). `, by.card ? 'Aussi exclue elle-même.' : null]
        : 'Ni proposée dans « Échanges possibles », chez toi comme chez tes amis, ni dans « Bonnes affaires à vendre ».'),
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
        h('div', { class: 'actions sell-cta' }, [h('button', { class: 'btn small', type: 'button', onClick: () => openSell(c) }, [icon('coins', 'sm'), 'Mettre en vente dans le jeu'])]),
        viewKeepToggle(c),
        viewCardMarket(c),
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
          artPickButton(c.title, c.image, c.category),
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
    const img = artOf(item.title, item.image || (info ? info[1] : null));
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
        img ? h('img', { class: 'slot__bg', src: img, alt: '', decoding: 'async', onError: hideBroken })
          : artCover() && ok ? viewCover(item.description, item.title, 'slot') : null,
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
        ok ? viewCardMarket(null) : null,
        mine.length ? h('div', null, [h('h3', null, 'Dans tes collections'), memberList(mine)]) : null,
        h('div', { class: 'actions' }, [
          ok ? artPickButton(item.title, item.image || (info ? info[1] : null), item.description) : null,
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
    const img = artOf(item.title, (fc && fc.image) || (mine && mine.image) || (info ? info[1] : null));
    const url = (fc && fc.url) || (mine && mine.url) || wikiUrl(item.title);
    const myCols = mine ? membershipsOf(mine) : membershipsOfItem(item);
    // Ses collections qui contiennent cet article : même titre, ou même qid.
    const f = friendList.value.find((x) => x.id === fx.id) || null;
    const k = normTitle(item.title);
    const theirs = f && f.targets ? f.targets.filter((t) => t.items.some((it) => !isLabel(it) && (normTitle(it.title) === k || (!!item.qid && it.qid === item.qid)))) : [];
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
        img ? h('img', { class: 'slot__bg', src: img, alt: '', decoding: 'async', onError: hideBroken })
          : artCover() ? viewCover((fc && fc.category) || (mine && mine.category) || item.description, item.title, 'slot') : null,
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
        viewCardMarket(mine),
        theirs.length ? h('div', null, [h('h3', null, `Dans les collections de ${fx.name}`), theirList]) : null,
        myCols.length ? h('div', null, [h('h3', null, 'Dans tes collections'), myList(myCols)]) : null,
        h('div', { class: 'actions' }, [
          artPickButton(item.title, (fc && fc.image) || (mine && mine.image) || (info ? info[1] : null), (fc && fc.category) || (mine && mine.category) || item.description),
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
    const labels = filled.filter((l) => LABEL_LINE.test(l.trim()) && l.trim().replace(LABEL_LINE, '')).length;
    const seps = filled.filter((l) => SEP_LINE.test(l.trim()) && !LABEL_LINE.test(l.trim()) && l.trim().replace(SEP_LINE, '')).length;
    return [
      h('label', { class: 'sr', for: 'ed-name' }, 'Nom de la collection'),
      h('input', { id: 'ed-name', class: 'field full', value: ed.name, maxlength: 120, autocomplete: 'off', placeholder: "Nom, par exemple Dieux de l'Olympe",
        onInput: (e) => { ed.name = e.target.value; } }),
      ed.id ? h('p', { class: 'note' }, 'Un article Wikipédia par ligne : son titre exact (« Zeus ») ou son adresse fr.wikipedia.org. Chaque article est vérifié sur Wikipédia.') : null,
      h('p', { class: 'note', id: 'ed-sep-help' }, ["Intercalaire : « # » en début de ligne (« # Sous-continent ») ; cette carte ouvre alors une section de l'album, avec un bord à part. Elle se possède et compte comme les autres. ",
        "Intercalaire libre : « ## » et un nom (« ## Europe ») ; il ouvre une section sans être une carte (rien à posséder, rien à vérifier)."]),
      h('label', { class: 'sr', for: 'ed-text' }, 'Articles, un par ligne'),
      h('textarea', { id: 'ed-text', class: 'field full', rows: 12, value: ed.text, spellcheck: 'false', 'aria-describedby': 'ed-sep-help',
        placeholder: 'Zeus\nHéra\nhttps://fr.wikipedia.org/wiki/Poséidon', onInput: (e) => { ed.text = e.target.value; ed.issues = null; } }),
      h('p', { class: 'note' }, `${fmt(lines)} ${plural(lines, 'ligne', 'lignes')}${seps ? ` · ${fmt(seps)} ${plural(seps, 'intercalaire', 'intercalaires')}` : ''}${labels ? ` · ${fmt(labels)} ${plural(labels, 'intercalaire libre', 'intercalaires libres')}` : ''}`),
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
    ['jeu', 'Depuis le jeu', 'search', "Cherche dans les cartes du jeu (« vache »…) : le classeur interroge la base du jeu avec ton compte relié et fait une collection avec la rareté de chaque carte."],
  ];
  // « Depuis le jeu » : recherche par titre dans les cartes du jeu (GET /api/game/cards), puis une collection dont chaque
  // élément garde la rareté du jeu.
  async function searchGame(ed) {
    const g = ed.game;
    const q = g.q.trim();
    if (g.busy || !q) return;
    Object.assign(g, { busy: true, error: '', needsLink: false, cards: null, more: false });
    try {
      const r = await api('GET', '/api/game/cards?q=' + encodeURIComponent(q));
      if (S.editor !== ed) return;
      Object.assign(g, { cards: Array.isArray(r.cards) ? r.cards : [], more: !!r.more, searched: q });
    } catch (e) {
      if (S.editor !== ed) return;
      g.error = e.message;
      if (e.data && e.data.needs_link) { g.needsLink = true; loadMe().catch(() => {}); }
    } finally {
      g.busy = false;
    }
  }
  async function createFromGame(ed) {
    const g = ed.game;
    if (g.busy || !g.cards || !g.cards.length) return;
    g.busy = true;
    g.error = '';
    try {
      const name = g.searched.slice(0, 80);
      const items = g.cards.map((c) => ({ title: c.title, description: c.category || null, image: c.image || null, status: 'ok', rarity: c.rarity }));
      const r = await saveTargetApi({ name, source: 'wm:' + g.searched, items });
      if (S.editor !== ed) return;
      if (r.target) upsertTarget(r.target); else await loadTargets();
      closeModal();
      if (r.target) openTarget(r.target.id);
      startPageviews();
      notify(`Collection « ${name} » créée : ${fmt(items.length)} ${plural(items.length, 'carte', 'cartes')}.`);
    } catch (e) {
      if (S.editor === ed) g.error = e.message;
    } finally {
      g.busy = false;
    }
  }
  function viewNewFromGame(ed) {
    const g = ed.game;
    const linked = !!(S.me && S.me.session && S.me.session.linked);
    if (!linked || g.needsLink) {
      return [
        h('p', { class: 'small muted' }, "Pour chercher dans le jeu, le classeur a besoin de ton compte du jeu : relie-le une fois, dans l'onglet « Synchro »."),
        h('div', { class: 'row-actions' }, [h('button', { class: 'btn small primary', type: 'button', onClick: openSyncTab }, [icon('link', 'sm'), 'Relier mon compte'])]),
        foot([closeBtn()]),
      ];
    }
    const n = g.cards ? g.cards.length : 0;
    return [
      h('label', { class: 'sr', for: 'game-q' }, 'Recherche dans les cartes du jeu'),
      h('div', { class: 'row-actions' }, [
        h('input', { id: 'game-q', class: 'field full', type: 'search', value: g.q, maxlength: 100, autocomplete: 'off', spellcheck: 'false', placeholder: 'vache, dragon, Zeus…',
          onInput: (e) => { g.q = e.target.value; }, onKeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); searchGame(ed); } } }),
        h('button', { class: 'btn', type: 'button', disabled: g.busy || !g.q.trim(), onClick: () => searchGame(ed) }, [icon('search', 'sm'), 'Chercher']),
      ]),
      g.busy && !g.cards ? h('p', { class: 'progress-msg', role: 'status' }, 'Recherche…') : null,
      errLine(g.error),
      g.cards && n ? h('ol', { class: 'preview', 'aria-label': 'Cartes trouvées' }, g.cards.map((c) => h('li', { key: c.card_id }, [
        pill(c.rarity), ' ', c.title, c.category ? h('span', { class: 'muted' }, ' · ' + c.category) : null]))) : null,
      g.cards && n && g.more ? h('p', { class: 'note' }, `Les ${fmt(n)} premières : précise ta recherche pour voir les autres.`) : null,
      g.cards && !n && !g.busy ? h('p', { class: 'muted' }, 'Aucune carte du jeu ne porte ce nom : essaie un autre mot.') : null,
      foot([
        closeBtn('Annuler'),
        h('button', { class: 'btn primary', type: 'button', disabled: g.busy || !n, onClick: () => createFromGame(ed) },
          g.busy && n ? 'Enregistrement…' : n ? `Créer la collection « ${g.searched} » (${fmt(n)} ${plural(n, 'carte', 'cartes')})` : 'Créer la collection'),
      ]),
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
            : viewNewFromGame(ed);
    // Les vues mots-clés, liste et « Depuis le jeu » ont leurs propres boutons ; les autres onglets se ferment simplement.
    const ownFoot = ed.mode === 'mots' || ed.mode === 'liste' || ed.mode === 'jeu';
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
  const NO_GTAGS = "Aucun tag du jeu lu pour l'instant : ils arrivent avec chaque lecture de ta collection (onglet « Synchro », « Rafraîchir maintenant »). Si tu n'as posé aucun tag sur tes cartes dans le jeu, les catégories du jeu ci-dessous suffisent.";
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
      ? `Les tags et catégories cochés sont gardés : à chaque lecture de ta collection (ou à l'ouverture du classeur), tes nouvelles cartes qui les portent s'ajoutent à la fin. Une carte décochée dans l'aperçu, ou retirée ensuite de la collection, n'est jamais rajoutée${nSkip ? ` (${cards$(nSkip)} ${plural(nSkip, 'exclue', 'exclues')} pour l'instant)` : ''}.`
      : st && st.had ? "Décochée : l'ajout automatique de cette collection s'arrête (les cartes déjà ajoutées restent)." : null;
    const go = ta.busy ? 'Enregistrement…' : n ? `Ajouter ${cards$(n)}` : st && st.changed ? (st.rules.length ? 'Enregistrer les règles' : "Arrêter l'ajout automatique") : 'Ajouter';
    return h(Modal, { key: 'tagadd', wide: true, title: TAGADD_TITLE, onClose: closeModal }, () => [
      h('p', null, `Dans « ${t.name} » : coche des tags du jeu (ceux que tu poses sur tes cartes dans wiki-masters.com) ou des catégories du jeu (le texte affiché sous le titre de chaque carte), et tes cartes qui les portent sans être encore dans la collection s'y ajoutent, à la fin. Proposés : ceux dont le nom ressemble à celui de la collection, puis ceux que portent beaucoup de ses éléments.`),
      src ? h('p', { class: 'note' }, `Cette collection est faite ${src} : les cartes ajoutées viennent en plus de ses articles et elle garde sa source, comme avec « Modifier ».`) : null,
      ...section(info.game, { title: 'Tes tags du jeu', label: 'Tags du jeu proposés', has: info.hasGtags, empty: NO_GTAGS, of: 'au tag', quote: false,
        noOther: "aucun autre de tes tags du jeu ne s'en approche", noName: 'aucun de tes tags du jeu ne ressemble au nom', often: info.own >= 2,
        noOften: "aucun n'est porté par plusieurs de tes cartes de la collection", more: (k) => plural(k, 'autre tag proposé', 'autres tags proposés') }),
      ...section(info.cats, { title: 'Catégories du jeu', label: 'Catégories du jeu proposées', has: info.hasCats, quote: true, of: 'de catégorie',
        empty: "Aucune de tes cartes n'a de catégorie du jeu (le texte que le jeu affiche sous leur titre) : rafraîchis ta collection (onglet « Synchro »), puis reviens ici.",
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
  // « Proposer un échange » : deux listes à cocher (ce que tu donnes, ce que tu reçois), puis la proposition est créée dans
  // le jeu par le serveur, avec ta session reliée (POST /api/trades/create).
  // « Ajouter les membres pas encore amis » : qui n'est pas encore ton ami dans le jeu (coché d'avance), qui attend, et
  // combien sont déjà tes amis ; les demandes partent d'un coup.
  function modalFriendsAdd() {
    const fa = S.friendsAdd;
    if (!fa) return null;
    const title = 'Ajouter les membres pas encore amis';
    const intro = fa.fromCheck
      ? h('p', null, "C'est coché : chaque membre qui reliera son compte du jeu recevra une demande d'ami de ta part. Et ceux qui sont déjà là ?")
      : null;
    const sess = (S.me && S.me.session) || {};
    if (!sess.linked || sess.lost) {
      return h(Modal, { key: 'friendsadd', title, onClose: closeModal }, () => [intro,
        h('p', { class: 'warn', role: 'alert' }, ["Relie d'abord ton compte du jeu : les demandes partent avec ta session. ",
          h('button', { class: 'linkish', type: 'button', onClick: () => { closeModal(); openSyncTab(); } }, 'Relier mon compte')]),
        foot([closeBtn()])]);
    }
    if (fa.st !== 'ready') {
      return h(Modal, { key: 'friendsadd', title, onClose: closeModal }, () => [intro,
        fa.st === 'loading' ? h('p', { class: 'muted', role: 'status' }, "Lecture de ta liste d'amis du jeu…") : errLine(fa.error),
        foot([closeBtn()])]);
    }
    const label = (m) => m.name || 'Sans prénom';
    const toAdd = fa.list.filter((m) => m.st === 'none' || m.st === 'unknown' || m.error);
    const waiting = fa.list.filter((m) => (m.st === 'sent' || m.st === 'received') && !m.error);
    const friends = fa.list.filter((m) => m.st === 'friends');
    const row = (m) => {
      const can = m.st === 'none' && fa.canRequest;
      const on = fa.pick.includes(m.id);
      return h('li', { key: m.id, class: { on } }, [
        h('label', { class: 'check' }, [
          h('input', { type: 'checkbox', checked: on, disabled: fa.busy || !can,
            onChange: () => { fa.pick = on ? fa.pick.filter((x) => x !== m.id) : [...fa.pick, m.id]; } }),
          h('span', { class: 'trade-pick__title' }, label(m)), m.pseudo ? h('span', { class: 'muted' }, ` (${m.pseudo})`) : null]),
        m.error ? h('span', { class: 'why warn' }, m.error)
          : m.st === 'unknown' ? h('span', { class: 'why' }, "ni compte du jeu relié ni pseudo : impossible de savoir à qui l'envoyer") : null,
      ]);
    };
    const waitText = (m) => (m.st === 'sent' ? (m.result === 'sent' ? 'demande envoyée' : 'ta demande attend') : "t'a envoyé une demande : accepte-la dans le jeu");
    const n = fa.pick.length;
    return h(Modal, { key: 'friendsadd', title, onClose: closeModal }, () => [intro,
      toAdd.length
        ? h('fieldset', { class: 'trade-pick' }, [
          h('legend', null, ['Pas encore tes amis dans le jeu', h('span', { class: 'n' }, ` · ${fmt(toAdd.length)}`)]),
          h('ul', { class: 'trade-pick__list' }, toAdd.map(row))])
        : h('p', null, 'Tous les membres sont déjà tes amis dans le jeu, ou une demande attend.'),
      waiting.length ? h('p', { class: 'small' }, ['En attente : ', waiting.map((m) => `${label(m)} (${waitText(m)})`).join(', '), '.']) : null,
      friends.length ? h('p', { class: 'small muted' }, `Déjà tes amis : ${namesText(friends.map(label), false)}.`) : null,
      fa.canRequest ? null : h('p', { class: 'warn' }, "Le classeur n'envoie pas de demande d'ami pour l'instant : envoie-les dans le jeu (page Amis)."),
      errLine(fa.error),
      foot([
        h('a', { class: 'btn ghost', href: 'https://www.wiki-masters.com/friends', target: '_blank', rel: 'noopener noreferrer' }, 'Mes amis dans le jeu ↗'),
        closeBtn(),
        toAdd.length && fa.canRequest ? h('button', { class: 'btn primary', type: 'button', disabled: fa.busy || !n, onClick: () => sendFriendsAdd(fa) },
          fa.busy ? 'Envoi dans le jeu…' : n ? `Envoyer ${fmt(n)} ${plural(n, "demande d'ami", "demandes d'ami")}` : "Aucune demande cochée") : null,
      ]),
    ]);
  }
  function modalTrade() {
    const tn = S.tradeNew;
    if (!tn) return null;
    const name = friendName(tn.f);
    const title = `Proposer un échange à ${name}`;
    const cards = (n) => `${fmt(n)} ${plural(n, 'carte', 'cartes')}`;
    if (tn.done) {
      const d = tn.done;
      const list = (xs, wb) => namesText([...xs.map((c) => c.title), ...(wb ? [wfmt(wb)] : [])], true);
      return h(Modal, { key: 'trade', title, onClose: closeModal }, () => [
        h('p', { class: 'trade-done', role: 'status' }, [h('b', null, `Échange proposé à ${name} dans le jeu.`),
          d.given.length || d.givenWb ? ` Tu donnes ${list(d.given, d.givenWb)}.` : ' Tu ne donnes rien.',
          d.received.length || d.receivedWb ? ` Tu reçois ${list(d.received, d.receivedWb)}.` : ' Tu ne reçois rien.']),
        h('p', { class: 'note' }, `Rien ne bouge tant que ${name} ne l'a pas acceptée dans le jeu (Échanges). Tu peux l'y annuler.`),
        foot([h('a', { class: 'btn ghost', href: d.url, target: '_blank', rel: 'noopener' }, 'Ouvrir les échanges du jeu'), closeBtn()]),
      ]);
    }
    // Pas amis dans le jeu : il refuserait l'échange. La fenêtre le dit à la place des cartes, avec de quoi devenir amis.
    const fr = tn.fr || { st: 'unknown' };
    if (fr.st === 'loading') {
      return h(Modal, { key: 'trade', title, onClose: closeModal }, () => [
        h('p', { class: 'muted', role: 'status' }, `Vérification de ton amitié avec ${name} dans le jeu…`),
        foot([closeBtn('Annuler')]),
      ]);
    }
    if (fr.st === 'none' || fr.st === 'sent' || fr.st === 'received') {
      const friendsUrl = 'https://www.wiki-masters.com/friends';
      const recheck = h('button', { class: 'btn ghost', type: 'button', disabled: fr.busy, onClick: () => { fr.st = 'loading'; loadTradeFriend(tn); } }, 'Vérifier à nouveau');
      const say = {
        none: fr.canRequest
          ? `Envoie-lui une demande d'ami : le classeur la crée dans le jeu, à ton nom. L'échange sera possible dès que ${name} l'aura acceptée.`
          : `Envoie-lui une demande d'ami dans le jeu (page Amis${tn.f.pseudo ? `, ou depuis son profil : ${tn.f.pseudo}` : ''}). L'échange sera possible dès que ${name} l'aura acceptée.`,
        sent: `Ta demande d'ami est partie : l'échange sera possible dès que ${name} l'aura acceptée dans le jeu.`,
        received: `${name} t'a envoyé une demande d'ami : accepte-la dans le jeu (page Amis), puis reviens proposer l'échange.`,
      }[fr.st];
      return h(Modal, { key: 'trade', title, onClose: closeModal }, () => [
        h('p', { class: 'warn', role: 'status' }, [h('b', null, `${name} n'est pas ton ami dans le jeu.`), " Le jeu n'accepte les échanges qu'entre amis."]),
        h('p', null, say),
        errLine(fr.error),
        foot([
          fr.st === 'none' && !fr.canRequest && tn.f.pseudo
            ? h('a', { class: 'btn ghost', href: gameProfileUrl(tn.f.pseudo), target: '_blank', rel: 'noopener noreferrer' }, 'Son profil dans le jeu ↗') : null,
          fr.st !== 'none' || !fr.canRequest ? h('a', { class: 'btn ghost', href: friendsUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Mes amis dans le jeu ↗') : null,
          fr.st === 'none' ? null : recheck,
          closeBtn(),
          fr.st === 'none' && fr.canRequest
            ? h('button', { class: 'btn primary', type: 'button', disabled: fr.busy, onClick: () => sendFriendRequest(tn) }, fr.busy ? 'Envoi dans le jeu…' : `Envoyer une demande d'ami à ${name}`) : null,
        ]),
      ]);
    }
    const sess = (S.me && S.me.session) || {};
    const linked = !!sess.linked && !sess.lost;
    const { give, get } = tradeRowsWith(tn.f);
    const n = tn.give.length + tn.get.length;
    const giveWb = tradeWb(tn.giveWb);
    const getWb = tradeWb(tn.getWb);
    const myBal = wbOf(S.me && S.me.wikibidous);
    const hisBal = tn.f.wb;
    const badWb = giveWb === null || getWb === null;
    // Jamais plus que le solde lu à la dernière synchro (le champ s'y arrête ; un solde relu plus bas bloque l'envoi). Solde
    // pas encore lu : pas de plafond, le jeu vérifie.
    const overWb = !badWb && ((myBal && giveWb > myBal.n) || (hisBal && getWb > hisBal.n));
    const anyWb = !badWb && (giveWb > 0 || getWb > 0);
    // Wikibidous d'un côté : le montant, plafonné au solde de celui qui paie lu à sa dernière synchro.
    const wbField = (key, label, bal, who) => {
      const v = tradeWb(tn[key]);
      const over = bal && v !== null && v > bal.n;
      const id = 'trade-' + key;
      const onInput = (e) => {
        const n = tradeWb(e.target.value);
        if (bal && n !== null && n > bal.n) e.target.value = String(bal.n);
        tn[key] = e.target.value;
        tn.error = '';
      };
      return h('div', { class: 'trade-wb' }, [
        h('label', { class: 'trade-wb__row', for: id }, [h('span', null, label),
          h('span', { class: 'sell-input' }, [h('input', { id, class: 'field', type: 'number', min: '0', max: bal ? String(bal.n) : null, step: '1', inputmode: 'numeric', placeholder: '0',
            value: tn[key], disabled: tn.busy || (bal && bal.n === 0), 'aria-describedby': id + '-bal', onInput }),
          h('span', { class: 'w', 'aria-hidden': 'true' }, 'W')])]),
        h('p', { id: id + '-bal', class: ['small', over ? 'warn' : 'muted'] }, bal
          ? [`${who} : `, priceTag(bal.n, { tag: 'span' }), bal.at ? ` (lu ${agoText(bal.at)})` : '', bal.n === 0 ? ' : rien à proposer.' : over ? ' : pas assez, baisse le montant.' : ' au plus.']
          : `${who} : pas encore lu (il sera lu à la prochaine synchro).`),
      ]);
    };
    const row = (side, r) => {
      const locked = favLocked(r.card);
      const on = !locked && tn[side].includes(r.card.id);
      return h('li', { key: r.card.id, class: { on, locked } }, [
        h('label', { class: 'check' }, [
          h('input', { type: 'checkbox', checked: on, disabled: tn.busy || locked, onChange: () => toggleTradeCard(tn, side, r.card.id) }),
          pill(r.card.rarity), h('span', { class: 'trade-pick__title' }, r.card.title),
          locked ? h('span', { class: 'fitem__fav', title: "Favori dans le jeu : le jeu refuse de l'échanger" }, 'favori') : null,
          r.dup ? h('span', { class: 'holder dup', title: `${side === 'give' ? 'Tu en as' : name + ' en a'} ${fmt(r.count)} exemplaires` }, [h('b', null, '×' + fmt(r.count))]) : null]),
        h('span', { class: 'why' }, '→ ' + colsText(r.cols, ', ')),
      ]);
    };
    const side = (key, legend, rows, empty, wb) => h('fieldset', { class: 'trade-pick' }, [
      h('legend', null, [legend, h('span', { class: 'n' }, ` · ${fmt(tn[key].length)} / ${fmt(rows.length)}`)]),
      rows.length ? h('ul', { class: 'trade-pick__list' }, rows.map((r) => row(key, r))) : h('p', { class: 'note' }, empty),
      rows.length > 1 ? h('p', { class: 'trade-pick__all' }, [
        h('button', { class: 'linkish', type: 'button', disabled: tn.busy, onClick: () => { tn[key] = rows.filter((r) => !favLocked(r.card)).map((r) => r.card.id); tn.error = ''; } }, 'Tout cocher'), ' · ',
        h('button', { class: 'linkish', type: 'button', disabled: tn.busy, onClick: () => { tn[key] = []; } }, 'Rien'),
        ' · ',
        h('button', { class: 'linkish', type: 'button', disabled: tn.busy, onClick: () => { tn[key] = rows.filter((r) => r.dup && !favLocked(r.card)).map((r) => r.card.id); } }, 'Les doubles')]) : null,
      wb,
    ]);
    return h(Modal, { key: 'trade', title, wide: true, onClose: closeModal }, () => [
      h('p', null, `Coche les cartes de l'échange, parmi celles que vous avez l'un pour l'autre (les doubles sont cochés d'avance), et ajoute des wikibidous d'un côté ou de l'autre si tu veux. Le classeur crée la proposition dans le jeu, à ton nom ; ${name} l'accepte ou la refuse dans le jeu.`),
      linked ? null : h('p', { class: 'warn', role: 'alert' }, ['Relie d\'abord ton compte du jeu : le classeur crée l\'échange avec ta session. ',
        h('button', { class: 'linkish', type: 'button', onClick: () => { closeModal(); openSyncTab(); } }, 'Relier mon compte')]),
      h('div', { class: 'trade-sides' }, [
        side('give', 'Tu donnes', give, tn.f.tshare ? `Aucune de tes cartes ne complète les collections de ${name}.` : `${name} ne partage pas ses collections : impossible de savoir ce qui lui manque.`,
          wbField('giveWb', 'Et des wikibidous', myBal, 'Ton solde')),
        side('get', 'Tu reçois', get, `Aucune carte de ${name} ne complète tes collections.`,
          wbField('getWb', 'Et des wikibidous', hisBal, `Solde de ${name}`)),
      ]),
      h('p', { class: 'merge-sum', role: 'status' }, n || anyWb
        ? [`Tu donnes ${cards(tn.give.length)}`, giveWb ? [' et ', priceTag(giveWb, { tag: 'span' })] : '', `, tu reçois ${cards(tn.get.length)}`, getWb ? [' et ', priceTag(getWb, { tag: 'span' })] : '', '.']
        : 'Aucune carte cochée, aucun wikibidou.'),
      n > TRADE_MAX ? h('p', { class: 'warn', role: 'alert' }, `${fmt(TRADE_MAX)} cartes au plus par échange.`) : null,
      badWb ? h('p', { class: 'warn', role: 'alert' }, 'Les wikibidous sont un nombre entier, 0 ou plus.') : null,
      errLine(tn.error),
      foot([
        closeBtn('Annuler'),
        h('button', { class: 'btn primary', type: 'button', disabled: tn.busy || !linked || !(n || anyWb) || n > TRADE_MAX || badWb || overWb, onClick: () => sendTrade(tn) },
          tn.busy ? 'Création dans le jeu…' : 'Proposer l\'échange dans le jeu'),
      ]),
    ]);
  }
  // « Mettre en vente » : l'exemplaire (rareté, brillance), ce que le classeur sait du marché de la carte (cote, enchères en
  // cours, prix de vente, tes ventes), la mise de départ avec des prix proposés, la durée ; puis la vente créée, annulable
  // tant que personne n'a misé.
  function modalSell() {
    const sl = S.sell;
    if (!sl) return null;
    const c = sl.c;
    const title = `Mettre en vente « ${c.title} »`;
    const linked = sellLinked();
    if (sl.done) {
      const d = sl.done;
      return h(Modal, { key: 'sell', title, wide: true, onClose: closeModal }, () => [
        sl.cancelled
          ? h('p', { class: 'trade-done', role: 'status' }, [h('b', null, 'Vente annulée.'), ` « ${c.title} » revient dans ta collection du jeu.`])
          : h('p', { class: 'trade-done', role: 'status' }, [h('b', null, `« ${c.title} » est en vente dans le jeu.`),
            ` ${variantName(d.k)}, départ `, priceTag(d.base, { tag: 'span' }), d.end ? `, fin vers ${dateShort(d.end)}.` : '.']),
        sl.cancelled ? null : h('p', { class: 'note' }, "L'exemplaire est réservé pendant l'enchère. Tu peux l'annuler tant que personne n'a misé ; ensuite, elle va jusqu'au bout."),
        errLine(sl.cancelError),
        foot([
          h('a', { class: 'btn ghost', href: d.url, target: '_blank', rel: 'noopener noreferrer' }, 'Ouvrir dans le jeu ↗'),
          sl.cancelled ? null : h('button', { class: 'btn danger', type: 'button', disabled: sl.cancelBusy, onClick: () => cancelFromSell(sl) }, sl.cancelBusy ? 'Annulation…' : 'Annuler la vente'),
          closeBtn(),
        ]),
      ]);
    }
    const info = sl.info;
    const copies = info ? info.copies : variantsOf(c).list.map(([k, n]) => ({ k, n, fav: 0 }));
    const total = copies.reduce((t, x) => t + (Number(x.n) || 0), 0);
    const chosen = copies.find((x) => x.k === sl.k) || null;
    const mk = sellMarket(sl);
    const q = mk.q;
    const base = sellBaseOf(sl);
    const full = !!(info && info.max != null && info.selling != null && info.selling >= info.max);
    const none = !!(info && !copies.length);
    const cols = membershipsOf(c);
    const duration = (SELL_DURATIONS.find(([m]) => m === sl.minutes) || [0, ''])[1];

    // Prix proposés : la cote, juste sous l'enchère de cette rareté la moins chère, la dernière vente.
    const suggest = [];
    if (q && Number(q.p) >= 1) suggest.push([Math.round(Number(q.p)), reliable(q) ? 'la cote' : 'la cote (peu fiable)']);
    if (mk.cheapest && mk.cheapest.ask > 1) suggest.push([mk.cheapest.ask - 1, 'sous la moins chère en vente']);
    if (q && Number(q.l) >= 1) suggest.push([Math.round(Number(q.l)), 'la dernière vente']);
    const seen = new Set();
    const chips = suggest.filter(([n]) => !seen.has(n) && seen.add(n));

    const warns = [];
    if (full) warns.push(`Tu as déjà ${fmt(info.selling)} enchères actives sur ${fmt(info.max)} : annules-en une, ou attends qu'une se termine.`);
    if (none) warns.push("Le jeu ne te connaît plus d'exemplaire de cette carte : rafraîchis ton classeur.");
    if (base !== null && reliable(q) && q.p > 0) {
      const gap = Math.round(Math.abs(base - q.p) / q.p * 100);
      if (base < 0.7 * q.p) warns.push(`Départ ${fmt(gap)} % sous la cote (${wfmt(q.p)}) : si personne ne surenchérit, elle partira à ce prix.`);
      else if (base > 1.5 * q.p) warns.push(`Départ ${fmt(gap)} % au-dessus de la cote (${wfmt(q.p)}) : elle risque de ne pas trouver preneur.`);
    }
    if (base !== null && mk.cheapest && base > mk.cheapest.ask) {
      const under = mk.running.filter((a) => a.ask < base).length;
      warns.push(`${fmt(under)} ${plural(under, 'enchère', 'enchères')} de cette rareté ${plural(under, 'part', 'partent')} déjà moins cher (dès ${wfmt(mk.cheapest.ask)}).`);
    }
    if (cols.length && total <= 1) warns.push(`C'est ton seul exemplaire, et il sert à ${cols.slice(0, 3).map((col) => `« ${col.name} »`).join(', ')}${cols.length > 3 ? '…' : ''} : il quittera ${plural(cols.length, 'cette collection', 'ces collections')} s'il se vend.`);
    if (chosen && chosen.fav && chosen.fav >= chosen.n) warns.push(`${chosen.n > 1 ? 'Tes exemplaires' : 'Ton exemplaire'} de cette rareté ${chosen.n > 1 ? 'sont favoris' : 'est favori'} dans le jeu.`);

    const facts = [];
    if (q) {
      facts.push(fact(`Cote · ${variantName(sl.k)}`, [priceTag(q.p, { approx: !reliable(q), title: reliable(q) ? null : 'Moins de 3 ventes : cote peu fiable' }), h('span', { class: 'muted' }, ` · ${fmt(q.n)} ${plural(q.n, 'vente', 'ventes')}`)]));
      if (q.l != null) facts.push(fact('Dernière vente', [priceTag(q.l, { tag: 'span' }), q.d ? ` le ${dateDay(q.d)}` : '']));
      if (q.w != null && q.w > 0) facts.push(fact('Sur 7 jours', `${pctOf(q.p, q.w)} (avant : ${wfmt(q.w)})`));
    } else facts.push(fact(`Cote · ${variantName(sl.k)}`, 'pas de vente lue'));
    if (mk.d) {
      facts.push(fact('En vente maintenant', mk.running.length ? [`${fmt(mk.running.length)} · dès `, priceTag(mk.cheapest.ask, { tag: 'span' }), mk.cheapest.bid ? ' (avec mise)' : ''] : 'aucune dans cette rareté'));
      facts.push(fact('Ventes conclues', mk.sales.length ? `${fmt(mk.sales.length)} dans cette rareté` : 'aucune dans cette rareté'));
    }
    if (info && info.max != null && info.selling != null) facts.push(fact('Tes enchères actives', `${fmt(info.selling)} / ${fmt(info.max)}`));

    const mineSales = mk.mine.slice(0, 5);
    const left = [
      h('fieldset', { class: 'sell-field' }, [
        h('legend', null, ['Exemplaire', sl.infoBusy ? h('span', { class: 'n' }, ' · lecture dans le jeu…') : null]),
        h('div', { class: 'cmk__keys', role: 'group', 'aria-label': "Rareté de l'exemplaire" }, copies.map((x) => h('button', {
          key: x.k, type: 'button', class: ['chip-btn', { on: x.k === sl.k }], 'aria-pressed': String(x.k === sl.k), disabled: sl.busy, onClick: () => setSellVariant(sl, x.k),
        }, `${variantName(x.k)}${x.n > 1 ? ' · ×' + fmt(x.n) : ''}${x.fav ? ' · favori' : ''}`))),
        sl.infoError ? h('p', { class: 'small warn', role: 'status' }, sl.infoError) : null,
      ]),
      h('div', { class: 'facts sell-facts' }, facts),
      h('label', { class: 'sell-field', for: 'sell-base' }, [h('span', { class: 'sell-label' }, 'Mise de départ'),
        h('span', { class: 'sell-input' }, [h('input', { id: 'sell-base', class: 'field', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: sl.base, disabled: sl.busy,
          onInput: (e) => { sl.base = e.target.value; sl.error = ''; } }), h('span', { class: 'w', 'aria-hidden': 'true' }, 'W')])]),
      chips.length ? h('div', { class: 'cmk__keys', role: 'group', 'aria-label': 'Prix proposés' }, chips.map(([n, label]) => h('button', {
        key: label, type: 'button', class: ['chip-btn', { on: base === n }], disabled: sl.busy, onClick: () => { sl.base = String(n); sl.error = ''; },
      }, `${label} · ${wfmt(n)}`))) : null,
      h('div', { class: 'sell-field' }, [h('span', { class: 'sell-label', id: 'sell-dur' }, 'Durée'),
        h('div', { class: 'cmk__keys', role: 'group', 'aria-labelledby': 'sell-dur' }, SELL_DURATIONS.map(([m, label]) => h('button', {
          key: m, type: 'button', class: ['chip-btn', { on: sl.minutes === m }], 'aria-pressed': String(sl.minutes === m), disabled: sl.busy, onClick: () => { sl.minutes = m; },
        }, label)))]),
      warns.length ? h('ul', { class: 'sell-warns', role: 'status' }, warns.map((w, i) => h('li', { key: i, class: 'warn' }, w))) : null,
      h('p', { class: 'merge-sum', role: 'status' }, base !== null ? [`${variantName(sl.k)} · départ `, priceTag(base, { tag: 'span' }), ` · ${duration}`] : 'Indique une mise de départ (en W, 1 au moins).'),
    ];
    const right = linked ? [
      mineSales.length ? h('div', { class: 'sell-mine' }, [h('h3', null, ['Tes ventes de cette carte ', h('span', { class: 'hint-inline' }, '14 derniers jours')]),
        h('ul', { class: 'lots' }, mineSales.map((x) => h('li', { key: x.a, class: 'lot' }, [
          h('span', { class: 'lot__line' }, [variantName(x.r + (x.s ? '*' : '')), ' · départ ', priceTag(x.base, { tag: 'span' }),
            x.cur != null ? [` · ${x.st === 'sold' ? 'vendue' : 'enchère'} `, priceTag(x.cur, { tag: 'span' })] : '']),
          h('span', { class: 'lot__meta small' }, x.st === 'run' ? [h('span', { class: ['flag', { ok: x.bid }] }, x.bid ? 'enchère reçue' : 'sans enchère'), leftText(x.end)]
            : [h('span', { class: ['flag', { ok: x.st === 'sold' }] }, SALE_STATE[x.st] || x.st), ` le ${dateDay(x.end)}`]),
        ])))]) : null,
      viewCardMarket(c),
    ] : [];
    return h(Modal, { key: 'sell', title, wide: true, cls: 'sell', onClose: closeModal }, () => [
      h('p', null, "Le classeur met un exemplaire aux enchères dans le jeu, à ton nom, avec ta session reliée. Il est réservé pendant l'enchère ; tu peux l'annuler tant que personne n'a misé."),
      linked ? null : h('p', { class: 'warn', role: 'alert' }, ["Relie d'abord ton compte du jeu : le classeur met en vente avec ta session. ",
        h('button', { class: 'linkish', type: 'button', onClick: () => { closeModal(); closeCard(); openSyncTab(); } }, 'Relier mon compte')]),
      h('div', { class: 'sell-cols' }, [h('div', { class: 'sell-main' }, left), right.length ? h('div', { class: 'sell-market' }, right) : null]),
      errLine(sl.error),
      sl.verify ? h('p', { class: 'note' }, [h('a', { class: 'game-link', href: 'https://www.wiki-masters.com/collection', target: '_blank', rel: 'noopener noreferrer' }, 'Ouvrir ma collection dans le jeu ↗')]) : null,
      foot([
        closeBtn('Annuler'),
        h('button', { class: 'btn primary', type: 'button', disabled: sl.busy || !linked || base === null || full || none, onClick: () => sendSell(sl) },
          sl.busy ? 'Mise en vente…' : 'Mettre en vente dans le jeu'),
      ]),
    ]);
  }
  // « Miser » : l'enchère (exemplaire, prix actuel, cote, fin, ton solde), ta mise avec des montants proposés (le minimum,
  // la cote), puis la mise faite.
  function modalBid() {
    const b = S.bid;
    if (!b) return null;
    const x = b.x;
    const k = x.r + (x.s ? '*' : '');
    const title = `Miser sur « ${x.t} »`;
    const linked = sellLinked();
    const wb = S.me && S.me.wikibidous;
    if (b.done) {
      const d = b.done;
      return h(Modal, { key: 'bid', title, onClose: closeModal }, () => [
        h('p', { class: 'trade-done', role: 'status' }, [h('b', null, 'Mise faite : tu mènes.'), ' Ta mise : ', priceTag(d.amount, { tag: 'span' }),
          d.balance != null ? [' · ton solde dans le jeu : ', priceTag(d.balance, { tag: 'span' })] : '', '.']),
        h('p', { class: 'note' }, `Si personne ne surenchérit d'ici la fin (${leftText(x.end)}), la carte est à toi à ce prix. Le jeu retient ta mise sur ton solde de wikibidous.`),
        foot([h('a', { class: 'btn ghost', href: d.url, target: '_blank', rel: 'noopener noreferrer' }, 'Ouvrir dans le jeu ↗'), closeBtn()]),
      ]);
    }
    const amount = bidAmountOf(b);
    const cote = x.cote != null && Number(x.cote) > 0 ? Number(x.cote) : null;
    const sure = cote != null && x.n >= 3;
    const chips = [[b.min, 'minimum']];
    if (cote != null && Math.round(cote) > b.min) chips.push([Math.round(cote), sure ? 'la cote' : 'la cote (peu fiable)']);
    const warns = [];
    if (amount !== null && amount < b.min) warns.push(`Il faut au moins ${wfmt(b.min)}${x.bid ? " (un W de plus que l'enchère actuelle ; le jeu peut demander davantage)" : ' (prix de départ)'}.`);
    if (amount !== null && cote != null && amount > cote) warns.push(`${fmt(Math.round((amount - cote) / cote * 100))} % au-dessus de la cote (${wfmt(cote)}).`);
    if (amount !== null && wb && Number.isFinite(wb.n) && amount > wb.n) warns.push(`Plus que ton solde lu ${wb.at ? agoText(wb.at) : 'à la dernière synchro'} (${wfmt(wb.n)}) : le jeu refusera sans doute.`);
    const facts = [
      fact('Exemplaire', [pill(x.r), ' ', variantName(k)]),
      fact(x.bid ? 'Enchère actuelle' : 'Prix de départ', [priceTag(x.bid ? (x.cur ?? x.ask) : x.ask, { tag: 'span' }), x.bid ? '' : ' · aucune mise']),
      fact('Cote', cote != null ? [priceTag(cote, { tag: 'span', approx: !sure, title: sure ? null : 'Moins de 3 ventes : cote peu fiable' })] : 'pas de cote'),
      fact('Fin', leftText(x.end).replace(/^encore /, 'dans ')),
    ];
    if (wb && Number.isFinite(wb.n)) facts.push(fact('Ton solde', [priceTag(wb.n, { tag: 'span' }), h('span', { class: 'muted' }, wb.at ? ` · lu ${agoText(wb.at)}` : '')]));
    return h(Modal, { key: 'bid', title, onClose: closeModal }, () => [
      h('p', null, "Le classeur mise à ton nom dans le jeu, avec ta session reliée. Une mise engage : si personne ne surenchérit avant la fin, tu achètes la carte à ce prix."),
      linked ? null : h('p', { class: 'warn', role: 'alert' }, ["Relie d'abord ton compte du jeu : le classeur mise avec ta session. ",
        h('button', { class: 'linkish', type: 'button', onClick: () => { closeModal(); closeCard(); openSyncTab(); } }, 'Relier mon compte')]),
      h('div', { class: 'facts sell-facts' }, facts),
      h('label', { class: 'sell-field', for: 'bid-amount' }, [h('span', { class: 'sell-label' }, 'Ta mise'),
        h('span', { class: 'sell-input' }, [h('input', { id: 'bid-amount', class: 'field', type: 'number', min: String(b.min), step: '1', inputmode: 'numeric', value: b.amount, disabled: b.busy,
          onInput: (e) => { b.amount = e.target.value; b.error = ''; } }), h('span', { class: 'w', 'aria-hidden': 'true' }, 'W')])]),
      h('div', { class: 'cmk__keys', role: 'group', 'aria-label': 'Mises proposées' }, chips.map(([n, label]) => h('button', {
        key: label, type: 'button', class: ['chip-btn', { on: amount === n }], disabled: b.busy, onClick: () => { b.amount = String(n); b.error = ''; },
      }, `${label} · ${wfmt(n)}`))),
      warns.length ? h('ul', { class: 'sell-warns', role: 'status' }, warns.map((w, i) => h('li', { key: i, class: 'warn' }, w))) : null,
      errLine(b.error),
      b.verify ? h('p', { class: 'note' }, [h('a', { class: 'game-link', href: gameAuctionUrl(x.a), target: '_blank', rel: 'noopener noreferrer' }, "Ouvrir l'enchère dans le jeu ↗")]) : null,
      foot([
        closeBtn('Annuler'),
        h('button', { class: 'btn primary', type: 'button', disabled: b.busy || !linked || amount === null || amount < b.min, onClick: () => sendBid(b) },
          b.busy ? 'Mise en cours…' : amount !== null ? `Miser ${wfmt(amount)} dans le jeu` : 'Miser dans le jeu'),
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

  // « Changer l'illustration » : l'image par défaut, puis les images principales de l'article dans chaque langue de
  // Wikipédia qui en a une (une même image une fois, avec ses langues). Un clic choisit, « Garder » enregistre.
  function modalArt() {
    const ap = S.artPick;
    if (!ap) return null;
    const def = artDefault(ap.title, ap.base);
    const opt = (key, sel, img, caption, label) => h('li', { key }, [
      h('button', { class: 'artpick__opt', type: 'button', role: 'radio', 'aria-checked': String(ap.sel === sel), 'aria-label': label,
        disabled: ap.busy, onClick: () => { ap.sel = sel; } }, [
        h('span', { class: 'artpick__img' }, img ? [h('img', { src: img, alt: '', loading: 'lazy', decoding: 'async', onError: hideBroken })]
          : artCover() ? [viewCover(ap.desc, ap.title, 'mini')] : [h('span', { class: 'artpick__none' }, initialOf(ap.title))]),
        h('span', { class: 'artpick__cap' }, caption),
      ]),
    ]);
    const list = ap.list.filter((x) => x.url !== def || ap.sel === x.url);
    const changed = ap.sel !== (S.artPicks[ap.title] || '');
    return h(Modal, { key: 'art', title: `Illustration de « ${ap.title} »`, wide: true, onClose: closeModal }, () => [
      h('p', { class: 'small muted' }, "L'image principale de l'article dans les versions de Wikipédia qui en ont une. Seulement dans le classeur : la carte du jeu ne change pas. Gardée avec ton compte, pour toutes les cartes et cases de cet article."),
      h('ul', { class: 'artpick', role: 'radiogroup', 'aria-label': 'Illustrations proposées' }, [
        opt('def', '', def, [h('b', null, 'Par défaut'), def ? null : h('span', null, ' (sans image)')], 'Image par défaut'),
        ...list.map((x) => opt(x.url, x.url, x.url, x.langs.map((l) => l.name).join(', '), `Image de Wikipédia en ${x.langs.map((l) => l.name.toLowerCase()).join(', ')}${x.file ? ' : ' + x.file : ''}`)),
      ]),
      ap.st === 'loading' ? h('p', { class: 'small muted', role: 'status' }, 'Recherche des images dans les autres langues…') : null,
      ap.st === 'ready' && !list.length ? h('p', { class: 'small muted', role: 'status' }, "Aucune autre image : l'article n'a pas d'image principale dans les langues regardées.") : null,
      ap.st === 'missing' ? h('p', { class: 'warn' }, 'Article introuvable sur Wikipédia.') : null,
      errLine(ap.error),
      foot([
        closeBtn('Annuler'),
        h('button', { class: 'btn primary', type: 'button', disabled: ap.busy || !changed, 'aria-busy': ap.busy ? 'true' : null, onClick: () => saveArtPick(ap) },
          ap.busy ? 'Enregistrement…' : ap.sel || !S.artPicks[ap.title] ? 'Garder cette image' : "Revenir à l'image par défaut"),
      ]),
    ]);
  }

  const MODALS = { art: modalArt, trade: modalTrade, friendsadd: modalFriendsAdd, sell: modalSell, bid: modalBid, install: modalInstall, editor: modalEditor, confirm: modalConfirm, tag: modalTag, switch: modalSwitch, link: modalLink, arrange: modalArrange, tagadd: modalTagAdd, merge: modalMerge };

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
    } else if (S.key && (S.healthError || (S.bootError && !S.bootHint))) {
      // Clé gardée mais classeur injoignable (pas de réseau, serveur en panne) : rien à créer ni à oublier, seulement
      // réessayer (l'app installée s'ouvre aussi sans réseau ; « Oublier cette clé » y ferait perdre le classeur).
      body = [h('section', { class: 'panel narrow offline', role: 'alert' }, [
        h('h2', null, 'Pas de connexion au classeur'),
        h('p', null, S.healthError || S.bootError),
        h('p', { class: 'muted' }, 'Ton classeur est bien gardé sur cet appareil : il se rouvre dès que le réseau revient.'),
        h('div', { class: 'actions' }, [h('button', { class: 'btn primary', type: 'button', onClick: () => boot() }, [icon('refresh', 'sm'), 'Réessayer'])]),
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
        STANDALONE && !S.key ? h('div', { class: 'notice' }, [h('p', null, [h('strong', null, "Bienvenue dans l'app."), " Elle ne connaît pas encore ton classeur : colle ton lien personnel ci-dessous (« Installer l'app » dans ton navigateur te l'a fait copier, sinon tu le trouves dans les Réglages, sur un appareil où le classeur est ouvert)."])]) : null,
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
        ]) : h('div', { class: 'welcome-grid' }, STANDALONE ? [link, create] : [create, link]),
        h('p', { class: 'small muted' }, "Une fois ton compte du jeu relié, le classeur lit ta collection dans la base du jeu, tout seul et quand tu le demandes. Il ne joue jamais à ta place et n'écrit rien dans le jeu."),
      ];
    }
    return h('div', { class: 'welcome' }, [head, h('main', { class: 'wrap welcome-main' }, body)]);
  }

  // ================================================================ composants
  const Top = { name: 'Top', setup: () => viewTop };
  const Main = { name: 'Main', setup: () => viewMain };
  const MBar = { name: 'MBar', setup: () => viewMobileBar };
  const MNav = { name: 'MNav', setup: () => viewMobileNav };
  const MMore = { name: 'MMore', setup: () => () => h(Transition, { name: 'msheet' }, () => viewMobileMore()) };
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
          g ? h('div', { class: ['ro-ghost', g.card ? 'r' + (okRarity(g.card.rarity) || 'C') : isLabel(g.item) ? 'ro-ghost--label' : 'ro-ghost--missing'], 'aria-hidden': 'true',
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

  // Kokoro Farmer (2026-10-23) : page cachée, un faux booster d'articles de Wikipédia UR et L pour rire (assets/kokoro.js), ouverte
  // seulement par le code Konami tapé au clavier, hors d'un champ de saisie. Ses fichiers ne se chargent qu'à ce moment.
  const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
  let konamiKeys = [];
  let kokoroLoading = null;
  function loadKokoro() {
    if (window.KokoroFarmer) return Promise.resolve();
    if (!kokoroLoading) {
      const add = (tag, attrs) => new Promise((ok, ko) => {
        const n = Object.assign(document.createElement(tag), attrs, { onload: ok, onerror: ko });
        document.head.append(n);
      });
      kokoroLoading = Promise.all([add('link', { rel: 'stylesheet', href: '/assets/kokoro.css' }), add('script', { src: '/assets/kokoro.js' })])
        .catch((err) => { kokoroLoading = null; throw err; });
    }
    return kokoroLoading;
  }
  function watchKonami(e) {
    const tag = (e.target && e.target.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable)) { konamiKeys = []; return; }
    konamiKeys = [...konamiKeys, String(e.key || '').toLowerCase()].slice(-KONAMI.length);
    if (konamiKeys.join() !== KONAMI.join()) return;
    konamiKeys = [];
    loadKokoro().then(() => window.KokoroFarmer.open()).catch(() => {});
  }
  // Sur téléphone (pas de clavier) : SOS en morse (··· ——— ···) tapé sur le titre de la barre du haut (logo et nom de la
  // vue, rien de cliquable) : appui court = point, appui d'au moins 300 ms = trait ; plus de 1,5 s entre deux appuis, ou un
  // appui de plus de 1,5 s, et on recommence.
  const SOS = '...---...';
  let morse = '', morseDown = 0, morseUp = 0;
  const morseZone = (t) => !!(t && t.closest && t.closest('.mbar__mark, .mbar__title'));
  function morseDownAt(e) {
    if (!morseZone(e.target)) { morse = ''; return; }
    morseDown = performance.now();
    if (morseDown - morseUp > 1500) morse = '';
  }
  function morseUpAt(e) {
    if (!morseDown) return;
    const now = performance.now(), held = now - morseDown;
    morseDown = 0;
    if (!morseZone(e.target) || held > 1500) { morse = ''; return; }
    morseUp = now;
    morse = (morse + (held < 300 ? '.' : '-')).slice(-SOS.length);
    if (morse !== SOS) return;
    morse = '';
    if (navigator.vibrate) navigator.vibrate([60, 40, 60, 40, 60]);
    loadKokoro().then(() => window.KokoroFarmer.open()).catch(() => {});
  }

  function onKey(e) {
    watchKonami(e);
    if (S.boot !== 'app') return;
    if (e.key === 'Escape') {
      if (S.modal) { e.preventDefault(); closeModal(); return; }
      if (S.openId || S.openMissing) { e.preventDefault(); closeCard(); return; }
      if (S.mMore || S.mFacets) { e.preventDefault(); S.mMore = false; S.mFacets = false; return; }
      return;
    }
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (e.key === '/' && S.tab === 'cartes' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag) && !S.modal && !S.openId) {
      const q = document.getElementById('q');
      if (q) { e.preventDefault(); q.focus(); }
    }
  }
  // Retour sur l'onglet, puis toutes les 60 s tant qu'il reste visible (LIVE_EVERY) : cards_rev (GET /api/me) dit si
  // quelque chose a changé (lecture automatique de la collection par le serveur ; tags modifiés sur un autre appareil), et
  // les cartes ne sont relues (?since) que dans ce cas. Sans lui (ancien serveur), seul un nouvel envoi (fetched_at)
  // recharge, comme avant. GET /api/me ne lit qu'une ligne de la base (le compte, par l'index unique de sa clé). Onglet
  // caché : minuterie arrêtée, aucune requête. poll = true : relecture périodique, sautée si une autre est en cours ou si
  // les cartes se chargent.
  const LIVE_EVERY = 60 * 1000;
  let liveTimer = null;
  let livePolling = false;
  async function checkRemote(poll) {
    if (document.visibilityState !== 'visible' || S.boot !== 'app' || S.refresh.running) return;
    if (poll && (livePolling || S.loadingCards)) return;
    if (poll) livePolling = true;
    try {
      const before = S.me && S.me.fetched_at;
      try { await loadMe(); } catch (e) { return; }
      const me = S.me;
      // Nouvelle lecture du marché par le serveur (automatique ou au clic, réussie ou non) : l'onglet « Marché » est relu.
      if (M.loaded && me && typeof me.market_at === 'string' && me.market_at > marketSeen) loadMarket(true);
      const imported = !!(me && me.fetched_at && me.fetched_at !== before);
      if (!(imported || (me && Number.isInteger(me.cards_rev) && me.cards_rev !== cardsRev))) return;
      try {
        const changed = await syncCards(me);
        if (imported) await loadTargets(); // auto-tag activé ailleurs : charger aussi les nouveaux liens avant runAutoAdd
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
      if (S.duplicatesOnly) p.set('doublons', '1');
      if (S.keptOnly) p.set('exclues', '1');
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
      } else if (fr.page === 'fill' || fr.page === 'wants') {
        path = fr.page === 'fill' ? 'amis/pour-toi' : 'amis/pour-eux';
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
    const r = { tab: 'collections', album: null, withSubs: false, friend: null, falbum: null, trades: false, fpage: null, p: new URLSearchParams() };
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
    else if (a === 'amis' && (b === 'pour-toi' || b === 'pour-eux')) { r.tab = 'amis'; r.fpage = b === 'pour-toi' ? 'fill' : 'wants'; }
    else if (TABS.some(([id]) => id === a) || a === 'nouveautes' || a === 'souhaits-sans-cartes') r.tab = a;
    return r;
  }

  // Ouvre la vue d'une adresse. Ce qui y est déjà ouvert n'est pas rouvert (une catégorie n'est pas relue).
  function applyRoute(r) {
    // Ton propre classeur vu par les autres (#/ami/<ton id public>, lien cité dans le chat) : tes cartes, ou ta collection.
    if (r.friend && r.friend === myPid()) {
      if (r.falbum) { r.tab = 'collections'; r.album = { kind: 'target', id: r.falbum }; } else r.tab = 'cartes';
      r.friend = null;
      r.falbum = null;
    }
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
        gtagFilter: list('jeu'), untaggedOnly: p.get('sans-tag') === '1', newOnly: p.get('nouvelles') === '1', duplicatesOnly: p.get('doublons') === '1', keptOnly: p.get('exclues') === '1' });
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
        if (fr.page !== 'trades' || fr.open) openTrades(p.get('qui') || tradePref()); else fr.trade = p.get('qui') || tradePref();
      } else if (r.fpage) {
        if (fr.page !== r.fpage || fr.open) openFriendsPage(r.fpage);
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
        window.addEventListener('pointerdown', morseDownAt);
        window.addEventListener('pointerup', morseUpAt);
        window.addEventListener('pointercancel', () => { morseDown = 0; morse = ''; });
        window.addEventListener('contextmenu', (e) => { if (morseZone(e.target)) e.preventDefault(); }); // appui long sur Android
        window.addEventListener('hashchange', () => { const k = takeHashKey(); if (k != null) boot(k); else onRouteChange(); });
        window.addEventListener('popstate', onRouteChange);
        document.addEventListener('visibilitychange', onVisible);
        // Réseau revenu alors que le classeur n'a pas pu s'ouvrir (clé gardée) : on réessaie tout seul.
        window.addEventListener('online', () => { if (S.boot === 'welcome' && S.key && (S.healthError || (S.bootError && !S.bootHint))) boot(); });
        // Ordre réorganisé pas encore enregistré : recharger ou fermer la page le demande d'abord (message du navigateur).
        window.addEventListener('beforeunload', (e) => { routeFlush(); if ((S.reorder && S.reorder.dirty) || (S.colOrder && S.colOrder.dirty)) { e.preventDefault(); e.returnValue = ''; } });
        setLive();
        boot(LINK_KEY);
      });
      return () => {
        let main;
        if (S.boot === 'loading') main = h('p', { class: 'boot', role: 'status' }, 'Ouverture du classeur…');
        else if (S.boot === 'welcome') main = h(Welcome);
        else main = h('div', { class: 'app' }, [h(MBar), h(Top), h(Main), h(BulkBar), h(MNav), h(MMore), h(Fiche), h(Modals), h(TagList)]);
        return [main, h(Notice)];
      };
    },
  };

  watch([() => S.q, () => S.sort, () => S.rarities.join(), () => S.tagFilter.join('\u0001'), () => S.gtagFilter.join('\u0001'), () => S.untaggedOnly, () => S.newOnly, () => S.duplicatesOnly, () => S.keptOnly], () => { S.limit = PAGE; });
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
