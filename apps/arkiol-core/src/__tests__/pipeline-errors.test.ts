/**
 * apps/arkiol-core/src/__tests__/pipeline-errors.test.ts
 *
 * Unit tests for structured error classes across the pipeline:
 *
 *  - KillSwitchError          (engines/ai/pipeline-orchestrator.ts)
 *  - PipelineHardFailureError (engines/ai/pipeline-orchestrator.ts)
 *  - SpendGuardError          (engines/render/pipeline.ts)
 *  - RenderTimeoutError       (engines/queue/render-queue.ts)   ← already tested;
 *                                                                  included here for
 *                                                                  cross-file completeness
 *
 * Pure class instantiation tests — no async, no DB, no HTTP.
 * Verifies: instanceof Error, readonly fields, message format, error codes,
 * HTTP status codes, and user-facing messages.
 */

import {
  KillSwitchError,
  PipelineHardFailureError,
} from '../engines/ai/pipeline-orchestrator';

import {
  SpendGuardError,
} from '../engines/render/pipeline';

import {
  RenderTimeoutError,
} from '../engines/queue/render-queue';

// ══════════════════════════════════════════════════════════════════════════════
// KillSwitchError
// ══════════════════════════════════════════════════════════════════════════════
describe('KillSwitchError', () => {
  const ERR = new KillSwitchError('job-001', 'instagram_post');

  it('is an instance of Error', () => {
    expect(ERR).toBeInstanceOf(Error);
  });

  it('is an instance of KillSwitchError', () => {
    expect(ERR).toBeInstanceOf(KillSwitchError);
  });

  it('code is KILL_SWITCH_ACTIVE', () => {
    expect(ERR.code).toBe('KILL_SWITCH_ACTIVE');
  });

  it('httpStatus is 503', () => {
    expect(ERR.httpStatus).toBe(503);
  });

  it('has a non-empty userMessage', () => {
    expect(typeof ERR.userMessage).toBe('string');
    expect(ERR.userMessage.length).toBeGreaterThan(0);
  });

  it('message contains the jobId', () => {
    expect(ERR.message).toContain('job-001');
  });

  it('message contains the format', () => {
    expect(ERR.message).toContain('instagram_post');
  });

  it('name is KillSwitchError', () => {
    expect(ERR.name).toBe('KillSwitchError');
  });

  it('different jobId/format produce different messages', () => {
    const a = new KillSwitchError('job-A', 'flyer');
    const b = new KillSwitchError('job-B', 'poster');
    expect(a.message).not.toBe(b.message);
  });

  it('can be thrown and caught as an Error', () => {
    expect(() => {
      throw new KillSwitchError('job-x', 'youtube_thumbnail');
    }).toThrow(Error);
  });

  it('can be caught by type guard', () => {
    try {
      throw new KillSwitchError('job-x', 'youtube_thumbnail');
    } catch (e) {
      expect(e instanceof KillSwitchError).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PipelineHardFailureError
// ══════════════════════════════════════════════════════════════════════════════
describe('PipelineHardFailureError', () => {
  const ERR = new PipelineHardFailureError('job-001', 'instagram_post', 'SVG renderer crashed');

  it('is an instance of Error', () => {
    expect(ERR).toBeInstanceOf(Error);
  });

  it('is an instance of PipelineHardFailureError', () => {
    expect(ERR).toBeInstanceOf(PipelineHardFailureError);
  });

  it('code is RENDER_HARD_FAILURE', () => {
    expect(ERR.code).toBe('RENDER_HARD_FAILURE');
  });

  it('httpStatus is 500', () => {
    expect(ERR.httpStatus).toBe(500);
  });

  it('has a non-empty userMessage', () => {
    expect(typeof ERR.userMessage).toBe('string');
    expect(ERR.userMessage.length).toBeGreaterThan(0);
  });

  it('userMessage mentions credit refund', () => {
    expect(ERR.userMessage.toLowerCase()).toContain('credit');
  });

  it('message contains jobId', () => {
    expect(ERR.message).toContain('job-001');
  });

  it('message contains format', () => {
    expect(ERR.message).toContain('instagram_post');
  });

  it('message contains the cause', () => {
    expect(ERR.message).toContain('SVG renderer crashed');
  });

  it('name is PipelineHardFailureError', () => {
    expect(ERR.name).toBe('PipelineHardFailureError');
  });

  it('can be thrown and caught', () => {
    expect(() => {
      throw new PipelineHardFailureError('j', 'f', 'cause');
    }).toThrow(Error);
  });

  it('different causes produce different messages', () => {
    const a = new PipelineHardFailureError('j', 'f', 'cause-A');
    const b = new PipelineHardFailureError('j', 'f', 'cause-B');
    expect(a.message).not.toBe(b.message);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SpendGuardError
// ══════════════════════════════════════════════════════════════════════════════
describe('SpendGuardError', () => {
  const ERR = new SpendGuardError('job-001', 'instagram_post', 'MONTHLY_SPEND_EXCEEDED', 'Monthly budget $50 exceeded');

  it('is an instance of Error', () => {
    expect(ERR).toBeInstanceOf(Error);
  });

  it('is an instance of SpendGuardError', () => {
    expect(ERR).toBeInstanceOf(SpendGuardError);
  });

  it('code is set from constructor', () => {
    expect(ERR.code).toBe('MONTHLY_SPEND_EXCEEDED');
  });

  it('jobId is set', () => {
    expect(ERR.jobId).toBe('job-001');
  });

  it('format is set', () => {
    expect(ERR.format).toBe('instagram_post');
  });

  it('message contains the detail', () => {
    expect(ERR.message).toContain('Monthly budget $50 exceeded');
  });

  it('name is SpendGuardError', () => {
    expect(ERR.name).toBe('SpendGuardError');
  });

  it('different codes produce different code values', () => {
    const a = new SpendGuardError('j', 'f', 'CODE_A', 'detail');
    const b = new SpendGuardError('j', 'f', 'CODE_B', 'detail');
    expect(a.code).toBe('CODE_A');
    expect(b.code).toBe('CODE_B');
  });

  it('can be thrown and caught as an Error', () => {
    expect(() => {
      throw new SpendGuardError('j', 'f', 'SOME_CODE', 'detail');
    }).toThrow(Error);
  });

  it('code, jobId, format are readonly fields', () => {
    // TypeScript enforces readonly at compile time; runtime: just verify they exist
    expect(ERR.code).toBeDefined();
    expect(ERR.jobId).toBeDefined();
    expect(ERR.format).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RenderTimeoutError (cross-reference with render-queue.test.ts)
// ══════════════════════════════════════════════════════════════════════════════
describe('RenderTimeoutError — cross-module', () => {
  const ERR = new RenderTimeoutError('job-timeout-001', 45000);

  it('is instanceof Error', () => {
    expect(ERR).toBeInstanceOf(Error);
  });

  it('code is RENDER_TIMEOUT', () => {
    expect(ERR.code).toBe('RENDER_TIMEOUT');
  });

  it('jobId is set', () => {
    expect(ERR.jobId).toBe('job-timeout-001');
  });

  it('timeoutMs is set', () => {
    expect(ERR.timeoutMs).toBe(45000);
  });

  it('message mentions jobId and timeoutMs', () => {
    expect(ERR.message).toContain('job-timeout-001');
    expect(ERR.message).toContain('45000');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Error hierarchy invariants
// ══════════════════════════════════════════════════════════════════════════════
describe('Pipeline error hierarchy invariants', () => {
  it('all 4 error classes are instances of Error', () => {
    const errors = [
      new KillSwitchError('j', 'f'),
      new PipelineHardFailureError('j', 'f', 'cause'),
      new SpendGuardError('j', 'f', 'code', 'detail'),
      new RenderTimeoutError('j', 1000),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(Error);
    }
  });

  it('all 4 error classes have distinct names', () => {
    const names = [
      new KillSwitchError('j', 'f').name,
      new PipelineHardFailureError('j', 'f', 'c').name,
      new SpendGuardError('j', 'f', 'c', 'd').name,
      new RenderTimeoutError('j', 1).name,
    ];
    expect(new Set(names).size).toBe(4);
  });

  it('all 4 error classes have non-empty messages', () => {
    const errors = [
      new KillSwitchError('j', 'f'),
      new PipelineHardFailureError('j', 'f', 'cause'),
      new SpendGuardError('j', 'f', 'code', 'detail'),
      new RenderTimeoutError('j', 1000),
    ];
    for (const e of errors) {
      expect(e.message.length).toBeGreaterThan(0);
    }
  });

  it('kill switch and hard failure have distinct http status codes', () => {
    const kill = new KillSwitchError('j', 'f');
    const hard = new PipelineHardFailureError('j', 'f', 'c');
    expect(kill.httpStatus).not.toBe(hard.httpStatus);
  });
});
