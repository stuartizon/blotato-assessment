import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import * as PgBoss from 'pg-boss';
import { PG_BOSS } from '../../queue/pg-boss.token';
import {
  REPLY_JOBS_QUEUE_NAME,
  ReplyJobQueuePayload,
} from './reply-jobs-queue.constants';

@Injectable()
export class ReplyJobsQueueService implements OnModuleInit {
  constructor(@Inject(PG_BOSS) private readonly boss: PgBoss) {}

  onModuleInit(): Promise<void> {
    return this.boss.createQueue(REPLY_JOBS_QUEUE_NAME);
  }

  async enqueueReply(replyJobId: string): Promise<void> {
    const payload: ReplyJobQueuePayload = { replyJobId };
    await this.boss.send(REPLY_JOBS_QUEUE_NAME, payload);
  }
}
