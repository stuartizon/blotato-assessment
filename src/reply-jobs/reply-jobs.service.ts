import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ReplyJobsRepository,
  ReplyJobStatus,
} from './repositories/reply-jobs.repository';
import { CommentsRepository } from '../comments/repositories/comments.repository';
import { ReplyJobsQueueService } from './queue/reply-jobs-queue.service';

export interface CreateReplyResult {
  jobId: string;
  status: ReplyJobStatus;
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
}
