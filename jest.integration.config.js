const baseConfig = require('./jest.config');

/** @type {import('jest').Config} */
module.exports = {
  ...baseConfig,
  testRegex: '.*\\.integration\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/'],
  // These specs share one real Postgres database and truncate tables
  // between tests; parallel workers would race those truncates/inserts
  // across files — see docs/ASSUMPTIONS.md, "Testing strategy".
  maxWorkers: 1,
};
