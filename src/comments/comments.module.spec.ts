import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CommentsModule } from './comments.module';
import { CommentAdapterRegistry } from './comment-adapter-registry.service';
import { MockTwitterAdapter } from './adapters/mock-twitter.adapter';
import { NotImplementedAdapter } from './adapters/not-implemented.adapter';
import { CommentsService } from './comments.service';
import { STALENESS_THRESHOLD_MS } from './config/staleness-threshold.token';
import { DEFAULT_STALENESS_THRESHOLD_MS } from './config/staleness-threshold';
import { DatabaseModule } from '../database/database.module';

describe('CommentsModule', () => {
  it('registers the mock adapter for twitter and stubs for the rest', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DatabaseModule,
        CommentsModule,
      ],
    }).compile();

    const registry = moduleRef.get(CommentAdapterRegistry);

    expect(registry.get('twitter')).toBeInstanceOf(MockTwitterAdapter);
    expect(registry.get('instagram')).toBeInstanceOf(NotImplementedAdapter);
    expect(registry.get('linkedin')).toBeInstanceOf(NotImplementedAdapter);
    expect(registry.get('tiktok')).toBeInstanceOf(NotImplementedAdapter);
    expect(registry.get('gotosocial')).toBeInstanceOf(NotImplementedAdapter);
  });

  it('resolves CommentsService with the default staleness threshold when unset', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DatabaseModule,
        CommentsModule,
      ],
    }).compile();

    expect(moduleRef.get(CommentsService)).toBeInstanceOf(CommentsService);
    expect(moduleRef.get(STALENESS_THRESHOLD_MS)).toBe(
      DEFAULT_STALENESS_THRESHOLD_MS,
    );
  });
});
