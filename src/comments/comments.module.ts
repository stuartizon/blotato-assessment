import { Module } from '@nestjs/common';
import { AdapterMap, ADAPTER_MAP } from './adapter-map.token';
import { CommentAdapterRegistry } from './comment-adapter-registry.service';
import {
  Platform,
  PlatformCommentAdapter,
} from './platform-comment-adapter.interface';
import { MockTwitterAdapter } from './adapters/mock-twitter.adapter';
import { NotImplementedAdapter } from './adapters/not-implemented.adapter';

// 'twitter' has a real (mock) adapter; the rest are stubbed until built out
// — see docs/adapter-interface.md and docs/ASSUMPTIONS.md.
function buildAdapterMap(): AdapterMap {
  const entries: [Platform, PlatformCommentAdapter][] = [
    ['twitter', new MockTwitterAdapter()],
    ['instagram', new NotImplementedAdapter('instagram')],
    ['linkedin', new NotImplementedAdapter('linkedin')],
    ['tiktok', new NotImplementedAdapter('tiktok')],
  ];
  return new Map(entries);
}

@Module({
  providers: [
    { provide: ADAPTER_MAP, useFactory: buildAdapterMap },
    CommentAdapterRegistry,
  ],
  exports: [CommentAdapterRegistry],
})
export class CommentsModule {}
