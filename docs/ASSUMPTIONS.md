# Assumptions

The requirements intentionally leave details unspecified. This document
records the assumptions made, and (where useful) why the alternative was
rejected.

It's structured in two parts: **Core design decisions** first (the small
number of high-level calls that shaped the whole system, made at the design
stage before code was written), followed by **Implementation details and
further assumptions**, which expands on those decisions and covers the
lower-level choices, edge cases, and gaps found along the way.

## Core design decisions

- **Backend only.** The brief describes a database schema, API design, and
  REST endpoints, with no mention of UI. Treated as a backend-only
  exercise: no frontend/UI code in this repo. (See "Scope" below for what
  else that excludes.)
- **Adapter pattern for platform support.** Each platform implements a
  common `PlatformCommentAdapter` interface (fetch comments, post a
  reply); the rest of the system (API, database, worker) only ever talks
  to that interface, never to a specific platform's API. Adding a new
  platform means writing one adapter, not touching existing code.
- **NestJS.** Its module/provider/dependency-injection system maps directly
  onto that adapter pattern: each platform adapter is registered as a
  provider, and adapter lookup by platform is Nest's own DI container
  rather than a hand-rolled registry.
- **Postgres, with a JSONB column for raw platform payloads, not a
  document store.** The system has real relational needs (uniqueness
  constraints, foreign keys between posts/comments/replies, atomic job
  status transitions) that a relational database with transactions serves
  better; JSONB covers the one thing a document store would otherwise be
  needed for.
- **Hybrid sync model, not pure live-fetch or a full mirror.** Comments are
  stored locally for fast reads, and refreshed from the platform when
  stale rather than fetched live on every request or treated as a fully
  owned copy. The platform is always the source of truth: a reply is only
  recorded locally once the platform confirms it happened.
- **Replies go through a queue, not a direct call to the platform.**
  `POST /comments/:commentId/replies` enqueues a job and returns
  immediately (`202`); a separate worker calls the platform's API and
  updates the job's status. This keeps a slow, rate-limited, or flaky
  platform API off the request path, and gives retries a natural place to
  live.
- **pg-boss (Postgres-backed) as the queue, not Redis/BullMQ or a cloud
  queue.** Chosen to avoid introducing another piece of infrastructure at
  this system's current scale, and to keep everything on the Postgres
  datastore already in use. Not a permanent architectural choice; a
  production system at real throughput would likely warrant a proper queue
  (Kafka, SQS, Pub/Sub) instead.
- **Webhook-based sync is out of scope**, noted as a future extension.
  Sync is on-demand instead, triggered by reads and gated by a staleness
  check. Not every platform supports webhooks for comment events, so even
  with webhooks added later, this staleness-based fallback would still be
  needed for the platforms that don't; it isn't fully replaced by adding
  webhooks.
- **Comment edits are in scope; deletions are not.** An edited comment is
  picked up and updated in place on the next sync. Deletions are
  explicitly unhandled (the schema has a `deleted_at` column, but nothing
  populates it), since a real deletion/cascade policy needs product input
  this brief doesn't provide, not an engineering default.
- **GoToSocial as the platform used for a real, working integration.**
  Actually integrating with a major platform (X, Instagram, LinkedIn)
  requires OAuth app registration, review processes, and often paid tiers
  just to post a reply. That's not obtainable within this exercise, and
  not really what's being assessed. GoToSocial is a real, self-hosted,
  Mastodon-API-compatible platform that runs locally via Docker, so
  `GoToSocialAdapter` is a genuine working integration against real HTTP
  calls, not a mock, and needs no developer credentials from anyone
  reviewing this repo.

## Implementation details and further assumptions

### Scope

- **Backend only.** `npm run demo:reply` (`scripts/demo-reply-flow.ts`)
  demonstrates the full reply-to-comment flow end to end against real
  GoToSocial data without a frontend: real HTTP calls to the documented
  REST API, not a UI standing in for it.
- **No `GET /posts` listing endpoint.** Post management/scheduling is
  assumed to already exist elsewhere in the product (this is, after all, a
  feature being added to an existing social media scheduling API). Only
  comment-related endpoints are implemented here.
- **No `replyStatus` computed field.** Since comments are returned as a
  nested tree, whether a comment has been replied to is derivable from the
  presence of child comments. An explicit status field was considered but
  not implemented, to avoid solving a problem the brief didn't pose.

### Sync model

- **Staleness threshold: 15 minutes, via `STALENESS_THRESHOLD_MS`.**
  `docs/api-endpoints.md` said reads trigger a sync when
  `last_synced_at` is past "the configured staleness threshold" without
  ever specifying the value or how it's configured. Resolved as an env
  var (read once at module init, not re-read per request) defaulting to
  15 minutes, a reasonable-for-now balance between serving fresh
  comment data and not hitting the adapter on every request. It's an env
  var mainly for local tuning during development, rather than because
  per-environment overrides are expected any time soon.
- **`:postId` on `GET /posts/:postId/comments` is the internal
  `published_posts.id` (UUID), not the platform's own post id.** Not
  stated explicitly in `docs/api-endpoints.md`, but forced by the schema:
  `published_posts` is only unique per `(platform, external_post_id)`, so
  a platform-native id alone (with no platform in the path or as a query
  param) can't uniquely identify a post. Since the wider product's
  post-management system (out of scope here; see "Scope" above) already
  has this internal id from when the post was published, callers are
  expected to have it on hand.
- **Platform is always authoritative for writes.** A reply is posted to the
  platform first; it's only persisted locally (as a `comments` row) once
  the platform confirms. The system never treats a locally-written reply as
  having happened before the platform confirms it.
- **Webhook-based sync is out of scope**, noted as a future extension.
  Implemented sync is on-demand, triggered by reads, using the staleness
  threshold above. Two reasons: not every platform supports webhooks for
  comment events, so an on-demand fallback would be needed regardless of
  how many platforms had webhook support; and receiving/verifying webhooks
  is a meaningfully separate piece of infrastructure (an inbound endpoint,
  signature verification, at-least-once delivery handling) that isn't
  necessary to demonstrate the sync model itself.
- **Comment volume / pagination is hidden inside each adapter.** The
  `PlatformCommentAdapter.fetchComments` method returns the full set of
  comments for a post (or all comments since a given time, for incremental
  sync); pagination mechanics (cursors, tokens, offsets) are an adapter
  implementation detail, not exposed on the interface. If comment volume on
  a single post ever became large enough that fetching synchronously was a
  real latency problem, this would need revisiting (e.g. streaming/paged
  results). Treated as a YAGNI concern for now, not a current requirement.

### Threading

- **Arbitrarily nestable**, via a self-referencing `parent_comment_id` on
  `comments`, rather than a fixed two-level (comment/reply) model. This is
  the more general case and costs nothing extra in the schema. Individual
  platforms' actual threading limits (e.g. some platforms flatten deep
  reply chains to one level) are normalized by the relevant adapter on
  ingestion, not enforced by the schema.

### Storage engine

- **`platform` modeled as a Postgres enum, not a lookup table.** Platforms
  are added by the development team (via deploy/migration), not created by
  end users, so a fixed enum is simpler and gives a constrained type in
  TypeScript for free. If platforms ever became dynamically configurable
  (e.g. for white-label customers), this would need to change to a
  `platforms` table.

### Comment editing and deletion

- **Editing is in scope.** On sync, if an existing comment's body differs
  from the freshly-fetched value, it's updated in place (upsert on
  `(platform, external_comment_id)`) and `updated_at` is bumped. No edit
  history is retained. Included because the blast radius is small: a
  single-field upsert against an existing constraint, no structural
  complexity.
- **`since` means "created or updated since," not just "created since."**
  `CommentsService.getCommentTreeForPost` re-syncs using `since:
  post.lastSyncedAt` (see "Sync model" above), so a filter on creation time
  alone would mean a comment is only ever checked once, in the sync right
  after it's first posted; any edit made after that point would never be
  picked up. An adapter must therefore return a comment if it was *created
  or edited* after `since`, not only if it's newly created (see
  `docs/adapter-interface.md`). `MockTwitterAdapter` demonstrates this via
  a `MockTwitterEditTrigger` sentinel (mirroring
  `MockTwitterFailureTrigger`), since its dataset is otherwise fully
  deterministic/time-independent and has no other way to produce an
  "edited" comment for a test to observe.
- **Real (non-mock) adapters may need more than a `since` filter to fully
  honor the contract above.** It assumes a platform's comment-list API can
  filter or sort by last-modified time. Not every platform's API
  necessarily exposes that (some only expose creation time). An adapter
  for such a platform would need a fallback (most plausibly a periodic
  full re-fetch alongside the cheap incremental one) to actually catch
  edits made on that platform. Flagged here as a real gap for that
  hypothetical adapter, not resolved because no such adapter exists yet in
  this repo (see "Platform integration (real vs. mock)" below).
- **Deletion logic is explicitly out of scope.** The schema includes a
  `deleted_at` column as a soft-delete marker (avoiding foreign-key
  cascade/orphaning issues on the self-referencing `parent_comment_id`),
  but no logic for detecting platform-side deletions, or any policy on what
  happens to child replies of a deleted comment, is implemented. This was
  judged to be a disproportionate amount of design/engineering effort for
  an edge case the brief didn't ask about; a hard-delete or cascade
  strategy would need real product input (e.g. whether replies to a
  deleted comment should remain visible, which varies by platform
  convention) rather than an engineering default.
- **`includeDeleted` query parameter is not implemented**, for the same
  reason, noted here rather than built, since deletion handling itself is
  out of scope.

### Platform integration

- **GoToSocial is the platform this repo integrates with for real; the
  major platforms are not.** Actually posting a reply requires an OAuth
  app plus, on every major platform considered here, a paid API tier or an
  app-review process just to get write access (e.g. paid API access for
  write operations on X/Twitter; Meta App Review for comment permissions
  on Instagram; partner-gated comment endpoints on LinkedIn), none of
  which is obtainable within this exercise, so a genuine write-capable
  integration with any of them isn't actually available regardless of
  effort spent. GoToSocial is a real, self-hosted, Mastodon-API-compatible
  platform with none of that gating, and runs locally via Docker, so
  `GoToSocialAdapter` exercises the `PlatformCommentAdapter` abstraction
  (including the edit-detection contract; see "Comment editing and
  deletion" above) against genuine HTTP calls and genuine platform
  behavior, a real integration, not a mock, without a reviewer needing
  to register their own developer credentials to run this repo. Instagram,
  LinkedIn, and TikTok are stubbed with a `NotImplementedAdapter` (see
  `docs/adapter-interface.md`).
- **A separate mock adapter, `MockTwitterAdapter`, complements it for
  fast, fully deterministic testing.** With no network calls or running
  containers required, it's what most of the adapter-interface unit tests
  run against, including simulated failures and edits, triggered via
  exported sentinel values (`MockTwitterFailureTrigger`,
  `MockTwitterEditTrigger`) rather than randomness or configuration, so
  error-path and edit-detection tests stay deterministic and reproducible.
  `GoToSocialAdapter`'s own unit tests follow the same mocked-HTTP
  approach for the same reason; a separate real-instance smoke test,
  gated behind `GTS_ACCESS_TOKEN` and excluded from CI by default,
  exercises the actual running container end-to-end (see "Testing
  strategy" below).
- A real, unauthenticated **read-only** endpoint (where a platform exposes
  public post data without auth) would be a reasonable future enhancement
  to the `fetchComments` path specifically, but `postReply` would remain
  gated regardless, since the write path is what's gated everywhere on
  every major platform. Not pursued here to keep effort focused on the
  core design.
- **Runs via the main `docker-compose.yml`**, not a separate opt-in file.
  Chosen for visibility: anyone running `docker compose up -d` sees a real
  platform integration available immediately, without an extra step to
  discover it exists. The tradeoff (a second service starting even for
  someone only touching the mock-adapter path) was judged worth it given
  this repo is going to a reviewer, where visibility has more value than
  it would for day-to-day solo development.
- **GoToSocial's own storage: bundled SQLite, not the project's Postgres.**
  Fully decoupled from the system actually being assessed: the
  `published_posts`/`comments`/`reply_jobs` schema above remains the only
  thing living in the project's own Postgres instance. GoToSocial's
  SQLite file lives in its own Docker volume.
- **`docker compose up -d` alone brings up GoToSocial pre-seeded with
  sample posts and comments, from two separate accounts**: no manual step
  needed to have real content to explore. `blotato_seed` (the "business")
  posts, `blotato_commenter` (someone else) comments, and a third account
  (provisioned via `scripts/setup-gotosocial.sh`) replies, mirroring this
  project's actual premise, since replying to your own comments isn't what
  this system is for. Two one-shot Docker services handle it:
  `gotosocial-account-init` creates both accounts, and `gotosocial-seed`
  signs in as each in turn and posts through GoToSocial's real HTTP API.
  Both are idempotent (checked against real API state, not a marker file),
  so repeat `docker compose up` runs don't create duplicates.
- **`gotosocial-seed` threads its session cookie through manually instead
  of using curl's cookie jar.** GoToSocial scopes its session cookie to
  `GTS_HOST` ("localhost", so the human-facing flows below work from the
  host machine), but `gotosocial-seed` talks to the server over the Docker
  network as `gotosocial`, a legitimate host/cookie-domain mismatch that
  curl's jar correctly refuses to send. Extracting `Set-Cookie` and
  resending it via an explicit header sidesteps that without changing
  `GTS_HOST`.
- **Provisioning *our own app's* `GTS_ACCESS_TOKEN` stays a separate,
  deliberately manual one-time step**, distinct from the automatic
  content-seeding above. `scripts/setup-gotosocial.sh` creates its own
  account and prompts a human to open the authorize URL and paste back the
  code, even though the flow is fully scriptable (as `gotosocial-seed`
  proves). The point is a human consciously provisioning the credential
  our own backend authenticates with, not a technical limitation. The
  script also posts one seed status and prints its id, usable as
  `external_post_id` for manually testing against the real adapter.
### Async reply pipeline

- **Retry/backoff policy lives in the queue, not the database.** The
  `reply_jobs` table tracks current status, not attempt counts or backoff
  timing; that's left to pg-boss's own retry mechanics, to avoid
  duplicating retry logic in two places.
- **Idempotency is handled at the API layer, via a client-supplied
  `Idempotency-Key` header**, not by relying solely on the job's own
  primary key. A retried *client request* (e.g. a network blip causing a
  duplicate POST) would otherwise create two separate job rows, each of
  which would proceed to post to the platform. The client-supplied key is
  checked before a job is created, so a duplicate request returns the
  existing job instead of creating a new one.
- **Error classification is the adapter's responsibility; the retry
  decision is the worker's.** Adapters normalize platform-specific errors
  into a common `PlatformApiError` shape (with a `retryable` flag and an
  error `kind`), and the worker acts on that classification. See
  `docs/error-shape.md`.
- **Pinned to `pg-boss@^10`, not the latest major (`12.x`).** From v12
  onward, pg-boss ships ESM-only, which this CommonJS project (Node 20 in
  CI) can't consume without either an ESM migration or a Node bump to 22
  (required by v11), neither of which this feature warrants. v10 is the
  newest version that's still CommonJS and supports Node 20.
- **Retry policy: `retryLimit: 5`, `retryDelay: 5` (seconds),
  `retryBackoff: true`**, set explicitly in `ReplyJobsQueueService` rather
  than left at pg-boss's defaults: five attempts with exponential backoff
  balances riding out a transient blip against hammering a platform that's
  genuinely down. Known gap: a `rate_limited` error's `retryAfterMs` hint
  isn't used to size the retry delay; the worker just rethrows and lets
  the queue's uniform backoff handle it.
### Running multiple backend nodes

- **The design already supports horizontal scaling with no coordination
  code, since all state lives in Postgres rather than in-process.** The
  HTTP layer is stateless, and pg-boss distributes queue jobs across nodes
  safely on its own (`SELECT ... FOR UPDATE SKIP LOCKED`); the
  `Idempotency-Key` handling already prevents two nodes from racing to
  create the same job, and worst case, two nodes double-syncing the same
  post just means one redundant platform fetch, not corrupted data. The
  real limit is connection budget, not correctness: each node opens its
  own Postgres connection pool, so `max_connections` caps how many nodes
  can run concurrently. That's the first thing that would need attention
  (e.g. a pooler like PgBouncer) if node count grew significantly. Not
  addressed here since it isn't a problem at this system's current scale.

### Testing strategy

- **Two tiers: unit tests and integration tests, run separately.** Unit
  tests (`npm run test:unit`, the default `jest`/`test:watch`) cover most
  logic (adapters, services, error classification), fast and in-memory,
  no Docker needed. Repository-layer tests are integration tests instead,
  run via a separate Jest config (`jest.integration.config.js`, `npm run
  test:integration`) against a real Postgres instance (`docker-compose`),
  not a mocked driver: given "plain node-postgres, no ORM," the thing
  being tested (upsert-on-conflict behavior, the recursive-CTE tree fetch)
  lives in the SQL itself, which a mocked `pg` client can't verify. `npm
  test` (used by the `pre-push` hook and CI) runs both.
