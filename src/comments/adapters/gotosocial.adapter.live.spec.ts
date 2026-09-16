import { GoToSocialAdapter } from './gotosocial.adapter';

/**
 * Exercises GoToSocialAdapter against a real, running GoToSocial instance —
 * see "Real platform integration: GoToSocial" in docs/ASSUMPTIONS.md. Run
 * via `npm run test:live:gotosocial`, never as part of `npm test` or CI
 * (see jest.config.js / jest.live.config.js).
 *
 * Requires `docker compose up -d` and a provisioned GTS_ACCESS_TOKEN (see
 * scripts/setup-gotosocial.sh) — skipped entirely, not failed, when unset.
 */
const BASE_URL = process.env.GTS_BASE_URL ?? 'http://localhost:8080';
const ACCESS_TOKEN = process.env.GTS_ACCESS_TOKEN;

const describeLive = ACCESS_TOKEN ? describe : describe.skip;

async function gtsFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

async function createStatus(
  text: string,
  inReplyToId?: string,
): Promise<{ id: string; created_at: string }> {
  const response = await gtsFetch('/api/v1/statuses', {
    method: 'POST',
    body: JSON.stringify({
      status: text,
      in_reply_to_id: inReplyToId,
      visibility: 'public',
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to create status: ${response.status} ${await response.text()}`,
    );
  }
  return response.json();
}

async function editStatus(
  id: string,
  text: string,
): Promise<{ id: string; edited_at: string }> {
  const response = await gtsFetch(`/api/v1/statuses/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ status: text }),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to edit status: ${response.status} ${await response.text()}`,
    );
  }
  return response.json();
}

describeLive('GoToSocialAdapter (live)', () => {
  let adapter: GoToSocialAdapter;
  let seedPostId: string;

  beforeAll(async () => {
    adapter = new GoToSocialAdapter(BASE_URL, ACCESS_TOKEN!);
    const seed = await createStatus(`Live smoke test seed ${Date.now()}`);
    seedPostId = seed.id;
  });

  it('fetches real comments from the live instance', async () => {
    const created = await createStatus('Live smoke test reply', seedPostId);

    const comments = await adapter.fetchComments(seedPostId);

    const found = comments.find((c) => c.externalCommentId === created.id);
    expect(found).toBeDefined();
    expect(found!.externalParentCommentId).toBe(seedPostId);
    expect(found!.body).toBe('Live smoke test reply');
  });

  it('posts a real reply via the adapter', async () => {
    const body = `Live smoke test adapter reply ${Date.now()}`;

    const result = await adapter.postReply(seedPostId, body);

    expect(result.body).toBe(body);
    expect(result.externalParentCommentId).toBe(seedPostId);

    const comments = await adapter.fetchComments(seedPostId);
    expect(
      comments.some((c) => c.externalCommentId === result.externalCommentId),
    ).toBe(true);
  });

  it('picks up an edited status on the next sync, via since', async () => {
    const original = await createStatus(
      'Live smoke test: original text',
      seedPostId,
    );
    const since = new Date();
    // A real sync cycle has minutes between `since` and an edit (see
    // STALENESS_THRESHOLD_MS); here we only need enough of a gap that
    // clock skew between this process and the GoToSocial container can't
    // put `edited_at` on the wrong side of `since`.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const editedBody = 'Live smoke test: EDITED text';
    await editStatus(original.id, editedBody);

    const comments = await adapter.fetchComments(seedPostId, { since });

    const edited = comments.find((c) => c.externalCommentId === original.id);
    expect(edited).toBeDefined();
    expect(edited!.body).toBe(editedBody);
  });
});
