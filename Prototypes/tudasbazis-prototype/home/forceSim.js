/* forceSim.js — az Élő Atlasz erő-szimulációja (D28). Önálló modul, könyvtár nélkül.
 *
 * A d3-force NYILVÁNOSAN dokumentált modelljét követi (saját implementáció,
 * tiszta szoba): tickenként α-frissítés → erők → csillapítás + integrálás.
 * A konstansok és a csúszka→paraméter leképezés forrása:
 * `Prototypes/atlasz-obsidian-graf-elemzes.md` §1.2.
 *
 * Erők (D28, D-1: kizárólag ez a négy — kategória-vonzás NINCS):
 *   középre húzás  v −= α · p · pos                       (forceX/forceY-típus, origó felé)
 *   taszítás       Δv = α · P / d, a másiktól el          (1/d törvény, pontos O(n²) páronként)
 *   rugó           l = (d − L)/d · α · k, k = Ls / min(fok_a, fok_b);
 *                  a két vég a fokszám ellentétes arányában mozdul
 *   ütközés        d < 2·60 → mindkettő 0,25·(120 − d)/d arányban szét, α NÉLKÜL
 *
 * DETERMINISZTIKUS: nincs `Math.random`. A kezdő elrendezés phyllotaxis (a d3
 * alapértelmezése), az egybeeső pontok szétlökése („jiggle") pedig seed-elt,
 * hash-alapú sorozatból jön. Ugyanaz a bemenet → bitre ugyanaz a pozíció.
 *
 * Publikus API (classic script, global):
 *   createForceSim({ nodes: [{ id, x?, y? }], edges: [{ source, target }], params? })
 *     .tick(n)          legfeljebb n lépés; KIHŰLT szimulációnál (α < 0,001 és nincs
 *                       rögzített csomópont) nem lép. Visszaad: a megtett lépések száma.
 *     .settle(max)      tick, amíg ki nem hűl (max lépés-védőkorláttal)
 *     .reheat(a)        α = max(α, a)   (alap: 0,3)
 *     .pin(id, x, y)    fx/fy rögzítés; amíg bármi rögzített, αTarget = 0,3 (meleg marad)
 *     .unpin(id)        rögzítés feloldása; ha már semmi sincs rögzítve, αTarget = 0
 *     .setParams(p)     { centerStrength, repelStrength, linkStrength, linkDistance } (részleges is lehet).
 *                       NEM melegít fel magától — a hívó dönti el (`reheat`).
 *     .alpha() .isSettled() .indexOf(id) .count
 *     .positions        Float64Array [x0, y0, x1, y1, …] — a nodes-tömb sorrendjében.
 *                       Élő nézet: tick után ugyanaz a tömb frissül (nincs allokáció).
 *   createForceSim.sliderToParams({ center, repel, linkStrength, linkDistance })
 *   createForceSim.DEFAULT_SLIDERS · createForceSim.SLIDERS · createForceSim.CONSTANTS
 *
 * A csúszka-értékek („s") a felületen élnek; a fizika csak a leképezett
 * paramétert látja. Így a panel, a localStorage és a tesztek ugyanazt az egy
 * leképezést használják.
 */
(function (global) {
  'use strict';

  // ---------- konstansok (spec §1.2) ----------
  var ALPHA_START = 1;
  var ALPHA_MIN = 0.001;
  var ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300);   // ≈ 0,0228 — ≈300 tick alatt hűl ki
  var ALPHA_REHEAT = 0.3;
  var VELOCITY_KEEP = 0.6;                               // v ← 0,6 · v
  var COLLIDE_R = 60;                                    // ütközési sugár (világ-egység)
  var COLLIDE_STRENGTH = 0.5;
  var INITIAL_RADIUS = 10;                               // phyllotaxis (d3 alapértelmezés)
  var INITIAL_ANGLE = Math.PI * (3 - Math.sqrt(5));
  var NEW_NODE_SPREAD = 30;                              // új csomópont szórása a szomszéd-átlag körül
  var DIST_MIN2 = 1;                                     // taszítás: d² alsó korlát (d3 distanceMin²)

  // Csúszkák (a felület egységeiben) + alapértékek.
  var SLIDERS = {
    center:       { min: 0,  max: 1,   step: 0.01, def: 0.52 },  // → p ≈ 0,1
    repel:        { min: 0,  max: 20,  step: 0.1,  def: 10 },    // → P = 1000
    linkStrength: { min: 0,  max: 1,   step: 0.01, def: 1 },     // → Ls = 1
    linkDistance: { min: 30, max: 500, step: 1,    def: 250 }    // → L = 250 (közvetlenül)
  };
  var DEFAULT_SLIDERS = {
    center: SLIDERS.center.def,
    repel: SLIDERS.repel.def,
    linkStrength: SLIDERS.linkStrength.def,
    linkDistance: SLIDERS.linkDistance.def
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(v, fallback) { v = +v; return isFinite(v) ? v : fallback; }

  // s ∈ [0,1] → (0,01^(1−s) − 0,01) / 0,99 : s = 0 → 0, s = 1 → 1, s ≈ 0,52 → ≈ 0,1
  function expoUnit(s) { return (Math.pow(0.01, 1 - clamp(s, 0, 1)) - 0.01) / 0.99; }

  function sliderToParams(s) {
    s = s || {};
    var rep = clamp(num(s.repel, SLIDERS.repel.def), SLIDERS.repel.min, SLIDERS.repel.max);
    return {
      centerStrength: expoUnit(num(s.center, SLIDERS.center.def)),
      repelStrength: Math.max(1, rep * rep * rep),
      linkStrength: expoUnit(num(s.linkStrength, SLIDERS.linkStrength.def)),
      linkDistance: clamp(num(s.linkDistance, SLIDERS.linkDistance.def),
                          SLIDERS.linkDistance.min, SLIDERS.linkDistance.max)
    };
  }

  // seed-elt, hash-alapú sorozat (mulberry32) — determinisztikus „jiggle"
  function makeRng(seed) {
    var st = seed >>> 0;
    return function () {
      st = (st + 0x6D2B79F5) | 0;
      var t = Math.imul(st ^ (st >>> 15), 1 | st);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    var h = 2166136261 >>> 0, i;
    for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h;
  }

  function createForceSim(opts) {
    opts = opts || {};
    var inNodes = opts.nodes || [];
    var inEdges = opts.edges || [];
    var n = inNodes.length;

    var ids = new Array(n);
    var index = {};
    var pos = new Float64Array(n * 2);
    var vel = new Float64Array(n * 2);
    var fixed = new Uint8Array(n);
    var fx = new Float64Array(n), fy = new Float64Array(n);
    var pinnedCount = 0;
    var i, k;

    for (i = 0; i < n; i++) { ids[i] = String(inNodes[i].id); index[ids[i]] = i; }

    // élek (önhurok, ismeretlen végpont és duplikátum kimarad)
    var ls = [], lt = [], seenE = {};
    for (k = 0; k < inEdges.length; k++) {
      var e = inEdges[k];
      if (!e) continue;
      var a = index[e.source], b = index[e.target];
      if (a == null || b == null || a === b) continue;
      var key = a < b ? a + '|' + b : b + '|' + a;
      if (seenE[key]) continue;
      seenE[key] = 1;
      ls.push(a); lt.push(b);
    }
    var m = ls.length;
    var linkS = new Int32Array(ls), linkT = new Int32Array(lt);
    var degree = new Int32Array(n);
    for (k = 0; k < m; k++) { degree[linkS[k]]++; degree[linkT[k]]++; }
    var linkBias = new Float64Array(m);      // a CÉL ennyi részét viszi a korrekciónak
    var linkK = new Float64Array(m);         // 1 / min(fok_a, fok_b) — az Ls szorzó nélkül
    for (k = 0; k < m; k++) {
      var ds = degree[linkS[k]], dt = degree[linkT[k]];
      linkBias[k] = ds / (ds + dt);
      linkK[k] = 1 / Math.min(ds, dt);
    }

    var params = sliderToParams(DEFAULT_SLIDERS);
    setParams(opts.params);

    var rng = makeRng(hashStr(ids.join('\u0001')) ^ 0x5EED);
    function jiggle() { return (rng() - 0.5) * 1e-6; }

    // ---------- kezdő elrendezés ----------
    placeInitial();

    function placeInitial() {
      var has = new Uint8Array(n), any = false, j;
      for (i = 0; i < n; i++) {
        var nx = inNodes[i].x, ny = inNodes[i].y;
        if (nx != null && ny != null && isFinite(+nx) && isFinite(+ny)) {
          pos[i * 2] = +nx; pos[i * 2 + 1] = +ny; has[i] = 1; any = true;
        }
      }
      if (!any) {
        // phyllotaxis — a d3 alapértelmezett kezdőállapota
        for (i = 0; i < n; i++) {
          var r = INITIAL_RADIUS * Math.sqrt(0.5 + i), ang = i * INITIAL_ANGLE;
          pos[i * 2] = r * Math.cos(ang); pos[i * 2 + 1] = r * Math.sin(ang);
        }
        return;
      }
      // Új csomópont: a már elhelyezett szomszédok átlaga, kis (determinisztikus)
      // szórással; szomszéd nélkül a meglévő elrendezésen KÍVÜLI gyűrűre.
      var maxR = 0;
      for (i = 0; i < n; i++) {
        if (!has[i]) continue;
        var rr = Math.sqrt(pos[i * 2] * pos[i * 2] + pos[i * 2 + 1] * pos[i * 2 + 1]);
        if (rr > maxR) maxR = rr;
      }
      var ring = 0;
      for (i = 0; i < n; i++) {
        if (has[i]) continue;
        var sx = 0, sy = 0, c = 0;
        for (j = 0; j < m; j++) {
          var o = linkS[j] === i ? linkT[j] : linkT[j] === i ? linkS[j] : -1;
          if (o >= 0 && has[o]) { sx += pos[o * 2]; sy += pos[o * 2 + 1]; c++; }
        }
        if (c) {
          pos[i * 2] = sx / c + (rng() - 0.5) * 2 * NEW_NODE_SPREAD;
          pos[i * 2 + 1] = sy / c + (rng() - 0.5) * 2 * NEW_NODE_SPREAD;
        } else {
          var ra = maxR + 2 * COLLIDE_R, an = ring * INITIAL_ANGLE;
          pos[i * 2] = ra * Math.cos(an); pos[i * 2 + 1] = ra * Math.sin(an);
          ring++;
        }
      }
    }

    var alpha = ALPHA_START, alphaTarget = 0;
    if (opts.alpha != null && isFinite(+opts.alpha)) alpha = +opts.alpha;

    // ---------- erők ----------
    function forceCenter(al) {
      var p = params.centerStrength * al;
      if (!p) return;
      for (var q = 0; q < n; q++) {
        vel[q * 2] -= pos[q * 2] * p;
        vel[q * 2 + 1] -= pos[q * 2 + 1] * p;
      }
    }

    // Pontos páronkénti 1/d taszítás (a Barnes–Hut θ → 0 határesete). N ≤ 150 mellett
    // ez ≈ 11 000 pár / tick — bőven belefér egy képkockába.
    function forceRepel(al) {
      var s = params.repelStrength * al;
      if (!s) return;
      var p, q, dx, dy, l, w;
      for (p = 0; p < n; p++) {
        for (q = p + 1; q < n; q++) {
          dx = pos[q * 2] - pos[p * 2];
          dy = pos[q * 2 + 1] - pos[p * 2 + 1];
          if (dx === 0) dx = jiggle();
          if (dy === 0) dy = jiggle();
          l = dx * dx + dy * dy;
          if (l < DIST_MIN2) l = Math.sqrt(DIST_MIN2 * l);
          w = s / l;                         // |Δv| = s·d/d² = s/d
          vel[p * 2] -= dx * w; vel[p * 2 + 1] -= dy * w;
          vel[q * 2] += dx * w; vel[q * 2 + 1] += dy * w;
        }
      }
    }

    function forceLink(al) {
      var ks = params.linkStrength * al, L = params.linkDistance;
      if (!ks) return;
      var j, s, t, dx, dy, l, b;
      for (j = 0; j < m; j++) {
        s = linkS[j]; t = linkT[j];
        dx = pos[t * 2] + vel[t * 2] - pos[s * 2] - vel[s * 2];
        dy = pos[t * 2 + 1] + vel[t * 2 + 1] - pos[s * 2 + 1] - vel[s * 2 + 1];
        if (dx === 0) dx = jiggle();
        if (dy === 0) dy = jiggle();
        l = Math.sqrt(dx * dx + dy * dy);
        l = (l - L) / l * ks * linkK[j];
        dx *= l; dy *= l;
        b = linkBias[j];
        vel[t * 2] -= dx * b; vel[t * 2 + 1] -= dy * b;
        b = 1 - b;
        vel[s * 2] += dx * b; vel[s * 2 + 1] += dy * b;
      }
    }

    // Lágy ütközés a VÁRHATÓ pozíción (x + v), α nélkül. Egyenlő sugaraknál a
    // tömegarány 1/2, így a csomópontonkénti eltolás 0,5 · 0,5 · (2R − d)/d.
    function forceCollide() {
      var R2 = 2 * COLLIDE_R, R2sq = R2 * R2;
      var p, q, dx, dy, l, d;
      for (p = 0; p < n; p++) {
        for (q = p + 1; q < n; q++) {
          dx = (pos[p * 2] + vel[p * 2]) - (pos[q * 2] + vel[q * 2]);
          dy = (pos[p * 2 + 1] + vel[p * 2 + 1]) - (pos[q * 2 + 1] + vel[q * 2 + 1]);
          l = dx * dx + dy * dy;
          if (l >= R2sq) continue;
          if (dx === 0) { dx = jiggle(); l += dx * dx; }
          if (dy === 0) { dy = jiggle(); l += dy * dy; }
          d = Math.sqrt(l);
          l = (R2 - d) / d * COLLIDE_STRENGTH * 0.5;
          dx *= l; dy *= l;
          vel[p * 2] += dx; vel[p * 2 + 1] += dy;
          vel[q * 2] -= dx; vel[q * 2 + 1] -= dy;
        }
      }
    }

    function step() {
      alpha += (alphaTarget - alpha) * ALPHA_DECAY;
      forceCenter(alpha);
      forceRepel(alpha);
      forceLink(alpha);
      forceCollide();
      for (var q = 0; q < n; q++) {
        if (fixed[q]) {
          pos[q * 2] = fx[q]; pos[q * 2 + 1] = fy[q];
          vel[q * 2] = 0; vel[q * 2 + 1] = 0;
        } else {
          vel[q * 2] *= VELOCITY_KEEP; vel[q * 2 + 1] *= VELOCITY_KEEP;
          pos[q * 2] += vel[q * 2]; pos[q * 2 + 1] += vel[q * 2 + 1];
        }
      }
    }

    function isSettled() { return alpha < ALPHA_MIN && pinnedCount === 0; }

    function tick(count) {
      count = count == null ? 1 : count;
      var done = 0;
      while (done < count && !isSettled()) { step(); done++; }
      return done;
    }

    function settle(max) {
      return tick(max == null ? 2000 : max);
    }

    function reheat(a) {
      a = a == null ? ALPHA_REHEAT : +a;
      if (a > alpha) alpha = a;
    }

    function pin(id, x, y) {
      var q = index[id];
      if (q == null) return false;
      if (!fixed[q]) { fixed[q] = 1; pinnedCount++; }
      fx[q] = +x; fy[q] = +y;
      // a renderer az aktuális pozícióból rajzol → azonnal ott legyen, ne csak a következő tickben
      pos[q * 2] = fx[q]; pos[q * 2 + 1] = fy[q];
      vel[q * 2] = 0; vel[q * 2 + 1] = 0;
      alphaTarget = ALPHA_REHEAT;
      reheat(ALPHA_REHEAT);
      return true;
    }

    function unpin(id) {
      var q = index[id];
      if (q == null || !fixed[q]) return false;
      fixed[q] = 0; pinnedCount--;
      if (pinnedCount === 0) alphaTarget = 0;
      return true;
    }

    function setParams(p) {
      if (!p) return;
      if (p.centerStrength != null && isFinite(+p.centerStrength)) params.centerStrength = Math.max(0, +p.centerStrength);
      if (p.repelStrength != null && isFinite(+p.repelStrength)) params.repelStrength = Math.max(0, +p.repelStrength);
      if (p.linkStrength != null && isFinite(+p.linkStrength)) params.linkStrength = Math.max(0, +p.linkStrength);
      if (p.linkDistance != null && isFinite(+p.linkDistance)) params.linkDistance = Math.max(1, +p.linkDistance);
    }

    return {
      tick: tick,
      settle: settle,
      reheat: reheat,
      pin: pin,
      unpin: unpin,
      setParams: setParams,
      alpha: function () { return alpha; },
      isSettled: isSettled,
      isPinned: function (id) { var q = index[id]; return q != null && !!fixed[q]; },
      indexOf: function (id) { var q = index[id]; return q == null ? -1 : q; },
      params: function () { return { centerStrength: params.centerStrength, repelStrength: params.repelStrength,
                                     linkStrength: params.linkStrength, linkDistance: params.linkDistance }; },
      count: n,
      positions: pos
    };
  }

  createForceSim.sliderToParams = sliderToParams;
  createForceSim.SLIDERS = SLIDERS;
  createForceSim.DEFAULT_SLIDERS = DEFAULT_SLIDERS;
  createForceSim.CONSTANTS = {
    ALPHA_MIN: ALPHA_MIN, ALPHA_DECAY: ALPHA_DECAY, ALPHA_REHEAT: ALPHA_REHEAT,
    VELOCITY_KEEP: VELOCITY_KEEP, COLLIDE_R: COLLIDE_R, COLLIDE_STRENGTH: COLLIDE_STRENGTH,
    INITIAL_RADIUS: INITIAL_RADIUS
  };

  global.createForceSim = createForceSim;
})(window);
