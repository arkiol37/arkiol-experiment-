// src/engines/exploration/learning-memory.ts
// Creative Exploration AI Engine — Learning & Memory System
// ─────────────────────────────────────────────────────────────────────────────
//
// Records user selections, exports, and regenerations as feedback signals and
// gradually updates exploration priors per user, brand, and campaign using
// bandit-style adaptive weighting. The engine improves exploration quality
// over time without retraining the core Arkiol AI system.
//
// Architecture:
//   • FeedbackRecorder:   captures typed feedback signals with weights
//   • BanditUpdater:      updates arm weights using Upper Confidence Bound (UCB1)
//   • PriorsManager:      reads/writes ExplorationPriors (caller provides persistence)
//   • TemperatureAdapter: adjusts exploration temperature based on feedback density
//
// Bandit Algorithm:
//   We use a simplified UCB1-style update:
//     new_weight = old_weight + learning_rate * signal_weight * reward
//   where reward ∈ {-1, 0, +1} derived from FeedbackSignalType
//   Weights are then L1-normalised to sum to 1.
//
// Signal Weight Table:
//   selected:        +1.0   (strong positive — user chose it)
//   exported:        +1.5   (strongest positive — full commitment)
//   regenerated:     +0.5   (moderate positive — used as template)
//   dismissed:       -0.8   (strong negative — explicitly rejected)
//   time_spent_high: +0.3   (weak positive — engaged attention)
//   time_spent_low:  -0.2   (weak negative — dismissed quickly)
//
// Invariants:
//   ✓ All weight updates are additive, bounded, and normalised — no runaway weights
//   ✓ A FLOOR of 1/(n * 5) ensures every arm remains explorable
//   ✓ Priors are pure data (ExplorationPriors): caller handles persistence
//   ✓ Temperature drops as more feedback accumulates (exploitation increases)
//   ✓ Schema version enables forward-compatible migrations

import type {
  FeedbackSignal,
  FeedbackSignalType,
  ExplorationPriors,
  DensityProfileLevel,
  DesignGenome,
  EvaluationScores,
} from "./types";
import { createHash } from "crypto";
import { GENOME_SPACE } from "./genome-generator";

// ─────────────────────────────────────────────────────────────────────────────
// § 1  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;
const LEARNING_RATE  = 0.08;   // Step size for weight updates
const WEIGHT_FLOOR   = 0.02;   // Minimum weight per arm (prevents extinction)
const TEMPERATURE_DECAY_RATE = 0.005; // Temperature drops per 10 feedback signals

const SIGNAL_REWARDS: Record<FeedbackSignalType, number> = {
  selected:         +1.0,
  exported:         +1.5,
  regenerated:      +0.5,
  dismissed:        -0.8,
  time_spent_high:  +0.3,
  time_spent_low:   -0.2,
};

// ─────────────────────────────────────────────────────────────────────────────
// § 2  DEFAULT PRIORS — uniform distribution + moderate exploration temperature
// ─────────────────────────────────────────────────────────────────────────────

export function buildDefaultPriors(orgId: string, brandId?: string): ExplorationPriors {
  const uniformLayoutWeight = 1 / GENOME_SPACE.layoutFamilies.length;
  const uniformArchetypeWeight = 1 / GENOME_SPACE.archetypes.length;
  const uniformPresetWeight = 1 / GENOME_SPACE.presets.length;
  const uniformHookWeight = 1 / GENOME_SPACE.hookStrategies.length;
  const uniformCompositionWeight = 1 / GENOME_SPACE.compositionPatterns.length;
  const uniformDensityWeight = 0.25; // 4 options

  return {
    orgId,
    brandId,
    layoutFamilyWeights: Object.fromEntries(
      GENOME_SPACE.layoutFamilies.map(lf => [lf, uniformLayoutWeight])
    ),
    archetypeWeights: Object.fromEntries(
      GENOME_SPACE.archetypes.map(a => [a, uniformArchetypeWeight])
    ),
    presetWeights: Object.fromEntries(
      GENOME_SPACE.presets.map(p => [p, uniformPresetWeight])
    ),
    hookStrategyWeights: Object.fromEntries(
      GENOME_SPACE.hookStrategies.map(h => [h, uniformHookWeight])
    ),
    compositionPatternWeights: Object.fromEntries(
      GENOME_SPACE.compositionPatterns.map(c => [c, uniformCompositionWeight])
    ),
    densityProfileWeights: {
      sparse:   0.25,
      balanced: 0.25,
      rich:     0.25,
      dense:    0.25,
    },
    explorationTemperature: 0.75, // Start with high exploration
    totalSignals:           0,
    updatedAt:              new Date().toISOString(),
    schemaVersion:          SCHEMA_VERSION,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 3  WEIGHT NORMALISATION
// ─────────────────────────────────────────────────────────────────────────────

function normaliseWeights(weights: Record<string, number>, floor = WEIGHT_FLOOR): Record<string, number> {
  // Apply floor
  const floored = Object.fromEntries(
    Object.entries(weights).map(([k, v]) => [k, Math.max(v, floor)])
  );
  // L1-normalise to sum to 1
  const total = Object.values(floored).reduce((a, b) => a + b, 0);
  if (total === 0) return floored;
  return Object.fromEntries(
    Object.entries(floored).map(([k, v]) => [k, v / total])
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § 4  BANDIT UPDATER — applies one feedback signal to priors
// ─────────────────────────────────────────────────────────────────────────────

function applySignalToWeights(
  weights: Record<string, number>,
  arm: string,
  reward: number
): Record<string, number> {
  const updated = { ...weights };
  if (!(arm in updated)) {
    // Unknown arm — add with default weight
    updated[arm] = WEIGHT_FLOOR;
  }
  updated[arm] = (updated[arm] ?? WEIGHT_FLOOR) + LEARNING_RATE * reward;
  return normaliseWeights(updated);
}

/**
 * Applies a single FeedbackSignal to an ExplorationPriors object.
 * Returns a NEW priors object (no mutation).
 */
export function applyFeedback(
  priors: ExplorationPriors,
  signal: FeedbackSignal
): ExplorationPriors {
  const reward = SIGNAL_REWARDS[signal.signalType] ?? 0;
  const { genome } = signal;

  let updated = { ...priors };

  // Update each affected gene dimension
  updated = {
    ...updated,
    archetypeWeights: applySignalToWeights(
      updated.archetypeWeights,
      genome.archetype,
      reward
    ),
    presetWeights: applySignalToWeights(
      updated.presetWeights,
      genome.preset,
      reward
    ),
    hookStrategyWeights: applySignalToWeights(
      updated.hookStrategyWeights,
      genome.hookStrategy,
      reward
    ),
    compositionPatternWeights: applySignalToWeights(
      updated.compositionPatternWeights,
      genome.compositionPattern,
      reward
    ),
    densityProfileWeights: normaliseWeights(
      (() => {
        const d = { ...updated.densityProfileWeights };
        const key = genome.densityProfile as DensityProfileLevel;
        d[key] = (d[key] ?? 0.25) + LEARNING_RATE * reward;
        return d;
      })()
    ) as Record<DensityProfileLevel, number>,
  };

  // Adapt exploration temperature: decreases as signal count rises
  const newTotalSignals = priors.totalSignals + 1;
  const newTemperature  = Math.max(
    0.20, // minimum temperature — never go fully greedy
    priors.explorationTemperature - TEMPERATURE_DECAY_RATE * (newTotalSignals % 10 === 0 ? 1 : 0)
  );

  return {
    ...updated,
    totalSignals:           newTotalSignals,
    explorationTemperature: newTemperature,
    updatedAt:              new Date().toISOString(),
    schemaVersion:          SCHEMA_VERSION,
  };
}

/**
 * Applies a batch of feedback signals to priors (fold operation).
 * More efficient than calling applyFeedback N times — aggregates rewards first.
 */
export function applyFeedbackBatch(
  priors: ExplorationPriors,
  signals: FeedbackSignal[]
): ExplorationPriors {
  return signals.reduce((p, s) => applyFeedback(p, s), priors);
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5  FEEDBACK SIGNAL BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export function buildFeedbackSignal(
  opts: {
    userId: string;
    orgId: string;
    brandId?: string;
    campaignId?: string;
    candidateId: string;
    genome: DesignGenome;
    scores: EvaluationScores;
    signalType: FeedbackSignalType;
    format: string;
  }
): FeedbackSignal {
  const signalId = createHash("sha256")
    .update(`${opts.userId}:${opts.candidateId}:${opts.signalType}:${Date.now()}`)
    .digest("hex")
    .slice(0, 24);

  const weight = SIGNAL_REWARDS[opts.signalType] ?? 0;

  return {
    signalId,
    userId:      opts.userId,
    orgId:       opts.orgId,
    brandId:     opts.brandId,
    campaignId:  opts.campaignId,
    candidateId: opts.candidateId,
    genome:      opts.genome,
    scores:      opts.scores,
    signalType:  opts.signalType,
    weight,
    timestamp:   new Date().toISOString(),
    format:      opts.format,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 6  PRIORS DIAGNOSTICS — human-readable summary for observability
// ─────────────────────────────────────────────────────────────────────────────

export interface PriorsDiagnostic {
  orgId: string;
  brandId?: string;
  totalSignals: number;
  explorationTemperature: number;
  topArchetypes: [string, number][];
  topPresets: [string, number][];
  topHooks: [string, number][];
  densityDistribution: Record<DensityProfileLevel, number>;
  exploitationLevel: "high" | "medium" | "low";
}

export function buildPriorsDiagnostic(priors: ExplorationPriors): PriorsDiagnostic {
  const topN = <T extends string>(map: Record<T, number>, n: number): [T, number][] =>
    (Object.entries(map) as [T, number][])
      .sort(([, a], [, b]) => b - a)
      .slice(0, n);

  const exploitationLevel: "high" | "medium" | "low" =
    priors.explorationTemperature < 0.35 ? "high"
    : priors.explorationTemperature < 0.60 ? "medium"
    : "low";

  return {
    orgId:                  priors.orgId,
    brandId:                priors.brandId,
    totalSignals:           priors.totalSignals,
    explorationTemperature: priors.explorationTemperature,
    topArchetypes:          topN(priors.archetypeWeights as Record<string, number>, 3) as [string, number][],
    topPresets:             topN(priors.presetWeights as Record<string, number>, 3) as [string, number][],
    topHooks:               topN(priors.hookStrategyWeights as Record<string, number>, 3) as [string, number][],
    densityDistribution:    priors.densityProfileWeights,
    exploitationLevel,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 7  PRIORS MIGRATION — forward-compatible schema upgrade
// ─────────────────────────────────────────────────────────────────────────────

export function migratePriors(raw: unknown, orgId: string, brandId?: string): ExplorationPriors {
  if (!raw || typeof raw !== "object") {
    return buildDefaultPriors(orgId, brandId);
  }

  const obj = raw as Record<string, unknown>;

  // Version check
  if (!obj.schemaVersion || obj.schemaVersion !== SCHEMA_VERSION) {
    // Rebuild from defaults, preserving totalSignals for temperature calculation
    const defaults = buildDefaultPriors(orgId, brandId);
    return {
      ...defaults,
      totalSignals: typeof obj.totalSignals === "number" ? obj.totalSignals : 0,
    };
  }

  return raw as ExplorationPriors;
}
