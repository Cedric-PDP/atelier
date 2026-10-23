/* Kokoro Farmer : la page cachée du classeur, ouverte par le code Konami (↑ ↑ ↓ ↓ ← → ← → B A, guetté par app.js).
   Un faux booster de 8 cartes, seulement des UR et des L, tirées des cartes que le classeur connaît (les tiennes, puis les
   éléments de tes collections). Pour rire : rien n'est enregistré, rien ne va dans une collection, rien ne part au serveur.
   Il définit `window.KokoroFarmer = {open(pool)}`, pool = [{title, image, rarity, category, atk, def}].
   CSP du site : aucun style en ligne écrit dans le HTML, seulement des classes et des variables posées par le CSSOM. */
(function () {
  'use strict';

  const N = 8;
  const RNAME = { UR: 'Ultra rare', L: 'Légendaire' };
  const SVGNS = 'http://www.w3.org/2000/svg';
  const HEART = 'M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.9 4.5 6.6 4.5c2.2 0 3.6 1.2 5.4 3.2 1.8-2 3.2-3.2 5.4-3.2 3.7 0 5.7 3.9 4.2 7.3C19.5 16.4 12 21 12 21z';
  // Sans aucune carte connue (classeur vide) : un booster quand même.
  const FALLBACK = ['Kokoro', 'Tamagotchi', 'Mont Fuji', 'Licorne', 'Arc-en-ciel', 'Aurore polaire', 'Sakura', 'Dragon',
    'Nébuleuse du Crabe', 'Origami', 'Phénix', 'Supernova', 'Kitsune', 'Cerisier du Japon'];
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

  // ---------------------------------------------------------------- tirage
  function draw(pool) {
    const seen = new Set();
    const list = [];
    for (const c of pool || []) {
      const title = String((c && c.title) || '').trim();
      if (!title || seen.has(title)) continue;
      seen.add(title);
      list.push({ title, image: c.image || null, rarity: c.rarity, category: c.category || '', atk: c.atk, def: c.def });
    }
    for (const t of FALLBACK) if (list.length < N * 2 && !seen.has(t)) list.push({ title: t, image: null, rarity: null, category: 'Kokoro Farmer' });
    // Tirage pondéré sans remise : les vraies UR et L d'abord, et les cartes illustrées.
    const weight = (c) => (c.rarity === 'L' ? 7 : c.rarity === 'UR' ? 5 : 1) * (c.image ? 3 : 1);
    const bag = list.slice();
    const out = [];
    while (out.length < N && bag.length) {
      let total = 0;
      for (const c of bag) total += weight(c);
      let x = Math.random() * total;
      let i = 0;
      while (i < bag.length - 1 && (x -= weight(bag[i])) > 0) i++;
      out.push(bag.splice(i, 1)[0]);
    }
    const cards = out.map((c, i) => {
      const r = c.rarity === 'L' || (c.rarity === 'UR' ? Math.random() < 0.15 : Math.random() < 0.22) ? 'L' : 'UR';
      const h = hash(c.title);
      const base = r === 'L' ? 3200 : 1600;
      return {
        ...c, r, no: i + 1,
        atk: Number.isFinite(c.atk) && c.atk > 0 ? c.atk : base + (h % 1800),
        def: Number.isFinite(c.def) && c.def > 0 ? c.def : base - 400 + ((h >>> 11) % 1600),
        hue: r === 'L' ? 15 + (h % 45) : h % 360, // L : tons dorés pour l'illustration de secours
      };
    });
    if (!cards.some((c) => c.r === 'L')) { const c = pick(cards); c.r = 'L'; c.hue = 15 + (hash(c.title) % 45); } // toujours au moins une Légendaire
    for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
    cards.forEach((c, i) => { c.no = i + 1; });
    return cards;
  }

  // ---------------------------------------------------------------- particules (canvas)
  function makeSky(canvas) {
    const ctx = canvas.getContext('2d');
    const parts = [];
    let w = 0, hgt = 0, dpr = 1, raf = 0, on = true;
    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; hgt = canvas.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size();
    const ambient = reduced() ? 18 : 70;
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
        el('p', 'kk-cat', c.category || (c.r === 'L' ? 'Légende du Kokoro' : 'Ultra rare du Kokoro')),
        el('div', 'kk-stats', [
          el('span', 'atk', [icon('swords'), ' ', fmt(c.atk)]),
          el('span', 'def', [icon('shield'), ' ', fmt(c.def)]),
          el('span', 'kk-no', `KF ${String(c.no).padStart(3, '0')}/${String(total).padStart(3, '0')}`),
        ]),
      ]),
    );
    const back = el('div', 'kk-face kk-back', [heart(), el('b', null, 'Kokoro')]);
    const card = el('div', 'kk-card', [back, front]);
    return card;
  }

  // ---------------------------------------------------------------- la page
  let current = null;

  function open(pool) {
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
      nowMeta.replaceChildren(el('b', 'r' + c.r, RNAME[c.r]), ` · ${f + 1} / ${N}`);
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
      for (let k = 0; k < 6; k++) later(() => sky.converge(cx, cy, 26), k * 110);
      await wait(800);
      if (!alive) return;
      pack.classList.remove('is-charge');
      pack.classList.add('is-torn');
      sky.burst(cx, cy - pack.offsetHeight * 0.42, PALETTE, 60, 0.8);
      await wait(650);
      if (!alive) return;
      flash.classList.remove('is-on'); void flash.offsetWidth; flash.classList.add('is-on');
      wave(false);
      quake();
      sky.burst(cx, cy, PALETTE, 180, 1.4);
      packWrap.classList.add('is-gone');
      buildRing();
      await wait(1900);
      if (!alive) return;
      await reveal();
    }

    function buildRing() {
      cards = draw(pool);
      boosters++;
      ring.replaceChildren();
      dots.replaceChildren();
      slots = cards.map((c, i) => {
        const lift = el('div', 'kk-lift', [cardEl(c, N)]);
        const slot = el('div', 'kk-slot is-arrive', [lift]);
        slot.style.setProperty('--i', String(i));
        slot.style.setProperty('--d', (0.15 + i * 0.07).toFixed(2) + 's');
        lift.addEventListener('click', () => {
          if (swiped || stage === 'reveal') return;
          if (stage !== 'ready') return;
          if (i === front()) { zoom = !zoom; resetTilt(); paint(); } else goTo(i);
        });
        lift.addEventListener('pointermove', (e) => { if (stage === 'ready' && i === front() && e.pointerType !== 'touch') tilt(e, lift); });
        lift.addEventListener('pointerleave', () => { if (i === front()) resetTilt(); });
        ring.append(slot);
        const d = el('i', 'r' + c.r);
        dots.append(d);
        return slot;
      });
      pos = 0;
      zoom = false;
      // La roue arrive en tournant (un tour et demi), puis se pose sur la première carte.
      ring.classList.remove('is-intro');
      ring.style.setProperty('--kk-spin', '540deg');
      void ring.offsetWidth;
      root.classList.add('is-ring');
      ring.classList.add('is-intro');
      paint();
      later(() => { ring.classList.remove('is-intro'); slots.forEach((s) => s.classList.remove('is-arrive')); }, 2700);
    }

    async function flip(i) {
      const s = slots[i];
      const c = cards[i];
      const card = s.querySelector('.kk-card');
      card.classList.add('is-up', 'is-pop');
      later(() => card.classList.remove('is-pop'), 1000);
      if (c.r === 'L') legends++;
      if (skip) return;
      const [x, y] = center(s.querySelector('.kk-lift'));
      if (c.r === 'L') {
        wave(true);
        quake();
        sky.burst(x, y, GOLD, 160, 1.3);
        later(() => sky.burst(x, y, GOLD, 80, 0.8), 260);
      } else {
        sky.burst(x, y, CYAN, 60, 0.9);
      }
    }

    async function reveal() {
      stage = 'reveal';
      live.textContent = 'Les cartes se révèlent. Appuie sur une touche pour tout montrer.';
      ring.classList.remove('is-intro');
      for (let i = 0; i < N && alive; i++) {
        if (!skip) { pos = i; paint(); await wait(i === 0 ? 150 : 520); }
        if (!alive) return;
        await flip(i);
        if (!skip) await wait(cards[i].r === 'L' ? 950 : 420);
      }
      if (!alive) return;
      if (!skip) await wait(300);
      pos = N; // un tour complet : retour sur la première carte
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
      if (stage === 'reveal') { skip = true; e.preventDefault(); return; }
      if (stage === 'pack' && (k === 'Enter' || k === ' ') && document.activeElement !== closeBtn) { e.preventDefault(); openPack(); return; }
      if (stage !== 'ready') return;
      if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); go(1); }
      else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); go(-1); }
      else if ((k === 'Enter' || k === ' ') && !(document.activeElement && document.activeElement.tagName === 'BUTTON')) { e.preventDefault(); zoom = !zoom; paint(); }
    }
    let acc = 0, lastWheel = 0;
    root.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (stage === 'reveal') { skip = true; return; }
      if (stage !== 'ready') return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      acc += e.deltaMode === 1 ? d * 30 : d;
      const now = performance.now();
      if (Math.abs(acc) > 50 && now - lastWheel > 170) { go(acc > 0 ? 1 : -1); acc = 0; lastWheel = now; }
    }, { passive: false });
    let sx = null, sy = 0, swiped = false;
    root.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; swiped = false; if (stage === 'reveal') skip = true; });
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
