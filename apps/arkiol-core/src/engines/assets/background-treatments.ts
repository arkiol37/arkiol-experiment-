// src/engines/assets/background-treatments.ts
// Background Treatment Catalog
//
// Step 18: richer background surfaces than a single plain gradient.
//
// A "treatment" is a named stack of background layers that, rendered
// together, produce a surface with visible craft — layered gradients,
// soft textures, framed zones, patterned regions, structured bands,
// subtle image washes. Each treatment is chosen from the brief's tone
// and optionally a structural preference (e.g. "hasImageZone").
//
// The catalog lives on its own so background quality is a self-contained
// concern: tweak a color, swap a pattern, or add a new treatment here
// without touching composition or rendering logic.
//
// Each treatment returns a small ordered list of BackgroundLayerSpec
// entries. Callers (asset-selector) map each spec into an
// ElementPlacement with role=background, preserving the role-derived
// layering and scale rules defined in asset-placement.ts.

import type { AssetElementType } from "./contract";
import type { BriefAnalysis }    from "../ai/brief-analyzer";

// ── Treatment taxonomy ───────────────────────────────────────────────────────

export type BackgroundTreatmentKind =
  | "layered-gradient"   // base gradient + atmospheric wash + fine grain
  | "framed-zone"        // solid base + inset decorative frame + paper grain
  | "patterned-region"   // solid base + dot/diag pattern region + subtle grain
  | "structured-bands"   // split-band SVG + subtle accent band + grain
  | "soft-texture-wash"  // soft gradient + paper grain + tonal light wash
  | "subtle-image-wash"; // dim hero image + scrim + grain

// A single layer inside a treatment. Either `prompt` (AI-generated) or `url`
// (inline SVG data URL) is populated — never both. Coverage and layerHint are
// consumed by the composition decorator so the full stack paints in the
// intended back-to-front order.
export interface BackgroundLayerSpec {
  type:         AssetElementType;           // "background" | "atmospheric" | "texture" | "overlay"
  prompt?:      string;                     // AI prompt, if this layer is generated
  url?:         string;                     // inline SVG data URL for fixed layers
  coverageHint: number;                     // 0–1 share of canvas
  layerHint:    number;                     // 0,1,2... within the background band
  note:         string;                     // human-readable rationale
}

export interface BackgroundTreatment {
  kind:        BackgroundTreatmentKind;
  description: string;
  layers:      BackgroundLayerSpec[];
}

// ── Tone → treatment preference ──────────────────────────────────────────────
// Each tonal preset has one preferred treatment. Unmapped tones fall back to
// `layered-gradient`, which is the safest universal default.

const TONE_TREATMENT: Record<string, BackgroundTreatmentKind> = {
  modern_minimal:  "soft-texture-wash",
  bold_lifestyle:  "patterned-region",
  dark_luxury:     "framed-zone",
  clean_product:   "structured-bands",
  vibrant_social:  "patterned-region",
  editorial:       "framed-zone",
  tech_forward:    "layered-gradient",
  natural_organic: "soft-texture-wash",
};

export function treatmentKindForTone(tone: string): BackgroundTreatmentKind {
  return TONE_TREATMENT[tone] ?? "layered-gradient";
}

// ── Palette derivation ───────────────────────────────────────────────────────
// Treatments expose their SVG in currentColor-neutral tones using a small,
// tone-derived palette so the surface reads cohesively with the template's
// color mood without needing a round-trip to the color engine.

interface TreatmentPalette {
  base:    string;   // main surface color
  accent:  string;   // secondary color used by frames / bands
  neutral: string;   // lightest tone used for grain / wash
  ink:     string;   // highest-contrast line color
}

const PALETTES: Record<string, TreatmentPalette> = {
  vibrant:  { base: "#FFF7ED", accent: "#F97316", neutral: "#FFEDD5", ink: "#7C2D12" },
  dark:     { base: "#0F172A", accent: "#1E293B", neutral: "#111827", ink: "#E2E8F0" },
  warm:     { base: "#FFF7ED", accent: "#F59E0B", neutral: "#FEF3C7", ink: "#7C2D12" },
  cool:     { base: "#EFF6FF", accent: "#3B82F6", neutral: "#DBEAFE", ink: "#1E3A8A" },
  natural:  { base: "#F0FDF4", accent: "#10B981", neutral: "#DCFCE7", ink: "#14532D" },
  luxury:   { base: "#111827", accent: "#C7A14B", neutral: "#1F2937", ink: "#FAFAF9" },
  minimal:  { base: "#FFFFFF", accent: "#E5E7EB", neutral: "#F9FAFB", ink: "#111827" },
};

function paletteForBrief(brief: BriefAnalysis): TreatmentPalette {
  return PALETTES[brief.colorMood] ?? PALETTES.minimal;
}

// ── SVG composers ────────────────────────────────────────────────────────────
// All fixed (non-AI) treatment layers emit an inline SVG covering a
// 1000×1000 viewBox. Downstream rendering stretches to the artboard size
// via preserveAspectRatio, so pixel values below are relative.

function svgDataUrl(svg: string): string {
  const encoded = svg
    .replace(/"/g, "'")
    .replace(/>\s+</g, "><")
    .replace(/[\r\n\t]/g, "")
    .replace(/#/g, "%23")
    .replace(/%/g, "%25")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E");
  return `data:image/svg+xml;charset=UTF-8,${encoded}`;
}

// Fine noise-style grain. Rendered as scattered near-invisible dots so it
// reads as subtle surface grain, not as decoration.
function grainTile(ink: string, opacity = 0.06): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
      `<rect width="100" height="100" fill="${ink}" opacity="${opacity * 0.3}"/>` +
      `<circle cx="12" cy="18"  r="0.7" fill="${ink}" opacity="${opacity}"/>` +
      `<circle cx="47" cy="8"   r="0.6" fill="${ink}" opacity="${opacity}"/>` +
      `<circle cx="83" cy="22"  r="0.8" fill="${ink}" opacity="${opacity}"/>` +
      `<circle cx="28" cy="55"  r="0.7" fill="${ink}" opacity="${opacity}"/>` +
      `<circle cx="63" cy="68"  r="0.6" fill="${ink}" opacity="${opacity}"/>` +
      `<circle cx="88" cy="82"  r="0.7" fill="${ink}" opacity="${opacity}"/>` +
      `<circle cx="15" cy="90"  r="0.6" fill="${ink}" opacity="${opacity}"/>` +
    `</svg>`;
  return svgDataUrl(svg);
}

function paperGrainTile(ink: string): string {
  // Denser, more organic paper-grain flecks. Used by soft/editorial treatments.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">` +
      `<rect width="120" height="120" fill="${ink}" opacity="0.02"/>` +
      [[8,11,0.7,0.12],[23,5,0.5,0.10],[42,14,0.9,0.14],[57,7,0.6,0.11],
       [74,18,0.8,0.13],[92,9,0.5,0.09],[110,16,0.7,0.10],[13,38,0.8,0.13],
       [31,42,0.6,0.10],[55,35,0.9,0.14],[82,46,0.7,0.11],[104,41,0.5,0.09],
       [22,73,0.8,0.12],[49,65,0.6,0.10],[71,78,0.9,0.13],[96,70,0.7,0.11],
       [10,104,0.5,0.09],[38,98,0.8,0.12],[63,108,0.6,0.10],[91,100,0.9,0.13]]
        .map(([x,y,r,op]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${ink}" opacity="${op}"/>`).join("") +
    `</svg>`;
  return svgDataUrl(svg);
}

// Inset decorative frame — a thin double border defining a content safe area.
function framedZone(pal: TreatmentPalette): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none">` +
      `<rect width="1000" height="1000" fill="${pal.base}"/>` +
      `<rect x="40" y="40" width="920" height="920" fill="none" ` +
        `stroke="${pal.accent}" stroke-width="1.5" opacity="0.55"/>` +
      `<rect x="54" y="54" width="892" height="892" fill="none" ` +
        `stroke="${pal.accent}" stroke-width="0.8" opacity="0.35"/>` +
    `</svg>`;
  return svgDataUrl(svg);
}

// Horizontal structured bands — a strong top band (accent) and a neutral
// lower body, with a thin divider line between.
function structuredBands(pal: TreatmentPalette): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none">` +
      `<rect width="1000" height="1000" fill="${pal.base}"/>` +
      `<rect x="0" y="0" width="1000" height="260" fill="${pal.accent}" opacity="0.18"/>` +
      `<rect x="0" y="258" width="1000" height="4" fill="${pal.accent}" opacity="0.75"/>` +
      `<rect x="0" y="880" width="1000" height="120" fill="${pal.accent}" opacity="0.08"/>` +
    `</svg>`;
  return svgDataUrl(svg);
}

// A patterned region confined to the lower half — dots or diagonal lines.
function patternedRegion(pal: TreatmentPalette, pattern: "dots" | "diag"): string {
  const patternMarkup = pattern === "dots"
    ? `<pattern id="p" width="22" height="22" patternUnits="userSpaceOnUse">` +
        `<circle cx="11" cy="11" r="1.6" fill="${pal.accent}" opacity="0.35"/>` +
      `</pattern>`
    : `<pattern id="p" width="18" height="18" patternUnits="userSpaceOnUse">` +
        `<path d="M-2 20L20 -2" stroke="${pal.accent}" stroke-width="1" opacity="0.30"/>` +
      `</pattern>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none">` +
      `<defs>${patternMarkup}</defs>` +
      `<rect width="1000" height="1000" fill="${pal.base}"/>` +
      `<rect x="0" y="560" width="1000" height="440" fill="url(%23p)"/>` +
    `</svg>`;
  return svgDataUrl(svg);
}

// Soft tonal gradient — base fading into neutral, for wellness/beauty tones.
function softGradient(pal: TreatmentPalette): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none">` +
      `<defs>` +
        `<linearGradient id="g" x1="0%" y1="0%" x2="0%" y2="100%">` +
          `<stop offset="0%" stop-color="${pal.base}"/>` +
          `<stop offset="100%" stop-color="${pal.neutral}"/>` +
        `</linearGradient>` +
      `</defs>` +
      `<rect width="1000" height="1000" fill="url(%23g)"/>` +
    `</svg>`;
  return svgDataUrl(svg);
}

// ── Treatment builders ───────────────────────────────────────────────────────
// Each builder produces the full stack of background-band layers for a
// treatment. Layer order below matches paint order (0 = back, N = front).

function buildLayeredGradient(brief: BriefAnalysis, pal: TreatmentPalette): BackgroundLayerSpec[] {
  return [
    {
      type: "background",
      prompt: `${brief.colorMood} layered gradient background, two tonal passes, subtle depth, no harsh banding`,
      coverageHint: 1.0, layerHint: 0,
      note: "base layered gradient (AI)",
    },
    {
      type: "atmospheric",
      prompt: `soft ${brief.colorMood} light wash, low opacity, adds depth without adding visible texture`,
      coverageHint: 0.6, layerHint: 1,
      note: "atmospheric light wash",
    },
    {
      type: "texture",
      url: grainTile(pal.ink, 0.05),
      coverageHint: 1.0, layerHint: 2,
      note: "fine grain (5% opacity)",
    },
  ];
}

function buildFramedZone(_brief: BriefAnalysis, pal: TreatmentPalette): BackgroundLayerSpec[] {
  return [
    {
      type: "background",
      url:  framedZone(pal),
      coverageHint: 1.0, layerHint: 0,
      note: "solid base with inset decorative frame",
    },
    {
      type: "texture",
      url:  paperGrainTile(pal.ink),
      coverageHint: 1.0, layerHint: 1,
      note: "paper grain overlay",
    },
  ];
}

function buildPatternedRegion(_brief: BriefAnalysis, pal: TreatmentPalette, pattern: "dots" | "diag"): BackgroundLayerSpec[] {
  return [
    {
      type: "background",
      url:  patternedRegion(pal, pattern),
      coverageHint: 1.0, layerHint: 0,
      note: `solid base with ${pattern} pattern in lower region`,
    },
    {
      type: "texture",
      url:  grainTile(pal.ink, 0.04),
      coverageHint: 1.0, layerHint: 1,
      note: "subtle grain (4% opacity)",
    },
  ];
}

function buildStructuredBands(_brief: BriefAnalysis, pal: TreatmentPalette): BackgroundLayerSpec[] {
  return [
    {
      type: "background",
      url:  structuredBands(pal),
      coverageHint: 1.0, layerHint: 0,
      note: "split horizontal bands with accent divider",
    },
    {
      type: "texture",
      url:  grainTile(pal.ink, 0.04),
      coverageHint: 1.0, layerHint: 1,
      note: "subtle grain (4% opacity)",
    },
  ];
}

function buildSoftTextureWash(brief: BriefAnalysis, pal: TreatmentPalette): BackgroundLayerSpec[] {
  return [
    {
      type: "background",
      url:  softGradient(pal),
      coverageHint: 1.0, layerHint: 0,
      note: "soft tonal gradient",
    },
    {
      type: "texture",
      url:  paperGrainTile(pal.ink),
      coverageHint: 1.0, layerHint: 1,
      note: "paper grain",
    },
    {
      type: "atmospheric",
      prompt: `gentle ${brief.colorMood} light diffusion, soft bloom, very low contrast`,
      coverageHint: 0.5, layerHint: 2,
      note: "soft light wash (atmospheric)",
    },
  ];
}

function buildSubtleImageWash(brief: BriefAnalysis, pal: TreatmentPalette): BackgroundLayerSpec[] {
  const keywords = brief.keywords?.slice(0, 2).join(", ") ?? "abstract scene";
  return [
    {
      type: "background",
      prompt: `atmospheric hero photography ${keywords}, ${brief.colorMood} mood, soft focus, low contrast for background use, no text`,
      coverageHint: 1.0, layerHint: 0,
      note: "subtle hero image backdrop (AI photo)",
    },
    {
      type: "overlay",
      prompt: "semi-transparent tonal scrim for legibility over photograph",
      coverageHint: 1.0, layerHint: 1,
      note: "tonal scrim overlay",
    },
    {
      type: "texture",
      url:  grainTile(pal.ink, 0.06),
      coverageHint: 1.0, layerHint: 2,
      note: "fine grain over image",
    },
  ];
}

// ── Public resolver ──────────────────────────────────────────────────────────

// Some treatments have small variants (dots vs. diagonal pattern). The seed
// picks a variant deterministically so the same brief always resolves to the
// same concrete surface.
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Resolve a full background treatment for a brief. Returns an ordered layer
 * stack that callers can feed directly into ElementPlacements with
 * role=background.
 *
 * Honors optional overrides:
 *   - forceKind:  pin the treatment kind (bypasses tone mapping)
 *   - preferImageWash: true when the layout has an image zone and the tone
 *       allows a subtle hero backdrop — promotes subtle-image-wash ahead of
 *       the tone default.
 */
export function resolveBackgroundTreatment(
  brief: BriefAnalysis,
  opts:  { forceKind?: BackgroundTreatmentKind; preferImageWash?: boolean } = {},
): BackgroundTreatment {
  const pal = paletteForBrief(brief);
  const seed = `${brief.headline ?? ""}::${brief.tone}::${brief.colorMood}`;

  let kind: BackgroundTreatmentKind;
  if (opts.forceKind) {
    kind = opts.forceKind;
  } else if (opts.preferImageWash && ["bold_lifestyle", "editorial", "vibrant_social"].includes(brief.tone)) {
    kind = "subtle-image-wash";
  } else {
    kind = treatmentKindForTone(brief.tone);
  }

  const layers = (() => {
    switch (kind) {
      case "layered-gradient":  return buildLayeredGradient(brief, pal);
      case "framed-zone":       return buildFramedZone(brief, pal);
      case "patterned-region":  return buildPatternedRegion(brief, pal, (hash(seed) & 1) === 0 ? "dots" : "diag");
      case "structured-bands":  return buildStructuredBands(brief, pal);
      case "soft-texture-wash": return buildSoftTextureWash(brief, pal);
      case "subtle-image-wash": return buildSubtleImageWash(brief, pal);
    }
  })();

  const description = (() => {
    switch (kind) {
      case "layered-gradient":  return "Layered gradient base + atmospheric wash + fine grain. Tone-agnostic default.";
      case "framed-zone":       return "Solid base with an inset decorative frame and paper-grain overlay. Reads as editorial/luxury.";
      case "patterned-region":  return "Solid base with a contained dot or diagonal pattern region. Reads as playful / promotional.";
      case "structured-bands":  return "Split horizontal bands with an accent divider and subtle grain. Reads as structured / clean.";
      case "soft-texture-wash": return "Soft tonal gradient + paper grain + gentle light diffusion. Reads as calm / natural.";
      case "subtle-image-wash": return "Dim hero photograph + tonal scrim + grain. Reads as editorial / lifestyle.";
    }
  })();

  return { kind, description, layers };
}
