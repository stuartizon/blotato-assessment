import { Module } from '@nestjs/common';
import { ReplyJobsController } from './reply-jobs.controller';
import { ReplyJobStatusController } from './reply-job-status.controller';
import { ReplyJobsService } from './reply-jobs.service';
import { ReplyJobsRepository } from './repositories/reply-jobs.repository';
import { ReplyJobsQueueService } from './queue/reply-jobs-queue.service';
import { ReplyJobsWorker } from './reply-jobs.worker';
import { CommentsModule } from '../comments/comments.module';

@Module({
  imports: [CommentsModule],
  controllers: [ReplyJobsController, ReplyJobStatusController],
  providers: [
    ReplyJobsService,
    ReplyJobsRepository,
    ReplyJobsQueueService,
    ReplyJobsWorker,
  ],
})
export class ReplyJobsModule {}
