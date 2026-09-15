/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

/**
 * Mirrors docs/schema.md exactly — see that file for rationale behind each
 * column/constraint/index.
 */
exports.up = (pgm) => {
  pgm.createExtension('pgcrypto', { ifNotExists: true });

  pgm.sql(`
    CREATE TYPE platform AS ENUM ('twitter', 'instagram', 'linkedin', 'tiktok');
  `);

  pgm.sql(`
    CREATE TABLE published_posts (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      platform          platform NOT NULL,
      external_post_id  TEXT NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_synced_at    TIMESTAMPTZ,

      UNIQUE (platform, external_post_id)
    );
  `);

  pgm.sql(`
    CREATE TABLE comments (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id             UUID NOT NULL REFERENCES published_posts(id),
      platform            platform NOT NULL,
      external_comment_id TEXT NOT NULL,
      parent_comment_id   UUID REFERENCES comments(id),

      author_external_id  TEXT NOT NULL,
      author_display_name TEXT NOT NULL,
      body                TEXT NOT NULL,

      raw_payload         JSONB NOT NULL,
      posted_at           TIMESTAMPTZ,
      fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at          TIMESTAMPTZ,

      UNIQUE (platform, external_comment_id)
    );
  `);

  pgm.sql(`CREATE INDEX idx_comments_post_id ON comments(post_id);`);
  pgm.sql(
    `CREATE INDEX idx_comments_parent_id ON comments(parent_comment_id);`,
  );

  pgm.sql(`
    CREATE TABLE reply_jobs (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_comment_id   UUID NOT NULL REFERENCES comments(id),
      platform            platform NOT NULL,
      body                TEXT NOT NULL,

      status              TEXT NOT NULL DEFAULT 'pending',
      idempotency_key     TEXT NOT NULL,
      last_error          TEXT,

      result_comment_id   UUID REFERENCES comments(id),

      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(
    `CREATE UNIQUE INDEX idx_reply_jobs_idempotency ON reply_jobs(idempotency_key);`,
  );
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE reply_jobs;`);
  pgm.sql(`DROP TABLE comments;`);
  pgm.sql(`DROP TABLE published_posts;`);
  pgm.sql(`DROP TYPE platform;`);
};
