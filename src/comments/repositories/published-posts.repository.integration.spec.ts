import { Pool } from 'pg';
import { PublishedPostsRepository } from './published-posts.repository';

describe('PublishedPostsRepository', () => {
  let pool: Pool;
  let repository: PublishedPostsRepository;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    repository = new PublishedPostsRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE reply_jobs, comments, published_posts CASCADE');
  });

  async function insertPost(overrides: {
    platform?: string;
    externalPostId?: string;
    lastSyncedAt?: Date | null;
  }): Promise<string> {
    const platform = overrides.platform ?? 'twitter';
    const externalPostId = overrides.externalPostId ?? 'ext-post-1';
    const lastSyncedAt = overrides.lastSyncedAt ?? null;

    const result = await pool.query(
      `INSERT INTO published_posts (platform, external_post_id, last_synced_at)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [platform, externalPostId, lastSyncedAt],
    );
    return result.rows[0].id as string;
  }

  describe('findById', () => {
    it('returns null when no post exists with that id', async () => {
      const result = await repository.findById(
        '00000000-0000-0000-0000-000000000000',
      );

      expect(result).toBeNull();
    });

    it('returns the post mapped to camelCase fields', async () => {
      const lastSyncedAt = new Date('2026-01-01T00:00:00.000Z');
      const id = await insertPost({
        platform: 'twitter',
        externalPostId: 'ext-post-42',
        lastSyncedAt,
      });

      const result = await repository.findById(id);

      expect(result).toEqual({
        id,
        platform: 'twitter',
        externalPostId: 'ext-post-42',
        lastSyncedAt,
      });
    });

    it('returns lastSyncedAt as null when never synced', async () => {
      const id = await insertPost({ lastSyncedAt: null });

      const result = await repository.findById(id);

      expect(result?.lastSyncedAt).toBeNull();
    });
  });

  describe('touchLastSyncedAt', () => {
    it('updates last_synced_at to the given timestamp', async () => {
      const id = await insertPost({ lastSyncedAt: null });
      const now = new Date('2026-06-01T12:00:00.000Z');

      await repository.touchLastSyncedAt(id, now);

      const result = await repository.findById(id);
      expect(result?.lastSyncedAt).toEqual(now);
    });
  });
});
