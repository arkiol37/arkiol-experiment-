/**
 * Quality Gate — shared quality enforcement thresholds for both pipelines.
 * Acts as a go/no-go decision point before renders proceed to final export.
 */
export interface QualityGateResult {
  passed: boolean;
  overallScore: number;
  gates: { name: string; score: number; threshold: number; passed: boolean; critical: boolean }[];
  blockers: string[];
  warnings: string[];
}

export interface QualityGateConfig {
  minOverallScore: number;
  gates: { name: string; threshold: number; critical: boolean }[];
}

export const DEFAULT_QUALITY_GATE: QualityGateConfig = {
  minOverallScore: 60,
  gates: [
    { name: 'visual_quality', threshold: 50, critical: false },
    { name: 'brand_consistency', threshold: 55, critical: true },
    { name: 'audio_sync', threshold: 40, critical: false },
    { name: 'readability', threshold: 50, critical: false },
    { name: 'structural_integrity', threshold: 60, critical: true },
    { name: 'platform_compliance', threshold: 70, critical: true },
  ],
};

export const CINEMATIC_QUALITY_GATE: QualityGateConfig = {
  minOverallScore: 70,
  gates: [
    { name: 'visual_quality', threshold: 65, critical: true },
    { name: 'brand_consistency', threshold: 60, critical: true },
    { name: 'motion_coherence', threshold: 55, critical: false },
    { name: 'audio_sync', threshold: 50, critical: false },
    { name: 'cinematic_grade', threshold: 60, critical: true },
    { name: 'platform_compliance', threshold: 70, critical: true },
  ],
};

export function evaluateQualityGate(scores: Record<string, number>, config: QualityGateConfig = DEFAULT_QUALITY_GATE): QualityGateResult {
  const gates = config.gates.map(gate => {
    const score = scores[gate.name] ?? 0;
    return { name: gate.name, score, threshold: gate.threshold, passed: score >= gate.threshold, critical: gate.critical };
  });
  const blockers = gates.filter(g => !g.passed && g.critical).map(g => `${g.name}: ${g.score}/${g.threshold}`);
  const warnings = gates.filter(g => !g.passed && !g.critical).map(g => `${g.name}: ${g.score}/${g.threshold}`);
  const overallScore = gates.length > 0 ? gates.reduce((s, g) => s + g.score, 0) / gates.length : 0;
  return { passed: blockers.length === 0 && overallScore >= config.minOverallScore, overallScore: Math.round(overallScore), gates, blockers, warnings };
}
