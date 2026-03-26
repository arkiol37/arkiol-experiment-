// packages/shared/jest.config.ts
import type { Config } from 'jest';

const config: Config = {
  preset:          'ts-jest',
  testEnvironment: 'node',
  rootDir:         '.',
  testMatch:       ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',   // barrel file
  ],
  coverageReporters: ['text', 'lcov', 'json-summary'],
  testTimeout: 15_000,
};

export default config;
