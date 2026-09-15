import { Module } from '@nestjs/common';
import { ReplyJobsController } from './reply-jobs.controller';
import { ReplyJobsService } from './reply-jobs.service';
import { ReplyJobsRepository } from './repositories/reply-jobs.repository';
import { ReplyJobsQueueService } from './queue/reply-jobs-queue.service';
import { CommentsModule } from '../comments/comments.module';

@Module({
  imports: [CommentsModule],
  controllers: [ReplyJobsController],
  providers: [ReplyJobsService, ReplyJobsRepository, ReplyJobsQueueService],
})
export class ReplyJobsModule {}
