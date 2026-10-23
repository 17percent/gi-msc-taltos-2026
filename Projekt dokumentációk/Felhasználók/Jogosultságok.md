---
tags:
  - taltos/egyseg
allapot: döntve
mvp: 2
---

# Jogosultságok

> [!success] Döntve — D31, D32
> Rögzítve a [[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]]-ben. A prototípusban még nincs megvalósítva; a jegyzet nyitott kérdései továbbra is nyitottak.

> [!warning] Felülírva — D43, D44, D45 (Döntési napló v10)
> A lenti szerep-táblázat (Olvasó, Szerző, Jóváhagyó, Színtérgazda) és a „minden belépett felhasználó legalább Olvasó” elv **már nem érvényes**. Az új modellben a színtéren belül két szerep van, Színtérgazda és Szerző; a színterek zártak; minden tartalmi változáshoz két megjelölt review-er jóváhagyása kell. Az érvényes katalógus és mátrix: [[Felhasználók/Szerepkörök|Szerepkörök]]; a review-folyamat: [[Dokumentumok/Státusz-workflow|Státusz-workflow]].

## Cél

Ki mit láthat és tehet. A D6 („mindenki mindent”) felülíródott: szerepkör-alapú hozzáférés és jóváhagyási lépés lesz.

## Működés a prototípusban

A prototípusban nincs szerepkör. Egyetlen jogosultsági szabály van: kommentet csak a szerzője szerkeszthet vagy törölhet (D20). A fejléc felhasználóváltója kétfelhasználós esetek kipróbálására szolgál.

## Javaslat

**A jogosultság egysége a [[Kollaboráció/Színterek|színtér]].** A felhasználó minden színtérben kap egy szerepet. Globálisan csak a Rendszeradminisztrátor létezik (korábban: Admin). Részletes mátrix: [[Felhasználók/Szerepkörök|Szerepkörök]].

| Szerep | Olvas | Kommentel | Létrehoz / szerkeszt | Jóváhagy (`review → publikált`) | Tagság, archívum |
|---|---|---|---|---|---|
| Olvasó | ✓ | ✓ | | | |
| Szerző | ✓ | ✓ | ✓ | | |
| Jóváhagyó | ✓ | ✓ | ✓ | ✓ | |
| Színtérgazda | ✓ | ✓ | ✓ | ✓ | ✓ |
| Rendszeradminisztrátor (globális) | allowlist, színterek, Színtérgazdák kinevezése, fajta-lista; **tartalmi jog csak színtér-tagként** (2026-10-23, felülírja a korábbi „minden színtérben Színtérgazda” szabályt) | | | | |

- **Minden belépett felhasználó minden színtérben legalább Olvasó (döntve):** az olvasás mindig nyitott, a D6 olvasási elve megmarad. A szerepkör csak az írást, a jóváhagyást és a tagságkezelést szabályozza.
- Saját dokumentumot nem lehet saját magának jóváhagyni (négy szem elve).
- **Kötelező gazda ([[Versenytárs-elemzés]] V12):** minden dokumentumnak pontosan egy tulajdonosa van, aki a színtér szerkesztői közül (Szerző vagy magasabb szerep) kerül ki. Tulajdonos nélküli dokumentum nem létezhet. Tulajdonosváltás csak másik szerkesztőre lehetséges (`owner_changed` esemény); szerep-visszaminősítés Olvasóvá tiltott, amíg a felhasználó a színtérben tulajdonos.
- A komment-szabály (D20) változatlan: szerkesztés és törlés csak a szerzőnek.
- **Kivétel a színtér-írási határ alól (V50, D39):** egy dokumentum tulajdonosa a rá mutató `helyettesíti` kapcsolatot más színtér dokumentumában is törölheti; ez rendszer által írt revízió a forráson, eseménnyel és értesítéssel. Más írási kivétel nincs.
- Ellenőrzés a backendben, middleware-ben, a színtér és a szerep alapján. A felület csak elrejti a nem elérhető gombokat.
- Adatmodell: `space_members (space_id, user_id, role)` + `users.system_role` (korábban `users.is_admin`).

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D6 (eredetileg: nincs jogosultságkezelés; a README szerint felülírva), D20. A D6 felülírása még nincs a naplóban, új D-pontként rögzítendő.

## Nyitott kérdések

- ~~Admin globális, vagy színterenként is lehet?~~ **Döntve (D43):** globális, Rendszeradminisztrátor néven; színterenként a Színtérgazda kezeli a tagságot.
- ~~Entra ID csoportokból tagság?~~ **Döntve (D43):** jövőbeli munka.
- ~~Szerepkörváltás auditálása?~~ **Döntve (D43):** igen, `member_added`, `member_removed`, `role_changed`, `system_admin_granted/revoked`.
- Nincs nyitott kérdés; az érvényes modell: [[Felhasználók/Szerepkörök|Szerepkörök]].

## Kapcsolódó egységek

[[Felhasználók/Szerepkörök|Szerepkörök]] · [[Kollaboráció/Színterek|Színterek]] · [[Dokumentumok/Státusz-workflow|Státusz-workflow]] · [[Felhasználók/Allowlist|Allowlist]] · [[Transzparencia/Auditnapló|Auditnapló]]
