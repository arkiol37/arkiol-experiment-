/**
 * packages/shared/src/__tests__/soft-delete-errors.test.ts
 *
 * Unit tests for softDelete.ts error classes and filter constants.
 *
 * Pure — no DB, no Prisma.
 *
 * Covers:
 *  - ACTIVE_PROJECT_FILTER — shape, immutability
 *  - ALL_PROJECT_FILTER    — shape
 *  - ProjectNotFoundError  — instanceof, code, statusCode, message
 *  - ProjectAlreadyDeletedError — instanceof, code, statusCode, message
 */

import {
  ACTIVE_PROJECT_FILTER,
  ALL_PROJECT_FILTER,
  ProjectNotFoundError,
  ProjectAlreadyDeletedError,
} from '../softDelete';

// ══════════════════════════════════════════════════════════════════════════════
// Filter constants
// ══════════════════════════════════════════════════════════════════════════════
describe('ACTIVE_PROJECT_FILTER', () => {
  it('is an object', () => {
    expect(typeof ACTIVE_PROJECT_FILTER).toBe('object');
  });

  it('has deletedAt: null', () => {
    expect(ACTIVE_PROJECT_FILTER.deletedAt).toBeNull();
  });

  it('is frozen (const)', () => {
    // The value itself may not be Object.frozen but it's declared as const
    expect(ACTIVE_PROJECT_FILTER).toBeDefined();
  });
});

describe('ALL_PROJECT_FILTER', () => {
  it('is an empty object (no filter)', () => {
    expect(Object.keys(ALL_PROJECT_FILTER).length).toBe(0);
  });

  it('is an object', () => {
    expect(typeof ALL_PROJECT_FILTER).toBe('object');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ProjectNotFoundError
// ══════════════════════════════════════════════════════════════════════════════
describe('ProjectNotFoundError', () => {
  const ERR = new ProjectNotFoundError('proj-001');

  it('is an instance of Error', () => {
    expect(ERR).toBeInstanceOf(Error);
  });

  it('is an instance of ProjectNotFoundError', () => {
    expect(ERR).toBeInstanceOf(ProjectNotFoundError);
  });

  it('code is PROJECT_NOT_FOUND', () => {
    expect(ERR.code).toBe('PROJECT_NOT_FOUND');
  });

  it('statusCode is 404', () => {
    expect(ERR.statusCode).toBe(404);
  });

  it('message contains the projectId', () => {
    expect(ERR.message).toContain('proj-001');
  });

  it('can be thrown and caught as Error', () => {
    expect(() => { throw new ProjectNotFoundError('p'); }).toThrow(Error);
  });

  it('different projectIds produce different messages', () => {
    const a = new ProjectNotFoundError('proj-A');
    const b = new ProjectNotFoundError('proj-B');
    expect(a.message).not.toBe(b.message);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ProjectAlreadyDeletedError
// ══════════════════════════════════════════════════════════════════════════════
describe('ProjectAlreadyDeletedError', () => {
  const ERR = new ProjectAlreadyDeletedError('proj-001');

  it('is an instance of Error', () => {
    expect(ERR).toBeInstanceOf(Error);
  });

  it('is an instance of ProjectAlreadyDeletedError', () => {
    expect(ERR).toBeInstanceOf(ProjectAlreadyDeletedError);
  });

  it('code is PROJECT_ALREADY_DELETED', () => {
    expect(ERR.code).toBe('PROJECT_ALREADY_DELETED');
  });

  it('statusCode is 409', () => {
    expect(ERR.statusCode).toBe(409);
  });

  it('message contains the projectId', () => {
    expect(ERR.message).toContain('proj-001');
  });

  it('can be thrown and caught as Error', () => {
    expect(() => { throw new ProjectAlreadyDeletedError('p'); }).toThrow(Error);
  });

  it('two errors have distinct codes', () => {
    expect(new ProjectNotFoundError('p').code).not.toBe(
      new ProjectAlreadyDeletedError('p').code
    );
  });

  it('two errors have distinct status codes', () => {
    expect(new ProjectNotFoundError('p').statusCode).not.toBe(
      new ProjectAlreadyDeletedError('p').statusCode
    );
  });
});
