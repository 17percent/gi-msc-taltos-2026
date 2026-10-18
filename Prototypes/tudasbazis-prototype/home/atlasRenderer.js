/* atlasRenderer.js — az Élő Atlasz kurált térképe (Canvas 2D). Önálló modul.
 *
 * A `graphModel` egy getterének eredményét rajzolja: dokumentum-csomópont + él +
 * címke. Kezeli a kamerát (pan/zoom, tween), a viewport-cullingot, a címke-
 * ütközést és a rács-alapú hit-testet.
 *
 * ÉLŐ ELRENDEZÉS (D28). A pozíciót a renderer saját erő-szimulációja adja
 * (`forceSim.js`), mert a pozíció NÉZET-állapot. A szimulációt a meglévő rAF-
 * ciklus hajtja, FIX 60 Hz-es lépéssel és akkumulátorral (képkocka-független;
 * legfeljebb `MAX_SIM_STEPS` lépés / képkocka, a maradék eldobva). A pozíciók id
 * szerint megmaradnak `setData` között: ugyanaz a csomópont- és élhalmaz NEM
 * indítja újra a szimulációt (szűrés, keresés, kiválasztás nem rendezi át a
 * térképet); új halmaznál az ismert csomópontok a helyükön maradnak, az újak a
 * szomszédaik mellé kerülnek, és α = 0,3-ra melegszik.
 * A modell x,y-ját csak a LEGELSŐ betöltés használja kezdőállapotnak
 * (determinisztikus phyllotaxis); ott egy rövid szinkron előfuttatás után
 * (α ≤ `PRESETTLE_ALPHA`) a térkép élőben nyugszik meg.
 *
 * A CIKLUS LEÁLL, ha semmi nem mozog: kihűlt szimuláció (α < 0,001, nincs húzás),
 * nyugvó kamera (tween + áttekintés-követés), beállt hover-halványítás. Egyetlen
 * kivétel: kijelölt/hoverelt csomópont glória-pulzálása, ami eddig is folyamatos
 * animáció volt — amíg az látszik, a ciklus fut.
 * Reduced motion: NINCS ciklus. Minden felmelegítés után a szimuláció szinkron
 * fut a nyugalomig, és egyetlen statikus képkocka készül; a húzás így is működik.
 *
 * INTERAKCIÓ. A csomópont húzható: 5 px alatt a mozdulat kattintás (kiválasztás),
 * fölötte a csomópont a mutatóhoz rögzül (fx/fy), a szimuláció melegen marad,
 * elengedéskor kb. 4 s alatt megnyugszik. A háttér húzása továbbra is pásztáz.
 * A húzás csak elrendezés-finomítás: minden funkció elérhető húzás nélkül
 * (kattintás, billentyűzet, lista — WCAG 2.5.7).
 * Hover: a hoverelt (vagy húzott) csomópont és közvetlen szomszédai teljes
 * alfával, minden más 0,2-re halványul, IDŐALAPÚ easinggel: k = 1 − 0,9^(dt/16,67).
 *
 * CÍMKÉK. Alfa = clamp(log₂(zoom) + 1 − T, 0, 1) (Obsidian „text fade threshold").
 * A „zoom" itt a NÉZET-ARÁNY: `camZ / ovZoom`, vagyis az áttekintés illesztése
 * = 1×. Így T = 0 mellett az áttekintésben a (budget szerinti) címkék teljesen
 * látszanak, 0,5× alatt eltűnnek — ez kijelzőmérettől és korpusztól független,
 * ellentétben a nyers px/világ-egység skálával, ami a bbox-illesztés miatt
 * korpuszonként mást jelentene. A budget és az ütközés-vágás változatlan.
 *
 * CSOMÓPONT-MÉRET: egységes (D-2). A rajzolt sugár a modell sugara × √zoom
 * (Obsidian-szerű), kattinthatósági padlóval. Az átfedés-mentességet a
 * szimuláció ütközés-ereje adja (nyugalomban a középpontok ≥ ~2·60 világ-
 * egységre), a rajzolt sugár felső korlátja pedig ennek a fele az aktuális
 * skálán (`restCapR`) — így NYUGALOMBAN semmilyen zoomon nincs átfedés. Húzás
 * és megnyugvás közben átmeneti átfedés lehet (D28 kimondott ára).
 * (A korábbi `capScreenR`/`computeMinGap` mérés kikerült.)
 *
 * Nem dönt állapotot: a kiemelést és a kamerát a view vezérli. Színt SOSEM éget be —
 * a design tokeneket olvassa (getComputedStyle), így témával EGYÜTT vált.
 *
 * Publikus API:
 *   createAtlasRenderer(canvas, { intensity, reducedMotion, onHover, onSelect, onViewport, forces, labelFade })
 *     .setData({ nodes, edges })
 *     .setHighlight({ selectedId, hoverId, matchIds })   // csak vizuális, kamerát nem mozgat
 *     .focusOn(id, { animate: true, depth: 1 })          // fit-to-bounds a csomópont `depth` mélységű környezetére
 *     .toOverview({ animate: true })                     // sólyom-nézet
 *     .setDimmed(idsOrNull) .setExcluded(idsOrNull) .getNodeScreenRect(id)
 *     .setSettings({ forces, labelFade })                // erő-paraméterek (→ α = 0,3) és címke-küszöb T
 *     .getDebugState()                                   // diagnosztika/teszt: α, pozíciók, halványítás
 *     .start() .stop() .resize() .refreshColors() .destroy()
 *   createAtlasRenderer.labelAlpha(zoom, T)               // tiszta függvény (a fenti képlet)
 *
 * Két, KÜLÖNBÖZŐ erősségű háttérbe-tolás — ne keverd őket:
 *   `setDimmed`   — lágy elhalkítás (keresés nem-találatai, fókusz szomszédságán
 *                   kívüliek). A csomópont TOVÁBBRA IS kattintható: így lehet a
 *                   gráfban továbblépni egy szomszédra.
 *   `setExcluded` — a szűrőből kiesett dokumentum: halvány ÜRES karika, nincs
 *                   felirata, és NEM kattintható (inert). Azért marad ott, hogy
 *                   lásd, van még tudás a szűrőn túl — de amire nem szűrtél, azon
 *                   nem is tudsz cselekedni (a listában sem lenne sora).
 *
 * Teljesítmény: egyetlen rAF, előre lefoglalt tömbök (nincs per-frame allokáció),
 * ≤150 látható csomópont, DPR sapka 2, `visibilitychange`-re megáll.
 */
(function (global) {
  'use strict';

  var WORLD_SPAN = 1000;                  // a graphModel 0..1000 világot ad
  var MAX_VISIBLE = 150;                  // kemény sapka — efölött nem rajzolunk
  var MAX_LABELS = 32;                    // címke-ütközési budget

  var INTENSITY = {
    calm: { glow: 0.75, edge: 0.85, labels: 22, pulse: 0.6 },
    balanced: { glow: 1.00, edge: 1.00, labels: 28, pulse: 1.0 },
    vivid: { glow: 1.30, edge: 1.20, labels: 32, pulse: 1.3 }
  };

  // Zoom → részletesség FOLYTONOS leképezése (nincs discrete LOD-szint, nincs
  // szint-crossfade — maga a kameraz-zoom már easelt, ez csak levezeti belőle).
  var ZOOM_DETAIL_SPAN = 1.6;              // ennyi zoomRatio-nyi sávon fut 0→1 a részletesség
  function smooth01(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

  // Él-fényerő. Az élek ALAPÉRTELMEZETTEN halványan, de LÁTHATÓAN ott vannak — a
  // kapcsolati szövet a térkép fő olvasata, nem díszítés. Hover (vagy kijelölés)
  // hatására a csomópontba futó élek élénk `--accent`-re váltanak: a kiemelt
  // alfa szándékosan NEM skálázódik a zoommal, hogy áttekintésben is ugyanolyan
  // egyértelmű legyen, mint közelről.
  var EDGE_A_BASE = 0.20;                  // a legkisebb súlyú él alap-alfája
  var EDGE_A_WEIGHT = 0.16;                // súly szerinti ráadás az alapra
  var EDGE_A_HI = 0.62;                    // kiemelt (hover/kijelölt) él alfája
  var EDGE_A_HI_WEIGHT = 0.30;             // súly szerinti ráadás a kiemeltre
  var EDGE_W_HI = 1.75;                    // kiemelt él vonalvastagsága (px)
  var EDGE_A_EXCLUDED = 0.3;               // szűrőből kiesett végpont → visszahúzódik

  // Kattinthatósági padló: a KIRAJZOLT sugár nem esik ez alá attól, hogy a térkép-
  // panel kicsi vagy a kamera kizoomolt. A hit-test ezen felül még +6 px-t ad.
  // FIGYELEM: a padló nem előzi meg a felső korlátot (`restCapR`) — ha a nyugalmi
  // térköz az adott skálán szűkebb, a korlát nyer (az átfedés-mentesség az erősebb).
  var MIN_NODE_R = 7;
  // Ennyi px rés maradjon két kör pereme között a nyugalmi (ütközési) térköznél.
  var NODE_GAP_KEEP = 1.5;
  var CAT_PALETTE_SIZE = 8;
  var SPRITE_PX = 64;                      // a többkategóriás színátmenet sprite mérete

  // ---------- élő szimuláció (D28) ----------
  var SIM_STEP_MS = 1000 / 60;             // fix 60 Hz-es szimulációs lépés
  var MAX_SIM_STEPS = 4;                   // lépés-sapka képkockánként (lassú gépen nem „spirálozik")
  var PRESETTLE_ALPHA = 0.1;               // első betöltés: szinkron előfuttatás eddig az α-ig
  var REDUCED_DRAG_TICKS = 24;             // reduced motion: lépések húzás-mozdulatonként (szinkron)
  var DRAG_THRESHOLD = 5;                  // px — alatta kattintás, fölötte húzás
  var HOVER_FADE = 0.2;                    // nem-szomszéd alfa hover közben
  var FADE_BASE = 0.9;                     // k = 1 − 0,9^(dt/16,67)
  var FRAME_MS = 16.67;
  var FOLLOW_BASE = 0.85;                  // áttekintés-követés simítása (időalapú, mint a fade)

  // címkealfa = clamp(log₂(zoom) + 1 − T, 0, 1) — zoom = nézet-arány (áttekintés = 1×)
  function labelAlpha(zoom, T) {
    if (!(zoom > 0)) return 0;
    var a = Math.log(zoom) / Math.LN2 + 1 - (+T || 0);
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }

  function createAtlasRenderer(canvas, options) {
    options = options || {};
    var cfg = INTENSITY[options.intensity] || INTENSITY.balanced;
    var reduced = !!options.reducedMotion;
    var onHover = typeof options.onHover === 'function' ? options.onHover : noop;
    var onSelect = typeof options.onSelect === 'function' ? options.onSelect : noop;
    // A nézetben lévő csomópontokat jelenti a hívónak.
    // Opcionális: ha nincs feliratkozó, a látható halmaz jelzését KI IS HAGYJUK
    // (nem csak noop-ra hívjuk) — így kamera-mozgásonként nem épül fel egy
    // id-lista senkinek. A kezdőoldal ma nem használja: a lista tartalma nem
    // követi a kamerát.
    var onViewport = typeof options.onViewport === 'function' ? options.onViewport : null;

    function noop() {}

    var ctx = canvas.getContext('2d');
    var dpr = 1, W = 0, H = 0;

    // ---------- adat: párhuzamos tömbök (nincs frame-allokáció) ----------
    var cap = 0;                            // lefoglalt kapacitás
    var nCount = 0;
    var nx, ny, nr, nw, ntype, nsx, nsy, nscr, nvis, nmatch, ndim, nout, nlabelW;
    var nfade, nfadeT, nhov, simIdx;        // hover-halványítás (jelen/cél), hover-szomszéd jelző, sim-index
    var nid = [], nlabel = [], ncat = [];    // ncat[i] = kategória paletta-slotok tömbje
    var idIndex = {};
    var order;                              // Int32Array — súly szerint csökkenő festési/címke-sorrend

    var eCap = 0, eCount = 0;
    var ea, eb, ew, ehl;                    // hl = a kijelölt szomszédságában van-e

    // szomszédság CSR (a kijelölt szomszédság kiemeléséhez, fit-to-boundshoz)
    var nbStart, nbList;

    // rács-index (hit-test) — CSR
    var G = 1, gx0 = 0, gy0 = 0, gw = 1, gh = 1;
    var cellStart, cellItems;

    // világ-befoglaló + kamera
    var bMinX = 0, bMinY = 0, bMaxX = WORLD_SPAN, bMaxY = WORLD_SPAN;
    var fitBase = 1;                        // px / világ-egység zoom 1-en

    // élő szimuláció — a renderer birtokolja (a pozíció nézet-állapot)
    var createSim = global.createForceSim;
    var COLLIDE_R = createSim && createSim.CONSTANTS ? createSim.CONSTANTS.COLLIDE_R : 60;
    var sim = null, simSig = '';
    var posCache = {};                      // id -> { x, y }: a pozíció túléli a setData-t
    var hasCache = false;
    // fizikai paraméterek (nem csúszka-pozíciók) — a csúszka→paraméter leképezés a forceSim-é
    var forceParams = options.forces || (createSim ? createSim.sliderToParams(createSim.DEFAULT_SLIDERS) : null);
    var labelT = +options.labelFade || 0;   // címke-küszöb (T)
    var simAcc = 0;                         // fix lépésű akkumulátor (ms)
    var hoverK = 0;                         // 0..1 — a hover-halványítás simított erőssége (élekhez)
    var dragIdx = -1;                       // a húzott csomópont (renderer-index)
    var ovZoom = 1, ovX = WORLD_SPAN / 2, ovY = WORLD_SPAN / 2;
    var camX = WORLD_SPAN / 2, camY = WORLD_SPAN / 2, camZ = 1;
    var frX = camX, frY = camY, frZ = camZ;  // tween-kezdet
    var toX = camX, toY = camY, toZ = camZ;  // tween-cél
    var camT = 1, camDur = 400;
    var camReady = false;
    var camTouched = false;                 // igaz, ha a felhasználó/fókusz már mozgatta a kamerát

    // folytonos részlet-paraméterek (a zoomból, nem discrete LOD-ból)
    var P = { docAlpha: 0.55, docLabel: 0.15, docLabelTop: 5, edge: 0.75 };

    // kiemelés
    var selectedId = null, hoverId = null, selIdx = -1, hovIdx = -1;
    var dimActive = false, outActive = false;
    var phase = 0;

    // színek (tokenekből)
    var col = {
      primary: '#1F5C4C', secondary: '#29528C', accent: '#C9861A',
      text: '#1A1712', textMuted: '#6B6355', textSubtle: '#7A7264', surface: '#FFFFFF',
      border: '#DDD6C8', borderStrong: '#BFB7A6',
      edgeStr: 'rgb(191,183,166)', edgeHiStr: 'rgb(201,134,26)',
      fontBody: 'Inter, sans-serif', docFontPx: 12, fontDocBase: '500 12px Inter',
      cat: []                               // kategória-paletta (--catcolor-1..8), 1-alapú indexeléssel
    };
    var fontCache = {};                     // méret → font-string (nincs frame-enkénti string-építés)
    var spriteCache = {};                   // "1-4" → offscreen canvas a többkategóriás átmenethez
    var ease = defaultEase;

    // címke-ütközés: előre lefoglalt téglalapok
    var labelRects = new Float32Array(MAX_LABELS * 4);
    var labelUsed = 0;
    var labelBudget = cfg.labels;

    // ---------- segédek ----------
    function defaultEase(t) { return 1 - Math.pow(1 - t, 3); }

    function readVar(name, fallback) {
      var v = getComputedStyle(canvas).getPropertyValue(name);
      v = v ? v.replace(/^\s+|\s+$/g, '') : '';
      return v || fallback;
    }

    function toRGB(str) {
      str = (str || '').replace(/^\s+|\s+$/g, '');
      if (str.charAt(0) === '#') {
        if (str.length === 4) {
          return [parseInt(str.charAt(1) + str.charAt(1), 16),
                  parseInt(str.charAt(2) + str.charAt(2), 16),
                  parseInt(str.charAt(3) + str.charAt(3), 16)];
        }
        return [parseInt(str.slice(1, 3), 16), parseInt(str.slice(3, 5), 16), parseInt(str.slice(5, 7), 16)];
      }
      var m = str.match(/(\d+(?:\.\d+)?)/g);
      if (m && m.length >= 3) return [+m[0], +m[1], +m[2]];
      return [128, 128, 128];
    }

    // CSS-hossz → px. Ismert egység: px, rem (gyökér betűmérete), em (a kanvasz
    // betűmérete, ennek híján a gyökéré); egység nélkül px. Hibás / nem pozitív
    // érték → fallback.
    function fontSizeOf(el) {
      try {
        var v = parseFloat(getComputedStyle(el).fontSize);
        return v > 0 ? v : 0;
      } catch (e) { return 0; }
    }
    function cssLengthPx(str, fallback) {
      str = (str || '').replace(/^\s+|\s+$/g, '');
      var m = str.match(/^(-?\d*\.?\d+)\s*(px|rem|em)?$/i);
      if (!m) return fallback;
      var n = parseFloat(m[1]), unit = (m[2] || 'px').toLowerCase(), base;
      if (unit === 'rem' || unit === 'em') {
        base = (unit === 'em' ? fontSizeOf(canvas) : 0) ||
               (document.documentElement ? fontSizeOf(document.documentElement) : 0) || 16;
        n *= base;
      }
      return n > 0 && isFinite(n) ? n : fallback;
    }

    function parseMs(str, fallback) {
      if (!str) return fallback;
      var v = parseFloat(str);
      if (isNaN(v)) return fallback;
      return str.indexOf('ms') >= 0 ? v : (str.indexOf('s') >= 0 ? v * 1000 : v);
    }

    // cubic-bezier(…) → időfüggvény (Newton-közelítés, allokáció nélkül fut)
    function makeEase(str) {
      var m = str && str.match(/cubic-bezier\(([^)]+)\)/);
      if (!m) return defaultEase;
      var p = m[1].split(',');
      if (p.length < 4) return defaultEase;
      var x1 = parseFloat(p[0]), y1 = parseFloat(p[1]), x2 = parseFloat(p[2]), y2 = parseFloat(p[3]);
      if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) return defaultEase;
      function bx(t) { var u = 1 - t; return 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t; }
      function by(t) { var u = 1 - t; return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t; }
      return function (x) {
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        var t = x, i, e2, d;
        for (i = 0; i < 6; i++) {
          e2 = bx(t) - x;
          if (e2 > -0.0005 && e2 < 0.0005) break;
          d = 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
          if (d < 0.0001 && d > -0.0001) break;
          t -= e2 / d;
          if (t < 0) t = 0; else if (t > 1) t = 1;
        }
        return by(t);
      };
    }

    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

    function refreshColors() {
      col.primary = readVar('--primary', '#1F5C4C');
      col.secondary = readVar('--secondary', '#29528C');
      col.accent = readVar('--accent', '#C9861A');
      col.text = readVar('--text', '#1A1712');
      col.textMuted = readVar('--text-muted', '#6B6355');
      // a szűrőből kiesett csomópontok karikája — mindkét témában halvány, de
      // biztosan látható (a `--border` ehhez már kevés lenne sötét témán)
      col.textSubtle = readVar('--text-subtle', '#7A7264');
      col.surface = readVar('--surface', '#FFFFFF');
      col.border = readVar('--border', '#DDD6C8');
      col.borderStrong = readVar('--border-strong', '#BFB7A6');
      col.fontBody = readVar('--font-body', 'Inter, sans-serif');
      // A token rem-ben van (`--text-xs: .75rem`): px-re KELL oldani, különben
      // `Math.round(0.75)` = 1 px-es (láthatatlan) címke lesz.
      col.docFontPx = Math.round(cssLengthPx(readVar('--text-xs', ''), 12));
      col.fontDocBase = '500 ' + col.docFontPx + 'px ' + col.fontBody;
      fontCache = {};
      // kategória-paletta a tokenekből (témával vált) — a sprite-cache dobandó
      col.cat = [null];
      for (var ci = 1; ci <= CAT_PALETTE_SIZE; ci++) {
        col.cat[ci] = readVar('--catcolor-' + ci, col.secondary);
      }
      spriteCache = {};

      var e1 = toRGB(col.border);
      col.edgeStr = 'rgb(' + e1[0] + ',' + e1[1] + ',' + e1[2] + ')';
      // Hoverelt/kijelölt szomszédság: az él szinte tisztán --accent (csak egy
      // csipet keret-szín marad benne, hogy a térkép meleg hangját tartsa) — ez
      // adja az „élénkebb szín" olvasatot a halvány alaphálóhoz képest.
      var e2 = toRGB(col.accent);
      col.edgeHiStr = 'rgb(' + Math.round(e1[0] * 0.2 + e2[0] * 0.8) + ',' +
        Math.round(e1[1] * 0.2 + e2[1] * 0.8) + ',' +
        Math.round(e1[2] * 0.2 + e2[2] * 0.8) + ')';

      camDur = parseMs(readVar('--duration-slow', '400ms'), 400);
      ease = makeEase(readVar('--ease-grow', 'cubic-bezier(.22,1,.36,1)'));

      if (nlabelW) { for (var i = 0; i < nCount; i++) nlabelW[i] = -1; }   // szélesség-cache dobás
      requestDraw();
    }

    // ---------- kapacitás ----------
    function ensureNodeCap(n) {
      if (cap > 0 && n <= cap) return;
      cap = Math.max(176, n + 32);
      nx = new Float32Array(cap); ny = new Float32Array(cap);
      nr = new Float32Array(cap); nw = new Float32Array(cap);
      ntype = new Uint8Array(cap);
      nsx = new Float32Array(cap); nsy = new Float32Array(cap); nscr = new Float32Array(cap);
      nvis = new Uint8Array(cap); nmatch = new Uint8Array(cap);
      ndim = new Uint8Array(cap); nout = new Uint8Array(cap);
      nlabelW = new Float32Array(cap);
      nfade = new Float32Array(cap); nfadeT = new Float32Array(cap); nhov = new Uint8Array(cap);
      simIdx = new Int32Array(cap);
      order = new Int32Array(cap);
      nbStart = new Int32Array(cap + 1);
    }
    function ensureEdgeCap(n) {
      if (eCap > 0 && n <= eCap) return;
      eCap = Math.max(64, n + 32);
      ea = new Int32Array(eCap); eb = new Int32Array(eCap);
      ew = new Float32Array(eCap); ehl = new Uint8Array(eCap);
      nbList = new Int32Array(eCap * 2);
    }

    function typeCode(t) { return t === 'person' ? 2 : 1; }   // 1 = dokumentum (alap), 2 = személy (Tier 1+)

    // ---------- adatbetöltés ----------
    function setData(view) {
      view = view || {};
      var vn = view.nodes || [], ve = view.edges || [];
      var n = Math.min(vn.length, MAX_VISIBLE);

      ensureNodeCap(n);
      idIndex = {};
      // Folyamatban lévő húzás: a rögzítést ELŐBB oldjuk (amíg `nid` még a régi),
      // különben azonos halmaznál a szimuláció örökre rögzítve, melegen maradna
      // (α ≡ 0,3, a ciklus sosem áll le), mert a pointerup már nem találja.
      if (dragIdx >= 0) {
        if (sim) sim.unpin(nid[dragIdx]);
        dragIdx = -1;
        dragging = false; dragMoved = false;
      }
      nid.length = 0; nlabel.length = 0; ncat.length = 0;
      nCount = 0;

      var i, nd;
      for (i = 0; i < n; i++) {
        nd = vn[i];
        if (!nd || !nd.id) continue;
        idIndex[nd.id] = nCount;
        nid.push(nd.id);
        nlabel.push(nd.label == null ? '' : String(nd.label));
        ncat.push(nd.catSlots && nd.catSlots.length ? nd.catSlots : null);
        nx[nCount] = +nd.x || 0;
        ny[nCount] = +nd.y || 0;
        nr[nCount] = nd.r > 0 ? +nd.r : 5;
        nw[nCount] = +nd.weight || 0;
        ntype[nCount] = typeCode(nd.type);
        nmatch[nCount] = 0; ndim[nCount] = 0; nout[nCount] = 0; nlabelW[nCount] = -1;
        nfade[nCount] = 1; nfadeT[nCount] = 1; nhov[nCount] = 0;
        nCount++;
      }
      dragIdx = -1;                         // új adathalmaznál nincs folyamatban lévő húzás
      outActive = false;      // az új adathalmazra a hívó újra kiadja a setExcluded-et

      // festési ÉS címke-sorrend: súly szerint csökkenő (a súlyosabb kerül felülre,
      // és előbb kap feliratot)
      var tmp = [];
      for (i = 0; i < nCount; i++) tmp.push(i);
      tmp.sort(function (a2, b2) {
        var d = nw[b2] - nw[a2];
        if (d) return d;
        return nid[a2] < nid[b2] ? -1 : 1;
      });
      for (i = 0; i < nCount; i++) order[i] = tmp[i];

      // élek
      ensureEdgeCap(ve.length);
      eCount = 0;
      var si, ti;
      for (i = 0; i < ve.length; i++) {
        if (!ve[i]) continue;
        si = idIndex[ve[i].source]; ti = idIndex[ve[i].target];
        if (si == null || ti == null || si === ti) continue;
        ea[eCount] = si; eb[eCount] = ti;
        ew[eCount] = +ve[i].weight || 1;
        ehl[eCount] = 0;
        eCount++;
      }
      buildAdjacency();

      syncSimulation();
      computeBounds();
      buildGrid();
      selIdx = selectedId != null && idIndex[selectedId] != null ? idIndex[selectedId] : -1;
      hovIdx = hoverId != null && idIndex[hoverId] != null ? idIndex[hoverId] : -1;
      markSelectedEdges();
      updateHoverTargets(true);

      // Amíg a felhasználó nem mozgatta a kamerát (nincs pan/zoom/fókusz), az
      // ÚJ adathalmaz áttekintésére illesztünk. Ez azért kell, mert a szűrés
      // megváltoztatja a befoglalót (és így az `ovZoom`-ot): ha a kamera a régi
      // értéken maradna, a térkép „zoomoltnak" tűnne az új adathoz képest, és a
      // nézet-alapú lista-szűrés indokolatlanul leszűkítené a találatokat.
      if (!camReady || !camTouched) {
        camX = ovX; camY = ovY; camZ = ovZoom;
        frX = toX = camX; frY = toY = camY; frZ = toZ = camZ;
        camT = 1;
        if (nCount > 0) camReady = true;
      }
      requestDraw();
    }

    function buildAdjacency() {
      var i;
      for (i = 0; i <= nCount; i++) nbStart[i] = 0;
      if (!eCount) return;
      for (i = 0; i < eCount; i++) { nbStart[ea[i] + 1]++; nbStart[eb[i] + 1]++; }
      for (i = 1; i <= nCount; i++) nbStart[i] += nbStart[i - 1];
      // átmeneti kurzorok: az nbStart-ot nem rontjuk el, ezért visszaszámolunk
      var cursor = new Int32Array(nCount + 1);
      for (i = 0; i <= nCount; i++) cursor[i] = nbStart[i];
      for (i = 0; i < eCount; i++) {
        nbList[cursor[ea[i]]++] = eb[i];
        nbList[cursor[eb[i]]++] = ea[i];
      }
    }

    // `freezeOverview`: húzás közben a befoglaló (rács, pásztázás-határ) frissül, de
    // az áttekintés-illesztés NEM — különben a kamera a mutató alól húzná ki a
    // csomópontot, és a nézet-arány (méret, címke) is remegne.
    function computeBounds(freezeOverview) {
      if (!nCount) {
        bMinX = 0; bMinY = 0; bMaxX = WORLD_SPAN; bMaxY = WORLD_SPAN;
      } else {
        bMinX = Infinity; bMinY = Infinity; bMaxX = -Infinity; bMaxY = -Infinity;
        for (var i = 0; i < nCount; i++) {
          if (nx[i] < bMinX) bMinX = nx[i];
          if (nx[i] > bMaxX) bMaxX = nx[i];
          if (ny[i] < bMinY) bMinY = ny[i];
          if (ny[i] > bMaxY) bMaxY = ny[i];
        }
        var padW = Math.max(40, (bMaxX - bMinX) * 0.08);
        var padH = Math.max(40, (bMaxY - bMinY) * 0.08);
        bMinX -= padW; bMaxX += padW; bMinY -= padH; bMaxY += padH;
      }
      if (freezeOverview) return;
      ovX = (bMinX + bMaxX) / 2;
      ovY = (bMinY + bMaxY) / 2;
      ovZoom = fitZoom(bMinX, bMinY, bMaxX, bMaxY, 1);
    }

    // ---------- szimuláció: felépítés / megtartás / szinkron ----------
    // A halmaz-szignatúra (id-k + élek, rendezve) dönti el, kell-e új szimuláció.
    // Azonos halmaznál a futó szimuláció marad — a szűrés/keresés/kiválasztás így
    // nem rendezi át a térképet.
    function dataSignature() {
      var ids = nid.slice(0).sort(), es = [], i, a, b;
      for (i = 0; i < eCount; i++) {
        a = nid[ea[i]]; b = nid[eb[i]];
        es.push(a < b ? a + '>' + b : b + '>' + a);
      }
      es.sort();
      return ids.join('\u0001') + '\u0002' + es.join('\u0001');
    }

    function syncSimulation() {
      if (!createSim) return;               // nincs szimulációs modul: a modell x,y-ja marad
      var sig = dataSignature();
      var i;
      if (sim && sig === simSig) {
        // ugyanaz a halmaz, de a nézet-unió SORRENDJE eltérhet → az index újraépül
        for (i = 0; i < nCount; i++) simIdx[i] = sim.indexOf(nid[i]);
        copyFromSim();
        return;
      }

      var first = !hasCache;
      // determinisztikus sorrend: id szerint (független attól, milyen sorrendben
      // érkezik a nézet-unió)
      var order2 = [];
      for (i = 0; i < nCount; i++) order2.push(i);
      order2.sort(function (x, y) { return nid[x] < nid[y] ? -1 : nid[x] > nid[y] ? 1 : 0; });
      var simNodes = [], c;
      for (i = 0; i < order2.length; i++) {
        var ri = order2[i];
        c = posCache[nid[ri]];
        // a modell kezdő x,y-ja csak a LEGELSŐ betöltésnél számít; később az új
        // csomópontot a szimuláció a szomszédai mellé helyezi
        simNodes.push(c ? { id: nid[ri], x: c.x, y: c.y }
                        : first ? { id: nid[ri], x: nx[ri], y: ny[ri] } : { id: nid[ri] });
      }
      var simEdges = [];
      for (i = 0; i < eCount; i++) simEdges.push({ source: nid[ea[i]], target: nid[eb[i]] });

      sim = createSim({ nodes: simNodes, edges: simEdges, params: forceParams, alpha: first ? 1 : 0.3 });
      simSig = sig;
      simAcc = 0;
      for (i = 0; i < nCount; i++) simIdx[i] = sim.indexOf(nid[i]);

      if (reduced) sim.settle();
      else if (first) { while (sim.alpha() > PRESETTLE_ALPHA && sim.tick(1)) { /* előfuttatás */ } }
      copyFromSim();
    }

    // sim → renderer-tömbök + id-cache. Allokáció csak új id-nél.
    function copyFromSim() {
      if (!sim) return;
      var p = sim.positions, i, s, c;
      for (i = 0; i < nCount; i++) {
        s = simIdx[i];
        if (s < 0) continue;
        nx[i] = p[s * 2]; ny[i] = p[s * 2 + 1];
        c = posCache[nid[i]];
        if (!c) { c = posCache[nid[i]] = { x: 0, y: 0 }; }
        c.x = nx[i]; c.y = ny[i];
      }
      if (nCount) hasCache = true;
    }

    // pozíció-változás után: tömbök, befoglaló, rács
    function afterSimMove() {
      copyFromSim();
      computeBounds(dragIdx >= 0);
      buildGrid();
    }

    function setSettings(s) {
      s = s || {};
      var changed = false;
      if (s.labelFade != null && isFinite(+s.labelFade)) { labelT = +s.labelFade; changed = true; }
      if (s.forces && createSim) {
        forceParams = s.forces;
        if (sim) {
          sim.setParams(forceParams);
          sim.reheat(0.3);                    // erő-csúszka → felmelegítés (spec §1.2)
          if (reduced) { sim.settle(); afterSimMove(); snapFollow(); }
        }
        changed = true;
      }
      if (changed) requestDraw();
    }

    // fit-to-bounds: mekkora zoom mellett fér be a téglalap (margóval)
    function fitZoom(x1, y1, x2, y2, margin) {
      if (W < 2 || H < 2 || fitBase <= 0) return 1;
      var ww = Math.max(1, x2 - x1), hh = Math.max(1, y2 - y1);
      var zx = (W * 0.86) / (ww * fitBase);
      var zy = (H * 0.86) / (hh * fitBase);
      var z = Math.min(zx, zy) * (margin || 1);
      return clamp(z, 0.25, 12);
    }

    function buildGrid() {
      if (!nCount) { G = 1; cellStart = new Int32Array(2); cellItems = new Int32Array(1); return; }
      G = Math.round(clamp(Math.ceil(Math.sqrt(nCount)) + 1, 4, 24));
      gx0 = bMinX; gy0 = bMinY;
      gw = Math.max(1, (bMaxX - bMinX) / G);
      gh = Math.max(1, (bMaxY - bMinY) / G);
      var cells = G * G, i, ccell;
      if (!cellStart || cellStart.length < cells + 1) cellStart = new Int32Array(cells + 1);
      else for (i = 0; i <= cells; i++) cellStart[i] = 0;
      if (!cellItems || cellItems.length < nCount) cellItems = new Int32Array(Math.max(16, nCount));
      for (i = 0; i <= cells; i++) cellStart[i] = 0;
      for (i = 0; i < nCount; i++) cellStart[cellOf(nx[i], ny[i]) + 1]++;
      for (i = 1; i <= cells; i++) cellStart[i] += cellStart[i - 1];
      var cur = new Int32Array(cells + 1);
      for (i = 0; i <= cells; i++) cur[i] = cellStart[i];
      for (i = 0; i < nCount; i++) { ccell = cellOf(nx[i], ny[i]); cellItems[cur[ccell]++] = i; }
    }

    function cellOf(wx, wy) {
      var ix = Math.floor((wx - gx0) / gw); if (ix < 0) ix = 0; else if (ix >= G) ix = G - 1;
      var iy = Math.floor((wy - gy0) / gh); if (iy < 0) iy = 0; else if (iy >= G) iy = G - 1;
      return iy * G + ix;
    }

    // ---------- kiemelés ----------
    function setHighlight(h) {
      h = h || {};
      var i;
      if (h.selectedId !== undefined) selectedId = h.selectedId || null;
      if (h.hoverId !== undefined) hoverId = h.hoverId || null;
      selIdx = selectedId != null && idIndex[selectedId] != null ? idIndex[selectedId] : -1;
      hovIdx = hoverId != null && idIndex[hoverId] != null ? idIndex[hoverId] : -1;
      if (h.matchIds !== undefined) {
        for (i = 0; i < nCount; i++) nmatch[i] = 0;
        if (h.matchIds) {
          for (i = 0; i < h.matchIds.length; i++) {
            var mi = idIndex[h.matchIds[i]];
            if (mi != null) nmatch[mi] = 1;
          }
        }
      }
      markSelectedEdges();
      updateHoverTargets(false);
      requestDraw();
    }

    // Hover-halványítás célértékei: a hoverelt (húzás közben a húzott) csomópont és
    // KÖZVETLEN szomszédai 1, minden más `HOVER_FADE`. Hover nélkül mindenki 1.
    // `snap`: azonnal a célra (új adat, reduced motion) — különben a képkockák
    // időalapú easinggel közelítenek (`stepFades`).
    function hoverFocusIdx() { return dragIdx >= 0 ? dragIdx : hovIdx; }
    function updateHoverTargets(snap) {
      var h = hoverFocusIdx(), i, j;
      for (i = 0; i < nCount; i++) nhov[i] = 0;
      if (h >= 0) {
        nhov[h] = 1;
        for (j = nbStart[h]; j < nbStart[h + 1]; j++) nhov[nbList[j]] = 1;
      }
      for (i = 0; i < nCount; i++) {
        nfadeT[i] = h < 0 || nhov[i] ? 1 : HOVER_FADE;
        if (snap || reduced) nfade[i] = nfadeT[i];
      }
      if (snap || reduced) hoverK = h >= 0 ? 1 : 0;
    }

    // időalapú közelítés: k = 1 − 0,9^(dt/16,67); visszaad: mozog-e még valami
    function stepFades(dt) {
      var k = 1 - Math.pow(FADE_BASE, dt / FRAME_MS), moving = false, i, d;
      for (i = 0; i < nCount; i++) {
        d = nfadeT[i] - nfade[i];
        if (d > 0.002 || d < -0.002) { nfade[i] += d * k; moving = true; }
        else nfade[i] = nfadeT[i];
      }
      var hk = hoverFocusIdx() >= 0 ? 1 : 0;
      d = hk - hoverK;
      if (d > 0.002 || d < -0.002) { hoverK += d * k; moving = true; }
      else hoverK = hk;
      return moving;
    }

    function markSelectedEdges() {
      var i;
      for (i = 0; i < eCount; i++) {
        ehl[i] = (selIdx >= 0 && (ea[i] === selIdx || eb[i] === selIdx)) ||
                 (hovIdx >= 0 && (ea[i] === hovIdx || eb[i] === hovIdx)) ? 1 : 0;
      }
    }

    // a felsorolt csomópontok halványodnak (nem tűnnek el); null = nincs halványítás
    function setDimmed(ids) {
      var i;
      for (i = 0; i < nCount; i++) ndim[i] = 0;
      dimActive = false;
      if (ids && ids.length) {
        for (i = 0; i < ids.length; i++) {
          var k = idIndex[ids[i]];
          if (k != null) { ndim[k] = 1; dimActive = true; }
        }
      }
      requestDraw();
    }

    // A szűrőből kiesett csomópontok: halvány üres karika, felirat nélkül, és
    // INERT (a hit-test átlép rajtuk). Erősebb háttérbe-tolás, mint a `setDimmed`.
    // null = nincs kiesett csomópont.
    function setExcluded(ids) {
      var i;
      for (i = 0; i < nCount; i++) nout[i] = 0;
      outActive = false;
      if (ids && ids.length) {
        for (i = 0; i < ids.length; i++) {
          var k = idIndex[ids[i]];
          if (k != null) { nout[k] = 1; outActive = true; }
        }
      }
      // a kiesett csomópont nem lehet hover-cél: ha épp azon állt a kurzor, elengedjük
      if (outActive && hovIdx >= 0 && nout[hovIdx]) {
        hoverId = null; hovIdx = -1;
        markSelectedEdges();
        updateHoverTargets(false);
      }
      requestDraw();
    }

    // ---------- kamera ----------
    function panClamp() {
      var scale = fitBase * camZ;
      if (scale <= 0) return;
      var halfW = (W / 2) / scale, halfH = (H / 2) / scale;
      var loX = bMinX - halfW * 0.6, hiX = bMaxX + halfW * 0.6;
      var loY = bMinY - halfH * 0.6, hiY = bMaxY + halfH * 0.6;
      if (loX > hiX) { loX = hiX = (bMinX + bMaxX) / 2; }
      if (loY > hiY) { loY = hiY = (bMinY + bMaxY) / 2; }
      camX = clamp(camX, loX, hiX);
      camY = clamp(camY, loY, hiY);
    }

    function tweenTo(x, y, z, animate) {
      z = clamp(z, ovZoom * 0.6, ovZoom * 9);
      if (reduced || animate === false) {
        camX = x; camY = y; camZ = z;
        frX = toX = x; frY = toY = y; frZ = toZ = z;
        camT = 1;
        panClamp();
        requestDraw();
        return;
      }
      frX = camX; frY = camY; frZ = camZ;
      toX = x; toY = y; toZ = z;
      camT = 0;
      requestDraw();
    }

    function stepCamera(dt) {
      if (camT >= 1) return;
      camT += dt / Math.max(1, camDur);
      if (camT > 1) camT = 1;
      var e = ease(camT);
      camX = frX + (toX - frX) * e;
      camY = frY + (toY - frY) * e;
      // a zoom exponenciálisan interpolál, hogy a pozícióval EGYÜTT, snap nélkül érkezzen
      camZ = frZ * Math.pow(toZ / frZ, e);
      panClamp();
    }

    // Áttekintés-követés: amíg a felhasználó nem mozgatta a kamerát, az az élő
    // elrendezés befoglalójához igazodik. Folyó tween alatt a tween CÉLJA frissül;
    // nyugvó kameránál időalapú simítás (nincs ugrás, ha a befoglaló hirtelen vált,
    // pl. húzás elengedésekor). Visszaad: mozog-e még.
    function stepFollow(dt) {
      if (camTouched || !camReady) return false;
      if (camT < 1) { toX = ovX; toY = ovY; toZ = ovZoom; return true; }
      var dx = ovX - camX, dy = ovY - camY, rz = ovZoom / camZ;
      var scale = fitBase * camZ;
      if (Math.abs(dx * scale) < 0.25 && Math.abs(dy * scale) < 0.25 && Math.abs(rz - 1) < 0.0005) {
        camX = ovX; camY = ovY; camZ = ovZoom; frX = toX = camX; frY = toY = camY; frZ = toZ = camZ;
        return false;
      }
      var k = 1 - Math.pow(FOLLOW_BASE, dt / FRAME_MS);
      camX += dx * k; camY += dy * k; camZ *= Math.pow(rz, k);
      frX = toX = camX; frY = toY = camY; frZ = toZ = camZ;
      return true;
    }
    function snapFollow() {
      if (camTouched) return;
      camX = ovX; camY = ovY; camZ = ovZoom;
      frX = toX = camX; frY = toY = camY; frZ = toZ = camZ; camT = 1;
    }

    // A csomópont `depth` mélységű környezete (BFS a renderer szomszédságán; a
    // szűrőből kiesett csomópont inert, rajta át nem vezet út) — fit-to-bounds.
    var bfsQueue = null, bfsSeen = null;
    function focusOn(id, opts) {
      var animate = !(opts && opts.animate === false);
      var depth = Math.max(1, Math.round((opts && opts.depth) || 1));
      var i = idIndex[id];
      if (i == null) return;
      var x1 = nx[i], x2 = nx[i], y1 = ny[i], y2 = ny[i];
      if (!bfsQueue || bfsQueue.length < cap) { bfsQueue = new Int32Array(cap); bfsSeen = new Uint8Array(cap); }
      var j, k, q, head = 0, tail = 0, level = 0, levelEnd;
      for (j = 0; j < nCount; j++) bfsSeen[j] = 0;
      bfsQueue[tail++] = i; bfsSeen[i] = 1;
      while (level < depth && head < tail) {
        levelEnd = tail;
        for (; head < levelEnd; head++) {
          q = bfsQueue[head];
          for (j = nbStart[q]; j < nbStart[q + 1]; j++) {
            k = nbList[j];
            if (bfsSeen[k] || (outActive && nout[k])) continue;
            bfsSeen[k] = 1; bfsQueue[tail++] = k;
            if (nx[k] < x1) x1 = nx[k];
            if (nx[k] > x2) x2 = nx[k];
            if (ny[k] < y1) y1 = ny[k];
            if (ny[k] > y2) y2 = ny[k];
          }
        }
        level++;
      }
      var minSpan = 400;                     // magányos csomópont se zoomoljon a végtelenbe (≈ L + 2·ütközési sugár)
      if (x2 - x1 < minSpan) { var mx = (x1 + x2) / 2; x1 = mx - minSpan / 2; x2 = mx + minSpan / 2; }
      if (y2 - y1 < minSpan) { var my = (y1 + y2) / 2; y1 = my - minSpan / 2; y2 = my + minSpan / 2; }
      var pad = Math.max(30, (x2 - x1) * 0.18);
      camTouched = true;
      tweenTo((x1 + x2) / 2, (y1 + y2) / 2, fitZoom(x1 - pad, y1 - pad, x2 + pad, y2 + pad, 1), animate);
    }

    function toOverview(opts) {
      var animate = !(opts && opts.animate === false);
      camTouched = false;
      tweenTo(ovX, ovY, ovZoom, animate);
    }

    // ---------- folytonos részlet-paraméterek (zoomból, nincs discrete LOD) ----------
    function zoomRatio() { return camZ / Math.max(0.0001, ovZoom); }

    function updateVisualParams() {
      var e = smooth01((zoomRatio() - 1) / ZOOM_DETAIL_SPAN);
      P.docAlpha = 0.80 + 0.20 * e;
      // (A csomópont-méret NEM innen jön: lásd `nodeScreenR` — √zoom.)
      // A címke-ALFA a log₂-képletből jön (`labelAlpha`), itt csak a budget.
      P.docLabel = labelAlpha(zoomRatio(), labelT);
      P.docLabelTop = Math.round(5 + 40 * e);
      // az alapháló áttekintésben is olvasható marad (0,75), közelítve erősödik
      P.edge = 0.75 + 0.25 * e;
    }

    // ---------- méret ----------
    function resize() {
      dpr = Math.min(global.devicePixelRatio || 1, 2);
      var rect = canvas.getBoundingClientRect();
      W = Math.max(0, Math.round(rect.width));
      H = Math.max(0, Math.round(rect.height));
      if (W < 2 || H < 2) { return; }        // nulla méretű canvas: ne rajzoljunk
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fitBase = Math.min(W, H) / WORLD_SPAN;
      ovZoom = fitZoom(bMinX, bMinY, bMaxX, bMaxY, 1);
      // amíg a felhasználó nem mozgatta a kamerát, az áttekintés újraillesztődik
      if (!camReady || !camTouched) {
        camX = ovX; camY = ovY; camZ = ovZoom;
        frX = toX = camX; frY = toY = camY; frZ = toZ = camZ; camT = 1;
      }
      panClamp();
      requestDraw();
    }

    // ---------- projekció ----------
    // A rajzolt méret a nézet-aránnyal √-esen nő (Obsidian: R·√zoom): közelítve
    // nem lesz „bogyó", kizoomolva nem lesz pont. Az átfedést nem ez zárja ki,
    // hanem `restCapR`.
    function zoomFactor() {
      return Math.sqrt(Math.max(0.0025, zoomRatio()));
    }

    // A csomópont KIRAJZOLT sugara. Három lépés, ebben a sorrendben:
    //   1. a modell mérete × √zoom (lásd `zoomFactor`)
    //   2. kattinthatósági padló (`MIN_NODE_R`), hogy kis panelen se legyen pont
    //   3. FELSŐ korlát a nyugalmi térköz feléből (`restCapR`)
    function nodeScreenR(i, scale) {
      var r = nr[i] * zoomFactor();
      if (r < MIN_NODE_R) r = MIN_NODE_R;
      return restCapR(r, scale);
    }

    // Nyugalomban az ütközés-erő a középpontokat ≥ ~2·COLLIDE_R világ-egységre
    // tartja, ezért a rajzolt sugár felső korlátja ennek a fele az aktuális skálán
    // (kis ráhagyással a lágy ütközés miatt). Ez váltja ki a korábbi mért
    // `minGap`-et: a garancia a SZIMULÁCIÓ invariánsán áll, nem a pillanatnyi
    // elrendezésen. A hover/kijelölés nagyítását is ez vágja le.
    function restCapR(r, scale) {
      var capR = COLLIDE_R * 0.95 * (scale > 0 ? scale : fitBase * camZ) - NODE_GAP_KEEP;
      if (capR > 0 && r > capR) r = capR;
      return r > 0.5 ? r : 0.5;
    }

    // ---------- kategória-színezés ----------
    function catColor(slot) {
      var c = col.cat[slot];
      return c || col.secondary;
    }

    // Több kategóriás csomópont: FINOM ÁTMENET a kategóriái színei között.
    // Egy kis offscreen canvasre rajzoljuk (slot-kombinációnként EGYSZER), majd
    // `drawImage`-zsel méretezzük — így nincs per-frame gradiens-allokáció.
    // A színmegállók a szegmensek KÖZEPÉN vannak, ezért a színek folyamatosan
    // olvadnak egymásba, nem sávokban ugranak.
    function nodeSprite(slots) {
      var key = slots.join('-');
      var cached = spriteCache[key];
      if (cached) return cached;

      var cv = document.createElement('canvas');
      cv.width = SPRITE_PX; cv.height = SPRITE_PX;
      var c2 = cv.getContext('2d');
      if (!c2) return null;

      var g = c2.createLinearGradient(0, 0, SPRITE_PX, SPRITE_PX);   // 135°-os átló
      var m = slots.length, j;
      g.addColorStop(0, catColor(slots[0]));
      for (j = 0; j < m; j++) g.addColorStop((j + 0.5) / m, catColor(slots[j]));
      g.addColorStop(1, catColor(slots[m - 1]));

      c2.fillStyle = g;
      c2.beginPath();
      c2.arc(SPRITE_PX / 2, SPRITE_PX / 2, SPRITE_PX / 2, 0, Math.PI * 2);
      c2.fill();

      spriteCache[key] = cv;
      return cv;
    }

    // ---------- nézet-jelentés ----------
    // A zoom és a lista összhangja: jelentjük, mely csomópontok vannak a
    // nézetben. Debounce-olva, hogy panolás/zoom közben ne áradjon.
    var lastVpSig = -1, vpTimer = 0;

    function scheduleViewport() {
      if (vpTimer) return;
      vpTimer = global.setTimeout(function () {
        vpTimer = 0;
        var ids = [], i;
        for (i = 0; i < nCount; i++) if (nvis[i]) ids.push(nid[i]);
        onViewport({ visibleIds: ids, zoomRatio: zoomRatio() });
      }, 90);
    }

    // ---------- rajz ----------
    function drawFrame() {
      if (W < 2 || H < 2) return;
      ctx.clearRect(0, 0, W, H);
      if (!nCount) return;

      updateVisualParams();
      var scale = fitBase * camZ;
      var hw = W / 2, hh = H / 2;
      var i, j, k, idx, sx, sy, r, m = 90;
      var pulse = reduced ? 0 : Math.sin(phase * 0.0021) * 0.5 + 0.5;

      // projekció + culling
      for (i = 0; i < nCount; i++) {
        sx = (nx[i] - camX) * scale + hw;
        sy = (ny[i] - camY) * scale + hh;
        r = nodeScreenR(i, scale);
        nsx[i] = sx; nsy[i] = sy; nscr[i] = r;
        nvis[i] = (sx > -m && sx < W + m && sy > -m && sy < H + m) ? 1 : 0;
      }

      // A látható halmaz jelzése a hívónak — csak ha van feliratkozó. Per-frame
      // NEM allokálunk: egy egész-szignatúrát számolunk, és eltérés esetén
      // ütemezünk egy (debounce-olt) visszahívást, ami akkor építi fel a listát.
      if (onViewport) {
        var vsig = 0, vcnt = 0;
        for (i = 0; i < nCount; i++) {
          if (nvis[i]) { vcnt++; vsig = (vsig * 31 + i + 1) % 2147483647; }
        }
        vsig = (vsig * 131 + vcnt * 7 + Math.round(zoomRatio() * 20)) % 2147483647;
        if (vsig !== lastVpSig) { lastVpSig = vsig; scheduleViewport(); }
      }

      // Hover-halványítás az éleken: a hoverelt (húzott) csomópontba futó él
      // teljes, minden más él 0,2 felé halványul — a csomópontokkal azonos, simított
      // ütemben (`hoverK`).
      var hFocus = hoverFocusIdx();
      var edgeFadeOther = 1 - (1 - HOVER_FADE) * hoverK;

      // 1) élek — két menet (alap / kiemelt), hogy a strokeStyle ne váltogasson
      ctx.lineWidth = 1;
      if (P.edge > 0.02) {
        ctx.strokeStyle = col.edgeStr;
        for (i = 0; i < eCount; i++) {
          if (ehl[i]) continue;
          if (!nvis[ea[i]] && !nvis[eb[i]]) continue;
          var wA = Math.min(1, 0.35 + ew[i] * 0.18);
          var al = (EDGE_A_BASE + wA * EDGE_A_WEIGHT) * P.edge * cfg.edge;
          if (dimActive && ndim[ea[i]] && ndim[eb[i]]) al *= 0.35;
          // szűrőből kiesett végpont: az él is visszahúzódik — a kapcsolat látszik,
          // de nem versenyez a szűrt halmaz éleivel
          if (outActive && (nout[ea[i]] || nout[eb[i]])) al *= EDGE_A_EXCLUDED;
          if (ea[i] !== hFocus && eb[i] !== hFocus) al *= edgeFadeOther;
          ctx.globalAlpha = al;
          ctx.beginPath();
          ctx.moveTo(nsx[ea[i]], nsy[ea[i]]);
          ctx.lineTo(nsx[eb[i]], nsy[eb[i]]);
          ctx.stroke();
        }
      }
      // A hoverelt/kijelölt csomópontból INDULÓ és oda BEFUTÓ élek: élénk
      // --accent, vastagabb vonal. Az alfa NEM a zoomból jön (nincs `P.edge`
      // tényező), így a kiemelés áttekintésben is ugyanolyan határozott.
      ctx.strokeStyle = col.edgeHiStr;
      ctx.lineWidth = EDGE_W_HI;
      for (i = 0; i < eCount; i++) {
        if (!ehl[i]) continue;
        if (!nvis[ea[i]] && !nvis[eb[i]]) continue;
        var wB = Math.min(1, 0.35 + ew[i] * 0.18);
        var alB = Math.min(0.95, (EDGE_A_HI + wB * EDGE_A_HI_WEIGHT) * cfg.edge);
        // a kijelölt szomszédsága is visszafogott, ha a másik vége kiesett a szűrőből
        if (outActive && (nout[ea[i]] || nout[eb[i]])) alB *= EDGE_A_EXCLUDED;
        if (ea[i] !== hFocus && eb[i] !== hFocus) alB *= edgeFadeOther;
        ctx.globalAlpha = alB;
        ctx.beginPath();
        ctx.moveTo(nsx[ea[i]], nsy[ea[i]]);
        ctx.lineTo(nsx[eb[i]], nsy[eb[i]]);
        ctx.stroke();
      }
      ctx.lineWidth = 1;

      // 2) csomópontok — a rajzsorrend visszafelé: a súlyosabb kerül felülre
      for (j = nCount - 1; j >= 0; j--) {
        idx = order[j];
        if (!nvis[idx]) continue;
        drawNode(idx, pulse);
      }

      // 3) címkék — ütközés-budget + prioritás (kijelölt/hover, majd súly szerint)
      labelUsed = 0;
      var budget = Math.min(MAX_LABELS, labelBudget);
      if (selIdx >= 0 && nvis[selIdx]) labelFor(selIdx, budget, true);
      if (hovIdx >= 0 && hovIdx !== selIdx && nvis[hovIdx]) labelFor(hovIdx, budget, true);
      var docLabels = 0;
      for (j = 0; j < nCount && labelUsed < budget; j++) {
        idx = order[j];
        if (!nvis[idx] || idx === selIdx || idx === hovIdx) continue;
        if (P.docLabel * nfade[idx] < 0.06) continue;
        if (!nmatch[idx]) {
          if (docLabels >= P.docLabelTop) continue;
          docLabels++;
        }
        if (dimActive && ndim[idx]) continue;
        if (outActive && nout[idx]) continue;      // kiesett csomópont nem kap feliratot
        labelFor(idx, budget, false);
      }
      ctx.globalAlpha = 1;
    }

    function drawNode(i, pulse) {
      var x = nsx[i], y = nsy[i], r = nscr[i];
      var t = ntype[i];
      var isSel = i === selIdx, isHov = i === hovIdx;
      var a = P.docAlpha;

      // A szűrőből kiesett dokumentum NEM tűnik el: halvány ÜRES karika marad
      // belőle. A jelentést nem a szín hordozza, hanem a KITÖLTÉS eltűnése — a
      // kategória-színt sem viszi tovább, így a paletta csak a szűrt halmazt
      // írja le. A méret változatlan — az minden csomóponton egységes.
      a *= nfade[i];                          // hover-halványítás (1 = nincs)
      if (outActive && nout[i]) {
        ctx.globalAlpha = Math.min(0.55, a * 0.5);
        ctx.strokeStyle = col.textSubtle;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
        return;
      }
      if (dimActive && ndim[i] && !isSel && !isHov) a *= 0.22;
      if (a < 0.02) return;

      if (isHov && !reduced) r *= 1 + 0.09 * pulse * cfg.pulse;
      if (isSel) r *= 1.12;
      r = restCapR(r, fitBase * camZ);        // a nagyítás sem érhet át a szomszédra

      // A kitöltés a KATEGÓRIÁ(I)T tükrözi: egy kategória = tömör szín, több
      // kategória = finom átmenet a színei között (sprite). Ha nincs kategória-
      // adat, a semleges --secondary marad.
      var slots = ncat[i];
      var fill = t === 2 ? col.accent : (slots ? catColor(slots[0]) : col.secondary);

      // kijelölés: --primary glória (nem csak szín: a méret és a gyűrű is jelzi)
      if (isSel) {
        ctx.fillStyle = col.primary;
        var g = (reduced ? 0.5 : 0.35 + 0.3 * pulse) * cfg.glow;
        ctx.globalAlpha = 0.10 * g;
        ctx.beginPath(); ctx.arc(x, y, r * 3.1, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.16 * g;
        ctx.beginPath(); ctx.arc(x, y, r * 2.1, 0, Math.PI * 2); ctx.fill();
      }

      // találat-jelzés: --secondary→ itt inkább --primary gyűrű, hogy a kék testtől
      // is jól elváljon a keresés-kiemelés
      if (nmatch[i]) {
        ctx.strokeStyle = col.primary;
        ctx.globalAlpha = Math.min(0.9, 0.55 * a + 0.3);
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(x, y, r + 3.5, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
      }

      // test
      ctx.globalAlpha = a;
      if (slots && slots.length > 1) {
        // több kategória → az előre renderelt színátmenet-sprite
        var sp = nodeSprite(slots);
        if (sp) ctx.drawImage(sp, x - r, y - r, r * 2, r * 2);
        else { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
      } else {
        ctx.fillStyle = fill;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }

      // --surface keret, hogy sűrű részen is elváljanak a csomópontok
      if (r > 2.5) {
        ctx.strokeStyle = col.surface;
        ctx.globalAlpha = a * 0.85;
        ctx.lineWidth = Math.min(2, Math.max(1, r * 0.22));
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
      }
      if (isSel || isHov) {
        ctx.strokeStyle = col.primary;
        ctx.globalAlpha = isSel ? 0.95 : 0.6;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    function labelWidthOf(i, sizePx, baseSize) {
      if (nlabelW[i] < 0) nlabelW[i] = ctx.measureText(nlabel[i]).width;
      return nlabelW[i] * (sizePx / baseSize);
    }

    function labelFor(i, budget, forced) {
      if (labelUsed >= budget) return;
      // A kiemelt (kijelölt/hoverelt) csomópont címkéje minden zoomon teljes alfával
      // látszik; a többié a log₂-képletből jön, a hover-halványítással szorozva.
      var alpha = forced ? 1 : P.docLabel * nfade[i];
      if (alpha < 0.06) return;
      if (dimActive && ndim[i] && !forced) alpha *= 0.35;

      var baseSize = col.docFontPx;
      ctx.font = col.fontDocBase;
      var tw = labelWidthOf(i, baseSize, baseSize);
      var th = baseSize * 1.25;
      var x = nsx[i], y = nsy[i] + nscr[i] + th * 0.9;
      var left = x - tw / 2, top = y - th * 0.8;

      // ütközés-teszt a már kiosztott címkékkel
      var padX = 4, padY = 2, q;
      for (q = 0; q < labelUsed; q++) {
        var o = q * 4;
        if (left - padX < labelRects[o] + labelRects[o + 2] && left + tw + padX > labelRects[o] &&
            top - padY < labelRects[o + 1] + labelRects[o + 3] && top + th + padY > labelRects[o + 1]) {
          if (!forced) return;
        }
      }
      var off = labelUsed * 4;
      labelRects[off] = left; labelRects[off + 1] = top;
      labelRects[off + 2] = tw; labelRects[off + 3] = th;
      labelUsed++;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // olvashatósági alap: --surface halvány pasztilla (nem új szín, tokenből)
      ctx.globalAlpha = alpha * 0.72;
      ctx.fillStyle = col.surface;
      roundRect(left - 4, top - 1, tw + 8, th + 2, Math.min(6, th / 2));
      ctx.fill();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = i === selIdx ? col.text : col.textMuted;
      ctx.fillText(nlabel[i], x, top + th / 2);
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
    }

    // ---------- hit-test (rács-index, nem O(n) minden pointermove-ra) ----------
    function hitTest(px, py) {
      if (!nCount || W < 2 || fitBase <= 0) return -1;
      var scale = fitBase * camZ;
      var wx = (px - W / 2) / scale + camX;
      var wy = (py - H / 2) / scale + camY;
      var reachPx = 18 * zoomFactor() + 8;
      var reach = reachPx / scale;
      var ix0 = Math.floor((wx - reach - gx0) / gw), ix1 = Math.floor((wx + reach - gx0) / gw);
      var iy0 = Math.floor((wy - reach - gy0) / gh), iy1 = Math.floor((wy + reach - gy0) / gh);
      if (ix0 < 0) ix0 = 0; if (iy0 < 0) iy0 = 0;
      if (ix1 > G - 1) ix1 = G - 1; if (iy1 > G - 1) iy1 = G - 1;
      var best = -1, bestD = Infinity, gxi, gyi, s, e, j, i, dx, dy, d, r;
      for (gyi = iy0; gyi <= iy1; gyi++) {
        for (gxi = ix0; gxi <= ix1; gxi++) {
          s = cellStart[gyi * G + gxi]; e = cellStart[gyi * G + gxi + 1];
          for (j = s; j < e; j++) {
            i = cellItems[j];
            if (outActive && nout[i]) continue;    // a kiesett csomópont inert: átlépünk rajta
            // a pozíciót itt is számoljuk (nem a rajzolt puffert olvassuk) — így akkor is
            // helyes, ha még nem futott képkocka
            dx = ((nx[i] - camX) * scale + W / 2) - px;
            dy = ((ny[i] - camY) * scale + H / 2) - py;
            d = dx * dx + dy * dy;
            r = nodeScreenR(i, scale) + 6;
            if (d <= r * r && d < bestD) { bestD = d; best = i; }
          }
        }
      }
      return best;
    }

    function getNodeScreenRect(id) {
      var i = idIndex[id];
      if (i == null || W < 2) return null;
      var scale = fitBase * camZ;
      var sx = (nx[i] - camX) * scale + W / 2;
      var sy = (ny[i] - camY) * scale + H / 2;
      var r = nodeScreenR(i, scale);
      var rect = canvas.getBoundingClientRect();
      return {
        left: rect.left + sx - r,
        top: rect.top + sy - r,
        width: r * 2,
        height: r * 2
      };
    }

    // ---------- interakció ----------
    // Egy mutató-gesztus háromféle lehet, a lenyomás helye és az elmozdulás dönt:
    //   · ≤ DRAG_THRESHOLD px → kattintás (kiválasztás / üres helyen kizoomolás)
    //   · csomóponton indult, > küszöb → CSOMÓPONT-HÚZÁS (fx/fy a mutatóhoz)
    //   · üres helyen indult, > küszöb → pásztázás (mint eddig)
    // A húzás sosem választ ki. A szűrőből kiesett csomópont inert: nem húzható.
    var dragging = false, dragMoved = false, downX = 0, downY = 0, lastPX = 0, lastPY = 0, downId = -1;
    var grabDX = 0, grabDY = 0;

    function screenToWorldX(px) { return (px - W / 2) / (fitBase * camZ) + camX; }
    function screenToWorldY(py) { return (py - H / 2) / (fitBase * camZ) + camY; }

    function setHoverIdx(hit) {
      var id = hit >= 0 ? nid[hit] : null;
      if (id === hoverId) return;
      hoverId = id;
      hovIdx = hit;
      markSelectedEdges();
      updateHoverTargets(false);
      requestDraw();
      onHover(id);
    }

    function onPointerDown(e) {
      if (e.button != null && e.button !== 0) return;
      var rect = canvas.getBoundingClientRect();
      downX = lastPX = e.clientX - rect.left;
      downY = lastPY = e.clientY - rect.top;
      dragging = true; dragMoved = false;
      downId = hitTest(downX, downY);
      if (canvas.setPointerCapture && e.pointerId != null) {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      }
    }

    function beginNodeDrag() {
      dragIdx = downId;
      grabDX = nx[dragIdx] - screenToWorldX(downX);
      grabDY = ny[dragIdx] - screenToWorldY(downY);
      setHoverIdx(dragIdx);                 // húzás közben a húzott csomópont a kiemelt
      updateHoverTargets(false);
    }

    function moveNodeDrag(px, py) {
      if (dragIdx < 0 || !sim) return;
      var wx = screenToWorldX(px) + grabDX, wy = screenToWorldY(py) + grabDY;
      sim.pin(nid[dragIdx], wx, wy);        // α = αTarget = 0,3, amíg tartod
      if (reduced) sim.tick(REDUCED_DRAG_TICKS);
      afterSimMove();
      requestDraw();
    }

    function endNodeDrag() {
      if (dragIdx < 0) return;
      var id = nid[dragIdx];
      dragIdx = -1;
      if (sim) {
        sim.unpin(id);                      // αTarget = 0 → kb. 4 s alatt megnyugszik
        if (reduced) sim.settle();
        afterSimMove();
        if (reduced) snapFollow();
      }
      updateHoverTargets(false);
      requestDraw();
    }

    function onPointerMove(e) {
      var rect = canvas.getBoundingClientRect();
      var px = e.clientX - rect.left, py = e.clientY - rect.top;
      if (dragging) {
        if (!dragMoved) {
          var mdx = px - downX, mdy = py - downY;
          if (mdx * mdx + mdy * mdy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
            dragMoved = true;
            if (downId >= 0 && sim && fitBase * camZ > 0) beginNodeDrag();
          }
        }
        if (dragMoved) {
          if (dragIdx >= 0) {
            moveNodeDrag(px, py);
          } else {
            var scale = fitBase * camZ;
            if (scale > 0) {
              camTouched = true;
              camX -= (px - lastPX) / scale;
              camY -= (py - lastPY) / scale;
              camT = 1; frX = toX = camX; frY = toY = camY; frZ = toZ = camZ;
              panClamp();
              requestDraw();
            }
          }
        }
        lastPX = px; lastPY = py;
        return;
      }
      setHoverIdx(hitTest(px, py));
    }

    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      if (canvas.releasePointerCapture && e.pointerId != null) {
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
      }
      if (dragIdx >= 0) { endNodeDrag(); dragMoved = false; return; }
      if (dragMoved) { dragMoved = false; return; }     // húzás sosem választ ki
      if (e.type === 'pointercancel' || e.type === 'lostpointercapture') return;   // megszakított gesztus nem kattintás
      var rect = canvas.getBoundingClientRect();
      var hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (hit < 0) hit = downId;
      onSelect(hit >= 0 ? nid[hit] : null);
    }

    function onPointerLeave() {
      if (dragging) return;                 // pointer capture: húzás közben a kilépés nem hover-vég
      if (hoverId !== null) setHoverIdx(-1);
    }

    function onWheel(e) {
      e.preventDefault();
      var rect = canvas.getBoundingClientRect();
      var px = e.clientX - rect.left, py = e.clientY - rect.top;
      var scale = fitBase * camZ;
      if (scale <= 0) return;
      var wx = (px - W / 2) / scale + camX;
      var wy = (py - H / 2) / scale + camY;
      // Érzékeny zoom: egy görgetés-notch (~100px delta) ~1.5× — így 2-3
      // mozdulatból le lehet érni a dokumentum-szintre, nem 5-6-ból.
      var factor = Math.exp(-(e.deltaY || 0) * (e.deltaMode === 1 ? 0.12 : 0.0042));
      var nz = clamp(camZ * factor, ovZoom * 0.55, ovZoom * 12);
      camTouched = true;
      camZ = nz;
      var s2 = fitBase * camZ;
      camX = wx - (px - W / 2) / s2;
      camY = wy - (py - H / 2) / s2;
      camT = 1; frX = toX = camX; frY = toY = camY; frZ = toZ = camZ;
      panClamp();
      requestDraw();
    }

    // ---------- rAF (igény szerinti ciklus) ----------
    // `running` = a térkép látható és élő (start/stop). A képkockát `kick()` kéri;
    // a ciklus addig kér újat, amíg valami mozog (`needsFrame`), utána LEÁLL.
    var raf = 0, running = false, lastT = 0, lastMoving = false;

    function stepSimulation(dt) {
      if (!sim || sim.isSettled()) { simAcc = 0; return false; }
      simAcc += dt;
      var steps = 0;
      while (simAcc >= SIM_STEP_MS && steps < MAX_SIM_STEPS) {
        sim.tick(1);
        simAcc -= SIM_STEP_MS;
        steps++;
      }
      if (steps >= MAX_SIM_STEPS) simAcc = 0;   // lemaradás: eldobjuk, nem „spirálozunk"
      if (steps) afterSimMove();
      return true;
    }

    function needsFrame() {
      if (sim && !sim.isSettled()) return true;
      if (camT < 1 || lastMoving) return true;
      // a kijelölt/hoverelt csomópont glória-pulzálása folyamatos animáció
      if (!reduced && (selIdx >= 0 || hovIdx >= 0)) return true;
      return false;
    }

    function frameFn(ts) {
      raf = 0;
      if (!running) return;
      if (!lastT) lastT = ts;
      var dt = ts - lastT;
      if (dt > 50) dt = 50;
      lastT = ts;
      phase += dt;
      stepSimulation(dt);
      stepCamera(dt);
      var follow = stepFollow(dt);
      var fades = stepFades(dt);
      lastMoving = follow || fades;
      drawFrame();
      if (needsFrame()) raf = global.requestAnimationFrame(frameFn);
      else lastT = 0;                         // a következő indításnál ne számoljon „ugrást"
    }

    function kick() {
      if (!running || raf) return;
      raf = global.requestAnimationFrame(frameFn);
    }

    function start() {
      if (reduced) { drawFrame(); return; }
      if (running) return;
      running = true; lastT = 0;
      kick();
    }

    function stop() {
      running = false;
      if (raf) global.cancelAnimationFrame(raf);
      raf = 0; lastT = 0;
    }

    // Futó ciklusnál a következő képkockát kéri; reduced motion / leállított
    // ciklus mellett azonnal, szinkron rajzol (egyetlen statikus képkocka).
    var inDraw = false;
    function requestDraw() {
      if (running) { kick(); return; }
      if (inDraw) return;                    // újrabelépés-védelem
      inDraw = true;
      if (reduced) camT = 1;
      drawFrame();
      inDraw = false;
    }

    // ---------- életciklus ----------
    function onVisibility() {
      if (document.hidden) stop();
      else if (!reduced) start();
    }

    canvas.style.touchAction = 'none';       // hogy a pointer-drag ne görgessen mobilon
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    // elveszett capture (pl. a böngésző elvette a gesztust, vagy a pointerup nem
    // érkezett meg) = megszakítás: a húzás lezárul, nincs kiválasztás
    canvas.addEventListener('lostpointercapture', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('visibilitychange', onVisibility);

    function destroy() {
      stop();
      if (vpTimer) { global.clearTimeout(vpTimer); vpTimer = 0; }
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('lostpointercapture', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      document.removeEventListener('visibilitychange', onVisibility);
    }

    // Diagnosztika / teszt-varrat: csak OLVAS, allokál — ne hívd képkockánként.
    function getDebugState() {
      var nodes = [], i, scale = fitBase * camZ;
      for (i = 0; i < nCount; i++) {
        nodes.push({
          id: nid[i], x: nx[i], y: ny[i],
          fade: nfade[i], fadeTarget: nfadeT[i],
          pinned: !!(sim && sim.isPinned(nid[i])),
          screenX: (nx[i] - camX) * scale + W / 2, screenY: (ny[i] - camY) * scale + H / 2,
          screenR: nodeScreenR(i, scale)
        });
      }
      return {
        alpha: sim ? sim.alpha() : 0,
        settled: sim ? sim.isSettled() : true,
        loopActive: !!raf,
        running: running,
        zoom: zoomRatio(),
        labelAlpha: labelAlpha(zoomRatio(), labelT),
        labelFade: labelT,
        hoverId: hoverId,
        dragId: dragIdx >= 0 ? nid[dragIdx] : null,
        camTouched: camTouched,
        params: sim ? sim.params() : forceParams,
        nodes: nodes
      };
    }

    // init
    ensureNodeCap(0); ensureEdgeCap(0);
    cellStart = new Int32Array(2); cellItems = new Int32Array(16);
    refreshColors();
    resize();

    return {
      setData: setData,
      setHighlight: setHighlight,
      setDimmed: setDimmed,
      setExcluded: setExcluded,
      focusOn: focusOn,
      toOverview: toOverview,
      getNodeScreenRect: getNodeScreenRect,
      start: start,
      stop: stop,
      resize: resize,
      refreshColors: refreshColors,
      setSettings: setSettings,
      getDebugState: getDebugState,
      destroy: destroy
    };
  }

  createAtlasRenderer.labelAlpha = labelAlpha;
  global.createAtlasRenderer = createAtlasRenderer;
})(window);
