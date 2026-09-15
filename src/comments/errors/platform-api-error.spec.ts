import { PlatformApiError } from './platform-api-error';

describe('PlatformApiError', () => {
  it('carries platform, kind, retryable, retryAfterMs, and cause', () => {
    const cause = new Error('original failure');
    const error = new PlatformApiError(
      'Too many requests',
      'twitter',
      'rate_limited',
      true,
      30_000,
      cause,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PlatformApiError');
    expect(error.message).toBe('Too many requests');
    expect(error.platform).toBe('twitter');
    expect(error.kind).toBe('rate_limited');
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(30_000);
    expect(error.cause).toBe(cause);
  });

  it('allows retryAfterMs and cause to be omitted', () => {
    const error = new PlatformApiError(
      'Comment not found',
      'twitter',
      'not_found',
      false,
    );

    expect(error.retryAfterMs).toBeUndefined();
    expect(error.cause).toBeUndefined();
  });
});
