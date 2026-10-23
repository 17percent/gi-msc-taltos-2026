---
tags:
  - taltos/egyseg
allapot: elvetve
---

# Vészhelyzeti tükör

> [!failure] Elvetve — NY5 (Döntési napló v10, 2026-10-23)
> A backup (D48) elég; az elveszett vészhelyzeti olvashatóság vállalt korlát marad.

## Cél

Szerverleállás esetén is olvasható maradjon a tudás. Ezt a képességet a Git-alapú tárolás elhagyása vitte el.

## Működés a prototípusban

Nincs a prototípusban.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — **NY5**: ütemezett, egyirányú `.md`-exportáló job (pl. naponta) egy mountolt volume-ra; nem verziózott, csak olvasható tükör. 6. fejezet: elveszett képesség, vállalt korlát.

## Nyitott kérdések

- Nincs nyitott kérdés (elvetve).

## Kapcsolódó egységek

[[Üzemeltetés/Backup|Backup]] · [[Kimenet/Vágólap és letöltés|Vágólap és letöltés]]
