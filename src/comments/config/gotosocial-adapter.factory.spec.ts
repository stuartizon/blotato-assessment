import { GoToSocialAdapter } from '../adapters/gotosocial.adapter';
import { NotImplementedAdapter } from '../adapters/not-implemented.adapter';
import {
  buildGoToSocialAdapter,
  DEFAULT_GTS_BASE_URL,
} from './gotosocial-adapter.factory';

describe('buildGoToSocialAdapter', () => {
  it('returns a NotImplementedAdapter when no access token is configured', () => {
    const adapter = buildGoToSocialAdapter({});

    expect(adapter).toBeInstanceOf(NotImplementedAdapter);
    expect(adapter.platform).toBe('gotosocial');
  });

  it('returns a real GoToSocialAdapter when an access token is configured', () => {
    const adapter = buildGoToSocialAdapter({
      accessToken: 'test-token',
      baseUrl: 'http://gotosocial.test',
    });

    expect(adapter).toBeInstanceOf(GoToSocialAdapter);
    expect(adapter.platform).toBe('gotosocial');
  });

  it('falls back to the default base URL when only an access token is given', () => {
    const adapter = buildGoToSocialAdapter({
      accessToken: 'test-token',
    }) as GoToSocialAdapter;

    expect(adapter).toBeInstanceOf(GoToSocialAdapter);
    expect((adapter as unknown as { baseUrl: string }).baseUrl).toBe(
      DEFAULT_GTS_BASE_URL,
    );
  });
});
