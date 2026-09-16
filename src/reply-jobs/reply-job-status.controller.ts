import { Controller, Get, Param } from '@nestjs/common';
import { ReplyJobsService, ReplyJobStatusResult } from './reply-jobs.service';

@Controller('reply-jobs')
export class ReplyJobStatusController {
  constructor(private readonly replyJobsService: ReplyJobsService) {}

  @Get(':jobId')
  getStatus(@Param('jobId') jobId: string): Promise<ReplyJobStatusResult> {
    return this.replyJobsService.getStatus(jobId);
  }
}
