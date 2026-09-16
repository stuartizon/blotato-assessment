# Assumptions

The requirements intentionally leave details unspecified. This document
records the assumptions made, and — where useful — why the alternative was
rejected.

## Scope

- **Backend only.** The brief references a database schema, API design,
  and REST endpoints, with no mention of UI, components, or rendering.
  Treated as a backend-only exercise; no frontend/UI work is in scope.
- **No `GET /posts` listing endpoint.** Post management/scheduling is
  assumed to already exist elsewhere in the product (this is, after all, a
  feature being added to an existing social media scheduling API). Only
  comment-related endpoints are implemented here.
- **No `replyStatus` computed field.** Since comments are returned as a
  nested tree, whether a comment has been replied to is derivable from the
  presence of child comments. An explicit status field was considered but
  not implemented, to avoid solving a problem the brief didn't pose.

## Sync model

- **Hybrid, not pure live-fetch or pure full-mirror.** Comments are stored
  locally for fast, platform-agnostic reads, but the local store is treated
  as a bounded-staleness cache, not a guaranteed-complete mirror.
  `published_posts.last_synced_at` drives whether a read triggers a fresh
  fetch from the platform before serving from the database.
- **Staleness threshold: 15 minutes, via `STALENESS_THRESHOLD_MS`.**
  `docs/api-endpoints.md` said reads trigger a sync when
  `last_synced_at` is past "the configured staleness threshold" without
  ever specifying the value or how it's configured. Resolved as an env
  var (read once at module init, not re-read per request) defaulting to
  15 minutes — a reasonable-for-now balance between serving fresh
  comment data and not hitting the adapter on every request, made an env
  var mainly for local tuning during development rather than because
  per-environment overrides are expected any time soon.
- **`:postId` on `GET /posts/:postId/comments` is the internal
  `published_posts.id` (UUID), not the platform's own post id.** Not
  stated explicitly in `docs/api-endpoints.md`, but forced by the schema:
  `published_posts` is only unique per `(platform, external_post_id)`, so
  a platform-native id alone (with no platform in the path or as a query
  param) can't uniquely identify a post. Since the wider product's
  post-management system (out of scope here — see "No `GET /posts`
  listing endpoint" above) already has this internal id from when the
  post was published, callers are expected to have it on hand.
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
  results) — treated as a YAGNI concern for now, not a current requirement.

## Threading

- **Arbitrarily nestable**, via a self-referencing `parent_comment_id` on
  `comments`, rather than a fixed two-level (comment/reply) model. This is
  the more general case and costs nothing extra in the schema. Individual
  platforms' actual threading limits (e.g. some platforms flatten deep
  reply chains to one level) are normalized by the relevant adapter on
  ingestion, not enforced by the schema.

## Storage engine

- **Postgres with a JSONB column for raw platform payloads**, not a
  document store (e.g. MongoDB). The system has real relational integrity
  needs — uniqueness on `(platform, external_comment_id)`, foreign keys
  from replies to parents and posts, atomic status transitions on reply
  jobs — that are better served by a relational database with
  transactions. The one thing a document store is particularly good at
  here (storing arbitrary, evolving per-platform payloads) is covered by
  the JSONB column, without needing a second datastore.
- **`platform` modeled as a Postgres enum, not a lookup table.** Platforms
  are added by the development team (via deploy/migration), not created by
  end users, so a fixed enum is simpler and gives a constrained type in
  TypeScript for free. If platforms ever became dynamically configurable
  (e.g. for white-label customers), this would need to change to a
  `platforms` table.

## Comment editing and deletion

- **Editing is in scope.** On sync, if an existing comment's body differs
  from the freshly-fetched value, it's updated in place (upsert on
  `(platform, external_comment_id)`) and `updated_at` is bumped. No edit
  history is retained. Included because the blast radius is small — a
  single-field upsert against an existing constraint, no structural
  complexity.
- **`since` means "created or updated since," not just "created since."**
  A code-review pass found that `CommentsService.getCommentTreeForPost`
  always calls `fetchComments` with `since: post.lastSyncedAt` on every
  re-sync (see "Hybrid, not pure live-fetch..." above), while
  `MockTwitterAdapter` originally filtered `since` purely on `postedAt`.
  Concretely: a comment is fetched once, in the sync cycle right after
  it's posted; the next sync's `since` moves past that comment's
  `postedAt` and it's never asked about again — so however many times it's
  edited on the platform afterward, this system never re-fetches it to
  notice. The upsert-on-edit SQL above was correct but practically
  unreachable, and this tension wasn't previously called out anywhere,
  unlike other known gaps in this document.
  Fixed by redefining `since`'s contract (see `docs/adapter-interface.md`):
  an adapter must return a comment if it was *created or edited* after
  `since`, not only if it's newly created. This keeps `CommentsService`
  and the schema untouched — the fix is entirely the adapter's
  responsibility, consistent with the adapter interface's existing
  "adapters own pagination/threading normalization" division of labor.
  `MockTwitterAdapter` demonstrates this via a `MockTwitterEditTrigger`
  sentinel (mirroring `MockTwitterFailureTrigger`), since its dataset is
  otherwise fully deterministic/time-independent and has no other way to
  produce an "edited" comment for a test to observe.
- **Real (non-mock) adapters may need more than a `since` filter to fully
  honor the contract above.** It assumes a platform's comment-list API can
  filter or sort by last-modified time. Not every platform's API
  necessarily exposes that (some only expose creation time). An adapter
  for such a platform would need a fallback — most plausibly a periodic
  full re-fetch alongside the cheap incremental one — to actually catch
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
  reason — noted here rather than built, since deletion handling itself is
  out of scope.

## Platform integration (real vs. mock)

- **Implemented against a mock adapter, not real platform APIs.** This was
  a deliberate choice, not an oversight, for two reasons:
  - **Practical availability.** Posting a reply is gated behind paid
    tiers or app-review processes on every major platform considered here
    (e.g. paid API access for write operations on X/Twitter; Meta App
    Review for comment permissions on Instagram; partner-gated comment
    endpoints on LinkedIn). None of these are obtainable within a
    take-home timeframe, so a "real" integration for the write path
    (`postReply`) isn't actually available regardless of effort spent.
  - **Signal.** The brief frames this as an exercise in reasoning and
    design judgment ("the requirements intentionally leave some details
    unspecified," "evaluating your reasoning and engineering decisions"),
    not working OAuth/app-review flows. A mock adapter that faithfully
    simulates a real platform's shape (pagination style, auth header,
    error responses) exercises the `PlatformCommentAdapter` abstraction
    just as thoroughly as a real integration would, and is actually more
    reviewable — a cloned repo works out of the box, with no reviewer
    needing to register their own developer app/credentials to run it.
  - A real, unauthenticated **read-only** endpoint (where a platform
    exposes public post data without auth) would be a reasonable future
    enhancement to the `fetchComments` path specifically, but `postReply`
    would remain mocked regardless, since the write path is what's gated
    everywhere. Not pursued here to keep effort focused on the core
    design.
- **Simulated failures are triggered via sentinel IDs, not randomness or
  configuration.** `MockTwitterAdapter` returns deterministic seeded data
  for normal calls, but a small set of exported sentinel values
  (`MockTwitterFailureTrigger`, e.g. passed as `externalPostId` to
  `fetchComments` or `externalParentCommentId` to `postReply`) make it
  throw a specific, correctly-classified `PlatformApiError` instead. This
  keeps error-path tests (and manual exercising of the worker's
  retry/give-up logic in issue 6) deterministic and inspectable, without
  needing a config flag or random fault injection that would make test
  failures flaky or hard to reproduce. Other platforms' adapters are free
  to use a different mechanism if one better fits their simulated shape —
  this isn't part of the `PlatformCommentAdapter` contract.

## Real platform integration: GoToSocial

- **Why GoToSocial.** The mock adapter satisfies the brief and is what the
  core design was validated against, but a real, self-hosted, Mastodon-API-
  compatible instance lets the `PlatformCommentAdapter` abstraction (and
  the edit-detection fix — see "Sync model" above) be demonstrated against
  genuine HTTP calls and genuine platform behavior, not just simulated
  data, without the paid-tier/app-review blockers that rule out
  X/Twitter, Instagram, or LinkedIn. This extends the "Platform
  integration (real vs. mock)" reasoning above rather than replacing it —
  `postReply` on every other platform remains mocked or unimplemented for
  the same reasons already given there.
- **Runs via the main `docker-compose.yml`**, not a separate opt-in file.
  Chosen for visibility: anyone running `docker compose up -d` sees a real
  platform integration available immediately, without an extra step to
  discover it exists. The tradeoff — a second service starting even for
  someone only touching the mock-adapter path — was judged worth it given
  this repo is going to a reviewer, where visibility has more value than
  it would for day-to-day solo development.
- **GoToSocial's own storage: bundled SQLite, not the project's Postgres.**
  Fully decoupled from the system actually being assessed — the
  `published_posts`/`comments`/`reply_jobs` schema above remains the only
  thing living in the project's own Postgres instance. GoToSocial's
  SQLite file lives in its own Docker volume.
- **`docker compose up -d` alone brings up GoToSocial pre-seeded with
  sample posts and comments** — no manual step needed to have real content
  to explore. Two one-shot services handle it:
  `gotosocial-account-init` (same image + storage volume as `gotosocial`,
  runs `admin account create` for a seed account, tolerating "already
  exists" on repeat runs) and `gotosocial-seed` (a small `curlimages/curl`
  container that posts a few sample statuses/replies through GoToSocial's
  real HTTP API as that account). This corrects an earlier version of this
  document, which assumed GoToSocial's OAuth flow "requires opening an
  authorize URL in a browser" and "there's no way to fully script this" —
  in fact the whole flow (sign in, authorize, exchange) is just a sequence
  of HTTP requests a browser happens to make; scripting it with `curl`
  works fine and needs no browser automation or bypassed consent step, it
  just hadn't been tried. `gotosocial-seed` is idempotent by checking the
  seed account's own `statuses_count` via the API (not a marker file —
  `curlimages/curl`'s default user doesn't own the `gotosocial-data`
  volume, which is fine since checking real state is more robust than a
  side-channel marker anyway), so repeat `docker compose up` runs don't
  pile up duplicate posts.
- **`gotosocial-seed` threads its session cookie through manually instead
  of using curl's cookie jar.** GoToSocial scopes its session cookie to
  `GTS_HOST` ("localhost", so the human-facing flows below work from the
  host machine), but `gotosocial-seed` talks to the server over the Docker
  network as `gotosocial` — a legitimate host/cookie-domain mismatch that
  curl's jar correctly refuses to send. Extracting `Set-Cookie` and
  resending it via an explicit header sidesteps that without changing
  `GTS_HOST`.
- **Provisioning *our own app's* `GTS_ACCESS_TOKEN` stays a separate,
  deliberately manual one-time step**, distinct from the automatic
  content-seeding above — `scripts/setup-gotosocial.sh` still creates its
  own account and prompts a human to open the authorize URL and paste back
  the code. Now that the OAuth flow is known to be fully scriptable (see
  above), this is a choice, not a technical constraint: a human
  consciously provisioning the credential our own backend will actually
  authenticate with is worth keeping deliberate, even though
  `gotosocial-seed` proves the same flow could be automated end-to-end.
  `scripts/setup-gotosocial.sh` also posts one seed status via its own
  account and prints the resulting id — the value to use as
  `external_post_id` when creating a `published_posts` row for manual
  testing against the real adapter (the automatically-seeded posts above
  work equally well for this — either account's post ids are usable).
- **`GoToSocialAdapter`'s unit tests mock the HTTP layer and run in CI**,
  same as `MockTwitterAdapter`'s. A separate, real-instance smoke test
  exists for exercising the actual running container end-to-end (fetch,
  reply, and — since GoToSocial supports `PUT /api/v1/statuses/:id` —
  editing a real status to confirm the edit-detection fix actually picks
  it up on resync), gated behind `GTS_ACCESS_TOKEN` being present and
  excluded from CI by default, the same way the Postgres-backed
  repository integration tests are already kept separate from the unit
  suite (see "Testing strategy" below).
- **Implementers: verify GoToSocial's current documented API/env vars
  before wiring this up rather than trusting any specific version number
  or field name here.** GoToSocial is an actively developed external
  project; the exact required environment variables and endpoint shapes
  should be checked against its current docs at implementation time, not
  assumed from this document.

## Async reply pipeline

- **pg-boss (Postgres-backed queue), not Redis/BullMQ or a cloud queue
  (SQS, Pub/Sub).** Chosen to avoid introducing additional infrastructure
  for what is, at this stage, a modest-throughput background task — it
  keeps the whole system on a single datastore and easy to run locally. In
  a production system at real scale, a managed queue would likely be a
  better choice for throughput, decoupling, and operational tooling;
  pg-boss is judged right-sized for this system's current scale, not
  presented as a permanent architectural ceiling.
- **Retry/backoff policy lives in the queue, not the database.** The
  `reply_jobs` table tracks current status, not attempt counts or backoff
  timing — that's left to pg-boss's own retry mechanics, to avoid
  duplicating retry logic in two places.
- **Idempotency is handled at the API layer, via a client-supplied
  `Idempotency-Key` header**, not by relying solely on the job's own
  primary key. A retried *client request* (e.g. a network blip causing a
  duplicate POST) would otherwise create two separate job rows, each of
  which would proceed to post to the platform — the client-supplied key is
  checked before a job is created, so a duplicate request returns the
  existing job instead of creating a new one.
- **Error classification is the adapter's responsibility; the retry
  decision is the worker's.** Adapters normalize platform-specific errors
  into a common `PlatformApiError` shape (with a `retryable` flag and an
  error `kind`), and the worker acts on that classification. See
  `docs/error-shape.md`.
- **Pinned to `pg-boss@^10`, not the latest major (`12.x`).** From `pg-boss`
  v12 onward the package ships ESM-only (`"type": "module"`, no CommonJS
  entry point), while this project compiles to CommonJS
  (`tsconfig.json`'s `module: "commonjs"`, no `esModuleInterop`) and CI runs
  on Node 20. `pg-boss@11` requires Node ≥22 (newer than CI's Node 20);
  `pg-boss@10` supports Node ≥20 and is still CommonJS, so it's the newest
  version that doesn't force either a Node bump or a project-wide ESM
  migration — neither of which this feature warrants.
- **Retry policy: `retryLimit: 5`, `retryDelay: 5` (seconds), `retryBackoff:
  true`.** Not specified anywhere in `docs/` beyond "retried per pg-boss's
  policy," so a concrete policy was picked and set on the queue itself (via
  `createQueue`/`updateQueue` in `ReplyJobsQueueService`) rather than left
  at pg-boss's defaults — five attempts with exponential backoff is a
  reasonable balance between riding out a transient blip (a rate limit, a
  5xx) and not hammering a platform that's genuinely down. `retryAfterMs`
  on a `rate_limited` `PlatformApiError` (a hint from the platform's own
  rate-limit headers) is not currently used to size an individual retry's
  delay — the worker just rethrows and lets the queue's uniform backoff
  handle it — noted here as a gap rather than silently ignored.
- **`createQueue` in pg-boss is create-only — it no-ops on a queue that
  already exists, silently ignoring any options passed.** `ReplyJobsQueueService`
  calls `updateQueue` right after `createQueue` for exactly this reason:
  without it, a later change to the retry policy in code would never take
  effect on a queue created by an earlier deploy. Confirmed by inspecting
  `pgboss.queue` directly against a locally running instance — this wasn't
  documented in pg-boss's own README.
- **The `reply_jobs` unique index on `idempotency_key` is the source of
  truth for deduplication, not an application-level check-then-insert.**
  The create-reply endpoint does check for an existing job by key before
  inserting (to skip unnecessary work on the common repeat-request path),
  but the actual insert uses `INSERT ... ON CONFLICT (idempotency_key) DO
  NOTHING`, falling back to a lookup if the insert is skipped. A plain
  check-then-insert would have a race window: two concurrent requests with
  the same key could both pass the check and both insert, each going on to
  post to the platform — exactly the duplicate-reply failure mode the key
  exists to prevent.

## Running multiple backend nodes

- **The design already supports horizontal scaling, without any
  coordination code, because all state lives in Postgres rather than
  in-process.** The HTTP layer is stateless and scales behind a load
  balancer like any REST API. More importantly, pg-boss's queue is built
  on `SELECT ... FOR UPDATE SKIP LOCKED`, so every node can run its own
  `ReplyJobsWorker` calling `boss.work()` against the same `reply-jobs`
  queue, and jobs are distributed across nodes with exactly-once delivery
  — no leader election or sharding needed (pg-boss advertises itself as
  "multi-master compatible," e.g. behind a Kubernetes ReplicaSet). The
  `Idempotency-Key` handling (`ON CONFLICT DO NOTHING` plus a race-safe
  fallback lookup — see "Async reply pipeline" below) was already built
  for exactly this case: two nodes racing on the same key can't both
  create a job.
- **Connection budget, not correctness, is the actual scaling limit.**
  Each node opens its own `pg.Pool` (for the app) and its own pg-boss
  connection pool, so Postgres's `max_connections` caps how many nodes can
  run concurrently before pool sizes need to shrink or a connection
  pooler (e.g. PgBouncer) needs to be introduced. Not addressed here since
  it isn't a problem at this system's current scale, but it's the first
  thing that would need attention before scaling node count up
  significantly.
- **Two nodes can redundantly double-sync the same post.** The staleness
  check in `CommentsService` (`last_synced_at` vs.
  `STALENESS_THRESHOLD_MS`) has no distributed lock around it, so two
  nodes serving concurrent requests for the same stale post could both
  decide to fetch and both call the adapter. This is wasteful (an extra
  adapter call) but not incorrect — `CommentsRepository.upsertMany`'s
  `ON CONFLICT` upsert is safe against two concurrent writers, so the
  worst case is one redundant platform fetch, not corrupted data. Not
  worth a distributed lock (e.g. a Postgres advisory lock keyed on
  `post_id`) at this system's current request volume.

## Testing strategy

- **Repository-layer tests are integration tests, run separately from
  unit tests.** They exercise a real Postgres instance (via
  `docker-compose`), not a mocked driver — given "plain node-postgres, no
  ORM" as the data-access approach, the value being tested (the upsert's
  `ON CONFLICT` edit-detection, the recursive-CTE tree fetch) lives in the
  SQL itself, and mocking the `pg` client would only prove the mock was
  called correctly, not that the query does the right thing. They're
  named `*.integration.spec.ts` and run via a separate Jest config
  (`jest.integration.config.js`, `npm run test:integration`), so `npm run
  test:unit` (and the default `jest`/`test:watch`) stays fast and runnable
  without Docker at all. `npm test` (used by the `pre-push` hook and CI)
  runs both.
- **The integration config pins `maxWorkers: 1`.** Those specs share one
  database and truncate their tables in `beforeEach`; Jest's default of
  running test files in separate parallel worker processes let two
  suites' truncate/insert sequences interleave against the same tables,
  causing intermittent unique-constraint failures. Serializing just this
  config avoids the race without slowing down the (much larger, in
  future) unit suite, and without adding per-suite locking or a separate
  database per worker.

## Framework choice

- **NestJS, not a hand-rolled Express/Fastify setup.** NestJS's
  module/provider/dependency-injection system maps naturally onto "support
  more platforms without touching core logic" — each platform adapter is
  registered as a provider (e.g. via a custom injection token keyed by
  platform), and the registry becomes Nest's own DI container rather than
  a bespoke class. This is a more "production-shaped" way to express the
  same registry pattern, at the cost of some framework boilerplate/DI
  conventions a reviewer needs to be familiar with to follow it as easily
  as a hand-rolled registry.
