module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': ['babel-jest', { configFile: './babel.config.js' }],
  },
  // Transform project source + packages that use ESM syntax
  transformIgnorePatterns: [
    'node_modules/(?!(protobufjs|@protobufjs|long|expo|@expo)/)',
  ],
  testMatch: ['**/src/__tests__/**/*.test.ts'],
  // Treat JSON imports as modules (required by proto/triage.ts)
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
