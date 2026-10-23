---
tags:
  - taltos/egyseg
allapot: nincs UI
---

# Munkamenet és CSRF

## Cél

Biztonságos böngészős munkamenet tokenkezelés nélkül a kliensen.

## Működés a prototípusban

Nem UI-elem, a prototípusban nincs megfelelője.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D26: httpOnly cookie-session, CSRF-token minden módosító kérésen, Bearer-token flow nincs. Hibák RFC 9457 Problem Details formátumban, stabil `code` mezővel.

## Nyitott kérdések

- ~~Munkamenet-élettartam?~~ **Döntve (NY10, D49):** abszolút lejárat 8 óra, tétlenségi kiléptetés 60 perc; a nyitott közös szerkesztés aktívnak számít.

## Kapcsolódó egységek

[[Felhasználók/Bejelentkezés|Bejelentkezés]] · [[Felhasználók/Allowlist|Allowlist]]
