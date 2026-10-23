# Handoff — Vállalati tudásbázis projekt (szakdolgozat), 2. munkamenet

## Kontextus

A felhasználó ~200 fős, vegyes összetételű vállalat számára készít webes, markdown-alapú tudásbázis-rendszert egyetemi szakdolgozatként; egyedül fejleszt, otthoni szerveren, éles üzem később céges infrastruktúrán. Ez a munkamenet a **második grilling session** volt: a felhasználó öt saját kérdést hozott (repo-biztonság, infobiztonság, diff-megjelenítés, Azure Repos átállás, frontend stack), az agent további lyukakat tárt fel (L1–L5), és minden felmerült kérdés döntéssel zárult. **Az architektúra-terv ezzel lényegében lezárt; a projekt az építkezési fázis küszöbén áll.**

## Kulcs-artifact (NE duplikáld, hivatkozz rá)

**`/mnt/user-data/outputs/tudasbazis-architektura-dontesi-naplo.md` — 2. verzió!** A teljes terv: D1–D16 döntési pont, adatmodell-vázlat (stabil UUID-val), MVP scope (9 pont), kockázatok, nyitott kérdések (NY1 lezárva, NY2–NY3 nyitva). Ha az új környezetben nem elérhető, kérd el a felhasználótól — nála megvan. **Figyelem: az 1. verziójú napló elavult** (abban még nincs D12–D16, SSH-döntés, backup-szabály, stabil ID).

## A 2. munkamenet döntései (részletek a naplóban, itt csak a lényeg)

- **D3 módosítva:** backend↔repo hitelesítés SSH kulccsal, provider-agnosztikusan. Fejlesztés: privát GitHub repo deploy key-jel; éles: **Azure Repos** (céges standard), dedikált service accounttal (Azure-nál az SSH kulcs fiókszintű!). GitHub-ra éles céges tartalom SOHA nem kerül (D11 kiterjesztés).
- **D4 pontosítva:** csak az *index* eldobható; `events`/`comments`/`allowlist` elsődleges adat → **ütemezett pg_dump backup kötelező (MVP 9. pont)** + automatizált konzisztencia-őr (HEAD vs. indexelt hash-ek, eltérésnél auto-reindex).
- **D6 kiegészítve:** teljes olvasási nyitottság kimondott cél (kollaboráció); tartalompolitikai korlát: csak mindenki által megismerhető tartalom kerülhet be. Allowlist-ellenőrzés MINDEN kérésnél, nem csak loginkor.
- **D12 (új):** Git-hozzáférés kizárólag git protokollon, tartós volume-on élő **lokális clone**-nal; provider REST API tilos. Git-műveletek **worker queue-n sorosítva**; push retry exponenciális backoff-fal; remote-lemaradás monitoring.
- **D13 (új):** secret-kezelés — Docker Compose secrets, környezetenként külön kulcspár, rotációs eljárás, semmi sem kerül image-be/repóba.
- **D14 (új):** frontend stack: shadcn/ui + Tailwind + Motion (vállalt elköteleződés).
- **D15 (módosítva a sessionön belül!):** a repóban KIZÁRÓLAG .md szöveg; **képek az alkalmazás szintjén kezelt assets mappából** (javasoltan mountolt volume), feltöltési funkció NINCS, kép hozzáadása fejlesztői művelet. Export (.pdf/.txt/esetleg .docx) második ütem, szerveroldali (pandoc).
- **D16 (új):** markdown szerkesztő: **@uiw/react-md-editor** + kötelező rehype-sanitize (betárolt XSS ellen) + képforrás-korlátozás saját assets-útvonalra + azonos remark/rehype pipeline szerkesztő-előnézetben és olvasó nézetben.
- **Adatmodell:** stabil dokumentum-`id` (UUID, frontmatterben is), minden tábla erre hivatkozik, az út csak attribútum (átnevezés nem szakítja el a kommenteket/eseményeket/URL-eket).

## Nyitott kérdések és következő lépések

1. **NY2 — Azure Repos branch policy (SÜRGŐS, külső függőség):** ha a céges DevOps kötelező PR-review-t ír elő a main-re, a „mentés = commit" modell borul. A felhasználónak a DevOps-adminnal MOST kell egyeztetnie (policy-kivétel / bypass jog a service accountnak). Kérdezz rá, megtörtént-e.
2. **A felhasználó által választandó következő munkadarab** (a kérdés feltéve, válasz még nincs):
   a) **PostgreSQL séma** konkrét `CREATE TABLE` szkriptekkel — most már megírható: stabil UUID, tsvector `hungarian` + pg_trgm, elsődleges vs. újraépíthető táblák megkülönböztetése, locks/heartbeat mezők.
   b) **User story specifikációk** az MVP kilenc pontjához.
3. **NY3 — allowlist-karbantartás** (felület vs. konfig): második ütem, nem sürgős.
4. Későbbre: lock-átvétel UX, diff-nézet UI (diff2html / react-diff-viewer merült fel), export-pipeline.

## Suggested skills

- **user-story-spec** (`/mnt/skills/user/user-story-spec/SKILL.md`) — ha a felhasználó a 2b) irányt választja, KÖTELEZŐ ezzel készíteni; magyar, rögzített sablon.
- **grill-me** (`/mnt/skills/user/grill-me/SKILL.md`) — új tervrész (pl. séma, export) átvilágítására. Két grilling lezajlott (architektúra + repo-biztonság/Git-hozzáférés/scope) — a D1–D16 döntéseket NE nyisd újra.
- **prototype** (`/mnt/skills/user/prototype/SKILL.md`) — lock/heartbeat állapotmodell vagy szerkesztő-UX kipróbálására.
- **repo-atlas** csak akkor, ha már létező kódbázist kell feltérképezni (még nincs kód).
- **docx/xlsx/pdf** csak kifejezett Office/PDF leadandó kérésére.

## Stílus / kommunikáció

Magyar nyelv. A felhasználó technikailag képzett, döntésképes (gyorsan, tételesen dönt), kifejezetten kéri és jól fogadja a kemény, de konstruktív rákérdezést és a kimondott trade-offokat. A döntéseket a döntési naplóban rögzítve várja — a napló a szakdolgozat tervezési fejezetének váza, tartsd naprakészen minden döntés után.
