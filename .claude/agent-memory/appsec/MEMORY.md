# appsec — projekt-memória (Táltos)

- (2026-11-06, WP5a) A Fastify Ajv `removeAdditional` és `coerceTypes` mellett fut: az `additionalProperties:false` az ismeretlen mezőket csendben eldobja (nem 400). A `format:'uuid'` a nagybetűs és az `urn:uuid:` alakot is elfogadja, ezért a kimenő sztring-azonosítókat (pl. `closeConnections`, a kisbetűs collab-dokumentumnév) kanonizálni kell. Az `urn:uuid:` alak várhatóan 500-at ad (WP4a-szintű, nyitott).
- (2026-11-06, WP5a) Az `events` táblát még semmi nem olvassa; a forrás-oldali `duplicated_from` (`targetDocumentId`, `targetSpaceId`) kitakarása a WP9-ben kötelező (D59 b). Ez a WP9 appsec-review első ellenőrzési pontja.
- (2026-11-06, WP5a) A `POST /tags` két ága a válasz `name`-jén át megkülönböztethető volt; javítva (D59 kiegészítés): nem látható meglévő címkénél a hívó saját írásmódja jön vissza. Az írás/olvasás időzítés-különbsége vállalt.
- (2026-11-06, WP5a) A 403 `not_space_member` színtér-részletei (név, Színtérgazdák) és a nem létező (404) / nem látható (403) különbség az A10 szerint szándékos, nem finding.
- (2026-11-06, WP5a) Postgres nélkül a backend vitest pnpm nélkül is fut: `node node_modules/vitest/vitest.mjs run <útvonal>` az `apps/backend`-ben.
