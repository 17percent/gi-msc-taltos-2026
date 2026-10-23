---
tags:
  - taltos/egyseg
allapot: döntve
kivalt: "[[Szerkesztés/Zárolás|Zárolás]]"
mvp: 4
---

# Valós idejű közös szerkesztés

> [!warning] Javaslat — megvalósítási terv
> Az éles alkalmazásba szánt funkció. Felülírja a [[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] D7-es pontját (pesszimista lock + heartbeat), és módosítja a D16-ot és a D26-ot. Naplópontként rögzítve: **D29** (Döntési napló v9).

## Cél

Egy dokumentumot több felhasználó szerkeszthessen egyszerre, Google Docs-szerűen: a változások azonnal látszanak mindenkinél, minden résztvevő kurzora és kijelölése a saját színével és **névcímkéjével** jelenik meg, ütközés és elveszett munka nélkül. A lock + heartbeat megoldás megszűnik.

## Működés a prototípusban

Nincs ilyen. A prototípusban [[Szerkesztés/Zárolás|zárolás]] van: egyszerre egy szerkesztő, 30 mp-es heartbeat, 2 perc után lejár. A D7 és a 6. fejezet a valós idejű közös szerkesztést tudatosan kizárta, ezt a döntést bontjuk most fel.

## Javasolt megoldás röviden

| Réteg | Választás | Miért |
|---|---|---|
| Szinkronizációs modell | **CRDT, Yjs** | Konfliktusmentes összefésülés központi „igazság-sorrend” nélkül, offline szerkesztés után is. Kiforrott, a legelterjedtebb JS CRDT. |
| Szerver | **Hocuspocus** (Yjs WebSocket-szerver, TypeScript) | Node.js-ben fut a Fastify mellett, kész hookok: hitelesítés, betöltés, perzisztálás, debounce. Self-hosted, adat nem hagyja el a céges infrát (D11). |
| Szerkesztő | **CodeMirror 6 + `y-codemirror.next`** | Távoli kurzorok és névcímkék, felhasználónkénti undo (`Y.UndoManager`). A `@uiw/react-md-editor` textarea-alapú, Yjs-kötése és távoli kurzorai nincsenek, ezért cserélni kell. |
| Jelenlét | **Yjs Awareness** protokoll | Kurzor, kijelölés, név, szín, „éppen gépel”. Nem perzisztált, csak élő állapot. |
| Tárolás | Postgres: Yjs-állapot `bytea` + a meglévő szöveges tartalom és revíziók | A keresés (`search_vector`), a diff és az export továbbra is sima szövegen dolgozik. |
| Offline / piszkozat | **`y-indexeddb`** | Kiváltja a D7 localStorage-piszkozatát; újracsatlakozáskor automatikus összefésülés. |

### Megvizsgált alternatívák

| Alternatíva | Miért nem |
|---|---|
| OT (ShareDB) | Központi transzformációs szerver, bonyolultabb offline-kezelés; a Yjs-ökoszisztéma kész CodeMirror-kötést és awareness-t ad. |
| Automerge | Működne, de a szövegszerkesztő-kötések és a szerveroldali eszközök kevésbé érettek. |
| SaaS (Liveblocks, Tiptap Cloud stb.) | Adathatár (D11): a tartalom harmadik félnél haladna át. |
| WYSIWYG szerkesztő (Tiptap/Milkdown) | A markdown-forrás pontos megőrzése nehezebb, a meglévő render-pipeline (D16, `rehype-sanitize`) és a diff a forrásszövegre épül. Később külön döntés lehet. |
| Lock megtartása + „lock átvétele” | Nem ad egyidejű szerkesztést, ezt a célt nem teljesíti. |

## Architektúra

```
Böngésző (React SPA)                           Backend (Node.js)
┌───────────────────────────────┐              ┌──────────────────────────────────────┐
│ CodeMirror 6 + yCollab        │   wss://     │ Fastify REST /api/v1  (változatlan)  │
│  Y.Doc ── Y.Text("content")   │◄────────────►│ Hocuspocus /collab                    │
│  Awareness (név, szín, kurzor)│  Yjs-update  │  onAuthenticate: session + allowlist │
│  y-indexeddb (offline)        │  + awareness │                  + színtér-szerepkör │
│ Előnézet: react-markdown +    │              │  onLoadDocument / onStoreDocument    │
│  rehype-sanitize (változatlan)│              └───────────────┬──────────────────────┘
└───────────────────────────────┘                              │ egy tranzakció
                                                               ▼
                                            PostgreSQL: document_collab_state (bytea)
                                                        documents.content (szöveg)
                                                        document_revisions, events
```

- A Hocuspocus ugyanabban a Node-folyamatban fut, mint a Fastify (közös HTTP-szerver, `/collab` útvonalon WebSocket upgrade), így egy deploy-egység marad.
- Egy dokumentum = egy Yjs-dokumentum, neve a stabil `documents.id` (UUID).
- **D2 érvényben marad:** minden írás a backenden át megy, csak a csatorna REST helyett WebSocket.

## Adatmodell-változások

- **Új:** `document_collab_state (document_id PK/FK, ydoc_state bytea, state_vector bytea, updated_at)` — a Yjs-dokumentum kódolt állapota.
- **`documents.content`** megmarad mint *materializált* szöveg: a szerver a Y.Text tartalmát debounce-szal visszaírja, így a generált `search_vector` (D4) magától frissül.
- **`document_revisions`**: változatlan szerkezet (teljes szövegű pillanatkép), plusz `contributors uuid[]` (vagy külön `document_revision_contributors` tábla) — egy revíziónak több szerzője lehet.
- **Megszűnik:** `locks` tábla, a lock-végpontok, a `lock_acquired` / `lock_released` / `lock_expired` események.
- **Új események:** `collab_session_started`, `collab_session_ended` (opcionális, résztvevőkkel), az `edited` pedig checkpointonként egy darab, a résztvevők listájával — nem billentyűleütésenként.

## Mentés és revíziók

A klasszikus „Mentés” gomb értelmét veszti: minden változás azonnal a szerverre kerül. Ezért két szintet választunk szét:

1. **Folyamatos perzisztálás** (technikai): Hocuspocus `onStoreDocument`, kb. 2 mp debounce, legfeljebb 10 mp. Egy tranzakcióban frissül a `document_collab_state` és a `documents.content` ([[Adattárolás/Tranzakciós mentés|Tranzakciós mentés]] elve megmarad). Revízió nem keletkezik.
2. **Revízió-checkpoint** (felhasználói): új `document_revisions` sor + `edited` esemény, ha
   - valaki a „Verzió mentése” gombra kattint (opcionális üzenettel, lásd [[Szerkesztés/Markdown szerkesztő|Markdown szerkesztő]] nyitott kérdés), vagy
   - az utolsó szerkesztő is kilép a dokumentumból, vagy
   - X perc (javaslat: 10) tétlenség után, ha volt változás.

   A `contributors` azok, akik a legutóbbi checkpoint óta módosítottak (a Yjs-update-ek a kapcsolat hitelesített felhasználójához köthetők).

**Visszaállítás** egy korábbi revízióra: a szerver *direct connection*-nel nyitja meg az élő Y.Doc-ot, és egy Yjs-tranzakcióban lecseréli a szöveget. Az aktív szerkesztők azonnal látják, a történet nem íródik át ([[Dokumentumok/Verziózás|Verziózás]] elve). Ugyanígy kezelendő minden szerveroldali tartalomírás (pl. létrehozás forrásból).

**D26 módosul:** a `PUT …/content` + `baseRevisionId` (412) mint elsődleges mentési út megszűnik; vagy kivezetjük, vagy integrációs/admin célra marad, és ugyanazon a direct connection-ön át ír.

## Jelenlét és névcímkék

- Awareness-állapot: `{ user: { id, name, color }, cursor, selection }`. Nevet és id-t a **szerver** a sessionből tölti ki, a kliens nem hamisíthatja.
- **Szín:** determinisztikusan a felhasználó id-jéből, a [[Branding|Táltos Design System]] palettájából, megfelelő kontraszttal világos és sötét módban.
- **Névcímke** a távoli kurzor fölött (Google Docs-minta): megjelenik mozgáskor/gépeléskor, néhány mp tétlenség után elhalványul, hoverre újra látszik. Kijelölés a felhasználó színének halvány változatával.
- **Fejléc:** avatar-sor („Most szerkesztik: …”), a saját felhasználó külön jelölve; kattintásra az adott kurzorhoz ugrik.
- **Olvasó nézetben és az Atlaszban/listán:** jelvény, ha a dokumentumot éppen szerkesztik (a mostani 🔒 badge helyére, tiltás nélkül).
- **Kapcsolat állapota:** „Mentve” / „Szinkronizálás…” / „Offline — a módosítások helyben megmaradnak” jelzés a Mentés-sáv helyén.

## Jogosultság és biztonság

- **Hitelesítés:** a WebSocket-upgrade a meglévő httpOnly session-cookie-t használja (D26), `onAuthenticate` ellenőrzi a sessiont és az [[Felhasználók/Allowlist|allowlistet]].
- **CSWSH elleni védelem:** a CSRF-token helyett az upgrade-nél kötelező `Origin`-ellenőrzés (csak a saját domain).
- **Szerepkör:** ha nincs írási jog (lásd [[Felhasználók/Jogosultságok|Jogosultságok]], [[Kollaboráció/Színterek|Színterek]]), a kapcsolat `readOnly`: élőben látja a változásokat és a többiek kurzorát, de nem írhat. A szerver elveti a read-only kapcsolat update-jeit.
- **Visszavonás:** allowlistről törlés vagy szerepkör-változás esetén a szerver bontja a kapcsolatot; időszakos újraellenőrzés (pl. 5 perc).
- **Korlátok:** maximális dokumentum- és üzenetméret, kapcsolatonkénti rate limit.
- **Megjelenítés:** a `rehype-sanitize` (D16) változatlanul minden renderelésnél fut; mások gépelése soha nem kerül sanitize nélkül a DOM-ba.

## Kapcsolat a többi egységgel

- **[[Dokumentumok/Státusz-workflow|Státusz-workflow]]:** nyitott kérdés, hogy `review` vagy `publikált` státuszban szabad-e élőben szerkeszteni (lásd lent).
- **[[Kollaboráció/Kommentek|Kommentek]]:** a Yjs `RelativePosition` lehetővé teszi, hogy a komment szövegrészhez kötődjön, és szerkesztés közben is a helyén maradjon. Ez megválaszolja a Kommentek „sorhoz/szakaszhoz kötés” kérdését, de külön ütem (döntve: második ütem, [[Versenytárs-elemzés]] V19).
- **[[Nyomonkövetés/Értesítések|Értesítések]]:** checkpoint-alapú, nem leütés-alapú értesítés.
- **[[Nyomonkövetés/Eseménynapló|Eseménynapló]]:** az `events` append-only marad, csak a granularitás változik.

## Üzemeltetés

- **Reverse proxy:** WebSocket-upgrade engedélyezése, megfelelő idle timeout (ping/pong), sticky routing nem kell egy példánynál.
- **Skálázás:** ~200 fős szervezetnél egy Node-példány elég. Több példánynál `@hocuspocus/extension-redis` kell, ami új függőség (a D22 a Redist elhagyta) — csak akkor vezetjük be, ha szükséges.
- **Tárhely:** a Yjs-állapot a tombstone-ok miatt nő; GC bekapcsolva, és időszakos tömörítés (állapot újrakódolása). A revíziók továbbra is teljes szövegű pillanatképek, ezért a [[Adattárolás/Revíziók tárolása|tárhely-becslés]] checkpoint-számmal számolandó, ami várhatóan kevesebb, mint a mostani mentésszám.
- **Backup:** a `document_collab_state` is része a `pg_dump`-nak ([[Üzemeltetés/Backup|Backup]]); visszaállításkor a `documents.content` az elsődleges, a Yjs-állapot újraépíthető belőle.
- **Megfigyelhetőség:** aktív kapcsolatok, dokumentumonkénti résztvevők, store-latencia, elutasított update-ek metrikái.

## Megvalósítási ütemek

| # | Munkacsomag | Tartalom | Kész, ha |
|---|---|---|---|
| K0 | Spike | Hocuspocus + CodeMirror 6 + yCollab minimál PoC két böngészővel, a meglévő render-pipeline-nal | Két felhasználó egyszerre ír, névcímkék látszanak, nincs ütközés |
| K1 | Collab szerver | Hocuspocus integrálása a Fastify mellé, `onAuthenticate` (session, allowlist, Origin), read-only mód | Jogosulatlan kapcsolat elutasítva, read-only nem tud írni |
| K2 | Perzisztencia | `document_collab_state` migráció (Drizzle), betöltés/tárolás, `documents.content` materializálás, kezdeti Y.Doc a meglévő tartalomból | Szerver-újraindítás után semmi nem vész el, a keresés friss |
| K3 | Szerkesztőcsere | `@uiw/react-md-editor` → CodeMirror 6 **élő előnézettel** (Obsidian-modell, D40), helyi menü, Tulajdonság-panel, forrásnézet-kapcsoló, Táltos-téma, `y-indexeddb` | Funkcionális egyezés a mostani szerkesztővel, offline-szerkesztés összefésül |
| K4 | Jelenlét UI | Kurzor-címkék, színek, avatar-sor, kapcsolati állapot, „éppen szerkesztik” jelvény | UX-review a Design System szerint, világos/sötét mód |
| K5 | Revíziók és események | Checkpoint-logika, „Verzió mentése”, `contributors`, visszaállítás direct connection-nel, új eseménytípusok | Diff és visszaállítás működik élő munkamenet közben is |
| K6 | Lock kivezetése | `locks` tábla, végpontok, heartbeat, lock-események és UI eltávolítása; D26 `PUT …/content` sorsa | Nincs lock-kód, a régi kliens kulturáltan hibát kap |
| K7 | Keményítés és teszt | Rate limit, méretkorlát, kapcsolatbontás visszavonáskor, metrikák; Playwright több böngésző-kontextussal, konvergencia-tesztek, terheléses teszt | Zöld e2e, 20+ egyidejű szerkesztő egy dokumentumon stabil |
| K8 | Dokumentáció | D29 naplópont (✅ rögzítve), D7/D16/D26 jelölése, [[Szerkesztés/Zárolás|Zárolás]] jegyzet „kiváltva” állapotba, API-kontraktus frissítése, szakdolgozat-fejezet | Napló és jegyzetek konzisztensek |

A sorrend kockázat-előrehozó (D27 szellemében): a szerkesztőcsere és a perzisztencia a legkockázatosabb, ezért a K0 spike mindkettőt érinti.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]]:

- **D7** — felülírandó (lock + heartbeat → CRDT közös szerkesztés).
- **D16** — módosítandó (szerkesztő: CodeMirror 6; a `rehype-sanitize` és a képforrás-korlát marad).
- **D26** — módosítandó (mentés-szemantika, `baseRevisionId` szerepe; új `/collab` WebSocket-végpont).
- **D2, D11, D22** — érvényben maradnak, a fenti megkötésekkel.
- **6. fejezet** — a „valós idejű közös szerkesztés tudatosan nincs” korlát törlendő; új kockázatok: WebSocket-infrastruktúra, Yjs-állapot mérete, szerkesztőcsere.
- **D29** (rögzítve, v9) — Valós idejű közös szerkesztés: Yjs + Hocuspocus + CodeMirror 6.

## Nyitott kérdések

- ~~**Státusz és élő szerkesztés**~~ **Döntve ([[Versenytárs-elemzés]] V6–V7):** egy `publikált` dokumentumon az írási joggal rendelkező kapcsolat első Yjs-update-je után a szerver ugyanabban a tranzakcióban `draft`-ra állítja a státuszt. Munkapéldány nincs, az olvasók az élő tartalmat látják draft jelvénnyel.
- ~~Kötelező mentési üzenet?~~ **Döntve (D45):** nem, a változásleírás mindig opcionális. A checkpoint nem véglegesít: a szerkesztés Piszkozatban folyik, véglegesíteni a Review-ra küldés és a két jóváhagyás tud.
- ~~Szerzőség?~~ **Döntve (D49):** elég a checkpointonkénti résztvevőlista; a review-kérés ezt csatolja.
- ~~„Kövesd X-et”?~~ **Döntve (D49):** második ütem.
- ~~Olvasók jelenléte?~~ **Döntve (D49):** minden, a dokumentumot néző tag látszik (csak olvasó szerep nincs, D43).
- **Átállás:** van-e olyan élő környezet, ahol a lock-modellről adatmigráció kell, vagy a váltás még az első éles indulás előtt történik?

## Kapcsolódó egységek

[[Szerkesztés/Zárolás|Zárolás]] (kiváltja) · [[Szerkesztés/Markdown szerkesztő|Markdown szerkesztő]] · [[Adattárolás/Tranzakciós mentés|Tranzakciós mentés]] · [[Adattárolás/Revíziók tárolása|Revíziók tárolása]] · [[Dokumentumok/Verziózás|Verziózás]] · [[Kollaboráció/Kommentek|Kommentek]] · [[Kollaboráció/Színterek|Színterek]] · [[Felhasználók/Jogosultságok|Jogosultságok]]
