import {
  CanonicalComment,
  FetchCommentsOptions,
  Platform,
  PlatformCommentAdapter,
} from '../platform-comment-adapter.interface';

/**
 * Placeholder for a platform with no real (or mock) integration yet.
 * Registered in ADAPTER_MAP so `CommentAdapterRegistry.get` resolves a
 * clear "not implemented" failure rather than an unregistered-platform
 * error for platforms that exist in the `platform` enum but aren't built
 * out — see docs/ASSUMPTIONS.md, "Platform integration (real vs. mock)".
 */
export class NotImplementedAdapter implements PlatformCommentAdapter {
  constructor(readonly platform: Platform) {}

  fetchComments(
    _externalPostId: string,
    _options?: FetchCommentsOptions,
  ): Promise<CanonicalComment[]> {
    return Promise.reject(this.notImplementedError());
  }

  postReply(
    _externalParentCommentId: string,
    _body: string,
  ): Promise<CanonicalComment> {
    return Promise.reject(this.notImplementedError());
  }

  private notImplementedError(): Error {
    return new Error(`${this.platform} adapter is not implemented`);
  }
}
