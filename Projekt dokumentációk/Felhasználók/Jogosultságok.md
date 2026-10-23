---
tags:
  - taltos/egyseg
allapot: döntve
mvp: 2
---

# Jogosultságok

> [!success] Döntve — D43, D44, D45 (Döntési napló v10)
> Az érvényes szerepkör-katalógus és jogosultsági mátrix a [[Felhasználók/Szerepkörök|Szerepkörök]] jegyzetben van, a review-folyamat a [[Dokumentumok/Státusz-workflow|Státusz-workflow]] jegyzetben. Ez a jegyzet csak az alapelveket foglalja össze. A prototípusban még nincs megvalósítva.

> [!warning] Felülírva — a D31 szerepkörei (Olvasó, Szerző, Jóváhagyó, Színtérgazda)
> ~~Olvasó · Szerző · Jóváhagyó · Színtérgazda; „minden belépett felhasználó minden színtérben legalább Olvasó”~~ → **D43, D44, D45:** színtéren belül két szerep van (Színtérgazda, Szerző), a színterek zártak, a jóváhagyás nem szerephez, hanem a változásonként megjelölt két review-erhez kötött. A D6 „mindenki mindent” elvét a D31 (írás) és a D44 (olvasás) írta felül.

## Cél

Ki mit láthat és tehet.

## Működés a prototípusban

A prototípusban nincs szerepkör. Egyetlen jogosultsági szabály van: kommentet csak a szerzője szerkeszthet vagy törölhet (D20). A fejléc felhasználóváltója kétfelhasználós esetek kipróbálására szolgál.

## Alapelvek (v10)

- **A jogosultság egysége a [[Kollaboráció/Színterek|színtér]]** (D30). Globálisan csak a Rendszeradminisztrátor létezik; tartalmi joga csak színtér-tagként van (D43).
- **Zárt színterek (D44):** aki nem tag, a színtér tartalmát nem látja (lista, keresés, Atlasz, kapcsolatok, értesítések, export, MCP).
- **Négy szem elve, két review-errel (D45):** saját változtatást senki nem hagyhat jóvá.
- **Kötelező gazda (D31, V12):** minden dokumentumnak pontosan egy tulajdonosa van a színtér tagjai közül (Szerző vagy Színtérgazda); tulajdonosváltás csak másik szerkesztőre (`owner_changed`). A tulajdonos felelősséget jelent, jogot nem (D43). A tulajdonos-átadás végpontja és hogy review-köteles-e: ❓ nyitott (NY11–NY19 a naplóban).
- **A komment-szabály (D20) változatlan:** szerkesztés és törlés csak a szerzőnek.
- **Kivétel a színtér-írási határ alól (V50, D39):** a dokumentum tulajdonosa a rá mutató `helyettesíti` kapcsolatot más színtér dokumentumában is törölheti (rendszer-revízió a forráson). Más írási kivétel nincs.
- **Ellenőrzés:** egyetlen backendoldali `can(user, action, resource)` policy-függvény (REST-middleware és Hocuspocus `onAuthenticate`); a felület csak elrejti a nem elérhető gombokat.
- **Adatmodell:** `space_members (space_id, user_id, role)`, `role ∈ {author, space_manager}`; `users.system_role` (korábban `users.is_admin`).

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D43, D44, D45 (érvényes); D6, D31, D32 (felülírva); D20.

## Nyitott kérdések

- ~~Admin globális, vagy színterenként is lehet?~~ **Döntve (D43):** globális, Rendszeradminisztrátor néven.
- ~~Entra ID csoportokból tagság?~~ **Döntve (D43):** jövőbeli munka.
- ~~Szerepkörváltás auditálása?~~ **Döntve (D43):** igen, `member_added`, `member_removed`, `role_changed`, `system_admin_granted/revoked`.
- Nincs nyitott kérdés ebben a jegyzetben; az érvényes modell: [[Felhasználók/Szerepkörök|Szerepkörök]].

## Kapcsolódó egységek

[[Felhasználók/Szerepkörök|Szerepkörök]] · [[Kollaboráció/Színterek|Színterek]] · [[Dokumentumok/Státusz-workflow|Státusz-workflow]] · [[Felhasználók/Allowlist|Allowlist]] · [[Transzparencia/Auditnapló|Auditnapló]]
