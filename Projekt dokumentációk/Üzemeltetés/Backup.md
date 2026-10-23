---
tags:
  - taltos/egyseg
allapot: nincs UI
mvp: 12
---

# Backup

## Cél

Adatvesztés esetén a rendszer visszaállítható legyen.

## Működés a prototípusban

Nem UI-elem, a prototípusban nincs.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D4 (ütemezett `pg_dump` az egyetlen backup-mechanizmus), D18 (a `favorites` is mentendő), D10 (hosting), D48 (megőrzés), D51a (a `sessions` tábla része a dumpnak, de elvesztése csak kijelentkeztet; a `document_collab_state` a `documents.content`-ből újraépíthető).

## Nyitott kérdések

- ~~Gyakoriság, megőrzés, teszt?~~ **Döntve (D48):** napi `pg_dump`, 30 napos és 12 havi megőrzés, havi visszaállítási próba.
- ~~Hol tárolódik?~~ **Döntve (D48):** külön gépen vagy tárolón, titkosítva. A véglegesen törölt adat a mentésekből a megőrzési idő lejártával tűnik el.

## Kapcsolódó egységek

[[Adattárolás/Adatmodell|Adatmodell]] · ~~[[Üzemeltetés/Vészhelyzeti tükör|Vészhelyzeti tükör]]~~ (elvetve, NY5) · [[Üzemeltetés/Adatmegőrzés|Adatmegőrzés]]
