import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import * as PgBoss from 'pg-boss';
import { PG_BOSS } from '../../queue/pg-boss.token';
import {
  REPLY_JOBS_QUEUE_NAME,
  ReplyJobQueuePayload,
} from './reply-jobs-queue.constants';

// Retry policy for posting a reply — see docs/ASSUMPTIONS.md, "Async reply
// pipeline". Only engaged when the worker rethrows a retryable
// PlatformApiError; non-retryable failures mark the job failed immediately
// and are never handed back to pg-boss for another attempt.
const RETRY_LIMIT = 5;
const RETRY_DELAY_SECONDS = 5;

@Injectable()
export class ReplyJobsQueueService implements OnModuleInit {
  constructor(@Inject(PG_BOSS) private readonly boss: PgBoss) {}

  async onModuleInit(): Promise<void> {
    const options = {
      // v10's `Queue` type redundantly requires `name` in options too, on
      // top of the positional argument below — fixed in later pg-boss
      // majors, but this project is pinned to v10 (see ASSUMPTIONS.md).
      name: REPLY_JOBS_QUEUE_NAME,
      retryLimit: RETRY_LIMIT,
      retryDelay: RETRY_DELAY_SECONDS,
      retryBackoff: true,
    };
    await this.boss.createQueue(REPLY_JOBS_QUEUE_NAME, options);
    // createQueue is a no-op if the queue already exists (e.g. from a
    // previous deploy) — updateQueue is what actually applies a retry
    // policy change to an existing queue.
    await this.boss.updateQueue(REPLY_JOBS_QUEUE_NAME, options);
  }

  async enqueueReply(replyJobId: string): Promise<void> {
    const payload: ReplyJobQueuePayload = { replyJobId };
    await this.boss.send(REPLY_JOBS_QUEUE_NAME, payload);
  }
}
