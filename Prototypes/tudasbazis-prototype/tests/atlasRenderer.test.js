/* atlasRenderer.test.js — a renderer élő viselkedése csonkolt kanvasszal és kézi
 * rAF-sorral: szimuláció-ciklus, húzás, hover-halványítás, címkealfa, és a
 * meglévő szerződések (setDimmed/setExcluded/focusOn/toOverview/setData).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./_harness.js');

function setup(opts) {
  const model = H.loadModel();
  const ov = model.getOverview();
  const R = H.loadRenderer(opts);
  R.renderer.start();
  R.renderer.setData({ nodes: ov.nodes, edges: ov.edges });
  return Object.assign(R, { model, ov });
}

function nodeState(R, id) {
  return R.renderer.getDebugState().nodes.find((n) => n.id === id);
}

function neighboursOf(edges, id) {
  const s = new Set();
  for (const e of edges) {
    if (e.source === id) s.add(e.target);
    if (e.target === id) s.add(e.source);
  }
  return s;
}

function pointer(R, type, x, y, extra) {
  R.canvas.dispatch(type, Object.assign({ clientX: x, clientY: y, button: 0, pointerId: 1, type }, extra || {}));
}

test('címkealfa = clamp(log₂(zoom) + 1 − T, 0, 1)', (t) => {
  const R = H.loadRenderer();
  const la = R.createAtlasRenderer.labelAlpha;
  // T = 0: 0,5× alatt 0, 1× fölött 1, köztük log₂-lineáris
  assert.equal(la(0.25, 0), 0);
  assert.equal(la(0.5, 0), 0);
  assert.ok(Math.abs(la(Math.SQRT1_2, 0) - 0.5) < 1e-12);
  assert.equal(la(1, 0), 1);
  assert.equal(la(4, 0), 1);
  // T = 1: a halványítás 1× és 2× között fut; T = −1: 0,25× és 0,5× között
  assert.equal(la(1, 1), 0);
  assert.ok(Math.abs(la(Math.SQRT2, 1) - 0.5) < 1e-12);
  assert.equal(la(2, 1), 1);
  assert.ok(Math.abs(la(0.25 * Math.SQRT2, -1) - 0.5) < 1e-12);
  assert.equal(la(0.5, -1), 1);
  // T = 3: csak 4× fölött kezd látszani
  assert.equal(la(4, 3), 0);
  assert.equal(la(8, 3), 1);
  assert.equal(la(0, 0), 0);
  // a renderer áttekintésben zoom = 1 (nézet-arány) → T = 0 mellett teljes alfa
  const S = setup();
  S.raf.pump(2000);
  const st = S.renderer.getDebugState();
  t.diagnostic('áttekintés: zoom = ' + st.zoom.toFixed(3) + ', címkealfa = ' + st.labelAlpha);
  assert.ok(Math.abs(st.zoom - 1) < 1e-6);
  assert.equal(st.labelAlpha, 1);
  S.renderer.setSettings({ labelFade: 1 });
  assert.equal(S.renderer.getDebugState().labelAlpha, 0, 'T = 1 → áttekintésben rejtett címkék');
});

test('a szimulációt a rAF-ciklus hajtja, kihűlve a ciklus leáll', () => {
  const R = setup();
  let st = R.renderer.getDebugState();
  assert.ok(st.alpha <= 0.1 + 1e-9 && st.alpha > 0.001, 'első betöltés: szinkron előfuttatás α ≤ 0,1-ig');
  assert.ok(st.loopActive, 'a ciklus fut, amíg meleg');
  // az első képkocka csak időbélyeget vesz fel (dt = 0, nincs ugrás a szünet után)
  R.raf.frame(16.67);
  assert.equal(R.renderer.getDebugState().alpha, st.alpha);
  // egy 16,67 ms-os képkocka = egy fix lépés
  const a0 = st.alpha;
  R.raf.frame(16.67);
  const a1 = R.renderer.getDebugState().alpha;
  assert.ok(a1 < a0);
  // óriási dt sem lép többet a sapkánál (4 lépés / képkocka; a dt amúgy is 50 ms-ra vágva)
  R.raf.frame(5000);
  const a2 = R.renderer.getDebugState().alpha;
  const decay = 1 - Math.pow(0.001, 1 / 300);
  const minAllowed = a1 * Math.pow(1 - decay, 4) - 1e-12;
  assert.ok(a2 >= minAllowed, 'legfeljebb 4 lépés egy képkockában');
  const frames = R.raf.pump(5000);
  st = R.renderer.getDebugState();
  assert.ok(frames < 1000, 'véges számú képkocka után megáll: ' + frames);
  assert.ok(st.settled && st.alpha < 0.001);
  assert.equal(st.loopActive, false, 'nyugalomban nincs rAF-kérés');
  assert.equal(R.raf.pending(), 0);
});

test('nyugalomban a rajzolt körök sem érnek össze (ütközés-erő + restCapR)', () => {
  for (const size of [[800, 600], [360, 160]]) {
    const R = setup({ width: size[0], height: size[1] });
    R.raf.pump(5000);
    const ns = R.renderer.getDebugState().nodes;
    let min = Infinity;
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const gap = Math.hypot(ns[i].screenX - ns[j].screenX, ns[i].screenY - ns[j].screenY) - ns[i].screenR - ns[j].screenR;
        if (gap < min) min = gap;
      }
    }
    assert.ok(min > 0, size.join('×') + ' px: a legszűkebb rés ' + min.toFixed(2) + ' px');
  }
});

test('ugyanaz a halmaz → nincs újraindítás; új csomópont → a többi a helyén marad', () => {
  const R = setup();
  R.raf.pump(5000);
  const before = R.renderer.getDebugState();
  // ugyanaz a halmaz más sorrendben (mint a nézet-unió) → semmi nem mozdul
  R.renderer.setData({ nodes: R.ov.nodes.slice().reverse(), edges: R.ov.edges });
  const same = R.renderer.getDebugState();
  assert.equal(same.alpha, before.alpha);
  for (const n of before.nodes) {
    const m = same.nodes.find((x) => x.id === n.id);
    assert.ok(Object.is(m.x, n.x) && Object.is(m.y, n.y), 'nem mozdult: ' + n.id);
  }
  assert.ok(R.raf.pump(10) <= 1, 'legfeljebb egy újrarajzolás, aztán leáll');
  const redrawn = R.renderer.getDebugState();
  for (const n of before.nodes) {
    const m = redrawn.nodes.find((x) => x.id === n.id);
    assert.ok(Object.is(m.x, n.x) && Object.is(m.y, n.y), 'újrarajzolás után sem mozdult: ' + n.id);
  }
  // új csomópont: α = 0,3, a régiek kiinduló pozíciója megmarad
  const extra = { id: 'doc:uj', label: 'Új', x: 0, y: 0, r: 10, weight: 0, catSlots: [1] };
  const edge = { source: 'doc:uj', target: R.ov.nodes[0].id, weight: 1 };
  R.renderer.setData({ nodes: R.ov.nodes.concat([extra]), edges: R.ov.edges.concat([edge]) });
  const grown = R.renderer.getDebugState();
  assert.ok(Math.abs(grown.alpha - 0.3) < 1e-9, 'új adatnál α = 0,3');
  const anchor = before.nodes.find((x) => x.id === R.ov.nodes[0].id);
  const nu = grown.nodes.find((x) => x.id === 'doc:uj');
  assert.ok(Math.hypot(nu.x - anchor.x, nu.y - anchor.y) < 60, 'az új csomópont a szomszédja mellé kerül');
  const kept = grown.nodes.find((x) => x.id === R.ov.nodes[5].id);
  const old = before.nodes.find((x) => x.id === R.ov.nodes[5].id);
  assert.ok(Object.is(kept.x, old.x), 'a régi csomópont pozíciója megmaradt');
});

test('hover: célhalmaz = hoverelt + közvetlen szomszédok, a többi 0,2; időalapú easing', () => {
  const R = setup();
  R.raf.pump(5000);
  // a legtöbb szomszéddal bíró csomópont
  const deg = new Map();
  for (const e of R.ov.edges) { deg.set(e.source, (deg.get(e.source) || 0) + 1); deg.set(e.target, (deg.get(e.target) || 0) + 1); }
  const target = [...deg.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const nb = neighboursOf(R.ov.edges, target);
  const ns = nodeState(R, target);
  pointer(R, 'pointermove', ns.screenX, ns.screenY);
  assert.equal(R.hovers[R.hovers.length - 1], target, 'onHover a csomópont id-jével');
  let st = R.renderer.getDebugState();
  for (const n of st.nodes) {
    const want = n.id === target || nb.has(n.id) ? 1 : 0.2;
    assert.ok(Math.abs(n.fadeTarget - want) < 1e-6, n.id + ' célértéke ' + want);
  }
  // egy 16,67 ms-os képkocka: k = 1 − 0,9 = 0,1 → 1 → 0,92
  const other = st.nodes.find((n) => n.fadeTarget < 0.5);
  assert.ok(Math.abs(other.fade - 1) < 1e-6, 'még nem mozdult');
  R.raf.frame(16.67);                     // a leállt ciklus első képkockája: dt = 0
  assert.ok(Math.abs(R.renderer.getDebugState().nodes.find((n) => n.id === other.id).fade - 1) < 1e-6);
  R.raf.frame(16.67);
  st = R.renderer.getDebugState();
  const o1 = st.nodes.find((n) => n.id === other.id);
  assert.ok(Math.abs(o1.fade - (1 - 0.1 * 0.8)) < 1e-3, 'egy képkocka után ≈0,92: ' + o1.fade);
  // 33,3 ms-os képkocka ugyanannyit halad, mint két 16,67-es (képkocka-függetlenség)
  R.raf.frame(33.34);
  const o2 = R.renderer.getDebugState().nodes.find((n) => n.id === other.id);
  const k2 = 1 - Math.pow(0.9, 33.34 / 16.67);
  assert.ok(Math.abs(o2.fade - (o1.fade + (0.2 - o1.fade) * k2)) < 1e-3);
  R.raf.pump(400);
  const settled = R.renderer.getDebugState().nodes.find((n) => n.id === other.id);
  assert.ok(Math.abs(settled.fade - 0.2) < 1e-6, 'beáll 0,2-re');
  // kilépés → vissza 1-re
  R.canvas.dispatch('pointerleave', {});
  assert.equal(R.hovers[R.hovers.length - 1], null);
  for (let i = 0; i < 200; i++) R.raf.frame(16.67);
  for (const n of R.renderer.getDebugState().nodes) assert.ok(Math.abs(n.fade - 1) < 1e-6);
});

test('húzás: 5 px alatt kattintás, fölötte a csomópont a mutatót követi, és nem választ ki', () => {
  const R = setup();
  R.raf.pump(5000);
  const id = R.ov.nodes[3].id;
  let ns = nodeState(R, id);
  // 4 px elmozdulás → kattintás → kiválasztás
  pointer(R, 'pointerdown', ns.screenX, ns.screenY);
  pointer(R, 'pointermove', ns.screenX + 3, ns.screenY + 2);
  pointer(R, 'pointerup', ns.screenX + 3, ns.screenY + 2);
  assert.equal(R.selects[R.selects.length - 1], id, 'küszöb alatt kattintás');
  assert.equal(R.renderer.getDebugState().settled, true, 'kattintás nem melegít');
  const selCount = R.selects.length;

  // valódi húzás
  ns = nodeState(R, id);
  const sx = ns.screenX, sy = ns.screenY;
  pointer(R, 'pointerdown', sx, sy);
  pointer(R, 'pointermove', sx + 40, sy + 30);
  let st = R.renderer.getDebugState();
  assert.equal(st.dragId, id);
  assert.ok(nodeState(R, id).pinned, 'rögzítve a mutatóhoz');
  assert.ok(st.alpha >= 0.3 - 1e-9, 'húzás felmelegít (α ≥ 0,3)');
  assert.equal(st.camTouched, false, 'csomópont-húzás nem pásztáz');
  const p1 = nodeState(R, id);
  assert.ok(Math.abs(p1.screenX - (sx + 40)) < 0.5 && Math.abs(p1.screenY - (sy + 30)) < 0.5, 'a mutató alatt van');
  // képkockák alatt is a mutatónál marad, a szimuláció melegen él
  for (let i = 0; i < 120; i++) R.raf.frame(16.67);
  const p2 = nodeState(R, id);
  assert.ok(Math.abs(p2.screenX - (sx + 40)) < 0.5 && Math.abs(p2.screenY - (sy + 30)) < 0.5, 'rögzített marad');
  assert.ok(R.renderer.getDebugState().alpha > 0.25, 'tartás alatt nem hűl ki');
  // húzás közben a húzott csomópont a kiemelt (hover-halványítás célja)
  const nb = neighboursOf(R.ov.edges, id);
  for (const n of R.renderer.getDebugState().nodes) {
    assert.equal(n.fadeTarget, n.id === id || nb.has(n.id) ? 1 : Math.fround(0.2));
  }
  pointer(R, 'pointerup', sx + 40, sy + 30);
  assert.equal(R.selects.length, selCount, 'húzás nem választ ki');
  st = R.renderer.getDebugState();
  assert.equal(st.dragId, null);
  assert.equal(nodeState(R, id).pinned, false);
  const frames = R.raf.pump(5000);
  assert.ok(R.renderer.getDebugState().settled, 'elengedés után megnyugszik (' + frames + ' képkocka)');
});

test('háttér-húzás pásztáz (camTouched), nem mozgat csomópontot', () => {
  const R = setup();
  R.raf.pump(5000);
  const before = R.renderer.getDebugState();
  // üres pont keresése: a sarok
  pointer(R, 'pointerdown', 2, 2);
  pointer(R, 'pointermove', 60, 40);
  pointer(R, 'pointerup', 60, 40);
  const after = R.renderer.getDebugState();
  assert.equal(after.camTouched, true);
  assert.equal(after.dragId, null);
  assert.equal(after.alpha, before.alpha, 'pásztázás nem melegít');
  assert.equal(R.selects.length, 0, 'húzás nem választ ki');
});

test('kiesett (setExcluded) csomópont inert: nem hoverelhető, nem húzható', () => {
  const R = setup();
  R.raf.pump(5000);
  const id = R.ov.nodes[2].id;
  R.renderer.setExcluded([id]);
  const ns = nodeState(R, id);
  pointer(R, 'pointermove', ns.screenX, ns.screenY);
  assert.notEqual(R.hovers[R.hovers.length - 1], id);
  pointer(R, 'pointerdown', ns.screenX, ns.screenY);
  pointer(R, 'pointermove', ns.screenX + 50, ns.screenY);
  pointer(R, 'pointerup', ns.screenX + 50, ns.screenY);
  assert.equal(nodeState(R, id).pinned, false);
  assert.ok(R.renderer.getDebugState().settled);
  R.renderer.setExcluded(null);
});

test('setSettings: erő-változás α = 0,3-ra melegít; a címke-küszöb csak rajzol', () => {
  const R = setup();
  R.raf.pump(5000);
  R.renderer.setSettings({ labelFade: 2 });
  assert.ok(R.renderer.getDebugState().settled, 'a címke-küszöb nem melegít');
  const fsMap = R.createForceSim.sliderToParams;
  R.renderer.setSettings({ forces: fsMap({ center: 0.52, repel: 12, linkStrength: 1, linkDistance: 180 }) });
  const st = R.renderer.getDebugState();
  assert.ok(Math.abs(st.alpha - 0.3) < 1e-9);
  assert.equal(st.params.linkDistance, 180);
  assert.equal(st.params.repelStrength, 1728);
  assert.ok(st.loopActive);
  R.raf.pump(5000);
  assert.ok(R.renderer.getDebugState().settled);
});

test('reduced motion: nincs ciklus, a szimuláció szinkron nyugalomig fut; a húzás működik', () => {
  const R = setup({ reducedMotion: true });
  let st = R.renderer.getDebugState();
  assert.ok(st.settled, 'setData után azonnal nyugalomban');
  assert.equal(R.raf.pending(), 0, 'reduced motion: nincs rAF');
  R.renderer.setSettings({ forces: R.createForceSim.sliderToParams({ repel: 14 }) });
  st = R.renderer.getDebugState();
  assert.ok(st.settled, 'csúszka után is szinkron nyugalom');
  assert.equal(R.raf.pending(), 0);
  // húzás
  const id = R.ov.nodes[1].id;
  const ns = nodeState(R, id);
  pointer(R, 'pointerdown', ns.screenX, ns.screenY);
  pointer(R, 'pointermove', ns.screenX + 30, ns.screenY - 20);
  assert.ok(nodeState(R, id).pinned);
  assert.ok(Math.abs(nodeState(R, id).screenX - (ns.screenX + 30)) < 0.5);
  pointer(R, 'pointerup', ns.screenX + 30, ns.screenY - 20);
  st = R.renderer.getDebugState();
  assert.ok(st.settled && !nodeState(R, id).pinned, 'elengedés után szinkron nyugalom');
  assert.equal(R.raf.pending(), 0);
  // hover reduced motionnél azonnal a célon
  const hs = nodeState(R, id);
  pointer(R, 'pointermove', hs.screenX, hs.screenY);
  const far = R.renderer.getDebugState().nodes.find((n) => n.fadeTarget < 0.5);
  assert.ok(far && Math.abs(far.fade - 0.2) < 1e-6);
});

test('meglévő szerződések: setDimmed, focusOn(mélység), toOverview, refreshColors', () => {
  const R = setup();
  R.raf.pump(5000);
  const st0 = R.renderer.getDebugState();
  const id = R.ov.nodes[0].id;
  // setDimmed: a halványítás nem nyúl a szimulációhoz
  R.renderer.setDimmed([R.ov.nodes[1].id, R.ov.nodes[2].id]);
  R.renderer.setDimmed(null);
  assert.equal(R.renderer.getDebugState().alpha, st0.alpha);
  // focusOn: a kamera rázoomol (camTouched), mélység 2 tágabb vagy egyenlő keretet ad
  R.renderer.focusOn(id, { animate: false, depth: 1 });
  const z1 = R.renderer.getDebugState().zoom;
  R.renderer.focusOn(id, { animate: false, depth: 2 });
  const z2 = R.renderer.getDebugState().zoom;
  assert.ok(R.renderer.getDebugState().camTouched);
  assert.ok(z1 > 1 && z2 <= z1 + 1e-9, 'mélység 1 zoom ' + z1.toFixed(2) + ' ≥ mélység 2 zoom ' + z2.toFixed(2));
  // toOverview: vissza az illesztésre (animáció a ciklusban)
  R.renderer.toOverview({ animate: true });
  R.raf.pump(5000);
  const st = R.renderer.getDebugState();
  assert.equal(st.camTouched, false);
  assert.ok(Math.abs(st.zoom - 1) < 1e-6);
  // témaváltás újramontírozás nélkül
  R.renderer.refreshColors();
  assert.ok(R.canvas.ctx2d.calls.arc > 0);
  R.renderer.destroy();
  assert.equal(R.raf.pending(), 0);
});

// ---------- javítási kör: F1 (beragadt rögzítés), F2 (pointercancel, setDimmed rajz), F3 (rem-betűméret) ----------

function startDrag(R, id) {
  const ns = nodeState(R, id);
  pointer(R, 'pointerdown', ns.screenX, ns.screenY);
  pointer(R, 'pointermove', ns.screenX + 40, ns.screenY + 30);
  assert.equal(R.renderer.getDebugState().dragId, id, 'a húzás elindult');
  return ns;
}

test('F1: azonos halmazú setData húzás közben nem hagy beragadt rögzítést', () => {
  const R = setup();
  R.raf.pump(5000);
  const id = R.ov.nodes[3].id;
  const ns = startDrag(R, id);
  // pl. refresh/recompute húzás közben: ugyanaz a halmaz
  R.renderer.setData({ nodes: R.ov.nodes, edges: R.ov.edges });
  pointer(R, 'pointerup', ns.screenX + 40, ns.screenY + 30);
  R.canvas.dispatch('pointerleave', {});    // hover vége → a pulzálás sem tartja a ciklust
  R.raf.pump(5000);
  const st = R.renderer.getDebugState();
  assert.equal(nodeState(R, id).pinned, false, 'nincs rögzítve');
  assert.ok(st.settled, 'kihűlt (α = ' + st.alpha + ')');
  assert.equal(st.dragId, null);
  assert.equal(R.raf.pending(), 0, 'a ciklus leállt');
});

test('F1: lostpointercapture lezárja a húzást (elveszett pointerup)', () => {
  const R = setup();
  R.raf.pump(5000);
  const id = R.ov.nodes[4].id;
  startDrag(R, id);
  const selBefore = R.selects.length;
  R.canvas.dispatch('lostpointercapture', { pointerId: 1, type: 'lostpointercapture' });
  assert.equal(R.renderer.getDebugState().dragId, null);
  assert.equal(nodeState(R, id).pinned, false);
  assert.equal(R.selects.length, selBefore, 'nem választ ki');
  R.canvas.dispatch('pointerleave', {});
  R.raf.pump(5000);
  assert.ok(R.renderer.getDebugState().settled);
  assert.equal(R.raf.pending(), 0);
});

test('F2: pointercancel (megszakított gesztus) nem választ ki', () => {
  const R = setup();
  R.raf.pump(5000);
  const ns = nodeState(R, R.ov.nodes[2].id);
  pointer(R, 'pointerdown', ns.screenX, ns.screenY);
  pointer(R, 'pointercancel', ns.screenX, ns.screenY);
  assert.equal(R.selects.length, 0);
  // ellenpróba: ugyanez pointerup-pal kiválaszt
  pointer(R, 'pointerdown', ns.screenX, ns.screenY);
  pointer(R, 'pointerup', ns.screenX, ns.screenY);
  assert.equal(R.selects.length, 1);
});

test('F2: setDimmed — a felsorolt csomópontok halványan rajzolódnak, a többi nem', () => {
  const R = setup();
  R.raf.pump(5000);
  const dimId = R.ov.nodes[1].id, keepId = R.ov.nodes[0].id;
  R.renderer.setDimmed([dimId]);
  R.canvas.ctx2d.calls.arcs.length = 0;
  R.raf.pump(10);
  if (!R.canvas.ctx2d.calls.arcs.length) R.renderer.resize();   // biztos újrarajz
  function bodyAlpha(id) {
    const n = nodeState(R, id);
    const hits = R.canvas.ctx2d.calls.arcs.filter((a) =>
      Math.abs(a.x - n.screenX) < 0.01 && Math.abs(a.y - n.screenY) < 0.01 && Math.abs(a.r - n.screenR) < 0.01);
    assert.ok(hits.length, 'rajzolódott: ' + id);
    return Math.max(...hits.map((h) => h.alpha));
  }
  const ad = bodyAlpha(dimId), ak = bodyAlpha(keepId);
  // (többkategóriás csomópontnál a test sprite, ezért ott a --surface keret-ív alfáját mérjük:
  // ugyanazzal a tényezővel halványul)
  assert.ok(ak > 0.5, 'nem halványított alfa: ' + ak);
  assert.ok(ad < ak * 0.4, 'halványított alfa: ' + ad + ' (vs ' + ak + ')');
  // vissza: setDimmed(null) → teljes
  R.renderer.setDimmed(null);
  R.canvas.ctx2d.calls.arcs.length = 0;
  R.raf.pump(10);
  if (!R.canvas.ctx2d.calls.arcs.length) R.renderer.resize();
  assert.ok(bodyAlpha(dimId) > 0.5);
});

test('F3: a címke betűmérete a rem-tokenből px-re oldódik (.75rem × 16px = 12px)', () => {
  const model = H.loadModel();
  const ov = model.getOverview();
  const R = H.loadRenderer({ cssVars: { '--text-xs': '.75rem', '--font-body': 'Inter, sans-serif' }, rootFontSize: '16px' });
  R.renderer.start();
  R.renderer.setData({ nodes: ov.nodes, edges: ov.edges });
  R.raf.pump(5000);
  R.renderer.resize();
  const ft = R.canvas.ctx2d.calls.fillText;
  assert.ok(ft.length > 0, 'van címke');
  for (const c of ft) assert.equal(c.font, '500 12px Inter, sans-serif');
  // 20px-es gyökérnél 15px; px-token marad; értelmetlen érték → 12
  for (const [v, root, want] of [['.75rem', '20px', '15px'], ['13px', '16px', '13px'], ['', '16px', '12px'], ['abc', '16px', '12px'], ['1em', '16px', '16px']]) {
    const S = H.loadRenderer({ cssVars: { '--text-xs': v, '--font-body': 'Inter' }, rootFontSize: root });
    S.renderer.start();
    S.renderer.setData({ nodes: ov.nodes, edges: ov.edges });
    S.raf.pump(5000);
    S.renderer.resize();
    const f = S.canvas.ctx2d.calls.fillText;
    assert.ok(f.length && f.every((c) => c.font === '500 ' + want + ' Inter'), v + ' @' + root + ' → ' + want + ' (kapott: ' + (f[0] && f[0].font) + ')');
  }
});
