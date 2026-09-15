import { BadRequestException } from '@nestjs/common';
import { ReplyJobsController } from './reply-jobs.controller';
import { ReplyJobsService } from './reply-jobs.service';

describe('ReplyJobsController', () => {
  const response = { jobId: 'job-1', status: 'pending' as const };
  let service: ReplyJobsService;
  let controller: ReplyJobsController;

  beforeEach(() => {
    service = {
      createReply: jest.fn().mockResolvedValue(response),
    } as unknown as ReplyJobsService;
    controller = new ReplyJobsController(service);
  });

  it('delegates to ReplyJobsService.createReply with the commentId, body, and idempotency key', async () => {
    const result = await controller.createReply(
      'comment-1',
      { body: 'Thanks!' },
      'key-1',
    );

    expect(service.createReply).toHaveBeenCalledWith(
      'comment-1',
      'Thanks!',
      'key-1',
    );
    expect(result).toBe(response);
  });

  it('throws BadRequestException when the Idempotency-Key header is missing', async () => {
    await expect(
      controller.createReply('comment-1', { body: 'Thanks!' }, undefined),
    ).rejects.toThrow(BadRequestException);
    expect(service.createReply).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when the request body is missing', async () => {
    await expect(
      controller.createReply('comment-1', { body: '' }, 'key-1'),
    ).rejects.toThrow(BadRequestException);
    expect(service.createReply).not.toHaveBeenCalled();
  });
});
