// src/engines/assets/svg-scene-composer.ts
//
// SVG scene composer. Builds recognizable, self-contained illustrations
// from reusable parts — sky, ground, subject, accents — without needing
// any external image service. Every output is inline SVG so the asset
// flow treats it identically to the existing library SVGs.
//
// The parts library is intentionally small and combinable: 4 sky
// variants × 3 ground variants × N subjects × accent clusters gives us
// dozens of visually distinct scenes from a handful of building blocks.
// Each scene is palette-aware so it adopts the requested category's
// tone without bespoke color work per illustration.
//
// Output shape: <svg viewBox="0 0 400 400" ...>parts...</svg>. All
// coordinates are in the 0–400 space so scenes can be scaled freely
// by the composition renderer.

export interface ScenePalette {
  sky:     [string, string];   // gradient top → bottom
  ground:  [string, string];
  subject: string;
  accent:  string;
  ink:     string;             // outlines / darkest details
}

// ── Built-in palettes (one per category) ─────────────────────────────────────
// Chosen to match category-profile moods (Step 14) so illustrations
// lock into the right aesthetic even without brand overrides.

export const SCENE_PALETTES: Record<string, ScenePalette> = {
  productivity: { sky: ["#EFF6FF", "#DBEAFE"], ground: ["#BFDBFE", "#93C5FD"], subject: "#1D4ED8", accent: "#F97316", ink: "#0F172A" },
  wellness:     { sky: ["#ECFDF5", "#D1FAE5"], ground: ["#A7F3D0", "#6EE7B7"], subject: "#059669", accent: "#F59E0B", ink: "#064E3B" },
  education:    { sky: ["#FEF3C7", "#FDE68A"], ground: ["#FBBF24", "#F59E0B"], subject: "#7C2D12", accent: "#2563EB", ink: "#451A03" },
  business:     { sky: ["#F1F5F9", "#CBD5E1"], ground: ["#94A3B8", "#64748B"], subject: "#1E3A8A", accent: "#F59E0B", ink: "#0F172A" },
  fitness:      { sky: ["#FEE2E2", "#FECACA"], ground: ["#FCA5A5", "#F87171"], subject: "#DC2626", accent: "#FBBF24", ink: "#7F1D1D" },
  beauty:       { sky: ["#FCE7F3", "#FBCFE8"], ground: ["#F9A8D4", "#F472B6"], subject: "#DB2777", accent: "#FBBF24", ink: "#831843" },
  travel:       { sky: ["#DBEAFE", "#93C5FD"], ground: ["#60A5FA", "#3B82F6"], subject: "#1E40AF", accent: "#F97316", ink: "#172554" },
  marketing:    { sky: ["#FFF7ED", "#FED7AA"], ground: ["#FDBA74", "#FB923C"], subject: "#EA580C", accent: "#2563EB", ink: "#7C2D12" },
  motivation:   { sky: ["#FDE68A", "#FBBF24"], ground: ["#F59E0B", "#D97706"], subject: "#1E3A8A", accent: "#EF4444", ink: "#78350F" },
};

export function getScenePalette(category: string): ScenePalette {
  return SCENE_PALETTES[category] ?? SCENE_PALETTES.productivity;
}

// ── Part builders ───────────────────────────────────────────────────────────
// Each part returns a string fragment (no wrapping <svg>) so scenes can
// stack them in paint order.

function defsGradients(p: ScenePalette, id: string): string {
  return (
    `<defs>` +
      `<linearGradient id="sky-${id}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="${p.sky[0]}"/>` +
        `<stop offset="1" stop-color="${p.sky[1]}"/>` +
      `</linearGradient>` +
      `<linearGradient id="ground-${id}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="${p.ground[0]}"/>` +
        `<stop offset="1" stop-color="${p.ground[1]}"/>` +
      `</linearGradient>` +
    `</defs>`
  );
}

// Skies ────────────────────────────────────────────────────────────────────
function skyFlat(p: ScenePalette, id: string): string {
  return `<rect width="400" height="260" fill="url(%23sky-${id})"/>`;
}
function skyWithSun(p: ScenePalette, id: string): string {
  return skyFlat(p, id) +
    `<circle cx="320" cy="80" r="34" fill="${p.accent}" opacity="0.95"/>` +
    `<circle cx="320" cy="80" r="48" fill="${p.accent}" opacity="0.25"/>`;
}
function skyWithClouds(p: ScenePalette, id: string): string {
  const cloud = (cx: number, cy: number, s: number) =>
    `<ellipse cx="${cx}" cy="${cy}" rx="${36 * s}" ry="${14 * s}" fill="#FFFFFF" opacity="0.85"/>` +
    `<ellipse cx="${cx - 20 * s}" cy="${cy + 4}" rx="${22 * s}" ry="${11 * s}" fill="#FFFFFF" opacity="0.75"/>`;
  return skyFlat(p, id) + cloud(90, 70, 1) + cloud(260, 50, 0.8);
}

// Grounds ──────────────────────────────────────────────────────────────────
function groundFlat(id: string): string {
  return `<rect y="260" width="400" height="140" fill="url(%23ground-${id})"/>`;
}
function groundHills(p: ScenePalette, id: string): string {
  return groundFlat(id) +
    `<path d="M0 280 Q100 240 200 280 T400 280 L400 400 L0 400 Z" fill="${p.ground[1]}" opacity="0.7"/>` +
    `<path d="M0 320 Q120 300 240 320 T400 320 L400 400 L0 400 Z" fill="${p.ground[0]}"/>`;
}

// Mountains ────────────────────────────────────────────────────────────────
function peaks(p: ScenePalette): string {
  return (
    `<polygon points="40,260 130,140 220,260" fill="${p.subject}"/>` +
    `<polygon points="130,140 160,175 180,170 200,195 175,220 130,180" fill="#FFFFFF" opacity="0.8"/>` +
    `<polygon points="160,260 260,160 360,260" fill="${p.subject}" opacity="0.85"/>` +
    `<polygon points="260,160 285,190 300,185 320,210 295,235 260,205" fill="#FFFFFF" opacity="0.7"/>`
  );
}

// Plant / leaf ─────────────────────────────────────────────────────────────
function pottedPlant(p: ScenePalette): string {
  return (
    // Pot
    `<path d="M140 310 L260 310 L245 390 L155 390 Z" fill="${p.subject}"/>` +
    `<rect x="135" y="300" width="130" height="14" fill="${p.ink}" opacity="0.85"/>` +
    // Stems + leaves
    `<path d="M200 300 Q180 240 160 210 Q170 230 190 260 Q170 220 150 180 Q175 215 200 260 Q210 220 225 180 Q225 225 210 260 Q235 230 255 205 Q235 245 215 280" ` +
      `stroke="${p.accent}" stroke-width="3" fill="none" stroke-linecap="round"/>` +
    `<ellipse cx="160" cy="200" rx="14" ry="24" fill="${p.accent}" transform="rotate(-35 160 200)"/>` +
    `<ellipse cx="150" cy="170" rx="12" ry="22" fill="${p.accent}" transform="rotate(-20 150 170)"/>` +
    `<ellipse cx="240" cy="210" rx="12" ry="22" fill="${p.accent}" transform="rotate(30 240 210)"/>` +
    `<ellipse cx="255" cy="185" rx="14" ry="24" fill="${p.accent}" transform="rotate(25 255 185)"/>` +
    `<ellipse cx="200" cy="160" rx="12" ry="22" fill="${p.accent}"/>`
  );
}

// Heart ────────────────────────────────────────────────────────────────────
function heartShape(p: ScenePalette): string {
  return (
    `<path d="M200 350 Q90 280 90 200 A70 70 0 0 1 200 180 A70 70 0 0 1 310 200 Q310 280 200 350 Z" ` +
      `fill="${p.subject}" stroke="${p.ink}" stroke-width="2"/>` +
    `<path d="M150 210 Q170 180 200 190" stroke="#FFFFFF" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.75"/>`
  );
}

// Dumbbell ─────────────────────────────────────────────────────────────────
function dumbbell(p: ScenePalette): string {
  return (
    `<rect x="130" y="195" width="140" height="20" rx="4" fill="${p.ink}"/>` +
    `<rect x="100" y="175" width="40" height="60" rx="8" fill="${p.subject}"/>` +
    `<rect x="85"  y="185" width="20" height="40" rx="6" fill="${p.subject}"/>` +
    `<rect x="260" y="175" width="40" height="60" rx="8" fill="${p.subject}"/>` +
    `<rect x="295" y="185" width="20" height="40" rx="6" fill="${p.subject}"/>`
  );
}

// Trophy ───────────────────────────────────────────────────────────────────
function trophy(p: ScenePalette): string {
  return (
    `<path d="M150 120 L250 120 L245 220 A50 50 0 0 1 155 220 Z" fill="${p.accent}" stroke="${p.ink}" stroke-width="2"/>` +
    `<path d="M150 140 Q120 140 120 170 Q120 200 155 210" stroke="${p.ink}" stroke-width="4" fill="none"/>` +
    `<path d="M250 140 Q280 140 280 170 Q280 200 245 210" stroke="${p.ink}" stroke-width="4" fill="none"/>` +
    `<rect x="175" y="225" width="50" height="30" fill="${p.accent}" stroke="${p.ink}" stroke-width="2"/>` +
    `<rect x="150" y="255" width="100" height="18" rx="4" fill="${p.subject}" stroke="${p.ink}" stroke-width="2"/>` +
    `<text x="200" y="180" text-anchor="middle" font-family="Inter, sans-serif" font-size="44" font-weight="900" fill="${p.ink}">1</text>`
  );
}

// Books stack ──────────────────────────────────────────────────────────────
function booksStack(p: ScenePalette): string {
  return (
    `<rect x="110" y="280" width="180" height="30" rx="3" fill="${p.subject}"/>` +
    `<rect x="120" y="252" width="160" height="28" rx="3" fill="${p.accent}"/>` +
    `<rect x="130" y="225" width="140" height="27" rx="3" fill="${p.ink}"/>` +
    `<rect x="115" y="285" width="170" height="4" fill="#FFFFFF" opacity="0.5"/>` +
    `<rect x="125" y="257" width="150" height="4" fill="#FFFFFF" opacity="0.45"/>` +
    `<rect x="135" y="230" width="130" height="4" fill="#FFFFFF" opacity="0.45"/>`
  );
}

// Water bottle ─────────────────────────────────────────────────────────────
function waterBottle(p: ScenePalette): string {
  return (
    `<rect x="175" y="110" width="50" height="24" rx="4" fill="${p.ink}"/>` +
    `<path d="M170 134 L230 134 L235 180 Q235 260 225 310 Q225 330 200 330 Q175 330 175 310 Q165 260 165 180 Z" ` +
      `fill="${p.subject}" stroke="${p.ink}" stroke-width="2"/>` +
    `<path d="M175 200 L225 200 L230 290 Q215 300 200 300 Q185 300 170 290 Z" fill="#FFFFFF" opacity="0.25"/>`
  );
}

// Plane (paper) ────────────────────────────────────────────────────────────
function paperPlane(p: ScenePalette): string {
  return (
    `<polygon points="70,220 330,120 220,330 200,250 120,240" fill="${p.subject}" stroke="${p.ink}" stroke-width="2"/>` +
    `<polyline points="70,220 200,250 220,330" fill="none" stroke="${p.ink}" stroke-width="2" opacity="0.5"/>`
  );
}

// Bulb (idea) ──────────────────────────────────────────────────────────────
function lightbulb(p: ScenePalette): string {
  return (
    `<circle cx="200" cy="170" r="70" fill="${p.accent}"/>` +
    `<path d="M170 220 L230 220 L230 255 L170 255 Z" fill="${p.ink}"/>` +
    `<path d="M180 270 L220 270" stroke="${p.ink}" stroke-width="3"/>` +
    // Rays
    `<path d="M100 170 L70 170 M200 70 L200 40 M300 170 L330 170 M135 105 L110 85 M265 105 L290 85" ` +
      `stroke="${p.accent}" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M175 150 Q200 130 225 150" stroke="${p.ink}" stroke-width="3" fill="none" opacity="0.6"/>`
  );
}

// Target ───────────────────────────────────────────────────────────────────
function target(p: ScenePalette): string {
  return (
    `<circle cx="200" cy="210" r="110" fill="${p.sky[1]}"/>` +
    `<circle cx="200" cy="210" r="85"  fill="${p.subject}"/>` +
    `<circle cx="200" cy="210" r="55"  fill="${p.sky[0]}"/>` +
    `<circle cx="200" cy="210" r="30"  fill="${p.accent}"/>` +
    `<circle cx="200" cy="210" r="10"  fill="${p.ink}"/>` +
    // Arrow
    `<line x1="75" y1="110" x2="195" y2="205" stroke="${p.ink}" stroke-width="6" stroke-linecap="round"/>` +
    `<polygon points="195,205 175,195 185,215" fill="${p.ink}"/>` +
    `<polygon points="75,110 65,125 80,125" fill="${p.accent}"/>`
  );
}

// Megaphone ────────────────────────────────────────────────────────────────
function megaphone(p: ScenePalette): string {
  return (
    `<path d="M100 180 L100 260 L200 260 L280 320 L280 120 L200 180 Z" fill="${p.subject}" stroke="${p.ink}" stroke-width="2"/>` +
    `<rect x="70" y="200" width="30" height="40" fill="${p.accent}"/>` +
    // Sound waves
    `<path d="M300 150 Q330 180 330 220 Q330 260 300 290" fill="none" stroke="${p.accent}" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M320 130 Q360 175 360 220 Q360 265 320 310" fill="none" stroke="${p.accent}" stroke-width="4" stroke-linecap="round" opacity="0.7"/>`
  );
}

// Sparkle accents ──────────────────────────────────────────────────────────
function sparkles(p: ScenePalette): string {
  const s = (cx: number, cy: number, size: number, color: string) =>
    `<path fill="${color}" d="M${cx} ${cy - size}l${size * 0.3} ${size * 0.7}l${size * 0.7} ${size * 0.3}l-${size * 0.7} ${size * 0.3}l-${size * 0.3} ${size * 0.7}l-${size * 0.3} -${size * 0.7}l-${size * 0.7} -${size * 0.3}l${size * 0.7} -${size * 0.3}z"/>`;
  return s(60, 90, 10, p.accent) + s(340, 140, 8, p.accent) + s(350, 50, 12, p.subject) + s(50, 320, 9, p.subject);
}

// ── Scene catalog ───────────────────────────────────────────────────────────
// Each scene is a named composition that takes a palette and returns the
// inner SVG body (no <svg> wrapper — wrapping happens in render()).

export type SceneKind =
  | "mountain-sunrise"
  | "plant-potted"
  | "heart-centered"
  | "dumbbell-rack"
  | "trophy-podium"
  | "books-stack"
  | "water-bottle"
  | "paper-plane"
  | "idea-bulb"
  | "target-arrow"
  | "megaphone-launch"
  | "leaf-scene"
  | "cloudscape";

interface SceneBuilder {
  build(p: ScenePalette, id: string): string;
  aspectRatio: number;
}

const SCENES: Record<SceneKind, SceneBuilder> = {
  "mountain-sunrise": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyWithSun(p, id) + groundHills(p, id) + peaks(p) + sparkles(p);
    },
  },
  "plant-potted": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + groundFlat(id) + pottedPlant(p) + sparkles(p);
    },
  },
  "heart-centered": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + groundFlat(id) + heartShape(p) + sparkles(p);
    },
  },
  "dumbbell-rack": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + groundFlat(id) + dumbbell(p);
    },
  },
  "trophy-podium": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyWithSun(p, id) + groundFlat(id) + trophy(p) + sparkles(p);
    },
  },
  "books-stack": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + groundFlat(id) + booksStack(p) + sparkles(p);
    },
  },
  "water-bottle": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + groundFlat(id) + waterBottle(p);
    },
  },
  "paper-plane": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyWithClouds(p, id) + groundHills(p, id) + paperPlane(p);
    },
  },
  "idea-bulb": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + groundFlat(id) + lightbulb(p) + sparkles(p);
    },
  },
  "target-arrow": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + groundFlat(id) + target(p);
    },
  },
  "megaphone-launch": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyWithClouds(p, id) + groundFlat(id) + megaphone(p) + sparkles(p);
    },
  },
  "leaf-scene": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + groundHills(p, id) +
        `<ellipse cx="200" cy="200" rx="70" ry="120" fill="${p.subject}"/>` +
        `<path d="M200 80 Q210 200 200 320" stroke="${p.ink}" stroke-width="3" fill="none"/>` +
        `<path d="M200 140 Q180 160 170 180 M200 180 Q220 200 230 220 M200 220 Q180 240 170 260" ` +
          `stroke="${p.ink}" stroke-width="2" fill="none" opacity="0.6"/>` +
        sparkles(p);
    },
  },
  "cloudscape": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyWithClouds(p, id) + groundHills(p, id) + peaks(p);
    },
  },
};

// ── Public render ────────────────────────────────────────────────────────────

/**
 * Render a scene to a complete inline SVG string.
 *
 *   renderScene("mountain-sunrise", "motivation")
 *
 * The returned string is a self-contained <svg>…</svg> ready to drop
 * into an Asset payload with format="svg". No external dependencies,
 * no URL fetches — deterministic and offline-safe.
 */
export function renderScene(kind: SceneKind, category: string): string {
  const builder = SCENES[kind];
  const palette = getScenePalette(category);
  // Per-call gradient id so multiple scenes in the same render don't
  // clash on <defs> identifiers.
  const id = `${kind}_${category}_${Math.abs(hashCode(`${kind}:${category}`))}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">${builder.build(palette, id)}</svg>`;
}

export function getSceneAspectRatio(kind: SceneKind): number {
  return SCENES[kind].aspectRatio;
}

export const SCENE_KINDS: readonly SceneKind[] = Object.freeze(
  Object.keys(SCENES) as SceneKind[],
);

function hashCode(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}
