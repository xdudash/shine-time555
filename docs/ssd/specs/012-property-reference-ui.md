# SSD-012: Property recognition photos

Status: Implemented; production rollout through reviewed Pages pipeline.
Date: 2026-09-29. User reprioritized recognition photos and practical fixes.

## Behavior

Existing properties show the first reference photo as their cover. Selecting the photo opens a captioned gallery. Admins, operations managers and owners can upload JPEG/PNG/WebP files up to 5 MiB with captions up to 300 characters. Property managers have read-only access. Assigned cleaners see reference photos inside active jobs. New properties must be saved before photos can be attached.

Loading is lazy with at most three parallel read tasks. Failed reads expose retry. Failed uploads preserve the selected file and caption. Double submission is blocked while uploading. Photo data lives only in the current DOM, not localStorage or persistent browser caches. Async responses are discarded after view/session replacement. RU, SK, UA and EN labels are available.

Navigation closes stale modals. Completed/cancelled cleaner jobs no longer expose enabled checklist and required-proof mutation controls.

## Production contract

Fresh inspection of production st-api version 11 confirmed existing `property-photos.mjs`: GET/POST objects/:id/reference-photos and GET individual photo; assigned active cleaner reads use cleaner/jobs/:id/reference-photos. Server enforces ownership, role, assignment, active status, MIME signatures and size. Private st-property-guides bucket is accessed via service-side authorized routes. This release changes no API, policies or database. First photo is determined by existing ascending id order; cover selection/deletion are not introduced.

## Verification and limits

Production bundle browser test covers authenticated gallery load and upload payload using synthetic HTTP responses. Existing complete browser suite covers five roles, checklists, report media, finance rendering, offline retry, realtime edit protection and mobile viewport. Unit/database suite remains required. Live authenticated customer writes have not been performed; no real customer media is used in tests. Source/backend divergence remains documented in production-pages.md.

## Rollout and rollback

Pages production release 2026-09-29-photos1, same pinned API build 2026-09-07-scale1. Merge only after local and CI validation. Revert frontend commit to roll back; stored reference media remains intact. No migration or destructive action.
