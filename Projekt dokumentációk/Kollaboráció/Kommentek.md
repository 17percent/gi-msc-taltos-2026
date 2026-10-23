---
tags:
  - taltos/egyseg
allapot: prototípusban
mvp: 9
---

# Kommentek

## Cél

Minden tudásanyag mellett legyen beszélgetés, és a rendszeresemények ugyanabban a folyamban látszódjanak.

## Működés a prototípusban

A „Kommentek és események” fül egyesített feed: kommentek és rendszerüzenetek időrendben, rendezésváltóval. Komment szerkesztése és törlése csak a szerzőnek; szerkesztve jelölés, a törölt komment helyén placeholder.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D20 (szerkesztés nyomot hagy: `comment_edited` a régi tartalommal JSONB-ben; törlés soft delete: `comment_deleted`), D6 (rendszerüzenetek az `events`-ből vetítve).

## Nyitott kérdések

- ~~Kell-e @említés?~~ **Döntve ([[Versenytárs-elemzés]] V16):** igen, értesítéssel. `@` gépelésére az allowlistes felhasználók listája jelenik meg; tárolás `@[név](user:uuid)` formában (átnevezésbiztos). Az említett alkalmazáson belüli és e-mail-értesítést kap ([[Nyomonkövetés/Értesítések|Értesítések]]). Az említések mentéskor kinyerve, ugyanabban a tranzakcióban.
- ~~Válaszszálak?~~ **Döntve (V17):** marad a lapos, időrendi folyam; válaszolni idézéssel vagy @említéssel lehet.
- **Döntve (V18):** nincs „Megoldott” lezárás, minden komment nyitott marad.
- ~~Sorhoz/szakaszhoz kötés?~~ **Döntve (V19):** második ütem, a [[Kollaboráció/Valós idejű közös szerkesztés|közös szerkesztés]] (Yjs `RelativePosition`) után.
- ~~Értesítés szerkesztéskor?~~ **Döntve (V20):** komment szerkesztésekor a szerkesztett változatban szereplő **minden** említett újra értesítést kap (a `comment_edited` esemény is értesítési forrás).
- ~~Kit lehet említeni?~~ **Döntve (V21):** bárkit az allowlistről.
- ~~Elég-e a státusz-workflow a review-hoz?~~ **Döntve (V22):** a `review → draft` elutasításhoz kötelező indoklás tartozik, amely kiemelt rendszerüzenetként jelenik meg a folyamban ([[Dokumentumok/Státusz-workflow|Státusz-workflow]]).
- ~~Zajvédelem V20 mellett?~~ **Döntve (V22a):** ugyanarról a kommentről egy említett 10 percen belül legfeljebb egy értesítést kap; az értesítés a legfrissebb változatra mutat.

## Kapcsolódó egységek

[[Nyomonkövetés/Eseménynapló|Eseménynapló]] · [[Nyomonkövetés/Értesítések|Értesítések]] · [[Dokumentumok/Státusz-workflow|Státusz-workflow]]
