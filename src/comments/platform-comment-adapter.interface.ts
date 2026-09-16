export type Platform =
  'twitter' | 'instagram' | 'linkedin' | 'tiktok' | 'gotosocial';

export interface CanonicalComment {
  externalCommentId: string;
  externalParentCommentId: string | null; // null = top-level comment
  authorExternalId: string;
  authorDisplayName: string;
  body: string;
  postedAt: Date | null; // the platform's own timestamp, if provided
  raw: unknown; // untouched platform payload -> stored into raw_payload
}

export interface FetchCommentsOptions {
  since?: Date; // used for incremental sync — only fetch comments newer than this
}

export interface PlatformCommentAdapter {
  readonly platform: Platform;

  /**
   * Fetches all comments for a post. Adapters own pagination internally
   * (cursors, tokens, offsets — whatever the platform requires) and
   * normalize the platform's actual threading behavior (e.g. flattening
   * deep reply chains) into CanonicalComment's parent/child shape.
   * Pagination mechanics are never exposed on this interface.
   */
  fetchComments(
    externalPostId: string,
    options?: FetchCommentsOptions,
  ): Promise<CanonicalComment[]>;

  /**
   * Posts a reply to a comment on the platform. Throws PlatformApiError
   * (see error-shape.md) on failure. This method is synchronous from the
   * adapter's point of view — it knows nothing about jobs, queues, or
   * retries; that's the worker's responsibility, layered on top.
   */
  postReply(
    externalParentCommentId: string,
    body: string,
  ): Promise<CanonicalComment>;
}
