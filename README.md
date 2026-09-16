# Comment System — Social Media Scheduling API

## What this is

A backend for viewing and replying to comments on social media posts —
across multiple platforms (X, Instagram, GoToSocial, etc.) through one
consistent REST API, so a client doesn't need separate logic per platform.
It's the kind of feature that would sit behind a social media scheduling
product, letting a business manage engagement on its published posts
without visiting each platform directly.

This was done as a take-home exercise. See [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md)
for the assumptions made where the brief was silent, and `docs/` for the
full design write-up (schema, adapter contract, error shape, API surface).

## Approach, in brief

- **Adapter pattern.** Each platform gets one class implementing a common
  `PlatformCommentAdapter` interface (fetch comments, post a reply). The
  rest of the system — API, database, job worker — only ever talks to that
  interface, never to a specific platform's API. Adding a platform means
  writing one adapter, not changing existing code.
- **Hybrid data model.** Comments are stored locally, not fetched live on
  every request — fine for an occasional check, too slow if this were
  powering an internal dashboard hitting it constantly. Local data is
  served for reads and refreshed from the platform when it goes stale; the
  platform itself is still treated as the source of truth, never the
  database.
- **Async replies.** Posting a reply doesn't call the platform inline from
  the request — it queues a job and returns immediately, then a worker
  posts it and tracks the outcome. Platform APIs can be slow, rate-limited,
  or flaky, and this keeps that off the request path and gives retries
  somewhere to live. Runs on pg-boss (Postgres-backed) rather than a real
  queue like Kafka or SQS/Pub/Sub — right-sized for this system's current
  scale, not a permanent choice; a production system at real throughput
  would likely warrant one of those instead.

## Demo platform: GoToSocial

Real integrations with the likes of X, Instagram, or LinkedIn need OAuth
app registration, approval processes, and often webhook setup — not
something reasonable to stand up for a take-home. Instead, this repo
integrates against [GoToSocial](https://docs.gotosocial.org), a real,
self-hosted, Mastodon-API-compatible platform that runs locally in Docker.
It's exercised with genuine HTTP calls, not mocks, so the adapter is a real
working integration — just against a platform anyone can run on their
laptop instead of one requiring app-store credentials.

## Quick start

Requires Node 20+ and Docker.

```bash
npm install
cp .env.example .env         # defaults already match docker-compose.yml
docker compose up -d         # starts Postgres, and GoToSocial pre-seeded with posts/comments
npm run migrate              # creates published_posts, comments, reply_jobs
npm run start:dev            # starts the API on http://localhost:3000
```

Open [http://localhost:8080/@blotato_seed](http://localhost:8080/@blotato_seed)
to see the seeded posts and comments in GoToSocial's own web UI before
going further.

Then, to see the reply flow work end to end through the real REST API:

```bash
scripts/setup-gotosocial.sh   # one-time: provisions the app's own account + access token
                               # → add the printed GTS_ACCESS_TOKEN to .env, then restart start:dev
npm run demo:reply            # replies to every seeded comment via the API
```

Refresh [http://localhost:8080/@blotato_seed](http://localhost:8080/@blotato_seed) —
the replies are now live on GoToSocial, posted by the app's account through
`POST /comments/:commentId/replies`, the pg-boss worker, and
`GoToSocialAdapter.postReply`. The demo is safe to re-run; it skips
anything already replied to.

## Repo layout

```
src/
  comments/      — GET /posts/:postId/comments, platform adapters, sync logic
  reply-jobs/    — POST /comments/:commentId/replies, GET /reply-jobs/:jobId, the worker
  queue/         — pg-boss setup
  database/      — Postgres connection pool
migrations/      — node-pg-migrate migrations (see docs/schema.md)
scripts/         — GoToSocial setup + demo-reply-flow.ts
docs/            — design docs, listed below
CLAUDE.md        — context file for AI-assisted implementation
```

- [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md) — assumptions made where the
  brief was silent; start here
- [docs/schema.md](docs/schema.md) — database schema + rationale
- [docs/adapter-interface.md](docs/adapter-interface.md) — `PlatformCommentAdapter`
  contract + `CanonicalComment` type
- [docs/error-shape.md](docs/error-shape.md) — `PlatformApiError` and retry
  classification
- [docs/api-endpoints.md](docs/api-endpoints.md) — REST API surface

## AI tool usage

This design was developed conversationally (with Claude), working through
tradeoffs — sync model, threading depth, storage engine, queue choice, error
classification — before any code was written. Implementation was then
scaffolded and iterated on with Claude Code against the specs in `docs/`.
See `CLAUDE.md` for how the assistant should use these documents.
