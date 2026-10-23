# Tudásbázis — API-kontraktus (B5, 10. verzió)

*A [[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] D26 pontjának kifejtése, a D29, a D42–D49 és a D51 változásaival. Adatmodell: [[Tervezés/Tervezés (hetedik kör)/tudasbazis-db-sema-b4|B4 (10. verzió)]]. A napló az elvi forrás: eltérés esetén a napló nyer.*

*Változás a korábbi B5-höz képest ([[Tervezés/Tervezés (negyedik kör)/tudasbazis-api-kontraktus-b5|B5, napló v6 szerint]]): a Git-szemantika (commit hash, push, reindex), a lock (D7) és a kategóriák (D19) megszűntek. Új: közös szerkesztés WebSocketen (D29), színterek és szerepek (D43, D44), review-folyamat (D45), dashboard és értesítési csatorna (D46), címkék és fajta (D34), kapcsolatok (D39), felülvizsgálat (D33).*

## 1. Kontraktus-szintű döntések (A-pontok)

| # | Döntés | Indoklás / ár |
|---|---|---|
| A1 | **Session: httpOnly cookie + CSRF-védelem** *(változatlan)*; abszolút lejárat 8 óra, tétlenségi kiléptetés 60 perc, a WebSocket-forgalom aktivitásnak számít (NY10) | A token soha nem jár a böngésző JS-terében. `SameSite=Lax` + double-submit CSRF-token a mutáló kéréseken. A WebSocket-upgrade ugyanazt a cookie-t használja, kötelező `Origin`-ellenőrzéssel (D29). A munkamenet a Postgres `sessions` táblában él (D51a): újraindítást túlél, a kijelentkezés és az allowlistről levétel azonnal visszavonja; a `last_seen_at` írása legfeljebb percenként egyszer. **Megvalósítás (WP2, D53):** 32 bájtos véletlen token a sütiben (`__Host-taltos_sid` Secure módban, fejlesztésben `taltos_sid`), a táblában csak a SHA-256 hash-e; a `Secure` jelző a konfigurációból jön, soha nem az `X-Forwarded-Proto`-ból. A CSRF-token a session-token HMAC-je, az `X-CSRF-Token` fejlécben jár; minden nem biztonságos metódushoz engedélyezett `Origin` kell. A WebSocket-upgrade érvényes munkamenet és allowlist nélkül 401/403-mal, a kapcsolat előtt elutasul; a nyitott kapcsolat a munkamenet lejártakor vagy visszavonásakor bontódik. |
| A2 | **Hibaformátum: RFC 9457 Problem Details** + stabil `code` mező *(változatlan)* | A `code` kontraktus, a `detail` szövege szabadon változhat. |
| A3 | **Mentés két szintje (D29):** a tartalom a `/collab` WebSocketen folyamatosan perzisztálódik; revíziót a `POST …/checkpoints` vagy a szerver (kilépés, tétlenség) hoz létre | A korábbi „mentés = commit” REST-végpont megszűnt. A checkpoint nem véglegesít: a Jóváhagyott állapot csak a review-döntéssel jön létre (D45). |
| A4 | **Optimista ellenőrzés `baseRevisionId`-vel** a review-ra küldésen és a metaadat-változáson | A beküldés megmondja, melyik Jóváhagyott revízióra épül; ha közben más Jóváhagyott változás történt, **412 `stale_base_revision`**. |
| A5 | **Lapozás: `limit`/`offset` + `total`** *(változatlan)* | Pár ezer dokumentumnál a kurzoros lapozás indokolatlan. |
| A6 | **Egyetlen `feed` végpont** *(változatlan)*: kommentek + rendszeresemények, köztük a review-elutasítások indoklása kommentként (D45) | A kliens egy rendezett folyamot kap (`kind: comment \| system \| review`). |
| A7 | **Export: szinkron streaming** *(változatlan)*, mindig a legutóbbi **Jóváhagyott** revízióból; `.docx` Táltos-arculatú `reference.docx`-szel (D49) | Job + poll csak mért igény esetén. |
| A8 | **Code-first kontraktus: Fastify JSON Schema → OpenAPI** *(változatlan)*, `/api/v1` prefix | Egyetlen forrás a validációnak és a dokumentációnak. |
| A9 | **Jogosultság és láthatóság egy helyen (D43, D44):** minden végpont a `can(user, action, resource)` policy-függvényt hívja; minden lista a „látható dokumentumok” lekérdezés-építőn megy át | A szivárgás elleni védelem egyetlen ponton él, és végpontonként tesztelt. |
| A10 | **Nem tag hozzáférése egy dokumentumhoz: 403 `not_space_member`, cím nélkül**, a színtér nevével, a Színtérgazdák listájával és a felvételi kérés lehetőségével (D44) | A csonk-nézet (D44) így a felületen előállítható, a dokumentum címe és tartalma nem szivárog. Nem létező azonosító: 404. |
| A11 | **Review mint erőforrás (D45):** a változások `change_requests` erőforráson át véglegesednek; a dokumentum közvetlen írása (archiválás, metaadat, visszaállítás) nem létezik | A D45 kikényszerítése az API szerkezetéből következik: nincs olyan végpont, amely review nélkül módosítaná a Jóváhagyott állapotot. |
| A12 | **Valós idejű csatornák: `/collab` (Hocuspocus, D29) és `/ws/notifications` (D46)**, közös Node-folyamatban | A dashboard és az értesítések élőben frissülnek; a korábbi polling megszűnt. |

## 2. Végpontlista

Minden `/api/v1/*` végpont (az ismeretlen útvonal is): munkamenet nélkül **401 `unauthenticated`**; allowlist-ellenőrzés kérésenként (D5) → hiánya **403 `not_on_allowlist`**, és a munkamenet visszavonódik. Mutáló kérések CSRF-token nélkül → **403 `csrf_failed`**. Jogosultsághiány: **403 `forbidden`** (vagy a specifikus kód). Az „Ki” oszlop a [[Felhasználók/Szerepkörök|jogosultsági mátrixot]] követi.

### Auth és identitás
| Metódus + út | Ki | Leírás |
|---|---|---|
| `GET /auth/login` | bárki | Mindig 302 az OIDC szolgáltatóhoz (fejlesztésben is valódi Google, D49): Authorization Code + PKCE (S256) + state + nonce; ezek egy aláírt, httpOnly, `Path=/auth`, 10 perces sütiben (D53) |
| `GET /auth/callback` | bárki | A code flow lezárása; csak `email_verified === true`. Siker: új session-süti (a kérés régi munkamenete visszavonva), `users` upsert, `last_login_at`, 302 → `/`. Hibák: 302 → `/?error=not_on_allowlist` (hitelesített, de nem engedélyezett cím), `/?error=setup_pending` (még nincs Rendszeradmin, és nem a `BOOTSTRAP_ADMIN_EMAIL` lépett be, D54), `/?error=login_failed` (minden más) — munkamenet nélkül. A hibakódok a `@taltos/shared` `LoginError` típusában |
| `POST /auth/logout` | belépett | CSRF-token és engedélyezett `Origin` kell. A munkamenet visszavonása a `sessions` táblában (D51a), a süti törlése, a munkamenet nyitott WebSocketjeinek bontása; 204. Érvényes munkamenet nélkül 401, de a sütit ekkor is törli |
| `GET /api/v1/me` | belépett | A `@taltos/shared` `MeResponse`: `{ id, displayName, email, avatarUrl, systemRole, spaces: [{ id, name, type, role }], csrfToken }`, `Cache-Control: no-store` |
| `GET /api/v1/me/dashboard` | belépett | A dashboard blokkjai (D46): `reviewRequests`, `ownRequests`, `changesRequested`, `reviewsDue`, `mentions`; Színtérgazdának `membershipRequests`, Rendszeradminnak `spaceRequests`. Query: `spaceId` (szűrő), `limit`. Elakadt review-k (3 munkanap) `stale: true` jelzővel. |

### Színterek és tagság (D30, D43, D44)
| Metódus + út | Ki | Leírás |
|---|---|---|
| `GET /api/v1/spaces` | belépett | A saját színterek; Rendszeradminnak az összes (csak metaadat, tartalom nélkül) |
| `GET /api/v1/spaces/:id` | tag, Rendszeradmin | Név, típus, leírás, szín, lezárt-e, Színtérgazdák, taglétszám |
| `POST /api/v1/spaces` | Rendszeradmin | Létrehozás: `{ name, type, description, color, initialManagerId }` → `space_created`, `space_manager_assigned` |
| `PATCH /api/v1/spaces/:id` | Színtérgazda, Rendszeradmin | Leírás, szín (D37); a név és a típus csak Rendszeradminnak |
| `POST /api/v1/spaces/:id/close` | Rendszeradmin | Projekt-tér lezárása: minden csak olvasható (D44) |
| `GET /api/v1/spaces/:id/members` | tag | Tagok szereppel |
| `POST /api/v1/spaces/:id/members` | Színtérgazda, Rendszeradmin | Felvétel: `{ userId, role }`. Rendszeradmin saját magát is felveheti (`self_assigned`, értesítés nélkül) |
| `PATCH /api/v1/spaces/:id/members/:userId` | Színtérgazda, Rendszeradmin | Szerepváltás (előléptetés, visszaminősítés) → `role_changed`; utolsó gazdánál **409 `last_space_manager`**; tulajdonos visszaminősítése nem érinti a tulajdonjogot |
| `DELETE /api/v1/spaces/:id/members/:userId` | Színtérgazda, Rendszeradmin | Eltávolítás; utolsó gazdánál **409 `last_space_manager`**; ha a tag tulajdonos, **409 `owner_handover_required`**; ha függő review-er, a helye megszűnik (D51b): a döntése elvész, a másik review-eré megmarad, a kérés a pótlásig nem dönthető el → `reviewer_removed`, az indítványozó dashboardján pótlandóként |
| `POST /api/v1/spaces/:id/membership-requests` | nem tag | Felvétel kérése: `{ viaDocumentId?, message? }`; függő kérésnél **409 `request_pending`** |
| `POST /api/v1/membership-requests/:id/decision` | Színtérgazda | `{ approve: boolean, role? }` |
| `POST /api/v1/space-requests` | belépett | Projekt-tér kérése: `{ name, purpose, proposedManagerId }` |
| `POST /api/v1/space-requests/:id/decision` | Rendszeradmin | `{ approve: boolean, color? }` → jóváhagyáskor a színtér létrejön |
| `PUT /api/v1/spaces/:id/color` | tag | Egyéni Atlasz-szín (D37), privát, nem naplózott |

### Dokumentumok (D44 láthatósággal)
| Metódus + út | Ki | Leírás |
|---|---|---|
| `GET /api/v1/documents` | belépett | Lista + keresés a saját színterekből. Query: `q` (FTS + trgm, snippettel), `spaceId`, `kind`, `tag`, `reviewState` (`draft`, `pending`, `changes_requested`, `approved`), `owner`, `favorites=true`, `template=true`, `archived=true`, `limit`, `offset`. A szűrők az URL-ben élnek (D49). A lista, a keresés és a facetek az élő (legutóbbi) metaadatot mutatják, állapotjelzővel (D51e). Az `archived=true` csak a valaha Jóváhagyott, archivált dokumentumokat adja, az eldobott piszkozatokat nem. |
| `GET /api/v1/documents/similar?title=&spaceId=` | tag | Duplikátum-figyelmeztetés: legfeljebb 5 hasonló cím (D36, D49) |
| `POST /api/v1/documents` | Szerző (a célszíntérben) | Létrehozás Piszkozatként: `{ spaceId, title, kind, tagIds?, sourceDocumentId? }`. Forrással = duplikálás bármely saját színtérből (D44); `szarmazik` kapcsolat, `duplicated_from` mindkét oldalon. Sablon forrásként: második ütem (D47). |
| `GET /api/v1/documents/:id` | tag | Metaadat, a legutóbbi változat (függő is), `reviewState`, `approvedRevisionId`, `iteration`, a függő kérés, kedvenc és követés. Nem tagnak **403 `not_space_member`** (A10). |
| `DELETE /api/v1/documents/:id/draft` | indítványozó | Soha be nem küldött piszkozat eldobása, review nélkül (D45) → `draft_discarded`; a revízióival együtt 1 év után véglegesen törlődik (D51i). Egyébként **409 `has_approved_revision`** |
| `GET /api/v1/documents/:id/raw?frontmatter=true\|false` | tag | Nyers .md a legutóbbi Jóváhagyott revízióból (tartalom és a revízió `metadata`-pillanatképe, D51e); alapból frontmatter nélkül (D49) |
| `GET /api/v1/documents/:id/export?format=pdf\|docx` | tag | Pandoc-konverzió a Jóváhagyott revízióból (A7) |
| `PUT /api/v1/documents/:id/favorite` · `DELETE …` | tag | Kedvenc (D18), idempotens; a `DELETE` fizikai törlés (D51j) |
| `PUT /api/v1/documents/:id/subscription` · `DELETE …` | tag | Követés (D35), idempotens; a `DELETE` fizikai törlés (D51j) |
| `POST /api/v1/documents/:id/review-confirmation` | tag | „Még aktuális” (D33): új esedékesség, review nélkül → `review_confirmed` |

### Szerkesztés és revíziók (D29, D45)
| Metódus + út | Ki | Leírás |
|---|---|---|
| `WS /collab` | tag | Hocuspocus: Yjs-szinkron és Awareness. `onAuthenticate`: session + allowlist + tagság (A9); írási jog csak Piszkozat vagy Átdolgozandó állapotban; Jóváhagyott, Review-ra váró és lezárt térbeli dokumentumon `readOnly` |
| `POST /api/v1/documents/:id/edits` | Szerző | **„Módosítás indítása” (D51c):** Jóváhagyott dokumentumon új piszkozatot nyit a legutóbbi Jóváhagyott revízióból → `edit_started`; ettől írható a `/collab`. Már Piszkozat vagy Átdolgozandó állapotban idempotens (200). Függő kérésnél **409 `request_pending`**, lezárt projekt-térben **403 `space_closed`** |
| `POST /api/v1/documents/:id/checkpoints` | Szerző | „Verzió mentése”: piszkozat-revízió `{ message? }` → `edited` esemény a `contributors`-szal |
| `GET /api/v1/documents/:id/revisions` | tag | Revíziók listája (Jóváhagyott jelöléssel, `iteration`), lapozva |
| `GET /api/v1/documents/:id/revisions/:revId` | tag | Tartalom és metaadat adott revízión |
| `GET /api/v1/documents/:id/diff?from=&to=` | tag | Soronkénti diff szószintű kiemeléssel, plusz metaadat-diff (D45). Alapértelmezés: `from` = legutóbbi Jóváhagyott, `to` = legutóbbi változat |

### Review-folyamat (D45)
| Metódus + út | Ki | Leírás |
|---|---|---|
| `POST /api/v1/documents/:id/change-requests` | Szerző | Beküldés: `{ kind: create\|update\|metadata\|restore\|delete\|unarchive, baseRevisionId, reviewerIds: [a, b], proposedReviewDueAt?, message?, metadata?, restoreFromRevisionId? }`. A piszkozatból javasolt revízió jön létre, a tartalom befagy. A `proposedReviewDueAt` a `create`, `update`, `metadata` és `restore` kérésnél kötelező (a felület 12 hónapra előtölti; a review tárgya, D51f), a `delete` és az `unarchive` kérésnél tilos. A `restore` régi revízióra állít vissza; az **`unarchive`** archívumból hoz vissza, javasolt revízió nélkül (D51g). Hibák: **409 `request_pending`**, **409 `not_enough_reviewers`** (3 tag alatt), **422 `invalid_reviewers`** (nem tag, azonos vagy saját maga), **412 `stale_base_revision`** |
| `GET /api/v1/change-requests/:id` | tag | Kérés, review-erek döntésekkel, diff-hivatkozás |
| `POST /api/v1/change-requests/:id/decision` | megjelölt review-er | `{ decision: approved\|rejected, reason? }`; elutasításnál `reason` kötelező (**422 `reason_required`**). A második jóváhagyás egy tranzakcióban véglegesít (`approved_revision_id`, `iteration`, `review_due_at` a javasoltból; archiváláskor `deleted_at`, `unarchive`-nál `deleted_at = NULL`; `restore`-nál a revízió `metadata`-pillanatképe visszaíródik az élő táblákba, D51e). Dönteni csak két aktív review-er mellett lehet (megszűnt hely, D51b). Már lezárt kérésnél **409 `request_closed`** |
| `POST /api/v1/change-requests/:id/withdraw` | indítványozó | Visszavonás → a dokumentum újra Piszkozat |
| `POST /api/v1/change-requests/:id/reviewers/:reviewerId/replace` | indítványozó, Színtérgazda | `{ newReviewerId }` → `reviewer_replaced`; aktív review-er cseréjére és megszűnt hely pótlására (D51b) is; a másik review-er döntése megmarad. Korábban lecserélt személy újra jelölhető |

### Kommentfolyam (A6, D20, D35)
| Metódus + út | Ki | Leírás |
|---|---|---|
| `GET /api/v1/documents/:id/feed` | tag | Egyesített folyam: `comment`, `system`, `review` (elutasítási indoklás) elemekkel |
| `POST /api/v1/documents/:id/comments` | tag | Új komment; @említés csak a színtér tagjai közül (D44) |
| `PATCH /api/v1/comments/:id` · `DELETE …` | a komment szerzője | Szerkesztés (`comment_edited`) és soft delete |

### Címkék, fajta, kapcsolatok (D34, D39)
| Metódus + út | Ki | Leírás |
|---|---|---|
| `GET /api/v1/tags?q=` | belépett | Címkék darabszámmal; `q` esetén normalizált egyezés + legfeljebb 3 trigram-javaslat (D34) |
| `POST /api/v1/tags` | Szerző | Új címke a felajánlás elutasítása után → `tag_created`; ütközésnél **409 `tag_exists`** a meglévővel |
| `GET /api/v1/kinds` · `POST /api/v1/kinds` | belépett · Rendszeradmin | Fajta-lista; bővítés csak Rendszeradminnak |
| `GET /api/v1/documents/:id/links` | tag | Kimenő kapcsolatok és visszahivatkozások; idegen színtérbe mutatónál `{ hidden: true, spaceId }`, cím nélkül (D44) |

A kapcsolatok és a címkék a piszkozat metaadatának részei: a tartalommal együtt a review-ra küldéskor véglegesednek (D45). Kivétel a cél tulajdonosának `helyettesíti`-törlése (V50): `DELETE /api/v1/links/:id/by-target`, rendszer-revízió review nélkül. *A rendszer-revízió pontos szemantikája (`approved_revision_id`, `iteration`, függő kérés vagy élő piszkozat mellett) és az idegen színtérbeli cél kezelése nyitott: NY13, NY14 — a WP16 előtt dől el.*

### Értesítések (D35, D46)
| Metódus + út | Ki | Leírás |
|---|---|---|
| `WS /ws/notifications` | belépett | Élő értesítés és dashboard-frissítés (A12) |
| `GET /api/v1/notifications` | belépett | Lista (`unread=true`), lapozva |
| `POST /api/v1/notifications/read` | belépett | `{ ids }` vagy `{ all: true }` |

### Audit és adminisztráció
| Metódus + út | Ki | Leírás |
|---|---|---|
| `GET /api/v1/documents/:id/events` | tag | A dokumentum eseményei; ember nélküli (cron) eseménynél `actor: null`, a felületen „Rendszer” (D51d) |
| `GET /api/v1/spaces/:id/events?format=json\|csv` | Színtérgazda | Színtér-szintű audit, CSV-exporttal |
| `GET /api/v1/events?format=json\|csv` | Rendszeradmin | Rendszerszintű audit (szűrők: `spaceId`, `documentId`, `type`, `actorId`, időablak). A véglegesen törölt dokumentumra mutató esemény „törölt dokumentum”-ként jelenik meg (D51h). *Hogy a Rendszeradmin mely mezőket láthatja (cím, komment-szöveg): NY17.* |
| `GET /api/v1/admin/users` | Rendszeradmin | Felhasználók, `systemRole`, utolsó belépés |
| `PUT /api/v1/admin/users/:id/system-role` | Rendszeradmin | `{ systemRole }`; utolsó adminnál **409 `last_admin`** |
| `POST /api/v1/admin/users/:id/handover` | Rendszeradmin | Adminisztratív tulajdonos-átadás (`admin_handover`), ha a színtérnek nincs elérhető Színtérgazdája. *A rendes (tulajdonos vagy Színtérgazda általi) átadás végpontja nyitott: NY15.* |
| `GET /api/v1/admin/retention/preview` | Rendszeradmin | *Második ütem (WP33).* A következő végleges törlés tételei (D48, D51i) |
| `PUT /api/v1/admin/retention/holds/:documentId` · `DELETE …` | Rendszeradmin | *Második ütem (WP33).* Legal hold (D48); a hatóköre nyitott: NY19 |
| `GET /healthz` | bárki | Liveness |

Az allowlist az MVP-ben konfigurációból töltődik (D49); a karbantartó végpontok (`/admin/allowlist`) a második ütemben.

## 3. Hibaformátum és hibakód-katalógus

Minden hiba `application/problem+json` (A2):

```json
{
  "type": "https://tudasbazis.example/errors/not-space-member",
  "title": "Nem vagy tagja ennek a színtérnek",
  "status": 403,
  "code": "not_space_member",
  "details": {
    "space": { "id": "…", "name": "Adatplatform csapat" },
    "managers": [{ "id": "…", "displayName": "Kiss Anna" }],
    "canRequestMembership": true
  }
}
```

| `code` | HTTP | Mikor |
|---|---|---|
| `validation_error` | 400 | Sémasértő kérés; `details.errors` mezőnként |
| `unauthenticated` | 401 | Nincs vagy lejárt session (8 óra / 60 perc tétlenség) |
| `not_on_allowlist` | 403 | Bejelentkezett, de nincs az allowlisten (D5) |
| `csrf_failed` | 403 | Hiányzó vagy érvénytelen CSRF-token |
| `forbidden` | 403 | A szerep nem elég (D43), vagy nem a komment szerzője (D20) |
| `not_space_member` | 403 | Dokumentum vagy színtér, amelynek a hívó nem tagja (A10) |
| `space_closed` | 403 | Írás lezárt projekt-térben (D44) |
| `not_found` | 404 | Nem létező erőforrás |
| `request_pending` | 409 | Már van függő kérés (dokumentumon vagy felvételre) |
| `request_closed` | 409 | Döntés egy már lezárt kérésen |
| `not_enough_reviewers` | 409 | A színtérnek háromnál kevesebb tagja van (D43) |
| `last_space_manager` | 409 | Az utolsó Színtérgazda eltávolítása vagy visszaminősítése |
| `last_admin` | 409 | Az utolsó Rendszeradmin visszaminősítése (V12) |
| `owner_handover_required` | 409 | Tulajdonos eltávolítása tulajdonjog-átadás nélkül (V12) |
| `has_approved_revision` | 409 | Piszkozat-eldobás egy már Jóváhagyott dokumentumon |
| `tag_exists` | 409 | Normalizált ütközés; `details.tag` a meglévő |
| `stale_base_revision` | 412 | A `baseRevisionId` nem a legutóbbi Jóváhagyott (A4); `details.currentApprovedRevisionId` |
| `invalid_reviewers` | 422 | Nem két különböző tag, vagy köztük az indítványozó |
| `reason_required` | 422 | Elutasítás indoklás nélkül |
| `export_failed` | 502 | Pandoc-hiba |
| `internal_error` | 500 | Váratlan hiba; a `detail` nem szivárogtat belső részletet |

Megszűnt: `document_locked`, `not_lock_holder`, `category_in_use`, `category_name_taken`, `stale_base_version`.

## 4. Reprezentatív OpenAPI-vázlat

A teljes spec a futó rendszerből generálódik (A8, `/api/docs`). A review-ra küldés a legtöbb kontraktus-elvet érinti:

```yaml
openapi: 3.1.0
info: { title: Táltos API, version: 10.0.0 }
paths:
  /api/v1/documents/{id}/change-requests:
    post:
      summary: Változás review-ra küldése két review-errel (D45)
      parameters:
        - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [kind, reviewerIds]
              properties:
                kind: { type: string, enum: [create, update, metadata, restore, delete] }
                baseRevisionId: { type: [string, "null"], format: uuid, description: "Legutóbbi Jóváhagyott revízió; új dokumentumnál null (A4)" }
                reviewerIds:
                  type: array
                  items: { type: string, format: uuid }
                  minItems: 2
                  maxItems: 2
                  uniqueItems: true
                message: { type: string, maxLength: 2000, description: "Opcionális (D45)" }
                restoreFromRevisionId: { type: string, format: uuid, description: "Csak kind=restore" }
      responses:
        "201":
          description: A kérés létrejött, a dokumentum Review-ra vár
          content:
            application/json:
              schema:
                type: object
                properties:
                  changeRequestId: { type: string, format: uuid }
                  proposedRevisionId: { type: [string, "null"], format: uuid }
                  reviewState: { type: string, const: pending }
        "403": { $ref: "#/components/responses/Problem" }   # forbidden, not_space_member, space_closed
        "409": { $ref: "#/components/responses/Problem" }   # request_pending, not_enough_reviewers
        "412": { $ref: "#/components/responses/Problem" }   # stale_base_revision
        "422": { $ref: "#/components/responses/Problem" }   # invalid_reviewers
components:
  responses:
    Problem:
      description: RFC 9457 Problem Details
      content:
        application/problem+json:
          schema:
            type: object
            required: [title, status, code]
            properties:
              type: { type: string, format: uri }
              title: { type: string }
              status: { type: integer }
              detail: { type: string }
              code: { type: string }
              details: { type: object, additionalProperties: true }
```

## 5. Második ütem

| Terület | Végpontok (vázlat) |
|---|---|
| Többformátumú tartalom (D42) | `POST /api/v1/documents/:id/files` (multipart, 25 MB), `GET …/files/:path`, `GET …/bundle.zip`, formátumonkénti diff a `…/diff` végponton (`format`-függő válasz) |
| Sablon és fájlimport (D47) | `POST /api/v1/documents` `templateId`-vel; `POST /api/v1/imports` (egy `.txt`/`.md`/`.docx`, előnézet) → `POST /api/v1/imports/:id/confirm` |
| Allowlist-felület (D49) | `GET/POST/DELETE /api/v1/admin/allowlist`, `GET /api/v1/admin/inactive-owners` |
| MCP (D38, D49) | Az MCP-szerver ezeket az olvasó végpontokat hívja felhasználóhoz kötött tokennel; csak Jóváhagyott revízió, csak a saját színterek |

## 6. Ami tudatosan NINCS a kontraktusban

- **Közvetlen írás a Jóváhagyott állapotra** (archiválás, metaadat, visszaállítás review nélkül): A11.
- **Bearer token a SPA-ban:** A1. Az MCP-token második ütemben, külön biztonsági döntéssel (D38).
- **Olvasás-naplózás:** a GET-ek nem generálnak eseményt (D18); az MCP-olvasás naplózása nyitott (D38).
- **Külön sablon-erőforrás:** a sablon dokumentum, `template=true` szűrővel (D17, D47).
