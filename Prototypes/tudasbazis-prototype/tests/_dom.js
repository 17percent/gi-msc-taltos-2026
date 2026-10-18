/* _dom.js — közös tesztsegéd (NEM teszt): minimális DOM-csonk + az `atlasView` felcsatolása.
 *
 * Csak Node beépített modulokkal; nincs npm / jsdom. A csonk pontosan annyit tud, amit az
 * `atlasView.js` használ: egy kis HTML-értelmező (template.innerHTML), egyszerű szelektorok
 * (`tag.class[attr="v"]` + szóközös leszármazott), buborékozó események (stopPropagation),
 * dataset, hidden, focus-napló, animate-napló.
 *
 * Ami VALÓDI: graphModel, forceSim, atlasRenderer (spy-burkolóval), selectionStore,
 * atlasMachine, atlasView. Ami CSONK: createConstellation (ambient mező) és
 * createResultsList (a lista — csak a kapott tételeket rögzíti), a DOM, az időzítők
 * (kézi óra) és a rAF (kézi sor).
 */
'use strict';

const H = require('./_harness.js');

// ---------- kézi időzítők ----------
function makeTimers() {
  let now = 0, seq = 1, q = [];
  return {
    setTimeout(fn, ms) { const id = seq++; q.push({ id, at: now + (ms || 0), fn }); return id; },
    clearTimeout(id) { q = q.filter((t) => t.id !== id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        q.sort((a, b) => a.at - b.at || a.id - b.id);
        const nxt = q[0];
        if (!nxt || nxt.at > end) break;
        q.shift(); now = nxt.at; nxt.fn();
      }
      now = end;
    },
    pending() { return q.length; }
  };
}

// ---------- HTML-értelmező ----------
const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
function decode(s) { return s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT[m]); }

function parseInto(doc, parent, html) {
  const tokRe = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  const attrRe = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  const stack = [parent];
  let m;
  while ((m = tokRe.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[1]) {                                   // záró tag
      const tag = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]._tag === tag) { stack.length = i; break; }
      }
    } else if (m[2]) {                            // nyitó tag
      const el = new El(doc, m[2]);
      let a;
      attrRe.lastIndex = 0;
      while ((a = attrRe.exec(m[3] || ''))) {
        el.attrs[a[1]] = a[2] != null ? decode(a[2]) : a[3] != null ? decode(a[3]) : a[4] != null ? decode(a[4]) : '';
      }
      top._append(el);
      if (!m[4] && !VOID.has(el._tag)) stack.push(el);
    } else if (m[5] != null) {                    // szöveg
      top._append({ nodeType: 3, data: decode(m[5]), parentNode: null });
    }
  }
}

// ---------- szelektor ----------
function parseCompound(s) {
  const c = { tag: null, classes: [], attrs: [], id: null };
  const re = /^([a-zA-Z][\w-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:=("([^"]*)"|'([^']*)'|([^\]]*)))?\]/;
  let rest = s, m;
  while (rest) {
    m = re.exec(rest);
    if (!m) throw new Error('nem támogatott szelektor: ' + s);
    if (m[1]) c.tag = m[1].toLowerCase();
    else if (m[2]) c.classes.push(m[2]);
    else if (m[3]) c.id = m[3];
    else if (m[4]) c.attrs.push({ n: m[4], v: m[6] != null ? m[6] : m[7] != null ? m[7] : m[8] != null ? m[8] : null });
    rest = rest.slice(m[0].length);
  }
  return c;
}
function matchCompound(el, c) {
  if (el.nodeType !== 1) return false;
  if (c.tag && el._tag !== c.tag) return false;
  if (c.id && el.attrs.id !== c.id) return false;
  for (const k of c.classes) if (!el.classList.contains(k)) return false;
  for (const a of c.attrs) {
    if (!(a.n in el.attrs)) return false;
    if (a.v != null && el.attrs[a.n] !== a.v) return false;
  }
  return true;
}
function matchesSel(el, sel) {
  const parts = sel.trim().split(/\s+/).map(parseCompound);
  if (!matchCompound(el, parts[parts.length - 1])) return false;
  let node = el.parentNode;
  for (let i = parts.length - 2; i >= 0; i--) {
    while (node && !matchCompound(node, parts[i])) node = node.parentNode;
    if (!node) return false;
    node = node.parentNode;
  }
  return true;
}

// ---------- elemek ----------
class El {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this._tag = String(tag).toLowerCase();
    this.tagName = this._tag.toUpperCase();
    this.nodeName = this.tagName;
    this.nodeType = 1;
    this.attrs = {};
    this.children = [];        // elemek ÉS szövegek
    this.parentNode = null;
    this.listeners = {};
    this.style = {};
    this._value = null;
    this._checked = false;
    this._content = null;
    const self = this;
    this.classList = {
      contains(k) { return (self.attrs.class || '').split(/\s+/).indexOf(k) > -1; },
      add(k) { if (!this.contains(k)) self.attrs.class = ((self.attrs.class || '') + ' ' + k).trim(); },
      remove(k) { self.attrs.class = (self.attrs.class || '').split(/\s+/).filter((x) => x && x !== k).join(' '); }
    };
    this.dataset = new Proxy({}, {
      get(_, k) { const n = 'data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()); return n in self.attrs ? self.attrs[n] : undefined; },
      set(_, k, v) { self.attrs['data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())] = String(v); return true; },
      deleteProperty(_, k) { delete self.attrs['data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())]; return true; }
    });
  }
  _append(node) {
    if (node.parentNode && node.parentNode.children) {
      const i = node.parentNode.children.indexOf(node);
      if (i > -1) node.parentNode.children.splice(i, 1);
    }
    node.parentNode = this; this.children.push(node);
  }
  appendChild(n) { this._append(n); return n; }
  removeChild(n) {
    const i = this.children.indexOf(n);
    if (i > -1) this.children.splice(i, 1);
    n.parentNode = null; return n;
  }
  get firstElementChild() { return this.children.find((c) => c.nodeType === 1) || null; }
  get content() { return this._content; }
  get textContent() { return this.children.map((c) => (c.nodeType === 3 ? c.data : c.textContent)).join(''); }
  set textContent(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._append({ nodeType: 3, data: String(v), parentNode: null }); }
  set innerHTML(html) {
    if (this._tag === 'template') {
      this._content = new El(this.ownerDocument, 'fragment');
      parseInto(this.ownerDocument, this._content, html);
      return;
    }
    this.children.forEach((c) => { c.parentNode = null; });
    this.children = [];
    parseInto(this.ownerDocument, this, html);
  }
  get innerHTML() { return this.textContent; }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  hasAttribute(n) { return n in this.attrs; }
  removeAttribute(n) { delete this.attrs[n]; }
  get hidden() { return 'hidden' in this.attrs; }
  set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  get id() { return this.attrs.id || ''; }
  get value() { return this._value != null ? this._value : (this.attrs.value != null ? this.attrs.value : ''); }
  set value(v) { this._value = String(v); }
  get checked() { return this._checked; }
  set checked(v) { this._checked = !!v; }
  get disabled() { return 'disabled' in this.attrs; }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  matches(sel) { return matchesSel(this, sel); }
  closest(sel) { for (let x = this; x && x.nodeType === 1; x = x.parentNode) if (matchesSel(x, sel)) return x; return null; }
  querySelectorAll(sel) {
    const out = [];
    (function walk(n) { n.children.forEach((c) => { if (c.nodeType === 1) { if (matchesSel(c, sel)) out.push(c); walk(c); } }); })(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
  listenerCount() { return Object.keys(this.listeners).reduce((n, k) => n + this.listeners[k].length, 0); }
  dispatchEvent(ev) {
    ev.type = ev.type || 'event';
    ev.target = this;
    let stopped = false;
    if (!ev.preventDefault) { ev.defaultPrevented = false; ev.preventDefault = () => { ev.defaultPrevented = true; }; }
    ev.stopPropagation = () => { stopped = true; };
    ev.propagationStopped = () => stopped;
    const path = [];
    for (let x = this; x; x = x.parentNode) path.push(x);
    path.push(this.ownerDocument);
    for (const node of path) {
      ev.currentTarget = node;
      (node.listeners[ev.type] || []).slice().forEach((fn) => fn(ev));
      if (stopped) break;
    }
    return !ev.defaultPrevented;
  }
  focus() { this.ownerDocument.activeElement = this; this.ownerDocument.focusLog.push(this); }
  getBoundingClientRect() {
    if (this._tag === 'canvas') {
      const s = this.ownerDocument.canvasSize;
      return { left: 0, top: 0, width: s.w, height: s.h, right: s.w, bottom: s.h };
    }
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  }
  getContext() { return (this._ctx2d = this._ctx2d || H.fakeCtx2d()); }
  get ctx2d() { return this._ctx2d; }
  get offsetWidth() { return 0; }
  get offsetHeight() { return 0; }
  animate(keyframes, opts) {
    this.ownerDocument.animations.push({ el: this, keyframes, opts });
    return { cancel() {}, finished: Promise.resolve() };
  }
  scrollIntoView() {}
  setPointerCapture() {}
  releasePointerCapture() {}
}

class Doc {
  constructor() {
    this.listeners = {};
    this.focusLog = [];
    this.animations = [];
    this.canvasSize = { w: 800, h: 600 };
    this.hidden = false;
    this.activeElement = null;
    this.nodeType = 9;
    this.documentElement = new El(this, 'html');
    this.body = new El(this, 'body');
    this.documentElement._append(this.body);
  }
  createElement(tag) { return new El(this, tag); }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
  listenerCount() { return Object.keys(this.listeners).reduce((n, k) => n + this.listeners[k].length, 0); }
}

// ---------- az atlasView felcsatolása ----------
// opts: { reducedMotion, docs (nyers dok-lista) | docCount, storage ('throwing' | objektum | null),
//         seed, canvas:{w,h}, favoriteIds }
function mountView(opts) {
  opts = opts || {};
  const timers = makeTimers();
  const raf = H.makeRaf();
  const doc = new Doc();
  if (opts.canvas) doc.canvasSize = opts.canvas;
  const winListeners = {};
  const cssVars = Object.assign({}, opts.cssVars || {});
  const sandbox = {
    document: doc,
    devicePixelRatio: 1,
    innerWidth: 1280, innerHeight: 800,
    requestAnimationFrame: raf.requestAnimationFrame,
    cancelAnimationFrame: raf.cancelAnimationFrame,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    getComputedStyle() { return { fontSize: '16px', getPropertyValue(n) { return cssVars[n] || ''; } }; },
    addEventListener(t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
    removeEventListener(t, fn) { winListeners[t] = (winListeners[t] || []).filter((f) => f !== fn); }
  };
  if (opts.storage && opts.storage !== 'throwing-getter') sandbox.localStorage = opts.storage;
  const ctx = H.makeContext(sandbox);
  if (opts.storage === 'throwing-getter') {
    // a getter a már létrejött kontextus-globálison él (az Object.assign nem hívná meg)
    Object.defineProperty(ctx, 'localStorage', { get() { throw new Error('SecurityError'); }, configurable: true });
  }
  ['home/graphModel.js', 'home/forceSim.js', 'home/atlasRenderer.js', 'home/selectionStore.js',
    'home/atlasMachine.js', 'home/atlasView.js'].forEach((f) => H.load(ctx, f));

  // --- spy: a valódi renderer, burkolva (hívások + opts rögzítve)
  const rec = { calls: [], opts: null, renderer: null, canvas: null, created: 0 };
  const realCreate = ctx.createAtlasRenderer;
  ctx.createAtlasRenderer = function (canvas, o) {
    const r = realCreate(canvas, o);
    rec.opts = o; rec.canvas = canvas; rec.renderer = r; rec.created++;
    const w = {};
    Object.keys(r).forEach((k) => {
      w[k] = function () {
        rec.calls.push({ m: k, args: Array.prototype.slice.call(arguments) });
        return r[k].apply(null, arguments);
      };
    });
    return w;
  };
  rec.of = (m) => rec.calls.filter((c) => c.m === m);
  rec.last = (m) => { const a = rec.of(m); return a.length ? a[a.length - 1] : null; };
  rec.clear = () => { rec.calls.length = 0; };

  // --- csonkok: ambient mező + lista
  const field = { calls: [] };
  ctx.createConstellation = function () {
    const o = {};
    ['applySnapshot', 'setMode', 'start', 'stop', 'resize', 'refreshColors', 'destroy'].forEach((k) => {
      o[k] = function () { field.calls.push(k); };
    });
    return o;
  };
  const list = { sets: [], destroyed: false, count: 0 };
  ctx.createResultsList = function () {
    return {
      setItems(items, o) { list.sets.push({ ids: Array.from(items, (i) => i.id), query: o && o.query }); list.count = items.length; },
      destroy() { list.destroyed = true; },
      focusList() {},
      get count() { return list.count; }
    };
  };
  list.last = () => list.sets[list.sets.length - 1];

  const raw = opts.docs ? null : H.seedRaw({ docCount: opts.docCount || 56, seed: opts.seed });
  const docs = opts.docs || raw.docs;
  const data = {
    docs: docs,
    categories: opts.categories || (raw ? raw.categories : []),
    users: opts.users || (raw ? raw.users : []),
    currentUserId: opts.currentUserId || (raw ? raw.currentUserId : null),
    statuses: Array.from(new Set(docs.map((d) => d.status))),
    favoriteIds: opts.favoriteIds || []
  };
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const cbCalls = [];
  const handle = ctx.mountAtlas(container, {
    data: data,
    helpers: { esc: (s) => String(s) },
    callbacks: { onOpenDoc: (id) => cbCalls.push(['open', id]), onNew: () => cbCalls.push(['new']) },
    reducedMotion: !!opts.reducedMotion
  });

  const root = container.querySelector('.atlas');
  const api = {
    ctx, doc, timers, raf, rec, field, cssVars, list, data, handle, root, container, cbCalls, winListeners,
    q: (sel) => root.querySelector(sel),
    qa: (sel) => root.querySelectorAll(sel),
    slider: (key) => root.querySelector('input[data-set="' + key + '"]'),
    out: (key) => root.querySelector('[data-out="' + key + '"]'),
    toggle: () => root.querySelector('[data-act="toggle-settings"]'),
    panel: () => root.querySelector('.atlas__settings'),
    // a boot (READY) + a képkockák lefuttatása
    settle() { timers.advance(1000); raf.pump(5000); },
    // csúszka mozgatása: input (+ change, mint egy elengedett húzás)
    moveSlider(key, v, o) {
      const s = api.slider(key);
      s.value = String(v);
      s.dispatchEvent({ type: 'input' });
      if (!o || o.commit !== false) s.dispatchEvent({ type: 'change' });
    },
    key(el, k) { const ev = { type: 'keydown', key: k }; el.dispatchEvent(ev); return ev; },
    pointer(type, x, y, extra) {
      rec.canvas.dispatchEvent(Object.assign({ type, clientX: x, clientY: y, button: 0, pointerId: 1 }, extra || {}));
    },
    flush() { api.settle(); },
    dbg() { return rec.renderer.getDebugState(); }
  };
  // a csonk-kanvasz eseményei: a `dispatchEvent` a csonk elemen fut (nem `dispatch`)
  return api;
}

// memória-tároló (localStorage-szerű)
function memStorage(initial) {
  const m = new Map(initial || []);
  const st = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { st.writes.push([k, String(v)]); m.set(k, String(v)); },
    writes: [], m
  };
  return st;
}

module.exports = { mountView, memStorage, makeTimers, El, Doc };
