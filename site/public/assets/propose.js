/* Le classeur : collections proposées d'après les catégories Wikipédia des cartes de l'utilisateur.
 *
 * Chaque carte est un article de Wikipédia FR. On relève les catégories de ces articles, on écarte celles de rangement
 * et de temps (naissances, décès, années, homonymies…), on mesure la taille des autres (articles directement dedans)
 * et on propose celles dont l'utilisateur possède déjà au moins 5 % (et au moins 2 cartes). Tout se passe dans le
 * navigateur, une requête à la fois, avec un cache de 14 jours dans localStorage.
 *
 * ---------------------------------------------------------------------------------------------------------- Intégration
 * (pour l'agent interface ; ce fichier ne touche ni au DOM ni à l'API du classeur)
 *
 * Chargement : `<script defer src="/assets/propose.js"></script>` AVANT `app.js` (deux `defer` gardent leur ordre).
 * Script classique, sans eval ni code en ligne ; la CSP laisse déjà passer `connect-src https://fr.wikipedia.org`.
 * Il définit `window.ClasseurPropose = {createProposer, displayName, keyOf, categoryTitle, isNoise, noiseReason}`.
 *
 *   const P = window.ClasseurPropose;                 // absent si le script n'a pas chargé : ne rien afficher
 *   const proposer = P.createProposer({});            // fetch, localStorage et Date.now par défaut ; un seul par page
 *
 * Quand lancer `compute` :
 *   - après le chargement de TOUTES les cartes (fin de la boucle GET /api/cards?part=…), avec leurs titres ;
 *   - automatiquement au plus une fois par semaine (date du dernier calcul dans localStorage, par ex.
 *     `classeur-propose-at`) ET seulement si `proposer.uncached(titres)` est petit (≤ 500 : une dizaine de requêtes) ;
 *     sinon, et à tout moment, sur un bouton « Chercher des propositions ». Les caches durent 14 jours : un nouveau
 *     calcul ne demande à Wikipédia que les cartes nouvelles (0 requête si rien n'a changé). Premier calcul :
 *     ~1 requête par 50 cartes + ~1 par 50 catégories candidates, 0,3 s d'écart → 1 000 cartes ≈ 15 s, 20 000 ≈ 4 min ;
 *   - un seul calcul à la fois ; « Annuler » = `ctrl.abort()` (ce qui est déjà relevé reste en cache).
 *
 *   const ctrl = new AbortController();
 *   const exclude = [
 *     ...targets.map((t) => t.source).filter((s) => typeof s === 'string' && s.startsWith('wp:')),   // déjà ajoutées
 *     ...S.prefs.hidden_proposals,                                                                   // retirées
 *   ];
 *   const list = await proposer.compute(cards.map((c) => c.title), {
 *     signal: ctrl.signal, exclude,
 *     onProgress: ({ step, done, total, label }) => { ... },   // step : 'categories' | 'sizes' | 'done'
 *   });
 *   // list : [{key:'wp:Kampen', title:'Catégorie:Kampen', name:'Kampen', url, size:26, owned:2, ratio:0.077,
 *   //          cards:['titre possédé', …], subcats:1, partial:false, parents:['Commune d'Overijssel', …]}], triées par
 *   //          ratio puis owned décroissants ; parents = catégories parentes visibles de la proposition (sans préfixe).
 *   // Puis, à l'affichage (sans requête) : P.prune(list, {covered, stats}) écarte les sous-catégories (voir prune).
 *   // Erreurs : rejet avec un Error au message français lisible tel quel ; err.name === 'AbortError' si annulé
 *   // (ne rien afficher).
 *
 * Affichage : « Proposées d'après tes cartes », dans la zone « Catégories » de l'onglet Collections. Barre de
 * progression : `<progress max=total value=done>` + `label` (« Catégories de tes cartes : 300 sur 1 043 », puis
 * « Taille des catégories »). Par proposition : `name`, `owned` sur `size` et le pourcentage (`ratio`), quelques
 * titres de `cards` (déjà possédés), lien `url` ; si `partial` : « (avec sous-catégories) » (seuls les articles
 * directement dans la catégorie sont comptés). Masquées si `prefs.hide_proposals`.
 *
 * Avant l'affichage : `P.prune(list, { covered: (p) => …, stats: {} })` (voir prune, en bas : propositions couvertes
 * par une collection, sous-catégories d'une catégorie proposée, regroupées sous elle dans `subs`).
 *
 * « Créer une collection » (source 'wp:<nom>', dans « Mes collections ») :
 *   const members = await proposer.loadMembers(p.title, { signal });     // [{title}] (3 000 au plus, articles seuls)
 *   (si p.subs : avec les articles de ses sous-catégories, 1 niveau, et des propositions qu'elle regroupe ; l'interface
 *    les lit elle-même)
 *   const items = members.map((m) => ({ title: m.title, description: null, image: null, status: 'ok' }));
 *   const name = p.name.length > 80 ? p.name.slice(0, 79) + '…' : p.name;            // le serveur : 80 caractères au plus
 *   await api('POST', '/api/targets/save', { name, items, source: p.key });           // source = 'wp:<nom>' (≤ 200)
 *   (les titres viennent de Wikipédia : pas besoin de les revérifier ; la proposition disparaît au calcul suivant,
 *    ou tout de suite si on la retire de la liste affichée.)
 * « Retirer des propositions » : `savePrefs({ hidden_proposals: [...S.prefs.hidden_proposals, p.key] })`. Les clés
 * n'ont pas le préfixe « Catégorie: » pour ménager les 4 Ko de `prefs` (~80 retraits possibles).
 * `exclude` accepte 'wp:<nom>', 'wp:Catégorie:<nom>' et 'Catégorie:<nom>' ; un texte sans préfixe (ancien id du
 * catalogue) y est ignoré.
 * --------------------------------------------------------------------------------------------------------------------
 */
(function () {
  'use strict';

  const API = 'https://fr.wikipedia.org/w/api.php';
  const NS = 'Catégorie:';
  const DAY = 864e5;
  const TTL = 14 * DAY;
  const LS_CATS = 'classeur-cats'; // titre de carte -> [date, [catégories sans le préfixe, bruit déjà retiré]]
  const LS_INFO = 'classeur-catinfo'; // nom de catégorie -> [date, [articles directs, sous-catégories]]
  const LS_PARENTS = 'classeur-catparents'; // nom de catégorie proposée -> [date, [catégories parentes visibles, sans le préfixe]]
  // Bornes des caches (caractères JSON) : localStorage est partagé avec le reste du classeur (~5 Mo en tout).
  // 1 043 cartes ≈ 145 000 caractères de catégories : la borne tient ~7 000 cartes, au-delà les plus vieilles sont
  // redemandées au calcul suivant.
  const MAX_CATS_CHARS = 1000000;
  const MAX_INFO_CHARS = 300000;
  const MAX_PARENTS_CHARS = 200000;
  const BATCH = 50; // titres par requête (limite de l'API pour un compte anonyme)
  const MAX_URL_TITLES = 6000; // longueur encodée des titres d'une requête (adresse raisonnable)
  const MAX_MEMBERS = 3000; // une collection à compléter a 3 000 éléments au plus

  // ------------------------------------------------------------------------------------------------ noms et clés
  const PREFIX_RE = /^(?:Catégorie|Category)\s*:\s*/i;
  const clean = (s) => String(s == null ? '' : s).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const upFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  // Nom lisible : le titre sans « Catégorie: » (et sans « wp: »).
  function displayName(cat) {
    let s = clean(cat);
    if (s.startsWith('wp:')) s = s.slice(3).trim();
    return upFirst(s.replace(PREFIX_RE, ''));
  }
  const categoryTitle = (cat) => NS + displayName(cat);
  const keyOf = (cat) => 'wp:' + displayName(cat);
  const wikiUrl = (title) => 'https://fr.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')).replace(/%3A/g, ':').replace(/%2F/g, '/');

  // ------------------------------------------------------------------------------------------------ filtre du bruit
  // Catégories de rangement (maintenance, homonymies, listes, naissances et décès) et de temps (années, mois, jours,
  // décennies, saisons, « … en 1998 », « … de 1918 ») : pas des collections. Testé sur les 4 322 catégories des
  // 1 043 cartes de data/owned.json. On garde les siècles (« Peintre français du XIXe siècle » : c'est ainsi que
  // Wikipédia range les personnes par métier) et les chiffres qui ne sont pas des dates (« 2e arrondissement de
  // Lyon », « 800 mètres aux championnats du monde d'athlétisme »).
  const MONTHS = 'janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre';
  const NOISE_RULES = [
    ['rangement', /^(?:Naissance|Décès|Pages?|Articles?|Portails?|Wikipédia|Wikidata|Ébauches?|Homonymies?|Listes?|Catégories?|Personnalités?|Personnes?|Infobox|Redirections?|Sigles?)(?:[\s:,(]|$)/i],
    ['rangement', /^Projets?(?::| [A-ZÀ-Ý])/], // projets Wikipédia (« Projet Musique »), pas « Projet ferroviaire en France »
    ['rangement', / par (?:pays|continent|ville|région|département|province|état|nationalité|date|année|décennie|siècle|époque|thème|sujet|type|genre|instrument|discipline|lieu|langue|origine|organisation|œuvre|auteur|artiste|nom|sport|club|équipe|compétition|saison)$/i], // catégories-conteneurs
    ['année', /^\d{1,4}(?: av\. J\.-C\.)?(?:$| (?:en|au|aux|à|dans|par) )/], // « 1925 », « 1942 en Palestine mandataire », « 2006 aux États-Unis »
    ['jour', new RegExp('^\\d{1,2}(?:er)? (?:' + MONTHS + ')(?:$|\\s)', 'i')], // « 26 décembre »
    ['mois', new RegExp('^(?:' + MONTHS + ') \\d{1,4}', 'i')], // « Octobre 1925 », « Mars 2012 en France »
    ['mois', new RegExp(' en (?:' + MONTHS + ') \\d{3,4}', 'i')], // « Sport en octobre 1985 », « Politique en mars 2012 »
    ['mois', /^Mois (?:de |d')/i],
    ['année', /^(?:Années?|Décennies?) \d/i], // « Années 1920 »
    ['année', /^(?:Chronologie|Calendrier)(?:\s|$)/i], // « Chronologie de l'Inde au XXe siècle »
    ['année', /^[IVXL]+e (?:siècle|millénaire)/], // « XVe siècle en littérature » (les siècles en fin de nom restent)
    ['décennie', /\bannées \d{3,4}/i], // « Avion des années 1930 », « Série télévisée allemande des années 1990 »
  ];
  // Tranches datées : « … en 1998 » (création, sortie, découverte), « … de 1918 » (traité, chanson, édition des Jeux),
  // périodes « 2023-2024 ». Sauf les événements nommés par leur date (« Bataille de la guerre anglo-américaine de 1812 »,
  // « Exposition universelle de 1900 », « Titulaire de la croix de guerre 1914-1918 ») et les périodes entre parenthèses
  // (« Étudiant de l'université catholique de Louvain (1834-1968) »).
  const DATED_RULES = [
    ['« en <année> »', / en \d{3,4}(?:$|[\s,)])/],
    ['« de <année> »', /(?:^| )(?:de|du|des) \d{3,4}$/],
    ['période', /(?:^|[^(\d])\d{4} ?[-–] ?\d{2,4}(?:$|[^)\d])|\bde \d{3,4} à \d{3,4}/], // « Saison 2023-2024 de rugby », « … 1994-1999 », « de 1790 à 1795 »
  ];
  const EVENT_RE = /\b(?:guerre|révolution|exposition|expédition|crise|insurrection|révolte|campagne|soulèvement|siège)\b/i;
  function noiseReason(cat) {
    const n = displayName(cat);
    if (!n) return 'vide';
    for (const [why, re] of NOISE_RULES) if (re.test(n)) return why;
    if (!EVENT_RE.test(n)) for (const [why, re] of DATED_RULES) if (re.test(n)) return why;
    return null;
  }
  const isNoise = (cat) => noiseReason(cat) !== null;

  // ------------------------------------------------------------------------------------------------ outils
  const abortError = () => { const e = new Error('Recherche annulée.'); e.name = 'AbortError'; return e; };
  function defaultSleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) { reject(abortError()); return; }
      const onAbort = () => { clearTimeout(t); reject(abortError()); };
      const t = setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, Math.max(0, ms));
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }
  function memoryStorage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
  }
  function defaultStorage() {
    try { if (typeof window !== 'undefined' && window.localStorage) return window.localStorage; } catch (e) { /* refusé */ }
    return memoryStorage();
  }
  // Paquets de titres : 50 au plus, et une adresse de longueur raisonnable.
  function batches(list, max, maxLen) {
    const out = [];
    let cur = [];
    let len = 0;
    for (const t of list) {
      const l = encodeURIComponent(t).length + 3;
      if (cur.length && (cur.length >= max || len + l > maxLen)) { out.push(cur); cur = []; len = 0; }
      cur.push(t);
      len += l;
    }
    if (cur.length) out.push(cur);
    return out;
  }
  // Titre inutilisable dans une requête (caractères interdits dans un titre MediaWiki).
  const badTitle = (t) => !t || t.length > 255 || /[|#<>[\]{}]/.test(t);

  // Cache {clé: [date, valeur]} dans un localStorage, avec durée de vie et taille bornée (les plus vieux partent).
  function makeCache(storage, name, ttl, maxChars, now) {
    let map = null;
    let dirty = false;
    function load() {
      if (map) return map;
      map = new Map();
      let raw = null;
      try { raw = JSON.parse(storage.getItem(name) || 'null'); } catch (e) { raw = null; }
      const t = now();
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const k of Object.keys(raw)) {
          const v = raw[k];
          if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && t - v[0] < ttl) map.set(k, v);
        }
      }
      return map;
    }
    const fresh = (v) => now() - v[0] < ttl;
    return {
      has(k) { const v = load().get(k); return !!v && fresh(v); },
      get(k) { const v = load().get(k); return v && fresh(v) ? v[1] : undefined; },
      set(k, val) { load().set(k, [now(), val]); dirty = true; },
      size() { return load().size; },
      save() {
        if (!dirty || !map) return;
        dirty = false;
        const t = now();
        let entries = [...map.entries()].filter(([, v]) => t - v[0] < ttl).sort((a, b) => b[1][0] - a[1][0]);
        let text = JSON.stringify(Object.fromEntries(entries));
        if (text.length > maxChars) {
          let total = 2;
          const kept = [];
          for (const e of entries) {
            const l = JSON.stringify(e[0]).length + JSON.stringify(e[1]).length + 2;
            if (total + l > maxChars) break;
            total += l;
            kept.push(e);
          }
          entries = kept;
          text = JSON.stringify(Object.fromEntries(entries));
        }
        for (let i = 0; i < 6; i++) {
          try { storage.setItem(name, text); map = new Map(entries); return; } catch (e) { /* plus de place : on oublie la plus vieille moitié */ }
          entries = entries.slice(0, Math.floor(entries.length / 2));
          text = JSON.stringify(Object.fromEntries(entries));
        }
        map = new Map(entries);
        try { storage.removeItem(name); } catch (e) { /* rien à faire */ }
      },
      clear() { map = new Map(); dirty = false; try { storage.removeItem(name); } catch (e) { /* rien */ } },
    };
  }

  // ------------------------------------------------------------------------------------------------ le module
  function createProposer(opts) {
    const o = opts || {};
    const fetchFn = o.fetch || (typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : null);
    const storage = o.storage || defaultStorage();
    const now = o.now || (() => Date.now());
    const sleep = o.sleep || defaultSleep;
    const gap = o.gap == null ? 300 : o.gap; // pause entre deux requêtes (ms)
    const api = o.api || API;
    const cats = makeCache(storage, LS_CATS, TTL, o.maxCatsChars || MAX_CATS_CHARS, now);
    const info = makeCache(storage, LS_INFO, TTL, o.maxInfoChars || MAX_INFO_CHARS, now);
    const parents = makeCache(storage, LS_PARENTS, TTL, o.maxParentsChars || MAX_PARENTS_CHARS, now);

    // Une requête à la fois (tous les calculs de ce module passent par la même file).
    let chain = Promise.resolve();
    let last = 0;
    function queued(fn) {
      const p = chain.then(fn, fn);
      chain = p.catch(() => {});
      return p;
    }
    function retryDelay(r, fallback) {
      const h = r && r.headers && typeof r.headers.get === 'function' ? r.headers.get('retry-after') : null;
      if (h != null && h !== '') {
        const n = Number(h);
        if (Number.isFinite(n) && n >= 0) return Math.min(n, 120) * 1000 + 250;
        const d = Date.parse(h);
        if (Number.isFinite(d)) return Math.min(Math.max(d - now(), 0), 120000) + 250;
      }
      return fallback;
    }
    function getJson(params, signal) {
      const url = api + '?' + new URLSearchParams(Object.assign({ format: 'json', formatversion: '2', origin: '*' }, params)).toString();
      return queued(async () => {
        if (!fetchFn) throw new Error("Ce navigateur ne sait pas interroger Wikipédia.");
        let backoff = 2000;
        for (let attempt = 0; attempt < 8; attempt++) {
          if (signal && signal.aborted) throw abortError();
          const wait = last + gap - now();
          if (wait > 0) await sleep(wait, signal);
          last = now();
          let r = null;
          try {
            r = await fetchFn(url, { headers: { Accept: 'application/json' }, credentials: 'omit', signal });
          } catch (e) {
            if ((signal && signal.aborted) || (e && e.name === 'AbortError')) throw abortError();
            r = null;
          }
          if (r && r.ok) {
            let j;
            try { j = await r.json(); } catch (e) { j = null; }
            if (j && j.error) {
              const code = String(j.error.code || '');
              if (!/^(?:maxlag|ratelimited|readonly|internal_api_error)/.test(code)) throw new Error('Wikipédia a refusé la demande : ' + (j.error.info || code) + '.');
            } else if (j) return j;
            await sleep(retryDelay(r, backoff), signal);
            backoff = Math.min(backoff * 2, 30000);
            continue;
          }
          if (r && r.status !== 429 && r.status < 500) throw new Error('Wikipédia a répondu ' + r.status + '.');
          await sleep(retryDelay(r, backoff), signal); // 429 : attendre ce que Wikipédia demande
          backoff = Math.min(backoff * 2, 30000);
        }
        throw new Error("Wikipédia ne répond pas pour l'instant : réessaie dans quelques minutes.");
      });
    }
    // Requête avec suivi de `continue` ; onQuery(query) pour chaque morceau ; stop() pour s'arrêter avant la fin.
    async function apiAll(params, signal, onQuery, stop) {
      let cont = {};
      for (let guard = 0; guard < 200; guard++) {
        const j = await getJson(Object.assign({}, params, cont), signal);
        onQuery(j.query || {});
        if (!j.continue || (stop && stop())) return;
        cont = j.continue;
      }
    }

    // 1. Catégories (visibles) d'un paquet d'articles, rattachées au titre demandé (normalisation, redirection).
    async function fetchCategories(batch, signal) {
      const norm = new Map();
      const redir = new Map();
      const got = new Map();
      await apiAll({ action: 'query', prop: 'categories', clshow: '!hidden', cllimit: 'max', redirects: '1', titles: batch.join('|') }, signal, (q) => {
        for (const n of q.normalized || []) norm.set(n.from, n.to);
        for (const r of q.redirects || []) redir.set(r.from, r.to);
        for (const p of q.pages || []) {
          if (!p || typeof p.title !== 'string') continue;
          let s = got.get(p.title);
          if (!s) { s = new Set(); got.set(p.title, s); }
          for (const c of p.categories || []) if (c && typeof c.title === 'string') s.add(c.title); // morceaux successifs : on cumule
        }
      });
      const out = new Map();
      for (const t of batch) {
        let f = norm.get(t) || t;
        for (let i = 0; i < 3 && redir.has(f); i++) { const to = redir.get(f); f = norm.get(to) || to; }
        const s = got.get(f);
        out.set(t, s ? [...s].map(displayName).filter((c) => c && !isNoise(c)) : []);
      }
      return out;
    }
    // 3. Taille des catégories : articles directement dedans et sous-catégories.
    async function fetchInfo(names, signal) {
      const out = new Map();
      const norm = new Map();
      await apiAll({ action: 'query', prop: 'categoryinfo', titles: names.map((n) => NS + n).join('|') }, signal, (q) => {
        for (const n of q.normalized || []) norm.set(n.to, n.from);
        for (const p of q.pages || []) {
          if (!p || typeof p.title !== 'string') continue;
          const ci = p.categoryinfo;
          const v = [ci ? Math.max(0, ci.pages | 0) : 0, ci ? Math.max(0, ci.subcats | 0) : 0];
          out.set(displayName(norm.get(p.title) || p.title), v);
        }
      });
      for (const n of names) if (!out.has(n)) out.set(n, [0, 0]);
      return out;
    }
    // 5. Catégories parentes (visibles) de catégories : prop=categories sur les pages de l'espace 14.
    async function fetchParents(names, signal) {
      const out = new Map();
      const norm = new Map();
      await apiAll({ action: 'query', prop: 'categories', clshow: '!hidden', cllimit: 'max', redirects: '1', titles: names.map((n) => NS + n).join('|') }, signal, (q) => {
        for (const n of q.normalized || []) norm.set(n.to, n.from);
        for (const p of q.pages || []) {
          if (!p || typeof p.title !== 'string') continue;
          const k = displayName(norm.get(p.title) || p.title);
          let set = out.get(k);
          if (!set) { set = new Set(); out.set(k, set); }
          for (const c of p.categories || []) if (c && typeof c.title === 'string') set.add(displayName(c.title)); // morceaux successifs : on cumule
        }
      });
      for (const n of names) if (!out.has(n)) out.set(n, new Set());
      return out;
    }

    function cleanTitles(titles) {
      const seen = new Set();
      const out = [];
      for (const t of titles || []) {
        if (typeof t !== 'string') continue;
        const s = t.trim();
        if (!s || seen.has(s)) continue;
        seen.add(s);
        out.push(s);
      }
      return out;
    }
    // Nombre de titres que `compute` devrait encore demander à Wikipédia (jamais relevés, ou il y a plus de 14 jours).
    function uncached(titles) {
      return cleanTitles(titles).filter((t) => !badTitle(t) && !cats.has(t)).length;
    }

    async function compute(titles, options) {
      const op = options || {};
      const signal = op.signal;
      const onProgress = typeof op.onProgress === 'function' ? op.onProgress : () => {};
      const threshold = op.threshold == null ? 0.05 : Number(op.threshold);
      const minCards = op.minCards == null ? 2 : Number(op.minCards);
      const minSize = op.minSize == null ? 10 : Number(op.minSize);
      const maxSize = op.maxSize == null ? 3000 : Number(op.maxSize);
      const excluded = new Set();
      for (const e of op.exclude || []) {
        if (typeof e !== 'string') continue;
        const s = e.trim();
        if (s.startsWith('wp:') || PREFIX_RE.test(s)) excluded.add(displayName(s));
      }
      const list = cleanTitles(titles).filter((t) => !badTitle(t));
      const report = (step, done, total, label) => { try { onProgress({ step, done, total, label }); } catch (e) { /* l'affichage ne doit pas casser le calcul */ } };
      if (signal && signal.aborted) throw abortError();

      // 1-2. Catégories de chaque carte (cache, puis Wikipédia pour les autres), bruit retiré.
      const catsOf = new Map();
      const todo = [];
      for (const t of list) {
        const v = cats.get(t);
        if (Array.isArray(v)) catsOf.set(t, v); else todo.push(t);
      }
      const label1 = (d) => 'Catégories de tes cartes : ' + d.toLocaleString('fr-FR') + ' sur ' + todo.length.toLocaleString('fr-FR');
      report('categories', 0, todo.length, label1(0));
      let done = 0;
      let n = 0;
      try {
        for (const batch of batches(todo, BATCH, MAX_URL_TITLES)) {
          const got = await fetchCategories(batch, signal);
          for (const [t, cs] of got) { cats.set(t, cs); catsOf.set(t, cs); }
          done += batch.length;
          if (++n % 10 === 0) cats.save();
          report('categories', done, todo.length, label1(done));
        }
      } finally { cats.save(); }

      // 4a. Cartes possédées par catégorie ; seules celles qui peuvent passer le seuil de cartes ont besoin d'une taille.
      const members = new Map();
      for (const t of list) {
        for (const c of catsOf.get(t) || []) {
          if (excluded.has(c) || isNoise(c)) continue; // le filtre peut avoir changé depuis la mise en cache
          let a = members.get(c);
          if (!a) { a = []; members.set(c, a); }
          a.push(t);
        }
      }
      const cand = [...members.keys()].filter((c) => members.get(c).length >= Math.max(1, minCards));

      // 3. Tailles (cache, puis Wikipédia).
      const sizes = new Map();
      const todoInfo = [];
      for (const c of cand) {
        const v = info.get(c);
        if (Array.isArray(v)) sizes.set(c, v); else todoInfo.push(c);
      }
      const label2 = (d) => 'Taille des catégories : ' + d.toLocaleString('fr-FR') + ' sur ' + todoInfo.length.toLocaleString('fr-FR');
      report('sizes', 0, todoInfo.length, label2(0));
      done = 0;
      n = 0;
      try {
        for (const batch of batches(todoInfo, BATCH, MAX_URL_TITLES)) {
          const got = await fetchInfo(batch, signal);
          for (const [c, v] of got) { if (!batch.includes(c)) continue; info.set(c, v); sizes.set(c, v); }
          done += batch.length;
          if (++n % 10 === 0) info.save();
          report('sizes', done, todoInfo.length, label2(done));
        }
      } finally { info.save(); }

      // 4b. Seuils.
      const out = [];
      for (const c of cand) {
        const v = sizes.get(c) || [0, 0];
        const owned = members.get(c);
        const size = Math.max(v[0], owned.length);
        const ratio = owned.length / size;
        if (size < minSize || size > maxSize || owned.length < minCards || ratio < threshold) continue;
        if (c.length > 197) continue; // la source d'une collection fait 200 caractères au plus (« wp: » compris)
        const title = NS + c;
        out.push({ key: 'wp:' + c, title, name: c, url: wikiUrl(title), size, owned: owned.length, ratio, cards: owned.slice(),
          subcats: v[1], partial: v[1] > 0 && v[1] * 4 >= v[0] });
      }
      // 5. Catégories parentes des propositions (cache, puis Wikipédia) : de quoi regrouper à l'affichage les
      // sous-catégories d'une catégorie proposée (prune). Un incident ici ne prive pas des propositions.
      const todoParents = out.map((r) => r.name).filter((n) => !Array.isArray(parents.get(n)));
      const label3 = (d) => 'Catégories parentes : ' + d.toLocaleString('fr-FR') + ' sur ' + todoParents.length.toLocaleString('fr-FR');
      report('parents', 0, todoParents.length, label3(0));
      done = 0;
      try {
        for (const batch of batches(todoParents, BATCH, MAX_URL_TITLES)) {
          const got = await fetchParents(batch, signal);
          for (const [c, v] of got) if (batch.includes(c)) parents.set(c, [...v]);
          done += batch.length;
          report('parents', done, todoParents.length, label3(done));
        }
      } catch (e) {
        if ((signal && signal.aborted) || (e && e.name === 'AbortError')) throw e;
      } finally { parents.save(); }
      for (const r of out) { const v = parents.get(r.name); r.parents = Array.isArray(v) ? v.slice() : []; }
      out.sort((a, b) => b.ratio - a.ratio || b.owned - a.owned || a.name.localeCompare(b.name, 'fr'));
      report('done', out.length, out.length, out.length ? out.length + (out.length > 1 ? ' propositions' : ' proposition') : 'Aucune proposition');
      return out;
    }

    // Articles d'une catégorie (pas ses sous-catégories), 3 000 au plus, dans l'ordre de Wikipédia.
    async function loadMembers(category, options) {
      const op = options || {};
      const limit = Math.min(op.limit || MAX_MEMBERS, MAX_MEMBERS);
      const out = [];
      const seen = new Set();
      await apiAll({ action: 'query', list: 'categorymembers', cmtitle: categoryTitle(category), cmtype: 'page', cmnamespace: '0', cmlimit: '500' }, op.signal, (q) => {
        for (const m of q.categorymembers || []) {
          if (!m || typeof m.title !== 'string' || seen.has(m.title) || out.length >= limit) continue;
          seen.add(m.title);
          out.push({ title: m.title });
        }
      }, () => out.length >= limit);
      return out;
    }

    function clearCache() { cats.clear(); info.clear(); parents.clear(); }

    return { compute, loadMembers, uncached, clearCache };
  }

  // ------------------------------------------------------------------------------------------------ à l'affichage
  // Propositions à montrer, sans aucune requête (les sous-catégories d'un même thème ne sont pas proposées une à une) :
  //  - « couverte » : covered(p) vrai (l'interface le calcule : au moins 80 % des cartes qui rendent la catégorie
  //    proposable, p.cards, sont déjà dans une même de ses collections, quelle qu'en soit la source) → écartée. C'est
  //    aussi ce qui écarte les filles d'une catégorie dont une collection a été faite AVEC ses sous-catégories (leurs
  //    articles y sont) ; faite sans elles, ses filles restent proposées : sur Wikipédia, un article est rangé dans la
  //    catégorie la plus précise, la parente ne le contient pas (« Race bovine originaire d'Europe » n'a pas les races
  //    d'Italie ni d'Espagne) ;
  //  - une catégorie parente (p.parents) est elle-même proposée (dans la liste, après la règle ci-dessus) → écartée : la
  //    parente reste et la regroupe (d'une chaîne, seule la plus haute reste) ; si la parente n'est pas proposable
  //    (seuils, retirée, couverte, déjà en collection), les filles restent. Catégories parentes les unes des autres
  //    (cycle de 2 ou plus) : la plus grande reste (à taille égale, la première dans l'ordre alphabétique).
  // Rend la liste filtrée, dans le même ordre. Une proposition qui en regroupe d'autres est rendue en copie avec `subs` :
  // noms des propositions qu'elle cache (filles, petites-filles…, dans l'ordre de la liste), que « Créer une
  // collection » doit prendre avec elle. L'ancienne option `followed` (parentes suivies) est ignorée. options.stats (facultatif) reçoit {covered, grouped} : propositions couvertes, et regroupées sous une autre.
  function prune(list, options) {
    const op = options || {};
    const covered = typeof op.covered === 'function' ? op.covered : () => false;
    const stats = op.stats && typeof op.stats === 'object' ? op.stats : {};
    stats.covered = 0;
    stats.grouped = 0;
    const parentsOf = (p) => (Array.isArray(p.parents) ? p.parents.map(displayName).filter((n) => n && n !== p.name) : []);
    const kept = [];
    for (const p of Array.isArray(list) ? list : []) {
      if (!p) continue;
      if (covered(p)) stats.covered++; else kept.push(p);
    }
    const byName = new Map(kept.map((p) => [p.name, p]));
    const up = new Map(kept.map((p) => [p.name, parentsOf(p).filter((n) => byName.has(n))]));
    // Parentes proposées de chaque proposition, directes ou non (les listes font quelques centaines au plus).
    const anc = new Map();
    for (const p of kept) {
      const seen = new Set();
      const todo = up.get(p.name).slice();
      while (todo.length) {
        const n = todo.pop();
        if (seen.has(n)) continue;
        seen.add(n);
        todo.push(...up.get(n));
      }
      anc.set(p.name, seen);
    }
    const bigger = (a, b) => a.size > b.size || (a.size === b.size && a.name.localeCompare(b.name, 'fr') < 0);
    // Cachée : une parente proposée au-dessus d'elle (qui ne remonte pas jusqu'à elle), ou, dans un cycle, une plus grande.
    const hidden = (p) => [...anc.get(p.name)].some((n) => n !== p.name && (!anc.get(n).has(p.name) || bigger(byName.get(n), p)));
    const shown = new Set(kept.filter((p) => !hidden(p)).map((p) => p.name));
    const subs = new Map();
    for (const p of kept) {
      if (shown.has(p.name)) continue;
      stats.grouped++;
      for (const n of anc.get(p.name)) if (shown.has(n)) { if (!subs.has(n)) subs.set(n, []); subs.get(n).push(p.name); }
    }
    return kept.filter((p) => shown.has(p.name)).map((p) => (subs.has(p.name) ? Object.assign({}, p, { subs: subs.get(p.name) }) : p));
  }

  const exported = { createProposer, prune, displayName, keyOf, categoryTitle, isNoise, noiseReason };
  if (typeof window !== 'undefined') window.ClasseurPropose = exported;
})();
