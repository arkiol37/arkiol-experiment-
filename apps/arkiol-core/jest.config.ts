// apps/arkiol-core/jest.config.ts
import type { Config } from 'jest';

const config: Config = {
  preset:          'ts-jest',
  testEnvironment: 'node',
  rootDir:         '.',

  // Match both unit tests (__tests__/**) and integration tests (__tests__/integration/**)
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/integration/**/*.test.ts',
  ],

  moduleNameMapper: {
    '^@/(.*)$':      '<rootDir>/src/$1',
    '^server-only$': '<rootDir>/src/__mocks__/server-only.ts',
    // Map workspace package to source so ts-jest can resolve it
    '^@arkiol/shared$':    '<rootDir>/../../packages/shared/src/index.ts',
    '^@arkiol/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
  },

  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: { moduleResolution: 'node' },
    }],
  },

  // Coverage collected from source, excluding generated/infrastructure code
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/app/**/*.tsx',       // Next.js page components — not unit-testable
    '!src/**/__mocks__/**',
    '!src/workers/**',         // Workers tested separately
  ],

  coverageReporters: ['text', 'lcov', 'json-summary', 'html'],

  // Thresholds: block CI if coverage drops below these floors
  coverageThreshold: {
    global: {
      branches:   50,
      functions:  60,
      lines:      60,
      statements: 60,
    },
  },

  // Separate test runs for unit vs integration: use --testPathPattern in scripts
  projects: undefined, // single project, keep it simple

  testTimeout: 30_000,

  // Print test names for cleaner CI output
  verbose: false,
};

export default config;
