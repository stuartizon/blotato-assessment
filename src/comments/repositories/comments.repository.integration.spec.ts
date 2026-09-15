import { Pool } from 'pg';
import { CommentsRepository } from './comments.repository';
import { CanonicalComment } from '../platform-comment-adapter.interface';

describe('CommentsRepository', () => {
  let pool: Pool;
  let repository: CommentsRepository;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    repository = new CommentsRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE reply_jobs, comments, published_posts CASCADE');
  });

  async function insertPost(): Promise<string> {
    const result = await pool.query(
      `INSERT INTO published_posts (platform, external_post_id)
       VALUES ('twitter', 'ext-post-1')
       RETURNING id`,
    );
    return result.rows[0].id as string;
  }

  function comment(overrides: Partial<CanonicalComment>): CanonicalComment {
    return {
      externalCommentId: 'c1',
      externalParentCommentId: null,
      authorExternalId: 'user-1',
      authorDisplayName: 'User One',
      body: 'Hello',
      postedAt: new Date('2026-01-01T00:00:00.000Z'),
      raw: { some: 'payload' },
      ...overrides,
    };
  }

  describe('upsertMany', () => {
    it('inserts top-level comments with the raw payload preserved', async () => {
      const postId = await insertPost();

      await repository.upsertMany('twitter', postId, [
        comment({ externalCommentId: 'c1', raw: { id: 'c1', extra: true } }),
      ]);

      const result = await pool.query(
        `SELECT * FROM comments WHERE post_id = $1`,
        [postId],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        post_id: postId,
        platform: 'twitter',
        external_comment_id: 'c1',
        parent_comment_id: null,
        author_external_id: 'user-1',
        author_display_name: 'User One',
        body: 'Hello',
        raw_payload: { id: 'c1', extra: true },
      });
    });

    it('resolves a reply to its parent within the same batch, regardless of array order', async () => {
      const postId = await insertPost();

      await repository.upsertMany('twitter', postId, [
        comment({
          externalCommentId: 'reply-1',
          externalParentCommentId: 'top-1',
          body: 'A reply',
        }),
        comment({
          externalCommentId: 'top-1',
          externalParentCommentId: null,
          body: 'A top-level comment',
        }),
      ]);

      const result = await pool.query(
        `SELECT external_comment_id, parent_comment_id FROM comments WHERE post_id = $1`,
        [postId],
      );
      const byExternalId = new Map(
        result.rows.map((r) => [r.external_comment_id, r.parent_comment_id]),
      );

      expect(byExternalId.get('top-1')).toBeNull();
      const topRow = await pool.query(
        `SELECT id FROM comments WHERE external_comment_id = 'top-1'`,
      );
      expect(byExternalId.get('reply-1')).toBe(topRow.rows[0].id);
    });

    it('resolves a reply to a parent already persisted from a prior sync', async () => {
      const postId = await insertPost();
      await repository.upsertMany('twitter', postId, [
        comment({ externalCommentId: 'top-1', externalParentCommentId: null }),
      ]);

      await repository.upsertMany('twitter', postId, [
        comment({
          externalCommentId: 'reply-1',
          externalParentCommentId: 'top-1',
        }),
      ]);

      const topRow = await pool.query(
        `SELECT id FROM comments WHERE external_comment_id = 'top-1'`,
      );
      const replyRow = await pool.query(
        `SELECT parent_comment_id FROM comments WHERE external_comment_id = 'reply-1'`,
      );
      expect(replyRow.rows[0].parent_comment_id).toBe(topRow.rows[0].id);
    });

    it('updates body and bumps updated_at when an existing comment is edited', async () => {
      const postId = await insertPost();
      await repository.upsertMany('twitter', postId, [
        comment({ externalCommentId: 'c1', body: 'Original body' }),
      ]);
      const before = await pool.query(
        `SELECT body, updated_at FROM comments WHERE external_comment_id = 'c1'`,
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      await repository.upsertMany('twitter', postId, [
        comment({ externalCommentId: 'c1', body: 'Edited body' }),
      ]);

      const after = await pool.query(
        `SELECT body, updated_at FROM comments WHERE external_comment_id = 'c1'`,
      );
      expect(after.rows[0].body).toBe('Edited body');
      expect(after.rows[0].updated_at.getTime()).toBeGreaterThan(
        before.rows[0].updated_at.getTime(),
      );
    });

    it('does not bump updated_at when re-synced with an unchanged body', async () => {
      const postId = await insertPost();
      await repository.upsertMany('twitter', postId, [
        comment({ externalCommentId: 'c1', body: 'Same body' }),
      ]);
      const before = await pool.query(
        `SELECT updated_at FROM comments WHERE external_comment_id = 'c1'`,
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      await repository.upsertMany('twitter', postId, [
        comment({ externalCommentId: 'c1', body: 'Same body' }),
      ]);

      const after = await pool.query(
        `SELECT updated_at FROM comments WHERE external_comment_id = 'c1'`,
      );
      expect(after.rows[0].updated_at.getTime()).toBe(
        before.rows[0].updated_at.getTime(),
      );
    });

    it('does nothing for an empty array', async () => {
      const postId = await insertPost();

      await expect(
        repository.upsertMany('twitter', postId, []),
      ).resolves.not.toThrow();
    });
  });

  describe('findById', () => {
    it('returns null when no comment exists with that id', async () => {
      const result = await repository.findById(
        '00000000-0000-0000-0000-000000000000',
      );

      expect(result).toBeNull();
    });

    it('returns the comment mapped to camelCase fields, including its platform', async () => {
      const postId = await insertPost();
      await repository.upsertMany('twitter', postId, [
        comment({ externalCommentId: 'c1' }),
      ]);
      const row = await pool.query(
        `SELECT id FROM comments WHERE external_comment_id = 'c1'`,
      );
      const commentId = row.rows[0].id as string;

      const result = await repository.findById(commentId);

      expect(result).toEqual({
        id: commentId,
        platform: 'twitter',
        externalCommentId: 'c1',
      });
    });
  });

  describe('getCommentTree', () => {
    it('returns an empty array for a post with no comments', async () => {
      const postId = await insertPost();

      const tree = await repository.getCommentTree(postId);

      expect(tree).toEqual([]);
    });

    it('nests replies under their parent, arbitrarily deep', async () => {
      const postId = await insertPost();
      await repository.upsertMany('twitter', postId, [
        comment({
          externalCommentId: 'top-1',
          externalParentCommentId: null,
          body: 'Top',
          postedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
        comment({
          externalCommentId: 'reply-1',
          externalParentCommentId: 'top-1',
          body: 'Reply',
          postedAt: new Date('2026-01-01T00:01:00.000Z'),
        }),
        comment({
          externalCommentId: 'reply-1-1',
          externalParentCommentId: 'reply-1',
          body: 'Nested reply',
          postedAt: new Date('2026-01-01T00:02:00.000Z'),
        }),
      ]);

      const tree = await repository.getCommentTree(postId);

      expect(tree).toHaveLength(1);
      expect(tree[0].body).toBe('Top');
      expect(tree[0].replies).toHaveLength(1);
      expect(tree[0].replies[0].body).toBe('Reply');
      expect(tree[0].replies[0].replies).toHaveLength(1);
      expect(tree[0].replies[0].replies[0].body).toBe('Nested reply');
      expect(tree[0].replies[0].replies[0].replies).toEqual([]);
    });

    it('only returns comments for the given post', async () => {
      const postA = await insertPost();
      const postBResult = await pool.query(
        `INSERT INTO published_posts (platform, external_post_id) VALUES ('twitter', 'ext-post-2') RETURNING id`,
      );
      const postB = postBResult.rows[0].id as string;

      await repository.upsertMany('twitter', postA, [
        comment({ externalCommentId: 'a1', body: 'Comment on post A' }),
      ]);
      await repository.upsertMany('twitter', postB, [
        comment({ externalCommentId: 'b1', body: 'Comment on post B' }),
      ]);

      const treeA = await repository.getCommentTree(postA);

      expect(treeA).toHaveLength(1);
      expect(treeA[0].body).toBe('Comment on post A');
    });
  });
});
