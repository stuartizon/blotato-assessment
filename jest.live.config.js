const baseConfig = require('./jest.config');

/** @type {import('jest').Config} */
module.exports = {
  ...baseConfig,
  testRegex: '.*\\.live\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/'],
  // Real network calls to a real GoToSocial instance.
  testTimeout: 30_000,
};
