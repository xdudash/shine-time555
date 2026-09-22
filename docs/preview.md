# Auto-updating platform preview

The GitHub Pages preview is a **visual and interaction preview of the actual frontend source**. It is generated from `index.php` script order, editable `assets/` modules, and the normal `npm run build` output. It is not the older `preview-demo.js` mockup.

## Update path

1. Merge or push a commit to `main`.
2. The `Verify cleaning platform` workflow checks build, tests, PostgreSQL concurrency, and benchmark.
3. On success, `Live platform preview` checks out that exact commit and publishes `https://xdudash.github.io/shine-time555/`.
4. The banner shows the deployed commit prefix. Reload the page after a new workflow completes.

The preview uses fictional jobs, objects, users, and roles, including Bratislava and Prague examples. Switch roles in the banner above the application. Core read-only screens for the administrator, operations manager, cleaner, owner, and property manager have synthetic responses; actions that modify data show an explicit unavailable message. The redundant Operations pulse widget is omitted from this preview. There is no production Supabase URL or publishable key in the published preview, and the live API client is not included. Do not use this preview as proof that backend changes or production integrations work.

## Enablement and troubleshooting

Repository Settings → Pages must use **GitHub Actions** as publishing source. The workflow attempts to configure Pages on the first run. A successful `Verify cleaning platform` run for a push to this repository's `main` is the only publication trigger. If first-time enablement fails, select GitHub Actions in Settings → Pages and rerun the verification workflow for the latest push. The preview checks all published text assets for production configuration before deployment. The workflow's environment is `github-pages`; it may require approval if environment protection is configured.

For an actual end-to-end staging app, use a separate Supabase staging environment and private hosting with real Auth, Storage, and migrations. Production currently has migration/function changes absent from this source, so it must not serve as a preview backend.
