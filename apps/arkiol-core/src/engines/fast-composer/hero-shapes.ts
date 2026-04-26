// src/engines/fast-composer/hero-shapes.ts
// ─────────────────────────────────────────────────────────────────────────────
// Domain-keyed inline SVG hero visuals.
//
// Each function returns a single <g> group that depicts a recognisable
// scene for its domain — fitness gets a barbell + speed lines, wellness
// gets organic leaves + a sun, business gets a chart + arrow, etc. The
// shapes are pure SVG paths, embedded directly in the composed
// template, so there's no asset-library lookup, no S3 fetch, and no
// raster step on the hot path.
//
// Why inline shapes instead of cached library assets:
//   - Library assets resolve through scoreAssetForCategory + S3 image
//     refs, both of which add real latency on Render free.
//   - Inline shapes guarantee visual richness regardless of asset
//     availability — the gallery can never end up with an empty asset
//     slot because the file resolved to a 404.
//   - Each shape is ~200-400 bytes of SVG, so rendering 4 variations
//     stays under 5 KB total.
//
// Each shape is parameterised by the Design Brain palette so
// fitness's burst is red on yellow, wellness's leaves are sage on
// cream, etc.
// ─────────────────────────────────────────────────────────────────────────────
import type { DesignBrainPlan } from "../design-brain";

export interface HeroShapeInput {
  /** Center x of the area where the hero should sit. */
  cx:      number;
  /** Center y of the area. */
  cy:      number;
  /** Maximum radius the shape should fit in. */
  radius:  number;
  palette: DesignBrainPlan["palette"];
}

type HeroBuilder = (input: HeroShapeInput) => string;

/** Fitness — barbell with motion lines. Strong, energetic. */
const fitnessHero: HeroBuilder = ({ cx, cy, radius, palette }) => {
  const r  = radius;
  const barX1 = cx - r * 0.55, barX2 = cx + r * 0.55;
  const plateW = r * 0.18, plateH = r * 0.55;
  return `
    <g class="hero-fitness">
      <!-- speed lines -->
      <line x1="${cx - r * 0.85}" y1="${cy - r * 0.15}" x2="${cx - r * 0.55}" y2="${cy - r * 0.15}" stroke="${palette.accent}" stroke-width="6" stroke-linecap="round" opacity="0.55"/>
      <line x1="${cx - r * 0.95}" y1="${cy + r * 0.05}" x2="${cx - r * 0.6}"  y2="${cy + r * 0.05}" stroke="${palette.accent}" stroke-width="8" stroke-linecap="round" opacity="0.7"/>
      <line x1="${cx - r * 0.85}" y1="${cy + r * 0.25}" x2="${cx - r * 0.55}" y2="${cy + r * 0.25}" stroke="${palette.accent}" stroke-width="6" stroke-linecap="round" opacity="0.55"/>
      <!-- left plate -->
      <rect x="${barX1 - plateW}" y="${cy - plateH / 2}" width="${plateW}" height="${plateH}" rx="${plateW * 0.18}" fill="${palette.primary}"/>
      <rect x="${barX1 - plateW * 0.6}" y="${cy - plateH / 2 - r * 0.05}" width="${plateW * 0.6}" height="${plateH + r * 0.1}" rx="${plateW * 0.18}" fill="${palette.primary}"/>
      <!-- bar -->
      <rect x="${barX1}" y="${cy - r * 0.04}" width="${barX2 - barX1}" height="${r * 0.08}" rx="${r * 0.04}" fill="${palette.primary}"/>
      <!-- right plate -->
      <rect x="${barX2}" y="${cy - plateH / 2}" width="${plateW}" height="${plateH}" rx="${plateW * 0.18}" fill="${palette.primary}"/>
      <rect x="${barX2}" y="${cy - plateH / 2 - r * 0.05}" width="${plateW * 0.6}" height="${plateH + r * 0.1}" rx="${plateW * 0.18}" fill="${palette.primary}"/>
    </g>
  `;
};

/** Wellness — organic leaves + sun. Calm, restorative. */
const wellnessHero: HeroBuilder = ({ cx, cy, radius, palette }) => {
  const r = radius;
  return `
    <g class="hero-wellness">
      <circle cx="${cx + r * 0.05}" cy="${cy - r * 0.4}" r="${r * 0.32}" fill="${palette.accent}" opacity="0.85"/>
      <path d="M ${cx - r * 0.1} ${cy + r * 0.15}
               C ${cx - r * 0.55} ${cy + r * 0.05}, ${cx - r * 0.55} ${cy - r * 0.45}, ${cx - r * 0.05} ${cy - r * 0.55}
               C ${cx - r * 0.1} ${cy - r * 0.05}, ${cx - r * 0.05} ${cy + r * 0.05}, ${cx - r * 0.1} ${cy + r * 0.15} Z"
            fill="${palette.primary}"/>
      <path d="M ${cx + r * 0.1} ${cy + r * 0.2}
               C ${cx + r * 0.6} ${cy + r * 0.1}, ${cx + r * 0.6} ${cy - r * 0.4}, ${cx + r * 0.1} ${cy - r * 0.5}
               C ${cx + r * 0.15} ${cy - r * 0.05}, ${cx + r * 0.1} ${cy + r * 0.1}, ${cx + r * 0.1} ${cy + r * 0.2} Z"
            fill="${palette.primary}" opacity="0.78"/>
    </g>
  `;
};

/** Business — chart bars + ascending arrow. Structured, confident. */
const businessHero: HeroBuilder = ({ cx, cy, radius, palette }) => {
  const r = radius;
  const baseY = cy + r * 0.45;
  const bw = r * 0.16;
  return `
    <g class="hero-business">
      <rect x="${cx - r * 0.7}" y="${baseY - r * 0.35}" width="${bw}" height="${r * 0.35}" rx="${r * 0.04}" fill="${palette.primary}" opacity="0.55"/>
      <rect x="${cx - r * 0.42}" y="${baseY - r * 0.55}" width="${bw}" height="${r * 0.55}" rx="${r * 0.04}" fill="${palette.primary}" opacity="0.7"/>
      <rect x="${cx - r * 0.14}" y="${baseY - r * 0.75}" width="${bw}" height="${r * 0.75}" rx="${r * 0.04}" fill="${palette.primary}" opacity="0.85"/>
      <rect x="${cx + r * 0.14}" y="${baseY - r * 0.95}" width="${bw}" height="${r * 0.95}" rx="${r * 0.04}" fill="${palette.primary}"/>
      <path d="M ${cx - r * 0.55} ${baseY - r * 0.05}
               L ${cx - r * 0.27} ${baseY - r * 0.32}
               L ${cx + r * 0.01} ${baseY - r * 0.55}
               L ${cx + r * 0.29} ${baseY - r * 0.78}"
            stroke="${palette.accent}" stroke-width="${r * 0.045}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <circle cx="${cx + r * 0.29}" cy="${baseY - r * 0.78}" r="${r * 0.07}" fill="${palette.accent}"/>
    </g>
  `;
};

/** Education — book + lightbulb. Insightful, clear. */
const educationHero: HeroBuilder = ({ cx, cy, radius, palette }) => {
  const r = radius;
  return `
    <g class="hero-education">
      <rect x="${cx - r * 0.55}" y="${cy + r * 0.15}" width="${r * 1.1}" height="${r * 0.45}" rx="${r * 0.05}" fill="${palette.primary}"/>
      <line x1="${cx}" y1="${cy + r * 0.15}" x2="${cx}" y2="${cy + r * 0.6}" stroke="${palette.background}" stroke-width="${r * 0.025}"/>
      <circle cx="${cx}" cy="${cy - r * 0.25}" r="${r * 0.32}" fill="${palette.accent}"/>
      <rect x="${cx - r * 0.1}" y="${cy + r * 0.05}" width="${r * 0.2}" height="${r * 0.1}" fill="${palette.accent}"/>
      <line x1="${cx - r * 0.05}" y1="${cy + r * 0.18}" x2="${cx + r * 0.05}" y2="${cy + r * 0.18}" stroke="${palette.primary}" stroke-width="${r * 0.02}"/>
    </g>
  `;
};

/** Travel — mountain silhouette + sun. Warm, expansive. */
const travelHero: HeroBuilder = ({ cx, cy, radius, palette }) => {
  const r = radius;
  return `
    <g class="hero-travel">
      <circle cx="${cx + r * 0.35}" cy="${cy - r * 0.15}" r="${r * 0.25}" fill="${palette.accent}"/>
      <path d="M ${cx - r * 0.85} ${cy + r * 0.55}
               L ${cx - r * 0.3}  ${cy - r * 0.2}
               L ${cx - r * 0.05} ${cy + r * 0.1}
               L ${cx + r * 0.15} ${cy - r * 0.35}
               L ${cx + r * 0.55} ${cy + r * 0.15}
               L ${cx + r * 0.85} ${cy + r * 0.55} Z"
            fill="${palette.primary}"/>
      <path d="M ${cx - r * 0.3} ${cy - r * 0.2}
               L ${cx - r * 0.18} ${cy - r * 0.05}
               L ${cx - r * 0.42} ${cy + r * 0.0}
               Z"
            fill="${palette.background}" opacity="0.85"/>
    </g>
  `;
};

/** Beauty — bloom rosette + sparkle. Luxe, refined. */
const beautyHero: HeroBuilder = ({ cx, cy, radius, palette }) => {
  const r = radius;
  const petals = [0, 1, 2, 3, 4].map((i) => {
    const angle = (i * 72 - 90) * (Math.PI / 180);
    const px = cx + Math.cos(angle) * r * 0.32;
    const py = cy + Math.sin(angle) * r * 0.32;
    return `<ellipse cx="${px}" cy="${py}" rx="${r * 0.18}" ry="${r * 0.32}" fill="${palette.primary}" opacity="0.9" transform="rotate(${i * 72}, ${px}, ${py})"/>`;
  }).join("");
  return `
    <g class="hero-beauty">
      ${petals}
      <circle cx="${cx}" cy="${cy}" r="${r * 0.16}" fill="${palette.accent}"/>
      <path d="M ${cx + r * 0.6} ${cy - r * 0.55} l 0 ${r * 0.15} M ${cx + r * 0.55} ${cy - r * 0.475} l ${r * 0.1} 0" stroke="${palette.accent}" stroke-width="${r * 0.025}" stroke-linecap="round"/>
    </g>
  `;
};

/** Marketing — megaphone + burst. Bold, attention-grabbing. */
const marketingHero: HeroBuilder = ({ cx, cy, radius, palette }) => {
  const r = radius;
  const bursts = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
    const a = deg * (Math.PI / 180);
    const x1 = cx + Math.cos(a) * r * 0.55;
    const y1 = cy + Math.sin(a) * r * 0.55;
    const x2 = cx + Math.cos(a) * r * 0.85;
    const y2 = cy + Math.sin(a) * r * 0.85;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${palette.accent}" stroke-width="${r * 0.05}" stroke-linecap="round"/>`;
  }).join("");
  return `
    <g class="hero-marketing">
      ${bursts}
      <circle cx="${cx}" cy="${cy}" r="${r * 0.42}" fill="${palette.primary}"/>
      <text x="${cx}" y="${cy + r * 0.12}" text-anchor="middle" font-family="Inter, sans-serif" font-weight="900" font-size="${r * 0.45}" fill="${palette.background}">%</text>
    </g>
  `;
};

/** Motivation — star + lightning. Aspirational. */
const motivationHero: HeroBuilder = ({ cx, cy, radius, palette }) => {
  const r = radius;
  const star = (size: number) => {
    const points = [0, 1, 2, 3, 4].map((i) => {
      const a = (i * 144 - 90) * (Math.PI / 180);
      return `${cx + Math.cos(a) * size},${cy + Math.sin(a) * size}`;
    }).join(" ");
    return `<polygon points="${points}" fill="${palette.accent}"/>`;
  };
  return `
    <g class="hero-motivation">
      <circle cx="${cx}" cy="${cy}" r="${r * 0.7}" fill="${palette.primary}" opacity="0.18"/>
      ${star(r * 0.55)}
      <path d="M ${cx - r * 0.1} ${cy - r * 0.05} L ${cx + r * 0.05} ${cy - r * 0.05} L ${cx - r * 0.05} ${cy + r * 0.18} L ${cx + r * 0.12} ${cy + r * 0.18} L ${cx - r * 0.18} ${cy + r * 0.45} L ${cx - r * 0.04} ${cy + r * 0.18} L ${cx - r * 0.18} ${cy + r * 0.18} Z" fill="${palette.background}" opacity="0.92"/>
    </g>
  `;
};

/** Productivity — checklist tile. Focused, structured. */
const productivityHero: HeroBuilder = ({ cx, cy, radius, palette }) => {
  const r = radius;
  const rowH = r * 0.22;
  const rows = [0, 1, 2].map((i) => {
    const ry = cy - r * 0.4 + i * rowH;
    const checked = i === 1;
    return `
      <rect x="${cx - r * 0.55}" y="${ry}" width="${r * 1.1}" height="${rowH * 0.78}" rx="${r * 0.04}" fill="${palette.background}" opacity="0.95"/>
      <rect x="${cx - r * 0.5}" y="${ry + rowH * 0.18}" width="${rowH * 0.5}" height="${rowH * 0.5}" rx="${r * 0.025}" fill="${checked ? palette.accent : "none"}" stroke="${palette.primary}" stroke-width="${r * 0.018}"/>
      ${checked ? `<path d="M ${cx - r * 0.475} ${ry + rowH * 0.45} l ${rowH * 0.12} ${rowH * 0.12} l ${rowH * 0.22} -${rowH * 0.22}" stroke="${palette.background}" stroke-width="${r * 0.022}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
      <rect x="${cx - r * 0.32}" y="${ry + rowH * 0.32}" width="${r * 0.6}" height="${rowH * 0.18}" rx="${rowH * 0.09}" fill="${palette.primary}" opacity="${checked ? 0.4 : 0.7}"/>
    `;
  }).join("");
  return `
    <g class="hero-productivity">
      <rect x="${cx - r * 0.7}" y="${cy - r * 0.55}" width="${r * 1.4}" height="${r * 1.1}" rx="${r * 0.06}" fill="${palette.primary}" opacity="0.18"/>
      ${rows}
    </g>
  `;
};

/** General — abstract geometric. Confident fallback. */
const generalHero: HeroBuilder = ({ cx, cy, radius, palette }) => {
  const r = radius;
  return `
    <g class="hero-general">
      <circle cx="${cx - r * 0.2}" cy="${cy - r * 0.1}" r="${r * 0.55}" fill="${palette.primary}"/>
      <rect x="${cx - r * 0.1}" y="${cy - r * 0.25}" width="${r * 0.65}" height="${r * 0.65}" rx="${r * 0.08}" fill="${palette.accent}" opacity="0.9"/>
      <circle cx="${cx + r * 0.4}" cy="${cy + r * 0.2}" r="${r * 0.18}" fill="${palette.background}"/>
    </g>
  `;
};

/** Map a Design Brain domain (or "general") to its hero builder. */
export const HERO_BUILDERS: Record<string, HeroBuilder> = {
  fitness:      fitnessHero,
  wellness:     wellnessHero,
  business:     businessHero,
  education:    educationHero,
  travel:       travelHero,
  beauty:       beautyHero,
  marketing:    marketingHero,
  motivation:   motivationHero,
  productivity: productivityHero,
  general:      generalHero,
};

/** Build the hero shape SVG for the given Design Brain plan, falling
 *  back to the generic geometric hero if the plan's domain isn't
 *  registered yet. The returned string is a self-contained <g> that
 *  can be dropped straight into a parent <svg>. */
export function buildHeroShape(
  plan:    Pick<DesignBrainPlan, "domain" | "palette">,
  region:  { cx: number; cy: number; radius: number },
): string {
  const builder = HERO_BUILDERS[plan.domain] ?? HERO_BUILDERS.general;
  return builder({ ...region, palette: plan.palette });
}
