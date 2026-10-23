---
tags:
  - taltos/egyseg
allapot: döntve
mvp: 15
---

# Felülvizsgálat

> [!success] Döntve — D33
> A [[Versenytárs-elemzés]] V2–V4, V8–V11 döntéseiből; rögzítve a [[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]]-ben.

## Cél

A publikált tudásanyag ne avuljon el észrevétlenül, ami a Confluence legnagyobb gyengesége. Minden publikált dokumentumnak legyen esedékességi dátuma, és erről a felelősök időben értesüljenek.

## Működés a prototípusban

Nincs ilyen. Az elavulást ma csak a javasolt `helyettesíti` [[Dokumentumok/Kapcsolatok|kapcsolat]] jelezné.

## Javaslat

- **Esedékesség (döntve: a szerző adja meg, kötelezően):** publikáláskor a szerző dátumot vagy intervallumot választ (pl. 3 / 6 / 12 hónap). A mező kötelező, alapértéke 12 hónap; üresen nem hagyható, „soha nem avul el” opció nincs (V8). Mező: `documents.review_due_at NOT NULL` publikált státusznál.
- **Címzettek (döntve: tulajdonos + közreműködők):** a tulajdonos és az utolsó publikált revízió `contributors` listája. Címzett nélküli dokumentum nem fordulhat elő, mert a tulajdonos kötelező, és nem törölhető átadás nélkül (V12, [[Felhasználók/Allowlist|Allowlist]]).
- **Csatorna (döntve):** alkalmazáson belüli értesítés + e-mail, a meglévő [[Nyomonkövetés/Értesítések|Értesítések]] javaslat szerint.
- **Időzítés (döntve, V9):** első értesítés 7 nappal az esedékesség előtt, második az esedékesség napján.
- **Ha senki nem reagál (döntve, V10):** hetente emlékeztető a tulajdonosnak és a közreműködőknek, a „Felülvizsgálandó” jelvény megmarad. Nincs eszkaláció a Jóváhagyókhoz és nincs automatikus visszaminősítés.
- **Jelzés:** lejárat után „Felülvizsgálandó” jelvény a listában, a dokumentumnézetben és az Atlaszon; facetként is szűrhető.
- **Lezárás két módon:**
  1. „Még aktuális”: új esedékesség, új revízió nélkül, `review_confirmed` esemény. Bárki megteheti, akinek [[Felhasználók/Jogosultságok|Szerző]] joga van a színtérben; jóváhagyás nem kell, mert a tartalom nem változik (döntve, V11).
  2. Módosítás: a dokumentum `draft`-ba esik (V6, [[Dokumentumok/Státusz-workflow|Státusz-workflow]]), újrapublikáláskor a szerző új esedékességet ad meg.
- **Események:** `review_due_set`, `review_due_soon` (7 nappal előtte), `review_due` (esedékességkor), `review_reminder` (hetente), `review_confirmed`.
- **Ütemezés:** ugyanaz a cron-job, mint az e-mail-összefoglalóé; naponta egyszer jelöli meg a lejárt dokumentumokat.

## Kapcsolódó döntések

[[Versenytárs-elemzés]] — V2, V3, V4, V6, V8–V11.

## Nyitott kérdések

- ~~Emlékeztető összevonása?~~ **Döntve (D46):** minden emlékeztető a napi e-mail-összefoglalóba kerül.
- ~~Komment mint reakció?~~ **Döntve (D49):** nem zárja le az esedékességet; a komment a tulajdonos [[Nyomonkövetés/Feladat-dashboard|dashboardján]] kiemelve jelenik meg. Lezárás: „Még aktuális” (bármely színtér-tag, review nélkül) vagy Jóváhagyott módosítás (D45).

## Kapcsolódó egységek

[[Dokumentumok/Státusz-workflow|Státusz-workflow]] · [[Nyomonkövetés/Értesítések|Értesítések]] · [[Dokumentumok/Kapcsolatok|Kapcsolatok]] · [[Felfedezés/Szűrők|Szűrők]]
