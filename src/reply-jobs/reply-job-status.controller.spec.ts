import { ReplyJobStatusController } from './reply-job-status.controller';
import { ReplyJobsService } from './reply-jobs.service';

describe('ReplyJobStatusController', () => {
  const response = { jobId: 'job-1', status: 'pending' as const };
  let service: ReplyJobsService;
  let controller: ReplyJobStatusController;

  beforeEach(() => {
    service = {
      getStatus: jest.fn().mockResolvedValue(response),
    } as unknown as ReplyJobsService;
    controller = new ReplyJobStatusController(service);
  });

  it('delegates to ReplyJobsService.getStatus with the jobId', async () => {
    const result = await controller.getStatus('job-1');

    expect(service.getStatus).toHaveBeenCalledWith('job-1');
    expect(result).toBe(response);
  });
});
