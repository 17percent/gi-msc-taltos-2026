---
tags:
  - taltos/egyseg
allapot: döntve
mvp: 20
---

# Feladat-dashboard

> [!success] Döntve — D46 (Döntési napló v10, 2026-10-23)
> A prototípusban még nincs megvalósítva.

## Cél

Mindenki egy helyen lássa a teendőit: belépés után azonnal kiderüljön, mi vár rá. A review-folyamat ([[Dokumentumok/Státusz-workflow|Státusz-workflow]]) ezen a felületen indul.

## Működés

**Belépés után ez a főoldal.** Az [[Felfedezés/Élő Atlasz|Élő Atlasz]] egy kattintással elérhető.

| Blokk | Kinek | Tartalom |
|---|---|---|
| **Rám váró review-k** | minden tag | a kérések, ahol review-erként megjelöltek; a dokumentum, az indítványozó, a változás fajtája, a kérés kora |
| **Függő indítványaim** | minden tag | a saját Review-ra váró kéréseim, a review-erek döntési állapotával; a review-er cseréje innen is elérhető |
| **Átdolgozandó** | minden tag | a saját elutasított anyagaim, az indoklással |
| **Esedékes felülvizsgálatok** | tulajdonos, közreműködők | a D33 szerinti esedékes dokumentumok; ha közben valaki kommentben hibát jelzett, az kiemelve |
| **Említések** | minden tag | a friss @említések |
| **Felvételi kérések** | Színtérgazda | az idegen linkről érkező „Felvétel kérése” kérések (D44): elfogadás szerep megadásával, vagy elutasítás |
| **Színtér-kérések** | Rendszeradminisztrátor | a projekt-tér kérések (D43): jóváhagyás a kezdeti Színtérgazda kijelölésével, vagy elutasítás |

- **Forrás:** az értesítési réteg ([[Nyomonkövetés/Értesítések|Értesítések]], D35); minden blokk egy szűrt nézet ugyanarra az adatra.
- **Frissítés:** élőben, a WebSocket értesítési csatornán (D46).
- **E-mail:** a review-kérés azonnali levél; minden emlékeztető (függő review, felülvizsgálat) a napi összefoglalóban.
- **Láthatóság:** csak a felhasználó színtereinek tételei látszanak (D44).

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D46 (dashboard, csatornák), D45 (review), D43 (kérések), D44 (felvétel kérése), D33 (felülvizsgálat), D35 (értesítések). MVP 20. pont: nem eshet ki.

## Nyitott kérdések

- ~~Rendezés?~~ **Döntve (D49):** időrend, színtér-szűrővel.
- ~~Elakadt review?~~ **Döntve (D49):** 3 munkanap után kiemelés és napi összefoglaló.

## Kapcsolódó egységek

[[Nyomonkövetés/Értesítések|Értesítések]] · [[Dokumentumok/Státusz-workflow|Státusz-workflow]] · [[Felhasználók/Szerepkörök|Szerepkörök]] · [[Dokumentumok/Felülvizsgálat|Felülvizsgálat]]
