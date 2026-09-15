import { Controller, Get, Param } from '@nestjs/common';
import { CommentsService, PostCommentsResponse } from './comments.service';

@Controller('posts')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Get(':postId/comments')
  getComments(@Param('postId') postId: string): Promise<PostCommentsResponse> {
    return this.commentsService.getCommentTreeForPost(postId);
  }
}
