// packages/shared/src/ai/archetypes/stylePresets.ts
// The 5 canonical Arkiol style presets.
// Integrated with the style enforcement stage (P9).
// No global/window usage. Pure data module.

import { StylePreset, StylePresetId, ArchetypeId } from './types';

export const STYLE_PRESETS: Readonly<Record<StylePresetId, StylePreset>> = Object.freeze({
  clean: {
    id:             'clean',
    bg:             '#FFFFFF',
    text:           '#111111',
    primary:        '#111111',
    secondary:      '#555555',
    accent:         '#2563EB',
    headlineFont:   'Inter',
    bodyFont:       'Inter',
    buttonRadius:   12,
    buttonPaddingX: 18,
    buttonPaddingY: 12,
    allowGradient:  false,
    gradient:       '',
  },
  bold: {
    id:             'bold',
    bg:             '#090909',
    text:           '#FFFFFF',
    primary:        '#FFFFFF',
    secondary:      '#C7C7C7',
    accent:         '#F97316',
    headlineFont:   'Poppins',
    bodyFont:       'Inter',
    buttonRadius:   14,
    buttonPaddingX: 20,
    buttonPaddingY: 14,
    allowGradient:  true,
    gradient:       'linear-gradient(135deg, rgba(249,115,22,0.25), rgba(240,165,0,0.18))',
  },
  professional: {
    id:             'professional',
    bg:             '#FFFFFF',
    text:           '#0F172A',
    primary:        '#0F172A',
    secondary:      '#334155',
    accent:         '#276749',
    headlineFont:   'Montserrat',
    bodyFont:       'Inter',
    buttonRadius:   10,
    buttonPaddingX: 18,
    buttonPaddingY: 12,
    allowGradient:  true,
    gradient:       'linear-gradient(135deg, rgba(39,103,73,0.12), rgba(15,23,42,0.04))',
  },
  minimal: {
    id:             'minimal',
    bg:             '#FFFFFF',
    text:           '#111111',
    primary:        '#111111',
    secondary:      '#6B7280',
    accent:         '#111111',
    headlineFont:   'Inter',
    bodyFont:       'Inter',
    buttonRadius:   10,
    buttonPaddingX: 16,
    buttonPaddingY: 10,
    allowGradient:  false,
    gradient:       '',
  },
  expressive: {
    id:             'expressive',
    bg:             '#FFFFFF',
    text:           '#111827',
    primary:        '#111827',
    secondary:      '#374151',
    accent:         '#A855F7',
    headlineFont:   'Poppins',
    bodyFont:       'Inter',
    buttonRadius:   16,
    buttonPaddingX: 22,
    buttonPaddingY: 14,
    allowGradient:  true,
    gradient:       'linear-gradient(135deg, rgba(168,85,247,0.18), rgba(34,197,94,0.10))',
  },
});

// ── Preset → archetype compatibility map ──────────────────────────────────────
// Used by the intelligence engine to validate or bias preset selection.

export const ARCHETYPE_PREFERRED_PRESETS: Readonly<Record<ArchetypeId, StylePresetId>> = Object.freeze({
  AGGRESSIVE_POWER:       'bold',
  MINIMAL_CLEAN:          'minimal',
  CURIOSITY_MYSTERY:      'bold',
  PRODUCT_FOCUS:          'clean',
  TRUST_FRIENDLY:         'clean',
  NEWS_URGENT:            'bold',
  CINEMATIC_DARK:         'bold',
  SPORTS_ACTION:          'bold',
  MUSIC_ARTISTIC:         'expressive',
  COMPARISON_VS:          'bold',
  BOLD_CLAIM:             'bold',
  FACE_CLOSEUP:           'expressive',
  EDUCATIONAL_EXPLAINER:  'professional',
  KIDS_PLAYFUL:           'expressive',
  LUXURY_PREMIUM:         'minimal',
  AUTHORITY_EXPERT:       'professional',
  TECH_FUTURISTIC:        'bold',
  RELIGION_CALM:          'clean',
  FUN_PLAYFUL:            'expressive',
  EMOTIONAL_STORY:        'expressive',
});

// ── Platform → default preset ─────────────────────────────────────────────────

export function pickPresetForPlatform(format: string): StylePresetId {
  const f = format.toLowerCase();
  if (f.includes('resume')      || f.includes('presentation') || f.includes('slide'))  return 'professional';
  if (f.includes('poster')      || f.includes('youtube'))                                return 'bold';
  if (f.includes('instagram')   || f.includes('story'))                                  return 'expressive';
  if (f.includes('businesscard'))                                                         return 'minimal';
  return 'clean';
}

// ── Lookup ────────────────────────────────────────────────────────────────────

export function getStylePreset(id: StylePresetId): StylePreset {
  const p = STYLE_PRESETS[id];
  if (!p) throw new Error(`Unknown style preset id: ${id}`);
  return p;
}

export function isValidPresetId(id: string): id is StylePresetId {
  return id in STYLE_PRESETS;
}
