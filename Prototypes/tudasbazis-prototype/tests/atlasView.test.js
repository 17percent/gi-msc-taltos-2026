/* atlasView.test.js — a nézet (atlasView.js) integrációja a VALÓDI renderer, store, FSM és
 * graphModel fölött, minimális DOM-csonkkal (_dom.js).
 *
 * Csonk: az ambient mező (constellation) és a találati lista (csak rögzíti a kapott tételeket),
 * a DOM, az időzítők és a rAF (kézi). A renderer valódi, de spy-burkolóban fut: minden hívását
 * (setSettings, setDimmed, setExcluded, focusOn, refreshColors…) rögzítjük ÉS a valódi állapotát
 * (getDebugState) is olvassuk — így a „spy szerint hívta" és a „tényleg ez lett belőle" is ellenőrzött.
 *
 * Elnevezés: a `DEFECT:` előtagú teszt egy VALÓDI hibát reprodukál — szándékosan piros, amíg a
 * hibát ki nem javítják (lásd a jelentést).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./_harness.js');
const D = require('./_dom.js');

// vm-kontextusból jövő objektumok prototípusa más → JSON-körön át hasonlítunk
const plain = (x) => JSON.parse(JSON.stringify(x));
const T0 = H.FIXED_NOW - 3600e3;

// kicsi, KONTROLLÁLT korpusz: a keresés/szűrő elvárt eredménye kézzel megadható
function mini() {
  const mk = (id, title, o) => Object.assign({
    id, title, categories: ['A'], ownerId: 'u1', authorIds: ['u1'], updatedAt: T0,
    status: 'Kész', isTemplate: false, iteration: 1, text: 'szöveg ' + id
  }, o || {});
  return [
    mk('a1', 'Alfa terv'),
    mk('a2', 'Alfa riport', { categories: ['A', 'B'] }),
    mk('b1', 'Béta jegyzet', { categories: ['B'], isTemplate: true, ownerId: 'u2', authorIds: ['u2'] }),
    mk('g1', 'Gamma napló', { categories: ['C'], isTemplate: true, ownerId: 'u2', authorIds: ['u2'] }),
    mk('d1', 'Delta lista', { categories: ['C'] }),
    mk('e1', 'Epszilon', { categories: [], ownerId: 'u3', authorIds: ['u3'] })
  ];
}
function miniView(extra) {
  return D.mountView(Object.assign({
    docs: mini(),
    categories: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
    users: [{ id: 'u1', name: 'U1' }, { id: 'u2', name: 'U2' }, { id: 'u3', name: 'U3' }],
    currentUserId: 'u1'
  }, extra || {}));
}
const ids = (arr) => plain((arr || []).slice().sort());
const drawnIds = (v) => plain(v.dbg().nodes.map((n) => n.id).sort());

function typeQuery(v, text) {
  const inp = v.q('.atlas__input');
  inp.value = text;
  inp.dispatchEvent({ type: 'input' });
  v.timers.advance(200);
  v.raf.pump(5000);
}
function clickFacet(v, name) {
  v.q('[data-facet="' + name + '"]').dispatchEvent({ type: 'click' });
  v.raf.pump(5000);
}
function posOf(v) {
  const m = {};
  v.dbg().nodes.forEach((n) => { m[n.id] = [n.x, n.y]; });
  return m;
}

// =====================================================================
// 1) beállítás-panel → renderer
// =====================================================================

test('csúszka `input`: a renderer megkapja a setSettings-et és felmelegszik; `change` előtt nincs mentés', () => {
  const st = D.memStorage();
  const v = D.mountView({ storage: st });
  v.settle();
  assert.equal(v.dbg().settled, true, 'indulás után kihűlt');
  v.rec.clear();

  v.moveSlider('repel', 3, { commit: false });
  const c = v.rec.last('setSettings');
  assert.ok(c, 'setSettings hívva');
  assert.equal(c.args[0].forces.repelStrength, 27, 'repel 3 → P = 3³');
  assert.equal(c.args[0].labelFade, undefined, 'erő-csúszkánál a címke-küszöb nem megy át');
  const d = v.dbg();
  assert.equal(d.params.repelStrength, 27, 'a valódi szimuláció megkapta');
  assert.ok(Math.abs(d.alpha - 0.3) < 1e-9, 'α = 0,3-ra melegszik');
  assert.equal(d.settled, false);
  assert.ok(v.raf.pending() > 0, 'a ciklus újraindul');
  assert.equal(st.writes.length, 0, 'csak `input`: még nincs localStorage-írás');

  v.raf.pump(5000);
  assert.equal(v.dbg().settled, true, 'újra kihűl');
  assert.equal(v.raf.pending(), 0, 'és a ciklus leáll');
});

test('csúszka `change`: mentés a tb-atlas-settings kulcsra, v:1 + csúszka-pozíciók', () => {
  const st = D.memStorage();
  const v = D.mountView({ storage: st });
  v.settle();
  v.moveSlider('repel', 14);
  v.moveSlider('depth', 3);
  v.moveSlider('labels', -1.5);
  assert.equal(st.writes.length, 3);
  const [key, val] = st.writes[st.writes.length - 1];
  assert.equal(key, 'tb-atlas-settings');
  const o = JSON.parse(val);
  assert.equal(o.v, 1);
  assert.equal(o.repel, 14);
  assert.equal(o.depth, 3);
  assert.equal(o.labels, -1.5);
  assert.equal(o.center, 0.52, 'a többi csúszka is benne van');
});

test('mind a négy erő-csúszka a helyes fizikai paramétert adja át (leképezés a nézeten át)', () => {
  const v = D.mountView({ storage: D.memStorage() });
  v.settle();
  v.moveSlider('linkDistance', 400);
  assert.equal(plain(v.rec.last('setSettings').args[0].forces).linkDistance, 400);
  assert.equal(v.dbg().params.linkDistance, 400);
  v.moveSlider('linkStrength', 0);
  assert.equal(v.rec.last('setSettings').args[0].forces.linkStrength, 0);
  v.moveSlider('center', 1);
  assert.equal(v.rec.last('setSettings').args[0].forces.centerStrength, 1);
  v.moveSlider('center', 0);
  assert.equal(v.rec.last('setSettings').args[0].forces.centerStrength, 0);
  // a többi csúszka értéke a következő híváskor is benne van (nem csak a mozgatotté)
  const f = plain(v.rec.last('setSettings').args[0].forces);
  assert.equal(f.linkDistance, 400);
  assert.equal(f.linkStrength, 0);
  assert.equal(f.repelStrength, 1000);
});

test('címke-csúszka: csak a címke-küszöb megy át (T = −labels), NINCS felmelegítés és NINCS setData', () => {
  const v = D.mountView({ storage: D.memStorage() });
  v.settle();
  v.rec.clear();
  v.moveSlider('labels', 2);
  const c = v.rec.last('setSettings');
  assert.equal(c.args[0].labelFade, -2);
  assert.equal(c.args[0].forces, undefined);
  assert.equal(v.dbg().settled, true, 'a címke-csúszka nem melegíti a szimulációt');
  assert.equal(v.dbg().labelFade, -2);
  assert.equal(v.rec.of('setData').length, 0);
});

test('címke-előjel a nézeten át: balra (−3) nincs címke áttekintésben, jobbra (+3) van', () => {
  const v = D.mountView({ storage: D.memStorage() });
  v.settle();
  const ctx2d = v.rec.canvas.ctx2d;
  v.moveSlider('labels', -3); v.raf.pump(5000);
  ctx2d.calls.fillText.length = 0;
  v.rec.renderer.setHighlight({}); v.raf.pump(5000);   // egy friss képkocka
  const none = ctx2d.calls.fillText.length;
  v.moveSlider('labels', 3); v.raf.pump(5000);
  ctx2d.calls.fillText.length = 0;
  v.rec.renderer.setHighlight({}); v.raf.pump(5000);
  const many = ctx2d.calls.fillText.length;
  assert.equal(none, 0, 'T = +3 → alfa = 0 áttekintésben');
  assert.ok(many >= 3, 'T = −3 → a címkék látszanak (' + many + ')');
});

test('azonos értékre mozgatott csúszka: no-op (nincs setSettings, nincs felmelegítés)', () => {
  const v = D.mountView({ storage: D.memStorage() });
  v.settle();
  v.rec.clear();
  v.moveSlider('repel', 10);        // alapérték
  assert.equal(v.rec.of('setSettings').length, 0);
  assert.equal(v.dbg().settled, true);
});

test('kijelzett érték (<output>): magyar formátum, valódi mínusz-jel, előjeles címke, lépés-egység', () => {
  const v = D.mountView({ storage: D.memStorage() });
  v.settle();
  const txt = (k) => v.out(k).textContent;
  assert.deepEqual(['center', 'repel', 'linkStrength', 'linkDistance', 'labels', 'depth'].map(txt),
    ['0,52', '10,0', '1,00', '250', '0,0', '1 lépés']);
  v.moveSlider('repel', 14.5);   assert.equal(txt('repel'), '14,5');
  v.moveSlider('labels', -1.5);  assert.equal(txt('labels'), '−1,5');
  v.moveSlider('labels', 2);     assert.equal(txt('labels'), '+2,0');
  v.moveSlider('depth', 3);      assert.equal(txt('depth'), '3 lépés');
  v.moveSlider('linkDistance', 30); assert.equal(txt('linkDistance'), '30');
});

test('reset: minden csúszka + kijelzés alapérték, a renderer újra megkapja, a mentés is alapérték', () => {
  const st = D.memStorage();
  const v = D.mountView({ storage: st });
  v.settle();
  v.moveSlider('repel', 17); v.moveSlider('center', 0.9); v.moveSlider('linkDistance', 90);
  v.moveSlider('labels', 2.5); v.moveSlider('depth', 3);
  v.rec.clear();
  v.q('[data-act="reset-settings"]').dispatchEvent({ type: 'click' });
  assert.deepEqual(['center', 'repel', 'linkStrength', 'linkDistance', 'labels', 'depth'].map((k) => v.slider(k).value),
    ['0.52', '10', '1', '250', '0', '1']);
  assert.equal(v.out('repel').textContent, '10,0');
  const c = v.rec.last('setSettings').args[0];
  assert.equal(c.forces.repelStrength, 1000);
  assert.equal(c.forces.linkDistance, 250);
  assert.equal(c.labelFade + 0, 0, 'T = 0');
  const saved = JSON.parse(st.writes[st.writes.length - 1][1]);
  assert.deepEqual(plain({ r: saved.repel, d: saved.depth, l: saved.labels, c: saved.center, ld: saved.linkDistance }),
    { r: 10, d: 1, l: 0, c: 0.52, ld: 250 });
  assert.equal(v.dbg().params.repelStrength, 1000);
});

test('reset fókuszban: a mélység 1-re áll vissza és a kamera újra illeszkedik (focusOn depth 1)', () => {
  const v = D.mountView({ storage: D.memStorage() });
  v.settle();
  v.moveSlider('depth', 3);
  v.handle.store.select('d1'); v.settle();
  assert.equal(v.rec.last('focusOn').args[1].depth, 3);
  v.rec.clear();
  v.q('[data-act="reset-settings"]').dispatchEvent({ type: 'click' });
  assert.equal(v.rec.last('focusOn').args[1].depth, 1);
});

// =====================================================================
// 2) betöltés: sérült / tartományon kívüli / kivételt dobó localStorage
// =====================================================================

test('mentett beállítás visszatöltődik: csúszkák, kijelzés és a renderer kezdő paraméterei', () => {
  const st = D.memStorage([['tb-atlas-settings', JSON.stringify({ v: 1, repel: 14, linkDistance: 120, labels: -1.5, depth: 2, center: 0.3, linkStrength: 0.5 })]]);
  const v = D.mountView({ storage: st });
  assert.equal(v.slider('repel').value, '14');
  assert.equal(v.slider('depth').value, '2');
  assert.equal(v.out('repel').textContent, '14,0');
  assert.equal(v.rec.opts.forces.repelStrength, 2744);
  assert.equal(v.rec.opts.forces.linkDistance, 120);
  assert.equal(v.rec.opts.labelFade, 1.5, 'T = −labels');
});

test('tartományon kívüli mentett értékek a szélre vágódnak (a csúszkán és a rendererben is)', () => {
  const st = D.memStorage([['tb-atlas-settings', JSON.stringify({ v: 1, repel: 99, center: -5, linkStrength: 7, linkDistance: 9999, labels: 99, depth: 7 })]]);
  const v = D.mountView({ storage: st });
  assert.deepEqual(['center', 'repel', 'linkStrength', 'linkDistance', 'labels', 'depth'].map((k) => +v.slider(k).value),
    [0, 20, 1, 500, 3, 3]);
  const f = plain(v.rec.opts.forces);
  assert.equal(f.repelStrength, 8000);
  assert.equal(f.centerStrength, 0);
  assert.equal(f.linkDistance, 500);
  assert.equal(v.rec.opts.labelFade, -3);
  v.settle();
  assert.ok(v.dbg().nodes.every((n) => isFinite(n.x) && isFinite(n.y)), 'szélsőértéken is véges koordináták');
});

for (const [name, raw] of [
  ['nem JSON', '{nem json'],
  ['JSON null', 'null'],
  ['JSON tömb', '[1,2,3]'],
  ['ismeretlen verzió', JSON.stringify({ v: 2, repel: 3 })],
  ['hiányzó verzió', JSON.stringify({ repel: 3 })],
  ['szöveges / NaN értékek', JSON.stringify({ v: 1, repel: 'abc', center: 'x', linkDistance: null, depth: {} })],
  ['üres string a tárolóban', '']
]) {
  test('sérült tároló (' + name + ') → alapértékek, és a nézet működik', () => {
    const v = D.mountView({ storage: D.memStorage([['tb-atlas-settings', raw]]) });
    assert.deepEqual(['center', 'repel', 'linkStrength', 'linkDistance', 'labels', 'depth'].map((k) => +v.slider(k).value),
      [0.52, 10, 1, 250, 0, 1]);
    v.settle();
    assert.equal(v.handle.machine.state, 'overview');
  });
}

test('a localStorage-getter kivételt dob (SecurityError): a nézet alapértékkel indul és a csúszka működik', () => {
  const v = D.mountView({ storage: 'throwing-getter' });
  v.settle();
  assert.equal(v.slider('repel').value, '10');
  assert.doesNotThrow(() => v.moveSlider('repel', 5));
  assert.equal(v.dbg().params.repelStrength, 125, 'a beállítás a munkamenetben mégis érvényesül');
});

test('getItem/setItem kivételt dob (kvóta, tiltott tároló): nincs kivétel az eseménykezelőből, a változás él', () => {
  const st = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
  const v = D.mountView({ storage: st });
  v.settle();
  assert.doesNotThrow(() => v.moveSlider('depth', 2));
  assert.doesNotThrow(() => v.q('[data-act="reset-settings"]').dispatchEvent({ type: 'click' }));
  assert.equal(v.slider('depth').value, '1');
});

test('localStorage nélkül (nincs tároló) is indul és működik', () => {
  const v = D.mountView({ storage: null });
  v.settle();
  assert.doesNotThrow(() => v.moveSlider('repel', 6));
  assert.equal(v.dbg().params.repelStrength, 216);
});

// =====================================================================
// 3) mélység-csúszka fókuszban
// =====================================================================

// független BFS-orákulum a RAJZOLT élekből (nem a modell getNeighborhood-jából)
function bfs(edges, start, depth) {
  const adj = {};
  edges.forEach((e) => { (adj[e.source] = adj[e.source] || []).push(e.target); (adj[e.target] = adj[e.target] || []).push(e.source); });
  const seen = new Set([start]);
  let frontier = [start];
  for (let d = 0; d < depth; d++) {
    const next = [];
    frontier.forEach((x) => (adj[x] || []).forEach((y) => { if (!seen.has(y)) { seen.add(y); next.push(y); } }));
    frontier = next;
  }
  return seen;
}

test('mélység-csúszka fókuszban: a kiemelés újraszámolódik a rajzolt élek BFS-ével, a kamera újra illeszkedik', () => {
  const v = D.mountView({ storage: D.memStorage() });
  v.settle();
  const edges = plain(v.rec.last('setData').args[0].edges);
  const nodes = drawnIds(v);
  // a legnagyobb 2-lépés-többlettel bíró csúcs
  let best = null, gain = -1;
  nodes.forEach((id) => {
    const g = bfs(edges, id, 2).size - bfs(edges, id, 1).size;
    if (g > gain) { gain = g; best = id; }
  });
  assert.ok(gain > 0, 'van olyan csomópont, ahol a 2. mélység többet ad (' + gain + ')');
  const docId = best.replace(/^doc:/, '');
  v.handle.store.select(docId); v.settle();
  const expected = (d) => nodes.filter((id) => !bfs(edges, best, d).has(id));
  assert.deepEqual(ids(v.rec.last('setDimmed').args[0]), expected(1), 'mélység 1: a szomszédságon kívüliek halványak');
  assert.equal(v.rec.last('focusOn').args[1].depth, 1);

  v.rec.clear();
  v.moveSlider('depth', 2);
  assert.deepEqual(ids(v.rec.last('setDimmed').args[0]), expected(2), 'mélység 2');
  const fo = v.rec.last('focusOn');
  assert.equal(fo.args[0], best);
  assert.equal(fo.args[1].depth, 2);
  assert.equal(v.handle.machine.state, 'focused', 'a csúszka nem lép ki a fókuszból');
  assert.ok(expected(2).length < expected(1).length, 'több csomópont marad kiemelve');

  v.moveSlider('depth', 3);
  assert.deepEqual(ids(v.rec.last('setDimmed').args[0]), expected(3), 'mélység 3');
});

test('mélység-csúszka kijelölés NÉLKÜL: nincs újraszámolás / kamera-mozdulat; a következő kijelölés már az új mélységgel megy', () => {
  const v = D.mountView({ storage: D.memStorage() });
  v.settle();
  v.rec.clear();
  v.moveSlider('depth', 2);
  assert.equal(v.rec.of('setData').length, 0);
  assert.equal(v.rec.of('focusOn').length, 0);
  v.handle.store.select('d1'); v.settle();
  assert.equal(v.rec.last('focusOn').args[1].depth, 2);
});

test('mélység-csúszka aktív keresés mellett: a keresés halványítása marad (nem írja felül a fókusz)', () => {
  const v = miniView({ storage: D.memStorage() });
  v.settle();
  v.handle.store.select('a1'); v.settle();
  typeQuery(v, 'alfa');
  const before = ids(v.rec.last('setDimmed').args[0]);
  v.rec.clear();
  v.moveSlider('depth', 2);
  assert.equal(v.rec.of('focusOn').length, 0, 'keresés közben nincs kamera-újraillesztés');
  assert.deepEqual(before, ['doc:b1', 'doc:d1', 'doc:e1', 'doc:g1']);
});

// =====================================================================
// 4) Escape a panelben
// =====================================================================

test('Escape a panelben: bezárja a panelt, a fókusz a gombra kerül, és NEM zoomol ki', () => {
  const v = D.mountView({ storage: D.memStorage() });
  v.settle();
  v.handle.store.select('d1'); v.settle();
  assert.equal(v.handle.machine.state, 'focused');
  v.toggle().dispatchEvent({ type: 'click' });
  assert.equal(v.panel().hidden, false);
  assert.equal(v.toggle().getAttribute('aria-expanded'), 'true');
  v.rec.clear();

  const ev = v.key(v.slider('repel'), 'Escape');
  assert.equal(ev.propagationStopped(), true);
  assert.equal(v.panel().hidden, true);
  assert.equal(v.toggle().getAttribute('aria-expanded'), 'false');
  assert.equal(v.doc.activeElement, v.toggle(), 'a fókusz a nyitó gombra tér vissza');
  assert.equal(v.handle.machine.state, 'focused', 'nincs kizoomolás');
  assert.equal(v.handle.store.state.selectedId, 'd1');
  assert.equal(v.rec.of('toOverview').length, 0);
});

test('Escape a nyitó gombon (nyitott panel mellett) is csak a panelt zárja; zárt panelnél a következő Escape zoomol ki', () => {
  const v = D.mountView({ storage: D.memStorage() });
  v.settle();
  v.handle.store.select('d1'); v.settle();
  v.toggle().dispatchEvent({ type: 'click' });
  v.key(v.toggle(), 'Escape');
  assert.equal(v.panel().hidden, true);
  assert.equal(v.handle.machine.state, 'focused');
  v.key(v.toggle(), 'Escape');                       // a panel már zárt → ez a térkép Escape-je
  assert.equal(v.handle.machine.state, 'overview');
  assert.equal(v.handle.store.state.selectedId, null);
});

test('kontroll: Escape a panelen KÍVÜL (fókuszban) kizoomol — így az előző tesztek nem üresek', () => {
  const v = D.mountView({ storage: D.memStorage() });
  v.settle();
  v.handle.store.select('d1'); v.settle();
  v.key(v.q('.atlas__zoomout'), 'Escape');
  assert.equal(v.handle.machine.state, 'overview');
});

// =====================================================================
// 5) keresés: a setDimmed pontosan a NEM-találatokat kapja
// =====================================================================

test('keresés: setDimmed = pontosan a nem-találatok (a rajzolt halmaz nem szűkül); törléskor null', () => {
  const v = miniView({ storage: D.memStorage() });
  v.settle();
  assert.equal(v.rec.last('setDimmed').args[0], null, 'keresés nélkül nincs halványítás');
  const all = drawnIds(v);
  assert.deepEqual(all, ['doc:a1', 'doc:a2', 'doc:b1', 'doc:d1', 'doc:e1', 'doc:g1']);

  typeQuery(v, 'alfa');
  const dim = ids(v.rec.last('setDimmed').args[0]);
  assert.deepEqual(dim, ['doc:b1', 'doc:d1', 'doc:e1', 'doc:g1'], 'a halványítottak = a nem-találatok');
  assert.deepEqual(ids(v.rec.last('setHighlight').args[0].matchIds), ['doc:a1', 'doc:a2'], 'a találatok kiemeltek');
  assert.ok(!dim.includes('doc:a1') && !dim.includes('doc:a2'), 'egy találat sem halvány');
  assert.deepEqual(drawnIds(v), all, 'a térkép adatkészlete nem szűkült');
  assert.equal(v.handle.machine.state, 'searching');
  assert.deepEqual(ids(v.list.last().ids), ['a1', 'a2'], 'a lista a találatokat mutatja');

  typeQuery(v, '');
  assert.equal(v.rec.last('setDimmed').args[0], null);
  assert.equal(v.handle.machine.state, 'overview');
  assert.deepEqual(drawnIds(v), all);
});

test('keresés találat nélkül: MINDEN csomópont halvány, a térkép nem ürül ki, üres állapot + kiút', () => {
  const v = miniView({ storage: D.memStorage() });
  v.settle();
  typeQuery(v, 'zzzzqqqq');
  assert.equal(v.handle.machine.state, 'empty');
  assert.deepEqual(ids(v.rec.last('setDimmed').args[0]), drawnIds(v));
  assert.equal(drawnIds(v).length, 6);
  assert.equal(v.q('.atlas__empty').hidden, false);
  assert.match(v.q('.atlas__status').textContent, /Nincs találat/);
  v.q('[data-act="clear"]').dispatchEvent({ type: 'click' });
  assert.equal(v.handle.machine.state, 'overview');
  assert.equal(v.rec.last('setDimmed').args[0], null);
});

test('keresés debounce: 160 ms előtt nincs lekérdezés, utána egyszer fut', () => {
  const v = miniView({ storage: D.memStorage() });
  v.settle();
  const inp = v.q('.atlas__input');
  inp.value = 'alf'; inp.dispatchEvent({ type: 'input' });
  v.timers.advance(100);
  inp.value = 'alfa'; inp.dispatchEvent({ type: 'input' });
  v.timers.advance(159);
  assert.equal(v.handle.store.state.query, '');
  v.timers.advance(1);
  assert.equal(v.handle.store.state.query, 'alfa');
});

test('a keresés/szűrés/kijelölés nem rendezi át a térképet: azonos pozíciók, a szimuláció kihűlve marad', () => {
  const v = D.mountView({ storage: D.memStorage() });
  v.settle();
  const before = posOf(v);
  const setDataBefore = v.rec.of('setData').length;
  const q = v.data.docs[3].title.split(' ')[0].toLowerCase();
  typeQuery(v, q);
  typeQuery(v, '');
  clickFacet(v, 'onlyTpl'); clickFacet(v, 'onlyTpl');
  v.handle.store.select('d5'); v.settle();
  v.handle.store.select(null); v.settle();
  assert.ok(v.rec.of('setData').length > setDataBefore + 3, 'a nézet valóban újra átadta az adatot');
  assert.deepEqual(plain(posOf(v)), plain(before), 'bitre azonos pozíciók');
  assert.equal(v.dbg().settled, true);
});

// =====================================================================
// 6) szűrők → setExcluded + inert csomópont
// =====================================================================

test('szűrő (Sablon): setExcluded = a szűrőn kívüliek, a térkép nem szűkül, a lista a szűrt halmaz', () => {
  const v = miniView({ storage: D.memStorage() });
  v.settle();
  assert.equal(v.rec.last('setExcluded').args[0], null);
  clickFacet(v, 'onlyTpl');
  assert.equal(v.q('[data-facet="onlyTpl"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(ids(v.rec.last('setExcluded').args[0]), ['doc:a1', 'doc:a2', 'doc:d1', 'doc:e1']);
  assert.equal(drawnIds(v).length, 6, 'a kiesettek halványan ott maradnak');
  assert.deepEqual(ids(v.list.last().ids), ['b1', 'g1']);
  assert.match(v.q('.atlas__status').textContent, /halványan a térképen marad/);
  clickFacet(v, 'onlyTpl');
  assert.equal(v.rec.last('setExcluded').args[0], null, 'szűrő törlése → nincs kiesett');
});

test('státusz-szűrő és kategória-szűrő is a szűrőn kívülieket küldi a setExcluded-nek', () => {
  const v = miniView({ storage: D.memStorage() });
  v.settle();
  const cat = v.q('[data-catfilter-panel]') || v.doc.body.querySelector('[data-catfilter-panel]');
  const boxB = v.doc.body.querySelector('input[data-catopt="B"]');
  boxB.checked = true;
  boxB.dispatchEvent({ type: 'change' });
  v.raf.pump(5000);
  assert.ok(cat);
  assert.deepEqual(ids(v.rec.last('setExcluded').args[0]), ['doc:a1', 'doc:d1', 'doc:e1', 'doc:g1'], 'B kategória: a2 és b1 aktív');
  assert.deepEqual(ids(v.list.last().ids), ['a2', 'b1']);
});

test('szűrő, amire nincs dokumentum: minden csomópont kiesett, a térkép nem ürül ki, kiút van', () => {
  const v = miniView({ storage: D.memStorage() });
  v.settle();
  clickFacet(v, 'onlyFav');          // nincs kedvenc
  assert.equal(drawnIds(v).length, 6);
  assert.deepEqual(ids(v.rec.last('setExcluded').args[0]), drawnIds(v));
  assert.equal(v.q('.atlas__empty').hidden, false);
  assert.deepEqual(v.list.last().ids, []);
  v.q('[data-act="clear"]').dispatchEvent({ type: 'click' });
  assert.equal(v.q('.atlas__empty').hidden, true);
  assert.equal(v.rec.last('setExcluded').args[0], null);
  assert.equal(v.q('[data-facet="onlyFav"]').getAttribute('aria-pressed'), 'false');
});

test('a szűrőből kiesett csomópont inert: nem hoverelhető, nem választható, nem húzható; a bent lévő igen', () => {
  const v = miniView({ storage: D.memStorage() });
  v.settle();
  clickFacet(v, 'onlyTpl');
  const d = v.dbg();
  const excluded = new Set(v.rec.last('setExcluded').args[0]);
  const inc = d.nodes.filter((n) => !excluded.has(n.id));
  const exc = d.nodes.filter((n) => excluded.has(n.id));
  const dist = (a, b) => Math.hypot(a.screenX - b.screenX, a.screenY - b.screenY);
  // a legelszigeteltebb kiesett csomópont: egyetlen bent lévő sincs a találati körében
  const iso = exc.slice().sort((a, b) => Math.min(...inc.map((n) => dist(b, n))) - Math.min(...inc.map((n) => dist(a, n))))[0];
  assert.ok(Math.min(...inc.map((n) => dist(iso, n))) > iso.screenR + 40, 'a teszt-előfeltétel: elszigetelt kiesett csomópont');

  v.pointer('pointermove', iso.screenX, iso.screenY);
  assert.equal(v.handle.store.state.hoverId, null, 'kiesett csomópont nem hoverelhető');
  v.pointer('pointerdown', iso.screenX, iso.screenY);
  v.pointer('pointerup', iso.screenX, iso.screenY);
  assert.equal(v.handle.store.state.selectedId, null, 'nem választható');
  v.pointer('pointerdown', iso.screenX, iso.screenY);
  v.pointer('pointermove', iso.screenX + 30, iso.screenY);
  assert.equal(v.dbg().dragId, null, 'nem húzható (a gesztus pásztázás)');
  v.pointer('pointerup', iso.screenX + 30, iso.screenY);

  const keep = v.dbg().nodes.find((n) => !excluded.has(n.id));
  v.pointer('pointermove', keep.screenX, keep.screenY);
  assert.equal(v.handle.store.state.hoverId, keep.id.replace(/^doc:/, ''), 'a bent lévő hoverelhető');
  v.pointer('pointerdown', keep.screenX, keep.screenY);
  v.pointer('pointerup', keep.screenX, keep.screenY);
  assert.equal(v.handle.store.state.selectedId, keep.id.replace(/^doc:/, ''));
});

test('szűrés közben a kijelölés, ami kiesne a szűrt halmazból, elengedődik (nincs láthatatlan fókusz)', () => {
  const v = miniView({ storage: D.memStorage() });
  v.settle();
  v.handle.store.select('a1'); v.settle();
  assert.equal(v.handle.machine.state, 'focused');
  clickFacet(v, 'onlyTpl');          // a1 nem sablon
  assert.equal(v.handle.store.state.selectedId, null);
  assert.equal(v.handle.machine.state, 'overview');
});

test('keresés + szűrő együtt: a találatok csak a szűrt halmazból jönnek, a kiesettek exclude-ok, nem találatként halványak', () => {
  const v = miniView({ storage: D.memStorage() });
  v.settle();
  clickFacet(v, 'onlyTpl');
  typeQuery(v, 'gamma');
  assert.deepEqual(ids(v.rec.last('setHighlight').args[0].matchIds), ['doc:g1']);
  assert.deepEqual(ids(v.rec.last('setExcluded').args[0]), ['doc:a1', 'doc:a2', 'doc:d1', 'doc:e1']);
  assert.deepEqual(ids(v.rec.last('setDimmed').args[0]), ['doc:a1', 'doc:a2', 'doc:b1', 'doc:d1', 'doc:e1']);
});

// =====================================================================
// 7) kattintás / húzás a nézeten át
// =====================================================================

test('kattintás egy csomóponton: kijelölés + focusOn(depth); ugyanarra újra: vissza az áttekintésre; üres helyre: kizoomol', () => {
  const v = D.mountView({ storage: D.memStorage() });
  v.settle();
  const n = v.dbg().nodes[0];
  const docId = n.id.replace(/^doc:/, '');
  v.pointer('pointerdown', n.screenX, n.screenY);
  v.pointer('pointerup', n.screenX, n.screenY);
  v.raf.pump(5000);
  assert.equal(v.handle.store.state.selectedId, docId);
  assert.equal(v.handle.machine.state, 'focused');
  assert.equal(v.rec.last('focusOn').args[0], n.id);

  const n2 = v.dbg().nodes.find((q) => q.id === n.id);
  v.pointer('pointerdown', n2.screenX, n2.screenY);
  v.pointer('pointerup', n2.screenX, n2.screenY);
  v.raf.pump(5000);
  assert.equal(v.handle.store.state.selectedId, null, 'ugyanarra kattintva kikapcsol');
  assert.equal(v.handle.machine.state, 'overview');
});

test('húzás a nézeten át: nem választ ki, nem hív setData-t/focusOn-t, a csomópont követi a mutatót, hover a húzotton', () => {
  const v = D.mountView({ storage: D.memStorage() });
  v.settle();
  const n = v.dbg().nodes[4];
  const sd = v.rec.of('setData').length;
  v.pointer('pointerdown', n.screenX, n.screenY);
  v.pointer('pointermove', n.screenX + 40, n.screenY + 10);
  assert.equal(v.dbg().dragId, n.id);
  assert.equal(v.handle.store.state.hoverId, n.id.replace(/^doc:/, ''));
  v.pointer('pointermove', n.screenX + 80, n.screenY + 20);
  v.raf.pump(40);
  const mid = v.dbg().nodes.find((q) => q.id === n.id);
  assert.ok(Math.abs(mid.screenX - (n.screenX + 80)) < 3 && Math.abs(mid.screenY - (n.screenY + 20)) < 3, 'a mutatóhoz rögzül');
  v.pointer('pointerup', n.screenX + 80, n.screenY + 20);
  v.raf.pump(20000);
  assert.equal(v.handle.store.state.selectedId, null, 'a húzás nem választ ki');
  assert.equal(v.rec.of('focusOn').length, 0);
  assert.equal(v.rec.of('setData').length, sd, 'húzás közben nincs újraszámolás (az megszakítaná a húzást)');
  assert.equal(v.dbg().settled, true);
  assert.equal(v.dbg().dragId, null);
});

test('hover a listából: a térkép megkapja a kiemelést (docId → csomópont-id)', () => {
  const v = D.mountView({ storage: D.memStorage() });
  v.settle();
  v.handle.store.setHover('d2');
  assert.equal(v.rec.last('setHighlight').args[0].hoverId, 'doc:d2');
  v.handle.store.setHover(null);
  assert.equal(v.rec.last('setHighlight').args[0].hoverId, null);
});

// =====================================================================
// 8) téma-váltás: refreshColors újramontálás nélkül
// =====================================================================

test('téma-váltás: refreshColors → az új színek a következő képkockán; nincs új renderer, nincs setData, a pozíciók a helyükön', () => {
  const vars = {};
  for (let i = 1; i <= 8; i++) vars['--catcolor-' + i] = '#111111';
  vars['--secondary'] = '#111111';
  const v = D.mountView({ storage: D.memStorage(), cssVars: vars });
  v.settle();
  const ctx2d = v.rec.canvas.ctx2d;
  const before = plain(posOf(v));
  const setDataN = v.rec.of('setData').length;

  ctx2d.calls.arcs.length = 0;
  v.rec.renderer.setHighlight({}); v.raf.pump(5000);
  const oldFills = new Set(ctx2d.calls.arcs.map((a) => a.fill));
  assert.ok(oldFills.has('#111111'), 'előfeltétel: a régi szín rajzolódik');

  for (let i = 1; i <= 8; i++) v.cssVars['--catcolor-' + i] = '#eeeeee';
  v.cssVars['--secondary'] = '#eeeeee';
  v.handle.refreshColors();
  v.raf.pump(5000);

  assert.equal(v.rec.of('refreshColors').length, 1, 'a renderer pontosan egy refreshColors-t kapott a nézettől');
  assert.ok(v.field.calls.filter((c) => c === 'refreshColors').length >= 1, 'az ambient mező is');
  ctx2d.calls.arcs.length = 0;
  v.rec.renderer.setHighlight({}); v.raf.pump(5000);
  const newFills = new Set(ctx2d.calls.arcs.map((a) => a.fill));
  assert.deepEqual([...newFills].filter((c) => c === '#111111'), [], 'a régi szín eltűnt');
  assert.ok(newFills.has('#eeeeee'));
  assert.equal(v.rec.created, 1, 'nincs újramontálás');
  assert.equal(v.rec.of('setData').length, setDataN, 'nincs újra-setData');
  assert.deepEqual(plain(posOf(v)), before, 'az elrendezés érintetlen');
});

// =====================================================================
// 9) életciklus: destroy
// =====================================================================

test('destroy: nincs árva figyelő a document/window/canvas-on, a DOM és a portál-panel eltűnik, nincs újabb renderer-hívás', () => {
  const v = D.mountView({ storage: D.memStorage() });
  v.settle();
  v.toggle().dispatchEvent({ type: 'click' });
  const catControl = v.q('[data-catfilter-control]');
  catControl.dispatchEvent({ type: 'click' });            // a kategória-panel nyitva (window resize/scroll figyelők)
  assert.ok(v.doc.listenerCount() > 0);
  v.handle.destroy();
  assert.equal(v.doc.listenerCount(), 0, 'document figyelők: ' + JSON.stringify(Object.keys(v.doc.listeners).filter((k) => v.doc.listeners[k].length)));
  assert.deepEqual(Object.values(v.winListeners).map((a) => a.length).filter((n) => n), [], 'window figyelők');
  assert.equal(v.rec.canvas.listenerCount(), 0, 'canvas figyelők');
  assert.equal(v.container.children.length, 0, 'a gyökér eltűnt');
  assert.equal(v.doc.body.children.filter((c) => c.attrs['data-catfilter-panel'] !== undefined).length, 0, 'a portálozott panel is');
  assert.equal(v.list.destroyed, true);
  assert.equal(v.raf.pending(), 0);
  v.rec.clear();
  v.handle.store.select('d1');
  v.handle.store.setQuery('x');
  v.timers.advance(2000); v.raf.pump(100);
  assert.deepEqual(v.rec.calls.map((c) => c.m), [], 'destroy után a renderer nem kap hívást');
});

test('destroy a betöltés (READY) előtt: a késleltetett READY nem fut le', () => {
  const v = D.mountView({ storage: D.memStorage() });
  assert.equal(v.handle.machine.state, 'loading');
  v.handle.destroy();
  v.rec.clear();
  assert.doesNotThrow(() => v.timers.advance(2000));
  assert.equal(v.handle.machine.state, 'loading');
  assert.equal(v.rec.of('toOverview').length, 0);
});

test('destroy húzás közben: nincs kivétel, nincs árva ciklus; a későbbi pointer-események hatástalanok', () => {
  const v = D.mountView({ storage: D.memStorage() });
  v.settle();
  const n = v.dbg().nodes[3];
  v.pointer('pointerdown', n.screenX, n.screenY);
  v.pointer('pointermove', n.screenX + 30, n.screenY + 30);
  assert.equal(v.dbg().dragId, n.id);
  assert.doesNotThrow(() => v.handle.destroy());
  assert.doesNotThrow(() => {
    v.pointer('pointermove', 10, 10);
    v.pointer('pointerup', 10, 10);
    v.raf.pump(100);
    v.timers.advance(1000);
  });
  assert.equal(v.raf.pending(), 0);
  assert.equal(v.timers.pending(), 0);
});

// =====================================================================
// 10) DEFEKT: >150 dokumentum — a kijelölt, de az áttekintésből kimaradó dokumentum nincs a térképen
// =====================================================================

test('DEFECT: 300 dokumentumnál a listából kijelölt, az áttekintés top-150-éből kimaradó dokumentum is rajzolódik és fókuszba kerül', () => {
  // atlasView.js recompute(): `mergeViews(overview, nb)` — az ÁTTEKINTÉS áll elöl, a renderer pedig az
  // első 150 csomópontnál vág (MAX_VISIBLE), így a 150 elemű áttekintés mögé fűzött szomszédság
  // (benne a kijelölt csomóponttal) lemarad. A komment szerint a szűkebb halmaznak kellene elöl állnia.
  const v = D.mountView({ docCount: 300, storage: D.memStorage() });
  v.settle();
  const drawn0 = new Set(drawnIds(v));
  assert.equal(drawn0.size, 150, 'előfeltétel: az áttekintés telt (150)');
  const missing = v.data.docs.find((d) => !drawn0.has('doc:' + d.id));
  assert.ok(missing, 'előfeltétel: van az áttekintésből kimaradó dokumentum (a lista viszont mutatja)');
  assert.ok(v.list.last().ids.includes(missing.id), 'a lista mutatja a dokumentumot');

  v.handle.store.select(missing.id); v.settle();
  const after = drawnIds(v);
  assert.ok(after.includes('doc:' + missing.id), 'a kijelölt dokumentum nincs a térképen (a focusOn csendben nem csinál semmit)');
  const me = v.dbg().nodes.find((n) => n.id === 'doc:' + missing.id);
  assert.ok(me && me.screenX >= 0 && me.screenX <= 800 && me.screenY >= 0 && me.screenY <= 600, 'a fókusz után a képernyőn van');
});

// =====================================================================
// 11) ismert, NEM blokkoló eltérések (todo: piros, de nem bukik a futás)
// =====================================================================

test('DEFECT (Minor, korábbi): kijelölés → keresés → a keresés törlése után az FSM nem marad `searching`-ben, és az Esc kizoomol',
  { todo: 'Minor, a változás előtti viselkedés: a keresés törlése kijelöléssel nem küld FSM-eseményt' }, () => {
    const v = D.mountView({ storage: D.memStorage() });
    v.settle();
    v.handle.store.select('d3'); v.settle();
    typeQuery(v, 'adat');
    typeQuery(v, '');
    assert.equal(v.handle.store.state.selectedId, 'd3');
    assert.equal(v.handle.machine.state, 'focused', 'az FSM tükrözze a megmaradt kijelölést');
    v.key(v.q('.atlas__input'), 'Escape');
    assert.equal(v.handle.machine.state, 'overview');
  });

test('DEFECT (Minor): sérült tároló üres string értéke (`"repel": ""`) alapértékre essen vissza, ne 0-ra',
  { todo: 'Minor: +"" === 0, ezért az üres/bool/tömb érték a tartomány aljára vágódik' }, () => {
    const st = D.memStorage([['tb-atlas-settings', JSON.stringify({ v: 1, repel: '', center: true, linkDistance: [] })]]);
    const v = D.mountView({ storage: st });
    assert.deepEqual(['repel', 'center', 'linkDistance'].map((k) => +v.slider(k).value), [10, 0.52, 250]);
  });

test('DEFECT (Minor): „Csak lista" után a láthatóság-váltás (tab vissza) ne indítsa újra a rejtett térkép rAF-ciklusát',
  { todo: 'Minor, korábbi: a renderer onVisibility() nem tud a Csak lista módról' }, () => {
    const v = D.mountView({ storage: D.memStorage() });
    v.settle();
    v.q('[data-toggle="listonly"]').dispatchEvent({ type: 'click' });
    assert.equal(v.dbg().running, false);
    v.doc.hidden = true;  v.doc.listeners.visibilitychange.forEach((f) => f());
    v.doc.hidden = false; v.doc.listeners.visibilitychange.forEach((f) => f());
    assert.equal(v.dbg().running, false, 'a rejtett térkép nem pörög');
  });
