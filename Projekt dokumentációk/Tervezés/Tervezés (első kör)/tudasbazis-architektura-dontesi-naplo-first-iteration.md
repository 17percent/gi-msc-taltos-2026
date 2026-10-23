# Vállalati tudásbázis — architektúra-terv és döntési napló

Egyedi fejlesztésű, webes tudásbázis-rendszer ~200 fős vállalat számára, markdown alapú tartalommal. Szakdolgozati projekt; a fejlesztés saját infrastruktúrán indul, az éles üzem céges környezetben valósul meg.

## 1. Követelmények

- Markdown (.md) formátumú tudásanyagok tárolása
- Teljes szövegű keresés (magyar nyelvi támogatással)
- Kategorizálás (mappastruktúra + metaadatok)
- Státuszkezelés (draft → review → tesztelt → publikált), soft workflow-val
- Tulajdonos és módosító személyek nyilvántartása, teljes auditálhatóság
- Teszteltség / iterációk követése
- Verziókezelés, korábbi állapotok visszaállítása
- Komment szekció tudásanyagonként, rendszereseményekkel (státuszváltás, törlés stb.)
- Hordozható szoftver: új környezetben új adatbázissal és új autentikációval üzembe helyezhető

## 2. Architektúra áttekintés

```
Felhasználó (böngésző)
        │
        ▼
React frontend (markdown szerkesztő, kommentek, keresés)
        │  REST API
        ▼
Backend API  ──────────────► OIDC szolgáltató
   │      │                  (fejlesztés: Google,
   │      │                   éles: Microsoft Entra ID)
   │      ▼
   │   Git repo (GitHub)     ← tartalom source of truth
   │      (deploy key / GitHub App hitelesítés)
   ▼
PostgreSQL                   ← keresőindex, metaadatok,
   (index, események,           események, kommentek,
    kommentek, lockok)          lockok, allowlist
```

**Felelősség-megosztás:**

| Réteg | Feladata |
|---|---|
| Git repo | A tudásanyagok (.md) igazságforrása: tartalom, teljes verziótörténet, diff, visszaállítás |
| PostgreSQL | Eldobható, újraépíthető keresőindex; metaadat-lekérdezések; események/audit; kommentek; szerkesztési lockok; e-mail allowlist |
| Backend API | Minden írás egyetlen kapuja; commit a felhasználó nevében; indexfrissítés; lock-kezelés; eseménynaplózás |
| Frontend | Szerkesztés, böngészés, keresés, kommentfolyam |
| OIDC szolgáltató | Csak autentikáció (jelszó- és identitáskezelés kiszervezve) |

## 3. Döntési napló

### D1 — Tárolás: Git (source of truth) + PostgreSQL index
**Alternatívák:** tisztán PostgreSQL; hálózati meghajtó / Obsidian vault; kész platform (Outline, Wiki.js).
**Döntés indoklása:** a Git ingyen adja a verziótörténetet, a diffet, a visszaállítást és a fájlrendszer-szintű hordozhatóságot (a teljes tudásbázis egy clone-nal menthető). A Postgres a keresés és a metaadat-lekérdezések gyengeségét pótolja.
**Vállalat ára:** két mozgó alkatrész, a varratot (commit ↔ index) kezelni kell (lásd D4).

### D2 — Minden írás kizárólag a webes API-n keresztül
A GitHub-on keresztüli közvetlen módosítás szervezetileg tiltott. Így a lock-mechanizmus, az eseménynaplózás és az indexfrissítés megkerülhetetlen; webhook/polling szinkron külső változásokra nem szükséges.

### D3 — Backend-hitelesítés a repo felé: deploy key vagy GitHub App
Nem személyes PAT: a hozzáférés a rendszerhez tartozik, nem fejlesztő személyéhez. A repo fejlesztés alatt privát, éles bevezetéskor szervezeti GitHub fiókba kerül (transfer, a történet megmarad, csak konfigcsere kell).

### D4 — Konzisztencia-szabály: a Postgres index eldobható
A mentés sorrendje: Git commit → indexfrissítés. Ha az indexelés hibázik, a mentés attól még sikeres; hibakezelés automatikus reindexet indít. Az első naptól létezik `reindex` parancs, amely a repót nulláról végigolvasva felépíti a teljes indexet.

### D5 — Cserélhető autentikáció: generikus OIDC réteg
Fejlesztés alatt Google login, éles üzemben Microsoft Entra ID (céges App Registration). Az alkalmazás OIDC-szabványra épül, a szolgáltató konfigurációs kérdés — ez adja a hordozhatóságot is.
**Beléptetési kapu:** e-mail allowlist (Postgres-ben tárolva; kezdetben seed/konfig, később felületi karbantartás). A Google-login belső hálózatról is működik, csak a redirect URI-t kell regisztrálni.

### D6 — Nincs jogosultságkezelés a rendszerben
Minden belépett (allowlistes) felhasználó minden funkciót elér. Indoklás: a jogosultság-adminisztráció elhagyása egyszerűsíti a rendszert és a közös felelősségvállalást ösztönzi.
**Kompenzáció:** teljes átláthatóság — minden művelet (szerkesztés, státuszváltás, törlés, visszaállítás) eseményként naplózódik és a kommentfolyamban rendszerüzenetként megjelenik. A workflow-fegyelem szervezeti szabály, nem technikai kényszer: „technikailag nyitott, szervezetileg szabályozott."

### D7 — Egyidejű szerkesztés: pesszimista lock + heartbeat
Szerkesztő mód aktiválásakor a backend lockolja a dokumentumot; más felhasználó tájékoztató üzenetet kap. A nyitott szerkesztő 30–60 mp-enként heartbeatet küld; a lock heartbeat nélkül 2–5 perc után automatikusan lejár (lecsukott laptop, bezárt fül eseteit magától kezeli). A kliens piszkozatot őriz, így a lejárat nem jár munkavesztéssel. „Lock átvétele" funkció: második ütem.

### D8 — Törlés: archívum + felületi visszaállítás
Törléskor a dokumentum archív állapotba kerül (nem vész el; a Git-történet is őrzi). Az archívumnak webes listázó/visszaállító felülete van; karbantartása kijelölt személy szervezeti felelőssége.

### D9 — Események és kommentek a Postgres-ben
A kommentek és a rendszeresemények nem a Git-ben élnek: `events` tábla a művelet-történetnek (ki, mit, mikor), ebből épül a dokumentumonkénti rendszerüzenet-folyam és a globális audit-nézet.

### D10 — Hosting: fejlesztés alatt saját szerver, élesben céges infrastruktúra
Docker Compose-ban futó teljes stack (frontend, backend, Postgres) — ez adja a környezetfüggetlenséget: az éles üzembe állítás konfiguráció (domain, OIDC, repo-elérés), nem átépítés. Publikus PaaS free tier (Vercel/Netlify) elvetve: licenc- és kapacitáskorlátok, plusz nem futtatnak tartós backendet és adatbázist.
**Vészhelyzeti elérés:** szerverleállás esetén a repo klónozható és Obsidiannal olvasható — ezt belső oktatás ismerteti.

### D11 — Fejlesztési adathatár
Éles céges tartalom nem kerülhet a fejlesztői környezetbe (otthoni szerver, privát repo); a fejlesztés dummy adatokkal történik. Éles adat csak a céges környezetben, a szervezeti repóban születik.

## 4. Adatmodell-vázlat (PostgreSQL)

- `documents` — út a repóban, cím, kategória, státusz, tulajdonos, utolsó commit hash, indexelt tartalom (`tsvector`, magyar konfiguráció + `pg_trgm` a ragozás-tűrő kereséshez)
- `events` — dokumentum, típus (created/edited/status_changed/deleted/restored), felhasználó, időbélyeg, részletek (JSONB)
- `comments` — dokumentum, szerző, tartalom, időbélyeg; rendszerüzenetek az `events`-ből vetítve
- `locks` — dokumentum, felhasználó, megszerzés ideje, utolsó heartbeat
- `allowlist` — engedélyezett e-mail címek
- `users` — OIDC-ből érkező identitások gyorsítótára (név, e-mail, avatar)

A frontmatter (YAML a .md fájl elején) hordozza a Gitben is a metaadatokat (status, owner, iteration, category) — az index ebből épül, így a repo önmagában is teljes értékű.

## 5. MVP scope és ütemezés

**MVP (kötelező a demóhoz):**
1. Google OIDC login + e-mail allowlist
2. Dokumentum CRUD webes markdown szerkesztővel (mentés = commit)
3. Verziótörténet nézet + korábbi verzió visszaállítása
4. Teljes szövegű keresés (magyar konfig) + kategória/státusz szűrés
5. Lock heartbeat-tel
6. Eseménynaplózás + kommentfolyam rendszerüzenetekkel
7. Reindex parancs
8. Archívum + visszaállítás felület

**Második ütem:** diff-nézet két verzió között, lock-átvétel, allowlist-karbantartó felület, státusz-riportok.

**Jövőbeli munka (szakdolgozatban fejezetként):** Microsoft Entra ID integráció (App Registration, csoport-claimek), szervezeti GitHub-ra állás, céges domain + TLS, esetleges olvasó-tükör.

## 6. Ismert korlátok, vállalt kockázatok

- A státusz-workflow nem kikényszerített (D6) — szervezeti fegyelemre épül, az audit-nyom a védvonal.
- A magyar full-text keresés stemmer-minősége korlátos; a `pg_trgm` kombináció enyhíti, szemantikus keresés (pgvector) későbbi opció.
- Valós idejű közös szerkesztés (Google Docs-élmény) tudatosan nincs — a lock-modell zárja ki az ütközést.
- Csatolmányok (képek, PDF) nem az adatbázisban: fájlrendszer vagy MinIO, hivatkozással — tervezendő az MVP után közvetlenül.
- Egyszemélyes fejlesztés és üzemeltetés a bevezetésig: busz-faktor 1; a dokumentáció és az átadási terv ezért a projekt része.
