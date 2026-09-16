import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../../database/pg-pool.token';
import {
  CanonicalComment,
  Platform,
} from '../platform-comment-adapter.interface';

export interface CommentTreeNode {
  id: string;
  authorDisplayName: string;
  body: string;
  postedAt: Date | null;
  replies: CommentTreeNode[];
}

export interface CommentRecord {
  id: string;
  postId: string;
  platform: Platform;
  externalCommentId: string;
}

// Just enough of Pool/PoolClient's shared shape to run a query — lets
// upsertOne run either inside upsertMany's transaction or standalone (see
// upsertReply) without duplicating the upsert SQL.
type Queryable = Pick<PoolClient, 'query'>;

@Injectable()
export class CommentsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findById(id: string): Promise<CommentRecord | null> {
    const result = await this.pool.query(
      `SELECT id, post_id, platform, external_comment_id FROM comments WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      postId: row.post_id,
      platform: row.platform,
      externalCommentId: row.external_comment_id,
    };
  }

  /**
   * Upserts a single reply once the platform has confirmed it (see
   * docs/ASSUMPTIONS.md, "Platform is always authoritative for writes").
   * The parent is already known internally (it's the comment being replied
   * to), so unlike upsertMany this never needs to resolve it by external id.
   */
  async upsertReply(
    platform: Platform,
    postId: string,
    parentCommentId: string,
    comment: CanonicalComment,
  ): Promise<string> {
    return this.upsertOne(
      this.pool,
      platform,
      postId,
      comment,
      parentCommentId,
    );
  }

  /**
   * Upserts a batch of adapter-fetched comments for a post. A comment whose
   * parent isn't in this batch is resolved against already-persisted rows
   * (the normal case for an incremental, `since`-bounded sync); a comment
   * edited since the last sync has its body/raw_payload updated in place —
   * see docs/ASSUMPTIONS.md, "Comment editing and deletion".
   */
  async upsertMany(
    platform: Platform,
    postId: string,
    comments: CanonicalComment[],
  ): Promise<void> {
    if (comments.length === 0) {
      return;
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const internalIdByExternalId = new Map<string, string>();
      let remaining = comments;

      while (remaining.length > 0) {
        const stillUnresolved: CanonicalComment[] = [];

        for (const comment of remaining) {
          const parentInternalId = await this.resolveParentId(
            client,
            platform,
            comment.externalParentCommentId,
            internalIdByExternalId,
          );

          if (
            comment.externalParentCommentId !== null &&
            parentInternalId === undefined
          ) {
            stillUnresolved.push(comment);
            continue;
          }

          const id = await this.upsertOne(
            client,
            platform,
            postId,
            comment,
            parentInternalId ?? null,
          );
          internalIdByExternalId.set(comment.externalCommentId, id);
        }

        if (stillUnresolved.length === remaining.length) {
          // None of these comments' parents could be resolved, in-batch or
          // in the DB — a genuinely orphaned reply. Insert as top-level
          // rather than dropping the comment.
          for (const comment of stillUnresolved) {
            const id = await this.upsertOne(
              client,
              platform,
              postId,
              comment,
              null,
            );
            internalIdByExternalId.set(comment.externalCommentId, id);
          }
          break;
        }

        remaining = stillUnresolved;
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getCommentTree(postId: string): Promise<CommentTreeNode[]> {
    const result = await this.pool.query(
      `WITH RECURSIVE thread AS (
         SELECT id, parent_comment_id, author_display_name, body, posted_at, 0 AS depth
         FROM comments
         WHERE post_id = $1 AND parent_comment_id IS NULL
         UNION ALL
         SELECT c.id, c.parent_comment_id, c.author_display_name, c.body, c.posted_at, thread.depth + 1
         FROM comments c
         JOIN thread ON c.parent_comment_id = thread.id
       )
       SELECT * FROM thread ORDER BY depth ASC, posted_at ASC NULLS LAST`,
      [postId],
    );

    const nodeById = new Map<string, CommentTreeNode>();
    const roots: CommentTreeNode[] = [];

    for (const row of result.rows) {
      const node: CommentTreeNode = {
        id: row.id,
        authorDisplayName: row.author_display_name,
        body: row.body,
        postedAt: row.posted_at,
        replies: [],
      };
      nodeById.set(node.id, node);

      if (row.parent_comment_id === null) {
        roots.push(node);
      } else {
        // Depth-ascending order guarantees the parent was already visited.
        nodeById.get(row.parent_comment_id)!.replies.push(node);
      }
    }

    return roots;
  }

  private async resolveParentId(
    client: Queryable,
    platform: Platform,
    externalParentCommentId: string | null,
    internalIdByExternalId: Map<string, string>,
  ): Promise<string | null | undefined> {
    if (externalParentCommentId === null) {
      return null;
    }

    const inBatch = internalIdByExternalId.get(externalParentCommentId);
    if (inBatch !== undefined) {
      return inBatch;
    }

    const result = await client.query(
      `SELECT id FROM comments WHERE platform = $1 AND external_comment_id = $2`,
      [platform, externalParentCommentId],
    );
    if (result.rows.length > 0) {
      return result.rows[0].id;
    }

    return undefined;
  }

  private async upsertOne(
    client: Queryable,
    platform: Platform,
    postId: string,
    comment: CanonicalComment,
    parentInternalId: string | null,
  ): Promise<string> {
    const result = await client.query(
      `INSERT INTO comments (
         post_id, platform, external_comment_id, parent_comment_id,
         author_external_id, author_display_name, body, raw_payload, posted_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (platform, external_comment_id) DO UPDATE SET
         body = EXCLUDED.body,
         raw_payload = EXCLUDED.raw_payload,
         fetched_at = now(),
         updated_at = CASE
           WHEN comments.body IS DISTINCT FROM EXCLUDED.body THEN now()
           ELSE comments.updated_at
         END
       RETURNING id`,
      [
        postId,
        platform,
        comment.externalCommentId,
        parentInternalId,
        comment.authorExternalId,
        comment.authorDisplayName,
        comment.body,
        JSON.stringify(comment.raw),
        comment.postedAt,
      ],
    );
    return result.rows[0].id;
  }
}
