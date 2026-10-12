# SQL scenario checks

`stage1-scenarios.sql` walks the stage 1 dispatch rules end to end, and
`notification-scenarios.sql` the notification outbox, against a real
PostgreSQL server (PGlite does not implement advisory locks and `skip locked` the
way `st_job_command` relies on them, so these scenarios are run against
PostgreSQL 16/17, not in the `node --test` suite).

How to run it:

```sh
# 1. a scratch server with the Supabase stand-ins (auth, storage, roles)
#    then the base schema and every migration in order
psql -d "$DB" -f supabase/hostinger_schema.sql
for f in supabase/migrations/*.sql; do psql -d "$DB" -v ON_ERROR_STOP=1 -f "$f"; done

# 2. the scenarios (seed.sql is included by each script, so use a fresh
#    database per script)
cd tests/sql && psql -d "$DB" -v ON_ERROR_STOP=1 -f stage1-scenarios.sql
#    ... and against a second fresh database:
cd tests/sql && psql -d "$DB2" -v ON_ERROR_STOP=1 -f notification-scenarios.sql
```

`seed.sql` creates synthetic users (admin, two cleaners, owner, property manager,
operations manager) and two properties. No production data, no secrets.

Expected result: 14 numbered sections for stage 1 and 12 for the notifications;
every refusal is printed as a `NOTICE` (`refused: …`) and each script stops on
any unexpected error. The recorded output of the last runs is in
`docs/verification/2026-10-12-stage1.md` and
`docs/verification/2026-10-12-notifications.md`.
