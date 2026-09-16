import { PlatformApiError } from '../errors/platform-api-error';
import {
  MockTwitterAdapter,
  MockTwitterEditTrigger,
  MockTwitterFailureTrigger,
} from './mock-twitter.adapter';

describe('MockTwitterAdapter', () => {
  let adapter: MockTwitterAdapter;

  beforeEach(() => {
    adapter = new MockTwitterAdapter();
  });

  it('reports its platform as twitter', () => {
    expect(adapter.platform).toBe('twitter');
  });

  describe('fetchComments', () => {
    it('maps simulated tweets to CanonicalComment, preserving raw payload and threading', async () => {
      const comments = await adapter.fetchComments('post-123');

      expect(comments.length).toBeGreaterThan(0);
      for (const comment of comments) {
        expect(typeof comment.externalCommentId).toBe('string');
        expect(typeof comment.authorExternalId).toBe('string');
        expect(typeof comment.authorDisplayName).toBe('string');
        expect(typeof comment.body).toBe('string');
        expect(comment.postedAt).toBeInstanceOf(Date);
        expect(comment.raw).toBeDefined();
      }

      const topLevel = comments.filter(
        (c) => c.externalParentCommentId === null,
      );
      const nested = comments.filter((c) => c.externalParentCommentId !== null);
      expect(topLevel.length).toBeGreaterThan(0);
      expect(nested.length).toBeGreaterThan(0);
      for (const reply of nested) {
        expect(
          comments.some(
            (c) => c.externalCommentId === reply.externalParentCommentId,
          ),
        ).toBe(true);
      }
    });

    it('is deterministic for the same externalPostId', async () => {
      const first = await adapter.fetchComments('post-123');
      const second = await adapter.fetchComments('post-123');

      expect(second).toEqual(first);
    });

    it('returns a different simulated dataset for a different externalPostId', async () => {
      const a = await adapter.fetchComments('post-123');
      const b = await adapter.fetchComments('post-456');

      expect(b.map((c) => c.externalCommentId)).not.toEqual(
        a.map((c) => c.externalCommentId),
      );
    });

    it('only returns comments newer than options.since', async () => {
      const all = await adapter.fetchComments('post-123');
      const postedAts = all
        .map((c) => c.postedAt)
        .filter((d): d is Date => d !== null)
        .sort((a: Date, b: Date) => a.getTime() - b.getTime());
      const cutoff = postedAts[Math.floor(postedAts.length / 2)];

      const sinceCutoff = await adapter.fetchComments('post-123', {
        since: cutoff,
      });

      expect(sinceCutoff.length).toBeLessThan(all.length);
      for (const comment of sinceCutoff) {
        expect(comment.postedAt!.getTime()).toBeGreaterThan(cutoff.getTime());
      }
    });

    it('throws a not_found PlatformApiError for the simulated missing-post trigger', async () => {
      await expect(
        adapter.fetchComments(MockTwitterFailureTrigger.NOT_FOUND),
      ).rejects.toMatchObject({
        name: 'PlatformApiError',
        platform: 'twitter',
        kind: 'not_found',
        retryable: false,
      });
    });

    it('re-includes a comment edited after options.since, even though it was originally posted well before it', async () => {
      // The simulated edit trigger always reports itself as edited "now" —
      // any since cutoff before the real current time proves it survives
      // the since filter on its edited time, not its (much older) postedAt.
      const sinceCutoff = new Date('2026-06-01T00:00:00.000Z');

      const result = await adapter.fetchComments(
        MockTwitterEditTrigger.RECENTLY_EDITED_COMMENT,
        { since: sinceCutoff },
      );

      expect(result).toHaveLength(1);
      expect(result[0].postedAt!.getTime()).toBeLessThan(sinceCutoff.getTime());
    });
  });

  describe('postReply', () => {
    it('returns a CanonicalComment mapped from the simulated created reply', async () => {
      const result = await adapter.postReply('parent-comment-1', 'Thanks!');

      expect(result.externalParentCommentId).toBe('parent-comment-1');
      expect(result.body).toBe('Thanks!');
      expect(typeof result.externalCommentId).toBe('string');
      expect(result.postedAt).toBeInstanceOf(Date);
      expect(result.raw).toBeDefined();
    });

    it.each<
      [
        string,
        import('../errors/platform-api-error').PlatformErrorKind,
        boolean,
      ]
    >([
      [MockTwitterFailureTrigger.RATE_LIMITED, 'rate_limited', true],
      [MockTwitterFailureTrigger.TRANSIENT, 'transient', true],
      [MockTwitterFailureTrigger.NOT_FOUND, 'not_found', false],
      [MockTwitterFailureTrigger.PERMISSION_DENIED, 'permission_denied', false],
      [MockTwitterFailureTrigger.INVALID_REQUEST, 'invalid_request', false],
      [MockTwitterFailureTrigger.UNKNOWN, 'unknown', false],
    ])(
      'throws a %s PlatformApiError classified as kind=%s, retryable=%s',
      async (trigger, kind, retryable) => {
        let error!: PlatformApiError;
        try {
          await adapter.postReply(trigger, 'body');
        } catch (e) {
          error = e as PlatformApiError;
        }

        expect(error).toBeInstanceOf(PlatformApiError);
        expect(error.platform).toBe('twitter');
        expect(error.kind).toBe(kind);
        expect(error.retryable).toBe(retryable);
      },
    );

    it('includes a retryAfterMs hint on rate-limit errors', async () => {
      await expect(
        adapter.postReply(MockTwitterFailureTrigger.RATE_LIMITED, 'body'),
      ).rejects.toMatchObject({
        retryAfterMs: expect.any(Number),
      });
    });
  });
});
