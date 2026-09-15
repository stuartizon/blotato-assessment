import {
  Platform,
  PlatformCommentAdapter,
} from './platform-comment-adapter.interface';

export const ADAPTER_MAP = 'ADAPTER_MAP';

export type AdapterMap = Map<Platform, PlatformCommentAdapter>;
