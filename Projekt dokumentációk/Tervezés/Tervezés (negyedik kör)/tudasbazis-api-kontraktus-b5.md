# Tudásbázis — API-kontraktus (B5, megvalósítási referencia)

*A döntési napló (6. verzió) D26 pontjának kifejtése. A kontraktus elvi döntései A1–A8-ként tételesen rögzítve — ezek a te jóváhagyásodra várnak, a végpontlista belőlük következik.*

## 1. Kontraktus-szintű döntések (A-pontok)

| # | Döntés | Indoklás / ár |
|---|---|---|
| A1 | **Session: httpOnly cookie + CSRF-védelem** (nem Bearer token a SPA-ban) | Az OIDC code flow-t a backend bonyolítja, a token soha nem jár a böngésző JS-terében (XSS-védelem, a D16 sanitize-réteg mellé második védvonal). Same-origin SPA → `SameSite=Lax` + CSRF-token a mutáló kérésekhez (double-submit). A D5 CSRF-követelménye így teljesül. |
| A2 | **Hibaformátum: RFC 9457 Problem Details** (`application/problem+json`) + stabil `code` mező | Szabványos, a szakdolgozatban hivatkozható; a `code` (gépi hibakód, 3. szakasz) a frontend-elágazások alapja — a `detail` szövege szabadon változhat, a `code` kontraktus. |
| A3 | **Mentés-szemantika: szinkron lokális commit, aszinkron push** | A `PUT .../content` a pg-boss sorosításon átfutó **lokális commitot megvárja** (gyors, ezredmásodpercek) és 200-zal + az új commit hash-sel tér vissza; a push háttérben, retry-jal (D12). A felhasználó valós megerősítést kap, a remote-lemaradás a status-végponton látszik. |
| A4 | **Optimista ellenőrzés a mentésen: `baseCommitHash` kötelező** | A lock (D7) véd, de lejárat utáni „kései mentés" ellen nem — a kliens küldi, melyik verzióra épült a szerkesztés; eltérés esetén **412** + a friss hash. Munkavesztés kizárva a piszkozat-őrzéssel (D7) együtt. |
| A5 | **Lapozás: `limit`/`offset` + `total`** | ~200 fő, pár ezer dokumentum — kurzoros lapozás indokolatlan komplexitás. |
| A6 | **Kommentfolyam: egyetlen `feed` végpont** (kommentek + rendszeresemények szerverin fésülve) | A D9 „rendszerüzenetek az events-ből vetítve" elve a szerveren realizálódik — a kliens egy rendezett folyamot kap `kind: comment | system` elemekkel, nem neki kell két forrást fésülnie. |
| A7 | **Export: szinkron streaming válasz** (pandoc), 30 mp timeouttal | Tudásanyag-méretű dokumentumnál a konverzió másodperces; job+poll infrastruktúra (202-es minta) csak akkor épül, ha a gyakorlat kikényszeríti — a hátrasorolt export-csomagot (D21) nem terheljük előre. |
| A8 | **Code-first kontraktus: Fastify JSON Schema → generált OpenAPI** (`@fastify/swagger`) | A D22-es Fastify sémavezérelt: a validáló séma és a dokumentáció egyetlen forrásból él, nem tud szétcsúszni. Ez a dokumentum az emberi referencia; a gépi OpenAPI a futó rendszerből generálódik (`/api/docs`). URL-verziózás: `/api/v1` prefix. |

## 2. Végpontlista

Minden `/api/v1/*` végpont: allowlist-ellenőrzés kérésenként (D5) → hiánya **403 `not_on_allowlist`**. Mutáló kérések CSRF-token nélkül → **403 `csrf_failed`**.

### Auth és identitás
| Metódus + út | Leírás |
|---|---|
| `GET /auth/login` | Redirect az OIDC szolgáltatóhoz (provider konfig kérdése, D5) |
| `GET /auth/callback` | Code flow lezárása, session-cookie kiadása, user-cache upsert |
| `POST /auth/logout` | Session érvénytelenítése |
| `GET /api/v1/me` | Bejelentkezett felhasználó (név, e-mail, avatar) + CSRF-token |

### Dokumentumok
| Metódus + út | Leírás |
|---|---|
| `GET /api/v1/documents` | Lista + keresés. Query: `q` (FTS + trgm, találati snippettel), `category`, `status`, `favorites=true`, `template=true`, `archived=true`, `limit`, `offset`. Alapértelmezés: élő (nem archivált) dokumentumok. |
| `POST /api/v1/documents` | **„Létrehozás forrásból" (D17):** body `{ title, sourceDocumentId? }` — üres canvas, sablonból vagy duplikálással, egységesen. Új UUID, draft, owner = hívó; forrás esetén tartalom+kategóriák másolódnak, `duplicated_from` esemény. |
| `GET /api/v1/documents/:id` | Metaadat + aktuális tartalom + kategóriák + kedvenc-e + lock-állapot |
| `PATCH /api/v1/documents/:id` | Metaadat: `title`, `status`, `repoPath` (átnevezés), `categoryIds`, `isTemplate` — commit + esemény típusonként |
| `PUT /api/v1/documents/:id/content` | Mentés = commit. Body: `{ content, baseCommitHash }` (A3, A4). Lock-birtoklás kötelező → különben **409 `not_lock_holder`**. |
| `DELETE /api/v1/documents/:id` | Archiválás (soft delete, D8) |
| `POST /api/v1/documents/:id/restore` | Visszaállítás archívumból |
| `GET /api/v1/documents/:id/history` | Commit-lista a lokális clone-ból (lapozva) |
| `GET /api/v1/documents/:id/versions/:hash` | Tartalom adott verzión (`git show`) |
| `GET /api/v1/documents/:id/diff?from=&to=` | Strukturált diff két verzió közt (D21 UI ebből épül) |
| `POST /api/v1/documents/:id/revert` | Body `{ toHash }` — korábbi verzió visszaállítása **új commitként** (a történet nem íródik át) |
| `GET /api/v1/documents/:id/raw` | Nyers .md letöltés (Content-Disposition: attachment) |
| `GET /api/v1/documents/:id/export?format=pdf\|docx` | Pandoc-konverzió, streaming (A7). Hátrasorolt csomag (D21). |

### Lock (D7)
| Metódus + út | Leírás |
|---|---|
| `POST /api/v1/documents/:id/lock` | Megszerzés (`INSERT ... ON CONFLICT`, S7) — foglaltnál **409 `document_locked`** + a birtokos adatai |
| `PUT /api/v1/documents/:id/lock` | Heartbeat (30–60 mp-enként) |
| `DELETE /api/v1/documents/:id/lock` | Elengedés (szerkesztő bezárása) |

### Kommentfolyam (A6, D20)
| Metódus + út | Leírás |
|---|---|
| `GET /api/v1/documents/:id/feed` | Egyesített folyam: `{ kind: "comment" | "system", ... }`; törölt komment placeholderként (D20) |
| `POST /api/v1/documents/:id/comments` | Új komment |
| `PATCH /api/v1/comments/:id` | Szerkesztés — csak a szerző; `comment_edited` esemény őrzi a régi tartalmat |
| `DELETE /api/v1/comments/:id` | Soft delete — csak a szerző; placeholder marad |

### Kategóriák (D19)
| Metódus + út | Leírás |
|---|---|
| `GET /api/v1/categories` | Lista dokumentum-darabszámmal (a törölhetőség a felületen ebből látszik) |
| `POST /api/v1/categories` | Létrehozás (bárki) — névütközésnél **409 `category_name_taken`** |
| `PATCH /api/v1/categories/:id` | Átnevezés/leírás — használatban lévőnél **409 `category_in_use`** |
| `DELETE /api/v1/categories/:id` | Soft delete — használatban lévőnél **409 `category_in_use`** |

### Kedvencek (D18)
| Metódus + út | Leírás |
|---|---|
| `PUT /api/v1/documents/:id/favorite` | Megjelölés (idempotens) |
| `DELETE /api/v1/documents/:id/favorite` | Levétel (idempotens) |

### Audit és üzemeltetés
| Metódus + út | Leírás |
|---|---|
| `GET /api/v1/events` | Globális audit-nézet (szűrők: `documentId`, `type`, `actorId`, időablak; lapozva) |
| `GET /api/v1/status` | Rendszerállapot: push-lemaradás commitban (D12 monitoring), utolsó sikeres push, index-konzisztencia utolsó ellenőrzése (D4) |
| `POST /api/v1/admin/reindex` | Teljes reindex indítása (D4); eseményt naplóz |
| `GET /healthz` | Liveness (auth nélkül, LB/Compose healthcheckhez) |

## 3. Hibaformátum és hibakód-katalógus

Minden hiba `application/problem+json` (A2):

```json
{
  "type": "https://tudasbazis.example/errors/document-locked",
  "title": "A dokumentum zárolva van",
  "status": 409,
  "detail": "A dokumentumot Kiss Anna szerkeszti 2026-07-16 14:02 óta.",
  "code": "document_locked",
  "details": { "lockedBy": { "id": "…", "displayName": "Kiss Anna" }, "acquiredAt": "…" }
}
```

| `code` | HTTP | Mikor |
|---|---|---|
| `validation_error` | 400 | Sémasértő kérés (Fastify JSON Schema, A8); `details.errors` mezőnként |
| `unauthenticated` | 401 | Nincs/lejárt session |
| `not_on_allowlist` | 403 | Bejelentkezett, de az allowlisten nem szereplő felhasználó (D5) |
| `csrf_failed` | 403 | Hiányzó/érvénytelen CSRF-token mutáló kérésen (A1) |
| `forbidden` | 403 | Nem a szerző módosítana kommentet (D20) |
| `not_found` | 404 | Nem létező erőforrás (a soft-törölt dokumentum NEM 404: archívumból elérhető) |
| `document_locked` / `not_lock_holder` | 409 | Lock-ütközések (D7) |
| `category_in_use` / `category_name_taken` | 409 | Kategória-védőszabályok (D19) |
| `stale_base_version` | 412 | A `baseCommitHash` nem a HEAD (A4); `details.currentHash` a friss állapot |
| `export_failed` | 502 | Pandoc-hiba (A7) |
| `internal_error` | 500 | Váratlan hiba — a `detail` nem szivárogtat belső részletet |

## 4. Reprezentatív OpenAPI-vázlat

A teljes spec a futó rendszerből generálódik (A8, `/api/docs`); az alábbi részlet a stílust rögzíti — a mentés-végpont a legtöbb kontraktus-elvet érinti:

```yaml
openapi: 3.1.0
info: { title: Tudásbázis API, version: 1.0.0 }
paths:
  /api/v1/documents/{id}/content:
    put:
      summary: Dokumentum mentése (= commit a worker queue-n át)
      parameters:
        - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [content, baseCommitHash]
              properties:
                content: { type: string, description: "Teljes .md tartalom, frontmatterrel" }
                baseCommitHash: { type: string, description: "A szerkesztés kiinduló verziója (A4)" }
      responses:
        "200":
          description: Lokális commit kész; push aszinkron (A3)
          content:
            application/json:
              schema:
                type: object
                properties:
                  commitHash: { type: string }
                  iteration: { type: integer }
        "409": { $ref: "#/components/responses/Problem" }   # not_lock_holder
        "412": { $ref: "#/components/responses/Problem" }   # stale_base_version
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

## 5. Ami tudatosan NINCS a kontraktusban

- **Jogosultsági szerepek** — D6: minden allowlistes felhasználó minden végpontot elér (kivétel: komment-szerkesztés/törlés szerzőhöz kötése, D20). Az `/admin/reindex` sem szerepkörhöz kötött — az esemény-naplózás a védvonal.
- **Websocket/SSE** — a lock-állapot és a feed frissítése MVP-ben polling; valós idejű csatorna csak mért igény esetén (scope-fegyelem, D21).
- **Külön sablon-erőforrás** — D17: a sablon dokumentum, `template=true` szűrővel érhető el.
- **Olvasás-naplózás** — D6 vállalt korlátja: GET-ek nem generálnak eseményt.
