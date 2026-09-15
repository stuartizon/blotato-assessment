import {
  CanonicalComment,
  FetchCommentsOptions,
  PlatformCommentAdapter,
} from '../platform-comment-adapter.interface';
import { PlatformApiError } from '../errors/platform-api-error';

/**
 * Sentinel externalParentCommentId/externalPostId values that make the mock
 * simulate a given platform failure, instead of a real network condition
 * (there is no real Twitter API behind this adapter — see ASSUMPTIONS.md).
 */
export const MockTwitterFailureTrigger = {
  RATE_LIMITED: 'SIMULATE_RATE_LIMIT',
  TRANSIENT: 'SIMULATE_TRANSIENT_ERROR',
  NOT_FOUND: 'SIMULATE_NOT_FOUND',
  PERMISSION_DENIED: 'SIMULATE_PERMISSION_DENIED',
  INVALID_REQUEST: 'SIMULATE_INVALID_REQUEST',
  UNKNOWN: 'SIMULATE_UNKNOWN_ERROR',
} as const;

const SIMULATED_RATE_LIMIT_RETRY_AFTER_MS = 30_000;
const REPLY_ACCOUNT_ID = 'mock-twitter-authenticated-account';
const REPLY_ACCOUNT_DISPLAY_NAME = 'Mock Account';

interface MockTweetPayload {
  id_str: string;
  in_reply_to_status_id_str: string | null;
  user: { id_str: string; name: string };
  full_text: string;
  created_at: string;
}

/**
 * A mock "twitter"-like adapter. Simulates the shape of a real platform
 * integration (pagination-free bulk fetch, a created-at timestamp, a
 * nested-reply thread, rate limiting) without calling any real API — see
 * docs/ASSUMPTIONS.md, "Platform integration (real vs. mock)".
 *
 * Deterministic per externalPostId (seeded, not random) so tests and
 * staleness-driven re-fetches behave predictably.
 */
export class MockTwitterAdapter implements PlatformCommentAdapter {
  readonly platform = 'twitter' as const;

  async fetchComments(
    externalPostId: string,
    options?: FetchCommentsOptions,
  ): Promise<CanonicalComment[]> {
    if (externalPostId === MockTwitterFailureTrigger.NOT_FOUND) {
      throw new PlatformApiError(
        `Simulated failure: post ${externalPostId} not found`,
        this.platform,
        'not_found',
        false,
      );
    }

    const comments = this.generateSimulatedThread(externalPostId).map((raw) =>
      this.toCanonicalComment(raw),
    );

    const since = options?.since;
    return since
      ? comments.filter((c) => c.postedAt !== null && c.postedAt > since)
      : comments;
  }

  async postReply(
    externalParentCommentId: string,
    body: string,
  ): Promise<CanonicalComment> {
    this.maybeThrowSimulatedFailure(externalParentCommentId);

    const raw: MockTweetPayload = {
      id_str: `mock-reply-${this.hash(`${externalParentCommentId}:${body}:${Date.now()}`)}`,
      in_reply_to_status_id_str: externalParentCommentId,
      user: { id_str: REPLY_ACCOUNT_ID, name: REPLY_ACCOUNT_DISPLAY_NAME },
      full_text: body,
      created_at: new Date().toISOString(),
    };

    return this.toCanonicalComment(raw);
  }

  private maybeThrowSimulatedFailure(externalParentCommentId: string): void {
    switch (externalParentCommentId) {
      case MockTwitterFailureTrigger.RATE_LIMITED:
        throw new PlatformApiError(
          'Simulated failure: rate limit exceeded',
          this.platform,
          'rate_limited',
          true,
          SIMULATED_RATE_LIMIT_RETRY_AFTER_MS,
        );
      case MockTwitterFailureTrigger.TRANSIENT:
        throw new PlatformApiError(
          'Simulated failure: upstream 503',
          this.platform,
          'transient',
          true,
        );
      case MockTwitterFailureTrigger.NOT_FOUND:
        throw new PlatformApiError(
          'Simulated failure: parent comment not found',
          this.platform,
          'not_found',
          false,
        );
      case MockTwitterFailureTrigger.PERMISSION_DENIED:
        throw new PlatformApiError(
          'Simulated failure: replies disabled on this post',
          this.platform,
          'permission_denied',
          false,
        );
      case MockTwitterFailureTrigger.INVALID_REQUEST:
        throw new PlatformApiError(
          'Simulated failure: malformed reply body',
          this.platform,
          'invalid_request',
          false,
        );
      case MockTwitterFailureTrigger.UNKNOWN:
        throw new PlatformApiError(
          'Simulated failure: unrecognized platform response',
          this.platform,
          'unknown',
          false,
        );
    }
  }

  private toCanonicalComment(raw: MockTweetPayload): CanonicalComment {
    return {
      externalCommentId: raw.id_str,
      externalParentCommentId: raw.in_reply_to_status_id_str,
      authorExternalId: raw.user.id_str,
      authorDisplayName: raw.user.name,
      body: raw.full_text,
      postedAt: new Date(raw.created_at),
      raw,
    };
  }

  /** Deterministic pseudo-random simulated thread, seeded by externalPostId. */
  private generateSimulatedThread(externalPostId: string): MockTweetPayload[] {
    const seed = this.hash(externalPostId);
    const random = this.seededRandom(seed);
    const topLevelCount = 2 + Math.floor(random() * 2); // 2-3
    const baseTime = new Date('2026-01-01T00:00:00.000Z').getTime();

    const comments: MockTweetPayload[] = [];
    let offsetMinutes = 0;

    for (let i = 0; i < topLevelCount; i++) {
      offsetMinutes += 1 + Math.floor(random() * 10);
      const topLevelId = `${externalPostId}-c${i}`;
      comments.push({
        id_str: topLevelId,
        in_reply_to_status_id_str: null,
        user: {
          id_str: `${externalPostId}-user${i}`,
          name: `Simulated User ${i}`,
        },
        full_text: `Simulated top-level comment #${i} on ${externalPostId}`,
        created_at: new Date(baseTime + offsetMinutes * 60_000).toISOString(),
      });

      // The first top-level comment always gets at least one reply, so a
      // simulated thread is never entirely flat.
      const replyCount = i === 0 ? 1 : Math.floor(random() * 2); // 0-1
      for (let j = 0; j < replyCount; j++) {
        offsetMinutes += 1 + Math.floor(random() * 10);
        comments.push({
          id_str: `${topLevelId}-r${j}`,
          in_reply_to_status_id_str: topLevelId,
          user: {
            id_str: `${externalPostId}-user${i}-${j}`,
            name: `Simulated Replier ${i}.${j}`,
          },
          full_text: `Simulated reply #${j} to comment #${i}`,
          created_at: new Date(baseTime + offsetMinutes * 60_000).toISOString(),
        });
      }
    }

    return comments;
  }

  private hash(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = (Math.imul(31, hash) + input.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  private seededRandom(seed: number): () => number {
    let state = seed || 1;
    return () => {
      state = (state * 1_103_515_245 + 12_345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
  }
}
