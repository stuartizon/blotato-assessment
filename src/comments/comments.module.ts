import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdapterMap, ADAPTER_MAP } from './adapter-map.token';
import { CommentAdapterRegistry } from './comment-adapter-registry.service';
import {
  Platform,
  PlatformCommentAdapter,
} from './platform-comment-adapter.interface';
import { MockTwitterAdapter } from './adapters/mock-twitter.adapter';
import { NotImplementedAdapter } from './adapters/not-implemented.adapter';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { PublishedPostsRepository } from './repositories/published-posts.repository';
import { CommentsRepository } from './repositories/comments.repository';
import { STALENESS_THRESHOLD_MS } from './config/staleness-threshold.token';
import { resolveStalenessThresholdMs } from './config/staleness-threshold';
import { buildGoToSocialAdapter } from './config/gotosocial-adapter.factory';

// 'twitter' has a real (mock) adapter; 'gotosocial' has a real adapter that
// falls back to a stub when unconfigured (see buildGoToSocialAdapter); the
// rest are stubbed until built out — see docs/adapter-interface.md and
// docs/ASSUMPTIONS.md.
function buildAdapterMap(configService: ConfigService): AdapterMap {
  const entries: [Platform, PlatformCommentAdapter][] = [
    ['twitter', new MockTwitterAdapter()],
    ['instagram', new NotImplementedAdapter('instagram')],
    ['linkedin', new NotImplementedAdapter('linkedin')],
    ['tiktok', new NotImplementedAdapter('tiktok')],
    [
      'gotosocial',
      buildGoToSocialAdapter({
        baseUrl: configService.get<string>('GTS_BASE_URL'),
        accessToken: configService.get<string>('GTS_ACCESS_TOKEN'),
      }),
    ],
  ];
  return new Map(entries);
}

@Module({
  controllers: [CommentsController],
  providers: [
    {
      provide: ADAPTER_MAP,
      inject: [ConfigService],
      useFactory: buildAdapterMap,
    },
    CommentAdapterRegistry,
    PublishedPostsRepository,
    CommentsRepository,
    CommentsService,
    {
      provide: STALENESS_THRESHOLD_MS,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        resolveStalenessThresholdMs(
          configService.get<string>('STALENESS_THRESHOLD_MS'),
        ),
    },
  ],
  exports: [CommentAdapterRegistry, CommentsRepository],
})
export class CommentsModule {}
