# REST API

Three endpoints, covering read, write, and status-check for the reply
lifecycle. See `ASSUMPTIONS.md` for what's deliberately excluded (post
listing, `includeDeleted`, a computed reply-status field).

## `GET /posts/:postId/comments`

Returns the comment tree for a post. If `published_posts.last_synced_at`
is `NULL` or older than the configured staleness threshold, triggers a
fetch via the relevant `PlatformCommentAdapter`, upserts the results, and
updates `last_synced_at` before responding. Otherwise serves directly from
the database.

**Response** — comments nested by `parent_comment_id`; a comment's own
replies are returned as a `replies` array (arbitrary depth). Whether a
comment has been replied to is derivable from `replies.length > 0` — no
separate status field.

```json
{
  "postId": "…",
  "comments": [
    {
      "id": "…",
      "authorDisplayName": "…",
      "body": "…",
      "postedAt": "2026-09-10T12:00:00Z",
      "replies": [
        { "id": "…", "authorDisplayName": "…", "body": "…", "postedAt": "…", "replies": [] }
      ]
    }
  ]
}
```

## `POST /comments/:commentId/replies`

Creates a reply job. Requires an `Idempotency-Key` header (client-supplied,
UUID or similar) — a repeated request with the same key returns the
existing job rather than creating a duplicate (see `ASSUMPTIONS.md`).

**Request body**
```json
{ "body": "Thanks for your comment!" }
```

**Response — `202 Accepted`**
```json
{
  "jobId": "…",
  "status": "pending"
}
```

## `GET /reply-jobs/:jobId`

Poll for job status. Once `status` is `sent`, includes the resulting
comment.

**Response**
```json
{
  "jobId": "…",
  "status": "sent",
  "resultComment": { "id": "…", "body": "…", "postedAt": "…" }
}
```

`status` is one of `pending | processing | sent | failed`. On `failed`, the
response includes `lastError` (a human-readable message, not the raw
platform error).
