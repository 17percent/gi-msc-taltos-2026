/* forceSim.test.js — az erő-szimuláció (D28) tesztjei. Futtatás:
 *   node --test Prototypes/tudasbazis-prototype/tests/
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./_harness.js');

const createForceSim = H.loadForceSim();
const NODE_R = 10;

function seedGraph() {
  const model = H.loadModel();
  const ov = model.getOverview();
  return {
    model,
    nodes: ov.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
    edges: ov.edges.map((e) => ({ source: e.source, target: e.target })),
    raw: ov
  };
}

function minPairDistance(sim) {
  const p = sim.positions, n = sim.count;
  let min = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(p[2 * i] - p[2 * j], p[2 * i + 1] - p[2 * j + 1]);
      if (d < min) min = d;
    }
  }
  return min;
}

test('csúszka → paraméter leképezés (spec §1.2)', () => {
  const map = createForceSim.sliderToParams;
  // középre húzás: s ≈ 0,52 → p ≈ 0,1
  assert.ok(Math.abs(map({ center: 0.52 }).centerStrength - 0.1) < 0.002, 'center s=0.52 → ≈0.1');
  assert.equal(map({ center: 0 }).centerStrength, 0);
  assert.ok(Math.abs(map({ center: 1 }).centerStrength - 1) < 1e-12);
  // taszítás: P = s³ (min. 1)
  assert.equal(map({ repel: 10 }).repelStrength, 1000);
  assert.equal(map({ repel: 0 }).repelStrength, 1);
  assert.equal(map({ repel: 0.5 }).repelStrength, 1);
  assert.equal(map({ repel: 20 }).repelStrength, 8000);
  // kapcsolatok ereje: ugyanaz az exponenciális görbe, s = 1 → 1
  assert.ok(Math.abs(map({ linkStrength: 1 }).linkStrength - 1) < 1e-12);
  assert.ok(Math.abs(map({ linkStrength: 0.52 }).linkStrength - 0.1) < 0.002);
  // kapcsolat hossza: közvetlenül, 30–500 közé vágva
  assert.equal(map({ linkDistance: 250 }).linkDistance, 250);
  assert.equal(map({ linkDistance: 5 }).linkDistance, 30);
  assert.equal(map({ linkDistance: 900 }).linkDistance, 500);
  // alapértékek → az Obsidian-alapok
  const d = map(createForceSim.DEFAULT_SLIDERS);
  assert.ok(Math.abs(d.centerStrength - 0.1) < 0.002);
  assert.equal(d.repelStrength, 1000);
  assert.ok(Math.abs(d.linkStrength - 1) < 1e-12);
  assert.equal(d.linkDistance, 250);
});

test('konstansok a spec szerint', () => {
  const C = createForceSim.CONSTANTS;
  assert.equal(C.ALPHA_MIN, 0.001);
  assert.ok(Math.abs(C.ALPHA_DECAY - 0.0228) < 0.0001);
  assert.ok(Math.abs(C.ALPHA_DECAY - (1 - Math.pow(0.001, 1 / 300))) < 1e-15);
  assert.equal(C.VELOCITY_KEEP, 0.6);
  assert.equal(C.COLLIDE_R, 60);
  assert.equal(C.COLLIDE_STRENGTH, 0.5);
  assert.equal(C.ALPHA_REHEAT, 0.3);
});

test('konvergencia: α < 0,001 véges (≈300) lépésben, utána nem lép', () => {
  const g = seedGraph();
  const sim = createForceSim({ nodes: g.nodes, edges: g.edges });
  assert.equal(sim.alpha(), 1);
  const steps = sim.settle(5000);
  assert.ok(steps <= 310, 'legfeljebb ~300 lépés kell, ennyi lett: ' + steps);
  assert.ok(sim.alpha() < 0.001);
  assert.ok(sim.isSettled());
  assert.equal(sim.tick(10), 0, 'kihűlt szimuláció nem lép');
  // felmelegítés 0,3-ra → ≈250 lépés alatt újra kihűl (≈4 s @ 60 Hz)
  sim.reheat(0.3);
  assert.equal(sim.alpha(), 0.3);
  const again = sim.settle(5000);
  assert.ok(again > 200 && again < 260, 'reheat utáni lépések: ' + again);
  // a reheat nem csökkent
  sim.reheat(0.3); sim.tick(1); const a = sim.alpha(); sim.reheat(0.1);
  assert.equal(sim.alpha(), a);
});

test('determinizmus: két futás bitre azonos pozíciót ad', () => {
  const g1 = seedGraph(), g2 = seedGraph();
  const s1 = createForceSim({ nodes: g1.nodes, edges: g1.edges });
  const s2 = createForceSim({ nodes: g2.nodes, edges: g2.edges });
  s1.settle(); s2.settle();
  assert.equal(s1.count, s2.count);
  for (let i = 0; i < s1.positions.length; i++) {
    assert.ok(Object.is(s1.positions[i], s2.positions[i]), 'eltérés az ' + i + '. koordinátán');
  }
  // pozíció nélküli csomópontok (phyllotaxis) is determinisztikusak
  const bare = g1.nodes.map((n) => ({ id: n.id }));
  const b1 = createForceSim({ nodes: bare, edges: g1.edges }); b1.settle();
  const b2 = createForceSim({ nodes: bare, edges: g1.edges }); b2.settle();
  assert.ok(Buffer.compare(Buffer.from(b1.positions.buffer), Buffer.from(b2.positions.buffer)) === 0);
});

test('nyugalomban nincs átfedés a seed-korpuszon', (t) => {
  const g = seedGraph();
  const sim = createForceSim({ nodes: g.nodes, edges: g.edges });
  sim.settle();
  const min = minPairDistance(sim);
  t.diagnostic('legkisebb középpont-távolság: ' + min.toFixed(2) + ' (ütközési átmérő 120, 2·NODE_R = 20)');
  assert.ok(min >= 2 * NODE_R, 'a körök (NODE_R=10) nem érnek össze');
  assert.ok(min >= 120 * 0.95, 'az ütközés-erő nyugalomban ~120 egységre tartja a középpontokat');
});

test('kategória-szerkezet az alap-paraméterekkel (D-1 kockázat mérése)', (t) => {
  const g = seedGraph();
  const sim = createForceSim({ nodes: g.nodes, edges: g.edges });
  sim.settle();
  const p = sim.positions;
  let si = 0, ci = 0, so = 0, co = 0;
  const nodes = g.raw.nodes;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = sim.indexOf(nodes[i].id), b = sim.indexOf(nodes[j].id);
      const d = Math.hypot(p[2 * a] - p[2 * b], p[2 * a + 1] - p[2 * b + 1]);
      if (nodes[i].tags[0] === nodes[j].tags[0]) { si += d; ci++; } else { so += d; co++; }
    }
  }
  const intra = si / ci, inter = so / co;
  t.diagnostic('átlagos távolság — azonos elsődleges kategórián belül: ' + intra.toFixed(0) +
               ', kategóriák között: ' + inter.toFixed(0) + ', arány: ' + (intra / inter).toFixed(2));
  // Nem kategória-erő, csak az élek (közös kategória) hatása: a tagok közelebb vannak
  assert.ok(intra < inter * 0.8, 'a kategóriák nem szóródnak szét teljesen');
});

test('rögzítés (pin/húzás): a rögzített csomópont a helyén marad, a szimuláció meleg', () => {
  const g = seedGraph();
  const sim = createForceSim({ nodes: g.nodes, edges: g.edges });
  sim.settle();
  const id = g.nodes[0].id, k = sim.indexOf(id);
  assert.ok(sim.pin(id, 777, -333));
  assert.equal(sim.positions[2 * k], 777);
  assert.equal(sim.positions[2 * k + 1], -333);
  const ran = sim.tick(600);
  assert.equal(ran, 600, 'rögzítés alatt nem hűl ki (αTarget = 0,3)');
  assert.ok(sim.alpha() > 0.25);
  assert.equal(sim.positions[2 * k], 777);
  assert.equal(sim.positions[2 * k + 1], -333);
  assert.ok(sim.isPinned(id));
  // húzás közben is mozgatható
  sim.pin(id, 800, -300); sim.tick(5);
  assert.equal(sim.positions[2 * k], 800);
  // elengedés: kihűl, és a csomópont már szabadon mozog
  assert.ok(sim.unpin(id));
  assert.ok(!sim.isPinned(id));
  const steps = sim.settle(5000);
  assert.ok(steps > 0 && steps < 400, 'elengedés után megnyugszik: ' + steps);
  assert.ok(sim.isSettled());
});

test('új csomópont a már elhelyezett szomszédai mellé kerül', () => {
  const sim = createForceSim({
    nodes: [{ id: 'a', x: 1000, y: 1000 }, { id: 'b', x: 1100, y: 1000 }, { id: 'c' }, { id: 'lonely' }],
    edges: [{ source: 'c', target: 'a' }, { source: 'c', target: 'b' }],
    alpha: 0
  });
  const p = sim.positions, c = sim.indexOf('c'), l = sim.indexOf('lonely');
  assert.ok(Math.abs(p[2 * c] - 1050) <= 30 && Math.abs(p[2 * c + 1] - 1000) <= 30, 'szomszéd-átlag ± szórás');
  const rl = Math.hypot(p[2 * l], p[2 * l + 1]);
  assert.ok(rl > Math.hypot(1100, 1000), 'szomszéd nélkül a meglévő elrendezésen kívül');
});

test('setParams nem melegít fel magától; az erők a paramétert követik', () => {
  const g = seedGraph();
  const sim = createForceSim({ nodes: g.nodes, edges: g.edges });
  sim.settle();
  const a = sim.alpha();
  sim.setParams({ linkDistance: 100 });
  assert.equal(sim.alpha(), a);
  assert.equal(sim.params().linkDistance, 100);
  // rövidebb rugó → rövidebb átlagos él nyugalomban
  function meanEdge() {
    let s = 0;
    for (const e of g.edges) {
      const x = sim.indexOf(e.source), y = sim.indexOf(e.target);
      s += Math.hypot(sim.positions[2 * x] - sim.positions[2 * y], sim.positions[2 * x + 1] - sim.positions[2 * y + 1]);
    }
    return s / g.edges.length;
  }
  const before = meanEdge();
  sim.reheat(0.3); sim.settle();
  assert.ok(meanEdge() < before, 'L=100 mellett rövidebbek az élek');
});

// ---------- analitikus egy-tick tesztek (spec §1.2, kézzel számolt elvárt érték) ----------
// Egy tick: α ← α + (0 − α)·bomlás; erők az ÚJ α-val; v ← 0,6·v; x ← x + v.
// A nem vizsgált erőket kinullázzuk (setParams 0), az ütközést távolsággal (> 120) zárjuk ki.
const DECAY = 1 - Math.pow(0.001, 1 / 300);
const OFF = { centerStrength: 0, repelStrength: 0, linkStrength: 0, linkDistance: 250 };
function near(a, b, msg) { assert.ok(Math.abs(a - b) < 1e-9, (msg || '') + ' várt ' + b + ', kapott ' + a); }
// a merőleges komponensben csak a d3-szerű 1e-6-os „jiggle” (dx = 0 / dy = 0 esetén) maradhat
function nearZero(a, msg) { assert.ok(Math.abs(a) < 1e-6, (msg || '') + ' ≈0, kapott ' + a); }
function only(p) { return Object.assign({}, OFF, p); }

test('analitikus: taszítás Δv = α·P/d, a másiktól el', () => {
  const sim = createForceSim({ nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 200, y: 0 }], edges: [],
    params: only({ repelStrength: 1000 }), alpha: 1 });
  sim.tick(1);
  const al = 1 - DECAY;                       // α az első tick után
  const dv = al * 1000 / 200;                 // = α·P/d
  const p = sim.positions;
  near(p[0], -0.6 * dv, 'a.x'); near(p[2], 200 + 0.6 * dv, 'b.x');
  nearZero(p[1], 'a.y'); nearZero(p[3], 'b.y');
});

test('analitikus: középre húzás Δv = −α·p·pos, és sebesség-csillapítás v ← 0,6·v két tickre', () => {
  const sim = createForceSim({ nodes: [{ id: 'a', x: 100, y: -50 }], edges: [],
    params: only({ centerStrength: 0.1 }), alpha: 1 });
  sim.tick(1);
  const a1 = 1 - DECAY;
  const v1x = 0.6 * (-a1 * 0.1 * 100), v1y = 0.6 * (-a1 * 0.1 * -50);
  const x1 = 100 + v1x, y1 = -50 + v1y;
  near(sim.positions[0], x1, 'x1'); near(sim.positions[1], y1, 'y1');
  sim.tick(1);
  const a2 = a1 * (1 - DECAY);
  const v2x = 0.6 * (v1x - a2 * 0.1 * x1);    // a korábbi sebesség is csillapul
  near(sim.positions[0], x1 + v2x, 'x2');
});

test('analitikus: ütközés 0,25·(120−d)/d elmozdulás csomópontonként, α NÉLKÜL', () => {
  for (const a0 of [1, 0.5]) {
    const sim = createForceSim({ nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 100, y: 0 }], edges: [],
      params: OFF, alpha: a0 });
    sim.tick(1);
    const dv = 0.25 * (120 - 100) / 100 * 100;  // = 5 (sebesség-egység), α-tól független
    near(sim.positions[0], -0.6 * dv, 'a.x @α=' + a0);
    near(sim.positions[2], 100 + 0.6 * dv, 'b.x @α=' + a0);
  }
  // 120-on túl nincs ütközés
  const far = createForceSim({ nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 121, y: 0 }], edges: [], params: OFF, alpha: 1 });
  far.tick(1);
  nearZero(far.positions[0], 'a.x'); near(far.positions[2], 121);
});

test('analitikus: rugó l = (d−L)/d·α·k, k = Ls/min(fok), a végek fok_src/(fok_src+fok_tgt) arányban', () => {
  // Egyetlen él két izolált végponttal NEM elég (min fok = 1 → k = 1, bias = 1/2),
  // ezért aszimmetrikus fokszám kell: a–b él, a fokszáma 1, b-é 2 (b–c is).
  // c messze van, az ő rugója a b sebességét csak az a–b UTÁN módosítja; a b–c
  // élet a sorrendben utána adjuk, és a–b korrekcióját olvassuk le a-n (a csak
  // az a–b élben szerepel).
  const L = 250, Ls = 1;
  const sim = createForceSim({
    nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 400, y: 0 }, { id: 'c', x: 400, y: 400 }],
    edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }],
    params: only({ linkStrength: Ls, linkDistance: L }), alpha: 1
  });
  sim.tick(1);
  const al = 1 - DECAY;
  const degA = 1, degB = 2;
  const k = Ls / Math.min(degA, degB);                 // = 1 / 1
  const l = (400 - L) / 400 * al * k;
  const bias = degA / (degA + degB);                   // a CÉL (b) ennyit visz: 1/3
  // a (forrás) a korrekció (1 − bias) részét kapja, b felé
  near(sim.positions[0], 0.6 * (400 * l * (1 - bias)), 'a.x (forrás-rész)');
  nearZero(sim.positions[1], 'a.y');

  // Fokszám-normalizálás: ahol mindkét végpont fok-2, k = Ls/2. Ilyen élnél a végpontok
  // más élben is szerepelnek, ezért az elvárt értéket a §1.2 képletének SORBAN
  // alkalmazott, kézzel írt kiértékelése adja (élenként: d a várható pozícióból,
  // l = (d−L)/d·α·k, cél −= x·bias, forrás += x·(1−bias)).
  const N = [[0, 0], [400, 0], [400, 900], [0, 900], [-500, 0]];   // a b c d e
  const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 0]];                // a fok 3, b/c/d fok 2, e fok 1
  const sq = createForceSim({
    nodes: N.map((p, i) => ({ id: 'n' + i, x: p[0], y: p[1] })),
    edges: E.map((e) => ({ source: 'n' + e[0], target: 'n' + e[1] })),
    params: only({ linkStrength: Ls, linkDistance: L }), alpha: 1
  });
  sq.tick(1);
  const deg = [0, 0, 0, 0, 0]; E.forEach((e) => { deg[e[0]]++; deg[e[1]]++; });
  assert.deepEqual(deg, [3, 2, 2, 2, 1]);
  const vx = [0, 0, 0, 0, 0], vy = [0, 0, 0, 0, 0];
  for (const [sI, tI] of E) {
    let dx = N[tI][0] + vx[tI] - N[sI][0] - vx[sI], dy = N[tI][1] + vy[tI] - N[sI][1] - vy[sI];
    const d = Math.hypot(dx, dy);
    const kk = Ls / Math.min(deg[sI], deg[tI]);
    const ll = (d - L) / d * al * kk;
    dx *= ll; dy *= ll;
    const bb = deg[sI] / (deg[sI] + deg[tI]);
    vx[tI] -= dx * bb; vy[tI] -= dy * bb;
    vx[sI] += dx * (1 - bb); vy[sI] += dy * (1 - bb);
  }
  for (let i = 0; i < 5; i++) {
    // tűrés 1e-6: az egy tengelyen fekvő éleknél (dy = 0) a szimuláció 1e-6-os jiggle-t ad
    nearZero(sq.positions[2 * i] - (N[i][0] + 0.6 * vx[i]), 'n' + i + '.x');
    nearZero(sq.positions[2 * i + 1] - (N[i][1] + 0.6 * vy[i]), 'n' + i + '.y');
  }
});
