# Proposed Issues

Implementation broken into roughly sequential, independently reviewable
chunks, matching the priority order in `CLAUDE.md`. Each can be created as
a GitHub issue directly (title + body below), or handed to Claude Code to
create via `gh issue create` once the repo exists.

---

### 1. Project scaffold + migrations
Set up the TypeScript/Node project (NestJS), Postgres
connection, and a migration tool. Add migrations for `published_posts`,
`comments`, `reply_jobs` per `docs/schema.md`.

**Acceptance criteria**
- `npm run migrate` creates all three tables with correct constraints/indexes
- Project runs locally with a documented setup (README updated)

---

### 2. `PlatformCommentAdapter` interface + registry
Implement `CanonicalComment`, `PlatformCommentAdapter`, and
`CommentAdapterRegistry` per `docs/adapter-interface.md`.

**Acceptance criteria**
- Interface matches the spec exactly (no cursor/pagination leakage)
- Registry throws a clear error for an unregistered platform
- Unit tests for the registry (register/get/missing-platform)

---

### 3. Mock platform adapter
Implement one working adapter (a fake/mock platform simulating a real
API's shape — auth, comment fetch, reply posting) to validate the
interface end-to-end without needing real platform credentials. Stub
remaining platforms with a `NotImplementedAdapter`.

**Acceptance criteria**
- Adapter implements `fetchComments` and `postReply` against
  `CanonicalComment`
- Adapter throws `PlatformApiError` (see issue 4) on simulated failures
- Unit tests covering the mapping to/from `CanonicalComment`

---

### 4. `PlatformApiError` + error classification
Implement the error shape per `docs/error-shape.md`. Wire the mock
adapter to throw appropriately classified errors for simulated failure
cases (rate limit, not found, transient).

**Acceptance criteria**
- `PlatformApiError` matches the spec (kind, retryable, retryAfterMs, cause)
- At least one test per `PlatformErrorKind` from the mock adapter

---

### 5. `GET /posts/:postId/comments` — read + sync path
Implement the staleness check against `last_synced_at`, triggering
`fetchComments` via the adapter registry when stale, upserting results
(including edit-detection per `docs/ASSUMPTIONS.md`), and returning the
nested comment tree.

**Acceptance criteria**
- Fresh data served without hitting the adapter
- Stale/missing data triggers a fetch, upsert, and `last_synced_at` update
- Response nests replies correctly (recursive structure)
- Edited comments (same `external_comment_id`, changed `body`) update
  `body` and `updated_at` in place rather than duplicating

---

### 6. pg-boss integration + reply worker
Wire up pg-boss. Implement the worker that consumes reply jobs, calls
`postReply` on the appropriate adapter, and updates `reply_jobs.status`
based on the result/error classification.

**Acceptance criteria**
- Retryable errors are retried per pg-boss's policy (not tracked in DB)
- Non-retryable errors mark the job `failed` with `last_error` set
- Successful replies set `status = 'sent'`, create/upsert a `comments` row,
  and set `result_comment_id`

---

### 7. `POST /comments/:commentId/replies`
Implement the create-reply endpoint, including `Idempotency-Key` handling.

**Acceptance criteria**
- Missing `Idempotency-Key` header returns a 4xx
- Duplicate key returns the existing job (200/202) rather than creating
  a new one
- New key creates a `reply_jobs` row and enqueues via pg-boss, returns 202

---

### 8. `GET /reply-jobs/:jobId`
Implement the status-polling endpoint.

**Acceptance criteria**
- Returns current status and, once `sent`, the resulting comment
- 404 for an unknown job ID

---

### 9. Documentation pass
Ensure `README.md` setup instructions are accurate against the final
implementation; confirm `docs/ASSUMPTIONS.md` still matches what was
actually built (update if any decision changed during implementation).
