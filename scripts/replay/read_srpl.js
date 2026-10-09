#!/usr/bin/env node
/*
 * read_srpl.js : lecteur des replays de SPAM (fichiers match-<n>.srpl du dossier
 * %USERPROFILE%\AppData\LocalLow\Ticroco\Spam\replays\<serveur>\<compte>\).
 *
 *   node scripts/replay/read_srpl.js <match.srpl> [--index <index.json>] [--model <model.json>]
 *        [--tox <tox.json>] [--messages] [--cards] > out.json
 *
 * Sans dépendance (zlib de Node). Le fichier est une DONNÉE : rien de ce qu'il contient n'est exécuté.
 * Les « ticket » de partie (en-tête, index) sont masqués ; la sortie est vérifiée avant d'être écrite.
 * Format décodé, certitudes et limites : scripts/replay/README.md.
 *
 *   --index    index.json du même dossier : recoupe l'entrée de la partie (nombre de messages, tours).
 *   --model    model.json du wiki (cartes) ; défaut : spam/versions/<AppVersion>/js/model.json du dépôt.
 *   --tox      fiche des Tox (noms FR, rareté, prix) ; défaut : journal/ref/tox.json du dépôt.
 *   --messages ajoute la liste de tous les messages décodés (gros).
 *   --cards    ajoute l'état de chaque carte après chaque mise à jour (gros).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const READER_VERSION = '1.0';
const REPO = path.resolve(__dirname, '..', '..');

// ───────────────────────────── arguments ─────────────────────────────
function parseArgs(argv) {
  const o = { file: null, index: null, model: null, tox: null, messages: false, cards: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--index') o.index = argv[++i];
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--tox') o.tox = argv[++i];
    else if (a === '--messages') o.messages = true;
    else if (a === '--cards') o.cards = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (!o.file) o.file = a;
    else throw new Error('argument inattendu : ' + a);
  }
  return o;
}

// ───────────────────────────── lecteurs binaires ─────────────────────────────
// Style « NGO » (Unity Netcode FastBufferWriter) : int32 LE, float32 LE, chaîne = int32 longueur + UTF-16 LE.
class NgoReader {
  constructor(buf, p = 0) { this.b = buf; this.p = p; }
  need(n) { if (this.p + n > this.b.length) throw new Error('fin de message (NGO) à ' + this.p); }
  i32() { this.need(4); const v = this.b.readInt32LE(this.p); this.p += 4; return v; }
  f32() { this.need(4); const v = this.b.readFloatLE(this.p); this.p += 4; return round(v); }
  u8() { this.need(1); return this.b[this.p++]; }
  str() {
    const n = this.i32();
    if (n < 0 || n > 100000) throw new Error('longueur de chaîne NGO invalide ' + n + ' à ' + (this.p - 4));
    this.need(2 * n);
    const s = this.b.slice(this.p, this.p + 2 * n).toString('utf16le');
    this.p += 2 * n;
    return s;
  }
  bytes() { const n = this.i32(); const m = this.i32(); if (n !== m || n < 0) throw new Error('tableau NGO mal encadré'); this.need(n); const s = this.b.slice(this.p, this.p + n); this.p += n; return s; }
  left() { return this.b.length - this.p; }
}

// Style « compact » (blobs internes) : varint LEB128 ; entiers en zigzag ; chaîne et liste = zigzag(n + 1)
// (0 = null) puis n octets UTF-8 / n éléments ; float32 LE.
class CompactReader {
  constructor(buf, p = 0) { this.b = buf; this.p = p; }
  uv() {
    let v = 0, s = 0, x;
    do {
      if (this.p >= this.b.length) throw new Error('fin de blob (compact) à ' + this.p);
      x = this.b[this.p++]; v += (x & 0x7f) * Math.pow(2, s); s += 7;
      if (s > 63) throw new Error('varint trop long');
    } while (x & 0x80);
    return v;
  }
  v() { const u = this.uv(); return (u % 2 === 0) ? u / 2 : -(u + 1) / 2; }
  str() {
    const n = this.v(); if (n === 0) return null; const L = n - 1;
    if (L < 0 || this.p + L > this.b.length) throw new Error('chaîne compacte invalide (' + L + ') à ' + this.p);
    const s = this.b.slice(this.p, this.p + L).toString('utf8'); this.p += L; return s;
  }
  f32() { if (this.p + 4 > this.b.length) throw new Error('fin de blob (float)'); const f = this.b.readFloatLE(this.p); this.p += 4; return round(f); }
  list(fn) { const n = this.v(); if (n === 0) return null; const out = []; for (let k = 0; k < n - 1; k++) out.push(fn()); return out; }
  eof() { return this.p >= this.b.length; }
}

function round(f) { return Math.round(f * 1000) / 1000; }
const hex = (buf, max = 48) => buf.slice(0, max).toString('hex') + (buf.length > max ? '…' : '');

// ───────────────────────────── conteneur .srpl ─────────────────────────────
function readContainer(file) {
  let raw = fs.readFileSync(file);
  const gz = raw[0] === 0x1f && raw[1] === 0x8b;
  const b = gz ? zlib.gunzipSync(raw) : raw;
  if (b.slice(0, 4).toString('latin1') !== 'SRPL') throw new Error('pas un fichier SRPL');
  let p = 4;
  const formatVersion = b.readInt32LE(p); p += 4;
  let len = 0, shift = 0, x;                       // longueur 7 bits (BinaryWriter .NET)
  do { x = b[p++]; len += (x & 0x7f) * Math.pow(2, shift); shift += 7; } while (x & 0x80);
  const header = JSON.parse(b.slice(p, p + len).toString('utf8')); p += len;
  const count = b.readInt32LE(p); p += 4;
  const records = [];
  for (let i = 0; i < count; i++) {
    if (p + 8 > b.length) throw new Error('fichier tronqué au message ' + i);
    const t = b.readInt32LE(p), l = b.readInt32LE(p + 4);
    if (l < 2 || p + 8 + l > b.length) throw new Error('message ' + i + ' mal encadré');
    const buf = b.slice(p + 8, p + 8 + l);
    records.push({ i, t, type: buf.readUInt16LE(0), buf });
    p += 8 + l;
  }
  return { gz, compressedBytes: raw.length, bytes: b.length, formatVersion, header, count, records, trailing: b.length - p };
}

// ───────────────────────────── données de référence ─────────────────────────────
function loadJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

function loadModel(opt, appVersion) {
  const tried = [];
  const cand = [];
  if (opt) cand.push(opt);
  if (appVersion) cand.push(path.join(REPO, 'spam', 'versions', appVersion, 'js', 'model.json'));
  const vdir = path.join(REPO, 'spam', 'versions');
  try {
    const vs = fs.readdirSync(vdir).filter(v => /^\d+(\.\d+)*$/.test(v))
      .sort((a, b) => a.split('.').map(Number).reduce((r, x, k) => r || x - (b.split('.').map(Number)[k] || 0), 0)).reverse();
    for (const v of vs) cand.push(path.join(vdir, v, 'js', 'model.json'));
  } catch (e) { /* pas de dépôt */ }
  for (const c of cand) {
    tried.push(c);
    const m = loadJson(c);
    if (m && Array.isArray(m.cards)) return { path: c, model: m };
  }
  return { path: null, model: null, tried };
}

// ───────────────────────────── décodeurs de messages ─────────────────────────────
const TYPE_NAMES = {
  1033: 'aimCancel', 1041: 'aimPointer', 2000: 'gameState', 2001: 'gameResult', 2003: 'turnStart',
  2010: 'connected', 2015: 'gameStateInit', 2020: 'shopBuy', 2021: 'shopUpdate', 2100: 'aimStart',
  2101: 'aimEnd', 2111: 'cardDied', 2201: 'playerResources', 2204: 'gameStateStart', 2206: 'effects',
  2207: 'cardsUpdate', 2208: 'vfx', 2209: 'endGraphs', 2400: 'shopDrag',
};

const EFFECT_TYPES = {
  1: 'damage', 2: 'heal', 4: 'critChance', 5: 'critDamage', 6: 'cooldown', 7: 'element',
  8: 'money', 14: 'kill', 15: 'toxBought', 16: 'maxHp',
};

function readStatus(c) {
  return { type: c.v(), value: c.v(), duration: c.v(), x: c.v(), source: c.str(), name: c.str() };
}
function readAbilityState(c) {
  const a = { name: c.str(), x: c.v(), cd: c.v(), y: c.v(), precision: c.f32(), currentCd: c.v() };
  // déduit : bonus de valeur de base (Feu allié +3), bonus de critique en % (Embrasement +5), ?, bonus de dégâts critiques (Revitalisation +1)
  a.baseBonus = c.f32(); a.critBonus = c.f32(); a.f3 = c.f32(); a.critDmgBonus = c.f32();
  const u1 = c.v(); a.uses = c.v(); a.w = [u1, c.v(), c.v(), c.v(), c.v()];
  return a;
}
function readPassive(c) {
  const p = { uid: c.str(), id: c.str() };
  p.w = [c.v(), c.v(), c.v(), c.v()];
  p.innate = c.v() !== 0;
  return p;
}
const NONEMPTY = () => { throw new Error('liste inconnue non vide'); };

// Carte (blob compact). withHeader : les blobs de 2207 commencent par la marque 197.
function readCard(c, withHeader) {
  if (withHeader) { const h = c.uv(); if (h !== 197) throw new Error('marque de carte ' + h); }
  const card = { cardId: c.str(), uid: c.str(), player: c.v(), style: c.str(), variant: c.str() };
  const f = []; for (let k = 0; k < 23; k++) f.push(c.v());
  card.slot = f[0]; card.damage = f[4]; card.maxHp = f[5]; card.hp = f[5] - f[4]; card.turn = f[15];
  card.raw = f;
  card.partial = true;
  try {
    card.statuses = c.list(() => readStatus(c));
    card.statuses2 = c.list(() => readStatus(c));
    card.abilities = c.list(() => c.str());
    card.passiveUids = c.list(() => c.str());
    card.element = c.str();
    card.abilityState = c.list(() => readAbilityState(c));
    c.list(NONEMPTY);
    card.passives = c.list(() => readPassive(c));
    c.list(NONEMPTY);
    const n = c.v(); card.res = {};
    for (let k = 0; k < n - 1; k++) { const key = c.str(); card.res[key] = c.f32(); }
    card.partial = false;
  } catch (e) { card.error = e.message; }
  return card;
}

// Fin d'un message 2207 : pour chaque joueur (0 puis 1), un octet « présent » puis des blobs compacts :
// 204 = liste d'uid (le premier : l'ordre des cartes sur le plateau), 201 = bonus élémentaires (dict élément → float).
function readPlayersTail(r) {
  const players = [];
  for (let pl = 0; pl < 2 && r.left() > 0; pl++) {
    const present = r.u8();
    if (!present) { players.push(null); continue; }
    const blk = {};
    for (let guard = 0; guard < 24 && r.left() >= 4; guard++) {
      const a = r.b.readInt32LE(r.p);
      if (r.left() >= 8 && a > 0 && a === r.b.readInt32LE(r.p + 4) && r.left() >= 8 + a) {
        const blob = r.bytes(); const c = new CompactReader(blob); const h = c.uv();
        if (h === 201) { const n = c.v(); blk.elements = {}; for (let k = 0; k < n - 1; k++) { const key = c.str(); blk.elements[key] = c.f32(); } }
        else if (h === 204) { const l = c.list(() => c.str()); if (!blk.board) blk.board = l || []; else (blk.lists = blk.lists || []).push(l || []); }
        if (h === 202) break;
      } else r.i32();
    }
    players.push(blk);
  }
  return players;
}

function decodeMessage(rec) {
  const b = rec.buf, ty = rec.type;
  const r = new NgoReader(b, 2);
  const d = {};
  switch (ty) {
    case 1033: d.value = r.i32(); break;
    case 1041: d.player = r.i32(); d.pos = [r.f32(), r.f32(), r.f32()]; break;
    case 2400: d.kind = r.i32(); d.args = [r.i32(), r.i32(), r.i32(), r.i32()]; break;
    case 2201: d.player = r.i32(); d.luck = r.f32(); d.money = r.i32(); break;
    case 2100: d.card = r.str(); d.ability = r.str(); d.player = r.i32(); d.x = r.i32(); break;
    case 2101: d.card = r.str(); d.ability = r.str(); d.player = r.i32(); break;
    case 2111: d.card = r.str(); d.by = r.str(); d.owner = r.i32(); break;
    case 2020: d.player = r.i32(); d.card = r.str(); d.tox = r.str(); d.bought = r.str(); d.replaced = r.str(); break;
    case 2003: case 2021: {
      d.player = r.i32();
      if (ty === 2003) { d.timer = r.f32(); d.turn = r.i32(); d.luck = r.f32(); d.money = r.i32(); }
      d.rerollExtra = r.i32();
      const n = r.i32(); d.rerollBase = r.i32();
      d.offers = []; for (let k = 0; k < n; k++) d.offers.push({ uid: r.str(), id: r.str() });
      d.tail = []; while (r.left() >= 4) d.tail.push(r.i32());
      break;
    }
    case 2206: {
      const n = r.i32(); d.seqs = [];
      for (let s = 0; s < n; s++) {
        const q = { id: r.i32(), turn: r.i32(), caster: r.str(), source: r.str(), effects: [] };
        const ne = r.i32();
        for (let e = 0; e < ne; e++) {
          const ef = { type: r.i32(), tag: r.str(), value: r.i32(), targets: [] };
          const nt = r.i32();
          for (let t = 0; t < nt; t++) ef.targets.push({ target: r.str(), amount: r.i32(), before: r.i32(), after: r.i32(), max: r.i32() });
          q.effects.push(ef);
        }
        d.seqs.push(q);
      }
      break;
    }
    case 2208: {
      const blob = r.bytes(); const c = new CompactReader(blob);
      d.mark = c.uv(); const n = c.v(); d.entries = [];
      for (let k = 0; k < n; k++) {
        const len = c.v(); const e = blob.slice(c.p, c.p + len); c.p += len;
        const ec = new CompactReader(e); const ent = { type: ec.v(), sub: ec.v() };
        try {
          if (ent.type === 1) { ent.src = ec.str(); ent.dst = ec.str(); ent.amount = ec.v(); ent.crit = ec.v() !== 0; ent.element = ec.str(); ent.x = ec.v(); }
          else if (ent.type === -2) { ent.src = ec.str(); ent.dst = ec.str(); ent.amount = ec.v(); ent.x = [ec.v(), ec.v(), ec.v()]; }
          else if (ent.type === -4) { ent.src = ec.str(); ent.dst = ec.str(); ent.amount = ec.v(); ent.kind = ec.v(); if (ent.kind === 4) ent.element = ec.str(); else ent.x = ec.v(); }
          else if (ent.type === -3) { ent.card = ec.str(); ent.playerStr = ec.str(); ent.amount = ec.v(); ent.element = ec.str(); }
          else if (ent.type === 2 || ent.type === 3) { ent.src = ec.str(); ent.dst = ec.str(); }
          if (!ec.eof()) ent.rest = hex(e.slice(ec.p));
        } catch (err) { ent.raw = hex(e, 80); }
        d.entries.push(ent);
      }
      break;
    }
    case 2207: {
      d.seq = r.i32(); const n = r.i32(); d.cards = [];
      for (let k = 0; k < n; k++) { const blob = r.bytes(); d.cards.push(readCard(new CompactReader(blob), true)); }
      d.tailBytes = r.left();
      try { d.players = readPlayersTail(r); } catch (e) { d.playersError = e.message; }
      r.p = b.length;
      break;
    }
    case 2010: case 2000: case 2015: case 2204: {
      if (ty === 2010) d.flag = r.u8();
      d.a = r.i32(); const blob = r.bytes(); d.blobBytes = blob.length;
      d.cards = scanCards(blob);
      if (r.left() === 4) r.i32();
      break;
    }
    case 2209: { const blob = r.bytes(); d.blobBytes = blob.length; break; }
    case 2001: {
      // le JSON de fin de partie est une chaîne UTF-16 : on la cherche aux deux parités d'octet
      let base = 2, s = b.toString('utf16le', 2), k = s.indexOf('{"tid"');
      if (k < 0) { base = 3; s = b.toString('utf16le', 3); k = s.indexOf('{"tid"'); }
      if (k >= 0) {
        let depth = 0, end = -1;
        for (let i = k; i < s.length; i++) { const ch = s[i]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } } }
        try { d.stats = JSON.parse(s.slice(k, end)); } catch (e) { d.statsError = e.message; }
      }
      d.strings = utf16Strings(b.slice(2, k >= 0 ? base + 2 * k : b.length));
      r.p = b.length;
      break;
    }
    default:
      d.raw = hex(b.slice(2), 64); r.p = b.length;
  }
  if (r.left() > 0 && !('raw' in d)) d.unparsedBytes = r.left();
  return d;
}

// chaînes UTF-16 précédées de leur longueur (int32) à n'importe quel décalage
function utf16Strings(buf) {
  const out = [];
  for (let p = 0; p + 4 <= buf.length; p++) {
    const n = buf.readInt32LE(p);
    if (n < 2 || n > 80 || p + 4 + 2 * n > buf.length) continue;
    const s = buf.slice(p + 4, p + 4 + 2 * n).toString('utf16le');
    if (/^[\x20-\x7e]+$/.test(s)) { out.push(s); p += 3 + 2 * n; }
  }
  return out;
}

// Les cartes d'un état de partie (blob compact) : on cherche « id de carte (uuid) + uid » et on relit la carte.
function scanCards(blob) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i + 40 < blob.length; i++) {
    if (blob[i] !== 0x4a) continue;                         // chaîne de 36 caractères
    const s = blob.slice(i + 1, i + 37).toString('latin1');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)) continue;
    try {
      const c = new CompactReader(blob, i);
      const card = readCard(c, false);
      if (!card.uid || !/^[A-Za-z0-9]{8,20}$/.test(card.uid) || (card.player !== 0 && card.player !== 1) || card.partial) continue;
      if (!seen.has(card.uid)) { seen.add(card.uid); out.push(card); }
      i = c.p - 1;
    } catch (e) { /* pas une carte */ }
  }
  return out;
}

const relRepo = p => (p && path.resolve(p).startsWith(REPO + path.sep) ? path.relative(REPO, path.resolve(p)).split(path.sep).join('/') : p);

// ───────────────────────────── masquage ─────────────────────────────
function mask(o) {
  return JSON.parse(JSON.stringify(o, (k, v) => (/ticket/i.test(k) ? (v == null ? v : '<masqué>') : v)));
}
function collectTickets(o, acc = []) {
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) {
    if (/ticket/i.test(k) && typeof v === 'string' && v.length >= 8) acc.push(v);
    else collectTickets(v, acc);
  }
  return acc;
}

// ───────────────────────────── analyse ─────────────────────────────
const STATUS_NAMES = { 200: 'Provocation', 210: 'protégée par une Provocation (hypothèse)' };
const BUFF_KINDS = { 0: 'critique', 1: 'dégâts critiques', 3: 'valeurs de base', 4: 'résistance' };
const NOISE = new Set([1041, 2400]);

function analyse(cont, ref, opts) {
  const H = cont.header;
  const mySeat = typeof H.Seat === 'number' ? H.Seat : null;
  const sideOf = p => (mySeat == null || p == null ? null : (p === mySeat ? 'me' : 'opp'));
  const model = ref.model;
  const cardById = new Map((model ? model.cards : []).map(c => [c.id, c]));
  const toxRef = ref.tox || {};

  // 1. décodage de tous les messages
  const msgs = [];
  const errors = [];
  const typeCount = {};
  for (const rec of cont.records) {
    let d;
    try { d = decodeMessage(rec); } catch (e) { d = { error: e.message, raw: hex(rec.buf.slice(2), 64) }; errors.push({ i: rec.i, type: rec.type, error: e.message }); }
    if (d.unparsedBytes) errors.push({ i: rec.i, type: rec.type, error: d.unparsedBytes + ' octets non lus' });
    for (const c of d.cards || []) if (c.partial) errors.push({ i: rec.i, type: rec.type, error: 'carte ' + c.uid + ' lue en partie : ' + c.error });
    msgs.push({ i: rec.i, t: rec.t, sec: Math.round(rec.t / 100) / 10, type: rec.type, name: TYPE_NAMES[rec.type] || 'inconnu', ...d });
    typeCount[rec.type] = (typeCount[rec.type] || 0) + 1;
  }

  // 2. registres : cartes (uid de partie → carte du modèle) et Tox (uid → id)
  const cards = {};
  const toxUid = {};
  const snap = c => ({
    hp: c.hp, maxHp: c.maxHp, slot: c.slot, element: c.element,
    abilities: (c.abilityState || []).map(a => ({ name: a.name, cd: a.cd, currentCd: a.currentCd, uses: a.uses, baseBonus: a.baseBonus || undefined, critBonus: a.critBonus || undefined, critDmgBonus: a.critDmgBonus || undefined })),
    passives: (c.passives || []).map(p => ({ id: p.id, innate: p.innate })),
    statuses: [...(c.statuses || []), ...(c.statuses2 || [])].map(s => ({ type: s.type, name: s.name || STATUS_NAMES[s.type] || null, duration: s.duration })),
    res: c.res,
  });
  for (const m of msgs) {
    for (const c of m.cards || []) {
      if (!c.uid || c.partial) continue;
      for (const p of c.passives || []) if (p.uid && p.id) toxUid[p.uid] = p.id;
      const mc = cardById.get(c.cardId);
      if (!cards[c.uid]) cards[c.uid] = { uid: c.uid, cardId: c.cardId, player: c.player, side: sideOf(c.player), n: mc ? mc.number : null, name: mc ? mc.name : null, spamton: mc ? mc.spamton : null, initial: snap(c) };
      if (m.type === 2204) cards[c.uid].initial = snap(c);   // état au lancement (recharges du 2e joueur déjà réduites)
      cards[c.uid].final = Object.assign(snap(c), { sec: m.sec });
    }
    for (const o of m.offers || []) toxUid[o.uid] = o.id;
  }
  const toxInfo = uid => {
    if (!uid) return null;
    const id = toxUid[uid] || null;
    const r = id ? toxRef[id] : null;
    return { uid, id, name: r ? r.name : null, rarity: r ? r.rar : (id && /_[CREL]$/.test(id) ? id.slice(-1) : null), cost: r ? r.cost : null, family: id ? id.replace(/_[CREL]$/, '') : null };
  };
  const num = uid => (cards[uid] ? cards[uid].n : null);
  const label = uid => {
    const c = cards[uid];
    if (!c) return uid === '' ? '?' : uid;
    return `${c.name || c.cardId} (#${c.n}${c.side === 'opp' ? ', adv.' : ''})`;
  };
  const modelAbility = (casterUid, name) => {
    const c = cards[casterUid]; const mc = c && cardById.get(c.cardId);
    return mc ? (mc.abilities || []).find(a => a.id === name || a.name === name) || null : null;
  };
  const isAbility = (casterUid, name) => {
    const c = cards[casterUid];
    return !!(c && (c.initial.abilities.some(a => a.name === name) || (c.final && c.final.abilities.some(a => a.name === name)) || modelAbility(casterUid, name)));
  };
  const isAbsorb = (casterUid, name) => {
    const a = modelAbility(casterUid, name);
    return !!(a && (a.options || []).some(o => (o.effects || []).some(e => /absorb/i.test(e.type || ''))));
  };

  // 3. tours (message 2003) et rattachement des messages
  const turns = [];
  msgs.forEach((m, k) => {
    if (m.type === 2003) turns.push({ k, turn: m.turn, player: m.player, side: sideOf(m.player), sec: m.sec, timer: m.timer, luck: m.luck, money: m.money, events: [] });
  });
  const turnOfK = k => { let r = null; for (const t of turns) { if (t.k <= k) r = t; else break; } return r; };
  // les messages d'argent qui précèdent immédiatement un « début de tour » du même joueur appartiennent à ce tour
  const startWindow = (k, player) => {
    for (let j = k + 1; j < msgs.length && j <= k + 12; j++) {
      const x = msgs[j];
      if (x.type === 2003) return x.player === player ? turns.find(t => t.k === j) : null;
      if ([2206, 2101, 2100, 2020, 2021, 2111].includes(x.type)) return null;
    }
    return null;
  };

  // 4. événements bruts
  const raw = [];
  const money = {};
  const prevStatus = {};
  const curPassives = {};   // uid → ids des passifs au fil des messages 2207 / états de partie
  msgs.forEach((m, k) => {
    switch (m.type) {
      case 2201: {
        const before = money[m.player]; money[m.player] = m.money;
        if (before != null && before !== m.money) {
          const st = startWindow(k, m.player);
          raw.push({ kind: 'money', k, sec: m.sec, player: m.player, side: sideOf(m.player), before, after: m.money, delta: m.money - before, turnStart: st || null });
        }
        break;
      }
      case 2101:
        if (m.card) raw.push({ kind: 'castMark', k, sec: m.sec, caster: m.card, source: m.ability, player: m.player });
        else raw.push({ kind: 'aimCancelled', k, sec: m.sec, player: m.player, text: 'visée annulée' });
        break;
      case 2206:
        for (const q of m.seqs) {
          let inferred = null;
          if (!q.source && q.effects.some(e => e.type === 8)) inferred = (curPassives[q.caster] || []).find(id => /^Spamland_/.test(id)) || null;
          raw.push({ kind: 'seq', k, sec: m.sec, q, inferredSource: inferred });
        }
        break;
      case 2000: case 2015: case 2204:
        for (const c of m.cards || []) if (!c.partial) curPassives[c.uid] = (c.passives || []).map(p => p.id);
        break;
      case 2208:
        for (const e of m.entries) if (e.type === -4 && (e.kind === 3 || e.kind === 4)) raw.push({ kind: 'buff', k, sec: m.sec, e });
        break;
      case 2207:
        for (const c of m.cards) {
          if (c.partial) continue;
          curPassives[c.uid] = (c.passives || []).map(p => p.id);
          const now = [...(c.statuses || []), ...(c.statuses2 || [])];
          const key = s => s.type + '|' + (s.source || '') + '|' + (s.name || '');
          const before = new Set((prevStatus[c.uid] || []).map(key));
          const added = now.filter(s => !before.has(key(s)));
          if (added.length) raw.push({ kind: 'status', k, sec: m.sec, card: c.uid, added });
          prevStatus[c.uid] = now;
        }
        break;
      case 2111:
        raw.push({ kind: 'died', k, sec: m.sec, card: m.card, by: m.by, owner: m.owner });
        break;
      default: break;
    }
  });

  // 5. effets lisibles
  const fx = (ef) => {
    const type = EFFECT_TYPES[ef.type] || ('type' + ef.type);
    return {
      type, code: ef.type, crit: ef.tag === 'Crit' || undefined, tag: ef.tag && ef.tag !== 'Crit' ? ef.tag : undefined, value: ef.value,
      targets: ef.targets.map(t => {
        const o = { target: cards[t.target] ? num(t.target) : t.target, side: cards[t.target] ? cards[t.target].side : undefined, amount: t.amount };
        if (t.before !== -1 || t.after !== -1) { o.before = t.before; o.after = t.after; o.max = t.max; }
        if (ef.type === 15) o.tox = toxUid[t.target] || t.target;
        return o;
      }),
    };
  };
  const fxText = (ef) => ef.targets.map(t => {
    const c = cards[t.target] ? label(t.target) : t.target;
    const crit = ef.tag === 'Crit' ? ' (critique)' : '';
    switch (EFFECT_TYPES[ef.type]) {
      case 'damage': return `${c} −${t.amount}${crit} (${t.before}→${t.after}/${t.max})`;
      case 'heal': return `soin ${-t.amount}${crit} sur ${c} (${t.before}→${t.after}/${t.max})`;
      case 'element': return `bonus ${t.target} +${t.amount}`;
      case 'money': return `+${t.amount} Spamtons (joueur ${t.target})`;
      case 'critChance': return `critique +${t.amount} % sur ${c}`;
      case 'critDamage': return `dégâts critiques +${t.amount} % sur ${c}`;
      case 'cooldown': return `recharges +${t.amount} sur ${c}`;
      case 'kill': return `${c} retirée du jeu`;
      case 'toxBought': return `achat ${toxUid[t.target] || t.target} (${t.amount} Spamtons)`;
      case 'maxHp': return `PV max +${t.amount} sur ${c}`;
      default: return `effet ${ef.type} ${c} ${t.amount}`;
    }
  }).join(', ');
  const buffText = e => `${label(e.dst)} : ${BUFF_KINDS[e.kind] || 'buff ' + e.kind}${e.kind === 4 ? ' ' + (e.element || 'tous éléments') : ''} +${e.amount}`;
  const statusText = (uid, s) => `${label(uid)} : statut ${s.type} ${s.name || STATUS_NAMES[s.type] || ''}`.trim() + (s.duration ? ` (${s.duration} demi-tours)` : '');
  // statuts groupés : « Provocation (CastTauntOnCaster, 2 demi-tours) sur X ; statut 210 (…) sur Y, Z »
  const statusesText = list => {
    const g = new Map();
    for (const { uid, s } of list) {
      const key = s.type + '|' + (s.name || '') + '|' + s.duration;
      if (!g.has(key)) g.set(key, { s, cards: [] });
      g.get(key).cards.push(label(uid));
    }
    return [...g.values()].map(({ s, cards }) => `${STATUS_NAMES[s.type] || 'statut ' + s.type}${s.name ? ' (' + s.name + ')' : ''}${s.duration ? ', ' + s.duration + ' demi-tours' : ''} sur ${cards.join(', ')}`).join(' ; ');
  };

  // 6. lancers : on rattache à chaque 2101 ses séquences d'effets (2206), ses buffs (2208) et ses statuts (2207).
  //    Les capacités sans visée envoient leurs effets AVANT le 2101, les autres APRÈS : on cherche des deux côtés,
  //    et un buff ou un statut va au lancer le plus proche dont la capacité (modèle) a l'effet correspondant.
  const used = new Set();
  const events = [];
  const marks = raw.filter(r => r.kind === 'castMark');
  const KIND_EFFECT = { 0: 'crit', 1: 'critMult', 3: 'base', 4: 'res' };
  const abilityHas = (casterUid, ability, effType) => {
    const a = modelAbility(casterUid, ability);
    return !!(a && (a.options || []).some(o => (o.effects || []).some(e => e.type === effType)));
  };
  const pick = (cands, k, pref) => {
    const sorted = cands.slice().sort((a, b) => Math.abs(a.k - k) - Math.abs(b.k - k));
    return sorted.find(pref) || sorted[0] || null;
  };
  const owner = new Map();   // événement buff/statut → lancer
  for (const r of raw) {
    if (r.kind === 'buff') {
      const c = marks.filter(m => m.caster === r.e.src && Math.abs(m.k - r.k) <= 12);
      const m = pick(c, r.k, m => abilityHas(m.caster, m.source, KIND_EFFECT[r.e.kind]));
      if (m) owner.set(r, m);
    } else if (r.kind === 'status') {
      const c = marks.filter(m => r.k - m.k >= -2 && r.k - m.k <= 6 && r.added.some(s => !s.source || s.source === m.caster));
      const m = pick(c, r.k, m => abilityHas(m.caster, m.source, 'taunt'));
      if (m) owner.set(r, m);
    }
  }
  for (const cm of marks) {
    const near = raw.filter(r => !used.has(r) && Math.abs(r.k - cm.k) <= 10);
    const seqs = near.filter(r => r.kind === 'seq' && r.q.caster === cm.caster && r.q.source === cm.source);
    seqs.forEach(r => used.add(r));
    const buffs = raw.filter(r => r.kind === 'buff' && owner.get(r) === cm);
    buffs.forEach(r => used.add(r));
    const statuses = raw.filter(r => r.kind === 'status' && owner.get(r) === cm);
    statuses.forEach(r => used.add(r));
    used.add(cm);
    const effects = seqs.flatMap(r => r.q.effects);
    const parts = [];
    if (effects.length) parts.push(effects.map(fxText).join(' ; '));
    if (buffs.length) parts.push(buffs.map(r => buffText(r.e)).join(', '));
    if (statuses.length) parts.push(statusesText(statuses.flatMap(r => r.added.map(s => ({ uid: r.card, s })))));
    const k = Math.min(cm.k, ...seqs.map(r => r.k));
    events.push({
      kind: 'cast', k, sec: cm.sec, caster: num(cm.caster), casterUid: cm.caster, side: cards[cm.caster] ? cards[cm.caster].side : sideOf(cm.player),
      ability: cm.source, seqs: seqs.map(r => r.q.id), effects: effects.map(fx),
      buffs: buffs.map(r => ({ target: num(r.e.dst), kind: BUFF_KINDS[r.e.kind] || r.e.kind, element: r.e.kind === 4 ? (r.e.element || 'tous') : undefined, amount: r.e.amount })),
      statuses: statuses.flatMap(r => r.added.map(s => ({ card: num(r.card), type: s.type, name: s.name || STATUS_NAMES[s.type] || null, duration: s.duration }))),
      text: `${label(cm.caster)} · ${cm.source} : ${parts.join(' ; ') || 'aucun effet visible dans le flux'}`,
    });
  }
  // séquences restantes : passifs, Tox, effets de début de tour, capacités lancées sans visée
  for (const r of raw) {
    if (used.has(r)) continue;
    if (r.kind === 'seq') {
      const q = r.q;
      const tox = toxUid[q.source] || r.inferredSource || null;
      const purchase = q.effects.every(e => e.type === 15);
      const kind = purchase ? 'purchaseEffect' : (isAbility(q.caster, q.source) ? 'cast' : (q.source ? 'trigger' : 'turnEffect'));
      events.push({
        kind, k: r.k, sec: r.sec, caster: num(q.caster), casterUid: q.caster, side: cards[q.caster] ? cards[q.caster].side : null,
        ability: kind === 'cast' ? q.source : undefined, source: kind === 'cast' ? undefined : (tox || q.source || null),
        sourceInferred: (!toxUid[q.source] && r.inferredSource) ? true : undefined,
        seqs: [q.id], effects: q.effects.map(fx),
        text: `${label(q.caster)} · ${tox || q.source || 'début de tour'}${!toxUid[q.source] && r.inferredSource ? ' (déduit)' : ''} : ${q.effects.map(fxText).join(' ; ')}`,
      });
    } else if (r.kind === 'buff') {
      events.push({ kind: 'buff', k: r.k, sec: r.sec, caster: num(r.e.src), target: num(r.e.dst), text: buffText(r.e) + ` (${label(r.e.src)})` });
    } else if (r.kind === 'status') {
      events.push({ kind: 'status', k: r.k, sec: r.sec, card: num(r.card), statuses: r.added.map(s => ({ type: s.type, name: s.name || STATUS_NAMES[s.type] || null, duration: s.duration })), text: statusesText(r.added.map(s => ({ uid: r.card, s }))) });
    } else if (r.kind === 'died') {
      events.push({ kind: 'death', k: r.k, sec: r.sec, card: num(r.card), side: cards[r.card] ? cards[r.card].side : null, byField: cards[r.by] ? num(r.by) : r.by, text: `${label(r.card)} quitte le terrain` });
    } else if (r.kind === 'aimCancelled') {
      events.push({ ...r });
    } else if (r.kind === 'money') {
      events.push(r);
    }
  }

  // 7. boutique (2003 / 2021 / 2020), à partir des messages
  const shop = [];
  const open = {};
  msgs.forEach((m, k) => {
    if (m.type === 2003 && m.offers.length) {
      open[m.player] = { turn: m.turn, player: m.player, side: sideOf(m.player), k, sec: m.sec, moneyAtTurnStart: m.money, visits: [{ offers: m.offers.map(o => o.id || o.uid), rerollCost: m.rerollBase + m.rerollExtra, k }] };
      shop.push(open[m.player]);
      events.push({ kind: 'shop', k, sec: m.sec, side: sideOf(m.player), player: m.player, action: 'offre', offers: m.offers.map(o => o.id), text: `boutique : ${m.offers.map(o => o.id).join(', ')}` });
    } else if (m.type === 2021 && open[m.player]) {
      const s = open[m.player]; const last = s.visits[s.visits.length - 1];
      if (m.offers.length) {
        last.action = 'relance'; last.paid = last.rerollCost;
        s.visits.push({ offers: m.offers.map(o => o.id || o.uid), rerollCost: m.rerollBase + m.rerollExtra, k });
        events.push({ kind: 'shop', k, sec: m.sec, side: s.side, player: m.player, action: 'relance', paid: last.paid, offers: m.offers.map(o => o.id), text: `relance (${last.paid} Spamtons) → ${m.offers.map(o => o.id).join(', ')}` });
      } else {
        if (!last.action) {
          last.action = 'passe';
          events.push({ kind: 'shop', k, sec: m.sec, side: s.side, player: m.player, action: 'passe', text: `boutique passée (${last.offers.join(', ')})` });
        }
        delete open[m.player];
      }
    } else if (m.type === 2020) {
      const s = open[m.player]; const tx = toxInfo(m.tox);
      const rep = m.replaced ? (toxUid[m.replaced] || m.replaced) : null;
      const bought = { tox: tx.id || m.tox, name: tx.name, rarity: tx.rarity, cost: tx.cost, on: num(m.card), onName: cards[m.card] ? cards[m.card].name : null, replaced: rep };
      if (s) { const last = s.visits[s.visits.length - 1]; last.action = 'achat'; last.bought = bought; last.boughtIndex = last.offers.indexOf(tx.id); }
      events.push({ kind: 'shop', k, sec: m.sec, side: sideOf(m.player), player: m.player, action: 'achat', ...bought, text: `achat ${bought.tox} (${bought.name || '?'}, ${bought.cost != null ? bought.cost + ' Spamtons' : 'prix ?'}) sur ${label(m.card)}${rep ? ', à la place de ' + rep : ', emplacement libre'}` });
    }
  });

  // 8. morts et absorptions (effet 14 des séquences)
  const hpAt = {};      // dernier état connu des PV, mis à jour dans l'ordre des messages
  const deaths = [];
  msgs.forEach((m, k) => {
    if (m.type === 2207) for (const c of m.cards) if (!c.partial && c.hp >= 0) hpAt[c.uid] = { hp: c.hp, max: c.maxHp, k };
    if (m.type !== 2206) return;
    for (const q of m.seqs) {
      for (const ef of q.effects) {
        if (ef.type === 14) for (const t of ef.targets) {
          const absorb = isAbsorb(q.caster, q.source);
          const victim = cards[t.target];
          const hit = q.effects.filter(e => e.type === 1).flatMap(e => e.targets.filter(x => x.target === t.target).map(x => ({ ...x, crit: e.tag === 'Crit' })));
          const d = {
            turn: q.turn, sec: m.sec, k, card: num(t.target), name: victim ? victim.name : null, side: victim ? victim.side : null,
            by: num(q.caster), byName: cards[q.caster] ? cards[q.caster].name : null, how: absorb ? 'absorption' : 'élimination', ability: q.source,
            lastHits: hit.map(x => ({ amount: x.amount, before: x.before, after: x.after, max: x.max, crit: x.crit })),
          };
          if (absorb) {
            const heal = q.effects.find(e => e.type === 2 && e.targets.some(x => x.target === q.caster));
            const ht = heal ? heal.targets.find(x => x.target === q.caster) : null;
            const mx = q.effects.find(e => e.type === 16 && e.targets.some(x => x.target === q.caster));
            d.absorption = {
              victimHpBefore: hpAt[t.target] ? hpAt[t.target].hp : null, victimMaxHpBefore: hpAt[t.target] ? hpAt[t.target].max : null,
              casterHpBefore: ht ? ht.before : null, casterHpAfter: ht ? ht.after : null,
              casterMaxHpBefore: ht && mx ? ht.max - mx.value : null, casterMaxHpAfter: ht ? ht.max : null,
              maxHpGain: mx ? mx.value : null, healed: ht ? -ht.amount : null,
            };
          }
          deaths.push(d);
        }
        for (const t of ef.targets) if (cards[t.target] && t.after !== -1) hpAt[t.target] = { hp: t.after, max: t.max, k };
      }
    }
  });
  for (const d of deaths) {
    const n = raw.find(r => r.kind === 'died' && num(r.card) === d.card && r.k >= d.k);
    if (n) { d.removedNotice = { sec: n.sec, byField: cards[n.by] ? num(n.by) : n.by, owner: n.owner }; }
    const b = raw.find(r => r.kind === 'money' && r.delta === 50 && Math.abs(r.k - d.k) <= 4 && sideOf(r.player) === d.side);
    d.bounty = b ? { to: b.side, before: b.before, after: b.after } : null;
    if (b) b.why = 'prime de carte perdue (+50)';
    d.killsInServerStats = null;
  }

  // 9. raisons des mouvements d'argent
  const alive = (player, k) => Object.values(cards).filter(c => c.player === player && !deaths.some(d => d.card === c.n && d.side === c.side && d.k < k));
  for (const e of events) {
    if (e.kind !== 'money' || e.why) continue;
    if (e.turnStart) {
      const base = alive(e.player, e.k).reduce((s, c) => s + (c.spamton || 0), 0) + e.turnStart.turn;
      const passive = events.find(x => x.kind === 'turnEffect' && x.side === e.side && Math.abs(x.k - e.turnStart.k) <= 6 && x.effects.some(f => f.type === 'money' && f.targets.some(t => t.amount === e.delta)));
      e.why = e.delta === base ? `revenu du tour (Spamtons des cartes vivantes + n° du tour = ${base})` : (passive ? `passif ${passive.source || ''} de ${label(passive.casterUid)} (+${e.delta})`.replace('  ', ' ') : 'début de tour (cause non identifiée)');
      continue;
    }
    const next = msgs.slice(e.k + 1, e.k + 8).find(x => !NOISE.has(x.type) && x.type !== 2201) || {};
    if (next.type === 2021 && next.player === e.player && next.offers.length) e.why = 'relance';
    else if (next.type === 2020 && next.player === e.player) e.why = 'achat';
    else if (next.type === 2021 && next.player === e.player && e.delta === 10) e.why = 'boutique passée (+10)';
  }

  // 10. événements → tours
  for (const e of events) {
    const t = e.kind === 'money' && e.turnStart ? e.turnStart : turnOfK(e.k);
    const target = t || (turns.pre = turns.pre || { events: [] });
    const out = { ...e }; delete out.turnStart; delete out.casterUid; delete out.k;
    if (out.kind === 'money') out.text = `Spamtons ${out.side === 'me' ? 'moi' : 'adv.'} ${out.before} → ${out.after} (${out.delta > 0 ? '+' : ''}${out.delta})${out.why ? ' : ' + out.why : ''}`;
    out._k = e.k;
    target.events.push(out);
  }
  for (const t of turns) { t.events.sort((a, b) => a._k - b._k); for (const e of t.events) delete e._k; }

  // bonus élémentaires de chaque joueur (fin des messages 2207), relevés au début de chaque tour
  const elemAt = [];
  msgs.forEach((m, k) => { if (m.type === 2207 && m.players) m.players.forEach((pb, pl) => { if (pb && pb.elements) elemAt.push({ k, player: pl, elements: pb.elements }); }); });
  const nz = o => (o ? Object.fromEntries(Object.entries(o).filter(([, v]) => v)) : null);
  const elementsBefore = (player, k) => { let r = null; for (const e of elemAt) { if (e.player === player && e.k <= k) r = e.elements; } return nz(r); };

  // 11. résultat serveur (2001)
  const res = msgs.find(m => m.type === 2001);
  const stats = res && res.stats ? res.stats : null;
  const accSide = id => (id === H.AccountId ? 'me' : (id === H.OpponentId ? 'opp' : null));
  const statsOf = s => (stats ? (accSide(stats.winner) === s ? stats.matchStatsWinner : (accSide(stats.loser) === s ? stats.matchStatsLoser : null)) : null);
  const bans = stats ? {
    me: statsOf('me') ? statsOf('me').bans : null,
    opp: statsOf('opp') ? statsOf('opp').bans : null,
    bannedInShops: { me: statsOf('me') ? statsOf('me').shop.map(s => s.banned).filter(Boolean) : null, opp: statsOf('opp') ? statsOf('opp').shop.map(s => s.banned).filter(Boolean) : null },
    basis: 'statistiques serveur de fin de partie (message 2001) : matchStats.bans et shop[].banned',
  } : null;
  if (stats) for (const d of deaths) {
    const all = [...stats.cardsWinner, ...stats.cardsLoser];
    const killer = all.find(c => (cardById.get(c.id) || {}).number === d.by);
    const victim = all.find(c => (cardById.get(c.id) || {}).number === d.card);
    d.killsInServerStats = killer ? killer.kills : null;
    d.victimAliveInServerStats = victim ? victim.isAlive : null;
  }
  // recoupement boutique : messages ↔ statistiques serveur
  const shopCheck = [];
  for (const s of ['me', 'opp']) {
    const st = statsOf(s); if (!st) continue;
    const fromMsgs = shop.filter(x => x.side === s).flatMap(x => x.visits.map(v => ({ turn: x.turn, offers: v.offers.join(','), action: v.action })));
    const fromStats = st.shop.map(v => ({ turn: v.turn, offers: v.offers.map(u => toxUid[u] || u).join(','), action: { s: 'passe', r: 'relance', b: 'achat' }[v.action] || v.action }));
    shopCheck.push({ side: s, same: JSON.stringify(fromMsgs) === JSON.stringify(fromStats), visits: fromStats.length });
  }

  // 12. contrôles
  const lastTurn = turns.length ? turns[turns.length - 1].turn : null;
  const checks = {
    messageCountHeader: H.MessageCount, messageCountRead: cont.count, messageCountOk: H.MessageCount === cont.count,
    turnCountHeader: H.TurnCount, lastTurnRead: lastTurn, turnCountOk: H.TurnCount === lastTurn,
    durationMsHeader: H.DurationMs, lastMessageMs: cont.records.length ? cont.records[cont.records.length - 1].t : null,
    trailingBytes: cont.trailing, decodeErrors: errors,
    unknownTypes: Object.keys(typeCount).filter(t => !TYPE_NAMES[t]).map(Number),
    toxUnresolved: [...new Set(shop.flatMap(s => s.visits.flatMap(v => v.offers.filter(o => /^[0-9a-f]{8}-/.test(o)))))],
    cardsUnresolved: Object.values(cards).filter(c => c.n == null).map(c => c.uid),
    shopMatchesServerStats: shopCheck,
    castsWithoutVisibleEffect: events.filter(e => e.kind === 'cast' && !e.effects.length && !(e.buffs || []).length && !(e.statuses || []).length).map(e => e.ability),
  };

  // 13. synthèse
  const firstTurn = turns[0] || null;
  const starterSide = stats && stats.starter ? accSide(stats.starter) : null;
  const shopOut = shop.map(s => ({
    turn: s.turn, side: s.side, moneyAtTurnStart: s.moneyAtTurnStart,
    visits: s.visits.map(v => ({ offers: v.offers, action: v.action || null, paid: v.paid, bought: v.bought, boughtIndex: v.boughtIndex })),
  }));
  const log = turns.map(t => ({
    turn: t.turn, side: t.side, money: t.money,
    lines: t.events.filter(e => ['cast', 'shop', 'death', 'trigger', 'turnEffect', 'buff', 'status', 'aimCancelled'].includes(e.kind) || (e.kind === 'money' && /prime/.test(e.why || ''))).map(e => e.text),
  }));
  const summary = {
    game: H.GameUid, appVersion: H.AppVersion, mode: H.GameMode === 0 ? 'normal' : ('GameMode ' + H.GameMode),
    startUtc: H.StartUtc, durationMs: H.DurationMs,
    result: H.IsDraw ? 'N' : (H.WinnerId === H.AccountId ? 'V' : 'D'),
    endCause: stats ? stats.endCause : null,
    turns: H.TurnCount, turnsPlayed: { me: turns.filter(t => t.side === 'me').length, opp: turns.filter(t => t.side === 'opp').length },
    seat: mySeat,
    first: firstTurn ? firstTurn.side === 'me' : null,
    firstBasis: `1er début de tour (message 2003) : joueur ${firstTurn ? firstTurn.player : '?'} (${firstTurn ? firstTurn.side : '?'}) ; statistiques serveur : starter = ${starterSide || '?'}`,
    me: { player: mySeat, cards: (H.MyCards || []).map(id => (cardById.get(id) || {}).number || id) },
    opp: { player: mySeat == null ? null : 1 - mySeat, name: H.OpponentName, isAi: H.OpponentIsAi, cards: (H.OpponentCards || []).map(id => (cardById.get(id) || {}).number || id) },
    talents: stats ? Object.fromEntries(['me', 'opp'].map(s => [s, ((accSide(stats.winner) === s ? stats.draftTalentsWinner : stats.draftTalentsLoser) || []).map(c => ({ card: (cardById.get(c.id) || {}).number, talent: c.talentId || c.talentName || null }))])) : null,
    bans,
    shop: shopOut,
    deaths,
    serverTotals: stats ? {
      cards: [...stats.cardsWinner.map(c => [c, stats.winner]), ...stats.cardsLoser.map(c => [c, stats.loser])].map(([c, acc]) => ({ card: (cardById.get(c.id) || {}).number, side: accSide(acc), alive: c.isAlive, damage: c.damage, heal: c.heal, kills: c.kills })),
      hpByTurn: { me: statsOf('me') && statsOf('me').hp, opp: statsOf('opp') && statsOf('opp').hp },
      toxPurchases: (stats.toxPurchases || []).map(p => ({ side: accSide(p.userId), turn: p.turn, on: (cardById.get(p.card) || {}).number, tox: toxUid[p.tox] || p.tox, cost: p.cost })),
      rerolls: { me: statsOf('me') && statsOf('me').rerolls, opp: statsOf('opp') && statsOf('opp').rerolls },
      skips: { me: statsOf('me') && statsOf('me').skips, opp: statsOf('opp') && statsOf('opp').skips },
    } : null,
    overtime: (lastTurn || 0) >= 20 ? 'tour 20 atteint : voir les tours ≥ 20' : `non atteinte (dernier tour ${lastTurn})`,
    log,
  };

  const out = {
    reader: { name: 'read_srpl.js', version: READER_VERSION },
    file: path.basename(opts.file),
    container: { gzip: cont.gz, compressedBytes: cont.compressedBytes, bytes: cont.bytes, magic: 'SRPL', formatVersion: cont.formatVersion, messages: cont.count },
    reference: { model: relRepo(ref.modelPath), tox: relRepo(ref.toxPath) },
    header: mask(H),
    checks,
    summary,
    players: Object.fromEntries([[String(mySeat), { side: 'me', accountId: H.AccountId, name: H.Loading && H.Loading.me ? H.Loading.me.username : null }], [String(mySeat == null ? '?' : 1 - mySeat), { side: 'opp', accountId: H.OpponentId, name: H.OpponentName }]]),
    cards: Object.fromEntries(Object.values(cards).map(c => [c.uid, { n: c.n, name: c.name, side: c.side, player: c.player, initial: c.initial, final: c.final, died: deaths.find(d => d.card === c.n && d.side === c.side) ? true : false }])),
    tox: Object.fromEntries(Object.entries(toxUid).sort((a, b) => a[1].localeCompare(b[1])).map(([u]) => [u, toxInfo(u)])),
    turns: turns.map(t => ({ turn: t.turn, side: t.side, player: t.player, sec: t.sec, timer: t.timer, luck: t.luck, money: t.money,
      elementsAtStart: mySeat == null ? null : { me: elementsBefore(mySeat, t.k), opp: elementsBefore(1 - mySeat, t.k) }, events: t.events })),
    messageTypes: Object.fromEntries(Object.entries(typeCount).map(([k, v]) => [k, { name: TYPE_NAMES[k] || 'inconnu', count: v }])),
    serverStats: stats ? mask(stats) : null,
  };
  if (turns.pre) out.beforeFirstTurn = turns.pre.events;
  if (opts.cards) out.cardStates = msgs.filter(m => m.cards && m.type === 2207).flatMap(m => m.cards.map(c => ({ sec: m.sec, i: m.i, card: num(c.uid), side: cards[c.uid] ? cards[c.uid].side : null, ...snap(c) })));
  if (opts.messages) out.messages = msgs.map(m => { const o = { ...m }; delete o.buf; if (o.cards) o.cards = o.cards.map(c => ({ uid: c.uid, card: num(c.uid), hp: c.hp, maxHp: c.maxHp })); return o; });
  out.journal = journalDraft(out, toxRef, starterSide);
  return out;
}

// ───────────────────────────── brouillon pour le Journal ─────────────────────────────
// Le document matches/<id> du Journal (contrat : journal/README.md), sans les champs d'analyse
// (summary, turningPoint, mistakes, goodPlays, lessons) ni source / createdAt, que pose celui qui l'écrit.
const EL_FR = { fire: 'Feu', water: 'Eau', earth: 'Terre', nature: 'Nature', light: 'Lumière', shadow: 'Ombre', '': 'tous éléments', tous: 'tous éléments' };
function groupRepeats(txt) {
  const rules = [[/(critique \+(\d+) % \([^)]+\)(, )?){2,}/g, 'critique', v => `critique +${v} %`], [/(valeurs de base \+(\d+) \([^)]+\)(, )?){2,}/g, 'valeurs de base', v => `valeurs de base +${v}`], [/(PV max \+(\d+) \([^)]+\)(, )?){2,}/g, 'PV max', v => `PV max +${v}`]];
  for (const [re, word, fmt] of rules) {
    txt = txt.replace(re, m => {
      const n = m.split(word).length - 1;
      const v = m.match(/\+(\d+)/)[1];
      return `${fmt(v)} (${n} cartes)` + (m.trim().endsWith(',') ? ', ' : '');
    });
  }
  return txt;
}
function journalDraft(out, toxRef, starterSide) {
  const S = out.summary, H = out.header;
  const nameOf = {};
  for (const c of Object.values(out.cards)) if (c.n != null) nameOf[c.n] = c.name || ('#' + c.n);
  const cn = n => (typeof n === 'number' ? (nameOf[n] || '#' + n) : n);
  const toxLabel = id => { if (!id) return null; const t = toxRef[id]; return t ? `${t.name} ${id.slice(-1)}` : id; };
  const famName = src => {
    if (!src) return null;
    if (toxRef[src]) return toxRef[src].name;
    const k = Object.keys(toxRef).find(x => x.replace(/_[CREL]$/, '') === src);
    return k ? toxRef[k].name : src;
  };
  const effShort = e => {
    const parts = [];
    for (const f of e.effects || []) for (const t of f.targets) {
      const tg = cn(t.target), cr = f.crit ? ' crit.' : '';
      if (f.type === 'damage') parts.push(`${tg} −${t.amount}${cr} (${t.before}→${t.after})`);
      else if (f.type === 'heal') parts.push(`soin ${-t.amount}${cr} sur ${tg} (${t.before}→${t.after}/${t.max})`);
      else if (f.type === 'element') parts.push(`+${t.amount} ${EL_FR[t.target] || t.target}`);
      else if (f.type === 'money') parts.push(`+${t.amount} Spamtons`);
      else if (f.type === 'critChance') parts.push(`critique +${t.amount} % (${tg})`);
      else if (f.type === 'critDamage') parts.push(`dégâts critiques +${t.amount} % (${tg})`);
      else if (f.type === 'cooldown') parts.push(`recharges +${t.amount} (${tg})`);
      else if (f.type === 'maxHp') parts.push(`PV max +${t.amount} (${tg})`);
      else if (f.type === 'kill') parts.push(`${tg} retirée du jeu`);
      else if (f.type !== 'toxBought') parts.push(`effet ${f.code} ${tg} ${t.amount}`);
    }
    for (const b of e.buffs || []) parts.push(`${b.kind}${b.element ? ' ' + (EL_FR[b.element] || b.element) : ''} +${b.amount} (${cn(b.target)})`);
    const prov = (e.statuses || []).filter(x => x.type === 200).map(x => cn(x.card));
    if (prov.length) parts.push(`Provocation sur ${prov.join(', ')}`);
    return groupRepeats(parts.join(', '));
  };
  const half = turn => {
    const lines = [];
    const trig = new Map();
    for (const e of turn.events) {
      if (e.kind === 'shop') {
        if (e.action === 'offre') lines.push(`Boutique : ${e.offers.map(toxLabel).join(', ')}`);
        else if (e.action === 'relance') lines.push(`relance (−${e.paid}) : ${e.offers.map(toxLabel).join(', ')}`);
        else if (e.action === 'passe') lines.push('passe (+10)');
        else if (e.action === 'achat') lines.push(`achète ${toxLabel(e.tox)} (${e.cost}) sur ${cn(e.on)}${e.replaced ? ' à la place de ' + toxLabel(e.replaced) : ''}`);
      } else if (e.kind === 'cast') {
        lines.push(`${cn(e.caster)} · ${e.ability} : ${effShort(e) || 'aucun effet visible'}`);
      } else if (e.kind === 'trigger' || e.kind === 'turnEffect') {
        if ((e.effects || []).some(f => f.type === 'toxBought')) continue;
        const other = e.side && e.side !== turn.side ? (e.side === 'me' ? ' [moi]' : ' [adv.]') : '';
        const key = `${cn(e.caster)}${other} (${famName(e.source) || 'début de tour'})`;
        if (!trig.has(key)) trig.set(key, []);
        trig.get(key).push(effShort(e));
      } else if (e.kind === 'money' && /prime/.test(e.why || '')) {
        lines.push(`prime +50 Spamtons (${e.side === 'me' ? 'moi' : 'adv.'})`);
      } else if (e.kind === 'aimCancelled') {
        lines.push('visée annulée');
      }
    }
    const tt = [...trig.entries()].map(([k, v]) => {
      const m = {}; const other = [];
      for (const x of v) { const mm = x.match(/^\+(\d+) (\S+)$/); if (mm) m[mm[2]] = (m[mm[2]] || 0) + Number(mm[1]); else other.push(x); }
      return `${k} ${[...Object.entries(m).map(([el, n]) => `+${n} ${el}`), ...other].join(', ')}`;
    });
    return `[${turn.money} Spamtons, Chance ${turn.luck}] ` + [...lines, tt.length ? 'passifs : ' + tt.join(' ; ') : null].filter(Boolean).join('. ');
  };
  const rounds = [];
  for (const t of out.turns) {
    let r = rounds.find(x => x.t === t.turn);
    if (!r) { r = { t: t.turn }; rounds.push(r); }
    r[t.side] = half(t);
  }
  const last = out.turns.length ? out.turns[out.turns.length - 1] : null;
  const basis = `replay ${out.file} décodé (read_srpl.js ${READER_VERSION}) ; buffs et statuts rattachés aux lancers par proximité et par le modèle`;
  const ended = S.endCause === 'surrender' ? 'partie finie par abandon' : 'partie finie';
  const timeline = rounds.map((r, i) => ({
    t: r.t,
    me: r.me || (i === rounds.length - 1 && last && last.side === 'opp' ? `— (${ended} avant mon tour)` : ''),
    opp: r.opp || (i === rounds.length - 1 && last && last.side === 'me' ? `— (${ended} pendant mon tour)` : ''),
    note: '', inferred: false, c: 95, basis,
  }));
  const shop = S.shop.map(s => {
    const buy = s.visits.find(v => v.action === 'achat');
    const rer = s.visits.filter(v => v.action === 'relance');
    return {
      t: s.turn, who: s.side, tox: buy ? buy.bought.tox : null, pass: !buy, on: buy ? buy.bought.on : null,
      replaced: buy && buy.bought.replaced ? buy.bought.replaced : null, c: 100,
      cost: buy ? buy.bought.cost : 0, rerolls: rer.length, rerollSpent: rer.reduce((a, v) => a + (v.paid || 0), 0), offers: s.visits.map(v => v.offers),
    };
  });
  const visits = side => S.shop.filter(s => s.side === side).reduce((a, s) => a + s.visits.length, 0);
  const b = S.bans;
  const nonEmpty = a => Array.isArray(a) && a.length > 0;
  const anyBan = b && (nonEmpty(b.me) || nonEmpty(b.opp) || nonEmpty(b.bannedInShops.me) || nonEmpty(b.bannedInShops.opp));
  let bans = null;
  if (b && anyBan) bans = { mine: null, theirs: null, c: 50, seen: 'Ban présent dans les stats serveur, format encore inconnu : ' + JSON.stringify({ me: b.me, opp: b.opp, shops: b.bannedInShops }) };
  else if (b) bans = { none: true, mine: null, theirs: null, c: 100, seen: `Aucun ban dans cette partie : les statistiques de fin de partie du serveur (dans le replay) ont « bans: [] » pour les deux joueurs et un champ « banned » vide à chacun des ${visits('me')} passages en boutique de mon côté et des ${visits('opp')} de l'adversaire ; aucun message de ban dans le flux.` };
  const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(H.StartUtc));
  const g = k => (parts.find(x => x.type === k) || {}).value;
  const digits = String(H.GameUid || '').replace(/\D/g, '');
  const firstOk = S.first != null && (starterSide == null || (starterSide === 'me') === S.first);
  const errs = out.checks.decodeErrors.length + out.checks.unknownTypes.length;
  return {
    id: `${g('year')}-${g('month')}-${g('day')}-${g('hour')}${g('minute')}-${digits.slice(-4)}`,
    date: new Date(H.StartUtc).toISOString().replace(/\.\d+Z$/, 'Z'),
    mode: H.GameMode === 0 ? 'normal' : 'inconnu', result: S.result, resultCertainty: 100,
    first: S.first, firstCertainty: firstOk ? 100 : 60, turns: S.turns,
    my: { cards: S.me.cards, unknown: [] },
    opp: { name: S.opp.name, cards: S.opp.cards, unknown: [], archetype: null, certainty: 100 },
    timeline, gaps: [], shop, bans,
    evidence: {
      screens: 0, confidence: errs ? 70 : 95,
      coverage: `replay entier décodé (${out.file}, ${out.container.messages} messages, ${out.checks.decodeErrors.length} erreur(s)) : ${S.turns} tours, lancers et effets avec PV avant/après, boutique, Spamtons, bonus élémentaires, morts ; statistiques de fin de partie du serveur`,
    },
    note: `Replay ${out.file} décodé par scripts/replay/read_srpl.js ${READER_VERSION}${S.endCause === 'surrender' ? ' ; partie finie par abandon' : ''}.`,
  };
}

// ───────────────────────────── principal ─────────────────────────────
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.file) {
    process.stderr.write('usage : node scripts/replay/read_srpl.js <match.srpl> [--index <index.json>] [--model <model.json>] [--tox <tox.json>] [--messages] [--cards]\n');
    process.exit(opts.help ? 0 : 2);
  }
  const cont = readContainer(opts.file);
  const H = cont.header;
  const mm = loadModel(opts.model, H.AppVersion);
  const toxPath = opts.tox || path.join(REPO, 'journal', 'ref', 'tox.json');
  const tox = loadJson(toxPath);
  const ref = { model: mm.model, modelPath: mm.path, tox, toxPath: tox ? toxPath : null };
  const out = analyse(cont, ref, opts);

  const tickets = collectTickets(H);
  if (opts.index) {
    const idx = loadJson(opts.index);
    if (!Array.isArray(idx)) out.index = { error: 'index illisible' };
    else {
      collectTickets(idx, tickets);
      const e = idx.find(x => x.GameUid === H.GameUid);
      out.index = e ? {
        found: true,
        sameAsHeader: ['AccountId', 'Seat', 'OpponentId', 'WinnerId', 'TurnCount', 'MessageCount', 'DurationMs', 'StartUtc']
          .every(k => JSON.stringify(e[k]) === JSON.stringify(H[k])),
        entry: mask(e),
      } : { found: false, games: idx.map(x => x.GameUid) };
    }
  }
  if (out.summary.appVersion && mm.path && !mm.path.includes(path.sep + out.summary.appVersion + path.sep)) {
    out.checks.modelVersionWarning = `modèle ${mm.path} utilisé pour une partie en ${out.summary.appVersion}`;
  }
  let text = JSON.stringify(out, null, 1);
  for (const t of tickets) if (t && text.includes(t)) text = text.split(t).join('<masqué>');   // garde-fou
  process.stdout.write(text + '\n');
}

if (require.main === module) {
  try { main(); } catch (e) { process.stderr.write('read_srpl : ' + e.message + '\n'); process.exit(1); }
}
module.exports = { readContainer, decodeMessage, readCard, CompactReader, NgoReader, analyse };
