/* _harness.js — közös tesztsegéd (NEM teszt: a név nem illik a node --test mintáira).
 *
 * Csak Node beépített modulokkal (node:vm, node:fs, node:path): nincs npm, nincs
 * package.json. A prototípus classic `(function (global) {...})(window)` moduljait
 * egy vm-kontextusba tölti, ahol a `window` maga a kontextus globálisa.
 *
 * A rendererhez kanvasz/ctx/document csonkot és KÉZZEL pumpált rAF-sort ad;
 * a `setTimeout` valódi marad (a renderer belső debounce-a így igazi időzítéssel fut).
 */
'use strict';

const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FIXED_NOW = Date.UTC(2026, 9, 18, 9, 0, 0);   // rögzített „most": determinisztikus korpusz

function makeContext(extra) {
  const sandbox = Object.assign({
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Math, Date, JSON, Object, Array, String, Number, Boolean, Error,
    Float32Array, Float64Array, Int32Array, Uint8Array, Uint16Array, Uint32Array,
    URLSearchParams
  }, extra || {});
  const ctx = vm.createContext(sandbox);
  ctx.window = ctx;
  return ctx;
}

function load(ctx, rel) {
  const file = path.join(ROOT, rel);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
}

// A seed-korpusz (ugyanaz a generátor, amit a prototípus használ), rögzített idővel.
function seedRaw(opts) {
  opts = opts || {};
  const ctx = makeContext();
  load(ctx, 'seedGenerator.js');
  const seed = ctx.generateSeed({ seed: opts.seed || 20260822, docCount: opts.docCount || 56, now: FIXED_NOW });
  const docs = seed.docs.map(function (d) {
    return {
      id: d.id, title: d.title, categories: d.categories || [],
      ownerId: d.ownerId, authorIds: d.authorIds || [],
      updatedAt: d.updatedAt, status: d.status,
      isTemplate: !!d.isTemplate, iteration: d.iteration, text: d.text || '',
      deletedAt: d.deletedAt || null
    };
  });
  return { docs: docs, categories: seed.categories, users: seed.users, currentUserId: seed.users[0] && seed.users[0].id, now: FIXED_NOW };
}

function loadModel(raw) {
  const ctx = makeContext();
  load(ctx, 'home/graphModel.js');
  return ctx.createGraphModel(raw || seedRaw(), { tier: 0 });
}

function loadForceSim() {
  const ctx = makeContext();
  load(ctx, 'home/forceSim.js');
  return ctx.createForceSim;
}

// ---------- renderer-csonk ----------
function fakeCtx2d() {
  const calls = { arc: 0, arcs: [], fillText: [] };
  const ctx = {
    calls,
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    setTransform() {}, clearRect() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {},
    stroke() {}, fill() {}, drawImage() {},
    arc(x, y, r) { calls.arc++; calls.arcs.push({ x, y, r, alpha: ctx.globalAlpha, fill: ctx.fillStyle }); },
    fillText(t, x, y) { calls.fillText.push({ text: t, x, y, alpha: ctx.globalAlpha, font: ctx.font }); },
    measureText(t) { return { width: String(t).length * 6 }; },
    createLinearGradient() { return { addColorStop() {} }; }
  };
  return ctx;
}

function fakeCanvas(w, h) {
  const listeners = {};
  const ctx2d = fakeCtx2d();
  return {
    width: 0, height: 0, style: {},
    ctx2d,
    getContext() { return ctx2d; },
    getBoundingClientRect() { return { left: 0, top: 0, width: w, height: h, right: w, bottom: h }; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    dispatch(type, ev) { (listeners[type] || []).slice().forEach((fn) => fn(Object.assign({ preventDefault() {} }, ev))); },
    setPointerCapture() {}, releasePointerCapture() {}
  };
}

// Kézi rAF-sor: a teszt dönti el, mikor és mekkora időlépéssel fut egy képkocka.
function makeRaf() {
  let queue = [], nextId = 1, now = 1000;
  return {
    requestAnimationFrame(fn) { const id = nextId++; queue.push({ id, fn }); return id; },
    cancelAnimationFrame(id) { queue = queue.filter((q) => q.id !== id); },
    pending() { return queue.length; },
    // egy képkocka `dt` ms-mal; visszaad: futott-e valami
    frame(dt) {
      now += dt == null ? 16.67 : dt;
      const q = queue; queue = [];
      q.forEach((item) => item.fn(now));
      return q.length > 0;
    },
    // pumpálás, amíg van kérés (vagy elérjük a sapkát); visszaad: a futott képkockák száma
    pump(maxFrames, dt) {
      let n = 0;
      while (queue.length && n < (maxFrames || 10000)) { this.frame(dt); n++; }
      return n;
    }
  };
}

function loadRenderer(opts) {
  opts = opts || {};
  const raf = makeRaf();
  const docListeners = {};
  const cssVars = opts.cssVars || {};
  const documentElement = { nodeName: 'HTML' };
  const document = {
    hidden: false,
    documentElement,
    createElement() { return fakeCanvas(64, 64); },
    addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
    removeEventListener() {}
  };
  const ctx = makeContext({
    document,
    devicePixelRatio: 1,
    requestAnimationFrame: raf.requestAnimationFrame,
    cancelAnimationFrame: raf.cancelAnimationFrame,
    // CSS-változók csonkja: `opts.cssVars` (pl. { '--text-xs': '.75rem' }), a gyökér
    // betűmérete `opts.rootFontSize` (alap: 16px)
    getComputedStyle(el) {
      return {
        fontSize: el === documentElement ? (opts.rootFontSize || '16px') : '',
        getPropertyValue(name) { return cssVars[name] || ''; }
      };
    }
  });
  load(ctx, 'home/forceSim.js');
  load(ctx, 'home/atlasRenderer.js');
  const canvas = fakeCanvas(opts.width || 800, opts.height || 600);
  const hovers = [], selects = [];
  const renderer = ctx.createAtlasRenderer(canvas, Object.assign({
    intensity: 'balanced',
    reducedMotion: !!opts.reducedMotion,
    onHover: (id) => hovers.push(id),
    onSelect: (id) => selects.push(id)
  }, opts.rendererOptions || {}));
  return { ctx, renderer, canvas, raf, hovers, selects, createAtlasRenderer: ctx.createAtlasRenderer, createForceSim: ctx.createForceSim };
}

module.exports = { ROOT, FIXED_NOW, makeContext, load, seedRaw, loadModel, loadForceSim, loadRenderer, makeRaf, fakeCtx2d, fakeCanvas };
