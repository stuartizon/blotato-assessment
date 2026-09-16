import { NotFoundException } from '@nestjs/common';
import { ReplyJobsService } from './reply-jobs.service';
import { ReplyJobsRepository } from './repositories/reply-jobs.repository';
import { CommentsRepository } from '../comments/repositories/comments.repository';
import { ReplyJobsQueueService } from './queue/reply-jobs-queue.service';

describe('ReplyJobsService', () => {
  let replyJobs: jest.Mocked<ReplyJobsRepository>;
  let comments: jest.Mocked<CommentsRepository>;
  let queue: jest.Mocked<ReplyJobsQueueService>;
  let service: ReplyJobsService;

  const comment = {
    id: 'comment-1',
    postId: 'post-1',
    platform: 'twitter' as const,
    externalCommentId: 'ext-comment-1',
  };

  const existingJob = {
    id: 'job-1',
    parentCommentId: 'comment-1',
    platform: 'twitter' as const,
    body: 'Thanks!',
    status: 'pending' as const,
    idempotencyKey: 'key-1',
    lastError: null,
    resultCommentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    replyJobs = {
      findByIdempotencyKey: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<ReplyJobsRepository>;

    comments = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<CommentsRepository>;

    queue = {
      enqueueReply: jest.fn(),
    } as unknown as jest.Mocked<ReplyJobsQueueService>;

    service = new ReplyJobsService(replyJobs, comments, queue);
  });

  it('returns the existing job without creating a new one when the idempotency key is already used', async () => {
    replyJobs.findByIdempotencyKey.mockResolvedValue(existingJob);

    const result = await service.createReply(comment.id, 'Thanks!', 'key-1');

    expect(result).toEqual({ jobId: 'job-1', status: 'pending' });
    expect(comments.findById).not.toHaveBeenCalled();
    expect(replyJobs.create).not.toHaveBeenCalled();
    expect(queue.enqueueReply).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the parent comment does not exist', async () => {
    replyJobs.findByIdempotencyKey.mockResolvedValue(null);
    comments.findById.mockResolvedValue(null);

    await expect(
      service.createReply('missing', 'Thanks!', 'key-1'),
    ).rejects.toThrow(NotFoundException);
    expect(replyJobs.create).not.toHaveBeenCalled();
  });

  it('creates a reply job on the comment platform and enqueues it', async () => {
    replyJobs.findByIdempotencyKey.mockResolvedValue(null);
    comments.findById.mockResolvedValue(comment);
    replyJobs.create.mockResolvedValue(existingJob);

    const result = await service.createReply(comment.id, 'Thanks!', 'key-1');

    expect(replyJobs.create).toHaveBeenCalledWith({
      parentCommentId: comment.id,
      platform: 'twitter',
      body: 'Thanks!',
      idempotencyKey: 'key-1',
    });
    expect(queue.enqueueReply).toHaveBeenCalledWith('job-1');
    expect(result).toEqual({ jobId: 'job-1', status: 'pending' });
  });

  it('falls back to the winning job when a concurrent request wins the idempotency-key race', async () => {
    replyJobs.findByIdempotencyKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingJob);
    comments.findById.mockResolvedValue(comment);
    replyJobs.create.mockResolvedValue(null);

    const result = await service.createReply(comment.id, 'Thanks!', 'key-1');

    expect(queue.enqueueReply).not.toHaveBeenCalled();
    expect(result).toEqual({ jobId: 'job-1', status: 'pending' });
  });
});
