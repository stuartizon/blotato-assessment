import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PublishedPostsRepository } from './repositories/published-posts.repository';
import {
  CommentsRepository,
  CommentTreeNode,
} from './repositories/comments.repository';
import { CommentAdapterRegistry } from './comment-adapter-registry.service';
import { STALENESS_THRESHOLD_MS } from './config/staleness-threshold.token';

export interface PostCommentsResponse {
  postId: string;
  comments: CommentTreeNode[];
}

@Injectable()
export class CommentsService {
  constructor(
    private readonly publishedPosts: PublishedPostsRepository,
    private readonly comments: CommentsRepository,
    private readonly adapterRegistry: CommentAdapterRegistry,
    @Inject(STALENESS_THRESHOLD_MS)
    private readonly stalenessThresholdMs: number,
  ) {}

  async getCommentTreeForPost(postId: string): Promise<PostCommentsResponse> {
    const post = await this.publishedPosts.findById(postId);
    if (!post) {
      throw new NotFoundException(`No published post found with id ${postId}`);
    }

    if (this.isStale(post.lastSyncedAt)) {
      const adapter = this.adapterRegistry.get(post.platform);
      const freshComments = await adapter.fetchComments(post.externalPostId, {
        since: post.lastSyncedAt ?? undefined,
      });
      await this.comments.upsertMany(post.platform, post.id, freshComments);
      await this.publishedPosts.touchLastSyncedAt(post.id, new Date());
    }

    const tree = await this.comments.getCommentTree(post.id);
    return { postId: post.id, comments: tree };
  }

  private isStale(lastSyncedAt: Date | null): boolean {
    if (lastSyncedAt === null) {
      return true;
    }
    return Date.now() - lastSyncedAt.getTime() > this.stalenessThresholdMs;
  }
}
