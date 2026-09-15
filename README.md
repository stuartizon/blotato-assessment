# Comment System — Social Media Scheduling API

A backend service for retrieving comments on published posts and replying to
them, across multiple social platforms, with new platforms addable without
changes to core logic.

## Scope

This repo implements the backend only (REST API, database, background job
worker). There is no frontend/UI in scope — see `docs/ASSUMPTIONS.md`.

## Requirements covered

- Retrieve comments for a published post (with nested replies)
- Reply to a comment (posted to the platform, via an async job)
- Multiple social platforms, via a common adapter interface
- REST API exposing both of the above

## Repo layout

```
docs/
  ASSUMPTIONS.md         — explicit assumptions made where the brief was silent
  schema.md              — database schema + rationale
  adapter-interface.md   — PlatformCommentAdapter contract + CanonicalComment type
  error-shape.md         — PlatformApiError and retry classification
  api-endpoints.md       — REST API surface
  ISSUES.md              — proposed GitHub issues / user stories for implementation
CLAUDE.md                 — context file for AI-assisted implementation
```

## Design at a glance

- **Postgres + JSONB**, not a separate document store — relational integrity
  where we need it (threading, dedup, job status), schemaless flexibility
  where we need it (raw platform payloads).
- **Hybrid sync model** — local data is authoritative for reads within a
  staleness window (`last_synced_at`), platform is always authoritative for
  writes.
- **Adapter pattern** for platform abstraction — one `PlatformCommentAdapter`
  implementation per platform, registered in a small registry. Adding a
  platform means adding one class, not touching the schema, service layer,
  or worker.
- **Async reply pipeline** via pg-boss (Postgres-backed job queue), chosen
  over Redis/BullMQ or a cloud queue to avoid introducing infrastructure
  beyond what this exercise's scale warrants. See `docs/ASSUMPTIONS.md` for
  the full reasoning.

## AI tool usage

This design was developed conversationally (with Claude), working through
tradeoffs — sync model, threading depth, storage engine, queue choice, error
classification — before any code was written. Implementation was then
scaffolded and iterated on with Claude Code against the specs in `docs/`.
See `CLAUDE.md` for how the assistant should use these documents.
