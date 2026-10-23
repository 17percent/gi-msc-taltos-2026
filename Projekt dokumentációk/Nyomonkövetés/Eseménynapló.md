---
tags:
  - taltos/egyseg
allapot: prototípusban
mvp: 9
---

# Eseménynapló

## Cél

Minden módosító művelet nyomot hagyjon, visszakereshetően és módosíthatatlanul.

## Működés a prototípusban

Események a seedben és a műveletekből: `created`, `edited`, `status_changed`, `deleted`, `restored`, `duplicated_from`, `comment_edited`, `comment_deleted`, `lock_expired`, kategória-műveletek. A dokumentum feedjében rendszerüzenetként jelennek meg.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D6 (átláthatóság mint kompenzáció), D20, 4. fejezet (`events`). Az `events` tábla append-only, UPDATE/DELETE triggerrel tiltva. Új eseménytípus TS-union bővítés, nem DB-migráció.

**Vállalt korlát:** az olvasás nincs naplózva. A kedvencek sem naplózottak (D18).

## Nyitott kérdések

- ~~Eseménytípus-katalógus bővítése?~~ **Döntve (v10, 4. fejezet):** színterek és szerepek (`space_*`, `member_*`, `role_changed`, `system_admin_*`, `space_requested`, `membership_requested`), review (`review_requested`, `review_approved`, `review_rejected`, `review_withdrawn`, `reviewer_replaced`, `change_approved`, `change_rejected`), import (`imported_from`).
- ~~Az értesítések forrása?~~ **Döntve (D35, D46):** igen, ugyanabban a tranzakcióban.
- **Megőrzés (D48):** 5 év.

## Kapcsolódó egységek

[[Transzparencia/Auditnapló|Auditnapló]] · [[Kollaboráció/Kommentek|Kommentek]] · [[Nyomonkövetés/Értesítések|Értesítések]]
