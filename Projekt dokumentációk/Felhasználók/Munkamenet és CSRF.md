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

## Munkamenet-tár (D51a)

Postgres `sessions` tábla: `id`, `user_id`, `created_at`, `last_seen_at`, `expires_at`. A `last_seen_at` írása ritkítva (legfeljebb percenként egyszer), a WebSocket-forgalom is frissíti. A tár újraindítást túlél; a kijelentkezés és az allowlistről levétel azonnal visszavonja a munkamenetet. Nincs új infrastruktúra (D1).

## Nyitott kérdések

- ~~Munkamenet-élettartam?~~ **Döntve (NY10, D49):** abszolút lejárat 8 óra, tétlenségi kiléptetés 60 perc; a nyitott közös szerkesztés aktívnak számít.
- ~~Hol él a munkamenet-állapot?~~ **Döntve (D51a):** a `sessions` táblában.

## Kapcsolódó egységek

[[Felhasználók/Bejelentkezés|Bejelentkezés]] · [[Felhasználók/Allowlist|Allowlist]]
