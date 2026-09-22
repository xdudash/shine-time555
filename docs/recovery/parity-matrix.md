# Initial source vs recovered archive comparison

**Source:** `xdudash/shine-time` commit `3dc3ecd21661f86ac0d4c834b860617bc9d34a9b` (imported into this repository).
**Archive:** baseline commit `5862510c21ee2dd18d21d17ef37809b62bec1ade` from `Shine_Time_audit_update.zip`.

| Path | Byte comparison | Interpretation |
| --- | --- | --- |
| `.htaccess` | Identical at import; repository hardening may extend it | Shared server rule baseline |
| `config/supabase.php` | Identical at import | Same public project configuration in these artifacts |
| `index.php` | Different (4,388-byte source vs 1,414-byte archive) | Different shell and asset loading; no implicit parity |
| `assets/platform.js` | Only in archive | Compiled React UI, not produced by imported build |
| `assets/platform.css` | Only in archive | Styles paired with archived UI |
| `assets/app.js`, other modules, st-api, migrations, tests | Only in source | Fuller operational source; may have different UI contract |

The archive and source represent two UI variants. Imported source has a later commit date, but that alone does not prove the archived UI's features are present. Production frontend/version has not been verified. Before deploying either variant: compare roles and journeys, API endpoints, login/assignment/photos/maps, and compatibility with currently deployed `st-api`; obtain a current Hostinger artifact hash and run staging acceptance. No archive file is copied into the source's active deployment path.
