---
tags:
  - taltos/egyseg
allapot: prototípusban
mvp: 7
---

# Keresőindex

## Cél

A teljes szövegű keresés indexe mindig szinkronban legyen a tartalommal, külön újraindexelés nélkül.

## Működés a prototípusban

A prototípus a valódi index helyett részszöveg-keresést (substring) használ címben és tartalomban, találati kiemeléssel.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D4: a `search_vector` generált `tsvector` oszlop (magyar konfiguráció) + `pg_trgm` a ragozás-tűréshez, GIN-indexszel. A reindex / konzisztencia-őr MVP-pont emiatt megszűnt (13 → 12 pont).

## Nyitott kérdések

- ~~Szemantikus keresés?~~ **Döntve (D49):** jövőbeli munka; a pilot méri, elég-e a `pg_trgm`.
- ~~Kategória- és szerzőnév a keresővektorban?~~ **Döntve (D49):** a címkék és a fajta kis súllyal igen, a szerzőnév nem.
- **Zárt színterek (D44):** a lekérdezés a tagságra szűr. **Többformátum (D42, második ütem):** a vektor a `search_text`-re is kiterjed.

## Kapcsolódó egységek

[[Felfedezés/Keresés|Keresés]] · [[Adattárolás/Adatmodell|Adatmodell]]
