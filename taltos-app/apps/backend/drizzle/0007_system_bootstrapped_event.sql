-- 0007_system_bootstrapped_event.sql  (S16, D52)
-- A rendszerindítás (az első felhasználó Rendszeradmin és az Általános színtér gazdája) egyetlen aktor nélküli
-- rendszeresemény: `system_bootstrapped`. Külön típus, hogy a `system_admin_granted` és a színtér-események továbbra is
-- csak emberi aktorral legyenek írhatók. A rendszer-típusok CHECK-listája ezért bővül (új rendszer-típus = migráció, S16).
-- A 0000 már alkalmazva van, ezért a kényszert eldobjuk és újra felvesszük, a lista egyetlen elemmel hosszabb.
-- Zárak: a DROP és az ADD CONSTRAINT rövid ideig ACCESS EXCLUSIVE zárat kér az `events` táblán (a kérés a futó
-- tranzakciók mögé áll sorba, ezért célszerű alacsony forgalmú időben migrálni). A NOT VALID miatt az ADD nem olvassa végig
-- a táblát, az új sorokra azonnal érvényes; a VALIDATE a meglévőket már csak SHARE UPDATE EXCLUSIVE zár alatt ellenőrzi,
-- ami az írást (INSERT/UPDATE) nem blokkolja.
ALTER TABLE events DROP CONSTRAINT events_actor_required;
ALTER TABLE events ADD CONSTRAINT events_actor_required CHECK (actor_id IS NOT NULL OR type IN (
    'review_due_soon','review_due','review_reminder','review_stalled',
    'allowlist_added','allowlist_removed','user_pseudonymized','retention_purge','system_bootstrapped')) NOT VALID;
ALTER TABLE events VALIDATE CONSTRAINT events_actor_required;
