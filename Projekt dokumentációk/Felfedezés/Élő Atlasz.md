---
tags:
  - taltos/egyseg
allapot: prototípusban
mvp: 8
---

# Élő Atlasz

## Cél

A kezdőoldal ne egy lista, hanem élő tudástérkép legyen: tájékozódás és felfedezés a térképen, gyors megtalálás a mellette lévő listában.

## Működés a prototípusban

`Prototypes/tudasbazis-prototype/home/`: `forceSim.js` (élő erőszimuláció), `graphModel.js` (gráf), `atlasRenderer.js` (Canvas), `selectionStore.js` (egyetlen kiválasztás), `atlasMachine.js` (állapotgép), `resultsList.js` (lista), `atlasView.js`. Spec: `Prototypes/taltos-home-handoff.md`, elemzés: `Prototypes/atlasz-obsidian-graf-elemzes.md`.
- Egyetlen csomóponttípus: a dokumentum. Egységes méret; a színt a kategória adja. *(Felülírva: V28, lásd lent.)*
- A térkép és a lista egy store-ból szinkronizál (hover és kiválasztás kétirányú).
- A szűrés **kiemel, nem töröl**: a kiszűrt csomópont üres, halvány, nem kattintható karika marad (7. kör).
- A lista az akadálymentes elsődleges nézet. 900 px alatt a lista a fő nézet. ≤150 csomópontos sapka *(prototípus; az éles alkalmazásban 300 csomópont fölött címkefürtbe vonás, D44)*.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D28 (élő erőszimulációs elrendezés, Obsidian-szerű interakció), D37 (színezés a színtérből), D39 (explicit élek), D44 (csak a saját színterek, fürtözés), D51e (az Atlasz az élő metaadatot mutatja állapotjelzővel). ~~D19~~ — felülírta a D34.

## Nyitott kérdések

- **Zárt színterek (D44):** az Atlasz csak a felhasználó színtereinek dokumentumait mutatja; alapból az aktuális színtér Jóváhagyott dokumentumait, a további saját színterek facetként bekapcsolhatók. Idegen színtérbe mutató él nem jelenik meg.
- ~~Egy Atlasz színterenként vagy közös?~~ **Döntve ([[Versenytárs-elemzés]] V25):** egy közös térkép színtér-szűrővel; az aktuális színtér kiemelve, a többi halvány. A színtér nem befolyásolja a helyet (D28 elve marad).
- ~~Mi adja a színt?~~ **Döntve ([[Versenytárs-elemzés]] V28):** a csomópont színe a **színtér** színe. Minden színtérnek van alapszíne (`spaces.color`), amelyet minden felhasználó saját magának átszínezhet (privát beállítás, mint a [[Felfedezés/Kedvencek|Kedvencek]]: `user_space_colors`, nem naplózott). **Nincs színátmenet:** egy dokumentum pontosan egy színtérhez tartozik, így egy szín elég; a 6. körös többkategóriás színátmenet megszűnik. A címkék és a fajta (`kind`) szűrőként kiemelnek.
- ~~Színválasztó?~~ **Döntve (V31):** szabad színválasztó kontraszt-figyelmeztetéssel: ha a választott szín világos vagy sötét módban nem éri el a szükséges kontrasztot a háttérrel, a felület figyelmeztet, de engedi a mentést. Az alapszínek (`spaces.color`) a Design System palettájából jönnek.
- ~~Sok színtér?~~ **Döntve (V32):** az alapszínek ismétlődhetnek (körbefordulnak); a megkülönböztetést a színtér-kiemelés (V25) és az egyéni átszínezés (V28) segíti.
- ~~Kontrasztküszöb?~~ **Döntve (V52):** WCAG 1.4.11, 3:1 a világos és a sötét háttérrel szemben is.
- Archivált célra mutató kapcsolat éle nem jelenik meg az Atlaszon (V51).
- ~~Explicit kapcsolatok rugóként?~~ **Döntve (D39, V39):** igen, egységes erővel; a közös címke halvány él marad.
- ~~Kurálás nagy korpusznál?~~ **Döntve (D44):** 300 csomópont fölött a kevés kapcsolatú csomópontok címkefürtbe vonódnak, kattintásra kinyílnak; a pilotban mérendő.

## Kapcsolódó egységek

[[Felfedezés/Keresés|Keresés]] · [[Felfedezés/Szűrők|Szűrők]] · [[Dokumentumok/Kapcsolatok|Kapcsolatok]] · [[Branding]]
