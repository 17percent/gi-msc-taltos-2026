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

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D20 (minden törlés soft delete; fizikai törlés csak retention policy szerint), D22 (cron-alapú megoldás elegendő), **D48** (retenciós idők; NY4 lezárva), **D51h–j** (kiegészítések), 6. fejezet (a revíziók szerzője pszeudonimizálható).

## Nyitott kérdések

- ~~Retenciós idők?~~ **Döntve (D48):** dokumentum és Jóváhagyott revízió: nincs automatikus törlés; archívum: 2 év; törölt komment: 90 nap; értesítés: 90 nap; elutasított vagy visszavont kérés piszkozat-revíziói és hivatkozás nélküli blobok: 1 év; eseménynapló: 5 év.
- **Kiegészítések (D51):**
  - **(h)** az `events` dokumentum-, színtér- és kérés-hivatkozása FK nélküli uuid, így az eseménynapló a dokumentum végleges törlése után is megmarad (5 év); a törölt dokumentumra mutató esemény „törölt dokumentum”-ként jelenik meg. A lezárt kérés javasolt revíziója törölhető.
  - **(i)** a köztes checkpoint-revízió (se nem Jóváhagyott, se nem függő kérés javaslata) 1 évvel azután törlődik, hogy egy újabb Jóváhagyott revízió meghaladta; a soha be nem küldött, eldobott piszkozat a revízióival együtt 1 évvel az eldobás után. A Jóváhagyott és a függő kérés revíziói soha nem törlődnek automatikusan.
  - **(j)** a privát kapcsoló- és párosítótáblák (`favorites`, `subscriptions`, `user_space_colors`, `document_tags`) sorai fizikailag törölhetők (D20 kivétele); az alkalmazás DB-szerepe csak ezekre kap DELETE-jogot.
- ❓ **Nyitott (NY11–NY19 a naplóban):** a pszeudonimizálás „retenciós ideje” (mennyi a kilépés után); a jogi visszatartás (legal hold) tárolása és köre; az `allowlist` e-mail-sorainak sorsa a pszeudonimizáláskor.
- ~~Kilépő munkavállaló?~~ **Döntve (D48):** a neve a retenciós ideig marad (jogos érdek), utána „Volt munkatárs #id”; a tulajdonjogot kilépéskor kötelező átadni.
- ~~Ki hagyja jóvá a végleges törlést?~~ **Döntve (D48):** automatikus cron-folyamat; a Rendszeradminisztrátor előtte heti listát kap, és visszatarthat (legal hold).

## Kapcsolódó egységek

[[Dokumentumok/Archívum|Archívum]] · [[Transzparencia/Auditnapló|Auditnapló]] · [[Üzemeltetés/Backup|Backup]]
