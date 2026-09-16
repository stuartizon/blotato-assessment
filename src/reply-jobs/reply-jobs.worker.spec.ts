import * as PgBoss from 'pg-boss';
import { ReplyJobsWorker } from './reply-jobs.worker';
import { ReplyJobsRepository } from './repositories/reply-jobs.repository';
import { CommentsRepository } from '../comments/repositories/comments.repository';
import { CommentAdapterRegistry } from '../comments/comment-adapter-registry.service';
import { PlatformCommentAdapter } from '../comments/platform-comment-adapter.interface';
import { PlatformApiError } from '../comments/errors/platform-api-error';
import { REPLY_JOBS_QUEUE_NAME } from './queue/reply-jobs-queue.constants';

describe('ReplyJobsWorker', () => {
  let boss: jest.Mocked<PgBoss>;
  let replyJobs: jest.Mocked<ReplyJobsRepository>;
  let comments: jest.Mocked<CommentsRepository>;
  let registry: jest.Mocked<CommentAdapterRegistry>;
  let adapter: jest.Mocked<PlatformCommentAdapter>;
  let worker: ReplyJobsWorker;

  const replyJob = {
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

  const parentComment = {
    id: 'comment-1',
    postId: 'post-1',
    platform: 'twitter' as const,
    externalCommentId: 'ext-comment-1',
  };

  const postedReply = {
    externalCommentId: 'ext-reply-1',
    externalParentCommentId: 'ext-comment-1',
    authorExternalId: 'mock-account',
    authorDisplayName: 'Mock Account',
    body: 'Thanks!',
    postedAt: new Date('2026-01-01T00:00:00.000Z'),
    raw: {},
  };

  function job(data = { replyJobId: 'job-1' }): PgBoss.Job<typeof data>[] {
    return [
      {
        id: 'pgboss-job-1',
        name: REPLY_JOBS_QUEUE_NAME,
        data,
        expireInSeconds: 900,
      },
    ];
  }

  beforeEach(() => {
    boss = { work: jest.fn() } as unknown as jest.Mocked<PgBoss>;

    replyJobs = {
      findById: jest.fn().mockResolvedValue(replyJob),
      markProcessing: jest.fn(),
      markSent: jest.fn(),
      markFailed: jest.fn(),
    } as unknown as jest.Mocked<ReplyJobsRepository>;

    comments = {
      findById: jest.fn().mockResolvedValue(parentComment),
      upsertReply: jest.fn().mockResolvedValue('result-comment-1'),
    } as unknown as jest.Mocked<CommentsRepository>;

    adapter = {
      platform: 'twitter',
      fetchComments: jest.fn(),
      postReply: jest.fn().mockResolvedValue(postedReply),
    };

    registry = {
      get: jest.fn().mockReturnValue(adapter),
    } as unknown as jest.Mocked<CommentAdapterRegistry>;

    worker = new ReplyJobsWorker(boss, replyJobs, comments, registry);
  });

  describe('onModuleInit', () => {
    it('registers a handler for the reply-jobs queue', async () => {
      await worker.onModuleInit();

      expect(boss.work).toHaveBeenCalledWith(
        REPLY_JOBS_QUEUE_NAME,
        expect.any(Function),
      );
    });
  });

  describe('handleJob', () => {
    it('marks the job processing before calling postReply', async () => {
      await worker.handleJob(job());

      expect(replyJobs.markProcessing).toHaveBeenCalledWith('job-1');
    });

    it('posts the reply using the parent comment external id', async () => {
      await worker.handleJob(job());

      expect(registry.get).toHaveBeenCalledWith('twitter');
      expect(adapter.postReply).toHaveBeenCalledWith(
        'ext-comment-1',
        'Thanks!',
      );
    });

    it('on success, upserts the resulting comment and marks the job sent', async () => {
      await worker.handleJob(job());

      expect(comments.upsertReply).toHaveBeenCalledWith(
        'twitter',
        'post-1',
        'comment-1',
        postedReply,
      );
      expect(replyJobs.markSent).toHaveBeenCalledWith(
        'job-1',
        'result-comment-1',
      );
      expect(replyJobs.markFailed).not.toHaveBeenCalled();
    });

    it('on a non-retryable PlatformApiError, marks the job failed and swallows the error', async () => {
      const error = new PlatformApiError(
        'Simulated failure: not found',
        'twitter',
        'not_found',
        false,
      );
      adapter.postReply.mockRejectedValue(error);

      await expect(worker.handleJob(job())).resolves.not.toThrow();

      expect(replyJobs.markFailed).toHaveBeenCalledWith(
        'job-1',
        'Simulated failure: not found',
      );
      expect(comments.upsertReply).not.toHaveBeenCalled();
      expect(replyJobs.markSent).not.toHaveBeenCalled();
    });

    it('on a retryable PlatformApiError, rethrows without marking the job failed', async () => {
      const error = new PlatformApiError(
        'Simulated failure: rate limit exceeded',
        'twitter',
        'rate_limited',
        true,
      );
      adapter.postReply.mockRejectedValue(error);

      await expect(worker.handleJob(job())).rejects.toThrow(error);

      expect(replyJobs.markFailed).not.toHaveBeenCalled();
      expect(replyJobs.markSent).not.toHaveBeenCalled();
    });

    it('on an unexpected non-PlatformApiError, marks the job failed rather than rethrowing', async () => {
      adapter.postReply.mockRejectedValue(new Error('boom'));

      await expect(worker.handleJob(job())).resolves.not.toThrow();

      expect(replyJobs.markFailed).toHaveBeenCalledWith('job-1', 'boom');
    });
  });
});
