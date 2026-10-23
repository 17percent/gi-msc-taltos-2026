---
tags:
  - taltos/egyseg
allapot: döntve
mvp: "10, 17"
---

# Értesítések

> [!success] Döntve — D35, D46
> Rögzítve a [[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]]-ben (D35 értesítések, D46 dashboard és csatornák). A prototípusban még nincs megvalósítva.

## Cél

A felhasználó tudjon róla, ha egy őt érintő dolog történik (jóváhagyásra vár, kommentet kapott, változott egy követett dokumentum), anélkül hogy keresnie kellene.

## Működés a prototípusban

A prototípusban nincs értesítés. Csak toast-üzenetek vannak a saját műveletekről.

## Javaslat

Az értesítés az **eseménynaplóból származik**, nem külön írási útvonal: egy esemény mentésekor (ugyanabban a tranzakcióban) a címzetteknek `notifications` sor keletkezik.

| Kiváltó esemény | Címzett |
|---|---|
| Review-ra küldés (`review_requested`) | a két megjelölt review-er (~~a színtér Jóváhagyói~~, D45) |
| review-er döntése, végeredmény (`change_approved` / `change_rejected`) | az indítványozó (~~a tulajdonos~~, D45) |
| review-er kiesése (`reviewer_removed`), elakadt review (`review_stalled`, 3 munkanap) | az indítványozó, ill. az elakadt review-er (napi összefoglalóban) |
| új komment / @említés (V16, döntve) | tulajdonos, követők / az említett |
| követett dokumentum szerkesztése | követők |
| tagság vagy szerepkör változása | az érintett felhasználó |
| `helyettesíti` kapcsolat egy dokumentumra (D39, V36) | a cél tulajdonosa |
| felülvizsgálat esedékes ([[Dokumentumok/Felülvizsgálat\|Felülvizsgálat]]) | tulajdonos + az utolsó Jóváhagyott revízió közreműködői |

- **Követés:** a kedvenc ≠ követés (a kedvenc privát könyvjelző, D18). Külön „Követem” kapcsoló, `subscriptions` tábla. A tulajdonos automatikusan követő.
- **Felület:** harang ikon a fejlécben olvasatlan számlálóval; értesítéslista; „mind olvasott”.
- **MVP (döntve, D46): alkalmazáson belüli értesítés (WebSocket, ~~polling~~) + e-mail.** Az e-mail egy ütemezett (cron) napi összefoglaló, amely a még el nem küldött értesítéseket és emlékeztetőket gyűjti össze; a review-kérés azonnali levél. A cron által írt események aktor nélküliek („Rendszer”, D51d).
- ❓ **Beállítások (nincs D-pontja):** a felhasználónkénti e-mail ki-/bekapcsolás, gyakoriság és leiratkozó link csak a H5 WP18-ban és ebben a jegyzetben szerepelt; nem döntött (D21; NY11–NY19 a naplóban).

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D35 (értesítések, @említés, követés), D46 (WebSocket, napi összefoglaló, dashboard), D49 (3 munkanapos elakadás), D51d (rendszeresemények). Az `events` (D6, D20) a forrás.

## Nyitott kérdések

- ~~E-mail-küldés módja?~~ **Döntve (D46):** SMTP-absztrakció (Nodemailer); fejlesztésben Mailpit, élesben céges SMTP-relay; Graph-adapter jövőbeli munka.
- ~~Az e-mail naplópontja és helye?~~ **Döntve (D35, D46):** MVP 17. pont; a review-kérés azonnali levél, minden emlékeztető napi összefoglaló.
- ~~Mi kerülhet a levél törzsébe?~~ **Döntve (D46):** eseménytípus, cím, színtér, kezdeményező, link; tartalom nem.
- ~~Valós idejű vagy polling?~~ **Döntve (D46):** WebSocket-csatorna a `/collab` mellett.
- ~~Megőrzés?~~ **Döntve (D48):** 90 nap.
- **Zárt színterek (D44):** @említeni csak a színtér tagjait lehet; értesítés csak látható dokumentumról megy. A felület: [[Nyomonkövetés/Feladat-dashboard|Feladat-dashboard]].
- ❓ **Nyitott (NY11–NY19 a naplóban):** az @említés tárolási formája (név a szövegben vs csak azonosító); a `helyettesíti` célja tulajdonosának értesítése, ha nem tagja a forrás színterének; a tulajdonos automatikus követésének módja.

## Kapcsolódó egységek

[[Nyomonkövetés/Eseménynapló|Eseménynapló]] · [[Dokumentumok/Státusz-workflow|Státusz-workflow]] · [[Kollaboráció/Kommentek|Kommentek]] · [[Kollaboráció/Színterek|Színterek]]
