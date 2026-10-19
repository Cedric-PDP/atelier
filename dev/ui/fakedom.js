// Faux DOM minimal, suffisant pour runtime-dom de Vue 3 et l'interface du classeur.
'use strict';

function makeDom() {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let doc;

  class Node {
    constructor(type) { this.nodeType = type; this.parentNode = null; this.childNodes = []; }
    get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.childNodes.indexOf(this); return p.childNodes[i + 1] || null; }
    get firstChild() { return this.childNodes[0] || null; }
    insertBefore(child, anchor) {
      if (child.parentNode) child.parentNode.removeChild(child);
      const i = anchor ? this.childNodes.indexOf(anchor) : -1;
      if (anchor && i < 0) throw new Error('insertBefore: ancre absente');
      if (i < 0) this.childNodes.push(child); else this.childNodes.splice(i, 0, child);
      child.parentNode = this;
      return child;
    }
    appendChild(c) { return this.insertBefore(c, null); }
    append(...cs) { for (const c of cs) this.appendChild(typeof c === 'string' ? new Text(c) : c); }
    removeChild(c) { const i = this.childNodes.indexOf(c); if (i < 0) throw new Error('removeChild: enfant absent'); this.childNodes.splice(i, 1); c.parentNode = null; return c; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
    set textContent(v) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; if (v !== '' && v != null) this.appendChild(new Text(String(v))); }
    contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  }
  class Text extends Node { constructor(t) { super(3); this.nodeValue = t; } get textContent() { return this.nodeValue; } set textContent(v) { this.nodeValue = String(v); } }
  class Comment extends Node { constructor(t) { super(8); this.nodeValue = t; } get textContent() { return ''; } set textContent(v) { this.nodeValue = v; } }

  function makeStyle() {
    const props = {};
    return new Proxy(props, {
      get(t, k) {
        if (k === 'setProperty') return (n, v) => { t[n] = v; };
        if (k === 'removeProperty') return (n) => { delete t[n]; };
        if (k === 'getPropertyValue') return (n) => t[n] || '';
        return t[k] === undefined ? '' : t[k];
      },
      set(t, k, v) { t[k] = v; return true; },
    });
  }

  class Element extends Node {
    constructor(tag, ns) {
      super(1);
      this.localName = tag;
      this.tagName = ns === SVG_NS ? tag : tag.toUpperCase();
      this.namespaceURI = ns || 'http://www.w3.org/1999/xhtml';
      this.attrs = new Map();
      this.listeners = {};
      this.style = makeStyle();
      const el = this;
      this.classList = {
        add: (...c) => { const s = new Set(el.className.split(/\s+/).filter(Boolean)); c.forEach((x) => s.add(x)); el.className = [...s].join(' '); },
        remove: (...c) => { const s = new Set(el.className.split(/\s+/).filter(Boolean)); c.forEach((x) => s.delete(x)); el.className = [...s].join(' '); },
        contains: (c) => el.className.split(/\s+/).includes(c),
      };
      if (this.tagName === 'INPUT' || this.tagName === 'TEXTAREA' || this.tagName === 'SELECT' || this.tagName === 'OPTION') this.value = '';
      if (this.tagName === 'INPUT') { this.checked = false; this.files = null; }
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'OPTION'].includes(this.tagName)) this.disabled = false;
      if (this.tagName === 'OL') this.start = 1;
    }
    get className() { return this.attrs.get('class') || ''; }
    set className(v) { this.attrs.set('class', String(v)); }
    get id() { return this.attrs.get('id') || ''; }
    set id(v) { this.attrs.set('id', String(v)); }
    setAttribute(k, v) { this.attrs.set(k, String(v)); }
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
    hasAttribute(k) { return this.attrs.has(k); }
    removeAttribute(k) { this.attrs.delete(k); }
    setAttributeNS(ns, k, v) { this.attrs.set(k, String(v)); }
    removeAttributeNS(ns, k) { this.attrs.delete(k); }
    addEventListener(t, f) { (this.listeners[t] || (this.listeners[t] = new Set())).add(f); }
    removeEventListener(t, f) { if (this.listeners[t]) this.listeners[t].delete(f); }
    dispatch(type, extra) {
      const ev = { type, target: this, currentTarget: this, _vts: 1e15, defaultPrevented: false, stopped: false,
        shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
      for (let n = this; n; n = n.parentNode) {
        ev.currentTarget = n;
        for (const f of [...((n.listeners && n.listeners[type]) || [])]) f(ev);
        if (ev.stopped) break;
      }
      // Comme dans un navigateur : stopPropagation() arrête aussi l'événement avant window.
      if (!ev.stopped && n_isWindowTarget(type)) for (const f of [...(win.listeners[type] || [])]) f(ev);
      return ev;
    }
    click(extra) {
      if (this.tagName === 'INPUT' && this.getAttribute('type') === 'checkbox') this.checked = !this.checked;
      const ev = this.dispatch('click', extra);
      if (!ev.defaultPrevented && this.tagName === 'BUTTON' && (this.getAttribute('type') === 'submit')) {
        let f = this.parentNode; while (f && f.tagName !== 'FORM') f = f.parentNode;
        if (f) f.dispatch('submit');
      }
      return ev;
    }
    focus() { doc.activeElement = this; }
    blur() { if (doc.activeElement === this) doc.activeElement = doc.body; }
    select() {}
    scrollIntoView() {}
    get offsetParent() { return this.parentNode ? {} : null; }
    get innerHTML() { return ''; }
    set innerHTML(v) { if (v !== '') throw new Error('innerHTML non vide non géré'); for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; }
    get content() { return this; }
    querySelectorAll(sel) { const out = []; walk(this, (n) => { if (n !== this && n.nodeType === 1 && matches(n, sel)) out.push(n); }); return out; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }
  const n_isWindowTarget = (type) => type === 'keydown';

  function walk(n, f) { f(n); for (const c of n.childNodes) walk(c, f); }
  // Sélecteurs simples : tag, #id, .cls, [attr], [attr="v"], :not([attr]) / :not([attr="v"]), séparés par des virgules.
  function matches(el, sel) {
    return sel.split(',').some((part) => {
      let s = part.trim();
      const nots = [];
      s = s.replace(/:not\(\[([\w-]+)(?:="([^"]*)")?\]\)/g, (_, a, v) => { nots.push([a, v]); return ''; });
      const attrs = [];
      s = s.replace(/\[([\w-]+)(?:="([^"]*)")?\]/g, (_, a, v) => { attrs.push([a, v]); return ''; });
      const m = s.match(/^([\w-]*)((?:[#.][\w-]+)*)$/);
      if (!m) throw new Error('sélecteur non géré : ' + part);
      if (m[1] && el.localName !== m[1]) return false;
      for (const x of (m[2].match(/[#.][\w-]+/g) || [])) {
        if (x[0] === '#' && el.getAttribute('id') !== x.slice(1)) return false;
        if (x[0] === '.' && !el.classList.contains(x.slice(1))) return false;
      }
      const has = (a, v) => {
        if (a === 'disabled') return v === undefined ? !!el.disabled : false;
        if (!el.hasAttribute(a)) return false;
        return v === undefined || el.getAttribute(a) === v;
      };
      for (const [a, v] of attrs) if (!has(a, v)) return false;
      for (const [a, v] of nots) if (has(a, v)) return false;
      return true;
    });
  }

  const win = { listeners: {} };
  doc = {
    nodeType: 9,
    createElement: (t) => new Element(t),
    createElementNS: (ns, t) => new Element(t, ns),
    createTextNode: (t) => new Text(t),
    createComment: (t) => new Comment(t),
    activeElement: null,
    visibilityState: 'visible',
    listeners: {},
    addEventListener(t, f) { (this.listeners[t] || (this.listeners[t] = new Set())).add(f); },
    removeEventListener(t, f) { if (this.listeners[t]) this.listeners[t].delete(f); },
    execCommand: () => false,
  };
  doc.documentElement = new Element('html');
  doc.body = new Element('body');
  doc.documentElement.appendChild(doc.body);
  doc.activeElement = doc.body;
  Object.defineProperty(doc.body, 'offsetHeight', { get: () => 0 });
  doc.getElementById = (id) => { let f = null; walk(doc.documentElement, (n) => { if (!f && n.nodeType === 1 && n.getAttribute('id') === id) f = n; }); return f; };
  doc.querySelector = (sel) => doc.documentElement.querySelector(sel);
  doc.querySelectorAll = (sel) => doc.documentElement.querySelectorAll(sel);
  doc.contains = (n) => doc.documentElement.contains(n);
  win.addEventListener = (t, f) => { (win.listeners[t] || (win.listeners[t] = new Set())).add(f); };
  win.removeEventListener = (t, f) => { if (win.listeners[t]) win.listeners[t].delete(f); };
  return { doc, win, Element, walk, matches };
}

module.exports = { makeDom };
