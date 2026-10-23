# secrets/

A Compose secretjei (D13). A mappa tartalma **soha nem kerül a repóba**: a `.gitignore` csak ezt
a README-t engedi. A secret nem kerül image-be, `.env`-be vagy logba; a backend a `*_FILE`
környezeti változón át, fájlból olvassa (`/run/secrets/*`).

| Fájl | Mire | Ki kapja |
|---|---|---|
| `db_password.txt` | a `taltos` DB-felhasználó jelszava | `postgres` (inicializáláskor), `backend` |
| `oidc_client_secret.txt` | az OIDC client secret (fejlesztés: Google, éles: Entra ID) | `backend` |
| `smtp_password.txt` | SMTP-hitelesítés (fejlesztés: Mailpit, éles: céges relay) | `backend` |

Fejlesztői fájlok létrehozása (meglévőt nem ír felül):

```bash
pnpm secrets:init
```

A DB-jelszó véletlen, a másik kettő helyőrző, amíg a WP2 (OIDC) és az e-mail-küldés be nem köti
őket. Éles környezetben a fájlokat az üzemeltetés adja, `0600` jogosultsággal.
