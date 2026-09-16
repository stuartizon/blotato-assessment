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

// Isolated from the real .env on purpose: these tests assert behavior for
// specific config states (e.g. "GTS_ACCESS_TOKEN unset"), which a
// developer's real .env may or may not match. `ignoreEnvFile` alone isn't
// enough — jest.setup.ts's dotenv.config() has already populated
// process.env by the time any test runs, and ConfigService always merges
// process.env in regardless of ignoreEnvFile — so GTS_ACCESS_TOKEN /
// GTS_BASE_URL are explicitly cleared/restored around each test too. (This
// fixes an incident where a locally-configured GTS_ACCESS_TOKEN silently
// broke the "stubs for the rest" test.)
function testConfigModule() {
  return ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true });
}

const ENV_KEYS = ['GTS_ACCESS_TOKEN', 'GTS_BASE_URL'] as const;

describe('CommentsModule', () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it('registers the mock adapter for twitter and stubs for the rest', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [testConfigModule(), DatabaseModule, CommentsModule],
    }).compile();

    const registry = moduleRef.get(CommentAdapterRegistry);

    expect(registry.get('twitter')).toBeInstanceOf(MockTwitterAdapter);
    expect(registry.get('instagram')).toBeInstanceOf(NotImplementedAdapter);
    expect(registry.get('linkedin')).toBeInstanceOf(NotImplementedAdapter);
    expect(registry.get('tiktok')).toBeInstanceOf(NotImplementedAdapter);
    expect(registry.get('gotosocial')).toBeInstanceOf(NotImplementedAdapter);
  });

  it('registers a real GoToSocialAdapter when GTS_ACCESS_TOKEN is configured', async () => {
    process.env.GTS_ACCESS_TOKEN = 'test-token';
    process.env.GTS_BASE_URL = 'http://gotosocial.test';

    const moduleRef = await Test.createTestingModule({
      imports: [testConfigModule(), DatabaseModule, CommentsModule],
    }).compile();

    const registry = moduleRef.get(CommentAdapterRegistry);

    expect(registry.get('gotosocial')).toBeInstanceOf(GoToSocialAdapter);
  });

  it('resolves CommentsService with the default staleness threshold when unset', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [testConfigModule(), DatabaseModule, CommentsModule],
    }).compile();

    expect(moduleRef.get(CommentsService)).toBeInstanceOf(CommentsService);
    expect(moduleRef.get(STALENESS_THRESHOLD_MS)).toBe(
      DEFAULT_STALENESS_THRESHOLD_MS,
    );
  });
});
