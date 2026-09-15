import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

describe('CommentsController', () => {
  it('delegates to CommentsService.getCommentTreeForPost with the postId param', async () => {
    const response = { postId: 'post-1', comments: [] };
    const service = {
      getCommentTreeForPost: jest.fn().mockResolvedValue(response),
    } as unknown as CommentsService;
    const controller = new CommentsController(service);

    const result = await controller.getComments('post-1');

    expect(service.getCommentTreeForPost).toHaveBeenCalledWith('post-1');
    expect(result).toBe(response);
  });
});
