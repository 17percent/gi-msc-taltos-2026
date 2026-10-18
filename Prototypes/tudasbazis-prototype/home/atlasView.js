/* atlasView.js — az „Élő Atlasz" kezdőoldal: DOM-felépítés + koreográfia.
 *
 * Nincs benne üzleti logika: a „mi a következő nézet" kérdést az `atlasMachine`
 * dönti el, az adatot a `graphModel` adja, az igazságforrás a `selectionStore`.
 * Ez a modul KÖTI ÖSSZE őket, és minden átmenetnél lejátssza a megnevezett
 * animációt (WAAPI + kamera-tween + lista-FLIP) — semmi sem „vágódik be".
 *
 * Két Canvas egymáson: alul az ambient részecskemező (a bejelentkezőből
 * ÚJRAHASZNOSÍTOTT `constellation.js`), felül a kurált térkép (`atlasRenderer.js`).
 *
 * Publikus: window.mountAtlas(container, opts) → { destroy, refresh, refreshColors }
 */
(function (global) {
  'use strict';

  var SEARCH_DEBOUNCE = 160;

  var ICON_SEARCH =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

  var ICON_ZOOM_OUT =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/></svg>';

  var ICON_ALERT =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>';

  var ICON_CARET =
    '<svg class="catfilter__caret" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

  var ICON_SLIDERS =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/>' +
    '<circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>';

  // ---------------- „Megjelenítés és erők" beállítások (D28) ----------------
  // A csúszka-POZÍCIÓK élnek itt (és a localStorage-ban); a fizikai paramétert a
  // `createForceSim.sliderToParams` képezi le — egyetlen leképezés a panelnek, a
  // tárolásnak és a teszteknek.
  //   labels: a „Címkék megjelenése" csúszka. Jobbra = MÁR TÁVOLABBRÓL is látszanak,
  //           ezért a renderer küszöbe T = −labels (Obsidian „text fade threshold").
  //   depth:  a fókusz BFS-mélysége (1..3).
  var SETTINGS_KEY = 'tb-atlas-settings';
  var SETTINGS_VERSION = 1;
  var VIEW_SLIDERS = {
    labels: { min: -3, max: 3, step: 0.5, def: 0 },
    depth: { min: 1, max: 3, step: 1, def: 1 }
  };

  function forceSliderSpec() {
    var fs = global.createForceSim && global.createForceSim.SLIDERS;
    return fs || {
      center: { min: 0, max: 1, step: 0.01, def: 0.52 },
      repel: { min: 0, max: 20, step: 0.1, def: 10 },
      linkStrength: { min: 0, max: 1, step: 0.01, def: 1 },
      linkDistance: { min: 30, max: 500, step: 1, def: 250 }
    };
  }

  function settingsSpec() {
    var f = forceSliderSpec();
    return {
      center: f.center, repel: f.repel, linkStrength: f.linkStrength, linkDistance: f.linkDistance,
      labels: VIEW_SLIDERS.labels, depth: VIEW_SLIDERS.depth
    };
  }

  function defaultSettings() {
    var spec = settingsSpec(), out = {};
    for (var k in spec) if (Object.prototype.hasOwnProperty.call(spec, k)) out[k] = spec[k].def;
    return out;
  }

  // ismeretlen/hibás érték → alapérték; tartományon kívüli → a szélére
  function sanitizeSettings(obj) {
    var spec = settingsSpec(), out = defaultSettings(), k, v;
    if (!obj || typeof obj !== 'object') return out;
    for (k in spec) {
      if (!Object.prototype.hasOwnProperty.call(spec, k)) continue;
      v = +obj[k];
      if (obj[k] == null || !isFinite(v)) continue;
      out[k] = v < spec[k].min ? spec[k].min : v > spec[k].max ? spec[k].max : v;
    }
    out.depth = Math.round(out.depth);
    return out;
  }

  // localStorage nélkül (privát mód, tiltás, kvóta) is működik: ilyenkor az
  // alapértékekkel indul, és a változás csak a munkamenetben él.
  function loadSettings(storage) {
    try {
      var raw = storage && storage.getItem(SETTINGS_KEY);
      if (!raw) return defaultSettings();
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== SETTINGS_VERSION) return defaultSettings();
      return sanitizeSettings(parsed);
    } catch (e) {
      return defaultSettings();
    }
  }
  function saveSettings(storage, s) {
    try {
      if (!storage) return false;
      var o = { v: SETTINGS_VERSION };
      for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) o[k] = s[k];
      storage.setItem(SETTINGS_KEY, JSON.stringify(o));
      return true;
    } catch (e) {
      return false;
    }
  }
  function forcesOf(s) {
    return global.createForceSim
      ? global.createForceSim.sliderToParams({ center: s.center, repel: s.repel, linkStrength: s.linkStrength, linkDistance: s.linkDistance })
      : null;
  }

  function fmtNum(v, digits) {
    var str = (+v).toFixed(digits);
    return str.replace('.', ',').replace('-', '−');
  }

  // csúszka-sorok leírása: felirat, súgó, kijelzett érték (magyar formátummal)
  var SLIDER_ROWS = [
    { key: 'center', group: 'forces', label: 'Középre húzás', hint: 'Mennyire tart a térkép a közép felé.',
      fmt: function (v) { return fmtNum(v, 2); } },
    { key: 'repel', group: 'forces', label: 'Taszítás', hint: 'Mennyire tolják el egymást a dokumentumok.',
      fmt: function (v) { return fmtNum(v, 1); } },
    { key: 'linkStrength', group: 'forces', label: 'Kapcsolatok ereje', hint: 'Mennyire húzzák össze a kapcsolatok a dokumentumokat.',
      fmt: function (v) { return fmtNum(v, 2); } },
    { key: 'linkDistance', group: 'forces', label: 'Kapcsolat hossza', hint: 'Milyen távol álljanak egymástól a kapcsolt dokumentumok.',
      fmt: function (v) { return fmtNum(v, 0); } },
    { key: 'labels', group: 'view', label: 'Címkék megjelenése', hint: 'Jobbra húzva a címkék már távolabbról is látszanak.',
      fmt: function (v) { return (v > 0 ? '+' : '') + fmtNum(v, 1); } },
    { key: 'depth', group: 'view', label: 'Fókusz mélysége', hint: 'Kiválasztáskor ennyi lépésnyi kapcsolat marad kiemelve.',
      fmt: function (v) { return fmtNum(v, 0) + ' lépés'; } }
  ];

  function settingsPanelHtml() {
    var spec = settingsSpec(), html = '', groups = { forces: 'Erők', view: 'Megjelenítés' }, g, i, r;
    for (g in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, g)) continue;
      html += '<fieldset class="atlas__settings-group"><legend class="atlas__settings-legend">' + groups[g] + '</legend>';
      for (i = 0; i < SLIDER_ROWS.length; i++) {
        r = SLIDER_ROWS[i];
        if (r.group !== g) continue;
        var sp = spec[r.key], id = 'atlas-set-' + r.key;
        html += '<div class="atlas__slider">' +
          '<label class="atlas__slider-label" for="' + id + '">' + r.label + '</label>' +
          '<output class="atlas__slider-value mono" for="' + id + '" data-out="' + r.key + '"></output>' +
          '<input class="atlas__range" type="range" id="' + id + '" data-set="' + r.key + '" ' +
                 'min="' + sp.min + '" max="' + sp.max + '" step="' + sp.step + '" ' +
                 'aria-describedby="' + id + '-hint">' +
          '<p class="atlas__slider-hint" id="' + id + '-hint">' + r.hint + '</p>' +
        '</div>';
      }
      html += '</fieldset>';
    }
    html += '<button class="btn btn--ghost btn--sm atlas__settings-reset" type="button" data-act="reset-settings">' +
            'Alapértékek visszaállítása</button>';
    return html;
  }

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function mountAtlas(container, opts) {
    opts = opts || {};
    var data = opts.data || {};
    var H = opts.helpers || {};
    var cb = opts.callbacks || {};
    var handoff = opts.handoff || null;
    var reduced = !!opts.reducedMotion;

    // ---------------- DOM ----------------
    var root = el(
      '<section class="atlas" data-view="loading" aria-label="Tudástár">' +
        '<header class="atlas__bar">' +
          '<div class="atlas__search">' +
            '<span class="atlas__search-icon" aria-hidden="true">' + ICON_SEARCH + '</span>' +
            '<input class="input atlas__input" type="search" autocomplete="off" ' +
                   'placeholder="Keresés címben és tartalomban…" aria-label="Keresés a tudástárban">' +
          '</div>' +
          '<div class="atlas__facets" role="group" aria-label="Szűrők és nézet">' +
            '<button class="btn btn--ghost btn--sm" data-facet="today" aria-pressed="false" type="button">Ma</button>' +
            '<button class="btn btn--ghost btn--sm" data-facet="mine" aria-pressed="false" type="button">Enyém</button>' +
            '<button class="btn btn--ghost btn--sm" data-facet="team" aria-pressed="false" type="button">Csapat</button>' +
            '<button class="btn btn--ghost btn--sm" data-facet="onlyFav" aria-pressed="false" type="button">★ Kedvenc</button>' +
            '<button class="btn btn--ghost btn--sm" data-facet="onlyTpl" aria-pressed="false" type="button">Sablon</button>' +
            '<select class="input atlas__select" data-select="status" aria-label="Státusz szűrő"></select>' +
            '<div class="catfilter" data-catfilter>' +
              '<div class="catfilter__control" data-catfilter-control tabindex="0" role="button" ' +
                   'aria-haspopup="true" aria-expanded="false" aria-controls="atlas-catpanel" aria-label="Kategóriák szűrése">' +
                '<span class="catfilter__tags" data-catfilter-tags>' +
                  '<span class="catfilter__placeholder">Kategóriák</span>' +
                '</span>' +
                ICON_CARET +
              '</div>' +
              '<div class="catfilter__panel" id="atlas-catpanel" role="group" aria-label="Kategóriák szűrése" ' +
                   'hidden data-catfilter-panel></div>' +
            '</div>' +
            '<button class="btn btn--ghost btn--sm" data-toggle="listonly" aria-pressed="false" type="button">Csak lista</button>' +
          '</div>' +
          '<button class="btn btn--primary btn--sm atlas__new" type="button">＋ Új dokumentum</button>' +
        '</header>' +

        '<div class="atlas__stage">' +
          '<div class="atlas__map">' +
            '<canvas class="atlas__field" aria-hidden="true"></canvas>' +
            '<canvas class="atlas__graph" aria-hidden="true"></canvas>' +
            '<div class="atlas__tools">' +
              '<button class="btn btn--sm atlas__tools-toggle" type="button" aria-expanded="false" ' +
                      'aria-controls="atlas-settings" data-act="toggle-settings">' +
                ICON_SLIDERS + '<span>Megjelenítés és erők</span>' +
              '</button>' +
              '<div class="atlas__settings" id="atlas-settings" role="group" ' +
                   'aria-label="Megjelenítés és erők" hidden>' + settingsPanelHtml() + '</div>' +
            '</div>' +
            '<div class="atlas__hud">' +
              '<div class="atlas__legend" data-legend hidden>' +
                '<p class="atlas__legend-title">Kategóriák</p>' +
                '<ul class="atlas__legend-list" data-legend-list></ul>' +
                '<p class="atlas__legend-note">Több kategória → a csomópont a színek átmenetét kapja.</p>' +
              '</div>' +
              '<button class="btn btn--sm atlas__zoomout" type="button" aria-label="Kizoomolás az áttekintésre">' +
                ICON_ZOOM_OUT + '<span>Áttekintés</span>' +
              '</button>' +
            '</div>' +
          '</div>' +

          '<aside class="atlas__results" role="region" aria-label="Találatok">' +
            '<ul class="atlas__list" role="listbox" aria-label="Dokumentumok" tabindex="0"></ul>' +
            '<div class="atlas__empty" hidden></div>' +
            '<div class="atlas__status" role="status" aria-live="polite"></div>' +
          '</aside>' +
        '</div>' +
      '</section>'
    );
    container.appendChild(root);

    var bar = root.querySelector('.atlas__bar');
    var input = root.querySelector('.atlas__input');
    var facetsWrap = root.querySelector('.atlas__facets');
    var statusSel = root.querySelector('[data-select="status"]');
    var catFilterEl = root.querySelector('[data-catfilter]');
    var catControl = root.querySelector('[data-catfilter-control]');
    var catTagsEl = root.querySelector('[data-catfilter-tags]');
    var catPanel = root.querySelector('[data-catfilter-panel]');
    var listOnlyBtn = root.querySelector('[data-toggle="listonly"]');
    var newBtn = root.querySelector('.atlas__new');
    var mapEl = root.querySelector('.atlas__map');
    var fieldCanvas = root.querySelector('.atlas__field');
    var graphCanvas = root.querySelector('.atlas__graph');
    var zoomOutBtn = root.querySelector('.atlas__zoomout');
    var legendEl = root.querySelector('[data-legend]');
    var legendListEl = root.querySelector('[data-legend-list]');
    var listEl = root.querySelector('.atlas__list');
    var emptyEl = root.querySelector('.atlas__empty');
    var statusEl = root.querySelector('.atlas__status');
    var resultsEl = root.querySelector('.atlas__results');
    var settingsToggle = root.querySelector('[data-act="toggle-settings"]');
    var settingsEl = root.querySelector('.atlas__settings');
    var settingsReset = root.querySelector('[data-act="reset-settings"]');

    // a felhasználó kényelmi beállításai (localStorage, ha elérhető)
    var storage = null;
    try { storage = global.localStorage || null; } catch (e) { storage = null; }
    var settings = loadSettings(storage);

    // token-vezérelt időzítés
    var cs = getComputedStyle(root);
    function ms(name, fallback) {
      var v = cs.getPropertyValue(name).trim();
      if (!v) return fallback;
      return v.indexOf('ms') > -1 ? parseFloat(v) : parseFloat(v) * 1000;
    }
    var DUR = {
      fast: ms('--duration-fast', 150), base: ms('--duration-base', 250),
      slow: ms('--duration-slow', 400), slower: ms('--duration-slower', 600)
    };
    // térköz-token → px (a legördülő kézi igazításához; rem-et is feloldunk)
    function px(name, fallback) {
      var v = cs.getPropertyValue(name).trim();
      if (!v) return fallback;
      var n = parseFloat(v);
      if (isNaN(n)) return fallback;
      if (v.indexOf('rem') > -1) {
        return n * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
      }
      return n;
    }
    var PANEL_GAP = px('--space-2', 8);
    var EASE_GROW = cs.getPropertyValue('--ease-grow').trim() || 'cubic-bezier(.22,1,.36,1)';

    // ---------------- szűrő-vezérlők feltöltése ----------------
    function fillStatusSelect() {
      var sHtml = '<option value="">Minden státusz</option>';
      var statuses = data.statuses || [];
      for (var i = 0; i < statuses.length; i++) {
        sHtml += '<option value="' + statuses[i] + '">' + statuses[i] + '</option>';
      }
      statusSel.innerHTML = sHtml;
    }
    fillStatusSelect();

    // ---------------- kategória-szűrő: multiszelekt dropdown (checkbox-lista) ----------------
    // A kiválasztott kategóriák a vezérlőn belül tag-ként jelennek meg, „×"
    // gombbal törölhetők; a legördülő panelben checkbox-listával több is
    // kiválasztható egyszerre. A kánoni sorrend MINDIG a `data.categories`
    // eredeti sorrendje — így a store `filters.categories` tömbje kattintási
    // sorrendtől függetlenül összehasonlítható (lásd selectionStore `sameArray`).
    function categoryNames() {
      var cats = data.categories || [], out = [];
      for (var i = 0; i < cats.length; i++) if (cats[i] && cats[i].name) out.push(cats[i].name);
      return out;
    }

    // A kategória paletta-slotja a modellből jön (egyetlen igazságforrás), így a
    // legördülő színjelei biztosan ugyanazok, mint a térkép csomópontjain.
    // A legördülő EGYBEN jelmagyarázat: a szín önmagában sosem hordoz jelentést.
    function slotOf(name) {
      if (!model || !model.categorySlots) return 0;
      var m = model.categorySlots();
      return m[name] || 0;
    }

    function swatch(slot) {
      return slot ? '<span class="catswatch" data-slot="' + slot + '" aria-hidden="true"></span>' : '';
    }

    function renderCategoryPanel() {
      var names = categoryNames();
      var html = '';
      for (var i = 0; i < names.length; i++) {
        var n = H.esc ? H.esc(names[i]) : names[i];
        html += '<label class="chk catfilter__option">' +
          '<input type="checkbox" data-catopt="' + n + '">' +
          swatch(slotOf(names[i])) +
          '<span>' + n + '</span>' +
        '</label>';
      }
      catPanel.innerHTML = html || '<p class="catfilter__empty">Nincs kategória.</p>';
    }
    // Első renderelés még modell NÉLKÜL fut (a vezérlőnek létezni kell, mire a
    // modell felépül) → ilyenkor még nincs színjel. A `boot()` a modell
    // elkészülte után ÚJRA rendereli, akkor kerülnek be a slot-színek.
    renderCategoryPanel();

    // ---------------- jelmagyarázat a térkép bal alsó sarkában ----------------
    // Szín → kategória, hogy a térkép színei dekódolhatók legyenek. Az adat a
    // MODELLBŐL jön (`categoryLegend()`), tehát ugyanabból az egy igazságforrásból,
    // mint a csomópontok slotjai — nem tud elcsúszni tőlük. A dokumentumszám mono
    // betűvel (adat), és ott van a többkategóriás csomópontok magyarázata is.
    function renderLegend() {
      if (!model || !model.categoryLegend) { legendEl.hidden = true; return; }
      var rows = model.categoryLegend(), html = '', i, nm;
      for (i = 0; i < rows.length; i++) {
        nm = H.esc ? H.esc(rows[i].name) : rows[i].name;
        html += '<li class="atlas__legend-item">' +
          swatch(rows[i].slot) +
          '<span class="atlas__legend-name">' + nm + '</span>' +
          '<span class="atlas__legend-count mono">' + rows[i].count + '</span>' +
        '</li>';
      }
      legendListEl.innerHTML = html;
      legendEl.hidden = !rows.length;
    }

    // a trigger + panel vizuális állapotát a store `filters.categories`-ből tükrözi
    function paintCategoryFilter() {
      var selected = store.state.filters.categories;
      var selSet = {};
      for (var i = 0; i < selected.length; i++) selSet[selected[i]] = true;

      var tagsHtml = '';
      if (!selected.length) {
        tagsHtml = '<span class="catfilter__placeholder">Kategóriák</span>';
      } else {
        for (i = 0; i < selected.length; i++) {
          var n = H.esc ? H.esc(selected[i]) : selected[i];
          tagsHtml += '<span class="tag catfilter__tag">' + swatch(slotOf(selected[i])) + n +
            '<button type="button" class="catfilter__remove" data-remove="' + n + '" ' +
                    'aria-label="„' + n + '” eltávolítása a szűrőből">×</button>' +
          '</span>';
        }
      }
      catTagsEl.innerHTML = tagsHtml;

      var boxes = catPanel.querySelectorAll('input[data-catopt]');
      for (i = 0; i < boxes.length; i++) {
        boxes[i].checked = !!selSet[boxes[i].getAttribute('data-catopt')];
      }
    }

    function setSelectedCategories(next) {
      // kánoni sorrend: mindig a data.categories eredeti sorrendje
      var order = categoryNames(), inNext = {}, i, canon = [];
      for (i = 0; i < next.length; i++) inNext[next[i]] = true;
      for (i = 0; i < order.length; i++) if (inNext[order[i]]) canon.push(order[i]);
      store.setFilters({ categories: canon });
      paintCategoryFilter();
      afterFilterChange();
    }

    function toggleCategory(name) {
      var cur = store.state.filters.categories.slice();
      var idx = cur.indexOf(name);
      if (idx > -1) cur.splice(idx, 1); else cur.push(name);
      setSelectedCategories(cur);
    }

    // A panel a <body>-ba KERÜL ÁT (portál). Ez nem stílus-kérdés: az `.atlas__bar`
    // `backdrop-filter`-e (mint a `filter`/`transform`) CONTAINING BLOCKOT csinál a
    // `position:fixed` leszármazottaknak, így a panel a SÁV boxához igazodott, nem a
    // viewporthoz — miközben a `getBoundingClientRect()` viewport-koordinátát ad.
    // Innen jött, hogy a legördülő nem a vezérlő alatt jelent meg. A body-ban a
    // `fixed` újra a viewporthoz mér, és 640px alatt a facet-sáv `overflow-x:auto`-ja
    // sem vágja le. Ami emiatt kézi kezelést igényel: a kívülre-kattintás és az
    // Escape (a panel már nem a `catfilter` leszármazottja) — lásd lentebb.
    document.body.appendChild(catPanel);

    function positionCategoryPanel() {
      var r = catControl.getBoundingClientRect();
      var vw = global.innerWidth, vh = global.innerHeight;
      catPanel.style.minWidth = Math.max(220, Math.round(r.width)) + 'px';

      // a valódi méret csak láthatóan mérhető — ezért a megnyitás ELŐBB mutat, aztán igazít
      var pw = catPanel.offsetWidth || 220;
      var ph = catPanel.offsetHeight || 0;

      var left = Math.min(r.left, vw - pw - PANEL_GAP);
      if (left < PANEL_GAP) left = PANEL_GAP;

      // alapból a vezérlő ALATT; ha ott nem fér el, de fölötte igen, felnyílik
      var top = r.bottom + PANEL_GAP;
      if (ph && top + ph > vh - PANEL_GAP && r.top - PANEL_GAP - ph > PANEL_GAP) {
        top = r.top - PANEL_GAP - ph;
      }

      catPanel.style.left = Math.round(left) + 'px';
      catPanel.style.top = Math.round(top) + 'px';
    }

    var catPanelOpen = false;
    function openCategoryPanel() {
      if (catPanelOpen) return;
      catPanelOpen = true;
      catPanel.hidden = false;              // ELŐBB látható, hogy mérhető legyen…
      positionCategoryPanel();              // …és csak utána igazítunk (egy képkockán belül)
      catControl.setAttribute('aria-expanded', 'true');
      global.addEventListener('resize', positionCategoryPanel);
      // capture: bármelyik szülő-konténer görgetése is elmozdítja a vezérlőt
      global.addEventListener('scroll', positionCategoryPanel, true);
    }
    function closeCategoryPanel(refocus) {
      if (!catPanelOpen) return;
      catPanelOpen = false;
      catPanel.hidden = true;
      catControl.setAttribute('aria-expanded', 'false');
      global.removeEventListener('resize', positionCategoryPanel);
      global.removeEventListener('scroll', positionCategoryPanel, true);
      if (refocus) catControl.focus();
    }

    function onCatControlClick(e) {
      if (e.target.closest && e.target.closest('.catfilter__remove')) return;   // az eltávolítás nem nyit/zár
      if (catPanelOpen) closeCategoryPanel(false); else openCategoryPanel();
    }
    function onCatControlKeydown(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (catPanelOpen) closeCategoryPanel(false); else openCategoryPanel();
      } else if (e.key === 'ArrowDown' && !catPanelOpen) {
        e.preventDefault();
        openCategoryPanel();
        var first = catPanel.querySelector('input[data-catopt]');
        if (first) first.focus();
      } else if (e.key === 'Escape' && catPanelOpen) {
        closeCategoryPanel(true);
      }
    }
    function onCatTagsClick(e) {
      var rm = e.target.closest ? e.target.closest('.catfilter__remove') : null;
      if (!rm) return;
      e.stopPropagation();
      toggleCategory(rm.getAttribute('data-remove'));
    }
    function onCatPanelChange(e) {
      var box = e.target.closest ? e.target.closest('input[data-catopt]') : null;
      if (!box) return;
      toggleCategory(box.getAttribute('data-catopt'));
    }
    function onCatFilterKeydown(e) {
      if (e.key === 'Escape' && catPanelOpen) { e.stopPropagation(); closeCategoryPanel(true); }
    }
    // A panel a body-ban van, tehát NEM a `catfilter` leszármazottja: a
    // „kívülre kattintás" és az Escape ezért mindkét gyökeret figyeli.
    function onDocClickForCatFilter(e) {
      if (!catPanelOpen) return;
      if (catFilterEl.contains(e.target) || catPanel.contains(e.target)) return;
      closeCategoryPanel(false);
    }
    catControl.addEventListener('click', onCatControlClick);
    catControl.addEventListener('keydown', onCatControlKeydown);
    catTagsEl.addEventListener('click', onCatTagsClick);
    catPanel.addEventListener('change', onCatPanelChange);
    catFilterEl.addEventListener('keydown', onCatFilterKeydown);
    catPanel.addEventListener('keydown', onCatFilterKeydown);
    document.addEventListener('click', onDocClickForCatFilter);

    // ---------------- állapot-modulok ----------------
    var store = global.createSelectionStore();
    var machine = global.createAtlasMachine({ onTransition: onTransition });
    var model = null, map = null, field = null, list = null;
    var lastView = null;          // { nodes, edges, matchIds }
    var destroyed = false;

    // ---------------- zoom ↔ lista: NINCS összefüggés ----------------
    // A lista tartalmát KIZÁRÓLAG a facetek és a keresés határozzák meg — a
    // kamera állása nem. Korábban rázoomolva a lista a nézetben látható
    // dokumentumokra szűkült; ez két okból került ki:
    //   1. minden zoom/pan újraépítette és átrendezte a listát, ami csak zaj volt;
    //   2. a csomópontra kattintás kamera-tweent indít, a tween utáni szűkítés
    //      pedig ÚJRAÉPÍTETTE a sorokat — így a kijelölt sorhoz való odagördülés
    //      elveszett, és a lista nem ott állt, ahol a kiválasztott elem van.
    // A „mit látsz a térképen" kérdésre továbbra is a halványítás
    // (`setDimmed` / `setExcluded`) válaszol, nem a lista megkurtítása.

    // ambient részecskemező — a BEJELENTKEZŐBŐL újrahasznosított motor
    field = global.createConstellation(fieldCanvas, {
      intensity: 'balanced',
      reducedMotion: reduced
    });
    // FOLYTONOSSÁG: ha a bejelentkezőtől kaptunk pillanatképet, a csillagkép
    // ott folytatódik, ahol abbahagyta — nem keveredik újra.
    if (handoff && handoff.ambient) field.applySnapshot(handoff.ambient);
    field.setMode('idle');
    field.start();

    // kurált térkép
    try {
      model = global.createGraphModel(buildRaw(), { tier: 0 });
      map = global.createAtlasRenderer(graphCanvas, {
        intensity: 'balanced',
        reducedMotion: reduced,
        onHover: function (id) { store.setHover(nodeToDoc(id)); },
        onSelect: onMapSelect,
        forces: forcesOf(settings),
        labelFade: -settings.labels
        // `onViewport` szándékosan nincs: a lista nem követi a kamerát (lásd fentebb)
      });
    } catch (err) {
      map = null;
    }

    list = global.createResultsList(listEl, {
      store: store,
      reducedMotion: reduced,
      onOpen: function (docId) { if (cb.onOpenDoc) cb.onOpenDoc(docId); },
      onToggleFav: function (docId) { if (cb.onToggleFav) cb.onToggleFav(docId); }
    });

    // ---------------- adat ----------------
    function buildRaw() {
      var docs = data.docs || [];
      var out = [];
      for (var i = 0; i < docs.length; i++) {
        var d = docs[i];
        out.push({
          id: d.id, title: d.title, categories: d.categories || [],
          ownerId: d.ownerId, authorIds: d.authorIds || [],
          updatedAt: d.updatedAt, status: d.status,
          isTemplate: !!d.isTemplate, iteration: d.iteration,
          text: d.text || ''                // tartalom a kereséshez
        });
      }
      return {
        docs: out,
        categories: data.categories || [],
        users: data.users || [],
        currentUserId: data.currentUserId
      };
    }

    // Kattintás a térképen. A kategória nem hely többé, csak facet — nincs
    // domén-csomópont, amire kattintani lehetne. Két cél maradt:
    //  · üres terület → kizoomolás áttekintésre (a renderer null-t ad)
    //  · dokumentum-csomópont → kiválasztás (kamera ráközelít, a lista odagördül);
    //    UGYANARRA újra kattintva pedig KIKAPCSOL a fókusz, és a kamera visszatér
    //    az eredeti áttekintésre — így egy kattintással kijössz a mélységből.
    function onMapSelect(nodeId) {
      if (!nodeId) {
        if (!store.state.selectedId) return;
        backToOverview();
        return;
      }
      var n = model ? model.nodeById(nodeId) : null;
      if (!n || !n.docId) return;
      if (store.state.selectedId === n.docId) backToOverview();
      else store.select(n.docId);
    }

    // egy helyen a „vissza az áttekintésre" út: kijelölés törlése + kamera-tween
    function backToOverview() {
      store.select(null);
      machine.send('ZOOM_OUT');
      recompute();
    }

    // a megadott halmazon KÍVÜLI csomópont-id-k (ezeket halványítja a renderer —
    // találatoknál a nem-találatok, kiválasztásnál a szomszédságon kívüliek)
    function idsOutside(nodes, keepIds) {
      var keep = {};
      for (var m = 0; m < keepIds.length; m++) keep[keepIds[m]] = true;
      var out = [];
      for (var i = 0; i < nodes.length; i++) {
        if (!keep[nodes[i].id]) out.push(nodes[i].id);
      }
      return out;
    }

    // a térkép csomópont-id-jéből dokumentum-id
    function nodeToDoc(nodeId) {
      if (!nodeId || !model) return null;
      var n = model.nodeById(nodeId);
      if (!n) return null;
      return n.docId || null;
    }
    function docToNode(docId) {
      if (!docId || !model) return null;
      var n = model.nodeForDoc(docId);
      return n ? n.id : null;
    }

    function currentFacets() {
      var f = store.state.filters;
      return {
        today: f.today, mine: f.mine, team: f.team,
        status: f.status, categories: f.categories,
        onlyFav: f.onlyFav, onlyTpl: f.onlyTpl,
        favoriteIds: data.favoriteIds || []
      };
    }

    // A lista tételei — az escape/formázás a hívótól kapott helperekkel
    function buildItems(docIds, query) {
      var byId = {};
      var docs = data.docs || [];
      for (var i = 0; i < docs.length; i++) byId[docs[i].id] = docs[i];
      var items = [];
      for (var j = 0; j < docIds.length; j++) {
        var d = byId[docIds[j]];
        if (!d) continue;
        // a listasor kategória-címkéi ugyanazt a paletta-slotot kapják, mint a
        // térkép csomópontjai → a térkép színei a listából dekódolhatók
        var cats = [];
        for (var c = 0; c < (d.categories || []).length; c++) {
          cats.push({
            name: H.esc ? H.esc(d.categories[c]) : d.categories[c],
            slot: slotOf(d.categories[c])
          });
        }
        items.push({
          id: d.id,
          title: H.esc ? H.esc(d.title) : d.title,
          status: d.status,
          statusClass: 'st-' + d.status,
          isTemplate: !!d.isTemplate,
          categories: cats,
          ownerName: H.userName ? H.esc(H.userName(d.ownerId)) : '',
          updatedText: H.fmtDate ? H.fmtDate(d.updatedAt) : '',
          iteration: d.iteration,
          lockedBy: H.lockedByName ? H.lockedByName(d.id) : '',
          isFav: H.isFav ? !!H.isFav(d.id) : false,
          snippetHtml: query && H.snippetHtml ? H.snippetHtml(d.id, query) : ''
        });
      }
      return items;
    }

    // ---------------- a nézet újraszámolása (a store állapotából) ----------------
    // FONTOS: a térkép adatkészlete SOHA nem szűkül — sem a fókuszra, sem a
    // SZŰRŐRE. Mélyebbre navigálva (kiválasztás) a többi gombóc nem tűnik el,
    // csak elhalványul (`map.setDimmed`); szűréskor a kiesett dokumentumok
    // halvány üres karikaként ott maradnak (`map.setExcluded`). Mindkettőt az
    // `getOverview()` + a szűkebb nézet UNIÓJA adja (`mergeViews`), így a
    // szűkebb halmaz minden tagja garantáltan jelen van a rajzolt adatban, még
    // ha az áttekintés top-N kurálása kihagyta is.
    //
    // Miért halványítás és nem eltüntetés? Ha a kiszűrt csomópontok eltűnnek, a
    // térkép befoglalója (és vele a kamera illesztése) minden szűrő-kattintásra
    // átrendeződik: a megmaradt csomópontok „szétugranak", és elveszik a térbeli
    // memória — pedig épp az az értéke, hogy ugyanaz a dokumentum mindig ugyanott
    // van. Így a szűrő KIEMEL a tudástárban, nem pedig ÚJRARAJZOLJA azt.
    function recompute(opt) {
      opt = opt || {};
      if (!model) return;
      var s = store.state;
      var facetRes = model.applyFacets(currentFacets());
      var q = s.query.trim();
      var view, docIds, matchIds = null, focusIds = null;

      if (q) {
        var sres = model.search(q, { max: 60 });
        matchIds = sres.matchIds || [];
        // A keresés sem SZŰKÍTI a rajzolt halmazt: a nem-találatok halványan
        // ott maradnak (setDimmed). Ez az élő szimuláció miatt kell — ugyanaz a
        // halmaz = ugyanaz a szimuláció, így a gépelés nem rendezi át a térképet.
        view = mergeViews(sres, model.getOverview());
        docIds = [];
        for (var i = 0; i < matchIds.length; i++) {
          var n = model.nodeById(matchIds[i]);
          if (n && n.docId) docIds.push(n.docId);
        }
      } else if (s.selectedId) {
        var nid = docToNode(s.selectedId);
        var overview = model.getOverview();
        // a fókusz környezete: BFS a beállított mélységig (D28, D-3: helyben, halványítással)
        var nb = nid ? model.getNeighborhood(nid, { depth: settings.depth }) : null;
        // A fókusz-halmaz ELŐL: a renderer csak az első MAX_VISIBLE csomópontot veszi
        // át, így 150+ dokumentumnál az áttekintés nem szoríthatja ki a kijelöltet.
        view = nb ? mergeViews(nb, overview) : overview;
        focusIds = nb ? nb.nodes.map(function (nd) { return nd.id; }) : null;
        docIds = facetRes.docIds.slice();
      } else {
        view = model.getOverview();
        docIds = facetRes.docIds.slice();
      }

      // Aktív szűrő: a teljes halmazt KONTEXTUS-RÉTEGKÉNT húzzuk a nézet alá, és
      // a szűrőn kívüliek listáját átadjuk a rendererrel halványításra. A szűkebb
      // nézet az UNIÓ ELEJÉN van, így a renderer 150-es sapkája sosem tőle vág le.
      var excludedIds = null;
      if (facetRes.active) {
        view = mergeViews(view, model.getOverview({ includeInactive: true }));
        excludedIds = idsOutside(view.nodes, facetRes.nodeIds);
      }

      view.matchIds = matchIds;
      lastView = view;
      if (map) {
        map.setData({ nodes: view.nodes, edges: view.edges });
        map.setHighlight({
          selectedId: docToNode(s.selectedId),
          hoverId: docToNode(s.hoverId),
          matchIds: matchIds
        });
        // A renderer a NEKI ÁTADOTT id-ket halványítja. Keresésnél a
        // nem-találatok, kiválasztásnál a szomszédságon KÍVÜLI csomópontok
        // halványulnak — soha nem tűnnek el a rajzolt adatból.
        var dimIds = null;
        // keresésnél találat nélkül MINDEN halvány (a térkép nem ürül ki)
        if (q) dimIds = idsOutside(view.nodes, matchIds || []);
        else if (focusIds && focusIds.length) dimIds = idsOutside(view.nodes, focusIds);
        map.setDimmed(dimIds);
        // a szűrőn kívüliek erősebb háttérbe-tolása (üres karika + inert)
        map.setExcluded(excludedIds);
      }

      list.setItems(buildItems(docIds, q), { query: q });

      // Szűrő mellett üres találat: a lista nem tud mit mutatni, de a térkép igen —
      // ezért itt is kell kiút. (Keresésnél ezt az FSM `empty` állapota végzi.)
      // A feltétel a SZŰRŐ eredményére néz, nem a `docIds`-re: ha a lista csak a
      // kamera-nézet miatt ürült ki (rázoomoltál egy üres részre), az nem
      // „nincs találat", arra a kizoomolás a válasz. Hibaállapotban a panel a
      // térkép-hibát mutatja — azt nem írjuk felül.
      if (!q && machine.state !== 'error') {
        if (facetRes.active && facetRes.docIds.length === 0) {
          if (emptyEl.hidden) showEmpty('', excludedIds ? excludedIds.length : 0);
        } else {
          emptyEl.hidden = true;
        }
      }

      if (!opt.silent) announceCount(docIds.length, q, excludedIds ? excludedIds.length : 0);
      return docIds.length;
    }

    // Minden szűrő-váltás EGY úton fut le. A kijelölés csak akkor maradhat meg, ha
    // a dokumentum bent van a szűrt halmazban: a kiesett csomópont a térképen már
    // nem választható (halvány, inert), a listában pedig nem lenne sora — így a
    // fókusz „láthatatlan" állapotba csúszna. Ezért ilyenkor elengedjük.
    function afterFilterChange() {
      var sel = store.state.selectedId;
      if (sel && model) {
        var res = model.applyFacets(currentFacets());
        if (res.active && res.docIds.indexOf(sel) < 0) store.select(null);
      }
      machine.send('FILTER', store.state.filters);
      recompute();
    }

    // Két nézet (csomópont/él) uniója, id szerint deduplikálva. A fókusz-
    // szomszédság mindig ráépül az áttekintésre — semmi nem esik ki.
    function mergeViews(base, extra) {
      var nodes = base.nodes.slice(), edges = base.edges.slice();
      var seenN = {}, seenE = {}, i, k;
      for (i = 0; i < nodes.length; i++) seenN[nodes[i].id] = true;
      for (i = 0; i < edges.length; i++) seenE[edges[i].source + '>' + edges[i].target] = true;
      for (i = 0; i < extra.nodes.length; i++) {
        if (!seenN[extra.nodes[i].id]) { seenN[extra.nodes[i].id] = true; nodes.push(extra.nodes[i]); }
      }
      for (i = 0; i < extra.edges.length; i++) {
        k = extra.edges[i].source + '>' + extra.edges[i].target;
        if (!seenE[k]) { seenE[k] = true; edges.push(extra.edges[i]); }
      }
      return { nodes: nodes, edges: edges };
    }

    // A halványított csomópontok számát KIMONDJUK: a szűrés eredménye így nem
    // csak a térkép halványságából olvasható ki (képernyőolvasóval sem).
    function announceCount(n, q, ghostCount) {
      if (machine.state === 'error') return;
      var txt;
      if (q) txt = n + ' találat a(z) „' + q + '” keresésre.';
      else txt = n + ' dokumentum. Nyilakkal lépkedhetsz, Enterrel kiválasztod, még egy Enterrel megnyitod.';
      if (!q && ghostCount > 0) {
        txt += ' A szűrőből kimaradt ' + ghostCount +
               ' dokumentum halványan a térképen marad, de most nem választható.';
      }
      statusEl.textContent = txt;
    }

    // ---------------- FSM → koreográfia ----------------
    function onTransition(now, prev, ctx, event) {
      root.dataset.view = now;

      if (now === 'overview') {
        emptyEl.hidden = true;
        if (map) map.toOverview({ animate: prev !== 'loading' });
        if (prev === 'loading') playEntrance();
      } else if (now === 'focused') {
        emptyEl.hidden = true;
        var nid = docToNode(ctx.selectedId);
        if (map && nid) map.focusOn(nid, { animate: true, depth: settings.depth });
      } else if (now === 'searching') {
        emptyEl.hidden = true;
      } else if (now === 'empty') {
        showEmpty(ctx.query);
      } else if (now === 'error') {
        showError();
      }
    }

    // ---------------- belépő koreográfia ----------------
    function playEntrance() {
      // Az ambient mező FOLYTATÓDIK a bejelentkezőből → nincs fade, nem pislog.
      // A kurált térkép „kigyúl", a lista sorai staggerrel jönnek be.
      if (reduced) { graphCanvas.style.opacity = '1'; return; }

      graphCanvas.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: DUR.slower, easing: EASE_GROW, fill: 'both' }
      );
      if (!handoff) {
        fieldCanvas.animate([{ opacity: 0 }, { opacity: 1 }],
          { duration: DUR.slower, easing: EASE_GROW, fill: 'both' });
      }
      bar.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: DUR.base, easing: EASE_GROW, fill: 'both' });

      var rows = listEl.querySelectorAll('.atlas__row');
      for (var i = 0; i < rows.length && i < 14; i++) {
        rows[i].animate(
          [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: DUR.base, easing: EASE_GROW, fill: 'both', delay: 90 + i * 40 }
        );
      }
    }

    // Két üres eset: keresésre nincs találat (q), vagy a szűrőknek egy dokumentum
    // sem felel meg (q === ''). Utóbbinál elmondjuk, hogy a térkép nem ürült ki.
    function showEmpty(q, ghostCount) {
      emptyEl.hidden = false;
      var title = q ? 'Nincs találat' : 'Egy dokumentum sem felel meg a szűrőknek';
      var lead = q
        ? 'Próbálj tágabb kulcsszót, vagy törölj egy szűrőt.'
        : 'A dokumentumok halványan a térképen maradtak — törölj egy szűrőt, hogy újra elérd őket.';
      emptyEl.innerHTML =
        '<div class="empty-state">' +
          '<p class="empty-state__title">' + title + '</p>' +
          '<p class="empty-state__lead">' + lead + '</p>' +
          '<button class="btn btn--sm" type="button" data-act="clear">Szűrők törlése</button>' +
        '</div>';
      var b = emptyEl.querySelector('[data-act="clear"]');
      if (b) b.addEventListener('click', clearAll);
      statusEl.textContent = q
        ? 'Nincs találat a(z) „' + q + '” keresésre.'
        : 'Egy dokumentum sem felel meg a szűrőknek. ' + (ghostCount || 0) +
          ' dokumentum halványan a térképen marad.';
      if (!reduced) {
        emptyEl.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: DUR.base, easing: EASE_GROW, fill: 'both' });
      }
    }

    function showError() {
      // Fallback: a térkép eltűnik, a lista teljes szélességen átveszi a helyét.
      root.dataset.listonly = 'true';
      emptyEl.hidden = false;
      emptyEl.innerHTML =
        '<div class="atlas__alert" role="alert">' +
          '<span class="atlas__alert-icon">' + ICON_ALERT + '</span>' +
          '<div class="atlas__alert-body">' +
            '<span>A térképet most nem tudjuk megjeleníteni. A lista teljes értékűen használható.</span>' +
            '<button class="btn btn--sm" type="button" data-act="retry">Próbáld újra</button>' +
          '</div>' +
        '</div>';
      var r = emptyEl.querySelector('[data-act="retry"]');
      if (r) {
        r.addEventListener('click', function () { machine.send('RETRY'); boot(); });
        r.focus();
      }
      statusEl.textContent = 'A térkép nem elérhető — a lista használható.';
    }

    function clearAll() {
      input.value = '';
      store.setFilters({ today: false, mine: false, team: false, status: '', categories: [], onlyFav: false, onlyTpl: false });
      statusSel.value = '';
      paintFacetButtons();
      paintCategoryFilter();
      store.clear();
      machine.send('CLEAR');
      recompute();
    }

    // ---------------- store → panelek ----------------
    var unsubscribe = store.subscribe(function (s, prev) {
      // hover: csak vizuális kiemelés mindkét panelen (a lista maga is figyeli)
      if (s.hoverId !== prev.hoverId && map) {
        map.setHighlight({
          selectedId: docToNode(s.selectedId),
          hoverId: docToNode(s.hoverId),
          matchIds: lastView && lastView.matchIds ? lastView.matchIds : null
        });
      }
      if (s.selectedId !== prev.selectedId) {
        // ELŐBB az adat, UTÁNA az FSM: a `focusOn(id)` csak a legutóbbi
        // `setData`-ból ismert csomópontokat látja, ezért a szomszédság-nézetnek
        // már a kamera-tween indulásakor a rendererben kell lennie.
        recompute({ silent: true });
        if (s.selectedId) machine.send('SELECT', s.selectedId);
        else machine.send('CLEAR');
      }
      if (s.query !== prev.query) {
        var q = s.query.trim();
        if (q) {
          machine.send('SEARCH', q);
          var n = recompute();
          machine.send('RESULTS_OK', n);
        } else if (s.selectedId) {
          // A keresés törlése nem szünteti meg a kiválasztást — különben az FSM
          // „overview"-ra állna, miközben a store még fókuszált csomópontot tart.
          recompute();
        } else {
          machine.send('CLEAR');
          recompute();
        }
      }
    });

    // ---------------- vezérlők ----------------
    var searchTimer = 0;
    function onInput() {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { store.setQuery(input.value); }, SEARCH_DEBOUNCE);
    }
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { input.value = ''; store.setQuery(''); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); list.focusList(); }
    });

    function paintFacetButtons() {
      var f = store.state.filters;
      var btns = facetsWrap.querySelectorAll('[data-facet]');
      for (var i = 0; i < btns.length; i++) {
        var k = btns[i].getAttribute('data-facet');
        btns[i].setAttribute('aria-pressed', f[k] ? 'true' : 'false');
      }
    }

    function onFacetClick(e) {
      var b = e.target.closest ? e.target.closest('[data-facet]') : null;
      if (!b || !facetsWrap.contains(b)) return;
      var k = b.getAttribute('data-facet');
      var patch = {};
      patch[k] = !store.state.filters[k];
      store.setFilters(patch);
      paintFacetButtons();
      afterFilterChange();
    }
    facetsWrap.addEventListener('click', onFacetClick);

    function onStatusChange() {
      store.setFilters({ status: statusSel.value });
      afterFilterChange();
    }
    statusSel.addEventListener('change', onStatusChange);

    function toggleListOnly() {
      var on = root.dataset.listonly === 'true';
      if (on) {
        delete root.dataset.listonly;
        listOnlyBtn.setAttribute('aria-pressed', 'false');
        field.start(); if (map) map.start();
      } else {
        root.dataset.listonly = 'true';
        listOnlyBtn.setAttribute('aria-pressed', 'true');
        field.stop(); if (map) map.stop();   // rejtett térkép = ne pörgessünk rAF-ot
      }
      setTimeout(function () { field.resize(); if (map) map.resize(); }, 0);
    }
    listOnlyBtn.addEventListener('click', toggleListOnly);

    zoomOutBtn.addEventListener('click', backToOverview);

    // ---------------- „Megjelenítés és erők" panel ----------------
    // Összecsukható (gomb + aria-expanded). Minden csúszka-mozdulat azonnal hat:
    // az erő-csúszka felmelegíti a szimulációt (α = 0,3; reduced motionnél a
    // renderer szinkron a nyugalomig futtat), a címke-csúszka újrarajzol, a
    // mélység-csúszka a fókusz kiemelését (és kamera-illesztését) frissíti.
    var settingsInputs = settingsEl.querySelectorAll('input[data-set]');

    function paintSettings() {
      for (var i = 0; i < settingsInputs.length; i++) {
        var key = settingsInputs[i].getAttribute('data-set');
        settingsInputs[i].value = String(settings[key]);
        paintSettingValue(key);
      }
    }
    function paintSettingValue(key) {
      var out = settingsEl.querySelector('[data-out="' + key + '"]');
      if (!out) return;
      for (var i = 0; i < SLIDER_ROWS.length; i++) {
        if (SLIDER_ROWS[i].key === key) { out.textContent = SLIDER_ROWS[i].fmt(settings[key]); return; }
      }
    }

    function applySettings(changedKey) {
      if (!map || !map.setSettings) return;
      var isForce = !changedKey || changedKey === 'center' || changedKey === 'repel' ||
                    changedKey === 'linkStrength' || changedKey === 'linkDistance';
      var patch = {};
      if (isForce) patch.forces = forcesOf(settings);
      if (!changedKey || changedKey === 'labels') patch.labelFade = -settings.labels;
      if (patch.forces || patch.labelFade != null) map.setSettings(patch);
      if ((!changedKey || changedKey === 'depth') && store.state.selectedId && !store.state.query.trim()) {
        recompute({ silent: true });
        var fid = docToNode(store.state.selectedId);
        if (fid) map.focusOn(fid, { animate: true, depth: settings.depth });
      }
    }

    function onSettingsInput(e) {
      var inp = e.target.closest ? e.target.closest('input[data-set]') : null;
      if (!inp) return;
      var key = inp.getAttribute('data-set');
      var next = {};
      for (var k in settings) if (Object.prototype.hasOwnProperty.call(settings, k)) next[k] = settings[k];
      next[key] = +inp.value;
      next = sanitizeSettings(next);
      if (next[key] === settings[key]) return;
      settings = next;
      paintSettingValue(key);
      applySettings(key);
    }
    function onSettingsChange(e) {
      if (e.target.closest && e.target.closest('input[data-set]')) saveSettings(storage, settings);
    }
    function onSettingsReset() {
      settings = defaultSettings();
      paintSettings();
      applySettings(null);
      saveSettings(storage, settings);
    }

    function setSettingsOpen(open, refocus) {
      settingsEl.hidden = !open;
      settingsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      root.dataset.settings = open ? 'open' : 'closed';
      if (!open && refocus) settingsToggle.focus();
    }
    function onSettingsToggle() { setSettingsOpen(settingsEl.hidden, false); }
    // Escape a panelben: a panel csukódik (a fókusz a gombra kerül), és NEM
    // zoomol ki a térkép — egy Escape egy lépést von vissza.
    function onSettingsKeydown(e) {
      if (e.key === 'Escape' && !settingsEl.hidden) {
        e.stopPropagation();
        setSettingsOpen(false, true);
      }
    }

    paintSettings();
    settingsEl.addEventListener('input', onSettingsInput);
    settingsEl.addEventListener('change', onSettingsChange);
    settingsReset.addEventListener('click', onSettingsReset);
    settingsToggle.addEventListener('click', onSettingsToggle);
    settingsEl.addEventListener('keydown', onSettingsKeydown);
    settingsToggle.addEventListener('keydown', onSettingsKeydown);

    newBtn.addEventListener('click', function () { if (cb.onNew) cb.onNew(); });

    // Esc a térképen = kizoomolás (a térkép nem lehet billentyűzet-csapda)
    function onRootKey(e) {
      if (e.key === 'Escape' && machine.state === 'focused') backToOverview();
    }
    root.addEventListener('keydown', onRootKey);

    // ---------------- méret ----------------
    function resizeAll() { field.resize(); if (map) map.resize(); }
    var ro = null;
    if (global.ResizeObserver) {
      ro = new ResizeObserver(resizeAll);
      ro.observe(mapEl);
    } else {
      global.addEventListener('resize', resizeAll);
    }
    // a kezdő méret néha layout előtt mérődik → deferred újramérés (setTimeout,
    // mert az rejtett fülön is lefut, ellentétben a rAF-fal)
    var resizeTimers = [setTimeout(resizeAll, 0), setTimeout(resizeAll, 220)];

    // ---------------- indítás ----------------
    function boot() {
      if (!model || !map) { machine.send('DATA_ERR'); return; }
      if (map.start) map.start();
      recompute({ silent: true });
      paintFacetButtons();
      renderCategoryPanel();      // most már van modell → a színjelek is bekerülnek
      renderLegend();
      paintCategoryFilter();
      announceCount(list.count, '');
      // a belépő koreográfia végén READY → overview
      var delay = reduced ? 0 : 120;
      setTimeout(function () { if (!destroyed) machine.send('READY'); }, delay);
    }
    boot();

    // ---------------- publikus ----------------
    function refresh(nextData) {
      if (nextData) data = nextData;
      if (!model) return;
      try {
        model = global.createGraphModel(buildRaw(), { tier: 0 });
      } catch (e) { machine.send('DATA_ERR'); return; }
      fillStatusSelect();
      renderCategoryPanel();
      renderLegend();
      statusSel.value = store.state.filters.status || '';
      paintFacetButtons();
      paintCategoryFilter();
      recompute({ silent: true });
    }

    function refreshColors() {
      field.refreshColors();
      if (map && map.refreshColors) map.refreshColors();
    }

    function destroy() {
      destroyed = true;
      clearTimeout(searchTimer);
      for (var i = 0; i < resizeTimers.length; i++) clearTimeout(resizeTimers[i]);
      unsubscribe();
      if (ro) ro.disconnect(); else global.removeEventListener('resize', resizeAll);
      input.removeEventListener('input', onInput);
      facetsWrap.removeEventListener('click', onFacetClick);
      statusSel.removeEventListener('change', onStatusChange);
      listOnlyBtn.removeEventListener('click', toggleListOnly);
      root.removeEventListener('keydown', onRootKey);
      catControl.removeEventListener('click', onCatControlClick);
      catControl.removeEventListener('keydown', onCatControlKeydown);
      catTagsEl.removeEventListener('click', onCatTagsClick);
      catPanel.removeEventListener('change', onCatPanelChange);
      catFilterEl.removeEventListener('keydown', onCatFilterKeydown);
      catPanel.removeEventListener('keydown', onCatFilterKeydown);
      document.removeEventListener('click', onDocClickForCatFilter);
      settingsEl.removeEventListener('input', onSettingsInput);
      settingsEl.removeEventListener('change', onSettingsChange);
      settingsReset.removeEventListener('click', onSettingsReset);
      settingsToggle.removeEventListener('click', onSettingsToggle);
      settingsEl.removeEventListener('keydown', onSettingsKeydown);
      settingsToggle.removeEventListener('keydown', onSettingsKeydown);
      global.removeEventListener('resize', positionCategoryPanel);   // ha épp nyitva volt
      global.removeEventListener('scroll', positionCategoryPanel, true);
      // a portálozott panel a body-ban van — a root eltávolítása nem vinné magával
      if (catPanel.parentNode) catPanel.parentNode.removeChild(catPanel);
      if (list) list.destroy();
      if (map && map.destroy) map.destroy();
      if (field) field.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    }

    return {
      destroy: destroy,
      refresh: refresh,
      refreshColors: refreshColors,
      focusSearch: function () { input.focus(); },
      get machine() { return machine; },
      get store() { return store; }
    };
  }

  // beállítás-tároló (tiszta függvények) — a tesztek ezen át ellenőrzik a
  // localStorage nélküli és hibás tartalmú esetet is
  mountAtlas.settingsStore = {
    KEY: SETTINGS_KEY, load: loadSettings, save: saveSettings,
    sanitize: sanitizeSettings, defaults: defaultSettings, forcesOf: forcesOf
  };
  global.mountAtlas = mountAtlas;
})(window);
