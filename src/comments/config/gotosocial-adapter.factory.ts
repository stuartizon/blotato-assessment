import { GoToSocialAdapter } from '../adapters/gotosocial.adapter';
import { NotImplementedAdapter } from '../adapters/not-implemented.adapter';
import { PlatformCommentAdapter } from '../platform-comment-adapter.interface';

export const DEFAULT_GTS_BASE_URL = 'http://localhost:8080';

export interface GoToSocialAdapterConfig {
  baseUrl?: string;
  accessToken?: string;
}

/**
 * GTS_ACCESS_TOKEN is provisioned by the one-time scripts/setup-gotosocial.sh
 * step (see docs/ASSUMPTIONS.md), not by `docker compose up` — so it's
 * expected to be absent on a fresh checkout and in CI. Falls back to
 * NotImplementedAdapter in that case, same as any other unimplemented
 * platform, rather than failing app startup.
 */
export function buildGoToSocialAdapter(
  config: GoToSocialAdapterConfig,
): PlatformCommentAdapter {
  if (!config.accessToken) {
    return new NotImplementedAdapter('gotosocial');
  }

  return new GoToSocialAdapter(
    config.baseUrl ?? DEFAULT_GTS_BASE_URL,
    config.accessToken,
  );
}
