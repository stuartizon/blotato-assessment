import { ConfigModule } from '@nestjs/config';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ReplyJobsModule } from './reply-jobs.module';
import { ReplyJobsService } from './reply-jobs.service';
import { ReplyJobsController } from './reply-jobs.controller';
import { DatabaseModule } from '../database/database.module';
import { PG_BOSS } from '../queue/pg-boss.token';

// PgBoss validates its connection config synchronously in its constructor
// (unlike pg's Pool, which connects lazily), so wiring the real QueueModule
// here would require a live DATABASE_URL just to compile this DI-wiring
// test. A fake stands in as PG_BOSS's provider instead.
@Global()
@Module({
  providers: [
    { provide: PG_BOSS, useValue: { createQueue: jest.fn(), send: jest.fn() } },
  ],
  exports: [PG_BOSS],
})
class FakeQueueModule {}

describe('ReplyJobsModule', () => {
  it('resolves ReplyJobsService and ReplyJobsController', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DatabaseModule,
        FakeQueueModule,
        ReplyJobsModule,
      ],
    }).compile();

    expect(moduleRef.get(ReplyJobsService)).toBeInstanceOf(ReplyJobsService);
    expect(moduleRef.get(ReplyJobsController)).toBeInstanceOf(
      ReplyJobsController,
    );
  });
});
