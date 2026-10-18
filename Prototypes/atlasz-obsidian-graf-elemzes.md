# Élő Atlasz × Obsidian gráfnézet — elemzés és terv

> Állapot: **jóváhagyva** (2026-10-18). Döntések: D-1 = (b) tiszta Obsidian-erők, nincs Kategória-vonzás; D-2 = (a) egységes méret; D-3 = (a) helyben, halványítással. Naplópont: **D28**.
> Forrás: az Obsidian 1.14.4 helyi bundle-jének statikus elemzése (`obsidian.asar` → `sim.js`, `app.js`), plus a hivatalos súgó (obsidian.md/help/plugins/graph). A futásidejű viselkedést nem figyeltük meg.
> Tiszta szoba: Obsidian-kódot nem másolunk. Az alábbiak saját szavas leírások és képletek. A fizika a d3-force (MIT) nyilvánosan dokumentált modelljét követi, ezért a megvalósítás a d3-force dokumentációjából is levezethető.

---

## 1. Hogyan működik az Obsidian gráfnézete

### 1.1 Architektúra
- **Fizika:** külön Web Worker (`sim.js`). Ez d3-force-egyenértékű szimuláció kézzel írt WebAssemblyben: a taszításhoz Barnes–Hut közelítést használ (rács-piramis, θ = 0,9). Ha a WASM nem indul, egy d3-stílusú JS fallback fut helyette.
- **Ütem:** a worker 60 Hz-en tickel (setTimeout), és minden tick után egy Float32 x,y tömböt küld vissza.
- **Rajzolás:** PIXI v7 (WebGL). A kirajzolás a kapott pozíciókat interpoláció nélkül másolja át. A húzott csomópontot a renderer helyben felülírja.
- **Leállás:** ha a „hőmérséklet” (α) 0,001 alá esik, a szimuláció leáll, és a gráf mozdulatlan (nincs remegés). 60 tétlen képkocka után a rajzoló ciklus is leáll.

### 1.2 Szimuláció (tickenként: α-frissítés → erők → csillapítás + integrálás)

| Elem | Érték |
|---|---|
| α kezdő | 1 |
| α-bomlás tickenként | 1 − 0,001^(1/300) ≈ 0,0228 (≈300 tick ≈ 5 s alatt hűl ki) |
| α-frissítés | α += (αTarget − α) · bomlás |
| Felmelegítés | α = max(α, 0,3): új adatnál, erő-csúszka változásakor és húzáskor |
| Sebesség | v ← 0,6 · v, majd x ← x + v |
| Rögzített csomópont | integrálás után x = fx, v = 0 |

| Erő | Képlet (saját jelöléssel) | Csúszka → paraméter | Alap |
|---|---|---|---|
| **Középre húzás** | v −= α · p · pos (az origó felé; forceX/forceY-típus) | s ∈ [0,1] → p = (0,01^(1−s) − 0,01) / 0,99 | p = 0,1 (s ≈ 0,52) |
| **Taszítás** | Δv = α · P / d, a másik csomóponttól el (1/d törvény, nem 1/d²) | s ∈ [0,20] → P = s³ (min. 1) | s = 10 → P = 1000 |
| **Kapcsolat (rugó)** | l = (d − L)/d · α · k; a két vég az ellenkező fokszám arányában mozdul (a nagyobb fokszámú kevésbé); k = Ls / min(fok_a, fok_b) | Ls: mint a középre húzás; L: 30–500, közvetlenül | Ls = 1, L = 250 |
| **Ütközés** | ha d < 120: mindkét csomópont 0,25·(120−d)/d arányban taszítódik szét, α nélkül | nincs a felületen | sugár 60, erősség 0,5 |

- A kezdő pozíció új csomópontnál: a már elhelyezett szomszédok átlaga kis szórással. Szomszéd híján a meglévő elrendezésen kívüli gyűrűbe kerül.

### 1.3 Húzás
- Ha a mutató 5 px-en belül marad, a mozdulat kattintás. 5 px fölött a mozdulat húzás: a csomópont fx/fy-t kap a mutató világ-pozíciójára, és a szimuláció melegen marad (α = αTarget = 0,3), amíg tartod.
- Elengedéskor az fx/fy és az αTarget törlődik, és a gráf kb. 4 s alatt megnyugszik.
- A szomszédok csak a rugó és a taszítás révén követik a húzott csomópontot, külön logika nincs.
- Húzás közben a húzott csomópont számít kiemeltnek.

### 1.4 Hover-kiemelés
- Kiemelt a hoverelt (vagy húzott) csomópont és a közvetlen szomszédai. **Minden más 0,2 alfára halványul.**
- Az áttérés képkockánként exponenciális: új = 0,9·régi + 0,1·cél (≈0,5 s alatt 95 %). Ez képkocka-függő, nálunk időalapúra kell átírni.
- A kiemelt csomóponthoz befutó élek teljes alfát és kiemelő színt kapnak, a többi él 0,2 alfát.
- A kiemelt csomópont címkéje minden zoomon teljes alfával látszik, kicsit lejjebb csúszik, és nem kisebbedik.

### 1.5 Címkék
- **Halványítás:** címkealfa = clamp(log₂(zoom) + 1 − T, 0, 1), ahol T a „Text fade threshold” (−3…3, alap 0).
  - T = 0-nál a címkék 0,5× zoom alatt nem látszanak, 1× fölött teljesen.
  - Általánosan a halványítás 2^(T−1) és 2^T zoom között fut.
- A címke mérete a képernyőn √zoom-mal nő, nem lineárisan. A betűméret: 14 + R/4 px.
- A viewporton kívüli címkét nem rajzolja (vágás).

### 1.6 Méret és vonal
- Sugár: R = méret-szorzó · clamp(3·√(fok+1), 8, 30). Képernyőn ≈ R·√zoom.
- A vonalvastagság képernyőn állandó (szorzó · 1/zoom világ-egységben). A nyilak opcionálisak, 0,3× zoom alatt eltűnnek.

### 1.7 Helyi gráf
- Mélység D = 1–5 (alap 1): körönkénti BFS a kiválasztott jegyzettől. Kapcsolók: bejövő, kimenő, szomszédok közti linkek (utóbbi alapból ki).
- A gyűrű súlya 30 − 30·(p+1)/D, a középső csomópont a legnagyobb.
- Saját szimulációval fut, ugyanazokkal az erő-beállításokkal. A kiválasztott jegyzet nincs rögzítve, a középre húzás tartja középen.

### 1.8 Kamera
- Zoom 1/128…8. Görgetés: ×1,5 per „notch”, simítva (0,85/0,15 képkockánként).
- Zoom a kurzorhoz csak befelé. A pásztázás tehetetlenséggel fut tovább.
- **Fit-to-view nincs**, csak középre igazítás.

### 1.9 Beállítás-séma (`graph.json`)
`centerStrength`, `repelStrength`, `linkStrength`, `linkDistance` (csúszka-pozíciók, nem belső értékek) · `textFadeMultiplier`, `nodeSizeMultiplier`, `lineSizeMultiplier`, `showArrow` · `localJumps`, `localBacklinks`, `localForelinks`, `localInterlinks` · szűrők (`search`, `showTags`, `showAttachments`, `hideUnresolved`, `showOrphans`) · `colorGroups` · `scale`.

---

## 2. Mi van ma az Atlaszban, és mi ütközik

| Terület | Ma (`home/`) | Obsidian-szerű cél | Ütközés |
|---|---|---|---|
| Elrendezés | `graphModel.js`: kategória-klaszterek, koncentrikus gyűrűk, zárt formula. Nincs szimuláció. | Élő erő-szimuláció | **Igen.** A handoff §9 „klaszterezett, nem force-directed hairball” elrendezést ír elő. A modul fejkommentje szerint egy korábbi erő-szimulációt **éppen azért vettünk ki**, mert 50+ dokumentumnál egy kategória tagjai szétszóródtak. |
| Átfedés | Konstrukció szerint nincs. A renderer a rajzolt sugarat a legszűkebb pár távolságához köti (`capScreenR`, `computeMinGap`). | Lágy ütközés-erő; húzás közben átmeneti átfedés lehet | Igen. A „soha nincs átfedés” garancia „nyugalomban nincs átfedés” garanciára gyengül. |
| Méret | Egységes (`NODE_R = 10`), szándékosan | Fokszám szerinti | Döntési kérdés (D-2) |
| Hover | A befutó élek `--accent`-re váltanak | Plusz minden nem-szomszéd 0,2 alfára halványul, időalapú áttéréssel | Nincs |
| Címkék | Budget + ütközés-vágás, `zoomRatio`-ból smoothstep | log₂-zoom küszöb (T), √zoom méret | Kicsi: a budget/ütközés-vágás marad, az alfa jön az új képletből |
| Fókusz | `getNeighborhood` ≤ 32, a többi dimmelve, fit-to-bounds | BFS-mélység D | Döntési kérdés (D-3) |
| Kamera | Fit-to-bounds + tween, `camTouched` | Nincs fit-to-view | **A miénk marad** (jobb). Kurzor-zoom/tehetetlenség nem cél. |
| Mozgás | `prefers-reduced-motion` tisztelve | — | Reduced motionnél a szimuláció szinkron, animáció nélkül fut végig |
| Méretkorlát | ≤ 150 csomópont, ~56 a seedben | — | N ≤ 150-nél az O(n²) taszítás bőven elég: **nem kell Barnes–Hut és worker** |

---

## 3. Javasolt megvalósítás (L-tier, feature-flow)

**Modulok (vanília JS, könyvtár nélkül, classic script + global):**

1. **`home/forceSim.js` (új)** — `createForceSim({ nodes, edges, params })`: d3-force-egyenértékű szimuláció a 1.2 táblázat képleteivel és konstansaival.
   - API: `tick(n)`, `reheat(a)`, `pin(id,x,y)` / `unpin(id)`, `setParams(p)`, `alpha()`, `positions` (Float32Array).
   - O(n²) taszítás, fix 60 Hz-es lépés akkumulátorral (képkocka-független).
   - **Determinisztikus:** phyllotaxis kezdőelrendezés (a d3 alapértelmezése) és hash-alapú „jitter”, nincs `Math.random`. Újratöltés után ugyanaz az elrendezés.
2. **`graphModel.js`** — a gyűrű/klaszter-elrendezés kikerül. A modell a topológiát (élek, fokszám), a facet-eket és a keresést adja, plus a kezdő x,y-t. Új: `getNeighborhood(id, { depth })` BFS-mélységgel.
3. **`atlasRenderer.js`**
   - A szimulációt a renderer birtokolja (a pozíció nézet-állapot), és a meglévő rAF-ciklusa hajtja. Ha α < 0,001, és a kamera is nyugszik, a ciklus leáll, mint ma.
   - Új interakció: csomópont-húzás (5 px küszöb, alatta kattintás). A háttér húzása marad pásztázás.
   - Hover-halványítás időalapú easinggel: k = 1 − 0,9^(dt/16,7).
   - A címkealfa a log₂-képletből jön; a budget és az ütközés-vágás marad.
   - A `capScreenR`/`computeMinGap` garancia helyét a modell sugara és az ütközés-erő veszi át.
4. **`atlasView.js` + `home.css`** — „Megjelenítés és erők” panel a térkép HUD-jában (összecsukható, Táltos DS tokenekkel, magyar feliratokkal).
   - Csúszkák: Középre húzás, Taszítás, Kapcsolatok ereje, Kapcsolat hossza, Címkék megjelenése, Fókusz mélysége.
   - „Alapértékek visszaállítása” gomb.
   - A beállítás localStorage-ban marad meg (try/catch-csel, felhasználónkénti kényelmi állapot).
5. **Tesztek (új, `tudasbazis-prototype/tests/`)** — Node + jsdom harness a valódi modulokon (mert a rejtett Browser pane-ben a rAF nem fut, a rAF-sort a harness kézzel pumpálja):
   - a szimuláció konvergál (α < 0,001 véges lépésben);
   - determinisztikus (két futás bitre azonos);
   - nyugalomban nincs átfedés;
   - a húzott csomópont rögzített marad;
   - a BFS-mélység helyes;
   - a csúszka→paraméter leképezés pontos (s ≈ 0,52 → p ≈ 0,1; s = 10 → P = 1000).

**Kapuk:** a tesztek zöldek, és a böngészős ellenőrzés világos és sötét témában, 375 px-en és reduced motionnel is lefut. **Reviewek:** 1. kör `code-reviewer`, 2. kör `qa-automation` (L-tier). Implementáló: `frontend-web`.

---

## 4. Nyitott döntések (a tulajdonosé)

- **D-1 · Mi tartsa egyben a kategóriákat?** A korábbi erő-szimuláció itt bukott el.
  - (a) **Pluszerő, Kategória-vonzás (ajánlott):** gyenge forceX/Y-típusú húzás a dokumentum kategóriáinak súlypontja felé. Csúszkán állítható, 0-nál tiszta Obsidian.
  - (b) Tiszta Obsidian-erők. A klaszterezettség ilyenkor csak az élekből jön, és a fokszám-sapka (`MAX_EDGES_PER_NODE = 5`) miatt valószínűleg gyenge lesz.
  - (c) A fokszám-sapka emelése vagy elhagyása, sűrűbb élekkel. Ez sűrűbb „hairballt” is jelent.
- **D-2 · Csomópont-méret:**
  - (a) Marad egységes (ajánlott): a korábbi döntés indoka, hogy a méret ne sugalljon jelentést, továbbra is áll.
  - (b) Obsidian-féle, fokszám szerinti.
  - (c) Kapcsoló a panelen.
- **D-3 · Fókusz = helyi gráf?**
  - (a) Helyben (ajánlott): a kiválasztott dokumentum D mélységű környezete kiemelt, a többi halvány. A „fade, don't remove” elv marad.
  - (b) Külön helyi gráf panel saját szimulációval, az Obsidian mintájára.

---

## 5. ADR-javaslat — D28 (a napló bővítése a tulajdonos jóváhagyásával)

### D28 — Élő Atlasz: élő erő-szimulációs elrendezés, Obsidian-szerű interakcióval *(javaslat)*

**Döntés:**
- Az Atlasz térképének elrendezését élő, d3-force-egyenértékű erő-szimuláció adja. Saját implementáció, könyvtár nélkül, determinisztikus kezdőállapottal.
- A térképen a csomópontok húzhatók; hoverre kiemelődnek a szomszédok; a címkék zoomfüggően jelennek meg; a fókusz mélysége állítható.
- Az erők a felületen, egy beállításpanelen hangolhatók.

**Felülírja:** a `taltos-home-handoff.md` §9 Tier 0 előírását („klaszterezett, nem force-directed”) és a `graphModel.js` zárt formulás klaszter-elrendezését.

**Indok:** a tulajdonos döntése (2026-10-18). Az interaktív, „élő” gráf jobban mutatja a kapcsolati szövetet, és a felhasználó maga rendezheti a térképet.

**Ár és kockázat:**
- A „konstrukció szerint nincs átfedés” garancia „nyugalomban nincs átfedés” garanciára gyengül.
- Egy korábbi erő-szimulációs változat 50+ dokumentumnál klaszter nélküli gubancot adott. A mérséklés a D-1 döntéstől függ.
- A csomópont-húzás egérmozdulat: a térkép minden funkciója húzás nélkül is elérhető marad (WCAG 2.5.7), a húzás csak elrendezés-finomítás.

**Scope (D21):** a prototípusra (`tudasbazis-prototype/home/`) vonatkozik. A React SPA-ba (D23) átvételhez külön naplópont kell.
