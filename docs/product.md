# Product brief

## Purpose

Shine Time coordinates cleaning work across properties and people. It should let an admin or manager schedule and assign work, let a cleaner accept and complete permitted jobs with clear instructions, and let an owner see only their own properties and outcomes. This is the target product direction, not a claim that every flow already works.

## Roles and outcomes

| Role | Primary outcome | Authorization requirement |
| --- | --- | --- |
| Admin | Operate the entire platform and resolve exceptions | Explicit administrative permissions |
| Manager | Coordinate authorized properties, cleaners, schedules, issues | Scope to managed portfolio |
| Owner | Track own property and cleaning outcomes | Scope to owned property |
| Cleaner | Find permitted work, accept a job, navigate, report completion and issues | Access only accepted/assigned job details when permitted |

## Core objects to specify

Property, property membership, job, assignment, availability, recurrence, access instruction, photo, issue, completion report, and audit event. Their exact database schema and existing implementation are **unverified** until source and Supabase project are inspected.

## Nonfunctional goals

- Phone-first cleaner workflows; SK/UA/EN content.
- Support 50+ simultaneous users with measured load tests, not a throughput promise.
- Explicit ownership, reliable assignment concurrency, idempotent retries, and auditable state changes.
- Restricted access instructions and photographs with revocation after job access ends.
- Recoverable deployment and small releases with a tested rollback route.

## Scope boundary

This repository currently contains a PHP shell and compiled React bundle. The Supabase Edge Function named in config, database, policies, storage rules, and original React source are not present here. See `architecture.md` and the recovery phase in `roadmap.md`.
