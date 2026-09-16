# Platform Adapter Interface

The mechanism that satisfies "support multiple platforms, more in future"
without schema or core-logic changes per new platform.

```typescript
type Platform = 'twitter' | 'instagram' | 'linkedin' | 'tiktok' | 'gotosocial';

// ---- Canonical domain types ----

interface CanonicalComment {
  externalCommentId: string;
  externalParentCommentId: string | null; // null = top-level comment
  authorExternalId: string;
  authorDisplayName: string;
  body: string;
  postedAt: Date | null; // the platform's own timestamp, if provided
  raw: unknown;          // untouched platform payload -> stored into raw_payload
}

interface FetchCommentsOptions {
  since?: Date; // used for incremental sync — fetch comments created OR edited since this time
}

// ---- The adapter contract ----

interface PlatformCommentAdapter {
  readonly platform: Platform;

  /**
   * Fetches all comments for a post. Adapters own pagination internally
   * (cursors, tokens, offsets — whatever the platform requires) and
   * normalize the platform's actual threading behavior (e.g. flattening
   * deep reply chains) into CanonicalComment's parent/child shape.
   * Pagination mechanics are never exposed on this interface.
   *
   * `since`, when provided, must include comments created OR edited after
   * that time — not only newly-created ones. A caller doing incremental
   * sync re-uses its last sync time as `since` on every call (see
   * CommentsService), so a comment that stops being "new" would otherwise
   * never be checked for edits again. How an adapter determines "edited
   * since" is platform-specific and internal to it (e.g. a platform's own
   * last-modified timestamp on the comment) — see ASSUMPTIONS.md.
   */
  fetchComments(
    externalPostId: string,
    options?: FetchCommentsOptions
  ): Promise<CanonicalComment[]>;

  /**
   * Posts a reply to a comment on the platform. Throws PlatformApiError
   * (see error-shape.md) on failure. This method is synchronous from the
   * adapter's point of view — it knows nothing about jobs, queues, or
   * retries; that's the worker's responsibility, layered on top.
   */
  postReply(
    externalParentCommentId: string,
    body: string
  ): Promise<CanonicalComment>;
}

// ---- Registry ----
//
// In NestJS, this is expressed via the DI container rather than a
// hand-rolled class: each adapter is registered as a provider under an
// injection token keyed by platform (e.g. `ADAPTER_TWITTER`), and a small
// factory/service resolves the right adapter for a given `Platform` value
// at runtime — for example:

@Injectable()
class CommentAdapterRegistry {
  constructor(
    @Inject('ADAPTER_MAP') private readonly adapters: Map<Platform, PlatformCommentAdapter>
  ) {}

  get(platform: Platform): PlatformCommentAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) throw new Error(`No adapter registered for platform: ${platform}`);
    return adapter;
  }
}

// Each platform module provides its own adapter into 'ADAPTER_MAP' (e.g.
// via a custom provider in a shared CommentsModule), so adding a platform
// means adding one module/provider, not touching this class.
```

## Rationale

- **`raw: unknown`, not a typed/constrained shape.** We don't and can't
  know a given platform's payload shape at the type level; it's opaque to
  everything except the adapter that produced it. Consuming code should
  never read from `raw` — it exists purely for forward-compatibility and
  debugging.
- **`externalParentCommentId` is resolved to an internal UUID by the
  service layer, not the adapter.** The adapter should never need to know
  about our internal database IDs — it speaks the platform's language in
  and out, and nothing else. Resolution happens via the
  `(platform, external_comment_id)` unique constraint.
- **`since` means "created or updated since," not just "created since."**
  An earlier version of this contract only covered new comments, which
  made edit-detection unreachable in practice — see ASSUMPTIONS.md,
  "`since` means 'created or updated since'" for the full story of why
  this changed.
- **No cursor/pagination parameter on `fetchComments`.** No caller in this
  system ever needs a single page — the service layer always wants
  "everything" (or "everything since X"). Pagination is entirely an
  adapter-internal concern. See `ASSUMPTIONS.md` for the volume/latency
  caveat this implies.
- **`postReply` returns a `CanonicalComment`, not a job or status.** Keeps
  the adapter boundary narrow and independently testable — mock the
  platform call, assert the mapping to `CanonicalComment`, with no queue
  concerns involved.
