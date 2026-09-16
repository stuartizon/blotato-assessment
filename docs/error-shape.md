# Platform Error Shape

Lets the reply worker decide retry vs. give-up without needing to parse
platform-specific error formats itself.

```typescript
type PlatformErrorKind =
  | 'rate_limited'      // back off and retry, possibly with a hint
  | 'transient'         // network blip, 5xx, etc: safe to retry
  | 'not_found'         // parent comment/post no longer exists: don't retry
  | 'permission_denied' // e.g. comments disabled, blocked: don't retry
  | 'invalid_request'   // malformed input: don't retry, likely a bug
  | 'unknown';          // unrecognized: treat conservatively (don't retry)

class PlatformApiError extends Error {
  constructor(
    message: string,
    public readonly platform: Platform,
    public readonly kind: PlatformErrorKind,
    public readonly retryable: boolean,
    public readonly retryAfterMs?: number, // hint from rate-limit headers, if present
    public readonly cause?: unknown        // original error/response, for logging
  ) {
    super(message);
    this.name = 'PlatformApiError';
  }
}
```

## Division of responsibility

- **The adapter classifies.** Each adapter catches whatever its platform's
  SDK/HTTP client throws and re-throws as a `PlatformApiError` with the
  appropriate `kind`/`retryable` values, e.g. a 429 maps to
  `kind: 'rate_limited', retryable: true, retryAfterMs: <from header>`; a
  404 on the parent comment maps to `kind: 'not_found', retryable: false`.
- **The worker decides.** It doesn't inspect platform-specific error
  details; it only reads `retryable` (and optionally `retryAfterMs`) to
  decide whether to let pg-boss retry the job or mark it permanently
  failed:

```typescript
try {
  const result = await adapter.postReply(externalParentCommentId, body);
  // mark job sent, upsert result as a comment
} catch (err) {
  if (err instanceof PlatformApiError && err.retryable) {
    throw err; // let pg-boss's retry/backoff handle it
  }
  // non-retryable: mark job failed, store err.message, don't retry
}
```

This is a deliberate, narrow exception to "the adapter knows nothing about
jobs/queues": classifying an error (transient vs. permanent) is
fundamentally platform knowledge, even though acting on that classification
is not. The adapter reports facts; the worker makes decisions.
