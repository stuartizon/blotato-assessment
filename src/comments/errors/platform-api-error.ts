import { Platform } from '../platform-comment-adapter.interface';

export type PlatformErrorKind =
  | 'rate_limited' // back off and retry, possibly with a hint
  | 'transient' // network blip, 5xx, etc — safe to retry
  | 'not_found' // parent comment/post no longer exists — don't retry
  | 'permission_denied' // e.g. comments disabled, blocked — don't retry
  | 'invalid_request' // malformed input — don't retry, likely a bug
  | 'unknown'; // unrecognized — treat conservatively (don't retry)

export class PlatformApiError extends Error {
  constructor(
    message: string,
    public readonly platform: Platform,
    public readonly kind: PlatformErrorKind,
    public readonly retryable: boolean,
    public readonly retryAfterMs?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PlatformApiError';
  }
}
