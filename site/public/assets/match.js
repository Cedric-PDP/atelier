/* Le classeur : rapprochement des cartes possédées et des éléments d'une collection à compléter.
 *
 * Une carte compte pour un élément si leurs titres normalisés sont égaux, sinon s'ils désignent le même élément
 * Wikidata (Q…) : article renommé depuis la création de la carte, redirection, parenthèse d'homonymie… Les qids des
 * titres viennent de Wikipédia (pageprops, redirections suivies) et sont gardés 30 jours dans localStorage
 * (« classeur-qid »). Script classique (ni module, ni eval) : il définit window.ClasseurMatch.
 *
 * Intégration (interface) :
 * - index.html : <script defer src="/assets/match.js"></script> juste avant celui d'app.js (les scripts defer
 *   s'exécutent dans l'ordre) ; la CSP n'a pas à changer (même origine ; fr.wikipedia.org est dans connect-src).
 * - app.js : un seul resolver = ClasseurMatch.createResolver() pour la page ; index = createIndex(cartes, resolver),
 *   recalculé avec les cartes et un compteur réactif bumpé par onProgress ; index.findCard(item) remplace
 *   byTitle.get(normTitle(item.title)) (progression, album, fiche : comparer findCard(item) à la carte).
 * - À l'ouverture d'une collection (ses items) et après le chargement des cartes (items de toutes les collections) :
 *   resolver.resolve(index.missingQidTitles(items), {signal, onProgress}), puis recalculer ; abandonner la résolution
 *   précédente (AbortController). La première fois, tous les titres des cartes sont résolus (50 par requête, une à la
 *   fois), ensuite le cache suffit. Les qids déjà connus (suggestions : champ q) : resolver.remember([[titre, qid]]).
 * - Envoyer qid dans les items enregistrés (POST /api/targets/save ; à la vérification, ppprop=disambiguation|wikibase_item).
 *   Les items du catalogue ont déjà leur qid.
 */
(function (root) {
  'use strict';

  const API = 'https://fr.wikipedia.org/w/api.php';
  const STORAGE_KEY = 'classeur-qid';
  const TTL = 30 * 24 * 3600 * 1000;
  const MAX_ENTRIES = 30000; // ~20 000 cartes au plus par compte, plus les éléments des collections
  const BATCH = 50; // titres par requête (limite de l'API sans compte)
  const URL_BUDGET = 6000; // longueur encodée des titres d'une requête (URL de ~8 Ko au plus)
  const MAX_TRIES = 8;

  const QID = /^Q[1-9]\d*$/;
  const isQid = (q) => typeof q === 'string' && QID.test(q);
  const SPACES = /[\s_]+/g; // \s couvre les espaces insécables (U+00A0, U+202F…)
  const INVISIBLE = /[\u00ad\u200b\u200e\u200f\u202a-\u202e\u2060\ufeff]/g; // trait d'union conditionnel, espaces sans chasse, marques de direction, BOM
  const FOLD_TEST = /[\u2018\u2019\u201b\u02bc\u2032\u201c-\u201f\u2033\u00ab\u00bb\u2010\u2011]/; // un de ceux ci-dessous
  const APOS = /[\u2018\u2019\u201b\u02bc\u2032]/g; // ‘ ’ ‛ ʼ ′
  const QUOTES = /[\u201c-\u201f\u2033]|\u00ab\s*|\s*\u00bb/g; // “ ” „ ‟ ″ « »
  const HYPHENS = /[\u2010\u2011]/g; // traits d'union typographiques
  const URL_RE = /^(?:https?:)?(?:\/\/)?((?:[a-z0-9-]+\.)*wikipedia\.org)(\/[^#]*)?(?:#.*)?$/i;
  const FR_HOST = /^fr(?:\.m)?\.wikipedia\.org$/i;
  const INVALID = /[#<>[\]{}|\u0000-\u001f\u007f]/; // refusés dans un titre ; « | » casserait la liste

  // ------------------------------------------------------------------ titres

  // Adresse d'article fr.wikipedia.org (/wiki/Titre ou index.php?title=Titre) -> titre ; le reste tel quel.
  function fromUrl(s) {
    const m = URL_RE.exec(s);
    if (!m || !FR_HOST.test(m[1])) return s;
    const path = m[2] || '';
    let raw = null;
    let w = /^\/wiki\/([^?]+)/.exec(path);
    if (w) raw = w[1];
    else if ((w = /[?&]title=([^&]+)/.exec(path))) raw = w[1].replace(/\+/g, ' ');
    if (raw === null) return s;
    try { return decodeURIComponent(raw); } catch (e) { return raw; }
  }

  // Première lettre en majuscule, comme Wikipédia (sauf si la majuscule fait plusieurs lettres : ß, ﬁ…).
  function ucfirst(s) {
    if (!s) return s;
    const c = s.charCodeAt(0);
    if (c < 0x61 || (c > 0x7a && c < 0xb5)) return s;
    const first = String.fromCodePoint(s.codePointAt(0));
    const up = first.toUpperCase();
    if (up === first || String.fromCodePoint(up.codePointAt(0)) !== up) return s;
    return up + s.slice(first.length);
  }

  // Titre tel que Wikipédia l'écrirait (envoyé à l'API) : adresse décodée, NFC, espaces, première lettre.
  function cleanTitle(t) {
    if (t == null) return '';
    let s = String(t).trim();
    if (s.indexOf('wikipedia.org') !== -1) s = fromUrl(s);
    s = s.normalize('NFC').replace(INVISIBLE, '').replace(SPACES, ' ').trim();
    return ucfirst(s);
  }

  // Clé de comparaison : cleanTitle + apostrophes, guillemets et traits d'union typographiques ramenés à l'ASCII.
  // Les accents et la casse (hors première lettre) sont gardés : « Été » ≠ « Ete », « FER » ≠ « Fer ».
  const memo = new Map();
  function normTitle(t) {
    const raw = typeof t === 'string' ? t : t == null ? '' : String(t);
    let s = memo.get(raw);
    if (s !== undefined) return s;
    s = cleanTitle(raw);
    if (FOLD_TEST.test(s)) s = s.replace(APOS, "'").replace(QUOTES, '"').replace(HYPHENS, '-');
    if (memo.size >= 60000) memo.clear();
    memo.set(raw, s);
    return s;
  }

  // ------------------------------------------------------------------ outils

  function abortError(signal) {
    if (signal && signal.reason !== undefined) return signal.reason;
    if (typeof DOMException === 'function') return new DOMException('Résolution abandonnée.', 'AbortError');
    const e = new Error('Résolution abandonnée.');
    e.name = 'AbortError';
    return e;
  }
  function throwIfAborted(signal) { if (signal && signal.aborted) throw abortError(signal); }

  function defaultSleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) { reject(abortError(signal)); return; }
      const onAbort = () => { clearTimeout(id); reject(abortError(signal)); };
      const id = setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  // Attend une promesse (qui ne rejette jamais) ou l'abandon.
  function waitFor(p, signal) {
    if (!signal) return p;
    if (signal.aborted) return Promise.reject(abortError(signal));
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(abortError(signal));
      signal.addEventListener('abort', onAbort, { once: true });
      p.then(() => { signal.removeEventListener('abort', onAbort); resolve(); });
    });
  }

  function retryAfterMs(h) {
    if (h == null || h === '') return NaN;
    const n = Number(h);
    if (Number.isFinite(n)) return Math.max(0, n * 1000);
    const d = Date.parse(h);
    return Number.isNaN(d) ? NaN : Math.max(0, d - Date.now());
  }

  function defaultStorage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }

  const query = (params) => Object.keys(params).map((k) => k + '=' + encodeURIComponent(params[k])).join('&');

  // ------------------------------------------------------------------ titres -> éléments Wikidata

  function createResolver(opts) {
    opts = opts || {};
    const fetchFn = opts.fetch || ((url, init) => root.fetch(url, init));
    const storage = opts.storage !== undefined ? opts.storage : defaultStorage();
    const now = opts.now || Date.now;
    const sleep = opts.sleep || defaultSleep;
    const gap = opts.gap != null ? opts.gap : 100; // ms entre deux requêtes
    const ttl = opts.ttl || TTL;
    const max = opts.max || MAX_ENTRIES;
    const key = opts.storageKey || STORAGE_KEY;

    let map = null; // titre normalisé -> [qid | null, horodatage en ms]
    let dirty = false;
    let version = 0;
    let lastAt = 0;
    let tail = Promise.resolve();

    function entries() {
      if (map) return map;
      map = new Map();
      let obj = null;
      try { obj = JSON.parse((storage && storage.getItem(key)) || 'null'); } catch (e) { obj = null; }
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const t = now();
        for (const k of Object.keys(obj)) {
          const v = obj[k];
          if (Array.isArray(v) && (v[0] === null || isQid(v[0])) && typeof v[1] === 'number' && t - v[1] < ttl) map.set(k, [v[0], v[1]]);
        }
      }
      return map;
    }

    // qid (Q…), null (pas d'élément : article absent, sans élément, redirection vers une section) ou undefined (inconnu).
    // t : instant de référence, pour lire beaucoup de clés sans relire l'horloge à chaque fois.
    function knownKey(k, t) {
      const e = entries().get(k);
      if (!e) return undefined;
      if ((t === undefined ? now() : t) - e[1] >= ttl) { map.delete(k); return undefined; }
      return e[0];
    }
    function put(k, q, t) { entries().set(k, [q, t]); dirty = true; }

    // Écrit le cache : les plus récentes d'abord ; plus de place -> on n'en garde que la moitié, puis le quart.
    function persist() {
      if (!dirty) return;
      dirty = false;
      if (!storage) return;
      const t = now();
      let list = Array.from(entries()).filter((e) => t - e[1][1] < ttl);
      const newestFirst = () => list.sort((a, b) => b[1][1] - a[1][1]);
      if (list.length > max) { newestFirst(); list.length = max; }
      for (let i = 0; i < 3 && list.length; i++) {
        try { storage.setItem(key, JSON.stringify(Object.fromEntries(list))); return; } catch (e) { /* quota */ }
        if (i === 0) newestFirst();
        list.length = Math.floor(list.length / 2);
      }
    }

    // Une requête à la fois pour tout le resolver : chaque lot attend la fin du précédent.
    function lock(signal) {
      let release;
      const mine = new Promise((r) => { release = r; });
      const prev = tail;
      tail = prev.then(() => mine);
      return waitFor(prev, signal).then(() => release, (e) => { release(); throw e; });
    }

    async function request(url, signal) {
      let delay = 1000;
      for (let attempt = 1; ; attempt++) {
        throwIfAborted(signal);
        let r = null;
        let j;
        try { r = await fetchFn(url, { signal: signal || undefined, credentials: 'omit', headers: { Accept: 'application/json' } }); } catch (e) {
          if (signal && signal.aborted) throw abortError(signal);
          r = null;
        }
        if (r && r.ok) {
          try { j = await r.json(); } catch (e) { throwIfAborted(signal); j = undefined; }
          if (j && !j.error) return j;
          if (j && j.error && !/^(ratelimited|maxlag|readonly|internal_api_error)/.test(String(j.error.code))) {
            throw new Error('Wikipédia a refusé la demande : ' + (j.error.info || j.error.code) + '.');
          }
        } else if (r && r.status !== 429 && r.status < 500) {
          throw new Error('Wikipédia a répondu ' + r.status + '.');
        }
        if (attempt >= MAX_TRIES) throw new Error("Wikipédia ne répond pas pour l'instant : réessaie dans quelques minutes.");
        const wait = r && r.headers && r.headers.get ? retryAfterMs(r.headers.get('retry-after')) : NaN;
        await sleep(Number.isNaN(wait) ? delay : Math.min(wait, 120000) + 250, signal);
        delay = Math.min(delay * 2, 30000);
      }
    }

    // Un lot : [[clé, titre envoyé]…] ; chaque titre reçoit un qid ou null.
    async function fetchBatch(list, signal) {
      const titles = list.map((e) => e[1]).join('|');
      const pages = new Map();
      const alias = new Map();
      const toSection = new Set();
      let cont = null;
      for (let guard = 0; guard < 10; guard++) {
        const params = { action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', redirects: '1', titles, format: 'json', formatversion: '2', origin: '*' };
        if (cont) Object.assign(params, cont);
        const j = await request(API + '?' + query(params), signal);
        const q = j.query || {};
        for (const n of q.normalized || []) alias.set(n.from, n.to);
        for (const n of q.converted || []) alias.set(n.from, n.to);
        for (const r of q.redirects || []) { alias.set(r.from, r.to); if (r.tofragment) toSection.add(r.from); }
        for (const p of q.pages || []) pages.set(p.title, Object.assign(pages.get(p.title) || {}, p));
        if (!j.continue) break;
        cont = j.continue;
      }
      throwIfAborted(signal);
      const t = now();
      for (const [k, sent] of list) {
        let cur = sent;
        let section = false;
        for (let i = 0; i < 10 && alias.has(cur); i++) {
          if (toSection.has(cur)) section = true;
          const next = alias.get(cur);
          if (next === cur) break;
          cur = next;
        }
        const p = pages.get(cur);
        const qid = p && !p.missing && !p.invalid && p.pageprops && isQid(p.pageprops.wikibase_item) ? p.pageprops.wikibase_item : null;
        // Une redirection vers une section (« Isotopes du fer » -> « Fer#Isotopes ») ne désigne pas l'article entier.
        put(k, section ? null : qid, t);
        if (qid && !section) { const pk = normTitle(p.title); if (pk !== k && knownKey(pk) === undefined) put(pk, qid, t); }
      }
      version++;
    }

    // Lots de 50 titres au plus, et d'une longueur d'adresse raisonnable.
    function batches(list) {
      const out = [];
      let cur = [];
      let len = 0;
      for (const e of list) {
        const l = encodeURIComponent(e[1]).length + 3;
        if (cur.length && (cur.length >= BATCH || len + l > URL_BUDGET)) { out.push(cur); cur = []; len = 0; }
        cur.push(e);
        len += l;
      }
      if (cur.length) out.push(cur);
      return out;
    }

    // titres -> Map(titre normalisé -> qid | null). onProgress(faits, total) après chaque lot.
    async function resolve(titles, o) {
      o = o || {};
      const signal = o.signal || null;
      throwIfAborted(signal);
      const want = new Map();
      for (const t of titles || []) {
        const k = normTitle(t);
        if (!want.has(k)) want.set(k, cleanTitle(t));
      }
      const out = new Map();
      const todo = [];
      const t0 = now();
      for (const [k, sent] of want) {
        const q = knownKey(k);
        if (q !== undefined) out.set(k, q);
        else if (!k) out.set(k, null);
        else if (INVALID.test(sent)) { put(k, null, t0); out.set(k, null); } // pas un titre : inutile de demander
        else todo.push([k, sent]);
      }
      const total = todo.length;
      let done = 0;
      let fetched = 0;
      try {
        for (const batch of batches(todo)) {
          const release = await lock(signal);
          try {
            // Une autre résolution a pu trouver ces titres pendant l'attente.
            const left = batch.filter((e) => knownKey(e[0]) === undefined);
            if (left.length) {
              const wait = lastAt + gap - now();
              if (gap > 0 && lastAt && wait > 0) await sleep(wait, signal);
              throwIfAborted(signal);
              try { await fetchBatch(left, signal); } finally { lastAt = now(); }
              if (++fetched % 20 === 0) persist(); // et à la fin
            }
          } finally { release(); }
          for (const [k] of batch) { const q = knownKey(k); out.set(k, q === undefined ? null : q); }
          done += batch.length;
          if (o.onProgress) o.onProgress(done, total);
        }
      } finally { persist(); }
      return out;
    }

    // Qids connus par ailleurs (suggestions, catalogue) : [[titre, qid | null, horodatage?]…].
    function remember(pairs) {
      const t = now();
      let n = 0;
      for (const p of pairs || []) {
        if (!p || (p[1] !== null && !isQid(p[1]))) continue;
        const k = normTitle(p[0]);
        if (!k) continue;
        put(k, p[1], typeof p[2] === 'number' && p[2] <= t ? p[2] : t);
        n++;
      }
      if (n) { version++; persist(); }
      return n;
    }

    function clear() {
      map = new Map();
      dirty = false;
      version++;
      try { if (storage) storage.removeItem(key); } catch (e) { /* rien à faire */ }
    }

    return {
      resolve,
      known: (title) => knownKey(normTitle(title)),
      knownKey, // même chose, pour une clé déjà normalisée (et un instant t facultatif)
      now: () => now(),
      remember,
      clear,
      persist,
      get version() { return version; }, // change à chaque qid appris : de quoi recalculer
      get size() { return entries().size; },
    };
  }

  // ------------------------------------------------------------------ index des cartes possédées

  // cards : [{title, qid?…}] ; resolver facultatif (sans lui, rapprochement par titre et par card.qid seulement).
  function createIndex(cards, resolver) {
    const list = Array.isArray(cards) ? cards : Array.from(cards || []);
    const n = list.length;
    const keys = new Array(n);
    const byTitle = new Map();
    // À rebours : pour un même titre (ou qid), la première carte de la liste l'emporte.
    for (let i = n - 1; i >= 0; i--) {
      const c = list[i];
      if (!c) continue;
      const k = normTitle(c.title);
      keys[i] = k;
      if (k) byTitle.set(k, c);
    }
    let byQid = null;
    let builtFor = -1;
    // Index par qid, refait quand le resolver a appris de nouveaux qids.
    function qidIndex() {
      const v = resolver ? resolver.version : 0;
      if (byQid && v === builtFor) return byQid;
      byQid = new Map();
      const t = resolver ? resolver.now() : 0;
      for (let i = n - 1; i >= 0; i--) {
        const c = list[i];
        if (!c || !keys[i]) continue;
        const q = isQid(c.qid) ? c.qid : resolver ? resolver.knownKey(keys[i], t) : null;
        if (q) byQid.set(q, c);
      }
      builtFor = v;
      return byQid;
    }
    qidIndex();

    // item : {title, qid?} ou un titre. D'abord le titre, puis le qid de l'item (ou, à défaut, celui de son titre).
    function findCard(item) {
      if (!item) return null;
      const title = typeof item === 'string' ? item : item.title;
      const k = normTitle(title);
      const c = byTitle.get(k);
      if (c) return c;
      let q = typeof item === 'object' && isQid(item.qid) ? item.qid : null;
      if (!q && resolver && k) q = resolver.knownKey(k) || null;
      return q ? qidIndex().get(q) || null : null;
    }

    // Titres à résoudre pour ces items : ceux des items introuvables (sans qid propre), puis ceux des cartes, s'il
    // reste au moins un item introuvable (opts.allCards : toutes les cartes de toute façon). Déjà connus : exclus.
    function missingQidTitles(items, opts) {
      if (!resolver) return [];
      const out = new Map();
      let need = !!(opts && opts.allCards);
      for (const it of items || []) {
        if (!it || findCard(it)) continue;
        need = true;
        if (typeof it === 'object' && isQid(it.qid)) continue;
        const title = typeof it === 'string' ? it : it.title;
        const k = normTitle(title);
        if (k && !out.has(k) && resolver.knownKey(k) === undefined) out.set(k, title);
      }
      if (need) {
        const t = resolver.now();
        for (let i = 0; i < n; i++) {
          const c = list[i];
          const k = keys[i];
          if (!c || !k || isQid(c.qid) || out.has(k)) continue;
          if (resolver.knownKey(k, t) === undefined) out.set(k, c.title);
        }
      }
      return Array.from(out.values());
    }

    return { findCard, missingQidTitles, get size() { return byTitle.size; } };
  }

  root.ClasseurMatch = Object.freeze({ normTitle, cleanTitle, createResolver, createIndex, STORAGE_KEY, TTL });
})(typeof window !== 'undefined' ? window : globalThis);
