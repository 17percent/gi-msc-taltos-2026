---
tags:
  - taltos/egyseg
allapot: prototípusban
mvp: 9
---

# Auditnapló

## Cél

Rendszerszintű, szűrhető áttekintés arról, ki mit csinált, dokumentumtól függetlenül, ellenőrzési és elszámoltathatósági célra.

## Működés a prototípusban

Audit nézet (`#/audit`): az összes esemény egy táblázatban. Az eseménynapló adataiból táplálkozik.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D6 („technikailag nyitott, szervezetileg szabályozott”; az audit a védvonal), 6. fejezet (az audit hitelességének gyökere a backend; a szerző kriptográfiai kötés nélküli metaadat; GDPR: a kilépő munkavállaló neve is megmarad, jogalap: jogos érdek).

## Nyitott kérdések

- ~~Ki láthatja az auditnaplót?~~ **Döntve (D43):** a dokumentum eseményeit a színtér tagjai; a színtér-szintű nézetet a Színtérgazda; a rendszerszintű naplót a Rendszeradminisztrátor.
- ~~Exportálható legyen (CSV)?~~ **Döntve:** igen; a Színtérgazda a saját színteréről, a Rendszeradminisztrátor rendszerszinten.
- ~~Pszeudonimizálás retenció után?~~ **Döntve (D48):** az eseménynapló 5 évig marad; a kilépő munkavállaló neve a retenciós idő után „Volt munkatárs #id”.

## Kapcsolódó egységek

[[Nyomonkövetés/Eseménynapló|Eseménynapló]] · [[Felhasználók/Jogosultságok|Jogosultságok]] · [[Üzemeltetés/Adatmegőrzés|Adatmegőrzés]]
