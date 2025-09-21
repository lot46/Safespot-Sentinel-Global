module.exports = {
  testEnvironment: 'node',
  preset: 'ts-jest/presets/default-esm',
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: 'tsconfig.json', useESM: true }],
  },
  extensionsToTreatAsEsm: ['.ts'],
  testMatch: ['**/__tests__/**/*.test.(ts|js)'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  setupFiles: ['<rootDir>/__tests__/setupEnv.ts'],
  setupFilesAfterEnv: ['<rootDir>/__tests__/setupRedisMock.ts', '<rootDir>/__tests__/setupPrismaMock.ts', '<rootDir>/__tests__/setupJwtAdapterMock.ts'],
  transformIgnorePatterns: ['node_modules/(?!(@fastify|fastify|ioredis)/)'],
};