---
tags:
  - taltos/egyseg
allapot: prototípusban
mvp: 11
---

# Archívum

## Cél

A törölt dokumentum ne vesszen el: archívumba kerüljön, ahonnan visszaállítható.

## Működés a prototípusban

Archiválás indoklással (`deleted` esemény). Archívum nézet (`#/archive`): lista és visszaállítás.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D8 (archívum + felületi visszaállítás, karbantartása kijelölt személy felelőssége), D20 (minden törlés soft delete).

## Nyitott kérdések

- ~~Ki archiválhat és ki állíthat vissza?~~ **Döntve (D45):** bármely színtér-tag indítványozhatja, és két review-er jóváhagyásával válik véglegessé. Az archívumból visszaállítás is változás, ugyanígy review-val.
- ~~Meddig marad archívumban?~~ **Döntve (D48):** 2 év után véglegesen törlődik (automatikusan, legal hold lehetőséggel).

## Kapcsolódó egységek

[[Üzemeltetés/Adatmegőrzés|Adatmegőrzés]] · [[Nyomonkövetés/Eseménynapló|Eseménynapló]]
