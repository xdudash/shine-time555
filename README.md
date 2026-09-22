# Shine Time platform

Deployable snapshot of the Shine Time cleaning operations interface, recovered from `Shine_Time_audit_update.zip` (14 September 2026).

This repository is the starting point for incremental development. Read [product goals](docs/product.md), [current architecture](docs/architecture.md), [roadmap](docs/roadmap.md), [SSD workflow](docs/ssd/README.md), and [agent rules](AGENTS.md) before changing behavior.

## Contents

- `index.php`: PHP entry point, HTML shell, and browser configuration.
- `config/supabase.php`: Supabase project URL and publishable browser key; no service-role key.
- `assets/platform.js`: compiled React application bundle. Source modules and build configuration were not included in the recovered archive.
- `assets/platform.css`: application styling.
- `.htaccess`: Apache routing rules.

## Deployment

Upload the complete contents to the web server's `/app` directory. Serve with PHP and Apache configured to honor `.htaccess`. The client depends on the configured Supabase project and its `st-api` Edge Function. Review RLS and function authorization in the Supabase project before production use.

## Maintenance

The JavaScript file is a generated bundle; the original component source is unavailable in this snapshot. Do not edit the bundle as though it were source code. Restore the original source project if continued feature development is needed.

## Verification

`node --check assets/platform.js` validates bundle syntax. PHP syntax checking requires PHP CLI (`php -l index.php` and `php -l config/supabase.php`). Full application testing requires a configured Supabase environment and test users for each role.
