/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Adds 'gotosocial' to the platform enum — see "Real platform integration:
 * GoToSocial" in docs/ASSUMPTIONS.md. Kept as its own migration file (not
 * folded into other DDL) because ALTER TYPE ... ADD VALUE historically
 * couldn't run in the same transaction as statements that use the new
 * value; that restriction was lifted in Postgres 12, but this repo targets
 * postgres:16-alpine (see docker-compose.yml) so it isn't load-bearing here
 * — kept separate anyway since it's the safer default across PG versions.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.sql(`ALTER TYPE platform ADD VALUE 'gotosocial';`);
};

/**
 * No-op: Postgres has no ALTER TYPE ... DROP VALUE, so removing an enum
 * value cleanly requires recreating the type (and repointing every column
 * that uses it) — not warranted for reversing a single value addition.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = () => {};
