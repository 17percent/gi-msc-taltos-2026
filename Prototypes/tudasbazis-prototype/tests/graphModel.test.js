/* graphModel.test.js — topológia, kezdő pozíció és BFS-szomszédság (D28, D-3). */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./_harness.js');

// a vm-kontextus tömbjei más realmből jönnek → főrealm-tömbbé alakítjuk az összevetéshez
function idsOf(nodes) { return Array.from(nodes, (x) => x.id).sort(); }

function adjacency(edges) {
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, new Set());
    if (!adj.has(e.target)) adj.set(e.target, new Set());
    adj.get(e.source).add(e.target);
    adj.get(e.target).add(e.source);
  }
  return adj;
}

// független referencia-BFS az élekből
function refBfs(adj, start, depth) {
  const dist = new Map([[start, 0]]);
  let frontier = [start];
  for (let d = 1; d <= depth; d++) {
    const next = [];
    for (const u of frontier) for (const v of (adj.get(u) || [])) if (!dist.has(v)) { dist.set(v, d); next.push(v); }
    frontier = next;
  }
  return dist;
}

test('a kezdő x,y determinisztikus és véges (phyllotaxis, nincs klaszter-geometria)', () => {
  const a = H.loadModel().getOverview();
  const b = H.loadModel().getOverview();
  assert.equal(a.nodes.length, b.nodes.length);
  for (let i = 0; i < a.nodes.length; i++) {
    assert.ok(Number.isFinite(a.nodes[i].x) && Number.isFinite(a.nodes[i].y));
    assert.ok(Object.is(a.nodes[i].x, b.nodes[i].x) && Object.is(a.nodes[i].y, b.nodes[i].y));
    assert.equal(a.nodes[i].r, 10, 'egységes méret (D-2)');
  }
  // phyllotaxis: a sugár √(0,5 + k)·10 — a legtávolabbi pont ennyin belül van
  const maxR = Math.max(...a.nodes.map((n) => Math.hypot(n.x, n.y)));
  assert.ok(maxR <= 10 * Math.sqrt(0.5 + a.nodes.length) + 1e-9);
});

test('getNeighborhood BFS: mélység 1 = a csomópont + közvetlen szomszédai', () => {
  const model = H.loadModel();
  const ov = model.getOverview();
  const adj = adjacency(ov.edges);
  let checked = 0;
  for (const n of ov.nodes) {
    const res = model.getNeighborhood(n.id, { depth: 1 });
    const got = new Set(res.nodes.map((x) => x.id));
    const want = refBfs(adj, n.id, 1);
    assert.deepEqual([...got].sort(), [...want.keys()].sort(), 'mélység 1: ' + n.id);
    for (const [id, d] of want) assert.equal(res.depthOf[id], d);
    checked++;
  }
  assert.ok(checked > 10);
  // alapértelmezés = 1
  const first = ov.nodes[0].id;
  assert.deepEqual(idsOf(model.getNeighborhood(first).nodes),
                   idsOf(model.getNeighborhood(first, { depth: 1 }).nodes));
});

test('getNeighborhood BFS: mélység 2 = kétlépésnyi környezet, a távolságokkal', () => {
  const model = H.loadModel();
  const ov = model.getOverview();
  const adj = adjacency(ov.edges);
  let grew = 0;
  for (const n of ov.nodes) {
    const res = model.getNeighborhood(n.id, { depth: 2 });
    const want = refBfs(adj, n.id, 2);
    assert.deepEqual(idsOf(res.nodes), [...want.keys()].sort(), 'mélység 2: ' + n.id);
    for (const [id, d] of want) assert.equal(res.depthOf[id], d);
    if (want.size > refBfs(adj, n.id, 1).size) grew++;
    // az élek a halmazon belül maradnak
    const inSet = new Set(res.nodes.map((x) => x.id));
    for (const e of res.edges) assert.ok(inSet.has(e.source) && inSet.has(e.target));
  }
  assert.ok(grew > 0, 'legalább egy csomópontnál a 2. kör bővít');
});

test('getNeighborhood: a szűrőből kiesett csomópont inert, rajta át nem vezet út', () => {
  const model = H.loadModel();
  const ov = model.getOverview();
  const cat = ov.nodes[0].tags[0];
  const facet = model.applyFacets({ categories: [cat] });
  assert.ok(facet.active);
  const active = new Set(facet.nodeIds);
  const res = model.getNeighborhood(ov.nodes[0].id, { depth: 3 });
  for (const nd of res.nodes) assert.ok(active.has(nd.id), 'csak aktív csomópont: ' + nd.id);
  model.applyFacets({});
});

test('getNeighborhood: ismeretlen id → áttekintés, mélység a tartományba vágva', () => {
  const model = H.loadModel();
  assert.equal(model.getNeighborhood('nincs-ilyen').nodes.length, model.getOverview().nodes.length);
  const id = model.getOverview().nodes[0].id;
  assert.deepEqual(idsOf(model.getNeighborhood(id, { depth: 0 }).nodes),
                   idsOf(model.getNeighborhood(id, { depth: 1 }).nodes));
  assert.ok(model.getNeighborhood(id, { depth: 99 }).nodes.length <= 150);
});
