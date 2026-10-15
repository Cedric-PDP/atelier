// Extrait les cartes d'une collection WikiMasters depuis un export HAR du navigateur
// (onglet Réseau des outils de développement) ou depuis des réponses JSON collées à la main.
// Ne garde que les cartes : ni en-têtes, ni cookies, ni identifiant de joueur.
// Fonctionne dans Node (require) et dans la page (window.WMExtract).
(function (root) {
  'use strict';

  function decodeBase64(text) {
    if (typeof Buffer !== 'undefined') return Buffer.from(text, 'base64').toString('utf8');
    const bin = atob(text);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  // Découpe un texte qui contient plusieurs objets JSON collés les uns après les autres.
  function splitJsonObjects(text) {
    const out = [];
    let depth = 0, start = -1, inStr = false, esc = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') { if (depth === 0) start = i; depth++; }
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0 && start >= 0) { out.push(text.slice(start, i + 1)); start = -1; }
      }
    }
    return out;
  }

  function day(iso) { return typeof iso === 'string' ? iso.slice(0, 16).replace('T', ' ') : null; }

  function tagNames(tags) {
    if (!Array.isArray(tags)) return [];
    return tags.map((t) => (t && typeof t === 'object' ? t.name || t.label || t.tag?.name || t.id : t)).filter(Boolean).map(String);
  }

  function extractCards(text) {
    const cards = new Map();
    const seen = new Set();
    let stats = null;
    let responses = 0;

    function add(entry) {
      const c = entry.card;
      // Une même réponse peut figurer deux fois (rechargement, réponse collée deux fois) : un exemplaire ne compte qu'une fois.
      const key = entry.id || `${c.id}|${entry.obtained_at}|${entry.is_shiny}`;
      if (seen.has(key)) return;
      seen.add(key);
      const id = c.id || entry.card_id || c.wikipedia_title;
      const count = Number(entry.count) || 1;
      const prev = cards.get(id);
      if (prev) {
        prev.n += count;
        prev.s = prev.s || !!entry.is_shiny;
        prev.f = prev.f || !!entry.starred;
        for (const t of tagNames(entry.tags)) if (!prev.tags.includes(t)) prev.tags.push(t);
        const at = day(entry.obtained_at);
        if (at && (!prev.at || at < prev.at)) prev.at = at;
        return;
      }
      cards.set(id, {
        id,
        t: c.wikipedia_title,
        r: c.rarity || null,
        pv: typeof c.pageviews === 'number' ? c.pageviews : null,
        c: c.category || null,
        atk: typeof c.atk === 'number' ? c.atk : null,
        def: typeof c.def === 'number' ? c.def : null,
        n: count,
        s: !!entry.is_shiny,
        f: !!entry.starred,
        at: day(entry.obtained_at),
        tags: tagNames(entry.tags),
      });
    }

    function visit(o) {
      if (Array.isArray(o)) { for (const v of o) visit(v); return; }
      if (!o || typeof o !== 'object') return;
      if (o.card && typeof o.card === 'object' && o.card.wikipedia_title) { add(o); return; }
      if (typeof o.totalUnique === 'number' && o.rarityCounts && !stats) stats = { total: o.total, unique: o.totalUnique, rarity: o.rarityCounts };
      for (const v of Object.values(o)) if (v && typeof v === 'object') visit(v);
    }

    function visitText(body) {
      if (!body || (body.indexOf('wikipedia_title') < 0 && body.indexOf('totalUnique') < 0)) return;
      let parsed = null;
      try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
      if (parsed !== null) { responses++; visit(parsed); return; }
      for (const part of splitJsonObjects(body)) {
        try { const p = JSON.parse(part); responses++; visit(p); } catch (e) { /* morceau illisible : ignoré */ }
      }
    }

    let json = null;
    try { json = JSON.parse(text); } catch (e) { json = null; }
    if (json && json.log && Array.isArray(json.log.entries)) {
      // Seules les réponses de la collection comptent ; si le site change d'adresse, on lit tout le journal.
      const url = (e) => String((e.request && e.request.url) || '');
      const mine = json.log.entries.filter((e) => url(e).indexOf('/api/my-collection') >= 0);
      for (const e of mine.length ? mine : json.log.entries) {
        const content = (e.response && e.response.content) || {};
        let body = content.text || '';
        if (body && content.encoding === 'base64') {
          try { body = decodeBase64(body); } catch (err) { body = ''; }
        }
        visitText(body);
      }
    } else if (json !== null) {
      responses++;
      visit(json);
    } else {
      visitText(text);
    }

    return { cards: [...cards.values()], stats, responses };
  }

  const api = { extractCards };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WMExtract = api;
})(typeof window !== 'undefined' ? window : globalThis);
