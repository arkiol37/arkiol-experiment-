// src/engines/cocreation/instruction-parser.ts
//
// Parses natural language design edit instructions into structured operations.
// Deterministic keyword matching — no GPT calls.
//
// Supported instruction families:
//   - Color changes:    "make it darker", "change colors to blue", "more vibrant"
//   - Typography:       "make text bigger", "use bold font", "make it more premium"
//   - Tone/mood:        "make it more bold", "more minimal", "more playful"
//   - Layout:           "move text up", "more spacing", "compact layout"
//   - CTA:              "bigger button", "change CTA color", "round button"
//   - Content:          "change headline to X", "update CTA text"

// ── Edit operation types ────────────────────────────────────────────────────

export type EditCategory =
  | "color"
  | "typography"
  | "tone"
  | "spacing"
  | "cta"
  | "content"
  | "background";

export type EditIntent =
  // Color
  | "darken" | "lighten" | "saturate" | "desaturate"
  | "shift_warm" | "shift_cool" | "set_color"
  // Typography
  | "increase_font" | "decrease_font" | "set_weight_bold" | "set_weight_light"
  | "set_uppercase" | "set_normal_case"
  // Tone
  | "tone_bold" | "tone_minimal" | "tone_playful" | "tone_premium"
  | "tone_urgent" | "tone_warm" | "tone_professional"
  // Spacing
  | "increase_spacing" | "decrease_spacing"
  // CTA
  | "cta_bigger" | "cta_smaller" | "cta_round" | "cta_sharp" | "cta_color"
  // Content
  | "set_headline" | "set_subhead" | "set_cta_text" | "set_body"
  // Background
  | "bg_solid" | "bg_gradient" | "bg_darker" | "bg_lighter";

export interface EditOperation {
  category: EditCategory;
  intent: EditIntent;
  target?: string;
  value?: string;
  magnitude: number;
}

export interface ParsedInstruction {
  raw: string;
  operations: EditOperation[];
  confidence: number;
  unmatched: string[];
}

// ── Keyword patterns ────────────────────────────────────────────────────────

interface PatternRule {
  patterns: RegExp[];
  category: EditCategory;
  intent: EditIntent;
  magnitude: number;
  extractValue?: (match: RegExpMatchArray, full: string) => string | undefined;
  extractTarget?: (match: RegExpMatchArray, full: string) => string | undefined;
}

const RULES: PatternRule[] = [
  // ── Color ──
  { patterns: [/\b(darker|more dark)\b/i], category: "color", intent: "darken", magnitude: 0.6 },
  { patterns: [/\b(much darker|way darker|very dark)\b/i], category: "color", intent: "darken", magnitude: 1.0 },
  { patterns: [/\b(lighter|more light)\b/i], category: "color", intent: "lighten", magnitude: 0.6 },
  { patterns: [/\b(much lighter|way lighter|very light)\b/i], category: "color", intent: "lighten", magnitude: 1.0 },
  { patterns: [/\b(more vibrant|more saturated|brighter colors?)\b/i], category: "color", intent: "saturate", magnitude: 0.6 },
  { patterns: [/\b(more muted|desaturate|less saturated|softer colors?)\b/i], category: "color", intent: "desaturate", magnitude: 0.6 },
  { patterns: [/\b(warm(?:er)?|more warm)\b/i], category: "color", intent: "shift_warm", magnitude: 0.5 },
  { patterns: [/\b(cool(?:er)?|more cool)\b/i], category: "color", intent: "shift_cool", magnitude: 0.5 },
  {
    patterns: [/\bchange\s+(?:the\s+)?colou?rs?\s+to\s+(\w+)/i, /\bmake\s+it\s+(blue|red|green|purple|orange|pink|yellow|teal|navy|black|white)\b/i],
    category: "color", intent: "set_color", magnitude: 1.0,
    extractValue: (m) => m[1]?.toLowerCase(),
  },

  // ── Typography ──
  { patterns: [/\b(bigger text|larger (?:text|font)|increase (?:text|font)\s*(?:size)?)\b/i], category: "typography", intent: "increase_font", magnitude: 0.5 },
  { patterns: [/\b(much bigger|way bigger|very large)\b/i], category: "typography", intent: "increase_font", magnitude: 1.0 },
  { patterns: [/\b(smaller text|smaller (?:font)|decrease (?:text|font)\s*(?:size)?)\b/i], category: "typography", intent: "decrease_font", magnitude: 0.5 },
  { patterns: [/\b(bold(?:er)?(?:\s+(?:text|font))?|use bold|more bold)\b/i], category: "typography", intent: "set_weight_bold", magnitude: 0.7 },
  { patterns: [/\b(light(?:er)?\s+(?:text|font|weight)|thin(?:ner)?(?:\s+font)?)\b/i], category: "typography", intent: "set_weight_light", magnitude: 0.7 },
  { patterns: [/\b(uppercase|all caps)\b/i], category: "typography", intent: "set_uppercase", magnitude: 1.0 },
  { patterns: [/\b(normal case|lowercase|no caps|remove uppercase)\b/i], category: "typography", intent: "set_normal_case", magnitude: 1.0 },

  // ── Tone/mood ──
  { patterns: [/\bmore\s+bold\b/i, /\bbolder\b/i], category: "tone", intent: "tone_bold", magnitude: 0.7 },
  { patterns: [/\bmore\s+minimal\b/i, /\bcleaner\b/i, /\bsimpler\b/i], category: "tone", intent: "tone_minimal", magnitude: 0.7 },
  { patterns: [/\bmore\s+playful\b/i, /\bmore\s+fun\b/i], category: "tone", intent: "tone_playful", magnitude: 0.7 },
  { patterns: [/\bmore\s+premium\b/i, /\bmore\s+luxur(?:y|ious)\b/i, /\bmore\s+elegant\b/i], category: "tone", intent: "tone_premium", magnitude: 0.7 },
  { patterns: [/\bmore\s+urgent\b/i, /\badd urgency\b/i], category: "tone", intent: "tone_urgent", magnitude: 0.7 },
  { patterns: [/\bmore\s+warm\b/i, /\bfriendlier\b/i, /\bmore\s+inviting\b/i], category: "tone", intent: "tone_warm", magnitude: 0.7 },
  { patterns: [/\bmore\s+professional\b/i, /\bmore\s+corporate\b/i, /\bmore\s+formal\b/i], category: "tone", intent: "tone_professional", magnitude: 0.7 },

  // ── Spacing ──
  { patterns: [/\bmore\s+spacing\b/i, /\bmore\s+space\b/i, /\bmore\s+breathing\s*room\b/i, /\bairy\b/i, /\bspread\s+out\b/i], category: "spacing", intent: "increase_spacing", magnitude: 0.5 },
  { patterns: [/\bless\s+spacing\b/i, /\btighter\b/i, /\bcompact\b/i, /\bmore\s+dense\b/i], category: "spacing", intent: "decrease_spacing", magnitude: 0.5 },

  // ── CTA ──
  { patterns: [/\b(bigger|larger)\s+(button|cta)\b/i, /\bbigger\s+call\s+to\s+action\b/i], category: "cta", intent: "cta_bigger", magnitude: 0.5 },
  { patterns: [/\b(smaller)\s+(button|cta)\b/i], category: "cta", intent: "cta_smaller", magnitude: 0.5 },
  { patterns: [/\b(round(?:ed)?)\s+(button|cta)\b/i, /\bpill\s+(button|cta)\b/i], category: "cta", intent: "cta_round", magnitude: 1.0 },
  { patterns: [/\b(sharp|square)\s+(button|cta)\b/i], category: "cta", intent: "cta_sharp", magnitude: 1.0 },
  {
    patterns: [/\b(?:change|set|make)\s+(?:the\s+)?(?:button|cta)\s+(?:colou?r\s+)?(?:to\s+)?(\w+)\b/i],
    category: "cta", intent: "cta_color", magnitude: 1.0,
    extractValue: (m) => m[1]?.toLowerCase(),
  },

  // ── Content ──
  {
    patterns: [/\bchange\s+(?:the\s+)?headline\s+to\s+[""]?(.+?)[""]?\s*$/i, /\bset\s+headline\s*(?:to|:)\s*[""]?(.+?)[""]?\s*$/i],
    category: "content", intent: "set_headline", magnitude: 1.0,
    extractValue: (m) => m[1]?.trim(),
  },
  {
    patterns: [/\bchange\s+(?:the\s+)?subhead(?:line)?\s+to\s+[""]?(.+?)[""]?\s*$/i],
    category: "content", intent: "set_subhead", magnitude: 1.0,
    extractValue: (m) => m[1]?.trim(),
  },
  {
    patterns: [/\bchange\s+(?:the\s+)?(?:cta|button)\s+(?:text\s+)?to\s+[""]?(.+?)[""]?\s*$/i],
    category: "content", intent: "set_cta_text", magnitude: 1.0,
    extractValue: (m) => m[1]?.trim(),
  },
  {
    patterns: [/\bchange\s+(?:the\s+)?body\s+(?:text\s+)?to\s+[""]?(.+?)[""]?\s*$/i],
    category: "content", intent: "set_body", magnitude: 1.0,
    extractValue: (m) => m[1]?.trim(),
  },

  // ── Background ──
  { patterns: [/\bsolid\s+background\b/i, /\bremove\s+gradient\b/i, /\bflat\s+background\b/i], category: "background", intent: "bg_solid", magnitude: 1.0 },
  { patterns: [/\bgradient\s+background\b/i, /\badd\s+gradient\b/i], category: "background", intent: "bg_gradient", magnitude: 1.0 },
  { patterns: [/\bdark(?:er)?\s+background\b/i], category: "background", intent: "bg_darker", magnitude: 0.6 },
  { patterns: [/\blight(?:er)?\s+background\b/i], category: "background", intent: "bg_lighter", magnitude: 0.6 },
];

// ── Parser ──────────────────────────────────────────────────────────────────

export function parseInstruction(instruction: string): ParsedInstruction {
  const raw = instruction.trim();
  if (!raw) {
    return { raw, operations: [], confidence: 0, unmatched: [raw] };
  }

  const operations: EditOperation[] = [];
  const matchedRanges: Array<[number, number]> = [];

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const match = raw.match(pattern);
      if (match && match.index !== undefined) {
        const value = rule.extractValue?.(match, raw);
        const target = rule.extractTarget?.(match, raw);

        const alreadyCovered = operations.some(
          op => op.category === rule.category && op.intent === rule.intent
        );
        if (alreadyCovered) continue;

        operations.push({
          category: rule.category,
          intent: rule.intent,
          target,
          value,
          magnitude: rule.magnitude,
        });

        matchedRanges.push([match.index, match.index + match[0].length]);
      }
    }
  }

  const unmatched = findUnmatchedSegments(raw, matchedRanges);
  const confidence = operations.length === 0 ? 0 : Math.min(1, operations.length * 0.4 + 0.3);

  return { raw, operations, confidence, unmatched };
}

function findUnmatchedSegments(text: string, ranges: Array<[number, number]>): string[] {
  if (ranges.length === 0) return text.trim() ? [text.trim()] : [];

  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const segments: string[] = [];

  let cursor = 0;
  for (const [start, end] of sorted) {
    if (start > cursor) {
      const seg = text.slice(cursor, start).trim();
      if (seg && seg.length > 2) segments.push(seg);
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < text.length) {
    const seg = text.slice(cursor).trim();
    if (seg && seg.length > 2) segments.push(seg);
  }

  return segments;
}

// ── Named color to hex ──────────────────────────────────────────────────────

const NAMED_COLORS: Record<string, string> = {
  red: "#e53e3e", blue: "#3182ce", green: "#38a169", purple: "#805ad5",
  orange: "#dd6b20", pink: "#d53f8c", yellow: "#ecc94b", teal: "#319795",
  navy: "#1a365d", black: "#1a202c", white: "#ffffff", gray: "#718096",
  grey: "#718096", coral: "#ff6b6b", gold: "#d69e2e", indigo: "#5a67d8",
  lime: "#68d391", cyan: "#0bc5ea", magenta: "#d53f8c", brown: "#8b6f47",
};

export function resolveNamedColor(name: string): string | null {
  return NAMED_COLORS[name.toLowerCase()] ?? null;
}
