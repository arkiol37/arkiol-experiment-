// src/engines/personalization/design-dna.ts
//
// Design DNA — a persistent style profile built from user preferences,
// past generations, selected outputs, and brand usage. The DNA captures
// learned affinities across 8 style dimensions and uses them to bias
// future generation toward outputs the user is more likely to approve.
//
// Key design decisions:
//   • All state is in-memory (no DB dependency) — caller persists if needed
//   • Profiles are keyed by userId + optional brandId for per-brand learning
//   • Affinities are bounded [-1, +1] with decay toward neutral over time
//   • Staleness decay prevents lock-in to early preferences
//   • Profile strength increases with feedback volume, gating influence

// ── Style dimension affinities ─────────────────────────────────────────────

export interface StyleAffinities {
  colorWarmth: number;         // -1 cool ↔ +1 warm
  colorSaturation: number;     // -1 muted ↔ +1 vivid
  contrast: number;            // -1 low ↔ +1 high
  typographyWeight: number;    // -1 light ↔ +1 heavy/bold
  typographyExpressiveness: number; // -1 clean/minimal ↔ +1 expressive/display
  decorationDensity: number;   // -1 none ↔ +1 rich
  spacingDensity: number;      // -1 airy ↔ +1 compact
  layoutComplexity: number;    // -1 simple/centered ↔ +1 complex/z-pattern
}

const NEUTRAL_AFFINITIES: StyleAffinities = {
  colorWarmth: 0,
  colorSaturation: 0,
  contrast: 0,
  typographyWeight: 0,
  typographyExpressiveness: 0,
  decorationDensity: 0,
  spacingDensity: 0,
  layoutComplexity: 0,
};

// ── Theme and layout preferences ───────────────────────────────────────────

export interface ThemePreferences {
  favoriteThemes: Record<string, number>;   // themeId → affinity score [0, 1]
  avoidedThemes: Record<string, number>;    // themeId → avoidance score [0, 1]
  favoriteLayouts: Record<string, number>;  // layoutFamily → affinity [0, 1]
}

// ── Design DNA profile ─────────────────────────────────────────────────────

export interface DesignDNA {
  userId: string;
  brandId?: string;
  affinities: StyleAffinities;
  themePreferences: ThemePreferences;
  totalSignals: number;
  strength: number;            // [0, 1] — confidence in the profile
  lastUpdated: number;         // timestamp
  createdAt: number;
  schemaVersion: 1;
}

// ── Profile store (in-memory, keyed by "userId:brandId") ───────────────────

const _profiles = new Map<string, DesignDNA>();

function profileKey(userId: string, brandId?: string): string {
  return brandId ? `${userId}:${brandId}` : userId;
}

export function getDesignDNA(userId: string, brandId?: string): DesignDNA {
  const key = profileKey(userId, brandId);
  const existing = _profiles.get(key);
  if (existing) return existing;

  const fresh: DesignDNA = {
    userId,
    brandId,
    affinities: { ...NEUTRAL_AFFINITIES },
    themePreferences: { favoriteThemes: {}, avoidedThemes: {}, favoriteLayouts: {} },
    totalSignals: 0,
    strength: 0,
    lastUpdated: Date.now(),
    createdAt: Date.now(),
    schemaVersion: 1,
  };
  _profiles.set(key, fresh);
  return fresh;
}

export function setDesignDNA(dna: DesignDNA): void {
  _profiles.set(profileKey(dna.userId, dna.brandId), dna);
}

export function hasDesignDNA(userId: string, brandId?: string): boolean {
  return _profiles.has(profileKey(userId, brandId));
}

export function deleteDesignDNA(userId: string, brandId?: string): boolean {
  return _profiles.delete(profileKey(userId, brandId));
}

// ── Feedback signal for DNA learning ───────────────────────────────────────

export type DNAFeedbackType =
  | "selected"       // User chose this output (+1.0)
  | "exported"       // User exported/downloaded (+1.5)
  | "favorited"      // User starred/saved (+1.2)
  | "dismissed"      // User skipped/rejected (-0.8)
  | "regenerated"    // User regenerated from this (+0.3)
  | "edited"         // User edited (mild positive) (+0.5)
  | "style_override" // User manually changed style (-0.4 for original)
  ;

export interface DNAFeedbackSignal {
  userId: string;
  brandId?: string;
  feedbackType: DNAFeedbackType;
  themeId?: string;
  layoutFamily?: string;
  styleTraits: Partial<StyleTraitObservation>;
}

export interface StyleTraitObservation {
  warmth: "cool" | "neutral" | "warm";
  saturation: "muted" | "balanced" | "vivid";
  contrast: "low" | "medium" | "high";
  weight: "light" | "regular" | "bold" | "heavy";
  expressiveness: "clean" | "balanced" | "expressive";
  decorations: "none" | "minimal" | "moderate" | "rich";
  spacing: "airy" | "balanced" | "compact";
  layout: "simple" | "balanced" | "complex";
}

// ── Reward weights per feedback type ───────────────────────────────────────

const SIGNAL_REWARDS: Record<DNAFeedbackType, number> = {
  selected: 1.0,
  exported: 1.5,
  favorited: 1.2,
  dismissed: -0.8,
  regenerated: 0.3,
  edited: 0.5,
  style_override: -0.4,
};

// ── Learning constants ─────────────────────────────────────────────────────

const LEARNING_RATE = 0.06;
const AFFINITY_CLAMP = 1.0;
const THEME_AFFINITY_CLAMP = 1.0;
const STRENGTH_GROWTH_RATE = 0.02;
const MAX_STRENGTH = 1.0;
const STALENESS_DECAY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const STALENESS_FACTOR = 0.92;

// ── Trait → affinity dimension mapping ─────────────────────────────────────

const TRAIT_MAP: Record<keyof StyleTraitObservation, { dimension: keyof StyleAffinities; values: Record<string, number> }> = {
  warmth:          { dimension: "colorWarmth",              values: { cool: -1, neutral: 0, warm: 1 } },
  saturation:      { dimension: "colorSaturation",          values: { muted: -1, balanced: 0, vivid: 1 } },
  contrast:        { dimension: "contrast",                 values: { low: -1, medium: 0, high: 1 } },
  weight:          { dimension: "typographyWeight",         values: { light: -1, regular: -0.3, bold: 0.5, heavy: 1 } },
  expressiveness:  { dimension: "typographyExpressiveness",  values: { clean: -1, balanced: 0, expressive: 1 } },
  decorations:     { dimension: "decorationDensity",         values: { none: -1, minimal: -0.4, moderate: 0.3, rich: 1 } },
  spacing:         { dimension: "spacingDensity",            values: { airy: -1, balanced: 0, compact: 1 } },
  layout:          { dimension: "layoutComplexity",          values: { simple: -1, balanced: 0, complex: 1 } },
};

// ── Apply feedback signal to DNA ───────────────────────────────────────────

export function applyDNAFeedback(
  dna: DesignDNA,
  signal: DNAFeedbackSignal,
): DesignDNA {
  const reward = SIGNAL_REWARDS[signal.feedbackType];
  const updated = { ...dna, affinities: { ...dna.affinities }, themePreferences: { ...dna.themePreferences } };

  // Apply staleness decay if profile hasn't been updated recently
  const elapsed = Date.now() - updated.lastUpdated;
  if (elapsed > STALENESS_DECAY_MS) {
    const decayRounds = Math.floor(elapsed / STALENESS_DECAY_MS);
    const decayMult = Math.pow(STALENESS_FACTOR, decayRounds);
    for (const key of Object.keys(updated.affinities) as (keyof StyleAffinities)[]) {
      updated.affinities[key] *= decayMult;
    }
  }

  // Update style affinities from observed traits
  for (const [traitKey, traitValue] of Object.entries(signal.styleTraits)) {
    const mapping = TRAIT_MAP[traitKey as keyof StyleTraitObservation];
    if (!mapping) continue;
    const traitSignal = mapping.values[traitValue as string];
    if (traitSignal === undefined) continue;

    const delta = LEARNING_RATE * reward * traitSignal;
    updated.affinities[mapping.dimension] = clamp(
      updated.affinities[mapping.dimension] + delta,
      -AFFINITY_CLAMP,
      AFFINITY_CLAMP,
    );
  }

  // Update theme preferences
  if (signal.themeId) {
    updated.themePreferences = {
      ...updated.themePreferences,
      favoriteThemes: { ...updated.themePreferences.favoriteThemes },
      avoidedThemes: { ...updated.themePreferences.avoidedThemes },
    };
    if (reward > 0) {
      const current = updated.themePreferences.favoriteThemes[signal.themeId] ?? 0;
      updated.themePreferences.favoriteThemes[signal.themeId] = clamp(
        current + LEARNING_RATE * reward, 0, THEME_AFFINITY_CLAMP,
      );
      // Remove from avoided if present
      delete updated.themePreferences.avoidedThemes[signal.themeId];
    } else {
      const current = updated.themePreferences.avoidedThemes[signal.themeId] ?? 0;
      updated.themePreferences.avoidedThemes[signal.themeId] = clamp(
        current + LEARNING_RATE * Math.abs(reward), 0, THEME_AFFINITY_CLAMP,
      );
    }
  }

  // Update layout preferences
  if (signal.layoutFamily) {
    updated.themePreferences = {
      ...updated.themePreferences,
      favoriteLayouts: { ...updated.themePreferences.favoriteLayouts },
    };
    if (reward > 0) {
      const current = updated.themePreferences.favoriteLayouts[signal.layoutFamily] ?? 0;
      updated.themePreferences.favoriteLayouts[signal.layoutFamily] = clamp(
        current + LEARNING_RATE * reward, 0, THEME_AFFINITY_CLAMP,
      );
    }
  }

  updated.totalSignals++;
  updated.strength = clamp(updated.strength + STRENGTH_GROWTH_RATE, 0, MAX_STRENGTH);
  updated.lastUpdated = Date.now();

  _profiles.set(profileKey(updated.userId, updated.brandId), updated);
  return updated;
}

// ── Batch feedback ─────────────────────────────────────────────────────────

export function applyDNAFeedbackBatch(
  dna: DesignDNA,
  signals: DNAFeedbackSignal[],
): DesignDNA {
  let current = dna;
  for (const signal of signals) {
    current = applyDNAFeedback(current, signal);
  }
  return current;
}

// ── Profile diagnostics ────────────────────────────────────────────────────

export interface DNADiagnostic {
  strength: number;
  totalSignals: number;
  dominantTraits: Array<{ dimension: string; value: number; label: string }>;
  topThemes: Array<{ themeId: string; score: number }>;
  avoidedThemes: Array<{ themeId: string; score: number }>;
  topLayouts: Array<{ layoutFamily: string; score: number }>;
  staleDays: number;
}

export function buildDNADiagnostic(dna: DesignDNA): DNADiagnostic {
  const affinityEntries = Object.entries(dna.affinities) as [keyof StyleAffinities, number][];

  const dominantTraits = affinityEntries
    .filter(([, v]) => Math.abs(v) > 0.15)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([dim, value]) => ({
      dimension: dim,
      value,
      label: value > 0.4 ? "strong" : value > 0.15 ? "mild" : value < -0.4 ? "strong_avoid" : "mild_avoid",
    }));

  const topThemes = Object.entries(dna.themePreferences.favoriteThemes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([themeId, score]) => ({ themeId, score }));

  const avoidedThemes = Object.entries(dna.themePreferences.avoidedThemes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([themeId, score]) => ({ themeId, score }));

  const topLayouts = Object.entries(dna.themePreferences.favoriteLayouts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([layoutFamily, score]) => ({ layoutFamily, score }));

  const staleDays = Math.floor((Date.now() - dna.lastUpdated) / (24 * 60 * 60 * 1000));

  return {
    strength: dna.strength,
    totalSignals: dna.totalSignals,
    dominantTraits,
    topThemes,
    avoidedThemes,
    topLayouts,
    staleDays,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
