/**
 * packages/shared/src/__tests__/credit-errors.test.ts
 *
 * Unit tests for pure error classes from credits.ts and related modules.
 *
 * Pure — no DB, no Prisma.
 *
 * Covers:
 *  - InsufficientCreditsError — instanceof, name, code, statusCode, message,
 *                               main vs daily bucket, required/available fields
 */

import { InsufficientCreditsError } from '../credits';

// ══════════════════════════════════════════════════════════════════════════════
// InsufficientCreditsError
// ══════════════════════════════════════════════════════════════════════════════
describe('InsufficientCreditsError', () => {
  it('is an instance of Error', () => {
    expect(new InsufficientCreditsError(5, 2)).toBeInstanceOf(Error);
  });

  it('is an instance of InsufficientCreditsError', () => {
    expect(new InsufficientCreditsError(5, 2)).toBeInstanceOf(InsufficientCreditsError);
  });

  it('name is InsufficientCreditsError', () => {
    expect(new InsufficientCreditsError(5, 2).name).toBe('InsufficientCreditsError');
  });

  it('code is INSUFFICIENT_CREDITS', () => {
    expect((new InsufficientCreditsError(5, 2) as any).code).toBe('INSUFFICIENT_CREDITS');
  });

  it('statusCode is 402', () => {
    expect((new InsufficientCreditsError(5, 2) as any).statusCode).toBe(402);
  });

  it('message includes required credits', () => {
    expect(new InsufficientCreditsError(10, 3).message).toContain('10');
  });

  it('message includes available credits', () => {
    expect(new InsufficientCreditsError(10, 3).message).toContain('3');
  });

  it('default bucket is "main"', () => {
    expect(new InsufficientCreditsError(5, 2).message).toContain('main');
  });

  it('daily bucket is mentioned when specified', () => {
    expect(new InsufficientCreditsError(5, 2, 'daily').message).toContain('daily');
  });

  it('can be thrown and caught as Error', () => {
    expect(() => { throw new InsufficientCreditsError(5, 2); }).toThrow(Error);
  });

  it('different required/available produce different messages', () => {
    const a = new InsufficientCreditsError(5, 2);
    const b = new InsufficientCreditsError(10, 1);
    expect(a.message).not.toBe(b.message);
  });

  it('required=0 does not throw on construction', () => {
    expect(() => new InsufficientCreditsError(0, 0)).not.toThrow();
  });
});
