---
tags:
  - taltos/egyseg
allapot: kiváltva
kivaltja: "[[Kollaboráció/Valós idejű közös szerkesztés|Valós idejű közös szerkesztés]]"
mvp: "csak prototípus"
---

# Zárolás

> [!note] Kiváltva
> Az éles alkalmazásban a lock + heartbeat megoldás megszűnik, helyét a [[Kollaboráció/Valós idejű közös szerkesztés|valós idejű közös szerkesztés]] veszi át (D7 felülírása: D29). Ez a jegyzet a prototípus működését dokumentálja.

## Cél

Egy dokumentumot egyszerre csak egy ember szerkesszen, ütközés és elveszett munka nélkül.

## Működés a prototípusban

Szerkesztőbe lépéskor zárolás jön létre (🔒 badge, heartbeat 30 mp-enként). Más felhasználóként a szerkesztés tiltott, toast jelzi, ki szerkeszti. 2 perc heartbeat-kimaradás után lejár (`lock_expired` esemény).

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D7 (pesszimista lock + heartbeat; lejárat 2–5 perc; piszkozat a kliensen), D26 (mellette optimista `baseRevisionId`-ellenőrzés, 412). Második ütem: zárolás átvétele.

## Nyitott kérdések

- ~~Zárolás átvétele?~~ **Tárgytalan (D29):** a zárolást a közös szerkesztés váltja ki; csak a prototípusban marad.

## Kapcsolódó egységek

[[Szerkesztés/Markdown szerkesztő|Markdown szerkesztő]] · [[Adattárolás/Tranzakciós mentés|Tranzakciós mentés]]
