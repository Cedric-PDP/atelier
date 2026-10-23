/* Kokoro Farmer : la page cachée du classeur, ouverte par le code Konami (↑ ↑ ↓ ↓ ← → ← → B A)
   ou, sur téléphone, par SOS en morse tapé sur le titre de la barre du haut (guettés par app.js).
   Un faux booster de 8 cartes, seulement des UR et des L : de vrais articles de Wikipédia très lus, comme si on les
   tirait dans le jeu. Candidats : le top 1 000 mensuel des articles les plus vus de Wikipédia en français (API des vues de
   Wikimedia) de deux mois pris au hasard dans les deux ans et demi passés ; rareté estimée comme dans le classeur, d'après
   les vues des 30 derniers jours (5 000 et plus : UR, 20 000 et plus : L) ; les autres sont écartés. Candidats gardés trois
   jours dans ce navigateur. Pour rire : rien n'est enregistré dans le classeur, rien ne va dans une collection, rien ne
   part au serveur du classeur (seulement des lectures de Wikipédia et de Wikimedia).
   Il définit `window.KokoroFarmer = {open()}`.
   CSP du site : aucun style en ligne écrit dans le HTML, seulement des classes et des variables posées par le CSSOM. */
(function () {
  'use strict';

  const N = 8;
  const RNAME = { UR: 'Ultra rare', L: 'Légendaire' };
  const SVGNS = 'http://www.w3.org/2000/svg';
  const HEART = 'M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.9 4.5 6.6 4.5c2.2 0 3.6 1.2 5.4 3.2 1.8-2 3.2-3.2 5.4-3.2 3.7 0 5.7 3.9 4.2 7.3C19.5 16.4 12 21 12 21z';
  // Wikipédia injoignable : des articles parmi les plus lus de tous les temps, sans illustration ni vues.
  const OFFLINE = ['Paris', 'Napoléon Ier', 'Tour Eiffel', 'Victor Hugo', 'Albert Einstein', 'Léonard de Vinci', 'La Joconde',
    'Seconde Guerre mondiale', 'Lune', 'Soleil', 'Louis XIV', 'Charles de Gaulle', 'Jeanne d\'Arc', 'Molière', 'Mozart',
    'Pablo Picasso', 'Égypte antique', 'Révolution française', 'Michael Jackson', 'Système solaire'];
  const PALETTE = ['#ff3fa4', '#ffd84a', '#22e4ff', '#8b5cff', '#b6ff3b', '#ff7a3d', '#ffffff'];
  const GOLD = ['#ffe680', '#ffcf4a', '#ff9f1c', '#fff7d1', '#ffffff'];
  const CYAN = ['#22e4ff', '#c49bff', '#ffffff', '#7af0ff', '#ff7ac8'];

  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const wait = (ms) => new Promise((r) => setTimeout(r, reduced() ? Math.min(ms, 120) : ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const fmt = (n) => Number(n).toLocaleString('fr-FR');
  function hash(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }

  // ---------------------------------------------------------------- petits constructeurs DOM (sans innerHTML)
  function el(tag, cls, kids) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    for (const k of [].concat(kids || [])) if (k != null) n.append(k);
    return n;
  }
  function svg(cls, viewBox, kids) {
    const s = document.createElementNS(SVGNS, 'svg');
    if (cls) s.setAttribute('class', cls);
    s.setAttribute('viewBox', viewBox);
    s.setAttribute('aria-hidden', 'true');
    for (const k of kids) s.append(k);
    return s;
  }
  function node(tag, attrs) { const n = document.createElementNS(SVGNS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; }
  const icon = (id) => svg('kk-ic', '0 0 24 24', [node('use', { href: '#i-' + id })]);
  const heart = () => svg('kk-heart', '0 0 24 24', [node('path', { d: HEART, fill: 'url(#kk-hg)', stroke: '#fff', 'stroke-width': '1.2' })]);
  function heartDefs() {
    const g = node('linearGradient', { id: 'kk-hg', x1: '0', y1: '0', x2: '1', y2: '1' });
    g.append(node('stop', { offset: '0', 'stop-color': '#ffb3e1' }), node('stop', { offset: '.5', 'stop-color': '#ff3fa4' }), node('stop', { offset: '1', 'stop-color': '#a64dff' }));
    const s = svg('kk-sr', '0 0 1 1', [node('defs', {})]);
    s.firstChild.append(g);
    return s;
  }

  // ---------------------------------------------------------------- les candidats (Wikipédia)
  const API = 'https://fr.wikipedia.org/w/api.php?';
  const TOP = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/top/fr.wikipedia/all-access/';
  const NS = /^(spécial|special|wikipédia|fichier|catégorie|portail|modèle|aide|utilisateur|projet|média|discussion)[ _]?:/i;
  const CACHE = 'kokoro-farmer-v1';
  const CACHE_MS = 3 * 864e5;
  const UR_MIN = 5000, L_MIN = 20000; // PV_STEPS du classeur (app.js)
  const BLOCK = /porn|sexe|sexuel|x{3}|onlyfans|érotique|nudité/i;
  // Wikipédia limite les rafales (429) : peu de requêtes à la fois, et de nouvelles tentatives après une pause.
  async function getJson(url, retry = 2) {
    const r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (r.status === 429 && retry > 0) { await new Promise((ok) => setTimeout(ok, 1200 * (3 - retry))); return getJson(url, retry - 1); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  async function settleBy(n, items, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => { while (next < items.length) { const i = next++; try { out[i] = { status: 'fulfilled', value: await fn(items[i]) }; } catch (e) { out[i] = { status: 'rejected', reason: e }; } } };
    await Promise.all(Array.from({ length: n }, worker));
    return out;
  }
  let source = null; // promesse de {L:[…], UR:[…], offline}, gardée tant que la page du classeur reste ouverte
  const drawn = new Set(); // titres déjà tirés : pas deux fois la même carte avant d'avoir tout vu

  function cached() {
    try {
      const v = JSON.parse(localStorage.getItem(CACHE) || 'null');
      if (v && Date.now() - v.at < CACHE_MS && Array.isArray(v.L) && Array.isArray(v.UR) && v.L.length + v.UR.length >= N) return v;
    } catch (e) { /* stockage refusé : on relit Wikipédia */ }
    return null;
  }
  function loadSource() {
    if (source) return source;
    const hit = cached();
    if (hit) return (source = Promise.resolve(hit));
    source = (async () => {
      const now = new Date();
      const months = new Set();
      while (months.size < 2) months.add(2 + Math.floor(Math.random() * 28));
      const tops = await settleBy(2, [...months], (m) => {
        const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1));
        return getJson(TOP + t.getUTCFullYear() + '/' + String(t.getUTCMonth() + 1).padStart(2, '0') + '/all-days');
      });
      const titles = new Set();
      for (const f of tops) {
        if (f.status !== 'fulfilled') continue;
        for (const a of (f.value && f.value.items && f.value.items[0] && f.value.items[0].articles) || []) {
          const t = String(a.article || '').replace(/_/g, ' ').trim();
          if (t && !NS.test(t) && !BLOCK.test(t)) titles.add(t);
        }
      }
      // 150 au hasard parmi eux, dont on relit les vues actuelles (3 requêtes, l'une après l'autre).
      const list = [...titles];
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
      const chunks = [];
      for (let i = 0; i < Math.min(list.length, 150); i += 50) chunks.push(list.slice(i, Math.min(i + 50, 150)));
      const pages = await settleBy(1, chunks, (ch) => getJson(API + new URLSearchParams({
        action: 'query', format: 'json', formatversion: '2', origin: '*', redirects: '1', prop: 'pageviews|pageimages|description',
        pvipdays: '30', piprop: 'thumbnail', pithumbsize: '500', pilimit: '50', titles: ch.join('|'),
      })));
      const out = { L: [], UR: [], at: Date.now() };
      const seen = new Set();
      for (const r of pages) {
        if (r.status !== 'fulfilled') continue;
        for (const p of (r.value && r.value.query && r.value.query.pages) || []) {
          if (p.missing || p.ns !== 0 || seen.has(p.title) || BLOCK.test(p.title + ' ' + (p.description || ''))) continue;
          if (/homonymie/i.test(p.description || '')) continue;
          seen.add(p.title);
          const views = Object.values(p.pageviews || {}).reduce((a, v) => a + (v || 0), 0);
          const r2 = views >= L_MIN ? 'L' : views >= UR_MIN ? 'UR' : null;
          if (r2) out[r2].push({ title: p.title, image: (p.thumbnail && p.thumbnail.source) || null, category: p.description || '', views, r: r2 });
        }
      }
      if (out.L.length + out.UR.length < N) throw new Error('trop peu de candidats');
      try { localStorage.setItem(CACHE, JSON.stringify(out)); } catch (e) { /* pas de cache : on relira Wikipédia la prochaine fois */ }
      return out;
    })().catch(() => {
      source = null; // on réessaiera au prochain booster
      return { L: OFFLINE.map((title) => ({ title, image: null, category: 'Hors ligne : Wikipédia injoignable', views: null, r: 'L' })), UR: [] };
    });
    return source;
  }

  // ---------------------------------------------------------------- tirage
  function draw(src) {
    const take = (r) => {
      let bag = src[r].filter((c) => !drawn.has(c.title));
      if (!bag.length) { for (const c of src[r]) drawn.delete(c.title); bag = src[r].slice(); }
      // Les articles illustrés sortent plus souvent : ce sont des cartes pleine illustration.
      const weight = (c) => (c.image ? 4 : 1);
      let x = Math.random() * bag.reduce((a, c) => a + weight(c), 0);
      let i = 0;
      while (i < bag.length - 1 && (x -= weight(bag[i])) > 0) i++;
      drawn.add(bag[i].title);
      return bag[i];
    };
    const has = (r) => src[r].length > 0;
    let rs = Array.from({ length: N }, () => (Math.random() < 0.3 ? 'L' : 'UR'));
    if (!rs.includes('L')) rs[Math.floor(Math.random() * N)] = 'L'; // toujours au moins une Légendaire
    rs = rs.map((r) => (has(r) ? r : r === 'L' ? 'UR' : 'L'));
    const cards = [];
    for (const r of rs) {
      const c = take(r);
      if (cards.some((x) => x.title === c.title)) { const d = take(r); if (!cards.some((x) => x.title === d.title)) { cards.push(d); continue; } }
      cards.push(c);
    }
    return cards.map((c, i) => {
      const h = hash(c.title);
      const pow = c.views ? Math.log10(c.views) : 4.6;
      return {
        ...c, no: i + 1,
        atk: Math.round((pow * 900 + (h % 700)) / 10) * 10,
        def: Math.round((pow * 750 + ((h >>> 11) % 700)) / 10) * 10,
        hue: c.r === 'L' ? 15 + (h % 45) : h % 360, // L : tons dorés pour l'illustration de secours
      };
    });
  }

  // ---------------------------------------------------------------- particules (canvas)
  function makeSky(canvas) {
    const ctx = canvas.getContext('2d');
    const parts = [];
    let w = 0, hgt = 0, dpr = 1, raf = 0, on = true;
    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = canvas.clientWidth; hgt = canvas.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size();
    const ambient = reduced() ? 14 : 45;
    for (let i = 0; i < ambient; i++) parts.push(bokeh(true));
    function bokeh(anywhere) {
      return { k: 'b', x: rand(0, w), y: anywhere ? rand(0, hgt) : hgt + 20, vx: rand(-0.15, 0.15), vy: rand(-0.6, -0.15), s: rand(1, 4.5), c: pick(PALETTE), a: rand(0.25, 0.8), tw: rand(0, 6.28) };
    }
    function burst(x, y, colors, n, power) {
      const count = reduced() ? Math.round(n / 4) : n;
      for (let i = 0; i < count; i++) {
        const ang = rand(0, Math.PI * 2), sp = rand(2, 9) * (power || 1);
        const confetti = Math.random() < 0.45;
        parts.push({ k: confetti ? 'c' : 's', x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - (confetti ? 3 : 0), s: confetti ? rand(5, 11) : rand(1.5, 3.5),
          c: pick(colors), life: 0, max: rand(60, 130), rot: rand(0, 6.28), vr: rand(-0.3, 0.3) });
      }
    }
    function converge(x, y, n) {
      for (let i = 0; i < n; i++) {
        const ang = rand(0, Math.PI * 2), d = rand(180, 420);
        const px = x + Math.cos(ang) * d, py = y + Math.sin(ang) * d;
        parts.push({ k: 'i', x: px, y: py, tx: x, ty: y, s: rand(1.5, 3), c: pick(PALETTE), life: 0, max: rand(30, 55) });
      }
    }
    function frame() {
      if (!on) return;
      ctx.clearRect(0, 0, w, hgt);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p.k === 'b') {
          p.x += p.vx; p.y += p.vy; p.tw += 0.05;
          if (p.y < -20) Object.assign(p, bokeh(false));
          ctx.globalAlpha = p.a * (0.6 + 0.4 * Math.sin(p.tw));
          ctx.fillStyle = p.c;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.283); ctx.fill();
          continue;
        }
        p.life++;
        const t = p.life / p.max;
        if (t >= 1) { parts.splice(i, 1); continue; }
        if (p.k === 'i') {
          p.x += (p.tx - p.x) * 0.09; p.y += (p.ty - p.y) * 0.09;
          ctx.globalAlpha = Math.min(1, t * 3);
          ctx.fillStyle = p.c;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.283); ctx.fill();
          continue;
        }
        p.vx *= 0.97; p.vy = p.vy * 0.97 + (p.k === 'c' ? 0.16 : 0.08);
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.globalAlpha = 1 - t * t;
        ctx.fillStyle = p.c;
        if (p.k === 'c') {
          ctx.globalCompositeOperation = 'source-over';
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.life * 0.2));
          ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
          ctx.globalCompositeOperation = 'lighter';
        } else {
          ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1 - t * 0.5), 0, 6.283); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return { burst, converge, size, stop() { on = false; cancelAnimationFrame(raf); } };
  }

  // ---------------------------------------------------------------- une carte
  function cardEl(c, total) {
    const front = el('div', 'kk-face kk-front r' + c.r);
    const art = el('div', 'kk-art');
    art.style.setProperty('--kk-gen', `linear-gradient(135deg, hsl(${c.hue} 90% 58%), hsl(${(c.hue + 70) % 360} 85% 45%) 55%, hsl(${(c.hue + 160) % 360} 80% 28%))`);
    art.append(el('div', 'kk-gen', [el('span', null, c.title.charAt(0).toUpperCase())]));
    if (c.image) {
      const img = el('img');
      img.alt = '';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => img.remove());
      img.src = c.image;
      art.append(img);
    }
    const stars = el('div', 'kk-stars');
    if (c.r === 'L') {
      for (let i = 0; i < 7; i++) {
        const s = el('i');
        s.style.setProperty('left', rand(6, 86).toFixed(1) + '%');
        s.style.setProperty('top', rand(8, 78).toFixed(1) + '%');
        s.style.setProperty('animation-delay', rand(0, 2.4).toFixed(2) + 's');
        stars.append(s);
      }
    }
    front.append(
      art, el('div', 'kk-shade'), el('div', 'kk-holo'), el('div', 'kk-sheen'), el('div', 'kk-glare'), stars,
      el('div', 'kk-head', [el('p', 'kk-name', c.title), el('span', 'kk-gem', c.r)]),
      el('div', 'kk-foot', [
        el('p', 'kk-cat', c.category || 'Article de Wikipédia'),
        el('div', 'kk-stats', [
          el('span', 'atk', [icon('swords'), ' ', fmt(c.atk)]),
          el('span', 'def', [icon('shield'), ' ', fmt(c.def)]),
          el('span', 'kk-no', `KF ${String(c.no).padStart(3, '0')}/${String(total).padStart(3, '0')}`),
        ]),
      ]),
    );
    front.append(el('i', 'kk-dim'));
    const back = el('div', 'kk-face kk-back', [heart(), el('b', null, 'Kokoro'), el('i', 'kk-dim')]);
    const card = el('div', 'kk-card', [back, front]);
    return card;
  }

  // ---------------------------------------------------------------- la page
  let current = null;

  function open() {
    if (current) return;
    const prevFocus = document.activeElement;
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    let alive = true;
    let stage = 'pack'; // pack | opening | reveal | ready | closing
    let cards = [];
    let slots = [];
    let pos = 0;
    let zoom = false;
    let skip = false;
    let boosters = 0, legends = 0;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (alive) fn(); }, ms); timers.add(t); };

    // -- squelette
    const root = el('div', 'kk');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Kokoro Farmer');
    root.tabIndex = -1;
    const aurora = el('div', 'kk-aurora', [el('i'), el('i'), el('i'), el('i')]);
    const canvas = el('canvas', 'kk-sky');
    const closeBtn = el('button', 'kk-close', [icon('x')]);
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Quitter Kokoro Farmer');
    const top = el('header', 'kk-top', [
      el('div', 'kk-brand', [
        el('h1', 'kk-title', ['Kokoro Farmer', el('small', null, 'Booster secret')]),
        el('p', 'kk-sub', 'Que des UR et des L. Rien n’est gardé : c’est pour le plaisir.'),
      ]),
      closeBtn,
    ]);

    const pack = el('button', 'kk-pack');
    pack.type = 'button';
    pack.setAttribute('aria-label', 'Ouvrir le booster');
    const packBody = el('div', 'kk-pack__body', [
      el('div', 'kk-pack__name', [el('b', null, 'Kokoro'), el('span', null, 'Farmer')]),
      el('div', 'kk-pack__art', [heart()]),
      el('div', 'kk-pack__foot', [el('span', 'kk-ur', 'UR'), el('span', null, N + ' cartes'), el('span', 'kk-l', 'L')]),
    ]);
    pack.append(packBody, el('div', 'kk-pack__leak'), el('div', 'kk-pack__tear'));
    const cta = el('p', 'kk-cta', 'Clique pour ouvrir');
    const packWrap = el('div', 'kk-packwrap', [pack, cta]);

    const ring = el('div', 'kk-ring');
    const wheel = el('div', 'kk-wheel', [el('div', 'kk-tilt', [el('div', 'kk-floor'), ring])]);
    const flash = el('div', 'kk-flash');
    const stageEl = el('div', 'kk-stage', [wheel, packWrap]);

    const prev = el('button', 'kk-nav is-prev', [icon('chev')]);
    prev.type = 'button'; prev.setAttribute('aria-label', 'Carte précédente');
    const next = el('button', 'kk-nav', [icon('chev')]);
    next.type = 'button'; next.setAttribute('aria-label', 'Carte suivante');
    const nowTitle = el('p', 'kk-now__title');
    const nowMeta = el('p', 'kk-now__meta');
    const dots = el('div', 'kk-dots');
    const again = el('button', 'kk-btn', 'Nouveau booster');
    again.type = 'button';
    const tally = el('span', 'kk-tally');
    const hud = el('div', 'kk-hud', [
      el('div', 'kk-now', [prev, el('div', 'kk-now__txt', [nowTitle, nowMeta]), next]),
      dots,
      el('div', 'kk-row', [again, tally]),
      el('p', 'kk-hint', '← → ou la molette pour tourner la roue · clic sur la carte du milieu pour l’approcher · Échap pour quitter'),
    ]);
    const live = el('p', 'kk-sr');
    live.setAttribute('aria-live', 'polite');

    root.append(heartDefs(), aurora, el('div', 'kk-grid'), el('div', 'kk-rays'), canvas, stageEl, flash, top, hud, live);
    document.body.append(root);
    const sky = makeSky(canvas);
    requestAnimationFrame(() => root.classList.add('is-in'));
    loadSource(); // les articles arrivent pendant qu'on regarde le booster
    root.focus({ preventScroll: true });

    // -- géométrie de la roue
    function layout() {
      sky.size();
      const w = ring.getBoundingClientRect().width || 200;
      const r = (w / 2) / Math.tan(Math.PI / N) * 1.55 + 40;
      root.style.setProperty('--kk-r', r.toFixed(0) + 'px');
      root.style.setProperty('--kk-step', (360 / N) + 'deg');
    }
    layout();
    const front = () => ((pos % N) + N) % N;
    function paint() {
      ring.style.setProperty('--kk-spin', (-pos * 360 / N) + 'deg');
      const f = front();
      slots.forEach((s, i) => {
        const d = Math.min((i - f + N) % N, (f - i + N) % N);
        s.classList.toggle('is-front', d === 0);
        s.classList.toggle('is-near', d === 1);
        s.classList.toggle('is-zoom', d === 0 && zoom);
      });
      root.classList.toggle('is-zoomed', zoom);
      const c = cards[f];
      if (!c) return;
      nowTitle.textContent = c.title;
      nowMeta.replaceChildren(el('b', 'r' + c.r, RNAME[c.r]), c.views ? ` · ${fmt(c.views)} vues en 30 jours` : '', ` · ${f + 1} / ${N}`);
      [...dots.children].forEach((d, i) => d.classList.toggle('is-on', i === f));
      if (stage === 'ready') live.textContent = `${c.title}, ${RNAME[c.r]}, carte ${f + 1} sur ${N}`;
    }
    function go(d) {
      if (stage !== 'ready' || !d) return;
      zoom = false;
      resetTilt();
      pos += d;
      paint();
    }
    function goTo(i) { const f = front(); let d = (i - f + N) % N; if (d > N / 2) d -= N; go(d); }

    // -- inclinaison de la carte du milieu, au pointeur
    function resetTilt() {
      for (const s of slots) { const c = s.querySelector('.kk-card'); c.classList.remove('is-tracking'); for (const v of ['--rx', '--ry', '--mx', '--my']) c.style.removeProperty(v); }
    }
    function tilt(e, lift) {
      const c = lift.querySelector('.kk-card');
      const b = lift.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - b.left) / b.width));
      const y = Math.max(0, Math.min(1, (e.clientY - b.top) / b.height));
      c.classList.add('is-tracking');
      c.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
      c.style.setProperty('--my', (y * 100).toFixed(1) + '%');
      c.style.setProperty('--rx', ((0.5 - y) * 22).toFixed(1) + 'deg');
      c.style.setProperty('--ry', ((x - 0.5) * 26).toFixed(1) + 'deg');
    }
    let packTilt = null;
    function tiltPack(e) {
      const b = pack.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - b.left) / b.width));
      const y = Math.max(0, Math.min(1, (e.clientY - b.top) / b.height));
      cancelAnimationFrame(packTilt);
      packTilt = requestAnimationFrame(() => {
        pack.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
        pack.style.setProperty('--my', (y * 100).toFixed(1) + '%');
        pack.style.setProperty('--rx', ((0.5 - y) * 24).toFixed(1) + 'deg');
        pack.style.setProperty('--ry', ((x - 0.5) * 28).toFixed(1) + 'deg');
      });
    }
    pack.addEventListener('pointermove', tiltPack);
    pack.addEventListener('pointerleave', () => { for (const v of ['--rx', '--ry', '--mx', '--my']) pack.style.removeProperty(v); });

    // -- ouverture
    function center(elm) { const b = elm.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }
    function wave(gold) {
      const w = el('div', 'kk-wave' + (gold ? ' is-gold' : ''));
      root.append(w);
      later(() => w.remove(), 1200);
    }
    function quake() { root.classList.remove('is-quake'); void root.offsetWidth; root.classList.add('is-quake'); later(() => root.classList.remove('is-quake'), 600); }

    async function openPack() {
      if (stage !== 'pack') return;
      stage = 'opening';
      skip = false;
      pack.setAttribute('aria-disabled', 'true');
      live.textContent = 'Ouverture du booster…';
      const [cx, cy] = center(pack);
      pack.classList.add('is-charge');
      // Le booster tremble tant que les articles ne sont pas arrivés (ils se chargent dès l'ouverture de la page).
      const charge = setInterval(() => { if (alive) sky.converge(cx, cy, 22); }, 110);
      const [src] = await Promise.all([loadSource(), wait(800)]);
      clearInterval(charge);
      if (!alive) return;
      pack.classList.remove('is-charge');
      pack.classList.add('is-torn');
      sky.burst(cx, cy - pack.offsetHeight * 0.42, PALETTE, 50, 0.8);
      await wait(650);
      if (!alive) return;
      flash.classList.remove('is-on'); void flash.offsetWidth; flash.classList.add('is-on');
      wave(false);
      quake();
      sky.burst(cx, cy, PALETTE, 140, 1.4);
      packWrap.classList.add('is-gone');
      buildRing(src);
      await spin();
    }

    function buildRing(src) {
      cards = draw(src);
      boosters++;
      ring.replaceChildren();
      dots.replaceChildren();
      slots = cards.map((c, i) => {
        const lift = el('div', 'kk-lift', [cardEl(c, N)]);
        const slot = el('div', 'kk-slot is-arrive', [lift]);
        slot.style.setProperty('--i', String(i));
        slot.style.setProperty('--d', (i * 0.06).toFixed(2) + 's');
        lift.addEventListener('click', () => {
          if (swiped || stage !== 'ready') return;
          if (i === front()) { zoom = !zoom; resetTilt(); paint(); } else goTo(i);
        });
        lift.addEventListener('pointermove', (e) => { if (stage === 'ready' && i === front() && e.pointerType !== 'touch') tilt(e, lift); });
        lift.addEventListener('pointerleave', () => { if (i === front()) resetTilt(); });
        ring.append(slot);
        dots.append(el('i', 'r' + c.r));
        return slot;
      });
      pos = 0;
      zoom = false;
      snap(0);
      root.classList.add('is-ring');
      later(() => slots.forEach((s) => s.classList.remove('is-arrive')), 1700);
    }
    // Pose la roue sur un angle sans transition.
    function snap(p) {
      ring.classList.add('is-snap');
      ring.style.setProperty('--kk-spin', (-p * 360 / N) + 'deg');
      void ring.offsetWidth;
      ring.classList.remove('is-snap');
    }

    function flip(i) {
      const card = slots[i] && slots[i].querySelector('.kk-card');
      if (!card || card.classList.contains('is-up')) return;
      const c = cards[i];
      card.classList.add('is-up', 'is-pop');
      later(() => card.classList.remove('is-pop'), 1000);
      if (c.r === 'L') legends++;
      if (skip) return;
      const [x, y] = center(ring);
      if (c.r === 'L') {
        wave(true);
        sky.burst(x, y, GOLD, 110, 1.3);
      } else {
        sky.burst(x, y, CYAN, 35, 0.9);
      }
    }

    // La roue sort et tourne vite pendant deux tours en retournant les cartes, ralentit, puis se pose sur la première.
    const SPIN_MS = 4400;
    let endSpin = null;
    function skipReveal() { skip = true; if (endSpin) endSpin(); }
    async function spin() {
      stage = 'reveal';
      live.textContent = 'La roue tourne… Appuie sur une touche pour l’arrêter.';
      root.classList.add('is-spinning');
      void ring.offsetWidth;
      pos = 2 * N;
      ring.classList.add('is-spin');
      ring.style.setProperty('--kk-spin', (-pos * 360 / N) + 'deg');
      slots.forEach((s, i) => later(() => flip(i), 650 + i * 160));
      await new Promise((r) => { endSpin = r; later(r, reduced() ? 300 : SPIN_MS); });
      endSpin = null;
      if (!alive) return;
      if (skip) snap(pos);
      ring.classList.remove('is-spin');
      slots.forEach((s, i) => flip(i));
      root.classList.remove('is-spinning');
      stage = 'ready';
      paint();
      tally.replaceChildren(`Booster n° ${boosters} · `, el('b', null, `${legends} L`), ` en tout`);
      root.classList.add('is-ready');
      root.focus({ preventScroll: true });
      const l = cards.filter((c) => c.r === 'L').length;
      live.textContent = `${N} cartes : ${l} Légendaire${l > 1 ? 's' : ''}, ${N - l} Ultra rare${N - l > 1 ? 's' : ''}. ` + live.textContent;
    }

    async function another() {
      if (stage !== 'ready') return;
      stage = 'pack';
      root.classList.remove('is-ready');
      slots.forEach((s, i) => { s.style.setProperty('--d', (i * 0.04).toFixed(2) + 's'); });
      ring.classList.add('is-intro');
      ring.style.setProperty('--kk-spin', (-pos * 360 / N - 720) + 'deg');
      root.classList.remove('is-ring');
      for (const s of slots) s.querySelector('.kk-lift').classList.add('kk-gone');
      await wait(650);
      if (!alive) return;
      ring.replaceChildren();
      slots = [];
      cards = [];
      pack.classList.remove('is-torn', 'is-charge');
      pack.removeAttribute('aria-disabled');
      packWrap.classList.remove('is-gone');
      pack.focus({ preventScroll: true });
      live.textContent = 'Un nouveau booster t’attend.';
    }

    // -- fermeture
    function close() {
      if (!alive) return;
      stage = 'closing';
      root.classList.add('is-out');
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', layout);
      setTimeout(() => {
        alive = false;
        for (const t of timers) clearTimeout(t);
        sky.stop();
        root.remove();
        document.documentElement.style.overflow = prevOverflow;
        current = null;
        if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus({ preventScroll: true });
      }, 360);
    }

    // -- commandes : clavier, molette, glisser
    function onKey(e) {
      if (stage === 'closing') return;
      e.stopPropagation(); // le classeur, dessous, ne voit rien tant que la page est ouverte
      const k = e.key;
      if (k === 'Escape') {
        e.preventDefault();
        if (zoom) { zoom = false; paint(); } else close();
        return;
      }
      if (k === 'Tab') {
        const f = [...root.querySelectorAll('button')].filter((b) => b.offsetParent !== null && !b.closest('.kk-packwrap.is-gone') && !(b.closest('.kk-hud') && stage !== 'ready'));
        if (!f.length) { e.preventDefault(); return; }
        const i = f.indexOf(document.activeElement);
        const j = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === -1 || i === f.length - 1 ? 0 : i + 1);
        e.preventDefault();
        f[j].focus();
        return;
      }
      if (stage === 'reveal') { skipReveal(); e.preventDefault(); return; }
      if (stage === 'pack' && (k === 'Enter' || k === ' ') && document.activeElement !== closeBtn) { e.preventDefault(); openPack(); return; }
      if (stage !== 'ready') return;
      if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); go(1); }
      else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); go(-1); }
      else if ((k === 'Enter' || k === ' ') && !(document.activeElement && document.activeElement.tagName === 'BUTTON')) { e.preventDefault(); zoom = !zoom; paint(); }
    }
    let acc = 0, lastWheel = 0;
    root.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (stage === 'reveal') { skipReveal(); return; }
      if (stage !== 'ready') return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      acc += e.deltaMode === 1 ? d * 30 : d;
      const now = performance.now();
      if (Math.abs(acc) > 50 && now - lastWheel > 170) { go(acc > 0 ? 1 : -1); acc = 0; lastWheel = now; }
    }, { passive: false });
    let sx = null, sy = 0, swiped = false;
    root.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; swiped = false; if (stage === 'reveal') skipReveal(); });
    root.addEventListener('pointerup', (e) => {
      if (sx == null) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      sx = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { swiped = true; go(dx < 0 ? 1 : -1); setTimeout(() => { swiped = false; }, 0); }
    });

    pack.addEventListener('click', openPack);
    closeBtn.addEventListener('click', close);
    prev.addEventListener('click', () => go(-1));
    next.addEventListener('click', () => go(1));
    again.addEventListener('click', another);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', layout);
    current = { close };
  }

  window.KokoroFarmer = { open, close() { if (current) current.close(); } };
})();
