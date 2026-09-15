import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/pg-pool.token';
import { Platform } from '../platform-comment-adapter.interface';

export interface PublishedPostRecord {
  id: string;
  platform: Platform;
  externalPostId: string;
  lastSyncedAt: Date | null;
}

@Injectable()
export class PublishedPostsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findById(id: string): Promise<PublishedPostRecord | null> {
    const result = await this.pool.query(
      `SELECT id, platform, external_post_id, last_synced_at
       FROM published_posts
       WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      platform: row.platform,
      externalPostId: row.external_post_id,
      lastSyncedAt: row.last_synced_at,
    };
  }

  async touchLastSyncedAt(id: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE published_posts SET last_synced_at = $2 WHERE id = $1`,
      [id, at],
    );
  }
}
