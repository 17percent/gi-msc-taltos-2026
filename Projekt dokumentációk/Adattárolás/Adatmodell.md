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

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D1 (Postgres-only), D4, D34 (~~D19~~), D51 (séma-pontosítások), 4. fejezet (adatmodell-vázlat). Részletes DDL: [[Tervezés/Tervezés (hetedik kör)/tudasbazis-db-sema-b4|DB-séma B4 (10. verzió)]].

*Az alábbi táblázat a v10 (B4 + D51) szerinti táblakört foglalja össze; a pontos oszlopok a B4-ben vannak.*

| Tábla                                                | Szerep                                                                                                                                      | Mentendő? |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `documents`                                          | stabil UUID, `space_id`, cím, slug, `kind`, tulajdonos, `is_template`, élő tartalom, `search_vector`, `review_state` (gyorsítótár), `approved_revision_id`, `iteration`, `review_due_at`, `deleted_at` (~~státusz~~ megszűnt, D45) | igen      |
| `document_revisions`                                 | teljes szövegű pillanatkép, szerző, `contributors`, metaadat-pillanatkép, `restored_from_revision_id`; append-only                          | igen      |
| `tags`, `document_tags`, `document_kinds`            | globális címkék, a dokumentum–címke párosítás (fizikailag törölhető, D51j), fajta-lista (~~`categories`, `document_categories`~~, D34)       | igen      |
| `spaces`, `space_members`, `user_space_colors`       | színterek, tagság és szerep, egyéni Atlasz-szín                                                                                             | igen      |
| `space_requests`, `membership_requests`              | projekt-tér kérése, felvételi kérés                                                                                                         | igen      |
| `change_requests`, `change_request_reviewers`        | review-kérés (`kind`: create, update, metadata, restore, delete, unarchive), `proposed_review_due_at`, a két review-er döntése, cseréje, kiesése | igen      |
| `document_links`                                     | típusos kapcsolatok                                                                                                                         | igen      |
| `favorites`, `subscriptions`                         | privát kedvencek, követés (fizikailag törölhetők, D51j)                                                                                     | igen      |
| `events`                                             | append-only eseménynapló (JSONB details); a hivatkozásai FK nélküliek (D51h); a rendszeresemények aktor nélküliek (D51d)                    | igen      |
| `comments`, `notifications`                          | kommentek (soft delete), értesítések                                                                                                        | igen      |
| `sessions`                                           | munkamenet-tár: `id`, `user_id`, `created_at`, `last_seen_at`, `expires_at` (D51a)                                                           | igen (a mentés része, de nem kritikus) |
| `document_collab_state`                              | a Yjs-állapot, futásidejű; a `documents.content`-ből újraépíthető                                                                           | nem       |
| `allowlist`, `users`                                 | belépési jog, OIDC-identitások                                                                                                              | igen      |
| ~~`locks`~~                                          | megszűnt (D29); csak a prototípusban él                                                                                                     | —         |

## Nyitott kérdések

- ~~Színterek, kapcsolatok, értesítések táblái?~~ **Döntve (v9 és v10, 4. fejezet):** `spaces`, `space_members`, `documents.space_id`, `document_links`, `notifications`, `subscriptions`.
- **10. verzió:** `users.system_role`; `space_members.role ∈ {author, space_manager}`; `space_requests`, `membership_requests` (D43, D44); `change_requests`, `change_request_reviewers`, `documents.approved_revision_id` (D45); második ütemben `blobs`, `revision_files`, `blob_derivatives` (D42).
- **D51:** `sessions` tábla (a); review-er „megszűnt” jelölése (b); `change_requests.proposed_review_due_at` és az `unarchive` kérésfajta (f, g); nullable `events.actor_id` csak rendszer-eseménytípusnál (d); FK nélküli `events`-hivatkozások (h); a privát kapcsoló- és párosítótáblák fizikai törlése (j). Új események: `reviewer_removed`, `edit_started`, `unarchived`, `review_stalled`, `space_updated`, `kind_created`, `draft_discarded`.
- ❓ **Nyitott (NY11–NY19 a naplóban):** a kapcsolat-típus tárolása a szövegben, az @említés formája, a jogi visszatartás (legal hold) tárolása, a Yjs-generáció.
- ~~B4 frissítése~~ **Kész:** [[Tervezés/Tervezés (hetedik kör)/tudasbazis-db-sema-b4|DB-séma B4 (10. verzió)]].

## Kapcsolódó egységek

[[Adattárolás/Revíziók tárolása|Revíziók tárolása]] · [[Adattárolás/Keresőindex|Keresőindex]] · [[Adattárolás/Tranzakciós mentés|Tranzakciós mentés]] · [[Üzemeltetés/Backup|Backup]]
