/**
 * apps/animation-studio/backend/tests/unit/errorHandler.test.ts
 *
 * Unit tests for middleware/errorHandler.ts
 *
 * Tests AppError class construction and the errorHandler Express middleware
 * using mock req/res/next objects — no server, no DB, no HTTP.
 *
 * Covers:
 *  - AppError — construction, statusCode, code, isOperational, instanceof chain
 *  - errorHandler — ZodError → 400 VALIDATION_ERROR
 *  - errorHandler — AppError operational → correct statusCode + body
 *  - errorHandler — Knex unique violation (23505) → 409 CONFLICT
 *  - errorHandler — Knex FK violation (23503) → 400 FOREIGN_KEY_VIOLATION
 *  - errorHandler — unknown errors → 500 INTERNAL_ERROR
 *  - errorHandler — skips when res.headersSent=true
 */

import { AppError, errorHandler } from '../../../../src/middleware/errorHandler';
import { ZodError, z } from 'zod';

// ── Mock helpers ─────────────────────────────────────────────────────────────
function makeRes() {
  const res: any = {
    headersSent: false,
    _status: 0,
    _body:   null as any,
    status(code: number) { this._status = code; return this; },
    json(body: any)      { this._body = body;   return this; },
  };
  return res;
}

function makeReq(overrides: Record<string, any> = {}) {
  return { requestId: 'req-test-001', path: '/test', method: 'GET', ...overrides } as any;
}

const noopNext = jest.fn();

// ── Silence logger during tests ───────────────────────────────────────────────
jest.mock('../../../../src/config/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

// ══════════════════════════════════════════════════════════════════════════════
// AppError class
// ══════════════════════════════════════════════════════════════════════════════
describe('AppError', () => {
  it('is an instance of Error', () => {
    expect(new AppError('oops')).toBeInstanceOf(Error);
  });

  it('message is set correctly', () => {
    expect(new AppError('test message').message).toBe('test message');
  });

  it('default statusCode is 500', () => {
    expect(new AppError('oops').statusCode).toBe(500);
  });

  it('custom statusCode is preserved', () => {
    expect(new AppError('not found', 404).statusCode).toBe(404);
    expect(new AppError('unauthorized', 401).statusCode).toBe(401);
    expect(new AppError('bad request', 400).statusCode).toBe(400);
  });

  it('code is undefined by default', () => {
    expect(new AppError('oops').code).toBeUndefined();
  });

  it('code is preserved when provided', () => {
    expect(new AppError('oops', 400, 'BAD_INPUT').code).toBe('BAD_INPUT');
  });

  it('isOperational is always true', () => {
    expect(new AppError('oops').isOperational).toBe(true);
    expect(new AppError('oops', 500, 'CODE').isOperational).toBe(true);
  });

  it('has a stack trace', () => {
    const e = new AppError('trace test');
    expect(typeof e.stack).toBe('string');
    expect(e.stack!.length).toBeGreaterThan(0);
  });

  it('can be caught as an Error', () => {
    const caught = (() => {
      try { throw new AppError('thrown', 422); }
      catch (e) { return e; }
    })();
    expect(caught).toBeInstanceOf(Error);
    expect((caught as AppError).statusCode).toBe(422);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// errorHandler — ZodError
// ══════════════════════════════════════════════════════════════════════════════
describe('errorHandler — ZodError', () => {
  function makeZodError() {
    // Parse intentionally bad data to get a real ZodError
    const schema = z.object({ name: z.string(), age: z.number() });
    const result = schema.safeParse({ name: 123, age: 'bad' });
    if (!result.success) return result.error;
    throw new Error('Expected ZodError');
  }

  it('responds with status 400', () => {
    const res = makeRes();
    errorHandler(makeZodError(), makeReq(), res, noopNext);
    expect(res._status).toBe(400);
  });

  it('body.error is "Validation Error"', () => {
    const res = makeRes();
    errorHandler(makeZodError(), makeReq(), res, noopNext);
    expect(res._body.error).toBe('Validation Error');
  });

  it('body.code is "VALIDATION_ERROR"', () => {
    const res = makeRes();
    errorHandler(makeZodError(), makeReq(), res, noopNext);
    expect(res._body.code).toBe('VALIDATION_ERROR');
  });

  it('body.details is populated with field errors', () => {
    const res = makeRes();
    errorHandler(makeZodError(), makeReq(), res, noopNext);
    expect(res._body.details).toBeDefined();
    expect(typeof res._body.details).toBe('object');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// errorHandler — AppError (operational)
// ══════════════════════════════════════════════════════════════════════════════
describe('errorHandler — AppError (operational)', () => {
  it('uses AppError.statusCode as response status', () => {
    const res = makeRes();
    errorHandler(new AppError('not found', 404, 'NOT_FOUND'), makeReq(), res, noopNext);
    expect(res._status).toBe(404);
  });

  it('body.error equals AppError.message', () => {
    const res = makeRes();
    errorHandler(new AppError('resource missing', 404), makeReq(), res, noopNext);
    expect(res._body.error).toBe('resource missing');
  });

  it('body.code equals AppError.code when provided', () => {
    const res = makeRes();
    errorHandler(new AppError('conflict', 409, 'ALREADY_EXISTS'), makeReq(), res, noopNext);
    expect(res._body.code).toBe('ALREADY_EXISTS');
  });

  it('body.requestId equals req.requestId', () => {
    const res = makeRes();
    errorHandler(new AppError('oops', 400), makeReq({ requestId: 'req-XYZ' }), res, noopNext);
    expect(res._body.requestId).toBe('req-XYZ');
  });

  it('works for 400 Bad Request', () => {
    const res = makeRes();
    errorHandler(new AppError('bad input', 400, 'BAD_INPUT'), makeReq(), res, noopNext);
    expect(res._status).toBe(400);
  });

  it('works for 401 Unauthorized', () => {
    const res = makeRes();
    errorHandler(new AppError('unauthorized', 401, 'UNAUTHORIZED'), makeReq(), res, noopNext);
    expect(res._status).toBe(401);
  });

  it('works for 403 Forbidden', () => {
    const res = makeRes();
    errorHandler(new AppError('forbidden', 403, 'FORBIDDEN'), makeReq(), res, noopNext);
    expect(res._status).toBe(403);
  });

  it('works for 422 Unprocessable', () => {
    const res = makeRes();
    errorHandler(new AppError('unprocessable', 422, 'UNPROCESSABLE'), makeReq(), res, noopNext);
    expect(res._status).toBe(422);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// errorHandler — Knex DB errors
// ══════════════════════════════════════════════════════════════════════════════
describe('errorHandler — Knex DB errors', () => {
  it('23505 unique violation → 409 CONFLICT', () => {
    const res = makeRes();
    errorHandler({ code: '23505', message: 'duplicate key' }, makeReq(), res, noopNext);
    expect(res._status).toBe(409);
    expect(res._body.code).toBe('CONFLICT');
    expect(res._body.error).toMatch(/already exists/i);
  });

  it('23503 FK violation → 400 FOREIGN_KEY_VIOLATION', () => {
    const res = makeRes();
    errorHandler({ code: '23503', message: 'fk violation' }, makeReq(), res, noopNext);
    expect(res._status).toBe(400);
    expect(res._body.code).toBe('FOREIGN_KEY_VIOLATION');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// errorHandler — unknown / unhandled errors
// ══════════════════════════════════════════════════════════════════════════════
describe('errorHandler — unknown errors', () => {
  it('unknown error → 500 status', () => {
    const res = makeRes();
    errorHandler(new Error('something exploded'), makeReq(), res, noopNext);
    expect(res._status).toBe(500);
  });

  it('unknown error body.code is "INTERNAL_ERROR"', () => {
    const res = makeRes();
    errorHandler(new Error('crash'), makeReq(), res, noopNext);
    expect(res._body.code).toBe('INTERNAL_ERROR');
  });

  it('unknown error body.error is "Internal server error"', () => {
    const res = makeRes();
    errorHandler(new Error('crash'), makeReq(), res, noopNext);
    expect(res._body.error).toBe('Internal server error');
  });

  it('unknown error includes requestId', () => {
    const res = makeRes();
    errorHandler(new Error('crash'), makeReq({ requestId: 'req-ABC' }), res, noopNext);
    expect(res._body.requestId).toBe('req-ABC');
  });

  it('plain object error still responds 500', () => {
    const res = makeRes();
    errorHandler({ message: 'generic fail' }, makeReq(), res, noopNext);
    expect(res._status).toBe(500);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// errorHandler — headersSent guard
// ══════════════════════════════════════════════════════════════════════════════
describe('errorHandler — headersSent guard', () => {
  it('calls next(err) when res.headersSent is true', () => {
    const res = makeRes();
    res.headersSent = true;
    const next = jest.fn();
    const err = new AppError('too late', 500);
    errorHandler(err, makeReq(), res, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  it('does NOT call res.status when headers already sent', () => {
    const res = makeRes();
    res.headersSent = true;
    res.status = jest.fn().mockReturnThis();
    errorHandler(new AppError('too late'), makeReq(), res, noopNext);
    expect(res.status).not.toHaveBeenCalled();
  });
});
