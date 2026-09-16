import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/pg-pool.token';
import { Platform } from '../../comments/platform-comment-adapter.interface';

export type ReplyJobStatus = 'pending' | 'processing' | 'sent' | 'failed';

export interface ReplyJobRecord {
  id: string;
  parentCommentId: string;
  platform: Platform;
  body: string;
  status: ReplyJobStatus;
  idempotencyKey: string;
  lastError: string | null;
  resultCommentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateReplyJobParams {
  parentCommentId: string;
  platform: Platform;
  body: string;
  idempotencyKey: string;
}

const SELECT_COLUMNS = `
  id, parent_comment_id, platform, body, status,
  idempotency_key, last_error, result_comment_id, created_at, updated_at
`;

function mapRow(row: {
  id: string;
  parent_comment_id: string;
  platform: Platform;
  body: string;
  status: ReplyJobStatus;
  idempotency_key: string;
  last_error: string | null;
  result_comment_id: string | null;
  created_at: Date;
  updated_at: Date;
}): ReplyJobRecord {
  return {
    id: row.id,
    parentCommentId: row.parent_comment_id,
    platform: row.platform,
    body: row.body,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    lastError: row.last_error,
    resultCommentId: row.result_comment_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class ReplyJobsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Inserts a new reply job. Returns null, without inserting, if a job with
   * this idempotency key already exists — the unique index is the source of
   * truth, so a concurrent duplicate request can never create two jobs even
   * if both callers race past an earlier findByIdempotencyKey check.
   */
  async create(params: CreateReplyJobParams): Promise<ReplyJobRecord | null> {
    const result = await this.pool.query(
      `INSERT INTO reply_jobs (parent_comment_id, platform, body, idempotency_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING ${SELECT_COLUMNS}`,
      [
        params.parentCommentId,
        params.platform,
        params.body,
        params.idempotencyKey,
      ],
    );

    if (result.rows.length === 0) {
      return null;
    }
    return mapRow(result.rows[0]);
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<ReplyJobRecord | null> {
    const result = await this.pool.query(
      `SELECT ${SELECT_COLUMNS} FROM reply_jobs WHERE idempotency_key = $1`,
      [idempotencyKey],
    );

    if (result.rows.length === 0) {
      return null;
    }
    return mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<ReplyJobRecord | null> {
    const result = await this.pool.query(
      `SELECT ${SELECT_COLUMNS} FROM reply_jobs WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return null;
    }
    return mapRow(result.rows[0]);
  }

  async markProcessing(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE reply_jobs SET status = 'processing', updated_at = now() WHERE id = $1`,
      [id],
    );
  }

  async markSent(id: string, resultCommentId: string): Promise<void> {
    await this.pool.query(
      `UPDATE reply_jobs
       SET status = 'sent', result_comment_id = $2, updated_at = now()
       WHERE id = $1`,
      [id, resultCommentId],
    );
  }

  async markFailed(id: string, lastError: string): Promise<void> {
    await this.pool.query(
      `UPDATE reply_jobs
       SET status = 'failed', last_error = $2, updated_at = now()
       WHERE id = $1`,
      [id, lastError],
    );
  }
}
