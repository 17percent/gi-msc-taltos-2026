-- 0010_default_document_kinds.sql  (D60 NK3, D34 V33)
-- A kilenc alap-fajta (a prototípus korábbi kategóriái) adat-migrációja: a fajta a dokumentum-létrehozás kötelező
-- mezője, ezért élesben se induljon üres `document_kinds` listával. A kulcsok, címkék és a sorrend UGYANAZOK, mint a
-- fejlesztői seedben (src/db/seed-data.ts, KINDS); az egyezést a migrations.test.ts őrzi.
-- Idempotens és nem romboló: `ON CONFLICT (key) DO NOTHING`, nincs UPDATE és nincs törlés. Ha a kulcs már létezik (a
-- Rendszeradmin vette fel, vagy soft delete-tel törölte: `deleted_at`), a sor érintetlen marad, a törölt kulcsot a
-- migráció nem állítja vissza. Eseményt nem ír: rendszer-adat betöltés, nincs emberi aktor (`events_actor_required`,
-- a `kind_created` aktort igényel); a nyomvonal a `drizzle.__drizzle_migrations` bejegyzés.
-- Zár és költség: kilenc soros INSERT a kicsi `document_kinds` táblába; ROW EXCLUSIVE zár, semmit nem blokkol.
-- Visszaállítás (rollback, kézzel, csak a még nem hivatkozott kulcsokra; a `documents.kind` FK RESTRICT miatt a
-- hivatkozott kulcs törlése úgyis hibával elbukna):
--   DELETE FROM document_kinds k WHERE k.key IN ('prompt','skill','guide','template','best_practice',
--     'system_prompt','agent','eval_set','mcp_server') AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.kind = k.key);
INSERT INTO document_kinds (key, label, sort_order) VALUES
    ('prompt', 'Promptok', 0),
    ('skill', 'Skillek', 1),
    ('guide', 'Guide-ok', 2),
    ('template', 'Sablonok', 3),
    ('best_practice', 'Best practice-ek', 4),
    ('system_prompt', 'Rendszerutasítások', 5),
    ('agent', 'Agent-definíciók', 6),
    ('eval_set', 'Kiértékelő készletek', 7),
    ('mcp_server', 'MCP-szerverek', 8)
ON CONFLICT (key) DO NOTHING;
