---
tags:
  - taltos/egyseg
allapot: prototípusban
mvp: 7
---

# Szűrők

## Cél

A találati halmaz gyorsan szűkíthető legyen a leggyakoribb szempontok szerint.

## Működés a prototípusban

Facetek: Ma / Enyém / Csapat / Kedvenc / Sablon + státusz + kategória. A kategória többes kiválasztású legördülő (tagek, VAGY-kapcsolat). A szűrők egyszerre hatnak a listára és a térképre. Üres eredménynél „Szűrők törlése” kiút.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D18 (kedvenc), D34 (címke, fajta; ~~D19~~), D44 (színtér-facet), D45 (állapot-facet), D49 (URL-ben élő szűrők).

## Nyitott kérdések

- ~~„Csapat” → színtér-facet?~~ **Döntve (D49):** igen, csak a saját színterekkel.
- ~~Mentett nézetek?~~ **Döntve (D49):** második ütem; addig a szűrők az URL-ben élnek (megoszthatók).
- **Állapot-facet (D45):** Piszkozat · Review-ra vár · Átdolgozandó · Jóváhagyott. A facetek az élő (legutóbbi) metaadatból számolnak, állapotjelzővel (D51e); a Jóváhagyott dokumentum, amelyen épp módosítás folyik, melyik facetben jelenik meg: ❓ nyitott (NY11–NY19 a naplóban).
- ❓ **Címke-facet és láthatóság (NY11–NY19 a naplóban):** a globális címkekészlet (D34) és a zárt színterek (D44) viszonya — a címkék nevei és darabszámai nem szivároghatnak színtereken át; a megoldás nem döntött.

## Kapcsolódó egységek

[[Felfedezés/Keresés|Keresés]] · [[Felfedezés/Kedvencek|Kedvencek]] · [[Dokumentumok/Címkék|Címkék]]
