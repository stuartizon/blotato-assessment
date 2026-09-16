import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CommentsModule } from './comments.module';
import { CommentAdapterRegistry } from './comment-adapter-registry.service';
import { MockTwitterAdapter } from './adapters/mock-twitter.adapter';
import { NotImplementedAdapter } from './adapters/not-implemented.adapter';
import { GoToSocialAdapter } from './adapters/gotosocial.adapter';
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

  it('registers a real GoToSocialAdapter when GTS_ACCESS_TOKEN is configured', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              GTS_ACCESS_TOKEN: 'test-token',
              GTS_BASE_URL: 'http://gotosocial.test',
            }),
          ],
        }),
        DatabaseModule,
        CommentsModule,
      ],
    }).compile();

    const registry = moduleRef.get(CommentAdapterRegistry);

    expect(registry.get('gotosocial')).toBeInstanceOf(GoToSocialAdapter);
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
