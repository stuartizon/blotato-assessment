import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ReplyJobsModule } from './reply-jobs.module';
import { ReplyJobsService } from './reply-jobs.service';
import { ReplyJobsController } from './reply-jobs.controller';
import { DatabaseModule } from '../database/database.module';
import { QueueModule } from '../queue/queue.module';

describe('ReplyJobsModule', () => {
  it('resolves ReplyJobsService and ReplyJobsController', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DatabaseModule,
        QueueModule,
        ReplyJobsModule,
      ],
    }).compile();

    expect(moduleRef.get(ReplyJobsService)).toBeInstanceOf(ReplyJobsService);
    expect(moduleRef.get(ReplyJobsController)).toBeInstanceOf(
      ReplyJobsController,
    );
  });
});
