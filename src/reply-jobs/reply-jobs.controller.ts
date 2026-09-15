import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { ReplyJobsService, CreateReplyResult } from './reply-jobs.service';
import { CreateReplyDto } from './dto/create-reply.dto';

@Controller('comments')
export class ReplyJobsController {
  constructor(private readonly replyJobsService: ReplyJobsService) {}

  @Post(':commentId/replies')
  @HttpCode(HttpStatus.ACCEPTED)
  async createReply(
    @Param('commentId') commentId: string,
    @Body() dto: CreateReplyDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<CreateReplyResult> {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    if (!dto?.body) {
      throw new BadRequestException('body is required');
    }

    return this.replyJobsService.createReply(
      commentId,
      dto.body,
      idempotencyKey,
    );
  }
}
