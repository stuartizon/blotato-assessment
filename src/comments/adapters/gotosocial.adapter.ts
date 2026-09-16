import {
  CanonicalComment,
  FetchCommentsOptions,
  PlatformCommentAdapter,
} from '../platform-comment-adapter.interface';
import {
  PlatformApiError,
  PlatformErrorKind,
} from '../errors/platform-api-error';

interface GoToSocialAccount {
  id: string;
  username: string;
  display_name: string;
}

interface GoToSocialStatus {
  id: string;
  in_reply_to_id: string | null;
  content: string; // sanitized HTML
  created_at: string;
  edited_at: string | null;
  account: GoToSocialAccount;
}

interface GoToSocialContext {
  ancestors: GoToSocialStatus[];
  descendants: GoToSocialStatus[];
}

/**
 * Real, self-hosted, Mastodon-API-compatible platform integration — see
 * "Real platform integration: GoToSocial" in docs/ASSUMPTIONS.md. Uses
 * Node's built-in fetch; no HTTP client dependency needed.
 */
export class GoToSocialAdapter implements PlatformCommentAdapter {
  readonly platform = 'gotosocial' as const;

  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async fetchComments(
    externalPostId: string,
    options?: FetchCommentsOptions,
  ): Promise<CanonicalComment[]> {
    const context = await this.request<GoToSocialContext>(
      'GET',
      `/api/v1/statuses/${encodeURIComponent(externalPostId)}/context`,
    );

    const since = options?.since;
    const descendants = since
      ? context.descendants.filter(
          (status) => this.lastModifiedAt(status) > since,
        )
      : context.descendants;

    return descendants.map((status) => this.toCanonicalComment(status));
  }

  async postReply(
    externalParentCommentId: string,
    body: string,
  ): Promise<CanonicalComment> {
    const status = await this.request<GoToSocialStatus>(
      'POST',
      '/api/v1/statuses',
      {
        status: body,
        in_reply_to_id: externalParentCommentId,
        // GoToSocial defaults to 'unlisted' when omitted, which reads as
        // hidden/not-public in the web UI's thread view — a reply posted
        // on behalf of the business should be as visible as the comment
        // it's replying to.
        visibility: 'public',
      },
    );

    return this.toCanonicalComment(status);
  }

  private toCanonicalComment(status: GoToSocialStatus): CanonicalComment {
    return {
      externalCommentId: status.id,
      externalParentCommentId: status.in_reply_to_id,
      authorExternalId: status.account.id,
      authorDisplayName: status.account.display_name || status.account.username,
      body: this.stripHtml(status.content),
      postedAt: new Date(status.created_at),
      raw: status,
    };
  }

  /**
   * The since-filtering equivalent of "last touched" — mirrors
   * MockTwitterAdapter's lastModifiedAt. GoToSocial surfaces this directly
   * as `edited_at` on the status (null if never edited).
   */
  private lastModifiedAt(status: GoToSocialStatus): Date {
    return new Date(status.edited_at ?? status.created_at);
  }

  /** Strips GoToSocial's sanitized-HTML content down to plain text. */
  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (cause) {
      throw new PlatformApiError(
        `Network error calling GoToSocial: ${(cause as Error).message}`,
        this.platform,
        'transient',
        true,
        undefined,
        cause,
      );
    }

    if (!response.ok) {
      throw await this.toApiError(response);
    }

    return (await response.json()) as T;
  }

  private async toApiError(response: Response): Promise<PlatformApiError> {
    const bodyText = await response.text().catch(() => '');
    let message = `GoToSocial API error: ${response.status} ${response.statusText}`;
    try {
      const parsed = JSON.parse(bodyText) as { error?: string };
      if (parsed.error) {
        message = parsed.error;
      }
    } catch {
      // Non-JSON error body — keep the status-line message.
    }

    const { kind, retryable } = this.classify(response.status);
    const retryAfterMs =
      kind === 'rate_limited' ? this.retryAfterMs(response) : undefined;

    return new PlatformApiError(
      message,
      this.platform,
      kind,
      retryable,
      retryAfterMs,
      bodyText,
    );
  }

  private classify(status: number): {
    kind: PlatformErrorKind;
    retryable: boolean;
  } {
    if (status === 400) return { kind: 'invalid_request', retryable: false };
    if (status === 401 || status === 403)
      return { kind: 'permission_denied', retryable: false };
    if (status === 404) return { kind: 'not_found', retryable: false };
    if (status === 429) return { kind: 'rate_limited', retryable: true };
    if (status >= 500) return { kind: 'transient', retryable: true };
    return { kind: 'unknown', retryable: false };
  }

  /** GoToSocial rate-limit responses carry an ISO8601 reset timestamp. */
  private retryAfterMs(response: Response): number | undefined {
    const reset = response.headers.get('x-ratelimit-reset');
    if (!reset) return undefined;

    const resetMs = Date.parse(reset);
    if (Number.isNaN(resetMs)) return undefined;

    return Math.max(0, resetMs - Date.now());
  }
}
