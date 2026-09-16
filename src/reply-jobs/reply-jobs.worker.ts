import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import * as PgBoss from 'pg-boss';
import { PG_BOSS } from '../queue/pg-boss.token';
import { ReplyJobsRepository } from './repositories/reply-jobs.repository';
import { CommentsRepository } from '../comments/repositories/comments.repository';
import { CommentAdapterRegistry } from '../comments/comment-adapter-registry.service';
import { PlatformApiError } from '../comments/errors/platform-api-error';
import {
  REPLY_JOBS_QUEUE_NAME,
  ReplyJobQueuePayload,
} from './queue/reply-jobs-queue.constants';

/**
 * Consumes reply_jobs off the pg-boss queue and posts them to the relevant
 * platform. Retry vs. give-up follows docs/error-shape.md exactly: a
 * retryable PlatformApiError is rethrown so pg-boss's own retry/backoff
 * policy (see ReplyJobsQueueService) handles it — the job's DB status is
 * never touched on that path — while anything else (a non-retryable
 * PlatformApiError, or an unrecognized error) marks the job failed and is
 * swallowed so pg-boss doesn't retry it.
 */
@Injectable()
export class ReplyJobsWorker implements OnModuleInit {
  constructor(
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    private readonly replyJobs: ReplyJobsRepository,
    private readonly comments: CommentsRepository,
    private readonly adapterRegistry: CommentAdapterRegistry,
  ) {}

  onModuleInit(): Promise<string> {
    return this.boss.work<ReplyJobQueuePayload>(REPLY_JOBS_QUEUE_NAME, (jobs) =>
      this.handleJob(jobs),
    );
  }

  async handleJob(jobs: PgBoss.Job<ReplyJobQueuePayload>[]): Promise<void> {
    const { replyJobId } = jobs[0].data;
    // Both rows are guaranteed to exist: the reply_jobs row is created
    // before this job is ever enqueued, and its parent_comment_id is a
    // non-nullable FK — this system never hard-deletes comments.
    const replyJob = (await this.replyJobs.findById(replyJobId))!;
    await this.replyJobs.markProcessing(replyJob.id);
    const parentComment = (await this.comments.findById(
      replyJob.parentCommentId,
    ))!;

    const adapter = this.adapterRegistry.get(replyJob.platform);

    try {
      const result = await adapter.postReply(
        parentComment.externalCommentId,
        replyJob.body,
      );
      const resultCommentId = await this.comments.upsertReply(
        replyJob.platform,
        parentComment.postId,
        parentComment.id,
        result,
      );
      await this.replyJobs.markSent(replyJob.id, resultCommentId);
    } catch (err) {
      if (err instanceof PlatformApiError && err.retryable) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      await this.replyJobs.markFailed(replyJob.id, message);
    }
  }
}
