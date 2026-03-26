/**
 * apps/animation-studio/backend/tests/unit/requestId.test.ts
 *
 * Unit tests for middleware/requestId.ts
 *
 * Covers:
 *  - Uses existing X-Request-ID header when provided
 *  - Generates a new UUID when no header is present
 *  - Sets req.requestId
 *  - Sets X-Request-ID response header
 *  - Calls next()
 *  - Generated IDs are unique across requests
 *  - Generated IDs are valid UUIDs (v4 format)
 */

import { requestId } from '../../../../src/middleware/requestId';

function makeReq(headers: Record<string, string> = {}): any {
  return { headers, requestId: undefined };
}

function makeRes(): any {
  const headers: Record<string, string> = {};
  return {
    _headers: headers,
    setHeader(key: string, value: string) { headers[key] = value; },
    getHeader(key: string) { return headers[key]; },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// requestId middleware
// ══════════════════════════════════════════════════════════════════════════════
describe('requestId middleware', () => {
  it('calls next()', () => {
    const next = jest.fn();
    requestId(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets req.requestId', () => {
    const req = makeReq();
    requestId(req, makeRes(), jest.fn());
    expect(typeof req.requestId).toBe('string');
    expect(req.requestId.length).toBeGreaterThan(0);
  });

  it('sets X-Request-ID response header', () => {
    const res = makeRes();
    requestId(makeReq(), res, jest.fn());
    expect(res._headers['X-Request-ID']).toBeDefined();
    expect(res._headers['X-Request-ID'].length).toBeGreaterThan(0);
  });

  it('uses existing x-request-id header when provided', () => {
    const req = makeReq({ 'x-request-id': 'my-custom-id-123' });
    requestId(req, makeRes(), jest.fn());
    expect(req.requestId).toBe('my-custom-id-123');
  });

  it('response header matches req.requestId', () => {
    const req = makeReq();
    const res = makeRes();
    requestId(req, res, jest.fn());
    expect(res._headers['X-Request-ID']).toBe(req.requestId);
  });

  it('generates a UUID-format id when no header provided', () => {
    const req = makeReq();
    requestId(req, makeRes(), jest.fn());
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('generates unique IDs for different requests', () => {
    const ids = Array.from({ length: 5 }, () => {
      const req = makeReq();
      requestId(req, makeRes(), jest.fn());
      return req.requestId;
    });
    expect(new Set(ids).size).toBe(5);
  });

  it('propagates provided request id to response header', () => {
    const req = makeReq({ 'x-request-id': 'trace-abc-123' });
    const res = makeRes();
    requestId(req, res, jest.fn());
    expect(res._headers['X-Request-ID']).toBe('trace-abc-123');
  });

  it('does not modify other request properties', () => {
    const req = makeReq({ 'content-type': 'application/json' });
    (req as any).body = { test: true };
    requestId(req, makeRes(), jest.fn());
    expect((req as any).body).toEqual({ test: true });
    expect(req.headers['content-type']).toBe('application/json');
  });
});
