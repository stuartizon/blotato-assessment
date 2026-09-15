import { Pool } from 'pg';
import { ReplyJobsRepository } from './reply-jobs.repository';

describe('ReplyJobsRepository', () => {
  let pool: Pool;
  let repository: ReplyJobsRepository;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    repository = new ReplyJobsRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE reply_jobs, comments, published_posts CASCADE');
  });

  async function insertComment(): Promise<string> {
    const postResult = await pool.query(
      `INSERT INTO published_posts (platform, external_post_id)
       VALUES ('twitter', 'ext-post-1')
       RETURNING id`,
    );
    const postId = postResult.rows[0].id as string;

    const commentResult = await pool.query(
      `INSERT INTO comments (
         post_id, platform, external_comment_id,
         author_external_id, author_display_name, body, raw_payload
       )
       VALUES ($1, 'twitter', 'ext-comment-1', 'user-1', 'User One', 'Hi', '{}')
       RETURNING id`,
      [postId],
    );
    return commentResult.rows[0].id as string;
  }

  describe('create', () => {
    it('inserts a pending reply job and returns it mapped to camelCase fields', async () => {
      const commentId = await insertComment();

      const job = await repository.create({
        parentCommentId: commentId,
        platform: 'twitter',
        body: 'Thanks!',
        idempotencyKey: 'key-1',
      });

      expect(job).toMatchObject({
        parentCommentId: commentId,
        platform: 'twitter',
        body: 'Thanks!',
        status: 'pending',
        idempotencyKey: 'key-1',
        lastError: null,
        resultCommentId: null,
      });
      expect(job!.id).toEqual(expect.any(String));
    });

    it('returns null instead of inserting when the idempotency key already exists', async () => {
      const commentId = await insertComment();
      await repository.create({
        parentCommentId: commentId,
        platform: 'twitter',
        body: 'First',
        idempotencyKey: 'dup-key',
      });

      const result = await repository.create({
        parentCommentId: commentId,
        platform: 'twitter',
        body: 'Second',
        idempotencyKey: 'dup-key',
      });

      expect(result).toBeNull();
      const rows = await pool.query(
        `SELECT body FROM reply_jobs WHERE idempotency_key = 'dup-key'`,
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].body).toBe('First');
    });
  });

  describe('findByIdempotencyKey', () => {
    it('returns null when no job has that key', async () => {
      const result = await repository.findByIdempotencyKey('missing');

      expect(result).toBeNull();
    });

    it('returns the job mapped to camelCase fields', async () => {
      const commentId = await insertComment();
      await repository.create({
        parentCommentId: commentId,
        platform: 'twitter',
        body: 'Thanks!',
        idempotencyKey: 'key-1',
      });

      const result = await repository.findByIdempotencyKey('key-1');

      expect(result).toMatchObject({
        parentCommentId: commentId,
        platform: 'twitter',
        body: 'Thanks!',
        status: 'pending',
        idempotencyKey: 'key-1',
      });
    });
  });
});
