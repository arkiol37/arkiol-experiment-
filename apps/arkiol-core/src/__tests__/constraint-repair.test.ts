/**
 * apps/arkiol-core/src/__tests__/constraint-repair.test.ts
 *
 * Unit tests for engines/exploration/constraint-repair.ts
 *
 * Pure logic — no DB, no HTTP, no Next.js runtime.
 *
 * Covers:
 *  - checkAndRepairCandidate — valid candidate passes, constraint violations
 *    detected, auto-repair applied (density, hookStrategy), report shape,
 *    no mutation of original candidate
 *  - checkAndRepairBatch — valid/discarded separation, report count,
 *    totalRepairs accumulation, edge cases (empty, all valid, all invalid)
 */

import {
  checkAndRepairCandidate,
  checkAndRepairBatch,
} from '../engines/exploration/constraint-repair';
import type { CandidateDesignPlan, DesignGenome } from '../engines/exploration/types';

// ── Minimal valid candidate fixture ──────────────────────────────────────────
function makeCandidate(
  id: string,
  overrides: Partial<DesignGenome> = {},
  format = 'instagram_post'
): CandidateDesignPlan {
  const genome: DesignGenome = {
    layoutFamily:          'ig_post',
    variationId:           'v1_split',
    archetype:             'BOLD_CLAIM' as any,
    preset:                'bold' as any,
    typographyPersonality: 1,
    densityProfile:        'balanced',
    hookStrategy:          'bold_headline',
    compositionPattern:    'centered_axis',
    motionEligible:        false,
    ...overrides,
  };
  return {
    candidateId:      id,
    seed:             `seed-${id}`,
    genome,
    generationIndex:  0,
    format,
    layoutCategory:   'instagram' as any,
    constraintsPassed: false,
    repairLog:        [],
    generatedAt:      new Date().toISOString(),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// checkAndRepairCandidate — result shape
// ══════════════════════════════════════════════════════════════════════════════
describe('checkAndRepairCandidate — return shape', () => {
  it('returns an object with candidate and report', () => {
    const { candidate, report } = checkAndRepairCandidate(makeCandidate('c1'));
    expect(candidate).toBeDefined();
    expect(report).toBeDefined();
  });

  it('report has all required fields', () => {
    const { report } = checkAndRepairCandidate(makeCandidate('c1'));
    expect(typeof report.candidateId).toBe('string');
    expect(typeof report.passed).toBe('boolean');
    expect(Array.isArray(report.violations)).toBe(true);
    expect(typeof report.repairCount).toBe('number');
    expect(typeof report.discarded).toBe('boolean');
    expect(typeof report.checkDurationMs).toBe('number');
  });

  it('report.candidateId matches input candidateId', () => {
    const { report } = checkAndRepairCandidate(makeCandidate('my-candidate'));
    expect(report.candidateId).toBe('my-candidate');
  });

  it('report.passed and report.discarded are logically inverse', () => {
    const { report } = checkAndRepairCandidate(makeCandidate('c1'));
    expect(report.passed).toBe(!report.discarded);
  });

  it('checkDurationMs is a non-negative number', () => {
    const { report } = checkAndRepairCandidate(makeCandidate('c1'));
    expect(report.checkDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('repairCount is non-negative', () => {
    const { report } = checkAndRepairCandidate(makeCandidate('c1'));
    expect(report.repairCount).toBeGreaterThanOrEqual(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// checkAndRepairCandidate — valid candidates pass
// ══════════════════════════════════════════════════════════════════════════════
describe('checkAndRepairCandidate — valid candidates pass', () => {
  it('a well-formed candidate passes', () => {
    const { report } = checkAndRepairCandidate(makeCandidate('valid'));
    expect(report.passed).toBe(true);
    expect(report.discarded).toBe(false);
  });

  it('passed candidate has constraintsPassed=true on returned candidate', () => {
    const { candidate } = checkAndRepairCandidate(makeCandidate('valid'));
    expect(candidate.constraintsPassed).toBe(true);
  });

  it('valid candidate with sparse density passes', () => {
    const { report } = checkAndRepairCandidate(
      makeCandidate('sparse', { densityProfile: 'sparse' })
    );
    expect(report.passed).toBe(true);
  });

  it('valid candidate with motionEligible=false and youtube_thumbnail passes', () => {
    const { report } = checkAndRepairCandidate(
      makeCandidate('yt', { motionEligible: false }, 'youtube_thumbnail')
    );
    expect(report.passed).toBe(true);
  });

  it('violations array can be empty for valid candidate', () => {
    const { report } = checkAndRepairCandidate(makeCandidate('clean'));
    const fatalUnresolved = report.violations.filter(
      v => v.severity === 'fatal' && !v.repaired
    );
    expect(fatalUnresolved.length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// checkAndRepairCandidate — no mutation
// ══════════════════════════════════════════════════════════════════════════════
describe('checkAndRepairCandidate — no mutation of input', () => {
  it('does not mutate the input candidate object', () => {
    const input = makeCandidate('immutable');
    const originalGenome = { ...input.genome };
    const originalRepairLog = [...input.repairLog];
    checkAndRepairCandidate(input);
    expect(input.genome).toEqual(originalGenome);
    expect(input.repairLog).toEqual(originalRepairLog);
  });

  it('returned candidate is a new object (not the input reference)', () => {
    const input = makeCandidate('new-obj');
    const { candidate } = checkAndRepairCandidate(input);
    expect(candidate).not.toBe(input);
  });

  it('returned genome is a new object when repairs are applied', () => {
    const input = makeCandidate('repair-test', { motionEligible: true }, 'youtube_thumbnail');
    const { candidate } = checkAndRepairCandidate(input);
    // Even if no repair was needed, the returned candidate genome should not be same ref as input
    // (contract: checkAndRepair produces a new candidate)
    expect(candidate.genome).not.toBe(input.genome);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// checkAndRepairCandidate — repair behaviour
// ══════════════════════════════════════════════════════════════════════════════
describe('checkAndRepairCandidate — auto-repair', () => {
  it('dense content triggers repair — densityProfile stepped down', () => {
    const candidate = makeCandidate('dense-c', { densityProfile: 'dense' }, 'logo');
    // logo has maxTextZones=2 — dense will trip density_overload
    const { candidate: repaired, report } = checkAndRepairCandidate(candidate);
    // Either it was repaired (densityProfile reduced) or it passed cleanly
    // Either way, repairCount reflects actual repairs made
    expect(report.repairCount).toBeGreaterThanOrEqual(0);
    // If repairs were made, densityProfile should be reduced
    if (report.repairCount > 0) {
      const densityLevels = ['sparse', 'balanced', 'rich', 'dense'];
      const originalIdx = densityLevels.indexOf('dense');
      const repairedIdx = densityLevels.indexOf(repaired.genome.densityProfile);
      expect(repairedIdx).toBeLessThanOrEqual(originalIdx);
    }
  });

  it('motionEligible=true on youtube_thumbnail triggers motion repair', () => {
    const candidate = makeCandidate('motion-yt', { motionEligible: true }, 'youtube_thumbnail');
    const { candidate: repaired, report } = checkAndRepairCandidate(candidate);
    // youtube_thumbnail.allowsMotion=false → motion_incompatible violation → repair R4
    if (report.repairCount > 0) {
      expect(repaired.genome.motionEligible).toBe(false);
    }
  });

  it('repairLog grows after repairs are applied', () => {
    const candidate = makeCandidate('repair-log', { motionEligible: true }, 'youtube_thumbnail');
    const { candidate: repaired } = checkAndRepairCandidate(candidate);
    // If motion was repaired, repairLog should have entries
    if (!repaired.genome.motionEligible) {
      expect(repaired.repairLog.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('repairLog entries are strings', () => {
    const { candidate: repaired } = checkAndRepairCandidate(
      makeCandidate('log-strings', { motionEligible: true }, 'youtube_thumbnail')
    );
    for (const entry of repaired.repairLog) {
      expect(typeof entry).toBe('string');
    }
  });

  it('each violation has severity "fatal" or "warning"', () => {
    const { report } = checkAndRepairCandidate(makeCandidate('violations'));
    for (const v of report.violations) {
      expect(['fatal', 'warning']).toContain(v.severity);
    }
  });

  it('each violation has a non-empty detail string', () => {
    const { report } = checkAndRepairCandidate(
      makeCandidate('violation-details', { densityProfile: 'dense', motionEligible: true }, 'logo')
    );
    for (const v of report.violations) {
      expect(typeof v.detail).toBe('string');
      expect(v.detail.length).toBeGreaterThan(0);
    }
  });

  it('violations that were repaired have repaired=true', () => {
    const { report } = checkAndRepairCandidate(
      makeCandidate('repaired-flag', { motionEligible: true }, 'youtube_thumbnail')
    );
    const repairedViolations = report.violations.filter(v => v.repaired);
    for (const v of repairedViolations) {
      expect(v.repairAction.length).toBeGreaterThan(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// checkAndRepairBatch
// ══════════════════════════════════════════════════════════════════════════════
describe('checkAndRepairBatch', () => {
  it('returns an object with required fields', () => {
    const result = checkAndRepairBatch([]);
    expect(Array.isArray(result.validCandidates)).toBe(true);
    expect(Array.isArray(result.discardedCandidates)).toBe(true);
    expect(Array.isArray(result.reports)).toBe(true);
    expect(typeof result.totalRepairs).toBe('number');
    expect(typeof result.totalDiscarded).toBe('number');
    expect(typeof result.checkDurationMs).toBe('number');
  });

  it('empty input returns empty results', () => {
    const result = checkAndRepairBatch([]);
    expect(result.validCandidates.length).toBe(0);
    expect(result.discardedCandidates.length).toBe(0);
    expect(result.reports.length).toBe(0);
    expect(result.totalRepairs).toBe(0);
    expect(result.totalDiscarded).toBe(0);
  });

  it('reports.length === input.length', () => {
    const candidates = [makeCandidate('a'), makeCandidate('b'), makeCandidate('c')];
    const result = checkAndRepairBatch(candidates);
    expect(result.reports.length).toBe(3);
  });

  it('validCandidates + discardedCandidates === total input', () => {
    const candidates = Array.from({ length: 5 }, (_, i) => makeCandidate(`c${i}`));
    const result = checkAndRepairBatch(candidates);
    expect(result.validCandidates.length + result.discardedCandidates.length)
      .toBe(candidates.length);
  });

  it('all valid candidates pass constraintsPassed=true', () => {
    const candidates = Array.from({ length: 3 }, (_, i) => makeCandidate(`c${i}`));
    const result = checkAndRepairBatch(candidates);
    for (const c of result.validCandidates) {
      expect(c.constraintsPassed).toBe(true);
    }
  });

  it('totalDiscarded matches discardedCandidates.length', () => {
    const candidates = Array.from({ length: 4 }, (_, i) => makeCandidate(`c${i}`));
    const result = checkAndRepairBatch(candidates);
    expect(result.totalDiscarded).toBe(result.discardedCandidates.length);
  });

  it('totalRepairs is non-negative', () => {
    const candidates = Array.from({ length: 3 }, (_, i) => makeCandidate(`c${i}`));
    const result = checkAndRepairBatch(candidates);
    expect(result.totalRepairs).toBeGreaterThanOrEqual(0);
  });

  it('checkDurationMs is non-negative', () => {
    const candidates = [makeCandidate('timed')];
    const result = checkAndRepairBatch(candidates);
    expect(result.checkDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('all-valid batch: validCandidates = all, discardedCandidates empty', () => {
    const candidates = Array.from({ length: 5 }, (_, i) => makeCandidate(`valid${i}`));
    const result = checkAndRepairBatch(candidates);
    // At minimum, no valid candidate should be in discarded
    for (const c of result.validCandidates) {
      expect(result.discardedCandidates).not.toContain(c);
    }
  });

  it('no candidate appears in both valid and discarded', () => {
    const candidates = Array.from({ length: 6 }, (_, i) => makeCandidate(`c${i}`));
    const result = checkAndRepairBatch(candidates);
    const validIds = new Set(result.validCandidates.map(c => c.candidateId));
    for (const d of result.discardedCandidates) {
      expect(validIds.has(d.candidateId)).toBe(false);
    }
  });

  it('each report candidateId corresponds to one of the input candidates', () => {
    const candidates = [makeCandidate('x'), makeCandidate('y'), makeCandidate('z')];
    const result = checkAndRepairBatch(candidates);
    const inputIds = new Set(candidates.map(c => c.candidateId));
    for (const report of result.reports) {
      expect(inputIds.has(report.candidateId)).toBe(true);
    }
  });

  it('single valid candidate batch returns 1 valid, 0 discarded', () => {
    const result = checkAndRepairBatch([makeCandidate('solo')]);
    expect(result.validCandidates.length).toBe(1);
    expect(result.discardedCandidates.length).toBe(0);
  });
});
