import { CommentAdapterRegistry } from './comment-adapter-registry.service';
import { PlatformCommentAdapter } from './platform-comment-adapter.interface';

function fakeAdapter(
  platform: PlatformCommentAdapter['platform'],
): PlatformCommentAdapter {
  return {
    platform,
    fetchComments: jest.fn(),
    postReply: jest.fn(),
  };
}

describe('CommentAdapterRegistry', () => {
  it('returns the adapter registered for a platform', () => {
    const twitterAdapter = fakeAdapter('twitter');
    const registry = new CommentAdapterRegistry(
      new Map([['twitter', twitterAdapter]]),
    );

    expect(registry.get('twitter')).toBe(twitterAdapter);
  });

  it('throws a clear error for an unregistered platform', () => {
    const registry = new CommentAdapterRegistry(new Map());

    expect(() => registry.get('instagram')).toThrow(
      'No adapter registered for platform: instagram',
    );
  });

  it('distinguishes between multiple registered platforms', () => {
    const twitterAdapter = fakeAdapter('twitter');
    const linkedinAdapter = fakeAdapter('linkedin');
    const registry = new CommentAdapterRegistry(
      new Map([
        ['twitter', twitterAdapter],
        ['linkedin', linkedinAdapter],
      ]),
    );

    expect(registry.get('twitter')).toBe(twitterAdapter);
    expect(registry.get('linkedin')).toBe(linkedinAdapter);
  });
});
