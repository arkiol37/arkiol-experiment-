// src/engines/evaluation/style-consistency.ts
//
// STEP 11 — Style consistency + final visual polish.
//
// What this module does
// ─────────────────────────────────────────────────────────────────────────────
// After the builder has produced a full SvgContent (palette, typography,
// decorations, subject image, composition verdict), this analyser
// checks the *aesthetic coherence* of the result against five axes:
//
//   1. Palette cardinality & harmony — how many distinct hues are used
//      across the palette, decorations, and CTA styling. Premium
//      templates limit themselves to 2-3 saturated hues plus neutrals.
//   2. Typography consistency — how many distinct font families appear
//      across headline / subhead / body / cta / badge / eyebrow. A
//      cohesive design sticks to 1-2 families (a display pairing).
//   3. Contrast — WCAG contrast ratio for every populated text role
//      against its likely backdrop (solid background or the first
//      gradient stop). Also checks CTA text on CTA background.
//   4. Component styling — the corner radii across CTA, card panels,
//      badges, and pills should cluster; wild variance reads as a
//      mismatched component library.
//   5. Decoration noise — templates with more than a soft cap on
//      decoration shapes feel cluttered. We also flag when the
//      decoration mix fights the subject-image mode (e.g. a brief that
//      selected a realistic photo is topped with four illustrative
//      flower / squiggle / starburst shapes).
//
// The result is stamped on SvgContent as `_styleConsistency` and read by
// five hard rejection rules (palette_fragmentation, font_switching,
// low_contrast_text, decoration_noise, style_mismatch) plus the
// admission audit.
//
// What this module does NOT do
// ─────────────────────────────────────────────────────────────────────────────
// It doesn't touch palette selection, re-render text, or swap
// decorations — it's a verdict. When a rule fires, the pipeline rejects
// the candidate and re-generates, surfacing a better-composed sibling.

import type { DesignTheme, DecorShape, ZoneTypography } from "../render/design-themes";
import type { SvgContent } from "../render/svg-builder-ultimate";
import type { SubjectImage, SubjectMode } from "../assets/subject-image-selector";
import { contrastRatio } from "../layout/style-enforcer";

// ── Tunable thresholds ──────────────────────────────────────────────────────
// Premium, curated packs stay under these bars. The numbers are
// deliberately loose enough that legitimate Canva-parity templates pass
// on their first try, and strict enough that fragmented or noisy
// candidates fall out.

const HUE_BUCKET_DEG         = 30;    // 12 buckets around the colour wheel
const NEUTRAL_SAT_CUTOFF     = 0.12;  // below this, hue is treated as neutral
const MAX_DISTINCT_HUES      = 4;     // 3 accent hues + 1 tolerance for decor warmth/coolness
const MAX_FONT_FAMILIES      = 2;     // a display pairing is one family + body
const MIN_CONTRAST_TEXT      = 3.5;   // below this the rejection gate fires
const MIN_CONTRAST_CTA       = 3.8;   // CTA carries a call-to-action, must pop
const RADIUS_CV_MAX          = 1.0;   // coefficient of variation for radii (intentional soft/sharp mixes pass)
const RADIUS_MIN_SAMPLES     = 3;     // need at least CTA + 2 decor panels before the rule engages
const DECORATION_NOISE_CAP   = 14;    // >14 shapes reads as clutter
const ILLUSTRATIVE_KIND_CAP  = 3;     // when subject=photo, limit decorative-illustration kinds

// Decoration kinds that compete with a realistic photo subject.
const ILLUSTRATIVE_KINDS: ReadonlySet<DecorShape["kind"]> = new Set([
  "flower", "squiggle", "starburst", "wave", "triangle",
  "half_circle", "sticker_circle", "icon_symbol",
]);

// Decoration kinds that carry a border radius we should factor into
// component-consistency scoring.
const RADIUS_BEARING_KINDS: ReadonlySet<DecorShape["kind"]> = new Set([
  "rect", "accent_bar", "card_panel", "frame_border", "banner_strip", "price_tag",
]);

// ── Types ────────────────────────────────────────────────────────────────────

export interface StyleConsistencyFlags {
  paletteFragmented:   boolean;   // too many distinct accent hues
  fontSwitching:       boolean;   // more than MAX_FONT_FAMILIES
  lowContrastText:     boolean;   // any populated text role < MIN_CONTRAST_TEXT
  lowContrastCta:      boolean;   // cta label on cta background < MIN_CONTRAST_CTA
  componentInconsistency: boolean; // corner-radius spread too wide
  decorationNoise:     boolean;   // decoration count above the clutter cap
  styleMismatch:       boolean;   // photo subject + loud illustrative decor
}

export interface StyleConsistencyVerdict {
  /** Distinct 30° hue buckets used (excluding near-neutrals). */
  distinctHues:        number;
  /** Hex colour that contributed each hue — useful for logs. */
  distinctHueSamples:  string[];
  /** Distinct font families used across populated text roles. */
  distinctFontFamilies: number;
  fontFamilyList:      string[];
  /** Worst WCAG contrast ratio among populated text roles, and its zone id. */
  minTextContrast:     number;
  minTextContrastRole: string;
  /** CTA label contrast against CTA backplate. */
  ctaContrast:         number;
  /** Coefficient of variation (sd/mean) across collected radii. 0 = identical. */
  radiusCv:            number;
  /** Total radius-bearing component count that fed the CV. */
  radiusComponentCount: number;
  /** Total decoration shape count (including locked/background kinds). */
  decorationCount:     number;
  /** Count of illustrative shapes (when subject = photo, this matters). */
  illustrativeCount:   number;
  /** Subject mode the template shipped with (for context). */
  subjectMode:         SubjectMode | "none";
  flags:               StyleConsistencyFlags;
  /** One-line audit string. */
  auditSummary:        string;
}

export interface StyleConsistencyInput {
  theme:             DesignTheme;
  content:           SvgContent;
  /** Populated text zones — used to restrict contrast checks to roles that
   *  actually rendered copy, so an unused body zone never fails the gate. */
  populatedZoneIds:  string[];
  subject?:          SubjectImage | null;
}

// ── Public: analyze ────────────────────────────────────────────────────────

export function analyzeStyleConsistency(input: StyleConsistencyInput): StyleConsistencyVerdict {
  const { theme, content, populatedZoneIds, subject } = input;

  // ── Palette hues ────────────────────────────────────────────────────────
  const paletteColors: string[] = [
    theme.palette.primary,
    theme.palette.secondary,
    theme.palette.background,
    theme.palette.text,
    theme.palette.textMuted,
    theme.palette.highlight,
    theme.ctaStyle.backgroundColor,
    theme.ctaStyle.textColor,
    ...theme.decorations.map(d => getDecorColor(d)).filter((c): c is string => !!c),
  ];
  const hueReport = countDistinctHues(paletteColors);

  // ── Font families ───────────────────────────────────────────────────────
  const populatedSet = new Set(populatedZoneIds);
  const fontRolesUsed = collectFontRoles(theme, populatedSet);
  const distinctFontFamilies = new Set(fontRolesUsed.map(f => f.toLowerCase())).size;

  // ── Text contrast ───────────────────────────────────────────────────────
  const bgApprox = approximateBackgroundColor(content);
  const { worst: minTextContrast, worstRole: minTextContrastRole } =
    computeWorstTextContrast(theme, populatedSet, bgApprox);

  const ctaContrast = safeContrast(
    theme.ctaStyle.textColor,
    theme.ctaStyle.backgroundColor,
  );

  // ── Component radii ─────────────────────────────────────────────────────
  const radii = collectRadii(theme);
  const radiusCv = coefficientOfVariation(radii);

  // ── Decoration noise / style mismatch ───────────────────────────────────
  const decorationCount   = theme.decorations.length;
  const illustrativeCount = theme.decorations.filter(d => ILLUSTRATIVE_KINDS.has(d.kind)).length;
  const subjectMode: SubjectMode | "none" = subject?.mode ?? "none";

  // ── Flags ───────────────────────────────────────────────────────────────
  const flags: StyleConsistencyFlags = {
    paletteFragmented:      hueReport.count > MAX_DISTINCT_HUES,
    fontSwitching:          distinctFontFamilies > MAX_FONT_FAMILIES,
    lowContrastText:        minTextContrast < MIN_CONTRAST_TEXT,
    lowContrastCta:         ctaContrast   < MIN_CONTRAST_CTA,
    componentInconsistency: radii.length >= RADIUS_MIN_SAMPLES && radiusCv > RADIUS_CV_MAX,
    decorationNoise:        decorationCount > DECORATION_NOISE_CAP,
    styleMismatch:          subjectMode === "photo" && illustrativeCount > ILLUSTRATIVE_KIND_CAP,
  };

  const flagLabels: string[] = [];
  if (flags.paletteFragmented)      flagLabels.push("palette_fragmented");
  if (flags.fontSwitching)          flagLabels.push("font_switching");
  if (flags.lowContrastText)        flagLabels.push("low_contrast_text");
  if (flags.lowContrastCta)         flagLabels.push("low_contrast_cta");
  if (flags.componentInconsistency) flagLabels.push("component_inconsistency");
  if (flags.decorationNoise)        flagLabels.push("decoration_noise");
  if (flags.styleMismatch)          flagLabels.push("style_mismatch");

  const auditSummary = [
    `hues=${hueReport.count}`,
    `fonts=${distinctFontFamilies}[${[...new Set(fontRolesUsed)].join(",")}]`,
    `minContrast=${minTextContrast.toFixed(2)}@${minTextContrastRole}`,
    `ctaContrast=${ctaContrast.toFixed(2)}`,
    `radiusCv=${radiusCv.toFixed(2)}(n=${radii.length})`,
    `decor=${decorationCount}(illustrative=${illustrativeCount})`,
    `subject=${subjectMode}`,
    `flags=[${flagLabels.join(",") || "clean"}]`,
  ].join(" ");

  return {
    distinctHues:        hueReport.count,
    distinctHueSamples:  hueReport.samples,
    distinctFontFamilies,
    fontFamilyList:      [...new Set(fontRolesUsed)],
    minTextContrast,
    minTextContrastRole,
    ctaContrast,
    radiusCv,
    radiusComponentCount: radii.length,
    decorationCount,
    illustrativeCount,
    subjectMode,
    flags,
    auditSummary,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getDecorColor(d: DecorShape): string | null {
  if ("color" in d && typeof d.color === "string") return d.color;
  return null;
}

function collectFontRoles(theme: DesignTheme, populated: Set<string>): string[] {
  const t = theme.typography;
  const entries: Array<[string, ZoneTypography]> = [
    ["headline", t.headline],
    ["subhead",  t.subhead],
    ["body",     t.body_text],
    ["cta",      t.cta],
    ["badge",    t.badge],
    ["eyebrow",  t.eyebrow],
  ];
  // Always include display + body fonts since they define the pairing.
  const fams: string[] = [t.display, t.body];
  for (const [id, zt] of entries) {
    if (!zt?.fontFamily) continue;
    if (populated.size === 0 || populated.has(id)) {
      fams.push(zt.fontFamily);
    }
  }
  return fams;
}

/** Approximate the background colour behind text. Uses the gradient's
 *  first stop for linear / radial / mesh, or the solid colour for solid.
 *  Falls back to the palette background. */
function approximateBackgroundColor(content: SvgContent): string {
  if (content.backgroundGradient) {
    const g = content.backgroundGradient as unknown as {
      type?: string;
      colors?: string[];
    };
    if (Array.isArray(g?.colors) && g.colors.length > 0) return g.colors[0];
  }
  return content.backgroundColor;
}

function computeWorstTextContrast(
  theme:     DesignTheme,
  populated: Set<string>,
  bg:        string,
): { worst: number; worstRole: string } {
  const roles: Array<[string, string]> = [
    ["headline", theme.typography.headline.color],
    ["subhead",  theme.typography.subhead.color],
    ["body",     theme.typography.body_text.color],
    ["eyebrow",  theme.typography.eyebrow.color],
    ["badge",    theme.typography.badge.color],
  ];

  let worst     = 21;    // upper-bound WCAG ratio
  let worstRole = "n/a";
  for (const [id, color] of roles) {
    if (populated.size > 0 && !populated.has(id)) continue;
    const r = safeContrast(color, bg);
    if (r < worst) {
      worst     = r;
      worstRole = id;
    }
  }
  if (worst === 21) {
    // No populated text role was in our list — use the headline as a
    // conservative fallback so we still return a meaningful number.
    const r = safeContrast(theme.typography.headline.color, bg);
    return { worst: r, worstRole: "headline" };
  }
  return { worst, worstRole };
}

/** `contrastRatio` from style-enforcer only accepts #rrggbb. Many of our
 *  tokens are `rgba(…)` or shorthand. Normalise first, then compute. */
function safeContrast(fg: string, bg: string): number {
  const a = toHex(fg);
  const b = toHex(bg);
  if (!a || !b) return 21; // treat unparseable as "no issue" — better than false negatives
  try {
    return contrastRatio(a, b);
  } catch {
    return 21;
  }
}

function toHex(color: string): string | null {
  if (!color) return null;
  const trimmed = color.trim().toLowerCase();
  if (trimmed.startsWith("#")) {
    const body = trimmed.slice(1);
    if (body.length === 3) {
      return "#" + body.split("").map(c => c + c).join("");
    }
    if (body.length === 6) return "#" + body;
    if (body.length === 8) return "#" + body.slice(0, 6); // drop alpha
    return null;
  }
  const rgba = trimmed.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/);
  if (rgba) {
    const r = Math.max(0, Math.min(255, parseInt(rgba[1], 10)));
    const g = Math.max(0, Math.min(255, parseInt(rgba[2], 10)));
    const b = Math.max(0, Math.min(255, parseInt(rgba[3], 10)));
    return "#" +
      r.toString(16).padStart(2, "0") +
      g.toString(16).padStart(2, "0") +
      b.toString(16).padStart(2, "0");
  }
  return null;
}

/** Convert #rrggbb to HSL `{h:0-360, s:0-1, l:0-1}`. */
function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const normalized = toHex(hex);
  if (!normalized) return null;
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l   = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
    case g: h = ((b - r) / d + 2); break;
    case b: h = ((r - g) / d + 4); break;
  }
  return { h: h * 60, s, l };
}

function countDistinctHues(colors: string[]): { count: number; samples: string[] } {
  const seen   = new Map<number, string>();
  for (const c of colors) {
    const hsl = hexToHsl(c);
    if (!hsl) continue;
    if (hsl.s < NEUTRAL_SAT_CUTOFF) continue; // neutrals/greys/whites/blacks
    const bucket = Math.round(hsl.h / HUE_BUCKET_DEG) % (360 / HUE_BUCKET_DEG);
    if (!seen.has(bucket)) seen.set(bucket, c);
  }
  return { count: seen.size, samples: [...seen.values()] };
}

function collectRadii(theme: DesignTheme): number[] {
  const out: number[] = [theme.ctaStyle.borderRadius];
  for (const d of theme.decorations) {
    if (!RADIUS_BEARING_KINDS.has(d.kind)) continue;
    if ("rx" in d && typeof d.rx === "number") out.push(d.rx);
  }
  return out.filter(v => Number.isFinite(v));
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) {
    // All zeroes is perfectly consistent; mixed 0s and positives is not.
    const maxVal = Math.max(...values);
    return maxVal === 0 ? 0 : 1;
  }
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

// ── Audit helpers ───────────────────────────────────────────────────────────

export function describeStyleConsistency(v: StyleConsistencyVerdict | null | undefined): string {
  if (!v) return "style=none";
  return `style={${v.auditSummary}}`;
}

export function styleConsistencyHasHardFlag(v: StyleConsistencyVerdict | null | undefined): boolean {
  if (!v) return false;
  const f = v.flags;
  return (
    f.paletteFragmented ||
    f.fontSwitching ||
    f.lowContrastText ||
    f.lowContrastCta ||
    f.componentInconsistency ||
    f.decorationNoise ||
    f.styleMismatch
  );
}

