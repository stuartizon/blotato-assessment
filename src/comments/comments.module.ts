import { Module } from '@nestjs/common';
import { AdapterMap, ADAPTER_MAP } from './adapter-map.token';
import { CommentAdapterRegistry } from './comment-adapter-registry.service';

// Populated by platform-specific modules (each contributing its adapter)
// once they exist — see docs/adapter-interface.md. Empty until then.
const emptyAdapterMap: AdapterMap = new Map();

@Module({
  providers: [
    { provide: ADAPTER_MAP, useValue: emptyAdapterMap },
    CommentAdapterRegistry,
  ],
  exports: [CommentAdapterRegistry],
})
export class CommentsModule {}
