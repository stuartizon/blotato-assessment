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
CLAUDE.md                 — context file for AI-assisted implementation
```

Implementation is tracked as [GitHub issues](https://github.com/stuartizon/blotato-assessment/issues), not as a markdown file — see `CLAUDE.md` for the ways-of-working this repo follows.

## Setup

Requires Node 20+ (pg-boss's minimum) and Docker (for local Postgres).

```bash
npm install
cp .env.example .env       # defaults already match docker-compose.yml
docker compose up -d       # starts Postgres on localhost:5432
npm run migrate            # creates published_posts, comments, reply_jobs
npm run start:dev          # http://localhost:3000/health
```

`docker compose up -d` also starts a [GoToSocial](https://docs.gotosocial.org)
instance on `localhost:8080`, unconfigured and with no manual steps needed to
reach a running server. It's a real, self-hosted, Mastodon-API-compatible
platform used to exercise `GoToSocialAdapter` against genuine HTTP calls
rather than mocks — see "Real platform integration: GoToSocial" in
`docs/ASSUMPTIONS.md`. Its data (SQLite) lives in its own `gotosocial-data`
Docker volume, fully separate from the project's own Postgres.

### Testing against a real platform (optional)

`scripts/setup-gotosocial.sh` provisions a test account and access token
against the local GoToSocial instance — a one-time step, separate from the
regular setup above:

```bash
docker compose up -d              # make sure GoToSocial is running first
scripts/setup-gotosocial.sh
```

It creates a test account, registers an OAuth app, and then pauses for the
one step that can't be scripted: it prints an authorize URL and that
account's credentials, you open the URL in a browser, sign in, click
"Allow", and paste the resulting code back into the prompt. The script then
exchanges that code for an access token and posts a seed status. It prints:

- an access token to add to `.env` as `GTS_ACCESS_TOKEN`
- the seed status's id, to use as `external_post_id` when creating a test
  `published_posts` row for manual testing against the real adapter

The script is safe to re-run — it reuses the account (and its saved
credentials, in the gitignored `.gotosocial-setup-credentials`) if one
already exists, rather than failing.

Other scripts: `npm test`, `npm run lint`, `npm run format`, `npm run build`.
Migrations use [node-pg-migrate](https://github.com/salsita/node-pg-migrate)
(plain SQL up/down in `migrations/`, matching `docs/schema.md` directly — no
ORM). pg-boss manages its own `pgboss` schema in the same database
automatically on startup — that's separate from `migrations/` and isn't
something `npm run migrate` touches. A `pre-push` git hook (via Husky) runs
lint, format check, and the test suite before every push.

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
