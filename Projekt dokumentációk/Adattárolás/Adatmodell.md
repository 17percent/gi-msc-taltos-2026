---
tags:
  - taltos/egyseg
allapot: prototípusban
---

# Adatmodell

## Cél

Egyetlen adatréteg (PostgreSQL) a tartalomnak, a teljes revíziótörténetnek, a keresőindexnek és minden kísérő adatnak. Nincs második igazságforrás, ezért nincs mit szinkronban tartani.

## Működés a prototípusban

A prototípus memóriában tartja az adatot (`Prototypes/tudasbazis-prototype/data.js` + `seedGenerator.js`), újratöltéskor a seedelt minta áll vissza. Az objektumok szerkezete már a tervezett táblákat követi: dokumentum + revíziók, kommentek, események, kedvencek (userId → docId lista), allowlist, kategóriák.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D1 (Postgres-only), D4, D19, 4. fejezet (adatmodell-vázlat). Részletes DDL: [[Tervezés/Tervezés (hetedik kör)/tudasbazis-db-sema-b4|DB-séma B4 (10. verzió)]].

| Tábla                               | Szerep                                                                                                       | Mentendő? |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------- |
| `documents`                         | stabil UUID, cím, slug, státusz, tulajdonos, `is_template`, aktuális tartalom, `search_vector`, `deleted_at` | igen      |
| `document_revisions`                | teljes szövegű pillanatkép mentésenként, szerző, idő, iteráció, `restored_from_revision_id`                  | igen      |
| `categories`, `document_categories` | lapos címkék, több-a-többhöz                                                                                 | igen      |
| `favorites`                         | privát kedvencek                                                                                             | igen      |
| `events`                            | append-only eseménynapló (JSONB details)                                                                     | igen      |
| `comments`                          | kommentek, szerkesztve-jelölés, soft delete                                                                  | igen      |
| `locks`                             | szerkesztési zár + utolsó heartbeat                                                                          | nem       |
| `allowlist`, `users`                | belépési jog, OIDC-identitások                                                                               | igen      |

## Nyitott kérdések

- ~~Színterek, kapcsolatok, értesítések táblái?~~ **Döntve (v9 és v10, 4. fejezet):** `spaces`, `space_members`, `documents.space_id`, `document_links`, `notifications`, `subscriptions`.
- **10. verzió:** `users.system_role`; `space_members.role ∈ {author, space_manager}`; `space_requests`, `membership_requests` (D43, D44); `change_requests`, `change_request_reviewers`, `documents.approved_revision_id` (D45); második ütemben `blobs`, `revision_files`, `blob_derivatives` (D42).
- ~~B4 frissítése~~ **Kész:** [[Tervezés/Tervezés (hetedik kör)/tudasbazis-db-sema-b4|DB-séma B4 (10. verzió)]].

## Kapcsolódó egységek

[[Adattárolás/Revíziók tárolása|Revíziók tárolása]] · [[Adattárolás/Keresőindex|Keresőindex]] · [[Adattárolás/Tranzakciós mentés|Tranzakciós mentés]] · [[Üzemeltetés/Backup|Backup]]
