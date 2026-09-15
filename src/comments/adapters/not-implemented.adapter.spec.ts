import { NotImplementedAdapter } from './not-implemented.adapter';

describe('NotImplementedAdapter', () => {
  it('reports the platform it was constructed for', () => {
    const adapter = new NotImplementedAdapter('instagram');

    expect(adapter.platform).toBe('instagram');
  });

  it('rejects fetchComments with a message naming the platform', async () => {
    const adapter = new NotImplementedAdapter('linkedin');

    await expect(adapter.fetchComments('post-1')).rejects.toThrow(
      'linkedin adapter is not implemented',
    );
  });

  it('rejects postReply with a message naming the platform', async () => {
    const adapter = new NotImplementedAdapter('tiktok');

    await expect(adapter.postReply('comment-1', 'body')).rejects.toThrow(
      'tiktok adapter is not implemented',
    );
  });
});
