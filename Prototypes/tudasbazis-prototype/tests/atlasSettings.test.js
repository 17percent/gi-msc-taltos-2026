/* atlasSettings.test.js — a „Megjelenítés és erők" beállítás-tároló (localStorage). */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./_harness.js');

function loadStore() {
  const ctx = H.makeContext();
  H.load(ctx, 'home/forceSim.js');
  H.load(ctx, 'home/atlasView.js');
  return { S: ctx.mountAtlas.settingsStore, ctx };
}

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}

test('alapértékek: az Obsidian-alapok + T = 0 + mélység 1', () => {
  const { S } = loadStore();
  const d = S.defaults();
  assert.deepEqual(JSON.parse(JSON.stringify(d)),
    { center: 0.52, repel: 10, linkStrength: 1, linkDistance: 250, labels: 0, depth: 1 });
  const f = S.forcesOf(d);
  assert.equal(f.repelStrength, 1000);
  assert.equal(f.linkDistance, 250);
});

test('mentés + visszatöltés, tartományba vágás, hibás tartalom → alapérték', () => {
  const { S } = loadStore();
  const st = memStorage();
  const s = S.defaults(); s.repel = 14; s.depth = 3; s.labels = -1.5;
  assert.equal(S.save(st, s), true);
  const back = S.load(st);
  assert.equal(back.repel, 14); assert.equal(back.depth, 3); assert.equal(back.labels, -1.5);
  st.setItem(S.KEY, JSON.stringify({ v: 1, repel: 99, depth: 2.6, center: 'x' }));
  const c = S.load(st);
  assert.equal(c.repel, 20); assert.equal(c.depth, 3); assert.equal(c.center, 0.52);
  st.setItem(S.KEY, '{nem json');
  assert.equal(S.load(st).repel, 10);
  st.setItem(S.KEY, JSON.stringify({ v: 999, repel: 3 }));
  assert.equal(S.load(st).repel, 10, 'ismeretlen verzió → alapértékek');
});

test('localStorage nélkül (null vagy kivételt dobó tároló) is működik', () => {
  const { S } = loadStore();
  const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };
  assert.equal(S.load(null).repel, 10);
  assert.equal(S.load(throwing).repel, 10);
  assert.equal(S.save(null, S.defaults()), false);
  assert.equal(S.save(throwing, S.defaults()), false);
});
