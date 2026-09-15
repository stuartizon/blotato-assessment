import { NotFoundException } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { PublishedPostsRepository } from './repositories/published-posts.repository';
import { CommentsRepository } from './repositories/comments.repository';
import { CommentAdapterRegistry } from './comment-adapter-registry.service';
import { PlatformCommentAdapter } from './platform-comment-adapter.interface';

describe('CommentsService', () => {
  const STALENESS_THRESHOLD_MS = 15 * 60 * 1000;

  let publishedPosts: jest.Mocked<PublishedPostsRepository>;
  let comments: jest.Mocked<CommentsRepository>;
  let registry: jest.Mocked<CommentAdapterRegistry>;
  let adapter: jest.Mocked<PlatformCommentAdapter>;
  let service: CommentsService;

  const post = {
    id: 'post-uuid-1',
    platform: 'twitter' as const,
    externalPostId: 'ext-post-1',
    lastSyncedAt: null as Date | null,
  };

  const tree = [
    {
      id: 'comment-1',
      authorDisplayName: 'Alice',
      body: 'Hi',
      postedAt: new Date('2026-01-01T00:00:00.000Z'),
      replies: [],
    },
  ];

  beforeEach(() => {
    publishedPosts = {
      findById: jest.fn(),
      touchLastSyncedAt: jest.fn(),
    } as unknown as jest.Mocked<PublishedPostsRepository>;

    comments = {
      upsertMany: jest.fn(),
      getCommentTree: jest.fn(),
    } as unknown as jest.Mocked<CommentsRepository>;

    adapter = {
      platform: 'twitter',
      fetchComments: jest.fn(),
      postReply: jest.fn(),
    };

    registry = {
      get: jest.fn().mockReturnValue(adapter),
    } as unknown as jest.Mocked<CommentAdapterRegistry>;

    service = new CommentsService(
      publishedPosts,
      comments,
      registry,
      STALENESS_THRESHOLD_MS,
    );
  });

  it('throws NotFoundException when the post does not exist', async () => {
    publishedPosts.findById.mockResolvedValue(null);

    await expect(service.getCommentTreeForPost('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('serves fresh data without hitting the adapter when recently synced', async () => {
    publishedPosts.findById.mockResolvedValue({
      ...post,
      lastSyncedAt: new Date(Date.now() - 1000),
    });
    comments.getCommentTree.mockResolvedValue(tree);

    const result = await service.getCommentTreeForPost(post.id);

    expect(adapter.fetchComments).not.toHaveBeenCalled();
    expect(comments.upsertMany).not.toHaveBeenCalled();
    expect(publishedPosts.touchLastSyncedAt).not.toHaveBeenCalled();
    expect(result).toEqual({ postId: post.id, comments: tree });
  });

  it('triggers a sync when last_synced_at is null', async () => {
    publishedPosts.findById.mockResolvedValue({ ...post, lastSyncedAt: null });
    adapter.fetchComments.mockResolvedValue([]);
    comments.getCommentTree.mockResolvedValue(tree);

    await service.getCommentTreeForPost(post.id);

    expect(registry.get).toHaveBeenCalledWith('twitter');
    expect(adapter.fetchComments).toHaveBeenCalledWith(post.externalPostId, {
      since: undefined,
    });
    expect(comments.upsertMany).toHaveBeenCalledWith('twitter', post.id, []);
    expect(publishedPosts.touchLastSyncedAt).toHaveBeenCalledWith(
      post.id,
      expect.any(Date),
    );
  });

  it('triggers a sync when last_synced_at is older than the staleness threshold', async () => {
    const staleTime = new Date(Date.now() - STALENESS_THRESHOLD_MS - 1000);
    publishedPosts.findById.mockResolvedValue({
      ...post,
      lastSyncedAt: staleTime,
    });
    adapter.fetchComments.mockResolvedValue([]);
    comments.getCommentTree.mockResolvedValue(tree);

    await service.getCommentTreeForPost(post.id);

    expect(adapter.fetchComments).toHaveBeenCalledWith(post.externalPostId, {
      since: staleTime,
    });
  });

  it('returns the nested comment tree from the repository, mapped to the response shape', async () => {
    publishedPosts.findById.mockResolvedValue({
      ...post,
      lastSyncedAt: new Date(),
    });
    comments.getCommentTree.mockResolvedValue(tree);

    const result = await service.getCommentTreeForPost(post.id);

    expect(result).toEqual({ postId: post.id, comments: tree });
  });
});
