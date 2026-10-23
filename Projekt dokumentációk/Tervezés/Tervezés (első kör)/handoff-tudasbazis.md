# Handoff — Vállalati tudásbázis projekt (szakdolgozat)

## Kontextus

A felhasználó egy ~200 fős, vegyes összetételű (nem csak fejlesztő) vállalat számára készít egyedi, webes markdown-alapú tudásbázis-rendszert **egyetemi szakdolgozat** keretében. A fejlesztést egyedül, otthon végzi saját szerveren; az éles üzem később céges infrastruktúrán valósul meg. A beszélgetés egy hosszú architektúra-tervezési folyamat volt, amely egy grilling sessionnel (grill-me skill) zárult — a terv minden fő döntése megszületett és rögzítve van.

## A végleges architektúra (röviden)

React frontend + backend API + **Git repo (GitHub) mint tartalom source of truth** + **PostgreSQL** mint eldobható/újraépíthető keresőindex (magyar full-text + pg_trgm), események, kommentek, lockok, allowlist tárolója. Autentikáció cserélhető **OIDC** rétegen: fejlesztés alatt Google login + e-mail allowlist, élesben Microsoft Entra ID. Minden írás kizárólag a webes API-n át történik; a backend deploy key / GitHub App hitelesítéssel commitol. Nincs jogosultságkezelés — teljes átláthatóság (eseménynapló + kommentfolyam rendszerüzenetekkel) kompenzálja. Egyidejű szerkesztés: pesszimista lock heartbeat-tel (2–5 perc TTL). Hosting: Docker Compose, fejlesztésben otthoni szerver, élesben céges VM/domain. Vercel/Netlify free tier elvetve.

## Kulcs-artifact (NE duplikáld, hivatkozz rá)

**`/mnt/user-data/outputs/tudasbazis-architektura-dontesi-naplo.md`** — a teljes architektúra-terv 11 döntési ponttal (D1–D11), adatmodell-vázlattal, MVP scope-pal és vállalt kockázatokkal. Ez a projekt elsődleges tervezési dokumentuma; a szakdolgozat tervezési fejezetének váza. Megjegyzés: a fájl a korábbi munkamenet outputs könyvtárában jött létre — ha az új környezetben nem elérhető, kérd el a felhasználótól, nála megvan.

## Fontos döntések és indoklásaik (amit egy új agentnek tudnia kell)

- A Git+Postgres varrat szabálya: commit az elsődleges, index-hiba nem hiúsítja meg a mentést; kötelező `reindex` parancs az első naptól (D4).
- Jogosultság-mentesség tudatos döntés (D6): a workflow „technikailag nyitott, szervezetileg szabályozott"; státuszváltás/törlés rendszerüzenetként publikálódik.
- Fejlesztési adathatár (D11): éles céges tartalom NEM kerülhet az otthoni/privát fejlesztői környezetbe — dummy adat kötelező.
- A szoftver hordozható, az ADAT nem: a felhasználó a szoftvert viszi tovább esetleges munkahelyváltásnál, üres adatbázissal, új auth-tal.
- MVP scope a döntési napló 5. fejezetében; Entra ID integráció és diff-nézet nem MVP.

## Nyitott feladatok (a felhasználó által jelzett következő lépések)

1. **PostgreSQL séma** konkrét `CREATE TABLE` szkriptekkel (documents, events, comments, locks, allowlist, users; tsvector hungarian + pg_trgm; frontmatter-szinkron)
2. **User story specifikációk** az MVP nyolc pontjához a fejlesztés indításához
3. Későbbre: csatolmány-kezelés terve (MinIO/fájlrendszer), allowlist-karbantartó felület stratégiája (felület vs. konfig — még nyitott), lock-átvétel UX

## Suggested skills

- **user-story-spec** (`/mnt/skills/user/user-story-spec/SKILL.md`) — ha a felhasználó az MVP user story-kat kéri (2. nyitott feladat), ez a skill kötelezően használandó; magyar nyelvű, rögzített sablonú specifikációkat készít.
- **prototype** (`/mnt/skills/user/prototype/SKILL.md`) — ha a lock/heartbeat állapotmodellt vagy a szerkesztő UX-et akarja kipróbálni.
- **grill-me** (`/mnt/skills/user/grill-me/SKILL.md`) — ha új tervrészt (pl. séma, csatolmány-kezelés) akar átvilágítani; az előző grill lezárult, ne nyisd újra ugyanazokat a kérdéseket.
- **xlsx / docx** skillek csak akkor, ha kifejezetten Office-formátumú leadandót kér.

## Stílus / kommunikáció

A felhasználó magyarul kommunikál, technikailag képzett, értékeli az őszinte ellenvetéseket és a kimondott trade-offokat. A grilling session hangnemét (kemény, de konstruktív rákérdezés) kifejezetten kérte és jól fogadta.
