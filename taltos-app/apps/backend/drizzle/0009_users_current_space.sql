-- 0009_users_current_space.sql  (D57)
-- A színtérváltó utolsó választása szerveroldalon: `users.current_space_id` (PUT /api/v1/me/current-space, GET /me).
-- Nullable, FK NÉLKÜL (D57): a tárolt érték elavulhat (kikerült tag, törölt színtér), a GET /me ilyenkor tartalékot ad
-- (az Általános, majd az első saját tér, majd null), és az olvasáskor érvényesít, nem a séma.
-- Zár és költség: az `ADD COLUMN` nullable, alapérték nélküli oszlopra csak katalógus-módosítás (O(1), nincs
-- táblaújraírás, nincs sorírás); rövid ideig ACCESS EXCLUSIVE zárat kér a `users` táblán (a futó tranzakciók mögé áll
-- sorba, de a tábla kicsi, és a zár a parancs végén azonnal elengedődik). Index nincs: az oszlopot csak a saját sor
-- olvasásakor (PK-keresés) használjuk. Plusz tárhely: legfeljebb 16 bájt a beállított soronként, NULL esetén egy bit.
-- Visszaállítás (rollback): ALTER TABLE users DROP COLUMN current_space_id; (csak a privát beállítás vész el).
ALTER TABLE users ADD COLUMN current_space_id uuid;
