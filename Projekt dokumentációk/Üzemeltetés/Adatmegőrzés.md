---
tags:
  - taltos/egyseg
allapot: döntve
---

# Adatmegőrzés

## Cél

A soft delete-tel törölt adatok végleges törlése szabályozott, időzített és GDPR-konform legyen.

## Működés a prototípusban

Nincs a prototípusban.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D20 (minden törlés soft delete; fizikai törlés csak retention policy szerint), D22 (cron-alapú megoldás elegendő), **NY4** (nyitott), 6. fejezet (a revíziók szerzője pszeudonimizálható).

## Nyitott kérdések

- ~~Retenciós idők?~~ **Döntve (D48):** dokumentum és Jóváhagyott revízió: nincs automatikus törlés; archívum: 2 év; törölt komment: 90 nap; értesítés: 90 nap; elutasított vagy visszavont kérés piszkozat-revíziói és hivatkozás nélküli blobok: 1 év; eseménynapló: 5 év.
- ~~Kilépő munkavállaló?~~ **Döntve (D48):** a neve a retenciós ideig marad (jogos érdek), utána „Volt munkatárs #id”; a tulajdonjogot kilépéskor kötelező átadni.
- ~~Ki hagyja jóvá a végleges törlést?~~ **Döntve (D48):** automatikus cron-folyamat; a Rendszeradminisztrátor előtte heti listát kap, és visszatarthat (legal hold).

## Kapcsolódó egységek

[[Dokumentumok/Archívum|Archívum]] · [[Transzparencia/Auditnapló|Auditnapló]] · [[Üzemeltetés/Backup|Backup]]
