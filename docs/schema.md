# Database Schema

Postgres. Three tables: `published_posts`, `comments`, `reply_jobs`.

```sql
CREATE TYPE platform AS ENUM ('twitter', 'instagram', 'linkedin', 'tiktok', 'gotosocial');

-- One row per post you've published, per platform.
CREATE TABLE published_posts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform          platform NOT NULL,
  external_post_id  TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at    TIMESTAMPTZ,   -- NULL = never fetched; drives staleness check on read

  UNIQUE (platform, external_post_id)
);

CREATE TABLE comments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id             UUID NOT NULL REFERENCES published_posts(id),
  platform            platform NOT NULL,       -- denormalized for query convenience
  external_comment_id TEXT NOT NULL,
  parent_comment_id   UUID REFERENCES comments(id),  -- NULL = top-level

  author_external_id  TEXT NOT NULL,
  author_display_name TEXT NOT NULL,
  body                TEXT NOT NULL,

  raw_payload         JSONB NOT NULL,          -- untouched platform response
  posted_at           TIMESTAMPTZ,             -- platform's own timestamp for the comment
  fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),  -- bumped on edit-sync
  deleted_at          TIMESTAMPTZ,             -- soft-delete marker only; see ASSUMPTIONS.md

  UNIQUE (platform, external_comment_id)
);

CREATE INDEX idx_comments_post_id ON comments(post_id);
CREATE INDEX idx_comments_parent_id ON comments(parent_comment_id);

-- Tracks outbound replies through the async posting pipeline.
CREATE TABLE reply_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_comment_id   UUID NOT NULL REFERENCES comments(id),
  platform            platform NOT NULL,
  body                TEXT NOT NULL,

  status              TEXT NOT NULL DEFAULT 'pending', -- pending|processing|sent|failed
  idempotency_key     TEXT NOT NULL,   -- client-supplied, via Idempotency-Key header
  last_error          TEXT,

  result_comment_id   UUID REFERENCES comments(id),  -- set once reply is confirmed + persisted

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_reply_jobs_idempotency ON reply_jobs(idempotency_key);
```

## Rationale

- **`platform` as an enum**: platforms are added by deploy/migration, not by
  end users; see `ASSUMPTIONS.md` for the tradeoff against a lookup table.
- **`platform` denormalized onto `comments`**, even though derivable via
  `post_id → published_posts.platform`. Pure query-convenience/indexing
  tradeoff; kept in sync only because a post never changes platform after
  creation.
- **`parent_comment_id` self-referencing, nullable**: supports arbitrary
  nesting. Fetching a full thread for a post is a recursive CTE; implement
  this once as a repository-layer method, not per-caller.
- **`(platform, external_comment_id)` unique**: needed both for dedup on
  sync (upsert target) and because posting a reply requires the platform's
  native comment ID, not our internal UUID.
- **`raw_payload JSONB NOT NULL`**: forward-compatibility/debugging
  insurance. Platform APIs change under us; keeping the raw response means
  we're not limited to only the fields we thought to normalize at write
  time.
- **`last_synced_at` on `published_posts`, not derived from the newest
  comment's `fetched_at`**: correct even when a post has zero comments so
  far (a post with no comments yet still needs a defined "last checked"
  time).
- **`reply_jobs` decoupled from `comments`**: a pending reply isn't a
  comment yet. It only becomes one (`result_comment_id` set) once the
  platform confirms it and it's re-ingested through the normal comment
  path; this preserves the "platform authoritative for writes" principle.
- **`idempotency_key` is client-supplied** (via an `Idempotency-Key`
  request header on the create-reply endpoint), not server-generated. A
  server-generated key would be unique per row by construction and
  therefore useless for detecting duplicate *client* requests; see
  `ASSUMPTIONS.md`.
- **No `attempt_count`/backoff columns**: retry mechanics are owned by
  pg-boss, not tracked redundantly in the database. `reply_jobs.status`
  reflects current state only.
- **`deleted_at` present, but no deletion logic**: see `ASSUMPTIONS.md`;
  included to avoid a future foreign-key/cascade design problem, without
  committing to deletion semantics that weren't specified.
