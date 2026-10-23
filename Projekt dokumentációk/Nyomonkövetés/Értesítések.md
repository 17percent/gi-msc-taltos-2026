---
tags:
  - taltos/egyseg
allapot: döntve
mvp: "10, 17"
---

# Értesítések

> [!success] Döntve — D35
> Rögzítve a [[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]]-ben. A prototípusban még nincs megvalósítva; a jegyzet nyitott kérdései továbbra is nyitottak.

## Cél

A felhasználó tudjon róla, ha egy őt érintő dolog történik (jóváhagyásra vár, kommentet kapott, változott egy követett dokumentum), anélkül hogy keresnie kellene.

## Működés a prototípusban

A prototípusban nincs értesítés. Csak toast-üzenetek vannak a saját műveletekről.

## Javaslat

Az értesítés az **eseménynaplóból származik**, nem külön írási útvonal: egy esemény mentésekor (ugyanabban a tranzakcióban) a címzetteknek `notifications` sor keletkezik.

| Kiváltó esemény | Címzett |
|---|---|
| státusz → `review` | a színtér Jóváhagyói |
| jóváhagyva / elutasítva | a dokumentum tulajdonosa |
| új komment / @említés (V16, döntve) | tulajdonos, követők / az említett |
| követett dokumentum szerkesztése | követők |
| tagság vagy szerepkör változása | az érintett felhasználó |
| `helyettesíti` kapcsolat egy dokumentumra (D39, V36) | a cél tulajdonosa |
| felülvizsgálat esedékes ([[Dokumentumok/Felülvizsgálat\|Felülvizsgálat]]) | tulajdonos + az utolsó publikált revízió közreműködői |

- **Követés:** a kedvenc ≠ követés (a kedvenc privát könyvjelző, D18). Külön „Követem” kapcsoló, `subscriptions` tábla. A tulajdonos automatikusan követő.
- **Felület:** harang ikon a fejlécben olvasatlan számlálóval; értesítéslista; „mind olvasott”.
- **MVP (döntve): alkalmazáson belüli értesítés + e-mail.** Az alkalmazáson belüli lista polling alapú. Az e-mail egy ütemezett (cron) összefoglaló job, amely a még el nem küldött értesítéseket gyűjti össze; a jóváhagyási kérés azonnali e-mailt kaphat.
- **Beállítások:** felhasználónként ki-/bekapcsolható e-mail, gyakoriság (azonnal / napi összefoglaló), leiratkozó link.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — nincs naplópont. Az `events` (D6, D20) természetes forrás.

## Nyitott kérdések

- ~~E-mail-küldés módja?~~ **Döntve (D46):** SMTP-absztrakció (Nodemailer); fejlesztésben Mailpit, élesben céges SMTP-relay; Graph-adapter jövőbeli munka.
- ~~Az e-mail naplópontja és helye?~~ **Döntve (D35, D46):** MVP 17. pont; a review-kérés azonnali levél, minden emlékeztető napi összefoglaló.
- ~~Mi kerülhet a levél törzsébe?~~ **Döntve (D46):** eseménytípus, cím, színtér, kezdeményező, link; tartalom nem.
- ~~Valós idejű vagy polling?~~ **Döntve (D46):** WebSocket-csatorna a `/collab` mellett.
- ~~Megőrzés?~~ **Döntve (D48):** 90 nap.
- **Zárt színterek (D44):** @említeni csak a színtér tagjait lehet; értesítés csak látható dokumentumról megy. A felület: [[Nyomonkövetés/Feladat-dashboard|Feladat-dashboard]].

## Kapcsolódó egységek

[[Nyomonkövetés/Eseménynapló|Eseménynapló]] · [[Dokumentumok/Státusz-workflow|Státusz-workflow]] · [[Kollaboráció/Kommentek|Kommentek]] · [[Kollaboráció/Színterek|Színterek]]
