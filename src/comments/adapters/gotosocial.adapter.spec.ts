import { PlatformApiError } from '../errors/platform-api-error';
import { GoToSocialAdapter } from './gotosocial.adapter';

const BASE_URL = 'http://gotosocial.test';
const ACCESS_TOKEN = 'test-access-token';

function jsonResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function status(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'status-1',
    in_reply_to_id: 'post-123',
    content: '<p>Hello &amp; welcome</p>',
    created_at: '2026-09-16T18:39:09.360Z',
    edited_at: null,
    account: { id: 'account-1', username: 'alice', display_name: 'Alice' },
    ...overrides,
  };
}

describe('GoToSocialAdapter', () => {
  let adapter: GoToSocialAdapter;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    adapter = new GoToSocialAdapter(BASE_URL, ACCESS_TOKEN);
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('reports its platform as gotosocial', () => {
    expect(adapter.platform).toBe('gotosocial');
  });

  describe('fetchComments', () => {
    it('calls the context endpoint with a bearer token and maps descendants to CanonicalComment', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          ancestors: [],
          descendants: [status()],
        }),
      );

      const comments = await adapter.fetchComments('post-123');

      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/statuses/post-123/context`,
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: `Bearer ${ACCESS_TOKEN}`,
          }),
        }),
      );
      expect(comments).toEqual([
        {
          externalCommentId: 'status-1',
          externalParentCommentId: 'post-123',
          authorExternalId: 'account-1',
          authorDisplayName: 'Alice',
          body: 'Hello & welcome',
          postedAt: new Date('2026-09-16T18:39:09.360Z'),
          raw: status(),
        },
      ]);
    });

    it('strips HTML tags from content into plain-text body', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          ancestors: [],
          descendants: [
            status({
              content: '<p>Check <a href="http://x.test">this</a> out!</p>',
            }),
          ],
        }),
      );

      const [comment] = await adapter.fetchComments('post-123');

      expect(comment.body).toBe('Check this out!');
    });

    it('maps nested reply threading correctly, not just top-level replies', async () => {
      const directReply = status({
        id: 'reply-1',
        in_reply_to_id: 'post-123', // direct reply to the post
      });
      const nestedReply = status({
        id: 'reply-2',
        in_reply_to_id: 'reply-1', // reply to another comment
      });
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          ancestors: [],
          descendants: [directReply, nestedReply],
        }),
      );

      const comments = await adapter.fetchComments('post-123');

      const mappedDirect = comments.find(
        (c) => c.externalCommentId === 'reply-1',
      );
      const mappedNested = comments.find(
        (c) => c.externalCommentId === 'reply-2',
      );
      expect(mappedDirect?.externalParentCommentId).toBe('post-123');
      expect(mappedNested?.externalParentCommentId).toBe('reply-1');
    });

    it('ignores ancestors — only descendants are comments on the post', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          ancestors: [status({ id: 'ancestor-1' })],
          descendants: [status({ id: 'descendant-1' })],
        }),
      );

      const comments = await adapter.fetchComments('post-123');

      expect(comments.map((c) => c.externalCommentId)).toEqual([
        'descendant-1',
      ]);
    });

    it('only returns comments edited or created after options.since', async () => {
      const old = status({ id: 'old', created_at: '2026-01-01T00:00:00Z' });
      const recentlyEdited = status({
        id: 'recently-edited',
        created_at: '2026-01-01T00:00:00Z',
        edited_at: '2026-09-01T00:00:00Z',
      });
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          ancestors: [],
          descendants: [old, recentlyEdited],
        }),
      );

      const comments = await adapter.fetchComments('post-123', {
        since: new Date('2026-06-01T00:00:00Z'),
      });

      expect(comments.map((c) => c.externalCommentId)).toEqual([
        'recently-edited',
      ]);
    });

    it('throws a not_found PlatformApiError when the post no longer exists', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(404, { error: 'Not Found: target status not found' }),
      );

      await expect(adapter.fetchComments('missing-post')).rejects.toMatchObject(
        {
          name: 'PlatformApiError',
          platform: 'gotosocial',
          kind: 'not_found',
          retryable: false,
          message: 'Not Found: target status not found',
        },
      );
    });
  });

  describe('postReply', () => {
    it('posts the reply and returns a CanonicalComment mapped from the response', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          200,
          status({ id: 'new-reply', in_reply_to_id: 'parent-1' }),
        ),
      );

      const result = await adapter.postReply('parent-1', 'Thanks!');

      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/statuses`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            status: 'Thanks!',
            in_reply_to_id: 'parent-1',
            visibility: 'public',
          }),
        }),
      );
      expect(result.externalCommentId).toBe('new-reply');
      expect(result.externalParentCommentId).toBe('parent-1');
    });

    it.each<
      [
        string,
        number,
        import('../errors/platform-api-error').PlatformErrorKind,
        boolean,
      ]
    >([
      ['invalid request', 400, 'invalid_request', false],
      ['auth failure', 401, 'permission_denied', false],
      ['forbidden', 403, 'permission_denied', false],
      ['not found', 404, 'not_found', false],
      ['rate limited', 429, 'rate_limited', true],
      ['server error', 503, 'transient', true],
    ])(
      'classifies a %s (%i) response as kind=%s, retryable=%s',
      async (_label, statusCode, kind, retryable) => {
        fetchMock.mockResolvedValue(
          jsonResponse(statusCode, { error: 'boom' }),
        );

        let error!: PlatformApiError;
        try {
          await adapter.postReply('parent-1', 'body');
        } catch (e) {
          error = e as PlatformApiError;
        }

        expect(error).toBeInstanceOf(PlatformApiError);
        expect(error.platform).toBe('gotosocial');
        expect(error.kind).toBe(kind);
        expect(error.retryable).toBe(retryable);
      },
    );

    it('derives retryAfterMs from the X-Ratelimit-Reset header on a 429', async () => {
      const resetAt = new Date(Date.now() + 30_000).toISOString();
      fetchMock.mockResolvedValue(
        jsonResponse(
          429,
          { error: 'rate limited' },
          { 'X-Ratelimit-Reset': resetAt },
        ),
      );

      await expect(adapter.postReply('parent-1', 'body')).rejects.toMatchObject(
        {
          retryAfterMs: expect.any(Number),
        },
      );
    });

    it('classifies a network failure (fetch rejecting) as transient and retryable', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      await expect(adapter.postReply('parent-1', 'body')).rejects.toMatchObject(
        {
          name: 'PlatformApiError',
          platform: 'gotosocial',
          kind: 'transient',
          retryable: true,
        },
      );
    });

    it('classifies an unrecognized status code conservatively as unknown, not retryable', async () => {
      fetchMock.mockResolvedValue(jsonResponse(418, { error: "I'm a teapot" }));

      await expect(adapter.postReply('parent-1', 'body')).rejects.toMatchObject(
        {
          kind: 'unknown',
          retryable: false,
        },
      );
    });
  });
});
