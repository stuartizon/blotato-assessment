import * as PgBoss from 'pg-boss';
import { ReplyJobsQueueService } from './reply-jobs-queue.service';
import { REPLY_JOBS_QUEUE_NAME } from './reply-jobs-queue.constants';

describe('ReplyJobsQueueService', () => {
  let boss: jest.Mocked<PgBoss>;
  let service: ReplyJobsQueueService;

  beforeEach(() => {
    boss = {
      createQueue: jest.fn(),
      send: jest.fn(),
    } as unknown as jest.Mocked<PgBoss>;

    service = new ReplyJobsQueueService(boss);
  });

  describe('onModuleInit', () => {
    it('ensures the reply-jobs queue exists', async () => {
      await service.onModuleInit();

      expect(boss.createQueue).toHaveBeenCalledWith(REPLY_JOBS_QUEUE_NAME);
    });
  });

  describe('enqueueReply', () => {
    it('sends a job carrying the reply job id to the reply-jobs queue', async () => {
      await service.enqueueReply('job-1');

      expect(boss.send).toHaveBeenCalledWith(REPLY_JOBS_QUEUE_NAME, {
        replyJobId: 'job-1',
      });
    });
  });
});
