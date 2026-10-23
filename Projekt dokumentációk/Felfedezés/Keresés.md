---
tags:
  - taltos/egyseg
allapot: prototípusban
mvp: 7
---

# Keresés

## Cél

Bármilyen tudásanyag gyorsan megtalálható legyen magyar nyelvű, ragozástűrő keresővel.

## Működés a prototípusban

A keresés címben és tartalomban talál, kiemelt snippettel; a térképen a nem-találatok halványulnak (de kattinthatók maradnak). Az állapotgép `searching` / `empty` állapota kezeli az üres találatot.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D4. Index: [[Adattárolás/Keresőindex|Keresőindex]].

## Nyitott kérdések

- **Zárt színterek (2026-10-23):** a találati lista csak azoknak a színtereknek a dokumentumait tartalmazza, amelyeknek a felhasználó tagja. Lásd [[Felhasználók/Szerepkörök|Szerepkörök]].
- ~~Rangsorolás~~ **Döntve ([[Versenytárs-elemzés]] V14):** szöveges relevancia (`ts_rank` + trigram) + frissesség (utolsó revízió vagy `review_confirmed` ideje, enyhe időbeli lecsengéssel). A státusz és a felülvizsgálandó állapot nem módosítja a rangsort, arra a felhasználó szűr.
- ~~Keresés a kommentekben is?~~ **Döntve (V15):** nem, csak cím + tartalom; a `search_vector` változatlan.
- A frissesség súlya és a lecsengés felezési ideje (pl. 180 nap): mérés a pilotban.
- ~~Mi kerül a keresővektorba?~~ **Döntve (D49):** a címkék és a fajta kis súllyal; a szerzőnév nem (arra facet van).
- **Duplikátum-figyelmeztetés (D49):** csak cím alapján, a saját színtereken belül.

## Kapcsolódó egységek

[[Adattárolás/Keresőindex|Keresőindex]] · [[Felfedezés/Élő Atlasz|Élő Atlasz]] · [[Felfedezés/Szűrők|Szűrők]]
