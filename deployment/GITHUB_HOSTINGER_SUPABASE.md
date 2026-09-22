# GitHub → Hostinger + Supabase production deployment

Shine Time uses GitHub as the source of truth.

```text
GitHub main
   |
   +--> Verify (tests/build/package)
   |
   +--> Supabase: migrations -> st-api
   |
   +--> Hostinger: frontend package
```

The production workflow is `.github/workflows/deploy-production.yml`.
It is deliberately gated: nothing is deployed until the repository variable
`PRODUCTION_DEPLOY_ENABLED` is set to `true`.

## 1. GitHub repository variable

Settings → Secrets and variables → Actions → Variables:

```text
PRODUCTION_DEPLOY_ENABLED=true
```

Keep this false/unset while configuring credentials.

## 2. Supabase secrets

Add these repository or production-environment secrets:

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_DB_PASSWORD
SUPABASE_PROJECT_REF
```

`SUPABASE_PROJECT_REF` is the Supabase project reference, not the full URL.

The workflow runs:

```text
supabase db push --project-ref ...
supabase functions deploy st-api --use-api --project-ref ...
```

Migrations are therefore applied before the new API function is deployed.

## 3. Hostinger SSH secrets

Add these production-environment secrets:

```text
HOSTINGER_HOST
HOSTINGER_USER
HOSTINGER_SSH_KEY
HOSTINGER_KNOWN_HOSTS
HOSTINGER_PATH
```

`HOSTINGER_PATH` is the existing Shine Time web root, currently documented as
`/app`. Do not guess this path from a local machine; copy the real absolute path
from the Hostinger server configuration.

`HOSTINGER_KNOWN_HOSTS` must contain the SSH host key line for the server. Do not
use `StrictHostKeyChecking=no`.

The deployment uploads the generated frontend ZIP to the server, extracts it
under `.releases/<commit-sha>`, then copies only the packaged frontend files into
the existing web root. The existing `.htaccess` and unrelated server files are
not part of the package and are preserved.

## 4. First deployment

Do not enable production deployment until:

1. the current Hostinger app has been backed up;
2. the real Hostinger SSH connection has been tested;
3. the production Supabase project is confirmed;
4. the current database has a verified backup/export;
5. the staging journeys have passed;
6. `PRODUCTION_DEPLOY_ENABLED` is still unset/false.

Then set the variable to `true` and run the workflow manually once from
Actions → Deploy production → Run workflow.

## 5. Normal operation

After the first controlled deployment:

```bash
git add .
git commit -m "change"
git push origin main
```

A successful push to `main` automatically runs verification and, when the
production gate is enabled, deploys Supabase followed by Hostinger.

## 6. Rollback

Do not roll back the database by deleting migrations or restoring an old schema
blindly. Database migrations and financial records are forward-only unless an
explicit recovery procedure exists.

For a frontend/API regression, first deploy the previous Git commit. Keep the
new database objects unless the migration has a separately reviewed rollback
procedure.

## 7. Security rules

- Never commit Supabase access tokens, DB passwords or SSH private keys.
- Never put the Supabase service-role key into frontend files.
- `config/supabase.php` may contain public client configuration only.
- Keep the Hostinger SSH host key pinned through `HOSTINGER_KNOWN_HOSTS`.
- Keep production deployment behind the `production` GitHub environment.
- Require CI checks before merging to `main` once the deployment path is proven.
