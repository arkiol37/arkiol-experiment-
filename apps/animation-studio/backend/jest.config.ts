// apps/animation-studio/backend/jest.config.ts
import type { Config } from 'jest';

const config: Config = {
  preset:          'ts-jest',
  testEnvironment: 'node',
  roots:           ['<rootDir>/tests'],

  // Match unit tests, integration tests, smoke tests, and e2e specs
  testMatch: [
    'tests/unit/**/*.test.ts',
    'tests/integration/**/*.test.ts',
    'tests/smoke/**/*.test.ts',
    'tests/e2e/**/*.e2e.ts',
  ],

  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },

  moduleNameMapper: {
    '^@/(.*)$':              '<rootDir>/src/$1',
    '^@arkiol/shared$':      '<rootDir>/../../../packages/shared/src/index.ts',
    '^@arkiol/shared/(.*)$': '<rootDir>/../../../packages/shared/src/$1',
  },

  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/migrations/**',    // Knex migration files — not unit-testable
    '!src/workers/**',       // Workers have their own test strategy
  ],

  coverageReporters: ['text', 'lcov', 'json-summary', 'html'],

  // Thresholds: keep these realistic for a growing codebase
  coverageThreshold: {
    global: {
      lines:      20,
      functions:  20,
      branches:   15,
      statements: 20,
    },
  },

  testTimeout: 30_000,
};

export default config;
