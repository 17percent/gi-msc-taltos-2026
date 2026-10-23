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

Archiválás indoklással (`deleted` esemény). Archívum nézet (`#/archive`): lista és visszaállítás. *(Az éles alkalmazásban az események: `archived`, `unarchived`.)*

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D8 (archívum + felületi visszaállítás, karbantartása kijelölt személy felelőssége), D20 (minden törlés soft delete), D45 (archiválás review-val), D48 (2 év), D51g (`unarchive`), D51i (eldobott piszkozat).

## Nyitott kérdések

- ~~Ki archiválhat és ki állíthat vissza?~~ **Döntve (D45):** bármely színtér-tag indítványozhatja, és két review-er jóváhagyásával válik véglegessé. Az archívumból visszaállítás is változás, ugyanígy review-val.
- **Visszahozás az archívumból (D51g):** külön `unarchive` kérés két review-errel (nincs javasolt revíziója; jóváhagyáskor `deleted_at = NULL`, a legutóbbi Jóváhagyott revízió marad érvényes; esemény: `unarchived`). ~~Az archívumból visszaállítás `restore` kérés~~ — a `restore` ettől kezdve csak régi revízióra visszaállítást jelent.
- **Eldobott piszkozat (D45, D51i):** a soha be nem küldött, review nélkül eldobott piszkozat nem archivált dokumentum; az archívum-listában nem szerepel, a revízióival együtt 1 év után törlődik (`draft_discarded`).
- ~~Meddig marad archívumban?~~ **Döntve (D48):** 2 év után véglegesen törlődik (automatikusan, legal hold lehetőséggel).

## Kapcsolódó egységek

[[Üzemeltetés/Adatmegőrzés|Adatmegőrzés]] · [[Nyomonkövetés/Eseménynapló|Eseménynapló]]
