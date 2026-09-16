/**
 * Demonstrates the full reply-to-comment flow end to end against the real
 * GoToSocial integration — no frontend involved (explicitly out of scope
 * for this repo, see CLAUDE.md), just the REST API documented in
 * docs/api-endpoints.md, exercised the way a real caller would, across
 * every seeded post and every comment on it:
 *
 *   1. Find every real, already-seeded GoToSocial post (posted by
 *      `docker compose up`'s gotosocial-seed service, as blotato_seed).
 *   2. For each post, register it as a `published_posts` row — standing
 *      in for "the wider product's post-management system" (see
 *      docs/ASSUMPTIONS.md), which is assumed to exist elsewhere and
 *      isn't part of this repo.
 *   3. GET /posts/:postId/comments — triggers a real sync via
 *      GoToSocialAdapter and returns the comment tree (comments seeded
 *      from a *different* account, blotato_commenter — modeling "someone
 *      else comments on the business's post").
 *   4. For each comment not already answered by our own account, POST
 *      /comments/:commentId/replies — creates a reply job.
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
const POSTER_ACCOUNT = process.env.GTS_SEED_USERNAME ?? 'blotato_seed';

interface GoToSocialStatus {
  id: string;
  in_reply_to_id: string | null;
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

async function appFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${APP_BASE_URL}${path}`, init);
}

/** The display name our own GTS_ACCESS_TOKEN posts under, so we can tell
 * our own replies apart from the customer's original comments. */
async function getOwnDisplayName(): Promise<string> {
  const res = await gtsFetch('/api/v1/accounts/verify_credentials');
  if (!res.ok) {
    fail(`Couldn't verify GTS_ACCESS_TOKEN against GoToSocial (${res.status}).`);
  }
  const account = (await res.json()) as {
    display_name: string;
    username: string;
  };
  return account.display_name || account.username;
}

async function findSeededPosts(): Promise<string[]> {
  const lookupRes = await gtsFetch(
    `/api/v1/accounts/lookup?acct=${POSTER_ACCOUNT}`,
  );
  if (!lookupRes.ok) {
    fail(
      `Couldn't look up poster account '${POSTER_ACCOUNT}' on GoToSocial (${lookupRes.status}). ` +
        `Is 'docker compose up -d' running with the gotosocial-seed service?`,
    );
  }
  const account = (await lookupRes.json()) as { id: string };

  const statusesRes = await gtsFetch(
    `/api/v1/accounts/${account.id}/statuses?limit=40&exclude_replies=true`,
  );
  if (!statusesRes.ok) {
    fail(
      `Couldn't fetch '${POSTER_ACCOUNT}'s statuses (${statusesRes.status}).`,
    );
  }
  const statuses = (await statusesRes.json()) as GoToSocialStatus[];
  const topLevel = statuses.filter((s) => s.in_reply_to_id === null);

  if (topLevel.length === 0) {
    fail(
      `No seeded posts found for '${POSTER_ACCOUNT}'. ` +
        `Try 'docker compose up -d gotosocial-seed' to (re-)seed it.`,
    );
  }

  return topLevel.map((s) => s.id);
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

/** Walks the whole comment tree (arbitrary depth) collecting comments that
 * aren't from us and don't already have a reply from us — so re-running
 * this script doesn't re-reply to comments it's already answered. */
function collectCommentsNeedingReply(
  nodes: CommentNode[],
  ourDisplayName: string,
  out: CommentNode[] = [],
): CommentNode[] {
  for (const node of nodes) {
    const alreadyAnswered = node.replies.some(
      (reply) => reply.authorDisplayName === ourDisplayName,
    );
    if (node.authorDisplayName !== ourDisplayName && !alreadyAnswered) {
      out.push(node);
    }
    collectCommentsNeedingReply(node.replies, ourDisplayName, out);
  }
  return out;
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
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

async function replyToComment(commentId: string): Promise<ReplyJobStatusResponse> {
  const body = `Thanks for the comment! (automated demo reply, posted ${new Date().toISOString()})`;
  const createRes = await appFetch(`/comments/${commentId}/replies`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify({ body }),
  });
  if (createRes.status !== 202) {
    fail(`POST /comments/${commentId}/replies returned ${createRes.status}`);
  }
  const created = (await createRes.json()) as CreateReplyResponse;
  return pollReplyJob(created.jobId);
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

  const ourDisplayName = await getOwnDisplayName();
  console.log(`==> Replying as '${ourDisplayName}'`);

  console.log(`==> Finding posts by '${POSTER_ACCOUNT}'...`);
  const externalPostIds = await findSeededPosts();
  console.log(`    found ${externalPostIds.length} post(s)`);

  let repliedCount = 0;

  for (const externalPostId of externalPostIds) {
    console.log(`\n==> Post ${externalPostId}`);
    const postId = await ensurePublishedPost(externalPostId);

    const commentsRes = await appFetch(`/posts/${postId}/comments`);
    if (!commentsRes.ok) {
      fail(`GET /posts/${postId}/comments returned ${commentsRes.status}`);
    }
    const commentsResponse = (await commentsRes.json()) as PostCommentsResponse;

    const needsReply = collectCommentsNeedingReply(
      commentsResponse.comments,
      ourDisplayName,
    );
    if (needsReply.length === 0) {
      console.log('    no unanswered comments');
      continue;
    }

    for (const comment of needsReply) {
      console.log(
        `    replying to ${comment.id} by ${comment.authorDisplayName}: "${comment.body}"`,
      );
      const finished = await replyToComment(comment.id);
      if (finished.status === 'failed') {
        console.log(`    ! reply failed: ${finished.lastError}`);
        continue;
      }
      console.log(`    posted: "${finished.resultComment!.body}"`);
      repliedCount++;
    }
  }

  console.log(
    `\n==> Done. Replied to ${repliedCount} comment(s) across ${externalPostIds.length} post(s).`,
  );
  console.log(`    See it live: ${GTS_BASE_URL}/@${POSTER_ACCOUNT}`);
}

main().catch((err) => fail(err instanceof Error ? (err.stack ?? err.message) : String(err)));
