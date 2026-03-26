// packages/shared/src/ai/archetypes/intelligenceEngine.ts
// Advanced Archetype + Preset Intelligence Engine (Stage 8 of orchestrator).
//
// Analyzes prompt, platform, campaign intent, and audience signals to:
//   1. Deterministically select the best archetype with a confidence score
//   2. Select or derive the appropriate style preset (with optional brand override)
//   3. Store selection + reasoning in metadata for benchmarking and learning
//
// Design contracts:
//   ✓ Deterministic — same inputs always produce the same output
//   ✓ Never throws — all errors produce a validated fallback selection
//   ✓ No global/window usage
//   ✓ No process.env usage (env accessed via shared env module at call site)
//   ✓ Stage-isolated — reads inputs only, never mutates upstream state
//   ✓ Schema-validated output at every exit point

import { z } from 'zod';
import {
  ArchetypeId, StylePresetId,
  ArchetypeSelection, PresetSelection, ArchetypeIntelligenceResult,
  ArchetypeSelectionSchema, PresetSelectionSchema, ArchetypeIntelligenceResultSchema,
  ArchetypePresetOverride,
  ARCHETYPE_IDS, STYLE_PRESET_IDS,
} from './types';
import { ARCHETYPE_MAP } from './archetypes';
import { ARCHETYPE_PREFERRED_PRESETS, pickPresetForPlatform, isValidPresetId } from './stylePresets';
import { stableHash } from './helpers';

// ── Intelligence inputs ───────────────────────────────────────────────────────

export interface ArchetypeIntelligenceInput {
  /** Raw user prompt */
  prompt:           string;
  /** Format/platform (e.g. 'instagram_post', 'youtube_thumbnail') */
  format:           string;
  /** Campaign intent signals from Stage 1 */
  campaignIntent?:  string;
  /** Audience segment from Stage 4 */
  audienceSegment?: string;
  /** Tone from Stage 4 */
  tonePreference?:  string;
  /** Layout type from Stage 2 */
  layoutType?:      string;
  /** Whether image is provided */
  imageProvided:    boolean;
  /** Whether face is detected */
  faceDetected:     boolean;
  /** Optional brand override flags */
  brandHasDarkBg?:  boolean;
  /** Manual override from editor UI (archetypeId | presetId can be 'auto') */
  userOverride?:    ArchetypePresetOverride;
}

// ── Scoring table ─────────────────────────────────────────────────────────────
// Each signal contributes additive score points (0–100 base scale).
// We normalize to confidence [0.0, 1.0] at the end.

interface ScoredArchetype {
  id:    ArchetypeId;
  score: number;
  reasons: string[];
}

const KEYWORD_SIGNALS: Array<{ keywords: string[]; archetypes: ArchetypeId[]; points: number }> = [
  // High-confidence single-archetype signals
  { keywords: ['sport', 'athlete', 'game', 'match', 'team', 'coach', 'gym'],           archetypes: ['SPORTS_ACTION'],         points: 40 },
  { keywords: ['music', 'album', 'artist', 'track', 'playlist', 'concert', 'band'],    archetypes: ['MUSIC_ARTISTIC'],         points: 40 },
  { keywords: ['luxury', 'premium', 'exclusive', 'elite', 'high-end', 'gold', 'vip'],  archetypes: ['LUXURY_PREMIUM'],         points: 40 },
  { keywords: ['tech', 'ai', 'software', 'app', 'startup', 'saas', 'digital', 'robot'],archetypes: ['TECH_FUTURISTIC'],        points: 35 },
  { keywords: ['kid', 'children', 'child', 'baby', 'play', 'toy', 'fun school'],       archetypes: ['KIDS_PLAYFUL'],           points: 40 },
  { keywords: ['breaking', 'urgent', 'alert', 'news', 'update', 'announcement'],       archetypes: ['NEWS_URGENT'],            points: 40 },
  { keywords: ['versus', ' vs ', 'compare', 'vs.', 'face off', 'battle'],              archetypes: ['COMPARISON_VS'],          points: 40 },
  { keywords: ['product', 'showcase', 'launch', 'release', 'shop', 'buy', 'sale'],     archetypes: ['PRODUCT_FOCUS'],          points: 35 },
  { keywords: ['minimal', 'clean', 'simple', 'whitespace', 'neat'],                    archetypes: ['MINIMAL_CLEAN'],          points: 30 },
  { keywords: ['mystery', 'secret', 'reveal', 'hidden', 'discover', 'unknown'],        archetypes: ['CURIOSITY_MYSTERY'],      points: 35 },
  { keywords: ['trust', 'friendly', 'community', 'care', 'family', 'warm', 'local'],   archetypes: ['TRUST_FRIENDLY'],         points: 30 },
  { keywords: ['learn', 'education', 'how to', 'explainer', 'tutorial', 'guide', 'tips'], archetypes: ['EDUCATIONAL_EXPLAINER'], points: 35 },
  { keywords: ['religion', 'faith', 'church', 'spiritual', 'prayer', 'god', 'calm'],   archetypes: ['RELIGION_CALM'],          points: 40 },
  { keywords: ['emotion', 'story', 'journey', 'heart', 'feel', 'inspire', 'motivat'],  archetypes: ['EMOTIONAL_STORY'],        points: 30 },
  { keywords: ['cinema', 'film', 'movie', 'dark', 'dramatic', 'cinematic'],            archetypes: ['CINEMATIC_DARK'],         points: 35 },
  { keywords: ['authority', 'expert', 'professional', 'speaker', 'thought leader'],    archetypes: ['AUTHORITY_EXPERT'],       points: 35 },
  { keywords: ['bold', 'statement', 'powerful', 'impact', 'claim', 'big'],             archetypes: ['BOLD_CLAIM', 'AGGRESSIVE_POWER'], points: 25 },
  { keywords: ['face', 'portrait', 'closeup', 'close-up', 'headshot'],                 archetypes: ['FACE_CLOSEUP'],           points: 35 },
  { keywords: ['fun', 'playful', 'emoji', 'silly', 'cute', 'colorful'],                archetypes: ['FUN_PLAYFUL'],            points: 30 },
  { keywords: ['aggressive', 'power', 'dominate', 'win', 'crush', 'unstoppable'],      archetypes: ['AGGRESSIVE_POWER'],       points: 40 },
];

// Format / platform signals
const FORMAT_SIGNALS: Array<{ patterns: string[]; archetypes: ArchetypeId[]; points: number }> = [
  { patterns: ['youtube'],      archetypes: ['AGGRESSIVE_POWER', 'BOLD_CLAIM', 'CURIOSITY_MYSTERY', 'CINEMATIC_DARK'], points: 15 },
  { patterns: ['instagram'],    archetypes: ['PRODUCT_FOCUS', 'TRUST_FRIENDLY', 'MUSIC_ARTISTIC', 'FUN_PLAYFUL'],      points: 15 },
  { patterns: ['story'],        archetypes: ['EMOTIONAL_STORY', 'FUN_PLAYFUL', 'CURIOSITY_MYSTERY'],                   points: 15 },
  { patterns: ['linkedin', 'resume', 'slide'], archetypes: ['AUTHORITY_EXPERT', 'EDUCATIONAL_EXPLAINER', 'TRUST_FRIENDLY'], points: 20 },
  { patterns: ['poster', 'flyer'], archetypes: ['BOLD_CLAIM', 'NEWS_URGENT', 'LUXURY_PREMIUM', 'SPORTS_ACTION'],      points: 15 },
];

// Audience signals
const AUDIENCE_SIGNALS: Array<{ segments: string[]; archetypes: ArchetypeId[]; points: number }> = [
  { segments: ['b2b', 'enterprise', 'corporate'], archetypes: ['AUTHORITY_EXPERT', 'PROFESSIONAL', 'TRUST_FRIENDLY'] as ArchetypeId[], points: 15 },
  { segments: ['consumer', 'general'],            archetypes: ['TRUST_FRIENDLY', 'PRODUCT_FOCUS', 'FUN_PLAYFUL'],                      points: 10 },
  { segments: ['youth', 'gen-z', 'teen'],         archetypes: ['SPORTS_ACTION', 'MUSIC_ARTISTIC', 'FUN_PLAYFUL', 'TECH_FUTURISTIC'],   points: 15 },
];

// Image/face context signals
const CONTEXT_BONUSES: Array<{ condition: (i: ArchetypeIntelligenceInput) => boolean; archetypes: ArchetypeId[]; points: number }> = [
  { condition: i => i.faceDetected,  archetypes: ['FACE_CLOSEUP', 'SPORTS_ACTION', 'TRUST_FRIENDLY', 'CURIOSITY_MYSTERY', 'KIDS_PLAYFUL', 'FUN_PLAYFUL', 'EMOTIONAL_STORY'], points: 20 },
  { condition: i => !i.imageProvided, archetypes: ['MINIMAL_CLEAN', 'BOLD_CLAIM', 'NEWS_URGENT', 'EDUCATIONAL_EXPLAINER', 'AUTHORITY_EXPERT', 'RELIGION_CALM'], points: 25 },
  { condition: i => i.imageProvided && !i.faceDetected, archetypes: ['PRODUCT_FOCUS', 'CINEMATIC_DARK', 'LUXURY_PREMIUM', 'MUSIC_ARTISTIC', 'COMPARISON_VS', 'TECH_FUTURISTIC'], points: 15 },
];

// Archetypes that require image/face — if conditions not met, they are penalized
const REQUIRES_IMAGE = new Set<ArchetypeId>([
  'AGGRESSIVE_POWER', 'CURIOSITY_MYSTERY', 'PRODUCT_FOCUS', 'TRUST_FRIENDLY',
  'CINEMATIC_DARK', 'SPORTS_ACTION', 'MUSIC_ARTISTIC', 'COMPARISON_VS',
  'FACE_CLOSEUP', 'KIDS_PLAYFUL', 'LUXURY_PREMIUM', 'TECH_FUTURISTIC',
  'FUN_PLAYFUL', 'EMOTIONAL_STORY',
]);

const REQUIRES_FACE = new Set<ArchetypeId>([
  'CURIOSITY_MYSTERY', 'SPORTS_ACTION', 'FACE_CLOSEUP',
  'KIDS_PLAYFUL', 'FUN_PLAYFUL', 'EMOTIONAL_STORY',
]);

const IMAGE_OPTIONAL = new Set<ArchetypeId>([
  'EDUCATIONAL_EXPLAINER', 'AUTHORITY_EXPERT',
]);

// ── Archetype selection ───────────────────────────────────────────────────────

function scoreAllArchetypes(input: ArchetypeIntelligenceInput): ScoredArchetype[] {
  const scores = new Map<ArchetypeId, ScoredArchetype>();
  for (const id of ARCHETYPE_IDS) {
    scores.set(id, { id, score: 0, reasons: [] });
  }

  const prompt = (input.prompt + ' ' + (input.campaignIntent ?? '')).toLowerCase();

  // Keyword signals
  for (const sig of KEYWORD_SIGNALS) {
    for (const kw of sig.keywords) {
      if (prompt.includes(kw)) {
        for (const id of sig.archetypes) {
          const s = scores.get(id)!;
          s.score += sig.points;
          s.reasons.push(`keyword "${kw}"`);
        }
        break; // one match per signal group
      }
    }
  }

  // Format signals
  const fmt = input.format.toLowerCase();
  for (const sig of FORMAT_SIGNALS) {
    if (sig.patterns.some(p => fmt.includes(p))) {
      for (const id of sig.archetypes) {
        const s = scores.get(id);
        if (s) { s.score += sig.points; s.reasons.push(`format "${input.format}"`); }
      }
    }
  }

  // Audience signals
  const aud = (input.audienceSegment ?? '').toLowerCase();
  for (const sig of AUDIENCE_SIGNALS) {
    if (sig.segments.some(seg => aud.includes(seg))) {
      for (const id of sig.archetypes) {
        const s = scores.get(id);
        if (s) { s.score += sig.points; s.reasons.push(`audience "${input.audienceSegment}"`); }
      }
    }
  }

  // Image/face context bonuses
  for (const sig of CONTEXT_BONUSES) {
    if (sig.condition(input)) {
      for (const id of sig.archetypes) {
        const s = scores.get(id);
        if (s) { s.score += sig.points; s.reasons.push('context match'); }
      }
    }
  }

  // Hard penalties — archetypes that require unavailable context
  for (const [id, s] of scores) {
    if (REQUIRES_IMAGE.has(id) && !IMAGE_OPTIONAL.has(id) && !input.imageProvided) {
      s.score = Math.max(0, s.score - 60);
      s.reasons.push('penalized: image required but not provided');
    }
    if (REQUIRES_FACE.has(id) && !input.faceDetected) {
      s.score = Math.max(0, s.score - 60);
      s.reasons.push('penalized: face required but not detected');
    }
  }

  return Array.from(scores.values()).sort((a, b) => b.score - a.score);
}

function pickArchetype(input: ArchetypeIntelligenceInput): ArchetypeSelection {
  // User override: if a specific archetype was explicitly chosen, use it
  if (input.userOverride?.archetypeId && input.userOverride.archetypeId !== 'auto') {
    const id = input.userOverride.archetypeId;
    return {
      archetypeId:   id,
      confidence:    1.0,
      reasoning:     'User-selected archetype override',
      fallback:      false,
    };
  }

  const ranked = scoreAllArchetypes(input);
  const top    = ranked[0];
  const second = ranked[1];

  if (!top || top.score === 0) {
    // Deterministic hash-based fallback
    const h     = stableHash(input.prompt + input.format);
    const fbId  = ARCHETYPE_IDS[h % ARCHETYPE_IDS.length];
    return {
      archetypeId:   fbId,
      confidence:    0.3,
      reasoning:     'No signals matched — hash-based deterministic fallback',
      fallback:      true,
      fallbackReason: 'zero-score',
    };
  }

  // Normalize confidence: top score vs second score gap
  const maxPossibleScore = 100;
  const raw = top.score;
  const gap = top.score - (second?.score ?? 0);
  const confidence = Math.min(0.99, (raw / maxPossibleScore) * 0.6 + (gap / maxPossibleScore) * 0.4);

  return {
    archetypeId: top.id,
    confidence:  Math.round(confidence * 100) / 100,
    reasoning:   top.reasons.slice(0, 4).join('; ') || 'top-scoring archetype',
    fallback:    false,
  };
}

// ── Preset selection ──────────────────────────────────────────────────────────

function pickPreset(
  archetypeId: ArchetypeId,
  input: ArchetypeIntelligenceInput,
): PresetSelection {
  // User override
  if (input.userOverride?.presetId && input.userOverride.presetId !== 'auto') {
    const id = input.userOverride.presetId;
    return {
      presetId:     id,
      brandOverride: false,
      reasoning:    'User-selected preset override',
    };
  }

  // Brand override: if brand prefers dark bg, bias to 'bold'
  if (input.brandHasDarkBg) {
    return {
      presetId:     'bold',
      brandOverride: true,
      reasoning:    'Brand profile prefers dark background → bold preset',
    };
  }

  // Archetype-preferred preset
  const archetypePreferred = ARCHETYPE_PREFERRED_PRESETS[archetypeId];

  // Platform default preset
  const platformPreset = pickPresetForPlatform(input.format);

  // If they agree — high confidence
  if (archetypePreferred === platformPreset) {
    return {
      presetId:     archetypePreferred,
      brandOverride: false,
      reasoning:    `Archetype "${archetypeId}" and platform "${input.format}" agree on "${archetypePreferred}"`,
    };
  }

  // Tone signals can break ties
  const tone = (input.tonePreference ?? '').toLowerCase();
  if (tone === 'playful')      return { presetId: 'expressive',   brandOverride: false, reasoning: `Tone preference "playful" → expressive preset` };
  if (tone === 'professional') return { presetId: 'professional', brandOverride: false, reasoning: `Tone preference "professional" → professional preset` };
  if (tone === 'minimal')      return { presetId: 'minimal',      brandOverride: false, reasoning: `Tone preference "minimal" → minimal preset` };

  // Default: prefer archetype's preferred preset
  return {
    presetId:     archetypePreferred,
    brandOverride: false,
    reasoning:    `Archetype "${archetypeId}" preferred preset "${archetypePreferred}" (platform suggested "${platformPreset}")`,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

const FALLBACK_RESULT: ArchetypeIntelligenceResult = {
  archetype: {
    archetypeId:   'MINIMAL_CLEAN',
    confidence:    0.25,
    reasoning:     'Intelligence engine fallback — using safe default',
    fallback:      true,
    fallbackReason: 'engine-error',
  },
  preset: {
    presetId:     'clean',
    brandOverride: false,
    reasoning:    'Default preset for fallback archetype',
  },
  stageMs: 0,
};

/**
 * selectArchetypeAndPreset
 *
 * The main entry point for Stage 8 (Archetype + Preset Intelligence).
 * Deterministic, never throws. Returns a schema-validated result.
 */
export function selectArchetypeAndPreset(
  input: ArchetypeIntelligenceInput
): ArchetypeIntelligenceResult {
  const t0 = Date.now();
  try {
    const archetype = pickArchetype(input);
    const preset    = pickPreset(archetype.archetypeId, input);

    const result: ArchetypeIntelligenceResult = {
      archetype,
      preset,
      stageMs: Date.now() - t0,
    };

    // Schema validate before returning
    const parsed = ArchetypeIntelligenceResultSchema.safeParse(result);
    if (!parsed.success) {
      return { ...FALLBACK_RESULT, stageMs: Date.now() - t0 };
    }
    return parsed.data;
  } catch {
    return { ...FALLBACK_RESULT, stageMs: Date.now() - t0 };
  }
}

// ── Metadata helpers ──────────────────────────────────────────────────────────
// Returns a flat record suitable for storage in job metadata / benchmark.

export interface ArchetypeSelectionMetadata {
  archetypeId:        ArchetypeId;
  archetypeConfidence: number;
  archetypeReasoning: string;
  archetypeFallback:  boolean;
  presetId:           StylePresetId;
  presetBrandOverride: boolean;
  presetReasoning:    string;
  intelligenceMs:     number;
}

export function buildArchetypeMetadata(
  result: ArchetypeIntelligenceResult
): ArchetypeSelectionMetadata {
  return {
    archetypeId:         result.archetype.archetypeId,
    archetypeConfidence: result.archetype.confidence,
    archetypeReasoning:  result.archetype.reasoning,
    archetypeFallback:   result.archetype.fallback,
    presetId:            result.preset.presetId,
    presetBrandOverride: result.preset.brandOverride,
    presetReasoning:     result.preset.reasoning,
    intelligenceMs:      result.stageMs,
  };
}
