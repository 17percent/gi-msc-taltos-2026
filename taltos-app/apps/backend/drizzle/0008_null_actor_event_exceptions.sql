-- 0008_null_actor_event_exceptions.sql  (D55, D56)
-- Két szűk, aktor nélküli kivétel az `events_actor_required` CHECK-ben (a rendszer-típusok listája változatlan):
--   1. `review_withdrawn`, de csak `details.reason = 'space_closed'` esetén: a projekt-tér lezárása (D55) a függő
--      review-kéréseket rendszerként vonja vissza. A `member_removed` okú visszavonásnak van aktora (az eltávolító),
--      ezért nem tartozik ide.
--   2. `reviewer_removed`, de csak `details.reason = 'allowlist_removed'` esetén: az allowlist-szinkron (rendszerfolyamat)
--      az allowlistről levett, függő review-er helyét is megszünteti (D51b, D56).
-- A kivétel a (típus, ok) PÁRRA vonatkozik, nem a típusra: minden más `review_withdrawn` / `reviewer_removed` aktort kér.
-- NULL-biztonság: a `details->>'reason'` hiányzó `details` vagy hiányzó `reason` esetén NULL, és a CHECK a NULL
-- eredményt elfogadja (csak a FALSE-t utasítja el). A puszta `type = 'x' AND details->>'reason' = 'y'` ezért egy
-- ok nélküli, aktor nélküli eseményt átengedne; a COALESCE a hiányzó okot FALSE-ra fordítja.
-- A 0007 már alkalmazva van, ezért a kényszert eldobjuk és újra felvesszük.
-- Zárak és költség: a DROP és az ADD CONSTRAINT rövid ideig ACCESS EXCLUSIVE zárat kér az `events` táblán (a kérés a futó
-- tranzakciók mögé áll sorba, ezért célszerű alacsony forgalmú időben migrálni). A NOT VALID miatt az ADD nem olvassa végig
-- a táblát (O(1)), az új sorokra azonnal érvényes; a VALIDATE a meglévőket már csak SHARE UPDATE EXCLUSIVE zár alatt
-- ellenőrzi, ami az írást (INSERT/UPDATE) nem blokkolja. A VALIDATE egyetlen szekvenciális olvasás az `events` táblán
-- (sorokénként néhány egyszerű összehasonlítás; a feltétel a meglévő sorokra eleve igaz, mert a bővítés csak enged),
-- nincs sorírás, nincs index- vagy táblaújraépítés, a plusz tárhely nulla.
-- Visszaállítás (rollback): ugyanez a DROP + ADD a 0007-es szöveggel; csak akkor fut le, ha nincs még NULL aktorú
-- `review_withdrawn` / `reviewer_removed` sor (az `events` append-only, a sor nem törölhető), különben a VALIDATE elbukik.
ALTER TABLE events DROP CONSTRAINT events_actor_required;
ALTER TABLE events ADD CONSTRAINT events_actor_required CHECK (actor_id IS NOT NULL OR type IN (
    'review_due_soon','review_due','review_reminder','review_stalled',
    'allowlist_added','allowlist_removed','user_pseudonymized','retention_purge','system_bootstrapped')
    OR (type = 'review_withdrawn' AND COALESCE(details->>'reason', '') = 'space_closed')
    OR (type = 'reviewer_removed' AND COALESCE(details->>'reason', '') = 'allowlist_removed')) NOT VALID;
ALTER TABLE events VALIDATE CONSTRAINT events_actor_required;
