# secrets/

A Compose secretjei (D13). A mappa tartalma **soha nem kerül a repóba**: a `.gitignore` csak ezt
a README-t engedi. A secret nem kerül image-be, `.env`-be vagy logba; a backend a `*_FILE`
környezeti változón át, fájlból olvassa (`/run/secrets/*`).

| Fájl | Mire | Ki kapja |
|---|---|---|
| `db_superuser_password.txt` | a `taltos_admin` Postgres-superuser jelszava (csak a DB-szerver inicializálásához és karbantartásához) | `postgres` |
| `db_migrator_password.txt` | a `taltos_migrator` login-szerepkör jelszava (DDL-jog a `taltos_owner` csoporton át) | `postgres` (az init-szkript hozza létre a szerepkört), `migrate` |
| `db_app_password.txt` | a `taltos_backend` login-szerepkör jelszava (DML a `taltos_app` csoporton át, DELETE csak a D51 j táblákon) | `postgres` (init), `backend`, `seed` (csak fejlesztés) |
| `oidc_client_secret.txt` | az OIDC client secret (fejlesztés: Google, éles: Entra ID) | `backend` |
| `smtp_password.txt` | SMTP-hitelesítés (fejlesztés: Mailpit, éles: céges relay) | `backend` |

A backend soha nem kapja meg a superuser és a migrátor jelszavát; az OIDC- és SMTP-secretet kizárólag a
backend kapja (a DB-szerver csak a saját szerepköreinek jelszavát).

Fejlesztői fájlok létrehozása (meglévőt nem ír felül):

```bash
pnpm secrets:init
```

A három DB-jelszó véletlen, az OIDC- és SMTP-secret helyőrző, amíg a WP2 (OIDC) és az e-mail-küldés be nem köti
őket. A fejlesztői fájlok `0644`-esek: a Compose a fájl-secretet bind-mountként, a host jogosultságával
csatolja, és ugyanazt a fájlt több konténer más-más felhasználóval olvassa (`postgres`: uid 70, a node-konténerek:
uid 1000). `0600` mellett a Postgres init-szkriptje és a `migrate` nem tudja olvasni (D13 pontosítása, 2026-10-23).

**Élesben** a fájlokat az üzemeltetés adja, a világ számára NEM olvashatóan: a tulajdonos root, a csoport egy
olyan gid, amely a fájlt olvasó konténer-felhasználók közös csoportja, a jog `0440` (vagy szolgáltatásonként
külön fájl a konténer uid-jára, `0400`). A host többi felhasználója ne férjen hozzá.

**A DB-jelszavak csak az adatbázis ELSŐ inicializálásakor íródnak a szerepkörökbe** (`db/initdb/10-roles.sh`).
Későbbi jelszócsere: `ALTER ROLE taltos_migrator PASSWORD '…'` (és a secret-fájl cseréje). Egy korábbi (WP0-s)
fejlesztői `pgdata` volume-ot egyszer el kell dobni: `docker compose down -v`.
