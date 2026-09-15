# Context for AI-assisted implementation

This repo implements the design documented in `docs/`. The design was
already decided in a separate planning conversation — your job is to
**implement against these specs**, not to re-derive the design. Treat
`docs/schema.md`, `docs/adapter-interface.md`, `docs/error-shape.md`, and
`docs/api-endpoints.md` as the source of truth.

## Before writing code

Read, in this order:
1. `docs/ASSUMPTIONS.md` — what's deliberately out of scope, and why
2. `docs/schema.md` — tables, columns, constraints, rationale
3. `docs/adapter-interface.md` — the `PlatformCommentAdapter` contract
4. `docs/error-shape.md` — `PlatformApiError` and retry classification
5. `docs/api-endpoints.md` — REST surface

## Stack

- TypeScript, Node.js
- NestJS — platform adapters registered as providers (via a DI token
  keyed by platform), resolved through a small registry service; see
  `docs/adapter-interface.md`
- Postgres (with JSONB for raw platform payloads)
- pg-boss for the async reply job queue — do not introduce Redis/BullMQ or
  a cloud queue; this was a deliberate scope decision
- A migration tool of your choice (e.g. `node-pg-migrate` or raw SQL
  migrations) — pick one and note the choice

## Ways of working

- **Issues, not a static list.** `docs/ISSUES.md` is only a seed list for
  bootstrapping the repo. As a first step, convert each entry into a real
  GitHub issue (`gh issue create`), then delete `docs/ISSUES.md`. From that
  point on, all user stories and follow-up/TODO work are tracked as GitHub
  issues — not as a markdown file, and not as inline `// TODO` comments
  left undocumented.
- **Test-driven development.** When picking up an issue, or any task
  involving non-trivial logic, follow red-green-refactor: write a failing
  test first, write the minimum code to make it pass, then refactor with
  the test suite green. Trivial/boilerplate changes (e.g. a migration, a
  config tweak) don't need this ceremony — use judgment, but default to
  TDD for anything with real logic (adapters, sync/staleness logic, the
  worker, error classification, endpoint handlers).
- **Keep documentation in sync with the code.** Before closing an issue,
  check whether it changed something `docs/` describes (schema, the
  adapter interface, error shape, API surface, or an assumption) and
  update the relevant file in the same PR. Docs going stale is treated as
  the issue not being done, not as separate cleanup for later.
- **Commit messages**: a single gitmoji (see https://gitmoji.dev/),
  followed by a plain imperative-sentence subject and body — e.g.
  `✨ Add PlatformCommentAdapter interface and registry`. No Conventional
  Commits-style scope prefixes (`feat:`, `fix:`, `docs:`, etc.), and no
  ticket/issue numbers in the message.
- **`pre-push` git hook**: lint, format check, and run the unit test suite
  before every push, so red builds are caught locally rather than first
  showing up on CI. Set this up as part of the initial project scaffold
  (issue 1), not as an afterthought.

## Implementation priorities

Roughly the order in `docs/ISSUES.md` (once converted to GitHub issues,
per the workflow above):

1. Migrations for the three tables in `docs/schema.md`
2. `PlatformCommentAdapter` interface + registry (see
   `docs/adapter-interface.md` for how this is expressed as NestJS
   providers)
3. **One fully working adapter** (pick one platform, e.g. a mock/fake
   "twitter"-like adapter that simulates the shape of a real API without
   needing real credentials) — do not try to build real integrations for
   every platform. Stub the others with a `NotImplementedAdapter` or similar.
4. `GET /posts/:postId/comments` — including the staleness check against
   `last_synced_at`, triggering a sync via the adapter when stale, returning
   the nested comment tree
5. `POST /comments/:commentId/replies` — creates a `reply_jobs` row
   (respecting `Idempotency-Key`), enqueues via pg-boss, returns 202
6. The pg-boss worker — consumes reply jobs, calls the adapter's
   `postReply`, classifies errors via `PlatformApiError`, updates job status
7. `GET /reply-jobs/:jobId` — status polling endpoint

Each of these should be driven test-first (red-green-refactor), not
implemented and then tested after the fact.

## Things NOT to build

These were explicitly scoped out — see `docs/ASSUMPTIONS.md` for the
reasoning behind each. Do not add them unless asked:

- Comment deletion logic (schema has a `deleted_at` column, but no logic
  detecting or applying deletions)
- A `GET /posts` listing endpoint (post management is assumed to exist
  elsewhere in the product)
- A computed `replyStatus` field (derivable from nested replies instead)
- Webhook-based sync (documented as a future extension only)
- Any frontend/UI code
- A real queue (Redis/BullMQ, SQS, Pub/Sub) — pg-boss only

## When something in the spec seems ambiguous or incomplete

Don't silently guess. Either:
- Check `docs/ASSUMPTIONS.md` first — it may already be addressed, or
- Flag it back rather than picking a default, so it can be added to the
  assumptions list deliberately
