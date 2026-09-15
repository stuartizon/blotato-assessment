import { Test } from '@nestjs/testing';
import { CommentsModule } from './comments.module';
import { CommentAdapterRegistry } from './comment-adapter-registry.service';
import { MockTwitterAdapter } from './adapters/mock-twitter.adapter';
import { NotImplementedAdapter } from './adapters/not-implemented.adapter';

describe('CommentsModule', () => {
  it('registers the mock adapter for twitter and stubs for the rest', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CommentsModule],
    }).compile();

    const registry = moduleRef.get(CommentAdapterRegistry);

    expect(registry.get('twitter')).toBeInstanceOf(MockTwitterAdapter);
    expect(registry.get('instagram')).toBeInstanceOf(NotImplementedAdapter);
    expect(registry.get('linkedin')).toBeInstanceOf(NotImplementedAdapter);
    expect(registry.get('tiktok')).toBeInstanceOf(NotImplementedAdapter);
  });
});
