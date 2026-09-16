import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ReplyJobsRepository,
  ReplyJobStatus,
} from './repositories/reply-jobs.repository';
import {
  CommentResultSummary,
  CommentsRepository,
} from '../comments/repositories/comments.repository';
import { ReplyJobsQueueService } from './queue/reply-jobs-queue.service';

export interface CreateReplyResult {
  jobId: string;
  status: ReplyJobStatus;
}

export interface ReplyJobStatusResult {
  jobId: string;
  status: ReplyJobStatus;
  resultComment?: CommentResultSummary;
  lastError?: string;
}

@Injectable()
export class ReplyJobsService {
  constructor(
    private readonly replyJobs: ReplyJobsRepository,
    private readonly comments: CommentsRepository,
    private readonly queue: ReplyJobsQueueService,
  ) {}

  async createReply(
    commentId: string,
    body: string,
    idempotencyKey: string,
  ): Promise<CreateReplyResult> {
    const existing = await this.replyJobs.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return { jobId: existing.id, status: existing.status };
    }

    const comment = await this.comments.findById(commentId);
    if (!comment) {
      throw new NotFoundException(`No comment found with id ${commentId}`);
    }

    const created = await this.replyJobs.create({
      parentCommentId: commentId,
      platform: comment.platform,
      body,
      idempotencyKey,
    });

    if (created === null) {
      // Lost a race against a concurrent request bearing the same
      // idempotency key — the row it just inserted is the source of truth.
      const winner = await this.replyJobs.findByIdempotencyKey(idempotencyKey);
      return { jobId: winner!.id, status: winner!.status };
    }

    await this.queue.enqueueReply(created.id);
    return { jobId: created.id, status: created.status };
  }

  async getStatus(jobId: string): Promise<ReplyJobStatusResult> {
    const job = await this.replyJobs.findById(jobId);
    if (!job) {
      throw new NotFoundException(`No reply job found with id ${jobId}`);
    }

    const result: ReplyJobStatusResult = { jobId: job.id, status: job.status };

    if (job.status === 'sent' && job.resultCommentId) {
      // result_comment_id is only ever set once the comment has been
      // upserted (see ReplyJobsWorker), so the row is guaranteed to exist.
      result.resultComment = (await this.comments.findResultComment(
        job.resultCommentId,
      ))!;
    } else if (job.status === 'failed' && job.lastError) {
      result.lastError = job.lastError;
    }

    return result;
  }
}
