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
- **D51 kiegészítések:**
  - **Új eseménynevek:** `reviewer_removed` (a review-er kiesett, D51b), `edit_started` („Módosítás indítása”, D51c), `unarchived` (D51g), `review_stalled` (3 munkanapja függő review), `space_updated` (leírás, szín), `kind_created` (fajta-lista bővítése), `draft_discarded` (soha be nem küldött piszkozat eldobása).
  - **Rendszeresemények (D51d):** a cron által írt események (`review_due_soon`, `review_due`, `review_reminder`, `review_stalled`, `retention_purge`, `user_pseudonymized`) aktor nélküliek, az `actor_id` ilyenkor NULL; a felület „Rendszer”-ként mutatja. Emberi eseménynél az `actor_id` kötelező.
  - **Hivatkozások (D51h):** az események dokumentum-, színtér- és kérés-hivatkozása FK nélküli; a törölt dokumentumra mutató esemény „törölt dokumentum”-ként jelenik meg.
- ❓ **Nyitott (NY11–NY19 a naplóban):** a rendszerszintű audit láthatósága és szűrői; az események részletei (`details`) nem tartalmazhatnak nevet vagy e-mailt — a szabály rögzítése.
- ~~Az értesítések forrása?~~ **Döntve (D35, D46):** igen, ugyanabban a tranzakcióban.
- **Megőrzés (D48):** 5 év.

## Kapcsolódó egységek

[[Transzparencia/Auditnapló|Auditnapló]] · [[Kollaboráció/Kommentek|Kommentek]] · [[Nyomonkövetés/Értesítések|Értesítések]]
