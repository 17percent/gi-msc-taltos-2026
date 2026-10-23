---
tags:
  - taltos/egyseg
allapot: prototípusban
mvp: 19
---

# Export

## Cél

Formázott `.pdf`/`.docx` kimenet megosztáshoz, nyomtatáshoz.

## Működés a prototípusban

Csak mock gomb: toast jelzi, hogy szerveroldali pandoc futna (WP14).

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D21 (szerveroldali pandoc-pipeline), 5. fejezet: hátrasorolt csomag, határidő-nyomásnál elsőként esik ki.

## Nyitott kérdések

- ~~Arculatos `.docx`-sablon?~~ **Döntve (D49):** igen, Táltos-arculatú `reference.docx` ([[Branding]]).
- **Review (D45):** az export a legutóbbi Jóváhagyott revízióból készül. **Többformátum (D42):** nem markdown formátumnál az eredeti fájl töltődik le.

## Kapcsolódó egységek

[[Kimenet/Vágólap és letöltés|Vágólap és letöltés]]
