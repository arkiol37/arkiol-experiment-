// packages/shared/src/ai/archetypes/types.ts
// Strict TypeScript types for the Arkiol Archetype system.
// No global/window usage. No process.env access. Pure data types.

import { z } from 'zod';

// ── Archetype IDs ─────────────────────────────────────────────────────────────

export const ARCHETYPE_IDS = [
  'AGGRESSIVE_POWER',
  'MINIMAL_CLEAN',
  'CURIOSITY_MYSTERY',
  'PRODUCT_FOCUS',
  'TRUST_FRIENDLY',
  'NEWS_URGENT',
  'CINEMATIC_DARK',
  'SPORTS_ACTION',
  'MUSIC_ARTISTIC',
  'COMPARISON_VS',
  'BOLD_CLAIM',
  'FACE_CLOSEUP',
  'EDUCATIONAL_EXPLAINER',
  'KIDS_PLAYFUL',
  'LUXURY_PREMIUM',
  'AUTHORITY_EXPERT',
  'TECH_FUTURISTIC',
  'RELIGION_CALM',
  'FUN_PLAYFUL',
  'EMOTIONAL_STORY',
] as const;

export type ArchetypeId = typeof ARCHETYPE_IDS[number];

// ── Style Preset IDs ──────────────────────────────────────────────────────────

export const STYLE_PRESET_IDS = [
  'clean',
  'bold',
  'professional',
  'minimal',
  'expressive',
] as const;

export type StylePresetId = typeof STYLE_PRESET_IDS[number];

export type ColorHex = `#${string}`;

// ── Zone geometry ─────────────────────────────────────────────────────────────

export interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── Canvas ────────────────────────────────────────────────────────────────────

export interface Canvas {
  w:    number;
  h:    number;
  safe: number;
}

export const CANVAS_PRESETS: Record<string, Canvas> = {
  youtube:      { w: 1280, h: 720,  safe: 48 },
  instagram:    { w: 1080, h: 1080, safe: 48 },
  story:        { w: 1080, h: 1920, safe: 64 },
  flyer:        { w: 1080, h: 1350, safe: 64 },
  poster:       { w: 1080, h: 1620, safe: 64 },
  slide:        { w: 1280, h: 720,  safe: 48 },
  resume:       { w: 1240, h: 1754, safe: 64 },
  businesscard: { w: 1050, h: 600,  safe: 32 },
  logo:         { w: 1080, h: 1080, safe: 48 },
};

// ── Block types ───────────────────────────────────────────────────────────────

export type BlockType = 'image' | 'text' | 'overlay' | 'background' | 'badge' | 'line';

export interface Block {
  id:    string;
  type:  BlockType;
  role:  string;
  zone:  Zone;
  style: Record<string, unknown>;
  z:     number;
}

// ── Compile context ───────────────────────────────────────────────────────────

export interface ArchetypeContext {
  headline:      string;
  subhead?:      string;
  body?:         string;
  imageProvided: boolean;
  faceDetected:  boolean;
  tone?:         string;
}

// ── Compiled template ─────────────────────────────────────────────────────────

export interface CompiledTemplate {
  canvas:      Canvas;
  archetypeId: ArchetypeId;
  blocks:      Block[];
}

// ── Archetype definition ──────────────────────────────────────────────────────

export interface Archetype {
  id:      ArchetypeId;
  compile(canvas: Canvas, ctx: ArchetypeContext): CompiledTemplate;
}

// ── Style Preset ──────────────────────────────────────────────────────────────

export interface StylePreset {
  id:              StylePresetId;
  bg:              ColorHex;
  text:            ColorHex;
  primary:         ColorHex;
  secondary:       ColorHex;
  accent:          ColorHex;
  headlineFont:    string;
  bodyFont:        string;
  buttonRadius:    number;
  buttonPaddingX:  number;
  buttonPaddingY:  number;
  allowGradient:   boolean;
  gradient:        string;
}

// ── Intelligence Engine types ─────────────────────────────────────────────────

export const ArchetypeSelectionSchema = z.object({
  archetypeId:     z.enum(ARCHETYPE_IDS),
  confidence:      z.number().min(0).max(1),
  reasoning:       z.string(),
  fallback:        z.boolean(),
  fallbackReason:  z.string().optional(),
});
export type ArchetypeSelection = z.infer<typeof ArchetypeSelectionSchema>;

export const PresetSelectionSchema = z.object({
  presetId:        z.enum(STYLE_PRESET_IDS),
  brandOverride:   z.boolean(),
  reasoning:       z.string(),
});
export type PresetSelection = z.infer<typeof PresetSelectionSchema>;

export const ArchetypeIntelligenceResultSchema = z.object({
  archetype:  ArchetypeSelectionSchema,
  preset:     PresetSelectionSchema,
  stageMs:    z.number(),
});
export type ArchetypeIntelligenceResult = z.infer<typeof ArchetypeIntelligenceResultSchema>;

// ── User override (from editor UI) ───────────────────────────────────────────

export interface ArchetypePresetOverride {
  /** 'auto' = let the engine decide */
  archetypeId: ArchetypeId | 'auto';
  /** 'auto' = let the engine decide */
  presetId:    StylePresetId | 'auto';
}
