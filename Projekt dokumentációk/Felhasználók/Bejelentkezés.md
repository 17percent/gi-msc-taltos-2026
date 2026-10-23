---
tags:
  - taltos/egyseg
allapot: prototípusban
mvp: 1
---

# Bejelentkezés

## Cél

Céges identitással lehessen belépni, saját jelszókezelés nélkül, és az azonosítás szolgáltatója cserélhető legyen.

## Működés a prototípusban

Csillagkép-hátteres login (`Prototypes/tudasbazis-prototype/login/`): `constellation.js` (Canvas háttér), `authMachine.js` (állapotgép), `loginView.js`, `login.config.js` (OAuth-placeholderek). Két gomb: Google és Microsoft. Backend nélkül a redirect helyén mock belépés fut. Belépéskor a világfa-jel átrepül a fejlécbe, a csillagkép az Atlasz hátterében folytatódik. Spec: `Prototypes/taltos-login-handoff.md`.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D5 (generikus OIDC réteg; fejlesztés: Google, éles: Microsoft Entra ID). Jövőbeli munka: Entra ID App Registration, csoport-claimek.

## Nyitott kérdések

- ~~Entra ID csoport-claimek → színtér-tagság?~~ **Döntve (D43):** jövőbeli munka.
- ~~H2: OIDC-mock?~~ **Döntve (D49):** nincs mock; fejlesztésben is valódi Google OIDC, a tesztekben session-injektálás.

## Kapcsolódó egységek

[[Felhasználók/Allowlist|Allowlist]] · [[Felhasználók/Munkamenet és CSRF|Munkamenet és CSRF]] · [[Branding]]
