---
tags:
  - taltos/egyseg
allapot: prototípusban
mvp: 4
---

# Tranzakciós mentés

## Cél

Egy mentés vagy teljesen sikerül, vagy egyáltalán nem. Nem maradhat olyan állapot, ahol a tartalom elmentődött, de a revízió vagy az esemény nem.

## Működés a prototípusban

A prototípus mentése egy lépésben új revíziót és `edited` eseményt hoz létre (memóriában).

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D1, D2 (minden írás a backend API-n át), D22 (worker queue elhagyva), D26 (`PUT …/content` kötelezően `baseRevisionId`-vel; eltérésnél 412).

Egy mentés = egy ACID-tranzakció: új `document_revisions` sor + `documents` frissítés (a `search_vector` generált oszlop magától frissül) + `events` sor.

## Nyitott kérdések

- ~~B5 átnevezés~~ **Kész:** [[Tervezés/Tervezés (hetedik kör)/tudasbazis-api-kontraktus-b5|API-kontraktus B5 (10. verzió)]] — a `baseRevisionId` a review-ra küldésen él (A4); a tartalom a `/collab` WebSocketen perzisztálódik (A3). A review-döntés tranzakciója: B4 S7, S13.

## Kapcsolódó egységek

[[Szerkesztés/Zárolás|Zárolás]] · [[Adattárolás/Revíziók tárolása|Revíziók tárolása]] · [[Nyomonkövetés/Eseménynapló|Eseménynapló]]
