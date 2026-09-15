import { Inject, Injectable } from '@nestjs/common';
import { AdapterMap, ADAPTER_MAP } from './adapter-map.token';
import {
  Platform,
  PlatformCommentAdapter,
} from './platform-comment-adapter.interface';

@Injectable()
export class CommentAdapterRegistry {
  constructor(@Inject(ADAPTER_MAP) private readonly adapters: AdapterMap) {}

  get(platform: Platform): PlatformCommentAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter)
      throw new Error(`No adapter registered for platform: ${platform}`);
    return adapter;
  }
}
