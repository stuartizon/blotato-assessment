/**
 * Demonstrates the full reply-to-comment flow end to end against the real
 * GoToSocial integration — no frontend involved (explicitly out of scope
 * for this repo, see CLAUDE.md), just the REST API documented in
 * docs/api-endpoints.md, exercised the way a real caller would:
 *
 *   1. Find a real, already-seeded GoToSocial post with comments on it
 *      (posted by `docker compose up`'s gotosocial-seed service).
 *   2. Register it as a `published_posts` row — standing in for "the
 *      wider product's post-management system" (see docs/ASSUMPTIONS.md),
 *      which is assumed to exist elsewhere and isn't part of this repo.
 *   3. GET /posts/:postId/comments — triggers a real sync via
 *      GoToSocialAdapter and returns the comment tree.
 *   4. POST /comments/:commentId/replies — creates a reply job.
 *   5. Poll GET /reply-jobs/:jobId until the pg-boss worker has posted the
 *      real reply to GoToSocial.
 *
 * Usage: npm run demo:reply
 * Requires: the app running (`npm run start:dev`), GTS_ACCESS_TOKEN
 * configured (see scripts/setup-gotosocial.sh), and GoToSocial seeded
 * (the default via `docker compose up -d`).
 */
import * as dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';

dotenv.config();

const APP_BASE_URL = process.env.DEMO_APP_BASE_URL ?? 'http://localhost:3000';
const GTS_BASE_URL = process.env.GTS_BASE_URL ?? 'http://localhost:8080';
const GTS_ACCESS_TOKEN = process.env.GTS_ACCESS_TOKEN;
const SEED_ACCOUNT = process.env.GTS_SEED_USERNAME ?? 'blotato_seed';

interface GoToSocialStatus {
  id: string;
  in_reply_to_id: string | null;
  replies_count: number;
}

interface CommentNode {
  id: string;
  authorDisplayName: string;
  body: string;
  replies: CommentNode[];
}

interface PostCommentsResponse {
  postId: string;
  comments: CommentNode[];
}

interface CreateReplyResponse {
  jobId: string;
  status: string;
}

interface ReplyJobStatusResponse {
  jobId: string;
  status: 'pending' | 'processing' | 'sent' | 'failed';
  resultComment?: { id: string; body: string; postedAt: string };
  lastError?: string;
}

function fail(message: string): never {
  console.error(`\nerror: ${message}`);
  process.exit(1);
}

async function gtsFetch(path: string): Promise<Response> {
  return fetch(`${GTS_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${GTS_ACCESS_TOKEN}` },
  });
}

async function findSeededPostWithComments(): Promise<string> {
  const lookupRes = await gtsFetch(
    `/api/v1/accounts/lookup?acct=${SEED_ACCOUNT}`,
  );
  if (!lookupRes.ok) {
    fail(
      `Couldn't look up seed account '${SEED_ACCOUNT}' on GoToSocial (${lookupRes.status}). ` +
        `Is 'docker compose up -d' running with the gotosocial-seed service?`,
    );
  }
  const account = (await lookupRes.json()) as { id: string };

  const statusesRes = await gtsFetch(
    `/api/v1/accounts/${account.id}/statuses?limit=20`,
  );
  if (!statusesRes.ok) {
    fail(`Couldn't fetch '${SEED_ACCOUNT}'s statuses (${statusesRes.status}).`);
  }
  const statuses = (await statusesRes.json()) as GoToSocialStatus[];

  const withComments = statuses.find(
    (s) => s.in_reply_to_id === null && s.replies_count > 0,
  );
  if (!withComments) {
    fail(
      `No seeded post with comments found for '${SEED_ACCOUNT}'. ` +
        `Try 'docker compose up -d gotosocial-seed' to (re-)seed it.`,
    );
  }

  return withComments.id;
}

async function ensurePublishedPost(externalPostId: string): Promise<string> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO published_posts (platform, external_post_id)
       VALUES ('gotosocial', $1)
       ON CONFLICT (platform, external_post_id)
       DO UPDATE SET platform = EXCLUDED.platform
       RETURNING id`,
      [externalPostId],
    );
    return result.rows[0].id;
  } finally {
    await pool.end();
  }
}

function pickCommentToReplyTo(response: PostCommentsResponse): CommentNode {
  const [first] = response.comments;
  if (!first) {
    fail(
      `GET /posts/${response.postId}/comments returned no comments — nothing to reply to.`,
    );
  }
  // Prefer a nested reply if one exists, just to show threading depth works too.
  return first.replies[0] ?? first;
}

async function appFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${APP_BASE_URL}${path}`, init);
}

async function pollReplyJob(
  jobId: string,
  timeoutMs = 20_000,
): Promise<ReplyJobStatusResponse> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await appFetch(`/reply-jobs/${jobId}`);
    if (!res.ok) {
      fail(`GET /reply-jobs/${jobId} returned ${res.status}`);
    }
    const job = (await res.json()) as ReplyJobStatusResponse;
    if (job.status === 'sent' || job.status === 'failed') {
      return job;
    }
    if (Date.now() > deadline) {
      fail(
        `Timed out waiting for reply job ${jobId} to finish (still '${job.status}'). ` +
          `Is the app's pg-boss worker running?`,
      );
    }
    console.log(`    ...job ${jobId} is still '${job.status}', waiting`);
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

async function main() {
  if (!GTS_ACCESS_TOKEN) {
    fail(
      'GTS_ACCESS_TOKEN is not set. Run scripts/setup-gotosocial.sh and add the printed ' +
        'token to .env first — the app needs it to talk to GoToSocial for real.',
    );
  }

  const healthRes = await appFetch('/health').catch(() => null);
  if (!healthRes?.ok) {
    fail(
      `App not reachable at ${APP_BASE_URL}/health. Run 'npm run start:dev' first.`,
    );
  }

  console.log('==> Finding a seeded GoToSocial post with real comments...');
  const externalPostId = await findSeededPostWithComments();
  console.log(`    found post ${externalPostId} (by ${SEED_ACCOUNT})`);

  console.log('==> Registering it as a published_posts row...');
  const postId = await ensurePublishedPost(externalPostId);
  console.log(`    published_posts.id = ${postId}`);

  console.log(`==> GET /posts/${postId}/comments (real sync via GoToSocialAdapter)...`);
  const commentsRes = await appFetch(`/posts/${postId}/comments`);
  if (!commentsRes.ok) {
    fail(`GET /posts/${postId}/comments returned ${commentsRes.status}`);
  }
  const commentsResponse = (await commentsRes.json()) as PostCommentsResponse;
  const target = pickCommentToReplyTo(commentsResponse);
  console.log(
    `    replying to comment ${target.id} by ${target.authorDisplayName}: "${target.body}"`,
  );

  const replyBody = `Thanks for the comment! (automated demo reply, posted ${new Date().toISOString()})`;
  console.log(`==> POST /comments/${target.id}/replies...`);
  const createRes = await appFetch(`/comments/${target.id}/replies`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify({ body: replyBody }),
  });
  if (createRes.status !== 202) {
    fail(`POST /comments/${target.id}/replies returned ${createRes.status}`);
  }
  const created = (await createRes.json()) as CreateReplyResponse;
  console.log(`    job ${created.jobId} created, status '${created.status}'`);

  console.log('==> Polling GET /reply-jobs/:jobId until the worker posts it for real...');
  const finished = await pollReplyJob(created.jobId);

  if (finished.status === 'failed') {
    fail(`Reply job failed: ${finished.lastError}`);
  }

  console.log('\n==> Done. Real reply posted to GoToSocial:');
  console.log(`      "${finished.resultComment!.body}"`);
  console.log(`\n    See it live: ${GTS_BASE_URL}/@${SEED_ACCOUNT}/statuses/${externalPostId}`);
}

main().catch((err) => fail(err instanceof Error ? err.stack ?? err.message : String(err)));
